/**
 * The diagnostic review capability, assembled (AI-01 Batch 3B, Part 7B).
 *
 * ONE FUNCTION THAT BUILDS THE WHOLE THING BY EXPLICIT INJECTION, so a test can
 * assemble the real tools over real stores with a hand-driven clock, and a
 * deployment can assemble the same tools over durable ones. The same shape
 * `createAgentRuntime` and `createWorkflowRuntime` use, for the same reason.
 *
 * ── THE CERTIFICATION POSTURE, IN ONE PLACE ────────────────────────────────
 *
 * The agent, its five tools and the review workflow are CERTIFIED, under the
 * human certification decision recorded in `agent/readinessManagerAgent.ts`.
 * They shipped uncertified and disabled through Parts 7A–7D; a person read the
 * evidence and flipped the flags for this chain and nothing else.
 *
 * CERTIFICATION IS NOT ACTIVATION, and the distinction is the whole of the
 * controlled-rollout posture:
 *
 *   certification   removes the registry's and the gateway's refusal. It grants
 *                   no authority. Every capability, tool, role and limit is the
 *                   one the definitions already declared.
 *   activation      is a deployment decision, made once, in `bootstrap.ts`,
 *                   behind `AI_DIAGNOSTIC_REVIEW_ENABLED` (off by default) and
 *                   conditional on durable storage and an injected submission
 *                   source. A deployment that turns nothing on registers
 *                   nothing.
 *
 * `uncertifyForTesting` exists so a suite can still prove what the registry and
 * the gateway do to an UNCERTIFIED definition — the refusals are the reason
 * certification means anything, and they would otherwise become untestable the
 * moment the shipped definitions were certified. It returns COPIES with the
 * flags cleared and mutates nothing.
 *
 * ── WHAT THIS MODULE DOES NOT DO ───────────────────────────────────────────
 *
 * It does not register anything. It returns definitions, and whoever assembles
 * a runtime decides what to do with them. A capability that registered itself
 * would be a capability whose presence in a deployment could not be reviewed by
 * reading that deployment's assembly.
 *
 * ── AND IT NO LONGER DEFAULTS TO MEMORY (Part 7D, F2) ──────────────────────
 *
 * `storage` is REQUIRED and it is a key-value port with compare-and-swap. There
 * is no in-memory fallback, no optional store parameter and no way to assemble
 * this capability over anything that can evict a committed review. The reason
 * is that the committed review is both the business record of record and the
 * row the commit tool reads to refuse a replay: an eviction reopens the replay
 * window on an approval that has already been spent.
 *
 * The check below is a RUNTIME one even though the type says the field is
 * required, because a deployment assembles this from configuration a type
 * cannot see. It fails at assembly rather than at the first commit — the same
 * call `bootstrap.ts` makes for `AI_FINANCIAL_REQUIRED`, and for the same
 * reason: the last moment a missing guarantee can be refused without a run
 * already in flight.
 */

import type { AgentDefinition } from '../../agents/contracts/agent.ts';
import type { ToolDefinition } from '../../agents/contracts/tools.ts';
import type { WorkflowDefinition } from '../../workflows/contracts/workflow.ts';
import type { ReviewApprovalAuthorityPort } from './persistence/authorityPort.ts';
import type {
  CommittedReviewStore,
  DiagnosticDossierStore,
  ReviewDraftStore,
  ReviewEscalationStore,
} from './persistence/ports.ts';
import type { KvDiagnosticStoreOptions } from './persistence/kvDiagnosticStores.ts';
import { createKvDiagnosticStores } from './persistence/kvDiagnosticStores.ts';
import { createDiagnosticTools } from './tools/diagnosticTools.ts';
import { readinessManagerAgent } from './agent/readinessManagerAgent.ts';
import {
  READINESS_REVIEW_WORKFLOW_ID,
  REVIEW_APPROVAL_NODE_ID,
  REVIEW_APPROVER_ROLES,
  readinessReviewWorkflow,
} from './workflow/readinessReviewWorkflow.ts';

export interface DiagnosticCapabilityOptions {
  /** The submission source. Read-only; there is no writer on the port. */
  readonly dossiers: DiagnosticDossierStore;
  /** How a commit learns which workflow run it belongs to, and what it approved. */
  readonly authority: ReviewApprovalAuthorityPort;
  /**
   * DURABLE PERSISTENCE, REQUIRED. See the header.
   *
   * The platform key-value port with field-keyed compare-and-swap — the same
   * contract the agent, workflow and financial stores use. There is no
   * alternative parameter: a caller cannot inject a store of its own, so a
   * store that evicts cannot be reached from here at all.
   */
  readonly storage: KvDiagnosticStoreOptions;
}

