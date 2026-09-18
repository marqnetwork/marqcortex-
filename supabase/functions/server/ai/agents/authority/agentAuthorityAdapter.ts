/**
 * The agent runtime's adapter onto the platform authority evaluator (BP-001).
 *
 * THE ONLY PLACE THE TWO VOCABULARIES MEET. The platform module knows nothing
 * about agents, tools, runs or safety classes — it cannot, because it imports
 * nothing — and the agent runtime does not learn to speak in `ActionRequest`s.
 * This file translates, in one direction, at one seam. BP-001 §8 asks for
 * exactly this: "AI/agent code should consume this module through adapters
 * rather than moving all AI code into the new folder."
 *
 * IT DECIDES NOTHING. Every function here is a projection. The decision is
 * `evaluateAuthority`'s, and the enforcement is the orchestrator's.
 *
 * ── WHY THE ENVELOPE IS DERIVED RATHER THAN READ FROM A TABLE ──────────────
 *
 * BP-001 §6 says to prefer additive tables "only if existing tables cannot
 * represent the required concepts". For an agent they can, and they already do:
 * a certified `AgentDefinition` IS an authority envelope written in the agent
 * runtime's own words. `allowedTools` is a tool scope. `capabilities` is a
 * permission set. `limits.maxEstimatedCostMicroUsd` is a spend ceiling.
 * `safetyClass` is a consequence ceiling. `approvals.requireForToolRisk` is an
 * approval threshold. Adding a table to restate facts that a reviewed,
 * certified definition already carries would create a second answer to "what
 * may this agent do" — and two answers to that question is the precise failure
 * BP-001 exists to prevent.
 *
 * Tenant-authored envelopes, for actors that have no definition to derive one
 * from, are a later packet and land behind `AuthorityEnvelopeSource` without
 * touching anything here.
 *
 * ── WHY THIS CHANGES NO EXISTING BEHAVIOUR ────────────────────────────────
 *
 * BP-001 §3.9 permits changing product behaviour only where routing the pilot
 * requires it. So the projection is built to reproduce today's outcome exactly:
 *
 *   The approval rule is carried as a POLICY CONSTRAINT sourced from
 *   `ToolGateway.requiresApproval`, which is the rule that decides today. It is
 *   not re-derived from `requireForToolRisk`, because that field is a SET of
 *   risk classes rather than a threshold — an agent configured with
 *   `['moderate']` requires approval for moderate tools and not for high ones,
 *   and re-expressing that as a monotone threshold would change which calls
 *   park. The existing predicate stays the authority; the platform evaluator
 *   consumes its verdict.
 *
 *   The consequence ceiling is the HIGHER of what `safetyClass` implies and
 *   what the agent's own `allowedTools` already permit. Where a definition's
 *   safety class and its tool allow-list disagree, the allow-list is what the
 *   orchestrator enforces today at action-sealing time, so the envelope must
 *   state that — an envelope that quietly tightened it would fail calls that
 *   work now, which is the one thing this packet may not do. The disagreement
 *   is worth closing, and the right place is registry certification refusing to
 *   register the contradiction, not this evaluator silently widening at
 *   runtime. That is recorded as follow-up work, not done here.
 */

import {
  type ActionRequest,
  type ActorContext,
  type AuthorityEnvelope,
  type AuthorityEvaluationInput,
  type ConsequenceLevel,
  type DataClassification,
  type PolicyConstraint,
  type RequestedEffect,
  maxConsequence,
  platformConsequenceFloor,
} from '../../../platform/authority/index.ts';
import type { AgentDefinition, AgentSafetyClass, ToolRiskClass } from '../contracts/agent.ts';
import type { AgentAction } from '../contracts/actions.ts';
import type { AgentRunRecord } from '../contracts/runtime.ts';
import type { ToolDescriptor, ToolSideEffect } from '../contracts/tools.ts';

/** The action type and resource type this pilot speaks about. */
export const AGENT_TOOL_CALL_ACTION = 'agent.tool.call';
export const AGENT_TOOL_RESOURCE = 'agent.tool';

/** The permission an agent must hold to call a tool at all. */
export const AGENT_TOOL_CALL_PERMISSION = 'agent.tool.invoke';

/**
 * What a tool's declared side effect does to the world.
 *
 * `external_write` becomes `external_effect` rather than `write`, and that is
 * the whole reason the mapping is explicit rather than inferred: an effect that
 * has left the platform cannot be undone by the platform, and the consequence
 * floor for it is correspondingly higher.
 */
