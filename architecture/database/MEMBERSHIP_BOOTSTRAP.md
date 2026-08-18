# Membership Bootstrap Procedure

**Sprint:** MCV2-S4-IMPLEMENT-001
**Automated by:** AI-01 Batch 4A — `supabase/migrations/20260818120000_marq_team_membership_bootstrap.sql`
**Status:** Automated for accounts the server has marked as MARQ team accounts. A
one-time, operator-reviewed stamping step is required for accounts created
before that marking existed.

## What changed, and why

This procedure was manual because sprint rules forbid inventing user IDs, and a
migration that writes memberships has to get its IDs from somewhere. The
procedure was then never run in production: `public.organization_memberships`
returned **zero active rows**, so every operator authenticated successfully,
resolved no verified organization, and the AI guard failed the request closed at
`resolveOrganization` — the correct behaviour applied to an empty table.

Migration `20260818120000` closes that gap without breaking the rule it was
written for. It does not invent IDs; it **derives real ones from `auth.users`**.

## Correction: eligibility is `app_metadata`, not `user_metadata`

The first version of this migration, and several comments elsewhere in the
codebase, asserted that `user_metadata` is "writable only through the
service-role admin API". **That is false.** Supabase's GoTrue serves
`PUT /auth/v1/user`, and any signed-in account — holding nothing beyond its own
access token and the public anon key that ships in the browser bundle — may
rewrite its own `raw_user_meta_data`.

Under the old predicate (`raw_user_meta_data ->> 'role' = 'team'`), a `viewer`
could set `{"role":"team","teamRole":"owner"}` on themselves and be granted an
`org_admin` membership in the MARQ organization by the migration. The bootstrap
would have been a self-service privilege escalation with a migration timestamp
on it.

`raw_app_meta_data` is the bag GoTrue refuses to write for a user-scoped call;
only the service role sets it. The platform already treats it as authority —
`cortex.is_platform_admin()` reads `app_metadata ->> 'platform_role'` — so this
is the strongest authority that already exists here, not a new one.

| | Writable by the account holder | Used for |
|---|---|---|
| `raw_app_meta_data.marq_team` | No | **Eligibility.** The only thing the migration reads. |
| `raw_app_meta_data.team_role` | No | **Role.** Mapped to a system role key. |
| `user_metadata.teamRole` | **Yes** | Console team-role fallback, and only for an account that carries NO app metadata at all. Never establishes organization membership. |

`resolveTeamRoleFromAuthRecord` reads, in order: `app_metadata.team_role`;
then `viewer` if the account is stamped but carries no role; then
`user_metadata.teamRole`. Stamping an account closes the third branch for it
permanently, so the fallback shrinks as the roster is stamped instead of
persisting.

The server writes both bags on every provisioning path
(`supabase/functions/server/index.tsx`): the startup admin seed, `POST
/team/invite`, and `PATCH /team/members/:id`. `teamAppMetadata()` in
`teamAuthorization.ts` is the single shape they all send.

## What the migration does

| | |
|---|---|
| Scope | The seeded MARQ organization only (`slug = 'marq'`, `deleted_at IS NULL`) |
| Eligibility | `auth.users` with `raw_app_meta_data ->> 'marq_team' = 'true'`, not deleted, not currently banned |
| Role | Mapped from `raw_app_meta_data ->> 'team_role'` to the seeded system role catalog (table below) |
| Status | `active` |
| Guard | Inserts only where **no membership row exists at all** for that (organization, user) — deleted rows included |
| Idempotent | Yes — re-running inserts nothing and updates nothing |
| Concurrency | Transaction-scoped advisory lock, taken before any DDL, plus `ON CONFLICT … DO NOTHING` |
| Provenance | Every created row is recorded in `cortex.membership_bootstrap_log` |

## What the migration will not do

- **No organization is created.** If the MARQ organization is missing, the
  migration is a no-op and raises a notice. A bootstrap that creates its own
  tenant is a default tenant under another name.
- **No `auth.users` row is created or modified.** The auth schema is never written.
- **`platform_admin` is never assigned.** That role is granted by a person,
  through the admin API, with ops approval. No arm of the role mapping can
  produce it.
- **No membership is revived, re-activated or re-roled.** The guard is "no
  membership row exists", so an `invited`, `suspended` or **soft-deleted** row
  all mean the same thing: somebody already decided about this person. A removed
  member does not silently regain access by being admitted alongside their
  tombstone.
