/**
 * CORTEX DIAGNOSTIC ENGINE — v1 Schema-Locked
 *
 * Strict, deterministic diagnostic output generator.
 * Every submission → identical structural anatomy.
 *
 * Schema follows DIAGNOSTIC INTELLIGENCE SCHEMA v1:
 *   1. Executive Layer
 *   2. Bottleneck Objects (Core Engine)
 *   3. Systemic Pattern Engine
 *   4. Operational Pillar Matrix
 *   5. Financial Model Engine
 *   6. Risk Model
 *   7. Confidence & Integrity Layer
 *
 * Plus internal layers:
 *   - Causal Modeling (classifies every answer)
 *   - Pattern Aggregation (signal frequency, cross-dept overlap)
 *   - Root Cause Hierarchy (4 levels)
 *   - Stress Simulation (deterministic rules)
 *   - Quantification Model (derived from inputs)
 */

import type { AnnotatedResponse } from '@/app/utils/questionRegistry';
import type { PillarHeatmap } from '@/app/types/cortex-types';

// ════════════════════════════════════════════════════════════════════════════════
// 1️⃣  STRICT OUTPUT SCHEMA — v1 LOCKED
// ════════════════════════════════════════════════════════════════════════════════

export interface DiagnosticOutput {
  executive_summary: ExecutiveSummaryOutput;
  bottlenecks: BottleneckOutput[];
  systemic_patterns: SystemicPatternOutput[];
  pillar_matrix: PillarMatrixOutput;
  financial_model: FinancialModelOutput;
  risk_model: RiskEntryOutput[];
  confidence_layer: ConfidenceLayerOutput;
}

// ── 1. Executive Layer ───────────────────────────────────────────────────────

export interface ExecutiveSummaryOutput {
  readiness_score: number;                                          // 0-100
  readiness_category: 'Manual' | 'Fragmented' | 'Transitional' | 'Structured';
  primary_bottleneck_id: string;                                    // e.g. "B1"
  secondary_bottleneck_id: string;                                  // e.g. "B2"
  growth_risk_level: 'Low' | 'Moderate' | 'High' | 'Critical';
  estimated_annual_impact_range: { min: number; max: number };      // dollars
  narrative_summary: string;
  confidence_score: number;                                         // 0-1 float
}

// ── 2. Bottleneck Objects ────────────────────────────────────────────────────

export type BottleneckCategory = 'Revenue' | 'Operations' | 'Governance' | 'Compliance';

export interface BottleneckOutput {
  id: string;                                     // "B1", "B2", etc.
  title: string;
  severity: 'Moderate' | 'High' | 'Critical';
  category: BottleneckCategory;
  pattern_strength: number;                        // numeric, higher = stronger

  causal_chain: [string, string, string, string, string]; // 5-element: Trigger → Immediate → Secondary → Compounding → Failure

  stress_simulation: {
    growth_20_percent: string;
    growth_30_percent: string;
    founder_absence: string;
    system_failure: string;
  };

  root_cause_hierarchy: {
    level_1_symptom: string;
    level_2_process_failure: string;
    level_3_architecture_failure: string;
    level_4_governance_failure: string;
  };

  quantified_impact: {
    revenue_leakage_estimate: number;              // annual $
    payroll_inflation_risk: number;                // annual $
    time_waste_hours_per_week: number;
    growth_ceiling_percent: number;                // % before failure
  };

  intervention_path: {
    short_term: string;
    mid_term: string;
    structural_redesign: string;
  };

  supporting_questions: {
    question_id: string;                            // e.g. "Q3"
    client_answer: string;
    ai_interpretation: string;
    structural_implication: string;
  }[];
}

// ── 3. Systemic Patterns ─────────────────────────────────────────────────────

export interface SystemicPatternOutput {
  pattern_name: string;
  severity: 'Low' | 'Moderate' | 'High';
  signal_count: number;
  cross_departmental_presence: boolean;
  failure_cascade_potential: string;
  recurrence_probability: number;                   // 0-1 float
}

// ── 4. Pillar Matrix ─────────────────────────────────────────────────────────

export interface PillarEntryOutput {
  score: number;
  interpretation: string;
  dominant_weakness: string;
  automation_leverage_potential: string;
}

export interface PillarMatrixOutput {
  operations: PillarEntryOutput;
  revenue: PillarEntryOutput;
  systems: PillarEntryOutput;
  governance: PillarEntryOutput;
}

// ── 5. Financial Model ───────────────────────────────────────────────────────

export interface FinancialModelOutput {
  direct_revenue_leakage: number;
  hidden_operational_drag: number;
  payroll_misallocation: number;
  opportunity_cost: number;
  compounding_growth_tax: number;
  total_estimated_annual_impact: number;
}

// ── 6. Risk Model ────────────────────────────────────────────────────────────

export type RiskType = 'Scalability' | 'Data' | 'Dependency' | 'Compliance';

export interface RiskEntryOutput {
  risk_type: RiskType;
  severity: 'Low' | 'Moderate' | 'High' | 'Critical';
  trigger_threshold: string;
  probability_percent: number;
  time_to_failure_estimate: string;
  cascade_path: string;
}

// ── 7. Confidence Layer ──────────────────────────────────────────────────────

export interface ConfidenceLayerOutput {
  total_signals_detected: number;
  corroborated_patterns: number;
  contradiction_flags: number;
  weak_signal_flags: number;
  ai_confidence_score: number;                      // 0-1 float
}

// ════════════════════════════════════════════════════════════════════════════════
// CAUSAL MODEL — classify each answer into weighted clusters
// ════════════════════════════════════════════════════════════════════════════════

export type CausalCategory =
  | 'manual_dependency'
  | 'tool_fragmentation'
  | 'governance_bottleneck'
  | 'revenue_leakage'
  | 'scalability_risk'
  | 'data_integrity';

const CAUSAL_KEYWORDS: Record<CausalCategory, string[]> = {
  manual_dependency: [
    'manual', 'manually', 'by hand', 'copy-paste', 'copy paste', 'spreadsheet',
    'repetitive', 'every time', 'same task', 'human doing',
  ],
  tool_fragmentation: [
    'disconnected', 'nothing connects', 'too many tools', 'doesn\'t integrate',
    'silo', 'siloed', 'fragmented', 'scattered', 'duplicate', 'legacy',
  ],
  governance_bottleneck: [
    'approval', 'sign-off', 'depends on me', 'founder', 'waits for me',
    'bottleneck', 'can\'t move without', 'my decision', 'escalat',
  ],
  revenue_leakage: [
    'lost revenue', 'losing money', 'abandoned cart', 'cart abandonment',
    'churn', 'cancellation', 'refund', 'wasted', 'missed', 'leakage',
  ],
  scalability_risk: [
    'break', 'collapse', 'overwhelmed', 'can\'t handle', 'capacity',
    'not scalable', 'won\'t scale', 'burn out', 'burnout', 'stretched',
  ],
  data_integrity: [
    'incorrect', 'wrong data', 'discrepancy', 'counts off', 'no visibility',
    'can\'t see', 'don\'t know', 'no single source', 'data loss', 'error',
  ],
};

