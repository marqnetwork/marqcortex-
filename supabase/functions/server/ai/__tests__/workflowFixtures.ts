/**
 * Deterministic workflow fixtures (AI-01 Batch 3B, Part 1).
 *
 * THESE ARE FIXTURES, NOT PRODUCTS. Part 1 ships no business workflows and the
 * production registry starts empty; these exist so the validator, the planner
 * and the registry can be exercised against real definitions rather than
 * against a copy of their own tables.
 *
 * Every fixture is a plain value. There is no clock, no id factory and no
 * randomness anywhere in the workflow foundation, so a fixture needs no harness
 * to be deterministic — which is itself the property the plan digest depends on.
 */

import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from '../workflows/contracts/workflow.ts';
import type { AgentDefinition, AgentProposalInput } from '../agents/contracts/agent.ts';
import type { AgentActionProposal } from '../agents/contracts/actions.ts';
import type { WorkflowAgentPort } from '../workflows/engine/agentNodePort.ts';
import type { WorkflowRunStore } from '../workflows/persistence/ports.ts';
import type { WorkflowRuntime } from '../workflows/workflowRuntime.ts';
import type { MutableClock } from '../runtime/clock.ts';
import { object, str } from '../security/validation.ts';
import { createTestClock } from '../runtime/clock.ts';
import { createSequentialIdFactory } from '../contracts/ids.ts';
import { createMemoryWorkflowRunStore } from '../workflows/persistence/ports.ts';
import { createAgentRuntimeNodePort } from '../workflows/engine/agentNodePort.ts';
import { createWorkflowRuntime } from '../workflows/workflowRuntime.ts';
import type { TestAgentRuntime, TestAgentRuntimeOptions } from './agentFixtures.ts';
import { agentAuthenticator, bearer, buildTestAgentRuntime } from './agentFixtures.ts';

export const WORKFLOW_AGENT_ID = {
  intake: 'agent.workflow.intake',
  draft: 'agent.workflow.draft',
  review: 'agent.workflow.review',
  /** Registered nowhere. For the `agentExists` port. */
  unknown: 'agent.workflow.ghost',
} as const;

export const KNOWN_AGENT_IDS: readonly string[] = [
  WORKFLOW_AGENT_ID.intake,
  WORKFLOW_AGENT_ID.draft,
  WORKFLOW_AGENT_ID.review,
];

export const agentExists = (agentId: string): boolean => KNOWN_AGENT_IDS.includes(agentId);

export const workflowContracts = {
  input: object({ brief: str({ minLength: 1, maxLength: 200 }) }),
  output: object({ summary: str({ minLength: 1, maxLength: 200 }) }),
};

export function node(overrides: Partial<WorkflowNode> & Pick<WorkflowNode, 'nodeId'>): WorkflowNode {
  return {
    kind: 'agent',
    agentId: WORKFLOW_AGENT_ID.draft,
    displayName: `Step ${overrides.nodeId}`,
    maxAttempts: 1,
    ...overrides,
  };
}

export function edge(from: string, to: string, label?: string): WorkflowEdge {
  return label === undefined ? { from, to } : { from, to, label };
}

/** A three-node chain: intake, draft, review. The happy path. */
export const linearWorkflow: WorkflowDefinition = {
  workflowId: 'workflow.fixture.linear',
  displayName: 'Linear fixture',
  purpose: 'Exercise the planner against a well-formed chain.',
  description: 'Intake, then draft, then review. One agent per node.',
  owner: 'platform-ai',
  version: '1.0.0',
  enabled: true,
  certification: 'certified',
  nodes: [
    node({ nodeId: 'intake', agentId: WORKFLOW_AGENT_ID.intake, displayName: 'Intake' }),
    node({ nodeId: 'draft', agentId: WORKFLOW_AGENT_ID.draft, displayName: 'Draft', maxAttempts: 3 }),
    node({ nodeId: 'review', agentId: WORKFLOW_AGENT_ID.review, displayName: 'Review', maxAttempts: 2 }),
  ],
  edges: [edge('intake', 'draft'), edge('draft', 'review', 'ready for review')],
  startNodeId: 'intake',
  inputContract: workflowContracts.input,
  outputContract: workflowContracts.output,
};

/** The same graph with no declared start. The planner has to resolve one. */
export const undeclaredStartWorkflow: WorkflowDefinition = {
  ...linearWorkflow,
  workflowId: 'workflow.fixture.undeclared_start',
  startNodeId: undefined,
};

/** One node, no edges. The smallest plannable workflow. */
export const singleNodeWorkflow: WorkflowDefinition = {
  ...linearWorkflow,
  workflowId: 'workflow.fixture.single',
  nodes: [node({ nodeId: 'only', agentId: WORKFLOW_AGENT_ID.intake, displayName: 'Only' })],
  edges: [],
  startNodeId: 'only',
};

export function variant(overrides: Partial<WorkflowDefinition>): WorkflowDefinition {
  return { ...linearWorkflow, ...overrides } as WorkflowDefinition;
}

