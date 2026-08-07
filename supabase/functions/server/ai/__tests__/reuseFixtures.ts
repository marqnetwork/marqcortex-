/**
 * Intelligent reuse fixtures (AI-01 Batch 3B, Part 6B).
 *
 * The reuse engine has no clock and no randomness — every time is passed in as a
 * number — so a fixture needs no harness to be deterministic. What it does need
 * is a baseline shape that is ELIGIBLE, so that a test varying one dimension is
 * a test about that dimension: `request()` returns a request that passes all
 * nine checks against `record()`, and every adversarial case turns exactly one
 * field off.
 *
 * The builders are nested to match the request, so `request({ quality: {...} })`
 * replaces the quality block whole rather than requiring a test to restate the
 * other eight.
 */

import type {
  ReuseAuthorityEvidence,
  ReuseEligibilityRequest,
  ReuseFreshnessRequirement,
  ReusePolicyRequirement,
  ReusePostureEvidence,
  ReuseQualityRequirement,
  ReuseVersionRequirement,
} from '../reuse/contracts/eligibility.ts';
import type { ReuseDependency } from '../reuse/contracts/dependency.ts';
import type { ReuseIdentityInput } from '../reuse/contracts/identity.ts';
import type { ReusableOutputEnvelope } from '../reuse/contracts/output.ts';
import type { ReusableResultRecord } from '../reuse/contracts/reusableResult.ts';
import type { SealReusableResultInput } from '../reuse/identity/sealReusableResult.ts';
import { buildReuseIdentity, sealSemanticMetadata } from '../reuse/identity/reuseIdentity.ts';
import { sealReusableResult } from '../reuse/identity/sealReusableResult.ts';
import type { AiTaskDescriptor, ControlPlaneEnvelope } from '../optimization/contracts/task.ts';

export const ORG = 'org_acme';
export const OTHER_ORG = 'org_globex';

/** A fixed clock, in milliseconds. Every fixture time is relative to it. */
export const NOW = 1_800_000_000_000;
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export const POLICY_VERSION = 'ai.policy.v7';
export const OPTIMIZATION_POLICY_VERSION = 'ai.optimization.v2';
export const BASELINE_POLICY_VERSION = 'ai.baseline.v1';

export const WORKFLOW_ID = 'wf_quote_review';
export const WORKFLOW_VERSION = '4';
export const PLAN_DIGEST = 'plan_d41d8cd98f00b204';
export const AGENT_ID = 'agent_reviewer';
export const AGENT_VERSION = '11';
export const CERTIFICATION_ID = 'cert_2026_q2';
export const TASK_IDENTITY = 'wf_quote_review/node_summarize';
export const TASK_KIND = 'summarization';

export const EVIDENCE_DEPENDENCY: ReuseDependency = {
  kind: 'external_evidence',
  key: 'quote_pack_881',
  version: 'sha256:aa11',
};

export const DATA_DEPENDENCY: ReuseDependency = {
  kind: 'organization_data',
  key: 'pricing_table',
  version: '2026-08-01',
};

export const CURRENT_DEPENDENCIES: readonly ReuseDependency[] = [
  EVIDENCE_DEPENDENCY,
  DATA_DEPENDENCY,
  // A dependency the record does not declare. Present so "the current set may be
  // wider than the declared set" is exercised rather than assumed.
  { kind: 'policy', key: 'safety_policy', version: '9' },
];

export function identityInput(
  overrides: Partial<ReuseIdentityInput> = {},
): ReuseIdentityInput {
  return {
    organizationId: ORG,
    taskIdentity: TASK_IDENTITY,
    taskKind: TASK_KIND,
    workflowId: WORKFLOW_ID,
    workflowVersion: WORKFLOW_VERSION,
    workflowPlanDigest: PLAN_DIGEST,
    agentId: AGENT_ID,
    agentVersion: AGENT_VERSION,
    agentCertificationId: CERTIFICATION_ID,
    policyVersion: POLICY_VERSION,
    optimizationPolicyVersion: OPTIMIZATION_POLICY_VERSION,
    baselinePolicyVersion: BASELINE_POLICY_VERSION,
    quality: 'standard',
    minimumCapabilityProfile: 'standard',
    inputDigest: 'sha256:input_alpha',
    evidenceDependencies: [EVIDENCE_DEPENDENCY],
    dataDependencies: [DATA_DEPENDENCY],
    ...overrides,
  };
}

export function outputEnvelope(
  overrides: Partial<ReusableOutputEnvelope> = {},
): ReusableOutputEnvelope {
  return {
    schema: 'quote.summary',
    schemaVersion: '2',
    fields: { summary: 'three line items priced at list', lineItemCount: 3, complete: true },
    redactions: [],
    ...overrides,
  };
}

/**
 * A sealed, eligible record.
 *
 * Bounded TTL by default rather than immutable, because a TTL record is the one
 * that can be expired by moving a clock — which is how the freshness suite tests
 * expiry without a second fixture.
 */
