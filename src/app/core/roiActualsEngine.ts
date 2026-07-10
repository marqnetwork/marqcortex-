/**
 * LIVE ROI ACTUALS ENGINE — roi-actuals-engine.md
 *
 * Tracks real delivery results and compares them against:
 *   A) Baseline (locked at kickoff)
 *   B) Projected ROI (from proposal snapshot / ROI engine)
 *   C) Solution-level attribution
 *
 * Then generates:
 *   • variance alerts
 *   • payback progress
 *   • credibility-safe reporting
 *
 * DATA OBJECTS:
 *   A) roi_actuals_baseline   — captured once per execution, immutable
 *   B) roi_projection_snapshot — copied from proposal snapshot, immutable
 *   C) roi_actual_month       — manually entered monthly by team
 *   D) roi_variance_month     — auto-computed
 *
 * CALCULATIONS (from spec):
 *   Labor Cost Saved:    hours_saved * avg_fully_loaded_cost_per_hour
 *   Efficiency Savings:  time_saved_minutes / 60 * avg_fully_loaded_cost_per_hour
 *   Revenue Lift:        revenue_delta * (gross_margin_percent / 100)
 *   Actual Monthly Gain: labor_savings + efficiency_savings + margin_lift
 *   Net Actual:          actual_gain - monthly_project_cost
 *
 * ALERTS trigger when:
 *   1. actual gain < 70% of projected for 2 consecutive months
 *   2. automation coverage stagnates (< 5% change over 2 months)
 *   3. payback shifts by +2 months vs projection
 *   4. same variance tag repeats for 2+ consecutive months
 */

import type { ExecutionProject } from './executionEngine';

// ════════════════════════════════════════════════════════════════════════════════
// TYPES — DATA OBJECTS
// ════════════════════════════════════════════════════════════════════════════════

/** A) Extended baseline — captured once at execution start, immutable. */
export interface ROIActualsBaseline {
  baseline_id:      string;
  execution_id:     string;
  captured_at:      string;
  baseline_quality: 'low' | 'medium' | 'high' | 'confirmed' | 'estimated' | 'assumed';
  notes:            string;
  metrics: {
    manual_hours_per_week:            number;
    avg_fully_loaded_cost_per_hour:   number;  // $ per hour (fully loaded)
    monthly_revenue:                  number;
    gross_margin_percent:             number;
    lead_to_close_rate_percent:       number;
    avg_sales_cycle_days:             number;
    tickets_per_month:                number;
    avg_ticket_handle_time_minutes:   number;
  };
}

/** B) Projected monthly cashflow entry (from proposal snapshot). */
export interface MonthlyCashflow {
  month:           string;  // "YYYY-MM"
  projected_gain:  number;
  projected_cost:  number;
}

/** B) Projection snapshot — copied from proposal ROI outputs. Immutable. */
export interface ROIProjectionSnapshot {
  projection_id:           string;
  execution_id:            string;
  proposal_snapshot_id:    string;
  scenario:                'conservative' | 'expected' | 'optimistic';
  monthly_cashflows:       MonthlyCashflow[];
  projected_roi_percent:   number;
  projected_payback_month: number;  // 1-based month index (e.g. 5 = payback in month 5)
}

/** Per-workstream attribution for a given month. sum(percent) MUST = 100. */
export interface WorkstreamAttribution {
  workstream_id:    string;
  workstream_title: string;
  percent:          number;
  attributed_gain:  number;  // computed: actual_gain * (percent / 100)
}

/** Fixed variance tags — feed QBR reporting. */
export type VarianceTag =
  | 'adoption_delay'
  | 'stakeholder_blocker'
  | 'data_quality_issue'
  | 'integration_delay'
  | 'scope_change'
  | 'training_required'
  | 'positive_outlier'
  | 'measurement_noise';

