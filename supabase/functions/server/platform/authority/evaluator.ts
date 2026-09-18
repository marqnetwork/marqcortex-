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
import {
  isBoolean,
  isConsequenceLevel,
  isDataClassification,
  isEnvelopeStatus,
  isIsoInstant,
  isoInstantMs,
  isNonEmptyString,
  isPolicyEffect,
  isRecord,
  isRequestedEffect,
  isSpendLimit,
  isStringList,
} from './guards.ts';

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
  // NOT AN ARRAY ADMITS NOTHING, and this is the check that matters most in
  // the whole file. A scope that arrived as the string
  // `"crm.lookup,payments.charge"` has `.length` and `.includes`, so every
  // duck-typed test below would have passed — and `String.prototype.includes`
  // matches SUBSTRINGS, which turned a malformed envelope into a wildcard that
  // admitted `payments.charge`. `Array.isArray` is what tells the two apart.
  if (!isStringList(scope)) return false;
  if (scope.length === 0) return false;
  if (scope.includes(WILDCARD)) return true;
  return scope.includes(value);
}

/**
 * Is every deny rule in this list readable?
 *
 * A DENY RULE THAT CANNOT BE PARSED IS NOT A RULE THAT CAN BE SKIPPED. It is
 * the containment primitive — the thing an operator adds to stop an actor that
 * is already running — so "we could not read it, so we ignored it" is the one
 * outcome it must never have. An unreadable rule makes the whole envelope
 * malformed, and the request is refused rather than evaluated against the rules
 * that happened to parse.
 */
function denyRulesReadable(rules: unknown): rules is readonly ExplicitDenyRule[] {
  if (!Array.isArray(rules)) return false;
  return rules.every((rule) => {
    if (!isRecord(rule)) return false;
    if (!isNonEmptyString(rule.ruleId)) return false;
    if (!isStringList(rule.actionTypes)) return false;
    if (rule.resourceTypes !== undefined && !isStringList(rule.resourceTypes)) return false;
    if (rule.tools !== undefined && !isStringList(rule.tools)) return false;
    return typeof rule.reason === 'string';
  });
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
  // NOT AN ARRAY is a policy source that has malfunctioned, not one that had
  // nothing to say. The unguarded version called `.filter` on it and threw.
  if (!Array.isArray(constraints)) return [MALFORMED_POLICY];

  // A CONSTRAINT WHOSE SHAPE CANNOT BE READ POISONS THE WHOLE SET.
  //
  // Dropping it was the original behaviour and it is indefensible: `effect:
  // "DENY"` — the right word in the wrong case — matched neither `'deny'` nor
  // `'require_approval'`, so a policy that meant to REFUSE was silently ignored
  // and the action was allowed. A deny that can be misspelled into an allow is
  // not a deny. One unreadable constraint therefore denies everything.
  const readable = constraints.every(
    (constraint) =>
      isRecord(constraint) &&
      isNonEmptyString(constraint.policyId) &&
      isPolicyEffect(constraint.effect) &&
      isStringList(constraint.actionTypes) &&
      // `reason` IS NOT DECORATION. It is carried into `refuse(..., reason)`
      // and into the approval summary, both of which call `.slice()` on it —
      // so a constraint with `reason: 123` threw `reason.slice is not a
      // function` out of the evaluator, on the DENY path, at the moment it was
      // refusing. The structural check validated the three fields that decide
      // and not the one that gets read.
      typeof constraint.reason === 'string',
  );
  if (!readable) return [MALFORMED_POLICY];

  return constraints.filter((constraint) =>
    scopeAdmits(constraint.actionTypes, input.request.actionType),
  );
}

/**
 * The constraint a malformed policy source is replaced by.
 *
 * A deny with a wildcard action scope, so it applies whatever was asked for.
 * Named rather than inlined because it appears in an audit record and an
 * operator reading `policy.malformed` needs it to mean one specific thing.
 */