export interface DiagnosticCapability {
  readonly tools: readonly ToolDefinition[];
  readonly agents: readonly AgentDefinition[];
  readonly workflows: readonly WorkflowDefinition[];
  readonly drafts: ReviewDraftStore;
  readonly escalations: ReviewEscalationStore;
  readonly commits: CommittedReviewStore;
}

export function createDiagnosticCapability(
  options: DiagnosticCapabilityOptions,
): DiagnosticCapability {
  // FAIL CLOSED AT ASSEMBLY. A deployment that reached here without a
  // conditional writer has no way to keep a committed review, and a capability
  // that started anyway would refuse a replay only until the first eviction.
  const storage = options.storage;
  if (
    storage === undefined ||
    typeof storage.read !== 'function' ||
    typeof storage.readByPrefix !== 'function' ||
    typeof storage.compareAndSwap !== 'function'
  ) {
    throw new Error(
      '[ai] the diagnostic review capability requires durable key-value storage with ' +
        'field-keyed conditional writes; committed reviews are the record of record for a ' +
        'human decision and the row that refuses a replayed commit, and neither may depend ' +
        'on isolate-local memory.',
    );
  }

  const { drafts, escalations, commits } = createKvDiagnosticStores(storage);

  const tools = createDiagnosticTools({
    dossiers: options.dossiers,
    drafts,
    escalations,
    commits,
    authority: options.authority,
    // FROM THE WORKFLOW DEFINITION, resolved once at assembly. The commit tool
    // compares an approval's frozen role list against this, so a record whose
    // roles are not the ones this definition declares is refused — which is the
    // case the approval gate itself cannot catch, because it froze whatever it
    // was given.
    commitAuthorization: {
      workflowId: READINESS_REVIEW_WORKFLOW_ID,
      approvalNodeId: REVIEW_APPROVAL_NODE_ID,
      approverRoles: REVIEW_APPROVER_ROLES,
    },
  });

  return {
    tools,
    agents: [readinessManagerAgent],
    workflows: [readinessReviewWorkflow],
    drafts,
    escalations,
    commits,
  };
}

/**
 * The same definitions with the certification flags CLEARED, as COPIES.
 *
 * For the certification suite and the runtime verification script, which have
 * to prove that an uncertified agent, an uncertified tool and an uncertified
 * workflow are refused — the refusals certification exists to lift, and the
 * only remaining way to exercise them now that the shipped chain is certified.
 * Nothing in production calls this, the shipped objects are untouched, and the
 * boundary scan asserts that no non-test module does.
 */
export function uncertifyForTesting(capability: DiagnosticCapability): DiagnosticCapability {
  return {
    ...capability,
    tools: capability.tools.map((tool) => ({ ...tool, certification: 'uncertified' as const })),
    agents: capability.agents.map((agent) => ({
      ...agent,
      enabled: false,
      certification: 'uncertified' as const,
    })),
    workflows: capability.workflows.map((workflow) => ({
      ...workflow,
      certification: 'uncertified' as const,
    })),
  };
}

export { readinessManagerAgent } from './agent/readinessManagerAgent.ts';
export { readinessReviewWorkflow } from './workflow/readinessReviewWorkflow.ts';
export { DIAGNOSTIC_TOOL_IDS } from './tools/diagnosticTools.ts';
export {
  READINESS_MANAGER_AGENT_ID,
  READINESS_MANAGER_VERSION,
} from './agent/readinessManagerAgent.ts';
export {
  READINESS_REVIEW_WORKFLOW_ID,
  READINESS_REVIEW_VERSION,
  REVIEW_APPROVAL_NODE_ID,
  REVIEW_APPROVER_ROLES,
} from './workflow/readinessReviewWorkflow.ts';
export { computeReadinessAuthority } from './deterministic/readinessAuthority.ts';
export { enforceReadinessFactLock } from './agent/factLock.ts';
export { createWorkflowApprovalAuthorityPort } from './persistence/authorityPort.ts';
export {
  createKvCommittedReviewStore,
  createKvDiagnosticStores,
  createKvEscalationStore,
  createKvReviewDraftStore,
} from './persistence/kvDiagnosticStores.ts';
export type { KvDiagnosticStoreOptions } from './persistence/kvDiagnosticStores.ts';
