Scope Baseline Lock

When execution is created:

Store immutable scope reference from snapshot:

{
  "execution_id": "EX-001",
  "scope_baseline": {
    "included_workstreams": [...],
    "included_integrations": [...],
    "included_features": [...],
    "excluded_items": [...],
    "timeline_weeks": 12,
    "investment_total": 85000
  },
  "baseline_hash": "sha256"
}

This becomes comparison anchor.

STEP 2 — Scope Drift Detection Layer

Engine monitors changes in:

New workstream added

Workstream duration extended

New integration added

Feature added not in baseline

Task count increase > threshold

Timeline extended

Cost changed

If detected:

{
  "scope_drift_detected": true,
  "drift_type": "integration_addition",
  "change_order_required": true,
  "execution_status": "paused_for_review"
}

Execution cannot proceed until resolved.

STEP 3 — Change Order Object

When drift detected:

Auto-generate structured change object:

{
  "change_order_id": "CO-001",
  "execution_id": "EX-001",
  "reason": "New ERP integration requested",
  "impact_analysis": {
    "additional_weeks": 3,
    "additional_cost": 18000,
    "roi_adjustment_required": true
  },
  "status": "draft"
}

No manual writing needed.

STEP 4 — Change Order Flow

Flow:

Draft
→ Internal review
→ Client approval
→ Snapshot extension
→ Execution update

If approved:

Update execution version

Recalculate ROI projection

Update timeline

Increment version

If rejected:

Revert change attempt

STEP 5 — ROI Protection Hook

If change order approved:

Trigger:

{
  "roi_recalc_required": true,
  "new_baseline_version": 2
}

New projected ROI generated based on updated scope.

Old ROI preserved historically.

STEP 6 — Hard Guardrails

Cannot:

Add integration silently

Extend timeline silently

Add agent silently

Add automation silently

Modify baseline without change order

System blocks commit until change order created.

STEP 7 — Execution Versioning

Execution now has:

{
  "execution_version": 1,
  "linked_snapshot_version": 1
}

If change order approved:

execution_version += 1

Full traceability preserved.

STEP 8 — UI Behavior

When team attempts scope expansion:

Popup:

“This change is outside signed scope.
Create change order?”

Buttons:

Create CO

Cancel change

No silent edits allowed.

SCOPE ENGINE COMPLETE WHEN:

All drift types detectable

Change orders auto-generated

ROI recalculation triggered

Execution version increments

Baseline preserved