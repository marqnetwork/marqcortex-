-- ============================================================================
-- MED-2, second arm — the post-write accounting assertion.
--
-- `80` proves the PRE-write catalog check. This file proves the check that
-- stands behind it: after the INSERT, every eligible candidate must hold a
-- membership row, whoever wrote it.
--
-- To exercise it, the catalog is left intact and the INSERT is made to drop one
-- row for a reason the pre-check cannot see — a BEFORE INSERT trigger that
-- returns NULL for one user. That is a stand-in for any future cause of a short
-- write (a policy, a rule, a constraint, a join that stops matching), and the
-- migration must refuse the whole run rather than commit the rest.
-- ============================================================================

INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-0000000b1001', 'drop-a@marq.test',
   '{"marq_team": true, "team_role": "owner"}'::JSONB, '{}'::JSONB),
  ('00000000-0000-4000-8000-0000000b1002', 'drop-b@marq.test',
   '{"marq_team": true, "team_role": "analyst"}'::JSONB, '{}'::JSONB);

CREATE OR REPLACE FUNCTION public._test_swallow_one_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.user_id = '00000000-0000-4000-8000-0000000b1002' THEN
    RETURN NULL;   -- silently dropped, exactly as a mismatched JOIN would
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER _test_swallow_one_membership
  BEFORE INSERT ON public.organization_memberships
  FOR EACH ROW EXECUTE FUNCTION public._test_swallow_one_membership();
