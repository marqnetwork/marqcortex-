/**
 * Adversarial reuse (AI-01 Batch 3B, Part 6B).
 *
 * ── THE QUESTION THIS SUITE ASKS ───────────────────────────────────────────
 *
 * `intelligentReuse.test.ts` asks whether the cache works. This asks whether it
 * can be made to LIE — about tenancy, about authority, and above all about
 * money.
 *
 * A cache is the single most attractive place in a cost-optimisation platform to
 * manufacture savings, because an avoided call leaves NO PROVIDER INVOICE. There
 * is nothing external to reconcile against: the only record that an inference
 * did not happen is the one the platform writes about itself. Every other
 * savings figure in Cortex can eventually be checked against a bill; this one
 * cannot, which is why it gets a suite whose whole purpose is to try to inflate
 * it.
 *
 * Six specific frauds are attempted below, each of which produces a plausible
 * number and each of which this design refuses:
 *
 *   1. Read one cached result ten times, count ten avoided calls.
 *   2. Count a candidate the gate REJECTED as a hit.
 *   3. Count an expired result as reuse.
 *   4. Count a cross-tenant rejection as a saving.
 *   5. Count what the SOURCE generation cost as newly avoided cost.
 *   6. Record one avoided call as both exact and semantic.
 *
 * ── AND THE ONE THAT IS NOT ABOUT MONEY ────────────────────────────────────
 *
 * A cache hit is not an authorization. The security cases prove that an
 * unauthorized caller, a bypassed approval, an invalid certification and an
 * engaged kill switch each produce a MISS — because "no provider call occurs"
 * is not permission to skip the checks that decide whether the operation may
 * happen at all.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { compressCost } from '../optimization/costCompressionEngine.ts';
import { reconcileSavings, rollupSavings } from '../optimization/ledger/savingsLedger.ts';
import { summarizeCompression } from '../optimization/metrics/compressionMetrics.ts';
import type { CompressionPlan } from '../optimization/costCompressionEngine.ts';

import { buildReuseIdentity, sealSemanticMetadata } from '../reuse/identity/reuseIdentity.ts';
import { evaluateReuseEligibility } from '../reuse/engine/eligibilityGate.ts';
import { resolveReuse } from '../reuse/engine/reuseDecisionPipeline.ts';
import { invalidateReusableResults } from '../reuse/engine/invalidationEngine.ts';
import { createInMemoryReusableResultStore } from '../reuse/persistence/ports.ts';
import { createDeclaredFeatureDiscovery } from '../reuse/discovery/declaredFeatureDiscovery.ts';
import {
  emptyAvoidedCallLedger,
  recordAvoidedCall,
  reconcileAvoidedCalls,
  totalAvoidedCalls,
} from '../reuse/accounting/avoidedCallLedger.ts';
import { summarizeReuse } from '../reuse/metrics/reuseMetrics.ts';
import { isReuseError } from '../reuse/contracts/failures.ts';
import type { ReusableResultStore } from '../reuse/persistence/ports.ts';
import type { ReuseResolution } from '../reuse/engine/reuseDecisionPipeline.ts';

import {
  CURRENT_DEPENDENCIES,
  EVIDENCE_DEPENDENCY,
  HOUR,
  NOW,
  ORG,
  OTHER_ORG,
  authority,
  envelope,
  freshness,
  identityInput,
  outputEnvelope,
  posture,
  quality,
  record,
  request,
  task,
  version,
} from './reuseFixtures.ts';

/**
 * The bridge between Part 6B and Part 6A, exactly as a caller uses it.
 *
 * The reuse layer produces a `ValidatedPriorOutput`; the caller puts it on the
 * descriptor; `compressCost` returns a plan with `decision: 'reuse'` whose
 * savings record is built by the ONE savings ledger. Part 6B adds nothing to
 * that path, which is the whole point of the integration.
 */
function planFor(resolution: ReuseResolution, taskId = 'task_live_001'): CompressionPlan {
  const prior = resolution.priorOutput;
  return compressCost({
    task: task({
      taskId,
      ...(prior === undefined ? {} : { priorOutputs: [prior] }),
    }),
    envelope: envelope(),
    contextItems: [],
  });
}

