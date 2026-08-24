-- ============================================================================
-- AI-01 Batch 4A remediation, round 2 — authority recovery and honest reporting
-- Depends on: 20260818120000_marq_team_membership_bootstrap.sql
--             20260818130000_marq_membership_lifecycle.sql
-- Rollback:   supabase/migrations/rollbacks/20260819120000_rollback_authority_recovery.sql
--
-- WHAT THIS CLOSES
--
--   L1  A stamped account that somebody changed afterwards could never be
--       unstamped. `cortex.unstamp_team_roster` compares the live
--       `raw_app_meta_data` against what the artifact wrote and SKIPS anything
--       that differs — correct, because resetting a bag somebody else edited
--       destroys their edit. But it left no way forward at all: the console's
--       own `PATCH /team/members/:id` rewrites `team_role`, so an ordinary role
--       change is enough to make an account permanently unrevertable, and the
--       only remaining cure was hand-written SQL against `auth.users` that no
--       runbook described. A rollback with an undocumented manual step is a
--       rollback that does not exist.
--
--       `cortex.release_team_stamp` is the documented way forward. It is
--       per-account, explicit, reason-bearing, dry-run by default, and it only
--       ever REMOVES team authority — it never restores a recorded bag over a
--       later edit, and it never grants anything.
--
--   L2  `POST /team/invite` creates the auth account and then creates the
--       membership. An isolate that dies between the two leaves a stamped
--       account with no membership — the MED-1 state, arrived at by crashing
--       rather than by design. The route already compensates when the
--       membership write FAILS; it cannot compensate for not running at all.
--       Two systems cannot be written in one transaction, so the answer is
--       deterministic detection plus a documented, bounded recovery:
--       `cortex.orphaned_team_accounts()` names them, and the runbook says what
--       to do with each one.
--
--   L4  `marq_sync_team_membership` reported `created` from an arm that had
--       actually UPDATED a row another writer created, and the console's
--       `MembershipAction` union carried `reactivated`, which no code path can
--       produce. Both are corrected below and in `membershipLifecycle.ts`.
--
-- WHAT THIS DOES NOT DO
--
--   * It introduces no new authority. Every function here removes team status,
--     reports on it, or writes the same membership row the lifecycle already
--     writes. Nothing grants `platform_role`, and nothing writes it.
--   * It invents no suspension or ban feature (L3). Banned-account semantics
--     are asserted where they already live — GoTrue refuses a banned account's
--     token, and the bootstrap's eligibility predicate excludes `banned_until`
--     — and `cortex.orphaned_team_accounts()` reports the ban rather than
--     acting on it.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. L4 — THE MEMBERSHIP WRITE REPORTS WHAT IT DID
--
-- Unchanged in every respect but the reporting: same signature, same guards,
-- same advisory lock, same mapping assertion, same log. `CREATE OR REPLACE`
-- rather than a new name, so there is still exactly one membership write.
--
-- The `ON CONFLICT … DO UPDATE` arm is reachable only when a row appeared
-- between this session's SELECT and its INSERT — which the advisory lock
-- prevents for every writer that takes it, and does not prevent for a manual
-- `INSERT` in a SQL console. When it happens, this session does not know what
-- role the row carried before it took it over, so it says `reconciled` instead
-- of naming a transition it did not observe. `xmax = 0` is true only for a
-- tuple this statement inserted, which is how the two arms are told apart.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.marq_sync_team_membership(
  p_user_id   UUID,
  p_team_role TEXT,
  p_actor_id  UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_id          UUID;
  v_role_key        TEXT;
  v_role_id         UUID;
  v_membership_id   UUID;
  v_existing_role   UUID;
  v_existing_status TEXT;
  v_status          TEXT;
  v_action          TEXT;
  v_inserted        BOOLEAN;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'marq_sync_team_membership: a user id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = p_user_id
      AND (to_jsonb(u) ->> 'deleted_at') IS NULL
  ) THEN
    RAISE EXCEPTION 'marq_sync_team_membership: % is not a live auth user', p_user_id;
  END IF;

  v_role_key := cortex.organization_role_for_team_role(p_team_role);

  -- Structurally impossible from the mapping above, asserted anyway: a
  -- lifecycle that COULD mint platform administration should be unable to, not
  -- merely unlikely to.
  IF v_role_key = 'platform_admin' OR NOT (v_role_key = ANY (ARRAY['org_admin', 'team_member', 'team_viewer'])) THEN
    RAISE EXCEPTION 'marq_sync_team_membership: refusing to assign the organization role %', v_role_key;
  END IF;

  v_org_id  := cortex.marq_organization_id_strict();
  v_role_id := cortex.system_role_id(v_role_key);

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'marq_sync_team_membership: the seeded system role % is missing from the catalog', v_role_key;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('cortex.membership_bootstrap')::BIGINT);

  SELECT m.id, m.role_id, m.status
    INTO v_membership_id, v_existing_role, v_existing_status
  FROM public.organization_memberships m
  WHERE m.organization_id = v_org_id
    AND m.user_id = p_user_id
    AND m.deleted_at IS NULL
  LIMIT 1;

  IF v_membership_id IS NULL THEN
    INSERT INTO public.organization_memberships (organization_id, user_id, role_id, status, joined_at, invited_by)
    VALUES (v_org_id, p_user_id, v_role_id, 'active', now(), p_actor_id)
    -- A concurrent creator is a lost race, not an error. Taking the update arm
    -- keeps the mapped role authoritative in both branches: the alternative,
    -- DO NOTHING, would leave the other session's role standing after an
    -- administrator explicitly asked for this one.
    ON CONFLICT (organization_id, user_id) WHERE deleted_at IS NULL
      DO UPDATE SET role_id = EXCLUDED.role_id
    RETURNING id, status, (xmax = 0) INTO v_membership_id, v_status, v_inserted;
    -- L4. `created` is claimed only for a tuple this statement inserted.
    v_action := CASE WHEN v_inserted THEN 'created' ELSE 'reconciled' END;
  ELSIF v_existing_role IS DISTINCT FROM v_role_id THEN
    UPDATE public.organization_memberships
    SET role_id = v_role_id
    WHERE id = v_membership_id
    RETURNING status INTO v_status;
    v_action := 'role_changed';
  ELSE
    v_status := v_existing_status;
    v_action := 'unchanged';
  END IF;

  INSERT INTO cortex.membership_lifecycle_log
    (operation, action, organization_id, user_id, actor_id, team_role, role_key, membership_id)
  VALUES
    ('sync', v_action, v_org_id, p_user_id, p_actor_id, lower(trim(COALESCE(p_team_role, ''))), v_role_key, v_membership_id);

  RETURN jsonb_build_object(
    'organization_id', v_org_id,
    'membership_id',   v_membership_id,
    'role_key',        v_role_key,
    'status',          v_status,
    'action',          v_action
  );
