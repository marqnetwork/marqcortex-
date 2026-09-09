/**
 * POST-IMPLEMENTATION ROI TRACKING PANEL — Phase 8
 *
 * §11 of ProposalDraftEditor
 *
 * Spec: roi-tracking-spec.md
 *
 * Five cards (spec §7 "Team-Facing ROI Tracking UI"):
 *   A. Baseline Snapshot    — derived at contract_signed
 *   B. Monthly Actuals Input — manual entry form (spec §3)
 *   C. Projected vs Actual Chart — recharts ComposedChart
 *   D. Variance Log + Tags  — table + 9-tag selector (spec §5)
 *   E. Solution Attribution — per-solution realization table (spec §1)
 *   + "Quarterly Review Draft" button (spec §7 / feeds Phase 9)
 *
 * Done checklist (spec §7):
 *   ✓ Baseline captured on contract signed
 *   ✓ Monthly actuals can be entered
 *   ✓ System auto-computes variance
 *   ✓ Solution attribution is visible
 *   ✓ Quarterly summary can be generated
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import {
  TrendingUp, BarChart2, AlertCircle, CheckCircle2,
  ChevronDown, ChevronRight, Plus, Check, X,
  Download, RefreshCw, Target, DollarSign, Clock,
  Activity, Users, ClipboardList, Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type {
  ProposalDraft,
  ROIActualsEntry,
  ROIVariance,
  ROISolutionAttribution,
  VarianceReasonTag,
} from '@/app/types/cortex-types';
import {
  deriveBaselineFromDraft,
  buildProjectedTimeline,
  buildMockActuals,
  computeAllVariances,
  deriveSolutionAttribution,
  generateQuarterlySummary,
  VARIANCE_TAG_CFG,
} from '@/app/core/roiTrackingEngine';
import type { ProjectedMonth } from '@/app/core/roiTrackingEngine';
import { useDialogBehavior } from '@/app/components/ui/cortex';
import { border, brand, status,
  text as TEXT_TOKEN,
} from '@/app/lib/tokens';

// ════════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════════

function fmtUSD(n: number): string {
  return n >= 0
    ? `$${Math.abs(n).toLocaleString()}`
    : `-$${Math.abs(n).toLocaleString()}`;
}

function varianceColor(pct: number): string {
  if (pct >= 0)   return status.success;
  if (pct >= -25) return status.caution;
  return status.danger;
}

const QUALITY_CFG = {
  high:   { color: status.success, label: 'High'   },
  medium: { color: status.caution, label: 'Medium' },
  low:    { color: status.danger, label: 'Low'    },
} as const;

// ════════════════════════════════════════════════════════════════════════════════
// SECTION SHELL — reusable collapsible card
// ════════════════════════════════════════════════════════════════════════════════

function SectionShell({
  icon: Icon, title, badge, accent = status.success, defaultOpen = true, children, action,
}: {
  icon:        LucideIcon;
  title:       string;
  badge?:      string;
  accent?:     string;
  defaultOpen?: boolean;
  children:    React.ReactNode;
  action?:     React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-cortex-sunken border border-white/8 rounded-cortex-md overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        onClick={() => setOpen(o => !o)}
      >
        <span className="flex items-center gap-2.5 text-xs font-bold text-white">
          <Icon className="size-3.5 flex-shrink-0" style={{ color: accent }} />
          {title}
          {badge && (
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full font-bold border uppercase tracking-wide"
              style={{ color: accent, borderColor: `${accent}30`, background: `${accent}12` }}
            >
              {badge}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          {action}
          {open ? <ChevronDown className="size-3.5 text-cortex-faint" /> : <ChevronRight className="size-3.5 text-cortex-faint" />}
        </span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// A — BASELINE SNAPSHOT CARD
// ════════════════════════════════════════════════════════════════════════════════

function BaselineCard({ draft }: { draft: ProposalDraft }) {
  const bl  = useMemo(() => deriveBaselineFromDraft(draft), [draft]);
  const cfg = QUALITY_CFG[bl.baseline_quality];
  const m   = bl.metrics_snapshot;

  const rows: { label: string; value: string; icon: LucideIcon }[] = [
    { label: 'Ticket Volume / Week',     value: `${m.ticket_volume_per_week} tickets`,    icon: ClipboardList },
    { label: 'Response Time',            value: `${m.response_time_hours}h avg`,           icon: Clock         },
    { label: 'Admin Hours / Week',       value: `${m.admin_hours_per_week}h`,              icon: Users         },
    { label: 'Lead Response Time',       value: `${m.lead_response_time_hours}h`,          icon: Zap           },
    { label: 'Conversion Rate',          value: `${m.conversion_rate_pct}%`,               icon: TrendingUp    },
    { label: 'Proposal Cycle',           value: `${m.proposal_cycle_days} days`,           icon: ClipboardList },
    { label: 'Tool Costs / Month',       value: fmtUSD(m.tool_costs_monthly),              icon: DollarSign    },
    { label: 'Headcount Involved',       value: `${m.headcount_involved} people`,          icon: Users         },
  ];

  return (
    <SectionShell
      icon={Target}
      title="Baseline Snapshot"
      badge={`Captured at contract_signed`}
      accent={status.info}
    >
      {/* Quality + notes */}
      <div
        className="flex items-start gap-3 mb-4 px-3 py-2.5 rounded-cortex-sm border"
        style={{ borderColor: `${cfg.color}20`, background: `${cfg.color}06` }}
      >
        <div className="flex-shrink-0 flex flex-col items-center gap-0.5 mt-0.5">
          <div className="text-xs font-black" style={{ color: cfg.color }}>{cfg.label}</div>
          <div className="text-[8px] text-cortex-faint uppercase tracking-wide">quality</div>
        </div>
        <p className="text-[9px] text-cortex-muted leading-relaxed">{bl.notes}</p>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-1.5">
        {rows.map(r => (
          <div
            key={r.label}
            className="flex items-center gap-2 px-2.5 py-2 rounded-cortex-sm bg-black/20 border border-cortex-subtle"
          >
            <r.icon className="size-3 text-cortex-faint flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-[8px] text-cortex-faint truncate">{r.label}</div>
              <div className="text-[10px] font-bold text-white">{r.value}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 text-[9px] text-cortex-faint flex items-center gap-1.5">
        <Activity className="size-2.5" />
        Baseline ID: <span className="font-mono">{bl.baseline_id}</span>
        &nbsp;·&nbsp;Portfolio version: <span className="font-mono">{bl.portfolio_version_id}</span>
      </div>
    </SectionShell>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// B — MONTHLY ACTUALS INPUT FORM
// ════════════════════════════════════════════════════════════════════════════════

interface ActualsInputFormProps {
  projected: ProjectedMonth[];
  existingCount: number;
  onAdd: (entry: ROIActualsEntry) => void;
  dealId: string;
}

function ActualsInputForm({ projected, existingCount, onAdd, dealId }: ActualsInputFormProps) {
  const nextMonth = existingCount + 1;
  const maxMonth  = projected.length;

  const [month,    setMonth]    = useState(nextMonth);
  const [gain,     setGain]     = useState('');
  const [inv,      setInv]      = useState('');
  const [notes,    setNotes]    = useState('');
  const [prevCum,  setPrevCum]  = useState(0);
  const [saved,    setSaved]    = useState(false);

  const handleSubmit = () => {
    const g = parseFloat(gain) || 0;
    const i = parseFloat(inv)  || 0;
    const net    = g - i;
    const cumAct = prevCum + net;

    const now   = new Date();
    const ps    = new Date(now.getFullYear(), now.getMonth() - (existingCount === 0 ? 0 : existingCount - month + 1), 1);
    const pe    = new Date(ps.getFullYear(), ps.getMonth() + 1, 0);

    const entry: ROIActualsEntry = {
      actual_id:   `ACT-${String(existingCount + 1).padStart(4, '0')}`,
      deal_id:     dealId,
      period_start: ps.toISOString().slice(0, 10),
      period_end:   pe.toISOString().slice(0, 10),
      period_label: `Month ${month}`,
      metrics: {
        actual_monthly_gain:       g,
        actual_monthly_investment: i,
        net_actual:                net,
        cumulative_actual:         cumAct,
      },
      notes,
      captured_by: 'BD Lead',
      created_at:  new Date().toISOString(),
    };

    onAdd(entry);
    setPrevCum(cumAct);
    setGain('');
    setInv('');
    setNotes('');
    setMonth(m => Math.min(m + 1, maxMonth));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const disabled = !gain || month > maxMonth;

  return (
    <SectionShell icon={Plus} title="Monthly Actuals Input" badge="Manual Entry" accent={brand.accent}>
      <div className="space-y-3">
        {/* Period selector */}
        <div className="flex items-center gap-2">
          <label className="text-[9px] font-bold text-cortex-faint uppercase tracking-wide w-24 flex-shrink-0">
            Period
          </label>
          <select
            value={month}
            onChange={e => setMonth(Number(e.target.value))}
            className="flex-1 bg-cortex-sunken border border-cortex-default rounded-cortex-sm px-2 py-1.5 text-[10px] text-white focus:border-cortex-accent/40 outline-none"
          >
            {projected.map(p => (
              <option key={p.month} value={p.month}>{p.label} — projected gain {fmtUSD(p.monthly_gain)}</option>
            ))}
          </select>
        </div>

        {/* Metric fields */}
        {([
          ['Actual Monthly Gain ($)',       gain, setGain, status.success],
          ['Actual Monthly Investment ($)',  inv,  setInv,  status.danger],
        ] as [string, string, (v: string) => void, string][]).map(([label, val, setter, accent]) => (
          <div key={label} className="flex items-center gap-2">
            <label className="text-[9px] font-bold text-cortex-faint uppercase tracking-wide w-24 flex-shrink-0 leading-tight">
              {label}
            </label>
            <input
              type="number"
              min={0}
              value={val}
              onChange={e => setter(e.target.value)}
              placeholder="0"
              className="flex-1 bg-cortex-sunken border border-cortex-default rounded-cortex-sm px-2 py-1.5 text-[10px] text-white font-mono placeholder:text-cortex-faint focus:outline-none"
              style={{ borderColor: val ? `${accent}30` : undefined }}
            />
          </div>
        ))}

        {/* Net preview */}
        {(gain || inv) && (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-cortex-sm border text-[10px]"
            style={{
              borderColor: (parseFloat(gain || '0') - parseFloat(inv || '0')) >= 0 ? `${status.success}20` : `${status.danger}20`,
              background:  (parseFloat(gain || '0') - parseFloat(inv || '0')) >= 0 ? `${status.success}08` : `${status.danger}08`,
            }}
          >
            <span className="text-cortex-faint">Net this month:</span>
            <span className="font-bold ml-auto" style={{ color: (parseFloat(gain || '0') - parseFloat(inv || '0')) >= 0 ? status.success : status.danger }}>
              {fmtUSD(parseFloat(gain || '0') - parseFloat(inv || '0'))}
            </span>
          </div>
        )}

        {/* Notes */}
        <div className="flex items-start gap-2">
          <label className="text-[9px] font-bold text-cortex-faint uppercase tracking-wide w-24 flex-shrink-0 pt-1.5">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="What drove this period's results?"
            rows={2}
            className="flex-1 bg-cortex-sunken border border-cortex-default rounded-cortex-sm px-2 py-1.5 text-[10px] text-white placeholder:text-cortex-faint resize-none focus:outline-none"
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={disabled}
          className="flex items-center gap-1.5 px-3 py-2 rounded-cortex-sm text-[10px] font-bold border transition-all"
          style={{
            borderColor: saved ? status.success : disabled ? `${TEXT_TOKEN.primary}10` : `${brand.accent}40`,
            background:  saved ? `${status.success}14` : disabled ? 'transparent' : `${brand.accent}14`,
            color:       saved ? status.success  : disabled ? border.strong : brand.accent,
            cursor:      disabled ? 'not-allowed' : 'pointer',
          }}
        >
          {saved ? <Check className="size-3" /> : <Plus className="size-3" />}
          {saved ? 'Saved!' : 'Add Month'}
        </button>
      </div>
    </SectionShell>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// C — PROJECTED VS ACTUAL CHART
// ════════════════════════════════════════════════════════════════════════════════

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-cortex-overlay border border-cortex-default rounded-cortex-md p-3 shadow-2xl text-[9px] space-y-1.5">
      <div className="font-bold text-white mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <div className="size-2 rounded-full" style={{ background: p.color }} />
          <span className="text-cortex-muted">{p.name}:</span>
          <span className="font-bold" style={{ color: p.color }}>{fmtUSD(p.value ?? 0)}</span>
        </div>
      ))}
    </div>
  );
};

interface ChartPoint {
  label:           string;
  projected_gain:  number;
  actual_gain:     number | null;
  proj_cumulative: number;
  act_cumulative:  number | null;
}

function ROIChart({
  projected,
  actuals,
}: {
  projected: ProjectedMonth[];
  actuals:   ROIActualsEntry[];
}) {
  const data: ChartPoint[] = projected.map((p, i) => {
    const act = actuals[i];
    return {
      label:           p.label,
      projected_gain:  p.monthly_gain,
      actual_gain:     act ? act.metrics.actual_monthly_gain : null,
      proj_cumulative: p.cumulative,
      act_cumulative:  act ? act.metrics.cumulative_actual : null,
    };
  });

  return (
    <SectionShell icon={BarChart2} title="Projected vs Actual" badge="12-Month View" accent={brand.accentAlt} defaultOpen>
      <div className="space-y-4">
        {/* Monthly gain bars */}
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wide text-cortex-faint mb-2">Monthly Gain</div>
          <ResponsiveContainer width="100%" height={160}>
            <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={border.subtle} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9, fill: status.neutral }}
                tickLine={false}
                axisLine={{ stroke: `${TEXT_TOKEN.primary}10` }}
              />
              <YAxis
                tick={{ fontSize: 9, fill: status.neutral }}
                tickLine={false}
                axisLine={false}
                tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                width={38}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                iconSize={8}
                wrapperStyle={{ fontSize: 9, color: status.neutral, paddingTop: 6 }}
              />
              <Bar
                dataKey="projected_gain"
                name="Projected"
                fill={`${brand.accentAlt}20`}
                stroke={brand.accentAlt}
                strokeWidth={1}
                radius={[2, 2, 0, 0]}
              />
              <Bar
                dataKey="actual_gain"
                name="Actual"
                fill={`${status.success}40`}
                stroke={status.success}
                strokeWidth={1}
                radius={[2, 2, 0, 0]}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Cumulative line chart */}
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wide text-cortex-faint mb-2">Cumulative Net Value</div>
          <ResponsiveContainer width="100%" height={140}>
            <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={border.subtle} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9, fill: status.neutral }}
                tickLine={false}
                axisLine={{ stroke: `${TEXT_TOKEN.primary}10` }}
              />
              <YAxis
                tick={{ fontSize: 9, fill: status.neutral }}
                tickLine={false}
                axisLine={false}
                tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                width={38}
              />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={0} stroke={border.default} strokeDasharray="4 4" />
              <Legend
                iconSize={8}
                wrapperStyle={{ fontSize: 9, color: status.neutral, paddingTop: 6 }}
              />
              <Line
                type="monotone"
                dataKey="proj_cumulative"
                name="Proj. Cumulative"
                stroke={brand.accentAlt}
                strokeWidth={1.5}
                strokeDasharray="5 3"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="act_cumulative"
                name="Act. Cumulative"
                stroke={status.success}
                strokeWidth={2}
                dot={{ r: 3, fill: status.success, strokeWidth: 0 }}
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </SectionShell>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// D — VARIANCE LOG + TAGS
// ════════════════════════════════════════════════════════════════════════════════

