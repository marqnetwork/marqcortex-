RECOMMENDATION COST MODELING LAYER

cost_model_v1_standardized

1️⃣ Cost Structure Definition (Per Recommendation)

Each recommendation must calculate investment using the same structure:

{
  "engineering_cost": {},
  "strategy_cost": {},
  "tooling_cost": {},
  "change_management_cost": {},
  "contingency_cost": {},
  "total_investment": {}
}

No lump-sum allowed internally.

2️⃣ Engineering Cost Formula
engineering_cost = 
    (allocated_percent × monthly_role_cost × duration_months)

Example:

AI Engineer = $8,000/month

Allocation = 60%

Duration = 2 months

Engineering cost =
0.6 × 8000 × 2

3️⃣ Strategy Cost

Used for consultancy / system design.

strategy_cost = 
    (consultant_daily_rate × strategy_days)

Flat package allowed only if mapped to internal hours.

4️⃣ Tooling Cost

If tools required:

tooling_cost = 
    (monthly_tool_cost × project_months)

If client already owns tool → cost = 0.

5️⃣ Change Management Cost

Used for:

training

documentation

rollout management

change_cost = 
    (training_hours × blended_labor_rate)
6️⃣ Contingency Rule (Mandatory)

Always add:

contingency_cost = 10–20% of subtotal

Default = 15%.

No zero contingency allowed.

7️⃣ Total Investment Formula
subtotal = engineering + strategy + tooling + change
total_investment = subtotal + contingency

Return range if uncertainty exists.

8️⃣ Investment Range Logic

If uncertainty high:

Low case:

shorter duration

lower allocation

Mid case:

expected allocation

High case:

extended duration + buffer

9️⃣ Cost Governance Rules

No recommendation may exceed 40% of portfolio investment unless marked “Major Transformation”

Investment must align with execution_plan duration

Duration mismatch → block ROI

🔟 Output Object Per Recommendation
{
  "investment_estimate": {
    "low": 9000,
    "mid": 12000,
    "high": 16000
  },
  "cost_breakdown": {
    "engineering": 8000,
    "strategy": 2000,
    "tooling": 1000,
    "change_management": 1500,
    "contingency": 1800
  },
  "duration_months": 3
}
🔒 What This Fixes

No arbitrary pricing

No inflated ROI via low denominator

Duration-linked costing

Transparent breakdown

Portfolio comparability