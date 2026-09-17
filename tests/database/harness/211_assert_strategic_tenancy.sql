-- ============================================================================
-- CP-4 — THE STRATEGIC LAYER'S TENANCY AND RBAC, AGAINST A REAL POSTGRES
--
-- Goals, decisions and risks are the most sensitive rows Cortex holds: a risk
-- register names what leadership fears and a decision log names who chose what.
-- Everything below runs as the `authenticated` role with a real
-- `request.jwt.claim.sub`, so the RLS policies are what decide.
--
-- Two things make these assertions different from the spine's:
--
--   READING IS OPEN, WRITING IS NOT. `strategy.read` follows `members.read`, so
--   every active member sees the organization's intent — that is deliberate and
--   the RLS migration explains why. `strategy.manage` follows `members.manage`,
--   which only `org_admin` and `platform_admin` hold. The viewer below is the
--   proof of both halves at once: it reads everything and changes nothing.
--
--   THE WRITE PATH IS THE PRODUCT NOW. CP-4 opened writes, so a refusal that
--   was previously theoretical is the thing a viewer will actually hit.
--
-- Every block RAISES on failure, and every count is asserted in BOTH
-- directions: the tenant's own rows visible as well as the other tenant's
-- invisible, so a policy that hides everything cannot pass as one that isolates.
-- ============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1. Org A reads its own strategy and none of Org B's
-- ---------------------------------------------------------------------------
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-0000-4000-8000-000000000001', false);
SELECT set_config('request.jwt.claims', '{"sub":"11111111-0000-4000-8000-000000000001","app_metadata":{}}', false);

DO $$
DECLARE v_g INT; v_d INT; v_r INT; v_og INT; v_od INT; v_or INT;
BEGIN
  SELECT count(*) INTO v_g FROM public.goals     WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000001';
  SELECT count(*) INTO v_d FROM public.decisions WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000001';
  SELECT count(*) INTO v_r FROM public.risks     WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000001';
  IF v_g <> 2 OR v_d <> 1 OR v_r <> 1 THEN
    RAISE EXCEPTION 'Alpha admin sees goals=% decisions=% risks=% of its own (expected 2/1/1) — the policy hides rather than isolates', v_g, v_d, v_r;
  END IF;

  SELECT count(*) INTO v_og FROM public.goals     WHERE organization_id = 'bbbbbbbb-0000-4000-8000-000000000002';
  SELECT count(*) INTO v_od FROM public.decisions WHERE organization_id = 'bbbbbbbb-0000-4000-8000-000000000002';
  SELECT count(*) INTO v_or FROM public.risks     WHERE organization_id = 'bbbbbbbb-0000-4000-8000-000000000002';
  IF v_og + v_od + v_or <> 0 THEN
    RAISE EXCEPTION 'CROSS-TENANT READ: Alpha admin sees Beta goals=% decisions=% risks=%', v_og, v_od, v_or;
  END IF;
  RAISE NOTICE '  ok  Org A reads its own goals, decisions and risks, and none of Org B''s';
END $$;

-- ---------------------------------------------------------------------------
-- 2. An unqualified filter returns only this tenant's rows
-- ---------------------------------------------------------------------------
-- The assertions above name an organization in the WHERE clause, which is how
-- the application queries. This one names none — a bare `SELECT count(*)` — so
-- a policy that only worked because the query happened to filter correctly
-- would be caught here.
DO $$
DECLARE v_total INT;
BEGIN
  SELECT count(*) INTO v_total FROM public.goals;
  IF v_total <> 2 THEN
    RAISE EXCEPTION 'An unfiltered read returned % goals; Alpha has 2', v_total;
  END IF;
  RAISE NOTICE '  ok  an unfiltered read returns this tenant''s rows and no others';
END $$;

-- ---------------------------------------------------------------------------
-- 3. A goal cannot be owned by another tenant's person
-- ---------------------------------------------------------------------------
-- The composite foreign key refuses this, not a handler. Beta's admin person
-- exists and is a valid uuid; what it is not is Alpha's.
DO $$
DECLARE v_state TEXT;
BEGIN
  BEGIN
    INSERT INTO public.goals (organization_id, statement, owner_person_id)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'Cross-tenant owner',
            'b0000000-0000-4000-8000-00000000ee01');
    RAISE EXCEPTION 'TENANT BREACH: an Org B person owns an Org A goal';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    RAISE NOTICE '  ok  a goal cannot be owned by another tenant''s person (%)', v_state;
  END;
END $$;

