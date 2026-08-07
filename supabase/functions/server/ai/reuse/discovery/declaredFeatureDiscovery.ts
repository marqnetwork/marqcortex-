/**
 * The deterministic semantic discovery adapter (AI-01 Batch 3B, Part 6B).
 *
 * ── WHAT THIS IS, AND WHAT IT IS DELIBERATELY NOT ─────────────────────────
 *
 * This is the reference implementation of `SemanticReuseDiscoveryPort`, built
 * entirely out of set arithmetic over DECLARED LABELS. It reads the same
 * tenant-scoped store the rest of the tree reads, filters to one semantic class
 * and one declared task identity, scores by label overlap, and returns a ranked
 * list.
 *
 * It is NOT an embedding provider, NOT a model, NOT a learned ranker and NOT a
 * retrieval service. The batch forbids adding any of those to complete Part 6B,
 * and the repository has none to integrate with — see the finding recorded in
 * `semanticDiscoveryPort.ts`.
 *
 * ── IT IS ALSO NOT A SECURITY BOUNDARY, WHICH IS WHY IT CAN BE SIMPLE ─────
 *
 * Everything this returns is re-loaded by id from the tenant-scoped store and
 * put through the full eligibility gate. So the worst outcome a defect here can
 * produce is a wasted gate evaluation, and the design does not depend on this
 * adapter being right — only on it being deterministic, which set arithmetic
 * over sorted labels is by construction.
 */

import type { ReusableResultStore } from '../persistence/ports.ts';
import type {
  SemanticCandidate,
  SemanticDiscoveryQuery,
  SemanticReuseDiscoveryPort,
} from './semanticDiscoveryPort.ts';
import { rankCandidates, scoreRecord } from './semanticDiscoveryPort.ts';

export interface DeclaredFeatureDiscoveryOptions {
  readonly store: ReusableResultStore;
  /** Rows the underlying candidate scan will consider. Bounded by the store. */
  readonly scanLimit?: number;
}

export function createDeclaredFeatureDiscovery(
  options: DeclaredFeatureDiscoveryOptions,
): SemanticReuseDiscoveryPort {
  return {
    async discover(query: SemanticDiscoveryQuery): Promise<readonly SemanticCandidate[]> {
      // The store's own query is organization-scoped and there is no form of it
      // that is not, so a candidate from another tenant is not something this
      // filters out — it is something it cannot receive.
      const records = await options.store.findCandidates({
        organizationId: query.organizationId,
        taskIdentity: query.taskIdentity,
        semanticClass: query.semanticClass,
        ...(options.scanLimit === undefined ? {} : { limit: options.scanLimit }),
      });

      const validatedAtById = new Map<string, number>();
      const candidates: SemanticCandidate[] = [];
      for (const record of records) {
        const candidate = scoreRecord(record, query);
        if (candidate === undefined) continue;
        validatedAtById.set(record.reusableResultId, record.validatedAt);
        candidates.push(candidate);
      }

      return rankCandidates(candidates, validatedAtById).slice(0, Math.max(1, query.limit));
    },
  };
}
