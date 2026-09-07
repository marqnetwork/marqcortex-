#!/usr/bin/env node
/**
 * API boundary — Supabase Edge Functions (Deno) type-check.
 *
 * The Supabase functions target the Deno runtime: they use the `Deno` global
 * and `npm:` / `jsr:` import specifiers, which Deno resolves natively. The
 * production-appropriate type-checker for this code is therefore `deno check`,
 * NOT `tsc`.
 *
 * `tsc` has no Deno resolver, so under `tsc` the `Deno` global surfaces as
 * TS2304 ("Cannot find name 'Deno'") and every `npm:` / `jsr:` specifier
 * surfaces as TS2307 ("Cannot find module"). Those are artifacts of using the
 * wrong tool — they are NOT source-code defects and must not be reported as
 * such. This script therefore never falls back to `tsc`.
 *
 * WHY `--node-modules-dir=none`
 * The repository root has a `package.json` and a `node_modules/` for the Vite
 * web app. Deno auto-detects that and expects every `npm:` specifier the edge
 * functions use to be installed there, which it is not — the edge functions are
 * deployed by the Supabase CLI, which resolves them from Deno's own cache.
 * Forcing `none` makes the local check resolve them the same way the deploy does.
 *
 * BOUNDARIES
 * The check runs in two passes so a pre-existing failure elsewhere in the server
 * cannot be mistaken for a regression in the AI boundary, and vice versa:
 *
 *   ai      supabase/functions/server/ai/** plus aiRoutes.ts — the AI-01
 *           surface. Required to be clean. A non-zero exit here is a blocker.
 *   server  everything else under supabase/functions/.
 *
 * Pass `--boundary=ai` to check only the AI surface.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';

const FUNCTIONS_ROOT = 'supabase/functions';
const CONFIG = join(FUNCTIONS_ROOT, 'deno.json');

/** Paths that make up the AI-01 boundary. */
const AI_PREFIXES = [
  join(FUNCTIONS_ROOT, 'server', 'ai') + sep,
  join(FUNCTIONS_ROOT, 'server', 'aiRoutes.ts'),
  join(FUNCTIONS_ROOT, 'server', 'aiAdminRoutes.ts'),
  // AI-01 Batch 4D. The customer BYOK route binding is part of the same
  // security surface as the platform administration one and takes no Deno-only
  // import, so a type regression in it is a blocker rather than a note.
  join(FUNCTIONS_ROOT, 'server', 'aiByokRoutes.ts'),
  join(FUNCTIONS_ROOT, 'server', 'agentRuntimeRoutes.ts'),
  join(FUNCTIONS_ROOT, 'server', 'workflowRuntimeRoutes.ts'),
  join(FUNCTIONS_ROOT, 'server', 'teamAuthorization.ts'),
  // The membership lifecycle is part of the same security surface: it decides
  // which organization role a team account carries. It takes no Deno-only
  // import, so it checks cleanly in this boundary and a regression in it is a
  // blocker rather than a note.
  join(FUNCTIONS_ROOT, 'server', 'membershipLifecycle.ts'),
];

/**
 * Files that take NO Deno-only and no `jsr:` / `npm:` import.
 *
 * Their own boundary because they check cleanly WITHOUT a module registry, so a
 * type regression in them is a blocker rather than a note lost inside the
 * `server` boundary — which cannot be checked at all where jsr.io is
 * unreachable. Adding a file here is a claim that it imports nothing a registry
 * has to resolve; the check itself is what verifies the claim.
 *
 * `outcomeShadowRead.ts` and `submissionShadowRead.ts` are deliberately absent:
 * they reach the repositories and `Deno.env`, so they belong with the rest of
 * the server surface.
 */
const REGISTRY_FREE_FILES = [
  // Runtime storage shadow read (MCV2-S7.4 / S7.7).
  join(FUNCTIONS_ROOT, 'server', 'storage', 'contracts.ts'),
  join(FUNCTIONS_ROOT, 'server', 'storage', 'compare.ts'),
  join(FUNCTIONS_ROOT, 'server', 'storage', 'outcomeProjection.ts'),
  join(FUNCTIONS_ROOT, 'server', 'storage', 'submissionProjection.ts'),
  join(FUNCTIONS_ROOT, 'server', 'storage', 'shadowReader.ts'),
  join(FUNCTIONS_ROOT, 'server', 'storage', 'index.ts'),
  // The operational health framework (blueprint IV-51) — a roll-up over ports,
  // so it imports nothing a registry has to resolve.
  join(FUNCTIONS_ROOT, 'server', 'health', 'contracts.ts'),
  join(FUNCTIONS_ROOT, 'server', 'health', 'rollup.ts'),
  join(FUNCTIONS_ROOT, 'server', 'health', 'sources.ts'),
  join(FUNCTIONS_ROOT, 'server', 'health', 'index.ts'),
  // Enterprise KPIs (blueprint IV-48) — definitions and a registry over ports.
  join(FUNCTIONS_ROOT, 'server', 'kpi', 'contracts.ts'),
  join(FUNCTIONS_ROOT, 'server', 'kpi', 'registry.ts'),
  join(FUNCTIONS_ROOT, 'server', 'kpi', 'catalog.ts'),
  join(FUNCTIONS_ROOT, 'server', 'kpi', 'index.ts'),
  // Migration normalizers — pure, and the place every mapping judgement lives.
  join(FUNCTIONS_ROOT, 'server', 'migration', 'parseJson.ts'),
  join(FUNCTIONS_ROOT, 'server', 'migration', 'submissionNormalizer.ts'),
];