END $$;

COMMENT ON FUNCTION public.marq_sync_team_membership(UUID, TEXT, UUID) IS
  'Authoritative MARQ membership write. Takes a user id and a team role; resolves the organization and the system role internally. Reports created / role_changed / unchanged / reconciled.';

-- ---------------------------------------------------------------------------
-- 2. L1 — PROVENANCE FOR A RELEASE
--
-- Two columns, both nullable, both written only by `release_team_stamp`. The
-- reason is NOT optional at the function boundary; it is nullable in the table
-- because every row written before this migration has none.
-- ---------------------------------------------------------------------------

ALTER TABLE cortex.team_roster_stamp_log
  ADD COLUMN IF NOT EXISTS released_reason       TEXT,
  ADD COLUMN IF NOT EXISTS released_app_metadata JSONB;

COMMENT ON COLUMN cortex.team_roster_stamp_log.released_reason IS
  'Why a drifted stamp was force-released. Set by cortex.release_team_stamp only; NULL for a clean unstamp.';
COMMENT ON COLUMN cortex.team_roster_stamp_log.released_app_metadata IS
  'The app_metadata observed at release time — what the account actually carried, not what the artifact wrote.';

-- ---------------------------------------------------------------------------
-- 3. L1 — WHAT DRIFTED, AND WHY
--
-- `unstamp_team_roster --dry-run` reports how MANY accounts changed since the
-- stamp. An operator deciding what to do about them needs to know WHICH, and
-- what the difference is. Read-only; writes nothing.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION cortex.team_stamp_drift(p_artifact TEXT)
RETURNS TABLE (
  user_id            UUID,
  stamped_team_role  TEXT,
  stamped_at         TIMESTAMPTZ,
  current_marq_team  BOOLEAN,
  current_team_role  TEXT,
  still_matches      BOOLEAN
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT l.user_id,
         l.team_role,
         l.stamped_at,
         COALESCE(u.raw_app_meta_data ->> 'marq_team', '') = 'true',
         u.raw_app_meta_data ->> 'team_role',
         u.raw_app_meta_data IS NOT DISTINCT FROM l.stamped_app_metadata
  FROM cortex.team_roster_stamp_log l
  JOIN auth.users u ON u.id = l.user_id
  WHERE l.artifact = p_artifact
    AND l.reverted_at IS NULL
  ORDER BY l.user_id;
$$;

COMMENT ON FUNCTION cortex.team_stamp_drift(TEXT) IS
  'Per-account state of one stamping artifact: what was stamped, what the account carries now, and whether an unstamp would still touch it.';

-- ---------------------------------------------------------------------------
-- 4. L1 — THE DOCUMENTED WAY OUT OF A DRIFTED STAMP
--
-- Strips `marq_team` and `team_role` from what the account CURRENTLY carries.
-- Deliberately not "restore the recorded previous bag": that bag is a snapshot
-- from before the stamp, and overwriting a later edit with it would destroy
-- whatever else somebody has legitimately added since — `platform_role`, for
-- one. Removing the two keys this artifact is responsible for leaves every
-- other key exactly as found.
--
-- The result is always a REDUCTION in authority: the account stops being a
-- provisioned team account, `resolveTeamAuthority` returns no role, and every
-- console route refuses it. There is no argument list that makes this function
-- grant something, which is what makes it safe to expose as a recovery path.
--
-- It refuses an account that has NOT drifted, and names `unstamp_team_roster`
-- instead: the clean reversal restores the previous bag, which is strictly
-- better, and an operator reaching for the forceful tool first should be told.
--
-- Memberships are NOT touched, for the same reason `unstamp_team_roster` does
-- not touch them: revocation is `public.marq_revoke_team_membership`, and the
-- runbook states the order (stamp last, unstamp first).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION cortex.release_team_stamp(
  p_artifact TEXT,
  p_user_id  UUID,
  p_reason   TEXT,
  p_dry_run  BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_log_id     UUID;
  v_stamped    JSONB;
  v_current    JSONB;
  v_after      JSONB;
BEGIN
  IF p_artifact IS NULL OR trim(p_artifact) = '' THEN
    RAISE EXCEPTION 'release_team_stamp: an artifact identifier is required';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'release_team_stamp: a user id is required. This function releases ONE account at a time, on purpose';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 8 THEN
    RAISE EXCEPTION 'release_team_stamp: a reason of at least 8 characters is required and is recorded permanently';
  END IF;

  SELECT l.id, l.stamped_app_metadata, u.raw_app_meta_data
    INTO v_log_id, v_stamped, v_current
  FROM cortex.team_roster_stamp_log l
  JOIN auth.users u ON u.id = l.user_id
  WHERE l.artifact = p_artifact
    AND l.user_id = p_user_id
    AND l.reverted_at IS NULL;

  IF v_log_id IS NULL THEN
    RAISE EXCEPTION 'release_team_stamp: no live stamp for user % under artifact %. Nothing to release',
      p_user_id, p_artifact;
  END IF;

  IF v_current IS NOT DISTINCT FROM v_stamped THEN
    RAISE EXCEPTION 'release_team_stamp: % has not drifted from artifact %. Use cortex.unstamp_team_roster, which restores what the account carried before the stamp',
      p_user_id, p_artifact;
  END IF;

  -- Remove exactly the two keys this artifact owns. Everything else survives.
  v_after := COALESCE(v_current, '{}'::JSONB) - 'marq_team' - 'team_role';

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'artifact', p_artifact,
      'user_id',  p_user_id,
      'dry_run',  true,
      'released', 0,
      'current_app_metadata', v_current,
      'would_become',         v_after
    );
  END IF;

  UPDATE auth.users SET raw_app_meta_data = v_after WHERE id = p_user_id;

  UPDATE cortex.team_roster_stamp_log
  SET reverted_at           = now(),
      released_reason       = trim(p_reason),
      released_app_metadata = v_current
  WHERE id = v_log_id;

  RETURN jsonb_build_object(
    'artifact', p_artifact,
    'user_id',  p_user_id,
    'dry_run',  false,
    'released', 1,
    'current_app_metadata', v_current,
    'became',               v_after
  );
END $$;

COMMENT ON FUNCTION cortex.release_team_stamp(TEXT, UUID, TEXT, BOOLEAN) IS
  'Recovery path for a stamped account changed since its stamp: removes marq_team and team_role from what it currently carries, keeping every other key. Reason required, dry-run by default, never grants.';

-- ---------------------------------------------------------------------------
-- 5. L2 — DETERMINISTIC ORPHAN DETECTION
--
-- An orphan is a stamped, live auth account with no live membership in the MARQ
-- organization. It is exactly what an invite leaves behind if the isolate dies
-- between `createUser` and `marq_sync_team_membership`, and it is also what a
-- half-finished manual stamp leaves behind.
--
-- Detection is a query rather than a background job because the recovery is a
-- DECISION: adopt the account (`marq_sync_team_membership`) or remove it. Both
-- are already implemented and neither should be chosen automatically — an
-- automatic adopt would grant a membership nobody approved, and an automatic
-- delete would remove an account somebody may be mid-way through creating.
--
-- `banned` is reported, not acted on (L3). A banned account cannot authenticate
-- at all, so it is already fail-closed; the flag is here so an operator reading
-- the list is not surprised by a row they cannot log in as.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION cortex.orphaned_team_accounts()
RETURNS TABLE (
  user_id       UUID,
  email         TEXT,
  team_role     TEXT,
  created_at    TIMESTAMPTZ,
  banned        BOOLEAN,
  age_minutes   NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT u.id,
         u.email::TEXT,
         u.raw_app_meta_data ->> 'team_role',
         u.created_at,
         COALESCE((to_jsonb(u) ->> 'banned_until')::TIMESTAMPTZ > now(), false),
         round(EXTRACT(EPOCH FROM (now() - u.created_at)) / 60.0, 1)
  FROM auth.users u
  WHERE COALESCE(u.raw_app_meta_data ->> 'marq_team', '') = 'true'
    AND (to_jsonb(u) ->> 'deleted_at') IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.organization_memberships m
      JOIN public.organizations o ON o.id = m.organization_id
      WHERE m.user_id = u.id
        AND m.deleted_at IS NULL
        AND m.status = 'active'
        AND o.slug = 'marq'
        AND o.deleted_at IS NULL
    )
  ORDER BY u.created_at;
$$;

COMMENT ON FUNCTION cortex.orphaned_team_accounts() IS
  'Stamped, live auth accounts with no active MARQ membership — the state an invite leaves if the isolate dies between the two writes. Detection only; recovery is a documented operator decision.';

-- Invoker rights and granted to nobody: all three read or write `auth.users`,
-- which no API role may reach. They run over a privileged direct connection,
-- the same way stamping does.
REVOKE ALL ON FUNCTION cortex.release_team_stamp(TEXT, UUID, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION cortex.team_stamp_drift(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION cortex.orphaned_team_accounts() FROM PUBLIC;

COMMIT;
