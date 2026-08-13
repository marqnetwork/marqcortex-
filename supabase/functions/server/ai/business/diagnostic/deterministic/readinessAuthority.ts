/**
 * The server-side deterministic readiness authority (Part 7B, Phase 1).
 *
 * ONE FUNCTION, FIVE STAGES, NO MODEL ANYWHERE NEAR IT:
 *
 *   inputNormalizer   → normalizeSubmission
 *   scoringEngine     → scoreDomains + applyIndustryAdjustment
 *   decisionEngine    → decidePrimary
 *   portfolioEngine   → scanDepartments + buildPortfolio
 *   consistency       → validateReadinessConsistency
 *
 * Every stage is a pure function of its input. There is no clock, no random
 * source, no store, no network and no injected dependency of any kind, so the
 * same dossier always produces the same authority — which is what makes the
 * digest at the end of it a meaningful thing to freeze an approval against.
 *
 * ── THE TWO PLACES THIS PORT IS DELIBERATELY NOT A COPY ────────────────────
 *
 * IDENTIFIERS. The canonical `buildPortfolio` mints `rec-<dept>-<Date.now()>`
 * and `ptf-<Date.now()>-<Math.random()>`. Reproducing that would make an
 * authoritative value change when nothing changed, and the fact lock's job is
 * to restore authoritative values — it cannot restore a value that is different
 * every time it is computed. Ids here are `rec:<department>`, derived from the
 * one identity the canonical ranking, sequencing and dependency logic actually
 * keys on.
 *
 * ORDERING. The canonical engine sorts by priority and relies on
 * `Array.prototype.sort` being stable over `ALL_DEPARTMENTS` order to break
 * ties. This port sorts by priority and then by canonical department index
 * explicitly. Same result on every input; the difference is that the result no
 * longer depends on a property of the runtime's sort.
 *
 * ── AND THE CONSISTENCY STAGE IS ABOUT THIS RESULT ─────────────────────────
 *
 * `src/app/core/consistencyValidator.ts` validates PROPOSAL BLOCKS — diagnosis
 * counts, investment totals, guarantee language. It is a different subject and
 * it is not what a readiness review needs checked. The validator here has the
 * canonical one's SHAPE (sections, errors, warnings, one boolean) and the
 * readiness result's subject: that the portfolio matches the scan that produced
 * it, that every priority is the formula recomputed, that every dependency
 * points inside the portfolio, and that the evidence behind it is sufficient.
 */

import { digestValue } from '../../../agents/runtime/digest.ts';
import type {
  DiagnosticAnswer,
  DiagnosticSubmissionDossier,
} from '../contracts/dossier.ts';
import type {
  ReadinessAuthority,
  ReadinessConsistency,
  ReadinessConsistencyIssue,
  ReadinessDecision,
  ReadinessDependency,
  ReadinessDepartment,
  ReadinessDomain,
  ReadinessDomainScore,
  ReadinessPortfolio,
  ReadinessRecommendation,
  ReadinessSnapshot,
} from '../contracts/readiness.ts';
import {
  PORTFOLIO_BOUNDS,
  PRIORITY_WEIGHTS,
  QUALIFICATION_THRESHOLDS,
  READINESS_DEPARTMENTS,
  READINESS_DOMAINS,
} from '../contracts/readiness.ts';
import type { CausalCategory, SignalType } from './canonicalRules.ts';
import {
  CAUSAL_CATEGORIES,
  CAUSAL_KEYWORDS,
  CAUSAL_TO_DOMAIN,
  CORE_PROBLEM_LABELS,
  DEPARTMENT_LABELS,
  DEPARTMENT_SOURCE_DOMAINS,
  DEPENDENCY_MAP,
  DOMAIN_LABELS,
  DOMAIN_SENSITIVITY,
  DOMAIN_TO_SPRINT,
  INDUSTRY_ADJUSTMENTS,
  OPPORTUNITY_WORDS,
  POSITIVE_MATURITY_KEYWORDS,
  RISK_CATEGORIES,
  SEQUENCING_TIERS,
  STRENGTH_WORDS,
  scoreSeverity,
} from './canonicalRules.ts';

export const READINESS_ENGINE_VERSION = '1.0.0';

// ── Stage 1: input normalizer ───────────────────────────────────────────────

