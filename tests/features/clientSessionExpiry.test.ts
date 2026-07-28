/**
 * PHASE 1B — Client session expiry
 *
 * `isClientSessionExpired` is the one canonical expiry check. These tests pin
 * its behaviour directly, including the fail-closed handling of sessions
 * persisted before expiry existed.
 *
 * `now` is always injected, so nothing here depends on wall-clock time.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isClientSessionExpired,
  CLIENT_SESSION_TTL_MS,
  type ClientSession,
} from '../../src/app/lib/session.ts';

const T0 = 1_700_000_000_000; // fixed reference instant

const session = (overrides: Partial<ClientSession> = {}): ClientSession => ({
  submissionId: 'sub-1',
  email: 'client@example.com',
  companyName: 'ExampleCo',
  sessionToken: 'token-1',
  expiresAt: T0 + CLIENT_SESSION_TTL_MS,
  ...overrides,
});

describe('client session lifetime', () => {
  it('is 8 hours', () => {
    assert.equal(CLIENT_SESSION_TTL_MS, 8 * 60 * 60 * 1000);
  });
});

describe('isClientSessionExpired — valid sessions', () => {
  it('a freshly issued session is not expired', () => {
    assert.equal(isClientSessionExpired(session(), T0), false);
  });

  it('a session one millisecond before expiry is still valid', () => {
    const s = session();
    assert.equal(isClientSessionExpired(s, s.expiresAt - 1), false);
  });

  it('stays valid throughout the TTL window', () => {
    const s = session();
    for (const elapsed of [0, 1, 60_000, CLIENT_SESSION_TTL_MS / 2, CLIENT_SESSION_TTL_MS - 1]) {
      assert.equal(isClientSessionExpired(s, T0 + elapsed), false, `elapsed ${elapsed}ms`);
    }
  });
});

describe('isClientSessionExpired — expired sessions', () => {
  it('is expired exactly at the expiry instant', () => {
    const s = session();
    assert.equal(isClientSessionExpired(s, s.expiresAt), true);
  });

  it('is expired after the expiry instant', () => {
    const s = session();
    assert.equal(isClientSessionExpired(s, s.expiresAt + 1), true);
    assert.equal(isClientSessionExpired(s, s.expiresAt + CLIENT_SESSION_TTL_MS), true);
  });

  it('a session that expired in the past is rejected', () => {
    assert.equal(isClientSessionExpired(session({ expiresAt: T0 - 1 }), T0), true);
  });
});

describe('isClientSessionExpired — fails closed', () => {
  it('treats a legacy session with no expiresAt as expired', () => {
    // Sessions persisted before expiry existed: exactly the never-expiring
    // sessions this check exists to eliminate.
    const legacy = {
      submissionId: 'sub-1',
      email: 'client@example.com',
      companyName: 'ExampleCo',
      sessionToken: 'token-1',
    } as unknown as ClientSession;

    assert.equal(isClientSessionExpired(legacy, T0), true);
  });

  it('treats malformed expiresAt values as expired', () => {
    for (const bad of [undefined, null, NaN, Infinity, -Infinity, '123', {}, []]) {
      const s = { ...session(), expiresAt: bad } as unknown as ClientSession;
      assert.equal(isClientSessionExpired(s, T0), true, `expiresAt=${String(bad)}`);
    }
  });
});

describe('isClientSessionExpired — absent session', () => {
  it('null and undefined are not "expired" (callers guard absence separately)', () => {
    assert.equal(isClientSessionExpired(null, T0), false);
    assert.equal(isClientSessionExpired(undefined, T0), false);
  });
});

describe('expiry is fixed at issue time', () => {
  it('re-checking later never extends the deadline', () => {
    const s = session();
    // The same session object, evaluated repeatedly, expires on schedule.
    assert.equal(isClientSessionExpired(s, T0 + CLIENT_SESSION_TTL_MS - 1), false);
    assert.equal(isClientSessionExpired(s, T0 + CLIENT_SESSION_TTL_MS), true);
    // And a round-trip through storage preserves the same deadline.
    const roundTripped: ClientSession = JSON.parse(JSON.stringify(s));
    assert.equal(roundTripped.expiresAt, s.expiresAt);
    assert.equal(isClientSessionExpired(roundTripped, T0 + CLIENT_SESSION_TTL_MS), true);
  });
});
