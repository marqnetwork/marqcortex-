-- ---------------------------------------------------------------------------
-- ASSERT — AI-01 Batch 4C: a FAILED migration leaves no partial schema state
--
-- Runs after the 4C migration has been made to fail (see
-- 97_4c_activation_collision_fixture.sql), on its own scratch database.
--
-- THE PROPERTY.
--
-- The obstacle is planted at the END of the file, so the migration creates all
-- three tables, both partial unique indexes and every constraint before it
-- fails. If the file were not one transaction, all of that would be sitting in
-- the database right now: a `cortex.ai_provider_credential` with no activation
-- function, which is a schema that accepts credential writes through paths the
-- design never intended, and a migration state that a re-run would find
-- half-satisfied because of `CREATE TABLE IF NOT EXISTS`.
--
-- That last part is why "it is wrapped in BEGIN/COMMIT" is not enough to read
-- off the file. `IF NOT EXISTS` makes a half-applied 4C SILENTLY re-appliable —
-- the second run would skip the tables it found and produce a schema nobody
-- ever reviewed. The only safe state after a failure is no state, and that is
-- what this asserts.
--
--   4C-N1  none of the three tables exists
--   4C-N2  no 4C index exists
--   4C-N3  no 4C constraint exists
--   4C-N4  the planted obstacle is still exactly as planted — the migration
--          did not partially overwrite it either
--   4C-N5  the base schema the migration ran against is untouched
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_left TEXT;
BEGIN
  -- 4C-N1.
  SELECT string_agg(c.relname, ', ') INTO v_left
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'cortex' AND c.relkind = 'r' AND c.relname LIKE 'ai_provider%';
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION
      '4C-N1: the FAILED migration left tables behind: %. The file is not transactional, and '
      'because it uses CREATE TABLE IF NOT EXISTS a re-run would skip them.', v_left;
  END IF;

  -- 4C-N2.
  SELECT string_agg(indexname, ', ') INTO v_left
    FROM pg_indexes WHERE schemaname = 'cortex' AND indexname LIKE 'ai_provider%';
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION '4C-N2: the FAILED migration left indexes behind: %', v_left;
  END IF;

  -- 4C-N3.
  SELECT string_agg(conname, ', ') INTO v_left
    FROM pg_constraint WHERE conname LIKE 'ai_provider%';
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION '4C-N3: the FAILED migration left constraints behind: %', v_left;
  END IF;

  -- 4C-N4. The obstacle is intact, which is how we know the migration reached
  -- it and stopped there rather than failing somewhere earlier for an unrelated
  -- reason.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'cortex'
       AND p.proname = 'ai_provider_credential_activate'
       AND pg_get_function_result(p.oid) = 'text'
  ) THEN
    RAISE EXCEPTION
      '4C-N4: the planted obstacle is gone or changed, so this run did not test what it '
      'claims to test';
  END IF;

  -- 4C-N5. The base schema is where it was.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'organization_memberships'
  ) THEN
    RAISE EXCEPTION '4C-N5: the failed migration damaged the tenancy foundation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.roles) THEN
    RAISE EXCEPTION '4C-N5: the failed migration emptied the seeded role catalogue';
  END IF;

  RAISE NOTICE
    'assert_4c_no_partial_state: PASSED (a failure at the last statement left no 4C schema)';
END $$;
