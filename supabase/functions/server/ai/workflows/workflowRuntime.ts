/**
 * Workflow runtime assembly (AI-01 Batch 3B, Part 2).
 *
 * One function that builds the whole dependency graph by explicit injection, so
 * a test can assemble the REAL registry, planner, state machine, engine and
 * service with a fake clock, sequential ids and an in-memory store — and
 * exercise production code end to end with no network, no globals and no shared
 * state between cases. The same shape `createAgentRuntime` uses, for the same
 * reason.
 *
 * ── THE ONE DEPENDENCY THAT IS NOT OPTIONAL ────────────────────────────────
 *
 * The certified Batch 3A Agent Runtime. The workflow runtime takes it and
 * derives three things:
 *
 *   the agent port      every node executes through `orchestrator.createRun`
 *                       and `orchestrator.advance` — see `engine/agentNodePort.ts`
 *   agent existence     the registry refuses to register a workflow naming an
 *                       agent that is not registered, at ASSEMBLY, not at run
 *   the actor bridge    a person's agent-runtime capabilities, resolved by the
 *                       agent runtime's own RBAC rather than a copy of it
 *
 * There is no mode in which a workflow executes without an agent runtime, no
 * flag that bypasses it, and no second path to an agent. That is this part's
 * central architectural claim and it is enforced here by construction.
 *
 * ── CERTIFICATION ──────────────────────────────────────────────────────────
 *
 * `requireCertifiedWorkflows` defaults to the agent runtime's
 * `requireCertifiedAgents` and is overridable. It is NOT a new operator switch:
 * adding one means a new field on the Batch 2 settings record, a new
 * environment variable and a new administration surface, which is Part 3's
 * work. Defaulting to the agents switch is the conservative direction — a
 * deployment that demands certified agents gets certified workflows too — and
 * the coupling is stated here rather than left for an operator to discover, the
 * way Batch 3A's single flag once was.
 */

import type { Clock } from '../runtime/clock.ts';
import type { IdFactory } from '../contracts/ids.ts';
import type { Logger } from '../observability/logger.ts';
import type { Metrics } from '../observability/metrics.ts';
import type { AIAuthenticator, AuthenticatedSubject } from '../security/actor.ts';
import type { OrganizationResolutionOptions } from '../security/tenancy.ts';
import type { AgentRuntime } from '../agents/agentRuntime.ts';
import type { WorkflowDefinition } from './contracts/workflow.ts';
import type {
  WorkflowApprovalStore,
  WorkflowCheckpointStore,
  WorkflowRunStore,
} from './persistence/ports.ts';
import type { WorkflowRegistry } from './registry/workflowRegistry.ts';
import type { WorkflowApprovalGate } from './approvals/workflowApprovalGate.ts';
import type {
  WorkflowAgentPort,
} from './engine/agentNodePort.ts';
import type {
  WorkflowOrchestrator,
  WorkflowRuntimeState,
} from './engine/workflowOrchestrator.ts';
import type { WorkflowRuntimeService } from './service/workflowRuntimeService.ts';
import type { FinancialEventStore } from '../financial/persistence/ports.ts';
import type { WorkflowFinancialPort } from './financial/contracts/emission.ts';
import type {
  WorkflowNodeCostProfile,
  WorkflowNodeLimits,
} from './financial/nodeCostProfile.ts';
import type { WorkflowReuseResolver } from './financial/workflowFinancialRecorder.ts';
import type { ReusableResultStore } from '../reuse/persistence/ports.ts';
import type { SemanticReuseDiscoveryPort } from '../reuse/discovery/semanticDiscoveryPort.ts';
import type { ReuseDependency } from '../reuse/contracts/dependency.ts';
import type { NodeCostProfileRegistry } from './financial/nodeCostRegistry.ts';
import type { OptimizationHealth } from './financial/optimizationHealth.ts';
import { createInMemoryFinancialEventStore } from '../financial/persistence/ports.ts';
import { FINANCIAL_EVENT_SCHEMA } from '../financial/contracts/event.ts';
import { createWorkflowFinancialRecorder } from './financial/workflowFinancialRecorder.ts';
import {
  NODE_COST_REGISTRY_VERSION,
  createNodeCostProfileRegistry,
} from './financial/nodeCostRegistry.ts';
import { createWorkflowReuseResolver } from './financial/workflowReuseResolver.ts';
import { summarizeOptimizationHealth } from './financial/optimizationHealth.ts';
import { WORKFLOW_OPTIMIZATION_POLICY_VERSION } from './financial/nodeCostProfile.ts';