// ── Execution fixtures (Part 2) ─────────────────────────────────────────────

/**
 * THE AGENTS BELOW ARE FIXTURES, NOT PRODUCTS, and they are deliberately the
 * dullest agents that can exist: each one looks at which agent it is and
 * proposes exactly one action. No model call, no tool, no handoff.
 *
 * That is what makes the workflow suite a test of the WORKFLOW. An agent that
 * reasoned would make a failing assertion ambiguous — did the engine mis-drive
 * the node, or did the agent do something else this time? Behaviour is a pure
 * function of the agent id, so every workflow outcome has exactly one cause.
 */

/** Input the workflow accepts and hands to every node, unchanged. */
export const executionContracts = {
  input: object({ topic: str({ minLength: 1, maxLength: 200 }) }),
  output: object({ finding: str({ minLength: 1, maxLength: 2_000 }) }),
};

export const WF_AGENT = {
  /** Completes on its first proposal. */
  alpha: 'agent.wf.alpha',
  /** Completes on its first proposal. A second, distinct completing agent. */
  beta: 'agent.wf.beta',
  /** Completes on its first proposal. The third node of the chain. */
  gamma: 'agent.wf.gamma',
  /** Always fails. Drives child-failure propagation. */
  failing: 'agent.wf.failing',
  /** Asks for an approval and therefore never finishes unattended. */
  blocking: 'agent.wf.blocking',
} as const;

function workflowNodePropose(input: AgentProposalInput): AgentActionProposal {
  const data = input.input as { topic: string };

  switch (input.agentId) {
    case WF_AGENT.failing:
      return {
        actionType: 'fail',
        reason: 'This fixture agent always fails.',
        idempotencyKey: `fail:${input.runId}`,
        failureReason: 'fixture_failure',
      };

    case WF_AGENT.blocking:
      return {
        actionType: 'request_approval',
        reason: 'This fixture agent always waits for a human.',
        idempotencyKey: `approval:${input.runId}`,
        impactSummary: 'A decision the fixture never receives.',
        dataAffected: ['topic'],
        estimatedAdditionalTokens: 10,
        estimatedAdditionalCostMicroUsd: 10,
      };

    default:
      return {
        actionType: 'complete',
        reason: 'The node is done.',
        idempotencyKey: `complete:${input.runId}`,
        output: { finding: `${input.agentId} handled ${data.topic}` },
      };
  }
}

function workflowNodeAgent(
  agentId: string,
  overrides: Partial<AgentDefinition> = {},
): AgentDefinition {
  return {
    agentId,
    displayName: `Workflow node agent ${agentId}`,
    purpose: 'Exercise the workflow engine deterministically.',
    description: 'A deterministic fixture agent used by the AI-01 Batch 3B suites.',
    owner: 'MARQ Platform Engineering — test fixtures',
    version: '1.0.0',
    enabled: true,
    certification: 'certified',
    safetyClass: 'tenant_readonly',
    capabilities: ['agent.checkpoint.write'],
    allowedTools: [],
    allowedModelProfiles: [],
    allowedHandoffTargets: [],
    inputContract: executionContracts.input,
    outputContract: executionContracts.output,
    limits: {
      maxTotalSteps: 4,
      maxStepsPerAgent: 4,
      maxHandoffs: 0,
      maxRetries: 0,
      maxRepeatedActions: 2,
      maxRepeatedHandoffs: 1,
      maxRuntimeMs: 120_000,
      maxPromptTokens: 10_000,
      maxCompletionTokens: 4_000,
      maxTotalTokens: 14_000,
      maxEstimatedCostMicroUsd: 100_000,
      maxActualCostMicroUsd: 100_000,
    },
    approvals: {
      requireForToolRisk: [],
      requireForHandoff: false,
      requireForCompletion: false,
      approverRoles: ['owner', 'admin', 'reviewer'],
      expiresAfterMs: 3_600_000,
    },
    completion: { requiredOutputFields: ['finding'], terminalAfterHandoff: true },
    propose: workflowNodePropose,
    ...overrides,
  } as AgentDefinition;
}

export const WORKFLOW_NODE_AGENTS: readonly AgentDefinition[] = [
  workflowNodeAgent(WF_AGENT.alpha),
  workflowNodeAgent(WF_AGENT.beta),
  workflowNodeAgent(WF_AGENT.gamma),
  workflowNodeAgent(WF_AGENT.failing),
  workflowNodeAgent(WF_AGENT.blocking, {
    capabilities: ['agent.approval.request', 'agent.checkpoint.write'],
  }),
];

function executableWorkflow(
  workflowId: string,
  nodes: readonly (readonly [string, string])[],
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  return {
    workflowId,
    displayName: `Executable fixture ${workflowId}`,
    purpose: 'Exercise the workflow execution engine.',
    description: 'A deterministic chain used by the AI-01 Batch 3B Part 2 suites.',
    owner: 'MARQ Platform Engineering — test fixtures',
    version: '1.0.0',
    enabled: true,
    certification: 'certified',
    nodes: nodes.map(([nodeId, agentId]) =>
      node({ nodeId, agentId, displayName: `Node ${nodeId}` }),
    ),
    edges: nodes
      .slice(1)
      .map((entry, index) => edge(nodes[index][0], entry[0])),
    startNodeId: nodes[0][0],
    inputContract: executionContracts.input,
    outputContract: executionContracts.output,
    ...overrides,
  } as WorkflowDefinition;
}