const EFFECT_FOR_SIDE_EFFECT: Readonly<Record<ToolSideEffect, RequestedEffect>> = {
  none: 'read',
  internal_write: 'write',
  external_write: 'external_effect',
};

/**
 * The consequence a tool of this risk class carries.
 *
 * Offered to the evaluator as a SUBSYSTEM opinion, which by construction can
 * only raise the platform floor and never lower it. A `read_only` tool that the
 * platform has already classified `high` for some other reason stays `high`.
 */
const CONSEQUENCE_FOR_RISK: Readonly<Record<ToolRiskClass, ConsequenceLevel>> = {
  read_only: 'low',
  low: 'low',
  moderate: 'medium',
  high: 'high',
};

/** The consequence ceiling a safety class implies on its own. */
const CEILING_FOR_SAFETY_CLASS: Readonly<Record<AgentSafetyClass, ConsequenceLevel>> = {
  internal_readonly: 'low',
  tenant_readonly: 'low',
  tenant_write: 'medium',
  external_effect: 'high',
};

/** The most sensitive data a safety class implies the agent may handle. */
const DATA_CEILING_FOR_SAFETY_CLASS: Readonly<Record<AgentSafetyClass, DataClassification>> = {
  // Platform metadata only — it never sees a tenant's own records.
  internal_readonly: 'internal',
  tenant_readonly: 'confidential',
  tenant_write: 'confidential',
  external_effect: 'confidential',
};

/**
 * How sensitive the data behind a tool is.
 *
 * Derived from the tool's declared tenant scope, which is the only fact a tool
 * definition carries about what it touches. `run_organization` means it reaches
 * the tenant's own records; `platform` means non-tenant platform data.
 *
 * DELIBERATELY NEVER `restricted`. No tool in this repository declares itself
 * as handling the most sensitive class, and inventing one here would make the
 * data ceiling fire on calls that work today. When a tool definition gains a
 * real classification field, this derivation is what it replaces.
 */
function dataClassificationFor(descriptor: ToolDescriptor | undefined): DataClassification {
  if (!descriptor) return 'confidential';
  return descriptor.tenantScope === 'run_organization' ? 'confidential' : 'internal';
}

/**
 * The agent, as an actor.
 *
 * THE AGENT IS THE ACTOR HERE, NOT THE PERSON DRIVING THE RUN. That is the
 * point of the pilot: a tool call is something the AGENT proposed, bounded by
 * the agent's own envelope, and the person appears as `initiatedBy` —
 * provenance for the audit trail, and explicitly not a source of authority.
 * The evaluator refuses a non-human actor that resolves onto a human envelope
 * for exactly this reason.
 *
 * ── THE ONE FACT THIS PROJECTION ASSERTS RATHER THAN CARRIES ──────────────
 *
 * `membershipVerified` is true because the run EXISTS. `resolveAgentActor`
 * withholds `agent.run.create` from any subject whose organization resolution
 * was unverified (the MED-A rule in `service/agentRbac.ts`, asserted by
 * `tests/features/authorityModel.test.ts`), so a run record is itself proof
 * that a verified membership authorised it. The alternative — a field on
 * `AgentRunContext` — would be absent on every run created before it existed,
 * and a fail-closed reading of that absence would terminate live runs on
 * deploy. Carrying the fact explicitly is the right end state and belongs with
 * the next change to the run contract; it is recorded as follow-up rather than
 * done here.
 */
export function agentActorContext(record: AgentRunRecord, agent: AgentDefinition): ActorContext {
  return {
    actorId: agent.agentId,
    actorType: 'ai_agent',
    organizationId: record.context.organizationId,
    // An agent holds no ROLES. Roles describe people; an agent's authority
    // comes from its certified definition, and leaving this empty keeps the
    // distinction visible in every audit record rather than implied.
    roles: [],
    permissions: agent.capabilities,
    membershipVerified: true,
    runId: record.context.runId,
    initiatedBy: {
      actorId: record.context.actorId,
      actorType: 'human',
    },
  };
}

/**
 * The agent's certified definition, as an authority envelope.
 *
 * Versioned by the definition's own version string, so an audit record names
 * the envelope the decision was actually made against.
 *
 * THE MAJOR COMPONENT ONLY. The platform contract wants an integer and a
 * version string is not one, so something has to be chosen — and the leading
 * segment is the only choice that stays faithful. Stripping the separators
 * instead turns `1.0.0` into `100` and `1.0.10` into `1010`, two numbers that
 * neither order correctly nor mean anything to the person reading the record.
 * The FULL version is not lost: `envelopeId` carries it verbatim.
 *
 * A version with no leading integer yields 0, which says "this definition's
 * scheme could not be expressed as a number" rather than fabricating a 1.
 */
