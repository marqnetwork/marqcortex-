/**
 * MAPPING ENGINE PANEL
 *
 * Visual control room for the 8-step proposal_snapshot → execution_blueprint pipeline.
 *
 * Surfaces every step of mappingEngine.ts:
 *   Step 1 createExecutionShell      → execution ID + shell
 *   Step 2 mapSolutionsToWorkstreams → Workstream[] (owner auto-assigned)
 *   Step 3 mapPhasesToMilestones     → Milestone[]  (timeline-driven)
 *   Step 4 mapDeliverablestoTasks    → Task[]        (role auto-assigned by verb)
 *   Step 5 generateGates             → Gate[]        (governance checkpoints)
 *   Step 6 captureBaselineLock       → BaselineLock  (immutable ROI anchor)
 *   Step 7 copyScopeBoundaries       → ScopeBoundary (frozen from snapshot)
 *   Step 8 buildDependencyGraph      → DependencyGraph (DAG)
 *
 * Rule: Math decides structure. Pipeline is deterministic — no LLM.
 */

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  GitBranch, Zap, CheckCircle2, Clock, ChevronRight,
  Layers, Target, Shield, Lock, BarChart2, Network,
  Play, RefreshCw, AlertCircle, ArrowRight, Activity,
  Users, Calendar, Flag, Hash, FileText, Database,
  TrendingUp, Package, List, Eye,
} from 'lucide-react';
import { runMappingPipeline, validateSnapshotForMapping } from '@/app/core/mappingEngine';
import type { MappingPipelineResult, PipelineStepLog } from '@/app/core/mappingEngine';
import type { ProposalSnapshot } from '@/app/core/snapshotEngine';
import { generateVersionHash } from '@/app/core/snapshotEngine';
import { BRAND } from '@/app/utils/designTokens';

// ─────────────────────────────────────────────────────────────────────────────
// DEMO SNAPSHOT (ExampleCo seed — used when no live snapshot exists)
// ─────────────────────────────────────────────────────────────────────────────

