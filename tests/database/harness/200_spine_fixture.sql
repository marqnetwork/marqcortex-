-- ============================================================================
-- CP-3 fixture: TWO organizations, and a caller in each.
--
-- Everything the tenancy assertions need, and nothing else. Two tenants is the
-- minimum that can demonstrate isolation: with one, every query trivially
-- passes.
--
-- Seeded as the SESSION role, exactly as `10_membership_fixture.sql` does. A
-- fixture is setup, not a subject: it is the ASSERTIONS that must run as
-- `authenticated` with a real `request.jwt.claim.sub`, and they do.
-- ============================================================================

-- ── Two organizations ───────────────────────────────────────────────────────
INSERT INTO public.organizations (id, slug, name)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'org-alpha', 'Alpha Industries'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'org-beta',  'Beta Works')
ON CONFLICT (id) DO NOTHING;

-- ── Three auth users: an Alpha admin, an Alpha viewer, a Beta admin ─────────
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('11111111-0000-4000-8000-000000000001', 'admin@alpha.invalid',  '{"marq_team": true, "team_role": "admin"}'::jsonb,  '{"name": "Alpha Admin"}'::jsonb),
  ('11111111-0000-4000-8000-000000000002', 'viewer@alpha.invalid', '{"marq_team": true, "team_role": "viewer"}'::jsonb, '{"name": "Alpha Viewer"}'::jsonb),
  ('22222222-0000-4000-8000-000000000001', 'admin@beta.invalid',   '{"marq_team": true, "team_role": "admin"}'::jsonb,  '{"name": "Beta Admin"}'::jsonb),
  -- A member whose membership is SUSPENDED. The "inactive membership fails
  -- closed" assertion needs somebody to be inactive.
  ('11111111-0000-4000-8000-000000000003', 'left@alpha.invalid',   '{"marq_team": true, "team_role": "admin"}'::jsonb,  '{"name": "Alpha Leaver"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ── Memberships, from the EXISTING table. CP-3 adds no parallel one. ────────
-- The role id is resolved straight from the seeded catalog rather than through
-- `cortex.system_role_id()`, which a LATER migration defines. A fixture that
-- reached for it would silently couple this sprint's proof to that sprint's
-- file list.
INSERT INTO public.organization_memberships (organization_id, user_id, role_id, status, joined_at)
SELECT 'aaaaaaaa-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001',
       (SELECT r.id FROM public.roles r WHERE r.key = 'org_admin' AND r.is_system AND r.organization_id IS NULL LIMIT 1), 'active', now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.organization_memberships
  WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000001'
    AND user_id = '11111111-0000-4000-8000-000000000001' AND deleted_at IS NULL);

INSERT INTO public.organization_memberships (organization_id, user_id, role_id, status, joined_at)
SELECT 'aaaaaaaa-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000002',
       (SELECT r.id FROM public.roles r WHERE r.key = 'team_viewer' AND r.is_system AND r.organization_id IS NULL LIMIT 1), 'active', now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.organization_memberships
  WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000001'
    AND user_id = '11111111-0000-4000-8000-000000000002' AND deleted_at IS NULL);

INSERT INTO public.organization_memberships (organization_id, user_id, role_id, status, joined_at)
SELECT 'bbbbbbbb-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000001',
       (SELECT r.id FROM public.roles r WHERE r.key = 'org_admin' AND r.is_system AND r.organization_id IS NULL LIMIT 1), 'active', now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.organization_memberships
  WHERE organization_id = 'bbbbbbbb-0000-4000-8000-000000000002'
    AND user_id = '22222222-0000-4000-8000-000000000001' AND deleted_at IS NULL);

-- Suspended: an org_admin role, and no active membership to exercise it with.
INSERT INTO public.organization_memberships (organization_id, user_id, role_id, status, joined_at)
SELECT 'aaaaaaaa-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000003',
       (SELECT r.id FROM public.roles r WHERE r.key = 'org_admin' AND r.is_system AND r.organization_id IS NULL LIMIT 1), 'suspended', now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.organization_memberships
  WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000001'
    AND user_id = '11111111-0000-4000-8000-000000000003' AND deleted_at IS NULL);

-- ── Structure in each organization ──────────────────────────────────────────
INSERT INTO public.business_units (id, organization_id, key, name)
VALUES
  ('a0000000-0000-4000-8000-00000000bb01', 'aaaaaaaa-0000-4000-8000-000000000001', 'engineering', 'Engineering'),
  ('b0000000-0000-4000-8000-00000000bb01', 'bbbbbbbb-0000-4000-8000-000000000002', 'operations',  'Operations')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.departments (id, organization_id, business_unit_id, key, name)
VALUES
  ('a0000000-0000-4000-8000-00000000dd01', 'aaaaaaaa-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000bb01', 'platform', 'Platform'),
  ('b0000000-0000-4000-8000-00000000dd01', 'bbbbbbbb-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-00000000bb01', 'support',  'Support')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.people (id, organization_id, user_id, full_name, email, position_title, department_id)
VALUES
  ('a0000000-0000-4000-8000-00000000ee01', 'aaaaaaaa-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', 'Alpha Admin',  'admin@alpha.invalid', 'Head of Platform', 'a0000000-0000-4000-8000-00000000dd01'),
  -- A PERSON WITHOUT A LOGIN. ONT 12.3: not every Identity is a User.
  ('a0000000-0000-4000-8000-00000000ee02', 'aaaaaaaa-0000-4000-8000-000000000001', NULL,                                   'Alpha Contractor', 'contractor@alpha.invalid', 'Contract Engineer', 'a0000000-0000-4000-8000-00000000dd01'),
  ('b0000000-0000-4000-8000-00000000ee01', 'bbbbbbbb-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000001', 'Beta Admin',   'admin@beta.invalid',  'Head of Support',  'b0000000-0000-4000-8000-00000000dd01')
ON CONFLICT (id) DO NOTHING;

UPDATE public.people
SET reports_to_person_id = 'a0000000-0000-4000-8000-00000000ee01'
WHERE id = 'a0000000-0000-4000-8000-00000000ee02';

UPDATE public.departments
SET lead_person_id = 'a0000000-0000-4000-8000-00000000ee01'
WHERE id = 'a0000000-0000-4000-8000-00000000dd01';

INSERT INTO public.teams (id, organization_id, department_id, key, name, lead_person_id)
VALUES
  ('a0000000-0000-4000-8000-00000000cc01', 'aaaaaaaa-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000dd01', 'core', 'Core Team', 'a0000000-0000-4000-8000-00000000ee01'),
  ('b0000000-0000-4000-8000-00000000cc01', 'bbbbbbbb-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-00000000dd01', 'desk', 'Support Desk', 'b0000000-0000-4000-8000-00000000ee01')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_memberships (organization_id, team_id, person_id, is_lead)
SELECT 'aaaaaaaa-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000cc01', 'a0000000-0000-4000-8000-00000000ee01', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.team_memberships
  WHERE team_id = 'a0000000-0000-4000-8000-00000000cc01'
    AND person_id = 'a0000000-0000-4000-8000-00000000ee01' AND deleted_at IS NULL);

INSERT INTO public.team_memberships (organization_id, team_id, person_id, is_lead)
SELECT 'aaaaaaaa-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000cc01', 'a0000000-0000-4000-8000-00000000ee02', false
WHERE NOT EXISTS (
  SELECT 1 FROM public.team_memberships
  WHERE team_id = 'a0000000-0000-4000-8000-00000000cc01'
    AND person_id = 'a0000000-0000-4000-8000-00000000ee02' AND deleted_at IS NULL);

