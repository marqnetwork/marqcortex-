-- ============================================================================
-- CP-3 — ORGANIZATIONAL SPINE
-- ============================================================================
--
-- The minimum canonical organizational model the rest of Cortex depends on.
--
-- ── WHAT THE CANON SAYS, AND WHY THESE TABLES ──────────────────────────────
--
-- Ontology Ch. 11 defines the hierarchy exactly:
--
--     Organization → Business Unit → Department → Team → Role → Member
--
--   11.2 Business Unit — a major operational division (Marketing, Engineering)
--   11.3 Department    — a FUNCTIONAL entity within a Business Unit OR directly
--                        within the Organization. The canon does not define a
--                        separate "Function" entity, so none is invented here.
--   11.4 Team          — the execution layer.
--   11.5 Workspace     — a logical operational environment that DOES NOT alter
--                        the hierarchy. It is therefore not a table in this
--                        migration; CP-3 treats "workspace" as the operator's
--                        current organization context, which is what the shell
--                        needs, and leaves the richer concept to the sprint
--                        that has a use for it.
--
-- Ch. 12 settles the people question, and settles it against the obvious
-- assumption:
--
--   12.1 Human    — the real person. Exists independently of Cortex.
--   12.2 Identity — the canonical digital representation of a Human.
--   12.3 User     — "an Identity that has been granted permission to interact
--                   with one or more Cortex capabilities. NOT EVERY IDENTITY IS
--                   NECESSARILY AN ACTIVE USER."
--   12.4 Profile  — the descriptive representation of an Identity.
--   12.5 Membership — where an Identity belongs, NOT what it may do.
--
-- So `people` is the Identity-and-Profile record, and `people.user_id` is
-- NULLABLE. An organization contains colleagues who have never signed in — a
-- contractor, someone onboarding next month, a person whose access was
-- revoked while their reporting line stayed real. Requiring an `auth.users`
-- row for every organizational person would have modelled the authentication
-- system instead of the organization, and made those people unrepresentable.
--
-- `organization_memberships` (2026-07-11) is the Identity↔Organization
-- membership and IS keyed on `auth.users`, because it is what grants console
-- access. It is untouched here. A person with a login has both records, joined
-- by `people.user_id`; a person without one has only the first.
--
-- ── OWNERSHIP (11.8) ────────────────────────────────────────────────────────
--
-- "Ownership defines the formal accountability of an organizational entity for
-- another entity, resource, process, capability, or decision."
--
-- Within the spine that is `lead_person_id` on departments and teams, and
-- `reports_to_person_id` on people (11.10, reporting lines).
--
-- For the entities CP-4/5/6 will add — a Goal, a Decision, a Risk, an Agent's
-- human sponsor, an Approval's responsible human — the pattern is a nullable
-- `owner_person_id UUID REFERENCES public.people(id)` alongside the tenant's
-- `organization_id`, with the same cross-tenant guard used here. No polymorphic
-- ownership table is created: it would be a speculative join for entities that
-- do not exist, and a table RLS cannot constrain without knowing what it points
-- at.
--
-- ── TENANCY ─────────────────────────────────────────────────────────────────
--
-- Every table here is tenant-owned and follows the 2026-07-11 foundation
-- exactly: `organization_id` NOT NULL, RLS on, reads gated by
-- `cortex.is_organization_member`, writes by `cortex.has_permission`, soft
-- deletion, and an `updated_at` trigger.
--
-- The cross-tenant guards are the part worth reading twice. A foreign key to
-- another row in the same table family constrains WHICH ROW, not WHICH TENANT —
-- so `department.business_unit_id` could otherwise point at another
-- organization's business unit and quietly build a structure spanning two
-- tenants that no RLS SELECT policy would reveal, because each half is
-- individually visible to its own tenant. Composite foreign keys close it: the
-- referenced row must carry the SAME organization_id, enforced by the database
-- rather than by every writer remembering to check.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Composite uniqueness the cross-tenant foreign keys need
-- ---------------------------------------------------------------------------
-- A composite FK requires a matching unique constraint on the parent. `id` is
-- already the primary key, so `(id, organization_id)` is trivially unique —
-- declaring it is what lets a child say "the same organization, or nothing".
ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_id_self_uk;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_id_self_uk UNIQUE (id);

