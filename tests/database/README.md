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

## Membership bootstrap (automated)

User memberships are seeded by migration
`20260818120000_marq_team_membership_bootstrap.sql`. It derives real ids from
`auth.users` — it never invents one — maps `user_metadata.teamRole` to the
seeded system role catalog, and inserts an `active` membership in the MARQ
organization only where no undeleted membership already exists. Re-running it
changes nothing.

Static coverage: `tests/database/static_membership_bootstrap_migration.test.ts`
(runs under `npm run test:database`).

Live coverage — safe against staging, it creates no users and rolls itself back:

```bash
psql "$DATABASE_URL" -f tests/database/membership_bootstrap.test.sql
```

Manual insertion is still required for accounts that are not
`user_metadata.role = 'team'`, and for platform administrators. See
`architecture/database/MEMBERSHIP_BOOTSTRAP.md` for the full procedure and the
role mapping table.

## Rollback

```bash
psql "$DATABASE_URL" -f supabase/migrations/rollbacks/20260711050000_rollback_tenancy.sql
```

KV store is unaffected by rollback.
