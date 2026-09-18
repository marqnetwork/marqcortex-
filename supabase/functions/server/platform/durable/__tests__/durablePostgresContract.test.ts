/**
 * The contract between the Postgres store and the migration.
 *
 * ── WHAT THIS CAN PROVE, AND WHAT IT CANNOT ───────────────────────────────
 *
 * It cannot prove that `durable_job_claim` is atomic. Nothing can, without a
 * PostgreSQL to run it against, and this repository is honest about that
 * elsewhere too — `tests/database/kv_compare_and_swap.test.ts` skips its real
 * assertions when no database is configured, and the scenario scripts under
 * `scripts/` are where the live proof lives.
 *
 * What it CAN prove is the part that breaks silently: that every column
 * `postgresStores.ts` reads is a column the migration declares, that every
 * argument it sends is an argument the function takes, and that the two places
 * which independently build the same string still build the same string. Those
 * are defects that no in-memory test can see and that a live run would surface
 * only at the moment the runtime is first deployed.
 *
 * So the mappers are driven over rows shaped exactly as PostgREST returns them,
 * and the argument builders are checked against the migration text.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  DURABLE_FAILURE,
  DURABLE_RPC,
  DURABLE_TABLE,
  DurableRuntimeError,
  occurrenceIdempotencyKey,
  settleArguments,
  settleEventsArgument,
  toDeadLetterRecord,
  toDurableJob,
  toEventRecord,
  toInboxRecord,
  toSchedule,
} from '../index.ts';
import { ORG, OTHER_ORG } from './fixtures.ts';

const ROOT = fileURLToPath(new URL('../../../../../../', import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const TABLES = read('supabase/migrations/20260919120000_cortex_durable_runtime.sql');
const FUNCTIONS = read('supabase/migrations/20260919120002_cortex_durable_runtime_functions.sql');

/** A row exactly as PostgREST returns one: snake_case, nulls, string bigints. */
const JOB_ROW: Record<string, unknown> = {
  id: 'job-1',
  organization_id: ORG,
  job_type: 'test.read',
  state: 'leased',
  priority: 100,
  available_at: '2026-09-18T12:00:00.000Z',
  attempt: 2,
  max_attempts: 5,
  backoff_kind: 'exponential',
  backoff_base_ms: 1000,
  backoff_max_ms: 3600000,
  lease_owner: 'worker-a',
  lease_generation: 3,
  lease_expires_at: '2026-09-18T12:01:00.000Z',
  heartbeat_at: '2026-09-18T12:00:30.000Z',
  lease_ttl_ms: 60000,
  idempotency_key: 'k1',
  correlation_id: 'corr-1',
  causation_id: null,
  schedule_id: null,
  actor_id: 'service:test',
  actor_type: 'service',
  actor_permissions: ['job.run'],
  initiated_by_actor_id: null,
  initiated_by_actor_type: null,
  input: { n: 1 },
  result: null,
  failure_code: null,
  failure_detail: null,
  created_at: '2026-09-18T11:00:00.000Z',
  updated_at: '2026-09-18T12:00:30.000Z',
  started_at: '2026-09-18T11:30:00.000Z',
  completed_at: null,
};

