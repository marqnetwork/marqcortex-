/**
 * CORTEX CORE — PORTFOLIO ENGINE
 *
 * Implements the Cortex Rules spec:
 *   1. 7-department scanning layer with 4 sub-scores (0-10)
 *   2. Recommendation ONLY IF density >= 6 AND impact >= 6
 *   3. Priority = impact*0.4 + automation*0.3 + density*0.2 - risk*0.1
 *   4. Max 7 recommendations per business
 *   5. Sequencing: constraints→optimization, bottlenecks→growth, data→AI, risk→spend
 *   6. Cross-deps: required_before when shared KPIs or systems
 *
 * Also generates DecisionTransparency — full audit trail.
 *
 * Math decides priority. Not opinion.
 */

import type {
  NormalizedDiagnostics,
  DomainScores,
  DomainKey,
  DepartmentKey,
  DepartmentScanScore,
  DecisionOutput,
  RecommendationV2,
  BusinessTransformationPortfolio,
  CrossDependency,
  DecisionTransparency,
  FinancialProjection,
  FeasibilityScore,
  EvidenceStrength,
  ROIEligibility,
} from './types';
import { DOMAIN_LABELS, DOMAIN_TO_SPRINT, CORE_PROBLEM_LABELS, DEPARTMENT_LABELS } from './types';
import { getSprintTemplate } from './sprintTemplates';

// ── Constants ──
const MAX_PORTFOLIO_SIZE = 7;
const CREATION_THRESHOLD_DENSITY = 6;
const CREATION_THRESHOLD_IMPACT = 6;

// ── Department → Internal Domain mapping ──
const DEPARTMENT_SOURCE_DOMAINS: Record<DepartmentKey, DomainKey[]> = {
  revenue_engine: ['revenue'],
  customer_experience: ['customer_experience'],
  operations_supply_chain: ['operations'],
  marketing_acquisition: ['revenue', 'customer_experience'],
  finance_unit_economics: ['revenue', 'operations'],
  data_infrastructure: ['data', 'systems'],
  talent_process: ['governance'],
};

// Department → Sprint mapping (for cost estimation)
const DEPARTMENT_TO_SPRINT: Record<DepartmentKey, DomainKey> = {
  revenue_engine: 'revenue',
  customer_experience: 'customer_experience',
  operations_supply_chain: 'operations',
  marketing_acquisition: 'revenue',
  finance_unit_economics: 'revenue',
  data_infrastructure: 'data',
  talent_process: 'governance',
};

const DEPARTMENT_PROBLEM_LABELS: Record<DepartmentKey, string> = {
  revenue_engine: 'Revenue Leakage & Pipeline Breakdown',
  customer_experience: 'Customer Experience Breakdown',
  operations_supply_chain: 'Manual Process & Supply Chain Dependency',
  marketing_acquisition: 'Acquisition Inefficiency & Channel Fragmentation',
  finance_unit_economics: 'Unit Economics Opacity & Margin Erosion',
  data_infrastructure: 'Data Fragmentation & Infrastructure Gaps',
  talent_process: 'Talent Bottleneck & Process Dependency',
};

// ════════════════════════════════════════════════════════════════════════════════
// 1️⃣ DEPARTMENT SCANNING LAYER
// ════════════════════════════════════════════════════════════════════════════════

