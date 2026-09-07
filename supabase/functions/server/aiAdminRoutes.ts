/**
 * AI administration HTTP routes (AI-01 Batch 2).
 *
 * Every route in this file is the same four lines: read the transport facts,
 * name the operation, hand both to the admin HTTP adapter, return what it
 * produces. Authorization, capability enforcement, validation, persistence and
 * the administrative audit record all live inside the adapter and the service
 * behind it — so a route cannot forget a check, because there is nothing here
 * to forget.
 *
 * Compare this with the shape a console usually grows: one handler per
 * operation, each repeating its own role comparison. That is the pattern that
 * produced the Batch 1 finding where two AI endpoints had no authentication at
 * all. Here the operation name is the ONLY thing a route contributes, and the
 * operation name cannot be read from the request body — it is bound by this
 * table, so a caller cannot ask for `budget.reset` at the `usage` endpoint.
 *
 * Note what these routes do NOT do: they never touch `verifyTeamToken`. The
 * administration surface resolves its caller through the same `AIAuthenticator`
 * port the AI Guard uses, which returns roles and memberships resolved
 * server-side. A bearer-token check that only proves "some team member" is the
 * distinction between authentication and authorization, and this surface needs
 * the second one.
 */

import {
  ADMIN_OPERATION,
  executeAdminHttpRequest,
  type AdminOperation,
  type AIAdministration,
} from './ai/index.ts';
import type { AIRouteRegistrar, RouteContext } from './aiRoutes.ts';

export interface AIAdminRouteDependencies {
  readonly administration: AIAdministration;
  /** Route prefix, e.g. `/make-server-324f4fbe`. */
  readonly prefix: string;
}

/**
 * The AI routes' context plus path parameters, which only the administration
 * surface needs (`/providers/:providerId`). Declared structurally, like
 * `RouteContext` itself, so Hono stays swappable.
 */
export interface AdminRouteContext extends RouteContext {
  readonly req: RouteContext['req'] & { param(name: string): string | undefined };
}

/** PATCH and POST both carry bodies; the AI registrar declares only GET and POST. */
export interface AIAdminRouteRegistrar extends AIRouteRegistrar {
  get(path: string, handler: (c: AdminRouteContext) => Response | Promise<Response>): unknown;
  post(path: string, handler: (c: AdminRouteContext) => Promise<Response>): unknown;
  patch(path: string, handler: (c: AdminRouteContext) => Promise<Response>): unknown;
}

function transportOf(c: AdminRouteContext): { correlationId?: string; clientIp?: string } {
  const forwardedFor = c.req.header('x-forwarded-for');
  return {
    correlationId: c.req.header('x-correlation-id') ?? c.req.header('x-request-id'),
    clientIp: forwardedFor?.split(',')[0]?.trim() ?? c.req.header('x-real-ip'),
  };
}

