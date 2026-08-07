/**
 * Reuse economics (AI-01 Batch 3B, Part 6B).
 *
 * ── THE NUMBERS PART 6C WILL READ, AND NOTHING ELSE ───────────────────────
 *
 * Internal figures only. No HTTP route, no dashboard, no projection, no chart,
 * no optimization score — Financial Intelligence is Part 6C and shipping its
 * surface beside the accounting it displays would mean one review for two things
 * that fail differently.
 *
 * ── THE REFUSALS ARE COUNTED BESIDE THE HITS, ON PURPOSE ──────────────────
 *
 * `summarizeReuse` reports misses broken down by cause with the same weight it
 * reports hits. A reuse layer that published its hit rate without publishing its
 * refusal profile would be publishing half a control: a gate that never refuses
 * anything is not effective, it is absent, and the ratio between the two columns
 * is how a reviewer tells which one this is.
 *
 * The breakdown is also the operational signal. `stale` says a TTL is too short
 * for the work; `dependency` says the cache is behaving exactly as designed;
 * `policy` and `quality` say a contract was raised after entries were written;
 * `integrity` says something is editing rows and should be investigated rather
 * than tuned.
 *
 * ── AVOIDED COST COMES FROM THE AVOIDED-CALL LEDGER, WHICH COMES FROM
 *    PART 6A'S BASELINE ────────────────────────────────────────────────────
 *
 * Nothing in this module computes a saving. It sums entries whose figures were
 * read from Part 6A plans, and it never reads `sourceOriginalCostMicroUsd` —
 * money already spent on a call that happened is not avoided by being
 * remembered.
 */

import type { ReuseMissReason } from '../contracts/eligibility.ts';
import type { ReuseResolution } from '../engine/reuseDecisionPipeline.ts';
import type { ReuseInvalidationReport } from '../engine/invalidationEngine.ts';
import type { AvoidedCallLedger } from '../accounting/avoidedCallLedger.ts';
import { totalAvoidedCalls } from '../accounting/avoidedCallLedger.ts';

/** The families a miss reason rolls up into, for the operational read. */
export const MISS_FAMILIES = [
  'stale',
  'policy',
  'quality',
  'dependency',
  'integrity',
  'authority',
  'tenancy',
  'version',
  'availability',
  'absent',
] as const;

export type ReuseMissFamily = (typeof MISS_FAMILIES)[number];

const MISS_FAMILY: Readonly<Record<ReuseMissReason, ReuseMissFamily>> = {
  no_candidate: 'absent',
  discovery_unavailable: 'availability',
  store_unavailable: 'availability',
  tenant_mismatch: 'tenancy',
  record_malformed: 'integrity',
  record_incomplete: 'integrity',
  output_digest_mismatch: 'integrity',
  invalidated: 'integrity',
  caller_not_authorized: 'authority',
  workflow_not_permitted: 'authority',
  agent_not_permitted: 'authority',
  approval_required: 'authority',
  certification_invalid: 'authority',
  ai_disabled: 'authority',
  reuse_disabled: 'authority',
  policy_version_incompatible: 'policy',
  optimization_policy_incompatible: 'policy',
  baseline_policy_incompatible: 'policy',
  quality_below_requirement: 'quality',
  capability_below_requirement: 'quality',
  workflow_version_incompatible: 'version',
  agent_version_incompatible: 'version',
  plan_digest_incompatible: 'version',
  task_identity_mismatch: 'version',
  expired: 'stale',
  freshness_policy_unsatisfied: 'stale',
  dependency_changed: 'dependency',
  dependency_missing: 'dependency',
  evidence_unavailable: 'availability',
};

export function missFamilyFor(reason: ReuseMissReason): ReuseMissFamily {
  return MISS_FAMILY[reason];
}

export interface ReuseMetrics {
  // ── Attempts and outcomes ──────────────────────────────────────────────────
  readonly resolutions: number;
  readonly exactAttempts: number;
  readonly exactHits: number;
  readonly semanticCandidateAttempts: number;
  readonly semanticEligibleHits: number;
  readonly semanticRejectedCandidates: number;
  readonly misses: number;

  // ── Why the misses happened ────────────────────────────────────────────────
  readonly staleMisses: number;
  readonly policyMisses: number;
  readonly qualityMisses: number;
  readonly dependencyMisses: number;
  readonly integrityMisses: number;
  readonly authorityMisses: number;
  readonly tenancyMisses: number;
  readonly versionMisses: number;
  readonly availabilityMisses: number;
  readonly absentMisses: number;
  /** Reason code → count. The full breakdown, not just the families. */
  readonly missReasons: Readonly<Record<string, number>>;
  /** Reason code → count, over every candidate the gate refused. */
  readonly candidateRejectionReasons: Readonly<Record<string, number>>;

