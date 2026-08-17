# MCV2-S7.4 — Outcome Shadow Read

**Sprint:** `MCV2-S7.4` · **Status:** Implemented, disabled by default
**Authority:** KV remains the runtime storage authority. SQL is observed, never consulted.

---

## What this sprint adds

One observation, attached to one production read.

`GET /make-server-324f4fbe/submissions/:id/outcome` answers from
`kv_store_324f4fbe` exactly as it did before. Alongside that answer — after it,
off the request's critical path — the SQL `outcomes` row that should correspond
to the same record is read, the two are compared on a single axis, and the
comparison is written to `shadow_read_telemetry`.

The returned outcome is the KV record. Nothing in this sprint can change it,
delay it, or fail it.

| Guarantee | How it is held |
|-----------|----------------|
| KV authoritative | The route's response is built from `kv.get` before the shadow read is scheduled |
| No dual write | `OutcomeShadowReadPorts` exposes no write port for KV or for `outcomes` |
| No KV mutation | The module contains no key-value write; asserted by source scan in `tests/storage/` |
| SQL observation-only | The SQL access is a single `SELECT` through `getOutcomeByLegacyKey` |
| Non-blocking | `scheduleOutcomeShadowRead` returns before any port that reaches SQL is called |
| Cannot fail the read | `runOutcomeShadowRead` never rejects; every port failure is caught and recorded or logged |
| Flag off ⇒ no SQL work | The flag is read first; with it off, no repository is built and no port is reached |
| Tenant isolation | The read is filtered by `organization_id` in SQL, and a foreign row is discarded by a second guard |

---

## The canonical join axis

**There is exactly one.**

```
outcomes.legacy_kv_key = 'outcome:{submissionId}'
```

`submissionId` is the legacy KV identifier (`SUB-…`). It is **not**
`outcomes.submission_id`, which is a UUID foreign key to `submissions.id`,
minted by the relational schema and never equal to the legacy id in shape or in
value.

Correlating on `submission_id` with a `SUB-…` string does not find a different
row — it finds no row, or the driver raises on the type. Either way a fully
backfilled database reports as empty, and every observation reads
`sql_missing`. `legacy_kv_key` is the only column that carries KV identity
across, and `outcomes_legacy_kv_key_uidx` makes it unique for live rows, so the
correlation is one-to-one.

The read is tenant-scoped. That unique index is global, so an unscoped lookup by
key would cross tenants; `getOutcomeByLegacyKey(legacyKvKey, organizationId)`
filters on `organization_id` in SQL, and the shadow read additionally discards
any row whose `organization_id` is not the one it asked for
(`tenant_guard_tripped`).

---

## The comparison axis

**Conversion, and only conversion.**

| Store | Field | Meaning |
|-------|-------|---------|
| KV | `didConvert` (boolean) | Did the deal convert |
| SQL | `outcome_type` (`won` / `lost`) | Did the deal convert |
| SQL | `value.didConvert` | Fallback when `outcome_type` states nothing |

`outcomes.status` (`open` / `closed` / `archived`) is a **lifecycle** axis —
whether the record is being worked, settled, or filed. It is a different
business fact from conversion: a closed outcome is not a converted one, and an
open outcome is not an unconverted one. Comparing `didConvert` against `status`
compares two unrelated axes and reports disagreement for records that agree.

So the lifecycle status is **observed and recorded, never compared**. It is
written to `shadow_read_telemetry.sql_lifecycle_status` exactly as found, with
`sql_lifecycle_status_valid` saying whether it was one of the three schema
values. It never influences the classification, and it is not a parameter of
`classifyOutcomeShadowRead`.

---

## Classification

| Classification | Severity | Condition |
|----------------|----------|-----------|
| `match` | info | Both sides state a conversion fact and the facts agree |
| `partial` | low | Both rows exist; at least one side has not stated a conversion fact |
| `mismatch` | high | Both sides state a conversion fact and the facts are opposite |
| `sql_missing` | low | KV has the record; SQL has no row for the key in this tenant |
| `kv_missing` | high | SQL has a row; KV — the authority — has nothing |
| `both_missing` | info | Neither store has the record |
| `error` | low | The observation failed. Says nothing about the data |

**Incomplete is not wrong.** The backfill can create a row before filling its
business fields: `outcome_type` sits at the `'engagement'` default with an empty
`value`. That row states no conversion fact, so it cannot disagree with one. It
classifies `partial` at low severity — never `mismatch`, never high. Only two
determinate and opposite signals are a mismatch.

---

## The flag

`STORAGE_READ_TELEMETRY_ENABLED`

Strict opt-in: the shadow read runs only when the environment variable is the
exact string `true`. A missing variable, an empty one, `TRUE`, `1` or `yes` all
leave it off, and off means **no SQL work of any kind** — no repository is
constructed, no query is issued, no telemetry row is written.

One flag governs the whole feature. The SQL read and the telemetry write are the
same observation: enabling one without the other would either read without
recording or record without reading, so there is nothing for a second flag to
mean.

Default: **off**, in every environment, until S7.5 validation.

---

## Durability

`shadow_read_telemetry` is written through `record_shadow_read_telemetry`, a
`SECURITY DEFINER` insert-only function granted to `service_role` only
(migration `20260817120000_shadow_read_telemetry.sql`).

The write is awaited **inside** the same promise the scheduler was handed. On an
edge runtime the task is kept alive only while that promise is pending, so a
write started after it resolves is a write the platform may kill mid-flight.
`runOutcomeShadowRead` therefore reads, classifies and records in one lifetime,
and `scheduleOutcomeShadowRead` hands the runtime that whole promise —
`EdgeRuntime.waitUntil` where it exists, an unawaited promise where it does not.

The table's observed columns (`sql_lifecycle_status`, `sql_outcome_type`) carry
no CHECK constraint. They record what the row held, and a status that is null,
empty or not a schema value is precisely the finding this sprint exists to
surface; a constraint there would reject the evidence. The columns this codebase
produces — classification, severity, conversion signals — are constrained.

`detail` carries reason codes and presence booleans only. No business content:
whether a conversion figure exists, never what it is.

---

## Files

| Path | Role |
|------|------|
| `supabase/functions/server/storage/outcomeShadowRead.ts` | The observation: correlation, comparison, classification |
| `supabase/functions/server/index.tsx` | Port assembly and the one call site, in the outcome GET route |
| `supabase/functions/server/repositories/outcomeRepository.ts` | `getOutcomeByLegacyKey(legacyKvKey, organizationId)` |
| `supabase/migrations/20260817120000_shadow_read_telemetry.sql` | Table, RLS, insert-only RPC |
| `supabase/migrations/rollbacks/20260817120000_rollback_shadow_read_telemetry.sql` | Drops both |
| `tests/storage/outcome_shadow_read.test.ts` | `npm run test:storage` |
| `tests/database/static_shadow_read_telemetry_migration.test.ts` | Migration/RPC contract, in `npm run test:database` |

---

## Out of scope

S7.5 owns validation: running the shadow read against real traffic, reading the
telemetry, and deciding whether the two stores agree closely enough to move an
authority. Nothing in S7.4 moves one.
