/**
 * CORTEX MOCK DATA
 * 
 * Complete dummy data for the Cortex Decision Intelligence System.
 * 
 * PRODUCTION: Replace these functions with real API calls to your backend.
 * The backend should use GPT/Claude to analyze diagnostics and return
 * data matching these interfaces.
 */

import type {
  Lead,
  CortexLeadData,
  DiagnosticSummary,
  ServiceRecommendation,
  ROIEstimate,
  ProposalData,
  ProposalDraft,
  CallPrep,
  DecisionLog,
  NextAction,
  OutcomeFeedback,
  LearningInsights,
  ExecutiveOverview,
  BottleneckDeepDive,
  SystemicPattern,
  PillarInterpretations,
  FinancialEfficiencyModel,
  EnhancedRiskFlag,
  Solution,
  ImplementationPhase,
} from '@/app/types/cortex-types';
import type { AnnotatedResponse } from '@/app/utils/questionRegistry';
import { getIndustryBlueprint } from '@/app/utils/industryBlueprints';
import exampleCoJSON from '@/imports/exampleco-portfolio-diagnostic-1.json';

// ============================================================================
// MOCK LEADS LIST
// ============================================================================

export const getMockLeads = (): Lead[] => {
  return [
    {
      id: 'lead_001',
      companyName: 'Acme Fashion Co.',
      contactEmail: 'sarah@acmefashion.com',
      industry: 'E-commerce / DTC',
      companySize: '11-50 employees',
      submittedAt: '2026-01-27T14:30:00Z',
      readinessScore: 'High',
      confidenceScore: 'Very High',
      primaryPainSignal: 'Customer service bottleneck blocking scale',
      status: 'ready-for-call',
      assignedTo: 'Marcus Chen',
      lastActivityAt: '2026-01-28T09:15:00Z',
      urgencyLevel: 8,
      impactPotential: 9
    },
    {
      id: 'lead_002',
      companyName: 'TechFlow SaaS',
      contactEmail: 'john@techflow.io',
      industry: 'SaaS / Software',
      companySize: '51-200 employees',
      submittedAt: '2026-01-26T09:15:00Z',
      readinessScore: 'High',
      confidenceScore: 'High',
      primaryPainSignal: 'Manual onboarding causing churn',
      status: 'proposal-sent',
      assignedTo: 'Sarah Kim',
      lastActivityAt: '2026-01-27T16:45:00Z',
      urgencyLevel: 7,
      impactPotential: 8
    },
    {
      id: 'lead_003',
      companyName: 'Creative Agency Pro',
      contactEmail: 'mike@creativeagency.com',
      industry: 'Agency / Services',
      companySize: '11-50 employees',
      submittedAt: '2026-01-25T16:45:00Z',
      readinessScore: 'Medium',
      confidenceScore: 'Medium',
      primaryPainSignal: 'Founder approval bottleneck on every deliverable',
      status: 'needs-review',
      assignedTo: 'Alex Torres',
      lastActivityAt: '2026-01-25T17:00:00Z',
      urgencyLevel: 6,
      impactPotential: 7
    },
    {
      id: 'lead_004',
      companyName: 'HealthCare Plus',
      contactEmail: 'dr.smith@healthcareplus.com',
      industry: 'Healthcare / Medical',
      companySize: '51-200 employees',
      submittedAt: '2026-01-24T11:20:00Z',
      readinessScore: 'Medium',
      confidenceScore: 'High',
      primaryPainSignal: 'Compliance risk with manual patient data handling',
      status: 'new',
      lastActivityAt: '2026-01-24T11:20:00Z',
      urgencyLevel: 9,
      impactPotential: 9
    },
    {
      id: 'lead_005',
      companyName: 'Manufacturing Co',
      contactEmail: 'ops@manufacturing.com',
      industry: 'Manufacturing / Supply Chain',
      companySize: '201-500 employees',
      submittedAt: '2026-01-23T13:00:00Z',
      readinessScore: 'Low',
      confidenceScore: 'Medium',
      primaryPainSignal: 'Spreadsheet-based inventory causing stockouts',
      status: 'disqualified',
      lastActivityAt: '2026-01-24T10:00:00Z',
      urgencyLevel: 8,
      impactPotential: 10
    },
    {
      id: 'lead_006',
      companyName: 'EduTech Academy',
      contactEmail: 'founder@edutech.com',
      industry: 'Creators / Training / Courses',
      companySize: '1-10 employees',
      submittedAt: '2026-01-22T15:30:00Z',
      readinessScore: 'High',
      confidenceScore: 'High',
      primaryPainSignal: 'Manual student support taking 60% of time',
      status: 'converted',
      assignedTo: 'Marcus Chen',
      lastActivityAt: '2026-01-26T14:00:00Z',
      urgencyLevel: 7,
      impactPotential: 8
    },
    {
      id: 'lead_007',
      companyName: 'Hope Foundation',
      contactEmail: 'director@hopefoundation.org',
      industry: 'Non-Profit / Education',
      companySize: '11-50 employees',
      submittedAt: '2026-01-21T10:00:00Z',
      readinessScore: 'Medium',
      confidenceScore: 'Medium',
      primaryPainSignal: 'Donor data scattered across 4 tools with no unified view',
      status: 'needs-review',
      assignedTo: 'Sarah Kim',
      lastActivityAt: '2026-01-21T10:00:00Z',
      urgencyLevel: 5,
      impactPotential: 7
    },
    {
      id: 'lead_008',
      companyName: 'Metro Transit Authority',
      contactEmail: 'it.director@metrotransit.gov',
      industry: 'Government / Public Sector',
      companySize: '201-500 employees',
      submittedAt: '2026-01-20T08:45:00Z',
      readinessScore: 'Low',
      confidenceScore: 'High',
      primaryPainSignal: 'Legacy mainframe systems blocking citizen service modernization',
      status: 'new',
      lastActivityAt: '2026-01-20T08:45:00Z',
      urgencyLevel: 7,
      impactPotential: 10
    },
    {
      id: 'lead_009',
      companyName: 'Bright Consulting Group',
      contactEmail: 'ops@brightconsulting.com',
      industry: 'Other Business / General',
      companySize: '51-200 employees',
      submittedAt: '2026-01-19T14:20:00Z',
      readinessScore: 'High',
      confidenceScore: 'Medium',
      primaryPainSignal: 'Tribal knowledge across departments with zero documentation',
      status: 'needs-review',
      assignedTo: 'Alex Torres',
      lastActivityAt: '2026-01-20T11:30:00Z',
      urgencyLevel: 6,
      impactPotential: 8
    },
    {
      id: 'lead_010',
      companyName: 'ExampleCo',
      contactEmail: 'ops@exampleco.com',
      industry: 'E-commerce',
      companySize: '11-50 employees',
      submittedAt: '2026-02-28T12:00:00Z',
      readinessScore: 'High',
      confidenceScore: 'High',
      primaryPainSignal: 'Reactive support + tool fragmentation + founder dependency',
      status: 'ready-for-call',
      assignedTo: 'Marcus Chen',
      lastActivityAt: '2026-02-28T13:00:00Z',
      urgencyLevel: 8,
      impactPotential: 9
    }
  ];
};

// ============================================================================
// MOCK COMPLETE LEAD DATA
// ============================================================================

export const getMockCortexLeadData = (leadId: string): CortexLeadData => {
  const lead = getMockLeads().find(l => l.id === leadId) || getMockLeads()[0];
  const industry = lead.industry || 'E-commerce';

  // ExampleCo gets the gold-standard reference portfolio
  if (leadId === 'lead_010') {
    return getExampleCoData(lead);
  }
  
  return {
    lead,
    diagnostic: getMockDiagnosticSummary(leadId),
    recommendation: getMockServiceRecommendation(leadId),
    roiEstimate: getMockROIEstimate(leadId),
    roiModel: getMockPortfolioROI(leadId),
    portfolioState: getMockPortfolioState(leadId, lead.companyName, industry),
    proposal: lead.status === 'proposal-sent' || lead.status === 'converted' 
      ? getMockProposal(leadId) 
      : undefined,
    callPrep: ['ready-for-call', 'proposal-sent', 'converted'].includes(lead.status)
      ? getMockCallPrep(leadId)
      : undefined,
    decisionLog: getMockDecisionLog(leadId),
    nextActions: getMockNextActions(leadId),
    outcomeFeedback: lead.status === 'converted' || lead.status === 'disqualified'
      ? getMockOutcomeFeedback(leadId)
      : undefined
  };
};

// ============================================================================
// EXAMPLECO — GOLD-STANDARD REFERENCE PORTFOLIO
// ============================================================================
// Wired directly from /src/imports/exampleco-portfolio-diagnostic.json
// This is the reference implementation of the Architecture Overview spec.

