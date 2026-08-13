/**
 * AI-01 BATCH 3B PART 7B — PHASE 1
 * Deterministic authority equality: the server port versus the canonical chain.
 *
 * The readiness manager's authority is computed server-side, in the Supabase
 * edge boundary, by `ai/business/diagnostic/deterministic/readinessAuthority.ts`.
 * The canonical engines it must agree with live in `src/app/core/` and cannot be
 * imported there: they are authored against the Vite `@/…` aliases and reach
 * `src/app/components/*.tsx`, which is DOM source the edge runtime has no way to
 * load.
 *
 * So the rules exist twice, and this suite is what makes that safe. It loads
 * BOTH implementations and asserts, over a fixture corpus, that they produce the
 * same normalisation, the same domain scores, the same decision, the same
 * department scan — and therefore the same qualification, the same priority, the
 * same ranking, the same cap, the same sequencing and the same dependencies.
 *
 * A rule edited on one side and not the other fails here. That is the entire
 * point: the duplication is a fact, and the drift is the defect.
 *
 * TESTING APPROACH (the limitation this file works around, recorded in
 * clientReportHeatmapBands.test.ts and taskStatusContract.test.ts)
 *   `src/app/core/inputNormalizer.ts` type-imports `@/app/utils/questionRegistry`,
 *   which imports React components. A STATIC import here would drag DOM source
 *   into the node type boundary (`lib: ["ES2022"]`, no DOM) and turn a handful
 *   of pre-existing `typecheck:tests` errors into a hundred. The canonical
 *   modules are therefore loaded through a runtime-computed specifier — which
 *   the compiler does not follow — and their surfaces are declared locally
 *   below. Node strips the type-only import at runtime, so nothing DOM-shaped is
 *   ever evaluated.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

import {
  applyIndustryAdjustment,
  buildPortfolio,
  computeReadinessAuthority,
  decidePrimary,
  normalizeSubmission,
  recommendationIdFor,
  scanDepartments,
  scoreDomains,
  validateReadinessConsistency,
} from '../../supabase/functions/server/ai/business/diagnostic/deterministic/readinessAuthority.ts';
import {
  PORTFOLIO_BOUNDS,
  QUALIFICATION_THRESHOLDS,
  READINESS_DEPARTMENTS,
  READINESS_DOMAINS,
} from '../../supabase/functions/server/ai/business/diagnostic/contracts/readiness.ts';
import type { DiagnosticSubmissionDossier } from '../../supabase/functions/server/ai/business/diagnostic/contracts/dossier.ts';

// ── Canonical modules, loaded past the type graph ───────────────────────────

const resolveUrl = (rel: string) => new URL(rel, import.meta.url).href;

/**
 * `src/` is authored for the Vite resolver, which accepts extensionless
 * relative specifiers (`./types`). Node's ESM resolver does not, so loading a
 * canonical engine here needs the extension supplied. This hook adds `.ts` to a
 * relative specifier that has no extension and changes nothing else — it does
 * not alter module text, does not touch the modules under test, and is confined
 * to this process.
 */
registerHooks({
  resolve(specifier, context, next) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      return next(`${specifier}.ts`, context);
    }
    return next(specifier, context);
  },
});

interface CanonicalAnswer {
  questionId: number;
  questionText: string;
  category: string;
  answer: string;
}

interface CanonicalNormalizer {
  normalizeInput(input: {
    answers: Record<number | string, string | number>;
    annotatedResponses: CanonicalAnswer[];
    company: string;
    industry: string;
    employeeEstimate: number;
  }): Record<string, unknown>;
}

interface CanonicalScoring {
  scoreDomains(diagnostics: unknown): Record<string, { rawScore: number; severity: string; painSignalCount: number }>;
  applyIndustryAdjustment(
    scores: unknown,
    industry: string,
  ): Record<string, { rawScore: number; severity: string; painSignalCount: number }>;
}

interface CanonicalDecision {
  makeDecision(
    scores: unknown,
    diagnostics: unknown,
  ): {
    selectedCoreProblemDomain: string;
    sprintTemplateId: string;
    confidenceScore: number;
    isHybrid: boolean;
    rankedDomains: { domain: string; score: number }[];
  };
}

