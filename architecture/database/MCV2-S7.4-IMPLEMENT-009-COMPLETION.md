# MCV2-S7.4-IMPLEMENT-009 — Completion Report

**Sprint:** `MCV2-S7.4-IMPLEMENT-009` — Outcome Shadow-Read Implementation
**Date:** 2026-07-27
**Status:** **IN PROGRESS (remediation).** Engineering + audit remediation complete and offline-validated; live shadow validation (S7.5) deferred. This sprint remains **in progress** until the focused validation below is accepted.

> This document supersedes the pre-audit completion note. Gaps **G1, G3, G4, G6**
> from the approved S7.4 audit are remediated here. See
> `MCV2-S7.4-REMEDIATION-G1-G3-G4-G6.md` for the gap-by-gap evidence.

---

## Executive Summary

The Outcome read path (`GET /make-server-324f4fbe/submissions/:id/outcome`) now
reads KV → returns the authoritative KV value → (only when explicitly enabled)
**schedules** a bounded SQL shadow read that normalizes, compares, and records
durable telemetry **after** the response has been sent. KV remains the sole
runtime authority; SQL is never returned to users; there is no fallback and no
SQL-primary path. Shadow is **disabled by default**, gated by a kill switch,
Outcome-only, and fails closed.

## Runtime Behaviour (post-remediation)

1. KV read once → captured as the authoritative response (unchanged envelope
   `{ success: true, outcome }`).
2. If — and only if — `STORAGE_SHADOW_OUTCOME_ENABLED=true`, the kill switch is
   off, a SQL port is wired, and the effective org resolves, a shadow task is
   handed to `EdgeRuntime.waitUntil` (fallback: detached task). **The response
   never awaits it (G1).**
3. The shadow task reads one SQL row (hard timeout), projects it via
   `projectOutcomeRecord`, classifies against KV, emits one telemetry event, and
   durably aggregates the result. Any failure is swallowed.

## Classification (G3)

Canonical, mutually-exclusive statuses: **`match`, `mismatch`, `partial`,
`missing_sql`, `missing_kv`, `skipped`, `error`**. `partial` is distinct: the
SQL row exists but a field KV has populated is null/absent in SQL — an
incomplete SQL row is **never** classified as `match`. Precedence when both rows
exist: authorization conflict → value conflict (`mismatch`) → `partial` →
`match`. Full spec: `MCV2-S7.4-OUTCOME-COMPARISON-SPEC.md`.

## Non-blocking Execution (G1)

`storage/scheduler.ts` prefers `EdgeRuntime.waitUntil(promise)` (Supabase Edge)
so the shadow runs post-response; where unavailable it falls back to a detached
task. `schedule()` returns synchronously and a scheduled task's rejection can
never surface to the response path. Shadow latency and failures are decoupled
from the KV response.

## Durable Telemetry (G4)

`storage/durableTelemetry.ts` + migration
`20260727090000_shadow_read_telemetry.sql`: a single Supabase table
(`shadow_read_telemetry`) with an **atomic upsert-increment RPC**
(`record_shadow_read_telemetry`) keyed by `(domain, status, mismatch_fields)`.
It records `occurrence_count`, `first_observed_at`, `last_observed_at` — restart
safe and cross-instance. The write is deferred to the scheduler (non-blocking);
structured logs are always retained as fallback evidence. This **reuses** the
repository/service-client pattern — there is no second telemetry architecture.
Retention/concurrency: `MCV2-S7.4-DURABLE-TELEMETRY.md`.

## Route & Wiring Coverage (G6)

`storage/outcomeRoute.ts` extracts a directly-testable `handleGetOutcome`
handler; `index.tsx` wires it via a lazy gateway. `projectOutcomeRecord` is
tested directly. Integration tests cover flag-disabled, match, partial,
mismatch, missing SQL row, SQL error, unchanged authoritative KV response, and
non-blocking scheduling.

## Configuration

`storage/config.ts` — `STORAGE_SHADOW_OUTCOME_ENABLED` (default false),
`STORAGE_FORCE_KV_ONLY` (kill switch), `STORAGE_SHADOW_OUTCOME_ORG_ALLOWLIST`,
`STORAGE_SHADOW_DEFAULT_ORG_ID`, `STORAGE_SHADOW_SQL_TIMEOUT_MS` (default 250,
cap 2000), `STORAGE_ENVIRONMENT`. Invalid/missing → disabled. Server-side only.

## Tests and Commands

| Command | Result |
|---------|--------|
| `npm run test:storage` | **36/36** (scheduler 9 · compare/projection 13 · durable telemetry 7 · route/wiring 9 — counts approximate per-file) |
| `npm run test:database` | 19/19 |
| `npm run test:intelligence` | 8/8 |
| `npm run test:features` | 48/48 |
| `npm run test:migration` | 30/31 — 1 **pre-existing** failure (`engine.test.ts`: `@supabase/supabase-js` bare import unresolvable under Node strip-types; fails on clean `main`, unrelated to S7.4) |
| `npm run build` | Passes |
| `deno check storage/*.ts` (pure modules) | Passes (14 modules) |

Deno type-check of the two Deno-only runtime bridges
(`runtimeSqlOutcome.ts`, `runtimeShadowTelemetry.ts`) requires network access to
`jsr:@supabase/supabase-js`, blocked in this offline environment (403) — the
same limitation as the existing `repositories/repositoryClient.ts`. Both bridges
are lazy fail-safe wrappers following that established pattern.

## Files

See `MCV2-S7.4-REMEDIATION-G1-G3-G4-G6.md` → "Files changed".

## KV Authority Status
KV authoritative — `returnedSource=kv`, `result.data` is always the KV value.

## SQL Returned to Users
never.

## Frontend / API Impact
none (response envelope byte-identical when disabled and when enabled).

## Live Validation Status
Deferred to **S7.5** — no Supabase service-role/network in this environment.
Fully mock/offline tested. Live validation requires backfilled `outcomes.value`,
service-role creds, and `STORAGE_SHADOW_DEFAULT_ORG_ID`.

## Constitution Compliance
KV authority preserved; no unauthorized cutover; provider/storage not leaked to
business logic (routes see `ReadResult`, never SQL); RLS/tenant scope enforced
via mandatory org; one storage routing source of truth; rollback + telemetry
documented; scope held to Outcome.

## Risks / Unverified
- Live SQL comparison against real backfilled data (S7.5).
- Production `EdgeRuntime.waitUntil` semantics under real network.
- `outcomes.value` backfill not yet implemented → live shadow will mostly report
  `missing_sql`/`partial` until backfill runs (expected, low severity).

## Recommended Next Sprint
**S7.5 — live Outcome shadow validation** (staging, internal, allowlisted org),
once this remediation's focused validation is accepted and backfill/service-role
capability are available. **Do not begin automatically.**

---

*End of completion report.*
