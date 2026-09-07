-- ---------------------------------------------------------------------------
-- ASSERT — the outcome backfill, against the constraints it will meet.
--
-- Runs after `111_assert_submission_backfill.sql`, which already wrote one
-- outcome for the fixture submission while proving the foreign key (SB-7).
-- This file asks the questions the WRITER's shape depends on.
--
--   OB-1  `submission_id` is UNIQUE — one submission has at most one outcome,
--         which is what makes the writer key its upsert on that column rather
--         than on `legacy_kv_key`
--   OB-2  `outcome_type` refuses a vocabulary the KV record could suggest
--   OB-3  `status` refuses an invented value, so 'closed' is a real choice
--   OB-4  the `value` JSONB round-trips what only the outcome knows
--   OB-5  `legacy_kv_key` is uniquely indexed among live rows, so a re-run
--         cannot produce a second row for one KV key
-- ---------------------------------------------------------------------------

SET ROLE service_role;

DO $$
DECLARE
  v_org        UUID := '11111111-1111-4111-8111-111111111111';
  v_submission UUID;
  v_failed     BOOLEAN;
  v_value      JSONB;
BEGIN
  SELECT id INTO v_submission
    FROM public.submissions
   WHERE legacy_kv_key = 'sub:sub-1' AND deleted_at IS NULL;
  IF v_submission IS NULL THEN
    RAISE EXCEPTION 'OB-0: the submission fixture is missing — run 111 first';
  END IF;

  -- -------------------------------------------------------------------------
  -- OB-1. One submission, one outcome.
  -- -------------------------------------------------------------------------
  v_failed := FALSE;
  BEGIN
    INSERT INTO public.outcomes (organization_id, submission_id, legacy_kv_key, outcome_type)
    VALUES (v_org, v_submission, 'outcome:sub-1-again', 'lost');
  EXCEPTION WHEN unique_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION
      'OB-1: a second outcome was admitted for one submission. The writer keys its upsert on '
      'submission_id BECAUSE of this constraint; without it that choice is arbitrary.';
  END IF;
  RAISE NOTICE 'assert_outcome_backfill: PASSED (OB-1, one outcome per submission)';

  -- -------------------------------------------------------------------------
  -- OB-2 / OB-3. The vocabularies.
  -- -------------------------------------------------------------------------
  UPDATE public.outcomes SET outcome_type = 'lost' WHERE submission_id = v_submission;

  v_failed := FALSE;
  BEGIN
    UPDATE public.outcomes SET outcome_type = 'converted' WHERE submission_id = v_submission;
  EXCEPTION WHEN check_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'OB-2: outcome_type ''converted'' was accepted — the won/lost mapping would be optional';
  END IF;

  v_failed := FALSE;
  BEGIN
    UPDATE public.outcomes SET status = 'settled' WHERE submission_id = v_submission;
  EXCEPTION WHEN check_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'OB-3: status ''settled'' was accepted — choosing ''closed'' would be arbitrary';
  END IF;

  UPDATE public.outcomes SET status = 'closed' WHERE submission_id = v_submission;
  RAISE NOTICE 'assert_outcome_backfill: PASSED (OB-2/OB-3, the outcome and status vocabularies are enforced)';

  -- -------------------------------------------------------------------------
  -- OB-4. What only the outcome knows.
  -- -------------------------------------------------------------------------
  UPDATE public.outcomes
     SET value = '{"conversionValue": 1500, "lostReason": null, "whatWeLearned": "the diagnostic landed", "improvementAreas": ["discovery"], "migration_run_id": "run-1"}'::jsonb
   WHERE submission_id = v_submission;

  SELECT value INTO v_value FROM public.outcomes WHERE submission_id = v_submission;
  IF (v_value->>'conversionValue')::numeric <> 1500
     OR v_value->'improvementAreas'->>0 <> 'discovery'
     OR v_value->>'migration_run_id' <> 'run-1' THEN
    RAISE EXCEPTION 'OB-4: the outcome value did not round-trip';
  END IF;
  RAISE NOTICE 'assert_outcome_backfill: PASSED (OB-4, the outcome value round-trips)';

  -- -------------------------------------------------------------------------
  -- OB-5. One KV key, one live row.
  --
  -- Asked on a DIFFERENT submission, because OB-1 has already established that
  -- the submission column would refuse this one on its own — and an assertion
  -- that two constraints both fire is an assertion about neither.
  -- -------------------------------------------------------------------------
  INSERT INTO public.submissions (
    organization_id, legacy_kv_key, legacy_id, company_name, contact_email
  ) VALUES (v_org, 'sub:sub-2', 'sub-2', 'Acme Ltd', 'second@acme.test');

  v_failed := FALSE;
  BEGIN
    INSERT INTO public.outcomes (organization_id, submission_id, legacy_kv_key, outcome_type)
    SELECT v_org, id, 'outcome:sub-1', 'won'
      FROM public.submissions WHERE legacy_kv_key = 'sub:sub-2';
  EXCEPTION WHEN unique_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'OB-5: one KV key produced two live outcome rows';
  END IF;
  RAISE NOTICE 'assert_outcome_backfill: PASSED (OB-5, one live row per KV key)';
END $$;

RESET ROLE;
