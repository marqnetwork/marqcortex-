/**
 * Deterministic workflow fixtures and harness (AI-01 Batch 3B).
 *
 * Builds a REAL workflow engine — the same `createWorkflowRuntime` production uses
 * — over a REAL agent runtime over a REAL control plane, with every
 * non-deterministic dependency replaced: a hand-driven clock, sequential ids, an
 * in-memory log sink and the mock provider. Nothing on the path under test is
 * stubbed. The registry, the planner, the state machine, the orchestrator, the
 * optimizer, the router, the cost engine, the cache, the approval gate, the
 * checkpoint store and the HTTP adapter are all production implementations.
 *
 * THE WORKFLOWS HERE ARE FIXTURES, NOT PRODUCTS. AI-01 Batch 3B ships no business
 * workflow, and the production registry starts empty. These exist so the engine's
 * guarantees can be exercised: one that completes sequentially, one that branches,
 * one that fans out and joins, one that waits for a human, one that reaches for a
 * tool it was never granted. Each is data, so a test asserts on the
 * ORCHESTRATOR's decisions rather than on a model's mood.
 */

import type { AgentDefinition } from '../agents/contracts/agent.ts';
import type { AgentRuntime } from '../agents/agentRuntime.ts';
import type { AIControlPlane } from '../controlPlane.ts';
import type { MutableClock } from '../runtime/clock.ts';
import type { AIAuthenticator } from '../security/actor.ts';
import type { WorkflowRuntime } from '../workflows/workflowRuntime.ts';
import type {
  WorkflowContextDeclaration,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowLimits,
  WorkflowNode,
} from '../workflows/contracts/workflow.ts';
import type { WorkflowCachePort } from '../workflows/runtime/cache.ts';
import type {
  WorkflowApprovalStore,
  WorkflowCheckpointStore,
  WorkflowRunStore,
} from '../workflows/persistence/ports.ts';

import { createAgentRuntime } from '../agents/agentRuntime.ts';
import { createWorkflowRuntime } from '../workflows/workflowRuntime.ts';
import { createControlPlane } from '../controlPlane.ts';
import { loadControlPlaneConfig } from '../runtime/config.ts';
import { recordEnv } from '../runtime/env.ts';
import { createTestClock } from '../runtime/clock.ts';
import { createSequentialIdFactory } from '../contracts/ids.ts';
import { createMemorySink } from '../observability/logger.ts';
import { createMockProvider } from '../providers/mockProvider.ts';
import { DETERMINISTIC_TOOLS, DETERMINISTIC_TOOL_IDS } from '../agents/tools/mockTools.ts';
import { AGENT_MODEL_PROFILE } from '../agents/runtime/defaultProfiles.ts';
import { PREDICATE } from '../workflows/runtime/predicates.ts';
import { TRANSFORM } from '../workflows/runtime/transforms.ts';
import { arrayOf, object, optional, str, withDefault } from '../security/validation.ts';
import { agentAuthenticator, AGENT_TOKEN, FIXTURE_AGENTS, AGENT_ID } from './agentFixtures.ts';

// Identities are shared with the agent fixtures deliberately: the workflow RBAC
// table and the agent RBAC table grant different capabilities to the SAME roles,
// and a test that used a second set of subjects could not catch a disagreement.
export { AGENT_TOKEN as WORKFLOW_TOKEN, bearer } from './agentFixtures.ts';

const OWNER = 'MARQ Platform Engineering — test fixtures';

// ── Contracts ───────────────────────────────────────────────────────────────

const workflowInput = object({
  topic: str({ minLength: 1, maxLength: 200 }),
  /** Drives which branch a condition takes. Never reaches a model. */
  route: withDefault(str({ maxLength: 40 }), 'primary'),
  detail: optional(str({ maxLength: 4_000 })),
});

const workflowOutput = object({
  finding: str({ minLength: 1, maxLength: 4_000 }),
});

const joinOutput = object({
  finding: str({ minLength: 1, maxLength: 4_000 }),
});