export function agentAuthorityEnvelope(
  record: AgentRunRecord,
  agent: AgentDefinition,
  toolCeiling: ConsequenceLevel,
): AuthorityEnvelope {
  const parsedVersion = Number.parseInt(agent.version.trim(), 10);
  return {
    envelopeId: `agent:${agent.agentId}@${agent.version}`,
    version: Number.isFinite(parsedVersion) ? parsedVersion : 0,
    organizationId: record.context.organizationId,
    subjectActorId: agent.agentId,
    subjectActorType: 'ai_agent',
    // An agent that is disabled or whose certification was REVOKED never
    // reaches here — the orchestrator refuses the run before a step is taken —
    // so this states the same fact rather than inventing a second gate that
    // could disagree with the first.
    status: agent.enabled && agent.certification !== 'revoked' ? 'active' : 'suspended',
    allowedActionTypes: [AGENT_TOOL_CALL_ACTION],
    allowedResourceTypes: [AGENT_TOOL_RESOURCE],
    allowedTools: agent.allowedTools,
    dataClassificationCeiling: DATA_CEILING_FOR_SAFETY_CLASS[agent.safetyClass] ?? 'internal',
    consequenceCeiling: maxConsequence(
      CEILING_FOR_SAFETY_CLASS[agent.safetyClass] ?? 'low',
      toolCeiling,
    ),
    // NO CONSEQUENCE-BASED THRESHOLD IN THE PILOT. The rule that decides
    // whether a tool call needs a human today is `ToolGateway.requiresApproval`,
    // and it arrives as a policy constraint below. A second, consequence-based
    // threshold here would park calls that run unattended today, which BP-001
    // §3.9 does not permit this packet to do.
    approvalThreshold: undefined,
    // THE RUN'S ceiling, applied to a single action, which is deliberately the
    // looser of the two readings. `maxEstimatedCostMicroUsd` bounds the whole
    // run, and the orchestrator already enforces it as such on every step; a
    // single action that alone exceeds what the entire run may spend is out of
    // bounds under either reading, so stating it here refuses nothing the
    // runtime permits today while still giving the envelope a real spend bound.
    maxCostMicroUsd: agent.limits.maxEstimatedCostMicroUsd,
    explicitDeny: [],
  };
}

/**
 * The consequence ceiling implied by the tools the agent is already allowed.
 *
 * See the file header for why this widens the safety-class ceiling rather than
 * being overridden by it: today the allow-list is what the orchestrator
 * enforces, and the envelope must state today's truth.
 *
 * ── IT MUST USE THE EVALUATOR'S OWN FOLD, AND HERE IS WHY ─────────────────
 *
 * The first version of this function re-derived the level from the tool's side
 * effect and risk class by hand. It read like a faithful summary and it was
 * not: it missed the platform's irreversibility floor and its data floor, so a
 * non-idempotent write to tenant data classified `high` at decision time while
 * this function called the same tool `medium`. The ceiling came out BELOW the
 * level the very same tool produced, and every approval-gated tool call in the
 * repository was denied — thirty-one existing tests, which is how it was found.
 *
 * The lesson is not "be more careful with the mapping". It is that a ceiling
 * derived by a SECOND implementation of a classification is a second answer,
 * and two answers to "how consequential is this?" disagree the moment either
 * one grows a rule. So this calls `platformConsequenceFloor` — the same fold,
 * over the same synthetic request the real call will build — and the ceiling is
 * correct by construction rather than by review.
 */
export function toolAllowListCeiling(
  agent: AgentDefinition,
  describe: (toolId: string) => ToolDescriptor | undefined,
): ConsequenceLevel {
  let ceiling: ConsequenceLevel = 'low';
  for (const toolId of agent.allowedTools) {
    const descriptor = describe(toolId);
    if (!descriptor) continue;
    const facts = toolFacts(descriptor);
    const level = platformConsequenceFloor({
      // A PROBE, not a real request. Only the fields the fold reads carry
      // meaning; the identity fields exist because the type requires them and
      // are never seen by anything that records or enforces.
      actionId: 'ceiling-probe',
      correlationId: 'ceiling-probe',
      actionType: AGENT_TOOL_CALL_ACTION,
      resourceType: AGENT_TOOL_RESOURCE,
      organizationId: 'ceiling-probe',
      actor: {
        actorId: agent.agentId,
        actorType: 'ai_agent',
        organizationId: 'ceiling-probe',
        roles: [],
        permissions: agent.capabilities,
        membershipVerified: true,
      },
      requestedEffect: facts.requestedEffect,
      dataClassification: facts.dataClassification,
      requestedTool: toolId,
      reversible: facts.reversible,
      // The COST IS DELIBERATELY OMITTED. A ceiling is a property of the tools
      // an agent may use, not of what one call happened to estimate; folding a
      // per-call cost in here would make the envelope widen itself for the
      // expensive call it is supposed to bound. Spend is bounded separately by
      // `maxCostMicroUsd`.
    });
    ceiling = maxConsequence(
      ceiling,
      maxConsequence(level, CONSEQUENCE_FOR_RISK[descriptor.risk] ?? 'high'),
    );
  }
  return ceiling;
}