export interface CausalHit {
  readonly category: CausalCategory;
  readonly weight: number;
  readonly matchedKeywords: readonly string[];
}

export interface NormalizedAnswer {
  readonly questionId: number;
  readonly questionText: string;
  readonly category: string;
  readonly answer: string;
  readonly wordCount: number;
  readonly causalCategories: readonly CausalHit[];
  readonly signalType: SignalType | null;
  readonly maturityScore: number;
  readonly isEmpty: boolean;
}

export interface NormalizedSubmission {
  readonly company: string;
  readonly industry: string;
  readonly employeeEstimate: number;
  readonly answers: readonly NormalizedAnswer[];
  readonly totalSignals: number;
  readonly signalsByType: Readonly<Record<SignalType, number>>;
  readonly domainPainCounts: Readonly<Record<ReadinessDomain, number>>;
  readonly answerCount: number;
  readonly answeredQuestions: number;
  readonly avgWordCount: number;
  readonly completenessRatio: number;
}

function classifyAnswerCausal(answerText: string): CausalHit[] {
  const lower = answerText.toLowerCase();
  const hits: CausalHit[] = [];
  for (const category of CAUSAL_CATEGORIES) {
    const matched = CAUSAL_KEYWORDS[category].filter((keyword) => lower.includes(keyword));
    if (matched.length > 0) {
      hits.push({ category, weight: matched.length, matchedKeywords: matched });
    }
  }
  return hits;
}

function estimateMaturity(answer: string, causalHits: readonly CausalHit[]): number {
  const lower = answer.toLowerCase();
  const wordCount = answer.split(/\s+/).filter(Boolean).length;
  const totalWeight = causalHits.reduce((sum, hit) => sum + hit.weight, 0);

  if (totalWeight >= 5) return 1;
  if (totalWeight >= 3) return 2;

  const positiveHits = POSITIVE_MATURITY_KEYWORDS.filter((keyword) =>
    lower.includes(keyword),
  ).length;
  if (positiveHits >= 3) return 5;
  if (positiveHits >= 2) return 4;
  if (positiveHits >= 1) return 3;

  if (wordCount < 10) return 2;
  return 3;
}

function classifyPrimarySignal(
  causalHits: readonly CausalHit[],
  answer: string,
): SignalType | null {
  if (causalHits.length === 0) return null;
  const lower = answer.toLowerCase();
  if (OPPORTUNITY_WORDS.some((word) => lower.includes(word))) return 'opportunity';
  if (STRENGTH_WORDS.some((word) => lower.includes(word))) return 'strength';
  const isRisk = causalHits.some((hit) => RISK_CATEGORIES.includes(hit.category));
  return isRisk ? 'risk' : 'pain';
}

/** `inputNormalizer.normalizeInput`, over a dossier instead of a form payload. */
export function normalizeSubmission(dossier: DiagnosticSubmissionDossier): NormalizedSubmission {
  const normalizedAnswers: NormalizedAnswer[] = [];
  let totalWordCount = 0;
  let answeredCount = 0;

  for (const response of dossier.answers as readonly DiagnosticAnswer[]) {
    const answerText = String(response.answer ?? '');
    const isEmpty = answerText.trim().length < 5;
    const wordCount = isEmpty ? 0 : answerText.split(/\s+/).filter(Boolean).length;
    const causalCategories = classifyAnswerCausal(answerText);
    const signalType = isEmpty ? null : classifyPrimarySignal(causalCategories, answerText);
    const maturityScore = isEmpty ? 1 : estimateMaturity(answerText, causalCategories);

    normalizedAnswers.push({
      questionId: response.questionId,
      questionText: response.questionText,
      category: response.category,
      answer: answerText,
      wordCount,
      causalCategories,
      signalType,
      maturityScore,
      isEmpty,
    });

    totalWordCount += wordCount;
    if (!isEmpty) answeredCount += 1;
  }

  const signalsByType: Record<SignalType, number> = {
    pain: 0,
    opportunity: 0,
    risk: 0,
    strength: 0,
  };
  let totalSignals = 0;
  for (const answer of normalizedAnswers) {
    if (answer.signalType) {
      signalsByType[answer.signalType] += 1;
      totalSignals += 1;
    }
  }

  const domainPainCounts: Record<ReadinessDomain, number> = {
    operations: 0,
    revenue: 0,
    systems: 0,
    governance: 0,
    customer_experience: 0,
    data: 0,
  };

  for (const answer of normalizedAnswers) {
    for (const hit of answer.causalCategories) {
      const domain = CAUSAL_TO_DOMAIN[hit.category];
      if (domain) domainPainCounts[domain] += hit.weight;
    }
    const categoryLower = answer.category.toLowerCase();
    if (
      categoryLower.includes('customer') ||
      categoryLower.includes('support') ||
      categoryLower.includes('service')
    ) {
      if (answer.signalType === 'pain' || answer.signalType === 'risk') {
        domainPainCounts.customer_experience += 2;
      }
    }
  }

  // The canonical expression is `Object.keys(answers).length || annotated.length || 14`.
  // A dossier states the question count directly; the two fallbacks are kept in
  // the same order so a dossier that omits it behaves identically.
  const totalQuestions = dossier.totalQuestions || dossier.answers.length || 14;

  return {
    company: dossier.company,
    industry: dossier.industry,
    employeeEstimate: dossier.employeeEstimate,
    answers: normalizedAnswers,
    totalSignals,
    signalsByType,
    domainPainCounts,
    answerCount: totalQuestions,
    answeredQuestions: answeredCount,
    avgWordCount: answeredCount > 0 ? Math.round(totalWordCount / answeredCount) : 0,
    completenessRatio: Math.min(1, answeredCount / Math.max(1, totalQuestions)),
  };
}

