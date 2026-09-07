/**
 * MCV2-S7.7 — Submission Shadow Read.
 *
 * The instrument from S7.4, aimed at the platform's core entity. These tests
 * hold the projection decisions that decide whether the report is trustworthy —
 * chiefly the status vocabulary, where the two stores genuinely speak
 * differently and a careless mapping would report total drift or, worse,
 * silently agree about the wrong thing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SUBMISSION_FIELDS,
  canonicalSubmissionPriority,
  canonicalSubmissionStatus,
  compareProjections,
  createShadowReader,
  projectKvSubmission,
  projectSqlSubmission,
  submissionKvKey,
} from '../../supabase/functions/server/storage/index.ts';

const SUBMISSION_ID = 'sub-9001';

function kvSubmission(overrides: Record<string, unknown> = {}) {
  return {
    id: SUBMISSION_ID,
    company: 'Acme Ltd',
    contact: 'Dana Reed',
    email: 'Dana.Reed@Acme.test',
    phone: '+44 20 7000 0000',
    website: 'acme.test',
    industry: 'Manufacturing',
    industryId: 'manufacturing',
    employees: 'Not specified',
    revenue: 'Not specified',
    submittedAt: '2026-08-20T09:00:00.123Z',
    submittedDate: 'Aug 20, 2026',
    status: 'under-review',
    priority: 'high',
    completionScore: 88,
    qualityScore: 74,
    aiScore: 71,
    roiPotential: 'TBD',
    answers: { q1: 'a', q2: 'b' },
    isRead: false,
    ...overrides,
  };
}

function sqlSubmission(overrides: Record<string, unknown> = {}) {
  return {
    id: '2a1f6f0e-0000-4000-8000-000000000010',
    organization_id: '2a1f6f0e-0000-4000-8000-0000000000ff',
    legacy_kv_key: submissionKvKey(SUBMISSION_ID),
    legacy_id: SUBMISSION_ID,
    company_name: 'Acme Ltd',
    contact_name: 'Dana Reed',
    contact_email: 'dana.reed@acme.test',
    phone: '+44 20 7000 0000',
    website: 'acme.test',
    industry: 'Manufacturing',
    status: 'under_review',
    priority: 'high',
    completion_score: 88,
    quality_score: 74,
    ai_score: 71,
    submitted_at: '2026-08-20T09:00:00+00:00',
    ...overrides,
  };
}

function reader() {
  let nowMs = 1_000;
  return createShadowReader({
    enabled: () => true,
    deadlineMs: () => 250,
    now: () => nowMs++,
    isoNow: () => new Date(nowMs).toISOString(),
  });
}

function observation(sql: unknown, kv: Record<string, unknown> = kvSubmission()) {
  return {
    domain: 'submission' as const,
    key: submissionKvKey(SUBMISSION_ID),
    fields: SUBMISSION_FIELDS,
    kv: projectKvSubmission(kv),
    loadSql: () => Promise.resolve(sql),
    project: projectSqlSubmission,
  };
}

describe('S7.7 — a correctly migrated submission reads as agreement', () => {
  it('agrees across every compared field', async () => {
    const instance = reader();
    await instance.observe(observation(sqlSubmission()));
    const summary = instance.report().domains[0];
    assert.equal(summary.domain, 'submission');
    assert.equal(summary.agreed, 1);
    assert.equal(summary.diverged, 0);
  });

  it('does not report the console vocabulary as drift', async () => {
    // KV writes `under-review`; the relational check constraint requires
    // `under_review`. Same fact, two spellings.
    const divergences = compareProjections(
      SUBMISSION_FIELDS,
      projectKvSubmission(kvSubmission({ status: 'under-review' })),
      projectSqlSubmission(sqlSubmission({ status: 'under_review' })),
    );
    assert.deepEqual(divergences, []);
  });

  it('maps the console word for a converted deal onto the relational one', () => {
    // `approved` is the console's word for `won`. A blanket hyphen-to-underscore
    // rule would map it to `approved`, which the check constraint rejects — so
    // every converted deal would be quarantined and nobody would learn why.
    assert.equal(canonicalSubmissionStatus('approved'), 'won');
    assert.equal(canonicalSubmissionStatus('completed'), 'won');
    assert.equal(canonicalSubmissionStatus('sent'), 'proposal_sent');
    assert.equal(canonicalSubmissionStatus('in-review'), 'under_review');
  });

  it('treats an unknown status as a mapping gap rather than as drift', async () => {
    // Passing it through would say "these stores hold different statuses" when
    // the truth is that this repository does not know what the status means.
    assert.equal(canonicalSubmissionStatus('teleported'), undefined);
    const divergences = compareProjections(
      SUBMISSION_FIELDS,
      projectKvSubmission(kvSubmission({ status: 'teleported' })),
      projectSqlSubmission(sqlSubmission({ status: 'new' })),
    );
    assert.deepEqual(divergences, [{ field: 'status', kind: 'missing_in_kv' }]);
  });

  it('admits only the priorities the relational constraint allows', () => {
    assert.equal(canonicalSubmissionPriority('URGENT'), 'urgent');
    assert.equal(canonicalSubmissionPriority('critical'), undefined);
  });

  it('normalises the email on both sides', () => {
    assert.equal(projectKvSubmission(kvSubmission()).contactEmail, 'dana.reed@acme.test');
    assert.equal(projectSqlSubmission(sqlSubmission()).contactEmail, 'dana.reed@acme.test');
  });
});

describe('S7.7 — what the projection deliberately leaves out', () => {
  const compared = SUBMISSION_FIELDS.map((spec) => spec.field);

  it('does not compare presentation fields', () => {
    // `submittedDate` is `submittedAt` formatted for a browser and `isRead` is
    // a console flag. Comparing a formatted date against a timestamptz would
    // report drift on every record.
    for (const field of ['submittedDate', 'isRead', 'industryId']) {
      assert.ok(!compared.includes(field), `${field} is presentation, not a shared fact`);
    }
  });

  it('does not compare the answer map as a field', () => {
    // `answers` migrates to `diagnostic_answers` as ROWS. Comparing an object
    // against a table is a different check and belongs in its own domain — a
    // report of `answers=value_mismatch` tells an operator nothing actionable.
    assert.ok(!compared.includes('answers'));
  });

  it('reads a written placeholder as absence on both sides', async () => {
    // The capture route writes the literal 'Not specified' and 'TBD' where it
    // has no value, and there is no relational column for either. Comparing
    // them would report a mismatch that no migration could ever fix.
    assert.equal(projectKvSubmission(kvSubmission({ website: 'Not specified' })).website, undefined);
    assert.equal(projectSqlSubmission(sqlSubmission({ website: null })).website, undefined);
    const instance = reader();
    await instance.observe(
      observation(sqlSubmission({ website: null }), kvSubmission({ website: 'Not specified' })),
    );
    assert.equal(instance.report().domains[0].agreed, 1);
  });
});

describe('S7.7 — real drift is still reported, and named', () => {
  it('names the field that actually differs', async () => {
    const instance = reader();
    await instance.observe(observation(sqlSubmission({ ai_score: 40, status: 'won' })));
    const summary = instance.report().domains[0];
    assert.equal(summary.diverged, 1);
    assert.equal(summary.byField.aiScore, 1);
    assert.equal(summary.byField.status, 1);
    assert.equal(summary.byKind.value_mismatch, 2);
  });

  it('separates the two domains in one report', async () => {
    const instance = reader();
    await instance.observe(observation(sqlSubmission()));
    await instance.observe({
      ...observation(sqlSubmission({ ai_score: 1 })),
      domain: 'outcome' as const,
      key: 'outcome:sub-9001',
    });
    const report = instance.report();
    assert.deepEqual(
      report.domains.map((entry) => entry.domain),
      ['outcome', 'submission'],
      'the report is one report, aimed per domain',
    );
  });

  it('projects a malformed record to nothing rather than throwing', () => {
    for (const malformed of [null, undefined, 'a string', 42, []]) {
      assert.deepEqual(projectKvSubmission(malformed), {});
      assert.deepEqual(projectSqlSubmission(malformed), {});
    }
  });

  it('reports an un-backfilled submission as absent, not as broken', async () => {
    const instance = reader();
    await instance.observe(observation(null));
    const summary = instance.report().domains[0];
    assert.equal(summary.rowAbsent, 1);
    assert.equal(summary.mismatchRatePercent, null);
  });
});
