/**
 * The canonical financial event (AI-01 Batch 3B, Part 6C).
 *
 * ── ONE RECORD, MANY VIEWS — NEVER MANY RECORDS ────────────────────────────
 *
 * Every figure Part 6C publishes — cost by workflow, cost by agent, savings by
 * reason, retry waste, burn rate, target progress — is DERIVED from this one
 * event set by filtering and summing. There is no second ledger, no per-workflow
 * counter maintained alongside, no pre-aggregated rollup table.
 *
 * That is not a storage preference. It is the only structure in which the
 * question "why does cost-by-agent disagree with cost-by-workflow" cannot be
 * asked, because both are partitions of the same rows. A platform with two
 * accumulators has two answers to what something cost, and the first time they
 * diverge nobody can say which is the money.
 *
 * ── THE EVENT IS DERIVED, NOT REPORTED ─────────────────────────────────────
 *
 * Callers do not hand the engine a cost. They hand it artefacts the earlier
 * parts already produced — a Part 6A `CompressionPlan` with its versioned
 * baseline and its savings partition, a Part 6A `UsageAttributionRow` with
 * measured spend, a Part 6B avoided-call entry — and `financialEventLedger.ts`
 * assembles the event from them. There is nowhere in this contract for a
 * caller's opinion about how much was saved to enter.
 *
 * ── ESTIMATED, REALISED, AND UNSETTLED ARE THREE THINGS ────────────────────
 *
 * The single most dangerous simplification available here is treating a missing
 * settlement as zero cost. It makes every unsettled call look free, which makes
 * savings look complete, which makes the headline reduction look finished — and
 * it does all of that silently, because the arithmetic still balances.
 *
 * So `actualCostMicroUsd` is ABSENT rather than zero until settlement, and
 * `settlementState` says why. An unsettled event contributes to NEITHER the
 * realised numerator nor its denominator, and its existence is reported as
 * coverage beside every realised figure. See `engine/settlement.ts`.
 *
 * ── AND "SETTLED AT ZERO" IS NOT THE SAME AS "SETTLED" ─────────────────────
 *
 * An avoided call really did cost nothing — no call was made, so no provider
 * reported usage — and it realises its full estimated saving. That is honest,
 * and it is also the entry an adversarial reviewer should check first. So
 * `settlementBasis` distinguishes a figure that came from a provider's report
 * from one that came from the absence of a call, and the reports expose how much
 * of the realised saving rests on each. A platform whose entire reduction came
 * from measured absence has a different story to tell from one whose reduction
 * shows up on invoices, and a single blended number would hide which it is.
 *
 * ── WHAT IS DELIBERATELY ABSENT ────────────────────────────────────────────
 *
 * No prompts, no completions, no provider responses, no tool payloads, no
 * credentials, no PII. Provider and model identity appear because attribution
 * needs them, and identity is all they are: nothing in this tree can select a
 * provider, resolve a model or reach an adapter, which the boundary scan asserts
 * on the source.
 */

import type {
  CapabilityProfile,
  CompressionDecision,
  CompressionReason,
  QualityProfile,
} from '../../optimization/contracts/compression.ts';
import type { SavingsEntry } from '../../optimization/contracts/savings.ts';

export const FINANCIAL_EVENT_SCHEMA = 'ai.financial.event.v1';

/**
 * What kind of money moment this is.
 *
 * Three, because they settle differently and a reviewer needs to tell them
 * apart: an inference may cost anything and has to settle, an avoided call cost
 * nothing and settles by absence, and a refusal cost nothing and CLAIMS nothing
 * — a saving attributed to work the platform declined to do is not a saving.
 */
export const FINANCIAL_EVENT_TYPES = ['inference', 'avoided_call', 'refused'] as const;

export type FinancialEventType = (typeof FINANCIAL_EVENT_TYPES)[number];

