/**
 * Savings accounting contracts (AI-01 Batch 3B, Part 6A).
 *
 * ── DOUBLE COUNTING IS THE DEFAULT FAILURE MODE, NOT AN EDGE CASE ──────────
 *
 * A task whose context was reduced AND whose profile was downgraded has saved
 * money once. The naive ledger attributes the context reduction at the original
 * price band, attributes the downgrade over the original token count, adds the
 * two, and reports more saving than the baseline ever contained. Both entries
 * look individually correct. Their sum is a lie.
 *
 * The rule this module enforces is therefore stated as an invariant rather than
 * as a convention: SAVINGS ARE A PARTITION OF THE GAP BETWEEN BASELINE AND
 * OPTIMISED COST. Every category is a slice of one number, the slices sum to
 * that number exactly, and no slice may be negative. `reconcileSavings` refuses
 * a ledger that does not satisfy that, and refusing is the whole point —
 * an accounting control that logs and proceeds has not controlled anything.
 *
 * ── ESTIMATED, REALISED, AND THE DIFFERENCE THAT MATTERS ───────────────────
 *
 * Before a call runs, the platform can only ESTIMATE the saving: baseline minus
 * projected optimised cost. After it runs, the provider reports what it actually
 * used, and the REALISED saving is baseline minus that. The two are kept as
 * separate fields and never quietly substituted for one another, because an
 * estimate that is systematically optimistic is exactly the defect a single
 * blended figure would hide.
 *
 * Avoided calls have no actual cost and therefore realise their full estimated
 * saving. That is not a loophole — nothing was spent — but it IS the entry an
 * adversarial reviewer should check first, so it carries its own category.
 */

/**
 * Where a saving came from. Closed vocabulary; every entry names exactly one.
 *
 * There is no `other`. A saving nobody can name is a saving nobody can audit,
 * and the reconciliation refuses to balance without a named category — which
 * turns "we saved 90%" into a sentence with a breakdown behind it.
 */
export const SAVINGS_CATEGORIES = [
  /** No inference happened: an authorised deterministic path answered it. */
  'deterministic_avoidance',
  /** No inference happened: a validated prior artefact answered it. */
  'reuse',
  /** Inference happened with fewer input tokens. */
  'context_reduction',
  /** Inference happened at a lower capability band. */
  'capability_downgrade',
  /** A retry the marginal-value control refused to spend. */
  'avoided_retry',
  /** An escalation the escalation policy refused to spend. */
  'avoided_escalation',
  /** A smaller completion allowance than the reference would have requested. */
  'output_budget_reduction',
] as const;

export type SavingsCategory = (typeof SAVINGS_CATEGORIES)[number];

export interface SavingsEntry {
  readonly category: SavingsCategory;
  /** Micro-USD attributed to this category. Never negative. */
  readonly microUsd: number;
  /** Tokens attributed to this category. Never negative. */
  readonly tokens: number;
}

/**
 * The savings record for ONE task.
 *
 * Per task rather than per tenant on purpose: aggregation is a later concern and
 * an aggregate that cannot be decomposed back to the executions that produced it
 * is not evidence. `taskId` is the join key everything else aggregates on.
 */
export interface SavingsRecord {
  readonly taskId: string;
  readonly organizationId: string;
  readonly baselinePolicyVersion: string;
  readonly baselineCostMicroUsd: number;
  /** What the optimised plan projected before it ran. */
  readonly optimizedEstimatedCostMicroUsd: number;
  /**
   * What it actually cost, once the provider reported usage.
   *
   * Absent until the execution settles. An avoided call settles immediately at
   * zero, which is a measurement rather than an assumption: no call was made.
   */
  readonly actualCostMicroUsd?: number;
  /** baseline − optimised estimate. Floored at zero. */
  readonly estimatedSavingsMicroUsd: number;
  /** baseline − actual. Present only once `actualCostMicroUsd` is. */
  readonly realizedSavingsMicroUsd?: number;
  /** Realised where available, estimated otherwise. 0–100, one decimal. */
  readonly savingsPercent: number;
  /** True when `savingsPercent` is computed from measured spend. */
  readonly realized: boolean;
  /** The partition. Sums to the estimated saving, exactly. */
  readonly entries: readonly SavingsEntry[];
}

/**
 * Aggregate savings across many tasks.
 *
 * Sums of sums, and nothing else — no re-derivation, no re-weighting. A
 * rollup that recomputed a percentage from anything other than its own summed
 * numerator and denominator would be a second opinion about the same facts.
 */
export interface SavingsRollup {
  readonly taskCount: number;
  readonly baselineCostMicroUsd: number;
  readonly optimizedEstimatedCostMicroUsd: number;
  readonly actualCostMicroUsd: number;
  readonly estimatedSavingsMicroUsd: number;
  readonly realizedSavingsMicroUsd: number;
  /** Realised savings over baseline. 0–100, one decimal. */
  readonly savingsPercent: number;
  readonly byCategory: Readonly<Record<SavingsCategory, SavingsEntry>>;
}
