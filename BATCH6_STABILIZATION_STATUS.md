# MARQ Cortex — Stabilization Batch 6: Final Status & Production Readiness

Final stabilization batch. Branch `claude/marq-cortex-batch-6`, baseline `b25233a0`.
This document is the authoritative, evidence-grounded disposition of every remaining
surface plus the production-readiness posture. It is intentionally honest about what
is LIVE, what is intentionally gated/deferred, and what remains a manual/external
prerequisite. It does not claim any live Supabase/Vercel deployment was performed.

Legend: **LIVE** (works end-to-end, real data, no mock bypass) · **DEMO** (renders
on client-local/seed data, no backend authority) · **GATED** (safe, inert until an
external prerequisite is met) · **DEFERRED** (intentionally out of Batch 6 scope).

---

## 1. Remaining surface dispositions (WS1–WS4)

| Surface | Manifest ID | Was | Now | Disposition & evidence |
|---|---|---|---|---|
| AIAssistant | COMP-049 | DEMO | **LIVE** | Deterministic diagnostic help (keyword matcher + industry examples). No LLM, no API, no fabricated authoritative data. Nothing to gate. |
| InlineAITrigger | COMP-050 | DEMO | **LIVE** | Pure delegator → `GlobalAIChatContext.openChat`. Generation runs through gateway-wired GlobalAIChat (`chatWithAI` → `POST /ai/chat`, feature `chat`) with demo-safe fallback. Fabricates nothing. |
| LearningLoopPanel | COMP-061 | GATED | **LIVE** | Wired `getLearningLoop` → `GET /cortex/learning-loop`. Deterministic read-only outcome aggregation (extracted to `learningLoop.ts`, tested). `isEmpty` handled; demo returns isEmpty. No autonomous rule/prompt changes. |
| ABTestingPanel | COMP-059 | GATED | **DEMO** | Email subject-line A/B **distribution** aid in EmailNurturePanel. localStorage queue + `Math.random` assignment; honest empty state; **no** significance, LLM, or server store. Real experiment platform = **DEFERRED** (see §2). |
| CRMSyncPanel | COMP-067 | GATED | **GATED** | Local pipeline preview via crmEngine. **No** external connector/credentials. Relabelled "Local preview only — not connected to an external CRM"; "Sync"→"Refresh". Prerequisites in §2. |

Governance verification for the promotions: none of AIAssistant / InlineAITrigger /
LearningLoopPanel let an LLM compute scores, prices, ROI, confidence, severity,
outcomes, workflow, permissions, or decisions. AIAssistant + LearningLoop are purely
deterministic; InlineAITrigger only opens the gateway-routed chat.

---

## 2. Intentionally GATED / DEFERRED — exact activation prerequisites

### ABTestingPanel — DEFERRED to a real experiment platform
Currently a client-local email A/B *distribution* view. To become a production
experimentation feature it needs (none of which exist today, and none were invented):
- Server-persisted experiment + variant definitions (tenant-scoped).
- Deterministic, stable user/team bucketing (not `Math.random`).
- Exposure events + outcome events with idempotency.
- Tenant isolation + authorization on all experiment reads/writes.
- Start/end status, safe activation/deactivation, no retroactive assignment drift.
- Statistical significance evaluation — **must not** be computed by an LLM, and is
  not currently specified/approved, so it is intentionally not implemented.

### CRMSyncPanel — GATED on an external CRM contract
crmEngine derives a local pipeline view deterministically. Activation requires:
1. Approved provider (HubSpot/Salesforce) + connector contract.
2. Tenant-scoped credential storage server-side — never in the Vite bundle or logs.
3. Backend sync/upsert endpoints: idempotent upsert, retry/backoff, rate-limit handling.
4. Webhook signature verification.
5. Last-sync cursor/checkpoint, conflict handling, failure visibility, audit logging.
6. Manual reconnect/disconnect + safe disabled state when credentials are absent.

No fake connector was created (WS4 constraint honoured).

---

## 3. Storage authority & SQL cutover (WS5)
_See §5 below — filled during WS5._

## 4. Feature flags & configuration (WS6)
_Filled during WS6._

## 5. Security posture (WS7)
_Filled during WS7._

## 6. Observability & operations (WS8)
_Filled during WS8._

## 7. Deployment readiness & go-live checklist (WS9)
_Filled during WS9._
