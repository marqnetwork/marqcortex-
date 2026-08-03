/**
 * Durable audit store backed by the platform key-value store.
 *
 * Satisfies the retention half of the audit requirement: the in-memory ring
 * buffer answers "what happened in the last few minutes" instantly, this store
 * answers "what happened in March" after the edge isolate that served March is
 * long gone.
 *
 * Three deliberate properties:
 *
 *   Tenant-scoped keys. Every record is written under the organization's
 *   isolation prefix, so an audit export for one tenant is a prefix scan that
 *   cannot return another tenant's rows.
 *
 *   Date-partitioned keys. `…:audit:2026-07-31:aud_…` makes retention
 *   enforceable by prefix and makes a day's records enumerable without scanning
 *   the namespace.
 *
 *   Never throws. `append` returns a promise that resolves even on failure,
 *   reporting through `onError`. An audit backend outage must not fail
 *   customers' AI requests — it must be loud, not fatal.
 *
 * The store writes only; it holds no buffer, so `recent()` is unsupported and
 * the composite store always reads from the in-memory buffer instead.
 */

import type { AIAuditRecord, AuditStore } from '../observability/audit.ts';

export type KvWriter = (key: string, value: unknown) => Promise<void>;

export interface KvAuditStoreOptions {
  readonly write: KvWriter;
  /** Stamped on each record so a retention sweep can act without re-deriving. */
  readonly retentionDays: number;
  readonly onError?: (error: unknown) => void;
}

/** `org:{id}:ai:audit:{yyyy-mm-dd}:{auditId}` — tenant- and date-scoped. */
export function auditKeyFor(record: AIAuditRecord): string {
  const day = record.recordedAt.slice(0, 10);
  return `org:${record.organizationId}:ai:audit:${day}:${record.auditId}`;
}

export function createKvAuditStore(options: KvAuditStoreOptions): AuditStore {
  return {
    async append(record: AIAuditRecord): Promise<void> {
      try {
        await options.write(auditKeyFor(record), {
          ...record,
          _retentionDays: options.retentionDays,
          _schema: 'ai.audit.v1',
        });
      } catch (error) {
        options.onError?.(error);
      }
    },

    // A write-through store holds nothing to read back. The composite store
    // reads from the in-memory buffer, so returning empty here is correct
    // rather than a missing implementation.
    recent: () => [],
    size: () => 0,
  };
}