// ── Stage 2: scoring engine ─────────────────────────────────────────────────

export interface DomainScoreDetail {
  readonly domain: ReadinessDomain;
  readonly label: string;
  readonly rawScore: number;
  readonly severity: ReadinessDomainScore['severity'];
  readonly painSignalCount: number;
  readonly topCausalCategories: readonly CausalCategory[];
  readonly contributingQuestions: readonly number[];
}

export type DomainScores = Readonly<Record<ReadinessDomain, DomainScoreDetail>>;

/** `scoringEngine.scoreDomains`, verbatim in every arithmetic step. */
export function scoreDomains(diagnostics: NormalizedSubmission): DomainScores {
  const domainCausal: Record<
    ReadinessDomain,
    { totalWeight: number; questions: Set<number>; categories: Set<CausalCategory> }
  > = {
    operations: { totalWeight: 0, questions: new Set(), categories: new Set() },
    revenue: { totalWeight: 0, questions: new Set(), categories: new Set() },
    systems: { totalWeight: 0, questions: new Set(), categories: new Set() },
    governance: { totalWeight: 0, questions: new Set(), categories: new Set() },
    customer_experience: { totalWeight: 0, questions: new Set(), categories: new Set() },
    data: { totalWeight: 0, questions: new Set(), categories: new Set() },
  };

  for (const answer of diagnostics.answers) {
    for (const hit of answer.causalCategories) {
      const domain = CAUSAL_TO_DOMAIN[hit.category];
      if (domain) {
        domainCausal[domain].totalWeight += hit.weight;
        domainCausal[domain].questions.add(answer.questionId);
        domainCausal[domain].categories.add(hit.category);
      }
    }
  }

  const categoryToDepts = new Map<ReadinessDomain, Set<string>>();
  for (const domain of READINESS_DOMAINS) categoryToDepts.set(domain, new Set());
  for (const answer of diagnostics.answers) {
    for (const hit of answer.causalCategories) {
      const domain = CAUSAL_TO_DOMAIN[hit.category];
      if (domain) categoryToDepts.get(domain)?.add(answer.category);
    }
  }

  const result: Partial<Record<ReadinessDomain, DomainScoreDetail>> = {};
  for (const domain of READINESS_DOMAINS) {
    const painCount = diagnostics.domainPainCounts[domain] || 0;
    const causalWeight = domainCausal[domain].totalWeight;
    const depts = categoryToDepts.get(domain) ?? new Set<string>();
    const sensitivity = DOMAIN_SENSITIVITY[domain];

    const painComponent = Math.min(100, (painCount / 20) * 100) * 0.4;
    const causalComponent = Math.min(100, (causalWeight / 15) * 100) * 0.3;

    const relevantAnswers = diagnostics.answers.filter((answer) =>
      answer.causalCategories.some((hit) => CAUSAL_TO_DOMAIN[hit.category] === domain),
    );
    const avgMaturity =
      relevantAnswers.length > 0
        ? relevantAnswers.reduce((sum, answer) => sum + answer.maturityScore, 0) /
          relevantAnswers.length
        : 3;
    const maturityPenalty = Math.max(0, (5 - avgMaturity) / 4) * 100 * 0.2;
    const crossDeptBonus = depts.size >= 3 ? 100 * 0.1 : depts.size >= 2 ? 60 * 0.1 : 0;

    const rawScore = Math.min(
      100,
      Math.round((painComponent + causalComponent + maturityPenalty + crossDeptBonus) * sensitivity),
    );

    result[domain] = {
      domain,
      label: DOMAIN_LABELS[domain],
      rawScore,
      severity: scoreSeverity(rawScore),
      painSignalCount: painCount,
      topCausalCategories: [...domainCausal[domain].categories],
      contributingQuestions: [...domainCausal[domain].questions],
    };
  }

  return result as DomainScores;
}

