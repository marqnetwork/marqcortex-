/**
 * The authoritative readiness result (AI-01 Batch 3B, Part 7B, Phase 1 and 5).
 *
 * THIS TYPE IS THE AUTHORITY. Every field on it is produced by the server-side
 * deterministic chain in `deterministic/readinessAuthority.ts` and by nothing
 * else — no model, no agent, no tool input and no caller reaches a single one
 * of them. The fact lock in `agent/factLock.ts` restores every locked path on
 * this object after generation, unconditionally, so the narrative a model
 * writes can describe these numbers and can never become them.
 *
 * ── WHY THE LOCKED PATHS ARE DECLARED HERE ─────────────────────────────────
 *
 * Beside the type they protect, so a field added to the authority and left out
 * of the lock is a diff a reviewer sees in one file rather than two. Part 7A
 * names the minimum set; `AUTHORITATIVE_FIELDS` below is that set, and it is a
 * MINIMUM in the contract's own terms — the lock also removes any recommendation
 * the model invented, which is the case a path list alone cannot express.
 *
 * ── THE ONE NUMBER THAT IS NOT IN THE CANONICAL ENGINES ────────────────────
 *
 * `readiness.overallScore` and `readiness.band` do not exist in
 * `src/app/core/*`: the canonical chain scores six domains and never rolls them
 * into one figure. They are DERIVED here, from authoritative inputs only, by
 * two rules stated in full so nobody has to infer them:
 *
 *   overallScore  the arithmetic mean of the six canonical domain scores,
 *                 rounded half-up. Nothing else feeds it.
 *   band          the canonical severity thresholds — the same 75 / 50 / 25
 *                 cuts `scoringEngine.scoreSeverity` applies to a domain score —
 *                 applied to that mean.
 *
 * Deriving rather than inventing matters: a band computed from a new threshold
 * table would be a second opinion about severity, and the platform would then
 * have two. The equality suite asserts both rules against the canonical
 * severity function directly.
 */

import type { Validator } from '../../../security/validation.ts';
import { arrayOf, bool, int, literal, num, object, str } from '../../../security/validation.ts';

// ── The canonical vocabularies, restated for the server boundary ────────────

/**
 * The six scoring domains, in canonical order.
 *
 * Restated rather than imported: `src/app/core/types.ts` is browser-boundary
 * source and the edge runtime cannot reach it. The equality suite pins these
 * against the canonical module, so a divergence is a failing test rather than a
 * silent drift.
 */
export const READINESS_DOMAINS = [
  'operations',
  'revenue',
  'systems',
  'governance',
  'customer_experience',
  'data',
] as const;

export type ReadinessDomain = (typeof READINESS_DOMAINS)[number];

/** The seven scanned departments, in canonical order. */
export const READINESS_DEPARTMENTS = [
  'revenue_engine',
  'customer_experience',
  'operations_supply_chain',
  'marketing_acquisition',
  'finance_unit_economics',
  'data_infrastructure',
  'talent_process',
] as const;

export type ReadinessDepartment = (typeof READINESS_DEPARTMENTS)[number];

/** The canonical severity vocabulary, used for a domain and for the band. */
export const READINESS_SEVERITIES = ['Low', 'Moderate', 'High', 'Critical'] as const;

export type ReadinessSeverity = (typeof READINESS_SEVERITIES)[number];

/** The canonical cross-dependency kinds. */
export const READINESS_DEPENDENCY_TYPES = ['required_before', 'enhances', 'reduces-risk'] as const;

export type ReadinessDependencyType = (typeof READINESS_DEPENDENCY_TYPES)[number];

// ── The result ──────────────────────────────────────────────────────────────

export interface ReadinessDomainScore {
  readonly domain: ReadinessDomain;
  readonly label: string;
  readonly score: number;
  readonly severity: ReadinessSeverity;
  readonly painSignalCount: number;
}

export interface ReadinessSnapshot {
  /** Mean of the six domain scores. See the header for the exact rule. */
  readonly overallScore: number;
  /** Canonical severity thresholds applied to `overallScore`. */
  readonly band: ReadinessSeverity;
  /** Domain → score, in canonical domain order. */
  readonly domainScores: Readonly<Record<ReadinessDomain, number>>;
  /** The full per-domain detail. Ordered by score descending, then by domain. */
  readonly domains: readonly ReadinessDomainScore[];
  readonly dataCompleteness: number;
  readonly answeredQuestions: number;
  readonly totalQuestions: number;
  readonly averageAnswerWords: number;
  readonly totalSignals: number;
}

