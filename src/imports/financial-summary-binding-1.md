FINANCIAL SUMMARY BINDING
Objective

Attach ROI engine outputs directly to:

Each solution

Each phase

Entire proposal

And prevent number manipulation.

1️⃣ Extend Proposal Payload

Append this object:

"financial_summary": {
  "portfolio_version_id": "v4",
  "scenario": "expected",
  "currency": "USD",
  "investment_total": 0,
  "annual_gain_conf_weighted": 0,
  "roi_percentage": 0,
  "payback_month": 0,
  "npv": 0,
  "irr_annual": 0,
  "irr_monthly": 0,
  "monte_carlo": {
    "mean_roi": 0,
    "median_roi": 0,
    "p10_roi": 0,
    "p90_roi": 0,
    "probability_positive_roi": 0
  },
  "confidence_score": 0,
  "realization_factor_applied": true,
  "dependency_validated": true,
  "roi_cap_applied": false
}

This must be auto-populated from ROI engine.

Manual edits blocked.

2️⃣ Solution-Level Financial Binding

Each solution must now include:

"financial_binding": {
  "investment_allocated": 0,
  "annual_gain": 0,
  "roi_contribution_percentage": 0,
  "payback_month": 0
}

Rules:

Sum of all investment_allocated = investment_total

Sum of all annual_gain = annual_gain_conf_weighted

No solution can exceed global ROI cap logic

If solution removed → auto recalculation required

3️⃣ Validation Layer (Critical)

Before Proposal can move forward:

Validation 1 — Portfolio Match

financial_summary.portfolio_version_id must match active ROI version.

If ROI updated → Proposal invalidates automatically.

Validation 2 — Dependency Check

dependency_validated must be true.

If overlapping gains detected → reject.

Validation 3 — Confidence Threshold

confidence_score must be ≥ 70.

If below → requires internal approval override.

Validation 4 — Realization Factor Enforcement

No solution allowed with 100% realization unless explicitly flagged.

4️⃣ UI Rendering (Team Proposal Tab)

Add Financial Block:

🔷 Financial Overview (Board-Level View)

Total Investment

Expected ROI

True Payback

NPV

IRR

Risk Band (P10–P90)

Probability Positive ROI

Small text under it:

"All projections are confidence-weighted, dependency-validated, and conservatively modeled."

🔷 Solution Financial Contribution

For each solution:

Investment Allocated

Expected Annual Gain

ROI Contribution %

Payback Month

This makes proposal mathematically transparent internally.

5️⃣ Phase 3 Ready Gate

Proposal can move to Phase 4 only if:

Financial summary populated

All solutions financially bound

ROI engine validation passed

Portfolio version locked

No manual edits detected

If ROI recalculated → proposal status resets to draft.