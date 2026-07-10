/**
 * FINANCIAL SUMMARY CARD — financial-summary-binding-1.md
 *
 * Board-level financial view bound to the ROI engine output.
 *
 * Sections:
 *   1. Portfolio Financial Overview — 7 headline metrics (investment, ROI, payback,
 *      NPV, IRR, risk band, probability positive)
 *   2. Monte Carlo Distribution — horizontal band with P10 / mean / median / P90 markers
 *   3. Solution Financial Contribution — per-solution table (investment, gain, ROI%, payback)
 *   4. Validation Badges — 4 Phase 3 gate checks (portfolio match, dependency, confidence, realization)
 *
 * GOVERNANCE: Read-only. Manual edits are blocked by design.
 * All numbers flow from ROI engine → financial_summary. The Phase 3 gate enforces consistency.
 */

import React, { useMemo } from 'react';
import {
  BarChart3, Lock, TrendingUp, DollarSign, Calendar,
  CirclePercent, Activity, CheckCircle2, AlertCircle,
  Database, Shield, Zap, ChevronRight,
} from 'lucide-react';
import type { ProposalDraft, FinancialSummary, Solution } from '@/app/types/cortex-types';

// ════════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════════

function fmt$(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)    return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtPct(n: number): string {
  return `${(n ?? 0).toFixed(n % 1 === 0 ? 0 : 1)}%`;
}

function roiColor(roi: number): string {
  if (roi >= 200) return '#10B981';
  if (roi >= 100) return '#06D7F6';
  if (roi >= 50)  return '#FB923C';
  return '#FD4438';
}

// ════════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ════════════════════════════════════════════════════════════════════════════════

function StatCard({
  label, value, sub, color = '#8B5CF6', icon: Icon,
}: {
  label: string; value: string; sub?: string;
  color?: string; icon: React.FC<{ className?: string }>;
}) {
  return (
    <div className="bg-white/[0.025] border border-white/8 rounded-xl px-4 py-3 relative overflow-hidden">
      <div className="absolute inset-0 opacity-5" style={{ background: `radial-gradient(circle at 30% 50%, ${color}, transparent 70%)` }} />
      <div className="relative">
        <div className="flex items-center gap-1 mb-1.5 text-[9px] font-bold uppercase tracking-wider text-gray-600">
          <Icon className="size-2.5" style={{ color }} />
          {label}
        </div>
        <div className="text-xl font-black leading-none" style={{ color }}>{value}</div>
        {sub && <div className="text-[9px] text-gray-600 mt-1">{sub}</div>}
      </div>
    </div>
  );
}

function ValidationBadge({
  label, ok, detail,
}: { label: string; ok: boolean; detail?: string }) {
  return (
    <div
      className="flex items-start gap-2 px-3 py-2 rounded-lg border text-[10px]"
      style={{
        color:       ok ? '#10B981' : '#FD4438',
        borderColor: ok ? '#10B98130' : '#FD443830',
        background:  ok ? '#10B98108' : '#FD443808',
      }}
    >
      {ok
        ? <CheckCircle2 className="size-3 flex-shrink-0 mt-0.5" />
        : <AlertCircle  className="size-3 flex-shrink-0 mt-0.5" />
      }
      <div>
        <div className="font-bold">{label}</div>
        {detail && <div className="text-gray-600 text-[9px] mt-0.5">{detail}</div>}
      </div>
    </div>
  );
}

// ── Monte Carlo Distribution Bar ──────────────────────────────────────────────

