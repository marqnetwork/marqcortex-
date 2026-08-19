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

It then runs three more phases, each on its own scratch database:

**The lifecycle** (`harness/70_assert_lifecycle.sql`) — the real
`public.marq_sync_team_membership` and `public.marq_revoke_team_membership`,
over a freshly bootstrapped deployment:

- a demotion MOVES `role_id` and leaves exactly one live row (HIGH-1)
- promotion, and every arm of the role mapping, applied by the database
- an invite creates exactly one `active` MARQ membership (MED-1)
- a repeat sync writes nothing; a suspension survives a role change
- revocation twice — the second revokes nothing and still succeeds
- refusals: an unknown id, a deleted auth user, a NULL id
- nothing can emit `platform_admin`, and the ledger records every operation

**The roster artifact** (`harness/75_assert_roster_stamping.sql`) — the real
`cortex.stamp_team_roster` and `cortex.unstamp_team_roster`:

- refused: an empty roster, an unknown id, a closed account, a duplicate entry,
  a role the console cannot issue (`platform_admin` included), a malformed id,
  a member of another organization, a count that disagrees with the roster
- atomicity: a roster with one valid and one invalid entry stamps NEITHER
- the dry run — which is the DEFAULT — writes no user and no ledger row
- apply, then rerun: the same stamp, and still one live provenance row
- the merge keeps `platform_role` and every other unrelated key
- reversal restores what was there before, and SKIPS an account somebody has
  edited since; an unknown artifact raises rather than quietly doing nothing

**MED-2**, twice — the bootstrap must FAIL rather than admit fewer people than
it should, and leave nothing behind:

- `harness/80` removes `org_admin` from the seeded catalog. The pre-write check
  refuses.
- `harness/82` leaves the catalog intact and makes the INSERT silently drop one
  candidate. The post-write accounting assertion refuses.

In both, the runner asserts a NON-ZERO exit — "it ran fine" is the defect — and
then that no membership row and no provenance ledger survived.

Exit code `2` means no database was reachable — distinct from `1` so "not run"
is never reported as "passed".

### Static coverage (no database)

`tests/database/static_membership_bootstrap_migration.test.ts` and
`tests/database/static_membership_lifecycle_migration.test.ts`, under
`npm run test:database`. They assert what the migrations must never contain — a
literal UUID, a read of `raw_user_meta_data`, a `platform_admin` arm, an
organization taken as a parameter, a grant to `anon` or `authenticated`, a
roster path that mutates before it validates. The positive claims are the
runner's above.

Behaviour on the TypeScript side — that a demotion actually removes
`ai.agent.execute` from a resolved actor, that an unprovisioned account resolves
no authority — is `tests/features/membershipLifecycle.test.ts`
(`npm run test:lifecycle`), which drives the real authenticator, the real
`resolveOrganization` and the real `resolveActor`.

### Live invariants against a linked project

Safe against staging — it creates no users and rolls itself back:

```bash
psql "$DATABASE_URL" -f tests/database/membership_bootstrap.test.sql
```

It warns loudly when the database holds no eligible user, because a green run
over nobody is not evidence.

Granting `platform_admin` remains a manual, person-approved step. The one-time
app-metadata stamping is no longer manual SQL: it is
`cortex.stamp_team_roster`, driven by `scripts/roster/stamp-team-roster.mjs`.
See `architecture/database/MEMBERSHIP_BOOTSTRAP.md` for the full procedure, the
role mapping table and the ordered reversal.

## Rollback

```bash
psql "$DATABASE_URL" -f supabase/migrations/rollbacks/20260711050000_rollback_tenancy.sql
```

KV store is unaffected by rollback.
