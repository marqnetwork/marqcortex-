/**
 * The Cortex Financial Intelligence Engine — public surface
 * (AI-01 Batch 3B, Part 6C).
 *
 * ── WHAT PART 6C IS ────────────────────────────────────────────────────────
 *
 * Parts 1–6B produced the facts: a versioned baseline, a savings partition that
 * cannot double count, a usage fold that cannot double charge, and an
 * avoided-call ledger that cannot attribute one avoided call twice. Part 6C
 * turns those facts into financial intelligence WITHOUT becoming a second
 * opinion about any of them.
 *
 * Every figure here is derived from one canonical `FinancialEvent`, and every
 * event is assembled from artefacts the earlier parts produced under their own
 * controls. There is no parameter through which a caller states a cost or a
 * saving, and nothing in this tree builds a savings record — the boundary scan
 * asserts that on the source.
 *
 * ── THE THREE RULES THIS ENGINE IS SHAPED AROUND ──────────────────────────
 *
 *   ESTIMATED AND REALISED NEVER MIX. Separate fields, separate denominators,
 *   separate names. The headline reduction reads settled data only.
 *
 *   UNSETTLED IS UNKNOWN, NEVER ZERO. An unsettled event contributes to neither
 *   the realised numerator nor its denominator, and coverage travels with every
 *   realised figure as a required field.
 *
 *   90% IS DECIDED ON INTEGERS. Achievement is computed from integer micro-USD
 *   before any rounding, and gated on settlement coverage, so 89.95% cannot
 *   become a claim of success and neither can 90% measured over a sliver.
 *
 * ── READ-ONLY, ALWAYS ──────────────────────────────────────────────────────
 *
 * Nothing here executes, mutates a budget, spends an approval, resolves an
 * actor, selects a provider or reaches the Control Plane. Provider and model
 * names appear as attribution identity and as nothing else.
 *
 * ── DEFERRED, DELIBERATELY ─────────────────────────────────────────────────
 *
 * Admin UI, HTTP routes, autonomous recommendations, ML forecasting and
 * LLM-generated analysis. This ships the numbers a surface will read and ships
 * no surface.
 */

export type { FinancialFailureCode } from './contracts/failures.ts';
export { FinancialError, financialFailure, isFinancialError } from './contracts/failures.ts';

export type {
  CostCategory,
  FinancialEvent,
  FinancialEventType,
  FinancialOutcome,
  ProviderIdentity,
  SettlementBasis,
  SettlementState,
} from './contracts/event.ts';
export {
  COST_CATEGORIES,
  FINANCIAL_EVENT_SCHEMA,
  FINANCIAL_EVENT_TYPES,
  FINANCIAL_OUTCOMES,
  SETTLEMENT_BASES,
  SETTLEMENT_STATES,
  isTerminalOutcome,
  isWholeFinancialEvent,
} from './contracts/event.ts';

export type { AttributionDimension } from './contracts/attribution.ts';
export { ATTRIBUTION_DIMENSIONS, UNATTRIBUTED, bucketKeyFor } from './contracts/attribution.ts';

export type {
  FinancialTotals,
  FinancialWindow,
  SettlementCoverage,
} from './contracts/report.ts';
export {
  assertWindow,
  emptyTotals,
  inWindow,
  percentOf,
  windowDays,
} from './contracts/report.ts';

export type {
  FinancialEventContext,
  FinancialEventIdentity,
  SettlementInput,
} from './ledger/financialEventLedger.ts';
export {
  abandonSettlement,
  deriveFinancialEvent,
  deriveSettlementsFromUsage,
  financialEventIdFor,
  settleFinancialEvent,
} from './ledger/financialEventLedger.ts';

export {
  COVERAGE_FLOOR_PERCENT,
  COVERAGE_POLICY_VERSION,
  eventsInWindow,
  foldTotals,
  settlementCoverage,
} from './engine/settlement.ts';

export type { TargetAssessment, TargetProgress } from './engine/targetProgress.ts';
export {
  TARGET_ASSESSMENTS,
  TARGET_POLICY_VERSION,
  TARGET_REDUCTION_PERCENT,
  assessTargetProgress,
} from './engine/targetProgress.ts';

export type { AttributionAggregate, AttributionBucket } from './engine/attributionEngine.ts';
export {
  aggregateBy,
  reconcileAttribution,
  assertSavingsBreakdownBalances,
  savingsByCategory,
} from './engine/attributionEngine.ts';

export type { WasteCategory, WasteEntry, WasteEvidence, WasteReport } from './engine/wasteAnalysis.ts';
export { WASTE_CATEGORIES, analyzeWaste, retryWasteMicroUsd } from './engine/wasteAnalysis.ts';

export type { OutcomeEconomics, RunEconomics } from './engine/outcomeEconomics.ts';
export {
  MIN_RUNS_FOR_OUTLIERS,
  OUTLIER_MEDIAN_MULTIPLE,
  OUTLIER_POLICY_VERSION,
  analyzeOutcomes,
  runEconomics,
} from './engine/outcomeEconomics.ts';

export type {
  OptimizationQualityEvidence,
  OptimizationScore,
  OptimizationScoreInput,
  ScoreComponent,
  ScoreReason,
} from './engine/optimizationScore.ts';
export {
  CAP_ON_VIOLATION,
  OPTIMIZATION_SCORE_VERSION,
  SCORE_REASONS,
  SCORE_WEIGHTS,
  scoreOptimization,
} from './engine/optimizationScore.ts';

export type { BurnProjection } from './engine/burnRate.ts';
export {
  BURN_POLICY_VERSION,
  MIN_SAMPLE_EVENTS,
  MIN_WINDOW_DAYS,
  PROJECTION_MONTH_DAYS,
  projectBurn,
} from './engine/burnRate.ts';

export type {
  BudgetSnapshot,
  BudgetUtilizationEntry,
  BudgetUtilizationInput,
  BudgetUtilizationReport,
  PlatformCeilingSnapshot,
} from './engine/budgetUtilization.ts';
export { reportBudgetUtilization } from './engine/budgetUtilization.ts';

export type {
  FinancialAppendOutcome,
  FinancialEventPage,
  FinancialEventQuery,
  FinancialEventStore,
} from './persistence/ports.ts';
export {
  MAX_EVENT_SCAN_ROWS,
  boundedEventLimit,
  createInMemoryFinancialEventStore,
  matchesEventQuery,
  sortEvents,
} from './persistence/ports.ts';

export type {
  KvFinancialConditionalWriter,
  KvFinancialPrefixReader,
  KvFinancialReader,
  KvFinancialStoreOptions,
} from './persistence/kvFinancialEventStore.ts';
export {
  createKvFinancialEventStore,
  financialEventKeyFor,
  financialEventPrefixFor,
} from './persistence/kvFinancialEventStore.ts';

export type {
  FinancialReadScope,
  FinancialSummary,
  PlatformFinancialAuthority,
  PlatformFinancialSummary,
  ReuseEconomicsView,
} from './service/financialReadModels.ts';
export {
  burnProjection,
  costByDimension,
  financialSummary,
  optimizationScore,
  outcomeEconomics,
  platformFinancialSummary,
  reuseEconomics,
  targetProgress,
  wasteReport,
} from './service/financialReadModels.ts';
