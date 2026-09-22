-- ============================================================================
-- A2-P07 — two tenants, each with agent runtime state, written through the
-- runtime's own functions.
-- ============================================================================

INSERT INTO public.organizations (id, name, slug)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'Alpha', 'alpha'),
  ('22222222-2222-4222-8222-222222222222', 'Beta',  'beta')
ON CONFLICT (id) DO NOTHING;

-- Alpha: a run waiting on a human, its entry checkpoint, and the request.
SELECT public.agent_run_create(
  '11111111-1111-4111-8111-111111111111', 'run_alpha', 'agent.primary', 'user_alpha',
  'waiting_for_approval', 2, 1,
  '2026-09-22T10:00:00.000Z', '2026-09-22T10:01:00.000Z',
  '{"context":{"runId":"run_alpha","organizationId":"11111111-1111-4111-8111-111111111111","agentId":"agent.primary","actorId":"user_alpha"},"state":"waiting_for_approval","runVersion":2,"checkpointVersion":1}'::jsonb
);

SELECT public.agent_checkpoint_append(
  '11111111-1111-4111-8111-111111111111', 'run_alpha', 1, 'pdigest_1', NULL,
  'agent.primary', 'created', 0, '2026-09-22T10:00:10.000Z',
  '{"runId":"run_alpha","organizationId":"11111111-1111-4111-8111-111111111111","version":1,"progressDigest":"pdigest_1","agentId":"agent.primary","state":"created","stepCount":0}'::jsonb
);

SELECT public.agent_approval_create(
  '11111111-1111-4111-8111-111111111111', 'apr_alpha', 'run_alpha', 'act_alpha', 'agent.primary',
  'pending', 1,
  '2026-09-22T10:00:50.000Z', '2026-09-22T11:00:50.000Z', NULL, NULL, '2026-09-22T10:00:50.000Z',
  '{"approvalId":"apr_alpha","runId":"run_alpha","actionId":"act_alpha","organizationId":"11111111-1111-4111-8111-111111111111","requestingAgentId":"agent.primary","state":"pending","approvalVersion":1,"singleUse":true,"expiresAt":"2026-09-22T11:00:50.000Z"}'::jsonb
);

-- Beta: a run of its own, so isolation claims are about rows on both sides.
SELECT public.agent_run_create(
  '22222222-2222-4222-8222-222222222222', 'run_beta', 'agent.primary', 'user_beta',
  'running', 1, 0,
  '2026-09-22T10:00:00.000Z', '2026-09-22T10:00:00.000Z',
  '{"context":{"runId":"run_beta","organizationId":"22222222-2222-4222-8222-222222222222","agentId":"agent.primary","actorId":"user_beta"},"state":"running","runVersion":1,"checkpointVersion":0}'::jsonb
);
