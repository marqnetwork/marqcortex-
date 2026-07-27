# MCV2-S7.4-IMPLEMENT-001 — Outcome Shadow Read Completion Report

**Sprint:** `MCV2-S7.4` — Runtime Storage Gateway · Outcome Shadow Read
**Date:** 2026-07-27
**Status:** **Completed (engineering + tests + docs)**
**Runtime authority:** KV (unchanged)

---

## Summary

Introduced a non-authoritative outcome shadow read on the runtime read path. When
enabled, `GET /submissions/:id/outcome` reads the authoritative KV record
(`outcome:{submissionId}`) and, additionally, reads the SQL `outcomes` shadow (by
`legacy_kv_key`), compares a normalized projection, and records telemetry. KV
remains the sole source of truth — the SQL read never alters or fails the route
response. The feature is **off by default** and gated per domain via a server-side
Edge secret.

This is the first sprint that wires the S3–S5 SQL repositories into a live runtime
route (previously "not wired to routes"), establishing the shadow-read comparison
and telemetry surface the Phase 5 SQL cutover will depend on.

---

## Files Created

| Path | Purpose |
|------|---------|
| `supabase/functions/server/runtime/env.ts` | Env reader with Node test override (mirrors `intelligence/env.ts`) |
| `supabase/functions/server/runtime/config.ts` | `RUNTIME_SHADOW_READ_OUTCOME` flag (default **false**) |
| `supabase/functions/server/runtime/contracts.ts` | Provider-neutral shadow-read types |
| `supabase/functions/server/runtime/shadowTelemetry.ts` | In-memory ring buffer + structured log (mirrors `intelligence/telemetry.ts`) |
| `supabase/functions/server/runtime/outcomeShadowRead.ts` | Pure comparison + guarded orchestration (no `jsr:` import) |
| `supabase/functions/server/runtime/outcomeShadowReadWiring.ts` | Production wiring to `outcomeRepository` (Edge-only) |
| `supabase/functions/server/runtime/outcomeShadowRead.test.ts` | 16 Node unit tests |

## Files Modified

| Path | Change |
|------|--------|
| `supabase/functions/server/index.tsx` | Import + one guarded shadow-read call inside `GET /submissions/:id/outcome` |
| `package.json` | Added `test:runtime` script |

---

## Design Decisions

1. **KV stays authority.** The shadow read is additive, side-effect free, and
   never mutates the response. On any SQL error it records `error` telemetry and
   returns — the route is untouched.
2. **Off by default.** `RUNTIME_SHADOW_READ_OUTCOME` defaults to `false`, matching
   the roadmap's "Shadow Reads: Disabled" runtime authority state. Operators enable
   it per domain via Edge secrets; no frontend env var is introduced.
3. **Dependency injection over direct import.** The comparison core takes an
   injected `OutcomeSqlReader`, so it carries no `jsr:`/Supabase import and runs
   under the Node `--experimental-strip-types` runner. Only the Edge-only wiring
   file touches the repository.
4. **Conservative comparison.** Business fields (`didConvert`, `conversionValue`)
   are compared only when both sides carry a non-null value; a KV record with no SQL
   row surfaces as `missing_sql` rather than false `mismatch` noise. This is the
   correct signal during partial/absent backfill.
5. **Reused established patterns.** Env override, telemetry ring buffer, and
   colocated Node tests all follow the shipped `intelligence/` domain.

---

## Enable / Rollback

| Level | Action |
|-------|--------|
| Enable | Set `RUNTIME_SHADOW_READ_OUTCOME=true` in Edge secrets |
| L1 rollback | Set `RUNTIME_SHADOW_READ_OUTCOME=false` (immediate; default) |
| L2 rollback | Remove the single call in `index.tsx` outcome GET route |
| L3 rollback | Delete `supabase/functions/server/runtime/` |

---

## Validation Results

| Command | Result |
|---------|--------|
| `npm run test:runtime` | PASS — 16/16 (new) |
| `npm run test:intelligence` | PASS — 8/8 |
| `npm run test:database` | PASS — 19/19 |
| `npm run test:migration` | PASS — 36/36 |
| `npm run test:features` | PASS — 48/48 |
| `npm run build` | PASS (exit 0, ~26s) |
| `npm run test:smoke` | Not run — documented pre-existing baseline failure (MCV2-S1-AUDIT-001 §13), unrelated to this sprint |

---

## Assumptions & Notes

1. **SQL projection shape.** The SQL `outcomes` table stores business fields
   (`didConvert`, `conversionValue`) inside the `value` JSONB column (no dedicated
   columns exist). The wiring extracts them best-effort; the conservative
   comparison tolerates absent fields.
2. **Roadmap vs. code.** The roadmap marks S7.1–S7.3 (Runtime Gateway
   Planning/Implementation/Validation) complete, but no runtime-gateway/shadow-read
   scaffolding existed in the codebase prior to this sprint. This work establishes
   the minimal, self-contained runtime shadow-read surface for the Outcome domain.
   See Parking Lot.

---

## Parking Lot (unrelated findings — not addressed here)

- **S7.1–S7.3 scaffolding absent in code** despite roadmap ✅ status. A shared
  runtime-gateway abstraction (domain-agnostic shadow-read orchestrator + read
  authority switch) is not present; this sprint delivered only the Outcome slice.
- **No `outcomes` KV→SQL backfill implemented.** `migration/domains/` contains only
  `leads.ts`. Until outcome backfill runs, shadow reads will predominantly report
  `missing_sql` (expected, and the intended signal).
- **Optional diagnostics route** to expose `getRecentShadowReads()` (parallel to the
  intelligence telemetry surface) not wired — out of this slice's scope.
- **Pre-existing smoke failure** (`tests/smoke/diagnostic-score-team-login.spec.ts`)
  remains, per prior audit baseline.

---

## Recommended Next Task

**MCV2-S7.5 — Outcome Shadow Read Validation:** implement the `outcomes` KV→SQL
backfill domain, enable `RUNTIME_SHADOW_READ_OUTCOME` against a validation dataset,
and reconcile shadow-read telemetry (target: `match` for backfilled rows,
zero unexplained `mismatch`).

---

*End of completion report*