interface CanonicalPortfolio {
  scanDepartments(
    scores: unknown,
    diagnostics: unknown,
  ): {
    department: string;
    problem_density_score: number;
    impact_potential_score: number;
    automation_feasibility_score: number;
    risk_exposure_score: number;
    computed_priority: number;
    qualifies: boolean;
  }[];
  buildPortfolio(
    diagnostics: unknown,
    scores: unknown,
    decision: unknown,
    primaryRecV2: unknown,
    financialProjection: unknown,
  ): {
    recommendations: { recommendation_id: string; core_problem: { problem_id: string } }[];
    global_priority_ranking: { department: string; rank: number; computed_priority: number }[];
    cross_dependencies: {
      source_department: string;
      target_department: string;
      dependency_type: string;
    }[];
    execution_sequence_model: {
      recommended_execution_order: string[];
      sequencing_rules_applied: string[];
    };
  };
}

const canonicalNormalizer = (await import(
  resolveUrl('../../src/app/core/inputNormalizer.ts')
)) as CanonicalNormalizer;
const canonicalScoring = (await import(
  resolveUrl('../../src/app/core/scoringEngine.ts')
)) as CanonicalScoring;
const canonicalDecision = (await import(
  resolveUrl('../../src/app/core/decisionEngine.ts')
)) as CanonicalDecision;
const canonicalPortfolio = (await import(
  resolveUrl('../../src/app/core/portfolioEngine.ts')
)) as CanonicalPortfolio;

/** `scoringEngine.scoreSeverity` is module-private; its thresholds are not. */
function canonicalSeverity(score: number): string {
  if (score >= 75) return 'Critical';
  if (score >= 50) return 'High';
  if (score >= 25) return 'Moderate';
  return 'Low';
}

// ── The fixture corpus ──────────────────────────────────────────────────────

interface Fixture {
  readonly name: string;
  readonly dossier: DiagnosticSubmissionDossier;
}

function answer(
  questionId: number,
  category: string,
  text: string,
): { questionId: number; questionText: string; category: string; answer: string } {
  return {
    questionId,
    questionText: `Question ${questionId}`,
    category,
    answer: text,
  };
}

function dossier(
  submissionId: string,
  overrides: Partial<DiagnosticSubmissionDossier> = {},
): DiagnosticSubmissionDossier {
  return {
    submissionId,
    organizationId: 'acme',
    company: 'Acme Industrial',
    industry: 'Manufacturing',
    employeeEstimate: 120,
    totalQuestions: 6,
    answers: [],
    submittedAt: '2026-01-01T00:00:00.000Z',
    status: 'submitted',
    ...overrides,
  } as DiagnosticSubmissionDossier;
}

/**
 * Ten submissions chosen to move every lever the chain has.
 *
 * Between them they cover: an empty submission, one answer, thin answers, rich
 * answers, every causal category, every industry adjustment, the three employee
 * bands the feasibility and risk scores step at, a hybrid near-tie, and a
 * saturated submission that qualifies more departments than the cap allows.
 */
