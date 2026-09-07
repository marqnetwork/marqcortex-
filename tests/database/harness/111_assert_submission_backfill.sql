-- ---------------------------------------------------------------------------
-- ASSERT — the submission backfill, against the constraints it will actually
-- meet.
--
-- The unit suite proves the normalizer's decisions and the domain suite proves
-- the SHAPE of the writes. Neither can prove that the rows survive contact with
-- the schema, and that is the half of a backfill that fails at three in the
-- morning against production data.
--
-- Everything below drives the statements the backfill issues, in the order it
-- issues them, as `service_role` — the role the migration engine's client
-- holds.
--
--   SB-1  a submission is written and found again by `legacy_kv_key`
--   SB-2  the `legacy_kv_key` unique index refuses a second row for one KV key
--   SB-3  the status and priority CHECK constraints refuse the CONSOLE
--         vocabulary, which is why the normalizer canonicalises rather than
--         passing through
--   SB-4  answers respect the lower-case CHECK and the
--         (submission_id, question_key) unique index
--   SB-5  the retirement sweep soft-deletes exactly the keys KV no longer
--         carries — and retires EVERYTHING when KV carries none
--   SB-6  one score row per submission, enforced by the database
--   SB-7  an outcome cannot exist without its submission, which is the FK the
--         whole domain ordering rests on
--   SB-8  the schema does NOT prevent a cross-tenant link, which is why the
--         backfill scopes its lookups — a control that lives in code has to be
--         shown to be the only one there is
-- ---------------------------------------------------------------------------

SET ROLE service_role;

DO $$
DECLARE
  v_org        UUID := '11111111-1111-4111-8111-111111111111';
  v_other_org  UUID := '22222222-2222-4222-8222-222222222222';
  v_submission UUID;
  v_found      UUID;
  v_count      INTEGER;
  v_failed     BOOLEAN;
