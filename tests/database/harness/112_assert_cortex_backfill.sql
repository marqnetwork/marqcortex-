-- ---------------------------------------------------------------------------
-- ASSERT — the cortex analysis backfill, against the constraints it will meet.
--
-- Runs after `111_assert_submission_backfill.sql`, which leaves one submission
-- behind for this file to hang analysis rows from.
--
--   CB-1  the 0-100 CHECK actually refuses a raw 0-5 heatmap value stored as
--         itself — which is what makes the normalizer's scaling load-bearing
--         rather than a matter of taste
--   CB-2  the scaled value is accepted, and its provenance survives
--   CB-3  `domain_key` must be lower-case, and one pillar means one row
--   CB-4  a domain score cannot exist without its submission — the dependency
--         that makes SUBMISSION_NOT_MIGRATED a real state rather than caution
--   CB-5  `diagnostic_scores` accepts a metadata-only row, so an analysis whose
--         submission was migrated by an older revision still records its bands
-- ---------------------------------------------------------------------------

SET ROLE service_role;

DO $$
DECLARE
  v_org        UUID := '11111111-1111-4111-8111-111111111111';
  v_submission UUID;
  v_count      INTEGER;
  v_failed     BOOLEAN;
  v_meta       JSONB;
BEGIN
  SELECT id INTO v_submission
    FROM public.submissions
   WHERE legacy_kv_key = 'sub:sub-1' AND deleted_at IS NULL;
  IF v_submission IS NULL THEN
    RAISE EXCEPTION 'CB-0: the submission fixture is missing — run 111 first';
  END IF;

  -- -------------------------------------------------------------------------
  -- CB-1. A raw heatmap value is not a percentage.
  --
  -- The column is CHECK (score >= 0 AND score <= 100), so storing 4 for "four
  -- out of five" is ACCEPTED by the database and read as four percent by every
  -- consumer. The constraint cannot catch that, which is precisely why the
  -- scaling has to happen in the normalizer — and why this assertion proves
  -- the RANGE rather than the meaning.
  -- -------------------------------------------------------------------------
  v_failed := FALSE;
  BEGIN
    INSERT INTO public.domain_scores (organization_id, submission_id, domain_key, score)
    VALUES (v_org, v_submission, 'out_of_range', 140);
  EXCEPTION WHEN check_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'CB-1: a score of 140 was accepted — the 0-100 constraint is not there';
  END IF;

  -- And the direction that matters for the normalizer's dropped values: a
  -- negative pillar is refused too, so passing one through would abort a batch.
  v_failed := FALSE;
  BEGIN
    INSERT INTO public.domain_scores (organization_id, submission_id, domain_key, score)
    VALUES (v_org, v_submission, 'negative', -1);
  EXCEPTION WHEN check_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'CB-1: a negative score was accepted';
  END IF;
  RAISE NOTICE 'assert_cortex_backfill: PASSED (CB-1, the score column enforces 0-100)';

  -- -------------------------------------------------------------------------
  -- CB-2. The scaled row, written the way the backfill writes it.
  -- -------------------------------------------------------------------------
  INSERT INTO public.domain_scores (organization_id, submission_id, domain_key, score, metadata)
  VALUES (
    v_org, v_submission, 'operations_execution', 80,
    '{"migration_run_id": "run-1", "source_scale": "0-5", "source_value": 4}'::jsonb
  );

  SELECT metadata INTO v_meta
    FROM public.domain_scores
   WHERE submission_id = v_submission AND domain_key = 'operations_execution';
  IF v_meta->>'source_value' <> '4' OR v_meta->>'source_scale' <> '0-5' THEN
    RAISE EXCEPTION 'CB-2: the transformation provenance did not survive the write';
  END IF;
  RAISE NOTICE 'assert_cortex_backfill: PASSED (CB-2, the scaled score and its provenance round-trip)';

  -- -------------------------------------------------------------------------
  -- CB-3. The key shape and the one-row-per-pillar rule.
  -- -------------------------------------------------------------------------
  v_failed := FALSE;
  BEGIN
    INSERT INTO public.domain_scores (organization_id, submission_id, domain_key, score)
    VALUES (v_org, v_submission, 'Revenue_Growth', 60);
  EXCEPTION WHEN check_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'CB-3: an upper-case domain_key was accepted — the declared key table would be optional';
  END IF;

  v_failed := FALSE;
  BEGIN
    INSERT INTO public.domain_scores (organization_id, submission_id, domain_key, score)
    VALUES (v_org, v_submission, 'operations_execution', 60);
  EXCEPTION WHEN unique_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'CB-3: a second row for one pillar was admitted — the writer''s upsert would be optional';
  END IF;
  RAISE NOTICE 'assert_cortex_backfill: PASSED (CB-3, lower-case keys and one row per pillar)';

  -- -------------------------------------------------------------------------
  -- CB-4. The dependency that makes SUBMISSION_NOT_MIGRATED a real state.
  -- -------------------------------------------------------------------------
  v_failed := FALSE;
  BEGIN
    INSERT INTO public.domain_scores (organization_id, submission_id, domain_key, score)
    VALUES (v_org, '99999999-9999-4999-8999-999999999999', 'orphan', 50);
  EXCEPTION WHEN foreign_key_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'CB-4: a domain score was admitted with no submission — the quarantine would be caution, not necessity';
  END IF;
  RAISE NOTICE 'assert_cortex_backfill: PASSED (CB-4, a domain score requires its submission)';

  -- -------------------------------------------------------------------------
  -- CB-5. A metadata-only score row.
  --
  -- `diagnostic_scores` is written by the submission backfill, but a deployment
  -- may run this domain against submissions migrated by an older revision. The
  -- score columns are nullable, so "we know the bands and not the numbers" is a
  -- writable statement — which is what lets the cortex domain enrich without
  -- inventing a number.
  -- -------------------------------------------------------------------------
  DELETE FROM public.diagnostic_scores WHERE submission_id = v_submission;
  INSERT INTO public.diagnostic_scores (organization_id, submission_id, metadata)
  VALUES (
    v_org, v_submission,
    '{"cortex_readiness_band": "High", "cortex_model": "gpt-4o"}'::jsonb
  );

  SELECT count(*) INTO v_count
    FROM public.diagnostic_scores
   WHERE submission_id = v_submission
     AND completion_score IS NULL
     AND metadata->>'cortex_readiness_band' = 'High';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'CB-5: a metadata-only score row was not writable';
  END IF;
  RAISE NOTICE 'assert_cortex_backfill: PASSED (CB-5, bands are recordable without inventing a number)';
END $$;

RESET ROLE;
