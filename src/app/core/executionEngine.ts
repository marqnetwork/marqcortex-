/**
 * EXECUTION BLUEPRINT ENGINE — execution-blueprint.md + mapping-engine-process.md
 *
 * Generates a deterministic execution project from a proposal_snapshot_id.
 * Source is ALWAYS the snapshot — never the live proposal.
 *
 * Data hierarchy (8 steps from mapping-engine-process.md):
 *   Step 1: execution shell
 *   Step 2: workstreams (1 per solution, owner auto-assigned by type)
 *   Step 3: milestones  (timeline-driven, not solution-driven)
 *   Step 4: tasks       (from deliverables, role auto-assigned by verb)
 *   Step 5: gates       (from assumptions + governance notes)
 *   Step 6: baseline    (ROI anchor — never editable without change order)
 *   Step 7: scope_boundaries (frozen copy from snapshot)
 *   Step 8: dependency_graph (directed DAG)
 *
 * CRITICAL SAFETY RULES (mapping-engine-process.md):
 *   • Execution NEVER edits proposal_snapshot
 *   • Proposal edits after snapshot require new execution version
 *   • Scope expansion triggers change order
 *   • ROI actuals do not modify projected ROI
 */

import type { ProposalSnapshot } from './snapshotEngine';

// ════════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════════

export type ExecutionStatus   = 'active' | 'blocked' | 'complete' | 'on_hold';
export type WorkstreamStatus  = 'not_started' | 'in_progress' | 'blocked' | 'complete';
export type TaskStatus        = 'not_started' | 'in_progress' | 'blocked' | 'complete' | 'skipped';
export type GateType          = 'security' | 'access' | 'uat' | 'approval' | 'compliance';
export type GateStatus        = 'pending' | 'passed' | 'failed' | 'waived';
export type ChangeOrderStatus = 'draft' | 'sent' | 'approved' | 'rejected';
export type RiskSeverity      = 'low' | 'medium' | 'high' | 'critical';

/** Step 2 owner roles — auto-assigned by solution type */
export type OwnerRole = 'AI Engineer' | 'Automation Specialist' | 'Data Engineer' | 'Strategist' | 'QA' | 'Ops' | 'Account Lead' | 'Delivery Manager';

export interface Workstream {
  workstream_id:            string;
  title:                    string;
  linked_solution_block_id: string;
  owner_role:               OwnerRole | string;
  status:                   WorkstreamStatus;
  start_week:               number;
  end_week:                 number;
  estimated_duration_weeks: number;
  scope_summary:            string;
  diagnosis_link:           string;
  /** Step 2 — automation / crm / data / strategy */
  solution_type:            string;
}

export interface Milestone {
  milestone_id:              string;
  execution_id?:             string;
  phase_number:              number;
  title:                     string;
  start_week:                number;
  end_week:                  number;
  duration:                  string;
  status:                    TaskStatus;
  depends_on_milestone_id?:  string;
  governance_checkpoint?:    string;
}

export interface ExecutionTask {
  task_id:         string;
  workstream_id:   string;
  milestone_id:    string;
  title:           string;
  /** Step 4 — auto-assigned by verb */
  assigned_role:   string;
  owner:           string;
  due_date:        string;
  status:          TaskStatus;
  priority:        'low' | 'medium' | 'high' | 'critical';
  /** Step 8 — task-level dependencies */
  dependency_ids:  string[];
  blocked_reason?: string;
}

export interface ExecutionGate {
  gate_id:       string;
  execution_id?: string;
  milestone_id:  string;
  type:          GateType;
  title:         string;
  description:   string;
  required:      boolean;
  status:        GateStatus;
  passed_by?:    string;
  passed_at?:    string;
}

/**
 * Step 6 — Baseline Lock.
 * Comparison anchor. Never editable without change order.
 */
export interface BaselineLock {
  baseline_id:           string;
  execution_id?:         string;
  captured_at:           string;
  baseline_quality:      'confirmed' | 'estimated' | 'assumed';
  /** mapping-engine-process.md Step 6 fields */
  manual_hours_per_week: number;
  monthly_revenue:       number;
  conversion_rate:       number;
  metrics_snapshot: {
    total_investment:       number;
    monthly_cost_before:    number;
    hours_wasted_monthly:   number;
    revenue_at_risk_annual: number;
    payback_months:         number;
    roi_12m_percent:        number;
  };
}

/**
 * Step 7 — Scope Boundary Copy (frozen from snapshot).
 * Execution reads from this only.
 * New integration → trigger scope engine.
 */
export interface ScopeBoundary {
  scope_included:     string[];
  scope_excluded:     string[];
  integration_points: string[];
  assumptions:        string[];
}

/**
 * Step 8 — Dependency graph node.
 * depends_on = IDs that must complete first.
 */
export interface DependencyNode {
  id:         string;
  type:       'task' | 'milestone' | 'gate';
  label:      string;
  depends_on: string[];
  status:     string;
}

