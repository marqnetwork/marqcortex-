/**
 * MONTE CARLO PANEL — finance_v3_montecarlo
 *
 * Surfaces the Monte Carlo Simulation Spec output inside the ROI tab:
 *
 *   1. Confidence Hero — "X% probability this portfolio stays ROI-positive"
 *   2. ROI Distribution Histogram — bucketed bar chart, P10/Median/P90 markers
 *   3. ROI Stat Grid — Mean, Median, P10, P90, StdDev, P(>0)
 *   4. Payback Probability Section — P(≤6mo) and P(≤12mo) gauges, percentile strip
 *   5. NPV Distribution — Median/P10/P90 + P(NPV>0) + compact histogram
 *   6. Randomized Inputs Table — all 6 variables with distribution config
 *   7. Notes / Audit Trail
 *   8. Governance Footer
 *
 * Governance (§8): This component NEVER re-runs math.
 * It only reads monte_carlo from PortfolioROIModel.
 */

import React, { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Cell,
} from 'recharts';
import {
  Activity, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight,
  Zap, Info, TrendingUp, TrendingDown, Clock, Target, Shuffle,
} from 'lucide-react';
import { isMonteCarloModel } from '@/app/core/monteCarloEngine';
import type {
  MonteCarloModel, MonteCarloFailure, MonteCarloRandomizedInput,
  PortfolioROIModel,
} from '@/app/core/types';

// ════════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════════

