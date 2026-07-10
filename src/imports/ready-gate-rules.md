Ready Gate (No Debate, Build This)

The Ready Gate is the rule set that decides if Proposal can move from draft → internal_review (and later ready_to_send). It prevents half-baked proposals.

✅ Ready Gate: draft → internal_review

A proposal is eligible only if ALL conditions pass:

Linkage is present

linkage.diagnostic_id is not empty

linkage.portfolio_version_id is not empty

Executive Brief is complete

executive_brief.title not empty

executive_brief.strategic_context min 300 characters

executive_brief.why_now min 200 characters

executive_brief.what_success_looks_like min 200 characters

Diagnosis Blocks minimum

diagnosis_blocks.length >= 3

Each Diagnosis Block passes validation
For every item in diagnosis_blocks[]:

title not empty (min 8 chars)

description min 200 chars

operational_impact.length >= 2 and each item min 30 chars

financial_impact.length >= 2 and each item min 30 chars

severity is one of: low | medium | high | critical

confidence is a number 0–100

evidence.length >= 1 with valid source + ref

Scope Boundaries present

scope_boundaries.included.length >= 3

scope_boundaries.excluded.length >= 2

scope_boundaries.assumptions.length >= 2

Next Step Offer complete

next_step_offer.offer_name not empty

price > 0

duration not empty

primary_cta not empty

✅ Gate Output Object (What the system returns)

When user hits “Mark Internal Review” return:

{
  "gate": "phase1_internal_review",
  "passed": false,
  "missing": [
    { "path": "executive_brief.why_now", "reason": "min 200 characters" },
    { "path": "diagnosis_blocks[1].evidence", "reason": "at least 1 evidence item required" }
  ]
}

If passed:

{
  "gate": "phase1_internal_review",
  "passed": true,
  "missing": []
}
🔒 Why This Gate Matters

It forces:

real executive narrative

real diagnosis detail

documented evidence

clear boundaries

a clean next-step offer