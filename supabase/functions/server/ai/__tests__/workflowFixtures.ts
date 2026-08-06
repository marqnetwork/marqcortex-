/**
 * Deterministic workflow fixtures and harness (AI-01 Batch 3B).
 *
 * Builds a REAL workflow runtime — the same `createWorkflowRuntime` production
 * uses — over a REAL agent runtime over a REAL control plane, with every
 * non-deterministic dependency replaced: a hand-driven clock, sequential ids, an
 * in-memory log sink and the mock provider. Nothing on the path under test is
 * stubbed. The workflow registry, the planner, the state machine, the
 * orchestrator, the approval gate, the stores, the agent port, the tool gateway
 * and the HTTP adapter are all production implementations.
 *
 * THE WORKFLOWS HERE ARE FIXTURES, NOT PRODUCTS. AI-01 Batch 3B ships no
 * business workflows, and the production registry starts empty. These exist so
 * the runtime's guarantees can be exercised: a sequential plan, a parallel one,
 * one whose branch depends on a condition, one whose join is a quorum over a
 * failure, one that parks on a human decision, and one that is deliberately
 * invalid.
 */

import type { AgentDefinition } from '../agents/contracts/agent.ts';
import type { WorkflowDefinition } from '../workflows/contracts/workflow.ts';
import type { WorkflowRuntime } from '../workflows/workflowRuntime.ts';
import type { AgentRuntime } from '../agents/agentRuntime.ts';
import type { AgentApprovalStore } from '../agents/persistence/ports.ts';
import type { WorkflowRunStore, WorkflowCheckpointStore } from '../workflows/persistence/workflowPorts.ts';
import type { MutableClock } from '../runtime/clock.ts';
import type { AIControlPlane } from '../controlPlane.ts';
import { createWorkflowRuntime } from '../workflows/workflowRuntime.ts';
import { createAgentRuntime } from '../agents/agentRuntime.ts';
import { createControlPlane } from '../controlPlane.ts';
import { createMemoryApprovalStore } from '../agents/persistence/ports.ts';
import { loadControlPlaneConfig } from '../runtime/config.ts';
import { recordEnv } from '../runtime/env.ts';
import { createTestClock } from '../runtime/clock.ts';
import { createSequentialIdFactory } from '../contracts/ids.ts';
import { createMemorySink } from '../observability/logger.ts';
import { createMetrics } from '../observability/metrics.ts';
import { createMockProvider } from '../providers/mockProvider.ts';
import { DETERMINISTIC_TOOLS, DETERMINISTIC_TOOL_IDS } from '../agents/tools/mockTools.ts';
import { AGENT_ID, FIXTURE_AGENTS, agentAuthenticator, bearer } from './agentFixtures.ts';

export { AGENT_TOKEN, bearer, createFakeKv } from './agentFixtures.ts';

const OWNER = 'MARQ Platform Engineering — test fixtures';

const LIMITS = {
  maxNodes: 8,
  maxParallel: 2,
  maxWaves: 8,
  maxNodeExecutions: 24,
  maxRuntimeMs: 600_000,
  maxTotalTokens: 500_000,
  maxEstimatedCostMicroUsd: 2_000_000,
  maxActualCostMicroUsd: 2_000_000,
  maxApprovals: 4,
};

export const WORKFLOW_ID = {
  sequential: 'workflow.test.sequential',
  parallel: 'workflow.test.parallel',
  conditional: 'workflow.test.conditional',
  quorum: 'workflow.test.quorum',
  approval: 'workflow.test.approval',
  tool: 'workflow.test.tool',
  disabled: 'workflow.test.disabled',
} as const;

/** An agent node running the fixture agent's `complete_immediately` script. */
function agentNode(
  nodeId: string,
  topic: string,
  options: {
    dependsOn?: readonly string[];
    join?: WorkflowDefinition['nodes'][number]['join'];
    when?: WorkflowDefinition['nodes'][number]['when'];
    optional?: boolean;
    script?: string;
    publishes?: readonly { name: string; from: string }[];
  } = {},
) {
  return {
    nodeId,
    kind: 'agent' as const,
    displayName: `Agent step ${nodeId}`,
    purpose: 'Exercise the workflow orchestrator deterministically.',
    dependsOn: options.dependsOn ?? [],
    agentId: AGENT_ID.primary,
    objective: `Establish a deterministic finding for ${topic}.`,
    input: { topic, script: options.script ?? 'complete_immediately' },
    publishes: options.publishes ?? [{ name: 'finding', from: 'finding' }],
    ...(options.join === undefined ? {} : { join: options.join }),
    ...(options.when === undefined ? {} : { when: options.when }),
    ...(options.optional === undefined ? {} : { optional: options.optional }),
  };
}

function terminal(
  nodeId: string,
  dependsOn: readonly string[],
  options: {
    outcome?: 'succeeded' | 'failed';
    join?: WorkflowDefinition['nodes'][number]['join'];
  } = {},
) {
  return {
    nodeId,
    kind: 'terminal' as const,
    displayName: `Terminal ${nodeId}`,
    purpose: 'Declare the outcome the plan reached.',
    dependsOn,
    outcome: options.outcome ?? ('succeeded' as const),
    ...(options.join === undefined ? {} : { join: options.join }),
  };
}

