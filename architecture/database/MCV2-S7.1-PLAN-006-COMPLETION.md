# MCV2-S7.1-PLAN-006 — Sprint Completion Report

## Sprint
MCV2-S7.1-PLAN-006 — Runtime Storage Gateway and Dual-Read Planning

## Status
**Completed** — planning & audit only. No runtime source code modified. KV remains authoritative.

## Executive Summary
Audited every runtime read/write path in the diagnostic domain and designed a single server-side storage boundary — the `DiagnosticStorageGateway` — that composes the five existing S5 repositories behind a read-strategy layer, with a thin read-only KV adapter. The design keeps KV authoritative (Mode A default), isolates business logic from storage source, preserves all APIs and frontend behavior, and gates every SQL/shadow capability behind per-entity Edge-env flags that fail safe to KV-only. Four supporting plans (dependency map, rollout/flags, file plan, test plan), a draft S7.2 prompt, and this report were produced. Constitution drift review passes on all eight questions.

## Current Runtime Findings
- All diagnostic persistence flows through `kv_store.tsx` (`service_role`) via `kv.*` calls inside `index.tsx` (3705 lines). KV table `kv_store_324f4fbe` is authoritative.
- Key namespaces mapped: `lead:`, `lead_email:`, `sub:`, `sub_email:`, `cortex:` (AI scores), `outcome:`, plus non-diagnostic `proposal:`, `msg:`, `note:`, `notif:`, `client_session:`, `eng_log:`, `settings:platform`.
- Five diagnostic SQL repositories (`lead/contact/submission/report/outcome`) exist from S5 but are **not wired to any route** — ready to serve as the SQL adapter.
- **Reports have no KV source key** — the client report is computed on demand by `buildAIClientReport(sub, ai)`. This is the highest normalization risk and is flagged for a dedicated normalization pilot (last in rollout).
- Auth: team via `verifyTeamToken`, client via `requireClientAccess` (session token OR email match). KV is effectively single-tenant (default org `marq`); SQL adds `organization_id` as a new required filter — a tenant-isolation risk that drives the fail-closed policy.
- Full route→storage table with caller, RW, source, response shape, fallback, auth, SQL-repo presence, migration risk, and S7 treatment is in `MCV2-S7.1-RUNTIME-READ-DEPENDENCY-MAP.md`.

## Selected Gateway Architecture
**One diagnostic-domain gateway wrapping existing repositories behind a read strategy (Option C).** Rejected: generic god-object gateway, per-repository duplication, and per-repo strategy scattering. Rationale: one routing authority, reuse of S5 repos, no storage leakage into routes/engines, type safety without a god object, simpler than duplication (sprint rule).

## Read Modes
- **A — KV only** (default/safe, current behavior).
- **B — KV primary + SQL shadow** (KV returned; SQL read+compared; SQL error isolated from response).
- **C — SQL primary + KV fallback** (future; fail-closed on permission/tenant errors).
- **D — SQL only** (future final; no S7 authority).
Eligibility and risk per mode documented in the architecture doc, Stage 4.

## Feature Flag Strategy
Per-domain + per-entity Edge-env flags (mirrors Intelligence Gateway pattern), no single global switch. Master `STORAGE_DUAL_READ_ENABLED` kill switch, per-entity `STORAGE_MODE_*`, client-portal surface cap, sampling %, internal-only + org-allowlist audience gates. Precedence: master-off > surface cap > entity mode > audience downgrade > default `kv_only`. Invalid config fails safe to KV-only. Defaults hardest in prod.

## Comparison Strategy
Both sources normalized to canonical DTOs before compare (join on `legacy_kv_key`). Ignored-field allowlist, UTC-ms timestamps, null/empty canonicalization, child-collection sorting, SHA-256 checksum fast path, field-level diff (paths only, no values). Ten mismatch categories with severities; `UNEXPECTED_DUPLICATE` and `AUTHORIZATION_MISMATCH` are critical.

## Fallback Policy
Safe-fallback: timeout, unavailable, row-missing, repository-error. Escalate: malformed row, mismatch-threshold (auto-revert to Mode A). **Fail-closed (no fallback): permission-denied, tenant-mismatch** — never mask an authorization defect.

## Telemetry Design
Dedicated additive append-only table `cortex.storage_read_telemetry`. Fields: request/org/entity(hashed)/mode/returned-source/kv+sql latency/fallback/mismatch rollup/categories/error/route/env/timestamp. 30-day retention + rollups; alerts on critical mismatch, >0.1% unexplained mismatch, >1% SQL error, latency budget breach. Sampling configurable. No raw payloads/PII/tokens — field paths + categories only.

