/**
 * Outcome comparison + projection tests — MCV2-S7.4-REMEDIATION (G3, G6)
 *
 * Proves the canonical, mutually-exclusive classification:
 *   match · mismatch · partial · missing_sql · missing_kv · error
 * and the directly-tested SQL projection `projectOutcomeRecord`.
 *
 * Focus cases required by the audit: fully populated, partially populated, and
 * conflicting records. An incomplete SQL row is NEVER classified as match.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ComparisonStatus,
  compareOutcome,
  outcomeErrorComparison,
  projectOutcomeRecord,
  hashEntityRef,
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

// Matching, fully-populated SQL row (business fields in `value`).
function sqlFull(extra: Record<string, unknown> = {}) {
  return {
    id: 'uuid-1',
    organization_id: ORG,
    submission_id: 'sub-1',
    legacy_kv_key: 'outcome:sub-1',
    outcome_type: 'engagement',
    status: 'converted',
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
    assert.equal(dto?.submissionId, 'sub-1');
    assert.equal(dto?.didConvert, true);
    assert.equal(dto?.conversionValue, 5000);
    assert.equal(dto?.recommendationWorked, true);
    assert.equal(dto?.whatWeLearned, 'pricing clarity');
    // arrays are normalised order-independently
    assert.deepEqual(dto?.improvementAreas, ['discovery', 'timeline']);
    assert.equal(dto?.status, 'converted');
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
