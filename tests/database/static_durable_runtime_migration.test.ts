/**
 * BP-002 / A1 — the durable runtime migration, read as text.
 *
 * The same division of labour the spine's and the strategic layer's static
 * tests describe: this proves the migration DECLARES what BP-002 requires, and
 * a live-PostgreSQL run would prove those declarations hold. This is the cheap
 * check that runs everywhere.
 *
 * IT EXISTS TO CATCH A CONSTRAINT DELETED, not to claim a constraint is right.
 *
 * It also guards three things no runtime test can reach in an environment with
 * no database, and all three are load-bearing:
 *
 *   THE HUMAN-ACTOR CHECK. The TypeScript refuses a human job actor and the
 *   database refuses one too. If the CHECK were dropped, every suite would
 *   still pass and the rule would hold only for callers that go through the
 *   runtime — which is every caller until the first one that does not.
 *
 *   THE CLAIM'S `FOR UPDATE SKIP LOCKED`. Replace it with a plain SELECT and
 *   the in-memory tests are unaffected while two workers begin taking the same
 *   job under concurrency. A source scan is a weak proof of behaviour and a
 *   strong one of absence, which is exactly the shape of this claim.
 *
 *   THE TWO NAMING CONTRACTS between TypeScript and SQL: the camelCase keys
 *   `settleEventsArgument` writes and `durable_job_settle` reads, and the
 *   occurrence key `occurrenceIdempotencyKey` builds and
 *   `durable_schedule_materialize_due` builds. Either pair drifting is a defect
 *   that only appears against a real database.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const TABLES = read('supabase/migrations/20260919120000_cortex_durable_runtime.sql');
const RLS = read('supabase/migrations/20260919120001_cortex_durable_runtime_rls.sql');
const FUNCTIONS = read('supabase/migrations/20260919120002_cortex_durable_runtime_functions.sql');
const ROLLBACK = read('supabase/migrations/rollbacks/20260919120000_rollback_durable_runtime.sql');

/** These migrations explain at length what they must NOT do. */
const body = (sql: string) => sql.replace(/^\s*--.*$/gm, '');

const DURABLE_TABLES = [
  'durable_jobs',
  'durable_schedules',
  'durable_outbox',
  'durable_inbox',
  'durable_dead_letters',
];

