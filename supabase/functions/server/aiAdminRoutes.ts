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
    extra: { body?: unknown; providerId?: string; limit?: number } = {},
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
  ): void => {
    const handler = async (c: AdminRouteContext): Promise<Response> => {
      const parsed = await readBody(c);
      if (!parsed.ok) return parsed.response;
      return run(c, operation, { body: parsed.body, providerId: providerIdFrom?.(c) });
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
}
