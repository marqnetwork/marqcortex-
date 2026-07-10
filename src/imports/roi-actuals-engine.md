LIVE ROI ACTUALS ENGINE
Objective

Track real results during delivery and compare to:

Baseline (locked at kickoff)

Projected ROI (from proposal snapshot / ROI engine)

Solution-level attribution

Then generate:

variance alerts

payback progress

credibility-safe reporting

1) Data Objects (Minimum)
A) roi_baseline (already created, now finalize)

Captured once per execution.

{
  "baseline_id": "BL-001",
  "execution_id": "EX-001",
  "captured_at": "ISO_DATE",
  "baseline_quality": "low | medium | high",
  "metrics": {
    "manual_hours_per_week": 0,
    "avg_fully_loaded_cost_per_hour": 0,
    "monthly_revenue": 0,
    "gross_margin_percent": 0,
    "lead_to_close_rate_percent": 0,
    "avg_sales_cycle_days": 0,
    "tickets_per_month": 0,
    "avg_ticket_handle_time_minutes": 0
  },
  "notes": ""
}

Baseline becomes immutable unless change order.

B) roi_projection_snapshot

Copied from proposal snapshot ROI outputs.

{
  "projection_id": "PRJ-001",
  "execution_id": "EX-001",
  "proposal_snapshot_id": "PS-0001",
  "scenario": "expected",
  "monthly_cashflows": [
    { "month": "2026-03", "projected_gain": 0, "projected_cost": 0 }
  ],
  "projected_roi_percent": 0,
  "projected_payback_month": 0
}

Immutable.

C) roi_actual_month

Manually entered monthly (team form).

{
  "actual_id": "ACT-2026-03",
  "execution_id": "EX-001",
  "month": "2026-03",
  "metrics": {
    "manual_hours_per_week": 0,
    "monthly_revenue": 0,
    "tickets_per_month": 0,
    "avg_ticket_handle_time_minutes": 0,
    "automation_coverage_percent": 0
  },
  "evidence_links": [],
  "notes": "",
  "submitted_by": "U-01",
  "submitted_at": "ISO_DATE"
}
D) roi_variance_month

Auto-computed.

{
  "variance_id": "VAR-2026-03",
  "execution_id": "EX-001",
  "month": "2026-03",
  "projected": { "gain": 0, "cost": 0 },
  "actual": { "gain": 0, "cost": 0 },
  "delta": { "gain": 0, "cost": 0 },
  "payback_progress": {
    "projected_cumulative_net": 0,
    "actual_cumulative_net": 0,
    "estimated_payback_month_actual": 0
  },
  "variance_tags": []
}
2) Calculations (Simple, Credible, No Finance Overkill)
A) Labor Cost Saved (monthly)

From baseline vs actual:

baseline_hours = baseline.manual_hours_per_week * 4.33

actual_hours = actual.manual_hours_per_week * 4.33

hours_saved = max(0, baseline_hours - actual_hours)

labor_savings = hours_saved * baseline.avg_fully_loaded_cost_per_hour

B) Support Efficiency Savings (optional)

If you use tickets:

time_saved_minutes = (baseline_handle_time - actual_handle_time) * actual_tickets

convert to hours * cost/hour

C) Revenue Lift (conservative)

revenue_delta = max(0, actual.monthly_revenue - baseline.monthly_revenue)

margin_lift = revenue_delta * (baseline.gross_margin_percent / 100)

D) Actual Monthly Gain

actual_gain = labor_savings + efficiency_savings + margin_lift

E) Net Actual (monthly)

net_actual = actual_gain - actual_project_cost
(Your project cost can be entered monthly or pulled from contract schedule.)

3) Solution Attribution (Required)

Each month, allocate actual gain across workstreams (lightweight, not perfect):

{
  "execution_id": "EX-001",
  "month": "2026-03",
  "attribution": [
    { "workstream_id": "WS-001", "percent": 40 },
    { "workstream_id": "WS-002", "percent": 60 }
  ]
}

Rule:

sum(percent) must equal 100.

System multiplies actual_gain by percentages for per-solution reporting.

4) Variance Tags (Team selects)

Use fixed tags:

adoption_delay

stakeholder_blocker

data_quality_issue

integration_delay

scope_change

training_required

positive_outlier

measurement_noise

These feed QBR.

5) Alerts (so delivery is controlled)

Trigger alerts when:

actual gain < 70% of projected for 2 months

automation coverage stagnates

payback shifts by +2 months

variance tags repeat (same blocker)

Alert object:

{
  "execution_id": "EX-001",
  "month": "2026-04",
  "alert_type": "roi_underperforming",
  "severity": "medium | high",
  "recommended_action": "Run adoption workshop + fix integration bottleneck"
}
6) Team ROI Page Layout (Execution Tab)

Cards:

Baseline Snapshot (locked)

Projected ROI (from snapshot)

Monthly Actual Input Form

Actual vs Projected (table + chart later)

Payback Progress (cumulative net)

Workstream Attribution Table

Variance Tags + Notes

Alerts Panel

✅ Live ROI Actuals Engine “Done” Checklist

You’re done when:

baseline is locked per execution

monthly actuals can be entered

system computes actual gain + net actual

variance is auto-computed vs projected

attribution per workstream works

alerts trigger correctly

QBR can pull these records later