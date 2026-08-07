/**
 * The reuse eligibility gate (AI-01 Batch 3B, Part 6B).
 *
 * ── THE MOST IMPORTANT COMPONENT IN PART 6B ────────────────────────────────
 *
 * Everything else in this tree is plumbing. Discovery finds candidates,
 * storage keeps them, invalidation stamps them, accounting counts them. This
 * decides whether a stored answer may be served to a live request, and it is the
 * only thing standing between a cost optimisation and a data-leak-shaped
 * incident.
 *
 * The design is therefore boring on purpose: nine dimensions, evaluated in a
 * fixed order, each a pure comparison of declared evidence against a stored
 * record. No heuristics, no scoring, no thresholds, no "probably". A dimension
 * either establishes its claim or it does not, and one unestablished claim is a
 * miss.
 *
 * ── ORDER IS NOT ARBITRARY ─────────────────────────────────────────────────
 *
 *   1. TENANCY      Checked first and unconditionally. Everything after it
 *                   reads a record, and reading another tenant's record — even
 *                   to reject it — is the thing that must not happen.
 *
 *   2. INTEGRITY    Before any semantic check, because a malformed or edited
 *                   record cannot be meaningfully asked any other question. A
 *                   gate that checked freshness on a record whose digest did not
 *                   verify would be validating a forgery's paperwork.
 *
 *   3. AUTHORITY    Before quality, policy or freshness, because "may this
 *                   caller have this answer at all" is prior to "is this answer
 *                   any good". A perfectly fresh, perfectly matching record is
 *                   still not reusable by somebody who is not permitted to run
 *                   the operation.
 *
 *   4. POSTURE      The kill switch. An emergency stop is a statement about the
 *                   operation, and serving it from cache is still performing it.
 *
 *   5-9. POLICY, QUALITY, VERSION, FRESHNESS, DEPENDENCIES — the correctness
 *        dimensions, in the order an operator most often needs to hear about.
 *
 * Every dimension is EVALUATED even after one fails, and all nine results are
 * returned. The verdict reports the first failure in dimension order, and the
 * full list goes to the audit record: "this missed on freshness" is one fact,
 * and "this missed on freshness AND would also have missed on policy and
 * quality" is the fact that tells an operator not to extend the TTL.
 *
 * ── NO CLOCK, NO STORE, NO NETWORK ─────────────────────────────────────────
 *
 * `nowMs` is supplied. Nothing here reads a clock, loads a record or asks
 * another component a question, so a verdict is reproducible from the record and
 * the request — which is what an incident review needs and what a gate that
 * called out to three services during evaluation could never provide.
 */

import { canonicalJson, digestText } from '../../agents/runtime/digest.ts';
import { CAPABILITY_RANK, QUALITY_RANK } from '../../optimization/contracts/compression.ts';
import type {
  ReuseEligibilityCheck,
  ReuseEligibilityDimension,
  ReuseEligibilityRequest,
  ReuseEligibilityVerdict,
  ReuseMissReason,
} from '../contracts/eligibility.ts';
import { REUSE_ELIGIBILITY_DIMENSIONS } from '../contracts/eligibility.ts';
import { compareDependency, dependencyToken } from '../contracts/dependency.ts';
import type { ReuseDependency } from '../contracts/dependency.ts';
import { isExpired } from '../contracts/freshness.ts';
import { digestReusableOutput, isWellFormedOutput } from '../contracts/output.ts';
import type { ReusableResultRecord } from '../contracts/reusableResult.ts';
import { isWholeReusableRecord } from '../contracts/reusableResult.ts';

function pass(dimension: ReuseEligibilityDimension, detail: string): ReuseEligibilityCheck {
  return { dimension, satisfied: true, detail };
}

function fail(
  dimension: ReuseEligibilityDimension,
  missReason: ReuseMissReason,
  detail: string,
): ReuseEligibilityCheck {
  return { dimension, satisfied: false, missReason, detail };
}

/**
 * Compatible means DECLARED compatible, never "close enough".
 *
 * Exact match, or explicitly listed by the caller. There is deliberately no
 * ordering rule: a later version is not automatically compatible (a hardened
 * revision typically forbids what its predecessor allowed) and an earlier one is
 * not either. Somebody decides, in a list, and the list is auditable.
 */
