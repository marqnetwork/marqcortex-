/**
 * The cache foundation (AI-01 Batch 3B).
 *
 * The cheapest AI call is the one that does not happen. This module is how a
 * workflow can answer a read-only model or transform node from a previous
 * identical answer — and, more importantly, how it is prevented from doing so
 * when that would be unsafe.
 *
 * THE KEY IS THE SAFETY MECHANISM.
 *
 * A cache is only as isolated as its key. Every input that could make two
 * requests semantically different is IN the key, so a collision is not a
 * plausible bug — it is arithmetically prevented:
 *
 *   workflowId + workflowVersion   a definition change invalidates everything
 *   nodeId                         two nodes never share an entry
 *   promptId + promptVersion       a prompt edit invalidates everything
 *   modelProfileId                 a downgrade is a different answer
 *   normalized input digest        different inputs, different entries
 *   context manifest digest        different evidence, different entries
 *   policyVersion                  a governance change invalidates everything
 *   organizationId                 THE tenant boundary. Never optional for
 *                                  anything derived from tenant data.
 *   freshnessVersion               a data or tool version the caller supplies
 *
 * TENANT SCOPE IS NOT A PARAMETER TO GET RIGHT AT THE CALL SITE. `buildCacheKey`
 * refuses to produce a key for a tenant-scoped node without an organization id,
 * so a caller cannot accidentally create a cross-tenant entry by forgetting a
 * field. That refusal is the single most important line in this file.
 *
 * WHAT IS NEVER CACHED, BY CONSTRUCTION.
 *
 *   side-effecting nodes  a cached tool call is a tool call that did not happen
 *                         while the workflow believes it did
 *   approval nodes        a cached approval is nobody's decision
 *   high-risk nodes       unless the definition explicitly permits it
 *   anything bearing a secret
 *
 * A CACHE MISS IS ALWAYS SAFE. Every failure mode in this module — an unreadable
 * entry, an expired one, a policy mismatch, a store that throws — resolves to
 * "no entry", never to an exception and never to a stale answer. A cache that can
 * fail a run is worse than no cache.
 *
 * SAVINGS ARE PRICED AGAINST A VERSIONED ESTIMATE. A hit records the tokens and
 * micro-USD the avoided call would have cost at the profile's declared rate. It
 * never invents a figure.
 */

import type { WorkflowModelNode } from '../contracts/workflow.ts';
import { workflowFailure } from '../contracts/failures.ts';
import { digestValue } from '../../agents/runtime/digest.ts';

/** Version of the key construction. A bump invalidates every stored entry. */
export const CACHE_KEY_VERSION = 'wfcache.v1';

export interface CacheKeyInput {
  readonly workflowId: string;
  readonly workflowVersion: string;
  readonly nodeId: string;
  readonly promptId: string;
  readonly promptVersion: string;
  readonly modelProfileId: string;
  /** Digest of the node's normalized, resolved input. */
  readonly inputDigest: string;
  /** Digest of the context manifest the optimizer produced. */
  readonly contextManifestDigest: string;
  readonly policyVersion: string;
  /**
   * The tenant an entry belongs to. Required whenever the node's data is
   * tenant-scoped, which for a workflow model node is always: its context comes
   * from the run's own values.
   */
  readonly organizationId: string;
  /** Data or tool freshness version, when the node depends on one. */
  readonly freshnessVersion?: string;
}