async function storeWith(...records: readonly Awaited<ReturnType<typeof record>>[]) {
  const store = createInMemoryReusableResultStore();
  for (const entry of records) await store.put(entry);
  return store;
}

// ── Security ────────────────────────────────────────────────────────────────

describe('Part 6B adversarial — a cache hit is not an authorization', () => {
  it('makes a cross-tenant exact lookup impossible, not merely refused', async () => {
    const theirs = record({
      identity: buildReuseIdentity(identityInput({ organizationId: OTHER_ORG })),
    });
    const store = await storeWith(theirs);

    // Asking as ORG, with ORG's identity: the key is a different key.
    const honest = await resolveReuse({ store, eligibility: request() });
    assert.equal(honest.outcome, 'miss');
    assert.equal(honest.record, undefined);

    // Asking as ORG while carrying the OTHER tenant's identity: refused before a
    // store is touched at all.
    const forged = await resolveReuse({
      store,
      eligibility: request({
        identity: buildReuseIdentity(identityInput({ organizationId: OTHER_ORG })),
      }),
    });
    assert.equal(forged.outcome, 'miss');
    assert.equal(forged.missReason, 'tenant_mismatch');
    assert.equal(forged.evaluations.length, 0, 'no record may be read across a tenant boundary');
  });

  it('makes cross-tenant semantic discovery impossible', async () => {
    const theirs = record({
      identity: buildReuseIdentity(
        identityInput({ organizationId: OTHER_ORG, inputDigest: 'sha256:their_input' }),
      ),
    });
    const store = await storeWith(theirs);
    const semantic = sealSemanticMetadata('quote_summary', ['quote', 'pricing', 'summary']);

    // The honest port cannot see it: the store's query is organization-scoped.
    const viaPort = await resolveReuse({
      store,
      eligibility: request(),
      discovery: createDeclaredFeatureDiscovery({ store }),
      semantic: { ...semantic, minimumSimilarity: 0, maximumCandidates: 5 },
    });
    assert.equal(viaPort.outcome, 'miss');
    assert.equal(viaPort.attempts.semanticCandidates, 0);

    // A HOSTILE port that returns the other tenant's id outright achieves
    // nothing: the reload is org-scoped, so it resolves to no record.
    const viaHostilePort = await resolveReuse({
      store,
      eligibility: request(),
      discovery: {
        discover: () =>
          Promise.resolve([
            {
              reusableResultId: theirs.reusableResultId,
              similarity: 100,
              method: 'declared_fingerprint' as const,
              // Even the candidate's own claimed organization is a lie, and it
              // is never used for scoping.
              organizationId: ORG,
            },
          ]),
      },
      semantic: { ...semantic, minimumSimilarity: 0, maximumCandidates: 5 },
    });
    assert.equal(viaHostilePort.outcome, 'miss');
    assert.equal(viaHostilePort.record, undefined);
    assert.equal(viaHostilePort.attempts.semanticHits, 0);
  });

  it('makes cross-tenant invalidation impossible', async () => {
    const theirs = record({
      identity: buildReuseIdentity(identityInput({ organizationId: OTHER_ORG })),
    });
    const store = await storeWith(theirs);

    const report = await invalidateReusableResults(store, {
      organizationId: ORG,
      scope: { kind: 'result', reusableResultId: theirs.reusableResultId },
      reason: 'explicit_result_invalidation',
      at: NOW,
      requestedBy: 'user_attacker',
    });
    assert.equal(report.invalidated, 0);
    assert.equal(report.scanned, 0);

    // Their record is untouched, including under the blunt organization scope.
    await invalidateReusableResults(store, {
      organizationId: ORG,
      scope: { kind: 'organization' },
      reason: 'organization_invalidated',
      at: NOW,
      requestedBy: 'user_attacker',
    });
    assert.equal((await store.getById(OTHER_ORG, theirs.reusableResultId))?.invalidatedAt, undefined);
  });

  it('gives an unauthorized caller nothing from the cache', async () => {
    const store = await storeWith(record());
    const resolution = await resolveReuse({
      store,
      eligibility: request({ authority: authority({ callerAuthorized: false }) }),
    });
    assert.equal(resolution.outcome, 'miss');
    assert.equal(resolution.missReason, 'caller_not_authorized');
    assert.equal(resolution.priorOutput, undefined, 'no output may reach an unauthorized caller');
    assert.equal(resolution.record, undefined);
  });

  it('never lets reuse be the reason an approval was not needed', async () => {
    const store = await storeWith(record());
    const resolution = await resolveReuse({
      store,
      eligibility: request({ authority: authority({ approvalSatisfied: false }) }),
    });
    assert.equal(resolution.outcome, 'miss');
    assert.equal(resolution.missReason, 'approval_required');
    assert.equal(resolution.priorOutput, undefined);
  });

  it('never lets reuse bypass certification', async () => {
    const store = await storeWith(record());
    for (const override of [
      { authority: authority({ certificationValid: false }) },
      { version: version({ agentCertificationId: 'cert_revoked' }) },
    ]) {
      const resolution = await resolveReuse({ store, eligibility: request(override) });
      assert.equal(resolution.outcome, 'miss');
      assert.equal(resolution.missReason, 'certification_invalid');
    }
  });

  /**
   * THE KILL SWITCH. The rule, stated and tested rather than assumed: cached
   * output must not be used to satisfy an operation the emergency stop
   * prohibits. Both layers refuse independently — the reuse gate produces a
   * miss, and Part 6A denies — so neither is load-bearing alone.
   */
  it('never lets cached output bypass the platform AI stop', async () => {
    const store = await storeWith(record());
    const resolution = await resolveReuse({
      store,
      eligibility: request({ posture: posture({ aiEnabled: false }) }),
    });
    assert.equal(resolution.outcome, 'miss');
    assert.equal(resolution.missReason, 'ai_disabled');
    assert.equal(resolution.priorOutput, undefined);

    // And even if a caller ignored the miss and forged a prior output onto the
    // descriptor, Part 6A denies on the same switch and attributes no saving.
    const stored = record();
    const forced = compressCost({
      task: task({
        priorOutputs: [
          {
            artifactId: stored.reusableResultId,
            digest: stored.outputDigest,
            organizationId: ORG,
            contractValidated: true,
            quality: 'standard',
          },
        ],
      }),
      envelope: envelope({ aiEnabled: false }),
      contextItems: [],
    });
    assert.equal(forced.decision, 'deny');
    assert.equal(forced.reason, 'ai_disabled');
    assert.equal(forced.savings.estimatedSavingsMicroUsd, 0);
    assert.equal(forced.savings.baselineCostMicroUsd, 0);
  });

  it('honours a narrower reuse switch without touching the kill switch', async () => {
    const store = await storeWith(record());
    const resolution = await resolveReuse({
      store,
      eligibility: request({ posture: posture({ reuseEnabled: false }) }),
    });
    assert.equal(resolution.missReason, 'reuse_disabled');
  });

  it('carries no credential, prompt or provider response on any record', () => {
    const stored = record();
    const serialized = JSON.stringify(stored);
    for (const forbidden of ['apiKey', 'api_key', 'authorization', 'messages', 'rawResponse', 'systemPrompt']) {
      assert.equal(
        serialized.includes(forbidden),
        false,
        `a reusable record must never carry ${forbidden}`,
      );
    }
    // The output a consumer receives is the sealed envelope and nothing else.
    assert.deepEqual(Object.keys(stored.output), ['schema', 'schemaVersion', 'fields', 'redactions']);
  });
});

