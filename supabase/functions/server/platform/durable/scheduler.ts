/**
 * The scheduler tick (BP-002 §10, CHECKPOINT 6).
 *
 * WHAT A TICK DOES, IN ORDER, AND WHY THAT ORDER:
 *
 *   1. recover abandoned leases   so work a dead isolate was holding becomes
 *                                 claimable BEFORE this pass looks for work,
 *                                 rather than a pass later
 *   2. materialize due schedules  so occurrences that came due are in the queue
 *                                 before the drain that would otherwise miss
 *                                 them by milliseconds
 *   3. drain the queue            run what is due
 *   4. dispatch the outbox        publish what the drain produced, in the same
 *                                 tick, so a fact is not a tick behind its
 *                                 cause
 *
 * Any other order costs a tick somewhere, and a tick is however often the
 * platform is invoked — which in a serverless deployment is not a small number
 * of milliseconds.
 *
 * ── THIS IS A RUNTIME, AND IT IS NOT SCHEDULED ────────────────────────────
 *
 * BP-002 §10 draws the line explicitly: implement the scheduler runtime and its
 * tests; do NOT configure production cron or stand up a scheduler service. So
 * `tick` is a function the existing Edge/server environment can call when
 * deployment is later authorized, and nothing in this repository calls it on a
 * timer. There is no cron entry, no `Deno.cron`, no interval, and no
 * self-invoking loop — and their absence is asserted by the boundary scan
 * rather than left to review.
 *
 * ── REPEATED AND RACING TICKS ARE BOTH SAFE ───────────────────────────────
 *
 * Because neither of the two guards against a duplicate occurrence lives here.
 * The compare-and-swap on `materializeVersion` and the unique idempotency key
 * are both in the store, which is where the atomicity is. A tick that runs
 * twice, or twice at once, does the same work twice and produces one
 * occurrence — which is the property that lets an operator invoke the endpoint
 * without first checking whether it is already running.
 */

import type { ScheduleOccurrence } from './contracts.ts';
import type { DurableStores } from './ports.ts';
import type { JobPassResult, JobWorker } from './worker.ts';
import type { EventDispatcher, DispatchPassResult } from './dispatcher.ts';

export interface SchedulerDependencies {
  readonly stores: DurableStores;
  readonly worker: JobWorker;
  readonly nowIso: () => string;
  readonly dispatcher?: EventDispatcher;
  /** Jobs to run in one tick. Bounded so a tick cannot run unboundedly long. */
  readonly maxJobsPerTick?: number;
  readonly maxSchedulesPerTick?: number;
  readonly maxEventsPerTick?: number;
  readonly recoverLimit?: number;
}

export interface SchedulerTickResult {
  readonly at: string;
  readonly organizationId: string;
  readonly recovered: number;
  readonly deadLetteredByRecovery: number;
  /** Dispatch leases returned to pending by this tick. */
  readonly dispatchRecovered: number;
  readonly dispatchDeadLettered: number;
  /** Abandoned consumer claims released to `failed` by this tick. */
  readonly consumerClaimsRecovered: number;
  readonly occurrences: readonly ScheduleOccurrence[];
  readonly jobs: readonly JobPassResult[];
  readonly dispatched: readonly DispatchPassResult[];
}

export interface Scheduler {
  tick(organizationId: string): Promise<SchedulerTickResult>;
  /** Materialize only. Exposed so a test can prove occurrence semantics alone. */
  materialize(organizationId: string): Promise<readonly ScheduleOccurrence[]>;
}

export function createScheduler(deps: SchedulerDependencies): Scheduler {
  const maxJobs = deps.maxJobsPerTick ?? 25;
  const maxSchedules = deps.maxSchedulesPerTick ?? 50;
  const maxEvents = deps.maxEventsPerTick ?? 50;
  const recoverLimit = deps.recoverLimit ?? 100;

  return {
    async materialize(organizationId) {
      return deps.stores.schedules.materializeDue(organizationId, deps.nowIso(), maxSchedules);
    },

    async tick(organizationId) {
      const at = deps.nowIso();

      // 1. Recovery first — see the header. All three sweeps, because a job,
      //    a dispatch and a consumer claim are three different things that a
      //    dying isolate can strand, and sweeping only the first leaves the
      //    other two stranded forever.
      const recovery = await deps.worker.recover(recoverLimit);
      const dispatchRecovery = deps.dispatcher
        ? await deps.dispatcher.recover(recoverLimit)
        : { recovered: 0, deadLettered: 0 };
      const consumerRecovery = await deps.stores.inbox.recoverExpiredClaims(at, recoverLimit);

      // 2. Due occurrences become queued jobs.
      const occurrences = await deps.stores.schedules.materializeDue(
        organizationId,
        at,
        maxSchedules,
      );

      // 3. Run what is due. `drain` stops as soon as nothing is claimable, so a
      //    quiet tenant costs one claim attempt rather than `maxJobs` of them.
      const jobs = await deps.worker.drain(organizationId, maxJobs);

      // 4. Publish what the drain produced, in this same tick.
      const dispatched = deps.dispatcher
        ? await deps.dispatcher.drain(organizationId, maxEvents)
        : [];

      return {
        at,
        organizationId,
        recovered: recovery.recovered,
        deadLetteredByRecovery: recovery.deadLettered,
        dispatchRecovered: dispatchRecovery.recovered,
        dispatchDeadLettered: dispatchRecovery.deadLettered,
        consumerClaimsRecovered: consumerRecovery,
        occurrences,
        jobs,
        dispatched,
      };
    },
  };
}
