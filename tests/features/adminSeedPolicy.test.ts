/**
 * BATCH 6 — Workstream 6: admin-seed fail-closed policy
 *
 * The startup admin seed must NEVER provision an account with a default or
 * hardcoded password. It seeds ONLY when both TEAM_ADMIN_EMAIL and
 * TEAM_ADMIN_PASSWORD are explicitly configured; otherwise it fails closed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAdminSeed } from '../../supabase/functions/server/adminSeedPolicy.ts';

describe('admin seed — fail closed', () => {
  it('does NOT seed when both credentials are missing', () => {
    const d = resolveAdminSeed({});
    assert.equal(d.seed, false);
    assert.match(d.reason, /must both be set/i);
  });

  it('does NOT seed when only the email is set (no default password)', () => {
    const d = resolveAdminSeed({ email: 'admin@example.com' });
    assert.equal(d.seed, false);
  });

  it('does NOT seed when only the password is set', () => {
    const d = resolveAdminSeed({ password: 'super-secret' });
    assert.equal(d.seed, false);
  });

  it('treats whitespace-only values as missing', () => {
    const d = resolveAdminSeed({ email: '   ', password: '   ' });
    assert.equal(d.seed, false);
  });
});

describe('admin seed — seeds only with explicit config', () => {
  it('seeds when both email and password are provided', () => {
    const d = resolveAdminSeed({ email: ' admin@example.com ', password: 'super-secret' });
    assert.equal(d.seed, true);
    assert.equal(d.email, 'admin@example.com'); // trimmed
    assert.equal(d.name, 'MARQ Admin'); // default name
  });

  it('uses a provided name when present', () => {
    const d = resolveAdminSeed({ email: 'a@b.com', password: 'pw', name: 'Ops Admin' });
    assert.equal(d.seed, true);
    assert.equal(d.name, 'Ops Admin');
  });

  it('never leaks a hardcoded default credential in its output', () => {
    const d = resolveAdminSeed({});
    assert.equal(JSON.stringify(d).includes('CortexAdmin'), false);
  });
});
