# MCV2-S7.4-IMPLEMENT-009 — Completion Report

**Sprint:** `MCV2-S7.4-IMPLEMENT-009` — Outcome Shadow-Read Implementation
**Date:** 2026-07-14
**Status:** **Completed (engineering).** Live shadow validation deferred (environment capability).

- **Engineering:** Complete
- **Live shadow validation:** Deferred due to environment capability (no Supabase service-role/network in this offline env)

---

## Executive Summary

Implemented the first bounded SQL shadow read for the **Outcome** entity. Runtime behavior is: read KV → (if enabled & eligible) launch a bounded, background SQL read → normalize → compare → emit one non-blocking telemetry event → **always return the KV result**. KV remains authoritative; SQL is never returned to users; there is no fallback and no SQL-primary path. Shadow is **disabled by default**, gated by a kill switch, Outcome-only, and fails closed. All added SQL touchpoints are isolated behind an injected port so the pure/tested core (and the barrel) stay Supabase-free.

## Outcome SQL Adapter

`storage/sqlOutcomeAdapter.ts` — read-only, port-based (`OutcomeSqlPort`), mandatory `organizationId`, hard timeout (default 250 ms, cap 2000). The concrete service-role repository is wrapped by the **Deno-only** `storage/runtimeSqlOutcome.ts` (lazy + fail-safe; never imported by the barrel or tests). Service-role note: shadow execution is internal-only, protected by route auth + mandatory org scoping; no writes; no SQL upstream to the frontend.

## Normalization and Comparison

`storage/outcomeNormalize.ts` + `storage/outcomeCompare.ts` (pure, Node-testable). Canonical `OutcomeDTO` of business-critical fields; explicit ignored-field list (audit/migration/log metadata + KV denormalized snapshots). Comparison categories with precedence authorization > schema > missing > relationship > value: `match`, `normalization_only_match`, `source_missing`, `target_missing`, `value_mismatch`, `relationship_mismatch`, `authorization_mismatch` (critical), `schema_mismatch`, `error`. Field paths only — no raw values. Full spec: `MCV2-S7.4-OUTCOME-COMPARISON-SPEC.md`.

## Shadow Configuration

`storage/config.ts` (extended). Flags: `STORAGE_SHADOW_OUTCOME_ENABLED` (default false), `STORAGE_FORCE_KV_ONLY` (kill switch), `STORAGE_SHADOW_OUTCOME_ORG_ALLOWLIST`, `STORAGE_SHADOW_DEFAULT_ORG_ID`, `STORAGE_SHADOW_SQL_TIMEOUT_MS`, `STORAGE_ENVIRONMENT`. Invalid/missing → disabled. Server-side only; no frontend/request activation; Outcome-only (no flag activates other entities).

## Eligibility Rules

`resolveOutcomeShadowEligibility` requires: enabled · kill switch off · SQL port wired · effective org resolvable (`ctx.org ?? DEFAULT_ORG_ID`) · (allowlist empty or org allowlisted). Fails closed with a reason (`disabled`/`kill_switch`/`no_sql_port`/`no_org_scope`/`org_not_allowlisted`).

## Gateway Behavior

`storage/gateway.ts` `getOutcome` extended: KV read once → capture as authoritative → if eligible, launch background shadow (bounded SQL read + compare + one telemetry event) attached as `result.shadow` (never awaited by the route, guaranteed non-rejecting) → return KV. No duplicate KV read, no duplicate SQL read, no fallback, no source switching, no cross-tenant comparison. `getSubmission`/`listSubmissions` never shadow.

## Telemetry

One combined event per shadowed read via the existing sink boundary: `requestId`, `organizationId`, `entity`, `configuredMode=kv_primary_shadow_sql`, `returnedSource=kv`, `shadowAttempted`, `kvMs`, `sqlMs`, `comparisonOutcome`, `mismatchCount`, `mismatchSeverity`, `sqlErrorClass`, `environment`, `route`. No raw payload/PII (verified). Failure non-blocking (`safeEmit`). No duplicate emission (base event suppressed on the shadow path). No live telemetry table created.

## Tests and Commands

| Command | Result |
|---------|--------|
| `npm run test:storage` | **70/70** (14 S7.2 + 26 S7.3 validation + 30 S7.4 shadow) |
| `npm run test:database` | 19/19 |
| `npm run test:migration` | 36/36 |
| `npm run test:intelligence` | 8/8 |
| `npm run build` | Passes |

