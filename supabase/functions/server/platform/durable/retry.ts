/**
 * Deterministic bounded backoff (BP-002 §9).
 *
 * Pure and total. No clock is read — the instant arrives as an argument — which
 * is the same shape `ai/workflows/runtime/retryPolicy.ts` takes, for the same
 * reason: a delay a reader can RECOMPUTE from the record is a delay they do not
 * have to trust.
 *
 * ── WHY A SECOND BACKOFF FUNCTION EXISTS AT ALL ───────────────────────────
 *
 * It is a fair question, and the honest answer is that the two compute the same
 * curve over different things. The workflow one takes a `WorkflowRetryPolicy`
 * and answers about re-running a NODE inside a run; this one takes a
 * `JobRetryPolicy` and answers about re-running a JOB. Importing the workflow's
 * version here is not available — this folder may not import `ai/**`, and the
 * whole architectural claim of BP-002 is that the dependency points the other
 * way — and lifting it into the platform would drag `WorkflowRetryPolicy`,
 * `workflowFailure` and the node vocabulary up with it.
 *
 * So the curve is stated twice and the SHAPES ARE DELIBERATELY THE SAME: same
 * three kinds, same "attempt 1 is not a retry", same bounded exponent, same
 * clamp. When A2 consolidates runtime persistence, these become one function
 * over one policy type, and the fact that they already agree is what will make
 * that a rename rather than a behaviour change.
 */

import { JOB_RETRY_BOUNDS, type JobRetryPolicy } from './contracts.ts';

/**
 * How long before `attempt` becomes eligible, in milliseconds.
 *
 * `attempt` is the attempt being SCHEDULED, so it is always at least 2 — the
 * first attempt is not a retry and never waits. Attempt 2 waits `baseMs`, and
 * each further attempt doubles, up to `maxMs`.
 *
 * THE EXPONENT IS BOUNDED BEFORE IT IS USED. `2 ** 4000` is `Infinity`, and an
 * `Infinity` that reached a timestamp would produce an `Invalid Date` on a
 * durable row — a job that can never become due again and that no query for
 * "stuck work" would find, because its `availableAt` is not comparable. The
 * same defect `computeRetryDelayMs` in the workflow engine guards against, and
 * guarded the same way.
 */
export function computeBackoffMs(policy: JobRetryPolicy, attempt: number): number {
  if (policy.kind === 'immediate') return 0;

  const base = clamp(policy.baseMs, JOB_RETRY_BOUNDS.baseMs.min, JOB_RETRY_BOUNDS.baseMs.max);
  const ceiling = Math.max(
    base,
    clamp(policy.maxMs, JOB_RETRY_BOUNDS.maxMs.min, JOB_RETRY_BOUNDS.maxMs.max),
  );

  if (policy.kind === 'fixed') return Math.min(base, ceiling);

  const prior = Math.min(Math.max(0, Math.floor(attempt) - 2), 16);
  return Math.min(base * 2 ** prior, ceiling);
}

/**
 * When the next attempt becomes claimable.
 *
 * Returned as an instant rather than a delay because that is what the row
 * stores. One conversion, here, instead of one at every call site.
 */
export function nextAvailableAt(
  policy: JobRetryPolicy,
  attempt: number,
  nowMs: number,
): string {
  const delay = computeBackoffMs(policy, attempt);
  return new Date(nowMs + delay).toISOString();
}

/**
 * True when the attempt that just ran was the last one the budget allows.
 *
 * `attempt` is the attempt that RAN — the claim incremented it before the
 * handler was called — so `attempt >= maxAttempts` means there is no next one.
 * Reading it as "attempts used" rather than "attempts remaining" is the reading
 * that survives a lease recovery: recovery does not spend an attempt, the claim
 * that handed out the lapsed lease already did, and the count is of tries
 * rather than of reports.
 */
export function attemptsExhausted(attempt: number, maxAttempts: number): boolean {
  return attempt >= Math.max(1, maxAttempts);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
