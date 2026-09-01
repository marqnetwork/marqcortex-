-- ---------------------------------------------------------------------------
-- FIXTURE — AI-01 Batch 4D: two customer organizations
--
-- The tenancy seed creates ONE organization, `marq`, which is MARQ's own. Every
-- claim Batch 4D makes is about ISOLATION, and isolation cannot be demonstrated
-- against a single tenant: a query with no `WHERE organization_id` returns the
-- right answer when there is only one customer, and returns everybody's when
-- there are two. So the harness needs two customers who are not MARQ.
--
-- Run as the session role, before the 4D assertions. It writes nothing outside
-- `public.organizations` and creates no credential, no configuration and no
-- user — the assertions create what they need, as `service_role`, through the
-- statements the runtime actually issues.
-- ---------------------------------------------------------------------------

INSERT INTO public.organizations (slug, name, status, plan, timezone, metadata)
SELECT 'acme', 'Acme Industries', 'active', 'enterprise', 'UTC', '{}'::JSONB
WHERE NOT EXISTS (
  SELECT 1 FROM public.organizations o WHERE o.slug = 'acme' AND o.deleted_at IS NULL
);

INSERT INTO public.organizations (slug, name, status, plan, timezone, metadata)
SELECT 'globex', 'Globex Corporation', 'active', 'standard', 'UTC', '{}'::JSONB
WHERE NOT EXISTS (
  SELECT 1 FROM public.organizations o WHERE o.slug = 'globex' AND o.deleted_at IS NULL
);

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.organizations
   WHERE slug IN ('acme', 'globex') AND deleted_at IS NULL;
  IF v_count <> 2 THEN
    RAISE EXCEPTION
      '4D-FIXTURE: expected two customer organizations, found %. Every isolation '
      'assertion after this point would pass vacuously.', v_count;
  END IF;
  RAISE NOTICE '4d_tenant_fixture: PASSED (two customer organizations, distinct from MARQ)';
END;
$$;
