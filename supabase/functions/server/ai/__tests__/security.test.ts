/**
 * Security tests: rate limiting, organization resolution, tenant isolation,
 * actor and capability resolution.
 *
 * Every assertion here is about a boundary that, if it moved, would let one
 * tenant see another's data or let one caller exhaust the platform. They are
 * written against the real implementations with a hand-driven clock, so window
 * boundaries are exact rather than approximate.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createTestClock } from '../runtime/clock.ts';
import { createSlidingWindowRateLimiter, rateLimitScope } from '../security/rateLimiter.ts';
import { assertSameTenant, resolveOrganization, tenantScopedKey } from '../security/tenancy.ts';
import { capabilitiesForRoles, resolveActor, type AuthenticatedSubject } from '../security/actor.ts';
import { AIError } from '../contracts/errors.ts';

const RULE = { limit: 3, windowMs: 1_000 };

const subject = (memberships: AuthenticatedSubject['memberships']): AuthenticatedSubject => ({
  subjectId: 'user-1',
  email: 'consultant@marq.test',
  actorType: 'team_user',
  globalRoles: [],
  memberships,
});

describe('sliding window rate limiter', () => {
  it('admits exactly the limit and rejects the next request', () => {
    const clock = createTestClock();
    const limiter = createSlidingWindowRateLimiter(clock);
    for (let i = 0; i < RULE.limit; i += 1) {
      assert.equal(limiter.consume('scope', RULE).allowed, true, `request ${i + 1} should be allowed`);
    }
    assert.equal(limiter.consume('scope', RULE).allowed, false);
  });

  it('reports remaining headroom and a retry-after that clears the window', () => {
    const clock = createTestClock();
    const limiter = createSlidingWindowRateLimiter(clock);
    assert.equal(limiter.consume('scope', RULE).remaining, 2);
    limiter.consume('scope', RULE);
    limiter.consume('scope', RULE);
    const rejected = limiter.consume('scope', RULE);
    assert.equal(rejected.allowed, false);
    assert.equal(rejected.remaining, 0);
    assert.ok(rejected.retryAfterSeconds >= 1);
  });

  it('slides rather than resetting — no double burst at a window boundary', () => {
    // The defect a fixed window has: `limit` requests at the end of window N
    // plus `limit` at the start of window N+1 is 2× the limit in a moment.
    const clock = createTestClock();
    const limiter = createSlidingWindowRateLimiter(clock);

    for (let i = 0; i < RULE.limit; i += 1) limiter.consume('scope', RULE);
    clock.advance(999);
    assert.equal(limiter.consume('scope', RULE).allowed, false, 'still inside the window');

    clock.advance(2);
    // Only the hits older than the window have expired.
    assert.equal(limiter.consume('scope', RULE).allowed, true);
  });

  it('keeps scopes independent', () => {
    const clock = createTestClock();
    const limiter = createSlidingWindowRateLimiter(clock);
    for (let i = 0; i < RULE.limit; i += 1) limiter.consume('a', RULE);
    assert.equal(limiter.consume('a', RULE).allowed, false);
    assert.equal(limiter.consume('b', RULE).allowed, true);
  });

  it('peek does not consume', () => {
    const clock = createTestClock();
    const limiter = createSlidingWindowRateLimiter(clock);
    limiter.peek('scope', RULE);
    limiter.peek('scope', RULE);
    assert.equal(limiter.consume('scope', RULE).remaining, 2);
  });

  it('sweeps scopes that have gone quiet', () => {
    const clock = createTestClock();
    const limiter = createSlidingWindowRateLimiter(clock);
    limiter.consume('scope', RULE);
    assert.equal(limiter.size(), 1);
    clock.advance(3_600_001);
    assert.equal(limiter.sweep(), 1);
    assert.equal(limiter.size(), 0);
  });

  it('scopes actor and organization keys distinctly per feature', () => {
    assert.notEqual(
      rateLimitScope.actor('acme', 'user-1', 'cortex.chat'),
      rateLimitScope.actor('acme', 'user-1', 'cortex.narrative'),
    );
    assert.notEqual(
      rateLimitScope.actor('acme', 'user-1', 'cortex.chat'),
      rateLimitScope.organization('acme', 'cortex.chat'),
    );
  });
});

describe('organization resolution', () => {
  const options = { defaultOrganizationId: 'marq-cortex', allowList: [] as string[] };

  it('honours a hint the subject actually holds', () => {
    const organization = resolveOrganization(
      subject([
        { organizationId: 'acme', roles: ['consultant'] },
        { organizationId: 'globex', tier: 'enterprise', roles: ['reviewer'] },
      ]),
      'globex',
      options,
    );
    assert.equal(organization.organizationId, 'globex');
    assert.equal(organization.tier, 'enterprise');
  });

  it('rejects a hint the subject does not hold instead of downgrading silently', () => {
    // Downgrading to "your own org" would hide a real cross-tenant access
    // attempt behind a successful response.
    assert.throws(
      () => resolveOrganization(subject([{ organizationId: 'acme', roles: [] }]), 'globex', options),
      (error: AIError) => error.code === 'ORGANIZATION_NOT_RESOLVED',
    );
  });

  it('rejects an unauthenticated caller steering the resolution', () => {
    assert.throws(
      () => resolveOrganization(null, 'globex', options),
      (error: AIError) => error.code === 'ORGANIZATION_NOT_RESOLVED',
    );
  });

  it('rejects a malformed organization identifier', () => {
    assert.throws(
      () => resolveOrganization(subject([]), 'acme:../../etc', options),
      (error: AIError) => error.code === 'VALIDATION_FAILED',
    );
  });

  it('falls back to the first membership, then to the configured default', () => {
    assert.equal(
      resolveOrganization(subject([{ organizationId: 'acme', roles: [] }]), undefined, options)
        .organizationId,
      'acme',
    );
    assert.equal(
      resolveOrganization(subject([]), undefined, options).organizationId,
      'marq-cortex',
    );
  });

  it('enforces the organization allow list', () => {
    const restricted = { defaultOrganizationId: 'marq-cortex', allowList: ['globex'] };
    assert.throws(
      () => resolveOrganization(subject([{ organizationId: 'acme', roles: [] }]), undefined, restricted),
      (error: AIError) => error.code === 'ORGANIZATION_NOT_RESOLVED',
    );
  });
});

describe('tenant isolation', () => {
  const organization = resolveOrganization(subject([{ organizationId: 'acme', roles: [] }]), undefined, {
    defaultOrganizationId: 'marq-cortex',
    allowList: [],
  });

  it('accepts a resource belonging to the request organization', () => {
    assert.doesNotThrow(() => assertSameTenant(organization, 'acme', 'submission'));
  });

  it('rejects a resource from another organization', () => {
    assert.throws(
      () => assertSameTenant(organization, 'globex', 'submission'),
      (error: AIError) => error.code === 'TENANT_ISOLATION_VIOLATION',
    );
  });

  it('fails closed on an unscoped resource rather than assuming ownership', () => {
    for (const value of [null, undefined, '']) {
      assert.throws(
        () => assertSameTenant(organization, value, 'submission'),
        (error: AIError) => error.code === 'TENANT_ISOLATION_VIOLATION',
      );
    }
  });

  it('never leaks another tenant id into the caller-facing message', () => {
    try {
      assertSameTenant(organization, 'globex', 'submission');
      assert.fail('expected a tenant isolation violation');
    } catch (error) {
      assert.equal((error as AIError).message.includes('globex'), false);
      assert.match(String((error as AIError).diagnostics), /globex/);
    }
  });

  it('builds storage keys that always carry the tenant prefix', () => {
    const key = tenantScopedKey(organization, 'audit', '2026-07-31', 'aud_1');
    assert.equal(key, 'org:acme:ai:audit:2026-07-31:aud_1');
  });

  it('rejects a key segment that would corrupt the key space', () => {
    assert.throws(() => tenantScopedKey(organization, 'audit', 'bad segment'), AIError);
  });
});

describe('actor and capability resolution', () => {
  it('grants capabilities from the role table', () => {
    const capabilities = capabilitiesForRoles(['reviewer']);
    assert.deepEqual([...capabilities], ['ai.chat.converse', 'ai.narrative.generate']);
  });

  it('is case-insensitive about role spelling', () => {
    assert.deepEqual(capabilitiesForRoles(['ADMIN']), capabilitiesForRoles(['admin']));
  });

  it('unions capabilities across several roles without duplicating', () => {
    const capabilities = capabilitiesForRoles(['reviewer', 'analyst']);
    assert.equal(new Set(capabilities).size, capabilities.length);
    assert.ok(capabilities.includes('ai.analysis.run'));
  });

  it('grants a baseline to an authenticated team member with an unknown role', () => {
    const actor = resolveActor(
      subject([{ organizationId: 'acme', roles: ['typo-role'] }]),
      'acme',
      { allowAnonymous: false },
    );
    assert.deepEqual([...actor.capabilities], ['ai.chat.converse', 'ai.narrative.generate']);
  });

  it('does not escalate the baseline to a privileged capability', () => {
    const actor = resolveActor(
      subject([{ organizationId: 'acme', roles: ['typo-role'] }]),
      'acme',
      { allowAnonymous: false },
    );
    assert.equal(actor.capabilities.includes('ai.section.copilot'), false);
  });

  it('only applies the membership matching the resolved organization', () => {
    const actor = resolveActor(
      subject([
        { organizationId: 'acme', roles: ['admin'] },
        { organizationId: 'globex', roles: ['reviewer'] },
      ]),
      'globex',
      { allowAnonymous: false },
    );
    // Admin rights in acme must not carry into globex.
    assert.equal(actor.capabilities.includes('ai.section.copilot'), false);
  });

  it('refuses to fabricate an actor when authentication is required', () => {
    assert.throws(
      () => resolveActor(null, 'acme', { allowAnonymous: false }),
      (error: AIError) => error.code === 'AUTH_REQUIRED',
    );
  });

  it('produces an anonymous actor with no capabilities when permitted', () => {
    const actor = resolveActor(null, null, { allowAnonymous: true });
    assert.equal(actor.actorType, 'anonymous');
    assert.deepEqual([...actor.capabilities], []);
  });
});