export const SETTLEMENT_STATES = [
  /** Measured spend has arrived, or measured absence has been established. */
  'settled',
  /** Expected to settle and has not yet. NOT zero. */
  'pending',
  /**
   * The run reached a terminal state without settlement arriving.
   *
   * Distinct from `pending` because it will never resolve: it is permanently
   * unknown spend, and a coverage figure that counted it as merely late would
   * keep promising a completeness that is never coming.
   */
  'unsettled_terminal',
  /** Nothing to settle. Refusals only. */
  'not_applicable',
] as const;

export type SettlementState = (typeof SETTLEMENT_STATES)[number];

export const SETTLEMENT_BASES = [
  /** The provider reported usage. The figure is on an invoice. */
  'provider_reported',
  /** No call was made, so nothing was billed. Measured, not assumed. */
  'measured_absence',
  /** Not settled. */
  'none',
] as const;

export type SettlementBasis = (typeof SETTLEMENT_BASES)[number];

/** The outcome the spend bought. `in_progress` is not an outcome yet. */
export const FINANCIAL_OUTCOMES = [
  'succeeded',
  'failed',
  'cancelled',
  'expired',
  'policy_denied',
  'in_progress',
] as const;

export type FinancialOutcome = (typeof FINANCIAL_OUTCOMES)[number];

export function isTerminalOutcome(outcome: FinancialOutcome): boolean {
  return outcome !== 'in_progress';
}

/**
 * Where the money went. A closed vocabulary, so every micro-USD is nameable.
 *
 * `primary_inference` and the four spend categories below it partition ACTUAL
 * cost. The saving categories are Part 6A's and are not repeated here — Part 6C
 * reads `SavingsEntry` rather than re-deriving a second breakdown of the same
 * gap, because a second breakdown is a second opinion about one number.
 */
export const COST_CATEGORIES = [
  /** The first attempt at a node. What the work was supposed to cost. */
  'primary_inference',
  /** Attempts after the first. Real money, isolated so it can be read. */
  'retry',
  /** A follow-up call to fix a malformed or unusable output. */
  'repair',
  /** A deliberate move to a higher capability band after a cheap attempt. */
  'escalation',
  /** Spend inside a parallel branch. */
  'branch',
  /** Spend by a child agent run driven by a workflow node. */
  'child_agent',
  /** Tool execution cost, where the gateway measures one. */
  'tool',
] as const;

export type CostCategory = (typeof COST_CATEGORIES)[number];

/** Provider and model identity, for attribution only. Never for selection. */
export interface ProviderIdentity {
  readonly providerName?: string;
  readonly modelName?: string;
}

/**
 * One immutable financial event.
 *
 * `eventId` is DERIVED from the identity fields (see `financialEventLedger.ts`),
 * so re-deriving an event from the same artefacts produces the same id and the
 * store's insert-if-absent refuses the duplicate. Re-running a report cannot
 * inflate it, and a retried workflow advance cannot double-charge it.
 */
export interface FinancialEvent {
  readonly schema: typeof FINANCIAL_EVENT_SCHEMA;
  readonly eventId: string;
  readonly organizationId: string;
  readonly eventType: FinancialEventType;
  readonly costCategory: CostCategory;

  // ── Attribution identity. Every dimension a view can group by ─────────────
  readonly actorId: string;
  readonly workflowId?: string;
  readonly workflowVersion?: string;
  readonly workflowRunId?: string;
  readonly nodeId?: string;
  readonly branchId?: string;
  readonly groupId?: string;
  readonly agentRunId?: string;
  readonly agentId?: string;
  readonly agentVersion?: string;
  readonly featureId?: string;
  readonly provider: ProviderIdentity;
  readonly capabilityProfile?: CapabilityProfile;
  /** Which attempt of the node this was. 1 is the primary attempt. */
  readonly retryAttempt: number;

  // ── The optimisation story ────────────────────────────────────────────────
  readonly decision: CompressionDecision;
  readonly decisionReason: CompressionReason;
  readonly quality: QualityProfile;
  /** Present on an avoided call answered from the reuse engine. */
  readonly reuseType?: 'exact' | 'semantic';
  /** Present on an avoided call answered from the reuse engine. */
  readonly reusableResultId?: string;