function getExampleCoData(lead: Lead): CortexLeadData {
  const ec = exampleCoJSON;
  const recs = ec.outputs.recommendations.recommendations;
  const roiData = ec.outputs.roi;

  // Build PortfolioState from the gold-standard JSON
  const portfolioState: import('@/app/core/types').PortfolioState = {
    portfolio_id: ec.portfolio_id,
    lead_id: lead.id,
    current_version: ec.current_version,
    created_at: ec.created_at,
    updated_at: ec.updated_at,
    inputs: {
      business_snapshot: {
        company: ec.inputs.business_snapshot.company_name,
        industry: ec.inputs.business_snapshot.industry,
        employee_estimate: ec.inputs.business_snapshot.team_size,
      },
      answers: Object.fromEntries(ec.inputs.answers.map(a => [a.question_id, a.text])),
      assumptions: ec.inputs.assumptions as any,
      constraints: ec.inputs.constraints as any,
    },
    outputs: {
      diagnostic: null,
      recommendations: [],
      portfolio: null,
      roi: null,
      decision_transparency: null,
    },
    history: [...ec.history].reverse().map(h => ({
      version: h.version,
      previous_version: h.previous_version,
      timestamp: h.timestamp,
      actor: h.actor as 'team_user' | 'system',
      source: h.source as 'chat' | 'manual_edit' | 'auto' | 'initial',
      delta_log: h.delta_log.map(d => ({
        path: d.path,
        old: d.old ?? null,
        new_value: (d as any).new ?? (d as any).new_value ?? null,
        reason: d.reason,
      })),
      recalc: h.recalc as any,
      summary: h.summary,
    })),
  };

  // Build ROI model from gold-standard JSON
  const roiModel: import('@/app/core/types').PortfolioROIModel = {
    recommendation_rois: roiData.by_recommendation.map((r, idx) => {
      const rec = recs[idx];
      const midInvestment = (r.investment_estimate.min + r.investment_estimate.max) / 2;
      const midGain = (r.gain_annual_range.min + r.gain_annual_range.max) / 2;
      const rawROI = midInvestment > 0 ? Math.round((midGain - midInvestment) / midInvestment * 100) : 0;
      const adjROI = Math.min(
        Math.round(rawROI * (rec.confidence_model.confidence_score / 100)),
        r.cap_applied ? ec.inputs.constraints.max_roi_display_percent : 9999,
      );
      return {
        recommendation_id: r.recommendation_id,
        department: (rec.core_problem.pillar_impact[0] === 'operations' ? 'operations_supply_chain' : rec.core_problem.pillar_impact[0] === 'governance' ? 'talent_process' : 'customer_experience') as any,
        is_roi_eligible: true,
        inputs: {
          baseline_metric: rec.impact_profile.baseline_value,
          target_metric_90d: rec.impact_profile.target_value_90d,
          investment_cost: midInvestment,
          confidence_score: rec.confidence_model.confidence_score,
          feasibility_score: rec.priority_score.feasibility_score,
          timeline_days: rec.execution_plan.total_duration_days,
        },
        impact_calculations: {
          revenue_impact: rec.impact_profile.impact_type.includes('revenue_growth') ? { projected_gain: r.gain_annual_range.max, formula: `Based on ${rec.impact_profile.primary_metric}` } : undefined,
          cost_reduction: rec.impact_profile.impact_type.includes('cost_reduction') || rec.impact_profile.impact_type.includes('efficiency') ? { savings: r.gain_annual_range.min, formula: `Based on ${rec.impact_profile.primary_metric}` } : undefined,
          risk_reduction: rec.impact_profile.impact_type.includes('risk_reduction') ? { expected_loss_avoided: Math.round(r.gain_annual_range.min * 0.3), formula: 'Risk probability × exposure' } : undefined,
          total_projected_gain: midGain,
        },
        raw_roi_percent: rawROI,
        adjusted_roi_percent: adjROI,
        roi_range: {
          low_case: { efficiency: 0.6 as const, gain: r.gain_annual_range.min, roi_percent: r.roi_percent_range_display.low },
          mid_case: { efficiency: 0.8 as const, gain: midGain, roi_percent: r.roi_percent_range_display.mid },
          high_case: { efficiency: 1.0 as const, gain: r.gain_annual_range.max, roi_percent: r.roi_percent_range_display.high },
        },
        payback_months: midInvestment > 0 ? parseFloat((midInvestment / (midGain / 12)).toFixed(1)) : 99,
        display: {
          investment: `$${Math.round(r.investment_estimate.min / 1000)}K–$${Math.round(r.investment_estimate.max / 1000)}K`,
          gain_90d: `$${Math.round(r.gain_annual_range.min * 0.25 / 1000)}K`,
          gain_12mo: `$${Math.round(r.gain_annual_range.min / 1000)}K–$${Math.round(r.gain_annual_range.max / 1000)}K`,
          payback_timeline: `${parseFloat((midInvestment / (midGain / 12)).toFixed(1))} months`,
          adjusted_roi_label: r.cap_applied ? `${adjROI}% (capped)` : `${adjROI}%`,
          assumptions: [
            ...rec.assumptions_used.map((p: string) => `Uses: ${p.replace('inputs.assumptions.', '')}`),
            `Confidence-adjusted: raw × (${rec.confidence_model.confidence_score}/100)`,
            ...(r.cap_applied ? [`ROI capped at ${ec.inputs.constraints.max_roi_display_percent}%`] : []),
          ],
        },
      };
    }),
    portfolio_totals: {
      total_investment: (roiData.portfolio.investment_estimate.min + roiData.portfolio.investment_estimate.max) / 2,
      total_investment_label: `$${Math.round(roiData.portfolio.investment_estimate.min / 1000)}K–$${Math.round(roiData.portfolio.investment_estimate.max / 1000)}K`,
      total_adjusted_gain_90d: Math.round(roiData.portfolio.expected_annual_net_gain_range.min * 0.25),
      total_adjusted_gain_12mo: Math.round((roiData.portfolio.expected_annual_net_gain_range.min + roiData.portfolio.expected_annual_net_gain_range.max) / 2),
      total_adjusted_roi_percent: roiData.portfolio.displayed_roi_percent_range.mid,
      risk_adjusted_return: Math.round(roiData.portfolio.expected_annual_net_gain_range.min * 0.82),
    },
    portfolio_range: {
      low_case_total: roiData.portfolio.expected_annual_net_gain_range.min,
      mid_case_total: Math.round((roiData.portfolio.expected_annual_net_gain_range.min + roiData.portfolio.expected_annual_net_gain_range.max) / 2),
      high_case_total: roiData.portfolio.expected_annual_net_gain_range.max,
      low_case_roi: roiData.portfolio.displayed_roi_percent_range.low,
      mid_case_roi: roiData.portfolio.displayed_roi_percent_range.mid,
      high_case_roi: roiData.portfolio.displayed_roi_percent_range.high,
    },
    portfolio_payback_months: (roiData.portfolio.payback_months_range.min + roiData.portfolio.payback_months_range.max) / 2,
    execution_impact_curve: recs.map((rec, idx) => ({
      step: idx + 1,
      recommendation_id: rec.recommendation_id,
      department: (rec.core_problem.pillar_impact[0] === 'operations' ? 'operations_supply_chain' : rec.core_problem.pillar_impact[0] === 'governance' ? 'talent_process' : 'customer_experience') as any,
      cumulative_investment: roiData.by_recommendation.slice(0, idx + 1).reduce((s, r) => s + (r.investment_estimate.min + r.investment_estimate.max) / 2, 0),
      cumulative_gain_12mo: roiData.by_recommendation.slice(0, idx + 1).reduce((s, r) => s + (r.gain_annual_range.min + r.gain_annual_range.max) / 2, 0),
      cumulative_roi_percent: (() => {
        const inv = roiData.by_recommendation.slice(0, idx + 1).reduce((s, r) => s + (r.investment_estimate.min + r.investment_estimate.max) / 2, 0);
        const gain = roiData.by_recommendation.slice(0, idx + 1).reduce((s, r) => s + (r.gain_annual_range.min + r.gain_annual_range.max) / 2, 0);
        return inv > 0 ? Math.round((gain - inv) / inv * 100) : 0;
      })(),
    })),
    dependency_adjustments: [],
  };

  // Build the ServiceRecommendation shape from gold-standard
  const primaryRec = recs[0];

  // Helper: map a JSON rec to RecommendationV2 shape
  const mapRecToV2 = (rec: typeof recs[0]) => ({
    recommendation_id: rec.recommendation_id,
    version: 'v2' as const,
    calc_version: parseInt(ec.current_version.replace('v', ''), 10),
    core_problem: {
      problem_id: rec.core_problem.problem_id,
      problem_title: rec.core_problem.problem_title,
      severity_score: rec.core_problem.severity_score,
      pillar_impact: rec.core_problem.pillar_impact as any[],
    },
    strategic_decision: {
      why_now: rec.strategic_decision.why_now,
      why_first: rec.strategic_decision.why_first,
      why_not_others: 'Other recommendations sequence after stabilization.',
      expected_time_to_impact_days: rec.strategic_decision.expected_time_to_impact_days,
    },
    impact_profile: {
      impact_type: rec.impact_profile.impact_type as any[],
      primary_metric: rec.impact_profile.primary_metric,
      baseline_value: rec.impact_profile.baseline_value,
      target_value_30d: rec.impact_profile.target_value_30d,
      target_value_60d: rec.impact_profile.target_value_60d,
      target_value_90d: rec.impact_profile.target_value_90d,
      unit: rec.impact_profile.unit,
    },
    execution_plan: {
      total_duration_days: rec.execution_plan.total_duration_days,
      phases: rec.execution_plan.phases.map(p => ({
        phase_id: p.phase_id,
        title: p.title,
        duration_days: p.duration_days,
        objectives: p.objectives,
        deliverables: p.deliverables,
        dependencies: p.dependencies,
      })),
    },
    resource_requirements: rec.resource_requirements.map(r => ({
      role: r.role,
      allocation_percent: r.allocation_percent,
      active_phase: r.active_phase,
    })),
    risk_profile: rec.risk_profile.map(r => ({
      risk_id: r.risk_id,
      description: r.mitigation,
      probability: r.probability as any,
      impact: r.impact as any,
      mitigation: r.mitigation,
    })),
    assumptions_used: rec.assumptions_used,
    confidence_model: {
      confidence_score: rec.confidence_model.confidence_score,
      confidence_reasoning: rec.confidence_model.confidence_reasoning,
    },
    priority_score: {
      impact_score: rec.priority_score.impact_score,
      feasibility_score: rec.priority_score.feasibility_score,
      risk_score: rec.priority_score.risk_score,
      computed_priority: rec.priority_score.computed_priority,
      formula: 'impact×0.45 + feasibility×0.30 - risk×0.25',
    },
    feasibility: {
      technical_feasibility: 6,
      data_readiness: 5,
      organizational_readiness: 7,
      change_complexity: 3,
      computed_feasibility: 5.75,
      high_execution_risk: false,
      formula: 'tech×0.3 + data×0.3 + org×0.25 - complexity×0.15',
    },
    evidence_strength: {
      validated_signals: 7,
      cross_department_validations: 3,
      contradiction_flags: 1,
      weak_signal_flags: 1,
      computed_evidence: 4.9,
      formula: 'validated×0.4 + cross×0.3 - contradictions×0.2 - weak×0.1',
    },
    roi_eligibility: {
      is_roi_eligible: true,
      gate_results: {
        has_measurable_baseline: true,
        has_defined_kpi: true,
        has_timeline: true,
        feasibility_above_5: true,
        confidence_above_60: true,
      },
      gate_failures: [],
    },
  });

  const recommendation: ServiceRecommendation = {
    ...getMockServiceRecommendation(lead.id),
    primaryServiceLabel: primaryRec.core_problem.problem_title,
    recommendationV2: mapRecToV2(primaryRec) as any,
  };

  return {
    lead,
    diagnostic: getMockDiagnosticSummary(lead.id),
    recommendation,
    roiEstimate: getMockROIEstimate(lead.id),
    roiModel,
    portfolioState,
    proposal_draft: getExampleCoProposalDraft(),
    proposal: undefined,
    callPrep: {
      leadId: lead.id,
      suggestedAgenda: [
        'Open with empathy — acknowledge the 350 tickets/week pain and validate what they have already tried',
        'Walk through the 3 confirmed bottlenecks: Support Deflection, Reporting Spine, Founder Delegation',
        'Present the phased ROI: $95K-$170K annual gain from R1 alone, 131%-350% portfolio ROI over 12 months',
        'Discuss implementation timeline — 14-day quick win on ticket deflection, full portfolio in 90 days',
        'Align on decision-making process and next steps toward proposal review',
      ],
      keyQuestionsToValidate: [
        'What is your current refund processing workflow when response times exceed SLA?',
        'How many of the 350 weekly tickets are order status vs. returns vs. other?',
        'Who currently owns the approval process for refunds over a certain threshold?',
        'What does your current reporting workflow look like — how much time is spent pulling Shopify data manually?',
        'Is there a specific seasonal spike window we should plan around for the rollout?',
      ],
      expectedObjections: [
        {
          objection: 'We have tried automation before and it did not stick',
          response: 'That is common — most automation fails because it is tool-first, not bottleneck-first. Our approach maps directly to the 3 structural problems your diagnostic confirmed, so every system we install has a measurable KPI tied to it.',
        },
        {
          objection: 'The team is already stretched too thin to onboard new systems',
          response: 'That is exactly why R1 is designed as a 14-day quick win — the AI support deflection reduces ticket volume by 40% before we touch anything else. Your team gets capacity back before we layer on R2 and R3.',
        },
        {
          objection: 'How do we know the ROI numbers are realistic?',
          response: 'Every projection is built from your actual inputs — 2,940 orders/month, $85 AOV, 350 tickets/week, 3.8% refund rate. We use Monte Carlo simulation with conservative, base, and optimistic bands so you can see the range, not just one number.',
        },
      ],
      doNotPitchYetWarnings: [
        'Do NOT lead with pricing or proposal details — validate pain points first',
        'Avoid mentioning AI generically — be specific about which system solves which bottleneck',
        'Do not push for close on this call — the goal is alignment on the 3 bottlenecks and agreement to review a formal proposal',
      ],
      expansionSignalsToListenFor: [
        'Mentions of additional departments or teams with similar problems (cross-sell opportunity)',
        'References to upcoming funding rounds, board meetings, or growth targets (urgency accelerator)',
        'Asks about ongoing support or retainer models (signals long-term engagement appetite)',
        'Expresses frustration with current vendors or tools (displacement opportunity)',
        'Mentions competitor pressure or market deadlines (external urgency factor)',
      ],
      scheduledFor: '2026-03-07T14:00:00Z',
    },
    decisionLog: getMockDecisionLog(lead.id),
    nextActions: getMockNextActions(lead.id),
  };
}

// ============================================================================
// EXAMPLECO — PROPOSAL DRAFT v1
// ============================================================================
// Canonical payload built from the gold-standard ExampleCo diagnostic.
// Ref: /src/imports/proposal-data-model.json Phase 1 schema.

