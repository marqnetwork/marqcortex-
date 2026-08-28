/**
 * AI HTTP routes.
 *
 * The Hono binding for the AI Control Plane. Every route in this file is the
 * same three lines: read the transport facts, hand them to the HTTP adapter,
 * return what it produces. All security, policy, governance and observability
 * live inside the plane, so a route cannot forget a check — there is nothing
 * here to forget.
 *
 * Compare with the pre-Batch-1 handlers this replaces: each one repeated its own
 * auth check, its own field validation, its own credential probe and its own
 * error mapping, and two of them (`/blocks/ai-assist`, `/blocks/copilot-interpret`)
 * had no authentication at all — any holder of the public anon key could spend
 * the platform's model budget. That class of defect is now structurally
 * impossible: the guard runs before a feature is reached, for every feature.
 */

import {
  correlationIdFromHeaders,
  executeAIHttpRequest,
  FEATURE,
  hasAIAdminCapability,
  toAIError,
  type AIAdministration,
  type AIChannel,
  type AIControlPlane,
  type AIHttpRequest,
} from './ai/index.ts';

export interface AIRouteDependencies {
  readonly plane: AIControlPlane;
  /**
   * The AI administration service, used to AUTHORIZE the three operator-only
   * observability routes (AI-01 Batch 4C security follow-up).
   *
   * ── WHAT THIS REPLACED, AND WHY IT WAS WRONG ─────────────────────────────
   *
   * `/ai/metrics`, `/ai/audit` and `/ai/catalog` previously verified a team
   * bearer token and nothing else: `verifyTeamToken` answers "is this a
   * provisioned MARQ team account?", which is AUTHENTICATION. What these routes
   * hand back is platform-wide operational data, and one of them —
   * `/ai/audit` — returned the execution trail for EVERY organization: actor
   * ids, organization ids, feature ids, prompt ids, models, costs and
   * governance outcomes, unfiltered. Any provisioned team account, including
   * one holding the least privileged `viewer` role, could read every tenant's
   * AI activity.
   *
   * Meanwhile the sibling surface — `/ai/admin/*` — resolved an administrative
   * actor and enforced a named capability for the same class of data. Two
   * doors into comparable information with two different locks is one lock too
   * few, and the weaker one was load-bearing.
   *
   * So these routes now resolve the SAME actor through the SAME authenticator
   * and demand the SAME capabilities the administration surface does, and
   * `/ai/audit` is served through `administration.executionAudit`, which
   * filters to the organizations the actor may see. A platform operator's view
   * is unchanged; a tenant administrator now sees their own tenants; an
   * ordinary team account sees nothing.
   *
   * OPTIONAL, AND ABSENCE FAILS CLOSED. Without the service these three routes
   * refuse every caller rather than falling back to a token check.
   */
  readonly administration?: AIAdministration;
  /** Route prefix, e.g. `/make-server-324f4fbe`. */
  readonly prefix: string;
}

/** The Hono context surface these routes use. Structural, so Hono stays swappable. */
export interface RouteContext {
  req: {
    header(name: string): string | undefined;
    json(): Promise<unknown>;
    query(name: string): string | undefined;
  };
  json(body: unknown, status?: number): Response;
  header(name: string, value: string): void;
}

/**
 * The registration surface, declared structurally rather than as `Hono`.
 *
 * Hono types its handler against its own `Context`, and TypeScript compares
 * function parameters contravariantly, so a handler declared against the narrow
 * `RouteContext` above is not assignable to Hono's signature even though every
 * runtime call is valid. Declaring what this module actually needs — two
 * methods — keeps the handlers precisely typed and confines the mismatch to a
 * single documented cast at the call site in index.tsx.
 */
export interface AIRouteRegistrar {
  post(path: string, handler: (c: RouteContext) => Promise<Response>): unknown;
  get(path: string, handler: (c: RouteContext) => Response | Promise<Response>): unknown;
}

