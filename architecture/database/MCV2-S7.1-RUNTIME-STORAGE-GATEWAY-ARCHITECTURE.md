# MCV2-S7.1 — Runtime Storage Gateway & Dual-Read Architecture

**Sprint:** `MCV2-S7.1-PLAN-006`
**Status:** Planning & design only. **No runtime code changed. KV remains authoritative. No SQL reads, no shadow reads, no fallback, no dual-write enabled.**
**Constitution basis:** Articles 3, 4, 5, 7, 8, 12, 17.
**Companion docs:** `MCV2-S7.1-RUNTIME-READ-DEPENDENCY-MAP.md`, `MCV2-S7.1-DUAL-READ-ROLLOUT-PLAN.md`, `MCV2-S7.1-IMPLEMENTATION-FILE-PLAN.md`, `MCV2-S7.1-TEST-PLAN.md`.

---

## Stage 2 — Gateway boundary (SELECTED)

### Decision

**One diagnostic-domain gateway (`DiagnosticStorageGateway`) that composes existing per-entity repositories behind a read-strategy layer.** Not a generic god-object storage gateway; not a per-repository duplication.

### Options considered

| Option | Verdict | Reason |
|--------|---------|--------|
| A. One generic `StorageGateway` for all domains | ❌ Reject | Becomes a god object; forces proposal/messaging/telemetry concerns into diagnostic sprint; violates scope discipline (Art. 16). |
| B. Duplicate every repository with a KV twin | ❌ Reject | Explicitly forbidden by sprint rule "abstraction must be simpler than duplicating every repository." N× surface, N× drift. |
| **C. One diagnostic-domain gateway wrapping existing repos + a KV adapter, selected by a read strategy** | ✅ **Select** | One source of truth for routing; reuses the 5 diagnostic repositories already built (S5); adds one thin KV adapter; business logic (routes/engines) stays storage-agnostic. |
| D. Strategy inside each repository | ❌ Reject | Scatters mode/flag/telemetry logic across 5 files; no single routing authority; harder to kill-switch. |

### Why C is the simplest safe choice

- **Reuse over rebuild (Art. 1):** S5 already ships `LeadRepository`, `SubmissionRepository`, `ReportRepository`, `OutcomeRepository`, `ContactRepository` as typed interfaces. The SQL adapter is *those*, unchanged.
- **One routing authority:** mode selection, flag resolution, comparison, fallback policy, and telemetry live in exactly one place (`DiagnosticStorageGateway` + `readStrategy`). This is the "one source of truth for storage routing" the drift review demands.
- **No provider leakage (Art. 2 analogue):** route handlers call `gateway.getSubmission(id, ctx)` and receive a `ReadResult<SubmissionDTO>`. They never learn whether the value came from KV or PostgreSQL.
- **Type safety without a god object:** each entity keeps its own typed method; the gateway is a facade over five small adapters, not one dynamic `read(entity, key)` switch.

### Conceptual flow (target for S7.2, not enabled in S7.1)

```
Frontend → dataService.ts → api.ts → Edge route (index.tsx)
  → DiagnosticStorageGateway.get<Entity>(id, ReadContext)
     → resolveReadMode(entity, ReadContext)          // feature flags
        → ReadStrategy[mode]
           ├─ KVAdapter.read(entity, id)              // kv_store.tsx (authoritative)
           └─ SqlDiagnosticAdapter.read(entity, id)   // repositories/*.ts (shadow)
        → normalize + compare (Mode B/C)
        → emit StorageReadTelemetry
     → ReadResult<EntityDTO>  // route maps to existing envelope, unchanged
```

The gateway is **read-first** in S7. Writes continue to call `kv.*` directly and are untouched (see Stage 11).

---

## Stage 3 — Canonical contracts

Contracts live server-side only, e.g. `supabase/functions/server/storage/contracts.ts`. TypeScript sketch (definitions, not implementation):

