-- ============================================================================
-- AI-01 Batch 4A — MARQ team membership bootstrap
-- Depends on: 20260711050000_cortex_tenancy_foundation.sql
--             20260711050001_cortex_tenancy_rls_and_seed.sql
-- Rollback:   supabase/migrations/rollbacks/20260818120000_rollback_membership_bootstrap.sql
--
-- WHY THIS EXISTS
--
-- The tenancy seed creates the MARQ organization, the system role catalog and
-- the permission mappings, and then deliberately stops: it creates no user
-- memberships, because a migration must not invent `auth.users` ids. The
-- documented consequence was a manual procedure
-- (architecture/database/MEMBERSHIP_BOOTSTRAP.md) that production never ran —
-- `public.organization_memberships` holds zero active rows, so every operator
-- authenticates successfully, resolves NO verified organization, and the AI
-- guard fails the request closed at `resolveOrganization`.
--
-- Failing closed is correct. Having nobody to admit is not. This migration
-- closes the gap the only way that keeps both properties: it derives REAL user
-- ids from `auth.users`, and it admits only accounts the SERVER has marked as
-- MARQ team accounts.
--
-- WHERE ELIGIBILITY COMES FROM, AND WHY IT IS NOT `user_metadata`
--
-- The first version of this migration read `raw_user_meta_data ->> 'role'` and
-- `raw_user_meta_data ->> 'teamRole'`, on the stated grounds that user metadata
-- "is writable only through the service-role admin API". That is false. GoTrue
-- serves `PUT /auth/v1/user`, and any signed-in account holding nothing beyond
-- its own access token and the public anon key may rewrite its own
-- `raw_user_meta_data`. Under the old predicate, a `viewer` — or anyone who
-- could obtain any account at all — could set
-- `{"role":"team","teamRole":"owner"}` on themselves and be granted an
-- `org_admin` membership in the MARQ organization by this migration. The
-- bootstrap would have been a self-service privilege escalation with a
-- migration timestamp on it.
--
-- `raw_app_meta_data` is the bag GoTrue refuses to write for a user-scoped
-- call: only the service role sets it. The platform already trusts it —
-- `cortex.is_platform_admin()` reads `app_metadata ->> 'platform_role'` — so
-- this is the strongest authority that already exists here, not a new one.
--
-- Eligibility is therefore `raw_app_meta_data ->> 'marq_team' = 'true'`, and
-- the role comes from `raw_app_meta_data ->> 'team_role'`. `raw_user_meta_data`
-- is not read anywhere in this file, for eligibility or for privilege.
--
-- THE CONSEQUENCE, STATED PLAINLY: on a database whose accounts predate the
-- provisioning routes that write app metadata, this migration admits NOBODY and
-- says so. That is the correct outcome, not a regression — deciding who is
-- internal MARQ staff from a field the account holder controls was never a
-- decision this migration was entitled to make. The one-time stamping step for
-- existing accounts is an explicit, reviewed operator action, documented in
-- architecture/database/MEMBERSHIP_BOOTSTRAP.md. Accounts created or re-roled
-- through the console after this ships carry the assertion already.
--
-- WHAT IT WILL NOT DO
--
--   * It creates no organization. If the MARQ organization is absent the
--     migration is a no-op and says so — a bootstrap that conjures a tenant is
--     a default tenant by another name.
--   * It creates no `auth.users` row, and never writes to the auth schema.
--   * It never assigns `platform_admin`. That role is granted by a person,
--     through the admin API, with ops approval — not by a backfill.
--   * It never revives, re-activates or overwrites an existing membership. The
--     guard is "no membership row exists AT ALL for this (organization, user)",
--     so an `invited`, `suspended` or SOFT-DELETED row all mean the same thing
--     here: somebody already made a decision about this person, and it is not
--     this migration's to reverse. A removed member does not silently regain
--     access by being re-admitted alongside their tombstone.
--
-- IDEMPOTENCY AND CONCURRENCY
--
-- A transaction-scoped advisory lock serialises concurrent runs, and the INSERT
-- carries `ON CONFLICT ... DO NOTHING` inferred on the partial unique index
-- `organization_memberships_active_uidx`. Two sessions racing — this migration
-- against itself, or against a console invite creating the same membership —
-- produce one row and no error, and the loser inserts no ledger entry because
-- it returned none.
--
-- SHORT ADMISSION IS A FAILURE, NOT A SMALLER SUCCESS (MED-2)
--
-- The INSERT below joins each candidate to `public.roles` on the mapped key. A
-- key missing from the seeded catalog therefore removed its candidates from the
-- INSERT silently: every `owner` and `admin` on the floor if `org_admin` were
-- absent, `NOTICE: 0 membership(s) created`, exit code 0, and an operator with
-- no reason to look. Admitting FEWER people than the roster is not a safe
-- failure — it is the same broken state (`ORGANIZATION_REQUIRED` for real
-- staff) that this migration exists to end, arriving quietly.
--
-- So the catalog is checked before the write, and after the write every
-- candidate must be accounted for: either it now holds a membership row, or it
-- already held one and was deliberately left alone. Anything else raises, and
-- the transaction takes the ledger and the rows with it.
--
-- PROVENANCE
--
-- Every row this migration creates is recorded in
-- `cortex.membership_bootstrap_log`, with the role, status and `updated_at` it
-- was created with. That table is the ONLY thing the rollback consults. The
-- previous rollback identified its own rows by `updated_at = created_at`, which
-- is not provenance: it is true of every membership nobody has edited yet,
-- whoever created it, so the rollback would have revoked access an
-- administrator granted five minutes earlier. See the rollback file.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Serialise the whole migration, DDL included.
--
-- The lock is taken BEFORE the ledger is created, not inside the DO block
-- below, and that ordering is a bug fix rather than a preference. With the lock
-- taken later, two concurrent runs both evaluated `CREATE TABLE IF NOT EXISTS`
-- against a snapshot in which the table did not exist, and the losers died on
-- `pg_type_typname_nsp_index` — a unique violation on the system catalog, from
-- a statement whose whole purpose is to be safe to repeat. `IF NOT EXISTS` is
-- not atomic against a concurrent creator.
--
-- Transaction-scoped, so it is released by COMMIT or by any failure; there is
-- no path that leaves it held.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('cortex.membership_bootstrap')::BIGINT);
END $$;

