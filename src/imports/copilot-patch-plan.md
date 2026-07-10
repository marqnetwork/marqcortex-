Chat-to-Fix Any Box (Global Copilot)

Goal: a single chat panel can “talk to the system” and update one box or many boxes safely, by generating patches that become pending revisions on the right blocks.

No silent edits. No drift.

1) Add a Global Copilot Panel

Right-side panel (team-facing):

Input: “What do you want to change?”

Context selector:

Current page only

Whole proposal

Proposal + ROI + contract

Output:

“Planned Changes” list (before applying)

Apply button

Review queue

2) Chat → Patch Plan → Pending Revisions (3-step pipeline)
Step 1: Interpret request

User types: “Rewrite all solutions in boardroom tone and add integrations.”

Step 2: Generate Patch Plan (no edits yet)

Copilot returns a structured plan:

which blocks will change

what will change

what will not change (locked facts)

Step 3: Apply as pending revisions

For each target block, create block_revisions with approval_status="pending".

User then reviews and accepts/rejects.

3) Patch Instruction Schema (core object)
{
  "patch_id": "PATCH-001",
  "scope": {
    "entity_type": "proposal",
    "entity_id": "P-0001"
  },
  "intent": "rewrite_and_expand",
  "targets": [
    {
      "block_id": "B-000210",
      "action": "ai_expand",
      "constraints": {
        "tone": "boardroom_premium",
        "do_not_change": ["numbers", "pricing", "timeline_weeks"]
      }
    }
  ],
  "global_constraints": {
    "no_new_claims": true,
    "no_guarantees": true,
    "roi_numbers_locked": true,
    "contract_clauses_admin_only": true
  },
  "created_at": "ISO_DATE",
  "status": "planned | applied | cancelled"
}
4) Target Selection Logic (how copilot picks blocks)

Copilot chooses blocks by:

block_links to the current proposal/deal

block_type filters

user request keywords

Examples:

“Fix diagnosis blocks” → all proposal_diagnosis

“Improve proposal” → executive_brief + diagnosis + solutions + next_step

“Shorten for client” → simplify client-facing blocks only

5) Hard Guardrails (same as Phase B, but global)

ROI numeric blocks cannot be edited

Copilot can only:

suggest “Recalc ROI”

update narrative blocks

Contract clauses

Copilot creates “suggested revisions”

Requires admin acceptance

Version drift protection
If any patch touches:

solutions / scope / timeline
→ set:

roi_recalc_required = true

proposal status auto reverts to draft until recalculated and revalidated

6) Review Queue (fast approvals)

Add “Review Changes” drawer:

grouped by block_type

shows diff + rationale

Accept All / Accept Selected / Reject All

Accept All is disabled if:

any revision violates validators

7) Copilot Commands (supported intents)

Implement these “intents” to keep it deterministic:

rewrite_tone

expand_detail

simplify_client_view

fix_ready_gate_failures

align_solution_to_diagnosis

generate_missing_blocks

summarize_for_email

create_export_version

✅ Phase C is DONE when:

Chat can target and update multiple blocks via patch plan

No edits are applied without user approval

Drift rules trigger ROI recalculation when needed

Review queue supports bulk accept/reject

Full audit trail exists (patch_id → revisions)