function versionCompatible(
  stored: string,
  current: string,
  compatible: readonly string[] | undefined,
): boolean {
  if (stored === current) return true;
  return (compatible ?? []).includes(stored);
}

function checkTenancy(
  record: ReusableResultRecord,
  request: ReuseEligibilityRequest,
): ReuseEligibilityCheck {
  if (record.organizationId !== request.organizationId) {
    return fail(
      'tenancy',
      'tenant_mismatch',
      `record organization does not match the requesting organization`,
    );
  }
  if (record.organizationId !== request.identity.organizationId) {
    return fail('tenancy', 'tenant_mismatch', 'record organization does not match the identity');
  }
  return pass('tenancy', 'organization matches exactly');
}

function checkIntegrity(
  record: ReusableResultRecord,
  _request: ReuseEligibilityRequest,
): ReuseEligibilityCheck {
  if (!isWholeReusableRecord(record)) {
    return fail('integrity', 'record_incomplete', 'stored record is missing required fields');
  }
  if (!isWellFormedOutput(record.output)) {
    return fail('integrity', 'record_malformed', 'stored output envelope is not well formed');
  }
  if (record.invalidatedAt !== undefined) {
    return fail(
      'integrity',
      'invalidated',
      `record invalidated: ${record.invalidationReason ?? 'unspecified'}`,
    );
  }
  // Recomputed rather than trusted. The digest on the record is a claim; this is
  // the check of that claim, and it is the only defence against a row that was
  // edited in storage after it was written.
  let recomputed: string;
  try {
    recomputed = digestReusableOutput(record.output);
  } catch {
    return fail('integrity', 'record_malformed', 'stored output could not be digested');
  }
  if (recomputed !== record.outputDigest) {
    return fail('integrity', 'output_digest_mismatch', 'stored output does not match its digest');
  }
  if (record.exactReuseKey !== `${record.taskFingerprint}:${record.exactInputDigest}`) {
    return fail('integrity', 'record_malformed', 'stored reuse key disagrees with its parts');
  }
  return pass('integrity', 'record whole, digest verified, not invalidated');
}

function checkAuthority(
  record: ReusableResultRecord,
  request: ReuseEligibilityRequest,
): ReuseEligibilityCheck {
  const authority = request.authority;
  if (!authority.callerAuthorized) {
    return fail('authority', 'caller_not_authorized', 'the caller is not authorized');
  }
  if (typeof authority.authorizationEvidenceId !== 'string' || authority.authorizationEvidenceId === '') {
    // Fail closed. A caller claiming authorization without naming the verdict
    // that granted it has supplied an assertion, not evidence.
    return fail('authority', 'evidence_unavailable', 'no authorization evidence identity supplied');
  }
  if (!authority.workflowPermitted) {
    return fail('authority', 'workflow_not_permitted', 'the workflow is no longer permitted');
  }
  if (!authority.agentPermitted) {
    return fail('authority', 'agent_not_permitted', 'the agent is no longer permitted');
  }
  if (!authority.approvalSatisfied) {
    // Reuse must never be the reason an approval was not needed. An answer
    // delivered without the approval its operation requires has bypassed the
    // approval, whether or not a model was called to produce it.
    return fail('authority', 'approval_required', 'an approval requirement is outstanding');
  }
  if (!authority.certificationValid) {
    return fail('authority', 'certification_invalid', 'certification is not currently valid');
  }
  if (
    record.sourceAgentCertificationId !== undefined &&
    request.version.agentCertificationId !== undefined &&
    record.sourceAgentCertificationId !== request.version.agentCertificationId
  ) {
    return fail(
      'authority',
      'certification_invalid',
      'record was produced under a different certification identity',
    );
  }
  return pass('authority', 'caller, workflow, agent, approval and certification all established');
}

