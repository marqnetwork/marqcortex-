/**
 * BOOKING RECORD — canonical shape, validation, and schema migration.
 *
 * Batch 4: InstantBooking moved from a no-op stub to KV-backed persistence.
 * Legacy booking payloads (the old stub's `{ email, name, scheduledAt, priority }`)
 * had no id, status, or schema version. This module defines the canonical v2
 * record and a forward-migration that upgrades any stored/legacy booking to v2,
 * so reads are always normalized regardless of when the record was written.
 *
 * Pure functions only — no Deno/Node runtime APIs — so both the edge function
 * and the node test runner can import it.
 */

export const BOOKING_SCHEMA_VERSION = 2 as const;

export type BookingStatus = 'requested' | 'confirmed' | 'cancelled';
export type BookingSource = 'score-page' | 'client-portal' | 'legacy';

export interface BookingRecord {
  id: string;
  schemaVersion: number;
  submissionId: string | null;
  contactName: string;
  contactEmail: string;
  companyName: string;
  scheduledAt: string; // ISO 8601
  priority: boolean;
  status: BookingStatus;
  source: BookingSource;
  createdAt: string; // ISO 8601
}

export interface BookingInput {
  contactName?: unknown;
  contactEmail?: unknown;
  companyName?: unknown;
  scheduledAt?: unknown;
  priority?: unknown;
  submissionId?: unknown;
  source?: unknown;
}

export type NormalizeResult =
  | { ok: true; record: BookingRecord }
  | { ok: false; reason: string };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function isValidIso(v: unknown): v is string {
  if (typeof v !== 'string' || v.trim() === '') return false;
  const t = new Date(v).getTime();
  return !Number.isNaN(t);
}

const VALID_STATUS: ReadonlySet<string> = new Set(['requested', 'confirmed', 'cancelled']);
const VALID_SOURCE: ReadonlySet<string> = new Set(['score-page', 'client-portal', 'legacy']);

/**
 * Validate + build a canonical v2 booking record from a client payload.
 * `id` and `createdAt` are supplied by the caller so this stays deterministic.
 */
export function normalizeBooking(
  input: BookingInput,
  id: string,
  createdAt: string,
): NormalizeResult {
  if (!isNonEmptyString(input.contactEmail) || !looksLikeEmail(input.contactEmail)) {
    return { ok: false, reason: 'INVALID_EMAIL' };
  }
  if (!isValidIso(input.scheduledAt)) {
    return { ok: false, reason: 'INVALID_SCHEDULED_AT' };
  }

  const source = isNonEmptyString(input.source) && VALID_SOURCE.has(input.source)
    ? (input.source as BookingSource)
    : 'score-page';

  return {
    ok: true,
    record: {
      id,
      schemaVersion: BOOKING_SCHEMA_VERSION,
      submissionId: isNonEmptyString(input.submissionId) ? input.submissionId : null,
      contactName: isNonEmptyString(input.contactName) ? input.contactName.trim() : '',
      contactEmail: (input.contactEmail as string).trim().toLowerCase(),
      companyName: isNonEmptyString(input.companyName) ? input.companyName.trim() : '',
      scheduledAt: new Date(input.scheduledAt as string).toISOString(),
      priority: Boolean(input.priority),
      status: 'requested',
      source,
      createdAt,
    },
  };
}

/**
 * Upgrade any stored/legacy booking record to the current v2 shape.
 * Idempotent: a record already at v2 is returned with defaults backfilled.
 * Legacy v1 records used `{ email, name, scheduledAt, priority }` with no id.
 */
export function migrateBookingRecord(raw: unknown): BookingRecord {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  // Legacy v1 used `email`/`name`; v2 uses `contactEmail`/`contactName`.
  const email = isNonEmptyString(r.contactEmail)
    ? r.contactEmail
    : isNonEmptyString(r.email) ? r.email : '';
  const name = isNonEmptyString(r.contactName)
    ? r.contactName
    : isNonEmptyString(r.name) ? r.name : '';

  const emailNorm = email.trim().toLowerCase();
  const scheduledAt = isValidIso(r.scheduledAt)
    ? new Date(r.scheduledAt as string).toISOString()
    : '';

  // Deterministic fallback id for legacy records that never had one.
  const id = isNonEmptyString(r.id)
    ? r.id
    : `legacy:${emailNorm || 'unknown'}:${scheduledAt || 'unscheduled'}`;

  const status = isNonEmptyString(r.status) && VALID_STATUS.has(r.status)
    ? (r.status as BookingStatus)
    : 'requested';

  // A record carrying a v2 schemaVersion but no source is a v2 write (default
  // 'score-page'); one lacking both is a pre-v2/legacy stub payload.
  const source = isNonEmptyString(r.source) && VALID_SOURCE.has(r.source)
    ? (r.source as BookingSource)
    : r.schemaVersion === BOOKING_SCHEMA_VERSION
      ? 'score-page'
      : 'legacy';

  return {
    id,
    schemaVersion: BOOKING_SCHEMA_VERSION,
    submissionId: isNonEmptyString(r.submissionId) ? r.submissionId : null,
    contactName: name.trim(),
    contactEmail: emailNorm,
    companyName: isNonEmptyString(r.companyName) ? r.companyName.trim() : '',
    scheduledAt,
    priority: Boolean(r.priority),
    status,
    source,
    createdAt: isValidIso(r.createdAt)
      ? new Date(r.createdAt as string).toISOString()
      : new Date(0).toISOString(),
  };
}