/** `scoringEngine.applyIndustryAdjustment`, verbatim including the order. */
export function applyIndustryAdjustment(scores: DomainScores, industry: string): DomainScores {
  const lower = industry.toLowerCase();
  const adjusted: Record<ReadinessDomain, DomainScoreDetail> = { ...scores };

  for (const rule of INDUSTRY_ADJUSTMENTS) {
    if (!rule.match.some((token) => lower.includes(token))) continue;
    for (const [domain, multiplier] of rule.bumps) {
      const current = adjusted[domain];
      const raw = Math.min(100, Math.round(current.rawScore * multiplier));
      adjusted[domain] = { ...current, rawScore: raw, severity: scoreSeverity(raw) };
    }
  }

  return adjusted;
}

// ── Stage 3: decision engine ────────────────────────────────────────────────

/** `decisionEngine.makeDecision`, reduced to the fields a review reports. */
export function decidePrimary(
  scores: DomainScores,
  diagnostics: NormalizedSubmission,
): ReadinessDecision {
  const ranked = READINESS_DOMAINS.map((domain) => ({
    domain,
    score: scores[domain].rawScore,
  }))
    // Priority descending; canonical domain order breaks a tie. The canonical
    // engine gets the same order from a stable sort over `Object.values`.
    .sort(
      (a, b) =>
        b.score - a.score ||
        READINESS_DOMAINS.indexOf(a.domain) - READINESS_DOMAINS.indexOf(b.domain),
    );

  const top = ranked[0];
  const second = ranked[1];
  const gap = top.score - (second?.score ?? 0);
  const gapPercent = top.score > 0 ? (gap / top.score) * 100 : 100;
  const isHybrid = gapPercent < 10 && top.score > 0;

  const completeness = diagnostics.completenessRatio;
  const qualityRatio = Math.min(1, diagnostics.avgWordCount / 60);
  const gapClarity = top.score > 0 ? Math.min(1, gap / 30) : 0;
  const signalDensity = Math.min(1, diagnostics.totalSignals / 12);
  const raw =
    completeness * 0.3 + qualityRatio * 0.2 + gapClarity * 0.3 + signalDensity * 0.2;
  const confidence = Math.max(0.3, Math.min(0.98, Number.parseFloat(raw.toFixed(2))));

  return {
    primaryDomain: top.domain,
    primaryProblem: CORE_PROBLEM_LABELS[top.domain],
    sprintTemplateId: DOMAIN_TO_SPRINT[top.domain],
    confidence,
    isHybrid,
    rankedDomains: ranked,
  };
}

// ── Stage 4: portfolio engine ───────────────────────────────────────────────

export interface DepartmentScan {
  readonly department: ReadinessDepartment;
  readonly label: string;
  readonly problemDensity: number;
  readonly impactPotential: number;
  readonly automationFeasibility: number;
  readonly riskExposure: number;
  readonly computedPriority: number;
  readonly qualifies: boolean;
  readonly sourceDomains: readonly ReadinessDomain[];
}

/**
 * `portfolioEngine.scanDepartments`, verbatim.
 *
 * The two rules Part 7A names explicitly both live here:
 *
 *   QUALIFICATION  density >= 6 AND impact >= 6. Both, not either.
 *   PRIORITY       impact*0.4 + automation*0.3 + density*0.2 − risk*0.1,
 *                  fixed to one decimal, exactly as the canonical engine does.
 */
