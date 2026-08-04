/**
 * Deterministic agent fixtures and harness (AI-01 Batch 3A).
 *
 * Builds a REAL agent runtime — the same `createAgentRuntime` production uses —
 * over a REAL control plane, with every non-deterministic dependency replaced:
 * a hand-driven clock, sequential ids, an in-memory log sink and the mock
 * provider. Nothing on the path under test is stubbed. The registry, the state
 * machine, the orchestrator, the tool gateway, the approval gate, the limits,
 * the ledgers, the checkpoint store and the HTTP adapter are all production
 * implementations.
 *
 * THE AGENTS HERE ARE FIXTURES, NOT PRODUCTS. AI-01 Batch 3A ships no business
 * agents, and the production registry starts empty. These exist so the runtime's
 * guarantees can be exercised: an agent that completes, one that loops, one that
 * hands off, one that reaches for a tool it was never granted. Each is a plain
 * function of its inputs, so a test asserts on the ORCHESTRATOR's decisions
 * rather than on a model's mood.
 */

import type { AgentDefinition, AgentProposalInput } from '../agents/contracts/agent.ts';
import type { AgentActionProposal } from '../agents/contracts/actions.ts';
import type { AgentRuntime } from '../agents/agentRuntime.ts';
import type { AIControlPlane } from '../controlPlane.ts';
import type { MutableClock } from '../runtime/clock.ts';
import type { AIAuthenticator, AuthenticatedSubject } from '../security/actor.ts';
import { createAgentRuntime } from '../agents/agentRuntime.ts';
import { createControlPlane } from '../controlPlane.ts';
import { loadControlPlaneConfig } from '../runtime/config.ts';
import { recordEnv } from '../runtime/env.ts';
import { createTestClock } from '../runtime/clock.ts';
import { createSequentialIdFactory } from '../contracts/ids.ts';
import { createMemorySink } from '../observability/logger.ts';
import { createMockProvider } from '../providers/mockProvider.ts';
import { DETERMINISTIC_TOOLS, DETERMINISTIC_TOOL_IDS } from '../agents/tools/mockTools.ts';
import { AGENT_MODEL_PROFILE } from '../agents/runtime/defaultProfiles.ts';
import { object, optional, str, withDefault } from '../security/validation.ts';

// ── Identities ──────────────────────────────────────────────────────────────

export const AGENT_TOKEN = {
  /** Consultant at `acme`. Creates, controls and reads. No approval authority. */
  consultant: 'token-agent-consultant',
  /** Owner at `acme`. Everything a tenant can do, including approvals. */
  owner: 'token-agent-owner',
  /** Reviewer at `acme`. Reads and approves; may NOT create a run. */
  reviewer: 'token-agent-reviewer',
  /** Consultant at `globex`. For cross-tenant assertions. */
  otherTenant: 'token-agent-other-tenant',
  /** Authenticated, but holds no role this runtime grants anything to. */
  outsider: 'token-agent-outsider',
  /** Platform operator. Cross-tenant READS only. */
  platform: 'token-agent-platform',
} as const;

const SUBJECTS: Readonly<Record<string, AuthenticatedSubject>> = {
  [AGENT_TOKEN.consultant]: {
    subjectId: 'user-consultant',
    email: 'consultant@acme.test',
    actorType: 'team_user',
    globalRoles: ['consultant'],
    memberships: [{ organizationId: 'acme', tier: 'enterprise', roles: ['consultant'] }],
  },
  [AGENT_TOKEN.owner]: {
    subjectId: 'user-owner',
    email: 'owner@acme.test',
    actorType: 'team_user',
    globalRoles: ['owner'],
    memberships: [{ organizationId: 'acme', tier: 'enterprise', roles: ['owner'] }],
  },
  [AGENT_TOKEN.reviewer]: {
    subjectId: 'user-reviewer',
    email: 'reviewer@acme.test',
    actorType: 'team_user',
    globalRoles: ['reviewer'],
    memberships: [{ organizationId: 'acme', tier: 'enterprise', roles: ['reviewer'] }],
  },
  [AGENT_TOKEN.otherTenant]: {
    subjectId: 'user-globex',
    email: 'consultant@globex.test',
    actorType: 'team_user',
    globalRoles: ['consultant'],
    memberships: [{ organizationId: 'globex', tier: 'standard', roles: ['consultant'] }],
  },
  [AGENT_TOKEN.outsider]: {
    subjectId: 'user-outsider',
    email: 'outsider@acme.test',
    actorType: 'team_user',
    globalRoles: ['guest'],
    memberships: [{ organizationId: 'acme', tier: 'enterprise', roles: ['guest'] }],
  },
  [AGENT_TOKEN.platform]: {
    subjectId: 'user-platform',
    email: 'ops@marq.test',
    actorType: 'team_user',
    globalRoles: ['super_admin'],
    memberships: [{ organizationId: 'acme', tier: 'internal', roles: ['owner'] }],
  },
};

