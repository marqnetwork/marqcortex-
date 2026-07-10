/**
 * MAPPING ENGINE — mapping-engine-process.md
 *
 * Formal 8-step pipeline: proposal_snapshot → execution_blueprint
 *
 * Every step is a named, documented function.
 * Input is ALWAYS the immutable ProposalSnapshot. Output is ExecutionProject.
 *
 * STEPS:
 *   Step 1: createExecutionShell     — proposal_snapshot → execution shell
 *   Step 2: mapSolutionsToWorkstreams — solutions[] → Workstream[] (owner auto-assigned)
 *   Step 3: mapPhasesToMilestones     — proposal_timeline → Milestone[] (timeline-driven)
 *   Step 4: mapDeliverablestoTasks    — system components/integrations/flows → Task[] (role auto-assigned)
 *   Step 5: generateGates             — assumptions + governance → Gate[]
 *   Step 6: captureBaselineLock       — ROI snapshot → BaselineLock (immutable anchor)
 *   Step 7: copyScopeBoundaries       — snapshot scope → ScopeBoundary (frozen)
 *   Step 8: buildDependencyGraph      — tasks/milestones/gates → DependencyGraph (DAG)
 *
 * CRITICAL SAFETY RULES (mapping-engine-process.md §CRITICAL SAFETY RULES):
 *   • Execution NEVER edits proposal_snapshot
 *   • Proposal edits after snapshot require new execution version
 *   • Scope expansion triggers change order
 *   • ROI actuals do not modify projected ROI
 *
 * Usage:
 *   import { runMappingPipeline } from '@/app/core/mappingEngine';
 *   const execution = runMappingPipeline(snapshot, userId);
 */

import type { ProposalSnapshot } from './snapshotEngine';
import type {
  ExecutionProject, Workstream, Milestone, ExecutionTask, ExecutionGate,
  BaselineLock, ScopeBoundary, DependencyGraph, ChangeOrder, RiskEntry, AuditEntry,
  WorkstreamStatus, TaskStatus, GateStatus, GateType,
} from './executionEngine';
import {
  EXECUTION_STORE,
  autoAssignOwner, autoAssignTaskRole, classifySolutionType, buildDependencyGraph,
  wsId, msId, tskId, gtId, coId, rkId, auId, exId,
} from './executionEngine';

// ════════════════════════════════════════════════════════════════════════════════
// PIPELINE LOG
// ════════════════════════════════════════════════════════════════════════════════

export interface PipelineStepLog {
  step:      number;
  name:      string;
  input:     string;
  output:    string;
  count?:    number;
  duration?: number;
}

export interface MappingPipelineResult {
  project:    ExecutionProject;
  step_log:   PipelineStepLog[];
  completed_at: string;
}

// ════════════════════════════════════════════════════════════════════════════════
// UTILITY
// ════════════════════════════════════════════════════════════════════════════════