function getExampleCoProposalDraft(): ProposalDraft {
  return {
    proposal_id: 'P-0001',
    status: 'draft',
    client: {
      client_id: 'C-0001',
      company_name: 'ExampleCo',
      industry: 'E-commerce',
      region: 'USA',
      primary_contact: { name: '—', title: 'COO', email: '—' },
    },
    linkage: {
      diagnostic_id: 'D-0001',
      portfolio_version_id: 'v2',
      generated_from: ['diagnostic', 'recommendations', 'roi'],
    },
    executive_brief: {
      title: 'AI Transformation Opportunity Brief — ExampleCo',
      strategic_context:
        'ExampleCo is a $250K/mo E-commerce business processing ~2,940 orders/month with 350+ support tickets/week and a 30-hour average response time. Manual operations across customer support, reporting, and founder-gated approvals are consuming team bandwidth that should be driving growth. Three structural bottlenecks were confirmed across 46 operational signals with 86% AI confidence.',
      why_now:
        'Ticket volume is already 59% above baseline ("things break when volume spikes, we hire but it doesn\'t fix the core problems" — Q12). Each month of inaction costs an estimated $17K–$26K in preventable refunds and labor waste. The 3.8% refund rate is directly linked to SLA failures caused by the support bottleneck. Seasonal volume spikes will compound this risk within 60 days.',
      what_success_looks_like:
        '30–40% support ticket deflection within 14 days, 65% by day 90. Automated weekly reporting replacing manual Shopify/spreadsheet pulls. Founder sign-off removed from routine escalations — delegated via decision rules. Projected portfolio ROI: 131%–350% over 12 months, payback within 4–6 months.',
      positioning_statement:
        'We install AI systems that reduce labor, remove bottlenecks, and scale revenue — without hiring more people.',
    },
    diagnosis_blocks: [
      {
        diagnosis_id: 'DX-01',
        title: 'Reactive Customer Support Bottleneck',
        description:
          '350+ support tickets/week with a 30-hour average response time is creating active revenue leakage. When volume spikes, refund rates rise and customers complain publicly. The system is fully reactive — no deflection, no triage automation, no SLA enforcement.',
        operational_impact: [
          '350 tickets/week consuming ~18 hrs/week of team time',
          'Avg 30-hr response time vs. e-commerce SLA benchmark of 4–8 hrs',
          'Collapse cascade during volume spikes: support → fulfillment → inventory',
        ],
        financial_impact: [
          '3.8% refund rate ($114K/yr) directly linked to SLA failures',
          'Estimated $95K–$170K annual gain from 40–65% ticket deflection',
          'Refund risk compounds at 20–30% growth: +$20K–$40K annual exposure',
        ],
        evidence: [
          { source: 'questionnaire', ref: 'Q3,Q6', note: '24–48hr response when busy; order status, returns, refunds are top ticket types' },
          { source: 'questionnaire', ref: 'Q9,Q12', note: 'Refunds rise when support lags; volume spikes break operations' },
          { source: 'ops_pattern',   ref: 'PATTERN-01', note: 'Manual Dependency Across Core Workflows — 7 signals, High severity' },
        ],
        severity: 'high',
        confidence: 86,
      },
      {
        diagnosis_id: 'DX-02',
        title: 'Tool Fragmentation & Manual Reporting',
        description:
          'Data lives in Shopify, email, Slack, and spreadsheets with no reliable integration. The team spends 12+ hours/week manually pulling and compiling reports. Broken integrations cause inventory mismatches that further compound fulfillment errors.',
        operational_impact: [
          '12+ hrs/week of manual reporting across Shopify, email, and spreadsheet',
          'Inventory mismatches between warehouse spreadsheet and website (daily)',
          'Marketing campaigns firing on stale data — wrong-segment sends',
        ],
        financial_impact: [
          'Est. $40K–$75K labor cost reduction from reporting automation',
          'Inventory mismatch errors contributing to 5–8% order error rate',
          'Opportunity cost: ~2 hrs/wk of strategic time consumed by manual pulls',
        ],
        evidence: [
          { source: 'questionnaire', ref: 'Q1,Q2', note: 'Run ops in Slack + spreadsheets; weekly manual Shopify data pull' },
          { source: 'questionnaire', ref: 'Q5,Q8', note: 'Integrations not reliable; inventory mismatches from manual checks' },
          { source: 'ops_pattern',   ref: 'PATTERN-02', note: 'Fragmented Tool Stack Without Reliable Data Flow — 6 signals' },
        ],
        severity: 'high',
        confidence: 78,
      },
      {
        diagnosis_id: 'DX-03',
        title: 'Approval Bottleneck & Founder Dependency',
        description:
          'Founder sign-off is required for all escalations and special cases. Decisions vary by person with no documented rules. This creates an invisible tax on execution velocity — every workflow that touches an exception stalls waiting for the founder.',
        operational_impact: [
          'All escalations require founder sign-off — no delegation framework exists',
          'Decision rules vary by person, creating inconsistent customer experience',
          'Execution velocity loss across all three bottleneck areas',
        ],
        financial_impact: [
          'Est. $20K–$50K opportunity cost from delayed execution',
          'Founder time spent on decisions that could be systematized',
          'Risk: founder absence = full operational stall for escalations',
        ],
        evidence: [
          { source: 'questionnaire', ref: 'Q7,Q13', note: 'Founder sign-off for escalations; Slack decisions vary by person' },
          { source: 'ops_pattern',   ref: 'PATTERN-01', note: 'Governance failure — no documented decision authority matrix' },
        ],
        severity: 'high',
        confidence: 72,
      },
    ],
    scope_boundaries: {
      included: [
        'AI readiness audit',
        'workflow mapping',
        'ROI validation',
        '90-day roadmap',
        'Support deflection architecture design',
        'Automated reporting spine blueprint',
      ],
      excluded: [
        'Guaranteed outcomes',
        'Medical / legal / financial advice',
        'Fully autonomous decision-making without human oversight',
        'CRM replacement or platform migration',
        'New hiring decisions',
      ],
      assumptions: [
        'Client provides access to current tools and workflows',
        'Stakeholders attend validation sessions',
        'Shopify API access is available for data pull',
        'Founder available for 2 structured sessions in Week 1',
      ],
    },
    next_step_offer: {
      offer_name: 'AI Readiness & ROI Audit',
      price: 4500,
      currency: 'USD',
      duration: '2 weeks',
      primary_cta: 'Approve & Begin AI Audit',
      secondary_cta: 'Schedule Executive Clarification Call',
    },
    solutions: [
      {
        solution_id: 'SOL-01',
        title: 'AI Customer Support Triage & Deflection Agent',
        pillar: 'agents',
        linked_diagnosis_ids: ['DX-01'],
        root_problem_addressed:
          'Reactive, unautomated support inbox causing 30-hr response lag and a 3.8% refund rate driven by SLA failures.',
        system_description:
          'Deploy a trained AI agent on top of the existing support inbox to auto-classify intent, auto-respond to Tier-1 queries (order status, returns, tracking), and route Tier-2+ tickets with context-rich AI-generated summaries. No new headcount required. Live deflection telemetry feeds weekly ops report.',
        implementation_scope: {
          systems_affected: ['Gorgias / Zendesk helpdesk', 'Shopify Orders API', 'Customer email inbox'],
          automation_layers: ['Intent classification & ticket triage', 'Tier-1 auto-response generation', 'SLA timer enforcement & escalation routing', 'Refund risk flagging'],
          ai_components: ['LLM intent classifier (GPT-4o-mini)', 'Response generator', 'Sentiment scorer'],
          integration_points: ['Shopify Orders API', 'Helpdesk webhook', 'Slack #escalations channel'],
        },
        expected_operational_outcomes: [
          '30–40% ticket deflection within 14 days, 65% by day 90',
          'Average response time drops from 30 hrs to under 4 hrs',
          'Refund rate reduced from 3.8% to below 2.0% within 60 days',
          'Tier-2 escalations arrive pre-enriched with AI-generated context summaries',
        ],
        financial_levers: { efficiency_gain: 40, revenue_uplift: 12, cost_reduction: 35, risk_mitigation: 20 },
        dependencies: ['Shopify API credentials and admin access', 'Helpdesk admin access for webhook configuration', '90-day historical ticket export for AI training'],
        risk_flags: ['2-week agent training period before live deflection — manual volume unchanged during ramp'],
        complexity_score: 3,
        confidence_score: 82,
        financial_binding: { investment_allocated: 9000, annual_gain: 26250, roi_contribution_percentage: 50, payback_month: 4 },
      } as Solution,
      {
        solution_id: 'SOL-02',
        title: 'Automated Reporting & Unified Data Spine',
        pillar: 'workflow',
        linked_diagnosis_ids: ['DX-02'],
        root_problem_addressed:
          'Manual 12+ hrs/week reporting across Shopify, email, and spreadsheets with no reliable integration — causing inventory mismatches and stale marketing segments.',
        system_description:
          'Build an automated weekly operations report that extracts from Shopify, email ESP, and the inventory spreadsheet, aggregates via a lightweight ETL pipeline, and delivers a single-source Slack dashboard every Monday at 7AM. All manual data pulls are eliminated on Day 1 of deployment.',
        implementation_scope: {
          systems_affected: ['Shopify Admin', 'Email marketing platform (ESP)', 'Inventory spreadsheet', 'Slack'],
          automation_layers: ['Scheduled data extraction (Shopify, ESP, inventory)', 'ETL normalization & aggregation pipeline', 'Automated report generation', 'Slack delivery with anomaly alerts'],
          ai_components: ['Inventory anomaly detector', 'Trend narrative generator (weekly summary)'],
          integration_points: ['Shopify Admin API', 'Google Sheets API', 'Slack webhook', 'Email ESP API'],
        },
        expected_operational_outcomes: [
          '12+ hrs/week of manual reporting eliminated on Day 1',
          'Inventory mismatches detected and flagged within 1 hour of occurrence',
          'Weekly ops report auto-delivered every Monday at 7AM',
          'Marketing segments updated from live data instead of stale spreadsheets',
        ],
        financial_levers: { efficiency_gain: 60, revenue_uplift: 8, cost_reduction: 45, risk_mitigation: 15 },
        dependencies: ['Shopify Admin API access', 'Google Cloud or AWS account for pipeline hosting', 'Email ESP API key with read access'],
        risk_flags: ['Inventory spreadsheet may require structural cleanup before ingestion (est. 1-day effort)', 'Email ESP API rate limits may affect real-time sync'],
        complexity_score: 2,
        confidence_score: 78,
        financial_binding: { investment_allocated: 7500, annual_gain: 18225, roi_contribution_percentage: 35, payback_month: 5 },
      } as Solution,
      {
        solution_id: 'SOL-03',
        title: 'Decision Delegation Engine & Governance Layer',
        pillar: 'monitoring',
        linked_diagnosis_ids: ['DX-03'],
        root_problem_addressed:
          'All escalations bottlenecked at founder with no delegation framework, documented decision rules, or autonomous routing — creating an invisible execution tax across all workflows.',
        system_description:
          'Map all recurring decision types to a structured ruleset in a single workshop. Deploy a lightweight decision engine that routes exceptions to the correct team member based on category, dollar threshold, and urgency — removing the founder from routine decisions entirely. Full audit trail for every decision.',
        implementation_scope: {
          systems_affected: ['Slack workflows', 'Helpdesk escalation paths', 'Shopify order flags'],
          automation_layers: ['Decision type categorization', 'Threshold-based routing rules', 'Audit trail logging', 'Founder-override alert system'],
          ai_components: ['Decision classifier (categorizes incoming escalations)', 'Priority scorer (urgency × revenue exposure)'],
          integration_points: ['Slack Workflow Builder API', 'Helpdesk API', 'Shopify webhooks'],
        },
        expected_operational_outcomes: [
          'Founder removed from 80%+ of routine escalations within 30 days',
          'Decision authority matrix documented and version-controlled',
          'All escalations logged with full decision trail for auditing',
          'Response time for routine exceptions drops from hours to under 15 minutes',
        ],
        financial_levers: { efficiency_gain: 25, revenue_uplift: 10, cost_reduction: 20, risk_mitigation: 30 },
        dependencies: ['Founder + team decision-mapping workshop (1 session, ~3 hrs)', 'Slack admin access for workflow deployment', 'Helpdesk admin access'],
        risk_flags: ['Requires founder buy-in and documentation session in Week 1 — scheduling dependency', 'Ruleset coverage may need 30-day iteration cycle after initial deployment'],
        complexity_score: 2,
        confidence_score: 74,
        financial_binding: { investment_allocated: 6000, annual_gain: 8000, roi_contribution_percentage: 15, payback_month: 9 },
      } as Solution,
    ],
    implementation_phases: [
      {
        phase_number: 1,
        title: 'AI Foundation & Support Deflection',
        duration_weeks: 2,
        solution_ids: ['SOL-01'],
        deliverables: [
          'Support inbox audit and ticket classification map completed',
          'AI agent trained on 90-day historical ticket export',
          'Live deflection rate baseline established and telemetry wired',
          'Tier-1 auto-response rules validated with team sign-off',
        ],
      } as ImplementationPhase,
      {
        phase_number: 2,
        title: 'Data Spine & Reporting Automation',
        duration_weeks: 2,
        solution_ids: ['SOL-02'],
        deliverables: [
          'Automated reporting pipeline live and delivering Monday ops report',
          'Inventory sync logic operational with anomaly alerting',
          'Marketing segment data source connected to live Shopify data',
          'Manual spreadsheet pull process formally retired',
        ],
      } as ImplementationPhase,
      {
        phase_number: 3,
        title: 'Governance & Delegation Framework',
        duration_weeks: 2,
        solution_ids: ['SOL-03'],
        deliverables: [
          'Decision authority matrix documented and signed off by founder',
          'Routing rules deployed in Slack and helpdesk',
          'Founder escalation dashboard live with audit trail',
          '30-day review checkpoint scheduled and criteria defined',
        ],
      } as ImplementationPhase,
    ],
    implementation_plan: {
      phases: [
        {
          phase_number: 1,
          title: 'AI Foundation & Support Deflection',
          duration_weeks: 2,
          solution_ids: ['SOL-01'],
          milestones: [
            {
              week: 1,
              title: 'Support Workflow Mapping & AI Setup',
              owner: 'AI Operations Strategist',
              deliverables: ['Support Inbox Audit Report', 'Ticket Classification Map', 'Intent Category Matrix'],
            },
            {
              week: 2,
              title: 'AI Agent Training & Live Deployment',
              owner: 'AI Engineer',
              deliverables: ['Trained AI Triage Agent', 'Live Deflection Telemetry Dashboard', 'Tier-1 Auto-Response Rules'],
            },
          ],
          governance_checkpoints: [
            { type: 'internal_validation' as const, required: true,  description: 'Cortex internal review of AI agent accuracy before client go-live' },
            { type: 'client_review'       as const, required: true,  description: 'Client sign-off on auto-response templates and escalation rules' },
          ],
        },
        {
          phase_number: 2,
          title: 'Data Spine & Reporting Automation',
          duration_weeks: 2,
          solution_ids: ['SOL-02'],
          milestones: [
            {
              week: 3,
              title: 'Data Integration & Pipeline Build',
              owner: 'AI Operations Strategist',
              deliverables: ['Shopify-to-Reporting Pipeline', 'Inventory Sync Logic', 'Data Source Connection Map'],
            },
            {
              week: 4,
              title: 'Automated Reporting Deployment',
              owner: 'AI Engineer',
              deliverables: ['Monday Ops Report (Automated)', 'Inventory Anomaly Alert System', 'Marketing Segment Live Data Feed'],
            },
          ],
          governance_checkpoints: [
            { type: 'internal_validation' as const, required: true,  description: 'Data accuracy validation against manual baseline before retirement of spreadsheet process' },
            { type: 'sign_off'            as const, required: true,  description: 'Formal retirement of manual Shopify pull process — founder sign-off required' },
          ],
        },
        {
          phase_number: 3,
          title: 'Governance & Delegation Framework',
          duration_weeks: 2,
          solution_ids: ['SOL-03'],
          milestones: [
            {
              week: 5,
              title: 'Decision Mapping Workshop & Ruleset Design',
              owner: 'AI Operations Strategist',
              deliverables: ['Decision Authority Matrix', 'Escalation Routing Rules', 'Decision Delegation Playbook'],
            },
            {
              week: 6,
              title: 'Governance Engine Deployment & Audit Setup',
              owner: 'AI Engineer',
              deliverables: ['Slack Decision Routing Deployed', 'Founder Escalation Dashboard Live', '30-Day Review Checkpoint Scheduled'],
            },
          ],
          governance_checkpoints: [
            { type: 'client_review' as const, required: true, description: 'Founder sign-off on decision authority matrix before autonomous routing is enabled' },
            { type: 'roi_recheck'  as const, required: true, description: '30-day post-deployment ROI revalidation against deflection and execution velocity targets' },
          ],
        },
      ],
      team_structure: {
        cortex_team: [
          { role: 'AI Operations Strategist', responsibility: 'System mapping, solution design, client communication', involvement_phase: [1, 2, 3] },
          { role: 'AI Engineer',              responsibility: 'Agent training, pipeline build, deployment, integration wiring', involvement_phase: [1, 2, 3] },
          { role: 'Project Lead',             responsibility: 'Timeline governance, client escalation point, quality gate sign-off', involvement_phase: [1, 2, 3] },
        ],
        client_team_required: [
          { role: 'Operations Lead',           responsibility: 'Workflow validation, ticket taxonomy input, access approval', involvement_phase: [1, 2] },
          { role: 'Technical / Systems Admin', responsibility: 'API credential provisioning, helpdesk & Shopify admin access', involvement_phase: [1, 2] },
          { role: 'Founder / Decision-Maker',  responsibility: 'Decision ruleset sign-off, escalation authority, go-live approval', involvement_phase: [3] },
        ],
      },
      integration_architecture: {
        systems_affected: [
          'Gorgias / Zendesk (Helpdesk)',
          'Shopify (E-commerce platform)',
          'Slack (Internal comms & routing)',
          'Email ESP (Marketing automation)',
          'Google Sheets (Inventory — to be retired)',
        ],
        data_sources: [
          'Shopify Orders API (real-time order data)',
          'Customer email archive (90-day ticket history for AI training)',
          'Inventory spreadsheet (ingested & replaced by live sync)',
          'Helpdesk ticket history (intent classification training data)',
        ],
        automation_tools: [
          'n8n / Zapier (workflow orchestration layer)',
          'Custom AI agent framework (triage & auto-response)',
          'Reporting automation engine (scheduled data pull & distribution)',
          'Decision routing engine (Slack-based escalation routing)',
        ],
        ai_models_used: [
          'GPT-4o-mini — intent classification & Tier-1 response generation',
          'Sentiment scorer — ticket urgency prioritization',
          'Inventory anomaly detector — threshold-based alerting',
          'Decision router — category/threshold/urgency matching engine',
        ],
        security_considerations: [
          'All API credentials stored in encrypted vault (no hardcoded keys)',
          'PII masked before passing to AI models (name, email, order details anonymized)',
          'Full audit log for every AI decision — human override available at all times',
          'Human approval required for all refund decisions above $50 threshold',
          'GDPR-compliant data retention policy — 90-day ticket archive purge cycle',
        ],
      },
      governance_controls: {
        human_in_loop:                    true,
        approval_required_for_automation: true,
        quarterly_review:                 true,
        roi_revalidation_required:        true,
      },
    },
    financial_summary: {
      portfolio_version_id:      'v2',
      scenario:                  'expected' as const,
      currency:                  'USD',
      investment_total:          22500,
      annual_gain_conf_weighted: 52475,
      roi_percentage:            133,
      payback_month:             5,
      npv:                       29975,
      irr_annual:                87,
      irr_monthly:               5.4,
      monte_carlo: {
        mean_roi:                 185,
        median_roi:               162,
        p10_roi:                  52,
        p90_roi:                  350,
        probability_positive_roi: 94,
      },
      confidence_score:           78,
      realization_factor_applied: true,
      dependency_validated:       true,
      roi_cap_applied:            false,
    },
    metadata: {
      created_at: '2026-03-02T12:00:00Z',
      last_updated_at: '2026-03-02T12:00:00Z',
      created_by: 'team_user',
      version: 1,
    },
  };
}

// ============================================================================
// MOCK DIAGNOSTIC SUMMARY
// ============================================================================

