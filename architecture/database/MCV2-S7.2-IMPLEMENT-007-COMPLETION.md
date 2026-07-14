# MCV2-S7.2-IMPLEMENT-007 — Completion Report

**Sprint:** `MCV2-S7.2-IMPLEMENT-007` — Runtime Storage Gateway Implementation, Phase 1
**Date:** 2026-07-14
**Status:** **Completed** — KV-only gateway wired; external behavior unchanged; no SQL reads.

---

## Summary

Introduced the diagnostic-domain storage gateway (Phase 1) and routed three low-risk read paths through it. KV remains the only active runtime source. The gateway defaults to `kv_only`, clamps any future SQL mode to `kv_only` (no SQL path exists yet), and ships telemetry disabled. Route response envelopes, authentication, and frontend behavior are unchanged.

---

## Delivered (evidence: file diffs + `npm run test:storage` 14/14)

| Item | Status |
|------|--------|
| Canonical contracts (`contracts.ts`) | PROVEN |
| Shared KV parsers extracted (`kvParse.ts`) | PROVEN — moved verbatim from `index.tsx` |
| Read-mode config + fail-safe (`config.ts`) | PROVEN — tests |
| Telemetry hooks, disabled by default (`telemetry.ts`) | PROVEN — no-op default |
| KV diagnostic adapter (`kvAdapter.ts`) | PROVEN |
| Diagnostic storage gateway (`gateway.ts`) | PROVEN |
| Composition/registration barrel (`index.ts`) | PROVEN |
| Runtime wiring: 3 read routes | PROVEN — diff |
| Tests (`tests/storage/gateway.test.ts`) | PROVEN — 14/14 |

---

## Contracts created

`StorageSource`, `ReadMode` (5 values, only `kv_only` active), `DiagnosticEntity`, `ReadActor`, `ReadContext` (requestId + org + actor + route + entity), `ReadResult<T>` (data, found, returnedSource, mode, latency), `StorageReadError`, `KvDiagnosticPort`, `KvDiagnosticAdapter`, `DiagnosticStorageGateway`, `StorageConfig`, `StorageReadTelemetryEvent`, `StorageTelemetrySink`. No `enum`/parameter-properties → importable by both Deno runtime and Node `--experimental-strip-types` tests.

## Gateway design

One diagnostic-domain gateway (Option C from S7.1). Composes the injected KV port → `createKvDiagnosticAdapter` → `createDiagnosticStorageGateway`. Per read: resolve active mode (clamped to `kv_only`), invoke KV adapter, time latency, emit telemetry (guarded), return `ReadResult`. No route/business/scoring logic, no SQL, no comparison, no fallback.

## KV adapter coverage

`getSubmission(id)` (uses `safeJsonParse`, `found = !!raw`), `listSubmissions()` (prefix scan + `parseSubmissions` + newest-first sort + non-array→empty fallback), `getOutcome(submissionId)` (uses `JSON.parse` on truthy raw, else null — exact route parity). Read-only; no writes/mutation/SQL/global state.

## Runtime paths migrated

1. `GET /submissions` (list) → `diagnosticStorage.listSubmissions`
2. `GET /submissions/:id` → `diagnosticStorage.getSubmission`
3. `GET /submissions/:id/outcome` → `diagnosticStorage.getOutcome`

All three: team-authenticated, envelopes byte-identical, KV read failure reproduces the same `Database error` / `Failed to fetch…` 500 responses.

## Paths deferred (documented, not broadened)

- **Client portal reads** (`GET /client/submission/:id`, `/report`): involve `requireClientAccess` (session-token/email) auth. Deferred to keep Phase 1 free of auth interaction; behavior unchanged.
- **Derived report** (`buildAIClientReport`): no KV source key; needs normalization design — deferred per S7.1.
- **Cortex/score reads, analytics aggregates, lead reads** (leads have no runtime read path): deferred.
- All **write paths**: not migrated (KV-only writes remain).

## Read-mode configuration