-- ---------------------------------------------------------------------------
-- 1. business_units — ONT 11.2
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_units (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key             TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  CONSTRAINT business_units_key_normalized CHECK (key = lower(trim(key))),
  CONSTRAINT business_units_name_present CHECK (length(trim(name)) > 0),
  CONSTRAINT business_units_id_org_uk UNIQUE (id, organization_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS business_units_org_key_uidx
  ON public.business_units (organization_id, key)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS business_units_set_updated_at ON public.business_units;
CREATE TRIGGER business_units_set_updated_at
  BEFORE UPDATE ON public.business_units
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

COMMENT ON TABLE public.business_units IS
  'ONT 11.2 — a major operational division within an organization.';

-- ---------------------------------------------------------------------------
-- 2. departments — ONT 11.3
-- ---------------------------------------------------------------------------
-- "within a Business Unit OR Organization" — so business_unit_id is nullable,
-- and a small organization can have departments without divisions at all.
CREATE TABLE IF NOT EXISTS public.departments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  business_unit_id UUID,
  key              TEXT NOT NULL,
  name             TEXT NOT NULL,
  description      TEXT,
  lead_person_id   UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ,
  CONSTRAINT departments_key_normalized CHECK (key = lower(trim(key))),
  CONSTRAINT departments_name_present CHECK (length(trim(name)) > 0),
  CONSTRAINT departments_id_org_uk UNIQUE (id, organization_id),
  -- THE CROSS-TENANT GUARD. A plain `REFERENCES business_units(id)` would
  -- accept another organization's division.
  CONSTRAINT departments_business_unit_same_org
    FOREIGN KEY (business_unit_id, organization_id)
    REFERENCES public.business_units (id, organization_id)
    ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS departments_org_key_uidx
  ON public.departments (organization_id, key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS departments_business_unit_idx
  ON public.departments (business_unit_id)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS departments_set_updated_at ON public.departments;
CREATE TRIGGER departments_set_updated_at
  BEFORE UPDATE ON public.departments
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

COMMENT ON TABLE public.departments IS
  'ONT 11.3 — a functional entity within a business unit or directly within the organization.';

-- ---------------------------------------------------------------------------
-- 3. people — ONT 12.1 Human / 12.2 Identity / 12.4 Profile
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.people (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- ONT 12.3: "Not every Identity is necessarily an active User." NULL means a
  -- colleague who does not sign in — and their reporting line, department and
  -- ownership are all still real.
  user_id              UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Profile (12.4). `email` is the organization's record of how to reach them,
  -- not an authentication credential; a person may have one without a login.
  full_name            TEXT NOT NULL,
  email                TEXT,
  position_title       TEXT,

  -- Where they belong (12.5 Membership, structural half).
  department_id        UUID,
  reports_to_person_id UUID,

  status               TEXT NOT NULL DEFAULT 'active'
                       CONSTRAINT people_status_check
                       CHECK (status IN ('active', 'invited', 'inactive')),

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ,

  CONSTRAINT people_full_name_present CHECK (length(trim(full_name)) > 0),
  CONSTRAINT people_email_normalized CHECK (email IS NULL OR email = lower(trim(email))),
  CONSTRAINT people_id_org_uk UNIQUE (id, organization_id),

  CONSTRAINT people_department_same_org
    FOREIGN KEY (department_id, organization_id)
    REFERENCES public.departments (id, organization_id)
    ON DELETE SET NULL,

  -- A reporting line may not cross a tenant boundary, and nobody reports to
  -- themselves. The self-reference is not pedantry: a one-row cycle is the
  -- easiest to create by accident and the hardest to see in a tree view.
  CONSTRAINT people_reports_to_same_org
    FOREIGN KEY (reports_to_person_id, organization_id)
    REFERENCES public.people (id, organization_id)
    ON DELETE SET NULL,
  CONSTRAINT people_no_self_report CHECK (reports_to_person_id IS DISTINCT FROM id)
);

-- One person per auth user per organization. A second row for the same login
-- would give one human two reporting lines and two departments.
CREATE UNIQUE INDEX IF NOT EXISTS people_org_user_uidx
  ON public.people (organization_id, user_id)
  WHERE deleted_at IS NULL AND user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS people_org_email_uidx
  ON public.people (organization_id, email)
  WHERE deleted_at IS NULL AND email IS NOT NULL;

CREATE INDEX IF NOT EXISTS people_org_idx
  ON public.people (organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS people_department_idx
  ON public.people (department_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS people_reports_to_idx
  ON public.people (reports_to_person_id)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS people_set_updated_at ON public.people;
CREATE TRIGGER people_set_updated_at
  BEFORE UPDATE ON public.people
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

COMMENT ON TABLE public.people IS
  'ONT 12.1/12.2/12.4 — the organization''s record of a Human. user_id is NULL for a person who does not sign in (12.3).';

COMMENT ON COLUMN public.people.user_id IS
  'The auth.users row when this person is also a User (ONT 12.3). NULL is legitimate and expected.';

-- The department lead is a person, in the same organization. Declared after
-- `people` because the two tables reference each other.
ALTER TABLE public.departments
  DROP CONSTRAINT IF EXISTS departments_lead_same_org;
ALTER TABLE public.departments
  ADD CONSTRAINT departments_lead_same_org
  FOREIGN KEY (lead_person_id, organization_id)
  REFERENCES public.people (id, organization_id)
  ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 4. teams — ONT 11.4
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teams (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id   UUID,
  key             TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  lead_person_id  UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  CONSTRAINT teams_key_normalized CHECK (key = lower(trim(key))),
  CONSTRAINT teams_name_present CHECK (length(trim(name)) > 0),
  CONSTRAINT teams_id_org_uk UNIQUE (id, organization_id),
  CONSTRAINT teams_department_same_org
    FOREIGN KEY (department_id, organization_id)
    REFERENCES public.departments (id, organization_id)
    ON DELETE SET NULL,
  CONSTRAINT teams_lead_same_org
    FOREIGN KEY (lead_person_id, organization_id)
    REFERENCES public.people (id, organization_id)
    ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS teams_org_key_uidx
  ON public.teams (organization_id, key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS teams_department_idx
  ON public.teams (department_id)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS teams_set_updated_at ON public.teams;
CREATE TRIGGER teams_set_updated_at
  BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

COMMENT ON TABLE public.teams IS
  'ONT 11.4 — the execution layer. Belongs to a department, or directly to the organization.';

-- ---------------------------------------------------------------------------
-- 5. team_memberships — ONT 12.5, the Identity↔Team half
-- ---------------------------------------------------------------------------
-- A person may be on several teams; the canon's Membership is a relationship,
-- not an attribute, so it is a table rather than a column on `people`.
CREATE TABLE IF NOT EXISTS public.team_memberships (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_id         UUID NOT NULL,
  person_id       UUID NOT NULL,
  -- ONT 11.4 "Defined leadership". The team's own `lead_person_id` is the
  -- accountable one; this marks membership-level responsibility.
  is_lead         BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,

  -- BOTH sides pinned to the row's own organization. This is the constraint
  -- that makes "Org A assigns an Org B person to an Org A team" impossible in
  -- the database rather than merely discouraged in a route handler.
  CONSTRAINT team_memberships_team_same_org
    FOREIGN KEY (team_id, organization_id)
    REFERENCES public.teams (id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT team_memberships_person_same_org
    FOREIGN KEY (person_id, organization_id)
    REFERENCES public.people (id, organization_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS team_memberships_active_uidx
  ON public.team_memberships (team_id, person_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS team_memberships_person_idx
  ON public.team_memberships (person_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS team_memberships_org_idx
  ON public.team_memberships (organization_id)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS team_memberships_set_updated_at ON public.team_memberships;
CREATE TRIGGER team_memberships_set_updated_at
  BEFORE UPDATE ON public.team_memberships
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

COMMENT ON TABLE public.team_memberships IS
  'ONT 12.5 — where an Identity belongs. Both team and person are pinned to this row''s organization.';

COMMIT;