const MOCK_ANNOTATED_RESPONSES: AnnotatedResponse[] = [
  {
    questionId: 1,
    questionText: 'Walk us through a normal workday when things feel frustrating or chaotic. Where does your time actually go, and what fires come up repeatedly?',
    category: 'Business Reality & Daily Operations',
    answer: 'Morning starts with urgent customer emails about missing orders and returns. Then inventory alerts because our spreadsheet counts are off again. Afternoon is firefighting fulfillment errors and manually updating tracking. I spend maybe 1 hour on actual strategic work.',
    detectedSignals: [
      { type: 'pain', label: 'Spreadsheet-Based Operations', confidence: 'high', matchedKeywords: ['spreadsheet'] },
      { type: 'pain', label: 'Operational Chaos', confidence: 'medium', matchedKeywords: ['firefighting'] },
      { type: 'pain', label: 'Manual Process Dependency', confidence: 'high', matchedKeywords: ['manually'] },
      { type: 'pain', label: 'Error-Prone Process', confidence: 'medium', matchedKeywords: ['errors'] },
    ],
    linkedBottlenecks: ['manual-operations', 'data-fragmentation'],
    maturityIndicator: 2,
  },
  {
    questionId: 2,
    questionText: 'Which tasks consume the most time in your e-commerce operation but feel repetitive or low-value? (Be specific about who does them and how often.)',
    category: 'Business Reality & Daily Operations',
    answer: 'I personally update inventory across 3 platforms daily (2-3 hours). Team manually processes refunds and responds to "where is my order" emails (4-5 hours/day total). Copy-pasting order data into spreadsheets for reporting (daily, 1 hour). Every single task is repetitive and could probably be automated.',
    detectedSignals: [
      { type: 'pain', label: 'Manual Process Dependency', confidence: 'high', matchedKeywords: ['manually', 'copy-pasting'] },
      { type: 'pain', label: 'Spreadsheet-Based Operations', confidence: 'high', matchedKeywords: ['spreadsheets'] },
      { type: 'pain', label: 'Repetitive Task Burden', confidence: 'high', matchedKeywords: ['repetitive', 'every single'] },
      { type: 'opportunity', label: 'Automation Opportunity', confidence: 'medium', matchedKeywords: ['automated'] },
    ],
    linkedBottlenecks: ['manual-operations'],
    maturityIndicator: 1,
  },
  {
    questionId: 3,
    questionText: 'What decisions, approvals, or checks still depend on you (or one key person) and slow everything down?',
    category: 'Business Reality & Daily Operations',
    answer: 'All marketing spend and campaign approvals need my sign-off. Customer service can\'t issue refunds over $50 without me. Product pricing changes require founder approval. The team literally waits for me to review orders before shipping anything over $200.',
    detectedSignals: [
      { type: 'pain', label: 'Approval Bottleneck', confidence: 'high', matchedKeywords: ['approval', 'sign-off', 'founder'] },
      { type: 'pain', label: 'Bottleneck / Single Point of Failure', confidence: 'high', matchedKeywords: ['depends on me', 'waits for me'] },
    ],
    linkedBottlenecks: ['founder-dependency'],
    maturityIndicator: 2,
  },
  {
    questionId: 4,
    questionText: 'Where does information get lost, duplicated, or delayed across orders, customers, inventory, marketing, or support?',
    category: 'Business Reality & Daily Operations',
    answer: 'Customer data lives in Shopify, support tickets in email, notes in Slack — nothing connects. Inventory counts differ between warehouse spreadsheet and website daily. Marketing doesn\'t know which customers already purchased, sends wrong campaigns. Support team can\'t see order status without asking fulfillment team directly.',
    detectedSignals: [
      { type: 'pain', label: 'Data Silos / Fragmentation', confidence: 'high', matchedKeywords: ['disconnected', 'nothing connects'] },
      { type: 'pain', label: 'Spreadsheet-Based Operations', confidence: 'medium', matchedKeywords: ['spreadsheet'] },
      { type: 'opportunity', label: 'System Integration Opportunity', confidence: 'medium', matchedKeywords: ['connect'] },
    ],
    linkedBottlenecks: ['data-fragmentation', 'tool-chaos'],
    maturityIndicator: 1,
  },
  {
    questionId: 5,
    questionText: 'If nothing changes in the next 6 months, what worries you most about your business?',
    category: 'Business Reality & Daily Operations',
    answer: 'I\'ll burn out — working nights and weekends just to keep up. We\'ll lose customers to competitors who deliver faster. We can\'t scale beyond current revenue without hiring 3-4 more people we can\'t afford. Margins will keep shrinking because of all the manual errors and rework.',
    detectedSignals: [
      { type: 'pain', label: 'Team Burnout Risk', confidence: 'high', matchedKeywords: ['burn out', 'nights and weekends'] },
      { type: 'risk', label: 'Competitive Threat', confidence: 'medium', matchedKeywords: ['competitors'] },
      { type: 'risk', label: 'Scale-Breaking Risk', confidence: 'high', matchedKeywords: ['can\'t scale'] },
      { type: 'pain', label: 'Error-Prone Process', confidence: 'medium', matchedKeywords: ['errors', 'rework'] },
    ],
    linkedBottlenecks: ['scale-constraint', 'team-capacity'],
    maturityIndicator: 2,
  },
  {
    questionId: 6,
    questionText: 'Describe what actually happens from the moment someone visits your store to when they become a repeat customer.',
    category: 'Bottlenecks, Scale & Leakage',
    answer: 'Visitor browses, adds to cart, often abandons (65%+ rate). We manually send recovery email 24 hours later. Sometimes converts. Order gets fulfilled in 3-5 days. Generic confirmation email. No follow-up until they reach out with a problem. No systematic retention or repurchase automation at all.',
    detectedSignals: [
      { type: 'pain', label: 'Manual Process Dependency', confidence: 'medium', matchedKeywords: ['manually'] },
      { type: 'risk', label: 'Customer Churn Risk', confidence: 'medium', matchedKeywords: ['abandons'] },
      { type: 'pain', label: 'Undocumented Processes', confidence: 'medium', matchedKeywords: ['no systematic'] },
      { type: 'opportunity', label: 'Automation Opportunity', confidence: 'medium', matchedKeywords: ['automation'] },
    ],
    linkedBottlenecks: ['customer-experience', 'revenue-leakage'],
    maturityIndicator: 2,
  },
  {
    questionId: 7,
    questionText: 'As order volume increases, where does the business start to break first?',
    category: 'Bottlenecks, Scale & Leakage',
    answer: 'Customer support gets overwhelmed first — response times balloon from hours to days. Then fulfillment errors spike because we\'re picking and packing under pressure. Then I can\'t keep up with inventory decisions and we start running out of popular items. It\'s a collapse cascade.',
    detectedSignals: [
      { type: 'risk', label: 'Scale-Breaking Risk', confidence: 'high', matchedKeywords: ['overwhelmed', 'collapse'] },
      { type: 'pain', label: 'Error-Prone Process', confidence: 'medium', matchedKeywords: ['errors'] },
      { type: 'pain', label: 'Process Delays', confidence: 'medium', matchedKeywords: ['slow'] },
    ],
    linkedBottlenecks: ['scale-constraint', 'customer-experience'],
    maturityIndicator: 2,
  },
  {
    questionId: 8,
    questionText: 'What work are humans doing today that clearly should not require human thinking?',
    category: 'Bottlenecks, Scale & Leakage',
    answer: 'Manually sending order confirmations and shipping notifications. Copy-pasting customer info between Shopify, email, and spreadsheets. Updating inventory counts across multiple sales channels by hand. Categorizing and responding to "where is my order" support tickets (same answer every time).',
    detectedSignals: [
      { type: 'pain', label: 'Manual Process Dependency', confidence: 'high', matchedKeywords: ['manually', 'by hand', 'copy-pasting'] },
      { type: 'pain', label: 'Spreadsheet-Based Operations', confidence: 'medium', matchedKeywords: ['spreadsheets'] },
      { type: 'pain', label: 'Repetitive Task Burden', confidence: 'high', matchedKeywords: ['same answer every time'] },
    ],
    linkedBottlenecks: ['manual-operations'],
    maturityIndicator: 1,
  },
  {
    questionId: 9,
    questionText: 'Where do you believe money is being lost right now? (Missed follow-ups, abandoned carts, slow responses, refunds, poor visibility, etc.)',
    category: 'Bottlenecks, Scale & Leakage',
    answer: '65% cart abandonment with no systematic recovery beyond a single manual email. Customers don\'t repurchase because zero retention automation. Slow support causes cancellations and bad reviews on social. We over-refund because we can\'t track root causes. Stock-outs on best-sellers from poor inventory visibility — easily $5-8K lost revenue per month.',
    detectedSignals: [
      { type: 'pain', label: 'Information / Revenue Leakage', confidence: 'high', matchedKeywords: ['lost', 'losing'] },
      { type: 'risk', label: 'Customer Churn Risk', confidence: 'medium', matchedKeywords: ['cancellations'] },
      { type: 'pain', label: 'Manual Process Dependency', confidence: 'medium', matchedKeywords: ['manual'] },
      { type: 'pain', label: 'Data Silos / Fragmentation', confidence: 'medium', matchedKeywords: ['no visibility'] },
    ],
    linkedBottlenecks: ['revenue-leakage', 'customer-experience'],
    maturityIndicator: 1,
  },
  {
    questionId: 10,
    questionText: 'What tools do you currently rely on, and where do they fail to support how your business actually runs?',
    category: 'Systems, Tools & Readiness',
    answer: 'Shopify for the store, Klaviyo for email (barely used), Google Sheets for inventory tracking, Gmail for customer support, Instagram for marketing. Nothing talks to each other. We have a 3PL but manually export/import data daily. Looked at Zendesk but team said it was too complex. Basically 8 disconnected tools creating manual work.',
    detectedSignals: [
      { type: 'pain', label: 'Data Silos / Fragmentation', confidence: 'high', matchedKeywords: ['disconnected', 'nothing talks to each other'] },
      { type: 'pain', label: 'Manual Process Dependency', confidence: 'high', matchedKeywords: ['manually'] },
      { type: 'pain', label: 'Spreadsheet-Based Operations', confidence: 'medium', matchedKeywords: ['Google Sheets'] },
      { type: 'opportunity', label: 'System Integration Opportunity', confidence: 'medium', matchedKeywords: ['integrate'] },
    ],
    linkedBottlenecks: ['tool-chaos', 'manual-operations'],
    maturityIndicator: 1,
  },
  {
    questionId: 11,
    questionText: 'What information do you wish you had at your fingertips but don\'t today?',
    category: 'Systems, Tools & Readiness',
    answer: 'Real-time inventory across all channels in one view. Customer lifetime value without exporting 3 reports and combining in Excel. Which products drive profit vs just revenue. A live dashboard showing order status, support tickets, and fulfillment bottlenecks. Accurate cash flow forecast based on actual inventory velocity.',
    detectedSignals: [
      { type: 'opportunity', label: 'Data Visibility Opportunity', confidence: 'high', matchedKeywords: ['real-time', 'dashboard', 'visibility'] },
      { type: 'opportunity', label: 'System Integration Opportunity', confidence: 'medium', matchedKeywords: ['unified'] },
    ],
    linkedBottlenecks: ['data-fragmentation'],
    maturityIndicator: 2,
  },
  {
    questionId: 12,
    questionText: 'How documented are your workflows today? (Almost nothing / partially documented / mostly documented / fully documented — explain.)',
    category: 'Systems, Tools & Readiness',
    answer: 'Almost nothing documented. Everything lives in people\'s heads. When someone is sick or quits, we scramble. We tried writing SOPs once but they were outdated within a month because processes change constantly. No one follows written procedures anyway because the reality is always different.',
    detectedSignals: [
      { type: 'pain', label: 'Undocumented Processes', confidence: 'high', matchedKeywords: ['no documentation', 'in their heads', 'nothing documented'] },
      { type: 'risk', label: 'Talent Retention Risk', confidence: 'medium', matchedKeywords: ['quits'] },
    ],
    linkedBottlenecks: ['manual-operations'],
    maturityIndicator: 1,
  },
  {
    questionId: 13,
    questionText: 'If we worked together for the next 90 days, what would success look like in practical terms?',
    category: 'Intent, Outcomes & Constraints',
    answer: 'I reclaim 15+ hours per week by automating repetitive work. Customer support response time under 2 hours without additional headcount. Zero stock-outs on top 20 products with automated reordering. My team operates independently without waiting for my approvals on routine decisions. Revenue increases 20% through better cart recovery and retention automation.',
    detectedSignals: [
      { type: 'opportunity', label: 'Automation Opportunity', confidence: 'high', matchedKeywords: ['automating', 'automated', 'automation'] },
      { type: 'opportunity', label: 'Scale Readiness', confidence: 'high', matchedKeywords: ['growth', 'increases'] },
      { type: 'strength', label: 'Change Readiness', confidence: 'high', matchedKeywords: ['ready'] },
    ],
    linkedBottlenecks: [],
    maturityIndicator: 3,
  },
  {
    questionId: 14,
    questionText: 'If a clear plan showed real time savings, cost reduction, or revenue improvement — what would realistically stop you from moving forward?',
    category: 'Intent, Outcomes & Constraints',
    answer: 'Budget is a concern — we\'re tight on cash. But if ROI is clear and fast, I can find $10-15K. Main worry is implementation time — I don\'t have bandwidth to manage a long project while running the business. Team might resist change too, they\'re comfortable with current chaos. But honestly, we can\'t afford NOT to change.',
    detectedSignals: [
      { type: 'risk', label: 'Scale-Breaking Risk', confidence: 'medium', matchedKeywords: ['can\'t afford'] },
      { type: 'strength', label: 'Change Readiness', confidence: 'medium', matchedKeywords: ['ready'] },
    ],
    linkedBottlenecks: [],
    maturityIndicator: 3,
  },
];