export function scanDepartments(
  scores: DomainScores,
  diagnostics: NormalizedSubmission,
): readonly DepartmentScan[] {
  const employees = diagnostics.employeeEstimate;

  return READINESS_DEPARTMENTS.map((department) => {
    const sourceDomains = DEPARTMENT_SOURCE_DOMAINS[department];
    const domainScores = sourceDomains.map((domain) => scores[domain].rawScore);
    const avgDomainScore =
      domainScores.reduce((sum, value) => sum + value, 0) / domainScores.length;
    const totalPain = sourceDomains.reduce(
      (sum, domain) => sum + scores[domain].painSignalCount,
      0,
    );

    const problemDensity = Math.max(
      0,
      Math.min(10, Math.round((avgDomainScore / 100) * 6 + Math.min(4, totalPain * 0.8))),
    );
    const impactPotential = Math.max(0, Math.min(10, Math.round(avgDomainScore / 10)));

    const baseFeasibility = employees > 200 ? 5 : employees > 50 ? 7 : 8;
    const domainBonus = sourceDomains.some((domain) =>
      ['operations', 'systems', 'data'].includes(domain),
    )
      ? 2
      : 0;
    const automationFeasibility = Math.max(0, Math.min(10, baseFeasibility + domainBonus));

    const riskBase = sourceDomains.some((domain) => domain === 'governance')
      ? 6
      : sourceDomains.some((domain) => domain === 'revenue' || domain === 'data')
        ? 5
        : 3;
    const complexityRisk = employees > 200 ? 2 : employees > 50 ? 1 : 0;
    const riskExposure = Math.max(0, Math.min(10, riskBase + complexityRisk));

    const computedPriority = Number.parseFloat(
      (
        impactPotential * PRIORITY_WEIGHTS.impactPotential +
        automationFeasibility * PRIORITY_WEIGHTS.automationFeasibility +
        problemDensity * PRIORITY_WEIGHTS.problemDensity +
        riskExposure * PRIORITY_WEIGHTS.riskExposure
      ).toFixed(1),
    );

    const qualifies =
      problemDensity >= QUALIFICATION_THRESHOLDS.problemDensity &&
      impactPotential >= QUALIFICATION_THRESHOLDS.impactPotential;

    return {
      department,
      label: DEPARTMENT_LABELS[department],
      problemDensity,
      impactPotential,
      automationFeasibility,
      riskExposure,
      computedPriority,
      qualifies,
      sourceDomains,
    };
  });
}

export function recommendationIdFor(department: ReadinessDepartment): string {
  return `rec:${department}`;
}

/** `portfolioEngine.buildCrossDependencies`, over the capped portfolio. */
function buildDependencies(
  departments: readonly ReadinessDepartment[],
): Readonly<Record<string, readonly ReadinessDependency[]>> {
  const present = new Set<ReadinessDepartment>(departments);
  const out: Record<string, ReadinessDependency[]> = {};

  for (const department of departments) {
    const links = DEPENDENCY_MAP[department] ?? [];
    out[recommendationIdFor(department)] = links
      .filter((link) => present.has(link.target))
      .map((link) => ({
        targetRecommendationId: recommendationIdFor(link.target),
        targetDepartment: link.target,
        dependencyType: link.type,
        description: link.description,
      }));
  }

  return out;
}