function base(workflowId: string, entryNodeId: string, nodes: WorkflowDefinition['nodes']) {
  return {
    workflowId,
    displayName: `Test workflow ${workflowId}`,
    purpose: 'Exercise the workflow runtime deterministically.',
    description: 'A deterministic fixture workflow used by the AI-01 Batch 3B suites.',
    owner: OWNER,
    version: '1.0.0',
    enabled: true,
    certification: 'certified' as const,
    entryNodeId,
    nodes,
    limits: LIMITS,
  };
}

/** Entry agent, then a terminal node. The smallest complete plan. */
export const sequentialWorkflow: WorkflowDefinition = base(
  WORKFLOW_ID.sequential,
  'intake',
  [agentNode('intake', 'Intake handoffs'), terminal('done', ['intake'])],
);

/** Two independent agent nodes in one wave, joined by `all`. */
export const parallelWorkflow: WorkflowDefinition = base(
  WORKFLOW_ID.parallel,
  'start',
  [
    agentNode('start', 'Parallel start'),
    agentNode('left', 'Left branch', { dependsOn: ['start'] }),
    agentNode('right', 'Right branch', { dependsOn: ['start'] }),
    terminal('done', ['left', 'right']),
  ],
);

/**
 * A branch chosen by a condition.
 *
 * `classify` publishes its finding; `approved` runs only when the finding is
 * the one the gate expects, and `rejected` runs only when it is not. The two are
 * mutually exclusive by construction, and the terminal node joins on `any` so
 * whichever branch ran satisfies it.
 */
export const conditionalWorkflow: WorkflowDefinition = base(
  WORKFLOW_ID.conditional,
  'classify',
  [
    agentNode('classify', 'gate'),
    agentNode('approved', 'Approved branch', {
      dependsOn: ['classify'],
      when: [{ fact: 'classify.finding', operator: 'equals', value: 'Finding for gate' }],
      publishes: [{ name: 'finding', from: 'finding' }],
    }),
    agentNode('rejected', 'Rejected branch', {
      dependsOn: ['classify'],
      when: [{ fact: 'classify.finding', operator: 'equals', value: 'never matches' }],
      publishes: [{ name: 'finding', from: 'finding' }],
    }),
    terminal('done', ['approved', 'rejected'], { join: { policy: 'any' } }),
  ],
);

/** Three optional branches, one of which fails, joined by a quorum of two. */
export const quorumWorkflow: WorkflowDefinition = base(
  WORKFLOW_ID.quorum,
  'start',
  [
    agentNode('start', 'Quorum start'),
    agentNode('a', 'Branch A', { dependsOn: ['start'], optional: true }),
    agentNode('b', 'Branch B', { dependsOn: ['start'], optional: true }),
    agentNode('c', 'Branch C', {
      dependsOn: ['start'],
      optional: true,
      script: 'fail_immediately',
    }),
    terminal('done', ['a', 'b', 'c'], { join: { policy: 'quorum', quorum: 2 } }),
  ],
);

/** An agent step, then a human gate, then a terminal node. */
export const approvalWorkflow: WorkflowDefinition = base(
  WORKFLOW_ID.approval,
  'draft',
  [
    agentNode('draft', 'Approval draft'),
    {
      nodeId: 'sign_off',
      kind: 'approval' as const,
      displayName: 'Human sign-off',
      purpose: 'A person confirms the finding before the plan continues.',
      dependsOn: ['draft'],
      impactSummary: 'Confirm the finding before the plan continues.',
      dataAffected: ['finding'],
      approverRoles: ['owner', 'admin', 'reviewer'],
      expiresAfterMs: 3_600_000,
    },
    terminal('done', ['sign_off']),
  ],
);

/**
 * A tool node.
 *
 * It runs on behalf of `agent.test.tooluser`, which is the only fixture agent
 * whose allow list contains the lookup tool — a workflow cannot grant itself a
 * tool, and this fixture is what proves the permission still comes from the
 * agent registry.
 */
export const toolWorkflow: WorkflowDefinition = base(
  WORKFLOW_ID.tool,
  'lookup',
  [
    {
      nodeId: 'lookup',
      kind: 'tool' as const,
      displayName: 'Registry lookup',
      purpose: 'Read a bounded tenant-scoped record.',
      dependsOn: [],
      toolId: DETERMINISTIC_TOOL_IDS.lookup,
      onBehalfOfAgentId: AGENT_ID.toolUser,
      input: { recordKey: 'readiness' },
      publishes: [
        { name: 'found', from: 'found' },
        { name: 'value', from: 'value' },
      ],
    },
    terminal('done', ['lookup']),
  ],
);

export const disabledWorkflow: WorkflowDefinition = {
  ...base(WORKFLOW_ID.disabled, 'intake', [
    agentNode('intake', 'Disabled'),
    terminal('done', ['intake']),
  ]),
  enabled: false,
};

