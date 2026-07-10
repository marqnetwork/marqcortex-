SCENARIO MODELING SPEC

finance_v4_scenarios

1️⃣ Purpose

Give your team (and later clients) a one-click toggle:

Conservative

Expected

Aggressive

Each scenario changes only:

realization factors

ramp curve speed

confidence multiplier clamp (optional)

risk reduction factors (optional)

Everything else stays the same.

2️⃣ Scenario Presets (Locked Knobs)
A) Conservative

Efficiency realization: Low (0.35)

Cost realization: Low (0.50)

Revenue realization: Low (0.20)

Risk reduction: Low (0.15)

Ramp: slower (+1 month shift)

Confidence clamp: min(confidence, 80) (optional safety)

B) Expected

Efficiency: Mid (0.55)

Cost: Mid (0.70)

Revenue: Mid (0.35)

Risk: Mid (0.25)

Ramp: normal (0 shift)

Confidence clamp: none

C) Aggressive

Efficiency: High (0.75)

Cost: High (0.85)

Revenue: High (0.50)

Risk: High (0.40)

Ramp: faster (-1 month shift)

Confidence boost: none (never inflate confidence)

3️⃣ Scenario Application Order

Scenario is applied before ROI calculation, but after:

dependency validation

cost model

execution timeline build

So order becomes:

Dependency Validation

Cost Model

Cash Flow Timeline

Apply Scenario Knobs

ROI math

DCF

IRR

Monte Carlo (optional: run under selected scenario only)

4️⃣ Output Payload (Scenario Block)
{
  "finance_model_version": "finance_v4_scenarios",
  "active_scenario": "expected",
  "scenario_presets": {
    "conservative": {
      "realization_factors": { "efficiency": 0.35, "cost": 0.5, "revenue": 0.2, "risk": 0.15 },
      "ramp_shift_months": 1,
      "confidence_clamp_max": 80
    },
    "expected": {
      "realization_factors": { "efficiency": 0.55, "cost": 0.7, "revenue": 0.35, "risk": 0.25 },
      "ramp_shift_months": 0,
      "confidence_clamp_max": null
    },
    "aggressive": {
      "realization_factors": { "efficiency": 0.75, "cost": 0.85, "revenue": 0.5, "risk": 0.4 },
      "ramp_shift_months": -1,
      "confidence_clamp_max": null
    }
  },
  "scenario_outputs": {
    "conservative": {
      "roi_percent": 140,
      "npv": 110000,
      "payback_month": 7
    },
    "expected": {
      "roi_percent": 240,
      "npv": 165000,
      "payback_month": 5
    },
    "aggressive": {
      "roi_percent": 320,
      "npv": 210000,
      "payback_month": 4
    }
  },
  "notes": [
    "Scenario modifies realization and ramp only",
    "Confidence score is not inflated by scenario"
  ]
}
5️⃣ Governance Rules

Scenario must never change baselines or assumptions.

Scenario must never increase confidence.

Scenario must respect ROI cap for display (if you keep that cap internally).

Scenario selection must be stored in version history.

Trigger version bump when scenario changes.

6️⃣ What Phase 4 Completes

Now you have:

ROI %

Payback

Cashflow timeline

NPV (DCF)

IRR

Monte Carlo distribution

Scenario presets for exec control

That’s “big consulting firm” level finance tooling.