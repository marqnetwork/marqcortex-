#!/usr/bin/env node
/**
 * G2 — the tenancy invariants, adversarially, against a real PostgreSQL.
 *
 * ── WHAT THIS ASKS ─────────────────────────────────────────────────────────
 *
 * Every child table in the diagnostic domain carries `organization_id` AND a
 * foreign key to a parent that carries its own. Nothing in the schema said the
 * two had to agree, so a child could name a parent in another tenant: the row
 * is then invisible to its own parent's organization scope while still hanging
 * off that parent — an orphan and a tenancy leak in one row.
 *
 * These scenarios attempt exactly that, on EVERY such relationship, and assert
 * the database refuses it. Before the composite foreign keys they refuse
 * nothing; after, they refuse all of it. `--expect-gap` runs the same file as a
 * counterfactual and asserts the *unprotected* behaviour instead, which is how
 * the "before" is evidence rather than a memory.
 *
 * The RLS scenarios are separate and check the other layer: that a member of
 * one organization, acting as `authenticated`, cannot read or write another
 * organization's rows even when naming their ids exactly.
 *
 * ── WHAT IT DELIBERATELY DOES NOT ASK ──────────────────────────────────────
 *
 * Application-layer authority — `resolveOrganization`, `readScopeFor`,
 * `requireClientAccess` — is proven by the Deno and Node suites, and is a layer
 * ABOVE this one. Where an invariant is intentionally application-only, the
 * scenario proves the database permits it and names the guard that refuses it,
 * rather than pretending SQL is the boundary.
 *
 * Usage:  node scripts/tenancy-adversarial-scenarios.mjs [--expect-gap]
 *
 * Connection: `DATABASE_URL`, or the standard PG* variables. Creates and drops
 * its own scratch database.
 *
 * Exit codes: 0 passed, 1 a scenario failed, 2 no database (BLOCKED, not a pass).
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const HARNESS = join(ROOT, 'tests', 'database', 'harness');
const SCRATCH_DB = process.env.TENANCY_SCENARIO_DB ?? 'cortex_tenancy_adversarial';

/** Counterfactual mode: assert the gap EXISTS, to prove the fix is what closed it. */
const EXPECT_GAP = process.argv.includes('--expect-gap');

const STEPS = [
  join(HARNESS, '00_platform_stub.sql'),
  join(MIGRATIONS, '20260711050000_cortex_tenancy_foundation.sql'),
  join(MIGRATIONS, '20260711050001_cortex_tenancy_rls_and_seed.sql'),
  join(MIGRATIONS, '20260713000000_kv_store_foundation.sql'),
  join(MIGRATIONS, '20260714050000_cortex_diagnostic_foundation.sql'),
  join(MIGRATIONS, '20260714050001_cortex_diagnostic_rls.sql'),
  join(MIGRATIONS, '20260714060000_cortex_diagnostic_anon_policy_hardening.sql'),
  // A Supabase project grants the API roles on `public` as part of the platform
  // rather than in any migration, so a bare PostgreSQL has to be given what the
  // real one already has. Without it `authenticated` is refused by table
  // PRIVILEGES and the RLS policies below are never reached — which would look
  // like a pass and prove nothing about RLS.
  join(HARNESS, '06_platform_public_grants.sql'),
  // The constraint under test. Excluded in --expect-gap so the counterfactual
  // observes the schema as it was.
  ...(EXPECT_GAP ? [] : [join(MIGRATIONS, '20260910120000_cortex_tenancy_composite_keys.sql')]),
];

function baseArgs(database) {
  if (process.env.DATABASE_URL) {
    const parsed = new URL(process.env.DATABASE_URL);
    if (database) parsed.pathname = `/${database}`;
    return ['-d', parsed.toString()];
  }
  return database ? ['-d', database] : [];
}

function psql(args, database) {
  return spawnSync('psql', [...baseArgs(database), '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args], {
    encoding: 'utf8',
    env: process.env,
  });
}

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