const getMockDiagnosticSummary = (leadId: string): DiagnosticSummary => {
  // ── ExampleCo: Gold-standard v1 schema output ──
  if (leadId === 'lead_010') {
    return getExampleCoDiagnostic(leadId);
  }

  // Build bottleneck source map from annotated responses
  const bottleneckSourceMap: Record<string, number[]> = {};
  for (const resp of MOCK_ANNOTATED_RESPONSES) {
    for (const bn of resp.linkedBottlenecks) {
      if (!bottleneckSourceMap[bn]) bottleneckSourceMap[bn] = [];
      if (!bottleneckSourceMap[bn].includes(resp.questionId)) {
        bottleneckSourceMap[bn].push(resp.questionId);
      }
    }
  }

  return {
    leadId,
    coreProblems: [
      {
        title: 'Customer Service Bottleneck',
        whatsbroken: 'Support team underwater with 200+ tickets/week. Response time 24+ hours.',
        whyBreaking: 'Reactive support model. No self-service. Manual responses to repetitive questions.',
        whatBreaksNext: 'Growth will cause 3-4 day response times. Customer satisfaction collapse. Negative reviews.',
        urgencyScore: 9,
        editable: true,
        bottleneckId: 'customer-experience',
        sourceAnswers: [6, 7, 9],
      },
      {
        title: 'Multi-Channel Inventory Chaos',
        whatsbroken: 'Manual inventory sync across website, Amazon, social. Causing oversells 2-3x per week.',
        whyBreaking: 'Spreadsheet-based tracking. Human error in data entry. No real-time visibility.',
        whatBreaksNext: 'More channels = more oversells. Brand reputation damage. Refund costs escalating.',
        urgencyScore: 8,
        editable: true,
        bottleneckId: 'data-fragmentation',
        sourceAnswers: [1, 4, 10, 11],
      },
      {
        title: 'High Customer Acquisition Costs',
        whatsbroken: 'CAC increasing 15% quarter-over-quarter. Over-reliant on paid ads.',
        whyBreaking: 'No retention marketing. Poor email automation. Limited organic channels.',
        whatBreaksNext: 'Margin compression. Unprofitable unit economics. Growth becomes impossible.',
        urgencyScore: 7,
        editable: true,
        bottleneckId: 'revenue-leakage',
        sourceAnswers: [6, 9],
      }
    ],
    pillarHeatmap: {
      operationsExecution: 3,
      revenueGrowth: 4,
      systemsAutomation: 2,
      aiReadinessGovernance: 4
    },
    riskFlags: [
      {
        type: 'scale-risk',
        label: 'Scale Risk',
        description: 'Current operations cannot handle 30%+ growth without breaking',
        severity: 'critical'
      },
      {
        type: 'tool-chaos',
        label: 'Tool Chaos',
        description: '8+ disconnected tools with manual data transfer between them',
        severity: 'high'
      },
      {
        type: 'founder-dependency',
        label: 'Founder Dependency',
        description: 'Founder approves every customer service escalation',
        severity: 'medium'
      }
    ],
    allResponses: MOCK_ANNOTATED_RESPONSES.map(r => ({
      question: r.questionText,
      answer: r.answer,
      category: r.category,
    })),
    annotatedResponses: MOCK_ANNOTATED_RESPONSES,
    bottleneckSourceMap,

    // ── Section A — Executive Diagnostic Overview ──
    executiveOverview: {
      readinessScore: 34,
      readinessCategory: 'Fragmented',
      confidenceLevel: 'High (87%)',
      growthRiskIndicator: 'Critical',
      primaryBottleneckTheme: 'Manual Operations & Reactive Support',
      primaryBottleneckId: 'B1',
      secondaryBottleneck: 'Multi-Channel Data Fragmentation',
      secondaryBottleneckId: 'B2',
      estimatedAnnualImpactRange: '$180K–$320K',
      summaryNarrative:
        'Acme Fashion Co. operates in a highly manual, reactive mode with 8+ disconnected tools creating compounding inefficiencies across fulfillment, support, and inventory. ' +
        'The founder is a critical bottleneck for approvals and escalations, limiting team autonomy and creating a single point of failure. ' +
        'Customer support response times are deteriorating under volume pressure, directly threatening retention and brand reputation. ' +
        'Cart abandonment at 65%+ with no systematic recovery represents the largest immediate revenue leak. ' +
        'Without intervention, a 20-30% growth surge would cascade into support collapse, fulfillment errors, and stockouts within weeks.',
      confidenceScore: 87,
    },

    // ── Section B — Bottleneck Deep Dives ──
    bottleneckDeepDives: [
      {
        id: 'B1',
        title: 'Customer Service Bottleneck & Reactive Support Model',
        severity: 'Critical',
        category: 'Revenue',
        patternStrength: 12,
        causalChain: [
          'Support team handles 200+ tickets/week manually with no automation or self-service',
          'Response times exceed 24 hours — repeat queries (order status, returns) consume 70% of bandwidth',
          'Customer satisfaction drops, negative reviews accelerate, and repeat purchase rate collapses',
          'Team burnout leads to higher turnover, requiring constant rehiring and retraining',
          'Support quality collapse drives churn cascade — each lost customer costs 5x acquisition to replace',
        ] as [string, string, string, string, string],
        stressSimulation: {
          growth_20_percent: 'Response times jump from 24hr to 3-4 days. Customer satisfaction scores drop below recovery threshold.',
          growth_30_percent: 'Support queue becomes unmanageable. Cancellations spike 40%+. Negative review velocity triples.',
          founder_absence: 'Escalation path breaks. Refund approvals halt. VIP customers get same slow treatment as tier-1.',
          system_failure: 'Helpdesk outage means zero ticket visibility. Team reverts to email chaos with no tracking.',
        },
        rootCauseHierarchy: {
          level_1_symptom: 'Response times exceeding 24 hours and rising customer complaints',
          level_2_process_failure: 'No automated triage, no self-service portal, no proactive notifications',
          level_3_architecture_failure: 'Support system disconnected from order management — agents lack real-time context',
          level_4_governance_failure: 'No customer experience strategy — support treated as cost center, not retention driver',
        },
        quantifiedImpact: {
          revenue_leakage_estimate: 78000,
          payroll_inflation_risk: 90000,
          time_waste_hours_per_week: 35,
          growth_ceiling_percent: 15,
        },
        intervention: {
          short_term: 'Deploy AI chatbot for tier-1 queries (order status, FAQ, returns policy). Implement automated order status notifications to reduce inbound volume by 40-50%.',
          mid_term: 'Build self-service customer portal with order tracking, return initiation, and knowledge base. Integrate with Shopify for real-time data.',
          structural_redesign: 'Implement predictive support model — identify at-risk orders before customers complain. Automated satisfaction scoring, escalation routing, and proactive outreach.',
        },
        evidence: [
          { questionRef: 'Q6', questionId: 6, clientExcerpt: 'No follow-up until they reach out with a problem. No systematic retention or repurchase automation at all.', aiInterpretation: 'Zero proactive customer lifecycle management. Every interaction is reactive.', structuralImplication: 'No systematic lifecycle management exists — every customer interaction is a cost, not an investment.' },
          { questionRef: 'Q7', questionId: 7, clientExcerpt: 'Customer support gets overwhelmed first — response times balloon from hours to days.', aiInterpretation: 'Confirmed scalability failure. Support is the first domino in the collapse cascade.', structuralImplication: 'Support capacity is person-dependent with no elastic scaling mechanism.' },
          { questionRef: 'Q9', questionId: 9, clientExcerpt: 'Slow support causes cancellations and bad reviews on social.', aiInterpretation: 'Direct revenue impact confirmed. Support quality is now a revenue leakage channel.', structuralImplication: 'Support failures cascade directly into revenue loss and brand damage.' },
          { questionRef: 'Q8', questionId: 8, clientExcerpt: 'Categorizing and responding to "where is my order" support tickets (same answer every time).', aiInterpretation: 'High-volume, low-complexity tickets consuming human bandwidth. Classic automation candidate.', structuralImplication: 'No automated workflows exist for repeatable operations — team does machine work manually.' },
        ],
        bottleneckId: 'B1',
      },
      {
        id: 'B2',
        title: 'Multi-Channel Inventory & Data Fragmentation',
        severity: 'High',
        category: 'Operations',
        patternStrength: 10,
        causalChain: [
          'Inventory managed via spreadsheets across 3+ sales channels with no automated sync',
          'Daily discrepancies between warehouse counts and online listings cause oversells 2-3x/week',
          'Founder spends 2-3 hours/day manually reconciling inventory across platforms',
          '8 disconnected tools create data silos — marketing, support, and fulfillment each have different versions of reality',
          'Adding any new channel multiplies coordination burden exponentially — growth becomes operationally impossible',
        ] as [string, string, string, string, string],
        stressSimulation: {
          growth_20_percent: 'Data sync delays multiply. Oversell frequency doubles. Customer complaints about wrong availability spike.',
          growth_30_percent: 'Spreadsheet-based tracking breaks completely. Founder cannot manually reconcile at this volume.',
          founder_absence: 'Inventory reconciliation stops. No one else knows the cross-platform workflow. Stockouts within days.',
          system_failure: 'Single spreadsheet corruption or platform API change breaks the entire inventory chain.',
        },
        rootCauseHierarchy: {
          level_1_symptom: 'Daily inventory discrepancies and 2-3 oversells per week across channels',
          level_2_process_failure: 'Each platform managed independently — no automated sync or reconciliation process',
          level_3_architecture_failure: 'No unified data layer connecting Shopify, warehouse, and marketplace systems',
          level_4_governance_failure: 'No technology governance — tools adopted reactively with no integration plan',
        },
        quantifiedImpact: {
          revenue_leakage_estimate: 48000,
          payroll_inflation_risk: 45000,
          time_waste_hours_per_week: 18,
          growth_ceiling_percent: 20,
        },
        intervention: {
          short_term: 'Implement inventory sync tool (e.g., Stocky or custom Shopify integration) to eliminate manual cross-platform updates.',
          mid_term: 'Build unified data layer connecting Shopify, fulfillment, email, and support tools. Real-time operational dashboard.',
          structural_redesign: 'Implement predictive inventory management with automated reorder triggers based on sales velocity, seasonality, and lead times. API-first architecture for any future channel.',
        },
        evidence: [
          { questionRef: 'Q1', questionId: 1, clientExcerpt: 'Inventory alerts because our spreadsheet counts are off again.', aiInterpretation: 'Spreadsheet-based inventory is structurally unreliable.', structuralImplication: 'No data validation or reconciliation process exists — errors are the norm, not exceptions.' },
          { questionRef: 'Q4', questionId: 4, clientExcerpt: 'Inventory counts differ between warehouse spreadsheet and website daily.', aiInterpretation: 'Confirmed daily data integrity failures across channels.', structuralImplication: 'Multiple systems hold overlapping data with no sync mechanism.' },
          { questionRef: 'Q10', questionId: 10, clientExcerpt: '8 disconnected tools creating manual work. Nothing talks to each other.', aiInterpretation: 'Tool fragmentation is systemic, not a single-tool problem.', structuralImplication: 'No unified data layer or middleware connecting core systems.' },
          { questionRef: 'Q2', questionId: 2, clientExcerpt: 'I personally update inventory across 3 platforms daily (2-3 hours).', aiInterpretation: 'Founder time consumed by data entry. Most expensive manual labor in the org.', structuralImplication: 'Highest-cost employee performing lowest-value work — maximum payroll misallocation.' },
        ],
        bottleneckId: 'B2',
      },
      {
        id: 'B3',
        title: 'Revenue Leakage & Retention Deficit',
        severity: 'High',
        category: 'Revenue',
        patternStrength: 6,
        causalChain: [
          '65%+ cart abandonment with only a single manual recovery email sent 24 hours later',
          'Zero post-purchase lifecycle automation means every sale is treated as a one-time transaction',
          'Customer acquisition costs rising 15% QoQ with no retention flywheel to offset',
          'Repeat purchase rate suppressed — business pays full acquisition cost for returning customers',
          'Unit economics become unsustainable as CAC rises and LTV stays flat — margin compression accelerates',
        ] as [string, string, string, string, string],
        stressSimulation: {
          growth_20_percent: 'More leads enter broken funnel. Absolute dollar loss grows proportionally while conversion stays flat.',
          growth_30_percent: 'Ad spend increases faster than revenue. Unit economics deteriorate as funnel efficiency drops.',
          founder_absence: 'No one monitors or adjusts recovery flows. Cart abandonment losses accumulate unnoticed.',
          system_failure: 'Email platform outage means zero recovery on all abandoned carts during downtime.',
        },
        rootCauseHierarchy: {
          level_1_symptom: 'Revenue lost through abandoned carts, suppressed repeat purchases, and rising CAC',
          level_2_process_failure: 'No systematic customer lifecycle management from acquisition to retention to expansion',
          level_3_architecture_failure: 'CRM, marketing, and support systems disconnected — no unified customer view',
          level_4_governance_failure: 'No revenue operations discipline — customer lifecycle not treated as a managed system',
        },
        quantifiedImpact: {
          revenue_leakage_estimate: 114000,
          payroll_inflation_risk: 25000,
          time_waste_hours_per_week: 8,
          growth_ceiling_percent: 25,
        },
        intervention: {
          short_term: 'Activate Klaviyo flows: abandoned cart (multi-touch, <1hr trigger), post-purchase sequence, win-back series.',
          mid_term: 'Build customer segmentation model based on purchase history and support interactions. Personalized retention campaigns.',
          structural_redesign: 'Implement predictive churn model and LTV optimization. Automated loyalty program with tiered incentives. Closed-loop attribution connecting every touchpoint to revenue.',
        },
        evidence: [
          { questionRef: 'Q6', questionId: 6, clientExcerpt: '65%+ abandonment rate. We manually send recovery email 24 hours later.', aiInterpretation: 'Cart recovery is both delayed (24hr) and limited (single touch). Massive gap vs. best practice.', structuralImplication: 'No automated workflows exist for the highest-ROI customer touchpoint.' },
          { questionRef: 'Q9', questionId: 9, clientExcerpt: 'Customers don\'t repurchase because zero retention automation. Easily $5-8K lost revenue per month.', aiInterpretation: 'Client self-estimates $60-96K/yr from retention alone. Actual figure likely higher.', structuralImplication: 'Customer lifecycle is not treated as a managed system — no revenue operations discipline.' },
        ],
        bottleneckId: 'B3',
      },
    ],

    // ── Section C — Cross-System Patterns ──
    systemicPatterns: [
      {
        patternName: 'Manual dependency signals detected across multiple workflows',
        severity: 'High',
        signalCount: 8,
        crossDepartmentalPresence: true,
        failureCascadePotential: 'Manual errors compound downstream into fulfillment, billing, and customer experience failures',
        recurrenceProbability: 0.92,
      },
      {
        patternName: 'Tool fragmentation creating data silos between departments',
        severity: 'High',
        signalCount: 5,
        crossDepartmentalPresence: true,
        failureCascadePotential: 'Disconnected systems create cascading data inconsistencies across all dependent processes',
        recurrenceProbability: 0.88,
      },
      {
        patternName: 'Founder/leadership approval bottleneck constraining team velocity',
        severity: 'Moderate',
        signalCount: 3,
        crossDepartmentalPresence: false,
        failureCascadePotential: 'Approval delays cascade into missed deadlines, lost opportunities, and team disengagement',
        recurrenceProbability: 0.72,
      },
      {
        patternName: 'Scale-breaking risk confirmed across operations, support, and fulfillment',
        severity: 'High',
        signalCount: 4,
        crossDepartmentalPresence: true,
        failureCascadePotential: 'Operational fragility cascades from customer-facing operations into team morale and retention',
        recurrenceProbability: 0.85,
      },
    ],

    // ── Section D — Pillar Interpretations ──
    pillarInterpretations: {
      operationsExecution: {
        interpretation: 'Operations run on manual coordination and tribal knowledge. Processes exist but are undocumented, person-dependent, and break under volume pressure.',
        dominantWeakness: 'No automated handoffs between fulfillment, support, and inventory management',
        automationLeveragePotential: 'Maximum leverage — even basic automation would transform throughput. Start with highest-volume tasks.',
      },
      revenueGrowth: {
        interpretation: 'Revenue generation is functional but leaking significantly through abandoned carts, zero retention automation, and rising acquisition costs.',
        dominantWeakness: 'Complete absence of post-purchase lifecycle automation',
        automationLeveragePotential: 'High leverage — automated cart recovery and retention flows are low-effort, high-ROI wins.',
      },
      systemsAutomation: {
        interpretation: 'Tool stack is fragmented with 8+ disconnected systems requiring manual data transfer. No integration layer exists. Automation maturity is near-zero.',
        dominantWeakness: 'No system-to-system integration — every data transfer is manual',
        automationLeveragePotential: 'Maximum leverage — integration middleware would eliminate hours of daily manual data entry.',
      },
      aiReadinessGovernance: {
        interpretation: 'Team shows strong change readiness and clear understanding of automation value. No AI governance framework exists, but foundation for adoption is solid.',
        dominantWeakness: 'No data governance or AI readiness framework in place, despite willingness',
        automationLeveragePotential: 'Focus on data foundation first — clean, integrated data is prerequisite for any AI initiative.',
      },
    },

    // ── Section E — Financial & Efficiency Model ──
    financialModel: {
      directRevenuLeakage: 114000,
      hiddenOperationalDrag: 56000,
      payrollMisallocation: 160000,
      opportunityCost: 57000,
      compoundingGrowthTax: 41000,
      totalEstimatedAnnualImpact: 428000,
      directRevenuLeakageFormatted: '$114K',
      hiddenOperationalDragFormatted: '$56K',
      payrollMisallocationFormatted: '$160K',
      opportunityCostFormatted: '$57K',
      compoundingGrowthTaxFormatted: '$41K',
      totalEstimatedAnnualImpactFormatted: '$428K',
    },

    // ── Section F — Enhanced Risk Assessment ──
    enhancedRisks: [
      {
        riskType: 'Scalability',
        severity: 'Critical',
        triggerThreshold: '+20% volume increase or new channel expansion',
        probabilityPercent: 88,
        timeToFailureEstimate: '2-4 weeks under sustained growth pressure',
        cascadePath: 'Operations → Customer Experience → Revenue → Team Morale → Retention',
      },
      {
        riskType: 'Data',
        severity: 'High',
        triggerThreshold: 'New sales channel integration or seasonal volume spike',
        probabilityPercent: 82,
        timeToFailureEstimate: '3-6 weeks before critical data errors impact customers',
        cascadePath: 'Data Quality → Decision Quality → Strategic Misalignment → Revenue Impact',
      },
      {
        riskType: 'Dependency',
        severity: 'High',
        triggerThreshold: 'Founder vacation, illness, or multi-project overload',
        probabilityPercent: 75,
        timeToFailureEstimate: '1-2 weeks during founder absence',
        cascadePath: 'Decision Delay → Team Paralysis → Customer Impact → Revenue Stall',
      },
      {
        riskType: 'Compliance',
        severity: 'Moderate',
        triggerThreshold: 'Employee departure or audit request',
        probabilityPercent: 55,
        timeToFailureEstimate: '1-3 months before knowledge gap creates liability',
        cascadePath: 'Undocumented Processes → Knowledge Loss → Inconsistent Execution → Regulatory Exposure',
      },
    ],

    // ── Confidence & Integrity Layer ──
    confidenceLayer: {
      totalSignalsDetected: 38,
      corroboratedPatterns: 4,
      contradictionFlags: 1,
      weakSignalFlags: 2,
      aiConfidenceScore: 0.87,
    },
  };
};

// ============================================================================
// MOCK SERVICE RECOMMENDATION
// ============================================================================

const getIndustryRecommendationConfig = (industry: string, company: string): {
  primaryService: string;
  primaryServiceLabel: string;
  reasoning: string;
} => {
  switch (industry) {
    case 'E-commerce / DTC':
      return {
        primaryService: 'automation-sprint',
        primaryServiceLabel: 'Automation Sprint',
        reasoning: 'Customer service bottleneck is the most urgent constraint blocking scale. AI chatbot + order status automation can reduce ticket volume 40-50% in 30 days with low implementation risk. This creates breathing room for strategic work and proves ROI fast.',
      };
    case 'SaaS / Software':
      return {
        primaryService: 'onboarding-automation',
        primaryServiceLabel: 'Onboarding Automation',
        reasoning: 'Manual onboarding is causing churn. Automating the onboarding process can reduce churn by 20-30% in 30 days. This will improve customer satisfaction and retention, leading to higher revenue and faster growth.',
      };
    case 'Agency / Services':
      return {
        primaryService: 'founder-leverage-package',
        primaryServiceLabel: 'Founder Leverage Package',
        reasoning: 'Founder approval bottleneck is slowing down the team. A founder leverage package can reduce the need for founder approval on routine decisions, freeing up the founder to focus on strategic work. This will improve team efficiency and enable faster growth.',
      };
    case 'Healthcare / Medical':
      return {
        primaryService: 'compliance-systems-audit',
        primaryServiceLabel: 'Compliance + Systems Audit',
        reasoning: 'Compliance risk with manual patient data handling is a major concern. A compliance and systems audit can identify and mitigate compliance risks, ensuring data integrity and reducing the risk of fines or legal issues. This will improve patient safety and trust in the brand.',
      };
    default:
      return {
        primaryService: 'automation-sprint',
        primaryServiceLabel: 'Automation Sprint',
        reasoning: 'Customer service bottleneck is the most urgent constraint blocking scale. AI chatbot + order status automation can reduce ticket volume 40-50% in 30 days with low implementation risk. This creates breathing room for strategic work and proves ROI fast.',
      };
  }
};

