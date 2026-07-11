# Cortex Database Tests — Tenancy Foundation (MCV2-S4)

## Purpose

SQL and static tests for Sprint `MCV2-S4-IMPLEMENT-001`. These files validate schema shape, RLS policy presence, and seed idempotency patterns.

## Prerequisites

- Supabase CLI **or** `psql` connected to a disposable Postgres 15+ database
- Migrations applied in order:
  1. `supabase/migrations/20260711050000_cortex_tenancy_foundation.sql`
  2. `supabase/migrations/20260711050001_cortex_tenancy_rls_and_seed.sql`

## Apply migrations (local)

```bash
# Option A — Supabase CLI (when installed)
supabase db reset

# Option B — psql
psql "$DATABASE_URL" -f supabase/migrations/20260711050000_cortex_tenancy_foundation.sql
psql "$DATABASE_URL" -f supabase/migrations/20260711050001_cortex_tenancy_rls_and_seed.sql
```

## Run SQL tests

```bash
psql "$DATABASE_URL" -f tests/database/tenancy_schema.test.sql
psql "$DATABASE_URL" -f tests/database/tenancy_rls.test.sql
psql "$DATABASE_URL" -f tests/database/tenancy_seed_idempotent.test.sql
```

## Run static validation (no database required)

```bash
node --test tests/database/static_migration.test.ts
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
