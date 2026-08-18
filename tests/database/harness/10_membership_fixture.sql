-- ============================================================================
-- Membership bootstrap harness — fixture.
--
-- Deterministic users and pre-existing memberships, chosen so that every claim
-- the migration and its rollback make has a row that would break if the claim
-- were false. Literal UUIDs are correct HERE and forbidden in the migration:
-- the migration must never invent a user, and a fixture must never leave which
-- user it means to chance.
--
-- The ids are readable on purpose — `...aaa1` is the owner, `...bbb2` the
-- analyst — so a failing assertion names something a person can find.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Eligible: carry the SERVER-WRITTEN assertion in app_metadata.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-00000000aaa1', 'owner@marq.test',
   '{"marq_team": true, "team_role": "owner"}'::jsonb,
   '{"role": "team", "teamRole": "owner"}'::jsonb),

  ('00000000-0000-4000-8000-00000000bbb2', 'analyst@marq.test',
   '{"marq_team": true, "team_role": "analyst"}'::jsonb,
   '{"role": "team", "teamRole": "analyst"}'::jsonb),

  ('00000000-0000-4000-8000-00000000ccc3', 'viewer@marq.test',
   '{"marq_team": true, "team_role": "viewer"}'::jsonb,
   '{"role": "team", "teamRole": "viewer"}'::jsonb),

  -- Eligible, but the server wrote no role. Must land on the LEAST privileged
  -- key, never on a guess.
  ('00000000-0000-4000-8000-00000000ddd4', 'norole@marq.test',
   '{"marq_team": true}'::jsonb,
   '{"role": "team"}'::jsonb),

  -- `manager` is legacy and is NOT a member of TEAM_ROLES. Two of the old
  -- mappings sent it to `org_admin` while `normalizeTeamRole` resolves it to
  -- `viewer`. It must resolve to `team_viewer` here.
  ('00000000-0000-4000-8000-00000000eee5', 'manager@marq.test',
   '{"marq_team": true, "team_role": "manager"}'::jsonb,
   '{"role": "team", "teamRole": "manager"}'::jsonb);

-- ---------------------------------------------------------------------------
-- NOT eligible.
-- ---------------------------------------------------------------------------

-- THE SELF-PROMOTION CASE. Nothing but user_metadata, which GoTrue lets the
-- account holder write through PUT /auth/v1/user. Under the previous migration
-- this row was an `org_admin` in the MARQ organization. It must now be nobody.
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-0000000f0001', 'impostor@example.test',
   '{}'::jsonb,
   '{"role": "team", "teamRole": "owner"}'::jsonb),

  -- Server-asserted, but the account is gone.
  ('00000000-0000-4000-8000-0000000f0002', 'gone@marq.test',
   '{"marq_team": true, "team_role": "admin"}'::jsonb, '{}'::jsonb),

  -- Server-asserted, but currently banned.
  ('00000000-0000-4000-8000-0000000f0003', 'banned@marq.test',
   '{"marq_team": true, "team_role": "admin"}'::jsonb, '{}'::jsonb),

  -- A ban that has already expired is not a ban.
  ('00000000-0000-4000-8000-0000000f0004', 'unbanned@marq.test',
   '{"marq_team": true, "team_role": "viewer"}'::jsonb, '{}'::jsonb);

UPDATE auth.users SET deleted_at   = now() - interval '1 day'
  WHERE id = '00000000-0000-4000-8000-0000000f0002';
UPDATE auth.users SET banned_until = now() + interval '30 days'
  WHERE id = '00000000-0000-4000-8000-0000000f0003';
UPDATE auth.users SET banned_until = now() - interval '30 days'
  WHERE id = '00000000-0000-4000-8000-0000000f0004';

-- ---------------------------------------------------------------------------
-- Eligible, but a membership decision already exists. The bootstrap must leave
-- every one of these exactly as it found it.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
  -- Removed by an administrator. A soft delete is a decision, and re-admitting
  -- alongside the tombstone would silently reverse it.
  ('00000000-0000-4000-8000-0000000e0001', 'removed@marq.test',
   '{"marq_team": true, "team_role": "owner"}'::jsonb, '{}'::jsonb),

  -- Suspended. `suspended` exists so a row can be present without granting.
  ('00000000-0000-4000-8000-0000000e0002', 'suspended@marq.test',
   '{"marq_team": true, "team_role": "owner"}'::jsonb, '{}'::jsonb),

  -- Already a member, at a HIGHER role than the mapping would give. The
  -- bootstrap must not touch it, and the rollback must not revoke it.
  ('00000000-0000-4000-8000-0000000e0003', 'existing@marq.test',
   '{"marq_team": true, "team_role": "viewer"}'::jsonb, '{}'::jsonb),

  -- A platform administrator, granted by a person. Untouchable at both ends.
  ('00000000-0000-4000-8000-0000000e0004', 'platform@marq.test',
   '{"marq_team": true, "team_role": "owner"}'::jsonb, '{}'::jsonb);

-- The account that joins AFTER the bootstrap ran is created in
-- 30_mutate_before_rollback.sql, not here — an eligible account present now
-- would be admitted by the bootstrap itself, and the property under test is
-- what the rollback does to a membership the bootstrap never saw.

INSERT INTO public.organization_memberships (organization_id, user_id, role_id, status, joined_at, deleted_at)
SELECT o.id, v.user_id, r.id, v.status, now() - interval '10 days', v.deleted_at
FROM public.organizations o
CROSS JOIN (VALUES
  ('00000000-0000-4000-8000-0000000e0001'::uuid, 'org_admin',      'active',    now() - interval '5 days'),
  ('00000000-0000-4000-8000-0000000e0002'::uuid, 'team_member',    'suspended', NULL::timestamptz),
  ('00000000-0000-4000-8000-0000000e0003'::uuid, 'org_admin',      'active',    NULL::timestamptz),
  ('00000000-0000-4000-8000-0000000e0004'::uuid, 'platform_admin', 'active',    NULL::timestamptz)
) AS v(user_id, role_key, status, deleted_at)
JOIN public.roles r
  ON r.key = v.role_key AND r.scope = 'platform' AND r.is_system = true AND r.organization_id IS NULL
WHERE o.slug = 'marq' AND o.deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- A second, SOFT-DELETED organization holding a live membership.
--
-- Not for the migration — the bootstrap only ever looks at the live MARQ org —
-- but for `listMemberships`. M1's finding is that a verified membership was
-- being returned for an erased tenant, and this is the row that proves the SQL
-- side of the schema makes that state reachable at all.
-- ---------------------------------------------------------------------------
INSERT INTO public.organizations (slug, name, status, plan, deleted_at)
VALUES ('defunct', 'Defunct Tenant', 'archived', 'standard', now() - interval '1 day');

INSERT INTO public.organization_memberships (organization_id, user_id, role_id, status, joined_at)
SELECT o.id, '00000000-0000-4000-8000-00000000aaa1', r.id, 'active', now()
FROM public.organizations o
JOIN public.roles r
  ON r.key = 'org_admin' AND r.scope = 'platform' AND r.is_system = true AND r.organization_id IS NULL
WHERE o.slug = 'defunct' AND o.deleted_at IS NOT NULL;
