ROI DEPENDENCY VALIDATION SPEC

dependency_engine_v1

1️⃣ Dependency Model Structure

Each recommendation may declare:

{
  "recommendation_id": "R2",
  "depends_on": ["R1"],
  "dependency_type": "enables | enhances | requires"
}
Dependency Types

requires → cannot execute without parent

enables → child ROI invalid without parent

enhances → child ROI must exclude overlapping gain categories

2️⃣ Overlap Protection Rule (Critical)

Each recommendation must declare:

{
  "gain_categories": [
    "efficiency_support",
    "revenue_conversion",
    "cost_tooling"
  ]
}

Before portfolio aggregation:

System must validate:

No two recommendations may claim the same gain_category 
unless dependency_type = enhances

If overlap detected → child loses that gain category.

3️⃣ Enforcement Logic
Step 1: Build Dependency Graph

Directed graph:

R1 → R2 → R3
Step 2: Sort Execution Order

Topological order:
Parent first, child after.

Step 3: Apply Gain Validation

For each recommendation:

If depends_on exists:

Case A — requires

If parent not included:
→ child ROI = not_calculable

Case B — enables

Child revenue_gain valid only if parent efficiency_gain active.

If parent removed:
→ child revenue_gain = 0

Case C — enhances

Remove overlapping gain categories:

child.gain_categories - parent.gain_categories
4️⃣ Double Counting Prevention Algorithm

Pseudo logic:

Initialize claimed_gain_registry = []

For each recommendation in execution_order:
    For each gain_category:
        If gain_category already in registry:
            If dependency_type != enhances:
                Remove gain_category from this recommendation
        Add allowed gain_category to registry

This ensures:

No stacked efficiency claims

No duplicate revenue attribution

No cost reduction claimed twice

5️⃣ Cross-Recommendation Revenue Lock

Revenue gain may only be attributed once per causal chain.

If:

R1 improves response time
R2 improves conversion

Revenue uplift must be assigned to:

The recommendation directly tied to the KPI change.

Never both.

6️⃣ Portfolio Gain Calculation After Validation

Only after dependency cleanup:

Portfolio Gain = SUM(validated recommendation gains)

Never sum before cleanup.

7️⃣ Dependency Failure Handling

If dependency graph circular:

{
  "status": "invalid_dependency_graph",
  "error": "circular_dependency_detected"
}

Block ROI.

8️⃣ Visual Transparency (Team-Facing)

Each recommendation must show:

Dependency chain

Gain categories removed (if any)

Final validated gain

Reason for removal

This prevents internal confusion.

9️⃣ Edge Case Safeguard

If removing overlapping gains reduces ROI below confidence_floor:

Flag:

{
  "warning": "roi_reduced_due_to_overlap_validation"
}

Do not silently reduce.

🔒 System Guarantees After This

You now have:

Mathematical ROI integrity

Dependency-safe aggregation

No inflation stacking

Deterministic validation

Transparent audit trail

Your Team-Facing ROI system is now structurally complete and governance-safe.