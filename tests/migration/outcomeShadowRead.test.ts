/**
 * MCV2-S7.4 — Outcome Shadow Read.
 *
 * The instrument that tells the migration whether the relational store agrees
 * with the store that is still serving. These tests hold the four invariants
 * the shadow read exists under — it changes nothing served, fails nothing,
 * runs bounded, and records no customer value — and then hold the comparison
 * rules that decide whether an operator can trust what it reports.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  OUTCOME_FIELDS,
  compareField,
  compareProjections,
  createShadowReader,
  outcomeKvKey,
  projectKvOutcome,
  projectSqlOutcome,
  submissionIdFromLegacyKey,
} from '../../supabase/functions/server/storage/index.ts';
import type { ShadowReadRecord } from '../../supabase/functions/server/storage/index.ts';

const SUBMISSION_ID = 'sub-4711';

function kvOutcome(overrides: Record<string, unknown> = {}) {
  return {
    submissionId: SUBMISSION_ID,
    loggedAt: '2026-09-01T10:15:30.412Z',
    loggedBy: 'user-1',
    didConvert: true,
    conversionValue: 1500,
    lostReason: null,
    recommendationWorked: true,
    whatWeLearned: 'the diagnostic landed',
    improvementAreas: [],
    industry: 'Manufacturing',
    company: 'Acme Ltd',
    aiScore: 71,
    submittedAt: '2026-08-20T09:00:00.000Z',
    ...overrides,
  };
}

function sqlOutcome(overrides: Record<string, unknown> = {}) {
  return {
    id: '2a1f6f0e-0000-4000-8000-000000000001',
    organization_id: '2a1f6f0e-0000-4000-8000-0000000000ff',
    submission_id: '2a1f6f0e-0000-4000-8000-000000000002',
    legacy_kv_key: outcomeKvKey(SUBMISSION_ID),
    outcome_type: 'won',
    status: 'closed',
    value: { conversionValue: 1500, lostReason: null },
    recorded_at: '2026-09-01T10:15:30+00:00',
    ...overrides,
  };
}

/** A reader with a hand-driven clock, so a deadline is deterministic. */
function reader(
  options: {
    enabled?: boolean;
    deadlineMs?: number;
    capacity?: number;
    onDivergence?: (record: ShadowReadRecord) => void;
  } = {},
) {
  let nowMs = 1_000;
  return {
    advance: (ms: number) => {
      nowMs += ms;
    },
    instance: createShadowReader({
      enabled: () => options.enabled ?? true,
      deadlineMs: () => options.deadlineMs ?? 250,
      now: () => nowMs,
      isoNow: () => new Date(nowMs).toISOString(),
      capacity: options.capacity,
      onDivergence: options.onDivergence,
    }),
  };
}

function observation(
  loadSql: () => Promise<unknown>,
  kv: Record<string, unknown> = kvOutcome(),
) {
  return {
    domain: 'outcome' as const,
    key: outcomeKvKey(SUBMISSION_ID),
    fields: OUTCOME_FIELDS,
    kv: projectKvOutcome(kv),
    loadSql,
    project: projectSqlOutcome,
  };
}

describe('S7.4 — the comparator does not report encoding as drift', () => {
  it('agrees on a timestamp that lost its milliseconds in a timestamptz', () => {
    assert.equal(
      compareField('timestamp', '2026-09-01T10:15:30.412Z', '2026-09-01T10:15:30+00:00'),
      null,
      'a millisecond the relational column cannot hold is not drift',
    );
  });

  it('still reports a timestamp that is genuinely a different second', () => {
    assert.equal(
      compareField('timestamp', '2026-09-01T10:15:30.412Z', '2026-09-01T10:15:31+00:00'),
      'value_mismatch',
    );
  });

  it('agrees on a numeric PostgreSQL sent as a string', () => {
    assert.equal(compareField('numeric', 1500, '1500.00'), null);
    assert.equal(compareField('numeric', 1500, '1499.99'), 'value_mismatch');
  });

  it('treats null, undefined and empty string as one absence', () => {
    assert.equal(compareField('text', '', null), null);
    assert.equal(compareField('text', undefined, ''), null);
    assert.equal(compareField('numeric', null, undefined), null);
  });

  it('distinguishes a mapping defect from real drift', () => {
    // Different shapes on the two sides is a bug in this repository. Different
    // values is a bug in the data. Sending an operator to the wrong one wastes
    // exactly the time the instrument exists to save.
    assert.equal(compareField('exact', true, 'true'), 'type_mismatch');
    assert.equal(compareField('exact', true, false), 'value_mismatch');
    assert.equal(compareField('numeric', 10, 'ten'), 'type_mismatch');
  });

  it('names which side is missing, because they mean different things', () => {
    assert.equal(compareField('text', 'present', null), 'missing_in_sql');
    assert.equal(compareField('text', null, 'present'), 'missing_in_kv');
  });

  it('compares the declared field set rather than the keys it happens to find', () => {
    // A mapping that dropped a field would otherwise report perfect agreement
    // for the rest of the migration.
    const divergences = compareProjections(
      [{ field: 'ghost', rule: 'text' }],
      { ghost: 'in kv' },
      {},
    );
    assert.deepEqual(divergences, [{ field: 'ghost', kind: 'missing_in_sql' }]);
  });
});

