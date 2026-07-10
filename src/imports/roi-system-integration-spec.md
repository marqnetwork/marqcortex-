VERSION SYSTEM INTEGRATION SPEC

roi_engine_v1_conservative

1️⃣ Trigger Rule (When ROI Must Recalculate)

ROI must auto-run when any of these change:

A) Assumptions

labor_cost_per_hour

gross_margin_percent

monthly_revenue

support_tickets_per_week

any metric used in impact_profile

B) Recommendation Structure

impact_profile changes

investment estimate changes

dependency mapping changes

confidence_score changes

C) Constraints

max_roi_display_percent

confidence_floor_for_roi

If none of these changed → ROI must NOT recalc.

2️⃣ Change Detection Engine

When ChangeRequest applied:

System compares:

previous_version.inputs
current_version.inputs

And:

previous_version.outputs.recommendations
current_version.outputs.recommendations

If any ROI-relevant path changed → flag:

{
  "roi_recalc_required": true
}
3️⃣ Recalculation Order Binding

Once flagged:

Recalculation must run in strict order:

Scoring

Portfolio Ranking

Feasibility

Confidence

ROI

Cortex Narrative

Never reorder.

4️⃣ Version Creation Rules

Every ROI recalculation creates:

{
  "version": "vX",
  "previous_version": "vX-1",
  "delta_log": [...],
  "roi_recalculated": true,
  "roi_delta_summary": {
      "portfolio_roi_old": 240,
      "portfolio_roi_new": 275,
      "delta_percent": +35
  }
}

No overwrite allowed.

5️⃣ Delta Engine (Critical for Trust)

After recalculation:

Compute:

ROI delta %
Gain delta $
Payback delta months

Store inside version log.

This is what protects you from:
“Why did the ROI suddenly jump?”

6️⃣ Partial Failure Handling

If ROI fails:

{
  "status": "not_calculable",
  "reason": "missing_baseline"
}

Version must still be created.
But:

"roi_recalculated": false

And UI shows warning flag.

7️⃣ Lock Mechanism (For Proposal Export)

When team clicks “Approve Version”:

{
  "type": "ApproveVersion"
}

System marks:

"locked_for_export": true

Further edits require:
“Create new working version”

No silent changes after approval.

8️⃣ Revert Mechanism

Team can select previous version:

System clones it → creates new version.

Never restore in place.

9️⃣ Performance Safeguard

If multiple edits within 10 seconds:

Batch them into one recalculation cycle.

Prevents engine thrashing.

🔒 What You Have Now

You now have:

Deterministic ROI math

Controlled assumption editing

Version-safe recalculation

Delta transparency

Export locking

Revert capability

This is enterprise-grade governance.