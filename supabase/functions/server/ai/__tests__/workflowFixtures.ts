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
  WorkflowApprovalNode,
  WorkflowConditionNode,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowJoinNode,
  WorkflowNode,
  WorkflowParallelNode,
} from '../workflows/contracts/workflow.ts';
import type {
  WorkflowJoinPolicy,
  WorkflowParallelFailurePolicy,
} from '../workflows/contracts/parallel.ts';
import type { WorkflowExpression } from '../workflows/contracts/expression.ts';
import type { WorkflowMapping } from '../workflows/contracts/mapping.ts';
import type {
  WorkflowApprovalStore,
  WorkflowCheckpointStore,
} from '../workflows/persistence/ports.ts';
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
  createMemoryWorkflowApprovalStore,
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
  /** Shared across two runtimes to simulate an isolate restart, like the others. */
  readonly approvalStore: WorkflowApprovalStore;
  meta(token: string): { authorization: string; correlationId: string };
}

export interface TestWorkflowRuntimeOptions {
  readonly workflows?: readonly WorkflowDefinition[];
  readonly agents?: readonly AgentDefinition[];
  readonly checkpointStore?: WorkflowCheckpointStore;
  readonly approvalStore?: WorkflowApprovalStore;
  readonly clock?: MutableClock;
  /** Share a store across two runtimes to simulate an isolate restart. */
  readonly runStore?: WorkflowRunStore;
  readonly agentRunStore?: TestAgentRuntimeOptions['runStore'];
  readonly agentCheckpointStore?: TestAgentRuntimeOptions['checkpointStore'];
  readonly agentApprovalStore?: TestAgentRuntimeOptions['approvalStore'];
  /** Wrap the real agent port. Crash and blocking simulations only. */
  readonly wrapAgentPort?: (port: WorkflowAgentPort) => WorkflowAgentPort;
  readonly requireCertifiedWorkflows?: () => boolean;
  /**
   * Distinguishes the identifiers TWO runtimes over ONE store may mint.
   *
   * See `TestAgentRuntimeOptions.idSeed` — the same problem, and it reaches the
   * workflow ids too: a restart test that shares a run store needs the second
   * isolate to mint ids the first one did not, exactly as a real one does.
   */
  readonly idSeed?: string;
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
    ...(options.idSeed === undefined ? {} : { idSeed: options.idSeed }),
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
  const approvalStore = options.approvalStore ?? createMemoryWorkflowApprovalStore();
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
    approvalStore,
    clock,
    ids: createSequentialIdFactory(`wf${options.idSeed ?? ''}`),
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
    approvalStore,
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

// ── Part 5 fixtures: approvals and retries ──────────────────────────────────

/**
 * THE APPROVER ROLES EVERY PART 5 FIXTURE USES.
 *
 * `owner` and `reviewer`, and NOT `consultant`. That pairing is what makes the
 * authorization tests mean something: `consultant` is a full workflow operator
 * (it starts runs and controls them) and still may not answer an approval, so a
 * refusal proves the gate consulted the NODE's roles rather than the caller's
 * general standing.
 */
export const APPROVER_ROLES: readonly string[] = ['owner', 'reviewer'];

export function approvalNode(
  nodeId: string,
  overrides: Partial<WorkflowApprovalNode> = {},
): WorkflowApprovalNode {
  return {
    kind: 'approval',
    nodeId,
    displayName: `Approve ${nodeId}`,
    approverRoles: APPROVER_ROLES,
    reason: 'A person must confirm this workflow may continue.',
    impactSummary: 'Continuing runs the remaining steps of this workflow.',
    expiresAfterMs: 3_600_000,
    onRejection: 'fail',
    estimatedAdditionalTokens: 1_200,
    estimatedAdditionalCostMicroUsd: 3_400,
    ...overrides,
  } as WorkflowApprovalNode;
}

function part5Workflow(
  workflowId: string,
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  startNodeId: string,
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  return {
    workflowId,
    displayName: `Part 5 fixture ${workflowId}`,
    purpose: 'Exercise approvals, retries and their durable records.',
    description: 'A deterministic fixture used by the AI-01 Batch 3B Part 5 suites.',
    owner: 'MARQ Platform Engineering — test fixtures',
    version: '1.0.0',
    enabled: true,
    certification: 'certified',
    nodes,
    edges,
    startNodeId,
    inputContract: executionContracts.input,
    outputContract: executionContracts.output,
    ...overrides,
  } as WorkflowDefinition;
}

const contractedNode = (nodeId: string, agentId: string): WorkflowAgentNode => ({
  ...node({ nodeId, agentId, displayName: `Node ${nodeId}` }),
  outputContract: executionContracts.output,
});

/**
 * A node that may be attempted `maxAttempts` times, with a declared backoff.
 *
 * `WF5_AGENT.flaky` is the agent every retry fixture names — see
 * `flakyAgentPort` for how a transient failure is produced without inventing an
 * agent that fails on a timer.
 */
function retryingNode(
  nodeId: string,
  options: {
    readonly agentId?: string;
    readonly maxAttempts: number;
    readonly retryPolicy?: WorkflowAgentNode['retryPolicy'];
  },
): WorkflowAgentNode {
  return {
    ...node({
      nodeId,
      agentId: options.agentId ?? WF5_AGENT.flaky,
      displayName: `Node ${nodeId}`,
      maxAttempts: options.maxAttempts,
    }),
    outputContract: executionContracts.output,
    ...(options.retryPolicy === undefined ? {} : { retryPolicy: options.retryPolicy }),
  };
}

export const WF5_AGENT = {
  /**
   * Completes normally. The port wrapper is what makes it fail transiently, so
   * the agent itself stays the dullest thing that can exist — see
   * `workflowNodePropose` above for why every fixture agent is.
   */
  flaky: 'agent.wf.flaky',
} as const;

export const PART5_AGENTS: readonly AgentDefinition[] = [
  ...WORKFLOW_NODE_AGENTS,
  workflowNodeAgent(WF5_AGENT.flaky),
];

export const PART5 = {
  /** approve → work. The smallest workflow with a barrier in it. */
  approval: part5Workflow(
    'workflow.p5.approval',
    [approvalNode('gate'), contractedNode('work', WF_AGENT.alpha)],
    [edge('gate', 'work')],
    'gate',
  ),

  /** work → approve → more. A barrier reached after a checkpoint exists. */
  approvalMidway: part5Workflow(
    'workflow.p5.approval_midway',
    [
      contractedNode('first', WF_AGENT.alpha),
      approvalNode('gate'),
      contractedNode('second', WF_AGENT.beta),
    ],
    [edge('first', 'gate'), edge('gate', 'second')],
    'first',
  ),

  /** The same barrier, declaring that a refusal CANCELS rather than fails. */
  approvalCancels: part5Workflow(
    'workflow.p5.approval_cancels',
    [
      approvalNode('gate', { onRejection: 'cancel' }),
      contractedNode('work', WF_AGENT.alpha),
    ],
    [edge('gate', 'work')],
    'gate',
  ),

  /** A barrier only `owner` may answer. For the role-scoping assertions. */
  approvalOwnerOnly: part5Workflow(
    'workflow.p5.approval_owner',
    [
      approvalNode('gate', { approverRoles: ['owner'] }),
      contractedNode('work', WF_AGENT.alpha),
    ],
    [edge('gate', 'work')],
    'gate',
  ),

  /** A barrier with a one-minute window, so expiry is reachable on a test clock. */
  approvalShort: part5Workflow(
    'workflow.p5.approval_short',
    [
      approvalNode('gate', { expiresAfterMs: 60_000 }),
      contractedNode('work', WF_AGENT.alpha),
    ],
    [edge('gate', 'work')],
    'gate',
  ),

  /**
   * A fan-out where ONE branch stops for a person and the other does not.
   *
   * The shape the "a parallel branch waits safely" claim needs: if the sibling
   * cannot finish while `left` is parked, the claim is false, and this is the
   * smallest graph that can show it either way.
   */
  branchApproval: part5Workflow(
    'workflow.p5.branch_approval',
    [
      parallelNode(
        'fan',
        [
          ['left', 'left_gate'],
          ['right', 'right_step'],
        ],
        'gate',
        'wait_all',
      ),
      approvalNode('left_gate'),
      branchNode('left_step', WF_AGENT.alpha),
      branchNode('right_step', WF_AGENT.beta),
      joinNode('gate', { kind: 'all' }),
    ],
    [
      branchEdge('fan', 'left_gate', 'left'),
      branchEdge('fan', 'right_step', 'right'),
      edge('left_gate', 'left_step'),
      edge('left_step', 'gate'),
      edge('right_step', 'gate'),
    ],
    'fan',
    { outputContract: mergeShape },
  ),

  /** One attempt only. A transient failure must NOT be retried. */
  retryOnce: part5Workflow(
    'workflow.p5.retry_once',
    [retryingNode('work', { maxAttempts: 1 })],
    [],
    'work',
  ),

  /** Three attempts, retried immediately. The plain retry path. */
  retryImmediate: part5Workflow(
    'workflow.p5.retry_immediate',
    [retryingNode('work', { maxAttempts: 3 })],
    [],
    'work',
  ),

  /** Three attempts with a thirty-second fixed delay between them. */
  retryDelayed: part5Workflow(
    'workflow.p5.retry_delayed',
    [
      retryingNode('work', {
        maxAttempts: 3,
        retryPolicy: { backoff: 'fixed_delay', delayMs: 30_000 },
      }),
    ],
    [],
    'work',
  ),

  /** Two attempts, exponential. For the persisted backoff metadata. */
  retryExponential: part5Workflow(
    'workflow.p5.retry_exponential',
    [
      retryingNode('work', {
        maxAttempts: 3,
        retryPolicy: { backoff: 'exponential', delayMs: 10_000, maxDelayMs: 60_000 },
      }),
    ],
    [],
    'work',
  ),

  /** A retryable node followed by another node, so a recovered run has somewhere to go. */
  retryThenContinue: part5Workflow(
    'workflow.p5.retry_then_continue',
    [
      retryingNode('work', { maxAttempts: 3 }),
      contractedNode('after', WF_AGENT.beta),
    ],
    [edge('work', 'after')],
    'work',
  ),

  /**
   * Both branches run a retryable node, so "one branch's retry did not touch
   * its sibling's count" is a claim about two live counters rather than about
   * one counter and an absence.
   */
  branchRetry: part5Workflow(
    'workflow.p5.branch_retry',
    [
      parallelNode(
        'fan',
        [
          ['left', 'left_step'],
          ['right', 'right_step'],
        ],
        'gate',
        'wait_all',
      ),
      retryingNode('left_step', { maxAttempts: 3 }),
      retryingNode('right_step', { maxAttempts: 3 }),
      joinNode('gate', { kind: 'all' }),
    ],
    [
      branchEdge('fan', 'left_step', 'left'),
      branchEdge('fan', 'right_step', 'right'),
      edge('left_step', 'gate'),
      edge('right_step', 'gate'),
    ],
    'fan',
    { outputContract: mergeShape },
  ),
} as const;

export const PART5_WORKFLOWS: readonly WorkflowDefinition[] = [
  PART5.approval,
  PART5.approvalMidway,
  PART5.approvalCancels,
  PART5.approvalOwnerOnly,
  PART5.approvalShort,
  PART5.branchApproval,
  PART5.retryOnce,
  PART5.retryImmediate,
  PART5.retryDelayed,
  PART5.retryExponential,
  PART5.retryThenContinue,
  PART5.branchRetry,
];

/** What one `flakyAgentPort` was asked to do, so a test can count real calls. */
export interface FlakyPortLog {
  /** Child agent run ids created, in order. Duplicates would be the defect. */
  readonly created: string[];
  /** Child agent run ids driven, in order. One id twice after it failed is the defect. */
  readonly driven: string[];
  /** How many child runs the port failed on purpose. */
  failures: number;
}

/**
 * Wrap the REAL agent port so a designated agent's child runs fail with a
 * TYPED, RETRYABLE failure for the first `failures` attempts.
 *
 * WHY A PORT WRAPPER AND NOT AN AGENT. A workflow node retry is a judgement
 * about `AgentNodeHandle.failure` — a transient provider or model failure —
 * and the fixture agents reach `failed` through the `fail` ACTION, which
 * deliberately carries no failure code at all (an agent declaring it cannot
 * continue is not a runtime failure). Producing a genuine `provider_unavailable`
 * would mean driving the control plane into a real outage from inside a
 * workflow fixture, which would make every assertion here a statement about the
 * provider layer instead of about the engine.
 *
 * `create` and `cancel` pass straight through to the real port, so the child
 * runs counted below are REAL agent runs created through the real orchestrator.
 * Only the drive RESULT is substituted, and only for the named agent.
 */
export function flakyAgentPort(options: {
  readonly agentId: string;
  readonly failures: number;
  readonly childFailure?: string;
  readonly log: FlakyPortLog;
}): (port: WorkflowAgentPort) => WorkflowAgentPort {
  return (port) => {
    const failingRuns = new Set<string>();
    let remaining = options.failures;

    return {
      async create(input) {
        const handle = await port.create(input);
        options.log.created.push(handle.agentRunId);
        if (input.agentId === options.agentId && remaining > 0) {
          remaining -= 1;
          failingRuns.add(handle.agentRunId);
        }
        return handle;
      },

      async drive(input) {
        options.log.driven.push(input.agentRunId);
        if (!failingRuns.has(input.agentRunId)) return port.drive(input);
        options.log.failures += 1;
        return {
          agentRunId: input.agentRunId,
          state: 'failed',
          childState: 'failed',
          failure: options.childFailure ?? 'provider_unavailable',
          failureMessage: 'The model provider was unavailable.',
        };
      },

      cancel: (input) => port.cancel(input),
    };
  };
}

export function emptyFlakyLog(): FlakyPortLog {
  return { created: [], driven: [], failures: 0 };
}

// ── Part 6A fixture: a port that reports spend ──────────────────────────────

/**
 * Wrap the REAL agent port so every child run reports a fixed CUMULATIVE spend.
 *
 * WHY A PORT WRAPPER AND NOT A SPENDING AGENT. The fixture agents make no model
 * calls — deliberately, so a workflow assertion is about the workflow — which
 * means their real ledgers are all zero. Producing genuine spend would mean
 * driving the control plane into real provider traffic from inside a workflow
 * fixture, and every accounting assertion would then be a statement about the
 * provider layer instead of about attribution.
 *
 * The figures are CUMULATIVE per child run, exactly as the real port reports
 * them, and each child reports the same totals however many times it is
 * observed. That is precisely the shape the idempotency claim needs: if the fold
 * ever added on a second observation, this fixture would show it as a doubled
 * total rather than hiding it behind a growing number.
 */
export function meteredAgentPort(perChild: {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMicroUsd: number;
}): (port: WorkflowAgentPort) => WorkflowAgentPort {
  const usage = {
    inputTokens: perChild.inputTokens,
    outputTokens: perChild.outputTokens,
    totalTokens: perChild.inputTokens + perChild.outputTokens,
    costMicroUsd: perChild.costMicroUsd,
  };
  const meter = (handle: Awaited<ReturnType<WorkflowAgentPort['drive']>>) => ({
    ...handle,
    usage,
  });
  return (port) => ({
    create: (input) => port.create(input),
    drive: async (input) => meter(await port.drive(input)),
    cancel: (input) => port.cancel(input),
  });
}

/**
 * The same, but the named agent's children fail transiently AND still report
 * spend.
 *
 * A retry that reported nothing would make "retries are counted as actual
 * spend" untestable — the failing attempt has to have cost something for the
 * ledger to be able to get it wrong.
 */
export function meteredFlakyAgentPort(options: {
  readonly agentId: string;
  readonly failures: number;
  readonly log: FlakyPortLog;
  readonly perChild: { readonly inputTokens: number; readonly outputTokens: number; readonly costMicroUsd: number };
}): (port: WorkflowAgentPort) => WorkflowAgentPort {
  const flaky = flakyAgentPort({
    agentId: options.agentId,
    failures: options.failures,
    log: options.log,
  });
  return (port) => meteredAgentPort(options.perChild)(flaky(port));
}

/** A harness carrying the Part 5 workflows and agents. */
export function buildPart5Runtime(
  options: TestWorkflowRuntimeOptions = {},
): TestWorkflowRuntime {
  return buildTestWorkflowRuntime({
    workflows: PART5_WORKFLOWS,
    agents: PART5_AGENTS,
    ...options,
  });
}
