/**
 * The optimization score (AI-01 Batch 3B).
 *
 * One number, 0–100, saying how well a run was optimized — and, crucially, the
 * nine components that produced it.
 *
 * NOT AN AI-GENERATED SCORE. A model asked "how well optimized was this run?"
 * would produce a plausible number that varies between identical runs and cannot
 * be recomputed by anyone. This is a weighted sum of measured ratios with a
 * versioned formula, so two people looking at the same run get the same score and
 * can see exactly which component cost it points.
 *
 * IT NEVER REWARDS CHEAPNESS BOUGHT WITH QUALITY OR SAFETY.
 *
 * That is the property that makes the score safe to optimize against. Three
 * penalties enforce it, and all three are applied AFTER the weighted sum:
 *
 *   a run that violated its output contract          → capped
 *   a run that was downgraded below its quality floor → capped
 *   a run that failed                                 → capped
 *
 * Without them, the highest-scoring run would be one that skipped every model
 * call, produced nothing, and cost nothing. A metric with that maximum is worse
 * than no metric, because somebody will eventually tune towards it.
 *
 * EVERY COMPONENT IS A RATIO OF TWO MEASURED NUMBERS. Nothing here is a judgement
 * and nothing is a constant pulled from the air; a component whose inputs are
 * absent scores neutral rather than zero, so a run that had no opportunity to save
 * anything is not punished for it.
 */

export const OPTIMIZATION_SCORE_VERSION = '1.0.0';

export interface ScoreComponent {
  readonly component: string;
  /** The measured ratio, 0–1. */
  readonly value: number;
  readonly weight: number;
  /** `value * weight`, rounded to two places. */
  readonly contribution: number;
  /** What was measured, in one sentence a reviewer can check. */
  readonly basis: string;
}

export interface OptimizationScore {
  /** 0–100. Higher is better optimized. */
  readonly score: number;
  readonly grade: 'excellent' | 'good' | 'fair' | 'poor';
  readonly components: readonly ScoreComponent[];
  readonly penalties: readonly { readonly penalty: string; readonly cap: number; readonly reason: string }[];
  readonly formulaVersion: string;
  readonly explanation: string;
}

export interface OptimizationScoreInput {
  // ── Token efficiency ──────────────────────────────────────────────────────
  readonly originalContextTokens: number;
  readonly finalContextTokens: number;
  // ── Routing ───────────────────────────────────────────────────────────────
  /** Model steps that selected the cheapest capable profile available. */
  readonly stepsOnCheapestCapableProfile: number;
  readonly modelSteps: number;
  // ── Cache ─────────────────────────────────────────────────────────────────
  readonly cacheHits: number;
  readonly cacheEligibleSteps: number;
  // ── Avoided work ──────────────────────────────────────────────────────────
  readonly avoidedCalls: number;
  readonly optionalNodes: number;
  // ── Retry efficiency ──────────────────────────────────────────────────────
  readonly retries: number;
  readonly totalSteps: number;
  // ── Cost accuracy ─────────────────────────────────────────────────────────
  readonly estimatedCostMicroUsd: number;
  readonly actualCostMicroUsd: number;
  // ── Outcome ───────────────────────────────────────────────────────────────
  readonly withinCostBudget: boolean;
  readonly withinLatencyObjective: boolean;
  readonly outputValidationPassed: boolean;
  readonly completed: boolean;
  /** True when routing went below the node's declared quality floor. */
  readonly qualityFloorViolated: boolean;
}

/**
 * Weights, summing to 1.0.
 *
 * Token reduction and routing carry the most because they are the two levers that
 * apply to every billable step. Cache and avoided work carry less because a run
 * with no cacheable node has no opportunity to use them — and they score neutral
 * in that case rather than zero, so the weight would otherwise be dead.
 */
const WEIGHTS = {
  tokenReduction: 0.22,
  cheapestCapableRouting: 0.2,
  cacheUtilization: 0.12,
  avoidedWork: 0.1,
  retryEfficiency: 0.12,
  costAccuracy: 0.1,
  withinBudget: 0.06,
  withinLatency: 0.04,
  outputValid: 0.04,
} as const;

/** A component with no denominator scores neutral, not zero. See the header. */
const NEUTRAL = 0.5;

