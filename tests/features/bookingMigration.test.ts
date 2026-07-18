/**
 * BATCH 4 — InstantBooking record validation + schema migration
 *
 * Covers the KV-backed booking persistence contract:
 *   - normalizeBooking: builds the canonical v2 record and rejects bad input
 *     (the exact validation the POST /bookings endpoint applies), and
 *   - migrateBookingRecord: forward-migrates a legacy v1 stub payload
 *     (`{ email, name, scheduledAt, priority }`) to v2 on read, idempotently.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBooking,
  migrateBookingRecord,
  BOOKING_SCHEMA_VERSION,
} from '../../supabase/functions/server/bookings/bookingRecord.ts';

const WHEN = '2026-07-20T15:00:00.000Z';

describe('normalizeBooking validation', () => {
  it('builds a canonical v2 record from a valid payload', () => {
    const r = normalizeBooking(
      { contactName: '  Jane Doe ', contactEmail: 'Jane@Example.COM', companyName: 'ExampleCo', scheduledAt: WHEN, priority: true },
      'bk_1',
      '2026-07-18T00:00:00.000Z',
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.record.schemaVersion, BOOKING_SCHEMA_VERSION);
    assert.equal(r.record.contactEmail, 'jane@example.com'); // lowercased
    assert.equal(r.record.contactName, 'Jane Doe');          // trimmed
    assert.equal(r.record.scheduledAt, WHEN);                // ISO normalized
    assert.equal(r.record.priority, true);
    assert.equal(r.record.status, 'requested');
    assert.equal(r.record.source, 'score-page');             // default
    assert.equal(r.record.id, 'bk_1');
  });

  it('rejects a missing / malformed email', () => {
    const r = normalizeBooking({ contactEmail: 'not-an-email', scheduledAt: WHEN }, 'bk_2', WHEN);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, 'INVALID_EMAIL');
  });

  it('rejects a missing / invalid scheduled time', () => {
    const r = normalizeBooking({ contactEmail: 'a@b.com', scheduledAt: 'whenever' }, 'bk_3', WHEN);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, 'INVALID_SCHEDULED_AT');
  });

  it('honours an explicit client-portal source', () => {
    const r = normalizeBooking(
      { contactEmail: 'a@b.com', scheduledAt: WHEN, source: 'client-portal', submissionId: 'sub_9' },
      'bk_4', WHEN,
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.record.source, 'client-portal');
    assert.equal(r.record.submissionId, 'sub_9');
  });
});

describe('migrateBookingRecord (v1 → v2)', () => {
  it('upgrades a legacy stub payload to v2', () => {
    // The old InstantBooking stub shape — no id, status, or schemaVersion.
    const legacy = { email: 'Old@Lead.com', name: 'Old Lead', scheduledAt: WHEN, priority: true };
    const m = migrateBookingRecord(legacy);
    assert.equal(m.schemaVersion, BOOKING_SCHEMA_VERSION);
    assert.equal(m.contactEmail, 'old@lead.com');
    assert.equal(m.contactName, 'Old Lead');
    assert.equal(m.priority, true);
    assert.equal(m.status, 'requested');
    assert.equal(m.source, 'legacy');
    assert.equal(m.scheduledAt, WHEN);
    // Deterministic fallback id for records that never had one.
    assert.equal(m.id, `legacy:old@lead.com:${WHEN}`);
  });

  it('is idempotent for an already-v2 record', () => {
    const v2 = {
      id: 'bk_x', schemaVersion: 2, submissionId: null, contactName: 'A', contactEmail: 'a@b.com',
      companyName: 'C', scheduledAt: WHEN, priority: false, status: 'confirmed', source: 'score-page',
      createdAt: '2026-07-18T00:00:00.000Z',
    };
    const m = migrateBookingRecord(v2);
    assert.equal(m.id, 'bk_x');
    assert.equal(m.status, 'confirmed');
    assert.equal(m.source, 'score-page');
    assert.equal(m.schemaVersion, 2);
    assert.deepEqual(migrateBookingRecord(m), m); // stable on re-migration
  });

  it('fills safe defaults for a garbage record', () => {
    const m = migrateBookingRecord({});
    assert.equal(m.schemaVersion, BOOKING_SCHEMA_VERSION);
    assert.equal(m.contactEmail, '');
    assert.equal(m.status, 'requested');
    assert.equal(m.priority, false);
  });
});