```ts
export enum StorageSource { KV = 'kv', SQL = 'sql' }

export enum ReadMode {
  KV_ONLY        = 'kv_only',        // Mode A — default/safe
  KV_PRIMARY     = 'kv_primary',     // Mode B — KV returned, SQL shadow+compare
  SQL_PRIMARY    = 'sql_primary',    // Mode C — SQL returned, KV fallback (future)
  SQL_ONLY       = 'sql_only',       // Mode D — future final state
  DISABLED       = 'disabled',       // explicit off (treated as KV_ONLY, logged)
}

export interface ReadContext {
  requestId: string;            // request correlation
  organizationId: string;       // tenant scope (server-resolved, never client-supplied)
  actor: { kind: 'team' | 'client' | 'public'; id?: string };
  route: string;                // e.g. 'GET /submissions/:id'
  entity: DiagnosticEntity;     // 'submission' | 'outcome' | 'report' | 'lead' | 'score'
}

export interface ReadResult<T> {
  data: T | null;
  returnedSource: StorageSource;      // which value the caller received
  mode: ReadMode;
  fallbackUsed: boolean;
  fallbackReason?: FallbackReason;
  comparison?: ComparisonResult;      // present only in Mode B/C
  latency: { kvMs?: number; sqlMs?: number };
}

export interface ComparisonResult {
  outcome: 'match' | 'normalized_match' | 'mismatch' | 'source_only' | 'target_only' | 'skipped';
  mismatches: StorageMismatch[];
  checksum?: { kv: string; sql: string };
}

export interface StorageMismatch {
  field: string;                      // dot-path; never the raw value
  category: MismatchCategory;
  severity: 'info' | 'low' | 'high' | 'critical';
  // NO raw sensitive payload — see Stage 6/8
}

export enum MismatchCategory {
  SOURCE_MISSING, TARGET_MISSING, VALUE_MISMATCH, RELATIONSHIP_MISMATCH,
  ORDERING_ONLY, NORMALIZATION_ONLY, STALE, UNEXPECTED_DUPLICATE,
  AUTHORIZATION_MISMATCH, SCHEMA_MISMATCH,
}

export enum FallbackReason {
  SQL_TIMEOUT, SQL_UNAVAILABLE, ROW_MISSING, MALFORMED_ROW,
  PERMISSION_DENIED, TENANT_MISMATCH, REPOSITORY_ERROR, MISMATCH_THRESHOLD,
  FLAG_DISABLED, NONE,
}

export interface DiagnosticStorageGateway {
  getSubmission(id: string, ctx: ReadContext): Promise<ReadResult<SubmissionDTO>>;
  listSubmissions(filter: SubmissionListFilter, ctx: ReadContext): Promise<ReadResult<SubmissionDTO[]>>;
  getOutcome(submissionId: string, ctx: ReadContext): Promise<ReadResult<OutcomeDTO>>;
  getReport(submissionId: string, ctx: ReadContext): Promise<ReadResult<ReportDTO>>;
  getScores(submissionId: string, ctx: ReadContext): Promise<ReadResult<ScoreDTO>>;
  getLead(id: string, ctx: ReadContext): Promise<ReadResult<LeadDTO>>;
}

export interface KVDiagnosticAdapter {         // wraps kv_store.tsx
  read<T>(entity: DiagnosticEntity, id: string, ctx: ReadContext): Promise<{ data: T | null; ms: number }>;
}
export interface SqlDiagnosticAdapter {        // wraps repositories/*.ts
  read<T>(entity: DiagnosticEntity, id: string, ctx: ReadContext): Promise<{ data: T | null; ms: number }>;
}

export interface StorageReadTelemetryEvent { /* see Stage 8 */ }
```

**Scope guard:** contracts cover only diagnostic entities. No knowledge-base, CRM, or marketing shapes. No future-domain generics.

Contracts satisfy every required capability: KV-only, SQL-only, KV-primary comparison, SQL-primary fallback, explicit `DISABLED`, `requestId` correlation, `organizationId` + `actor` scope, `latency.kvMs/sqlMs`, and `MismatchCategory` classification.

---

## Stage 4 — Read strategy modes

| Mode | Returned | SQL touched | Fallback | Eligibility gate | Primary risk |
|------|----------|-------------|----------|------------------|--------------|
| **A — KV only** | KV | no | n/a | always available; **default** | none (current behavior) |
| **B — KV primary + SQL shadow** | **KV** | read + compare | n/a (SQL error swallowed) | backfill+reconciliation complete for entity; per-entity flag on | SQL latency/errors must not touch user response |
| **C — SQL primary + KV fallback** | SQL | read | KV on approved errors only | Mode B mismatch rate = 0 unexplained over soak; human approval | fallback masking auth defects |
| **D — SQL only** | SQL | read | none | full cutover gates (Stage 10) passed | data loss if SQL wrong; **not in S7 authority** |

### Mode A — KV only
Current production behavior. `SqlDiagnosticAdapter` never called. Default for every entity at S7.2 start and the safe target of every kill switch.

### Mode B — KV primary with SQL shadow read
1. Read KV (authoritative) → this value is what the caller gets.
2. Independently read SQL for the same id + `organizationId`.
3. Normalize both to the canonical DTO (Stage 6) and compare.
4. **Return the KV value regardless of SQL outcome.**
5. Emit `StorageReadTelemetryEvent` with comparison + latencies.
6. **SQL read is wrapped so any error/timeout is caught, recorded, and cannot change the HTTP response.** The user path is latency-isolated (SQL read may run after the response is composed, or in parallel with a hard budget; see Stage 8 sampling/latency).

