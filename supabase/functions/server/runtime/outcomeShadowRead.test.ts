import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setEnvReaderForTests } from './env.ts';
import {
  resetShadowTelemetryForTests,
  getRecentShadowReads,
} from './shadowTelemetry.ts';
import {
  compareOutcome,
  projectKvOutcome,
  outcomeLegacyKey,
  shadowReadOutcome,
} from './outcomeShadowRead.ts';
import type {
  KvOutcomeProjection,
  OutcomeSqlReader,
  SqlOutcomeProjection,
} from './contracts.ts';

const kv = (over: Partial<KvOutcomeProjection> = {}): KvOutcomeProjection => ({
  submissionId: 'sub-1',
  didConvert: true,
  conversionValue: 1000,
  ...over,
});

const sql = (over: Partial<SqlOutcomeProjection> = {}): SqlOutcomeProjection => ({
  submissionId: 'sub-1',
  legacyKvKey: 'outcome:sub-1',
  didConvert: true,
  conversionValue: 1000,
  status: 'won',
  ...over,
});

const readerReturning = (value: SqlOutcomeProjection | null): OutcomeSqlReader =>
  async () => value;

const enable = () => setEnvReaderForTests(() => 'true');
const disable = () => setEnvReaderForTests(() => 'false');

describe('outcome shadow read — helpers', () => {
  it('builds the legacy KV key', () => {
    assert.equal(outcomeLegacyKey('abc'), 'outcome:abc');
  });

  it('projects only the compared KV fields and drops wrong types', () => {
    const projection = projectKvOutcome('sub-1', {
      didConvert: true,
      conversionValue: 500,
      lostReason: 'ignored',
    });
    assert.deepEqual(projection, {
      submissionId: 'sub-1',
      didConvert: true,
      conversionValue: 500,
    });
  });

  it('coerces malformed KV fields to null (no throw)', () => {
    const projection = projectKvOutcome('sub-1', {
      didConvert: 'yes',
      conversionValue: 'lots',
    });
    assert.deepEqual(projection, {
      submissionId: 'sub-1',
      didConvert: null,
      conversionValue: null,
    });
  });

  it('returns null projection when KV blob is absent', () => {
    assert.equal(projectKvOutcome('sub-1', null), null);
  });
});

describe('outcome shadow read — compareOutcome', () => {
  it('reports match when both sides agree', () => {
    assert.deepEqual(compareOutcome(kv(), sql()), {
      status: 'match',
      mismatchFields: [],
    });
  });

  it('reports missing_sql when KV present and SQL absent', () => {
    assert.deepEqual(compareOutcome(kv(), null), {
      status: 'missing_sql',
      mismatchFields: [],
    });
  });

  it('reports missing_kv when SQL present and KV absent', () => {
    assert.deepEqual(compareOutcome(null, sql()), {
      status: 'missing_kv',
      mismatchFields: [],
    });
  });

  it('reports skipped when neither side is present', () => {
    assert.deepEqual(compareOutcome(null, null), {
      status: 'skipped',
      mismatchFields: [],
    });
  });

  it('flags conflicting business fields', () => {
    const result = compareOutcome(
      kv({ didConvert: true, conversionValue: 1000 }),
      sql({ didConvert: false, conversionValue: 2000 }),
    );
    assert.equal(result.status, 'mismatch');
    assert.deepEqual(result.mismatchFields.sort(), ['conversionValue', 'didConvert']);
  });

  it('does not flag a field the SQL side has not backfilled (null)', () => {
    const result = compareOutcome(
      kv({ didConvert: true, conversionValue: 1000 }),
      sql({ didConvert: null, conversionValue: null }),
    );
    assert.deepEqual(result, { status: 'match', mismatchFields: [] });
  });

  it('flags submissionId divergence', () => {
    const result = compareOutcome(kv({ submissionId: 'sub-1' }), sql({ submissionId: 'sub-2' }));
    assert.equal(result.status, 'mismatch');
    assert.deepEqual(result.mismatchFields, ['submissionId']);
  });
});

describe('outcome shadow read — shadowReadOutcome', () => {
  beforeEach(() => {
    resetShadowTelemetryForTests();
  });

  afterEach(() => {
    setEnvReaderForTests(null);
    resetShadowTelemetryForTests();
  });

  it('no-ops and never calls the reader when the flag is off', async () => {
    disable();
    let called = false;
    const reader: OutcomeSqlReader = async () => {
      called = true;
      return sql();
    };
    const result = await shadowReadOutcome({ submissionId: 'sub-1', kvOutcome: {}, reader });
    assert.equal(called, false);
    assert.equal(result.status, 'skipped');
    assert.equal(getRecentShadowReads().length, 0);
  });

  it('records a match and buffers telemetry when enabled', async () => {
    enable();
    const result = await shadowReadOutcome({
      submissionId: 'sub-1',
      kvOutcome: { didConvert: true, conversionValue: 1000 },
      reader: readerReturning(sql()),
    });
    assert.equal(result.status, 'match');
    assert.equal(result.domain, 'outcome');
    assert.equal(result.key, 'outcome:sub-1');
    const buffered = getRecentShadowReads();
    assert.equal(buffered.length, 1);
    assert.equal(buffered[0].status, 'match');
    assert.ok(typeof buffered[0].timestamp === 'string');
  });

  it('records missing_sql when SQL has no row', async () => {
    enable();
    const result = await shadowReadOutcome({
      submissionId: 'sub-1',
      kvOutcome: { didConvert: true },
      reader: readerReturning(null),
    });
    assert.equal(result.status, 'missing_sql');
    assert.equal(getRecentShadowReads().length, 1);
  });

  it('swallows reader failures as error status and never throws', async () => {
    enable();
    const reader: OutcomeSqlReader = async () => {
      throw new Error('supabase credentials missing');
    };
    const result = await shadowReadOutcome({ submissionId: 'sub-1', kvOutcome: {}, reader });
    assert.equal(result.status, 'error');
    assert.equal(getRecentShadowReads()[0].status, 'error');
  });

  it('does not buffer a skipped (both-absent) comparison when enabled', async () => {
    enable();
    const result = await shadowReadOutcome({
      submissionId: 'sub-1',
      kvOutcome: null,
      reader: readerReturning(null),
    });
    assert.equal(result.status, 'skipped');
    assert.equal(getRecentShadowReads().length, 0);
  });
});
