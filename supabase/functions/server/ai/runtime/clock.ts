/**
 * Time access for the AI Control Plane.
 *
 * Rate limit windows, circuit breaker cool-downs, budget windows, latency
 * measurement and audit timestamps all read time through this interface. That
 * makes every one of those behaviours testable deterministically — no sleeps,
 * no flakes, no wall-clock assumptions in the test suite.
 */

export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
  /** ISO-8601 timestamp for the current instant. */
  isoNow(): string;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  isoNow: () => new Date().toISOString(),
};

/** A clock tests drive by hand. Starts at a fixed, readable instant. */
export interface MutableClock extends Clock {
  advance(ms: number): void;
  set(ms: number): void;
}

export function createTestClock(startMs = Date.UTC(2026, 0, 1, 0, 0, 0)): MutableClock {
  let current = startMs;
  return {
    now: () => current,
    isoNow: () => new Date(current).toISOString(),
    advance: (ms: number) => {
      current += ms;
    },
    set: (ms: number) => {
      current = ms;
    },
  };
}
