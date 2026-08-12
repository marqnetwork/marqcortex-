/**
 * Production optimization wiring fixtures
 * (AI-01 Batch 3B, Production Optimization Wiring).
 *
 * ── WHAT IS AND IS NOT SUBSTITUTED ─────────────────────────────────────────
 *
 * The reuse resolver these harnesses use is the PRODUCTION one —
 * `createWorkflowReuseResolver`, assembled by `createWorkflowRuntime` from the
 * real agent registry, the real model profile catalogue and the real Part 6B
 * eligibility gate. Nothing here hands the recorder a hand-made candidate, and
 * nothing here constructs a `ValidatedPriorOutput`: the only way a case in this
 * suite reaches a hit is for the gate to have agreed.
 *
 * That is why `productionReusableRecord` exists and why it is so laborious. To
 * seal a record the production resolver will FIND, a fixture has to reproduce
 * the identity the resolver derives — which means reading the run's own plan
 * digest, the agent's registered version and certification, the administrative
 * configuration version and the quality contract the cost registry derived. A
 * fixture that guessed any of them would produce a record the gate refuses, and
 * the case would pass for the wrong reason: a miss that looks like a
 * cross-tenant refusal.
 *
 * The financial store is the REAL Part 6C key-value store over `createFakeKv`,
 * which is the same double-encoded JSON contract the platform's own
 * `kv_compare_and_swap_field` migration provides. A "restart" is a second
 * runtime over the same fake — no state carried in a closure, exactly as a
 * recycled isolate carries none.
 */

import type { AgentDefinition } from '../agents/contracts/agent.ts';
import type { FinancialEventStore } from '../financial/persistence/ports.ts';
import type { ReusableResultRecord } from '../reuse/contracts/reusableResult.ts';
import type { ReusableResultStore } from '../reuse/persistence/ports.ts';
import type { WorkflowDefinition } from '../workflows/contracts/workflow.ts';
import type { WorkflowNodeFinancialFacts } from '../workflows/financial/contracts/emission.ts';
import type { WorkflowReuseResolver } from '../workflows/financial/workflowFinancialRecorder.ts';
import type { TestWorkflowRuntime, TestWorkflowRuntimeOptions } from './workflowFixtures.ts';

import { digestValue } from '../agents/runtime/digest.ts';
import { createKvFinancialEventStore } from '../financial/persistence/kvFinancialEventStore.ts';
import { createInMemoryReusableResultStore } from '../reuse/persistence/ports.ts';
import { buildReuseIdentity, sealSemanticMetadata } from '../reuse/identity/reuseIdentity.ts';
import { sealReusableResult } from '../reuse/identity/sealReusableResult.ts';
import {
  WORKFLOW_BASELINE_POLICY_VERSION,
  WORKFLOW_REUSE_TASK_KIND,
  createWorkflowReuseResolver,
} from '../workflows/financial/workflowReuseResolver.ts';
import { createMetrics } from '../observability/metrics.ts';
import {
  WORKFLOW_OPTIMIZATION_POLICY_VERSION,
  workflowPolicyVersionFor,
} from '../workflows/financial/nodeCostProfile.ts';
import { createFakeKv, type FakeKv } from './agentFixtures.ts';
import { buildTestWorkflowRuntime } from './workflowFixtures.ts';
import { FIN_AGENTS, FIN_WORKFLOWS } from './workflowFinancialFixtures.ts';

/** The value a reusing node adopts. Satisfies the node's declared contract. */
export const PROD_REUSE_FINDING = 'a reused production finding';

/** What the stored answer originally cost. Provenance only; nothing sums it. */
export const PROD_SOURCE_COST_MICRO_USD = 90_000;

export interface ProductionRuntimeOptions extends TestWorkflowRuntimeOptions {
  /** Omit to get a fresh in-memory reusable store; share one across restarts. */
  readonly reuse?: ReusableResultStore;
}