export interface ReadinessDependency {
  readonly targetRecommendationId: string;
  readonly targetDepartment: ReadinessDepartment;
  readonly dependencyType: ReadinessDependencyType;
  readonly description: string;
}

export interface ReadinessRecommendation {
  /**
   * Deterministic. `rec:<department>` and nothing else.
   *
   * The canonical engine mints `rec-<department>-<Date.now()>`, which makes two
   * runs over identical input produce different ids. That is a defect this port
   * does not reproduce: an authoritative value the fact lock has to restore
   * cannot be one that changes when nothing changed. The equality suite
   * therefore compares recommendations BY DEPARTMENT, which is the identity the
   * canonical engine's own ranking, dependency and sequencing logic actually
   * keys on.
   */
  readonly recommendationId: string;
  readonly department: ReadinessDepartment;
  readonly label: string;
  /** 1-based position in the portfolio. Descending priority. */
  readonly rank: number;
  /** impact*0.4 + automation*0.3 + density*0.2 − risk*0.1, to one decimal. */
  readonly priorityScore: number;
  /** density >= 6 AND impact >= 6. Always true inside the portfolio. */
  readonly qualified: boolean;
  readonly problemDensity: number;
  readonly impactPotential: number;
  readonly automationFeasibility: number;
  readonly riskExposure: number;
  /** 1-based position in the execution sequence. */
  readonly sequencePosition: number;
  readonly dependencies: readonly ReadinessDependency[];
}

export interface ReadinessPortfolio {
  /** Departments that met both thresholds, before the cap. */
  readonly qualifiedCount: number;
  /** Recommendations after the cap. Never more than `cap`. */
  readonly portfolioSize: number;
  readonly cap: number;
  readonly capApplied: boolean;
  /** Recommendation ids in execution order. */
  readonly executionOrder: readonly string[];
  readonly sequencingRules: readonly string[];
}

export interface ReadinessDecision {
  readonly primaryDomain: ReadinessDomain;
  readonly primaryProblem: string;
  readonly sprintTemplateId: string;
  readonly confidence: number;
  readonly isHybrid: boolean;
  readonly rankedDomains: readonly { readonly domain: ReadinessDomain; readonly score: number }[];
}

export type ReadinessConsistencySection = 'structural' | 'scoring' | 'dependency' | 'evidence';

export interface ReadinessConsistencyIssue {
  readonly section: ReadinessConsistencySection;
  readonly code: string;
  readonly message: string;
}

export interface ReadinessConsistency {
  readonly valid: boolean;
  readonly errors: readonly ReadinessConsistencyIssue[];
  readonly warnings: readonly ReadinessConsistencyIssue[];
  readonly sections: Readonly<Record<ReadinessConsistencySection, boolean>>;
}

export interface ReadinessAuthority {
  readonly engineVersion: string;
  readonly submissionId: string;
  readonly organizationId: string;
  readonly readiness: ReadinessSnapshot;
  readonly recommendations: readonly ReadinessRecommendation[];
  readonly portfolio: ReadinessPortfolio;
  readonly decision: ReadinessDecision;
  readonly consistency: ReadinessConsistency;
  /** Digest of everything above. What a draft and a commit are checked against. */
  readonly authorityDigest: string;
}

// ── The deterministic authority boundary (Part 7A, Phase 5) ─────────────────

/**
 * Paths the model may describe and may never decide.
 *
 * Dotted paths into `ReadinessAuthority`. `recommendations.*` is expressed as a
 * per-entry field name rather than a path, because the entries are a LIST and a
 * dotted path cannot address one — see `agent/factLock.ts` for how the list half
 * of the lock works and why a path list alone would leave an invented
 * recommendation in place.
 */
export const AUTHORITATIVE_FIELDS = [
  'readiness.overallScore',
  'readiness.band',
  'readiness.domainScores',
] as const;

/** Per-recommendation fields the model may never decide. */
export const AUTHORITATIVE_RECOMMENDATION_FIELDS = [
  'rank',
  'priorityScore',
  'qualified',
  'dependencies',
] as const;

// ── Schemas ─────────────────────────────────────────────────────────────────

const domainScoreSchema = object({
  domain: literal(READINESS_DOMAINS),
  label: str({ maxLength: 80 }),
  score: int({ min: 0, max: 100 }),
  severity: literal(READINESS_SEVERITIES),
  painSignalCount: num({ min: 0, max: 10_000 }),
});

const dependencySchema = object({
  targetRecommendationId: str({ maxLength: 80 }),
  targetDepartment: literal(READINESS_DEPARTMENTS),
  dependencyType: literal(READINESS_DEPENDENCY_TYPES),
  description: str({ maxLength: 240 }),
});

