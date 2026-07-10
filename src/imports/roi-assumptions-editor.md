ROI Assumptions Editor Architecture

You need a dedicated section under ROI called:

“Financial Assumptions (Editable)”

This becomes the only place team members can change numbers that affect ROI.

1️⃣ Assumption Table Structure

Each assumption row must include:

Variable Name

Current Value

Editable Field

Source (User / Estimated / Confirmed)

Sensitivity Level (High / Medium / Low)

Last Updated (Version ref)

Example layout:

support_tickets_per_week      350     [edit]   Estimated   High     v2
labor_cost_per_hour           22      [edit]   Confirmed   Medium   v2
gross_margin_percent          42      [edit]   Estimated   High     v1
monthly_revenue               250000  [edit]   Confirmed   Medium   v1
2️⃣ Validation Rules (Hard Logic)

When edited:

Percent must be 0–100

Revenue must be positive

No negative ticket counts

No unrealistic margin above 90%

No silent correction

If invalid → block recalculation.

3️⃣ Edit → ChangeRequest Trigger

When someone edits a value:

System must automatically generate:

{
  "type": "UpdateAssumption",
  "changes": [...]
}

Then trigger full recalculation pipeline.

4️⃣ Sensitivity Preview (Before Apply)

Before recalculation, show:

“Changing support_tickets_per_week from 350 → 420 may increase portfolio ROI by ~12–18%.”

This prevents blind edits.

5️⃣ Audit Panel (Below Assumptions)

Show:

What changed

Who changed it

What version created

ROI delta

No silent moves.

🚀 Why This Is The Correct Next Step

Because:

ROI math exists

Display exists

But control mechanism doesn’t

Without assumption governance, ROI becomes unstable.