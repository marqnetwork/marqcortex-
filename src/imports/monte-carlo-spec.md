MONTE CARLO SIMULATION SPEC

finance_v3_montecarlo

This runs on top of your existing pipeline:

Dependencies validated → Cost model → Cash flow timeline → Confidence weighting → (optional DCF/IRR) → Monte Carlo

Monte Carlo never touches your base payload, it produces an extra risk distribution payload.

1️⃣ Purpose

Instead of 1 ROI number or even 3 cases, you get:

Median ROI

Best/worst bands

Probability of positive ROI

Probability of payback within X months

This is the “CFO trust layer”.

2️⃣ Inputs (what gets randomized)

Only randomize high-sensitivity assumptions, not everything.

Default randomized variables:

support_tickets_per_week

gross_margin_percent

labor_cost_per_hour

realization_factor_overrides (efficiency + revenue)

gain_ramp_speed

You define each variable with:

distribution type

min/max or mean/std

clamp bounds

Default bands (safe)
support_tickets_per_week: ±15%
gross_margin_percent: ±5% (absolute)
labor_cost_per_hour: ±10%
efficiency_realization: ±10% around baseline factor
revenue_realization: ±15% around baseline factor
ramp_speed: ±1 month shift
3️⃣ Distributions (keep it simple)

Use triangular distributions for most business variables, because it’s intuitive:

min

most_likely

max

Example (tickets):

min = base * 0.85
mode = base
max = base * 1.15
4️⃣ Simulation Count

Default:

1,000 runs (fast enough)
Optional:

5,000 for higher accuracy

5️⃣ Simulation Loop (per run)

For each run:

sample randomized values

clone portfolio inputs

run ROI engine (and cash flow timeline)

compute:

portfolio ROI %

portfolio NPV (if DCF enabled)

payback month (nominal + discounted)

Store results.

6️⃣ Output Metrics

From all simulation results compute:

Mean ROI

Median ROI

P10 ROI (10th percentile)

P90 ROI (90th percentile)

Probability ROI > 0

Probability payback ≤ 6 months

Probability payback ≤ 12 months

Same for NPV if enabled:

Median NPV

P10/P90 NPV

Probability NPV > 0

7️⃣ Monte Carlo Payload (plug-in output)
{
  "finance_model_version": "finance_v3_montecarlo",
  "simulations": 1000,
  "randomized_inputs": [
    {
      "path": "inputs.assumptions.support_tickets_per_week",
      "distribution": "triangular",
      "min_multiplier": 0.85,
      "mode_multiplier": 1.0,
      "max_multiplier": 1.15
    },
    {
      "path": "inputs.assumptions.gross_margin_percent",
      "distribution": "triangular",
      "min_delta": -5,
      "mode_delta": 0,
      "max_delta": 5
    },
    {
      "path": "inputs.assumptions.labor_cost_per_hour",
      "distribution": "triangular",
      "min_multiplier": 0.90,
      "mode_multiplier": 1.0,
      "max_multiplier": 1.10
    },
    {
      "path": "engine.realization_factors.efficiency",
      "distribution": "triangular",
      "min_multiplier": 0.90,
      "mode_multiplier": 1.0,
      "max_multiplier": 1.10
    },
    {
      "path": "engine.realization_factors.revenue",
      "distribution": "triangular",
      "min_multiplier": 0.85,
      "mode_multiplier": 1.0,
      "max_multiplier": 1.15
    },
    {
      "path": "engine.ramp_curve.shift_months",
      "distribution": "discrete",
      "values": [-1, 0, 1],
      "weights": [0.25, 0.50, 0.25]
    }
  ],
  "results": {
    "roi_percent": {
      "mean": 214,
      "median": 198,
      "p10": 95,
      "p90": 340,
      "probability_positive": 0.94
    },
    "payback_months": {
      "median": 5,
      "p10": 3,
      "p90": 9,
      "probability_payback_le_6": 0.71,
      "probability_payback_le_12": 0.92
    },
    "npv": {
      "enabled": true,
      "median": 155000,
      "p10": 42000,
      "p90": 260000,
      "probability_positive": 0.90
    }
  },
  "notes": [
    "Monte Carlo runs on confidence-weighted cash flows",
    "Dependency validation applied before simulation",
    "Triangular distributions used for interpretability"
  ]
}
8️⃣ Governance Rules

Monte Carlo is team-only

If simulation time is heavy, run async later, but for your current build you can:

compute once on “Generate Portfolio”

recompute only when top sensitivity variables change

Trigger recalculation when any of these change:

tickets, margin, labor cost, realization factors, ramp curve, investment

9️⃣ What Phase 3 Adds (real business value)

You stop defending single ROI numbers

You can say: “94% chance this stays ROI-positive”

You can show payback probability bands

It makes your engine feel like real strategy, not marketing