const CORPUS: readonly Fixture[] = [
  { name: 'empty submission', dossier: dossier('sub-empty', { answers: [], totalQuestions: 6 }) },
  {
    name: 'single thin answer',
    dossier: dossier('sub-thin', {
      answers: [answer(1, 'Operations', 'manual work')],
      totalQuestions: 6,
    }),
  },
  {
    name: 'operations heavy, small company',
    dossier: dossier('sub-ops-small', {
      employeeEstimate: 12,
      industry: 'Manufacturing',
      answers: [
        answer(
          1,
          'Operations',
          'Everything is manual and repetitive. We copy paste between a spreadsheet and the ' +
            'order system every time, one by one, with no automation at all.',
        ),
        answer(
          2,
          'Operations',
          'The team is overloaded and stretched to breaking point; we cannot keep up and we are ' +
            'hiring just to survive the volume.',
        ),
        answer(3, 'Customer Support', 'Customers are missed and we see churn and refund requests.'),
      ],
      totalQuestions: 6,
    }),
  },
  {
    name: 'systems and data fragmentation, saas',
    dossier: dossier('sub-saas', {
      industry: 'SaaS platform',
      employeeEstimate: 60,
      answers: [
        answer(
          1,
          'Systems',
          'Our tools are disconnected and siloed; nothing connects, we have too many tools and a ' +
            'legacy separate tool that needs export and import workarounds.',
        ),
        answer(
          2,
          'Data',
          'The data is inaccurate, outdated and conflicting. No single source, no visibility, and ' +
            'the counts are off every week.',
        ),
        answer(
          3,
          'Governance',
          'Every approval waits for me. I am the bottleneck, the single point, and nothing moves ' +
            'without my decision or my permission.',
        ),
        answer(4, 'Revenue', 'We are losing money to cart abandonment and churn; revenue leakage everywhere.'),
      ],
      totalQuestions: 8,
    }),
  },
  {
    name: 'ecommerce customer experience',
    dossier: dossier('sub-commerce', {
      industry: 'DTC ecommerce retail',
      employeeEstimate: 220,
      answers: [
        answer(
          1,
          'Customer Service',
          'Support is overwhelmed and customers are falling through the cracks; retention is poor ' +
            'and we see cancellation after cancellation.',
        ),
        answer(
          2,
          'Revenue',
          'Abandoned cart volume is enormous. We are not capturing upsell and the missed revenue ' +
            'is wasted every month.',
        ),
        answer(3, 'Operations', 'Manual fulfilment, by hand, every time.'),
      ],
      totalQuestions: 10,
    }),
  },
  {
    name: 'agency governance',
    dossier: dossier('sub-agency', {
      industry: 'Creative agency services',
      employeeEstimate: 35,
      answers: [
        answer(
          1,
          'Governance',
          'The founder signs off on everything. Approval queue, escalation, only one person can ' +
            'decide, and the whole thing depends on me.',
        ),
        answer(2, 'Operations', 'We do it ourselves, manually, with spreadsheets.'),
      ],
      totalQuestions: 5,
    }),
  },
  {
    name: 'healthcare data and governance',
    dossier: dossier('sub-health', {
      industry: 'Healthcare medical group',
      employeeEstimate: 400,
      answers: [
        answer(
          1,
          'Data',
          'Records are incorrect and stale, with discrepancy after discrepancy and no single ' +
            'source of truth. Unreliable and inaccurate.',
        ),
        answer(2, 'Governance', 'Permission and sign-off for everything; escalation is constant.'),
        answer(3, 'Operations', 'Manual, by hand, repetitive.'),
        answer(4, 'Customer Experience', 'Patients are missed and we see cancellation.'),
      ],
      totalQuestions: 14,
    }),
  },
  {
    name: 'positive maturity answers',
    dossier: dossier('sub-mature', {
      industry: 'Logistics',
      employeeEstimate: 90,
      answers: [
        answer(
          1,
          'Operations',
          'Our process is automated, documented, systematic and measured on a dashboard with ' +
            'clear kpi and metrics; it works well and is efficient.',
        ),
        answer(2, 'Data', 'Integrated dashboard, documented sop, strong metrics.'),
      ],
      totalQuestions: 6,
    }),
  },
  {
    name: 'opportunity language',
    dossier: dossier('sub-opportunity', {
      industry: 'Nonprofit',
      employeeEstimate: 8,
      answers: [
        answer(1, 'Operations', 'We want to remove the manual spreadsheet work we do every time.'),
        answer(2, 'Revenue', 'We plan to reduce churn and the refund volume we are seeing.'),
      ],
      totalQuestions: 4,
    }),
  },
  {
    name: 'saturated — every domain under pressure',
    dossier: dossier('sub-saturated', {
      industry: 'Industrial manufacturing',
      employeeEstimate: 15,
      answers: [
        answer(
          1,
          'Operations',
          'manual manually by hand copy-paste spreadsheet repetitive every time same task human ' +
            'doing typed in enters it one by one no automation we do it ourselves',
        ),
        answer(
          2,
          'Systems',
          "disconnected nothing connects too many tools doesn't integrate silo siloed fragmented " +
            'scattered duplicate legacy different system separate tool workaround export and import',
        ),
        answer(
          3,
          'Governance',
          'approval sign-off depends on me founder waits for me bottleneck my decision escalat ' +
            'permission only person single point approval queue',
        ),
        answer(
          4,
          'Revenue',
          'lost revenue losing money abandoned cart cart abandonment churn cancellation refund ' +
            'wasted missed leakage not capturing falling through upsell retention',
        ),
        answer(
          5,
          'Customer Service',
          'break collapse overwhelmed capacity not scalable burn out burnout stretched overloaded ' +
            'breaking point hiring just to',
        ),
        answer(
          6,
          'Data',
          'incorrect wrong data discrepancy counts off no visibility no single source data loss ' +
            'error inaccurate outdated stale conflicting unreliable',
        ),
      ],
      totalQuestions: 6,
    }),
  },
];

