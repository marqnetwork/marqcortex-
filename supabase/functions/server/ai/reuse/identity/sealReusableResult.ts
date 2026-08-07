/**
 * Sealing a reusable result (AI-01 Batch 3B, Part 6B).
 *
 * ── THE ONLY CONSTRUCTOR ───────────────────────────────────────────────────
 *
 * Nothing else in this tree builds a `ReusableResultRecord`. A second
 * constructor would be a second opinion about what a valid record is, and the
 * one that skipped a check would be the one a caller reached for.
 *
 * What sealing establishes, once, so the gate never has to guess:
 *
 *   - the identity is derived, not supplied, so the id and the key agree
 *   - the output is a bounded envelope, refused if it carries anything a
 *     consumer must not receive
 *   - the digest is computed here from the sealed envelope, so an integrity
 *     check later is a comparison against something this function produced
 *   - freshness is a declared policy with its expiry computed once
 *   - the source's actual spend is recorded as PROVENANCE under a name that
 *     cannot be mistaken for an avoided amount
 *
 * ── A SEALED RECORD IS NEVER PARTIALLY VALID ───────────────────────────────
 *
 * Every refusal throws. There is no path that returns a record with a field it
 * could not establish, because a record that is 90% checked is a record whose
 * remaining 10% is checked by whoever reads it — which is nobody.
 */

import type { CapabilityProfile, QualityProfile } from '../../optimization/contracts/compression.ts';
import { CAPABILITY_RANK, QUALITY_RANK } from '../../optimization/contracts/compression.ts';
import type { ReuseIdentity, ReuseSemanticMetadata } from '../contracts/identity.ts';
import type { ReuseFreshnessDeclaration } from '../contracts/freshness.ts';
import { sealFreshness } from '../contracts/freshness.ts';
import type { ReusableOutputEnvelope } from '../contracts/output.ts';
import { digestReusableOutput, sealReusableOutput } from '../contracts/output.ts';
import type { ReusableResultRecord, ReuseProvenance } from '../contracts/reusableResult.ts';
import { REUSABLE_RESULT_SCHEMA } from '../contracts/reusableResult.ts';
import { reuseFailure } from '../contracts/failures.ts';

export interface SealReusableResultInput {
  readonly identity: ReuseIdentity;
  readonly taskIdentity: string;
  readonly taskKind: string;

  readonly sourceWorkflowId?: string;
  readonly sourceWorkflowVersion?: string;
  readonly sourceWorkflowPlanDigest?: string;
  readonly sourceAgentId?: string;
  readonly sourceAgentVersion?: string;
  readonly sourceAgentCertificationId?: string;
  readonly sourceNodeId?: string;
  readonly sourceBranchId?: string;

  readonly semantic?: ReuseSemanticMetadata;

  readonly qualityProfile: QualityProfile;
  readonly capabilityProfile: CapabilityProfile;
  readonly policyVersion: string;
  readonly optimizationPolicyVersion: string;
  readonly baselinePolicyVersion: string;

  readonly provenance: ReuseProvenance;
  readonly freshness: ReuseFreshnessDeclaration;
  /** Supplied by the caller's clock. This module reads none. */
  readonly createdAt: number;

  readonly output: ReusableOutputEnvelope;

  /**
   * What the source generation ACTUALLY cost. Measured, never estimated.
   *
   * Recorded as provenance. It is money already spent on a call that happened;
   * it is never an avoided amount, and the avoided-call ledger cannot read it.
   */
  readonly originalActualInputTokens: number;
  readonly originalActualOutputTokens: number;
  readonly originalActualCostMicroUsd: number;
}

function nonNegativeInteger(name: string, value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw reuseFailure('reuse_input_invalid', 'A recorded usage figure is invalid.', {
      diagnostics: `${name}=${String(value)}`,
    });
  }
  return Math.floor(value);
}

