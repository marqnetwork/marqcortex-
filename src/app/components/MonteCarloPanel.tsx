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
import { brand, status, text } from '@/app/lib/tokens';

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
  if (p >= 0.9) return status.success;
  if (p >= 0.7) return status.info;
  if (p >= 0.5) return status.warning;
  return status.danger;
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
      <div className="bg-cortex-overlay border border-cortex-default rounded-cortex-sm p-3 text-xs">
        <div className="font-bold text-white mb-1">{label}</div>
        <div className="text-cortex-muted">
          <span className="text-cortex-accent font-bold">{payload[0]?.value}</span> simulations
          {' '}({((payload[0]?.payload?.pct ?? 0) * 100).toFixed(1)}%)
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4 text-[9px] text-cortex-muted flex-wrap">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-cortex-danger/60" />
          P10: {fmtPct(p10, 0)}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-cortex-success" />
          Median: {fmtPct(median, 0)}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-cortex-accent" />
          P90: {fmtPct(p90, 0)}
        </span>
        <span className="text-cortex-faint">{samples.length.toLocaleString()} simulations</span>
      </div>

      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={buckets} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="5%">
          <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.04)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 8, fill: text.faint }}
            interval={Math.floor(buckets.length / 6)}
            axisLine={false}
            tickLine={false}
          />
          <YAxis hide />
          <Tooltip content={customTooltip} />
          <ReferenceLine x={buckets.find(b => b.midpoint >= p10)?.label}  stroke={status.danger} strokeDasharray="3 3" strokeOpacity={0.6} />
          <ReferenceLine x={buckets.find(b => b.midpoint >= median)?.label} stroke={status.success} strokeDasharray="3 3" strokeOpacity={0.8} />
          <ReferenceLine x={buckets.find(b => b.midpoint >= p90)?.label}  stroke={brand.accent} strokeDasharray="3 3" strokeOpacity={0.6} />
          <Bar dataKey="count" radius={[2, 2, 0, 0]}>
            {buckets.map((bucket, i) => (
              <Cell
                key={i}
                fill={
                  bucket.midpoint < p10  ? status.danger :
                  bucket.midpoint > p90  ? brand.accent :
                  bucket.midpoint < median ? status.info : status.success
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
        <ReferenceLine x={buckets.find(b => b.midpoint >= median)?.label} stroke={status.success} strokeDasharray="3 3" strokeOpacity={0.8} />
        <Bar dataKey="count" radius={[1, 1, 0, 0]}>
          {buckets.map((bucket, i) => (
            <Cell
              key={i}
              fill={bucket.midpoint >= 0 ? status.success : status.danger}
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
  const bgStyle = pct >= 90 ? 'bg-cortex-success/8 border-cortex-success/20'
    : pct >= 70 ? 'bg-cortex-info/8 border-cortex-info/20'
    : pct >= 50 ? 'bg-cortex-warning/8 border-cortex-warning/20'
    : 'bg-cortex-danger/8 border-cortex-danger/20';

  return (
    <div className={`rounded-cortex-md p-5 border flex flex-col items-center gap-2 ${bgStyle}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-cortex-muted text-center">{label}</div>
      <div className="text-4xl font-black" style={{ color }}>{pct}%</div>
      {/* Progress bar */}
      <div className="w-full h-1.5 bg-cortex-control rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <div className="text-[10px] text-cortex-muted text-center">{sublabel}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// RANDOMIZED INPUTS TABLE
// ════════════════════════════════════════════════════════════════════════════════

function RandomizedInputsTable({ inputs }: { inputs: MonteCarloRandomizedInput[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-cortex-raised border border-cortex-default rounded-cortex-md overflow-hidden">
      <button
        className="flex items-center justify-between w-full px-5 py-3 hover:bg-white/[0.02] transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-xs font-bold text-white flex items-center gap-2">
          <Shuffle className="size-3.5 text-cortex-accent" />
          Randomized Inputs ({inputs.length} variables)
          <span className="text-[9px] text-cortex-muted font-normal">§2 spec</span>
        </span>
        {open ? <ChevronDown className="size-3.5 text-cortex-muted" /> : <ChevronRight className="size-3.5 text-cortex-muted" />}
      </button>

      {open && (
        <div className="border-t border-cortex-subtle overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-cortex-subtle">
                {['Variable', 'Distribution', 'Min', 'Mode', 'Max / Values', 'Base Value'].map(h => (
                  <th key={h} className="px-4 py-2 text-left text-[9px] font-bold uppercase tracking-wider text-cortex-faint">{h}</th>
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
                      <div className="text-cortex-faint font-mono text-[8px] mt-0.5">{inp.path}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                        inp.distribution === 'triangular'
                          ? 'bg-cortex-accent/10 text-cortex-accent'
                          : 'bg-cortex-info/10 text-cortex-info'
                      }`}>
                        {inp.distribution}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-cortex-muted font-mono">{minStr}</td>
                    <td className="px-4 py-2.5 text-cortex-secondary font-mono">{modeStr}</td>
                    <td className="px-4 py-2.5 text-cortex-muted font-mono">{maxStr}</td>
                    <td className="px-4 py-2.5 text-cortex-info font-mono font-bold">
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
      <div className="bg-cortex-raised backdrop-blur-xl border border-cortex-default rounded-cortex-md p-5">
        <div className="flex items-center gap-3">
          <AlertTriangle className="size-5 text-cortex-warning" />
          <span className="text-sm font-bold text-white">Monte Carlo — Not Computed</span>
          <span className="text-[9px] px-2 py-0.5 rounded-full bg-cortex-warning/10 text-cortex-warning font-bold">finance_v3_montecarlo</span>
        </div>
        <p className="text-xs text-cortex-muted mt-2">Monte Carlo requires a valid portfolio cashflow projection.</p>
      </div>
    );
  }

  if (!isMonteCarloModel(mc)) {
    return (
      <div className="bg-cortex-raised backdrop-blur-xl border border-cortex-default rounded-cortex-md p-5">
        <div className="flex items-center gap-3 mb-2">
          <AlertTriangle className="size-5 text-cortex-danger" />
          <span className="text-sm font-bold text-white">Monte Carlo — Not Calculable</span>
          <span className="text-[9px] px-2 py-0.5 rounded-full bg-cortex-danger/10 text-cortex-danger font-bold">monte_carlo_not_calculable</span>
        </div>
        <p className="text-xs text-cortex-muted">{(mc as MonteCarloFailure).reason}</p>
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
          <div className="size-8 rounded-cortex-sm bg-cortex-accent/20 flex items-center justify-center flex-shrink-0">
            <Activity className="size-4 text-cortex-accent" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2 flex-wrap">
              Monte Carlo Risk Simulation
              <span className="text-[9px] px-2 py-0.5 rounded-full bg-cortex-accent/10 border border-cortex-accent/20 text-cortex-accent font-bold uppercase tracking-wider">
                finance_v3_montecarlo
              </span>
            </h3>
            <p className="text-[10px] text-cortex-muted mt-0.5">
              {simulations.toLocaleString()} simulations · {simulations_successful.toLocaleString()} converged ·
              {run_time_ms}ms · 6 randomized variables · CFO trust layer
            </p>
          </div>
        </div>
      </div>

      {/* ── Confidence Hero ───────────────────────────────────────────────────── */}
      <div className={`rounded-cortex-md p-5 border ${
        isROIPositive
          ? 'bg-cortex-success/5 border-cortex-success/15'
          : 'bg-cortex-warning/5 border-cortex-warning/15'
      }`}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3">
            {isROIPositive
              ? <CheckCircle2 className="size-8 text-cortex-success flex-shrink-0" />
              : <AlertTriangle className="size-8 text-cortex-warning flex-shrink-0" />
            }
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-cortex-muted mb-0.5">
                Probability ROI-Positive
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-black" style={{ color: heroColor }}>
                  {fmtProb(roi.probability_positive)}
                </span>
                <span className="text-sm text-cortex-muted">
                  of {simulations.toLocaleString()} runs stayed ROI-positive
                </span>
              </div>
              <p className="text-[11px] text-cortex-muted mt-1">
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
              { label: 'Median ROI', value: fmtPct(roi.median, 0), color: status.info },
              { label: 'P10 ROI',    value: fmtPct(roi.p10,    0), color: status.warning },
              { label: 'P90 ROI',    value: fmtPct(roi.p90,    0), color: brand.accent },
            ].map(item => (
              <div key={item.label} className="text-center">
                <div className="text-[8px] font-bold uppercase tracking-wider text-cortex-faint">{item.label}</div>
                <div className="text-lg font-black" style={{ color: item.color }}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── ROI Distribution ─────────────────────────────────────────────────── */}
      <div className="bg-cortex-raised backdrop-blur-xl border border-cortex-default rounded-cortex-md p-5">
        <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <TrendingUp className="size-4 text-cortex-info" />
          ROI Distribution
          <span className="text-[9px] text-cortex-faint font-normal ml-1">
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
            { label: 'Mean ROI',   value: fmtPct(roi.mean,   0), color: status.info },
            { label: 'Median ROI', value: fmtPct(roi.median, 0), color: status.success },
            { label: 'P10 ROI',    value: fmtPct(roi.p10,    0), color: status.danger },
            { label: 'P90 ROI',    value: fmtPct(roi.p90,    0), color: brand.accent },
            { label: 'Std Dev',    value: fmtPct(roi.std_dev, 0), color: status.warning },
            { label: 'P(ROI > 0)', value: fmtProb(roi.probability_positive), color: probColor(roi.probability_positive) },
          ].map(item => (
            <div key={item.label} className="bg-white/[0.03] border border-white/[0.05] rounded-cortex-sm p-2.5">
              <div className="text-[8px] font-bold uppercase tracking-wider text-cortex-faint">{item.label}</div>
              <div className="text-sm font-black mt-1" style={{ color: item.color }}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Payback Probability ───────────────────────────────────────────────── */}
      <div className="bg-cortex-raised backdrop-blur-xl border border-cortex-default rounded-cortex-md p-5">
        <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <Clock className="size-4 text-cortex-warning" />
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
            { label: 'P10 Payback',    value: pb.p10    !== null ? `Month ${pb.p10}`    : '> horizon', color: status.success },
            { label: 'Median Payback', value: pb.median !== null ? `Month ${pb.median}` : '> horizon', color: status.info },
            { label: 'P90 Payback',    value: pb.p90    !== null ? `Month ${pb.p90}`    : '> horizon', color: brand.accent },
          ].map(item => (
            <div key={item.label} className="bg-white/[0.03] border border-white/[0.05] rounded-cortex-sm p-3 text-center">
              <div className="text-[8px] font-bold uppercase tracking-wider text-cortex-faint">{item.label}</div>
              <div className="text-sm font-black mt-1" style={{ color: item.color }}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── NPV Distribution ─────────────────────────────────────────────────── */}
      {npv.enabled && (
        <div className="bg-cortex-raised backdrop-blur-xl border border-cortex-default rounded-cortex-md p-5">
          <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
            <Target className="size-4 text-cortex-success" />
            NPV Distribution
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-cortex-success/10 text-cortex-success">
              P(NPV&gt;0) = {fmtProb(npv.probability_positive)}
            </span>
          </h4>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            {[
              { label: 'Median NPV',    value: fmt$(npv.median), color: status.success },
              { label: 'P10 NPV',       value: fmt$(npv.p10),    color: status.danger },
              { label: 'P90 NPV',       value: fmt$(npv.p90),    color: brand.accent },
              { label: 'P(NPV > 0)',    value: fmtProb(npv.probability_positive), color: probColor(npv.probability_positive) },
            ].map(item => (
              <div key={item.label} className="bg-white/[0.03] border border-white/[0.05] rounded-cortex-sm p-3">
                <div className="text-[8px] font-bold uppercase tracking-wider text-cortex-faint">{item.label}</div>
                <div className="text-base font-black mt-1" style={{ color: item.color }}>{item.value}</div>
              </div>
            ))}
          </div>

          {npv_samples.length > 0 && (
            <NPVHistogram samples={npv_samples} median={npv.median} />
          )}

          <div className="text-[9px] text-cortex-faint mt-2">
            Green bars = positive NPV · Red bars = negative NPV · Median line marked in green
            · Mean NPV: {fmt$(npv.mean)} · StdDev: {fmt$(npv.std_dev)}
          </div>
        </div>
      )}

      {/* ── Randomized Inputs ────────────────────────────────────────────────── */}
      <RandomizedInputsTable inputs={randomized_inputs} />

      {/* ── Notes / Audit Trail ──────────────────────────────────────────────── */}
      <div className="bg-cortex-raised backdrop-blur-xl border border-cortex-default rounded-cortex-md overflow-hidden">
        <button
          className="flex items-center justify-between w-full px-5 py-3 hover:bg-white/[0.02] transition-colors"
          onClick={() => setNotesOpen(o => !o)}
        >
          <span className="text-xs font-bold text-white flex items-center gap-2">
            <Zap className="size-3.5 text-cortex-accent" />
            Simulation Audit Trail ({notes.length} entries)
          </span>
          {notesOpen ? <ChevronDown className="size-3.5 text-cortex-muted" /> : <ChevronRight className="size-3.5 text-cortex-muted" />}
        </button>
        {notesOpen && (
          <div className="border-t border-cortex-subtle p-4 space-y-1.5">
            {notes.map((note, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px] text-cortex-muted">
                <Zap className="size-3 flex-shrink-0 mt-0.5 text-cortex-accent" />
                {note}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Governance Footer ────────────────────────────────────────────────── */}
      <div className="bg-white/[0.01] border border-white/[0.04] rounded-cortex-md p-3">
        <p className="text-[9px] text-cortex-faint leading-relaxed">
          <strong className="text-cortex-faint">finance_v3_montecarlo Governance (§8):</strong>{' '}
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