Env-driven, server-side, fail-safe to `kv_only`. Keys: `STORAGE_DUAL_READ_ENABLED` (master, default false), `STORAGE_MODE_SUBMISSION|OUTCOME|REPORT|LEAD` (default `kv_only`), `STORAGE_READ_TELEMETRY_ENABLED` (default false). Precedence: master-off → `kv_only` everywhere; invalid value → `kv_only`; Phase 1 clamps any non-`kv_only` to `kv_only`. See `MCV2-S7.2-READ-MODE-CONFIG-GUIDE.md`.

## Telemetry

Disabled by default (no-op sink). No live telemetry table created this phase. Event carries only approved identifiers (requestId, entity, mode, source, latency, route, orgId, errorClass) — no raw payloads/PII/secrets. `safeEmit` swallows sink errors so telemetry can never affect a read.

## Files created

- `supabase/functions/server/storage/contracts.ts`
- `supabase/functions/server/storage/kvParse.ts`
- `supabase/functions/server/storage/config.ts`
- `supabase/functions/server/storage/telemetry.ts`
- `supabase/functions/server/storage/kvAdapter.ts`
- `supabase/functions/server/storage/gateway.ts`
- `supabase/functions/server/storage/index.ts`
- `tests/storage/gateway.test.ts`
- `architecture/database/MCV2-S7.2-IMPLEMENT-007-COMPLETION.md` (this)
- `architecture/database/MCV2-S7.2-STORAGE-GATEWAY-USAGE-GUIDE.md`
- `architecture/database/MCV2-S7.2-READ-MODE-CONFIG-GUIDE.md`
- `architecture/database/MCV2-S7.2-PHASE1-ROLLBACK-GUIDE.md`

## Files modified

- `supabase/functions/server/index.tsx` — imports; removed duplicate parsers (now imported from `kvParse.ts`); gateway singleton; 3 read routes wired.
- `package.json` — added `test:storage` script.
- `ARCHITECT.md`, `architecture/system_map.json`, `architecture/database/MCV2-S3-MIGRATION-ROADMAP.md` — index/status updates.

## Tests and commands

| Command | Result |
|---------|--------|
| `npm run test:storage` | **14/14 pass** (new) |
| `npm run test:database` | 19/19 pass |
| `npm run test:migration` | 36/36 pass |
| `npm run test:intelligence` | 8/8 pass |
| `npm run build` | Passes (required installing env-missing native rollup binary `@rollup/rollup-linux-x64-gnu`; unrelated to this change) |

## Response compatibility

Same fields, null/undefined behavior, ordering, pagination (unchanged — full list), status codes, and error envelopes (including the KV-error `Database error` 500). `found = !!raw` reproduces the 404 branch; outcome `JSON.parse` semantics preserved. Demo/live and client portal behavior unchanged (client reads not migrated).

## Runtime impact

Three GET routes now obtain data via the gateway instead of a direct `kv.*` call; the data and responses are identical. No other routes touched.

## KV authority status

**KV remains authoritative.** Gateway returns `returnedSource=kv`, `mode=kv_only`. Writes bypass the gateway entirely.

## SQL runtime usage
**none.**

## Frontend impact
**none.**

## Constitution compliance

- Art. 3: frontend still through `dataService`; untouched.
- Art. 4/7/12/17: KV authoritative; no cutover; dual-read designed not enabled; validation precedes authority.
- Art. 16: scope held to Phase 1; S7.3 not started.

## Risks

- `index.tsx` is high-conflict; the diff is minimal and revertible per route.
- Extracted parsers now shared — any future edit affects both routes and gateway (intended: single source).
- Outcome uses `JSON.parse` (throws on malformed) — preserved deliberately to match prior behavior.

## Unverified areas

- Live edge deploy not exercised (no service-role/Supabase network in this environment — expected; sprint is offline-testable).
- Vite build required an environment-only native-dependency install.

## Human review priority

1. Confirm client-portal read migration remains deferred (isolation-sensitive).
2. Confirm outcome `JSON.parse` parity is acceptable vs adopting `safeJsonParse` later.

## Rollback

See `MCV2-S7.2-PHASE1-ROLLBACK-GUIDE.md`. Fastest: revert the `index.tsx` route hunks (git). Because default mode is already `kv_only`, no flag change is needed to stay safe.

## Recommended next phase

MCV2-S7.3 — validation and shadow-read preparation only. Do not begin automatically.

---

*End of completion report.*