- **No default or fallback tenant is introduced.** `AI_ALLOW_DEFAULT_ORGANIZATION`
  remains `false`, and a subject with no verified membership still fails closed.
- **Nothing is inferred from `user_metadata`.** The migration contains no read of
  `raw_user_meta_data`, and a test asserts its absence.

## Role mapping

`TEAM_ROLE_TO_ORGANIZATION_ROLE` in
`supabase/functions/server/teamAuthorization.ts` is **the** mapping. The SQL
`CASE` in the migration, `LEGACY_TEAM_ROLE_MAP` in `src/types/database.types.ts`
and the table below are copies, and `tests/features/membershipRoleMapping.test.ts`
reads all four and fails if any of them disagrees.

| `app_metadata.team_role` | System role key |
|--------------------------|-----------------|
| owner | `org_admin` |
| admin | `org_admin` |
| consultant | `team_member` |
| analyst | `team_member` |
| reviewer | `team_member` |
| viewer | `team_viewer` |
| *missing or unrecognised* | `team_viewer` |

An unrecognised value resolves to the **least** privileged role, matching
`normalizeTeamRole`. A data gap must never widen access.

**`manager` was removed from this table.** It is not a member of `TEAM_ROLES`, so
`normalizeTeamRole('manager')` resolves it to `viewer` — while this table and
`LEGACY_TEAM_ROLE_MAP` both used to send it to `org_admin`. One said read-only
and the other said organization administrator. It now falls to the
"unrecognised" row, with everything else the console cannot issue.

### What a membership role grants

`ROLE_CAPABILITIES` in `ai/security/actor.ts` carries both vocabularies: the
console's team roles and the three organization role keys. Before the keys were
added, joining `roles(key)` into the membership query changed what the query
returned and nothing about what any actor could do — an unmapped key grants
nothing, so an `org_admin` and a `team_viewer` still resolved identically.

Roles are additive (team role ∪ membership role), and each key is granted at the
level the team role it maps from already had: `org_admin` = the `admin` grant,
`team_member` = the `reviewer` grant (the least of the three roles that map to
it), `team_viewer` = nothing. A test asserts no key grants a capability its
source team role does not.

## Applying it

```bash
supabase db push          # or: psql "$DATABASE_URL" -f supabase/migrations/20260818120000_marq_team_membership_bootstrap.sql
```

Verify:

```sql
SELECT r.key, m.status, COUNT(*)
FROM public.organization_memberships m
JOIN public.organizations o ON o.id = m.organization_id AND o.slug = 'marq'
JOIN public.roles r ON r.id = m.role_id
WHERE m.deleted_at IS NULL
GROUP BY r.key, m.status
ORDER BY r.key;
```

## One-time stamping for accounts that predate app metadata

On a database whose team accounts were all created before the provisioning
routes wrote `app_metadata`, **the migration admits nobody and says so**:

```
NOTICE: membership bootstrap: no auth user carries app_metadata.marq_team = true,
        so none was admitted.
```

That is the correct outcome, not a regression. Deciding who is internal MARQ
staff from a field the account holder controls was never a decision a migration
was entitled to make, and there is no other field on those rows that
distinguishes a colleague from a stranger who signed up.

Two ways forward, and they compose:

**1. Let the console do it.** Every account created by `POST /team/invite` and
every account whose role is changed through `PATCH /team/members/:id` is stamped
as a side effect. Re-run the migration afterwards; it is idempotent.

**2. Stamp a reviewed roster once.** Take the list of internal accounts from
Supabase Dashboard → Authentication → Users, **read it**, and stamp exactly those
ids. Do not derive the list from `user_metadata`; that is the input this whole
change exists to stop trusting.

```sql
-- Run as the service role. Replace the VALUES with the reviewed roster: one row
-- per real auth user id, with the team role that account should carry.
-- Merging rather than replacing, so no other app_metadata key is lost.
UPDATE auth.users u
SET raw_app_meta_data = COALESCE(u.raw_app_meta_data, '{}'::jsonb)
                        || jsonb_build_object('marq_team', true, 'team_role', v.team_role)
FROM (VALUES
  ('<AUTH_USER_UUID>'::uuid, 'admin'),
  ('<AUTH_USER_UUID>'::uuid, 'consultant')
) AS v(user_id, team_role)
WHERE u.id = v.user_id;
```

Then re-run the migration. The UUIDs come from the dashboard. Do not invent one.

## Manual steps that remain

### Platform administrators

```sql
-- Via Supabase Admin API only; do not run without explicit ops approval
-- app_metadata.platform_role = 'admin' enables cortex.is_platform_admin()
```

