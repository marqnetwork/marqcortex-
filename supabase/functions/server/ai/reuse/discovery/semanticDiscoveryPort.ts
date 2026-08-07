/**
 * Semantic reuse discovery (AI-01 Batch 3B, Part 6B).
 *
 * ── THE DESIGN QUESTION, ANSWERED BEFORE ANY CODE WAS WRITTEN ─────────────
 *
 * The batch requires an explicit finding: does this repository already have a
 * certified embedding or retrieval path suitable for reuse discovery?
 *
 * IT DOES NOT. There is no embedding provider, no vector index and no retrieval
 * service anywhere in the AI tree — the only occurrences of the word are two
 * comments in `optimization/engine/contextValueEngine.ts` and
 * `agents/runtime/contextBuilder.ts` recording that neither of those components
 * uses one either.
 *
 * So Part 6B adds the CONTRACT and the candidate-ranking interface, plus a
 * deterministic adapter over declared labels, and adds NO PRODUCTION EMBEDDING
 * PROVIDER. Two reasons, and the second is the load-bearing one:
 *
 *   1. Introducing an embedding provider to decide whether a model call can be
 *      avoided would create a SECOND AI EXECUTION PATH — one that does not go
 *      through the guard, the policy engine, the spend ceiling, the
 *      certification checks or the audit trail. The platform would be paying a
 *      model to decide whether to pay a model, ungoverned, inside a cost
 *      optimiser.
 *
 *   2. Architecture drift. A provider added to complete a batch is a provider
 *      nobody chose, with no owner, no allow list entry and no rollback story.
 *
 * When the platform does grow a certified retrieval path, it implements
 * `SemanticReuseDiscoveryPort` and nothing else in this tree changes — which is
 * the point of having the interface now.
 *
 * ── DISCOVERY RETURNS CANDIDATES. IT NEVER AUTHORIZES ANYTHING ────────────
 *
 * A `SemanticCandidate` is a suggestion with a score. It is not a permission, it
 * is not a verdict, and the pipeline treats it as untrusted input: every
 * candidate is RELOADED from the tenant-scoped store by id and then put through
 * the full eligibility gate. A port that returned another tenant's ids, ids that
 * do not exist, or ids with a fabricated similarity of 100 would achieve
 * nothing — the org-scoped load returns nothing for the first two and the gate
 * refuses on the merits for the third.
 *
 * That is why `similarity` has no security meaning here and why there is no
 * "trusted port" flag. The contract is designed so that trust is never required.
 */

import type { ReusableResultRecord } from '../contracts/reusableResult.ts';

/**
 * What a candidate search is scoped by.
 *
 * `organizationId` is required and there is no form of this query without one.
 * Cross-tenant discovery is not a policy this platform enforces — it is a query
 * this platform cannot express.
 */
export interface SemanticDiscoveryQuery {
  readonly organizationId: string;
  /** The coarse "what work is this" key. */
  readonly taskFingerprint: string;
  /** The declared task identity. Candidates outside it are not similar work. */
  readonly taskIdentity: string;
  /** The declared semantic class. A hard partition, not a soft signal. */
  readonly semanticClass: string;
  /** The requesting side's declared features. */
  readonly features: readonly string[];
  /** Fingerprint of class and features, for exact-semantic shortcuts. */
  readonly semanticFingerprint: string;
  /** 0–100. Candidates below this are not returned. */
  readonly minimumSimilarity: number;
  readonly limit: number;
}

export const SEMANTIC_DISCOVERY_METHODS = [
  /** Identical declared semantic fingerprint. */
  'declared_fingerprint',
  /** Overlap of declared feature labels. No model, no embedding. */
  'declared_feature_overlap',
] as const;

export type SemanticDiscoveryMethod = (typeof SEMANTIC_DISCOVERY_METHODS)[number];

export interface SemanticCandidate {
  readonly reusableResultId: string;
  /** 0–100, integer. A ranking signal and nothing more. */
  readonly similarity: number;
  readonly method: SemanticDiscoveryMethod;
  /** Echoed back for the audit record. Never trusted for scoping. */
  readonly organizationId: string;
}

export interface SemanticReuseDiscoveryPort {
  /**
   * Rank potentially reusable results. Suggestions only.
   *
   * A port may return an empty list, may be slow, and may fail — the pipeline
   * treats all three as `no_candidate` or `discovery_unavailable` and continues
   * to Part 6A. Nothing about a platform's correctness depends on this
   * succeeding.
   */
  discover(query: SemanticDiscoveryQuery): Promise<readonly SemanticCandidate[]>;
}

/**
 * The deterministic ranking used by the adapter below, and available to any
 * future port that wants the same tie-breaking.
 *
 * Jaccard overlap of DECLARED LABEL SETS, scaled to 0–100 and floored. This is
 * set arithmetic over strings a human authored and a validator accepted — it is
 * not an embedding, not a model, not a learned function, and it has no training
 * data. Two runs produce the same number forever, which is what lets a test
 * assert on a similarity value at all.
 */
export function declaredFeatureSimilarity(
  left: readonly string[],
  right: readonly string[],
): number {
  const a = new Set(left);
  const b = new Set(right);
  if (a.size === 0 && b.size === 0) return 100;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const feature of a) {
    if (b.has(feature)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  return Math.floor((intersection / union) * 100);
}

/**
 * Order candidates so that "which one did we pick" is never a coin toss.
 *
 * Similarity descending, then the record's own validation time descending, then
 * the id ascending. Every term is a stored value, so the order is reproducible
 * across isolates and across test runs — a non-deterministic tie-break would
 * make an entire reuse decision irreproducible for the sake of nothing.
 */
export function rankCandidates(
  candidates: readonly SemanticCandidate[],
  validatedAtById: ReadonlyMap<string, number>,
): readonly SemanticCandidate[] {
  return [...candidates].sort(
    (a, b) =>
      b.similarity - a.similarity ||
      (validatedAtById.get(b.reusableResultId) ?? 0) -
        (validatedAtById.get(a.reusableResultId) ?? 0) ||
      (a.reusableResultId < b.reusableResultId
        ? -1
        : a.reusableResultId > b.reusableResultId
          ? 1
          : 0),
  );
}

/**
 * Score one record against one query. Shared so the adapter and any future port
 * agree on what a similarity number means.
 */
export function scoreRecord(
  record: ReusableResultRecord,
  query: SemanticDiscoveryQuery,
): SemanticCandidate | undefined {
  const semantic = record.semantic;
  // A record with no declared semantic metadata is not a semantic candidate. It
  // is still an exact-reuse candidate under its own key; it simply made no claim
  // about what it is similar to, and inventing one for it would be the
  // model-free equivalent of guessing.
  if (semantic === undefined) return undefined;
  if (record.organizationId !== query.organizationId) return undefined;
  if (semantic.semanticClass !== query.semanticClass) return undefined;
  if (record.taskIdentity !== query.taskIdentity) return undefined;

  if (semantic.semanticFingerprint === query.semanticFingerprint) {
    return {
      reusableResultId: record.reusableResultId,
      similarity: 100,
      method: 'declared_fingerprint',
      organizationId: record.organizationId,
    };
  }

  const similarity = declaredFeatureSimilarity(semantic.features, query.features);
  if (similarity < query.minimumSimilarity) return undefined;
  return {
    reusableResultId: record.reusableResultId,
    similarity,
    method: 'declared_feature_overlap',
    organizationId: record.organizationId,
  };
}
