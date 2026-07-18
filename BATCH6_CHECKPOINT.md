# MARQ Cortex — Stabilization Batch 6 Checkpoint

Final stabilization batch. Branch: `claude/marq-cortex-batch-6`.
Baseline commit: `b25233a0` (== origin/main, Batches 1–5 + cleanup PR #5 merged).

This file is the resume anchor. A resumed agent should read this + `git log` and
continue from the first unchecked task — do NOT restart Batch 6.

## Phase 0 — evidence-based dispositions (five candidate surfaces)

| Surface | Manifest was | Batch 6 disposition | Evidence |
|---|---|---|---|
| AIAssistant (COMP-049) | DEMO | **LIVE** | Deterministic static diagnostic-help; no LLM, no API, no fabricated authoritative data. Works end-to-end. |
| InlineAITrigger (COMP-050) | DEMO | **LIVE** | Pure delegator → `GlobalAIChatContext.openChat`; GlobalAIChat is gateway-wired (`chatWithAI` → `/ai/chat`, feature `chat`) with demo-safe `getMockResponse`. |
| LearningLoopPanel (COMP-061) | GATED | **LIVE** | Already wired: `getLearningLoop` (dataService→api→`GET /cortex/learning-loop`). Endpoint is deterministic read-only outcome aggregation, `isEmpty` state, demo returns `isEmpty:true` (no fabrication). No autonomous rule/prompt changes. |
| ABTestingPanel (COMP-059) | GATED | **DEMO (honest)** | Client-local `localStorage` email queue + `Math.random()` variant assignment; no server persistence, deterministic bucketing, exposure/outcome events, or significance. Honest empty state. Real experiment platform = DEFERRED. |
| CRMSyncPanel (COMP-067) | GATED | **GATED (honest)** | `crmEngine` local deal derivation only; NO fetch/backend/connector; `lastSynced` was a cosmetic client clock. Keep gated; add honest "not connected to external CRM" labeling; document activation prerequisites. |

Note: manifest notes claiming these were "not exposed in navigation" are STALE — all
are mounted in LIVE parents (ABTesting in EmailNurturePanel, LearningLoop in
CortexDashboard, CRMSync in ProposalDraftEditor).

## Workstream tasks

- [x] WS1 — AIAssistant + InlineAITrigger → LIVE (deterministic/delegator, verified); manifest notes + dependency edges corrected. (No unit test: JSX components can't load under the Node strip-types runner and behavior is trivial deterministic UI / pure delegation — documented instead.)
- [x] WS1b — LearningLoopPanel → LIVE (already wired). Extracted deterministic aggregation into `learningLoop.ts`; endpoint refactored to call it; 10 tests added (tests/features/learningLoop.test.ts). Manifest COMP-061 GATED→LIVE + new SVC-019.
- [ ] WS2 — ABTestingPanel: keep DEMO honest; document real-experiment prerequisites (no invented backend).
- [ ] WS4 — CRMSyncPanel: keep GATED honest; remove fabricated-sync implication (honest labeling); document connector prerequisites.
- [ ] WS5 — Storage authority/SQL cutover: KV authoritative, SQL=No, shadow reads disabled. Document; NO cutover.
- [ ] WS6 — Feature flags/env: fail-closed audit; no secrets in Vite; GATED stays inaccessible where prereqs absent.
- [ ] WS7 — Focused security verification (auth, tenant, validation, secrets, CORS, prompt-injection/fact-lock). Fix only launch blockers.
- [ ] WS8 — Observability inventory (structured logs, gateway telemetry, health). Document what exists / is missing.
- [ ] WS9 — Deployment path validation + go-live checklist grounded in repo reality (no live deploy claimed).
- [ ] WS10 — Final manifest + docs reconciliation; run all suites + build; commit/push. Do NOT merge / open PR.

## Governance invariants (unchanged)
- All model generation routes through the Intelligence Gateway (provider-independent).
- LLM may only rewrite/explain/summarize/classify narrative — never authoritatively
  compute scores, prices, ROI, confidence, severity, outcomes, workflow, permissions.
- Deterministic engines + persisted data remain the source of truth.
- No fabricated integrations, analytics, or successful states.

## Progress log
(append per checkpoint)