export function agentAuthenticator(): AIAuthenticator {
  return {
    authenticate(authorization) {
      if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
        return Promise.resolve(null);
      }
      return Promise.resolve(SUBJECTS[authorization.slice('Bearer '.length)] ?? null);
    },
  };
}

export function bearer(token: string): string {
  return `Bearer ${token}`;
}

// ── Agent fixtures ──────────────────────────────────────────────────────────

const OWNER = 'MARQ Platform Engineering — test fixtures';

const runInput = object({
  topic: str({ minLength: 1, maxLength: 200 }),
  /** Drives the fixture's behaviour. Never reaches a model. */
  script: withDefault(str({ maxLength: 60 }), 'model_then_complete'),
});

const runOutput = object({
  finding: str({ minLength: 1, maxLength: 2_000 }),
});

const handoffPayload = object({
  topic: str({ minLength: 1, maxLength: 200 }),
  note: optional(str({ maxLength: 500 })),
});

export const AGENT_ID = {
  primary: 'agent.test.primary',
  reviewer: 'agent.test.reviewer',
  toolUser: 'agent.test.tooluser',
  unpermitted: 'agent.test.unpermitted',
  disabled: 'agent.test.disabled',
  uncertified: 'agent.test.uncertified',
} as const;

const LIMITS = {
  maxTotalSteps: 8,
  maxStepsPerAgent: 6,
  maxHandoffs: 2,
  maxRetries: 1,
  maxRepeatedActions: 2,
  maxRepeatedHandoffs: 2,
  maxRuntimeMs: 120_000,
  maxPromptTokens: 200_000,
  maxCompletionTokens: 40_000,
  maxTotalTokens: 240_000,
  maxEstimatedCostMicroUsd: 900_000,
  maxActualCostMicroUsd: 900_000,
};

const APPROVALS = {
  requireForToolRisk: ['moderate', 'high'] as const,
  requireForHandoff: false,
  requireForCompletion: false,
  approverRoles: ['owner', 'admin', 'reviewer'],
  expiresAfterMs: 3_600_000,
};

