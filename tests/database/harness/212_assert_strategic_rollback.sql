-- ============================================================================
-- CP-4 — what the strategic rollback must leave behind.
--
-- Two halves, and the second matters more than the first. A rollback that
-- removes its own tables is ordinary; a rollback that takes the ORGANIZATION
-- with it is a disaster that only shows up when somebody runs it.
-- ============================================================================

\set ON_ERROR_STOP on

DO $$
DECLARE v_tables INT; v_permissions INT;
BEGIN
  -- 1. The strategic tables are gone.
  SELECT count(*) INTO v_tables
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name IN ('goals', 'decisions', 'risks');
  IF v_tables <> 0 THEN
    RAISE EXCEPTION 'rollback left % strategic tables behind', v_tables;
  END IF;

  -- 2. And so are the permission keys. A key with no table behind it is a
  --    grant that looks meaningful and governs nothing.
  SELECT count(*) INTO v_permissions
  FROM public.permissions WHERE key IN ('strategy.read', 'strategy.manage');
  IF v_permissions <> 0 THEN
    RAISE EXCEPTION 'rollback left % strategy permission keys behind', v_permissions;
  END IF;

  RAISE NOTICE '  ok  the strategic layer is gone, tables and permissions';
END $$;

DO $$
DECLARE v_missing TEXT; v_people INT; v_teams INT; v_units INT; v_structure INT;
BEGIN
  -- 3. THE ORGANIZATION IS INTACT. `goals.owner_person_id` referenced `people`;
  --    dropping `goals` must remove the reference and not a single person.
  --
  --    Checked by NAMED ROW rather than by exact count. The assertions that ran
  --    before this one legitimately create rows — proving an org admin can
  --    manage the structure means inserting one — so a count is a moving target
  --    and a test that pinned it would fail for the wrong reason. Naming the
  --    fixture's own rows is both stabler and stronger: it says WHICH records
  --    survived, not how many.
  SELECT string_agg(missing, ', ') INTO v_missing FROM (
    SELECT 'person ' || id AS missing FROM (VALUES
      ('a0000000-0000-4000-8000-00000000ee01'::uuid),
      ('a0000000-0000-4000-8000-00000000ee02'::uuid),
      ('b0000000-0000-4000-8000-00000000ee01'::uuid)
    ) AS expected(id)
    WHERE NOT EXISTS (SELECT 1 FROM public.people p WHERE p.id = expected.id)
    UNION ALL
    SELECT 'team ' || id FROM (VALUES
      ('a0000000-0000-4000-8000-00000000cc01'::uuid),
      ('b0000000-0000-4000-8000-00000000cc01'::uuid)
    ) AS expected(id)
    WHERE NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = expected.id)
    UNION ALL
    SELECT 'department ' || id FROM (VALUES
      ('a0000000-0000-4000-8000-00000000dd01'::uuid),
      ('b0000000-0000-4000-8000-00000000dd01'::uuid)
    ) AS expected(id)
    WHERE NOT EXISTS (SELECT 1 FROM public.departments d WHERE d.id = expected.id)
    UNION ALL
    SELECT 'business unit ' || id FROM (VALUES
      ('a0000000-0000-4000-8000-00000000bb01'::uuid),
      ('b0000000-0000-4000-8000-00000000bb01'::uuid)
    ) AS expected(id)
    WHERE NOT EXISTS (SELECT 1 FROM public.business_units b WHERE b.id = expected.id)
  ) AS gaps;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'the rollback destroyed part of the organizational spine: %', v_missing;
  END IF;

  -- The reporting line that pointed at the person who owned a goal is still
  -- there. Dropping `goals` removed a reference TO a person and must not have
  -- touched the references BETWEEN them.
  IF NOT EXISTS (
    SELECT 1 FROM public.people
    WHERE id = 'a0000000-0000-4000-8000-00000000ee02'
      AND reports_to_person_id = 'a0000000-0000-4000-8000-00000000ee01'
  ) THEN
    RAISE EXCEPTION 'the rollback broke a reporting line';
  END IF;

  -- And nothing is empty, which would make every check above vacuous.
  SELECT count(*) INTO v_people FROM public.people;
  SELECT count(*) INTO v_teams  FROM public.teams;
  SELECT count(*) INTO v_units  FROM public.business_units;
  IF v_people = 0 OR v_teams = 0 OR v_units = 0 THEN
    RAISE EXCEPTION 'the spine is empty after the rollback: people=% teams=% units=%',
      v_people, v_teams, v_units;
  END IF;

  -- 4. And so are the spine's own permission keys.
  SELECT count(*) INTO v_structure
  FROM public.permissions
  WHERE key IN ('organization.structure.read', 'organization.structure.manage');
  IF v_structure <> 2 THEN
    RAISE EXCEPTION 'the rollback removed % of the spine''s 2 permission keys', 2 - v_structure;
  END IF;

  RAISE NOTICE '  ok  the organizational spine and its permissions survive the rollback';
END $$;