function ratio(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) return NEUTRAL;
  return Math.max(0, Math.min(1, numerator / denominator));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeOptimizationScore(input: OptimizationScoreInput): OptimizationScore {
  const components: ScoreComponent[] = [];
  const push = (component: string, value: number, weight: number, basis: string): void => {
    const bounded = Math.max(0, Math.min(1, value));
    components.push({
      component,
      value: round2(bounded),
      weight,
      contribution: round2(bounded * weight),
      basis,
    });
  };

  // 1 — Unnecessary tokens removed, as a share of what was offered.
  const removed = Math.max(0, input.originalContextTokens - input.finalContextTokens);
  push(
    'token_reduction',
    ratio(removed, input.originalContextTokens),
    WEIGHTS.tokenReduction,
    `${removed} of ${input.originalContextTokens} offered context tokens were removed`,
  );

  // 2 — Steps that took the cheapest capable profile.
  push(
    'cheapest_capable_routing',
    ratio(input.stepsOnCheapestCapableProfile, input.modelSteps),
    WEIGHTS.cheapestCapableRouting,
    `${input.stepsOnCheapestCapableProfile} of ${input.modelSteps} model steps used the cheapest capable profile`,
  );

  // 3 — Cache utilization, over steps that were ELIGIBLE. Measuring over all
  // steps would penalise a workflow whose nodes are legitimately uncacheable.
  push(
    'cache_utilization',
    ratio(input.cacheHits, input.cacheEligibleSteps),
    WEIGHTS.cacheUtilization,
    `${input.cacheHits} hits across ${input.cacheEligibleSteps} cache-eligible steps`,
  );

  // 4 — Optional work that was correctly skipped or answered deterministically.
  push(
    'avoided_work',
    ratio(input.avoidedCalls, Math.max(input.optionalNodes, input.avoidedCalls)),
    WEIGHTS.avoidedWork,
    `${input.avoidedCalls} avoided calls against ${input.optionalNodes} optional nodes`,
  );

  // 5 — Retry efficiency: 1 when nothing was retried, falling as retries mount.
  push(
    'retry_efficiency',
    input.totalSteps <= 0 ? NEUTRAL : 1 - ratio(input.retries, input.totalSteps),
    WEIGHTS.retryEfficiency,
    `${input.retries} retries across ${input.totalSteps} steps`,
  );

  // 6 — Cost accuracy. Both directions are penalised: an estimate far ABOVE the
  // actual over-reserves headroom and refuses legitimate traffic, and one far
  // BELOW it is a control that will fail open. A ratio of 1.0 scores best.
  const accuracy =
    input.estimatedCostMicroUsd <= 0 || input.actualCostMicroUsd <= 0
      ? NEUTRAL
      : 1 -
        Math.min(
          1,
          Math.abs(input.actualCostMicroUsd - input.estimatedCostMicroUsd) /
            Math.max(input.estimatedCostMicroUsd, input.actualCostMicroUsd),
        );
  push(
    'cost_accuracy',
    accuracy,
    WEIGHTS.costAccuracy,
    `estimated ${input.estimatedCostMicroUsd} against actual ${input.actualCostMicroUsd} micro-USD`,
  );

  push(
    'within_budget',
    input.withinCostBudget ? 1 : 0,
    WEIGHTS.withinBudget,
    input.withinCostBudget ? 'completed inside its cost budget' : 'exceeded its cost budget',
  );
  push(
    'within_latency',
    input.withinLatencyObjective ? 1 : 0,
    WEIGHTS.withinLatency,
    input.withinLatencyObjective ? 'met its latency objective' : 'missed its latency objective',
  );
  push(
    'output_valid',
    input.outputValidationPassed ? 1 : 0,
    WEIGHTS.outputValid,
    input.outputValidationPassed ? 'output validation passed' : 'output validation failed',
  );

  const raw = components.reduce((sum, component) => sum + component.contribution, 0) * 100;

  // ── Penalties: caps, not subtractions ─────────────────────────────────────
  //
  // A cap is stronger than a deduction. Subtracting points would let a run with
  // enough savings still score well despite violating its output contract, which
  // is precisely the trade the score must never endorse.
  const penalties: { penalty: string; cap: number; reason: string }[] = [];
  if (!input.outputValidationPassed) {
    penalties.push({
      penalty: 'output_contract_violated',
      cap: 40,
      reason: 'a run whose output failed validation is not a well-optimized run',
    });
  }
  if (input.qualityFloorViolated) {
    penalties.push({
      penalty: 'quality_floor_violated',
      cap: 50,
      reason: 'savings bought by routing below the declared quality floor do not count',
    });
  }
  if (!input.completed) {
    penalties.push({
      penalty: 'did_not_complete',
      cap: 60,
      reason: 'an incomplete run cannot be scored as efficient',
    });
  }

  const cap = penalties.reduce((lowest, penalty) => Math.min(lowest, penalty.cap), 100);
  const score = Math.max(0, Math.min(Math.round(raw), cap));

  const grade: OptimizationScore['grade'] =
    score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'fair' : 'poor';

  const weakest = [...components].sort((a, b) => a.value - b.value)[0];
  const explanation =
    penalties.length > 0
      ? `capped at ${cap} because ${penalties.map((penalty) => penalty.penalty).join(', ')}`
      : `weighted components total ${Math.round(raw)}; weakest component is ${weakest?.component ?? 'none'}`;

  return {
    score,
    grade,
    components,
    penalties,
    formulaVersion: OPTIMIZATION_SCORE_VERSION,
    explanation,
  };
}