export function scanDepartments(
  scores: DomainScores,
  diagnostics: NormalizedDiagnostics,
): DepartmentScanScore[] {
  const emp = diagnostics.employeeEstimate;
  const ALL_DEPARTMENTS: DepartmentKey[] = [
    'revenue_engine', 'customer_experience', 'operations_supply_chain',
    'marketing_acquisition', 'finance_unit_economics', 'data_infrastructure', 'talent_process',
  ];

  return ALL_DEPARTMENTS.map(dept => {
    const sourceDomains = DEPARTMENT_SOURCE_DOMAINS[dept];

    // Aggregate domain scores for this department
    const domainScoresArr = sourceDomains.map(d => scores[d].rawScore);
    const avgDomainScore = domainScoresArr.reduce((s, v) => s + v, 0) / domainScoresArr.length;

    // Aggregate pain signals
    const totalPain = sourceDomains.reduce((s, d) => s + scores[d].painSignalCount, 0);

    // ── 4 sub-scores (0-10) ──

    // problem_density: how dense are the problems? Based on pain signals + domain score
    const problem_density_score = Math.max(0, Math.min(10,
      Math.round((avgDomainScore / 100) * 6 + Math.min(4, totalPain * 0.8))
    ));

    // impact_potential: how much impact fixing this would have?
    // High domain score = big problem = big impact potential
    const impact_potential_score = Math.max(0, Math.min(10,
      Math.round(avgDomainScore / 10)
    ));

    // automation_feasibility: how automatable is this?
    // Smaller companies = more feasible; operations/systems/data = more automatable
    const baseFeasibility = emp > 200 ? 5 : emp > 50 ? 7 : 8;
    const domainBonus = sourceDomains.some(d => ['operations', 'systems', 'data'].includes(d)) ? 2 : 0;
    const automation_feasibility_score = Math.max(0, Math.min(10, baseFeasibility + domainBonus));

    // risk_exposure: higher for governance/compliance-heavy, lower for pure operational
    const riskBase = sourceDomains.some(d => ['governance'].includes(d)) ? 6
      : sourceDomains.some(d => ['revenue', 'data'].includes(d)) ? 5
      : 3;
    const complexityRisk = emp > 200 ? 2 : emp > 50 ? 1 : 0;
    const risk_exposure_score = Math.max(0, Math.min(10, riskBase + complexityRisk));

    // ── Priority formula (Cortex Rules §3) ──
    const computed_priority = parseFloat((
      impact_potential_score * 0.4 +
      automation_feasibility_score * 0.3 +
      problem_density_score * 0.2 -
      risk_exposure_score * 0.1
    ).toFixed(1));

    // ── Qualification gate (Cortex Rules §2) ──
    const qualifies = problem_density_score >= CREATION_THRESHOLD_DENSITY
      && impact_potential_score >= CREATION_THRESHOLD_IMPACT;

    return {
      department: dept,
      label: DEPARTMENT_LABELS[dept],
      problem_density_score,
      impact_potential_score,
      automation_feasibility_score,
      risk_exposure_score,
      computed_priority,
      qualifies,
      source_domains: sourceDomains,
    };
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// PORTFOLIO BUILDER
// ════════════════════════════════════════════════════════════════════════════════

export function buildPortfolio(
  diagnostics: NormalizedDiagnostics,
  scores: DomainScores,
  decision: DecisionOutput,
  primaryRecV2: RecommendationV2,
  financialProjection: FinancialProjection,
): BusinessTransformationPortfolio {
  const emp = diagnostics.employeeEstimate;
  const sizeMultiplier = emp > 200 ? 3 : emp > 50 ? 2 : 1;

  // ── 1. Scan all 7 departments ──
  const departmentScan = scanDepartments(scores, diagnostics);

  // ── 2. Filter qualifying departments ──
  let qualifying = departmentScan
    .filter(d => d.qualifies)
    .sort((a, b) => b.computed_priority - a.computed_priority);

  // Portfolio size guardrail (§4): max 7
  if (qualifying.length > MAX_PORTFOLIO_SIZE) {
    qualifying = qualifying.slice(0, MAX_PORTFOLIO_SIZE);
  }

  // ── 3. Generate recommendations for qualifying departments ──
  const recommendations: RecommendationV2[] = [];
  for (const dept of qualifying) {
    // Check if primary domain maps to this department
    const isPrimaryDept = dept.source_domains.includes(decision.selectedCoreProblemDomain);
    if (isPrimaryDept && recommendations.length === 0) {
      // Attach primary rec to first matching department
      recommendations.push({
        ...primaryRecV2,
        core_problem: {
          ...primaryRecV2.core_problem,
          problem_id: dept.department,
        },
        priority_score: {
          impact_score: dept.impact_potential_score,
          feasibility_score: dept.automation_feasibility_score,
          risk_score: dept.risk_exposure_score,
          computed_priority: dept.computed_priority,
        },
      });
    } else {
      recommendations.push(buildDepartmentRec(dept, scores, diagnostics, decision));
    }
  }

  // ── 4. Global priority ranking ──
  const sorted = [...recommendations].sort(
    (a, b) => b.priority_score.computed_priority - a.priority_score.computed_priority
  );
  let cumulativeCost = 0;
  const globalRanking = sorted.map((rec, idx) => {
    const deptKey = rec.core_problem.problem_id as DepartmentKey;
    const primaryDomain = DEPARTMENT_TO_SPRINT[deptKey] || 'operations';
    const template = getSprintTemplate(DOMAIN_TO_SPRINT[primaryDomain] || 'automation-sprint');
    const cost = ((template.baseInvestment.lowMultiplier + template.baseInvestment.highMultiplier) / 2) * sizeMultiplier;
    cumulativeCost += cost;
    return {
      recommendation_id: rec.recommendation_id,
      department: deptKey,
      rank: idx + 1,
      computed_priority: rec.priority_score.computed_priority,
      cumulative_investment_at_rank: `$${Math.round(cumulativeCost / 1000)}K`,
    };
  });

  // ── 5. Cross-dependencies (§6) ──
  const crossDeps = buildCrossDependencies(recommendations);

  // ── 6. Capital allocation ──
  const totalCost = recommendations.reduce((sum, rec) => {
    const deptKey = rec.core_problem.problem_id as DepartmentKey;
    const primaryDomain = DEPARTMENT_TO_SPRINT[deptKey] || 'operations';
    const t = getSprintTemplate(DOMAIN_TO_SPRINT[primaryDomain] || 'automation-sprint');
    return sum + ((t.baseInvestment.lowMultiplier + t.baseInvestment.highMultiplier) / 2) * sizeMultiplier;
  }, 0);

  const allocations = recommendations.map(rec => {
    const deptKey = rec.core_problem.problem_id as DepartmentKey;
    const primaryDomain = DEPARTMENT_TO_SPRINT[deptKey] || 'operations';
    const t = getSprintTemplate(DOMAIN_TO_SPRINT[primaryDomain] || 'automation-sprint');
    const cost = ((t.baseInvestment.lowMultiplier + t.baseInvestment.highMultiplier) / 2) * sizeMultiplier;
    return {
      recommendation_id: rec.recommendation_id,
      department: deptKey,
      percent_of_budget: totalCost > 0 ? Math.round((cost / totalCost) * 100) : 0,
      estimated_cost: `$${Math.round(cost / 1000)}K`,
    };
  });

  const capitalEfficiency = recommendations.map(rec => {
    const deptKey = rec.core_problem.problem_id as DepartmentKey;
    const primaryDomain = DEPARTMENT_TO_SPRINT[deptKey] || 'operations';
    const t = getSprintTemplate(DOMAIN_TO_SPRINT[primaryDomain] || 'automation-sprint');
    const cost = ((t.baseInvestment.lowMultiplier + t.baseInvestment.highMultiplier) / 2) * sizeMultiplier;
    const roiPerDollar = cost > 0
      ? parseFloat(((rec.priority_score.computed_priority * rec.core_problem.severity_score) / (cost / 10000)).toFixed(2))
      : 0;
    return { recommendation_id: rec.recommendation_id, department: deptKey, roi_per_dollar: roiPerDollar };
  }).sort((a, b) => b.roi_per_dollar - a.roi_per_dollar);

  const totalRiskExposure = Math.round(
    departmentScan.reduce((sum, d) => sum + d.risk_exposure_score, 0) / 7 * 10
  );

  // ── 7. Execution sequence (§5) ──
  const { order, rules, reasoning } = buildExecutionSequence(sorted, crossDeps, departmentScan);
  const parallelGroups = findParallelGroups(sorted, crossDeps);
  const criticalPath = order.slice(0, Math.min(3, order.length));
  const totalDuration = recommendations.reduce((sum, r) => sum + r.execution_plan.total_duration_days, 0);

  return {
    portfolio_id: `ptf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    business_snapshot: {
      company: diagnostics.company,
      industry: diagnostics.industry,
      employee_estimate: diagnostics.employeeEstimate,
      data_completeness: diagnostics.completenessRatio,
      total_signals_detected: diagnostics.totalSignals,
    },
    department_scan: departmentScan,
    recommendations,
    global_priority_ranking: globalRanking,
    cross_dependencies: crossDeps,
    capital_allocation_model: {
      total_estimated_investment: `$${Math.round(totalCost / 1000)}K`,
      total_risk_exposure_score: totalRiskExposure,
      allocations,
      capital_efficiency_ranking: capitalEfficiency,
    },
    execution_sequence_model: {
      recommended_execution_order: order,
      parallel_eligible: parallelGroups,
      critical_path: criticalPath,
      total_duration_days: totalDuration,
      sequence_reasoning: reasoning,
      sequencing_rules_applied: rules,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// DEPARTMENT RECOMMENDATION BUILDER
// ════════════════════════════════════════════════════════════════════════════════

function buildDepartmentRec(
  dept: DepartmentScanScore,
  scores: DomainScores,
  diagnostics: NormalizedDiagnostics,
  decision: DecisionOutput,
): RecommendationV2 {
  const primaryDomain = dept.source_domains[0];
  const score = scores[primaryDomain];
  const template = getSprintTemplate(DOMAIN_TO_SPRINT[primaryDomain] || 'automation-sprint');
  const emp = diagnostics.employeeEstimate;

  // Pillar impact
  const pillars: RecommendationV2['core_problem']['pillar_impact'] = [];
  if (['talent_process', 'data_infrastructure'].includes(dept.department)) pillars.push('consultancy');
  if (['data_infrastructure', 'operations_supply_chain'].includes(dept.department)) pillars.push('software');
  if (['revenue_engine', 'customer_experience', 'marketing_acquisition'].includes(dept.department)) pillars.push('growth');
  if (['operations_supply_chain', 'finance_unit_economics'].includes(dept.department)) pillars.push('operations');
  if (pillars.length === 0) pillars.push('operations');

  // Impact types
  const impactTypes: RecommendationV2['impact_profile']['impact_type'] = [];
  if (['revenue_engine', 'marketing_acquisition'].includes(dept.department)) impactTypes.push('revenue_growth');
  if (['operations_supply_chain', 'finance_unit_economics'].includes(dept.department)) impactTypes.push('cost_reduction', 'efficiency');
  if (['talent_process', 'data_infrastructure'].includes(dept.department)) impactTypes.push('risk_reduction');
  if (['customer_experience'].includes(dept.department)) impactTypes.push('revenue_growth', 'efficiency');
  if (impactTypes.length === 0) impactTypes.push('efficiency');

  // Primary metric
  const metricMap: Record<DepartmentKey, { metric: string; baseline: number; unit: RecommendationV2['impact_profile']['unit'] }> = {
    revenue_engine: { metric: 'Monthly revenue leakage', baseline: 15000, unit: 'dollars' },
    customer_experience: { metric: 'Customer satisfaction score', baseline: 58, unit: 'score' },
    operations_supply_chain: { metric: 'Manual hours per week', baseline: 35, unit: 'hours' },
    marketing_acquisition: { metric: 'Customer acquisition cost', baseline: 120, unit: 'dollars' },
    finance_unit_economics: { metric: 'Margin visibility accuracy', baseline: 62, unit: 'percentage' },
    data_infrastructure: { metric: 'Data entry errors per week', baseline: 20, unit: 'count' },
    talent_process: { metric: 'Decision cycle time (hours)', baseline: 36, unit: 'hours' },
  };
  const pm = metricMap[dept.department];
  const isLowerBetter = ['hours', 'dollars', 'count'].includes(pm.unit);
  const targets = isLowerBetter
    ? { t30: Math.round(pm.baseline * 0.75), t60: Math.round(pm.baseline * 0.50), t90: Math.round(pm.baseline * 0.30) }
    : { t30: Math.round(pm.baseline + (100 - pm.baseline) * 0.25), t60: Math.round(pm.baseline + (100 - pm.baseline) * 0.50), t90: Math.round(pm.baseline + (100 - pm.baseline) * 0.75) };

  // Time to impact
  const baseDays = score.rawScore >= 75 ? 30 : score.rawScore >= 50 ? 45 : 60;
  const sizeAdj = emp > 200 ? 30 : emp > 50 ? 15 : 0;

  // Execution phases from template
  const phases = template.phases.map((p, idx) => {
    const match = p.durationLabel.match(/(\d+)[–-](\d+)/);
    const start = match ? parseInt(match[1]) : (idx * 10 + 1);
    const end = match ? parseInt(match[2]) : ((idx + 1) * 10);
    return {
      phase_id: `phase_${idx + 1}`,
      title: p.name,
      duration_days: end - start + 1,
      objectives: p.objectives,
      deliverables: p.deliverables,
      dependencies: idx === 0 ? [] : [`phase_${idx}`] as string[],
    };
  });

  const recId = `rec-${dept.department}-${Date.now().toString(36)}`;

  // §1 — Feasibility Scoring
  const feasibility = computeFeasibility(dept, diagnostics);

  // §2 — Evidence Strength
  const evidence = computeEvidence(dept, scores, diagnostics);

  // Priority (carried from dept scan)
  const priorityScore = {
    impact_score: dept.impact_potential_score,
    feasibility_score: dept.automation_feasibility_score,
    risk_score: dept.risk_exposure_score,
    computed_priority: dept.computed_priority,
  };

  // §3 — Confidence Score (locked formula)
  const confidence = computeConfidence(priorityScore.computed_priority, feasibility.computed_feasibility, evidence.computed_evidence);

  // §4 — ROI Eligibility Gate
  const roiEligibility = runROIGate(pm.baseline, pm.metric, phases.length, feasibility.computed_feasibility, confidence.confidence_score);

  return {
    recommendation_id: recId,
    version: 'v2',
    calc_version: 1,
    core_problem: {
      problem_id: dept.department,
      problem_title: DEPARTMENT_PROBLEM_LABELS[dept.department],
      severity_score: dept.problem_density_score,
      pillar_impact: pillars,
    },
    strategic_decision: {
      why_now: score.rawScore >= 50
        ? `${dept.label} scored ${dept.problem_density_score}/10 problem density with ${dept.impact_potential_score}/10 impact potential. Active deterioration detected.`
        : `${dept.label} shows emerging issues (density: ${dept.problem_density_score}/10). Early intervention is 3-5x cheaper than reactive remediation.`,
      why_first: `Ranked #${decision.rankedDomains.findIndex(d => dept.source_domains.includes(d.domain)) + 1} in portfolio — address per execution sequence.`,
      expected_time_to_impact_days: baseDays + sizeAdj,
    },
    impact_profile: {
      impact_type: impactTypes,
      primary_metric: pm.metric,
      baseline_value: pm.baseline,
      target_value_30d: targets.t30,
      target_value_60d: targets.t60,
      target_value_90d: targets.t90,
      unit: pm.unit,
    },
    execution_plan: {
      total_duration_days: phases.reduce((s, p) => s + p.duration_days, 0),
      phases,
    },
    resource_requirements: [
      { role: 'Lead Specialist', allocation_percent: 70, active_phase: 'phase_1' },
      { role: 'Analyst', allocation_percent: 50, active_phase: 'phase_1' },
    ],
    risk_profile: template.riskTemplates.map((r, idx) => ({
      risk_id: `${dept.department}-risk-${idx + 1}`,
      probability: r.probability,
      impact: r.impact,
      mitigation: r.mitigation,
    })),
    assumptions_used: [
      `Problem density: ${dept.problem_density_score}/10. Impact potential: ${dept.impact_potential_score}/10.`,
      `Automation feasibility: ${dept.automation_feasibility_score}/10. Risk exposure: ${dept.risk_exposure_score}/10.`,
      `Source domain scores: ${dept.source_domains.map(d => `${d}=${scores[d].rawScore}`).join(', ')}.`,
    ],
    feasibility,
    evidence_strength: evidence,
    confidence_model: confidence,
    roi_eligibility: roiEligibility,
    priority_score: priorityScore,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// §1 — FEASIBILITY SCORING (Execution Reality Check)
// ════════════════════════════════════════════════════════════════════════════════
// tech*0.3 + data*0.3 + org*0.25 - complexity*0.15
// If < 5 → "High Execution Risk"

function computeFeasibility(
  dept: DepartmentScanScore,
  diagnostics: NormalizedDiagnostics,
): FeasibilityScore {
  const emp = diagnostics.employeeEstimate;

  const technical_feasibility = Math.max(0, Math.min(10, dept.automation_feasibility_score));

  const data_readiness = Math.max(0, Math.min(10,
    Math.round(diagnostics.completenessRatio * 7 + (dept.source_domains.includes('data') ? 2 : 1))
  ));

  const organizational_readiness = emp > 200 ? 5 : emp > 50 ? 7 : 8;

  const complexityMap: Record<DepartmentKey, number> = {
    operations_supply_chain: 4, data_infrastructure: 5, revenue_engine: 5,
    customer_experience: 4, marketing_acquisition: 5, finance_unit_economics: 7,
    talent_process: 8,
  };
  const change_complexity = complexityMap[dept.department] || 5;

  const computed_feasibility = parseFloat((
    technical_feasibility * 0.3 +
    data_readiness * 0.3 +
    organizational_readiness * 0.25 -
    change_complexity * 0.15
  ).toFixed(1));

  return {
    technical_feasibility,
    data_readiness,
    organizational_readiness,
    change_complexity,
    computed_feasibility,
    high_execution_risk: computed_feasibility < 5,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// §2 — EVIDENCE STRENGTH LAYER
// ════════════════════════════════════════════════════════════════════════════════
// validated*0.4 + cross*0.3 - contradictions*0.2 - weak*0.1

function computeEvidence(
  dept: DepartmentScanScore,
  scores: DomainScores,
  diagnostics: NormalizedDiagnostics,
): EvidenceStrength {
  const validated_signals = dept.source_domains.reduce((s, d) => s + scores[d].painSignalCount, 0);

  const cross_department_validations = dept.source_domains.length > 1
    ? dept.source_domains.length
    : (validated_signals >= 3 ? 2 : validated_signals >= 1 ? 1 : 0);

  const contradiction_flags = diagnostics.completenessRatio >= 0.9 ? 0
    : diagnostics.completenessRatio >= 0.7 ? 1
    : diagnostics.completenessRatio >= 0.5 ? 2 : 3;

  const weak_signal_flags = diagnostics.avgWordCount < 20 ? 3
    : diagnostics.avgWordCount < 35 ? 2
    : diagnostics.avgWordCount < 50 ? 1 : 0;

  const computed_evidence = parseFloat((
    validated_signals * 0.4 +
    cross_department_validations * 0.3 -
    contradiction_flags * 0.2 -
    weak_signal_flags * 0.1
  ).toFixed(1));

  return { validated_signals, cross_department_validations, contradiction_flags, weak_signal_flags, computed_evidence };
}

// ════════════════════════════════════════════════════════════════════════════════
// §3 — CONFIDENCE SCORE (Final Authority Metric)
// ════════════════════════════════════════════════════════════════════════════════
// confidence = priority*0.4 + feasibility*0.3 + evidence*0.3, scaled 0–100

function computeConfidence(
  priorityScore: number,
  feasibilityScore: number,
  evidenceScore: number,
): RecommendationV2['confidence_model'] {
  const pNorm = Math.max(0, Math.min(10, priorityScore));
  const fNorm = Math.max(0, Math.min(10, feasibilityScore));
  const eNorm = Math.max(0, Math.min(10, evidenceScore));

  const raw = pNorm * 0.4 + fNorm * 0.3 + eNorm * 0.3;
  const scaled = Math.max(0, Math.min(100, Math.round(raw * 10)));

  const priority_component = parseFloat((pNorm * 0.4).toFixed(1));
  const feasibility_component = parseFloat((fNorm * 0.3).toFixed(1));
  const evidence_component = parseFloat((eNorm * 0.3).toFixed(1));

  let reasoning: string;
  if (scaled >= 80) {
    reasoning = `High confidence (${scaled}/100). Strong priority (${priority_component}), solid feasibility (${feasibility_component}), robust evidence (${evidence_component}).`;
  } else if (scaled >= 60) {
    reasoning = `Moderate confidence (${scaled}/100). Priority: ${priority_component}, feasibility: ${feasibility_component}, evidence: ${evidence_component}. ROI calculation reliable.`;
  } else {
    reasoning = `Low confidence (${scaled}/100). Gaps — priority: ${priority_component}, feasibility: ${feasibility_component}, evidence: ${evidence_component}. Additional discovery recommended.`;
  }

  return {
    confidence_score: scaled,
    confidence_reasoning: reasoning,
    formula_inputs: { priority_component, feasibility_component, evidence_component },
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// §4 — ROI ELIGIBILITY GATE
// ════════════════════════════════════════════════════════════════════════════════
// Must pass ALL 5 checks or → "ROI Not Calculable Yet"

function runROIGate(
  baseline: number,
  kpiMetric: string,
  phaseCount: number,
  feasibilityScore: number,
  confidenceScore: number,
): ROIEligibility {
  const has_measurable_baseline = baseline > 0;
  const has_defined_kpi = kpiMetric.length > 0;
  const has_timeline = phaseCount > 0;
  const feasibility_above_5 = feasibilityScore >= 5;
  const confidence_above_60 = confidenceScore >= 60;

  const failures: string[] = [];
  if (!has_measurable_baseline) failures.push('No measurable baseline');
  if (!has_defined_kpi) failures.push('No defined KPI');
  if (!has_timeline) failures.push('No timeline');
  if (!feasibility_above_5) failures.push(`Feasibility too low (${feasibilityScore.toFixed(1)} < 5)`);
  if (!confidence_above_60) failures.push(`Confidence too low (${confidenceScore} < 60)`);

  return {
    has_measurable_baseline, has_defined_kpi, has_timeline,
    feasibility_above_5, confidence_above_60,
    is_roi_eligible: failures.length === 0,
    gate_failures: failures,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// 5️⃣ EXECUTION SEQUENCING LOGIC
// ════════════════════════════════════════════════════════════════════════════════
// Rules:
//   1. Fix constraints before optimization
//   2. Fix operational bottlenecks before growth acceleration
//   3. Stabilize data before advanced AI automation
//   4. Reduce risk before scaling spend

const SEQUENCING_TIERS: DepartmentKey[][] = [
  // Tier 1: Constraints & bottlenecks
  ['operations_supply_chain', 'data_infrastructure'],
  // Tier 2: Core systems & risk
  ['talent_process', 'finance_unit_economics'],
  // Tier 3: Growth & optimization
  ['revenue_engine', 'customer_experience', 'marketing_acquisition'],
];

function buildExecutionSequence(
  sorted: RecommendationV2[],
  deps: CrossDependency[],
  scan: DepartmentScanScore[],
): { order: string[]; rules: string[]; reasoning: string } {
  const rulesApplied: string[] = [];
  const recsByDept = new Map<DepartmentKey, RecommendationV2>();
  for (const r of sorted) recsByDept.set(r.core_problem.problem_id as DepartmentKey, r);

  // Start with priority-sorted order
  const orderedIds: string[] = [];
  const used = new Set<string>();

  // Apply tier-based sequencing
  for (const tier of SEQUENCING_TIERS) {
    // Within each tier, sort by computed_priority descending
    const tierRecs = tier
      .map(dept => recsByDept.get(dept))
      .filter((r): r is RecommendationV2 => !!r && !used.has(r.recommendation_id))
      .sort((a, b) => b.priority_score.computed_priority - a.priority_score.computed_priority);

    for (const rec of tierRecs) {
      orderedIds.push(rec.recommendation_id);
      used.add(rec.recommendation_id);
    }
  }

  // Add any remaining (shouldn't happen with 7 departments)
  for (const rec of sorted) {
    if (!used.has(rec.recommendation_id)) {
      orderedIds.push(rec.recommendation_id);
    }
  }

  // Detect which rules were applied
  const deptOrder = orderedIds.map(id => {
    const r = sorted.find(s => s.recommendation_id === id);
    return r?.core_problem.problem_id as DepartmentKey;
  });

  const opsIdx = deptOrder.indexOf('operations_supply_chain');
  const revIdx = deptOrder.indexOf('revenue_engine');
  const dataIdx = deptOrder.indexOf('data_infrastructure');
  const mktIdx = deptOrder.indexOf('marketing_acquisition');
  const finIdx = deptOrder.indexOf('finance_unit_economics');

  if (opsIdx !== -1 && revIdx !== -1 && opsIdx < revIdx) {
    rulesApplied.push('Fix operational bottlenecks before growth acceleration');
  }
  if (dataIdx !== -1 && mktIdx !== -1 && dataIdx < mktIdx) {
    rulesApplied.push('Stabilize data before advanced AI automation');
  }
  if (opsIdx !== -1 && opsIdx < 2) {
    rulesApplied.push('Fix constraints before optimization');
  }
  if (finIdx !== -1 && revIdx !== -1 && finIdx < revIdx) {
    rulesApplied.push('Reduce risk before scaling spend');
  }

  if (rulesApplied.length === 0) {
    rulesApplied.push('Priority-score ordering (no sequencing conflicts detected)');
  }

  const reasoning = `${orderedIds.length} department${orderedIds.length !== 1 ? 's' : ''} qualify for intervention. ` +
    `Sequence follows Cortex Rules: ${rulesApplied.join('; ')}. ` +
    `Priority formula: impact×0.4 + automation×0.3 + density×0.2 - risk×0.1.`;

  return { order: orderedIds, rules: rulesApplied, reasoning };
}

// ════════════════════════════════════════════════════════════════════════════════
// 6️⃣ CROSS-DEPENDENCY MAPPING
// ════════════════════════════════════════════════════════════════════════════════

const DEPENDENCY_MAP: Record<DepartmentKey, { target: DepartmentKey; type: CrossDependency['dependency_type']; desc: string }[]> = {
  operations_supply_chain: [
    { target: 'data_infrastructure', type: 'enhances', desc: 'Operational automation generates structured data for infrastructure' },
    { target: 'customer_experience', type: 'enhances', desc: 'Operational efficiency directly improves customer SLAs' },
  ],
  data_infrastructure: [
    { target: 'revenue_engine', type: 'required_before', desc: 'Revenue attribution requires clean data infrastructure' },
    { target: 'marketing_acquisition', type: 'required_before', desc: 'Marketing optimization requires unified analytics' },
    { target: 'finance_unit_economics', type: 'required_before', desc: 'Unit economics visibility requires data foundation' },
  ],
  revenue_engine: [
    { target: 'customer_experience', type: 'enhances', desc: 'Revenue recovery improves when CX gaps are fixed' },
  ],
  customer_experience: [
    { target: 'revenue_engine', type: 'enhances', desc: 'Better CX directly drives retention and expansion revenue' },
  ],
  talent_process: [
    { target: 'operations_supply_chain', type: 'reduces-risk', desc: 'Delegation frameworks reduce operational bottlenecks' },
    { target: 'revenue_engine', type: 'reduces-risk', desc: 'Faster decisions reduce revenue decision lag' },
  ],
  marketing_acquisition: [
    { target: 'revenue_engine', type: 'enhances', desc: 'Better acquisition feeds the revenue pipeline' },
  ],
  finance_unit_economics: [
    { target: 'revenue_engine', type: 'required_before', desc: 'Margin visibility must exist before revenue scaling' },
  ],
};

function buildCrossDependencies(recommendations: RecommendationV2[]): CrossDependency[] {
  const recDepts = new Set(recommendations.map(r => r.core_problem.problem_id as DepartmentKey));
  const recIdMap = new Map<DepartmentKey, string>();
  for (const r of recommendations) recIdMap.set(r.core_problem.problem_id as DepartmentKey, r.recommendation_id);

  const deps: CrossDependency[] = [];
  for (const rec of recommendations) {
    const sourceDept = rec.core_problem.problem_id as DepartmentKey;
    const links = DEPENDENCY_MAP[sourceDept] || [];
    for (const link of links) {
      if (recDepts.has(link.target)) {
        deps.push({
          source_recommendation_id: rec.recommendation_id,
          source_department: sourceDept,
          target_recommendation_id: recIdMap.get(link.target)!,
          target_department: link.target,
          dependency_type: link.type,
          description: link.desc,
        });
      }
    }
  }

  return deps;
}

function findParallelGroups(sorted: RecommendationV2[], deps: CrossDependency[]): string[][] {
  const blockingPairs = new Set<string>();
  for (const d of deps) {
    if (d.dependency_type === 'required_before') {
      blockingPairs.add(`${d.source_recommendation_id}|${d.target_recommendation_id}`);
      blockingPairs.add(`${d.target_recommendation_id}|${d.source_recommendation_id}`);
    }
  }

  const groups: string[][] = [];
  const used = new Set<string>();

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(sorted[i].recommendation_id)) continue;
    const group = [sorted[i].recommendation_id];
    used.add(sorted[i].recommendation_id);

    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(sorted[j].recommendation_id)) continue;
      const hasBlocking = group.some(id =>
        blockingPairs.has(`${id}|${sorted[j].recommendation_id}`)
      );
      if (!hasBlocking) {
        group.push(sorted[j].recommendation_id);
        used.add(sorted[j].recommendation_id);
      }
    }

    if (group.length >= 2) groups.push(group);
  }

  return groups;
}

// ════════════════════════════════════════════════════════════════════════════════
// DECISION TRANSPARENCY BUILDER
// ════════════════════════════════════════════════════════════════════════════════

export function buildDecisionTransparency(
  diagnostics: NormalizedDiagnostics,
  scores: DomainScores,
  decision: DecisionOutput,
): DecisionTransparency {
  const primary = decision.rankedDomains[0];
  const secondary = decision.rankedDomains[1];

  const rankedDomains = decision.rankedDomains.map((d, idx) => ({
    rank: idx + 1,
    domain: d.domain,
    label: DOMAIN_LABELS[d.domain],
    score: d.score,
    severity: scores[d.domain].severity,
    is_primary: d.domain === decision.selectedCoreProblemDomain,
    pain_signal_count: scores[d.domain].painSignalCount,
  }));

  const gap = primary.score - (secondary?.score || 0);
  const gapPct = primary.score > 0 ? Math.round((gap / primary.score) * 100) : 100;
  let gapInterpretation: string;
  if (gap >= 30) {
    gapInterpretation = `Clear winner. ${DOMAIN_LABELS[primary.domain]} leads by ${gap} points — no ambiguity in the primary recommendation.`;
  } else if (gap >= 15) {
    gapInterpretation = `Strong separation. ${gap}-point gap provides high confidence in prioritization. Secondary domain should be addressed in Phase 2.`;
  } else if (decision.isHybrid) {
    gapInterpretation = `Near-tie detected (${gap}-point gap, ${gapPct}% relative). Hybrid mode activated — the recommended sprint addresses both domains.`;
  } else {
    gapInterpretation = `Moderate gap (${gap} points). Primary recommendation is ${DOMAIN_LABELS[primary.domain]} but ${DOMAIN_LABELS[secondary?.domain || primary.domain]} should be monitored closely.`;
  }

  const completeness = diagnostics.completenessRatio;
  const qualityRatio = Math.min(1, diagnostics.avgWordCount / 60);
  const gapClarity = primary.score > 0 ? Math.min(1, gap / 30) : 0;
  const signalDensity = Math.min(1, diagnostics.totalSignals / 12);

  const confidenceFactors = {
    data_completeness: { value: parseFloat(completeness.toFixed(2)), weight: 0.30, contribution: parseFloat((completeness * 0.30).toFixed(3)) },
    answer_quality: { value: parseFloat(qualityRatio.toFixed(2)), weight: 0.20, contribution: parseFloat((qualityRatio * 0.20).toFixed(3)) },
    score_gap_clarity: { value: parseFloat(gapClarity.toFixed(2)), weight: 0.30, contribution: parseFloat((gapClarity * 0.30).toFixed(3)) },
    signal_density: { value: parseFloat(signalDensity.toFixed(2)), weight: 0.20, contribution: parseFloat((signalDensity * 0.20).toFixed(3)) },
    final_confidence: decision.confidenceScore,
  };

  const whyNotOthers = decision.rankedDomains
    .filter(d => d.domain !== decision.selectedCoreProblemDomain)
    .map(d => ({
      domain: d.domain,
      label: DOMAIN_LABELS[d.domain],
      score: d.score,
      delta_from_primary: primary.score - d.score,
      reasoning: decision.whyNotOthers.find(w => w.domain === DOMAIN_LABELS[d.domain])?.reason
        || `Scored ${primary.score - d.score} points below the primary domain. Will be addressed in subsequent phases.`,
    }));

  const completePct = Math.round(diagnostics.completenessRatio * 100);
  let qualityGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  let qualityInterpretation: string;
  if (completePct >= 90 && diagnostics.avgWordCount >= 50) {
    qualityGrade = 'A';
    qualityInterpretation = 'Excellent data quality. High completeness and detailed responses provide strong signal foundation.';
  } else if (completePct >= 75 && diagnostics.avgWordCount >= 35) {
    qualityGrade = 'B';
    qualityInterpretation = 'Good data quality. Most questions answered with sufficient detail for reliable analysis.';
  } else if (completePct >= 50) {
    qualityGrade = 'C';
    qualityInterpretation = 'Adequate data. Some gaps exist. Confidence is moderate — additional discovery recommended.';
  } else if (completePct >= 25) {
    qualityGrade = 'D';
    qualityInterpretation = 'Limited data. Significant gaps reduce confidence. Recommend gathering additional responses before acting.';
  } else {
    qualityGrade = 'F';
    qualityInterpretation = 'Insufficient data for reliable analysis. Strongly recommend completing the full diagnostic.';
  }

  return {
    ranked_domains: rankedDomains,
    score_gap_analysis: {
      primary_domain: primary.domain,
      primary_score: primary.score,
      secondary_domain: secondary?.domain || primary.domain,
      secondary_score: secondary?.score || 0,
      gap_points: gap,
      gap_percent: gapPct,
      is_hybrid: decision.isHybrid,
      gap_interpretation: gapInterpretation,
    },
    confidence_factors: confidenceFactors,
    why_not_others: whyNotOthers,
    data_quality: {
      questions_answered: diagnostics.answeredQuestions,
      total_questions: diagnostics.answerCount,
      avg_word_count: diagnostics.avgWordCount,
      completeness_pct: completePct,
      quality_grade: qualityGrade,
      quality_interpretation: qualityInterpretation,
    },
    scoring_formula: {
      pain_weight: 0.40,
      causal_weight: 0.30,
      maturity_weight: 0.20,
      cross_dept_weight: 0.10,
      industry_adjustment_applied: true,
      industry: diagnostics.industry,
    },
  };
}