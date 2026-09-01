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

## AI provider administration (AI-01 Batch 4C)

Migration `20260828120000_ai_provider_administration.sql` creates the three
tables and the one function the platform's AI provider administration layer
runs on. It holds encrypted credential material, so who may touch it is not a
detail — and both of the things that decide that (table privileges, and row
level security) are properties of a running PostgreSQL, not of a file.

### Executable verification (needs a real PostgreSQL 15+)

```bash
npm run test:database:4c
# or: DATABASE_URL=postgresql://... node scripts/ai-provider-administration-scenarios.mjs
```

**This is the verification.** Batch 4C originally shipped with a text-scanning
test and nothing else, and that test reported the migration healthy while it
contained two CHECK constraints with one name — which PostgreSQL rejects, so the
migration could not be applied anywhere — and while it granted `service_role`
nothing at all, so every runtime operation would have failed with `permission
denied`. Both defects were found by an independent production gate, not by the
suite. A text scan proves absence well and behaviour not at all.

The runner builds its own scratch databases and applies the **real** migration
and rollback files. It applies them as a NOSUPERUSER role holding `BYPASSRLS` —
the shape of the role Supabase applies migrations as — because
`ai_provider_credential_activate` is `SECURITY DEFINER` writing through `FORCE
ROW LEVEL SECURITY`, and a superuser owner would sail past a check a deployment
has to pass.

Three phases:

**Apply and verify.**

- the migration applies at all, and in one transaction
- the three tables, every named constraint, every index — including the two
  partial unique indexes and the one-active-credential index
- the activation function exists, `SECURITY DEFINER`, with the exact argument
  types AND parameter names PostgREST binds by
- `service_role` drives the FULL runtime lifecycle, statement for statement as
  `aiProviderAdministrationStore.ts` issues it: the configuration upsert, the
  `IS NULL` platform lookup, the activation RPC, the sealed-record read, the
  metadata-only projection, rotation, revocation, and the model upsert
- activation ATOMICITY, asked at psql's statement level rather than inside a
  plpgsql exception handler — a handler's savepoint would undo the supersede
  whether or not the function is atomic, and the failing rotation has to be its
  own transaction to mean anything
- exactly one active credential per configuration, with the rotation history
  intact
- plaintext-shaped storage refused: nine sealed-record shapes somebody could
  plausibly write, a raw key in the key-identity column, an over-long
  `last_four`
- the platform/organization scope constraints, both partial unique indexes, and
  the malformed-provider-key refusal
- the FULL privilege matrix — every privilege PostgreSQL defines, for
  `service_role`, `authenticated` and `anon`, on all three tables — so a
  privilege nobody intended fails as loudly as one that is missing
- `anon` and `authenticated` denied read AND mutate, by catalogue and by
  attempt, on all three tables; neither may execute the activation function;
  `service_role` may
- RLS still denies `authenticated` even with a `SELECT` grant temporarily in
  place, which is the redundancy the design claims

**Roll back and re-apply.** The real rollback removes every 4C object and
nothing else — the tenancy foundation, the seeded roles and the schema grants
are all still there — and the migration then applies again cleanly.

**A failed migration leaves no partial state.** An obstacle is planted so the
migration fails at its LAST statement, after all three tables have been created
inside its transaction. Nothing survives. This one matters more than it looks:
the migration uses `CREATE TABLE IF NOT EXISTS`, so a half-applied 4C would be
silently re-appliable and the second run would produce a schema nobody reviewed.

Exit code `2` means no database was reachable, and is reported as **BLOCKED**.
It is distinct from `1` so "not run" is never read as "passed".

### Static coverage (no database)

`tests/database/static_ai_provider_administration_migration.test.ts`, under
`npm run test:database`. It proves what the migration must never contain: a
plaintext column, a grant to a browser role, a policy on the credential table, a
seeded provider, a copy of an environment secret, a `GRANT ALL`, a `DELETE` or
`TRUNCATE` for `service_role`, or two constraints sharing a name. Every
behavioural claim is the runner's above, and the file says so where it could be
mistaken.

## Customer BYOK (AI-01 Batch 4D)

