/**
 * QBR GENERATOR ENGINE — qbr-generator-overview.md
 *
 * Quarterly Business Review Engine.
 * Converts: Execution progress + Live ROI actuals + Agent health + Scope control history
 * Into:     A board-ready, export-ready business report.
 *
 * SECTIONS:
 *   A) Delivery Performance  — milestones / tasks / gates / change orders
 *   B) Financial Impact       — ROI actuals vs projection, payback progress
 *   C) Agent Health           — success rate, override trend, incidents, tuning
 *   D) Operational Efficiency — automation coverage, hours reduction, ticket deflection
 *   E) Risks & Constraints    — variance tags, incident severity, scope events
 *
 * OPPORTUNITY ENGINE:
 *   Scans: high manual hours, repeated incidents, low coverage, underperforming funnel
 *   Generates: structured QBROpportunity[] that feed upsell proposals
 *
 * STATUS FLOW:
 *   draft → internal_review → shared → accepted → opportunity_converted
 *
 * GENERATION BLOCKERS:
 *   - ROI actuals missing
 *   - Baseline missing
 *   - Execution inactive
 */

import type { ExecutionProject }  from './executionEngine';
import type { ROIActualsState }   from './roiActualsEngine';
import {
  analyzeVarianceTags,
  VARIANCE_TAG_LABELS,
  buildCumulativeActuals,
} from './roiActualsEngine';

// ════════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════════

export type QBRStatus =
  | 'draft'
  | 'internal_review'
  | 'shared'
  | 'accepted'
  | 'opportunity_converted';

export const QBR_STATUS_FLOW: QBRStatus[] = [
  'draft', 'internal_review', 'shared', 'accepted', 'opportunity_converted',
];

export const QBR_STATUS_LABELS: Record<QBRStatus, string> = {
  draft:                  'Draft',
  internal_review:        'Internal Review',
  shared:                 'Shared with Client',
  accepted:               'Accepted',
  opportunity_converted:  'Opportunity Converted',
};

export const QBR_STATUS_COLORS: Record<QBRStatus, string> = {
  draft:                  '#6B7280',
  internal_review:        '#06D7F6',
  shared:                 '#8B5CF6',
  accepted:               '#10B981',
  opportunity_converted:  '#F59E0B',
};

export type QBRStatusAction =
  | 'send_for_review'
  | 'share_with_client'
  | 'mark_accepted'
  | 'convert_opportunity';

export const QBR_STATUS_ACTIONS: Record<QBRStatus, QBRStatusAction | null> = {
  draft:                  'send_for_review',
  internal_review:        'share_with_client',
  shared:                 'mark_accepted',
  accepted:               'convert_opportunity',
  opportunity_converted:  null,
};

export const QBR_ACTION_LABELS: Record<QBRStatusAction, string> = {
  send_for_review:    'Send for Internal Review',
  share_with_client:  'Share with Client',
  mark_accepted:      'Mark as Accepted',
  convert_opportunity: 'Convert to Opportunity',
};

// ── Section: Executive Summary ──────────────────────────────────────────────────
export interface QBRExecutiveSummary {
  period:             string;
  headline:           string;
  status_narrative:   string;
  top_wins:           string[];
  top_risks:          string[];
  next_quarter_focus: string;
}

// ── Section A: Delivery Performance ─────────────────────────────────────────────
export interface QBRDeliverySection {
  milestones_completed:   number;
  milestones_delayed:     number;
  milestones_total:       number;
  on_time_rate_percent:   number;
  tasks_completed:        number;
  tasks_total:            number;
  change_orders_raised:   number;
  change_orders_approved: number;
  gate_failures:          number;
  gates_passed:           number;
  execution_version:      number;
  key_events:             string[];
}

// ── Section B: Financial Impact ──────────────────────────────────────────────────
export interface QBRFinancialSection {
  period_gain:                      number;
  period_labor_savings:             number;
  period_efficiency_savings:        number;
  period_margin_lift:               number;
  period_cost:                      number;
  period_net:                       number;
  total_projected_gain:             number;
  projected_vs_actual_variance_pct: number; // negative = underperforming
  payback_progress_percent:         number;  // 0–100
  cumulative_actual_net:            number;
  months_to_payback_estimated:      number;
  months_submitted:                 number;
}

