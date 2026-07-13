# MCV2-S6.2 — Lead/Contact Backfill Rollback Guide

**Sprint:** `MCV2-S6.2-IMPLEMENT-004`  
**Scope:** Bounded rollback for lead/contact backfill rows tagged with `metadata.migration_run_id`

---

## Principles

| Rule | Detail |
|------|--------|
| KV untouched | Rollback never reads or writes `kv_store_324f4fbe` |
| Run isolation | Only rows with matching `metadata.migration_run_id` are deleted |
| Pre-existing rows | Rows without migration metadata are preserved |
| FK order | `contact_methods` → `leads` → `contacts` |
| Infrastructure | Diagnostic tables and migration control tables are not dropped |

---

## CLI usage

### Dry-run preview

```powershell
node --experimental-strip-types scripts/migration/cli.ts --mode=rollback --runId=<UUID> --dry-run
```

### Live rollback

Requires:

- `--confirm`
- `MIGRATION_ROLLBACK_ENABLED=true`
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`

```powershell
$env:MIGRATION_ROLLBACK_ENABLED = "true"
$env:SUPABASE_URL = "https://oqybniefkbppptfatoae.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<service-role-key>"

node --experimental-strip-types scripts/migration/cli.ts --mode=rollback --runId=<UUID> --confirm
```

---

## SQL rollback (infrastructure only)

To drop migration control tables without touching diagnostic data:

```powershell
.\scripts\supabase-cli.ps1 db query --linked -f supabase/migrations/rollbacks/20260715050000_rollback_migration_infrastructure.sql
```

**Do not** run `20260714050000_rollback_diagnostic.sql` for S6.2 run rollback — that drops all diagnostic tables.

---

## Verification after rollback

1. `SELECT COUNT(*) FROM leads WHERE metadata->>'migration_run_id' = '<UUID>';` → 0
2. `SELECT COUNT(*) FROM contacts WHERE metadata->>'migration_run_id' = '<UUID>';` → 0
3. KV `lead:*` counts unchanged
4. `migration_runs` contains a `mode=rollback` audit row

---

*End of rollback guide*