function collectSources(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSources(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const isAiFile = (file) => AI_PREFIXES.some((prefix) => file.startsWith(prefix));
const isRegistryFreeFile = (file) => REGISTRY_FREE_FILES.includes(file);

const probe = spawnSync('deno', ['--version'], { stdio: 'ignore' });
if (probe.error || probe.status !== 0) {
  process.stderr.write(
`typecheck:api — BLOCKED: no Deno toolchain in this environment.

The Supabase Edge Functions under ${FUNCTIONS_ROOT}/ run on Deno. The correct,
production-appropriate type-check for them is:

    deno check --config ${CONFIG} --node-modules-dir=none <sources>

The \`Deno\` global and the \`npm:\` / \`jsr:\` import specifiers this code uses
are resolved by the Deno runtime. They are NOT source-code defects, and this
boundary deliberately does not fall back to \`tsc\` (which would misreport them
as TS2304 / TS2307).

Install Deno to run this check. Any of these work:

    npm  i -g deno                       # no privileged install needed
    curl -fsSL https://deno.land/install.sh | sh
    brew install deno

Then re-run: npm run typecheck:api
`,
  );
  process.exit(1);
}

if (!existsSync(CONFIG)) {
  process.stderr.write(`typecheck:api — BLOCKED: ${CONFIG} is missing.\n`);
  process.exit(1);
}

const requested = process.argv.find((arg) => arg.startsWith('--boundary='))?.split('=')[1];
const all = collectSources(FUNCTIONS_ROOT);
const boundaries =
  requested === 'ai'
    ? [{ name: 'ai', files: all.filter(isAiFile) }]
    : requested === 'registry-free'
      ? [{ name: 'registry-free', files: all.filter(isRegistryFreeFile) }]
      : [
          { name: 'ai', files: all.filter(isAiFile) },
          { name: 'registry-free', files: all.filter(isRegistryFreeFile) },
          {
            name: 'server',
            files: all.filter((file) => !isAiFile(file) && !isRegistryFreeFile(file)),
          },
        ];

/**
 * A registry that cannot be reached is an environment problem, not a type
 * error. Reporting the two identically is how a blocked CI runner gets recorded
 * as "the code does not compile", so they are separated here.
 */
const REGISTRY_UNREACHABLE =
  /(failed to load|Import '.*' failed).*(403|404|Forbidden|error sending request|dns error)/is;

let failed = 0;
let blocked = 0;
for (const boundary of boundaries) {
  if (boundary.files.length === 0) continue;
  process.stdout.write(
    `\n── deno check [${boundary.name}] — ${boundary.files.length} file(s) ──\n`,
  );
  const result = spawnSync(
    'deno',
    ['check', '--config', CONFIG, '--node-modules-dir=none', ...boundary.files],
    { encoding: 'utf8' },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(output);

  const status = result.status ?? 1;
  if (status === 0) {
    process.stdout.write(`[${boundary.name}] exit 0 — clean\n`);
    continue;
  }

  if (REGISTRY_UNREACHABLE.test(output)) {
    blocked += 1;
    process.stdout.write(
      `[${boundary.name}] BLOCKED — a module registry is unreachable from this environment.\n` +
        `  This is an egress restriction, NOT a type error: the checker could not download\n` +
        `  a dependency's manifest, so it never got as far as checking the source. Re-run\n` +
        `  where jsr.io and registry.npmjs.org are reachable to complete this boundary.\n`,
    );
    continue;
  }

  failed += 1;
  process.stdout.write(`[${boundary.name}] exit ${status} — type errors\n`);
}

if (blocked > 0) {
  process.stdout.write(
    `\n${blocked} boundary/boundaries could not be checked (registry unreachable).\n`,
  );
}

// A blocked boundary still exits non-zero: an unverified boundary must not read
// as a passing one. The message above is what distinguishes it from a failure.
process.exit(failed === 0 && blocked === 0 ? 0 : 1);
