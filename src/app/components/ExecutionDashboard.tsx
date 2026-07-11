/**
 * EXECUTION DASHBOARD — execution-blueprint.md
 *
 * Team-facing project control room, generated from proposal_snapshot.
 * 6 tabs: Overview · Workstreams · Scope Control · Live ROI · Governance · QBR
 *
 * Source rule: all data comes from ExecutionProject (which was built from snapshot).
 * Never reads live proposal blocks.
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  LayoutDashboard, GitBranch, Shield, TrendingUp, Settings2,
  CheckCircle2, XCircle, AlertTriangle, Clock, Lock, Package,
  ChevronDown, ChevronUp, Plus, Edit3, RefreshCw, Download,
  ClipboardList, Zap, Target, DollarSign, Users, BarChart2,
  FileText, Camera, Hash, ArrowRight, AlertCircle, Info,
  Check, Flag, Activity, List, Eye, ShieldAlert, GitPullRequest,
  ChevronRight, RotateCcw, Fingerprint, Layers,
  Bell, TrendingDown, Calendar, Percent,
} from 'lucide-react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import type {
  ExecutionProject, ExecutionTask, ExecutionGate,
  Workstream, Milestone, ChangeOrder, RiskEntry, AuditEntry,
  TaskStatus, GateStatus, WorkstreamStatus, DependencyNode,
} from '@/app/core/executionEngine';
import {
  getExecutionProgress, getWorkstreamProgress, getBlockers,
  getNextSevenDaysTasks, isMilestoneComplete,
} from '@/app/core/executionEngine';
import type {
  ScopeEngineState, ScopeChangeOrder, ScopeDriftEvent, DriftType,
  GuardrailCheck, ProposedScopeChange,
} from '@/app/core/scopeEngine';
import {
  buildMockScopeEngineState, runScopeEngine, advanceChangeOrderFlow,
  processApprovedCO, CO_FLOW_STEPS, CO_FLOW_STEP_LABELS, DRIFT_TYPE_LABELS,
  DRIFT_TYPE_SEVERITY,
} from '@/app/core/scopeEngine';
import type { ROIActualsState, ROIActualMonth, VarianceTag } from '@/app/core/roiActualsEngine';
import {
  buildMockROIActualsState, submitMonthlyActuals, getNextAvailableMonth,
  buildROIChartData, buildPaybackChartData, analyzeVarianceTags,
  formatMonth, VARIANCE_TAG_LABELS, VARIANCE_TAG_COLORS, ALL_VARIANCE_TAGS,
  ALERT_CFG, computeActualGain, computeLaborSavings, computeEfficiencySavings, computeMarginLift,
} from '@/app/core/roiActualsEngine';
import { QBRPanel } from './QBRPanel';

// ════════════════════════════════════════════════════════════════════════════════
// COLOUR CONFIG
// ════════════════════════════════════════════════════════════════════════════════

const ACCENT     = '#06D7F6';
const PURPLE     = '#8B5CF6';
const GREEN      = '#10B981';
const ORANGE     = '#FB923C';
const RED        = '#FD4438';
const YELLOW     = '#F59E0B';

const TASK_STATUS_CFG: Record<TaskStatus, { label: string; color: string; bg: string }> = {
  not_started: { label: 'Not Started', color: '#6B7280', bg: '#6B728020' },
  in_progress: { label: 'In Progress', color: ACCENT,   bg: `${ACCENT}20` },
  blocked:     { label: 'Blocked',     color: RED,      bg: `${RED}20`    },
  complete:    { label: 'Complete',    color: GREEN,     bg: `${GREEN}20`  },
  skipped:     { label: 'Skipped',     color: '#6B7280', bg: '#6B728020'  },
};

const GATE_STATUS_CFG: Record<GateStatus, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  pending: { label: 'Pending', color: YELLOW, icon: Clock       },
  passed:  { label: 'Passed',  color: GREEN,  icon: CheckCircle2 },
  failed:  { label: 'Failed',  color: RED,    icon: XCircle      },
  waived:  { label: 'Waived',  color: '#6B7280', icon: AlertCircle },
};

const GATE_TYPE_CFG: Record<string, { label: string; color: string }> = {
  security:   { label: 'Security',   color: RED    },
  access:     { label: 'Access',     color: ACCENT },
  uat:        { label: 'UAT',        color: PURPLE },
  approval:   { label: 'Approval',   color: YELLOW },
  compliance: { label: 'Compliance', color: ORANGE },
};

const WS_STATUS_CFG: Record<WorkstreamStatus, { label: string; color: string }> = {
  not_started: { label: 'Not Started', color: '#6B7280' },
  in_progress: { label: 'In Progress', color: ACCENT    },
  blocked:     { label: 'Blocked',     color: RED       },
  complete:    { label: 'Complete',    color: GREEN      },
};

const EXEC_STATUS_CFG = {
  active:   { label: 'Active',    color: GREEN  },
  blocked:  { label: 'Blocked',   color: RED    },
  complete: { label: 'Complete',  color: ACCENT },
  on_hold:  { label: 'On Hold',   color: YELLOW },
};

const RISK_SEV_CFG: Record<string, string> = {
  critical: RED, high: ORANGE, medium: YELLOW, low: '#6B7280',
};

const CHANGE_ORDER_CFG: Record<string, { label: string; color: string }> = {
  draft:              { label: 'Draft',            color: '#6B7280' },
  sent:               { label: 'Sent',             color: ACCENT    },
  internal_review:    { label: 'Internal Review',  color: YELLOW    },
  client_approval:    { label: 'Client Approval',  color: ORANGE    },
  snapshot_extension: { label: 'Snapshot Ext.',    color: PURPLE    },
  execution_update:   { label: 'Execution Update', color: ACCENT    },
  approved:           { label: 'Approved',         color: GREEN     },
  rejected:           { label: 'Rejected',         color: RED       },
};

// ════════════════════════════════════════════════════════════════════════════════
// SHARED PRIMITIVES
// ════════════════════════════════════════════════════════════════════════════════

function Card({ children, accent = PURPLE }: { children: React.ReactNode; accent?: string }) {
  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ borderColor: `${accent}25`, background: `${accent}06` }}
    >
      {children}
    </div>
  );
}

function SectionHeader({ icon: Icon, title, badge, accent = ACCENT, children }: {
  icon: React.FC<{ className?: string }>;
  title: string;
  badge?: string;
  accent?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-white/5">
      <Icon className="size-4 flex-shrink-0" style={{ color: accent }} />
      <span className="text-sm font-bold text-white">{title}</span>
      {badge && (
        <span
          className="text-[8px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider border"
          style={{ color: accent, borderColor: `${accent}33`, background: `${accent}14` }}
        >
          {badge}
        </span>
      )}
      {children && <span className="ml-auto flex items-center gap-2">{children}</span>}
    </div>
  );
}

function ProgressBar({ pct, color = ACCENT, h = 4 }: { pct: number; color?: string; h?: number }) {
  return (
    <div className="w-full rounded-full overflow-hidden" style={{ height: h, background: '#ffffff10' }}>
      <div
        className="rounded-full transition-all duration-500"
        style={{ width: `${Math.min(pct, 100)}%`, height: h, background: color }}
      />
    </div>
  );
}

function StatusPill({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="text-[7px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full"
      style={{ background: `${color}20`, color }}
    >
      {label}
    </span>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

// ════════════════════════════════════════════════════════════════════════════════
// TAB 1 — OVERVIEW
// ════════════════════════════════════════════════════════════════════════════════

function OverviewTab({ project }: { project: ExecutionProject }) {
  const overallPct = getExecutionProgress(project);
  const blockers   = getBlockers(project);
  const next7      = getNextSevenDaysTasks(project.tasks);

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Overall Progress', value: `${overallPct}%`,            color: overallPct === 100 ? GREEN : ACCENT },
          { label: 'Tasks Complete',   value: `${project.tasks.filter(t => t.status === 'complete').length} / ${project.tasks.length}`, color: GREEN  },
          { label: 'Gates Pending',    value: `${project.gates.filter(g => g.status === 'pending').length}`,                           color: YELLOW },
          { label: 'Open Blockers',    value: `${blockers.length}`,         color: blockers.length > 0 ? RED : GREEN },
        ].map(m => (
          <div
            key={m.label}
            className="flex flex-col gap-1.5 px-4 py-3 rounded-xl border"
            style={{ borderColor: `${m.color}25`, background: `${m.color}08` }}
          >
            <span className="text-xl font-black" style={{ color: m.color }}>{m.value}</span>
            <span className="text-[8px] uppercase tracking-wide text-gray-700">{m.label}</span>
          </div>
        ))}
      </div>

      {/* Workstream progress cards */}
      <Card accent={ACCENT}>
        <SectionHeader icon={GitBranch} title="Workstream Progress" accent={ACCENT} />
        <div className="p-4 space-y-3">
          {project.workstreams.map(ws => {
            const pct    = getWorkstreamProgress(ws.workstream_id, project.tasks);
            const cfg    = WS_STATUS_CFG[ws.status];
            return (
              <div key={ws.workstream_id} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-white">{ws.title}</span>
                    <StatusPill label={cfg.label} color={cfg.color} />
                  </div>
                  <span className="text-[9px] text-gray-600">{pct}%</span>
                </div>
                <ProgressBar pct={pct} color={cfg.color} h={5} />
                <div className="flex items-center gap-3 text-[8px] text-gray-700">
                  <span>Weeks {ws.start_week}–{ws.end_week}</span>
                  <span>·</span>
                  <span>{ws.owner_role}</span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Milestone timeline strip */}
      <Card accent={PURPLE}>
        <SectionHeader icon={Flag} title="Milestone Timeline" accent={PURPLE} />
        <div className="p-4 overflow-x-auto">
          <div className="flex gap-2 min-w-max">
            {project.milestones.map((ms, i) => {
              const isComplete = isMilestoneComplete(ms.milestone_id, project.tasks, project.gates);
              const color      = isComplete ? GREEN : ms.status === 'in_progress' ? ACCENT : '#374151';
              return (
                <div
                  key={ms.milestone_id}
                  className="flex flex-col items-center gap-2 relative"
                  style={{ minWidth: 110 }}
                >
                  {/* Connector */}
                  {i > 0 && (
                    <div
                      className="absolute top-5 right-full w-2 h-px"
                      style={{ background: '#374151' }}
                    />
                  )}
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center font-black text-sm border-2 transition-colors"
                    style={{
                      borderColor: color,
                      background:  `${color}18`,
                      color,
                    }}
                  >
                    {isComplete ? <Check className="size-4" /> : ms.phase_number}
                  </div>
                  <div className="text-[8px] font-bold text-center text-white leading-tight">{ms.title}</div>
                  <div className="text-[7px] text-gray-700 text-center">{ms.duration}</div>
                  {ms.governance_checkpoint && (
                    <div
                      className="text-[6px] px-1.5 py-0.5 rounded-full text-center"
                      style={{ background: `${YELLOW}20`, color: YELLOW }}
                    >
                      ✓ {ms.governance_checkpoint}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Current blockers */}
      {blockers.length > 0 && (
        <Card accent={RED}>
          <SectionHeader icon={AlertTriangle} title="Current Blockers" badge={`${blockers.length}`} accent={RED} />
          <div className="p-4 space-y-2">
            {blockers.map(b => (
              <div
                key={b.id}
                className="flex items-start gap-3 px-3 py-2.5 rounded-lg border"
                style={{ borderColor: `${RED}30`, background: `${RED}08` }}
              >
                <XCircle className="size-3.5 text-[#FD4438] flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-[9px] font-bold text-white">{b.title}</div>
                  <div className="text-[8px] text-gray-600 mt-0.5">{b.reason}</div>
                  <div
                    className="text-[7px] mt-0.5 uppercase tracking-wide"
                    style={{ color: RED }}
                  >{b.type}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Next 7 days tasks */}
      <Card accent={GREEN}>
        <SectionHeader icon={Clock} title="Next 7 Days" badge={`${next7.length} tasks`} accent={GREEN} />
        {next7.length === 0 ? (
          <div className="p-5 text-center text-[9px] text-gray-700">No tasks due in the next 7 days.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[9px]">
              <thead>
                <tr className="border-b border-white/5">
                  {['Task', 'Workstream', 'Owner', 'Due', 'Priority', 'Status'].map(h => (
                    <th key={h} className="px-4 py-2 text-left text-[8px] font-bold text-gray-700 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {next7.map(task => {
                  const ws  = project.workstreams.find(w => w.workstream_id === task.workstream_id);
                  const cfg = TASK_STATUS_CFG[task.status];
                  const pri = { critical: RED, high: ORANGE, medium: YELLOW, low: '#6B7280' }[task.priority];
                  return (
                    <tr key={task.task_id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-2.5 font-medium text-white">{task.title}</td>
                      <td className="px-4 py-2.5 text-gray-600">{ws?.title ?? '—'}</td>
                      <td className="px-4 py-2.5 text-gray-600">{task.owner}</td>
                      <td className="px-4 py-2.5 text-gray-600">{fmtDate(task.due_date)}</td>
                      <td className="px-4 py-2.5">
                        <span className="font-bold capitalize" style={{ color: pri }}>{task.priority}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusPill label={cfg.label} color={cfg.color} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// TAB 2 — WORKSTREAMS
// ════════════════════════════════════════════════════════════════════════════════

function WorkstreamCard({
  ws, milestones, tasks, gates, onRequestChange,
}: {
  ws:             Workstream;
  milestones:     Milestone[];
  tasks:          ExecutionTask[];
  gates:          ExecutionGate[];
  onRequestChange: (wsId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const cfg = WS_STATUS_CFG[ws.status];
  const pct = getWorkstreamProgress(ws.workstream_id, tasks);

  const wsTasks     = tasks.filter(t => t.workstream_id === ws.workstream_id);
  const wsMilestones = milestones.filter(m => m.workstream_id === ws.workstream_id);
  const wsGates     = gates.filter(g => wsMilestones.some(m => m.milestone_id === g.milestone_id));

  return (
    <Card accent={ACCENT}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/5">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs"
          style={{ background: `${cfg.color}20`, color: cfg.color }}
        >
          {pct}%
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold text-white">{ws.title}</span>
            <StatusPill label={cfg.label} color={cfg.color} />
          </div>
          <div className="text-[8px] text-gray-700 mt-0.5">Weeks {ws.start_week}–{ws.end_week} · {ws.owner_role}</div>
        </div>
        <button
          onClick={() => onRequestChange(ws.workstream_id)}
          className="flex items-center gap-1 text-[8px] font-bold px-2 py-1 rounded-lg border transition-colors"
          style={{ borderColor: `${YELLOW}30`, color: YELLOW, background: `${YELLOW}10` }}
        >
          <Plus className="size-2.5" />Scope Change
        </button>
        <button onClick={() => setExpanded(e => !e)} className="p-1 text-gray-700 hover:text-white transition-colors">
          {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      </div>

      {expanded && (
        <div className="p-5 space-y-4">
          {/* Scope summary (from snapshot — immutable) */}
          <div>
            <div className="text-[8px] font-bold text-gray-700 uppercase tracking-wide mb-1 flex items-center gap-1">
              <Lock className="size-2.5" />Scope Summary (frozen from snapshot)
            </div>
            <p className="text-[9px] text-gray-500 leading-relaxed">{ws.scope_summary}</p>
            {ws.diagnosis_link && (
              <div className="mt-1.5 text-[8px] flex items-center gap-1.5 text-gray-700">
                <Target className="size-2.5" />Addresses: <span className="text-gray-500">{ws.diagnosis_link}</span>
              </div>
            )}
          </div>

          {/* Progress bar */}
          <ProgressBar pct={pct} color={cfg.color} h={4} />

          {/* Tasks */}
          <div>
            <div className="text-[8px] font-bold text-gray-700 uppercase tracking-wide mb-2">Tasks ({wsTasks.length})</div>
            <div className="space-y-1.5">
              {wsTasks.map(task => {
                const tcfg = TASK_STATUS_CFG[task.status];
                const pri  = { critical: RED, high: ORANGE, medium: YELLOW, low: '#6B7280' }[task.priority];
                return (
                  <div
                    key={task.task_id}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg border"
                    style={{ borderColor: `${tcfg.color}20`, background: `${tcfg.color}06` }}
                  >
                    <div className="size-4 rounded-full border flex-shrink-0 flex items-center justify-center"
                      style={{ borderColor: tcfg.color }}>
                      {task.status === 'complete' && <Check className="size-2.5" style={{ color: tcfg.color }} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[9px] font-medium text-white">{task.title}</div>
                      <div className="text-[7px] text-gray-700">{task.owner} · Due {fmtDate(task.due_date)}</div>
                    </div>
                    <span style={{ color: pri }} className="text-[7px] font-bold capitalize">{task.priority}</span>
                    <StatusPill label={tcfg.label} color={tcfg.color} />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Gates */}
          {wsGates.length > 0 && (
            <div>
              <div className="text-[8px] font-bold text-gray-700 uppercase tracking-wide mb-2">Gates & Dependencies</div>
              <div className="space-y-1.5">
                {wsGates.map(gate => {
                  const gcfg = GATE_STATUS_CFG[gate.status];
                  const GIcon = gcfg.icon;
                  const tCfg = GATE_TYPE_CFG[gate.type] ?? { label: gate.type, color: ACCENT };
                  return (
                    <div
                      key={gate.gate_id}
                      className="flex items-start gap-3 px-3 py-2 rounded-lg border"
                      style={{ borderColor: `${gcfg.color}25`, background: `${gcfg.color}06` }}
                    >
                      <GIcon className="size-3.5 flex-shrink-0 mt-0.5" style={{ color: gcfg.color }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[9px] font-bold text-white">{gate.title}</span>
                          <StatusPill label={tCfg.label} color={tCfg.color} />
                          {gate.required && <span className="text-[7px] text-gray-700">Required</span>}
                        </div>
                        <div className="text-[8px] text-gray-600 mt-0.5 leading-relaxed">{gate.description}</div>
                        {gate.passed_by && (
                          <div className="text-[7px] text-gray-800 mt-0.5">
                            Passed by {gate.passed_by} · {gate.passed_at ? fmtDate(gate.passed_at) : ''}
                          </div>
                        )}
                      </div>
                      <StatusPill label={gcfg.label} color={gcfg.color} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// DEPENDENCY GRAPH PANEL — Step 8 (mapping-engine-process.md)
// ════════════════════════════════════════════════════════════════════════════════

function DependencyGraphPanel({ project }: { project: ExecutionProject }) {
  const [filter, setFilter] = React.useState<'all' | 'task' | 'milestone' | 'gate'>('all');
  const { nodes, critical_path, violations } = project.dependency_graph;
  const filtered = filter === 'all' ? nodes : nodes.filter((n: DependencyNode) => n.type === filter);

  const nodeColor: Record<string, string> = { task: ACCENT, milestone: PURPLE, gate: YELLOW };
  const nodeStatusColor = (status: string) => {
    if (status === 'complete' || status === 'passed') return GREEN;
    if (status === 'in_progress')                    return ACCENT;
    if (status === 'blocked' || status === 'failed') return RED;
    return '#374151';
  };

  return (
    <Card accent={ACCENT}>
      <SectionHeader icon={GitBranch} title="Dependency Graph" badge={`Step 8 · ${nodes.length} nodes`} accent={ACCENT}>
        <div className="flex items-center gap-1">
          {(['all', 'task', 'milestone', 'gate'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className="px-2 py-0.5 rounded text-[7px] font-bold uppercase tracking-wide transition-colors"
              style={{ background: filter === f ? `${ACCENT}20` : 'transparent', color: filter === f ? ACCENT : '#6B7280', border: `1px solid ${filter === f ? `${ACCENT}40` : 'transparent'}` }}
            >{f}</button>
          ))}
        </div>
      </SectionHeader>

      {critical_path.length > 0 && (
        <div className="px-4 py-2 flex items-center gap-2 border-b border-white/5 flex-wrap" style={{ background: `${ORANGE}08` }}>
          <Zap className="size-3 flex-shrink-0" style={{ color: ORANGE }} />
          <span className="text-[8px] font-bold" style={{ color: ORANGE }}>Critical Path ({critical_path.length} ready):</span>
          {critical_path.slice(0, 5).map(id => {
            const n = nodes.find((nd: DependencyNode) => nd.id === id);
            return (
              <span key={id} className="text-[7px] px-1.5 py-0.5 rounded font-mono" style={{ background: `${ORANGE}20`, color: ORANGE }}>
                {n?.label ? (n.label.length > 22 ? n.label.slice(0, 22) + '…' : n.label) : id}
              </span>
            );
          })}
          {critical_path.length > 5 && <span className="text-[7px] text-gray-700">+{critical_path.length - 5} more</span>}
        </div>
      )}

      {violations.length > 0 && (
        <div className="px-4 py-2 border-b border-white/5" style={{ background: `${RED}08` }}>
          <div className="text-[8px] font-bold mb-1" style={{ color: RED }}>⚠ Constraint Violations ({violations.length})</div>
          {violations.map((v: string, i: number) => (
            <div key={i} className="text-[8px] text-gray-600 flex items-center gap-1.5">
              <AlertTriangle className="size-2.5 text-[#FD4438] flex-shrink-0" />{v}
            </div>
          ))}
        </div>
      )}

      <div className="divide-y divide-white/5 max-h-96 overflow-y-auto">
        {filtered.map((node: DependencyNode) => {
          const typeColor   = nodeColor[node.type] ?? ACCENT;
          const statusColor = nodeStatusColor(node.status);
          const isCritical  = critical_path.includes(node.id);
          const depLabels   = node.depends_on
            .map((depId: string) => nodes.find((n: DependencyNode) => n.id === depId)?.label ?? depId)
            .slice(0, 3);
          return (
            <div key={node.id} className="flex items-start gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors"
              style={{ background: isCritical ? `${ORANGE}05` : undefined }}>
              <div className="flex-shrink-0 text-[6px] font-black uppercase tracking-widest px-1.5 py-1 rounded mt-0.5"
                style={{ background: `${typeColor}20`, color: typeColor }}>{node.type.slice(0, 2).toUpperCase()}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[9px] font-medium text-white">{node.label}</span>
                  {isCritical && <Zap className="size-2.5 flex-shrink-0" style={{ color: ORANGE }} />}
                  <span className="text-[7px] font-mono text-gray-800">{node.id}</span>
                </div>
                {depLabels.length > 0 ? (
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <ArrowRight className="size-2.5 text-gray-800 flex-shrink-0" />
                    <span className="text-[7px] text-gray-800">depends on:</span>
                    {depLabels.map((lbl: string, i: number) => (
                      <span key={i} className="text-[7px] px-1 py-0 rounded font-mono" style={{ background: '#ffffff08', color: '#9CA3AF' }}>
                        {lbl.length > 20 ? lbl.slice(0, 20) + '…' : lbl}
                      </span>
                    ))}
                    {node.depends_on.length > 3 && <span className="text-[7px] text-gray-800">+{node.depends_on.length - 3}</span>}
                  </div>
                ) : (
                  <span className="text-[7px] text-gray-800">No dependencies (entry point)</span>
                )}
              </div>
              <div className="flex-shrink-0 w-1.5 h-1.5 rounded-full mt-1.5" style={{ background: statusColor }} />
            </div>
          );
        })}
      </div>

      <div className="px-4 py-2 border-t border-white/5 flex items-center gap-4 flex-wrap">
        {[{ label: 'Task', color: ACCENT }, { label: 'Milestone', color: PURPLE }, { label: 'Gate', color: YELLOW }, { label: 'Critical', color: ORANGE }].map(l => (
          <div key={l.label} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-sm" style={{ background: `${l.color}40`, border: `1px solid ${l.color}` }} />
            <span className="text-[7px] text-gray-700">{l.label}</span>
          </div>
        ))}
        <span className="text-[7px] text-gray-800 ml-auto">
          {nodes.length} nodes · {nodes.reduce((s: number, n: DependencyNode) => s + n.depends_on.length, 0)} edges
        </span>
      </div>
    </Card>
  );
}

function WorkstreamsTab({ project, onRequestChange }: {
  project:         ExecutionProject;
  onRequestChange: (wsId: string) => void;
}) {
  return (
    <div className="space-y-4">
      {project.workstreams.map(ws => (
        <WorkstreamCard
          key={ws.workstream_id}
          ws={ws}
          milestones={project.milestones}
          tasks={project.tasks}
          gates={project.gates}
          onRequestChange={onRequestChange}
        />
      ))}
      {/* Step 8 — Dependency Graph */}
      <DependencyGraphPanel project={project} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// TAB 3 — SCOPE CONTROL (Scope Engine — scope-engine-logic.md)
// ════════════════════════════════════════════════════════════════════════════════

const DRIFT_SEVERITY_COLOR: Record<string, string> = { high: RED, medium: YELLOW, low: '#6B7280' };
const CO_FLOW_STEP_COLOR: Record<string, string> = {
  draft: '#6B7280', internal_review: YELLOW, client_approval: ORANGE,
  snapshot_extension: PURPLE, execution_update: ACCENT,
  approved: GREEN, rejected: RED,
};

function COFlowStepper({ co }: { co: ScopeChangeOrder }) {
  const currentIdx  = CO_FLOW_STEPS.indexOf(co.status as any);
  const isApproved  = co.status === 'approved';
  const isRejected  = co.status === 'rejected';

  return (
    <div className="flex items-center gap-0 overflow-x-auto pb-1 mt-2">
      {CO_FLOW_STEPS.map((step, i) => {
        const isDone    = isApproved || (currentIdx > i);
        const isCurrent = !isApproved && !isRejected && currentIdx === i;
        const isNext    = !isApproved && !isRejected && currentIdx < i;
        const color     = isDone ? GREEN : isCurrent ? ORANGE : '#374151';

        return (
          <span className="contents" key={step}>
            {i > 0 && (
              <div className="flex-shrink-0 h-px w-3" style={{ background: isDone ? `${GREEN}40` : '#374151' }} />
            )}
            <div
              className="flex-shrink-0 flex flex-col items-center gap-0.5"
              style={{ opacity: isRejected && !isDone ? 0.4 : 1 }}
            >
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center text-[7px] font-black border"
                style={{
                  borderColor: color,
                  background:  isDone ? `${GREEN}20` : isCurrent ? `${ORANGE}20` : '#0D0D1A',
                  color,
                }}
              >
                {isDone ? '✓' : i + 1}
              </div>
              <span className="text-[6px] text-gray-700 whitespace-nowrap max-w-[48px] text-center leading-tight">
                {CO_FLOW_STEP_LABELS[step]}
              </span>
            </div>
          </span>
        );
      })}
      {/* Final state */}
      <div className="flex-shrink-0 h-px w-3" style={{ background: isApproved ? `${GREEN}40` : '#374151' }} />
      <div className="flex-shrink-0 flex flex-col items-center gap-0.5">
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center text-[7px] font-black border"
          style={{
            borderColor: isApproved ? GREEN : isRejected ? RED : '#374151',
            background:  isApproved ? `${GREEN}20` : isRejected ? `${RED}20` : '#0D0D1A',
            color:       isApproved ? GREEN : isRejected ? RED : '#6B7280',
          }}
        >
          {isApproved ? '✓' : isRejected ? '✗' : '●'}
        </div>
        <span className="text-[6px] whitespace-nowrap" style={{ color: isApproved ? GREEN : isRejected ? RED : '#6B7280' }}>
          {isApproved ? 'Approved' : isRejected ? 'Rejected' : 'Final'}
        </span>
      </div>
    </div>
  );
}

type ChangeTypeOption = { value: DriftType; label: string };
const CHANGE_TYPE_OPTIONS: ChangeTypeOption[] = [
  { value: 'new_workstream',               label: 'Add New Workstream'       },
  { value: 'new_integration',              label: 'Add New Integration'      },
  { value: 'feature_not_in_baseline',      label: 'Add Feature (out of scope)' },
  { value: 'timeline_extended',            label: 'Extend Timeline'          },
  { value: 'workstream_duration_extended', label: 'Extend Workstream Duration' },
  { value: 'cost_changed',                 label: 'Change Investment Total'  },
  { value: 'task_count_increase',          label: 'Increase Task Count'      },
];

function ScopeControlTab({ project }: { project: ExecutionProject }) {
  const sb = project.scope_boundaries;
  const roi = project.baseline.metrics_snapshot.roi_12m_percent;

  // Scope Engine state
  const [engineState, setEngineState] = useState<ScopeEngineState>(() =>
    buildMockScopeEngineState(project)
  );

  // Guardrail popup
  const [guardrailResult, setGuardrailResult] = useState<ReturnType<typeof runScopeEngine> | null>(null);
  const [showProposePanel, setShowProposePanel] = useState(false);

  // Propose form
  const [proposeForm, setProposeForm] = useState<{
    description: string; change_type: DriftType;
    additional_weeks: string; additional_cost: string;
    new_workstream: string; new_integration: string; new_feature: string;
  }>({
    description: '', change_type: 'new_integration',
    additional_weeks: '', additional_cost: '',
    new_workstream: '', new_integration: '', new_feature: '',
  });

  const unresolvedDrift = engineState.drift_log.filter(d => !d.resolved);
  const openCOs         = engineState.scope_change_orders.filter(co => co.status !== 'approved' && co.status !== 'rejected');

  function handleCheckGuardrails() {
    const proposed: ProposedScopeChange = {
      description:       proposeForm.description || 'Scope change proposed',
      change_type:       proposeForm.change_type,
      new_workstream:    proposeForm.new_workstream || undefined,
      new_integration:   proposeForm.new_integration || undefined,
      new_feature:       proposeForm.new_feature || undefined,
      additional_weeks:  proposeForm.additional_weeks ? Number(proposeForm.additional_weeks) : undefined,
      additional_cost:   proposeForm.additional_cost  ? Number(proposeForm.additional_cost)  : undefined,
    };
    const result = runScopeEngine(engineState, proposed, 'U-01');
    setGuardrailResult(result);
  }

  function handleCreateCO() {
    if (!guardrailResult) return;
    setEngineState(guardrailResult.state);
    setGuardrailResult(null);
    setShowProposePanel(false);
    setProposeForm({ description: '', change_type: 'new_integration', additional_weeks: '', additional_cost: '', new_workstream: '', new_integration: '', new_feature: '' });
  }

  function handleAdvanceCO(coId: string, action: 'advance' | 'reject') {
    setEngineState(prev => ({
      ...prev,
      scope_change_orders: prev.scope_change_orders.map(co =>
        co.change_order_id === coId ? advanceChangeOrderFlow(co, action, 'Account Lead') : co
      ),
    }));
  }

  function handleApproveCO(coId: string) {
    setEngineState(prev => processApprovedCO(prev, coId, roi, 'Account Lead'));
  }

  return (
    <div className="space-y-4">

      {/* ── Engine Status Header ─────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border flex-wrap"
        style={{
          borderColor: engineState.is_paused ? `${RED}30` : unresolvedDrift.length > 0 ? `${ORANGE}30` : `${GREEN}30`,
          background:  engineState.is_paused ? `${RED}06` : unresolvedDrift.length > 0 ? `${ORANGE}06` : `${GREEN}06`,
        }}
      >
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-4 flex-shrink-0" style={{ color: engineState.is_paused ? RED : unresolvedDrift.length > 0 ? ORANGE : GREEN }} />
          <div>
            <div className="text-[10px] font-black text-white">Scope Engine</div>
            <div className="text-[8px] text-gray-600">
              {engineState.is_paused
                ? 'Execution paused — unresolved high-severity drift'
                : unresolvedDrift.length > 0
                ? `${unresolvedDrift.length} unresolved drift event(s) — change order required`
                : 'All clear — no scope drift detected'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-center">
            <div className="text-[11px] font-black" style={{ color: ACCENT }}>v{engineState.execution_version}</div>
            <div className="text-[7px] text-gray-700 uppercase tracking-wide">Exec Version</div>
          </div>
          <div className="text-center">
            <div className="text-[11px] font-black" style={{ color: PURPLE }}>v{engineState.linked_snapshot_version}</div>
            <div className="text-[7px] text-gray-700 uppercase tracking-wide">Snapshot</div>
          </div>
          <div className="text-center">
            <div className="text-[11px] font-black" style={{ color: unresolvedDrift.length > 0 ? ORANGE : GREEN }}>{unresolvedDrift.length}</div>
            <div className="text-[7px] text-gray-700 uppercase tracking-wide">Open Drift</div>
          </div>
          <div className="text-center">
            <div className="text-[11px] font-black" style={{ color: openCOs.length > 0 ? YELLOW : GREEN }}>{openCOs.length}</div>
            <div className="text-[7px] text-gray-700 uppercase tracking-wide">Open COs</div>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: engineState.guardrails_active ? GREEN : '#374151' }} />
            <span className="text-[7px] text-gray-700">Guardrails {engineState.guardrails_active ? 'Active' : 'Off'}</span>
          </div>
        </div>
      </div>

      {/* ── Step 1: Scope Baseline Lock ──────────────────────────────────────── */}
      <Card accent={GREEN}>
        <SectionHeader icon={Fingerprint} title="Scope Baseline Lock (Step 1)" accent={GREEN}
          badge={`v${project.version_number} · ${project.proposal_snapshot_id}`}
        />
        <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2 flex-wrap" style={{ background: `${GREEN}05` }}>
          <Lock className="size-3 text-[#10B981] flex-shrink-0" />
          <span className="text-[8px] font-mono text-gray-600 break-all">{engineState.scope_baseline.baseline_hash}</span>
          <span className="text-[7px] text-gray-800 ml-auto">Locked {fmtDate(engineState.scope_baseline.locked_at)}</span>
        </div>
        <div className="p-4 grid grid-cols-3 gap-2 border-b border-white/5">
          {[
            { label: 'Timeline Weeks',   value: `${engineState.scope_baseline.timeline_weeks}w`,                                  color: ACCENT  },
            { label: 'Investment Total', value: fmtCurrency(engineState.scope_baseline.investment_total),                          color: GREEN   },
            { label: 'Task Baseline',    value: `${engineState.scope_baseline.task_count_baseline} tasks`,                         color: PURPLE  },
            { label: 'Workstreams',      value: `${engineState.scope_baseline.included_workstreams.length}`,                       color: ORANGE  },
            { label: 'Integrations',     value: `${engineState.scope_baseline.included_integrations.length}`,                      color: YELLOW  },
            { label: 'Features',         value: `${engineState.scope_baseline.included_features.length}`,                          color: '#6B7280' },
          ].map(kv => (
            <div key={kv.label} className="flex flex-col gap-0.5 px-2 py-1.5 rounded-lg border"
              style={{ borderColor: `${kv.color}20`, background: `${kv.color}06` }}>
              <span className="text-[11px] font-black" style={{ color: kv.color }}>{kv.value}</span>
              <span className="text-[7px] uppercase tracking-wide text-gray-700">{kv.label}</span>
            </div>
          ))}
        </div>
        <div className="p-4 space-y-3">
          <div>
            <div className="text-[8px] font-bold text-[#10B981] uppercase tracking-wide mb-2">✓ Included Scope ({sb.scope_included.length})</div>
            <div className="space-y-1">
              {sb.scope_included.map((item, i) => (
                <div key={i} className="flex items-start gap-2 text-[9px] text-gray-500">
                  <CheckCircle2 className="size-3 text-[#10B981] flex-shrink-0 mt-0.5" />{item}
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="text-[8px] font-bold text-[#FD4438] uppercase tracking-wide mb-1">✗ Excluded ({sb.scope_excluded.length})</div>
              {sb.scope_excluded.map((item, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[8px] text-gray-600 mb-0.5">
                  <XCircle className="size-2.5 text-[#FD4438] flex-shrink-0 mt-0.5" />{item}
                </div>
              ))}
            </div>
            <div>
              <div className="text-[8px] font-bold text-[#06D7F6] uppercase tracking-wide mb-1">⚡ Integration Points ({sb.integration_points.length})</div>
              {sb.integration_points.map((item, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[8px] text-gray-600 mb-0.5">
                  <Zap className="size-2.5 text-[#06D7F6] flex-shrink-0 mt-0.5" />{item}
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[8px] font-bold text-[#F59E0B] uppercase tracking-wide mb-1">⚑ Assumptions ({sb.assumptions.length})</div>
            {sb.assumptions.map((item, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[8px] text-gray-600 mb-0.5">
                <AlertCircle className="size-2.5 text-[#F59E0B] flex-shrink-0 mt-0.5" />{item}
              </div>
            ))}
          </div>
        </div>
        <div className="px-4 pb-3 border-t border-white/5 pt-3 text-[8px] text-gray-800 flex items-center gap-1.5">
          <Lock className="size-2.5" />
          Baseline frozen via Mapping Engine Step 7 → locked here as Scope Engine Step 1 anchor.
          Hash detects any tampering. New integrations trigger the scope engine.
        </div>
      </Card>

      {/* ── Step 6: Hard Guardrails + Step 8: Propose Change UI ─────────────── */}
      <Card accent={ORANGE}>
        <SectionHeader icon={ShieldAlert} title="Hard Guardrails (Steps 6 + 8)" accent={ORANGE}
          badge={engineState.guardrails_active ? 'ACTIVE' : 'DISABLED'}
        >
          <button
            onClick={() => { setShowProposePanel(p => !p); setGuardrailResult(null); }}
            className="flex items-center gap-1 text-[8px] font-bold px-2 py-1 rounded-lg border"
            style={{ borderColor: `${ORANGE}30`, color: ORANGE, background: `${ORANGE}10` }}
          >
            <Plus className="size-2.5" />Propose Scope Change
          </button>
        </SectionHeader>

        {/* Step 6 guardrail rules */}
        <div className="px-4 pt-3 pb-2">
          <div className="text-[8px] font-bold text-gray-700 uppercase tracking-wide mb-2">Blocked without Change Order:</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
            {[
              'Add integration silently',
              'Extend timeline silently',
              'Add agent or automation silently',
              'Add workstream silently',
              'Modify baseline without change order',
              'Add feature not in signed scope',
            ].map((rule, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[8px] text-gray-600">
                <XCircle className="size-2.5 flex-shrink-0" style={{ color: RED }} />{rule}
              </div>
            ))}
          </div>
        </div>

        {/* Step 8 — Propose Change Form */}
        {showProposePanel && (
          <div className="mx-4 mb-4 rounded-xl border p-4 space-y-3" style={{ borderColor: `${ORANGE}25`, background: `${ORANGE}06` }}>
            <div className="text-[9px] font-bold text-white">Propose Scope Change</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2 space-y-1">
                <label className="text-[8px] font-bold text-gray-700 uppercase tracking-wide">Change Type</label>
                <select
                  value={proposeForm.change_type}
                  onChange={e => setProposeForm(p => ({ ...p, change_type: e.target.value as DriftType }))}
                  className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-[9px] text-white focus:outline-none focus:border-orange-500/50"
                >
                  {CHANGE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2 space-y-1">
                <label className="text-[8px] font-bold text-gray-700 uppercase tracking-wide">Description / Reason</label>
                <input
                  type="text"
                  value={proposeForm.description}
                  onChange={e => setProposeForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="Describe the requested change..."
                  className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-[9px] text-white focus:outline-none focus:border-orange-500/50 placeholder:text-gray-700"
                />
              </div>
              {(proposeForm.change_type === 'new_integration') && (
                <div className="sm:col-span-2 space-y-1">
                  <label className="text-[8px] font-bold text-gray-700 uppercase tracking-wide">Integration Name</label>
                  <input type="text" value={proposeForm.new_integration} onChange={e => setProposeForm(p => ({ ...p, new_integration: e.target.value }))} placeholder="e.g. Slack API, Salesforce connector…" className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-[9px] text-white focus:outline-none focus:border-orange-500/50 placeholder:text-gray-700" />
                </div>
              )}
              {(proposeForm.change_type === 'new_workstream') && (
                <div className="sm:col-span-2 space-y-1">
                  <label className="text-[8px] font-bold text-gray-700 uppercase tracking-wide">Workstream Name</label>
                  <input type="text" value={proposeForm.new_workstream} onChange={e => setProposeForm(p => ({ ...p, new_workstream: e.target.value }))} placeholder="e.g. Customer Portal Module…" className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-[9px] text-white focus:outline-none focus:border-orange-500/50 placeholder:text-gray-700" />
                </div>
              )}
              {(proposeForm.change_type === 'feature_not_in_baseline') && (
                <div className="sm:col-span-2 space-y-1">
                  <label className="text-[8px] font-bold text-gray-700 uppercase tracking-wide">Feature Name</label>
                  <input type="text" value={proposeForm.new_feature} onChange={e => setProposeForm(p => ({ ...p, new_feature: e.target.value }))} placeholder="e.g. Mobile push notifications…" className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-[9px] text-white focus:outline-none focus:border-orange-500/50 placeholder:text-gray-700" />
                </div>
              )}
              <div className="space-y-1">
                <label className="text-[8px] font-bold text-gray-700 uppercase tracking-wide">Additional Weeks</label>
                <input type="number" min="0" value={proposeForm.additional_weeks} onChange={e => setProposeForm(p => ({ ...p, additional_weeks: e.target.value }))} placeholder="0" className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-[9px] text-white focus:outline-none focus:border-orange-500/50 placeholder:text-gray-700" />
              </div>
              <div className="space-y-1">
                <label className="text-[8px] font-bold text-gray-700 uppercase tracking-wide">Additional Cost ($)</label>
                <input type="number" min="0" value={proposeForm.additional_cost} onChange={e => setProposeForm(p => ({ ...p, additional_cost: e.target.value }))} placeholder="0" className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-[9px] text-white focus:outline-none focus:border-orange-500/50 placeholder:text-gray-700" />
              </div>
            </div>

            {/* Guardrail result */}
            {guardrailResult && (
              <div
                className="rounded-xl border p-4 space-y-2"
                style={{ borderColor: `${RED}30`, background: `${RED}08` }}
              >
                <div className="flex items-center gap-2">
                  <ShieldAlert className="size-3.5 flex-shrink-0" style={{ color: RED }} />
                  <span className="text-[10px] font-black" style={{ color: RED }}>This change is outside signed scope.</span>
                </div>
                <div className="space-y-1">
                  {guardrailResult.guardrail.reasons.map((r, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[8px] text-gray-500">
                      <AlertTriangle className="size-2.5 flex-shrink-0 mt-0.5" style={{ color: ORANGE }} />{r}
                    </div>
                  ))}
                </div>
                {guardrailResult.drift_event && (
                  <div className="text-[8px] text-gray-600 pt-1">
                    <span className="font-bold text-white">Drift Detected: </span>{guardrailResult.drift_event.description}
                  </div>
                )}
                {guardrailResult.change_order && (
                  <div className="text-[8px] text-gray-600">
                    <span className="font-bold text-white">Auto-generated CO: </span>
                    {guardrailResult.change_order.change_order_id} ·
                    +{guardrailResult.change_order.impact_analysis.additional_weeks}w ·
                    +{fmtCurrency(guardrailResult.change_order.impact_analysis.additional_cost)}
                    {guardrailResult.change_order.impact_analysis.roi_adjustment_required && <span className="ml-1 text-[#F59E0B]">· ROI recalc required</span>}
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <button onClick={handleCreateCO}
                    className="flex items-center gap-1 text-[8px] font-bold px-3 py-1.5 rounded-lg border"
                    style={{ borderColor: `${ORANGE}30`, color: ORANGE, background: `${ORANGE}10` }}
                  ><GitPullRequest className="size-2.5" />Create Change Order</button>
                  <button onClick={() => setGuardrailResult(null)}
                    className="flex items-center gap-1 text-[8px] font-bold px-3 py-1.5 rounded-lg border"
                    style={{ borderColor: '#374151', color: '#6B7280', background: '#6B728010' }}
                  ><XCircle className="size-2.5" />Cancel Change</button>
                </div>
              </div>
            )}

            {!guardrailResult && (
              <button onClick={handleCheckGuardrails}
                className="flex items-center gap-1 text-[8px] font-bold px-3 py-1.5 rounded-lg border w-full justify-center"
                style={{ borderColor: `${ORANGE}30`, color: ORANGE, background: `${ORANGE}10` }}
              >
                <ShieldAlert className="size-2.5" />Check Guardrails
              </button>
            )}
          </div>
        )}
      </Card>

      {/* ── Step 2: Drift Detection Log ──────────────────────────────────────── */}
      {engineState.drift_log.length > 0 && (
        <Card accent={ORANGE}>
          <SectionHeader icon={AlertTriangle} title="Scope Drift Log (Step 2)" badge={`${engineState.drift_log.length} events`} accent={ORANGE} />
          <div className="divide-y divide-white/5">
            {engineState.drift_log.map(d => (
              <div key={d.drift_id} className="p-4 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-[7px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded"
                      style={{ background: `${DRIFT_SEVERITY_COLOR[d.severity]}20`, color: DRIFT_SEVERITY_COLOR[d.severity] }}
                    >{d.severity}</span>
                    <span className="text-[9px] font-bold text-white">{DRIFT_TYPE_LABELS[d.drift_type]}</span>
                    <span className="font-mono text-[7px] text-gray-800">{d.drift_id}</span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {d.resolved
                      ? <span className="text-[7px] px-1.5 py-0.5 rounded font-bold" style={{ background: `${GREEN}20`, color: GREEN }}>Resolved</span>
                      : <span className="text-[7px] px-1.5 py-0.5 rounded font-bold" style={{ background: `${ORANGE}20`, color: ORANGE }}>Open</span>
                    }
                  </div>
                </div>
                <p className="text-[8px] text-gray-500 leading-relaxed">{d.description}</p>
                <div className="flex items-center gap-2 text-[7px] text-gray-800">
                  <span>Detected {fmtDate(d.detected_at)}</span>
                  {d.auto_co_id && <span>· CO: <span className="font-mono text-[#06D7F6]">{d.auto_co_id}</span></span>}
                  {d.resolved && d.resolved_at && <span>· Resolved {fmtDate(d.resolved_at)} by {d.resolved_by}</span>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Steps 3–4: Scope Change Orders (with flow stepper) ───────────────── */}
      <Card accent={YELLOW}>
        <SectionHeader icon={GitPullRequest} title="Scope Change Orders (Steps 3–4)" badge={`${engineState.scope_change_orders.length}`} accent={YELLOW} />
        {engineState.scope_change_orders.length === 0 ? (
          <div className="p-5 text-center text-[9px] text-gray-700">No scope change orders raised. Propose a scope change above to auto-generate one.</div>
        ) : (
          <div className="p-4 space-y-4">
            {engineState.scope_change_orders.map(co => {
              const isOpen     = co.status !== 'approved' && co.status !== 'rejected';
              const isApproved = co.status === 'approved';
              const isRejected = co.status === 'rejected';
              const accentCol  = isApproved ? GREEN : isRejected ? RED : YELLOW;
              return (
                <div key={co.change_order_id} className="rounded-xl border p-4 space-y-3"
                  style={{ borderColor: `${accentCol}25`, background: `${accentCol}05` }}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[9px] font-bold text-white">{DRIFT_TYPE_LABELS[co.drift_type]}</span>
                        <span className="text-[7px] font-black uppercase px-1.5 py-0.5 rounded"
                          style={{ background: `${accentCol}20`, color: accentCol }}
                        >{CO_FLOW_STEP_LABELS[co.status]}</span>
                        <span className="font-mono text-[7px] text-gray-800">{co.change_order_id}</span>
                      </div>
                      <div className="text-[8px] text-gray-700 mt-0.5">
                        Created {fmtDate(co.created_at)} by {co.created_by}
                        {co.version_after && <span> · v{co.version_before} → v{co.version_after}</span>}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {co.impact_analysis.additional_cost > 0 && (
                        <div className="text-[10px] font-black" style={{ color: ORANGE }}>+{fmtCurrency(co.impact_analysis.additional_cost)}</div>
                      )}
                      {co.impact_analysis.additional_weeks > 0 && (
                        <div className="text-[9px] font-bold" style={{ color: YELLOW }}>+{co.impact_analysis.additional_weeks}w</div>
                      )}
                      {co.impact_analysis.roi_adjustment_required && (
                        <div className="text-[7px]" style={{ color: PURPLE }}>ROI recalc</div>
                      )}
                    </div>
                  </div>

                  <p className="text-[9px] text-gray-500 leading-relaxed">{co.reason}</p>

                  {/* Impact analysis */}
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'New Timeline',   value: `${co.impact_analysis.new_timeline_weeks}w`,           color: ACCENT },
                      { label: 'New Investment', value: fmtCurrency(co.impact_analysis.new_investment_total),  color: GREEN  },
                      { label: 'ROI Recalc',     value: co.impact_analysis.roi_adjustment_required ? 'Yes' : 'No', color: co.impact_analysis.roi_adjustment_required ? PURPLE : '#374151' },
                    ].map(kv => (
                      <div key={kv.label} className="flex flex-col gap-0.5 px-2 py-1.5 rounded-lg border"
                        style={{ borderColor: `${kv.color}20`, background: `${kv.color}06` }}>
                        <span className="text-[9px] font-black" style={{ color: kv.color }}>{kv.value}</span>
                        <span className="text-[7px] uppercase tracking-wide text-gray-700">{kv.label}</span>
                      </div>
                    ))}
                  </div>

                  {/* Flow stepper */}
                  <COFlowStepper co={co} />

                  {/* Flow history */}
                  {co.history.length > 0 && (
                    <div className="space-y-0.5">
                      <div className="text-[7px] font-bold text-gray-700 uppercase tracking-wide mb-1">Flow History</div>
                      {co.history.map((h, i) => (
                        <div key={i} className="flex items-center gap-2 text-[7px] text-gray-700">
                          <ChevronRight className="size-2 flex-shrink-0" style={{ color: CO_FLOW_STEP_COLOR[h.step] }} />
                          <span style={{ color: CO_FLOW_STEP_COLOR[h.step] }}>{CO_FLOW_STEP_LABELS[h.step]}</span>
                          <span>·</span><span>{fmtDate(h.at)}</span>
                          <span>·</span><span className="text-gray-800">{h.by}</span>
                          {h.note && <span className="text-gray-800">— {h.note}</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Action buttons */}
                  {isOpen && (
                    <div className="flex gap-2 pt-1 flex-wrap">
                      {co.status !== 'execution_update' ? (
                        <button onClick={() => handleAdvanceCO(co.change_order_id, 'advance')}
                          className="flex items-center gap-1 text-[8px] font-bold px-3 py-1.5 rounded-lg border"
                          style={{ borderColor: `${ACCENT}30`, color: ACCENT, background: `${ACCENT}10` }}
                        ><ArrowRight className="size-2.5" />Advance</button>
                      ) : (
                        <button onClick={() => handleApproveCO(co.change_order_id)}
                          className="flex items-center gap-1 text-[8px] font-bold px-3 py-1.5 rounded-lg border"
                          style={{ borderColor: `${GREEN}30`, color: GREEN, background: `${GREEN}10` }}
                        ><Check className="size-2.5" />Final Approve</button>
                      )}
                      <button onClick={() => handleAdvanceCO(co.change_order_id, 'reject')}
                        className="flex items-center gap-1 text-[8px] font-bold px-3 py-1.5 rounded-lg border"
                        style={{ borderColor: `${RED}30`, color: RED, background: `${RED}10` }}
                      ><XCircle className="size-2.5" />Reject</button>
                    </div>
                  )}

                  {isApproved && (
                    <div className="flex items-center gap-1.5 text-[8px]" style={{ color: GREEN }}>
                      <CheckCircle2 className="size-3" />
                      Approved · Execution upgraded to v{co.version_after} · ROI recalc {co.impact_analysis.roi_adjustment_required ? 'triggered' : 'not required'}
                    </div>
                  )}
                  {isRejected && (
                    <div className="flex items-center gap-1.5 text-[8px]" style={{ color: RED }}>
                      <XCircle className="size-3" />Change reverted. Scope baseline unchanged.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ── Step 5: ROI Protection History ───────────────────────────────────── */}
      {engineState.roi_history.length > 0 && (
        <Card accent={PURPLE}>
          <SectionHeader icon={TrendingUp} title="ROI Protection History (Step 5)" badge={`${engineState.roi_history.length} recalcs`} accent={PURPLE} />
          <div className="p-4 space-y-2">
            {engineState.roi_history.map((r, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg border flex-wrap"
                style={{ borderColor: `${PURPLE}20`, background: `${PURPLE}06` }}>
                <div className="text-[8px] font-mono text-gray-700">{r.co_id}</div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-black" style={{ color: RED }}>{r.roi_12m_before}%</span>
                  <ArrowRight className="size-2.5 text-gray-700" />
                  <span className="text-[9px] font-black" style={{ color: r.roi_12m_after >= r.roi_12m_before ? GREEN : ORANGE }}>{r.roi_12m_after}%</span>
                  <span className="text-[7px] text-gray-700">ROI (12m)</span>
                </div>
                <div className="text-[7px] text-gray-700 ml-auto">
                  v{r.new_baseline_version} · {fmtDate(r.triggered_at)}
                  {r.roi_recalc_required && <span className="ml-1 text-[#8B5CF6]">· Recalc triggered</span>}
                </div>
              </div>
            ))}
            <div className="text-[7px] text-gray-800 flex items-center gap-1 pt-1">
              <Info className="size-2.5" />Old ROI preserved historically. New projected ROI generated based on updated scope.
            </div>
          </div>
        </Card>
      )}

      {/* ── Original Change Orders (from execution project) ───────────────────── */}
      {project.change_orders.length > 0 && (
        <Card accent={YELLOW}>
          <SectionHeader icon={ClipboardList} title="Execution Change Orders" badge={`${project.change_orders.length}`} accent={YELLOW} />
          <div className="p-4 space-y-3">
            {project.change_orders.map(co => {
              const cocfg = CHANGE_ORDER_CFG[co.status] ?? { label: co.status, color: '#6B7280' };
              const ws    = project.workstreams.find(w => w.workstream_id === co.workstream_id);
              return (
                <div key={co.change_order_id} className="rounded-xl border p-4 space-y-2"
                  style={{ borderColor: `${cocfg.color}25`, background: `${cocfg.color}06` }}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-white">{co.title}</span>
                        <StatusPill label={cocfg.label} color={cocfg.color} />
                      </div>
                      <div className="text-[8px] text-gray-700 mt-0.5">
                        {co.change_order_id} · {ws?.title ?? '—'} · Requested by {co.requested_by} · {fmtDate(co.requested_at)}
                      </div>
                    </div>
                    <span className="text-[10px] font-black" style={{ color: ORANGE }}>{co.impact_estimate}</span>
                  </div>
                  <p className="text-[9px] text-gray-500 leading-relaxed">{co.description}</p>
                  <div>
                    <div className="text-[8px] font-bold text-gray-700 mb-1">Scope Delta:</div>
                    {co.scope_delta.map((d, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-[9px] text-gray-600">
                        <Plus className="size-2.5 text-[#F59E0B]" />{d}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// TAB 4 — LIVE ROI ACTUALS ENGINE (roi-actuals-engine.md)
// ════════════════════════════════════════════════════════════════════════════════

interface ROIFormData {
  manual_hours_per_week:          string;
  monthly_revenue:                string;
  tickets_per_month:              string;
  avg_ticket_handle_time_minutes: string;
  automation_coverage_percent:    string;
  monthly_project_cost:           string;
  attribution:                    Record<string, string>;
  variance_tags:                  Set<VarianceTag>;
  notes:                          string;
  evidence_link:                  string;
}

function initFormData(project: ExecutionProject): ROIFormData {
  const b = project.baseline;
  const attr: Record<string, string> = {};
  const per = project.workstreams.length > 0
    ? Math.floor(100 / project.workstreams.length)
    : 0;
  project.workstreams.forEach((ws, i) => {
    attr[ws.workstream_id] = i === project.workstreams.length - 1
      ? String(100 - per * (project.workstreams.length - 1))
      : String(per);
  });
  return {
    manual_hours_per_week:          String(b.manual_hours_per_week),
    monthly_revenue:                String(b.monthly_revenue),
    tickets_per_month:              '320',
    avg_ticket_handle_time_minutes: '18',
    automation_coverage_percent:    '0',
    monthly_project_cost:           '0',
    attribution:                    attr,
    variance_tags:                  new Set(),
    notes:                          '',
    evidence_link:                  '',
  };
}

function LiveROITab({ project }: { project: ExecutionProject }) {
  const [roiState, setRoiState] = useState<ROIActualsState>(() => buildMockROIActualsState(project));
  const [showForm,  setShowForm]  = useState(false);
  const [formData,  setFormData]  = useState<ROIFormData>(() => initFormData(project));
  const [formError, setFormError] = useState('');

  const m           = project.baseline.metrics_snapshot;
  const nextMonth   = useMemo(() => getNextAvailableMonth(roiState), [roiState]);
  const chartData   = useMemo(() => buildROIChartData(roiState).map((d, i) => ({ ...d, label: `M${i + 1}` })), [roiState]);
  const paybackData = useMemo(() => buildPaybackChartData(roiState).map((d, i) => ({ ...d, label: `M${i + 1}` })), [roiState]);
  const tagFreq     = useMemo(() => analyzeVarianceTags(roiState.actuals), [roiState.actuals]);
  const openAlerts  = roiState.alerts.filter(a => !a.dismissed);

  const attrTotal = useMemo(() =>
    Object.values(formData.attribution).reduce((s, v) => s + (Number(v) || 0), 0),
  [formData.attribution]);

  function handleTagToggle(tag: VarianceTag) {
    setFormData(p => {
      const next = new Set(p.variance_tags);
      next.has(tag) ? next.delete(tag) : next.add(tag);
      return { ...p, variance_tags: next };
    });
  }

  function handleSubmit() {
    setFormError('');
    if (attrTotal !== 100) { setFormError(`Attribution must equal 100% (currently ${attrTotal}%)`); return; }

    const partial: Omit<ROIActualMonth, 'actual_id' | 'submitted_at' | 'execution_id'> = {
      month: nextMonth,
      metrics: {
        manual_hours_per_week:          Number(formData.manual_hours_per_week)          || 0,
        monthly_revenue:                Number(formData.monthly_revenue)                || 0,
        tickets_per_month:              Number(formData.tickets_per_month)              || 0,
        avg_ticket_handle_time_minutes: Number(formData.avg_ticket_handle_time_minutes) || 0,
        automation_coverage_percent:    Number(formData.automation_coverage_percent)    || 0,
      },
      monthly_project_cost: Number(formData.monthly_project_cost) || 0,
      attribution: project.workstreams.map(ws => ({
        workstream_id:    ws.workstream_id,
        workstream_title: ws.title,
        percent:          Number(formData.attribution[ws.workstream_id]) || 0,
        attributed_gain:  0,
      })),
      variance_tags:  [...formData.variance_tags] as VarianceTag[],
      evidence_links: formData.evidence_link ? [formData.evidence_link] : [],
      notes:          formData.notes,
      submitted_by:   'U-01',
    };

    setRoiState(prev => submitMonthlyActuals(prev, partial));
    setShowForm(false);
    setFormData(initFormData(project));
  }

  function dismissAlert(alertId: string) {
    setRoiState(prev => ({
      ...prev,
      alerts: prev.alerts.map(a => a.alert_id === alertId ? { ...a, dismissed: true } : a),
    }));
  }

  const bl    = roiState.baseline;
  const proj  = roiState.projection;
  const lastVar = roiState.variances.length > 0
    ? roiState.variances[roiState.variances.length - 1]
    : null;

  // Live preview of what the form would compute
  const previewActual = showForm ? (() => {
    const temp: ROIActualMonth = {
      actual_id: '', execution_id: project.execution_id, submitted_at: '',
      month: nextMonth,
      metrics: {
        manual_hours_per_week:          Number(formData.manual_hours_per_week) || 0,
        monthly_revenue:                Number(formData.monthly_revenue) || 0,
        tickets_per_month:              Number(formData.tickets_per_month) || 0,
        avg_ticket_handle_time_minutes: Number(formData.avg_ticket_handle_time_minutes) || 0,
        automation_coverage_percent:    Number(formData.automation_coverage_percent) || 0,
      },
      monthly_project_cost: Number(formData.monthly_project_cost) || 0,
      attribution: [], variance_tags: [], evidence_links: [], notes: '', submitted_by: '',
    };
    const labor = computeLaborSavings(temp, bl);
    const eff   = computeEfficiencySavings(temp, bl);
    const rev   = computeMarginLift(temp, bl);
    const gain  = labor + eff + rev;
    return { labor, eff, rev, gain, net: gain - (Number(formData.monthly_project_cost) || 0) };
  })() : null;

  return (
    <div className="space-y-4">

      {/* ── ROI Actuals Status Bar ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border flex-wrap"
        style={{ borderColor: `${ACCENT}20`, background: `${ACCENT}05` }}>
        <div className="flex items-center gap-2">
          <TrendingUp className="size-4 flex-shrink-0" style={{ color: ACCENT }} />
          <div>
            <div className="text-[10px] font-black text-white">Live ROI Actuals Engine</div>
            <div className="text-[8px] text-gray-600">
              {roiState.actuals.length} month(s) submitted · Next: {formatMonth(nextMonth)} · {openAlerts.length} open alert(s)
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {[
            { label: 'Proj ROI 12m', value: `${proj.projected_roi_percent}%`,       color: GREEN   },
            { label: 'Payback (proj)', value: `M${proj.projected_payback_month}`,   color: ACCENT  },
            { label: 'Total Invest',  value: fmtCurrency(m.total_investment),        color: PURPLE  },
            { label: 'Last Net',      value: lastVar ? fmtCurrency(lastVar.net_actual) : '—', color: lastVar && lastVar.net_actual >= 0 ? GREEN : ORANGE },
          ].map(kv => (
            <div key={kv.label} className="text-center">
              <div className="text-[11px] font-black" style={{ color: kv.color }}>{kv.value}</div>
              <div className="text-[7px] text-gray-700 uppercase tracking-wide">{kv.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Card A: Baseline Snapshot (locked) ───────────────────────────────── */}
      <Card accent={GREEN}>
        <SectionHeader icon={Lock} title="Baseline Snapshot (Locked)" badge={bl.baseline_id} accent={GREEN}>
          <span className="text-[8px] text-gray-700">Captured {fmtDate(bl.captured_at)}</span>
        </SectionHeader>
        <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-2 border-b border-white/5">
          {[
            { label: 'Proj ROI (12m)',        value: `${m.roi_12m_percent}%`,               color: GREEN   },
            { label: 'Payback Period',         value: `${m.payback_months}m`,                color: ACCENT  },
            { label: 'Revenue at Risk/yr',     value: fmtCurrency(m.revenue_at_risk_annual), color: RED     },
            { label: 'Total Investment',       value: fmtCurrency(m.total_investment),       color: PURPLE  },
          ].map(kv => (
            <div key={kv.label} className="flex flex-col gap-0.5 px-2.5 py-2 rounded-lg border"
              style={{ borderColor: `${kv.color}20`, background: `${kv.color}07` }}>
              <span className="text-[13px] font-black" style={{ color: kv.color }}>{kv.value}</span>
              <span className="text-[7px] uppercase tracking-wide text-gray-700">{kv.label}</span>
            </div>
          ))}
        </div>
        <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'Manual hrs/wk',          value: `${bl.metrics.manual_hours_per_week} hrs`,               color: ORANGE  },
            { label: 'Fully-loaded $/hr',       value: `$${bl.metrics.avg_fully_loaded_cost_per_hour}`,         color: YELLOW  },
            { label: 'Monthly Revenue',         value: fmtCurrency(bl.metrics.monthly_revenue),                 color: GREEN   },
            { label: 'Gross Margin',            value: `${bl.metrics.gross_margin_percent}%`,                   color: ACCENT  },
            { label: 'Tickets/month',           value: `${bl.metrics.tickets_per_month}`,                       color: '#6B7280' },
            { label: 'Avg Handle Time',         value: `${bl.metrics.avg_ticket_handle_time_minutes} min`,      color: '#6B7280' },
            { label: 'Lead→Close Rate',         value: `${bl.metrics.lead_to_close_rate_percent}%`,             color: '#6B7280' },
            { label: 'Avg Sales Cycle',         value: `${bl.metrics.avg_sales_cycle_days} days`,               color: '#6B7280' },
          ].map(kv => (
            <div key={kv.label} className="flex flex-col gap-0.5 px-2 py-1.5 rounded-lg border"
              style={{ borderColor: `${kv.color}20`, background: `${kv.color}05` }}>
              <span className="text-[10px] font-black" style={{ color: kv.color }}>{kv.value}</span>
              <span className="text-[6.5px] uppercase tracking-wide text-gray-700">{kv.label}</span>
            </div>
          ))}
        </div>
        <div className="px-4 pb-3 border-t border-white/5 pt-2 text-[8px] text-gray-800 flex items-center gap-1.5">
          <Lock className="size-2.5" />
          Baseline locked at kickoff. Immutable — changes require change order. ROI actuals never modify projected ROI.
          <span className="ml-auto text-gray-800 font-mono">{bl.baseline_quality}</span>
        </div>
      </Card>

      {/* ── Card B: Projected ROI Snapshot (immutable) ───────────────────────── */}
      <Card accent={ACCENT}>
        <SectionHeader icon={BarChart2} title="Projected ROI Snapshot" badge={`${proj.scenario} · ${proj.projection_id}`} accent={ACCENT} />
        <div className="p-4 overflow-x-auto">
          <table className="w-full text-[8px] min-w-[480px]">
            <thead>
              <tr className="border-b border-white/5">
                <th className="py-1.5 px-2 text-left text-gray-700 uppercase tracking-wide font-bold">Month</th>
                <th className="py-1.5 px-2 text-right text-gray-700 uppercase tracking-wide font-bold">Proj. Gain</th>
                <th className="py-1.5 px-2 text-right text-gray-700 uppercase tracking-wide font-bold">Proj. Cost</th>
                <th className="py-1.5 px-2 text-right text-gray-700 uppercase tracking-wide font-bold">Net</th>
                <th className="py-1.5 px-2 text-right text-gray-700 uppercase tracking-wide font-bold">Cum. Net</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                let cum = 0;
                return proj.monthly_cashflows.map((cf, i) => {
                  const net = cf.projected_gain - cf.projected_cost;
                  cum += net;
                  const isPayback = i + 1 === proj.projected_payback_month;
                  return (
                    <tr key={cf.month}
                      className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                      style={{ background: isPayback ? `${GREEN}08` : undefined }}
                    >
                      <td className="py-1.5 px-2 font-medium" style={{ color: isPayback ? GREEN : 'white' }}>
                        M{i + 1} {formatMonth(cf.month)}{isPayback ? ' ✓ Payback' : ''}
                      </td>
                      <td className="py-1.5 px-2 text-right text-gray-500">{cf.projected_gain > 0 ? fmtCurrency(cf.projected_gain) : '—'}</td>
                      <td className="py-1.5 px-2 text-right text-gray-500">{cf.projected_cost > 0 ? fmtCurrency(cf.projected_cost) : '—'}</td>
                      <td className="py-1.5 px-2 text-right font-bold" style={{ color: net >= 0 ? GREEN : RED }}>{fmtCurrency(net)}</td>
                      <td className="py-1.5 px-2 text-right font-bold" style={{ color: cum >= 0 ? GREEN : '#6B7280' }}>{fmtCurrency(cum)}</td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
        <div className="px-4 pb-3 border-t border-white/5 pt-2 text-[7px] text-gray-800 flex items-center gap-1">
          <Lock className="size-2" />Immutable. Copied from proposal snapshot. Projected ROI {proj.projected_roi_percent}% · Payback month {proj.projected_payback_month}.
        </div>
      </Card>

      {/* ── Card C: Monthly Actual Input Form ────────────────────────────────── */}
      <Card accent={PURPLE}>
        <SectionHeader icon={Edit3} title="Log Monthly Actuals" badge={formatMonth(nextMonth)} accent={PURPLE}>
          <button
            onClick={() => setShowForm(p => !p)}
            className="flex items-center gap-1 text-[8px] font-bold px-2 py-1 rounded-lg border"
            style={{ borderColor: `${PURPLE}30`, color: PURPLE, background: `${PURPLE}10` }}
          >
            <Calendar className="size-2.5" />{showForm ? 'Close Form' : 'Enter Actuals'}
          </button>
        </SectionHeader>

        {/* Submitted actuals summary */}
        {roiState.actuals.length > 0 && !showForm && (
          <div className="p-4 space-y-2">
            {roiState.actuals.map(a => {
              const v = roiState.variances.find(vr => vr.month === a.month);
              return (
                <div key={a.actual_id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-white/5 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-2.5" style={{ color: GREEN }} />
                    <span className="text-[9px] font-bold text-white">{formatMonth(a.month)}</span>
                  </div>
                  {v && (
                    <span className="contents">
                      <div className="text-[8px] text-gray-600">Gain: <span style={{ color: GREEN }} className="font-bold">{fmtCurrency(v.actual_gain)}</span></div>
                      <div className="text-[8px] text-gray-600">Net: <span style={{ color: v.net_actual >= 0 ? GREEN : ORANGE }} className="font-bold">{fmtCurrency(v.net_actual)}</span></div>
                      <div className="text-[8px] text-gray-600">Coverage: <span style={{ color: ACCENT }} className="font-bold">{a.metrics.automation_coverage_percent}%</span></div>
                    </span>
                  )}
                  {a.variance_tags.length > 0 && (
                    <div className="flex gap-1 flex-wrap ml-auto">
                      {a.variance_tags.map(t => (
                        <span key={t} className="text-[6.5px] font-bold px-1 py-0.5 rounded"
                          style={{ background: `${VARIANCE_TAG_COLORS[t]}20`, color: VARIANCE_TAG_COLORS[t] }}>
                          {VARIANCE_TAG_LABELS[t]}
                        </span>
                      ))}
                    </div>
                  )}
                  <span className="text-[7px] text-gray-800 ml-auto">by {a.submitted_by} · {fmtDate(a.submitted_at)}</span>
                </div>
              );
            })}
          </div>
        )}

        {showForm && (
          <div className="p-4 space-y-4">
            {/* Metrics grid */}
            <div>
              <div className="text-[8px] font-bold text-gray-700 uppercase tracking-wide mb-2">Monthly Metrics</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { key: 'manual_hours_per_week',          label: 'Manual hrs / week',   placeholder: String(bl.metrics.manual_hours_per_week)          },
                  { key: 'monthly_revenue',                label: 'Monthly Revenue ($)',  placeholder: String(bl.metrics.monthly_revenue)                },
                  { key: 'tickets_per_month',              label: 'Tickets / month',      placeholder: String(bl.metrics.tickets_per_month)              },
                  { key: 'avg_ticket_handle_time_minutes', label: 'Avg Handle Time (min)', placeholder: String(bl.metrics.avg_ticket_handle_time_minutes) },
                  { key: 'automation_coverage_percent',    label: 'Automation Coverage %', placeholder: '0'                                              },
                  { key: 'monthly_project_cost',           label: 'Project Cost (this mo)', placeholder: '0'                                             },
                ].map(({ key, label, placeholder }) => (
                  <div key={key} className="space-y-1">
                    <label className="text-[7.5px] font-bold text-gray-700 uppercase tracking-wide">{label}</label>
                    <input type="number" placeholder={placeholder}
                      value={(formData as any)[key]}
                      onChange={e => setFormData(p => ({ ...p, [key]: e.target.value }))}
                      className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-1.5 text-[9px] text-white focus:outline-none focus:border-purple-500/50 placeholder:text-gray-700"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Live preview */}
            {previewActual && (
              <div className="rounded-xl border p-3 space-y-1.5" style={{ borderColor: `${GREEN}20`, background: `${GREEN}05` }}>
                <div className="text-[8px] font-bold text-gray-600 uppercase tracking-wide">Live Gain Preview</div>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: 'Labour Savings', value: fmtCurrency(previewActual.labor), color: ACCENT  },
                    { label: 'Efficiency Svgs', value: fmtCurrency(previewActual.eff),  color: YELLOW  },
                    { label: 'Margin Lift',    value: fmtCurrency(previewActual.rev),   color: PURPLE  },
                    { label: 'Net Actual',     value: fmtCurrency(previewActual.net),   color: previewActual.net >= 0 ? GREEN : ORANGE },
                  ].map(kv => (
                    <div key={kv.label} className="text-center">
                      <div className="text-[10px] font-black" style={{ color: kv.color }}>{kv.value}</div>
                      <div className="text-[6.5px] text-gray-700 uppercase tracking-wide">{kv.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Attribution */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[8px] font-bold text-gray-700 uppercase tracking-wide">Workstream Attribution</div>
                <div className="text-[8px]" style={{ color: attrTotal === 100 ? GREEN : ORANGE }}>
                  Total: {attrTotal}% {attrTotal === 100 ? '✓' : '— must equal 100%'}
                </div>
              </div>
              <div className="space-y-1.5">
                {project.workstreams.map(ws => (
                  <div key={ws.workstream_id} className="flex items-center gap-3">
                    <span className="text-[8px] text-gray-500 flex-1 truncate">{ws.title}</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number" min="0" max="100"
                        value={formData.attribution[ws.workstream_id] ?? '0'}
                        onChange={e => setFormData(p => ({ ...p, attribution: { ...p.attribution, [ws.workstream_id]: e.target.value } }))}
                        className="w-14 bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[9px] text-white text-center focus:outline-none focus:border-purple-500/50"
                      />
                      <Percent className="size-2.5 text-gray-700" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Variance tags */}
            <div>
              <div className="text-[8px] font-bold text-gray-700 uppercase tracking-wide mb-2">Variance Tags</div>
              <div className="flex flex-wrap gap-1.5">
                {ALL_VARIANCE_TAGS.map(tag => {
                  const active = formData.variance_tags.has(tag);
                  return (
                    <button key={tag} onClick={() => handleTagToggle(tag)}
                      className="text-[7.5px] font-bold px-2 py-1 rounded-lg border transition-all"
                      style={{
                        borderColor: active ? VARIANCE_TAG_COLORS[tag] : `${VARIANCE_TAG_COLORS[tag]}30`,
                        color:       active ? VARIANCE_TAG_COLORS[tag] : '#6B7280',
                        background:  active ? `${VARIANCE_TAG_COLORS[tag]}15` : 'transparent',
                      }}
                    >{VARIANCE_TAG_LABELS[tag]}</button>
                  );
                })}
              </div>
            </div>

            {/* Notes + evidence */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[7.5px] font-bold text-gray-700 uppercase tracking-wide">Notes / Context</label>
                <textarea rows={2} value={formData.notes} onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))}
                  placeholder="Any context for this month's numbers..."
                  className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-1.5 text-[9px] text-white resize-none focus:outline-none focus:border-purple-500/50 placeholder:text-gray-700"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[7.5px] font-bold text-gray-700 uppercase tracking-wide">Evidence Link (optional)</label>
                <input type="url" value={formData.evidence_link} onChange={e => setFormData(p => ({ ...p, evidence_link: e.target.value }))}
                  placeholder="https://..."
                  className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-1.5 text-[9px] text-white focus:outline-none focus:border-purple-500/50 placeholder:text-gray-700"
                />
              </div>
            </div>

            {formError && (
              <div className="flex items-center gap-1.5 text-[8px]" style={{ color: RED }}>
                <AlertCircle className="size-3" />{formError}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={handleSubmit}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[8px] font-bold border"
                style={{ borderColor: `${PURPLE}30`, color: PURPLE, background: `${PURPLE}10` }}
              ><Check className="size-2.5" />Submit Actuals for {formatMonth(nextMonth)}</button>
              <button onClick={() => setShowForm(false)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[8px] font-bold border border-white/10 text-gray-600"
              ><XCircle className="size-2.5" />Cancel</button>
            </div>
          </div>
        )}

        {!showForm && roiState.actuals.length === 0 && (
          <div className="p-5 text-center text-[9px] text-gray-700">
            No actuals submitted yet. Click "Enter Actuals" to log {formatMonth(nextMonth)}.
          </div>
        )}
      </Card>

      {/* ── Card D: Actual vs Projected Chart ────────────────────────────────── */}
      <Card accent={ACCENT}>
        <SectionHeader icon={BarChart2} title="Actual vs Projected Monthly Gain" accent={ACCENT} badge="12-month view" />
        <div className="p-4">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                <XAxis dataKey="label" tick={{ fontSize: 8, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 8, fill: '#6B7280' }} axisLine={false} tickLine={false}
                  tickFormatter={v => `$${Math.round(Math.abs(v) / 1000)}K`} />
                <Tooltip contentStyle={{ background: '#0D0D1A', border: '1px solid #ffffff14', borderRadius: 8, fontSize: 9 }}
                  formatter={(v: number, name: string) => [v != null ? `$${Math.abs(v).toLocaleString()}` : '—', name]} />
                <Legend wrapperStyle={{ fontSize: 8 }} />
                <Bar dataKey="projected_gain" name="Projected Gain" fill={`${ACCENT}35`} radius={[2, 2, 0, 0]} />
                <Bar dataKey="actual_gain"    name="Actual Gain"    fill={GREEN}          radius={[2, 2, 0, 0]} />
                <Line dataKey="net_projected" name="Net Projected" stroke={`${ACCENT}80`} strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                <Line dataKey="net_actual"    name="Net Actual"    stroke={GREEN}         strokeWidth={2}   dot={{ r: 3, fill: GREEN }} connectNulls={false} />
                <ReferenceLine y={0} stroke="#ffffff20" strokeDasharray="2 2" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {roiState.actuals.length > 0 && (
            <div className="mt-2 grid grid-cols-3 gap-2 pt-2 border-t border-white/5">
              {roiState.variances.map(v => {
                const projCf = proj.monthly_cashflows.find(c => c.month === v.month);
                const gainDelta = projCf ? v.actual_gain - projCf.projected_gain : null;
                return (
                  <div key={v.month} className="flex flex-col gap-0.5 px-2 py-1.5 rounded-lg border border-white/5">
                    <div className="flex items-center justify-between">
                      <span className="text-[7px] text-gray-700">{formatMonth(v.month)}</span>
                      {gainDelta !== null && (
                        <span className="text-[7px] font-bold flex items-center gap-0.5"
                          style={{ color: gainDelta >= 0 ? GREEN : ORANGE }}>
                          {gainDelta >= 0 ? <TrendingUp className="size-2" /> : <TrendingDown className="size-2" />}
                          {gainDelta >= 0 ? '+' : ''}{fmtCurrency(gainDelta)}
                        </span>
                      )}
                    </div>
                    <div className="text-[8px] font-bold" style={{ color: v.net_actual >= 0 ? GREEN : ORANGE }}>Net: {fmtCurrency(v.net_actual)}</div>
                    <div className="text-[7px] text-gray-700">Labor: {fmtCurrency(v.labor_savings)} · Eff: {fmtCurrency(v.efficiency_savings)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {/* ── Card E: Payback Progress ──────────────────────────────────────────── */}
      <Card accent={GREEN}>
        <SectionHeader icon={TrendingUp} title="Payback Progress (Cumulative Net)" accent={GREEN}
          badge={lastVar ? `Actual cum: ${fmtCurrency(lastVar.payback_progress.actual_cumulative_net)}` : 'No actuals yet'} />
        <div className="p-4">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={paybackData} margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                <XAxis dataKey="label" tick={{ fontSize: 8, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 8, fill: '#6B7280' }} axisLine={false} tickLine={false}
                  tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} />
                <Tooltip contentStyle={{ background: '#0D0D1A', border: '1px solid #ffffff14', borderRadius: 8, fontSize: 9 }}
                  formatter={(v: number, name: string) => [v != null ? `$${Math.abs(v).toLocaleString()}` : '—', name]} />
                <Legend wrapperStyle={{ fontSize: 8 }} />
                <ReferenceLine y={0} stroke={GREEN} strokeOpacity={0.4} strokeDasharray="3 3"
                  label={{ value: 'Payback threshold', fill: `${GREEN}80`, fontSize: 7, position: 'insideTopLeft' }} />
                <Line dataKey="projected_cum" name="Projected Cumulative" stroke={`${ACCENT}80`} strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                <Line dataKey="actual_cum"    name="Actual Cumulative"    stroke={GREEN}         strokeWidth={2}   dot={{ r: 3, fill: GREEN }} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {lastVar && (
            <div className="mt-2 grid grid-cols-3 gap-2 pt-2 border-t border-white/5 text-center">
              <div>
                <div className="text-[11px] font-black" style={{ color: ACCENT }}>M{proj.projected_payback_month}</div>
                <div className="text-[7px] text-gray-700 uppercase tracking-wide">Proj. Payback</div>
              </div>
              <div>
                <div className="text-[11px] font-black" style={{ color: GREEN }}>M{lastVar.payback_progress.estimated_payback_month_actual}</div>
                <div className="text-[7px] text-gray-700 uppercase tracking-wide">Est. Actual Payback</div>
              </div>
              <div>
                <div className="text-[11px] font-black"
                  style={{ color: lastVar.payback_progress.estimated_payback_month_actual <= proj.projected_payback_month ? GREEN : ORANGE }}>
                  {lastVar.payback_progress.estimated_payback_month_actual <= proj.projected_payback_month ? 'On Track' : `+${lastVar.payback_progress.estimated_payback_month_actual - proj.projected_payback_month}m`}
                </div>
                <div className="text-[7px] text-gray-700 uppercase tracking-wide">Vs Projection</div>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* ── Card F: Workstream Attribution Table ─────────────────────────────── */}
      <Card accent={YELLOW}>
        <SectionHeader icon={Target} title="Workstream Attribution" accent={YELLOW}
          badge={`${roiState.actuals.length} month(s)`} />
        {roiState.actuals.length === 0 ? (
          <div className="p-5 text-center text-[9px] text-gray-700">Submit monthly actuals to see attribution.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[8px] min-w-[480px]">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="py-2 px-4 text-left text-[7px] font-bold text-gray-700 uppercase">Workstream</th>
                  {roiState.actuals.map(a => (
                    <th key={a.month} className="py-2 px-3 text-right text-[7px] font-bold text-gray-700 uppercase">{formatMonth(a.month)}</th>
                  ))}
                  <th className="py-2 px-3 text-right text-[7px] font-bold text-gray-700 uppercase">Total</th>
                </tr>
              </thead>
              <tbody>
                {project.workstreams.map(ws => {
                  const total = roiState.actuals.reduce((sum, a) => {
                    const att = a.attribution.find(x => x.workstream_id === ws.workstream_id);
                    return sum + (att?.attributed_gain ?? 0);
                  }, 0);
                  return (
                    <tr key={ws.workstream_id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                      <td className="py-2 px-4 font-medium text-white">{ws.title}</td>
                      {roiState.actuals.map(a => {
                        const att = a.attribution.find(x => x.workstream_id === ws.workstream_id);
                        return (
                          <td key={a.month} className="py-2 px-3 text-right">
                            <div className="text-[8px] font-bold" style={{ color: att?.attributed_gain ? GREEN : '#6B7280' }}>
                              {att?.attributed_gain ? fmtCurrency(att.attributed_gain) : '—'}
                            </div>
                            <div className="text-[6.5px] text-gray-800">{att?.percent ?? 0}%</div>
                          </td>
                        );
                      })}
                      <td className="py-2 px-3 text-right font-black text-[9px]" style={{ color: YELLOW }}>
                        {total > 0 ? fmtCurrency(total) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 pb-3 border-t border-white/5 pt-2 text-[7px] text-gray-800 flex items-center gap-1">
          <Info className="size-2.5" />sum(percent) must equal 100 per month. Actual gain × percent = attributed gain per workstream.
        </div>
      </Card>

      {/* ── Card G: Variance Tags ─────────────────────────────────────────────── */}
      <Card accent={ORANGE}>
        <SectionHeader icon={Flag} title="Variance Tags" badge={`${tagFreq.length} tag type(s)`} accent={ORANGE} />
        {tagFreq.length === 0 ? (
          <div className="p-5 text-center text-[9px] text-gray-700">No variance tags submitted yet.</div>
        ) : (
          <div className="p-4 space-y-2">
            <div className="text-[7px] text-gray-700 uppercase tracking-wide font-bold mb-2">Frequency (feeds QBR)</div>
            {tagFreq.map(({ tag, count, months }) => (
              <div key={tag} className="flex items-center gap-3 px-3 py-2 rounded-lg border"
                style={{ borderColor: `${VARIANCE_TAG_COLORS[tag]}20`, background: `${VARIANCE_TAG_COLORS[tag]}06` }}>
                <div
                  className="text-[7.5px] font-black px-2 py-0.5 rounded-full"
                  style={{ background: `${VARIANCE_TAG_COLORS[tag]}20`, color: VARIANCE_TAG_COLORS[tag] }}
                >{VARIANCE_TAG_LABELS[tag]}</div>
                <div className="text-[8px] font-bold text-white">{count}×</div>
                <div className="text-[7px] text-gray-700 flex-1">{months.map(m => formatMonth(m)).join(', ')}</div>
                {count >= 2 && (
                  <div className="text-[7px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${ORANGE}20`, color: ORANGE }}>
                    Recurring
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Card H: Alerts Panel ─────────────────────────────────────────────── */}
      <Card accent={openAlerts.length > 0 ? RED : GREEN}>
        <SectionHeader icon={Bell} title="Alerts" badge={openAlerts.length > 0 ? `${openAlerts.length} open` : 'Clear'} accent={openAlerts.length > 0 ? RED : GREEN} />
        {openAlerts.length === 0 ? (
          <div className="p-5 text-center text-[9px] text-gray-700 flex items-center justify-center gap-2">
            <CheckCircle2 className="size-3" style={{ color: GREEN }} />No alerts triggered. Delivery on track.
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {openAlerts.map(alert => {
              const cfg = ALERT_CFG[alert.alert_type];
              return (
                <div key={alert.alert_id} className="rounded-xl border p-4 space-y-2"
                  style={{ borderColor: `${cfg.color}25`, background: `${cfg.color}06` }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="size-3.5 flex-shrink-0" style={{ color: cfg.color }} />
                      <div>
                        <div className="text-[9px] font-bold text-white">{alert.title}</div>
                        <div className="text-[7px] text-gray-700">{cfg.label} · {alert.severity.toUpperCase()} · {formatMonth(alert.month)}</div>
                      </div>
                    </div>
                    <button onClick={() => dismissAlert(alert.alert_id)}
                      className="flex-shrink-0 text-[7px] text-gray-700 hover:text-gray-500 transition-colors px-1.5 py-0.5 rounded border border-white/10"
                    >Dismiss</button>
                  </div>
                  <div className="flex items-start gap-1.5 text-[8px] text-gray-500">
                    <ArrowRight className="size-2.5 flex-shrink-0 mt-0.5" style={{ color: cfg.color }} />
                    {alert.recommended_action}
                  </div>
                  <div className="text-[7px] text-gray-800">Triggered {fmtDate(alert.triggered_at)}</div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// TAB 5 — GOVERNANCE
// ════════════════════════════════════════════════════════════════════════════════

function GovernanceTab({ project }: { project: ExecutionProject }) {
  const requiredGates  = project.gates.filter(g => g.required);
  const pendingGates   = requiredGates.filter(g => g.status === 'pending');
  const passedGates    = requiredGates.filter(g => g.status === 'passed');

  return (
    <div className="space-y-4">
      {/* Approvals required */}
      <Card accent={YELLOW}>
        <SectionHeader icon={Shield} title="Approvals Required" badge={`${pendingGates.length} pending`} accent={YELLOW} />
        <div className="p-4 space-y-2">
          {requiredGates.map(gate => {
            const gcfg = GATE_STATUS_CFG[gate.status];
            const GIcon = gcfg.icon;
            const tCfg  = GATE_TYPE_CFG[gate.type] ?? { label: gate.type, color: ACCENT };
            const ms    = project.milestones.find(m => m.milestone_id === gate.milestone_id);
            return (
              <div
                key={gate.gate_id}
                className="flex items-start gap-3 px-4 py-3 rounded-xl border"
                style={{ borderColor: `${gcfg.color}25`, background: `${gcfg.color}06` }}
              >
                <GIcon className="size-4 flex-shrink-0 mt-0.5" style={{ color: gcfg.color }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold text-white">{gate.title}</span>
                    <StatusPill label={tCfg.label} color={tCfg.color} />
                    <StatusPill label={gcfg.label} color={gcfg.color} />
                  </div>
                  <div className="text-[8px] text-gray-600 mt-0.5">{gate.description}</div>
                  {ms && (
                    <div className="text-[7px] text-gray-800 mt-0.5">Milestone: {ms.title} · {ms.duration}</div>
                  )}
                  {gate.passed_by && (
                    <div className="text-[8px] text-[#10B981] mt-1 flex items-center gap-1">
                      <CheckCircle2 className="size-2.5" />Passed by {gate.passed_by} · {gate.passed_at ? fmtDate(gate.passed_at) : ''}
                    </div>
                  )}
                </div>
                {gate.status === 'pending' && (
                  <button
                    className="flex-shrink-0 flex items-center gap-1 text-[8px] font-bold px-2 py-1 rounded-lg border"
                    style={{ borderColor: `${GREEN}30`, color: GREEN, background: `${GREEN}10` }}
                  >
                    <Check className="size-2.5" />Mark Passed
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Risk Log */}
      <Card accent={RED}>
        <SectionHeader icon={AlertTriangle} title="Risk Log" badge={`${project.risk_log.length}`} accent={RED}>
          <button
            className="flex items-center gap-1 text-[8px] font-bold px-2 py-1 rounded-lg border"
            style={{ borderColor: `${RED}30`, color: RED, background: `${RED}10` }}
          >
            <Plus className="size-2.5" />Flag Risk
          </button>
        </SectionHeader>
        <div className="p-4 space-y-2">
          {project.risk_log.map(risk => {
            const sevColor   = RISK_SEV_CFG[risk.severity] ?? '#6B7280';
            const statusColor = risk.status === 'open' ? RED : risk.status === 'mitigated' ? YELLOW : GREEN;
            return (
              <div
                key={risk.risk_id}
                className="rounded-xl border p-3 space-y-1.5"
                style={{ borderColor: `${sevColor}25`, background: `${sevColor}06` }}
              >
                <div className="flex items-start gap-2 flex-wrap">
                  <span className="text-[10px] font-bold text-white flex-1">{risk.title}</span>
                  <StatusPill label={risk.severity.toUpperCase()} color={sevColor} />
                  <StatusPill label={risk.status.replace('_', ' ')} color={statusColor} />
                </div>
                <p className="text-[9px] text-gray-500">{risk.description}</p>
                <div className="flex items-start gap-1.5 text-[8px] text-gray-700">
                  <Shield className="size-2.5 flex-shrink-0 mt-0.5" />
                  <span>{risk.mitigation}</span>
                </div>
                <div className="text-[7px] text-gray-800">
                  Owner: {risk.owner} · Raised {fmtDate(risk.raised_at)} · P: {risk.probability}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Audit Trail */}
      <Card accent={PURPLE}>
        <SectionHeader icon={Activity} title="Audit Trail" badge={`${project.audit_trail.length} events`} accent={PURPLE} />
        <div className="divide-y divide-white/5">
          {[...project.audit_trail].reverse().map(entry => (
            <div key={entry.audit_id} className="flex items-start gap-3 px-5 py-3">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0 mt-0.5"
                style={{ background: `${PURPLE}20`, color: PURPLE }}
              >
                {entry.actor[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[9px] font-bold text-white">{entry.actor}</span>
                  <span className="text-[9px] text-gray-600">{entry.action}</span>
                  <span className="text-[8px] text-gray-800 font-mono">{entry.target}</span>
                </div>
                {entry.notes && (
                  <p className="text-[8px] text-gray-700 mt-0.5 italic">{entry.notes}</p>
                )}
                <div className="text-[7px] text-gray-800 mt-0.5">{new Date(entry.timestamp).toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// STICKY HEADER
// ════════════════════════════════════════════════════════════════════════════════

function ExecHeader({
  project,
  onChangeOrder,
  onLogActuals,
  onGenerateQBR,
}: {
  project:        ExecutionProject;
  onChangeOrder:  () => void;
  onLogActuals:   () => void;
  onGenerateQBR:  () => void;
}) {
  const pct   = getExecutionProgress(project);
  const ecfg  = EXEC_STATUS_CFG[project.status];

  return (
    <div
      className="sticky top-0 z-20 border-b border-white/10 px-5 py-3"
      style={{ background: '#080810' }}
    >
      <div className="flex items-center gap-4 flex-wrap">
        {/* Identity */}
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-xs"
            style={{ background: `${ACCENT}20`, color: ACCENT }}
          >
            EX
          </div>
          <div>
            <div className="text-[11px] font-black text-white">{project.client_name}</div>
            <div className="text-[8px] text-gray-700 font-mono flex items-center gap-1.5">
              <span>{project.execution_id}</span>
              <span>·</span>
              <span className="flex items-center gap-0.5"><Camera className="size-2.5" />{project.proposal_snapshot_id}</span>
            </div>
          </div>
        </div>

        {/* Status + progress */}
        <div className="flex items-center gap-3">
          <StatusPill label={ecfg.label} color={ecfg.color} />
          <div className="flex items-center gap-2">
            <ProgressBar pct={pct} color={ecfg.color} h={4} />
            <span className="text-[9px] font-bold" style={{ color: ecfg.color }}>{pct}%</span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={onChangeOrder}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-bold border transition-colors"
            style={{ borderColor: `${YELLOW}30`, color: YELLOW, background: `${YELLOW}10` }}
          >
            <Plus className="size-3" />Change Order
          </button>
          <button
            onClick={onLogActuals}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-bold border transition-colors"
            style={{ borderColor: `${GREEN}30`, color: GREEN, background: `${GREEN}10` }}
          >
            <Edit3 className="size-3" />Log Actuals
          </button>
          <button
            onClick={onGenerateQBR}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-bold border transition-colors"
            style={{ borderColor: `${PURPLE}30`, color: PURPLE, background: `${PURPLE}10` }}
          >
            <Download className="size-3" />Generate QBR
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// TAB NAV
// ════════════════════════════════════════════════════════════════════════════════

type DashTab = 'overview' | 'workstreams' | 'scope' | 'roi' | 'governance' | 'qbr';

const TABS: Array<{ id: DashTab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview',     label: 'Overview',        icon: LayoutDashboard },
  { id: 'workstreams',  label: 'Workstreams',     icon: GitBranch       },
  { id: 'scope',        label: 'Scope Control',   icon: Package         },
  { id: 'roi',          label: 'Live ROI',        icon: TrendingUp      },
  { id: 'governance',   label: 'Governance',      icon: Shield          },
  { id: 'qbr',          label: 'QBR',             icon: FileText        },
];

// ════════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ════════════════════════════════════════════════════════════════════════════════

interface ExecutionDashboardProps {
  project: ExecutionProject;
}

export function ExecutionDashboard({ project }: ExecutionDashboardProps) {
  const [activeTab, setActiveTab] = useState<DashTab>('overview');

  const handleChangeOrder = useCallback(() => setActiveTab('scope'),      []);
  const handleLogActuals  = useCallback(() => setActiveTab('roi'),        []);
  const handleGenerateQBR = useCallback(() => setActiveTab('qbr'),       []);
  const handleRequestChange = useCallback((_wsId: string) => setActiveTab('scope'), []);

  return (
    <div
      className="min-h-full"
      style={{ background: 'linear-gradient(135deg, #05050F 0%, #0A0A1A 60%, #080812 100%)' }}
    >
      {/* Sticky header */}
      <ExecHeader
        project={project}
        onChangeOrder={handleChangeOrder}
        onLogActuals={handleLogActuals}
        onGenerateQBR={handleGenerateQBR}
      />

      {/* Tab nav */}
      <div
        className="sticky top-[61px] z-10 flex gap-1 border-b border-white/10 px-5 overflow-x-auto"
        style={{ background: '#08080F' }}
      >
        {TABS.map(tab => {
          const Icon    = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-1.5 px-3 py-3 text-[9px] font-bold whitespace-nowrap border-b-2 transition-colors"
              style={{
                borderColor: isActive ? ACCENT : 'transparent',
                color:       isActive ? ACCENT : '#6B7280',
              }}
            >
              <Icon className="size-3" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="p-5 max-w-5xl mx-auto">
        {/* Mapping Engine source banner */}
        <div
          className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg border text-[8px] flex-wrap"
          style={{ borderColor: `${ACCENT}20`, background: `${ACCENT}06`, color: '#6B7280' }}
        >
          <Lock className="size-2.5 text-[#06D7F6] flex-shrink-0" />
          <span>Mapping Engine · 8-step pipeline ·</span>
          <span>Source: <span className="font-mono text-[#06D7F6]">{project.proposal_snapshot_id}</span></span>
          <span>· v{project.version_number}</span>
          <span className="hidden sm:inline">· Step2: owner auto-assigned · Step4: task roles by verb · Step7: scope frozen · Step8: DAG built</span>
          <span className="ml-auto font-mono text-[#06D7F6]">{project.execution_id}</span>
        </div>

        {activeTab === 'overview'    && <OverviewTab      project={project} />}
        {activeTab === 'workstreams' && <WorkstreamsTab   project={project} onRequestChange={handleRequestChange} />}
        {activeTab === 'scope'       && <ScopeControlTab  project={project} />}
        {activeTab === 'roi'         && <LiveROITab        project={project} />}
        {activeTab === 'governance'  && <GovernanceTab     project={project} />}
        {activeTab === 'qbr'         && <QBRPanel          project={project} />}
      </div>
    </div>
  );
}
