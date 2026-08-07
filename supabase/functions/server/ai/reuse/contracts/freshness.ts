/**
 * Freshness policies (AI-01 Batch 3B, Part 6B).
 *
 * ── "RECENT ENOUGH" IS NOT A POLICY ────────────────────────────────────────
 *
 * The batch forbids inferring freshness from recency, and the reason is that
 * recency is a property of the CACHE while validity is a property of the WORLD.
 * A result written four seconds ago against a pricing table that changed three
 * seconds ago is recent and wrong. A result written a year ago describing an
 * immutable historical fact is ancient and correct.
 *
 * So every reusable result declares which of three arguments it is making, and
 * the eligibility gate evaluates the declared argument rather than looking at a
 * timestamp and forming an opinion:
 *
 *   immutable         "Nothing can make this wrong." Reserved for answers over
 *                     inputs that cannot change. It still expires by
 *                     INVALIDATION — immutable is a claim about time, not a
 *                     claim about authority — so a policy change still stops it.
 *
 *   ttl               "This is valid for N milliseconds." A bounded window
 *                     somebody chose and can be asked to justify. The expiry is
 *                     computed ONCE, at seal time, and stored on the record.
 *
 *   dependency_bound  "This is valid while these are unchanged." No clock at
 *                     all. A record making this claim with no dependencies is
 *                     refused at seal time, because it would be `immutable`
 *                     wearing a more diligent-looking label.
 *
 * ── A READ NEVER EXTENDS AN EXPIRY ─────────────────────────────────────────
 *
 * `expiresAt` is written once, by `sealFreshness`, from the creation time. There
 * is no function in this tree that recomputes it and no store method that writes
 * it after creation. That matters because the alternative — sliding expiry, where
 * a read refreshes the window — makes a popular wrong answer live forever, and
 * popularity is not evidence of correctness.
 */

import { reuseFailure } from './failures.ts';

export const REUSE_FRESHNESS_POLICIES = ['immutable', 'ttl', 'dependency_bound'] as const;

export type ReuseFreshnessPolicy = (typeof REUSE_FRESHNESS_POLICIES)[number];

export interface ReuseFreshnessDeclaration {
  readonly policy: ReuseFreshnessPolicy;
  /** Required for `ttl`, forbidden otherwise. Milliseconds. */
  readonly ttlMs?: number;
}

/** One year. A TTL beyond this is almost certainly a units mistake. */
export const MAX_TTL_MS = 365 * 24 * 60 * 60 * 1_000;

export interface SealedFreshness {
  readonly policy: ReuseFreshnessPolicy;
  readonly ttlMs?: number;
  /** Absolute expiry, computed once at seal time. Absent unless `ttl`. */
  readonly expiresAt?: number;
}

/**
 * Turn a declaration into the stored freshness, refusing the incoherent ones.
 *
 * `dependencyCount` is taken rather than inspected from a record because this
 * runs during sealing, before the record exists — and a `dependency_bound`
 * policy with nothing to bind to is the one freshness mistake that produces a
 * result which never expires and never invalidates on its own.
 */
export function sealFreshness(
  declaration: ReuseFreshnessDeclaration,
  createdAt: number,
  dependencyCount: number,
): SealedFreshness {
  if (!REUSE_FRESHNESS_POLICIES.includes(declaration.policy)) {
    throw reuseFailure('reuse_input_invalid', 'Unknown freshness policy.', {
      diagnostics: `policy=${String(declaration.policy)}`,
    });
  }
  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    throw reuseFailure('reuse_input_invalid', 'A reusable result needs a creation time.', {
      diagnostics: `createdAt=${String(createdAt)}`,
    });
  }

  if (declaration.policy === 'ttl') {
    const ttlMs = declaration.ttlMs;
    if (typeof ttlMs !== 'number' || !Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) {
      throw reuseFailure('reuse_input_invalid', 'A bounded freshness policy needs a valid TTL.', {
        diagnostics: `ttlMs=${String(ttlMs)} max=${MAX_TTL_MS}`,
      });
    }
    return { policy: 'ttl', ttlMs: Math.floor(ttlMs), expiresAt: createdAt + Math.floor(ttlMs) };
  }

  if (declaration.ttlMs !== undefined) {
    throw reuseFailure(
      'reuse_input_invalid',
      'Only a bounded freshness policy may declare a TTL.',
      { diagnostics: `policy=${declaration.policy} ttlMs=${String(declaration.ttlMs)}` },
    );
  }

  if (declaration.policy === 'dependency_bound' && dependencyCount === 0) {
    throw reuseFailure(
      'reuse_input_invalid',
      'A dependency-bound result must declare at least one dependency.',
      { diagnostics: 'dependency_bound with an empty dependency set never expires' },
    );
  }

  return { policy: declaration.policy };
}

/** Has the stored window closed? Pure; the clock is supplied, never read. */
export function isExpired(freshness: SealedFreshness, nowMs: number): boolean {
  const expiresAt = freshness.expiresAt;
  if (expiresAt === undefined) return false;
  return nowMs >= expiresAt;
}