## Rollout Plan
12 staged gates from local/mock → staging shadow → internal team → outcome (low-risk pilot) → submission → soak → expand by entity → 🔒 Mode C internal → 🔒 org allowlist → wider → 🔒 SQL authority → KV retirement (Sprint 12). Stages 1–7 are Mode A/B (KV authoritative) and within S7.2/S7.3; stages 8+ need separate human authority.

## Cutover Gates
13 objective, binary, per-entity criteria (backfill+reconciliation complete, unexplained mismatch = 0, documented normalization-only rate, SQL error < 0.5%, latency budget, fallback tested, rollback tested, tenant isolation live, client portal validated, no unclassified records, telemetry operational, recorded human approval). No vague confidence score.

## Write-Period Recommendation
Writes stay **KV-only** for all of S7 (unchanged). Future recommended path: **KV write + async SQL replication via outbox**, guarded by idempotency keys, before any transactional dual-write. Divergence risks (partial writes, races, retry duplication, silent SQL failures) documented; none incurred in S7.

## Security Findings
Controls defined for: service-role bypass (gateway injects server-resolved org), RLS as defense-in-depth, org-scope injection (never client-supplied), client session scope (bind submission_id + org), fallback masking (fail-closed on auth/tenant), telemetry leakage (no values/PII), source-selection manipulation (mode server-resolved only), flag abuse (Edge-env, audited, kill switch), cross-tenant comparison (single-org compare, critical alert). Client-portal SQL enablement and Mode C require recorded human review (Art. 8).

## Files Created
1. `architecture/database/MCV2-S7.1-RUNTIME-STORAGE-GATEWAY-ARCHITECTURE.md`
2. `architecture/database/MCV2-S7.1-RUNTIME-READ-DEPENDENCY-MAP.md`
3. `architecture/database/MCV2-S7.1-DUAL-READ-ROLLOUT-PLAN.md`
4. `architecture/database/MCV2-S7.1-IMPLEMENTATION-FILE-PLAN.md`
5. `architecture/database/MCV2-S7.1-TEST-PLAN.md`
6. `architecture/database/MCV2-S7.2-IMPLEMENT-006-PROMPT-DRAFT.md` (draft; not run)
7. `architecture/database/MCV2-S7.1-PLAN-006-COMPLETION.md` (this report)

## Files Modified
- `ARCHITECT.md` — task-lookup + S7.1 doc references (index only).
- `architecture/system_map.json` — added `storage_gateway_plan` block; bumped `_meta.generated` (index only).
- `architecture/database/MCV2-S3-MIGRATION-ROADMAP.md` — Phase 3 status note pointing to S7.1 plan (index only).

## Runtime Changes
**none.**

## Constitution Compliance
- Art. 3 (frontend gateway): preserved — `dataService`/`api.ts` untouched.
- Art. 4/7 (phased migration): per-entity, per-mode; dual-read designed, not enabled.
- Art. 5/8 (RLS/human review): org scoping enforced at gateway; client-portal + Mode C gated on human review.
- Art. 12/17 (no unauthorized cutover / validation precedes authority): KV authoritative; no authority change; SQL reads not enabled.
- Art. 16 (scope): S7.2 not started; only S7.1 deliverables produced.
- Drift review: all 8 questions pass (architecture doc Stage 16).

## Risks
- **Derived report normalization** (no KV source key) — highest; mitigated by dedicated normalization pilot, last in rollout.
- **`index.tsx` is high-conflict** (3705 lines, shared) — mitigated by minimal per-route inserts, Mode A inert default, independent reverts.
- **Submission backfill (S6.3) not yet done** — submission shadow reads blocked until reconciliation complete; sequenced accordingly.
- **Tenant model shift** (single-tenant KV → org-scoped SQL) — mitigated by fail-closed policy + critical alerts.
- **No existing runtime test suite** — S7.2 must stand up `tests/storage/` + `npm run test:storage`.

## Required Human Decisions
1. Approve telemetry destination: dedicated `cortex.storage_read_telemetry` table (recommended) vs extend `migration_reconciliation_log`.
2. Confirm S6.3 submission backfill precedes submission-entity shadow reads.
3. Sign-off authority for client-portal read wiring (Art. 8, high-risk isolation domain).
4. Approve latency budget value (p95 SQL − p95 KV) before Mode B eligibility.
5. Authorize starting S7.2 (this sprint does not auto-start it).

## Recommended Next Phase
MCV2-S7.2 implementation only (draft prompt at `MCV2-S7.2-IMPLEMENT-006-PROMPT-DRAFT.md`).

---

*End of completion report. Runtime changes: none.*
