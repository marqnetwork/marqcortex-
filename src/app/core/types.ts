/**
 * CORTEX CORE — DATA CONTRACT (LOCKED)
 *
 * All engine modules pass this structure. UI reads only the final payload.
 * No UI logic outside this structure.
 *
 * Pipeline: InputNormalizer -> ScoringEngine -> DecisionEngine -> TemplateAssembler
 *
 * CRITICAL RULE: Never let the LLM decide priority. Math decides priority.
 * LLM only explains decisions.
 */

// ════════════════════════════════════════════════════════════════════════════════
// CORE DATA CONTRACT — Flows through all 4 engine modules
// ════════════════════════════════════════════════════════════════════════════════

export interface CortexEnginePayload {
  diagnostics: NormalizedDiagnostics;
  scores: DomainScores;
  selected_core_problem: string;
  confidence_score: number;                 // 0-1 float
  sprint_template_id: SprintTemplateId;
  financial_projection: FinancialProjection;
  recommendation_payload: RecommendationPayload;
  recommendation_v2: RecommendationV2;
  portfolio: BusinessTransformationPortfolio;
  decision_transparency: DecisionTransparency;
  roi_model: PortfolioROIModel;
}

// ════════════════════════════════════════════════════════════════════════════════
// MODULE 1: INPUT NORMALIZER OUTPUT
// ════════════════════════════════════════════════════════════════════════════════

export interface NormalizedDiagnostics {
  /** Company context */
  company: string;
  industry: string;
  employeeEstimate: number;

  /** Per-answer numeric metrics */
  answers: NormalizedAnswer[];

  /** Aggregate signal counts */
  totalSignals: number;
  signalsByType: Record<SignalType, number>;

  /** Domain-level pain counts (pre-scoring) */
  domainPainCounts: Record<DomainKey, number>;

  /** Data quality metrics */
  answerCount: number;
  answeredQuestions: number;
  avgWordCount: number;
  completenessRatio: number;              // 0-1
}

export interface NormalizedAnswer {
  questionId: number;
  questionText: string;
  category: string;
  answer: string;
  wordCount: number;
  causalCategories: CausalHit[];
  signalType: SignalType | null;
  maturityScore: number;                  // 1-5
  isEmpty: boolean;
}

export interface CausalHit {
  category: CausalCategory;
  weight: number;                         // keyword match count
  matchedKeywords: string[];
}

export type SignalType = 'pain' | 'opportunity' | 'risk' | 'strength';

export type CausalCategory =
  | 'manual_dependency'
  | 'tool_fragmentation'
  | 'governance_bottleneck'
  | 'revenue_leakage'
  | 'scalability_risk'
  | 'data_integrity';

// ════════════════════════════════════════════════════════════════════════════════
// MODULE 2: SCORING ENGINE OUTPUT
// ════════════════════════════════════════════════════════════════════════════════

export type DomainKey =
  | 'operations'
  | 'revenue'
  | 'systems'
  | 'governance'
  | 'customer_experience'
  | 'data';

export interface DomainScore {
  key: DomainKey;
  label: string;
  rawScore: number;                       // 0-100, weighted
  severity: 'Low' | 'Moderate' | 'High' | 'Critical';
  painSignalCount: number;
  topCausalCategories: CausalCategory[];
  contributingQuestions: number[];         // question IDs
}

export type DomainScores = Record<DomainKey, DomainScore>;

// ════════════════════════════════════════════════════════════════════════════════
// MODULE 3: DECISION ENGINE OUTPUT
// ════════════════════════════════════════════════════════════════════════════════

export type SprintTemplateId =
  | 'automation-sprint'
  | 'inventory-sync-sprint'
  | 'retention-sprint'
  | 'systems-integration-sprint'
  | 'founder-leverage-sprint'
  | 'data-unification-sprint'
  | 'lifecycle-optimization-sprint'
  | 'compliance-sprint';

export interface DecisionOutput {
  selectedCoreProblem: string;
  selectedCoreProblemDomain: DomainKey;
  sprintTemplateId: SprintTemplateId;
  confidenceScore: number;                // 0-1 float
  isHybrid: boolean;                      // true if top 2 within 10%
  hybridSecondary?: DomainKey;
  rankedDomains: { domain: DomainKey; score: number }[];
  decisionReasoning: string;              // Math-derived, NOT LLM-generated
  whyNotOthers: { domain: string; reason: string }[];
}

// ════════════════════════════════════════════════════════════════════════════════
// MODULE 4: TEMPLATE ASSEMBLER OUTPUT
// ════════════════════════════════════════════════════════════════════════════════

export interface SprintTemplate {
  id: SprintTemplateId;
  title: string;
  subtitle: string;
  coreProblemLabel: string;
  focusAreas: string[];
  phases: SprintPhase[];
  kpiTemplates: KPITemplate[];
  riskTemplates: RiskTemplate[];
  baseInvestment: { lowMultiplier: number; highMultiplier: number };
}

export interface SprintPhase {
  name: string;
  durationLabel: string;
  objectives: string[];
  deliverables: string[];
}

export interface KPITemplate {
  metric: string;
  baselineHint: string;
  target30Formula: string;
  target60Formula: string;
  target90Formula: string;
  measurementMethod: string;
}