export const WORKFLOW_ID = {
  sequential: 'workflow.test.sequential',
  conditional: 'workflow.test.conditional',
  parallelAll: 'workflow.test.parallel_all',
  parallelAny: 'workflow.test.parallel_any',
  parallelMinimum: 'workflow.test.parallel_minimum',
  approval: 'workflow.test.approval',
  agentDriven: 'workflow.test.agent',
  toolDriven: 'workflow.test.tool',
  cached: 'workflow.test.cached',
  waiting: 'workflow.test.waiting',
  optionalSkip: 'workflow.test.optional',
  disabled: 'workflow.test.disabled',
  uncertified: 'workflow.test.uncertified',
} as const;

export const FIXTURE_LIMITS: WorkflowLimits = {
  maxTotalSteps: 32,
  maxParallelBranches: 4,
  maxBranchDepth: 2,
  maxRetries: 4,
  maxHandoffs: 4,
  maxRuntimeMs: 300_000,
  maxPromptTokens: 200_000,
  maxCompletionTokens: 40_000,
  maxTotalTokens: 240_000,
  maxEstimatedCostMicroUsd: 900_000,
  maxActualCostMicroUsd: 900_000,
};

export const FIXTURE_APPROVAL = {
  approverRoles: ['owner', 'admin', 'reviewer'],
  expiresAfterMs: 3_600_000,
  impactSummary: 'Confirm the finding before the workflow records it.',
  dataAffected: ['finding'],
};

// ── Node builders ───────────────────────────────────────────────────────────
//
// Small helpers rather than hand-written literals: a fixture graph is 8–14 nodes
// and every node carries fifteen fields, so written out longhand the interesting
// difference between two fixtures would be invisible.

function base(nodeId: string, purpose: string) {
  return {
    nodeId,
    purpose,
    inputMapping: {},
    outputMapping: {},
    requiredCapabilities: [],
    timeoutMs: 30_000,
    retry: { maxAttempts: 0, backoffMs: 0 },
    tokenAllowance: 0,
    costAllowanceMicroUsd: 0,
    idempotency: 'replayable' as const,
    onFailure: 'fail_workflow' as const,
    optional: false,
  };
}

export function contextSection(
  overrides: Partial<WorkflowContextDeclaration> & { sectionId: string; source: string },
): WorkflowContextDeclaration {
  return {
    authority: 'retrieved_evidence',
    relevanceReason: 'the node reasons over this value',
    required: true,
    maxTokens: 2_000,
    maxAgeMs: 0,
    sensitivity: 'tenant',
    tenantScope: 'run_organization',
    priority: 50,
    ...overrides,
  };
}

export function modelNode(
  nodeId: string,
  overrides: Partial<Extract<WorkflowNode, { nodeType: 'model' }>> = {},
): WorkflowNode {
  return {
    ...base(nodeId, `Reason about the topic at ${nodeId}.`),
    nodeType: 'model',
    modelProfileId: AGENT_MODEL_PROFILE.standard,
    objective: 'Produce a finding for the supplied topic.',
    context: [contextSection({ sectionId: 'topic', source: 'input.topic' })],
    // The platform's agent-step feature returns `{ result, summary }` and the
    // orchestrator unwraps `result`, so a node's declared output fields are the keys
    // INSIDE that object. `finding` is what the deterministic mock provider emits.
    requiredOutputFields: ['finding'],
    minimumQuality: 'standard',
    cacheable: false,
    cacheTtlMs: 0,
    tokenAllowance: 8_000,
    costAllowanceMicroUsd: 200_000,
    outputMapping: { finding: 'finding' },
    ...overrides,
  } as WorkflowNode;
}

export function transformNode(
  nodeId: string,
  overrides: Partial<Extract<WorkflowNode, { nodeType: 'transform' }>> = {},
): WorkflowNode {
  return {
    ...base(nodeId, `Normalize the topic at ${nodeId}.`),
    nodeType: 'transform',
    transformId: TRANSFORM.normalizeText,
    transformArguments: {},
    avoidsModelCall: false,
    inputMapping: { text: 'input.topic' },
    outputMapping: { normalized: 'text' },
    ...overrides,
  } as WorkflowNode;
}

export function conditionNode(
  nodeId: string,
  overrides: Partial<Extract<WorkflowNode, { nodeType: 'condition' }>> = {},
): WorkflowNode {
  return {
    ...base(nodeId, `Decide the route at ${nodeId}.`),
    nodeType: 'condition',
    predicateId: PREDICATE.equalsString,
    predicateArguments: { path: 'input.route', expected: 'primary' },
    ...overrides,
  } as WorkflowNode;
}