### Changing an existing member's role

The migration never updates an existing row. Re-roling is an administrative
action through the console's team routes (`PATCH /team/members/:id`), which
enforce the escalation rules in `teamAuthorization.ts` and write both metadata
bags.

### Re-admitting somebody who was removed

The migration will not do it, by design: their soft-deleted membership row is a
decision. Re-admission is an explicit administrative act — clear `deleted_at` on
the existing row, or insert a new membership — taken by a person who knows why
the first one was removed.

## Rollback

`supabase/migrations/rollbacks/20260818120000_rollback_membership_bootstrap.sql`

The rollback reads `cortex.membership_bootstrap_log` and nothing else. It
soft-deletes a membership only when the ledger names it **and** the row still
carries the `role_id`, `status` and `updated_at` the bootstrap wrote. Anything
modified since is reported and skipped; the rollback never assigns `role_id` or
`status`, so a modified membership cannot be reset to what the bootstrap once
put there.

**Correction:** the previous rollback identified its own rows as
`status = 'active' AND updated_at = created_at`. That is not provenance.
`updated_at = created_at` is true of *every* membership nobody has edited yet,
whoever created it and whenever — so the rollback would have revoked a
membership an administrator created through the console minutes earlier. The
harness demonstrates this on real rows
(`tests/database/harness/25_assert_heuristic_was_unsafe.sql`).

Consequences, all intended:

- A membership that existed **before** the bootstrap survives — not in the ledger.
- A membership created **after** the bootstrap survives — not in the ledger.
- `platform_admin` survives; the bootstrap never granted one, and an explicit
  guard makes it unable to revoke one regardless.
- A rolled-back operator is **not** re-admitted by the next run of the forward
  migration: the soft-deleted row is membership history, and history blocks
  admission.

## Runtime membership resolution

Organization authority comes from `organization_memberships` through
`listVerifiedMemberships` in
`supabase/functions/server/ai/adapters/membershipDirectory.ts`, which the edge
entry point calls and which holds all the admission rules:

- `deleted_at IS NULL` on the membership
- `status = 'active'`
- **the organization is itself undeleted** — a membership in a soft-deleted
  organization resolves nothing. It is dropped, not downgraded.
- `roles.key` is carried through to `SubjectMembership.roles`
- the result is ordered by organization id, so resolution does not depend on the
  planner's row order

`repositories/tenancyRepository.ts` also reads the table. It is unwired
scaffolding for the repository cutover, is excluded by name in
`membershipResolution.test.ts` rather than silently, and carries the same
organization-liveness restriction so wiring it up cannot reintroduce the defect.

### More than one membership

`resolveOrganization` used to take `memberships[0]` — the first row a query with
no `ORDER BY` happened to return. With two memberships that is a tenant chosen by
the query planner, and every budget, audit record and isolation key follows it.

A subject holding more than one verified membership must now **name** the
organization; without a hint the request fails `ORGANIZATION_REQUIRED` with a
diagnostic listing what they hold. This is not a default tenant — nothing is
chosen on their behalf — and a subject with exactly one membership is
unaffected, which is every operator in the current deployment.

## Testing

```bash
npm run test:database             # static: what the migration must never contain
npm run test:security             # resolution, role mapping, row -> membership
npm run test:database:scenarios   # empirical, needs a real PostgreSQL 15+

# Live invariants against a linked project (creates nothing, rolls itself back)
psql "$DATABASE_URL" -f tests/database/membership_bootstrap.test.sql
```

`test:database:scenarios` builds its own scratch database, applies the real
migration files, and covers: eligible/ineligible admission, the role mapping, a
soft-deleted member staying out, idempotency across three runs, the five rollback
properties above, and four concurrent bootstraps. It exits `2` — not `0` — when
no database is reachable, so "not run" is never reported as "passed".

## Legacy compatibility

The console continues to read a team role from the auth record for its own
authorization (`resolveTeamRoleFromAuthRecord`: `app_metadata.team_role` first,
`user_metadata.teamRole` as a bounded fallback). Organization authority does not
use that path at all.

## Removal conditions for the metadata fallback

Remove the `user_metadata.teamRole` fallback when:

1. Every active team account carries `app_metadata.team_role` — satisfied for
   accounts created or re-roled through the console after this ships, and for
   any roster stamped by the step above
2. Edge routes resolve authority via repository (Sprint 2+)
3. 30-day staging soak with zero reads of the fallback branch
