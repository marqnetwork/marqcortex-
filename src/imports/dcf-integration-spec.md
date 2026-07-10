DCF INTEGRATION SPEC

finance_v1_dcf

1️⃣ New Required Input (Portfolio-Level)

Add inside inputs.assumptions:

{
  "discount_rate_percent": 12
}

Validation:

Must be 0–40%

Default = 12% if not provided

Cannot be negative

2️⃣ Discount Rate Conversion

Because your model is monthly:

r_annual = discount_rate_percent / 100
r_monthly = r_annual / 12

Example:

12% →
r_annual = 0.12
r_monthly = 0.01

3️⃣ Monthly Discount Formula

For each month:

Discounted Cash Flow(month_n) =
    Net_Cash_Flow(month_n) 
    / (1 + r_monthly)^n

Where:

n = month index starting from 1

This must be applied AFTER:

dependency validation

confidence weighting

gain ramping

Never discount raw gains.

4️⃣ Net Present Value (NPV)
NPV = SUM(all discounted monthly cash flows)

NPV must use the same 12-month timeline unless extended.

If timeline < 12 months:

Extend with stable gains at 100% ramp

No additional investment beyond execution period

5️⃣ Discounted Payback Calculation

True payback must now be computed twice:

A) Nominal Payback

Based on raw cumulative cash flow.

B) Discounted Payback

Based on discounted cumulative cash flow.

Discounted payback month = first month where:

Cumulative Discounted Cash Flow >= 0
6️⃣ Portfolio Output Extension

Add to ROI output:

{
  "finance_model_version": "finance_v1_dcf",
  "discount_rate_percent": 12,
  "npv": 148000,
  "discounted_payback_month": 6,
  "discounted_cashflow_projection": [
    {
      "month": 1,
      "net_cashflow": -8000,
      "discounted_cashflow": -7920,
      "cumulative_discounted": -7920
    }
  ],
  "method_notes": [
    "Discount rate applied monthly",
    "DCF applied after confidence weighting",
    "Investment discounted in same model"
  ]
}
7️⃣ Governance Rules

DCF must:

Use validated net monthly cash flow

Not re-run ROI math

Not modify gain assumptions

Not affect confidence score

DCF is purely valuation adjustment.

8️⃣ Failure Conditions

If:

Net monthly projection missing

Discount rate invalid

Timeline incomplete

Return:

{
  "status": "finance_not_calculable",
  "reason": "missing_cashflow_or_discount_rate"
}
9️⃣ Version Binding

Any change in:

discount_rate_percent

timeline

gain

investment

Must trigger:

finance_recalc_required = true

Create new version.