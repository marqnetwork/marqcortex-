/**
 * Circuit breaker, per provider.
 *
 * When a provider starts failing, continuing to send it traffic is worse than
 * useless: every request pays the full timeout before failing, the caller waits
 * seconds for a certain failure, and the provider's own recovery is slowed by
 * load it cannot serve. The breaker turns that into an immediate, cheap failure
 * that the selector can route around.
 *
 * Three states:
 *   closed     — normal. Consecutive failures accumulate toward the threshold.
 *   open       — the provider is skipped entirely until the cool-down elapses.
 *   half_open  — one probe at a time. Enough consecutive successes close the
 *                circuit; a single failure re-opens it with a fresh cool-down.
 *
 * The half-open state admits probes one at a time rather than all waiting
 * traffic. Releasing everything at once against a provider that has not actually
 * recovered re-creates the original overload, which is the failure mode the
 * breaker exists to prevent.
 *
 * Time is injected, so every transition is tested deterministically.
 */

import type { Clock } from '../runtime/clock.ts';

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitOptions {
  readonly failureThreshold: number;
  readonly openMs: number;
  readonly halfOpenSuccessesToClose: number;
}

export interface CircuitSnapshot {
  readonly state: CircuitState;
  readonly consecutiveFailures: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly openedAtMs?: number;
  readonly opensUntilMs?: number;
}

export interface CircuitBreaker {
  /** Whether a request may be sent to this provider now. */
  canAttempt(providerId: string): boolean;
  /** State after accounting for elapsed cool-down. */
  stateOf(providerId: string): CircuitState;
  recordSuccess(providerId: string): void;
  /** Returns true when this failure opened a previously closed circuit. */
  recordFailure(providerId: string): boolean;
  snapshot(providerId: string): CircuitSnapshot;
  reset(providerId?: string): void;
}

interface CircuitRecord {
  state: CircuitState;
  consecutiveFailures: number;
  halfOpenSuccesses: number;
  /** True while a half-open probe is in flight, so only one is admitted. */
  probeInFlight: boolean;
  successCount: number;
  failureCount: number;
  openedAtMs?: number;
}

export function createCircuitBreaker(clock: Clock, options: CircuitOptions): CircuitBreaker {
  const circuits = new Map<string, CircuitRecord>();

  function record(providerId: string): CircuitRecord {
    let entry = circuits.get(providerId);
    if (!entry) {
      entry = {
        state: 'closed',
        consecutiveFailures: 0,
        halfOpenSuccesses: 0,
        probeInFlight: false,
        successCount: 0,
        failureCount: 0,
      };
      circuits.set(providerId, entry);
    }
    return entry;
  }

  /** Promote open → half_open once the cool-down has elapsed. */
  function settle(entry: CircuitRecord): CircuitRecord {
    if (entry.state === 'open' && entry.openedAtMs !== undefined) {
      if (clock.now() - entry.openedAtMs >= options.openMs) {
        entry.state = 'half_open';
        entry.halfOpenSuccesses = 0;
        entry.probeInFlight = false;
      }
    }
    return entry;
  }

  return {
    canAttempt(providerId) {
      const entry = settle(record(providerId));
      if (entry.state === 'closed') return true;
      if (entry.state === 'open') return false;
      if (entry.probeInFlight) return false;
      entry.probeInFlight = true;
      return true;
    },

    stateOf(providerId) {
      return settle(record(providerId)).state;
    },

    recordSuccess(providerId) {
      const entry = settle(record(providerId));
      entry.successCount += 1;
      entry.consecutiveFailures = 0;
      entry.probeInFlight = false;
      if (entry.state === 'half_open') {
        entry.halfOpenSuccesses += 1;
        if (entry.halfOpenSuccesses >= options.halfOpenSuccessesToClose) {
          entry.state = 'closed';
          entry.halfOpenSuccesses = 0;
          entry.openedAtMs = undefined;
        }
        return;
      }
      entry.state = 'closed';
      entry.openedAtMs = undefined;
    },

    recordFailure(providerId) {
      const entry = settle(record(providerId));
      entry.failureCount += 1;
      entry.consecutiveFailures += 1;
      entry.probeInFlight = false;

      // A failed probe means the provider has not recovered. Re-open
      // immediately with a fresh cool-down rather than letting more probes
      // through on the strength of one threshold count.
      if (entry.state === 'half_open') {
        entry.state = 'open';
        entry.openedAtMs = clock.now();
        entry.halfOpenSuccesses = 0;
        return true;
      }

      if (entry.state === 'closed' && entry.consecutiveFailures >= options.failureThreshold) {
        entry.state = 'open';
        entry.openedAtMs = clock.now();
        return true;
      }
      return false;
    },

    snapshot(providerId) {
      const entry = settle(record(providerId));
      return {
        state: entry.state,
        consecutiveFailures: entry.consecutiveFailures,
        successCount: entry.successCount,
        failureCount: entry.failureCount,
        openedAtMs: entry.openedAtMs,
        opensUntilMs: entry.openedAtMs === undefined ? undefined : entry.openedAtMs + options.openMs,
      };
    },

    reset(providerId) {
      if (providerId) circuits.delete(providerId);
      else circuits.clear();
    },
  };
}