export const EXECUTABLE = {
  single: executableWorkflow('workflow.exec.single', [['only', WF_AGENT.alpha]]),
  chain: executableWorkflow('workflow.exec.chain', [
    ['first', WF_AGENT.alpha],
    ['second', WF_AGENT.beta],
    ['third', WF_AGENT.gamma],
  ]),
  /** Node one completes, node two fails. Mid-chain failure propagation. */
  failsMidway: executableWorkflow('workflow.exec.fails_midway', [
    ['first', WF_AGENT.alpha],
    ['second', WF_AGENT.failing],
  ]),
  /** Node one completes, node two blocks on an approval nobody will give. */
  blocksMidway: executableWorkflow('workflow.exec.blocks_midway', [
    ['first', WF_AGENT.alpha],
    ['second', WF_AGENT.blocking],
  ]),
  disabled: executableWorkflow('workflow.exec.disabled', [['only', WF_AGENT.alpha]], {
    enabled: false,
  }),
  uncertified: executableWorkflow('workflow.exec.uncertified', [['only', WF_AGENT.alpha]], {
    certification: 'uncertified',
  }),
} as const;

export const EXECUTABLE_WORKFLOWS: readonly WorkflowDefinition[] = [
  EXECUTABLE.single,
  EXECUTABLE.chain,
  EXECUTABLE.failsMidway,
  EXECUTABLE.blocksMidway,
  EXECUTABLE.disabled,
  EXECUTABLE.uncertified,
];

// ── Harness ─────────────────────────────────────────────────────────────────

export interface TestWorkflowRuntime {
  readonly workflows: WorkflowRuntime;
  readonly agentRuntime: TestAgentRuntime;
  readonly clock: MutableClock;
  readonly runStore: WorkflowRunStore;
  meta(token: string): { authorization: string; correlationId: string };
}

export interface TestWorkflowRuntimeOptions {
  readonly workflows?: readonly WorkflowDefinition[];
  readonly clock?: MutableClock;
  /** Share a store across two runtimes to simulate an isolate restart. */
  readonly runStore?: WorkflowRunStore;
  readonly agentRunStore?: TestAgentRuntimeOptions['runStore'];
  readonly agentCheckpointStore?: TestAgentRuntimeOptions['checkpointStore'];
  readonly agentApprovalStore?: TestAgentRuntimeOptions['approvalStore'];
  /** Wrap the real agent port. Crash and blocking simulations only. */
  readonly wrapAgentPort?: (port: WorkflowAgentPort) => WorkflowAgentPort;
  readonly requireCertifiedWorkflows?: () => boolean;
}

/**
 * Builds a REAL workflow runtime over a REAL agent runtime over a REAL control
 * plane, with every non-deterministic dependency replaced. Nothing on the path
 * under test is stubbed: the workflow registry, planner, state machine, engine,
 * store and service are production implementations, and so is every agent
 * runtime component beneath them.
 */
export function buildTestWorkflowRuntime(
  options: TestWorkflowRuntimeOptions = {},
): TestWorkflowRuntime {
  const clock = options.clock ?? createTestClock();
  const agentRuntime = buildTestAgentRuntime({
    agents: WORKFLOW_NODE_AGENTS,
    clock,
    ...(options.agentRunStore === undefined ? {} : { runStore: options.agentRunStore }),
    ...(options.agentCheckpointStore === undefined
      ? {}
      : { checkpointStore: options.agentCheckpointStore }),
    ...(options.agentApprovalStore === undefined
      ? {}
      : { approvalStore: options.agentApprovalStore }),
  });

  const runStore = options.runStore ?? createMemoryWorkflowRunStore();
  const realPort = createAgentRuntimeNodePort(agentRuntime.runtime.orchestrator);

  const workflows = createWorkflowRuntime({
    agentRuntime: agentRuntime.runtime,
    authenticator: agentAuthenticator(),
    organizationOptions: {
      defaultOrganizationId: 'acme',
      allowList: [],
      allowDefaultOrganization: true,
    },
    workflows: options.workflows ?? EXECUTABLE_WORKFLOWS,
    runStore,
    clock,
    ids: createSequentialIdFactory('wf'),
    logger: agentRuntime.plane.logger,
    agentPort: options.wrapAgentPort ? options.wrapAgentPort(realPort) : realPort,
    ...(options.requireCertifiedWorkflows === undefined
      ? {}
      : { requireCertifiedWorkflows: options.requireCertifiedWorkflows }),
  });

  return {
    workflows,
    agentRuntime,
    clock,
    runStore,
    meta: (token) => ({ authorization: bearer(token), correlationId: 'cor_test_workflow' }),
  };
}