function MonteCarloBar({ fs }: { fs: FinancialSummary }) {
  const mc    = fs.monte_carlo;
  const range = mc.p90_roi - mc.p10_roi;

  function pos(value: number): number {
    if (range <= 0) return 50;
    return Math.min(100, Math.max(0, ((value - mc.p10_roi) / range) * 100));
  }

  const meanPos   = pos(mc.mean_roi);
  const medianPos = pos(mc.median_roi);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[9px] font-bold text-gray-600 uppercase tracking-wider">
        <span className="flex items-center gap-1.5"><Activity className="size-2.5" />Monte Carlo Distribution</span>
        <span className="text-[9px] text-gray-700 font-normal normal-case">
          {mc.probability_positive_roi}% probability positive ROI
        </span>
      </div>

      {/* The bar */}
      <div className="relative h-3 rounded-full overflow-visible bg-white/5">
        {/* Gradient fill */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: 'linear-gradient(to right, #FD4438 0%, #FB923C 25%, #06D7F6 60%, #10B981 100%)',
            opacity: 0.6,
          }}
        />

        {/* Mean marker */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center"
          style={{ left: `${meanPos}%` }}
        >
          <div className="w-0.5 h-5 bg-white/60 rounded-full" />
        </div>

        {/* Median marker */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center"
          style={{ left: `${medianPos}%` }}
        >
          <div className="w-0.5 h-5 bg-[#06D7F6]/80 rounded-full" />
        </div>
      </div>

      {/* Labels row */}
      <div className="relative h-5">
        {/* P10 */}
        <span className="absolute left-0 text-[8px] font-mono text-gray-600">
          P10: {fmtPct(mc.p10_roi)}
        </span>
        {/* Mean label */}
        <span
          className="absolute -translate-x-1/2 text-[8px] font-mono text-white/60"
          style={{ left: `${meanPos}%` }}
        >
          mean {fmtPct(mc.mean_roi)}
        </span>
        {/* Median label — only if far enough from mean */}
        {Math.abs(meanPos - medianPos) > 8 && (
          <span
            className="absolute -translate-x-1/2 text-[8px] font-mono text-[#06D7F6]/70"
            style={{ left: `${medianPos}%`, top: 12 }}
          >
            med {fmtPct(mc.median_roi)}
          </span>
        )}
        {/* P90 */}
        <span className="absolute right-0 text-[8px] font-mono text-gray-600">
          P90: {fmtPct(mc.p90_roi)}
        </span>
      </div>
    </div>
  );
}

// ── Solution Contribution Table ───────────────────────────────────────────────

const PILLAR_COLORS: Record<string, string> = {
  workflow:   '#06D7F6',
  agents:     '#8B5CF6',
  revenue:    '#10B981',
  monitoring: '#FB923C',
};

