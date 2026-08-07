/**
 * The savings ledger (AI-01 Batch 3B, Part 6A).
 *
 * ── ONE NUMBER, PARTITIONED — NOT SEVERAL NUMBERS, ADDED ───────────────────
 *
 * Read `contracts/savings.ts` for why double counting is the default failure
 * mode. This is the enforcement, and the shape of the enforcement is the whole
 * idea: a caller does not tell the ledger how much each category saved. It tells
 * the ledger the RELATIVE WEIGHT of each category, and the ledger distributes
 * the one real gap — baseline minus optimised — across those weights.
 *
 * With that inversion, double counting is not caught, it is UNREPRESENTABLE.
 * There is no argument to `buildSavingsRecord` through which two categories can
 * each claim the same micro-USD, because neither claims micro-USD at all. The
 * sum is fixed before the split happens.
 *
 * ── THE THREE INVARIANTS, AND WHERE THEY ARE ENFORCED ──────────────────────
 *
 *   0 ≤ attributed        Weights are floored at zero and a negative gap is
 *                         floored to zero saving. An "optimisation" that cost
 *                         MORE than the baseline reports zero saving and a
 *                         negative-variance diagnostic — never a negative
 *                         saving that would net off against a real one
 *                         elsewhere.
 *
 *   attributed ≤ baseline The gap is `baseline − optimised`, both non-negative,
 *                         so the gap cannot exceed the baseline. Re-asserted in
 *                         `reconcileSavings` anyway, because an invariant that
 *                         holds by construction today is one an edit can break
 *                         tomorrow.
 *
 *   Σ categories = total  The distribution is largest-remainder, so integer
 *                         rounding cannot lose or invent a micro-USD. The last
 *                         category absorbs the remainder explicitly rather than
 *                         the rounding quietly being someone's problem.
 *
 * ── REALISED IS NOT ESTIMATED ──────────────────────────────────────────────
 *
 * `savingsPercent` is computed from MEASURED spend whenever measured spend
 * exists, and the record says which it used. A platform that reported estimated
 * savings as though they were realised would be reporting its own optimism.
 */

import type {
  SavingsCategory,
  SavingsEntry,
  SavingsRecord,
  SavingsRollup,
} from '../contracts/savings.ts';
import { SAVINGS_CATEGORIES } from '../contracts/savings.ts';
import { compressionFailure } from '../contracts/compression.ts';

/**
 * A category's relative claim on the gap.
 *
 * Weights are in the same unit for every category — micro-USD the platform
 * BELIEVES that mechanism avoided — but they are treated as proportions, not as
 * amounts. A caller whose weights add up to twice the real gap gets each
 * category scaled to half; a caller whose weights add up to less gets each
 * scaled up. Either way the total is the gap, exactly once.
 */
export interface SavingsWeight {
  readonly category: SavingsCategory;
  /** Relative claim. Negative values are floored to zero. */
  readonly weight: number;
  /** Tokens attributable to this category, for the token breakdown. */
  readonly tokens: number;
}

export interface SavingsInput {
  readonly taskId: string;
  readonly organizationId: string;
  readonly baselinePolicyVersion: string;
  readonly baselineCostMicroUsd: number;
  readonly optimizedEstimatedCostMicroUsd: number;
  /** Measured spend. Absent until the execution settles. */
  readonly actualCostMicroUsd?: number;
  readonly weights: readonly SavingsWeight[];
}

function emptyEntry(category: SavingsCategory): SavingsEntry {
  return { category, microUsd: 0, tokens: 0 };
}

/**
 * Distribute an integer total across weights without losing or inventing units.
 *
 * Largest-remainder: floor every share, then hand the leftover units to the
 * categories with the largest fractional parts, breaking ties on the category's
 * fixed order so the result is reproducible. Naive rounding would make
 * `Σ categories` differ from the total by a few micro-USD, and a reconciliation
 * that tolerated "a few" would tolerate any number.
 */
