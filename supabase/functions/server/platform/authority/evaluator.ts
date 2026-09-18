/**
 * The deterministic authority evaluator (BP-001 §5).
 *
 * ONE FUNCTION, ONE ANSWER, NO I/O.
 *
 * `evaluateAuthority` is pure: same input, same decision, on every isolate and
 * in every deployment. It opens no connection, reads no environment variable,
 * consults no clock of its own and awaits nothing. Every fact it weighs arrives
 * in `AuthorityEvaluationInput`, which is what makes the returned evidence a
 * complete account of the reasoning — a reviewer months later re-reads the
 * record rather than re-running the system.
 *
 * FAIL CLOSED IS NOT A SLOGAN HERE. The rule applied throughout is that an
 * ABSENT OR UNUSABLE FACT DENIES. Not "denies where it seems risky" — denies. A
 * missing envelope, a malformed timestamp, a permission nobody named, a
 * classifier that threw: each one ends in `DENY` or, where a human can
 * legitimately resolve it, `REQUIRE_APPROVAL`. Never `ALLOW`. The failure mode
 * of an authorization system must be that work stops and somebody is asked, and
 * every branch below that could have gone the other way says why it did not.
 *
 * WHY THE STEPS RUN IN THIS ORDER. BP-001 §5 fixes it, and the ordering carries
 * meaning beyond tidiness:
 *
 *   Tenant before everything, because a cross-tenant request must be refused
 *   without its actor's permissions ever being consulted — consulting them
 *   would mean an actor's own grants could influence what happens to somebody
 *   else's data.
 *
 *   Explicit deny before policy and before the envelope, because a deny that
 *   could be outvoted is not a deny. It is the containment primitive: revoking
 *   an envelope races whatever is already in flight, adding a deny does not.
 *
 *   Consequence last, because it is the only step that can legitimately turn a
 *   would-be allow into a request for a human. Running it earlier would let an
 *   action that a deny rule already refused go and ask somebody about it.
 *
 * THE ENVELOPE IS LOOKED UP EARLY AND JUDGED LATE. Resolution is a lookup, not
 * a decision, and the explicit-deny rules it carries are needed at step 4. The
 * envelope's own validity — status, window, subject, scope — is not examined
 * until step 6, where §5 puts it.
 */

import {
  ACTOR_TYPES,
  AUTHORITY_REASON,
  type ActionRequest,
  type ActorContext,
  type ApprovalRequirement,
  type AuthorityDecision,
  type AuthorityDecisionOutcome,
  type AuthorityEnvelope,
  type AuthorityEvaluationInput,
  type AuthorityEvidence,
  type AuthorityReasonCode,
  type ConsequenceLevel,
  type ExplicitDenyRule,
  type PolicyConstraint,
  consequenceRank,
  exceedsConsequence,
  exceedsDataCeiling,
  HUMAN_ACTOR_TYPES,
} from './contracts.ts';
import { classifyConsequence } from './consequence.ts';

/** Wildcard in a scope list. Matches every value of that axis. */
const WILDCARD = '*';

const MAX_REASON = 300;

/** Effects that change something. A read is the only one that does not. */
function mutates(request: ActionRequest): boolean {
  return request.requestedEffect !== 'read';
}

function nonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Does a scope list admit this value?
 *
 * AN EMPTY LIST ADMITS NOTHING. The tempting alternative — empty means
 * unrestricted — is how an envelope that was never filled in becomes an
 * envelope that permits everything, and a partially-configured actor is exactly
 * the one that should be able to do least.
 */
function scopeAdmits(scope: readonly string[], value: string): boolean {
  if (scope.length === 0) return false;
  if (scope.includes(WILDCARD)) return true;
  return scope.includes(value);
}

/** The first deny rule that matches, or undefined. */
function matchingDeny(
  rules: readonly ExplicitDenyRule[],
  request: ActionRequest,
): ExplicitDenyRule | undefined {
  return rules.find((rule) => {
    if (!scopeAdmits(rule.actionTypes, request.actionType)) return false;
    // A NARROWING that is absent does not narrow. `resourceTypes: undefined`
    // means "whatever the resource is"; `resourceTypes: []` would mean "no
    // resource", which would make the rule unreachable — so an explicitly empty
    // narrowing is read the same way `scopeAdmits` reads every empty list, and
    // the rule simply does not match.
    if (rule.resourceTypes !== undefined) {
      if (!scopeAdmits(rule.resourceTypes, request.resourceType)) return false;
    }
    if (rule.tools !== undefined) {
      if (request.requestedTool === undefined) return false;
      if (!scopeAdmits(rule.tools, request.requestedTool)) return false;
    }
    return true;
  });
}