/**
 * A harness with production reuse wired and durable financial storage.
 *
 * `reuseEnabled` defaults to true here because every case in this suite is
 * about what the production path does when reuse IS on. A case that wants it off
 * says so, and the health read then reports the difference.
 */
export function buildProductionRuntime(
  options: ProductionRuntimeOptions = {},
): TestWorkflowRuntime & { readonly reusableResultStore: ReusableResultStore } {
  const reusableResultStore = options.reuse ?? createInMemoryReusableResultStore();
  const harness = buildTestWorkflowRuntime({
    workflows: FIN_WORKFLOWS,
    agents: FIN_AGENTS,
    reusableResultStore,
    reuseEnabled: () => true,
    ...options,
  });
  return { ...harness, reusableResultStore };
}

/** The Part 6C durable store, over the platform's own key-value contract. */
export function durableFinancialStore(kv: FakeKv): FinancialEventStore {
  return createKvFinancialEventStore({
    read: kv.read,
    readByPrefix: kv.readByPrefix,
    compareAndSwap: kv.compareAndSwap,
  });
}

export interface ProductionReusableOptions {
  readonly harness: TestWorkflowRuntime;
  readonly organizationId: string;
  readonly workflowId: string;
  readonly nodeId: string;
  readonly agentId: string;
  readonly nowMs: number;
  /** The input the node will actually be given. Its digest binds the key. */
  readonly input: unknown;
  /** Seal under a DIFFERENT tenant, so the exact key can never be found. */
  readonly sealForOrganizationId?: string;
  /** Lower the stored quality so the gate refuses it on the quality dimension. */
  readonly quality?: 'best_effort' | 'standard' | 'high' | 'critical';
  /** Shorten the TTL so the record is expired at `nowMs`. */
  readonly ttlMs?: number;
  /** Seal under a plan digest the run does not carry. */
  readonly planDigest?: string;
  readonly finding?: string;
  readonly createdAt?: number;
}

/**
 * Seal a record the PRODUCTION resolver will find, or a near miss.
 *
 * Every field is read from the same place the resolver reads it, so a hit is a
 * hit because the identities genuinely agree rather than because a fixture and
 * an implementation were edited together. The three `sealFor…` / `quality` /
 * `ttlMs` escapes exist to build records that are RIGHT in every dimension but
 * one — which is the only way to prove a specific dimension is what refused.
 */
