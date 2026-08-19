-- ============================================================================
-- AI-01 Batch 4A remediation — the MARQ membership lifecycle
-- Depends on: 20260711050000_cortex_tenancy_foundation.sql
--             20260711050001_cortex_tenancy_rls_and_seed.sql
--             20260714050001_cortex_diagnostic_rls.sql  (cortex schema, marq org)
--             20260818120000_marq_team_membership_bootstrap.sql
-- Rollback:   supabase/migrations/rollbacks/20260818130000_rollback_membership_lifecycle.sql
--
-- WHAT THIS CLOSES
--
-- The bootstrap migration admitted the team that existed when it ran. Nothing
-- kept the two halves of a team account — the trusted `app_metadata` on the
-- auth record and the row in `public.organization_memberships` — together
-- afterwards:
--
--   HIGH-1  A console demotion rewrote `app_metadata` and left `role_id` alone.
--           A demoted admin kept `org_admin`, and `ROLE_CAPABILITIES.org_admin`
--           kept granting `ai.agent.execute`. The revocation revoked nothing.
--
--   MED-1   A console invite wrote `app_metadata` and created no membership at
--           all, so every new hire authenticated and then failed
--           `ORGANIZATION_REQUIRED`. Re-running a migration was the only cure.
--
--   HIGH-3  Deciding who is internal MARQ staff was a paragraph of SQL in a
--           markdown file, hand-edited by whoever ran it. That is a security
--           boundary with no artifact, no validation and no provenance.
--
--   MED-2   A missing entry in the seeded role catalog made the bootstrap's
--           JOIN drop candidates silently: fewer people admitted, exit code 0.
--
-- THE SHAPE OF THE ANSWER
--
--   * `cortex.organization_role_for_team_role` — ONE mapping in SQL, mirroring
--     `TEAM_ROLE_TO_ORGANIZATION_ROLE` in
--     `supabase/functions/server/teamAuthorization.ts`.
--     `tests/features/membershipRoleMapping.test.ts` reads both and fails on
--     any disagreement.
--   * `public.marq_sync_team_membership` / `public.marq_revoke_team_membership`
--     — the authoritative membership write. The caller supplies a user id and a
--     TEAM role; the organization and the system role are resolved INSIDE the
--     function. No `organization_id` and no `role_id` crosses the wire, so a
--     browser cannot name a tenant or a privilege.
--   * `cortex.stamp_team_roster` / `cortex.unstamp_team_roster` — the reviewed
--     roster artifact that replaces the hand-edited UPDATE in the runbook.
--   * A role-catalog completeness assertion, so a missing role fails here
--     rather than quietly shrinking the admitted set.
--
-- PRIVILEGE
--
-- The two `public.marq_*` functions are SECURITY DEFINER and granted to
-- `service_role` alone: the edge function calls them, nothing else can. They
-- are defined that way so their authority does not depend on which table grants
-- `service_role` happens to hold in a given project.
--
-- The two `cortex.*_team_roster` functions are SECURITY **INVOKER** and granted
-- to nobody. They mutate `auth.users`, which no API key can do: `service_role`
-- is a PostgREST role, and it holds no privilege on the `auth` schema. Stamping
-- runs as a privileged database role over a direct connection — see
-- architecture/database/MEMBERSHIP_BOOTSTRAP.md. Invoker rights mean the
-- functions can never grant an authority the operator running them does not
-- already have; every guarantee they make is validation, not privilege.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. THE VOCABULARY, DECLARED ONCE IN SQL
-- ---------------------------------------------------------------------------

-- The console's team roles. Mirrors `TEAM_ROLES` in `teamAuthorization.ts`.
-- Declared as a function rather than repeated in six places, so the roster
-- validator, the mapping and the tests all read the same array.
CREATE OR REPLACE FUNCTION cortex.team_roles()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY['viewer', 'reviewer', 'analyst', 'consultant', 'admin', 'owner']::TEXT[];
$$;

COMMENT ON FUNCTION cortex.team_roles() IS
  'The console team roles, ordered by privilege. Mirrors TEAM_ROLES in supabase/functions/server/teamAuthorization.ts.';

