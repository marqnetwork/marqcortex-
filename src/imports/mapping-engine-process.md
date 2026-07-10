MAPPING ENGINE

(Input: proposal_snapshot → Output: execution_blueprint)

STEP 1 — Create Execution Shell
Input:

proposal_snapshot

Output:
{
  "execution_id": "EX-{uuid}",
  "proposal_snapshot_id": "PS-0001",
  "client_id": "{client_id}",
  "status": "active",
  "created_at": "ISO_DATE"
}

Rule:
Execution is always generated from immutable snapshot only.

STEP 2 — Map Solutions → Workstreams

For each:

block_type = proposal_solution

Create:

{
  "workstream_id": "WS-{uuid}",
  "execution_id": "EX-0001",
  "title": "{solution.title}",
  "description": "{solution.system_description}",
  "linked_solution_block_id": "{block_id}",
  "estimated_duration_weeks": "{solution.timeline_weeks}",
  "owner_role": "auto_assign_by_solution_type",
  "status": "not_started"
}

Owner auto-assignment rule:

Automation-heavy → ai_engineer

CRM-heavy → automation_specialist

Data-heavy → data_engineer

Strategy-heavy → strategist

No manual tagging required.

STEP 3 — Map Timeline Phases → Milestones

From:

proposal_timeline

For each phase:

{
  "milestone_id": "MS-{uuid}",
  "execution_id": "EX-0001",
  "phase_number": 1,
  "title": "Audit & System Mapping",
  "start_week": 1,
  "end_week": 2,
  "status": "pending"
}

Milestones are timeline-driven, not solution-driven.

STEP 4 — Map Deliverables → Tasks

From each solution block:

system components

integrations

automation flows

dashboards

testing checkpoints

Create:

{
  "task_id": "TSK-{uuid}",
  "workstream_id": "WS-0001",
  "milestone_id": "MS-0001",
  "title": "Build CRM automation workflows",
  "assigned_role": "automation_specialist",
  "dependency_ids": [],
  "status": "not_started"
}

Task assignment rules:

Build → engineer

Configure → specialist

Validate → QA

Deploy → ops

Review → strategist

STEP 5 — Generate Gates

From proposal assumptions + governance notes.

Create gates:

{
  "gate_id": "GT-{uuid}",
  "execution_id": "EX-0001",
  "type": "client_approval | security_access | uat_signoff",
  "linked_milestone_id": "MS-0002",
  "required": true,
  "status": "pending"
}

Milestone cannot complete if required gate not approved.

STEP 6 — Baseline Lock (ROI Tracking Foundation)

From snapshot:

{
  "baseline_id": "BL-{uuid}",
  "execution_id": "EX-0001",
  "manual_hours_per_week": 120,
  "monthly_revenue": 250000,
  "conversion_rate": 2.1,
  "captured_at": "ISO_DATE"
}

This becomes comparison anchor.

Never editable without change order.

STEP 7 — Scope Boundary Copy

From snapshot:

{
  "scope_included": [...],
  "scope_excluded": [...],
  "integration_points": [...]
}

Execution reads from this only.

If new integration appears → trigger scope engine.

STEP 8 — Dependency Graph Generation

Build directed graph:

Task dependencies

Milestone dependencies

Gate dependencies

This ensures:

Cannot deploy before build complete

Cannot optimize before deploy

Cannot close before UAT

RESULTING EXECUTION OBJECT STRUCTURE

Execution contains:

execution

workstreams[]

milestones[]

tasks[]

gates[]

baseline

scope_boundaries

dependency_graph

Everything fully traceable to snapshot.

CRITICAL SAFETY RULES

Execution NEVER edits proposal_snapshot

Proposal edits after snapshot require new execution version

Scope expansion triggers change order

ROI actuals do not modify projected ROI