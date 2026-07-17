# MCV2-S7.6-VALIDATE-011 — Completion Report

**Sprint:** `MCV2-S7.6-VALIDATE-011` — Live Outcome Shadow Soak (reconciliation runner + execution)
**Date:** 2026-07-14
**Status:** **Engineering complete. Live soak execution BLOCKED / deferred — environment + approvals.**

- **Live reconciliation runner:** Complete (built, Node-tested aggregation, capability-gated CLI)
- **Live staging soak execution:** **Not performed** — no Supabase service-role env / backfilled `outcomes` here, and two human approvals (target org, telemetry destination) are still open. Not fabricated.

---

## Why the soak was not executed

S7.6's core deliverable is running the live staging Outcome shadow soak against Gates A–C. That requires, none of which exist in this environment:
- a Supabase service-role edge environment (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`),
- backfilled `outcomes.value` for a real org,
- human sign-off on the target org (`STORAGE_SHADOW_DEFAULT_ORG_ID`) and the telemetry destination.

Per the standing rule (Constitution Art. 10; every sprint's "do not fabricate live validation"), the soak is honestly marked **deferred** rather than simulated.

## What was delivered (the missing executable)

The one artifact the soak still needed: a **live, read-only reconciliation runner** that produces the Gate-C report against real sources.

- `scripts/storage/outcomeReconcile.ts` — pure, dependency-injected batch reconciliation: scans KV outcomes, reads the tenant-scoped SQL row per submission, compares via the shared comparator, aggregates a Gate-C report (`byOutcome`, `unexplainedMismatchCount`, `authorizationMismatchCount`, `errorCount`, `gateCReady`). Redacted samples only (hashed ref + outcome + field paths). Node-testable.
- `scripts/storage/outcome-shadow-reconcile.ts` — Deno CLI wiring live `kv` + `createRuntimeOutcomeSqlPort()`. **Capability-gated + fail-safe:** with no creds/org it prints "DEFERRED — capability unavailable", exits 0, changes nothing, never enables the runtime shadow. Read-only; KV stays authoritative.
- `tests/storage/reconcile.test.ts` — 6 tests: all-match Gate-C ready; value mismatch blocks + redacted samples (no raw values); authorization mismatch critical/blocks; target_missing tracked but non-blocking; SQL error blocks via error rate; KV entries without submissionId quarantined.

## Gate-C readiness logic

`gateCReady = unexplainedMismatch==0 && authorizationMismatch==0 && errorRate<0.5%`. Unexplained = value + relationship + schema + source_missing. `normalization_only_match` and `target_missing` are tracked and reported but do not block (they map to expected normalization + backfill coverage per `MCV2-S7.5-GO-NO-GO-GATES.md`).

## Tests and Commands

| Command | Result |
|---------|--------|
| `npm run test:storage` | **77/77** (adds 6 reconcile tests) |
| `npm run storage:shadow-dryrun` | PASS (S7.5 harness, unchanged) |
| `npm run test:database` / `test:migration` / `test:intelligence` | 19 / 36 / 8 |
| `npm run build` | Passes |
| `scripts/storage/outcome-shadow-reconcile.ts` (Deno CLI) | Not runnable here (no Deno/creds); capability-gate source-verified; runs under edge Deno |

## Runtime Impact
None. No `supabase/functions/server/**` runtime source changed. The reconcile runner is a standalone read-only script; the runtime shadow stays disabled by default; KV authoritative.

## SQL Returned to Users
never.

## Frontend / API Impact
none / none.

## Live Execution — exact resume steps

1. Provide a service-role edge env with backfilled `outcomes` for the target org.
2. Set `STORAGE_SHADOW_DEFAULT_ORG_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
3. Run the reconciliation CLI (read-only) → Gate-C report.
4. If Gate-C data criteria met, follow `MCV2-S7.5-OUTCOME-SHADOW-STAGING-RUNBOOK.md` to enable the live shadow soak (Gate A), watch telemetry (`MCV2-S7.5-TELEMETRY-ALERTING-SPEC.md`), and evaluate Gate C with recorded human sign-off.

## Constitution Compliance
KV authority preserved (Art. 4/17); no cutover (Art. 12); validation precedes authority (Art. 17); no fabricated evidence — live soak honestly deferred (Art. 10); scope held to Outcome (Art. 16); reconciliation read-only, no KV mutation (Art. 11).

## Risks
- Until `outcomes.value` backfill runs, the live reconcile will report mostly `target_missing` (expected; non-blocking, tracked).
- Live soak still requires the two open human approvals before enablement.

## Human Review Priority (unchanged, now blocking)
1. Approve target org for `STORAGE_SHADOW_DEFAULT_ORG_ID`.
2. Approve telemetry destination (log sink vs additive table — table needs separate approval).
3. Provide/point to a service-role environment with backfilled `outcomes`.

## Recommended Next Sprint
S7.6 live execution (same sprint id) once the environment + approvals exist — run the reconcile CLI, then the gated staging soak. Do not begin automatically.

---

*End of completion report.*
