Architecture: Chat Recalculation + Version Control Engine

You’re building a controlled editing system where chat changes inputs, then the engine deterministically rebuilds Recommendations + ROI, and Cortex rewrites narrative. No silent edits. No drift.

1) Core Principle

Chat never edits outputs directly.
Chat only edits inputs/assumptions/constraints.
Then the pipeline re-runs:

Inputs → Scoring → Portfolio Ranking → Feasibility → Confidence → ROI → Cortex narrative

2) Data Objects You Need (Minimal, Production-Ready)
A) Portfolio State (single source of truth)
{
  "portfolio_id": "uuid",
  "current_version": "v3",
  "created_at": "iso",
  "updated_at": "iso",
  "inputs": {
    "business_snapshot": {},
    "answers": [],
    "assumptions": {},
    "constraints": {}
  },
  "outputs": {
    "diagnostic": {},
    "recommendations": {},
    "roi": {}
  },
  "history": []
}
B) Assumptions (the only editable financial/ops layer)
{
  "assumptions": {
    "monthly_revenue": 250000,
    "avg_order_value": 85,
    "monthly_orders": 2940,
    "support_tickets_per_week": 220,
    "avg_response_time_hours": 30,
    "labor_cost_per_hour": 18,
    "refund_rate_percent": 3.8,
    "conversion_rate_percent": 2.1,
    "gross_margin_percent": 42
  }
}
C) Constraints (guardrails)
{
  "constraints": {
    "max_roi_display_percent": 350,
    "roi_must_be_range": true,
    "confidence_floor_for_roi": 60,
    "max_recommendations": 7,
    "no_claims_without_assumptions": true
  }
}
D) Version Record (immutable)
{
  "version": "v3",
  "previous_version": "v2",
  "timestamp": "iso",
  "actor": "team_user | system",
  "source": "chat | manual_edit | auto",
  "delta_log": [
    {
      "path": "inputs.assumptions.support_tickets_per_week",
      "old": 220,
      "new": 350,
      "reason": "User clarified seasonal spike"
    }
  ],
  "recalc": {
    "scoring": true,
    "portfolio": true,
    "feasibility": true,
    "confidence": true,
    "roi": true,
    "cortex_narrative": true
  },
  "summary": "Tickets updated for seasonality; ROI range and confidence recalculated."
}
3) Chat → Change Request Protocol (the heart of Step 5)
A) Chat Intent Types (limit to these)

UpdateAssumption (numbers / business parameters)

UpdateConstraint (caps, limits, display rules)

UpdatePriorityPreference (e.g., “focus on ops first”) as a soft preference only

ClarifyAnswer (replace/append an answer text)

RequestExplanation (no recalculation)

ApproveVersion (lock for proposal/export)

B) Chat Output Must Be a ChangeRequest JSON (even in mock mode)
{
  "type": "UpdateAssumption",
  "changes": [
    {
      "path": "inputs.assumptions.support_tickets_per_week",
      "value": 350,
      "reason": "Peak season volume"
    }
  ]
}

If the message is vague, Cortex replies with a single clarifying question inside chat, but your system still expects the final message to resolve into this ChangeRequest format.

4) Recalculation Pipeline (Deterministic)
Pipeline steps (always same order)

Validate ChangeRequest

allowed paths only

type checking (number, percent bounds, non-negative)

Apply Patch to Portfolio State → create Draft Version

Run Engines

Scoring Engine

Portfolio Ranking Engine

Feasibility Engine

Confidence Engine

ROI Engine (range + caps + confidence-adjust)

Cortex Narrative Refresh

rewrite “why first”, “why not others”, “risks”, “assumptions used”

must reference current version values

Commit Version

store delta_log

mark outputs as vN

Return UI Update Payload

updated sections + a visible “What changed” summary

Important rule

If any engine fails validation (e.g., missing baseline), then:

ROI becomes "status": "not_calculable" for that recommendation

UI shows “Needs baseline” instead of numbers

5) Versioning Rules (non-negotiable)

Every recalculation increments version: v1 → v2 → v3

Never overwrite previous versions

Store at least last 25 versions per portfolio

Add “Revert to v2” capability (team tool)

6) ROI Safety Controls Built Into Step 5
A) Always Range
"roi": {
  "low_case": {...},
  "mid_case": {...},
  "high_case": {...}
}
B) Confidence-weighted ROI
"displayed_roi_percent" = raw_roi_percent * (confidence_score/100)
C) Hard Cap Display (even if math says higher)
"displayed_roi_percent": min(calculated, constraints.max_roi_display_percent)
"cap_applied": true
D) Assumption Trace

Every ROI block must include assumptions_used[] paths so team can defend the number.

7) UI Behavior in Figma/VibeCode (no APIs yet)

Implement Step 5 in “mock mode” with:

A local portfolio_state.json

A local rules.json (weights, caps)

A local function applyChangeRequest(changeRequest) that:

patches inputs

swaps in a new prebuilt “output payload” (v2, v3) to simulate recalculation

appends version record to history

Later, you replace the mock applyChangeRequest with an API call that returns the same updated Portfolio State.

8) What the Recommendations Tab Must Support After Step 5

For every recommendation card:

show version

show confidence_score

show assumptions_used (collapsed)

show “last updated by chat” summary

show “delta log” (collapsed)

This is what makes it enterprise-grade.