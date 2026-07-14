# MCV2-S7.1 — S7.2 Implementation File Plan

**Sprint:** `MCV2-S7.1-PLAN-006` (plan for `MCV2-S7.2-IMPLEMENT-006`)
**Status:** Plan only. No files created/modified in the runtime tree this sprint.
**Rule reminder for S7.2:** additive; KV authoritative; default Mode A; no route signature or `dataService`/`api.ts` change.

---

## New directory

`supabase/functions/server/storage/` — the single home of the diagnostic storage gateway. One routing authority (Stage 2 decision).

## File table

| Path | Action | Purpose | Depends on | Exports | Consumers | Risk | Tests | Rollback |
|------|--------|---------|-----------|---------|-----------|------|-------|----------|
| `supabase/functions/server/storage/contracts.ts` | **Create** | All Stage-3 types/enums (`StorageSource`, `ReadMode`, `ReadResult`, `ComparisonResult`, `StorageMismatch`, `FallbackReason`, `ReadContext`, gateway + adapter interfaces, telemetry event) | diagnostic DTO types | types/enums | gateway, adapters, routes, tests | Low | typecheck | delete file |
| `supabase/functions/server/storage/dto.ts` | **Create** | Canonical DTOs (`SubmissionDTO`, `OutcomeDTO`, `ReportDTO`, `ScoreDTO`, `LeadDTO`) + `sensitive` field tags | `diagnostic.database.types.ts` | DTO types | normalize, gateway | Low | typecheck | delete |
| `supabase/functions/server/storage/normalize.ts` | **Create** | Map KV blob ↔ SQL record → DTO; timestamp/null/ordering normalization; SHA-256 checksum; field-diff → `StorageMismatch[]` | `dto.ts`, `contracts.ts` | `normalizeKV*`, `normalizeSQL*`, `compare()` | strategy, gateway | **Med** (correctness of diff) | unit (fixtures) | delete |
| `supabase/functions/server/storage/kvAdapter.ts` | **Create** | Thin read wrapper over `kv_store.tsx` (`get`/`getByPrefix`) returning `{data, ms}`; **read-only** | `kv_store.tsx`, `contracts.ts` | `KVDiagnosticAdapter` impl | gateway | Low | unit | delete |
| `supabase/functions/server/storage/sqlAdapter.ts` | **Create** | Read wrapper over existing `repositories/*.ts`; enforces `organizationId`; returns `{data, ms}` | `repositories/index.ts`, `contracts.ts` | `SqlDiagnosticAdapter` impl | gateway | **Med** (org scoping) | unit + integration | delete |
| `supabase/functions/server/storage/readStrategy.ts` | **Create** | Implements Mode A/B/C/D; latency isolation; fallback policy (Stage 7); calls normalize/compare | adapters, normalize, flags, telemetry | `executeRead()` | gateway | **High** (core logic) | unit (all modes) | delete → gateway forces Mode A |
| `supabase/functions/server/storage/flags.ts` | **Create** | Resolve Edge-env flags → effective `ReadMode` with precedence (Stage 5); fail-safe to `kv_only` | `Deno.env`, `contracts.ts` | `resolveReadMode(entity, ctx)` | strategy | **Med** (precedence) | unit (precedence/invalid) | env `STORAGE_DUAL_READ_ENABLED=false` |
| `supabase/functions/server/storage/telemetry.ts` | **Create** | Build + persist `StorageReadTelemetryEvent`; hashing; sampling; no-payload guard | telemetry table, `contracts.ts` | `emitStorageTelemetry()` | strategy | **Med** (privacy) | unit (no-secret) | delete → gateway skips emit |
| `supabase/functions/server/storage/gateway.ts` | **Create** | `DiagnosticStorageGateway` facade: per-entity methods → strategy; **default Mode A** | all storage/*, contracts | `createDiagnosticStorageGateway()` | route handlers | **High** (facade) | unit + integration | delete → routes revert to direct `kv.*` |
| `supabase/functions/server/storage/index.ts` | **Create** | Barrel exports | storage/* | re-exports | routes, tests | Low | — | delete |
| `supabase/migrations/2026XXXX_storage_read_telemetry.sql` | **Create** | Additive `cortex.storage_read_telemetry` table + RLS + retention note | tenancy schema | table | telemetry.ts | **Med** (schema) | migration up/down + RLS test | rollback SQL (drop table) |
| `supabase/migrations/rollbacks/2026XXXX_rollback_storage_read_telemetry.sql` | **Create** | Drop telemetry table | — | — | — | Low | — | — |
| `supabase/functions/server/index.tsx` | **Modify** ⚠️ | Wire gateway into the ≤5 diagnostic read routes (submission get/list, client submission, report, outcome get, cortex get). Behind Mode A default = **no behavior change** | `storage/index.ts` | — | — | **HIGH-CONFLICT** | envelope regression + integration | git revert route hunks; or flip kill switch |
| `src/config/features.ts` | **Modify** (docs only) | Document storage flags as Edge-env (NOT Vite) — comment cross-ref; **no new Vite flag** | — | — | — | Low | — | revert |
| `src/system/manifest.ts` | **Modify** | Register storage nodes (`MQC-SVC-0XX`) — IDs before code (Art. 14) | — | node ids | validate.ts | Low | `validate.ts` | revert |
| `ARCHITECT.md` | **Modify** | Add storage-gateway rows to task lookup + data-flow | — | — | — | Low | — | revert |
| `architecture/system_map.json` | **Modify** | Add `storage_gateway` block; bump `_meta.generated` | — | — | — | Low | — | revert |
| `tests/storage/*.test.ts` | **Create** | See Test Plan | storage/* | — | CI | Med | `npm run test:storage` | delete |

## High-conflict files (call out separately)

| File | Why | Mitigation |
|------|-----|------------|
| `supabase/functions/server/index.tsx` | 3705 lines; every diagnostic read route lives here; concurrent sprints touch it | Keep S7.2 edits to a **minimal, contiguous** insertion per route (one gateway call replacing a `kv.get` block); land early; Mode A default means the diff is inert until flags flip; each route change independently revertible. |
| `src/system/manifest.ts` | Frequently edited registry | Reserve ID range up front; append-only. |
| `architecture/system_map.json` | Machine snapshot, merge-prone | Single additive block; regenerate `_meta.generated`. |

## Sequencing for S7.2

1. `contracts.ts` → `dto.ts` → `normalize.ts` (pure, fully unit-tested first).
2. `kvAdapter.ts`, `sqlAdapter.ts` (read-only wrappers).
3. `flags.ts`, `telemetry.ts`, `readStrategy.ts`.
4. `gateway.ts` + `index.ts` barrel.
5. Telemetry migration + rollback.
6. Wire **one** route (outcome get) behind Mode A; regression-test envelope; then the remaining ≤4 read routes.
7. Manifest/docs/system_map updates.

Writes, Mode C/D enablement, and non-diagnostic routes are **out of S7.2 scope**.

---

*End of file plan. No runtime files changed in S7.1.*