export function completeNode(
  nodeId = 'finish',
  overrides: Partial<Extract<WorkflowNode, { nodeType: 'complete' }>> = {},
): WorkflowNode {
  return {
    ...base(nodeId, 'Accept the run output.'),
    nodeType: 'complete',
    inputMapping: { finding: 'values.finding' },
    ...overrides,
  } as WorkflowNode;
}

export function failNode(
  nodeId = 'stop',
  overrides: Partial<Extract<WorkflowNode, { nodeType: 'fail' }>> = {},
): WorkflowNode {
  return {
    ...base(nodeId, 'Stop the run.'),
    nodeType: 'fail',
    failureReason: 'the declared failure path was taken',
    ...overrides,
  } as WorkflowNode;
}

export function edge(
  edgeId: string,
  from: string,
  to: string,
  kind: WorkflowEdge['kind'] = 'always',
  branchId?: string,
): WorkflowEdge {
  return {
    edgeId,
    from,
    to,
    kind,
    ...(branchId === undefined ? {} : { branchId }),
  };
}

function definitionBase(workflowId: string) {
  return {
    workflowId,
    name: `Test workflow ${workflowId}`,
    description: 'A deterministic fixture workflow used by the AI-01 Batch 3B suites.',
    owner: OWNER,
    version: '1.0.0',
    enabled: true,
    certification: 'certified' as const,
    safetyClass: 'tenant_readonly' as const,
    inputContract: workflowInput,
    outputContract: workflowOutput,
    allowedAgents: [AGENT_ID.primary, AGENT_ID.reviewer],
    allowedTools: [DETERMINISTIC_TOOL_IDS.summarize, DETERMINISTIC_TOOL_IDS.recordNote],
    allowedModelProfiles: [AGENT_MODEL_PROFILE.standard, AGENT_MODEL_PROFILE.compact],
    limits: FIXTURE_LIMITS,
    completion: { requiredOutputFields: ['finding'], requireApproval: false },
    failurePolicy: 'fail_fast' as const,
  };
}

// ── The fixture workflows ───────────────────────────────────────────────────

/** transform → model → complete. The simplest complete path. */
export const sequentialWorkflow: WorkflowDefinition = {
  ...definitionBase(WORKFLOW_ID.sequential),
  initialNodeId: 'normalize',
  nodes: [
    transformNode('normalize'),
    modelNode('analyse'),
    completeNode(),
  ],
  edges: [
    edge('e1', 'normalize', 'analyse'),
    edge('e2', 'analyse', 'finish'),
  ],
};

/** A condition selecting between a model path and a deterministic path. */
export const conditionalWorkflow: WorkflowDefinition = {
  ...definitionBase(WORKFLOW_ID.conditional),
  initialNodeId: 'route',
  nodes: [
    conditionNode('route'),
    modelNode('deep'),
    transformNode('shallow', {
      transformId: TRANSFORM.classifyLength,
      inputMapping: { text: 'input.topic' },
      outputMapping: { finding: 'label' },
      // Deliberately claims to replace a model call, so the avoided-call ledger has
      // something priced against a named profile to assert on.
      avoidsModelCall: true,
      avoidedProfileId: AGENT_MODEL_PROFILE.compact,
      avoidedPromptTokens: 900,
      avoidedCompletionTokens: 300,
    }),
    completeNode(),
  ],
  edges: [
    edge('e1', 'route', 'deep', 'true'),
    edge('e2', 'route', 'shallow', 'false'),
    edge('e3', 'deep', 'finish'),
    edge('e4', 'shallow', 'finish'),
  ],
};

