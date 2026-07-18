/**
 * BATCH 4 — CortexReviewerModule review-persistence contract tests
 *
 * The reviewer module persists a ReviewerChecklist to KV via
 * kv.set(key, JSON.stringify(checklist)) and reloads it via safeJsonParse.
 * These tests lock the pure contract that persistence depends on:
 *   - the empty-checklist factory + completion/status helpers, and
 *   - that a finalized checklist survives a JSON round-trip unchanged
 *     (the exact transform the KV-backed endpoint performs).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_CHECKLIST,
  getCompletionPercentage,
  getOverallReviewStatus,
  getFlaggedItems,
  type ReviewerChecklist,
} from '../../src/app/types/reviewer-checklist.ts';

function newChecklist(): ReviewerChecklist {
  return {
    ...structuredClone(EMPTY_CHECKLIST),
    review_id: 'rev_test',
    lead_id: 'sub_123',
    reviewer_name: 'Reviewer',
    review_date: new Date('2026-07-18T00:00:00Z').toISOString(),
    review_type: 'report',
  };
}

const SECTION_KEYS = [
  'intake_quality',
  'diagnosis_accuracy',
  'scoring_sanity',
  'recommendation_control',
  'roi_validation',
  'report_quality',
  'call_readiness',
  'proposal_check',
] as const;

function checkEvery(checklist: ReviewerChecklist): ReviewerChecklist {
  for (const section of SECTION_KEYS) {
    for (const key of Object.keys(checklist[section].checks)) {
      checklist[section].checks[key].checked = true;
    }
  }
  return checklist;
}

describe('reviewer checklist persistence contract', () => {
  it('a fresh checklist is 0% complete and incomplete', () => {
    const c = newChecklist();
    assert.equal(getCompletionPercentage(c), 0);
    assert.equal(getOverallReviewStatus(c), 'incomplete');
  });

  it('checking every item yields 100% completion', () => {
    const c = checkEvery(newChecklist());
    assert.equal(getCompletionPercentage(c), 100);
  });

  it('partial completion is proportional and rounded', () => {
    const c = newChecklist();
    // 8 sections × 4 checks = 32 items; check 8 → 25%
    let checked = 0;
    for (const section of SECTION_KEYS) {
      for (const key of Object.keys(c[section].checks)) {
        if (checked < 8) { c[section].checks[key].checked = true; checked++; }
      }
    }
    assert.equal(getCompletionPercentage(c), 25);
  });

  it('flagged items are surfaced with underscores humanised', () => {
    const c = newChecklist();
    c.intake_quality.checks.answers_specific.flagged = true;
    const flagged = getFlaggedItems(c);
    assert.deepEqual(flagged, ['answers specific']);
  });

  it('a finalized checklist survives the KV JSON round-trip unchanged', () => {
    const c = checkEvery(newChecklist());
    c.time_spent_minutes = 12;
    c.revision_notes = 'Tone was solid; ROI ranges tightened.';
    c.final_decision = {
      decision: 'ready-to-send',
      approved_by: 'Reviewer',
      approved_at: new Date('2026-07-18T01:00:00Z').toISOString(),
      reviewer_signature: 'Reviewer',
      notes: c.revision_notes,
    };

    // This is exactly what the endpoint stores and reloads.
    const roundTripped = JSON.parse(JSON.stringify(c)) as ReviewerChecklist;

    assert.deepEqual(roundTripped, c);
    assert.equal(roundTripped.final_decision?.decision, 'ready-to-send');
    assert.equal(getCompletionPercentage(roundTripped), 100);
  });
});
