/**
 * Outbox dispatch (BP-002 §12, CHECKPOINT 7).
 *
 * The producer half — writing the event in the same transaction as the state
 * change — is `durable_job_settle` and `DurableJobStore.settle`. This is the
 * other half: taking durable facts and delivering them.
 *
 * ── WHAT "DELIVERY" MEANS HERE, AND WHAT IT DOES NOT ──────────────────────
 *
 * BP-002 §12 says not to introduce a network broker merely to prove idempotent
 * consumption, so a `EventSubscriber` is an in-process function. That is a real
 * limitation and it is stated rather than papered over: a consumer in another
 * process, another region or another service is a later packet, and it lands
 * behind this same interface — the dispatcher does not know or care whether a
 * subscriber writes a row or posts to a queue.
 *
 * What is NOT a limitation is the durability. The event is committed to
 * Postgres before any subscriber sees it, it is leased while being delivered,
 * a failed delivery is retried with the same event id, and an exhausted one
 * reaches the dead-letter table. Those properties do not depend on where the
 * subscriber runs.
 *
 * ── THE EVENT ID IS NEVER RE-MINTED ───────────────────────────────────────
 *
 * BP-002 §17.22. It cannot be, structurally: the id is the outbox row's primary
 * key, minted once by the emitter and read back on every dispatch attempt.
 * There is no code path here that could produce a new one, because there is no
 * code path here that produces an id at all.
 *
 * ── LEASES, AGAIN, AND FOR THE SAME REASON ────────────────────────────────
 *
 * Two dispatchers running at once must not both deliver one event. The outbox
 * carries the same owner-plus-generation lease a job does, `claimPending`
 * bumps the generation, and `markDispatched` refuses a generation that is not
 * the live one. The reasoning is `lease.ts`'s and is not repeated.
 */

import { DURABLE_FAILURE, type DomainEventRecord } from './contracts.ts';
import type { OutboxStore } from './ports.ts';
import { computeBackoffMs } from './retry.ts';
import { instantMs } from './guards.ts';
import { DEFAULT_JOB_RETRY_POLICY } from './contracts.ts';

/**
 * Something that wants to hear about facts.
 *
 * `eventTypes` is an allow-list rather than a filter applied afterwards,
 * because a subscriber that receives everything and ignores most of it is a
 * subscriber whose blast radius nobody can state. `*` is permitted and means
 * what it says — used by the audit-style consumers that legitimately want
 * everything.
 */
export interface EventSubscriber {
  readonly consumerKey: string;
  readonly eventTypes: readonly string[];
  deliver(event: DomainEventRecord): Promise<void>;
}

export interface EventDispatcherDependencies {
  readonly outbox: OutboxStore;
  readonly subscribers: readonly EventSubscriber[];
  readonly nowIso: () => string;
  readonly workerId: string;
  readonly leaseTtlMs?: number;
}

export interface DispatchPassResult {
  readonly eventId: string;
  readonly eventType: string;
  readonly delivered: number;
  readonly failed: number;
  readonly outcome: 'dispatched' | 'retry' | 'dead_letter';
  readonly failureCode?: string;
}

export interface EventDispatcher {
  drain(organizationId: string, max: number): Promise<readonly DispatchPassResult[]>;
  subscribersFor(eventType: string): readonly EventSubscriber[];
}

export function createEventDispatcher(
  deps: EventDispatcherDependencies,
): EventDispatcher {
  const leaseTtlMs = deps.leaseTtlMs ?? 30_000;

  function subscribersFor(eventType: string): readonly EventSubscriber[] {
    return deps.subscribers.filter(
      (subscriber) =>
        subscriber.eventTypes.includes('*') || subscriber.eventTypes.includes(eventType),
    );
  }

  return {
    subscribersFor,

    async drain(organizationId, max) {
      const claimed = await deps.outbox.claimPending(
        organizationId,
        deps.workerId,
        leaseTtlMs,
        deps.nowIso(),
        max,
      );

      const results: DispatchPassResult[] = [];

      for (const event of claimed) {
        const targets = subscribersFor(event.eventType);
        let delivered = 0;
        let failed = 0;
        let firstFailure: string | undefined;

        for (const subscriber of targets) {
          try {
            await subscriber.deliver(event);
            delivered += 1;
          } catch (error) {
            // ONE SUBSCRIBER FAILING DOES NOT STOP THE OTHERS. They are
            // independent consumers of one fact, and letting the second one
            // block the third would make delivery depend on subscriber
            // registration order. The whole event is retried, and the
            // subscribers that already succeeded suppress the duplicate through
            // their inbox — which is the property that makes retrying the WHOLE
            // event safe, and the reason the inbox exists.
            failed += 1;
            firstFailure ??= error instanceof Error ? error.message : String(error);
          }
        }

        if (failed === 0) {
          const ok = await deps.outbox.markDispatched(
            organizationId,
            event.eventId,
            deps.workerId,
            event.leaseGeneration,
            deps.nowIso(),
          );
          results.push({
            eventId: event.eventId,
            eventType: event.eventType,
            delivered,
            failed,
            // A lost lease here means another dispatcher owns this event now.
            // Reported as `retry` rather than as a success, because this
            // dispatcher did not durably complete anything.
            outcome: ok ? 'dispatched' : 'retry',
            ...(ok ? {} : { failureCode: DURABLE_FAILURE.leaseLost }),
          });
          continue;
        }

        const nowMs = instantMs(deps.nowIso()) ?? Date.now();
        const backoff = computeBackoffMs(DEFAULT_JOB_RETRY_POLICY, event.attempt + 1);
        const marked = await deps.outbox.markFailed(
          organizationId,
          event.eventId,
          deps.workerId,
          event.leaseGeneration,
          DURABLE_FAILURE.consumerThrew,
          firstFailure,
          new Date(nowMs + backoff).toISOString(),
          deps.nowIso(),
        );

        results.push({
          eventId: event.eventId,
          eventType: event.eventType,
          delivered,
          failed,
          outcome: marked?.deadLettered ? 'dead_letter' : 'retry',
          failureCode: DURABLE_FAILURE.consumerThrew,
        });
      }

      return results;
    },
  };
}
