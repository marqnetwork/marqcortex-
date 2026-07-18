/**
 * BATCH 4 — ObjectionHandlerPanel escalation trigger + recurrence contract
 *
 * Escalations are persisted only when an objection crosses the at-risk
 * threshold (detectObjection confidence > 0.65). These tests lock:
 *   1. the at-risk decision boundary that gates persistence, and
 *   2. the server recurrence rule (detectionCount / status) as an executable
 *      spec — count of prior still-active same-type escalations + 1, and
 *      status = 'persistent' once that reaches 2.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectObjection, getPlaybook } from '../../src/app/core/objectionEngine.ts';

// Mirrors the authoritative rule implemented by
// POST /submissions/:id/escalations in supabase/functions/server/index.tsx
type StoredEsc = { objectionType: string; status: 'active' | 'persistent' | 'resolved' };
function computeEscalation(prior: StoredEsc[], objectionType: string) {
  const active = prior.filter(e => e.objectionType === objectionType && e.status !== 'resolved');
  const detectionCount = active.length + 1;
  const status = detectionCount >= 2 ? 'persistent' : 'active';
  return { detectionCount, status };
}

describe('objection at-risk trigger (gates persistence)', () => {
  it('empty / no-keyword input is not at risk', () => {
    const r = detectObjection('looking forward to the kickoff');
    assert.equal(r.at_risk, false);
    assert.ok(r.confidence <= 0.65);
  });

  it('two weak signals stay below the 65% threshold', () => {
    // "cost" + "budget" → maxScore 2 → confidence 0.61 → not at risk
    const r = detectObjection('the cost against our budget');
    assert.equal(r.type, 'price');
    assert.equal(r.at_risk, false);
  });

  it('three or more signals cross the threshold and flag at risk', () => {
    // "price" + "expensive" + "budget" + "discount" → maxScore ≥ 3 → > 0.65
    const r = detectObjection('the price is expensive for our budget, can we get a discount');
    assert.equal(r.type, 'price');
    assert.equal(r.at_risk, true);
    assert.ok(r.confidence > 0.65);
  });

  it('every detected type resolves to a playbook', () => {
    const r = detectObjection('the board and CEO need sign off from the committee');
    assert.equal(r.type, 'internal_alignment');
    const pb = getPlaybook(r.type);
    assert.equal(pb.type, r.type);
    assert.ok(pb.response_points.length > 0);
  });
});

describe('escalation recurrence rule (server contract)', () => {
  it('first escalation of a type is active with count 1', () => {
    const { detectionCount, status } = computeEscalation([], 'price');
    assert.equal(detectionCount, 1);
    assert.equal(status, 'active');
  });

  it('second unresolved escalation of same type is persistent', () => {
    const prior: StoredEsc[] = [{ objectionType: 'price', status: 'active' }];
    const { detectionCount, status } = computeEscalation(prior, 'price');
    assert.equal(detectionCount, 2);
    assert.equal(status, 'persistent');
  });

  it('resolved prior escalations do not count toward recurrence', () => {
    const prior: StoredEsc[] = [
      { objectionType: 'price', status: 'resolved' },
      { objectionType: 'risk', status: 'active' },
    ];
    const { detectionCount, status } = computeEscalation(prior, 'price');
    assert.equal(detectionCount, 1);
    assert.equal(status, 'active');
  });
});
