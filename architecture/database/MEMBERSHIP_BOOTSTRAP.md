# Membership Bootstrap Procedure

**Sprint:** MCV2-S4-IMPLEMENT-001  
**Status:** Manual procedure — not executed automatically

## Why manual?

Sprint rules forbid inventing user IDs. Existing Supabase Auth user IDs must be obtained from the Supabase dashboard or Admin API before creating memberships.

## Prerequisites

- Migrations `20260711050000` and `20260711050001` applied
- MARQ organization seeded (`slug = 'marq'`)
- Target user exists in `auth.users` with `user_metadata.role = 'team'`

## Steps

### 1. Find user ID

In Supabase Dashboard → Authentication → Users, copy the UUID for the team user.

### 2. Create membership (org_admin example)

```sql
INSERT INTO public.organization_memberships (
  organization_id,
  user_id,
  role_id,
  status,
  joined_at
)
SELECT
  o.id,
  '<AUTH_USER_UUID>'::uuid,
  r.id,
  'active',
  now()
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

### 3. Optional — set app_metadata for platform admins

```sql
-- Via Supabase Admin API only; do not run without explicit ops approval
-- app_metadata.platform_role = 'admin' enables cortex.is_platform_admin()
```

## Legacy compatibility (unchanged this sprint)

Runtime continues to use `user_metadata.role = 'team'` and `user_metadata.teamRole`.

| Legacy teamRole | Future role key |
|-----------------|-----------------|
| admin | org_admin |
| manager | org_admin |
| reviewer | team_member |
| viewer | team_viewer |

## Removal conditions for metadata fallback

Remove fallback when:

1. All active team users have `organization_memberships` rows
2. Edge routes resolve authority via repository (Sprint 2+)
3. 30-day staging soak with zero legacy-only auth paths