S7.4 tests cover: disabled-by-default, kill switch, ineligible org, eligible one-SQL-read, KV returned source, match, normalization-only, target/source missing, value/relationship/authorization mismatch, SQL timeout, repo error, telemetry error isolation, no duplicate KV/SQL read, no fallback, no SQL returned, tenant mismatch = critical, unsupported entity does not shadow, Outcome-only scope.

## Performance Findings

KV-only median 0.0035 ms; shadow-enabled median 0.0064 ms (user-path overhead ~0.003 ms) with a simulated 5 ms SQL latency — because the SQL read runs in the **background** and is not awaited by the response path. Well within the S7.3 latency budget. No duplicate reads.

## Files Created
- `supabase/functions/server/storage/outcomeNormalize.ts`
- `supabase/functions/server/storage/outcomeCompare.ts`
- `supabase/functions/server/storage/sqlOutcomeAdapter.ts`
- `supabase/functions/server/storage/runtimeSqlOutcome.ts` (Deno-only SQL bridge)
- `tests/storage/outcomeShadow.test.ts`
- `architecture/database/MCV2-S7.4-IMPLEMENT-009-COMPLETION.md` (this)
- `architecture/database/MCV2-S7.4-OUTCOME-COMPARISON-SPEC.md`
- `architecture/database/MCV2-S7.4-OUTCOME-SHADOW-ROLLOUT.md`
- `architecture/database/MCV2-S7.4-ROLLBACK-GUIDE.md`

## Files Modified
- `supabase/functions/server/storage/contracts.ts` — added shadow/comparison/port types; optional `ReadResult.shadow`; extended telemetry event.
- `supabase/functions/server/storage/config.ts` — Outcome shadow config + eligibility.
- `supabase/functions/server/storage/gateway.ts` — Outcome shadow path.
- `supabase/functions/server/storage/index.ts` — barrel exports + optional `sqlOutcomePort` wiring (no repository import).
- `supabase/functions/server/index.tsx` — pass lazy `createRuntimeOutcomeSqlPort()` to the gateway (2-line change; outcome route envelope unchanged).
- `tests/storage/validation.test.ts` — S7.3 SQL-protection assertions refined for the controlled S7.4 boundary.
- `ARCHITECT.md`, `architecture/system_map.json`, `MCV2-S3-MIGRATION-ROADMAP.md` — status/index.

## Runtime Impact

Outcome read path can now optionally perform a background SQL shadow read + telemetry when explicitly enabled. With defaults, behavior is identical to S7.2/S7.3 (KV-only). No other route changed.

## KV Authority Status
KV authoritative — `returnedSource=kv`, `result.data` is always the KV value.

## SQL Returned to Users
never.

## Frontend Impact
none.

## API Impact
none.

## Live Validation Status
Deferred — no Supabase service-role/network in this environment. Fully mock/offline tested (70/70). Live validation requires backfilled `outcomes.value`, service-role creds, and `STORAGE_SHADOW_DEFAULT_ORG_ID`.

## Constitution Compliance
KV authority preserved (Art. 4/17); no unauthorized cutover (Art. 12); provider/storage not leaked to business logic (Art. 2 analogue — routes see `ReadResult`, never SQL); RLS/tenant scope enforced via mandatory org (Art. 5); one storage routing source of truth; rollback + telemetry documented (Art. 9); scope held to Outcome (Art. 16).

## Risks
- Edge background execution is best-effort → telemetry capture may be partial in production (documented; future `waitUntil`).
- `outcomes.value` backfill mapping not yet implemented → live shadow will mostly report `target_missing` until backfill runs (expected, low severity).
- Service-role repository (RLS bypassed) → shadow must stay internal-only + org-scoped (enforced).

## Unverified Areas
- Live SQL comparison against real backfilled data.
- Production latency under real network + `waitUntil` semantics.

## Human Review Priority
1. Confirm background (non-awaited) shadow execution is acceptable vs a bounded-await variant.
2. Approve `STORAGE_SHADOW_DEFAULT_ORG_ID` as the tenant scope for the team outcome route shadow.
3. Sign-off before enabling live (backfill + reconciliation gate).

## Rollback
`MCV2-S7.4-ROLLBACK-GUIDE.md`: default is safe; kill switch (`STORAGE_FORCE_KV_ONLY=true`) forces KV-only with no deploy; unwire the port; or full `git revert`.

## Recommended Next Sprint
S7.5 — live Outcome shadow validation (staging, internal, allowlisted org) once backfill/reconciliation and service-role capability are available; then evaluate expanding shadow to the next entity per S7.3 exit gates. Do not begin automatically.

---

*End of completion report.*
