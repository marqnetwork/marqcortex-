CASH FLOW TIMELINE MODELING LAYER

cashflow_model_v1

This converts annual ROI into time-based financial reality.

1️⃣ Core Principle

ROI is annualized.

Cash flow must reflect:

Investment timing

Phase-based deployment

Gradual gain ramp-up

Payback inflection point

No instant full-year benefit allowed.

2️⃣ Timeline Structure

Each recommendation must include:

{
  "timeline_months": 12,
  "investment_schedule": [],
  "gain_schedule": [],
  "net_cash_flow": [],
  "cumulative_cash_flow": []
}
3️⃣ Investment Timing Model

Investment must follow execution_plan phases.

Example:

If duration = 3 months:

Month 1 → 40%
Month 2 → 35%
Month 3 → 25%

Tooling recurring cost:

Spread evenly across active months.

No full upfront assumption unless explicitly defined.

4️⃣ Gain Ramp Model (Critical Realism Layer)

Gain must ramp gradually.

Default ramp curve:

Month 1 → 0%
Month 2 → 25%
Month 3 → 50%
Month 4 → 70%
Month 5 → 85%
Month 6+ → 100%

Multiply ramp factor by:

annual_gain / 12

This prevents “immediate full benefit” distortion.

5️⃣ Net Monthly Cash Flow
Net Cash Flow (month) = 
    Gain(month) - Investment(month)
6️⃣ Cumulative Cash Flow
Cumulative(month_n) = 
    Cumulative(month_n-1) + Net(month_n)
7️⃣ True Payback Calculation

Payback is month where:

Cumulative Cash Flow >= 0

This replaces simplified ROI payback estimate.

8️⃣ Portfolio Timeline

Portfolio timeline:

Sum all recommendation monthly gains
Sum all recommendation monthly investments
Calculate portfolio cumulative

Dependencies must apply before timeline generation.

9️⃣ Output Structure
{
  "monthly_projection": [
    {
      "month": 1,
      "investment": 8000,
      "gain": 0,
      "net": -8000,
      "cumulative": -8000
    },
    {
      "month": 2,
      "investment": 6000,
      "gain": 3000,
      "net": -3000,
      "cumulative": -11000
    }
  ],
  "true_payback_month": 5,
  "cashflow_positive_after_month": 5
}
🔟 Cash Flow Safety Rules

No gain allowed before deployment milestone

Revenue gains only after enablement recommendation active

Efficiency gains only after automation phase completed

If dependency fails → child gain = 0

What This Adds

Now your system:

Shows realistic payback

Shows early negative burn

Shows break-even visually

Prevents inflated “2 month ROI” claims

Aligns finance with execution