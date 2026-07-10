Feasibility Scoring (Execution Reality Check)

Each recommendation gets:

{
  "technical_feasibility": 0-10,
  "data_readiness": 0-10,
  "organizational_readiness": 0-10,
  "change_complexity": 0-10
}

Then compute:

feasibility_score =
(technical_feasibility × 0.3) +
(data_readiness × 0.3) +
(organizational_readiness × 0.25) -
(change_complexity × 0.15)

If feasibility_score < 5 → flag as “High Execution Risk”.

2️⃣ Evidence Strength Layer

Every recommendation must list:

Number of signals detected

Cross-department validation count

Contradiction flags

Weak signal flags

Then:

evidence_strength_score =
(validated_signals × 0.4) +
(cross_validation × 0.3) -
(contradictions × 0.2) -
(weak_signals × 0.1)

Low evidence → reduce confidence.

3️⃣ Confidence Score (Final Authority Metric)
confidence_score =
(priority_score × 0.4) +
(feasibility_score × 0.3) +
(evidence_strength_score × 0.3)

Scaled 0–100.

This becomes visible in UI.

4️⃣ ROI Eligibility Gate

Before moving to ROI stage:

Recommendation must pass:

Has measurable baseline?

Has defined KPI?

Has timeline?

Has feasibility_score ≥ 5?

Has confidence_score ≥ 60?

If not → “ROI Not Calculable Yet.”

Prevents overpromising.

5️⃣ Version Locking

Every time chat modifies assumptions:

Recalculate feasibility

Recalculate priority

Recalculate confidence

Increment version

Never overwrite original.

Now your recommendation engine is:

✔ Ranked
✔ Feasible
✔ Evidence-backed
✔ Confidence-scored
✔ ROI-eligible