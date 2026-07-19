import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildReadinessReport, type ReadinessInput } from './readiness.ts';

function baseInput(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    config: { supabaseUrl: true, serviceRoleKey: true, anonKey: true },
    kv: { reachable: true },
    intelligence: {
      activeProvider: 'openai',
      credentialsConfigured: true,
      providerHealth: [
        {
          providerId: 'openai',
          status: 'healthy',
          certificationStatus: 'Certified',
          credentialsConfigured: true,
        },
      ],
    },
    integrations: { email: { configured: true } },
    ...overrides,
  };
}

describe('buildReadinessReport', () => {
  it('reports ready when all hard dependencies are ok', () => {
    const r = buildReadinessReport(baseInput());
    assert.equal(r.status, 'ready');
    assert.equal(r.liveness, 'ok');
    assert.equal(r.warnings.length, 0);
    assert.equal(r.dependencies.config.status, 'ok');
    assert.equal(r.dependencies.kv.status, 'ok');
    assert.equal(r.dependencies.intelligence.status, 'ok');
  });

  it('is not_ready and lists missing secrets when config is incomplete', () => {
    const r = buildReadinessReport(
      baseInput({ config: { supabaseUrl: true, serviceRoleKey: false, anonKey: true } }),
    );
    assert.equal(r.status, 'not_ready');
    assert.equal(r.dependencies.config.status, 'failed');
    assert.deepEqual(r.dependencies.config.missing, ['SUPABASE_SERVICE_ROLE_KEY']);
    assert.ok(r.warnings.some((w) => w.includes('SUPABASE_SERVICE_ROLE_KEY')));
  });

  it('never leaks secret values — only presence booleans', () => {
    const r = buildReadinessReport(baseInput());
    assert.deepEqual(r.dependencies.config.present, {
      supabaseUrl: true,
      serviceRoleKey: true,
      anonKey: true,
    });
    // Serialized report must not contain anything resembling a key value.
    const json = JSON.stringify(r);
    assert.ok(!/sk-/.test(json));
    assert.ok(!/eyJ/.test(json)); // JWT prefix
  });

  it('is not_ready when the active real provider lacks credentials', () => {
    const r = buildReadinessReport(
      baseInput({
        intelligence: {
          activeProvider: 'openai',
          credentialsConfigured: false,
          providerHealth: [],
        },
      }),
    );
    assert.equal(r.status, 'not_ready');
    assert.equal(r.dependencies.intelligence.status, 'failed');
    assert.ok(r.warnings.some((w) => w.includes('no credentials')));
  });

  it('flags a mock provider as degraded so it cannot run silently in production', () => {
    const r = buildReadinessReport(
      baseInput({
        intelligence: {
          activeProvider: 'mock',
          credentialsConfigured: true,
          providerHealth: [],
        },
      }),
    );
    assert.equal(r.status, 'degraded');
    assert.equal(r.dependencies.intelligence.status, 'degraded');
    assert.equal(r.dependencies.intelligence.mockProviderActive, true);
    assert.ok(r.warnings.some((w) => w.toUpperCase().includes('MOCK')));
  });

  it('marks KV failed and overall not_ready on a failed round-trip', () => {
    const r = buildReadinessReport(baseInput({ kv: { reachable: false } }));
    assert.equal(r.status, 'not_ready');
    assert.equal(r.dependencies.kv.status, 'failed');
  });

  it('marks KV degraded (not failed) when the check was skipped', () => {
    const r = buildReadinessReport(baseInput({ kv: null }));
    assert.equal(r.dependencies.kv.status, 'degraded');
    assert.equal(r.status, 'degraded');
  });

  it('treats missing email as an optional not_configured integration, still ready', () => {
    const r = buildReadinessReport(
      baseInput({ integrations: { email: { configured: false } } }),
    );
    assert.equal(r.status, 'ready');
    assert.equal(r.integrations.email.status, 'not_configured');
    assert.ok(r.warnings.some((w) => w.toLowerCase().includes('email')));
  });
});