/** Build a fan-out fixture with a chosen join policy. */
export function fanOutWorkflow(options: {
  readonly workflowId: string;
  readonly policy: 'all' | 'any' | 'minimum_successes' | 'named_required_branches';
  readonly minimumSuccesses?: number;
  readonly requiredBranchIds?: readonly string[];
  readonly failurePolicy?: 'fail_fast' | 'wait_all';
  readonly onSatisfied?: 'cancel_remaining' | 'wait_all';
  /** Make one arm fail, so branch failure policy can be exercised. */
  readonly poisonBranch?: 'left' | 'right';
}): WorkflowDefinition {
  const poison = options.poisonBranch;
  return {
    ...definitionBase(options.workflowId),
    outputContract: joinOutput,
    initialNodeId: 'split',
    nodes: [
      {
        ...base('split', 'Fan out into two independent arms.'),
        nodeType: 'parallel',
        joinNodeId: 'converge',
      } as WorkflowNode,
      // Each arm writes through its own transform, so the join has two distinct
      // branch values to merge and the merge order can be asserted.
      transformNode('left_work', {
        transformId: TRANSFORM.normalizeText,
        inputMapping: { text: 'input.topic' },
        outputMapping: { left: 'text' },
        // A poisoned arm reads a path that resolves to nothing and asks a transform
        // that requires a string for it, which throws a typed node failure.
        ...(poison === 'left' ? { inputMapping: { text: 'values.never_set' } } : {}),
      }),
      transformNode('right_work', {
        transformId: TRANSFORM.classifyLength,
        outputMapping: { right: 'label' },
        // A poisoned arm reads a path that resolves to nothing and hands it to a
        // transform that requires a string, which raises a typed node failure — the
        // cheapest honest way to make one branch fail deterministically.
        inputMapping: poison === 'right' ? { text: 'values.never_set' } : { text: 'input.topic' },
      }),
      {
        ...base('converge', 'Join the two arms.'),
        nodeType: 'join',
        policy: options.policy,
        ...(options.minimumSuccesses === undefined
          ? {}
          : { minimumSuccesses: options.minimumSuccesses }),
        ...(options.requiredBranchIds === undefined
          ? {}
          : { requiredBranchIds: options.requiredBranchIds }),
        onSatisfied: options.onSatisfied ?? 'cancel_remaining',
        failurePolicy: options.failurePolicy ?? 'wait_all',
        outputMapping: { merged: 'merged' },
      } as WorkflowNode,
      transformNode('summarise', {
        transformId: TRANSFORM.stamp,
        inputMapping: {},
        outputMapping: { finding: 'nodeId' },
      }),
      completeNode(),
    ],
    edges: [
      edge('b1', 'split', 'left_work', 'branch', 'left'),
      edge('b2', 'split', 'right_work', 'branch', 'right'),
      edge('e1', 'left_work', 'converge'),
      edge('e2', 'right_work', 'converge'),
      edge('e3', 'converge', 'summarise'),
      edge('e4', 'summarise', 'finish'),
    ],
  };
}

export const parallelAllWorkflow = fanOutWorkflow({
  workflowId: WORKFLOW_ID.parallelAll,
  policy: 'all',
});

/**
 * Poisons the LEFT arm, which is the one the engine runs first.
 *
 * Poisoning the right arm would prove nothing about `any`: the left arm would
 * succeed, satisfy the join, and the right arm would be cancelled before it ever
 * failed. Failing first is what makes the join actually count a failure and then
 * wait for a success.
 */
export const parallelAnyWorkflow = fanOutWorkflow({
  workflowId: WORKFLOW_ID.parallelAny,
  policy: 'any',
  poisonBranch: 'left',
});

export const parallelMinimumWorkflow = fanOutWorkflow({
  workflowId: WORKFLOW_ID.parallelMinimum,
  policy: 'minimum_successes',
  minimumSuccesses: 1,
  poisonBranch: 'left',
});

/** An explicit approval node between two deterministic steps. */
export const approvalWorkflow: WorkflowDefinition = {
  ...definitionBase(WORKFLOW_ID.approval),
  initialNodeId: 'normalize',
  nodes: [
    transformNode('normalize', { outputMapping: { finding: 'text' } }),
    {
      ...base('sign_off', 'Ask a human to confirm the finding.'),
      nodeType: 'approval',
      approval: FIXTURE_APPROVAL,
    } as WorkflowNode,
    completeNode(),
  ],
  edges: [
    edge('e1', 'normalize', 'sign_off'),
    edge('e2', 'sign_off', 'finish'),
  ],
};

/** An agent node driving a certified Batch 3A agent run. */
export const agentWorkflow: WorkflowDefinition = {
  ...definitionBase(WORKFLOW_ID.agentDriven),
  initialNodeId: 'delegate',
  nodes: [
    {
      ...base('delegate', 'Delegate the analysis to a registered agent.'),
      nodeType: 'agent',
      agentId: AGENT_ID.primary,
      objective: 'Establish a deterministic finding for the supplied topic.',
      inputMapping: { topic: 'input.topic', script: 'input.route' },
      outputMapping: { finding: 'finding' },
      tokenAllowance: 40_000,
      costAllowanceMicroUsd: 400_000,
    } as WorkflowNode,
    completeNode(),
  ],
  edges: [edge('e1', 'delegate', 'finish')],
};

