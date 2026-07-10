Core Dashboard Sections

You will build 4 primary panels.

🔵 PANEL 1 — Revenue Performance

Metrics:

Total Deals Created

Total Proposals Sent

Close Rate (%)

Closed Won Value

Average Deal Size

Average Sales Cycle (days)

Derived From:

crm_deals

proposal_state

contract_payload

Formula Examples:

close_rate = closed_won / proposals_sent
sales_cycle = avg(contract_signed_date - proposal_sent_date)
🔵 PANEL 2 — Proposal Performance

Metrics:

Proposal → View Rate

View → Approval Rate

Average Time to First View

Expiration Rate

Objection Rate

Derived From:

engagement_metrics

follow_up_state

crm_activity_log

This shows friction in your sales system.

🔵 PANEL 3 — ROI Accuracy Panel

This connects Phase 7 data.

Metrics:

Avg Projected ROI

Avg Actual ROI

Forecast Accuracy %

Avg Payback Deviation (months)

Industry-Based Accuracy Breakdown

Formula:

forecast_accuracy = actual_roi / projected_roi
payback_delta = actual_payback - projected_payback

This protects long-term credibility.

🔵 PANEL 4 — Objection Intelligence

Metrics:

Objection Type Frequency

Close Rate by Objection Type

Average Time to Resolve Objection

Price Objection %

Risk Objection %

Derived From:

objection_detected.type

This tells you where deals stall.

2️⃣ Filters (Top Controls)

Must include:

Date Range

Industry

Owner

Region

Scenario (Conservative / Expected / Aggressive)

Deal Size Range

All metrics update dynamically.

3️⃣ Data Aggregation Rules

You need nightly aggregation job:

{
  "job": "dashboard_aggregate",
  "frequency": "daily",
  "tables": [
    "crm_deals",
    "proposal_state",
    "roi_actuals",
    "roi_variance"
  ]
}

Do not compute heavy joins on every dashboard load.

4️⃣ Leadership Snapshot Card (Top Strip)

Show 6 KPI tiles:

Close Rate

Average ROI Accuracy

Revenue Won

Average Deal Size

Avg Sales Cycle

Objection Rate

Green/Red indicators based on trend.

5️⃣ Phase 8 Done Checklist

You are done when:

All 4 panels render real aggregated data

Filters affect all metrics

Trends show MoM comparison

ROI accuracy compares projected vs actual

Objection patterns visible by industry