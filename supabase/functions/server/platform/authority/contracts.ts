/**
 * Platform authority contracts (BP-001).
 *
 * ONE VOCABULARY FOR "MAY THIS ACTION HAPPEN?", spoken by every kind of actor
 * the platform has — a person, a service identity, an AI agent, a workflow, a
 * background job, an inbound integration. Today that question is asked in four
 * dialects: `ai/security/actor.ts` asks it about a person and an AI feature,
 * `admin/rbac.ts` about a platform operator and a setting, `agents/service/
 * agentRbac.ts` about a person and a run, and the agent orchestrator asks it
 * about an agent and a tool. The four agree — `tests/features/authorityModel.
 * test.ts` drives all of them from one subject and asserts they do — but they
 * agree by hand, and a fifth surface would have to be taught the agreement
 * again.
 *
 * THIS MODULE IS NOT A FIFTH SURFACE. It is the shape the existing four are
 * expressed in, so that the next consequential action — an outbound email, a
 * payment, a department that creates itself — is decided by the same evaluator
 * rather than by a new hand-written agreement.
 *
 * WHY IT IMPORTS NOTHING.
 *
 *   Not a style preference. `tests/system/ai_boundary.test.ts` enforces that
 *   the AI tree is entered through `ai/index.ts` and that nothing re-implements
 *   a control-plane guarantee. If the platform evaluator imported agent or
 *   control-plane internals, "the platform decides" and "the AI subsystem
 *   decides" would become the same statement, and the direction of the
 *   dependency — which is the whole architectural claim of BP-001 — would be
 *   unprovable. So the evaluator holds no agent type, no control plane, no
 *   store, no clock of its own. Callers translate INTO this vocabulary; this
 *   vocabulary never reaches back out.
 *
 * WHAT IS DELIBERATELY NOT HERE: users, roles, memberships, sessions. Those
 * exist once already, in Postgres and in `ai/security/actor.ts`, and BP-001 §6
 * is explicit that a second one must not be created. An `ActorContext` is a
 * PROJECTION of a subject that was resolved somewhere else — it carries the
 * answer, never the authority to compute it.
 */

// ── Actors ──────────────────────────────────────────────────────────────────

/**
 * What KIND of thing is acting.
 *
 * The distinction is load-bearing rather than descriptive, and `workflow` is
 * the case that shows why. A workflow is started by a person, and the naive
 * reading is that it therefore acts with that person's authority. It does not:
 * a person who may approve their own run's spending has that authority because
 * a human is present at each decision, and a workflow that inherited it would
 * spend it unattended, thousands of times, at three in the morning. The
 * evaluator refuses to let a non-human actor carry a human's envelope, and this
 * enum is how it can tell.
 */
export type ActorType =
  /** A person, authenticated and present. */
  | 'human'
  /** A platform service identity. Bounded, never interactive. */
  | 'service'
  /** An AI agent executing inside a run. */
  | 'ai_agent'
  /** A workflow driving agent runs. Never inherits its initiator's authority. */
  | 'workflow'
  /** A scheduled or background job. */
  | 'job'
  /** An inbound integration or webhook. */
  | 'integration';

export const ACTOR_TYPES: readonly ActorType[] = [
  'human',
  'service',
  'ai_agent',
  'workflow',
  'job',
  'integration',
] as const;

/** Actor types that are a PERSON, present and accountable at this decision. */
export const HUMAN_ACTOR_TYPES: ReadonlySet<ActorType> = new Set<ActorType>(['human']);

/**
 * The acting party, as already resolved by whoever authenticated them.
 *
 * NOTHING HERE MAY COME FROM A CLIENT. Every field is an output of a
 * server-side resolution — `resolveActor`, `resolveOrganization`,
 * `resolveAgentActor`, an agent definition read from the certified registry.
 * The evaluator cannot tell a resolved value from an asserted one, which is
 * precisely why the rule lives at the boundary that builds this object and is
 * restated at every adapter that does.
 */
