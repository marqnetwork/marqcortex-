/**
 * Lease rules (BP-002 §8).
 *
 * PURE PREDICATES OVER A JOB AND AN INSTANT. Nothing here writes; the writes
 * are the SQL functions in `20260919120002`, and these are the same rules
 * stated where a test can hit them without a database, and where the in-memory
 * store can enforce them identically. Both halves must agree, and the way to
 * make them agree is to have the rules in one readable place rather than
 * embedded twice in two dialects.
 *
 * ── WHY GENERATION AND NOT JUST OWNER ─────────────────────────────────────
 *
 * This is the subtle one, and it is the reason `leaseGeneration` exists at all.
 *
 * Worker A claims job J and stalls — a slow provider, a paused isolate, a lost
 * network. A's lease expires. Recovery returns J to the queue. A claims it
 * AGAIN, gets a fresh lease, and finishes. Meanwhile A's first execution wakes
 * up and settles.
 *
 * If the settle checked only the owner, it would pass: the owner is "A" in both
 * leases. A stale result would overwrite a newer one, written by the same
 * worker, and nothing would look wrong. BP-002 §8.8 forbids exactly this.
 *
 * The generation is bumped on every claim and never reused, so the two leases
 * are distinguishable even though the owner is identical. Every settle carries
 * the generation it was claimed at, and the stale one loses.
 */

import type { DurableJob, JobLease } from './contracts.ts';
import { instantMs } from './guards.ts';

/**
 * Whether this job could be handed to a worker right now.
 *
 * FOUR CONDITIONS, AND EACH ONE REFUSES SOMETHING DIFFERENT:
 *
 *   state `queued`        not running, not paused, not terminal
 *   availableAt <= now    delayed work waits, backoff waits
 *   attempt < maxAttempts a job at its ceiling is not tried again
 *   tenant matches        another organization's work is not visible, let
 *                         alone claimable
 *
 * An UNREADABLE `availableAt` makes the job unclaimable rather than
 * immediately claimable. That is the opposite of what
 * `retryDelayRemainingMs` does in the workflow engine, and the difference is
 * deliberate: there, an unreadable stamp would strand a LIVE RUN forever, so
 * the conservative direction is to let it proceed under its own deadline. Here,
 * an unreadable stamp on a queued job means the row is corrupt, and running
 * corrupt work is worse than leaving it for an operator to find.
 */
export function isClaimable(job: DurableJob, organizationId: string, nowMs: number): boolean {
  if (job.organizationId !== organizationId) return false;
  if (job.state !== 'queued') return false;
  if (job.attempt >= job.maxAttempts) return false;
  const availableMs = instantMs(job.availableAt);
  if (availableMs === undefined) return false;
  return availableMs <= nowMs;
}

/**
 * The deterministic claim order: cheapest, then oldest-due, then oldest.
 *
 * `createdAt` is the tie-break and it is not decoration. Without it, two jobs
 * at the same priority and the same `availableAt` come back in whatever order
 * the store produces, and one of them can sit behind an endless supply of
 * equals — BP-002 §8.10's starvation case. The SQL `ORDER BY` in
 * `durable_job_claim` is this same triple, so the in-memory store and the
 * database hand out work in the same order.
 */
export function compareClaimOrder(a: DurableJob, b: DurableJob): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  const aAvailable = instantMs(a.availableAt) ?? Number.MAX_SAFE_INTEGER;
  const bAvailable = instantMs(b.availableAt) ?? Number.MAX_SAFE_INTEGER;
  if (aAvailable !== bAvailable) return aAvailable - bAvailable;
  const aCreated = instantMs(a.createdAt) ?? 0;
  const bCreated = instantMs(b.createdAt) ?? 0;
  if (aCreated !== bCreated) return aCreated - bCreated;
  // Last resort, so the order is total rather than merely mostly-defined.
  return a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0;
}

/** True when this job's lease has lapsed and it may be recovered. */
export function isLeaseExpired(job: DurableJob, nowMs: number): boolean {
  if (job.state !== 'leased') return false;
  const expiresMs = instantMs(job.leaseExpiresAt);
  // An unreadable expiry on a leased job is treated as EXPIRED. A lease nobody
  // can read the end of is a lease that can never be recovered, and a job
  // permanently `leased` is a job permanently lost — the worse of the two
  // failure modes, since the recovered job simply runs again.
  if (expiresMs === undefined) return true;
  return expiresMs <= nowMs;
}

/**
 * True when this lease is the one the job is currently under.
 *
 * Tenant, owner, generation and expiry — all four. See the header for why owner
 * alone is not enough, and `durable_job_heartbeat`'s comment for why an expired
 * lease loses even before recovery has run: otherwise the outcome depends on
 * whether the sweep happened to have fired, which is a race dressed up as a
 * policy.
 */
export function holdsLiveLease(job: DurableJob, lease: JobLease, nowMs: number): boolean {
  if (job.organizationId !== lease.organizationId) return false;
  if (job.jobId !== lease.jobId) return false;
  if (job.state !== 'leased') return false;
  if (job.leaseOwner !== lease.owner) return false;
  if (job.leaseGeneration !== lease.generation) return false;
  const expiresMs = instantMs(job.leaseExpiresAt);
  if (expiresMs === undefined) return false;
  return expiresMs > nowMs;
}

/**
 * True when this lease was once live and has since been superseded.
 *
 * Used for REPORTING rather than for deciding — `holdsLiveLease` already
 * decides. It exists so a refusal can say "your lease was replaced by
 * generation 4" instead of "refused", which is the difference between an
 * operator diagnosing a stalled worker in a minute and in an afternoon.
 */
export function isStaleLease(job: DurableJob, lease: JobLease): boolean {
  if (job.jobId !== lease.jobId) return false;
  if (job.organizationId !== lease.organizationId) return false;
  return job.leaseGeneration > lease.generation;
}

/** The lease a claim hands out. */
export function leaseFor(job: DurableJob): JobLease | undefined {
  if (job.state !== 'leased' || job.leaseOwner === undefined || job.leaseExpiresAt === undefined) {
    return undefined;
  }
  return {
    jobId: job.jobId,
    organizationId: job.organizationId,
    owner: job.leaseOwner,
    generation: job.leaseGeneration,
    expiresAt: job.leaseExpiresAt,
  };
}
