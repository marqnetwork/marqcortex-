CRM Synchronization Layer (Build Spec)

Goal: every proposal + contract event updates your CRM pipeline automatically, creates tasks, and logs a full activity trail. No manual “CRM updating”.

1️⃣ CRM Objects You Need (minimal, no API yet)

Create these internal tables/collections now (mock-first):

crm_deals

deal_id

client_id

proposal_id (nullable)

contract_id (nullable)

owner_user_id

stage

value_estimate

close_probability

created_at, updated_at

crm_activity_log

activity_id

deal_id

type (proposal_sent/viewed/objection_detected/contract_sent/signed/etc.)

payload (json)

created_at

crm_tasks

task_id

deal_id

assigned_to

task_type

due_at

status (open/done)

notes

2️⃣ Canonical CRM Stages (locked)

Use these exact stages:

lead_captured

diagnostic_started

diagnostic_completed

proposal_draft

proposal_sent

proposal_viewed

negotiation_objection

approved_pending_contract

contract_sent

contract_signed

onboarding_started

implementation_active

closed_won

closed_lost

3️⃣ Event → Stage Mapping (the sync rules)

These are your triggers:

Diagnostic

diagnostic_started → stage = diagnostic_started

diagnostic_completed → stage = diagnostic_completed

Proposal

proposal_created → stage = proposal_draft

proposal_ready_to_send → stage = proposal_draft (still)

proposal_sent → stage = proposal_sent

proposal_viewed → stage = proposal_viewed

objection_detected → stage = negotiation_objection

proposal_approved → stage = approved_pending_contract

proposal_rejected → stage = closed_lost

Contract

contract_generated → stage = approved_pending_contract

contract_sent → stage = contract_sent

contract_signed → stage = contract_signed

Delivery

onboarding_started → stage = onboarding_started

implementation_started → stage = implementation_active

project_completed → stage = closed_won

4️⃣ Task Auto-Creation Rules (sales discipline)

When event happens, auto-create tasks:

proposal_sent

Task: “Follow up if not viewed”
Due: +48 hours
Assigned: deal owner

proposal_viewed (no booking)

Task: “Send clarification + book call”
Due: +24 hours

objection_detected

Task: “Handle objection: {type}”
Due: +12 hours

contract_sent (not signed)

Task: “Contract follow-up”
Due: +48 hours

contract_signed

Task: “Kickoff scheduling”
Due: +24 hours

5️⃣ Activity Log Entries (audit trail)

Every trigger writes an activity row like:

{
  "type": "proposal_viewed",
  "payload": {
    "proposal_id": "P-0001",
    "viewed_at": "ISO_DATE",
    "time_spent_seconds": 312
  }
}

This gives you clean reporting later.

6️⃣ Owner + SLA Rules

Every deal must have owner_user_id

If owner missing → auto-assign to default owner (Admin/BD Lead)

If a task overdue → escalate flag (for later notifications)

7️⃣ Mock Payload (so you can build UI now)
{
  "deal_id": "D-0007",
  "client_id": "C-0001",
  "proposal_id": "P-0001",
  "contract_id": null,
  "owner_user_id": "U-01",
  "stage": "proposal_sent",
  "value_estimate": 4500,
  "close_probability": 0.55,
  "activity": [
    {"type":"proposal_sent","created_at":"ISO_DATE"},
    {"type":"proposal_viewed","created_at":"ISO_DATE"}
  ],
  "tasks": [
    {"task_type":"Send clarification + book call","due_at":"ISO_DATE","status":"open"}
  ]
}
✅ Phase 6 “Done” Checklist

Phase 6 is complete when you can:

Create a deal automatically when diagnostic starts

Move stage automatically based on proposal/contract events

Auto-create follow-up tasks

View activity timeline per deal

Filter deals by stage + owner