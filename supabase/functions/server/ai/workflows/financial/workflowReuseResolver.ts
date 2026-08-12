/**
 * The production reuse resolver
 * (AI-01 Batch 3B, Production Optimization Wiring).
 *
 * ── WHAT THIS IS, AND WHAT IT IS NOT ───────────────────────────────────────
 *
 * It is the ADAPTER that lets the Workflow Orchestrator ask Part 6B a question.
 * It builds a `ReuseEligibilityRequest` out of facts the engine and the assembly
 * already established, calls `resolveReuse`, and hands back the resolution's own
 * verdict. It is not a second reuse engine, not a second cache and not a second
 * eligibility rule:
 *
 *   IT DECIDES NOTHING. `evaluateReuseEligibility`, inside `resolveReuse`,
 *   produces the verdict. There is no branch in this file that reaches a hit
 *   without one, and no argument this file passes that relaxes a dimension.
 *
 *   IT DISCOVERS NOTHING BY SIMILARITY. Semantic discovery happens only when a
 *   deployment injects a certified `SemanticReuseDiscoveryPort`. This repository
 *   ships no embedding or retrieval path, and this file adds none — see
 *   `reuse/discovery/semanticDiscoveryPort.ts` for the finding. Absent a port,
 *   production reuse is EXACT ONLY, which is the majority of the value and all
 *   of the certainty.
 *
 *   IT STORES NOTHING. Sealing a result into the reusable store is a separate
 *   act with its own authority, and it is not wired here: this pass makes the
 *   platform able to USE what it holds, and a production writer is Batch 3C's.
 *   The consequence is stated rather than hidden — on a deployment that seals no
 *   results, every production resolution is a truthful miss.
 *
 * ── THE FOUR THINGS IT REFUSES BEFORE IT ASKS ──────────────────────────────
 *
 * Cheap refusals, taken here so a store read never happens for a request that
 * could not have produced a hit anyway. Every one of them is ALSO checked by the
 * gate; the duplication is deliberate, because the cheapest way to guarantee no
 * cross-tenant read is to not perform one.
 *
 *   NO INPUT DIGEST → NO REUSE. `facts.inputDigest` is what binds the exact key
 *   to the question actually being asked. Without it the key would bind the node
 *   and the policy versions only, and two runs asking different questions of the
 *   same node would share one answer. The engine leaves it absent when it could
 *   not build the node's input; a resolver that carried on regardless would turn
 *   an engine-side gap into a wrong answer served to a tenant.
 *
 *   NO AGENT RUN MAY ALREADY EXIST. A node whose child was already created has
 *   already made the call. The recorder enforces this too — see `decideNode` —
 *   and it is restated here so the store is not read for an attempt whose
 *   avoidance is structurally impossible.
 *
 *   THE POSTURE IS READ LIVE, NEVER CACHED. `aiEnabled` and `reuseEnabled` are
 *   read on every resolution through the same view the engine reads. IF THE KILL
 *   SWITCH PROHIBITS THE OPERATION, CACHED OUTPUT MUST NOT SATISFY IT — an
 *   emergency stop is a statement about the operation, not about the billing —
 *   and both switches are passed to the gate as posture evidence rather than
 *   being re-decided here.
 *
 *   AUTHORITY IS EVIDENCE, NOT AN ASSUMPTION. The assembly resolves it from the
 *   registries it is the one module permitted to read. A resolver that could not
 *   obtain authority evidence produces a MISS, and the node executes and pays.
 *
 * ── A FAILURE IS ALWAYS A MISS ─────────────────────────────────────────────
 *
 * `resolveReuse` never throws; this file catches anything that could reach it
 * from an identity construction and reports a miss. FAILING TOWARDS EXECUTION
 * COSTS MONEY; FAILING TOWARDS REUSE SERVES A STALE ANSWER BECAUSE A STORE WAS
 * UNREACHABLE. Only one of those is recoverable.
 */