Eligibility: entity has passed backfill + reconciliation (Phase 2) and its per-entity flag is enabled. Risk: added SQL load; mitigated by sampling.

### Mode C — SQL primary with KV fallback (FUTURE — design only)
Read SQL first; on an **approved** `FallbackReason` (`SQL_TIMEOUT`, `SQL_UNAVAILABLE`, `ROW_MISSING` when KV has the row, `REPOSITORY_ERROR`) fall back to KV, record `fallbackUsed=true`. **Never** falls back on `PERMISSION_DENIED` / `TENANT_MISMATCH` (fail closed — Stage 7). Not enabled until Stage 10 cutover gates pass. Risk: a permission bug in SQL could be masked by KV fallback — hence the fail-closed carve-out.

### Mode D — SQL only (FUTURE FINAL — out of S7 authority)
No KV fallback. Requires full cutover + human authority sign-off per Article 17. Documented here for completeness; S7 has no authority to enable it.

---

## Stage 6 — Comparison & normalization

KV blobs and SQL rows differ in shape (KV `sub:{id}` is one JSON object with `answers` inline; SQL splits into `submissions` + `diagnostic_answers` + `diagnostic_scores`). Comparison happens on a **canonical DTO**, never on raw shapes.

### Rules

| Concern | Rule |
|---------|------|
| Canonical DTO | Both sources map into `SubmissionDTO`/`OutcomeDTO`/`ReportDTO`/`ScoreDTO`/`LeadDTO` before compare. Mapper lives in `storage/normalize.ts`. |
| Ignored fields | `updatedAt`, `submittedDate` (display string), `isRead`, ephemeral `roiPotential='TBD'`, and any server-render-only field. Documented allowlist per entity. |
| Timestamps | Normalize to UTC ISO-8601 millisecond precision; compare as epoch. KV `submittedAt` vs SQL `created_at` mapped explicitly. |
| ID mapping | Join on `legacy_kv_key = 'sub:{id}'` / `'lead:{id}'` / `'outcome:{id}'`. SQL UUID `id` is ignored for identity; legacy key is the join axis. |
| Legacy keys | `sub_email:`/`lead_email:` indexes are NOT compared as entities — they resolve to the same primary record; verified via lookup equality only. |
| Null/empty | `null`, `undefined`, `''`, absent key normalized to a single canonical empty per field type before compare. |
| Ordering | Field order irrelevant (object compare). Collections sorted by stable key before compare. |
| Child collections | `answers` sorted by `question_key`; `domain_scores` by `domain_key`; report core-issues by index. Ordering-only differences classified `ORDERING_ONLY` (severity `info`). |
| Checksum | SHA-256 over the normalized, key-sorted canonical DTO JSON. Fast path: equal checksum ⇒ `match`, skip field diff. |
| Field-level report | On checksum miss, per-field diff yields `StorageMismatch[]` with dot-path + category + severity. **Values are never stored** — only field path + category. |

### Mismatch categories → severity

| Category | Meaning | Default severity |
|----------|---------|------------------|
| `SOURCE_MISSING` (KV missing) | KV has no row but SQL does | high |
| `TARGET_MISSING` (SQL missing) | expected during partial backfill | low (info if entity not yet backfilled) |
| `VALUE_MISMATCH` | same field, different value | high |
| `RELATIONSHIP_MISMATCH` | child count/linkage differs (answers, scores) | high |
| `ORDERING_ONLY` | same set, different order | info |
| `NORMALIZATION_ONLY` | differs only by known normalization (timestamp precision, empty) | info (expected, budgeted) |
| `STALE` | SQL older than KV `updatedAt` | low |
| `UNEXPECTED_DUPLICATE` | >1 SQL row for one legacy key | critical |
| `AUTHORIZATION_MISMATCH` | org/tenant scope differs between sources | critical (see Stage 7) |
| `SCHEMA_MISMATCH` | field present in one shape, structurally absent | high |

**Privacy:** telemetry stores field *paths* and *categories*, never raw answer text, emails, or report prose. Report/answers fields carry a `sensitive` tag in the DTO map → excluded from any value capture even in debug sampling (Stage 8).

---

## Stage 7 — Fallback policy

Applies to Mode C (future). In Mode B there is no user-facing fallback (KV always returned); "fallback" there means *which comparison outcome is recorded*.

