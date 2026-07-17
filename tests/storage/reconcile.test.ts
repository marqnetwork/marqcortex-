/**
 * Batch reconciliation tests — MCV2-S7.6
 *
 * Exercises the pure `reconcileOutcomes` aggregation with injected fakes (the
 * live CLI wires the real KV lister + SQL port). Read-only; no Deno/Supabase.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileOutcomes } from '../../scripts/storage/outcomeReconcile.ts';

const ORG = 'org-1';
function kvO(id: string, over: Record<string, unknown> = {}) {
  return { submissionId: id, didConvert: true, conversionValue: 1000, whatWeLearned: 'x', improvementAreas: ['a'], ...over };
}
function sqlRow(id: string, valueOver: Record<string, unknown> = {}, rowOver: Record<string, unknown> = {}) {
  return {
    id: 'u', organization_id: ORG, submission_id: id, legacy_kv_key: `outcome:${id}`, status: 'converted',
    value: { didConvert: true, conversionValue: 1000, whatWeLearned: 'x', improvementAreas: ['a'], ...valueOver }, ...rowOver,
  };
}

function sqlPortFor(map: Record<string, unknown>) {
  return { getOutcomeBySubmission: async (id: string) => (id in map ? map[id] : null) };
}

describe('S7.6 reconcileOutcomes', () => {
  it('all-match batch is Gate-C ready', async () => {
    const rep = await reconcileOutcomes({
      listKvOutcomes: async () => [kvO('A'), kvO('B')],
      sqlPort: sqlPortFor({ A: sqlRow('A'), B: sqlRow('B') }),
      organizationId: ORG,
    });
    assert.equal(rep.total, 2);
    assert.equal(rep.byOutcome['match'], 2);
    assert.equal(rep.unexplainedMismatchCount, 0);
    assert.equal(rep.gateCReady, true);
  });

  it('value mismatch blocks Gate-C and is sampled (paths only, no raw values)', async () => {
    const rep = await reconcileOutcomes({
      listKvOutcomes: async () => [kvO('A')],
      sqlPort: sqlPortFor({ A: sqlRow('A', { conversionValue: 9999 }) }),
      organizationId: ORG,
    });
    assert.equal(rep.unexplainedMismatchCount, 1);
    assert.equal(rep.gateCReady, false);
    assert.deepEqual(rep.samples[0].fields, ['conversionValue']);
    assert.equal(JSON.stringify(rep.samples).includes('9999'), false);
  });

  it('authorization mismatch is critical and blocks Gate-C', async () => {
    const rep = await reconcileOutcomes({
      listKvOutcomes: async () => [kvO('A')],
      sqlPort: sqlPortFor({ A: sqlRow('A', {}, { organization_id: 'org-OTHER' }) }),
      organizationId: ORG,
    });
    assert.equal(rep.authorizationMismatchCount, 1);
    assert.equal(rep.maxSeverity, 'critical');
    assert.equal(rep.gateCReady, false);
  });

  it('target_missing is tracked but does not itself block Gate-C', async () => {
    const rep = await reconcileOutcomes({
      listKvOutcomes: async () => [kvO('A')],
      sqlPort: sqlPortFor({}), // SQL has nothing
      organizationId: ORG,
    });
    assert.equal(rep.targetMissingCount, 1);
    assert.equal(rep.unexplainedMismatchCount, 0);
    assert.equal(rep.gateCReady, true);
  });

  it('SQL error is counted and blocks Gate-C via error rate', async () => {
    const rep = await reconcileOutcomes({
      listKvOutcomes: async () => [kvO('A')],
      sqlPort: { getOutcomeBySubmission: async () => { throw new Error('db down'); } },
      organizationId: ORG,
    });
    assert.equal(rep.errorCount, 1);
    assert.equal(rep.gateCReady, false);
  });

  it('KV entries without submissionId are skipped (quarantined from the batch)', async () => {
    const rep = await reconcileOutcomes({
      listKvOutcomes: async () => [kvO('A'), { didConvert: true } as unknown, null],
      sqlPort: sqlPortFor({ A: sqlRow('A') }),
      organizationId: ORG,
    });
    assert.equal(rep.skippedNoSubmissionId, 2);
    assert.equal(rep.total, 1);
  });
});
