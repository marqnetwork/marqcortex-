/**
 * Recurrence arithmetic (BP-002 §10).
 *
 * ONE FUNCTION, AND THE WHOLE OF THE RECURRENCE MODEL. BP-002 §6.2 says not to
 * build a cron-expression product unless the repository already has one — it
 * does not — and says a deterministic interval is enough to prove recurring
 * scheduling. This is that interval, and nothing more.
 *
 * ── WHY THE NEXT OCCURRENCE IS COMPUTED FROM THE SCHEDULED TIME ───────────
 *
 * The obvious implementation is `now + interval`, and it is wrong in a way that
 * only shows up in production. A tick that runs four minutes late would push
 * every subsequent occurrence four minutes later, and the next late tick would
 * push it again: an hourly schedule drifts by however long the platform was
 * busy, every hour, forever. Nobody can predict when it will fire and nobody
 * notices it has moved.
 *
 * Advancing from the SCHEDULED time keeps the phase. An hourly schedule anchored
 * at :07 fires at :07 whether the tick was punctual or not.
 *
 * ── AND WHY IT CATCHES UP IN WHOLE INTERVALS RATHER THAN ONE AT A TIME ────
 *
 * If the platform was down for a day, an hourly schedule has twenty-four missed
 * occurrences. Materializing all of them means twenty-four simultaneous sweeps
 * the moment the platform returns — a thundering herd caused by the outage,
 * arriving exactly when the platform is least able to absorb it.
 *
 * So the loop SKIPS past whole missed intervals and produces ONE catch-up
 * occurrence, at the next time that is still in the future. The missed ones are
 * not silently pretended to have happened: `lastOccurrenceAt` records which
 * occurrence was actually materialized, and the gap between it and
 * `nextRunAt` is exactly the outage, visible to anyone who looks.
 *
 * This is the same arithmetic `durable_schedule_materialize_due` performs in
 * SQL. Stated twice, deliberately, so the in-memory store and the database
 * advance a schedule identically — and so the rule can be tested without one.
 */

import { JOB_RETRY_BOUNDS } from './contracts.ts';
import { instantMs } from './guards.ts';

/** The floor a recurrence may not go below. A schedule faster than this is a loop. */
export const MIN_RECURRENCE_MS = 60_000;
/** A little over a leap year. Beyond this, "recurring" is not the right model. */
export const MAX_RECURRENCE_MS = 31_622_400_000;

/**
 * The next occurrence strictly after `nowMs`, advancing from `occurrenceMs`.
 *
 * Returns `undefined` for a one-time schedule (no interval) and for an interval
 * that cannot be honoured — out of range, non-finite, not a number. Undefined
 * means "this schedule does not recur", which the caller turns into
 * `completed`; it deliberately does not mean "use a default", because a
 * schedule that silently acquired an interval nobody asked for would fire work
 * nobody scheduled.
 */
export function nextOccurrenceMs(
  occurrenceMs: number,
  intervalMs: number | undefined,
  nowMs: number,
): number | undefined {
  if (intervalMs === undefined) return undefined;
  if (!Number.isFinite(intervalMs)) return undefined;
  const interval = Math.floor(intervalMs);
  if (interval < MIN_RECURRENCE_MS || interval > MAX_RECURRENCE_MS) return undefined;

  let next = occurrenceMs + interval;
  if (next > nowMs) return next;

  // Jump the whole gap in one step rather than looping. An outage of a year at
  // a one-minute interval is half a million iterations, and a scheduler tick
  // that takes half a million iterations to compute one timestamp is a
  // scheduler tick that times out — turning a recoverable outage into a
  // permanently stuck schedule.
  const missed = Math.floor((nowMs - next) / interval) + 1;
  next += missed * interval;
  // The arithmetic above lands strictly after `nowMs` for every finite input;
  // the loop is the belt to its braces, bounded so a pathological input cannot
  // spin.
  let guard = 0;
  while (next <= nowMs && guard < 64) {
    next += interval;
    guard += 1;
  }
  return next > nowMs ? next : undefined;
}

/** The same answer as an instant, for the field that stores one. */
export function nextOccurrenceAt(
  occurrenceAt: string,
  intervalMs: number | undefined,
  nowMs: number,
): string | undefined {
  const occurrenceMs = instantMs(occurrenceAt);
  if (occurrenceMs === undefined) return undefined;
  const next = nextOccurrenceMs(occurrenceMs, intervalMs, nowMs);
  return next === undefined ? undefined : new Date(next).toISOString();
}

/**
 * The idempotency key for one occurrence of one schedule.
 *
 * THE SECOND OF THE TWO GUARDS AGAINST A DUPLICATE OCCURRENCE — the first being
 * the compare-and-swap on `materializeVersion`. Belt and braces on purpose: the
 * CAS makes the common case cheap, and this unique key makes the guarantee true
 * rather than likely. A duplicate occurrence is not a performance problem, it
 * is the same work running twice.
 *
 * Built from the schedule id and the occurrence instant, so it is the same
 * string however many ticks compute it and whichever isolate they run in. The
 * SQL function builds the identical string; they are asserted equal by the
 * migration's static test.
 */
export function occurrenceIdempotencyKey(scheduleId: string, occurrenceAt: string): string {
  return `schedule:${scheduleId}:${occurrenceAt}`;
}

/** Re-exported so callers bound a recurrence without importing two modules. */
export const RECURRENCE_BOUNDS = {
  minMs: MIN_RECURRENCE_MS,
  maxMs: MAX_RECURRENCE_MS,
  maxAttempts: JOB_RETRY_BOUNDS.maxAttempts,
} as const;
