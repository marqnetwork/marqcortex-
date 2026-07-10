IRR INTEGRATION SPEC

finance_v2_dcf_irr

1️⃣ Definition

IRR = discount rate where:

NPV = 0

Meaning:

SUM( CashFlow_month / (1 + r_monthly)^n ) = 0

We must solve for r.

2️⃣ Required Input

IRR uses:

Monthly Net Cash Flow (from cash flow model)

Investment schedule

Gain ramped cash flow

No additional financial inputs required.

3️⃣ IRR Solver Method

Use Binary Search (stable and deterministic).

Why not Newton-Raphson?
Because:

It can diverge

It’s unstable for irregular cash flows

Binary search is safer.

4️⃣ Solver Algorithm
Step 1 — Define Bounds
low_rate = 0
high_rate = 5.0   // 500% annual max bound

If NPV(high_rate) still positive → IRR too high → cap.

Step 2 — Convert to Monthly Rate

When testing rate:

r_annual_test
r_monthly_test = r_annual_test / 12
Step 3 — Iterative Solve

Loop until:

abs(NPV) < tolerance

Tolerance = 0.0001

Max iterations = 100

Step 4 — If Not Converging

Return:

status = "irr_not_converged"

Never fake IRR.

5️⃣ IRR Edge Case Handling
Case A — All Positive Cash Flows

IRR undefined → return:

irr_status = "invalid_no_negative_cashflow"
Case B — Multiple Sign Changes

Possible multiple IRRs → return:

irr_status = "multiple_possible_irr"

Use MIRR instead (future enhancement).

6️⃣ IRR Output Payload

Extend finance layer:

{
  "finance_model_version": "finance_v2_dcf_irr",
  "irr_percent_annual": 185,
  "irr_percent_monthly": 9.3,
  "irr_solver_method": "binary_search",
  "iterations_used": 37,
  "converged": true,
  "tolerance": 0.0001,
  "notes": [
    "IRR solved from validated monthly cash flow",
    "Confidence-weighted gains applied before IRR",
    "Investment included in same timeline"
  ]
}
7️⃣ Governance Rules

IRR must use same cash flow projection used for DCF.

IRR must not use annualized ROI.

IRR must be recalculated whenever:

timeline changes

investment changes

gain changes

discount rate changes

Bind:

finance_recalc_required = true
8️⃣ Display Logic (Team-Facing Only)

Show:

IRR (annual)

IRR (monthly equivalent)

Solver status

Convergence indicator

If > 300% → show:
“High return — check realism assumptions.”

No hard cap on IRR internally.

What Phase 2 Achieves

Now your system has:

ROI %

NPV

Discounted Payback

IRR (true internal rate)

This is full CFO-grade financial modeling.