/** A tool node executing through the certified Batch 3A gateway. */
export const toolWorkflow: WorkflowDefinition = {
  ...definitionBase(WORKFLOW_ID.toolDriven),
  initialNodeId: 'summarise',
  nodes: [
    {
      ...base('summarise', 'Summarise the supplied statements deterministically.'),
      nodeType: 'tool',
      toolId: DETERMINISTIC_TOOL_IDS.summarize,
      inputMapping: { statements: 'input.statements' },
      // `longest` is a field the tool's own output schema declares, so the gateway
      // has already validated it by the time the mapping reads it.
      outputMapping: { finding: 'longest' },
    } as WorkflowNode,
    completeNode(),
  ],
  edges: [edge('e1', 'summarise', 'finish')],
  // The summarize tool takes a bounded list, so this fixture's contract accepts one
  // directly rather than putting a transform in front of the node under test.
  inputContract: object({
    topic: str({ minLength: 1, maxLength: 200 }),
    route: withDefault(str({ maxLength: 40 }), 'primary'),
    statements: arrayOf(str({ minLength: 1, maxLength: 200 }), { minItems: 1, maxItems: 10 }),
  }),
};

/** A cacheable model node, so a second identical run must not call a provider. */
export const cachedWorkflow: WorkflowDefinition = {
  ...definitionBase(WORKFLOW_ID.cached),
  initialNodeId: 'analyse',
  nodes: [
    modelNode('analyse', { cacheable: true, cacheTtlMs: 600_000 }),
    completeNode(),
  ],
  edges: [edge('e1', 'analyse', 'finish')],
};

/** A wait node, so the deterministic wait gate can be exercised. */
export const waitingWorkflow: WorkflowDefinition = {
  ...definitionBase(WORKFLOW_ID.waiting),
  initialNodeId: 'normalize',
  nodes: [
    transformNode('normalize', { outputMapping: { finding: 'text' } }),
    { ...base('hold', 'Wait before continuing.'), nodeType: 'wait', waitMs: 60_000 } as WorkflowNode,
    completeNode(),
  ],
  edges: [
    edge('e1', 'normalize', 'hold'),
    edge('e2', 'hold', 'finish'),
  ],
};

/** An optional model node the cost engine may skip. */
export const optionalWorkflow: WorkflowDefinition = {
  ...definitionBase(WORKFLOW_ID.optionalSkip),
  initialNodeId: 'normalize',
  nodes: [
    transformNode('normalize', { outputMapping: { finding: 'text' } }),
    modelNode('enrich', {
      optional: true,
      onFailure: 'continue',
      // A tiny allowance, so the cost engine reaches its node ceiling and the
      // recovery ladder can be observed choosing "skip the optional step".
      costAllowanceMicroUsd: 1,
      outputMapping: {},
    }),
    completeNode(),
  ],
  edges: [
    edge('e1', 'normalize', 'enrich'),
    edge('e2', 'enrich', 'finish'),
  ],
};

export const disabledWorkflow: WorkflowDefinition = {
  ...sequentialWorkflow,
  workflowId: WORKFLOW_ID.disabled,
  enabled: false,
};

export const uncertifiedWorkflow: WorkflowDefinition = {
  ...sequentialWorkflow,
  workflowId: WORKFLOW_ID.uncertified,
  certification: 'uncertified',
};

export const FIXTURE_WORKFLOWS: readonly WorkflowDefinition[] = [
  sequentialWorkflow,
  conditionalWorkflow,
  parallelAllWorkflow,
  parallelAnyWorkflow,
  parallelMinimumWorkflow,
  approvalWorkflow,
  agentWorkflow,
  toolWorkflow,
  cachedWorkflow,
  waitingWorkflow,
  optionalWorkflow,
  disabledWorkflow,
];

// ── Harness ─────────────────────────────────────────────────────────────────

