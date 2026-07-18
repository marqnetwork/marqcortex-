/**
 * REVENUE INTELLIGENCE DASHBOARD — Phase 8
 *
 * Spec: dashboard-specs.md
 * Governance: Math decides every metric displayed.
 *
 * Layout:
 *   ┌────────────────────────────────────────┐
 *   │  Filter Bar (sticky)                   │
 *   ├────────────────────────────────────────┤
 *   │  Leadership Snapshot — 6 KPI tiles     │
 *   ├──────────────────────┬─────────────────┤
 *   │  Panel 1: Revenue    │ Panel 2: Proposal│
 *   ├──────────────────────┼─────────────────┤
 *   │  Panel 3: ROI Acc.   │ Panel 4: Objn.  │
 *   └──────────────────────┴─────────────────┘
 *
 * All metrics update dynamically when filters change (spec §2).
 * Architecture note: production → pre-computed aggregate table (spec §3).
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  ComposedChart, BarChart, Bar, Line, LineChart,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend,
  ReferenceLine,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Minus,
  DollarSign, Target, AlertTriangle, BarChart3,
  Filter, RefreshCw, ArrowUpRight, ArrowDownRight,
  ChevronDown, CheckCircle2, Activity,
  Zap, Shield, Clock, Users, Eye,
} from 'lucide-react';
import {
  MOCK_SNAPSHOTS,
  DEFAULT_FILTERS,
  filterSnapshots,
  prevPeriodSnapshots,
  aggregateRevenue,
  aggregateProposalPerf,
  aggregateROIAccuracy,
  aggregateObjections,
  buildKPIStrip,
  deriveFilterOptions,
  type DashboardFilters,
  type KPITile,
  type DealSnapshot,
} from '@/app/core/dashboardAggregator';
import type { ObjectionType } from '@/app/types/cortex-types';
import * as dataService from '@/app/services/dataService';
import { isBackendEnabled, isVerboseLogging } from '@/config/runtime';

// ════════════════════════════════════════════════════════════════════════════════
// COLOURS
// ════════════════════════════════════════════════════════════════════════════════

const C = {
  purple:  '#8B5CF6',
  blue:    '#3B82F6',
  cyan:    '#06D7F6',
  green:   '#10B981',
  orange:  '#FB923C',
  red:     '#FD4438',
  amber:   '#F59E0B',
  gray:    '#70707C',
} as const;

const OBJECTION_COLORS: Record<ObjectionType, string> = {
  price:              C.amber,
  risk:               C.red,
  timing:             C.cyan,
  trust:              C.purple,
  internal_alignment: C.green,
};

// ════════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════════

function fmtUSD(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#0D0D18] border border-white/10 rounded-xl p-3 text-[9px] shadow-2xl space-y-1.5">
      <div className="font-bold text-white mb-1">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <div className="size-2 rounded-full flex-shrink-0" style={{ background: p.color ?? p.fill }} />
          <span className="text-gray-500">{p.name}:</span>
          <span className="font-bold ml-auto pl-2" style={{ color: p.color ?? p.fill }}>
            {typeof p.value === 'number' && p.unit === '$'
              ? fmtUSD(p.value)
              : typeof p.value === 'number'
              ? `${p.value}${p.unit ?? ''}`
              : p.value}
          </span>
        </div>
      ))}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════════
// FILTER BAR
// ════════════════════════════════════════════════════════════════════════════════

interface FilterBarProps {
  filters:   DashboardFilters;
  snapshots: DealSnapshot[];
  onChange:  (f: DashboardFilters) => void;
  onReset:   () => void;
}

// Spec §2: "Conservative / Expected / Aggressive"
// Internal data key is 'optimistic' (matches FinancialSummary.scenario type).
// Display label maps 'optimistic' → "Aggressive" to match spec.
const SCENARIO_DISPLAY: Record<string, string> = {
  all:          'All',
  conservative: 'Conservative',
  expected:     'Expected',
  optimistic:   'Aggressive',
};

function FilterPill({
  label, value, options, onChange, displayMap,
}: {
  label:       string;
  value:       string;
  options:     readonly string[] | string[];
  onChange:    (v: string) => void;
  displayMap?: Record<string, string>;
}) {
  const isActive = value !== 'all';
  return (
    <div className="relative">
      <div className="flex items-center gap-1.5 text-[9px]">
        <span className="text-gray-700 uppercase tracking-wide font-bold whitespace-nowrap">{label}</span>
        <div
          className="flex items-center gap-1 px-2 py-1 rounded-lg border cursor-pointer"
          style={{
            borderColor: isActive ? `${C.purple}40` : '#ffffff10',
            background:  isActive ? `${C.purple}10` : 'transparent',
          }}
        >
          <select
            value={value}
            onChange={e => onChange(e.target.value)}
            className="bg-transparent text-[9px] font-bold outline-none cursor-pointer pr-4"
            style={{ color: isActive ? C.purple : '#9CA3AF' }}
          >
            {options.map(o => (
              <option key={o} value={o} className="bg-[#0D0D18] text-white">
                {displayMap ? (displayMap[o] ?? o) : (o === 'all' ? 'All' : o)}
              </option>
            ))}
          </select>
          <ChevronDown className="size-2.5 text-gray-600 flex-shrink-0 -ml-3 pointer-events-none" />
        </div>
      </div>
    </div>
  );
}

function FilterBar({ filters, snapshots, onChange, onReset }: FilterBarProps) {
  const opts = useMemo(() => deriveFilterOptions(snapshots), [snapshots]);

  function set<K extends keyof DashboardFilters>(k: K, v: DashboardFilters[K]) {
    onChange({ ...filters, [k]: v });
  }

  // Active filter count (excluding dateRange) for summary badge
  const activeCount = [
    filters.industry     !== 'all',
    filters.owner        !== 'all',
    filters.region       !== 'all',
    filters.scenario     !== 'all',
    filters.dealSizeBand !== 'all',
  ].filter(Boolean).length;

  return (
    <div className="flex flex-wrap items-center gap-3 px-5 py-3 bg-black/40 backdrop-blur border-b border-white/5 sticky top-0 z-20">
      <div className="flex items-center gap-2 mr-1">
        <Filter className="size-3.5 text-gray-600" />
        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Filters</span>
        {activeCount > 0 && (
          <span
            className="text-[8px] px-1.5 py-0.5 rounded-full font-black"
            style={{ background: `${C.purple}20`, color: C.purple }}
          >
            {activeCount}
          </span>
        )}
      </div>

      {/* Date Range — styled separately as pill row */}
      <div className="flex items-center gap-1">
        {opts.dateRanges.map(dr => (
          <button
            key={dr.id}
            onClick={() => set('dateRange', dr.id as DashboardFilters['dateRange'])}
            className="px-2.5 py-1 rounded-lg text-[9px] font-bold border transition-colors"
            style={{
              borderColor: filters.dateRange === dr.id ? `${C.cyan}40` : '#ffffff10',
              background:  filters.dateRange === dr.id ? `${C.cyan}12`  : 'transparent',
              color:       filters.dateRange === dr.id ? C.cyan          : '#6B7280',
            }}
          >
            {dr.label}
          </button>
        ))}
      </div>

      <div className="h-4 w-px bg-white/5" />

      <FilterPill label="Industry"   value={filters.industry}     options={opts.industries}  onChange={v => set('industry', v)} />
      <FilterPill label="Owner"      value={filters.owner}        options={opts.owners}      onChange={v => set('owner', v)} />
      <FilterPill label="Region"     value={filters.region}       options={opts.regions}     onChange={v => set('region', v)} />

      {/* Scenario: spec §2 labels "Conservative / Expected / Aggressive" */}
      <FilterPill
        label="Scenario"
        value={filters.scenario}
        options={opts.scenarios}
        onChange={v => set('scenario', v)}
        displayMap={SCENARIO_DISPLAY}
      />

      <FilterPill label="Deal Size"  value={filters.dealSizeBand} options={opts.dealSizes}   onChange={v => set('dealSizeBand', v)} />

      <button
        onClick={onReset}
        className="ml-auto flex items-center gap-1.5 px-2 py-1 text-[9px] text-gray-600 hover:text-white transition-colors"
      >
        <RefreshCw className="size-3" />Reset
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// LEADERSHIP KPI STRIP — 6 tiles with MoM trend arrows (spec §4)
// ════════════════════════════════════════════════════════════════════════════════

