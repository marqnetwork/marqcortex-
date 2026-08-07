/**
 * The reusable result contract (AI-01 Batch 3B, Part 6B).
 *
 * ── AN IMMUTABLE RECORD THAT CARRIES ITS OWN ARGUMENT FOR BEING REUSED ────
 *
 * A cache entry that stores only an answer forces every later reader to guess
 * whether the answer still applies, and a guess that goes the wrong way is a
 * wrong answer served instantly and confidently. So this record stores the
 * ANSWER and the ARGUMENT: which tenant, which workflow and version, which plan,
 * which agent and certification, under which policy versions, at which quality
 * and capability, against which dependencies, produced when, valid until when,
 * and with which digest.
 *
 * The eligibility gate is then a function of the record and the current request,
 * with nothing left to infer. Every field below exists because some check needs
 * it; a field nothing checks would be a field that could drift without anyone
 * noticing.
 *
 * ── WHAT IS DELIBERATELY ABSENT ────────────────────────────────────────────
 *
 * No provider credentials. No secrets. No raw internal prompt. No hidden
 * reasoning. No provider response. No execution state. The output is a sealed,
 * bounded envelope (`contracts/output.ts`) and there is no other field through
 * which a value could travel — which is a claim about the type, and therefore a
 * claim the boundary scan can settle rather than a promise in a comment.
 *
 * ── INVALIDATION IS A STAMP, NOT A DELETE ──────────────────────────────────
 *
 * `invalidatedAt` and `invalidationReason` are set in place and the record stays.
 * Deleting it would destroy the evidence behind any avoided-call accounting that
 * already cited it, which is exactly the evidence a reviewer asks for when the
 * question is whether a saving was real. An invalidated record is unusable and
 * still auditable, and those are not in tension.
 *
 * ── THE ORIGINAL COST IS RECORDED, AND IT IS NOT A SAVING ─────────────────
 *
 * `originalActualCostMicroUsd` is what the source generation ACTUALLY cost. It
 * is provenance, not currency: money already spent, once, on a call that did
 * happen. Counting it again as avoided cost on every later hit is the single
 * most attractive way to manufacture savings out of a cache, so it is stored
 * under a name that cannot be mistaken for an avoided amount and the avoided-call
 * ledger refuses to read it. See `accounting/avoidedCallLedger.ts`.
 */

import type { CapabilityProfile, QualityProfile } from '../../optimization/contracts/compression.ts';
import type { ReuseDependency } from './dependency.ts';
import type { SealedFreshness } from './freshness.ts';
import type { ReuseSemanticMetadata } from './identity.ts';
import type { ReusableOutputEnvelope } from './output.ts';

export const REUSABLE_RESULT_SCHEMA = 'ai.reuse.result.v1';

/**
 * Why a record stopped being reusable. Closed vocabulary, because "invalidated
 * for another reason" is an audit answer nobody can act on.
 */
export const REUSE_INVALIDATION_REASONS = [
  'explicit_result_invalidation',
  'workflow_definition_changed',
  'workflow_plan_changed',
  'agent_definition_changed',
  'policy_changed',
  'organization_invalidated',
  'dependency_changed',
  'integrity_violation',
] as const;

export type ReuseInvalidationReason = (typeof REUSE_INVALIDATION_REASONS)[number];

/** Where the result came from. Identity only — never run content. */
export interface ReuseProvenance {
  /** The workflow run that produced it, when a workflow did. */
  readonly sourceWorkflowRunId?: string;
  /** The agent run that produced it, when an agent did. */
  readonly sourceAgentRunId?: string;
  /** The node it was produced at. */
  readonly sourceNodeId?: string;
  /** The parallel branch it was produced on, when it was produced on one. */
  readonly sourceBranchId?: string;
  /** The compression decision under which the source call ran. */
  readonly sourceDecision: string;
  /** The actor identity the source call was authorised under. */
  readonly sourceActorId: string;
}

/**
 * One reusable result. Written once; the only later mutation is invalidation.
 */
export interface ReusableResultRecord {
  readonly schema: typeof REUSABLE_RESULT_SCHEMA;
  readonly reusableResultId: string;
  readonly organizationId: string;

