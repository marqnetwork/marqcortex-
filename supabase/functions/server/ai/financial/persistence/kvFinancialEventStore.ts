/**
 * Durable financial event storage, over the platform key-value store.
 *
 * ── NO NEW DATABASE TECHNOLOGY, AND NO OLAP ────────────────────────────────
 *
 * The same `tenantScopedKey` builder, the same `kv_compare_and_swap_field`
 * contract (migration 20260804120000), the same prefix scan and the same
 * corrupt-row handling the agent, workflow and reuse stores already use. NO NEW
 * MIGRATION: the contract Part 6C needs is exactly the one that exists.
 *
 *   org:{org}:ai:financial_event:{occurredAt padded}:{eventId}
 *
 * The timestamp leads the key so a windowed read is a bounded prefix range
 * rather than a full-tenant scan, and it is zero-padded so lexicographic order
 * IS chronological order. Without the padding, an event at t=9,999,999,999,999
 * sorts before one at t=10,000,000,000,000 and "the last thirty days" becomes a
 * re-scan and a comparison — which works fine in a test with four events.
 *
 * ── APPEND IS INSERT-IF-ABSENT; SETTLEMENT IS A COMPARE-AND-SWAP ───────────
 *
 * Appending uses expected version 0, so re-deriving events from the same
 * artefacts after a restart adds nothing. Settlement swaps version 1 for
 * version 2 on the same key, so two isolates reporting the same provider usage
 * resolve to ONE settled event and the loser is told it did not settle it. That
 * is what keeps a duplicate provider report from paying for one call twice.
 *
 * There is no delete method at all. A financial ledger somebody can edit is a
 * ledger that proves nothing about spend.
 */

import type { FinancialEvent } from '../contracts/event.ts';
import { isWholeFinancialEvent } from '../contracts/event.ts';
import type {
  FinancialAppendOutcome,
  FinancialEventPage,
  FinancialEventQuery,
  FinancialEventStore,
} from './ports.ts';
import {
  MAX_EVENT_SCAN_ROWS,
  boundedEventLimit,
  matchesEventQuery,
  sortEvents,
} from './ports.ts';
import { financialFailure } from '../contracts/failures.ts';
import { isolationKeyFor, tenantScopedKey } from '../../security/tenancy.ts';

export type KvFinancialReader = (key: string) => Promise<unknown>;
export type KvFinancialPrefixReader = (prefix: string) => Promise<readonly unknown[]>;

/**
 * Atomic compare-and-swap keyed by a named version field.
 *
 * Contract: write `value` at `key` if and only if the stored record's
 * `versionField` equals `expectedVersion` — or, when `expectedVersion` is 0, if
 * and only if no record exists. The comparison and the write MUST be one storage
 * operation.
 */
export type KvFinancialConditionalWriter = (
  key: string,
  versionField: string,
  expectedVersion: number,
  value: unknown,
) => Promise<boolean>;

const NAMESPACE = 'financial_event';
const VERSION_FIELD = 'ledgerVersion';
/** Wide enough for millisecond timestamps past the year 5000. */
const TIME_WIDTH = 16;

function scope(organizationId: string): { readonly isolationKey: string } {
  return { isolationKey: isolationKeyFor(organizationId) };
}

function timeSegment(occurredAt: number): string {
  return String(Math.max(0, Math.floor(occurredAt))).padStart(TIME_WIDTH, '0');
}

export function financialEventKeyFor(
  organizationId: string,
  occurredAt: number,
  eventId: string,
): string {
  return tenantScopedKey(scope(organizationId), NAMESPACE, timeSegment(occurredAt), eventId);
}

export function financialEventPrefixFor(organizationId: string): string {
  return tenantScopedKey(scope(organizationId), NAMESPACE, 'x').slice(0, -1);
}

/** The stored shape: the event plus the concurrency token the CAS compares. */
interface StoredFinancialEvent extends FinancialEvent {
  readonly ledgerVersion: number;
}

function coerce(raw: unknown): Record<string, unknown> | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') return undefined;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return undefined;
}

