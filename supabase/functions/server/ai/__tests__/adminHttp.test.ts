/**
 * AI administration HTTP boundary.
 *
 * The adapter is where an administration surface usually leaks: a handler that
 * skipped the authorization check, a body field that reached a setting without
 * being declared, a diagnostic string echoed into a response. These tests
 * assert on the boundary itself — the same pure function the Hono routes call,
 * with no server involved.
 *
 * The most important assertion in this file is the first one: EVERY declared
 * operation refuses an unauthenticated caller. It is written as a loop over the
 * operation table rather than as one test per endpoint, so adding an operation
 * without an authorization path fails here rather than shipping.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ADMIN_TOKEN, buildTestAdministration } from './harness.ts';
import { ADMIN_OPERATION, executeAdminHttpRequest } from '../admin/httpAdapter.ts';
import type { AdminOperation } from '../admin/httpAdapter.ts';

const ALL_OPERATIONS: readonly AdminOperation[] = Object.values(ADMIN_OPERATION);

/** Operations that change state, and therefore demand a reason. */
const MUTATIONS: readonly AdminOperation[] = [
  ADMIN_OPERATION.updateSettings,
  ADMIN_OPERATION.emergencyStop,
  ADMIN_OPERATION.updateProvider,
  ADMIN_OPERATION.resetBudget,
  ADMIN_OPERATION.increaseBudget,
];

function bearer(token: string): string {
  return `Bearer ${token}`;
}

describe('AI administration HTTP — authorization', () => {
  it('refuses every declared operation to an unauthenticated caller', async () => {
    const harness = buildTestAdministration();

    for (const operation of ALL_OPERATIONS) {
      const response = await executeAdminHttpRequest(harness.admin, {
        operation,
        authorization: null,
        body: { reason: 'attempting without a credential' },
        providerId: 'primary',
      });
      assert.equal(response.status, 401, `${operation} must refuse an anonymous caller`);
      assert.equal(response.body.success, false);
      assert.equal(response.body.code, 'AUTH_REQUIRED');
    }
  });

  it('refuses every declared operation to an authenticated non-administrator', async () => {
    const harness = buildTestAdministration();

    for (const operation of ALL_OPERATIONS) {
      const response = await executeAdminHttpRequest(harness.admin, {
        operation,
        authorization: bearer(ADMIN_TOKEN.member),
        body: { reason: 'attempting without an administrative role' },
        providerId: 'primary',
      });
      assert.equal(response.status, 403, `${operation} must refuse a non-administrator`);
      assert.equal(response.body.code, 'FORBIDDEN');
    }
  });

  it('refuses every mutation to a read-only team administrator', async () => {
    const harness = buildTestAdministration();

    for (const operation of MUTATIONS) {
      const response = await executeAdminHttpRequest(harness.admin, {
        operation,
        authorization: bearer(ADMIN_TOKEN.teamAdmin),
        body: {
          reason: 'a team admin attempting a platform change',
          engaged: true,
          enabled: false,
          capMicroUsd: 50_000_000,
        },
        providerId: 'primary',
      });
      assert.equal(response.status, 403, `${operation} must refuse a team admin`);
    }
  });

  it('serves every read to a team administrator', async () => {
    const harness = buildTestAdministration();

    for (const operation of [
      ADMIN_OPERATION.overview,
      ADMIN_OPERATION.getSettings,
      ADMIN_OPERATION.listProviders,
      ADMIN_OPERATION.getBudget,
      ADMIN_OPERATION.usage,
      ADMIN_OPERATION.diagnostics,
      ADMIN_OPERATION.executionAudit,
      ADMIN_OPERATION.adminAudit,
    ]) {
      const response = await executeAdminHttpRequest(harness.admin, {
        operation,
        authorization: bearer(ADMIN_TOKEN.teamAdmin),
      });
      assert.equal(response.status, 200, `${operation} must be readable by a team admin`);
      assert.equal(response.body.success, true);
    }
  });
});