/** `portfolioEngine.buildExecutionSequence`, over the capped portfolio. */
function buildExecutionSequence(
  ordered: readonly DepartmentScan[],
): { order: readonly ReadinessDepartment[]; rules: readonly string[] } {
  const byDepartment = new Map<ReadinessDepartment, DepartmentScan>();
  for (const scan of ordered) byDepartment.set(scan.department, scan);

  const sequence: ReadinessDepartment[] = [];
  const used = new Set<ReadinessDepartment>();

  for (const tier of SEQUENCING_TIERS) {
    const tierScans = tier
      .map((department) => byDepartment.get(department))
      .filter((scan): scan is DepartmentScan => scan !== undefined && !used.has(scan.department))
      .sort(
        (a, b) =>
          b.computedPriority - a.computedPriority ||
          READINESS_DEPARTMENTS.indexOf(a.department) -
            READINESS_DEPARTMENTS.indexOf(b.department),
      );
    for (const scan of tierScans) {
      sequence.push(scan.department);
      used.add(scan.department);
    }
  }

  // Priority order for anything no tier claimed. The canonical engine has the
  // same fallback and the same comment about it not being reachable with seven
  // departments — kept because a tier list edited later must not silently drop
  // a recommendation from the sequence.
  for (const scan of ordered) {
    if (!used.has(scan.department)) sequence.push(scan.department);
  }

  const rules: string[] = [];
  const index = (department: ReadinessDepartment) => sequence.indexOf(department);
  const ops = index('operations_supply_chain');
  const revenue = index('revenue_engine');
  const data = index('data_infrastructure');
  const marketing = index('marketing_acquisition');
  const finance = index('finance_unit_economics');

  if (ops !== -1 && revenue !== -1 && ops < revenue) {
    rules.push('Fix operational bottlenecks before growth acceleration');
  }
  if (data !== -1 && marketing !== -1 && data < marketing) {
    rules.push('Stabilize data before advanced AI automation');
  }
  if (ops !== -1 && ops < 2) rules.push('Fix constraints before optimization');
  if (finance !== -1 && revenue !== -1 && finance < revenue) {
    rules.push('Reduce risk before scaling spend');
  }
  if (rules.length === 0) {
    rules.push('Priority-score ordering (no sequencing conflicts detected)');
  }

  return { order: sequence, rules };
}

export interface PortfolioResult {
  readonly recommendations: readonly ReadinessRecommendation[];
  readonly portfolio: ReadinessPortfolio;
}

/**
 * Qualification, ranking, the cap, sequencing and dependencies.
 *
 * THE CAP IS APPLIED BEFORE ANYTHING ELSE IS DERIVED. Ranking a department out
 * of the portfolio and then dropping it would leave a dependency pointing at a
 * recommendation nobody can act on; capping first means every id in every list
 * below names something in the portfolio.
 */
export function buildPortfolio(scan: readonly DepartmentScan[]): PortfolioResult {
  const qualifying = scan
    .filter((entry) => entry.qualifies)
    .sort(
      (a, b) =>
        b.computedPriority - a.computedPriority ||
        READINESS_DEPARTMENTS.indexOf(a.department) - READINESS_DEPARTMENTS.indexOf(b.department),
    );

  const capped = qualifying.slice(0, PORTFOLIO_BOUNDS.cap);
  const departments = capped.map((entry) => entry.department);
  const dependencies = buildDependencies(departments);
  const sequence = buildExecutionSequence(capped);

  const recommendations: readonly ReadinessRecommendation[] = capped.map((entry, index) => ({
    recommendationId: recommendationIdFor(entry.department),
    department: entry.department,
    label: entry.label,
    rank: index + 1,
    priorityScore: entry.computedPriority,
    qualified: true,
    problemDensity: entry.problemDensity,
    impactPotential: entry.impactPotential,
    automationFeasibility: entry.automationFeasibility,
    riskExposure: entry.riskExposure,
    sequencePosition: sequence.order.indexOf(entry.department) + 1,
    dependencies: dependencies[recommendationIdFor(entry.department)] ?? [],
  }));

  return {
    recommendations,
    portfolio: {
      qualifiedCount: qualifying.length,
      portfolioSize: recommendations.length,
      cap: PORTFOLIO_BOUNDS.cap,
      capApplied: qualifying.length > PORTFOLIO_BOUNDS.cap,
      executionOrder: sequence.order.map(recommendationIdFor),
      sequencingRules: sequence.rules,
    },
  };
}

// ── Stage 5: consistency validation ─────────────────────────────────────────

/**
 * Does this result hold together?
 *
 * Four sections, and each one answers a question a reviewer would otherwise
 * have to answer by hand. An ERROR means the result must not be relied on and
 * the review escalates; a WARNING means the result stands and the reviewer is
 * told what is thin about it.
 */
