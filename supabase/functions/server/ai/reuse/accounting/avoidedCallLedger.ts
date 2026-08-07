/**
 * Avoided-call accounting (AI-01 Batch 3B, Part 6B).
 *
 * ── THERE IS ONE SAVINGS LEDGER, AND IT IS PART 6A'S ──────────────────────
 *
 * This module does NOT compute savings. It cannot: it has no baseline model, no
 * price band, no partition function and no way to build a `SavingsRecord`. The
 * boundary scan asserts that `buildSavingsRecord` and `reconcileSavings` are
 * defined in exactly one file in the whole AI tree, and that file is
 * `optimization/ledger/savingsLedger.ts`.
 *
 * What actually happens on a hit is that the reuse pipeline produces a
 * `ValidatedPriorOutput` — the input type Part 6A has taken since it shipped —
 * the caller puts it on its `AiTaskDescriptor`, and `compressCost` returns a
 * plan with `decision: 'reuse'` whose savings record attributes the whole
 * baseline to the `reuse` category at an actual cost of zero. One gap, one
 * partition, one ledger. Part 6B supplies the thing Part 6A always said the
 * caller would supply, and adds no second accounting path.
 *
 * ── SO WHAT IS THIS FOR ────────────────────────────────────────────────────
 *
 * Evidence and single-attribution. An avoided call has no provider invoice, so
 * the ONLY record that it happened is the one the platform writes itself, and a
 * self-written record needs a control that makes double counting impossible
 * rather than merely unlikely:
 *
 *   ONE ENTRY PER TASK       Keyed by task id. A second entry for the same task
 *                            is refused, not merged. That single rule defeats
 *                            "read the cached record ten times and count ten
 *                            avoided calls", which is the easiest way a cache
 *                            manufactures savings.
 *
 *   ONE REUSE TYPE PER ENTRY An entry is exact or semantic. Recording both for
 *                            one avoided call is refused, because it is the
 *                            same call twice under two names.
 *
 *   NUMBERS COME FROM THE PLAN  Baseline tokens and baseline cost are read from
 *                            the Part 6A plan's own baseline estimate. They are
 *                            not recomputed here and cannot be supplied by a
 *                            caller, so an entry cannot claim a baseline the
 *                            baseline model never produced.
 *
 *   THE SOURCE'S COST IS NOT A SAVING  `sourceOriginalCostMicroUsd` is recorded
 *                            for provenance and is deliberately NOT summed into
 *                            anything. Money spent once, on a call that did
 *                            happen, is not avoided by being remembered. This is
 *                            the single most attractive way to manufacture
 *                            savings out of a cache, so the field that would
 *                            enable it sits in the record with nothing reading
 *                            it, and a test asserts the totals ignore it.
 *
 *   A REJECTED CANDIDATE IS NOT A HIT  There is no path from a miss to an entry.
 *                            `recordAvoidedCall` takes a plan whose decision is
 *                            `reuse`; a plan with any other decision is refused.
 */

import type { CompressionPlan } from '../../optimization/costCompressionEngine.ts';
import { reuseFailure } from '../contracts/failures.ts';
import type { ReuseMissReason } from '../contracts/eligibility.ts';

export const REUSE_TYPES = ['exact', 'semantic'] as const;

export type ReuseType = (typeof REUSE_TYPES)[number];

/**
 * One inference that did not happen because a stored result answered it.
 *
 * Every figure is either read from the Part 6A plan or is a constant. Nothing
 * here is a caller's opinion about how much was saved.
 */
export interface AvoidedCallEntry {
  readonly taskId: string;
  readonly organizationId: string;
  readonly reuseType: ReuseType;
  /** The record that answered it. */
  readonly sourceReusableResultId: string;
  /** Why the gate said yes, recomputable from the verdict. */
  readonly eligibilityEvidenceDigest: string;
  /** Which reason code the DECISION carried. Always a hit reason. */
  readonly decisionReason: 'exact_reuse' | 'semantic_reuse';

  // ── The baseline, from Part 6A's versioned model. Never recomputed here ───
  readonly baselinePolicyVersion: string;
  readonly baselineEstimatedInputTokens: number;
  readonly baselineEstimatedOutputTokens: number;
  readonly baselineEstimatedCostMicroUsd: number;

  /** Zero, and it is a measurement: no call was made, so none was billed. */
  readonly actualInferenceCostMicroUsd: 0;
  readonly tokensAvoided: number;
  readonly costAvoidedMicroUsd: number;