export const readinessRecommendationSchema = object({
  recommendationId: str({ maxLength: 80 }),
  department: literal(READINESS_DEPARTMENTS),
  label: str({ maxLength: 120 }),
  rank: int({ min: 1, max: 7 }),
  priorityScore: num({ min: -10, max: 10 }),
  qualified: bool(),
  problemDensity: int({ min: 0, max: 10 }),
  impactPotential: int({ min: 0, max: 10 }),
  automationFeasibility: int({ min: 0, max: 10 }),
  riskExposure: int({ min: 0, max: 10 }),
  sequencePosition: int({ min: 1, max: 7 }),
  dependencies: arrayOf(dependencySchema, { maxItems: 12 }),
});

const consistencyIssueSchema = object({
  section: literal(['structural', 'scoring', 'dependency', 'evidence'] as const),
  code: str({ maxLength: 64 }),
  message: str({ maxLength: 300 }),
});

export const readinessAuthoritySchema: Validator<ReadinessAuthority> = object({
  engineVersion: str({ maxLength: 16 }),
  submissionId: str({ maxLength: 64 }),
  organizationId: str({ maxLength: 64 }),
  readiness: object({
    overallScore: int({ min: 0, max: 100 }),
    band: literal(READINESS_SEVERITIES),
    domainScores: object({
      operations: int({ min: 0, max: 100 }),
      revenue: int({ min: 0, max: 100 }),
      systems: int({ min: 0, max: 100 }),
      governance: int({ min: 0, max: 100 }),
      customer_experience: int({ min: 0, max: 100 }),
      data: int({ min: 0, max: 100 }),
    }),
    domains: arrayOf(domainScoreSchema, { minItems: 6, maxItems: 6 }),
    dataCompleteness: num({ min: 0, max: 1 }),
    answeredQuestions: int({ min: 0, max: 64 }),
    totalQuestions: int({ min: 0, max: 64 }),
    averageAnswerWords: int({ min: 0, max: 100_000 }),
    totalSignals: int({ min: 0, max: 10_000 }),
  }),
  recommendations: arrayOf(readinessRecommendationSchema, { maxItems: 7 }),
  portfolio: object({
    qualifiedCount: int({ min: 0, max: 7 }),
    portfolioSize: int({ min: 0, max: 7 }),
    cap: int({ min: 1, max: 7 }),
    capApplied: bool(),
    executionOrder: arrayOf(str({ maxLength: 80 }), { maxItems: 7 }),
    sequencingRules: arrayOf(str({ maxLength: 200 }), { maxItems: 8 }),
  }),
  decision: object({
    primaryDomain: literal(READINESS_DOMAINS),
    primaryProblem: str({ maxLength: 120 }),
    sprintTemplateId: str({ maxLength: 80 }),
    confidence: num({ min: 0, max: 1 }),
    isHybrid: bool(),
    rankedDomains: arrayOf(
      object({ domain: literal(READINESS_DOMAINS), score: int({ min: 0, max: 100 }) }),
      { minItems: 6, maxItems: 6 },
    ),
  }),
  consistency: object({
    valid: bool(),
    errors: arrayOf(consistencyIssueSchema, { maxItems: 32 }),
    warnings: arrayOf(consistencyIssueSchema, { maxItems: 32 }),
    sections: object({
      structural: bool(),
      scoring: bool(),
      dependency: bool(),
      evidence: bool(),
    }),
  }),
  authorityDigest: str({ maxLength: 64 }),
}) as unknown as Validator<ReadinessAuthority>;

/**
 * The portfolio ceiling, and the band Part 7A states around it.
 *
 * `cap` is the canonical `MAX_PORTFOLIO_SIZE`. `expectedBand` is the range a
 * healthy scan lands in and is REPORTED rather than enforced: a business with
 * three qualifying departments has three recommendations, and manufacturing two
 * more to reach a floor would be inventing work the engine did not find.
 */
export const PORTFOLIO_BOUNDS = { cap: 7, expectedBand: { min: 5, max: 7 } } as const;

/** The qualification thresholds. Both must be met. */
export const QUALIFICATION_THRESHOLDS = { problemDensity: 6, impactPotential: 6 } as const;

/** The priority weights, in the canonical order they are applied. */
export const PRIORITY_WEIGHTS = {
  impactPotential: 0.4,
  automationFeasibility: 0.3,
  problemDensity: 0.2,
  riskExposure: -0.1,
} as const;