describe('S7.4 — the outcome projection compares the fact, not the spelling', () => {
  it('reads the KV identity out of the relational legacy key', () => {
    assert.equal(submissionIdFromLegacyKey(outcomeKvKey(SUBMISSION_ID)), SUBMISSION_ID);
    assert.equal(submissionIdFromLegacyKey('sub:other'), undefined);
    assert.equal(submissionIdFromLegacyKey(null), undefined);
  });

  it('maps didConvert and outcome_type onto one boolean', () => {
    assert.equal(projectKvOutcome(kvOutcome({ didConvert: false })).converted, false);
    assert.equal(projectSqlOutcome(sqlOutcome({ outcome_type: 'lost' })).converted, false);
    assert.equal(projectSqlOutcome(sqlOutcome()).converted, true);
  });

  it('treats the column default as no opinion rather than as a lost deal', () => {
    // `engagement` is the schema default. Projecting it as `false` would report
    // every un-migrated row as a lost deal, which is both wrong and alarming.
    assert.equal(projectSqlOutcome(sqlOutcome({ outcome_type: 'engagement' })).converted, undefined);
  });

  it('does not compare the denormalised submission snapshot', () => {
    // KV carries company, industry and score AS THEY WERE when the outcome was
    // logged; the relational model carries them live on the submission. A
    // company that renamed itself would report as drift forever, and the right
    // answer to that is not a migration fix.
    const compared = OUTCOME_FIELDS.map((spec) => spec.field);
    for (const snapshot of ['company', 'industry', 'aiScore', 'submittedAt']) {
      assert.ok(!compared.includes(snapshot), `${snapshot} is a snapshot, not a shared fact`);
    }
  });

  it('projects a malformed record to nothing rather than throwing', () => {
    // The migration inventory documented double-encoded and partial records.
    for (const malformed of [null, undefined, 'a string', 42, []]) {
      assert.deepEqual(projectKvOutcome(malformed), {});
      assert.deepEqual(projectSqlOutcome(malformed), {});
    }
  });

  it('reports agreement for a correctly migrated record', async () => {
    const { instance } = reader();
    await instance.observe(observation(() => Promise.resolve(sqlOutcome())));
    const summary = instance.report().domains[0];
    assert.equal(summary.agreed, 1);
    assert.equal(summary.diverged, 0);
    assert.equal(summary.mismatchRatePercent, 0);
  });

  it('reports the field that actually drifted', async () => {
    const { instance } = reader();
    await instance.observe(
      observation(() => Promise.resolve(sqlOutcome({ value: { conversionValue: 900 } }))),
    );
    const summary = instance.report().domains[0];
    assert.equal(summary.diverged, 1);
    assert.equal(summary.byField.conversionValue, 1);
    assert.equal(summary.byKind.value_mismatch, 1);
    assert.equal(summary.mismatchRatePercent, 100);
  });
});

