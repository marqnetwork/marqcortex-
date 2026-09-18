/**
 * Operational measures for the durable runtime (BP-002 §13).
 *
 * WHAT AN OPERATOR NEEDS TO ANSWER "IS THE BACKGROUND WORK HEALTHY", and
 * nothing else. Each number here is one somebody would act on:
 *
 *   queued / due          work waiting, and work waiting that should not be
 *   leased                work in flight — and, if it never falls, work stuck
 *   deadLetter            work the platform has given up on
 *   outboxPending         facts not yet delivered
 *   oldestPendingAgeMs    THE ONE THAT MATTERS MOST. A backlog of 200 that is
 *                         two seconds old is a busy platform; a backlog of 3
 *                         that is two hours old is a broken dispatcher, and a
 *                         count alone cannot tell them apart.
 *
 * ── WHY THIS IS A SNAPSHOT AND NOT A METRICS CLIENT ───────────────────────
 *
 * BP-002 §13 says to reuse the existing logger/metrics/audit architecture and
 * not to create a parallel one. This folder cannot import the existing one — it
 * may not reach into `ai/**` — so it computes the numbers and hands them over.
 * Whoever composes the runtime feeds them to the metrics surface that already
 * exists. A metrics client here would be the parallel system the packet forbids.
 *
 * ── EVERY COUNT IS TENANT-SCOPED EXCEPT THE TWO THAT CANNOT BE ────────────
 *
 * `oldestPendingAgeMs` and the platform outbox depth are properties of the
 * PLATFORM: a dispatcher that has stopped has stopped for everybody, and a
 * measure that had to be read once per tenant would miss exactly the tenant
 * nobody thought to look at. They are separate fields with separate names so
 * that "this number crosses tenants" is visible rather than implied.
 */

import type { DeadLetterRecord, JobState } from './contracts.ts';
import type { DurableStores } from './ports.ts';
import { instantMs } from './guards.ts';

export interface DurableRuntimeSnapshot {
  readonly at: string;
  readonly organizationId: string;
  readonly jobs: Readonly<Record<JobState, number>>;
  /** Queued AND available now. The queue an operator actually feels. */
  readonly due: number;
  /** Queued but not yet available — delayed work and work waiting out a backoff. */
  readonly waiting: number;
  readonly retrying: number;
  readonly schedulesActive: number;
  readonly outboxPending: number;
  readonly deadLetterOpen: number;
  readonly inboxRecorded: number;
  /** Platform-wide. See the header for why this one is not tenant-scoped. */
  readonly platformOutboxPending: number;
  readonly oldestPendingAgeMs?: number;
}

export async function durableRuntimeSnapshot(
  stores: DurableStores,
  organizationId: string,
  nowIso: string,
): Promise<DurableRuntimeSnapshot> {
  const nowMs = instantMs(nowIso) ?? Date.now();

  // A generous ceiling rather than an unbounded read: a snapshot that walks a
  // million rows is a snapshot that takes the platform down when it is already
  // struggling, which is precisely when somebody asks for it.
  const jobs = await stores.jobs.list({ organizationId, limit: 500 });

  const counts: Record<JobState, number> = {
    queued: 0,
    leased: 0,
    succeeded: 0,
    dead_letter: 0,
    paused: 0,
    cancelled: 0,
  };

  let due = 0;
  let waiting = 0;
  let retrying = 0;

  for (const job of jobs) {
    counts[job.state] += 1;
    if (job.state !== 'queued') continue;
    const availableMs = instantMs(job.availableAt);
    if (availableMs !== undefined && availableMs <= nowMs) due += 1;
    else waiting += 1;
    // A queued job that has already been attempted is one waiting out a
    // backoff. Counted separately because a rising number here means work is
    // failing, while a rising `waiting` may just mean work was scheduled.
    if (job.attempt > 0) retrying += 1;
  }

  const schedules = await stores.schedules.list(organizationId, 500);
  const deadLetters: readonly DeadLetterRecord[] = await stores.jobs.deadLetters({
    organizationId,
    unrecoveredOnly: true,
    limit: 500,
  });

  const oldestPendingAt = await stores.outbox.oldestPendingAt();
  const oldestMs = oldestPendingAt === undefined ? undefined : instantMs(oldestPendingAt);

  return {
    at: nowIso,
    organizationId,
    jobs: counts,
    due,
    waiting,
    retrying,
    schedulesActive: schedules.filter((schedule) => schedule.status === 'active').length,
    outboxPending: await stores.outbox.pendingCount(organizationId),
    deadLetterOpen: deadLetters.length,
    inboxRecorded: await stores.inbox.count(organizationId),
    platformOutboxPending: await stores.outbox.pendingCount(),
    ...(oldestMs === undefined ? {} : { oldestPendingAgeMs: Math.max(0, nowMs - oldestMs) }),
  };
}
