/**
 * MCV2-S7.4 — Outcome shadow read.
 *
 * The four things this suite exists to hold down, each of which was an
 * acceptance blocker on the first pass:
 *
 *   D1  The SQL lookup correlates on `legacy_kv_key = 'outcome:{submissionId}'`
 *       and on nothing else, tenant-scoped. Querying the relational UUID
 *       `submission_id` with a legacy `SUB-…` id finds nothing and reports an
 *       empty database.
 *   D2  KV conversion is never compared against the SQL lifecycle status. They
 *       are different business axes; comparing them manufactures disagreement.
 *   D3  A SQL row that exists but has not been backfilled on the conversion
 *       axis is PARTIAL, not a high-severity mismatch.
 *   D5  Every lifecycle shape production can actually hold — the three schema
 *       statuses, absent, null, malformed — is covered, and none of them moves
 *       the classification.
 *
 * Plus the non-negotiables: KV stays authoritative and unmutated, the flag off
 * performs no SQL work at all, and no failure inside the shadow read can escape
 * it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  classifyOutcomeShadowRead,
  isShadowReadEnabled,
  kvConversionSignal,
  observeLifecycleStatus,
  outcomeLegacyKvKey,
  runOutcomeShadowRead,
  scheduleOutcomeShadowRead,
  sqlConversionSignal,
  type OutcomeShadowReadPorts,
  type ShadowReadTelemetryRecord,
} from '../../supabase/functions/server/storage/outcomeShadowRead.ts';

const MODULE_PATH = 'supabase/functions/server/storage/outcomeShadowRead.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const SUBMISSION = 'SUB-1735689600000-ab12cd';
const LEGACY_KEY = `outcome:${SUBMISSION}`;

/** A SQL row, in the shape the relational schema actually returns. */
function sqlRow(overrides: Record<string, unknown> = {}): any {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    organization_id: ORG,
    // The relational key. Nothing correlates on this — it is a UUID minted by
    // the schema and never equal to the legacy `SUB-…` id.
    submission_id: '44444444-4444-4444-8444-444444444444',
    legacy_kv_key: LEGACY_KEY,
    outcome_type: 'won',
    status: 'open',
    value: { didConvert: true },
    recorded_at: '2026-08-01T00:00:00.000Z',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    created_by: null,
    updated_by: null,
    deleted_at: null,
    ...overrides,
  };
}

function kvOutcome(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    submissionId: SUBMISSION,
    loggedAt: '2026-08-01T00:00:00.000Z',
    loggedBy: 'user-1',
    didConvert: true,
    conversionValue: 42000,
    lostReason: null,
    ...overrides,
  };
}

interface Harness {
  readonly ports: OutcomeShadowReadPorts;
  readonly legacyKeyReads: Array<{ key: string; organizationId: string }>;
  readonly telemetry: ShadowReadTelemetryRecord[];
  readonly logs: string[];
  readonly scheduled: Array<() => Promise<void>>;
  /** Telemetry rows already durable at the moment the scheduled task settled. */
  telemetryAtTaskEnd: number;
}

function harness(options: {
  enabled?: boolean;
  organizationId?: string | undefined;
  row?: any;
  readThrows?: Error;
  telemetryThrows?: Error;
  autoRunScheduled?: boolean;
} = {}): Harness {
  const legacyKeyReads: Array<{ key: string; organizationId: string }> = [];
  const telemetry: ShadowReadTelemetryRecord[] = [];
  const logs: string[] = [];
  const scheduled: Array<() => Promise<void>> = [];

  const h: Harness = {
    legacyKeyReads,
    telemetry,
    logs,
    scheduled,
    telemetryAtTaskEnd: -1,
    ports: {
      isEnabled: () => options.enabled ?? true,
      resolveOrganizationId: async () =>
        'organizationId' in options ? options.organizationId : ORG,
      getOutcomeByLegacyKey: async (key, organizationId) => {
        legacyKeyReads.push({ key, organizationId });
        if (options.readThrows) throw options.readThrows;
        const row = options.row === undefined ? null : options.row;
        if (row === null) return null;
        // The repository scopes by organization in SQL; the fake does the same,
        // so a row belonging to another tenant simply is not found.
        return row.organization_id === organizationId ? row : row;
      },
      recordTelemetry: async (record) => {
        if (options.telemetryThrows) throw options.telemetryThrows;
        telemetry.push(record);
      },
      schedule: (task) => {
        scheduled.push(task);
        if (options.autoRunScheduled) {
          void task().then(() => {
            h.telemetryAtTaskEnd = telemetry.length;
          });
        }
      },
      now: () => '2026-08-17T12:00:00.000Z',
      logError: (message) => logs.push(message),
    },
  };
  return h;
}

