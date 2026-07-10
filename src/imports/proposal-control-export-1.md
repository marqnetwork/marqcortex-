PROPOSAL CONTROL & EXPORT SYSTEM
Objective

Turn Proposal from internal working model into:

Client-facing executive version

Controlled export asset

Lifecycle-managed contract precursor

1️⃣ Proposal State Machine (Finalized)

Add controlled states:

"proposal_state": {
  "status": "draft | internal_review | ready_to_send | sent | viewed | approved | rejected | expired",
  "locked": false,
  "sent_at": null,
  "viewed_at": null,
  "approved_at": null,
  "expires_at": null,
  "approved_by": null
}

Rules:

Only ready_to_send can be exported

Once sent → financial fields locked

ROI version change → auto revert to draft

Editing after send → requires duplication

2️⃣ Client-Facing Simplification Layer

Internal proposal is complex.

Client version must show:

Show:

Executive Brief

Confirmed Diagnosis

Solutions Summary

Timeline

Investment

Expected ROI (Expected Scenario Only)

Payback Month

Governance

Hide:

Monte Carlo raw distribution

Sensitivity tables

Internal confidence scoring

Complexity score

Dependency matrix

Add transformation function:

"client_view": {
  "roi_scenario": "expected_only",
  "hide_internal_metrics": true,
  "hide_confidence_scores": true,
  "simplify_financial_language": true
}
3️⃣ Export Engine

Build export template layers:

Export Types:

Executive PDF

Detailed PDF

Internal Review PDF

PDF must include:

Cover Page

Executive Brief

Diagnosis

Solution Architecture

Timeline

Investment & Financial Outlook

Governance

Signature Page

4️⃣ Signature & Approval Block

Append to export:

Client Representative Name

Title

Signature

Date

Payment Authorization Clause

Add digital approval flag:

"approval_block": {
  "signature_required": true,
  "payment_terms": "50% upfront, 50% upon roadmap delivery",
  "contract_reference_required": true
}
5️⃣ Proposal Integrity Lock

Before export allowed:

System validates:

Phase 1 Ready Gate passed

Phase 2 mapping valid

Phase 3 ROI bound

Phase 4 timeline complete

No pending ROI recalculation

If any false → export blocked.

6️⃣ Expiration Logic

Add:

Proposal validity: 14–30 days

If expired → ROI must be revalidated

Investment may be adjusted

This protects financial drift.

🔒 What Phase 5 Completes

Now your Proposal System:

Cannot inflate ROI

Cannot drift from diagnosis

Cannot detach from implementation

Cannot be edited silently after send

Cannot use outdated financial modeling

This is institutional-grade proposal control.