import { systemClock } from '../runtime/clock.ts';
import { systemIdFactory } from '../contracts/ids.ts';
import { createMetrics } from '../observability/metrics.ts';
import { createWorkflowRegistry } from './registry/workflowRegistry.ts';
import {
  createMemoryWorkflowApprovalStore,
  createMemoryWorkflowCheckpointStore,
  createMemoryWorkflowRunStore,
} from './persistence/ports.ts';
import { createWorkflowApprovalGate } from './approvals/workflowApprovalGate.ts';
import { createAgentRuntimeNodePort } from './engine/agentNodePort.ts';
import { createWorkflowOrchestrator } from './engine/workflowOrchestrator.ts';
import { createWorkflowRuntimeService } from './service/workflowRuntimeService.ts';
import { resolveAgentActor } from '../agents/service/agentRbac.ts';

export interface WorkflowRuntimeOptions {
  /** The certified Batch 3A agent runtime. Required — there is no alternative. */
  readonly agentRuntime: AgentRuntime;
  /** The same authenticator the guard and the agent runtime use. */
  readonly authenticator: AIAuthenticator;
  readonly organizationOptions: OrganizationResolutionOptions;
  /** Workflows to register. Part 2 ships none; callers supply their own. */
  readonly workflows?: readonly WorkflowDefinition[];
  /** Durable stores. Omitted, the runtime is isolate-local — tests only. */
  readonly runStore?: WorkflowRunStore;
  readonly checkpointStore?: WorkflowCheckpointStore;
  readonly approvalStore?: WorkflowApprovalStore;
  readonly clock?: Clock;
  readonly ids?: IdFactory;
  readonly logger?: Logger;
  readonly metrics?: Metrics;
  /** See the header. Defaults to the agent runtime's certification switch. */
  readonly requireCertifiedWorkflows?: () => boolean;
  /** Override the agent port. Tests substitute a deterministic one. */
  readonly agentPort?: WorkflowAgentPort;

  // ── Live financial evidence (AI-01 Batch 3B, Integration Pass) ────────────

  /**
   * Durable financial events. Omitted, the recorder is isolate-local.
   *
   * The same call every other store on this assembly makes, and the same
   * consequence: an in-memory store is correct for one isolate and for tests,
   * and a deployment that wants events to outlive an isolate injects the Part 6C
   * KV store.
   */
  readonly financialEventStore?: FinancialEventStore;
  /**
   * The deployment ASKED for durable financial events.
   *
   * Reported separately from whether it got one, because those are different
   * facts and only the gap between them is a degradation — see
   * `financial/optimizationHealth.ts`. Defaults to whether a store was injected,
   * so a caller that does not care cannot accidentally raise a false alarm.
   */
  readonly financialDurableConfigured?: boolean;

  // ── Production optimization wiring (AI-01 Batch 3B) ───────────────────────