function checkPosture(request: ReuseEligibilityRequest): ReuseEligibilityCheck {
  if (!request.posture.aiEnabled) {
    // THE KILL SWITCH. "No provider call occurs" is not permission to ignore an
    // emergency stop; the stop is about the operation, not about the billing.
    return fail('posture', 'ai_disabled', 'the platform AI stop prohibits this operation');
  }
  if (!request.posture.reuseEnabled) {
    return fail('posture', 'reuse_disabled', 'reuse is administratively disabled');
  }
  if (
    typeof request.posture.controlPlanePostureVersion !== 'string' ||
    request.posture.controlPlanePostureVersion === ''
  ) {
    return fail('posture', 'evidence_unavailable', 'no control plane posture version supplied');
  }
  return pass('posture', 'control plane posture permits reuse of this operation');
}

function checkPolicy(
  record: ReusableResultRecord,
  request: ReuseEligibilityRequest,
): ReuseEligibilityCheck {
  const policy = request.policy;
  if (
    !versionCompatible(record.policyVersion, policy.policyVersion, policy.compatiblePolicyVersions)
  ) {
    return fail(
      'policy',
      'policy_version_incompatible',
      `record policy ${record.policyVersion} is not declared compatible with ${policy.policyVersion}`,
    );
  }
  if (
    !versionCompatible(
      record.optimizationPolicyVersion,
      policy.optimizationPolicyVersion,
      policy.compatibleOptimizationPolicyVersions,
    )
  ) {
    return fail(
      'policy',
      'optimization_policy_incompatible',
      `record optimization policy ${record.optimizationPolicyVersion} is not declared compatible`,
    );
  }
  if (
    !versionCompatible(
      record.baselinePolicyVersion,
      policy.baselinePolicyVersion,
      policy.compatibleBaselinePolicyVersions,
    )
  ) {
    return fail(
      'policy',
      'baseline_policy_incompatible',
      `record baseline policy ${record.baselinePolicyVersion} is not declared compatible`,
    );
  }
  return pass('policy', 'policy, optimization policy and baseline policy all compatible');
}

function checkQuality(
  record: ReusableResultRecord,
  request: ReuseEligibilityRequest,
): ReuseEligibilityCheck {
  const storedQuality = QUALITY_RANK[record.qualityProfile];
  const requiredQuality = QUALITY_RANK[request.quality.quality];
  if (storedQuality === undefined || requiredQuality === undefined) {
    return fail('quality', 'evidence_unavailable', 'a quality profile could not be ranked');
  }
  if (storedQuality < requiredQuality) {
    // A result produced under a weaker requirement does not become adequate for
    // a stronger one by being available.
    return fail(
      'quality',
      'quality_below_requirement',
      `record quality ${record.qualityProfile} is below required ${request.quality.quality}`,
    );
  }

  const storedCapability = CAPABILITY_RANK[record.capabilityProfile];
  const requiredCapability = CAPABILITY_RANK[request.quality.minimumCapabilityProfile];
  if (storedCapability === undefined || requiredCapability === undefined) {
    return fail('quality', 'evidence_unavailable', 'a capability profile could not be ranked');
  }
  if (storedCapability < requiredCapability) {
    return fail(
      'quality',
      'capability_below_requirement',
      `record capability ${record.capabilityProfile} is below required ` +
        `${request.quality.minimumCapabilityProfile}`,
    );
  }
  return pass('quality', 'stored quality and capability both clear the current floor');
}