export function validateReadinessConsistency(
  scan: readonly DepartmentScan[],
  result: PortfolioResult,
  diagnostics: NormalizedSubmission,
): ReadinessConsistency {
  const errors: ReadinessConsistencyIssue[] = [];
  const warnings: ReadinessConsistencyIssue[] = [];
  const { recommendations, portfolio } = result;

  // ── Structural ──
  const ids = new Set(recommendations.map((entry) => entry.recommendationId));
  if (ids.size !== recommendations.length) {
    errors.push({
      section: 'structural',
      code: 'duplicate_recommendation_id',
      message: 'Two recommendations share an identifier.',
    });
  }
  if (recommendations.length > portfolio.cap) {
    errors.push({
      section: 'structural',
      code: 'portfolio_cap_exceeded',
      message: `The portfolio holds ${recommendations.length} recommendations, above the cap of ${portfolio.cap}.`,
    });
  }
  recommendations.forEach((entry, index) => {
    if (entry.rank !== index + 1) {
      errors.push({
        section: 'structural',
        code: 'rank_not_contiguous',
        message: `Recommendation ${entry.recommendationId} is ranked ${entry.rank} at position ${index + 1}.`,
      });
    }
  });
  if (portfolio.executionOrder.length !== recommendations.length) {
    errors.push({
      section: 'structural',
      code: 'sequence_incomplete',
      message: 'The execution sequence does not cover every recommendation.',
    });
  }
  for (const id of portfolio.executionOrder) {
    if (!ids.has(id)) {
      errors.push({
        section: 'structural',
        code: 'sequence_unknown_recommendation',
        message: `The execution sequence names ${id}, which is not in the portfolio.`,
      });
    }
  }

  // ── Scoring ──
  const scanByDepartment = new Map(scan.map((entry) => [entry.department, entry] as const));
  for (const entry of recommendations) {
    const source = scanByDepartment.get(entry.department);
    if (!source) {
      errors.push({
        section: 'scoring',
        code: 'recommendation_without_scan',
        message: `Recommendation ${entry.recommendationId} has no department scan behind it.`,
      });
      continue;
    }
    const recomputed = Number.parseFloat(
      (
        entry.impactPotential * PRIORITY_WEIGHTS.impactPotential +
        entry.automationFeasibility * PRIORITY_WEIGHTS.automationFeasibility +
        entry.problemDensity * PRIORITY_WEIGHTS.problemDensity +
        entry.riskExposure * PRIORITY_WEIGHTS.riskExposure
      ).toFixed(1),
    );
    if (recomputed !== entry.priorityScore) {
      errors.push({
        section: 'scoring',
        code: 'priority_formula_mismatch',
        message: `Recommendation ${entry.recommendationId} reports ${entry.priorityScore} where the formula gives ${recomputed}.`,
      });
    }
    if (
      entry.problemDensity < QUALIFICATION_THRESHOLDS.problemDensity ||
      entry.impactPotential < QUALIFICATION_THRESHOLDS.impactPotential
    ) {
      errors.push({
        section: 'scoring',
        code: 'unqualified_recommendation',
        message: `Recommendation ${entry.recommendationId} is below the qualification thresholds.`,
      });
    }
  }
  for (let index = 1; index < recommendations.length; index += 1) {
    if (recommendations[index - 1].priorityScore < recommendations[index].priorityScore) {
      errors.push({
        section: 'scoring',
        code: 'ranking_not_descending',
        message: 'The portfolio is not ordered by descending priority.',
      });
      break;
    }
  }

  // ── Dependency ──
  for (const entry of recommendations) {
    for (const dependency of entry.dependencies) {
      if (!ids.has(dependency.targetRecommendationId)) {
        errors.push({
          section: 'dependency',
          code: 'dependency_outside_portfolio',
          message: `Recommendation ${entry.recommendationId} depends on ${dependency.targetRecommendationId}, which is not in the portfolio.`,
        });
      }
      if (dependency.targetRecommendationId === entry.recommendationId) {
        errors.push({
          section: 'dependency',
          code: 'self_dependency',
          message: `Recommendation ${entry.recommendationId} depends on itself.`,
        });
      }
    }
  }
  const blocking = new Map<string, readonly string[]>(
    recommendations.map((entry) => [
      entry.recommendationId,
      entry.dependencies
        .filter((dependency) => dependency.dependencyType === 'required_before')
        .map((dependency) => dependency.targetRecommendationId),
    ]),
  );
  if (hasCycle(blocking)) {
    errors.push({
      section: 'dependency',
      code: 'dependency_cycle',
      message: 'The required_before dependencies form a cycle.',
    });
  }

  // ── Evidence ──
  if (diagnostics.answeredQuestions === 0) {
    errors.push({
      section: 'evidence',
      code: 'no_answered_questions',
      message: 'The submission carries no answered questions.',
    });
  }
  if (diagnostics.completenessRatio < 0.5 && diagnostics.answeredQuestions > 0) {
    warnings.push({
      section: 'evidence',
      code: 'low_completeness',
      message: `Only ${Math.round(diagnostics.completenessRatio * 100)}% of the diagnostic was answered.`,
    });
  }
  if (diagnostics.avgWordCount < 20 && diagnostics.answeredQuestions > 0) {
    warnings.push({
      section: 'evidence',
      code: 'thin_answers',
      message: `Answers average ${diagnostics.avgWordCount} words, which is thin evidence for a recommendation.`,
    });
  }
  if (recommendations.length === 0) {
    warnings.push({
      section: 'evidence',
      code: 'empty_portfolio',
      message: 'No department met both qualification thresholds.',
    });
  }

  const sectionFailed = (section: ReadinessConsistencyIssue['section']) =>
    errors.some((issue) => issue.section === section);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    sections: {
      structural: !sectionFailed('structural'),
      scoring: !sectionFailed('scoring'),
      dependency: !sectionFailed('dependency'),
      evidence: !sectionFailed('evidence'),
    },
  };
}

