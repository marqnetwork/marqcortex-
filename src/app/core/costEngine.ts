/**
 * CORTEX CORE — COST ENGINE (cost_model_v1_standardized)
 *
 * Recommendation Cost Modeling Layer — cost-modeling-layer.md
 *
 * Enforces:
 *   §1 — 5-category cost structure (no lump-sum internally)
 *   §2 — Engineering cost = allocated_percent × monthly_role_cost × duration_months
 *   §3 — Strategy cost = consultant_daily_rate × strategy_days
 *   §4 — Tooling cost = monthly_tool_cost × project_months
 *   §5 — Change management = training_hours × blended_labor_rate
 *   §6 — Contingency = 10–20% of subtotal (default 15%, never zero)
 *   §7 — Total = subtotal + contingency
 *   §8 — Investment range (low/mid/high) if uncertainty exists
 *   §9 — Governance: no rec > 40% of portfolio, duration must align
 *   §10 — Output structure per recommendation
 *
 * Math decides cost. Not arbitrary pricing.
 */

import type {
  RecommendationV2,
  CostModel,
  CostBreakdown,
  InvestmentEstimate,
  DepartmentKey,
  PortfolioAssumptions,
} from './types';
import { DOMAIN_TO_SPRINT } from './types';
import { getSprintTemplate } from './sprintTemplates';

// ════════════════════════════════════════════════════════════════════════════════
// DEFAULT RATE ASSUMPTIONS
// ════════════════════════════════════════════════════════════════════════════════
// These can be overridden by PortfolioAssumptions or ResourceRequirement.monthly_role_cost

const DEFAULT_MONTHLY_ROLE_COSTS: Record<string, number> = {
  'AI Engineer': 8000,
  'ML Engineer': 8500,
  'Backend Engineer': 7500,
  'Frontend Engineer': 7000,
  'Full Stack Engineer': 7500,
  'Data Engineer': 7500,
  'Data Analyst': 5500,
  'DevOps Engineer': 7000,
  'QA Engineer': 5000,
  'Project Manager': 6000,
  'Product Manager': 7000,
  'UX Designer': 6000,
  'Business Analyst': 5500,
  'Technical Lead': 9000,
};

const DEFAULT_BLENDED_MONTHLY_COST = 6500; // fallback if role not found
const CONSULTANT_DAILY_RATE = 1200;        // strategy/consultancy default
const DEFAULT_MONTHLY_TOOL_COST = 200;     // per-tool SaaS estimate
const DEFAULT_CONTINGENCY_PERCENT = 15;    // §6: default 15%
const MIN_CONTINGENCY_PERCENT = 10;
const MAX_CONTINGENCY_PERCENT = 20;
const PORTFOLIO_CAP_PERCENT = 40;          // §9: no single rec > 40%

// ════════════════════════════════════════════════════════════════════════════════
// DEPARTMENT → PRIMARY DOMAIN (for sprint template lookup)
// ════════════════════════════════════════════════════════════════════════════════

const DEPARTMENT_TO_PRIMARY_DOMAIN: Record<string, string> = {
  revenue_engine: 'revenue',
  customer_experience: 'customer_experience',
  operations_supply_chain: 'operations',
  marketing_acquisition: 'revenue',
  finance_unit_economics: 'governance',
  data_infrastructure: 'data',
  talent_process: 'operations',
};

// ════════════════════════════════════════════════════════════════════════════════
// §2 — ENGINEERING COST
// ════════════════════════════════════════════════════════════════════════════════

