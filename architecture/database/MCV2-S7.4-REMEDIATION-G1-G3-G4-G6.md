# MCV2-S7.4 — Audit Remediation (G1, G3, G4, G6)

**Sprint:** `MCV2-S7.4-IMPLEMENT-009` (remediation)
**Date:** 2026-07-27
**Status:** Remediation complete; S7.4 remains **in progress** pending validation sign-off.
**Scope guard:** KV is the sole runtime authority. No unrelated domains/routes
touched. S7.5 not started.

---

## Gap G1 — Non-blocking execution

**Finding:** the shadow SQL read was coupled to the read path, so shadow latency
could extend (or its lifetime tie to) the authoritative KV response.

**Fix:**
- New `storage/scheduler.ts` — a `BackgroundScheduler` that prefers
  `EdgeRuntime.waitUntil(promise)` (Supabase Edge) to run the shadow work
  **after** the response is flushed, with a **detached-task fallback** where
  `waitUntil` is unavailable (Node/local/older runtimes).
- `storage/gateway.ts` now hands the shadow task to the scheduler instead of
  attaching an awaited promise; `getOutcome` returns immediately with
  `shadowStatus: 'scheduled' | 'skipped'`.
- Guarantees: `schedule()` returns synchronously; a scheduled task's rejection
  is always caught, so **shadow failures can never affect the KV response**.

**Tests:** `tests/storage/scheduler.test.ts` — waitUntil handoff (not awaited
inline), synchronous return / non-blocking, fallback path, sync-throw and
async-reject isolation, runtime auto-detection.

---

## Gap G3 — Partial classification

**Finding:** no distinct status for an incomplete SQL row; such rows risked being
scored as `match` or lumped into a generic mismatch.

**Fix:**
- `storage/contracts.ts` — canonical, mutually-exclusive `ComparisonStatus`:
  `match`, `mismatch`, `partial`, `missing_sql`, `missing_kv`, `skipped`,
  `error`.
- `storage/outcomeCompare.ts` — rewritten classifier. A field where KV is
  populated and SQL is null/absent is a **partial** field; a field populated on
  both sides but differing is a **conflict**. Precedence: authorization conflict
  → `mismatch` (value conflict) → `partial` → `match`. An incomplete SQL row is
  **never** `match`.
- `storage/outcomeNormalize.ts` — exposes `projectOutcomeRecord` (the SQL→DTO
  mapping) as the single, directly-tested projection.

**Tests:** `tests/storage/outcomeCompare.test.ts` — fully populated (match),
partially populated (partial, asserted ≠ match), conflicting (mismatch),
mismatch-over-partial precedence, missing_sql, missing_kv, cross-tenant
(critical mismatch), error; plus `projectOutcomeRecord` direct mapping tests and
a "no raw values leak" assertion.

---

## Gap G4 — Durable telemetry

**Finding:** telemetry was in-memory only — lost on cold start, not aggregatable
across edge instances.

**Fix (smallest repository-consistent durable sink):**
- Migration `supabase/migrations/20260727090000_shadow_read_telemetry.sql` —
  one table `shadow_read_telemetry` and an **atomic** `record_shadow_read_telemetry`
  RPC (`INSERT … ON CONFLICT (domain, status, mismatch_fields) DO UPDATE SET
  occurrence_count = occurrence_count + 1, last_observed_at = now()`), plus
  rollback. Minimum data: **domain, status, mismatch fields, occurrence_count,
  first_observed_at, last_observed_at**.
- `storage/durableTelemetry.ts` — pure sink that logs structured fallback
  evidence first, then **defers** the durable write to the scheduler (never
  blocks the response or shadow read). Repository failures are swallowed by the
  scheduler. Reuses the existing repository/service-client pattern — **no second
  telemetry architecture**.
- `storage/runtimeShadowTelemetry.ts` — Deno-only bridge calling the RPC via the
  service client (lazy, fail-safe), following the existing repository pattern.
- Retention & concurrency documented in `MCV2-S7.4-DURABLE-TELEMETRY.md`.

**Tests:** `tests/storage/durableTelemetry.test.ts` — count + first/last
aggregation, distinct-key rows, order-independent field folding, deferred write,
repository-failure isolation, non-shadow events ignored, durable-disabled logs-only.

---

## Gap G6 — Route & wiring integration coverage

**Finding:** the real Outcome GET route and runtime wiring were untested;
`projectOutcomeRecord` had no direct coverage.

**Fix:**
- `storage/outcomeRoute.ts` — extracts a directly-testable `handleGetOutcome`
  that produces the byte-identical `{ success: true, outcome }` envelope and
  schedules the shadow.
- `supabase/functions/server/index.tsx` — the real route now calls
  `handleGetOutcome` over a lazy runtime gateway (KV, runtime SQL port, durable
  telemetry sink, scheduler). Default behaviour (shadow disabled) is unchanged.

**Tests:** `tests/storage/outcomeRoute.test.ts` — flag disabled (no schedule,
KV response), non-blocking scheduling (response before shadow runs), match,
partial, mismatch, missing SQL row, SQL error, unchanged authoritative KV
response (incl. null), and "SQL never surfaced". `projectOutcomeRecord` is
covered directly in `outcomeCompare.test.ts`.

---

## Files changed

**Added — storage subsystem** (`supabase/functions/server/storage/`):
`contracts.ts`, `config.ts`, `kvParse.ts`, `kvAdapter.ts`, `context.ts`,
`telemetry.ts`, `scheduler.ts` (G1), `durableTelemetry.ts` (G4),
`outcomeNormalize.ts` (incl. `projectOutcomeRecord`), `outcomeCompare.ts` (G3),
`sqlOutcomeAdapter.ts`, `gateway.ts`, `outcomeRoute.ts` (G6), `index.ts`,
`runtimeSqlOutcome.ts` (Deno-only), `runtimeShadowTelemetry.ts` (Deno-only).

**Added — tests** (`tests/storage/`): `scheduler.test.ts`,
`outcomeCompare.test.ts`, `durableTelemetry.test.ts`, `outcomeRoute.test.ts`.

**Added — migration:** `supabase/migrations/20260727090000_shadow_read_telemetry.sql`
and `supabase/migrations/rollbacks/20260727090000_rollback_shadow_read_telemetry.sql`.

**Added — docs:** this file, `MCV2-S7.4-IMPLEMENT-009-COMPLETION.md`,
`MCV2-S7.4-OUTCOME-COMPARISON-SPEC.md`, `MCV2-S7.4-DURABLE-TELEMETRY.md`.

**Modified:** `supabase/functions/server/index.tsx` (outcome route wiring +
lazy gateway), `package.json` (`test:storage` script).

---

## Validation evidence

- `npm run test:storage` → 36/36 pass.
- `npm run test:database` → 19/19; `npm run test:intelligence` → 8/8;
  `npm run test:features` → 48/48.
- `npm run test:migration` → 30/31 (the single failure, `engine.test.ts`, is
  **pre-existing** on clean `main`: `@supabase/supabase-js` bare import
  unresolvable under Node `--experimental-strip-types`; unrelated to S7.4 — not
  hidden).
- `npm run build` → passes.
- `deno check` → passes for all 14 pure storage modules. The two Deno-only
  Supabase bridges cannot be type-checked offline (jsr 403), same limitation as
  the existing repository client.

---

*End of remediation report.*
