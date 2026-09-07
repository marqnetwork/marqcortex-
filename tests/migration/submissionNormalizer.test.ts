/**
 * The submission normalizer — Phase 2 of the KV to relational migration,
 * applied to the `sub:` domain (deferred by S6.2 and S6.3).
 *
 * Every mapping judgement the roadmap flagged for human review on this domain
 * lives in one pure function, so it can be argued with here rather than
 * discovered from a half-written table.
 *
 * The rule the whole suite tests: a record is quarantined only when writing it
 * would be WRONG, never when it is merely incomplete — and every guess the
 * backfill makes is named on the record it made it about.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { SubmissionNormalizationResult } from '../../supabase/functions/server/migration/submissionNormalizer.ts';
import {
  canonicalSubmissionHash,
  isSubmissionEmailIndexKey,
  isSubmissionEntityKey,
  normalizeAnswers,
  normalizeScore,
  normalizeSubmissionRecord,
  parseSubmissionKvRecord,
} from '../../supabase/functions/server/migration/submissionNormalizer.ts';

const ORG = '2a1f6f0e-0000-4000-8000-0000000000ff';
const KEY = 'sub:sub-9001';

function payload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-9001',
    company: 'Acme Ltd',
    contact: 'Dana Reed',
    email: 'Dana.Reed@Acme.test',
    phone: '+44 20 7000 0000',
    website: 'acme.test',
    industry: 'Manufacturing',
    industryId: 'manufacturing',
    employees: 'Not specified',
    revenue: 'Not specified',
    submittedAt: '2026-08-20T09:00:00.000Z',
    submittedDate: 'Aug 20, 2026',
    status: 'under-review',
    priority: 'high',
    completionScore: 88,
    qualityScore: 74,
    aiScore: 71,
    roiPotential: 'TBD',
    answers: { Q1: 'yes', q2: { picked: ['a', 'b'] } },
    isRead: false,
    ...overrides,
  };
}

function normalize(overrides: Record<string, unknown> = {}, key = KEY) {
  return normalizeSubmissionRecord(parseSubmissionKvRecord(key, payload(overrides)), ORG, key);
}

/**
 * The quarantine branch of the result.
 *
 * Cast once, here, with the assertion that earns it. The test boundary
 * (`tsconfig.node.json`) runs without `strictNullChecks`, and without it the
 * compiler does not narrow a discriminated union by its boolean discriminant —
 * `migration/domains/leads.ts` carries the same two errors for the same reason.
 * Casting in one named helper keeps that one compiler limitation out of every
 * case that has to read a rejection.
 */
function quarantined(
  result: SubmissionNormalizationResult,
  message: string,
): Extract<SubmissionNormalizationResult, { ok: false }> {
  assert.equal(result.ok, false, message);
  return result as Extract<SubmissionNormalizationResult, { ok: false }>;
}

function migrated(overrides: Record<string, unknown> = {}, key = KEY) {
  const result = normalize(overrides, key);
  assert.equal(result.ok, true, `expected a migrated record, got ${JSON.stringify(result)}`);
  assert.ok(result.ok);
  return result.record;
}

describe('Phase 2 submissions — keys', () => {
  it('separates the entity from the email index beside it', () => {
    assert.equal(isSubmissionEntityKey('sub:abc'), true);
    assert.equal(isSubmissionEntityKey('sub_email:a@b.test'), false);
    assert.equal(isSubmissionEmailIndexKey('sub_email:a@b.test'), true);
  });
});

