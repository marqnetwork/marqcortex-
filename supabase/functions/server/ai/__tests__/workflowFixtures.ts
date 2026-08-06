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
  WorkflowAgentNode,
  WorkflowConditionNode,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowJoinNode,
  WorkflowParallelNode,
} from '../workflows/contracts/workflow.ts';
import type {
  WorkflowJoinPolicy,
  WorkflowParallelFailurePolicy,
} from '../workflows/contracts/parallel.ts';
import type { WorkflowExpression } from '../workflows/contracts/expression.ts';
import type { WorkflowMapping } from '../workflows/contracts/mapping.ts';
import type { WorkflowCheckpointStore } from '../workflows/persistence/ports.ts';
import type { AgentDefinition, AgentProposalInput } from '../agents/contracts/agent.ts';
import type { AgentActionProposal } from '../agents/contracts/actions.ts';
import type { WorkflowAgentPort } from '../workflows/engine/agentNodePort.ts';
import type { WorkflowRunStore } from '../workflows/persistence/ports.ts';
import type { WorkflowRuntime } from '../workflows/workflowRuntime.ts';
import type { MutableClock } from '../runtime/clock.ts';
import type { Validator } from '../security/validation.ts';
import { arrayOf, jsonObject, num, object, str } from '../security/validation.ts';
import { createTestClock } from '../runtime/clock.ts';
import { createSequentialIdFactory } from '../contracts/ids.ts';
import {
  createMemoryWorkflowCheckpointStore,
  createMemoryWorkflowRunStore,
} from '../workflows/persistence/ports.ts';
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

export function node(
  overrides: Partial<WorkflowAgentNode> & Pick<WorkflowAgentNode, 'nodeId'>,
): WorkflowAgentNode {
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
  readonly checkpointStore: WorkflowCheckpointStore;
  meta(token: string): { authorization: string; correlationId: string };
}

export interface TestWorkflowRuntimeOptions {
  readonly workflows?: readonly WorkflowDefinition[];
  readonly agents?: readonly AgentDefinition[];
  readonly checkpointStore?: WorkflowCheckpointStore;
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
    agents: options.agents ?? WORKFLOW_NODE_AGENTS,
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
  const checkpointStore = options.checkpointStore ?? createMemoryWorkflowCheckpointStore();
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
    checkpointStore,
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
    checkpointStore,
    meta: (token) => ({ authorization: bearer(token), correlationId: 'cor_test_workflow' }),
  };
}

// ── Part 3 fixtures: data flow, conditions and loops ────────────────────────

/**
 * A scorer whose output is DERIVED FROM ITS INPUT, deterministically.
 *
 * `score` is the topic's length. That is deliberately boring: a condition test
 * asserting "the true branch was taken" is only meaningful if the value it
 * branched on is one the test chose, and an agent that reasoned would make
 * every branch assertion a statement about the agent instead of the engine.
 */
export const scoredOutput = object({
  finding: str({ minLength: 1, maxLength: 2_000 }),
  score: num({ min: 0, max: 100_000 }),
});

const noteInput = object({ note: str({ minLength: 1, maxLength: 500 }) });
const noteOutput = object({ finding: str({ minLength: 1, maxLength: 2_000 }) });

export const WF3_AGENT = {
  /** Emits `{ finding, score }` with score = topic length. */
  scorer: 'agent.wf.scorer',
  /** Takes `{ note }` — NOT the workflow input's shape, so it must be mapped. */
  recorder: 'agent.wf.recorder',
} as const;

function part3Propose(input: AgentProposalInput): AgentActionProposal {
  if (input.agentId === WF3_AGENT.recorder) {
    const data = input.input as { note: string };
    return {
      actionType: 'complete',
      reason: 'Note recorded.',
      idempotencyKey: `complete:${input.runId}`,
      output: { finding: `recorded: ${data.note}` },
    };
  }
  const data = input.input as { topic: string };
  return {
    actionType: 'complete',
    reason: 'Scored.',
    idempotencyKey: `complete:${input.runId}`,
    output: { finding: `scored ${data.topic}`, score: data.topic.length },
  };
}