  /**
   * The Part 6B reusable-result store. Absent disables production reuse.
   *
   * Supplying it is not the same as enabling reuse: `reuseEnabled` also has to
   * say yes, and the Part 6B eligibility gate still decides every candidate.
   */
  readonly reusableResultStore?: ReusableResultStore;
  /**
   * Consult reuse before a node creates a child. Read LIVE.
   *
   * A function rather than a boolean, for the same reason the kill switch is
   * one: an operator turning reuse off must affect the NEXT node of a run that
   * is already in flight, and a value copied at assembly would wait for an
   * isolate to recycle.
   */
  readonly reuseEnabled?: () => boolean;
  /**
   * A certified semantic discovery port. ABSENT IN THIS REPOSITORY.
   *
   * Nothing here supplies one and nothing here may: adding an embedding provider
   * to decide whether a model call can be avoided would create a second,
   * ungoverned AI execution path. Without it production reuse is exact-only, and
   * the health read says so rather than claiming a discovery path exists.
   */
  readonly semanticDiscovery?: SemanticReuseDiscoveryPort;
  /** The deployment asked for semantic discovery. Reported, not granted. */
  readonly semanticReuseConfigured?: boolean;
  /** Declared semantic labels per node, when a deployment states them. */
  readonly semanticLabelsFor?: (facts: {
    readonly workflowId: string;
    readonly nodeId: string;
    readonly agentId: string;
  }) => { readonly semanticClass: string; readonly features: readonly string[] } | undefined;
  /** Dependency versions the caller can currently see, per node. */
  readonly reuseDependenciesFor?: (facts: {
    readonly workflowId: string;
    readonly nodeId: string;
    readonly agentId: string;
  }) => readonly ReuseDependency[];
  /** Freshness and discovery bounds. Narrow a record's own; never widen it. */
  readonly reuseMaxAgeMs?: number;
  readonly reuseMinimumSimilarity?: number;
  readonly reuseMaximumCandidates?: number;
  /**
   * Declared facts about a node, for the production cost-profile registry.
   *
   * Absent, the registry derives from the agent alone. Supplying it lets the
   * registry read the node's own declared output contract, which is the one node
   * fact that changes a descriptor.
   */
  readonly nodeFactsFor?: (facts: {
    readonly workflowId: string;
    readonly nodeId: string;
  }) => { readonly declaresOutputContract: boolean } | undefined;
  /**
   * Replace the whole cost-profile registry. Tests and fixtures only.
   *
   * Production builds one from the agent registry and the model profile
   * catalogue — see `financial/nodeCostRegistry.ts`.
   */
  readonly nodeCostRegistry?: NodeCostProfileRegistry;
  /**
   * What a deployment declares about a node's economics.
   *
   * Absent, every node gets `nodeCostProfile.ts`'s conservative defaults, which
   * claim NO saving — a truthful cost against a single-band envelope. Savings
   * appear when a deployment declares the facts that justify them, and never
   * because an integration defaulted its way into a flattering number.
   */
  readonly nodeCostProfileFor?: (facts: {
    readonly workflowId: string;
    readonly nodeId: string;
    readonly agentId: string;
  }) => WorkflowNodeCostProfile | undefined;
  /**
   * The Part 6B reuse resolver. Absent disables reuse for this deployment.
   *
   * Absent BY DEFAULT, deliberately. Resolving a reuse hit needs a
   * reusable-result store, a task fingerprint, dependency declarations and a
   * freshness policy — the things Part 6B built and the things a deployment must
   * supply. Defaulting one here would mean every deployment silently acquired a
   * cache in front of its model calls.
   */
  readonly reuseResolver?: WorkflowReuseResolver;
  /**
   * Replace the whole financial port. Tests and disabled deployments only.
   *
   * `createNoopWorkflowFinancialPort()` is the explicit way to switch recording
   * off; the engine's behaviour is identical with it, because a port that
   * decides nothing produces the same `undefined` a missing envelope does.
   */
  readonly financialPort?: WorkflowFinancialPort;
  /**
   * Wrap the assembled recorder. Crash simulations only.
   *
   * The symmetric counterpart to `agentPort`, and it exists for one reason: a
   * crash-window test has to be able to say "this isolate died before it wrote
   * the settlement" without the engine knowing anything unusual happened. A
   * wrapper that drops one method is the smallest honest way to say that, and it
   * keeps every other component on the path production code.
   */
  readonly wrapFinancialPort?: (port: WorkflowFinancialPort) => WorkflowFinancialPort;
}

export interface WorkflowRuntime {
  readonly registry: WorkflowRegistry;
  readonly orchestrator: WorkflowOrchestrator;
  readonly service: WorkflowRuntimeService;
  readonly runs: WorkflowRunStore;
  readonly checkpoints: WorkflowCheckpointStore;
  readonly approvalStore: WorkflowApprovalStore;
  /**
   * The approval gate.
   *
   * Exposed so an operator surface can read the queue and so the service can
   * record a decision. Note what is NOT exposed: the engine's own use of it.
   * There is one gate, both paths go through it, and the single-use guarantee
   * is a property of the store beneath it rather than of who called.
   */
  readonly approvals: WorkflowApprovalGate;
  readonly agents: WorkflowAgentPort;
  /**
   * The one path from execution to canonical financial evidence.
   *
   * Exposed so an operator surface and the Part 6C read models can be pointed at
   * the same events the engine wrote. Note what is exposed: the PORT and the
   * STORE, never a total — every figure is folded from the events on read, so
   * there is nothing here for a second accumulator to disagree with.
   */
  readonly financial: WorkflowFinancialPort;
  readonly financialEvents: FinancialEventStore;
  /** The node cost-profile derivation in force. Read by the health surface. */
  readonly nodeCostRegistry: NodeCostProfileRegistry;
  /** The administrative and health facts the engine reads per advance. */
  state(): WorkflowRuntimeState;
  /**
   * What the optimisation path actually obtained, versus what it was asked for.
   *
   * Read LIVE, because `reuseEnabled` is an operator switch and a value copied
   * at assembly would report a stale posture during the incident it exists for.
   * Booleans, counts and version strings only — see
   * `financial/optimizationHealth.ts` for what it deliberately cannot leak.
   */
  optimizationHealth(): OptimizationHealth;
}

