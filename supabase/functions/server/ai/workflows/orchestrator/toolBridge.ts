/**
 * The tool execution port, and its one implementation over the certified
 * Batch 3A Tool Gateway (AI-01 Batch 3B).
 *
 * EVERY WORKFLOW TOOL NODE GOES THROUGH THE GATEWAY. There is no second tool
 * path, no direct executor call and no way for a workflow to reach a tool the
 * gateway would refuse. What the gateway enforces — registration, the caller's
 * allow list, actor permission, organization scope, certification, the approval
 * requirement, input and output schema validation, idempotency and the timeout —
 * applies unchanged to a workflow node.
 *
 * THE PRINCIPAL, AND WHY IT LOOKS LIKE AN AGENT.
 *
 * `ToolGateway.execute` authorises against an `AgentDefinition`: it reads the
 * caller's `allowedTools`, its capabilities and its approval policy. A workflow
 * node has no agent, so this module builds a PRINCIPAL — an agent-shaped
 * authorization object derived from the workflow definition and the node.
 *
 * Three things about it matter:
 *
 *   IT IS NARROWER THAN THE WORKFLOW, NOT WIDER. `allowedTools` is the
 *   intersection of the workflow's declared tools and the single tool this node
 *   names, so a principal can authorise exactly one tool and never the workflow's
 *   whole list. Its capability set is `agent.tool.invoke` alone — it cannot call a
 *   model, hand off, or write a checkpoint.
 *
 *   IT IS NEVER REGISTERED. It exists for the duration of one call and is not in
 *   the agent registry, so nothing can resolve it, drive it, or hand off to it. It
 *   proposes nothing: it has a `propose` that throws, because the gateway's type
 *   requires the field and a workflow principal must never be askable for an
 *   intention.
 *
 *   IT CANNOT SOFTEN AN APPROVAL. Its `requireForToolRisk` is the platform's own
 *   posture — moderate and high — which is the same set the agent runtime applies,
 *   and it can only be WIDENED by the node's own rule, never narrowed. A tool that
 *   declares `requiresApproval: true` is gated whatever the principal says, because
 *   the gateway checks the tool's own flag first. So a principal is never the reason
 *   a tool skipped its gate.
 *
 *   Making the set exhaustive instead — gating read-only tools too — was tried and
 *   is wrong: it forced an approval on every workflow tool node, including the
 *   deterministic read-only ones, which turns the gate into noise and trains
 *   operators to click through it.
 *
 * The alternative — a second authorization path inside the workflow engine —
 * would mean two implementations of tool permission, and the one that drifts is
 * always the one nobody is looking at.
 */

import type { AgentDefinition } from '../../agents/contracts/agent.ts';
import type { ToolDescriptor } from '../../agents/contracts/tools.ts';
import type { ToolGateway } from '../../agents/tools/toolRegistry.ts';
import { ACTOR_TOOL_CAPABILITY } from '../../agents/tools/toolRegistry.ts';
import type { WorkflowDefinition, WorkflowToolNode } from '../contracts/workflow.ts';
import { isAgentRuntimeError } from '../../agents/contracts/failures.ts';
import { workflowFailure } from '../contracts/failures.ts';
import { jsonObject } from '../../security/validation.ts';

export interface ToolStepRequest {
  readonly definition: WorkflowDefinition;
  readonly node: WorkflowToolNode;
  readonly workflowRunId: string;
  readonly organizationId: string;
  readonly actorId: string;
  /** Runtime capabilities the ACTOR holds. Resolved server-side. */
  readonly actorCapabilities: readonly string[];
  readonly correlationId: string;
  /**
   * The node's durable idempotency key. Built from the run, the node and the
   * branch, so a replay after a restart presents the same key the gateway already
   * saw and a non-idempotent tool is refused rather than repeated.
   */
  readonly idempotencyKey: string;
  readonly input: unknown;
  readonly timeoutMs: number;
  /** Approval that authorised this call, when the tool requires one. */
  readonly workflowApprovalId?: string;
}

export interface ToolStepResult {
  readonly output: unknown;
  readonly outputDigest: string;
  readonly latencyMs: number;
  readonly replayed: boolean;
}

export interface ToolExecutionPort {
  execute(request: ToolStepRequest): Promise<ToolStepResult>;
  /** Does this tool need a human decision before a workflow may call it? */
  requiresApproval(definition: WorkflowDefinition, node: WorkflowToolNode): boolean;
  describe(toolId: string): ToolDescriptor | undefined;
  /** Tool ids that are registered, for registry validation. */
  knownToolIds(): readonly string[];
}