// ── Accounting ──────────────────────────────────────────────────────────────

describe('Part 6B adversarial — the accounting cannot be inflated', () => {
  it('feeds Part 6A rather than opening a second savings ledger', async () => {
    const store = await storeWith(record());
    const resolution = await resolveReuse({ store, eligibility: request() });
    assert.equal(resolution.outcome, 'exact_hit');

    const plan = planFor(resolution);
    assert.equal(plan.decision, 'reuse');
    assert.equal(plan.inferenceAvoided, true);
    // ONE record, from the one ledger, attributing the whole gap to `reuse`.
    reconcileSavings(plan.savings);
    const reuseEntry = plan.savings.entries.find((entry) => entry.category === 'reuse');
    assert.ok(reuseEntry);
    assert.equal(reuseEntry.microUsd, plan.savings.estimatedSavingsMicroUsd);
    assert.equal(plan.savings.actualCostMicroUsd, 0);
    assert.equal(plan.savings.realized, true);
  });

  it('records exactly one avoided call for an exact hit', async () => {
    const store = await storeWith(record());
    const resolution = await resolveReuse({ store, eligibility: request() });
    const plan = planFor(resolution);

    const ledger = recordAvoidedCall({
      ledger: emptyAvoidedCallLedger(),
      plan,
      reuseType: 'exact',
      sourceReusableResultId: resolution.record?.reusableResultId ?? '',
      eligibilityEvidenceDigest: resolution.verdict?.evidenceDigest ?? '',
      sourceOriginalCostMicroUsd: resolution.record?.originalActualCostMicroUsd ?? 0,
    });

    const totals = totalAvoidedCalls(ledger);
    assert.equal(totals.avoidedCalls, 1);
    assert.equal(totals.exactAvoidedCalls, 1);
    assert.equal(totals.semanticAvoidedCalls, 0);
    assert.equal(totals.actualInferenceCostMicroUsd, 0);
    assert.equal(totals.costAvoidedMicroUsd, plan.baseline.baselineEstimatedCostMicroUsd);
    reconcileAvoidedCalls(ledger, [plan]);
  });

  it('records exactly one avoided call for a semantic hit', async () => {
    const similar = record({
      identity: buildReuseIdentity(identityInput({ inputDigest: 'sha256:input_similar' })),
    });
    const store = await storeWith(similar);
    const semantic = sealSemanticMetadata('quote_summary', ['quote', 'pricing', 'summary']);
    const resolution = await resolveReuse({
      store,
      eligibility: request(),
      discovery: createDeclaredFeatureDiscovery({ store }),
      semantic: { ...semantic, minimumSimilarity: 40, maximumCandidates: 5 },
    });
    assert.equal(resolution.outcome, 'semantic_hit');

    const plan = planFor(resolution);
    const ledger = recordAvoidedCall({
      ledger: emptyAvoidedCallLedger(),
      plan,
      reuseType: 'semantic',
      sourceReusableResultId: similar.reusableResultId,
      eligibilityEvidenceDigest: resolution.verdict?.evidenceDigest ?? '',
      sourceOriginalCostMicroUsd: similar.originalActualCostMicroUsd,
    });
    const totals = totalAvoidedCalls(ledger);
    assert.equal(totals.avoidedCalls, 1);
    assert.equal(totals.semanticAvoidedCalls, 1);
    reconcileAvoidedCalls(ledger, [plan]);
  });

  /**
   * FRAUD 1: read one cached result ten times, count ten avoided calls.
   *
   * The ledger is keyed by TASK id, so ten reads on behalf of one task produce
   * one entry and nine refusals. Ten reads on behalf of ten genuinely different
   * tasks produce ten entries, which is correct — ten inferences were avoided.
   */
  it('cannot turn repeated reads of one record into repeated savings', async () => {
    const store = await storeWith(record());
    let ledger = emptyAvoidedCallLedger();
    const plans: CompressionPlan[] = [];

    const resolution = await resolveReuse({ store, eligibility: request() });
    const plan = planFor(resolution);
    plans.push(plan);

    ledger = recordAvoidedCall({
      ledger,
      plan,
      reuseType: 'exact',
      sourceReusableResultId: resolution.record?.reusableResultId ?? '',
      eligibilityEvidenceDigest: resolution.verdict?.evidenceDigest ?? '',
      sourceOriginalCostMicroUsd: 0,
    });

    for (let attempt = 0; attempt < 9; attempt += 1) {
      const repeat = await resolveReuse({ store, eligibility: request() });
      assert.equal(repeat.outcome, 'exact_hit', 'the read still succeeds — it just does not count twice');
      assert.throws(
        () =>
          recordAvoidedCall({
            ledger,
            plan: planFor(repeat),
            reuseType: 'exact',
            sourceReusableResultId: repeat.record?.reusableResultId ?? '',
            eligibilityEvidenceDigest: repeat.verdict?.evidenceDigest ?? '',
            sourceOriginalCostMicroUsd: 0,
          }),
        (error: unknown) => isReuseError(error) && error.failure === 'reuse_attribution_conflict',
      );
    }

    assert.equal(totalAvoidedCalls(ledger).avoidedCalls, 1);
    assert.equal(
      totalAvoidedCalls(ledger).costAvoidedMicroUsd,
      plan.baseline.baselineEstimatedCostMicroUsd,
    );
    reconcileAvoidedCalls(ledger, plans);
  });

  /** FRAUD 6: one avoided call, recorded as both exact and semantic. */
  it('cannot record one avoided call as both exact and semantic', async () => {
    const store = await storeWith(record());
    const resolution = await resolveReuse({ store, eligibility: request() });
    const plan = planFor(resolution);
    const ledger = recordAvoidedCall({
      ledger: emptyAvoidedCallLedger(),
      plan,
      reuseType: 'exact',
      sourceReusableResultId: resolution.record?.reusableResultId ?? '',
      eligibilityEvidenceDigest: resolution.verdict?.evidenceDigest ?? '',
      sourceOriginalCostMicroUsd: 0,
    });
    assert.throws(
      () =>
        recordAvoidedCall({
          ledger,
          plan,
          reuseType: 'semantic',
          sourceReusableResultId: resolution.record?.reusableResultId ?? '',
          eligibilityEvidenceDigest: resolution.verdict?.evidenceDigest ?? '',
          sourceOriginalCostMicroUsd: 0,
        }),
      (error: unknown) => isReuseError(error) && error.failure === 'reuse_attribution_conflict',
    );
    assert.equal(totalAvoidedCalls(ledger).avoidedCalls, 1);
  });

  /** FRAUD 2: count a candidate the gate rejected as a hit. */
  it('cannot count a rejected semantic candidate as a saving', async () => {
    const weak = record({
      identity: buildReuseIdentity(identityInput({ inputDigest: 'sha256:weak' })),
      qualityProfile: 'best_effort',
      capabilityProfile: 'economy',
    });
    const store = await storeWith(weak);
    const semantic = sealSemanticMetadata('quote_summary', ['quote', 'pricing', 'summary']);
    const resolution = await resolveReuse({
      store,
      eligibility: request({
        quality: quality({ quality: 'high', minimumCapabilityProfile: 'standard' }),
      }),
      discovery: createDeclaredFeatureDiscovery({ store }),
      semantic: { ...semantic, minimumSimilarity: 40, maximumCandidates: 5 },
    });

    assert.equal(resolution.outcome, 'miss');
    assert.equal(resolution.attempts.semanticRejections, 1);

    // There is no prior output, so Part 6A does not decide `reuse`, so the
    // avoided-call ledger refuses the entry. Three independent refusals.
    const plan = planFor(resolution);
    assert.notEqual(plan.decision, 'reuse');
    assert.throws(
      () =>
        recordAvoidedCall({
          ledger: emptyAvoidedCallLedger(),
          plan,
          reuseType: 'semantic',
          sourceReusableResultId: weak.reusableResultId,
          eligibilityEvidenceDigest: 'forged',
          sourceOriginalCostMicroUsd: weak.originalActualCostMicroUsd,
        }),
      (error: unknown) => isReuseError(error) && error.failure === 'reuse_attribution_conflict',
    );

    const metrics = summarizeReuse({
      resolutions: [resolution],
      avoidedCalls: emptyAvoidedCallLedger(),
    });
    assert.equal(metrics.semanticRejectedCandidates, 1);
    assert.equal(metrics.semanticEligibleHits, 0);
    assert.equal(metrics.avoidedCalls, 0);
    assert.equal(metrics.avoidedEstimatedCostMicroUsd, 0);
  });

  /** FRAUD 3: count an expired result as reuse. */
  it('cannot count expired reuse', async () => {
    const stale = record({ createdAt: NOW - 100 * HOUR, freshness: { policy: 'ttl', ttlMs: HOUR } });
    const store = await storeWith(stale);
    const resolution = await resolveReuse({ store, eligibility: request() });
    assert.equal(resolution.missReason, 'expired');

    const plan = planFor(resolution);
    assert.notEqual(plan.decision, 'reuse');
    assert.throws(
      () =>
        recordAvoidedCall({
          ledger: emptyAvoidedCallLedger(),
          plan,
          reuseType: 'exact',
          sourceReusableResultId: stale.reusableResultId,
          eligibilityEvidenceDigest: 'forged',
          sourceOriginalCostMicroUsd: 0,
        }),
      (error: unknown) => isReuseError(error) && error.failure === 'reuse_attribution_conflict',
    );

    const metrics = summarizeReuse({ resolutions: [resolution], avoidedCalls: emptyAvoidedCallLedger() });
    assert.equal(metrics.staleMisses, 1);
    assert.equal(metrics.avoidedEstimatedCostMicroUsd, 0);
  });

  /** FRAUD 4: count a cross-tenant rejection as a saving. */
  it('cannot count a cross-tenant rejection as a saving', async () => {
    const theirs = record({
      identity: buildReuseIdentity(identityInput({ organizationId: OTHER_ORG })),
    });
    const store = await storeWith(theirs);
    const resolution = await resolveReuse({
      store,
      eligibility: request({
        identity: buildReuseIdentity(identityInput({ organizationId: OTHER_ORG })),
      }),
    });
    assert.equal(resolution.missReason, 'tenant_mismatch');

    const metrics = summarizeReuse({ resolutions: [resolution], avoidedCalls: emptyAvoidedCallLedger() });
    assert.equal(metrics.tenancyMisses, 1);
    assert.equal(metrics.avoidedCalls, 0);
    assert.equal(metrics.avoidedEstimatedCostMicroUsd, 0);
    assert.equal(metrics.hitRatePercent, 0);
  });

  /**
   * FRAUD 5: count what the SOURCE generation cost as newly avoided cost.
   *
   * The most attractive fraud available to a cache, because the number is real,
   * measured, and sitting on the record. It is also money already spent, once,
   * on a call that did happen. The totals are asserted to be INVARIANT under it:
   * multiplying the source's original cost by a thousand moves nothing.
   */
  it('cannot count the original generation cost as avoided cost', async () => {
    const cheapSource = record({ originalActualCostMicroUsd: 1 });
    const expensiveSource = record({ originalActualCostMicroUsd: 99_000_000 });
    assert.equal(cheapSource.reusableResultId, expensiveSource.reusableResultId);

    const totals = await Promise.all(
      [cheapSource, expensiveSource].map(async (source) => {
        const store = await storeWith(source);
        const resolution = await resolveReuse({ store, eligibility: request() });
        const plan = planFor(resolution);
        const ledger = recordAvoidedCall({
          ledger: emptyAvoidedCallLedger(),
          plan,
          reuseType: 'exact',
          sourceReusableResultId: source.reusableResultId,
          eligibilityEvidenceDigest: resolution.verdict?.evidenceDigest ?? '',
          sourceOriginalCostMicroUsd: source.originalActualCostMicroUsd,
        });
        reconcileAvoidedCalls(ledger, [plan]);
        return { totals: totalAvoidedCalls(ledger), baseline: plan.baseline.baselineEstimatedCostMicroUsd };
      }),
    );

    assert.equal(totals[0].totals.costAvoidedMicroUsd, totals[1].totals.costAvoidedMicroUsd);
    assert.equal(totals[0].totals.costAvoidedMicroUsd, totals[0].baseline);
    // The 99 million is nowhere in the total. It is provenance, not currency.
    assert.notEqual(totals[1].totals.costAvoidedMicroUsd, 99_000_000);
  });

  it('cannot attribute a saving larger than the baseline it saved on', async () => {
    const store = await storeWith(record());
    const resolution = await resolveReuse({ store, eligibility: request() });
    const plan = planFor(resolution);
    const ledger = recordAvoidedCall({
      ledger: emptyAvoidedCallLedger(),
      plan,
      reuseType: 'exact',
      sourceReusableResultId: resolution.record?.reusableResultId ?? '',
      eligibilityEvidenceDigest: resolution.verdict?.evidenceDigest ?? '',
      sourceOriginalCostMicroUsd: 5_000_000,
    });

    const totals = totalAvoidedCalls(ledger);
    assert.ok(totals.costAvoidedMicroUsd <= plan.baseline.baselineEstimatedCostMicroUsd);
    assert.ok(plan.savings.estimatedSavingsMicroUsd <= plan.savings.baselineCostMicroUsd);
    assert.ok(plan.savings.savingsPercent <= 100);
  });

  it('refuses an avoided-call entry whose plan did not decide reuse', () => {
    const executed = compressCost({ task: task(), envelope: envelope(), contextItems: [] });
    assert.notEqual(executed.decision, 'reuse');
    assert.throws(
      () =>
        recordAvoidedCall({
          ledger: emptyAvoidedCallLedger(),
          plan: executed,
          reuseType: 'exact',
          sourceReusableResultId: 'rr_forged',
          eligibilityEvidenceDigest: 'forged',
          sourceOriginalCostMicroUsd: 0,
        }),
      (error: unknown) => isReuseError(error) && error.failure === 'reuse_attribution_conflict',
    );
  });

  it('reconciles the avoided-call ledger against the Part 6A rollup, exactly', async () => {
    const store = await storeWith(record());
    let ledger = emptyAvoidedCallLedger();
    const plans: CompressionPlan[] = [];
    const resolutions: ReuseResolution[] = [];

    // Three genuinely different tasks, all answered from the one stored record.
    // Three avoided calls, because three inferences did not happen.
    for (const taskId of ['task_a', 'task_b', 'task_c']) {
      const resolution = await resolveReuse({ store, eligibility: request({ taskId }) });
      assert.equal(resolution.outcome, 'exact_hit');
      resolutions.push(resolution);
      const plan = planFor(resolution, taskId);
      plans.push(plan);
      ledger = recordAvoidedCall({
        ledger,
        plan,
        reuseType: 'exact',
        sourceReusableResultId: resolution.record?.reusableResultId ?? '',
        eligibilityEvidenceDigest: resolution.verdict?.evidenceDigest ?? '',
        sourceOriginalCostMicroUsd: resolution.record?.originalActualCostMicroUsd ?? 0,
      });
    }

    reconcileAvoidedCalls(ledger, plans);
    const rollup = rollupSavings(plans.map((plan) => plan.savings));
    const compression = summarizeCompression({ plans });
    const reuse = summarizeReuse({ resolutions, avoidedCalls: ledger });

    // The two subsystems agree because they read the same number, not because
    // two independent calculations happened to land in the same place.
    assert.equal(reuse.avoidedCalls, 3);
    assert.equal(compression.callsAvoided, 3);
    assert.equal(reuse.avoidedEstimatedCostMicroUsd, compression.costAvoidedMicroUsd);
    assert.equal(reuse.avoidedEstimatedCostMicroUsd, rollup.byCategory.reuse.microUsd);
    assert.equal(reuse.tokensAvoided, compression.tokensAvoided);
    assert.equal(reuse.realizedAvoidedCostMicroUsd, rollup.realizedSavingsMicroUsd);
    assert.equal(rollup.actualCostMicroUsd, 0);
    assert.equal(reuse.hitRatePercent, 100);
  });

  it('never counts a duplicate population as a saving', async () => {
    const store = createInMemoryReusableResultStore();
    // Two isolates finishing the same inference and both storing. Both PAID —
    // the duplicate work happened upstream and this layer cannot undo it. What
    // it guarantees is that duplicate work does not become duplicate truth.
    const first = await store.put(record());
    const second = await store.put(record({ output: outputEnvelope({ fields: { summary: 'racer two' } }) }));
    assert.equal(first.stored, true);
    assert.equal(second.stored, false);

    const metrics = summarizeReuse({ resolutions: [], avoidedCalls: emptyAvoidedCallLedger() });
    assert.equal(metrics.avoidedCalls, 0);
    assert.equal(metrics.avoidedEstimatedCostMicroUsd, 0);
  });
});