| Failure | Classification | Action |
|---------|----------------|--------|
| SQL timeout | **safe fallback** | Mode C: return KV, `fallbackReason=SQL_TIMEOUT`, record. Mode B: record only. |
| Connection unavailable | **safe fallback** | as above (`SQL_UNAVAILABLE`). |
| Row missing (KV present) | **safe fallback** | Mode C returns KV; record `ROW_MISSING`; feeds backfill gap report. |
| Malformed row | **escalate + safe fallback** | return KV, record `MALFORMED_ROW` at high severity; alert. |
| Permission denied | **fail closed** | do **not** fall back; surface error path unchanged; record `PERMISSION_DENIED` critical. Falling back could hide a real RLS defect. |
| Tenant mismatch | **fail closed** | do **not** fall back; record `TENANT_MISMATCH` critical + alert. Security event. |
| Repository/unknown error | **safe fallback (Mode C) / record only (Mode B)** | return KV; record `REPOSITORY_ERROR`. |
| Mismatch threshold exceeded | **escalate → auto-revert** | trip kill switch for that entity to Mode A; record `MISMATCH_THRESHOLD`; alert; require human re-enable. |

**Security rule (Art. 5/8):** `PERMISSION_DENIED` and `TENANT_MISMATCH` never silently fall back. Any fallback that could conceal an authorization defect is prohibited.

---

## Stage 8 — Telemetry

### Destination
Reuse the S6.2 migration observability pattern. **New append-only table** `cortex.storage_read_telemetry` (or extend `migration_reconciliation_log` with a `source='dual_read'` discriminator). Recommendation: **dedicated table** — different write volume and retention than migration logs. Table creation is an *additive schema* task in S7.2, not S7.1.

### Event fields

| Field | Notes |
|-------|-------|
| `request_id` | correlation |
| `organization_id` | tenant |
| `entity_type` | submission/outcome/report/score/lead |
| `entity_ref` | **hashed** (`sha256(legacy_kv_key)`), never raw id for client entities |
| `configured_mode` | ReadMode |
| `returned_source` | kv/sql |
| `kv_latency_ms`, `sql_latency_ms` | numbers |
| `fallback_used`, `fallback_reason` | bool + enum |
| `mismatch_count`, `mismatch_max_severity`, `comparison_outcome` | rollup |
| `mismatch_categories` | array of category enums (no values) |
| `error_class` | on failure |
| `route`, `feature`, `environment`, `timestamp` | context |

### Policies

| Policy | Value |
|--------|-------|
| Retention | 30 days hot, 90 days aggregated rollup, then purge. |
| Aggregation | Hourly rollup: per-entity mismatch rate, p50/p95 latency delta, fallback rate. |
| Alert thresholds | Any `critical` mismatch → immediate alert. Unexplained (non-`NORMALIZATION_ONLY`) mismatch rate > 0.1% per entity/hour → alert. SQL error rate > 1% → alert. p95 SQL latency > KV p95 + budget → warn. |
| Sampling | Mode B: 100% for pilot entity first 48h, then sample (e.g. 10%) to control cost/latency; always 100% on any mismatch-suspected id. Config-driven. |
| Privacy | No raw payloads, no emails, no answer/report text, no tokens. Field paths + categories only. Hashed entity refs. Enforced by the normalize layer's `sensitive` tag. |

---

## Stage 11 — Write strategy boundary (during dual-read)

**S7 is read-only. Writes stay KV-only and are not modified.** All `kv.set(...)` calls in `index.tsx` remain the sole write path. KV stays authoritative (Art. 17).

Future write options (design only — **do not implement**):

| Option | Description | Risk |
|--------|-------------|------|
| **KV-only writes** *(current, S7)* | writes go to KV only; SQL populated by backfill | SQL drifts between backfills; acceptable while KV authoritative |
| KV write + async SQL replication (outbox) | write KV, enqueue event, async apply to SQL | eventual consistency lag; safest incremental step |
| Transactional dual-write | write both in one logical unit | partial-failure divergence; needs idempotency keys + rollback; highest complexity |
| Outbox/event replication | durable event log → SQL projector | best auditability; infra cost |

**Recommendation:** when write migration begins (Phase 4, a *later* sprint), adopt **KV write + async SQL replication via an outbox**, guarded by `idempotency_keys`, before any transactional dual-write. This keeps KV authoritative and makes divergence observable and replayable.

**Dual-write divergence risks called out:** partial writes, ordering races, retry duplication, and silent SQL failures that a naive dual-write would hide. None are incurred in S7 because writes remain KV-only.

---

## Stage 12 — API compatibility

