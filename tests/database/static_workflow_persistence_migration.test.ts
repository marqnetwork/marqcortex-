/**
 * BP-003 / A2 — the workflow persistence migration, read as text.
 *
 * The same division of labour the durable runtime's static test describes:
 * this proves the migration DECLARES what BP-003 requires, and
 * `npm run test:database:workflow-persistence` proves those declarations hold
 * against a real PostgreSQL. This is the cheap check that runs everywhere.
 *
 * IT EXISTS TO CATCH A CONSTRAINT DELETED, not to claim a constraint is right.
 *
 * Four things it guards that no runtime test can reach without a database, and
 * every one of them is load-bearing:
 *
 *   THE COMPARE-AND-SWAP PREDICATE. Drop `run_version = p_expected_version`
 *   from the save and every in-memory test still passes while two isolates
 *   begin advancing one run. A source scan is a weak proof of behaviour and a
 *   strong proof of absence, which is the shape of this claim.
 *
 *   THE APPEND-ONLY TRIGGER. The checkpoint port has no `save` and no
 *   `delete`, and the boundary scan asserts their absence — but that is a
 *   statement about the runtime. The digest chain is a claim about what was
 *   never edited by ANYTHING, and only the trigger makes it one.
 *
 *   THE TENANT-SAFE COMPOSITE FOREIGN KEYS. A checkpoint or approval FK that
 *   carried only `workflow_run_id` would make a cross-tenant reference
 *   representable, and it would be detected — if at all — by whichever runtime
 *   check happened to look.
 *
 *   THE ABSENCE OF A CUTOVER. No migration in this packet may touch the
 *   key-value store, and the rollback must leave it, its compare-and-swap
 *   function and the BP-002 durable runtime alone. Every workflow record the
 *   platform has is still in the one and depends on the other.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const TABLES = read('supabase/migrations/20260921120000_cortex_workflow_persistence.sql');
const RLS = read('supabase/migrations/20260921120001_cortex_workflow_persistence_rls.sql');
const FUNCTIONS = read('supabase/migrations/20260921120002_cortex_workflow_persistence_functions.sql');
const ROLLBACK = read('supabase/migrations/rollbacks/20260921120000_rollback_workflow_persistence.sql');

/** These migrations explain at length what they must NOT do. */
const body = (sql: string) => sql.replace(/^\s*--.*$/gm, '');

const WORKFLOW_TABLES = ['workflow_runs', 'workflow_checkpoints', 'workflow_approvals'];

const FUNCTION_NAMES = [
  'workflow_run_create',
  'workflow_run_save',
  'workflow_run_load',
  'workflow_run_list',
  'workflow_checkpoint_append',
  'workflow_checkpoint_read',
  'workflow_checkpoint_latest',
  'workflow_checkpoint_history',
  'workflow_approval_create',
  'workflow_approval_save',
  'workflow_approval_load',
  'workflow_approval_list',
];