function policiesFor(input: AuthorityEvaluationInput): readonly PolicyConstraint[] {
  if (!input.policies) return [];
  let constraints: readonly PolicyConstraint[];
  try {
    constraints = input.policies.constraints(input.request);
  } catch {
    // A POLICY SOURCE THAT THREW HAS NOT SAID "ALLOW". It has said nothing, and
    // an authorization step that cannot be evaluated is one that must not be
    // skipped — so the failure is turned into a deny constraint rather than an
    // empty list.
    return [
      {
        policyId: 'policy.source.unavailable',
        effect: 'deny',
        reason: 'Policy constraints could not be evaluated.',
        actionTypes: [WILDCARD],
      },
    ];
  }
  return constraints.filter((constraint) =>
    scopeAdmits(constraint.actionTypes, input.request.actionType),
  );
}

function resolveEnvelope(
  input: AuthorityEvaluationInput,
): AuthorityEnvelope | undefined {
  if (!input.envelopes) return undefined;
  try {
    return input.envelopes.resolve(input.request.actor, input.request);
  } catch {
    // Same reading as a failed policy source: an envelope that could not be
    // resolved is an envelope that does not exist, and step 6 denies for that.
    return undefined;
  }
}

function evidenceFor(
  request: ActionRequest,
  envelope: AuthorityEnvelope | undefined,
  steps: readonly string[],
): AuthorityEvidence {
  return {
    actorType: request.actor.actorType,
    organizationId: request.organizationId,
    actionType: request.actionType,
    resourceType: request.resourceType,
    requestedEffect: request.requestedEffect,
    dataClassification: request.dataClassification,
    requestedTool: request.requestedTool,
    estimatedCostMicroUsd: request.estimatedCostMicroUsd,
    membershipVerified: request.actor.membershipVerified,
    envelopeVersion: envelope?.version,
    envelopeConsequenceCeiling: envelope?.consequenceCeiling,
    envelopeApprovalThreshold: envelope?.approvalThreshold,
    evaluatedSteps: steps,
  };
}

/**
 * Is the actor a person, present and accountable at this decision?
 *
 * Used for exactly one thing — refusing to let a non-human actor carry a
 * human's envelope — and NOT as a general exemption. A human with no envelope
 * is denied like anybody else.
 */
function isHuman(actor: ActorContext): boolean {
  return HUMAN_ACTOR_TYPES.has(actor.actorType);
}