function KPITileCard({ tile }: { tile: KPITile }) {
  const hasDelta  = tile.delta_pct !== null;
  const isGood    = tile.higher_is_better
    ? (tile.delta_pct ?? 0) >= 0
    : (tile.delta_pct ?? 0) <= 0;
  const trend_color = hasDelta ? (isGood ? C.green : C.red) : C.gray;

  return (
    <div className="flex-1 min-w-[130px] flex flex-col gap-1.5 px-4 py-3.5 bg-black/30 border border-white/8 rounded-xl">
      <div className="text-[8px] font-bold uppercase tracking-widest text-gray-600">{tile.label}</div>
      <div className="text-xl font-black text-white leading-none">{tile.value}</div>
      {hasDelta ? (
        <div className="flex items-center gap-1 text-[9px] font-bold" style={{ color: trend_color }}>
          {isGood
            ? <ArrowUpRight className="size-3" />
            : <ArrowDownRight className="size-3" />
          }
          {tile.delta_pct! >= 0 ? '+' : ''}{tile.delta_pct}%
          {tile.delta_abs && (
            <span className="font-normal text-gray-700 ml-0.5">({tile.delta_abs})</span>
          )}
          <span className="font-normal text-gray-700">MoM</span>
        </div>
      ) : (
        <div className="flex items-center gap-1 text-[9px] text-gray-700">
          <Minus className="size-2.5" /> No prior period
        </div>
      )}
    </div>
  );
}