/** Step 8 — Directed acyclic dependency graph. */
export interface DependencyGraph {
  nodes:         DependencyNode[];
  critical_path: string[];   // node IDs next in line (no pending predecessors)
  violations:    string[];   // constraint violations detected
}

export interface ChangeOrder {
  change_order_id: string;
  workstream_id:   string;
  requested_by:    string;
  requested_at:    string;
  title:           string;
  description:     string;
  scope_delta:     string[];
  impact_estimate: string;
  status:          ChangeOrderStatus;
  approved_by?:    string;
  approved_at?:    string;
}

export interface RiskEntry {
  risk_id:     string;
  title:       string;
  description: string;
  severity:    RiskSeverity;
  probability: 'low' | 'medium' | 'high';
  owner:       string;
  mitigation:  string;
  raised_at:   string;
  status:      'open' | 'mitigated' | 'accepted' | 'closed';
}

export interface AuditEntry {
  audit_id:  string;
  actor:     string;
  action:    string;
  target:    string;
  timestamp: string;
  notes?:    string;
}

/** Full execution project shell — output of the 8-step mapping pipeline. */
export interface ExecutionProject {
  execution_id:         string;
  client_id:            string;
  client_name:          string;
  proposal_snapshot_id: string;
  proposal_id:          string;
  /** Snapshot version this execution was generated from */
  version_number:       number;
  /** Step 7 (scope-engine-logic.md) — increments on every approved change order */
  execution_version:    number;
  status:               ExecutionStatus;
  created_at:           string;
  created_by:           string;

  workstreams:      Workstream[];
  milestones:       Milestone[];
  tasks:            ExecutionTask[];
  gates:            ExecutionGate[];
  baseline:         BaselineLock;
  scope_boundaries: ScopeBoundary;
  dependency_graph: DependencyGraph;
  change_orders:    ChangeOrder[];
  risk_log:         RiskEntry[];
  audit_trail:      AuditEntry[];
}

// ════════════════════════════════════════════════════════════════════════════════
// IN-MEMORY STORE
// ════════════════════════════════════════════════════════════════════════════════

export const EXECUTION_STORE: ExecutionProject[] = [];

// ════════════════════════════════════════════════════════════════════════════════
// ID GENERATORS (exported so mappingEngine can use same counters)
// ════════════════════════════════════════════════════════════════════════════════

let _wsCount = 0;
let _msCount = 0;
let _tkCount = 0;
let _gtCount = 0;
let _coCount = 0;
let _rkCount = 0;
let _auCount = 0;

export function wsId()  { return `WS-${String(++_wsCount).padStart(4, '0')}`; }
export function msId()  { return `MS-${String(++_msCount).padStart(4, '0')}`; }
/** Step 4 spec uses TSK- prefix */
export function tskId() { return `TSK-${String(++_tkCount).padStart(4, '0')}`; }
export function gtId()  { return `GT-${String(++_gtCount).padStart(4, '0')}`; }
export function coId()  { return `CO-${String(++_coCount).padStart(4, '0')}`; }
export function rkId()  { return `RK-${String(++_rkCount).padStart(4, '0')}`; }
export function auId()  { return `AU-${String(++_auCount).padStart(4, '0')}`; }
export function exId()  { return `EX-${String(EXECUTION_STORE.length + 1).padStart(4, '0')}`; }

// ════════════════════════════════════════════════════════════════════════════════
// OWNER AUTO-ASSIGNMENT (Step 2)
// mapping-engine-process.md:
//   Automation-heavy → ai_engineer
//   CRM-heavy        → automation_specialist
//   Data-heavy       → data_engineer
//   Strategy-heavy   → strategist
// ════════════════════════════════════════════════════════════════════════════════

export function classifySolutionType(solution: unknown): string {
  const text = JSON.stringify(solution ?? '').toLowerCase();
  if (/automat|workflow|ai |llm|gpt|chatbot|nlp|trigger/.test(text)) return 'automation';
  if (/crm|hubspot|salesforce|pipedrive|contact|lead/.test(text))    return 'crm';
  if (/data|analytic|dashboard|report|pipeline|etl|bi /.test(text))  return 'data';
  return 'strategy';
}

