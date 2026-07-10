/**
 * POST-IMPLEMENTATION ROI TRACKING ENGINE — Phase 8
 *
 * Spec: roi-tracking-spec.md
 * Governance principle: Math decides variance. No storytelling.
 *
 * Exports:
 *   deriveBaselineFromDraft(draft)              → ROIBaseline
 *   buildProjectedTimeline(draft, months)       → ProjectedMonth[]
 *   buildMockActuals(projected, n)              → ROIActualsEntry[]
 *   computeVarianceRow(projected, actual, prev) → ROIVariance
 *   computeAllVariances(projected, actuals)     → ROIVariance[]
 *   deriveSolutionAttribution(draft, actuals)   → ROISolutionAttribution[]
 *   generateQuarterlySummary(...)               → string
 *
 * Ramp factors from cashflowEngine §4:
 *   M1=0%, M2=25%, M3=50%, M4=70%, M5=85%, M6+=100%
 * Investment front-loading (3-phase default): 40/35/25
 */

import type {
  ProposalDraft,
  ROIBaseline,
  ROIActualsEntry,
  ROIVariance,
  ROISolutionAttribution,
  BaselineMetrics,
  VarianceReasonTag,
} from '@/app/types/cortex-types';

// ════════════════════════════════════════════════════════════════════════════════
// RAMP FACTORS — mirrors cashflowEngine §4
// ════════════════════════════════════════════════════════════════════════════════

const GAIN_RAMP: readonly number[] = [0, 0.25, 0.50, 0.70, 0.85, 1.0];

function ramp(month: number): number {
  if (month <= 0) return 0;
  const idx = month - 1;
  return idx < GAIN_RAMP.length ? GAIN_RAMP[idx] : 1.0;
}

// Front-loaded investment weights — generalised from cashflowEngine §3
function investmentWeights(n: number): number[] {
  if (n === 1) return [1.0];
  if (n === 2) return [0.60, 0.40];
  if (n === 3) return [0.40, 0.35, 0.25];
  // For longer spans: linearly decay
  const weights: number[] = [];
  let sum = 0;
  for (let i = 0; i < n; i++) { const w = n - i; weights.push(w); sum += w; }
  return weights.map(w => w / sum);
}

// ════════════════════════════════════════════════════════════════════════════════
// PROJECTED TIMELINE TYPE
// ════════════════════════════════════════════════════════════════════════════════

export interface ProjectedMonth {
  month:               number;    // 1-based
  label:               string;
  monthly_gain:        number;
  monthly_investment:  number;
  net:                 number;
  cumulative:          number;
}

// ════════════════════════════════════════════════════════════════════════════════
// §2 — BASELINE DERIVATION
// Trigger: contract_signed OR onboarding_started.
// We derive conservative estimates from diagnostic and financial data.
// ════════════════════════════════════════════════════════════════════════════════

