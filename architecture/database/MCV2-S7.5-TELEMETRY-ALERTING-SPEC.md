# MCV2-S7.5 — Outcome Shadow Telemetry & Alerting Spec

**Sprint:** `MCV2-S7.5-VALIDATE-010`
**Applies to:** the storage read telemetry events emitted during the Outcome shadow soak.
**Privacy:** approved identifiers only — no raw outcome payload, email, or PII; entity ref is hashed.

---

## Event source

`StorageReadTelemetrySink` events emitted by the gateway shadow path (one per shadowed read). Phase-1/S7.4 uses a no-op sink in production and an in-memory sink in tests/dry-run. For the live soak, wire a sink that forwards to the chosen destination (log aggregation or an additive `cortex.storage_read_telemetry` table — **table creation requires explicit approval**, not assumed here).

## Fields consumed

`requestId`, `organizationId`, `entity` (`outcome`), `configuredMode` (`kv_primary_shadow_sql`), `returnedSource` (`kv`), `shadowAttempted`, `kvMs`, `sqlMs`, `comparisonOutcome`, `mismatchCount`, `mismatchSeverity`, `sqlErrorClass`, `environment`, `route`.

## Aggregations (per org, per hour)

| Metric | Definition |
|--------|------------|
| `shadow_count` | events with `shadowAttempted=true` |
| `outcome_dist` | count by `comparisonOutcome` |
| `unexplained_mismatch_rate` | (`value_mismatch`+`relationship_mismatch`+`schema_mismatch`+unexplained `source_missing`) / `shadow_count` |
| `normalization_only_rate` | `normalization_only_match` / `shadow_count` (expected baseline) |
| `target_missing_rate` | `target_missing` / `shadow_count` (tracks backfill coverage) |
| `sql_error_rate` | `error` / `shadow_count` |
| `sql_latency_p50/p95` | percentiles of `sqlMs` |
| `kv_latency_p50/p95` | percentiles of `kvMs` |
| `kv_returned_pct` | `returnedSource=kv` / total (must be 100%) |

## Alert thresholds

| Severity | Condition | Action |
|----------|-----------|--------|
| **Page** | any `authorization_mismatch` (critical) | trip kill switch, investigate tenant isolation |
| **Page** | `kv_returned_pct` < 100% | trip kill switch — invariant broken |
| High | `unexplained_mismatch_rate` > 0.1% (per org/hour) | investigate mapping/backfill |
| High | `sql_error_rate` > 5% | check SQL availability/timeout |
| Warn | `sql_latency_p95` > `kv_latency_p95` + budget | tune timeout / sampling |
| Warn | `target_missing_rate` rising | backfill coverage gap |

## Retention & sampling

- Retention: 30 days hot, 90 days aggregated rollup, then purge.
- Sampling: 100% for the first 48h of the soak; may sample thereafter (config), always 100% on any non-`match`/`normalization_only_match` outcome.

## Privacy controls (enforced by the pipeline)

- `entityRefHash` (FNV-1a of submissionId) — non-reversible; no raw ids for client entities.
- `mismatchFields` are field **paths** only — never values.
- No outcome payload, email, or free-text ever enters an event (verified by tests + dry-run: telemetry must not contain business values).
- `safeEmit` swallows sink errors — telemetry never affects a read.

## Dashboards (for the soak)

1. Comparison-outcome distribution (stacked, per org/hour).
2. Unexplained-mismatch rate trend with the 0.1% line.
3. KV vs SQL latency percentiles.
4. `kv_returned_pct` gauge (must read 100%).
5. Error-class breakdown.

---

*End of telemetry & alerting spec.*