const probe = psql(['-c', 'SELECT 1']);
if (probe.error?.code === 'ENOENT' || probe.status !== 0) {
  console.error(
    'BLOCKED: no reachable PostgreSQL. Set DATABASE_URL or the PG* variables. ' +
      'NOT RUN is not a pass.',
  );
  process.exit(2);
}

psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`]);
if (psql(['-c', `CREATE DATABASE ${SCRATCH_DB}`]).status !== 0) fail('could not create scratch db');

console.log(
  `\nTenancy adversarial scenarios — "${SCRATCH_DB}"` +
    (EXPECT_GAP ? '  [COUNTERFACTUAL: composite keys NOT applied]' : ''),
);
for (const file of STEPS) {
  const run = psql(['-f', file], SCRATCH_DB);
  if (run.status !== 0) {
    psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`]);
    fail(`applying ${file}\n${(run.stderr ?? '').trim()}`);
  }
}
console.log(`  ✓ schema applied (${STEPS.length} steps)`);

const exec = (text, { as } = {}) => {
  const prefix = as ? `SET LOCAL ROLE ${as}; ` : '';
  return psql(['-c', `BEGIN; ${prefix}${text}; COMMIT`], SCRATCH_DB);
};

/**
 * Try a statement and throw it away.
 *
 * Foreign keys are immediate, so the constraint under test fires at the
 * statement — the ROLLBACK only decides whether a SUCCESSFUL attempt persists.
 * Nothing here needs cleaning up afterwards, which matters more than it sounds:
 * the first version of this file deleted its attempts by age, and "rows created
 * in the last minute" is every row in a run that takes seconds. It removed the
 * fixture along with the attempt and reported a schema behaviour that was
 * really its own tidying.
 */
const attempt = (text) => psql(['-c', `BEGIN; ${text}; ROLLBACK`], SCRATCH_DB);
const scalar = (text) => {
  const run = spawnSync(
    'psql',
    [...baseArgs(SCRATCH_DB), '-v', 'ON_ERROR_STOP=1', '-X', '-A', '-t', '-c', text],
    { encoding: 'utf8', env: process.env },
  );
  if (run.status !== 0) fail(`SQL failed:\n${text}\n${(run.stderr ?? '').trim()}`);
  return run.stdout.trim();
};
/** The one numeric line from a psql result — `BEGIN`/`ROLLBACK` tags are echoed too. */
const countOf = (text) => {
  const lines = scalar(text).split('\n').map((line) => line.trim()).filter((line) => /^\d+$/.test(line));
  assert.equal(lines.length, 1, `expected exactly one count, got: ${JSON.stringify(lines)}`);
  return lines[0];
};

const run = (text) => {
  const r = psql(['-c', text], SCRATCH_DB);
  if (r.status !== 0) fail(`setup SQL failed:\n${text}\n${(r.stderr ?? '').trim()}`);
  return r;
};

const results = [];
function scenario(name, body) {
  try {
    body();
  } catch (cause) {
    fail(`${name}\n${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}`);
  }
  results.push(name);
  console.log(`  ✓ ${name}`);
}

// ── fixture: two tenants, each with a complete diagnostic chain ─────────────

run(`INSERT INTO public.organizations (slug, name) VALUES ('tenant-a','Tenant A'), ('tenant-b','Tenant B')`);
const A = scalar(`SELECT id FROM public.organizations WHERE slug='tenant-a'`);
const B = scalar(`SELECT id FROM public.organizations WHERE slug='tenant-b'`);

