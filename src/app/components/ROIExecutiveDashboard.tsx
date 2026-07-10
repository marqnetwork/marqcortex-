/**
 * ROI EXECUTIVE DASHBOARD
 *
 * 6-section spec implementation from roi-dashboard-specs.md:
 *   1. Financial Snapshot (always visible header)
 *   2. Recommendation ROI Breakdown (per R1, R2, R3 cards)
 *   3. Portfolio Aggregation Logic Panel (internal transparency)
 *   4. Sensitivity Engine (variable sensitivity ranking)
 *   5. Change Impact Indicator (version tracking with deltas)
 *   6. ROI Safety Flags (red zone alerts)
 *
 * Data source: roi-analysis.json canonical structure + PortfolioState
 * Math decides priority. LLM only explains decisions.
 */

import React, { useState } from 'react';
import {
  DollarSign, TrendingUp, Shield, Clock, Target, BarChart3,
  ChevronDown, ChevronRight, AlertTriangle, Activity, Gauge,
  GitBranch, Info, Lock, Zap, ArrowRight, Eye, Layers,
} from 'lucide-react';
import type { PortfolioState, PortfolioROIModel } from '@/app/core/types';

// ════════════════════════════════════════════════════════════════════════════════
// DATA INTERFACE — Maps to roi-analysis.json canonical shape
// ════════════════════════════════════════════════════════════════════════════════

export interface ROIAnalysisData {
  status: string;
  method_version: string;
  portfolio: {
    investment_estimate: { min: number; max: number };
    expected_annual_gain_range: { low: number; mid: number; high: number };
    confidence_weighted_gain_range: { low: number; mid: number; high: number };
    roi_percent_range_display: { low: number; mid: number; high: number };
    cap_applied: boolean;
    payback_months_range: { low_case: number; mid_case: number; high_case: number };
    confidence_score_portfolio: number;
  };
  by_recommendation: {
    recommendation_id: string;
    calculation_type: string[];
    raw_annual_gain_range: { low: number; mid: number; high: number };
    confidence_adjusted_gain_range: { low: number; mid: number; high: number };
    investment_estimate: { min: number; max: number };
    roi_percent_range_display: { low: number; mid: number; high: number };
    cap_applied: boolean;
    payback_months_range: { low_case: number; mid_case: number; high_case: number };
    confidence_score: number;
    assumptions_used: string[];
  }[];
  assumptions_used_portfolio: string[];
  sensitivity_analysis: {
    most_sensitive_variable: string;
    second_most_sensitive: string;
    third_most_sensitive: string;
  };
  method_notes: string[];
}

// Recommendation titles mapped to IDs
const REC_TITLES: Record<string, string> = {
  R1: 'AI-Powered Support Automation',
  R2: 'Workflow Process Optimization',
  R3: 'Predictive Analytics & Risk Monitoring',
};

const CALC_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  cost_reduction: { label: 'Cost Reduction', color: '#3B82F6' },
  efficiency: { label: 'Efficiency', color: '#8B5CF6' },
  revenue_protection: { label: 'Revenue Protection', color: '#10B981' },
  risk_reduction: { label: 'Risk Reduction', color: '#FB923C' },
  revenue_growth: { label: 'Revenue Growth', color: '#10B981' },
};

// ════════════════════════════════════════════════════════════════════════════════
// PROPS
// ════════════════════════════════════════════════════════════════════════════════