export const PART3_AGENTS: readonly AgentDefinition[] = [
  ...WORKFLOW_NODE_AGENTS,
  {
    ...workflowNodeAgent(WF3_AGENT.scorer),
    outputContract: scoredOutput,
    propose: part3Propose,
  } as AgentDefinition,
  {
    ...workflowNodeAgent(WF3_AGENT.recorder),
    inputContract: noteInput,
    outputContract: noteOutput,
    propose: part3Propose,
  } as AgentDefinition,
];

/** The Part 3 workflow input: a topic, a branch threshold and a loop count. */
export const part3Input = object({
  topic: str({ minLength: 1, maxLength: 200 }),
  threshold: num({ min: 0, max: 100_000 }),
  rounds: num({ min: 0, max: 100 }),
});

export function conditionNode(
  nodeId: string,
  expression: WorkflowExpression,
): WorkflowConditionNode {
  return { kind: 'condition', nodeId, displayName: `Condition ${nodeId}`, expression };
}

function part3Workflow(
  workflowId: string,
  nodes: readonly (WorkflowAgentNode | WorkflowConditionNode)[],
  edges: readonly WorkflowEdge[],
  startNodeId: string,
): WorkflowDefinition {
  return {
    workflowId,
    displayName: `Part 3 fixture ${workflowId}`,
    purpose: 'Exercise data flow, conditions and bounded loops.',
    description: 'A deterministic fixture used by the AI-01 Batch 3B Part 3 suites.',
    owner: 'MARQ Platform Engineering — test fixtures',
    version: '1.0.0',
    enabled: true,
    certification: 'certified',
    nodes,
    edges,
    startNodeId,
    inputContract: part3Input,
    outputContract: object({ finding: str({ minLength: 1, maxLength: 2_000 }) }),
  } as WorkflowDefinition;
}

const scorerNode = (nodeId: string): WorkflowAgentNode => ({
  ...node({ nodeId, agentId: WF3_AGENT.scorer, displayName: 'Score the topic' }),
  outputContract: scoredOutput,
});

/** `score > threshold` — the canonical branch. */
export const scoreExceedsThreshold: WorkflowExpression = {
  op: 'greater_than',
  left: { source: 'node', nodeId: 'score', path: 'score' },
  right: { source: 'input', path: 'threshold' },
};

export const PART3 = {
  /** score → condition → high | low. Both branches terminate. */
  branching: part3Workflow(
    'workflow.p3.branching',
    [
      scorerNode('score'),
      conditionNode('gate', scoreExceedsThreshold),
      { ...node({ nodeId: 'high', agentId: WF_AGENT.alpha }), outputContract: noteOutput },
      { ...node({ nodeId: 'low', agentId: WF_AGENT.beta }), outputContract: noteOutput },
    ],
    [
      edge('score', 'gate'),
      { from: 'gate', to: 'high', when: true },
      { from: 'gate', to: 'low', when: false },
    ],
    'score',
  ),

  /** score → recorder, whose input shape differs and must be mapped. */
  mapped: part3Workflow(
    'workflow.p3.mapped',
    [
      scorerNode('score'),
      {
        ...node({ nodeId: 'record', agentId: WF3_AGENT.recorder }),
        inputMapping: {
          assignments: [
            { to: 'note', from: { source: 'node', nodeId: 'score', path: 'finding' }, required: true },
          ],
        },
        inputContract: noteInput,
        outputMapping: {
          assignments: [
            { to: 'finding', from: { source: 'result', path: 'finding' }, required: true },
          ],
        },
        outputContract: noteOutput,
      },
    ],
    [edge('score', 'record')],
    'score',
  ),

  /**
   * tick → gate. The gate exits when tick has run `rounds` times and otherwise
   * loops back — a bounded loop with an explicit exit, which is the only shape
   * a cycle may take.
   */
  loop: part3Workflow(
    'workflow.p3.loop',
    [
      { ...node({ nodeId: 'tick', agentId: WF_AGENT.alpha }), outputContract: noteOutput },
      conditionNode('gate', {
        op: 'greater_than_or_equal',
        left: { source: 'counter', counter: 'node_visits', nodeId: 'tick' },
        right: { source: 'input', path: 'rounds' },
      }),
      { ...node({ nodeId: 'done', agentId: WF_AGENT.beta }), outputContract: noteOutput },
    ],
    [
      edge('tick', 'gate'),
      { from: 'gate', to: 'done', when: true },
      { from: 'gate', to: 'tick', when: false, loop: { maxIterations: 4 } },
    ],
    'tick',
  ),

  /** The same shape with an exit that never holds. Exhaustion is the outcome. */
  loopExhausted: part3Workflow(
    'workflow.p3.loop_exhausted',
    [
      { ...node({ nodeId: 'tick', agentId: WF_AGENT.alpha }), outputContract: noteOutput },
      conditionNode('gate', {
        op: 'equals',
        left: { source: 'literal', value: true },
        right: { source: 'literal', value: false },
      }),
      { ...node({ nodeId: 'done', agentId: WF_AGENT.beta }), outputContract: noteOutput },
    ],
    [
      edge('tick', 'gate'),
      { from: 'gate', to: 'done', when: true },
      { from: 'gate', to: 'tick', when: false, loop: { maxIterations: 2 } },
    ],
    'tick',
  ),
} as const;