/** Fixture behaviour, keyed by the run input's `script`. */
function proposeFor(input: AgentProposalInput): AgentActionProposal {
  const runData = input.input as { topic: string; script: string };
  const script = runData.script;
  const step = input.stepCount;

  const complete = (): AgentActionProposal => ({
    actionType: 'complete',
    reason: 'The objective is satisfied.',
    idempotencyKey: `complete:${input.runId}`,
    output: { finding: `Finding for ${runData.topic}` },
  });

  const modelCall = (key: string): AgentActionProposal => ({
    actionType: 'model_call',
    reason: 'Reasoning about the objective.',
    idempotencyKey: `model:${key}`,
    modelProfileId: AGENT_MODEL_PROFILE.standard,
    objective: `Analyse ${runData.topic}`,
    context: [
      {
        sectionId: 'topic',
        label: 'Topic',
        content: runData.topic,
        trusted: false,
        priority: 10,
      },
    ],
    expectedOutput: { requiredFields: ['finding'], maxBytes: 4_096 },
  });

  switch (script) {
    case 'complete_immediately':
      return complete();

    case 'model_then_complete':
      return step === 0 ? modelCall(`step-${step}`) : complete();

    case 'loop_same_action':
      // Same fingerprint every time: the loop detector must stop it.
      return modelCall('constant');

    case 'pause_then_complete':
      return step === 0
        ? {
            actionType: 'pause',
            reason: 'Waiting for something outside the run.',
            idempotencyKey: `pause:${input.runId}`,
          }
        : complete();

    case 'never_complete':
      // Distinct fingerprints and no output digest, so neither the repeated-
      // action detector nor the no-progress detector fires. Only the step
      // ceiling can stop this one, which is exactly what it is for.
      return {
        actionType: 'checkpoint',
        reason: 'Recording progress and continuing indefinitely.',
        idempotencyKey: `never:${step}`,
        progress: { step, topic: runData.topic },
      };

    case 'checkpoint_then_complete':
      return step === 0
        ? {
            actionType: 'checkpoint',
            reason: 'Recording progress before continuing.',
            idempotencyKey: `checkpoint:${input.runId}`,
            progress: { seen: runData.topic },
          }
        : complete();

    case 'tool_then_complete':
      return step === 0
        ? {
            actionType: 'tool_call',
            reason: 'Summarising the supplied statements.',
            idempotencyKey: `tool:${input.runId}`,
            toolId: DETERMINISTIC_TOOL_IDS.summarize,
            input: { statements: [runData.topic, 'A second statement.'] },
          }
        : complete();

    case 'approved_tool_then_complete':
      return step === 0
        ? {
            actionType: 'tool_call',
            reason: 'Recording a note about the topic.',
            idempotencyKey: `note:${input.runId}`,
            toolId: DETERMINISTIC_TOOL_IDS.recordNote,
            input: { subject: runData.topic, body: 'A bounded note.', visibility: 'internal' },
          }
        : complete();

    case 'undeclared_tool':
      return {
        actionType: 'tool_call',
        reason: 'Reaching for a tool this agent never declared.',
        idempotencyKey: `undeclared:${input.runId}`,
        toolId: DETERMINISTIC_TOOL_IDS.lookup,
        input: { recordKey: 'readiness' },
      };

    case 'handoff_then_complete':
      return step === 0
        ? {
            actionType: 'handoff',
            reason: 'The reviewer owns the second half of this task.',
            idempotencyKey: `handoff:${input.runId}`,
            targetAgentId: AGENT_ID.reviewer,
            payload: { topic: runData.topic, note: 'Please review.' },
          }
        : complete();

    case 'handoff_to_stranger':
      return {
        actionType: 'handoff',
        reason: 'Handing off to an agent this one may not reach.',
        idempotencyKey: `stranger:${input.runId}`,
        targetAgentId: AGENT_ID.toolUser,
        payload: { topic: runData.topic },
      };

    case 'handoff_ping_pong':
      // Both agents hand back, so the edge and the cycle counters both fire.
      return {
        actionType: 'handoff',
        reason: 'Bouncing the task back.',
        idempotencyKey: `pingpong:${input.agentId}:${input.stepCount}`,
        targetAgentId:
          input.agentId === AGENT_ID.primary ? AGENT_ID.reviewer : AGENT_ID.primary,
        payload: { topic: runData.topic },
      };

    case 'request_approval_then_complete':
      return step === 0
        ? {
            actionType: 'request_approval',
            reason: 'This decision needs a human.',
            idempotencyKey: `approval:${input.runId}`,
            impactSummary: 'Confirm the finding before it is recorded.',
            dataAffected: ['finding'],
            estimatedAdditionalTokens: 100,
            estimatedAdditionalCostMicroUsd: 500,
          }
        : complete();

    case 'malformed_completion':
      return {
        actionType: 'complete',
        reason: 'Completing with output that does not match the contract.',
        idempotencyKey: `bad:${input.runId}`,
        output: { unexpected: true },
      };

    case 'unknown_action':
      // Deliberately not a member of the union — the runtime must refuse it
      // rather than trusting the type system to have prevented it.
      return { actionType: 'teleport', reason: 'Not a real action.', idempotencyKey: 'x1' } as unknown as AgentActionProposal;

    case 'fail_immediately':
      return {
        actionType: 'fail',
        reason: 'The agent decided it cannot continue.',
        idempotencyKey: `fail:${input.runId}`,
        failureReason: 'insufficient_input',
      };

    default:
      return complete();
  }
}