function computeEngineeringCost(
  rec: RecommendationV2,
  durationMonths: number,
  laborCostOverride?: number,
): { cost: number; notes: string[] } {
  const notes: string[] = [];
  let totalEngCost = 0;

  if (rec.resource_requirements.length === 0) {
    // No resources declared — estimate from sprint template
    const blended = laborCostOverride
      ? laborCostOverride * 160 // hourly → monthly (160 hrs)
      : DEFAULT_BLENDED_MONTHLY_COST;
    totalEngCost = blended * durationMonths * 0.5; // assume 50% allocation
    notes.push(`Engineering: estimated from blended rate ($${Math.round(blended)}/mo × ${durationMonths}mo × 50% allocation)`);
  } else {
    for (const res of rec.resource_requirements) {
      const monthlyCost = res.monthly_role_cost
        ?? DEFAULT_MONTHLY_ROLE_COSTS[res.role]
        ?? (laborCostOverride ? laborCostOverride * 160 : DEFAULT_BLENDED_MONTHLY_COST);
      const allocation = res.allocation_percent / 100;

      // Determine active duration from phase
      const phase = rec.execution_plan.phases.find(p => p.phase_id === res.active_phase);
      const phaseDurationMonths = phase
        ? phase.duration_days / 30
        : durationMonths;

      const cost = Math.round(allocation * monthlyCost * phaseDurationMonths);
      totalEngCost += cost;
      notes.push(
        `Engineering (${res.role}): ${(allocation * 100).toFixed(0)}% × $${monthlyCost}/mo × ${phaseDurationMonths.toFixed(1)}mo = $${cost}`,
      );
    }
  }

  return { cost: Math.round(totalEngCost), notes };
}

// ════════════════════════════════════════════════════════════════════════════════
// §3 — STRATEGY COST
// ════════════════════════════════════════════════════════════════════════════════

function computeStrategyCost(
  rec: RecommendationV2,
  durationMonths: number,
  sizeMultiplier: number,
): { cost: number; notes: string[] } {
  const notes: string[] = [];

  // Strategy days scale with project duration and company size
  // Phase 1 is typically strategy-heavy
  const phase1 = rec.execution_plan.phases[0];
  const strategyDays = phase1
    ? Math.round(phase1.duration_days * 0.4) // 40% of first phase is strategy
    : Math.round(durationMonths * 5);        // fallback: ~5 strategy days per month

  const adjustedRate = CONSULTANT_DAILY_RATE * Math.max(0.8, Math.min(1.5, sizeMultiplier / 10000));
  const cost = Math.round(strategyDays * adjustedRate);
  notes.push(`Strategy: ${strategyDays} days × $${Math.round(adjustedRate)}/day = $${cost}`);

  return { cost, notes };
}

// ════════════════════════════════════════════════════════════════════════════════
// §4 — TOOLING COST
// ════════════════════════════════════════════════════════════════════════════════

function computeToolingCost(
  rec: RecommendationV2,
  durationMonths: number,
): { cost: number; notes: string[] } {
  const notes: string[] = [];

  // Estimate tool count from impact types
  const impactTypes = rec.impact_profile.impact_type;
  const needsAITool = impactTypes.includes('efficiency') || impactTypes.includes('revenue_growth');
  const needsAnalyticsTool = impactTypes.includes('cost_reduction') || impactTypes.includes('risk_reduction');

  let toolCount = 0;
  if (needsAITool) toolCount++;
  if (needsAnalyticsTool) toolCount++;

  // Check if "existing tools" or "client owns" signals exist
  const hasExistingTool = rec.assumptions_used.some(a =>
    a.toLowerCase().includes('existing') || a.toLowerCase().includes('current tool'),
  );

  if (hasExistingTool && toolCount > 0) {
    toolCount = Math.max(0, toolCount - 1);
    notes.push('Tooling: 1 tool assumed client-owned (cost = $0 for that tool)');
  }

  const cost = Math.round(toolCount * DEFAULT_MONTHLY_TOOL_COST * durationMonths);
  if (toolCount > 0) {
    notes.push(`Tooling: ${toolCount} tool(s) × $${DEFAULT_MONTHLY_TOOL_COST}/mo × ${durationMonths.toFixed(1)}mo = $${cost}`);
  } else {
    notes.push('Tooling: $0 (no additional tools required or client-owned)');
  }

  return { cost, notes };
}