export const PART3_WORKFLOWS: readonly WorkflowDefinition[] = [
  PART3.branching,
  PART3.mapped,
  PART3.loop,
  PART3.loopExhausted,
];

/** A harness carrying the Part 3 agents and workflows. */
export function buildPart3Runtime(
  options: TestWorkflowRuntimeOptions = {},
): TestWorkflowRuntime {
  return buildTestWorkflowRuntime({
    workflows: PART3_WORKFLOWS,
    agents: PART3_AGENTS,
    ...options,
  });
}

// ── Part 4 fixtures: parallel branches and joins ────────────────────────────

/**
 * The shape every join in this suite merges to, and the shape the workflows
 * themselves output.
 *
 * `branches` is a `jsonObject` rather than a declared per-branch shape, so the
 * validated value KEEPS ITS KEY ORDER — `object()` re-emits keys in its own
 * shape's declaration order, which would hide the very ordering the merge-order
 * test is asserting on. The name arrays carry the order regardless, and the
 * tests check both.
 */
export const mergeShape = object({
  branches: jsonObject(),
  completedBranches: arrayOf(str({ minLength: 1, maxLength: 64 })),
  failedBranches: arrayOf(str({ minLength: 1, maxLength: 64 })),
  cancelledBranches: arrayOf(str({ minLength: 1, maxLength: 64 })),
});

/** A merge contract nothing can satisfy. Drives the invalid-merge path. */
export const impossibleMergeShape = object({
  branches: jsonObject(),
  completedBranches: arrayOf(str({ minLength: 1, maxLength: 64 }), { minItems: 99 }),
});

export function branchNode(nodeId: string, agentId: string): WorkflowAgentNode {
  return {
    ...node({ nodeId, agentId, displayName: `Branch step ${nodeId}` }),
    outputContract: executionContracts.output,
  };
}

/** A branch node with NO output contract, so it contributes nothing to a merge. */
export function silentBranchNode(nodeId: string, agentId: string): WorkflowAgentNode {
  return node({ nodeId, agentId, displayName: `Silent branch step ${nodeId}` });
}

export function parallelNode(
  nodeId: string,
  branches: readonly (readonly [string, string])[],
  joinNodeId: string,
  failurePolicy: WorkflowParallelFailurePolicy,
  overrides: Partial<WorkflowParallelNode> = {},
): WorkflowParallelNode {
  return {
    kind: 'parallel',
    nodeId,
    displayName: `Fan out ${nodeId}`,
    branches: branches.map(([branchName, startNodeId]) => ({ branchName, startNodeId })),
    joinNodeId,
    failurePolicy,
    ...overrides,
  } as WorkflowParallelNode;
}

export function joinNode(
  nodeId: string,
  policy: WorkflowJoinPolicy,
  mergeContract: Validator<unknown> = mergeShape,
): WorkflowJoinNode {
  return {
    kind: 'join',
    nodeId,
    displayName: `Join ${nodeId}`,
    policy,
    mergeContract,
  } as WorkflowJoinNode;
}

export function branchEdge(from: string, to: string, branch: string): WorkflowEdge {
  return { from, to, branch };
}

/**
 * The canonical Part 4 shape: `fan` opens two branches, each one agent node,
 * both converging on `gate`.
 *
 * Deliberately the smallest graph that can exhibit every policy, so a failing
 * assertion about a join says something about the join rather than about the
 * three other things a richer fixture would also be doing.
 */