describe('Phase 2 submissions — a well-formed submission maps to three destinations', () => {
  it('carries the documented column mapping', () => {
    const record = migrated();
    assert.equal(record.legacyKvKey, KEY);
    assert.equal(record.legacyId, 'sub-9001');
    assert.equal(record.companyName, 'Acme Ltd');
    assert.equal(record.contactName, 'Dana Reed');
    assert.equal(record.contactEmail, 'dana.reed@acme.test');
    assert.equal(record.industry, 'Manufacturing');
    assert.equal(record.submittedAt, '2026-08-20T09:00:00.000Z');
  });

  it('canonicalises status and priority to the relational vocabulary', () => {
    assert.equal(migrated({ status: 'under-review' }).status, 'under_review');
    assert.equal(migrated({ status: 'approved' }).status, 'won');
    assert.equal(migrated({ priority: 'URGENT' }).priority, 'urgent');
  });

  it('splits the answers object into rows the unique index will accept', () => {
    const record = migrated();
    assert.deepEqual(
      record.answers.map((answer) => answer.questionKey).sort(),
      ['q1', 'q2'],
      'question keys must be lower-cased for the check constraint',
    );
    const structured = record.answers.find((answer) => answer.questionKey === 'q2');
    assert.deepEqual(structured?.answerJson, { picked: ['a', 'b'] });
    assert.equal(structured?.answerText, '{"picked":["a","b"]}');
  });

  it('puts the three scores on the score row and nowhere else', () => {
    const record = migrated();
    assert.deepEqual(record.scores, { completionScore: 88, qualityScore: 74, aiScore: 71 });
  });

  it('keeps everything the columns do not carry, in a stable order', () => {
    const record = migrated();
    const remainder = record.metadata.kv_remainder as Record<string, unknown>;
    assert.deepEqual(Object.keys(remainder), ['employees', 'isRead', 'revenue', 'roiPotential', 'submittedDate']);
    assert.equal(remainder.isRead, false);
  });

  it('reads a written placeholder as absence rather than as a value', () => {
    // The capture route writes these literals where it has no value. Storing
    // them would put 'Not specified' in a website column.
    const record = migrated({ website: 'Not specified', phone: '' });
    assert.equal(record.website, null);
    assert.equal(record.phone, null);
  });
});

describe('Phase 2 submissions — quarantine only where writing would be wrong', () => {
  it('quarantines a blob that does not parse', () => {
    const result = normalizeSubmissionRecord(
      parseSubmissionKvRecord(KEY, '{not json'),
      ORG,
      KEY,
    );
    assert.equal(
      quarantined(result, 'a blob that does not parse must be quarantined').reasonCode,
      'MALFORMED_JSON',
    );
  });

  it('quarantines a payload that is not an object', () => {
    for (const raw of ['[]', '"a string"', '42']) {
      const result = normalizeSubmissionRecord(parseSubmissionKvRecord(KEY, raw), ORG, KEY);
      assert.equal(
        quarantined(result, `${raw} should not normalize`).reasonCode,
        'INVALID_PAYLOAD',
      );
    }
  });

  it('quarantines a submission with no email, because the column is NOT NULL', () => {
    const result = normalize({ email: '' });
    assert.equal(
      quarantined(result, 'a submission with no email must be quarantined').reasonCode,
      'MISSING_EMAIL',
    );
  });

  it('quarantines a submission with no company rather than inventing one', () => {
    // A fabricated company name would be put in front of a consultant as fact.
    const result = normalize({ company: '' });
    assert.equal(
      quarantined(result, 'a submission with no company must be quarantined').reasonCode,
      'MISSING_COMPANY',
    );
  });

  it('does NOT quarantine a submission that is merely incomplete', () => {
    const record = migrated({
      contact: '',
      phone: '',
      website: '',
      industry: '',
      answers: {},
      completionScore: null,
      qualityScore: null,
      aiScore: null,
    });
    assert.equal(record.contactName, null);
    assert.deepEqual(record.answers, []);
    assert.deepEqual(record.scores, { completionScore: null, qualityScore: null, aiScore: null });
  });
});