const getMockServiceRecommendation = (leadId: string): ServiceRecommendation => {
  const lead = getMockLeads().find(l => l.id === leadId) || getMockLeads()[0];
  const industry = lead.industry;
  const company = lead.companyName;

  // Industry-aware service recommendation + blueprint
  const industryConfig = getIndustryRecommendationConfig(industry, company);

  return {
    primaryService: industryConfig.primaryService,
    primaryServiceLabel: industryConfig.primaryServiceLabel,
    reasoning: industryConfig.reasoning,
    notRecommended: [
      {
        service: 'Full Platform Migration',
        reason: 'Too risky and expensive before proving quick wins. Current Shopify setup is sufficient.'
      },
      {
        service: 'Large-Scale Hiring',
        reason: 'Adding headcount now just scales the broken process. Fix the system first.'
      }
    ],
    focusAreas: [
      'AI chatbot for tier-1 support (FAQ, order status, returns)',
      'Automated order status emails (proactive communication)',
      'Self-service order tracking portal',
      'Fulfillment partner API integration (eliminate manual entry)'
    ],
    suggestedTimeline: '30-day sprint with phased rollout',
    recommendationStatus: 'pending',
    solutionBlueprint: getIndustryBlueprint(industry, company),
    // ── v1 schema extensions ──
    confidenceScore: 0.82,
    expectedImpact: {
      revenueLiftPercent: 18,
      costReductionPercent: 22,
      timeSavedHoursMonth: 64,
    },
    implementationWindowDays: 30,
    investmentSummary: {
      estimatedCostRange: '$10K–$25K',
      paybackPeriodWeeks: '6–10 weeks',
      roiPercent12Month: '320%',
    },
    // ── v2 schema — full structured recommendation ──
    recommendationV2: {
      recommendation_id: `rec-mock-${leadId}`,
      version: 'v2' as const,
      calc_version: 1,
      core_problem: {
        problem_id: 'operations',
        problem_title: industryConfig.primaryServiceLabel === 'Systems Integration'
          ? 'Tool & System Fragmentation'
          : 'Manual Process Dependency',
        severity_score: 8,
        pillar_impact: ['operations', 'software', 'growth'] as ('operations' | 'software' | 'growth')[],
      },
      strategic_decision: {
        why_now: `Critical operational drag detected across ${company}'s core workflows. Every week of delay compounds revenue leakage and team burnout. The current manual processes are fundamentally incompatible with 2x growth — intervention now prevents a significantly more expensive remediation later.`,
        why_first: industryConfig.reasoning,
        expected_time_to_impact_days: 30,
      },
      impact_profile: {
        impact_type: ['cost_reduction', 'efficiency', 'revenue_growth'] as ('cost_reduction' | 'efficiency' | 'revenue_growth')[],
        primary_metric: 'Manual hours per week',
        baseline_value: 45,
        target_value_30d: 32,
        target_value_60d: 20,
        target_value_90d: 11,
        unit: 'hours' as const,
      },
      execution_plan: {
        total_duration_days: 30,
        phases: [
          { phase_id: 'phase_1', title: 'Discovery & Mapping', duration_days: 10, objectives: ['Map current manual processes end-to-end', 'Quantify time waste per workflow', 'Identify automation-ready candidates'], deliverables: ['Process map document', 'Time-waste audit report', 'Automation candidate matrix'], dependencies: [] },
          { phase_id: 'phase_2', title: 'Build & Automate', duration_days: 15, objectives: ['Build and test automated workflows', 'Integrate key system connections', 'Deploy monitoring dashboards'], deliverables: ['Live automated workflows', 'System integration connectors', 'Operations dashboard'], dependencies: ['phase_1'] },
          { phase_id: 'phase_3', title: 'Optimize & Handoff', duration_days: 5, objectives: ['Validate automation accuracy', 'Train team on new workflows', 'Set up ongoing KPI tracking'], deliverables: ['Training documentation', 'KPI tracking system', 'Post-sprint optimization plan'], dependencies: ['phase_2'] },
        ],
      },
      resource_requirements: [
        { role: 'Process Automation Engineer', allocation_percent: 80, active_phase: 'phase_1' },
        { role: 'Operations Analyst', allocation_percent: 60, active_phase: 'phase_1' },
        { role: 'Project Manager', allocation_percent: 40, active_phase: 'phase_2' },
      ],
      risk_profile: [
        { risk_id: 'risk_1', probability: 'medium' as const, impact: 'medium' as const, mitigation: 'Involve team in design, run parallel for 2 weeks' },
        { risk_id: 'risk_2', probability: 'medium' as const, impact: 'high' as const, mitigation: 'API-first approach, modular integration layers' },
        { risk_id: 'risk_3', probability: 'low' as const, impact: 'high' as const, mitigation: 'Data cleanup sprint in Phase 1' },
      ],
      assumptions_used: [
        'Analysis based on 14 of 14 questions answered (100% completeness).',
        `Employee estimate: ~${lead.companySize || '25'} team members.`,
        `Industry context: ${industry}. Scoring adjusted for industry-specific weight factors.`,
        'Financial projections assume 60% of identified time waste is recoverable through automation.',
        'ROI calculations use conservative multipliers and assume partial adoption in the first 30 days.',
      ],
      feasibility: {
        technical_feasibility: 8, data_readiness: 8, organizational_readiness: 8,
        change_complexity: 4, computed_feasibility: 6.8, high_execution_risk: false,
      },
      evidence_strength: {
        validated_signals: 8, cross_department_validations: 3,
        contradiction_flags: 0, weak_signal_flags: 1, computed_evidence: 4.0,
      },
      confidence_model: {
        confidence_score: 82,
        confidence_reasoning: 'High confidence (82/100). Strong priority (2.8), solid feasibility (2.0), robust evidence (1.2).',
        formula_inputs: { priority_component: 2.8, feasibility_component: 2.0, evidence_component: 1.2 },
      },
      roi_eligibility: {
        has_measurable_baseline: true, has_defined_kpi: true, has_timeline: true,
        feasibility_above_5: true, confidence_above_60: true,
        is_roi_eligible: true, gate_failures: [],
      },
      priority_score: {
        impact_score: 8, feasibility_score: 7, risk_score: 4, computed_priority: 7.1,
      },
    },
    decisionTransparency: {
      ranked_domains: [
        { rank: 1, domain: 'operations' as const, label: 'Operations & Execution', score: 78, severity: 'High', is_primary: true, pain_signal_count: 8 },
        { rank: 2, domain: 'systems' as const, label: 'Systems & Automation', score: 62, severity: 'High', is_primary: false, pain_signal_count: 5 },
        { rank: 3, domain: 'revenue' as const, label: 'Revenue & Growth', score: 45, severity: 'Moderate', is_primary: false, pain_signal_count: 4 },
        { rank: 4, domain: 'governance' as const, label: 'AI Readiness & Governance', score: 38, severity: 'Moderate', is_primary: false, pain_signal_count: 3 },
        { rank: 5, domain: 'customer_experience' as const, label: 'Customer Experience', score: 28, severity: 'Moderate', is_primary: false, pain_signal_count: 2 },
        { rank: 6, domain: 'data' as const, label: 'Data & Visibility', score: 22, severity: 'Low', is_primary: false, pain_signal_count: 1 },
      ],
      score_gap_analysis: {
        primary_domain: 'operations' as const, primary_score: 78,
        secondary_domain: 'systems' as const, secondary_score: 62,
        gap_points: 16, gap_percent: 21, is_hybrid: false,
        gap_interpretation: 'Strong separation. 16-point gap provides high confidence in prioritization. Secondary domain should be addressed in Phase 2.',
      },
      confidence_factors: {
        data_completeness: { value: 0.92, weight: 0.30, contribution: 0.276 },
        answer_quality: { value: 0.75, weight: 0.20, contribution: 0.150 },
        score_gap_clarity: { value: 0.53, weight: 0.30, contribution: 0.160 },
        signal_density: { value: 0.83, weight: 0.20, contribution: 0.167 },
        final_confidence: 0.82,
      },
      why_not_others: [
        { domain: 'systems' as const, label: 'Systems & Automation', score: 62, delta_from_primary: 16, reasoning: 'Systems is a secondary concern (score: 62/100). Fixing operations first creates the infrastructure to address systems in Phase 2.' },
        { domain: 'revenue' as const, label: 'Revenue & Growth', score: 45, delta_from_primary: 33, reasoning: 'Revenue scored 33 points below Operations. Addressing operations first will improve revenue as a downstream effect.' },
        { domain: 'governance' as const, label: 'AI Readiness & Governance', score: 38, delta_from_primary: 40, reasoning: 'Governance scored 40 points below the primary. Foundation must be built before governance can be restructured.' },
      ],
      data_quality: {
        questions_answered: 14, total_questions: 14, avg_word_count: 42,
        completeness_pct: 100, quality_grade: 'B' as const,
        quality_interpretation: 'Good data quality. Most questions answered with sufficient detail for reliable analysis.',
      },
      scoring_formula: {
        pain_weight: 0.40, causal_weight: 0.30, maturity_weight: 0.20, cross_dept_weight: 0.10,
        industry_adjustment_applied: true, industry,
      },
    },
    portfolio: {
      portfolio_id: `ptf-mock-${leadId}`,
      business_snapshot: { company, industry, employee_estimate: parseInt(lead.companySize) || 25, data_completeness: 0.92, total_signals_detected: 12 },
      department_scan: [
        { department: 'operations_supply_chain' as const, label: 'Operations & Supply Chain', problem_density_score: 8, impact_potential_score: 8, automation_feasibility_score: 9, risk_exposure_score: 3, computed_priority: 7.1, qualifies: true, source_domains: ['operations' as const] },
        { department: 'data_infrastructure' as const, label: 'Data & Infrastructure', problem_density_score: 6, impact_potential_score: 6, automation_feasibility_score: 8, risk_exposure_score: 5, computed_priority: 5.3, qualifies: true, source_domains: ['data' as const, 'systems' as const] },
        { department: 'revenue_engine' as const, label: 'Revenue Engine', problem_density_score: 6, impact_potential_score: 5, automation_feasibility_score: 7, risk_exposure_score: 5, computed_priority: 4.6, qualifies: false, source_domains: ['revenue' as const] },
        { department: 'customer_experience' as const, label: 'Customer Experience', problem_density_score: 4, impact_potential_score: 3, automation_feasibility_score: 8, risk_exposure_score: 3, computed_priority: 3.7, qualifies: false, source_domains: ['customer_experience' as const] },
        { department: 'talent_process' as const, label: 'Talent & Process', problem_density_score: 5, impact_potential_score: 4, automation_feasibility_score: 7, risk_exposure_score: 6, computed_priority: 3.7, qualifies: false, source_domains: ['governance' as const] },
        { department: 'marketing_acquisition' as const, label: 'Marketing & Acquisition', problem_density_score: 4, impact_potential_score: 4, automation_feasibility_score: 7, risk_exposure_score: 5, computed_priority: 3.7, qualifies: false, source_domains: ['revenue' as const, 'customer_experience' as const] },
        { department: 'finance_unit_economics' as const, label: 'Finance & Unit Economics', problem_density_score: 3, impact_potential_score: 3, automation_feasibility_score: 7, risk_exposure_score: 5, computed_priority: 3.0, qualifies: false, source_domains: ['revenue' as const, 'operations' as const] },
      ],
      recommendations: [],
      global_priority_ranking: [
        { recommendation_id: 'rec-ops', department: 'operations_supply_chain' as const, rank: 1, computed_priority: 7.1, cumulative_investment_at_rank: '$18K' },
        { recommendation_id: 'rec-data', department: 'data_infrastructure' as const, rank: 2, computed_priority: 5.3, cumulative_investment_at_rank: '$43K' },
      ],
      cross_dependencies: [
        { source_recommendation_id: 'rec-ops', source_department: 'operations_supply_chain' as const, target_recommendation_id: 'rec-data', target_department: 'data_infrastructure' as const, dependency_type: 'enhances' as const, description: 'Operational automation generates structured data for infrastructure' },
        { source_recommendation_id: 'rec-data', source_department: 'data_infrastructure' as const, target_recommendation_id: 'rec-ops', target_department: 'operations_supply_chain' as const, dependency_type: 'required_before' as const, description: 'Data foundation required before advanced automation' },
      ],
      capital_allocation_model: {
        total_estimated_investment: '$43K', total_risk_exposure_score: 37,
        allocations: [
          { recommendation_id: 'rec-ops', department: 'operations_supply_chain' as const, percent_of_budget: 42, estimated_cost: '$18K' },
          { recommendation_id: 'rec-data', department: 'data_infrastructure' as const, percent_of_budget: 58, estimated_cost: '$25K' },
        ],
        capital_efficiency_ranking: [
          { recommendation_id: 'rec-ops', department: 'operations_supply_chain' as const, roi_per_dollar: 3.6 },
          { recommendation_id: 'rec-data', department: 'data_infrastructure' as const, roi_per_dollar: 2.1 },
        ],
      },
      execution_sequence_model: {
        recommended_execution_order: ['rec-ops', 'rec-data'],
        parallel_eligible: [],
        critical_path: ['rec-ops', 'rec-data'],
        total_duration_days: 60,
        sequence_reasoning: '2 departments qualify for intervention (density ≥ 6 AND impact ≥ 6). Sequence follows Cortex Rules: Fix operational bottlenecks before growth acceleration; Fix constraints before optimization. Priority = impact×0.4 + automation×0.3 + density×0.2 - risk×0.1.',
        sequencing_rules_applied: ['Fix constraints before optimization', 'Fix operational bottlenecks before growth acceleration'],
      },
    },
  };
};

// ============================================================================
// MOCK ROI ESTIMATE
// ============================================================================