export function deriveBaselineFromDraft(draft: ProposalDraft): ROIBaseline {
  const fs       = draft.financial_summary;
  const did      = `D-${draft.proposal_id.replace(/\D/g, '').slice(-4).padStart(4, '0')}`;

  // Derive baseline metric estimates from whatever data we have.
  // When real data not available → conservative industry estimates.
  const headcount = (draft.implementation_plan?.team_structure.client_team_required.length ?? 0)
    + (draft.implementation_plan?.team_structure.cortex_team.length ?? 0)
    || 6;

  // Admin hours: ~30h/wk is a common pre-automation baseline for SMB
  const adminHours = 30;

  // Ticket volume: rough heuristic — 1 ticket per headcount per day × 5 days
  const ticketVol = Math.round(headcount * 3.5);

  // Tool costs: if financial_summary present, use ~8% of monthly investment as run-rate tool cost
  const toolCosts = fs ? Math.round(fs.investment_total * 0.08 / 12) : 800;

  // Conversion rate: 18% is a common B2B pre-AI baseline
  const conversionRate = 18;

  // Lead response time: 4 hours is a common pre-automation baseline
  const leadResponseTime = 4;

  // Proposal cycle: 14 days
  const proposalCycle = 14;

  // Response time: 3 hours
  const responseTime = 3;

  // Baseline quality: high if financial_summary + implementation_plan exist, medium otherwise
  const hasFinancials = !!fs;
  const hasPlan       = !!draft.implementation_plan;
  const quality       = hasFinancials && hasPlan ? 'high' : hasFinancials ? 'medium' : 'low';

  const metrics: BaselineMetrics = {
    ticket_volume_per_week:   ticketVol,
    response_time_hours:      responseTime,
    admin_hours_per_week:     adminHours,
    lead_response_time_hours: leadResponseTime,
    conversion_rate_pct:      conversionRate,
    proposal_cycle_days:      proposalCycle,
    tool_costs_monthly:       toolCosts,
    headcount_involved:       headcount,
  };

  return {
    baseline_id:          `BL-${draft.proposal_id}`,
    deal_id:              did,
    proposal_id:          draft.proposal_id,
    portfolio_version_id: draft.linkage.portfolio_version_id,
    captured_at:          new Date().toISOString(),
    metrics_snapshot:     metrics,
    baseline_quality:     quality,
    notes:                quality === 'high'
      ? 'Derived from complete financial summary and implementation plan.'
      : quality === 'medium'
      ? 'Partial baseline — financial data present but no implementation plan. Some estimates used.'
      : 'Minimal baseline — estimated from diagnostic heuristics. Recommend validating with client.',
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// §4 — PROJECTED TIMELINE BUILDER
// Uses financial_summary.annual_gain_conf_weighted + investment_total
// Applies gain ramp + front-loaded investment weights.
// ════════════════════════════════════════════════════════════════════════════════

export function buildProjectedTimeline(draft: ProposalDraft, months = 12): ProjectedMonth[] {
  const fs           = draft.financial_summary;
  const investment   = fs?.investment_total    ?? draft.next_step_offer.price ?? 0;
  const annualGain   = fs?.annual_gain_conf_weighted ?? investment * 1.8;  // fallback: 180% ROI if no FS

  const monthlyGainFull = annualGain / 12;

  // Spread investment across first 3 months (or fewer if months < 3)
  const investMonths  = Math.min(3, months);
  const weights       = investmentWeights(investMonths);
  const invByMonth    = weights.map(w => Math.round(investment * w));

  const rows: ProjectedMonth[] = [];
  let cumulative = 0;

  for (let m = 1; m <= months; m++) {
    const gain = Math.round(monthlyGainFull * ramp(m));
    const inv  = m <= investMonths ? (invByMonth[m - 1] ?? 0) : 0;
    const net  = gain - inv;
    cumulative += net;

    rows.push({
      month:              m,
      label:              `M${m}`,
      monthly_gain:       gain,
      monthly_investment: inv,
      net,
      cumulative,
    });
  }

  return rows;
}

// ════════════════════════════════════════════════════════════════════════════════
// §3 — MOCK ACTUALS SEED (3 months of real-ish data with variance)
// Used to populate the UI so the team can see the system working before real data.
// Seeded with pseudo-realistic under-performance in M1, catch-up in M2-M3.
// ════════════════════════════════════════════════════════════════════════════════

const ACTUAL_FACTORS = [0.0, 0.18, 0.42]; // M1, M2, M3 — slightly worse than ramp
const INV_FACTORS    = [1.05, 1.0, 0.95]; // M1 slightly over-invested (onboarding overhead)

export function buildMockActuals(
  projected: ProjectedMonth[],
  seedMonths = 3,
  dealId = 'D-0001',
  capturedBy = 'BD Lead',
): ROIActualsEntry[] {
  let cumActual = 0;
  const baseDate = new Date();
  baseDate.setDate(1);

  return projected.slice(0, seedMonths).map((p, i) => {
    const actualGain     = Math.round(p.monthly_gain * (i === 0 ? ACTUAL_FACTORS[0] : ACTUAL_FACTORS[i] ?? ACTUAL_FACTORS[ACTUAL_FACTORS.length - 1]));
    const actualInv      = Math.round(p.monthly_investment * (INV_FACTORS[i] ?? 1.0));
    const netActual      = actualGain - actualInv;
    cumActual           += netActual;

    const periodStart = new Date(baseDate);
    periodStart.setMonth(periodStart.getMonth() - (seedMonths - i));
    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    periodEnd.setDate(0); // last day of month

    return {
      actual_id:   `ACT-${String(i + 1).padStart(4, '0')}`,
      deal_id:     dealId,
      period_start: periodStart.toISOString().slice(0, 10),
      period_end:   periodEnd.toISOString().slice(0, 10),
      period_label: `Month ${i + 1}`,
      metrics: {
        actual_monthly_gain:       actualGain,
        actual_monthly_investment: actualInv,
        net_actual:                netActual,
        cumulative_actual:         cumActual,
      },
      notes:       i === 0
        ? 'Onboarding month — no gain expected per ramp model. Light integration overhead.'
        : i === 1
        ? 'Early traction. Workflow automation partially live. Conversion rate improving.'
        : 'Automation fully deployed for 2 of 3 solutions. Slightly ahead of M3 ramp target.',
      captured_by: capturedBy,
      created_at:  new Date().toISOString(),
    };
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// §4 — VARIANCE COMPUTATION
// variance_gain = actual_gain - projected_gain
// variance_payback_shift = actual_payback_month - projected_payback_month
// ════════════════════════════════════════════════════════════════════════════════

export function computeVarianceRow(
  projected:     ProjectedMonth,
  actual:        ROIActualsEntry,
  prevCumProj:   number,
  dealId:        string,
): ROIVariance {
  const projGain       = projected.monthly_gain;
  const projInv        = projected.monthly_investment;
  const projCumulative = projected.cumulative;

  const actGain  = actual.metrics.actual_monthly_gain;
  const actInv   = actual.metrics.actual_monthly_investment;
  const actCum   = actual.metrics.cumulative_actual;

  const varGain  = actGain - projGain;
  const varPct   = projGain !== 0 ? (varGain / projGain) * 100 : 0;

  // Payback shift: if cumulative actual is further from 0, payback is delayed
  // Approximation: Δcumulative / monthly_gain_full × 1 month
  const cumulativeDelta = actCum - projCumulative;
  const monthlyGainRef  = projGain > 0 ? projGain : 1;
  const paybackShift    = Math.round(-cumulativeDelta / monthlyGainRef * 10) / 10;

  // Auto-tag reasons based on variance magnitude
  const autoTags: VarianceReasonTag[] = [];
  if (varGain < 0) {
    if (projected.month <= 2)            autoTags.push('adoption_delay');
    if (actInv > projInv * 1.1)          autoTags.push('integration_blocker');
    if (Math.abs(varPct) > 50)           autoTags.push('underestimated_change_mgmt');
  }
  if (varGain > 0)                       autoTags.push('positive_outlier');

  return {
    variance_id:   `VAR-${projected.month.toString().padStart(3, '0')}`,
    deal_id:       dealId,
    period:        actual.period_start,
    period_label:  actual.period_label,
    projected: {
      monthly_gain:       projGain,
      monthly_investment: projInv,
      cumulative:         projCumulative,
    },
    actual: {
      monthly_gain:       actGain,
      monthly_investment: actInv,
      cumulative:         actCum,
    },
    delta: {
      variance_gain:          varGain,
      variance_pct:           Math.round(varPct * 10) / 10,
      variance_payback_shift: paybackShift,
    },
    variance_reason_tags: autoTags,
  };
}

export function computeAllVariances(
  projected: ProjectedMonth[],
  actuals:   ROIActualsEntry[],
  dealId:    string,
): ROIVariance[] {
  const rows: ROIVariance[] = [];
  let prevCumProj = 0;

  actuals.forEach((actual, i) => {
    const proj = projected[i];
    if (!proj) return;
    rows.push(computeVarianceRow(proj, actual, prevCumProj, dealId));
    prevCumProj = proj.cumulative;
  });

  return rows;
}

// ════════════════════════════════════════════════════════════════════════════════
// §1 — SOLUTION ATTRIBUTION
// Distributes actuals across solutions using their financial_levers weights.
// ════════════════════════════════════════════════════════════════════════════════

export function deriveSolutionAttribution(
  draft:   ProposalDraft,
  actuals: ROIActualsEntry[],
): ROISolutionAttribution[] {
  const solutions = draft.solutions ?? [];
  if (solutions.length === 0 || actuals.length === 0) return [];

  const did = `D-${draft.proposal_id.replace(/\D/g, '').slice(-4).padStart(4, '0')}`;

  // Compute each solution's weight as proportion of its financial binding annual_gain
  const totalBinding = solutions.reduce((sum, s) =>
    sum + (s.financial_binding?.annual_gain ?? (s.confidence_score / 100 * 50_000)), 0
  );

  // Use the most recent actual as the period reference
  const mostRecent = actuals[actuals.length - 1];
  if (!mostRecent) return [];

  // Total actual gain across all months
  const totalActual = actuals.reduce((sum, a) => sum + a.metrics.actual_monthly_gain, 0);
  const totalProjected = actuals.reduce((sum, a, i) => {
    // Use proportional amount from binding
    return sum + (totalBinding / 12) * (i + 1);
  }, 0);

  const rows: ROISolutionAttribution[] = [];

  solutions.forEach(sol => {
    const bindingAnnual = sol.financial_binding?.annual_gain
      ?? (sol.confidence_score / 100 * 50_000);
    const weight        = totalBinding > 0 ? bindingAnnual / totalBinding : 1 / solutions.length;

    const projectedGain         = Math.round(totalProjected * weight);
    const actualGain            = Math.round(totalActual * weight);
    const confFactor            = sol.confidence_score / 100;
    const confidenceAdjActual   = Math.round(actualGain * confFactor);
    const realizationFactor     = projectedGain > 0
      ? Math.round((actualGain / projectedGain) * 100) / 100
      : 0;

    rows.push({
      deal_id:                    did,
      solution_id:                sol.solution_id,
      solution_title:             sol.title,
      period:                     mostRecent.period_start,
      projected_gain:             projectedGain,
      actual_gain:                actualGain,
      confidence_adjusted_actual: confidenceAdjActual,
      realization_factor:         realizationFactor,
      notes:                      realizationFactor >= 1.0
        ? 'On or ahead of projection.'
        : realizationFactor >= 0.7
        ? 'Slightly below projection — monitor next cycle.'
        : 'Significant underperformance — review adoption and integration status.',
    });
  });

  return rows.sort((a, b) => b.actual_gain - a.actual_gain);
}

// ════════════════════════════════════════════════════════════════════════════════
// §7 — QUARTERLY REVIEW DRAFT GENERATOR
// "Quarterly Review Draft" button feeds Phase 9 later.
// ════════════════════════════════════════════════════════════════════════════════

export function generateQuarterlySummary(
  draft:         ProposalDraft,
  projected:     ProjectedMonth[],
  actuals:       ROIActualsEntry[],
  variances:     ROIVariance[],
  attribution:   ROISolutionAttribution[],
): string {
  const client  = draft.client.company_name;
  const contact = draft.client.primary_contact.name;
  const quarter = `Q${Math.ceil((new Date().getMonth() + 1) / 3)} ${new Date().getFullYear()}`;
  const fs      = draft.financial_summary;

  const totalActualGain  = actuals.reduce((s, a) => s + a.metrics.actual_monthly_gain, 0);
  const totalProjGain    = projected.slice(0, actuals.length).reduce((s, p) => s + p.monthly_gain, 0);
  const totalActualInv   = actuals.reduce((s, a) => s + a.metrics.actual_monthly_investment, 0);
  const netActual        = totalActualGain - totalActualInv;
  const realizationRate  = totalProjGain > 0
    ? Math.round((totalActualGain / totalProjGain) * 100)
    : 0;

  const varSummary = variances.length > 0
    ? variances.map(v =>
        `  • ${v.period_label}: ${v.delta.variance_gain >= 0 ? '+' : ''}${v.delta.variance_gain.toLocaleString()} gain variance (${v.delta.variance_pct >= 0 ? '+' : ''}${v.delta.variance_pct}%)` +
        (v.variance_reason_tags.length > 0 ? ` [${v.variance_reason_tags.join(', ')}]` : '')
      ).join('\n')
    : '  No variance data captured yet.';

  const attrSummary = attribution.length > 0
    ? attribution.map(a =>
        `  • ${a.solution_title}: projected $${a.projected_gain.toLocaleString()} | actual $${a.actual_gain.toLocaleString()} | realization ${(a.realization_factor * 100).toFixed(0)}%`
      ).join('\n')
    : '  No solution attribution data yet.';

  return `MARQ CORTEX — QUARTERLY ROI REVIEW DRAFT
${quarter} | ${client} | Contact: ${contact}
${'─'.repeat(60)}

ENGAGEMENT OVERVIEW
Proposal:              ${draft.proposal_id}
Portfolio Version:     ${draft.linkage.portfolio_version_id}
Projected Annual Gain: ${fs ? `$${fs.annual_gain_conf_weighted.toLocaleString()}` : 'N/A'}
Total Investment:      ${fs ? `$${fs.investment_total.toLocaleString()}` : 'N/A'}
Projected ROI:         ${fs ? `${fs.roi_percentage.toFixed(1)}%` : 'N/A'}

TRACKING PERIOD: ${actuals.length > 0 ? `${actuals[0]?.period_label} → ${actuals[actuals.length - 1]?.period_label}` : 'No actuals yet'}

ACTUAL VS PROJECTED PERFORMANCE
Total Projected Gain:  $${totalProjGain.toLocaleString()}
Total Actual Gain:     $${totalActualGain.toLocaleString()}
Total Investment:      $${totalActualInv.toLocaleString()}
Net Actual Value:      $${netActual.toLocaleString()}
Realization Rate:      ${realizationRate}%

VARIANCE LOG
${varSummary}

SOLUTION ATTRIBUTION
${attrSummary}

REALIZATION FACTOR UPDATE (Spec §6)
Efficiency realization: ${realizationRate > 0 ? (realizationRate / 100).toFixed(2) : 'N/A'} | Industry: ${draft.client.industry}
→ Update internal realization factors for ${draft.client.industry} after 3+ deals.

RECOMMENDATIONS FOR NEXT QUARTER
${realizationRate < 70
  ? '• Realization below 70%. Priority: identify adoption blockers and escalate to client stakeholder.'
  : realizationRate < 90
  ? '• Realization 70–90%. On track but room to accelerate. Schedule optimisation session.'
  : '• Realization ≥ 90%. Strong performance. Begin upsell conversation for Phase 2 scope expansion.'}
• Schedule quarterly review call with ${contact} within 5 business days.
• Update CRM stage if implementation milestones reached.

Generated: ${new Date().toLocaleString()} | MARQ Cortex Phase 8 Tracking
`;
}

// ════════════════════════════════════════════════════════════════════════════════
// VARIANCE REASON TAG CONFIG — labels + colors for UI
// ════════════════════════════════════════════════════════════════════════════════

export interface VarianceTagCfg { label: string; color: string; group: 'delay' | 'blocker' | 'positive' }

export const VARIANCE_TAG_CFG: Record<VarianceReasonTag, VarianceTagCfg> = {
  adoption_delay:              { label: 'Adoption Delay',             color: '#FB923C', group: 'delay'    },
  data_quality_issue:          { label: 'Data Quality',               color: '#F59E0B', group: 'delay'    },
  scope_change:                { label: 'Scope Change',               color: '#FB923C', group: 'delay'    },
  integration_blocker:         { label: 'Integration Blocker',        color: '#FD4438', group: 'blocker'  },
  stakeholder_bottleneck:      { label: 'Stakeholder Bottleneck',     color: '#FD4438', group: 'blocker'  },
  tool_limitations:            { label: 'Tool Limitations',           color: '#F59E0B', group: 'blocker'  },
  model_performance:           { label: 'Model Performance',          color: '#8B5CF6', group: 'blocker'  },
  underestimated_change_mgmt:  { label: 'Change Mgmt Underestimated', color: '#FB923C', group: 'delay'    },
  positive_outlier:            { label: 'Positive Outlier',           color: '#10B981', group: 'positive' },
};