export const VARIANCE_TAG_LABELS: Record<VarianceTag, string> = {
  adoption_delay:       'Adoption Delay',
  stakeholder_blocker:  'Stakeholder Blocker',
  data_quality_issue:   'Data Quality Issue',
  integration_delay:    'Integration Delay',
  scope_change:         'Scope Change',
  training_required:    'Training Required',
  positive_outlier:     'Positive Outlier',
  measurement_noise:    'Measurement Noise',
};

export const VARIANCE_TAG_COLORS: Record<VarianceTag, string> = {
  adoption_delay:       '#FB923C',
  stakeholder_blocker:  '#FD4438',
  data_quality_issue:   '#F59E0B',
  integration_delay:    '#FB923C',
  scope_change:         '#8B5CF6',
  training_required:    '#06D7F6',
  positive_outlier:     '#10B981',
  measurement_noise:    '#6B7280',
};

export const ALL_VARIANCE_TAGS: VarianceTag[] = [
  'adoption_delay', 'stakeholder_blocker', 'data_quality_issue',
  'integration_delay', 'scope_change', 'training_required',
  'positive_outlier', 'measurement_noise',
];

/** C) Monthly actuals — manually entered by team. */
export interface ROIActualMonth {
  actual_id:            string;
  execution_id:         string;
  month:                string;  // "YYYY-MM"
  metrics: {
    manual_hours_per_week:           number;
    monthly_revenue:                 number;
    tickets_per_month:               number;
    avg_ticket_handle_time_minutes:  number;
    automation_coverage_percent:     number;
  };
  monthly_project_cost: number;
  attribution:          WorkstreamAttribution[];
  variance_tags:        VarianceTag[];
  evidence_links:       string[];
  notes:                string;
  submitted_by:         string;
  submitted_at:         string;
}

/** D) Variance record — auto-computed per month. */
export interface ROIVarianceMonth {
  variance_id:          string;
  execution_id:         string;
  month:                string;
  // component breakdown
  labor_savings:        number;
  efficiency_savings:   number;
  margin_lift:          number;
  actual_gain:          number;
  net_actual:           number;
  // comparison
  projected: { gain: number; cost: number };
  actual:    { gain: number; cost: number };
  delta:     { gain: number; cost: number };
  payback_progress: {
    projected_cumulative_net:       number;
    actual_cumulative_net:          number;
    estimated_payback_month_actual: number;  // 1-based month index
  };
  variance_tags: VarianceTag[];
}

/** Alert types from spec §5. */
export type ROIAlertType =
  | 'roi_underperforming'
  | 'automation_stagnation'
  | 'payback_shifted'
  | 'recurring_blocker';

export interface ROIAlert {
  alert_id:           string;
  execution_id:       string;
  month:              string;
  alert_type:         ROIAlertType;
  severity:           'medium' | 'high';
  title:              string;
  recommended_action: string;
  triggered_at:       string;
  dismissed:          boolean;
}

export const ALERT_CFG: Record<ROIAlertType, { label: string; color: string }> = {
  roi_underperforming: { label: 'ROI Underperforming', color: '#FD4438'  },
  automation_stagnation: { label: 'Automation Stagnation', color: '#F59E0B' },
  payback_shifted:     { label: 'Payback Shifted',     color: '#FB923C'  },
  recurring_blocker:   { label: 'Recurring Blocker',   color: '#8B5CF6'  },
};

/** Full ROI actuals state per execution. */
export interface ROIActualsState {
  execution_id: string;
  baseline:     ROIActualsBaseline;
  projection:   ROIProjectionSnapshot;
  actuals:      ROIActualMonth[];
  variances:    ROIVarianceMonth[];
  alerts:       ROIAlert[];
}

// ════════════════════════════════════════════════════════════════════════════════
// UTILITY
// ════════════════════════════════════════════════════════════════════════════════

let _alertCount = 0;
function alertId() { return `ALT-${String(++_alertCount).padStart(4, '0')}`; }