describe('the five durable tables exist', () => {
  it('declares every table A1 requires', () => {
    for (const table of DURABLE_TABLES) {
      assert.match(
        TABLES,
        new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table} \\(`),
        `public.${table} is missing`,
      );
    }
  });

  it('gives every table an organization and a composite uniqueness key', () => {
    // The property the whole tenancy model rests on — the same one the
    // organizational spine holds. `durable_inbox` is the one exception and it
    // is deliberate: nothing references an inbox row, and its own
    // `(organization_id, consumer_key, event_id)` key is stronger.
    for (const table of DURABLE_TABLES) {
      assert.match(
        TABLES,
        new RegExp(
          `${table} \\([\\s\\S]*?organization_id\\s+UUID NOT NULL REFERENCES public\\.organizations\\(id\\) ON DELETE CASCADE`,
        ),
        `${table} must be tenant-scoped by a real foreign key`,
      );
    }
    for (const table of ['durable_jobs', 'durable_schedules', 'durable_outbox', 'durable_dead_letters']) {
      assert.match(
        TABLES,
        new RegExp(`CONSTRAINT ${table}_id_org_uk UNIQUE \\(id, organization_id\\)`),
        `${table} must offer a composite key for the next table to reference`,
      );
    }
  });

  it('carries organization_id in EVERY cross-table foreign key', () => {
    const expected = [
      ['durable_jobs_schedule_same_org', 'schedule_id', 'durable_schedules'],
      ['durable_outbox_job_same_org', 'job_id', 'durable_jobs'],
      ['durable_inbox_event_same_org', 'event_id', 'durable_outbox'],
    ] as const;

    for (const [name, column, target] of expected) {
      assert.match(
        TABLES,
        new RegExp(
          `CONSTRAINT ${name}\\s*\\n?\\s*FOREIGN KEY \\(${column}, organization_id\\)\\s*\\n?\\s*REFERENCES public\\.${target} \\(id, organization_id\\)`,
        ),
        `${name} must be a composite key into ${target}`,
      );
    }
  });

  it('declares no single-column foreign key into a durable table', () => {
    // Weakening one composite key to a single column is what would let a
    // tenant boundary be crossed.
    assert.ok(
      !/FOREIGN KEY \((?:schedule_id|job_id|event_id)\)\s*\n?\s*REFERENCES/.test(body(TABLES)),
      'a single-column reference would let a cross-tenant row be written down',
    );
  });
});

describe('BP-002 §11 — a job may never act as a person', () => {
  it('refuses a human actor at the database, not only in TypeScript', () => {
    assert.match(
      body(TABLES),
      /CONSTRAINT durable_jobs_actor_not_human CHECK \(actor_type <> 'human'\)/,
    );
    assert.match(
      body(TABLES),
      /CONSTRAINT durable_schedules_actor_not_human CHECK \(actor_type <> 'human'\)/,
    );
  });

  it('omits human from the actor type vocabulary entirely', () => {
    const jobActorCheck = /durable_jobs_actor_type_check\s*\n?\s*CHECK \(actor_type IN \(([^)]*)\)\)/.exec(
      body(TABLES),
    );
    assert.ok(jobActorCheck, 'the actor type CHECK must exist');
    assert.equal(jobActorCheck[1].includes("'human'"), false);
  });

  it('keeps provenance in its own columns, separate from authority', () => {
    // Two columns, so the two can never be read as one.
    assert.match(body(TABLES), /initiated_by_actor_id\s+TEXT/);
    assert.match(body(TABLES), /actor_permissions\s+TEXT\[\] NOT NULL DEFAULT '\{\}'/);
  });
});

describe('the idempotency and uniqueness guarantees', () => {
  it('makes duplicate work impossible per tenant and job type', () => {
    assert.match(
      body(TABLES),
      /CONSTRAINT durable_jobs_idempotency_uk\s*\n?\s*UNIQUE \(organization_id, job_type, idempotency_key\)/,
    );
  });

  it('makes a duplicate consumer effect impossible at the database layer', () => {
    // BP-002 §6.5. The unique key is what makes the suppression survive two
    // isolates racing, not merely two sequential deliveries.
    assert.match(
      body(TABLES),
      /CONSTRAINT durable_inbox_once_uk UNIQUE \(organization_id, consumer_key, event_id\)/,
    );
  });

  it('allows one dead-letter row per piece of work', () => {
    assert.match(
      body(TABLES),
      /CONSTRAINT durable_dead_letters_origin_uk UNIQUE \(organization_id, origin_kind, origin_id\)/,
    );
  });

  it('gives a schedule one stable name per tenant', () => {
    assert.match(
      body(TABLES),
      /CONSTRAINT durable_schedules_key_uk UNIQUE \(organization_id, schedule_key\)/,
    );
  });
});

describe('the bounds that stop a table becoming a copy of the business', () => {
  it('caps the event payload, and caps it in bytes', () => {
    assert.match(
      body(TABLES),
      /CONSTRAINT durable_outbox_payload_bounded CHECK \(pg_column_size\(payload\) <= 16384\)/,
    );
  });

  it('caps job input and result', () => {
    assert.match(body(TABLES), /durable_jobs_input_bounded CHECK \(pg_column_size\(input\) <= 32768\)/);
    assert.match(body(TABLES), /durable_jobs_result_bounded/);
  });

  it('bounds attempts, backoff and lease TTL', () => {
    assert.match(body(TABLES), /durable_jobs_attempts_bounded/);
    assert.match(body(TABLES), /durable_jobs_backoff_bounded/);
    assert.match(body(TABLES), /durable_jobs_lease_ttl_bounded/);
  });

  it('puts a floor under a recurrence, so a schedule cannot be a retry loop', () => {
    assert.match(
      body(TABLES),
      /durable_schedules_interval_bounded CHECK \([\s\S]*?recurrence_interval_ms >= 60000/,
    );
  });

  it('keeps a lease coherent with the state beside it', () => {
    // Without this a row can be `queued` with a live lease, and get claimed twice.
    assert.match(body(TABLES), /CONSTRAINT durable_jobs_lease_coherent CHECK \(/);
  });
});

describe('the indexes the runtime actually queries by', () => {
  it('indexes the claim predicate, partially', () => {
    assert.match(
      TABLES,
      /CREATE INDEX IF NOT EXISTS durable_jobs_claimable_idx[\s\S]*?WHERE state = 'queued'/,
    );
  });

  it('indexes expired leases, for the recovery sweep', () => {
    assert.match(
      TABLES,
      /CREATE INDEX IF NOT EXISTS durable_jobs_expired_lease_idx[\s\S]*?WHERE state = 'leased'/,
    );
  });

  it('indexes the outbox backlog and its age', () => {
    assert.match(TABLES, /durable_outbox_dispatchable_idx/);
    assert.match(TABLES, /durable_outbox_backlog_idx/);
  });

  it('indexes by correlation, so a trace is one query', () => {
    assert.match(TABLES, /durable_jobs_correlation_idx/);
    assert.match(TABLES, /durable_outbox_correlation_idx/);
  });
});

describe('BP-002 §8 — the claim is atomic', () => {
  it('uses FOR UPDATE SKIP LOCKED', () => {
    // Replace this with a plain SELECT and every in-memory test still passes
    // while two workers begin taking the same job under concurrency.
    assert.match(body(FUNCTIONS), /FOR UPDATE SKIP LOCKED/);
  });

  it('bumps the lease generation on every claim', () => {
    assert.match(body(FUNCTIONS), /lease_generation = j\.lease_generation \+ 1/);
  });

  it('spends the attempt at claim time, and never again at settle', () => {
    assert.match(body(FUNCTIONS), /attempt\s+= j\.attempt \+ 1/);
    const settle = /durable_job_settle[\s\S]*?\$\$;/.exec(body(FUNCTIONS));
    assert.ok(settle, 'the settle function must exist');
    assert.equal(
      /attempt\s*=\s*\w*\.?attempt\s*\+\s*1/.test(settle[0]),
      false,
      'a settle that re-incremented would make the budget depend on writes, not tries',
    );
  });

  it('orders claims deterministically, so nothing starves', () => {
    assert.match(
      body(FUNCTIONS),
      /ORDER BY c\.priority ASC, c\.available_at ASC, c\.created_at ASC/,
    );
  });

  it('refuses to claim a job that is already at its ceiling', () => {
    assert.match(body(FUNCTIONS), /AND c\.attempt < c\.max_attempts/);
  });

  it('requires an organization, so a claim cannot cross a tenant', () => {
    assert.match(
      body(FUNCTIONS),
      /durable_job_claim requires an organization/,
    );
    assert.match(body(FUNCTIONS), /WHERE c\.organization_id = p_organization_id/);
  });
});

describe('BP-002 §8 — the lease is checked on every write', () => {
  it('checks owner AND generation on heartbeat, and refuses a lapsed lease', () => {
    const heartbeat = /durable_job_heartbeat\([\s\S]*?\$\$;/.exec(body(FUNCTIONS));
    assert.ok(heartbeat);
    assert.match(heartbeat[0], /AND lease_owner\s+= p_worker/);
    assert.match(heartbeat[0], /AND lease_generation = p_generation/);
    assert.match(heartbeat[0], /AND lease_expires_at > p_now/);
  });

  it('checks owner AND generation on settle, and writes nothing on a mismatch', () => {
    const settle = /durable_job_settle\([\s\S]*?\$\$;/.exec(body(FUNCTIONS));
    assert.ok(settle);
    assert.match(settle[0], /AND lease_owner\s+= p_worker/);
    assert.match(settle[0], /AND lease_generation = p_generation/);
    assert.match(settle[0], /IF NOT FOUND THEN[\s\S]*?RETURN false;/);
  });

  it('recovers an expired lease without spending an attempt', () => {
    const recover = /durable_job_recover_leases\([\s\S]*?\$\$;/.exec(body(FUNCTIONS));
    assert.ok(recover);
    assert.equal(
      /attempt\s*=\s*\w*\.?attempt\s*\+\s*1/.test(recover[0]),
      false,
      'the claim that handed out the lapsed lease already spent the attempt',
    );
    assert.match(recover[0], /AND j\.attempt >= j\.max_attempts/);
    assert.match(recover[0], /lease_abandoned/);
  });
});

describe('BP-002 §6.4 — the outbox is transactional', () => {
  it('writes the job result and its events inside one function body', () => {
    const settle = /CREATE OR REPLACE FUNCTION public\.durable_job_settle[\s\S]*?\$\$;/.exec(
      body(FUNCTIONS),
    );
    assert.ok(settle);
    assert.match(settle[0], /UPDATE public\.durable_jobs/);
    assert.match(settle[0], /INSERT INTO public\.durable_outbox/);
  });

  it('never re-mints an event id, and no-ops a re-presented one', () => {
    assert.match(body(FUNCTIONS), /\(v_event ->> 'eventId'\)::uuid/);
    assert.match(body(FUNCTIONS), /ON CONFLICT \(id\) DO NOTHING/);
    assert.equal(
      /INSERT INTO public\.durable_outbox[\s\S]*?gen_random_uuid\(\)/.test(body(FUNCTIONS)),
      false,
      'the settle must never generate an event id of its own',
    );
  });

  it('reads the camelCase keys the TypeScript argument builder writes', () => {
    // THE NAMING CONTRACT between `settleEventsArgument` and this function.
    // Drift here is a defect that only appears against a real database.
    for (const key of [
      'eventId',
      'eventType',
      'eventVersion',
      'occurredAt',
      'actorId',
      'actorType',
      'correlationId',
      'causationId',
      'source',
      'entityType',
      'entityId',
      'classification',
      'maxAttempts',
    ]) {
      assert.match(
        body(FUNCTIONS),
        new RegExp(`v_event ->> '${key}'`),
        `durable_job_settle must read '${key}'`,
      );
    }
    assert.match(body(FUNCTIONS), /v_event -> 'payload'/);
  });

  it('writes a dead-letter row when a job is exhausted, and never drops it', () => {
    assert.match(body(FUNCTIONS), /INSERT INTO public\.durable_dead_letters/);
  });
});

describe('BP-002 §10 — a schedule materializes once per occurrence', () => {
  it('advances under a compare-and-swap', () => {
    assert.match(body(FUNCTIONS), /AND materialize_version = v_schedule\.materialize_version/);
    assert.match(body(FUNCTIONS), /CONTINUE WHEN v_rows = 0/);
  });

  it('builds the SAME occurrence key the TypeScript builds', () => {
    // `occurrenceIdempotencyKey` produces `schedule:{id}:{ISO}`; this must too,
    // or the two guards stop guarding the same thing.
    assert.match(
      body(FUNCTIONS),
      /'schedule:' \|\| v_schedule\.id::text \|\| ':'/,
    );
    assert.match(body(FUNCTIONS), /'YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"'/);
  });

  it('relies on the unique key as well as the swap', () => {
    assert.match(
      body(FUNCTIONS),
      /ON CONFLICT \(organization_id, job_type, idempotency_key\) DO NOTHING/,
    );
  });

  it('computes the next occurrence from the SCHEDULED time, not from now', () => {
    assert.match(
      body(FUNCTIONS),
      /v_next := v_occurrence \+ make_interval/,
    );
    assert.equal(
      /v_next := p_now \+ make_interval/.test(body(FUNCTIONS)),
      false,
      'advancing from now would drift the schedule by however long the platform was busy',
    );
  });

  it('completes a one-time schedule rather than leaving it due', () => {
    assert.match(body(FUNCTIONS), /status\s+= 'completed'/);
  });
});

describe('the functions take their instant as an argument', () => {
  it('never reads the wall clock inside', () => {
    // A function that read `now()` would make the half of a behaviour that
    // lives in SQL untestable by the harness that tests the other half.
    const definitions = body(FUNCTIONS).split('CREATE OR REPLACE FUNCTION').slice(1);
    for (const definition of definitions) {
      const name = /public\.(\w+)/.exec(definition)?.[1] ?? 'unknown';
      assert.match(definition, /p_now\s+TIMESTAMPTZ/, `${name} must take p_now`);
      assert.equal(
        /[^_a-z]now\(\)/.test(definition.replace(/p_now/g, '')),
        false,
        `${name} must not read the wall clock`,
      );
    }
  });
});

describe('RLS is enabled, read-only, and never cross-tenant', () => {
  it('enables and FORCES row level security on every table', () => {
    assert.match(RLS, /ENABLE ROW LEVEL SECURITY/);
    assert.match(RLS, /FORCE ROW LEVEL SECURITY/);
    for (const table of DURABLE_TABLES) {
      assert.ok(RLS.includes(`'${table}'`), `${table} must be in the RLS loop`);
    }
  });

  it('requires membership AND a permission to read', () => {
    assert.match(RLS, /cortex\.is_organization_member\(organization_id\)/);
    assert.match(RLS, /cortex\.has_permission\(organization_id, 'runtime\.read'\)/);
  });

  it('grants authenticated nothing but SELECT', () => {
    // The runtime owns its own state machine. A person with UPDATE could set a
    // job to `succeeded` on work that never ran.
    assert.match(RLS, /REVOKE ALL ON public\.%I FROM authenticated/);
    assert.match(RLS, /GRANT SELECT ON public\.%I TO authenticated/);
    assert.equal(
      /FOR (INSERT|UPDATE|DELETE) TO authenticated/.test(body(RLS)),
      false,
      'there must be no write policy for authenticated on any durable table',
    );
  });

  it('adds the two permission keys and hangs them off the settings keys', () => {
    assert.match(RLS, /'runtime\.read'/);
    assert.match(RLS, /'runtime\.operate'/);
    assert.match(RLS, /\('settings\.read',\s*'runtime\.read'\)/);
    assert.match(RLS, /\('settings\.manage',\s*'runtime\.operate'\)/);
  });

  it('grants the SQL functions to the service role only', () => {
    for (const fn of [
      'durable_job_claim',
      'durable_job_heartbeat',
      'durable_job_settle',
      'durable_job_recover_leases',
      'durable_schedule_materialize_due',
    ]) {
      assert.match(
        FUNCTIONS,
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(`),
        `${fn} must be revoked from PUBLIC`,
      );
      assert.match(
        FUNCTIONS,
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role`),
        `${fn} must be granted to service_role only`,
      );
    }
    assert.equal(
      /GRANT EXECUTE ON FUNCTION public\.durable_\w+\([^)]*\) TO authenticated/.test(FUNCTIONS),
      false,
    );
  });
});

describe('the migration is additive, and the rollback is complete', () => {
  it('creates no second KV function and redefines nothing that exists', () => {
    // BP-002 §5: additive only, inside the existing chain. `kv_compare_and_swap`
    // and its field-named variant are not touched.
    const all = body(TABLES) + body(RLS) + body(FUNCTIONS);
    assert.equal(/kv_compare_and_swap/.test(all), false);
    assert.equal(/DROP TABLE/.test(all), false);
    assert.equal(/DROP COLUMN/.test(all), false);
    // The RLS migration's `format('ALTER TABLE public.%I ...')` is excluded:
    // its `%I` is always one of the five names asserted above, in a loop over
    // an array literal this suite reads.
    assert.equal(
      /ALTER TABLE public\.(?!durable_|%I)/.test(all),
      false,
      'no existing table is altered',
    );
  });

  it('migrates no existing runtime state, because that is A2', () => {
    const all = body(TABLES) + body(FUNCTIONS);
    assert.equal(/kv_store_324f4fbe/.test(all), false);
    assert.equal(/INSERT INTO public\.durable_jobs[\s\S]{0,400}SELECT[\s\S]{0,200}FROM public\.(?!durable_)/.test(all), false);
  });

  it('drops everything it created, in reverse dependency order, with no CASCADE', () => {
    const order = DURABLE_TABLES.map((table) => ROLLBACK.indexOf(`DROP TABLE IF EXISTS public.${table};`));
    for (const [index, position] of order.entries()) {
      assert.ok(position > 0, `${DURABLE_TABLES[index]} is not dropped`);
    }
    const inbox = ROLLBACK.indexOf('public.durable_inbox');
    const outbox = ROLLBACK.indexOf('public.durable_outbox');
    const jobs = ROLLBACK.indexOf('public.durable_jobs');
    const schedules = ROLLBACK.indexOf('public.durable_schedules');
    assert.ok(inbox < outbox, 'the inbox references the outbox and must go first');
    assert.ok(outbox < jobs, 'the outbox references jobs');
    assert.ok(jobs < schedules, 'jobs reference schedules');
    // Read past the prose: the header explains at length why there is no
    // CASCADE, so scanning the raw text would make the explanation the failure.
    assert.equal(/CASCADE/.test(body(ROLLBACK)), false);
  });

  it('drops the functions and the permission keys too', () => {
    for (const fn of [
      'durable_job_claim',
      'durable_job_heartbeat',
      'durable_job_settle',
      'durable_job_recover_leases',
      'durable_schedule_materialize_due',
    ]) {
      assert.match(ROLLBACK, new RegExp(`DROP FUNCTION IF EXISTS public\\.${fn}\\(`));
    }
    assert.match(ROLLBACK, /DELETE FROM public\.permissions[\s\S]*?'runtime\.read', 'runtime\.operate'/);
  });

  it('touches no existing table', () => {
    assert.equal(/organizations|people|goals|kv_store/.test(body(ROLLBACK)), false);
  });

  it('names its rollback from the migrations, so the pair cannot be separated', () => {
    assert.match(TABLES, /rollbacks\/20260919120000_rollback_durable_runtime\.sql/);
    assert.match(FUNCTIONS, /rollbacks\/20260919120000_rollback_durable_runtime\.sql/);
  });

  it('states the deployment rule this packet works under', () => {
    assert.match(TABLES, /staging\/local only until explicitly approved for production/);
    assert.match(FUNCTIONS, /staging\/local only until explicitly approved for production/);
  });
});
