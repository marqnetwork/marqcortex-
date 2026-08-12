/**
 * Live financial emission fixtures (AI-01 Batch 3B, Integration Pass).
 *
 * ── NOTHING ON THE PATH UNDER TEST IS STUBBED ──────────────────────────────
 *
 * Every harness here assembles the REAL workflow runtime over the REAL agent
 * runtime over the REAL control plane, with the REAL Part 6A compression
 * engine, the REAL Part 6B eligibility gate and the REAL Part 6C ledger and
 * store behind it. What is substituted is what a test must substitute to be
 * deterministic: the clock, the id factory, the storage backing and the child
 * agents' reported spend.
 *
 * In particular `liveReuseResolver` calls `resolveReuse` — the production
 * pipeline — against an in-memory reusable-result store. It does NOT hand the
 * recorder a hand-made `ValidatedPriorOutput`. That distinction is the whole
 * point of the reuse cases: a fixture that minted its own validated prior would
 * be testing the recorder's arithmetic while assuming away the only question
 * that matters, which is whether the gate agreed.
 *
 * ── THE SPEND IS INJECTED AT THE PORT, AND WHY ─────────────────────────────
 *
 * The fixture agents make no model calls, so their real ledgers are all zero.
 * `meteredAgentPort` reports a fixed CUMULATIVE figure per child, exactly as the
 * real port reports one — see `workflowFixtures.ts`. Producing genuine spend
 * would mean driving the control plane into real provider traffic from inside a
 * workflow fixture, and every financial assertion would then be a statement
 * about the provider layer rather than about the emission path.
 */

import type { WorkflowDefinition } from '../workflows/contracts/workflow.ts';
import type { FinancialEvent } from '../financial/contracts/event.ts';
import type { FinancialEventStore } from '../financial/persistence/ports.ts';
import type { ReusableResultRecord } from '../reuse/contracts/reusableResult.ts';
import type { ReusableResultStore } from '../reuse/persistence/ports.ts';
import type { WorkflowNodeFinancialFacts } from '../workflows/financial/contracts/emission.ts';
import type {
  WorkflowReuseCandidate,
  WorkflowReuseResolver,
} from '../workflows/financial/workflowFinancialRecorder.ts';
import type { TestWorkflowRuntime, TestWorkflowRuntimeOptions } from './workflowFixtures.ts';

import { digestValue } from '../agents/runtime/digest.ts';
import { createInMemoryReusableResultStore } from '../reuse/persistence/ports.ts';
import { createDeclaredFeatureDiscovery } from '../reuse/discovery/declaredFeatureDiscovery.ts';
import { resolveReuse } from '../reuse/engine/reuseDecisionPipeline.ts';
import {
  buildReuseIdentity,
  sealSemanticMetadata,
} from '../reuse/identity/reuseIdentity.ts';
import { sealReusableResult } from '../reuse/identity/sealReusableResult.ts';
import {
  EXECUTABLE,
  WF5_AGENT,
  WF_AGENT,
  buildTestWorkflowRuntime,
  branchEdge,
  edge,
  executionContracts,
  joinNode,
  mergeShape,
  node,
  parallelNode,
  PART5_AGENTS,
} from './workflowFixtures.ts';

/** The organization every harness in this suite resolves to. */
export const FIN_ORG = 'acme';
export const FIN_OTHER_ORG = 'globex';
export const FIN_TOPIC = { topic: 'quarterly readiness' };

/** The declared policy versions a live run's events must carry. */
export const FIN_POLICY_VERSION = 'ai.policy.v7';
export const FIN_OPTIMIZATION_POLICY_VERSION = 'ai.optimization.v2';
export const FIN_BASELINE_POLICY_VERSION = 'baseline.v1';

/**
 * The baseline every fixture node is priced at, under the default profile.
 *
 * Recomputable by hand, and stated here so a test asserting on it is asserting
 * on a figure a reader can check: the fixture agents allow 4,000 completion
 * tokens, the reference policy asks for the whole allowance, there is no
 * declared context, and the `standard` band costs 3,000 micro-USD per thousand
 * completion tokens. 4,000 × 3,000 ÷ 1,000 = 12,000.
 */
export const FIN_BASELINE_MICRO_USD = 12_000;

