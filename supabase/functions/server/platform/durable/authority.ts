/**
 * The durable runtime's adapter onto the BP-001 authority evaluator.
 *
 * THE ONLY PLACE THE TWO VOCABULARIES MEET, and the direct counterpart of
 * `ai/agents/authority/agentAuthorityAdapter.ts`. The platform evaluator knows
 * nothing about jobs, leases or handlers — it cannot, it imports nothing — and
 * the job runtime does not learn to assemble `ActionRequest`s at every call
 * site. This file translates, in one direction, at one seam.
 *
 * IT DECIDES NOTHING. Every function here is a projection. The decision is
 * `evaluateAuthority`'s and the enforcement is `worker.ts`'s.
 *
 * ── WHY THE ENVELOPE IS DERIVED FROM THE HANDLER DECLARATION ──────────────
 *
 * BP-001 §6 says to prefer additive tables "only if existing tables cannot
 * represent the required concepts", and the agent adapter reached the same
 * conclusion from the other direction: a certified `AgentDefinition` already IS
 * an authority envelope written in the agent runtime's words.
 *
 * A `JobHandlerDeclaration` is the same kind of object. It is code-resident,
 * reviewed in a pull request, and it states exactly the facts an envelope needs
 * — which action, which resource, which permission, how consequential, how
 * reversible, how much it may spend. Adding a table to restate it would create
 * a SECOND answer to "what may this job do", and two answers to that question
 * is the precise failure BP-001 exists to prevent. BP-002 §11 says as much:
 * stop and report before inventing tenant-authored authority persistence.
 *
 * Tenant-authored envelopes remain a later packet and land behind
 * `AuthorityEnvelopeSource` without touching anything here.
 *
 * ── THE RULE THIS FILE EXISTS TO MAKE UNBREAKABLE ─────────────────────────
 *
 * A background job never inherits the authority of the human who started it.
 *
 * The temptation is real and it is not stupid: the person pressed the button,
 * the person is permitted to do the thing, so why should the job not do it as
 * them? Because the person is permitted BECAUSE THEY ARE PRESENT. Their
 * judgement is part of the authorization. A job carrying their envelope would
 * spend it unattended, at three in the morning, as many times as the queue says
 * — and nobody who granted that permission was agreeing to that.
 *
 * So `jobActorContext` puts the person in `initiatedBy` and takes the
 * permissions from the JOB'S OWN durable actor context, which the enqueuer set
 * from the handler declaration rather than from their session. The evaluator
 * refuses a non-human actor that resolves onto a human envelope, and the
 * database refuses a job row whose actor type is `human`. Three layers, because
 * one is a rule that holds until somebody finds the path that skips it.
 */

import {
  classifyConsequence,
  evaluateAuthority,
  type ActionRequest,
  type ActorContext,
  type AuthorityDecision,
  type AuthorityEnvelope,
  type AuthorityEvaluationInput,
  type PolicyConstraint,
} from '../authority/index.ts';
import type { DurableJob, JobHandlerDeclaration } from './contracts.ts';

/**
 * The job, as an actor.
 *
 * Read off the durable record rather than recomputed, which is the point: a job
 * claimed months after it was enqueued acts as what it was enqueued as, not as
 * whatever the world happens to say now.
 *
 * ── `membershipVerified` IS TRUE, AND HERE IS THE ARGUMENT ────────────────
 *
 * The first version of this file read it as "true only when the job carries an
 * initiating human", on the reasoning that a job set in motion by nobody has
 * nobody's membership behind it. That reading is wrong, and the way it is wrong
 * is instructive: `evaluateAuthority` refuses EVERY mutating action from an
 * unverified actor, so under it a recurring platform sweep — the one kind of
 * job that most obviously has no human — could never write anything. The pilot
 * would have been denied on every tick, and the tests said so.
 *
 * The mistake was reading BP-001's field as "a person was present". It is not.
 * `ActorContext` documents it as false when THE TENANT WAS ASSUMED RATHER THAN
 * CONFIRMED — the `AI_ALLOW_DEFAULT_ORGANIZATION` fallback, where a request
 * with no membership lands in a configured bucket and the platform can no
 * longer say which tenant it is really acting for. The question is about the
 * ORGANIZATION, not about the actor's provenance.
 *
 * For a durable job the organization is confirmed, and confirmed more strongly
 * than a membership row confirms it:
 *
 *   `durable_jobs.organization_id` is a foreign key into `public.organizations`,
 *   so a job for a tenant that does not exist cannot be written down;
 *
 *   `assertJobActor` refuses an actor whose organization differs from the job's
 *   — at enqueue, and again when the row is read back in `postgresStores.ts` —
 *   so a job whose tenant was guessed cannot be stored or loaded.
 *
 * That is the same shape of argument the agent adapter makes when it asserts
 * `true` because a run record exists: the record's existence is itself the
 * proof. Here the proof is a foreign key and a refusal, which is stronger.
 *
 * The person, where there is one, is in `initiatedBy` and grants nothing.
 */
export function jobActorContext(job: DurableJob): ActorContext {
  return {
    actorId: job.actor.actorId,
    actorType: job.actor.actorType,
    organizationId: job.actor.organizationId,
    // A JOB HOLDS NO ROLES. Roles describe people. Leaving this empty keeps the
    // distinction visible in every audit record rather than implied — the same
    // call the agent adapter makes for the same reason.
    roles: [],
    permissions: job.actor.permissions,
    membershipVerified: true,
    ...(job.actor.initiatedBy === undefined ? {} : { initiatedBy: job.actor.initiatedBy }),
  };
}