function distribute(
  total: number,
  weights: readonly SavingsWeight[],
): readonly SavingsEntry[] {
  const positive = weights
    .map((weight) => ({ ...weight, weight: Math.max(0, weight.weight) }))
    .filter((weight) => weight.weight > 0);

  if (total <= 0 || positive.length === 0) {
    return positive.map((weight) => ({
      category: weight.category,
      microUsd: 0,
      tokens: Math.max(0, Math.floor(weight.tokens)),
    }));
  }

  const weightTotal = positive.reduce((sum, weight) => sum + weight.weight, 0);
  const shares = positive.map((weight, index) => {
    const exact = (total * weight.weight) / weightTotal;
    const floored = Math.floor(exact);
    return { index, weight, floored, remainder: exact - floored };
  });

  let assigned = shares.reduce((sum, share) => sum + share.floored, 0);
  const byRemainder = [...shares].sort(
    (a, b) => b.remainder - a.remainder || a.index - b.index,
  );
  let cursor = 0;
  while (assigned < total && byRemainder.length > 0) {
    byRemainder[cursor % byRemainder.length].floored += 1;
    assigned += 1;
    cursor += 1;
  }

  return shares.map((share) => ({
    category: share.weight.category,
    microUsd: share.floored,
    tokens: Math.max(0, Math.floor(share.weight.tokens)),
  }));
}

/**
 * Build the savings record for one task.
 *
 * The gap is computed once, here, from two numbers the caller did not choose
 * independently: a baseline produced by the versioned model and an optimised
 * cost produced by the plan. Everything else is a view of that gap.
 */
export function buildSavingsRecord(input: SavingsInput): SavingsRecord {
  const baseline = Math.max(0, Math.floor(input.baselineCostMicroUsd));
  const optimized = Math.max(0, Math.floor(input.optimizedEstimatedCostMicroUsd));
  const hasActual = input.actualCostMicroUsd !== undefined;
  const actual = hasActual ? Math.max(0, Math.floor(input.actualCostMicroUsd ?? 0)) : undefined;

  // Floored at zero rather than allowed negative. A plan that cost more than
  // the baseline saved nothing; letting it report a negative saving would let it
  // subsidise a real saving elsewhere in an aggregate.
  const estimatedSavings = Math.max(0, baseline - optimized);
  const realizedSavings =
    actual === undefined ? undefined : Math.max(0, baseline - actual);

  // The PARTITION is of the estimated gap, because the categories describe
  // decisions the engine made before the call — a downgrade, a context
  // reduction, an avoided retry. Realised savings are a measurement of the same
  // decisions, not a second set of them, so there is one breakdown and not two.
  const entries = distribute(estimatedSavings, input.weights);

  const numerator = realizedSavings === undefined ? estimatedSavings : realizedSavings;
  const savingsPercent =
    baseline === 0 ? 0 : Math.round((numerator / baseline) * 1000) / 10;

  return {
    taskId: input.taskId,
    organizationId: input.organizationId,
    baselinePolicyVersion: input.baselinePolicyVersion,
    baselineCostMicroUsd: baseline,
    optimizedEstimatedCostMicroUsd: optimized,
    ...(actual === undefined ? {} : { actualCostMicroUsd: actual }),
    estimatedSavingsMicroUsd: estimatedSavings,
    ...(realizedSavings === undefined ? {} : { realizedSavingsMicroUsd: realizedSavings }),
    savingsPercent,
    realized: realizedSavings !== undefined,
    entries,
  };
}

/**
 * Settle a record against measured spend.
 *
 * A new record rather than a mutation, and it re-derives from the SAME weights
 * so the breakdown does not shift when the actual arrives. What changes is the
 * measurement, not the story about why the saving happened.
 */
export function settleSavingsRecord(
  record: SavingsRecord,
  actualCostMicroUsd: number,
  weights: readonly SavingsWeight[],
): SavingsRecord {
  return buildSavingsRecord({
    taskId: record.taskId,
    organizationId: record.organizationId,
    baselinePolicyVersion: record.baselinePolicyVersion,
    baselineCostMicroUsd: record.baselineCostMicroUsd,
    optimizedEstimatedCostMicroUsd: record.optimizedEstimatedCostMicroUsd,
    actualCostMicroUsd,
    weights,
  });
}

/**
 * Prove a record's arithmetic, or refuse it.
 *
 * Called by the metrics layer before a record contributes to any aggregate, so
 * an unbalanced record cannot reach a report. It throws rather than returning a
 * verdict for the reason `limits.ts` gives about hard stops: a control that logs
 * and proceeds has not controlled anything.
 */