const getMockROIEstimate = (leadId: string): ROIEstimate => {
  // Build 12-month projections
  const monthlyProjections: ROIEstimate['monthlyProjections'] = [];
  const totalInvestment = 15000;
  let cumulativeSavings = 0;

  for (let m = 1; m <= 12; m++) {
    // Ramp-up curve: benefits increase over first 3 months, then stabilize
    const rampFactor = m <= 1 ? 0.3 : m <= 2 ? 0.6 : m <= 3 ? 0.85 : 1.0;
    const hoursSaved = Math.round(150 * rampFactor);
    const costAvoided = Math.round(10000 * rampFactor);
    const revenueRecovered = Math.round(8000 * rampFactor);
    const monthlyTotal = costAvoided + revenueRecovered;
    cumulativeSavings += monthlyTotal;
    const investmentToDate = m <= 1 ? totalInvestment : totalInvestment;

    monthlyProjections.push({
      month: m,
      label: `Month ${m}`,
      hoursSaved,
      costAvoided,
      revenueRecovered,
      cumulativeROI: cumulativeSavings,
      investmentToDate,
      netValue: cumulativeSavings - investmentToDate,
    });
  }

  return {
    hoursSavedPerMonth: {
      conservative: 120,
      aggressive: 180
    },
    costAvoidedPerMonth: {
      conservative: 8000,
      aggressive: 12000
    },
    revenueLeakageReduced: {
      conservative: 5000,
      aggressive: 15000
    },
    operationalRiskReduction: 'very-high',
    notes: 'Conservative estimates based on 40% ticket reduction. Aggressive assumes 60% reduction after optimization. Does NOT include churn reduction value from faster response times.',
    confidenceLevel: 'conservative',

    monthlyProjections,

    scenarioComparison: {
      scenarios: [
        {
          name: 'Conservative',
          color: '#3B82F6',
          totalInvestment: 15000,
          year1Return: 156000,
          roi: 940,
          paybackMonths: 2,
          netPresentValue: 127000,
        },
        {
          name: 'Expected',
          color: '#8B5CF6',
          totalInvestment: 15000,
          year1Return: 216000,
          roi: 1340,
          paybackMonths: 1,
          netPresentValue: 183000,
        },
        {
          name: 'Aggressive',
          color: '#10B981',
          totalInvestment: 15000,
          year1Return: 324000,
          roi: 2060,
          paybackMonths: 1,
          netPresentValue: 278000,
        },
      ],
    },

    breakEvenAnalysis: {
      breakEvenMonth: 1,
      totalInvestment: 15000,
      monthlyBenefit: 18000,
      confidenceRange: { low: 1, high: 2 },
    },

    editableAssumptions: [
      { id: 'ticket-reduction', label: 'Support Ticket Reduction', value: 50, unit: '%', min: 20, max: 80, category: 'savings', description: 'Expected percentage reduction in tier-1 support tickets from AI chatbot' },
      { id: 'avg-ticket-cost', label: 'Avg Cost per Support Ticket', value: 12, unit: '$', min: 5, max: 30, category: 'cost', description: 'Fully-loaded cost including agent time, tools, and overhead' },
      { id: 'weekly-tickets', label: 'Current Weekly Ticket Volume', value: 200, unit: 'tickets', min: 50, max: 500, category: 'cost', description: 'Current average weekly support tickets before automation' },
      { id: 'cart-recovery-rate', label: 'Cart Recovery Rate', value: 15, unit: '%', min: 5, max: 30, category: 'revenue', description: 'Expected recovery rate from abandoned cart automation' },
      { id: 'avg-order-value', label: 'Average Order Value', value: 85, unit: '$', min: 30, max: 200, category: 'revenue', description: 'Average value of recovered cart orders' },
      { id: 'monthly-abandoned', label: 'Monthly Abandoned Carts', value: 800, unit: 'carts', min: 200, max: 2000, category: 'revenue', description: 'Number of abandoned carts per month eligible for recovery' },
      { id: 'inventory-error-cost', label: 'Monthly Inventory Error Cost', value: 3000, unit: '$', min: 500, max: 10000, category: 'savings', description: 'Monthly cost of oversells, stockouts, and manual corrections' },
      { id: 'hourly-rate', label: 'Effective Hourly Rate (Team)', value: 45, unit: '$', min: 20, max: 100, category: 'cost', description: 'Average effective hourly rate of team members freed from manual work' },
    ],
  };
};

// ============================================================================
// MOCK PORTFOLIO STATE (Version Control)
// ============================================================================

const getMockPortfolioState = (leadId: string, company: string, industry: string): import('@/app/core/types').PortfolioState => {
  const now = new Date().toISOString();
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  return {
    portfolio_id: `ptf-${leadId}`,
    lead_id: leadId,
    current_version: 'v2',
    created_at: yesterday,
    updated_at: now,
    inputs: {
      business_snapshot: { company, industry, employee_estimate: 25 },
      answers: {},
      assumptions: {
        monthly_revenue: 125000, avg_order_value: 85, monthly_orders: 1500,
        support_tickets_per_week: 100, avg_response_time_hours: 30,
        labor_cost_per_hour: 25, refund_rate_percent: 3.8,
        conversion_rate_percent: 2.1, gross_margin_percent: 42,
      },
      constraints: {
        max_roi_display_percent: 350, roi_must_be_range: true,
        confidence_floor_for_roi: 60, max_recommendations: 7,
        no_claims_without_assumptions: true,
      },
    },
    outputs: { diagnostic: null, recommendations: [], portfolio: null, roi: null, decision_transparency: null },
    history: [
      {
        version: 'v2', previous_version: 'v1', timestamp: now,
        actor: 'team_user', source: 'chat',
        delta_log: [
          { path: 'inputs.assumptions.support_tickets_per_week', old: 100, new_value: 220, reason: 'User clarified seasonal spike volume' },
        ],
        recalc: { scoring: true, portfolio: true, feasibility: true, confidence: true, roi: true, cortex_narrative: true },
        summary: '1 assumption updated: Tickets adjusted for seasonality. Recalculated: scoring, portfolio, feasibility, confidence, roi, narrative.',
      },
      {
        version: 'v1', previous_version: null, timestamp: yesterday,
        actor: 'system', source: 'initial',
        delta_log: [],
        recalc: { scoring: true, portfolio: true, feasibility: true, confidence: true, roi: true, cortex_narrative: true },
        summary: 'Initial diagnostic analysis complete.',
      },
    ],
  };
};

// ============================================================================
// MOCK PORTFOLIO ROI MODEL
// ============================================================================

const getMockPortfolioROI = (leadId: string): import('@/app/core/types').PortfolioROIModel => {
  return {
    recommendation_rois: [
      {
        recommendation_id: 'rec-ops',
        department: 'operations_supply_chain' as const,
        is_roi_eligible: true,
        inputs: {
          baseline_metric: 45,
          target_metric_90d: 11,
          investment_cost: 18000,
          confidence_score: 82,
          feasibility_score: 6.8,
          timeline_days: 30,
        },
        impact_calculations: {
          cost_reduction: { savings: 30600, formula: '34 hrs/mo × $75/hr × 12mo' },
          revenue_impact: { projected_gain: 12000, formula: 'Productivity gain → revenue enablement' },
          total_projected_gain: 42600,
        },
        raw_roi_percent: 137,
        adjusted_roi_percent: 112,
        roi_range: {
          low_case: { efficiency: 0.6 as const, gain: 25560, roi_percent: 34 },
          mid_case: { efficiency: 0.8 as const, gain: 34080, roi_percent: 73 },
          high_case: { efficiency: 1.0 as const, gain: 42600, roi_percent: 112 },
        },
        payback_months: 5.1,
        display: {
          investment: '$18K',
          gain_90d: '$11K',
          gain_12mo: '$43K',
          payback_timeline: '5.1 months',
          adjusted_roi_label: '112%',
          assumptions: [
            'Confidence-adjusted: raw 137% × (82/100) = 112%',
            'Investment: $18K (1x size multiplier)',
            'Baseline: 45 hours → Target (90d): 11 hours',
            'Timeline: 30 days',
          ],
        },
      },
      {
        recommendation_id: 'rec-data',
        department: 'data_infrastructure' as const,
        is_roi_eligible: true,
        inputs: {
          baseline_metric: 20,
          target_metric_90d: 6,
          investment_cost: 25000,
          confidence_score: 68,
          feasibility_score: 5.3,
          timeline_days: 30,
        },
        impact_calculations: {
          cost_reduction: { savings: 12600, formula: '14 errors/wk → hrs saved × $75/hr × 52wk' },
          risk_reduction: { expected_loss_avoided: 12500, formula: '25% prob × $50K exposure' },
          total_projected_gain: 25100,
        },
        raw_roi_percent: 0,
        adjusted_roi_percent: 0,
        roi_range: {
          low_case: { efficiency: 0.6 as const, gain: 15060, roi_percent: -27 },
          mid_case: { efficiency: 0.8 as const, gain: 20080, roi_percent: -13 },
          high_case: { efficiency: 1.0 as const, gain: 25100, roi_percent: 0 },
        },
        payback_months: 11.9,
        display: {
          investment: '$25K',
          gain_90d: '$6K',
          gain_12mo: '$25K',
          payback_timeline: '11.9 months',
          adjusted_roi_label: '0%',
          assumptions: [
            'Confidence-adjusted: raw 0% × (68/100) = 0%',
            'Investment: $25K (1x size multiplier)',
            'Baseline: 20 errors/wk → Target (90d): 6 errors/wk',
            'Dependency adjustment: revenue credit moved to downstream dept',
          ],
        },
      },
    ],
    portfolio_totals: {
      total_investment: 43000,
      total_investment_label: '$43K',
      total_adjusted_gain_90d: 17000,
      total_adjusted_gain_12mo: 67700,
      total_adjusted_roi_percent: 57,
      risk_adjusted_return: 50903,
    },
    portfolio_range: {
      low_case_total: 40620,
      mid_case_total: 54160,
      high_case_total: 67700,
      low_case_roi: -6,
      mid_case_roi: 26,
      high_case_roi: 57,
    },
    portfolio_payback_months: 7.6,
    execution_impact_curve: [
      { step: 1, recommendation_id: 'rec-ops', department: 'operations_supply_chain' as const, cumulative_investment: 18000, cumulative_gain_12mo: 42600, cumulative_roi_percent: 137 },
      { step: 2, recommendation_id: 'rec-data', department: 'data_infrastructure' as const, cumulative_investment: 43000, cumulative_gain_12mo: 67700, cumulative_roi_percent: 57 },
    ],
    dependency_adjustments: [
      {
        source_department: 'data_infrastructure' as const,
        target_department: 'operations_supply_chain' as const,
        adjustment_type: 'efficiency_credit_only' as const,
        description: 'data infrastructure enables operations supply chain — source gets efficiency credit only to prevent double counting.',
      },
    ],
  };
};

// ============================================================================
// MOCK PROPOSAL
// ============================================================================

const getMockProposal = (leadId: string): ProposalData => {
  return {
    leadId,
    clientContext: 'Fast-growing DTC fashion brand hitting scale constraints. Customer service bottleneck preventing growth. Strong tech foundation and team buy-in.',
    diagnosedProblems: [
      'Customer service team at capacity - response times at limit',
      'Manual inventory management across 3+ channels causing errors',
      'High CAC with limited retention marketing automation'
    ],
    recommendedServicePath: '30-Day Automation Sprint → Customer Service AI + Order Automation',
    timeline: '30-days',
    pricingBand: '$10K-$20K',
    pricingLocked: false,
    scopeItems: [
      'AI chatbot implementation (FAQ, order status, returns)',
      'Automated order notification system',
      'Self-service customer portal',
      'Fulfillment API integration',
      'Team training and handoff'
    ],
    exclusions: [
      'Marketing automation (separate scope)',
      'Platform migration',
      'Custom app development',
      'Ongoing managed services (separate retainer)'
    ],
    upsellNotes: 'After sprint success, natural expansion into: (1) Marketing automation stack, (2) Inventory management system, (3) Monthly optimization retainer.',
    generatedAt: '2026-01-27T10:00:00Z',
    lastModifiedBy: 'Sarah Kim'
  };
};

// ============================================================================
// MOCK CALL PREP
// ============================================================================

const getMockCallPrep = (leadId: string): CallPrep => {
  return {
    leadId,
    suggestedAgenda: [
      'Validate customer service pain (current volume, response times, team size)',
      'Understand peak season patterns and upcoming growth plans',
      'Confirm tool stack (Shopify, helpdesk, fulfillment partner)',
      'Discuss previous automation attempts (if any)',
      'Walk through quick win opportunities',
      'Set expectations for 30-day sprint approach'
    ],
    keyQuestionsToValidate: [
      'How many support tickets per week currently?',
      'What % of tickets are repetitive (order status, returns, etc.)?',
      'What helpdesk tool are you using?',
      'Do you have API access to fulfillment partner?',
      'What\'s the budget range for solving this problem?',
      'What does "success" look like in 30 days?'
    ],
    expectedObjections: [
      {
        objection: '"We tried a chatbot before and it didn\'t work"',
        response: 'Dig into what failed. Usually it\'s poor training data or no human handoff. Modern AI (GPT-4) + proper setup changes everything. Show examples.'
      },
      {
        objection: '"30 days seems too fast"',
        response: 'Emphasize it\'s a focused sprint on specific pain point, not full transformation. Quick wins prove value before larger investment.'
      },
      {
        objection: '"This sounds expensive"',
        response: 'Position against cost of NOT solving: hiring 2-3 more support reps = $120K+/year ongoing. This is one-time investment with permanent efficiency gain.'
      }
    ],
    doNotPitchYetWarnings: [
      '⚠️ Don\'t pitch full platform transformation - too big, too risky',
      '⚠️ Don\'t mention pricing until you\'ve validated pain and budget range',
      '⚠️ Don\'t oversell AI capabilities - under-promise, over-deliver'
    ],
    expansionSignalsToListenFor: [
      '💰 Mentions upcoming fundraise or recent funding',
      '📈 Plans to expand to new channels (international, B2B, etc.)',
      '🛠️ Frustration with other tools beyond customer service',
      '👥 Considering hiring several people soon',
      '⏰ Mentions upcoming peak season or product launch'
    ],
    scheduledFor: '2026-01-29T15:00:00Z',
    callNotes: ''
  };
};

// ============================================================================
// MOCK DECISION LOG
// ============================================================================

const getMockDecisionLog = (leadId: string): DecisionLog[] => {
  return [
    {
      leadId,
      timestamp: '2026-01-28T09:15:00Z',
      fromStatus: 'needs-review',
      toStatus: 'ready-for-call',
      reason: 'AI analysis complete. High confidence, clear pain point, good fit.',
      actionTakenBy: 'Marcus Chen',
      notes: 'Validated tech stack compatibility. Shopify + Gorgias is ideal setup for our automation.'
    },
    {
      leadId,
      timestamp: '2026-01-27T16:30:00Z',
      fromStatus: 'new',
      toStatus: 'needs-review',
      reason: 'Initial submission received. Triggering AI analysis.',
      actionTakenBy: 'System',
    }
  ];
};

// ============================================================================
// MOCK NEXT ACTIONS
// ============================================================================

const getMockNextActions = (leadId: string): NextAction[] => {
  return [
    {
      leadId,
      action: 'Send call prep email with agenda',
      priority: 'high',
      dueDate: '2026-01-28T17:00:00Z',
      assignedTo: 'Marcus Chen'
    },
    {
      leadId,
      action: 'Review their Shopify store and current helpdesk setup',
      priority: 'medium',
      dueDate: '2026-01-29T10:00:00Z',
      assignedTo: 'Marcus Chen'
    },
    {
      leadId,
      action: 'Prepare chatbot demo using their actual FAQ data',
      priority: 'medium',
      dueDate: '2026-01-29T12:00:00Z',
      assignedTo: 'Alex Torres'
    }
  ];
};

// ============================================================================
// MOCK OUTCOME FEEDBACK
// ============================================================================

const getMockOutcomeFeedback = (leadId: string): OutcomeFeedback => {
  return {
    leadId,
    didConvert: true,
    conversionValue: 15000,
    recommendationWorked: true,
    whichRecommendationWorked: 'Automation Sprint with quick wins focus',
    whichDidntWork: 'N/A',
    whyDidntWork: 'N/A',
    whatWeLearned: 'DTC brands with customer service pain are highly qualified if they have Shopify + modern helpdesk. They understand ROI immediately. 30-day sprint approach removes risk objection.',
    suggestedImprovements: [
      {
        area: 'recommendation',
        improvement: 'Add "peak season readiness" as urgency multiplier for retail/DTC'
      },
      {
        area: 'pricing',
        improvement: 'This segment can afford $15-20K. We left money on table.'
      }
    ],
    loggedAt: '2026-01-26T14:00:00Z',
    loggedBy: 'Marcus Chen'
  };
};

// ============================================================================
// MOCK LEARNING INSIGHTS
// ============================================================================

export const getMockLearningInsights = (): LearningInsights => {
  return {
    totalLeadsAnalyzed: 47,
    conversionRate: 32,
    recommendationAccuracy: 78,
    scoringAccuracy: 85,
    industryPerformance: [
      {
        industry: 'E-commerce / DTC',
        conversionRate: 45,
        avgDealSize: 16500,
        bestRecommendation: 'Automation Sprint'
      },
      {
        industry: 'SaaS / Software',
        conversionRate: 38,
        avgDealSize: 28000,
        bestRecommendation: 'Onboarding Automation'
      },
      {
        industry: 'Agency / Services',
        conversionRate: 25,
        avgDealSize: 12000,
        bestRecommendation: 'Founder Leverage Package'
      },
      {
        industry: 'Healthcare / Medical',
        conversionRate: 18,
        avgDealSize: 45000,
        bestRecommendation: 'Compliance + Systems Audit'
      }
    ],
    recentImprovements: [
      {
        date: '2026-01-25',
        improvement: 'Added "peak season proximity" as urgency multiplier',
        impact: '+12% conversion rate for retail/DTC in Q4'
      },
      {
        date: '2026-01-20',
        improvement: 'Refined "founder dependency" risk flag detection',
        impact: 'Better identification of agencies needing leverage work'
      },
      {
        date: '2026-01-15',
        improvement: 'Updated ROI calculation for service businesses',
        impact: 'More accurate estimates, reduced post-sale surprises'
      }
    ]
  };
};