function twoBranchWorkflow(
  workflowId: string,
  options: {
    readonly policy: WorkflowJoinPolicy;
    readonly failurePolicy: WorkflowParallelFailurePolicy;
    readonly leftAgent?: string;
    readonly rightAgent?: string;
    readonly mergeContract?: Validator<unknown>;
  },
): WorkflowDefinition {
  return {
    workflowId,
    displayName: `Part 4 fixture ${workflowId}`,
    purpose: 'Exercise bounded fan-out, joins and merge policy.',
    description: 'A deterministic fixture used by the AI-01 Batch 3B Part 4 suites.',
    owner: 'MARQ Platform Engineering — test fixtures',
    version: '1.0.0',
    enabled: true,
    certification: 'certified',
    nodes: [
      parallelNode(
        'fan',
        [
          ['left', 'left_step'],
          ['right', 'right_step'],
        ],
        'gate',
        options.failurePolicy,
      ),
      branchNode('left_step', options.leftAgent ?? WF_AGENT.alpha),
      branchNode('right_step', options.rightAgent ?? WF_AGENT.beta),
      joinNode('gate', options.policy, options.mergeContract ?? mergeShape),
    ],
    edges: [
      branchEdge('fan', 'left_step', 'left'),
      branchEdge('fan', 'right_step', 'right'),
      edge('left_step', 'gate'),
      edge('right_step', 'gate'),
    ],
    startNodeId: 'fan',
    inputContract: executionContracts.input,
    outputContract: mergeShape,
  } as WorkflowDefinition;
}

export const PART4 = {
  /** Both branches complete. The happy path for every join policy. */
  allJoin: twoBranchWorkflow('workflow.p4.all', {
    policy: { kind: 'all' },
    failurePolicy: 'wait_all',
  }),

  /** `any` under fail_fast: the first completion fires the join. */
  anyJoin: twoBranchWorkflow('workflow.p4.any', {
    policy: { kind: 'any' },
    failurePolicy: 'minimum_successes',
    rightAgent: WF_AGENT.failing,
  }),

  /**
   * One success is enough, and the branch that fails is the FIRST one.
   *
   * Ordinal order matters to what this proves: `left` fails before `right` has
   * started, so the group has to decline to give up — the minimum is still
   * reachable — and then fire when `right` succeeds.
   */
  minimumJoin: twoBranchWorkflow('workflow.p4.minimum', {
    policy: { kind: 'minimum_successes', minimum: 1 },
    failurePolicy: 'minimum_successes',
    leftAgent: WF_AGENT.failing,
  }),

  /** `right` is required; `left` fails and is allowed to. */
  namedJoin: twoBranchWorkflow('workflow.p4.named', {
    policy: { kind: 'named_required_branches', required: ['right'] },
    failurePolicy: 'minimum_successes',
    leftAgent: WF_AGENT.failing,
  }),

  /** The required branch is the one that fails. The join can never be met. */
  namedJoinMissing: twoBranchWorkflow('workflow.p4.named_missing', {
    policy: { kind: 'named_required_branches', required: ['left'] },
    failurePolicy: 'minimum_successes',
    leftAgent: WF_AGENT.failing,
  }),

  /** The first branch failure ends the group. */
  failFast: twoBranchWorkflow('workflow.p4.fail_fast', {
    policy: { kind: 'all' },
    failurePolicy: 'fail_fast',
    leftAgent: WF_AGENT.failing,
  }),

  /** A failing branch under wait_all: the sibling still runs to completion. */
  waitAll: twoBranchWorkflow('workflow.p4.wait_all', {
    policy: { kind: 'minimum_successes', minimum: 1 },
    failurePolicy: 'wait_all',
    leftAgent: WF_AGENT.failing,
  }),

  /** Both branches complete and the merge contract still refuses the result. */
  badMerge: twoBranchWorkflow('workflow.p4.bad_merge', {
    policy: { kind: 'all' },
    failurePolicy: 'wait_all',
    mergeContract: impossibleMergeShape,
  }),

  /** `right` blocks on an approval nobody gives; `left` completes. */
  blockedBranch: twoBranchWorkflow('workflow.p4.blocked', {
    policy: { kind: 'any' },
    failurePolicy: 'wait_all',
    rightAgent: WF_AGENT.blocking,
  }),

  /**
   * A branch with a two-node body, so the BRANCH-LOCAL CURSOR has somewhere to
   * move. Both branches also run a node with the same id shape, which is what
   * makes branch-local outputs testable rather than merely asserted.
   */
  multiNode: {
    workflowId: 'workflow.p4.multi_node',
    displayName: 'Part 4 fixture workflow.p4.multi_node',
    purpose: 'Exercise a branch-local cursor across more than one node.',
    description: 'A deterministic fixture used by the AI-01 Batch 3B Part 4 suites.',
    owner: 'MARQ Platform Engineering — test fixtures',
    version: '1.0.0',
    enabled: true,
    certification: 'certified',
    nodes: [
      parallelNode(
        'fan',
        [
          ['left', 'left_one'],
          ['right', 'right_one'],
        ],
        'gate',
        'wait_all',
      ),
      branchNode('left_one', WF_AGENT.alpha),
      branchNode('left_two', WF_AGENT.gamma),
      branchNode('right_one', WF_AGENT.beta),
      joinNode('gate', { kind: 'all' }),
      { ...node({ nodeId: 'after', agentId: WF_AGENT.alpha }), outputContract: executionContracts.output },
    ],
    edges: [
      branchEdge('fan', 'left_one', 'left'),
      branchEdge('fan', 'right_one', 'right'),
      edge('left_one', 'left_two'),
      edge('left_two', 'gate'),
      edge('right_one', 'gate'),
      edge('gate', 'after'),
    ],
    startNodeId: 'fan',
    inputContract: executionContracts.input,
    outputContract: executionContracts.output,
  } as WorkflowDefinition,

  /** A branch whose terminal node stores nothing trusted. It contributes none. */
  silentBranch: {
    ...twoBranchWorkflow('workflow.p4.silent', {
      policy: { kind: 'all' },
      failurePolicy: 'wait_all',
    }),
    nodes: [
      parallelNode(
        'fan',
        [
          ['left', 'left_step'],
          ['right', 'right_step'],
        ],
        'gate',
        'wait_all',
      ),
      branchNode('left_step', WF_AGENT.alpha),
      silentBranchNode('right_step', WF_AGENT.beta),
      joinNode('gate', { kind: 'all' }),
    ],
  } as WorkflowDefinition,
} as const;

