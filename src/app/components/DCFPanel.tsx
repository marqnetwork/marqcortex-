/**
 * DCF PANEL — finance_v1_dcf
 *
 * Surfaces the DCF Integration Spec output directly inside the ROI tab:
 *
 *   1. Finance KPI Strip — NPV, Discount Rate, Nominal vs Discounted Payback toggle
 *   2. Discount Rate Slider — wired to applyChangeRequest (UpdateAssumption)
 *   3. DCF Waterfall Chart — net_cashflow bars + cumulative net vs cumulative discounted lines
 *      with both payback break-even reference lines
 *   4. Monthly DCF Table — month | net_cashflow | discounted_cashflow | cumulative_discounted
 *   5. Method Notes — collapsible audit trail from the engine
 *   6. Stale Banner — finance_recalc_required flag from VersionRecord
 *
 * Governance (mirroring engine §7):
 *   This component NEVER re-runs math. It reads dcf_model from PortfolioROIModel.
 *   The only mutation it triggers is a discount_rate_percent UpdateAssumption change
 *   via applyChangeRequest — which causes the full engine to recalculate.
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Legend, Cell,
} from 'recharts';
import {
  TrendingDown, TrendingUp, DollarSign, Clock, Percent, ChevronDown,
  ChevronRight, AlertTriangle, CheckCircle2, Info, Activity, Zap,
  ToggleLeft, ToggleRight, RefreshCw,
} from 'lucide-react';
import { applyChangeRequest } from '@/app/core/versionEngine';
import { isDCFModel } from '@/app/core/dcfEngine';
import { computeDCF } from '@/app/core/dcfEngine';
import { isIRRModel } from '@/app/core/irrEngine';
import type {
  PortfolioROIModel, PortfolioState, RecalcResult,
  DCFModel, DCFProjectionEntry, IRRModel, IRRFailure,
} from '@/app/core/types';

// ════════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════════

type PaybackMode = 'nominal' | 'discounted';

interface DCFPanelProps {
  roiModel: PortfolioROIModel;
  portfolioState?: PortfolioState;
  onPortfolioUpdate?: (newState: PortfolioState, result: RecalcResult) => void;
}

// ════════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════════

function fmt$(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs).toLocaleString()}`;
}

function paybackLabel(month: number | null): string {
  if (month === null) return 'Not reached';
  if (month === 1)    return 'Month 1';
  return `Month ${month}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// CUSTOM CHART TOOLTIP
// ════════════════════════════════════════════════════════════════════════════════

function DCFTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#0D0D1A] border border-white/10 rounded-xl p-3 text-xs shadow-2xl min-w-[200px]">
      <div className="font-bold text-white mb-2 border-b border-white/10 pb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 py-0.5">
          <div className="flex items-center gap-1.5">
            <div className="size-2 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="text-gray-400">{p.name}</span>
          </div>
          <span className="font-mono font-bold" style={{ color: p.color }}>
            {fmt$(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// SECTION 1: FINANCE KPI STRIP
// ════════════════════════════════════════════════════════════════════════════════

function FinanceKPIStrip({
  dcf,
  nominalPayback,
  paybackMode,
  onTogglePayback,
  irrResult,
}: {
  dcf: DCFModel;
  nominalPayback: number | null;
  paybackMode: PaybackMode;
  onTogglePayback: () => void;
  irrResult?: IRRModel | IRRFailure | null;
}) {
  const npvPositive = dcf.npv >= 0;
  const irrOk = irrResult && isIRRModel(irrResult);
  const irrHigh = irrOk && irrResult.irr_percent_annual > 300;
  const irrColor = irrOk ? (irrHigh ? '#FB923C' : '#06D7F6') : '#6B7280';

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {/* NPV */}
      <div className={`rounded-xl p-4 border ${npvPositive ? 'bg-[#10B981]/8 border-[#10B981]/20' : 'bg-[#FD4438]/8 border-[#FD4438]/20'}`}>
        <div className="flex items-center gap-2 mb-2">
          {npvPositive
            ? <TrendingUp className="size-4 text-[#10B981]" />
            : <TrendingDown className="size-4 text-[#FD4438]" />}
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Net Present Value</span>
        </div>
        <div className={`text-2xl font-black ${npvPositive ? 'text-[#10B981]' : 'text-[#FD4438]'}`}>
          {fmt$(dcf.npv)}
        </div>
        <div className="text-[10px] text-gray-600 mt-1">
          {npvPositive ? 'Project adds economic value' : 'Project destroys value at this rate'}
        </div>
      </div>

      {/* Discount Rate */}
      <div className="bg-[#8B5CF6]/8 border border-[#8B5CF6]/20 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Percent className="size-4 text-[#8B5CF6]" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Discount Rate</span>
        </div>
        <div className="text-2xl font-black text-[#8B5CF6]">{dcf.discount_rate_percent}%</div>
        <div className="text-[10px] text-gray-600 mt-1">
          r_monthly = {(dcf.r_monthly * 100).toFixed(4)}%
        </div>
      </div>

      {/* IRR — §8 Display Logic */}
      <div className={`rounded-xl p-4 border ${
        irrOk
          ? irrHigh ? 'bg-[#FB923C]/8 border-[#FB923C]/20' : 'bg-[#06D7F6]/8 border-[#06D7F6]/20'
          : 'bg-white/[0.03] border-white/10'
      }`}>
        <div className="flex items-center gap-2 mb-2">
          <Activity className="size-4" style={{ color: irrColor }} />
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">IRR Annual</span>
          <span className="text-[8px] px-1 py-0.5 rounded font-bold bg-[#06D7F6]/10 text-[#06D7F6]">v2</span>
        </div>
        {irrOk ? (
          <span className="contents">
            <div className="text-2xl font-black" style={{ color: irrColor }}>
              {irrResult.irr_percent_annual.toFixed(1)}%
            </div>
            <div className="text-[10px] text-gray-600 mt-1">
              {irrResult.irr_percent_monthly.toFixed(2)}%/mo · {irrResult.iterations_used} iter
              {irrHigh && <span className="ml-1 text-[#FB923C] font-bold">⚠ HIGH</span>}
            </div>
          </span>
        ) : irrResult ? (
          <span className="contents">
            <div className="text-sm font-bold text-gray-500 mt-1">Undefined</div>
            <div className="text-[9px] text-gray-600 mt-1 leading-tight line-clamp-2">
              {(irrResult as IRRFailure).status.replace(/_/g, ' ')}
            </div>
          </span>
        ) : (
          <div className="text-sm text-gray-600 mt-2">Not computed</div>
        )}
      </div>

      {/* Nominal Payback */}
      <div className={`rounded-xl p-4 border transition-all cursor-pointer ${
        paybackMode === 'nominal'
          ? 'bg-[#06D7F6]/10 border-[#06D7F6]/30 ring-1 ring-[#06D7F6]/20'
          : 'bg-white/[0.03] border-white/10 opacity-70 hover:opacity-100'
      }`} onClick={onTogglePayback}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-[#06D7F6]" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Nominal Payback</span>
          </div>
          {paybackMode === 'nominal' && (
            <span className="text-[9px] font-bold text-[#06D7F6] bg-[#06D7F6]/10 px-1.5 py-0.5 rounded">ACTIVE</span>
          )}
        </div>
        <div className="text-2xl font-black text-[#06D7F6]">{paybackLabel(nominalPayback)}</div>
        <div className="text-[10px] text-gray-600 mt-1">Raw cumulative cash flow</div>
      </div>

      {/* Discounted Payback */}
      <div className={`rounded-xl p-4 border transition-all cursor-pointer ${
        paybackMode === 'discounted'
          ? 'bg-[#FB923C]/10 border-[#FB923C]/30 ring-1 ring-[#FB923C]/20'
          : 'bg-white/[0.03] border-white/10 opacity-70 hover:opacity-100'
      }`} onClick={onTogglePayback}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <DollarSign className="size-4 text-[#FB923C]" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Discounted Payback</span>
          </div>
          {paybackMode === 'discounted' && (
            <span className="text-[9px] font-bold text-[#FB923C] bg-[#FB923C]/10 px-1.5 py-0.5 rounded">ACTIVE</span>
          )}
        </div>
        <div className="text-2xl font-black text-[#FB923C]">
          {paybackLabel(dcf.discounted_payback_month)}
        </div>
        <div className="text-[10px] text-gray-600 mt-1">Time-value-adjusted (§5B)</div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// SECTION 2: DISCOUNT RATE SLIDER
// ════════════════════════════════════════════════════════════════════════════════

function DiscountRateSlider({
  currentRate,
  portfolioState,
  onPortfolioUpdate,
}: {
  currentRate: number;
  portfolioState?: PortfolioState;
  onPortfolioUpdate?: (newState: PortfolioState, result: RecalcResult) => void;
}) {
  const [localRate, setLocalRate] = useState(currentRate);
  const [isApplying, setIsApplying] = useState(false);
  const [lastResult, setLastResult] = useState<RecalcResult | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canApply = portfolioState && onPortfolioUpdate && localRate !== currentRate && localRate >= 0 && localRate <= 40;

  // Preset breakpoints: typical hurdle rates
  const PRESETS = [
    { label: '6%', value: 6, note: 'Conservative / Risk-free proxy' },
    { label: '10%', value: 10, note: 'Standard WACC' },
    { label: '12%', value: 12, note: 'Default' },
    { label: '15%', value: 15, note: 'Growth stage' },
    { label: '20%', value: 20, note: 'High-risk / VC hurdle' },
  ];

  const handleSliderChange = useCallback((v: number) => {
    setLocalRate(v);
    setLastResult(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      /* intentional no-op — user must click Apply */
    }, 300);
  }, []);

  const handleApply = useCallback(() => {
    if (!portfolioState || !onPortfolioUpdate || !canApply) return;
    setIsApplying(true);
    const result = applyChangeRequest(
      portfolioState,
      {
        type: 'UpdateAssumption',
        changes: [{
          path: 'inputs.assumptions.discount_rate_percent',
          value: localRate,
          reason: `Discount rate updated to ${localRate}% — finance_v1_dcf §9 recalculation`,
        }],
      },
      'team_user',
      'manual_edit',
    );
    if (result.success) {
      onPortfolioUpdate(result.state, result);
      setLastResult(result);
    } else {
      setLastResult(result);
    }
    setIsApplying(false);
  }, [portfolioState, onPortfolioUpdate, canApply, localRate]);

  const pct = ((localRate - 0) / (40 - 0)) * 100;

  return (
    <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Percent className="size-4 text-[#8B5CF6]" />
          <h4 className="text-sm font-bold text-white">Discount Rate (WACC / Hurdle Rate)</h4>
          <span className="text-[9px] px-2 py-0.5 rounded-full bg-[#8B5CF6]/10 text-[#8B5CF6] font-bold uppercase">
            finance_v1_dcf §1
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xl font-black text-[#8B5CF6]">
          {localRate}%
          {localRate !== currentRate && (
            <span className="text-[10px] font-normal text-gray-500 ml-1">(was {currentRate}%)</span>
          )}
        </div>
      </div>

      {/* Presets */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {PRESETS.map(p => (
          <button
            key={p.value}
            onClick={() => handleSliderChange(p.value)}
            title={p.note}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              localRate === p.value
                ? 'bg-[#8B5CF6] text-white'
                : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
            }`}
          >
            {p.label}
          </button>
        ))}
        <span className="text-[10px] text-gray-600 self-center ml-1">Preset rates</span>
      </div>

      {/* Slider */}
      <div className="mb-2">
        <input
          type="range"
          min={0}
          max={40}
          step={0.5}
          value={localRate}
          onChange={e => handleSliderChange(Number(e.target.value))}
          className="w-full h-2 rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, #8B5CF6 ${pct}%, rgba(255,255,255,0.1) ${pct}%)`,
          }}
        />
        <div className="flex justify-between text-[10px] text-gray-600 mt-1">
          <span>0% (no discount)</span>
          <span>20% (VC hurdle)</span>
          <span>40% (max)</span>
        </div>
      </div>

      {/* Apply row */}
      <div className="flex items-center gap-3 mt-4">
        <button
          onClick={handleApply}
          disabled={!canApply || isApplying}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${
            canApply
              ? 'bg-[#8B5CF6] hover:bg-[#7C3AED] text-white'
              : 'bg-gray-800 text-gray-600 cursor-not-allowed'
          }`}
        >
          {isApplying
            ? <span className="contents"><Activity className="size-4 animate-spin" /> Recalculating…</span>
            : <span className="contents"><RefreshCw className="size-4" /> Apply & Recalculate NPV</span>
          }
        </button>
        {localRate !== currentRate && !isApplying && (
          <button
            onClick={() => { setLocalRate(currentRate); setLastResult(null); }}
            className="text-xs text-gray-500 hover:text-white underline"
          >
            Reset to {currentRate}%
          </button>
        )}
        {lastResult && (
          <span className={`text-xs font-medium flex items-center gap-1 ${lastResult.success ? 'text-[#10B981]' : 'text-[#FD4438]'}`}>
            {lastResult.success
              ? <span className="contents"><CheckCircle2 className="size-3.5" /> Recalculated → {lastResult.new_version}</span>
              : <span className="contents"><AlertTriangle className="size-3.5" /> {lastResult.summary}</span>
            }
          </span>
        )}
      </div>

      {/* Governance note */}
      <p className="text-[10px] text-gray-700 mt-3">
        <strong className="text-gray-600">§7 Governance:</strong> Changing this triggers finance_v1_dcf recalculation only.
        It does not re-run ROI math, confidence scoring, or gain assumptions. Math decides present value. Not storytelling.
      </p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// SECTION 3: DCF WATERFALL CHART
// ════════════════════════════════════════════════════════════════════════════════

function DCFWaterfallChart({
  dcf,
  nominalPayback,
  paybackMode,
}: {
  dcf: DCFModel;
  nominalPayback: number | null;
  paybackMode: PaybackMode;
}) {
  const chartData = dcf.discounted_cashflow_projection.map(entry => ({
    name: `M${entry.month}`,
    month: entry.month,
    net_cashflow: entry.net_cashflow,
    discounted_cashflow: entry.discounted_cashflow,
    cumulative_nominal: 0,   // filled below
    cumulative_discounted: entry.cumulative_discounted,
  }));

  // Build nominal cumulative from net_cashflow
  let cumNominal = 0;
  for (const row of chartData) {
    cumNominal += row.net_cashflow;
    row.cumulative_nominal = Math.round(cumNominal);
  }

  const nominalBELine  = nominalPayback    ? `M${nominalPayback}` : null;
  const discountedBELine = dcf.discounted_payback_month ? `M${dcf.discounted_payback_month}` : null;

  return (
    <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-base font-bold text-white flex items-center gap-2">
          <TrendingDown className="size-5 text-[#8B5CF6]" />
          DCF Waterfall — Net vs Discounted Cash Flow
        </h4>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="flex items-center gap-1.5">
            <div className="size-2.5 rounded-sm bg-[#10B981]" />
            <span className="text-gray-400">+Net CF</span>
          </span>
          <span className="flex items-center gap-1.5">
            <div className="size-2.5 rounded-sm bg-[#FD4438]" />
            <span className="text-gray-400">−Net CF</span>
          </span>
          <span className="flex items-center gap-1.5">
            <div className="w-5 h-px bg-[#06D7F6]" />
            <span className="text-gray-400">Cumulative Nominal</span>
          </span>
          <span className="flex items-center gap-1.5">
            <div className="w-5 h-px bg-[#FB923C] border-dashed border-t" />
            <span className="text-gray-400">Cumulative Discounted</span>
          </span>
        </div>
      </div>
      <p className="text-[10px] text-gray-500 mb-5">
        Bars: monthly undiscounted net cash flow · Lines: running cumulative (nominal vs time-value-adjusted) ·
        §3: DCF(n) = Net_CF(n) / (1 + r_monthly)^n
      </p>

      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 20, bottom: 5, left: 20 }}>
          <defs>
            <linearGradient id="discountLineGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FB923C" stopOpacity={0.8} />
              <stop offset="100%" stopColor="#FB923C" stopOpacity={0.3} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis
            dataKey="name"
            tick={{ fill: '#6B7280', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#6B7280', fontSize: 11 }}
            tickFormatter={v => fmt$(v)}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<DCFTooltip />} />

          {/* Zero reference */}
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />

          {/* Nominal break-even */}
          {nominalBELine && paybackMode === 'nominal' && (
            <ReferenceLine
              x={nominalBELine}
              stroke="#06D7F6"
              strokeDasharray="5 5"
              strokeWidth={1.5}
              label={{ value: `Nominal BE`, fill: '#06D7F6', fontSize: 10, position: 'top' }}
            />
          )}

          {/* Discounted break-even */}
          {discountedBELine && paybackMode === 'discounted' && (
            <ReferenceLine
              x={discountedBELine}
              stroke="#FB923C"
              strokeDasharray="5 5"
              strokeWidth={1.5}
              label={{ value: `DCF BE`, fill: '#FB923C', fontSize: 10, position: 'top' }}
            />
          )}

          {/* Net cashflow bars (green pos, red neg) */}
          <Bar
            dataKey="net_cashflow"
            name="Net CF / Month"
            radius={[2, 2, 0, 0]}
            maxBarSize={28}
          >
            {chartData.map(entry => (
              <Cell
                key={`cell-${entry.month}`}
                fill={entry.net_cashflow >= 0 ? '#10B981' : '#FD4438'}
                fillOpacity={0.75}
              />
            ))}
          </Bar>

          {/* Cumulative nominal line */}
          <Line
            type="monotone"
            dataKey="cumulative_nominal"
            name="Cumulative Nominal"
            stroke="#06D7F6"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#06D7F6' }}
          />

          {/* Cumulative discounted line */}
          <Line
            type="monotone"
            dataKey="cumulative_discounted"
            name="Cumulative Discounted"
            stroke="#FB923C"
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={false}
            activeDot={{ r: 4, fill: '#FB923C' }}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Spread callout */}
      {nominalPayback !== null && dcf.discounted_payback_month !== null && (
        <div className="mt-4 flex items-center gap-3 px-4 py-2.5 bg-white/[0.03] border border-white/5 rounded-lg">
          <Info className="size-4 text-[#8B5CF6] flex-shrink-0" />
          <span className="text-[11px] text-gray-400">
            Time-value spread:{' '}
            <strong className="text-white">
              {Math.max(0, dcf.discounted_payback_month - nominalPayback)} month{Math.abs(dcf.discounted_payback_month - nominalPayback) !== 1 ? 's' : ''}
            </strong>{' '}
            longer payback when discounted at{' '}
            <strong className="text-[#8B5CF6]">{dcf.discount_rate_percent}% annual</strong>.
            {dcf.discounted_payback_month > nominalPayback
              ? ' Discounting reveals the true cost of waiting for returns.'
              : ' Discounting has negligible payback impact at this rate.'}
          </span>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// SECTION 4: MONTHLY DCF TABLE
// ════════════════════════════════════════════════════════════════════════════════

function DCFTable({
  entries,
  nominalPayback,
  discountedPayback,
  paybackMode,
}: {
  entries: DCFProjectionEntry[];
  nominalPayback: number | null;
  discountedPayback: number | null;
  paybackMode: PaybackMode;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const visible = collapsed ? entries.slice(0, 6) : entries;

  return (
    <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden">
      <div
        className="flex items-center justify-between px-5 py-3 border-b border-white/5 cursor-pointer hover:bg-white/[0.02]"
        onClick={() => setCollapsed(c => !c)}
      >
        <h4 className="text-sm font-bold text-white flex items-center gap-2">
          <DollarSign className="size-4 text-[#FB923C]" />
          Monthly DCF Projection Table
          <span className="text-[10px] font-normal text-gray-500">({entries.length} months)</span>
        </h4>
        <button className="text-gray-500">
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/5">
            <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">Month</th>
            <th className="text-right px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">Net CF</th>
            <th className="text-right px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">Discounted CF</th>
            <th className="text-right px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">Cum. Nominal</th>
            <th className="text-right px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">Cum. Discounted</th>
            <th className="text-center px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">Status</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((entry, idx) => {
            // Compute cumulative nominal (running sum of net_cashflow)
            const cumNominal = entries.slice(0, idx + 1).reduce((s, e) => s + e.net_cashflow, 0);
            const isNominalBE = entry.month === nominalPayback;
            const isDiscountedBE = entry.month === discountedPayback;
            const activeHighlight = paybackMode === 'nominal' ? isNominalBE : isDiscountedBE;

            return (
              <tr
                key={entry.month}
                className={`border-b border-white/[0.03] text-xs transition-colors ${
                  activeHighlight
                    ? paybackMode === 'nominal'
                      ? 'bg-[#06D7F6]/8 border-[#06D7F6]/15'
                      : 'bg-[#FB923C]/8 border-[#FB923C]/15'
                    : 'hover:bg-white/[0.015]'
                }`}
              >
                <td className="px-4 py-2.5 font-medium text-white">
                  M{entry.month}
                  {isNominalBE && (
                    <span className="ml-1.5 text-[9px] font-bold text-[#06D7F6] bg-[#06D7F6]/10 px-1 py-0.5 rounded">NOMINAL BE</span>
                  )}
                  {isDiscountedBE && (
                    <span className="ml-1.5 text-[9px] font-bold text-[#FB923C] bg-[#FB923C]/10 px-1 py-0.5 rounded">DCF BE</span>
                  )}
                </td>
                <td className={`px-4 py-2.5 text-right font-mono ${entry.net_cashflow >= 0 ? 'text-[#10B981]' : 'text-[#FD4438]'}`}>
                  {fmt$(entry.net_cashflow)}
                </td>
                <td className={`px-4 py-2.5 text-right font-mono ${entry.discounted_cashflow >= 0 ? 'text-[#10B981]/80' : 'text-[#FD4438]/80'}`}>
                  {fmt$(entry.discounted_cashflow)}
                </td>
                <td className={`px-4 py-2.5 text-right font-mono ${cumNominal >= 0 ? 'text-white' : 'text-gray-500'}`}>
                  {fmt$(Math.round(cumNominal))}
                </td>
                <td className={`px-4 py-2.5 text-right font-mono font-bold ${entry.cumulative_discounted >= 0 ? 'text-[#FB923C]' : 'text-gray-500'}`}>
                  {fmt$(entry.cumulative_discounted)}
                </td>
                <td className="px-4 py-2.5 text-center">
                  {entry.cumulative_discounted >= 0 ? (
                    <CheckCircle2 className="size-3.5 text-[#10B981] mx-auto" />
                  ) : (
                    <div className="size-3.5 rounded-full border border-white/10 mx-auto" />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {collapsed && entries.length > 6 && (
        <button
          className="w-full py-2.5 text-[11px] text-gray-500 hover:text-gray-300 hover:bg-white/[0.02] transition-colors border-t border-white/5 text-center"
          onClick={() => setCollapsed(false)}
        >
          Show all {entries.length} months ↓
        </button>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// SECTION 5: METHOD NOTES
// ════════════════════════════════════════════════════════════════════════════════

function MethodNotes({ notes, version }: { notes: string[]; version: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 w-full text-left py-2 px-3 rounded-lg hover:bg-white/[0.03] transition-colors"
      >
        {open ? <ChevronDown className="size-4 text-gray-500" /> : <ChevronRight className="size-4 text-gray-500" />}
        <Info className="size-4 text-[#8B5CF6]" />
        <span className="text-sm font-semibold text-gray-400">DCF Method Notes</span>
        <span className="text-[10px] text-gray-600 ml-1">({notes.length} entries · {version})</span>
      </button>
      {open && (
        <div className="bg-black/30 border border-white/5 rounded-xl p-4 mt-1">
          <div className="space-y-2">
            {notes.map((note, idx) => (
              <div key={idx} className="flex items-start gap-2.5 text-[11px] text-gray-400">
                <Zap className="size-3 text-[#8B5CF6] flex-shrink-0 mt-0.5" />
                {note}
              </div>
            ))}
          </div>
          <div className="mt-3 text-[9px] text-gray-700">
            <strong className="text-gray-600">§7 Governance:</strong> DCF uses validated net monthly cash flow only.
            No re-run of ROI math. No modification of gain assumptions. No effect on confidence score.
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// SECTION 6: STALE BANNER — finance_recalc_required
// ════════════════════════════════════════════════════════════════════════════════

function StaleBanner({ portfolioState }: { portfolioState?: PortfolioState }) {
  const [dismissed, setDismissed] = useState(false);
  if (!portfolioState || dismissed) return null;

  const latest = portfolioState.history[0];
  if (!latest?.finance_recalc_required) return null;

  return (
    <div className="flex items-start gap-3 px-4 py-3 bg-[#FB923C]/8 border border-[#FB923C]/20 rounded-xl">
      <AlertTriangle className="size-4 text-[#FB923C] flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold text-[#FB923C]">DCF Stale — Recalculation Required</div>
        <p className="text-[11px] text-gray-400 mt-0.5">
          A discount rate, gain, investment, or timeline change was detected in{' '}
          <strong className="text-white">{latest.version}</strong>. The NPV and discounted payback
          shown may not reflect the latest assumptions. Apply & Recalculate to refresh.
        </p>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-[10px] text-gray-600 hover:text-white underline flex-shrink-0"
      >
        Dismiss
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// PAYBACK TOGGLE CONTROL (pill in header)
// ════════════════════════════════════════════════════════════════════════════════

function PaybackToggle({ mode, onToggle }: { mode: PaybackMode; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition-all text-xs font-medium text-gray-300"
      title="Toggle between nominal and discounted payback view"
    >
      {mode === 'nominal'
        ? <ToggleLeft className="size-4 text-[#06D7F6]" />
        : <ToggleRight className="size-4 text-[#FB923C]" />
      }
      <span>{mode === 'nominal' ? 'Nominal' : 'Discounted'} Payback</span>
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// PHASE C: DCF SENSITIVITY TABLE
// Shows NPV, discounted payback, and NPV-bar for 6 preset rates simultaneously.
// Reads portfolio_cashflow and calls computeDCF directly — pure reads, no mutation.
// ════════════════════════════════════════════════════════════════════════════════

const SENSITIVITY_RATES = [
  { rate: 6,  label: '6%',  note: 'Conservative / risk-free proxy',  color: '#10B981' },
  { rate: 8,  label: '8%',  note: 'Low-cost capital',                color: '#06D7F6' },
  { rate: 10, label: '10%', note: 'Standard WACC',                   color: '#3B82F6' },
  { rate: 12, label: '12%', note: 'Default (finance_v1_dcf §1)',     color: '#8B5CF6' },
  { rate: 15, label: '15%', note: 'Growth-stage hurdle',             color: '#FB923C' },
  { rate: 20, label: '20%', note: 'VC / high-risk hurdle',           color: '#FD4438' },
];

function DCFSensitivityTable({
  roiModel,
  activeRate,
}: {
  roiModel: PortfolioROIModel;
  activeRate: number;
}) {
  const [open, setOpen] = useState(true);
  const cashflow = roiModel.portfolio_cashflow;

  // Compute DCF for all preset rates in one pass
  const rows = SENSITIVITY_RATES.map(preset => {
    const result = computeDCF(cashflow, preset.rate);
    const model = isDCFModel(result) ? result : null;
    return {
      ...preset,
      npv:             model?.npv ?? null,
      dcfPayback:      model?.discounted_payback_month ?? null,
      rMonthly:        model?.r_monthly ?? null,
      isActive:        Math.round(activeRate) === preset.rate,
      isPositive:      (model?.npv ?? -1) >= 0,
    };
  });

  // Max absolute NPV for bar scaling
  const maxAbsNPV = Math.max(...rows.map(r => Math.abs(r.npv ?? 0)), 1);

  return (
    <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden">
      <button
        className="flex items-center justify-between w-full px-5 py-3 border-b border-white/5 hover:bg-white/[0.02] transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <h4 className="text-sm font-bold text-white flex items-center gap-2">
          <Zap className="size-4 text-[#FB923C]" />
          Rate Sensitivity Surface
          <span className="text-[10px] font-normal text-gray-500">
            — NPV at {SENSITIVITY_RATES.length} preset rates
          </span>
          <span className="text-[9px] px-2 py-0.5 rounded-full bg-[#FB923C]/10 text-[#FB923C] font-bold uppercase">
            Pure read · no mutation
          </span>
        </h4>
        <span className="text-gray-500">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </span>
      </button>

      {open && (
        <span className="contents">
          <div className="px-5 pt-3 pb-1">
            <p className="text-[10px] text-gray-500">
              All six DCF runs use the identical validated portfolio cashflow ({cashflow?.monthly_projection?.length ?? 0} months).
              Only the discount rate changes. No ROI math is modified.{' '}
              <span className="text-[#8B5CF6] font-semibold">Highlighted row = current active rate.</span>
            </p>
          </div>

          {/* Table */}
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left   px-5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">Rate</th>
                <th className="text-left   px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">Scenario</th>
                <th className="text-right  px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">NPV</th>
                <th className="text-center px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">DCF Payback</th>
                <th className="text-left   px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-600 w-36">NPV Bar</th>
                <th className="text-center px-5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const barPct = row.npv !== null ? (Math.abs(row.npv) / maxAbsNPV) * 100 : 0;
                return (
                  <tr
                    key={row.rate}
                    className={`border-b border-white/[0.03] transition-colors ${
                      row.isActive
                        ? 'bg-[#8B5CF6]/8 border-[#8B5CF6]/15'
                        : 'hover:bg-white/[0.015]'
                    }`}
                  >
                    {/* Rate */}
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="size-2 rounded-full flex-shrink-0" style={{ backgroundColor: row.color }} />
                        <span
                          className="text-sm font-black"
                          style={{ color: row.isActive ? row.color : '#D1D5DB' }}
                        >
                          {row.label}
                        </span>
                        {row.isActive && (
                          <span className="text-[8px] font-bold px-1 py-0.5 rounded uppercase" style={{ backgroundColor: `${row.color}20`, color: row.color }}>
                            ACTIVE
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Scenario note */}
                    <td className="px-3 py-2.5 text-[10px] text-gray-500">{row.note}</td>

                    {/* NPV */}
                    <td className="px-3 py-2.5 text-right">
                      {row.npv !== null ? (
                        <span
                          className="font-mono font-bold text-xs"
                          style={{ color: row.isPositive ? '#10B981' : '#FD4438' }}
                        >
                          {fmt$(row.npv)}
                        </span>
                      ) : (
                        <span className="text-gray-600 text-[10px]">—</span>
                      )}
                    </td>

                    {/* DCF Payback */}
                    <td className="px-3 py-2.5 text-center text-[10px]">
                      {row.dcfPayback !== null ? (
                        <span className="font-mono text-gray-300">M{row.dcfPayback}</span>
                      ) : (
                        <span className="text-gray-600 italic">not reached</span>
                      )}
                    </td>

                    {/* NPV Horizontal Bar */}
                    <td className="px-3 py-2.5">
                      {row.npv !== null && (
                        <div className="relative h-4 w-full bg-white/5 rounded-full overflow-hidden">
                          <div
                            className="absolute top-0 h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${Math.max(4, barPct)}%`,
                              backgroundColor: row.isPositive ? (row.color) : '#FD4438',
                              opacity: row.isActive ? 1 : 0.55,
                            }}
                          />
                          <div className="absolute inset-0 flex items-center justify-end pr-1.5">
                            <span className="text-[8px] font-bold text-white/70">
                              {barPct.toFixed(0)}%
                            </span>
                          </div>
                        </div>
                      )}
                    </td>

                    {/* Verdict */}
                    <td className="px-5 py-2.5 text-center">
                      {row.npv === null ? (
                        <span className="text-[9px] text-gray-600">n/a</span>
                      ) : row.isPositive ? (
                        <div className="flex items-center justify-center gap-1">
                          <CheckCircle2 className="size-3.5 text-[#10B981]" />
                          <span className="text-[9px] text-[#10B981] font-bold">Positive</span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-1">
                          <AlertTriangle className="size-3.5 text-[#FD4438]" />
                          <span className="text-[9px] text-[#FD4438] font-bold">Negative</span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Summary callout */}
          <div className="px-5 py-3 border-t border-white/5">
            {(() => {
              const positiveRates = rows.filter(r => r.isPositive && r.npv !== null);
              const negativeRates = rows.filter(r => !r.isPositive && r.npv !== null);
              const maxPositiveRate = positiveRates.length > 0
                ? Math.max(...positiveRates.map(r => r.rate))
                : null;

              return (
                <div className="flex items-start gap-2.5 text-[11px] text-gray-400">
                  <Info className="size-4 text-[#8B5CF6] flex-shrink-0 mt-0.5" />
                  <span>
                    {positiveRates.length === SENSITIVITY_RATES.length
                      ? `Project maintains positive NPV across all ${SENSITIVITY_RATES.length} tested rates — strong value creation profile.`
                      : negativeRates.length === SENSITIVITY_RATES.length
                        ? 'Project shows negative NPV at all tested rates — reassess gain assumptions or investment size.'
                        : <span className="contents">
                            Project NPV turns negative above{' '}
                            <strong className="text-white">{maxPositiveRate}%</strong> discount rate.
                            {' '}{positiveRates.length} of {SENSITIVITY_RATES.length} scenarios are NPV-positive.
                          </span>
                    }
                    {' '}§7: These are parallel read-only DCF computations. No data was modified.
                  </span>
                </div>
              );
            })()}
          </div>
        </span>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// IRR SECTION — finance_v2_dcf_irr
// Full IRR analysis: solver status, convergence indicator, KPI grid, audit notes
// §8: Display Logic (Team-Facing Only)
// ════════════════════════════════════════════════════════════════════════════════

function IRRSection({ irrResult }: { irrResult: IRRModel | IRRFailure | undefined | null }) {
  const [open, setOpen] = useState(true);
  const isSuccess = irrResult && isIRRModel(irrResult);
  const isHighReturn = isSuccess && irrResult.irr_percent_annual > 300;
  const statusColor = !irrResult ? '#6B7280' : isSuccess ? (isHighReturn ? '#FB923C' : '#06D7F6') : '#FD4438';
  const statusBg = !irrResult
    ? 'bg-white/[0.03] border-white/10'
    : isSuccess
      ? isHighReturn ? 'bg-[#FB923C]/8 border-[#FB923C]/20' : 'bg-[#06D7F6]/8 border-[#06D7F6]/20'
      : 'bg-[#FD4438]/8 border-[#FD4438]/20';

  return (
    <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden">
      <button
        className="flex items-center justify-between w-full px-5 py-3 border-b border-white/5 hover:bg-white/[0.02] transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <h4 className="text-sm font-bold text-white flex items-center gap-2">
          <Activity className="size-4 text-[#06D7F6]" />
          Internal Rate of Return (IRR)
          <span className="text-[9px] px-2 py-0.5 rounded-full bg-[#06D7F6]/10 text-[#06D7F6] font-bold uppercase">
            finance_v2_dcf_irr
          </span>
          {isHighReturn && (
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-[#FB923C]/10 text-[#FB923C] font-bold animate-pulse">
              HIGH RETURN
            </span>
          )}
        </h4>
        <span className="text-gray-500">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </span>
      </button>

      {open && (
        <div className="p-5 space-y-4">
          {/* Status banner */}
          <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${statusBg}`}>
            {isSuccess
              ? <CheckCircle2 className="size-5 flex-shrink-0 mt-0.5" style={{ color: statusColor }} />
              : <AlertTriangle className="size-5 flex-shrink-0 mt-0.5" style={{ color: statusColor }} />
            }
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold" style={{ color: statusColor }}>
                {!irrResult
                  ? 'IRR not yet computed'
                  : isSuccess
                    ? `IRR Converged — ${irrResult.irr_percent_annual.toFixed(2)}% annual`
                    : `IRR failure: ${(irrResult as IRRFailure).status.replace(/_/g, ' ')}`
                }
              </div>
              {isSuccess && (
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Binary search converged in{' '}
                  <strong className="text-white">{irrResult.iterations_used}</strong>{' '}
                  iteration{irrResult.iterations_used !== 1 ? 's' : ''} · tolerance{' '}
                  <strong className="text-white">{irrResult.tolerance}</strong>
                </p>
              )}
              {!isSuccess && irrResult && (
                <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">
                  {(irrResult as IRRFailure).reason}
                </p>
              )}
            </div>
          </div>

          {/* §8: High-return warning */}
          {isHighReturn && (
            <div className="flex items-start gap-3 px-4 py-3 bg-[#FB923C]/5 border border-[#FB923C]/20 rounded-xl">
              <AlertTriangle className="size-4 text-[#FB923C] flex-shrink-0 mt-0.5" />
              <p className="text-xs text-[#FB923C] font-medium">
                High return — check realism assumptions.{' '}
                <span className="font-normal text-gray-400">
                  IRR of {isSuccess ? irrResult.irr_percent_annual.toFixed(1) : '—'}% exceeds 300%.
                  This is within the solver range (0–500%) but warrants review of gain estimates, investment size, and timeline assumptions.
                </span>
              </p>
            </div>
          )}

          {/* §8: KPI grid — IRR annual, monthly, solver method, iterations */}
          {isSuccess && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'IRR Annual',   value: `${irrResult.irr_percent_annual.toFixed(2)}%`,   color: statusColor, note: 'True internal rate of return' },
                { label: 'IRR Monthly',  value: `${irrResult.irr_percent_monthly.toFixed(4)}%`,  color: statusColor, note: 'irr_annual / 12' },
                { label: 'Solver',       value: irrResult.irr_solver_method.replace('_', ' '),   color: '#8B5CF6',   note: '§3: stable, deterministic' },
                { label: 'Iterations',   value: String(irrResult.iterations_used),               color: '#10B981',   note: `Tolerance: ${irrResult.tolerance}` },
              ].map(item => (
                <div key={item.label} className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-3">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-gray-600 mb-1">{item.label}</div>
                  <div className="text-base font-black" style={{ color: item.color }}>{item.value}</div>
                  <div className="text-[9px] text-gray-600 mt-1">{item.note}</div>
                </div>
              ))}
            </div>
          )}

          {/* §8: Solver audit trail */}
          {isSuccess && irrResult.notes.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-600 mb-2">
                Solver Audit Trail
              </div>
              <div className="space-y-1.5">
                {irrResult.notes.map((note, idx) => (
                  <div key={idx} className={`flex items-start gap-2 text-[11px] ${
                    note.startsWith('⚠') ? 'text-[#FB923C]' : 'text-gray-400'
                  }`}>
                    <Zap className={`size-3 flex-shrink-0 mt-0.5 ${note.startsWith('⚠') ? 'text-[#FB923C]' : 'text-[#06D7F6]'}`} />
                    {note}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Governance footer */}
          <div className="pt-2 border-t border-white/[0.04]">
            <p className="text-[9px] text-gray-700">
              <strong className="text-gray-600">finance_v2_dcf_irr Governance (§7):</strong>{' '}
              IRR uses the identical validated net cash flows as DCF — no re-run of ROI math, no modification of
              gains or confidence. Solver: binary search · Bounds: 0%–500% annual ·
              Tolerance: {isSuccess ? irrResult.tolerance : '0.0001'} · Max iterations: 100.
              Never fakes IRR — all edge cases return explicit failure status (invalid_no_negative_cashflow /
              multiple_possible_irr / irr_not_converged / irr_not_calculable).
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// ROOT EXPORT: DCFPanel
// ════════════════════════════════════════════════════════════════════════════════

export function DCFPanel({
  roiModel,
  portfolioState,
  onPortfolioUpdate,
}: DCFPanelProps) {
  const [paybackMode, setPaybackMode] = useState<PaybackMode>('discounted');

  const dcfResult = roiModel.dcf_model;
  const portfolioCashflow = roiModel.portfolio_cashflow;
  const irrResult = roiModel.irr_model;

  // Nominal payback from cashflow engine (§5A)
  const nominalPayback = portfolioCashflow?.true_payback_month ?? null;

  // Effective discount rate to show in slider (from state, fallback to dcf output)
  const currentRate = portfolioState?.inputs?.assumptions?.discount_rate_percent
    ?? (isDCFModel(dcfResult ?? { status: 'finance_not_calculable', reason: '' })
       ? (dcfResult as DCFModel).discount_rate_percent
       : 12);

  // ── Failure state ─────────────────────────────────────────────────────────
  if (!dcfResult || !isDCFModel(dcfResult)) {
    return (
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="size-5 text-[#FB923C]" />
          <h3 className="text-base font-bold text-white">DCF Analysis — Not Available</h3>
          <span className="text-[9px] px-2 py-0.5 rounded-full bg-[#FB923C]/10 text-[#FB923C] font-bold">finance_not_calculable</span>
        </div>
        <p className="text-xs text-gray-400">
          {dcfResult ? `Reason: ${(dcfResult as any).reason ?? 'unknown'}` : 'DCF model has not been computed yet.'}
          {' '}DCF requires a valid portfolio cashflow projection and a discount rate in [0, 40]%.
        </p>
        {portfolioState && onPortfolioUpdate && (
          <DiscountRateSlider
            currentRate={currentRate}
            portfolioState={portfolioState}
            onPortfolioUpdate={onPortfolioUpdate}
          />
        )}
        {/* Still surface IRR even when DCF is unavailable */}
        <IRRSection irrResult={irrResult} />
      </div>
    );
  }

  const dcf = dcfResult as DCFModel;

  return (
    <div className="space-y-5">

      {/* ── Panel Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-lg bg-[#8B5CF6]/20 flex items-center justify-center">
            <TrendingDown className="size-4 text-[#8B5CF6]" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2 flex-wrap">
              Discounted Cash Flow Analysis
              <span className="text-[9px] px-2 py-0.5 rounded-full bg-[#8B5CF6]/10 border border-[#8B5CF6]/20 text-[#8B5CF6] font-bold uppercase tracking-wider">
                {dcf.finance_model_version}
              </span>
              <span className="text-[9px] px-2 py-0.5 rounded-full bg-[#06D7F6]/10 border border-[#06D7F6]/20 text-[#06D7F6] font-bold uppercase tracking-wider">
                finance_v2_dcf_irr
              </span>
            </h3>
            <p className="text-[10px] text-gray-500">
              NPV · IRR · Discounted Payback · DCF Waterfall · CFO-grade financial modeling
            </p>
          </div>
        </div>
        <PaybackToggle mode={paybackMode} onToggle={() => setPaybackMode(m => m === 'nominal' ? 'discounted' : 'nominal')} />
      </div>

      {/* §6 — Stale warning */}
      <StaleBanner portfolioState={portfolioState} />

      {/* 5-card KPI Strip: NPV | Discount Rate | IRR | Nominal Payback | Discounted Payback */}
      <FinanceKPIStrip
        dcf={dcf}
        nominalPayback={nominalPayback}
        paybackMode={paybackMode}
        onTogglePayback={() => setPaybackMode(m => m === 'nominal' ? 'discounted' : 'nominal')}
        irrResult={irrResult}
      />

      {/* §1 — Discount Rate Slider */}
      {portfolioState && onPortfolioUpdate && (
        <DiscountRateSlider
          currentRate={currentRate}
          portfolioState={portfolioState}
          onPortfolioUpdate={onPortfolioUpdate}
        />
      )}

      {/* IRR Section — finance_v2_dcf_irr §8 display + solver audit trail */}
      <IRRSection irrResult={irrResult} />

      {/* DCF Waterfall Chart */}
      <DCFWaterfallChart
        dcf={dcf}
        nominalPayback={nominalPayback}
        paybackMode={paybackMode}
      />

      {/* Monthly DCF Table */}
      <DCFTable
        entries={dcf.discounted_cashflow_projection}
        nominalPayback={nominalPayback}
        discountedPayback={dcf.discounted_payback_month}
        paybackMode={paybackMode}
      />

      {/* Method Notes */}
      <MethodNotes notes={dcf.method_notes} version={dcf.finance_model_version} />

      {/* Governance Footer */}
      <div className="bg-white/[0.01] border border-white/[0.04] rounded-xl p-3">
        <p className="text-[9px] text-gray-700">
          <strong className="text-gray-600">finance_v1_dcf Governance (§7):</strong>{' '}
          DCF is purely a valuation adjustment layer. Operates on validated net monthly cash flows after
          dependency validation + confidence weighting + gain ramping. Does not re-run ROI math, modify
          gain assumptions, or affect confidence scores.
          r_monthly = {(dcf.r_monthly * 100).toFixed(4)}% · Horizon: {dcf.discounted_cashflow_projection.length}mo ·
          DCF(n) = Net_CF(n) / (1 + r_monthly)^n
        </p>
      </div>

      {/* Rate Sensitivity Surface */}
      {portfolioCashflow && (
        <DCFSensitivityTable
          roiModel={roiModel}
          activeRate={currentRate}
        />
      )}
    </div>
  );
}