  // ── Money. Three separate figures that are never blended ──────────────────
  readonly baselinePolicyVersion: string;
  readonly baselineCostMicroUsd: number;
  readonly optimizedEstimatedCostMicroUsd: number;
  /**
   * Measured spend. ABSENT until settlement.
   *
   * Absent rather than zero, and the whole engine is built around that
   * distinction: a missing settlement treated as zero makes unsettled work look
   * free, which makes savings look complete, silently and with balanced
   * arithmetic.
   */
  readonly actualCostMicroUsd?: number;
  readonly estimatedSavingsMicroUsd: number;
  /** baseline − actual. Present only when `actualCostMicroUsd` is. */
  readonly realizedSavingsMicroUsd?: number;
  /** Part 6A's partition of the estimated gap. Read, never re-derived. */
  readonly savingsEntries: readonly SavingsEntry[];

  // ── Tokens, on the same three-figure discipline ───────────────────────────
  readonly baselineTokens: number;
  readonly actualTokens?: number;
  readonly tokensAvoided: number;

  // ── Settlement and outcome ────────────────────────────────────────────────
  readonly settlementState: SettlementState;
  readonly settlementBasis: SettlementBasis;
  readonly outcome: FinancialOutcome;

  /**
   * True when the work is mandatory, safety-critical or approval-bound.
   *
   * Read by the waste analysis, which must never label required safety or
   * approval work as waste. A compliance step the platform was obliged to run is
   * not money the platform should have avoided, and reporting it as waste would
   * put pressure on exactly the work that must not feel any.
   */
  readonly protectedWork: boolean;

  // ── Provenance ────────────────────────────────────────────────────────────
  readonly policyVersion: string;
  readonly optimizationPolicyVersion: string;
  /** Digest of the figures this event was derived from. Recomputable. */
  readonly provenanceDigest: string;
  /** Supplied by the caller's clock. This tree reads none. */
  readonly occurredAt: number;
}

/**
 * Structural validation for an event that came back FROM storage.
 *
 * A malformed row is dropped rather than summed. An aggregate is the worst place
 * to discover a corrupt record, because by then it has been averaged into
 * something that looks plausible.
 */
export function isWholeFinancialEvent(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  if (event.schema !== FINANCIAL_EVENT_SCHEMA) return false;

  for (const field of ['eventId', 'organizationId', 'actorId', 'baselinePolicyVersion']) {
    if (typeof event[field] !== 'string' || event[field] === '') return false;
  }
  if (!FINANCIAL_EVENT_TYPES.includes(event.eventType as FinancialEventType)) return false;
  if (!COST_CATEGORIES.includes(event.costCategory as CostCategory)) return false;
  if (!SETTLEMENT_STATES.includes(event.settlementState as SettlementState)) return false;
  if (!SETTLEMENT_BASES.includes(event.settlementBasis as SettlementBasis)) return false;
  if (!FINANCIAL_OUTCOMES.includes(event.outcome as FinancialOutcome)) return false;

  for (const field of [
    'baselineCostMicroUsd',
    'optimizedEstimatedCostMicroUsd',
    'estimatedSavingsMicroUsd',
    'baselineTokens',
    'tokensAvoided',
    'retryAttempt',
    'occurredAt',
  ]) {
    const candidate = event[field];
    if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < 0) return false;
  }

  // A settled event MUST carry a measurement, and an unsettled one must NOT.
  // Either violation would let unsettled spend be read as zero somewhere
  // downstream, which is the defect this whole contract is shaped around.
  const settled = event.settlementState === 'settled';
  const hasActual = typeof event.actualCostMicroUsd === 'number';
  if (settled !== hasActual) return false;

  if (!Array.isArray(event.savingsEntries)) return false;
  if (typeof event.protectedWork !== 'boolean') return false;
  return true;
}