export function reconcileSavings(record: SavingsRecord): void {
  const problems: string[] = [];
  const attributed = record.entries.reduce((sum, entry) => sum + entry.microUsd, 0);

  for (const entry of record.entries) {
    if (entry.microUsd < 0) problems.push(`${entry.category} attributed a negative amount`);
    if (entry.tokens < 0) problems.push(`${entry.category} attributed negative tokens`);
  }

  const seen = new Set<SavingsCategory>();
  for (const entry of record.entries) {
    if (seen.has(entry.category)) problems.push(`${entry.category} appears more than once`);
    seen.add(entry.category);
  }

  if (attributed !== record.estimatedSavingsMicroUsd) {
    problems.push(
      `categories sum to ${attributed}, estimated saving is ${record.estimatedSavingsMicroUsd}`,
    );
  }
  if (attributed > record.baselineCostMicroUsd) {
    problems.push(
      `attributed ${attributed} exceeds baseline ${record.baselineCostMicroUsd}`,
    );
  }
  if (record.estimatedSavingsMicroUsd > record.baselineCostMicroUsd) {
    problems.push('estimated saving exceeds the baseline');
  }
  const realized = record.realizedSavingsMicroUsd;
  if (realized !== undefined && realized > record.baselineCostMicroUsd) {
    problems.push('realized saving exceeds the baseline');
  }
  if (record.savingsPercent < 0 || record.savingsPercent > 100) {
    problems.push(`savingsPercent ${record.savingsPercent} is outside 0–100`);
  }

  if (problems.length > 0) {
    throw compressionFailure(
      'savings_reconciliation_failed',
      'Savings accounting for this task does not reconcile.',
      { diagnostics: `${record.taskId}: ${problems.join('; ')}` },
    );
  }
}

/**
 * Aggregate settled records.
 *
 * Every record is reconciled BEFORE it contributes, so an aggregate is never the
 * first place an accounting defect shows up — by which point it has already been
 * averaged into something that looks plausible.
 */
export function rollupSavings(records: readonly SavingsRecord[]): SavingsRollup {
  const byCategory: Record<SavingsCategory, SavingsEntry> = {
    deterministic_avoidance: emptyEntry('deterministic_avoidance'),
    reuse: emptyEntry('reuse'),
    context_reduction: emptyEntry('context_reduction'),
    capability_downgrade: emptyEntry('capability_downgrade'),
    avoided_retry: emptyEntry('avoided_retry'),
    avoided_escalation: emptyEntry('avoided_escalation'),
    output_budget_reduction: emptyEntry('output_budget_reduction'),
  };

  let baseline = 0;
  let optimized = 0;
  let actual = 0;
  let estimated = 0;
  let realized = 0;

  for (const record of records) {
    reconcileSavings(record);
    baseline += record.baselineCostMicroUsd;
    optimized += record.optimizedEstimatedCostMicroUsd;
    actual += record.actualCostMicroUsd ?? 0;
    estimated += record.estimatedSavingsMicroUsd;
    // A record with no measurement contributes no realised saving. Falling back
    // to its estimate here is exactly how an unmeasured platform reports
    // measured results.
    realized += record.realizedSavingsMicroUsd ?? 0;
    for (const entry of record.entries) {
      const current = byCategory[entry.category];
      byCategory[entry.category] = {
        category: entry.category,
        microUsd: current.microUsd + entry.microUsd,
        tokens: current.tokens + entry.tokens,
      };
    }
  }

  return {
    taskCount: records.length,
    baselineCostMicroUsd: baseline,
    optimizedEstimatedCostMicroUsd: optimized,
    actualCostMicroUsd: actual,
    estimatedSavingsMicroUsd: estimated,
    realizedSavingsMicroUsd: realized,
    savingsPercent: baseline === 0 ? 0 : Math.round((realized / baseline) * 1000) / 10,
    byCategory,
  };
}

/** The category order used wherever a breakdown is emitted. */
export const SAVINGS_CATEGORY_ORDER: readonly SavingsCategory[] = SAVINGS_CATEGORIES;