-- ---------------------------------------------------------------------------
-- Provenance ledger
--
-- Internal, in the `cortex` schema rather than `public`: nothing in the product
-- reads it, no API surface should return it, and the tenancy model gains no
-- column. It records what this migration did so the rollback can undo exactly
-- that and nothing else.
--
-- `cortex` is exposed to PostgREST (supabase/config.toml), so the table is
-- granted to nobody and RLS is enabled with no policies. The migration runs as
-- the table owner, which is why RLS is not FORCEd — forcing it with no policy
-- would lock out the writer below as well as every reader.
--
-- It needs no teardown of its own: the tenancy rollback ends with
-- `DROP SCHEMA IF EXISTS cortex CASCADE`, which takes this with it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cortex.membership_bootstrap_log (
  membership_id   UUID PRIMARY KEY
                  REFERENCES public.organization_memberships(id) ON DELETE CASCADE,
  migration       TEXT        NOT NULL,
  organization_id UUID        NOT NULL,
  user_id         UUID        NOT NULL,
  -- The state as written. The rollback compares against these, so a row an
  -- administrator has since re-roled, suspended or removed is recognisable as
  -- modified without guessing from timestamps.
  role_id         UUID        NOT NULL,
  status          TEXT        NOT NULL,
  row_updated_at  TIMESTAMPTZ NOT NULL,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  rolled_back_at  TIMESTAMPTZ
);

COMMENT ON TABLE cortex.membership_bootstrap_log IS
  'Provenance for memberships created by the membership bootstrap migration. Read only by the matching rollback.';

ALTER TABLE cortex.membership_bootstrap_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cortex.membership_bootstrap_log FROM PUBLIC;

DO $$
DECLARE
  v_org_id       UUID;
  v_eligible     INTEGER := 0;
  v_blocked      INTEGER := 0;
  v_inserted     INTEGER := 0;
  v_duplicates   INTEGER := 0;
  v_unaccounted  INTEGER := 0;
  v_missing_roles TEXT[];
  v_unadmitted   TEXT[];