function SolutionContributionTable({ solutions, fs }: {
  solutions: Solution[];
  fs: FinancialSummary;
}) {
  const bound = solutions.filter(s => s.financial_binding);
  const totalInvested = bound.reduce((s, sol) => s + (sol.financial_binding?.investment_allocated ?? 0), 0);
  const totalGain     = bound.reduce((s, sol) => s + (sol.financial_binding?.annual_gain ?? 0), 0);

  if (!bound.length) {
    return (
      <div className="text-center py-6 text-xs text-gray-700 italic">
        No solutions with financial binding found.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/8">
      {/* Header */}
      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 px-4 py-2 bg-white/[0.02] border-b border-white/5">
        {['Solution', 'Invested', 'Annual Gain', 'ROI Contribution', 'Payback'].map(h => (
          <div key={h} className="text-[9px] font-bold text-gray-600 uppercase tracking-wider">{h}</div>
        ))}
      </div>

      {/* Rows */}
      {bound.map((sol, i) => {
        const fb    = sol.financial_binding!;
        const pc    = PILLAR_COLORS[sol.pillar] ?? '#8B5CF6';
        const pctBar = fs.investment_total > 0
          ? (fb.investment_allocated / fs.investment_total) * 100
          : 0;

        return (
          <div
            key={sol.solution_id}
            className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 px-4 py-3 items-center border-b border-white/[0.04] last:border-0 hover:bg-white/[0.015] transition-colors"
          >
            {/* Solution */}
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-0.5 h-8 rounded-full flex-shrink-0" style={{ background: pc }} />
              <div className="min-w-0">
                <div className="text-xs font-bold text-white truncate">{sol.title}</div>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="text-[8px] font-mono text-gray-600">{sol.solution_id}</span>
                  <span className="size-1 rounded-full" style={{ background: pc }} />
                  <span className="text-[8px] capitalize" style={{ color: pc }}>{sol.pillar}</span>
                </div>
                {/* Investment share bar */}
                <div className="mt-1 h-0.5 bg-white/5 rounded-full w-24 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pctBar}%`, background: pc }} />
                </div>
              </div>
            </div>

            {/* Invested */}
            <div className="text-right">
              <div className="text-xs font-black font-mono text-[#06D7F6]">{fmt$(fb.investment_allocated)}</div>
              <div className="text-[8px] text-gray-700">allocated</div>
            </div>

            {/* Annual Gain */}
            <div className="text-right">
              <div className="text-xs font-black font-mono text-[#10B981]">{fmt$(fb.annual_gain)}</div>
              <div className="text-[8px] text-gray-700">annual</div>
            </div>

            {/* ROI Contribution */}
            <div className="text-right">
              <div
                className="text-xs font-black font-mono"
                style={{ color: roiColor(fb.roi_contribution_percentage * 2) }}
              >
                {fmtPct(fb.roi_contribution_percentage)}
              </div>
              <div className="text-[8px] text-gray-700">of total</div>
            </div>

            {/* Payback */}
            <div className="text-right">
              <div className="text-xs font-bold text-[#FB923C] font-mono">{fb.payback_month}mo</div>
              <div className="text-[8px] text-gray-700">payback</div>
            </div>
          </div>
        );
      })}

      {/* Totals row */}
      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 px-4 py-3 items-center bg-white/[0.025] border-t border-white/10">
        <div className="text-[9px] font-black text-gray-500 uppercase tracking-wider">Portfolio Total</div>
        <div className="text-right text-xs font-black font-mono text-[#06D7F6]">{fmt$(totalInvested)}</div>
        <div className="text-right text-xs font-black font-mono text-[#10B981]">{fmt$(totalGain)}</div>
        <div className="text-right text-[9px] font-black text-gray-600">100%</div>
        <div className="text-right text-[9px] font-bold text-gray-600">{fs.payback_month}mo avg</div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// ROOT EXPORT: FinancialSummaryCard
// ════════════════════════════════════════════════════════════════════════════════

interface FinancialSummaryCardProps {
  draft: ProposalDraft;
}

export function FinancialSummaryCard({ draft }: FinancialSummaryCardProps) {
  const fs        = draft.financial_summary;
  const solutions = draft.solutions ?? [];

  // Validation badge states (mirrors Phase 3 gate checks)
  const versionMatch   = fs ? fs.portfolio_version_id === draft.linkage.portfolio_version_id : false;
  const depValidated   = fs?.dependency_validated ?? false;
  const confOk         = fs ? fs.confidence_score >= 70 : false;
  const realizationOk  = fs?.realization_factor_applied ?? false;

  if (!fs) {
    return (
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-white/5">
          <BarChart3 className="size-4 text-[#10B981]" />
          <span className="text-sm font-bold text-white">Financial Summary</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold border uppercase tracking-wider"
            style={{ color: '#10B981', borderColor: '#10B98133', background: '#10B98114' }}>
            Phase 3
          </span>
          <Lock className="size-3 text-gray-700 ml-1" />
        </div>
        <div className="p-5 text-center py-10 space-y-2">
          <BarChart3 className="size-8 text-gray-700 mx-auto" />
          <p className="text-sm font-bold text-gray-600">Financial summary not yet populated</p>
          <p className="text-xs text-gray-700 max-w-sm mx-auto">
            The financial summary is auto-populated from the ROI engine after Phase 2 is approved.
            Manual edits are blocked. Run the ROI engine to generate and lock this section.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden">
      {/* ── Card header ── */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5">
        <span className="flex items-center gap-2.5 text-sm font-bold text-white">
          <BarChart3 className="size-4 text-[#10B981]" />
          Financial Summary
          <span
            className="text-[9px] px-1.5 py-0.5 rounded-full font-bold border uppercase tracking-wider"
            style={{ color: '#10B981', borderColor: '#10B98133', background: '#10B98114' }}
          >
            Phase 3
          </span>
          <span className="text-[9px] text-gray-600 font-normal">
            {fs.portfolio_version_id} · {fs.scenario}
          </span>
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-gray-700 flex items-center gap-1">
            <Lock className="size-2.5" />Read-Only — ROI engine source
          </span>
        </div>
      </div>

      <div className="p-5 space-y-6">
        {/* ── §1 Board-level overview ── */}
        <div className="space-y-3">
          <div className="text-[9px] font-bold text-gray-600 uppercase tracking-wider">
            Board-Level Financial Overview
          </div>

          {/* Row 1: 4 primary metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Total Investment"
              value={fmt$(fs.investment_total)}
              sub={`${fs.currency} · ${fs.scenario}`}
              color="#06D7F6"
              icon={DollarSign}
            />
            <StatCard
              label="Expected ROI"
              value={fmtPct(fs.roi_percentage)}
              sub={`${fmt$(fs.annual_gain_conf_weighted)} annual gain`}
              color={roiColor(fs.roi_percentage)}
              icon={TrendingUp}
            />
            <StatCard
              label="True Payback"
              value={`${fs.payback_month} months`}
              sub="Investment recovery point"
              color="#FB923C"
              icon={Calendar}
            />
            <StatCard
              label="Net Present Value"
              value={fmt$(fs.npv)}
              sub="Discounted over 12 months"
              color="#8B5CF6"
              icon={BarChart3}
            />
          </div>

          {/* Row 2: 3 secondary metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <StatCard
              label="IRR (Annual)"
              value={fmtPct(fs.irr_annual)}
              sub={`${fmtPct(fs.irr_monthly)} monthly`}
              color="#10B981"
              icon={CirclePercent}
            />
            <div className="bg-white/[0.025] border border-white/8 rounded-xl px-4 py-3">
              <div className="text-[9px] font-bold text-gray-600 uppercase tracking-wider mb-2 flex items-center gap-1">
                <Activity className="size-2.5 text-[#06D7F6]" />Risk Band
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-black font-mono text-[#FD4438]">
                  {fmtPct(fs.monte_carlo.p10_roi)}
                </span>
                <ChevronRight className="size-3 text-gray-600" />
                <span className="text-lg font-black font-mono text-[#10B981]">
                  {fmtPct(fs.monte_carlo.p90_roi)}
                </span>
              </div>
              <div className="text-[9px] text-gray-600 mt-0.5">P10 pessimistic → P90 optimistic</div>
            </div>
            <StatCard
              label="Prob. Positive ROI"
              value={fmtPct(fs.monte_carlo.probability_positive_roi)}
              sub={`Mean ROI: ${fmtPct(fs.monte_carlo.mean_roi)}`}
              color="#10B981"
              icon={Shield}
            />
          </div>
        </div>

        {/* ── §2 Monte Carlo viz ── */}
        <MonteCarloBar fs={fs} />

        {/* ── §3 Solution contribution table ── */}
        <div className="space-y-2">
          <div className="text-[9px] font-bold text-gray-600 uppercase tracking-wider flex items-center gap-2">
            <Zap className="size-2.5 text-[#8B5CF6]" />Solution Financial Contribution
          </div>
          <SolutionContributionTable solutions={solutions} fs={fs} />
        </div>

        {/* ── §4 Validation badges ── */}
        <div className="space-y-2">
          <div className="text-[9px] font-bold text-gray-600 uppercase tracking-wider flex items-center gap-2">
            <Shield className="size-2.5 text-[#06D7F6]" />Phase 3 Validation Status
          </div>
          <div className="grid grid-cols-2 gap-2">
            <ValidationBadge
              label="Portfolio Version Match"
              ok={versionMatch}
              detail={versionMatch
                ? `Summary v${fs.portfolio_version_id} matches linkage`
                : `Mismatch — summary: ${fs.portfolio_version_id}, linkage: ${draft.linkage.portfolio_version_id}`
              }
            />
            <ValidationBadge
              label="Dependency Validation"
              ok={depValidated}
              detail={depValidated
                ? 'No overlapping gains detected'
                : 'Overlapping gain check required'
              }
            />
            <ValidationBadge
              label="Confidence Threshold"
              ok={confOk}
              detail={`Score: ${fs.confidence_score} / 100 ${confOk ? '(≥ 70 ✓)' : '(< 70 — override required)'}`}
            />
            <ValidationBadge
              label="Realization Factor Applied"
              ok={realizationOk}
              detail={realizationOk
                ? 'Conservative realization factor applied'
                : '100% efficiency assumption not allowed — flag required'
              }
            />
          </div>
        </div>

        {/* Disclaimer */}
        <p className="text-[9px] text-gray-700 leading-relaxed border-t border-white/5 pt-3">
          All projections are confidence-weighted, dependency-validated, and conservatively modeled.
          Numbers are auto-populated from the ROI engine and locked to portfolio version{' '}
          <span className="font-mono text-gray-600">{fs.portfolio_version_id}</span>.
          If the ROI model is recalculated, the proposal status resets to Draft and Phase 3 gate must be re-run.
        </p>
      </div>
    </div>
  );
}
