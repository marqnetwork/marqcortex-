/**
 * CORTEX LEARNING LOOP PANEL — Phase 10A
 *
 * Recharts-powered decision intelligence dashboard.
 *
 * Charts:
 *  • Win/Loss donut  — PieChart w/ custom center overlay
 *  • Loss Reasons    — horizontal BarChart + LabelList
 *  • Industry Rate   — horizontal BarChart, color-coded by win %
 *  • Score Band      — animated progress bars + insight callout
 *
 * Supplementary sections:
 *  • Recent Outcomes   — scrollable table (10 rows)
 *  • Improvement Areas — tag cloud, opacity scales with vote count
 *  • How CORTEX learns — always-visible explainer card
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip,
  ResponsiveContainer, LabelList,
} from 'recharts';
import {
  TrendingUp, TrendingDown, DollarSign, Target, Award,
  Clock, RefreshCw, AlertTriangle, Brain, Lightbulb,
  Sparkles, XCircle, Activity, CheckCircle2, Building2,
  ArrowLeft, BarChart3,
} from 'lucide-react';
import { getLearningLoop, type LearningLoopData } from '@/app/services/dataService';
import { isBackendEnabled, isVerboseLogging, shouldShowApiErrors } from '@/config/runtime';

// ── Helpers ───────────────────────────────────────────────────────────────────

const REASON_MAP: Record<string, string> = {
  budget:        'Budget constraints',
  competitor:    'Chose competitor',
  timing:        'Timeline misalignment',
  'wrong fit':   'Poor fit — wrong ICP',
  'no decision': 'No follow-up from client',
  price:         'Price too high',
  scope:         'Poor fit — wrong ICP',
  size:          'Poor fit — wrong ICP',
  other:         'Other',
};

function fmt$(n: number): string {
  if (n <= 0)         return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function convColor(rate: number): string {
  return rate >= 60 ? '#10B981' : rate >= 40 ? '#FB923C' : '#FD4438';
}

// ── Recharts dark tooltip ─────────────────────────────────────────────────────

function DarkTooltip({ active, payload, label, formatter }: {
  active?: boolean;
  payload?: { fill?: string; color?: string; name: string; value: number }[];
  label?: string | number;
  formatter?: (v: number, name: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background:   'rgba(8,8,18,0.98)',
      border:       '1px solid rgba(255,255,255,0.1)',
      borderRadius: 10,
      padding:      '8px 12px',
      boxShadow:    '0 12px 40px rgba(0,0,0,0.7)',
      minWidth:     120,
    }}>
      {label !== undefined && label !== null && label !== '' && (
        <p style={{ color: '#9CA3AF', fontSize: 10, marginBottom: 5,
          textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </p>
      )}
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{
            width: 8, height: 8, borderRadius: 2,
            background: p.fill || p.color || '#8B5CF6',
          }} />
          <span style={{ color: '#E5E7EB', fontSize: 12, fontWeight: 700 }}>
            {p.name}: {formatter ? formatter(p.value, p.name) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KPICard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub?: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl p-5 flex flex-col gap-2.5"
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      <div className="flex items-center justify-between">
        <Icon className="size-4 opacity-70" style={{ color }} />
        <span className="text-[26px] font-bold leading-none" style={{ color }}>{value}</span>
      </div>
      <div>
        <p className="text-xs font-bold text-white">{label}</p>
        {sub && <p className="text-[10px] text-gray-500 mt-0.5 leading-snug">{sub}</p>}
      </div>
      <div className="h-[2px] rounded-full"
        style={{ background: `linear-gradient(90deg, ${color}55, transparent)` }} />
    </motion.div>
  );
}

// ── Win / Loss Donut ──────────────────────────────────────────────────────────

function DonutPanel({ data }: { data: LearningLoopData }) {
  const total = data.totalConverted + data.totalLost;

  const pieData = total === 0
    ? [{ name: 'No data', value: 1, color: '#1F2937' }]
    : [
        { name: 'Won',  value: data.totalConverted, color: '#10B981' },
        { name: 'Lost', value: data.totalLost,      color: '#FD4438' },
      ].filter(d => d.value > 0);

  return (
    <div className="rounded-2xl p-5"
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center gap-2 mb-1">
        <BarChart3 className="size-4 text-[#8B5CF6]" />
        <h3 className="text-sm font-bold text-white">Win / Loss Ratio</h3>
      </div>
      <p className="text-[10px] text-gray-500 mb-5">Outcome distribution across all logged deals</p>

      <div className="flex items-center gap-6">

        {/* Donut */}
        <div className="relative flex-shrink-0" style={{ width: 168, height: 168 }}>
          <PieChart width={168} height={168}>
            <Pie
              data={pieData}
              cx="50%" cy="50%"
              innerRadius={52} outerRadius={76}
              startAngle={90} endAngle={-270}
              paddingAngle={total === 0 ? 0 : 4}
              dataKey="value"
              stroke="none"
            >
              {pieData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
          {/* Center overlay */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-[28px] font-bold text-white leading-none">
              {total === 0 ? '—' : `${data.conversionRate}%`}
            </span>
            <span className="text-[9px] text-gray-500 uppercase tracking-widest mt-1">
              {total === 0 ? 'No data' : 'Win rate'}
            </span>
          </div>
        </div>

        {/* Legend + stats */}
        <div className="flex flex-col gap-4 flex-1 min-w-0">
          {/* Won */}
          <div className="flex items-center gap-2.5">
            <div className="size-2.5 rounded-full flex-shrink-0" style={{ background: '#10B981' }} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Won</span>
                <span className="text-sm font-bold text-[#10B981]">{data.totalConverted}</span>
              </div>
              {data.totalRevenue > 0 && (
                <p className="text-[10px] text-gray-600">{fmt$(data.totalRevenue)} revenue</p>
              )}
            </div>
          </div>
          {/* Lost */}
          <div className="flex items-center gap-2.5">
            <div className="size-2.5 rounded-full flex-shrink-0" style={{ background: '#FD4438' }} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Lost</span>
                <span className="text-sm font-bold text-[#FD4438]">{data.totalLost}</span>
              </div>
            </div>
          </div>

          {/* Supplementary stats */}
          <div className="space-y-1.5 mt-1">
            {data.avgDealSize > 0 && (
              <div className="px-2.5 py-1.5 rounded-lg text-[10px]"
                style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.18)' }}>
                <span className="text-gray-500">Avg deal: </span>
                <span className="text-[#10B981] font-bold">{fmt$(data.avgDealSize)}</span>
              </div>
            )}
            {data.avgDaysToClose !== null && (
              <div className="px-2.5 py-1.5 rounded-lg text-[10px]"
                style={{ background: 'rgba(6,215,246,0.06)', border: '1px solid rgba(6,215,246,0.14)' }}>
                <span className="text-gray-500">Avg close: </span>
                <span className="text-[#06D7F6] font-bold">{data.avgDaysToClose}d</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Loss Reason Bar ───────────────────────────────────────────────────────────

const LOSS_PALETTE = ['#FD4438', '#E84040', '#D44848', '#C05050', '#AD5858'];

function LossReasonsPanel({ data }: { data: LearningLoopData }) {
  const chartData = data.topLostReasons.slice(0, 7).map(r => {
    const full = REASON_MAP[r.reason] || r.reason;
    return {
      name:  full.length > 24 ? full.slice(0, 24) + '…' : full,
      full,
      count: r.count,
    };
  });

  const barH = Math.max(180, chartData.length * 38);

  return (
    <div className="rounded-2xl p-5"
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center gap-2 mb-1">
        <XCircle className="size-4 text-[#FD4438]" />
        <h3 className="text-sm font-bold text-white">Top Loss Reasons</h3>
      </div>
      <p className="text-[10px] text-gray-500 mb-5">Why deals were lost — extracted from outcome logs</p>

      {chartData.length === 0 ? (
        <div className="flex items-center justify-center rounded-xl"
          style={{ height: 160, border: '1px dashed rgba(255,255,255,0.07)' }}>
          <p className="text-xs text-gray-600">No lost deals recorded yet</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={barH}>
          <BarChart
            layout="vertical"
            data={chartData}
            margin={{ top: 2, right: 40, left: 4, bottom: 2 }}
          >
            <XAxis
              type="number"
              tick={{ fill: '#6B7280', fontSize: 10 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
              tickLine={false}
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={148}
              tick={{ fill: '#9CA3AF', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <RTooltip
              cursor={{ fill: 'rgba(255,255,255,0.03)' }}
              content={(props: any) => (
                <DarkTooltip
                  active={props.active}
                  payload={props.payload?.map((p: any) => ({ ...p, name: p.payload?.full || p.name }))}
                  label={undefined}
                  formatter={(v: number) => `${v}×`}
                />
              )}
            />
            <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={20}>
              {chartData.map((_, i) => (
                <Cell key={i} fill={LOSS_PALETTE[Math.min(i, LOSS_PALETTE.length - 1)]} />
              ))}
              <LabelList
                dataKey="count"
                position="right"
                style={{ fill: '#9CA3AF', fontSize: 10, fontWeight: 700 }}
                formatter={(v: number) => `${v}×`}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ── Industry Win Rate ─────────────────────────────────────────────────────────

function IndustryPanel({ data }: { data: LearningLoopData }) {
  const chartData = [...data.byIndustry]
    .sort((a, b) => b.conversionRate - a.conversionRate)
    .slice(0, 8)
    .map(row => ({
      name:     row.industry.length > 22 ? row.industry.slice(0, 22) + '…' : row.industry,
      fullName: row.industry,
      rate:     row.conversionRate,
      total:    row.total,
      won:      row.converted,
      lost:     row.total - row.converted,
      avgDeal:  row.avgDealSize,
      fill:     convColor(row.conversionRate),
    }));

  const barH = Math.max(200, chartData.length * 40);

  return (
    <div className="rounded-2xl p-5"
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center gap-2 mb-1">
        <Building2 className="size-4 text-[#3B82F6]" />
        <h3 className="text-sm font-bold text-white">Industry Win Rate</h3>
      </div>
      <p className="text-[10px] text-gray-500 mb-5">Conversion % by industry — sorted by performance</p>

      {chartData.length === 0 ? (
        <div className="flex items-center justify-center rounded-xl"
          style={{ height: 160, border: '1px dashed rgba(255,255,255,0.07)' }}>
          <p className="text-xs text-gray-600">Log outcomes across industries to see patterns</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={barH}>
          <BarChart
            layout="vertical"
            data={chartData}
            margin={{ top: 2, right: 44, left: 4, bottom: 2 }}
          >
            <XAxis
              type="number"
              domain={[0, 100]}
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fill: '#6B7280', fontSize: 10 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={136}
              tick={{ fill: '#9CA3AF', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <RTooltip
              cursor={{ fill: 'rgba(255,255,255,0.03)' }}
              content={({ active, payload }: any) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div style={{
                    background:   'rgba(8,8,18,0.98)',
                    border:       '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 10,
                    padding:      '10px 14px',
                    boxShadow:    '0 12px 40px rgba(0,0,0,0.7)',
                  }}>
                    <p style={{ color: '#E5E7EB', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                      {d.fullName}
                    </p>
                    <p style={{ color: d.fill, fontSize: 14, fontWeight: 800, marginBottom: 4 }}>
                      {d.rate}% win rate
                    </p>
                    <p style={{ color: '#9CA3AF', fontSize: 10 }}>
                      {d.won} won · {d.lost} lost · {d.total} total
                    </p>
                    {d.avgDeal > 0 && (
                      <p style={{ color: '#06D7F6', fontSize: 10, marginTop: 2 }}>
                        Avg deal: {fmt$(d.avgDeal)}
                      </p>
                    )}
                  </div>
                );
              }}
            />
            <Bar dataKey="rate" radius={[0, 4, 4, 0]} maxBarSize={20}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.fill} />
              ))}
              <LabelList
                dataKey="rate"
                position="right"
                style={{ fill: '#9CA3AF', fontSize: 10, fontWeight: 700 }}
                formatter={(v: number) => `${v}%`}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ── Score Band Analysis ───────────────────────────────────────────────────────

function ScoreBandPanel({ data }: { data: LearningLoopData }) {
  const bands = [
    { label: `High  ·  ${data.scoreCorrelation.highScore.range}`, color: '#10B981', ...data.scoreCorrelation.highScore },
    { label: `Mid   ·  ${data.scoreCorrelation.midScore.range}`,  color: '#FB923C', ...data.scoreCorrelation.midScore  },
    { label: `Low   ·  ${data.scoreCorrelation.lowScore.range}`,  color: '#FD4438', ...data.scoreCorrelation.lowScore  },
  ];

  const hasInsight =
    data.scoreCorrelation.highScore.rate !== null &&
    data.scoreCorrelation.lowScore.rate  !== null;

  return (
    <div className="rounded-2xl p-5"
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="size-4 text-[#8B5CF6]" />
        <h3 className="text-sm font-bold text-white">Score Band Analysis</h3>
      </div>
      <p className="text-[10px] text-gray-500 mb-5">
        Does a higher AI score predict a win? Validates CORTEX accuracy.
      </p>

      <div className="space-y-5">
        {bands.map((band, i) => {
          const pct = band.rate ?? 0;
          return (
            <div key={i} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-300 font-mono font-medium text-[10px]">{band.label}</span>
                <div className="flex items-center gap-3">
                  <span className="text-gray-600 text-[10px]">{band.converted}/{band.total}</span>
                  <span className="font-bold text-sm"
                    style={{ color: band.rate === null ? '#4B5563' : band.color }}>
                    {band.rate === null ? '—' : `${band.rate}%`}
                  </span>
                </div>
              </div>
              <div className="h-3 rounded-full overflow-hidden"
                style={{ background: 'rgba(255,255,255,0.05)' }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.85, delay: i * 0.12, ease: 'easeOut' }}
                  className="h-full rounded-full"
                  style={{ background: `linear-gradient(90deg, ${band.color}, ${band.color}88)` }}
                />
              </div>
              <p className="text-[10px] text-gray-600">
                {band.total} outcome{band.total !== 1 ? 's' : ''} in this band
              </p>
            </div>
          );
        })}
      </div>

      {hasInsight && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
          className="mt-5 p-3 rounded-xl text-[10px] leading-relaxed"
          style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)' }}
        >
          <span className="text-[#8B5CF6] font-bold">Insight: </span>
          <span className="text-gray-400">
            {(data.scoreCorrelation.highScore.rate ?? 0) > (data.scoreCorrelation.lowScore.rate ?? 0)
              ? `High-score leads (${data.scoreCorrelation.highScore.range}) convert at ${data.scoreCorrelation.highScore.rate}% vs ${data.scoreCorrelation.lowScore.rate}% for low — AI is calling it correctly.`
              : `Similar conversion across score bands. Consider refining scoring weights in CORTEX.`}
          </span>
        </motion.div>
      )}
    </div>
  );
}

// ── Recent Outcomes ───────────────────────────────────────────────────────────

function RecentOutcomesPanel({ data }: { data: LearningLoopData }) {
  const rows = data.recentOutcomes.slice(0, 10);
  const COLS = ['Company', 'Industry', 'Result', 'Value', 'AI Score', 'Rec. Worked', 'Date'];

  return (
    <div className="rounded-2xl p-5"
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center gap-2 mb-1">
        <Clock className="size-4 text-[#06D7F6]" />
        <h3 className="text-sm font-bold text-white">Recent Outcomes</h3>
        <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ background: 'rgba(6,215,246,0.1)', color: '#06D7F6', border: '1px solid rgba(6,215,246,0.2)' }}>
          Last {rows.length}
        </span>
      </div>
      <p className="text-[10px] text-gray-500 mb-4">Most recently logged deal outcomes with AI correlation</p>

      {rows.length === 0 ? (
        <div className="flex items-center justify-center py-10 rounded-xl"
          style={{ border: '1px dashed rgba(255,255,255,0.07)' }}>
          <p className="text-xs text-gray-600">No outcomes logged yet</p>
        </div>
      ) : (
        <div className="overflow-auto" style={{ maxHeight: 340 }}>
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                {COLS.map(h => (
                  <th key={h}
                    className="text-left pb-2 pr-4 whitespace-nowrap"
                    style={{ color: '#6B7280', fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((o, i) => (
                <motion.tr
                  key={o.submissionId}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                >
                  <td className="py-2.5 pr-4 text-white font-semibold text-[11px]">{o.company}</td>
                  <td className="py-2.5 pr-4 text-gray-400 text-[11px]">{o.industry}</td>
                  <td className="py-2.5 pr-4">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold"
                      style={{
                        background: o.didConvert ? 'rgba(16,185,129,0.14)' : 'rgba(253,68,56,0.12)',
                        border:     `1px solid ${o.didConvert ? 'rgba(16,185,129,0.3)' : 'rgba(253,68,56,0.3)'}`,
                        color:      o.didConvert ? '#10B981' : '#FD4438',
                      }}>
                      {o.didConvert
                        ? <TrendingUp className="size-2.5" />
                        : <TrendingDown className="size-2.5" />}
                      {o.didConvert ? 'WON' : 'LOST'}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-[11px] font-bold"
                    style={{ color: '#06D7F6' }}>
                    {o.conversionValue ? fmt$(o.conversionValue) : '—'}
                  </td>
                  <td className="py-2.5 pr-4 text-[11px] font-bold"
                    style={{ color: o.aiScore >= 75 ? '#10B981' : o.aiScore >= 50 ? '#FB923C' : '#FD4438' }}>
                    {o.aiScore || '—'}
                  </td>
                  <td className="py-2.5 pr-4">
                    {o.recommendationWorked === null
                      ? <span className="text-gray-600 text-[11px]">—</span>
                      : o.recommendationWorked
                        ? <CheckCircle2 className="size-3.5 text-[#10B981]" />
                        : <XCircle className="size-3.5 text-[#FD4438]" />}
                  </td>
                  <td className="py-2.5 text-gray-500 text-[10px] whitespace-nowrap">
                    {timeAgo(o.loggedAt)}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Improvement Areas tag cloud ───────────────────────────────────────────────

function ImprovementAreasPanel({ data }: { data: LearningLoopData }) {
  const max = data.improvementAreas[0]?.count || 1;

  return (
    <div className="rounded-2xl p-5 flex flex-col"
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', minHeight: 200 }}>
      <div className="flex items-center gap-2 mb-1">
        <Lightbulb className="size-4 text-[#FB923C]" />
        <h3 className="text-sm font-bold text-white">Improvement Votes</h3>
      </div>
      <p className="text-[10px] text-gray-500 mb-4">Process areas flagged for CORTEX refinement — larger = more votes</p>

      {data.improvementAreas.length === 0 ? (
        <p className="text-xs text-gray-600">No improvement areas tagged yet</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {data.improvementAreas.map((area, i) => {
            const ratio   = area.count / max;
            const opacity = 0.5 + ratio * 0.5;
            const size    = 9 + ratio * 4;
            return (
              <motion.span
                key={i}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.05 }}
                title={`Flagged ${area.count}×`}
                className="inline-flex items-center gap-1.5 rounded-full font-bold"
                style={{
                  padding:    `${4 + ratio * 3}px ${10 + ratio * 4}px`,
                  background: `rgba(251,146,60,${0.07 + ratio * 0.13})`,
                  border:     `1px solid rgba(251,146,60,${opacity * 0.35})`,
                  color:      `rgba(251,146,60,${opacity})`,
                  fontSize:   size,
                }}
              >
                {area.area}
                <span style={{ fontSize: 8, fontWeight: 900, opacity: 0.65 }}>{area.count}×</span>
              </motion.span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── How CORTEX Gets Smarter ───────────────────────────────────────────────────

function HowCortexLearns() {
  const items = [
    { title: 'Scoring weights',      desc: 'Industries that convert get prioritized in urgency scoring'                     },
    { title: 'Recommendation logic', desc: 'Winning service paths become default for similar future leads'                  },
    { title: 'Risk detection',       desc: 'Loss patterns that predict failure get incorporated into risk flags'             },
    { title: 'Pricing accuracy',     desc: 'Deal size patterns by industry refine ROI estimate ranges'                      },
  ];
  return (
    <div className="rounded-2xl p-5 flex flex-col"
      style={{
        background: 'linear-gradient(135deg, rgba(139,92,246,0.07), rgba(59,130,246,0.05))',
        border:     '1px solid rgba(139,92,246,0.2)',
        minHeight:  200,
      }}>
      <div className="flex items-center gap-2 mb-1">
        <Brain className="size-4 text-[#8B5CF6]" />
        <h3 className="text-sm font-bold text-white">How CORTEX Gets Smarter</h3>
      </div>
      <p className="text-[10px] text-gray-500 mb-4">Every outcome logged feeds the intelligence loop</p>
      <div className="space-y-3 flex-1">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <CheckCircle2 className="size-3.5 text-[#10B981] flex-shrink-0 mt-px" />
            <p className="text-[11px] leading-snug">
              <span className="text-white font-semibold">{item.title}: </span>
              <span className="text-gray-400">{item.desc}</span>
            </p>
          </div>
        ))}
      </div>
      <p className="text-[#8B5CF6] text-[11px] font-bold mt-4">
        Your moat: every deal logged makes the next easier to close. 🧠
      </p>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="space-y-5">
      <div className="text-center py-20 rounded-2xl"
        style={{ border: '1px dashed rgba(255,255,255,0.08)' }}>
        <div className="size-20 rounded-2xl mx-auto mb-6 flex items-center justify-center"
          style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.18)' }}>
          <Activity className="size-10 opacity-30 text-[#8B5CF6]" />
        </div>
        <h2 className="text-xl font-bold text-white mb-3">No outcomes logged yet</h2>
        <p className="text-gray-500 text-sm max-w-md mx-auto leading-relaxed">
          The Learning Loop activates when your team logs deal outcomes from the Pipeline.{' '}
          Drag a lead to{' '}
          <span className="text-[#10B981] font-semibold">Converted</span> or{' '}
          <span className="text-[#FD4438] font-semibold">Lost</span>{' '}
          to log your first outcome and start the intelligence feedback loop.
        </p>
      </div>
      <HowCortexLearns />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function LearningLoopPanel({
  onBack,
  accessToken,
}: {
  onBack:        () => void;
  accessToken?:  string;
}) {
  const [data,         setData]         = useState<LearningLoopData | null>(null);
  const [status,       setStatus]       = useState<'loading' | 'empty' | 'error' | 'ready'>('loading');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [refreshedAt,  setRefreshedAt]  = useState<string | null>(null);

  const load = async (silent = false) => {
    if (!silent) setStatus('loading');
    else         setIsRefreshing(true);
    setError(null);
    try {
      if (!accessToken || !isBackendEnabled()) {
        setStatus('empty');
        return;
      }
      const res = await getLearningLoop(accessToken);
      if (res.isEmpty || !res.data) {
        setStatus('empty');
        setData(null);
      } else {
        setData(res.data);
        setStatus('ready');
        setRefreshedAt(new Date().toISOString());
      }
    } catch (err: any) {
      console.error('[LearningLoopPanel] Load failed:', err);
      setError(err.message || 'Failed to load learning data');
      setStatus('error');
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => { load(); }, [accessToken]);

  return (
    <div className="min-h-screen text-white" style={{ background: '#0A0A0F' }}>

      {/* ── Sticky header ─────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 backdrop-blur-xl"
        style={{ background: 'rgba(10,10,15,0.92)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">

          {/* Left: back + title */}
          <div className="flex items-center gap-4 min-w-0">
            <button
              onClick={onBack}
              className="flex items-center gap-2 text-sm text-gray-500 hover:text-white transition-colors flex-shrink-0"
            >
              <ArrowLeft className="size-4" />
              CORTEX
            </button>

            <div className="flex items-center gap-3 min-w-0">
              <div className="size-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{
                  background: 'linear-gradient(135deg, rgba(16,185,129,0.22), rgba(6,215,246,0.16))',
                  border:     '1px solid rgba(16,185,129,0.28)',
                }}>
                <TrendingUp className="size-5 text-[#10B981]" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-base font-bold tracking-tight">LEARNING LOOP</h1>
                  {data && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: 'rgba(16,185,129,0.12)', color: '#10B981', border: '1px solid rgba(16,185,129,0.25)' }}
                    >
                      {data.totalOutcomes} outcome{data.totalOutcomes !== 1 ? 's' : ''}
                    </motion.span>
                  )}
                </div>
                <p className="text-[10px] text-gray-500">
                  Pattern intelligence ·{' '}
                  {refreshedAt ? `Updated ${timeAgo(refreshedAt)}` : 'Loading…'}
                </p>
              </div>
            </div>
          </div>

          {/* Right: refresh */}
          <button
            onClick={() => load(true)}
            disabled={isRefreshing || status === 'loading'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:text-gray-200 transition-colors disabled:opacity-40 flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <RefreshCw className={`size-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-4">

        {/* Error banner */}
        <AnimatePresence>
          {error && (
            <motion.div
              key="error-banner"
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="px-4 py-3 rounded-xl flex items-center justify-between gap-3"
                style={{ background: 'rgba(253,68,56,0.08)', border: '1px solid rgba(253,68,56,0.25)', color: '#FCA5A5' }}>
                <div className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="size-4 text-[#FD4438] flex-shrink-0" />
                  {error}
                </div>
                <button onClick={() => setError(null)} className="text-gray-500 hover:text-white">✕</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Loading */}
        {status === 'loading' && (
          <div className="flex flex-col items-center justify-center py-40 gap-4">
            <div className="size-16 rounded-2xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.14), rgba(6,215,246,0.1))', border: '1px solid rgba(16,185,129,0.22)' }}>
              <Brain className="size-8 text-[#10B981] animate-pulse" />
            </div>
            <p className="text-gray-500 text-sm">Aggregating intelligence data…</p>
          </div>
        )}

        {/* Empty */}
        {status === 'empty' && <EmptyState />}

        {/* Ready */}
        {status === 'ready' && data && (
          <span className="contents">
            {/* KPI Row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KPICard
                label="Outcomes Logged"
                value={String(data.totalOutcomes)}
                sub={`${data.totalConverted} won · ${data.totalLost} lost`}
                icon={Target}
                color="#8B5CF6"
              />
              <KPICard
                label="Win Rate"
                value={`${data.conversionRate}%`}
                sub={`${data.totalConverted} of ${data.totalOutcomes} deals`}
                icon={TrendingUp}
                color={convColor(data.conversionRate)}
              />
              <KPICard
                label="Revenue Won"
                value={fmt$(data.totalRevenue)}
                sub={data.avgDealSize > 0 ? `Avg deal: ${fmt$(data.avgDealSize)}` : 'No deal values logged yet'}
                icon={DollarSign}
                color="#06D7F6"
              />
              <KPICard
                label="Rec. Accuracy"
                value={data.recommendationAccuracy !== null ? `${data.recommendationAccuracy}%` : 'N/A'}
                sub={data.avgDaysToClose !== null ? `Avg ${data.avgDaysToClose}d to close` : 'Not enough data yet'}
                icon={Award}
                color="#FB923C"
              />
            </div>

            {/* Row 2: Donut + Loss Reasons */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <DonutPanel data={data} />
              <LossReasonsPanel data={data} />
            </div>

            {/* Row 3: Industry + Score Band */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <IndustryPanel data={data} />
              <ScoreBandPanel data={data} />
            </div>

            {/* Row 4: Recent Outcomes — full width */}
            <RecentOutcomesPanel data={data} />

            {/* Row 5: Improvement Areas + How CORTEX learns */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ImprovementAreasPanel data={data} />
              <HowCortexLearns />
            </div>
          </span>
        )}
      </div>
    </div>
  );
}