export interface KvFinancialStoreOptions {
  readonly read: KvFinancialReader;
  readonly readByPrefix: KvFinancialPrefixReader;
  readonly compareAndSwap: KvFinancialConditionalWriter;
  /** Called when a stored event cannot be read. Loud, never silent. */
  readonly onCorrupt?: (key: string, detail: string) => void;
}

export function createKvFinancialEventStore(
  options: KvFinancialStoreOptions,
): FinancialEventStore {
  function parse(raw: unknown, key: string): StoredFinancialEvent | undefined {
    const candidate = coerce(raw);
    if (candidate === undefined) {
      options.onCorrupt?.(key, 'stored financial event is not a readable object');
      return undefined;
    }
    // A malformed row is DROPPED rather than summed. An aggregate is the worst
    // place to discover a corrupt record, because by then it has been averaged
    // into something that looks plausible.
    if (!isWholeFinancialEvent(candidate) || typeof candidate[VERSION_FIELD] !== 'number') {
      options.onCorrupt?.(key, 'stored financial event is missing required fields');
      return undefined;
    }
    return candidate as unknown as StoredFinancialEvent;
  }

  async function scanTenant(organizationId: string): Promise<StoredFinancialEvent[]> {
    const prefix = financialEventPrefixFor(organizationId);
    const rows = await options.readByPrefix(prefix);
    const out: StoredFinancialEvent[] = [];
    for (const row of rows) {
      const event = parse(row, prefix);
      if (event === undefined) continue;
      if (event.organizationId !== organizationId) {
        options.onCorrupt?.(prefix, 'stored financial event does not match its prefix');
        continue;
      }
      out.push(event);
      if (out.length >= MAX_EVENT_SCAN_ROWS) break;
    }
    return out;
  }

  return {
    async append(event): Promise<FinancialAppendOutcome> {
      if (!isWholeFinancialEvent(event)) {
        throw financialFailure('financial_input_invalid', 'That financial event is incomplete.', {
          diagnostics: `eventId=${String(event.eventId)}`,
        });
      }
      const key = financialEventKeyFor(event.organizationId, event.occurredAt, event.eventId);
      const stored: StoredFinancialEvent = { ...event, ledgerVersion: 1 };
      const won = await options.compareAndSwap(key, VERSION_FIELD, 0, stored);
      if (won) return { stored: true, eventId: event.eventId, event };

      const existing = parse(await options.read(key), key);
      if (existing === undefined) {
        // The insert lost and yet nothing readable is there. A storage fault
        // rather than a race, and it must not be reported as a duplicate — that
        // would hand the caller an event it did not get.
        throw financialFailure(
          'financial_event_conflict',
          'That financial event could not be stored or read back.',
          { diagnostics: `insert-if-absent lost at ${key} but no event is readable` },
        );
      }
      return { stored: false, eventId: existing.eventId, event: existing };
    },

    async getById(organizationId, eventId) {
      // The key carries the timestamp, which a caller holding only an id does not
      // have, so this resolves through the tenant's own bounded prefix.
      for (const event of await scanTenant(organizationId)) {
        if (event.eventId === eventId) return event;
      }
      return undefined;
    },

    async settle(event) {
      const key = financialEventKeyFor(event.organizationId, event.occurredAt, event.eventId);
      const existing = parse(await options.read(key), key);
      if (existing === undefined) return false;
      if (existing.organizationId !== event.organizationId) return false;
      if (existing.settlementState === 'settled') return false;
      if (!isWholeFinancialEvent(event)) return false;
      // Compare-and-swap on the version the read observed. Two isolates reporting
      // the same provider usage resolve to ONE settlement; the loser is told it
      // did not perform it.
      return await options.compareAndSwap(key, VERSION_FIELD, existing.ledgerVersion, {
        ...event,
        ledgerVersion: existing.ledgerVersion + 1,
      });
    },

    async list(query: FinancialEventQuery): Promise<FinancialEventPage> {
      const limit = boundedEventLimit(query.limit);
      const matching = (await scanTenant(query.organizationId)).filter((event) =>
        matchesEventQuery(event, query),
      );
      const sorted = sortEvents(matching);
      return { events: sorted.slice(0, limit), truncated: sorted.length > limit };
    },
  };
}
