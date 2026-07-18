/**
 * BATCH 5 — RevenueIntelligenceDashboard snapshot derivation + aggregation tests
 *
 * The revenue backend derives a flat DealSnapshot[] deterministically from
 * authoritative persisted records (submissions, proposals, outcomes, objection
 * escalations) and computes a headline summary — no LLM, no invented metrics.
 * These tests lock the derivation mapping, the deterministic aggregation, and
 * the edge cases (empty data, missing timestamps, unconverted deals).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveDealSnapshots,
  summarizeSnapshots,
  deriveStage,
  bandForValue,
  type DeriveInput,
} from '../../supabase/functions/server/revenueSnapshot.ts';

const EMPTY: DeriveInput = { submissions: [], proposals: [], outcomes: [], escalations: [] };

describe('revenueSnapshot — deal-size band (deterministic calc)', () => {
  it('bands by value thresholds', () => {
    assert.equal(bandForValue(0), '$0–50K');
    assert.equal(bandForValue(49_999), '$0–50K');
    assert.equal(bandForValue(50_000), '$50K–100K');
    assert.equal(bandForValue(99_999), '$50K–100K');
    assert.equal(bandForValue(100_000), '$100K+');
    assert.equal(bandForValue(250_000), '$100K+');
  });
});

describe('revenueSnapshot — stage derivation precedence', () => {
  it('outcome.didConvert=true wins → closed_won', () => {
    assert.equal(deriveStage({ status: 'new' }, { status: 'sent' }, { didConvert: true }), 'closed_won');
  });
  it('outcome.didConvert=false → closed_lost even if proposal accepted', () => {
    assert.equal(deriveStage({ status: 'approved' }, { status: 'accepted' }, { didConvert: false }), 'closed_lost');
  });
  it('proposal status maps when no outcome', () => {
    assert.equal(deriveStage({}, { status: 'rejected' }, undefined), 'closed_lost');
    assert.equal(deriveStage({}, { status: 'accepted' }, undefined), 'approved_pending_contract');
    assert.equal(deriveStage({}, { status: 'viewed' }, undefined), 'proposal_viewed');
    assert.equal(deriveStage({}, { status: 'sent' }, undefined), 'proposal_sent');
    assert.equal(deriveStage({}, { status: 'draft' }, undefined), 'proposal_draft');
  });
  it('falls back to submission status / diagnostic_completed', () => {
    assert.equal(deriveStage({ status: 'approved' }, undefined, undefined), 'approved_pending_contract');
    assert.equal(deriveStage({ status: 'new' }, undefined, undefined), 'diagnostic_completed');
    assert.equal(deriveStage({ status: 'completed' }, undefined, undefined), 'diagnostic_completed');
  });
});

describe('revenueSnapshot — derivation from persisted records', () => {
  const input: DeriveInput = {
    submissions: [
      { id: 'sub_1', company: 'ExampleCo', industry: 'Finance', status: 'approved', owner: 'Sarah', submittedAt: '2026-02-01T00:00:00.000Z' },
      { id: 'sub_2', company: 'BuildRight', industry: 'Construction', status: 'new', submittedAt: '2026-02-10T00:00:00.000Z' },
      { id: 'sub_3', company: 'LostCorp', industry: 'Retail', status: 'completed', submittedAt: '2026-01-15T00:00:00.000Z' },
    ],
    proposals: [
      { submissionId: 'sub_1', status: 'accepted', sent_date: '2026-02-03T00:00:00.000Z', viewed_at: '2026-02-04T00:00:00.000Z', accepted_at: '2026-02-06T00:00:00.000Z', next_step_offer: { price: 120_000 } },
      { submissionId: 'sub_2', status: 'sent', sent_date: '2026-02-12T00:00:00.000Z', price: 40_000 },
      { submissionId: 'sub_3', status: 'rejected', sent_date: '2026-01-18T00:00:00.000Z', rejected_at: '2026-01-25T00:00:00.000Z', price: 60_000 },
    ],
    outcomes: [
      { submissionId: 'sub_1', didConvert: true, conversionValue: 125_000, loggedAt: '2026-02-08T00:00:00.000Z' },
      { submissionId: 'sub_3', didConvert: false, conversionValue: null, loggedAt: '2026-01-26T00:00:00.000Z' },
    ],
    escalations: [
      { submissionId: 'sub_3', objectionType: 'price', createdAt: '2026-01-20T00:00:00.000Z', resolvedAt: '2026-01-24T00:00:00.000Z', status: 'resolved' },
    ],
  };

  const snaps = deriveDealSnapshots(input);

  it('produces one snapshot per submission', () => {
    assert.equal(snaps.length, 3);
  });

  it('uses outcome conversionValue for won deals and proposal price otherwise', () => {
    const s1 = snaps.find(s => s.deal_id === 'sub_1')!;
    const s2 = snaps.find(s => s.deal_id === 'sub_2')!;
    assert.equal(s1.value, 125_000);           // from outcome (authoritative)
    assert.equal(s1.stage, 'closed_won');
    assert.equal(s1.deal_size_band, '$100K+');
    assert.equal(s1.contract_signed_at, '2026-02-08T00:00:00.000Z');
    assert.equal(s2.value, 40_000);            // from proposal.price
    assert.equal(s2.stage, 'proposal_sent');
    assert.equal(s2.contract_signed_at, null);
  });

  it('maps proposal timestamps into the snapshot verbatim', () => {
    const s1 = snaps.find(s => s.deal_id === 'sub_1')!;
    assert.equal(s1.proposal_sent_at, '2026-02-03T00:00:00.000Z');
    assert.equal(s1.proposal_viewed_at, '2026-02-04T00:00:00.000Z');
    assert.equal(s1.proposal_approved_at, '2026-02-06T00:00:00.000Z');
  });

  it('attaches objection type and resolution days from escalations', () => {
    const s3 = snaps.find(s => s.deal_id === 'sub_3')!;
    assert.equal(s3.objection_type, 'price');
    assert.equal(s3.objection_resolved_days, 4); // 2026-01-20 → 2026-01-24
    assert.equal(s3.stage, 'closed_lost');
  });

  it('never fabricates ROI actuals or region (governance: no invented metrics)', () => {
    for (const s of snaps) {
      assert.equal(s.actual_roi_pct, null);
      assert.equal(s.actual_payback_month, null);
      assert.equal(s.projected_roi_pct, 0);
      assert.equal(s.region, 'NA');
      assert.equal(s.scenario, 'expected');
      assert.equal(s.is_expired, false);
    }
  });

  it('summarizes deterministically', () => {
    const sum = summarizeSnapshots(snaps);
    assert.equal(sum.total_deals, 3);
    assert.equal(sum.proposals_sent, 3);
    assert.equal(sum.closed_won, 1);
    assert.equal(sum.closed_lost, 1);
    assert.equal(sum.closed_won_value, 125_000);
    assert.equal(sum.close_rate_pct, 33.3);        // 1 won / 3 sent
    assert.equal(sum.total_pipeline_value, 125_000 + 40_000 + 60_000);
  });
});

describe('revenueSnapshot — edge cases', () => {
  it('empty input yields empty snapshots and a zeroed summary', () => {
    const snaps = deriveDealSnapshots(EMPTY);
    assert.deepEqual(snaps, []);
    const sum = summarizeSnapshots(snaps);
    assert.equal(sum.total_deals, 0);
    assert.equal(sum.proposals_sent, 0);
    assert.equal(sum.close_rate_pct, 0);          // no divide-by-zero
    assert.equal(sum.closed_won_value, 0);
    assert.equal(sum.total_pipeline_value, 0);
  });

  it('skips submissions without an id', () => {
    const snaps = deriveDealSnapshots({ ...EMPTY, submissions: [{ company: 'NoId' }, { id: 'ok' }] });
    assert.equal(snaps.length, 1);
    assert.equal(snaps[0].deal_id, 'ok');
  });

  it('handles a submission with no proposal, outcome, or escalation', () => {
    const snaps = deriveDealSnapshots({ ...EMPTY, submissions: [{ id: 'bare', submittedAt: '2026-02-01T00:00:00.000Z' }] });
    const s = snaps[0];
    assert.equal(s.value, 0);
    assert.equal(s.stage, 'diagnostic_completed');
    assert.equal(s.proposal_sent_at, null);
    assert.equal(s.objection_type, null);
    assert.equal(s.objection_resolved_days, null);
    assert.equal(s.owner, 'Unassigned');
    assert.equal(s.client_name, 'Unknown');
  });

  it('leaves objection_resolved_days null for an unresolved escalation', () => {
    const snaps = deriveDealSnapshots({
      ...EMPTY,
      submissions: [{ id: 'x', submittedAt: '2026-02-01T00:00:00.000Z' }],
      escalations: [{ submissionId: 'x', objectionType: 'risk', createdAt: '2026-02-02T00:00:00.000Z', resolvedAt: null, status: 'active' }],
    });
    assert.equal(snaps[0].objection_type, 'risk');
    assert.equal(snaps[0].objection_resolved_days, null);
  });

  it('ignores an unknown objection type', () => {
    const snaps = deriveDealSnapshots({
      ...EMPTY,
      submissions: [{ id: 'x', submittedAt: '2026-02-01T00:00:00.000Z' }],
      escalations: [{ submissionId: 'x', objectionType: 'not_a_type', createdAt: '2026-02-02T00:00:00.000Z' }],
    });
    assert.equal(snaps[0].objection_type, null);
  });

  it('does not count a proposal that was never sent as proposals_sent', () => {
    const snaps = deriveDealSnapshots({
      ...EMPTY,
      submissions: [{ id: 'd', submittedAt: '2026-02-01T00:00:00.000Z' }],
      proposals: [{ submissionId: 'd', status: 'draft' }],
    });
    const sum = summarizeSnapshots(snaps);
    assert.equal(sum.proposals_sent, 0);
    assert.equal(snaps[0].stage, 'proposal_draft');
  });
});
