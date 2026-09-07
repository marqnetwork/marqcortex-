-- ---------------------------------------------------------------------------
-- FIXTURE — the submission backfill, against a real PostgreSQL.
--
-- Two organizations and one contact in each, because the assertions that
-- follow have to ask a cross-tenant question and a single-tenant fixture cannot
-- ask it.
--
-- Nothing here is a migration. It seeds exactly what the backfill would find in
-- a deployment where the LEAD backfill has already run and the submission one
-- has not — which is the state the roadmap says a deployment is actually in.
-- ---------------------------------------------------------------------------

SET ROLE service_role;

INSERT INTO public.organizations (id, slug, name, status, plan, timezone)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'acme-backfill', 'Acme (backfill fixture)',
   'active', 'enterprise', 'UTC'),
  ('22222222-2222-4222-8222-222222222222', 'other-backfill', 'Other tenant (backfill fixture)',
   'active', 'enterprise', 'UTC')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.contacts (id, organization_id, primary_email, full_name)
VALUES
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111',
   'dana.reed@acme.test', 'Dana Reed'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222',
   'dana.reed@acme.test', 'Dana Reed (other tenant)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, contact_id, legacy_kv_key, email, status)
VALUES
  ('cccccccc-1111-4111-8111-cccccccccccc', '11111111-1111-4111-8111-111111111111',
   'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'lead:lead-1', 'dana.reed@acme.test', 'captured')
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  RAISE NOTICE 'submission_backfill_fixture: seeded two organizations, two contacts, one lead';
END $$;

RESET ROLE;