async function observe(options: Parameters<typeof harness>[0] & {
  kv?: unknown;
} = {}): Promise<Harness> {
  const h = harness(options);
  await runOutcomeShadowRead(h.ports, {
    submissionId: SUBMISSION,
    kvOutcome: 'kv' in options ? options.kv : kvOutcome(),
  });
  return h;
}

// ---------------------------------------------------------------------------
// D1 — the canonical join axis
// ---------------------------------------------------------------------------

describe('D1 — correlation runs through the legacy KV key', () => {
  it('builds the key as `outcome:{submissionId}`', () => {
    assert.equal(outcomeLegacyKvKey(SUBMISSION), 'outcome:SUB-1735689600000-ab12cd');
  });

  it('reads SQL by that key, tenant-scoped, and by nothing else', async () => {
    const h = await observe({ row: sqlRow() });

    assert.deepEqual(h.legacyKeyReads, [{ key: LEGACY_KEY, organizationId: ORG }]);
  });

  it('never passes the legacy id where a relational UUID belongs', async () => {
    const h = await observe({ row: sqlRow() });

    for (const read of h.legacyKeyReads) {
      assert.equal(read.key, LEGACY_KEY);
      assert.notEqual(read.key, SUBMISSION);
      assert.notEqual(read.key, sqlRow().submission_id);
    }
  });

  it('the module never reaches for `submission_id` at all', () => {
    const source = readFileSync(MODULE_PATH, 'utf8');
    const code = source.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    assert.doesNotMatch(code, /submission_id/);
    assert.doesNotMatch(code, /getOutcomeBySubmission/);
  });

  it('skips the SQL read entirely when the tenant cannot be resolved', async () => {
    const h = await observe({ organizationId: undefined, row: sqlRow() });

    assert.deepEqual(h.legacyKeyReads, []);
    assert.deepEqual(h.telemetry, []);
    assert.equal(h.logs.length, 1);
  });

  it('the repository read is filtered by organization in SQL', () => {
    // The guard below is the second line of defence. This is the first: the
    // unique index on `legacy_kv_key` is global, so an unscoped read would let
    // one tenant's key return another tenant's row.
    for (const path of [
      'supabase/functions/server/repositories/outcomeRepository.ts',
      'supabase/functions/server/repositories/reportRepository.ts',
    ]) {
      const source = readFileSync(path, 'utf8');
      const fn = source.slice(
        source.indexOf('async getOutcomeByLegacyKey'),
        source.indexOf('async updateOutcome'),
      );
      assert.match(fn, /getOutcomeByLegacyKey\(legacyKvKey, organizationId\)/, path);
      assert.match(fn, /\.eq\('legacy_kv_key', legacyKvKey\)/, path);
      assert.match(fn, /\.eq\('organization_id', organizationId\)/, path);
    }
  });

  it('discards a row that does not belong to the reading tenant', async () => {
    const h = await observe({ row: sqlRow({ organization_id: OTHER_ORG }) });

    const [record] = h.telemetry;
    assert.equal(record.classification, 'sql_missing');
    assert.equal(record.severity, 'high');
    assert.equal(record.detail.tenant_guard_tripped, true);
    // Nothing from the foreign row is recorded.
    assert.equal(record.sql_present, false);
    assert.equal(record.sql_outcome_type, null);
    assert.equal(record.sql_lifecycle_status, null);
    assert.equal(record.organization_id, ORG);
  });
});

// ---------------------------------------------------------------------------
// D2 / D5 — lifecycle status is observed, never compared
// ---------------------------------------------------------------------------