import type { Logger } from '../../observability/logger.ts';
import type { Metrics } from '../../observability/metrics.ts';
import type {
  CapabilityProfile,
  QualityProfile,
} from '../../optimization/contracts/compression.ts';
import type {
  ReuseAuthorityEvidence,
  ReuseMissReason,
} from '../../reuse/contracts/eligibility.ts';
import type { ReuseDependency } from '../../reuse/contracts/dependency.ts';
import type { ReusableResultStore } from '../../reuse/persistence/ports.ts';
import type { SemanticReuseDiscoveryPort } from '../../reuse/discovery/semanticDiscoveryPort.ts';
import { buildReuseIdentity, sealSemanticMetadata } from '../../reuse/identity/reuseIdentity.ts';
import { resolveReuse } from '../../reuse/engine/reuseDecisionPipeline.ts';
import { digestValue } from '../../agents/runtime/digest.ts';
import type { WorkflowNodeFinancialFacts } from './contracts/emission.ts';
import type {
  WorkflowReuseCandidate,
  WorkflowReuseResolver,
} from './workflowFinancialRecorder.ts';
import { WORKFLOW_OPTIMIZATION_POLICY_VERSION, workflowPolicyVersionFor } from './nodeCostProfile.ts';

/** The baseline policy every workflow event is priced under. Part 6A's own. */
export const WORKFLOW_BASELINE_POLICY_VERSION = 'baseline.v1';

/**
 * The declared task kind a node's reuse identity is scoped by.
 *
 * Fixed, and deliberately not derived. It has to agree with whatever a producer
 * sealed under, and a value derived per node from facts a producer does not see
 * would partition the cache silently the first time either side changed.
 */
export const WORKFLOW_REUSE_TASK_KIND = 'workflow_node';

/** The posture the gate is handed. Read live, never cached, never decided here. */
export interface WorkflowReusePosture {
  readonly aiEnabled: boolean;
  /** The narrower switch. False disables reuse without disabling the platform. */
  readonly reuseEnabled: boolean;
  readonly controlPlanePostureVersion: string;
}

/** What the assembly established about the agent behind one node. */
export interface WorkflowReuseAgentFacts {
  readonly agentVersion: string;
  readonly agentCertificationId: string;
  /** The quality contract the node is held to, from the cost-profile registry. */
  readonly quality: QualityProfile;
  /** The band a reused answer must have cleared. */
  readonly minimumCapabilityProfile: CapabilityProfile;
}

export interface WorkflowReuseResolverOptions {
  readonly store: ReusableResultStore;
  /**
   * The certified semantic discovery port. ABSENT BY DEFAULT.
   *
   * Absent, discovery never runs and `resolveReuse` reports a normal miss rather
   * than a degradation — a deployment without a certified retrieval path is not
   * a broken deployment, it is one with exact reuse only.
   */
  readonly discovery?: SemanticReuseDiscoveryPort;
  /** Declared semantic labels for a node, when a deployment states them. */
  semanticFor?: (
    facts: WorkflowNodeFinancialFacts,
  ) => { readonly semanticClass: string; readonly features: readonly string[] } | undefined;
  /** Read live on every resolution. */
  posture(): WorkflowReusePosture;
  /** Resolved by the assembly from the registries. `undefined` refuses reuse. */
  agentFactsFor(agentId: string): WorkflowReuseAgentFacts | undefined;
  /**
   * The authorization the caller ALREADY established, as evidence.
   *
   * `undefined` means the assembly could not establish it, and the gate's rule
   * applies: an unsupplied dimension is a miss, never a default.
   */
  authorityFor(facts: WorkflowNodeFinancialFacts): ReuseAuthorityEvidence | undefined;
  /**
   * The dependency versions the caller can currently see.
   *
   * A declared dependency absent from this set is `unknown` to the gate and
   * therefore a miss. An empty list is the truthful answer for a deployment that
   * declares no dependencies, and it is not a weakening: a record sealed with
   * dependencies still refuses against it.
   */
  currentDependenciesFor?: (facts: WorkflowNodeFinancialFacts) => readonly ReuseDependency[];
  /** Freshness bounds already part of Part 6B. Narrows, never widens, a record's own. */
  readonly maximumAgeMs?: number;
  readonly requireImmutable?: boolean;
  /** 0–100. A candidate below this is never returned by discovery. */
  readonly minimumSimilarity?: number;
  readonly maximumCandidates?: number;
  /** The engine's clock. Nothing under the gate reads one. */
  now(): number;
  readonly logger: Logger;
  readonly metrics: Metrics;
}

