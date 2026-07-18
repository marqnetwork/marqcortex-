/**
 * A1 — startup secret validation (fail-closed backend auth).
 *
 * Exercises the pure validator used by the Edge Function to decide whether
 * to seed an admin and serve team logins. No Deno / Supabase required.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateStartupSecrets,
  REQUIRED_AUTH_SECRETS,
} from '../../supabase/functions/server/auth/validateSecrets.ts';

const fullEnv = () => ({
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_ANON_KEY: 'anon-key',
  TEAM_ADMIN_EMAIL: 'ops@example.com',
  TEAM_ADMIN_PASSWORD: 'a-strong-rotated-secret',
});

describe('validateStartupSecrets', () => {
  it('passes when every required secret is present', () => {
    const result = validateStartupSecrets(fullEnv());
    assert.equal(result.valid, true);
    assert.deepEqual(result.missing, []);
  });

  it('fails closed when TEAM_ADMIN_PASSWORD is missing', () => {
    const env = fullEnv();
    delete (env as Record<string, unknown>).TEAM_ADMIN_PASSWORD;
    const result = validateStartupSecrets(env);
    assert.equal(result.valid, false);
    assert.deepEqual(result.missing, ['TEAM_ADMIN_PASSWORD']);
  });

  it('fails closed when TEAM_ADMIN_EMAIL is missing', () => {
    const env = fullEnv();
    delete (env as Record<string, unknown>).TEAM_ADMIN_EMAIL;
    const result = validateStartupSecrets(env);
    assert.equal(result.valid, false);
    assert.ok(result.missing.includes('TEAM_ADMIN_EMAIL'));
  });

  it('treats empty / whitespace-only values as missing', () => {
    const env = { ...fullEnv(), TEAM_ADMIN_PASSWORD: '   ', TEAM_ADMIN_EMAIL: '' };
    const result = validateStartupSecrets(env);
    assert.equal(result.valid, false);
    assert.ok(result.missing.includes('TEAM_ADMIN_PASSWORD'));
    assert.ok(result.missing.includes('TEAM_ADMIN_EMAIL'));
  });

  it('reports all missing secrets when env is empty', () => {
    const result = validateStartupSecrets({});
    assert.equal(result.valid, false);
    assert.deepEqual(result.missing, [...REQUIRED_AUTH_SECRETS]);
  });

  it('requires TEAM_ADMIN credentials in the required set (no hardcoded fallback)', () => {
    assert.ok(REQUIRED_AUTH_SECRETS.includes('TEAM_ADMIN_EMAIL'));
    assert.ok(REQUIRED_AUTH_SECRETS.includes('TEAM_ADMIN_PASSWORD'));
  });
});