// ── Economics reporting ─────────────────────────────────────────────────────

describe('Part 6B adversarial — the economics report refusals beside hits', () => {
  it('breaks misses down by cause, so a hit rate cannot be read alone', async () => {
    const store: ReusableResultStore = await storeWith(record());
    const resolutions: ReuseResolution[] = [
      await resolveReuse({ store, eligibility: request({ taskId: 't1' }) }),
      await resolveReuse({
        store,
        eligibility: request({ taskId: 't2', freshness: freshness({ nowMs: NOW + 100 * HOUR }) }),
      }),
      await resolveReuse({
        store,
        eligibility: request({
          taskId: 't3',
          quality: quality({ quality: 'critical', minimumCapabilityProfile: 'reasoning' }),
        }),
      }),
      await resolveReuse({
        store,
        eligibility: request({
          taskId: 't4',
          currentDependencies: [{ ...EVIDENCE_DEPENDENCY, version: 'sha256:moved' }, ...CURRENT_DEPENDENCIES.slice(1)],
        }),
      }),
      await resolveReuse({
        store,
        eligibility: request({ taskId: 't5', authority: authority({ callerAuthorized: false }) }),
      }),
    ];

    const metrics = summarizeReuse({ resolutions, avoidedCalls: emptyAvoidedCallLedger() });
    assert.equal(metrics.resolutions, 5);
    assert.equal(metrics.exactHits, 1);
    assert.equal(metrics.misses, 4);
    assert.equal(metrics.staleMisses, 1);
    assert.equal(metrics.qualityMisses, 1);
    assert.equal(metrics.dependencyMisses, 1);
    assert.equal(metrics.authorityMisses, 1);
    assert.equal(metrics.hitRatePercent, 20);
    // The full reason codes reach the report, not only the families.
    assert.equal(metrics.missReasons.expired, 1);
    assert.equal(metrics.missReasons.quality_below_requirement, 1);
  });

  it('counts invalidations without deleting the evidence behind them', async () => {
    const stored = record();
    const store = await storeWith(stored);
    const first = await invalidateReusableResults(store, {
      organizationId: ORG,
      scope: { kind: 'policy', policyVersion: 'ai.policy.v7' },
      reason: 'policy_changed',
      at: NOW,
      requestedBy: 'user_operator',
    });
    const repeat = await invalidateReusableResults(store, {
      organizationId: ORG,
      scope: { kind: 'policy', policyVersion: 'ai.policy.v7' },
      reason: 'policy_changed',
      at: NOW + 1_000,
      requestedBy: 'user_operator',
    });

    const metrics = summarizeReuse({
      resolutions: [],
      avoidedCalls: emptyAvoidedCallLedger(),
      invalidations: [first, repeat],
    });
    assert.equal(metrics.invalidationCommands, 2);
    assert.equal(metrics.invalidations, 1);
    assert.equal(metrics.redundantInvalidations, 1);
    assert.ok(await store.getById(ORG, stored.reusableResultId));
  });

  it('reports a hit rate of zero over an empty window rather than dividing by zero', () => {
    const metrics = summarizeReuse({ resolutions: [], avoidedCalls: emptyAvoidedCallLedger() });
    assert.equal(metrics.hitRatePercent, 0);
    assert.equal(metrics.avoidedEstimatedCostMicroUsd, 0);
    assert.equal(metrics.realizedAvoidedCostMicroUsd, 0);
  });

  /**
   * The eligibility evidence is RECOMPUTABLE, which is what makes "on what basis
   * was this reused" answerable six months later. Two identical requests against
   * one record produce the same digest; a request differing in any decisive input
   * produces a different one.
   */
  it('produces an eligibility evidence digest that is stable and input-sensitive', () => {
    const stored = record();
    const a = evaluateReuseEligibility(stored, request());
    const b = evaluateReuseEligibility(stored, request());
    assert.equal(a.evidenceDigest, b.evidenceDigest);

    const differentAuthority = evaluateReuseEligibility(
      stored,
      request({ authority: authority({ authorizationEvidenceId: 'rbac_verdict_9002' }) }),
    );
    assert.notEqual(differentAuthority.evidenceDigest, a.evidenceDigest);

    const differentPosture = evaluateReuseEligibility(
      stored,
      request({ posture: posture({ controlPlanePostureVersion: 'posture_2026_08_08' }) }),
    );
    assert.notEqual(differentPosture.evidenceDigest, a.evidenceDigest);
  });
});