const MALFORMED_POLICY: PolicyConstraint = {
  policyId: AUTHORITY_REASON.policyMalformed,
  effect: 'deny',
  reason: 'A policy constraint could not be read, so it could not be honoured.',
  actionTypes: [WILDCARD],
};

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

/**
 * The evidence attached to a decision.
 *
 * IT REPORTS; IT NEVER DECIDES, AND IT MUST NEVER THROW. That second half was
 * learned the hard way: this function dereferenced `request.actor.actorType`,
 * so the refusal for "the actor could not be read" crashed while building its
 * own evidence — the evaluator raised a TypeError at the exact moment it was
 * supposed to be reporting a clean deny. A reporting path that can fail on the
 * inputs it exists to describe is worse than no reporting at all.
 *
 * So every read here is defensive, and an unreadable field is recorded as the
 * literal `'unreadable'` rather than guessed at or omitted. A reader of the
 * record can then tell "this arrived malformed" from "this was not applicable",
 * which is exactly the distinction someone debugging a misbehaving subsystem
 * needs. `envelope?.` is already safe and stays as it is.
 */
function evidenceFor(
  request: ActionRequest,
  envelope: AuthorityEnvelope | undefined,
  steps: readonly string[],
): AuthorityEvidence {
  const request_ = (isRecord(request) ? request : {}) as Partial<ActionRequest>;
  const actor = (isRecord(request_.actor) ? request_.actor : {}) as Partial<ActorContext>;
  const readable = <T,>(value: T, ok: boolean): T => (ok ? value : ('unreadable' as T));

  return {
    actorType: readable(actor.actorType as ActorContext['actorType'], typeof actor.actorType === 'string'),
    organizationId: readable(
      request_.organizationId as string,
      typeof request_.organizationId === 'string',
    ),
    actionType: readable(request_.actionType as string, typeof request_.actionType === 'string'),
    resourceType: readable(
      request_.resourceType as string,
      typeof request_.resourceType === 'string',
    ),
    requestedEffect: readable(
      request_.requestedEffect as ActionRequest['requestedEffect'],
      isRequestedEffect(request_.requestedEffect),
    ),
    dataClassification: readable(
      request_.dataClassification as ActionRequest['dataClassification'],
      isDataClassification(request_.dataClassification),
    ),
    requestedTool:
      typeof request_.requestedTool === 'string' ? request_.requestedTool : undefined,
    estimatedCostMicroUsd:
      typeof request_.estimatedCostMicroUsd === 'number' && Number.isFinite(request_.estimatedCostMicroUsd)
        ? request_.estimatedCostMicroUsd
        : undefined,
    // NOT coerced to a boolean. `Boolean('no')` is `true`, which would record a
    // malformed membership flag as a VERIFIED one — a false statement in the
    // one field an isolation review reads first.
    membershipVerified: actor.membershipVerified === true,
    envelopeVersion: typeof envelope?.version === 'number' ? envelope.version : undefined,
    envelopeConsequenceCeiling: isConsequenceLevel(envelope?.consequenceCeiling)
      ? envelope.consequenceCeiling
      : undefined,
    envelopeApprovalThreshold: isConsequenceLevel(envelope?.approvalThreshold)
      ? envelope.approvalThreshold
      : undefined,
    evaluatedSteps: steps,
  };
}

/**
 * Is every security-critical field of this envelope readable?
 *
 * Structure only — this says nothing about whether the envelope PERMITS the
 * action, which is step 6's job. It says whether step 6 is able to ask.
 *
 * `explicitDeny` is included even though it was consumed back at step 4,
 * because `denyRulesReadable` gated that consumption: an envelope whose deny
 * rules could not be parsed skipped the deny check, and reaching here with that
 * still unreported would be the silent-skip this whole change exists to remove.
 */