function baseAgent(agentId: string): Omit<AgentDefinition, 'capabilities' | 'allowedTools' | 'allowedModelProfiles' | 'allowedHandoffTargets'> {
  return {
    agentId,
    displayName: `Test agent ${agentId}`,
    purpose: 'Exercise the agent runtime deterministically.',
    description: 'A deterministic fixture agent used by the AI-01 Batch 3A test suites.',
    owner: OWNER,
    version: '1.0.0',
    enabled: true,
    certification: 'certified',
    safetyClass: 'tenant_readonly',
    inputContract: runInput,
    outputContract: runOutput,
    handoffContract: handoffPayload,
    limits: LIMITS,
    approvals: APPROVALS,
    completion: { requiredOutputFields: ['finding'], terminalAfterHandoff: true },
    propose: proposeFor,
  };
}

/** The entry agent: models, tools, handoffs and approvals. */
export const primaryAgent: AgentDefinition = {
  ...baseAgent(AGENT_ID.primary),
  capabilities: [
    'agent.model.invoke',
    'agent.tool.invoke',
    'agent.handoff.initiate',
    'agent.handoff.receive',
    'agent.approval.request',
    'agent.checkpoint.write',
  ],
  allowedTools: [DETERMINISTIC_TOOL_IDS.summarize, DETERMINISTIC_TOOL_IDS.recordNote],
  allowedModelProfiles: [AGENT_MODEL_PROFILE.standard, AGENT_MODEL_PROFILE.compact],
  allowedHandoffTargets: [AGENT_ID.reviewer],
};

/** The handoff target. Can receive and hand back. */
export const reviewerAgent: AgentDefinition = {
  ...baseAgent(AGENT_ID.reviewer),
  capabilities: [
    'agent.model.invoke',
    'agent.handoff.initiate',
    'agent.handoff.receive',
    'agent.checkpoint.write',
  ],
  allowedTools: [],
  allowedModelProfiles: [AGENT_MODEL_PROFILE.compact],
  allowedHandoffTargets: [AGENT_ID.primary],
};

/** Declares one tool and nothing else. Never a handoff target of `primary`. */
export const toolUserAgent: AgentDefinition = {
  ...baseAgent(AGENT_ID.toolUser),
  capabilities: ['agent.tool.invoke', 'agent.handoff.receive'],
  allowedTools: [DETERMINISTIC_TOOL_IDS.lookup],
  allowedModelProfiles: [],
  allowedHandoffTargets: [],
};

/** Holds no model capability, so a model call must be refused. */
export const unpermittedAgent: AgentDefinition = {
  ...baseAgent(AGENT_ID.unpermitted),
  capabilities: ['agent.checkpoint.write'],
  allowedTools: [],
  allowedModelProfiles: [],
  allowedHandoffTargets: [],
};

export const disabledAgent: AgentDefinition = {
  ...baseAgent(AGENT_ID.disabled),
  enabled: false,
  capabilities: ['agent.model.invoke'],
  allowedTools: [],
  allowedModelProfiles: [AGENT_MODEL_PROFILE.standard],
  allowedHandoffTargets: [],
};

export const uncertifiedAgent: AgentDefinition = {
  ...baseAgent(AGENT_ID.uncertified),
  certification: 'uncertified',
  capabilities: ['agent.model.invoke'],
  allowedTools: [],
  allowedModelProfiles: [AGENT_MODEL_PROFILE.standard],
  allowedHandoffTargets: [],
};

export const FIXTURE_AGENTS: readonly AgentDefinition[] = [
  primaryAgent,
  reviewerAgent,
  toolUserAgent,
  unpermittedAgent,
  disabledAgent,
  uncertifiedAgent,
];

// ── Harness ─────────────────────────────────────────────────────────────────

export interface TestAgentRuntime {
  readonly runtime: AgentRuntime;
  readonly plane: AIControlPlane;
  readonly clock: MutableClock;
  readonly logs: { level: string; line: string }[];
  /** Request metadata for one of the fixture identities. */
  meta(token: string, overrides?: { correlationId?: string }): {
    authorization: string;
    correlationId: string;
    clientIp: string;
  };
}

export interface TestAgentRuntimeOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly agents?: readonly AgentDefinition[];
  readonly runStore?: AgentRuntime['runs'];
  readonly checkpointStore?: AgentRuntime['checkpoints'];
  readonly approvalStore?: Parameters<typeof createAgentRuntime>[0]['approvalStore'];
  readonly costApprovalThresholdMicroUsd?: number;
  readonly clock?: MutableClock;
}

