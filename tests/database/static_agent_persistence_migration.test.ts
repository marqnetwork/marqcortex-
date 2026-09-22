/**
 * A2-P07 — the agent persistence migration, read as text.
 *
 * The same division of labour as `static_workflow_persistence_migration.test.ts`:
 * this proves the migration DECLARES what the agent SQL authority requires, and
 * `npm run test:database:agent-persistence` proves those declarations hold
 * against a real PostgreSQL. It exists to catch a constraint deleted, not to
 * claim a constraint is right.
 *
 * It also pins the places the agent tables DELIBERATELY differ from the
 * workflow tables, because those are the places a later "consistency" edit is
 * most likely to copy the workflow rule back in and break a write the agent
 * runtime makes today.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const TABLES = read('supabase/migrations/20260922120000_cortex_agent_persistence.sql');
const RLS = read('supabase/migrations/20260922120001_cortex_agent_persistence_rls.sql');
const ROLLBACK = read('supabase/migrations/rollbacks/20260922120000_rollback_agent_persistence.sql');

/** These migrations explain at length what they must NOT do. */
const body = (sql: string) => sql.replace(/^\s*--.*$/gm, '');

const AGENT_TABLES = ['agent_runs', 'agent_checkpoints', 'agent_approvals'];

/** Verbatim from `ai/agents/contracts/runtime.ts`. */
const AGENT_RUN_STATES = [
  'created', 'validating', 'planned', 'waiting_for_budget', 'running', 'waiting_for_tool',
  'waiting_for_agent', 'waiting_for_approval', 'paused', 'retrying', 'completed', 'failed',
  'cancelled', 'expired', 'budget_exhausted', 'policy_denied',
];

function constraint(sql: string, name: string): string {
  const start = sql.indexOf(`CONSTRAINT ${name}`);
  assert.ok(start >= 0, `${name} is not declared`);
  // To the next top-level constraint or the end of the table.
  const rest = sql.slice(start + name.length);
  const end = rest.search(/\n\s*CONSTRAINT |\n\);/);
  return rest.slice(0, end === -1 ? undefined : end);
}

