-- ============================================================================
-- CP-4 — STRATEGIC LAYER: GOALS, DECISIONS, RISKS
--
-- What the organization is trying to achieve, what it has decided, and what
-- threatens it. Three tables, and every one of them owned by somebody in the
-- organizational spine — which is why CP-4 opened the spine's write surface
-- first. A goal whose owner cannot be created is a record pointing at nobody.
--
-- ── THE CANON DECIDED THE SHAPES ───────────────────────────────────────────
--
-- ONT 13.4  Goal      "a measurable target established to support the
--                      achievement of an Objective"
--                      Measurable · time-bound WHERE APPLICABLE · governed ·
--                      trackable · outcome-oriented
--
-- ONT 14.8  Decision  "a governed selection among one or more alternatives
--                      based on available knowledge, evidence, objectives,
--                      constraints, and context"
--                      Governed · traceable · contextual · JUSTIFIED · reviewable
--
-- ONT 17.6  Risk      "the possibility that uncertainty, events, decisions, or
--                      conditions may negatively affect organizational
--                      objectives..."
--                      "evaluated according to likelihood, impact, and
--                      organizational tolerance"
--
-- ONT 13.13 gives the status vocabulary — Planned, Ready, In Progress, On Hold,
-- Under Review, Completed, Cancelled, Archived — and it is used rather than
-- invented, narrowed per entity to the states that entity can actually be in.
--
-- ── WHAT IS DELIBERATELY ABSENT ────────────────────────────────────────────
--
-- OBJECTIVE AND INITIATIVE (ONT 13.3, 13.1). ONT 13.4 defines a Goal in terms
-- of an Objective, and Cortex has neither. Shipping the full
-- Initiative -> Objective -> Goal chain is more than this sprint; shipping Goal
-- while IMPLYING the chain would be worse. `goals.objective_id` does not exist,
-- so nothing suggests a parent that is not there, and adding one later is an
-- additive migration rather than a reinterpretation of existing rows.
--
-- OPPORTUNITY. It has no ontology chapter, while being a first-class peer of
-- Risk in the Product Experience canon and appearing in the Master Blueprint's
-- engagement chain. Three readings are open — the inverse of Risk, a commercial
-- pipeline entity, or two concepts sharing one word — and choosing one here
-- would settle a canon question with a migration. It is not in this file.
--
-- VALUE (ONT 18.11). "May differ across stakeholders" — so the row shape turns
-- on whether value is recorded per stakeholder or per outcome, and that is a
-- modelling decision the canon poses rather than answers. Deferred.
--
-- ── LIKELIHOOD AND IMPACT ──────────────────────────────────────────────────
--
-- ONT 17.6 says a Risk is evaluated by likelihood, impact and tolerance, and
-- defines NO SCALE for any of them. A three-level ordinal is used because it is
-- the smallest thing that can be sorted and compared, and because inventing a
-- 1-5 matrix or a probability percentage would be inventing canon. Recorded as
-- text with a CHECK rather than as an enum type: an enum is a schema change to
-- extend, and this is a vocabulary the ontology may later fix properly.
--
-- Apply: staging/local only until explicitly approved for production.
-- Rollback: supabase/migrations/rollbacks/20260918120000_rollback_strategic_layer.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. goals — ONT 13.4
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.goals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- What the goal IS. "Acquire 500 customers".
  statement        TEXT NOT NULL,

  -- HOW it is measured, and the target. ONT 13.4's first characteristic is
  -- "measurable", and a goal with no measure is an intention.
  --
  -- Both TEXT, and deliberately: the canon's own examples are "500 customers",
  -- "under two minutes" and "95%" — three different units, one of them inverted.
  -- A numeric column would force a unit-and-direction model the ontology does
  -- not define, and every goal that did not fit would be written into the
  -- statement instead, which is worse than free text that admits what it is.
  measure          TEXT,
  target_value     TEXT,
  current_value    TEXT,

  -- "Time-bound WHERE APPLICABLE" — so nullable, and not defaulted.
  due_on           DATE,

  -- ONT 13.13, narrowed. A goal is not "Ready" separately from "Planned".
  status           TEXT NOT NULL DEFAULT 'planned'
                   CONSTRAINT goals_status_check
                   CHECK (status IN ('planned', 'in_progress', 'on_hold',
                                     'under_review', 'completed', 'cancelled')),

  -- Owned by a PERSON in the spine, not by an auth user. A goal can be owned by
  -- somebody with no console login — see ONT 12.3 and the CP-3 record.
  owner_person_id  UUID,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ,

  CONSTRAINT goals_statement_present CHECK (length(trim(statement)) > 0),
  CONSTRAINT goals_id_org_uk UNIQUE (id, organization_id),

  -- THE TENANCY GUARD. The composite reference is what makes a goal owned by
  -- another tenant's person UNREPRESENTABLE rather than merely rejected.
  CONSTRAINT goals_owner_same_org
    FOREIGN KEY (owner_person_id, organization_id)
    REFERENCES public.people (id, organization_id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS goals_org_idx
  ON public.goals (organization_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS goals_owner_idx
  ON public.goals (owner_person_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS goals_set_updated_at ON public.goals;
CREATE TRIGGER goals_set_updated_at
  BEFORE UPDATE ON public.goals
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

COMMENT ON TABLE public.goals IS
  'ONT 13.4 Goal — a measurable target, owned by a person in the organizational spine.';

-- ---------------------------------------------------------------------------
-- 2. decisions — ONT 14.8
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.decisions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  statement          TEXT NOT NULL,

  -- ONT 14.8's definition is "a selection among one or more ALTERNATIVES", and
  -- its characteristics include JUSTIFIED. These two columns are what make a
  -- decision record different from a note: a decision that names no
  -- alternatives and gives no rationale is visibly weaker than one that does,
  -- and the surface can say so because the fields exist to be empty.
  alternatives       TEXT,
  rationale          TEXT,

  -- "Contextual" — what this decision was made in service of.
  goal_id            UUID,

  -- "Traceable" — WHO committed to it, and when.
  decided_by_person_id UUID,
  decided_on         DATE,

  -- "Reviewable" — when it should be looked at again. Nullable: not every
  -- decision has a review date, and a default would invent one.
  review_on          DATE,

  status             TEXT NOT NULL DEFAULT 'proposed'
                     CONSTRAINT decisions_status_check
                     CHECK (status IN ('proposed', 'decided', 'superseded', 'cancelled')),

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ,

  CONSTRAINT decisions_statement_present CHECK (length(trim(statement)) > 0),

  -- A decision that has been MADE has somebody who made it and a date. The
  -- constraint is what stops "decided" becoming a status anybody can set on a
  -- record with no decider — which would make traceability optional in
  -- practice while claiming it in the schema.
  CONSTRAINT decisions_decided_is_attributed CHECK (
    status <> 'decided'
    OR (decided_by_person_id IS NOT NULL AND decided_on IS NOT NULL)
  ),

  CONSTRAINT decisions_id_org_uk UNIQUE (id, organization_id),

  CONSTRAINT decisions_decider_same_org
    FOREIGN KEY (decided_by_person_id, organization_id)
    REFERENCES public.people (id, organization_id)
    ON DELETE SET NULL,

  CONSTRAINT decisions_goal_same_org
    FOREIGN KEY (goal_id, organization_id)
    REFERENCES public.goals (id, organization_id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS decisions_org_idx
  ON public.decisions (organization_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS decisions_goal_idx
  ON public.decisions (goal_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS decisions_set_updated_at ON public.decisions;
CREATE TRIGGER decisions_set_updated_at
  BEFORE UPDATE ON public.decisions
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

COMMENT ON TABLE public.decisions IS
  'ONT 14.8 Decision — a governed, justified selection among alternatives, attributed to a person.';

-- ---------------------------------------------------------------------------
-- 3. risks — ONT 17.6
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.risks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  statement        TEXT NOT NULL,

  -- ONT 17.6's three evaluation axes. The scale is this migration's, because
  -- the ontology defines none — see the header.
  likelihood       TEXT NOT NULL DEFAULT 'medium'
                   CONSTRAINT risks_likelihood_check
                   CHECK (likelihood IN ('low', 'medium', 'high')),
  impact           TEXT NOT NULL DEFAULT 'medium'
                   CONSTRAINT risks_impact_check
                   CHECK (impact IN ('low', 'medium', 'high')),
  -- "Organizational tolerance": whether this organization is prepared to carry
  -- it. Not a severity — a high/high risk inside tolerance is a decision, and a
  -- low/low one outside it is a problem.
  tolerance        TEXT NOT NULL DEFAULT 'unset'
                   CONSTRAINT risks_tolerance_check
                   CHECK (tolerance IN ('unset', 'within', 'outside')),

  mitigation       TEXT,

  -- What it threatens. ONT 17.6: risks affect "organizational objectives".
  goal_id          UUID,

  owner_person_id  UUID,

  status           TEXT NOT NULL DEFAULT 'open'
                   CONSTRAINT risks_status_check
                   CHECK (status IN ('open', 'mitigating', 'accepted', 'closed')),

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ,

  CONSTRAINT risks_statement_present CHECK (length(trim(statement)) > 0),

  -- An ACCEPTED risk is one somebody decided to carry. Requiring the tolerance
  -- to be set is what stops "accepted" meaning "nobody looked at it again".
  CONSTRAINT risks_accepted_is_assessed CHECK (
    status <> 'accepted' OR tolerance <> 'unset'
  ),

  CONSTRAINT risks_id_org_uk UNIQUE (id, organization_id),

  CONSTRAINT risks_owner_same_org
    FOREIGN KEY (owner_person_id, organization_id)
    REFERENCES public.people (id, organization_id)
    ON DELETE SET NULL,

  CONSTRAINT risks_goal_same_org
    FOREIGN KEY (goal_id, organization_id)
    REFERENCES public.goals (id, organization_id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS risks_org_idx
  ON public.risks (organization_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS risks_goal_idx
  ON public.risks (goal_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS risks_set_updated_at ON public.risks;
CREATE TRIGGER risks_set_updated_at
  BEFORE UPDATE ON public.risks
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

COMMENT ON TABLE public.risks IS
  'ONT 17.6 Risk — evaluated by likelihood, impact and organizational tolerance; may threaten a Goal.';

COMMIT;
