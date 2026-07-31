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
  /** Delay before `attempt` (1-based). Attempt 1 never waits. */
  delayFor(attempt: number, options: RetryOptions): number;
  wait(ms: number): Promise<void>;
}

export type RandomSource = () => number;
export type SleepFn = (ms: number) => Promise<void>;

export function createRetryScheduler(
  sleep: SleepFn = defaultSleep,
  random: RandomSource = Math.random,
): RetryScheduler {
  return {
    delayFor(attempt, options) {
      if (attempt <= 1) return 0;
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
