/**
 * Outcome comparison + projection tests — MCV2-S7.4-REMEDIATION (G3, G6)
 * and MCV2-S7.4-REMEDIATION-2 (D2, D3, D5).
 *
 * Proves the canonical, mutually-exclusive classification:
 *   match · mismatch · partial · missing_sql · missing_kv · error
 * and the directly-tested SQL projection `projectOutcomeRecord`.
 *
 * Focus cases required by the audit: fully populated, partially populated, and
 * conflicting records. An incomplete SQL row is NEVER classified as match.
 *
 * D5: SQL fixtures use ONLY schema-valid column values —
 *   status      ∈ ('open','closed','archived')   [lifecycle, NOT NULL]
 *   outcome_type ∈ ('engagement','won','lost','nurture','other')
 * per `outcomes` in 20260714050000_cortex_diagnostic_foundation.sql. The
 * previously-used `status: 'converted'` violated the CHECK constraint and masked
 * D2/D3.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ComparisonStatus,
  compareOutcome,
  outcomeErrorComparison,
  projectOutcomeRecord,
  hashEntityRef,
  SQL_LIFECYCLE_STATUSES,
  type CompareMeta,
} from '../../supabase/functions/server/storage/index.ts';

const ORG = 'org-123';

function meta(overrides: Partial<CompareMeta> = {}): CompareMeta {
  return {
    requestId: 'req-1',
    organizationId: ORG,
    effectiveOrg: ORG,
    entityRefHash: hashEntityRef('sub-1'),
    kvMs: 1,
    sqlMs: 2,
    ...overrides,
  };
}

// Fully-populated KV outcome.
function kvFull() {
  return {
    submissionId: 'sub-1',
    didConvert: true,
    conversionValue: 5000,
    lostReason: null,
    recommendationWorked: true,
    whatWeLearned: 'pricing clarity',
    improvementAreas: ['discovery', 'timeline'],
  };
}

/**
 * Matching, fully-populated SQL row (business fields in `value`).
 *
 * `submission_id` is a generated UUID — deliberately NOT the KV id `sub-1` —
 * mirroring production, where correlation happens via `legacy_kv_key` (D1).
 */
function sqlFull(extra: Record<string, unknown> = {}) {
  return {
    id: 'uuid-1',
    organization_id: ORG,
    submission_id: '11111111-2222-3333-4444-555555555555',
    legacy_kv_key: 'outcome:sub-1',
    outcome_type: 'won', // conversion signal: won → converted
    status: 'open', // LIFECYCLE — schema-valid, never compared
    value: {
      didConvert: true,
      conversionValue: 5000,
      recommendationWorked: true,
      whatWeLearned: 'pricing clarity',
      improvementAreas: ['timeline', 'discovery'], // different order → still match
    },
    ...extra,
  };
}

describe('projectOutcomeRecord (G6 mapping)', () => {
  it('maps business fields out of the value JSONB with column fallbacks', () => {
    const dto = projectOutcomeRecord(sqlFull());
    // SQL carries its own generated UUID, not the KV id — which is exactly why
    // submissionId is a relationship axis and is never compared (D1).
    assert.equal(dto?.submissionId, '11111111-2222-3333-4444-555555555555');
    assert.equal(dto?.didConvert, true);
    assert.equal(dto?.conversionValue, 5000);
    assert.equal(dto?.recommendationWorked, true);
    assert.equal(dto?.whatWeLearned, 'pricing clarity');
    // arrays are normalised order-independently
    assert.deepEqual(dto?.improvementAreas, ['discovery', 'timeline']);
    assert.equal(dto?.conversionStatus, 'converted');
  });

  it('returns null for a missing SQL row', () => {
    assert.equal(projectOutcomeRecord(null), null);
    assert.equal(projectOutcomeRecord(undefined), null);
  });

  it('treats an empty/absent value blob as all-null business fields', () => {
    const dto = projectOutcomeRecord({ submission_id: 'sub-1', status: 'open' });
    assert.equal(dto?.conversionValue, null);
    assert.equal(dto?.whatWeLearned, null);
    assert.deepEqual(dto?.improvementAreas, []);
  });

  // --- D2: lifecycle status is never a conversion signal --------------------

  it('never derives conversionStatus from the lifecycle status column', () => {
    for (const lifecycle of SQL_LIFECYCLE_STATUSES) {
      const dto = projectOutcomeRecord({
        organization_id: ORG,
        status: lifecycle,
        outcome_type: 'engagement', // carries no conversion signal
        value: {},
      });
      assert.equal(
        dto?.conversionStatus,
        null,
        `lifecycle status '${lifecycle}' must not produce a conversionStatus`,
      );
    }
  });

  it('derives conversionStatus from outcome_type won/lost', () => {
    assert.equal(projectOutcomeRecord({ outcome_type: 'won', value: {} })?.conversionStatus, 'converted');
    assert.equal(projectOutcomeRecord({ outcome_type: 'lost', value: {} })?.conversionStatus, 'lost');
  });

  it('prototype-chain keys in outcome_type never resolve to a non-string', () => {
    for (const hostile of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const dto = projectOutcomeRecord({ outcome_type: hostile, value: { didConvert: true } });
      // Falls through to the value.didConvert fallback — never a function/object.
      assert.equal(dto?.conversionStatus, 'converted');
      assert.equal(typeof dto?.conversionStatus, 'string');
    }
    const bare = projectOutcomeRecord({ outcome_type: 'constructor', value: {} });
    assert.equal(bare?.conversionStatus, null);
  });

  it('falls back to value.didConvert for non-conversion outcome_types', () => {
    for (const t of ['engagement', 'nurture', 'other']) {
      assert.equal(
        projectOutcomeRecord({ outcome_type: t, value: { didConvert: true } })?.conversionStatus,
        'converted',
        `outcome_type '${t}' should fall back to value.didConvert`,
      );
      assert.equal(
        projectOutcomeRecord({ outcome_type: t, value: { didConvert: false } })?.conversionStatus,
        'lost',
      );
    }
  });
});

