# MCV2-S7.3 — Shadow-Read Readiness Plan

**Sprint:** `MCV2-S7.3-VALIDATE-008` (plan only — **shadow reads NOT implemented**)
**Next sprint:** S7.4 (shadow-read implementation) — do not start automatically.
**Precondition:** KV authoritative; Phase 1 gateway validated (this sprint).

This plan defines exactly what the first shadow-read sprint must build. It does not add a SQL adapter, comparison, or fallback.

---

## Recommended first shadow-read entity — **Outcome** (`GET /submissions/:id/outcome`)

Chosen from actual runtime evidence (S7.1 dependency map + S7.2 migration):

| Factor | Outcome | Why it wins |
|--------|---------|-------------|
| KV↔SQL mapping | 1:1 (`outcome:{submissionId}` → `outcomes`) | simplest normalization |
| SQL repo readiness | `OutcomeRepository.getOutcomeBySubmission` + `getOutcomeByLegacyKey` exist (S5) | no new repo work |
| Blast radius | team-only read, single record, small payload | lowest risk |
| Already gatewayed | `GET /submissions/:id/outcome` uses the gateway in Phase 1 | wiring already in place |
| Not client-facing | no client-portal isolation concern | avoids Art. 8 escalation first |

Submission (single/list) and the derived report are explicitly **deferred** behind Outcome (submission is core/high-risk; report has no KV source key and needs normalization design — S7.1).

---

## SQL adapter boundary

- New `storage/sqlAdapter.ts` implementing `SqlDiagnosticAdapter` (contract already defined in S7.1 architecture, not in Phase 1 contracts).
- Wraps the existing `OutcomeRepository` **read-only**; injects `organizationId` (server-resolved) into every call.
- No writes. Never imported by the KV path. Constructed only when an entity's active mode ≠ `kv_only`.
- Deno-runtime only (imports `jsr:`/repositories) — kept out of the Node-testable pure core; unit-tested via an injected fake repo, mirroring the KV port pattern.

## Comparison DTO

- `OutcomeDTO` canonical shape (normalize KV blob and SQL row into it) in `storage/dto.ts` + `storage/normalize.ts`.
- Ignored fields: display-only/timestamps normalized to UTC-ms; join on `legacy_kv_key = 'outcome:{id}'`.
- SHA-256 checksum fast path; field-path-only diff on miss (no raw values).

## Mismatch telemetry

- Extend `StorageReadTelemetryEvent` with `comparisonOutcome`, `mismatchCount`, `mismatchMaxSeverity`, `mismatchCategories[]` (paths/categories only — no payloads).
- First shadow sprint may still use an in-memory/log sink; a live `cortex.storage_read_telemetry` table is a **separate, explicitly-approved** additive migration (not assumed here).

## Timeout isolation

- SQL read runs with a hard timeout; on timeout/error it is caught, recorded, and **cannot affect the response** (KV value already returned — Mode B).
- SQL read must not add material latency to the user path (run after response is composed, or in parallel with an abort).

## Sampling / allowlist / rollout

- New env flags (design in S7.1 rollout plan): `STORAGE_DUAL_READ_SAMPLE_PCT`, `STORAGE_DUAL_READ_INTERNAL_ONLY`, `STORAGE_DUAL_READ_ORG_ALLOWLIST`.
- **Internal-only first:** shadow runs only for internal team actors; then sampled; then org allowlist.
- Mode B (`kv_primary_shadow_sql`) becomes executable for Outcome **only**; every other entity stays `kv_only`.

## Kill switch

- `STORAGE_DUAL_READ_ENABLED=false` (or per-entity `STORAGE_MODE_OUTCOME=kv_only`) instantly reverts to KV-only, no deploy. Auto-trip on critical mismatch / threshold breach.

## Entry gates (all required before S7.4 starts)

1. Outcome backfill + reconciliation complete (KV count == SQL count for `outcomes`).
2. Supabase/service-role network capability available in the target env.
3. `OutcomeRepository` read path integration-tested against real schema.
4. Telemetry sink destination approved.
5. Phase 1 gateway validated (this sprint) — ✅.

## Exit gates (before expanding beyond Outcome)

1. Unexplained (non-normalization) mismatch rate = 0 over the soak window.
2. Documented normalization-only mismatch baseline.
3. SQL p95 latency within budget; user-path latency unchanged.
4. SQL error rate below threshold; timeout isolation proven live.
5. Kill switch + rollback exercised.
6. No unclassified mismatches.

## Rollback

Config force `kv_only` (no deploy) → revert `sqlAdapter`/comparison wiring → full revert. KV data and authority never change during shadow reads.

## Required capability check

Shadow reads require live Supabase + `SUPABASE_SERVICE_ROLE_KEY` (absent in the current offline validation env). S7.4 must gate the SQL adapter construction on this capability and fail safe to `kv_only` when absent.

---

## What S7.4 must NOT do

Enable SQL authority, dual-write, client-portal shadow reads, or expansion beyond Outcome before exit gates pass.

---

*End of shadow-read readiness plan.*
