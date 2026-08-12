/**
 * The financial event store port (AI-01 Batch 3B, Part 6C).
 *
 * ── APPEND, SETTLE, READ. NOTHING ELSE ─────────────────────────────────────
 *
 * Four methods, every one tenant-scoped. `append` is insert-if-absent on the
 * derived event id, so re-deriving events from the same artefacts adds nothing.
 * `settle` is the ONE mutation, it moves an event from pending to settled
 * exactly once, and `settleFinancialEvent` refuses a second attempt.
 *
 * There is no delete and no general update. A financial ledger somebody can edit
 * is a ledger that proves nothing about spend, and the absence of the method is
 * the guarantee — a rule about how a writer should be called is a rule somebody
 * eventually calls differently.
 *
 * ── BOUNDED QUERY, NOT AN ANALYTICS ENGINE ─────────────────────────────────
 *
 * `list` walks a tenant-scoped prefix, filters to a window and caps the rows.
 * That is what Part 6C needs and deliberately all it does: no cubes, no
 * materialised rollups, no second database. The aggregation happens in memory
 * over a bounded set, which keeps every figure recomputable from the events
 * rather than trusting a pre-aggregated table nobody can re-derive.
 *
 * The cap is a real limitation and is reported rather than hidden — `truncated`
 * on the result — because a financial total computed over a silently truncated
 * scan is the one kind of wrong number that looks exactly like a right one.
 */

import type { FinancialEvent } from '../contracts/event.ts';
import { isWholeFinancialEvent } from '../contracts/event.ts';
import type { FinancialWindow } from '../contracts/report.ts';
import { inWindow } from '../contracts/report.ts';
import { financialFailure } from '../contracts/failures.ts';

export const MAX_EVENT_SCAN_ROWS = 5_000;

export interface FinancialEventQuery {
  /** Required. There is no cross-tenant financial listing, by design. */
  readonly organizationId: string;
  readonly window: FinancialWindow;
  readonly workflowId?: string;
  readonly workflowRunId?: string;
  readonly agentId?: string;
  readonly limit?: number;
}

export interface FinancialEventPage {
  readonly events: readonly FinancialEvent[];
  /** True when the scan hit its ceiling. A total over this is a floor. */
  readonly truncated: boolean;
}

export interface FinancialAppendOutcome {
  readonly stored: boolean;
  readonly eventId: string;
  /** The event now in storage. The existing one when `stored` is false. */
  readonly event: FinancialEvent;
}

export interface FinancialEventStore {
  /** Insert if absent. Never overwrites; re-derivation cannot inflate a total. */
  append(event: FinancialEvent): Promise<FinancialAppendOutcome>;
  /** One event by id, scoped to a tenant. Never another tenant's. */
  getById(organizationId: string, eventId: string): Promise<FinancialEvent | undefined>;
  /**
   * Replace a pending event with its settled form.
   *
   * The ONE mutation. Resolves false when the event is absent or has already
   * settled, so a duplicate provider report cannot pay for one call twice.
   */
  settle(event: FinancialEvent): Promise<boolean>;
  list(query: FinancialEventQuery): Promise<FinancialEventPage>;
}

export function boundedEventLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return MAX_EVENT_SCAN_ROWS;
  return Math.min(MAX_EVENT_SCAN_ROWS, Math.max(1, Math.floor(limit)));
}

/** Shared by both implementations, so a filter means one thing everywhere. */
export function matchesEventQuery(
  event: FinancialEvent,
  query: FinancialEventQuery,
): boolean {
  if (event.organizationId !== query.organizationId) return false;
  if (!inWindow(event.occurredAt, query.window)) return false;
  if (query.workflowId !== undefined && event.workflowId !== query.workflowId) return false;
  if (query.workflowRunId !== undefined && event.workflowRunId !== query.workflowRunId) return false;
  if (query.agentId !== undefined && event.agentId !== query.agentId) return false;
  return true;
}

/** Deterministic ordering, so a report over a page is reproducible. */
export function sortEvents(events: readonly FinancialEvent[]): readonly FinancialEvent[] {
  return [...events].sort(
    (a, b) =>
      a.occurredAt - b.occurredAt || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0),
  );
}

/**
 * An in-process store, correct for tests and a single isolate.
 *
 * Satisfies the SAME contract as the durable one, so a behaviour proved here is
 * a behaviour the platform can rely on rather than one that held until the first
 * deployment with two isolates.
 */
export function createInMemoryFinancialEventStore(): FinancialEventStore {
  const events = new Map<string, FinancialEvent>();
  const keyFor = (organizationId: string, eventId: string): string =>
    `${organizationId} ${eventId}`;

  return {
    append(event) {
      if (!isWholeFinancialEvent(event)) {
        throw financialFailure('financial_input_invalid', 'That financial event is incomplete.', {
          diagnostics: `eventId=${String(event.eventId)}`,
        });
      }
      const key = keyFor(event.organizationId, event.eventId);
      const existing = events.get(key);
      if (existing !== undefined) {
        return Promise.resolve({ stored: false, eventId: existing.eventId, event: existing });
      }
      events.set(key, event);
      return Promise.resolve({ stored: true, eventId: event.eventId, event });
    },

    getById(organizationId, eventId) {
      const event = events.get(keyFor(organizationId, eventId));
      if (event !== undefined && event.organizationId !== organizationId) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(event);
    },

    settle(event) {
      const key = keyFor(event.organizationId, event.eventId);
      const existing = events.get(key);
      if (existing === undefined) return Promise.resolve(false);
      // Already settled means this is a duplicate report or a correction. Both
      // are refused here: applying either silently would pay for one call twice.
      if (existing.settlementState === 'settled') return Promise.resolve(false);
      if (!isWholeFinancialEvent(event)) return Promise.resolve(false);
      events.set(key, event);
      return Promise.resolve(true);
    },

    list(query) {
      const limit = boundedEventLimit(query.limit);
      const matching: FinancialEvent[] = [];
      for (const event of events.values()) {
        if (matchesEventQuery(event, query)) matching.push(event);
      }
      const sorted = sortEvents(matching);
      return Promise.resolve({
        events: sorted.slice(0, limit),
        truncated: sorted.length > limit,
      });
    },
  };
}