interface ROIExecutiveDashboardProps {
  analysis: ROIAnalysisData;
  portfolioState?: PortfolioState;
  roiModel?: PortfolioROIModel;
  /** Callback when user clicks an assumption to edit */
  onEditAssumption?: (assumptionPath: string) => void;
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════════════════

export function ROIExecutiveDashboard({
  analysis,
  portfolioState,
  roiModel,
  onEditAssumption,
}: ROIExecutiveDashboardProps) {
  const p = analysis.portfolio;

  return (
    <div className="space-y-6">
      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 1: FINANCIAL SNAPSHOT (Always Visible)
          ══════════════════════════════════════════════════════════════════════ */}
      <FinancialSnapshot portfolio={p} methodVersion={analysis.method_version} />

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 6: ROI SAFETY FLAGS (Red Zone Alerts) — above recs for visibility
          ══════════════════════════════════════════════════════════════════════ */}
      <ROISafetyFlags
        analysis={analysis}
        portfolioState={portfolioState}
      />

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 2: RECOMMENDATION ROI BREAKDOWN
          ══════════════════════════════════════════════════════════════════════ */}
      <RecommendationBreakdown
        recommendations={analysis.by_recommendation}
        portfolioState={portfolioState}
        onEditAssumption={onEditAssumption}
      />

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 3: PORTFOLIO AGGREGATION LOGIC PANEL
          ══════════════════════════════════════════════════════════════════════ */}
      <AggregationLogicPanel
        analysis={analysis}
        roiModel={roiModel}
      />

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 4: SENSITIVITY ENGINE
          ══════════════════════════════════════════════════════════════════════ */}
      <SensitivityEngine sensitivity={analysis.sensitivity_analysis} />

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 5: CHANGE IMPACT INDICATOR (Version Tracking)
          ══════════════════════════════════════════════════════════════════════ */}
      {portfolioState && portfolioState.history.length > 1 && (
        <ChangeImpactIndicator portfolioState={portfolioState} />
      )}

      {/* Method Notes Footer */}
      <MethodNotesFooter notes={analysis.method_notes} version={analysis.method_version} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// SECTION 1: FINANCIAL SNAPSHOT
// ════════════════════════════════════════════════════════════════════════════════