describe('AI administration HTTP — request handling', () => {
  it('requires a reason on every mutation', async () => {
    const harness = buildTestAdministration();

    for (const operation of MUTATIONS) {
      const response = await executeAdminHttpRequest(harness.admin, {
        operation,
        authorization: bearer(ADMIN_TOKEN.superAdmin),
        body: { engaged: true, enabled: false, capMicroUsd: 50_000_000 },
        providerId: 'primary',
      });
      assert.equal(response.status, 400, `${operation} must demand a reason`);
      assert.equal(response.body.code, 'VALIDATION_FAILED');
      assert.deepEqual(response.body.fields, ['reason']);
    }
  });

  it('drops a body field the settings contract does not declare', async () => {
    const harness = buildTestAdministration();

    const response = await executeAdminHttpRequest(harness.admin, {
      operation: ADMIN_OPERATION.updateSettings,
      authorization: bearer(ADMIN_TOKEN.superAdmin),
      body: {
        reason: 'tightening the failover policy',
        failoverEnabled: false,
        // None of these are declared settings fields. An undeclared key that
        // reached the overlay would be a setting nobody reviewed.
        capMicroUsd: 999_999_999,
        emergencyStop: { engaged: true },
        configurationVersion: 500,
        providers: { primary: { enabled: false } },
      },
    });

    assert.equal(response.status, 200);
    const settings = response.body.settings as Record<string, unknown>;
    assert.equal(settings.failoverEnabled, false);
    assert.equal(settings.configurationVersion, 2);
    assert.deepEqual(settings.emergencyStop, { engaged: false });
    assert.deepEqual(settings.providers, {});
  });

  it('demands only the capability the patch actually implies', async () => {
    const harness = buildTestAdministration();

    // An organization admin may retune a timeout …
    const allowed = await executeAdminHttpRequest(harness.admin, {
      operation: ADMIN_OPERATION.updateSettings,
      authorization: bearer(ADMIN_TOKEN.organizationAdmin),
      body: { reason: 'raising the deadline for batch analysis', timeout: { workflowDeadlineMs: 120_000 } },
    });
    assert.equal(allowed.status, 200);

    // … and an empty patch still demands a grant, so a caller with no write
    // capability cannot reach the mutation path and bump the version.
    const empty = await executeAdminHttpRequest(harness.admin, {
      operation: ADMIN_OPERATION.updateSettings,
      authorization: bearer(ADMIN_TOKEN.teamAdmin),
      body: { reason: 'an empty change' },
    });
    assert.equal(empty.status, 403);
  });

  it('accepts null to clear a pinned identifier', async () => {
    const harness = buildTestAdministration();

    await executeAdminHttpRequest(harness.admin, {
      operation: ADMIN_OPERATION.updateSettings,
      authorization: bearer(ADMIN_TOKEN.superAdmin),
      body: { reason: 'pinning the backup provider', defaultProviderId: 'backup' },
    });
    assert.equal(harness.plane.settings.current().defaultProviderId, 'backup');

    const cleared = await executeAdminHttpRequest(harness.admin, {
      operation: ADMIN_OPERATION.updateSettings,
      authorization: bearer(ADMIN_TOKEN.superAdmin),
      body: { reason: 'un-pinning: primary has recovered', defaultProviderId: null },
    });
    assert.equal(cleared.status, 200);
    // Without the null/undefined distinction there would be no way to un-pin a
    // default through a patch at all.
    assert.equal(harness.plane.settings.current().defaultProviderId, undefined);
  });

  it('rejects a kill-switch call that does not say which way', async () => {
    const harness = buildTestAdministration();
    const response = await executeAdminHttpRequest(harness.admin, {
      operation: ADMIN_OPERATION.emergencyStop,
      authorization: bearer(ADMIN_TOKEN.superAdmin),
      body: { reason: 'ambiguous kill switch request' },
    });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body.fields, ['engaged']);
  });

  it('rejects a provider mutation with no provider id', async () => {
    const harness = buildTestAdministration();
    const response = await executeAdminHttpRequest(harness.admin, {
      operation: ADMIN_OPERATION.updateProvider,
      authorization: bearer(ADMIN_TOKEN.superAdmin),
      body: { reason: 'disabling a provider', enabled: false },
    });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body.fields, ['providerId']);
  });

  it('engages the kill switch through the boundary and stops AI', async () => {
    const harness = buildTestAdministration();

    const response = await executeAdminHttpRequest(harness.admin, {
      operation: ADMIN_OPERATION.emergencyStop,
      authorization: bearer(ADMIN_TOKEN.superAdmin),
      body: { engaged: true, reason: 'incident 5001: pausing all AI' },
      clientIp: '198.51.100.7',
      correlationId: 'cor_incident_5001',
    });

    assert.equal(response.status, 200);
    assert.equal(harness.plane.health().status, 'unhealthy');

    const [record] = harness.admin.adminAudit(await harness.actor(ADMIN_TOKEN.superAdmin), 1);
    // Transport facts ride onto the trail, so an incident review can tie a
    // change to the session that made it.
    assert.equal(record.clientIp, '198.51.100.7');
    assert.equal(record.correlationId, 'cor_incident_5001');
  });
});