const CAUSAL_TO_BOTTLENECK_CATEGORY: Record<CausalCategory, BottleneckCategory> = {
  manual_dependency: 'Operations',
  tool_fragmentation: 'Operations',
  governance_bottleneck: 'Governance',
  revenue_leakage: 'Revenue',
  scalability_risk: 'Operations',
  data_integrity: 'Compliance',
};

interface CausalClassification {
  questionId: number;
  categories: { category: CausalCategory; weight: number }[];
}

function classifyAnswer(questionId: number, answerText: string): CausalClassification {
  const lower = answerText.toLowerCase();
  const cats: { category: CausalCategory; weight: number }[] = [];

  for (const [cat, keywords] of Object.entries(CAUSAL_KEYWORDS) as [CausalCategory, string[]][]) {
    const matched = keywords.filter(kw => lower.includes(kw));
    if (matched.length > 0) {
      cats.push({ category: cat, weight: matched.length });
    }
  }
  return { questionId, categories: cats };
}

// ════════════════════════════════════════════════════════════════════════════════
// PATTERN AGGREGATION
// ════════════════════════════════════════════════════════════════════════════════

interface ClusterAccumulator {
  questionIds: Set<number>;
  totalWeight: number;
  categories: Set<string>;  // question categories for cross-dept detection
}

function aggregatePatterns(
  classifications: CausalClassification[],
  annotated: AnnotatedResponse[],
): Map<CausalCategory, ClusterAccumulator> {
  const clusters = new Map<CausalCategory, ClusterAccumulator>();

  for (const cls of classifications) {
    const resp = annotated.find(a => a.questionId === cls.questionId);
    const category = resp?.category || '';

    for (const { category: causalCat, weight } of cls.categories) {
      if (!clusters.has(causalCat)) {
        clusters.set(causalCat, { questionIds: new Set(), totalWeight: 0, categories: new Set() });
      }
      const acc = clusters.get(causalCat)!;
      acc.questionIds.add(cls.questionId);
      acc.totalWeight += weight;
      if (category) acc.categories.add(category);
    }
  }

  return clusters;
}

// ════════════════════════════════════════════════════════════════════════════════
// ROOT CAUSE HIERARCHY  (4 levels — always present)
// ════════════════════════════════════════════════════════════════════════════════

const ROOT_CAUSE_TEMPLATES: Record<CausalCategory, BottleneckOutput['root_cause_hierarchy']> = {
  manual_dependency: {
    level_1_symptom: 'Team spends excessive time on repetitive, low-value tasks',
    level_2_process_failure: 'No automated workflows exist for repeatable operations',
    level_3_architecture_failure: 'Systems lack integration — data must be moved manually between tools',
    level_4_governance_failure: 'No automation-first mandate in operational design; processes grew organically without system thinking',
  },
  tool_fragmentation: {
    level_1_symptom: 'Data is inconsistent, duplicated, or unavailable across teams',
    level_2_process_failure: 'Each team adopted tools independently with no integration plan',
    level_3_architecture_failure: 'No unified data layer or middleware connecting core systems',
    level_4_governance_failure: 'No technology governance or integration standards — tool adoption is unmanaged',
  },
  governance_bottleneck: {
    level_1_symptom: 'Decisions, approvals, and escalations queue behind one or two people',
    level_2_process_failure: 'No delegation framework or decision authority matrix exists',
    level_3_architecture_failure: 'No workflow automation for approvals; every decision requires manual intervention',
    level_4_governance_failure: 'Organizational design concentrates authority rather than distributing it — no empowerment model',
  },
  revenue_leakage: {
    level_1_symptom: 'Revenue is lost through missed follow-ups, abandoned processes, or unrecovered opportunities',
    level_2_process_failure: 'No systematic lifecycle management (acquisition → retention → expansion)',
    level_3_architecture_failure: 'CRM, marketing, and support systems are disconnected — no unified customer view',
    level_4_governance_failure: 'No revenue operations discipline — customer lifecycle is not treated as a managed system',
  },
  scalability_risk: {
    level_1_symptom: 'Operations degrade or break under moderate volume increases',
    level_2_process_failure: 'Processes are person-dependent and cannot absorb variability',
    level_3_architecture_failure: 'No elastic capacity — systems are sized for current load with no headroom',
    level_4_governance_failure: 'No scalability planning or stress-testing in operational design',
  },
  data_integrity: {
    level_1_symptom: 'Data is frequently incorrect, stale, or contradictory across systems',
    level_2_process_failure: 'No data validation, reconciliation, or single-source-of-truth process',
    level_3_architecture_failure: 'Multiple systems hold overlapping data with no sync mechanism',
    level_4_governance_failure: 'No data governance framework — ownership, quality, and access are unmanaged',
  },
};

// ════════════════════════════════════════════════════════════════════════════════
// CAUSAL CHAIN TEMPLATES (5-element array)
// ════════════════════════════════════════════════════════════════════════════════

const CAUSAL_CHAIN_TEMPLATES: Record<CausalCategory, BottleneckOutput['causal_chain']> = {
  manual_dependency: [
    'Team members spend hours daily on repetitive data entry and task handoffs',
    'Error rates climb as volume increases — rework consumes additional capacity',
    'Team morale drops; high-value employees spend time on low-value tasks',
    'Hiring is required to cover capacity that should be automated — margin compression begins',
    'Operations cannot absorb growth; customer experience and delivery quality collapse',
  ],
  tool_fragmentation: [
    'Data enters multiple disconnected systems with no synchronization',
    'Teams work on conflicting or stale data — decisions are made on incomplete information',
    'Cross-functional coordination breaks down; departments operate in silos',
    'Duplicate data creates compliance risk and customer-facing inconsistencies',
    'No single source of truth exists — organization loses ability to make data-driven decisions',
  ],
  governance_bottleneck: [
    'All non-trivial decisions require founder/leader sign-off',
    'Decision queue grows — team velocity drops as they wait for approvals',
    'Team stops taking initiative; learned helplessness reduces operational agility',
    'Leader becomes overwhelmed — quality of decisions degrades under volume pressure',
    'Organization cannot scale beyond the bandwidth of one or two decision-makers',
  ],
  revenue_leakage: [
    'Customer lifecycle touchpoints are not systematically managed',
    'Leads go cold, follow-ups are missed, and at-risk customers are not flagged',
    'Acquisition costs rise while retention rates decline — unit economics worsen',
    'Competitor capture increases as unengaged customers drift away',
    'Revenue growth stalls despite marketing spend — the business leaks faster than it acquires',
  ],
  scalability_risk: [
    'Current processes are manually executed by specific individuals',
    'Volume increase causes immediate quality degradation and missed deadlines',
    'Team operates in firefighting mode — no capacity for strategic work or improvement',
    'Customer experience suffers — response times spike, errors multiply',
    'Operational collapse under moderate growth — forced to turn away business or accept churn',
  ],
  data_integrity: [
    'Data is entered inconsistently across multiple systems without validation',
    'Reports and dashboards show conflicting numbers — trust in data erodes',
    'Decision-makers rely on gut feeling instead of data — strategic blind spots form',
    'Compliance and audit risk increases as data trail becomes unreliable',
    'Organization cannot build AI or advanced analytics on a foundation of unreliable data',
  ],
};