describe('Phase 2 submissions — every guess is named on the record it was made about', () => {
  it('names an unrecognised status separately from an absent one', () => {
    assert.ok(migrated({ status: 'teleported' }).inferredFields.includes('status_unrecognised'));
    assert.ok(migrated({ status: '' }).inferredFields.includes('status_default'));
    assert.equal(migrated({ status: 'teleported' }).status, 'new');
  });

  it('defaults a missing priority and says so', () => {
    const record = migrated({ priority: 'critical' });
    assert.equal(record.priority, 'medium');
    assert.ok(record.inferredFields.includes('priority_default'));
  });

  it('uses the epoch for a missing submitted-at rather than inventing today', () => {
    // An invented "now" would tell a consultant this submission arrived today.
    const record = migrated({ submittedAt: 'not a date' });
    assert.equal(record.submittedAt, new Date(0).toISOString());
    assert.ok(record.inferredFields.includes('submitted_at_default'));
  });

  it('drops an impossible score rather than storing it', () => {
    // The columns are plain INTEGER with no check constraint, so 4,300 would be
    // stored and shown. A blank score is better than a wrong one.
    assert.deepEqual(normalizeScore(4_300), { score: null, outOfRange: true });
    assert.deepEqual(normalizeScore(-1), { score: null, outOfRange: true });
    assert.deepEqual(normalizeScore('88'), { score: 88, outOfRange: false });
    assert.deepEqual(normalizeScore(null), { score: null, outOfRange: false });

    const record = migrated({ aiScore: 4_300 });
    assert.equal(record.scores.aiScore, null);
    assert.ok(record.inferredFields.includes('ai_score_out_of_range'));
  });

  it('records the inferences in metadata so reconciliation can find them', () => {
    const record = migrated({ status: 'teleported', submittedAt: '' });
    assert.deepEqual(record.metadata.backfill_inferred_fields, record.inferredFields);
  });

  it('marks a double-encoded record as such', () => {
    const doubled = JSON.stringify(JSON.stringify(payload()));
    const result = normalizeSubmissionRecord(parseSubmissionKvRecord(KEY, doubled), ORG, KEY);
    assert.ok(result.ok);
    assert.equal(result.record.metadata.kv_double_encoded, true);
  });
});

describe('Phase 2 submissions — answers respect the constraints they will be written under', () => {
  it('collapses keys that differ only in case, keeping the last', () => {
    // The unique index is on (submission_id, question_key), and the keys are
    // lower-cased to satisfy the check constraint — so two KV keys can collide.
    const { rows, dropped } = normalizeAnswers({ Q1: 'first', q1: 'second' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].answerText, 'second');
    assert.deepEqual(dropped, ['q1']);
  });

  it('drops an empty key and names it', () => {
    const { rows, dropped } = normalizeAnswers({ '': 'orphan', q1: 'kept' });
    assert.deepEqual(rows.map((row) => row.questionKey), ['q1']);
    assert.deepEqual(dropped, ['']);
  });

  it('records a collapse on the submission, so the count difference is explained', () => {
    const record = migrated({ answers: { Q1: 'a', q1: 'b' } });
    assert.ok(record.inferredFields.includes('answers_collapsed'));
    assert.deepEqual(record.metadata.backfill_dropped_answer_keys, ['q1']);
  });

  it('ignores an answers value that is not an object', () => {
    for (const answers of ['a string', 42, [], null]) {
      assert.deepEqual(normalizeAnswers(answers).rows, []);
    }
  });

  it('writes both the text and the structured form', () => {
    const { rows } = normalizeAnswers({ scalar: 'yes', structured: { a: 1 }, blank: null });
    const byKey = Object.fromEntries(rows.map((row) => [row.questionKey, row]));
    assert.equal(byKey.scalar.answerText, 'yes');
    assert.equal(byKey.scalar.answerJson, 'yes');
    assert.equal(byKey.structured.answerText, '{"a":1}');
    assert.equal(byKey.blank.answerText, null);
  });
});

describe('Phase 2 submissions — the reconciliation hash', () => {
  it('is stable across an edit the migration cannot act on', () => {
    // Answers are hashed as a count and a sorted key list. A consultant editing
    // one word must not read as migration drift.
    const before = canonicalSubmissionHash(migrated({ answers: { q1: 'yes' } }));
    const after = canonicalSubmissionHash(migrated({ answers: { q1: 'yes, definitely' } }));
    assert.equal(before, after);
  });

  it('changes when a record changes shape', () => {
    const before = canonicalSubmissionHash(migrated({ answers: { q1: 'yes' } }));
    const added = canonicalSubmissionHash(migrated({ answers: { q1: 'yes', q2: 'no' } }));
    const restatused = canonicalSubmissionHash(migrated({ status: 'approved' }));
    assert.notEqual(before, added);
    assert.notEqual(before, restatused);
  });

  it('does not depend on the order the answer keys arrived in', () => {
    const one = canonicalSubmissionHash(migrated({ answers: { q1: 'a', q2: 'b' } }));
    const other = canonicalSubmissionHash(migrated({ answers: { q2: 'b', q1: 'a' } }));
    assert.equal(one, other);
  });
});