function transportOf(c: RouteContext, featureId: string, body: unknown): AIHttpRequest {
  const forwardedFor = c.req.header('x-forwarded-for');
  const channelHeader = c.req.header('x-marq-channel');
  const channel: AIChannel =
    channelHeader === 'client_portal' || channelHeader === 'system'
      ? channelHeader
      : 'team_console';

  return {
    featureId,
    body,
    authorization: c.req.header('Authorization') ?? null,
    correlationId: correlationIdFromHeaders((name) => c.req.header(name)),
    organizationHint: c.req.header('x-marq-organization'),
    clientIp: forwardedFor?.split(',')[0]?.trim() ?? c.req.header('x-real-ip'),
    userAgent: c.req.header('user-agent'),
    contentLength: parseContentLength(c.req.header('content-length')),
    channel,
  };
}

function parseContentLength(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function registerAIRoutes(app: AIRouteRegistrar, deps: AIRouteDependencies): void {
  const { plane, prefix } = deps;

  /** Bind one feature to one path. Identical for every feature, by design. */
  const featureRoute = (path: string, featureId: string): void => {
    app.post(`${prefix}${path}`, async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        // A malformed body never reaches the plane, so it produces the same
        // shaped error a validation failure would.
        return c.json(
          {
            success: false,
            error: 'Request body must be valid JSON.',
            code: 'VALIDATION_FAILED',
            retryable: false,
          },
          400,
        );
      }

      const response = await executeAIHttpRequest(plane, transportOf(c, featureId, body));
      for (const [name, value] of Object.entries(response.headers)) {
        if (name.toLowerCase() !== 'content-type') c.header(name, value);
      }
      return c.json(response.body, response.status);
    });
  };

  featureRoute('/cortex/narrative', FEATURE.narrative);
  featureRoute('/ai/chat', FEATURE.chat);
  featureRoute('/blocks/ai-assist', FEATURE.blockAssist);
  featureRoute('/blocks/copilot-interpret', FEATURE.copilotPlan);
  featureRoute('/proposal/section-copilot', FEATURE.sectionCopilot);

  // ── Operations ────────────────────────────────────────────────────────────

  /**
   * Unauthenticated by design: an uptime probe cannot hold a team credential,
   * and the snapshot carries no tenant data — only provider states, feature
   * counts and prompt fingerprints.
   */
  app.get(`${prefix}/ai/health`, async (c) => {
    // Same freshness the execution path gets. A health probe answered from an
    // isolate that has not served traffic since an administrator stopped AI
    // would report the platform healthy while every request is being refused.
    await plane.refreshSettings();
    const health = plane.health();
    const status = health.status === 'unhealthy' ? 503 : 200;
    return c.json({ success: health.status !== 'unhealthy', ...health }, status);
  });

  /**
   * Resolve an administrative actor holding `capability`, or produce the
   * refusal response.
   *
   * ONE helper for all three routes, so the check cannot be applied to two of
   * them and forgotten on the third — which is the shape the original defect
   * took in Batch 1, where two feature routes had no check at all.
   *
   * The refusal is deliberately shaped like the administration surface's:
   * a stable code and no diagnostics, so a caller learns that they were
   * refused and not what would have made them succeed.
   */
  const operator = async (
    c: RouteContext,
    capability: 'ai.admin.view' | 'ai.admin.audit.read',
  ): Promise<{ ok: true; actor: AIAdminActorOf<AIAdministration> } | { ok: false; response: Response }> => {
    const administration = deps.administration;
    if (!administration) {
      // FAIL CLOSED. An observability route with no way to authorise its
      // caller refuses, rather than reverting to a weaker check.
      return {
        ok: false,
        response: c.json(
          {
            success: false,
            error: 'AI administration is not available.',
            code: 'SERVICE_UNAVAILABLE',
          },
          503,
        ),
      };
    }
    try {
      const actor = await administration.authorize(c.req.header('Authorization') ?? null, {
        correlationId: correlationIdFromHeaders((name) => c.req.header(name)),
      });
      if (!hasAIAdminCapability(actor, capability)) {
        return {
          ok: false,
          response: c.json(
            {
              success: false,
              error: 'Your administrative role does not permit this action.',
              code: 'FORBIDDEN',
            },
            403,
          ),
        };
      }
      return { ok: true, actor };
    } catch (error) {
      const aiError = toAIError(error);
      return {
        ok: false,
        response: c.json(
          { success: false, error: aiError.message, code: aiError.code },
          aiError.status,
        ),
      };
    }
  };

  /**
   * Operator-only: metrics carry usage volumes across all organizations.
   *
   * Now demands `ai.admin.view`, the same capability `/ai/admin/usage` demands
   * for the same platform-wide aggregates. A provisioned team account without
   * an administrative role is refused.
   */
  app.get(`${prefix}/ai/metrics`, async (c) => {
    const authorized = await operator(c, 'ai.admin.view');
    if (!authorized.ok) return authorized.response;
    return c.json({ success: true, metrics: plane.metrics() });
  });

  /**
   * Operator-only: audit records name actors, organizations and prompts.
   *
   * TENANT-SCOPED NOW. Served through `administration.executionAudit`, which
   * filters records to the organizations the actor may see — the same boundary
   * the execution path enforces. `plane.recentAudit` is no longer reachable
   * from an HTTP route, because it returns every tenant's records and no
   * caller of it was applying a scope.
   */
  app.get(`${prefix}/ai/audit`, async (c) => {
    const authorized = await operator(c, 'ai.admin.audit.read');
    if (!authorized.ok) return authorized.response;
    const requested = Number.parseInt(c.req.query('limit') ?? '50', 10);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 200) : 50;
    return c.json({
      success: true,
      records: deps.administration!.executionAudit(authorized.actor, limit),
    });
  });

  /** Operator-only: the governed capability surface and its declared limits. */
  app.get(`${prefix}/ai/catalog`, async (c) => {
    const authorized = await operator(c, 'ai.admin.view');
    if (!authorized.ok) return authorized.response;
    return c.json({
      success: true,
      features: plane.catalog.list(),
      prompts: plane.prompts.list().map((prompt) => ({
        promptId: prompt.promptId,
        version: prompt.version,
        owner: prompt.owner,
        purpose: prompt.purpose,
        fingerprint: prompt.fingerprint,
      })),
    });
  });
}

