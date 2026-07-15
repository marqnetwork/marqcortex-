# MCV2-S7.5 — Outcome Shadow Staging Enablement Runbook

**Sprint:** `MCV2-S7.5-VALIDATE-010`
**Purpose:** the exact, ordered, reversible steps to run the live Outcome shadow validation once a Supabase service-role environment with backfilled `outcomes` is available.
**Invariant at every step:** KV authoritative, SQL never returned to users, one-flag rollback.

---

## Preconditions (all must hold before step 1)

| # | Precondition | How to verify |
|---|--------------|---------------|
| 1 | Diagnostic gateway deployed (S7.2–S7.4) | `storage/` present; `npm run test:storage` green |
| 2 | Outcome backfill run for target org | `outcomes.value` populated; `legacy_kv_key='outcome:{id}'` set |
| 3 | Reconciliation baseline recorded | `migration_reconciliation_log` for outcomes |
| 4 | Service-role env available | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set for the edge function |
| 5 | Target org id known | real `organizations.id` (uuid) for the allowlisted org |
| 6 | Offline dry-run passing | `npm run storage:shadow-dryrun` → PASS |

## Enablement sequence (staging)

> Set flags as **edge function secrets** (server-side). Never in frontend/`.env.local` committed files.

1. **Confirm KV-only baseline.** With no shadow flags set, hit `GET /submissions/:id/outcome` → identical envelope, no SQL calls in logs. (`STORAGE_SHADOW_OUTCOME_ENABLED` unset ⇒ disabled.)
2. **Set tenant scope + environment label (still disabled):**
   - `STORAGE_SHADOW_DEFAULT_ORG_ID=<target-org-uuid>`
   - `STORAGE_ENVIRONMENT=staging`
   - `STORAGE_SHADOW_SQL_TIMEOUT_MS=250`
   Deploy. Shadow still off (`ENABLED` unset). No behavior change.
3. **Restrict to the target org:**
   - `STORAGE_SHADOW_OUTCOME_ORG_ALLOWLIST=<target-org-uuid>`
4. **Enable shadow (internal/staging only):**
   - `STORAGE_SHADOW_OUTCOME_ENABLED=true`
   Deploy. Shadow now runs for the allowlisted org only.
5. **Drive reads.** Exercise `GET /submissions/:id/outcome` for known submissions (some with SQL rows, some without). Confirm responses are byte-identical to KV.
6. **Collect telemetry** per `MCV2-S7.5-TELEMETRY-ALERTING-SPEC.md`. Review comparison outcomes.
7. **Soak** for the window in the go/no-go gates. Watch for `critical`/unexplained mismatches.

## Verification during the run

- Responses: `{success:true, outcome}` from KV, unchanged.
- `returned_source = kv` on every telemetry event.
- No SQL data ever appears in a response body.
- `authorization_mismatch` count = 0 (any occurrence → immediate stop, see rollback).

## Rollback (any time, no deploy)

`STORAGE_FORCE_KV_ONLY=true` **or** `STORAGE_SHADOW_OUTCOME_ENABLED=false` → instant KV-only. See `MCV2-S7.4-ROLLBACK-GUIDE.md`.

## After a clean soak

Proceed to the go/no-go gates (`MCV2-S7.5-GO-NO-GO-GATES.md`). Only after those pass may scope widen (more orgs, then the next entity) — never automatically.

## Live reconciliation = the dry-run, wired to real sources

The offline harness (`scripts/storage/outcome-shadow-dryrun.ts`) is the template. For the live batch reconciliation, replace:
- fixture KV store → live `kv` helper (`get('outcome:'+id)`),
- fixture SQL port → `createRuntimeOutcomeSqlPort()`,
- scenario list → real submission ids for the org,
and read the same summary (counts per comparison outcome, max severity, KV-always-returned). This is a **read-only** reconciliation; it changes nothing.

---

*End of staging runbook.*