export function evaluateAuthority(input: AuthorityEvaluationInput): AuthorityDecision {
  const { request } = input;
  const steps: string[] = [];
  const reasonCodes: AuthorityReasonCode[] = [];
  const matchedPolicies: string[] = [];
  const matchedPermissions: string[] = [];

  // The envelope is LOOKED UP here and JUDGED at step 6. See the file header.
  const envelope = resolveEnvelope(input);

  /**
   * Finish with a refusal.
   *
   * Every early exit goes through here so that a denial always carries the
   * steps that were actually evaluated, never a partially-filled record that
   * implies more was checked than was.
   */
  function refuse(
    code: AuthorityReasonCode,
    reason: string,
    decision: AuthorityDecisionOutcome = 'DENY',
    // `critical` by default, for a refusal that happened BEFORE step 8 and so
    // never classified anything. It is the fail-closed reading of "not
    // computed", and a reader can tell the two apart without guessing:
    // `evidence.evaluatedSteps` contains `consequence` only when the level was
    // actually derived.
    consequenceLevel: ConsequenceLevel = 'critical',
    approvalRequirement?: ApprovalRequirement,
  ): AuthorityDecision {
    reasonCodes.push(code);
    return {
      decision,
      reasonCodes,
      reason: reason.slice(0, MAX_REASON),
      matchedPermissions,
      matchedPolicies,
      matchedEnvelopeId: envelope?.envelopeId,
      consequenceLevel,
      approvalRequirement,
      actionId: request.actionId,
      correlationId: request.correlationId,
      traceId: request.traceId,
      evidence: evidenceFor(request, envelope, steps),
    };
  }

  // ── 0. The request itself has to be usable ────────────────────────────────
  //
  // Before tenancy, because a request with no action identity cannot be
  // audited, and a decision nobody can later find the subject of is not
  // evidence of anything.
  steps.push('request');
  if (!nonEmpty(request.actionId) || !nonEmpty(request.correlationId)) {
    return refuse(
      AUTHORITY_REASON.contextIncomplete,
      'The request carries no usable action or correlation identity.',
    );
  }
  if (!nonEmpty(request.actionType) || !nonEmpty(request.resourceType)) {
    return refuse(
      AUTHORITY_REASON.contextIncomplete,
      'The request does not state what it is doing or to what.',
    );
  }
  // A TIMESTAMP THAT CANNOT BE READ DENIES. It decides whether an envelope is
  // inside its validity window, so guessing would mean honouring an expired
  // envelope or refusing a live one, and only one of those is safe to get wrong.
  const nowMs = Date.parse(input.nowIso);
  if (!Number.isFinite(nowMs)) {
    return refuse(
      AUTHORITY_REASON.contextIncomplete,
      'The evaluation timestamp is missing or unreadable.',
    );
  }

  // ── 1. Tenant ─────────────────────────────────────────────────────────────
  steps.push('tenant');
  const actor = request.actor;
  if (!nonEmpty(request.organizationId) || !nonEmpty(actor.organizationId)) {
    return refuse(
      AUTHORITY_REASON.tenantMissing,
      'The request is not scoped to an organization.',
    );
  }
  if (request.organizationId !== actor.organizationId) {
    // CROSS-TENANT, AND REFUSED WITHOUT CONSULTING A SINGLE PERMISSION. There
    // is no role in this platform that turns this into an allow: the agent and
    // workflow runtimes grant cross-tenant READ to an explicit platform
    // operator and no cross-tenant control operation at any role, and this
    // evaluator decides consequential actions rather than reads.
    return refuse(
      AUTHORITY_REASON.tenantMismatch,
      'That resource belongs to a different organization.',
    );
  }
  if (!actor.membershipVerified && mutates(request)) {
    // The rule `agents/service/agentRbac.ts` already applies to its privileged
    // capabilities, applied here to every consequential action. An account
    // placed in a fallback organization by configuration, rather than by a
    // membership row, may look at it and may not change it.
    return refuse(
      AUTHORITY_REASON.membershipUnverified,
      'Your membership of this organization has not been confirmed.',
    );
  }
  reasonCodes.push(AUTHORITY_REASON.tenantOk);

  // ── 2. Actor ──────────────────────────────────────────────────────────────
  steps.push('actor');
  if (!nonEmpty(actor.actorId)) {
    return refuse(AUTHORITY_REASON.actorMissing, 'The request carries no actor identity.');
  }
  if (!ACTOR_TYPES.includes(actor.actorType)) {
    // An unrecognised actor type is not a new kind of actor to be accommodated
    // — it is a caller constructing a context this module does not understand,
    // and the safe reading of "I do not know what this is" is not "let it
    // through".
    return refuse(
      AUTHORITY_REASON.actorTypeUnknown,
      'The request carries an unrecognised actor type.',
    );
  }
  reasonCodes.push(AUTHORITY_REASON.actorOk);

  // ── 3. Permission ─────────────────────────────────────────────────────────
  steps.push('permission');
  if (input.requiredPermission === undefined) {
    // AN UNNAMED PERMISSION IS ONLY ACCEPTABLE FOR A READ. Anything that
    // changes state and that nobody could name a permission for is a caller
    // that has not decided what authorises it, and this is the last point at
    // which that can be caught cheaply.
    if (mutates(request)) {
      return refuse(
        AUTHORITY_REASON.permissionMissing,
        'This action names no permission, and only a read may go unnamed.',
      );
    }
  } else if (!actor.permissions.includes(input.requiredPermission)) {
    return refuse(
      AUTHORITY_REASON.permissionMissing,
      'Your role does not permit this action.',
    );
  } else {
    matchedPermissions.push(input.requiredPermission);
  }
  reasonCodes.push(AUTHORITY_REASON.permissionGranted);

  // ── 4. Explicit deny ──────────────────────────────────────────────────────
  //
  // Before policy and before the envelope is judged. A deny that a later step
  // could overturn would not be a deny.
  steps.push('explicit_deny');
  if (envelope) {
    const denied = matchingDeny(envelope.explicitDeny, request);
    if (denied) {
      return refuse(
        AUTHORITY_REASON.explicitDeny,
        denied.reason || 'This action is explicitly forbidden for this actor.',
      );
    }
  }

  // ── 5. Policy ─────────────────────────────────────────────────────────────
  steps.push('policy');
  const constraints = policiesFor(input);
  for (const constraint of constraints) matchedPolicies.push(constraint.policyId);
  const policyDeny = constraints.find((constraint) => constraint.effect === 'deny');
  if (policyDeny) {
    return refuse(AUTHORITY_REASON.policyDeny, policyDeny.reason || 'A policy forbids this action.');
  }
  // Noted now, applied at step 9. A policy that asks for a human cannot turn a
  // later deny into an approval request.
  const policyApproval = constraints.find((constraint) => constraint.effect === 'require_approval');
  reasonCodes.push(AUTHORITY_REASON.policyOk);

  // ── 6. Authority envelope ─────────────────────────────────────────────────
  steps.push('envelope');
  if (!envelope) {
    // DENY BY DEFAULT, FOR EVERY ACTOR TYPE INCLUDING A PERSON.
    //
    // The alternative — humans proceed without one — is how the envelope
    // becomes decorative: every caller that found it inconvenient would route a
    // human actor through and the boundary would hold only for the actors
    // nobody was in a hurry about. An actor whose bounds nothing can state has
    // no bounds, and unbounded authority is the single thing this module exists
    // to refuse.
    return refuse(
      AUTHORITY_REASON.envelopeMissing,
      'No authority envelope covers this action.',
    );
  }
  if (envelope.organizationId !== request.organizationId) {
    return refuse(
      AUTHORITY_REASON.envelopeTenantMismatch,
      'The resolved authority does not belong to this organization.',
    );
  }
  if (envelope.subjectActorType !== actor.actorType) {
    // A NON-HUMAN ACTOR MAY NEVER CARRY A HUMAN'S ENVELOPE.
    //
    // This is the workflow-inheritance refusal, stated as a type rule rather
    // than as a special case for workflows. A person who may approve their own
    // run's spending holds that authority because a person is present at each
    // decision; a workflow or agent that inherited it would spend it unattended
    // and repeatedly. The general mismatch below would already refuse this —
    // the case is separated out because it deserves its own reason code in the
    // audit trail and its own name in an alert.
    if (HUMAN_ACTOR_TYPES.has(envelope.subjectActorType) && !isHuman(actor)) {
      return refuse(
        AUTHORITY_REASON.inheritedAuthorityRefused,
        'A non-human actor may not act with a person’s authority.',
      );
    }
    return refuse(
      AUTHORITY_REASON.envelopeSubjectMismatch,
      'The resolved authority was not issued to this actor.',
    );
  }
  if (envelope.subjectActorId !== actor.actorId) {
    return refuse(
      AUTHORITY_REASON.envelopeSubjectMismatch,
      'The resolved authority was not issued to this actor.',
    );
  }
  if (envelope.status === 'suspended') {
    return refuse(AUTHORITY_REASON.envelopeSuspended, 'This actor’s authority is suspended.');
  }
  if (envelope.status === 'expired') {
    return refuse(AUTHORITY_REASON.envelopeExpired, 'This actor’s authority has expired.');
  }
  if (envelope.validFrom !== undefined) {
    const fromMs = Date.parse(envelope.validFrom);
    // An unreadable bound denies, for the reason the header gives: a window
    // that cannot be read is not a window that can be honoured.
    if (!Number.isFinite(fromMs) || nowMs < fromMs) {
      return refuse(
        AUTHORITY_REASON.envelopeNotYetValid,
        'This actor’s authority is not yet in force.',
      );
    }
  }
  if (envelope.validUntil !== undefined) {
    const untilMs = Date.parse(envelope.validUntil);
    if (!Number.isFinite(untilMs) || nowMs >= untilMs) {
      return refuse(
        AUTHORITY_REASON.envelopeExpired,
        'This actor’s authority has expired.',
      );
    }
  }
  if (!scopeAdmits(envelope.allowedActionTypes, request.actionType)) {
    return refuse(
      AUTHORITY_REASON.envelopeActionOutOfScope,
      'This actor may not take this kind of action.',
    );
  }
  if (!scopeAdmits(envelope.allowedResourceTypes, request.resourceType)) {
    return refuse(
      AUTHORITY_REASON.envelopeResourceOutOfScope,
      'This actor may not act on this kind of resource.',
    );
  }
  reasonCodes.push(AUTHORITY_REASON.envelopeOk);

  // ── 7. Data, tool and budget constraints ──────────────────────────────────
  steps.push('constraints');
  if (request.requestedTool !== undefined) {
    if (!scopeAdmits(envelope.allowedTools, request.requestedTool)) {
      return refuse(AUTHORITY_REASON.toolOutOfScope, 'This actor may not use that tool.');
    }
  }
  if (exceedsDataCeiling(request.dataClassification, envelope.dataClassificationCeiling)) {
    // A HARD BOUNDARY, NOT AN APPROVAL PROMPT. An envelope that caps an actor
    // at `internal` data is a statement about what that actor may ever see, and
    // a human saying yes in the moment does not reclassify the data.
    return refuse(
      AUTHORITY_REASON.dataCeilingExceeded,
      'This action touches data above what this actor may handle.',
    );
  }
  if (envelope.maxCostMicroUsd !== undefined) {
    const cost = request.estimatedCostMicroUsd;
    if (cost !== undefined) {
      // An unusable cost denies rather than passing the ceiling check by being
      // uncomparable — `NaN > limit` is false, which would otherwise make a
      // corrupt number the cheapest way past a spend ceiling.
      if (!Number.isFinite(cost) || cost < 0 || cost > envelope.maxCostMicroUsd) {
        return refuse(
          AUTHORITY_REASON.budgetExceeded,
          'This action exceeds the spend this actor may commit.',
        );
      }
    }
  }
  reasonCodes.push(AUTHORITY_REASON.constraintsOk);

  // ── 8. Consequence ────────────────────────────────────────────────────────
  steps.push('consequence');
  const consequenceLevel = classifyConsequence(request, input.consequence);

  if (exceedsConsequence(consequenceLevel, envelope.consequenceCeiling)) {
    // ABOVE THE CEILING IS A DENY, NOT AN ESCALATION.
    //
    // The two bounds say different things and collapsing them would lose the
    // stronger one. `approvalThreshold` says "not unattended"; `consequenceCeiling`
    // says "not by this actor". An action above the ceiling that could be
    // unlocked by asking somebody would make the ceiling a threshold with extra
    // steps, and an operator who set a ceiling meant the first thing.
    return refuse(
      AUTHORITY_REASON.consequenceCeilingExceeded,
      'This action is more consequential than this actor may undertake.',
      'DENY',
      consequenceLevel,
      {
        reasonCode: AUTHORITY_REASON.consequenceCeilingExceeded,
        consequenceLevel,
        summary: 'Beyond this actor’s authority ceiling; approval cannot widen it.',
        withinEnvelopeCeiling: false,
      },
    );
  }

  // ── 9. The decision ───────────────────────────────────────────────────────
  steps.push('decision');

  const thresholdReached =
    envelope.approvalThreshold !== undefined &&
    consequenceRank(consequenceLevel) >= consequenceRank(envelope.approvalThreshold);

  if (thresholdReached || policyApproval !== undefined) {
    const code = thresholdReached
      ? AUTHORITY_REASON.consequenceThresholdReached
      : AUTHORITY_REASON.policyRequiresApproval;
    const summary = thresholdReached
      ? `A ${consequenceLevel} action needs a person to approve it.`
      : policyApproval?.reason || 'A policy requires a person to approve this action.';
    reasonCodes.push(code);
    return {
      decision: 'REQUIRE_APPROVAL',
      reasonCodes,
      reason: summary.slice(0, MAX_REASON),
      matchedPermissions,
      matchedPolicies,
      matchedEnvelopeId: envelope.envelopeId,
      consequenceLevel,
      approvalRequirement: {
        reasonCode: code,
        consequenceLevel,
        summary: summary.slice(0, MAX_REASON),
        // Reachable with a human's yes: every hard bound above has passed.
        withinEnvelopeCeiling: true,
      },
      actionId: request.actionId,
      correlationId: request.correlationId,
      traceId: request.traceId,
      evidence: evidenceFor(request, envelope, steps),
    };
  }

  reasonCodes.push(AUTHORITY_REASON.allowed);
  return {
    decision: 'ALLOW',
    reasonCodes,
    reason: 'Permitted within this actor’s authority.',
    matchedPermissions,
    matchedPolicies,
    matchedEnvelopeId: envelope.envelopeId,
    consequenceLevel,
    actionId: request.actionId,
    correlationId: request.correlationId,
    traceId: request.traceId,
    evidence: evidenceFor(request, envelope, steps),
  };
}