export interface ActorContext {
  readonly actorId: string;
  readonly actorType: ActorType;
  /** The tenant this actor is acting within. Resolved, never asserted. */
  readonly organizationId: string;
  /**
   * Roles as the identity provider reported them, lower-cased.
   *
   * Carried for EVIDENCE, not for enforcement. The evaluator never compares a
   * role: it compares permissions, because a role comparison at a call site is
   * a check that can be forgotten at the seventh call site. That is the same
   * judgement `agents/service/agentRbac.ts` already documents.
   */
  readonly roles: readonly string[];
  /**
   * The permissions those roles imply, resolved server-side.
   *
   * THE ONLY THING THE EVALUATOR CHECKS for step 3 of the order. An empty list
   * is a valid, meaningful value: it denies.
   */
  readonly permissions: readonly string[];
  /**
   * False when the tenant was assumed rather than confirmed by a membership
   * row — the `AI_ALLOW_DEFAULT_ORGANIZATION` fallback in `security/tenancy.ts`.
   *
   * The evaluator treats an unverified membership as a hard ceiling rather than
   * a warning, matching what `agentRbac.ts` already does for its privileged
   * capabilities. "Somebody stamped a role on this account" and "this account
   * belongs to this tenant" are different facts, and only the second one scopes
   * a consequential action.
   */
  readonly membershipVerified: boolean;
  /** Session, run or job identifier this actor is acting under, if any. */
  readonly sessionId?: string;
  readonly runId?: string;
  /**
   * The actor that CAUSED this non-human actor to exist.
   *
   * Recorded so the audit trail can answer "who set this in motion", and for no
   * other purpose. It is explicitly NOT a source of authority: see `ActorType`.
   * A workflow started by an owner carries `initiatedBy` pointing at the owner
   * and gets none of the owner's envelope.
   */
  readonly initiatedBy?: {
    readonly actorId: string;
    readonly actorType: ActorType;
  };
}

// ── Consequence ─────────────────────────────────────────────────────────────

/**
 * How much it matters if this action is wrong.
 *
 * FOUR LEVELS, TOTALLY ORDERED, AND DECIDED BY RULES — never by a model. BP-001
 * §4.4 is explicit and the reason is not subtle: a classifier that can be
 * argued with is an authorization boundary that can be argued with. A later
 * packet may let a model RECOMMEND a level; the enforced one is computed here,
 * from persisted facts, deterministically.
 */
export type ConsequenceLevel = 'low' | 'medium' | 'high' | 'critical';

const CONSEQUENCE_RANK: Readonly<Record<ConsequenceLevel, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

/** Rank of a level. Higher is more consequential. */
export function consequenceRank(level: ConsequenceLevel): number {
  return CONSEQUENCE_RANK[level];
}

/** True when `level` is strictly more consequential than `ceiling`. */
export function exceedsConsequence(level: ConsequenceLevel, ceiling: ConsequenceLevel): boolean {
  return CONSEQUENCE_RANK[level] > CONSEQUENCE_RANK[ceiling];
}

/** The more consequential of two levels. */
export function maxConsequence(a: ConsequenceLevel, b: ConsequenceLevel): ConsequenceLevel {
  return CONSEQUENCE_RANK[a] >= CONSEQUENCE_RANK[b] ? a : b;
}

/**
 * How sensitive the data an action touches is.
 *
 * Deliberately coarse. A classification vocabulary that needs a handbook is one
 * that gets applied inconsistently, and an inconsistently applied data ceiling
 * is worse than none because it reads as protection.
 */
export type DataClassification = 'public' | 'internal' | 'confidential' | 'restricted';

const DATA_RANK: Readonly<Record<DataClassification, number>> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

function dataRank(classification: DataClassification): number {
  return DATA_RANK[classification];
}

export function exceedsDataCeiling(
  classification: DataClassification,
  ceiling: DataClassification,
): boolean {
  return DATA_RANK[classification] > DATA_RANK[ceiling];
}

/**
 * What the action does to the world.
 *
 * Feeds consequence classification: a read is not a write, and a write inside
 * the tenant is not an irreversible effect on somebody outside it.
 */
export type RequestedEffect =
  /** Reads only. No state changes. */
  | 'read'
  /** Creates or updates state inside the tenant. Reversible. */
  | 'write'
  /** Removes state. Reversible only if something kept a copy. */
  | 'delete'
  /** Leaves the platform: an email, a payment, a call to somebody's API. */
  | 'external_effect'
  /** Changes who may do what. The authority system acting on itself. */
  | 'authority_change';

// ── Action request ──────────────────────────────────────────────────────────

/**
 * One consequential thing an actor wants to do.
 *
 * ASSEMBLED BY THE CALLER, from facts the caller already holds. The evaluator
 * fetches nothing: it cannot reach a database, so every fact it weighs is one
 * the caller put here, and the audit record therefore states exactly what was
 * weighed. That is not a limitation worked around — it is what makes the
 * decision reproducible from the record months later.
 */