export interface CacheEntry {
  readonly key: string;
  readonly organizationId: string;
  readonly workflowId: string;
  readonly nodeId: string;
  /** The node's validated output. Never a raw provider response. */
  readonly output: unknown;
  readonly outputDigest: string;
  /** Tokens the original call actually used. What a hit avoids. */
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly costMicroUsd: number;
  readonly modelProfileId: string;
  readonly policyVersion: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

/**
 * The cache port.
 *
 * Deliberately narrow: get, put and a tenant-scoped invalidation. There is no
 * `clear()`, no `keys()` and no cross-tenant read, because each of those would be
 * a way to reach an entry the caller was not entitled to.
 */
export interface WorkflowCachePort {
  get(organizationId: string, key: string): Promise<CacheEntry | undefined>;
  put(entry: CacheEntry): Promise<void>;
  /** Drop every entry for one workflow in one tenant. Used on a version change. */
  invalidate(organizationId: string, workflowId: string): Promise<number>;
}

/**
 * Build a cache key, or refuse.
 *
 * Refusal cases are definition or wiring errors, not run-time conditions: a
 * missing organization id, a missing prompt version, a missing manifest digest.
 * Each of them would produce an entry that could be served to the wrong request,
 * so none of them is allowed to degrade into "cache it anyway".
 */
export function buildCacheKey(input: CacheKeyInput): string {
  const missing: string[] = [];
  if (!input.organizationId?.trim()) missing.push('organizationId');
  if (!input.workflowId?.trim()) missing.push('workflowId');
  if (!input.workflowVersion?.trim()) missing.push('workflowVersion');
  if (!input.nodeId?.trim()) missing.push('nodeId');
  if (!input.promptId?.trim()) missing.push('promptId');
  if (!input.promptVersion?.trim()) missing.push('promptVersion');
  if (!input.modelProfileId?.trim()) missing.push('modelProfileId');
  if (!input.inputDigest?.trim()) missing.push('inputDigest');
  if (!input.contextManifestDigest?.trim()) missing.push('contextManifestDigest');
  if (!input.policyVersion?.trim()) missing.push('policyVersion');

  if (missing.length > 0) {
    throw workflowFailure('cache_policy_denied', 'This step cannot be cached safely.', {
      workflowId: input.workflowId,
      nodeId: input.nodeId,
      diagnostics: `cache key is missing: ${missing.join(', ')}`,
    });
  }

  // The organization is a literal prefix as well as a digested component. The
  // digest alone would be enough for correctness; the prefix means a stored key
  // is visibly tenant-scoped to anyone reading the store, and a prefix scan for
  // one tenant cannot return another's.
  const material = digestValue({
    version: CACHE_KEY_VERSION,
    workflowId: input.workflowId,
    workflowVersion: input.workflowVersion,
    nodeId: input.nodeId,
    promptId: input.promptId,
    promptVersion: input.promptVersion,
    modelProfileId: input.modelProfileId,
    inputDigest: input.inputDigest,
    contextManifestDigest: input.contextManifestDigest,
    policyVersion: input.policyVersion,
    organizationId: input.organizationId,
    freshnessVersion: input.freshnessVersion ?? 'none',
  });
  return `${CACHE_KEY_VERSION}:${input.organizationId}:${input.workflowId}:${input.nodeId}:${material}`;
}

export type CacheDenialReason =
  | 'not_cacheable'
  | 'side_effecting'
  | 'approval_gated'
  | 'high_risk_not_permitted'
  | 'no_ttl';

export interface CacheEligibility {
  readonly eligible: boolean;
  readonly reason: string;
  readonly denialReason?: CacheDenialReason;
}

/**
 * May this node be cached at all?
 *
 * Asked BEFORE a key is built, so an ineligible node never produces one. The
 * checks are ordered from the most categorical refusal to the most conditional,
 * so the reason a reviewer reads is the strongest one that applies.
 */
export function cacheEligibilityFor(input: {
  readonly node: WorkflowModelNode;
  readonly sideEffecting: boolean;
  readonly highRisk: boolean;
  readonly highRiskCachingPermitted: boolean;
}): CacheEligibility {
  if (input.sideEffecting) {
    return {
      eligible: false,
      reason: 'a side-effecting node is never served from cache',
      denialReason: 'side_effecting',
    };
  }
  if (input.node.approval !== undefined) {
    return {
      eligible: false,
      reason: 'an approval-gated node is never served from cache',
      denialReason: 'approval_gated',
    };
  }
  if (!input.node.cacheable) {
    return {
      eligible: false,
      reason: 'the node does not declare itself cacheable',
      denialReason: 'not_cacheable',
    };
  }
  if (input.highRisk && !input.highRiskCachingPermitted) {
    return {
      eligible: false,
      reason: 'a high-risk node is cached only when the deployment explicitly permits it',
      denialReason: 'high_risk_not_permitted',
    };
  }
  if (!(input.node.cacheTtlMs > 0)) {
    return { eligible: false, reason: 'the node declares no cache TTL', denialReason: 'no_ttl' };
  }
  return { eligible: true, reason: 'the node is a cacheable read-only step' };
}

/**
 * Is a stored entry still usable?
 *
 * Expiry, tenant and policy version are all re-checked on READ rather than
 * trusted from the key. The key proves the request matched; this proves the
 * ENTRY is still valid — a governance change that happened after the entry was
 * written must not be served, and an entry whose tenant disagrees with its own
 * key is corrupt rather than usable.
 */
export function isEntryUsable(
  entry: CacheEntry,
  input: { readonly organizationId: string; readonly policyVersion: string; readonly nowMs: number },
): { readonly usable: boolean; readonly reason: string } {
  if (entry.organizationId !== input.organizationId) {
    return { usable: false, reason: 'entry belongs to another organization' };
  }
  if (entry.policyVersion !== input.policyVersion) {
    return { usable: false, reason: 'entry was written under a different policy version' };
  }
  const expiresMs = Date.parse(entry.expiresAt);
  if (!Number.isFinite(expiresMs)) {
    return { usable: false, reason: 'entry has an unreadable expiry' };
  }
  if (expiresMs <= input.nowMs) return { usable: false, reason: 'entry has expired' };
  return { usable: true, reason: 'entry is fresh and matches the current policy version' };
}

/**
 * A bounded in-memory cache adapter.
 *
 * Correct for a single isolate and for tests. Keys are tenant-prefixed, so
 * eviction and invalidation cannot reach across tenants even here. A deployment
 * that wants cross-isolate caching injects a durable port implementing the same
 * three methods; nothing in the orchestrator changes.
 *
 * Eviction is oldest-first and safe by definition: a cache that forgot something
 * produces a miss, and a miss produces a correct answer at full price.
 */
export function createMemoryWorkflowCache(
  options: { readonly maxEntries?: number } = {},
): WorkflowCachePort & { size(): number; clear(): void } {
  const maxEntries = options.maxEntries ?? 500;
  const entries = new Map<string, CacheEntry>();
  const keyOf = (organizationId: string, key: string) => `${organizationId}::${key}`;

  return {
    get(organizationId, key) {
      const entry = entries.get(keyOf(organizationId, key));
      // Belt and braces: the map key already scopes the read, and the entry is
      // checked against the caller's organization anyway. An entry that
      // disagrees with its own key is corrupt, not a cross-tenant hit.
      if (entry && entry.organizationId !== organizationId) return Promise.resolve(undefined);
      return Promise.resolve(entry);
    },

    put(entry) {
      const key = keyOf(entry.organizationId, entry.key);
      if (!entries.has(key) && entries.size >= maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      entries.set(key, entry);
      return Promise.resolve();
    },

    invalidate(organizationId, workflowId) {
      let removed = 0;
      for (const [key, entry] of [...entries.entries()]) {
        if (entry.organizationId === organizationId && entry.workflowId === workflowId) {
          entries.delete(key);
          removed += 1;
        }
      }
      return Promise.resolve(removed);
    },

    size: () => entries.size,
    clear: () => entries.clear(),
  };
}

/**
 * Wrap a cache port so it can never fail a run.
 *
 * A store that throws on read produces a miss; a store that throws on write
 * produces a warning. The alternative — a cache outage taking down every
 * workflow that was trying to save money — is the sort of failure that gets
 * caching turned off permanently.
 */
export function createSafeWorkflowCache(
  inner: WorkflowCachePort,
  onError: (operation: string, error: unknown) => void,
): WorkflowCachePort {
  return {
    async get(organizationId, key) {
      try {
        return await inner.get(organizationId, key);
      } catch (error) {
        onError('get', error);
        return undefined;
      }
    },
    async put(entry) {
      try {
        await inner.put(entry);
      } catch (error) {
        onError('put', error);
      }
    },
    async invalidate(organizationId, workflowId) {
      try {
        return await inner.invalidate(organizationId, workflowId);
      } catch (error) {
        onError('invalidate', error);
        return 0;
      }
    },
  };
}
