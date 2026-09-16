/**
 * DEMO EXECUTION PROJECT — a twelve-week programme that never happened.
 *
 * `MOCK_EXECUTION` was exported from `@/app/core/executionEngine` and read by
 * `ExecutionRoute` whenever the execution store was empty. Since the store is
 * empty in every workspace that has not converted a proposal, this fixture WAS
 * the Execution destination: three workstreams, four milestones, twelve tasks
 * with owners and due dates, and four governance gates, one of them recorded
 * as passed by an "Account Lead" eight days ago.
 *
 * It is a good demo. It is not a project, and the surface no longer pretends
 * it is one.
 */

import {
  buildDependencyGraph,
  type ExecutionGate,
  type ExecutionProject,
  type ExecutionTask,
  type Milestone,
} from '@/app/core/executionEngine';

/** Copied from `executionEngine`, which keeps it private. Date-only, as there. */
function addDays(base: Date, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
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