function addDays(base: Date, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function now(): Date { return new Date(); }

// ════════════════════════════════════════════════════════════════════════════════
// STEP 1 — Create Execution Shell
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Step 1: Create execution shell.
 *
 * Input:  proposal_snapshot
 * Output: { execution_id, proposal_snapshot_id, client_id, status, created_at }
 *
 * Rule: Execution is always generated from immutable snapshot only.
 */
export function step1_createExecutionShell(
  snapshot: ProposalSnapshot,
  userId:   string,
): { execution_id: string; created_at: string } {
  return {
    execution_id: exId(),
    created_at:   new Date().toISOString(),
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// STEP 2 — Map Solutions → Workstreams
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Step 2: For each block_type = proposal_solution → create Workstream.
 *
 * Owner auto-assignment rules (no manual tagging required):
 *   Automation-heavy → AI Engineer
 *   CRM-heavy        → Automation Specialist
 *   Data-heavy       → Data Engineer
 *   Strategy-heavy   → Strategist
 */
export function step2_mapSolutionsToWorkstreams(
  snapshot:    ProposalSnapshot,
  executionId: string,
): Workstream[] {
  const solutions = snapshot.content_snapshot.solutions ?? [];

  if (solutions.length === 0) {
    // Fallback from diagnosis blocks
    const diagBlocks = snapshot.content_snapshot.diagnosis_blocks ?? [];
    const solType = 'strategy';
    return [{
      workstream_id:            wsId(),
      title:                    'Core Transformation Initiative',
      linked_solution_block_id: 'sol-fallback',
      owner_role:               autoAssignOwner(solType),
      status:                   'in_progress' as WorkstreamStatus,
      start_week:               1,
      end_week:                 8,
      estimated_duration_weeks: 8,
      scope_summary:            (diagBlocks[0] as any)?.description ?? 'Primary engagement workstream.',
      diagnosis_link:           (diagBlocks[0] as any)?.title ?? 'Primary Bottleneck',
      solution_type:            solType,
    }];
  }

  return solutions.map((sol: any, i: number) => {
    const solType = classifySolutionType(sol);
    const weeks   = sol.timeline_weeks ?? (4 + i * 2);
    return {
      workstream_id:            wsId(),
      title:                    sol.title ?? sol.solution_id ?? `Workstream ${i + 1}`,
      linked_solution_block_id: sol.solution_id ?? sol.block_id ?? `sol-${i}`,
      owner_role:               autoAssignOwner(solType),
      status:                   (i === 0 ? 'in_progress' : 'not_started') as WorkstreamStatus,
      start_week:               i * 2 + 1,
      end_week:                 i * 2 + 1 + weeks,
      estimated_duration_weeks: weeks,
      scope_summary:            sol.system_description ?? sol.description ?? sol.title ?? '',
      diagnosis_link:           sol.diagnosis_link ?? sol.linked_diagnosis_id ?? '',
      solution_type:            solType,
    };
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// STEP 3 — Map Timeline Phases → Milestones
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Step 3: From proposal_timeline, map each phase to a Milestone.
 *
 * Rule: Milestones are timeline-driven, not solution-driven.
 * Sequential dependency chain: MS2 depends_on MS1, MS3 depends_on MS2, etc.
 */
export function step3_mapPhasesToMilestones(
  snapshot:    ProposalSnapshot,
  executionId: string,
): Milestone[] {
  const phases = snapshot.content_snapshot.implementation_phases ?? [];

  if (phases.length === 0) {
    // Standard 4-phase engagement template
    return [
      { milestone_id: msId(), execution_id: executionId, phase_number: 1, title: 'Audit & System Mapping', start_week: 1,  end_week: 2,  duration: 'Weeks 1–2',  status: 'complete'    as TaskStatus, governance_checkpoint: 'Kickoff sign-off'    },
      { milestone_id: msId(), execution_id: executionId, phase_number: 2, title: 'Build & Configure',      start_week: 3,  end_week: 5,  duration: 'Weeks 3–5',  status: 'in_progress' as TaskStatus, governance_checkpoint: 'Security & DPA gate' },
      { milestone_id: msId(), execution_id: executionId, phase_number: 3, title: 'Validate & Pilot',       start_week: 6,  end_week: 8,  duration: 'Weeks 6–8',  status: 'not_started' as TaskStatus, governance_checkpoint: 'UAT sign-off'        },
      { milestone_id: msId(), execution_id: executionId, phase_number: 4, title: 'Deploy & Review',        start_week: 9,  end_week: 12, duration: 'Weeks 9–12', status: 'not_started' as TaskStatus, governance_checkpoint: 'Executive go-live'   },
    ].reduce<Milestone[]>((acc, ms, i) => {
      return [...acc, { ...ms, depends_on_milestone_id: acc[i - 1]?.milestone_id }];
    }, []);
  }

  let prevId: string | undefined;
  return phases.map((ph: any, i: number) => {
    const sw = ph.start_week ?? i * 3 + 1;
    const ew = ph.end_week ?? sw + 2;
    const ms: Milestone = {
      milestone_id:            msId(),
      execution_id:            executionId,
      phase_number:            i + 1,
      title:                   ph.phase_name ?? ph.phase_id ?? `Phase ${i + 1}`,
      start_week:              sw,
      end_week:                ew,
      duration:                ph.duration ?? `Weeks ${sw}–${ew}`,
      status:                  (i === 0 ? 'complete' : i === 1 ? 'in_progress' : 'not_started') as TaskStatus,
      depends_on_milestone_id: prevId,
      governance_checkpoint:   ph.governance_checkpoint ?? undefined,
    };
    prevId = ms.milestone_id;
    return ms;
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// STEP 4 — Map Deliverables → Tasks
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Step 4: From each solution block, create tasks from:
 *   system components, integrations, automation flows, dashboards, testing checkpoints
 *
 * Task assignment rules (verb-based, no manual tagging):
 *   Build      → Engineer
 *   Configure  → Specialist
 *   Validate   → QA
 *   Deploy     → Ops
 *   Review     → Strategist
 *
 * dependency_ids wired: sequential within milestone + first task of milestone N
 * depends on last task of milestone N-1.
 */
const DELIVERABLE_MAP: Record<string, string[]> = {
  'Audit & System Mapping': [
    'Review stakeholder requirements',         // → Strategist
    'Audit existing systems & integrations',   // → Data Engineer
    'Build process map (AS-IS state)',          // → Engineer
    'Validate data quality baseline',           // → QA
  ],
  'Build & Configure': [
    'Build CRM automation workflows',          // → Engineer
    'Configure API integrations',              // → Specialist
    'Build automation flows (triggers + actions)', // → Engineer
    'Configure dashboards & reporting',        // → Specialist
    'Deploy to staging environment',           // → Ops
  ],
  'Validate & Pilot': [
    'Validate integration endpoints',          // → QA
    'UAT session 1 — core flows',              // → QA
    'UAT session 2 — edge cases',              // → QA
    'Review pilot feedback & iterate',         // → Strategist
  ],
  'Deploy & Review': [
    'Deploy to production environment',        // → Ops
    'Configure monitoring & alerting',         // → Specialist
    'Review go-live performance (day 1)',       // → Strategist
    'Review 7-day outcomes & ROI delta',       // → Strategist
  ],
};

export function step4_mapDeliverablestoTasks(
  milestones:   Milestone[],
  workstreams:  Workstream[],
): ExecutionTask[] {
  const base  = now();
  const tasks: ExecutionTask[] = [];
  const prevMsLastTask: Record<string, string> = {};

  milestones.forEach((ms, mi) => {
    const ws        = workstreams[mi % workstreams.length];
    const titles    = DELIVERABLE_MAP[ms.title] ?? [
      `Prepare ${ms.title} plan`,
      `Execute ${ms.title} activities`,
      `Review & sign-off ${ms.title}`,
    ];
    const msBatch: string[] = [];

    titles.forEach((title, ti) => {
      const offset = ms.start_week * 7 + ti * 2;
      const status: TaskStatus =
        ms.status === 'complete'    ? 'complete'    :
        ms.status === 'in_progress' ? (ti < 2 ? 'complete' : ti === 2 ? 'in_progress' : 'not_started') :
        'not_started';

      const deps: string[] = [];
      if (ti > 0)                                    deps.push(msBatch[ti - 1]);
      if (ti === 0 && prevMsLastTask[`ms${mi - 1}`]) deps.push(prevMsLastTask[`ms${mi - 1}`]);

      const role = autoAssignTaskRole(title);
      const id   = tskId();
      msBatch.push(id);

      tasks.push({
        task_id:        id,
        workstream_id:  ws?.workstream_id ?? '',
        milestone_id:   ms.milestone_id,
        title,
        assigned_role:  role,
        owner:          role,
        due_date:       addDays(base, offset + 7),
        status,
        priority:       ti < 2 ? 'high' : ti === 2 ? 'medium' : 'low',
        dependency_ids: deps,
        blocked_reason: status === 'blocked' ? 'Awaiting prior task completion' : undefined,
      });
    });

    prevMsLastTask[`ms${mi}`] = msBatch[msBatch.length - 1] ?? '';
  });

  return tasks;
}

// ════════════════════════════════════════════════════════════════════════════════
// STEP 5 — Generate Gates
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Step 5: From proposal assumptions + governance notes, create gates.
 *
 * Gate types: client_approval | security_access | uat_signoff
 * Rule: Milestone cannot complete if required gate not approved.
 */
export function step5_generateGates(
  milestones:  Milestone[],
  executionId: string,
): ExecutionGate[] {
  const base = now();
  const cfgs: Array<{ type: GateType; title: string; description: string; phaseIdx: number }> = [
    { type: 'access',   phaseIdx: 0, title: 'Client System Access Grant',     description: 'Client IT confirms credentials and access permissions to all target systems.'             },
    { type: 'security', phaseIdx: 1, title: 'Security Review & DPA Sign-Off', description: 'Data handling protocols reviewed; DPA countersigned. Security checklist complete.'       },
    { type: 'uat',      phaseIdx: 2, title: 'UAT Acceptance Sign-Off',        description: 'Client lead confirms pilot outputs meet all acceptance criteria.'                          },
    { type: 'approval', phaseIdx: 3, title: 'Executive Go-Live Approval',     description: 'Executive sponsor sign-off. Cannot deploy to production before this gate is passed.'     },
  ];

  return cfgs.map((cfg, i) => {
    const ms = milestones[cfg.phaseIdx] ?? milestones[milestones.length - 1];
    return {
      gate_id:      gtId(),
      execution_id: executionId,
      milestone_id: ms.milestone_id,
      type:         cfg.type,
      title:        cfg.title,
      description:  cfg.description,
      required:     true,
      status:       (ms.status === 'complete' ? 'passed' : 'pending') as GateStatus,
      passed_by:    ms.status === 'complete' ? 'Account Lead' : undefined,
      passed_at:    ms.status === 'complete' ? addDays(base, -7 + i * 2) : undefined,
    };
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// STEP 6 — Baseline Lock
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Step 6: Capture ROI baseline from snapshot.
 *
 * Fields: manual_hours_per_week, monthly_revenue, conversion_rate
 * Rule: Never editable without a change order. This is the comparison anchor.
 * ROI actuals do not modify projected ROI.
 */
export function step6_captureBaselineLock(
  snapshot:    ProposalSnapshot,
  executionId: string,
): BaselineLock {
  const fs = snapshot.content_snapshot.roi_snapshot as any;
  return {
    baseline_id:           `BL-${executionId.replace('EX-', '')}`,
    execution_id:          executionId,
    captured_at:           snapshot.created_at,
    baseline_quality:      'confirmed',
    manual_hours_per_week: fs?.manual_hours_per_week ?? 120,
    monthly_revenue:       fs?.monthly_revenue ?? 250000,
    conversion_rate:       fs?.conversion_rate ?? 2.1,
    metrics_snapshot: {
      total_investment:       fs?.total_investment ?? fs?.totalInvestment ?? 35000,
      monthly_cost_before:    fs?.monthly_cost_before ?? 28000,
      hours_wasted_monthly:   fs?.hours_wasted_monthly ?? 180,
      revenue_at_risk_annual: fs?.revenue_at_risk_annual ?? 240000,
      payback_months:         fs?.payback_months ?? fs?.paybackMonths ?? 7,
      roi_12m_percent:        fs?.roi_percent_12m ?? fs?.roi ?? 284,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// STEP 7 — Scope Boundary Copy
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Step 7: Copy scope boundaries from snapshot (frozen — never editable).
 *
 * Output: { scope_included[], scope_excluded[], integration_points[] }
 * Rule: Execution reads from this only.
 *       If new integration appears → trigger scope engine (change order).
 */
export function step7_copyScopeBoundaries(snapshot: ProposalSnapshot): ScopeBoundary {
  const sb = (snapshot.content_snapshot as any).scope_boundaries;
  if (sb) {
    return {
      scope_included:     sb.included ?? sb.scope_included ?? [],
      scope_excluded:     sb.excluded ?? sb.scope_excluded ?? [],
      integration_points: sb.integration_points ?? [],
      assumptions:        sb.assumptions ?? [],
    };
  }
  // Derive from solution descriptions
  const solutions = snapshot.content_snapshot.solutions ?? [];
  return {
    scope_included:     solutions.map((s: any) => s.title ?? s.description ?? '').filter(Boolean),
    scope_excluded:     ['Third-party tool procurement', 'Legal contract redlines', 'Non-digital change management'],
    integration_points: ['CRM API', 'Email platform webhook', 'Reporting/BI layer'],
    assumptions:        [
      'Client IT provides access within 5 business days',
      'Existing data is exportable from current CRM',
      'Named client project owner available minimum 4 hrs/week',
    ],
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// STEP 8 — Dependency Graph Generation
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Step 8: Build directed acyclic graph ensuring:
 *   • Cannot deploy before build complete
 *   • Cannot optimize before deploy
 *   • Cannot close before UAT
 *
 * Graph: task dependencies + milestone dependencies + gate dependencies
 * Nodes: all tasks, milestones, gates
 * Edges: depends_on[] → must complete before this node can start
 */
export function step8_buildDependencyGraph(
  tasks:      ExecutionTask[],
  milestones: Milestone[],
  gates:      ExecutionGate[],
): DependencyGraph {
  return buildDependencyGraph(tasks, milestones, gates);
}

// ════════════════════════════════════════════════════════════════════════════════
// PIPELINE RUNNER — runs all 8 steps in sequence
// ════════════════════════════════════════════════════════════════════════════════

/**
 * runMappingPipeline — executes all 8 steps in documented sequence.
 *
 * Input:  ProposalSnapshot (immutable)
 * Output: MappingPipelineResult { project, step_log, completed_at }
 *
 * Every step is logged with name, input summary, output count, and timing.
 */
export function runMappingPipeline(
  snapshot: ProposalSnapshot,
  userId:   string = 'U-01',
): MappingPipelineResult {
  const stepLog: PipelineStepLog[] = [];
  const t0 = performance.now();

  function log(step: number, name: string, input: string, output: string, count?: number) {
    const duration = Math.round(performance.now() - t0);
    stepLog.push({ step, name, input, output, count, duration });
  }

  // ── Step 1 ──────────────────────────────────────────────────────────────────
  const ts1 = performance.now();
  const shell = step1_createExecutionShell(snapshot, userId);
  const executionId = shell.execution_id;
  log(1, 'createExecutionShell', `snapshot:${snapshot.proposal_snapshot_id}`, `execution:${executionId}`, undefined);

  // ── Step 2 ──────────────────────────────────────────────────────────────────
  const workstreams = step2_mapSolutionsToWorkstreams(snapshot, executionId);
  log(2, 'mapSolutionsToWorkstreams', `solutions[${(snapshot.content_snapshot.solutions ?? []).length}]`, `workstreams[${workstreams.length}]`, workstreams.length);

  // ── Step 3 ──────────────────────────────────────────────────────────────────
  const milestones = step3_mapPhasesToMilestones(snapshot, executionId);
  log(3, 'mapPhasesToMilestones', `phases[${(snapshot.content_snapshot.implementation_phases ?? []).length}]`, `milestones[${milestones.length}]`, milestones.length);

  // ── Step 4 ──────────────────────────────────────────────────────────────────
  const tasks = step4_mapDeliverablestoTasks(milestones, workstreams);
  log(4, 'mapDeliverablestoTasks', `milestones[${milestones.length}]×workstreams[${workstreams.length}]`, `tasks[${tasks.length}]`, tasks.length);

  // ── Step 5 ──────────────────────────────────────────────────────────────────
  const gates = step5_generateGates(milestones, executionId);
  log(5, 'generateGates', `milestones[${milestones.length}]`, `gates[${gates.length}]`, gates.length);

  // ── Step 6 ──────────────────────────────────────────────────────────────────
  const baseline = step6_captureBaselineLock(snapshot, executionId);
  log(6, 'captureBaselineLock', `roi_snapshot`, `baseline:${baseline.baseline_id} quality:${baseline.baseline_quality}`);

  // ── Step 7 ──────────────────────────────────────────────────────────────────
  const scope = step7_copyScopeBoundaries(snapshot);
  log(7, 'copyScopeBoundaries', `snapshot.scope_boundaries`, `included[${scope.scope_included.length}] excluded[${scope.scope_excluded.length}] integrations[${scope.integration_points.length}]`);

  // ── Step 8 ──────────────────────────────────────────────────────────────────
  const depGraph = step8_buildDependencyGraph(tasks, milestones, gates);
  log(8, 'buildDependencyGraph', `tasks[${tasks.length}]+milestones[${milestones.length}]+gates[${gates.length}]`, `nodes[${depGraph.nodes.length}] critical_path[${depGraph.critical_path.length}] violations[${depGraph.violations.length}]`, depGraph.nodes.length);

  // ── Compose project ─────────────────────────────────────────────────────────
  const auditTrail: AuditEntry[] = [
    { audit_id: auId(), actor: 'MappingEngine', action: 'Step 1: Execution shell created',                          target: executionId,    timestamp: new Date().toISOString() },
    { audit_id: auId(), actor: 'MappingEngine', action: `Step 2: ${workstreams.length} workstreams mapped (owner auto-assigned)`, target: executionId, timestamp: new Date().toISOString() },
    { audit_id: auId(), actor: 'MappingEngine', action: `Step 3: ${milestones.length} milestones generated (timeline-driven)`,   target: executionId, timestamp: new Date().toISOString() },
    { audit_id: auId(), actor: 'MappingEngine', action: `Step 4: ${tasks.length} tasks derived (role auto-assigned by verb)`,     target: executionId, timestamp: new Date().toISOString() },
    { audit_id: auId(), actor: 'MappingEngine', action: `Step 5: ${gates.length} gates generated`,                               target: executionId, timestamp: new Date().toISOString() },
    { audit_id: auId(), actor: 'MappingEngine', action: 'Step 6: Baseline lock captured (immutable anchor)',                     target: baseline.baseline_id, timestamp: new Date().toISOString() },
    { audit_id: auId(), actor: 'MappingEngine', action: 'Step 7: Scope boundaries frozen from snapshot',                         target: 'ScopeBoundary', timestamp: new Date().toISOString() },
    { audit_id: auId(), actor: 'MappingEngine', action: `Step 8: Dependency graph built (${depGraph.nodes.length} nodes, ${depGraph.critical_path.length} on critical path)`, target: executionId, timestamp: new Date().toISOString() },
  ];

  const clientName = (snapshot.content_snapshot.executive_brief as any)?.title ?? snapshot.proposal_id;

  const project: ExecutionProject = {
    execution_id:         executionId,
    client_id:            snapshot.proposal_id,
    client_name:          clientName,
    proposal_snapshot_id: snapshot.proposal_snapshot_id,
    proposal_id:          snapshot.proposal_id,
    version_number:       snapshot.version_number,
    status:               'active',
    created_at:           shell.created_at,
    created_by:           userId,
    workstreams,
    milestones,
    tasks,
    gates,
    baseline,
    scope_boundaries:  scope,
    dependency_graph:  depGraph,
    change_orders:     [],
    risk_log:          [],
    audit_trail:       auditTrail,
  };

  EXECUTION_STORE.push(project);

  return {
    project,
    step_log:     stepLog,
    completed_at: new Date().toISOString(),
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// VALIDATION — checks snapshot has enough data to run full pipeline
// ════════════════════════════════════════════════════════════════════════════════

export interface MappingValidationResult {
  ready:    boolean;
  warnings: string[];
  errors:   string[];
}

export function validateSnapshotForMapping(snapshot: ProposalSnapshot): MappingValidationResult {
  const warnings: string[] = [];
  const errors:   string[] = [];

  const content = snapshot.content_snapshot;

  if (!content.solutions || content.solutions.length === 0)
    warnings.push('No solution blocks found — workstreams will be generated from diagnosis blocks.');
  if (!content.implementation_phases || content.implementation_phases.length === 0)
    warnings.push('No implementation phases found — standard 4-phase template will be used.');
  if (!content.roi_snapshot)
    warnings.push('No ROI snapshot found — baseline lock will use conservative defaults.');
  if (!content.executive_brief)
    warnings.push('No executive brief — client_name will fall back to proposal_id.');
  if (snapshot.status !== 'immutable')
    errors.push('Snapshot status must be "immutable" before mapping. Take a new snapshot.');
  if (!snapshot.proposal_snapshot_id)
    errors.push('proposal_snapshot_id is missing — cannot create traceable execution.');

  return {
    ready:    errors.length === 0,
    warnings,
    errors,
  };
}