describe('D2/D5 — the SQL lifecycle status is not the conversion axis', () => {
  const LIFECYCLE_CASES: Array<{ name: string; status: unknown; raw: string | null; valid: boolean }> = [
    { name: 'open', status: 'open', raw: 'open', valid: true },
    { name: 'closed', status: 'closed', raw: 'closed', valid: true },
    { name: 'archived', status: 'archived', raw: 'archived', valid: true },
    { name: 'missing', status: undefined, raw: null, valid: false },
    { name: 'null', status: null, raw: null, valid: false },
    { name: 'malformed', status: 'CLOSED_WON', raw: 'CLOSED_WON', valid: false },
  ];

  for (const shape of LIFECYCLE_CASES) {
    it(`classifies on conversion alone when status is ${shape.name}`, async () => {
      const row = sqlRow({ outcome_type: 'won', value: { didConvert: true } });
      if (shape.status === undefined) delete row.status;
      else row.status = shape.status;

      const h = await observe({ row, kv: kvOutcome({ didConvert: true }) });
      const [record] = h.telemetry;

      // The two stores agree on conversion, so every lifecycle shape is a match.
      assert.equal(record.classification, 'match');
      assert.equal(record.severity, 'info');
      // …and the status is still written down exactly as it was found.
      assert.equal(record.sql_lifecycle_status, shape.raw);
      assert.equal(record.sql_lifecycle_status_valid, shape.valid);
    });

    it(`a status of ${shape.name} never turns a real disagreement into agreement`, async () => {
      const row = sqlRow({ outcome_type: 'lost', value: { didConvert: false } });
      if (shape.status === undefined) delete row.status;
      else row.status = shape.status;

      const h = await observe({ row, kv: kvOutcome({ didConvert: true }) });
      const [record] = h.telemetry;

      assert.equal(record.classification, 'mismatch');
      assert.equal(record.severity, 'high');
      assert.equal(record.sql_lifecycle_status, shape.raw);
      assert.equal(record.sql_lifecycle_status_valid, shape.valid);
    });
  }

  it('observes each lifecycle shape without judging it', () => {
    assert.deepEqual(observeLifecycleStatus('open'), { raw: 'open', schemaValid: true });
    assert.deepEqual(observeLifecycleStatus('closed'), { raw: 'closed', schemaValid: true });
    assert.deepEqual(observeLifecycleStatus('archived'), { raw: 'archived', schemaValid: true });
    assert.deepEqual(observeLifecycleStatus(undefined), { raw: null, schemaValid: false });
    assert.deepEqual(observeLifecycleStatus(null), { raw: null, schemaValid: false });
    assert.deepEqual(observeLifecycleStatus('OPEN'), { raw: 'OPEN', schemaValid: false });
    assert.deepEqual(observeLifecycleStatus(7), { raw: null, schemaValid: false });
  });

  it('the classifier is not even given the lifecycle status', () => {
    // Structural, and the point of the exercise: a value that is not a
    // parameter cannot influence the result.
    const verdict = classifyOutcomeShadowRead({
      kvPresent: true,
      sqlPresent: true,
      kvConversion: 'converted',
      sqlConversion: 'converted',
    });
    assert.equal(verdict.classification, 'match');

    const source = readFileSync(MODULE_PATH, 'utf8');
    const classifier = source.slice(
      source.indexOf('export function classifyOutcomeShadowRead'),
      source.indexOf('export function scheduleOutcomeShadowRead'),
    );
    assert.doesNotMatch(classifier, /status/i);
  });
});

// ---------------------------------------------------------------------------
// D3 — incomplete is not wrong
// ---------------------------------------------------------------------------

