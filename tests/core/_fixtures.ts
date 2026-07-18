/**
 * Shared fixtures for the core math-engine unit tests (F-010 / RC-005).
 * Not a test file (no `.test.ts`) so the runner does not execute it directly.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  PortfolioCashflow,
  MonthlyProjection,
  NormalizedDiagnostics,
  NormalizedAnswer,
  CausalCategory,
  DomainKey,
} from '../../src/app/core/types.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── Cash-flow fixtures (for DCF / IRR / Monte Carlo) ────────────────────────

/**
 * Build a PortfolioCashflow from a net-cash-flow series.
 * `gains` (defaults to max(0, net)) drives the timeline-extension pad value,
 * which the DCF/IRR engines read from the last month's `gain`.
 */
export function makePortfolioCashflow(nets: number[], gains?: number[]): PortfolioCashflow {
  let running = 0;
  const monthly_projection: MonthlyProjection[] = nets.map((net, i) => {
    running += net;
    return {
      month: i + 1,
      investment: net < 0 ? -net : 0,
      gain: gains ? gains[i] : Math.max(0, net),
      net,
      cumulative: running,
    };
  });
  const paybackIdx = monthly_projection.findIndex((m) => m.cumulative >= 0);
  const payback = paybackIdx >= 0 ? paybackIdx + 1 : null;
  return {
    monthly_projection,
    true_payback_month: payback,
    cashflow_positive_after_month: payback,
  };
}

/** A standard 12-month project: one upfront investment, then level positive gains. */
export const STANDARD_CASHFLOW = makePortfolioCashflow([
  -50000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000,
]);

// ── Diagnostics fixtures (for Scoring) ──────────────────────────────────────

export function makeAnswer(
  questionId: number,
  category: string,
  causal: { category: CausalCategory; weight: number }[],
  maturityScore: number,
): NormalizedAnswer {
  return {
    questionId,
    questionText: `Q${questionId}`,
    category,
    answer: 'fixture answer',
    wordCount: 12,
    causalCategories: causal.map((c) => ({
      category: c.category,
      weight: c.weight,
      matchedKeywords: ['kw'],
    })),
    signalType: 'pain',
    maturityScore,
    isEmpty: false,
  };
}

export function makeDiagnostics(
  answers: NormalizedAnswer[],
  domainPainCounts: Partial<Record<DomainKey, number>> = {},
  industry = 'General',
): NormalizedDiagnostics {
  const pains: Record<DomainKey, number> = {
    operations: 0, revenue: 0, systems: 0, governance: 0, customer_experience: 0, data: 0,
    ...domainPainCounts,
  };
  return {
    company: 'FixtureCo',
    industry,
    employeeEstimate: 24,
    answers,
    totalSignals: answers.length,
    signalsByType: { pain: answers.length, opportunity: 0, risk: 0, strength: 0 },
    domainPainCounts: pains,
    answerCount: answers.length,
    answeredQuestions: answers.length,
    avgWordCount: 12,
    completenessRatio: 1,
  };
}

/** Empty diagnostics — no answers at all (data-quality edge case). */
export const EMPTY_DIAGNOSTICS = makeDiagnostics([]);

// ── Gold-standard portfolio fixture (for ROI) ───────────────────────────────

/**
 * Loads the ExampleCo gold-standard diagnostic and shapes it into the
 * BusinessTransformationPortfolio that buildPortfolioROI consumes.
 */
export function loadGoldPortfolio() {
  const json = JSON.parse(
    readFileSync(join(REPO_ROOT, 'src/imports/exampleco-portfolio-diagnostic-1.json'), 'utf8'),
  );
  const recs = json.outputs.recommendations;
  const portfolio = {
    recommendations: recs.recommendations,
    cross_dependencies: [],
    execution_sequence_model: {
      recommended_execution_order: recs.portfolio_summary.global_priority_ranking,
    },
  } as any;
  return {
    portfolio,
    assumptions: json.inputs.assumptions,
    employeeEstimate: json.inputs.business_snapshot.team_size as number,
  };
}