/** Bounded page size. Out-of-range values fall back rather than failing. */
function limitOf(c: AdminRouteContext): number | undefined {
  const raw = c.req.query('limit');
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function registerAIAdminRoutes(
  app: AIAdminRouteRegistrar,
  deps: AIAdminRouteDependencies,
): void {
  const { administration, prefix } = deps;

  const run = async (
    c: AdminRouteContext,
    operation: AdminOperation,
    extra: {
      body?: unknown;
      providerId?: string;
      organizationId?: string;
      modelId?: string;
      credentialId?: string;
      limit?: number;
    } = {},
  ): Promise<Response> => {
    const response = await executeAdminHttpRequest(administration, {
      operation,
      authorization: c.req.header('Authorization') ?? null,
      ...transportOf(c),
      ...extra,
    });
    return c.json(response.body, response.status);
  };

  /**
   * Read a JSON body, or fail the same shape a validation error would.
   *
   * A malformed body never reaches the adapter, so it cannot be mistaken for a
   * body that parsed to `{}` — which for a mutation would mean "no reason
   * supplied" and would be recorded as an administrative rejection for a
   * request that was really just malformed.
   */
  const readBody = async (c: AdminRouteContext): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> => {
    try {
      return { ok: true, body: await c.req.json() };
    } catch {
      return {
        ok: false,
        response: c.json(
          {
            success: false,
            error: 'Request body must be valid JSON.',
            code: 'VALIDATION_FAILED',
          },
          400,
        ),
      };
    }
  };

  const mutation = (
    method: 'post' | 'patch',
    path: string,
    operation: AdminOperation,
    providerIdFrom?: (c: AdminRouteContext) => string | undefined,
    /**
     * Extra PATH parameters, for the Batch 4C model and credential routes.
     *
     * Path, not body, and that is the security-relevant half: the operation
     * name and the object it acts on both come from the route table, so a
     * caller cannot ask for one provider's credential at another provider's
     * endpoint, and the audit target cannot be steered by a request body.
     */
    extraFrom?: (
      c: AdminRouteContext,
    ) => { modelId?: string; credentialId?: string; organizationId?: string },
  ): void => {
    const handler = async (c: AdminRouteContext): Promise<Response> => {
      const parsed = await readBody(c);
      if (!parsed.ok) return parsed.response;
      return run(c, operation, {
        body: parsed.body,
        providerId: providerIdFrom?.(c),
        ...(extraFrom?.(c) ?? {}),
      });
    };
    if (method === 'post') app.post(`${prefix}${path}`, handler);
    else app.patch(`${prefix}${path}`, handler);
  };

  // ── Reads ─────────────────────────────────────────────────────────────────

  /** Everything the console's landing view needs, in one authorised call. */
  app.get(`${prefix}/ai/admin/overview`, (c) => run(c, ADMIN_OPERATION.overview));
  app.get(`${prefix}/ai/admin/settings`, (c) => run(c, ADMIN_OPERATION.getSettings));
  app.get(`${prefix}/ai/admin/providers`, (c) => run(c, ADMIN_OPERATION.listProviders));
  app.get(`${prefix}/ai/admin/budget`, (c) => run(c, ADMIN_OPERATION.getBudget));
  app.get(`${prefix}/ai/admin/usage`, (c) => run(c, ADMIN_OPERATION.usage));
  // Routing and its economics (AI-01 Batch 4F). A READ, bound to a GET: there
  // is no route on this surface that writes routing directly — the strategy and
  // the failover breadth are fields of the settings patch, so they pass through
  // the same authorisation, normalisation, envelope and audit every other
  // setting does.
  app.get(`${prefix}/ai/admin/routing`, (c) =>
    run(c, ADMIN_OPERATION.routing, { limit: limitOf(c) }),
  );
  app.get(`${prefix}/ai/admin/diagnostics`, (c) => run(c, ADMIN_OPERATION.diagnostics));

  /** The AI execution trail, tenant-scoped to what this administrator may see. */
  app.get(`${prefix}/ai/admin/audit`, (c) =>
    run(c, ADMIN_OPERATION.executionAudit, { limit: limitOf(c) }),
  );
  /** The administrative change trail. Read-only; there is no write route. */
  app.get(`${prefix}/ai/admin/audit/changes`, (c) =>
    run(c, ADMIN_OPERATION.adminAudit, { limit: limitOf(c) }),
  );

  // ── Mutations ─────────────────────────────────────────────────────────────

  mutation('patch', '/ai/admin/settings', ADMIN_OPERATION.updateSettings);
  mutation('post', '/ai/admin/kill-switch', ADMIN_OPERATION.emergencyStop);
  mutation('patch', '/ai/admin/providers/:providerId', ADMIN_OPERATION.updateProvider, (c) =>
    c.req.param('providerId'),
  );
  mutation('post', '/ai/admin/budget/reset', ADMIN_OPERATION.resetBudget);
  mutation('post', '/ai/admin/budget/increase', ADMIN_OPERATION.increaseBudget);

  // ── Organization spend administration (4D remediation, HIGH-1) ────────────
  //
  // A SEPARATE PATH TREE, and the separation is the same one Batch 4D made
  // between MARQ's estate and a customer's. `/ai/admin/budget` is MARQ's own
  // lifetime ceiling and takes no organization anywhere — not in the path, not
  // in a body — so no request to it can be steered at a tenant. These paths
  // name the tenant in the PATH, where the route table binds it, and dispatch
  // into service methods whose scope is built from that id and cannot produce
  // `SPEND_SCOPE.platform`.
  //
  // A caller reaching these needs `ai.admin.budget.organization`; a caller
  // reaching the two above needs `ai.admin.budget.reset`. Neither grant is
  // implied by the other.
  const organizationId = (c: AdminRouteContext) => c.req.param('organizationId');

  app.get(`${prefix}/ai/admin/budget/organizations/:organizationId`, (c) =>
    run(c, ADMIN_OPERATION.getOrganizationBudget, { organizationId: organizationId(c) }),
  );
  mutation(
    'post',
    '/ai/admin/budget/organizations/:organizationId/reset',
    ADMIN_OPERATION.resetOrganizationBudget,
    undefined,
    (c) => ({ organizationId: organizationId(c) }),
  );
  mutation(
    'post',
    '/ai/admin/budget/organizations/:organizationId/increase',
    ADMIN_OPERATION.increaseOrganizationBudget,
    undefined,
    (c) => ({ organizationId: organizationId(c) }),
  );

  // ── Provider administration (AI-01 Batch 4C) ──────────────────────────────
  //
  // Registered under `/ai/admin/provider-administration` rather than extending
  // `/ai/admin/providers`, because the two answer different questions and a
  // deployed console reads both: `/providers` is the Batch 2 operational view
  // (preference order, allow lists, selection reasons) and this is the Batch 4C
  // administration view (configuration, credential state, model governance,
  // exposure). Overloading one path would have made the older console's
  // response shape a constraint on the newer one's.
  //
  // Every path below names its object in the PATH. There is deliberately no
  // route that reads a provider id, a model id or a credential id from a body.
  const providerId = (c: AdminRouteContext) => c.req.param('providerId');

  app.get(`${prefix}/ai/admin/provider-administration`, (c) =>
    run(c, ADMIN_OPERATION.providerAdministration),
  );
  app.get(`${prefix}/ai/admin/provider-administration/:providerId`, (c) =>
    run(c, ADMIN_OPERATION.providerDetail, { providerId: providerId(c) }),
  );
  /**
   * Credential METADATA. Fingerprints, names, statuses and timestamps.
   *
   * THERE IS NO SIBLING ROUTE THAT RETURNS A SECRET, and there is no operation
   * name one could be bound to. Once submitted, a provider credential is
   * write-only material.
   */
  app.get(`${prefix}/ai/admin/provider-administration/:providerId/credentials`, (c) =>
    run(c, ADMIN_OPERATION.providerCredentialList, { providerId: providerId(c) }),
  );

  mutation(
    'post',
    '/ai/admin/provider-administration/:providerId/enabled',
    ADMIN_OPERATION.providerSetEnabled,
    providerId,
  );
  /** Set or rotate. One operation, because a rotation is a set with a predecessor. */
  mutation(
    'post',
    '/ai/admin/provider-administration/:providerId/credentials',
    ADMIN_OPERATION.providerSetCredential,
    providerId,
  );
  mutation(
    'post',
    '/ai/admin/provider-administration/:providerId/credentials/:credentialId/revoke',
    ADMIN_OPERATION.providerRevokeCredential,
    providerId,
    (c) => ({ credentialId: c.req.param('credentialId') }),
  );
  mutation(
    'patch',
    '/ai/admin/provider-administration/:providerId/models/:modelId',
    ADMIN_OPERATION.providerSetModelEnabled,
    providerId,
    (c) => ({ modelId: c.req.param('modelId') }),
  );

  /**
   * Define a self-hosted, OpenAI-compatible provider (AI-01 Batch 4E).
   *
   * The one route on this surface whose body names a HOST the runtime will
   * dial. It has no path parameter because it CREATES the object the other
   * routes address — and, like every route in this file, it contributes only
   * the operation name: the capability, the endpoint policy, the exposure
   * guard and the audit record all live behind the adapter.
   *
   * It takes no secret. A credential for the new provider is stored afterwards
   * through the credential route above.
   */
  mutation(
    'post',
    '/ai/admin/provider-administration/self-hosted',
    ADMIN_OPERATION.providerDefineSelfHosted,
  );
  /** Replace an existing self-hosted definition (4E remediation, M-4). */
  mutation(
    'patch',
    '/ai/admin/provider-administration/self-hosted/:providerId',
    ADMIN_OPERATION.providerUpdateSelfHosted,
    providerId,
  );
  /**
   * MARQ's certification decision (4E remediation, H-1).
   *
   * Its own route, so certification cannot ride on a definition or an
   * enable/disable body. Like every route here it contributes only the
   * operation name: the capability, the permitted states, the exposure
   * re-check and the audit record all live behind the adapter.
   */
  mutation(
    'post',
    '/ai/admin/provider-administration/:providerId/certification',
    ADMIN_OPERATION.providerSetCertification,
    providerId,
  );
}
