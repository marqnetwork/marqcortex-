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

## Membership bootstrap

User memberships are seeded by migration
`20260818120000_marq_team_membership_bootstrap.sql`. It derives real ids from
`auth.users` — it never invents one — admits only accounts carrying the
server-written assertion `raw_app_meta_data.marq_team = true`, maps
`raw_app_meta_data.team_role` to the seeded system role catalog, and inserts an
`active` membership in the MARQ organization only where **no membership row
exists at all** for that (organization, user). A soft-deleted membership is
history, and history blocks re-admission. Re-running it changes nothing.

`raw_user_meta_data` is not read. GoTrue's `PUT /auth/v1/user` lets an account
holder write it, so it cannot decide who is on the team — see
`architecture/database/MEMBERSHIP_BOOTSTRAP.md` for the correction and for the
one-time stamping step that existing accounts need.

### Empirical scenarios (needs a real PostgreSQL 15+)

```bash
npm run test:database:scenarios
# or: DATABASE_URL=postgresql://... node scripts/membership-bootstrap-scenarios.mjs
```

Builds its own scratch database, applies the **real** migration and rollback
files against a committed fixture, and covers:

- eligible users admitted, ineligible ones not — including an account asserting
  `role=team` in USER metadata, which must be admitted nowhere
- the role mapping, `manager` included (it resolves to `team_viewer`, not
  `org_admin`)
- a soft-deleted membership neither revived nor duplicated
- idempotency across three runs
- the rollback: a pre-existing membership survives, one created afterwards
  survives, a bootstrap-created one is reverted, a modified one is skipped
  rather than overwritten, `platform_admin` is untouched
- a demonstration, on real rows, that the `updated_at = created_at` heuristic
  this replaced would have revoked a membership it never created
- four concurrent bootstraps producing no duplicate and no error

Exit code `2` means no database was reachable — distinct from `1` so "not run"
is never reported as "passed".

### Static coverage (no database)

`tests/database/static_membership_bootstrap_migration.test.ts`, under
`npm run test:database`. It asserts what the migration must never contain; the
positive claims are the runner's above.

### Live invariants against a linked project

Safe against staging — it creates no users and rolls itself back:

```bash
psql "$DATABASE_URL" -f tests/database/membership_bootstrap.test.sql
```

It warns loudly when the database holds no eligible user, because a green run
over nobody is not evidence.

Manual steps remain for platform administrators and for the one-time app-metadata
stamping. See `architecture/database/MEMBERSHIP_BOOTSTRAP.md` for the full
procedure and the role mapping table.

## Rollback

```bash
psql "$DATABASE_URL" -f supabase/migrations/rollbacks/20260711050000_rollback_tenancy.sql
```

KV store is unaffected by rollback.