No frontend change is required for S7.2. The gateway sits *below* the route handler; the handler maps `ReadResult<T>.data` back into the existing envelope.

| Concern | Guarantee |
|---------|-----------|
| DTO mapping | Route serializes the canonical DTO to the **exact** current JSON shape (`{success, submission}`, `{success, submissions[]}`, `{success, report, aiPowered}`, etc.). Regression test locks envelopes. |
| Error mapping | Same status codes/messages (401/404/500). Gateway errors map to the current 500 path; auth stays in the route (unchanged). |
| Pagination | KV `getByPrefix` returns full set today; SQL `listSubmissions` must reproduce identical ordering + windowing before Mode B for the list entity. |
| Client portal | `requireClientAccess` semantics unchanged; gateway receives resolved scope, cannot widen it. |
| Demo mode | `isDemo()` short-circuits in `dataService` **before** the edge is called — gateway is never reached in demo; behavior identical. |
| Index lookups | `sub_email:`/`lead_email:` resolution unchanged in S7 (KV). |
| Legacy IDs | External API IDs remain the KV `SUB-…`/`lead:` ids; SQL UUIDs never surface. |
| Response ordering | Locked by normalization + envelope regression tests. |

No API contract change. If any future response envelope must change, it requires a documented compatibility plan (none in S7).

---

## Stage 13 — Security review

| Risk | Assessment | Control for S7.2 |
|------|------------|------------------|
| Service-role bypass | Both KV helper and repositories use `service_role`; SQL adapter must not skip org filtering that RLS would enforce | Gateway injects server-resolved `organizationId` into every repo call; add repo-level org assertion; RLS remains defense-in-depth. |
| RLS expectations | Repos run as service role (RLS bypassed) | Treat gateway as the enforcement point; unit test that no repo method is called without `organizationId`. |
| Org scope injection | `organizationId` must never come from client input | Resolve org server-side (default org for public/client, membership for team); `ReadContext.organizationId` is set by the route, not the body/query. |
| Client session scope | Email-fallback path in `requireClientAccess` | Gateway read for client entities must bind `submission_id` AND `organizationId`; email fallback cannot widen to other submissions. |
| Fallback masking auth failures | Mode C could hide RLS defects | `PERMISSION_DENIED`/`TENANT_MISMATCH` **fail closed**, never fall back (Stage 7). |
| Telemetry leakage | Payloads could leak PII | Field-path + category only; hashed refs; `sensitive` tag excludes values (Stage 8). |
| Source-selection manipulation | Client forcing SQL/KV | Mode is server-resolved from flags + entity; **never** from request headers/params. |
| Feature-flag abuse | Flag flip escalating exposure | Flags server-side (Edge env), no client override; changes audited; kill switch to Mode A. |
| Cross-tenant comparison | Comparing KV (default org) vs SQL row of another org | Compare only within one `organizationId`; `AUTHORIZATION_MISMATCH` is critical + alert. |
| Logs with sensitive fields | Existing `console.log` in routes | Gateway telemetry must not log values; recommend audit of route-level logs in S7.2 (no change to existing logs in S7.1). |

**Human review required (Art. 8):** client-portal SQL read enablement and any Mode C authority step are high-risk (client isolation) and require recorded human sign-off before enablement.

---

## Stage 16 — Constitution drift review

| Question | Answer | Evidence |
|----------|--------|----------|
| Preserves KV authority? | **Yes** | Mode A default; KV returned in Mode B; writes KV-only; Art. 17 honored. |
| Avoids big-bang migration? | **Yes** | Per-entity, per-mode rollout; ordered pilots (Stage 4/rollout). |
| One source of truth for storage routing? | **Yes** | Single `DiagnosticStorageGateway` + `readStrategy`; Option C rejects scattered logic. |
| Avoids storage/provider leakage into business logic? | **Yes** | Routes/engines receive `ReadResult<DTO>`; never see KV vs SQL. |
| Preserves current APIs & frontend? | **Yes** | Stage 12; gateway below route; `dataService`/`api.ts` untouched. |
| Includes rollback + telemetry? | **Yes** | Kill switch → Mode A; per-entity flags; Stage 8 telemetry + Stage 10 rollback gate. |
| Respects environment capability gates? | **Yes** | SQL reads gated by Edge env flags + backfill/reconciliation prerequisites; demo mode never reaches gateway. |
| Avoids unnecessary complexity? | **Yes** | Reuses 5 existing repos; adds one gateway + one KV adapter + normalize/strategy/telemetry; no per-repo duplication, no god object. |

All eight answers are affirmative — no plan revision required.

---

*End of architecture document. Runtime changes in this sprint: none.*
