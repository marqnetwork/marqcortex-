# Cortex Database Tests — Tenancy (S4) + Diagnostic (S5)

## Purpose

SQL and static tests for:
- `MCV2-S4-IMPLEMENT-001` — tenancy foundation
- `MCV2-S5-IMPLEMENT-002` — diagnostic domain foundation

## Prerequisites

- Supabase CLI **or** `psql` connected to a disposable Postgres 15+ database
- Migrations applied in order (see `supabase/migrations/`)

## Run SQL tests

```bash
# Static (no DB)
npm run test:database
npm run test:migration

# Live — linked Supabase project (Windows)
$env:SUPABASE_ACCESS_TOKEN = "<token>"
.\scripts\supabase-cli.ps1 db query --linked -f tests/database/diagnostic_schema.test.sql
.\scripts\supabase-cli.ps1 db query --linked -f tests/database/diagnostic_rls.test.sql
.\scripts\supabase-cli.ps1 db query --linked -f tests/database/diagnostic_live_rls.test.sql
.\scripts\supabase-cli.ps1 db query --linked -f tests/database/diagnostic_anon_policy_review.test.sql
.\scripts\supabase-cli.ps1 db query --linked -f tests/database/diagnostic_repository_live.test.sql
```

## Run static validation (no database required)

```bash
npm run test:database
```

## Membership bootstrap (manual)

User memberships are **not** auto-seeded. After migrations, link existing Auth users:

```sql
-- Replace :user_id with a real auth.users.id from Supabase dashboard
INSERT INTO organization_memberships (organization_id, user_id, role_id, status, joined_at)
SELECT o.id, :user_id, r.id, 'active', now()
FROM organizations o
JOIN roles r ON r.key = 'org_admin' AND r.is_system = true
WHERE o.slug = 'marq' AND o.deleted_at IS NULL
ON CONFLICT DO NOTHING;
```

See `architecture/database/MEMBERSHIP_BOOTSTRAP.md` for full procedure.

## Rollback

```bash
psql "$DATABASE_URL" -f supabase/migrations/rollbacks/20260711050000_rollback_tenancy.sql
```

KV store is unaffected by rollback.
