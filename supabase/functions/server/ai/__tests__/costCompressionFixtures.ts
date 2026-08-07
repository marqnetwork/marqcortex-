/**
 * Cost compression fixtures (AI-01 Batch 3B, Part 6A).
 *
 * Every fixture is a plain value. The compression engine has no clock, no store,
 * no id factory and no randomness anywhere in it, so a fixture needs no harness
 * to be deterministic — which is itself the property the reproducibility tests
 * assert on.
 *
 * The builders take partial overrides and fill the rest from one baseline shape,
 * so a test that varies ONE field varies exactly one field. A suite where each
 * case constructs its own descriptor tends to vary three by accident and then
 * assert on the wrong one.
 */

import type {
  AiTaskDescriptor,
  ControlPlaneEnvelope,
} from '../optimization/contracts/task.ts';
import type { ContextItem } from '../optimization/contracts/context.ts';
import type { UsageObservation } from '../optimization/contracts/usage.ts';

export const ORG = 'org_acme';
export const OTHER_ORG = 'org_globex';

/**
 * A standard-quality generation task with no non-inference path.
 *
 * Deliberately the dullest task that still requires a model: every avoidance
 * test turns exactly one of these fields on, so a passing assertion is about
 * that field and nothing else.
 */
export function task(overrides: Partial<AiTaskDescriptor> = {}): AiTaskDescriptor {
  return {
    taskId: 'task_fixture',
    organizationId: ORG,
    kind: 'generation',
    quality: 'standard',
    requiresStructuredOutput: false,
    requiresMultiStepReasoning: false,
    requiresSuppliedEvidence: false,
    toleratesApproximation: false,
    outputFieldCount: 1,
    expectedOutputTokens: 400,
    mandatory: false,
    safetyCritical: false,
    approvalBound: false,
    deterministicCapabilities: [],
    priorOutputs: [],
    ...overrides,
  };
}

/**
 * An envelope permitting every band up to `reasoning`.
 *
 * `advanced_reasoning` is deliberately ABSENT from the allow list even though it
 * exists, so "the recommender cannot reach a band the caller was not given" is
 * testable against a band that is real rather than imaginary.
 */
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

export function item(overrides: Partial<ContextItem> & Pick<ContextItem, 'itemId'>): ContextItem {
  return {
    source: 'retrieved_evidence',
    necessity: 'optional',
    digest: `digest_${overrides.itemId}`,
    estimatedTokens: 100,
    relevance: 50,
    freshness: 50,
    sensitivity: 'internal',
    provenance: 'fixture',
    dependsOn: [],
    ...overrides,
  };
}

/**
 * The canonical candidate set: three required items and four optional ones,
 * two of which are byte-identical.
 *
 * One duplicate pair among the optional items and one among the required, so
 * "deduplicated within necessity, never across it" is provable in one fixture.
 */
export const CANDIDATE_CONTEXT: readonly ContextItem[] = [
  item({ itemId: 'sys', source: 'system_authority', necessity: 'required', estimatedTokens: 300 }),
  item({ itemId: 'safety', source: 'safety_policy', necessity: 'required', estimatedTokens: 200 }),
  item({ itemId: 'objective', source: 'workflow_objective', necessity: 'required', estimatedTokens: 150 }),
  item({ itemId: 'evidence_a', estimatedTokens: 400, relevance: 90, freshness: 90, digest: 'd_a' }),
  item({ itemId: 'evidence_b', estimatedTokens: 400, relevance: 80, freshness: 80, digest: 'd_b' }),
  // Byte-identical to evidence_b. One of the two is waste.
  item({ itemId: 'evidence_b_copy', estimatedTokens: 400, relevance: 70, freshness: 70, digest: 'd_b' }),
  item({
    itemId: 'history',
    source: 'conversation_history',
    estimatedTokens: 900,
    relevance: 10,
    freshness: 5,
    digest: 'd_h',
  }),
];

/** Required items only, sized so they can be pushed over a ceiling in a test. */
export function oversizedRequiredContext(tokensEach: number): readonly ContextItem[] {
  return [
    item({
      itemId: 'sys',
      source: 'system_authority',
      necessity: 'required',
      estimatedTokens: tokensEach,
      digest: 'd_sys',
    }),
    item({
      itemId: 'safety',
      source: 'safety_policy',
      necessity: 'required',
      estimatedTokens: tokensEach,
      digest: 'd_safety',
    }),
  ];
}

export function observation(
  overrides: Partial<UsageObservation> & Pick<UsageObservation, 'agentRunId'>,
): UsageObservation {
  return {
    organizationId: ORG,
    nodeId: 'node_a',
    attempt: 1,
    cumulative: {
      actualInputTokens: 1_000,
      actualOutputTokens: 500,
      actualTotalTokens: 1_500,
      actualCostMicroUsd: 2_000,
    },
    ...overrides,
  };
}