function isoMonth(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function addMonthsStr(base: string, n: number): string {
  const d = new Date(base + '-01T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}

export function formatMonth(m: string): string {
  const d = new Date(m + '-01T00:00:00Z');
  return d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Returns the next month string that hasn't been submitted yet. */
export function getNextAvailableMonth(state: ROIActualsState): string {
  const submitted = new Set(state.actuals.map(a => a.month));
  const first     = state.projection.monthly_cashflows[0]?.month ?? isoMonth(new Date());
  let   month     = first;
  for (let i = 0; i < 24; i++) {
    if (!submitted.has(month)) return month;
    month = addMonthsStr(month, 1);
  }
  return isoMonth(new Date());
}

/** Compute running cumulative nets from variances (for payback chart). */
export function buildCumulativeActuals(variances: ROIVarianceMonth[]): Map<string, number> {
  const map = new Map<string, number>();
  let cum   = 0;
  [...variances].sort((a, b) => a.month.localeCompare(b.month)).forEach(v => {
    cum += v.net_actual;
    map.set(v.month, cum);
  });
  return map;
}

// ════════════════════════════════════════════════════════════════════════════════
// A) BUILD BASELINE FROM EXECUTION PROJECT
// ════════════════════════════════════════════════════════════════════════════════

export function buildROIActualsBaseline(project: ExecutionProject): ROIActualsBaseline {
  const m = project.baseline.metrics_snapshot;
  return {
    baseline_id:      project.baseline.baseline_id,
    execution_id:     project.execution_id,
    captured_at:      project.baseline.captured_at,
    baseline_quality: project.baseline.baseline_quality as any,
    notes:            'Captured at execution kickoff. Immutable unless change order.',
    metrics: {
      manual_hours_per_week:          project.baseline.manual_hours_per_week,
      avg_fully_loaded_cost_per_hour: 65,  // $65/hr fully-loaded (team-confirmed at kickoff)
      monthly_revenue:                project.baseline.monthly_revenue,
      gross_margin_percent:           38,
      lead_to_close_rate_percent:     project.baseline.conversion_rate,
      avg_sales_cycle_days:           45,
      tickets_per_month:              320,
      avg_ticket_handle_time_minutes: 18,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// B) BUILD PROJECTION SNAPSHOT FROM EXECUTION PROJECT
// ════════════════════════════════════════════════════════════════════════════════

const RAMP_FACTORS = [0, 0.25, 0.5, 0.7, 0.85, 1, 1, 1, 1, 1, 1, 1];
const COST_DIST    = [0.40, 0.35, 0.25, 0, 0, 0, 0, 0, 0, 0, 0, 0];

export function buildROIProjectionSnapshot(project: ExecutionProject): ROIProjectionSnapshot {
  const m          = project.baseline.metrics_snapshot;
  const startMonth = isoMonth(new Date(project.created_at));

  const monthly_cashflows: MonthlyCashflow[] = RAMP_FACTORS.map((ramp, i) => ({
    month:          addMonthsStr(startMonth, i),
    projected_gain: Math.round(m.monthly_cost_before * ramp * 0.3 + m.hours_wasted_monthly * ramp * 80),
    projected_cost: Math.round(m.total_investment * (COST_DIST[i] ?? 0)),
  }));

  // Find payback month (first month where cumulative net ≥ 0)
  let cum = 0;
  let projected_payback_month = 12;
  for (let i = 0; i < monthly_cashflows.length; i++) {
    cum += monthly_cashflows[i].projected_gain - monthly_cashflows[i].projected_cost;
    if (cum >= 0) { projected_payback_month = i + 1; break; }
  }

  return {
    projection_id:           `PRJ-${project.execution_id}`,
    execution_id:            project.execution_id,
    proposal_snapshot_id:    project.proposal_snapshot_id,
    scenario:                'expected',
    monthly_cashflows,
    projected_roi_percent:   m.roi_12m_percent,
    projected_payback_month,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// CALCULATIONS (spec §2)
// ════════════════════════════════════════════════════════════════════════════════

export function computeLaborSavings(
  actual:   ROIActualMonth,
  baseline: ROIActualsBaseline,
): number {
  const baselineHours = baseline.metrics.manual_hours_per_week * 4.33;
  const actualHours   = actual.metrics.manual_hours_per_week * 4.33;
  const hoursSaved    = Math.max(0, baselineHours - actualHours);
  return Math.round(hoursSaved * baseline.metrics.avg_fully_loaded_cost_per_hour);
}

export function computeEfficiencySavings(
  actual:   ROIActualMonth,
  baseline: ROIActualsBaseline,
): number {
  const timeSavedMinutes =
    (baseline.metrics.avg_ticket_handle_time_minutes - actual.metrics.avg_ticket_handle_time_minutes)
    * actual.metrics.tickets_per_month;
  if (timeSavedMinutes <= 0) return 0;
  return Math.round((timeSavedMinutes / 60) * baseline.metrics.avg_fully_loaded_cost_per_hour);
}

export function computeMarginLift(
  actual:   ROIActualMonth,
  baseline: ROIActualsBaseline,
): number {
  const revenueDelta = Math.max(0, actual.metrics.monthly_revenue - baseline.metrics.monthly_revenue);
  return Math.round(revenueDelta * (baseline.metrics.gross_margin_percent / 100));
}

export function computeActualGain(
  actual:   ROIActualMonth,
  baseline: ROIActualsBaseline,
): number {
  return computeLaborSavings(actual, baseline)
       + computeEfficiencySavings(actual, baseline)
       + computeMarginLift(actual, baseline);
}

export function computeNetActual(
  actual:   ROIActualMonth,
  baseline: ROIActualsBaseline,
): number {
  return computeActualGain(actual, baseline) - actual.monthly_project_cost;
}

// ════════════════════════════════════════════════════════════════════════════════
// D) COMPUTE ROI VARIANCE MONTH
// ════════════════════════════════════════════════════════════════════════════════

export function computeVariance(
  actual:         ROIActualMonth,
  baseline:       ROIActualsBaseline,
  projection:     ROIProjectionSnapshot,
  prevActualCum:  number,
): ROIVarianceMonth {
  const cf       = projection.monthly_cashflows.find(c => c.month === actual.month);
  const projGain = cf?.projected_gain ?? 0;
  const projCost = cf?.projected_cost ?? 0;

  const labor      = computeLaborSavings(actual, baseline);
  const efficiency = computeEfficiencySavings(actual, baseline);
  const margin     = computeMarginLift(actual, baseline);
  const gain       = labor + efficiency + margin;
  const net        = gain - actual.monthly_project_cost;

  // Projected cumulative (up to this month)
  const projCumNet = (() => {
    const monthIdx = projection.monthly_cashflows.findIndex(c => c.month === actual.month);
    let cum = 0;
    for (let i = 0; i <= monthIdx && i < projection.monthly_cashflows.length; i++) {
      cum += projection.monthly_cashflows[i].projected_gain - projection.monthly_cashflows[i].projected_cost;
    }
    return cum;
  })();

  const actualCum = prevActualCum + net;

  // Estimate payback month for actuals: find when actual trend crosses 0
  // Simplified: linear extrapolation from current month
  let estimatedPayback = projection.projected_payback_month;
  if (actualCum < 0 && gain > 0) {
    const monthsLeft = Math.ceil(-actualCum / Math.max(gain - actual.monthly_project_cost, 1));
    const monthIdx   = projection.monthly_cashflows.findIndex(c => c.month === actual.month);
    estimatedPayback = monthIdx + 1 + monthsLeft;
  } else if (actualCum >= 0) {
    const monthIdx = projection.monthly_cashflows.findIndex(c => c.month === actual.month);
    estimatedPayback = monthIdx + 1;
  }

  return {
    variance_id:     `VAR-${actual.month}`,
    execution_id:    actual.execution_id,
    month:           actual.month,
    labor_savings:   labor,
    efficiency_savings: efficiency,
    margin_lift:     margin,
    actual_gain:     gain,
    net_actual:      net,
    projected:       { gain: projGain, cost: projCost },
    actual:          { gain, cost: actual.monthly_project_cost },
    delta:           { gain: gain - projGain, cost: actual.monthly_project_cost - projCost },
    payback_progress: {
      projected_cumulative_net:       projCumNet,
      actual_cumulative_net:          actualCum,
      estimated_payback_month_actual: Math.min(estimatedPayback, 24),
    },
    variance_tags: actual.variance_tags,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// §5 — ALERTS
// ════════════════════════════════════════════════════════════════════════════════

export function detectROIAlerts(
  state: ROIActualsState,
): ROIAlert[] {
  const { actuals, variances, projection } = state;
  const now = new Date().toISOString();
  const newAlerts: ROIAlert[] = [];
  const existingTypes = new Set(state.alerts.filter(a => !a.dismissed).map(a => `${a.alert_type}-${a.month}`));

  const lastMonth = variances.length > 0 ? variances[variances.length - 1].month : '';

  // ── 1. actual gain < 70% of projected for 2 consecutive months ───────────
  if (variances.length >= 2) {
    const last2 = variances.slice(-2);
    const underperform = last2.every(v => {
      const proj = projection.monthly_cashflows.find(m => m.month === v.month);
      if (!proj || proj.projected_gain === 0) return false;
      return v.actual_gain < proj.projected_gain * 0.70;
    });
    if (underperform) {
      const key = `roi_underperforming-${lastMonth}`;
      if (!existingTypes.has(key)) {
        newAlerts.push({
          alert_id:           alertId(),
          execution_id:       state.execution_id,
          month:              lastMonth,
          alert_type:         'roi_underperforming',
          severity:           'high',
          title:              'ROI Underperforming — 2 Consecutive Months',
          recommended_action: 'Review delivery blockers. Run adoption workshop. Fix integration bottleneck.',
          triggered_at:       now,
          dismissed:          false,
        });
      }
    }
  }

  // ── 2. automation coverage stagnates (< 5% change over last 2 months) ────
  if (actuals.length >= 2) {
    const last2 = actuals.slice(-2);
    const delta = Math.abs(
      last2[1].metrics.automation_coverage_percent - last2[0].metrics.automation_coverage_percent
    );
    if (delta < 5) {
      const key = `automation_stagnation-${lastMonth}`;
      if (!existingTypes.has(key)) {
        newAlerts.push({
          alert_id:           alertId(),
          execution_id:       state.execution_id,
          month:              lastMonth,
          alert_type:         'automation_stagnation',
          severity:           'medium',
          title:              'Automation Coverage Stagnating',
          recommended_action: 'Investigate automation adoption. Check workflows are active and correctly configured.',
          triggered_at:       now,
          dismissed:          false,
        });
      }
    }
  }

  // ── 3. payback shifts by +2 months vs projection ─────────────────────────
  if (variances.length > 0) {
    const lastVar = variances[variances.length - 1];
    const shift   = lastVar.payback_progress.estimated_payback_month_actual
                  - projection.projected_payback_month;
    if (shift >= 2) {
      const key = `payback_shifted-${lastMonth}`;
      if (!existingTypes.has(key)) {
        newAlerts.push({
          alert_id:           alertId(),
          execution_id:       state.execution_id,
          month:              lastMonth,
          alert_type:         'payback_shifted',
          severity:           'medium',
          title:              `Payback Delayed +${shift} Months`,
          recommended_action: 'Escalate to sponsor. Review ROI actuals with delivery team. Accelerate adoption plan.',
          triggered_at:       now,
          dismissed:          false,
        });
      }
    }
  }

  // ── 4. same variance tag repeats across last 2 months ────────────────────
  if (actuals.length >= 2) {
    const last2Tags = actuals.slice(-2).map(a => new Set(a.variance_tags));
    const repeats   = [...last2Tags[0]].filter(t =>
      last2Tags[1].has(t) && t !== 'positive_outlier' && t !== 'measurement_noise'
    );
    if (repeats.length > 0) {
      const key = `recurring_blocker-${lastMonth}`;
      if (!existingTypes.has(key)) {
        newAlerts.push({
          alert_id:           alertId(),
          execution_id:       state.execution_id,
          month:              lastMonth,
          alert_type:         'recurring_blocker',
          severity:           'high',
          title:              `Recurring Blocker: ${repeats.map(r => VARIANCE_TAG_LABELS[r as VarianceTag]).join(', ')}`,
          recommended_action: 'Run root cause analysis this sprint. Assign owner to unblock.',
          triggered_at:       now,
          dismissed:          false,
        });
      }
    }
  }

  return newAlerts;
}

// ════════════════════════════════════════════════════════════════════════════════
// SUBMIT MONTHLY ACTUALS — main mutation
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Submit a new month's actuals. Returns updated state with:
 *   - new actual added
 *   - variance auto-computed
 *   - attribution derived gain computed
 *   - alerts re-evaluated
 */
export function submitMonthlyActuals(
  state:   ROIActualsState,
  partial: Omit<ROIActualMonth, 'actual_id' | 'submitted_at' | 'execution_id'>,
): ROIActualsState {
  const actual: ROIActualMonth = {
    ...partial,
    actual_id:    `ACT-${partial.month}`,
    execution_id: state.execution_id,
    submitted_at: new Date().toISOString(),
    // Compute attribution gains
    attribution: partial.attribution.map(a => ({
      ...a,
      attributed_gain: Math.round(
        computeActualGain({ ...partial, actual_id: '', execution_id: state.execution_id, submitted_at: '' } as ROIActualMonth, state.baseline)
        * (a.percent / 100)
      ),
    })),
  };

  // Build cumulative from previous variances
  const sorted   = [...state.variances].sort((a, b) => a.month.localeCompare(b.month));
  const prevCum  = sorted.reduce((s, v) => s + v.net_actual, 0);
  const variance = computeVariance(actual, state.baseline, state.projection, prevCum);

  const newActuals   = [...state.actuals, actual].sort((a, b) => a.month.localeCompare(b.month));
  const newVariances = [...state.variances, variance].sort((a, b) => a.month.localeCompare(b.month));

  const stateWithData: ROIActualsState = {
    ...state,
    actuals:   newActuals,
    variances: newVariances,
  };

  const newAlerts = detectROIAlerts(stateWithData);
  return { ...stateWithData, alerts: [...state.alerts, ...newAlerts] };
}

// ════════════════════════════════════════════════════════════════════════════════
// CHART DATA BUILDERS — for UI
// ════════════════════════════════════════════════════════════════════════════════

export interface ROIChartPoint {
  month:            string;
  label:            string;
  projected_gain:   number;
  actual_gain:      number | null;
  net_projected:    number;
  net_actual:       number | null;
}

export function buildROIChartData(state: ROIActualsState): ROIChartPoint[] {
  return state.projection.monthly_cashflows.map(cf => {
    const variance = state.variances.find(v => v.month === cf.month);
    return {
      month:          cf.month,
      label:          formatMonth(cf.month),
      projected_gain: cf.projected_gain,
      actual_gain:    variance?.actual_gain ?? null,
      net_projected:  cf.projected_gain - cf.projected_cost,
      net_actual:     variance?.net_actual ?? null,
    };
  });
}

export interface PaybackChartPoint {
  month:               string;
  label:               string;
  projected_cum:       number;
  actual_cum:          number | null;
}

export function buildPaybackChartData(state: ROIActualsState): PaybackChartPoint[] {
  let projCum = 0;
  const cumulativeActuals = buildCumulativeActuals(state.variances);

  return state.projection.monthly_cashflows.map(cf => {
    projCum += cf.projected_gain - cf.projected_cost;
    return {
      month:         cf.month,
      label:         formatMonth(cf.month),
      projected_cum: projCum,
      actual_cum:    cumulativeActuals.has(cf.month) ? cumulativeActuals.get(cf.month)! : null,
    };
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// VARIANCE TAG FREQUENCY ANALYSIS — for QBR
// ════════════════════════════════════════════════════════════════════════════════

export interface TagFrequency {
  tag:   VarianceTag;
  count: number;
  months: string[];
}

export function analyzeVarianceTags(actuals: ROIActualMonth[]): TagFrequency[] {
  const freq = new Map<VarianceTag, { count: number; months: string[] }>();
  actuals.forEach(a => {
    a.variance_tags.forEach(tag => {
      const existing = freq.get(tag) ?? { count: 0, months: [] };
      freq.set(tag, { count: existing.count + 1, months: [...existing.months, a.month] });
    });
  });
  return [...freq.entries()]
    .map(([tag, { count, months }]) => ({ tag, count, months }))
    .sort((a, b) => b.count - a.count);
}

// ════════════════════════════════════════════════════════════════════════════════
// STATE INITIALISER + MOCK DATA
// ════════════════════════════════════════════════════════════════════════════════

export function initROIActualsState(project: ExecutionProject): ROIActualsState {
  return {
    execution_id: project.execution_id,
    baseline:     buildROIActualsBaseline(project),
    projection:   buildROIProjectionSnapshot(project),
    actuals:      [],
    variances:    [],
    alerts:       [],
  };
}

/**
 * Build mock ROI actuals state for ExampleCo demo.
 * Seeds M1 (Feb 2026) as a submitted actual showing early positive performance.
 */
export function buildMockROIActualsState(project: ExecutionProject): ROIActualsState {
  const base  = buildROIActualsBaseline(project);
  const proj  = buildROIProjectionSnapshot(project);

  // M1 actual — Feb 2026 (execution started ~14 days ago, M1 just closed)
  const m1Month = proj.monthly_cashflows[0]?.month ?? '2026-02';
  const m1: Omit<ROIActualMonth, 'actual_id' | 'submitted_at' | 'execution_id'> = {
    month: m1Month,
    metrics: {
      manual_hours_per_week:           112,   // baseline 120 → 8h/wk saved
      monthly_revenue:                 251_500,  // baseline 250k → slight lift
      tickets_per_month:               315,   // baseline 320
      avg_ticket_handle_time_minutes:  17,    // baseline 18 → 1 min faster
      automation_coverage_percent:     18,
    },
    monthly_project_cost: Math.round(project.baseline.metrics_snapshot.total_investment * 0.40),
    attribution: [
      { workstream_id: project.workstreams[0]?.workstream_id ?? 'WS-S001', workstream_title: project.workstreams[0]?.title ?? 'AI Operations Layer',     percent: 50, attributed_gain: 0 },
      { workstream_id: project.workstreams[1]?.workstream_id ?? 'WS-S002', workstream_title: project.workstreams[1]?.title ?? 'Revenue Intelligence',    percent: 30, attributed_gain: 0 },
      { workstream_id: project.workstreams[2]?.workstream_id ?? 'WS-S003', workstream_title: project.workstreams[2]?.title ?? 'Systems Integration Hub', percent: 20, attributed_gain: 0 },
    ],
    variance_tags:  [],
    evidence_links: ['https://crm.internal/reports/feb-2026', 'https://ops.internal/automation/coverage'],
    notes:          'First month of delivery. Automation coverage building. Labour savings confirmed by ops lead.',
    submitted_by:   'Account Lead',
  };

  // Compute actual gain to back-fill attribution
  const tempActual: ROIActualMonth = { ...m1, actual_id: '', execution_id: project.execution_id, submitted_at: '' };
  const gain = computeActualGain(tempActual, base);
  m1.attribution = m1.attribution.map(a => ({ ...a, attributed_gain: Math.round(gain * a.percent / 100) }));

  const fullM1: ROIActualMonth = {
    ...m1,
    actual_id:    `ACT-${m1Month}`,
    execution_id: project.execution_id,
    submitted_at: new Date(Date.now() - 1 * 86_400_000).toISOString(),
  };

  const variance1 = computeVariance(fullM1, base, proj, 0);

  return {
    execution_id: project.execution_id,
    baseline:     base,
    projection:   proj,
    actuals:      [fullM1],
    variances:    [variance1],
    alerts:       [],  // none triggered yet — only 1 month of data
  };
}