describe('a row becomes a job, and a null becomes an absence', () => {
  it('maps every field, and omits the nulls rather than carrying them', () => {
    const job = toDurableJob(JOB_ROW);
    assert.equal(job.jobId, 'job-1');
    assert.equal(job.state, 'leased');
    assert.equal(job.attempt, 2);
    assert.equal(job.leaseGeneration, 3);
    assert.equal(job.leaseOwner, 'worker-a');
    assert.deepEqual(job.retry, { kind: 'exponential', baseMs: 1000, maxMs: 3600000 });
    assert.deepEqual(job.actor.permissions, ['job.run']);
    // A `null` column must not become the string "null" or an empty object.
    assert.equal(job.causationId, undefined);
    assert.equal(job.result, undefined);
    assert.equal(job.actor.initiatedBy, undefined);
  });

  it('re-validates the actor on the way out, not only on the way in', () => {
    // A job is written by one isolate and run by another, possibly after a
    // migration, possibly after somebody edited a row.
    assert.throws(
      () => toDurableJob({ ...JOB_ROW, actor_type: 'human' }),
      (error: unknown) =>
        error instanceof DurableRuntimeError &&
        error.code === DURABLE_FAILURE.authorityContextMissing,
    );
    assert.throws(
      () => toDurableJob({ ...JOB_ROW, actor_permissions: 'job.run' }),
      (error: unknown) => error instanceof DurableRuntimeError,
    );
  });

  it('cannot produce a job whose actor and row disagree about the tenant', () => {
    // A STRUCTURAL PROPERTY RATHER THAN A CHECK. `actorFrom` takes the actor's
    // organization FROM the row's `organization_id`, so there is no pair of
    // column values that yields a job whose actor belongs elsewhere — the
    // mismatch is unrepresentable rather than rejected. Asserted so that a
    // later refactor which passed the tenant in separately would fail here.
    const mine = toDurableJob(JOB_ROW);
    const theirs = toDurableJob({ ...JOB_ROW, organization_id: OTHER_ORG });
    assert.equal(mine.actor.organizationId, mine.organizationId);
    assert.equal(theirs.actor.organizationId, OTHER_ORG);
    assert.equal(theirs.organizationId, OTHER_ORG);
  });

  it('names the missing column when the schema and the store diverge', () => {
    const { correlation_id: _omitted, ...without } = JOB_ROW;
    assert.throws(
      () => toDurableJob(without),
      (error: unknown) =>
        error instanceof DurableRuntimeError && /correlation_id/.test(error.detail ?? ''),
    );
  });

  it('reads a BIGINT that arrived as a string', () => {
    // PostgREST returns BIGINT as text. Refusing it would make a recurring
    // schedule read as one-time and silently stop recurring.
    const schedule = toSchedule({
      id: 'sched-1',
      organization_id: ORG,
      schedule_key: 'sweep',
      job_type: 'test.read',
      status: 'active',
      next_run_at: '2026-09-18T12:00:00.000Z',
      recurrence_interval_ms: '300000',
      last_run_at: null,
      last_occurrence_at: null,
      materialize_version: 0,
      actor_id: 'service:test',
      actor_type: 'service',
      actor_permissions: [],
      initiated_by_actor_id: null,
      initiated_by_actor_type: null,
      correlation_id: 'corr',
      input: {},
      created_at: '2026-09-18T11:00:00.000Z',
      updated_at: '2026-09-18T11:00:00.000Z',
    });
    assert.equal(schedule.recurrenceIntervalMs, 300000);
  });

  it('maps an event, an inbox row and a dead letter', () => {
    const event = toEventRecord({
      id: 'ev-1',
      organization_id: ORG,
      event_type: 'test.happened',
      event_version: 1,
      occurred_at: '2026-09-18T12:00:00.000Z',
      actor_id: 'service:test',
      actor_type: 'service',
      correlation_id: 'corr',
      causation_id: 'job-1',
      source: 'durable.job',
      entity_type: null,
      entity_id: null,
      classification: 'internal',
      payload: { n: 1 },
      dispatch_state: 'pending',
      attempt: 0,
      max_attempts: 5,
      available_at: '2026-09-18T12:00:00.000Z',
      lease_owner: null,
      lease_generation: 0,
      lease_expires_at: null,
      failure_code: null,
      failure_detail: null,
      job_id: 'job-1',
      created_at: '2026-09-18T12:00:00.000Z',
      updated_at: '2026-09-18T12:00:00.000Z',
      dispatched_at: null,
    });
    assert.equal(event.eventId, 'ev-1');
    assert.equal(event.causationId, 'job-1');
    assert.equal(event.dispatchedAt, undefined);

    const inbox = toInboxRecord({
      id: 'in-1',
      organization_id: ORG,
      consumer_key: 'c',
      event_id: 'ev-1',
      event_type: 'test.happened',
      status: 'processed',
      processed_at: '2026-09-18T12:00:00.000Z',
      correlation_id: 'corr',
      causation_id: null,
      failure_code: null,
      failure_detail: null,
      result: null,
    });
    assert.equal(inbox.eventId, 'ev-1');
    assert.equal(inbox.result, undefined);

    const letter = toDeadLetterRecord({
      id: 'dl-1',
      organization_id: ORG,
      origin_kind: 'job',
      origin_id: 'job-1',
      origin_type: 'test.read',
      attempts: 5,
      failure_code: 'handler.threw',
      failure_detail: null,
      correlation_id: 'corr',
      causation_id: null,
      first_failed_at: '2026-09-18T11:00:00.000Z',
      last_failed_at: '2026-09-18T12:00:00.000Z',
      recovery_state: 'unrecovered',
      recovered_at: null,
      recovered_job_id: null,
      created_at: '2026-09-18T12:00:00.000Z',
    });
    assert.equal(letter.originId, 'job-1');
    assert.equal(letter.recoveryState, 'unrecovered');
  });
});