function checkVersion(
  record: ReusableResultRecord,
  request: ReuseEligibilityRequest,
): ReuseEligibilityCheck {
  const version = request.version;

  // The exact key already binds task identity — but a SEMANTIC candidate is
  // loaded by id and has therefore been matched on nothing. Checking it here is
  // what keeps semantic reuse to "the same declared work, expressed differently"
  // rather than "any stored answer that scored well".
  if (record.taskIdentity !== version.taskIdentity || record.taskKind !== version.taskKind) {
    return fail(
      'version',
      'task_identity_mismatch',
      `record is for ${record.taskIdentity}/${record.taskKind}, request is for ` +
        `${version.taskIdentity}/${version.taskKind}`,
    );
  }

  if (version.workflowId !== undefined && record.sourceWorkflowId !== undefined) {
    if (record.sourceWorkflowId !== version.workflowId) {
      return fail(
        'version',
        'workflow_version_incompatible',
        'record was produced by a different workflow',
      );
    }
    const storedWorkflowVersion = record.sourceWorkflowVersion;
    const currentWorkflowVersion = version.workflowVersion;
    if (storedWorkflowVersion === undefined || currentWorkflowVersion === undefined) {
      return fail('version', 'evidence_unavailable', 'a workflow version was not supplied');
    }
    if (
      !versionCompatible(
        storedWorkflowVersion,
        currentWorkflowVersion,
        version.compatibleWorkflowVersions,
      )
    ) {
      return fail(
        'version',
        'workflow_version_incompatible',
        `record workflow version ${storedWorkflowVersion} is not declared compatible with ` +
          `${currentWorkflowVersion}`,
      );
    }
  }

  if (version.planDigestRequired) {
    const storedPlanDigest = record.sourceWorkflowPlanDigest;
    const currentPlanDigest = version.workflowPlanDigest;
    if (storedPlanDigest === undefined || currentPlanDigest === undefined) {
      return fail('version', 'evidence_unavailable', 'a plan digest was required and not supplied');
    }
    if (storedPlanDigest !== currentPlanDigest) {
      return fail('version', 'plan_digest_incompatible', 'the workflow plan digest has changed');
    }
  }

  if (version.agentId !== undefined && record.sourceAgentId !== undefined) {
    if (record.sourceAgentId !== version.agentId) {
      return fail(
        'version',
        'agent_version_incompatible',
        'record was produced by a different agent',
      );
    }
    const storedAgentVersion = record.sourceAgentVersion;
    const currentAgentVersion = version.agentVersion;
    if (storedAgentVersion === undefined || currentAgentVersion === undefined) {
      return fail('version', 'evidence_unavailable', 'an agent version was not supplied');
    }
    if (
      !versionCompatible(storedAgentVersion, currentAgentVersion, version.compatibleAgentVersions)
    ) {
      return fail(
        'version',
        'agent_version_incompatible',
        `record agent version ${storedAgentVersion} is not declared compatible with ` +
          `${currentAgentVersion}`,
      );
    }
  }

  return pass('version', 'workflow, plan and agent versions all compatible');
}

function checkFreshness(
  record: ReusableResultRecord,
  request: ReuseEligibilityRequest,
): ReuseEligibilityCheck {
  const nowMs = request.freshness.nowMs;
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs) || nowMs <= 0) {
    return fail('freshness', 'evidence_unavailable', 'no usable current time supplied');
  }

  // Read from the record, never written back. There is no code path in this tree
  // that recomputes an expiry, which is what makes "a read never extends an
  // expiry" a property of the design rather than a discipline.
  if (isExpired(record.freshness, nowMs)) {
    return fail(
      'freshness',
      'expired',
      `record expired at ${String(record.freshness.expiresAt)} and now is ${nowMs}`,
    );
  }

  if (request.freshness.requireImmutable === true && record.freshness.policy !== 'immutable') {
    return fail(
      'freshness',
      'freshness_policy_unsatisfied',
      `caller requires an immutable result and this record is ${record.freshness.policy}`,
    );
  }

  const maximumAgeMs = request.freshness.maximumAgeMs;
  if (maximumAgeMs !== undefined) {
    if (!Number.isFinite(maximumAgeMs) || maximumAgeMs < 0) {
      return fail('freshness', 'evidence_unavailable', 'the declared maximum age is not usable');
    }
    const age = nowMs - record.validatedAt;
    if (age > maximumAgeMs) {
      return fail(
        'freshness',
        'freshness_policy_unsatisfied',
        `record age ${age}ms exceeds the caller maximum ${maximumAgeMs}ms`,
      );
    }
  }

  if (record.freshness.policy === 'dependency_bound') {
    const declared = record.evidenceDependencies.length + record.dataDependencies.length;
    if (declared === 0) {
      // Unreachable through `sealReusableResult`, which refuses it. Re-asserted
      // because a record can also arrive from storage, where it was written by
      // an older release or edited.
      return fail(
        'freshness',
        'freshness_policy_unsatisfied',
        'a dependency-bound record declares no dependencies',
      );
    }
  }

  return pass('freshness', `declared policy ${record.freshness.policy} is satisfied`);
}