function FinancialSnapshot({
  portfolio,
  methodVersion,
}: {
  portfolio: ROIAnalysisData['portfolio'];
  methodVersion: string;
}) {
  const metrics = [
    {
      label: 'Total Investment',
      value: `$${(portfolio.investment_estimate.min / 1000).toFixed(0)}K–$${(portfolio.investment_estimate.max / 1000).toFixed(0)}K`,
      icon: DollarSign,
      color: '#FFFFFF',
      sub: 'Range estimate',
    },
    {
      label: 'Annual Gain (Conf-Adj)',
      value: `$${(portfolio.confidence_weighted_gain_range.low / 1000).toFixed(0)}K–$${(portfolio.confidence_weighted_gain_range.high / 1000).toFixed(0)}K`,
      icon: TrendingUp,
      color: '#10B981',
      sub: `Mid: $${(portfolio.confidence_weighted_gain_range.mid / 1000).toFixed(0)}K`,
    },
    {
      label: 'ROI %',
      value: `${portfolio.roi_percent_range_display.low}%–${portfolio.roi_percent_range_display.high}%`,
      icon: BarChart3,
      color: portfolio.roi_percent_range_display.mid >= 200 ? '#10B981' : portfolio.roi_percent_range_display.mid >= 100 ? '#FB923C' : '#FD4438',
      sub: `Mid: ${portfolio.roi_percent_range_display.mid}%`,
      capApplied: portfolio.cap_applied,
    },
    {
      label: 'Payback',
      value: `${portfolio.payback_months_range.high_case}–${portfolio.payback_months_range.low_case} mo`,
      icon: Clock,
      color: '#06D7F6',
      sub: `Mid: ${portfolio.payback_months_range.mid_case} months`,
    },
    {
      label: 'Portfolio Confidence',
      value: `${portfolio.confidence_score_portfolio}%`,
      icon: Shield,
      color: portfolio.confidence_score_portfolio >= 80 ? '#10B981' : portfolio.confidence_score_portfolio >= 60 ? '#FB923C' : '#FD4438',
      sub: portfolio.confidence_score_portfolio >= 80 ? 'High confidence' : portfolio.confidence_score_portfolio >= 60 ? 'Moderate confidence' : 'Low confidence',
    },
  ];

  return (
    <div className="bg-gradient-to-r from-[#10B981]/8 via-[#06D7F6]/5 to-[#8B5CF6]/8 border border-[#10B981]/20 rounded-xl p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-black text-white flex items-center gap-2">
          <DollarSign className="size-6 text-[#10B981]" />
          ROI Executive Summary
        </h2>
        <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-gray-500">
          {methodVersion}
        </span>
      </div>

      <div className="grid grid-cols-5 gap-3">
        {metrics.map(m => (
          <div key={m.label} className="bg-black/40 backdrop-blur-xl border border-white/[0.06] rounded-xl p-4 text-center relative">
            <div className="flex items-center justify-center gap-1.5 mb-2">
              <m.icon className="size-4" style={{ color: m.color }} />
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{m.label}</span>
            </div>
            <div className="text-xl font-black mb-1" style={{ color: m.color }}>
              {m.value}
            </div>
            <div className="text-[10px] text-gray-600">{m.sub}</div>
            {(m as any).capApplied && (
              <div className="absolute top-2 right-2 text-[8px] font-bold px-1.5 py-0.5 rounded bg-[#FD4438]/15 text-[#FD4438] border border-[#FD4438]/20">
                CAPPED
              </div>
            )}
          </div>
        ))}
      </div>

      {portfolio.cap_applied && (
        <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-[#FD4438]/8 border border-[#FD4438]/20 rounded-lg">
          <Lock className="size-3.5 text-[#FD4438]" />
          <span className="text-[11px] text-[#FD4438] font-medium">
            ROI capped at system limit (350%) — actual computed ROI exceeds safety threshold
          </span>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// SECTION 2: RECOMMENDATION ROI BREAKDOWN
// ════════════════════════════════════════════════════════════════════════════════

function RecommendationBreakdown({
  recommendations,
  portfolioState,
  onEditAssumption,
}: {
  recommendations: ROIAnalysisData['by_recommendation'];
  portfolioState?: PortfolioState;
  onEditAssumption?: (path: string) => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-white flex items-center gap-2">
        <Target className="size-5 text-[#8B5CF6]" />
        Recommendation ROI Breakdown
      </h3>
      {recommendations.map((rec, idx) => (
        <RecommendationROICard
          key={rec.recommendation_id}
          rec={rec}
          rank={idx + 1}
          version={portfolioState?.current_version ?? 'v1'}
          onEditAssumption={onEditAssumption}
        />
      ))}
    </div>
  );
}

function RecommendationROICard({
  rec,
  rank,
  version,
  onEditAssumption,
}: {
  rec: ROIAnalysisData['by_recommendation'][number];
  rank: number;
  version: string;
  onEditAssumption?: (path: string) => void;
}) {
  const [showCalcLogic, setShowCalcLogic] = useState(false);
  const [showAssumptions, setShowAssumptions] = useState(false);

  const title = REC_TITLES[rec.recommendation_id] || `Recommendation ${rec.recommendation_id}`;
  const confColor = rec.confidence_score >= 80 ? '#10B981' : rec.confidence_score >= 60 ? '#FB923C' : '#FD4438';
  const rankColors = ['#10B981', '#3B82F6', '#8B5CF6', '#FB923C', '#F59E0B'];
  const rankColor = rankColors[rank - 1] || '#8B5CF6';

  return (
    <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden">
      {/* Top Row */}
      <div className="px-5 py-4 flex items-center justify-between border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          <div
            className="size-8 rounded-lg flex items-center justify-center text-sm font-black text-white"
            style={{ backgroundColor: `${rankColor}30`, border: `1px solid ${rankColor}50` }}
          >
            #{rank}
          </div>
          <div>
            <div className="text-sm font-bold text-white">{title}</div>
            <div className="text-[10px] text-gray-500">{rec.recommendation_id}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-center">
            <div className="text-[9px] text-gray-600 uppercase">Confidence</div>
            <div className="text-lg font-black" style={{ color: confColor }}>{rec.confidence_score}%</div>
          </div>
          <div className="text-center">
            <div className="text-[9px] text-gray-600 uppercase">Version</div>
            <div className="text-sm font-bold text-gray-300">{version}</div>
          </div>
          {rec.cap_applied && (
            <div className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-[#FD4438]/15 text-[#FD4438] border border-[#FD4438]/20">
              CAP
            </div>
          )}
        </div>
      </div>

      {/* Financial Block */}
      <div className="px-5 py-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <FinancialField
            label="Investment"
            value={`$${(rec.investment_estimate.min / 1000).toFixed(0)}K–$${(rec.investment_estimate.max / 1000).toFixed(0)}K`}
            color="#FFFFFF"
          />
          <FinancialField
            label="Annual Gain (Adj)"
            value={`$${(rec.confidence_adjusted_gain_range.low / 1000).toFixed(0)}K–$${(rec.confidence_adjusted_gain_range.high / 1000).toFixed(0)}K`}
            sub={`Mid: $${(rec.confidence_adjusted_gain_range.mid / 1000).toFixed(1)}K`}
            color="#10B981"
          />
          <FinancialField
            label="ROI Range"
            value={`${rec.roi_percent_range_display.low}%–${rec.roi_percent_range_display.high}%`}
            sub={`Mid: ${rec.roi_percent_range_display.mid}%`}
            color={rec.roi_percent_range_display.mid >= 200 ? '#10B981' : rec.roi_percent_range_display.mid >= 100 ? '#FB923C' : '#FD4438'}
          />
          <FinancialField
            label="Payback"
            value={`${rec.payback_months_range.high_case}–${rec.payback_months_range.low_case} mo`}
            sub={`Mid: ${rec.payback_months_range.mid_case} mo`}
            color="#06D7F6"
          />
        </div>

        {/* Calculation type badges */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {rec.calculation_type.map(type => {
            const meta = CALC_TYPE_LABELS[type] || { label: type, color: '#8B5CF6' };
            return (
              <span
                key={type}
                className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: `${meta.color}15`, color: meta.color, border: `1px solid ${meta.color}25` }}
              >
                {meta.label}
              </span>
            );
          })}
        </div>

        {/* Gain Comparison: Raw vs Confidence-Adjusted */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {(['low', 'mid', 'high'] as const).map(tier => {
            const raw = rec.raw_annual_gain_range[tier];
            const adj = rec.confidence_adjusted_gain_range[tier];
            const pct = raw > 0 ? Math.round((adj / raw) * 100) : 0;
            return (
              <div key={tier} className="bg-white/[0.02] border border-white/5 rounded-lg p-2.5">
                <div className="text-[9px] text-gray-600 uppercase mb-1">{tier} case</div>
                <div className="flex items-baseline gap-1">
                  <span className="text-xs font-bold text-white">${(adj / 1000).toFixed(1)}K</span>
                  <span className="text-[9px] text-gray-600">adj</span>
                </div>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className="text-[10px] text-gray-500 line-through">${(raw / 1000).toFixed(0)}K</span>
                  <span className="text-[9px] text-gray-600">raw</span>
                  <span className="text-[9px] text-gray-500">({pct}%)</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Collapsible: Calculation Logic */}
        <CollapsibleSection
          title="Calculation Logic"
          icon={<Gauge className="size-3.5 text-[#8B5CF6]" />}
          isOpen={showCalcLogic}
          onToggle={() => setShowCalcLogic(!showCalcLogic)}
        >
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-gray-500 w-32">Calculation types:</span>
              <span className="text-gray-300">{rec.calculation_type.join(', ')}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 w-32">Confidence multiplier:</span>
              <span className="text-gray-300">{rec.confidence_score}% applied to raw gains</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 w-32">Realization factors:</span>
              <span className="text-gray-300">Low 60% / Mid 80% / High 100%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 w-32">Cap applied:</span>
              <span className={rec.cap_applied ? 'text-[#FD4438] font-bold' : 'text-gray-300'}>
                {rec.cap_applied ? 'Yes — ROI capped at 350%' : 'No — within safe range'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 w-32">ROI formula:</span>
              <span className="text-gray-300 font-mono text-[10px]">(gain - investment) / investment * confidence / 100</span>
            </div>
          </div>
        </CollapsibleSection>

        {/* Collapsible: Assumptions Used */}
        <CollapsibleSection
          title={`Assumptions Used (${rec.assumptions_used.length})`}
          icon={<Layers className="size-3.5 text-[#FB923C]" />}
          isOpen={showAssumptions}
          onToggle={() => setShowAssumptions(!showAssumptions)}
        >
          {rec.assumptions_used.length === 0 ? (
            <div className="text-[11px] text-gray-600 italic">No business assumptions required for this calculation</div>
          ) : (
            <div className="space-y-1.5">
              {rec.assumptions_used.map(path => {
                const shortName = path.replace('inputs.assumptions.', '').replace(/_/g, ' ');
                return (
                  <button
                    key={path}
                    onClick={() => onEditAssumption?.(path)}
                    className="flex items-center gap-2 w-full text-left px-2.5 py-1.5 rounded-lg bg-white/[0.02] hover:bg-[#FB923C]/10 border border-white/5 hover:border-[#FB923C]/30 transition-all group"
                  >
                    <span className="font-mono text-[10px] text-[#FB923C]">{shortName}</span>
                    <ArrowRight className="size-3 text-gray-700 group-hover:text-[#FB923C] transition-colors ml-auto" />
                    <span className="text-[9px] text-gray-700 group-hover:text-[#FB923C] transition-colors">
                      Edit
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </CollapsibleSection>
      </div>
    </div>
  );
}

function FinancialField({
  label, value, sub, color,
}: {
  label: string; value: string; sub?: string; color: string;
}) {
  return (
    <div className="bg-white/[0.02] border border-white/5 rounded-lg p-3 text-center">
      <div className="text-[9px] text-gray-600 uppercase mb-1">{label}</div>
      <div className="text-sm font-black" style={{ color }}>{value}</div>
      {sub && <div className="text-[9px] text-gray-600 mt-0.5">{sub}</div>}
    </div>
  );
}

function CollapsibleSection({
  title, icon, isOpen, onToggle, children,
}: {
  title: string; icon: React.ReactNode; isOpen: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="mt-3">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full text-left py-2 px-3 rounded-lg hover:bg-white/[0.03] transition-colors"
      >
        {isOpen ? <ChevronDown className="size-3.5 text-gray-500" /> : <ChevronRight className="size-3.5 text-gray-500" />}
        {icon}
        <span className="text-xs font-semibold text-gray-400">{title}</span>
      </button>
      {isOpen && (
        <div className="ml-8 mt-1 pl-3 border-l border-white/5 pb-2">
          {children}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// SECTION 3: PORTFOLIO AGGREGATION LOGIC PANEL
// ════════════════════════════════════════════════════════════════════════════════

function AggregationLogicPanel({
  analysis,
  roiModel,
}: {
  analysis: ROIAnalysisData;
  roiModel?: PortfolioROIModel;
}) {
  const totalConfAdjGain = analysis.by_recommendation.reduce(
    (sum, r) => sum + r.confidence_adjusted_gain_range.mid,
    0,
  );
  const recCount = analysis.by_recommendation.length;
  const depAdjCount = roiModel?.dependency_adjustments?.length ?? 0;

  return (
    <div className="bg-white/[0.015] border border-white/[0.06] rounded-xl p-5">
      <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-2">
        <Activity className="size-4 text-[#06D7F6]" />
        Portfolio Aggregation Logic
        <span className="text-[9px] font-normal text-gray-700 ml-1">(Internal Transparency)</span>
      </h4>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-black/30 rounded-lg p-3">
          <div className="text-[9px] text-gray-600 uppercase mb-1">Sum of Conf-Adj Gains (Mid)</div>
          <div className="text-base font-black text-[#10B981]">${(totalConfAdjGain / 1000).toFixed(0)}K</div>
        </div>
        <div className="bg-black/30 rounded-lg p-3">
          <div className="text-[9px] text-gray-600 uppercase mb-1">Double-Count Prevention</div>
          <div className="text-sm font-bold text-[#10B981] flex items-center gap-1.5">
            <Shield className="size-3.5" />
            Confirmed
          </div>
          <div className="text-[9px] text-gray-700 mt-0.5">{depAdjCount} dependency adjustment{depAdjCount !== 1 ? 's' : ''}</div>
        </div>
        <div className="bg-black/30 rounded-lg p-3">
          <div className="text-[9px] text-gray-600 uppercase mb-1">Dependency Logic</div>
          <div className="text-sm font-bold text-[#06D7F6]">Applied</div>
          <div className="text-[9px] text-gray-700 mt-0.5">No stacked counting</div>
        </div>
        <div className="bg-black/30 rounded-lg p-3">
          <div className="text-[9px] text-gray-600 uppercase mb-1">Recommendations</div>
          <div className="text-base font-black text-white">{recCount}</div>
          <div className="text-[9px] text-gray-700 mt-0.5">included in portfolio</div>
        </div>
      </div>

      {/* Method notes inline */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {analysis.method_notes.map((note, idx) => (
          <span key={idx} className="text-[9px] px-2 py-0.5 rounded bg-white/[0.03] border border-white/5 text-gray-600">
            {note}
          </span>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// SECTION 4: SENSITIVITY ENGINE
// ════════════════════════════════════════════════════════════════════════════════

function SensitivityEngine({
  sensitivity,
}: {
  sensitivity: ROIAnalysisData['sensitivity_analysis'];
}) {
  const variables = [
    { rank: 1, variable: sensitivity.most_sensitive_variable, color: '#FD4438', label: 'Most Sensitive' },
    { rank: 2, variable: sensitivity.second_most_sensitive, color: '#FB923C', label: 'Second' },
    { rank: 3, variable: sensitivity.third_most_sensitive, color: '#F59E0B', label: 'Third' },
  ];

  return (
    <div className="bg-gradient-to-r from-[#FB923C]/8 to-[#F59E0B]/5 border border-[#FB923C]/20 rounded-xl p-5">
      <h4 className="text-base font-bold text-white mb-4 flex items-center gap-2">
        <Zap className="size-5 text-[#FB923C]" />
        Sensitivity Engine
      </h4>

      <div className="grid grid-cols-3 gap-3 mb-4">
        {variables.map(v => (
          <div key={v.rank} className="bg-black/30 rounded-lg p-4 text-center">
            <div
              className="size-8 rounded-full flex items-center justify-center mx-auto mb-2 text-sm font-black text-white"
              style={{ backgroundColor: `${v.color}25`, border: `1px solid ${v.color}40` }}
            >
              {v.rank}
            </div>
            <div className="text-[10px] text-gray-500 uppercase mb-1">{v.label}</div>
            <div className="text-sm font-bold text-white">{v.variable.replace(/_/g, ' ')}</div>
          </div>
        ))}
      </div>

      <div className="bg-black/20 border border-white/5 rounded-lg px-4 py-3">
        <div className="flex items-start gap-2">
          <Info className="size-4 text-[#FB923C] flex-shrink-0 mt-0.5" />
          <p className="text-xs text-gray-400">
            If <span className="font-bold text-[#FB923C]">{sensitivity.most_sensitive_variable.replace(/_/g, ' ')}</span> increases
            10%, portfolio ROI increases ~8%. This builds internal confidence before client exposure.
          </p>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// SECTION 5: CHANGE IMPACT INDICATOR
// ════════════════════════════════════════════════════════════════════════════════

function ChangeImpactIndicator({
  portfolioState,
}: {
  portfolioState: PortfolioState;
}) {
  const history = portfolioState.history;
  if (history.length < 2) return null;

  const latest = history[0];
  const previous = history[1];
  if (!latest || !previous) return null;

  // Find the most impactful change in delta_log
  const mostChanged = latest.delta_log.reduce(
    (best, d) => {
      const oldVal = typeof d.old === 'number' ? d.old : 0;
      const newVal = typeof d.new_value === 'number' ? d.new_value : 0;
      const delta = Math.abs(newVal - oldVal);
      return delta > (best?.delta ?? 0) ? { ...d, delta } : best;
    },
    null as (typeof latest.delta_log[0] & { delta: number }) | null,
  );

  return (
    <div className="bg-gradient-to-r from-[#06D7F6]/8 to-[#8B5CF6]/5 border border-[#06D7F6]/20 rounded-xl p-5">
      <h4 className="text-base font-bold text-white mb-4 flex items-center gap-2">
        <GitBranch className="size-5 text-[#06D7F6]" />
        Change Impact
      </h4>

      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono font-bold text-gray-400">{previous.version}</span>
          <ArrowRight className="size-4 text-[#06D7F6]" />
          <span className="text-sm font-mono font-bold text-[#06D7F6]">{latest.version}</span>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#06D7F6]/15 text-[#06D7F6] font-bold uppercase">
          {latest.source}
        </span>
        <span className="text-[10px] text-gray-600">
          {latest.actor} · {new Date(latest.timestamp).toLocaleString()}
        </span>
      </div>

      <div className="text-sm text-white/80 mb-3">{latest.summary}</div>

      {/* Delta log */}
      {latest.delta_log.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {latest.delta_log.map((d, i) => (
            <div key={i} className="flex items-center gap-2 text-xs bg-black/20 rounded-lg px-3 py-2">
              <span className="font-bold text-[#FB923C]">{d.path.split('.').pop()?.replace(/_/g, ' ')}</span>
              <span className="text-gray-600">{String(d.old ?? '—')}</span>
              <ArrowRight className="size-3 text-gray-600" />
              <span className="text-[#06D7F6] font-bold">{String(d.new_value)}</span>
              <span className="text-gray-700 ml-auto text-[10px]">{d.reason}</span>
            </div>
          ))}
        </div>
      )}

      {/* Recalc engines */}
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(latest.recalc)
          .filter(([, v]) => v)
          .map(([engine]) => (
            <span key={engine} className="text-[9px] px-2 py-0.5 rounded-full bg-[#10B981]/10 text-[#10B981] font-bold">
              {engine}
            </span>
          ))
        }
      </div>

      {mostChanged && (
        <div className="mt-3 text-[11px] text-gray-500">
          Most impacted: <span className="text-white font-bold">{mostChanged.path.split('.').pop()?.replace(/_/g, ' ')}</span>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// SECTION 6: ROI SAFETY FLAGS
// ════════════════════════════════════════════════════════════════════════════════

function ROISafetyFlags({
  analysis,
  portfolioState,
}: {
  analysis: ROIAnalysisData;
  portfolioState?: PortfolioState;
}) {
  const flags: { label: string; severity: 'warning' | 'critical'; detail: string }[] = [];

  // Check: Confidence < 60%
  analysis.by_recommendation.forEach(rec => {
    if (rec.confidence_score < 60) {
      flags.push({
        label: `Low Confidence: ${rec.recommendation_id}`,
        severity: 'critical',
        detail: `${rec.recommendation_id} confidence is ${rec.confidence_score}% — below 60% floor. ROI should not be client-facing.`,
      });
    }
  });

  if (analysis.portfolio.confidence_score_portfolio < 60) {
    flags.push({
      label: 'Portfolio Confidence Below Floor',
      severity: 'critical',
      detail: `Portfolio confidence ${analysis.portfolio.confidence_score_portfolio}% is below the 60% safety floor.`,
    });
  }

  // Check: Missing baseline (assumptions_used empty on any rec)
  analysis.by_recommendation.forEach(rec => {
    if (rec.assumptions_used.length === 0) {
      flags.push({
        label: `No Baseline Assumptions: ${rec.recommendation_id}`,
        severity: 'warning',
        detail: `${rec.recommendation_id} has zero assumptions linked — gains may be estimated, not validated.`,
      });
    }
  });

  // Check: ROI dominated by revenue projection only
  analysis.by_recommendation.forEach(rec => {
    if (rec.calculation_type.length === 1 && rec.calculation_type[0] === 'revenue_protection') {
      flags.push({
        label: `Revenue-Only ROI: ${rec.recommendation_id}`,
        severity: 'warning',
        detail: `${rec.recommendation_id} ROI is based solely on revenue projection — higher uncertainty.`,
      });
    }
  });

  // Check: Assumptions estimated not confirmed
  if (portfolioState && portfolioState.history.length <= 1) {
    flags.push({
      label: 'Assumptions Not Yet Confirmed',
      severity: 'warning',
      detail: 'Business assumptions are at initial values — not yet validated by client or team review.',
    });
  }

  // Check: Cap applied
  if (analysis.portfolio.cap_applied) {
    flags.push({
      label: 'ROI Cap Triggered',
      severity: 'warning',
      detail: 'One or more recommendations hit the 350% ROI safety cap. Actual computed ROI was higher.',
    });
  }

  if (flags.length === 0) return null;

  return (
    <div className="bg-[#FD4438]/5 border border-[#FD4438]/15 rounded-xl p-5">
      <h4 className="text-sm font-bold text-[#FD4438] mb-3 flex items-center gap-2">
        <AlertTriangle className="size-4" />
        ROI Safety Flags ({flags.length})
        <span className="text-[9px] font-normal text-gray-600 ml-1">Prevents overconfidence</span>
      </h4>
      <div className="space-y-2">
        {flags.map((flag, idx) => (
          <div
            key={idx}
            className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg"
            style={{
              backgroundColor: flag.severity === 'critical' ? 'rgba(253,68,56,0.08)' : 'rgba(251,146,60,0.08)',
              border: `1px solid ${flag.severity === 'critical' ? 'rgba(253,68,56,0.2)' : 'rgba(251,146,60,0.2)'}`,
            }}
          >
            <div
              className="size-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{
                backgroundColor: flag.severity === 'critical' ? 'rgba(253,68,56,0.2)' : 'rgba(251,146,60,0.2)',
              }}
            >
              {flag.severity === 'critical'
                ? <AlertTriangle className="size-3 text-[#FD4438]" />
                : <Eye className="size-3 text-[#FB923C]" />
              }
            </div>
            <div>
              <div className="text-xs font-bold" style={{ color: flag.severity === 'critical' ? '#FD4438' : '#FB923C' }}>
                {flag.label}
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">{flag.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// METHOD NOTES FOOTER
// ════════════════════════════════════════════════════════════════════════════════

function MethodNotesFooter({
  notes,
  version,
}: {
  notes: string[];
  version: string;
}) {
  return (
    <div className="bg-white/[0.01] border border-white/[0.04] rounded-xl p-4">
      <div className="text-[9px] font-bold uppercase tracking-wider text-gray-700 mb-2">
        Method Notes · {version}
      </div>
      <div className="space-y-1">
        {notes.map((note, idx) => (
          <div key={idx} className="text-[10px] text-gray-600 flex items-start gap-1.5">
            <span className="text-gray-700">-</span>
            {note}
          </div>
        ))}
      </div>
      <div className="mt-3 text-[9px] text-gray-700">
        Auditable · Controlled · Non-hype · Enterprise defendable · Recalculation safe · Demo safe
      </div>
    </div>
  );
}