function seedChain(org, tag) {
  run(`INSERT INTO public.contacts (organization_id, primary_email) VALUES ('${org}','${tag}@t.test')`);
  const contact = scalar(`SELECT id FROM public.contacts WHERE organization_id='${org}'`);
  run(`INSERT INTO public.lead_sources (organization_id, key, name) VALUES ('${org}','src-${tag}','Src')`);
  const source = scalar(`SELECT id FROM public.lead_sources WHERE organization_id='${org}'`);
  run(`INSERT INTO public.leads (organization_id, email) VALUES ('${org}','${tag}@t.test')`);
  const lead = scalar(`SELECT id FROM public.leads WHERE organization_id='${org}'`);
  run(`INSERT INTO public.submissions (organization_id, company_name, contact_email) VALUES ('${org}','Co ${tag}','${tag}@t.test')`);
  const submission = scalar(`SELECT id FROM public.submissions WHERE organization_id='${org}'`);
  run(`INSERT INTO public.submission_sections (organization_id, submission_id, section_key) VALUES ('${org}','${submission}','ops')`);
  const section = scalar(`SELECT id FROM public.submission_sections WHERE organization_id='${org}'`);
  run(`INSERT INTO public.reports (organization_id, submission_id) VALUES ('${org}','${submission}')`);
  const report = scalar(`SELECT id FROM public.reports WHERE organization_id='${org}'`);
  return { contact, source, lead, submission, section, report };
}

const a = seedChain(A, 'a');
const b = seedChain(B, 'b');

/**
 * Every parent→child relationship where both rows carry `organization_id`.
 * Derived from the schema, not from memory: if a new child table is added
 * without a composite key, this list is where it has to be declared.
 */
const RELATIONSHIPS = [
  ['contact_methods', `(organization_id, contact_id, method_type, value) VALUES ('%ORG%','${a.contact}','email','x@t.test')`, 'contacts'],
  ['lead_tags', `(organization_id, lead_id, tag) VALUES ('%ORG%','${a.lead}','t')`, 'leads'],
  ['leads (contact_id)', `(organization_id, email, contact_id) VALUES ('%ORG%','x2@t.test','${a.contact}')`, 'contacts'],
  ['leads (lead_source_id)', `(organization_id, email, lead_source_id) VALUES ('%ORG%','x3@t.test','${a.source}')`, 'lead_sources'],
  ['submissions (lead_id)', `(organization_id, company_name, contact_email, lead_id) VALUES ('%ORG%','C','x4@t.test','${a.lead}')`, 'leads'],
  ['submissions (contact_id)', `(organization_id, company_name, contact_email, contact_id) VALUES ('%ORG%','C','x5@t.test','${a.contact}')`, 'contacts'],
  ['submission_sections', `(organization_id, submission_id, section_key) VALUES ('%ORG%','${a.submission}','k')`, 'submissions'],
  ['diagnostic_answers (submission)', `(organization_id, submission_id, question_key) VALUES ('%ORG%','${a.submission}','q')`, 'submissions'],
  ['diagnostic_answers (section)', `(organization_id, submission_id, section_id, question_key) VALUES ('%ORG%','${b.submission}','${a.section}','q2')`, 'submission_sections'],
  ['diagnostic_scores', `(organization_id, submission_id) VALUES ('%ORG%','${a.submission}')`, 'submissions'],
  ['domain_scores', `(organization_id, submission_id, domain_key, score) VALUES ('%ORG%','${a.submission}','ops',50)`, 'submissions'],
  ['reports', `(organization_id, submission_id) VALUES ('%ORG%','${a.submission}')`, 'submissions'],
  ['report_versions', `(organization_id, report_id, version_number) VALUES ('%ORG%','${a.report}',1)`, 'reports'],
  ['outcomes', `(organization_id, submission_id) VALUES ('%ORG%','${a.submission}')`, 'submissions'],
];

console.log('\nCross-tenant parent/child writes');

