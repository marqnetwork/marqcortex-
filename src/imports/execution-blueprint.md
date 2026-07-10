Execution Blueprint Engine
What gets created (from proposal_snapshot_id)

execution (project shell)

execution_id, client_id, proposal_snapshot_id, status

workstreams (1 per solution)

workstream_id, title, linked_solution_block_id, owner_role, status, start/end weeks

milestones (from implementation phases)

milestone_id, phase_number, title, duration, status

tasks (generated from milestone deliverables)

task_id, workstream_id, milestone_id, title, owner, due_date, status

gates (dependency + approval checkpoints)

gate_id, type (security/access/UAT), required, status

baseline lock (starting metrics for ROI actuals)

baseline_id, captured_at, baseline_quality, metrics_snapshot

Rules (so it stays deterministic)

Snapshot-only input: blueprint reads from proposal_snapshot, never from live proposal blocks

No scope creep: new workstreams require change order

Every task traces back: task → milestone → workstream → snapshot

Status cascade: milestone complete only if all tasks complete and required gates passed

Execution Dashboard Layout (Team-Facing)
Sticky top (same style as your app)

Client name + Execution ID

Status: Active / Blocked / Complete

Buttons: Create Change Order, Log Actuals, Generate QBR

Tab 1: Overview

Workstreams progress (cards)

Milestone timeline strip

Current blockers (red list)

Next 7 days tasks (table)

Tab 2: Workstreams

Each workstream shows:

Scope summary (from snapshot)

Tasks list + owners

Dependencies / gates

Notes + attachments

“Request scope change” button

Tab 3: Scope Control

Included vs Excluded (snapshot)

Detected scope deltas

Change order queue (draft/sent/approved)

Tab 4: Live ROI Tracking

Baseline snapshot

Monthly actuals input

Projected vs actual delta

Solution attribution table

Tab 5: Governance

Approvals required

UAT checkpoints

Risk log

Audit trail (who changed what)

What we do next

Implement D1 data objects + mapping rules (so everything auto-generates from snapshot)

Build the Execution Dashboard using those objects (no guesswork)

Then we move to your “next parts to fix” immediately