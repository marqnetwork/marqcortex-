# Membership Bootstrap Procedure

**Sprint:** MCV2-S4-IMPLEMENT-001
**Automated by:** AI-01 Batch 4A — `supabase/migrations/20260818120000_marq_team_membership_bootstrap.sql`
**Status:** Automated for existing MARQ team users — manual steps remain only for the exceptions listed below

## What changed, and why

This procedure was manual because sprint rules forbid inventing user IDs, and a
migration that writes memberships has to get its IDs from somewhere. The
procedure was then never run in production: `public.organization_memberships`
returned **zero active rows**, so every operator authenticated successfully,
resolved no verified organization, and the AI guard failed the request closed at
`resolveOrganization` — the correct behaviour applied to an empty table.

Migration `20260818120000` closes that gap without breaking the rule it was
written for. It does not invent IDs; it **derives real ones from `auth.users`**
and grants only what the auth record already asserts.

## What the migration does

| | |
|---|---|
| Scope | The seeded MARQ organization only (`slug = 'marq'`, `deleted_at IS NULL`) |
| Eligibility | `auth.users` with `raw_user_meta_data ->> 'role' = 'team'`, not deleted, not currently banned |
| Role | Mapped from `user_metadata.teamRole` to the seeded system role catalog (table below) |
| Status | `active` |
| Guard | Inserts only where **no undeleted membership already exists** for that (organization, user) |
| Idempotent | Yes — re-running inserts nothing and updates nothing |

## What the migration will not do

- **No organization is created.** If the MARQ organization is missing, the
  migration is a no-op and raises a notice. A bootstrap that creates its own
  tenant is a default tenant under another name.
- **No `auth.users` row is created or modified.** The auth schema is never written.
- **`platform_admin` is never assigned.** That role is granted by a person,
  through the admin API, with ops approval.
- **No membership is revived or re-activated.** The guard is "no *undeleted*
  membership exists", so a deliberately `suspended` or `invited` row is left
  exactly as it is, and a soft-deleted membership stays deleted.
- **No default or fallback tenant is introduced.** `AI_ALLOW_DEFAULT_ORGANIZATION`
  remains `false`, and a subject with no verified membership still fails closed.

## Role mapping

The mapping below is what the migration applies. The first four rows are the
mapping this document has always carried; the remainder cover the roles the
console actually issues today (`TEAM_ROLES` in
`supabase/functions/server/teamAuthorization.ts`).

| `user_metadata.teamRole` | System role key |
|--------------------------|-----------------|
| owner | `org_admin` |
| admin | `org_admin` |
| manager *(legacy)* | `org_admin` |
| consultant | `team_member` |
| analyst | `team_member` |
| reviewer | `team_member` |
| viewer | `team_viewer` |
| *missing or unrecognised* | `team_viewer` |

An unrecognised value resolves to the **least** privileged role, matching
`normalizeTeamRole`. A data gap must never widen access.

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

## Manual steps that remain

### A new user who is not a `role = 'team'` account

Set the auth metadata through the service-role admin API first, then re-run the
migration (it is idempotent), or insert the single membership directly:

```sql
INSERT INTO public.organization_memberships (
  organization_id, user_id, role_id, status, joined_at
)
SELECT o.id, '<AUTH_USER_UUID>'::uuid, r.id, 'active', now()
FROM public.organizations o
JOIN public.roles r ON r.key = 'org_admin' AND r.is_system = true
WHERE o.slug = 'marq' AND o.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.organization_memberships m
    WHERE m.organization_id = o.id
      AND m.user_id = '<AUTH_USER_UUID>'::uuid
      AND m.deleted_at IS NULL
  );
```

The UUID comes from Supabase Dashboard → Authentication → Users. Do not invent it.

### Platform administrators

```sql
-- Via Supabase Admin API only; do not run without explicit ops approval
-- app_metadata.platform_role = 'admin' enables cortex.is_platform_admin()
```

### Changing an existing member's role

The migration never updates an existing row. Re-roling is an administrative
action through the console's team routes (`PATCH /team/members/:id`), which
enforce the escalation rules in `teamAuthorization.ts`.

## Rollback

`supabase/migrations/rollbacks/20260818120000_rollback_membership_bootstrap.sql`
soft-deletes only memberships that still look exactly as the bootstrap left them
(MARQ, `active`, untouched since creation, non-`platform_admin` system role), so
it cannot revoke access an administrator granted afterwards.

## Legacy compatibility

Runtime continues to read `user_metadata.role = 'team'` and
`user_metadata.teamRole` for team-role authority. Organization authority now
comes from `organization_memberships` via `listMemberships`, which admits only
`deleted_at IS NULL AND status = 'active'` rows and carries `roles.key` through
to `SubjectMembership.roles`.

## Removal conditions for metadata fallback

Remove fallback when:

1. All active team users have `organization_memberships` rows — **satisfied by
   this migration for existing users**; new users are covered by the console's
   invite path
2. Edge routes resolve authority via repository (Sprint 2+)
3. 30-day staging soak with zero legacy-only auth paths
