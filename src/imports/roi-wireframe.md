STRUCTURE
1️⃣ ROI Executive Control Header (Top Section)
Layout: 5-Column Summary Strip
[ Total Investment ]
[ Annual Gain (Conf.-Weighted) ]
[ ROI % Range ]
[ True Payback (Months) ]
[ Portfolio Confidence % ]

Below it (right aligned):

[ Scenario Toggle: Conservative | Expected | Aggressive ]
[ Version: v3 → v4 ]

If ROI capped → small red badge:
“ROI capped at system limit”

2️⃣ Cash Flow Timeline Panel
Left: Line Chart (Monthly)

Investment (red)

Gain (green)

Cumulative (blue)

Right: Key Stats

Nominal Payback Month

Discounted Payback Month

NPV

IRR (Annual %)

IRR (Monthly %)

Monte Carlo Median ROI

Probability ROI > 0%

Collapsed toggle:
“View Monthly Table”

3️⃣ Monte Carlo Distribution Panel
Visual

ROI Histogram

Shaded P10–P90 band

Stats Block

Mean ROI

Median ROI

P10 ROI

P90 ROI

Probability Payback ≤ 6 months

Probability Payback ≤ 12 months

Collapsed:
“Simulation Inputs”

4️⃣ Recommendation ROI Breakdown (Stacked Cards)

Each card:

Header Row

Recommendation Title

Priority Rank

Confidence %

Dependency Chain

Version

Financial Metrics

Investment Range

Gain Range

ROI Range

Payback

NPV contribution

Gain Composition (Bar View)

Efficiency %

Revenue %

Cost %

Risk %

Validation Notes (Collapsed)

Gain categories removed

Overlap adjustments

Cap applied?

Assumptions used

5️⃣ Financial Assumptions Panel (Editable)

Table format:

Variable | Value | Edit | Sensitivity | Source | Last Updated

Editing triggers ChangeRequest.

Below table:

“Recalculate”

“Approve Version”

6️⃣ Sensitivity Analysis Panel

Simple ranked list:

support_tickets_per_week → 8% ROI delta per 10% change

gross_margin_percent → 6% delta

labor_cost_per_hour → 4% delta

Button: “Run Monte Carlo Again”

7️⃣ Audit & Version Log Panel

Timeline style:

v1 → Initial
v2 → Tickets updated
v3 → Scenario switched to Conservative
v4 → Discount rate changed

Each entry expandable:

ROI delta

Gain delta

Payback delta

🔒 UX Rules

Nothing auto-expands except Executive Header.

Advanced finance sections collapsed by default.

Scenario switch never changes baseline assumptions.

Editing assumptions always creates new version.

Monte Carlo never runs silently.

🎯 After This Wireframe

ROI is architecturally complete.

The only thing left in ROI domain would be:

Visual refinement

Performance tuning for simulations

Client-facing simplification layer

There is no missing financial logic.