export interface ActionRequest {
  /** Unique to this attempt. Distinguishes a retry from a fresh request. */
  readonly actionId: string;
  /** Walks with the request across every subsystem and trail. */
  readonly correlationId: string;
  /**
   * What is being attempted, as a stable dotted key — `agent.tool.call`,
   * `outreach.email.send`. The vocabulary belongs to the calling subsystem;
   * the evaluator only matches it against scopes and deny rules.
   */
  readonly actionType: string;
  readonly resourceType: string;
  readonly resourceId?: string;
  /** The tenant the RESOURCE belongs to. Compared against the actor's. */
  readonly organizationId: string;
  readonly actor: ActorContext;
  readonly requestedEffect: RequestedEffect;
  /** Sensitivity of the data this action would touch. */
  readonly dataClassification: DataClassification;
  /** Tool or capability being requested, where the action uses one. */
  readonly requestedTool?: string;
  /**
   * Whether the effect can be undone by the platform. An irreversible action is
   * classified at least `high` — see `consequence.ts`.
   */
  readonly reversible: boolean;
  /** What this action is expected to cost, in micro-USD. */
  readonly estimatedCostMicroUsd?: number;
  readonly traceId?: string;
  /** Bounded scalars carried into the audit evidence. Never enforced on. */
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

// ── Authority envelope ──────────────────────────────────────────────────────

export type EnvelopeStatus = 'active' | 'suspended' | 'expired';

/**
 * An EXPLICIT DENY, which no allow anywhere can overcome.
 *
 * Separate from the absence of an allow, and the difference is the whole
 * reason the type exists. "This envelope does not grant X" is a default that a
 * wider envelope may legitimately fill in. "This envelope forbids X" is a
 * statement that survives every other grant — which is what makes it the right
 * shape for a containment action: revoking an envelope races whatever is
 * already running, adding a deny does not.
 */
export interface ExplicitDenyRule {
  readonly ruleId: string;
  /** Action types this rule forbids. `*` forbids every action type. */
  readonly actionTypes: readonly string[];
  /** Optional narrowing: only for these resource types. */
  readonly resourceTypes?: readonly string[];
  /** Optional narrowing: only for these tools. */
  readonly tools?: readonly string[];
  /** Why, for the audit record. Caller-safe text. */
  readonly reason: string;
}

/**
 * What an actor may do ON ITS OWN, and where that stops.
 *
 * "On its own" is the load-bearing phrase. An envelope is not a permission
 * list — permissions are checked before it, at step 3. An envelope answers the
 * NEXT question: given that this actor is permitted to do this kind of thing at
 * all, how far may it go before a human has to be asked?
 *
 * VERSIONED, because an envelope is evidence. A decision made last Tuesday was
 * made against the envelope as it stood last Tuesday, and an audit record that
 * names an envelope without naming its version points at whatever the envelope
 * has since become.
 */
export interface AuthorityEnvelope {
  readonly envelopeId: string;
  readonly version: number;
  /** The tenant that owns this envelope. Never crosses one. */
  readonly organizationId: string;
  /** Which actor this envelope was resolved FOR. */
  readonly subjectActorId: string;
  readonly subjectActorType: ActorType;
  readonly status: EnvelopeStatus;

