# MCV2-S7.5-VALIDATE-010 — Completion Report

**Sprint:** `MCV2-S7.5-VALIDATE-010` — Outcome Shadow-Read Validation & Live Readiness
**Date:** 2026-07-14
**Status:** **Completed (offline validation + live readiness).** Live staging shadow run deferred (environment capability).

- **Engineering / offline validation:** Complete
- **Live shadow validation:** Deferred — no Supabase service-role/network/backfilled data in this environment (not fabricated)

---

## Executive Summary

The Outcome shadow read (S7.4) could not be validated live here because no service-role Supabase environment or backfilled `outcomes` data is available. Per the standing rule against fabricating live validation, S7.5 instead delivers everything that makes the eventual live run mechanical and safe: a **runnable offline reconciliation dry-run harness** that exercises the full shadow→normalize→compare→telemetry pipeline against fixtures across every comparison category, plus a staging enablement runbook, objective go/no-go gates, and a telemetry/alerting spec. A flaky-test robustness issue in the S7.4 suite was found and fixed. No runtime behavior changed; KV remains authoritative and shadow stays disabled by default.

## Offline Validation Performed

`npm run storage:shadow-dryrun` (and `tests/storage/dryrun.test.ts`) drive the gateway with shadow enabled against a fixture SQL port + fixture KV, one scenario per comparison category:

| Category | Result | Severity |
|----------|--------|----------|
| match | ✅ classified | info |
| normalization_only_match | ✅ | info |
| target_missing | ✅ | low |
| source_missing | ✅ | high |
| value_mismatch | ✅ | high |
| relationship_mismatch | ✅ | high |
| authorization_mismatch | ✅ | critical |
| schema_mismatch | ✅ | high |
| error | ✅ | high |

Invariants asserted every scenario: `returned_source=kv`, **SQL never returned**, exactly one telemetry event, **no raw payload in telemetry**. Summary: 9/9 expected classifications, `kvAlwaysReturned=true`, `sqlEverReturned=false`, `maxSeverity=critical`.

## Defect Found and Fixed

- **Flaky storage suite** (intermittently 62 tests / 1 fail vs 70/70): a fake SQL port in `outcomeShadow.test.ts` left a dangling `setTimeout` (the timeout scenario's 100 ms delay) alive after the test asserted, occasionally leaking async activity across the run. Fixed by `unref()`-ing the timer. Now stable — 3× consecutive 71/71. **Test-harness only; no product change.**

## Live Readiness Artifacts

- **Staging enablement runbook** (`MCV2-S7.5-OUTCOME-SHADOW-STAGING-RUNBOOK.md`): preconditions, ordered flag sequence, verification, one-flag rollback, and how the dry-run maps onto the live read-only reconciliation.
- **Go/No-Go gates** (`MCV2-S7.5-GO-NO-GO-GATES.md`): objective Gate A (enable), Gate B (stop conditions), Gate C (declare validated), Gate D (expand). No confidence score.
- **Telemetry & alerting spec** (`MCV2-S7.5-TELEMETRY-ALERTING-SPEC.md`): aggregations, alert thresholds (page on any authorization_mismatch or KV-not-returned), retention/sampling, privacy controls, dashboards.

## Tests and Commands

| Command | Result |
|---------|--------|
| `npm run test:storage` | **71/71** (adds the dry-run test) — stable across repeated runs |
| `npm run storage:shadow-dryrun` | PASS (9/9 categories, KV always, SQL never) |
| `npm run test:database` | 19/19 |
| `npm run test:migration` | 36/36 |
| `npm run test:intelligence` | 8/8 |
| `npm run build` | Passes |

## Files Created
- `scripts/storage/outcome-shadow-dryrun.ts` (runnable offline reconciliation harness)
- `tests/storage/dryrun.test.ts`
- `architecture/database/MCV2-S7.5-VALIDATE-010-COMPLETION.md` (this)
- `architecture/database/MCV2-S7.5-OUTCOME-SHADOW-STAGING-RUNBOOK.md`
- `architecture/database/MCV2-S7.5-GO-NO-GO-GATES.md`
- `architecture/database/MCV2-S7.5-TELEMETRY-ALERTING-SPEC.md`

## Files Modified
- `tests/storage/outcomeShadow.test.ts` — unref the fake port's delay timer (flakiness fix).
- `package.json` — added `storage:shadow-dryrun` script.
- `ARCHITECT.md`, `architecture/system_map.json`, `MCV2-S3-MIGRATION-ROADMAP.md` — status/index.

## Runtime Impact
None. No `supabase/functions/server/**` runtime source changed. Shadow stays disabled by default; KV authoritative.

## SQL Returned to Users
never.

## Frontend Impact
none.

## API Impact
none.

## Live Validation Status
Deferred — environment capability. Resume steps are fully specified in the staging runbook + go/no-go gates; the live reconciliation reuses the dry-run harness with the live KV helper and `createRuntimeOutcomeSqlPort()`.

## Constitution Compliance
KV authority preserved (Art. 4/17); no cutover (Art. 12); validation precedes authority (Art. 17); rollback + telemetry documented (Art. 9); scope held to Outcome (Art. 16); no fabricated evidence (Art. 10 — live run honestly marked deferred).

## Risks
- `outcomes.value` backfill not yet run → live shadow will report mostly `target_missing` until backfill (expected, low severity; tracked as a metric).
- Edge background execution is best-effort for telemetry capture (documented; future `waitUntil`).

## Human Review Priority
1. Approve the target org + `STORAGE_SHADOW_DEFAULT_ORG_ID` for the staging run.
2. Approve the telemetry destination (log sink vs additive table — table needs separate approval).
3. Sign-off before setting `STORAGE_SHADOW_OUTCOME_ENABLED=true` live (Gate A).

## Recommended Next Sprint
S7.6 — execute the live staging Outcome shadow soak against Gates A–C once a service-role environment with backfilled `outcomes` is available; then, only after Gate C, evaluate the next entity. Do not begin automatically.

---

*End of completion report.*