// ════════════════════════════════════════════════════════════════════════════════
// STRESS SIMULATION — deterministic rules
// ════════════════════════════════════════════════════════════════════════════════

function simulateStress(
  causalCat: CausalCategory,
  cluster: ClusterAccumulator,
): BottleneckOutput['stress_simulation'] {
  const intensity = cluster.totalWeight;

  const templates: Record<CausalCategory, BottleneckOutput['stress_simulation']> = {
    manual_dependency: {
      growth_20_percent: 'Manual task volume increases proportionally. Team overtime required within 2 weeks. Error rates spike 2x.',
      growth_30_percent: 'Manual processes collapse — error rates spike 3-5x. Team cannot maintain quality and speed simultaneously.',
      founder_absence: 'Undocumented manual processes halt. No one can replicate the founder\'s specific workflow or tribal knowledge.',
      system_failure: 'No fallback for manual workflows — single tool failure creates complete stoppage across dependent processes.',
    },
    tool_fragmentation: {
      growth_20_percent: 'Data sync delays multiply. Teams work on stale or conflicting information, causing downstream errors.',
      growth_30_percent: 'Cross-system data gaps become critical. Decisions are made on wrong data. Customer-facing errors emerge.',
      founder_absence: 'Institutional knowledge of system workarounds is lost. Team cannot bridge integration gaps without guidance.',
      system_failure: 'Single tool failure cascades across all dependent systems. No automated failover or data recovery path exists.',
    },
    governance_bottleneck: {
      growth_20_percent: 'Decision queue lengthens by 40%+. Approval wait times double. Team velocity drops proportionally.',
      growth_30_percent: `Founder/leader becomes critical bottleneck — ${intensity > 5 ? 'team velocity drops to near-zero' : 'significant delays across all functions'}.`,
      founder_absence: 'All decisions halt. No delegation framework means complete operational pause. Revenue-impacting decisions go unmade.',
      system_failure: 'No automated approval routing. Manual escalation is the only path. Weekend/off-hours incidents go unresolved.',
    },
    revenue_leakage: {
      growth_20_percent: 'More leads enter broken funnel — leakage rate stays constant but absolute dollar loss grows proportionally.',
      growth_30_percent: 'Acquisition cost rises faster than revenue. Unit economics deteriorate as funnel efficiency drops.',
      founder_absence: 'No one monitors or optimizes revenue recovery flows. Losses accelerate unnoticed for weeks.',
      system_failure: 'Email/CRM/marketing tool failure means zero recovery on all abandoned opportunities during downtime.',
    },
    scalability_risk: {
      growth_20_percent: `Service quality degrades immediately. Response times, error rates, and throughput all suffer within ${intensity > 8 ? '1 week' : '2-3 weeks'}.`,
      growth_30_percent: 'Cascade failure. Support, fulfillment, and operations break in sequence. Customer churn accelerates.',
      founder_absence: 'No one can make triage decisions during scale stress. Priorities become unclear. Team defaults to firefighting.',
      system_failure: 'No redundancy in critical path. Single failure causes disproportionate impact across the entire operation.',
    },
    data_integrity: {
      growth_20_percent: 'Data discrepancy frequency increases linearly. More transactions = more sync failures. Reconciliation becomes full-time work.',
      growth_30_percent: 'Decision-making quality degrades. Leaders act on unreliable data. Strategic errors compound.',
      founder_absence: 'No one knows which data source is authoritative. Team freezes on decisions requiring data confidence.',
      system_failure: 'Data reconciliation becomes impossible. No automated integrity checks. Financial reporting becomes unreliable.',
    },
  };

  return templates[causalCat];
}

// ════════════════════════════════════════════════════════════════════════════════
// QUANTIFICATION MODEL — derived from inputs, not guessed
// ════════════════════════════════════════════════════════════════════════════════

interface QuantificationInputs {
  avgMaturity: number;        // 1-5
  clusterWeight: number;
  employeeEstimate: number;
  hourlyRate: number;
}