/**
 * A permissive-shaped contract that validates nothing beyond "it is a bounded
 * JSON object".
 *
 * The principal's contracts are never used to validate anything: the GATEWAY
 * validates against the TOOL's declared input and output schemas, which is where
 * that check belongs. These exist because the type requires them, and they are
 * deliberately inert rather than a second, weaker validation somebody might come
 * to rely on.
 */
const INERT_CONTRACT = jsonObject({ maxDepth: 8, maxNodes: 2_000 });

/**
 * The workflow capability that authorises a person to cause a tool call.
 *
 * The gateway asks whether the ACTOR holds `agent.run.create` — its way of asking
 * "may this person cause a tool to execute at all?". A workflow caller holds the
 * workflow-surface equivalent, `workflow.run.create`, and holds it for exactly the
 * same reason. So the bridge translates ONE capability, in ONE direction, for ONE
 * question.
 *
 * Stated explicitly because it is a privilege translation and those deserve to be
 * visible: an actor who cannot create a workflow run gains nothing, the translation
 * adds no other agent capability, and it does not touch the tool's own permission
 * checks, its certification, its schema validation or its approval requirement. The
 * alternative — granting workflow callers `agent.run.create` in the RBAC table —
 * would let them drive agent runs directly, which is a much wider grant than the
 * question being asked.
 */
const WORKFLOW_TOOL_ACTOR_CAPABILITY = 'workflow.run.create';

/**
 * The risk classes a workflow principal demands approval for.
 *
 * Identical to the posture the agent fixtures and the platform's own guidance
 * apply. A read-only, certified, side-effect-free tool does not need a human in
 * front of it; anything that can change something does.
 */
const APPROVAL_RISK_CLASSES = ['moderate', 'high'] as const;

/**
 * Build the one-call authorization principal for a workflow tool node.
 *
 * Exported so the security suite can assert on its shape directly — the claims in
 * this module's header are testable rather than aspirational.
 */
export function workflowToolPrincipal(
  definition: WorkflowDefinition,
  node: WorkflowToolNode,
): AgentDefinition {
  const permitted = definition.allowedTools.includes(node.toolId) ? [node.toolId] : [];
  return {
    // Namespaced so it can never collide with a registered agent id, and shaped so
    // an audit record naming it is obviously a workflow principal.
    agentId: `workflow.principal.${definition.workflowId}.${node.nodeId}`,
    displayName: `Workflow tool principal for ${node.nodeId}`,
    purpose: `Authorise the ${node.toolId} call declared by workflow node ${node.nodeId}.`,
    description:
      'A single-call authorization principal derived from a workflow definition. Not a ' +
      'registered agent: it proposes nothing and is discarded when the call returns.',
    owner: definition.owner,
    version: definition.version,
    enabled: definition.enabled,
    certification: definition.certification,
    safetyClass: definition.safetyClass,
    // Exactly one capability. It cannot call a model, hand off or checkpoint.
    capabilities: ['agent.tool.invoke'],
    allowedTools: permitted,
    allowedModelProfiles: [],
    allowedHandoffTargets: [],
    inputContract: INERT_CONTRACT,
    outputContract: INERT_CONTRACT,
    limits: {
      // A principal takes exactly one step: the call it was built for. The
      // gateway does not read these, but a principal whose limits implied it could
      // do more would be misleading to anyone reading an audit record.
      maxTotalSteps: 1,
      maxStepsPerAgent: 1,
      maxHandoffs: 0,
      maxRetries: 0,
      maxRepeatedActions: 1,
      maxRepeatedHandoffs: 1,
      maxRuntimeMs: Math.max(1_000, node.timeoutMs),
      maxPromptTokens: 1,
      maxCompletionTokens: 1,
      maxTotalTokens: 1,
      maxEstimatedCostMicroUsd: 0,
      maxActualCostMicroUsd: 0,
    },
    approvals: {
      // The platform posture. The tool's own `requiresApproval` flag and the node's
      // own rule can each add a gate on top; neither this nor anything else can
      // remove one.
      requireForToolRisk: APPROVAL_RISK_CLASSES,
      requireForHandoff: true,
      requireForCompletion: false,
      approverRoles: node.approval?.approverRoles ?? ['owner', 'admin'],
      expiresAfterMs: node.approval?.expiresAfterMs ?? 3_600_000,
    },
    completion: { requiredOutputFields: [], terminalAfterHandoff: false },
    propose: () => {
      // Unreachable: a principal is handed to the gateway for authorization and is
      // never registered, resolved or driven. Throwing rather than returning a
      // harmless action means a future code path that tried to drive one fails
      // loudly instead of silently executing something nobody designed.
      throw workflowFailure(
        'capability_denied',
        'A workflow tool principal cannot propose an action.',
        {
          workflowId: definition.workflowId,
          nodeId: node.nodeId,
          diagnostics: 'workflowToolPrincipal.propose was called; a principal is authorization only',
        },
      );
    },
  };
}