/** The actor type `AIAdministration.authorize` resolves to. */
type AIAdminActorOf<T extends { authorize: (...args: never[]) => Promise<unknown> }> =
  Awaited<ReturnType<T['authorize']>>;

/**
 * Run the diagnostic analysis feature for a stored submission.
 *
 * Batch analysis and single-submission analysis are triggered by routes that
 * also read and write KV, so they stay in the server entry point. They reach the
 * model only through here — the same guarded path as every interactive feature,
 * with the same audit trail and the same budget accounting.
 */
export async function runCortexAnalysis(
  plane: AIControlPlane,
  submission: Record<string, unknown>,
  options: { authorization: string | null; correlationId?: string },
): Promise<Record<string, unknown>> {
  const result = await plane.execute<Record<string, unknown>>(
    {
      featureId: FEATURE.analysis,
      input: {
        submissionId: String(submission.id ?? ''),
        company: asText(submission.company),
        industry: asText(submission.industry),
        employees: asText(submission.employees),
        revenue: asText(submission.revenue),
        answers: asAnswers(submission.answers),
      },
      correlationId: options.correlationId,
      channel: 'team_console',
    },
    { authorization: options.authorization },
  );

  // The stored record keeps the provenance of the run that produced it, so a
  // stored analysis can always be traced back to its prompt version and model.
  return {
    ...result.output,
    analyzedAt: result.completedAt,
    model: result.execution.modelId,
    provider: result.execution.providerId,
    promptVersion: `${result.promptId}@${result.promptVersion}`,
    requestId: result.requestId,
  };
}

function asText(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'Not specified';
  return String(value).slice(0, 200);
}

/** Coerce a submission's answers into the bounded string map the feature takes. */
function asAnswers(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(out).length >= 60) break;
    out[key.slice(0, 80)] = String(raw ?? '').slice(0, 2_000);
  }
  return out;
}
