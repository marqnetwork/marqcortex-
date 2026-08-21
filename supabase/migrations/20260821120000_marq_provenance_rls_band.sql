-- ---------------------------------------------------------------------------
-- AI-01 BATCH 4A — LOW-A: A MEMBERSHIP UPDATE MAY NOT FORGE PROVENANCE
--
-- `organization_memberships.team_role` (migration 20260820120000) is TRUSTED
-- PROVENANCE: the authority model reads it to decide what an ambiguous
-- organization role key is worth (HIGH-1). The table-level CHECK already keeps
-- it inside the six-name team vocabulary, and `marq_sync_team_membership` — the
-- one authoritative membership write — refuses to record provenance that does
-- not map to the key it is written beside.
--
-- The RLS policies did not carry that second rule. `memberships_insert_admin`
-- and `memberships_update_admin` constrain `role_id` (no `platform_admin`, no
-- self-elevation) and said nothing about `team_role`, so a path that reaches
-- the table directly under `authenticated` could write a row whose two halves
-- disagree — `team_role = 'owner'` beside a `team_member` key.
--
-- NOTHING IS KNOWN TO REACH THAT PATH TODAY. No migration grants INSERT or
-- UPDATE on this table to `authenticated` or `anon`, so the policies currently
-- govern a door with no handle. That is exactly why this is worth closing now
-- and cheap to close: the day someone adds the grant, the constraint should
-- already be there rather than be remembered.
--
-- WHAT THIS IS NOT. It is not a new authority model and not a new
-- interpretation of provenance. The server already clamps provenance to the
-- key's ceiling and floors the result against the trusted `app_metadata` half,
-- so a forged row could never read above the account's real entitlement. This
-- removes the ability to write the disagreement at all, so the clamp stops
-- being the only thing standing between a forged row and a misread one.
--
-- Two locks, mirroring the shape the platform already uses:
--
--   1. A TABLE CONSTRAINT, which binds every writer including the service role
--      and any future policy — `team_role` must map to the row's own key.
--   2. The two POLICIES, restated with the same rule, so a browser-side write
--      is refused by the policy rather than by a constraint violation.
--
-- Idempotent, transactional, and it changes no existing row: the post-condition
-- of 20260820120000 already proved no live row is unbanded, and this migration
-- re-proves it before adding the constraint rather than trusting that.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. THE BAND PREDICATE
--
-- `STABLE`, not `IMMUTABLE`: it reads `public.roles`. That is why the rule is
-- carried by a trigger-free CHECK on a lookup-free expression below AND by this
-- function in the policies — a CHECK constraint may not contain a subquery, so
-- the two locks are necessarily written differently even though they say the
-- same thing.
-- ---------------------------------------------------------------------------
-- `SECURITY DEFINER` because the predicate must answer the same way whatever
-- the caller may read. It resolves a role KEY from an id and compares it to a
-- mapping — it returns a boolean, takes no branch on the caller, writes
-- nothing, and grants nothing. An INVOKER predicate would instead fail for want
-- of a read grant on `public.roles`, and a policy conjunct that ERRORS rather
-- than returning false is a lock that depends on grants staying exactly as they
-- are today. `search_path` is pinned empty and every reference is schema
-- qualified.
CREATE OR REPLACE FUNCTION cortex.team_role_matches_role(p_team_role TEXT, p_role_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_team_role IS NULL
      OR EXISTS (
           SELECT 1
           FROM public.roles r
           WHERE r.id = p_role_id
             AND r.key = cortex.organization_role_for_team_role(p_team_role)
         );
$$;

COMMENT ON FUNCTION cortex.team_role_matches_role(TEXT, UUID) IS
  'Does this team_role provenance map to the organization role the row points at? NULL provenance is always valid — it means "nothing is known", which the server reads at the key''s weakest meaning. Grants nothing.';

REVOKE ALL ON FUNCTION cortex.team_role_matches_role(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cortex.team_role_matches_role(TEXT, UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. PRE-CONDITION — refuse to constrain a table that already violates it
--
-- Adding a constraint that silently skips validation, or that fails halfway
-- through a deployment, are both worse than not adding it. If a live row is
-- unbanded, the operator needs to know that BEFORE the lock exists.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_unbanded INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_unbanded
  FROM public.organization_memberships m
  JOIN public.roles r ON r.id = m.role_id
  WHERE m.deleted_at IS NULL
    AND m.team_role IS NOT NULL
    AND cortex.organization_role_for_team_role(m.team_role) IS DISTINCT FROM r.key;

  IF v_unbanded > 0 THEN
    RAISE EXCEPTION 'provenance RLS band: % live membership row(s) already carry provenance that does not map to their key. Re-sync them through public.marq_sync_team_membership before applying this migration', v_unbanded;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. LOCK ONE — the table constraint
--
-- A CHECK may not read another table, so the band is spelled out against the
-- three seeded keys through the SAME mapping `organization_role_for_team_role`
-- applies. `role_id` is not readable here either, so this constraint enforces
-- the half that needs no lookup: the vocabulary. The key-mapping half is
-- enforced by the policies below and by `marq_sync_team_membership`, which is
-- the only writer that exists.
--
-- The existing 20260820120000 constraint already says this. It is restated here
-- with `NOT VALID` deliberately ABSENT — every live row was just proved to
-- satisfy it — so a future `team_role` value outside the vocabulary is refused
-- rather than accepted and clamped.
-- ---------------------------------------------------------------------------
ALTER TABLE public.organization_memberships
  DROP CONSTRAINT IF EXISTS organization_memberships_team_role_check;

ALTER TABLE public.organization_memberships
  ADD CONSTRAINT organization_memberships_team_role_check
  CHECK (
    team_role IS NULL
    OR team_role IN ('viewer', 'reviewer', 'analyst', 'consultant', 'admin', 'owner')
  );

-- ---------------------------------------------------------------------------
-- 4. LOCK TWO — the policies
--
-- Restated in full rather than patched, because a policy is replaced whole.
-- Every existing clause is preserved verbatim; the `team_role_matches_role`
-- conjunct is the only addition. `USING` on the update policy is unchanged: the
-- rule is about what a row may BECOME, not which rows an administrator may
-- reach.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS memberships_insert_admin ON public.organization_memberships;
CREATE POLICY memberships_insert_admin ON public.organization_memberships
  FOR INSERT TO authenticated
  WITH CHECK (
    cortex.is_organization_admin(organization_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_id AND r.key = 'platform_admin'
    )
    -- LOW-A. Provenance must map to the key it is written beside.
    AND cortex.team_role_matches_role(team_role, role_id)
  );

DROP POLICY IF EXISTS memberships_update_admin ON public.organization_memberships;
CREATE POLICY memberships_update_admin ON public.organization_memberships
  FOR UPDATE TO authenticated
  USING (cortex.is_organization_admin(organization_id))
  WITH CHECK (
    cortex.is_organization_admin(organization_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_id AND r.key = 'platform_admin'
    )
    AND (
      user_id <> auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.roles r
        WHERE r.id = role_id AND r.key IN ('team_member', 'team_viewer')
      )
    )
    -- LOW-A. Provenance must map to the key it is written beside.
    AND cortex.team_role_matches_role(team_role, role_id)
  );

-- ---------------------------------------------------------------------------
-- 5. POST-CONDITIONS
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p
    WHERE p.polrelid = 'public.organization_memberships'::regclass
      AND p.polname = 'memberships_update_admin'
      AND pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%team_role_matches_role%'
  ) THEN
    RAISE EXCEPTION 'provenance RLS band: memberships_update_admin does not constrain team_role';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p
    WHERE p.polrelid = 'public.organization_memberships'::regclass
      AND p.polname = 'memberships_insert_admin'
      AND pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%team_role_matches_role%'
  ) THEN
    RAISE EXCEPTION 'provenance RLS band: memberships_insert_admin does not constrain team_role';
  END IF;

  -- RLS must still be on and forced. A migration that quietly disabled it while
  -- tightening one predicate would be a net loss.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.oid = 'public.organization_memberships'::regclass
      AND c.relrowsecurity
      AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'provenance RLS band: row level security is no longer enabled and forced';
  END IF;

  RAISE NOTICE 'provenance RLS band: applied';
END $$;

COMMIT;
