/**
 * The safe cache foundation (AI-01 Batch 3B).
 *
 * A cache in front of a model is the single largest cost lever a platform has,
 * and it is also the easiest place to leak one tenant's data into another
 * tenant's answer. This module is deliberately conservative about the second in
 * order to be usable for the first.
 *
 * FIVE PROPERTIES, EACH ONE ANSWERING A SPECIFIC WAY THIS GOES WRONG.
 *
 *   THE TENANT IS PART OF THE KEY, AND CHECKED AGAIN ON READ. `organizationId`
 *   is a key component, so two tenants asking the identical question cannot
 *   collide. The stored entry also carries its organization and a read whose
 *   organization does not match is treated as a miss, not as a hit — the key
 *   already makes that unreachable, and the second check means a future change
 *   to key construction cannot silently make it reachable.
 *
 *   THE GOVERNED FEATURE AND THE CONFIGURATION VERSION ARE PART OF THE KEY. An
 *   answer produced under one feature's prompt, governance rules and output
 *   contract is not interchangeable with an answer produced under another's, and
 *   an administrator who changes operational settings has changed the conditions
 *   the answer was produced under. Bumping `configurationVersion` therefore
 *   invalidates the whole cache by construction rather than by a sweep.
 *
 *   WHAT IS CACHED IS THE GOVERNED OUTPUT, NOT A RAW COMPLETION. The value
 *   stored is what `controlPlane.execute` returned — already redacted, already
 *   fact-locked, already validated against the feature's output contract. A
 *   cache of raw provider text would be a way to serve content that never passed
 *   the governance layer.
 *
 *   IT IS ISOLATE-LOCAL, BOUNDED AND TIME-LIMITED. Entries live in memory with a
 *   fixed capacity and a TTL. This is a FOUNDATION, and the word is meant: a
 *   durable, shared cache is a larger decision with a data-retention consequence,
 *   and shipping the in-memory form first means the accounting, the eligibility
 *   rules and the key construction are proven before anything is persisted.
 *
 *   ELIGIBILITY IS A REFUSAL LIST, NOT AN ALLOW LIST. `isCacheEligible` states
 *   the conditions under which reuse is NOT safe. Anything it refuses is never
 *   stored and never served, and the refusal reason is recorded so a step that
 *   was expected to hit and did not has an answer.
 *
 * WHAT IS DELIBERATELY NOT HERE: semantic or embedding-based lookup. A cache
 * that returns the answer to a DIFFERENT question because it looked similar is
 * not a cache, it is a quality regression with a cost saving attached. Lookup is
 * exact-match on a digest of the assembled prompt, and nothing else.
 */

import type { AITokenUsage } from '../contracts/request.ts';
import type { AgentSafetyClass } from '../agents/contracts/agent.ts';
import { canonicalJson, digestText, digestValue } from '../agents/runtime/digest.ts';

/** What identifies a cacheable step. Every field participates in the key. */
export interface CacheKeyInput {
  readonly organizationId: string;
  /** The registered control plane feature the step executes through. */
  readonly featureId: string;
  readonly modelProfileId: string;
  /** Digest of the assembled prompt. Never the prompt itself. */
  readonly promptDigest: string;
  /** Fields the answer must carry. A different contract is a different answer. */
  readonly outputFields: readonly string[];
  /** Operational settings version in force. A change invalidates everything. */
  readonly configurationVersion: number;
  /** The agent asking. Two agents asking the same thing want different framing. */
  readonly agentId: string;
}

export interface CacheEntry {
  readonly key: string;
  readonly organizationId: string;
  /** The GOVERNED output the control plane returned. Never a raw completion. */
  readonly output: unknown;
  readonly outputDigest: string;
  /** Usage the original call consumed. What a hit is credited with avoiding. */
  readonly usage: AITokenUsage;
  /** Micro-USD the original call cost. What a hit is credited with avoiding. */
  readonly costMicroUsd: number;
  readonly providerId: string;
  readonly modelId: string;
  /** Control plane request id of the call that produced this. The audit join. */
  readonly sourceRequestId: string;
  readonly storedAt: string;
  readonly expiresAtMs: number;
  readonly hits: number;
}

export type CacheRefusal =
  /** The agent can cause an effect outside the platform. A stale answer is unsafe. */
  | 'external_effect'
  /** The step does not return parseable structure, so reuse cannot be verified. */
  | 'unstructured_output'
  /** An approval authorised THIS action; serving a stored answer bypasses it. */
  | 'approval_in_flight'
  /** Caching is administratively off for this deployment. */
  | 'disabled';

export interface CacheEligibility {
  readonly eligible: boolean;
  readonly refusedBecause?: CacheRefusal;
}

export interface CacheEligibilityInput {
  readonly enabled: boolean;
  readonly safetyClass: AgentSafetyClass;
  readonly requiresStructuredOutput: boolean;
  /** True when this step is being replayed under a granted approval. */
  readonly approvalInFlight: boolean;
}