function envelopeReadable(envelope: AuthorityEnvelope): boolean {
  if (!isRecord(envelope)) return false;
  if (!isNonEmptyString(envelope.envelopeId)) return false;
  if (!isNonEmptyString(envelope.organizationId)) return false;
  if (!isNonEmptyString(envelope.subjectActorId)) return false;
  if (!isEnvelopeStatus(envelope.status)) return false;
  if (!isStringList(envelope.allowedActionTypes)) return false;
  if (!isStringList(envelope.allowedResourceTypes)) return false;
  if (!isStringList(envelope.allowedTools)) return false;
  if (!isDataClassification(envelope.dataClassificationCeiling)) return false;
  if (!isConsequenceLevel(envelope.consequenceCeiling)) return false;
  if (envelope.approvalThreshold !== undefined && !isConsequenceLevel(envelope.approvalThreshold)) {
    return false;
  }
  if (envelope.maxCostMicroUsd !== undefined && !isSpendLimit(envelope.maxCostMicroUsd)) {
    return false;
  }
  if (envelope.validFrom !== undefined && !isIsoInstant(envelope.validFrom)) return false;
  if (envelope.validUntil !== undefined && !isIsoInstant(envelope.validUntil)) return false;
  return denyRulesReadable(envelope.explicitDeny);
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

/**
 * The decision for an input that cannot even be destructured.
 *
 * Built from constants because there is nothing to read: no request, no actor,
 * no envelope, no trace. It carries empty identifiers rather than invented ones
 * — a fabricated action id in an audit trail is worse than an absent one,
 * because somebody will eventually try to join on it.
 *
 * `evaluatedSteps` is empty and says so honestly: NOTHING was evaluated. That
 * is exactly what distinguishes this record from every other refusal.
 */
function malformedInputDecision(): AuthorityDecision {
  return {
    decision: 'DENY',
    reasonCodes: [AUTHORITY_REASON.requestMalformed],
    reason: 'The authorization request could not be read.',
    matchedPermissions: [],
    matchedPolicies: [],
    consequenceLevel: 'critical',
    actionId: '',
    correlationId: '',
    evidence: {
      actorType: 'unreadable' as ActorContext['actorType'],
      organizationId: 'unreadable',
      actionType: 'unreadable',
      resourceType: 'unreadable',
      requestedEffect: 'unreadable' as ActionRequest['requestedEffect'],
      dataClassification: 'unreadable' as ActionRequest['dataClassification'],
      membershipVerified: false,
      evaluatedSteps: [],
    },
  };
}

export function evaluateAuthority(input: AuthorityEvaluationInput): AuthorityDecision {
  // ── THE INPUT OBJECT ITSELF, BEFORE IT IS DESTRUCTURED ───────────────────
  //
  // `const { request } = input` throws on `null` and `undefined` — a TypeError
  // raised out of a security boundary before a single rule has run. A boundary
  // must ANSWER, always: a caller catching broadly cannot tell an evaluator
  // that refused from one that fell over, and the safe reading of "it fell
  // over" is not something a caller should have to supply.
  //
  // Checked here rather than by giving the parameter a default, because a
  // default would invent an empty input and evaluate it — the same silent
  // substitution this hardening pass exists to remove.
  if (!isRecord(input)) {
    return malformedInputDecision();
  }
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
      matchedEnvelopeId:
        typeof envelope?.envelopeId === 'string' ? envelope.envelopeId : undefined,
      consequenceLevel,
      approvalRequirement,
      // READ DEFENSIVELY, for the same reason `evidenceFor` does: `refuse` is
      // the path a malformed request takes OUT of the evaluator, so it is the
      // one function that must survive a request that is null or not an object.
      // It dereferenced `request.actionId` directly and threw on exactly the
      // input it existed to refuse.
      actionId: typeof request?.actionId === 'string' ? request.actionId : '',
      correlationId: typeof request?.correlationId === 'string' ? request.correlationId : '',
      traceId: typeof request?.traceId === 'string' ? request.traceId : undefined,
      evidence: evidenceFor(request, envelope, steps),
    };
  }

  // ── 0. The request itself has to be usable ────────────────────────────────
  //
  // Before tenancy, because a request with no action identity cannot be
  // audited, and a decision nobody can later find the subject of is not
  // evidence of anything.
  steps.push('request');
  // THE OBJECTS THEMSELVES, BEFORE ANY FIELD OF THEM IS READ. A null request or
  // a missing actor threw a TypeError out of the evaluator — which is not a
  // refusal but an exception the CALLER has to interpret, and a caller that
  // catches broadly could interpret it as anything at all. An authorization
  // boundary answers; it does not raise.
  if (!isRecord(request)) {
    return refuse(
      AUTHORITY_REASON.requestMalformed,
      'The request could not be read.',
    );
  }
  if (!isRecord(request.actor)) {
    return refuse(
      AUTHORITY_REASON.actorMalformed,
      'The request carries no readable actor.',
    );
  }
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
  // STRICT ISO, NOT "Date.parse RETURNED A NUMBER".
  //
  // The finiteness test was never a validator. `Date.parse("99")` yields the
  // year 99 and `Date.parse("01/02/2030")` a US-format date, both finite, both
  // accepted. That was not cosmetic: an envelope that EXPIRED in 2020,
  // evaluated with `nowIso: "99"`, looked LIVE — "now" landed before the
  // expiry, the window passed, and the action was ALLOWED. A timestamp nobody
  // meant reopened authority that had been deliberately closed.
  const nowMs = isoInstantMs(input.nowIso);
  if (nowMs === undefined) {
    return refuse(
      AUTHORITY_REASON.contextIncomplete,
      'The evaluation timestamp is not a usable ISO-8601 instant.',
    );
  }

  // ── THE REQUEST'S OWN ENUMS, CHECKED AT RUNTIME ──────────────────────────
  //
  // `requestedEffect` and `dataClassification` are declared as unions and
  // arrive as whatever the caller actually built. Both feed rank comparisons,
  // and a rank lookup that misses returns `undefined`, which loses every `>`
  // it is on. So they are checked HERE, before anything compares them, rather
  // than trusted because the type said so.
  if (!isRequestedEffect(request.requestedEffect)) {
    return refuse(
      AUTHORITY_REASON.requestMalformed,
      'The request does not state a recognisable effect.',
    );
  }
  if (!isDataClassification(request.dataClassification)) {
    return refuse(
      AUTHORITY_REASON.requestMalformed,
      'The request does not state a recognisable data classification.',
    );
  }
  if (request.requestedTool !== undefined && typeof request.requestedTool !== 'string') {
    return refuse(
      AUTHORITY_REASON.requestMalformed,
      'The request names a tool that is not a tool identifier.',
    );
  }
  // `reversible` DRIVES THE IRREVERSIBILITY FLOOR, and that floor is applied
  // with `if (!request.reversible)`. Truthiness is the wrong test: the STRING
  // `"false"` is truthy, so a flag that survived a form post or a JSON
  // round-trip as text suppressed the floor entirely and an irreversible action
  // classified as though it could be undone. `1` did the same.
  if (!isBoolean(request.reversible)) {
    return refuse(
      AUTHORITY_REASON.requestMalformed,
      'The request does not state whether its effect can be undone.',
    );
  }
  if (
    request.estimatedCostMicroUsd !== undefined &&
    !isSpendLimit(request.estimatedCostMicroUsd)
  ) {
    // An unusable cost never reaches the ceiling comparison, where `cost > limit`
    // would be false for NaN and let it through as the cheapest action possible.
    return refuse(
      AUTHORITY_REASON.requestMalformed,
      'The request states a cost that is not a usable amount.',
    );
  }
  // CHECKED HERE BECAUSE STEP 1 USES IT. Readability is a precondition of
  // weighing a fact, not an authorization step of its own, so it belongs ahead
  // of the ordered steps rather than inside them — and `membershipVerified` is
  // read by the tenant step, before the actor step would otherwise reach it.
  // Anything other than a boolean is not a membership answer: a truthy string
  // would have read as "verified" and sailed through the tenant check.
  if (typeof request.actor?.membershipVerified !== 'boolean') {
    return refuse(
      AUTHORITY_REASON.actorMalformed,
      'The actor\u2019s membership state could not be read.',
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
  // PERMISSIONS MUST BE A REAL ARRAY. As a string, `.includes` matches
  // substrings — an actor carrying the single string `'admin.superpower'`
  // would satisfy a required permission of `'p'`, because `'p'` appears inside
  // `'superpower'`. That is privilege escalation by punctuation.
  if (!isStringList(actor.permissions)) {
    return refuse(
      AUTHORITY_REASON.actorMalformed,
      'The actor\u2019s permissions could not be read.',
    );
  }
  if (!isStringList(actor.roles)) {
    return refuse(
      AUTHORITY_REASON.actorMalformed,
      'The actor\u2019s roles could not be read.',
    );
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
    // AN UNREADABLE DENY LIST REFUSES HERE, not at step 6. Waiting would mean
    // the deny check was skipped and the request continued — briefly, but
    // through the policy step — on an envelope already known to be broken.
    if (!denyRulesReadable(envelope.explicitDeny)) {
      return refuse(
        AUTHORITY_REASON.envelopeMalformed,
        'This actor\u2019s deny rules could not be read, so they could not be honoured.',
      );
    }
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
  // ── THE ENVELOPE'S OWN FIELDS, CHECKED BEFORE ANY OF THEM IS TRUSTED ─────
  //
  // Every bound below this point is enforced by a comparison, and every one of
  // those comparisons answered "no" when its operand was unreadable. Probed
  // against the unhardened evaluator, an envelope with `status: "zombie"`,
  // `consequenceCeiling: "nonsense"`, `dataClassificationCeiling: "nonsense"`
  // or `approvalThreshold: "sometimes"` did not fail — it ALLOWED, because a
  // status that is not `'suspended'` or `'expired'` read as active, and a rank
  // lookup that misses loses every `>` it is on.
  //
  // So the whole envelope is validated as one object, and a single unreadable
  // field refuses the request. NOT field-by-field with per-field fallbacks: a
  // fallback here would mean the platform inventing a bound nobody configured,
  // and an invented bound is indistinguishable in the record from a real one.
  if (!envelopeReadable(envelope)) {
    return refuse(
      AUTHORITY_REASON.envelopeMalformed,
      'This actor\u2019s authority could not be read.',
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
  // The window bounds go through the SAME strict guard as `nowIso`. A bound
  // that is merely `Date.parse`-able is a bound whose meaning depends on the
  // engine's tolerance for loose formats, and a validity window is the wrong
  // place to be tolerant.
  if (envelope.validFrom !== undefined) {
    const fromMs = isoInstantMs(envelope.validFrom);
    // An unreadable bound denies, for the reason the header gives: a window
    // that cannot be read is not a window that can be honoured.
    if (fromMs === undefined || nowMs < fromMs) {
      return refuse(
        AUTHORITY_REASON.envelopeNotYetValid,
        'This actor’s authority is not yet in force.',
      );
    }
  }
  if (envelope.validUntil !== undefined) {
    const untilMs = isoInstantMs(envelope.validUntil);
    if (untilMs === undefined || nowMs >= untilMs) {
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
  const verdict = classifyConsequence(request, input.consequence);
  const consequenceLevel = verdict.level;

  // A BROKEN CLASSIFIER REFUSES, RATHER THAN BEING RAISED TO `critical` AND
  // WEIGHED. Raising alone looked sufficient and is not: an envelope whose
  // ceiling is `critical` with no approval threshold would permit a `critical`
  // action, so a subsystem returning nonsense would have been "handled" and
  // then allowed anyway — on the widest envelopes, which are exactly the actors
  // where a malfunctioning classifier matters most. A source that could not
  // classify has not classified, and that is an unusable authorization fact.
  if (verdict.malformed) {
    return refuse(
      AUTHORITY_REASON.consequenceMalformed,
      'This action could not be classified, so it could not be authorised.',
      'DENY',
      consequenceLevel,
    );
  }

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