  // ── Invalidation ───────────────────────────────────────────────────────────
  readonly invalidationCommands: number;
  readonly invalidations: number;
  readonly redundantInvalidations: number;

  // ── The money, from the avoided-call ledger ────────────────────────────────
  readonly avoidedCalls: number;
  readonly exactAvoidedCalls: number;
  readonly semanticAvoidedCalls: number;
  readonly tokensAvoided: number;
  readonly avoidedEstimatedCostMicroUsd: number;
  /**
   * Avoided cost that is MEASURED rather than estimated.
   *
   * An avoided call realises its estimated saving in full, because the actual
   * cost is zero and zero is a measurement — no call was made, so no provider
   * reported usage. This field exists separately anyway, so that a later change
   * making some avoided calls only partially avoided cannot silently reuse the
   * estimated figure as though it were measured.
   */
  readonly realizedAvoidedCostMicroUsd: number;

  /** Hits over resolutions. 0–100, one decimal. Reported, never targeted. */
  readonly hitRatePercent: number;
}

export interface ReuseMetricsInput {
  readonly resolutions: readonly ReuseResolution[];
  readonly avoidedCalls: AvoidedCallLedger;
  readonly invalidations?: readonly ReuseInvalidationReport[];
}

/**
 * Summarise a set of resolutions.
 *
 * Pure. No clock, no store — so a figure is reproducible from the resolutions
 * that produced it, which is what an auditor needs when the question is "where
 * did this hit rate come from".
 */
export function summarizeReuse(input: ReuseMetricsInput): ReuseMetrics {
  const families: Record<ReuseMissFamily, number> = {
    stale: 0,
    policy: 0,
    quality: 0,
    dependency: 0,
    integrity: 0,
    authority: 0,
    tenancy: 0,
    version: 0,
    availability: 0,
    absent: 0,
  };
  const missReasons: Record<string, number> = {};
  const candidateRejectionReasons: Record<string, number> = {};

  let exactAttempts = 0;
  let exactHits = 0;
  let semanticCandidateAttempts = 0;
  let semanticEligibleHits = 0;
  let semanticRejectedCandidates = 0;
  let misses = 0;

  for (const resolution of input.resolutions) {
    exactAttempts += resolution.attempts.exactAttempts;
    exactHits += resolution.attempts.exactHits;
    semanticCandidateAttempts += resolution.attempts.semanticCandidates;
    semanticEligibleHits += resolution.attempts.semanticHits;
    semanticRejectedCandidates += resolution.attempts.semanticRejections;

    for (const [reason, count] of Object.entries(resolution.attempts.rejectionReasons)) {
      candidateRejectionReasons[reason] = (candidateRejectionReasons[reason] ?? 0) + count;
    }

    if (resolution.outcome === 'miss') {
      misses += 1;
      const reason = resolution.missReason ?? 'evidence_unavailable';
      missReasons[reason] = (missReasons[reason] ?? 0) + 1;
      families[missFamilyFor(reason)] += 1;
    }
  }

  let invalidationCommands = 0;
  let invalidations = 0;
  let redundantInvalidations = 0;
  for (const report of input.invalidations ?? []) {
    invalidationCommands += 1;
    invalidations += report.invalidated;
    redundantInvalidations += report.alreadyInvalidated;
  }

  const totals = totalAvoidedCalls(input.avoidedCalls);
  const hits = exactHits + semanticEligibleHits;
  const resolutions = input.resolutions.length;

  return {
    resolutions,
    exactAttempts,
    exactHits,
    semanticCandidateAttempts,
    semanticEligibleHits,
    semanticRejectedCandidates,
    misses,

    staleMisses: families.stale,
    policyMisses: families.policy,
    qualityMisses: families.quality,
    dependencyMisses: families.dependency,
    integrityMisses: families.integrity,
    authorityMisses: families.authority,
    tenancyMisses: families.tenancy,
    versionMisses: families.version,
    availabilityMisses: families.availability,
    absentMisses: families.absent,
    missReasons,
    candidateRejectionReasons,

    invalidationCommands,
    invalidations,
    redundantInvalidations,

    avoidedCalls: totals.avoidedCalls,
    exactAvoidedCalls: totals.exactAvoidedCalls,
    semanticAvoidedCalls: totals.semanticAvoidedCalls,
    tokensAvoided: totals.tokensAvoided,
    avoidedEstimatedCostMicroUsd: totals.costAvoidedMicroUsd,
    // Equal to the estimate because the actual is zero and zero is measured.
    // Derived from the same ledger rather than copied from the field above, so a
    // future partial-avoidance case has somewhere correct to diverge.
    realizedAvoidedCostMicroUsd: totals.costAvoidedMicroUsd - totals.actualInferenceCostMicroUsd,

    hitRatePercent: resolutions === 0 ? 0 : Math.round((hits / resolutions) * 1000) / 10,
  };
}
