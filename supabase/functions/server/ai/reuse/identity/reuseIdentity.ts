/**
 * Deterministic reuse identity (AI-01 Batch 3B, Part 6B).
 *
 * Pure. No clock, no store, no randomness — the same input produces the same
 * key on every isolate and in every test, which is what makes exact reuse
 * something a caller can reason about rather than something it observes.
 *
 * Both fingerprints are computed over a CANONICAL form with sorted keys, using
 * the platform's one canonical serializer. A second serializer here would give
 * the platform two definitions of "the same value", and the first time they
 * disagreed the cache would silently partition.
 */

import { canonicalJson, digestText } from '../../agents/runtime/digest.ts';
import { CAPABILITY_RANK, QUALITY_RANK } from '../../optimization/contracts/compression.ts';
import type { ReuseDependency } from '../contracts/dependency.ts';
import {
  assertDependencySplit,
  dependencyToken,
  normalizeDependencies,
} from '../contracts/dependency.ts';
import type {
  ReuseIdentity,
  ReuseIdentityInput,
  ReuseSemanticMetadata,
} from '../contracts/identity.ts';
import { reuseFailure } from '../contracts/failures.ts';

const IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const DIGEST_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/;

function requireField(name: string, value: string, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw reuseFailure('reuse_input_invalid', 'A reuse identity field is missing or malformed.', {
      diagnostics: `${name}=${String(value)}`,
    });
  }
  return value;
}

function canonicalOrRefuse(value: unknown, what: string): string {
  const canonical = canonicalJson(value);
  if (canonical === undefined) {
    throw reuseFailure('reuse_input_invalid', 'A reuse identity could not be canonicalised.', {
      diagnostics: what,
    });
  }
  return canonical;
}

/**
 * Build the identity for one potential AI call.
 *
 * The two fingerprints are layered rather than flat, and the layering is load
 * bearing. `taskFingerprint` answers "what work is this" and is the coarse key
 * semantic discovery is scoped by; `exactInputDigest` answers "under exactly
 * which conditions" and is what makes two runs of the same node under two
 * different policy versions miss each other.
 *
 * Flattening them would still produce a correct exact key — and would leave
 * semantic discovery with nothing to scope on except the tenant, which is how a
 * candidate search starts returning unrelated work that merely scored well.
 */
export function buildReuseIdentity(input: ReuseIdentityInput): ReuseIdentity {
  const organizationId = requireField('organizationId', input.organizationId, IDENTITY_PATTERN);
  const taskIdentity = requireField('taskIdentity', input.taskIdentity, IDENTITY_PATTERN);
  const taskKind = requireField('taskKind', input.taskKind, IDENTITY_PATTERN);
  const inputDigest = requireField('inputDigest', input.inputDigest, DIGEST_PATTERN);
  const policyVersion = requireField('policyVersion', input.policyVersion, DIGEST_PATTERN);
  const optimizationPolicyVersion = requireField(
    'optimizationPolicyVersion',
    input.optimizationPolicyVersion,
    DIGEST_PATTERN,
  );
  const baselinePolicyVersion = requireField(
    'baselinePolicyVersion',
    input.baselinePolicyVersion,
    DIGEST_PATTERN,
  );

  if (QUALITY_RANK[input.quality] === undefined) {
    throw reuseFailure('reuse_input_invalid', 'Unknown quality profile.', {
      diagnostics: `quality=${String(input.quality)}`,
    });
  }
  if (CAPABILITY_RANK[input.minimumCapabilityProfile] === undefined) {
    throw reuseFailure('reuse_input_invalid', 'Unknown capability profile.', {
      diagnostics: `capability=${String(input.minimumCapabilityProfile)}`,
    });
  }

  const evidenceDependencies = normalizeDependencies(input.evidenceDependencies);
  const dataDependencies = normalizeDependencies(input.dataDependencies);
  assertDependencySplit(evidenceDependencies, dataDependencies);

  // ── What work is this, by which definition, for whom ──────────────────────
  const taskFingerprint = digestText(
    canonicalOrRefuse(
      {
        v: 1,
        organizationId,
        taskIdentity,
        taskKind,
        workflowId: input.workflowId ?? null,
        workflowVersion: input.workflowVersion ?? null,
        workflowPlanDigest: input.workflowPlanDigest ?? null,
        agentId: input.agentId ?? null,
        agentVersion: input.agentVersion ?? null,
        agentCertificationId: input.agentCertificationId ?? null,
      },
      'task fingerprint',
    ),
  );

  // ── Under exactly which conditions ────────────────────────────────────────
  const exactInputDigest = digestText(
    canonicalOrRefuse(
      {
        v: 1,
        taskFingerprint,
        policyVersion,
        optimizationPolicyVersion,
        baselinePolicyVersion,
        quality: input.quality,
        minimumCapabilityProfile: input.minimumCapabilityProfile,
        inputDigest,
        evidence: evidenceDependencies.map(dependencyToken),
        data: dataDependencies.map(dependencyToken),
      },
      'exact input digest',
    ),
  );

  const exactReuseKey = `${taskFingerprint}:${exactInputDigest}`;

  return {
    organizationId,
    taskFingerprint,
    exactInputDigest,
    exactReuseKey,
    reusableResultId: reusableResultIdFor(exactReuseKey),
    evidenceDependencies,
    dataDependencies,
  };
}

