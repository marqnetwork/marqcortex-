/**
 * The canonical Cortex rules, restated for the edge runtime (Part 7B, Phase 1).
 *
 * Every constant and every keyword list in this file is a VERBATIM restatement
 * of `src/app/core/{inputNormalizer,scoringEngine,decisionEngine,portfolioEngine}.ts`.
 * Nothing is tuned, rounded, reordered or improved.
 *
 * ── WHY RESTATED AND NOT IMPORTED ──────────────────────────────────────────
 *
 * The canonical engines are browser-boundary source. They are authored against
 * the Vite `@/…` aliases and reach `src/app/components/*.tsx` through the
 * question registry, so the Supabase edge runtime cannot import them: the
 * specifier does not resolve and the transitive graph is DOM source. Deriving a
 * readiness result server-side therefore means having the rules server-side.
 *
 * That is a duplication, and duplication drifts. So the drift is made a TEST
 * FAILURE rather than a discovery: `tests/features/diagnosticReadinessAuthority.test.ts`
 * loads the canonical modules and this port over the same fixture corpus and
 * asserts field-by-field equality of the normaliser, the domain scores, the
 * decision and the department scan — including the qualification threshold, the
 * priority formula and the boundary cases either side of six. A rule edited on
 * one side and not the other fails that suite.
 *
 * ── WHAT IS DELIBERATELY NOT PORTED ────────────────────────────────────────
 *
 * The canonical `buildPortfolio` also assembles sprint templates, ROI
 * eligibility, cashflow, capital allocation and financial projections. None of
 * it is here, and none of it is missing by oversight: Part 7A's agent may not
 * calculate ROI, and a readiness review does not price anything. What IS ported
 * is exactly the part the review is about — qualification, priority, ranking,
 * the cap, sequencing and cross-dependencies.
 */

import type {
  ReadinessDependencyType,
  ReadinessDepartment,
  ReadinessDomain,
  ReadinessSeverity,
} from '../contracts/readiness.ts';

export type CausalCategory =
  | 'manual_dependency'
  | 'tool_fragmentation'
  | 'governance_bottleneck'
  | 'revenue_leakage'
  | 'scalability_risk'
  | 'data_integrity';

export type SignalType = 'pain' | 'opportunity' | 'risk' | 'strength';

/** `inputNormalizer.CAUSAL_KEYWORDS`, verbatim. */
export const CAUSAL_KEYWORDS: Readonly<Record<CausalCategory, readonly string[]>> = {
  manual_dependency: [
    'manual', 'manually', 'by hand', 'copy-paste', 'copy paste', 'spreadsheet',
    'repetitive', 'every time', 'same task', 'human doing', 'typed in',
    'enters it', 'one by one', 'no automation', 'we do it ourselves',
  ],
  tool_fragmentation: [
    'disconnected', 'nothing connects', 'too many tools', "doesn't integrate",
    'silo', 'siloed', 'fragmented', 'scattered', 'duplicate', 'legacy',
    'different system', 'separate tool', 'workaround', 'export and import',
  ],
  governance_bottleneck: [
    'approval', 'sign-off', 'depends on me', 'founder', 'waits for me',
    'bottleneck', "can't move without", 'my decision', 'escalat', 'permission',
    'only I', 'only person', 'single point', 'approval queue',
  ],
  revenue_leakage: [
    'lost revenue', 'losing money', 'abandoned cart', 'cart abandonment',
    'churn', 'cancellation', 'refund', 'wasted', 'missed', 'leakage',
    'not capturing', 'falling through', 'upsell', 'retention',
  ],
  scalability_risk: [
    'break', 'collapse', 'overwhelmed', "can't handle", 'capacity',
    'not scalable', "won't scale", 'burn out', 'burnout', 'stretched',
    'overloaded', 'breaking point', 'can not keep up', 'hiring just to',
  ],
  data_integrity: [
    'incorrect', 'wrong data', 'discrepancy', 'counts off', 'no visibility',
    "can't see", "don't know", 'no single source', 'data loss', 'error',
    'inaccurate', 'outdated', 'stale', 'conflicting', 'unreliable',
  ],
};