export function createWorkflowRuntime(options: WorkflowRuntimeOptions): WorkflowRuntime {
  const clock = options.clock ?? systemClock;
  const ids = options.ids ?? systemIdFactory;
  const metrics = options.metrics ?? createMetrics();
  const logger = options.logger ?? console_fallback();

  /**
   * The live administrative and health view.
   *
   * Read through a function on every advance rather than captured once. An
   * operator who engages the emergency stop must stop the NEXT node of a run
   * that is already in flight, and a value copied at assembly would wait for an
   * isolate to recycle — which for an emergency stop is the same as not having
   * one.
   */
  const state = (): WorkflowRuntimeState => {
    const agentState = options.agentRuntime.state();
    return {
      aiEnabled: agentState.aiEnabled,
      executionAvailable: agentState.executionAvailable,
      requireCertifiedWorkflows:
        options.requireCertifiedWorkflows?.() ?? agentState.requireCertifiedAgents,
      configurationVersion: agentState.configurationVersion,
    };
  };

  const registry = createWorkflowRegistry({
    requireCertification: () => state().requireCertifiedWorkflows,
    // Registration-time agent resolution. `find` rather than `require`, because
    // "this agent exists" and "this agent may run right now" are different
    // questions: a workflow naming a temporarily disabled agent is still a
    // valid workflow, and the agent runtime refuses the node at execution.
    agentExists: (agentId) => options.agentRuntime.registry.find(agentId) !== undefined,
  });
  if (options.workflows?.length) registry.registerAll(options.workflows);

  const runs = options.runStore ?? createMemoryWorkflowRunStore();
  const checkpoints = options.checkpointStore ?? createMemoryWorkflowCheckpointStore();
  const approvalStore = options.approvalStore ?? createMemoryWorkflowApprovalStore();
  // ONE GATE, shared by the engine and the service. Two would be two writers
  // to one store with two ideas about single use, and the compare-and-swap
  // beneath them would be the only thing keeping them honest.
  const approvals = createWorkflowApprovalGate({ store: approvalStore, clock });
  const agents =
    options.agentPort ?? createAgentRuntimeNodePort(options.agentRuntime.orchestrator);

  const financialEvents = options.financialEventStore ?? createInMemoryFinancialEventStore();

  /**
   * THE ONE PLACE THE AGENT REGISTRY IS READ FOR LIMITS.
   *
   * The workflow tree cannot import the agent registry — the boundary scan
   * asserts that on the source, and this assembly is one of the two exempt
   * modules. So the ceilings a baseline is priced against come from the AGENT'S
   * OWN declared limits, resolved here and handed to the recorder as a function.
   *
   * An agent the registry does not hold yields `undefined`, and the recorder then
   * produces no decision and no event for its nodes. That is the honest outcome:
   * a baseline priced against an envelope nobody declared is a savings
   * denominator nobody could defend, and it is exactly the figure an adversarial
   * reviewer would attack first.
   */
  const agentLimitsFor = (agentId: string): WorkflowNodeLimits | undefined => {
    const definition = options.agentRuntime.registry.find(agentId);
    if (definition === undefined) return undefined;
    const limits = definition.limits;
    return {
      maxPromptTokens: limits.maxPromptTokens,
      maxCompletionTokens: limits.maxCompletionTokens,
      maxTotalTokens: limits.maxTotalTokens,
      // The ACTUAL ceiling, not the estimated one. It is what the tenant may
      // really spend on this agent, which is what an envelope's remaining cost
      // means — and the smaller of the two would understate nothing but the
      // headroom the optimiser is allowed to see.
      maxActualCostMicroUsd: limits.maxActualCostMicroUsd,
    };
  };

  /**
   * THE OTHER PLACE THE AGENT REGISTRY IS READ, AND THE ONLY ONE THAT READS
   * THE MODEL PROFILE CATALOGUE (AI-01 Batch 3B, Production Optimization
   * Wiring).
   *
   * `nodeCostRegistry.ts` derives a node's economics from declared facts and
   * cannot reach a registry to obtain them — the boundary scan permits the
   * workflow tree only pure contracts from `agents/`, and this assembly is one
   * of the two exempt modules. So the facts are RESOLVED here and handed over as
   * plain values.
   *
   * Every one of them is something a human declared and a validator accepted:
   * the agent's safety class, its capabilities, its own token ceilings and the
   * model profiles it is permitted to request. `unresolvedModelProfiles` counts
   * the ids the catalogue could not resolve, which is what makes the registry
   * collapse a node's band list rather than guess at a cheaper band it cannot
   * see.
   */
  const nodeCostRegistry =
    options.nodeCostRegistry ??
    createNodeCostProfileRegistry({
      agentFactsFor: (agentId) => {
        const definition = options.agentRuntime.registry.find(agentId);
        if (definition === undefined) return undefined;
        const limits = agentLimitsFor(agentId);
        if (limits === undefined) return undefined;

        const approved = [];
        let unresolved = 0;
        for (const profileId of definition.allowedModelProfiles) {
          const profile = options.agentRuntime.profiles.find(profileId);
          if (profile === undefined) {
            unresolved += 1;
            continue;
          }
          approved.push({
            profileId: profile.profileId,
            quality: profile.quality,
            complexity: profile.complexity,
            requiresStructuredOutput: profile.requiresStructuredOutput,
            maxCompletionTokens: profile.maxCompletionTokens,
            rank: profile.rank,
          });
        }

        return {
          agentId: definition.agentId,
          agentVersion: definition.version,
          safetyClass: definition.safetyClass,
          capabilities: definition.capabilities,
          limits,
          approvedModelProfiles: approved,
          unresolvedModelProfiles: unresolved,
        };
      },
      nodeFactsFor: (facts) =>
        options.nodeFactsFor?.({ workflowId: facts.workflowId, nodeId: facts.nodeId }),
      // A deployment's own declaration, applied on top and NARROWED. See
      // `narrowNodeCostProfile` — an override may not raise the maximum band,
      // add a band the agent has no approved profile for, or lower the quality
      // contract, and every clamp is reported.
      ...(options.nodeCostProfileFor === undefined
        ? {}
        : {
            overrideFor: (facts) =>
              options.nodeCostProfileFor?.({
                workflowId: facts.workflowId,
                nodeId: facts.nodeId,
                agentId: facts.agentId,
              }),
          }),
      onOverrideNarrowed: (facts, detail) => {
        metrics.increment('ai.workflow.cost_profile.narrowed', { workflow: facts.workflowId });
        logger.warn('ai.workflow.cost_profile.narrowed', {
          workflowId: facts.workflowId,
          nodeId: facts.nodeId,
          agentId: facts.agentId,
          registryVersion: NODE_COST_REGISTRY_VERSION,
          diagnostics: detail,
        });
      },
    });
  // ── Production reuse (AI-01 Batch 3B) ─────────────────────────────────────
  //
  // Assembled only when a deployment supplied a reusable-result store. An
  // explicit `reuseResolver` still wins — a test substitutes one — and absent
  // both, `reuse` is left off the recorder entirely, which is the same shape
  // Part 6B's own default has: no store, no cache, every node executes.
  const reuseEnabled = options.reuseEnabled ?? (() => options.reusableResultStore !== undefined);
  const assembledReuse: WorkflowReuseResolver | undefined =
    options.reuseResolver ??
    (options.reusableResultStore === undefined
      ? undefined
      : createWorkflowReuseResolver({
          store: options.reusableResultStore,
          ...(options.semanticDiscovery === undefined
            ? {}
            : { discovery: options.semanticDiscovery }),
          ...(options.semanticLabelsFor === undefined
            ? {}
            : {
                semanticFor: (facts) =>
                  options.semanticLabelsFor?.({
                    workflowId: facts.workflowId,
                    nodeId: facts.nodeId,
                    agentId: facts.agentId,
                  }),
              }),
          // READ LIVE. The kill switch and the reuse switch are both consulted
          // on every resolution, so an operator's emergency stop makes the next
          // node execute rather than be answered from a cache.
          posture: () => {
            const live = state();
            return {
              aiEnabled: live.aiEnabled,
              reuseEnabled: reuseEnabled(),
              controlPlanePostureVersion: `ai.settings.v${String(live.configurationVersion)}`,
            };
          },
          agentFactsFor: (facts) => {
            const definition = options.agentRuntime.registry.find(facts.agentId);
            if (definition === undefined) return undefined;
            // THE QUALITY CONTRACT THE COST REGISTRY DERIVED FOR THIS NODE, not
            // a second one. Two answers to "what quality is this node held to"
            // would let a reused result clear the gate at a bar the baseline was
            // never priced against, so the registry is asked with the same facts
            // the recorder will price the node with.
            const profile = nodeCostRegistry.profileFor(facts);
            return {
              agentVersion: definition.version,
              // The certification STATUS, named as the identity of the
              // certification the record must have been produced under. A
              // revoked or downgraded agent therefore stops matching its own
              // stored results rather than continuing to serve them.
              agentCertificationId: `${definition.agentId}@${definition.version}:${definition.certification}`,
              quality: profile?.quality ?? 'standard',
              minimumCapabilityProfile: profile?.maximumCapabilityProfile ?? 'standard',
            };
          },
          /**
           * AUTHORITY AS EVIDENCE, RESOLVED FROM WHAT THE PLATFORM ESTABLISHED.
           *
           * Not an assumption, and not a grant. Each field is a verdict the
           * component that owns it already reached:
           *
           *   the run was ADMITTED by the workflow service's RBAC, which is why
           *   an advance is happening at all;
           *   the workflow is registered, enabled and passes the certification
           *   bar in force;
           *   the agent is registered, enabled and certified;
           *   an agent node declares no approval requirement of its own — an
           *   approval barrier is a separate node kind, and the run cannot have
           *   reached this node without passing it.
           *
           * Any one of them failing returns `undefined`, and the gate's rule
           * applies: an unsupplied dimension is a miss, so the node executes and
           * pays rather than being answered from a cache.
           */
          authorityFor: (facts) => {
            const definition = options.agentRuntime.registry.find(facts.agentId);
            if (definition === undefined || !definition.enabled) return undefined;
            const workflow = registry.find(facts.workflowId);
            if (workflow === undefined || !workflow.enabled) return undefined;
            const certified = definition.certification === 'certified';
            if (!certified && state().requireCertifiedWorkflows) return undefined;
            if (definition.certification === 'revoked') return undefined;
            return {
              callerAuthorized: true,
              authorizationEvidenceId: `wf:${facts.workflowRunId}:${facts.actorId}`,
              workflowPermitted: workflow.version === facts.workflowVersion,
              agentPermitted: definition.enabled,
              approvalSatisfied: true,
              certificationValid: certified,
            };
          },
          ...(options.reuseDependenciesFor === undefined
            ? {}
            : {
                currentDependenciesFor: (facts) =>
                  options.reuseDependenciesFor?.({
                    workflowId: facts.workflowId,
                    nodeId: facts.nodeId,
                    agentId: facts.agentId,
                  }) ?? [],
              }),
          ...(options.reuseMaxAgeMs === undefined || options.reuseMaxAgeMs <= 0
            ? {}
            : { maximumAgeMs: options.reuseMaxAgeMs }),
          ...(options.reuseMinimumSimilarity === undefined
            ? {}
            : { minimumSimilarity: options.reuseMinimumSimilarity }),
          ...(options.reuseMaximumCandidates === undefined
            ? {}
            : { maximumCandidates: options.reuseMaximumCandidates }),
          now: () => clock.now(),
          logger,
          metrics,
        }));

  const assembledFinancial =
    options.financialPort ??
    createWorkflowFinancialRecorder({
      store: financialEvents,
      // The REGISTRY'S limits, which are the agent's own with the completion
      // allowance clamped down to what its approved model profiles can emit.
      // A narrowing, always — and it lowers the baseline rather than raising it.
      limitsFor: (agentId) => nodeCostRegistry.limitsFor(agentId),
      profileFor: (facts) => nodeCostRegistry.profileFor(facts),
      ...(assembledReuse === undefined ? {} : { reuse: assembledReuse }),
      // Read LIVE, through the same view the engine reads. An operator engaging
      // the emergency stop must make the next plan a refusal, and a value copied
      // at assembly would wait for an isolate to recycle.
      aiEnabled: () => state().aiEnabled,
      logger,
      metrics,
    });

  const financial = options.wrapFinancialPort
    ? options.wrapFinancialPort(assembledFinancial)
    : assembledFinancial;

  const orchestrator = createWorkflowOrchestrator({
    registry,
    runs,
    checkpoints,
    approvals,
    agents,
    financial,
    clock,
    ids,
    logger,
    metrics,
    runtimeState: state,
  });

  const service = createWorkflowRuntimeService({
    orchestrator,
    registry,
    runs,
    approvals,
    authenticator: options.authenticator,
    organizationOptions: options.organizationOptions,
    clock,
    ids,
    // The agent runtime's OWN grant table, called through its own resolver.
    // A copy of it here would be a second answer to "what may this person do
    // with an agent", and the two would drift the first time either changed.
    agentCapabilitiesFor: (subject, organizationId) =>
      agentCapabilitiesFor(subject, organizationId, options.organizationOptions),
  });

  for (const issue of registry.validate()) {
    logger.warn('ai.workflow.registry.issue', { issue });
  }

  // ── The degraded-state report, computed from what was ASSEMBLED ───────────
  //
  // `financialDurableConfigured` defaults to "a store was injected", so a
  // caller that never asked for durability cannot raise a false alarm, and a
  // deployment that asked and did not get one is reported as degraded even
  // though every run still executes normally. That gap is the whole point: a
  // fail-open recorder makes an unreachable ledger invisible from the outside,
  // and this is the read that makes it visible again.
  const financialDurableConfigured =
    options.financialDurableConfigured ?? options.financialEventStore !== undefined;
  const optimizationHealth = (): OptimizationHealth =>
    summarizeOptimizationHealth({
      financialDurableConfigured,
      financialDurableAvailable: options.financialEventStore !== undefined,
      reuseConfigured: reuseEnabled(),
      reuseStoreAvailable: options.reusableResultStore !== undefined,
      exactReuseWired: assembledReuse !== undefined,
      semanticConfigured: options.semanticReuseConfigured ?? false,
      // AVAILABLE ONLY WITH A REAL PORT. A switch is a request, not a capability
      // — this repository ships no certified embedding or retrieval path, and
      // reporting one because a flag is on would be the single place this read
      // could lie.
      semanticDiscoveryAvailable: options.semanticDiscovery !== undefined,
      costProfileRegistryVersion: nodeCostRegistry.version,
      optimizationPolicyVersion: WORKFLOW_OPTIMIZATION_POLICY_VERSION,
      financialEventPolicyVersion: FINANCIAL_EVENT_SCHEMA,
    });

  const health = optimizationHealth();
  if (health.degraded) {
    metrics.increment('ai.workflow.optimization.degraded', {});
    logger.error('ai.workflow.optimization.degraded', {
      durableFinancialStore: health.durableFinancialStore.available,
      reuseStore: health.reuseStore.available,
      exactReuse: health.exactReuse.available,
      semanticDiscovery: health.semanticDiscovery.available,
      costProfileRegistryVersion: health.costProfileRegistryVersion,
    });
  }

  return {
    registry,
    orchestrator,
    service,
    runs,
    checkpoints,
    approvalStore,
    approvals,
    agents,
    financial,
    financialEvents,
    nodeCostRegistry,
    state,
    optimizationHealth,
  };
}

/**
 * Agent capabilities for a subject, or none.
 *
 * A subject the agent runtime refuses gets an EMPTY capability list rather than
 * an exception, so a person who may read workflows but not run agents can still
 * read them. The refusal then happens where it belongs — at the first node, by
 * the Agent Orchestrator — instead of turning every workflow read into an
 * agent-runtime authorization check.
 */
function agentCapabilitiesFor(
  subject: AuthenticatedSubject | null,
  organizationId: string,
  organizationOptions: OrganizationResolutionOptions,
): readonly string[] {
  try {
    return resolveAgentActor(subject, organizationId, organizationOptions).capabilities;
  } catch {
    return [];
  }
}

/** A logger is always injected in practice; this keeps the option honest. */
function console_fallback(): Logger {
  const noop = () => {};
  const logger: Logger = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => logger,
  };
  return logger;
}
