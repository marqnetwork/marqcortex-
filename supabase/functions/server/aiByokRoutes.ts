/**
 * Customer BYOK HTTP routes — AI-01 Batch 4D.
 *
 * Every route in this file is the same four lines: read the transport facts,
 * name the operation, hand both to the BYOK HTTP adapter, return what it
 * produces. Authorization, tenant resolution, capability enforcement,
 * validation, persistence and the administrative audit record all live inside
 * the adapter and the service behind it — so a route cannot forget a check,
 * because there is nothing here to forget.
 *
 * ── WHY THESE ARE NOT ROUTES UNDER `/ai/admin` ───────────────────────────
 *
 * The `/ai/admin/provider-administration` tree is MARQ'S OWN estate: the keys
 * the platform executes with, guarded by `ai.providers.credentials.manage`,
 * held only by the platform operator. Serving customer BYOK from the same paths
 * would mean one route table, one operation vocabulary and one capability set
 * spanning two estates — and the first time somebody widened a grant for the
 * customer surface they would widen it over MARQ's.
 *
 * So the customer surface has its own prefix, its own operations, its own
 * capabilities and its own service. A caller reaching `/ai/organization/...`
 * cannot arrive at a platform credential, and a caller reaching
 * `/ai/admin/...` cannot arrive at a customer's: the two paths dispatch into
 * two services that name two different scope constants.
 *
 * ── THE TENANT IS A HEADER, AND THE HEADER IS A HINT ──────────────────────
 *
 * `X-MARQ-Organization` — the same header the agent and workflow surfaces use.
 * It is never trusted: `resolveOrganization` admits it only when the
 * authenticated subject holds a verified membership in it. An administrator of
 * one customer naming another customer's id receives
 * `ORGANIZATION_NOT_RESOLVED` and an audit record, not that customer's data.
 *
 * There is deliberately NO organization id in any path and NO organization id
 * in any body. A tenant that appears in a URL is a tenant somebody will
 * eventually trust because it looked like a route parameter.
 */

import {
  BYOK_OPERATION,
  executeByokHttpRequest,
  type ByokOperation,
  type ByokService,
} from './ai/index.ts';
import type { AIRouteRegistrar, RouteContext } from './aiRoutes.ts';

export interface AIByokRouteDependencies {
  readonly byok: ByokService;
  /** Route prefix, e.g. `/make-server-324f4fbe`. */
  readonly prefix: string;
}

/** The AI routes' context plus path parameters. Structural, like `RouteContext`. */
export interface ByokRouteContext extends RouteContext {
  readonly req: RouteContext['req'] & { param(name: string): string | undefined };
}

/** POST and PATCH both carry bodies; the AI registrar declares only GET and POST. */
export interface AIByokRouteRegistrar extends AIRouteRegistrar {
  get(path: string, handler: (c: ByokRouteContext) => Response | Promise<Response>): unknown;
  post(path: string, handler: (c: ByokRouteContext) => Promise<Response>): unknown;
  patch(path: string, handler: (c: ByokRouteContext) => Promise<Response>): unknown;
}

function transportOf(c: ByokRouteContext): {
  correlationId?: string;
  clientIp?: string;
  organizationHint?: string;
} {
  const forwardedFor = c.req.header('x-forwarded-for');
  return {
    correlationId: c.req.header('x-correlation-id') ?? c.req.header('x-request-id'),
    clientIp: forwardedFor?.split(',')[0]?.trim() ?? c.req.header('x-real-ip'),
    // A HINT. See the module comment — it narrows and never widens.
    organizationHint: c.req.header('x-marq-organization'),
  };
}

export function registerAIByokRoutes(
  app: AIByokRouteRegistrar,
  deps: AIByokRouteDependencies,
): void {
  const { byok, prefix } = deps;

  const run = async (
    c: ByokRouteContext,
    operation: ByokOperation,
    extra: { body?: unknown; providerId?: string; credentialId?: string } = {},
  ): Promise<Response> => {
    const response = await executeByokHttpRequest(byok, {
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
   * supplied" and would be recorded as a rejection for a request that was
   * really just malformed.
   */
  const readBody = async (
    c: ByokRouteContext,
  ): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> => {
    try {
      return { ok: true, body: await c.req.json() };
    } catch {
      return {
        ok: false,
        response: c.json(
          { success: false, error: 'Request body must be valid JSON.', code: 'VALIDATION_FAILED' },
          400,
        ),
      };
    }
  };

  const mutation = (
    method: 'post' | 'patch',
    path: string,
    operation: ByokOperation,
    extraFrom: (c: ByokRouteContext) => { providerId?: string; credentialId?: string },
  ): void => {
    const handler = async (c: ByokRouteContext): Promise<Response> => {
      const parsed = await readBody(c);
      if (!parsed.ok) return parsed.response;
      return run(c, operation, { body: parsed.body, ...extraFrom(c) });
    };
    if (method === 'post') app.post(`${prefix}${path}`, handler);
    else app.patch(`${prefix}${path}`, handler);
  };

  const providerId = (c: ByokRouteContext) => c.req.param('providerId');

  // ── Reads ─────────────────────────────────────────────────────────────────

  /** Everything the customer credential panel needs, in one authorised call. */
  app.get(`${prefix}/ai/organization/providers`, (c) => run(c, BYOK_OPERATION.status));

  /**
   * Credential METADATA for one provider: names, statuses, fingerprints and
   * timestamps for THIS organization's own rotation history.
   *
   * THERE IS NO SIBLING ROUTE THAT RETURNS A SECRET, and there is no operation
   * name one could be bound to. Once submitted, a provider credential is
   * write-only material.
   */
  app.get(`${prefix}/ai/organization/providers/:providerId/credentials`, (c) =>
    run(c, BYOK_OPERATION.credentialList, { providerId: providerId(c) }),
  );

  // ── Mutations ─────────────────────────────────────────────────────────────

  /** Configure or rotate. One operation, because a rotation is a configure. */
  mutation(
    'post',
    '/ai/organization/providers/:providerId/credentials',
    BYOK_OPERATION.credentialSet,
    (c) => ({ providerId: providerId(c) }),
  );
  mutation(
    'post',
    '/ai/organization/providers/:providerId/credentials/:credentialId/revoke',
    BYOK_OPERATION.credentialRevoke,
    (c) => ({ providerId: providerId(c), credentialId: c.req.param('credentialId') }),
  );
  mutation(
    'patch',
    '/ai/organization/providers/:providerId/fallback',
    BYOK_OPERATION.fallbackSet,
    (c) => ({ providerId: providerId(c) }),
  );
}