const financialWorkflow = (
  workflowId: string,
  nodes: readonly WorkflowDefinition['nodes'][number][],
  edges: readonly WorkflowDefinition['edges'][number][],
  startNodeId: string,
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition =>
  ({
    workflowId,
    displayName: `Financial fixture ${workflowId}`,
    purpose: 'Exercise live financial event emission.',
    description: 'A deterministic fixture used by the AI-01 Batch 3B integration suites.',
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
  }) as WorkflowDefinition;

const contracted = (nodeId: string, agentId: string, maxAttempts = 1) => ({
  ...node({ nodeId, agentId, displayName: `Node ${nodeId}`, maxAttempts }),
  outputContract: executionContracts.output,
});

/**
 * The workflows the financial suites run.
 *
 * Every agent node that can be answered by reuse declares an OUTPUT CONTRACT, so
 * a reused value has to pass the node's own declared schema before it becomes a
 * trusted output — which is the governance claim the reuse cases assert.
 */
export const FIN_WORKFLOW = {
  /** One node. The smallest run that can emit an event. */
  single: financialWorkflow(
    'workflow.fin.single',
    [contracted('only', WF_AGENT.alpha)],
    [],
    'only',
  ),

  /** Three nodes, so node attribution has more than one bucket. */
  chain: financialWorkflow(
    'workflow.fin.chain',
    [
      contracted('first', WF_AGENT.alpha),
      contracted('second', WF_AGENT.beta),
      contracted('third', WF_AGENT.gamma),
    ],
    [edge('first', 'second'), edge('second', 'third')],
    'first',
  ),

  /** Node one succeeds, node two fails. Failed-run spend must survive. */
  failsMidway: financialWorkflow(
    'workflow.fin.fails',
    [contracted('first', WF_AGENT.alpha), contracted('second', WF_AGENT.failing)],
    [edge('first', 'second')],
    'first',
  ),

  /** Three attempts at one node. Retry accounting. */
  retry: financialWorkflow(
    'workflow.fin.retry',
    [contracted('work', WF5_AGENT.flaky, 3)],
    [],
    'work',
  ),

  /** One attempt only, so a transient failure ends the run with real spend. */
  retryOnce: financialWorkflow(
    'workflow.fin.retry_once',
    [contracted('work', WF5_AGENT.flaky, 1)],
    [],
    'work',
  ),

  /** A fan-out. Branch, group and run attribution. */
  parallel: financialWorkflow(
    'workflow.fin.parallel',
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
      contracted('left_step', WF_AGENT.alpha),
      contracted('right_step', WF_AGENT.beta),
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

  /** A node that blocks on an approval nobody gives. Unsettled terminal spend. */
  blocks: financialWorkflow(
    'workflow.fin.blocks',
    [contracted('first', WF_AGENT.alpha), contracted('second', WF_AGENT.blocking)],
    [edge('first', 'second')],
    'first',
  ),
} as const;

export const FIN_WORKFLOWS: readonly WorkflowDefinition[] = [
  FIN_WORKFLOW.single,
  FIN_WORKFLOW.chain,
  FIN_WORKFLOW.failsMidway,
  FIN_WORKFLOW.retry,
  FIN_WORKFLOW.retryOnce,
  FIN_WORKFLOW.parallel,
  FIN_WORKFLOW.blocks,
  // The Part 2 fixtures too, so a case can use a node with NO output contract —
  // which is the only shape a deterministic avoidance can answer.
  EXECUTABLE.single,
];

/** A harness carrying the financial workflows over the Part 5 agents. */
export function buildFinancialRuntime(
  options: TestWorkflowRuntimeOptions = {},
): TestWorkflowRuntime {
  return buildTestWorkflowRuntime({
    workflows: FIN_WORKFLOWS,
    agents: PART5_AGENTS,
    ...options,
  });
}

// ── Reading what was written ────────────────────────────────────────────────

/** Every event a run produced, oldest first. A wide window, bounded by the store. */
export async function eventsFor(
  store: FinancialEventStore,
  organizationId: string,
  workflowRunId?: string,
): Promise<readonly FinancialEvent[]> {
  const page = await store.list({
    organizationId,
    window: { fromMs: 0, toMs: Number.MAX_SAFE_INTEGER },
    ...(workflowRunId === undefined ? {} : { workflowRunId }),
  });
  return page.events;
}

/** Sum a field over events, skipping the ones that carry no measurement. */
export function sumSettled(
  events: readonly FinancialEvent[],
  pick: (event: FinancialEvent) => number | undefined,
): number {
  let total = 0;
  for (const event of events) {
    const value = pick(event);
    if (typeof value === 'number') total += value;
  }
  return total;
}

// ── Live reuse, through the real Part 6B pipeline ───────────────────────────

export const FIN_REUSE = {
  taskKind: 'summarization',
  semanticClass: 'node_finding',
  features: ['finding', 'topic', 'summary'] as readonly string[],
  policyVersion: FIN_POLICY_VERSION,
  optimizationPolicyVersion: FIN_OPTIMIZATION_POLICY_VERSION,
  baselinePolicyVersion: FIN_BASELINE_POLICY_VERSION,
  planDigest: 'plan_fin_fixture',
  agentVersion: '1.0.0',
  certificationId: 'cert_fin_fixture',
  /** What the stored answer originally cost. Provenance, never a saving. */
  sourceOriginalCostMicroUsd: 90_000,
  /** The value a reusing node adopts. Satisfies `executionContracts.output`. */
  finding: 'a reused finding about quarterly readiness',
} as const;

function identityInputFor(options: {
  readonly organizationId: string;
  readonly workflowId: string;
  readonly nodeId: string;
  readonly agentId: string;
  readonly inputDigest: string;
}) {
  return {
    organizationId: options.organizationId,
    taskIdentity: `${options.workflowId}/${options.nodeId}`,
    taskKind: FIN_REUSE.taskKind,
    workflowId: options.workflowId,
    workflowVersion: '1.0.0',
    workflowPlanDigest: FIN_REUSE.planDigest,
    agentId: options.agentId,
    agentVersion: FIN_REUSE.agentVersion,
    agentCertificationId: FIN_REUSE.certificationId,
    policyVersion: FIN_REUSE.policyVersion,
    optimizationPolicyVersion: FIN_REUSE.optimizationPolicyVersion,
    baselinePolicyVersion: FIN_REUSE.baselinePolicyVersion,
    quality: 'standard' as const,
    minimumCapabilityProfile: 'standard' as const,
    inputDigest: options.inputDigest,
    evidenceDependencies: [],
    dataDependencies: [],
  };
}

/** The exact input digest a node's live request will carry. */
const EXACT_INPUT_DIGEST = 'sha256:fin_exact';
/** A different one, so only semantic discovery can find the record. */
const SIMILAR_INPUT_DIGEST = 'sha256:fin_similar';

export interface SeedReusableOptions {
  readonly organizationId?: string;
  readonly workflowId: string;
  readonly nodeId: string;
  readonly agentId: string;
  readonly nowMs: number;
  /** `exact` stores under the digest the request uses; `semantic` does not. */
  readonly match: 'exact' | 'semantic';
  /** Lower the stored quality so the gate refuses it. */
  readonly quality?: 'best_effort' | 'standard' | 'high' | 'critical';
  readonly ttlMs?: number;
  readonly finding?: string;
}

/** Seal a reusable result the live pipeline can find. */
export function reusableRecord(options: SeedReusableOptions): ReusableResultRecord {
  const organizationId = options.organizationId ?? FIN_ORG;
  const identity = buildReuseIdentity(
    identityInputFor({
      organizationId,
      workflowId: options.workflowId,
      nodeId: options.nodeId,
      agentId: options.agentId,
      inputDigest: options.match === 'exact' ? EXACT_INPUT_DIGEST : SIMILAR_INPUT_DIGEST,
    }),
  );

  return sealReusableResult({
    identity,
    taskIdentity: `${options.workflowId}/${options.nodeId}`,
    taskKind: FIN_REUSE.taskKind,
    sourceWorkflowId: options.workflowId,
    sourceWorkflowVersion: '1.0.0',
    sourceWorkflowPlanDigest: FIN_REUSE.planDigest,
    sourceAgentId: options.agentId,
    sourceAgentVersion: FIN_REUSE.agentVersion,
    sourceAgentCertificationId: FIN_REUSE.certificationId,
    sourceNodeId: options.nodeId,
    semantic: sealSemanticMetadata(FIN_REUSE.semanticClass, FIN_REUSE.features),
    qualityProfile: options.quality ?? 'standard',
    capabilityProfile: 'standard',
    policyVersion: FIN_REUSE.policyVersion,
    optimizationPolicyVersion: FIN_REUSE.optimizationPolicyVersion,
    baselinePolicyVersion: FIN_REUSE.baselinePolicyVersion,
    provenance: {
      sourceWorkflowRunId: 'wfr_fin_source',
      sourceAgentRunId: 'ar_fin_source',
      sourceNodeId: options.nodeId,
      sourceDecision: 'execute',
      sourceActorId: 'user_producer',
    },
    freshness: { policy: 'ttl', ttlMs: options.ttlMs ?? 24 * 60 * 60_000 },
    createdAt: options.nowMs - 60_000,
    output: {
      schema: 'node.finding',
      schemaVersion: '1',
      fields: { finding: options.finding ?? FIN_REUSE.finding },
      redactions: [],
    },
    originalActualInputTokens: 4_000,
    originalActualOutputTokens: 900,
    originalActualCostMicroUsd: FIN_REUSE.sourceOriginalCostMicroUsd,
  });
}

export async function reusableStoreWith(
  ...records: readonly ReusableResultRecord[]
): Promise<ReusableResultStore> {
  const store = createInMemoryReusableResultStore();
  for (const entry of records) await store.put(entry);
  return store;
}

export interface LiveReuseResolverOptions {
  readonly store: ReusableResultStore;
  /** Only this node consults reuse. Every other node executes. */
  readonly nodeId: string;
  readonly nowMs: number;
  /** Enable semantic discovery. Absent, only exact reuse can answer. */
  readonly semantic?: boolean;
  /** Counts the calls, so a test can prove reuse was consulted exactly once. */
  readonly log?: { consulted: number; hits: number };
}

/**
 * A resolver that runs the REAL Part 6B pipeline.
 *
 * The eligibility request is built from the live node's own facts plus the
 * fixture's declared versions. What it does NOT do is decide anything: the gate
 * inside `resolveReuse` produces the verdict, and a miss comes back as a miss.
 */
export function liveReuseResolver(
  options: LiveReuseResolverOptions,
): WorkflowReuseResolver {
  return {
    async resolve(facts: WorkflowNodeFinancialFacts): Promise<WorkflowReuseCandidate | undefined> {
      if (facts.nodeId !== options.nodeId) return undefined;
      if (options.log) options.log.consulted += 1;

      const identity = buildReuseIdentity(
        identityInputFor({
          organizationId: facts.organizationId,
          workflowId: facts.workflowId,
          nodeId: facts.nodeId,
          agentId: facts.agentId,
          inputDigest: EXACT_INPUT_DIGEST,
        }),
      );
      const sealed = sealSemanticMetadata(FIN_REUSE.semanticClass, FIN_REUSE.features);

      const resolution = await resolveReuse({
        store: options.store,
        eligibility: {
          organizationId: facts.organizationId,
          taskId: `${facts.workflowRunId}:${facts.nodeId}`,
          identity,
          authority: {
            callerAuthorized: true,
            authorizationEvidenceId: 'rbac_verdict_fin',
            workflowPermitted: true,
            agentPermitted: true,
            approvalSatisfied: true,
            certificationValid: true,
          },
          posture: {
            aiEnabled: true,
            reuseEnabled: true,
            controlPlanePostureVersion: 'posture_fin_fixture',
          },
          policy: {
            policyVersion: FIN_REUSE.policyVersion,
            compatiblePolicyVersions: [],
            optimizationPolicyVersion: FIN_REUSE.optimizationPolicyVersion,
            compatibleOptimizationPolicyVersions: [],
            baselinePolicyVersion: FIN_REUSE.baselinePolicyVersion,
            compatibleBaselinePolicyVersions: [],
          },
          version: {
            taskIdentity: `${facts.workflowId}/${facts.nodeId}`,
            taskKind: FIN_REUSE.taskKind,
            workflowId: facts.workflowId,
            workflowVersion: '1.0.0',
            compatibleWorkflowVersions: [],
            workflowPlanDigest: FIN_REUSE.planDigest,
            planDigestRequired: true,
            agentId: facts.agentId,
            agentVersion: FIN_REUSE.agentVersion,
            compatibleAgentVersions: [],
            agentCertificationId: FIN_REUSE.certificationId,
          },
          quality: { quality: 'standard', minimumCapabilityProfile: 'standard' },
          freshness: { nowMs: options.nowMs },
          currentDependencies: [],
        },
        ...(options.semantic === true
          ? {
              discovery: createDeclaredFeatureDiscovery({ store: options.store }),
              semantic: {
                semanticClass: sealed.semanticClass,
                features: sealed.features,
                semanticFingerprint: sealed.semanticFingerprint,
                minimumSimilarity: 40,
                maximumCandidates: 5,
              },
            }
          : {}),
      });

      const priorOutput = resolution.priorOutput;
      const stored = resolution.record;
      if (priorOutput === undefined || stored === undefined || resolution.reuseType === undefined) {
        return undefined;
      }
      if (options.log) options.log.hits += 1;

      return {
        priorOutput,
        reuseType: resolution.reuseType,
        reusableResultId: stored.reusableResultId,
        // Recomputable from the verdict, which is what makes it evidence rather
        // than a label — a reviewer can re-derive it from the stored verdict.
        eligibilityEvidenceDigest: digestValue(resolution.verdict),
        sourceOriginalCostMicroUsd: stored.originalActualCostMicroUsd,
        output: stored.output.fields,
      };
    },
  };
}

/** A resolver that always throws. For the degraded-reuse case. */
export function failingReuseResolver(): WorkflowReuseResolver {
  return {
    resolve() {
      return Promise.reject(new Error('the reusable result store is unavailable'));
    },
  };
}