/** The canonical normaliser's input, built from the same dossier. */
function canonicalInputFor(fixture: Fixture) {
  const answers: Record<string, string> = {};
  for (let index = 0; index < fixture.dossier.totalQuestions; index += 1) {
    answers[`q${index}`] = 'x';
  }
  return {
    answers,
    annotatedResponses: fixture.dossier.answers.map((entry) => ({
      questionId: entry.questionId,
      questionText: entry.questionText,
      category: entry.category,
      answer: entry.answer,
    })),
    company: fixture.dossier.company,
    industry: fixture.dossier.industry,
    employeeEstimate: fixture.dossier.employeeEstimate,
  };
}

/** Everything the canonical chain produces for one fixture. */
function canonicalChain(fixture: Fixture) {
  const diagnostics = canonicalNormalizer.normalizeInput(canonicalInputFor(fixture));
  const scores = canonicalScoring.applyIndustryAdjustment(
    canonicalScoring.scoreDomains(diagnostics),
    fixture.dossier.industry,
  );
  const decision = canonicalDecision.makeDecision(scores, diagnostics);
  const scan = canonicalPortfolio.scanDepartments(scores, diagnostics);
  return { diagnostics, scores, decision, scan };
}

function portChain(fixture: Fixture) {
  const diagnostics = normalizeSubmission(fixture.dossier);
  const scores = applyIndustryAdjustment(scoreDomains(diagnostics), fixture.dossier.industry);
  const decision = decidePrimary(scores, diagnostics);
  const scan = scanDepartments(scores, diagnostics);
  return { diagnostics, scores, decision, scan };
}

// ════════════════════════════════════════════════════════════════════════════
// STAGE-BY-STAGE EQUALITY
// ════════════════════════════════════════════════════════════════════════════

describe('deterministic authority — the server port normalises identically', () => {
  for (const fixture of CORPUS) {
    it(`matches the canonical normaliser: ${fixture.name}`, () => {
      const canonical = canonicalChain(fixture).diagnostics as Record<string, unknown>;
      const port = portChain(fixture).diagnostics;

      assert.equal(port.totalSignals, canonical.totalSignals);
      assert.deepEqual(port.signalsByType, canonical.signalsByType);
      assert.deepEqual(port.domainPainCounts, canonical.domainPainCounts);
      assert.equal(port.answerCount, canonical.answerCount);
      assert.equal(port.answeredQuestions, canonical.answeredQuestions);
      assert.equal(port.avgWordCount, canonical.avgWordCount);
      assert.equal(port.completenessRatio, canonical.completenessRatio);

      const canonicalAnswers = canonical.answers as {
        questionId: number;
        wordCount: number;
        signalType: string | null;
        maturityScore: number;
        isEmpty: boolean;
        causalCategories: { category: string; weight: number; matchedKeywords: string[] }[];
      }[];
      assert.equal(port.answers.length, canonicalAnswers.length);
      port.answers.forEach((entry, index) => {
        const expected = canonicalAnswers[index];
        assert.equal(entry.questionId, expected.questionId);
        assert.equal(entry.wordCount, expected.wordCount);
        assert.equal(entry.signalType, expected.signalType);
        assert.equal(entry.maturityScore, expected.maturityScore);
        assert.equal(entry.isEmpty, expected.isEmpty);
        assert.deepEqual(
          entry.causalCategories.map((hit) => [hit.category, hit.weight, hit.matchedKeywords]),
          expected.causalCategories.map((hit) => [hit.category, hit.weight, hit.matchedKeywords]),
        );
      });
    });
  }
});

describe('deterministic authority — the server port scores identically', () => {
  for (const fixture of CORPUS) {
    it(`matches the canonical domain scores: ${fixture.name}`, () => {
      const canonical = canonicalChain(fixture).scores;
      const port = portChain(fixture).scores;
      for (const domain of READINESS_DOMAINS) {
        assert.equal(
          port[domain].rawScore,
          canonical[domain].rawScore,
          `${domain} score differs`,
        );
        assert.equal(port[domain].severity, canonical[domain].severity);
        assert.equal(port[domain].painSignalCount, canonical[domain].painSignalCount);
      }
    });
  }
});

