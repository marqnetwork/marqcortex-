/**
 * Agent runtime HTTP routes (AI-01 Batch 3A).
 *
 * Every route in this file is the same four lines: read the transport facts,
 * name the operation, hand both to the agent HTTP adapter, return what it
 * produces. Authentication, actor resolution, tenant scoping, capability
 * enforcement, validation, persistence and the audit record all live inside the
 * adapter and the service behind it — so a route cannot forget a check, because
 * there is nothing here to forget.
 *
 * The operation name is the ONLY thing a route contributes, and it cannot be
 * read from the request body: it is bound by this table, so a caller cannot ask
 * for `run.cancel` at the `run.get` endpoint.
 *
 * Note what these routes do NOT do: they never touch `verifyTeamToken`. The
 * runtime resolves its caller through the same `AIAuthenticator` port the AI
 * Guard uses, which returns roles and memberships resolved server-side. A
 * bearer-token check that only proves "some team member" is the difference
 * between authentication and authorization, and this surface needs the second.
 */

import {
  AGENT_OPERATION,
  executeAgentHttpRequest,
  type AgentOperation,
  type AgentRuntimeService,
} from './ai/index.ts';
import type { AIRouteRegistrar, RouteContext } from './aiRoutes.ts';

export interface AgentRuntimeRouteDependencies {
  readonly service: AgentRuntimeService;
  /** Route prefix, e.g. `/make-server-324f4fbe`. */
  readonly prefix: string;
}

/** The AI route context plus path parameters. Declared structurally. */
export interface AgentRouteContext extends RouteContext {
  readonly req: RouteContext['req'] & { param(name: string): string | undefined };
}

export interface AgentRouteRegistrar extends AIRouteRegistrar {
  get(path: string, handler: (c: AgentRouteContext) => Response | Promise<Response>): unknown;
  post(path: string, handler: (c: AgentRouteContext) => Promise<Response>): unknown;
}

function transportOf(c: AgentRouteContext): {
  correlationId?: string;
  clientIp?: string;
  organizationHint?: string;
} {
  const forwardedFor = c.req.header('x-forwarded-for');
  return {
    correlationId: c.req.header('x-correlation-id') ?? c.req.header('x-request-id'),
    clientIp: forwardedFor?.split(',')[0]?.trim() ?? c.req.header('x-real-ip'),
    organizationHint: c.req.header('x-marq-organization'),
  };
}

/** Bounded page size. Out-of-range values fall back rather than failing. */
function limitOf(c: AgentRouteContext): number | undefined {
  const raw = c.req.query('limit');
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** `?state=running&state=paused` or `?state=running,paused`. Both are common. */
function statesOf(c: AgentRouteContext): readonly string[] | undefined {
  const raw = c.req.query('state');
  if (raw === undefined) return undefined;
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');
}

export function registerAgentRuntimeRoutes(
  app: AgentRouteRegistrar,
  deps: AgentRuntimeRouteDependencies,
): void {
  const { service, prefix } = deps;

  const run = async (
    c: AgentRouteContext,
    operation: AgentOperation,
    extra: {
      body?: unknown;
      runId?: string;
      approvalId?: string;
      limit?: number;
      states?: readonly string[];
      agentId?: string;
      organizationId?: string;
    } = {},
  ): Promise<Response> => {
    const response = await executeAgentHttpRequest(service, {
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
   * body that parsed to `{}` — which for a control operation would mean "no
   * reason supplied" and would be recorded as a rejected run action for a
   * request that was really just malformed.
   */
  const readBody = async (
    c: AgentRouteContext,
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
    path: string,
    operation: AgentOperation,
    params?: (c: AgentRouteContext) => { runId?: string; approvalId?: string },
  ): void => {
    app.post(`${prefix}${path}`, async (c) => {
      const parsed = await readBody(c);
      if (!parsed.ok) return parsed.response;
      return run(c, operation, { body: parsed.body, ...(params?.(c) ?? {}) });
    });
  };

  // ── Reads ─────────────────────────────────────────────────────────────────

  app.get(`${prefix}/ai/agents/overview`, (c) =>
    run(c, AGENT_OPERATION.overview, { organizationId: c.req.query('organizationId') }),
  );
  app.get(`${prefix}/ai/agents/registry`, (c) => run(c, AGENT_OPERATION.listAgents));
  app.get(`${prefix}/ai/agents/tools`, (c) => run(c, AGENT_OPERATION.listTools));
  app.get(`${prefix}/ai/agents/audit`, (c) =>
    run(c, AGENT_OPERATION.audit, { limit: limitOf(c) }),
  );
  app.get(`${prefix}/ai/agents/approvals`, (c) =>
    run(c, AGENT_OPERATION.listApprovals, {
      limit: limitOf(c),
      organizationId: c.req.query('organizationId'),
    }),
  );

  app.get(`${prefix}/ai/agents/runs`, (c) =>
    run(c, AGENT_OPERATION.listRuns, {
      limit: limitOf(c),
      states: statesOf(c),
      agentId: c.req.query('agentId'),
      organizationId: c.req.query('organizationId'),
    }),
  );
  app.get(`${prefix}/ai/agents/runs/:runId`, (c) =>
    run(c, AGENT_OPERATION.getRun, {
      runId: c.req.param('runId'),
      organizationId: c.req.query('organizationId'),
    }),
  );
  app.get(`${prefix}/ai/agents/runs/:runId/steps`, (c) =>
    run(c, AGENT_OPERATION.runSteps, {
      runId: c.req.param('runId'),
      organizationId: c.req.query('organizationId'),
    }),
  );
  app.get(`${prefix}/ai/agents/runs/:runId/usage`, (c) =>
    run(c, AGENT_OPERATION.runUsage, {
      runId: c.req.param('runId'),
      organizationId: c.req.query('organizationId'),
    }),
  );

  // ── Mutations ─────────────────────────────────────────────────────────────

  mutation('/ai/agents/runs', AGENT_OPERATION.createRun);
  mutation('/ai/agents/runs/:runId/pause', AGENT_OPERATION.pauseRun, (c) => ({
    runId: c.req.param('runId'),
  }));
  mutation('/ai/agents/runs/:runId/resume', AGENT_OPERATION.resumeRun, (c) => ({
    runId: c.req.param('runId'),
  }));
  mutation('/ai/agents/runs/:runId/cancel', AGENT_OPERATION.cancelRun, (c) => ({
    runId: c.req.param('runId'),
  }));
  mutation('/ai/agents/runs/:runId/retry', AGENT_OPERATION.retryRun, (c) => ({
    runId: c.req.param('runId'),
  }));
  mutation(
    '/ai/agents/runs/:runId/approvals/:approvalId',
    AGENT_OPERATION.submitApproval,
    (c) => ({ runId: c.req.param('runId'), approvalId: c.req.param('approvalId') }),
  );
}