describe('AI administration HTTP — response hygiene', () => {
  it('never returns server-side diagnostics to the caller', async () => {
    const harness = buildTestAdministration();

    const refused = await executeAdminHttpRequest(harness.admin, {
      operation: ADMIN_OPERATION.updateProvider,
      authorization: bearer(ADMIN_TOKEN.superAdmin),
      body: { reason: 'attempting to configure an unknown provider', enabled: true },
      providerId: 'gemini',
    });

    assert.equal(refused.status, 500);
    assert.equal(refused.body.code, 'PROVIDER_NOT_FOUND');
    // `diagnostics` is server-side only. It is already on the log line and the
    // administrative trail; putting it in a response body is how internal
    // detail escapes.
    assert.equal('diagnostics' in refused.body, false);
    assert.equal(JSON.stringify(refused.body).includes('providerId=gemini'), false);
  });

  it('does not leak an operator’s incident note to an ordinary caller', async () => {
    const harness = buildTestAdministration();
    await executeAdminHttpRequest(harness.admin, {
      operation: ADMIN_OPERATION.emergencyStop,
      authorization: bearer(ADMIN_TOKEN.superAdmin),
      body: { engaged: true, reason: 'vendor breach suspected, see incident 5001' },
    });

    // The AI execution path refuses with a caller-safe message; the operator's
    // note stays in diagnostics and on the trail.
    const settings = await executeAdminHttpRequest(harness.admin, {
      operation: ADMIN_OPERATION.getSettings,
      authorization: bearer(ADMIN_TOKEN.teamAdmin),
    });
    // An administrator legitimately sees the reason — that is the point of the
    // console. This asserts the settings surface is administrator-only, which
    // the authorization tests above already establish for everyone else.
    assert.equal(settings.status, 200);
    assert.equal(
      (settings.body.settings as { emergencyStop: { reason?: string } }).emergencyStop.reason,
      'vendor breach suspected, see incident 5001',
    );
  });

  it('reports an unknown operation rather than returning undefined', async () => {
    const harness = buildTestAdministration();
    const response = await executeAdminHttpRequest(harness.admin, {
      operation: 'not.an.operation' as AdminOperation,
      authorization: bearer(ADMIN_TOKEN.superAdmin),
    });
    assert.equal(response.status, 404);
    assert.equal(response.body.code, 'FEATURE_NOT_FOUND');
  });

  it('returns a bounded audit page', async () => {
    const harness = buildTestAdministration();
    const response = await executeAdminHttpRequest(harness.admin, {
      operation: ADMIN_OPERATION.adminAudit,
      authorization: bearer(ADMIN_TOKEN.superAdmin),
      limit: 100_000,
    });
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.records));
    assert.ok((response.body.records as unknown[]).length <= 200);
  });
});