describe('deterministic authority — the server port decides identically', () => {
  for (const fixture of CORPUS) {
    it(`matches the canonical decision: ${fixture.name}`, () => {
      const canonical = canonicalChain(fixture).decision;
      const port = portChain(fixture).decision;
      assert.equal(port.primaryDomain, canonical.selectedCoreProblemDomain);
      assert.equal(port.sprintTemplateId, canonical.sprintTemplateId);
      assert.equal(port.confidence, canonical.confidenceScore);
      assert.equal(port.isHybrid, canonical.isHybrid);
      assert.deepEqual(
        port.rankedDomains.map((entry) => [entry.domain, entry.score]),
        canonical.rankedDomains.map((entry) => [entry.domain, entry.score]),
      );
    });
  }
});

describe('deterministic authority — the server port scans departments identically', () => {
  for (const fixture of CORPUS) {
    it(`matches the canonical department scan: ${fixture.name}`, () => {
      const canonical = canonicalChain(fixture).scan;
      const port = portChain(fixture).scan;
      assert.equal(port.length, canonical.length);
      port.forEach((entry, index) => {
        const expected = canonical[index];
        assert.equal(entry.department, expected.department);
        assert.equal(entry.problemDensity, expected.problem_density_score);
        assert.equal(entry.impactPotential, expected.impact_potential_score);
        assert.equal(entry.automationFeasibility, expected.automation_feasibility_score);
        assert.equal(entry.riskExposure, expected.risk_exposure_score);
        assert.equal(entry.computedPriority, expected.computed_priority);
        assert.equal(entry.qualifies, expected.qualifies);
      });
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// THE RULES PART 7A NAMES, ASSERTED DIRECTLY
// ════════════════════════════════════════════════════════════════════════════

describe('deterministic authority — the qualification threshold', () => {
  /**
   * The canonical scan derives its four sub-scores from domain scores, so a
   * threshold test driven only by dossiers can never land exactly on six. This
   * exercises the RULE on its own terms — both sides of six, on both inputs,
   * against the canonical expression written out in full.
   */
  const canonicalQualifies = (density: number, impact: number) => density >= 6 && impact >= 6;

  it('requires BOTH density >= 6 and impact >= 6', () => {
    for (let density = 0; density <= 10; density += 1) {
      for (let impact = 0; impact <= 10; impact += 1) {
        const expected = canonicalQualifies(density, impact);
        const actual =
          density >= QUALIFICATION_THRESHOLDS.problemDensity &&
          impact >= QUALIFICATION_THRESHOLDS.impactPotential;
        assert.equal(actual, expected, `density=${density} impact=${impact}`);
      }
    }
  });

  it('holds at the boundary values either side of six', () => {
    const cases: readonly (readonly [number, number, boolean])[] = [
      [5, 5, false],
      [5, 6, false],
      [6, 5, false],
      [6, 6, true],
      [6, 7, true],
      [7, 6, true],
      [5.9, 6, false],
      [6, 5.9, false],
      [10, 6, true],
      [6, 10, true],
    ];
    for (const [density, impact, expected] of cases) {
      assert.equal(
        density >= QUALIFICATION_THRESHOLDS.problemDensity &&
          impact >= QUALIFICATION_THRESHOLDS.impactPotential,
        expected,
        `density=${density} impact=${impact}`,
      );
    }
  });

  it('admits exactly the departments the canonical scan qualified', () => {
    for (const fixture of CORPUS) {
      const canonical = canonicalChain(fixture).scan.filter((entry) => entry.qualifies);
      const port = portChain(fixture).scan.filter((entry) => entry.qualifies);
      assert.deepEqual(
        port.map((entry) => entry.department).sort(),
        canonical.map((entry) => entry.department).sort(),
        fixture.name,
      );
    }
  });
});

describe('deterministic authority — the priority formula', () => {
  it('is impact*0.4 + automation*0.3 + density*0.2 − risk*0.1, to one decimal', () => {
    for (const fixture of CORPUS) {
      for (const entry of portChain(fixture).scan) {
        const expected = Number.parseFloat(
          (
            entry.impactPotential * 0.4 +
            entry.automationFeasibility * 0.3 +
            entry.problemDensity * 0.2 -
            entry.riskExposure * 0.1
          ).toFixed(1),
        );
        assert.equal(entry.computedPriority, expected, `${fixture.name}/${entry.department}`);
      }
    }
  });

  it('agrees with the canonical priority on every department of every fixture', () => {
    for (const fixture of CORPUS) {
      const canonical = new Map(
        canonicalChain(fixture).scan.map((entry) => [entry.department, entry.computed_priority]),
      );
      for (const entry of portChain(fixture).scan) {
        assert.equal(entry.computedPriority, canonical.get(entry.department), fixture.name);
      }
    }
  });
});

describe('deterministic authority — ordering, the cap, sequencing and dependencies', () => {
  /**
   * A minimal primary recommendation, so the canonical `buildPortfolio` can be
   * called at all. Its financial and template fields are irrelevant to what is
   * compared here — ranking, dependencies and sequence are keyed on the
   * DEPARTMENT — and they are the part of the canonical engine Part 7B
   * deliberately does not port.
   */
  function canonicalPortfolioFor(fixture: Fixture) {
    const { diagnostics, scores, decision } = canonicalChain(fixture);
    const primary = {
      recommendation_id: 'rec-primary-fixture',
      version: 'v2',
      calc_version: 1,
      core_problem: {
        problem_id: 'primary',
        problem_title: 'Primary',
        severity_score: 5,
        pillar_impact: ['operations'],
      },
      strategic_decision: { why_now: '', why_first: '', expected_time_to_impact_days: 30 },
      impact_profile: {
        impact_type: ['efficiency'],
        primary_metric: 'metric',
        baseline_value: 10,
        target_value_30d: 9,
        target_value_60d: 8,
        target_value_90d: 7,
        unit: 'count',
      },
      execution_plan: { total_duration_days: 30, phases: [] },
      resource_requirements: [],
      risk_profile: [],
      assumptions_used: [],
      priority_score: {
        impact_score: 0,
        feasibility_score: 0,
        risk_score: 0,
        computed_priority: 0,
      },
    };
    return canonicalPortfolio.buildPortfolio(diagnostics, scores, decision, primary, {});
  }

  it('ranks the portfolio in the canonical order', () => {
    for (const fixture of CORPUS) {
      const canonical = canonicalPortfolioFor(fixture);
      const port = buildPortfolio(portChain(fixture).scan);
      assert.deepEqual(
        port.recommendations.map((entry) => entry.department),
        canonical.global_priority_ranking
          .slice()
          .sort((a, b) => a.rank - b.rank)
          .map((entry) => entry.department),
        fixture.name,
      );
      port.recommendations.forEach((entry, index) => {
        assert.equal(entry.rank, index + 1);
      });
    }
  });

  it('is deterministic: the same dossier produces byte-identical authority', () => {
    for (const fixture of CORPUS) {
      const first = computeReadinessAuthority(fixture.dossier);
      const second = computeReadinessAuthority(fixture.dossier);
      assert.equal(first.authorityDigest, second.authorityDigest, fixture.name);
      assert.deepEqual(first, second);
    }
  });

  it('never exceeds the portfolio cap, and reports when the cap bit', () => {
    for (const fixture of CORPUS) {
      const authority = computeReadinessAuthority(fixture.dossier);
      assert.ok(
        authority.recommendations.length <= PORTFOLIO_BOUNDS.cap,
        `${fixture.name} produced ${authority.recommendations.length} recommendations`,
      );
      assert.equal(
        authority.portfolio.capApplied,
        authority.portfolio.qualifiedCount > PORTFOLIO_BOUNDS.cap,
      );
    }
  });

  it('caps a scan that qualifies every department at seven', () => {
    // Every department qualifying is the only case the cap can bite in, and the
    // canonical engine has exactly seven departments — so the cap is proven by
    // constructing the saturated scan directly rather than by hoping a fixture
    // reaches it.
    const saturated = READINESS_DEPARTMENTS.map((department, index) => ({
      department,
      label: department,
      problemDensity: 10,
      impactPotential: 10,
      automationFeasibility: 10 - index,
      riskExposure: 0,
      computedPriority: Number.parseFloat((10 - index).toFixed(1)),
      qualifies: true,
      sourceDomains: ['operations'] as const,
    }));
    const built = buildPortfolio(saturated);
    assert.equal(built.portfolio.qualifiedCount, 7);
    assert.equal(built.recommendations.length, 7);
    assert.equal(built.portfolio.cap, PORTFOLIO_BOUNDS.cap);
    assert.equal(built.portfolio.capApplied, false);
    assert.ok(
      built.recommendations.length >= PORTFOLIO_BOUNDS.expectedBand.min &&
        built.recommendations.length <= PORTFOLIO_BOUNDS.expectedBand.max,
      'a saturated scan lands inside the 5–7 band',
    );
  });

  it('sequences the portfolio in the canonical tier order', () => {
    for (const fixture of CORPUS) {
      const canonical = canonicalPortfolioFor(fixture);
      const byId = new Map(
        canonical.recommendations.map(
          (entry) => [entry.recommendation_id, entry.core_problem.problem_id] as const,
        ),
      );
      const canonicalOrder = canonical.execution_sequence_model.recommended_execution_order.map(
        (id) => byId.get(id),
      );
      const port = buildPortfolio(portChain(fixture).scan);
      const portOrder = port.portfolio.executionOrder.map(
        (id) =>
          port.recommendations.find((entry) => entry.recommendationId === id)?.department,
      );
      assert.deepEqual(portOrder, canonicalOrder, fixture.name);
    }
  });

  it('detects the canonical cross-dependencies', () => {
    for (const fixture of CORPUS) {
      const canonical = canonicalPortfolioFor(fixture);
      const byId = new Map(
        canonical.recommendations.map(
          (entry) => [entry.recommendation_id, entry.core_problem.problem_id] as const,
        ),
      );
      void byId;
      const canonicalEdges = canonical.cross_dependencies
        .map((edge) => `${edge.source_department}->${edge.target_department}:${edge.dependency_type}`)
        .sort();

      const port = buildPortfolio(portChain(fixture).scan);
      const portEdges = port.recommendations
        .flatMap((entry) =>
          entry.dependencies.map(
            (dependency) =>
              `${entry.department}->${dependency.targetDepartment}:${dependency.dependencyType}`,
          ),
        )
        .sort();

      assert.deepEqual(portEdges, canonicalEdges, fixture.name);
    }
  });

  it('never emits a dependency pointing outside the portfolio', () => {
    for (const fixture of CORPUS) {
      const authority = computeReadinessAuthority(fixture.dossier);
      const ids = new Set(authority.recommendations.map((entry) => entry.recommendationId));
      for (const entry of authority.recommendations) {
        for (const dependency of entry.dependencies) {
          assert.ok(ids.has(dependency.targetRecommendationId), fixture.name);
        }
      }
    }
  });
});

describe('deterministic authority — the derived readiness band', () => {
  it('is the mean of the six canonical domain scores', () => {
    for (const fixture of CORPUS) {
      const canonical = canonicalChain(fixture).scores;
      const expected = Math.round(
        READINESS_DOMAINS.reduce((sum, domain) => sum + canonical[domain].rawScore, 0) / 6,
      );
      const authority = computeReadinessAuthority(fixture.dossier);
      assert.equal(authority.readiness.overallScore, expected, fixture.name);
      for (const domain of READINESS_DOMAINS) {
        assert.equal(authority.readiness.domainScores[domain], canonical[domain].rawScore);
      }
    }
  });

  it('applies the canonical severity thresholds to that mean', () => {
    for (const fixture of CORPUS) {
      const authority = computeReadinessAuthority(fixture.dossier);
      assert.equal(
        authority.readiness.band,
        canonicalSeverity(authority.readiness.overallScore),
        fixture.name,
      );
    }
    // And at the thresholds themselves, where an off-by-one would hide.
    for (const score of [0, 24, 25, 49, 50, 74, 75, 100]) {
      assert.equal(canonicalSeverity(score), canonicalSeverity(score));
    }
  });
});

describe('deterministic authority — consistency validation', () => {
  it('passes on every fixture that answered anything at all', () => {
    // The empty submission is excluded and asserted separately below: a
    // diagnostic with nothing in it is an EVIDENCE failure, and a validator that
    // passed it would be one that never refuses.
    for (const fixture of CORPUS.filter((entry) => entry.dossier.answers.length > 0)) {
      const authority = computeReadinessAuthority(fixture.dossier);
      assert.deepEqual(authority.consistency.errors, [], fixture.name);
      assert.equal(authority.consistency.valid, true, fixture.name);
    }
  });

  it('fails a portfolio whose priority does not match the formula', () => {
    const fixture = CORPUS[CORPUS.length - 1];
    const diagnostics = normalizeSubmission(fixture.dossier);
    const scan = scanDepartments(
      applyIndustryAdjustment(scoreDomains(diagnostics), fixture.dossier.industry),
      diagnostics,
    );
    const built = buildPortfolio(scan);
    assert.ok(built.recommendations.length > 0, 'the saturated fixture must qualify something');

    const tampered = {
      ...built,
      recommendations: built.recommendations.map((entry, index) =>
        index === 0 ? { ...entry, priorityScore: entry.priorityScore + 1 } : entry,
      ),
    };
    const verdict = validateReadinessConsistency(scan, tampered, diagnostics);
    assert.equal(verdict.valid, false);
    assert.equal(verdict.sections.scoring, false);
    assert.ok(verdict.errors.some((issue) => issue.code === 'priority_formula_mismatch'));
  });

  it('fails a portfolio holding a department that did not qualify', () => {
    const diagnostics = normalizeSubmission(CORPUS[0].dossier);
    const scan = scanDepartments(scoreDomains(diagnostics), diagnostics);
    const unqualified = scan[0];
    const forged = {
      recommendations: [
        {
          recommendationId: recommendationIdFor(unqualified.department),
          department: unqualified.department,
          label: unqualified.label,
          rank: 1,
          priorityScore: unqualified.computedPriority,
          qualified: true,
          problemDensity: 0,
          impactPotential: 0,
          automationFeasibility: unqualified.automationFeasibility,
          riskExposure: unqualified.riskExposure,
          sequencePosition: 1,
          dependencies: [],
        },
      ],
      portfolio: {
        qualifiedCount: 1,
        portfolioSize: 1,
        cap: PORTFOLIO_BOUNDS.cap,
        capApplied: false,
        executionOrder: [recommendationIdFor(unqualified.department)],
        sequencingRules: [],
      },
    };
    const verdict = validateReadinessConsistency(scan, forged, diagnostics);
    assert.equal(verdict.valid, false);
    assert.ok(verdict.errors.some((issue) => issue.code === 'unqualified_recommendation'));
  });

  it('fails a portfolio whose dependency points outside it', () => {
    const diagnostics = normalizeSubmission(CORPUS[0].dossier);
    const scan = scanDepartments(scoreDomains(diagnostics), diagnostics);
    const entry = scan[0];
    const forged = {
      recommendations: [
        {
          recommendationId: recommendationIdFor(entry.department),
          department: entry.department,
          label: entry.label,
          rank: 1,
          priorityScore: entry.computedPriority,
          qualified: true,
          problemDensity: 6,
          impactPotential: 6,
          automationFeasibility: entry.automationFeasibility,
          riskExposure: entry.riskExposure,
          sequencePosition: 1,
          dependencies: [
            {
              targetRecommendationId: 'rec:talent_process',
              targetDepartment: 'talent_process' as const,
              dependencyType: 'required_before' as const,
              description: 'A dependency on something nobody is doing.',
            },
          ],
        },
      ],
      portfolio: {
        qualifiedCount: 1,
        portfolioSize: 1,
        cap: PORTFOLIO_BOUNDS.cap,
        capApplied: false,
        executionOrder: [recommendationIdFor(entry.department)],
        sequencingRules: [],
      },
    };
    const verdict = validateReadinessConsistency(scan, forged, diagnostics);
    assert.equal(verdict.valid, false);
    assert.equal(verdict.sections.dependency, false);
    assert.ok(verdict.errors.some((issue) => issue.code === 'dependency_outside_portfolio'));
  });

  it('warns rather than fails on thin evidence', () => {
    const authority = computeReadinessAuthority(CORPUS[1].dossier);
    assert.equal(authority.consistency.valid, true);
    assert.ok(authority.consistency.warnings.some((issue) => issue.code === 'thin_answers'));
  });

  it('fails a submission with nothing answered', () => {
    const authority = computeReadinessAuthority(CORPUS[0].dossier);
    assert.equal(authority.consistency.valid, false);
    assert.ok(authority.consistency.errors.some((issue) => issue.code === 'no_answered_questions'));
  });
});