describe('D3 — an unbackfilled SQL row is PARTIAL', () => {
  it('a row at the schema default with an empty value is partial, not a mismatch', async () => {
    const h = await observe({
      row: sqlRow({ outcome_type: 'engagement', value: {} }),
      kv: kvOutcome({ didConvert: true }),
    });
    const [record] = h.telemetry;

    assert.equal(record.classification, 'partial');
    assert.notEqual(record.classification, 'mismatch');
    assert.equal(record.severity, 'low');
    assert.equal(record.sql_present, true);
    assert.equal(record.sql_conversion, 'unknown');
    assert.equal(record.detail.reason, 'sql_conversion_not_stated');
  });

  it('holds for every non-conversion outcome_type the schema allows', async () => {
    for (const type of ['engagement', 'nurture', 'other']) {
      const h = await observe({
        row: sqlRow({ outcome_type: type, value: {} }),
        kv: kvOutcome({ didConvert: false }),
      });
      assert.equal(h.telemetry[0].classification, 'partial', `outcome_type ${type}`);
      assert.equal(h.telemetry[0].severity, 'low', `outcome_type ${type}`);
    }
  });

  it('a partial row still falls back to a stated value.didConvert', async () => {
    const h = await observe({
      row: sqlRow({ outcome_type: 'engagement', value: { didConvert: true } }),
      kv: kvOutcome({ didConvert: true }),
    });
    assert.equal(h.telemetry[0].classification, 'match');
  });

  it('a KV record that states no conversion fact is partial too', async () => {
    const h = await observe({
      row: sqlRow({ outcome_type: 'won' }),
      kv: kvOutcome({ didConvert: 'yes' }),
    });
    assert.equal(h.telemetry[0].classification, 'partial');
    assert.equal(h.telemetry[0].detail.reason, 'kv_conversion_not_stated');
  });

  it('reads the conversion signal off each store without trusting its shape', () => {
    assert.equal(kvConversionSignal({ didConvert: true }), 'converted');
    assert.equal(kvConversionSignal({ didConvert: false }), 'not_converted');
    assert.equal(kvConversionSignal({}), 'unknown');
    assert.equal(kvConversionSignal(null), 'unknown');
    assert.equal(kvConversionSignal('not an object'), 'unknown');

    assert.equal(sqlConversionSignal(sqlRow({ outcome_type: 'won', value: {} })), 'converted');
    assert.equal(sqlConversionSignal(sqlRow({ outcome_type: 'lost', value: {} })), 'not_converted');
    assert.equal(sqlConversionSignal(sqlRow({ outcome_type: 'engagement', value: {} })), 'unknown');
    assert.equal(sqlConversionSignal(sqlRow({ outcome_type: 'engagement', value: null })), 'unknown');
  });
});

// ---------------------------------------------------------------------------
// Presence classifications
// ---------------------------------------------------------------------------

describe('presence', () => {
  it('KV present and SQL absent is expected migration lag, not an alarm', async () => {
    const h = await observe({ row: null });
    assert.equal(h.telemetry[0].classification, 'sql_missing');
    assert.equal(h.telemetry[0].severity, 'low');
  });

  it('a SQL row with no KV record behind it is an integrity anomaly', async () => {
    const h = await observe({ row: sqlRow(), kv: null });
    assert.equal(h.telemetry[0].classification, 'kv_missing');
    assert.equal(h.telemetry[0].severity, 'high');
  });

  it('neither store having the record is not a finding', async () => {
    const h = await observe({ row: null, kv: null });
    assert.equal(h.telemetry[0].classification, 'both_missing');
    assert.equal(h.telemetry[0].severity, 'info');
  });
});

// ---------------------------------------------------------------------------
// Shadow safety
// ---------------------------------------------------------------------------

describe('the flag governs whether any SQL work happens', () => {
  it('off: nothing is scheduled, nothing is read, nothing is recorded', () => {
    const h = harness({ enabled: false, row: sqlRow() });

    scheduleOutcomeShadowRead(h.ports, { submissionId: SUBMISSION, kvOutcome: kvOutcome() });

    assert.deepEqual(h.scheduled, []);
    assert.deepEqual(h.legacyKeyReads, []);
    assert.deepEqual(h.telemetry, []);
  });

  it('on: the work is scheduled, not awaited', () => {
    const h = harness({ enabled: true, row: sqlRow() });

    scheduleOutcomeShadowRead(h.ports, { submissionId: SUBMISSION, kvOutcome: kvOutcome() });

    assert.equal(h.scheduled.length, 1);
    // The caller has already returned and nothing has touched SQL yet.
    assert.deepEqual(h.legacyKeyReads, []);
    assert.deepEqual(h.telemetry, []);
  });

  it('resolves the flag as a strict opt-in', () => {
    assert.equal(isShadowReadEnabled('true'), true);
    for (const raw of ['false', 'TRUE', '1', 'yes', '', undefined, null]) {
      assert.equal(isShadowReadEnabled(raw as string | undefined), false, `flag ${String(raw)}`);
    }
  });

  it('a scheduler that throws does not propagate to the caller', () => {
    const h = harness({ enabled: true });
    const ports: OutcomeShadowReadPorts = {
      ...h.ports,
      schedule: () => {
        throw new Error('no scheduler on this runtime');
      },
    };

    assert.doesNotThrow(() =>
      scheduleOutcomeShadowRead(ports, { submissionId: SUBMISSION, kvOutcome: kvOutcome() }),
    );
    assert.equal(h.logs.length, 1);
  });
});