BEGIN
  -- -------------------------------------------------------------------------
  -- SB-1. The submission, written the way the backfill writes it.
  -- -------------------------------------------------------------------------
  INSERT INTO public.submissions (
    organization_id, lead_id, contact_id, legacy_kv_key, legacy_id,
    company_name, contact_name, contact_email, status, priority,
    completion_score, quality_score, ai_score, submitted_at, metadata
  )
  VALUES (
    v_org, 'cccccccc-1111-4111-8111-cccccccccccc', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
    'sub:sub-1', 'sub-1', 'Acme Ltd', 'Dana Reed', 'dana.reed@acme.test',
    'under_review', 'high', 88, 74, 71, '2026-08-20T09:00:00Z',
    '{"migration_run_id": "run-1"}'::jsonb
  )
  RETURNING id INTO v_submission;

  SELECT id INTO v_found
    FROM public.submissions
   WHERE legacy_kv_key = 'sub:sub-1' AND deleted_at IS NULL;
  IF v_found IS DISTINCT FROM v_submission THEN
    RAISE EXCEPTION 'SB-1: the backfill cannot find the row it just wrote by legacy_kv_key';
  END IF;
  RAISE NOTICE 'assert_submission_backfill: PASSED (SB-1, the submission round-trips by legacy_kv_key)';

  -- -------------------------------------------------------------------------
  -- SB-2. One KV key, one row. This is what makes a re-run an UPDATE rather
  -- than a second submission, and it is enforced by the database rather than
  -- only by the writer's `maybeSingle` lookup.
  -- -------------------------------------------------------------------------
  v_failed := FALSE;
  BEGIN
    INSERT INTO public.submissions (
      organization_id, legacy_kv_key, legacy_id, company_name, contact_email
    ) VALUES (v_org, 'sub:sub-1', 'sub-1', 'Acme Ltd', 'dana.reed@acme.test');
  EXCEPTION WHEN unique_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'SB-2: a second row was admitted for one KV key — a re-run would duplicate';
  END IF;
  RAISE NOTICE 'assert_submission_backfill: PASSED (SB-2, legacy_kv_key admits exactly one row)';

  -- -------------------------------------------------------------------------
  -- SB-3. The console vocabulary is REFUSED. This is the assertion that makes
  -- the normalizer's status table load-bearing rather than decorative: writing
  -- KV's own spelling would abort the batch.
  -- -------------------------------------------------------------------------
  v_failed := FALSE;
  BEGIN
    INSERT INTO public.submissions (
      organization_id, legacy_kv_key, legacy_id, company_name, contact_email, status
    ) VALUES (v_org, 'sub:sub-console', 'sub-console', 'Acme Ltd', 'a@acme.test', 'under-review');
  EXCEPTION WHEN check_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'SB-3: the console status ''under-review'' was accepted — canonicalisation is not load-bearing';
  END IF;

  v_failed := FALSE;
  BEGIN
    INSERT INTO public.submissions (
      organization_id, legacy_kv_key, legacy_id, company_name, contact_email, status
    ) VALUES (v_org, 'sub:sub-approved', 'sub-approved', 'Acme Ltd', 'a@acme.test', 'approved');
  EXCEPTION WHEN check_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'SB-3: the console status ''approved'' was accepted, so mapping it to ''won'' would be optional';
  END IF;

  v_failed := FALSE;
  BEGIN
    INSERT INTO public.submissions (
      organization_id, legacy_kv_key, legacy_id, company_name, contact_email, priority
    ) VALUES (v_org, 'sub:sub-pri', 'sub-pri', 'Acme Ltd', 'a@acme.test', 'critical');
  EXCEPTION WHEN check_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'SB-3: priority ''critical'' was accepted, so the normalizer''s allow list is not load-bearing';
  END IF;
  RAISE NOTICE 'assert_submission_backfill: PASSED (SB-3, the console vocabulary is refused by the schema)';

  -- -------------------------------------------------------------------------
  -- SB-4. Answers.
  -- -------------------------------------------------------------------------
  INSERT INTO public.diagnostic_answers (organization_id, submission_id, question_key, answer_text)
  VALUES (v_org, v_submission, 'q1', 'yes'),
         (v_org, v_submission, 'q2', 'no');

  v_failed := FALSE;
  BEGIN
    INSERT INTO public.diagnostic_answers (organization_id, submission_id, question_key, answer_text)
    VALUES (v_org, v_submission, 'Q3', 'upper');
  EXCEPTION WHEN check_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'SB-4: an upper-case question_key was accepted — the normalizer''s lower-casing would be optional';
  END IF;

  v_failed := FALSE;
  BEGIN
    INSERT INTO public.diagnostic_answers (organization_id, submission_id, question_key, answer_text)
    VALUES (v_org, v_submission, 'q1', 'again');
  EXCEPTION WHEN unique_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'SB-4: a duplicate (submission_id, question_key) was admitted — the collapse rule would be optional';
  END IF;
  RAISE NOTICE 'assert_submission_backfill: PASSED (SB-4, answers respect the check and the unique index)';

  -- -------------------------------------------------------------------------
  -- SB-5. The retirement sweep, exactly as the writer issues it.
  --
  -- KV now carries only `q1`. `q2` must be soft-deleted, and `q1` must not be.
  -- -------------------------------------------------------------------------
  UPDATE public.diagnostic_answers
     SET deleted_at = now()
   WHERE submission_id = v_submission
     AND deleted_at IS NULL
     AND question_key NOT IN ('q1');

  SELECT count(*) INTO v_count
    FROM public.diagnostic_answers
   WHERE submission_id = v_submission AND deleted_at IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SB-5: % answers survived the sweep, expected 1', v_count;
  END IF;

  SELECT count(*) INTO v_count
    FROM public.diagnostic_answers
   WHERE submission_id = v_submission AND question_key = 'q2' AND deleted_at IS NOT NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SB-5: the retired answer was hard-deleted or missed — a migration must not remove a row it did not create';
  END IF;

  -- KV now carries NO answers. Everything must retire, which is the case an
  -- empty exclusion list gets wrong if it is written as `NOT IN ()`.
  UPDATE public.diagnostic_answers
     SET deleted_at = now()
   WHERE submission_id = v_submission
     AND deleted_at IS NULL
     AND question_key NOT IN ('');

  SELECT count(*) INTO v_count
    FROM public.diagnostic_answers
   WHERE submission_id = v_submission AND deleted_at IS NULL;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SB-5: % answers survived an empty KV answer set, expected 0', v_count;
  END IF;
  RAISE NOTICE 'assert_submission_backfill: PASSED (SB-5, the sweep retires exactly what KV dropped, including all of it)';

  -- -------------------------------------------------------------------------
  -- SB-6. One score row per submission, enforced by the database.
  -- -------------------------------------------------------------------------
  INSERT INTO public.diagnostic_scores (organization_id, submission_id, completion_score)
  VALUES (v_org, v_submission, 88);

  v_failed := FALSE;
  BEGIN
    INSERT INTO public.diagnostic_scores (organization_id, submission_id, completion_score)
    VALUES (v_org, v_submission, 90);
  EXCEPTION WHEN unique_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'SB-6: a second score row was admitted — the writer''s update-or-insert would be optional';
  END IF;
  RAISE NOTICE 'assert_submission_backfill: PASSED (SB-6, one score row per submission)';

  -- -------------------------------------------------------------------------
  -- SB-7. The dependency the whole domain ordering rests on.
  --
  -- `outcomes.submission_id` is NOT NULL and references `submissions`, so no
  -- outcome can be backfilled before its submission exists. The roadmap says
  -- so; this proves it rather than repeating it.
  -- -------------------------------------------------------------------------
  v_failed := FALSE;
  BEGIN
    INSERT INTO public.outcomes (organization_id, submission_id, legacy_kv_key)
    VALUES (v_org, '99999999-9999-4999-8999-999999999999', 'outcome:ghost');
  EXCEPTION WHEN foreign_key_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'SB-7: an outcome was admitted with no submission — the domain ordering would be advisory';
  END IF;

  INSERT INTO public.outcomes (organization_id, submission_id, legacy_kv_key, outcome_type)
  VALUES (v_org, v_submission, 'outcome:sub-1', 'won');
  RAISE NOTICE 'assert_submission_backfill: PASSED (SB-7, an outcome requires its submission first)';

  -- -------------------------------------------------------------------------
  -- SB-8. THE CONTROL THAT LIVES IN CODE.
  --
  -- The schema does NOT stop a submission in one organization from pointing at
  -- a contact in another: the foreign key is to `contacts(id)` and carries no
  -- tenancy predicate. So the ONLY thing preventing a cross-tenant link during
  -- a backfill is the writer scoping its lookup by organization_id — and a
  -- control that exists in exactly one place must be shown to be the only one
  -- there is, or somebody will assume the database is catching it.
  -- -------------------------------------------------------------------------
  INSERT INTO public.submissions (
    organization_id, contact_id, legacy_kv_key, legacy_id, company_name, contact_email
  ) VALUES (
    v_org, 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', 'sub:cross-tenant', 'cross-tenant',
    'Acme Ltd', 'dana.reed@acme.test'
  );

  SELECT count(*) INTO v_count
    FROM public.submissions s
    JOIN public.contacts c ON c.id = s.contact_id
   WHERE s.legacy_kv_key = 'sub:cross-tenant'
     AND s.organization_id <> c.organization_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'SB-8: the schema now refuses a cross-tenant contact link. That is an IMPROVEMENT, and this '
      'assertion must be rewritten to match it rather than deleted — the backfill''s scoped lookup '
      'is still required, but it is no longer the only control.';
  END IF;
  DELETE FROM public.submissions WHERE legacy_kv_key = 'sub:cross-tenant';
  RAISE NOTICE 'assert_submission_backfill: PASSED (SB-8, cross-tenant links are refused by the WRITER, not the schema)';

  -- Prove the fixture's other tenant is untouched by any of the above.
  SELECT count(*) INTO v_count FROM public.submissions WHERE organization_id = v_other_org;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SB-8: % rows leaked into the other tenant', v_count;
  END IF;
END $$;

RESET ROLE;
