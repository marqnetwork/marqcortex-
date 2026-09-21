-- ============================================================================
-- BP-003 — two tenants, each with workflow runtime state.
--
-- Two organizations, because every isolation claim in this suite is "Beta
-- cannot see, reference or write Alpha's rows" and a claim about an empty
-- table is not a claim about isolation.
-- ============================================================================

INSERT INTO public.organizations (id, name, slug)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'Alpha', 'alpha'),
  ('22222222-2222-4222-8222-222222222222', 'Beta',  'beta')
ON CONFLICT (id) DO NOTHING;

-- Alpha: a run, its chain, and a pending decision on it.
SELECT public.workflow_run_create(
  '11111111-1111-4111-8111-111111111111', 'wfr_alpha', 'wf.review', 'user_alpha',
  'waiting_for_approval', 2, 1,
  '2026-09-21T10:00:00.000Z', '2026-09-21T10:01:00.000Z',
  '{"context":{"workflowRunId":"wfr_alpha","organizationId":"11111111-1111-4111-8111-111111111111","workflowId":"wf.review","actorId":"user_alpha"},"state":"waiting_for_approval","runVersion":2}'::jsonb
);

SELECT public.workflow_checkpoint_append(
  '11111111-1111-4111-8111-111111111111', 'wfr_alpha', 1, 'digest_1', NULL,
  'node_one', 'running', '2026-09-21T10:00:30.000Z',
  '{"workflowRunId":"wfr_alpha","organizationId":"11111111-1111-4111-8111-111111111111","version":1,"digest":"digest_1","nodeId":"node_one","state":"running"}'::jsonb
);

SELECT public.workflow_approval_create(
  '11111111-1111-4111-8111-111111111111', 'wfa:wfr_alpha:gate:main:1', 'wfr_alpha',
  'wf.review', 'gate', NULL, 'pending', 1,
  '2026-09-21T10:00:50.000Z', '2026-09-21T11:00:50.000Z', NULL, NULL, '2026-09-21T10:00:50.000Z',
  '{"workflowApprovalId":"wfa:wfr_alpha:gate:main:1","workflowRunId":"wfr_alpha","organizationId":"11111111-1111-4111-8111-111111111111","workflowId":"wf.review","nodeId":"gate","approvalState":"pending","approvalVersion":1,"singleUse":true}'::jsonb
);

-- Beta: a run of its own, so Alpha's isolation claims are about rows that
-- exist on both sides rather than about a tenant with nothing in it.
SELECT public.workflow_run_create(
  '22222222-2222-4222-8222-222222222222', 'wfr_beta', 'wf.intake', 'user_beta',
  'running', 1, 0,
  '2026-09-21T10:00:00.000Z', '2026-09-21T10:00:00.000Z',
  '{"context":{"workflowRunId":"wfr_beta","organizationId":"22222222-2222-4222-8222-222222222222","workflowId":"wf.intake","actorId":"user_beta"},"state":"running","runVersion":1}'::jsonb
);