BEGIN
  -- The advisory lock taken above is still held: it is transaction-scoped and
  -- this is the same transaction. Another copy of this migration, or a console
  -- invite racing it, waits there rather than interleaving with the guard below.

  SELECT id INTO v_org_id
  FROM public.organizations
  WHERE slug = 'marq' AND deleted_at IS NULL
  LIMIT 1;

  IF v_org_id IS NULL THEN
    -- No organization, no bootstrap. Creating one here would manufacture the
    -- fallback tenant this whole design refuses to have.
    RAISE NOTICE 'membership bootstrap skipped: no active organization with slug = marq';
    RETURN;
  END IF;

  -- Eligibility and role, both from `raw_app_meta_data` — see the header. No
  -- statement in this file reads `raw_user_meta_data`.
  --
  -- `deleted_at` and `banned_until` are read through `to_jsonb(u)` rather than
  -- as columns on purpose: they are GoTrue-managed and their presence varies
  -- with the Supabase platform version. A missing key yields NULL, which reads
  -- as "not deleted" / "not banned" — the same answer the column would give on
  -- a healthy account — so the migration cannot fail on a schema it does not
  -- own.
  CREATE TEMP TABLE _marq_membership_candidates ON COMMIT DROP AS
  SELECT
    u.id AS user_id,
    CASE lower(trim(COALESCE(u.raw_app_meta_data ->> 'team_role', '')))
      -- THE ONE MAPPING. Mirrors `TEAM_ROLE_TO_ORGANIZATION_ROLE` in
      -- supabase/functions/server/teamAuthorization.ts, which is the
      -- definition; tests/features/membershipRoleMapping.test.ts imports that
      -- map, reads this CASE, and fails if either grows an arm the other does
      -- not have.
      --
      -- `manager` is deliberately absent. It is not a member of `TEAM_ROLES`,
      -- so `normalizeTeamRole` resolves it to `viewer` — while the previous
      -- version of this CASE, and `LEGACY_TEAM_ROLE_MAP`, sent it to
      -- `org_admin`. One table said read-only and the other said organization
      -- administrator. It now falls to the ELSE below, with everything else the
      -- console cannot issue.
      WHEN 'owner'      THEN 'org_admin'
      WHEN 'admin'      THEN 'org_admin'
      WHEN 'consultant' THEN 'team_member'
      WHEN 'analyst'    THEN 'team_member'
      WHEN 'reviewer'   THEN 'team_member'
      WHEN 'viewer'     THEN 'team_viewer'
      -- Missing or unrecognised resolves to the LEAST privileged role, the
      -- same way `normalizeTeamRole` does. A data gap must never widen access.
      ELSE 'team_viewer'
    END AS role_key
  FROM auth.users u
  WHERE (u.raw_app_meta_data ->> 'marq_team') = 'true'
    AND (to_jsonb(u) ->> 'deleted_at') IS NULL
    AND (
      (to_jsonb(u) ->> 'banned_until') IS NULL
      OR (to_jsonb(u) ->> 'banned_until')::timestamptz <= now()
    );

  SELECT COUNT(*) INTO v_eligible FROM _marq_membership_candidates;

  -- MED-2, before the write: every organization role key this migration can
  -- emit must exist in the seeded system catalog. The full range is checked,
  -- not only the keys today's candidates happen to need, because a catalog gap
  -- is a latent defect whether or not a candidate has walked into it yet.
  SELECT array_agg(DISTINCT k ORDER BY k) INTO v_missing_roles
  FROM (
    SELECT unnest(ARRAY['org_admin', 'team_member', 'team_viewer']) AS k
    UNION
    SELECT c.role_key FROM _marq_membership_candidates c
  ) AS emitted
  WHERE NOT EXISTS (
    SELECT 1 FROM public.roles r
    WHERE r.key = emitted.k
      AND r.scope = 'platform'
      AND r.is_system = true
      AND r.organization_id IS NULL
  );

  IF v_missing_roles IS NOT NULL THEN
    RAISE EXCEPTION
      'membership bootstrap aborted: the seeded system role catalog is missing %. Admitting the users that happen to map to the roles that ARE present would silently leave the rest without organization authority.',
      v_missing_roles;
  END IF;

  -- Reported, not acted on: eligible users this migration will not touch
  -- because a membership decision already exists for them — active, invited,
  -- suspended or deleted.
  SELECT COUNT(*) INTO v_blocked
  FROM _marq_membership_candidates c
  WHERE EXISTS (
    SELECT 1
    FROM public.organization_memberships m
    WHERE m.organization_id = v_org_id
      AND m.user_id = c.user_id
  );

  WITH created AS (
    INSERT INTO public.organization_memberships (
      organization_id,
      user_id,
      role_id,
      status,
      joined_at
    )
    SELECT
      v_org_id,
      c.user_id,
      r.id,
      'active',
      now()
    FROM _marq_membership_candidates c
    JOIN public.roles r
      ON r.key = c.role_key
     -- `roles_scope_key_system_uidx` is UNIQUE on (scope, key) among rows with
     -- organization_id IS NULL — so (scope, key) is the unique tuple, and `key`
     -- alone is not. Every role in the seeded catalog is scope = 'platform';
     -- without pinning the scope, a future system role added at scope =
     -- 'organization' under the same key would be a legal second match and this
     -- JOIN would emit two INSERT rows for one user.
     AND r.scope = 'platform'
     AND r.is_system = true
     AND r.organization_id IS NULL
    -- ANY existing row blocks, deleted ones included. See the header.
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.organization_memberships m
      WHERE m.organization_id = v_org_id
        AND m.user_id = c.user_id
    )
    -- Inferred on `organization_memberships_active_uidx`. A membership created
    -- by a concurrent session between the NOT EXISTS above and this write is a
    -- lost race, not an error, and DO NOTHING keeps the other session's row —
    -- never overwriting it, never changing its role.
    ON CONFLICT (organization_id, user_id) WHERE deleted_at IS NULL DO NOTHING
    RETURNING id, organization_id, user_id, role_id, status, updated_at
  )
  INSERT INTO cortex.membership_bootstrap_log (
    membership_id, migration, organization_id, user_id, role_id, status, row_updated_at
  )
  SELECT
    created.id,
    '20260818120000_marq_team_membership_bootstrap',
    created.organization_id,
    created.user_id,
    created.role_id,
    created.status,
    created.updated_at
  FROM created
  ON CONFLICT (membership_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- MED-2, after the write: EVERY eligible candidate must now be accounted
  -- for. "Accounted for" is a row in `organization_memberships` for this
  -- (organization, user) — the one this run created, or the pre-existing one
  -- that deliberately blocked it. A candidate with no row at all was dropped by
  -- the JOIN, and being dropped by a JOIN is exactly the silent short admission
  -- this assertion exists to refuse.
  --
  -- Stated over rows rather than over counters on purpose: a counter identity
  -- (`eligible = blocked + inserted`) would misfire under the concurrency this
  -- migration explicitly supports, where a membership created by another
  -- session lands between the guard and the write. A row that exists is a row
  -- that exists, whoever wrote it.
  SELECT COUNT(*), array_agg(c.user_id::TEXT || ' -> ' || c.role_key ORDER BY c.user_id::TEXT)
    INTO v_unaccounted, v_unadmitted
  FROM _marq_membership_candidates c
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.organization_memberships m
    WHERE m.organization_id = v_org_id
      AND m.user_id = c.user_id
  );

  IF v_unaccounted > 0 THEN
    RAISE EXCEPTION
      'membership bootstrap aborted: % eligible team user(s) were neither admitted nor already decided: %. Nothing has been committed.',
      v_unaccounted, v_unadmitted;
  END IF;

  -- Post-condition, asserted rather than assumed: the bootstrap must never be
  -- the reason a user holds two live memberships in one organization.
  SELECT COUNT(*) INTO v_duplicates
  FROM (
    SELECT m.user_id
    FROM public.organization_memberships m
    WHERE m.organization_id = v_org_id
      AND m.deleted_at IS NULL
    GROUP BY m.user_id
    HAVING COUNT(*) > 1
  ) AS d;

  IF v_duplicates > 0 THEN
    RAISE EXCEPTION 'membership bootstrap aborted: % user(s) hold duplicate active memberships', v_duplicates;
  END IF;

  IF v_eligible = 0 THEN
    RAISE NOTICE 'membership bootstrap: no auth user carries app_metadata.marq_team = true, so none was admitted. See architecture/database/MEMBERSHIP_BOOTSTRAP.md for the one-time stamping step.';
  END IF;

  RAISE NOTICE 'membership bootstrap: % eligible team user(s), % already decided, % membership(s) created',
    v_eligible, v_blocked, v_inserted;
END $$;

COMMIT;