/** The declaration order `Object.entries(CAUSAL_KEYWORDS)` yields canonically. */
export const CAUSAL_CATEGORIES: readonly CausalCategory[] = [
  'manual_dependency',
  'tool_fragmentation',
  'governance_bottleneck',
  'revenue_leakage',
  'scalability_risk',
  'data_integrity',
];

/** `inputNormalizer.estimateMaturity`'s positive vocabulary, verbatim. */
export const POSITIVE_MATURITY_KEYWORDS: readonly string[] = [
  'automated', 'dashboard', 'integrated', 'systematic', 'documented', 'sop', 'kpi', 'metrics',
];

export const OPPORTUNITY_WORDS: readonly string[] = [
  'want to', 'plan to', 'looking to', 'interested in', 'exploring', 'considering',
];

export const STRENGTH_WORDS: readonly string[] = [
  'already have', 'works well', 'effective', 'strong', 'successful', 'efficient',
];

/** Categories `classifyPrimarySignal` treats as risk rather than pain. */
export const RISK_CATEGORIES: readonly CausalCategory[] = ['scalability_risk', 'data_integrity'];

export const CAUSAL_TO_DOMAIN: Readonly<Record<CausalCategory, ReadinessDomain>> = {
  manual_dependency: 'operations',
  tool_fragmentation: 'systems',
  governance_bottleneck: 'governance',
  revenue_leakage: 'revenue',
  scalability_risk: 'operations',
  data_integrity: 'data',
};

export const DOMAIN_LABELS: Readonly<Record<ReadinessDomain, string>> = {
  operations: 'Operations & Execution',
  revenue: 'Revenue & Growth',
  systems: 'Systems & Automation',
  governance: 'AI Readiness & Governance',
  customer_experience: 'Customer Experience',
  data: 'Data & Visibility',
};

export const DOMAIN_TO_SPRINT: Readonly<Record<ReadinessDomain, string>> = {
  operations: 'automation-sprint',
  revenue: 'retention-sprint',
  systems: 'systems-integration-sprint',
  governance: 'founder-leverage-sprint',
  customer_experience: 'lifecycle-optimization-sprint',
  data: 'data-unification-sprint',
};

export const CORE_PROBLEM_LABELS: Readonly<Record<ReadinessDomain, string>> = {
  operations: 'Manual Process Dependency',
  revenue: 'Revenue Leakage',
  systems: 'Tool & System Fragmentation',
  governance: 'Decision-Making Bottleneck',
  customer_experience: 'Customer Experience Breakdown',
  data: 'Data Visibility Gap',
};

/** `scoringEngine.DOMAIN_SENSITIVITY`, verbatim. */
export const DOMAIN_SENSITIVITY: Readonly<Record<ReadinessDomain, number>> = {
  operations: 1.0,
  revenue: 1.1,
  systems: 0.9,
  governance: 1.0,
  customer_experience: 1.05,
  data: 0.85,
};

export const DEPARTMENT_LABELS: Readonly<Record<ReadinessDepartment, string>> = {
  revenue_engine: 'Revenue Engine',
  customer_experience: 'Customer Experience',
  operations_supply_chain: 'Operations & Supply Chain',
  marketing_acquisition: 'Marketing & Acquisition',
  finance_unit_economics: 'Finance & Unit Economics',
  data_infrastructure: 'Data & Infrastructure',
  talent_process: 'Talent & Process',
};

export const DEPARTMENT_SOURCE_DOMAINS: Readonly<
  Record<ReadinessDepartment, readonly ReadinessDomain[]>
> = {
  revenue_engine: ['revenue'],
  customer_experience: ['customer_experience'],
  operations_supply_chain: ['operations'],
  marketing_acquisition: ['revenue', 'customer_experience'],
  finance_unit_economics: ['revenue', 'operations'],
  data_infrastructure: ['data', 'systems'],
  talent_process: ['governance'],
};

/** `portfolioEngine.SEQUENCING_TIERS`, verbatim. Order is the rule. */
export const SEQUENCING_TIERS: readonly (readonly ReadinessDepartment[])[] = [
  ['operations_supply_chain', 'data_infrastructure'],
  ['talent_process', 'finance_unit_economics'],
  ['revenue_engine', 'customer_experience', 'marketing_acquisition'],
];