/**
 * The actor capabilities the gateway is handed.
 *
 * The workflow capability is carried through unchanged and the single agent
 * capability the gateway checks is added only when its workflow equivalent is
 * present. Nothing is added unconditionally.
 */
export function gatewayActorCapabilities(
  actorCapabilities: readonly string[],
): readonly string[] {
  if (!actorCapabilities.includes(WORKFLOW_TOOL_ACTOR_CAPABILITY)) return actorCapabilities;
  if (actorCapabilities.includes(ACTOR_TOOL_CAPABILITY)) return actorCapabilities;
  return [...actorCapabilities, ACTOR_TOOL_CAPABILITY];
}

export function createToolGatewayBridge(deps: {
  readonly gateway: ToolGateway;
}): ToolExecutionPort {
  return {
    async execute(request) {
      const principal = workflowToolPrincipal(request.definition, request.node);
      if (principal.allowedTools.length === 0) {
        throw workflowFailure('capability_denied', 'This workflow may not use that tool.', {
          workflowRunId: request.workflowRunId,
          workflowId: request.definition.workflowId,
          nodeId: request.node.nodeId,
          diagnostics: `tool ${request.node.toolId} is not in the workflow's allow list`,
        });
      }

      try {
        const result = await deps.gateway.execute({
          toolId: request.node.toolId,
          agent: principal,
          // The gateway records this as the run the tool was called for. Using the
          // WORKFLOW run id keeps the tool's own idempotency and audit records
          // joinable to the workflow rather than to a synthetic identifier.
          runId: request.workflowRunId,
          organizationId: request.organizationId,
          actorId: request.actorId,
          actorCapabilities: gatewayActorCapabilities(request.actorCapabilities),
          correlationId: request.correlationId,
          idempotencyKey: request.idempotencyKey,
          input: request.input,
          timeoutMs: request.timeoutMs,
          ...(request.workflowApprovalId === undefined
            ? {}
            : { approvalId: request.workflowApprovalId }),
        });
        return {
          output: result.output,
          outputDigest: result.outputDigest,
          latencyMs: result.latencyMs,
          replayed: result.replayed,
        };
      } catch (error) {
        const options = {
          workflowRunId: request.workflowRunId,
          workflowId: request.definition.workflowId,
          nodeId: request.node.nodeId,
          cause: error,
        };
        if (!isAgentRuntimeError(error)) {
          throw workflowFailure('tool_step_failed', 'That tool call could not be completed.', {
            ...options,
            diagnostics: `tool ${request.node.toolId}: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
        const diagnostics =
          `tool ${request.node.toolId} failed ${error.failure}: ${error.diagnostics ?? error.message}`;
        switch (error.failure) {
          case 'tool_denied':
          case 'capability_denied':
            throw workflowFailure('capability_denied', error.message, { ...options, diagnostics });
          case 'tenant_isolation_violation':
            throw workflowFailure('tenant_isolation_violation', error.message, {
              ...options,
              diagnostics,
            });
          case 'approval_required':
            throw workflowFailure('approval_required', error.message, { ...options, diagnostics });
          case 'approval_expired':
            throw workflowFailure('approval_expired', error.message, { ...options, diagnostics });
          case 'approval_rejected':
            throw workflowFailure('approval_rejected', error.message, { ...options, diagnostics });
          case 'invalid_action':
            throw workflowFailure('invalid_node', error.message, { ...options, diagnostics });
          case 'runtime_disabled':
            throw workflowFailure('workflow_disabled_runtime', error.message, {
              ...options,
              diagnostics,
            });
          default:
            throw workflowFailure('tool_step_failed', error.message, { ...options, diagnostics });
        }
      }
    },

    requiresApproval(definition, node) {
      // The node's own rule wins when it declares one; otherwise the gateway's
      // judgement about the tool applies. Either can demand an approval and
      // neither can waive one the other requires.
      if (node.approval !== undefined) return true;
      return deps.gateway.requiresApproval(node.toolId, workflowToolPrincipal(definition, node));
    },

    describe: (toolId) => deps.gateway.describe(toolId),
    knownToolIds: () => deps.gateway.list().map((tool) => tool.toolId),
  };
}
