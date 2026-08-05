/**
 * Workflow engine HTTP routes (AI-01 Batch 3B).
 *
 * Every route in this file is the same four lines: read the transport facts, name
 * the operation, hand both to the workflow HTTP adapter, return what it produces.
 * Authentication, actor resolution, tenant scoping, capability enforcement,
 * validation, persistence and the audit record all live inside the adapter and the
 * service behind it — so a route cannot forget a check, because there is nothing
 * here to forget.
 *
 * The operation name is the ONLY thing a route contributes, and it cannot be read
 * from the request body: it is bound by this table, so a caller cannot ask for
 * `workflow.run.cancel` at the `workflow.run.get` endpoint.
 *
 * Note what these routes do NOT do: they never touch `verifyTeamToken`. The engine
 * resolves its caller through the same `AIAuthenticator` port the AI Guard uses,
 * which returns roles and memberships resolved server-side. A bearer-token check
 * that only proves "some team member" is the difference between authentication and
 * authorization, and this surface needs the second.
 *
 * There is deliberately no route that creates, edits or deletes a workflow
 * definition. Customer-created workflows are out of Batch 3B's scope, and a route
 * file is where that scope would quietly arrive.
 */

import {
  WORKFLOW_OPERATION,
  executeWorkflowHttpRequest,
  type WorkflowOperation,
  type WorkflowService,
} from './ai/index.ts';
import type { AIRouteRegistrar, RouteContext } from './aiRoutes.ts';

export interface WorkflowRouteDependencies {
  readonly service: WorkflowService;
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

function transportOf(c: WorkflowRouteContext): {
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

export function registerWorkflowRoutes(
  app: WorkflowRouteRegistrar,
  deps: WorkflowRouteDependencies,
): void {
  const { service, prefix } = deps;

  const run = async (
    c: WorkflowRouteContext,
    operation: WorkflowOperation,
    extra: {
      body?: unknown;
      workflowId?: string;
      workflowRunId?: string;
      workflowApprovalId?: string;
      limit?: number;
      states?: readonly string[];
      organizationId?: string;
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
   * A malformed body never reaches the adapter, so it cannot be mistaken for a body
   * that parsed to `{}` — which for a control operation would mean "no reason
   * supplied" and would be recorded as a rejected action for a request that was
   * really just malformed.
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

  app.get(`${prefix}/ai/workflows/overview`, (c) =>
    run(c, WORKFLOW_OPERATION.overview, { organizationId: c.req.query('organizationId') }),
  );
  app.get(`${prefix}/ai/workflows/audit`, (c) =>
    run(c, WORKFLOW_OPERATION.audit, { limit: limitOf(c) }),
  );
  app.get(`${prefix}/ai/workflows/approvals`, (c) =>
    run(c, WORKFLOW_OPERATION.listApprovals, {
      limit: limitOf(c),
      organizationId: c.req.query('organizationId'),
    }),
  );

  app.get(`${prefix}/ai/workflows/finance`, (c) =>
    run(c, WORKFLOW_OPERATION.financialSummary, {
      organizationId: c.req.query('organizationId'),
    }),
  );
  app.get(`${prefix}/ai/workflows/savings`, (c) =>
    run(c, WORKFLOW_OPERATION.savingsSummary, {
      organizationId: c.req.query('organizationId'),
    }),
  );

  // Runs are listed and read before the registry routes below, because
  // `/workflows/runs` must not be matched as `/workflows/:workflowId`.
  app.get(`${prefix}/ai/workflows/runs`, (c) =>
    run(c, WORKFLOW_OPERATION.listRuns, {
      limit: limitOf(c),
      states: statesOf(c),
      workflowId: c.req.query('workflowId'),
      organizationId: c.req.query('organizationId'),
    }),
  );
  app.get(`${prefix}/ai/workflows/runs/:workflowRunId`, (c) =>
    run(c, WORKFLOW_OPERATION.getRun, {
      workflowRunId: c.req.param('workflowRunId'),
      organizationId: c.req.query('organizationId'),
    }),
  );
  app.get(`${prefix}/ai/workflows/runs/:workflowRunId/nodes`, (c) =>
    run(c, WORKFLOW_OPERATION.runNodes, {
      workflowRunId: c.req.param('workflowRunId'),
      organizationId: c.req.query('organizationId'),
    }),
  );
  app.get(`${prefix}/ai/workflows/runs/:workflowRunId/branches`, (c) =>
    run(c, WORKFLOW_OPERATION.branchState, {
      workflowRunId: c.req.param('workflowRunId'),
      organizationId: c.req.query('organizationId'),
    }),
  );
  app.get(`${prefix}/ai/workflows/runs/:workflowRunId/tokens`, (c) =>
    run(c, WORKFLOW_OPERATION.tokenReport, {
      workflowRunId: c.req.param('workflowRunId'),
      organizationId: c.req.query('organizationId'),
    }),
  );
  app.get(`${prefix}/ai/workflows/runs/:workflowRunId/cost`, (c) =>
    run(c, WORKFLOW_OPERATION.costReport, {
      workflowRunId: c.req.param('workflowRunId'),
      organizationId: c.req.query('organizationId'),
    }),
  );

  app.get(`${prefix}/ai/workflows/registry`, (c) => run(c, WORKFLOW_OPERATION.listWorkflows));
  app.get(`${prefix}/ai/workflows/registry/:workflowId`, (c) =>
    run(c, WORKFLOW_OPERATION.getWorkflow, { workflowId: c.req.param('workflowId') }),
  );

  // ── Mutations ─────────────────────────────────────────────────────────────

  mutation('/ai/workflows/runs', WORKFLOW_OPERATION.createRun);
  mutation('/ai/workflows/runs/:workflowRunId/pause', WORKFLOW_OPERATION.pauseRun, (c) => ({
    workflowRunId: c.req.param('workflowRunId'),
  }));
  mutation('/ai/workflows/runs/:workflowRunId/resume', WORKFLOW_OPERATION.resumeRun, (c) => ({
    workflowRunId: c.req.param('workflowRunId'),
  }));
  mutation('/ai/workflows/runs/:workflowRunId/cancel', WORKFLOW_OPERATION.cancelRun, (c) => ({
    workflowRunId: c.req.param('workflowRunId'),
  }));
  mutation('/ai/workflows/runs/:workflowRunId/retry', WORKFLOW_OPERATION.retryRun, (c) => ({
    workflowRunId: c.req.param('workflowRunId'),
  }));
  mutation(
    '/ai/workflows/runs/:workflowRunId/approvals/:workflowApprovalId',
    WORKFLOW_OPERATION.submitApproval,
    (c) => ({
      workflowRunId: c.req.param('workflowRunId'),
      workflowApprovalId: c.req.param('workflowApprovalId'),
    }),
  );
}