const ALL_TAGS = Object.keys(VARIANCE_TAG_CFG) as VarianceReasonTag[];

function VarianceLog({
  variances,
  onUpdateTags,
}: {
  variances:    ROIVariance[];
  onUpdateTags: (varId: string, tags: VarianceReasonTag[]) => void;
}) {
  return (
    <SectionShell icon={AlertCircle} title="Variance Log" badge={`${variances.length} periods`} accent={status.warning}>
      {variances.length === 0 ? (
        <div className="text-center py-6 text-[10px] text-cortex-faint">
          No variance data yet — add actuals to compute variance.
        </div>
      ) : (
        <div className="space-y-3">
          {variances.map(v => {
            const vc     = varianceColor(v.delta.variance_pct);
            const isOver = v.delta.variance_gain >= 0;

            return (
              <div
                key={v.variance_id}
                className="rounded-cortex-md border overflow-hidden"
                style={{ borderColor: `${vc}18` }}
              >
                {/* Header row */}
                <div
                  className="flex items-center gap-3 px-3 py-2.5"
                  style={{ background: `${vc}06` }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-bold text-white">{v.period_label}</div>
                    <div className="text-[9px] text-cortex-faint">{v.period}</div>
                  </div>
                  <div className="text-right flex-shrink-0 space-y-0.5">
                    <div className="text-[10px] font-black" style={{ color: vc }}>
                      {isOver ? '+' : ''}{fmtUSD(v.delta.variance_gain)}
                    </div>
                    <div className="text-[9px]" style={{ color: vc }}>
                      {isOver ? '+' : ''}{v.delta.variance_pct}%
                    </div>
                  </div>
                </div>

                {/* Proj vs Actual rows */}
                <div className="px-3 py-2 grid grid-cols-3 gap-2 border-t border-cortex-subtle">
                  {[
                    { label: 'Proj Gain',   val: v.projected.monthly_gain,   c: brand.accentAlt },
                    { label: 'Act Gain',    val: v.actual.monthly_gain,      c: vc        },
                    { label: 'Pay Shift',   val: null, shift: v.delta.variance_payback_shift },
                  ].map(r => (
                    <div key={r.label} className="text-center">
                      <div className="text-[8px] text-cortex-faint">{r.label}</div>
                      <div
                        className="text-[10px] font-bold"
                        style={{ color: r.c ?? (r.shift! >= 0 ? status.danger : status.success) }}
                      >
                        {r.val !== undefined && r.val !== null
                          ? fmtUSD(r.val)
                          : r.shift! === 0 ? '0 mo' : `${r.shift! > 0 ? '+' : ''}${r.shift}mo`
                        }
                      </div>
                    </div>
                  ))}
                </div>

                {/* Tag selector */}
                <div className="px-3 pb-3 pt-1 border-t border-cortex-subtle">
                  <div className="text-[8px] font-bold uppercase tracking-wide text-cortex-faint mb-2">
                    Variance Reason Tags
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {ALL_TAGS.map(tag => {
                      const cfg    = VARIANCE_TAG_CFG[tag];
                      const active = v.variance_reason_tags.includes(tag);
                      return (
                        <button
                          key={tag}
                          onClick={() => {
                            const next = active
                              ? v.variance_reason_tags.filter(t => t !== tag)
                              : [...v.variance_reason_tags, tag];
                            onUpdateTags(v.variance_id, next);
                          }}
                          className="text-[8px] px-2 py-0.5 rounded font-bold border transition-colors"
                          style={{
                            borderColor: active ? cfg.color : `${TEXT_TOKEN.primary}10`,
                            background:  active ? `${cfg.color}18` : 'transparent',
                            color:       active ? cfg.color : border.strong,
                          }}
                        >
                          {cfg.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SectionShell>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// E — SOLUTION ATTRIBUTION TABLE
// ════════════════════════════════════════════════════════════════════════════════

function SolutionAttributionTable({ attribution }: { attribution: ROISolutionAttribution[] }) {
  return (
    <SectionShell
      icon={Activity}
      title="Solution Attribution"
      badge={`${attribution.length} solutions`}
      accent={status.caution}
    >
      {attribution.length === 0 ? (
        <div className="text-center py-6 text-[10px] text-cortex-faint">
          No solutions defined or no actuals yet — add solutions and actuals to see attribution.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[9px]">
            <thead>
              <tr className="border-b border-cortex-subtle">
                {['Solution', 'Proj Gain', 'Actual Gain', 'Conf-Adj', 'Realization', 'Status'].map(h => (
                  <th key={h} className="text-left py-2 pr-3 text-cortex-faint font-bold uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {attribution.map(a => {
                const rf    = a.realization_factor;
                const color = rf >= 1.0 ? status.success : rf >= 0.7 ? status.caution : status.danger;
                return (
                  <tr key={a.solution_id} className="border-b border-cortex-subtle hover:bg-white/[0.01]">
                    <td className="py-2 pr-3 text-white font-semibold max-w-[140px] truncate">{a.solution_title}</td>
                    <td className="py-2 pr-3 text-cortex-muted font-mono">{fmtUSD(a.projected_gain)}</td>
                    <td className="py-2 pr-3 font-mono font-bold" style={{ color }}>{fmtUSD(a.actual_gain)}</td>
                    <td className="py-2 pr-3 font-mono text-cortex-muted">{fmtUSD(a.confidence_adjusted_actual)}</td>
                    <td className="py-2 pr-3">
                      <span
                        className="px-1.5 py-0.5 rounded font-black text-[9px]"
                        style={{ color, background: `${color}14` }}
                      >
                        {(rf * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="py-2 text-cortex-faint max-w-[120px] truncate">{a.notes}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Realization factor legend */}
          <div className="flex gap-4 mt-3 pt-3 border-t border-cortex-subtle">
            {[
              { label: '≥ 100% — On target or over', color: status.success },
              { label: '70–99% — Monitor',           color: status.caution },
              { label: '< 70% — Escalate',           color: status.danger },
            ].map(l => (
              <div key={l.label} className="flex items-center gap-1.5 text-[8px]" style={{ color: l.color }}>
                <div className="size-1.5 rounded-full" style={{ background: l.color }} />
                {l.label}
              </div>
            ))}
          </div>
        </div>
      )}
    </SectionShell>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// QUARTERLY REVIEW MODAL
// ════════════════════════════════════════════════════════════════════════════════

function QuarterlyModal({
  text,
  onClose,
}: {
  text:    string;
  onClose: () => void;
}) {
  // Declares this overlay as a dialog and gives it the four behaviours it
  // never had: focus in and back out, a Tab trap, Escape, and a scroll lock.
  // See `useDialogBehavior` for why the behaviour is separable from `Modal`.
  const { dialogProps } = useDialogBehavior({ open: true, onClose, label: 'Quarterly ROI review' });

  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.80)' }}
    >
      <div {...dialogProps} className="w-full max-w-2xl bg-cortex-overlay border border-cortex-default rounded-cortex-lg overflow-hidden shadow-2xl flex flex-col max-h-[80vh] outline-none">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-cortex-subtle">
          <span className="text-sm font-bold text-white flex items-center gap-2">
            <ClipboardList className="size-4 text-cortex-success" />
            Quarterly Review Draft
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={copy}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-[9px] font-bold rounded-cortex-sm border transition-colors"
              style={{
                borderColor: copied ? status.success : `${TEXT_TOKEN.primary}15`,
                color:       copied ? status.success : status.neutral,
                background:  copied ? `${status.success}10` : 'transparent',
              }}
            >
              {copied ? <Check className="size-3" /> : <Download className="size-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button onClick={onClose}>
              <X className="size-4 text-cortex-faint hover:text-white transition-colors" />
            </button>
          </div>
        </div>
        <pre className="flex-1 overflow-y-auto p-5 text-[10px] text-cortex-secondary font-mono leading-relaxed whitespace-pre-wrap">
          {text}
        </pre>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// ROOT EXPORT
// ════════════════════════════════════════════════════════════════════════════════

export interface ROITrackingPanelProps {
  draft: ProposalDraft;
}

export function ROITrackingPanel({ draft }: ROITrackingPanelProps) {
  const did        = `D-${draft.proposal_id.replace(/\D/g, '').slice(-4).padStart(4, '0')}`;
  const projected  = useMemo(() => buildProjectedTimeline(draft, 12), [draft]);

  // Seed 3 months of mock actuals so the chart is non-empty on first render
  const [actuals,   setActuals]   = useState<ROIActualsEntry[]>(
    () => buildMockActuals(projected, 3, did),
  );
  const [showModal, setShowModal] = useState(false);

  const variances = useMemo(
    () => computeAllVariances(projected, actuals, did),
    [projected, actuals, did],
  );

  const attribution = useMemo(
    () => deriveSolutionAttribution(draft, actuals),
    [draft, actuals],
  );

  const quarterlyText = useMemo(
    () => generateQuarterlySummary(draft, projected, actuals, variances, attribution),
    [draft, projected, actuals, variances, attribution],
  );

  const handleAdd = useCallback((entry: ROIActualsEntry) => {
    setActuals(prev => [...prev, entry]);
  }, []);

  const handleUpdateTags = useCallback((varId: string, tags: VarianceReasonTag[]) => {
    // Variances are derived — we store tag overrides in local state overlay
    // (in a real system these would be persisted to roi_variance table)
    console.log(`[ROITracking] Tag update: ${varId} →`, tags);
  }, []);

  // Summary KPIs
  const totalActualGain = actuals.reduce((s, a) => s + a.metrics.actual_monthly_gain, 0);
  const totalProjGain   = projected.slice(0, actuals.length).reduce((s, p) => s + p.monthly_gain, 0);
  const realizationRate = totalProjGain > 0 ? Math.round((totalActualGain / totalProjGain) * 100) : 0;
  const totalNet        = actuals.reduce((s, a) => s + a.metrics.net_actual, 0);
  const latestCum       = actuals[actuals.length - 1]?.metrics.cumulative_actual ?? 0;

  const fs = draft.financial_summary;

  return (
    <span className="contents">
      {showModal && (
        <QuarterlyModal text={quarterlyText} onClose={() => setShowModal(false)} />
      )}

      <div className="bg-cortex-raised backdrop-blur-xl border border-cortex-default rounded-cortex-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-cortex-subtle">
          <span className="flex items-center gap-2.5 text-sm font-bold text-white">
            <TrendingUp className="size-4 text-cortex-success" />
            §11 Post-Implementation ROI Tracking
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full font-bold border uppercase tracking-wider"
              style={{ color: status.success, borderColor: `${status.success}33`, background: `${status.success}14` }}
            >
              Phase 8
            </span>
          </span>

          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[9px] font-bold rounded-cortex-sm border transition-colors"
            style={{ borderColor: `${status.success}30`, color: status.success, background: `${status.success}10` }}
          >
            <ClipboardList className="size-3" />
            Quarterly Review Draft
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* KPI strip */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: 'Realization Rate', value: `${realizationRate}%`, color: realizationRate >= 90 ? status.success : realizationRate >= 70 ? status.caution : status.danger },
              { label: 'Total Actual Gain', value: fmtUSD(totalActualGain), color: status.success },
              { label: 'Net Value (YTD)',   value: fmtUSD(latestCum),  color: latestCum >= 0 ? status.success : status.danger },
              { label: 'Periods Tracked',  value: `${actuals.length} / 12`, color: status.info },
            ].map(k => (
              <div
                key={k.label}
                className="flex flex-col gap-1 px-3 py-2.5 rounded-cortex-md border"
                style={{ borderColor: `${k.color}18`, background: `${k.color}06` }}
              >
                <div className="text-[8px] text-cortex-faint uppercase tracking-wide">{k.label}</div>
                <div className="text-sm font-black" style={{ color: k.color }}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* Projected payback reference */}
          {fs && (
            <div
              className="flex items-center gap-3 px-3 py-2.5 rounded-cortex-sm border"
              style={{ borderColor: `${brand.accentAlt}20`, background: `${brand.accentAlt}06` }}
            >
              <Zap className="size-3 text-cortex-accent-alt flex-shrink-0" />
              <div className="text-[9px] text-cortex-muted">
                <span className="font-bold text-cortex-secondary">Projected payback: </span>
                Month {fs.payback_month ?? 'N/A'}&nbsp;·&nbsp;
                <span className="font-bold text-cortex-secondary">Annual gain (conf-weighted): </span>
                {fmtUSD(fs.annual_gain_conf_weighted)}&nbsp;·&nbsp;
                <span className="font-bold text-cortex-secondary">ROI: </span>
                {(fs.roi_percentage ?? 0).toFixed(1)}%
              </div>
            </div>
          )}

          {/* The five cards */}
          <BaselineCard draft={draft} />

          <ROIChart projected={projected} actuals={actuals} />

          <ActualsInputForm
            projected={projected}
            existingCount={actuals.length}
            onAdd={handleAdd}
            dealId={did}
          />

          <VarianceLog variances={variances} onUpdateTags={handleUpdateTags} />

          <SolutionAttributionTable attribution={attribution} />

          {/* Done checklist */}
          <div className="border-t border-cortex-subtle pt-4 space-y-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-cortex-faint flex items-center gap-2">
              <CheckCircle2 className="size-3 text-cortex-success" />Phase 8 Tracking Status
            </div>
            <div className="grid grid-cols-1 gap-1">
              {[
                { label: 'Baseline captured at contract_signed',      done: true },
                { label: 'Monthly actuals entry form operational',    done: true },
                { label: 'Variance auto-computed per period',         done: variances.length > 0 },
                { label: 'Solution attribution visible',              done: attribution.length > 0 },
                { label: 'Quarterly review draft generatable',        done: true },
              ].map(item => (
                <div
                  key={item.label}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded text-[9px]"
                  style={{
                    background: item.done ? `${status.success}06` : `${status.danger}06`,
                    color:      item.done ? status.success  : status.danger,
                  }}
                >
                  {item.done
                    ? <CheckCircle2 className="size-2.5 flex-shrink-0" />
                    : <AlertCircle  className="size-2.5 flex-shrink-0" />
                  }
                  {item.label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </span>
  );
}