  // ── Source identity ───────────────────────────────────────────────────────
  readonly sourceWorkflowId?: string;
  readonly sourceWorkflowVersion?: string;
  readonly sourceWorkflowPlanDigest?: string;
  readonly sourceAgentId?: string;
  readonly sourceAgentVersion?: string;
  readonly sourceAgentCertificationId?: string;
  readonly sourceNodeId?: string;
  readonly sourceBranchId?: string;

  // ── Reuse identity ────────────────────────────────────────────────────────
  readonly taskFingerprint: string;
  readonly exactInputDigest: string;
  readonly exactReuseKey: string;
  readonly taskIdentity: string;
  readonly taskKind: string;
  /** Absent when the producer declared no semantic metadata. */
  readonly semantic?: ReuseSemanticMetadata;

  // ── The contract it was produced under ────────────────────────────────────
  readonly qualityProfile: QualityProfile;
  readonly capabilityProfile: CapabilityProfile;
  readonly policyVersion: string;
  readonly optimizationPolicyVersion: string;
  readonly baselinePolicyVersion: string;

  // ── What could make it wrong ──────────────────────────────────────────────
  readonly provenance: ReuseProvenance;
  readonly evidenceDependencies: readonly ReuseDependency[];
  readonly dataDependencies: readonly ReuseDependency[];

  // ── Time ──────────────────────────────────────────────────────────────────
  readonly createdAt: number;
  /** When the producer last established the record against its contract. */
  readonly validatedAt: number;
  readonly freshness: SealedFreshness;
  /** Mirrors `freshness.expiresAt`, hoisted so a store can index it. */
  readonly expiresAt?: number;

  readonly invalidatedAt?: number;
  readonly invalidationReason?: ReuseInvalidationReason;

  // ── The answer, and the proof it was not edited ───────────────────────────
  readonly outputDigest: string;
  readonly output: ReusableOutputEnvelope;

  // ── What the source generation actually cost. PROVENANCE, NOT CURRENCY ────
  readonly originalActualInputTokens: number;
  readonly originalActualOutputTokens: number;
  readonly originalActualCostMicroUsd: number;

  /** Optimistic concurrency token. 1 at creation; invalidation makes it 2. */
  readonly recordVersion: number;
}

/**
 * Structural validation for a record that came back FROM storage.
 *
 * The gate calls this before it checks anything else, and a record that fails is
 * a MISS rather than an exception: a corrupt or half-written row must not make
 * the AI platform unavailable, it must make the platform pay for the inference.
 *
 * "Partial" is the case worth naming. A record missing its digest, its identity,
 * its tenant or its version cannot be checked at all, and a gate that treated
 * absence as satisfaction would pass every one of them.
 */
export function isWholeReusableRecord(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const strings = [
    'reusableResultId',
    'organizationId',
    'taskFingerprint',
    'exactInputDigest',
    'exactReuseKey',
    'taskIdentity',
    'taskKind',
    'qualityProfile',
    'capabilityProfile',
    'policyVersion',
    'optimizationPolicyVersion',
    'baselinePolicyVersion',
    'outputDigest',
  ];
  for (const field of strings) {
    if (typeof record[field] !== 'string' || record[field] === '') return false;
  }
  const numbers = [
    'createdAt',
    'validatedAt',
    'originalActualInputTokens',
    'originalActualOutputTokens',
    'originalActualCostMicroUsd',
    'recordVersion',
  ];
  for (const field of numbers) {
    const candidate = record[field];
    if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < 0) return false;
  }
  if (record.schema !== REUSABLE_RESULT_SCHEMA) return false;
  if (!Array.isArray(record.evidenceDependencies)) return false;
  if (!Array.isArray(record.dataDependencies)) return false;
  const freshness = record.freshness;
  if (typeof freshness !== 'object' || freshness === null) return false;
  if (typeof (freshness as Record<string, unknown>).policy !== 'string') return false;
  const provenance = record.provenance;
  if (typeof provenance !== 'object' || provenance === null) return false;
  return true;
}
