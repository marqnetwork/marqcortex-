/**
 * CORTEX CORE — MODULE 4: TEMPLATE ASSEMBLER
 *
 * Injects sprint JSON template.
 * Calculates KPIs. Calculates ROI projection.
 * Generates final recommendation payload (v1 + v2).
 *
 * UI reads ONLY the final payload.
 */

import type {
  NormalizedDiagnostics,
  DomainScores,
  DecisionOutput,
  FinancialProjection,
  RecommendationPayload,
  RecommendationV2,
  CortexEnginePayload,
  PillarImpactType,
  ImpactType,
  ImpactUnit,
  ExecutionPhaseV2,
  ResourceRequirement,
  RiskProfileEntry,
  DomainKey,
} from './types';
import { DOMAIN_LABELS, CORE_PROBLEM_LABELS } from './types';
import { getSprintTemplate } from './sprintTemplates';
import { buildPortfolio, buildDecisionTransparency } from './portfolioEngine';
import { buildPortfolioROI } from './roiEngine';
import type { PortfolioAssumptions, ScenarioKey } from './types';

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT: assemblePayload
// ═══════════════════════════════════════════════════════════════════════════════

export function assemblePayload(
  diagnostics: NormalizedDiagnostics,
  scores: DomainScores,
  decision: DecisionOutput,
  assumptions?: PortfolioAssumptions,
  activeScenario?: ScenarioKey,
): CortexEnginePayload {
  const template = getSprintTemplate(decision.sprintTemplateId);

  // ── Financial projection ──
  const financialProjection = buildFinancialProjection(diagnostics, scores, decision);

  // ── Recommendation payloads ──
  const recommendationPayload = buildRecommendationPayload(diagnostics, decision, financialProjection);
  const recommendationV2 = buildRecommendationV2(diagnostics, scores, decision, financialProjection);

  // ── Portfolio (multi-department recommendations) ──
  const portfolio = buildPortfolio(diagnostics, scores, decision, recommendationV2, financialProjection);

  // ── Decision Transparency ──
  const decisionTransparency = buildDecisionTransparency(diagnostics, scores, decision);

  // ── ROI Model ──
  const roiModel = buildPortfolioROI(
    portfolio,
    diagnostics.employeeEstimate,
    assumptions,
    undefined,
    activeScenario ?? 'expected',
  );

  return {
    diagnostics,
    scores,
    selected_core_problem: decision.selectedCoreProblem,
    confidence_score: decision.confidenceScore,
    sprint_template_id: decision.sprintTemplateId,
    financial_projection: financialProjection,
    recommendation_payload: recommendationPayload,
    recommendation_v2: recommendationV2,
    portfolio,
    decision_transparency: decisionTransparency,
    roi_model: roiModel,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FINANCIAL PROJECTION
// ═══════════════════════════════════════════════════════════════════════════════

function buildFinancialProjection(
  diagnostics: NormalizedDiagnostics,
  scores: DomainScores,
  decision: DecisionOutput,
): FinancialProjection {
  const template = getSprintTemplate(decision.sprintTemplateId);
  const emp = diagnostics.employeeEstimate;

  // ── Cost range ──
  const sizeMultiplier = emp > 200 ? 3 : emp > 50 ? 2 : 1;
  const costLow = template.baseInvestment.lowMultiplier * sizeMultiplier;
  const costHigh = template.baseInvestment.highMultiplier * sizeMultiplier;
  const formatK = (n: number) => `$${Math.round(n / 1000)}K`;

  // ── Impact estimation based on domain scores ──
  const primaryScore = scores[decision.selectedCoreProblemDomain].rawScore;
  const impactMultiplier = primaryScore / 100;

  const revenueLift = Math.round(Math.min(35, (scores.revenue.rawScore / 100) * 25 + impactMultiplier * 10));

  const opsSystemsAvg = (scores.operations.rawScore + scores.systems.rawScore) / 2;
  const costReduction = Math.round(Math.min(30, (opsSystemsAvg / 100) * 20 + impactMultiplier * 8));

  const painTotal = Object.values(diagnostics.domainPainCounts).reduce((s, v) => s + v, 0);
  const baseHoursPerWeek = Math.round(painTotal * 1.5 + impactMultiplier * 10);
  const timeSavedMonth = Math.round(baseHoursPerWeek * 0.6 * 4);

  const hourlyRate = emp > 200 ? 120 : emp > 50 ? 95 : 75;
  const totalAnnualImpact = Math.round(timeSavedMonth * hourlyRate * 12 * 0.8);

  const avgCost = (costLow + costHigh) / 2;
  const roi12Month = Math.round(((totalAnnualImpact * 0.7) / avgCost - 1) * 100);
  const paybackWeeksLow = Math.max(4, Math.round(avgCost / (totalAnnualImpact * 0.7 / 52)));
  const paybackWeeksHigh = paybackWeeksLow + 4;

  return {
    estimatedCostRange: `${formatK(costLow)}–${formatK(costHigh)}`,
    paybackPeriodWeeks: `${paybackWeeksLow}–${paybackWeeksHigh} weeks`,
    roiPercent12Month: `${Math.max(50, roi12Month)}%`,
    revenueLiftPercent: revenueLift,
    costReductionPercent: costReduction,
    timeSavedHoursMonth: timeSavedMonth,
    totalAnnualImpact,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECOMMENDATION PAYLOAD (v1 — backward compatible)
// ═══════════════════════════════════════════════════════════════════════════════

function buildRecommendationPayload(
  diagnostics: NormalizedDiagnostics,
  decision: DecisionOutput,
  financialProjection: FinancialProjection,
): RecommendationPayload {
  const template = getSprintTemplate(decision.sprintTemplateId);
  const emp = diagnostics.employeeEstimate;

  const baseDays = decision.rankedDomains[0].score >= 75 ? 30 : decision.rankedDomains[0].score >= 50 ? 45 : 60;
  const sizeAdj = emp > 200 ? 30 : emp > 50 ? 15 : 0;
  const implementationWindowDays = baseDays + sizeAdj;

  const whyThisFirst = decision.decisionReasoning;

  const whatNotToDo = decision.whyNotOthers.map(w => ({
    service: w.domain,
    reason: w.reason,
  }));

  return {
    primaryRecommendation: {
      title: template.title,
      whyThisFirst,
      confidenceScore: decision.confidenceScore,
      expectedImpact: {
        revenueLiftPercent: financialProjection.revenueLiftPercent,
        costReductionPercent: financialProjection.costReductionPercent,
        timeSavedHoursMonth: financialProjection.timeSavedHoursMonth,
      },
      implementationWindowDays,
    },
    focusAreas90Days: template.focusAreas,
    whatNotToDo,
    solutionBlueprint: {
      phases: template.phases,
      kpis: template.kpiTemplates,
      risks: template.riskTemplates,
    },
    investmentSummary: {
      estimatedCostRange: financialProjection.estimatedCostRange,
      paybackPeriodWeeks: financialProjection.paybackPeriodWeeks,
      roiPercent12Month: financialProjection.roiPercent12Month,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECOMMENDATION V2 — SCHEMA-LOCKED
// ═══════════════════════════════════════════════════════════════════════════════

function buildRecommendationV2(
  diagnostics: NormalizedDiagnostics,
  scores: DomainScores,
  decision: DecisionOutput,
  financialProjection: FinancialProjection,
): RecommendationV2 {
  const template = getSprintTemplate(decision.sprintTemplateId);
  const emp = diagnostics.employeeEstimate;
  const primaryDomain = decision.selectedCoreProblemDomain;
  const primaryScore = scores[primaryDomain];

  // ── core_problem ──
  const severityScore = Math.max(1, Math.min(10, Math.round(primaryScore.rawScore / 10)));
  const pillarImpact = derivePillarImpact(primaryDomain, scores);

  // ── strategic_decision ──
  const baseDays = decision.rankedDomains[0].score >= 75 ? 30 : decision.rankedDomains[0].score >= 50 ? 45 : 60;
  const sizeAdj = emp > 200 ? 30 : emp > 50 ? 15 : 0;
  const timeToImpact = baseDays + sizeAdj;

  const whyNow = buildWhyNow(primaryDomain, primaryScore.rawScore, diagnostics);
  const whyFirst = decision.decisionReasoning;

  // ── impact_profile ──
  const impactTypes = deriveImpactTypes(primaryDomain, scores);
  const primaryMetricInfo = derivePrimaryMetric(primaryDomain, financialProjection);

  // ── execution_plan ──
  const executionPhases = buildExecutionPhasesV2(template, decision);
  const totalDurationDays = executionPhases.reduce((s, p) => s + p.duration_days, 0);

  // ── resource_requirements ──
  const resources = buildResourceRequirements(primaryDomain, executionPhases);

  // ── risk_profile ──
  const riskProfile = buildRiskProfile(template, decision);

  // ── assumptions_used ──
  const assumptions = buildAssumptions(diagnostics, decision);

  // ── confidence_model ──
  const confidenceScore100 = Math.round(decision.confidenceScore * 100);
  const confidenceReasoning = buildConfidenceReasoning(diagnostics, decision);

  // ── priority_score ──
  const priorityScore = computePriorityScore(scores, decision, diagnostics);

  // ── §1 feasibility (Execution Reality Check) ──
  const techFeas = Math.max(0, Math.min(10, Math.round(diagnostics.completenessRatio * 4 + (primaryDomain === 'operations' || primaryDomain === 'systems' ? 4 : 2))));
  const dataReady = Math.max(0, Math.min(10, Math.round(diagnostics.completenessRatio * 7 + (primaryDomain === 'data' ? 2 : 1))));
  const orgReady = emp > 200 ? 5 : emp > 50 ? 7 : 8;
  const changeComplex: Record<string, number> = { operations: 4, systems: 5, revenue: 5, customer_experience: 4, governance: 8, data: 5 };
  const cc = changeComplex[primaryDomain] || 5;
  const computedFeas = parseFloat((techFeas * 0.3 + dataReady * 0.3 + orgReady * 0.25 - cc * 0.15).toFixed(1));
  const feasibility = {
    technical_feasibility: techFeas,
    data_readiness: dataReady,
    organizational_readiness: orgReady,
    change_complexity: cc,
    computed_feasibility: computedFeas,
    high_execution_risk: computedFeas < 5,
  };

  // ── §2 evidence strength ──
  const validatedSignals = primaryScore.painSignalCount;
  const crossValidations = decision.rankedDomains.filter(d => d.score >= 25 && d.domain !== primaryDomain).length;
  const contradictionFlags = diagnostics.completenessRatio >= 0.9 ? 0 : diagnostics.completenessRatio >= 0.7 ? 1 : 2;
  const weakSignalFlags = diagnostics.avgWordCount < 20 ? 3 : diagnostics.avgWordCount < 35 ? 2 : diagnostics.avgWordCount < 50 ? 1 : 0;
  const computedEvidence = parseFloat((validatedSignals * 0.4 + crossValidations * 0.3 - contradictionFlags * 0.2 - weakSignalFlags * 0.1).toFixed(1));
  const evidenceStrength = {
    validated_signals: validatedSignals,
    cross_department_validations: crossValidations,
    contradiction_flags: contradictionFlags,
    weak_signal_flags: weakSignalFlags,
    computed_evidence: computedEvidence,
  };

  // ── §3 confidence (locked formula: priority*0.4 + feasibility*0.3 + evidence*0.3) ──
  const pNorm = Math.max(0, Math.min(10, priorityScore.computed_priority));
  const fNorm = Math.max(0, Math.min(10, computedFeas));
  const eNorm = Math.max(0, Math.min(10, computedEvidence));
  const scaledConf = Math.max(0, Math.min(100, Math.round((pNorm * 0.4 + fNorm * 0.3 + eNorm * 0.3) * 10)));
  const formulaInputs = {
    priority_component: parseFloat((pNorm * 0.4).toFixed(1)),
    feasibility_component: parseFloat((fNorm * 0.3).toFixed(1)),
    evidence_component: parseFloat((eNorm * 0.3).toFixed(1)),
  };

  // ── §4 ROI eligibility gate ──
  const hasMeasurableBaseline = primaryMetricInfo.baseline > 0;
  const hasDefinedKpi = primaryMetricInfo.metric.length > 0;
  const hasTimeline = executionPhases.length > 0;
  const feasAbove5 = computedFeas >= 5;
  const confAbove60 = scaledConf >= 60;
  const gateFailures: string[] = [];
  if (!hasMeasurableBaseline) gateFailures.push('No measurable baseline');
  if (!hasDefinedKpi) gateFailures.push('No defined KPI');
  if (!hasTimeline) gateFailures.push('No timeline');
  if (!feasAbove5) gateFailures.push(`Feasibility too low (${computedFeas.toFixed(1)} < 5)`);
  if (!confAbove60) gateFailures.push(`Confidence too low (${scaledConf} < 60)`);
  const roiEligibility = {
    has_measurable_baseline: hasMeasurableBaseline,
    has_defined_kpi: hasDefinedKpi,
    has_timeline: hasTimeline,
    feasibility_above_5: feasAbove5,
    confidence_above_60: confAbove60,
    is_roi_eligible: gateFailures.length === 0,
    gate_failures: gateFailures,
  };

  return {
    recommendation_id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: 'v2',
    calc_version: 1,

    core_problem: {
      problem_id: primaryDomain,
      problem_title: decision.selectedCoreProblem,
      severity_score: severityScore,
      pillar_impact: pillarImpact,
    },

    strategic_decision: {
      why_now: whyNow,
      why_first: whyFirst,
      expected_time_to_impact_days: timeToImpact,
    },

    impact_profile: {
      impact_type: impactTypes,
      primary_metric: primaryMetricInfo.metric,
      baseline_value: primaryMetricInfo.baseline,
      target_value_30d: primaryMetricInfo.target30,
      target_value_60d: primaryMetricInfo.target60,
      target_value_90d: primaryMetricInfo.target90,
      unit: primaryMetricInfo.unit,
    },

    execution_plan: {
      total_duration_days: totalDurationDays,
      phases: executionPhases,
    },

    resource_requirements: resources,
    risk_profile: riskProfile,
    assumptions_used: assumptions,

    feasibility,
    evidence_strength: evidenceStrength,

    confidence_model: {
      confidence_score: scaledConf,
      confidence_reasoning: confidenceReasoning,
      formula_inputs: formulaInputs,
    },

    roi_eligibility: roiEligibility,
    priority_score: priorityScore,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// V2 HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function derivePillarImpact(domain: DomainKey, scores: DomainScores): PillarImpactType[] {
  const pillars: PillarImpactType[] = [];

  // Map domain scores to MARQ pillars: consultancy, software, growth, operations
  if (scores.governance.rawScore >= 30 || scores.data.rawScore >= 30) pillars.push('consultancy');
  if (scores.systems.rawScore >= 30 || scores.data.rawScore >= 30) pillars.push('software');
  if (scores.revenue.rawScore >= 30 || scores.customer_experience.rawScore >= 30) pillars.push('growth');
  if (scores.operations.rawScore >= 30) pillars.push('operations');

  // Ensure at least 'operations' is present
  if (pillars.length === 0) pillars.push('operations');
  return pillars;
}

function deriveImpactTypes(domain: DomainKey, scores: DomainScores): ImpactType[] {
  const types: ImpactType[] = [];
  if (scores.revenue.rawScore >= 25) types.push('revenue_growth');
  if (scores.operations.rawScore >= 25 || scores.systems.rawScore >= 25) types.push('cost_reduction');
  if (scores.operations.rawScore >= 20) types.push('efficiency');
  if (scores.governance.rawScore >= 25 || scores.data.rawScore >= 25) types.push('risk_reduction');
  if (types.length === 0) types.push('efficiency');
  return types;
}

interface PrimaryMetricInfo {
  metric: string;
  baseline: number;
  target30: number;
  target60: number;
  target90: number;
  unit: ImpactUnit;
}

function derivePrimaryMetric(domain: DomainKey, fp: FinancialProjection): PrimaryMetricInfo {
  const METRIC_MAP: Record<DomainKey, PrimaryMetricInfo> = {
    operations: {
      metric: 'Manual hours per week',
      baseline: fp.timeSavedHoursMonth > 0 ? Math.round(fp.timeSavedHoursMonth / 4 / 0.6) : 40,
      target30: 0, target60: 0, target90: 0,
      unit: 'hours',
    },
    revenue: {
      metric: 'Monthly revenue leakage',
      baseline: Math.round(fp.totalAnnualImpact / 12),
      target30: 0, target60: 0, target90: 0,
      unit: 'dollars',
    },
    systems: {
      metric: 'Data entry errors per week',
      baseline: 25,
      target30: 0, target60: 0, target90: 0,
      unit: 'count',
    },
    governance: {
      metric: 'Decision cycle time (hours)',
      baseline: 48,
      target30: 0, target60: 0, target90: 0,
      unit: 'hours',
    },
    customer_experience: {
      metric: 'Customer satisfaction score',
      baseline: 62,
      target30: 0, target60: 0, target90: 0,
      unit: 'score',
    },
    data: {
      metric: 'Reporting accuracy',
      baseline: 72,
      target30: 0, target60: 0, target90: 0,
      unit: 'percentage',
    },
  };

  const info = METRIC_MAP[domain];

  // For "lower is better" metrics (hours, dollars, count)
  if (['hours', 'dollars', 'count'].includes(info.unit)) {
    info.target30 = Math.round(info.baseline * 0.70);
    info.target60 = Math.round(info.baseline * 0.45);
    info.target90 = Math.round(info.baseline * 0.25);
  } else {
    // For "higher is better" metrics (percentage, score)
    const headroom = (100 - info.baseline);
    info.target30 = Math.round(info.baseline + headroom * 0.30);
    info.target60 = Math.round(info.baseline + headroom * 0.55);
    info.target90 = Math.round(info.baseline + headroom * 0.80);
  }

  return info;
}

function buildWhyNow(domain: DomainKey, score: number, diag: NormalizedDiagnostics): string {
  const pain = diag.domainPainCounts[domain];
  if (score >= 75) {
    return `Critical severity detected (${score}/100) with ${pain} active pain signals. Every week of delay compounds the operational damage. Immediate intervention prevents cascading failure across dependent systems.`;
  }
  if (score >= 50) {
    return `High severity (${score}/100) with ${pain} pain signals detected. The problem is actively degrading performance and will escalate with any growth. Acting now prevents the need for a significantly more expensive remediation later.`;
  }
  return `Moderate severity (${score}/100) but clear pattern of ${pain} pain signals indicates this will become critical within 3–6 months. Early intervention is 3–5x cheaper than reactive remediation.`;
}

function buildExecutionPhasesV2(
  template: ReturnType<typeof getSprintTemplate>,
  decision: DecisionOutput,
): ExecutionPhaseV2[] {
  return template.phases.map((phase, idx) => {
    // Parse duration from label like "Days 1–10"
    const match = phase.durationLabel.match(/(\d+)[–-](\d+)/);
    const start = match ? parseInt(match[1]) : (idx * 10 + 1);
    const end = match ? parseInt(match[2]) : ((idx + 1) * 10);
    const durationDays = end - start + 1;
    const phaseId = `phase_${idx + 1}`;

    return {
      phase_id: phaseId,
      title: phase.name,
      duration_days: durationDays,
      objectives: phase.objectives,
      deliverables: phase.deliverables,
      dependencies: idx === 0 ? [] : [`phase_${idx}`],
    };
  });
}

function buildResourceRequirements(
  domain: DomainKey,
  phases: ExecutionPhaseV2[],
): ResourceRequirement[] {
  // Resource templates per domain
  const RESOURCE_MAP: Record<DomainKey, { role: string; allocation: number }[]> = {
    operations: [
      { role: 'Process Automation Engineer', allocation: 80 },
      { role: 'Operations Analyst', allocation: 60 },
      { role: 'Project Manager', allocation: 40 },
    ],
    revenue: [
      { role: 'Revenue Operations Specialist', allocation: 80 },
      { role: 'Data Analyst', allocation: 60 },
      { role: 'CRM Engineer', allocation: 50 },
    ],
    systems: [
      { role: 'Integration Architect', allocation: 80 },
      { role: 'Full-Stack Developer', allocation: 70 },
      { role: 'QA Engineer', allocation: 40 },
    ],
    governance: [
      { role: 'Organizational Consultant', allocation: 70 },
      { role: 'Workflow Automation Specialist', allocation: 60 },
      { role: 'Change Management Lead', allocation: 50 },
    ],
    customer_experience: [
      { role: 'CX Strategist', allocation: 70 },
      { role: 'Automation Engineer', allocation: 60 },
      { role: 'UX Analyst', allocation: 40 },
    ],
    data: [
      { role: 'Data Engineer', allocation: 80 },
      { role: 'BI Analyst', allocation: 60 },
      { role: 'Data Governance Lead', allocation: 40 },
    ],
  };

  const roles = RESOURCE_MAP[domain];
  return roles.map((r, idx) => ({
    role: r.role,
    allocation_percent: r.allocation,
    // Spread across phases: primary resource all phases, others join later
    active_phase: idx === 0 ? phases[0]?.phase_id || 'phase_1' : phases[Math.min(idx, phases.length - 1)]?.phase_id || `phase_${idx + 1}`,
  }));
}

function buildRiskProfile(
  template: ReturnType<typeof getSprintTemplate>,
  decision: DecisionOutput,
): RiskProfileEntry[] {
  return template.riskTemplates.map((r, idx) => ({
    risk_id: `risk_${idx + 1}`,
    probability: r.probability,
    impact: r.impact,
    mitigation: r.mitigation,
  }));
}

function buildAssumptions(diag: NormalizedDiagnostics, decision: DecisionOutput): string[] {
  const assumptions: string[] = [];

  assumptions.push(`Analysis based on ${diag.answeredQuestions} of ${diag.answerCount} questions answered (${Math.round(diag.completenessRatio * 100)}% completeness).`);
  assumptions.push(`Employee estimate: ~${diag.employeeEstimate} team members.`);
  assumptions.push(`Industry context: ${diag.industry}. Scoring adjusted for industry-specific weight factors.`);

  if (decision.isHybrid) {
    assumptions.push(`Hybrid problem space detected — top two domains scored within 10%. Sprint addresses both.`);
  }

  assumptions.push(`Financial projections assume 60% of identified time waste is recoverable through automation.`);
  assumptions.push(`ROI calculations use conservative multipliers and assume partial adoption in the first 30 days.`);

  return assumptions;
}

function buildConfidenceReasoning(diag: NormalizedDiagnostics, decision: DecisionOutput): string {
  const parts: string[] = [];

  // Data quality
  if (diag.completenessRatio >= 0.8) {
    parts.push('High data completeness provides strong signal foundation.');
  } else if (diag.completenessRatio >= 0.5) {
    parts.push('Moderate data completeness — some signal gaps may exist.');
  } else {
    parts.push('Limited data completeness — confidence is reduced. Recommend gathering additional inputs.');
  }

  // Signal density
  if (diag.totalSignals >= 10) {
    parts.push(`Strong signal density (${diag.totalSignals} signals) allows reliable pattern detection.`);
  } else {
    parts.push(`Limited signal count (${diag.totalSignals}) — patterns detected but may lack corroboration.`);
  }

  // Decision clarity
  const gap = decision.rankedDomains[0].score - (decision.rankedDomains[1]?.score || 0);
  if (gap >= 20) {
    parts.push('Clear separation between primary and secondary problem domains strengthens prioritization.');
  } else if (decision.isHybrid) {
    parts.push('Near-tie between top domains adds complexity — sprint was designed to address both.');
  }

  return parts.join(' ');
}

function computePriorityScore(
  scores: DomainScores,
  decision: DecisionOutput,
  diag: NormalizedDiagnostics,
): RecommendationV2['priority_score'] {
  const primaryScore = scores[decision.selectedCoreProblemDomain].rawScore;

  // Impact: how big is the problem? (0-10 scale from 0-100 domain score)
  const impactScore = Math.max(1, Math.min(10, Math.round(primaryScore / 10)));

  // Feasibility: inverse of complexity (smaller company + fewer hybrid issues = more feasible)
  const sizeComplexity = diag.employeeEstimate > 200 ? 3 : diag.employeeEstimate > 50 ? 2 : 1;
  const hybridPenalty = decision.isHybrid ? 1 : 0;
  const feasibilityScore = Math.max(1, Math.min(10, 10 - sizeComplexity - hybridPenalty));

  // Risk: inverse of confidence + data gaps
  const dataGapPenalty = (1 - diag.completenessRatio) * 5;
  const riskScore = Math.max(1, Math.min(10, Math.round(4 + dataGapPenalty + hybridPenalty)));

  // Computed priority: weighted formula (impact * 0.4 + feasibility * 0.35 + (10-risk) * 0.25)
  const computedPriority = parseFloat(
    (impactScore * 0.4 + feasibilityScore * 0.35 + (10 - riskScore) * 0.25).toFixed(1)
  );

  return {
    impact_score: impactScore,
    feasibility_score: feasibilityScore,
    risk_score: riskScore,
    computed_priority: computedPriority,
  };
}