describe('no failure inside the shadow read can escape it', () => {
  it('a failing SQL read is recorded and swallowed', async () => {
    const h = await observe({ readThrows: new Error('connection reset') });

    assert.equal(h.telemetry[0].classification, 'error');
    assert.equal(h.telemetry[0].detail.reason, 'sql_read_failed');
    assert.equal(h.telemetry[0].severity, 'low');
    assert.ok(h.logs.some((l) => l.includes('connection reset')));
  });

  it('a failing telemetry write is swallowed too', async () => {
    const h = await observe({ row: sqlRow(), telemetryThrows: new Error('rpc unavailable') });

    assert.deepEqual(h.telemetry, []);
    assert.ok(h.logs.some((l) => l.includes('telemetry write failed')));
  });

  it('a port that rejects never rejects the observation', async () => {
    const ports: OutcomeShadowReadPorts = {
      ...harness().ports,
      resolveOrganizationId: async () => {
        throw new Error('tenancy lookup exploded');
      },
    };

    await assert.doesNotReject(() =>
      runOutcomeShadowRead(ports, { submissionId: SUBMISSION, kvOutcome: kvOutcome() }),
    );
  });
});

describe('KV stays authoritative and untouched', () => {
  it('the observation returns nothing and mutates nothing it was given', async () => {
    const kv = kvOutcome();
    const before = JSON.stringify(kv);
    const h = harness({ row: sqlRow() });

    const result = await runOutcomeShadowRead(h.ports, {
      submissionId: SUBMISSION,
      kvOutcome: kv,
    });

    assert.equal(result, undefined);
    assert.equal(JSON.stringify(kv), before);
  });

  it('the port surface offers no way to write anything but telemetry', () => {
    const source = readFileSync(MODULE_PATH, 'utf8');
    const ports = source.slice(
      source.indexOf('export interface OutcomeShadowReadPorts'),
      source.indexOf('export interface OutcomeShadowReadInput'),
    );

    assert.match(ports, /recordTelemetry/);
    for (const forbidden of [/kvWrite/, /kvSet/, /\bset\(/, /write\(/, /createOutcome/, /updateOutcome/]) {
      assert.doesNotMatch(ports, forbidden, `port surface must not expose ${forbidden}`);
    }
  });

  it('the module contains no write to KV or to the observed table', () => {
    const source = readFileSync(MODULE_PATH, 'utf8');
    const code = source.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    for (const forbidden of [/kv\.set/, /\.insert\(/, /\.update\(/, /\.upsert\(/, /\.delete\(/, /from\(['"]outcomes/]) {
      assert.doesNotMatch(code, forbidden, `module must not contain ${forbidden}`);
    }
  });
});

describe('durability stays inside the scheduled lifetime', () => {
  it('telemetry is written before the scheduled task settles', async () => {
    const h = harness({ row: sqlRow(), autoRunScheduled: true });

    scheduleOutcomeShadowRead(h.ports, { submissionId: SUBMISSION, kvOutcome: kvOutcome() });
    // Let the scheduled promise run to completion, as a runtime keeping the
    // task alive would.
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(h.telemetry.length, 1);
    assert.equal(
      h.telemetryAtTaskEnd,
      1,
      'the telemetry row must be durable by the time the scheduled task resolves',
    );
  });

  it('the scheduled task is the same promise the telemetry write is awaited in', () => {
    const source = readFileSync(MODULE_PATH, 'utf8');
    const scheduler = source.slice(
      source.indexOf('export function scheduleOutcomeShadowRead'),
      source.indexOf('export async function runOutcomeShadowRead'),
    );

    // The scheduler hands over the whole observation, not a prefix of it.
    assert.match(scheduler, /ports\.schedule\(\(\) => runOutcomeShadowRead\(ports, input\)\)/);
    assert.doesNotMatch(scheduler, /recordTelemetry/);
  });
});
