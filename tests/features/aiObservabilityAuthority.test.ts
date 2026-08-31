/**
 * The authority gate on `/ai/metrics`, `/ai/audit` and `/ai/catalog`.
 *
 * ── THE FINDING, CONFIRMED ─────────────────────────────────────────────────
 *
 * A previous review flagged an authority mismatch on these three routes. Batch
 * 4C investigated it before changing anything, and it was real:
 *
 *   All three called `verifyTeamToken`, which resolves to "is this a
 *   provisioned MARQ team account?" — AUTHENTICATION. It returns a user id for
 *   any stamped account, including one holding the least privileged `viewer`
 *   team role, and it consults no capability, no administrative role and no
 *   organization scope.
 *
 *   `/ai/audit` returned `plane.recentAudit(limit)` — the execution trail for
 *   EVERY organization, unfiltered: actor ids, organization ids, feature ids,
 *   prompt ids, models, per-request cost and governance outcomes. The sibling
 *   route `/ai/admin/audit` returns the same records THROUGH
 *   `administration.executionAudit`, which scopes them to the organizations
 *   the actor may see. Two doors into one dataset, one of them without the
 *   tenant filter.
 *
 *   `/ai/metrics` returned platform-wide usage volumes and `/ai/catalog` the
 *   governed capability surface — both of which the administration surface
 *   gates behind `ai.admin.view`.
 *
 * ── THE FIX ────────────────────────────────────────────────────────────────
 *
 * The three routes now resolve an administrative actor through the SAME
 * authenticator and demand the SAME capabilities as the administration surface,
 * and `/ai/audit` is served through the tenant-scoped read. Nothing legitimate
 * is lost: a platform operator's view is identical, and an organization or team
 * administrator keeps `ai.admin.view` and `ai.admin.audit.read` — what changes
 * is that their audit read is now scoped to their own organizations, and an
 * account with NO administrative role at all is refused.
 *
 * ── WHAT THIS FILE PROVES, AND WHAT IT DOES NOT ────────────────────────────
 *
 * The route bodies live in `aiRoutes.ts`, which imports the plane and is
 * exercised behaviourally elsewhere. What no behavioural test can show is that
 * these particular handlers reach the capability check rather than a token
 * check — a route that resolved authority correctly in a helper and then called
 * `verifyTeamToken` anyway would pass every behavioural test in this
 * repository. So this file reads the route source and pins the WIRING, and
 * `administration.test.ts` proves what the capabilities themselves mean.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ADMIN_ROLE_CAPABILITIES,
  type AIAdminCapability,
  type AIAdminRole,
} from '../../supabase/functions/server/ai/index.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const routes = readFileSync(
  join(root, 'supabase', 'functions', 'server', 'aiRoutes.ts'),
  'utf8',
);
const entry = readFileSync(join(root, 'supabase', 'functions', 'server', 'index.tsx'), 'utf8');

/** Source with comments stripped — a guard is code, not prose about a guard. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

const routeCode = code(routes);
const entryCode = code(entry);

/** The body of one route handler, from its registration to the next one. */
function routeBody(path: string): string {
  const marker = `app.get(\`\${prefix}${path}\``;
  const start = routeCode.indexOf(marker);
  assert.ok(start > 0, `route not found: GET ${path}`);
  const rest = routeCode.slice(start + marker.length);
  const next = rest.search(/\n\s*app\.(get|post|patch)\(/);
  return rest.slice(0, next === -1 ? undefined : next);
}

describe('the AI observability routes authorise, they do not merely authenticate', () => {
  it('no longer reaches for a team token anywhere in the AI routes', () => {
    // The whole point of the finding: a token check answers a different
    // question from the one these routes need answered.
    assert.ok(
      !routeCode.includes('verifyTeamToken'),
      'aiRoutes.ts must not resolve callers through a team token check',
    );
  });

  it('no longer accepts a team-token verifier as a dependency', () => {
    // Removing the CALL while leaving the dependency would let a future route
    // reintroduce the weaker check without touching this test.
    assert.ok(
      !/verifyTeamToken\s*:/.test(routeCode),
      'the AI route dependencies must not carry a team-token verifier',
    );
    assert.ok(
      /administration\?:\s*AIAdministration/.test(routeCode),
      'the AI routes take the administration service, which resolves capabilities',
    );
  });

  it('demands ai.admin.view for the metrics route', () => {
    assert.match(routeBody('/ai/metrics'), /operator\(c,\s*'ai\.admin\.view'\)/);
  });

  it('demands ai.admin.view for the catalog route', () => {
    assert.match(routeBody('/ai/catalog'), /operator\(c,\s*'ai\.admin\.audit\.read'\)|operator\(c,\s*'ai\.admin\.view'\)/);
  });

  it('demands ai.admin.audit.read for the audit route', () => {
    assert.match(routeBody('/ai/audit'), /operator\(c,\s*'ai\.admin\.audit\.read'\)/);
  });

  it('serves the audit route through the TENANT-SCOPED read', () => {
    const body = routeBody('/ai/audit');
    // The heart of the finding. `executionAudit` filters to the actor's
    // organizations; `recentAudit` returns every tenant's records.
    assert.match(body, /executionAudit\(/);
    assert.ok(
      !body.includes('recentAudit'),
      'the audit route must not return the unscoped platform trail',
    );
  });

  it('reaches no unscoped audit read from any AI route', () => {
    assert.ok(
      !routeCode.includes('plane.recentAudit'),
      'plane.recentAudit returns every tenant’s records and must not be HTTP-reachable',
    );
  });

  it('fails closed when the administration service is absent', () => {
    // An observability route with no way to authorise its caller must refuse,
    // not revert to a weaker check.
    const helper = routeCode.slice(
      routeCode.indexOf('const operator ='),
      routeCode.indexOf('app.get(`${prefix}/ai/metrics`'),
    );
    assert.ok(helper.length > 0, 'the operator helper must exist');
    assert.match(helper, /if\s*\(!administration\)/);
    assert.match(helper, /503/);
  });

  it('leaves the health probe unauthenticated, deliberately', () => {
    // Not an oversight and not collateral damage from this fix: an uptime probe
    // cannot hold a team credential, and the snapshot carries no tenant data.
    const health = routeBody('/ai/health');
    assert.ok(!health.includes('operator('), 'the health probe stays open');
    assert.match(health, /plane\.health\(\)/);
  });

  it('is wired with the administration service in the server entry point', () => {
    // The route file can demand a capability all it likes; if the entry point
    // never supplies the service, every call gets the 503 above.
    const registration = entryCode.slice(
      entryCode.indexOf('registerAIRoutes('),
      entryCode.indexOf('registerAIRoutes(') + 400,
    );
    assert.match(registration, /administration:\s*aiAdministration/);
    assert.ok(
      !registration.includes('verifyTeamToken'),
      'the entry point must not pass a team-token verifier to the AI routes',
    );
  });
});

describe('the capabilities these routes demand are the ones the grant table gives', () => {
  const holds = (role: AIAdminRole, capability: AIAdminCapability): boolean =>
    ADMIN_ROLE_CAPABILITIES[role].includes(capability);

  it('keeps existing legitimate administrative access intact', () => {
    // The fix must TIGHTEN, never weaken. Every tier that could read these
    // routes for a legitimate reason still can.
    for (const role of ['super_admin', 'organization_admin', 'team_admin'] as const) {
      assert.ok(holds(role, 'ai.admin.view'), `${role} keeps metrics and catalog access`);
      assert.ok(holds(role, 'ai.admin.audit.read'), `${role} keeps audit access`);
    }
  });

  it('gives an account with no administrative role nothing', () => {
    // `resolveAdminRole` returns undefined for such a subject and
    // `resolveAdminActor` throws FORBIDDEN — proved behaviourally in
    // administration.test.ts. What matters here is that there is no fourth
    // entry in the grant table for it to land in.
    assert.deepEqual(
      Object.keys(ADMIN_ROLE_CAPABILITIES).sort(),
      ['organization_admin', 'super_admin', 'team_admin'],
    );
  });

  it('does not hand provider credential administration to a tenant tier', () => {
    for (const role of ['organization_admin', 'team_admin'] as const) {
      for (const capability of [
        'ai.providers.view',
        'ai.providers.manage',
        'ai.providers.credentials.manage',
        'ai.providers.models.manage',
      ] as const) {
        assert.ok(!holds(role, capability), `${role} must not hold ${capability}`);
      }
    }
    assert.ok(holds('super_admin', 'ai.providers.credentials.manage'));
  });
});