export function productionReusableRecord(
  options: ProductionReusableOptions,
): ReusableResultRecord {
  const { harness } = options;
  const definition = harness.agentRuntime.runtime.registry.find(options.agentId);
  if (definition === undefined) throw new Error(`unregistered fixture agent ${options.agentId}`);
  const workflow = harness.workflows.registry.find(options.workflowId);
  if (workflow === undefined) throw new Error(`unregistered fixture workflow ${options.workflowId}`);
  const plan = harness.workflows.registry.findPlan(options.workflowId);
  if (plan === undefined) throw new Error(`unplanned fixture workflow ${options.workflowId}`);

  const organizationId = options.sealForOrganizationId ?? options.organizationId;
  const configurationVersion = harness.workflows.state().configurationVersion;
  const planDigest = options.planDigest ?? plan.digest;
  const agentCertificationId =
    `${definition.agentId}@${definition.version}:${definition.certification}`;

  // The quality contract THE COST REGISTRY DERIVED for this node, asked for with
  // the same facts the recorder will price it with. Anything else here would be
  // a second answer to a question the platform answers in one place.
  const profile = harness.workflows.nodeCostRegistry.profileFor({
    organizationId: options.organizationId,
    actorId: 'user_fixture',
    workflowId: options.workflowId,
    workflowVersion: workflow.version,
    workflowRunId: 'wfr_fixture',
    configurationVersion,
    planDigest,
    nodeId: options.nodeId,
    agentId: options.agentId,
    attempt: 1,
    maxAttempts: 1,
    protectedWork: false,
    occurredAt: options.nowMs,
  });
  const quality = options.quality ?? profile?.quality ?? 'standard';
  const capabilityProfile = profile?.maximumCapabilityProfile ?? 'standard';

  const taskIdentity = `${options.workflowId}/${options.nodeId}`;
  const identity = buildReuseIdentity({
    organizationId,
    taskIdentity,
    taskKind: WORKFLOW_REUSE_TASK_KIND,
    workflowId: options.workflowId,
    workflowVersion: workflow.version,
    workflowPlanDigest: planDigest,
    agentId: options.agentId,
    agentVersion: definition.version,
    agentCertificationId,
    policyVersion: workflowPolicyVersionFor(configurationVersion),
    optimizationPolicyVersion: WORKFLOW_OPTIMIZATION_POLICY_VERSION,
    baselinePolicyVersion: WORKFLOW_BASELINE_POLICY_VERSION,
    // Sealed under the DERIVED contract unless a case is deliberately building
    // a record the gate must refuse. A record sealed under a lower quality is
    // still findable by exact key — `quality` is part of the key — so a refusal
    // case seals with the requested value and the key simply does not match,
    // which is `no_candidate`; a case that wants the QUALITY dimension to refuse
    // uses `sealQualityBelow` below instead.
    quality: options.quality ?? quality,
    minimumCapabilityProfile: capabilityProfile,
    inputDigest: digestValue(options.input),
    evidenceDependencies: [],
    dataDependencies: [],
  });

  return sealReusableResult({
    identity,
    taskIdentity,
    taskKind: WORKFLOW_REUSE_TASK_KIND,
    sourceWorkflowId: options.workflowId,
    sourceWorkflowVersion: workflow.version,
    sourceWorkflowPlanDigest: planDigest,
    sourceAgentId: options.agentId,
    sourceAgentVersion: definition.version,
    sourceAgentCertificationId: agentCertificationId,
    sourceNodeId: options.nodeId,
    semantic: sealSemanticMetadata('workflow_node', ['finding']),
    qualityProfile: quality,
    capabilityProfile,
    policyVersion: workflowPolicyVersionFor(configurationVersion),
    optimizationPolicyVersion: WORKFLOW_OPTIMIZATION_POLICY_VERSION,
    baselinePolicyVersion: WORKFLOW_BASELINE_POLICY_VERSION,
    provenance: {
      sourceWorkflowRunId: 'wfr_prod_source',
      sourceAgentRunId: 'ar_prod_source',
      sourceNodeId: options.nodeId,
      sourceDecision: 'execute',
      sourceActorId: 'user_producer',
    },
    freshness: { policy: 'ttl', ttlMs: options.ttlMs ?? 24 * 60 * 60_000 },
    createdAt: options.createdAt ?? options.nowMs - 60_000,
    output: {
      schema: 'node.finding',
      schemaVersion: '1',
      fields: { finding: options.finding ?? PROD_REUSE_FINDING },
      redactions: [],
    },
    originalActualInputTokens: 4_000,
    originalActualOutputTokens: 900,
    originalActualCostMicroUsd: PROD_SOURCE_COST_MICRO_USD,
  });
}

/**
 * Seal a record whose STORED quality is below the contract, under the key the
 * request will actually compute.
 *
 * The distinction from `quality` above matters and is easy to miss: the quality
 * contract is part of the exact key, so a record sealed at a lower quality is
 * simply not found. To make the gate refuse on the QUALITY dimension the record
 * has to be sealed under the REQUESTED key and carry a lower `qualityProfile` —
 * which is exactly what a quality contract raised after the record was written
 * looks like in production.
 */
export function reusableWithStoredQualityBelow(
  options: ProductionReusableOptions,
): ReusableResultRecord {
  const sealed = productionReusableRecord({ ...options, quality: undefined });
  return { ...sealed, qualityProfile: 'best_effort', capabilityProfile: 'economy' };
}