describe('compareOutcome (G3 classification)', () => {
  it('fully populated + agreeing → match', () => {
    const cmp = compareOutcome(kvFull(), sqlFull(), meta());
    assert.equal(cmp.status, ComparisonStatus.MATCH);
    assert.equal(cmp.mismatchCount, 0);
    assert.deepEqual(cmp.mismatchFields, []);
    assert.equal(cmp.severity, 'info');
  });

  it('partially populated SQL row → partial (never match)', () => {
    // SQL is missing conversionValue + whatWeLearned that KV has.
    const sql = sqlFull();
    delete (sql.value as Record<string, unknown>).conversionValue;
    delete (sql.value as Record<string, unknown>).whatWeLearned;
    const cmp = compareOutcome(kvFull(), sql, meta());
    assert.equal(cmp.status, ComparisonStatus.PARTIAL);
    assert.notEqual(cmp.status, ComparisonStatus.MATCH);
    assert.deepEqual(cmp.mismatchFields.sort(), ['conversionValue', 'whatWeLearned']);
    assert.equal(cmp.severity, 'low');
  });

  it('conflicting values (both populated, differ) → mismatch', () => {
    const sql = sqlFull();
    (sql.value as Record<string, unknown>).conversionValue = 9999; // conflicts with KV 5000
    const cmp = compareOutcome(kvFull(), sql, meta());
    assert.equal(cmp.status, ComparisonStatus.MISMATCH);
    assert.deepEqual(cmp.mismatchFields, ['conversionValue']);
    assert.equal(cmp.severity, 'high');
  });

  it('mismatch takes precedence over partial when both occur', () => {
    const sql = sqlFull();
    (sql.value as Record<string, unknown>).conversionValue = 9999; // conflict
    delete (sql.value as Record<string, unknown>).whatWeLearned; // partial
    const cmp = compareOutcome(kvFull(), sql, meta());
    assert.equal(cmp.status, ComparisonStatus.MISMATCH);
    assert.deepEqual(cmp.mismatchFields, ['conversionValue']);
  });

  it('KV present, SQL row absent → missing_sql', () => {
    const cmp = compareOutcome(kvFull(), null, meta());
    assert.equal(cmp.status, ComparisonStatus.MISSING_SQL);
    assert.equal(cmp.severity, 'low');
  });

  it('SQL present, KV absent → missing_kv', () => {
    const cmp = compareOutcome(null, sqlFull(), meta());
    assert.equal(cmp.status, ComparisonStatus.MISSING_KV);
    assert.equal(cmp.severity, 'high');
  });

  it('both absent → match (nothing to reconcile)', () => {
    const cmp = compareOutcome(null, null, meta());
    assert.equal(cmp.status, ComparisonStatus.MATCH);
  });

  it('cross-tenant SQL row → mismatch (critical), never value/partial', () => {
    const sql = sqlFull({ organization_id: 'other-org' });
    const cmp = compareOutcome(kvFull(), sql, meta());
    assert.equal(cmp.status, ComparisonStatus.MISMATCH);
    assert.deepEqual(cmp.mismatchFields, ['organization_id']);
    assert.equal(cmp.severity, 'critical');
  });

  // --- D1: tenancy must FAIL CLOSED (legacy-key lookup is not tenant-scoped) --

  it('SQL row with absent organization_id → critical authorization mismatch', () => {
    const sql = sqlFull();
    delete (sql as Record<string, unknown>).organization_id;
    const cmp = compareOutcome(kvFull(), sql, meta());
    assert.equal(cmp.status, ComparisonStatus.MISMATCH);
    assert.deepEqual(cmp.mismatchFields, ['organization_id']);
    assert.equal(cmp.severity, 'critical');
  });

  it('SQL row with null organization_id → critical authorization mismatch', () => {
    const cmp = compareOutcome(kvFull(), sqlFull({ organization_id: null }), meta());
    assert.equal(cmp.status, ComparisonStatus.MISMATCH);
    assert.equal(cmp.severity, 'critical');
  });

  it('SQL read error → error status with class', () => {
    const cmp = outcomeErrorComparison(meta(), 'StorageReadError');
    assert.equal(cmp.status, ComparisonStatus.ERROR);
    assert.equal(cmp.sqlErrorClass, 'StorageReadError');
    assert.equal(cmp.severity, 'high');
  });

  it('never leaks raw values — only field paths in mismatchFields', () => {
    const sql = sqlFull();
    (sql.value as Record<string, unknown>).whatWeLearned = 'a secret note';
    const cmp = compareOutcome(kvFull(), sql, meta());
    assert.deepEqual(cmp.mismatchFields, ['whatWeLearned']);
    assert.ok(!JSON.stringify(cmp).includes('a secret note'));
  });
});