  /** Action types the actor may take. `*` means every action type. */
  readonly allowedActionTypes: readonly string[];
  /** Resource types it may touch. `*` means every resource type. */
  readonly allowedResourceTypes: readonly string[];
  /** Tools it may use. Empty means no tool at all; `*` means every tool. */
  readonly allowedTools: readonly string[];
  /** The most sensitive data it may touch autonomously. */
  readonly dataClassificationCeiling: DataClassification;
  /** The most consequential action it may take autonomously. */
  readonly consequenceCeiling: ConsequenceLevel;
  /**
   * At or above this level, a human decides — even inside every other bound.
   *
   * Distinct from `consequenceCeiling` and the pair is deliberate. The ceiling
   * says what is possible at all; the threshold says what is possible without
   * asking. An envelope whose threshold is `high` and whose ceiling is
   * `critical` permits a critical action WITH approval and refuses nothing
   * outright. Absent means no level alone forces approval.
   */
  readonly approvalThreshold?: ConsequenceLevel;
  /** Spend ceiling for a single action, micro-USD. Absent means unbounded. */
  readonly maxCostMicroUsd?: number;
  /** ISO-8601. Outside this window the envelope grants nothing. */
  readonly validFrom?: string;
  readonly validUntil?: string;
  /** Denies that beat every allow, including those of a wider envelope. */
  readonly explicitDeny: readonly ExplicitDenyRule[];
}

// ── Policy ──────────────────────────────────────────────────────────────────

/**
 * A constraint that applies to the ORGANIZATION rather than to one actor.
 *
 * The seam for the policy mechanisms that already exist — the AI policy engine,
 * the spend guard, the platform halt switch. A caller projects their verdict
 * into this shape rather than the evaluator learning to call them, which keeps
 * the dependency pointing the one way BP-001 requires.
 */
export interface PolicyConstraint {
  readonly policyId: string;
  readonly effect: 'allow' | 'deny' | 'require_approval';
  /** Why. Becomes a reason code and audit evidence. */
  readonly reason: string;
  /** Action types this policy speaks about. `*` means every action type. */
  readonly actionTypes: readonly string[];
}

// ── Decision ────────────────────────────────────────────────────────────────

export type AuthorityDecisionOutcome = 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';

/**
 * Machine-readable reasons a decision came out the way it did.
 *
 * STRUCTURED, NOT PROSE. BP-001 §4.5 asks for reason codes and the reason is
 * operational: "denied" in a log is a sentence somebody has to interpret;
 * `tenant.mismatch` is something a dashboard can count and an alert can fire
 * on. Human-readable text rides alongside, for the person reading one record.
 */
export const AUTHORITY_REASON = {
  // Step 1 — tenant
  tenantMissing: 'tenant.missing',
  tenantMismatch: 'tenant.mismatch',
  tenantOk: 'tenant.ok',
  membershipUnverified: 'tenant.membership_unverified',

  // Step 2 — actor
  actorMissing: 'actor.missing',
  actorTypeUnknown: 'actor.type_unknown',
  actorOk: 'actor.ok',

  // Step 3 — permission
  permissionMissing: 'permission.missing',
  permissionGranted: 'permission.granted',

  // Step 4 — explicit deny
  explicitDeny: 'deny.explicit',

  // Step 5 — policy
  policyDeny: 'policy.deny',
  policyRequiresApproval: 'policy.require_approval',
  policyOk: 'policy.ok',

  // Step 6 — envelope
  envelopeMissing: 'envelope.missing',
  envelopeSuspended: 'envelope.suspended',
  envelopeExpired: 'envelope.expired',
  envelopeNotYetValid: 'envelope.not_yet_valid',
  envelopeTenantMismatch: 'envelope.tenant_mismatch',
  envelopeSubjectMismatch: 'envelope.subject_mismatch',
  envelopeActionOutOfScope: 'envelope.action_out_of_scope',
  envelopeResourceOutOfScope: 'envelope.resource_out_of_scope',
  envelopeOk: 'envelope.ok',

  // Step 7 — data, tool, budget
  toolOutOfScope: 'tool.out_of_scope',
  dataCeilingExceeded: 'data.ceiling_exceeded',
  budgetExceeded: 'budget.ceiling_exceeded',
  constraintsOk: 'constraints.ok',

  // Step 8 — consequence
  consequenceCeilingExceeded: 'consequence.ceiling_exceeded',
  consequenceThresholdReached: 'consequence.approval_threshold_reached',

  // Cross-cutting
  inheritedAuthorityRefused: 'authority.inheritance_refused',
  contextIncomplete: 'context.incomplete',
  allowed: 'decision.allowed',
} as const;

export type AuthorityReasonCode = (typeof AUTHORITY_REASON)[keyof typeof AUTHORITY_REASON];

/** What kind of human decision would unblock a `REQUIRE_APPROVAL`. */
export interface ApprovalRequirement {
  /** Why approval is being asked for. */
  readonly reasonCode: AuthorityReasonCode;
  /** The level that triggered it, for the approver's benefit. */
  readonly consequenceLevel: ConsequenceLevel;
  /** One sentence an approver can act on. Caller-safe. */
  readonly summary: string;
  /**
   * Whether the envelope permits this at all once approved.
   *
   * False is a real and important case: an action ABOVE the envelope's ceiling
   * is denied, not escalated. Approval widens what an actor may do unattended;
   * it does not widen the envelope itself.
   */
  readonly withinEnvelopeCeiling: boolean;
}

/**
 * Everything that was weighed, kept so the decision can be re-read later.
 *
 * Scalars only, and bounded by the evaluator. An evidence object that can carry
 * an arbitrary payload becomes an uncontrolled copy of tenant business data the
 * first time somebody finds it convenient — the same decision
 * `observability/audit.ts` documents for prompts and completions.
 */
export interface AuthorityEvidence {
  readonly actorType: ActorType;
  readonly organizationId: string;
  readonly actionType: string;
  readonly resourceType: string;
  readonly requestedEffect: RequestedEffect;
  readonly dataClassification: DataClassification;
  readonly requestedTool?: string;
  readonly estimatedCostMicroUsd?: number;
  readonly membershipVerified: boolean;
  readonly envelopeVersion?: number;
  readonly envelopeConsequenceCeiling?: ConsequenceLevel;
  readonly envelopeApprovalThreshold?: ConsequenceLevel;
  readonly evaluatedSteps: readonly string[];
}

/**
 * The answer. Exactly one of three, plus why.
 *
 * `decision` is what the caller enforces. Everything else exists so that a
 * person reading the record a quarter later can reconstruct the reasoning
 * without re-running anything.
 */
export interface AuthorityDecision {
  readonly decision: AuthorityDecisionOutcome;
  readonly reasonCodes: readonly AuthorityReasonCode[];
  /** Caller-safe. Never names an internal identifier the actor cannot see. */
  readonly reason: string;
  readonly matchedPermissions: readonly string[];
  readonly matchedPolicies: readonly string[];
  readonly matchedEnvelopeId?: string;
  readonly consequenceLevel: ConsequenceLevel;
  readonly approvalRequirement?: ApprovalRequirement;
  readonly actionId: string;
  readonly correlationId: string;
  readonly traceId?: string;
  readonly evidence: AuthorityEvidence;
}

// ── Ports ───────────────────────────────────────────────────────────────────

/**
 * Where an envelope comes from.
 *
 * A PORT RATHER THAN A TABLE READ, and not as a hedge. This module cannot
 * import the agent registry, the RBAC tables or a Postgres client — the
 * boundary above forbids all three — so a port is the only shape an envelope
 * source can take from here. BP-001 ships one implementation, derived from the
 * authoritative records that already exist (a certified agent definition, a
 * resolved capability grant). A SQL-backed source for tenant-authored
 * envelopes is a later packet and lands behind this same interface.
 *
 * SYNCHRONOUS ON PURPOSE. A decision that can await is a decision that can time
 * out halfway through, leaving a caller holding neither an allow nor a deny.
 * Callers gather their facts first, then decide.
 */
export interface AuthorityEnvelopeSource {
  /** The envelope for this actor, or undefined when none exists. */
  resolve(actor: ActorContext, request: ActionRequest): AuthorityEnvelope | undefined;
}

/**
 * Organization-level constraints in force for this request.
 *
 * The seam onto the policy mechanisms that already exist. Returning an empty
 * list means "no policy speaks to this", which is NOT the same as allow — the
 * evaluator continues to the envelope either way.
 */
export interface AuthorityPolicySource {
  constraints(request: ActionRequest): readonly PolicyConstraint[];
}

/**
 * How consequential this action is.
 *
 * A port so a subsystem can sharpen the platform default with what it knows —
 * a tool's declared risk class, a payment's amount — without the platform
 * module learning that subsystem's vocabulary. Whatever it returns is combined
 * with the platform floor by `classifyConsequence`, and the RESULT IS THE
 * HIGHER OF THE TWO: a subsystem may raise a classification, never lower it.
 */
export interface ConsequenceSource {
  classify(request: ActionRequest): ConsequenceLevel | undefined;
}

/**
 * Everything the evaluator needs, gathered by the caller.
 *
 * Absent members are meaningful and are NOT holes to be filled with a default:
 * an absent envelope source denies every non-human actor, because an actor
 * whose bounds nobody can state has no bounds, and an actor with no bounds is
 * the one thing this module exists to refuse.
 */
export interface AuthorityEvaluationInput {
  readonly request: ActionRequest;
  readonly envelopes?: AuthorityEnvelopeSource;
  readonly policies?: AuthorityPolicySource;
  readonly consequence?: ConsequenceSource;
  /**
   * The permission this action requires.
   *
   * Named by the CALLER rather than derived here, because the permission
   * vocabulary belongs to the subsystem that owns the action. Absent means the
   * action requires no named permission beyond existing — valid for a read that
   * membership alone authorises, and refused for anything that changes state.
   */
  readonly requiredPermission?: string;
  /** ISO-8601 now, supplied by the caller's clock. Fails closed if unparseable. */
  readonly nowIso: string;
}