-- ---------------------------------------------------------------------------
-- 4. A risk cannot threaten another tenant's goal
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    INSERT INTO public.risks (organization_id, statement, goal_id)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'Cross-tenant link',
            'b0000000-0000-4000-8000-00000000aa01');
    RAISE EXCEPTION 'TENANT BREACH: an Org A risk threatens an Org B goal';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE '  ok  a risk cannot be linked across a tenant boundary';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- 5. A decision cannot be attributed to another tenant's person
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    INSERT INTO public.decisions (organization_id, statement, decided_by_person_id, decided_on, status)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'Cross-tenant decider',
            'b0000000-0000-4000-8000-00000000ee01', '2026-01-01', 'decided');
    RAISE EXCEPTION 'TENANT BREACH: an Org B person decided an Org A decision';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE '  ok  a decision cannot be attributed across a tenant boundary';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Naming another tenant's organization id grants nothing
-- ---------------------------------------------------------------------------
-- The caller-supplied-id property, restated for these tables. A policy never
-- reads a parameter: it reads the ROW's organization_id and asks whether this
-- caller is a member of THAT organization.
DO $$
DECLARE v_read INT;
BEGIN
  SELECT count(*) INTO v_read FROM public.risks
   WHERE organization_id = 'bbbbbbbb-0000-4000-8000-000000000002';
  IF v_read <> 0 THEN
    RAISE EXCEPTION 'Naming Beta''s id returned % rows', v_read;
  END IF;

  BEGIN
    INSERT INTO public.goals (organization_id, statement)
    VALUES ('bbbbbbbb-0000-4000-8000-000000000002', 'Written into somebody else''s tenant');
    RAISE EXCEPTION 'TENANT BREACH: Alpha admin wrote a goal into Beta';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  naming another tenant''s id grants nothing, read or write';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- 7. A row cannot be MOVED into another tenant
-- ---------------------------------------------------------------------------
-- The WITH CHECK half of the update policy. With USING alone the old value
-- passes and the new one is never examined.
DO $$
DECLARE v_moved INT;
BEGIN
  BEGIN
    UPDATE public.goals
       SET organization_id = 'bbbbbbbb-0000-4000-8000-000000000002'
     WHERE id = 'a0000000-0000-4000-8000-00000000aa01';
    GET DIAGNOSTICS v_moved = ROW_COUNT;
    IF v_moved > 0 THEN
      RAISE EXCEPTION 'TENANT BREACH: a goal was moved into Beta';
    END IF;
    RAISE NOTICE '  ok  a goal cannot be moved into another tenant';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  a goal cannot be moved into another tenant';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- 8. A VIEWER reads the organization's intent — all of it, and only its own
-- ---------------------------------------------------------------------------
-- `strategy.read` follows `members.read`, so a team viewer sees the goals, the
-- decisions and the risks. That is the deliberate choice, not an oversight:
-- the canon describes these as organizational records and Cortex's premise is
-- shared organizational intelligence. Asserted rather than assumed, because a
-- future grant change that quietly locked members out would otherwise be
-- invisible until somebody complained.
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-0000-4000-8000-000000000002', false);
SELECT set_config('request.jwt.claims', '{"sub":"11111111-0000-4000-8000-000000000002","app_metadata":{}}', false);

DO $$
DECLARE v_goals INT; v_decisions INT; v_risks INT; v_other INT;
BEGIN
  SELECT count(*) INTO v_goals     FROM public.goals;
  SELECT count(*) INTO v_decisions FROM public.decisions;
  SELECT count(*) INTO v_risks     FROM public.risks;
  IF v_goals <> 2 OR v_decisions <> 1 OR v_risks <> 1 THEN
    RAISE EXCEPTION 'The Alpha viewer sees goals=% decisions=% risks=% (expected 2/1/1)',
      v_goals, v_decisions, v_risks;
  END IF;

  -- And the tenant boundary still holds for a reader who is not an admin.
  SELECT count(*) INTO v_other FROM public.goals
   WHERE organization_id = 'bbbbbbbb-0000-4000-8000-000000000002';
  IF v_other <> 0 THEN
    RAISE EXCEPTION 'CROSS-TENANT READ: the Alpha viewer sees % Beta goals', v_other;
  END IF;
  RAISE NOTICE '  ok  a viewer reads its own organization''s intent, and none of another''s';
END $$;