export function record(
  overrides: Partial<SealReusableResultInput> = {},
): ReusableResultRecord {
  const identity = overrides.identity ?? buildReuseIdentity(identityInput());
  return sealReusableResult({
    identity,
    taskIdentity: TASK_IDENTITY,
    taskKind: TASK_KIND,
    sourceWorkflowId: WORKFLOW_ID,
    sourceWorkflowVersion: WORKFLOW_VERSION,
    sourceWorkflowPlanDigest: PLAN_DIGEST,
    sourceAgentId: AGENT_ID,
    sourceAgentVersion: AGENT_VERSION,
    sourceAgentCertificationId: CERTIFICATION_ID,
    sourceNodeId: 'node_summarize',
    sourceBranchId: 'branch_a',
    semantic: sealSemanticMetadata('quote_summary', ['quote', 'pricing', 'summary']),
    qualityProfile: 'standard',
    capabilityProfile: 'standard',
    policyVersion: POLICY_VERSION,
    optimizationPolicyVersion: OPTIMIZATION_POLICY_VERSION,
    baselinePolicyVersion: BASELINE_POLICY_VERSION,
    provenance: {
      sourceWorkflowRunId: 'wfr_001',
      sourceAgentRunId: 'ar_001',
      sourceNodeId: 'node_summarize',
      sourceBranchId: 'branch_a',
      sourceDecision: 'compress',
      sourceActorId: 'user_producer',
    },
    freshness: { policy: 'ttl', ttlMs: 24 * HOUR },
    createdAt: NOW - HOUR,
    output: outputEnvelope(),
    // What the SOURCE generation actually cost. Provenance, never a saving —
    // deliberately a large, memorable number so a test can prove the totals do
    // not move when it changes.
    originalActualInputTokens: 4_000,
    originalActualOutputTokens: 900,
    originalActualCostMicroUsd: 77_777,
    ...overrides,
  });
}

export function authority(
  overrides: Partial<ReuseAuthorityEvidence> = {},
): ReuseAuthorityEvidence {
  return {
    callerAuthorized: true,
    authorizationEvidenceId: 'rbac_verdict_9001',
    workflowPermitted: true,
    agentPermitted: true,
    approvalSatisfied: true,
    certificationValid: true,
    ...overrides,
  };
}

export function posture(overrides: Partial<ReusePostureEvidence> = {}): ReusePostureEvidence {
  return {
    aiEnabled: true,
    reuseEnabled: true,
    controlPlanePostureVersion: 'posture_2026_08_07',
    ...overrides,
  };
}

export function policy(overrides: Partial<ReusePolicyRequirement> = {}): ReusePolicyRequirement {
  return {
    policyVersion: POLICY_VERSION,
    compatiblePolicyVersions: [],
    optimizationPolicyVersion: OPTIMIZATION_POLICY_VERSION,
    compatibleOptimizationPolicyVersions: [],
    baselinePolicyVersion: BASELINE_POLICY_VERSION,
    compatibleBaselinePolicyVersions: [],
    ...overrides,
  };
}

export function version(overrides: Partial<ReuseVersionRequirement> = {}): ReuseVersionRequirement {
  return {
    taskIdentity: TASK_IDENTITY,
    taskKind: TASK_KIND,
    workflowId: WORKFLOW_ID,
    workflowVersion: WORKFLOW_VERSION,
    compatibleWorkflowVersions: [],
    workflowPlanDigest: PLAN_DIGEST,
    planDigestRequired: true,
    agentId: AGENT_ID,
    agentVersion: AGENT_VERSION,
    compatibleAgentVersions: [],
    agentCertificationId: CERTIFICATION_ID,
    ...overrides,
  };
}

export function quality(overrides: Partial<ReuseQualityRequirement> = {}): ReuseQualityRequirement {
  return { quality: 'standard', minimumCapabilityProfile: 'standard', ...overrides };
}

export function freshness(
  overrides: Partial<ReuseFreshnessRequirement> = {},
): ReuseFreshnessRequirement {
  return { nowMs: NOW, ...overrides };
}

/** An eligible request against `record()`. Every adversarial case varies one field. */
export function request(
  overrides: Partial<ReuseEligibilityRequest> = {},
): ReuseEligibilityRequest {
  return {
    organizationId: ORG,
    taskId: 'task_live_001',
    identity: buildReuseIdentity(identityInput()),
    authority: authority(),
    posture: posture(),
    policy: policy(),
    version: version(),
    quality: quality(),
    freshness: freshness(),
    currentDependencies: CURRENT_DEPENDENCIES,
    ...overrides,
  };
}

// ── Part 6A bridging, for the accounting suite ──────────────────────────────

export function task(overrides: Partial<AiTaskDescriptor> = {}): AiTaskDescriptor {
  return {
    taskId: 'task_live_001',
    organizationId: ORG,
    kind: 'summarization',
    quality: 'standard',
    requiresStructuredOutput: false,
    requiresMultiStepReasoning: false,
    requiresSuppliedEvidence: true,
    toleratesApproximation: false,
    outputFieldCount: 3,
    expectedOutputTokens: 400,
    mandatory: false,
    safetyCritical: false,
    approvalBound: false,
    deterministicCapabilities: [],
    priorOutputs: [],
    ...overrides,
  };
}

export function envelope(overrides: Partial<ControlPlaneEnvelope> = {}): ControlPlaneEnvelope {
  return {
    maxPromptTokens: 8_000,
    maxCompletionTokens: 2_000,
    maxTotalTokens: 10_000,
    remainingCostMicroUsd: 1_000_000,
    allowedCapabilityProfiles: ['economy', 'standard', 'reasoning'],
    maximumCapabilityProfile: 'reasoning',
    aiEnabled: true,
    ...overrides,
  };
}