export interface CanonicalDependencyLink {
  readonly target: ReadinessDepartment;
  readonly type: ReadinessDependencyType;
  readonly description: string;
}

/** `portfolioEngine.DEPENDENCY_MAP`, verbatim. */
export const DEPENDENCY_MAP: Readonly<
  Record<ReadinessDepartment, readonly CanonicalDependencyLink[]>
> = {
  operations_supply_chain: [
    {
      target: 'data_infrastructure',
      type: 'enhances',
      description: 'Operational automation generates structured data for infrastructure',
    },
    {
      target: 'customer_experience',
      type: 'enhances',
      description: 'Operational efficiency directly improves customer SLAs',
    },
  ],
  data_infrastructure: [
    {
      target: 'revenue_engine',
      type: 'required_before',
      description: 'Revenue attribution requires clean data infrastructure',
    },
    {
      target: 'marketing_acquisition',
      type: 'required_before',
      description: 'Marketing optimization requires unified analytics',
    },
    {
      target: 'finance_unit_economics',
      type: 'required_before',
      description: 'Unit economics visibility requires data foundation',
    },
  ],
  revenue_engine: [
    {
      target: 'customer_experience',
      type: 'enhances',
      description: 'Revenue recovery improves when CX gaps are fixed',
    },
  ],
  customer_experience: [
    {
      target: 'revenue_engine',
      type: 'enhances',
      description: 'Better CX directly drives retention and expansion revenue',
    },
  ],
  talent_process: [
    {
      target: 'operations_supply_chain',
      type: 'reduces-risk',
      description: 'Delegation frameworks reduce operational bottlenecks',
    },
    {
      target: 'revenue_engine',
      type: 'reduces-risk',
      description: 'Faster decisions reduce revenue decision lag',
    },
  ],
  marketing_acquisition: [
    {
      target: 'revenue_engine',
      type: 'enhances',
      description: 'Better acquisition feeds the revenue pipeline',
    },
  ],
  finance_unit_economics: [
    {
      target: 'revenue_engine',
      type: 'required_before',
      description: 'Margin visibility must exist before revenue scaling',
    },
  ],
};

export const DEPARTMENT_PROBLEM_LABELS: Readonly<Record<ReadinessDepartment, string>> = {
  revenue_engine: 'Revenue Leakage & Pipeline Breakdown',
  customer_experience: 'Customer Experience Breakdown',
  operations_supply_chain: 'Manual Process & Supply Chain Dependency',
  marketing_acquisition: 'Acquisition Inefficiency & Channel Fragmentation',
  finance_unit_economics: 'Unit Economics Opacity & Margin Erosion',
  data_infrastructure: 'Data Fragmentation & Infrastructure Gaps',
  talent_process: 'Talent Bottleneck & Process Dependency',
};

/** `scoringEngine.scoreSeverity`, verbatim. Also the readiness band rule. */
export function scoreSeverity(score: number): ReadinessSeverity {
  if (score >= 75) return 'Critical';
  if (score >= 50) return 'High';
  if (score >= 25) return 'Moderate';
  return 'Low';
}

/** The industry multipliers `scoringEngine.applyIndustryAdjustment` applies. */
export const INDUSTRY_ADJUSTMENTS: readonly {
  readonly match: readonly string[];
  readonly bumps: readonly (readonly [ReadinessDomain, number])[];
}[] = [
  {
    match: ['commerce', 'dtc', 'retail'],
    bumps: [
      ['customer_experience', 1.15],
      ['revenue', 1.1],
    ],
  },
  {
    match: ['saas', 'software'],
    bumps: [
      ['systems', 1.15],
      ['data', 1.1],
    ],
  },
  { match: ['agency', 'service'], bumps: [['governance', 1.15]] },
  {
    match: ['health', 'medical'],
    bumps: [
      ['data', 1.15],
      ['governance', 1.1],
    ],
  },
  {
    match: ['manufactur', 'supply chain', 'industrial'],
    bumps: [['operations', 1.15]],
  },
];
