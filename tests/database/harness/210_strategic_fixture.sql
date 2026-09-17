-- ============================================================================
-- CP-4 fixture: goals, decisions and risks in BOTH organizations.
--
-- Builds on `200_spine_fixture.sql` and reuses its two tenants, its people and
-- its memberships. A second set of organizations would be a second thing to
-- keep in step, and the property under test is the same boundary.
--
-- Readable hex ids, as the spine fixture uses: `...aa01` goals, `...dc01`
-- decisions, `...f501` risks. A failing assertion then names something a person
-- can find.
--
-- Seeded as the SESSION role. It is the ASSERTIONS that run as `authenticated`.
-- ============================================================================

-- ── Goals ───────────────────────────────────────────────────────────────────
-- One per tenant, each owned by that tenant's own person.
INSERT INTO public.goals (id, organization_id, statement, measure, target_value, due_on, status, owner_person_id)
VALUES
  ('a0000000-0000-4000-8000-00000000aa01', 'aaaaaaaa-0000-4000-8000-000000000001',
   'Ship the platform rewrite', 'Milestones completed', '8 of 8', '2026-12-31', 'in_progress',
   'a0000000-0000-4000-8000-00000000ee01'),

  -- Owned by the person with NO LOGIN. ONT 12.3 again, one layer up: a goal
  -- can be owned by somebody who cannot sign in, and nothing about the record
  -- may depend on an auth account existing.
  ('a0000000-0000-4000-8000-00000000aa02', 'aaaaaaaa-0000-4000-8000-000000000001',
   'Cut build time below five minutes', 'p95 build duration', 'under 5 min', NULL, 'planned',
   'a0000000-0000-4000-8000-00000000ee02'),

  ('b0000000-0000-4000-8000-00000000aa01', 'bbbbbbbb-0000-4000-8000-000000000002',
   'Answer every ticket within an hour', 'First response time', 'under 60 min', '2026-09-30', 'in_progress',
   'b0000000-0000-4000-8000-00000000ee01')
ON CONFLICT (id) DO NOTHING;

-- ── Decisions ───────────────────────────────────────────────────────────────
INSERT INTO public.decisions (id, organization_id, statement, alternatives, rationale, goal_id,
                              decided_by_person_id, decided_on, status)
VALUES
  ('a0000000-0000-4000-8000-00000000dc01', 'aaaaaaaa-0000-4000-8000-000000000001',
   'Rewrite on the existing framework rather than migrating',
   'Migrate to a new framework; rewrite in place; do nothing',
   'Migrating would cost two quarters the rewrite does not have.',
   'a0000000-0000-4000-8000-00000000aa01',
   'a0000000-0000-4000-8000-00000000ee01', '2026-08-01', 'decided'),

  ('b0000000-0000-4000-8000-00000000dc01', 'bbbbbbbb-0000-4000-8000-000000000002',
   'Staff the support desk on weekends',
   'Weekend rota; outsource; leave unstaffed',
   'Weekend tickets are a third of the backlog.',
   'b0000000-0000-4000-8000-00000000aa01',
   'b0000000-0000-4000-8000-00000000ee01', '2026-08-15', 'decided')
ON CONFLICT (id) DO NOTHING;

-- ── Risks ───────────────────────────────────────────────────────────────────
INSERT INTO public.risks (id, organization_id, statement, likelihood, impact, tolerance,
                          mitigation, goal_id, owner_person_id, status)
VALUES
  ('a0000000-0000-4000-8000-00000000f501', 'aaaaaaaa-0000-4000-8000-000000000001',
   'The rewrite slips past the December deadline', 'high', 'high', 'outside',
   'Cut scope at the November checkpoint.',
   'a0000000-0000-4000-8000-00000000aa01',
   'a0000000-0000-4000-8000-00000000ee01', 'mitigating'),

  ('b0000000-0000-4000-8000-00000000f501', 'bbbbbbbb-0000-4000-8000-000000000002',
   'Weekend cover cannot be recruited in time', 'medium', 'high', 'within',
   'Contract cover for the first quarter.',
   'b0000000-0000-4000-8000-00000000aa01',
   'b0000000-0000-4000-8000-00000000ee01', 'open')
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  RAISE NOTICE 'strategic fixture: 3 goals, 2 decisions, 2 risks across two tenants';
END $$;