/**
 * The facts one node attempt is financially known by, as the ENGINE builds them.
 *
 * Used by cases that need to ask the production resolver a question directly —
 * the kill-switch case, in particular, where the platform's only way to
 * disengage AI is the administration surface and a case that went through it
 * would be testing the administration surface.
 */
export function productionNodeFacts(
  harness: TestWorkflowRuntime,
  options: {
    readonly organizationId: string;
    readonly workflowId: string;
    readonly nodeId: string;
    readonly agentId: string;
    readonly input: unknown;
  },
): WorkflowNodeFinancialFacts {
  const workflow = harness.workflows.registry.find(options.workflowId);
  const plan = harness.workflows.registry.findPlan(options.workflowId);
  if (workflow === undefined || plan === undefined) {
    throw new Error(`unregistered fixture workflow ${options.workflowId}`);
  }
  return {
    organizationId: options.organizationId,
    actorId: 'user_consultant',
    workflowId: options.workflowId,
    workflowVersion: workflow.version,
    workflowRunId: 'wfr_prod_facts',
    configurationVersion: harness.workflows.state().configurationVersion,
    planDigest: plan.digest,
    nodeId: options.nodeId,
    agentId: options.agentId,
    inputDigest: digestValue(options.input),
    attempt: 1,
    maxAttempts: 1,
    protectedWork: false,
    occurredAt: harness.clock.now(),
  };
}

/**
 * The PRODUCTION resolver, over a harness, with a posture a case controls.
 *
 * Everything except the posture comes from the harness's own registries and the
 * harness's own reusable-result store, so a hit here is a hit the assembled
 * runtime would also have produced. The posture is the one substitution, and it
 * exists because the platform's kill switch is engaged through the
 * administration surface — a case that drove it that way would be asserting
 * something about the administration surface rather than about reuse.
 */
export function productionResolverFor(
  harness: TestWorkflowRuntime & { readonly reusableResultStore: ReusableResultStore },
  posture: { readonly aiEnabled: boolean; readonly reuseEnabled: boolean },
): WorkflowReuseResolver {
  return createWorkflowReuseResolver({
    store: harness.reusableResultStore,
    posture: () => ({
      aiEnabled: posture.aiEnabled,
      reuseEnabled: posture.reuseEnabled,
      controlPlanePostureVersion:
        `ai.settings.v${String(harness.workflows.state().configurationVersion)}`,
    }),
    agentFactsFor: (facts) => {
      const definition = harness.agentRuntime.runtime.registry.find(facts.agentId);
      if (definition === undefined) return undefined;
      const profile = harness.workflows.nodeCostRegistry.profileFor(facts);
      return {
        agentVersion: definition.version,
        agentCertificationId:
          `${definition.agentId}@${definition.version}:${definition.certification}`,
        quality: profile?.quality ?? 'standard',
        minimumCapabilityProfile: profile?.maximumCapabilityProfile ?? 'standard',
      };
    },
    authorityFor: (facts) => {
      const definition = harness.agentRuntime.runtime.registry.find(facts.agentId);
      const workflow = harness.workflows.registry.find(facts.workflowId);
      if (definition === undefined || workflow === undefined) return undefined;
      return {
        callerAuthorized: true,
        authorizationEvidenceId: `wf:${facts.workflowRunId}:${facts.actorId}`,
        workflowPermitted: workflow.version === facts.workflowVersion,
        agentPermitted: definition.enabled,
        approvalSatisfied: true,
        certificationValid: definition.certification === 'certified',
      };
    },
    now: () => harness.clock.now(),
    logger: harness.agentRuntime.plane.logger,
    metrics: createMetrics(),
  });
}

export async function storeWith(
  store: ReusableResultStore,
  ...records: readonly ReusableResultRecord[]
): Promise<ReusableResultStore> {
  for (const record of records) await store.put(record);
  return store;
}

export { createFakeKv };
export type { AgentDefinition, WorkflowDefinition, FakeKv };
