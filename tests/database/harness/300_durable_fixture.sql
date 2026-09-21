-- ============================================================================
-- BP-002 — two tenants, and the rows every durable-runtime assertion works on.
--
-- Two organizations, because every isolation claim below is "Beta cannot see
-- Alpha's", and a single-tenant fixture can only ever prove that a query
-- returns something.
-- ============================================================================

BEGIN;

-- Deterministic ids, so an assertion can name a row rather than find it.
INSERT INTO public.organizations (id, name, slug)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'Alpha', 'alpha'),
  ('22222222-2222-4222-8222-222222222222', 'Beta',  'beta')
ON CONFLICT (id) DO NOTHING;

-- One queued job per tenant, due now.
INSERT INTO public.durable_jobs (
  id, organization_id, job_type, state, available_at,
  max_attempts, idempotency_key, correlation_id,
  actor_id, actor_type, actor_permissions, input
)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001',
   '11111111-1111-4111-8111-111111111111',
   'test.sweep', 'queued', now() - interval '1 minute',
   5, 'alpha-1', 'corr-alpha', 'service:test', 'service', ARRAY['job.run'], '{}'::jsonb),
  ('bbbbbbbb-0000-4000-8000-000000000001',
   '22222222-2222-4222-8222-222222222222',
   'test.sweep', 'queued', now() - interval '1 minute',
   5, 'beta-1', 'corr-beta', 'service:test', 'service', ARRAY['job.run'], '{}'::jsonb)
ON CONFLICT (organization_id, job_type, idempotency_key) DO NOTHING;

COMMIT;
