# DRAFT — MCV2-S7.2-IMPLEMENT-006 Implementation Prompt

**Status:** DRAFT. Do NOT run automatically. Requires human authorization to begin (Art. 16).
**Prepared by:** `MCV2-S7.1-PLAN-006`.

---

## Sprint: MCV2-S7.2-IMPLEMENT-006 — Diagnostic Storage Gateway (Read, Mode A default)

Continue from approved S7.1 planning state. Read S7.1 deliverables first; do not re-audit S1–S6.

### Objective
Implement the `DiagnosticStorageGateway` and read-strategy layer per
`architecture/database/MCV2-S7.1-RUNTIME-STORAGE-GATEWAY-ARCHITECTURE.md`,
wired into the ≤5 diagnostic **read** routes, shipping with **every flag defaulting to Mode A (KV-only)** so there is **no behavior change on deploy**.

### Locked rules
- KV remains authoritative. Default Mode A. No SQL read enabled by default.
- No dual-write. Writes stay KV-only, untouched.
- No route signature, response envelope, `dataService.ts`, or `api.ts` change.
- Business logic must not learn KV vs SQL. Return `ReadResult<DTO>`.
- Flags are Edge-env, server-resolved, fail-safe to `kv_only`.
- Additive telemetry table only; RLS + rollback SQL required.

### Build order (per file plan)
1. `storage/contracts.ts`, `storage/dto.ts`, `storage/normalize.ts` (pure; unit-tested).
2. `storage/kvAdapter.ts`, `storage/sqlAdapter.ts` (read-only; org-scoped).
3. `storage/flags.ts`, `storage/telemetry.ts`, `storage/readStrategy.ts`.
4. `storage/gateway.ts`, `storage/index.ts`.
5. `supabase/migrations/*_storage_read_telemetry.sql` + rollback.
6. Wire routes in `index.tsx`: outcome-get first, then submission get/list, client submission, report, cortex get.
7. Register manifest ids (before code), update `ARCHITECT.md` + `system_map.json`.

### Tests (must pass before completion)
Implement `tests/storage/` per `MCV2-S7.1-TEST-PLAN.md`; add `npm run test:storage`.
Envelope-regression (#17) and authority-invariant (#20) are blocking.

### Forbidden in S7.2
Enable Mode B/C/D by default · dual-write · change APIs/frontend · migrate more data · modify KV records · start S7.3 · flip any prod flag off `kv_only`.

### Completion standard
Gateway wired behind Mode A; all reads return `returnedSource=kv`; envelopes byte-identical; telemetry table applied; tests green; docs updated; **zero user-visible change**; human review recorded for client-portal wiring.

STOP after implementation. Do not enable shadow reads (that is S7.3 authority).