export function buildTestAgentRuntime(
  options: TestAgentRuntimeOptions = {},
): TestAgentRuntime {
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
      { adapter: createMockProvider({ providerId: 'primary', priority: 1 }), certification: 'certified' },
      { adapter: createMockProvider({ providerId: 'backup', priority: 2 }), certification: 'certified' },
    ],
    clock,
    ids: createSequentialIdFactory('plane'),
    logSink: sink,
    sleep: () => Promise.resolve(),
    random: () => 0.5,
  });

  const runtime = createAgentRuntime({
    plane,
    authenticator,
    organizationOptions: {
      defaultOrganizationId: config.defaultOrganizationId,
      allowList: config.organizationAllowList,
      allowDefaultOrganization: config.allowDefaultOrganization,
    },
    agents: options.agents ?? FIXTURE_AGENTS,
    tools: DETERMINISTIC_TOOLS,
    clock,
    ids: createSequentialIdFactory('agent'),
    logger: plane.logger,
    ...(options.runStore === undefined ? {} : { runStore: options.runStore }),
    ...(options.checkpointStore === undefined
      ? {}
      : { checkpointStore: options.checkpointStore }),
    ...(options.approvalStore === undefined ? {} : { approvalStore: options.approvalStore }),
    ...(options.costApprovalThresholdMicroUsd === undefined
      ? {}
      : { costApprovalThresholdMicroUsd: options.costApprovalThresholdMicroUsd }),
  });

  return {
    runtime,
    plane,
    clock,
    logs: sink.lines,
    meta: (token, overrides = {}) => ({
      authorization: bearer(token),
      correlationId: overrides.correlationId ?? 'cor_test_agent',
      clientIp: '203.0.113.10',
    }),
  };
}

// ── A key-value store with the production CAS semantics ─────────────────────

/**
 * An in-memory stand-in for the platform key-value store, implementing exactly
 * the contract `kv_compare_and_swap_field` (migration 20260804120000) provides:
 *
 *   expected 0        insert if and only if the key is absent
 *   expected N        write if and only if the stored record's named version
 *                     field currently equals N
 *   anything else     resolve false — a lost race, never an exception
 *
 * Values are stored as JSON STRINGS, which is how the production helper writes
 * them (`kv.set(key, JSON.stringify(value))`). That is deliberate: an adapter
 * that only ever saw objects in tests would not exercise the double-encoding
 * path the real store actually uses.
 */
export interface FakeKv {
  read(key: string): Promise<unknown>;
  readByPrefix(prefix: string): Promise<readonly unknown[]>;
  compareAndSwap(
    key: string,
    versionField: string,
    expectedVersion: number,
    value: unknown,
  ): Promise<boolean>;
  /** Overwrite a record without a version check. Corruption tests only. */
  poke(key: string, value: unknown): void;
  keys(): readonly string[];
  readonly writes: number;
}

export function createFakeKv(): FakeKv {
  const rows = new Map<string, string>();
  let writes = 0;

  const versionOf = (raw: string | undefined, field: string): number | undefined => {
    if (raw === undefined) return undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return undefined;
      const value = (parsed as Record<string, unknown>)[field];
      return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
    } catch {
      return undefined;
    }
  };

  return {
    read: (key) => Promise.resolve(rows.get(key)),
    readByPrefix: (prefix) =>
      Promise.resolve(
        [...rows.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, value]) => value),
      ),
    compareAndSwap: (key, versionField, expectedVersion, value) => {
      if (expectedVersion === 0) {
        if (rows.has(key)) return Promise.resolve(false);
        rows.set(key, JSON.stringify(value));
        writes += 1;
        return Promise.resolve(true);
      }
      if (versionOf(rows.get(key), versionField) !== expectedVersion) {
        return Promise.resolve(false);
      }
      rows.set(key, JSON.stringify(value));
      writes += 1;
      return Promise.resolve(true);
    },
    poke: (key, value) => {
      rows.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
    keys: () => [...rows.keys()].sort(),
    get writes() {
      return writes;
    },
  };
}

/** A minimal valid run body. */
export function runBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agentId: AGENT_ID.primary,
    objective: 'Establish a deterministic finding for the supplied topic.',
    input: { topic: 'Intake handoffs', script: 'model_then_complete' },
    ...overrides,
  };
}

/** The fixture contracts, so a registry test can build a variant definition. */
export const fixtureContracts = { runInput, runOutput, handoffPayload, limits: LIMITS, approvals: APPROVALS };