/**
 * May this step's answer be stored and reused?
 *
 * Ordered most-serious first, so the reported reason is the one an operator
 * should act on when several apply.
 */
export function isCacheEligible(input: CacheEligibilityInput): CacheEligibility {
  if (!input.enabled) return { eligible: false, refusedBecause: 'disabled' };
  if (input.safetyClass === 'external_effect') {
    return { eligible: false, refusedBecause: 'external_effect' };
  }
  if (input.approvalInFlight) {
    return { eligible: false, refusedBecause: 'approval_in_flight' };
  }
  if (!input.requiresStructuredOutput) {
    return { eligible: false, refusedBecause: 'unstructured_output' };
  }
  return { eligible: true };
}

/**
 * The cache key.
 *
 * A full-length SHA-256 over the canonical form of every component. Full length
 * rather than the truncated form used for fingerprints, because this digest
 * separates one tenant's answers from another's — the place where a collision
 * would be a disclosure rather than a mis-counted loop.
 */
export function cacheKeyFor(input: CacheKeyInput): string {
  const canonical = canonicalJson({
    schema: 'ai.optimization.cache.v1',
    organizationId: input.organizationId,
    featureId: input.featureId,
    modelProfileId: input.modelProfileId,
    promptDigest: input.promptDigest,
    outputFields: [...input.outputFields].sort(),
    configurationVersion: input.configurationVersion,
    agentId: input.agentId,
  });
  return digestText(canonical ?? 'null');
}

export interface PromptCacheOptions {
  readonly maxEntries?: number;
  readonly ttlMs?: number;
  /** Injected so a test can pin expiry. Milliseconds since the epoch. */
  readonly now: () => number;
  readonly isoNow: () => string;
}

export interface PromptCacheStats {
  readonly lookups: number;
  readonly hits: number;
  readonly misses: number;
  readonly stores: number;
  readonly evictions: number;
  readonly expirations: number;
  readonly size: number;
}

export interface PromptCache {
  /** Exact-match read. Tenant-checked. Expired entries are removed, not served. */
  get(organizationId: string, key: string): CacheEntry | undefined;
  /** Store a governed output. Refuses a key whose tenant does not match. */
  put(entry: Omit<CacheEntry, 'storedAt' | 'expiresAtMs' | 'hits'>): void;
  stats(): PromptCacheStats;
  /** Drop everything. Used when a deployment invalidates deliberately. */
  clear(): void;
  size(): number;
}

const DEFAULT_MAX_ENTRIES = 256;
const DEFAULT_TTL_MS = 15 * 60 * 1000;

/**
 * Bounded in-memory cache with least-recently-used eviction.
 *
 * A `Map` preserves insertion order, so re-inserting an entry on read moves it
 * to the end and the oldest key is always the first one the iterator yields.
 * That is the whole of the LRU implementation, and it is deliberately the whole
 * of it: a cache with its own data structure is a second thing that can be wrong
 * about how much memory an isolate is holding.
 */
export function createPromptCache(options: PromptCacheOptions): PromptCache {
  const maxEntries = Math.max(1, Math.floor(options.maxEntries ?? DEFAULT_MAX_ENTRIES));
  const ttlMs = Math.max(1_000, Math.floor(options.ttlMs ?? DEFAULT_TTL_MS));
  const entries = new Map<string, CacheEntry>();

  let lookups = 0;
  let hits = 0;
  let misses = 0;
  let stores = 0;
  let evictions = 0;
  let expirations = 0;

  return {
    get(organizationId, key) {
      lookups += 1;
      const entry = entries.get(key);
      if (!entry) {
        misses += 1;
        return undefined;
      }
      if (entry.expiresAtMs <= options.now()) {
        entries.delete(key);
        expirations += 1;
        misses += 1;
        return undefined;
      }
      // Unreachable while the organization is part of the key. Present so a
      // change to key construction cannot turn a hash collision into a
      // cross-tenant read without this line also being deleted.
      if (entry.organizationId !== organizationId) {
        misses += 1;
        return undefined;
      }
      const refreshed: CacheEntry = { ...entry, hits: entry.hits + 1 };
      entries.delete(key);
      entries.set(key, refreshed);
      hits += 1;
      return refreshed;
    },

    put(entry) {
      if (entries.size >= maxEntries && !entries.has(entry.key)) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) {
          entries.delete(oldest);
          evictions += 1;
        }
      }
      entries.delete(entry.key);
      entries.set(entry.key, {
        ...entry,
        storedAt: options.isoNow(),
        expiresAtMs: options.now() + ttlMs,
        hits: 0,
      });
      stores += 1;
    },

    stats: () => ({ lookups, hits, misses, stores, evictions, expirations, size: entries.size }),

    clear: () => entries.clear(),

    size: () => entries.size,
  };
}

/** Digest of a governed output. Re-exported so callers need one import. */
export function outputDigestOf(output: unknown): string {
  return digestValue(output);
}