-- THE ONE MAPPING, SQL side.
--
-- Unrecognised — `manager`, an empty string, NULL, anything the console cannot
-- issue — resolves to `team_viewer`, the least privileged key, exactly as
-- `normalizeTeamRole` resolves it to `viewer`. A data gap must never widen
-- access. No arm can produce `platform_admin`; that role is granted by a person
-- through the admin API, never by this lifecycle.
CREATE OR REPLACE FUNCTION cortex.organization_role_for_team_role(p_team_role TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE lower(trim(COALESCE(p_team_role, '')))
    WHEN 'owner'      THEN 'org_admin'
    WHEN 'admin'      THEN 'org_admin'
    WHEN 'consultant' THEN 'team_member'
    WHEN 'analyst'    THEN 'team_member'
    WHEN 'reviewer'   THEN 'team_member'
    WHEN 'viewer'     THEN 'team_viewer'
    ELSE 'team_viewer'
  END;
$$;

COMMENT ON FUNCTION cortex.organization_role_for_team_role(TEXT) IS
  'Team role -> seeded system role key. The SQL half of TEAM_ROLE_TO_ORGANIZATION_ROLE; no arm can emit platform_admin.';

-- Resolve a seeded system role by key.
--
-- `roles_scope_key_system_uidx` is unique on (scope, key) among rows with
-- organization_id IS NULL, so `key` alone is not the unique tuple. Pinning
-- scope, is_system and organization_id is what stops a future organization-
-- scoped role sharing a key from being a second, legal match.
CREATE OR REPLACE FUNCTION cortex.system_role_id(p_key TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT r.id
  FROM public.roles r
  WHERE r.key = p_key
    AND r.scope = 'platform'
    AND r.is_system = true
    AND r.organization_id IS NULL
  LIMIT 1;
$$;

-- Resolve the live MARQ organization. One definition, so no caller can decide
-- for itself what "the MARQ organization" means, and none of them can create it.
CREATE OR REPLACE FUNCTION cortex.marq_organization_id_strict()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT o.id INTO v_org_id
  FROM public.organizations o
  WHERE o.slug = 'marq' AND o.deleted_at IS NULL
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'the MARQ organization does not exist; nothing may be granted membership in a tenant that is not there'
      USING ERRCODE = 'no_data_found';
  END IF;
  RETURN v_org_id;
END $$;

REVOKE ALL ON FUNCTION cortex.team_roles() FROM PUBLIC;
REVOKE ALL ON FUNCTION cortex.organization_role_for_team_role(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION cortex.system_role_id(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION cortex.marq_organization_id_strict() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cortex.team_roles() TO service_role;
GRANT EXECUTE ON FUNCTION cortex.organization_role_for_team_role(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION cortex.system_role_id(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION cortex.marq_organization_id_strict() TO service_role;

-- ---------------------------------------------------------------------------
-- 2. MED-2 — THE ROLE CATALOG MUST BE COMPLETE, AND SAY SO WHEN IT IS NOT
--
-- Every key the mapping can emit must exist in the seeded catalog. Derived from
-- `cortex.team_roles()` and the mapping itself rather than restated, so adding
-- a team role cannot leave this check behind.
--
-- The bootstrap migration joined candidates to `public.roles` and admitted
-- whatever matched. A missing `org_admin` therefore dropped every owner and
-- admin on the floor and reported success. Here it is a hard failure, and the
-- amended bootstrap raises the same failure at its own timestamp.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_missing TEXT[];
BEGIN
  SELECT array_agg(DISTINCT k ORDER BY k) INTO v_missing
  FROM (
    SELECT cortex.organization_role_for_team_role(role) AS k
    FROM unnest(cortex.team_roles()) AS role
    UNION
    -- The ELSE arm, reached by anything the console cannot issue.
    SELECT cortex.organization_role_for_team_role('__unrecognised__')
  ) AS emitted
  WHERE cortex.system_role_id(k) IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'membership lifecycle aborted: the seeded system role catalog is missing %. Every organization role the team-role mapping can emit must exist before memberships may be written.',
      v_missing;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. LIFECYCLE PROVENANCE
--
-- Internal to `cortex`, granted to nobody, RLS on with no policies. It records
-- what the lifecycle did to whom, so "who gave this person org_admin, and when"
-- has an answer that does not depend on reading application logs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cortex.membership_lifecycle_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  operation       TEXT        NOT NULL CHECK (operation IN ('sync', 'revoke')),
  action          TEXT        NOT NULL,
  organization_id UUID        NOT NULL,
  user_id         UUID        NOT NULL,
  actor_id        UUID,
  team_role       TEXT,
  role_key        TEXT,
  membership_id   UUID
);

CREATE INDEX IF NOT EXISTS membership_lifecycle_log_user_idx
  ON cortex.membership_lifecycle_log (user_id, occurred_at DESC);

COMMENT ON TABLE cortex.membership_lifecycle_log IS
  'Provenance for every membership write made by the console lifecycle functions. Internal; no API surface returns it.';

ALTER TABLE cortex.membership_lifecycle_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cortex.membership_lifecycle_log FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4. THE AUTHORITATIVE MEMBERSHIP WRITE
-- ---------------------------------------------------------------------------

-- Create or re-role one user's MARQ membership.
--
-- The contract, in the order the checks run:
--
--   1. The user must be a live `auth.users` row. A membership for an id that is
--      not an account is a grant to nobody, and the FK would refuse it anyway
--      with a message nobody can act on.
--   2. The role is MAPPED, never taken. The caller passes a team role; this
--      function decides which organization role that is.
--   3. The organization is resolved by slug, inside. It is never created.
--   4. The system role is resolved from the seeded catalog. A missing entry is
--      an exception, not a skipped user (MED-2 again, at the row level).
--   5. The advisory lock is the one the bootstrap takes, so an invite and a
--      bootstrap cannot interleave between a guard and its insert.
--
-- STATUS IS NEVER REWRITTEN on an existing row. A `suspended` membership stays
-- suspended when somebody's role changes: suspension is a decision, and a role
-- change is not a reason to reverse it. `listVerifiedMemberships` admits only
-- `active`, so leaving it alone is the fail-closed answer.
--
-- Idempotent: syncing a role a member already holds writes nothing and reports
-- `unchanged`.
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
    RETURNING id, status INTO v_membership_id, v_status;
    v_action := 'created';
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

-- Revoke one user's MARQ membership.
--
-- Soft delete, because `deleted_at` is this schema's erasure and it keeps the
-- audit trail. Idempotent and safe on a user who never had a row: revoking
-- nothing is a success, so removing a member the bootstrap never admitted still
-- works.
--
-- Scope is the MARQ organization. Nothing in this product gives a team account
-- a membership anywhere else — `cortex.stamp_team_roster` refuses to stamp an
-- account that holds one — and a hard `auth.users` delete cascades the rest.
CREATE OR REPLACE FUNCTION public.marq_revoke_team_membership(
  p_user_id  UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_id  UUID;
  v_revoked INTEGER := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'marq_revoke_team_membership: a user id is required';
  END IF;

  v_org_id := cortex.marq_organization_id_strict();

  PERFORM pg_advisory_xact_lock(hashtext('cortex.membership_bootstrap')::BIGINT);

  UPDATE public.organization_memberships
  SET deleted_at = now()
  WHERE organization_id = v_org_id
    AND user_id = p_user_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_revoked = ROW_COUNT;

  INSERT INTO cortex.membership_lifecycle_log
    (operation, action, organization_id, user_id, actor_id)
  VALUES
    ('revoke', CASE WHEN v_revoked > 0 THEN 'revoked' ELSE 'nothing_to_revoke' END, v_org_id, p_user_id, p_actor_id);

  RETURN jsonb_build_object('organization_id', v_org_id, 'revoked', v_revoked);
END $$;

REVOKE ALL ON FUNCTION public.marq_sync_team_membership(UUID, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marq_revoke_team_membership(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marq_sync_team_membership(UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.marq_revoke_team_membership(UUID, UUID) TO service_role;

COMMENT ON FUNCTION public.marq_sync_team_membership(UUID, TEXT, UUID) IS
  'Authoritative MARQ membership write. Takes a user id and a team role; resolves the organization and the system role internally.';
COMMENT ON FUNCTION public.marq_revoke_team_membership(UUID, UUID) IS
  'Soft-deletes a user''s active MARQ membership. Idempotent.';

-- ---------------------------------------------------------------------------
-- 5. HIGH-3 — THE REVIEWED ROSTER STAMPING ARTIFACT
--
-- What it replaces: a hand-edited `UPDATE auth.users … FROM (VALUES …)` pasted
-- out of a markdown file. Whoever ran it decided, in the moment, who was staff.
-- A typo stamped a customer; a missing WHERE stamped everybody; nothing
-- recorded what had been done, so nothing could undo it.
--
-- What it is now: an explicit roster, validated in full BEFORE anything is
-- written, inside one transaction, with provenance and a reversal.
--
-- No real UUIDs live in this repository. The roster is operator-supplied, as
-- JSON, at run time — see `scripts/roster/stamp-team-roster.mjs` and
-- `supabase/operations/roster/team-roster.example.json`.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cortex.team_roster_stamp_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact              TEXT        NOT NULL,
  user_id               UUID        NOT NULL,
  team_role             TEXT        NOT NULL,
  -- What was there before, so the reversal restores rather than guesses, and
  -- what this artifact wrote, so a later hand edit is recognisable as one.
  previous_app_metadata JSONB       NOT NULL,
  stamped_app_metadata  JSONB       NOT NULL,
  stamped_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  stamped_by            TEXT        NOT NULL DEFAULT current_user,
  reverted_at           TIMESTAMPTZ
);

-- One live provenance row per (artifact, user). A re-run of the same roster
-- refreshes it rather than accumulating duplicates, which is what makes
-- "safe to rerun" true of the ledger as well as of the stamp.
CREATE UNIQUE INDEX IF NOT EXISTS team_roster_stamp_log_live_uidx
  ON cortex.team_roster_stamp_log (artifact, user_id)
  WHERE reverted_at IS NULL;

COMMENT ON TABLE cortex.team_roster_stamp_log IS
  'Provenance for every app_metadata team stamp: who, which role, which artifact, when, and the metadata before and after.';

ALTER TABLE cortex.team_roster_stamp_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cortex.team_roster_stamp_log FROM PUBLIC;

-- Stamp a reviewed roster onto `auth.users.raw_app_meta_data`.
--
-- `p_roster` is a JSON array of `{"user_id": "<uuid>", "team_role": "<role>"}`.
-- `p_expected_count` must equal its length: a roster that grew between review
-- and execution is refused rather than applied.
--
-- Every validation runs before the first write, and the whole function is one
-- statement to its caller, so a roster that fails anywhere changes nothing.
--
-- REFUSALS, each one a way the old runbook could have gone wrong:
--
--   empty roster                  — "stamp everyone" starts as "stamp nobody"
--   more than MAX_ROSTER entries  — a bulk stamp is not a reviewed roster
--   a count that does not match    — the list under review is the list applied
--   a malformed or duplicate id   — no ambiguity about who was meant
--   a role outside `team_roles()` — including anything resembling a platform
--                                   role; `platform_role` is never written
--   an id with no `auth.users` row — a stamp for nobody
--   a deleted auth user           — reviving staff status for a closed account
--   a member of another organization — that is a customer, and this artifact
--                                   exists precisely so one cannot be stamped
--                                   by accident
--
-- `p_dry_run` defaults to TRUE. Producing the plan is the default behaviour and
-- mutating is the opt-in, so an operator who forgets a flag reads what would
-- happen instead of finding out.
CREATE OR REPLACE FUNCTION cortex.stamp_team_roster(
  p_roster         JSONB,
  p_expected_count INTEGER,
  p_artifact       TEXT,
  p_dry_run        BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  MAX_ROSTER CONSTANT INTEGER := 200;
  v_count     INTEGER;
  v_bad       TEXT[];
  v_org_id    UUID;
  v_plan      JSONB;
  v_stamped   INTEGER := 0;
BEGIN
  IF p_artifact IS NULL OR trim(p_artifact) = '' THEN
    RAISE EXCEPTION 'stamp_team_roster: an artifact identifier is required so the stamp can be attributed and reversed';
  END IF;

  IF p_roster IS NULL OR jsonb_typeof(p_roster) <> 'array' THEN
    RAISE EXCEPTION 'stamp_team_roster: the roster must be a JSON array of {"user_id", "team_role"} objects';
  END IF;

  v_count := jsonb_array_length(p_roster);

  IF v_count = 0 THEN
    RAISE EXCEPTION 'stamp_team_roster: the roster is empty. Refusing to run: an empty roster is a mistake, never an instruction';
  END IF;

  IF v_count > MAX_ROSTER THEN
    RAISE EXCEPTION 'stamp_team_roster: the roster holds % entries, above the reviewed maximum of %', v_count, MAX_ROSTER;
  END IF;

  IF p_expected_count IS NULL OR p_expected_count <> v_count THEN
    RAISE EXCEPTION 'stamp_team_roster: expected % entries, the roster holds %. The list that was reviewed is the list that is applied',
      COALESCE(p_expected_count, -1), v_count;
  END IF;

  -- Shape. Everything downstream may assume a well-formed uuid and role.
  SELECT array_agg(DISTINCT entry::TEXT ORDER BY entry::TEXT) INTO v_bad
  FROM jsonb_array_elements(p_roster) AS entry
  WHERE jsonb_typeof(entry) <> 'object'
     OR entry ->> 'user_id' IS NULL
     OR entry ->> 'team_role' IS NULL
     OR entry ->> 'user_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'stamp_team_roster: % malformed roster entr(y/ies): %', array_length(v_bad, 1), v_bad;
  END IF;

  -- Role. `platform_admin`, `platform_role`, `superadmin` and every other
  -- invention land here; the mapping's ELSE arm is not a fallback the roster
  -- may lean on.
  SELECT array_agg(DISTINCT entry ->> 'team_role' ORDER BY entry ->> 'team_role') INTO v_bad
  FROM jsonb_array_elements(p_roster) AS entry
  WHERE NOT (lower(trim(entry ->> 'team_role')) = ANY (cortex.team_roles()));

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'stamp_team_roster: the roster names role(s) the console cannot issue: %. Valid roles: %',
      v_bad, cortex.team_roles();
  END IF;

  -- Duplicates. Two rows for one person is two different intentions, and
  -- picking either is guessing.
  SELECT array_agg(DISTINCT uid ORDER BY uid) INTO v_bad
  FROM (
    SELECT entry ->> 'user_id' AS uid
    FROM jsonb_array_elements(p_roster) AS entry
    GROUP BY 1
    HAVING COUNT(*) > 1
  ) AS d;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'stamp_team_roster: duplicate roster entr(y/ies) for %', v_bad;
  END IF;

  -- Every referenced id must be a live auth user.
  SELECT array_agg(DISTINCT uid ORDER BY uid) INTO v_bad
  FROM (
    SELECT entry ->> 'user_id' AS uid
    FROM jsonb_array_elements(p_roster) AS entry
  ) AS r
  WHERE NOT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = r.uid::UUID
      AND (to_jsonb(u) ->> 'deleted_at') IS NULL
  );

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'stamp_team_roster: % roster id(s) match no live auth user: %', array_length(v_bad, 1), v_bad;
  END IF;

  -- Not a customer. An account holding an active membership in any organization
  -- other than MARQ is somebody else's user, and stamping them internal staff is
  -- the accident this artifact exists to make impossible.
  v_org_id := cortex.marq_organization_id_strict();

  SELECT array_agg(DISTINCT uid ORDER BY uid) INTO v_bad
  FROM (
    SELECT entry ->> 'user_id' AS uid
    FROM jsonb_array_elements(p_roster) AS entry
  ) AS r
  WHERE EXISTS (
    SELECT 1
    FROM public.organization_memberships m
    WHERE m.user_id = r.uid::UUID
      AND m.organization_id <> v_org_id
      AND m.deleted_at IS NULL
      AND m.status = 'active'
  );

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'stamp_team_roster: % roster id(s) hold an active membership in another organization and will not be stamped as MARQ staff: %',
      array_length(v_bad, 1), v_bad;
  END IF;

  -- The plan: what each account carries now, and what it would carry. Returned
  -- in both modes, so an applied run is self-documenting too.
  SELECT jsonb_agg(
           jsonb_build_object(
             'user_id',      r.uid,
             'team_role',    r.role,
             'was_stamped',  COALESCE(u.raw_app_meta_data ->> 'marq_team', '') = 'true',
             'current_role', u.raw_app_meta_data ->> 'team_role',
             'changes',      COALESCE(u.raw_app_meta_data ->> 'team_role', '') IS DISTINCT FROM r.role
                             OR COALESCE(u.raw_app_meta_data ->> 'marq_team', '') IS DISTINCT FROM 'true'
           ) ORDER BY r.uid
         )
    INTO v_plan
  FROM (
    SELECT entry ->> 'user_id' AS uid, lower(trim(entry ->> 'team_role')) AS role
    FROM jsonb_array_elements(p_roster) AS entry
  ) AS r
  JOIN auth.users u ON u.id = r.uid::UUID;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'artifact', p_artifact,
      'dry_run',  true,
      'roster',   v_count,
      'stamped',  0,
      'plan',     v_plan
    );
  END IF;

  -- The stamp. Merged, never replaced: `platform_role` and every other key an
  -- account already carries survives, and only these two are written.
  WITH roster AS (
    SELECT (entry ->> 'user_id')::UUID AS user_id,
           lower(trim(entry ->> 'team_role')) AS team_role
    FROM jsonb_array_elements(p_roster) AS entry
  ),
  before AS (
    SELECT r.user_id, r.team_role, u.raw_app_meta_data AS previous
    FROM roster r
    JOIN auth.users u ON u.id = r.user_id
  ),
  stamped AS (
    UPDATE auth.users u
    SET raw_app_meta_data = COALESCE(u.raw_app_meta_data, '{}'::JSONB)
                            || jsonb_build_object('marq_team', true, 'team_role', b.team_role)
    FROM before b
    WHERE u.id = b.user_id
    RETURNING u.id, u.raw_app_meta_data
  )
  INSERT INTO cortex.team_roster_stamp_log
    (artifact, user_id, team_role, previous_app_metadata, stamped_app_metadata)
  SELECT p_artifact, b.user_id, b.team_role, COALESCE(b.previous, '{}'::JSONB), s.raw_app_meta_data
  FROM before b
  JOIN stamped s ON s.id = b.user_id
  ON CONFLICT (artifact, user_id) WHERE reverted_at IS NULL
    DO UPDATE SET team_role            = EXCLUDED.team_role,
                  stamped_app_metadata = EXCLUDED.stamped_app_metadata,
                  stamped_at           = now(),
                  stamped_by           = current_user;

  GET DIAGNOSTICS v_stamped = ROW_COUNT;

  -- Every roster entry must have been stamped AND recorded. A short write is a
  -- silent partial application, which is the class of failure MED-2 named.
  IF v_stamped <> v_count THEN
    RAISE EXCEPTION 'stamp_team_roster: recorded % of % roster entries; rolling back rather than applying part of a reviewed roster',
      v_stamped, v_count;
  END IF;

  RETURN jsonb_build_object(
    'artifact', p_artifact,
    'dry_run',  false,
    'roster',   v_count,
    'stamped',  v_stamped,
    'plan',     v_plan
  );
END $$;

-- Reverse a stamp, by artifact.
--
-- Reads `cortex.team_roster_stamp_log` and nothing else — the same discipline
-- as the bootstrap rollback, and for the same reason: identifying rows "by
-- description" revokes things somebody else created. An account whose
-- `app_metadata` no longer matches what this artifact wrote has been changed
-- since, and a changed account is not this function's to reset; it is reported
-- and skipped.
--
-- It removes `marq_team` and `team_role`, restoring the rest of the bag from
-- what was recorded before the stamp. It does NOT touch memberships: revoking
-- those is `public.marq_revoke_team_membership` or the bootstrap rollback, and
-- the runbook states the order.
CREATE OR REPLACE FUNCTION cortex.unstamp_team_roster(
  p_artifact TEXT,
  p_dry_run  BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_recorded INTEGER := 0;
  v_modified INTEGER := 0;
  v_reverted INTEGER := 0;
BEGIN
  IF p_artifact IS NULL OR trim(p_artifact) = '' THEN
    RAISE EXCEPTION 'unstamp_team_roster: an artifact identifier is required';
  END IF;

  SELECT COUNT(*) INTO v_recorded
  FROM cortex.team_roster_stamp_log
  WHERE artifact = p_artifact AND reverted_at IS NULL;

  IF v_recorded = 0 THEN
    RAISE EXCEPTION 'unstamp_team_roster: no live stamp recorded for artifact %. Nothing to reverse — check the identifier rather than assuming a no-op',
      p_artifact;
  END IF;

  SELECT COUNT(*) INTO v_modified
  FROM cortex.team_roster_stamp_log l
  JOIN auth.users u ON u.id = l.user_id
  WHERE l.artifact = p_artifact
    AND l.reverted_at IS NULL
    AND u.raw_app_meta_data IS DISTINCT FROM l.stamped_app_metadata;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'artifact', p_artifact,
      'dry_run',  true,
      'recorded', v_recorded,
      'modified_since_stamp', v_modified,
      'would_revert', v_recorded - v_modified
    );
  END IF;

  WITH reverted AS (
    UPDATE auth.users u
    SET raw_app_meta_data = (COALESCE(l.previous_app_metadata, '{}'::JSONB) - 'marq_team' - 'team_role')
                            || (CASE
                                  WHEN l.previous_app_metadata ? 'marq_team'
                                  THEN jsonb_build_object('marq_team', l.previous_app_metadata -> 'marq_team')
                                  ELSE '{}'::JSONB
                                END)
                            || (CASE
                                  WHEN l.previous_app_metadata ? 'team_role'
                                  THEN jsonb_build_object('team_role', l.previous_app_metadata -> 'team_role')
                                  ELSE '{}'::JSONB
                                END)
    FROM cortex.team_roster_stamp_log l
    WHERE u.id = l.user_id
      AND l.artifact = p_artifact
      AND l.reverted_at IS NULL
      -- Untouched since the stamp. Anything else belongs to whoever changed it.
      AND u.raw_app_meta_data IS NOT DISTINCT FROM l.stamped_app_metadata
    RETURNING l.id
  )
  UPDATE cortex.team_roster_stamp_log l
  SET reverted_at = now()
  FROM reverted
  WHERE l.id = reverted.id;

  GET DIAGNOSTICS v_reverted = ROW_COUNT;

  RETURN jsonb_build_object(
    'artifact', p_artifact,
    'dry_run',  false,
    'recorded', v_recorded,
    'reverted', v_reverted,
    'modified_since_stamp', v_modified
  );
END $$;

-- Granted to NOBODY. These mutate `auth.users`; an API key must never reach
-- them. Invoker rights, so they carry no privilege of their own.
REVOKE ALL ON FUNCTION cortex.stamp_team_roster(JSONB, INTEGER, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION cortex.unstamp_team_roster(TEXT, BOOLEAN) FROM PUBLIC;

COMMENT ON FUNCTION cortex.stamp_team_roster(JSONB, INTEGER, TEXT, BOOLEAN) IS
  'Validates and applies a reviewed internal-staff roster to auth.users app_metadata. Dry-run by default; refuses empty, oversized, duplicate, unknown, mis-roled and cross-organization entries.';
COMMENT ON FUNCTION cortex.unstamp_team_roster(TEXT, BOOLEAN) IS
  'Reverses one stamping artifact using its provenance ledger, skipping accounts changed since.';

COMMIT;
