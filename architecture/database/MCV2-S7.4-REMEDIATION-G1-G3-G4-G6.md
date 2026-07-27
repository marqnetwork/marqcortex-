# MCV2-S7.4 — Audit Remediation (G1, G3, G4, G6)

**Sprint:** `MCV2-S7.4-IMPLEMENT-009` (remediation)
**Date:** 2026-07-27
**Status:** Remediation complete; S7.4 remains **in progress** pending validation sign-off.
**Scope guard:** KV is the sole runtime authority. No unrelated domains/routes
touched. S7.5 not started.

> **Superseded in part by `MCV2-S7.4-REMEDIATION-2`** (see the section at the end
> of this document). The follow-up audit found that the G3 fix below, while
> structurally correct, could not take effect: the shadow queried the wrong join
> axis, and the comparison diffed two incompatible status vocabularies. G3 is only
> genuinely satisfied after REMEDIATION-2.

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

## MCV2-S7.4-REMEDIATION-2 — post-audit correctness fixes (D1, D2, D3, D5)

**Date:** 2026-07-27
**Status:** S7.4 still **in progress**. Shadow still disabled by default. KV still
the sole runtime authority. S7.5 not started.

The follow-up audit accepted G1 and G4 but rejected the comparison path. Three
correctness defects meant the shadow could produce no usable data.

### D1 — wrong join axis (critical)

**Finding:** the shadow called `getOutcomeBySubmission(submissionId, org)` →
`.eq('submission_id', 'SUB-<ts>-<rand>')`. KV submission ids are TEXT
(`index.tsx`), but `outcomes.submission_id` is `UUID NOT NULL`. Every shadow read
would fail with Postgres `22P02 invalid input syntax for type uuid`, so 100% of
comparisons would have been `error`.

**Fix:** correlate on the only shared key, `legacy_kv_key = 'outcome:{submissionId}'`
(TEXT, with the dedicated `outcomes_legacy_kv_key_uidx`), via the existing
`getOutcomeByLegacyKey`. `OutcomeSqlPort` now exposes `getOutcomeByLegacyKey`
only; `outcomeLegacyKvKey()` is the single canonical key builder.

**Tenancy:** the legacy-key lookup is not tenant-scoped at the query level, so
`compareOutcome`'s authorization check is now the sole tenancy guard and **fails
closed** — the row's `organization_id` must equal the requesting org exactly.
Null/absent owner is a critical authorization mismatch (previously waved through).

### D2 — incompatible status vocabularies

**Finding:** SQL `outcomes.status` is a LIFECYCLE axis
(`NOT NULL DEFAULT 'open'`, `CHECK IN ('open','closed','archived')`) but was
diffed against a KV-derived CONVERSION status (`converted`/`lost`). Every
`closed`/`archived` row reported a false `mismatch` at severity **high**, even
with all business values agreeing.

**Fix:** the SQL lifecycle `status` column is no longer compared (added to
`OUTCOME_IGNORED_FIELDS`). Both sides now project one canonical
`conversionStatus` (`converted`/`lost`/`null`): KV from `didConvert`, SQL from
`outcome_type` ('won'→converted, 'lost'→lost) with a `value.didConvert` fallback.
`BUSINESS_FIELDS` replaces `status` with `conversionStatus`.

### D3 — incomplete rows misclassified as mismatch

**Finding:** because lifecycle `status` is `NOT NULL`, it was always "populated",
which forced conflict classification. An SQL row with absent/`null`/malformed/`{}`
`value` — i.e. an un-backfilled row — was reported as a high-severity `mismatch`
instead of `partial`. G3's central claim was therefore not met in practice.

**Fix:** with lifecycle status excluded and non-conversion `outcome_type` values
resolving to `null`, a row carrying no business data reads as unpopulated and
classifies as **`partial`** (severity low).

### D5 — schema-invalid test fixtures

**Finding:** both test suites used `status: 'converted'` on SQL fixtures — a value
the CHECK constraint forbids. That impossible fixture is precisely what let D2 and
D3 pass unnoticed.