-- ---------------------------------------------------------------------------
-- 9. And that viewer changes NOTHING
-- ---------------------------------------------------------------------------
-- The other half. `strategy.manage` follows `members.manage`, which a team
-- viewer does not hold. Read and write are separate keys, and this is what
-- makes that separation real rather than declared.
DO $$
DECLARE v_rows INT;
BEGIN
  BEGIN
    INSERT INTO public.goals (organization_id, statement)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'Written by somebody with no authority');
    RAISE EXCEPTION 'A member without strategy.manage wrote a goal';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  -- Nor can it edit one it can plainly see, which is the likelier attempt.
  UPDATE public.risks SET tolerance = 'within'
   WHERE id = 'a0000000-0000-4000-8000-00000000f501';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows > 0 THEN
    RAISE EXCEPTION 'A member without strategy.manage edited a risk';
  END IF;

  RAISE NOTICE '  ok  a viewer reads the strategy and changes none of it';
END $$;

-- ---------------------------------------------------------------------------
-- 10. A SUSPENDED membership reads nothing and writes nothing
-- ---------------------------------------------------------------------------
-- `suspended` exists precisely so a row can be present without granting. The
-- account below holds `org_admin` — the role is not the question.
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-0000-4000-8000-000000000003', false);
SELECT set_config('request.jwt.claims', '{"sub":"11111111-0000-4000-8000-000000000003","app_metadata":{}}', false);

DO $$
DECLARE v_read INT;
BEGIN
  SELECT count(*) INTO v_read FROM public.goals;
  IF v_read <> 0 THEN
    RAISE EXCEPTION 'A suspended membership read % goals', v_read;
  END IF;

  BEGIN
    INSERT INTO public.goals (organization_id, statement)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'Written by a suspended member');
    RAISE EXCEPTION 'A suspended membership wrote a goal';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  a suspended membership reads nothing and writes nothing';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- 11. An ORG ADMIN can do all of it — so the refusals are authority, not breakage
-- ---------------------------------------------------------------------------
-- THE LOAD-BEARING ONE. Without it every refusal above could be proving that
-- these tables are broken rather than that the boundary holds.
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-0000-4000-8000-000000000001', false);
SELECT set_config('request.jwt.claims', '{"sub":"11111111-0000-4000-8000-000000000001","app_metadata":{}}', false);

DO $$
DECLARE v_id UUID; v_rows INT;
BEGIN
  INSERT INTO public.goals (organization_id, statement, owner_person_id)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'A goal an admin recorded',
          'a0000000-0000-4000-8000-00000000ee01')
  RETURNING id INTO v_id;

  UPDATE public.goals SET status = 'completed' WHERE id = v_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'An admin could not update its own goal'; END IF;

  -- Soft delete, which is the only removal these tables have.
  UPDATE public.goals SET deleted_at = now() WHERE id = v_id;

  -- And a hard DELETE is refused to everybody, admin included.
  BEGIN
    DELETE FROM public.goals WHERE id = v_id;
    RAISE EXCEPTION 'A hard DELETE succeeded; soft deletion is the only path';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  RAISE NOTICE '  ok  an org admin records and changes strategy, so the refusals are authority and not breakage';
END $$;

-- ---------------------------------------------------------------------------
-- 12. A decision cannot claim to be DECIDED with nobody behind it
-- ---------------------------------------------------------------------------
-- ONT 14.8's "traceable" as a constraint rather than a convention. Without it
-- `decided` is a status anybody can set on a record with no decider, which
-- makes traceability optional in practice while the schema claims it.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.decisions (organization_id, statement, status)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'Decided by nobody', 'decided');
    RAISE EXCEPTION 'A decision was marked decided with no decider and no date';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  a decided decision names who decided it, and when';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- 13. An ACCEPTED risk has been assessed
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    INSERT INTO public.risks (organization_id, statement, status, tolerance)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'Accepted without assessment', 'accepted', 'unset');
    RAISE EXCEPTION 'A risk was accepted with its tolerance unset';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  an accepted risk has had its tolerance decided';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- 14. A goal can be owned by a person with NO LOGIN
-- ---------------------------------------------------------------------------
-- ONT 12.3 one layer up. The strategic layer must not quietly require an auth
-- account where the organizational layer does not.
DO $$
DECLARE v_owner UUID; v_user UUID;
BEGIN
  SELECT owner_person_id INTO v_owner FROM public.goals
   WHERE id = 'a0000000-0000-4000-8000-00000000aa02';
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'The goal owned by the login-less person lost its owner';
  END IF;

  SELECT user_id INTO v_user FROM public.people WHERE id = v_owner;
  IF v_user IS NOT NULL THEN
    RAISE EXCEPTION 'The fixture owner was expected to have no auth account';
  END IF;
  RAISE NOTICE '  ok  a goal is owned by a person who cannot sign in';
END $$;

RESET ROLE;

DO $$
BEGIN
  RAISE NOTICE 'strategic layer: all 14 tenancy, RBAC and integrity properties hold';
END $$;
