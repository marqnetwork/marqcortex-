-- ============================================================================
-- Membership bootstrap harness — concurrency fixture.
--
-- A clean slate with four eligible, undecided users. The concurrency phase runs
-- several copies of the bootstrap against this at the same time; whatever they
-- do, the answer has to be four memberships, four ledger rows and no error.
-- ============================================================================

INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-0000000c0001', 'race-owner@marq.test',
   '{"marq_team": true, "team_role": "owner"}'::jsonb, '{}'::jsonb),
  ('00000000-0000-4000-8000-0000000c0002', 'race-analyst@marq.test',
   '{"marq_team": true, "team_role": "analyst"}'::jsonb, '{}'::jsonb),
  ('00000000-0000-4000-8000-0000000c0003', 'race-viewer@marq.test',
   '{"marq_team": true, "team_role": "viewer"}'::jsonb, '{}'::jsonb),
  ('00000000-0000-4000-8000-0000000c0004', 'race-admin@marq.test',
   '{"marq_team": true, "team_role": "admin"}'::jsonb, '{}'::jsonb);