export interface TestWorkflowRuntime {
  readonly runtime: WorkflowRuntime;
  readonly agentRuntime: AgentRuntime;
  readonly plane: AIControlPlane;
  readonly clock: MutableClock;
  readonly logs: { level: string; line: string }[];
  /** Provider calls the mock adapter actually served. The bypass assertion. */
  providerCalls(): number;
  meta(token: string, overrides?: { correlationId?: string }): {
    authorization: string;
    correlationId: string;
    clientIp: string;
  };
}

export interface TestWorkflowRuntimeOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly workflows?: readonly WorkflowDefinition[];
  readonly agents?: readonly AgentDefinition[];
  readonly runStore?: WorkflowRunStore;
  readonly checkpointStore?: WorkflowCheckpointStore;
  readonly approvalStore?: WorkflowApprovalStore;
  readonly cache?: WorkflowCachePort;
  readonly costApprovalThresholdMicroUsd?: number;
  readonly highRiskCachingPermitted?: boolean;
  readonly clock?: MutableClock;
  readonly authenticator?: AIAuthenticator;
}

export function buildTestWorkflowRuntime(
  options: TestWorkflowRuntimeOptions = {},
): TestWorkflowRuntime {
  const clock = options.clock ?? createTestClock();
  const sink = createMemorySink();
  const authenticator = options.authenticator ?? agentAuthenticator();

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

  const primary = createMockProvider({ providerId: 'primary', priority: 1 });
  const backup = createMockProvider({ providerId: 'backup', priority: 2 });

  const plane = createControlPlane({
    config,
    authenticator,
    providers: [
      { adapter: primary, certification: 'certified' },
      { adapter: backup, certification: 'certified' },
    ],
    clock,
    ids: createSequentialIdFactory('plane'),
    logSink: sink,
    sleep: () => Promise.resolve(),
    random: () => 0.5,
  });

  const organizationOptions = {
    defaultOrganizationId: config.defaultOrganizationId,
    allowList: config.organizationAllowList,
    allowDefaultOrganization: config.allowDefaultOrganization,
  };

  const agentRuntime = createAgentRuntime({
    plane,
    authenticator,
    organizationOptions,
    agents: options.agents ?? FIXTURE_AGENTS,
    tools: DETERMINISTIC_TOOLS,
    clock,
    ids: createSequentialIdFactory('agent'),
    logger: plane.logger,
  });

  const runtime = createWorkflowRuntime({
    plane,
    agentRuntime,
    authenticator,
    organizationOptions,
    workflows: options.workflows ?? FIXTURE_WORKFLOWS,
    clock,
    ids: createSequentialIdFactory('wf'),
    logger: plane.logger,
    ...(options.runStore === undefined ? {} : { runStore: options.runStore }),
    ...(options.checkpointStore === undefined
      ? {}
      : { checkpointStore: options.checkpointStore }),
    ...(options.approvalStore === undefined ? {} : { approvalStore: options.approvalStore }),
    ...(options.cache === undefined ? {} : { cache: options.cache }),
    ...(options.costApprovalThresholdMicroUsd === undefined
      ? {}
      : { costApprovalThresholdMicroUsd: options.costApprovalThresholdMicroUsd }),
    ...(options.highRiskCachingPermitted === undefined
      ? {}
      : { highRiskCachingPermitted: options.highRiskCachingPermitted }),
  });

  return {
    runtime,
    agentRuntime,
    plane,
    clock,
    logs: sink.lines,
    // The mock adapters count what they served. A cache-hit test asserts this
    // number did NOT move, which is the only honest way to prove a provider was
    // not called.
    providerCalls: () => primary.calls.length + backup.calls.length,
    meta: (token, overrides = {}) => ({
      authorization: `Bearer ${token}`,
      correlationId: overrides.correlationId ?? 'cor_test_workflow',
      clientIp: '203.0.113.20',
    }),
  };
}

/** A minimal valid run body. */
export function workflowRunBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    workflowId: WORKFLOW_ID.sequential,
    input: { topic: 'Intake triage readiness', route: 'primary' },
    ...overrides,
  };
}

/** The fixture contracts, so a registry test can build a variant definition. */
export const workflowFixtureContracts = {
  workflowInput,
  workflowOutput,
  limits: FIXTURE_LIMITS,
  approval: FIXTURE_APPROVAL,
  definitionBase,
  base,
};

export { AGENT_ID, DETERMINISTIC_TOOL_IDS, AGENT_MODEL_PROFILE, PREDICATE, TRANSFORM };
