# ACTIVE WORK — MARQ Cortex

> AI OS tracking doc. Upstream source of truth for sprint numbering is
> `MARQ_CORTEX_ROADMAP.md.txt` at the repo root. This file records the
> **current active batch** only.

## Current Batch

**Stabilization Batch 2 — Shadow Read & Backend Cutover Preparation**

Status: ✅ Complete (code + validation harness). Awaiting operational
live-observation before Phase 5 SQL cutover.

Branch: `claude/marq-cortex-batch-2-37n7pe`

### Scope (S7.4 → S7.8)

Introduce a controlled **Shadow Read** path so backend (SQL) responses can be
validated against the current authoritative client behavior (KV) *before* any
production cutover — with zero change to what callers observe.

| Sprint | Name | Result |
|--------|------|--------|
| S7.4 | Outcome Shadow Read | ✅ Implemented + wired (`GET /submissions/:id/outcome`) |
| S7.5 | Outcome Validation | ✅ Drift + no-regression tests green |
| S7.6 | Lead Shadow Read | ✅ Implemented + wired (`POST /leads/exit-intent`) |
| S7.7 | Submission Shadow Read | ✅ Implemented + wired (`GET /submissions/:id`) |
| S7.8 | Full Runtime Validation | ✅ Harness green (72 tests); live observation pending flag enablement |

### What shipped

- **Runtime Storage Gateway** (`supabase/functions/server/runtime/`): a reusable
  `shadowRead` primitive that returns the KV authority value unchanged and,
  only when its per-domain flag is on, additionally reads the SQL repository,
  compares the two via domain projectors, and emits drift telemetry.
- Wired into the three read surfaces above. Default **OFF** for every domain.
- Node-runnable validation suite (`tests/runtime/shadowRead.test.ts`).

### Guardrails honored

- Demo implementations untouched; no feature flags removed.
- No architecture redesign, no new product features.
- Backend reads cannot regress the response: shadow path is best-effort,
  flag-gated OFF, and swallows its own errors.

## Next (not started — do NOT begin without approval)

Batch 3 / Phase 5 — SQL Read Rollout (S8.x). Blocked on live shadow-read
observation confirming zero drift with `SHADOW_READ_*` enabled against a
deployed Supabase environment.
