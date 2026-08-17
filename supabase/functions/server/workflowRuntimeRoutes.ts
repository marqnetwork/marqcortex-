/**
 * Workflow runtime HTTP routes (AI-01 Batch 3B).
 *
 * Every route in this file is the same four lines: read the transport facts,
 * name the operation, hand both to the workflow HTTP adapter, return what it
 * produces. Authentication, actor resolution, tenant scoping, capability
 * enforcement, validation, persistence and the audit record all live inside the
 * adapter and the service behind it — so a route cannot forget a check, because
 * there is nothing here to forget.
 *
 * The operation name is the ONLY thing a route contributes, and it cannot be
 * read from the request body: it is bound by this table, so a caller cannot ask
 * for `workflow.run.cancel` at the `workflow.run.get` endpoint.
 *
 * Note what these routes do NOT do: they never touch `verifyTeamToken`. The
 * runtime resolves its caller through the same `AIAuthenticator` port the AI
 * Guard and the agent runtime use, which returns roles and memberships resolved
 * server-side. A bearer-token check that only proves "some team member" is the
 * difference between authentication and authorization, and this surface needs
 * the second — a workflow run starts agent runs that spend money and park for a
 * human.
 *
 * ── WHY THE READINESS REVIEW HAS NO ROUTE OF ITS OWN ───────────────────────
 *
 * `workflow.diagnostic.readiness_review` is started at `POST /ai/workflows/runs`
 * by naming it, exactly as any other registered workflow would be. A dedicated
 * `/ai/diagnostic/review` endpoint would be a second entry point into the
 * engine, with its own idea of what to validate and its own opportunity to skip
 * the registry's enable and certification checks — and the switch that keeps the
 * capability off by default is enforced by that registry. With the capability
 * inactive the workflow is simply not registered, so this surface refuses to
 * start it and says so, without a line of code here knowing it exists.
 */

import {
  WORKFLOW_OPERATION,
  executeWorkflowHttpRequest,
  type WorkflowOperation,
  type WorkflowRuntimeService,
} from './ai/index.ts';
import type { AIRouteRegistrar, RouteContext } from './aiRoutes.ts';

export interface WorkflowRuntimeRouteDependencies {
  readonly service: WorkflowRuntimeService;
  /** Route prefix, e.g. `/make-server-324f4fbe`. */
  readonly prefix: string;
}

/** The AI route context plus path parameters. Declared structurally. */
export interface WorkflowRouteContext extends RouteContext {
  readonly req: RouteContext['req'] & { param(name: string): string | undefined };
}

export interface WorkflowRouteRegistrar extends AIRouteRegistrar {
  get(path: string, handler: (c: WorkflowRouteContext) => Response | Promise<Response>): unknown;
  post(path: string, handler: (c: WorkflowRouteContext) => Promise<Response>): unknown;
}

/**
 * The organization scope for a request.
 *
 * A HINT the server may refuse: `resolveOrganization` honours it only where the
 * authenticated subject holds a membership, so a caller naming somebody else's
 * tenant is refused rather than served. The header form is preferred over a
 * query parameter for reads so the two cannot disagree.
 */
function transportOf(c: WorkflowRouteContext): {
  correlationId?: string;
  clientIp?: string;
  organizationId?: string;
} {
  const forwardedFor = c.req.header('x-forwarded-for');
  return {
    correlationId: c.req.header('x-correlation-id') ?? c.req.header('x-request-id'),
    clientIp: forwardedFor?.split(',')[0]?.trim() ?? c.req.header('x-real-ip'),
    organizationId: c.req.header('x-marq-organization') ?? c.req.query('organizationId'),
  };
}

/** Bounded page size. Out-of-range values fall back rather than failing. */
function limitOf(c: WorkflowRouteContext): number | undefined {
  const raw = c.req.query('limit');
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** `?state=running&state=paused` or `?state=running,paused`. Both are common. */
function statesOf(c: WorkflowRouteContext): readonly string[] | undefined {
  const raw = c.req.query('state');
  if (raw === undefined) return undefined;
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');
}

export function registerWorkflowRuntimeRoutes(
  app: WorkflowRouteRegistrar,
  deps: WorkflowRuntimeRouteDependencies,
): void {
  const { service, prefix } = deps;

  const run = async (
    c: WorkflowRouteContext,
    operation: WorkflowOperation,
    extra: {
      body?: unknown;
      workflowRunId?: string;
      workflowApprovalId?: string;
      limit?: number;
      states?: readonly string[];
      pendingOnly?: boolean;
    } = {},
  ): Promise<Response> => {
    const response = await executeWorkflowHttpRequest(service, {
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
   * body that parsed to `{}` — which for a cancellation would mean "no reason
   * supplied" and would be recorded as a refused control action for a request
   * that was really just malformed.
   */
  const readBody = async (
    c: WorkflowRouteContext,
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
    operation: WorkflowOperation,
    params?: (c: WorkflowRouteContext) => {
      workflowRunId?: string;
      workflowApprovalId?: string;
    },
  ): void => {
    app.post(`${prefix}${path}`, async (c) => {
      const parsed = await readBody(c);
      if (!parsed.ok) return parsed.response;
      return run(c, operation, { body: parsed.body, ...(params?.(c) ?? {}) });
    });
  };

  // ── Reads ─────────────────────────────────────────────────────────────────

  app.get(`${prefix}/ai/workflows/overview`, (c) => run(c, WORKFLOW_OPERATION.overview));
  app.get(`${prefix}/ai/workflows/registry`, (c) => run(c, WORKFLOW_OPERATION.listWorkflows));

  app.get(`${prefix}/ai/workflows/approvals`, (c) =>
    run(c, WORKFLOW_OPERATION.listApprovals, {
      limit: limitOf(c),
      // `?pending=false` is the only way to see decided history. The default is
      // a queue, because that is what an approver opens this for.
      pendingOnly: c.req.query('pending') === 'false' ? false : undefined,
      workflowRunId: c.req.query('workflowRunId'),
    }),
  );
  app.get(`${prefix}/ai/workflows/approvals/:approvalId`, (c) =>
    run(c, WORKFLOW_OPERATION.getApproval, {
      workflowApprovalId: c.req.param('approvalId'),
    }),
  );

  app.get(`${prefix}/ai/workflows/runs`, (c) =>
    run(c, WORKFLOW_OPERATION.listRuns, { limit: limitOf(c), states: statesOf(c) }),
  );
  app.get(`${prefix}/ai/workflows/runs/:runId`, (c) =>
    run(c, WORKFLOW_OPERATION.getRun, { workflowRunId: c.req.param('runId') }),
  );

  // ── Mutations ─────────────────────────────────────────────────────────────

  mutation('/ai/workflows/runs', WORKFLOW_OPERATION.startRun);
  mutation('/ai/workflows/runs/:runId/advance', WORKFLOW_OPERATION.advanceRun, (c) => ({
    workflowRunId: c.req.param('runId'),
  }));
  mutation('/ai/workflows/runs/:runId/cancel', WORKFLOW_OPERATION.cancelRun, (c) => ({
    workflowRunId: c.req.param('runId'),
  }));
  mutation('/ai/workflows/approvals/:approvalId', WORKFLOW_OPERATION.decideApproval, (c) => ({
    workflowApprovalId: c.req.param('approvalId'),
  }));
}