// ============================================================================
// EXAMPLECO — Gold-standard v1 schema diagnostic (from ecommerce-diagnostic-report.json)
// ============================================================================

function getExampleCoDiagnostic(leadId: string): DiagnosticSummary {
  return {
    leadId,
    coreProblems: [
      { title: 'Reactive Customer Support Bottleneck', whatsbroken: 'Repetitive tickets handled manually.', whyBreaking: 'Support bandwidth consumed by low-value work.', whatBreaksNext: 'Revenue leakage compounds under growth.', urgencyScore: 9, editable: false, bottleneckId: 'B1' },
      { title: 'Tool Fragmentation & Manual Reporting', whatsbroken: 'Systems don\'t share reliable data.', whyBreaking: 'Manual reporting wastes time.', whatBreaksNext: 'Execution becomes inconsistent.', urgencyScore: 8, editable: false, bottleneckId: 'B2' },
      { title: 'Approval Bottleneck & Founder Dependency', whatsbroken: 'Key approvals centralized.', whyBreaking: 'Work queues stall.', whatBreaksNext: 'Growth becomes fragile.', urgencyScore: 7, editable: false, bottleneckId: 'B3' },
    ],
    pillarHeatmap: { operationsExecution: 3 as const, revenueGrowth: 3 as const, systemsAutomation: 3 as const, aiReadinessGovernance: 3 as const },
    riskFlags: [
      { type: 'scalability', label: 'Scalability Risk', description: 'Sustained +20-30% order volume growth triggers cascade.', severity: 'high' },
      { type: 'data', label: 'Data Integrity', description: 'Integration outage causes immediate visibility loss.', severity: 'high' },
    ],
    allResponses: [
      { question: 'Describe your current operations workflow.', answer: 'We run day-to-day ops in Slack and spreadsheets; tasks are manual and assigned ad-hoc.', category: 'Operations' },
      { question: 'How do you report on performance?', answer: 'Weekly spreadsheets; we pull data from Shopify and email reports manually.', category: 'Operations' },
      { question: 'What is your average support response time?', answer: 'Usually 24–48 hours when busy.', category: 'Support' },
      { question: 'Where do you lose the most time weekly?', answer: 'Support follow-ups, reporting, and approvals.', category: 'Operations' },
      { question: 'Do your tools talk to each other?', answer: 'Not reliably. Some integrations break or aren\'t set up fully.', category: 'Systems' },
      { question: 'What are the most common customer requests?', answer: 'Order status, returns, refunds, and delivery questions.', category: 'Support' },
      { question: 'Where do approvals slow things down?', answer: 'Founder sign-off is needed for escalations and special cases.', category: 'Governance' },
      { question: 'How do you handle inventory and fulfillment updates?', answer: 'Mostly manual checks; sometimes inventory mismatches happen.', category: 'Operations' },
      { question: 'What happens when support is slow?', answer: 'Refunds rise and customers complain publicly.', category: 'Revenue' },
      { question: 'How do you follow up after purchase?', answer: 'Mostly manual or not consistent.', category: 'Revenue' },
      { question: 'Do you use any AI today?', answer: 'Basic tools for writing, nothing operational.', category: 'Systems' },
      { question: 'What\'s your biggest growth constraint?', answer: 'Things break when volume spikes, we hire but it doesn\'t fix the core problems.', category: 'Operations' },
      { question: 'How do you manage exceptions?', answer: 'We escalate in Slack; decisions vary by person.', category: 'Governance' },
      { question: 'What\'s your timeline to improve operations?', answer: 'Within 60–90 days ideally.', category: 'Intent' },
    ],
    executiveOverview: {
      readinessScore: 62,
      readinessCategory: 'Fragmented',
      confidenceLevel: 'High (86%)',
      growthRiskIndicator: 'Critical',
      primaryBottleneckTheme: 'Reactive Customer Support Bottleneck',
      primaryBottleneckId: 'B1',
      secondaryBottleneck: 'Tool Fragmentation & Manual Reporting',
      secondaryBottleneckId: 'B2',
      estimatedAnnualImpactRange: '$200K–$310K',
      summaryNarrative: 'ExampleCo operates in a highly manual, reactive mode with fragmented tools creating compounding inefficiencies across support, reporting, and approvals. ' +
        'Ticket volume (350/wk) is 59% above baseline, increasing refund risk and SLA failure probability. ' +
        'The founder is a critical bottleneck for escalations. Tool fragmentation causes 12+ hours/week of manual reporting. ' +
        'Without intervention, a 20–30% growth surge would cascade into support collapse, data blind spots, and approval gridlock within weeks.',
      confidenceScore: 86,
    },
    bottleneckDeepDives: [
      {
        id: 'B1', title: 'Reactive Customer Support Bottleneck', severity: 'Critical', category: 'Revenue', patternStrength: 7,
        causalChain: ['Repetitive tickets handled manually', 'Support bandwidth consumed by low-value work', 'High-value issues delayed', 'Refunds/cancellations increase', 'Revenue leakage compounds under growth'],
        stressSimulation: { growth_20_percent: 'Backlog becomes persistent; response times exceed 48 hours; escalations spike.', growth_30_percent: 'Refund rate rises; review score drops; support becomes the first operational failure point.', founder_absence: 'Escalation decisions stall; SLA collapses; customers churn silently.', system_failure: 'Order-status uncertainty triggers ticket surge and overwhelms manual triage.' },
        rootCauseHierarchy: { level_1_symptom: 'Slow response times and high ticket volume', level_2_process_failure: 'Repetitive queries require human handling', level_3_architecture_failure: 'No deflection/routing automation layer; weak system integrations', level_4_governance_failure: 'No automation-first operating model for customer lifecycle' },
        quantifiedImpact: { revenue_leakage_estimate: 95000, payroll_inflation_risk: 110000, time_waste_hours_per_week: 24, growth_ceiling_percent: 15 },
        intervention: { short_term: 'Deploy AI deflection + routing for top 30 repetitive ticket types (order status, returns, FAQs). Target 40% deflection in 14 days.', mid_term: 'Integrate unified ticketing + self-service portal connected to order data. SLA dashboard with lifecycle triggers.', structural_redesign: 'Shift to predictive support model with at-risk order alerts, proactive comms, and escalation playbooks.' },
        evidence: [
          { questionRef: 'Q3', questionId: 3, clientExcerpt: 'We reply within 24–48 hours when busy.', aiInterpretation: 'Reactive workflow with no SLA protection.', structuralImplication: 'Backlog grows non-linearly as volume increases.' },
          { questionRef: 'Q6', questionId: 6, clientExcerpt: 'Customers email us mostly for order status, returns, refunds.', aiInterpretation: 'High percentage of deflectable tickets.', structuralImplication: 'Automation can reduce load without hiring.' },
          { questionRef: 'Q9', questionId: 9, clientExcerpt: 'Refunds increase when support is slow.', aiInterpretation: 'Service latency directly impacts revenue.', structuralImplication: 'Support is a revenue protection function, not a cost center.' },
        ],
        bottleneckId: 'B1',
      },
      {
        id: 'B2', title: 'Tool Fragmentation & Manual Reporting', severity: 'High', category: 'Operations', patternStrength: 3,
        causalChain: ['Systems don\'t share reliable data', 'Teams rebuild reports manually', 'Leadership gets delayed/partial visibility', 'Decisions slow down', 'Execution becomes inconsistent across functions'],
        stressSimulation: { growth_20_percent: 'Manual reporting time increases; data mismatches increase; decisions become delayed.', growth_30_percent: 'Ops meetings become \'data reconciliation\' instead of execution; errors become recurring.', founder_absence: 'No single source of truth; teams interpret KPIs differently; priorities drift.', system_failure: 'One integration break causes reporting blind spots and operational surprises.' },
        rootCauseHierarchy: { level_1_symptom: 'Reports take too long; teams disagree on numbers', level_2_process_failure: 'Data is stitched manually across tools', level_3_architecture_failure: 'No unified data layer / event pipeline / standardized KPIs', level_4_governance_failure: 'No defined reporting ownership + KPI definitions + data quality checks' },
        quantifiedImpact: { revenue_leakage_estimate: 32000, payroll_inflation_risk: 45000, time_waste_hours_per_week: 12, growth_ceiling_percent: 30 },
        intervention: { short_term: 'Standardize KPIs + automate weekly dashboards from source systems.', mid_term: 'Introduce unified operational dashboard + scheduled data checks.', structural_redesign: 'Build a lightweight data layer and event-driven reporting for real-time visibility.' },
        evidence: [
          { questionRef: 'Q2', questionId: 2, clientExcerpt: 'We build weekly reports in spreadsheets.', aiInterpretation: 'Manual reporting indicates missing instrumentation or integration.', structuralImplication: 'Decision velocity slows as complexity grows.' },
          { questionRef: 'Q5', questionId: 5, clientExcerpt: 'Our tools don\'t talk to each other consistently.', aiInterpretation: 'Fragmentation is a systemic constraint.', structuralImplication: 'Automation projects will fail without a data spine.' },
        ],
        bottleneckId: 'B2',
      },
      {
        id: 'B3', title: 'Approval Bottleneck & Founder Dependency', severity: 'High', category: 'Governance', patternStrength: 3,
        causalChain: ['Key approvals centralized', 'Work queues stall waiting for decisions', 'Team speed depends on one person', 'Operational cycle time expands', 'Growth becomes fragile'],
        stressSimulation: { growth_20_percent: 'Approval queues grow; delays become normal; customers feel the lag.', growth_30_percent: 'Founder becomes operational choke point; teams become reactive; quality drops.', founder_absence: 'Work halts or proceeds inconsistently; rework increases.', system_failure: 'No policy automation means exceptions escalate to humans by default.' },
        rootCauseHierarchy: { level_1_symptom: 'Work waits on approvals and escalations', level_2_process_failure: 'No standardized rules for routing/approving requests', level_3_architecture_failure: 'No workflow engine for approvals, SLAs, and exception handling', level_4_governance_failure: 'Decision rights not distributed; no operational playbooks' },
        quantifiedImpact: { revenue_leakage_estimate: 24000, payroll_inflation_risk: 30000, time_waste_hours_per_week: 6, growth_ceiling_percent: 25 },
        intervention: { short_term: 'Define decision rights + create approval SLAs and templates.', mid_term: 'Implement workflow routing and exception policies with human override.', structural_redesign: 'Operational playbooks + governance automation to remove dependency on any one person.' },
        evidence: [
          { questionRef: 'Q7', questionId: 7, clientExcerpt: 'Many things require founder sign-off.', aiInterpretation: 'Centralized approvals constrain throughput.', structuralImplication: 'Growth increases queue time and error rate.' },
        ],
        bottleneckId: 'B3',
      },
    ],
    systemicPatterns: [
      { patternName: 'Manual Dependency Across Core Workflows', severity: 'High', signalCount: 7, crossDepartmentalPresence: true, failureCascadePotential: 'Manual work consumes capacity and creates compounding delays under growth.', recurrenceProbability: 0.78 },
      { patternName: 'Fragmented Tool Stack Without Reliable Data Flow', severity: 'High', signalCount: 6, crossDepartmentalPresence: true, failureCascadePotential: 'Integration breaks create reporting blind spots and operational surprises.', recurrenceProbability: 0.72 },
      { patternName: 'Governance Bottlenecks in Approval/Exception Handling', severity: 'Moderate', signalCount: 4, crossDepartmentalPresence: true, failureCascadePotential: 'Approvals become queues; execution velocity becomes person-dependent.', recurrenceProbability: 0.64 },
    ],
    pillarInterpretations: {
      operationsExecution: { interpretation: 'Operational throughput is constrained by manual workflows and inconsistent handoffs.', dominantWeakness: 'Reactive execution loops', automationLeveragePotential: 'High' },
      revenueGrowth: { interpretation: 'Revenue engine works, but leaks occur when support and lifecycle systems lag.', dominantWeakness: 'Retention and service latency', automationLeveragePotential: 'High' },
      systemsAutomation: { interpretation: 'Tool stack exists but lacks a reliable integration spine and unified reporting.', dominantWeakness: 'Data fragmentation', automationLeveragePotential: 'Very High' },
      aiReadinessGovernance: { interpretation: 'Decision rights and approvals are concentrated, slowing execution under load.', dominantWeakness: 'Founder dependency', automationLeveragePotential: 'Medium' },
    },
    financialModel: {
      directRevenuLeakage: 142000, hiddenOperationalDrag: 48000, payrollMisallocation: 58000,
      opportunityCost: 34000, compoundingGrowthTax: 28000, totalEstimatedAnnualImpact: 310000,
      directRevenuLeakageFormatted: '$142K', hiddenOperationalDragFormatted: '$48K', payrollMisallocationFormatted: '$58K',
      opportunityCostFormatted: '$34K', compoundingGrowthTaxFormatted: '$28K', totalEstimatedAnnualImpactFormatted: '$310K',
    },
    enhancedRisks: [
      { riskType: 'Scalability', severity: 'High', triggerThreshold: 'Sustained +20–30% order volume growth', probabilityPercent: 74, timeToFailureEstimate: '8–14 weeks at elevated volume', cascadePath: 'Support delay → cancellations/refunds → negative reviews → higher CAC → lower margin' },
      { riskType: 'Data', severity: 'High', triggerThreshold: 'Any integration outage or inconsistent tool syncing', probabilityPercent: 68, timeToFailureEstimate: 'Immediate visibility loss within 1–2 reporting cycles', cascadePath: 'Bad data → wrong decisions → operational misalignment → recurring errors' },
      { riskType: 'Dependency', severity: 'High', triggerThreshold: 'Founder unavailable or overloaded; approval queues increase', probabilityPercent: 62, timeToFailureEstimate: '2–6 weeks as queues accumulate', cascadePath: 'Approvals stall → cycle time expands → team frustration → quality drops' },
      { riskType: 'Compliance', severity: 'Moderate', triggerThreshold: 'Handling sensitive customer data without formal policies', probabilityPercent: 38, timeToFailureEstimate: 'Policy risk increases as team size grows', cascadePath: 'Data handling gaps → reputational risk → vendor/partner restrictions' },
    ],
    confidenceLayer: {
      totalSignalsDetected: 46,
      corroboratedPatterns: 3,
      contradictionFlags: 1,
      weakSignalFlags: 1,
      aiConfidenceScore: 0.86,
    },
  };
}

/**
 * PRODUCTION API INTEGRATION EXAMPLE
 * 
 * Replace mock functions with real API calls:
 * 
 * export const getCortexLeads = async (): Promise<Lead[]> => {
 *   const response = await fetch('/api/cortex/leads', {
 *     headers: { 'Authorization': `Bearer ${getAuthToken()}` }
 *   });
 *   return response.json();
 * };
 * 
 * export const getCortexLeadData = async (leadId: string): Promise<CortexLeadData> => {
 *   const response = await fetch(`/api/cortex/lead/${leadId}`, {
 *     headers: { 'Authorization': `Bearer ${getAuthToken()}` }
 *   });
 *   return response.json();
 * };
 * 
 * export const updateLeadStatus = async (
 *   leadId: string, 
 *   status: LeadStatus, 
 *   reason: string
 * ): Promise<void> => {
 *   await fetch(`/api/cortex/lead/${leadId}/status`, {
 *     method: 'PUT',
 *     headers: {
 *       'Content-Type': 'application/json',
 *       'Authorization': `Bearer ${getAuthToken()}`
 *     },
 *     body: JSON.stringify({ status, reason })
 *   });
 * };
 * 
 * // ... similar functions for other actions
 */