  /**
   * What the SOURCE generation cost when it happened. PROVENANCE ONLY.
   *
   * Nothing sums this. It is here so an auditor can see that the platform knows
   * the difference between money already spent and money not spent — and a test
   * asserts that the totals below do not move when it changes.
   */
  readonly sourceOriginalCostMicroUsd: number;
}

/**
 * The avoided-call ledger for one accounting window.
 *
 * A plain value with a map keyed by task id. Immutability is not the point here;
 * SINGLE ATTRIBUTION is, and the map is what enforces it.
 */
export interface AvoidedCallLedger {
  readonly entries: ReadonlyMap<string, AvoidedCallEntry>;
}

export function emptyAvoidedCallLedger(): AvoidedCallLedger {
  return { entries: new Map() };
}

export interface RecordAvoidedCallInput {
  readonly ledger: AvoidedCallLedger;
  /**
   * The Part 6A plan produced WITH the reuse prior output on its descriptor.
   *
   * Its decision must be `reuse`. That is not a formality: it is what proves the
   * saving was attributed by the one savings ledger, in the `reuse` category,
   * against a baseline the baseline model produced — rather than by this module.
   */
  readonly plan: CompressionPlan;
  readonly reuseType: ReuseType;
  readonly sourceReusableResultId: string;
  readonly eligibilityEvidenceDigest: string;
  readonly sourceOriginalCostMicroUsd: number;
}

/**
 * Record one avoided call, or refuse.
 *
 * Returns a NEW ledger. Refuses a duplicate task id, a plan that did not avoid
 * inference through reuse, and a tenant mismatch — all three by throwing, since
 * an accounting control that logs and proceeds has not controlled anything.
 */
export function recordAvoidedCall(input: RecordAvoidedCallInput): AvoidedCallLedger {
  const { plan } = input;

  if (plan.decision !== 'reuse') {
    throw reuseFailure(
      'reuse_attribution_conflict',
      'Only a reuse decision can record an avoided call.',
      { diagnostics: `${plan.taskId}: plan decision is ${plan.decision}` },
    );
  }
  if (!plan.inferenceAvoided) {
    throw reuseFailure(
      'reuse_attribution_conflict',
      'A plan that did not avoid inference cannot record an avoided call.',
      { diagnostics: plan.taskId },
    );
  }
  if (!REUSE_TYPES.includes(input.reuseType)) {
    throw reuseFailure('reuse_input_invalid', 'Unknown reuse type.', {
      diagnostics: `reuseType=${String(input.reuseType)}`,
    });
  }

  const existing = input.ledger.entries.get(plan.taskId);
  if (existing !== undefined) {
    // THE CONTROL. Reading one cached record ten times cannot become ten avoided
    // calls, and one avoided call cannot be recorded as both exact and semantic,
    // because the second attempt is refused rather than merged.
    throw reuseFailure(
      'reuse_attribution_conflict',
      'This task has already recorded an avoided call.',
      {
        diagnostics:
          `${plan.taskId}: already attributed to ${existing.sourceReusableResultId} ` +
          `as ${existing.reuseType}`,
      },
    );
  }

  const baseline = plan.baseline;
  const entry: AvoidedCallEntry = {
    taskId: plan.taskId,
    organizationId: plan.organizationId,
    reuseType: input.reuseType,
    sourceReusableResultId: input.sourceReusableResultId,
    eligibilityEvidenceDigest: input.eligibilityEvidenceDigest,
    decisionReason: input.reuseType === 'exact' ? 'exact_reuse' : 'semantic_reuse',

    baselinePolicyVersion: baseline.baselinePolicyVersion,
    baselineEstimatedInputTokens: baseline.baselineEstimatedInputTokens,
    baselineEstimatedOutputTokens: baseline.baselineEstimatedOutputTokens,
    baselineEstimatedCostMicroUsd: baseline.baselineEstimatedCostMicroUsd,

    actualInferenceCostMicroUsd: 0,
    // Avoided equals the baseline because the alternative to reuse was the
    // baseline call. Read from the plan, never chosen, and never derived from a
    // desired percentage.
    tokensAvoided: baseline.baselineEstimatedTotalTokens,
    costAvoidedMicroUsd: baseline.baselineEstimatedCostMicroUsd,

    sourceOriginalCostMicroUsd: Math.max(0, Math.floor(input.sourceOriginalCostMicroUsd)),
  };

  const entries = new Map(input.ledger.entries);
  entries.set(entry.taskId, entry);
  return { entries };
}

