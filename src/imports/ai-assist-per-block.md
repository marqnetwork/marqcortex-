AI Assist Per Block (Inline + Safe)

Goal: every box (Block) gets AI help without breaking facts, ROI numbers, or compliance. AI generates a pending revision only, humans approve.

1) Add AI Actions to Every Block

Each block shows these buttons (if not locked):

Improve (boardroom polish, clarity, tighten)

Expand (add depth, add structure, add detail)

Simplify (client-facing, remove internal complexity)

Fix Issues (address reviewer notes / missing gate items)

Each action creates a block_revisions row with approval_status="pending".

2) AI Input Contract (What AI receives)

When AI runs on a block, it must receive:

The block

block_id, block_type, title, current content

Linked context via block_links

proposal basics (industry/region/tone)

diagnosis blocks (if editing a solution block)

solution blocks (if editing timeline)

ROI snapshot summary (read-only numbers)

scope boundaries

Rules

compliance flags

tone: “ultra-premium boardroom”

allowed edits list (what it CAN and CANNOT change)

This prevents hallucinations.

3) Hard Safety Rules (Non-Negotiable)

ROI numbers cannot be edited by AI

If block_type = roi_financial_snapshot

AI actions disabled OR “Suggest Recalc” only

Contract clauses are locked

If block_type = contract_clause

AI can only create a “suggestion revision” visible to admin

cannot auto-accept

No invented proof

No fake case studies, no fake certifications, no fabricated metrics

No guarantee language

Disallow phrases like “guaranteed ROI”, “will increase revenue by X%”

Use probability/conservative language

4) Revision Object Created by AI (Standard)

When AI generates content, it must create:

{
  "revision_id": "R-001001",
  "block_id": "B-000123",
  "change_type": "ai_expand",
  "proposed_content": { },
  "diff_summary": "Expanded solution scope with integration points, deliverables, outcomes, and risk controls. No ROI numbers changed.",
  "created_by": "system_ai",
  "created_by_type": "ai",
  "created_at": "ISO_DATE",
  "approval_status": "pending"
}
5) AI “No-Drift” Enforcement (Validation)

Before saving the AI revision, run validators:

A) Fact lock validator

If proposed content changes:

client name

offer price

timeline weeks

ROI metrics (any numbers)
→ reject revision with reason: fact_lock_violation

B) Block coherence validator

Solution blocks must include:

system_description

implementation_scope

expected_operational_outcomes

integration_points

If missing → AI must regenerate.

C) Jargon limiter

Reject if jargon density too high (basic rule: too many “optimize/leverage/synergy”).

6) UI Review Experience (Fast)

When revision is pending:

show side-by-side: Current vs Proposed

highlight differences

buttons:

Accept

Reject

Edit manually (turn proposed into editable draft)

Accept increments:

blocks.version += 1

updates current_revision_id

7) Block-Specific AI Templates (So outputs are consistent)
proposal_executive_brief

AI Expand must produce:

strategic context

why now

consequence of inaction

success definition

tone: boardroom, plain English

proposal_solution

AI Expand must produce:

what it changes

systems affected

integration points

deliverables

measurable outcomes

dependencies + risks

tie-back to linked diagnosis

proposal_timeline

AI Improve must produce:

week-by-week milestones

owners

deliverables

governance checkpoints

followup_email_template

AI Improve must produce:

short, executive, deliverability-safe

no spammy language

✅ Phase B is DONE when:

Every editable block has AI actions

AI writes only to pending revisions

Validators prevent ROI/contract drift

Review UI can accept/reject quickly

Block history shows AI changes properly