export interface RiskTemplate {
  risk: string;
  probability: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
  mitigation: string;
}

export interface FinancialProjection {
  estimatedCostRange: string;
  paybackPeriodWeeks: string;
  roiPercent12Month: string;
  revenueLiftPercent: number;
  costReductionPercent: number;
  timeSavedHoursMonth: number;
  totalAnnualImpact: number;
}

export interface RecommendationPayload {
  primaryRecommendation: {
    title: string;
    whyThisFirst: string;
    confidenceScore: number;
    expectedImpact: {
      revenueLiftPercent: number;
      costReductionPercent: number;
      timeSavedHoursMonth: number;
    };
    implementationWindowDays: number;
  };
  focusAreas90Days: string[];
  whatNotToDo: { service: string; reason: string }[];
  solutionBlueprint: {
    phases: SprintPhase[];
    kpis: KPITemplate[];
    risks: RiskTemplate[];
  };
  investmentSummary: {
    estimatedCostRange: string;
    paybackPeriodWeeks: string;
    roiPercent12Month: string;
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// RECOMMENDATION V2 — SCHEMA-LOCKED
// ═══════════════════════════════════════════════════════════════════════════════
//
// Definitive recommendation output structure.
// Every recommendation must map into this. No variation.

export type PillarImpactType = 'consultancy' | 'software' | 'growth' | 'operations';
export type ImpactType = 'revenue_growth' | 'cost_reduction' | 'efficiency' | 'risk_reduction';
export type ImpactUnit = 'percentage' | 'hours' | 'dollars' | 'tickets' | 'count' | 'score';

export interface RecommendationV2 {
  recommendation_id: string;
  version: 'v2';
  /** Version tracking — increments on each recalculation (§5) */
  calc_version: number;

  /** Dependency declarations (dependency_engine_v1) */
  depends_on?: string[];                           // recommendation_ids of parents
  dependency_type?: 'requires' | 'enables' | 'enhances';
  gain_categories?: string[];                      // e.g. ['efficiency_support', 'revenue_conversion']

  core_problem: {
    problem_id: string;
    problem_title: string;
    severity_score: number;                       // 1-10
    pillar_impact: PillarImpactType[];
  };

  strategic_decision: {
    why_now: string;
    why_first: string;
    expected_time_to_impact_days: number;
  };

  impact_profile: {
    impact_type: ImpactType[];
    primary_metric: string;
    baseline_value: number;
    target_value_30d: number;
    target_value_60d: number;
    target_value_90d: number;
    unit: ImpactUnit;
  };

  execution_plan: {
    total_duration_days: number;
    phases: ExecutionPhaseV2[];
  };

  resource_requirements: ResourceRequirement[];

  risk_profile: RiskProfileEntry[];

  assumptions_used: string[];

  /** §1 — Feasibility Scoring (Execution Reality Check) */
  feasibility: FeasibilityScore;

  /** §2 — Evidence Strength Layer */
  evidence_strength: EvidenceStrength;

  /** §3 — Confidence Score (Final Authority Metric)
   *  confidence = priority*0.4 + feasibility*0.3 + evidence*0.3, scaled 0–100 */
  confidence_model: {
    confidence_score: number;                     // 0-100
    confidence_reasoning: string;
    formula_inputs: {
      priority_component: number;
      feasibility_component: number;
      evidence_component: number;
    };
  };

  /** §4 — ROI Eligibility Gate */
  roi_eligibility: ROIEligibility;

  priority_score: {
    impact_score: number;                         // 0-10
    feasibility_score: number;                    // 0-10
    risk_score: number;                           // 0-10
    computed_priority: number;                    // formula-based
  };
}

// ── §1 Feasibility Scoring ──
export interface FeasibilityScore {
  technical_feasibility: number;               // 0-10
  data_readiness: number;                      // 0-10
  organizational_readiness: number;            // 0-10
  change_complexity: number;                   // 0-10
  /** tech*0.3 + data*0.3 + org*0.25 - complexity*0.15 */
  computed_feasibility: number;
  high_execution_risk: boolean;                // true if computed < 5
}

// ── §2 Evidence Strength ──
export interface EvidenceStrength {
  validated_signals: number;
  cross_department_validations: number;
  contradiction_flags: number;
  weak_signal_flags: number;
  /** validated*0.4 + cross*0.3 - contradictions*0.2 - weak*0.1 */
  computed_evidence: number;
}

// ── §4 ROI Eligibility Gate ──
export interface ROIEligibility {
  has_measurable_baseline: boolean;
  has_defined_kpi: boolean;
  has_timeline: boolean;
  feasibility_above_5: boolean;
  confidence_above_60: boolean;
  is_roi_eligible: boolean;                    // all 5 must be true
  gate_failures: string[];                     // which checks failed
}

export interface ExecutionPhaseV2 {
  phase_id: string;
  title: string;
  duration_days: number;
  objectives: string[];
  deliverables: string[];
  dependencies: string[];
}

export interface ResourceRequirement {
  role: string;
  allocation_percent: number;
  active_phase: string;
  /** Monthly role cost for cost_model_v1 — optional, defaults to blended rate */
  monthly_role_cost?: number;
}

export interface RiskProfileEntry {
  risk_id: string;
  probability: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
  mitigation: string;
}

// ════════════════════════════════════════════════════════════════════════════════
// DOMAIN <-> CAUSAL CATEGORY MAPPING
// ════════════════════════════════════════════════════════════════════════════════

export const CAUSAL_TO_DOMAIN: Record<CausalCategory, DomainKey> = {
  manual_dependency: 'operations',
  tool_fragmentation: 'systems',
  governance_bottleneck: 'governance',
  revenue_leakage: 'revenue',
  scalability_risk: 'operations',
  data_integrity: 'data',
};

export const DOMAIN_LABELS: Record<DomainKey, string> = {
  operations: 'Operations & Execution',
  revenue: 'Revenue & Growth',
  systems: 'Systems & Automation',
  governance: 'AI Readiness & Governance',
  customer_experience: 'Customer Experience',
  data: 'Data & Visibility',
};

export const DOMAIN_TO_SPRINT: Record<DomainKey, SprintTemplateId> = {
  operations: 'automation-sprint',
  revenue: 'retention-sprint',
  systems: 'systems-integration-sprint',
  governance: 'founder-leverage-sprint',
  customer_experience: 'lifecycle-optimization-sprint',
  data: 'data-unification-sprint',
};

export const CORE_PROBLEM_LABELS: Record<DomainKey, string> = {
  operations: 'Manual Process Dependency',
  revenue: 'Revenue Leakage',
  systems: 'Tool & System Fragmentation',
  governance: 'Decision-Making Bottleneck',
  customer_experience: 'Customer Experience Breakdown',
  data: 'Data Visibility Gap',
};

// ════════════════════════════════════════════════════════════════════════════════
// DEPARTMENT SCANNING LAYER — 7 Fixed Departments
// ════════════════════════════════════════════════════════════════════════════════
//
// Cortex evaluates business across 7 fixed departments.
// Each department receives 4 sub-scores (0–10).
// This is the client-facing layer; the internal 6-domain model feeds into it.

export type DepartmentKey =
  | 'revenue_engine'
  | 'customer_experience'
  | 'operations_supply_chain'
  | 'marketing_acquisition'
  | 'finance_unit_economics'
  | 'data_infrastructure'
  | 'talent_process';

export interface DepartmentScanScore {
  department: DepartmentKey;
  label: string;
  problem_density_score: number;              // 0-10
  impact_potential_score: number;             // 0-10
  automation_feasibility_score: number;      // 0-10
  risk_exposure_score: number;               // 0-10
  /** Cortex Rules priority formula:
   * impact_potential*0.4 + automation_feasibility*0.3 + problem_density*0.2 - risk_exposure*0.1 */
  computed_priority: number;
  qualifies: boolean;                        // density >= 6 AND impact >= 6
  source_domains: DomainKey[];               // which internal domains feed this
}

export const DEPARTMENT_LABELS: Record<DepartmentKey, string> = {
  revenue_engine: 'Revenue Engine',
  customer_experience: 'Customer Experience',
  operations_supply_chain: 'Operations & Supply Chain',
  marketing_acquisition: 'Marketing & Acquisition',
  finance_unit_economics: 'Finance & Unit Economics',
  data_infrastructure: 'Data & Infrastructure',
  talent_process: 'Talent & Process',
};

// ════════════════════════════════════════════════════════════════════════════════
// BUSINESS TRANSFORMATION PORTFOLIO
// ═══════════════════════════════════════════════════════════════════════════════
//
// Multi-recommendation system. Each qualifying department gets its own
// RecommendationV2. Portfolio layer adds cross-dependencies, capital allocation,
// execution sequencing, and global priority ranking.
//
// Cortex Rules (deterministic):
//   1. Create recommendation ONLY IF density >= 6 AND impact >= 6
//   2. Priority = impact*0.4 + automation*0.3 + density*0.2 - risk*0.1
//   3. Max 7 recommendations per business
//   4. Sequence: constraints→optimization, bottlenecks→growth, data→AI, risk→spend
//   5. Cross-deps: required_before when shared KPIs or systems

export interface BusinessTransformationPortfolio {
  portfolio_id: string;

  business_snapshot: {
    company: string;
    industry: string;
    employee_estimate: number;
    data_completeness: number;              // 0-1
    total_signals_detected: number;
  };

  /** 7-department scan — all departments scored, whether they qualify or not */
  department_scan: DepartmentScanScore[];

  recommendations: RecommendationV2[];

  global_priority_ranking: {
    recommendation_id: string;
    department: DepartmentKey;
    rank: number;
    computed_priority: number;
    cumulative_investment_at_rank: string;
  }[];

  cross_dependencies: CrossDependency[];

  capital_allocation_model: {
    total_estimated_investment: string;
    total_risk_exposure_score: number;      // 0-100
    allocations: {
      recommendation_id: string;
      department: DepartmentKey;
      percent_of_budget: number;
      estimated_cost: string;
    }[];
    capital_efficiency_ranking: {
      recommendation_id: string;
      department: DepartmentKey;
      roi_per_dollar: number;
    }[];
  };

  execution_sequence_model: {
    recommended_execution_order: string[];
    parallel_eligible: string[][];
    critical_path: string[];
    total_duration_days: number;
    sequence_reasoning: string;
    sequencing_rules_applied: string[];
  };
}

export interface CrossDependency {
  source_recommendation_id: string;
  source_department: DepartmentKey;
  target_recommendation_id: string;
  target_department: DepartmentKey;
  dependency_type: 'required_before' | 'enhances' | 'reduces-risk';
  description: string;
}

// ════════════════════════════════════════════════════════════════════════════════
// DECISION TRANSPARENCY
// ════════════════════════════════════════════════════════════════════════════════
//
// Shows WHY math chose the primary recommendation.
// Full audit trail of the scoring → decision pipeline.
// No black boxes. Enterprise-grade transparency.

export interface DecisionTransparency {
  /** All 6 domain scores, ranked */
  ranked_domains: {
    rank: number;
    domain: DomainKey;
    label: string;
    score: number;                          // 0-100
    severity: string;
    is_primary: boolean;
    pain_signal_count: number;
  }[];

  /** Score gap analysis */
  score_gap_analysis: {
    primary_domain: DomainKey;
    primary_score: number;
    secondary_domain: DomainKey;
    secondary_score: number;
    gap_points: number;
    gap_percent: number;
    is_hybrid: boolean;
    gap_interpretation: string;
  };

  /** Confidence factors — shows what fed into the confidence score */
  confidence_factors: {
    data_completeness: { value: number; weight: number; contribution: number };
    answer_quality: { value: number; weight: number; contribution: number };
    score_gap_clarity: { value: number; weight: number; contribution: number };
    signal_density: { value: number; weight: number; contribution: number };
    final_confidence: number;
  };

  /** Why-not-others — deterministic reasoning for each non-primary domain */
  why_not_others: {
    domain: DomainKey;
    label: string;
    score: number;
    delta_from_primary: number;
    reasoning: string;
  }[];

  /** Data quality assessment */
  data_quality: {
    questions_answered: number;
    total_questions: number;
    avg_word_count: number;
    completeness_pct: number;
    quality_grade: 'A' | 'B' | 'C' | 'D' | 'F';
    quality_interpretation: string;
  };

  /** Scoring formula transparency */
  scoring_formula: {
    pain_weight: number;
    causal_weight: number;
    maturity_weight: number;
    cross_dept_weight: number;
    industry_adjustment_applied: boolean;
    industry: string;
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// COST MODELING LAYER — cost_model_v1_standardized
// ════════════════════════════════════════════════════════════════════════════════
//
// No lump-sum internally. Every recommendation must calculate investment
// via the same 5-category structure. Math decides cost. Not arbitrary pricing.

/** Structured cost breakdown per recommendation */
export interface CostBreakdown {
  engineering: number;          // allocated_percent × monthly_role_cost × duration_months
  strategy: number;             // consultant_daily_rate × strategy_days
  tooling: number;              // monthly_tool_cost × project_months (0 if client owns tool)
  change_management: number;    // training_hours × blended_labor_rate
  contingency: number;          // 10–20% of subtotal (default 15%). Never zero.
  subtotal: number;             // engineering + strategy + tooling + change_management
  total: number;                // subtotal + contingency
}

/** Range-based investment estimate */
export interface InvestmentEstimate {
  low: number;
  mid: number;
  high: number;
}

/** Full cost model output per recommendation (§10) */
export interface CostModel {
  investment_estimate: InvestmentEstimate;
  cost_breakdown: CostBreakdown;
  duration_months: number;
  contingency_percent: number;          // 10–20, default 15
  /** §9 governance: true if this rec > 40% of portfolio budget */
  exceeds_portfolio_cap: boolean;
  /** §9 governance: true if duration mismatch with execution_plan */
  duration_mismatch: boolean;
  /** Derivation trail for transparency */
  derivation_notes: string[];
}

// ════════════════════════════════════════════════════════════════════════════════
// CASHFLOW TIMELINE MODELING LAYER — cashflow_model_v1
// ════════════════════════════════════════════════════════════════════════════════
//
// Converts annual ROI into time-based financial reality.
// No instant full-year benefit. No "2 month ROI" inflation.
// Math decides payback timing. Not storytelling.

/** Single month data point in a cash flow projection */
export interface MonthlyProjection {
  month: number;           // 1-based month number
  investment: number;      // total investment deployed this month ($)
  gain: number;            // gain realized this month (ramped, $)
  net: number;             // gain - investment ($)
  cumulative: number;      // running cumulative net cash flow ($)
}

/** Per-recommendation 12-month cash flow model */
export interface RecommendationCashflow {
  /** Total projection window in months (default 12) */
  timeline_months: number;
  /** Monthly investment amounts (length = timeline_months, §3 front-loaded) */
  investment_schedule: number[];
  /** Monthly gain amounts (length = timeline_months, §4 ramp-adjusted) */
  gain_schedule: number[];
  /** Net cash flow per month = gain - investment (§5) */
  net_cash_flow: number[];
  /** Cumulative cash flow per month (§6 running sum) */
  cumulative_cash_flow: number[];
  /** §7 True payback: first month where cumulative >= 0 (null = not reached) */
  true_payback_month: number | null;
}

/** Portfolio-level cash flow model (§8-§9) */
export interface PortfolioCashflow {
  /** Month-by-month portfolio projection (sum of all recommendations) */
  monthly_projection: MonthlyProjection[];
  /** §7 First month where portfolio cumulative cash flow >= 0 */
  true_payback_month: number | null;
  /** Alias for true_payback_month (per spec §9 output format) */
  cashflow_positive_after_month: number | null;
}

// ════════════════════════════════════════════════════════════════════════════════
// DCF INTEGRATION LAYER — finance_v1_dcf
// ════════════════════════════════════════════════════════════════════════════════
//
// Purely a valuation adjustment layer. Operates only on validated net monthly
// cash flows. Never re-runs ROI math. Never modifies gains or confidence scores.
//
// Formulas (locked):
//   r_monthly = discount_rate_percent / 100 / 12
//   DCF(n)    = Net_CF(n) / (1 + r_monthly)^n
//   NPV       = SUM(DCF(1..N))

/** Single month entry in the discounted cash flow projection (§6) */
export interface DCFProjectionEntry {
  month: number;                 // 1-based
  net_cashflow: number;          // undiscounted net (from cashflowEngine)
  discounted_cashflow: number;   // Net_CF(n) / (1 + r_monthly)^n
  cumulative_discounted: number; // running sum of discounted cash flows
}

/** Full DCF model output — "Add to ROI output" (§6) */
export interface DCFModel {
  finance_model_version: 'finance_v1_dcf';
  /** §1: Annual discount rate applied (0–40%, default 12) */
  discount_rate_percent: number;
  /** §2: Monthly equivalent (discount_rate_percent / 100 / 12) */
  r_monthly: number;
  /** §4: NPV = SUM of all monthly discounted cash flows */
  npv: number;
  /** §5B: First month where cumulative discounted cash flow >= 0 (null = not reached) */
  discounted_payback_month: number | null;
  /** §6: Month-by-month discounted projection */
  discounted_cashflow_projection: DCFProjectionEntry[];
  /** §6: Human-readable audit trail of DCF methodology */
  method_notes: string[];
}

/** §8: Failure output when DCF cannot be calculated */
export interface DCFFailure {
  status: 'finance_not_calculable';
  reason: 'missing_cashflow_or_discount_rate' | string;
}

// ════════════════════════════════════════════════════════════════════════════════
// IRR INTEGRATION LAYER — finance_v2_dcf_irr
// ════════════════════════════════════════════════════════════════════════════════
//
// IRR = discount rate where NPV = 0
// SUM( CashFlow_month / (1 + r_monthly)^n ) = 0 — solved via binary search
// Uses SAME monthly net cash flows as DCF (§7 governance)

/** §6 — Successful IRR model output */
export interface IRRModel {
  finance_model_version: 'finance_v2_dcf_irr';
  /** IRR as annual percentage (e.g. 185 = 185%) */
  irr_percent_annual: number;
  /** IRR as monthly percentage (irr_percent_annual / 12) */
  irr_percent_monthly: number;
  /** §3: Always binary_search */
  irr_solver_method: 'binary_search';
  /** Number of binary search iterations until convergence */
  iterations_used: number;
  /** Always true on a successful IRRModel (failures use IRRFailure instead) */
  converged: true;
  /** §4: tolerance used — 0.0001 */
  tolerance: number;
  /** §6: Audit trail notes */
  notes: string[];
}

/** §4+§5 — IRR failure/edge-case output */
export interface IRRFailure {
  status:
    | 'irr_not_calculable'
    | 'invalid_no_negative_cashflow'
    | 'multiple_possible_irr'
    | 'irr_not_converged';
  reason: string;
}

// ════════════════════════════════════════════════════════════════════════════════
// MONTE CARLO SIMULATION LAYER — finance_v3_montecarlo
// §5 Simulation Loop: scaled perturbation on validated cashflow outputs
// §6 Output Metrics: P10/P90/median for ROI, payback, NPV
// §8 Governance: team-only; triggers match finance_recalc_required signals
// ════════════════════════════════════════════════════════════════════════════════

/** One randomized input definition — triangular or discrete */
export interface MonteCarloRandomizedInput {
  /** Dot-path key matching spec §7 payload schema */
  path: string;
  /** Human-readable label for display */
  label: string;
  /** Sampling distribution type */
  distribution: 'triangular' | 'discrete';
  /** Triangular — multiplier bands (e.g. 0.85 / 1.0 / 1.15) */
  min_multiplier?: number;
  mode_multiplier?: number;
  max_multiplier?: number;
  /** Triangular — absolute delta bands (e.g. -5 / 0 / +5 pp for margin) */
  min_delta?: number;
  mode_delta?: number;
  max_delta?: number;
  /** Discrete — sampled values and their weights (must sum to 1) */
  values?: number[];
  weights?: number[]
  /** Base value from current assumptions */
  base_value: number;
}

/** ROI percentile statistics */
export interface MonteCarloROIStat {
  mean: number;
  median: number;
  p10: number;
  p90: number;
  std_dev: number;
  probability_positive: number;   // 0–1 fraction
}

/** Payback period statistics */
export interface MonteCarloPaybackStat {
  mean: number | null;
  median: number | null;
  p10: number | null;
  p90: number | null;
  probability_payback_le_6: number;    // 0–1 fraction
  probability_payback_le_12: number;   // 0–1 fraction
  fraction_never_paid_back: number;    // runs where payback not reached within horizon
}

/** NPV percentile statistics */
export interface MonteCarloNPVStat {
  enabled: boolean;
  mean: number;
  median: number;
  p10: number;
  p90: number;
  std_dev: number;
  probability_positive: number;   // 0–1 fraction
}

/** §7 — Full Monte Carlo output payload */
export interface MonteCarloModel {
  finance_model_version: 'finance_v3_montecarlo';
  /** Requested simulation count */
  simulations: number;
  /** Runs that produced valid numeric output */
  simulations_successful: number;
  /** Which inputs were randomized and with what distributions */
  randomized_inputs: MonteCarloRandomizedInput[];
  /** Aggregated output statistics */
  results: {
    roi_percent: MonteCarloROIStat;
    payback_months: MonteCarloPaybackStat;
    npv: MonteCarloNPVStat;
  };
  /** Raw samples stored for histogram rendering (all N successful runs) */
  roi_samples: number[];
  npv_samples: number[];
  payback_samples: (number | null)[];
  /** Engine wall-clock time */
  run_time_ms: number;
  /** Audit trail */
  notes: string[];
}

/** Monte Carlo failure when simulation cannot run */
export interface MonteCarloFailure {
  status: 'monte_carlo_not_calculable';
  reason: string;
}

// ════════════════════════════════════════════════════════════════════════════════
// SCENARIO MODELING LAYER — finance_v4_scenarios
// §2 Scenario Presets: locked knobs (Conservative / Expected / Aggressive)
// §3 Application Order: after deps/cost/cashflow, before ROI/DCF/IRR/MonteCarlo
// §5 Governance: never change baselines; scenario selection stored in version history
// ════════════════════════════════════════════════════════════════════════════════

/** The three scenario presets — maps exactly to REALIZATION table low/mid/high tiers */
export type ScenarioKey = 'conservative' | 'expected' | 'aggressive';

/** §2 — Realization factors per scenario (map to roiEngine REALIZATION table) */
export interface ScenarioRealizationFactors {
  efficiency: number;
  cost: number;
  revenue: number;
  risk: number;
}

/** §2 — Full preset configuration for one scenario */
export interface ScenarioPreset {
  realization_factors: ScenarioRealizationFactors;
  /** Positive = slower (delay), 0 = standard, Negative = faster (accelerate) */
  ramp_shift_months: number;
  /** Optional clamp: clamp confidence score to this maximum (null = no clamp) */
  confidence_clamp_max: number | null;
}

/** §4 — Per-scenario computed outputs */
export interface ScenarioOutput {
  roi_percent: number;
  npv: number;
  payback_month: number | null;
}

/** §4 — Full scenario model payload attached to PortfolioROIModel */
export interface ScenarioModel {
  finance_model_version: 'finance_v4_scenarios';
  active_scenario: ScenarioKey;
  scenario_presets: Record<ScenarioKey, ScenarioPreset>;
  scenario_outputs: Record<ScenarioKey, ScenarioOutput>;
  notes: string[];
}

// ════════════════════════════════════════════════════════════════════════════════
// ROI MODELING LAYER
// ════════════════════════════════════════════════════════════════════════════════
//
// ROI must be derived from execution plan + validated metrics. Never storytelling.
//
// Formulas (locked):
//   Revenue: (target - baseline) × volume × time_window
//   Cost: time_saved × cost_per_hour × period
//   Risk: risk_probability × financial_exposure
//   Raw ROI: (projected_gain - investment) / investment
//   Adjusted ROI: raw_roi × (confidence / 100)
//   Payback: investment / monthly_net_gain
//   Portfolio ROI: sum(adjusted_gains) / total_investment (dependency-safe)

/** Per-recommendation ROI */
export interface RecommendationROI {
  recommendation_id: string;
  department: DepartmentKey;
  is_roi_eligible: boolean;
  roi_locked_reason?: string;                  // if not eligible

  /** cost_model_v1 — Structured cost breakdown (replaces lump-sum) */
  cost_model?: CostModel;

  /** §1 — Input validation */
  inputs: {
    baseline_metric: number;
    target_metric_90d: number;
    investment_cost: number;                   // in dollars
    confidence_score: number;                  // 0-100
    feasibility_score: number;
    timeline_days: number;
  };

  /** §2 — Core ROI calculation by impact type */
  impact_calculations: {
    revenue_impact?: { projected_gain: number; formula: string };
    cost_reduction?: { savings: number; formula: string };
    risk_reduction?: { expected_loss_avoided: number; formula: string };
    total_projected_gain: number;
  };

  /** §3 — Conservative adjustment (raw × confidence / 100) */
  raw_roi_percent: number;
  adjusted_roi_percent: number;                // raw × (confidence / 100)

  /** §4 — Three-case range (Low 60%, Mid 80%, High 100% efficiency) */
  roi_range: {
    low_case: { efficiency: 0.6; gain: number; roi_percent: number };
    mid_case: { efficiency: 0.8; gain: number; roi_percent: number };
    high_case: { efficiency: 1.0; gain: number; roi_percent: number };
  };

  /** §5 — Payback period */
  payback_months: number;

  /** §7 — Display fields */
  display: {
    investment: string;
    gain_90d: string;
    gain_12mo: string;
    payback_timeline: string;
    adjusted_roi_label: string;
    assumptions: string[];
  };

  /** dependency_engine_v1 §8 — Dependency transparency (team-facing) */
  dependency_validation?: {
    dependency_chain: string[];                // e.g. ['R1', 'R2']
    gain_categories_declared: string[];
    gain_categories_removed: string[];
    gain_categories_validated: string[];
    removal_reasons: string[];
    warnings: string[];
  };

  /** cashflow_model_v1 — Time-based cash flow projection (replaces simplified payback) */
  cashflow?: RecommendationCashflow;
  // Note: DCF (finance_v1_dcf) is portfolio-level only — see PortfolioROIModel.dcf_model

  /** finance_v2_dcf_irr §6 — Internal Rate of Return */
  irr_model?: IRRModel | IRRFailure;
}

/** Portfolio-level ROI (§6) */
export interface PortfolioROIModel {
  /** Per-recommendation ROI models */
  recommendation_rois: RecommendationROI[];

  /** Aggregate (dependency-safe) */
  portfolio_totals: {
    total_investment: number;
    total_investment_label: string;
    total_adjusted_gain_90d: number;
    total_adjusted_gain_12mo: number;
    total_adjusted_roi_percent: number;        // sum(adjusted_gains) / total_investment
    risk_adjusted_return: number;              // total_adjusted_gain_12mo * avg_confidence/100
  };

  /** Range summary across all recs */
  portfolio_range: {
    low_case_total: number;
    mid_case_total: number;
    high_case_total: number;
    low_case_roi: number;
    mid_case_roi: number;
    high_case_roi: number;
  };

  /** Payback */
  portfolio_payback_months: number;

  /** Execution order impact curve — shows cumulative ROI at each step */
  execution_impact_curve: {
    step: number;
    recommendation_id: string;
    department: DepartmentKey;
    cumulative_investment: number;
    cumulative_gain_12mo: number;
    cumulative_roi_percent: number;
  }[];

  /** Dependency deduplication applied */
  dependency_adjustments: {
    source_department: DepartmentKey;
    target_department: DepartmentKey;
    adjustment_type: 'revenue_credit_to_target' | 'efficiency_credit_only';
    description: string;
  }[];

  /** dependency_engine_v1 — Validation result */
  dependency_validation?: DependencyValidationResult;

  /** cashflow_model_v1 — Portfolio-level 12-month cash flow timeline (§8-§9) */
  portfolio_cashflow?: PortfolioCashflow;

  /** finance_v1_dcf §6 — Portfolio-level Discounted Cash Flow / NPV model */
  dcf_model?: DCFModel | DCFFailure;

  /** finance_v2_dcf_irr §6 — Internal Rate of Return */
  irr_model?: IRRModel | IRRFailure;

  /** finance_v3_montecarlo §7 — Monte Carlo risk distribution (CFO trust layer) */
  monte_carlo?: MonteCarloModel | MonteCarloFailure;

  /** finance_v4_scenarios §4 — All three scenario outputs (Conservative/Expected/Aggressive) */
  scenario_model?: ScenarioModel;
}

// ════════════════════════════════════════════════════════════════════════════════
// DEPENDENCY ENGINE v1 — dependency_engine_v1
// ════════════════════════════════════════════════════════════════════════════════

/** Result of the dependency validation pass */
export interface DependencyValidationResult {
  status: 'valid' | 'invalid_dependency_graph';
  error?: string;
  topological_order: string[];
  claimed_gain_registry: Record<string, string>;  // gain_category → recommendation_id that owns it
  overlap_removals: {
    recommendation_id: string;
    removed_category: string;
    reason: string;
  }[];
  warnings: string[];
}

// ════════════════════════════════════════════════════════════════════════════════
// VERSION CONTROL ENGINE — Chat Recalculation + Version History
// ════════════════════════════════════════════════════════════════════════════════
//
// Core Principle:
//   Chat never edits outputs directly.
//   Chat only edits inputs/assumptions/constraints.
//   Then the pipeline re-runs:
//     Inputs → Scoring → Portfolio Ranking → Feasibility → Confidence → ROI → Narrative
//
// Every recalculation increments version. Never overwrite. Store ≥25 versions.

/** Business assumptions — the only editable financial/ops layer */
export interface PortfolioAssumptions {
  monthly_revenue: number;
  avg_order_value: number;
  monthly_orders: number;
  support_tickets_per_week: number;
  avg_response_time_hours: number;
  labor_cost_per_hour: number;
  refund_rate_percent: number;
  conversion_rate_percent: number;
  gross_margin_percent: number;
  /** finance_v1_dcf §1: Annual discount rate for DCF/NPV (0–40%, default 12) */
  discount_rate_percent?: number;
  /** Extensible: any additional industry-specific assumptions */
  [key: string]: number | undefined;
}

/** System guardrails — non-negotiable constraints */
export interface PortfolioConstraints {
  max_roi_display_percent: number;             // hard cap even if math says higher
  roi_must_be_range: boolean;                  // never single number
  confidence_floor_for_roi: number;            // min confidence before ROI calc
  max_recommendations: number;                 // max 7
  no_claims_without_assumptions: boolean;      // every ROI must trace to assumptions
}

export const DEFAULT_CONSTRAINTS: PortfolioConstraints = {
  max_roi_display_percent: 350,
  roi_must_be_range: true,
  confidence_floor_for_roi: 60,
  max_recommendations: 7,
  no_claims_without_assumptions: true,
};

/** Chat intent types — only these 7 are allowed */
export type ChangeRequestType =
  | 'UpdateAssumption'
  | 'UpdateConstraint'
  | 'UpdatePriorityPreference'
  | 'ClarifyAnswer'
  | 'RequestExplanation'
  | 'ApproveVersion'
  | 'SwitchScenario';      // finance_v4_scenarios §5: version bump on scenario change

/** A single field change within a ChangeRequest */
export interface ChangeRequestEntry {
  path: string;                                // dot-notation: "inputs.assumptions.monthly_revenue"
  value: string | number | boolean;
  reason: string;
}

/** The structured output from chat → pipeline */
export interface ChangeRequest {
  type: ChangeRequestType;
  changes: ChangeRequestEntry[];
  /** Optional: soft preference (only for UpdatePriorityPreference) */
  preference_note?: string;
}

/** Immutable delta record */
export interface DeltaLogEntry {
  path: string;
  old: string | number | boolean | null;
  new_value: string | number | boolean;        // "new" is reserved word
  reason: string;
}

/** Which engines were re-run */
export interface RecalcFlags {
  scoring: boolean;
  portfolio: boolean;
  feasibility: boolean;
  confidence: boolean;
  roi: boolean;
  cortex_narrative: boolean;
}

/** Immutable version record */
export interface VersionRecord {
  version: string;                             // "v1", "v2", "v3"
  previous_version: string | null;
  timestamp: string;                           // ISO
  actor: 'team_user' | 'system';
  source: 'chat' | 'manual_edit' | 'auto' | 'initial';
  delta_log: DeltaLogEntry[];
  recalc: RecalcFlags;
  summary: string;
  /** If ApproveVersion, lock for proposal/export */
  is_approved?: boolean;
  /** §7 — locked_for_export after ApproveVersion */
  locked_for_export?: boolean;
  /** §4 — Whether ROI was recalculated in this version */
  roi_recalculated?: boolean;
  /** §4+5 — ROI delta summary for trust/transparency */
  roi_delta_summary?: {
    portfolio_roi_old: number;
    portfolio_roi_new: number;
    delta_percent: number;
    gain_old: number;
    gain_new: number;
    gain_delta: number;
    payback_old: number;
    payback_new: number;
    payback_delta: number;
  };
  /** finance_v1_dcf §9: True when discount_rate, timeline, gain, or investment changed */
  finance_recalc_required?: boolean;
  /** finance_v1_dcf — NPV/payback delta between this version and previous */
  dcf_delta_summary?: {
    npv_old: number;
    npv_new: number;
    npv_delta: number;
    discount_rate_old: number;
    discount_rate_new: number;
    discounted_payback_old: number | null;
    discounted_payback_new: number | null;
    /** null when either side payback not reached within horizon */
    payback_delta: number | null;
  };
  /** finance_v2_dcf_irr — IRR delta between this version and previous */
  irr_delta_summary?: {
    irr_annual_old: number | null;   // null if previous version had IRR failure
    irr_annual_new: number | null;   // null if new version has IRR failure
    irr_delta: number | null;        // null when either side is null
    status_old: string;              // 'converged' | failure status key
    status_new: string;
  };
  /** finance_v4_scenarios §5 — True when scenario preset was switched in this version */
  scenario_switched?: boolean;
  /** finance_v4_scenarios §5 — Which scenario changed and the ROI delta */
  scenario_delta_summary?: {
    scenario_old: ScenarioKey | null;
    scenario_new: ScenarioKey;
    roi_old: number | null;
    roi_new: number;
    npv_old: number | null;
    npv_new: number;
    payback_old: number | null;
    payback_new: number | null;
  };
}

/** Portfolio State — single source of truth */
export interface PortfolioState {
  portfolio_id: string;
  lead_id: string;
  current_version: string;                     // "v1", "v2", etc.
  created_at: string;
  updated_at: string;

  /** finance_v4_scenarios §5 — Active scenario (stored in version history per §5 governance) */
  active_scenario?: ScenarioKey;

  inputs: {
    business_snapshot: {
      company: string;
      industry: string;
      employee_estimate: number;
    };
    answers: Record<string, string>;
    assumptions: PortfolioAssumptions;
    constraints: PortfolioConstraints;
  };

  outputs: {
    diagnostic: CortexEnginePayload | null;
    recommendations: RecommendationV2[];
    portfolio: BusinessTransformationPortfolio | null;
    roi: PortfolioROIModel | null;
    decision_transparency: DecisionTransparency | null;
  };

  /** Immutable history — newest first, keep ≥ 25 */
  history: VersionRecord[];
}

/** What the UI receives after a recalc */
export interface RecalcResult {
  success: boolean;
  new_version: string;
  summary: string;
  /** Which sections changed */
  changed_sections: ('scoring' | 'portfolio' | 'feasibility' | 'confidence' | 'roi' | 'narrative')[];
  /** The updated state */
  state: PortfolioState;
  /** Error detail if failed */
  error?: string;
}
