# MCV2-S7.4 — Durable Shadow-Read Telemetry (retention & concurrency)

**Sprint:** `MCV2-S7.4-IMPLEMENT-009` (remediation · G4)
**Scope:** Diagnostic aggregation only. Never authoritative, never read by the
runtime, never surfaced to users. Field paths only — no raw values, no PII.

---

## Store

| Object | Purpose |
|--------|---------|
| `public.shadow_read_telemetry` (table) | One aggregate row per `(domain, status, mismatch_fields)`. |
| `public.record_shadow_read_telemetry(text, text, text[])` (RPC) | Atomic upsert-increment. |

**Columns:** `id`, `domain`, `status` (checked against the seven canonical
statuses), `mismatch_fields text[]`, `occurrence_count bigint`,
`first_observed_at`, `last_observed_at`. Unique key: `(domain, status,
mismatch_fields)`.

## Write path

The durable sink (`storage/durableTelemetry.ts`) emits a structured log line
first (fallback evidence) and then **schedules** the RPC call on the background
scheduler (`EdgeRuntime.waitUntil` / detached). The write therefore never blocks
the KV response or the shadow read, and any failure is swallowed (the log line
remains as evidence). Only shadow comparison events (those carrying a
`comparisonStatus`) are persisted; plain KV reads are ignored.

## Concurrency

Aggregation is performed by a single SQL statement:

```sql
INSERT INTO public.shadow_read_telemetry AS t
  (domain, status, mismatch_fields, occurrence_count, first_observed_at, last_observed_at)
VALUES ($1, $2, COALESCE($3, '{}'), 1, now(), now())
ON CONFLICT (domain, status, mismatch_fields)
DO UPDATE SET occurrence_count = t.occurrence_count + 1,
              last_observed_at = now();
```

- **Atomic:** `INSERT … ON CONFLICT DO UPDATE` takes a row lock on the
  conflicting row, so concurrent writers from **any edge instance** fold into
  one row with no lost updates and no read-modify-write race.
- **Cross-instance:** state lives in Postgres, shared by all instances.
- **Restart-safe:** aggregates survive cold starts and redeploys — nothing is
  held in process memory. `first_observed_at` is set once on insert and never
  moved; `last_observed_at` advances on every observation.
- `mismatch_fields` is sorted before the call (`durableTelemetry.ts`), so field
  order never fragments an aggregate into duplicate rows.

## Retention

- **Default:** rows persist indefinitely; the store is bounded by the number of
  **distinct** `(domain, status, mismatch_fields)` combinations, not by request
  volume, so it stays small in practice.
- **Pruning (operational):** stale aggregates may be pruned by
  `last_observed_at`, e.g. `DELETE FROM public.shadow_read_telemetry WHERE
  last_observed_at < now() - interval '90 days';` (indexed on
  `last_observed_at`). No automatic expiry/partitioning is created in this
  sprint — pruning is a manual/operational choice to avoid over-engineering a
  diagnostic table.
- **Rollback:** `rollbacks/20260727090000_rollback_shadow_read_telemetry.sql`
  drops the RPC and table; KV is unaffected.

## Access

RLS is enabled with no permissive policies. The runtime writes via the service
role (RLS-bypassing) through the `SECURITY DEFINER` RPC, which is granted to
`service_role` only. Anon/authenticated clients have no access.

---

*End of durable telemetry spec.*
