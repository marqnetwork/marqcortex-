# MARQ Cortex — Stabilization

Demo → backend migration program. Each batch removes demo/mock/placeholder/gated
implementations and replaces them with the real backend **where a consumable
backend endpoint exists**. Where it does not, the feature is documented and left
untouched (no invented backend behavior).

Authoritative inventory: `src/system/manifest.ts`. Human projection:
`docs/ai/STABILIZATION_INVENTORY.md`.

## Definition of "migrated / LIVE" in this repo

A component is `LIVE` when it issues the real backend/service call in backend
mode (`BACKEND_INTEGRATION=true`). A flag-gated demo fallback for
`BACKEND_INTEGRATION=false` is permitted and expected — the global flag defaults
to `false` for demos/presentations. This matches the established precedent set by
already-LIVE nodes that retain demo fallbacks (`TeamHomeDashboard`,
`EmailNurturePanel`, `EngagementActivityFeed`).

A feature is complete only when frontend, backend, repository, validation, tests,
and documentation are all consistent.

## Batches

- **Batch 1 — COMPLETE.** (Prior work; merged to `main`.)
- **Batch 2 — COMPLETE.** (Prior work; merged to `main`.)
- **Batch 3 — this document.** Reconciled the remaining AI/analytics demo surface.

## Batch 3 (2026-07-18)

### Objective
Remove every remaining demo/mock/placeholder/gated implementation and replace it
with the real backend — where the backend exists.

### Method (PLAN → IMPLEMENT → VERIFY → REGRESSION → DOCUMENT → COMMIT → PUSH)
1. Built the authoritative inventory from `src/system/manifest.ts`: **13 DEMO + 3 GATED**.
2. Confirmed the backend AI services (copilotPatch, cortexAnalysis, cortexChat,
   cortexNarrative) all exist and are LIVE, and that `src/app/lib/api.ts` already
   exposes the matching client bindings.
3. Read each non-LIVE component's actual data path to determine its true state
   (already-wired vs. genuine mock vs. deterministic-local vs. no-backend).
4. Enumerated all Hono routes to prove which mocks have a consumable endpoint.

### Outcome
- **7 nodes reconciled to LIVE** — they already issue the real backend/service
  call in backend mode; only the manifest record was stale
  (COMP-046/047/048/052/053/057, SVC-002). See INVENTORY §A.
- **6 nodes left as DEMO** — no consumable backend endpoint for their data model
  (COMP-021/049/050/051/054/056). Documented in manifest notes + INVENTORY §B.
- **3 nodes left as GATED** — external prerequisites (COMP-059/061/067).
  Documented in INVENTORY §C.

### Key finding
The migratable frontend wiring for the AI/analytics slice was already implemented
during Batches 1–2; the `manifest.ts` status fields simply lagged behind the code.
The genuinely-unmigrated features are all blocked on **missing backend endpoints
or external prerequisites**, so per the Batch 3 rule they were documented and left
untouched rather than force-wired.

### Verification
- `vite build` — green.
- Intelligence tests (8), migration tests (36), database static tests (19) — all pass.
- Manifest validation (`runValidation`) — no new errors/warnings vs. baseline;
  zero LIVE→DEMO status-propagation warnings from the flips.

## Remaining risks before Batch 4
- The 6 DEMO + 3 GATED features require **new backend endpoints** (section-level
  proposal copilot, objection/reviewer persistence, revenue snapshot analytics)
  or **external configuration** (CRM credentials, data volume). These are backend
  build tasks, out of scope for a demo→backend swap.
- The 3 AI-chat LIVE nodes depend on `OPENAI_API_KEY` at deploy time; without it
  the intelligence gateway mock adapter answers (deterministic, safe, but not real
  LLM prose).
- End-to-end live verification against deployed Supabase edge functions was not
  performed in this environment; verification here is build + unit/static tests +
  manifest validation + code-path inspection.
- Pre-existing manifest lint items remain untouched (out of scope): `MQC-MIG-001`
  id format, and `backendRoute` warnings on repository-layer SVC nodes.
