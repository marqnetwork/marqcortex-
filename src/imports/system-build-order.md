SYSTEM BUILD ORDER (Non-Negotiable)
1️⃣ Define the Engine Layers (Separation of Concerns)

You must split your system into 4 modules:

Input Normalizer

Converts questionnaire answers into numeric metrics

Handles missing data

Outputs structured diagnostic object

Scoring Engine

Applies weighted formula

Returns severity scores per domain

Deterministic only

Decision Engine

Picks primary sprint

Calculates confidence

Handles tie logic + hybrid mode

Template Assembler

Injects sprint JSON template

Calculates KPIs

Calculates ROI projection

Generates final recommendation payload

UI reads only the final payload.

DATA CONTRACT (Lock This)

All engines pass this object:

{
  "diagnostics": {},
  "scores": {},
  "selected_core_problem": "",
  "confidence_score": 0,
  "sprint_template_id": "",
  "financial_projection": {},
  "recommendation_payload": {}
}

No UI logic outside this structure.

FOLDER STRUCTURE (Even If Still Figma)

When you move to code:

/core
  scoringEngine.js
  decisionEngine.js
  confidenceEngine.js
  projectionEngine.js

/templates
  automationSprint.json
  inventorySprint.json
  retentionSprint.json

/api
  generateRecommendation.js

You are building a system, not a page.

CRITICAL PRODUCT RULE

Never let the LLM decide priority.
LLM only explains decisions.
Math decides priority.

This keeps enterprise credibility.