// ════════════════════════════════════════════════════════════════════════════════
// §5 — CHANGE MANAGEMENT COST
// ════════════════════════════════════════════════════════════════════════════════

function computeChangeMgmtCost(
  rec: RecommendationV2,
  laborCost: number,
): { cost: number; notes: string[] } {
  const notes: string[] = [];

  // Estimate training hours from change complexity + org readiness
  const complexity = rec.feasibility?.change_complexity ?? 5;
  const orgReadiness = rec.feasibility?.organizational_readiness ?? 5;

  // Higher complexity + lower readiness = more training
  const trainingHours = Math.round(
    (complexity * 2) + ((10 - orgReadiness) * 1.5) + 8, // base 8 hours minimum
  );

  const blendedRate = laborCost > 0 ? laborCost : 40; // default $40/hr
  const cost = Math.round(trainingHours * blendedRate);
  notes.push(
    `Change Management: ${trainingHours} training hrs × $${blendedRate}/hr = $${cost} (complexity=${complexity}, org_readiness=${orgReadiness})`,
  );

  return { cost, notes };
}

// ════════════════════════════════════════════════════════════════════════════════
// §6 — CONTINGENCY
// ════════════════════════════════════════════════════════════════════════════════

function computeContingency(
  subtotal: number,
  rec: RecommendationV2,
): { cost: number; percent: number; notes: string[] } {
  const notes: string[] = [];

  // Scale contingency based on risk profile
  const highRiskCount = rec.risk_profile.filter(r => r.probability === 'high' || r.impact === 'high').length;
  let pct = DEFAULT_CONTINGENCY_PERCENT;

  if (highRiskCount >= 2) {
    pct = MAX_CONTINGENCY_PERCENT;
    notes.push(`Contingency: ${pct}% (elevated — ${highRiskCount} high-risk factors)`);
  } else if (highRiskCount === 1) {
    pct = 17;
    notes.push(`Contingency: ${pct}% (moderate — 1 high-risk factor)`);
  } else {
    notes.push(`Contingency: ${pct}% (standard)`);
  }

  pct = Math.max(MIN_CONTINGENCY_PERCENT, Math.min(MAX_CONTINGENCY_PERCENT, pct));
  const cost = Math.round(subtotal * pct / 100);
  notes.push(`Contingency amount: $${cost} (${pct}% of $${subtotal} subtotal)`);

  return { cost, percent: pct, notes };
}

// ════════════════════════════════════════════════════════════════════════════════
// §8 — INVESTMENT RANGE
// ════════════════════════════════════════════════════════════════════════════════

