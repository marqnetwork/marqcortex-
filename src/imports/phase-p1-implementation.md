PHASE P1 IMPLEMENTATION

We are completing:

Role & Permission Layer

Change Impact Engine

Proposal Consistency Validator

1️⃣ ROLE & PERMISSION LAYER
A. Add Role Enum
{
  "roles": [
    "admin",
    "strategist",
    "finance",
    "sales",
    "viewer"
  ]
}
B. Permission Matrix (Strict)
Block Type	Admin	Strategist	Finance	Sales	Viewer
proposal_executive_brief	✅	✅	❌	✅	❌
proposal_diagnosis	✅	✅	❌	❌	❌
proposal_solution	✅	✅	❌	❌	❌
proposal_timeline	✅	✅	❌	❌	❌
proposal_team	✅	✅	❌	❌	❌
proposal_next_step	✅	✅	❌	✅	❌
roi_summary_narrative	✅	✅	❌	❌	❌
roi_financial_snapshot	✅	❌	✅	❌	❌
contract_clause	✅	❌	❌	❌	❌

Rules:

Only Admin can unlock locked blocks.

Finance can modify ROI assumptions, not narrative.

Sales cannot touch solution scope.

Now governance is enforced.

2️⃣ CHANGE IMPACT ENGINE

This prevents silent drift.

A. Trigger Conditions

If ANY of these block types change:

proposal_solution

proposal_timeline

proposal_team

scope_boundaries

proposal_next_step.price

investment reference

System must execute:

{
  "roi_recalc_required": true,
  "proposal_status": "draft",
  "contract_invalidated": true,
  "export_blocked": true
}
B. Auto Downgrade Rule

If proposal status is:

ready_to_send

sent

And change occurs → revert to draft.

No silent editing allowed.

C. Revalidation Requirement

Before returning to ready_to_send:

ROI recalculated

Financial binding revalidated

Consistency validator passes

3️⃣ PROPOSAL CONSISTENCY VALIDATOR

Runs before status change to ready_to_send.

A. Structural Validation

Check:

≥ 3 diagnosis blocks

≥ 2 solution blocks

Every diagnosis linked to solution

Every solution assigned to phase

Timeline weeks consistent

B. Financial Validation

Check:

financial_summary populated

investment_total matches sum of solution allocations

ROI scenario defined

No missing payback value

C. Narrative Validation

Check:

Executive brief references at least 2 diagnosis themes

No conflicting durations

No conflicting investment amounts

No “guarantee” language

If any fail → return error object.

Validator Output
{
  "validation_passed": false,
  "errors": [
    {
      "type": "mapping_error",
      "message": "Diagnosis DX-02 has no linked solution."
    },
    {
      "type": "financial_mismatch",
      "message": "Investment total does not match solution allocation sum."
    }
  ]
}

Export blocked until cleared.

✅ PHASE P1 COMPLETE WHEN:

Roles restrict edits correctly

Any scope change forces ROI recalculation

Proposal auto-downgrades on impact

Consistency validator blocks invalid send

Export disabled until all checks pass