function checkDependencies(
  record: ReusableResultRecord,
  request: ReuseEligibilityRequest,
): ReuseEligibilityCheck {
  const current = request.currentDependencies;
  const evaluate = (
    declared: readonly ReuseDependency[],
    label: string,
  ): ReuseEligibilityCheck | undefined => {
    for (const dependency of declared) {
      const comparison = compareDependency(dependency, current);
      if (comparison === 'changed') {
        return fail(
          'dependencies',
          'dependency_changed',
          `${label} dependency ${dependencyToken(dependency)} has changed`,
        );
      }
      if (comparison === 'unknown') {
        // Fail closed. The caller has not established that this is unchanged; it
        // has merely not mentioned it, and those are the same thing only to a
        // gate that wants a higher hit rate than it can justify.
        return fail(
          'dependencies',
          'dependency_missing',
          `${label} dependency ${dependencyToken(dependency)} has no current version`,
        );
      }
    }
    return undefined;
  };

  const evidenceProblem = evaluate(record.evidenceDependencies, 'evidence');
  if (evidenceProblem !== undefined) return evidenceProblem;
  const dataProblem = evaluate(record.dataDependencies, 'data');
  if (dataProblem !== undefined) return dataProblem;

  return pass(
    'dependencies',
    `${record.evidenceDependencies.length} evidence and ${record.dataDependencies.length} data ` +
      'dependencies unchanged',
  );
}

/**
 * The digest of the decisive inputs to a verdict.
 *
 * Recorded on the avoided-call entry so "on what basis was this reused" has an
 * answer that can be RECOMPUTED. A timestamp and a reason string would say when
 * and roughly why; this says exactly what the gate was looking at.
 */
function evidenceDigestFor(
  record: ReusableResultRecord,
  request: ReuseEligibilityRequest,
): string {
  const canonical = canonicalJson({
    v: 1,
    reusableResultId: record.reusableResultId,
    outputDigest: record.outputDigest,
    recordVersion: record.recordVersion,
    organizationId: request.organizationId,
    exactReuseKey: request.identity.exactReuseKey,
    authorizationEvidenceId: request.authority.authorizationEvidenceId,
    controlPlanePostureVersion: request.posture.controlPlanePostureVersion,
    policyVersion: request.policy.policyVersion,
    optimizationPolicyVersion: request.policy.optimizationPolicyVersion,
    baselinePolicyVersion: request.policy.baselinePolicyVersion,
    quality: request.quality.quality,
    minimumCapabilityProfile: request.quality.minimumCapabilityProfile,
    dependencies: [...request.currentDependencies].map(dependencyToken).sort(),
  });
  return digestText(canonical ?? 'null');
}

/**
 * Decide whether one record may be reused for one request.
 *
 * Pure and total: it never throws, never reads a clock, never touches a store.
 * A verdict is a value, reproducible from its two arguments.
 */
export function evaluateReuseEligibility(
  record: ReusableResultRecord,
  request: ReuseEligibilityRequest,
): ReuseEligibilityVerdict {
  const checks: ReuseEligibilityCheck[] = [
    checkTenancy(record, request),
    checkIntegrity(record, request),
    checkAuthority(record, request),
    checkPosture(request),
    checkPolicy(record, request),
    checkQuality(record, request),
    checkVersion(record, request),
    checkFreshness(record, request),
    checkDependencies(record, request),
  ];

  // Every dimension is present, in the declared order. A verdict missing a
  // dimension would be a verdict nobody checked, so the shape is asserted rather
  // than assumed.
  const covered = new Set(checks.map((check) => check.dimension));
  const missing = REUSE_ELIGIBILITY_DIMENSIONS.filter((dimension) => !covered.has(dimension));
  for (const dimension of missing) {
    checks.push(fail(dimension, 'evidence_unavailable', 'this dimension was not evaluated'));
  }

  const firstFailure = checks.find((check) => !check.satisfied);
  const eligible = firstFailure === undefined;

  return {
    reusableResultId: record.reusableResultId,
    organizationId: request.organizationId,
    eligible,
    ...(firstFailure?.missReason === undefined ? {} : { missReason: firstFailure.missReason }),
    checks,
    evidenceDigest: evidenceDigestFor(record, request),
  };
}