/**
 * D2 — the SQL LIFECYCLE status column must never influence classification.
 * Previously `status: 'closed'`/`'archived'` produced a false high-severity
 * `mismatch` on field `status` even when every business value agreed.
 */
describe('lifecycle status is excluded from comparison (D2)', () => {
  for (const lifecycle of SQL_LIFECYCLE_STATUSES) {
    it(`status='${lifecycle}' with agreeing business values → match`, () => {
      const cmp = compareOutcome(kvFull(), sqlFull({ status: lifecycle }), meta());
      assert.equal(cmp.status, ComparisonStatus.MATCH);
      assert.deepEqual(cmp.mismatchFields, []);
      assert.equal(cmp.severity, 'info');
    });
  }

  it('lifecycle status never appears in mismatchFields', () => {
    for (const lifecycle of SQL_LIFECYCLE_STATUSES) {
      const sql = sqlFull({ status: lifecycle });
      (sql.value as Record<string, unknown>).conversionValue = 9999;
      const cmp = compareOutcome(kvFull(), sql, meta());
      assert.equal(cmp.status, ComparisonStatus.MISMATCH);
      assert.ok(!cmp.mismatchFields.includes('status'));
      assert.deepEqual(cmp.mismatchFields, ['conversionValue']);
    }
  });

  it('a genuine conversion conflict is still caught (won vs KV lost)', () => {
    const kv = { ...kvFull(), didConvert: false, conversionValue: null, lostReason: 'budget' };
    // SQL says won/converted while KV says lost → real business mismatch.
    const sql = sqlFull({ outcome_type: 'won', value: { didConvert: true, lostReason: null } });
    const cmp = compareOutcome(kv, sql, meta());
    assert.equal(cmp.status, ComparisonStatus.MISMATCH);
    assert.ok(cmp.mismatchFields.includes('conversionStatus'));
    assert.ok(cmp.mismatchFields.includes('didConvert'));
    assert.equal(cmp.severity, 'high');
  });
});

/**
 * D3 — an SQL row that exists but carries no/incomplete business data must be
 * `partial`, never `match` and never a false `mismatch`.
 */
describe('incomplete SQL value blob → partial (D3)', () => {
  const degenerate: Array<[string, unknown]> = [
    ['missing value key', undefined],
    ['null value', null],
    ['malformed value (string)', 'not-an-object'],
    ['malformed value (number)', 42],
    ['empty object', {}],
    ['empty array', []],
  ];

  for (const [label, value] of degenerate) {
    it(`${label} → partial`, () => {
      const sql = sqlFull({
        // 'engagement' is the column default and carries no conversion signal,
        // so SQL genuinely has nothing to compare.
        outcome_type: 'engagement',
        status: 'open',
      }) as Record<string, unknown>;
      if (value === undefined) delete sql.value;
      else sql.value = value;

      const cmp = compareOutcome(kvFull(), sql, meta());
      assert.equal(cmp.status, ComparisonStatus.PARTIAL, `${label} must classify partial`);
      assert.notEqual(cmp.status, ComparisonStatus.MATCH);
      assert.notEqual(cmp.status, ComparisonStatus.MISMATCH);
      assert.equal(cmp.severity, 'low');
      assert.ok(!cmp.mismatchFields.includes('status'), 'lifecycle status must not be reported');
      // Every populated KV business field is reported as partial.
      assert.deepEqual(cmp.mismatchFields.sort(), [
        'conversionStatus',
        'conversionValue',
        'didConvert',
        'improvementAreas',
        'recommendationWorked',
        'whatWeLearned',
      ]);
    });
  }

  it('degenerate value stays partial across every lifecycle status', () => {
    for (const lifecycle of SQL_LIFECYCLE_STATUSES) {
      const sql = sqlFull({ outcome_type: 'engagement', status: lifecycle, value: {} });
      const cmp = compareOutcome(kvFull(), sql, meta());
      assert.equal(cmp.status, ComparisonStatus.PARTIAL, `lifecycle '${lifecycle}' must stay partial`);
    }
  });

  it('missing comparable business fields → partial, not match', () => {
    const sql = sqlFull({ outcome_type: 'won', value: { didConvert: true } });
    const cmp = compareOutcome(kvFull(), sql, meta());
    assert.equal(cmp.status, ComparisonStatus.PARTIAL);
    assert.deepEqual(cmp.mismatchFields.sort(), [
      'conversionValue',
      'improvementAreas',
      'recommendationWorked',
      'whatWeLearned',
    ]);
  });
});