for (const [label, columns, parent] of RELATIONSHIPS) {
  const table = label.replace(/ \(.*/, '');
  scenario(
    `${label} — a child in tenant B naming a parent in tenant A`,
    () => {
      const tried = attempt(`INSERT INTO public.${table} ${columns.replace('%ORG%', B)}`);
      if (EXPECT_GAP) {
        assert.equal(
          tried.status, 0,
          `COUNTERFACTUAL: the unprotected schema was expected to ACCEPT this cross-tenant ${table} row\n${(tried.stderr ?? '').trim()}`,
        );
      } else {
        assert.notEqual(tried.status, 0, `the database ACCEPTED a cross-tenant ${table} row`);
        assert.match(
          tried.stderr ?? '', /foreign key|violates/i,
          `refused, but not by a foreign key — check which constraint fired for ${parent}`,
        );
      }
    },
  );
}

console.log('\nSame-tenant writes still work');

scenario('a complete same-tenant chain is unaffected', () => {
  const ok = attempt(
    `INSERT INTO public.report_versions (organization_id, report_id, version_number)
     VALUES ('${A}','${a.report}',9)`,
  );
  assert.equal(ok.status, 0, `the composite key must not refuse a legitimate row: ${ok.stderr}`);
});

scenario('a child may still be created for every relationship within its own tenant', () => {
  for (const [label, columns] of RELATIONSHIPS) {
    const table = label.replace(/ \(.*/, '');
    // `diagnostic_answers (section)` deliberately mixes B's submission with A's
    // section, so within-tenant is not expressible for it from this fixture.
    if (label === 'diagnostic_answers (section)') continue;
    const ok = attempt(`INSERT INTO public.${table} ${columns.replace('%ORG%', A)}`);
    assert.equal(ok.status, 0, `${table} refused a legitimate same-tenant row: ${ok.stderr}`);
  }
});

console.log('\nCross-tenant UPDATE (moving a row between tenants)');

scenario('a report cannot be re-parented into another tenant', () => {
  const tried = attempt(
    `UPDATE public.reports SET submission_id = '${b.submission}' WHERE id = '${a.report}'`,
  );
  if (EXPECT_GAP) {
    assert.equal(tried.status, 0, 'COUNTERFACTUAL: expected the unprotected schema to allow it');
  } else {
    assert.notEqual(tried.status, 0, 'a report was moved onto another tenant\'s submission');
  }
});

scenario('a report cannot be handed to another organization', () => {
  const tried = attempt(`UPDATE public.reports SET organization_id = '${B}' WHERE id = '${a.report}'`);
  if (EXPECT_GAP) {
    assert.equal(tried.status, 0, 'COUNTERFACTUAL: expected the unprotected schema to allow it');
  } else {
    assert.notEqual(tried.status, 0, 'a report changed tenant while keeping its submission');
  }
});

console.log('\nParent deletion still behaves as the schema declared');

scenario('ON DELETE CASCADE still cascades through the two-column key', () => {
  const probe = attempt(
    `DELETE FROM public.submissions WHERE id = '${a.submission}';
     SELECT count(*) AS remaining FROM public.reports WHERE submission_id = '${a.submission}'`,
  );
  assert.equal(probe.status, 0, `deleting a parent failed: ${probe.stderr}`);
  assert.match(probe.stdout ?? '', /\b0\b/, 'the child survived a CASCADE delete');
});

scenario('ON DELETE SET NULL clears the parent reference and NOT the tenant', () => {
  // The failure this guards against: a two-column SET NULL with no column list
  // nulls `organization_id` too, which is NOT NULL — so the parent delete
  // fails outright and a routine tidy-up becomes an outage.
  run(`UPDATE public.submissions SET contact_id = '${a.contact}' WHERE id = '${a.submission}'`);
  const probe = attempt(
    `DELETE FROM public.contacts WHERE id = '${a.contact}';
     SELECT contact_id IS NULL AS cleared, organization_id = '${A}' AS tenant_kept
       FROM public.submissions WHERE id = '${a.submission}'`,
  );
  assert.equal(probe.status, 0, `SET NULL delete failed — the column list is missing: ${probe.stderr}`);
  assert.match(probe.stdout ?? '', /t\s*\|\s*t|cleared[\s\S]*?t[\s\S]*?t/, 
    `expected contact_id cleared and organization_id kept, got:\n${probe.stdout}`);
  run(`UPDATE public.submissions SET contact_id = NULL WHERE id = '${a.submission}'`);
});

console.log('\nRLS — the other layer');

scenario('RLS is enabled on every diagnostic table', () => {
  const off = scalar(
    `SELECT coalesce(string_agg(relname, ','), '') FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity
       AND c.relname IN ('leads','contacts','contact_methods','lead_tags','lead_sources',
                         'submissions','submission_sections','diagnostic_answers',
                         'diagnostic_scores','domain_scores','reports','report_versions','outcomes')`,
  );
  assert.equal(off, '', `RLS is disabled on: ${off}`);
});

scenario('an authenticated caller with no membership reads nothing', () => {
  // The shared harness deliberately withholds `authenticated` grants so its
  // isolation assertions are never weaker than the deployment. A real Supabase
  // project DOES grant that role, and RLS is what constrains it there — so the
  // grant is made HERE, locally and explicitly, to put the policy under test
  // rather than the privilege. Without it this reads "permission denied", which
  // passes for the wrong reason and proves nothing about RLS.
  run(`GRANT SELECT ON public.submissions, public.reports, public.outcomes TO authenticated`);
  const visible = countOf(`BEGIN; SET LOCAL ROLE authenticated;
     SELECT count(*) FROM public.submissions; ROLLBACK`);
  assert.equal(visible, '0', 'RLS admitted a caller with no verified membership');
});

scenario('RLS refuses a caller naming another tenant\'s row id exactly', () => {
  const leaked = countOf(`BEGIN; SET LOCAL ROLE authenticated;
     SELECT count(*) FROM public.reports WHERE id = '${a.report}'; ROLLBACK`);
  assert.equal(leaked, '0', 'naming a row id exactly bypassed RLS');
});

scenario('a membership does not exist for the anonymous subject, so nothing is admitted', () => {
  // `cortex.can_read_diagnostic` resolves membership from the JWT subject.
  // With no `request.jwt.claim.sub` set there is no subject, and the policy
  // must resolve to false rather than to "no filter".
  const admitted = countOf(`BEGIN; SET LOCAL ROLE authenticated;
     SELECT count(*) FROM public.outcomes; ROLLBACK`);
  assert.equal(admitted, '0', 'an unresolvable subject was treated as permitted');
});

scenario('the service role is the documented RLS bypass, and it is server-side only', () => {
  // The migration engine and the repositories run as `service_role`, which is
  // why repository-level organization filters are load-bearing rather than
  // decorative. This asserts the bypass is real so the claim is not folklore.
  const bypass = scalar(`SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role'`);
  assert.equal(bypass, 't', 'service_role no longer bypasses RLS — revisit the repository guards');
});

console.log('\nGlobally unique legacy identity');

scenario('legacy_kv_key is global, so a key cannot be claimed by two tenants', () => {
  run(`UPDATE public.submissions SET legacy_kv_key = 'sub:shared' WHERE id = '${a.submission}'`);
  const tried = attempt(
    `UPDATE public.submissions SET legacy_kv_key = 'sub:shared' WHERE id = '${b.submission}'`,
  );
  assert.notEqual(tried.status, 0, 'two tenants claimed one legacy key');
  assert.match(tried.stderr ?? '', /duplicate key|unique/i);
  run(`UPDATE public.submissions SET legacy_kv_key = NULL WHERE id = '${a.submission}'`);
});

scenario('a cross-tenant lookup BY legacy key still cannot cross the org filter', () => {
  run(`UPDATE public.submissions SET legacy_kv_key = 'sub:probe' WHERE id = '${b.submission}'`);
  const leaked = scalar(
    `SELECT count(*) FROM public.submissions
     WHERE legacy_kv_key = 'sub:probe' AND organization_id = '${A}'`,
  );
  assert.equal(leaked, '0', 'a globally unique key resolved a row across the organization filter');
  run(`UPDATE public.submissions SET legacy_kv_key = NULL WHERE id = '${b.submission}'`);
});

psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`]);
console.log(
  `\n✓ ${results.length} tenancy scenarios hold against a real PostgreSQL` +
    (EXPECT_GAP ? '  [counterfactual: the gap was real]' : ''),
);