function computeInvestmentRange(
  midTotal: number,
  rec: RecommendationV2,
): InvestmentEstimate {
  // Uncertainty factor from evidence strength
  const evidenceScore = rec.evidence_strength?.computed_evidence ?? 5;
  const uncertaintyFactor = evidenceScore > 7 ? 0.1 : evidenceScore > 4 ? 0.2 : 0.3;

  return {
    low: Math.round(midTotal * (1 - uncertaintyFactor)),
    mid: Math.round(midTotal),
    high: Math.round(midTotal * (1 + uncertaintyFactor * 1.5)),
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT: computeCostModel
// ════════════════════════════════════════════════════════════════════════════════

export function computeCostModel(
  rec: RecommendationV2,
  sizeMultiplier: number,
  laborCost: number,
  assumptions?: PortfolioAssumptions,
): CostModel {
  const durationDays = rec.execution_plan.total_duration_days;
  const durationMonths = Math.max(0.5, durationDays / 30);
  const effectiveLaborCost = assumptions?.labor_cost_per_hour ?? laborCost;
  const notes: string[] = [];

  notes.push(`Duration: ${durationDays} days (${durationMonths.toFixed(1)} months)`);

  // §2 — Engineering
  const eng = computeEngineeringCost(rec, durationMonths, effectiveLaborCost);

  // §3 — Strategy
  const strat = computeStrategyCost(rec, durationMonths, sizeMultiplier);

  // §4 — Tooling
  const tool = computeToolingCost(rec, durationMonths);

  // §5 — Change Management
  const cm = computeChangeMgmtCost(rec, effectiveLaborCost);

  // §7 — Subtotal
  const subtotal = eng.cost + strat.cost + tool.cost + cm.cost;

  // §6 — Contingency (never zero)
  const cont = computeContingency(subtotal, rec);
  const total = subtotal + cont.cost;

  const breakdown: CostBreakdown = {
    engineering: eng.cost,
    strategy: strat.cost,
    tooling: tool.cost,
    change_management: cm.cost,
    contingency: cont.cost,
    subtotal,
    total,
  };

  // §8 — Investment range
  const investmentEstimate = computeInvestmentRange(total, rec);

  // §9 — Duration alignment check
  // Sprint template has a base duration; compare against rec's execution_plan
  const dept = rec.core_problem.problem_id as DepartmentKey;
  const primaryDomain = DEPARTMENT_TO_PRIMARY_DOMAIN[dept] || 'operations';
  const sprintId = (DOMAIN_TO_SPRINT as any)[primaryDomain] || 'automation-sprint';
  const template = getSprintTemplate(sprintId);
  const templateDurationDays = template.phases.reduce((sum, p) => {
    const daysMatch = p.durationLabel.match(/(\d+)/);
    return sum + (daysMatch ? parseInt(daysMatch[1]) * 7 : 30); // parse "X weeks" or default 30 days
  }, 0);

  const durationMismatch = Math.abs(durationDays - templateDurationDays) > templateDurationDays * 0.5;

  notes.push(...eng.notes, ...strat.notes, ...tool.notes, ...cm.notes, ...cont.notes);
  if (durationMismatch) {
    notes.push(`§9 WARNING: Duration mismatch — execution_plan (${durationDays}d) vs template estimate (${templateDurationDays}d)`);
  }

  return {
    investment_estimate: investmentEstimate,
    cost_breakdown: breakdown,
    duration_months: parseFloat(durationMonths.toFixed(1)),
    contingency_percent: cont.percent,
    exceeds_portfolio_cap: false, // computed later in validatePortfolioGovernance
    duration_mismatch: durationMismatch,
    derivation_notes: notes,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// §9 — PORTFOLIO GOVERNANCE VALIDATION
// ════════════════════════════════════════════════════════════════════════════════
// Must run after all cost models are computed, to check 40% cap.

export function validatePortfolioGovernance(
  costModels: { recommendation_id: string; cost_model: CostModel }[],
): { violations: string[]; adjusted: typeof costModels } {
  const totalBudget = costModels.reduce((s, cm) => s + cm.cost_model.investment_estimate.mid, 0);
  const violations: string[] = [];

  for (const cm of costModels) {
    const pct = totalBudget > 0
      ? (cm.cost_model.investment_estimate.mid / totalBudget) * 100
      : 0;

    if (pct > PORTFOLIO_CAP_PERCENT) {
      cm.cost_model.exceeds_portfolio_cap = true;
      violations.push(
        `§9: ${cm.recommendation_id} exceeds ${PORTFOLIO_CAP_PERCENT}% portfolio cap (${pct.toFixed(1)}% of $${Math.round(totalBudget)})`,
      );
      cm.cost_model.derivation_notes.push(
        `§9 GOVERNANCE: Exceeds ${PORTFOLIO_CAP_PERCENT}% portfolio cap (${pct.toFixed(1)}%)`,
      );
    }

    if (cm.cost_model.duration_mismatch) {
      violations.push(
        `§9: ${cm.recommendation_id} has duration mismatch between execution_plan and template`,
      );
    }
  }

  return { violations, adjusted: costModels };
}