describe('every column the store reads is a column the migration declares', () => {
  it('finds each one in the CREATE TABLE it belongs to', () => {
    const declarations: Record<string, readonly string[]> = {
      durable_jobs: Object.keys(JOB_ROW),
      durable_schedules: [
        'id',
        'organization_id',
        'schedule_key',
        'job_type',
        'status',
        'next_run_at',
        'recurrence_interval_ms',
        'last_run_at',
        'last_occurrence_at',
        'materialize_version',
        'actor_id',
        'actor_type',
        'actor_permissions',
        'initiated_by_actor_id',
        'initiated_by_actor_type',
        'correlation_id',
        'input',
        'created_at',
        'updated_at',
      ],
      durable_outbox: [
        'id',
        'organization_id',
        'event_type',
        'event_version',
        'occurred_at',
        'actor_id',
        'actor_type',
        'correlation_id',
        'causation_id',
        'source',
        'entity_type',
        'entity_id',
        'classification',
        'payload',
        'dispatch_state',
        'attempt',
        'max_attempts',
        'available_at',
        'lease_owner',
        'lease_generation',
        'lease_expires_at',
        'failure_code',
        'failure_detail',
        'job_id',
        'created_at',
        'updated_at',
        'dispatched_at',
      ],
      durable_inbox: [
        'id',
        'organization_id',
        'consumer_key',
        'event_id',
        'event_type',
        'status',
        'processed_at',
        'correlation_id',
        'causation_id',
        'failure_code',
        'failure_detail',
        'result',
      ],
      durable_dead_letters: [
        'id',
        'organization_id',
        'origin_kind',
        'origin_id',
        'origin_type',
        'attempts',
        'failure_code',
        'failure_detail',
        'correlation_id',
        'causation_id',
        'first_failed_at',
        'last_failed_at',
        'recovery_state',
        'recovered_at',
        'recovered_job_id',
        'created_at',
      ],
    };

    for (const [table, columns] of Object.entries(declarations)) {
      const block = new RegExp(
        `CREATE TABLE IF NOT EXISTS public\\.${table} \\(([\\s\\S]*?)\\n\\);`,
      ).exec(TABLES);
      assert.ok(block, `${table} must be declared`);
      for (const column of columns) {
        assert.match(
          block[1],
          new RegExp(`(^|\\n)\\s*${column}\\s`),
          `${table}.${column} is read by the store and not declared`,
        );
      }
    }
  });

  it('names the tables the store names', () => {
    for (const table of Object.values(DURABLE_TABLE)) {
      assert.match(TABLES, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table} \\(`));
    }
  });
});

describe('every argument the store sends is an argument the function takes', () => {
  it('matches the settle signature exactly', () => {
    const args = settleArguments(
      { jobId: 'job-1', organizationId: ORG, owner: 'w', generation: 1, expiresAt: 'x' },
      { disposition: 'succeeded', result: { ok: true } },
      '2026-09-18T12:00:00.000Z',
    );
    const signature = /CREATE OR REPLACE FUNCTION public\.durable_job_settle\(([\s\S]*?)\)\s*\nRETURNS/.exec(
      FUNCTIONS,
    );
    assert.ok(signature);
    const declared = [...signature[1].matchAll(/(p_\w+)\s+\w/g)].map((match) => match[1]).sort();
    assert.deepEqual(Object.keys(args).sort(), declared);
  });

  it('matches the claim, heartbeat, recovery and materialize signatures', () => {
    const expected: Record<string, readonly string[]> = {
      [DURABLE_RPC.claim]: [
        'p_organization_id',
        'p_job_types',
        'p_worker',
        'p_lease_ttl_ms',
        'p_now',
      ],
      [DURABLE_RPC.heartbeat]: [
        'p_job_id',
        'p_organization_id',
        'p_worker',
        'p_generation',
        'p_lease_ttl_ms',
        'p_now',
      ],
      [DURABLE_RPC.recover]: ['p_now', 'p_limit'],
      [DURABLE_RPC.materialize]: ['p_organization_id', 'p_now', 'p_limit'],
    };

    for (const [fn, args] of Object.entries(expected)) {
      const signature = new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.${fn}\\(([\\s\\S]*?)\\)\\s*\\nRETURNS`,
      ).exec(FUNCTIONS);
      assert.ok(signature, `${fn} must be declared`);
      const declared = [...signature[1].matchAll(/(p_\w+)\s+\w/g)].map((match) => match[1]);
      assert.deepEqual(declared.sort(), [...args].sort(), `${fn} signature has drifted`);
    }
  });

  it('sends only camelCase event keys the settle function reads', () => {
    const drafts = settleEventsArgument([
      {
        eventId: 'ev-1',
        eventType: 'test.happened',
        eventVersion: 2,
        occurredAt: '2026-09-18T12:00:00.000Z',
        actorId: 'a',
        actorType: 'service',
        correlationId: 'c',
        causationId: 'j',
        source: 's',
        entityType: 'e',
        entityId: 'i',
        classification: 'internal',
        payload: { n: 1 },
        maxAttempts: 4,
      },
    ]);
    for (const key of Object.keys(drafts[0])) {
      if (key === 'payload') {
        assert.match(FUNCTIONS, /v_event -> 'payload'/);
        continue;
      }
      assert.match(
        FUNCTIONS,
        new RegExp(`v_event ->> '${key}'`),
        `durable_job_settle does not read '${key}'`,
      );
    }
  });

  it('validates every draft before the settle is attempted', () => {
    // Letting an oversized payload reach the settle would make the store throw
    // mid-transaction, leaving the job leased to be recovered and to fail again
    // the same way. An unbounded loop paced by the lease TTL.
    assert.throws(
      () =>
        settleEventsArgument([
          { eventId: 'ev', eventType: 't', payload: { blob: 'x'.repeat(20_000) } },
        ]),
      (error: unknown) => error instanceof DurableRuntimeError,
    );
  });

  it('sends no events at all on a retry', () => {
    const args = settleArguments(
      { jobId: 'j', organizationId: ORG, owner: 'w', generation: 1, expiresAt: 'x' },
      {
        disposition: 'retry',
        failureCode: 'transient',
        availableAt: '2026-09-18T12:05:00.000Z',
      },
      '2026-09-18T12:00:00.000Z',
    );
    // A job that is going to run again has not finished, so it has stated no
    // fact. Publishing one now would publish something that may not happen.
    assert.deepEqual(args.p_events, []);
    assert.equal(args.p_result, null);
  });
});

describe('the occurrence key is built identically in both languages', () => {
  it('produces the string the SQL produces', () => {
    const key = occurrenceIdempotencyKey('sched-1', '2026-09-18T12:00:00.000Z');
    assert.equal(key, 'schedule:sched-1:2026-09-18T12:00:00.000Z');
    // The SQL builds `'schedule:' || id || ':' || to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
    // which for this instant is byte-for-byte the same. Asserted as a shape
    // rather than by running Postgres, which is what this file can do.
    assert.match(FUNCTIONS, /'schedule:' \|\| v_schedule\.id::text \|\| ':'/);
    assert.match(FUNCTIONS, /'YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"'/);
    assert.match(
      key,
      /^schedule:[^:]+:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      'the format the SQL to_char mask produces',
    );
  });
});