Migration `20260901120000_ai_customer_byok.sql` admits CUSTOMER-owned provider
credentials into the three tables Batch 4C created. **It creates no table.** The
4C schema already carried `scope`, `organization_id`, the scope/tenancy CHECK
and the partial unique index reserved for this batch; 4D adds one non-secret
policy column, two constraints, one index and one trigger.

### Executable verification (needs a real PostgreSQL 15+)

```bash
npm run test:database:4d
# or: DATABASE_URL=postgresql://... node scripts/ai-customer-byok-scenarios.mjs
```

**This is the verification.** The claim Batch 4D makes is TENANT ISOLATION, and
its interesting failures are all silent ones: a cross-tenant read returns rows
rather than an error, a re-pointed configuration commits, two active credentials
on one tenant look fine until the runtime has to pick. A text scan cannot see
any of that. The runner builds its own scratch databases, applies the **real**
migration and rollback files as a NOSUPERUSER role holding `BYPASSRLS` — the
shape of the role Supabase applies migrations as — and asks the database.

Three phases:

**Apply and verify.**

- the 4D migration applies onto a real 4C schema, in one transaction
- the fallback column, its default, its NOT NULL, and both constraints under
  DISTINCT names; the CHECK is proved by ATTEMPTING an unknown value
- a platform-scoped row cannot carry a tenant fallback policy
- the tenancy-immutability trigger exists, `BEFORE UPDATE FOR EACH ROW`, and its
  function is `SECURITY INVOKER`
- **tenant isolation, driven as `service_role`**: MARQ and two customers each
  hold a configuration for the same provider at once; the tenant lookup returns
  one tenant's row and never another's; the platform lookup
  (`organization_id IS NULL`) never returns a customer's; the tenant enumeration
  returns only the asking tenant; the activation RPC works for a customer
  configuration and one tenant's rotation leaves the other's untouched; exactly
  one active credential per tenant with the history intact; a revoke scoped to
  one configuration cannot reach another's credential
- **the two attacks the trigger exists for**: re-pointing a configuration at
  another organization, and promoting a customer row to platform scope — the
  second of which would put a customer's credential on MARQ's own execution
  path with one UPDATE. Both refused, including for `service_role`, which is
  the role a leaked service key holds
- everything a configuration is SUPPOSED to allow still updates, so the guard
  is not discovered as an outage
- plaintext-shaped credential storage still refused, for a customer row
- **the privilege matrix is UNCHANGED**: every privilege PostgreSQL defines, for
  `service_role`, `authenticated` and `anon`, on all three tables. Batch 4D
  grants nothing new to anybody. `anon` and `authenticated` are denied read and
  mutate by catalogue AND by attempt, and hold no column privilege on the new
  column
- RLS still ENABLED and FORCED on all three tables with **no policy on any of
  them** — the control most under pressure in this batch, because "a customer
  needs to read their own rows" is the sentence that ends with a policy
  admitting `authenticated` to a table holding credential ciphertext
- the Batch 4C harness assertions (`93_`, `95_`) re-run AFTER 4D, unmodified

**Roll back and re-apply.** The real rollback removes every 4D object and
nothing else; Batch 4C is intact and its own assertions still pass. **The
customer rows survive**, deliberately — see the rollback file's header: 4D
created no table, so deleting organization rows would destroy secret material
that is not recoverable, and with 4D's code rolled back those rows are simply
never read. The migration then applies again cleanly.

**Applied out of order, it fails and leaves nothing.** 4D applied with no 4C
beneath it must refuse — naming the table it depends on — and must leave its
trigger function behind. That matters because the function uses
`CREATE OR REPLACE`: a half-applied 4D would be silently re-appliable.

Exit code `2` means no database was reachable, and is reported as **BLOCKED**.

### Static coverage (no database)

`tests/database/static_ai_customer_byok_migration.test.ts`, under
`npm run test:database`. It proves what the files must never contain: a new
table, a plaintext column, an RLS policy, a browser-role grant, a `GRANT ALL`, a
`DELETE`/`TRUNCATE` grant, a direct INSERT on the credential table, a seeded
customer, a copy of an environment secret, an equality comparison where NULL
tenancy needs `IS DISTINCT FROM`, a trigger message naming two tenants — and, in
the rollback, any `DELETE FROM` at all. Every behavioural claim is the runner's.