const DEMO_SNAPSHOT: ProposalSnapshot = {
  proposal_snapshot_id: 'PS-DEMO-001',
  proposal_id:          'PROP-EXCO-001',
  version_number:       1,
  version_hash:         generateVersionHash({ demo: true }),
  created_at:           new Date(Date.now() - 86400000 * 2).toISOString(),
  created_by:           'account-lead-01',
  status:               'immutable',
  triggered_by_export:  'pdf_export',
  content_snapshot: {
    blocks: [],
    roi_snapshot: {
      total_investment: 42000,
      monthly_cost_before: 31000,
      hours_wasted_monthly: 220,
      revenue_at_risk_annual: 312000,
      payback_months: 8,
      roi_percent_12m: 318,
    } as any,
    assumptions_snapshot: [],
    contract_snapshot: [],
    executive_brief: {
      client_name: 'ExampleCo',
      title: 'ExampleCo AI Operations Transformation',
      engagement_type: 'AI Operations Audit',
      value_prop: 'Eliminate 220 hrs/month of manual work and recover $312K annual revenue leakage through targeted automation.',
      key_outcomes: ['Automated order fulfillment pipeline', 'Real-time inventory sync', 'AI-powered customer support triage'],
      proposed_investment: '$42,000',
      proposed_timeline: '12 weeks',
    } as any,
    diagnosis_blocks: [
      { id: 'dx-01', title: 'Manual Order Processing', severity: 'critical', description: 'Team manually copies orders between 4 systems — 6 hrs/day.' } as any,
      { id: 'dx-02', title: 'Inventory Fragmentation', severity: 'high',     description: 'Stock levels not synced across channels — overselling 3-4x/week.' } as any,
    ],
    scope_boundaries: {
      included: [
        'Order management automation (WMS ↔ Shopify ↔ ERP)',
        'AI customer support triage + escalation routing',
        'Real-time inventory sync across all sales channels',
        'Executive KPI dashboard (live operational data)',
      ],
      scope_included: [],
      scope_excluded: ['Third-party tool procurement', 'Legal contract redlines', 'Non-digital change management'],
      integration_points: ['Shopify API', 'WMS REST API', 'Zendesk webhook', 'Google Data Studio'],
      assumptions: [
        'Client IT provides credentials within 5 business days of kickoff',
        'Existing CRM data is exportable (minimum CSV)',
        'Named client project owner available 4 hrs/week',
      ],
    } as any,
    next_step_offer: null as any,
    solutions: [
      { solution_id: 'sol-01', title: 'Automated Order Pipeline',    system_description: 'End-to-end order flow automation eliminating all manual touchpoints.',       timeline_weeks: 4, diagnosis_link: 'dx-01' },
      { solution_id: 'sol-02', title: 'Inventory Intelligence Sync', system_description: 'Real-time multi-channel inventory synchronisation with conflict resolution.',   timeline_weeks: 3, diagnosis_link: 'dx-02' },
      { solution_id: 'sol-03', title: 'AI Support Triage Engine',    system_description: 'ML classifier routes 60% of tickets automatically; escalates the rest.',       timeline_weeks: 3, diagnosis_link: 'dx-02' },
    ] as any,
    implementation_phases: [
      { phase_id: 'ph-01', phase_name: 'Audit & System Mapping', start_week: 1, end_week: 2,  duration: 'Weeks 1–2',   governance_checkpoint: 'Kickoff sign-off' },
      { phase_id: 'ph-02', phase_name: 'Build & Configure',      start_week: 3, end_week: 5,  duration: 'Weeks 3–5',   governance_checkpoint: 'Security & DPA gate' },
      { phase_id: 'ph-03', phase_name: 'Validate & Pilot',       start_week: 6, end_week: 8,  duration: 'Weeks 6–8',   governance_checkpoint: 'UAT sign-off' },
      { phase_id: 'ph-04', phase_name: 'Deploy & Review',        start_week: 9, end_week: 12, duration: 'Weeks 9–12',  governance_checkpoint: 'Executive go-live' },
    ] as any,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP METADATA
// ─────────────────────────────────────────────────────────────────────────────

interface StepMeta {
  n:       number;
  fn:      string;
  label:   string;
  input:   string;
  output:  string;
  icon:    React.ComponentType<{ className?: string }>;
  color:   string;
  rule:    string;
}

const STEPS: StepMeta[] = [
  { n: 1, fn: 'createExecutionShell',      label: 'Execution Shell',       input: 'proposal_snapshot',          output: 'execution_id + shell',       icon: Package,    color: BRAND.purple, rule: 'Execution always born from immutable snapshot' },
  { n: 2, fn: 'mapSolutionsToWorkstreams', label: 'Workstreams',           input: 'solutions[]',                output: 'Workstream[] + owner roles',  icon: GitBranch,  color: BRAND.blue,   rule: 'Owner auto-assigned by solution type — no manual tagging' },
  { n: 3, fn: 'mapPhasesToMilestones',     label: 'Milestones',            input: 'implementation_phases[]',    output: 'Milestone[] + dependencies',  icon: Calendar,   color: BRAND.cyan,   rule: 'Milestones are timeline-driven, not solution-driven' },
  { n: 4, fn: 'mapDeliverablestoTasks',    label: 'Tasks',                 input: 'milestones[] × workstreams[]', output: 'Task[] + role assignments',  icon: List,       color: BRAND.green,  rule: 'Role assigned by verb: Build→Engineer, Validate→QA, Deploy→Ops' },
  { n: 5, fn: 'generateGates',             label: 'Governance Gates',      input: 'milestones[] + assumptions', output: 'Gate[] (4 checkpoints)',       icon: Shield,     color: BRAND.orange, rule: 'Milestone cannot complete if its required gate is not passed' },
  { n: 6, fn: 'captureBaselineLock',       label: 'Baseline Lock',         input: 'roi_snapshot',               output: 'BaselineLock (immutable anchor)', icon: Lock,    color: BRAND.red,    rule: 'ROI actuals never modify projected ROI — baseline is read-only' },
  { n: 7, fn: 'copyScopeBoundaries',       label: 'Scope Boundaries',      input: 'scope_boundaries (frozen)',  output: 'ScopeBoundary + integrations', icon: Target,    color: '#A78BFA',    rule: 'Scope changes after snapshot trigger a change order, not an edit' },
  { n: 8, fn: 'buildDependencyGraph',      label: 'Dependency Graph',      input: 'tasks + milestones + gates', output: 'DAG + critical path',         icon: Network,    color: '#34D399',    rule: 'Cannot deploy before build; cannot optimize before deploy' },
];

type PipelineTab = 'workstreams' | 'milestones' | 'tasks' | 'gates' | 'baseline' | 'scope' | 'graph' | 'log';

// ─────────────────────────────────────────────────────────────────────────────
// STATUS BADGE
// ─────────────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { bg: string; text: string; dot: string }> = {
    complete:     { bg: 'bg-emerald-500/10',  text: 'text-emerald-400',  dot: 'bg-emerald-400'  },
    in_progress:  { bg: 'bg-blue-500/10',     text: 'text-blue-400',     dot: 'bg-blue-400'     },
    not_started:  { bg: 'bg-gray-500/10',     text: 'text-gray-400',     dot: 'bg-gray-500'     },
    blocked:      { bg: 'bg-red-500/10',      text: 'text-red-400',      dot: 'bg-red-400'      },
    passed:       { bg: 'bg-emerald-500/10',  text: 'text-emerald-400',  dot: 'bg-emerald-400'  },
    pending:      { bg: 'bg-amber-500/10',    text: 'text-amber-400',    dot: 'bg-amber-400'    },
    confirmed:    { bg: 'bg-cyan-500/10',     text: 'text-cyan-400',     dot: 'bg-cyan-400'     },
  };
  const s = cfg[status] ?? cfg.not_started;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${s.bg} ${s.text}`}>
      <span className={`size-1.5 rounded-full ${s.dot}`} />
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIORITY BADGE
// ─────────────────────────────────────────────────────────────────────────────

function PriorityBadge({ p }: { p: string }) {
  const c = p === 'high' || p === 'critical' ? 'text-red-400' : p === 'medium' ? 'text-amber-400' : 'text-gray-500';
  return <span className={`text-[10px] font-bold uppercase ${c}`}>{p}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PANEL
// ─────────────────────────────────────────────────────────────────────────────

export function MappingEnginePanel() {
  const [running,      setRunning]      = useState(false);
  const [activeStep,   setActiveStep]   = useState<number>(-1);   // -1 = idle
  const [result,       setResult]       = useState<MappingPipelineResult | null>(null);
  const [activeTab,    setActiveTab]    = useState<PipelineTab>('workstreams');
  const [stepTick,     setStepTick]     = useState<number>(-1);   // which step is animating
  const [elapsed,      setElapsed]      = useState<number | null>(null);
  const cancelRef = useRef(false);

  const validation = validateSnapshotForMapping(DEMO_SNAPSHOT);

  const runPipeline = async () => {
    cancelRef.current = false;
    setRunning(true);
    setResult(null);
    setActiveStep(0);
    setElapsed(null);

    const t0 = performance.now();

    // Animate through all 8 steps with a small delay each
    for (let i = 0; i < 8; i++) {
      if (cancelRef.current) break;
      setActiveStep(i);
      setStepTick(i);
      await delay(220);
    }

    if (!cancelRef.current) {
      const res = runMappingPipeline(DEMO_SNAPSHOT, 'account-lead-01');
      setResult(res);
      setElapsed(Math.round(performance.now() - t0));
      setActiveStep(8); // "done"
    }

    setRunning(false);
  };

  const reset = () => {
    cancelRef.current = true;
    setRunning(false);
    setActiveStep(-1);
    setStepTick(-1);
    setResult(null);
    setElapsed(null);
  };

  const tabs: { id: PipelineTab; label: string; icon: React.ComponentType<{ className?: string }>; count?: number; disabled?: boolean }[] = [
    { id: 'workstreams', label: 'Workstreams',       icon: GitBranch,  count: result?.project.workstreams.length },
    { id: 'milestones',  label: 'Milestones',        icon: Calendar,   count: result?.project.milestones.length },
    { id: 'tasks',       label: 'Tasks',             icon: List,       count: result?.project.tasks.length },
    { id: 'gates',       label: 'Gates',             icon: Shield,     count: result?.project.gates.length },
    { id: 'baseline',    label: 'Baseline Lock',     icon: Lock },
    { id: 'scope',       label: 'Scope Boundaries',  icon: Target },
    { id: 'graph',       label: 'Dep Graph',         icon: Network,    count: result?.project.dependency_graph.nodes.length },
    { id: 'log',         label: 'Step Log',          icon: Activity,   count: result?.step_log.length },
  ];

  return (
    <div className="flex flex-col h-full bg-[#0A0A0F] text-white overflow-auto">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-6 pt-6 pb-4 border-b border-white/10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="size-9 rounded-xl bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center shadow-lg shadow-[#8B5CF6]/20">
                <GitBranch className="size-4 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white tracking-tight">Mapping Engine</h1>
                <p className="text-xs text-gray-500 font-mono">proposal_snapshot → execution_blueprint</p>
              </div>
            </div>
            <p className="text-sm text-gray-400 max-w-2xl mt-2">
              Deterministic 8-step pipeline. Every workstream, milestone, task, gate, baseline lock, scope boundary,
              and dependency graph is generated by math from an immutable proposal snapshot — no LLM involved.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0 mt-1">
            {result && (
              <button
                onClick={reset}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 border border-white/10 transition-colors"
              >
                <RefreshCw className="size-3.5" />
                Reset
              </button>
            )}
            <button
              onClick={running ? reset : runPipeline}
              disabled={false}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                running
                  ? 'bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20'
                  : result
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 cursor-default'
                  : 'bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] text-white hover:opacity-90 shadow-lg shadow-[#8B5CF6]/20'
              }`}
            >
              {running ? (
                <span className="contents"><RefreshCw className="size-4 animate-spin" />Running…</span>
              ) : result ? (
                <span className="contents"><CheckCircle2 className="size-4" />Pipeline Complete</span>
              ) : (
                <span className="contents"><Play className="size-4" />Run Pipeline</span>
              )}
            </button>
          </div>
        </div>

        {/* Snapshot badge */}
        <div className="flex items-center gap-3 mt-4 p-3 bg-white/3 rounded-xl border border-white/8">
          <div className="size-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center flex-shrink-0">
            <Database className="size-3.5 text-purple-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-white truncate">
              {(DEMO_SNAPSHOT.content_snapshot.executive_brief as any)?.title ?? DEMO_SNAPSHOT.proposal_id}
            </p>
            <p className="text-[11px] text-gray-500 font-mono">
              {DEMO_SNAPSHOT.proposal_snapshot_id} · v{DEMO_SNAPSHOT.version_number} · {DEMO_SNAPSHOT.version_hash} · status: {DEMO_SNAPSHOT.status}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {validation.errors.length === 0 ? (
              <span className="flex items-center gap-1.5 text-emerald-400 text-xs font-semibold">
                <CheckCircle2 className="size-3.5" /> Snapshot valid
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-red-400 text-xs font-semibold">
                <AlertCircle className="size-3.5" /> {validation.errors.length} error{validation.errors.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Pipeline visualiser ─────────────────────────────────────────────── */}
      <div className="px-6 py-5 border-b border-white/8">
        <div className="flex items-start gap-0 overflow-x-auto pb-1">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            const stepDone   = result ? true : (activeStep > i);
            const stepActive = running && activeStep === i;
            const stepPassed = stepDone && !stepActive;

            return (
              <span key={step.n} className="contents">
                <motion.div
                  className={`flex-shrink-0 flex flex-col items-center gap-1.5 px-2 cursor-default min-w-[80px]`}
                  animate={{
                    opacity: activeStep === -1 ? 0.4 : (stepPassed || stepActive) ? 1 : 0.3,
                  }}
                  transition={{ duration: 0.2 }}
                >
                  {/* Step circle */}
                  <div
                    className={`size-10 rounded-full flex items-center justify-center transition-all duration-300 relative ${
                      stepPassed
                        ? 'bg-emerald-500/15 border border-emerald-500/40'
                        : stepActive
                        ? 'border-2 border-white/40'
                        : 'bg-white/3 border border-white/10'
                    }`}
                    style={stepActive ? { borderColor: step.color, backgroundColor: `${step.color}18` } : {}}
                  >
                    {stepActive && (
                      <motion.div
                        className="absolute inset-0 rounded-full"
                        style={{ border: `2px solid ${step.color}` }}
                        animate={{ opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 0.9, repeat: Infinity }}
                      />
                    )}
                    {stepPassed
                      ? <CheckCircle2 className="size-4 text-emerald-400" />
                      : <Icon className={`size-4 ${stepActive ? '' : 'text-gray-600'}`} style={stepActive ? { color: step.color } : {}} />
                    }
                  </div>

                  {/* Label */}
                  <div className="text-center">
                    <p className={`text-[10px] font-bold uppercase tracking-wide ${stepPassed ? 'text-emerald-400' : stepActive ? 'text-white' : 'text-gray-600'}`}>
                      {step.n}
                    </p>
                    <p className={`text-[10px] leading-tight text-center max-w-[72px] ${stepPassed ? 'text-gray-300' : stepActive ? 'text-gray-200' : 'text-gray-600'}`}>
                      {step.label}
                    </p>
                  </div>
                </motion.div>

                {/* Connector */}
                {i < STEPS.length - 1 && (
                  <div className="flex-shrink-0 flex items-center pt-2 mx-0.5">
                    <motion.div
                      className="h-px w-5"
                      style={{ background: STEPS[i + 1] ? (activeStep > i && activeStep !== -1 ? BRAND.green : '#374151') : '#374151' }}
                      animate={{ opacity: 1 }}
                    />
                    <ChevronRight className={`size-3 -ml-1 ${activeStep > i && activeStep !== -1 ? 'text-emerald-500' : 'text-gray-600'}`} />
                  </div>
                )}
              </span>
            );
          })}
        </div>

        {/* Active step detail bar */}
        <AnimatePresence mode="wait">
          {running && activeStep >= 0 && activeStep < 8 && (
            <motion.div
              key={activeStep}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-3 flex items-center gap-3 p-3 rounded-xl border"
              style={{ backgroundColor: `${STEPS[activeStep].color}08`, borderColor: `${STEPS[activeStep].color}25` }}
            >
              <div className="size-6 rounded-md flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${STEPS[activeStep].color}20` }}>
                {(() => { const Icon = STEPS[activeStep].icon; return <Icon className="size-3.5" style={{ color: STEPS[activeStep].color }} />; })()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-white">
                  Step {STEPS[activeStep].n}: <span className="font-mono">{STEPS[activeStep].fn}()</span>
                </p>
                <p className="text-[11px] text-gray-400">
                  Input: <span className="font-mono text-gray-300">{STEPS[activeStep].input}</span>
                  <span className="mx-2 text-gray-600">→</span>
                  Output: <span className="font-mono text-gray-300">{STEPS[activeStep].output}</span>
                </p>
              </div>
              <p className="text-[11px] text-gray-500 italic flex-shrink-0 max-w-[220px] text-right">
                "{STEPS[activeStep].rule}"
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Completion summary bar */}
        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-3 flex items-center gap-4 p-3 bg-emerald-500/5 rounded-xl border border-emerald-500/20"
            >
              <CheckCircle2 className="size-4 text-emerald-400 flex-shrink-0" />
              <p className="text-xs font-semibold text-emerald-300 flex-1">
                Pipeline completed in {elapsed}ms — {result.project.execution_id}
              </p>
              <div className="flex items-center gap-3 text-[11px] text-gray-400">
                <span className="text-white font-semibold">{result.project.workstreams.length}</span> workstreams
                <span className="text-white font-semibold">{result.project.milestones.length}</span> milestones
                <span className="text-white font-semibold">{result.project.tasks.length}</span> tasks
                <span className="text-white font-semibold">{result.project.gates.length}</span> gates
                <span className="text-white font-semibold">{result.project.dependency_graph.nodes.length}</span> dep nodes
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Output tabs (only shown after pipeline run) ─────────────────────── */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex-1 flex flex-col overflow-hidden"
          >
            {/* Tab bar */}
            <div className="flex items-center gap-1 px-6 pt-4 pb-0 flex-wrap">
              {tabs.map(t => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id)}
                    disabled={t.disabled}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      activeTab === t.id
                        ? 'bg-[#8B5CF6]/20 text-[#A78BFA] border border-[#8B5CF6]/30'
                        : t.disabled
                        ? 'text-gray-600 cursor-not-allowed'
                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <Icon className="size-3" />
                    {t.label}
                    {t.count != null && (
                      <span className="bg-white/10 text-gray-300 rounded px-1 py-0.5 text-[9px] font-bold">
                        {t.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-auto px-6 pt-4 pb-6">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  {activeTab === 'workstreams' && (
                    <WorkstreamsTab ws={result.project.workstreams} />
                  )}
                  {activeTab === 'milestones' && (
                    <MilestonesTab ms={result.project.milestones} />
                  )}
                  {activeTab === 'tasks' && (
                    <TasksTab tasks={result.project.tasks} milestones={result.project.milestones} />
                  )}
                  {activeTab === 'gates' && (
                    <GatesTab gates={result.project.gates} milestones={result.project.milestones} />
                  )}
                  {activeTab === 'baseline' && (
                    <BaselineTab bl={result.project.baseline} />
                  )}
                  {activeTab === 'scope' && (
                    <ScopeTab scope={result.project.scope_boundaries} />
                  )}
                  {activeTab === 'graph' && (
                    <GraphTab graph={result.project.dependency_graph} />
                  )}
                  {activeTab === 'log' && (
                    <StepLogTab log={result.step_log} elapsed={elapsed ?? 0} />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      {!result && !running && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-12 text-center">
          <div className="size-16 rounded-2xl bg-white/3 border border-white/10 flex items-center justify-center mb-2">
            <GitBranch className="size-7 text-gray-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-200">Pipeline ready to run</h3>
          <p className="text-sm text-gray-500 max-w-sm">
            Press "Run Pipeline" to execute all 8 mapping steps against the ExampleCo snapshot.
            The full execution blueprint — workstreams, milestones, tasks, gates, baseline lock,
            scope boundaries, and dependency graph — will be generated in under a second.
          </p>
          <div className="grid grid-cols-4 gap-2 mt-4 max-w-lg w-full text-left">
            {STEPS.map(s => {
              const Icon = s.icon;
              return (
                <div key={s.n} className="p-3 bg-white/3 rounded-xl border border-white/8 hover:border-white/15 transition-colors">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Icon className="size-3.5" style={{ color: s.color }} />
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Step {s.n}</span>
                  </div>
                  <p className="text-[11px] font-semibold text-gray-200">{s.label}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-TABS
// ─────────────────────────────────────────────────────────────────────────────

function SectionTitle({ icon: Icon, title, color = BRAND.purple }: { icon: React.ComponentType<{ className?: string }>, title: string, color?: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="size-6 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}18` }}>
        <Icon className="size-3.5" style={{ color }} />
      </div>
      <h3 className="text-sm font-semibold text-white">{title}</h3>
    </div>
  );
}

function WorkstreamsTab({ ws }: { ws: any[] }) {
  return (
    <div>
      <SectionTitle icon={GitBranch} title={`Workstreams (${ws.length}) — Step 2: owner auto-assigned by solution type`} color={BRAND.blue} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {ws.map((w, i) => (
          <motion.div
            key={w.workstream_id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="p-4 bg-white/3 rounded-xl border border-white/10 hover:border-white/20 transition-colors"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <p className="text-sm font-semibold text-white leading-snug">{w.title}</p>
              <StatusBadge status={w.status} />
            </div>
            <p className="text-xs text-gray-400 mb-3 leading-relaxed line-clamp-2">{w.scope_summary}</p>
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="flex items-center gap-1 text-blue-400"><Users className="size-3" />{w.owner_role}</span>
              <span className="flex items-center gap-1 text-gray-400"><Clock className="size-3" />Wk {w.start_week}–{w.end_week}</span>
              <span className="flex items-center gap-1 text-purple-400"><Hash className="size-3" />{w.solution_type}</span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function MilestonesTab({ ms }: { ms: any[] }) {
  return (
    <div>
      <SectionTitle icon={Calendar} title={`Milestones (${ms.length}) — Step 3: timeline-driven sequential chain`} color={BRAND.cyan} />
      <div className="relative flex flex-col gap-0">
        {ms.map((m, i) => (
          <motion.div
            key={m.milestone_id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06 }}
            className="flex gap-4"
          >
            {/* Timeline line */}
            <div className="flex flex-col items-center">
              <div className={`size-8 rounded-full flex items-center justify-center flex-shrink-0 border-2 ${
                m.status === 'complete'    ? 'bg-emerald-500/15 border-emerald-500/50' :
                m.status === 'in_progress' ? 'bg-blue-500/15 border-blue-500/50' :
                'bg-white/5 border-white/15'
              }`}>
                {m.status === 'complete' ? (
                  <CheckCircle2 className="size-3.5 text-emerald-400" />
                ) : (
                  <span className="text-xs font-bold text-gray-400">P{m.phase_number}</span>
                )}
              </div>
              {i < ms.length - 1 && (
                <div className={`w-px flex-1 mt-0.5 mb-0.5 min-h-[20px] ${i < ms.findIndex(x => x.status === 'not_started') ? 'bg-emerald-500/30' : 'bg-white/8'}`} />
              )}
            </div>

            <div className="flex-1 pb-4">
              <div className="p-4 bg-white/3 rounded-xl border border-white/10 hover:border-white/20 transition-colors">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-sm font-semibold text-white">{m.title}</p>
                  <StatusBadge status={m.status} />
                </div>
                <div className="flex flex-wrap gap-3 text-[11px] text-gray-400 mt-1.5">
                  <span className="flex items-center gap-1"><Clock className="size-3" />{m.duration}</span>
                  {m.governance_checkpoint && (
                    <span className="flex items-center gap-1 text-amber-400"><Flag className="size-3" />{m.governance_checkpoint}</span>
                  )}
                  {m.depends_on_milestone_id && (
                    <span className="flex items-center gap-1"><ChevronRight className="size-3" />depends on previous</span>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function TasksTab({ tasks, milestones }: { tasks: any[]; milestones: any[] }) {
  const msMap = Object.fromEntries(milestones.map(m => [m.milestone_id, m.title]));
  const grouped: Record<string, any[]> = {};
  tasks.forEach(t => {
    const k = msMap[t.milestone_id] ?? 'Unknown';
    if (!grouped[k]) grouped[k] = [];
    grouped[k].push(t);
  });

  return (
    <div>
      <SectionTitle icon={List} title={`Tasks (${tasks.length}) — Step 4: role auto-assigned by verb`} color={BRAND.green} />
      <div className="space-y-4">
        {Object.entries(grouped).map(([msTitle, msTasks], gi) => (
          <div key={msTitle}>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
              <Calendar className="size-3 text-cyan-400" />
              {msTitle}
            </h4>
            <div className="space-y-1.5">
              {msTasks.map((t, i) => (
                <motion.div
                  key={t.task_id}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: (gi * 0.1) + (i * 0.04) }}
                  className="flex items-center gap-3 p-3 bg-white/2 rounded-lg border border-white/8 hover:border-white/15 transition-colors"
                >
                  <div className={`size-5 rounded-full flex-shrink-0 flex items-center justify-center border ${
                    t.status === 'complete'    ? 'bg-emerald-500/15 border-emerald-500/40' :
                    t.status === 'in_progress' ? 'bg-blue-500/15 border-blue-500/40' :
                    'bg-white/5 border-white/10'
                  }`}>
                    {t.status === 'complete' && <CheckCircle2 className="size-3 text-emerald-400" />}
                  </div>
                  <p className={`flex-1 text-xs ${t.status === 'complete' ? 'text-gray-500 line-through' : 'text-gray-200'}`}>
                    {t.title}
                  </p>
                  <span className="text-[11px] text-blue-400 font-medium flex-shrink-0">{t.assigned_role}</span>
                  <PriorityBadge p={t.priority} />
                  <span className="text-[10px] text-gray-600 font-mono flex-shrink-0 hidden md:block">
                    {new Date(t.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                  </span>
                </motion.div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GatesTab({ gates, milestones }: { gates: any[]; milestones: any[] }) {
  const msMap = Object.fromEntries(milestones.map(m => [m.milestone_id, m.title]));
  const typeIcon: Record<string, React.ComponentType<{ className?: string }>> = {
    access: Lock, security: Shield, uat: Eye, approval: Flag, compliance: CheckCircle2,
  };

  return (
    <div>
      <SectionTitle icon={Shield} title={`Governance Gates (${gates.length}) — Step 5: milestone cannot complete if gate is pending`} color={BRAND.orange} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {gates.map((g, i) => {
          const Icon = typeIcon[g.type] ?? Shield;
          return (
            <motion.div
              key={g.gate_id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}
              className="p-4 bg-white/3 rounded-xl border border-white/10 hover:border-white/20 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className={`size-8 rounded-lg flex items-center justify-center flex-shrink-0 ${g.status === 'passed' ? 'bg-emerald-500/15' : 'bg-amber-500/10'}`}>
                  <Icon className={`size-4 ${g.status === 'passed' ? 'text-emerald-400' : 'text-amber-400'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <p className="text-sm font-semibold text-white truncate">{g.title}</p>
                    <StatusBadge status={g.status} />
                  </div>
                  <p className="text-xs text-gray-400 leading-relaxed">{g.description}</p>
                  <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-500">
                    <span>Phase: {msMap[g.milestone_id] ?? '—'}</span>
                    <span className="uppercase font-semibold text-purple-400">{g.type}</span>
                    {g.passed_by && <span className="text-emerald-400">by {g.passed_by}</span>}
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function BaselineTab({ bl }: { bl: any }) {
  if (!bl) return <p className="text-sm text-gray-500">No baseline lock generated.</p>;
  const metrics = [
    { label: 'Total Investment',       value: `$${((bl.metrics_snapshot.total_investment ?? 0) / 1000).toFixed(0)}K`,       icon: TrendingUp, color: BRAND.blue   },
    { label: 'Monthly Cost (Before)',  value: `$${((bl.metrics_snapshot.monthly_cost_before ?? 0) / 1000).toFixed(0)}K/mo`,  icon: BarChart2,  color: BRAND.orange },
    { label: 'Hours Wasted (Monthly)', value: `${bl.metrics_snapshot.hours_wasted_monthly ?? 0} hrs`,                       icon: Clock,      color: BRAND.red    },
    { label: 'Revenue at Risk (Ann.)', value: `$${((bl.metrics_snapshot.revenue_at_risk_annual ?? 0) / 1000).toFixed(0)}K/yr`, icon: Flag,     color: BRAND.red    },
    { label: 'Payback Period',         value: `${bl.metrics_snapshot.payback_months ?? 0} months`,                          icon: Calendar,   color: BRAND.green  },
    { label: 'ROI (12 Month)',         value: `${bl.metrics_snapshot.roi_12m_percent ?? 0}%`,                               icon: TrendingUp, color: BRAND.green  },
  ];

  return (
    <div>
      <SectionTitle icon={Lock} title="Baseline Lock — Step 6: immutable ROI anchor, never editable without change order" color={BRAND.red} />
      <div className="p-3 mb-4 bg-amber-500/5 rounded-xl border border-amber-500/20 flex items-center gap-2">
        <Lock className="size-3.5 text-amber-400 flex-shrink-0" />
        <p className="text-xs text-amber-300">
          This baseline is <strong>immutable</strong>. ROI actuals are compared against it — they never modify it.
          Any investment changes require a formal change order.
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        {metrics.map(m => {
          const Icon = m.icon;
          return (
            <div key={m.label} className="p-4 bg-white/3 rounded-xl border border-white/10">
              <div className="flex items-center gap-2 mb-2">
                <Icon className="size-3.5" style={{ color: m.color }} />
                <p className="text-[11px] text-gray-400 uppercase tracking-wide font-semibold">{m.label}</p>
              </div>
              <p className="text-xl font-black text-white">{m.value}</p>
            </div>
          );
        })}
      </div>
      <div className="text-xs text-gray-600 font-mono">
        Baseline ID: {bl.baseline_id} · Quality: {bl.baseline_quality} · Captured: {new Date(bl.captured_at).toLocaleString()}
      </div>
    </div>
  );
}

function ScopeTab({ scope }: { scope: any }) {
  if (!scope) return <p className="text-sm text-gray-500">No scope boundaries.</p>;
  return (
    <div>
      <SectionTitle icon={Target} title="Scope Boundaries — Step 7: frozen from snapshot, changes require change order" color="#A78BFA" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 bg-emerald-500/5 rounded-xl border border-emerald-500/15">
          <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5" /> Included ({scope.scope_included?.length ?? 0})
          </h4>
          <ul className="space-y-2">
            {(scope.scope_included ?? []).map((item: string, i: number) => (
              <li key={i} className="text-xs text-gray-300 flex items-start gap-2">
                <span className="size-1.5 rounded-full bg-emerald-500/60 flex-shrink-0 mt-1.5" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="p-4 bg-red-500/5 rounded-xl border border-red-500/15">
          <h4 className="text-xs font-bold text-red-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <AlertCircle className="size-3.5" /> Excluded ({scope.scope_excluded?.length ?? 0})
          </h4>
          <ul className="space-y-2">
            {(scope.scope_excluded ?? []).map((item: string, i: number) => (
              <li key={i} className="text-xs text-gray-300 flex items-start gap-2">
                <span className="size-1.5 rounded-full bg-red-500/60 flex-shrink-0 mt-1.5" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="p-4 bg-blue-500/5 rounded-xl border border-blue-500/15">
          <h4 className="text-xs font-bold text-blue-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <Network className="size-3.5" /> Integration Points ({scope.integration_points?.length ?? 0})
          </h4>
          <ul className="space-y-2">
            {(scope.integration_points ?? []).map((item: string, i: number) => (
              <li key={i} className="text-xs text-gray-300 flex items-start gap-2">
                <span className="size-1.5 rounded-full bg-blue-500/60 flex-shrink-0 mt-1.5" />
                {item}
              </li>
            ))}
          </ul>
          {(scope.assumptions ?? []).length > 0 && (
            <div className="mt-3 pt-3 border-t border-blue-500/15">
              <p className="text-[11px] font-bold text-blue-300 uppercase tracking-wide mb-2">Assumptions</p>
              <ul className="space-y-1.5">
                {(scope.assumptions ?? []).map((a: string, i: number) => (
                  <li key={i} className="text-[11px] text-gray-400">{a}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function GraphTab({ graph }: { graph: any }) {
  const nodes      = graph?.nodes      ?? [];
  const edges      = graph?.edges      ?? [];
  const critPath   = graph?.critical_path ?? [];
  const violations = graph?.violations ?? [];

  const typeOrder  = ['milestone', 'gate', 'task'];
  const grouped    = typeOrder.reduce<Record<string, any[]>>((acc, t) => {
    acc[t] = nodes.filter((n: any) => n.type === t);
    return acc;
  }, {});

  const typeColor: Record<string, string> = { milestone: BRAND.cyan, gate: BRAND.orange, task: BRAND.green };

  return (
    <div>
      <SectionTitle icon={Network} title={`Dependency Graph — Step 8: ${nodes.length} nodes · ${edges.length} edges · ${critPath.length} on critical path`} color="#34D399" />
      {violations.length > 0 && (
        <div className="mb-4 p-3 bg-red-500/8 rounded-xl border border-red-500/20">
          <p className="text-xs font-semibold text-red-400 mb-1.5">⚠ {violations.length} dependency violation{violations.length > 1 ? 's' : ''} detected</p>
          {violations.map((v: any, i: number) => (
            <p key={i} className="text-[11px] text-red-300">{v.message ?? JSON.stringify(v)}</p>
          ))}
        </div>
      )}
      {critPath.length > 0 && (
        <div className="mb-4 p-3 bg-cyan-500/5 rounded-xl border border-cyan-500/20">
          <p className="text-xs font-semibold text-cyan-400 mb-2">Critical Path ({critPath.length} nodes)</p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {critPath.map((id: string, i: number) => {
              const node = nodes.find((n: any) => n.id === id);
              return (
                <span key={id} className="contents">
                  <span className="text-[11px] bg-cyan-500/10 text-cyan-300 px-2 py-0.5 rounded font-mono">
                    {node?.label ?? id.slice(0, 10)}
                  </span>
                  {i < critPath.length - 1 && <ArrowRight className="size-3 text-cyan-600 flex-shrink-0" />}
                </span>
              );
            })}
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {typeOrder.map(type => (
          <div key={type}>
            <h4 className="text-xs font-bold uppercase tracking-wide mb-2.5 flex items-center gap-1.5" style={{ color: typeColor[type] }}>
              <span className="size-1.5 rounded-full inline-block" style={{ backgroundColor: typeColor[type] }} />
              {type}s ({grouped[type]?.length ?? 0})
            </h4>
            <div className="space-y-1.5">
              {(grouped[type] ?? []).slice(0, 12).map((n: any) => (
                <div key={n.id} className="flex items-center gap-2 p-2 bg-white/2 rounded-lg border border-white/8">
                  <span className="size-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: typeColor[type] }} />
                  <span className="text-[11px] text-gray-300 flex-1 truncate">{n.label ?? n.id}</span>
                  {critPath.includes(n.id) && (
                    <span className="text-[9px] font-bold text-cyan-400 flex-shrink-0">CRIT</span>
                  )}
                </div>
              ))}
              {(grouped[type]?.length ?? 0) > 12 && (
                <p className="text-[11px] text-gray-600 pl-2">+{(grouped[type]?.length ?? 0) - 12} more…</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepLogTab({ log, elapsed }: { log: PipelineStepLog[]; elapsed: number }) {
  const maxDuration = Math.max(...log.map(s => s.duration ?? 0), 1);

  return (
    <div>
      <SectionTitle icon={Activity} title={`Step Execution Log — pipeline completed in ${elapsed}ms`} color={BRAND.purple} />
      <div className="rounded-xl border border-white/10 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-white/3 border-b border-white/10">
              <th className="text-left px-4 py-2.5 text-gray-400 font-semibold uppercase tracking-wide">Step</th>
              <th className="text-left px-4 py-2.5 text-gray-400 font-semibold uppercase tracking-wide">Function</th>
              <th className="text-left px-4 py-2.5 text-gray-400 font-semibold uppercase tracking-wide hidden md:table-cell">Input</th>
              <th className="text-left px-4 py-2.5 text-gray-400 font-semibold uppercase tracking-wide hidden lg:table-cell">Output</th>
              <th className="text-right px-4 py-2.5 text-gray-400 font-semibold uppercase tracking-wide w-32">Count / Time</th>
            </tr>
          </thead>
          <tbody>
            {log.map((s, i) => (
              <motion.tr
                key={s.step}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.04 }}
                className="border-b border-white/5 last:border-0 hover:bg-white/2 transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="size-5 rounded-md bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                      <CheckCircle2 className="size-3 text-emerald-400" />
                    </div>
                    <span className="font-bold text-white">#{s.step}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <code className="text-purple-300 font-mono">{s.name}()</code>
                </td>
                <td className="px-4 py-3 text-gray-400 hidden md:table-cell font-mono">{s.input}</td>
                <td className="px-4 py-3 text-gray-300 hidden lg:table-cell font-mono">{s.output}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex flex-col items-end gap-1">
                    {s.count != null && (
                      <span className="text-white font-bold">{s.count}</span>
                    )}
                    <div className="flex items-center gap-1.5">
                      <div className="h-1 bg-white/5 rounded-full w-16 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] rounded-full"
                          style={{ width: `${((s.duration ?? 0) / maxDuration) * 100}%` }}
                        />
                      </div>
                      <span className="text-gray-500 font-mono w-10 text-right">{s.duration}ms</span>
                    </div>
                  </div>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-600 mt-3 font-mono">
        Total: {elapsed}ms · {log.length} steps · 0 failures · Source: runMappingPipeline() @ mappingEngine.ts
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function delay(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}