const DEFAULT_MINIMUM_SIMILARITY = 80;
const DEFAULT_MAXIMUM_CANDIDATES = 5;

export function createWorkflowReuseResolver(
  options: WorkflowReuseResolverOptions,
): WorkflowReuseResolver {
  const { logger, metrics } = options;

  function miss(facts: WorkflowNodeFinancialFacts, reason: ReuseMissReason | string): undefined {
    metrics.increment('ai.workflow.reuse.miss', {
      workflow: facts.workflowId,
      reason: String(reason),
    });
    return undefined;
  }

  return {
    async resolve(facts) {
      // ── The four cheap refusals. See the header. ─────────────────────────
      if (facts.agentRunId !== undefined) return miss(facts, 'call_already_exists');
      if (facts.inputDigest === undefined || facts.inputDigest === '') {
        return miss(facts, 'input_digest_unavailable');
      }

      const posture = options.posture();
      if (!posture.aiEnabled) return miss(facts, 'ai_disabled');
      if (!posture.reuseEnabled) return miss(facts, 'reuse_disabled');

      const agent = options.agentFactsFor(facts.agentId);
      if (agent === undefined) return miss(facts, 'agent_facts_unavailable');

      const authority = options.authorityFor(facts);
      if (authority === undefined) return miss(facts, 'evidence_unavailable');

      const policyVersion = workflowPolicyVersionFor(facts.configurationVersion);
      const taskIdentity = `${facts.workflowId}/${facts.nodeId}`;
      const currentDependencies = options.currentDependenciesFor?.(facts) ?? [];

      let resolution;
      try {
        const identity = buildReuseIdentity({
          organizationId: facts.organizationId,
          taskIdentity,
          taskKind: WORKFLOW_REUSE_TASK_KIND,
          workflowId: facts.workflowId,
          workflowVersion: facts.workflowVersion,
          ...(facts.planDigest === undefined ? {} : { workflowPlanDigest: facts.planDigest }),
          agentId: facts.agentId,
          agentVersion: agent.agentVersion,
          agentCertificationId: agent.agentCertificationId,
          policyVersion,
          optimizationPolicyVersion: WORKFLOW_OPTIMIZATION_POLICY_VERSION,
          baselinePolicyVersion: WORKFLOW_BASELINE_POLICY_VERSION,
          quality: agent.quality,
          minimumCapabilityProfile: agent.minimumCapabilityProfile,
          inputDigest: facts.inputDigest,
          // Dependencies are DECLARED by whoever sealed the record. The resolver
          // states which versions it can currently see and never which the
          // record must have had — see `currentDependenciesFor`.
          evidenceDependencies: [],
          dataDependencies: [],
        });

        const semantic = resolveSemantic(facts);

        resolution = await resolveReuse({
          store: options.store,
          eligibility: {
            organizationId: facts.organizationId,
            taskId: `${facts.workflowRunId}:${facts.nodeId}:${facts.branchId ?? '-'}`,
            identity,
            authority,
            posture: {
              aiEnabled: posture.aiEnabled,
              reuseEnabled: posture.reuseEnabled,
              controlPlanePostureVersion: posture.controlPlanePostureVersion,
            },
            policy: {
              policyVersion,
              // NO COMPATIBILITY DECLARED. A cached result satisfies the current
              // policy only by being current. Widening this is a deployment's
              // explicit act, and this pass does not take it on the platform's
              // behalf — a stale-policy answer is exactly what an operator who
              // hardened a policy expected to stop seeing.
              compatiblePolicyVersions: [],
              optimizationPolicyVersion: WORKFLOW_OPTIMIZATION_POLICY_VERSION,
              compatibleOptimizationPolicyVersions: [],
              baselinePolicyVersion: WORKFLOW_BASELINE_POLICY_VERSION,
              compatibleBaselinePolicyVersions: [],
            },
            version: {
              taskIdentity,
              taskKind: WORKFLOW_REUSE_TASK_KIND,
              workflowId: facts.workflowId,
              workflowVersion: facts.workflowVersion,
              compatibleWorkflowVersions: [],
              ...(facts.planDigest === undefined ? {} : { workflowPlanDigest: facts.planDigest }),
              // The plan digest is REQUIRED when the run carries one. A workflow
              // whose plan changed is a different workflow, and a stored answer
              // from the old plan is not an answer to the new one.
              planDigestRequired: facts.planDigest !== undefined,
              agentId: facts.agentId,
              agentVersion: agent.agentVersion,
              compatibleAgentVersions: [],
              agentCertificationId: agent.agentCertificationId,
            },
            quality: {
              quality: agent.quality,
              minimumCapabilityProfile: agent.minimumCapabilityProfile,
            },
            freshness: {
              nowMs: options.now(),
              ...(options.maximumAgeMs === undefined ? {} : { maximumAgeMs: options.maximumAgeMs }),
              ...(options.requireImmutable === undefined
                ? {}
                : { requireImmutable: options.requireImmutable }),
            },
            currentDependencies,
          },
          ...(semantic === undefined || options.discovery === undefined
            ? {}
            : { discovery: options.discovery, semantic }),
        });
      } catch (error) {
        // An identity that will not build is a miss, never a hit. It is also a
        // deployment defect rather than a cache condition, so it is logged.
        metrics.increment('ai.workflow.reuse.degraded', { workflow: facts.workflowId });
        logger.warn('ai.workflow.reuse.degraded', {
          workflowRunId: facts.workflowRunId,
          workflowId: facts.workflowId,
          nodeId: facts.nodeId,
          diagnostics: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      }

      const priorOutput = resolution.priorOutput;
      const record = resolution.record;
      const verdict = resolution.verdict;
      if (
        priorOutput === undefined ||
        record === undefined ||
        verdict === undefined ||
        resolution.reuseType === undefined
      ) {
        return miss(facts, resolution.missReason ?? 'no_candidate');
      }

      // TENANCY, RESTATED ON THE WAY OUT. The gate checked it and the store is
      // tenant-scoped; this refuses a record that somehow arrived anyway, because
      // the cost of the check is one comparison and the cost of missing it is
      // one tenant's answer delivered to another.
      if (record.organizationId !== facts.organizationId) {
        metrics.increment('ai.workflow.reuse.tenant_refused', { workflow: facts.workflowId });
        logger.error('ai.workflow.reuse.tenant_refused', {
          workflowRunId: facts.workflowRunId,
          workflowId: facts.workflowId,
          nodeId: facts.nodeId,
        });
        return undefined;
      }

      metrics.increment('ai.workflow.reuse.hit', {
        workflow: facts.workflowId,
        type: resolution.reuseType,
      });

      const candidate: WorkflowReuseCandidate = {
        priorOutput,
        reuseType: resolution.reuseType,
        reusableResultId: record.reusableResultId,
        // Recomputable from the stored verdict, which is what makes it evidence
        // rather than a label an auditor has to take on trust.
        eligibilityEvidenceDigest: digestValue(verdict),
        sourceOriginalCostMicroUsd: record.originalActualCostMicroUsd,
        // RAW. The node's own declared output contract accepts or refuses it —
        // see `completeAvoidedNode`. A reused value is governed exactly as a
        // generated one, and never more loosely.
        output: record.output.fields,
      };
      return candidate;
    },
  };

  /** Declared labels only. Nothing here is derived from text. */
  function resolveSemantic(facts: WorkflowNodeFinancialFacts) {
    const declared = options.semanticFor?.(facts);
    if (declared === undefined) return undefined;
    try {
      const sealed = sealSemanticMetadata(declared.semanticClass, declared.features);
      return {
        semanticClass: sealed.semanticClass,
        features: sealed.features,
        semanticFingerprint: sealed.semanticFingerprint,
        minimumSimilarity: options.minimumSimilarity ?? DEFAULT_MINIMUM_SIMILARITY,
        maximumCandidates: options.maximumCandidates ?? DEFAULT_MAXIMUM_CANDIDATES,
      };
    } catch {
      // Malformed declared labels disable DISCOVERY for this request. Exact
      // reuse still runs, because a bad label says nothing about an exact key.
      return undefined;
    }
  }
}