export function autoAssignOwner(solutionType: string): OwnerRole {
  switch (solutionType) {
    case 'automation': return 'AI Engineer';
    case 'crm':        return 'Automation Specialist';
    case 'data':       return 'Data Engineer';
    default:           return 'Strategist';
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// TASK ROLE ASSIGNMENT (Step 4)
// mapping-engine-process.md:
//   Build    → engineer
//   Configure → specialist
//   Validate → QA
//   Deploy   → ops
//   Review   → strategist
// ════════════════════════════════════════════════════════════════════════════════

export function autoAssignTaskRole(title: string): string {
  const t = title.toLowerCase();
  if (/build|develop|creat|implement|write|code/.test(t))           return 'Engineer';
  if (/configur|setup|set up|install|connect|integrat/.test(t))    return 'Specialist';
  if (/validat|test|uat|qa|check|verif|audit/.test(t))             return 'QA';
  if (/deploy|release|go.live|launch|ship|produc/.test(t))         return 'Ops';
  if (/review|assess|analys|strateg|plan|evaluat/.test(t))         return 'Strategist';
  return 'Engineer';
}

// ════════════════════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ════════════════════════════════════════════════════════════════════════════════

function addDays(base: Date, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

/** Step 2 */
function generateWorkstreams(snapshot: ProposalSnapshot): Workstream[] {
  const solutions = snapshot.content_snapshot.solutions ?? [];
  if (solutions.length === 0) {
    const diagBlocks = snapshot.content_snapshot.diagnosis_blocks ?? [];
    const solType = 'strategy';
    return [{
      workstream_id:            wsId(),
      title:                    'Core Transformation Initiative',
      linked_solution_block_id: 'sol-fallback',
      owner_role:               autoAssignOwner(solType),
      status:                   'in_progress',
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

/** Step 3 — timeline-driven milestones with sequential dependencies. */
function generateMilestones(snapshot: ProposalSnapshot): Milestone[] {
  const phases = snapshot.content_snapshot.implementation_phases ?? [];
  if (phases.length === 0) {
    return [
      { milestone_id: msId(), phase_number: 1, title: 'Audit & System Mapping', start_week: 1,  end_week: 2,  duration: 'Weeks 1–2',  status: 'complete',    governance_checkpoint: 'Kickoff sign-off'    },
      { milestone_id: msId(), phase_number: 2, title: 'Build & Configure',      start_week: 3,  end_week: 5,  duration: 'Weeks 3–5',  status: 'in_progress', governance_checkpoint: 'Security & DPA gate' },
      { milestone_id: msId(), phase_number: 3, title: 'Validate & Pilot',       start_week: 6,  end_week: 8,  duration: 'Weeks 6–8',  status: 'not_started', governance_checkpoint: 'UAT sign-off'        },
      { milestone_id: msId(), phase_number: 4, title: 'Deploy & Review',        start_week: 9,  end_week: 12, duration: 'Weeks 9–12', status: 'not_started', governance_checkpoint: 'Executive go-live'   },
    ] as Milestone[];
  }
  let prevId: string | undefined;
  return phases.map((ph: any, i: number) => {
    const sw = ph.start_week ?? i * 3 + 1;
    const ew = ph.end_week ?? sw + 2;
    const ms: Milestone = {
      milestone_id:            msId(),
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

/** Step 4 */
const TASK_TEMPLATES: Record<string, string[]> = {
  'Audit & System Mapping': ['Review stakeholder requirements', 'Audit existing systems & integrations', 'Build process map (AS-IS state)', 'Validate data quality baseline'],
  'Build & Configure':      ['Build CRM automation workflows', 'Configure API integrations', 'Build automation flows (triggers + actions)', 'Configure dashboards & reporting', 'Deploy to staging environment'],
  'Validate & Pilot':       ['Validate integration endpoints', 'UAT session 1 — core flows', 'UAT session 2 — edge cases', 'Review pilot feedback & iterate'],
  'Deploy & Review':        ['Deploy to production environment', 'Configure monitoring & alerting', 'Review go-live performance (day 1)', 'Review 7-day outcomes & ROI delta'],
};

function generateTasks(milestones: Milestone[], workstreams: Workstream[]): ExecutionTask[] {
  const now   = new Date();
  const tasks: ExecutionTask[] = [];
  const prevMsLastTaskId: Record<string, string> = {};

  milestones.forEach((ms, mi) => {
    const ws        = workstreams[mi % workstreams.length];
    const templates = TASK_TEMPLATES[ms.title] ?? [`Prepare ${ms.title} plan`, `Execute ${ms.title} activities`, `Review & sign-off ${ms.title}`];
    const msTasks: string[] = [];

    templates.forEach((title, ti) => {
      const baseOffset = ms.start_week * 7 + ti * 2;
      const status: TaskStatus =
        ms.status === 'complete'    ? 'complete'    :
        ms.status === 'in_progress' ? (ti < 2 ? 'complete' : ti === 2 ? 'in_progress' : 'not_started') :
        'not_started';

      const deps: string[] = [];
      if (ti > 0) deps.push(msTasks[ti - 1]);
      if (ti === 0 && prevMsLastTaskId[`ms${mi - 1}`]) deps.push(prevMsLastTaskId[`ms${mi - 1}`]);

      const role = autoAssignTaskRole(title);
      const id   = tskId();
      msTasks.push(id);

      tasks.push({
        task_id:        id,
        workstream_id:  ws?.workstream_id ?? '',
        milestone_id:   ms.milestone_id,
        title,
        assigned_role:  role,
        owner:          role,
        due_date:       addDays(now, baseOffset + 7),
        status,
        priority:       ti < 2 ? 'high' : ti === 2 ? 'medium' : 'low',
        dependency_ids: deps,
        blocked_reason: status === 'blocked' ? 'Awaiting prior task completion' : undefined,
      });
    });

    prevMsLastTaskId[`ms${mi}`] = msTasks[msTasks.length - 1] ?? '';
  });

  return tasks;
}

/** Step 5 */
function generateGates(milestones: Milestone[]): ExecutionGate[] {
  const now  = new Date();
  const cfgs: Array<{ type: GateType; title: string; description: string; phaseIdx: number }> = [
    { type: 'access',   phaseIdx: 0, title: 'Client System Access Grant',     description: 'Client IT confirms credentials and access permissions to all target systems.'              },
    { type: 'security', phaseIdx: 1, title: 'Security Review & DPA Sign-Off', description: 'Data handling protocols reviewed; DPA countersigned. Security checklist complete.'        },
    { type: 'uat',      phaseIdx: 2, title: 'UAT Acceptance Sign-Off',        description: 'Client lead confirms pilot outputs meet all acceptance criteria.'                           },
    { type: 'approval', phaseIdx: 3, title: 'Executive Go-Live Approval',     description: 'Executive sponsor sign-off required. Cannot deploy before this is passed.'                },
  ];
  return cfgs.map((cfg, i) => {
    const ms = milestones[cfg.phaseIdx] ?? milestones[milestones.length - 1];
    return {
      gate_id:      gtId(),
      milestone_id: ms.milestone_id,
      type:         cfg.type,
      title:        cfg.title,
      description:  cfg.description,
      required:     true,
      status:       (ms.status === 'complete' ? 'passed' : 'pending') as GateStatus,
      passed_by:    ms.status === 'complete' ? 'Account Lead' : undefined,
      passed_at:    ms.status === 'complete' ? addDays(now, -7 + i * 2) : undefined,
    };
  });
}

/** Step 6 */
function generateBaselineLock(snapshot: ProposalSnapshot, executionId: string): BaselineLock {
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

/** Step 7 */
function generateScopeBoundaries(snapshot: ProposalSnapshot): ScopeBoundary {
  const sb = (snapshot.content_snapshot as any).scope_boundaries;
  if (sb) {
    return {
      scope_included:     sb.included ?? sb.scope_included ?? [],
      scope_excluded:     sb.excluded ?? sb.scope_excluded ?? [],
      integration_points: sb.integration_points ?? [],
      assumptions:        sb.assumptions ?? [],
    };
  }
  const solutions = snapshot.content_snapshot.solutions ?? [];
  return {
    scope_included:     solutions.map((s: any) => s.title ?? s.description ?? '').filter(Boolean),
    scope_excluded:     ['Third-party tool procurement', 'Legal contract redlines', 'Non-digital change management'],
    integration_points: ['CRM API', 'Email platform webhook', 'Reporting/BI layer'],
    assumptions:        ['Client IT provides access within 5 business days', 'Existing data is exportable from current CRM', 'Named client project owner available minimum 4 hrs/week'],
  };
}

/** Step 8 — directed dependency graph */
export function buildDependencyGraph(
  tasks:      ExecutionTask[],
  milestones: Milestone[],
  gates:      ExecutionGate[],
): DependencyGraph {
  const nodes: DependencyNode[] = [];

  tasks.forEach(t => nodes.push({ id: t.task_id,      type: 'task',      label: t.title,      depends_on: t.dependency_ids ?? [], status: t.status      }));
  milestones.forEach(ms => nodes.push({ id: ms.milestone_id, type: 'milestone', label: ms.title,     depends_on: ms.depends_on_milestone_id ? [ms.depends_on_milestone_id] : [], status: ms.status }));
  gates.forEach(g => nodes.push({ id: g.gate_id,       type: 'gate',      label: g.title,      depends_on: [g.milestone_id],         status: g.status      }));

  const pendingIds = new Set(
    nodes.filter(n => n.status !== 'complete' && n.status !== 'passed' && n.status !== 'skipped').map(n => n.id)
  );
  const critical_path = nodes
    .filter(n => n.depends_on.every(dep => !pendingIds.has(dep)) && pendingIds.has(n.id))
    .map(n => n.id);

  const violations: string[] = tasks
    .filter(t => t.status === 'blocked' && (t.dependency_ids ?? []).some(d => pendingIds.has(d)))
    .map(t => `${t.task_id}: blocked by unresolved dependency`);

  return { nodes, critical_path, violations };
}

// ════════════════════════════════════════════════════════════════════════════════
// SEED HELPERS
// ════════════════════════════════════════════════════════════════════════════════

function seedChangeOrders(workstreams: Workstream[]): ChangeOrder[] {
  const ws = workstreams[0];
  if (!ws) return [];
  return [{
    change_order_id: coId(),
    workstream_id:   ws.workstream_id,
    requested_by:    'Account Lead',
    requested_at:    new Date(Date.now() - 3 * 86400000).toISOString(),
    title:           'Add Slack Notification Layer',
    description:     'Client requested all AI-generated alerts route through Slack in addition to email. Not in original scope.',
    scope_delta:     ['Slack webhook configuration', 'Notification template migration', 'Cross-channel testing'],
    impact_estimate: '+$4,200 / +5 business days',
    status:          'draft',
  }];
}

function seedRiskLog(): RiskEntry[] {
  return [
    { risk_id: rkId(), title: 'Client IT Bottleneck',     description: 'IT team has limited capacity Q1. System access may be delayed by 1–2 weeks.', severity: 'high',   probability: 'medium', owner: 'Account Lead',  mitigation: 'Escalate to sponsor. Pre-configure with dummy data.',    raised_at: new Date(Date.now() - 10 * 86400000).toISOString(), status: 'open'      },
    { risk_id: rkId(), title: 'Data Quality Gaps',        description: 'Historical CRM data may require 3–5 days of cleansing before migration.',     severity: 'medium', probability: 'high',   owner: 'Data Engineer', mitigation: 'Schedule a data audit Week 1. Buffer added to Phase 2.', raised_at: new Date(Date.now() - 5  * 86400000).toISOString(), status: 'open'      },
    { risk_id: rkId(), title: 'Stakeholder Availability', description: 'CFO is travelling during UAT window. May delay sign-off.',                    severity: 'low',    probability: 'medium', owner: 'Account Lead',  mitigation: 'Agree on delegate approver. Async review process ready.', raised_at: new Date(Date.now() - 2  * 86400000).toISOString(), status: 'mitigated' },
  ];
}

function seedAuditTrail(tasks: ExecutionTask[], gates: ExecutionGate[], executionId: string): AuditEntry[] {
  const now = new Date();
  return [
    { audit_id: auId(), actor: 'System',         action: 'Execution generated via Mapping Engine (8-step pipeline)', target: executionId,              timestamp: new Date(now.getTime() - 14 * 86400000).toISOString() },
    { audit_id: auId(), actor: 'System',         action: 'Scope boundaries frozen from snapshot',                    target: 'ScopeBoundary',          timestamp: new Date(now.getTime() - 14 * 86400000).toISOString() },
    { audit_id: auId(), actor: 'System',         action: 'Baseline lock captured (Step 6)',                          target: `BL-${executionId}`,      timestamp: new Date(now.getTime() - 14 * 86400000).toISOString() },
    { audit_id: auId(), actor: 'Account Lead',   action: 'Gate passed',                                              target: gates[0]?.gate_id ?? 'GT-0001', timestamp: new Date(now.getTime() - 10 * 86400000).toISOString(), notes: 'System access granted by client IT (ticket #4421)' },
    { audit_id: auId(), actor: 'AI Engineer',    action: 'Task marked complete',                                     target: tasks[0]?.task_id ?? 'TSK-0001', timestamp: new Date(now.getTime() - 8 * 86400000).toISOString() },
    { audit_id: auId(), actor: 'Data Engineer',  action: 'Task marked complete',                                     target: tasks[1]?.task_id ?? 'TSK-0002', timestamp: new Date(now.getTime() - 6 * 86400000).toISOString() },
    { audit_id: auId(), actor: 'AI Engineer',    action: 'Risk flagged',                                             target: 'RK-0001',                timestamp: new Date(now.getTime() - 4 * 86400000).toISOString(), notes: 'Client IT confirmed limited sprint capacity Q1' },
  ];
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN — generateExecution (runs all 8 steps)
// ════════════════════════════════════════════════════════════════════════════════

export function generateExecution(
  snapshot: ProposalSnapshot,
  userId:   string = 'U-01',
): ExecutionProject {
  const executionId  = exId();
  const ws           = generateWorkstreams(snapshot);   // Step 2
  const ms           = generateMilestones(snapshot);    // Step 3
  const tasks        = generateTasks(ms, ws);           // Step 4
  const gates        = generateGates(ms);               // Step 5
  const baseline     = generateBaselineLock(snapshot, executionId); // Step 6
  const scope        = generateScopeBoundaries(snapshot);           // Step 7
  const depGraph     = buildDependencyGraph(tasks, ms, gates);      // Step 8
  const changeOrders = seedChangeOrders(ws);
  const riskLog      = seedRiskLog();
  const auditTrail   = seedAuditTrail(tasks, gates, executionId);

  const project: ExecutionProject = {
    execution_id:         executionId,
    client_id:            snapshot.proposal_id,
    client_name:          (snapshot.content_snapshot.executive_brief as any)?.title ?? snapshot.proposal_id,
    proposal_snapshot_id: snapshot.proposal_snapshot_id,
    proposal_id:          snapshot.proposal_id,
    version_number:       snapshot.version_number,
    execution_version:    1,
    status:               'active',
    created_at:           new Date().toISOString(),
    created_by:           userId,
    workstreams:          ws,
    milestones:           ms,
    tasks,
    gates,
    baseline,
    scope_boundaries:     scope,
    dependency_graph:     depGraph,
    change_orders:        changeOrders,
    risk_log:             riskLog,
    audit_trail:          auditTrail,
  };

  EXECUTION_STORE.push(project);
  return project;
}

// ════════════════════════════════════════════════════════════════════════════════
// DERIVED STATE HELPERS
// ════════════════════════════════════════════════════════════════════════════════

export function isMilestoneComplete(milestoneId: string, tasks: ExecutionTask[], gates: ExecutionGate[]): boolean {
  const msTasks = tasks.filter(t => t.milestone_id === milestoneId);
  const msGates = gates.filter(g => g.milestone_id === milestoneId && g.required);
  return msTasks.length > 0 && msTasks.every(t => t.status === 'complete' || t.status === 'skipped') && msGates.every(g => g.status === 'passed' || g.status === 'waived');
}

export function getExecutionProgress(project: ExecutionProject): number {
  const total = project.tasks.length;
  if (total === 0) return 0;
  return Math.round((project.tasks.filter(t => t.status === 'complete' || t.status === 'skipped').length / total) * 100);
}

export function getWorkstreamProgress(workstreamId: string, tasks: ExecutionTask[]): number {
  const wsTasks = tasks.filter(t => t.workstream_id === workstreamId);
  if (wsTasks.length === 0) return 0;
  return Math.round((wsTasks.filter(t => t.status === 'complete' || t.status === 'skipped').length / wsTasks.length) * 100);
}

export function getBlockers(project: ExecutionProject): Array<{ id: string; type: 'task' | 'gate'; title: string; reason: string }> {
  const b: Array<{ id: string; type: 'task' | 'gate'; title: string; reason: string }> = [];
  project.tasks.filter(t => t.status === 'blocked').forEach(t => b.push({ id: t.task_id, type: 'task', title: t.title, reason: t.blocked_reason ?? 'Reason unknown' }));
  project.gates.filter(g => g.status === 'failed').forEach(g => b.push({ id: g.gate_id, type: 'gate', title: g.title, reason: 'Gate failed' }));
  return b;
}

export function getNextSevenDaysTasks(tasks: ExecutionTask[]): ExecutionTask[] {
  const now = Date.now();
  const cut = now + 7 * 24 * 60 * 60 * 1000;
  return tasks
    .filter(t => t.status !== 'complete' && t.status !== 'skipped')
    .filter(t => { const d = new Date(t.due_date).getTime(); return d >= now && d <= cut; })
    .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
}

// ════════════════════════════════════════════════════════════════════════════════
// MOCK SEED — ExampleCo (always available for demo)
// ════════════════════════════════════════════════════════════════════════════════

export const MOCK_EXECUTION: ExecutionProject = (() => {
  const now = new Date();
  const EX  = 'EX-SEED';
  const ws1 = 'WS-S001'; const ws2 = 'WS-S002'; const ws3 = 'WS-S003';
  const ms1 = 'MS-S001'; const ms2 = 'MS-S002'; const ms3 = 'MS-S003'; const ms4 = 'MS-S004';
  const gt1 = 'GT-S001'; const gt2 = 'GT-S002'; const gt3 = 'GT-S003'; const gt4 = 'GT-S004';
  const t01 = 'TSK-S01'; const t02 = 'TSK-S02'; const t03 = 'TSK-S03'; const t04 = 'TSK-S04';
  const t05 = 'TSK-S05'; const t06 = 'TSK-S06'; const t07 = 'TSK-S07'; const t08 = 'TSK-S08';
  const t09 = 'TSK-S09'; const t10 = 'TSK-S10'; const t11 = 'TSK-S11'; const t12 = 'TSK-S12';

  const milestones: Milestone[] = [
    { milestone_id: ms1, phase_number: 1, title: 'Audit & System Mapping', start_week: 1, end_week: 2,  duration: 'Weeks 1–2',  status: 'complete',    execution_id: EX, governance_checkpoint: 'Kickoff sign-off'    },
    { milestone_id: ms2, phase_number: 2, title: 'Build & Configure',      start_week: 3, end_week: 5,  duration: 'Weeks 3–5',  status: 'in_progress', execution_id: EX, depends_on_milestone_id: ms1, governance_checkpoint: 'Security & DPA gate' },
    { milestone_id: ms3, phase_number: 3, title: 'Validate & Pilot',       start_week: 6, end_week: 8,  duration: 'Weeks 6–8',  status: 'not_started', execution_id: EX, depends_on_milestone_id: ms2, governance_checkpoint: 'UAT sign-off'        },
    { milestone_id: ms4, phase_number: 4, title: 'Deploy & Review',        start_week: 9, end_week: 12, duration: 'Weeks 9–12', status: 'not_started', execution_id: EX, depends_on_milestone_id: ms3, governance_checkpoint: 'Executive go-live'   },
  ];

  const tasks: ExecutionTask[] = [
    { task_id: t01, workstream_id: ws1, milestone_id: ms1, title: 'Review stakeholder requirements',           assigned_role: 'Strategist', owner: 'Strategist',          due_date: addDays(now, -12), status: 'complete',    priority: 'high',     dependency_ids: []          },
    { task_id: t02, workstream_id: ws1, milestone_id: ms1, title: 'Audit existing systems & integrations',     assigned_role: 'Data Engineer', owner: 'Data Engineer',     due_date: addDays(now, -10), status: 'complete',    priority: 'high',     dependency_ids: [t01]       },
    { task_id: t03, workstream_id: ws1, milestone_id: ms1, title: 'Build process map (AS-IS state)',            assigned_role: 'Engineer',   owner: 'AI Engineer',         due_date: addDays(now, -8),  status: 'complete',    priority: 'medium',   dependency_ids: [t02]       },
    { task_id: t04, workstream_id: ws1, milestone_id: ms1, title: 'Validate data quality baseline',             assigned_role: 'QA',         owner: 'QA',                  due_date: addDays(now, -7),  status: 'complete',    priority: 'medium',   dependency_ids: [t03]       },
    { task_id: t05, workstream_id: ws1, milestone_id: ms2, title: 'Build CRM automation workflows',             assigned_role: 'Engineer',   owner: 'AI Engineer',         due_date: addDays(now, -3),  status: 'complete',    priority: 'high',     dependency_ids: [t04]       },
    { task_id: t06, workstream_id: ws1, milestone_id: ms2, title: 'Configure API integrations',                 assigned_role: 'Specialist', owner: 'Automation Specialist', due_date: addDays(now, 1), status: 'in_progress', priority: 'high',     dependency_ids: [t05]       },
    { task_id: t07, workstream_id: ws1, milestone_id: ms2, title: 'Build automation flows (triggers + actions)', assigned_role: 'Engineer',  owner: 'AI Engineer',         due_date: addDays(now, 4),   status: 'not_started', priority: 'high',     dependency_ids: [t06]       },
    { task_id: t08, workstream_id: ws1, milestone_id: ms2, title: 'Configure dashboards & reporting',           assigned_role: 'Specialist', owner: 'Data Engineer',       due_date: addDays(now, 6),   status: 'not_started', priority: 'medium',   dependency_ids: [t07]       },
    { task_id: t09, workstream_id: ws2, milestone_id: ms3, title: 'Validate integration endpoints',             assigned_role: 'QA',         owner: 'QA',                  due_date: addDays(now, 10),  status: 'not_started', priority: 'high',     dependency_ids: [t08, gt2]  },
    { task_id: t10, workstream_id: ws2, milestone_id: ms3, title: 'UAT session 1 — core flows',                 assigned_role: 'QA',         owner: 'QA',                  due_date: addDays(now, 13),  status: 'not_started', priority: 'high',     dependency_ids: [t09]       },
    { task_id: t11, workstream_id: ws3, milestone_id: ms4, title: 'Deploy to production environment',           assigned_role: 'Ops',        owner: 'Ops',                 due_date: addDays(now, 21),  status: 'not_started', priority: 'critical', dependency_ids: [t10, gt3]  },
    { task_id: t12, workstream_id: ws3, milestone_id: ms4, title: 'Review 7-day outcomes & ROI delta',          assigned_role: 'Strategist', owner: 'Strategist',          due_date: addDays(now, 28),  status: 'not_started', priority: 'high',     dependency_ids: [t11]       },
  ];

  const gates: ExecutionGate[] = [
    { gate_id: gt1, execution_id: EX, milestone_id: ms1, type: 'access',   title: 'Client System Access Grant',     description: 'Client IT confirms credentials and access permissions to all target systems.',   required: true, status: 'passed',  passed_by: 'Account Lead', passed_at: addDays(now, -8) },
    { gate_id: gt2, execution_id: EX, milestone_id: ms2, type: 'security', title: 'Security Review & DPA Sign-Off', description: 'Data handling protocols reviewed; DPA countersigned. Security checklist done.',  required: true, status: 'pending' },
    { gate_id: gt3, execution_id: EX, milestone_id: ms3, type: 'uat',      title: 'UAT Acceptance Sign-Off',        description: 'Client lead confirms pilot outputs meet all acceptance criteria.',                required: true, status: 'pending' },
    { gate_id: gt4, execution_id: EX, milestone_id: ms4, type: 'approval', title: 'Executive Go-Live Approval',     description: 'Executive sponsor sign-off. Cannot deploy to production before this is passed.',  required: true, status: 'pending' },
  ];

  const depGraph = buildDependencyGraph(tasks, milestones, gates);

  return {
    execution_id:         EX,
    client_id:            'P-0001',
    client_name:          'ExampleCo — AI Readiness Programme',
    proposal_snapshot_id: 'PS-SEED',
    proposal_id:          'P-0001',
    version_number:       1,
    execution_version:    1,
    status:               'active',
    created_at:           addDays(now, -14),
    created_by:           'U-01',
    workstreams: [
      { workstream_id: ws1, title: 'AI Operations Layer',     linked_solution_block_id: 'sol-001', owner_role: 'AI Engineer',           status: 'in_progress', start_week: 1, end_week: 6,  estimated_duration_weeks: 6, solution_type: 'automation', scope_summary: 'Build AI-driven ops layer: automated triage, routing, reporting pipelines.',        diagnosis_link: 'Manual Operations Bottleneck'    },
      { workstream_id: ws2, title: 'Revenue Intelligence',    linked_solution_block_id: 'sol-002', owner_role: 'Data Engineer',         status: 'not_started', start_week: 5, end_week: 9,  estimated_duration_weeks: 4, solution_type: 'data',       scope_summary: 'Deploy revenue signal engine: churn prediction, pipeline scoring, upsell flags.', diagnosis_link: 'Revenue Leakage Risk'            },
      { workstream_id: ws3, title: 'Systems Integration Hub', linked_solution_block_id: 'sol-003', owner_role: 'Automation Specialist', status: 'not_started', start_week: 7, end_week: 12, estimated_duration_weeks: 6, solution_type: 'crm',        scope_summary: 'Integrate CRM, ERP, and comms stack. Unified data layer for AI models.',          diagnosis_link: 'Fragmented Systems Architecture' },
    ],
    milestones,
    tasks,
    gates,
    baseline: {
      baseline_id:           'BL-SEED',
      execution_id:          EX,
      captured_at:           addDays(now, -14),
      baseline_quality:      'confirmed',
      manual_hours_per_week: 120,
      monthly_revenue:       250000,
      conversion_rate:       2.1,
      metrics_snapshot: { total_investment: 38500, monthly_cost_before: 31200, hours_wasted_monthly: 196, revenue_at_risk_annual: 284000, payback_months: 7, roi_12m_percent: 312 },
    },
    scope_boundaries: {
      scope_included:     ['AI Operations Layer — automated triage, routing, and reporting pipelines', 'Revenue Intelligence — churn prediction, pipeline scoring, upsell flags', 'Systems Integration Hub — CRM, ERP, and comms stack unification'],
      scope_excluded:     ['Third-party tool procurement costs', 'Legal contract redlines or negotiation', 'Non-digital process change management', 'Custom hardware or infrastructure provisioning'],
      integration_points: ['HubSpot CRM API v3', 'Email platform (SendGrid) webhook', 'Slack notification API', 'BI/reporting layer (Metabase)'],
      assumptions:        ['Client IT provides system access within 5 business days', 'Existing CRM data is exportable to CSV/JSON', 'Named client project owner available minimum 4 hrs/week', 'Staging environment provided by client'],
    },
    dependency_graph: depGraph,
    change_orders: [{
      change_order_id: 'CO-SEED',
      workstream_id:   ws1,
      requested_by:    'Account Lead',
      requested_at:    addDays(now, -3),
      title:           'Add Slack Notification Layer',
      description:     'Client requested all AI-generated alerts route through Slack in addition to email. Not in original scope.',
      scope_delta:     ['Slack webhook configuration', 'Notification template migration', 'Cross-channel testing'],
      impact_estimate: '+$4,200 / +5 business days',
      status:          'draft',
    }],
    risk_log: [
      { risk_id: 'RK-S001', title: 'Client IT Bottleneck',     description: 'IT team limited capacity Q1. System access may slip 1–2 weeks.',          severity: 'high',   probability: 'medium', owner: 'Account Lead',  mitigation: 'Escalate to sponsor. Pre-configure with dummy data.',    raised_at: addDays(now, -10), status: 'open'      },
      { risk_id: 'RK-S002', title: 'Data Quality Gaps',        description: 'Historical CRM data may require 3–5 days cleansing before migration.',    severity: 'medium', probability: 'high',   owner: 'Data Engineer', mitigation: 'Schedule data audit Week 1. Buffer added to Phase 2.',   raised_at: addDays(now, -5),  status: 'open'      },
      { risk_id: 'RK-S003', title: 'Stakeholder Availability', description: 'CFO travelling during UAT window. May delay sign-off.',                   severity: 'low',    probability: 'medium', owner: 'Account Lead',  mitigation: 'Agreed delegate approver. Async review process ready.', raised_at: addDays(now, -2),  status: 'mitigated' },
    ],
    audit_trail: [
      { audit_id: 'AU-S001', actor: 'System',         action: 'Execution generated via Mapping Engine (8-step pipeline)',   target: EX,            timestamp: addDays(now, -14) },
      { audit_id: 'AU-S002', actor: 'System',         action: 'Scope boundaries frozen from snapshot PS-SEED',             target: 'ScopeBoundary', timestamp: addDays(now, -14) },
      { audit_id: 'AU-S003', actor: 'System',         action: 'Baseline lock captured (Step 6)',                           target: 'BL-SEED',     timestamp: addDays(now, -14) },
      { audit_id: 'AU-S004', actor: 'Account Lead',   action: 'Gate passed — system access granted (ticket #4421)',        target: gt1,           timestamp: addDays(now, -8)  },
      { audit_id: 'AU-S005', actor: 'AI Engineer',    action: 'Task completed',                                            target: t01,           timestamp: addDays(now, -12) },
      { audit_id: 'AU-S006', actor: 'Data Engineer',  action: 'Task completed',                                            target: t02,           timestamp: addDays(now, -10) },
      { audit_id: 'AU-S007', actor: 'AI Engineer',    action: 'Risk flagged — IT capacity constraint Q1',                  target: 'RK-S001',     timestamp: addDays(now, -4), notes: 'Confirmed by IT director' },
    ],
  };
})();