describe('S7.4 — the shadow read cannot hurt the request it observes', () => {
  it('does nothing at all while it is disabled', async () => {
    let called = false;
    const { instance } = reader({ enabled: false });
    await instance.observe(
      observation(() => {
        called = true;
        return Promise.resolve(sqlOutcome());
      }),
    );
    assert.equal(called, false, 'a disabled reader must not touch the relational store');
    assert.deepEqual(instance.report().domains, []);
  });

  it('absorbs a relational failure instead of raising it', async () => {
    const { instance } = reader();
    await assert.doesNotReject(() =>
      instance.observe(observation(() => Promise.reject(new Error('relation does not exist')))),
    );
    assert.equal(instance.report().domains[0].errors, 1);
  });

  it('absorbs a synchronous throw from the loader', async () => {
    const { instance } = reader();
    await assert.doesNotReject(() =>
      instance.observe(
        observation(() => {
          throw new Error('client was never constructed');
        }),
      ),
    );
    assert.equal(instance.report().domains[0].errors, 1);
  });

  it('abandons a slow relational read at the deadline', async () => {
    const { instance } = reader({ deadlineMs: 10 });
    await instance.observe(
      observation(() => new Promise((resolve) => setTimeout(() => resolve(sqlOutcome()), 200))),
    );
    const summary = instance.report().domains[0];
    assert.equal(summary.timeouts, 1);
    assert.equal(summary.agreed, 0);
  });

  it('does not raise when the abandoned read fails later', async () => {
    // The losing promise cannot be withdrawn. Its rejection must be absorbed
    // here rather than surfacing as an unhandled rejection after the request
    // has already been answered.
    const { instance } = reader({ deadlineMs: 5 });
    await instance.observe(
      observation(
        () =>
          new Promise((_resolve, reject) =>
            setTimeout(() => reject(new Error('late failure')), 40),
          ),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(instance.report().domains[0].timeouts, 1);
  });

  it('returns nothing a caller could serve', async () => {
    const { instance } = reader();
    const result = await instance.observe(observation(() => Promise.resolve(sqlOutcome())));
    assert.equal(result, undefined, 'the reader must not hand a relational row back');
  });
});

describe('S7.4 — an un-backfilled store reads as un-backfilled, not as broken', () => {
  it('records an absent relational row as its own result', async () => {
    // The outcome backfill has not been written. On the day this ships, this is
    // what a real deployment reports, and it must not look like corruption.
    const { instance } = reader();
    await instance.observe(observation(() => Promise.resolve(null)));
    const summary = instance.report().domains[0];
    assert.equal(summary.rowAbsent, 1);
    assert.equal(summary.diverged, 0);
    assert.equal(summary.errors, 0);
  });

  it('reports no mismatch rate when nothing was comparable', async () => {
    // `null`, not zero. Counting an absent row as agreement would report a
    // migration as healthy precisely when the instrument had nothing to read.
    const { instance } = reader();
    await instance.observe(observation(() => Promise.resolve(null)));
    assert.equal(instance.report().domains[0].mismatchRatePercent, null);
  });
});

describe('S7.4 — the record carries schema, never data', () => {
  it('holds no value from either store', async () => {
    const captured: ShadowReadRecord[] = [];
    const { instance } = reader({ onDivergence: (record) => captured.push(record) });
    await instance.observe(
      observation(
        () => Promise.resolve(sqlOutcome({ value: { conversionValue: 900, lostReason: 'price' } })),
        kvOutcome({ conversionValue: 1500, lostReason: 'timing', company: 'Acme Ltd' }),
      ),
    );

    const serialized = JSON.stringify(instance.report());
    for (const value of ['Acme', 'Manufacturing', 'price', 'timing', '1500', '900', 'user-1']) {
      assert.ok(!serialized.includes(value), `the shadow report leaked ${value}`);
    }
    assert.equal(captured.length, 1, 'a divergence is announced');
    assert.ok(captured[0].divergences.length > 0);
  });

  it('keeps the key, because a divergence nobody can locate is not actionable', async () => {
    const { instance } = reader();
    await instance.observe(observation(() => Promise.resolve(sqlOutcome())));
    assert.equal(instance.report().recent[0].key, outcomeKvKey(SUBMISSION_ID));
  });

  it('announces nothing when the stores agree', async () => {
    let announced = 0;
    const { instance } = reader({ onDivergence: () => (announced += 1) });
    await instance.observe(observation(() => Promise.resolve(sqlOutcome())));
    assert.equal(announced, 0);
  });
});

describe('S7.4 — the report is bounded and readable', () => {
  it('drops the oldest record rather than refusing the newest', async () => {
    const { instance } = reader({ capacity: 2 });
    for (let index = 0; index < 3; index += 1) {
      await instance.observe(observation(() => Promise.resolve(sqlOutcome())));
    }
    assert.equal(instance.report(50).recent.length, 2);
    assert.equal(instance.report().domains[0].reads, 2);
  });

  it('states whether it is switched on, so an empty report is not read as agreement', () => {
    const { instance } = reader({ enabled: false });
    const report = instance.report();
    assert.equal(report.enabled, false);
    assert.equal(report.deadlineMs, 250);
  });

  it('clears on reset', async () => {
    const { instance } = reader();
    await instance.observe(observation(() => Promise.resolve(sqlOutcome())));
    instance.reset();
    assert.deepEqual(instance.report().domains, []);
  });
});