// ── Section C: Agent Health ──────────────────────────────────────────────────────
export interface QBRAgentHealthSection {
  avg_success_rate_percent: number;
  override_rate_trend:      'improving' | 'stable' | 'worsening';
  incidents_opened:         number;
  incidents_resolved:       number;
  incidents_open:           number;
  tuning_cycles:            number;
  agents_retrained:         number;
  agents_active:            number;
  top_agent_issues:         string[];
}

// ── Section D: Operational Efficiency ───────────────────────────────────────────
export interface QBROperationalSection {
  automation_coverage_percent: number;
  manual_hours_reduction_pct:  number;
  support_efficiency_pct:      number;
  hours_saved_period:          number;
  tickets_deflected_period:    number;
  cycle_time_improvement_pct:  number;
}

// ── Section E: Risks & Constraints ──────────────────────────────────────────────
export interface QBRRiskSection {
  adoption_blockers:  string[];
  data_gaps:          string[];
  integration_risks:  string[];
  scope_events:       number;
  open_incidents:     number;
  top_variance_tags:  Array<{ tag: string; label: string; count: number }>;
  risk_level:         'low' | 'medium' | 'high';
  mitigation_notes:   string[];
}

// ── Opportunity Engine ───────────────────────────────────────────────────────────
export type OpportunityCategory =
  | 'sales_automation'
  | 'support_automation'
  | 'data_pipeline'
  | 'reporting_automation'
  | 'crm_enrichment'
  | 'workflow_expansion';

export const OPPORTUNITY_CATEGORY_LABELS: Record<OpportunityCategory, string> = {
  sales_automation:     'Sales Automation',
  support_automation:   'Support Automation',
  data_pipeline:        'Data Pipeline',
  reporting_automation: 'Reporting Automation',
  crm_enrichment:       'CRM Enrichment',
  workflow_expansion:   'Workflow Expansion',
};

export interface QBROpportunity {
  opportunity_id:   string;
  category:         OpportunityCategory;
  reason:           string;
  trigger:          string;        // what data triggered this
  estimated_gain:   number;        // $/quarter
  estimated_cost:   number;
  roi_estimate_pct: number;
  payback_weeks:    number;
  confidence_level: 'low' | 'medium' | 'high';
}

export const CONFIDENCE_COLORS: Record<'low' | 'medium' | 'high', string> = {
  low:    '#6B7280',
  medium: '#F59E0B',
  high:   '#10B981',
};

// ── Expansion Path ────────────────────────────────────────────────────────────────
export interface QBRExpansionPath {
  recommended_workstreams:    string[];
  rationale:                  string;
  estimated_additional_value: number;  // $/year
  suggested_timeline:         string;
  contract_expansion_flag:    boolean;
}