/**
 * The record id, derived from the key.
 *
 * ONE IDENTITY IS ONE RECORD. That is what turns cache stampede from a
 * distributed coordination problem into a single insert-if-absent: two isolates
 * computing the same identity compute the same id, race on one storage key, and
 * one of them observably loses. A minted id would give one identity two records
 * and the platform two answers to "which of these is authoritative".
 */
export function reusableResultIdFor(exactReuseKey: string): string {
  return `rr_${digestText(exactReuseKey).slice(0, 32)}`;
}

const MAX_SEMANTIC_FEATURES = 32;
const FEATURE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SEMANTIC_CLASS_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/;

/**
 * Seal declared semantic metadata.
 *
 * NOT AN EMBEDDING and not derived from text. `features` are labels a workflow
 * or agent definition declares — a human authored them and a validator accepted
 * them, exactly as Part 6A requires of everything its classifier reads. The
 * platform has no embedding provider, and Part 6B does not add one: introducing
 * a model call to decide whether a model call can be avoided would be a second
 * AI execution path with none of the governance the first one has.
 */
export function sealSemanticMetadata(
  semanticClass: string,
  features: readonly string[],
): ReuseSemanticMetadata {
  if (!SEMANTIC_CLASS_PATTERN.test(semanticClass)) {
    throw reuseFailure('reuse_input_invalid', 'A semantic class is malformed.', {
      diagnostics: `semanticClass=${String(semanticClass)}`,
    });
  }
  if (features.length > MAX_SEMANTIC_FEATURES) {
    throw reuseFailure('reuse_input_invalid', 'Too many declared semantic features.', {
      diagnostics: `${features.length} exceeds ${MAX_SEMANTIC_FEATURES}`,
    });
  }
  for (const feature of features) {
    if (!FEATURE_PATTERN.test(feature)) {
      throw reuseFailure('reuse_input_invalid', 'A declared semantic feature is malformed.', {
        diagnostics: `feature=${String(feature)}`,
      });
    }
  }

  const sorted = [...new Set(features)].sort();
  return {
    semanticClass,
    features: sorted,
    semanticFingerprint: digestText(
      canonicalOrRefuse({ v: 1, semanticClass, features: sorted }, 'semantic fingerprint'),
    ),
  };
}

/** Every dependency on a record, as one set. Used by invalidation matching. */
export function allDependencies(
  evidenceDependencies: readonly ReuseDependency[],
  dataDependencies: readonly ReuseDependency[],
): readonly ReuseDependency[] {
  return [...evidenceDependencies, ...dataDependencies];
}
