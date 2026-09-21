/**
 * Idempotent consumption (BP-002 §6.5 and §12).
 *
 * THE CONTRACT, STATED EXACTLY, because the first version of this file claimed
 * more than it delivered:
 *
 *     durable at-least-once delivery
 *   + a durable idempotency identity per (consumer, event)
 *   = one processed effect per consumer per event, WHEN THE HANDLER OBEYS THE
 *     IDEMPOTENCY CONTRACT.
 *
 * That is not exactly-once execution and nothing here can provide it for an
 * arbitrary external side effect. A handler that posts to a payment API and
 * then has its process killed before settling has performed the effect, and no
 * ledger this side of the boundary can know. What the platform guarantees is
 * that the CLAIM is durable, single-owner and recoverable, so the handler is
 * always told whether it is the owner, and a handler that makes its own writes
 * conditional on that claim gets one effect.
 *
 * ── WHY THE CLAIM IS WRITTEN BEFORE THE HANDLER, AND WHY IT IS NOT `processed`
 *
 * Both halves matter and the first version got the second one wrong.
 *
 * Writing FIRST is what closes the concurrency window. The obvious
 * implementation — look up whether we have seen this event, run if not, then
 * record it — is wrong in the case that matters: two isolates receive the same
 * delivery at the same instant, both look up, both find nothing, both run. The
 * claim is an INSERT arbitrated by a unique key, in one statement, so the loser
 * never calls the handler.
 *
 * But the first version wrote `processed` as that claim, which meant the row
 * said the effect had happened before it had. Two losses followed:
 *
 *   A CONSUMER THAT DIED between the claim and the handler left a permanent
 *   suppression for work that never ran. Every later delivery was discarded,
 *   undetectably, because the ledger said it was fine.
 *
 *   A HANDLER THAT THREW left `failed`, and the next delivery still conflicted
 *   on the unique key — so the consumer that failed was never invoked again,
 *   while the dispatcher marked the event delivered because `deliver()` read
 *   the conflict as "already done".
 *
 * So the claim is `processing`, it carries a lease, and it is settled to
 * `processed` or `failed` only after the handler returns or throws. A `failed`
 * row and an expired `processing` row are both re-claimable, which is what
 * makes the dispatcher's retry reach the consumer that actually needs it.
 *
 * ── WHAT `deliver()` TELLS THE DISPATCHER ─────────────────────────────────
 *
 * It throws unless THIS consumer is now settled `processed` — by this delivery
 * or by an earlier one. A failure throws, so the dispatcher retries and
 * eventually dead-letters. An in-flight claim throws too: nothing went wrong,
 * but nothing was accomplished either, and reporting success would let the
 * event be marked dispatched while the consumer holding it is still running.
 *
 * A suppressed duplicate does NOT throw. That is what lets the dispatcher
 * retry a whole event safely when one of several subscribers failed: the ones
 * that already succeeded suppress, the failed one runs again, and the event
 * advances when all of them are done.
 */

import {
  DURABLE_FAILURE,
  type ConsumeResult,
  type DomainEventRecord,
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
  /**
   * This consumer instance's identity, for the claim.
   *
   * Distinct from `consumerKey`: the KEY says which logical consumer this is
   * and is what idempotency is scoped by; the OWNER says which running copy of
   * it holds the current claim. Two isolates running the same consumer share a
   * key and must not share an owner, or the lease could not tell them apart.
   */
  readonly workerId?: string;
  readonly leaseTtlMs?: number;
}

export interface IdempotentConsumer extends EventSubscriber {
  /**
   * Deliver, at most one processed effect per (consumer, event).
   *
   * Reports which of the four things happened rather than collapsing them:
   * processed, suppressed (already done), failed (the handler threw), or
   * in_flight (another owner holds a live claim).
   */
  consume(event: DomainEventRecord): Promise<ConsumeResult>;
}

export function createIdempotentConsumer(
  deps: IdempotentConsumerDependencies,
): IdempotentConsumer {
  const workerId = deps.workerId ?? `consumer:${deps.consumerKey}`;
  const leaseTtlMs = deps.leaseTtlMs ?? 60_000;

  async function consume(event: DomainEventRecord): Promise<ConsumeResult> {
    // CLAIM FIRST. Throws on a cross-tenant event, so a consumer cannot record
    // having processed another organization's fact.
    const claim = await deps.inbox.claim(
      event.organizationId,
      deps.consumerKey,
      event,
      workerId,
      leaseTtlMs,
      deps.nowIso(),
    );

    if (claim.kind === 'suppressed') {
      return { outcome: 'suppressed', record: claim.record };
    }
    if (claim.kind === 'inFlight') {
      return { outcome: 'in_flight', record: claim.record };
    }

    let result: Readonly<Record<string, unknown>> | void;
    try {
      result = await deps.handle(event);
    } catch (error) {
      const settled = await deps.inbox.settle(
        claim.lease,
        'failed',
        {
          failureCode: DURABLE_FAILURE.consumerThrew,
          failureDetail: error instanceof Error ? error.message : String(error),
        },
        deps.nowIso(),
      );
      // A settle that returns nothing means the claim lapsed while the handler
      // ran and somebody else now owns it. Reported as `failed` either way —
      // this delivery did not produce a processed effect, which is the only
      // thing the dispatcher needs to know.
      return { outcome: 'failed', record: settled ?? claim.record };
    }

    const settled = await deps.inbox.settle(
      claim.lease,
      'processed',
      result === undefined || result === null ? {} : { result },
      deps.nowIso(),
    );

    if (settled === undefined) {
      // THE HANDLER RAN AND THE CLAIM WAS GONE. The effect may well have
      // happened, and the ledger cannot say so — this is the honest edge of
      // the at-least-once contract, and it is reported rather than rounded up
      // to success. A longer lease, or a handler that heartbeats, is the fix;
      // pretending is not.
      return { outcome: 'failed', record: claim.record };
    }
    return { outcome: 'processed', record: settled };
  }

  return {
    consumerKey: deps.consumerKey,
    eventTypes: deps.eventTypes,
    consume,
    async deliver(event) {
      const outcome = await consume(event);
      if (outcome.outcome === 'processed' || outcome.outcome === 'suppressed') return;

      if (outcome.outcome === 'in_flight') {
        throw new Error(
          `consumer ${deps.consumerKey} could not take event ${event.eventId}: ` +
            'another owner holds a live claim',
        );
      }
      throw new Error(
        outcome.record.failureDetail ??
          `consumer ${deps.consumerKey} failed on event ${event.eventId}`,
      );
    },
  };
}
