/**
 * AI rate limiting.
 *
 * A sliding-window counter keyed by scope. Two independent limits apply to every
 * AI request — per actor and per organization — so one user cannot exhaust their
 * tenant's allowance and one tenant cannot exhaust the platform's.
 *
 * Sliding window rather than fixed window: a fixed window lets a caller send
 * `2 × limit` requests across a window boundary, which is exactly the burst the
 * limiter exists to prevent. The trade is bounded memory per scope, which the
 * sweep below keeps in check.
 *
 * Time comes from an injected `Clock`, so every limit boundary is tested
 * deterministically instead of with sleeps.
 */

import type { Clock } from '../runtime/clock.ts';
import type { AIRateLimitRule } from '../contracts/policy.ts';

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** Epoch millis when the oldest counted hit leaves the window. */
  readonly resetAtMs: number;
  readonly retryAfterSeconds: number;
}

export interface RateLimiter {
  /** Record a hit and decide. Call once per request per scope. */
  consume(scope: string, rule: AIRateLimitRule): RateLimitDecision;
  /** Decide without recording. Used by diagnostics, never by the guard. */
  peek(scope: string, rule: AIRateLimitRule): RateLimitDecision;
  /** Drop expired scopes. Idempotent; safe to call on any cadence. */
  sweep(): number;
  /** Number of tracked scopes. Exposed for the health endpoint. */
  size(): number;
}

/**
 * Guards against unbounded growth if a caller rotates scope keys. When the cap
 * is hit the oldest scope is evicted, which can only ever make the limiter more
 * permissive for that one evicted scope — never for the scope being checked.
 */
const MAX_TRACKED_SCOPES = 20_000;

export function createSlidingWindowRateLimiter(clock: Clock): RateLimiter {
  /** scope → ascending timestamps of hits still inside the widest window. */
  const hits = new Map<string, number[]>();

  function prune(scope: string, windowMs: number, nowMs: number): number[] {
    const timestamps = hits.get(scope);
    if (!timestamps) return [];
    const cutoff = nowMs - windowMs;
    let firstLive = 0;
    while (firstLive < timestamps.length && timestamps[firstLive] <= cutoff) firstLive += 1;
    const live = firstLive === 0 ? timestamps : timestamps.slice(firstLive);
    if (live.length === 0) hits.delete(scope);
    else hits.set(scope, live);
    return live;
  }

  function decide(live: readonly number[], rule: AIRateLimitRule, nowMs: number): RateLimitDecision {
    const allowed = live.length <= rule.limit;
    const oldest = live.length > 0 ? live[0] : nowMs;
    const resetAtMs = oldest + rule.windowMs;
    return {
      allowed,
      limit: rule.limit,
      remaining: Math.max(0, rule.limit - live.length),
      resetAtMs,
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000)),
    };
  }

  return {
    consume(scope, rule) {
      const nowMs = clock.now();
      const live = prune(scope, rule.windowMs, nowMs);

      if (!hits.has(scope) && hits.size >= MAX_TRACKED_SCOPES) {
        const oldestScope = hits.keys().next().value;
        if (oldestScope !== undefined) hits.delete(oldestScope);
      }

      const updated = [...live, nowMs];
      hits.set(scope, updated);
      return decide(updated, rule, nowMs);
    },

    peek(scope, rule) {
      const nowMs = clock.now();
      const live = prune(scope, rule.windowMs, nowMs);
      return decide(live, rule, nowMs);
    },

    sweep() {
      const nowMs = clock.now();
      let removed = 0;
      for (const [scope, timestamps] of hits) {
        // A scope with no hit in the last hour cannot affect any rule the
        // catalog declares; the widest supported window is one hour.
        if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= nowMs - 3_600_000) {
          hits.delete(scope);
          removed += 1;
        }
      }
      return removed;
    },

    size() {
      return hits.size;
    },
  };
}

/** Scope keys. Kept here so the shape is identical everywhere it is used. */
export const rateLimitScope = {
  actor: (organizationId: string, actorId: string, featureId: string): string =>
    `actor:${organizationId}:${actorId}:${featureId}`,
  organization: (organizationId: string, featureId: string): string =>
    `org:${organizationId}:${featureId}`,
};