**Fix:** fixtures now use only schema-valid values (`status` ∈
open/closed/archived; `outcome_type` ∈ engagement/won/lost/nurture/other) and a
UUID `submission_id` distinct from the KV id, mirroring production.

### Specification reconciliation

`MCV2-S7.4-OUTCOME-COMPARISON-SPEC.md` previously named `getOutcomeBySubmission`
in its Sources table while its normalization rules mandated `legacy_kv_key` — the
implementation followed the wrong half. The spec now names one canonical join
axis, documents the two status axes explicitly, and records the fail-closed
tenancy rule.

### Coverage added

`test:storage` 36 → **64**. New: legacy-key lookup assertion (the raw KV id must
never reach the SQL port, exercised with a realistic non-UUID id); all three
lifecycle statuses at both compare and route level; degenerate `value` shapes
(absent/null/string/number/`{}`/`[]`); missing comparable business fields;
genuine conversion conflict; `outcome_type` derivation and fallback; fail-closed
tenancy for null/absent `organization_id`; and prototype-chain keys in
`outcome_type` (`constructor`, `__proto__`, …) never resolving to a non-string.

### Validation

- `npm run test:storage` → **64/64**
- `npm run test:database` → 19/19 · `npm run test:features` → 48/48
- `npm run test:migration` → 30/31 — the single `engine.test.ts` failure is
  **pre-existing and environmental** (`@supabase/supabase-js` unresolvable; no
  `node_modules` in this environment). Reproduced identically on clean
  `origin/main`; no changed file is in its import chain.
- `tsc --strict` (es2022 + dom, no emit) → **clean** across all 14 pure storage
  modules; storage tests clean apart from absent `@types/node`. The Deno-only
  bridge's port↔repository contract was verified by type-checking an equivalent
  stub against the real `OutcomeRepository` interface.
- `npm run build` could **not** be run here (`vite` absent with no
  `node_modules`); it is a frontend-only build that does not compile
  `supabase/functions/server`, so it is unaffected by these changes.

### D7 — newly found: `scheduler.test.ts` is flaky (pre-existing, NOT fixed here)

Repeated execution exposed a non-deterministic failure in
`tests/storage/scheduler.test.ts`:

```
error: 'Unable to deserialize cloned data due to invalid or unsupported version.'
code: 'ERR_TEST_FAILURE'
```

This is a Node test-runner IPC/serialization failure, not an assertion failure.
`scheduler.test.ts` is the only storage test that mutates `globalThis`
(`g.EdgeRuntime = …`, `delete g.EdgeRuntime`, `delete g.waitUntil`), which is the
prime suspect.

Measured rates (30 runs each):

| Target | Failures |
|--------|----------|
| `scheduler.test.ts` on pristine `17a93618` (pre-REMEDIATION-2) | 10 / 30 |
| `scheduler.test.ts` on this branch | 13 / 30 |
| `outcomeCompare.test.ts` (changed here) | **0 / 30** |
| `outcomeRoute.test.ts` (changed here) | **0 / 30** |
| `durableTelemetry.test.ts` (untouched) | 0 / 30 |

**Pre-existing and unrelated to REMEDIATION-2:** neither `scheduler.ts` nor
`scheduler.test.ts` was modified by this task, and the flake reproduces at a
comparable rate on the pristine commit. The rate difference (10 vs 13) is
sampling noise on a ~35% base rate, not a regression signal. It was missed by the
first audit, which ran `test:storage` only once and happened to observe 36/36.

**Not fixed here** — out of the authorized D1/D2/D3/D5 scope, and it is test
infrastructure (the D6 class). It nevertheless **blocks S7.4 validation sign-off**:
a suite that fails ~1 run in 3 cannot certify anything. Fix before S7.5.

### Not addressed (deliberately out of scope)

**D4** (nested `waitUntil` registration may drop the durable telemetry write on
isolate shutdown), **D6** (no static test for the `shadow_read_telemetry`
migration/RPC contract; route wiring in `index.tsx` unverified by automation), and
**D7** above remain open and are prerequisites for enabling the shadow in S7.5.

---

*End of remediation report.*
