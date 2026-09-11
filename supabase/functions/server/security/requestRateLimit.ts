/**
 * The edge rate limiter — the one in front of every route, before auth.
 *
 * Distinct from `ai/security/rateLimiter.ts`, which prices AI features per actor
 * and per organization once a caller is known. This one runs earlier and knows
 * nothing about the caller except where the request appeared to come from, so it
 * is the only thing standing between an unauthenticated flood and the handlers.
 *
 * ── WHAT WAS WRONG WITH THE VERSION THIS REPLACES ──────────────────────────
 *
 * It keyed `Map<ip, {count, resetAt}>` on the LEFTMOST `X-Forwarded-For` entry,
 * which is whatever the caller typed. Rotating that header gave every request a
 * fresh bucket, so the limit it was enforcing never bound — the one protection
 * standing in front of unauthenticated routes was a header edit away from off.
 *
 * The same rotation grew the map. A five-minute `setInterval` swept it, so
 * growth was bounded by sweep interval times request rate rather than unbounded
 * — but that still leaves a flood free to add an entry per request for five
 * minutes at a time, which is an attacker-chosen amount of memory in a
 * long-lived isolate.
 *
 * Three things close that:
 *
 *   1. The key comes from `clientAddress`, read from the RIGHT of the forwarding
 *      chain and parsed as an address. A caller can no longer choose it.
 *   2. The map is swept and hard-capped. Growth is bounded whatever arrives.
 *   3. A TOTAL ceiling for the isolate, keyed on nothing, backs the per-caller
 *      limit up. A per-key limiter cannot by construction stop a caller who can
 *      still influence keys — a distributed flood, or a proxy layout where the
 *      chain is passed through rather than appended to. The ceiling sits well
 *      above ordinary traffic so it is a circuit breaker, not a quota.
 *
 * Fixed windows, not sliding: this limiter must cost almost nothing per request
 * and hold almost nothing per caller, and a two-integer bucket does that. The
 * AI plane, where a burst is expensive, pays for a sliding window instead.
 */

import { clientAddress, type HeaderLookup } from './clientAddress.ts';

export interface RequestRateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** Epoch SECONDS at which the window resets — the `X-RateLimit-Reset` value. */
  readonly resetSeconds: number;
  /** Which limit refused, for the log line. `null` when allowed. */
  readonly refusedBy: 'caller' | 'ceiling' | null;
}

export interface RequestRateLimiter {
  check(header: HeaderLookup): RequestRateLimitDecision;
  /** Tracked callers. Exposed so a test and the health endpoint can see the cap hold. */
  size(): number;
}

export interface RequestRateLimitOptions {
  readonly windowMs?: number;
  /** Requests per window per caller. */
  readonly maxPerCaller?: number;
  /** Requests per window for the whole isolate, across all callers. */
  readonly maxTotal?: number;
  /** Hard cap on tracked callers. */
  readonly maxTrackedCallers?: number;
  readonly now?: () => number;
}

export const DEFAULT_WINDOW_MS = 60_000;
export const DEFAULT_MAX_PER_CALLER = 120;

/**
 * Generous on purpose. Ordinary traffic spread across Supabase's isolates never
 * approaches this; a flood concentrated on one does. Refusing real users during
 * a flood is what a limiter is for, but tripping on a busy Tuesday is not, so
 * the number sits an order of magnitude above the per-caller limit.
 */
export const DEFAULT_MAX_TOTAL = 3_000;

/**
 * Eviction can only ever forgive the caller being evicted — never the caller
 * being checked, whose bucket was just touched and is therefore the newest.
 */
export const DEFAULT_MAX_TRACKED_CALLERS = 10_000;

/** The bucket every unidentifiable caller shares. Shared, so it cannot be farmed. */
const UNIDENTIFIED = ' unidentified';

interface Bucket {
  count: number;
  resetAt: number;
}

export function createRequestRateLimiter(
  options: RequestRateLimitOptions = {},
): RequestRateLimiter {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const maxPerCaller = options.maxPerCaller ?? DEFAULT_MAX_PER_CALLER;
  const maxTotal = options.maxTotal ?? DEFAULT_MAX_TOTAL;
  const maxTracked = options.maxTrackedCallers ?? DEFAULT_MAX_TRACKED_CALLERS;
  const now = options.now ?? (() => Date.now());

  // Insertion-ordered, which is what makes the oldest bucket cheap to find.
  const callers = new Map<string, Bucket>();
  let total: Bucket = { count: 0, resetAt: 0 };

  function sweep(nowMs: number): void {
    for (const [key, bucket] of callers) {
      if (nowMs > bucket.resetAt) callers.delete(key);
    }
  }

  function bucketFor(key: string, nowMs: number): Bucket {
    const existing = callers.get(key);
    if (existing && nowMs <= existing.resetAt) return existing;
    if (existing) callers.delete(key);

    if (callers.size >= maxTracked) {
      sweep(nowMs);
      // Still full: drop the oldest inserted. Its window restarting is the cost
      // of a bounded map, and it is bounded itself — one caller per admission.
      if (callers.size >= maxTracked) {
        const oldest = callers.keys().next();
        if (!oldest.done) callers.delete(oldest.value);
      }
    }

    const fresh: Bucket = { count: 0, resetAt: nowMs + windowMs };
    callers.set(key, fresh);
    return fresh;
  }

  return {
    check(header) {
      const nowMs = now();
      const key = clientAddress(header) ?? UNIDENTIFIED;

      if (nowMs > total.resetAt) total = { count: 0, resetAt: nowMs + windowMs };
      total.count++;

      const bucket = bucketFor(key, nowMs);
      bucket.count++;

      const resetSeconds = Math.ceil(bucket.resetAt / 1000);
      const remaining = Math.max(0, maxPerCaller - bucket.count);

      if (bucket.count > maxPerCaller) {
        return {
          allowed: false,
          limit: maxPerCaller,
          remaining: 0,
          resetSeconds,
          refusedBy: 'caller',
        };
      }
      if (total.count > maxTotal) {
        // Reported against the caller's own window so a client's backoff is
        // still correct; the ceiling is an isolate-wide fact it cannot see.
        return {
          allowed: false,
          limit: maxPerCaller,
          remaining,
          resetSeconds,
          refusedBy: 'ceiling',
        };
      }
      return { allowed: true, limit: maxPerCaller, remaining, resetSeconds, refusedBy: null };
    },

    size() {
      return callers.size;
    },
  };
}
