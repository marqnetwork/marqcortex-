/**
 * Idempotent consumption (BP-002 §6.5 and §12, CHECKPOINT 7).
 *
 * THE ONE PROPERTY THIS FILE EXISTS FOR: the same event delivered twice
 * produces ONE logical effect.
 *
 * ── WHY THE CLAIM IS AN INSERT AND NOT A READ ─────────────────────────────
 *
 * The obvious implementation is: look up whether we have seen this event; if
 * not, do the work; then record that we have. It is wrong, and it is wrong in
 * the case that matters. Two isolates receive the same delivery at the same
 * instant. Both look up. Both find nothing. Both do the work. Both record it —
 * and the second record either overwrites the first or violates the constraint
 * AFTER the duplicate effect has already happened.
 *
 * So the order here is inverted: CLAIM FIRST, by inserting the inbox row, and
 * do the work only if the insert succeeded. The unique key
 * `(organizationId, consumerKey, eventId)` is what arbitrates, in the database,
 * in one statement. The loser never calls the handler.
 *
 * ── WHAT HAPPENS WHEN THE WORK THEN FAILS ─────────────────────────────────
 *
 * The row stays, marked `failed`, and the event is NOT retried by this
 * consumer. That is a real decision with a real cost and it is the right one
 * here: a consumer that retried on its own would have to un-claim first, which
 * reopens the window the claim exists to close. Retry belongs to the DISPATCHER
 * — it still holds the outbox lease, it marks the event for another attempt,
 * and the consumers that already succeeded suppress their duplicate. The failed
 * one gets another chance only if an operator clears its inbox row, which is
 * deliberate: silently re-running a consumer that failed for an unknown reason
 * is how one bad event becomes an unbounded number of side effects.
 *
 * The consequence is stated plainly in the BP-002 report as a known limitation
 * rather than hidden here.
 */

import {
  DURABLE_FAILURE,
  type ConsumeResult,
  type DomainEventRecord,
  type InboxRecord,
} from './contracts.ts';
import type { InboxStore } from './ports.ts';
import type { EventSubscriber } from './dispatcher.ts';

/** What a consumer does with a fact. Returns a bounded result, or throws. */
export type EventHandler = (
  event: DomainEventRecord,
) => Promise<Readonly<Record<string, unknown>> | void>;

export interface IdempotentConsumerDependencies {
  readonly inbox: InboxStore;
  readonly consumerKey: string;
  readonly eventTypes: readonly string[];
  readonly handle: EventHandler;
  readonly nowIso: () => string;
}

export interface IdempotentConsumer extends EventSubscriber {
  /**
   * Deliver, exactly once per (consumer, event).
   *
   * Reports `suppressed` for a duplicate rather than hiding it: "we suppressed
   * forty thousand duplicates today" and "we processed forty thousand events
   * today" are different operational facts, and a consumer that cannot tell
   * them apart cannot tell a healthy at-least-once producer from a broken one.
   */
  consume(event: DomainEventRecord): Promise<ConsumeResult>;
}

export function createIdempotentConsumer(
  deps: IdempotentConsumerDependencies,
): IdempotentConsumer {
  async function consume(event: DomainEventRecord): Promise<ConsumeResult> {
    const at = deps.nowIso();

    // CLAIM FIRST. See the header. `claim` throws on a cross-tenant event, so a
    // consumer cannot record having processed another organization's fact.
    const claimed = await deps.inbox.claim(
      event.organizationId,
      deps.consumerKey,
      event,
      at,
    );

    if (claimed === undefined) {
      const existing = await deps.inbox.find(
        event.organizationId,
        deps.consumerKey,
        event.eventId,
      );
      return {
        outcome: 'suppressed',
        // The existing record is the truth about this delivery. The fallback
        // exists only so the return type is total; `claim` returning undefined
        // means a row is there.
        record:
          existing ??
          ({
            inboxId: `${deps.consumerKey}:${event.eventId}`,
            organizationId: event.organizationId,
            consumerKey: deps.consumerKey,
            eventId: event.eventId,
            eventType: event.eventType,
            status: 'processed',
            processedAt: at,
          } satisfies InboxRecord),
      };
    }

    try {
      const result = await deps.handle(event);
      const settled = await deps.inbox.settle(
        event.organizationId,
        deps.consumerKey,
        event.eventId,
        'processed',
        result === undefined || result === null ? {} : { result },
        deps.nowIso(),
      );
      return { outcome: 'processed', record: settled ?? claimed };
    } catch (error) {
      const settled = await deps.inbox.settle(
        event.organizationId,
        deps.consumerKey,
        event.eventId,
        'failed',
        {
          failureCode: DURABLE_FAILURE.consumerThrew,
          failureDetail: error instanceof Error ? error.message : String(error),
        },
        deps.nowIso(),
      );
      return { outcome: 'failed', record: settled ?? claimed };
    }
  }

  return {
    consumerKey: deps.consumerKey,
    eventTypes: deps.eventTypes,
    consume,
    /**
     * The dispatcher's view: deliver, and THROW when the handler failed.
     *
     * A failure has to reach the dispatcher as an exception, because that is
     * how the dispatcher learns to retry the event and, eventually, to
     * dead-letter it. Swallowing it here would make a broken consumer look
     * exactly like a working one from every operational measure.
     *
     * A SUPPRESSED DUPLICATE IS NOT A FAILURE and does not throw. That is what
     * lets the dispatcher retry a whole event safely when one of several
     * subscribers failed: the ones that already succeeded suppress, the failed
     * one is tried again, and the event advances when all of them are done.
     */
    async deliver(event) {
      const outcome = await consume(event);
      if (outcome.outcome === 'failed') {
        throw new Error(
          outcome.record.failureDetail ??
            `consumer ${deps.consumerKey} failed on event ${event.eventId}`,
        );
      }
    },
  };
}
