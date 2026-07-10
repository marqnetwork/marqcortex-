/**
 * QBR PANEL — §15
 * Quarterly Business Review Generator UI.
 * Board-ready, export-ready. Pulled from all 4 engines.
 *
 * Layout (spec §4):
 *   0. Generation Trigger (blockers check, period, generate button)
 *   1. Status Flow Tracker
 *   2. Executive Summary
 *   3. A) Delivery Performance
 *   4. B) Financial Impact
 *   5. D) Operational Efficiency
 *   6. C) Agent Health
 *   7. E) Risks & Constraints
 *   8. Opportunities for Next Quarter
 *   9. Recommended Expansion Path
 *  10. Export
 */

import { useState, useMemo } from 'react';
import {
  FileText, TrendingUp, TrendingDown, Shield, Target, BarChart2,
  Activity, Bell, AlertTriangle, CheckCircle2, Lock, ChevronRight,
  Download, RefreshCw, Info, ArrowRight, Zap, XCircle,
  Flag, DollarSign, Users, Clock, Package, Star,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import type { ExecutionProject } from '@/app/core/executionEngine';
import { buildMockROIActualsState } from '@/app/core/roiActualsEngine';
import type { QBRReport, QBROpportunity } from '@/app/core/qbrEngine';
import {
  buildMockQBRReport, advanceQBRStatus, buildQBRExportText,
  QBR_STATUS_FLOW, QBR_STATUS_LABELS, QBR_STATUS_COLORS,
  QBR_STATUS_ACTIONS, QBR_ACTION_LABELS, checkGenerationBlockers,
  OPPORTUNITY_CATEGORY_LABELS, CONFIDENCE_COLORS,
} from '@/app/core/qbrEngine';

// ════════════════════════════════════════════════════════════════════════════════
// DESIGN TOKENS
// ════════════════════════════════════════════════════════════════════════════════

const ACCENT  = '#06D7F6';
const GREEN   = '#10B981';
const RED     = '#FD4438';
const ORANGE  = '#FB923C';
const YELLOW  = '#F59E0B';
const PURPLE  = '#8B5CF6';
const GOLD    = '#F59E0B';

// ════════════════════════════════════════════════════════════════════════════════
// SHARED PRIMITIVES (mirrored from ExecutionDashboard)
// ════════════════════════════════════════════════════════════════════════════════

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n ?? 0);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function Card({ children, accent = ACCENT }: { children: React.ReactNode; accent?: string }) {
  return (
    <div className="rounded-2xl border overflow-hidden" style={{ borderColor: `${accent}18`, background: '#09090F' }}>
      {children}
    </div>
  );
}