function hasCycle(edges: ReadonlyMap<string, readonly string[]>): boolean {
  const visiting = new Set<string>();
  const done = new Set<string>();

  const walk = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (done.has(node)) return false;
    visiting.add(node);
    for (const next of edges.get(node) ?? []) {
      if (walk(next)) return true;
    }
    visiting.delete(node);
    done.add(node);
    return false;
  };

  for (const node of edges.keys()) {
    if (walk(node)) return true;
  }
  return false;
}

// ── The chain ───────────────────────────────────────────────────────────────

/**
 * The whole deterministic authority, in one pure call.
 *
 * `organizationId` comes from the DOSSIER, which the store keyed by the run's
 * organization. Nothing here reads a payload, an environment variable or a
 * clock, so two calls with the same dossier are the same result and the same
 * digest — which is what an approval can be frozen against.
 */
export function computeReadinessAuthority(
  dossier: DiagnosticSubmissionDossier,
): ReadinessAuthority {
  const diagnostics = normalizeSubmission(dossier);
  const scores = applyIndustryAdjustment(scoreDomains(diagnostics), dossier.industry);
  const decision = decidePrimary(scores, diagnostics);
  const scan = scanDepartments(scores, diagnostics);
  const portfolio = buildPortfolio(scan);
  const consistency = validateReadinessConsistency(scan, portfolio, diagnostics);

  const domainScores = {
    operations: scores.operations.rawScore,
    revenue: scores.revenue.rawScore,
    systems: scores.systems.rawScore,
    governance: scores.governance.rawScore,
    customer_experience: scores.customer_experience.rawScore,
    data: scores.data.rawScore,
  } as const;

  const overallScore = Math.round(
    READINESS_DOMAINS.reduce((sum, domain) => sum + domainScores[domain], 0) /
      READINESS_DOMAINS.length,
  );

  const readiness: ReadinessSnapshot = {
    overallScore,
    band: scoreSeverity(overallScore),
    domainScores,
    domains: decision.rankedDomains.map((entry) => ({
      domain: entry.domain,
      label: DOMAIN_LABELS[entry.domain],
      score: entry.score,
      severity: scores[entry.domain].severity,
      painSignalCount: scores[entry.domain].painSignalCount,
    })),
    dataCompleteness: Number.parseFloat(diagnostics.completenessRatio.toFixed(4)),
    answeredQuestions: diagnostics.answeredQuestions,
    totalQuestions: diagnostics.answerCount,
    averageAnswerWords: diagnostics.avgWordCount,
    totalSignals: diagnostics.totalSignals,
  };

  const body = {
    engineVersion: READINESS_ENGINE_VERSION,
    submissionId: dossier.submissionId,
    organizationId: dossier.organizationId,
    readiness,
    recommendations: portfolio.recommendations,
    portfolio: portfolio.portfolio,
    decision,
    consistency,
  };

  return { ...body, authorityDigest: digestValue(body) };
}