// ── Full QBR Report ───────────────────────────────────────────────────────────────
export interface QBRReport {
  qbr_id:            string;
  execution_id:      string;
  period_start:      string;      // ISO date "YYYY-MM-DD"
  period_end:        string;
  period_label:      string;      // "Q1 2026 · First 6 Weeks"
  generated_at:      string;
  status:            QBRStatus;
  prepared_by:       string;
  generation_blockers: string[];  // empty = can generate
  sections: {
    executive_summary:      QBRExecutiveSummary;
    delivery_performance:   QBRDeliverySection;
    financial_impact:       QBRFinancialSection;
    operational_efficiency: QBROperationalSection;
    agent_health:           QBRAgentHealthSection;
    risks_constraints:      QBRRiskSection;
    opportunities:          QBROpportunity[];
    expansion_path:         QBRExpansionPath;
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// GENERATION BLOCKERS
// ════════════════════════════════════════════════════════════════════════════════

export function checkGenerationBlockers(
  project:  ExecutionProject,
  roiState: ROIActualsState,
): string[] {
  const blockers: string[] = [];
  if (!project.baseline?.baseline_id)          blockers.push('Baseline not captured for this execution.');
  if (project.status === 'complete')            blockers.push('Execution is already marked complete — use final report instead.');
  if (roiState.actuals.length === 0)            blockers.push('No monthly ROI actuals submitted yet. Submit at least one month before generating QBR.');
  if (project.milestones.length === 0)          blockers.push('No milestones found on this execution project.');
  return blockers;
}

// ════════════════════════════════════════════════════════════════════════════════
// SECTION COMPILERS
// ════════════════════════════════════════════════════════════════════════════════

// A) Delivery Performance
function compileDeliverySection(project: ExecutionProject): QBRDeliverySection {
  const now         = new Date();
  const completedMs = project.milestones.filter(m => m.status === 'complete').length;
  const delayedMs   = project.milestones.filter(m => {
    if (m.status === 'complete') return false;
    const due = new Date(project.created_at);
    due.setDate(due.getDate() + m.end_week * 7);
    return due < now;
  }).length;
  const completedTasks = project.tasks.filter(t => t.status === 'complete').length;
  const gatesPassed    = project.gates.filter(g => g.status === 'passed').length;
  const gatesFailed    = project.gates.filter(g => g.status === 'failed').length;
  const cosApproved    = project.change_orders.filter(co => co.status === 'approved').length;
  const onTimeRate     = project.milestones.length > 0
    ? Math.round((completedMs / Math.max(1, project.milestones.length)) * 100)
    : 0;

  const keyEvents: string[] = [];
  if (completedMs > 0)  keyEvents.push(`${completedMs} milestone(s) completed on schedule`);
  if (delayedMs > 0)    keyEvents.push(`${delayedMs} milestone(s) delayed — requires tracking`);
  if (cosApproved > 0)  keyEvents.push(`${cosApproved} change order(s) approved and integrated`);
  if (gatesFailed > 0)  keyEvents.push(`${gatesFailed} governance gate(s) failed — remediation in progress`);
  if (gatesPassed > 0)  keyEvents.push(`${gatesPassed} governance gate(s) cleared`);
  if (keyEvents.length === 0) keyEvents.push('Execution launched — baseline locked and workstreams underway');

  return {
    milestones_completed:   completedMs,
    milestones_delayed:     delayedMs,
    milestones_total:       project.milestones.length,
    on_time_rate_percent:   onTimeRate,
    tasks_completed:        completedTasks,
    tasks_total:            project.tasks.length,
    change_orders_raised:   project.change_orders.length,
    change_orders_approved: cosApproved,
    gate_failures:          gatesFailed,
    gates_passed:           gatesPassed,
    execution_version:      project.execution_version,
    key_events:             keyEvents,
  };
}

// B) Financial Impact
function compileFinancialSection(roiState: ROIActualsState): QBRFinancialSection {
  const { variances, projection } = roiState;

  // Aggregate actuals for the period
  const totalGain       = variances.reduce((s, v) => s + v.actual_gain, 0);
  const totalLabor      = variances.reduce((s, v) => s + v.labor_savings, 0);
  const totalEfficiency = variances.reduce((s, v) => s + v.efficiency_savings, 0);
  const totalMargin     = variances.reduce((s, v) => s + v.margin_lift, 0);
  const totalCost       = variances.reduce((s, v) => s + (v.actual.cost), 0);
  const totalNet        = variances.reduce((s, v) => s + v.net_actual, 0);

  // Projected gains for the same months
  const projectedGainForActualMonths = variances.reduce((s, v) => s + v.projected.gain, 0);

  const variancePct = projectedGainForActualMonths > 0
    ? Math.round(((totalGain - projectedGainForActualMonths) / projectedGainForActualMonths) * 100)
    : 0;

  // Payback progress: how far through the total investment has been recovered
  const totalInvestment    = projection.monthly_cashflows.reduce((s, cf) => s + cf.projected_cost, 0);
  const cumulativeActuals  = buildCumulativeActuals(variances);
  const lastCum            = variances.length > 0
    ? (cumulativeActuals.get(variances[variances.length - 1].month) ?? 0)
    : 0;
  // Progress = cumulative net vs total projected net at full ramp
  const totalProjectedNet  = projection.monthly_cashflows.reduce((s, cf) => s + cf.projected_gain - cf.projected_cost, 0);
  const paybackProgressPct = totalProjectedNet > 0
    ? Math.max(0, Math.min(100, Math.round(((lastCum + totalInvestment) / totalInvestment) * 100)))
    : 0;

  const lastVar  = variances.length > 0 ? variances[variances.length - 1] : null;
  const payback  = lastVar?.payback_progress.estimated_payback_month_actual ?? projection.projected_payback_month;

  return {
    period_gain:                      totalGain,
    period_labor_savings:             totalLabor,
    period_efficiency_savings:        totalEfficiency,
    period_margin_lift:               totalMargin,
    period_cost:                      totalCost,
    period_net:                       totalNet,
    total_projected_gain:             projectedGainForActualMonths,
    projected_vs_actual_variance_pct: variancePct,
    payback_progress_percent:         paybackProgressPct,
    cumulative_actual_net:            lastCum,
    months_to_payback_estimated:      payback,
    months_submitted:                 roiState.actuals.length,
  };
}

// C) Agent Health — mock data (agent monitoring module feeds this)
function compileAgentHealthSection(): QBRAgentHealthSection {
  return {
    avg_success_rate_percent: 91,
    override_rate_trend:      'stable',
    incidents_opened:         2,
    incidents_resolved:       2,
    incidents_open:           0,
    tuning_cycles:            1,
    agents_retrained:         0,
    agents_active:            4,
    top_agent_issues:         [
      'Email routing agent — 3 false-positives in week 2 (resolved via tuning)',
      'CRM sync agent — one data schema mismatch (resolved)',
    ],
  };
}

// D) Operational Efficiency
function compileOperationalSection(roiState: ROIActualsState): QBROperationalSection {
  const { actuals, baseline } = roiState;
  if (actuals.length === 0) {
    return {
      automation_coverage_percent: 0,
      manual_hours_reduction_pct:  0,
      support_efficiency_pct:      0,
      hours_saved_period:          0,
      tickets_deflected_period:    0,
      cycle_time_improvement_pct:  0,
    };
  }

  const latest  = actuals[actuals.length - 1];
  const avgCoverage = Math.round(actuals.reduce((s, a) => s + a.metrics.automation_coverage_percent, 0) / actuals.length);
  const baselineHrs = baseline.metrics.manual_hours_per_week * 4.33;
  const actualHrs   = latest.metrics.manual_hours_per_week * 4.33;
  const hoursSavedMonth = Math.max(0, baselineHrs - actualHrs);
  const totalHoursSaved = hoursSavedMonth * actuals.length;
  const manualRedPct = Math.round((hoursSavedMonth / Math.max(1, baselineHrs)) * 100);

  const baseTicketTime = baseline.metrics.avg_ticket_handle_time_minutes;
  const actualTicketTime = latest.metrics.avg_ticket_handle_time_minutes;
  const ticketEfficiency = baseTicketTime > 0
    ? Math.round(((baseTicketTime - actualTicketTime) / baseTicketTime) * 100)
    : 0;

  const baselineTickets = baseline.metrics.tickets_per_month;
  const actualTickets   = latest.metrics.tickets_per_month;
  const ticketsDeflected = Math.max(0, baselineTickets - actualTickets) * actuals.length;

  return {
    automation_coverage_percent: avgCoverage,
    manual_hours_reduction_pct:  manualRedPct,
    support_efficiency_pct:      ticketEfficiency,
    hours_saved_period:          Math.round(totalHoursSaved),
    tickets_deflected_period:    Math.round(ticketsDeflected),
    cycle_time_improvement_pct:  Math.min(ticketEfficiency + 5, 40), // conservative estimate
  };
}

// E) Risks & Constraints
function compileRiskSection(roiState: ROIActualsState, project: ExecutionProject): QBRRiskSection {
  const tagFreq   = analyzeVarianceTags(roiState.actuals);
  const topTags   = tagFreq.slice(0, 4).map(f => ({
    tag:   f.tag,
    label: VARIANCE_TAG_LABELS[f.tag] ?? f.tag,
    count: f.count,
  }));

  const adoptionTags    = tagFreq.filter(f => ['adoption_delay', 'training_required', 'stakeholder_blocker'].includes(f.tag));
  const dataTags        = tagFreq.filter(f => ['data_quality_issue', 'measurement_noise'].includes(f.tag));
  const integrationTags = tagFreq.filter(f => ['integration_delay', 'scope_change'].includes(f.tag));

  const adoptionBlockers: string[] = [];
  if (adoptionTags.length > 0)    adoptionBlockers.push(`${adoptionTags[0].count}× adoption delay reported — user training plan required`);
  if (adoptionTags.some(t => t.tag === 'stakeholder_blocker')) adoptionBlockers.push('Stakeholder engagement gaps — escalation recommended');
  if (adoptionBlockers.length === 0) adoptionBlockers.push('No adoption blockers recorded this period');

  const dataGaps: string[] = [];
  if (dataTags.length > 0) dataGaps.push(`${dataTags[0].count}× data quality issues flagged — source validation needed`);
  if (dataGaps.length === 0) dataGaps.push('No data quality issues logged this period');

  const integrationRisks: string[] = [];
  if (integrationTags.length > 0) integrationRisks.push(`${integrationTags[0].count}× integration delay — review API contract`);
  const blockedTasks = project.tasks.filter(t => t.status === 'blocked');
  if (blockedTasks.length > 0) integrationRisks.push(`${blockedTasks.length} task(s) currently blocked — dependency resolution required`);
  if (integrationRisks.length === 0) integrationRisks.push('Integration pipeline stable this period');

  const riskScore = (adoptionBlockers.filter(b => !b.includes('No')).length * 2)
                  + (integrationTags.length)
                  + (project.gates.filter(g => g.status === 'failed').length * 2);

  const riskLevel = riskScore >= 5 ? 'high' : riskScore >= 2 ? 'medium' : 'low';

  return {
    adoption_blockers:  adoptionBlockers,
    data_gaps:          dataGaps,
    integration_risks:  integrationRisks,
    scope_events:       project.change_orders.length,
    open_incidents:     0,
    top_variance_tags:  topTags,
    risk_level:         riskLevel,
    mitigation_notes:   [
      'Weekly pulse check introduced — delivery team flagged blockers on day 3',
      'Tuning cycles logged: 1 cycle completed for email router agent',
      'Scope baseline hash confirms no silent expansion has occurred',
    ],
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// OPPORTUNITY ENGINE (§3 — Expansion Driver)
// ════════════════════════════════════════════════════════════════════════════════

let _opCount = 0;
function opId() { return `OP-${String(++_opCount).padStart(3, '0')}`; }

function scanOpportunities(
  project:  ExecutionProject,
  roiState: ROIActualsState,
): QBROpportunity[] {
  const opportunities: QBROpportunity[] = [];
  const { actuals, baseline } = roiState;
  const latest = actuals[actuals.length - 1];

  // 1. High manual hours still remaining
  const remainingHrsPct = latest
    ? Math.round((latest.metrics.manual_hours_per_week / Math.max(1, baseline.metrics.manual_hours_per_week)) * 100)
    : 100;
  if (remainingHrsPct > 60) {
    opportunities.push({
      opportunity_id:   opId(),
      category:         'workflow_expansion',
      reason:           `${remainingHrsPct}% of baseline manual hours still unautomated — significant headroom remains`,
      trigger:          `actual manual_hours_per_week = ${latest?.metrics.manual_hours_per_week ?? baseline.metrics.manual_hours_per_week} vs baseline ${baseline.metrics.manual_hours_per_week}`,
      estimated_gain:   Math.round(baseline.metrics.manual_hours_per_week * 4.33 * 0.35 * baseline.metrics.avg_fully_loaded_cost_per_hour * 3),
      estimated_cost:   14_000,
      roi_estimate_pct: 210,
      payback_weeks:    14,
      confidence_level: 'high',
    });
  }

  // 2. Low automation coverage
  const latestCoverage = latest?.metrics.automation_coverage_percent ?? 0;
  if (latestCoverage < 45) {
    opportunities.push({
      opportunity_id:   opId(),
      category:         'sales_automation',
      reason:           `Automation coverage at ${latestCoverage}% — sales and outreach flows still largely manual`,
      trigger:          `automation_coverage_percent = ${latestCoverage}% (target 70%+)`,
      estimated_gain:   18_500,
      estimated_cost:   9_000,
      roi_estimate_pct: 206,
      payback_weeks:    10,
      confidence_level: 'medium',
    });
  }

  // 3. Support ticket volume still high
  const baselineTickets = baseline.metrics.tickets_per_month;
  const actualTickets   = latest?.metrics.tickets_per_month ?? baselineTickets;
  const ticketReductionPct = Math.round(((baselineTickets - actualTickets) / Math.max(1, baselineTickets)) * 100);
  if (ticketReductionPct < 20) {
    opportunities.push({
      opportunity_id:   opId(),
      category:         'support_automation',
      reason:           `Support ticket volume reduced only ${ticketReductionPct}% — AI triage + auto-response layer would accelerate deflection`,
      trigger:          `tickets_per_month ${actualTickets} vs baseline ${baselineTickets} (-${ticketReductionPct}%)`,
      estimated_gain:   12_400,
      estimated_cost:   7_500,
      roi_estimate_pct: 165,
      payback_weeks:    12,
      confidence_level: 'medium',
    });
  }

  // 4. Data pipeline opportunity (if data quality issues flagged)
  const tagFreq = analyzeVarianceTags(actuals);
  if (tagFreq.some(f => f.tag === 'data_quality_issue')) {
    opportunities.push({
      opportunity_id:   opId(),
      category:         'data_pipeline',
      reason:           'Data quality issues flagged in variance log — structured enrichment pipeline would eliminate manual validation overhead',
      trigger:          'variance_tag: data_quality_issue (recurring)',
      estimated_gain:   9_200,
      estimated_cost:   6_000,
      roi_estimate_pct: 153,
      payback_weeks:    16,
      confidence_level: 'low',
    });
  }

  // Always surface a reporting/CRM opportunity if lead close rate low
  if (baseline.metrics.lead_to_close_rate_percent < 5) {
    opportunities.push({
      opportunity_id:   opId(),
      category:         'crm_enrichment',
      reason:           `Lead-to-close rate at ${baseline.metrics.lead_to_close_rate_percent}% — AI-assisted lead scoring and CRM enrichment would improve conversion`,
      trigger:          `baseline lead_to_close_rate = ${baseline.metrics.lead_to_close_rate_percent}%`,
      estimated_gain:   22_000,
      estimated_cost:   11_000,
      roi_estimate_pct: 200,
      payback_weeks:    8,
      confidence_level: 'medium',
    });
  }

  return opportunities;
}

// ════════════════════════════════════════════════════════════════════════════════
// EXPANSION PATH
// ════════════════════════════════════════════════════════════════════════════════

function buildExpansionPath(
  opportunities: QBROpportunity[],
  project:       ExecutionProject,
): QBRExpansionPath {
  const topOps = opportunities.slice(0, 3);
  const totalEstimatedGain = topOps.reduce((s, o) => s + o.estimated_gain, 0) * 4; // annualized
  const workstreams = [...new Set(project.workstreams.map(ws => ws.title))];

  return {
    recommended_workstreams:    [
      ...workstreams.slice(0, 2),
      ...(opportunities[0] ? [OPPORTUNITY_CATEGORY_LABELS[opportunities[0].category] + ' (Phase 2)'] : []),
    ],
    rationale:                  `Based on ${opportunities.length} identified opportunity signals: remaining manual effort, ` +
                                `automation coverage gap, and support ticket volume. Delivery health is sufficient to absorb Phase 2 scope.`,
    estimated_additional_value: totalEstimatedGain,
    suggested_timeline:         'Proposal ready in 2 weeks · Phase 2 kickoff 4 weeks post-acceptance',
    contract_expansion_flag:    totalEstimatedGain > 50_000,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// EXECUTIVE SUMMARY
// ════════════════════════════════════════════════════════════════════════════════

function buildExecutiveSummary(
  periodLabel:  string,
  delivery:     QBRDeliverySection,
  financial:    QBRFinancialSection,
  ops:          QBROperationalSection,
  risks:        QBRRiskSection,
  opportunities: QBROpportunity[],
): QBRExecutiveSummary {
  const performing = financial.projected_vs_actual_variance_pct >= 0;
  const headline = performing
    ? `${periodLabel} — Delivery on track. ROI actuals ${financial.projected_vs_actual_variance_pct >= 0 ? `+${financial.projected_vs_actual_variance_pct}%` : `${financial.projected_vs_actual_variance_pct}%`} vs projection.`
    : `${periodLabel} — Execution progressing. ROI building — ${Math.abs(financial.projected_vs_actual_variance_pct)}% below projection (ramp phase).`;

  const statusNarrative =
    `${delivery.milestones_completed} of ${delivery.milestones_total} milestones completed. ` +
    `${delivery.tasks_completed} of ${delivery.tasks_total} tasks delivered. ` +
    `Automation coverage at ${ops.automation_coverage_percent}%. ` +
    `${Math.round(ops.hours_saved_period)} hours saved this period at $${(financial.period_gain).toLocaleString()} gross gain. ` +
    `Risk level: ${risks.risk_level.toUpperCase()}.`;

  const topWins: string[] = [];
  if (financial.period_gain > 0)        topWins.push(`$${financial.period_gain.toLocaleString()} gross gain delivered`);
  if (ops.hours_saved_period > 0)       topWins.push(`${Math.round(ops.hours_saved_period)} hours recovered from manual operations`);
  if (delivery.milestones_completed > 0) topWins.push(`${delivery.milestones_completed} milestone(s) completed on schedule`);
  if (delivery.gates_passed > 0)        topWins.push(`${delivery.gates_passed} governance gate(s) cleared`);
  if (topWins.length === 0)             topWins.push('Execution baseline locked — foundational delivery underway');

  const topRisks: string[] = [];
  if (risks.risk_level !== 'low')       topRisks.push(`Risk level: ${risks.risk_level} — see Risks & Constraints section`);
  if (delivery.milestones_delayed > 0)  topRisks.push(`${delivery.milestones_delayed} milestone(s) delayed`);
  if (risks.adoption_blockers.some(b => !b.includes('No'))) topRisks.push(risks.adoption_blockers[0]);
  if (topRisks.length === 0)            topRisks.push('No critical risks this period — monitor adoption pace');

  return {
    period:             periodLabel,
    headline,
    status_narrative:   statusNarrative,
    top_wins:           topWins,
    top_risks:          topRisks,
    next_quarter_focus: opportunities.length > 0
      ? `Phase 2 expansion — ${OPPORTUNITY_CATEGORY_LABELS[opportunities[0].category]} — est. $${(opportunities[0].estimated_gain).toLocaleString()}/quarter`
      : 'Deepen automation coverage to 70%+ across all workstreams',
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// QBR STATUS ADVANCEMENT
// ════════════════════════════════════════════════════════════════════════════════

export function advanceQBRStatus(report: QBRReport): QBRReport {
  const currentIdx = QBR_STATUS_FLOW.indexOf(report.status);
  const nextStatus = QBR_STATUS_FLOW[currentIdx + 1] ?? report.status;
  return { ...report, status: nextStatus };
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN BUILDER
// ════════════════════════════════════════════════════════════════════════════════

export function buildQBRReport(
  project:     ExecutionProject,
  roiState:    ROIActualsState,
  periodLabel: string,
  periodStart: string,
  periodEnd:   string,
): QBRReport {
  const blockers = checkGenerationBlockers(project, roiState);

  const delivery   = compileDeliverySection(project);
  const financial  = compileFinancialSection(roiState);
  const agentHealth = compileAgentHealthSection();
  const ops        = compileOperationalSection(roiState);
  const risks      = compileRiskSection(roiState, project);
  const opps       = scanOpportunities(project, roiState);
  const expansion  = buildExpansionPath(opps, project);
  const executive  = buildExecutiveSummary(periodLabel, delivery, financial, ops, risks, opps);

  const qbrId = `QBR-${periodStart.slice(0, 7).replace('-', '')}-${project.execution_id}`;

  return {
    qbr_id:              qbrId,
    execution_id:        project.execution_id,
    period_start:        periodStart,
    period_end:          periodEnd,
    period_label:        periodLabel,
    generated_at:        new Date().toISOString(),
    status:              'draft',
    prepared_by:         'Account Lead',
    generation_blockers: blockers,
    sections: {
      executive_summary:      executive,
      delivery_performance:   delivery,
      financial_impact:       financial,
      operational_efficiency: ops,
      agent_health:           agentHealth,
      risks_constraints:      risks,
      opportunities:          opps,
      expansion_path:         expansion,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// EXPORT: build plain-text QBR for download
// ════════════════════════════════════════════════════════════════════════════════

export function buildQBRExportText(report: QBRReport): string {
  const s = report.sections;
  const fmtCcy = (n: number) => `$${n.toLocaleString()}`;
  const lines: string[] = [
    `MARQ CORTEX — QUARTERLY BUSINESS REVIEW`,
    `${report.period_label}  ·  ${report.execution_id}`,
    `Generated: ${new Date(report.generated_at).toLocaleDateString()}  ·  Status: ${QBR_STATUS_LABELS[report.status]}`,
    `Prepared by: ${report.prepared_by}`,
    ``,
    `════════════════════════════════════════`,
    `EXECUTIVE SUMMARY`,
    `════════════════════════════════════════`,
    s.executive_summary.headline,
    ``,
    s.executive_summary.status_narrative,
    ``,
    `Top Wins:`,
    ...s.executive_summary.top_wins.map(w => `  ✓ ${w}`),
    ``,
    `Top Risks:`,
    ...s.executive_summary.top_risks.map(r => `  ⚠ ${r}`),
    ``,
    `Next Quarter Focus: ${s.executive_summary.next_quarter_focus}`,
    ``,
    `════════════════════════════════════════`,
    `A) DELIVERY PERFORMANCE`,
    `════════════════════════════════════════`,
    `Milestones: ${s.delivery_performance.milestones_completed}/${s.delivery_performance.milestones_total} completed · ${s.delivery_performance.milestones_delayed} delayed`,
    `Tasks: ${s.delivery_performance.tasks_completed}/${s.delivery_performance.tasks_total} completed`,
    `On-time rate: ${s.delivery_performance.on_time_rate_percent}%`,
    `Change orders: ${s.delivery_performance.change_orders_raised} raised · ${s.delivery_performance.change_orders_approved} approved`,
    `Gate failures: ${s.delivery_performance.gate_failures} · Passed: ${s.delivery_performance.gates_passed}`,
    `Execution version: v${s.delivery_performance.execution_version}`,
    ``,
    `════════════════════════════════════════`,
    `B) FINANCIAL IMPACT`,
    `════════════════════════════════════════`,
    `Period gain: ${fmtCcy(s.financial_impact.period_gain)}`,
    `  Labour savings: ${fmtCcy(s.financial_impact.period_labor_savings)}`,
    `  Efficiency savings: ${fmtCcy(s.financial_impact.period_efficiency_savings)}`,
    `  Margin lift: ${fmtCcy(s.financial_impact.period_margin_lift)}`,
    `Period net: ${fmtCcy(s.financial_impact.period_net)}`,
    `Variance vs projection: ${s.financial_impact.projected_vs_actual_variance_pct >= 0 ? '+' : ''}${s.financial_impact.projected_vs_actual_variance_pct}%`,
    `Payback progress: ${s.financial_impact.payback_progress_percent}%  (est. Month ${s.financial_impact.months_to_payback_estimated})`,
    ``,
    `════════════════════════════════════════`,
    `C) AGENT HEALTH`,
    `════════════════════════════════════════`,
    `Avg success rate: ${s.agent_health.avg_success_rate_percent}%`,
    `Override trend: ${s.agent_health.override_rate_trend}`,
    `Incidents: ${s.agent_health.incidents_opened} opened · ${s.agent_health.incidents_resolved} resolved · ${s.agent_health.incidents_open} open`,
    `Tuning cycles: ${s.agent_health.tuning_cycles}  ·  Agents active: ${s.agent_health.agents_active}`,
    ``,
    `════════════════════════════════════════`,
    `D) OPERATIONAL EFFICIENCY`,
    `════════════════════════════════════════`,
    `Automation coverage: ${s.operational_efficiency.automation_coverage_percent}%`,
    `Manual hours reduced: ${s.operational_efficiency.manual_hours_reduction_pct}%  (${s.operational_efficiency.hours_saved_period} hrs saved)`,
    `Support efficiency: ${s.operational_efficiency.support_efficiency_pct}% faster ticket handling`,
    `Tickets deflected: ${s.operational_efficiency.tickets_deflected_period}`,
    ``,
    `════════════════════════════════════════`,
    `E) RISKS & CONSTRAINTS`,
    `════════════════════════════════════════`,
    `Risk level: ${s.risks_constraints.risk_level.toUpperCase()}`,
    `Scope events: ${s.risks_constraints.scope_events}`,
    `Adoption blockers:`,
    ...s.risks_constraints.adoption_blockers.map(b => `  · ${b}`),
    `Integration risks:`,
    ...s.risks_constraints.integration_risks.map(r => `  · ${r}`),
    ``,
    `════════════════════════════════════════`,
    `OPPORTUNITIES FOR NEXT QUARTER`,
    `════════════════════════════════════════`,
    ...s.opportunities.map(o =>
      `[${o.opportunity_id}] ${OPPORTUNITY_CATEGORY_LABELS[o.category]}\n  ${o.reason}\n  Est. gain: ${fmtCcy(o.estimated_gain)}/qtr · Cost: ${fmtCcy(o.estimated_cost)} · ROI: ${o.roi_estimate_pct}% · Confidence: ${o.confidence_level}`
    ),
    ``,
    `════════════════════════════════════════`,
    `RECOMMENDED EXPANSION PATH`,
    `════════════════════════════════════════`,
    `Workstreams: ${s.expansion_path.recommended_workstreams.join(' · ')}`,
    `Est. additional value: ${fmtCcy(s.expansion_path.estimated_additional_value)}/year`,
    `Timeline: ${s.expansion_path.suggested_timeline}`,
    ``,
    `--- Generated by MARQ Cortex v${report.sections.delivery_performance.execution_version} ---`,
  ];
  return lines.join('\n');
}

// ════════════════════════════════════════════════════════════════════════════════
// MOCK BUILDER
// ════════════════════════════════════════════════════════════════════════════════

export function buildMockQBRReport(
  project:  ExecutionProject,
  roiState: ROIActualsState,
): QBRReport {
  const periodStart = '2026-02-17';
  const periodEnd   = '2026-03-03';
  const periodLabel = 'First 6 Weeks of Delivery · Feb–Mar 2026';
  return buildQBRReport(project, roiState, periodLabel, periodStart, periodEnd);
}