export const FIXTURE_WORKFLOWS: readonly WorkflowDefinition[] = [
  sequentialWorkflow,
  parallelWorkflow,
  conditionalWorkflow,
  quorumWorkflow,
  approvalWorkflow,
  toolWorkflow,
  disabledWorkflow,
];

/** A plan with a dependency cycle. Never registered — the registry refuses it. */
export const cyclicWorkflow: WorkflowDefinition = base(
  'workflow.test.cyclic',
  'a',
  [
    agentNode('a', 'A', { dependsOn: ['c'] }),
    agentNode('b', 'B', { dependsOn: ['a'] }),
    agentNode('c', 'C', { dependsOn: ['b'] }),
    terminal('done', ['c']),
  ],
);

// ── Harness ─────────────────────────────────────────────────────────────────

export interface TestWorkflowRuntime {
  readonly runtime: WorkflowRuntime;
  readonly agentRuntime: AgentRuntime;
  readonly plane: AIControlPlane;
  readonly clock: MutableClock;
  readonly approvalStore: AgentApprovalStore;
  readonly logs: { level: string; line: string }[];
  meta(token: string): { authorization: string; correlationId: string; clientIp: string };
}

export interface TestWorkflowRuntimeOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly workflows?: readonly WorkflowDefinition[];
  readonly agents?: readonly AgentDefinition[];
  readonly runStore?: WorkflowRunStore;
  readonly checkpointStore?: WorkflowCheckpointStore;
  readonly approvalStore?: AgentApprovalStore;
  readonly agentRunStore?: AgentRuntime['runs'];
  readonly agentCheckpointStore?: AgentRuntime['checkpoints'];
  readonly clock?: MutableClock;
  readonly optimization?: Parameters<typeof createAgentRuntime>[0]['optimization'];
}

export function buildTestWorkflowRuntime(
  options: TestWorkflowRuntimeOptions = {},
): TestWorkflowRuntime {
  const clock = options.clock ?? createTestClock();
  const sink = createMemorySink();
  const authenticator = agentAuthenticator();

  const config = loadControlPlaneConfig(
    recordEnv({
      AI_PROVIDER_PREFERENCE: 'primary,backup',
      AI_LOG_LEVEL: 'debug',
      AI_RETRY_BASE_DELAY_MS: '0',
      AI_RETRY_JITTER_PERCENT: '0',
      AI_DEFAULT_ORGANIZATION_ID: 'acme',
      ...options.env,
    }),
  );

  const plane = createControlPlane({
    config,
    authenticator,
    providers: [
      {
        adapter: createMockProvider({ providerId: 'primary', priority: 1 }),
        certification: 'certified',
      },
      {
        adapter: createMockProvider({ providerId: 'backup', priority: 2 }),
        certification: 'certified',
      },
    ],
    clock,
    ids: createSequentialIdFactory('plane'),
    logSink: sink,
    sleep: () => Promise.resolve(),
    random: () => 0.5,
  });

  // ONE approval store, shared by both runtimes. A workflow gate and an agent
  // gate belong in one operator queue, and the production bootstrap wires them
  // exactly this way.
  const approvalStore = options.approvalStore ?? createMemoryApprovalStore();

  const agentRuntime = createAgentRuntime({
    plane,
    authenticator,
    organizationOptions: {
      defaultOrganizationId: config.defaultOrganizationId,
      allowList: config.organizationAllowList,
      allowDefaultOrganization: config.allowDefaultOrganization,
    },
    agents: options.agents ?? FIXTURE_AGENTS,
    tools: DETERMINISTIC_TOOLS,
    approvalStore,
    clock,
    ids: createSequentialIdFactory('agent'),
    logger: plane.logger,
    ...(options.agentRunStore === undefined ? {} : { runStore: options.agentRunStore }),
    ...(options.agentCheckpointStore === undefined
      ? {}
      : { checkpointStore: options.agentCheckpointStore }),
    ...(options.optimization === undefined ? {} : { optimization: options.optimization }),
  });

  const runtime = createWorkflowRuntime({
    agentRuntime,
    authenticator,
    organizationOptions: {
      defaultOrganizationId: config.defaultOrganizationId,
      allowList: config.organizationAllowList,
      allowDefaultOrganization: config.allowDefaultOrganization,
    },
    workflows: options.workflows ?? FIXTURE_WORKFLOWS,
    approvalStore,
    clock,
    ids: createSequentialIdFactory('wf'),
    logger: plane.logger,
    metrics: createMetrics(),
    ...(options.runStore === undefined ? {} : { runStore: options.runStore }),
    ...(options.checkpointStore === undefined
      ? {}
      : { checkpointStore: options.checkpointStore }),
  });

  return {
    runtime,
    agentRuntime,
    plane,
    clock,
    approvalStore,
    logs: sink.lines,
    meta: (token) => ({
      authorization: bearer(token),
      correlationId: 'cor_test_workflow',
      clientIp: '203.0.113.10',
    }),
  };
}

/** A minimal valid workflow run body. */
export function workflowBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { workflowId: WORKFLOW_ID.sequential, ...overrides };
}
