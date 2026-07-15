# MCV2-S7.5 — Outcome Shadow Go/No-Go Gates

**Sprint:** `MCV2-S7.5-VALIDATE-010`
**Applies to:** the Outcome entity shadow read. Objective, binary criteria — no vague confidence score.

---

## Gate A — Enable live shadow (staging, allowlisted org)

All must be TRUE:

| # | Criterion | Evidence |
|---|-----------|----------|
| A1 | Offline dry-run passes | `npm run storage:shadow-dryrun` → PASS (9/9 categories, KV-always, SQL-never) |
| A2 | Storage suite green | `npm run test:storage` (71/71) |
| A3 | Outcome backfill complete for org | `outcomes.value` populated; `legacy_kv_key` set |
| A4 | Reconciliation baseline exists | `migration_reconciliation_log` for outcomes |
| A5 | Service-role env present | edge secrets set |
| A6 | Default org + allowlist configured | `STORAGE_SHADOW_DEFAULT_ORG_ID` = target; allowlist = target |
| A7 | Kill switch verified | `STORAGE_FORCE_KV_ONLY=true` flips to KV-only in staging |

## Gate B — Continue the soak (stop conditions)

STOP (set `STORAGE_FORCE_KV_ONLY=true`) immediately if ANY occurs:

| # | Stop condition |
|---|----------------|
| B1 | Any `authorization_mismatch` (critical) event |
| B2 | Any SQL data observed in a response body |
| B3 | User-path p95 latency regresses beyond budget (KV p95 + agreed delta) |
| B4 | SQL error rate > 5% sustained |
| B5 | Any unhandled rejection / gateway exception attributable to the shadow |

## Gate C — Declare Outcome shadow validated (exit)

All must be TRUE over the soak window (≥ 7 days staging, or agreed):

| # | Criterion | Threshold |
|---|-----------|-----------|
| C1 | Unexplained mismatch rate | `value_mismatch` + `relationship_mismatch` + `schema_mismatch` + `source_missing` (unexplained) = 0 |
| C2 | Normalization-only baseline documented | `normalization_only_match` rate recorded + explained |
| C3 | `target_missing` explained | tracked to backfill coverage (not a defect) |
| C4 | Authorization mismatches | 0 |
| C5 | SQL error rate | < 0.5% |
| C6 | Latency | user-path p95 within budget (shadow is background) |
| C7 | KV always returned | `returned_source=kv` on 100% of events |
| C8 | SQL never returned | 0 responses carrying SQL data |
| C9 | Kill switch + rollback exercised live | recorded |
| C10 | No unclassified telemetry | every event has a comparison outcome |
| C11 | Human approval recorded | named reviewer (Art. 8) |

## Gate D — Expand beyond Outcome (next entity)

Only after Gate C passes AND the next entity has its own backfill + reconciliation complete. Expansion is per-entity and re-runs Gates A–C for that entity. Never automatic.

---

*A No-Go at any gate keeps the system KV-only. Cutover to SQL authority is out of scope for S7 and requires the separate authority-change gates (S7.1 Stage 10).*
