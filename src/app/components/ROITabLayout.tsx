/**
 * ROI TAB LAYOUT — roi-wireframe.md canonical implementation
 *
 * 7 sections, in order:
 *   1️⃣  Executive Control Header  — always visible
 *   2️⃣  Cash Flow Timeline Panel  — collapsible, default collapsed
 *   3️⃣  Monte Carlo Panel         — collapsible, default collapsed
 *   4️⃣  Rec ROI Breakdown Cards   — collapsible, default collapsed
 *   5️⃣  Financial Assumptions     — collapsible, default collapsed
 *   6️⃣  Sensitivity Analysis      — collapsible, default collapsed
 *   7️⃣  Audit & Version Log       — collapsible, default collapsed
 *
 * UX Rules (from spec):
 *   - Nothing auto-expands except Executive Header.
 *   - Advanced finance sections collapsed by default.
 *   - Scenario switch never changes baseline assumptions.
 *   - Editing assumptions always creates new version.
 *   - Monte Carlo never runs silently.
 */

import React, { useState, useCallback } from 'react';
import {
  LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip,
  ReferenceLine, ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts';
import {
  DollarSign, TrendingUp, TrendingDown, Clock, Shield, Target,
  ChevronDown, ChevronRight, AlertTriangle, Activity, Zap, BarChart3,
  GitBranch, Info, Lock, ArrowRight, CheckCircle2, RotateCcw, Eye,
  Layers, BookOpen, ListTree, Cpu,
} from 'lucide-react';
import type {
  PortfolioROIModel, PortfolioState, RecalcResult, ScenarioKey,
  RecommendationROI, VersionRecord, MonteCarloModel, IRRModel,
  DCFModel, PortfolioCashflow,
} from '@/app/core/types';
import { applyChangeRequest } from '@/app/core/versionEngine';
import { MonteCarloPanel } from '@/app/components/MonteCarloPanel';
import { ROIAssumptionsEditor } from '@/app/components/ROIAssumptionsEditor';
import type { ROIAnalysisData } from '@/app/components/ROIExecutiveDashboard';

// ════════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════════════════════

const DEPT_COLOR: Record<string, string> = {
  revenue_engine:            '#10B981',
  customer_experience:       '#06D7F6',
  operations_supply_chain:   '#FB923C',
  marketing_acquisition:     '#EC4899',
  finance_unit_economics:    '#F59E0B',
  data_infrastructure:       '#3B82F6',
  talent_process:            '#8B5CF6',
};
const deptColor = (d: string) => DEPT_COLOR[d] ?? '#8B5CF6';
const deptLabel = (d: string) => d.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const SCENARIO_CFG: Record<ScenarioKey, { label: string; color: string; bg: string }> = {
  conservative: { label: 'Conservative', color: '#FB923C', bg: 'bg-[#FB923C]/10' },
  expected:     { label: 'Expected',     color: '#06D7F6', bg: 'bg-[#06D7F6]/10' },
  aggressive:   { label: 'Aggressive',   color: '#10B981', bg: 'bg-[#10B981]/10' },
};
const SCENARIOS: ScenarioKey[] = ['conservative', 'expected', 'aggressive'];

// ════════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ════════════════════════════════════════════════════════════════════════════════

const fmt$ = (n: number): string => {
  if (!isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
};
const fmtPct = (n: number, dec = 0) => `${n.toFixed(dec)}%`;

// ════════════════════════════════════════════════════════════════════════════════
// COLLAPSIBLE SECTION SHELL
// ════════════════════════════════════════════════════════════════════════════════

function SectionShell({
  icon: Icon, title, badge, defaultOpen = false, rightSlot, children, accent = '#8B5CF6',
}: {
  icon: React.FC<{ className?: string }>;
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
  accent?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden">
      <button
        className="flex items-center justify-between w-full px-5 py-3.5 hover:bg-white/[0.02] transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <span className="flex items-center gap-2.5 text-sm font-bold text-white">
          <Icon className="size-4 flex-shrink-0" style={{ color: accent }} />
          {title}
          {badge && (
            <span className="text-[9px] px-2 py-0.5 rounded-full font-bold border uppercase tracking-wider"
              style={{ color: accent, borderColor: `${accent}33`, background: `${accent}14` }}>
              {badge}
            </span>
          )}
        </span>
        <span className="flex items-center gap-3">
          {rightSlot}
          {open
            ? <ChevronDown className="size-4 text-gray-500" />
            : <ChevronRight className="size-4 text-gray-500" />}
        </span>
      </button>
      {open && <div className="border-t border-white/5">{children}</div>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// §1 — EXECUTIVE CONTROL HEADER (always visible)
// ════════════════════════════════════════════════════════════════════════════════

function StatPill({
  label, value, sub, color = '#FFFFFF', dim = false,
}: {
  label: string; value: string; sub?: string; color?: string; dim?: boolean;
}) {
  return (
    <div className="bg-black/50 border border-white/8 rounded-xl px-4 py-3 min-w-0">
      <div className="text-[9px] font-bold uppercase tracking-wider text-gray-600 mb-1 truncate">{label}</div>
      <div className="text-xl font-black truncate" style={{ color: dim ? '#6B7280' : color }}>{value}</div>
      {sub && <div className="text-[9px] text-gray-600 mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

interface HeaderProps {
  roi: PortfolioROIModel;
  portfolioState?: PortfolioState;
  onPortfolioUpdate?: (state: PortfolioState, result: RecalcResult) => void;
  activeScenario: ScenarioKey;
}

function ExecHeader({ roi, portfolioState, onPortfolioUpdate, activeScenario }: HeaderProps) {
  const [switching, setSwitching] = useState<ScenarioKey | null>(null);
  const t = roi.portfolio_totals;
  const sm = roi.scenario_model;
  const isCapped = t.total_adjusted_roi_percent >= 350;

  const avgConf = roi.recommendation_rois.length > 0
    ? Math.round(roi.recommendation_rois.filter(r => r.is_roi_eligible)
        .reduce((s, r) => s + r.inputs.confidence_score, 0) /
        Math.max(1, roi.recommendation_rois.filter(r => r.is_roi_eligible).length))
    : 0;

  const handleSwitch = async (s: ScenarioKey) => {
    if (!portfolioState || !onPortfolioUpdate || s === activeScenario || switching) return;
    setSwitching(s);
    try {
      const result = applyChangeRequest(portfolioState, {
        type: 'SwitchScenario',
        changes: [{ path: 'active_scenario', value: s, reason: `Scenario switched to ${s}` }],
      }, 'team_user', 'manual_edit');
      if (result.success) onPortfolioUpdate(result.state, result);
    } finally { setSwitching(null); }
  };

  const currentVersion = portfolioState?.current_version ?? 'v1';

  return (
    <div className="bg-gradient-to-br from-black/60 to-[#0a0a0f]/80 backdrop-blur-xl border border-white/10 rounded-xl p-5 space-y-4">

      {/* Cap badge */}
      {isCapped && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#FD4438]/10 border border-[#FD4438]/20 rounded-lg w-fit">
          <AlertTriangle className="size-3 text-[#FD4438]" />
          <span className="text-[10px] font-bold text-[#FD4438]">ROI capped at system limit ({t.total_adjusted_roi_percent}%)</span>
        </div>
      )}

      {/* 5-column summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatPill label="Total Investment"
          value={t.total_investment_label}
          sub={`${fmt$(t.total_investment)} deployed`} />
        <StatPill label="Annual Gain (Conf.-Weighted)"
          value={fmt$(t.total_adjusted_gain_12mo)}
          sub={`Risk-adj: ${fmt$(t.risk_adjusted_return)}`}
          color="#10B981" />
        <StatPill label="ROI % Range"
          value={`${roi.portfolio_range.low_case_roi}%–${roi.portfolio_range.high_case_roi}%`}
          sub={`${t.total_adjusted_roi_percent}% expected`}
          color={t.total_adjusted_roi_percent >= 100 ? '#10B981' : '#FB923C'} />
        <StatPill label="True Payback"
          value={roi.portfolio_payback_months < 1 ? '<1 mo' : `${roi.portfolio_payback_months} mo`}
          sub={roi.portfolio_cashflow?.true_payback_month ? `Cashflow payback: mo ${roi.portfolio_cashflow.true_payback_month}` : undefined}
          color="#06D7F6" />
        <StatPill label="Portfolio Confidence"
          value={`${avgConf}%`}
          sub={`${roi.recommendation_rois.filter(r => r.is_roi_eligible).length} eligible recs`}
          color="#8B5CF6" />
      </div>

      {/* Bottom bar: scenario toggle + version */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Scenario Toggle */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold text-gray-600 uppercase tracking-wider mr-2">Scenario</span>
          {SCENARIOS.map(s => {
            const cfg = SCENARIO_CFG[s];
            const isActive = s === activeScenario;
            const isLoading = switching === s;
            const scenarioROI = sm?.scenario_outputs[s]?.roi_percent;
            return (
              <button key={s}
                onClick={() => handleSwitch(s)}
                disabled={!portfolioState || !onPortfolioUpdate || !!switching}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${
                  isActive
                    ? `${cfg.bg} border-current`
                    : 'bg-white/[0.03] border-white/8 hover:border-white/15 text-gray-500 hover:text-gray-300'
                }`}
                style={{ color: isActive ? cfg.color : undefined, borderColor: isActive ? `${cfg.color}66` : undefined }}>
                {isLoading ? <Activity className="size-2.5 animate-pulse" /> : null}
                {cfg.label}
                {scenarioROI !== undefined && (
                  <span className="opacity-60">{scenarioROI}%</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Version badge */}
        <div className="flex items-center gap-2 text-[10px] text-gray-500">
          <GitBranch className="size-3" />
          <span className="font-mono font-bold text-gray-400">{currentVersion}</span>
          {portfolioState && portfolioState.history.length > 1 && portfolioState.history[0].roi_recalculated && (
            <span className="px-1.5 py-0.5 rounded bg-[#10B981]/10 text-[#10B981] font-bold">Recalculated</span>
          )}
          {portfolioState?.history[0]?.scenario_switched && (
            <span className="px-1.5 py-0.5 rounded bg-[#8B5CF6]/10 text-[#8B5CF6] font-bold">Scenario: {activeScenario}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// §2 — CASH FLOW TIMELINE PANEL
// ════════════════════════════════════════════════════════════════════════════════

function CashFlowTimelinePanel({ roi }: { roi: PortfolioROIModel }) {
  const [showTable, setShowTable] = useState(false);
  const cf = roi.portfolio_cashflow;
  const dcf = roi.dcf_model && 'npv' in roi.dcf_model ? (roi.dcf_model as DCFModel) : null;
  const irr = roi.irr_model && 'irr_percent_annual' in roi.irr_model ? (roi.irr_model as IRRModel) : null;
  const mc  = roi.monte_carlo && 'results' in roi.monte_carlo ? (roi.monte_carlo as MonteCarloModel) : null;

  if (!cf) return (
    <div className="p-5 text-xs text-gray-600">Cash flow timeline not available — portfolio cashflow not computed.</div>
  );

  const chartData = cf.monthly_projection.map(m => ({
    month: `M${m.month}`,
    Investment: Math.round(m.investment),
    Gain:       Math.round(m.gain),
    Cumulative: Math.round(m.cumulative),
  }));

  const stats: { label: string; value: string; color: string; sub?: string }[] = [
    { label: 'Nominal Payback',      value: cf.true_payback_month ? `Month ${cf.true_payback_month}` : '> 12mo', color: '#06D7F6' },
    { label: 'Discounted Payback',   value: dcf?.discounted_payback_month ? `Month ${dcf.discounted_payback_month}` : dcf ? '> 12mo' : '—', color: '#8B5CF6' },
    { label: 'NPV',                  value: dcf ? fmt$(dcf.npv) : '—', color: dcf && dcf.npv >= 0 ? '#10B981' : '#FD4438', sub: dcf ? `@ ${dcf.discount_rate_percent}% discount` : undefined },
    { label: 'IRR (Annual)',         value: irr ? fmtPct(irr.irr_percent_annual, 1) : '—', color: '#10B981' },
    { label: 'IRR (Monthly)',        value: irr ? fmtPct(irr.irr_percent_monthly, 2) : '—', color: '#10B981' },
    { label: 'MC Median ROI',        value: mc  ? fmtPct(mc.results.roi_percent.median, 1) : '—', color: '#FB923C' },
    { label: 'P(ROI > 0%)',          value: mc  ? fmtPct(mc.results.roi_percent.probability_positive * 100, 1) : '—', color: '#EC4899' },
  ];

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-[#0d0d14] border border-white/10 rounded-lg p-3 text-[10px] space-y-1 shadow-2xl">
        <div className="font-bold text-gray-300 mb-1">{label}</div>
        {payload.map((p: any) => (
          <div key={p.name} className="flex items-center gap-2">
            <span className="size-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
            <span className="text-gray-400">{p.name}:</span>
            <span className="font-bold text-white">{fmt$(p.value)}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="p-5 space-y-5">
      {/* Chart + Stats */}
      <div className="flex flex-col lg:flex-row gap-5">
        {/* Line Chart */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-4 mb-3 flex-wrap">
            {[
              { key: 'Investment', color: '#FD4438' },
              { key: 'Gain',       color: '#10B981' },
              { key: 'Cumulative', color: '#06D7F6' },
            ].map(l => (
              <span key={l.key} className="flex items-center gap-1.5 text-[10px] text-gray-400">
                <span className="inline-block size-2 rounded-full" style={{ background: l.color }} />
                {l.key}
              </span>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#4B5563' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `$${Math.round(v / 1000)}K`} tick={{ fontSize: 9, fill: '#4B5563' }} axisLine={false} tickLine={false} width={48} />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" strokeDasharray="4 2" />
              {cf.true_payback_month && (
                <ReferenceLine x={`M${cf.true_payback_month}`} stroke="#06D7F6" strokeDasharray="4 2" strokeOpacity={0.5} />
              )}
              <Line type="monotone" dataKey="Investment" stroke="#FD4438" strokeWidth={1.5} dot={false} strokeOpacity={0.8} />
              <Line type="monotone" dataKey="Gain"       stroke="#10B981" strokeWidth={1.5} dot={false} strokeOpacity={0.8} />
              <Line type="monotone" dataKey="Cumulative" stroke="#06D7F6" strokeWidth={2}   dot={false} />
            </LineChart>
          </ResponsiveContainer>
          {cf.true_payback_month && (
            <p className="text-[9px] text-gray-600 text-center mt-1">
              Dashed cyan line = cashflow breakeven at Month {cf.true_payback_month}
            </p>
          )}
        </div>

        {/* Stats column */}
        <div className="lg:w-48 xl:w-56 flex-shrink-0 space-y-1.5">
          {stats.map(s => (
            <div key={s.label} className="flex items-center justify-between gap-2 bg-white/[0.02] rounded-lg px-3 py-2">
              <div>
                <div className="text-[9px] text-gray-600">{s.label}</div>
                {s.sub && <div className="text-[8px] text-gray-700">{s.sub}</div>}
              </div>
              <span className="text-[11px] font-black font-mono flex-shrink-0" style={{ color: s.color }}>{s.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Monthly Table toggle */}
      <div>
        <button
          onClick={() => setShowTable(t => !t)}
          className="flex items-center gap-2 text-[10px] font-bold text-[#8B5CF6] hover:text-[#A78BFA] transition-colors"
        >
          {showTable ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          View Monthly Table
        </button>

        {showTable && (
          <div className="mt-3 overflow-x-auto rounded-xl border border-white/8">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="border-b border-white/8">
                  {['Month', 'Investment', 'Gain', 'Net', 'Cumulative'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-[9px] font-bold uppercase tracking-wider text-gray-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cf.monthly_projection.map(m => (
                  <tr key={m.month} className={`border-b border-white/[0.03] ${m.cumulative >= 0 ? '' : ''}`}>
                    <td className="px-3 py-1.5 font-bold text-gray-400">M{m.month}</td>
                    <td className="px-3 py-1.5 text-[#FD4438]">{fmt$(m.investment)}</td>
                    <td className="px-3 py-1.5 text-[#10B981]">{fmt$(m.gain)}</td>
                    <td className="px-3 py-1.5" style={{ color: m.net >= 0 ? '#10B981' : '#FD4438' }}>{fmt$(m.net)}</td>
                    <td className="px-3 py-1.5 font-bold" style={{ color: m.cumulative >= 0 ? '#06D7F6' : '#FD4438' }}>{fmt$(m.cumulative)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-white/10">
                  <td className="px-3 py-2 text-[9px] font-bold uppercase text-gray-600" colSpan={2}>Total</td>
                  <td className="px-3 py-2 font-black text-[#10B981]">{fmt$(cf.monthly_projection.reduce((s, m) => s + m.gain, 0))}</td>
                  <td className="px-3 py-2"></td>
                  <td className="px-3 py-2 font-black text-[#06D7F6]">{fmt$(cf.monthly_projection[cf.monthly_projection.length - 1]?.cumulative ?? 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// §4 — RECOMMENDATION ROI BREAKDOWN CARDS
// ════════════════════════════════════════════════════════════════════════════════

function GainCompositionBar({ roi }: { roi: RecommendationROI }) {
  const total   = roi.impact_calculations.total_projected_gain ?? 0;
  if (total <= 0) return null;
  const revenue = roi.impact_calculations.revenue_impact?.projected_gain     ?? 0;
  const cost    = roi.impact_calculations.cost_reduction?.savings             ?? 0;
  const risk    = roi.impact_calculations.risk_reduction?.expected_loss_avoided ?? 0;
  const eff     = Math.max(0, total - revenue - cost - risk);

  const segs: { label: string; value: number; color: string }[] = [
    { label: 'Efficiency', value: eff,     color: '#8B5CF6' },
    { label: 'Revenue',    value: revenue, color: '#10B981' },
    { label: 'Cost',       value: cost,    color: '#3B82F6' },
    { label: 'Risk',       value: risk,    color: '#FB923C' },
  ].filter(s => s.value > 0);

  return (
    <div className="space-y-1.5">
      {/* Bar */}
      <div className="flex rounded-full overflow-hidden h-3 bg-white/5 gap-px">
        {segs.map(s => (
          <div key={s.label}
            className="transition-all h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
        ))}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {segs.map(s => (
          <span key={s.label} className="flex items-center gap-1 text-[9px] text-gray-500">
            <span className="size-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
            {s.label} {fmtPct((s.value / total) * 100, 0)}
          </span>
        ))}
      </div>
    </div>
  );
}

function RecCard({
  roi: r,
  rank,
  portfolioROI,
  dcfNPV,
  totalGain,
  recommendations,
}: {
  roi: RecommendationROI;
  rank?: number;
  portfolioROI: PortfolioROIModel;
  dcfNPV: number;
  totalGain: number;
  recommendations: import('@/app/core/types').RecommendationV2[];
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const color = deptColor(r.department);
  const rec = recommendations.find(rv => rv.recommendation_id === r.recommendation_id);
  const title = rec?.core_problem.problem_title ?? deptLabel(r.department);
  const depChain = r.dependency_validation?.dependency_chain ?? [];
  const removedCats = r.dependency_validation?.gain_categories_removed ?? [];
  const npvContrib = totalGain > 0 ? Math.round((r.roi_range.mid_case.gain / totalGain) * dcfNPV) : 0;

  return (
    <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden">
      {/* Header Row */}
      <div className="flex items-start justify-between gap-3 px-5 py-4 flex-wrap border-b border-white/5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-8 rounded-lg flex items-center justify-center flex-shrink-0 text-[10px] font-black text-white"
            style={{ background: `${color}33` }}>
            {rank ?? '—'}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-white truncate">{title}</div>
            <div className="text-[10px] text-gray-500">{deptLabel(r.department)}</div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
          {/* Confidence */}
          <div className="flex flex-col items-center">
            <div className="text-[8px] text-gray-600">Confidence</div>
            <div className="text-sm font-black" style={{ color: r.inputs.confidence_score >= 80 ? '#10B981' : r.inputs.confidence_score >= 60 ? '#FB923C' : '#FD4438' }}>
              {r.inputs.confidence_score}%
            </div>
          </div>
          {/* Dependency chain */}
          {depChain.length > 1 && (
            <div className="flex items-center gap-1 text-[9px] text-gray-500">
              <GitBranch className="size-3 text-[#8B5CF6]" />
              {depChain.join(' → ')}
            </div>
          )}
          {/* Version */}
          {rec && (
            <span className="text-[8px] px-1.5 py-0.5 rounded bg-white/5 text-gray-600 font-mono">
              calc v{rec.calc_version ?? 1}
            </span>
          )}
          {/* ROI label */}
          <span className="text-lg font-black" style={{ color: r.adjusted_roi_percent >= 100 ? '#10B981' : '#FB923C' }}>
            {r.display.adjusted_roi_label}
          </span>
        </div>
      </div>

      {/* Financial Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 px-5 py-4 border-b border-white/5">
        {[
          { label: 'Investment',   value: r.display.investment,      color: '#FFF' },
          { label: 'Gain Range',   value: `${fmt$(r.roi_range.low_case.gain)}–${fmt$(r.roi_range.high_case.gain)}`, color: '#10B981' },
          { label: 'ROI Range',    value: `${r.roi_range.low_case.roi_percent}%–${r.roi_range.high_case.roi_percent}%`, color: '#06D7F6' },
          { label: 'Payback',      value: r.display.payback_timeline, color: '#8B5CF6' },
          { label: 'NPV Contrib',  value: fmt$(npvContrib),          color: npvContrib >= 0 ? '#10B981' : '#FD4438' },
          { label: '12-Mo Gain',   value: r.display.gain_12mo,       color: '#FB923C' },
        ].map(f => (
          <div key={f.label} className="bg-white/[0.025] rounded-lg px-3 py-2 text-center">
            <div className="text-[9px] text-gray-600 uppercase mb-1">{f.label}</div>
            <div className="text-xs font-black" style={{ color: f.color }}>{f.value}</div>
          </div>
        ))}
      </div>

      {/* Gain Composition Bar */}
      <div className="px-5 py-3 border-b border-white/5">
        <div className="text-[9px] font-bold text-gray-600 uppercase tracking-wider mb-2">Gain Composition</div>
        <GainCompositionBar roi={r} />
      </div>

      {/* Validation Notes (collapsed) */}
      <div className="px-5 py-3">
        <button
          onClick={() => setNotesOpen(o => !o)}
          className="flex items-center gap-1.5 text-[9px] font-bold text-gray-600 hover:text-gray-400 transition-colors"
        >
          {notesOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          Validation Notes
          {removedCats.length > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-[#FB923C]/10 text-[#FB923C] text-[8px] font-bold ml-1">
              {removedCats.length} gain category removed
            </span>
          )}
        </button>
        {notesOpen && (
          <div className="mt-2 space-y-2 text-[10px]">
            {removedCats.length > 0 && (
              <div className="bg-[#FB923C]/5 border border-[#FB923C]/10 rounded-lg p-3">
                <div className="text-[9px] font-bold text-[#FB923C] uppercase mb-1">Gain Categories Removed</div>
                {r.dependency_validation?.removal_reasons.map((reason, i) => (
                  <div key={i} className="text-gray-500">— {reason}</div>
                ))}
              </div>
            )}
            {r.dependency_validation?.warnings.map((w, i) => (
              <div key={i} className="text-[#F59E0B] flex items-start gap-1">
                <AlertTriangle className="size-2.5 flex-shrink-0 mt-0.5" />
                {w}
              </div>
            ))}
            {r.adjusted_roi_percent >= 350 && (
              <div className="text-[#FD4438]">⚠ ROI cap applied at system limit (350%)</div>
            )}
            {r.display.assumptions.map((a, i) => (
              <div key={i} className="text-gray-600">— {a}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// §6 — SENSITIVITY ANALYSIS PANEL
// ════════════════════════════════════════════════════════════════════════════════

function SensitivityPanel({
  sensitivityData,
  assumptions,
}: {
  sensitivityData?: ROIAnalysisData['sensitivity_analysis'];
  assumptions?: import('@/app/core/types').PortfolioAssumptions;
}) {
  const vars = [
    { key: sensitivityData?.most_sensitive_variable     ?? 'support_tickets_per_week', rank: 1, delta: 8 },
    { key: sensitivityData?.second_most_sensitive       ?? 'gross_margin_percent',     rank: 2, delta: 6 },
    { key: sensitivityData?.third_most_sensitive        ?? 'labor_cost_per_hour',       rank: 3, delta: 4 },
  ];

  const labelOf = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const valueOf = (k: string) => {
    const v = assumptions?.[k];
    return v !== undefined ? String(v) : '—';
  };

  return (
    <div className="p-5 space-y-4">
      <div className="space-y-2">
        {vars.map(v => (
          <div key={v.key} className="flex items-center gap-3 bg-white/[0.02] border border-white/5 rounded-xl px-4 py-3">
            <span className="text-[10px] font-black text-[#8B5CF6] w-5 flex-shrink-0">#{v.rank}</span>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-white truncate">{labelOf(v.key)}</div>
              <div className="text-[9px] text-gray-500">Current: {valueOf(v.key)}</div>
            </div>
            {/* Visual bar */}
            <div className="w-32 bg-white/5 rounded-full h-2">
              <div className="h-full rounded-full bg-[#8B5CF6]" style={{ width: `${(v.delta / 10) * 100}%` }} />
            </div>
            <div className="text-right w-24 flex-shrink-0">
              <div className="text-xs font-black text-[#10B981]">+{v.delta}% ROI</div>
              <div className="text-[9px] text-gray-600">per 10% change</div>
            </div>
          </div>
        ))}
      </div>
      <div className="text-[9px] text-gray-700 border-t border-white/5 pt-3">
        Sensitivity = estimated portfolio ROI delta per 10% increase in that variable. Conservative estimate; actual impact depends on portfolio composition.
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// §7 — AUDIT & VERSION LOG PANEL
// ════════════════════════════════════════════════════════════════════════════════

function VersionLogPanel({ history }: { history: VersionRecord[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (v: string) => {
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(v) ? n.delete(v) : n.add(v);
      return n;
    });
  };

  const sourceColor: Record<string, string> = {
    initial: '#6B7280', chat: '#8B5CF6', manual_edit: '#06D7F6', auto: '#FB923C',
  };

  const sourceLabel: Record<string, string> = {
    initial: 'Initial', chat: 'Chat', manual_edit: 'Manual Edit', auto: 'Auto',
  };

  return (
    <div className="p-5">
      <div className="relative">
        {/* Timeline spine */}
        <div className="absolute left-4 top-0 bottom-0 w-px bg-white/5" />

        <div className="space-y-3 pl-10">
          {history.slice(0, 12).map((record, idx) => {
            const isOpen = expanded.has(record.version);
            const hasDetails = !!(record.roi_delta_summary || record.dcf_delta_summary || record.irr_delta_summary || record.scenario_delta_summary);

            return (
              <div key={record.version} className="relative">
                {/* Node */}
                <div className={`absolute -left-[26px] top-2.5 size-4 rounded-full border-2 flex items-center justify-center ${
                  idx === 0 ? 'bg-[#8B5CF6] border-[#8B5CF6]' : record.is_approved ? 'bg-[#10B981] border-[#10B981]' : 'bg-black/60 border-white/15'
                }`}>
                  {idx === 0 && <span className="size-1.5 rounded-full bg-white" />}
                  {record.is_approved && <CheckCircle2 className="size-2.5 text-white" />}
                  {record.locked_for_export && <Lock className="size-2.5 text-white" />}
                </div>

                <div className={`bg-white/[0.02] border rounded-xl p-3 space-y-2 ${
                  idx === 0 ? 'border-[#8B5CF6]/20' : 'border-white/[0.05]'
                }`}>
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-black text-xs" style={{ color: idx === 0 ? '#8B5CF6' : '#9CA3AF' }}>
                        {record.version}
                      </span>
                      {record.previous_version && (
                        <span className="contents">
                          <ArrowRight className="size-3 text-gray-700" />
                          <span className="font-mono text-[10px] text-gray-700">{record.previous_version}</span>
                        </span>
                      )}
                      <span className="text-[9px] px-1.5 py-0.5 rounded font-bold"
                        style={{
                          color: sourceColor[record.source] ?? '#6B7280',
                          background: `${sourceColor[record.source] ?? '#6B7280'}20`,
                        }}>
                        {sourceLabel[record.source] ?? record.source}
                      </span>
                      {record.is_approved && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#10B981]/10 text-[#10B981] font-bold">APPROVED</span>
                      )}
                      {record.scenario_switched && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#8B5CF6]/10 text-[#8B5CF6] font-bold">
                          SCENARIO → {record.scenario_delta_summary?.scenario_new}
                        </span>
                      )}
                    </div>
                    <span className="text-[9px] text-gray-700">{new Date(record.timestamp).toLocaleString()}</span>
                  </div>

                  {/* Summary */}
                  <p className="text-[10px] text-gray-400 leading-relaxed">{record.summary}</p>

                  {/* Expand toggle */}
                  {hasDetails && (
                    <button
                      onClick={() => toggle(record.version)}
                      className="flex items-center gap-1 text-[9px] text-[#8B5CF6] hover:text-[#A78BFA] font-bold transition-colors"
                    >
                      {isOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                      {isOpen ? 'Hide' : 'View'} deltas
                    </button>
                  )}

                  {/* Delta details */}
                  {isOpen && (
                    <div className="border-t border-white/5 pt-2 grid grid-cols-2 gap-2 text-[10px]">
                      {record.roi_delta_summary && (
                        <div className="bg-black/30 rounded-lg p-2 space-y-0.5">
                          <div className="text-[9px] font-bold text-gray-600 uppercase">ROI Delta</div>
                          <div>ROI: <span className="font-bold text-white">{record.roi_delta_summary.portfolio_roi_old}% → {record.roi_delta_summary.portfolio_roi_new}%</span>
                            <span className={`ml-1 font-bold ${record.roi_delta_summary.delta_percent >= 0 ? 'text-[#10B981]' : 'text-[#FD4438]'}`}>
                              ({record.roi_delta_summary.delta_percent >= 0 ? '+' : ''}{record.roi_delta_summary.delta_percent}pp)
                            </span>
                          </div>
                          <div className="text-gray-500">Gain: {fmt$(record.roi_delta_summary.gain_old)} → {fmt$(record.roi_delta_summary.gain_new)}</div>
                          <div className="text-gray-500">Payback: {record.roi_delta_summary.payback_old}mo → {record.roi_delta_summary.payback_new}mo</div>
                        </div>
                      )}
                      {record.dcf_delta_summary && (
                        <div className="bg-black/30 rounded-lg p-2 space-y-0.5">
                          <div className="text-[9px] font-bold text-gray-600 uppercase">DCF Delta</div>
                          <div>NPV: <span className="font-bold text-white">{fmt$(record.dcf_delta_summary.npv_old)} → {fmt$(record.dcf_delta_summary.npv_new)}</span></div>
                          <div className="text-gray-500">Rate: {record.dcf_delta_summary.discount_rate_old}% → {record.dcf_delta_summary.discount_rate_new}%</div>
                        </div>
                      )}
                      {record.irr_delta_summary && (
                        <div className="bg-black/30 rounded-lg p-2 space-y-0.5">
                          <div className="text-[9px] font-bold text-gray-600 uppercase">IRR Delta</div>
                          <div>IRR: <span className="font-bold text-white">{record.irr_delta_summary.irr_annual_old !== null ? `${record.irr_delta_summary.irr_annual_old}%` : '—'} → {record.irr_delta_summary.irr_annual_new !== null ? `${record.irr_delta_summary.irr_annual_new}%` : '—'}</span></div>
                        </div>
                      )}
                      {record.scenario_delta_summary && (
                        <div className="bg-black/30 rounded-lg p-2 space-y-0.5">
                          <div className="text-[9px] font-bold text-gray-600 uppercase">Scenario Delta</div>
                          <div>{record.scenario_delta_summary.scenario_old ?? '—'} → <span className="font-bold" style={{ color: SCENARIO_CFG[record.scenario_delta_summary.scenario_new]?.color }}>{record.scenario_delta_summary.scenario_new}</span></div>
                          {record.scenario_delta_summary.roi_old !== null && (
                            <div className="text-gray-500">ROI: {record.scenario_delta_summary.roi_old?.toFixed(0)}% → {record.scenario_delta_summary.roi_new.toFixed(0)}%</div>
                          )}
                        </div>
                      )}
                      {record.delta_log.length > 0 && (
                        <div className="bg-black/30 rounded-lg p-2 space-y-0.5 col-span-2">
                          <div className="text-[9px] font-bold text-gray-600 uppercase">Change Log ({record.delta_log.length})</div>
                          {record.delta_log.slice(0, 4).map((d, i) => (
                            <div key={i} className="text-gray-500 truncate">
                              <span className="text-gray-400 font-mono text-[9px]">{d.path}</span>: {String(d.old)} → <span className="text-white">{String(d.new_value)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {history.length > 12 && (
        <p className="text-[9px] text-gray-700 text-center mt-3">Showing 12 of {history.length} versions</p>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// ROOT EXPORT: ROITabLayout
// ════════════════════════════════════════════════════════════════════════════════

interface ROITabLayoutProps {
  roi: PortfolioROIModel;
  portfolioState?: PortfolioState;
  sensitivityData?: ROIAnalysisData['sensitivity_analysis'];
  onPortfolioUpdate?: (state: PortfolioState, result: RecalcResult) => void;
}

export function ROITabLayout({ roi, portfolioState, sensitivityData, onPortfolioUpdate }: ROITabLayoutProps) {
  const activeScenario: ScenarioKey = (portfolioState?.active_scenario ?? 'expected') as ScenarioKey;
  const eligibleROIs  = roi.recommendation_rois.filter(r => r.is_roi_eligible);
  const lockedROIs    = roi.recommendation_rois.filter(r => !r.is_roi_eligible);
  const recommendations = portfolioState?.outputs?.recommendations ?? [];
  const rankMap = Object.fromEntries(
    (portfolioState?.outputs?.portfolio?.global_priority_ranking ?? []).map(r => [r.recommendation_id, r.rank])
  );
  const dcfNPV = roi.dcf_model && 'npv' in roi.dcf_model ? (roi.dcf_model as DCFModel).npv : 0;
  const totalGain = roi.portfolio_totals.total_adjusted_gain_12mo;

  return (
    <div className="space-y-4">

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* §1 — Executive Control Header (always visible, no collapse shell) */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <ExecHeader
        roi={roi}
        portfolioState={portfolioState}
        onPortfolioUpdate={onPortfolioUpdate}
        activeScenario={activeScenario}
      />

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* §2 — Cash Flow Timeline */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {roi.portfolio_cashflow && (
        <SectionShell icon={Activity} title="Cash Flow Timeline" badge="finance_v1_dcf" accent="#06D7F6">
          <CashFlowTimelinePanel roi={roi} />
        </SectionShell>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* §3 — Monte Carlo Distribution */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {roi.portfolio_cashflow && (
        <SectionShell icon={Cpu} title="Monte Carlo Risk Distribution" badge="finance_v3_montecarlo" accent="#FB923C">
          <div className="p-5">
            <MonteCarloPanel roiModel={roi} />
          </div>
        </SectionShell>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* §4 — Recommendation ROI Breakdown */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {eligibleROIs.length > 0 && (
        <SectionShell
          icon={Layers}
          title={`Recommendation ROI Breakdown (${eligibleROIs.length} eligible)`}
          badge="per-department"
          accent="#10B981"
          rightSlot={
            lockedROIs.length > 0 ? (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#FB923C]/10 text-[#FB923C] font-bold">
                {lockedROIs.length} locked
              </span>
            ) : undefined
          }
        >
          <div className="p-4 space-y-4">
            {eligibleROIs.map(r => (
              <RecCard
                key={r.recommendation_id}
                roi={r}
                rank={rankMap[r.recommendation_id]}
                portfolioROI={roi}
                dcfNPV={dcfNPV}
                totalGain={totalGain}
                recommendations={recommendations}
              />
            ))}

            {/* Locked recs */}
            {lockedROIs.length > 0 && (
              <div className="space-y-2">
                <div className="text-[9px] font-bold text-gray-600 uppercase tracking-wider flex items-center gap-2">
                  <AlertTriangle className="size-3 text-[#FB923C]" />
                  ROI Not Calculable
                </div>
                {lockedROIs.map(r => (
                  <div key={r.recommendation_id}
                    className="flex items-center justify-between gap-3 bg-[#FB923C]/5 border border-[#FB923C]/15 rounded-xl px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="size-2 rounded-full" style={{ background: deptColor(r.department) }} />
                      <span className="text-xs font-bold text-gray-400">{deptLabel(r.department)}</span>
                    </div>
                    <span className="text-[10px] text-[#FB923C]">{r.roi_locked_reason}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Dependency adjustments */}
            {roi.dependency_adjustments.length > 0 && (
              <div className="bg-white/[0.01] border border-white/[0.04] rounded-xl p-4">
                <div className="text-[9px] font-bold text-gray-600 uppercase tracking-wider mb-2">Dependency-Safe Adjustments</div>
                <div className="space-y-1.5">
                  {roi.dependency_adjustments.map((adj, i) => (
                    <div key={i} className="flex items-center gap-2 text-[10px] text-gray-500">
                      <span className="font-bold" style={{ color: deptColor(adj.source_department) }}>{deptLabel(adj.source_department)}</span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#FB923C]/10 text-[#FB923C]">
                        {adj.adjustment_type === 'efficiency_credit_only' ? 'Efficiency Only' : 'Revenue → Target'}
                      </span>
                      <ArrowRight className="size-3 text-gray-600" />
                      <span className="font-bold" style={{ color: deptColor(adj.target_department) }}>{deptLabel(adj.target_department)}</span>
                    </div>
                  ))}
                  <div className="text-[9px] text-gray-700 mt-1">If A enables B, only B gets full revenue credit. Prevents stacking fantasy ROI.</div>
                </div>
              </div>
            )}
          </div>
        </SectionShell>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* §5 — Financial Assumptions (Editable) */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {portfolioState && (
        <SectionShell icon={BookOpen} title="Financial Assumptions" badge="Editable" accent="#F59E0B">
          <div className="p-4">
            <ROIAssumptionsEditor
              portfolioState={portfolioState}
              sensitivityData={sensitivityData}
              onPortfolioUpdate={onPortfolioUpdate}
            />
          </div>
        </SectionShell>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* §6 — Sensitivity Analysis */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <SectionShell icon={BarChart3} title="Sensitivity Analysis" accent="#EC4899">
        <SensitivityPanel
          sensitivityData={sensitivityData}
          assumptions={portfolioState?.inputs?.assumptions}
        />
      </SectionShell>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* §7 — Audit & Version Log */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {portfolioState && portfolioState.history.length > 0 && (
        <SectionShell
          icon={GitBranch}
          title="Audit & Version Log"
          badge={`${portfolioState.history.length} versions`}
          accent="#3B82F6"
        >
          <VersionLogPanel history={portfolioState.history} />
        </SectionShell>
      )}
    </div>
  );
}