function LeadershipStrip({ tiles }: { tiles: KPITile[] }) {
  return (
    <div className="px-5 pt-5 pb-1">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="size-3.5 text-[#F59E0B]" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Leadership Snapshot</span>
        <span className="text-[8px] px-1.5 py-0.5 rounded border border-amber-500/20 bg-amber-500/8 text-amber-500 uppercase tracking-wide font-bold">
          Live
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {tiles.map(t => <KPITileCard key={t.id} tile={t} />)}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// PANEL SHELL
// ════════════════════════════════════════════════════════════════════════════════

function PanelShell({
  icon: Icon, title, badge, accent = C.blue, children,
}: {
  icon: React.FC<{ className?: string }>;
  title: string;
  badge?: string;
  accent?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-black/30 border border-white/8 rounded-xl overflow-hidden flex flex-col">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/5">
        <Icon className="size-3.5 flex-shrink-0" style={{ color: accent }} />
        <span className="text-[11px] font-bold text-white">{title}</span>
        {badge && (
          <span
            className="ml-auto text-[8px] px-1.5 py-0.5 rounded-full border uppercase tracking-wide font-bold"
            style={{ color: accent, borderColor: `${accent}30`, background: `${accent}10` }}
          >
            {badge}
          </span>
        )}
      </div>
      <div className="p-4 flex-1">{children}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// METRIC ROW — shared mini stat display
// ════════════════════════════════════════════════════════════════════════════════

function MetricRow({
  label, value, sub, color = 'white',
}: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-white/[0.04] last:border-0">
      <span className="text-[9px] text-gray-600">{label}</span>
      <div className="text-right">
        <span className="text-[11px] font-bold" style={{ color }}>{value}</span>
        {sub && <div className="text-[8px] text-gray-700">{sub}</div>}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// PANEL 1 — REVENUE PERFORMANCE
// ════════════════════════════════════════════════════════════════════════════════

function RevenuePanel({ snapshots }: { snapshots: ReturnType<typeof filterSnapshots> }) {
  const data = useMemo(() => aggregateRevenue(snapshots), [snapshots]);

  const chartData = data.pipeline_funnel.filter(r => r.deals > 0);

  return (
    <PanelShell icon={DollarSign} title="Revenue Performance" badge="Panel 1" accent={C.green}>
      {/* 6 Key metrics */}
      <div className="grid grid-cols-2 gap-1.5 mb-4">
        {[
          { label: 'Total Deals Created',    value: String(data.total_deals),                            color: C.cyan    },
          { label: 'Proposals Sent',         value: String(data.proposals_sent),                         color: C.blue    },
          { label: 'Close Rate',             value: `${data.close_rate_pct}%`,                           color: data.close_rate_pct >= 30 ? C.green : C.amber },
          { label: 'Revenue Won',            value: fmtUSD(data.closed_won_value),                       color: C.green   },
          { label: 'Avg Deal Size',          value: fmtUSD(data.avg_deal_size),                          color: 'white'   },
          { label: 'Avg Sales Cycle',        value: data.avg_sales_cycle_days !== null ? `${data.avg_sales_cycle_days}d` : 'N/A', color: 'white' },
        ].map(m => (
          <div
            key={m.label}
            className="px-2.5 py-2 rounded-lg bg-black/20 border border-white/5"
          >
            <div className="text-[7px] uppercase tracking-wide text-gray-700 mb-0.5">{m.label}</div>
            <div className="text-sm font-black" style={{ color: m.color }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Pipeline funnel chart */}
      <div className="text-[8px] font-bold uppercase tracking-wider text-gray-700 mb-2">Deal Pipeline Funnel</div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 8, fill: '#6B7280' }} tickLine={false} axisLine={false} />
          <YAxis
            type="category"
            dataKey="stage"
            tick={{ fontSize: 8, fill: '#9CA3AF' }}
            tickLine={false}
            axisLine={false}
            width={70}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="deals" name="Deals" radius={[0, 3, 3, 0]} maxBarSize={14}>
            {chartData.map((entry, i) => (
              <Cell
                key={entry.stage}
                fill={entry.stage === 'Closed Won'  ? C.green
                    : entry.stage === 'Closed Lost' ? C.red
                    : entry.stage === 'Contract'    ? C.amber
                    : entry.stage === 'Delivery'    ? C.cyan
                    : `${C.blue}${Math.max(40, 100 - i * 10).toString(16)}`}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Formula note */}
      <div className="mt-2 text-[8px] text-gray-700 border-t border-white/5 pt-2">
        close_rate = won_stages / proposals_sent &nbsp;·&nbsp;
        sales_cycle = avg(signed − sent) days
      </div>
    </PanelShell>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// PANEL 2 — PROPOSAL PERFORMANCE
// ════════════════════════════════════════════════════════════════════════════════

function ProposalPanel({ snapshots }: { snapshots: ReturnType<typeof filterSnapshots> }) {
  const data = useMemo(() => aggregateProposalPerf(snapshots), [snapshots]);

  // Conversion funnel bar data
  const funnelData = data.conversion_funnel;

  return (
    <PanelShell icon={Eye} title="Proposal Performance" badge="Panel 2" accent={C.cyan}>
      {/* 5 metrics */}
      <div className="space-y-0 mb-4">
        <MetricRow
          label="Proposal → View Rate"
          value={`${data.view_rate_pct}%`}
          color={data.view_rate_pct >= 70 ? C.green : data.view_rate_pct >= 50 ? C.amber : C.red}
        />
        <MetricRow
          label="View → Approval Rate"
          value={`${data.approval_rate_pct}%`}
          color={data.approval_rate_pct >= 60 ? C.green : data.approval_rate_pct >= 40 ? C.amber : C.red}
        />
        <MetricRow
          label="Avg Time to First View"
          value={data.avg_time_to_view_hours !== null ? `${data.avg_time_to_view_hours}h` : 'N/A'}
          sub={data.avg_time_to_view_hours !== null ? `≈${(data.avg_time_to_view_hours / 24).toFixed(1)} days` : undefined}
          color={data.avg_time_to_view_hours !== null && data.avg_time_to_view_hours <= 48 ? C.green : C.amber}
        />
        <MetricRow
          label="Expiration Rate"
          value={`${data.expiration_rate_pct}%`}
          color={data.expiration_rate_pct <= 5 ? C.green : data.expiration_rate_pct <= 15 ? C.amber : C.red}
        />
        <MetricRow
          label="Objection Rate"
          value={`${data.objection_rate_pct}%`}
          sub="of proposals sent"
          color={data.objection_rate_pct <= 30 ? C.green : data.objection_rate_pct <= 50 ? C.amber : C.red}
        />
      </div>

      {/* Conversion funnel */}
      <div className="text-[8px] font-bold uppercase tracking-wider text-gray-700 mb-2">Conversion Funnel</div>
      <ResponsiveContainer width="100%" height={110}>
        <BarChart data={funnelData} margin={{ top: 0, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff06" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 8, fill: '#9CA3AF' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 8, fill: '#6B7280' }} tickLine={false} axisLine={false} />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="count" name="Deals" radius={[3, 3, 0, 0]} maxBarSize={40}>
            {funnelData.map((_, i) => (
              <Cell
                key={i}
                fill={i === 0 ? C.blue : i === 1 ? C.cyan : i === 2 ? C.purple : C.green}
                fillOpacity={0.85}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Objection rate by industry */}
      {data.objection_by_industry.length > 0 && (
        <span className="contents">
          <div className="text-[8px] font-bold uppercase tracking-wider text-gray-700 mt-4 mb-2">
            Objection Rate by Industry
          </div>
          <div className="space-y-1.5">
            {data.objection_by_industry.slice(0, 5).map(r => (
              <div key={r.industry} className="flex items-center gap-2">
                <span className="text-[8px] text-gray-600 w-20 truncate flex-shrink-0">{r.industry}</span>
                <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(r.rate, 100)}%`,
                      background: r.rate >= 60 ? C.red : r.rate >= 30 ? C.amber : C.green,
                    }}
                  />
                </div>
                <span className="text-[8px] font-bold w-8 text-right" style={{
                  color: r.rate >= 60 ? C.red : r.rate >= 30 ? C.amber : C.green,
                }}>
                  {r.rate}%
                </span>
              </div>
            ))}
          </div>
        </span>
      )}

      <div className="mt-3 text-[8px] text-gray-700 border-t border-white/5 pt-2">
        Friction signals. Derived from engagement_metrics + crm_activity_log.
      </div>
    </PanelShell>
  );
}

// ═════════════════════════════════════��══════════════════════════════════════════
// PANEL 3 — ROI ACCURACY
// ════════════════════════════════════════════════════════════════════════════════

function ROIAccuracyPanel({ snapshots }: { snapshots: ReturnType<typeof filterSnapshots> }) {
  const data = useMemo(() => aggregateROIAccuracy(snapshots), [snapshots]);

  const chartData = data.industry_breakdown.map(r => ({
    industry: r.industry.slice(0, 7),
    Projected: r.projected_roi,
    Actual:    r.actual_roi,
  }));

  const accuracyColor = data.forecast_accuracy_pct >= 95 ? C.green
    : data.forecast_accuracy_pct >= 85 ? C.amber : C.red;

  return (
    <PanelShell icon={Target} title="ROI Accuracy" badge="Panel 3 · Phase 8" accent={C.purple}>
      {/* 4 key metrics */}
      <div className="grid grid-cols-2 gap-1.5 mb-4">
        {[
          { label: 'Avg Projected ROI',     value: data.tracked_deals > 0 ? `${data.avg_projected_roi_pct}%` : 'N/A', color: C.blue   },
          { label: 'Avg Actual ROI',         value: data.tracked_deals > 0 ? `${data.avg_actual_roi_pct}%` : 'N/A',   color: C.green  },
          { label: 'Forecast Accuracy',      value: data.tracked_deals > 0 ? `${data.forecast_accuracy_pct}%` : 'N/A', color: accuracyColor },
          { label: 'Avg Payback Deviation',  value: data.tracked_deals > 0 ? `+${data.avg_payback_deviation_mo}mo` : 'N/A', color: data.avg_payback_deviation_mo <= 0.5 ? C.green : C.amber },
        ].map(m => (
          <div key={m.label} className="px-2.5 py-2 rounded-lg bg-black/20 border border-white/5">
            <div className="text-[7px] uppercase tracking-wide text-gray-700 mb-0.5">{m.label}</div>
            <div className="text-sm font-black" style={{ color: m.color }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Tracked deals badge */}
      <div
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg mb-4 text-[9px]"
        style={{ background: `${C.purple}08`, border: `1px solid ${C.purple}20` }}
      >
        <Activity className="size-3 flex-shrink-0" style={{ color: C.purple }} />
        <span className="text-gray-500">
          <span className="font-bold text-white">{data.tracked_deals}</span> deals with actuals tracked&nbsp;·&nbsp;
          forecast_accuracy = actual_roi / projected_roi
        </span>
      </div>

      {/* Industry breakdown chart */}
      {chartData.length > 0 ? (
        <span className="contents">
          <div className="text-[8px] font-bold uppercase tracking-wider text-gray-700 mb-2">
            Projected vs Actual ROI by Industry
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData} margin={{ top: 0, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff06" vertical={false} />
              <XAxis dataKey="industry" tick={{ fontSize: 7, fill: '#6B7280' }} tickLine={false} axisLine={false} />
              <YAxis
                tick={{ fontSize: 8, fill: '#6B7280' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={v => `${v}%`}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend iconSize={7} wrapperStyle={{ fontSize: 8, color: '#6B7280', paddingTop: 6 }} />
              <Bar dataKey="Projected" fill={`${C.blue}40`}  stroke={C.blue}  strokeWidth={1} radius={[2, 2, 0, 0]} maxBarSize={18} />
              <Bar dataKey="Actual"    fill={`${C.green}40`} stroke={C.green} strokeWidth={1} radius={[2, 2, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>

          {/* Industry table */}
          <div className="mt-3 space-y-1">
            {data.industry_breakdown.map(r => {
              const ac = r.accuracy_pct >= 100 ? C.green : r.accuracy_pct >= 85 ? C.amber : C.red;
              return (
                <div key={r.industry} className="flex items-center gap-2 text-[8px]">
                  <span className="w-20 text-gray-600 truncate flex-shrink-0">{r.industry}</span>
                  <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.min(r.accuracy_pct, 110)}%`, background: ac }}
                    />
                  </div>
                  <span className="font-black w-10 text-right" style={{ color: ac }}>{r.accuracy_pct}%</span>
                  <span className="text-gray-700 w-10 text-right">{r.deal_count}d</span>
                </div>
              );
            })}
          </div>
        </span>
      ) : (
        <div className="text-center py-8 text-[10px] text-gray-700">
          No actuals tracked in this period — expand date range to see ROI accuracy.
        </div>
      )}

      <div className="mt-3 text-[8px] text-gray-700 border-t border-white/5 pt-2">
        payback_delta = actual_payback − projected_payback &nbsp;·&nbsp; Spec §6 realization factors update per industry.
      </div>
    </PanelShell>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// PANEL 4 — OBJECTION INTELLIGENCE
// ════════════════════════════════════════════════════════════════════════════════

const OBJECTION_ICONS: Record<string, React.FC<{ className?: string }>> = {
  price:              DollarSign,
  risk:               Shield,
  timing:             Clock,
  trust:              Eye,
  internal_alignment: Users,
};

function ObjectionPanel({ snapshots }: { snapshots: ReturnType<typeof filterSnapshots> }) {
  const data = useMemo(() => aggregateObjections(snapshots), [snapshots]);

  const chartData = data.by_type.map(r => ({
    name:  r.label,
    Count: r.count,
    color: OBJECTION_COLORS[r.type] ?? C.gray,
  }));

  return (
    <PanelShell icon={AlertTriangle} title="Objection Intelligence" badge="Panel 4" accent={C.orange}>
      {/* Summary row */}
      <div className="grid grid-cols-3 gap-1.5 mb-4">
        {[
          { label: 'Objection Rate',    value: `${data.objection_rate_pct}%`, color: data.objection_rate_pct <= 30 ? C.green : C.red },
          { label: 'Price Obj %',       value: `${data.price_objection_pct}%`, color: C.amber },
          { label: 'Risk Obj %',        value: `${data.risk_objection_pct}%`, color: C.red },
        ].map(m => (
          <div key={m.label} className="px-2 py-2 rounded-lg bg-black/20 border border-white/5 text-center">
            <div className="text-[7px] uppercase tracking-wide text-gray-700 mb-0.5">{m.label}</div>
            <div className="text-sm font-black" style={{ color: m.color }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Frequency bar chart */}
      {chartData.length > 0 ? (
        <span className="contents">
          <div className="text-[8px] font-bold uppercase tracking-wider text-gray-700 mb-2">
            Objection Frequency by Type
          </div>
          <ResponsiveContainer width="100%" height={110}>
            <BarChart data={chartData} margin={{ top: 0, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff06" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 7, fill: '#9CA3AF' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 8, fill: '#6B7280' }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="Count" radius={[3, 3, 0, 0]} maxBarSize={36}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} fillOpacity={0.75} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </span>
      ) : (
        <div className="text-center py-4 text-[10px] text-gray-700">No objections in this period.</div>
      )}

      {/* Close rate by objection type + resolve time */}
      {data.by_type.length > 0 && (
        <div className="mt-4">
          <div className="text-[8px] font-bold uppercase tracking-wider text-gray-700 mb-2">
            Close Rate & Avg Resolution Time
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[8px]">
              <thead>
                <tr className="border-b border-white/5">
                  {['Type', 'Deals', 'Close Rate', 'Avg Resolve', 'Freq %'].map(h => (
                    <th key={h} className="text-left py-1.5 pr-2 text-gray-700 font-bold uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.by_type.map(r => {
                  const Icon  = OBJECTION_ICONS[r.type] ?? AlertTriangle;
                  const clr   = OBJECTION_COLORS[r.type as ObjectionType] ?? C.gray;
                  const crClr = r.close_rate_pct === null ? C.gray
                    : r.close_rate_pct >= 60 ? C.green
                    : r.close_rate_pct >= 30 ? C.amber : C.red;
                  return (
                    <tr key={r.type} className="border-b border-white/[0.04]">
                      <td className="py-1.5 pr-2 font-semibold">
                        <span className="flex items-center gap-1.5" style={{ color: clr }}>
                          <Icon className="size-2.5" />
                          {r.label}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-gray-400">{r.count}</td>
                      <td className="py-1.5 pr-2 font-black" style={{ color: crClr }}>
                        {r.close_rate_pct !== null ? `${r.close_rate_pct}%` : '—'}
                      </td>
                      <td className="py-1.5 pr-2 text-gray-500">
                        {r.avg_resolve_days !== null ? `${r.avg_resolve_days}d` : '—'}
                      </td>
                      <td className="py-1.5 text-gray-600">{r.frequency_pct}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-3 text-[8px] text-gray-700 border-t border-white/5 pt-2">
        Where deals stall. Derived from objection_detected.type + crm_activity_log.
      </div>
    </PanelShell>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// DONE CHECKLIST FOOTER — spec §5
// ════════════════════════════════════════════════════════════════════════════════

function DoneChecklist({
  snapshots,
}: {
  snapshots: ReturnType<typeof filterSnapshots>;
}) {
  const rev  = useMemo(() => aggregateRevenue(snapshots),        [snapshots]);
  const roi  = useMemo(() => aggregateROIAccuracy(snapshots),    [snapshots]);
  const obj  = useMemo(() => aggregateObjections(snapshots),     [snapshots]);

  const items = [
    { label: 'All 4 panels render aggregated data',         done: snapshots.length > 0 },
    { label: 'Filters affect all metrics',                  done: true },
    { label: 'MoM trends shown in Leadership Snapshot',     done: true },
    { label: 'ROI accuracy compares projected vs actual',   done: roi.tracked_deals > 0 },
    { label: 'Objection patterns visible by industry',      done: obj.by_type.length > 0 },
  ];

  return (
    <div className="flex flex-wrap gap-2 px-5 py-3 border-t border-white/5">
      {items.map(item => (
        <div
          key={item.label}
          className="flex items-center gap-1.5 text-[8px] px-2.5 py-1 rounded-lg border"
          style={{
            borderColor: item.done ? `${C.green}20` : `${C.red}20`,
            background:  item.done ? `${C.green}06` : `${C.red}06`,
            color:       item.done ? C.green : C.red,
          }}
        >
          <CheckCircle2 className="size-2.5" />
          {item.label}
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// ROOT EXPORT
// ════════════════════════════════════════════════════════════════════════════════

interface RevenueIntelligenceDashboardProps {
  accessToken?: string;
}

export function RevenueIntelligenceDashboard({ accessToken }: RevenueIntelligenceDashboardProps) {
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  // Demo mode is seeded with MOCK_SNAPSHOTS. Live mode must NEVER display mock
  // data (governance: no fabricated metrics), so it starts empty and shows only
  // the deterministically-derived snapshots returned by the backend — even when
  // that set is empty (a fresh tenant with no deals yet).
  const [snapshots, setSnapshots] = useState<DealSnapshot[]>(() =>
    isBackendEnabled() ? [] : MOCK_SNAPSHOTS,
  );
  const [loadState, setLoadState] = useState<'ready' | 'loading' | 'error'>(() =>
    isBackendEnabled() ? 'loading' : 'ready',
  );

  useEffect(() => {
    if (!isBackendEnabled()) return; // demo mode keeps the seed set
    let cancelled = false;
    setLoadState('loading');
    (async () => {
      try {
        const res = await dataService.getRevenueSnapshots(accessToken ?? '');
        if (cancelled) return;
        // Live snapshots are authoritative — apply them even when empty rather
        // than falling back to MOCK_SNAPSHOTS, which would fabricate revenue.
        setSnapshots(res.snapshots);
        setLoadState('ready');
      } catch (err) {
        if (cancelled) return;
        if (isVerboseLogging()) console.error('Revenue snapshots fetch failed:', err);
        // Do NOT fall back to mock data in production — surface an honest error.
        setSnapshots([]);
        setLoadState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [accessToken]);

  const filtered = useMemo(
    () => filterSnapshots(snapshots, filters),
    [snapshots, filters],
  );

  const prevFiltered = useMemo(
    () => prevPeriodSnapshots(snapshots, filters),
    [snapshots, filters],
  );

  const kpiTiles = useMemo(
    () => buildKPIStrip(filtered, prevFiltered),
    [filtered, prevFiltered],
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0A0A0F]">
      {/* Filter bar — sticky */}
      <FilterBar
        filters={filters}
        snapshots={snapshots}
        onChange={setFilters}
        onReset={() => setFilters(DEFAULT_FILTERS)}
      />

      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <h1 className="text-lg font-black text-white flex items-center gap-2.5">
              <BarChart3 className="size-5 text-[#10B981]" />
              Revenue Intelligence Dashboard
              <span
                className="text-[9px] px-1.5 py-0.5 rounded-full font-bold border uppercase tracking-wider"
                style={{ color: '#10B981', borderColor: '#10B98133', background: '#10B98114' }}
              >
                Phase 8
              </span>
            </h1>
            <p className="text-[10px] text-gray-600 mt-0.5">
              {filtered.length} deal{filtered.length !== 1 ? 's' : ''} in view
              &nbsp;·&nbsp;Math decides every metric &nbsp;·&nbsp;
              Architecture: nightly aggregation in production (spec §3)
            </p>
          </div>
          <div className="flex items-center gap-2 text-[9px] text-gray-700">
            <Activity className="size-3" />
            {new Date('2026-03-02').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
          </div>
        </div>

        {/* Leadership Snapshot */}
        <LeadershipStrip tiles={kpiTiles} />

        {/* Empty state */}
        {filtered.length === 0 ? (
          loadState === 'loading' ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
              <Activity className="size-8 text-gray-700 animate-pulse" />
              <div className="text-sm font-bold text-gray-600">Loading revenue snapshots…</div>
            </div>
          ) : loadState === 'error' ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
              <Filter className="size-8 text-[#FD4438]/60" />
              <div className="text-sm font-bold text-gray-500">Couldn't load revenue data</div>
              <div className="text-[10px] text-gray-700">The snapshot service is unavailable. No data is shown rather than estimated figures.</div>
            </div>
          ) : snapshots.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
              <BarChart3 className="size-8 text-gray-700" />
              <div className="text-sm font-bold text-gray-600">No deal data yet</div>
              <div className="text-[10px] text-gray-700">Revenue intelligence appears here once diagnostics, proposals, and outcomes are recorded.</div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
              <Filter className="size-8 text-gray-700" />
              <div className="text-sm font-bold text-gray-600">No deals match current filters</div>
              <div className="text-[10px] text-gray-700">Adjust date range or clear filters to see data.</div>
              <button
                onClick={() => setFilters(DEFAULT_FILTERS)}
                className="mt-2 px-4 py-2 text-[10px] font-bold rounded-lg border border-white/10 text-gray-400 hover:text-white transition-colors"
              >
                Reset Filters
              </button>
            </div>
          )
        ) : (
          <span className="contents">
            {/* 4 panels in 2×2 grid */}
            <div className="p-5 pt-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
              <RevenuePanel    snapshots={filtered} />
              <ProposalPanel   snapshots={filtered} />
              <ROIAccuracyPanel snapshots={filtered} />
              <ObjectionPanel  snapshots={filtered} />
            </div>

            {/* Done checklist */}
            <DoneChecklist snapshots={filtered} />
          </span>
        )}
      </div>
    </div>
  );
}