describe('the three agent persistence tables exist', () => {
  it('declares every table', () => {
    for (const table of AGENT_TABLES) {
      assert.match(TABLES, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`));
    }
  });

  it('carries the tenant in the primary key of every table', () => {
    assert.match(TABLES, /agent_runs_pk PRIMARY KEY \(organization_id, agent_run_id\)/);
    assert.match(TABLES, /agent_checkpoints_pk\s+PRIMARY KEY \(organization_id, agent_run_id, version\)/);
    assert.match(TABLES, /agent_approvals_pk\s+PRIMARY KEY \(organization_id, agent_approval_id\)/);
  });

  it('roots every run in a real organization', () => {
    assert.match(
      TABLES,
      /organization_id\s+UUID NOT NULL REFERENCES public\.organizations\(id\) ON DELETE CASCADE,\s*\n[\s\S]*?agent_run_id\s+TEXT NOT NULL/,
    );
  });

  it('makes a cross-tenant reference unrepresentable rather than detected', () => {
    for (const fk of ['agent_checkpoints_run_fk', 'agent_approvals_run_fk']) {
      assert.match(
        TABLES,
        new RegExp(
          `${fk}\\s+FOREIGN KEY \\(organization_id, agent_run_id\\)\\s+REFERENCES public\\.agent_runs \\(organization_id, agent_run_id\\)`,
        ),
        `${fk} must carry the tenant`,
      );
    }
  });

  it('constrains run and checkpoint state to exactly the sixteen agent states', () => {
    for (const name of ['agent_runs_state_check', 'agent_checkpoints_state_check']) {
      const check = constraint(TABLES, name);
      const declared = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
      assert.deepEqual(declared, [...AGENT_RUN_STATES].sort(), name);
    }
  });

  it('constrains approval state to the five states the agent gate can produce — no withdrawn', () => {
    const check = constraint(TABLES, 'agent_approvals_state_check');
    const declared = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(declared, ['approved', 'consumed', 'expired', 'pending', 'rejected']);
  });

  it('compares every projected authority field NULL-safely, tenant included', () => {
    const runs = constraint(TABLES, 'agent_runs_record_agrees');
    for (const field of ["'{context,runId}'", "'{context,organizationId}'", "'{context,agentId}'",
      "'{context,actorId}'", "'state'", "'runVersion'", "'checkpointVersion'"]) {
      assert.ok(runs.includes(field), `agent_runs_record_agrees omits ${field}`);
    }
    const checkpoints = constraint(TABLES, 'agent_checkpoints_record_agrees');
    for (const field of ['organizationId', 'runId', 'version', 'progressDigest', 'previousDigest',
      'agentId', 'state', 'stepCount']) {
      assert.ok(checkpoints.includes(`'${field}'`), `agent_checkpoints_record_agrees omits ${field}`);
    }
    const approvals = constraint(TABLES, 'agent_approvals_record_agrees');
    for (const field of ['organizationId', 'approvalId', 'runId', 'actionId', 'requestingAgentId',
      'state', 'approvalVersion', 'decidedAt', 'consumedAt', 'expiresAt', 'singleUse']) {
      assert.ok(approvals.includes(`'${field}'`), `agent_approvals_record_agrees omits ${field}`);
    }
    // No bare `=` between a JSON extraction and a column: a missing key would
    // make that NULL, and a NULL CHECK passes.
    for (const check of [runs, checkpoints, approvals]) {
      assert.doesNotMatch(body(check), /->>\s*'[A-Za-z]+'\s*=\s*[a-z_]+(::text)?\b(?!\s*IS)/);
      assert.match(check, /organization_id::text/, 'the tenant must be compared, not merely required');
    }
    assert.match(approvals, /record -> 'singleUse'\s+IS NOT DISTINCT FROM 'true'::jsonb/);
  });

  it('bounds every payload', () => {
    assert.match(TABLES, /agent_runs_record_bounded CHECK \(pg_column_size\(record\) <= \d+\)/);
    assert.match(TABLES, /agent_checkpoints_record_bounded CHECK \(pg_column_size\(record\) <= \d+\)/);
    assert.match(TABLES, /agent_approvals_record_bounded CHECK \(pg_column_size\(record\) <= \d+\)/);
  });

  it('admits every approval transition the agent gate writes, including expired-after-spent', () => {
    const lifecycle = constraint(TABLES, 'agent_approvals_lifecycle_coherent');
    assert.match(lifecycle, /WHEN 'pending'\s+THEN decided_at IS NULL\s+AND consumed_at IS NULL/);
    assert.match(lifecycle, /WHEN 'approved'\s+THEN decided_at IS NOT NULL AND consumed_at IS NULL/);
    assert.match(lifecycle, /WHEN 'rejected'\s+THEN decided_at IS NOT NULL AND consumed_at IS NULL/);
    assert.match(lifecycle, /WHEN 'consumed'\s+THEN decided_at IS NOT NULL AND consumed_at IS NOT NULL/);
    // `expire()` stamps decidedAt and leaves consumedAt as it found it.
    assert.match(lifecycle, /WHEN 'expired'\s+THEN decided_at IS NOT NULL\s*\n/);
    assert.match(lifecycle, /ELSE FALSE/);
  });

  it('does NOT copy the workflow chain rule, which the agent runtime never promised', () => {
    assert.doesNotMatch(body(TABLES), /version = 1\) = \(previous_digest IS NULL\)/);
  });

  it('declares its OWN append-only trigger function, not the workflow one', () => {
    assert.match(TABLES, /CREATE OR REPLACE FUNCTION cortex\.refuse_agent_checkpoint_mutation\(\)/);
    assert.match(
      TABLES,
      /CREATE TRIGGER agent_checkpoints_append_only\s+BEFORE UPDATE ON public\.agent_checkpoints\s+FOR EACH ROW EXECUTE FUNCTION cortex\.refuse_agent_checkpoint_mutation\(\)/,
    );
    assert.doesNotMatch(body(TABLES), /cortex\.refuse_checkpoint_mutation\(/);
  });

  it('indexes the orderings and filters the ports use — approvals newest first', () => {
    for (const index of [
      /agent_runs \(organization_id, created_at DESC\)/,
      /agent_runs \(organization_id, state, created_at DESC\)/,
      /agent_runs \(organization_id, agent_id, created_at DESC\)/,
      /agent_runs \(organization_id, actor_id, created_at DESC\)/,
      /agent_checkpoints \(organization_id, agent_run_id, version\)/,
      /agent_approvals \(organization_id, created_at DESC\)\s+WHERE approval_state = 'pending'/,
      /agent_approvals \(organization_id, agent_run_id, created_at DESC\)/,
    ]) {
      assert.match(TABLES, index);
    }
  });

  it('adds no foreign key into the workflow tables — the two domains cut over separately', () => {
    assert.doesNotMatch(body(TABLES), /REFERENCES public\.workflow_/);
  });
});

describe('the agent tables have no client-facing path at all', () => {
  it('enables AND forces row level security on all three tables', () => {
    for (const table of AGENT_TABLES) assert.ok(RLS.includes(`'${table}'`));
    assert.match(RLS, /ENABLE ROW LEVEL SECURITY/);
    assert.match(RLS, /FORCE ROW LEVEL SECURITY/);
  });

  it('creates no policy, of any kind', () => {
    assert.doesNotMatch(body(RLS), /CREATE POLICY/i);
  });

  it('grants anon and authenticated nothing, and the runtime everything', () => {
    assert.match(RLS, /REVOKE ALL ON public\.%I FROM anon/);
    assert.match(RLS, /REVOKE ALL ON public\.%I FROM authenticated/);
    assert.match(RLS, /GRANT ALL ON public\.%I TO service_role/);
    assert.doesNotMatch(body(RLS), /GRANT [^;]* TO (anon|authenticated)/);
  });

  it('mints no permission key', () => {
    assert.doesNotMatch(body(RLS + TABLES), /INSERT INTO public\.permissions/);
  });
});

describe('A2-P07 is not a cutover, and the migrations say so', () => {
  it('touches no key-value row', () => {
    assert.doesNotMatch(body(TABLES + RLS + ROLLBACK), /kv_store_324f4fbe/);
  });

  it('rolls back only what this phase added, in reverse dependency order, without CASCADE', () => {
    const rb = body(ROLLBACK);
    assert.doesNotMatch(rb, /CASCADE/);
    const order = ['public.agent_approvals', 'public.agent_checkpoints', 'public.agent_runs']
      .map((table) => rb.indexOf(`DROP TABLE IF EXISTS ${table}`));
    assert.ok(order.every((i) => i >= 0), 'every agent table is dropped');
    assert.ok(order[0] < order[1] && order[1] < order[2], 'children before parents');
    assert.ok(
      rb.indexOf('DROP FUNCTION IF EXISTS cortex.refuse_agent_checkpoint_mutation()') > order[2],
      'the trigger function goes after the table whose trigger used it',
    );
    assert.doesNotMatch(rb, /workflow_|refuse_checkpoint_mutation\(|durable_|DELETE FROM|kv_/);
  });
});

const FUNCTIONS = read('supabase/migrations/20260922120002_cortex_agent_persistence_functions.sql');

const FUNCTION_NAMES = [
  'agent_run_create', 'agent_run_save', 'agent_run_load', 'agent_run_list',
  'agent_checkpoint_append', 'agent_checkpoint_read', 'agent_checkpoint_latest',
  'agent_checkpoint_history', 'agent_approval_create', 'agent_approval_save',
  'agent_approval_load', 'agent_approval_list',
];

function fnBody(name: string): string {
  const start = FUNCTIONS.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0, `${name} is not declared`);
  const end = FUNCTIONS.indexOf('$$;', FUNCTIONS.indexOf('AS $$', start));
  return FUNCTIONS.slice(start, end);
}

describe('the agent operations are atomic and tenant-scoped', () => {
  it('declares all twelve functions', () => {
    for (const name of FUNCTION_NAMES) fnBody(name);
  });

  it('refuses a NULL organization and scopes every predicate by it', () => {
    for (const name of FUNCTION_NAMES) {
      const fn = fnBody(name);
      assert.match(fn, /IF p_organization_id IS NULL THEN\s+RAISE EXCEPTION/, `${name} accepts a NULL tenant`);
      assert.match(fn, /organization_id\s+=\s+p_organization_id|VALUES \(\s*p_organization_id/, `${name} is not tenant-scoped`);
    }
  });

  it('makes both saves a compare-and-swap in ONE statement, not a read-then-write', () => {
    assert.match(fnBody('agent_run_save'), /UPDATE public\.agent_runs[\s\S]*?AND r\.run_version\s+= p_expected_version;/);
    assert.match(fnBody('agent_approval_save'), /UPDATE public\.agent_approvals[\s\S]*?AND a\.approval_version\s+= p_expected_version;/);
    for (const name of ['agent_run_save', 'agent_approval_save']) {
      const fn = body(fnBody(name));
      assert.ok(fn.indexOf('UPDATE') < fn.indexOf('SELECT'), `${name} reads before it writes`);
      assert.doesNotMatch(fn, /FOR UPDATE/);
    }
  });

  it('makes creation insert-if-absent, never an upsert', () => {
    for (const name of ['agent_run_create', 'agent_checkpoint_append', 'agent_approval_create']) {
      const fn = fnBody(name);
      assert.match(fn, /ON CONFLICT \([^)]*\) DO NOTHING/);
      assert.doesNotMatch(fn, /DO UPDATE/);
    }
  });

  it('bounds listings at the ports\' ceiling and leaves the final sort to the domain', () => {
    for (const name of ['agent_run_list', 'agent_approval_list']) {
      const fn = fnBody(name);
      assert.match(fn, /LEAST\(GREATEST\(COALESCE\(p_limit, 50\), 1\), 200\)/);
      assert.match(fn, /ORDER BY [a-z]\.created_at DESC\s+FETCH FIRST v_limit ROWS WITH TIES/);
    }
  });

  it('runs as the definer and is executable by the runtime alone', () => {
    for (const name of FUNCTION_NAMES) {
      const fn = fnBody(name);
      assert.match(fn, /SECURITY DEFINER\s+SET search_path = public/);
      assert.match(FUNCTIONS, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC;`));
      assert.match(FUNCTIONS, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO service_role;`));
    }
    assert.doesNotMatch(body(FUNCTIONS), /TO (anon|authenticated)/);
  });

  it('drops every function it creates, with the same signature, on rollback', () => {
    for (const name of FUNCTION_NAMES) {
      const grant = FUNCTIONS.match(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}(\\([^)]*\\))`));
      assert.ok(grant, `${name} has no grant`);
      assert.ok(
        ROLLBACK.includes(`DROP FUNCTION IF EXISTS public.${name}${grant[1]};`),
        `the rollback does not drop ${name}${grant[1]}`,
      );
    }
  });
});