/**
 * The handler declaration, as an authority envelope.
 *
 * Versioned by the job's ATTEMPT rather than by a definition version, because a
 * declaration has no version of its own — it is code, and the deployment is its
 * version. BP-001 requires an integer and requires that the audit record names
 * the envelope the decision was made against; `envelopeId` carries the handler
 * key verbatim, which together with the deployment identifies it exactly.
 *
 * NO TOOLS. A job calls no tools — a handler that wants one goes through the
 * agent runtime, which has its own envelope for exactly that. An empty
 * `allowedTools` means "no tool at all", which is the correct and fail-closed
 * statement rather than an oversight.
 *
 * NO EXPLICIT DENY, and its absence is worth naming: an explicit deny is how a
 * tenant contains a specific actor mid-flight, and that arrives with
 * tenant-authored envelopes in a later packet. Until then the list is empty
 * because there is nothing that could populate it — not because deny rules are
 * ignored here. `evaluateAuthority` honours whatever the source supplies.
 */
export function jobAuthorityEnvelope(
  job: DurableJob,
  declaration: JobHandlerDeclaration,
): AuthorityEnvelope {
  return {
    envelopeId: `job-handler:${declaration.jobType}`,
    version: 1,
    organizationId: job.organizationId,
    subjectActorId: job.actor.actorId,
    subjectActorType: job.actor.actorType,
    status: 'active',
    allowedActionTypes: [declaration.actionType],
    allowedResourceTypes: [declaration.resourceType],
    allowedTools: [],
    dataClassificationCeiling: declaration.dataClassification,
    consequenceCeiling: declaration.consequenceCeiling,
    // NO CONSEQUENCE-BASED THRESHOLD FROM THE DECLARATION ITSELF. A threshold
    // here would park work that runs unattended today, and BP-002 §3 does not
    // permit this packet to change existing behaviour. An organization policy
    // that wants approval says so through `AuthorityPolicySource`, which is the
    // seam the existing policy mechanisms already project into.
    approvalThreshold: undefined,
    ...(declaration.maxCostMicroUsd === undefined
      ? {}
      : { maxCostMicroUsd: declaration.maxCostMicroUsd }),
    explicitDeny: [],
  };
}

/** One job execution, as an action request. */
export function jobActionRequest(
  job: DurableJob,
  declaration: JobHandlerDeclaration,
  traceId: string,
): ActionRequest {
  return {
    // THE ACTION ID IS THE JOB AND THE ATTEMPT, not just the job. BP-001 says
    // `actionId` "distinguishes a retry from a fresh request", and a job's
    // third attempt is a different attempt at the same work — an audit trail
    // that could not tell them apart would show one decision for five tries.
    actionId: `${job.jobId}#${job.attempt}`,
    correlationId: job.correlationId,
    actionType: declaration.actionType,
    resourceType: declaration.resourceType,
    resourceId: job.jobId,
    organizationId: job.organizationId,
    actor: jobActorContext(job),
    requestedEffect: declaration.requestedEffect,
    dataClassification: declaration.dataClassification,
    reversible: declaration.reversible,
    ...(declaration.maxCostMicroUsd === undefined
      ? {}
      : { estimatedCostMicroUsd: declaration.maxCostMicroUsd }),
    traceId,
    attributes: {
      jobType: job.jobType,
      attempt: job.attempt,
      scheduled: job.scheduleId !== undefined,
    },
  };
}

/** Everything the evaluator needs for one job execution. */
export function jobAuthorityInput(params: {
  readonly job: DurableJob;
  readonly declaration: JobHandlerDeclaration;
  readonly policies?: readonly PolicyConstraint[];
  readonly traceId: string;
  readonly nowIso: string;
}): AuthorityEvaluationInput {
  const request = jobActionRequest(params.job, params.declaration, params.traceId);
  const envelope = jobAuthorityEnvelope(params.job, params.declaration);
  const constraints = params.policies ?? [];
  return {
    request,
    envelopes: { resolve: () => envelope },
    policies: { constraints: () => constraints },
    // THE SUBSYSTEM OPINION IS THE DECLARED CEILING, and by construction it can
    // only RAISE the platform's floor, never lower it — `classifyConsequence`
    // takes the higher of the two. So a handler cannot make its own work look
    // safer by declaring a low ceiling; it can only make it look more serious.
    // Declaring `low` on work the platform classifies `high` produces a DENY,
    // which is the direction that refuses.
    consequence: { classify: () => params.declaration.consequenceCeiling },
    requiredPermission: params.declaration.requiredPermission,
    nowIso: params.nowIso,
  };
}

/**
 * Decide whether this job execution may proceed.
 *
 * Returns the full decision rather than a boolean, because the worker records
 * it: `authorityAuditDetail` turns it into the shape the existing audit writers
 * already accept, and a boolean would throw away the reason codes that make a
 * denial diagnosable.
 */
export function evaluateJobAuthority(params: {
  readonly job: DurableJob;
  readonly declaration: JobHandlerDeclaration;
  readonly policies?: readonly PolicyConstraint[];
  readonly traceId: string;
  readonly nowIso: string;
}): AuthorityDecision {
  return evaluateAuthority(jobAuthorityInput(params));
}

/**
 * The platform's own view of how consequential this job is.
 *
 * Exported so an operator surface can show it without re-running a decision,
 * and so a test can assert that a handler's declared ceiling is not below what
 * the platform would classify its work as. It reads the same fold the evaluator
 * reads — never a second derivation, which is the mistake
 * `toolAllowListCeiling` documents having made and having had to undo.
 */
export function jobConsequence(
  job: DurableJob,
  declaration: JobHandlerDeclaration,
  traceId: string,
): ReturnType<typeof classifyConsequence> {
  return classifyConsequence(jobActionRequest(job, declaration, traceId), {
    classify: () => declaration.consequenceCeiling,
  });
}