function fmt$(n: number): string {
  if (!isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

function fmtPct(n: number, decimals = 1): string {
  return isFinite(n) ? `${n.toFixed(decimals)}%` : '—';
}

function fmtProb(f: number): string {
  return `${(f * 100).toFixed(0)}%`;
}

function probColor(p: number): string {
  if (p >= 0.9) return '#10B981';
  if (p >= 0.7) return '#06D7F6';
  if (p >= 0.5) return '#FB923C';
  return '#FD4438';
}

// ════════════════════════════════════════════════════════════════════════════════
// HISTOGRAM BUCKETS
// ════════════════════════════════════════════════════════════════════════════════

interface HistogramBucket {
  label: string;
  midpoint: number;
  count: number;
  pct: number;
}

function buildHistogramBuckets(samples: number[], numBuckets = 18): HistogramBucket[] {
  if (!samples.length) return [];
  const sorted = [...samples].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const range = max - min;

  if (range < 0.01) {
    return [{ label: fmtPct(min), midpoint: min, count: samples.length, pct: 1 }];
  }

  const width = range / numBuckets;
  const buckets: HistogramBucket[] = Array.from({ length: numBuckets }, (_, i) => ({
    label: fmtPct(min + i * width, 0),
    midpoint: min + (i + 0.5) * width,
    count: 0,
    pct: 0,
  }));

  for (const v of samples) {
    const idx = Math.min(Math.floor((v - min) / width), numBuckets - 1);
    buckets[idx].count++;
  }

  const maxCount = Math.max(...buckets.map(b => b.count), 1);
  for (const b of buckets) {
    b.pct = b.count / samples.length;
  }

  return buckets;
}

// ════════════════════════════════════════════════════════════════════════════════
// ROI HISTOGRAM (recharts)
// ════════════════════════════════════════════════════════════════════════════════

function ROIHistogram({
  samples,
  p10,
  median,
  p90,
}: {
  samples: number[];
  p10: number;
  median: number;
  p90: number;
}) {
  const buckets = useMemo(() => buildHistogramBuckets(samples), [samples]);

  const customTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-[#0D0D1A] border border-white/10 rounded-lg p-3 text-xs">
        <div className="font-bold text-white mb-1">{label}</div>
        <div className="text-gray-400">
          <span className="text-[#8B5CF6] font-bold">{payload[0]?.value}</span> simulations
          {' '}({((payload[0]?.payload?.pct ?? 0) * 100).toFixed(1)}%)
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4 text-[9px] text-gray-500 flex-wrap">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-[#FD4438]/60" />
          P10: {fmtPct(p10, 0)}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-[#10B981]" />
          Median: {fmtPct(median, 0)}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-[#8B5CF6]" />
          P90: {fmtPct(p90, 0)}
        </span>
        <span className="text-gray-600">{samples.length.toLocaleString()} simulations</span>
      </div>

      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={buckets} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="5%">
          <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.04)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 8, fill: '#4B5563' }}
            interval={Math.floor(buckets.length / 6)}
            axisLine={false}
            tickLine={false}
          />
          <YAxis hide />
          <Tooltip content={customTooltip} />
          <ReferenceLine x={buckets.find(b => b.midpoint >= p10)?.label}  stroke="#FD4438" strokeDasharray="3 3" strokeOpacity={0.6} />
          <ReferenceLine x={buckets.find(b => b.midpoint >= median)?.label} stroke="#10B981" strokeDasharray="3 3" strokeOpacity={0.8} />
          <ReferenceLine x={buckets.find(b => b.midpoint >= p90)?.label}  stroke="#8B5CF6" strokeDasharray="3 3" strokeOpacity={0.6} />
          <Bar dataKey="count" radius={[2, 2, 0, 0]}>
            {buckets.map((bucket, i) => (
              <Cell
                key={i}
                fill={
                  bucket.midpoint < p10  ? '#FD4438' :
                  bucket.midpoint > p90  ? '#8B5CF6' :
                  bucket.midpoint < median ? '#06D7F6' : '#10B981'
                }
                fillOpacity={0.7}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// COMPACT NPV HISTOGRAM
// ════════════════════════════════════════════════════════════════════════════════

function NPVHistogram({ samples, median }: { samples: number[]; median: number }) {
  const buckets = useMemo(() => buildHistogramBuckets(samples, 14), [samples]);

  return (
    <ResponsiveContainer width="100%" height={80}>
      <BarChart data={buckets} margin={{ top: 2, right: 2, left: 0, bottom: 0 }} barCategoryGap="5%">
        <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.03)" />
        <YAxis hide />
        <XAxis dataKey="label" hide />
        <ReferenceLine x={buckets.find(b => b.midpoint >= median)?.label} stroke="#10B981" strokeDasharray="3 3" strokeOpacity={0.8} />
        <Bar dataKey="count" radius={[1, 1, 0, 0]}>
          {buckets.map((bucket, i) => (
            <Cell
              key={i}
              fill={bucket.midpoint >= 0 ? '#10B981' : '#FD4438'}
              fillOpacity={0.65}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// PROBABILITY GAUGE (large visual number)
// ════════════════════════════════════════════════════════════════════════════════

function ProbabilityGauge({ value, label, sublabel }: { value: number; label: string; sublabel: string }) {
  const color = probColor(value);
  const pct = Math.round(value * 100);
  const bgStyle = pct >= 90 ? 'bg-[#10B981]/8 border-[#10B981]/20'
    : pct >= 70 ? 'bg-[#06D7F6]/8 border-[#06D7F6]/20'
    : pct >= 50 ? 'bg-[#FB923C]/8 border-[#FB923C]/20'
    : 'bg-[#FD4438]/8 border-[#FD4438]/20';

  return (
    <div className={`rounded-xl p-5 border flex flex-col items-center gap-2 ${bgStyle}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 text-center">{label}</div>
      <div className="text-4xl font-black" style={{ color }}>{pct}%</div>
      {/* Progress bar */}
      <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <div className="text-[10px] text-gray-500 text-center">{sublabel}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// RANDOMIZED INPUTS TABLE
// ════════════════════════════════════════════════════════════════════════════════

function RandomizedInputsTable({ inputs }: { inputs: MonteCarloRandomizedInput[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-black/40 border border-white/10 rounded-xl overflow-hidden">
      <button
        className="flex items-center justify-between w-full px-5 py-3 hover:bg-white/[0.02] transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-xs font-bold text-white flex items-center gap-2">
          <Shuffle className="size-3.5 text-[#8B5CF6]" />
          Randomized Inputs ({inputs.length} variables)
          <span className="text-[9px] text-gray-500 font-normal">§2 spec</span>
        </span>
        {open ? <ChevronDown className="size-3.5 text-gray-500" /> : <ChevronRight className="size-3.5 text-gray-500" />}
      </button>

      {open && (
        <div className="border-t border-white/5 overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-white/5">
                {['Variable', 'Distribution', 'Min', 'Mode', 'Max / Values', 'Base Value'].map(h => (
                  <th key={h} className="px-4 py-2 text-left text-[9px] font-bold uppercase tracking-wider text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {inputs.map((inp, i) => {
                const isTriangular = inp.distribution === 'triangular';
                const hasMultiplier = inp.min_multiplier !== undefined;

                let minStr = '—', modeStr = '—', maxStr = '—';

                if (isTriangular && hasMultiplier) {
                  const base = inp.base_value;
                  minStr  = fmtPct((inp.min_multiplier!  - 1) * 100, 0);
                  modeStr = '0% (base)';
                  maxStr  = `+${fmtPct((inp.max_multiplier! - 1) * 100, 0)}`;
                } else if (isTriangular && inp.min_delta !== undefined) {
                  minStr  = `${inp.min_delta! >= 0 ? '+' : ''}${inp.min_delta}pp`;
                  modeStr = '0pp (base)';
                  maxStr  = `+${inp.max_delta}pp`;
                } else if (inp.distribution === 'discrete' && inp.values && inp.weights) {
                  minStr  = inp.values.join(' / ');
                  modeStr = 'see weights';
                  maxStr  = inp.weights.map(w => `${Math.round(w * 100)}%`).join(' / ');
                }

                return (
                  <tr key={i} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5">
                      <div className="text-white font-medium">{inp.label}</div>
                      <div className="text-gray-600 font-mono text-[8px] mt-0.5">{inp.path}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                        inp.distribution === 'triangular'
                          ? 'bg-[#8B5CF6]/10 text-[#8B5CF6]'
                          : 'bg-[#06D7F6]/10 text-[#06D7F6]'
                      }`}>
                        {inp.distribution}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-400 font-mono">{minStr}</td>
                    <td className="px-4 py-2.5 text-gray-300 font-mono">{modeStr}</td>
                    <td className="px-4 py-2.5 text-gray-400 font-mono">{maxStr}</td>
                    <td className="px-4 py-2.5 text-[#06D7F6] font-mono font-bold">
                      {typeof inp.base_value === 'number' ? inp.base_value.toLocaleString() : inp.base_value}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// ROOT EXPORT: MonteCarloPanel
// ════════════════════════════════════════════════════════════════════════════════

interface MonteCarloPanelProps {
  roiModel: PortfolioROIModel;
}

export function MonteCarloPanel({ roiModel }: MonteCarloPanelProps) {
  const [notesOpen, setNotesOpen] = useState(false);
  const mc = roiModel.monte_carlo;

  // ── Failure / not-yet-computed state ────────────────────────────────────────
  if (!mc) {
    return (
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-5">
        <div className="flex items-center gap-3">
          <AlertTriangle className="size-5 text-[#FB923C]" />
          <span className="text-sm font-bold text-white">Monte Carlo — Not Computed</span>
          <span className="text-[9px] px-2 py-0.5 rounded-full bg-[#FB923C]/10 text-[#FB923C] font-bold">finance_v3_montecarlo</span>
        </div>
        <p className="text-xs text-gray-500 mt-2">Monte Carlo requires a valid portfolio cashflow projection.</p>
      </div>
    );
  }

  if (!isMonteCarloModel(mc)) {
    return (
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-5">
        <div className="flex items-center gap-3 mb-2">
          <AlertTriangle className="size-5 text-[#FD4438]" />
          <span className="text-sm font-bold text-white">Monte Carlo — Not Calculable</span>
          <span className="text-[9px] px-2 py-0.5 rounded-full bg-[#FD4438]/10 text-[#FD4438] font-bold">monte_carlo_not_calculable</span>
        </div>
        <p className="text-xs text-gray-400">{(mc as MonteCarloFailure).reason}</p>
      </div>
    );
  }

  const { results, simulations, simulations_successful, randomized_inputs, run_time_ms, notes,
          roi_samples, npv_samples, payback_samples } = mc;

  const roi   = results.roi_percent;
  const pb    = results.payback_months;
  const npv   = results.npv;

  const isROIPositive = roi.probability_positive >= 0.9;
  const heroColor = probColor(roi.probability_positive);

  return (
    <div className="space-y-4">

      {/* ── Panel Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-lg bg-[#8B5CF6]/20 flex items-center justify-center flex-shrink-0">
            <Activity className="size-4 text-[#8B5CF6]" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2 flex-wrap">
              Monte Carlo Risk Simulation
              <span className="text-[9px] px-2 py-0.5 rounded-full bg-[#8B5CF6]/10 border border-[#8B5CF6]/20 text-[#8B5CF6] font-bold uppercase tracking-wider">
                finance_v3_montecarlo
              </span>
            </h3>
            <p className="text-[10px] text-gray-500 mt-0.5">
              {simulations.toLocaleString()} simulations · {simulations_successful.toLocaleString()} converged ·
              {run_time_ms}ms · 6 randomized variables · CFO trust layer
            </p>
          </div>
        </div>
      </div>

      {/* ── Confidence Hero ───────────────────────────────────────────────────── */}
      <div className={`rounded-xl p-5 border ${
        isROIPositive
          ? 'bg-[#10B981]/5 border-[#10B981]/15'
          : 'bg-[#FB923C]/5 border-[#FB923C]/15'
      }`}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3">
            {isROIPositive
              ? <CheckCircle2 className="size-8 text-[#10B981] flex-shrink-0" />
              : <AlertTriangle className="size-8 text-[#FB923C] flex-shrink-0" />
            }
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-0.5">
                Probability ROI-Positive
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-black" style={{ color: heroColor }}>
                  {fmtProb(roi.probability_positive)}
                </span>
                <span className="text-sm text-gray-400">
                  of {simulations.toLocaleString()} runs stayed ROI-positive
                </span>
              </div>
              <p className="text-[11px] text-gray-500 mt-1">
                {roi.probability_positive >= 0.94
                  ? `Strong signal — you can say "there's a ${fmtProb(roi.probability_positive)} chance this stays ROI-positive" with CFO-grade confidence.`
                  : roi.probability_positive >= 0.7
                    ? `Solid signal — ${fmtProb(roi.probability_positive)} of simulations produce positive ROI. Review sensitivity variables to improve confidence.`
                    : `Caution — only ${fmtProb(roi.probability_positive)} probability positive ROI. Reassess gain assumptions or reduce investment.`
                }
              </p>
            </div>
          </div>

          {/* Quick secondary stats */}
          <div className="flex items-center gap-4 sm:ml-auto flex-shrink-0">
            {[
              { label: 'Median ROI', value: fmtPct(roi.median, 0), color: '#06D7F6' },
              { label: 'P10 ROI',    value: fmtPct(roi.p10,    0), color: '#FB923C' },
              { label: 'P90 ROI',    value: fmtPct(roi.p90,    0), color: '#8B5CF6' },
            ].map(item => (
              <div key={item.label} className="text-center">
                <div className="text-[8px] font-bold uppercase tracking-wider text-gray-600">{item.label}</div>
                <div className="text-lg font-black" style={{ color: item.color }}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── ROI Distribution ─────────────────────────────────────────────────── */}
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-5">
        <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <TrendingUp className="size-4 text-[#06D7F6]" />
          ROI Distribution
          <span className="text-[9px] text-gray-600 font-normal ml-1">
            {roi_samples.length.toLocaleString()} samples · P10/Median/P90 marked
          </span>
        </h4>

        {roi_samples.length > 0 && (
          <ROIHistogram
            samples={roi_samples}
            p10={roi.p10}
            median={roi.median}
            p90={roi.p90}
          />
        )}

        {/* 6-stat grid */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mt-4">
          {[
            { label: 'Mean ROI',   value: fmtPct(roi.mean,   0), color: '#06D7F6' },
            { label: 'Median ROI', value: fmtPct(roi.median, 0), color: '#10B981' },
            { label: 'P10 ROI',    value: fmtPct(roi.p10,    0), color: '#FD4438' },
            { label: 'P90 ROI',    value: fmtPct(roi.p90,    0), color: '#8B5CF6' },
            { label: 'Std Dev',    value: fmtPct(roi.std_dev, 0), color: '#FB923C' },
            { label: 'P(ROI > 0)', value: fmtProb(roi.probability_positive), color: probColor(roi.probability_positive) },
          ].map(item => (
            <div key={item.label} className="bg-white/[0.03] border border-white/[0.05] rounded-lg p-2.5">
              <div className="text-[8px] font-bold uppercase tracking-wider text-gray-600">{item.label}</div>
              <div className="text-sm font-black mt-1" style={{ color: item.color }}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Payback Probability ───────────────────────────────────────────────── */}
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-5">
        <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <Clock className="size-4 text-[#FB923C]" />
          Payback Probability Bands
        </h4>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <ProbabilityGauge
            value={pb.probability_payback_le_6}
            label="Payback Within 6 Months"
            sublabel={`median: ${pb.median !== null ? `Month ${pb.median}` : '> 12mo'}`}
          />
          <ProbabilityGauge
            value={pb.probability_payback_le_12}
            label="Payback Within 12 Months"
            sublabel={`${fmtProb(pb.fraction_never_paid_back)} never paid back within horizon`}
          />
        </div>

        {/* Payback percentile strip */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'P10 Payback',    value: pb.p10    !== null ? `Month ${pb.p10}`    : '> horizon', color: '#10B981' },
            { label: 'Median Payback', value: pb.median !== null ? `Month ${pb.median}` : '> horizon', color: '#06D7F6' },
            { label: 'P90 Payback',    value: pb.p90    !== null ? `Month ${pb.p90}`    : '> horizon', color: '#8B5CF6' },
          ].map(item => (
            <div key={item.label} className="bg-white/[0.03] border border-white/[0.05] rounded-lg p-3 text-center">
              <div className="text-[8px] font-bold uppercase tracking-wider text-gray-600">{item.label}</div>
              <div className="text-sm font-black mt-1" style={{ color: item.color }}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── NPV Distribution ─────────────────────────────────────────────────── */}
      {npv.enabled && (
        <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-5">
          <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
            <Target className="size-4 text-[#10B981]" />
            NPV Distribution
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#10B981]/10 text-[#10B981]">
              P(NPV&gt;0) = {fmtProb(npv.probability_positive)}
            </span>
          </h4>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            {[
              { label: 'Median NPV',    value: fmt$(npv.median), color: '#10B981' },
              { label: 'P10 NPV',       value: fmt$(npv.p10),    color: '#FD4438' },
              { label: 'P90 NPV',       value: fmt$(npv.p90),    color: '#8B5CF6' },
              { label: 'P(NPV > 0)',    value: fmtProb(npv.probability_positive), color: probColor(npv.probability_positive) },
            ].map(item => (
              <div key={item.label} className="bg-white/[0.03] border border-white/[0.05] rounded-lg p-3">
                <div className="text-[8px] font-bold uppercase tracking-wider text-gray-600">{item.label}</div>
                <div className="text-base font-black mt-1" style={{ color: item.color }}>{item.value}</div>
              </div>
            ))}
          </div>

          {npv_samples.length > 0 && (
            <NPVHistogram samples={npv_samples} median={npv.median} />
          )}

          <div className="text-[9px] text-gray-600 mt-2">
            Green bars = positive NPV · Red bars = negative NPV · Median line marked in green
            · Mean NPV: {fmt$(npv.mean)} · StdDev: {fmt$(npv.std_dev)}
          </div>
        </div>
      )}

      {/* ── Randomized Inputs ────────────────────────────────────────────────── */}
      <RandomizedInputsTable inputs={randomized_inputs} />

      {/* ── Notes / Audit Trail ──────────────────────────────────────────────── */}
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden">
        <button
          className="flex items-center justify-between w-full px-5 py-3 hover:bg-white/[0.02] transition-colors"
          onClick={() => setNotesOpen(o => !o)}
        >
          <span className="text-xs font-bold text-white flex items-center gap-2">
            <Zap className="size-3.5 text-[#8B5CF6]" />
            Simulation Audit Trail ({notes.length} entries)
          </span>
          {notesOpen ? <ChevronDown className="size-3.5 text-gray-500" /> : <ChevronRight className="size-3.5 text-gray-500" />}
        </button>
        {notesOpen && (
          <div className="border-t border-white/5 p-4 space-y-1.5">
            {notes.map((note, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px] text-gray-400">
                <Zap className="size-3 flex-shrink-0 mt-0.5 text-[#8B5CF6]" />
                {note}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Governance Footer ────────────────────────────────────────────────── */}
      <div className="bg-white/[0.01] border border-white/[0.04] rounded-xl p-3">
        <p className="text-[9px] text-gray-700 leading-relaxed">
          <strong className="text-gray-600">finance_v3_montecarlo Governance (§8):</strong>{' '}
          Monte Carlo is team-facing only. It runs on top of the validated pipeline:
          dependency validation → cost model → cash flow timeline → confidence weighting → DCF/IRR → Monte Carlo.
          It never modifies the base payload — it produces an extra risk distribution payload.
          Recomputed when: tickets, margin, labor, realization factors, ramp, or investment change (§8).
          {' '}Scaled perturbation approach: base monthly cash flows are anchored; 6 variables perturbed per run using
          triangular (§3) and discrete distributions. {simulations.toLocaleString()} runs · {simulations_successful.toLocaleString()} converged.
        </p>
      </div>
    </div>
  );
}
