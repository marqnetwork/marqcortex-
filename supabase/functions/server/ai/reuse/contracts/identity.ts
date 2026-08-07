/**
 * Reuse identity (AI-01 Batch 3B, Part 6B).
 *
 * ── PROMPT EQUALITY IS THE WRONG IDENTITY, AND IT IS THE OBVIOUS ONE ──────
 *
 * The natural cache key for an AI call is the prompt. It is also the key that
 * leaks across every boundary this platform exists to hold. Two tenants asking
 * the same question in the same words are not asking the same question. The same
 * tenant asking it before and after a policy revision is not asking the same
 * question. The same workflow node asking it at v3 and at v4 of its own
 * definition is not asking the same question. Prompt equality says all three
 * pairs are identical, and each one is a different kind of incident.
 *
 * So identity here is derived from the MATERIAL INPUTS THAT AFFECT CORRECTNESS,
 * and the visible text is only one of them:
 *
 *   TASK FINGERPRINT   Tenant, normalised task identity, and the workflow/agent
 *                      identity and versions that produced it. "What work is
 *                      this, done by which definition, for whom."
 *
 *   EXACT INPUT DIGEST The task fingerprint, plus the policy versions in force,
 *                      plus the required quality and capability floor, plus the
 *                      caller's digest of the deterministic input, plus every
 *                      declared dependency at its version. "Under exactly which
 *                      conditions."
 *
 *   EXACT REUSE KEY    Both, joined. One key, one record, one identity.
 *
 * A change to any of those produces a different key and therefore a miss, which
 * is the property the adversarial suite tests one dimension at a time.
 *
 * ── THE ENGINE NEVER SEES THE TEXT ─────────────────────────────────────────
 *
 * `inputDigest` is supplied by the caller, exactly as Part 6A takes token
 * estimates rather than re-estimating from text. The reuse engine handles
 * metadata about a tenant's business data and never the data, so the worst thing
 * a defect here can leak is a digest.
 *
 * ── THE RESULT ID IS DERIVED FROM THE KEY, NOT MINTED ──────────────────────
 *
 * `reusableResultId` is a function of the exact reuse key. That is what makes
 * the concurrency story simple enough to be correct: one identity is one
 * storage key, so two isolates populating the same identity race on a single
 * insert-if-absent and one of them observably loses. A minted id would give the
 * same identity two records, two savings attributions and no way to tell which
 * is authoritative.
 */

import type { CapabilityProfile, QualityProfile } from '../../optimization/contracts/compression.ts';
import type { ReuseDependency } from './dependency.ts';

/**
 * Everything that goes into an identity. Every field is declared by the caller
 * from workflow, agent, policy or node metadata — none is inferred by a model.
 */
export interface ReuseIdentityInput {
  readonly organizationId: string;
  /**
   * The normalised task identity.
   *
   * Not a prompt and not a free-text label: the stable name of the work, such as
   * the node's declared task key. Two call sites doing the same work must supply
   * the same value or they will never share a cache entry, and two call sites
   * doing different work must not.
   */
  readonly taskIdentity: string;
  readonly taskKind: string;

  readonly workflowId?: string;
  readonly workflowVersion?: string;
  readonly workflowPlanDigest?: string;
  readonly agentId?: string;
  readonly agentVersion?: string;
  readonly agentCertificationId?: string;

  readonly policyVersion: string;
  readonly optimizationPolicyVersion: string;
  readonly baselinePolicyVersion: string;

  readonly quality: QualityProfile;
  readonly minimumCapabilityProfile: CapabilityProfile;

  /** The caller's digest of the deterministic material input. Never the input. */
  readonly inputDigest: string;

  readonly evidenceDependencies: readonly ReuseDependency[];
  readonly dataDependencies: readonly ReuseDependency[];
}

export interface ReuseIdentity {
  readonly organizationId: string;
  /** What work this is, by which definition, for whom. */
  readonly taskFingerprint: string;
  /** Under exactly which conditions. */
  readonly exactInputDigest: string;
  /** The single storage identity. `taskFingerprint:exactInputDigest`. */
  readonly exactReuseKey: string;
  /** Derived from the key, never minted. */
  readonly reusableResultId: string;
  /** Normalised, sorted, deduplicated. */
  readonly evidenceDependencies: readonly ReuseDependency[];
  readonly dataDependencies: readonly ReuseDependency[];
}

/**
 * Declared semantic metadata for candidate discovery.
 *
 * NOT AN EMBEDDING. These are labels the workflow or agent definition declares —
 * a topic, an intent, a declared feature set — and the platform has no embedding
 * provider precisely because adding one to decide whether a model call can be
 * avoided would be a second AI execution path. See `discovery/` for the port.
 */
export interface ReuseSemanticMetadata {
  /**
   * A coarse bucket a candidate must share to be considered at all.
   *
   * Discovery is scoped to one tenant AND one class, so "similar" can never
   * reach across two unrelated kinds of work even if a scoring function
   * misbehaves.
   */
  readonly semanticClass: string;
  /** Declared feature labels. Bounded, sorted, deduplicated at seal time. */
  readonly features: readonly string[];
  /** Digest of the class and features. The comparable form. */
  readonly semanticFingerprint: string;
}