export const PART4_WORKFLOWS: readonly WorkflowDefinition[] = [
  PART4.allJoin,
  PART4.anyJoin,
  PART4.minimumJoin,
  PART4.namedJoin,
  PART4.namedJoinMissing,
  PART4.failFast,
  PART4.waitAll,
  PART4.badMerge,
  PART4.blockedBranch,
  PART4.multiNode,
  PART4.silentBranch,
];

/**
 * A fan-out of `count` branches, built programmatically.
 *
 * Used to prove the ceiling is enforced rather than documented: the same
 * builder produces a definition the registry accepts at the ceiling and refuses
 * one branch above it.
 */
export function wideParallelWorkflow(
  count: number,
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  const branches = Array.from({ length: count }, (_, index) => [
    `b${index}`,
    `b${index}_step`,
  ] as const);

  return {
    workflowId: `workflow.p4.wide${count}`,
    displayName: `Part 4 wide fixture (${count})`,
    purpose: 'Exercise the fan-out ceiling.',
    description: 'A deterministic fixture used by the AI-01 Batch 3B Part 4 suites.',
    owner: 'MARQ Platform Engineering — test fixtures',
    version: '1.0.0',
    enabled: true,
    certification: 'certified',
    nodes: [
      parallelNode('fan', branches, 'gate', 'wait_all'),
      ...branches.map(([, startNodeId]) => branchNode(startNodeId, WF_AGENT.alpha)),
      joinNode('gate', { kind: 'all' }),
    ],
    edges: [
      ...branches.map(([branchName, startNodeId]) => branchEdge('fan', startNodeId, branchName)),
      ...branches.map(([, startNodeId]) => edge(startNodeId, 'gate')),
    ],
    startNodeId: 'fan',
    inputContract: executionContracts.input,
    outputContract: mergeShape,
    ...overrides,
  } as WorkflowDefinition;
}

/** A harness carrying the Part 4 workflows over the Part 2 agents. */
export function buildPart4Runtime(
  options: TestWorkflowRuntimeOptions = {},
): TestWorkflowRuntime {
  return buildTestWorkflowRuntime({
    workflows: PART4_WORKFLOWS,
    agents: WORKFLOW_NODE_AGENTS,
    ...options,
  });
}