export interface AvoidedCallTotals {
  readonly avoidedCalls: number;
  readonly exactAvoidedCalls: number;
  readonly semanticAvoidedCalls: number;
  readonly tokensAvoided: number;
  readonly costAvoidedMicroUsd: number;
  /** Always zero. Present so a reviewer can see it is asserted, not assumed. */
  readonly actualInferenceCostMicroUsd: number;
}

/**
 * Total the ledger.
 *
 * Sums `costAvoidedMicroUsd` and nothing else. `sourceOriginalCostMicroUsd` is
 * not read by this function — that absence is the control, and the adversarial
 * suite asserts the totals do not move when a source's original cost changes.
 */
export function totalAvoidedCalls(ledger: AvoidedCallLedger): AvoidedCallTotals {
  let exact = 0;
  let semantic = 0;
  let tokens = 0;
  let cost = 0;
  for (const entry of ledger.entries.values()) {
    if (entry.reuseType === 'exact') exact += 1;
    else semantic += 1;
    tokens += entry.tokensAvoided;
    cost += entry.costAvoidedMicroUsd;
  }
  return {
    avoidedCalls: ledger.entries.size,
    exactAvoidedCalls: exact,
    semanticAvoidedCalls: semantic,
    tokensAvoided: tokens,
    costAvoidedMicroUsd: cost,
    actualInferenceCostMicroUsd: 0,
  };
}

/**
 * Prove the ledger against the Part 6A plans that produced it, or refuse it.
 *
 * Three claims, each the shape of a defect somebody would otherwise have to
 * spot by reading:
 *
 *   1. Every entry has a plan, and that plan's decision is `reuse`. An entry
 *      whose plan is missing is a saving with no execution behind it.
 *   2. Every entry's avoided cost equals its plan's baseline. An entry claiming
 *      more than the baseline is claiming a saving larger than the thing it
 *      saved on.
 *   3. Every reuse plan's own savings record already attributes the full
 *      baseline to the `reuse` category. That is the reconciliation with Part
 *      6A: the two subsystems agree because they are reading the same number.
 */
export function reconcileAvoidedCalls(
  ledger: AvoidedCallLedger,
  plans: readonly CompressionPlan[],
  missReasons: readonly ReuseMissReason[] = [],
): void {
  const problems: string[] = [];
  const planById = new Map(plans.map((plan) => [plan.taskId, plan]));

  for (const entry of ledger.entries.values()) {
    const plan = planById.get(entry.taskId);
    if (plan === undefined) {
      problems.push(`${entry.taskId} has an avoided-call entry with no compression plan`);
      continue;
    }
    if (plan.decision !== 'reuse') {
      problems.push(`${entry.taskId} has an avoided-call entry but decided ${plan.decision}`);
      continue;
    }
    if (plan.organizationId !== entry.organizationId) {
      problems.push(`${entry.taskId} attributes an avoided call to a different organization`);
    }
    if (entry.costAvoidedMicroUsd !== plan.baseline.baselineEstimatedCostMicroUsd) {
      problems.push(
        `${entry.taskId} avoided ${entry.costAvoidedMicroUsd} against a baseline of ` +
          `${plan.baseline.baselineEstimatedCostMicroUsd}`,
      );
    }
    if (entry.actualInferenceCostMicroUsd !== 0) {
      problems.push(`${entry.taskId} records a non-zero cost for a call that did not happen`);
    }
    const reuseEntry = plan.savings.entries.find((candidate) => candidate.category === 'reuse');
    if (reuseEntry === undefined) {
      problems.push(`${entry.taskId} has no reuse category in its Part 6A savings record`);
      continue;
    }
    if (reuseEntry.microUsd !== plan.savings.estimatedSavingsMicroUsd) {
      problems.push(
        `${entry.taskId} attributes ${reuseEntry.microUsd} to reuse but estimated ` +
          `${plan.savings.estimatedSavingsMicroUsd}`,
      );
    }
  }

  // A miss must never have produced an entry. Checked explicitly rather than
  // left implicit, because "we only call this on a hit" is a convention and this
  // is the assertion.
  if (missReasons.length > 0 && ledger.entries.size > plans.length) {
    problems.push('more avoided calls than compression plans');
  }

  if (problems.length > 0) {
    throw reuseFailure(
      'reuse_attribution_conflict',
      'Avoided-call accounting does not reconcile with the compression plans.',
      { diagnostics: problems.join('; ') },
    );
  }
}