function SectionHeader({
  icon: Icon, title, badge, accent = ACCENT, children,
}: {
  icon: typeof FileText; title: string; badge?: string; accent?: string; children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b flex-wrap"
      style={{ borderColor: `${accent}18`, background: `${accent}06` }}>
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 flex-shrink-0" style={{ color: accent }} />
        <span className="text-[10px] font-black tracking-wide text-white">{title}</span>
        {badge && (
          <span className="text-[7px] font-bold px-1.5 py-0.5 rounded-full border"
            style={{ borderColor: `${accent}30`, color: accent, background: `${accent}12` }}>
            {badge}
          </span>
        )}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

function KPITile({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2.5 rounded-xl border"
      style={{ borderColor: `${color}22`, background: `${color}07` }}>
      <span className="text-[13px] font-black leading-none" style={{ color }}>{value}</span>
      {sub && <span className="text-[7px] text-gray-700">{sub}</span>}
      <span className="text-[6.5px] uppercase tracking-widest text-gray-700 mt-0.5">{label}</span>
    </div>
  );
}

function RiskBadge({ level }: { level: 'low' | 'medium' | 'high' }) {
  const cfg = { low: { color: GREEN, label: 'Low Risk' }, medium: { color: YELLOW, label: 'Medium Risk' }, high: { color: RED, label: 'High Risk' } };
  const { color, label } = cfg[level];
  return (
    <span className="text-[7.5px] font-black px-2 py-0.5 rounded-full border"
      style={{ borderColor: `${color}30`, color, background: `${color}15` }}>{label}</span>
  );
}

function ProgressBar({ pct, color = GREEN }: { pct: number; color?: string }) {
  return (
    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-700"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// STATUS FLOW TRACKER
// ════════════════════════════════════════════════════════════════════════════════

function StatusFlowTracker({ report, onAdvance }: { report: QBRReport; onAdvance: () => void }) {
  const currentIdx = QBR_STATUS_FLOW.indexOf(report.status);
  const action     = QBR_STATUS_ACTIONS[report.status];

  return (
    <Card accent={QBR_STATUS_COLORS[report.status]}>
      <SectionHeader icon={ChevronRight} title="QBR Status" badge={QBR_STATUS_LABELS[report.status]}
        accent={QBR_STATUS_COLORS[report.status]}>
        {action && (
          <button onClick={onAdvance}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[8px] font-bold transition-colors"
            style={{ borderColor: `${QBR_STATUS_COLORS[report.status]}30`, color: QBR_STATUS_COLORS[report.status], background: `${QBR_STATUS_COLORS[report.status]}12` }}>
            <ChevronRight className="size-2.5" />{QBR_ACTION_LABELS[action]}
          </button>
        )}
      </SectionHeader>

      <div className="p-4 flex items-center gap-0 overflow-x-auto">
        {QBR_STATUS_FLOW.map((status, i) => {
          const isCurrent = i === currentIdx;
          const isDone    = i < currentIdx;
          const color     = isDone ? GREEN : isCurrent ? QBR_STATUS_COLORS[status] : '#374151';
          return (
            <div key={status} className="flex items-center">
              <div className="flex flex-col items-center gap-1 min-w-[80px]">
                <div className="w-6 h-6 rounded-full border-2 flex items-center justify-center"
                  style={{ borderColor: color, background: isDone ? `${GREEN}20` : isCurrent ? `${color}15` : 'transparent' }}>
                  {isDone
                    ? <CheckCircle2 className="size-3" style={{ color: GREEN }} />
                    : <div className="w-1.5 h-1.5 rounded-full" style={{ background: isCurrent ? color : '#374151' }} />
                  }
                </div>
                <span className="text-[6.5px] text-center leading-tight px-1 font-bold"
                  style={{ color: isCurrent ? color : isDone ? GREEN : '#6B7280' }}>
                  {QBR_STATUS_LABELS[status]}
                </span>
              </div>
              {i < QBR_STATUS_FLOW.length - 1 && (
                <div className="w-8 h-px flex-shrink-0 mx-0.5 mb-5"
                  style={{ background: i < currentIdx ? `${GREEN}50` : '#1f2937' }} />
              )}
            </div>
          );
        })}
      </div>

      <div className="px-4 pb-3 border-t border-white/5 pt-2 flex items-center gap-3 flex-wrap">
        <div className="text-[7px] text-gray-800 flex items-center gap-1">
          <Info className="size-2.5" />QBR {report.qbr_id} · Generated {fmtDate(report.generated_at)} · Prepared by {report.prepared_by}
        </div>
        <div className="ml-auto text-[7px] text-gray-800 font-mono">{report.execution_id}</div>
      </div>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// EXECUTIVE SUMMARY
// ════════════════════════════════════════════════════════════════════════════════

function ExecutiveSummaryCard({ report }: { report: QBRReport }) {
  const s = report.sections.executive_summary;
  return (
    <Card accent={GOLD}>
      <SectionHeader icon={Star} title="Executive Summary" badge={s.period} accent={GOLD} />
      <div className="p-4 space-y-3">
        <div className="px-3 py-2.5 rounded-xl border" style={{ borderColor: `${GOLD}20`, background: `${GOLD}06` }}>
          <div className="text-[10px] font-bold text-white leading-snug">{s.headline}</div>
        </div>
        <p className="text-[8.5px] text-gray-500 leading-relaxed">{s.status_narrative}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="text-[7.5px] font-bold uppercase tracking-wide mb-1.5" style={{ color: GREEN }}>✓ Top Wins</div>
            <div className="space-y-1">
              {s.top_wins.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[8px] text-gray-500">
                  <CheckCircle2 className="size-2.5 flex-shrink-0 mt-0.5" style={{ color: GREEN }} />{w}
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[7.5px] font-bold uppercase tracking-wide mb-1.5" style={{ color: ORANGE }}>⚠ Top Risks</div>
            <div className="space-y-1">
              {s.top_risks.map((r, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[8px] text-gray-500">
                  <AlertTriangle className="size-2.5 flex-shrink-0 mt-0.5" style={{ color: ORANGE }} />{r}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg border text-[8px]"
          style={{ borderColor: `${ACCENT}20`, background: `${ACCENT}06` }}>
          <ArrowRight className="size-2.5 flex-shrink-0 mt-0.5" style={{ color: ACCENT }} />
          <div><span className="font-bold text-white">Next Quarter Focus: </span>
            <span className="text-gray-500">{s.next_quarter_focus}</span></div>
        </div>
      </div>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// A) DELIVERY PERFORMANCE
// ════════════════════════════════════════════════════════════════════════════════

function DeliverySection({ report }: { report: QBRReport }) {
  const d = report.sections.delivery_performance;
  return (
    <Card accent={ACCENT}>
      <SectionHeader icon={Package} title="A) Delivery Performance" badge={`v${d.execution_version}`} accent={ACCENT} />
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <KPITile label="Milestones Done"  value={`${d.milestones_completed}/${d.milestones_total}`} color={d.milestones_completed === d.milestones_total ? GREEN : ACCENT}   sub={`${d.on_time_rate_percent}% on-time`} />
          <KPITile label="Tasks Delivered"  value={`${d.tasks_completed}/${d.tasks_total}`}           color={PURPLE}  sub={`${Math.round((d.tasks_completed / Math.max(1, d.tasks_total)) * 100)}% complete`} />
          <KPITile label="Change Orders"    value={`${d.change_orders_raised}`}                       color={d.change_orders_raised > 0 ? ORANGE : GREEN}  sub={`${d.change_orders_approved} approved`} />
          <KPITile label="Gate Failures"    value={`${d.gate_failures}`}                              color={d.gate_failures > 0 ? RED : GREEN}  sub={`${d.gates_passed} passed`} />
        </div>
        {d.milestones_delayed > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border text-[8px]"
            style={{ borderColor: `${ORANGE}20`, background: `${ORANGE}06` }}>
            <AlertTriangle className="size-3 flex-shrink-0" style={{ color: ORANGE }} />
            <span className="text-gray-500">{d.milestones_delayed} milestone(s) delayed — delivery team to investigate root cause</span>
          </div>
        )}
        <div>
          <div className="text-[7.5px] font-bold text-gray-700 uppercase tracking-wide mb-2">Key Events This Period</div>
          <div className="space-y-1">
            {d.key_events.map((e, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[8px] text-gray-600">
                <ChevronRight className="size-2.5 flex-shrink-0 mt-0.5" style={{ color: ACCENT }} />{e}
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between text-[7.5px] mb-1">
            <span className="text-gray-700 font-bold uppercase tracking-wide">On-Time Delivery Rate</span>
            <span className="font-black" style={{ color: d.on_time_rate_percent >= 80 ? GREEN : ORANGE }}>{d.on_time_rate_percent}%</span>
          </div>
          <ProgressBar pct={d.on_time_rate_percent} color={d.on_time_rate_percent >= 80 ? GREEN : ORANGE} />
        </div>
      </div>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// B) FINANCIAL IMPACT
// ════════════════════════════════════════════════════════════════════════════════

function FinancialSection({ report }: { report: QBRReport }) {
  const f = report.sections.financial_impact;
  const varianceColor = f.projected_vs_actual_variance_pct >= 0 ? GREEN : ORANGE;

  const breakdownData = [
    { name: 'Labour\nSavings',     value: f.period_labor_savings,      fill: ACCENT  },
    { name: 'Efficiency\nSavings', value: f.period_efficiency_savings,  fill: PURPLE  },
    { name: 'Margin\nLift',        value: f.period_margin_lift,         fill: GREEN   },
    { name: 'Period\nCost',        value: -f.period_cost,               fill: RED     },
    { name: 'Net\nActual',         value: f.period_net,                 fill: f.period_net >= 0 ? GREEN : ORANGE },
  ];

  return (
    <Card accent={GREEN}>
      <SectionHeader icon={DollarSign} title="B) Financial Impact" badge={`${f.months_submitted} month(s) of actuals`} accent={GREEN} />
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <KPITile label="Period Gain"    value={fmtCurrency(f.period_gain)}   color={GREEN}   sub="gross actual" />
          <KPITile label="Period Net"     value={fmtCurrency(f.period_net)}    color={f.period_net >= 0 ? GREEN : ORANGE}  sub="after project cost" />
          <KPITile label="vs Projection"  value={`${f.projected_vs_actual_variance_pct >= 0 ? '+' : ''}${f.projected_vs_actual_variance_pct}%`}
            color={varianceColor}  sub={f.projected_vs_actual_variance_pct >= 0 ? 'ahead' : 'ramp phase'} />
          <KPITile label="Est. Payback"  value={`Month ${f.months_to_payback_estimated}`}  color={ACCENT}   sub="updated estimate" />
        </div>

        {/* Gain breakdown chart */}
        <div>
          <div className="text-[7.5px] font-bold text-gray-700 uppercase tracking-wide mb-2">Gain Breakdown</div>
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={breakdownData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                <XAxis dataKey="name" tick={{ fontSize: 7, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 7, fill: '#6B7280' }} axisLine={false} tickLine={false}
                  tickFormatter={v => `$${Math.abs(v / 1000).toFixed(1)}K`} />
                <Tooltip contentStyle={{ background: '#0D0D1A', border: '1px solid #ffffff14', borderRadius: 8, fontSize: 8 }}
                  formatter={(v: number) => [`$${Math.abs(v).toLocaleString()}`, undefined]} />
                <ReferenceLine y={0} stroke="#ffffff15" />
                <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                  {breakdownData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Payback progress */}
        <div>
          <div className="flex items-center justify-between text-[7.5px] mb-1">
            <span className="text-gray-700 font-bold uppercase tracking-wide">Payback Progress</span>
            <span className="font-black" style={{ color: f.payback_progress_percent >= 50 ? GREEN : ACCENT }}>{f.payback_progress_percent}%</span>
          </div>
          <ProgressBar pct={f.payback_progress_percent} color={f.payback_progress_percent >= 50 ? GREEN : ACCENT} />
          <div className="flex justify-between text-[7px] text-gray-800 mt-1">
            <span>Investment Recovery</span>
            <span>{fmtCurrency(f.period_gain)} recovered of total investment</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-1">
          {[
            { label: 'Labour Savings',     value: fmtCurrency(f.period_labor_savings),      color: ACCENT  },
            { label: 'Efficiency Savings', value: fmtCurrency(f.period_efficiency_savings),  color: PURPLE  },
            { label: 'Margin Lift',        value: fmtCurrency(f.period_margin_lift),         color: GREEN   },
          ].map(kv => (
            <div key={kv.label} className="flex flex-col gap-0.5 px-2 py-1.5 rounded-lg border border-white/5 text-center">
              <span className="text-[9px] font-black" style={{ color: kv.color }}>{kv.value}</span>
              <span className="text-[6.5px] uppercase tracking-wide text-gray-700">{kv.label}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// D) OPERATIONAL EFFICIENCY
// ════════════════════════════════════════════════════════════════════════════════

function OperationalSection({ report }: { report: QBRReport }) {
  const o = report.sections.operational_efficiency;
  return (
    <Card accent={YELLOW}>
      <SectionHeader icon={Zap} title="D) Operational Efficiency Gains" accent={YELLOW} />
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <KPITile label="Automation Coverage" value={`${o.automation_coverage_percent}%`}     color={o.automation_coverage_percent >= 50 ? GREEN : YELLOW}  sub="of baseline workflows" />
          <KPITile label="Manual Hrs Reduced"  value={`${o.manual_hours_reduction_pct}%`}      color={ACCENT}  sub={`${o.hours_saved_period} hrs this period`} />
          <KPITile label="Support Efficiency"  value={`${o.support_efficiency_pct}% faster`}   color={PURPLE}  sub="ticket handle time" />
          <KPITile label="Tickets Deflected"   value={`${o.tickets_deflected_period}`}         color={GREEN}   sub="vs baseline volume" />
          <KPITile label="Cycle Time Impr."    value={`${o.cycle_time_improvement_pct}%`}      color={ORANGE}  sub="process cycle time" />
          <KPITile label="Hours Saved Total"   value={`${o.hours_saved_period} hrs`}           color={ACCENT}  sub="cumulative to date" />
        </div>
        <div>
          <div className="flex items-center justify-between text-[7.5px] mb-1">
            <span className="text-gray-700 font-bold uppercase tracking-wide">Automation Coverage Progress</span>
            <span className="font-black" style={{ color: o.automation_coverage_percent >= 50 ? GREEN : YELLOW }}>{o.automation_coverage_percent}%</span>
          </div>
          <ProgressBar pct={o.automation_coverage_percent} color={o.automation_coverage_percent >= 50 ? GREEN : YELLOW} />
          <div className="flex justify-between text-[7px] text-gray-800 mt-1">
            <span>Launch: 0%</span>
            <span>Target: 70%+</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// C) AGENT HEALTH
// ════════════════════════════════════════════════════════════════════════════════

function AgentHealthSection({ report }: { report: QBRReport }) {
  const a = report.sections.agent_health;
  const trendColor = a.override_rate_trend === 'improving' ? GREEN : a.override_rate_trend === 'stable' ? ACCENT : RED;
  return (
    <Card accent={PURPLE}>
      <SectionHeader icon={Activity} title="C) Agent Health" badge={`${a.agents_active} agents active`} accent={PURPLE} />
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <KPITile label="Avg Success Rate"   value={`${a.avg_success_rate_percent}%`}  color={a.avg_success_rate_percent >= 90 ? GREEN : ORANGE}  sub="across all agents" />
          <KPITile label="Override Trend"     value={a.override_rate_trend}             color={trendColor}  sub="human override rate" />
          <KPITile label="Incidents Open"     value={`${a.incidents_open}`}             color={a.incidents_open > 0 ? RED : GREEN}  sub={`${a.incidents_resolved} resolved`} />
          <KPITile label="Tuning Cycles"      value={`${a.tuning_cycles}`}             color={YELLOW}  sub={`${a.agents_retrained} retrained`} />
        </div>
        <div>
          <div className="flex items-center justify-between text-[7.5px] mb-1">
            <span className="text-gray-700 font-bold uppercase tracking-wide">Agent Success Rate</span>
            <span className="font-black" style={{ color: a.avg_success_rate_percent >= 90 ? GREEN : ORANGE }}>{a.avg_success_rate_percent}%</span>
          </div>
          <ProgressBar pct={a.avg_success_rate_percent} color={a.avg_success_rate_percent >= 90 ? GREEN : ORANGE} />
        </div>
        {a.top_agent_issues.length > 0 && (
          <div>
            <div className="text-[7.5px] font-bold text-gray-700 uppercase tracking-wide mb-1.5">Agent Issues This Period</div>
            {a.top_agent_issues.map((issue, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[8px] text-gray-600 mb-1">
                <Info className="size-2.5 flex-shrink-0 mt-0.5" style={{ color: PURPLE }} />{issue}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// E) RISKS & CONSTRAINTS
// ════════════════════════════════════════════════════════════════════════════════

function RisksSection({ report }: { report: QBRReport }) {
  const r = report.sections.risks_constraints;
  return (
    <Card accent={r.risk_level === 'high' ? RED : r.risk_level === 'medium' ? ORANGE : GREEN}>
      <SectionHeader icon={Shield} title="E) Risks & Constraints"
        accent={r.risk_level === 'high' ? RED : r.risk_level === 'medium' ? ORANGE : GREEN}>
        <RiskBadge level={r.risk_level} />
      </SectionHeader>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <KPITile label="Scope Events"     value={`${r.scope_events}`}          color={r.scope_events > 0 ? ORANGE : GREEN}   sub="change orders raised" />
          <KPITile label="Open Incidents"   value={`${r.open_incidents}`}        color={r.open_incidents > 0 ? RED : GREEN}    sub="unresolved" />
          <KPITile label="Variance Tags"    value={`${r.top_variance_tags.length} type(s)`}  color={YELLOW}  sub="across all months" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: 'Adoption Blockers',  items: r.adoption_blockers,  color: ORANGE },
            { label: 'Data Gaps',          items: r.data_gaps,          color: YELLOW },
            { label: 'Integration Risks',  items: r.integration_risks,  color: RED    },
          ].map(({ label, items, color }) => (
            <div key={label}>
              <div className="text-[7.5px] font-bold uppercase tracking-wide mb-1" style={{ color }}>{label}</div>
              {items.map((item, i) => (
                <div key={i} className="flex items-start gap-1 text-[7.5px] text-gray-600 mb-0.5">
                  <AlertTriangle className="size-2 flex-shrink-0 mt-0.5" style={{ color }} />{item}
                </div>
              ))}
            </div>
          ))}
        </div>

        {r.top_variance_tags.length > 0 && (
          <div>
            <div className="text-[7.5px] font-bold text-gray-700 uppercase tracking-wide mb-2">Top Variance Tags (QBR Feed)</div>
            <div className="flex flex-wrap gap-1.5">
              {r.top_variance_tags.map(({ tag, label, count }) => (
                <div key={tag} className="flex items-center gap-1 px-2 py-1 rounded-lg border border-white/5 text-[7.5px]">
                  <Flag className="size-2 flex-shrink-0" style={{ color: ORANGE }} />
                  <span className="text-gray-600">{label}</span>
                  <span className="font-black text-white">{count}×</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="text-[7.5px] font-bold text-gray-700 uppercase tracking-wide mb-1.5">Mitigation Actions</div>
          {r.mitigation_notes.map((note, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[7.5px] text-gray-600 mb-0.5">
              <CheckCircle2 className="size-2.5 flex-shrink-0 mt-0.5" style={{ color: GREEN }} />{note}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// OPPORTUNITIES ENGINE
// ════════════════════════════════════════════════════════════════════════════════

function OpportunityCard({ opp }: { opp: QBROpportunity }) {
  const conf = CONFIDENCE_COLORS[opp.confidence_level];
  return (
    <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: `${conf}20`, background: `${conf}05` }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[8.5px] font-black text-white">{OPPORTUNITY_CATEGORY_LABELS[opp.category]}</div>
          <div className="text-[7px] font-mono text-gray-700">{opp.opportunity_id}</div>
        </div>
        <span className="text-[6.5px] font-black px-1.5 py-0.5 rounded-full border flex-shrink-0"
          style={{ borderColor: `${conf}30`, color: conf, background: `${conf}15` }}>
          {opp.confidence_level.toUpperCase()} CONFIDENCE
        </span>
      </div>
      <p className="text-[8px] text-gray-500 leading-relaxed">{opp.reason}</p>
      <div className="text-[7px] text-gray-800 font-mono px-1.5 py-1 rounded bg-white/[0.03] border border-white/5">
        Trigger: {opp.trigger}
      </div>
      <div className="grid grid-cols-4 gap-1">
        {[
          { label: 'Est. Gain/Qtr',   value: fmtCurrency(opp.estimated_gain), color: GREEN  },
          { label: 'Est. Cost',       value: fmtCurrency(opp.estimated_cost),  color: RED    },
          { label: 'Est. ROI',        value: `${opp.roi_estimate_pct}%`,       color: ACCENT },
          { label: 'Payback',         value: `${opp.payback_weeks}w`,          color: YELLOW },
        ].map(kv => (
          <div key={kv.label} className="text-center">
            <div className="text-[9px] font-black" style={{ color: kv.color }}>{kv.value}</div>
            <div className="text-[6px] uppercase tracking-wide text-gray-800">{kv.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OpportunitiesSection({ report }: { report: QBRReport }) {
  const opps = report.sections.opportunities;
  return (
    <Card accent={ORANGE}>
      <SectionHeader icon={Target} title="Opportunities for Next Quarter" badge={`${opps.length} identified`} accent={ORANGE} />
      <div className="p-4 space-y-3">
        {opps.length === 0
          ? <div className="text-center py-4 text-[9px] text-gray-700">No expansion opportunities identified this period.</div>
          : opps.map(opp => <OpportunityCard key={opp.opportunity_id} opp={opp} />)
        }
        {opps.length > 0 && (
          <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-white/5 text-[8px]">
            <span className="text-gray-700">Combined estimated gain:</span>
            <span className="font-black" style={{ color: GREEN }}>
              {fmtCurrency(opps.reduce((s, o) => s + o.estimated_gain, 0))}/quarter
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// EXPANSION PATH
// ════════════════════════════════════════════════════════════════════════════════

function ExpansionPathSection({ report }: { report: QBRReport }) {
  const e = report.sections.expansion_path;
  return (
    <Card accent={PURPLE}>
      <SectionHeader icon={TrendingUp} title="Recommended Expansion Path" accent={PURPLE}
        badge={e.contract_expansion_flag ? 'Contract Expansion Flag' : undefined} />
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <KPITile label="Est. Additional Value"  value={fmtCurrency(e.estimated_additional_value)}  color={GREEN}   sub="annualised" />
          <KPITile label="Workstreams"            value={`${e.recommended_workstreams.length}`}       color={PURPLE}  sub="recommended" />
          <KPITile label="Timeline"               value={e.suggested_timeline.split('·')[0].trim()}   color={ACCENT}  sub="to proposal" />
        </div>
        <div className="px-3 py-2.5 rounded-xl border text-[8.5px] text-gray-500 leading-relaxed"
          style={{ borderColor: `${PURPLE}18`, background: `${PURPLE}05` }}>
          {e.rationale}
        </div>
        <div>
          <div className="text-[7.5px] font-bold text-gray-700 uppercase tracking-wide mb-2">Recommended Workstreams</div>
          <div className="space-y-1">
            {e.recommended_workstreams.map((ws, i) => (
              <div key={i} className="flex items-center gap-2 text-[8px] text-gray-500">
                <ChevronRight className="size-2.5 flex-shrink-0" style={{ color: PURPLE }} />{ws}
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border text-[8px]"
          style={{ borderColor: `${ACCENT}20`, background: `${ACCENT}06` }}>
          <Clock className="size-3 flex-shrink-0" style={{ color: ACCENT }} />
          <span className="text-gray-500">{e.suggested_timeline}</span>
        </div>
        {e.contract_expansion_flag && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border text-[8px]"
            style={{ borderColor: `${YELLOW}20`, background: `${YELLOW}06` }}>
            <Flag className="size-3 flex-shrink-0" style={{ color: YELLOW }} />
            <span className="font-bold" style={{ color: YELLOW }}>Contract expansion flagged — estimated additional value exceeds $50K/year</span>
          </div>
        )}
      </div>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN PANEL
// ════════════════════════════════════════════════════════════════════════════════

interface QBRPanelProps {
  project: ExecutionProject;
}

export function QBRPanel({ project }: QBRPanelProps) {
  const roiState = useMemo(() => buildMockROIActualsState(project), [project]);
  const blockers = useMemo(() => checkGenerationBlockers(project, roiState), [project, roiState]);

  const [report, setReport] = useState<QBRReport | null>(null);
  const [generating, setGenerating] = useState(false);

  function handleGenerate() {
    setGenerating(true);
    // Simulate a brief generation delay for UX
    setTimeout(() => {
      setReport(buildMockQBRReport(project, roiState));
      setGenerating(false);
    }, 800);
  }

  function handleAdvanceStatus() {
    if (!report) return;
    setReport(prev => prev ? advanceQBRStatus(prev) : prev);
  }

  function handleExport() {
    if (!report) return;
    const text = buildQBRExportText(report);
    const blob  = new Blob([text], { type: 'text/plain' });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.href      = url;
    a.download  = `${report.qbr_id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExportJSON() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${report.qbr_id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">

      {/* ── Generation Trigger Panel ─────────────────────────────────────────── */}
      <Card accent={GOLD}>
        <SectionHeader icon={FileText} title="QBR Generator" badge="Quarterly Business Review" accent={GOLD}>
          {report && (
            <div className="flex items-center gap-2">
              <button onClick={handleExport}
                className="flex items-center gap-1 text-[7.5px] font-bold px-2 py-1 rounded-lg border transition-colors"
                style={{ borderColor: `${GREEN}30`, color: GREEN, background: `${GREEN}10` }}>
                <Download className="size-2.5" />Export .txt
              </button>
              <button onClick={handleExportJSON}
                className="flex items-center gap-1 text-[7.5px] font-bold px-2 py-1 rounded-lg border transition-colors"
                style={{ borderColor: `${ACCENT}30`, color: ACCENT, background: `${ACCENT}10` }}>
                <Download className="size-2.5" />Export .json
              </button>
              <button onClick={handleGenerate}
                className="flex items-center gap-1 text-[7.5px] font-bold px-2 py-1 rounded-lg border transition-colors"
                style={{ borderColor: `${YELLOW}30`, color: YELLOW, background: `${YELLOW}10` }}>
                <RefreshCw className="size-2.5" />Regenerate
              </button>
            </div>
          )}
        </SectionHeader>

        <div className="p-4 space-y-3">
          {/* System overview */}
          <div className="text-[8.5px] text-gray-600 leading-relaxed">
            The QBR Engine pulls from all 4 delivery engines: <span className="text-white font-bold">Execution Progress</span> ·{' '}
            <span className="text-white font-bold">Live ROI Actuals</span> ·{' '}
            <span className="text-white font-bold">Agent Health</span> ·{' '}
            <span className="text-white font-bold">Scope Control History</span>.{' '}
            Output is a board-ready report with opportunity signals for expansion.
          </div>

          {/* Blocker check */}
          {blockers.length > 0 ? (
            <div className="space-y-1.5">
              <div className="text-[7.5px] font-bold uppercase tracking-wide" style={{ color: RED }}>⛔ Generation Blocked</div>
              {blockers.map((b, i) => (
                <div key={i} className="flex items-start gap-1.5 px-3 py-2 rounded-lg border border-red-500/15 bg-red-500/05 text-[8px] text-gray-500">
                  <XCircle className="size-2.5 flex-shrink-0 mt-0.5" style={{ color: RED }} />{b}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[8px]">
              <CheckCircle2 className="size-3" style={{ color: GREEN }} />
              <span className="text-gray-600">All generation checks passed — ready to generate QBR</span>
            </div>
          )}

          {/* Trigger info grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'ROI Months',      value: `${roiState.actuals.length} submitted`,  color: roiState.actuals.length > 0 ? GREEN : ORANGE  },
              { label: 'Baseline',        value: roiState.baseline.baseline_quality,       color: GREEN   },
              { label: 'Exec Status',     value: project.status,                           color: project.status === 'active' ? GREEN : ORANGE  },
              { label: 'Trigger',         value: report ? 'Manual' : 'On Demand',          color: ACCENT  },
            ].map(kv => (
              <div key={kv.label} className="flex flex-col gap-0.5 px-2.5 py-2 rounded-lg border border-white/5">
                <span className="text-[8.5px] font-black" style={{ color: kv.color }}>{kv.value}</span>
                <span className="text-[6.5px] uppercase tracking-wide text-gray-700">{kv.label}</span>
              </div>
            ))}
          </div>

          {!report && (
            <button
              onClick={handleGenerate}
              disabled={blockers.length > 0 || generating}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-black text-[9px] border transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                borderColor: `${GOLD}30`,
                color:       blockers.length > 0 ? '#6B7280' : GOLD,
                background:  blockers.length > 0 ? 'transparent' : `${GOLD}10`,
              }}
            >
              {generating
                ? <span className="contents"><RefreshCw className="size-3 animate-spin" />Generating QBR Report…</span>
                : <span className="contents"><FileText className="size-3" />Generate QBR — {project.client_name} · Feb–Mar 2026</span>
              }
            </button>
          )}
        </div>
      </Card>

      {/* ── QBR Report Sections ──────────────────────────────────────────────── */}
      {report && (
        <span className="contents">
          <StatusFlowTracker  report={report} onAdvance={handleAdvanceStatus} />
          <ExecutiveSummaryCard report={report} />
          <DeliverySection    report={report} />
          <FinancialSection   report={report} />
          <OperationalSection report={report} />
          <AgentHealthSection report={report} />
          <RisksSection       report={report} />
          <OpportunitiesSection report={report} />
          <ExpansionPathSection report={report} />

          {/* Footer export row */}
          <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border"
            style={{ borderColor: `${GOLD}20`, background: `${GOLD}05` }}>
            <div className="text-[8px] text-gray-600">
              <span className="font-bold text-white">{report.qbr_id}</span> ·{' '}
              Generated {fmtDate(report.generated_at)} ·{' '}
              Status: <span className="font-bold" style={{ color: QBR_STATUS_COLORS[report.status] }}>{QBR_STATUS_LABELS[report.status]}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={handleExport}
                className="flex items-center gap-1 text-[7.5px] font-bold px-3 py-1.5 rounded-lg border"
                style={{ borderColor: `${GREEN}30`, color: GREEN, background: `${GREEN}10` }}>
                <Download className="size-2.5" />Board Report (.txt)
              </button>
              <button onClick={handleExportJSON}
                className="flex items-center gap-1 text-[7.5px] font-bold px-3 py-1.5 rounded-lg border"
                style={{ borderColor: `${ACCENT}30`, color: ACCENT, background: `${ACCENT}10` }}>
                <Download className="size-2.5" />Data Export (.json)
              </button>
            </div>
          </div>
        </span>
      )}
    </div>
  );
}
