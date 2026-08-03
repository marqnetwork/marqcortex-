/**
 * Retry policy and delay scheduling.
 *
 * Exponential backoff with full-proportion jitter, bounded by a maximum delay.
 * Jitter is not decoration: without it, a provider blip synchronises every edge
 * instance's retry into a single spike at exactly the moment the provider is
 * least able to absorb one. Jitter spreads the retry storm across the window.
 *
 * Only errors the taxonomy marks retryable are retried. A validation failure or
 * a missing credential will fail identically on every attempt, and retrying it
 * only multiplies latency and cost.
 *
 * `sleep` and the random source are injected so backoff is tested without
 * wall-clock waits or flakes.
 */

import type { AIError } from '../contracts/errors.ts';

export interface RetryOptions {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  /** Proportion of the computed delay that is randomised, 0–100. */
  readonly jitterPercent: number;
}

export interface RetryScheduler {
  /**
   * Delay before `attempt` (1-based). Attempt 1 never waits.
   *
   * `retryAfterSeconds` is the value a provider sent on a 429 or 503. When
   * present it wins over the computed backoff: the provider knows when it will
   * accept traffic again, and guessing shorter simply earns another rejection.
   * It is still bounded by `maxDelayMs` — a provider asking for an hour must not
   * hold an edge invocation open for one.
   */
  delayFor(attempt: number, options: RetryOptions, retryAfterSeconds?: number): number;
  wait(ms: number): Promise<void>;
}

export type RandomSource = () => number;
export type SleepFn = (ms: number) => Promise<void>;

export function createRetryScheduler(
  sleep: SleepFn = defaultSleep,
  random: RandomSource = Math.random,
): RetryScheduler {
  return {
    delayFor(attempt, options, retryAfterSeconds) {
      if (attempt <= 1) return 0;

      if (retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        // Honoured as stated, with jitter still applied on top so a fleet of
        // instances told "retry in 2s" does not resume in lockstep.
        const requested = Math.min(retryAfterSeconds * 1_000, options.maxDelayMs);
        const spread = (requested * Math.min(100, Math.max(0, options.jitterPercent))) / 100;
        return Math.max(0, Math.round(requested + random() * spread));
      }

      const exponential = options.baseDelayMs * 2 ** (attempt - 2);
      const capped = Math.min(exponential, options.maxDelayMs);
      const jitterRange = (capped * Math.min(100, Math.max(0, options.jitterPercent))) / 100;
      // Centred jitter: the expected delay stays at `capped`, so backoff still
      // grows as intended rather than being biased downward.
      const offset = (random() - 0.5) * 2 * jitterRange;
      return Math.max(0, Math.round(capped + offset));
    },
    wait: (ms) => (ms <= 0 ? Promise.resolve() : sleep(ms)),
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when another attempt against the same provider is worth making. */
export function shouldRetrySameProvider(error: AIError, attempt: number, maxAttempts: number): boolean {
  if (attempt >= maxAttempts) return false;
  return error.retryable;
}

/** True when a different provider is worth trying for this failure. */
export function shouldFailover(error: AIError): boolean {
  return error.failoverable;
}
