Post-Implementation ROI Tracking Engine (Build Spec)

Goal: once implementation starts, you track actual vs projected ROI per solution and portfolio, month by month. This protects credibility and powers upsells.

1️⃣ New Data Objects (mock-first)

roi_baselines

baseline_id

deal_id

proposal_id

portfolio_version_id

captured_at

metrics_snapshot (json)

roi_actuals

actual_id

deal_id

period_start (YYYY-MM-01)

period_end

metrics (json)

notes

captured_by

created_at

roi_variance

variance_id

deal_id

period

projected (json)

actual (json)

delta (json)

variance_reason_tags[]

roi_solution_attribution

deal_id

solution_id

period

projected_gain

actual_gain

confidence_adjusted_actual

notes

2️⃣ Baseline Capture (when it happens)

Trigger baseline creation when:

contract_signed OR onboarding_started (choose one, but be consistent)

Baseline must store:

ticket volume

response time

admin hours estimate

lead response time

conversion rate

proposal cycle time

tool costs

headcount involved

If client can’t provide exact numbers:
store baseline_quality: low|medium|high + notes.

3️⃣ Actual Metrics Intake (monthly)

Create a Team UI form:

Period selector (month)

Metrics fields (numbers)

“Evidence” upload links (optional later)

Notes

No APIs required now. Manual input is fine.

4️⃣ Projected vs Actual Calculation

You already have projections from ROI engine (per month cashflow).
So compute:

actual_monthly_gain

actual_monthly_investment (what you actually spent)

net_actual

cumulative_actual

Then variance:

variance_gain = actual_gain - projected_gain
variance_payback_shift = actual_payback_month - projected_payback_month
5️⃣ Variance Reason Tagging (team selects)

When variance exists, tag reasons:

adoption_delay

data_quality_issue

scope_change

integration_blocker

stakeholder_bottleneck

tool_limitations

model_performance

underestimated_change_mgmt

positive_outlier

This becomes intelligence later.

6️⃣ Realization Factor Learning (optional but powerful)

Update internal “realization factors” using actuals:

efficiency_realization_actual = actual_efficiency_gain / projected_efficiency_gain

revenue_realization_actual = actual_revenue_gain / projected_revenue_gain

Store per industry to improve future forecasts.

7️⃣ Team-Facing ROI Tracking UI (simple)

Cards:

Baseline Snapshot

Monthly Actuals Input

Projected vs Actual Chart

Variance Log + Tags

Solution Attribution Table

“Quarterly Review Draft” button (feeds Phase 9 later)

✅ Phase 7 “Done” Checklist

You’re done when:

Baseline is captured on contract signed

Monthly actuals can be entered

System auto-computes variance

Solution attribution is visible

Quarterly summary can be generated from tracked data