function quantifyImpact(cat: CausalCategory, inputs: QuantificationInputs): BottleneckOutput['quantified_impact'] {
  const { clusterWeight, avgMaturity, employeeEstimate, hourlyRate } = inputs;

  // Maturity inversely affects waste
  const maturityMultiplier = Math.max(0.3, (6 - avgMaturity) / 5);
  const hoursPerWeek = Math.round(clusterWeight * 2.5 * maturityMultiplier);
  const annualPayrollWaste = Math.round(hoursPerWeek * hourlyRate * 50);

  // Revenue leakage
  const revLeakBase = clusterWeight * 8000 * maturityMultiplier;
  const revLeakEstimate = Math.round(revLeakBase * (cat === 'revenue_leakage' ? 1.8 : 1.0));

  // Growth ceiling
  const ceilingPct = Math.max(5, Math.round(25 * maturityMultiplier));

  return {
    revenue_leakage_estimate: revLeakEstimate,
    payroll_inflation_risk: annualPayrollWaste,
    time_waste_hours_per_week: hoursPerWeek,
    growth_ceiling_percent: ceilingPct,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// INTERVENTION TEMPLATES
// ════════════════════════════════════════════════════════════════════════════════

const INTERVENTION_TEMPLATES: Record<CausalCategory, BottleneckOutput['intervention_path']> = {
  manual_dependency: {
    short_term: 'Identify and automate the top 3-5 highest-volume manual tasks using workflow automation tools (Zapier, Make, or custom scripts).',
    mid_term: 'Build system-to-system integrations eliminating manual data transfer. Implement automated notifications and handoffs.',
    structural_redesign: 'Deploy AI-assisted process automation for complex decision-support tasks. Build self-optimizing workflows with feedback loops. Eliminate human-in-the-loop for all repeatable operations.',
  },
  tool_fragmentation: {
    short_term: 'Audit current tool stack and map data flows. Identify critical integration gaps between top 3 most-used systems.',
    mid_term: 'Implement middleware/integration layer connecting core systems. Establish single source of truth for key data domains.',
    structural_redesign: 'Build unified data platform with real-time sync, automated reconciliation, cross-system analytics, and API-first architecture enabling any future tool to plug in without custom work.',
  },
  governance_bottleneck: {
    short_term: 'Create decision authority matrix — define what decisions can be made at each level without escalation.',
    mid_term: 'Implement automated approval workflows with delegation rules, escalation thresholds, and audit trails.',
    structural_redesign: 'Build decision intelligence system with AI-assisted recommendations, autonomous delegation for routine decisions, and real-time dashboards replacing approval queues with outcome monitoring.',
  },
  revenue_leakage: {
    short_term: 'Activate automated recovery flows for abandoned processes (carts, follow-ups, renewals). Quick-win retention triggers.',
    mid_term: 'Build customer lifecycle automation — segmented nurture sequences, proactive churn prevention, and expansion triggers.',
    structural_redesign: 'Implement predictive revenue intelligence — churn scoring, LTV optimization, automated revenue operations, and closed-loop attribution connecting every touchpoint to revenue outcomes.',
  },
  scalability_risk: {
    short_term: 'Document and standardize top 5 most-fragile processes. Create runbooks for high-volume scenarios.',
    mid_term: 'Build elastic operational capacity — automated scaling for customer-facing processes, load balancing, and surge handling.',
    structural_redesign: 'Implement predictive capacity planning — AI models that forecast demand, pre-allocate resources before bottlenecks form, and automatically redistribute workload under stress.',
  },
  data_integrity: {
    short_term: 'Establish data ownership for each domain. Implement basic validation rules and reconciliation checks.',
    mid_term: 'Build automated data quality monitoring with alerts. Create master data management process.',
    structural_redesign: 'Deploy data governance platform with automated lineage tracking, quality scoring, self-healing data pipelines, and real-time integrity monitoring across all systems.',
  },
};

// ════════════════════════════════════════════════════════════════════════════════
// CONFIDENCE LAYER BUILDER
// ════════════════════════════════════════════════════════════════════════════════

function buildConfidenceLayer(
  annotated: AnnotatedResponse[],
): ConfidenceLayerOutput {
  const totalSignals = annotated.reduce((sum, a) => sum + a.detectedSignals.length, 0);

  // Contradiction: answers with both strength and pain signals
  let contradictions = 0;
  for (const resp of annotated) {
    const hasStrength = resp.detectedSignals.some(s => s.type === 'strength');
    const hasPain = resp.detectedSignals.some(s => s.type === 'pain');
    if (hasStrength && hasPain) contradictions++;
  }

  // Weak signals: answers with only low-confidence signals or too short
  let weakFlags = 0;
  for (const resp of annotated) {
    const allLow = resp.detectedSignals.length > 0 && resp.detectedSignals.every(s => s.confidence === 'low');
    if (allLow) weakFlags++;
    if (resp.answer.length < 50 && resp.detectedSignals.length === 0) weakFlags++;
  }

  // Corroboration: signal labels confirmed by 2+ answers
  const labelCounts: Record<string, number> = {};
  for (const resp of annotated) {
    const seen = new Set<string>();
    for (const sig of resp.detectedSignals) {
      if (!seen.has(sig.label)) {
        seen.add(sig.label);
        labelCounts[sig.label] = (labelCounts[sig.label] || 0) + 1;
      }
    }
  }
  const corroborated = Object.values(labelCounts).filter(c => c >= 2).length;

  // Composite confidence
  const signalDensity = annotated.length > 0 ? totalSignals / annotated.length : 0;
  const densityScore = Math.min(40, signalDensity * 15);
  const corrobScore = Math.min(30, corroborated * 5);
  const contradictionPenalty = contradictions * 5;
  const weakPenalty = weakFlags * 3;
  const coverageScore = Math.min(30, (annotated.length / 14) * 30);

  const overall = Math.max(10, Math.min(100, Math.round(
    densityScore + corrobScore + coverageScore - contradictionPenalty - weakPenalty
  )));

  return {
    total_signals_detected: totalSignals,
    corroborated_patterns: corroborated,
    contradiction_flags: contradictions,
    weak_signal_flags: weakFlags,
    ai_confidence_score: parseFloat((overall / 100).toFixed(2)),  // 0-1 float per v1 spec
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN ENGINE — runDiagnosticEngine()
// ════════════════════════════════════════════════════════════════════════════════

export interface DiagnosticEngineInput {
  annotatedResponses: AnnotatedResponse[];
  company: string;
  industry: string;
  employeeEstimate: number;
  pillarHeatmap: PillarHeatmap;
}

export function runDiagnosticEngine(input: DiagnosticEngineInput): DiagnosticOutput {
  const { annotatedResponses, company, employeeEstimate, pillarHeatmap } = input;

  // ── Causal classification of every answer ──
  const classifications = annotatedResponses.map(resp =>
    classifyAnswer(resp.questionId, resp.answer)
  );

  // ── Pattern aggregation ──
  const clusters = aggregatePatterns(classifications, annotatedResponses);

  // ── Sort clusters by weight (highest = primary) ──
  const sortedClusters = [...clusters.entries()]
    .sort((a, b) => b[1].totalWeight - a[1].totalWeight);

  // ── Confidence layer ──
  const confidence = buildConfidenceLayer(annotatedResponses);

  // ── Derived metrics ──
  const avgMaturity = annotatedResponses.length > 0
    ? annotatedResponses.reduce((s, r) => s + r.maturityIndicator, 0) / annotatedResponses.length
    : 3;
  const hourlyRate = employeeEstimate > 200 ? 95 : employeeEstimate > 50 ? 75 : 55;

  // ── Bottlenecks (top 3) ──
  const CAUSAL_TITLES: Record<CausalCategory, string> = {
    manual_dependency: 'Manual Operations & Process Dependency',
    tool_fragmentation: 'Tool Fragmentation & Data Silos',
    governance_bottleneck: 'Leadership Dependency & Approval Bottleneck',
    revenue_leakage: 'Revenue Leakage & Retention Deficit',
    scalability_risk: 'Scalability Constraint & Operational Fragility',
    data_integrity: 'Data Integrity & Visibility Failure',
  };

  const bottlenecks: BottleneckOutput[] = sortedClusters.slice(0, 3).map(([cat, cluster], idx) => {
    const qInputs: QuantificationInputs = {
      avgMaturity,
      clusterWeight: cluster.totalWeight,
      employeeEstimate,
      hourlyRate,
    };

    const supportingQs: BottleneckOutput['supporting_questions'] = [...cluster.questionIds].map(qId => {
      const resp = annotatedResponses.find(a => a.questionId === qId);
      if (!resp) return null;
      const excerpt = resp.answer.length > 200 ? resp.answer.substring(0, 197) + '...' : resp.answer;
      const topSignal = resp.detectedSignals[0];
      const rootCause = ROOT_CAUSE_TEMPLATES[cat];
      return {
        question_id: `Q${qId}`,
        client_answer: excerpt,
        ai_interpretation: topSignal
          ? `Detected ${topSignal.type} signal: ${topSignal.label} (${topSignal.confidence} confidence). ${
              resp.detectedSignals.length > 1 ? `Plus ${resp.detectedSignals.length - 1} additional signals.` : ''
            }`
          : 'Answer provides contextual evidence but no strong keyword signals detected.',
        structural_implication: rootCause.level_2_process_failure,
      };
    }).filter(Boolean) as BottleneckOutput['supporting_questions'];

    return {
      id: `B${idx + 1}`,
      title: CAUSAL_TITLES[cat] || cat,
      severity: (idx === 0 ? 'Critical' : idx === 1 ? 'High' : 'Moderate') as BottleneckOutput['severity'],
      category: CAUSAL_TO_BOTTLENECK_CATEGORY[cat],
      pattern_strength: cluster.totalWeight,
      causal_chain: CAUSAL_CHAIN_TEMPLATES[cat],
      stress_simulation: simulateStress(cat, cluster),
      root_cause_hierarchy: ROOT_CAUSE_TEMPLATES[cat],
      quantified_impact: quantifyImpact(cat, qInputs),
      intervention_path: INTERVENTION_TEMPLATES[cat],
      supporting_questions: supportingQs,
    };
  });

  // ── Systemic patterns ──
  const PATTERN_LABELS: Record<CausalCategory, string> = {
    manual_dependency: 'Manual dependency signals detected across multiple workflows',
    tool_fragmentation: 'Tool fragmentation creating data silos between departments',
    governance_bottleneck: 'Leadership approval bottleneck constraining team velocity',
    revenue_leakage: 'Revenue leakage through unmanaged customer lifecycle gaps',
    scalability_risk: 'Scale-breaking risk confirmed across operational domains',
    data_integrity: 'Data integrity failures undermining decision quality',
  };

  const CASCADE_POTENTIALS: Record<CausalCategory, string> = {
    manual_dependency: 'Manual errors compound downstream into fulfillment, billing, and customer experience failures',
    tool_fragmentation: 'Disconnected systems create cascading data inconsistencies across all dependent processes',
    governance_bottleneck: 'Approval delays cascade into missed deadlines, lost opportunities, and team disengagement',
    revenue_leakage: 'Unrecovered revenue compounds — each lost customer also means lost referrals and brand damage',
    scalability_risk: 'Operational fragility cascades from customer-facing operations into team morale and retention',
    data_integrity: 'Bad data cascades into wrong decisions, wrong forecasts, and wrong resource allocation',
  };

  const systemic_patterns: SystemicPatternOutput[] = sortedClusters.map(([cat, cluster]) => ({
    pattern_name: PATTERN_LABELS[cat] || cat,
    severity: (cluster.totalWeight >= 8 ? 'High' : cluster.totalWeight >= 4 ? 'Moderate' : 'Low') as SystemicPatternOutput['severity'],
    signal_count: cluster.questionIds.size,
    cross_departmental_presence: cluster.categories.size >= 2,
    failure_cascade_potential: CASCADE_POTENTIALS[cat],
    recurrence_probability: parseFloat((Math.min(0.95, 0.40 + cluster.totalWeight * 0.08)).toFixed(2)),  // 0-1 float per v1 spec
  }));

  // ── Pillar matrix ──
  const pillar_matrix = buildPillarMatrix(pillarHeatmap, annotatedResponses);

  // ── Financial model (aggregated) ──
  const financial_model = buildFinancialModel(bottlenecks);

  // ── Risk model ──
  const risk_model = buildRiskModel(annotatedResponses, clusters);

  // ── Executive summary ──
  const impactMin = bottlenecks.reduce((s, bn) => s + bn.quantified_impact.revenue_leakage_estimate, 0);
  const impactMax = Math.round(impactMin * 1.6) + bottlenecks.reduce((s, bn) => s + bn.quantified_impact.payroll_inflation_risk, 0);

  const executive_summary: ExecutiveSummaryOutput = {
    readiness_score: Math.round(avgMaturity * 20),
    readiness_category: avgMaturity <= 1.5 ? 'Manual' : avgMaturity <= 2.5 ? 'Fragmented' : avgMaturity <= 3.5 ? 'Transitional' : 'Structured',
    primary_bottleneck_id: bottlenecks[0]?.id || 'B1',
    secondary_bottleneck_id: bottlenecks[1]?.id || 'B2',
    growth_risk_level: bottlenecks[0]?.severity === 'Critical' ? 'Critical'
      : bottlenecks[0]?.severity === 'High' ? 'High'
      : 'Moderate',
    estimated_annual_impact_range: { min: impactMin, max: impactMax },
    narrative_summary: buildNarrative(company, bottlenecks, confidence, avgMaturity),
    confidence_score: confidence.ai_confidence_score,
  };

  return {
    executive_summary,
    bottlenecks,
    systemic_patterns,
    pillar_matrix,
    financial_model,
    risk_model,
    confidence_layer: confidence,
  };
}

// ── Pillar matrix builder ─────────────────────────────────────────────────────

function buildPillarMatrix(
  heatmap: PillarHeatmap,
  annotated: AnnotatedResponse[],
): PillarMatrixOutput {
  const painByArea: Record<string, number> = { ops: 0, revenue: 0, systems: 0, governance: 0 };

  for (const resp of annotated) {
    const painCount = resp.detectedSignals.filter(s => s.type === 'pain').length;
    const cat = resp.category.toLowerCase();
    if (cat.includes('operation') || cat.includes('bottleneck') || cat.includes('production')) painByArea.ops += painCount;
    if (cat.includes('revenue') || cat.includes('leakage') || cat.includes('scale')) painByArea.revenue += painCount;
    if (cat.includes('system') || cat.includes('tool') || cat.includes('readiness')) painByArea.systems += painCount;
    if (cat.includes('intent') || cat.includes('outcome') || cat.includes('constraint')) painByArea.governance += painCount;
  }

  const buildEntry = (score: number, area: string, painCount: number): PillarEntryOutput => {
    let interpretation: string;
    let weakness: string;
    let automation: string;

    if (score >= 4) {
      interpretation = `${area} is relatively stable with documented processes and manageable workflows.`;
      weakness = painCount > 0 ? 'Minor optimization opportunities exist but are not critical.' : 'No dominant weakness detected.';
      automation = 'Focus on advanced AI and predictive capabilities — foundational automation is in place.';
    } else if (score >= 2) {
      interpretation = `${area} functions but shows structural weaknesses that compound under growth pressure.`;
      weakness = `${painCount} pain signals detected — manual processes and coordination gaps are the primary drag.`;
      automation = 'High leverage — workflow automation and system integration would yield immediate capacity gains.';
    } else {
      interpretation = `${area} is critically under-built. Heavy manual dependency and no systematic processes.`;
      weakness = `${painCount} pain signals — near-zero automation, high error rates, and person-dependent operations.`;
      automation = 'Maximum leverage — even basic automation would transform throughput. Start with highest-volume tasks.';
    }

    return { score, interpretation, dominant_weakness: weakness, automation_leverage_potential: automation };
  };

  return {
    operations: buildEntry(heatmap.operationsExecution, 'Operations & Execution', painByArea.ops),
    revenue: buildEntry(heatmap.revenueGrowth, 'Revenue & Growth', painByArea.revenue),
    systems: buildEntry(heatmap.systemsAutomation, 'Systems & Automation', painByArea.systems),
    governance: buildEntry(heatmap.aiReadinessGovernance, 'AI Readiness & Governance', painByArea.governance),
  };
}

// ── Financial model builder ───────────────────────────────────────────────────

function buildFinancialModel(bottlenecks: BottleneckOutput[]): FinancialModelOutput {
  const directRevLeakage = bottlenecks.reduce((s, bn) => s + bn.quantified_impact.revenue_leakage_estimate, 0);
  const payrollWaste = bottlenecks.reduce((s, bn) => s + bn.quantified_impact.payroll_inflation_risk, 0);
  const weeklyHours = bottlenecks.reduce((s, bn) => s + bn.quantified_impact.time_waste_hours_per_week, 0);
  const hiddenDrag = Math.round(payrollWaste * 0.35); // hidden overhead on top of direct payroll waste
  const opportunityCost = Math.round(directRevLeakage * 0.5); // revenue that could have been earned
  const growthTax = Math.round((directRevLeakage + payrollWaste) * 0.15); // compounding cost of delay

  return {
    direct_revenue_leakage: directRevLeakage,
    hidden_operational_drag: hiddenDrag,
    payroll_misallocation: payrollWaste,
    opportunity_cost: opportunityCost,
    compounding_growth_tax: growthTax,
    total_estimated_annual_impact: directRevLeakage + hiddenDrag + payrollWaste + opportunityCost + growthTax,
  };
}

// ── Risk model builder ────────────────────────────────────────────────────────

function buildRiskModel(
  annotated: AnnotatedResponse[],
  clusters: Map<CausalCategory, ClusterAccumulator>,
): RiskEntryOutput[] {
  const risks: RiskEntryOutput[] = [];

  // Scalability
  const scalCluster = clusters.get('scalability_risk');
  if (scalCluster && scalCluster.totalWeight >= 2) {
    risks.push({
      risk_type: 'Scalability',
      severity: scalCluster.totalWeight >= 6 ? 'Critical' : scalCluster.totalWeight >= 3 ? 'High' : 'Moderate',
      trigger_threshold: '+20% volume increase or new client onboarding surge',
      probability_percent: Math.min(90, 40 + scalCluster.totalWeight * 8),
      time_to_failure_estimate: scalCluster.totalWeight >= 8 ? '2-4 weeks under sustained pressure' : '4-8 weeks under growth',
      cascade_path: 'Operations → Customer Experience → Revenue → Team Morale → Retention',
    });
  }

  // Data
  const dataCluster = clusters.get('data_integrity');
  const toolCluster = clusters.get('tool_fragmentation');
  const dataWeight = (dataCluster?.totalWeight || 0) + (toolCluster?.totalWeight || 0);
  if (dataWeight >= 2) {
    risks.push({
      risk_type: 'Data',
      severity: dataWeight >= 8 ? 'Critical' : dataWeight >= 4 ? 'High' : 'Moderate',
      trigger_threshold: 'New system integration, data migration, or audit request',
      probability_percent: Math.min(85, 35 + dataWeight * 6),
      time_to_failure_estimate: dataWeight >= 6 ? '2-4 weeks before critical data error' : '4-8 weeks before inconsistencies impact decisions',
      cascade_path: 'Data Quality → Decision Quality → Strategic Misalignment → Revenue Impact',
    });
  }

  // Dependency
  const govCluster = clusters.get('governance_bottleneck');
  if (govCluster && govCluster.totalWeight >= 2) {
    risks.push({
      risk_type: 'Dependency',
      severity: govCluster.totalWeight >= 6 ? 'Critical' : govCluster.totalWeight >= 3 ? 'High' : 'Moderate',
      trigger_threshold: 'Leader vacation, illness, or simultaneous multi-project demand',
      probability_percent: Math.min(95, 50 + govCluster.totalWeight * 7),
      time_to_failure_estimate: govCluster.totalWeight >= 5 ? '1-3 weeks during leader absence' : '3-6 weeks under sustained pressure',
      cascade_path: 'Decision Delay → Team Paralysis → Customer Impact → Revenue Stall',
    });
  }

  // Compliance
  const hasUndocumented = annotated.some(r =>
    r.detectedSignals.some(s => s.label.includes('Undocumented') || s.label.includes('documentation'))
  );
  if (hasUndocumented || (dataWeight >= 3)) {
    risks.push({
      risk_type: 'Compliance',
      severity: hasUndocumented && dataWeight >= 4 ? 'High' : 'Moderate',
      trigger_threshold: 'Audit request, new regulation, or employee departure exposing undocumented processes',
      probability_percent: Math.min(75, 30 + (hasUndocumented ? 20 : 0) + dataWeight * 5),
      time_to_failure_estimate: '1-3 months before compliance gap creates liability',
      cascade_path: 'Undocumented Processes → Knowledge Loss → Inconsistent Execution → Regulatory Exposure',
    });
  }

  // Always return at least one risk
  if (risks.length === 0) {
    risks.push({
      risk_type: 'Scalability',
      severity: 'Moderate',
      trigger_threshold: 'Next growth phase or operational expansion',
      probability_percent: 45,
      time_to_failure_estimate: '6-12 months at current trajectory',
      cascade_path: 'Growth Pressure → Process Strain → Quality Degradation → Customer Impact',
    });
  }

  return risks;
}

// ── Narrative builder ─────────────────────────────────────────────────────────

function buildNarrative(
  company: string,
  bottlenecks: BottleneckOutput[],
  confidence: ConfidenceLayerOutput,
  avgMaturity: number,
): string {
  const primary = bottlenecks[0];
  const secondary = bottlenecks[1];

  const maturityDesc = avgMaturity <= 1.5 ? 'highly manual, reactive mode'
    : avgMaturity <= 2.5 ? 'a fragmented operational state with partial automation'
    : avgMaturity <= 3.5 ? 'a transitional state with some structured processes but significant gaps'
    : 'a moderately structured environment with automation opportunities';

  let narrative = `${company} operates in ${maturityDesc}. `;

  if (primary) {
    narrative += `The primary constraint is ${primary.title.toLowerCase()}, with ${primary.supporting_questions.length} corroborating answers and pattern strength of ${primary.pattern_strength}. `;
  }

  if (secondary) {
    narrative += `This is compounded by ${secondary.title.toLowerCase()}, creating a reinforcing loop that limits growth capacity. `;
  }

  if (primary?.quantified_impact) {
    narrative += `Estimated revenue leakage: $${(primary.quantified_impact.revenue_leakage_estimate / 1000).toFixed(0)}K/yr. `;
  }

  if (confidence.ai_confidence_score < 0.50) {
    narrative += `Note: Analysis confidence is moderate (${Math.round(confidence.ai_confidence_score * 100)}%) — some answers were sparse or ambiguous. Recommend validation on call.`;
  } else {
    const confPctNarr = Math.round(confidence.ai_confidence_score * 100);
    narrative += `Analysis confidence is ${confidence.ai_confidence_score >= 0.80 ? 'high' : 'solid'} at ${confPctNarr}%, supported by ${confidence.corroborated_patterns} corroborated signal patterns.`;
  }

  return narrative;
}

// ════════════════════════════════════════════════════════════════════════════════
// ADAPTER — Convert DiagnosticOutput → UI component props
// ════════════════════════════════════════════════════════════════════════════════

import type {
  ExecutiveOverview,
  BottleneckDeepDive,
  SystemicPattern,
  PillarInterpretations,
  FinancialEfficiencyModel,
  EnhancedRiskFlag,
  ConfidenceLayer,
  RecommendationExpectedImpact,
  RecommendationInvestmentSummary,
} from '@/app/types/cortex-types';

export function adaptOutputToUITypes(output: DiagnosticOutput): {
  executiveOverview: ExecutiveOverview;
  bottleneckDeepDives: BottleneckDeepDive[];
  systemicPatterns: SystemicPattern[];
  pillarInterpretations: PillarInterpretations;
  financialModel: FinancialEfficiencyModel;
  enhancedRisks: EnhancedRiskFlag[];
  confidenceLayer: ConfidenceLayer;
} {
  const es = output.executive_summary;
  const fm = output.financial_model;

  // Executive Overview
  const confPct = Math.round(es.confidence_score * 100); // convert 0-1 → percentage for display
  const executiveOverview: ExecutiveOverview = {
    readinessScore: es.readiness_score,
    readinessCategory: es.readiness_category,
    confidenceLevel: `${confPct >= 80 ? 'High' : confPct >= 50 ? 'Medium' : 'Low'} (${confPct}%)`,
    growthRiskIndicator: es.growth_risk_level === 'Critical' ? 'Critical'
      : es.growth_risk_level === 'High' ? 'Elevated'
      : es.growth_risk_level === 'Moderate' ? 'Moderate'
      : 'Low',
    primaryBottleneckTheme: output.bottlenecks[0]?.title || 'Insufficient data',
    primaryBottleneckId: es.primary_bottleneck_id,
    secondaryBottleneck: output.bottlenecks[1]?.title || 'N/A',
    secondaryBottleneckId: es.secondary_bottleneck_id,
    estimatedAnnualImpactRange: `$${(es.estimated_annual_impact_range.min / 1000).toFixed(0)}K–$${(es.estimated_annual_impact_range.max / 1000).toFixed(0)}K`,
    summaryNarrative: es.narrative_summary,
    confidenceScore: confPct,
  };

  // Bottleneck Deep Dives
  const bottleneckDeepDives: BottleneckDeepDive[] = output.bottlenecks.map(bn => ({
    id: bn.id,
    title: bn.title,
    severity: bn.severity,
    category: bn.category,
    patternStrength: bn.pattern_strength,
    causalChain: bn.causal_chain,
    stressSimulation: bn.stress_simulation,
    rootCauseHierarchy: bn.root_cause_hierarchy,
    quantifiedImpact: bn.quantified_impact,
    intervention: bn.intervention_path,
    evidence: bn.supporting_questions.map(sq => ({
      questionRef: sq.question_id,
      questionId: parseInt(sq.question_id.replace('Q', ''), 10) || 0,
      clientExcerpt: sq.client_answer,
      aiInterpretation: sq.ai_interpretation,
      structuralImplication: sq.structural_implication,
    })),
    bottleneckId: bn.id,
  }));

  // Systemic Patterns
  const systemicPatterns: SystemicPattern[] = output.systemic_patterns.map(sp => ({
    patternName: sp.pattern_name,
    severity: sp.severity,
    signalCount: sp.signal_count,
    crossDepartmentalPresence: sp.cross_departmental_presence,
    failureCascadePotential: sp.failure_cascade_potential,
    recurrenceProbability: sp.recurrence_probability,
  }));

  // Pillar Interpretations
  const pillarInterpretations: PillarInterpretations = {
    operationsExecution: {
      interpretation: output.pillar_matrix.operations.interpretation,
      dominantWeakness: output.pillar_matrix.operations.dominant_weakness,
      automationLeveragePotential: output.pillar_matrix.operations.automation_leverage_potential,
    },
    revenueGrowth: {
      interpretation: output.pillar_matrix.revenue.interpretation,
      dominantWeakness: output.pillar_matrix.revenue.dominant_weakness,
      automationLeveragePotential: output.pillar_matrix.revenue.automation_leverage_potential,
    },
    systemsAutomation: {
      interpretation: output.pillar_matrix.systems.interpretation,
      dominantWeakness: output.pillar_matrix.systems.dominant_weakness,
      automationLeveragePotential: output.pillar_matrix.systems.automation_leverage_potential,
    },
    aiReadinessGovernance: {
      interpretation: output.pillar_matrix.governance.interpretation,
      dominantWeakness: output.pillar_matrix.governance.dominant_weakness,
      automationLeveragePotential: output.pillar_matrix.governance.automation_leverage_potential,
    },
  };

  // Financial Model
  const formatK = (n: number) => `$${(n / 1000).toFixed(0)}K`;
  const financialModel: FinancialEfficiencyModel = {
    directRevenuLeakage: fm.direct_revenue_leakage,
    hiddenOperationalDrag: fm.hidden_operational_drag,
    payrollMisallocation: fm.payroll_misallocation,
    opportunityCost: fm.opportunity_cost,
    compoundingGrowthTax: fm.compounding_growth_tax,
    totalEstimatedAnnualImpact: fm.total_estimated_annual_impact,
    // Formatted strings for UI convenience
    directRevenuLeakageFormatted: formatK(fm.direct_revenue_leakage),
    hiddenOperationalDragFormatted: formatK(fm.hidden_operational_drag),
    payrollMisallocationFormatted: formatK(fm.payroll_misallocation),
    opportunityCostFormatted: formatK(fm.opportunity_cost),
    compoundingGrowthTaxFormatted: formatK(fm.compounding_growth_tax),
    totalEstimatedAnnualImpactFormatted: formatK(fm.total_estimated_annual_impact),
  };

  // Enhanced Risks
  const enhancedRisks: EnhancedRiskFlag[] = output.risk_model.map(r => ({
    riskType: r.risk_type,
    severity: r.severity,
    triggerThreshold: r.trigger_threshold,
    probabilityPercent: r.probability_percent,
    timeToFailureEstimate: r.time_to_failure_estimate,
    cascadePath: r.cascade_path,
  }));

  // Confidence Layer
  const confidenceLayer: ConfidenceLayer = {
    totalSignalsDetected: output.confidence_layer.total_signals_detected,
    corroboratedPatterns: output.confidence_layer.corroborated_patterns,
    contradictionFlags: output.confidence_layer.contradiction_flags,
    weakSignalFlags: output.confidence_layer.weak_signal_flags,
    aiConfidenceScore: output.confidence_layer.ai_confidence_score,
  };

  return {
    executiveOverview,
    bottleneckDeepDives,
    systemicPatterns,
    pillarInterpretations,
    financialModel,
    enhancedRisks,
    confidenceLayer,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// EMPLOYEE COUNT ESTIMATOR
// ════════════════════════════════════════════════════════════════════════════════

export function estimateEmployees(sizeString: string): number {
  if (!sizeString) return 25;
  const lower = sizeString.toLowerCase();
  if (lower.includes('1-10') || lower.includes('1 -') || lower.includes('solo') || lower.includes('micro')) return 5;
  if (lower.includes('11-50') || lower.includes('11 -') || lower.includes('small')) return 30;
  if (lower.includes('51-200') || lower.includes('51 -') || lower.includes('medium')) return 100;
  if (lower.includes('201-500') || lower.includes('201 -')) return 350;
  if (lower.includes('500') || lower.includes('enterprise') || lower.includes('large')) return 750;
  return 25;
}

// ════════════════════════════════════════════════════════════════════════════════
// RECOMMENDATION ENGINE — v1 Schema-Locked
// ════════════════════════════════════════════════════════════════════════════════
//
// Deterministic layer that converts DiagnosticOutput into v1 recommendation
// fields: confidenceScore, expectedImpact, implementationWindowDays, investmentSummary.
// Plugs into adaptOutputToUITypes alongside the diagnostic adapter.
//

export interface RecommendationEngineOutput {
  confidenceScore: number;          // 0-1 float
  expectedImpact: RecommendationExpectedImpact;
  implementationWindowDays: number;
  investmentSummary: RecommendationInvestmentSummary;
}

/**
 * Builds v1 recommendation metrics from the diagnostic output.
 * Called after runDiagnosticEngine(); merged into the ServiceRecommendation
 * object by cortexDataGenerator.ts.
 */
export function buildRecommendationV1(output: DiagnosticOutput, employeeEstimate: number): RecommendationEngineOutput {
  const primary = output.bottlenecks[0];
  const fm = output.financial_model;
  const conf = output.confidence_layer;

  // ── Confidence score ──
  // Weighted blend: diagnostic AI confidence (60%), severity gap between B1/B2 (25%), data completeness (15%)
  const severityRank = { Critical: 3, High: 2, Moderate: 1 };
  const b1Rank = severityRank[primary?.severity || 'Moderate'] || 1;
  const b2Rank = severityRank[output.bottlenecks[1]?.severity || 'Moderate'] || 1;
  const gapBonus = (b1Rank - b2Rank) >= 1 ? 0.10 : 0; // clear winner → higher confidence
  const signalDensity = Math.min(1, conf.total_signals_detected / 50);

  const recConfidence = Math.min(0.98, parseFloat(
    (conf.ai_confidence_score * 0.60 + (0.5 + gapBonus) * 0.25 + signalDensity * 0.15).toFixed(2)
  ));

  // ── Expected impact ──
  const totalImpact = fm.total_estimated_annual_impact;
  const revenueLift = Math.round(Math.min(35, (fm.direct_revenue_leakage / Math.max(1, totalImpact)) * 40 + 5));
  const costReduction = Math.round(Math.min(30, (fm.payroll_misallocation / Math.max(1, totalImpact)) * 35 + 5));
  const hoursPerWeek = output.bottlenecks.reduce((s, bn) => s + bn.quantified_impact.time_waste_hours_per_week, 0);
  const timeSaved = Math.round(hoursPerWeek * 0.6); // 60% recoverable via automation

  // ── Implementation window ──
  // Larger companies & more bottlenecks → longer window
  const baseWindow = primary?.severity === 'Critical' ? 30 : primary?.severity === 'High' ? 45 : 60;
  const sizeAdj = employeeEstimate > 200 ? 30 : employeeEstimate > 50 ? 15 : 0;
  const implementationWindowDays = baseWindow + sizeAdj;

  // ── Investment summary ──
  const costMultiplier = employeeEstimate > 200 ? 3 : employeeEstimate > 50 ? 2 : 1;
  const baseLow = 10000 * costMultiplier;
  const baseHigh = 25000 * costMultiplier;
  const formatRange = (low: number, high: number) => {
    const fmtK = (n: number) => `$${Math.round(n / 1000)}K`;
    return `${fmtK(low)}–${fmtK(high)}`;
  };

  const roi12Month = Math.round(((totalImpact * 0.7) / ((baseLow + baseHigh) / 2) - 1) * 100);
  const paybackWeeks = Math.max(4, Math.round(((baseLow + baseHigh) / 2) / (totalImpact * 0.7 / 52)));

  return {
    confidenceScore: recConfidence,
    expectedImpact: {
      revenueLiftPercent: revenueLift,
      costReductionPercent: costReduction,
      timeSavedHoursMonth: timeSaved * 4, // weekly → monthly
    },
    implementationWindowDays,
    investmentSummary: {
      estimatedCostRange: formatRange(baseLow, baseHigh),
      paybackPeriodWeeks: `${paybackWeeks}–${paybackWeeks + 4} weeks`,
      roiPercent12Month: `${roi12Month}%`,
    },
  };
}