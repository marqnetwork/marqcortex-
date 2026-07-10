OI ENGINE — DEV MATHEMATICAL DOCUMENTATION

Version: roi_engine_v1_conservative

1️⃣ Global Rules

All gains must be annualized.

All gains must be confidence-weighted.

Revenue must be calculated at gross margin, not top-line.

Efficiency gains must use realization factors.

ROI display must respect hard cap.

No double counting across dependent recommendations.

If baseline missing → return "not_calculable".

2️⃣ Core Formula Definitions
ROI Formula
ROI = (Annual Gain - Investment) / Investment

Return as percentage.

Payback (Months)
Payback Months = Investment / (Annual Gain / 12)
3️⃣ Calculation Engines by Impact Type

Each recommendation declares:

impact_type: [efficiency | cost_reduction | revenue_growth | risk_reduction]
A) Efficiency Gain

Used for time savings.

Step 1 — Raw Annual Value
Raw Annual = hours_saved_per_week 
             × labor_cost_per_hour 
             × 52
Step 2 — Apply Realization Factor

Low case = 0.35
Mid case = 0.55
High case = 0.75

Adjusted Gain = Raw Annual × realization_factor
B) Cost Reduction Gain

Used for eliminated tools or avoided hiring.

Raw Annual = direct_cost_savings

Apply realization:

Low = 0.50
Mid = 0.70
High = 0.85

Adjusted Gain = Raw Annual × factor
C) Revenue Growth / Protection

Revenue must be margin-adjusted.

Margin Revenue = incremental_revenue × gross_margin_percent

Apply realization:

Low = 0.20
Mid = 0.35
High = 0.50

Adjusted Gain = Margin Revenue × factor
D) Risk Reduction (Expected Value)
Expected Risk = probability × exposure_value

Apply reduction factor:

Low = 0.15
Mid = 0.25
High = 0.40

Adjusted Gain = Expected Risk × reduction_factor
4️⃣ Confidence Weighting (Mandatory)

Each recommendation has:

confidence_score (0–100)

Multiplier:

confidence_multiplier = confidence_score / 100

Apply after realization:

Confidence Adjusted Gain = Adjusted Gain × confidence_multiplier

This is final annual gain.

5️⃣ Multi-Impact Aggregation (Per Recommendation)

If multiple impact types exist:

Total Annual Gain = SUM(all confidence-adjusted impact gains)
6️⃣ Portfolio Aggregation

Portfolio gain:

Portfolio Gain = SUM(confidence-adjusted gains of included recommendations)

Portfolio investment:

Portfolio Investment = SUM(investments)

Then:

Portfolio ROI = (Portfolio Gain - Portfolio Investment) / Portfolio Investment
7️⃣ ROI Capping Logic

If:

Portfolio ROI % > constraints.max_roi_display_percent

Then:

displayed_roi = constraints.max_roi_display_percent
cap_applied = true

Internal raw ROI should still be stored.

8️⃣ Dependency Rule (Double Counting Prevention)

If Recommendation B depends on A:

A may claim efficiency/cost gains.

B may only claim revenue gains created after A.

Dev must check:

if recommendation.depends_on exists:
    exclude overlapping gain categories
9️⃣ Not Calculable Condition

Return:

{
  status: "not_calculable",
  reason: "missing_baseline_or_assumptions"
}

If any required assumption missing:

labor_cost_per_hour

gross_margin_percent

baseline metric tied to impact

🔟 Output Object (Final Structure)
{
  status,
  portfolio: {
    investment_range,
    gain_range_low_mid_high,
    roi_percent_range,
    payback_range,
    confidence_score,
    cap_applied
  },
  by_recommendation: [...],
  assumptions_used,
  sensitivity_analysis,
  method_version
}
11️⃣ Sensitivity Calculation

For top 3 sensitive variables:

Increase variable by 10%
Recalculate portfolio ROI
Measure delta %

Rank by delta impact.

🔒 Engine Guarantees

This system ensures:

No inflated revenue math

No stacked ROI

Conservative realization

Confidence-weighted output

Hard-capped presentation

Full recalculation determinism