/**
 * The three facts a tool descriptor implies about an action against it.
 *
 * ONE DERIVATION, used by the ceiling probe above and by the real request
 * below. That they cannot drift apart is the point — see `toolAllowListCeiling`
 * for what happened when they could.
 *
 * `reversible` comes from the declared idempotency: a non-idempotent tool is
 * one the gateway refuses to repeat, which is the runtime's own way of saying
 * the effect cannot simply be redone. An UNKNOWN tool is treated as
 * irreversible and externally-effective — the fail-closed reading, and one the
 * orchestrator's own allow-list check makes unreachable in practice.
 */
function toolFacts(descriptor: ToolDescriptor | undefined): {
  readonly requestedEffect: RequestedEffect;
  readonly dataClassification: DataClassification;
  readonly reversible: boolean;
} {
  return {
    requestedEffect: descriptor
      ? EFFECT_FOR_SIDE_EFFECT[descriptor.sideEffect] ?? 'external_effect'
      : 'external_effect',
    dataClassification: dataClassificationFor(descriptor),
    reversible: descriptor ? descriptor.idempotency === 'idempotent' : false,
  };
}

/** One tool call, as an action request. */
export function agentToolCallRequest(
  record: AgentRunRecord,
  agent: AgentDefinition,
  action: AgentAction & { readonly actionType: 'tool_call' },
  descriptor: ToolDescriptor | undefined,
  correlationId: string,
  requestId: string,
): ActionRequest {
  return {
    actionId: action.actionId,
    correlationId,
    actionType: AGENT_TOOL_CALL_ACTION,
    resourceType: AGENT_TOOL_RESOURCE,
    resourceId: action.toolId,
    organizationId: record.context.organizationId,
    actor: agentActorContext(record, agent),
    ...toolFacts(descriptor),
    requestedTool: action.toolId,
    estimatedCostMicroUsd: action.estimatedCostMicroUsd,
    traceId: requestId,
  };
}

/**
 * The existing tool-risk approval rule, as a policy constraint.
 *
 * `requiresApproval` is the predicate the orchestrator consults today. Wrapping
 * its verdict — rather than re-deriving the rule — is what makes the pilot
 * behaviour-preserving by construction: whatever parks a run today parks it
 * after this change, and nothing else does.
 */
export function agentApprovalPolicy(requiresApproval: boolean, toolId: string): PolicyConstraint[] {
  if (!requiresApproval) return [];
  return [
    {
      policyId: `agent.tool.requires_approval:${toolId}`,
      effect: 'require_approval',
      reason: 'This tool requires a person to approve each call.',
      actionTypes: [AGENT_TOOL_CALL_ACTION],
    },
  ];
}

/** Everything the evaluator needs for one agent tool call. */
export function agentToolCallAuthorityInput(params: {
  readonly record: AgentRunRecord;
  readonly agent: AgentDefinition;
  readonly action: AgentAction & { readonly actionType: 'tool_call' };
  readonly descriptor: ToolDescriptor | undefined;
  readonly requiresApproval: boolean;
  readonly describe: (toolId: string) => ToolDescriptor | undefined;
  readonly correlationId: string;
  readonly requestId: string;
  readonly nowIso: string;
}): AuthorityEvaluationInput {
  const request = agentToolCallRequest(
    params.record,
    params.agent,
    params.action,
    params.descriptor,
    params.correlationId,
    params.requestId,
  );
  const envelope = agentAuthorityEnvelope(
    params.record,
    params.agent,
    toolAllowListCeiling(params.agent, params.describe),
  );
  const constraints = agentApprovalPolicy(params.requiresApproval, params.action.toolId);
  return {
    request,
    envelopes: { resolve: () => envelope },
    policies: { constraints: () => constraints },
    consequence: {
      classify: () =>
        params.descriptor ? CONSEQUENCE_FOR_RISK[params.descriptor.risk] : 'critical',
    },
    requiredPermission: AGENT_TOOL_CALL_PERMISSION,
    nowIso: params.nowIso,
  };
}
