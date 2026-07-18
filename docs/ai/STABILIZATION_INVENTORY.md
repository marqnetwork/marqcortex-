# MARQ Cortex — Stabilization Inventory

> Authoritative source of truth: `src/system/manifest.ts` (validated by `src/system/validate.ts`).
> This file is a human-readable projection of the demo/mock/gated surface as of **Batch 3**.

Last updated: **2026-07-18** (Stabilization Batch 3)

## Status legend

| Status | Meaning |
| ------ | ------- |
| `LIVE` | Issues the real backend/service call in backend mode (`BACKEND_INTEGRATION=true`). A flag-gated demo fallback for `BACKEND_INTEGRATION=false` is permitted and does **not** disqualify LIVE (precedent: `EmailNurturePanel`, `EngagementActivityFeed`, `TeamHomeDashboard`). |
| `DEMO` | Runs local mock/placeholder business logic even in backend mode — no real backend call. |
| `GATED` | Real (or deterministic) logic exists but is intentionally hidden behind a prerequisite not yet met (data volume, external credentials). |

## Backend service map (all LIVE)

| Node | Service | Backend route |
| ---- | ------- | ------------- |
| MQC-SVC-003 | blockAiAssist | `POST /blocks/ai-assist` |
| MQC-SVC-004 | copilotPatch | `POST /blocks/copilot-interpret` |
| MQC-SVC-005 | cortexAnalysis | `runCortexAnalysis` via `POST /submissions/:id/analyze`, `GET /submissions/:id/cortex` |
| MQC-SVC-006 | cortexChat | `POST /ai/chat` |
| MQC-SVC-007 | cortexNarrative | `POST /cortex/narrative` |
| MQC-SVC-008 | emailService | (Resend; wired via multiple email routes) |
| MQC-SVC-010 | intelligenceGateway | provider-agnostic AI gateway (OpenAI / mock adapters) |

Frontend API bindings (`src/app/lib/api.ts`): `chatWithAI`, `generateCortexNarrative`,
`blockAIAssist`, `copilotInterpret`, `getCortexAnalysis`, `analyzeSubmission`,
`getEngagementAnalytics`, `getOutcome`/`logOutcome`, `getProposal`/`saveProposal`/`sendProposal`.

---

## Batch 3 disposition of every non-LIVE node

### A. Migrated → LIVE (7) — already backend-wired; manifest reconciled in Batch 3

| Node | Component | Real path in backend mode |
| ---- | --------- | ------------------------- |
| MQC-COMP-046 | GlobalAIChat | `chatWithAI` → `POST /ai/chat` |
| MQC-COMP-047 | CortexChatPanel | `generateCortexNarrative` → `POST /cortex/narrative` |
| MQC-COMP-048 | CopilotPanel | `interpretRequest`/`applyPatchPlan` → `POST /blocks/copilot-interpret` |
| MQC-COMP-052 | CortexModulesNew | `getOutcome`/`logOutcome` → `GET/POST /submissions/:id/outcome` |
| MQC-COMP-053 | CortexProposalModule | `getProposal`/`saveProposal`/`sendProposal` → `GET/POST /submissions/:id/proposal` |
| MQC-COMP-057 | EngagementIntelligence | `getEngagementAnalytics` → `GET /analytics/engagement` |
| MQC-SVC-002 | cortexDataService | deterministic `generateCortexData` (submission → CortexLeadData); consumed live by CortexDashboard (MQC-COMP-044) |

Each keeps a flag-gated demo fallback for `BACKEND_INTEGRATION=false`. The four
KV/analytics-backed nodes (052, 053, 057, SVC-002) are deterministic. The three
AI nodes (046, 047, 048) require `OPENAI_API_KEY` for live prose; without it the
intelligence gateway's mock adapter answers — same key-dependency pattern as the
already-LIVE `EmailNurturePanel` (needs `RESEND_API_KEY`).

### B. Left as DEMO (6) — no consumable backend endpoint; documented, untouched

| Node | Component | Why not migrated |
| ---- | --------- | ---------------- |
| MQC-COMP-021 | ProposalSectionCopilot | `handleGenerate` always calls local `buildMockRevision`. Backend `copilotPatch` is **block-model**; this panel edits ProposalDraft **sections** and returns structured `{after, diff_summary, changed_fields, validation}`. No section-level endpoint exists. |
| MQC-COMP-049 | AIAssistant | `generateContextualHelp()` is a deterministic, rule-based local question-hint helper. No `/ai` contextual-help route exists. Intentionally local UX, not demo business logic. |
| MQC-COMP-050 | InlineAITrigger | Presentational trigger with no data path; opens GlobalAIChat (now LIVE). Nothing to migrate. |
| MQC-COMP-051 | ObjectionHandlerPanel | Output is deterministic and computed locally by `objectionEngine` (core rule: math decides). Escalation persists only in component state; no objection-persistence route exists. |
| MQC-COMP-054 | CortexReviewerModule | Checklist computed locally; submit only shows an alert ("In production, this saves to database"). No reviewer-decision persistence route exists. |
| MQC-COMP-056 | RevenueIntelligenceDashboard | Reads `MOCK_SNAPSHOTS` exclusively (ignores `accessToken`). Needs per-deal `AnalyticsSnapshot` rows; no snapshot-analytics endpoint exists (spec calls for nightly aggregation). |

### C. Left as GATED (3) — external prerequisite; documented, untouched

| Node | Component | Gate |
| ---- | --------- | ---- |
| MQC-COMP-059 | ABTestingPanel | Not exposed in navigation; requires sufficient proposal-variant data volume. |
| MQC-COMP-061 | LearningLoopPanel | Requires ≥ 50 closed submissions to produce a meaningful feedback signal. |
| MQC-COMP-067 | CRMSyncPanel | Requires external CRM API credentials (HubSpot/Salesforce) + a backend webhook endpoint that is not yet wired. |

---

## Summary counts

| Status | Before Batch 3 | After Batch 3 |
| ------ | -------------- | ------------- |
| DEMO   | 13 | 6 |
| GATED  | 3  | 3 |
| LIVE (COMP/SVC AI+analytics slice) | — | +7 |

No production feature that has a consumable backend endpoint still depends on
demo/mock business logic. The remaining 6 DEMO + 3 GATED nodes are blocked on
**missing backend endpoints or external prerequisites**, not on frontend wiring.