export function sealReusableResult(input: SealReusableResultInput): ReusableResultRecord {
  if (QUALITY_RANK[input.qualityProfile] === undefined) {
    throw reuseFailure('reuse_input_invalid', 'Unknown quality profile.', {
      diagnostics: `quality=${String(input.qualityProfile)}`,
    });
  }
  if (CAPABILITY_RANK[input.capabilityProfile] === undefined) {
    throw reuseFailure('reuse_input_invalid', 'Unknown capability profile.', {
      diagnostics: `capability=${String(input.capabilityProfile)}`,
    });
  }

  // The record must be produced under a contract at least as strong as the one
  // its own identity claims. A record sealed at `economy` under an identity
  // whose floor is `reasoning` would satisfy its own key by construction and
  // fail the quality dimension for every OTHER caller — which is a
  // permanently-missing cache entry that looks like a working one.
  const output = sealReusableOutput(input.output);
  const outputDigest = digestReusableOutput(output);

  const dependencyCount =
    input.identity.evidenceDependencies.length + input.identity.dataDependencies.length;
  const freshness = sealFreshness(input.freshness, input.createdAt, dependencyCount);

  if (typeof input.provenance.sourceActorId !== 'string' || input.provenance.sourceActorId === '') {
    throw reuseFailure('reuse_input_invalid', 'A reusable result must record its source actor.');
  }

  const record: ReusableResultRecord = {
    schema: REUSABLE_RESULT_SCHEMA,
    reusableResultId: input.identity.reusableResultId,
    organizationId: input.identity.organizationId,

    ...(input.sourceWorkflowId === undefined ? {} : { sourceWorkflowId: input.sourceWorkflowId }),
    ...(input.sourceWorkflowVersion === undefined
      ? {}
      : { sourceWorkflowVersion: input.sourceWorkflowVersion }),
    ...(input.sourceWorkflowPlanDigest === undefined
      ? {}
      : { sourceWorkflowPlanDigest: input.sourceWorkflowPlanDigest }),
    ...(input.sourceAgentId === undefined ? {} : { sourceAgentId: input.sourceAgentId }),
    ...(input.sourceAgentVersion === undefined
      ? {}
      : { sourceAgentVersion: input.sourceAgentVersion }),
    ...(input.sourceAgentCertificationId === undefined
      ? {}
      : { sourceAgentCertificationId: input.sourceAgentCertificationId }),
    ...(input.sourceNodeId === undefined ? {} : { sourceNodeId: input.sourceNodeId }),
    ...(input.sourceBranchId === undefined ? {} : { sourceBranchId: input.sourceBranchId }),

    taskFingerprint: input.identity.taskFingerprint,
    exactInputDigest: input.identity.exactInputDigest,
    exactReuseKey: input.identity.exactReuseKey,
    taskIdentity: input.taskIdentity,
    taskKind: input.taskKind,
    ...(input.semantic === undefined ? {} : { semantic: input.semantic }),

    qualityProfile: input.qualityProfile,
    capabilityProfile: input.capabilityProfile,
    policyVersion: input.policyVersion,
    optimizationPolicyVersion: input.optimizationPolicyVersion,
    baselinePolicyVersion: input.baselinePolicyVersion,

    provenance: input.provenance,
    evidenceDependencies: input.identity.evidenceDependencies,
    dataDependencies: input.identity.dataDependencies,

    createdAt: Math.floor(input.createdAt),
    validatedAt: Math.floor(input.createdAt),
    freshness,
    ...(freshness.expiresAt === undefined ? {} : { expiresAt: freshness.expiresAt }),

    outputDigest,
    output,

    originalActualInputTokens: nonNegativeInteger(
      'originalActualInputTokens',
      input.originalActualInputTokens,
    ),
    originalActualOutputTokens: nonNegativeInteger(
      'originalActualOutputTokens',
      input.originalActualOutputTokens,
    ),
    originalActualCostMicroUsd: nonNegativeInteger(
      'originalActualCostMicroUsd',
      input.originalActualCostMicroUsd,
    ),

    recordVersion: 1,
  };

  return record;
}