describe('the three workflow persistence tables exist', () => {
  it('declares every table BP-003 requires', () => {
    for (const table of WORKFLOW_TABLES) {
      assert.match(
        TABLES,
        new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`),
        `${table} is not declared`,
      );
    }
  });

  it('carries the tenant in the primary key of every table', () => {
    // Not "has an organization_id column" — the tenant is IN the key, which is
    // what makes every foreign key that references it carry the tenant too.
    assert.match(TABLES, /CONSTRAINT workflow_runs_pk PRIMARY KEY \(organization_id, workflow_run_id\)/);
    assert.match(
      TABLES,
      /CONSTRAINT workflow_checkpoints_pk\s*\n?\s*PRIMARY KEY \(organization_id, workflow_run_id, version\)/,
    );
    assert.match(
      TABLES,
      /CONSTRAINT workflow_approvals_pk\s*\n?\s*PRIMARY KEY \(organization_id, workflow_approval_id\)/,
    );
  });

  it('roots every run in a real organization', () => {
    assert.match(
      TABLES,
      /organization_id\s+UUID NOT NULL REFERENCES public\.organizations\(id\) ON DELETE CASCADE/,
    );
  });

  it('makes a cross-tenant reference unrepresentable rather than detected', () => {
    // Both composite. An FK carrying only the run id would let one tenant's
    // checkpoint name another tenant's run.
    for (const constraint of ['workflow_checkpoints_run_fk', 'workflow_approvals_run_fk']) {
      assert.match(
        TABLES,
        new RegExp(
          `CONSTRAINT ${constraint}\\s*\\n?\\s*FOREIGN KEY \\(organization_id, workflow_run_id\\)` +
            `\\s*\\n?\\s*REFERENCES public\\.workflow_runs \\(organization_id, workflow_run_id\\)`,
        ),
        `${constraint} is not tenant-safe`,
      );
    }
  });

  it('constrains the state vocabularies to what the engine can produce', () => {
    for (const state of [
      'created', 'validating', 'ready', 'running', 'waiting_for_agent',
      'waiting_for_branches', 'waiting_for_approval', 'paused', 'completed',
      'failed', 'cancelled', 'expired', 'policy_denied',
    ]) {
      assert.ok(
        new RegExp(`workflow_runs_state_check[\\s\\S]{0,600}'${state}'`).test(TABLES),
        `the run state ${state} is missing from the CHECK`,
      );
    }
    for (const state of ['pending', 'approved', 'rejected', 'expired', 'withdrawn', 'consumed']) {
      assert.ok(
        new RegExp(`workflow_approvals_state_check[\\s\\S]{0,400}'${state}'`).test(TABLES),
        `the approval state ${state} is missing from the CHECK`,
      );
    }
  });

  it('refuses a row whose columns disagree with its own payload', () => {
    // The projection is an index-reachable copy of facts that are also in the
    // record. A row where the two differ is a compare-and-swap arbitrating a
    // number nothing else reads.
    assert.match(TABLES, /CONSTRAINT workflow_runs_record_agrees CHECK/);
    assert.match(TABLES, /CONSTRAINT workflow_checkpoints_record_agrees CHECK/);
    assert.match(TABLES, /CONSTRAINT workflow_approvals_record_agrees CHECK/);
  });

  it('compares every projected field NULL-safely, because a NULL CHECK PASSES', () => {
    // THE DEFECT THIS ASSERTION EXISTS FOR. `record ->> 'k' = col` is NULL
    // when the key is absent, and PostgreSQL treats a NULL CHECK as satisfied
    // — so the agreement constraints, written with `=`, would have admitted a
    // record with no identity, no tenant and no version at all. Every
    // comparison must be `IS NOT DISTINCT FROM`, which is FALSE against a NOT
    // NULL column.
    const agreements = TABLES.match(
      /CONSTRAINT workflow_\w+_record_agrees CHECK \(([\s\S]*?)\n  \),/g,
    ) ?? [];
    assert.equal(agreements.length, 3, 'all three agreement constraints must exist');
    for (const block of agreements) {
      const lines = body(block)
        .split('\n')
        .filter((line) => /record\s*(->>|->|#>>)/.test(line));
      assert.ok(lines.length >= 6, `an agreement constraint compares only ${lines.length} fields`);
      for (const line of lines) {
        assert.match(
          line,
          /IS NOT DISTINCT FROM/,
          `a projected field is compared with an operator that passes on a missing key: ${line.trim()}`,
        );
      }
    }

    // The specific fields the review named, each present and each NULL-safe.
    for (const field of [
      /record #>> '\{context,workflowRunId\}'\s+IS NOT DISTINCT FROM workflow_run_id/,
      /record #>> '\{context,organizationId\}' IS NOT DISTINCT FROM organization_id::text/,
      /record #>> '\{context,workflowId\}'\s+IS NOT DISTINCT FROM workflow_id/,
      /record #>> '\{context,actorId\}'\s+IS NOT DISTINCT FROM actor_id/,
      /record ->> 'runVersion'\s+IS NOT DISTINCT FROM run_version::text/,
      /record ->> 'checkpointVersion'\s+IS NOT DISTINCT FROM checkpoint_version::text/,
      /record ->> 'organizationId'\s+IS NOT DISTINCT FROM organization_id::text/,
      /record ->> 'previousDigest' IS NOT DISTINCT FROM previous_digest/,
      /record ->> 'branchId'\s+IS NOT DISTINCT FROM branch_id/,
    ]) {
      assert.match(TABLES, field, `a required projected field is not compared NULL-safely`);
    }

    // `singleUse` must be ACTUAL true. The `::text = 'true'` form is NULL for
    // a missing key, so the one field stating a guarantee about itself could
    // have been omitted entirely.
    assert.match(TABLES, /record -> 'singleUse'\s+IS NOT DISTINCT FROM 'true'::jsonb/);
    assert.doesNotMatch(body(TABLES), /\(record -> 'singleUse'\)::text = 'true'/);

    // And no agreement comparison may be a bare equality anywhere.
    assert.doesNotMatch(
      body(TABLES),
      /record\s*(->>|#>>)\s*'[^']*'\s*=\s*\w/,
      'a projected field is still compared with bare equality',
    );
  });

  it('bounds every payload', () => {
    for (const constraint of [
      'workflow_runs_record_bounded',
      'workflow_checkpoints_record_bounded',
      'workflow_approvals_record_bounded',
    ]) {
      assert.match(
        TABLES,
        new RegExp(`CONSTRAINT ${constraint} CHECK \\(pg_column_size\\(record\\) <= \\d+\\)`),
        `${constraint} is missing, so this table has no ceiling`,
      );
    }
  });

  it('keeps the checkpoint chain coherent', () => {
    assert.match(TABLES, /CONSTRAINT workflow_checkpoints_chain_coherent[\s\S]{0,200}version = 1/);
  });

  it('admits every approval state the gate can actually produce', () => {
    // THE OTHER DEFECT THIS FILE EXISTS FOR. The first version of this
    // constraint read "(state = 'pending') = (both stamps absent)", which
    // quietly requires every NON-pending state to carry a stamp. `expired` and
    // `withdrawn` carry neither — `workflowApprovalGate.close()` leaves both
    // untouched because neither closure is a decision — so `expireIfDue()` and
    // `withdraw()` could not be persisted at all.
    const lifecycle =
      /CONSTRAINT workflow_approvals_lifecycle_coherent CHECK \(([\s\S]*?)\n  \),/.exec(TABLES);
    assert.ok(lifecycle, 'the approval lifecycle constraint must exist');
    const block = lifecycle[1];

    // The six states, each with the stamps `contracts/approval.ts` gives it.
    for (const [state, shape] of [
      ['pending', 'decided_at IS NULL     AND consumed_at IS NULL'],
      ['expired', 'decided_at IS NULL     AND consumed_at IS NULL'],
      ['withdrawn', 'decided_at IS NULL     AND consumed_at IS NULL'],
      ['approved', 'decided_at IS NOT NULL AND consumed_at IS NULL'],
      ['rejected', 'decided_at IS NOT NULL AND consumed_at IS NULL'],
      ['consumed', 'decided_at IS NOT NULL AND consumed_at IS NOT NULL'],
    ] as const) {
      assert.ok(
        new RegExp(`WHEN '${state}'\\s+THEN ${shape.replace(/\s+/g, '\\s+')}`).test(block),
        `the lifecycle constraint does not admit ${state} with the stamps the gate gives it`,
      );
    }

    // A state the table has not been taught is refused, not waved through.
    assert.match(block, /ELSE FALSE/);

    // And the broken formulation is gone for good.
    assert.doesNotMatch(body(TABLES), /workflow_approvals_decision_coherent/);
    assert.doesNotMatch(
      body(TABLES),
      /\(approval_state = 'pending'\) = \(decided_at IS NULL/,
      'the constraint that refused expired and withdrawn is back',
    );
  });

  it('declares the append-only trigger, which the port\'s missing methods cannot', () => {
    assert.match(TABLES, /CREATE OR REPLACE FUNCTION cortex\.refuse_checkpoint_mutation\(\)/);
    assert.match(TABLES, /RAISE EXCEPTION[\s\S]{0,200}append-only/);
    assert.match(
      TABLES,
      /CREATE TRIGGER workflow_checkpoints_append_only\s*\n?\s*BEFORE UPDATE ON public\.workflow_checkpoints/,
    );
  });

  it('indexes the orderings and filters the ports actually use', () => {
    for (const index of [
      'workflow_runs_org_recent_idx',
      'workflow_runs_org_state_recent_idx',
      'workflow_runs_org_workflow_recent_idx',
      'workflow_runs_org_actor_recent_idx',
      'workflow_checkpoints_run_version_idx',
      'workflow_approvals_pending_queue_idx',
      'workflow_approvals_org_oldest_idx',
      'workflow_approvals_run_oldest_idx',
    ]) {
      assert.match(TABLES, new RegExp(`CREATE INDEX IF NOT EXISTS ${index}\\b`), `${index} is missing`);
    }
    // The operator queue index is partial — a tenant's decided approvals are
    // rows the queue never wants.
    assert.match(
      TABLES,
      /workflow_approvals_pending_queue_idx[\s\S]{0,200}WHERE approval_state = 'pending'/,
    );
  });
});

describe('the workflow tables have no client-facing path at all', () => {
  it('enables AND forces row level security on all three tables', () => {
    assert.match(RLS, /ENABLE ROW LEVEL SECURITY/);
    // FORCE, so the table owner is not silently exempt — without it the
    // isolation holds for everybody except the connection most likely to be
    // used to check it.
    assert.match(RLS, /FORCE ROW LEVEL SECURITY/);
    for (const table of WORKFLOW_TABLES) {
      assert.ok(RLS.includes(`'${table}'`), `${table} is not in the RLS loop`);
    }
  });

  it('creates no policy, of any kind, for any role', () => {
    // BP-003 replaces storage under three existing ports. The workflow SERVICE
    // is the authorization surface for workflow state; a second read path
    // straight to the rows is an API decision, and it would have arrived
    // inside a persistence-parity change nobody reviewed as an API change.
    //
    // With RLS forced and no policy present, the tables deny by default —
    // there is nothing to get the predicate wrong in.
    assert.doesNotMatch(body(RLS), /CREATE POLICY/);
    // And the draft's policy is actively dropped, so re-running this migration
    // over a database that received the earlier version cleans it up.
    assert.match(RLS, /DROP POLICY IF EXISTS %I_select_workflows/);
  });

  it('grants anon and authenticated nothing, and the runtime everything', () => {
    assert.match(RLS, /REVOKE ALL ON public\.%I FROM PUBLIC/);
    assert.match(RLS, /REVOKE ALL ON public\.%I FROM anon/);
    assert.match(RLS, /REVOKE ALL ON public\.%I FROM authenticated/);
    assert.match(RLS, /GRANT ALL ON public\.%I TO service_role/);
    // THE ASSERTION THAT MATTERS. Not "no write grant" — NO GRANT.
    assert.doesNotMatch(
      body(RLS),
      /GRANT [^;]*\bTO (anon|authenticated)\b/,
      'BP-003 grants a client role direct access to workflow state',
    );
  });

  it('mints no permission key, so its rollback has none to delete', () => {
    // A key with no policy behind it is a grant that looks meaningful and
    // governs nothing — and a key created with `WHERE NOT EXISTS` is a key a
    // rollback cannot prove it owns.
    assert.doesNotMatch(body(RLS), /INSERT INTO public\.permissions/);
    assert.doesNotMatch(body(RLS), /INSERT INTO public\.role_permissions/);
    assert.doesNotMatch(body(RLS), /workflows\.read|workflows\.operate/);
  });
});

describe('the atomic operations are atomic', () => {
  it('declares all twelve functions', () => {
    for (const fn of FUNCTION_NAMES) {
      assert.match(
        FUNCTIONS,
        new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`),
        `${fn} is not declared`,
      );
    }
  });

  it('scopes every function by organization, in its body and not only its name', () => {
    // The three inserting functions carry the tenant into the row and into the
    // conflict target; the nine others carry it into a predicate. Both are the
    // same claim — there is no argument through which a caller holding one
    // tenant's context reaches another tenant's row — and asserting only the
    // predicate form would quietly exempt exactly the functions that WRITE.
    const INSERTERS = new Set([
      'workflow_run_create',
      'workflow_checkpoint_append',
      'workflow_approval_create',
    ]);
    for (const fn of FUNCTION_NAMES) {
      const block = new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.${fn}\\([\\s\\S]*?\\n\\$\\$;`,
      ).exec(FUNCTIONS);
      assert.ok(block, `${fn}'s body could not be read`);
      assert.match(block[0], /p_organization_id\s+UUID/, `${fn} does not take an organization`);
      if (INSERTERS.has(fn)) {
        assert.match(
          block[0],
          /VALUES \(\s*\n?\s*p_organization_id,/,
          `${fn} does not write the caller's organization onto the row`,
        );
        assert.match(
          block[0],
          /ON CONFLICT \(organization_id,/,
          `${fn}'s conflict target is not tenant-scoped, so one tenant's id could collide with another's`,
        );
      } else {
        assert.match(
          block[0],
          /organization_id\s*=\s*p_organization_id/,
          `${fn} does not scope its predicate by organization`,
        );
      }
      // And no function may be reached with a NULL tenant.
      assert.match(
        block[0],
        /IF p_organization_id IS NULL THEN\s*\n?\s*RAISE EXCEPTION/,
        `${fn} does not refuse a missing organization`,
      );
    }
  });

  it('makes the run save a compare-and-swap and not a read-then-write', () => {
    // THE PREDICATE. Without it, two isolates that both read version N both
    // write N+1 and the second overwrites the first.
    const save = /CREATE OR REPLACE FUNCTION public\.workflow_run_save\([\s\S]*?\n\$\$;/.exec(
      FUNCTIONS,
    );
    assert.ok(save);
    assert.match(save[0], /UPDATE public\.workflow_runs/);
    assert.match(save[0], /r\.run_version\s*=\s*p_expected_version/);
    // The classifying read comes AFTER the write has already lost, so it can
    // never turn a loss into a win.
    assert.ok(
      save[0].indexOf('UPDATE public.workflow_runs') < save[0].indexOf('IF EXISTS ('),
      'the run save reads before it writes',
    );
  });

  it('makes the approval save the single-use guarantee', () => {
    const save = /CREATE OR REPLACE FUNCTION public\.workflow_approval_save\([\s\S]*?\n\$\$;/.exec(
      FUNCTIONS,
    );
    assert.ok(save);
    assert.match(save[0], /a\.approval_version\s*=\s*p_expected_version/);
  });

  it('makes creation insert-if-absent, never an upsert', () => {
    for (const fn of ['workflow_run_create', 'workflow_approval_create', 'workflow_checkpoint_append']) {
      const block = new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.${fn}\\([\\s\\S]*?\\n\\$\\$;`,
      ).exec(FUNCTIONS);
      assert.ok(block, `${fn}'s body could not be read`);
      assert.match(block[0], /ON CONFLICT[\s\S]{0,80}DO NOTHING/, `${fn} is not insert-if-absent`);
      // DO UPDATE would silently overwrite a live run, a pending decision or a
      // written checkpoint.
      assert.doesNotMatch(body(block[0]), /DO UPDATE/, `${fn} upserts`);
    }
  });

  it('never lets a listing sort in the database and then truncate', () => {
    // PostgreSQL cannot reproduce `localeCompare`, so the domain sorts — and
    // WITH TIES is what stops the SQL limit cutting a row the domain sort
    // would have kept.
    assert.match(FUNCTIONS, /ORDER BY r\.created_at DESC\s*\n?\s*FETCH FIRST v_limit ROWS WITH TIES/);
    assert.match(FUNCTIONS, /ORDER BY a\.created_at ASC\s*\n?\s*FETCH FIRST v_limit ROWS WITH TIES/);
  });

  it('bounds every listing at the ports\' own ceiling', () => {
    const clamps = FUNCTIONS.match(/LEAST\(GREATEST\(COALESCE\(p_limit, 50\), 1\), 200\)/g) ?? [];
    assert.equal(clamps.length, 2, 'a listing does not clamp its limit');
  });

  it('leaves the checkpoint history unbounded, because the run bounds it', () => {
    const history =
      /CREATE OR REPLACE FUNCTION public\.workflow_checkpoint_history\([\s\S]*?\n\$\$;/.exec(
        FUNCTIONS,
      );
    assert.ok(history);
    // A limit here could only truncate a chain the key-value store returns
    // whole, and a silently short chain is one that verifies and is not the one
    // the run wrote.
    assert.doesNotMatch(body(history[0]), /LIMIT|FETCH FIRST/);
    assert.match(history[0], /ORDER BY c\.version ASC/);
  });

  it('runs as the definer and is executable only by the runtime', () => {
    // Counted over the body, not the file: the header explains at length what
    // SECURITY DEFINER does and does not mean, and a comment is not a function.
    const definers = body(FUNCTIONS).match(/SECURITY DEFINER/g) ?? [];
    assert.equal(definers.length, FUNCTION_NAMES.length);
    const searchPaths = FUNCTIONS.match(/SET search_path = public/g) ?? [];
    assert.equal(searchPaths.length, FUNCTION_NAMES.length);
    for (const fn of FUNCTION_NAMES) {
      assert.match(
        FUNCTIONS,
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(`),
        `${fn} is not revoked from PUBLIC`,
      );
      assert.match(
        FUNCTIONS,
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role`),
        `${fn} is not granted to the runtime`,
      );
    }
  });
});

describe('BP-003 is not a cutover, and the migrations say so', () => {
  it('touches no key-value row, in any direction', () => {
    // THE SAFETY POSITION OF THE PACKET. A workflow record inserted, updated or
    // deleted by one of these files would be a cutover wearing a schema
    // change's clothes.
    for (const [name, sql] of [
      ['tables', TABLES],
      ['rls', RLS],
      ['functions', FUNCTIONS],
      ['rollback', ROLLBACK],
    ] as const) {
      const statements = body(sql).match(
        /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|DROP\s+TABLE|TRUNCATE)\b[^\n;]*/gi,
      ) ?? [];
      for (const statement of statements) {
        assert.doesNotMatch(
          statement,
          /kv_store|kv_compare_and_swap/i,
          `the ${name} migration touches the key-value store: ${statement.slice(0, 120)}`,
        );
      }
    }
  });

  it('adds no switch that could make SQL the authority', () => {
    const all = body(TABLES) + body(RLS) + body(FUNCTIONS);
    assert.doesNotMatch(all, /current_setting\(\s*'app\./i);
    assert.doesNotMatch(all, /\bshadow\b|\bcutover\b|\bbackfill\b/i);
  });

  it('rolls back only what this packet added', () => {
    for (const table of WORKFLOW_TABLES) {
      assert.match(ROLLBACK, new RegExp(`DROP TABLE IF EXISTS public\\.${table};`));
    }
    for (const fn of FUNCTION_NAMES) {
      assert.match(ROLLBACK, new RegExp(`DROP FUNCTION IF EXISTS public\\.${fn}\\(`));
    }
    assert.match(ROLLBACK, /DROP FUNCTION IF EXISTS cortex\.refuse_checkpoint_mutation\(\)/);
  });

  it('deletes no row it cannot prove it created', () => {
    // THE THIRD DEFECT THIS FILE EXISTS FOR. An earlier draft deleted the
    // permission keys `workflows.read` and `workflows.operate` and their role
    // grants. The forward migration created those with `WHERE NOT EXISTS`, so
    // a row with that key may have been there first — and a rollback cannot
    // tell the two apart. Run against a database where something else already
    // owned the key, it would have removed a permission and every grant
    // hanging off it, to undo a packet that had not created them.
    //
    // What remains is exactly what BP-003 brings into existence with an
    // unconditional CREATE: three tables, twelve functions, one trigger
    // function.
    const rollback = body(ROLLBACK);
    assert.doesNotMatch(rollback, /\bDELETE\s+FROM\b/i, 'the rollback deletes rows');
    assert.doesNotMatch(rollback, /\bUPDATE\b/i, 'the rollback mutates rows');
    assert.doesNotMatch(rollback, /\bTRUNCATE\b/i);
    assert.doesNotMatch(rollback, /public\.permissions|public\.role_permissions/);
  });

  it('never cascades, and never drops anything that holds live state', () => {
    // A CASCADE hides a table the rollback forgot rather than failing on it.
    assert.doesNotMatch(body(ROLLBACK), /DROP TABLE[^;]*CASCADE/i);
    // And nothing here may remove the store every workflow record is actually
    // in, the concurrency primitive every existing store depends on, the
    // tenancy foundation, or BP-002's durable runtime.
    for (const forbidden of [
      'kv_store_324f4fbe',
      'kv_compare_and_swap',
      'organizations',
      'organization_memberships',
      'durable_jobs',
      'durable_outbox',
    ]) {
      assert.doesNotMatch(
        body(ROLLBACK),
        new RegExp(`DROP (TABLE|FUNCTION)[^;]*${forbidden}`, 'i'),
        `the rollback removes ${forbidden}`,
      );
    }
  });

  it('drops the trigger function after the table whose trigger used it', () => {
    assert.ok(
      ROLLBACK.indexOf('DROP TABLE IF EXISTS public.workflow_checkpoints;') <
        ROLLBACK.indexOf('DROP FUNCTION IF EXISTS cortex.refuse_checkpoint_mutation()'),
      'the trigger function is dropped before the table that depends on it',
    );
  });
});
