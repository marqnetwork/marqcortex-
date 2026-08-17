/**
 * Framework-agnostic HTTP adapter for the workflow runtime (AI-01 Batch 3B).
 *
 * The same shape as `ai/http/httpAdapter.ts`, `ai/admin/httpAdapter.ts` and
 * `ai/agents/http/agentHttpAdapter.ts`, and for the same reasons: the whole
 * request/response mapping is a pure function, so status codes, error bodies
 * and — most importantly — the authorization boundary are unit-testable without
 * a server.
 *
 * ONE ENTRY POINT. Every operation goes through `executeWorkflowHttpRequest`.
 * There is no handler reachable without the caller having been authenticated
 * and resolved to a workflow actor, because EVERY method on
 * `WorkflowRuntimeService` resolves one before it does anything — see
 * `service/workflowRuntimeService.ts`, where `context()` is the first statement
 * of each. This adapter therefore never carries an actor, never compares a role
 * and has nothing to forget: it maps a request onto a service call and a service
 * result onto a response.
 *
 * THE OPERATION IS BOUND BY THE ROUTE TABLE, NEVER READ FROM THE BODY. A caller
 * cannot ask for `workflow.run.cancel` at the `workflow.run.get` endpoint. That
 * is the same decision the administration adapter made after a review found the
 * alternative pattern — a handler per operation, each repeating its own role
 * comparison — had produced two endpoints with no authentication at all.
 *
 * BODIES ARE READ FIELD BY FIELD. Each operation reads exactly the fields it
 * declares from an unknown body and ignores everything else, so an undeclared
 * key cannot reach the service. Identifiers are pattern-checked before they are
 * used, because they end up in storage keys and log lines.
 *
 * ── WHAT A CALLER CANNOT SUPPLY, AND WHY THE LIST IS THIS SHORT ────────────
 *
 * The tenant, the actor, the actor's roles, the actor's workflow capabilities
 * and the actor's agent-runtime capabilities are all resolved server-side from
 * the authenticated subject. There is no field on any request below through
 * which a caller could assert one, so there is nothing to validate away.
 *
 * The RUN ORIGIN is not read from the body either, though it confers no
 * authority: the service's own default (`team_console`) is the truthful
 * description of a run started through this surface, and a caller-named origin
 * would be a caller-named audit fact.
 *
 * The DEADLINE is not read from the body. `runtimeMs` exists on the service for
 * a scheduler that has its own reason to narrow one; an operator does not, and
 * an endpoint that accepted it would be an endpoint through which a run could be
 * given a deadline nobody reviewed.
 *
 * ── WHAT THIS SURFACE DELIBERATELY DOES NOT EXPOSE ─────────────────────────
 *
 * There is no way to create, edit or register a WORKFLOW — definitions are
 * registry-time decisions made in code and reviewed as code. There is no
 * `pause`, `resume` or `expire`: a run that must stop is cancelled, and the
 * deadline is the engine's own affair. And there is no plan read, because a plan
 * is the definition in another shape and this surface is about runs.
 */

import type {
  WorkflowApprovalListRequest,
  WorkflowRuntimeService,
  StartWorkflowRunRequest,
} from '../service/workflowRuntimeService.ts';
import type { WorkflowRunState } from '../contracts/run.ts';
import { WORKFLOW_RUN_STATES } from '../contracts/run.ts';
import { AIError, toAIError } from '../../contracts/errors.ts';
import { isWorkflowError } from '../contracts/failures.ts';

export const WORKFLOW_OPERATION = {
  /** Create the run AND drive it until it blocks, completes or fails. */
  startRun: 'workflow.run.start',
  /** Drive a run that is already parked — after a decision, for instance. */
  advanceRun: 'workflow.run.advance',
  cancelRun: 'workflow.run.cancel',
  getRun: 'workflow.run.get',
  listRuns: 'workflow.run.list',
  listWorkflows: 'workflow.registry.list',
  overview: 'workflow.runtime.overview',
  listApprovals: 'workflow.approval.list',
  getApproval: 'workflow.approval.get',
  decideApproval: 'workflow.approval.decide',
} as const;

export type WorkflowOperation = (typeof WORKFLOW_OPERATION)[keyof typeof WORKFLOW_OPERATION];

export interface WorkflowHttpRequest {
  /** Bound by the route table. Never read from the request body. */
  readonly operation: WorkflowOperation;
  readonly authorization: string | null;
  readonly body?: unknown;
  /** Path parameter. Pattern-checked before use. */
  readonly workflowRunId?: string;
  readonly workflowApprovalId?: string;
  /**
   * The organization this request is scoped to.
   *
   * A HINT, not a grant: `resolveOrganization` honours it only when the
   * authenticated subject actually holds a membership in it, and refuses
   * outright otherwise. It is the one field the service accepts for both actor
   * resolution and read scope, so this adapter passes exactly one value and
   * cannot widen a read past what the resolution admitted.
   */
  readonly organizationId?: string;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly clientIp?: string;
  readonly limit?: number;
  readonly states?: readonly string[];
  /** Approval queue filter. Absent means "only what can still be decided". */
  readonly pendingOnly?: boolean;
}

export interface WorkflowHttpResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

/** Identifiers must be safe in a storage key, a log line and a URL path. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Bounded free text. Longer input is refused rather than silently truncated. */
const MAX_REASON = 300;

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new AIError('VALIDATION_FAILED', `A valid ${field} is required.`, { fields: [field] });
  }
  return value;
}

/**
 * A control or decision reason, as the caller supplied it.
 *
 * NOT defaulted and NOT truncated. The approval gate refuses a decision whose
 * reason is outside its bounds, and a reason this adapter invented would be a
 * reason nobody gave — which is the one thing an approval trail must never
 * contain. The length check here exists so an over-long body is a 400 rather
 * than a silently shortened audit record.
 */
function requireReason(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_REASON) {
    throw new AIError('VALIDATION_FAILED', `A ${field} is required.`, { fields: [field] });
  }
  return value.trim();
}

function readStates(values: readonly string[] | undefined): readonly WorkflowRunState[] {
  if (!values) return [];
  return values.filter((value): value is WorkflowRunState =>
    (WORKFLOW_RUN_STATES as readonly string[]).includes(value),
  );
}

export async function executeWorkflowHttpRequest(
  service: WorkflowRuntimeService,
  request: WorkflowHttpRequest,
): Promise<WorkflowHttpResponse> {
  // Every service method authenticates and authorises for itself, so this is
  // transport metadata rather than an identity: nothing assembled here confers
  // authority, and `organizationId` is a hint the resolution may refuse.
  const meta = {
    authorization: request.authorization,
    ...(request.organizationId === undefined ? {} : { organizationId: request.organizationId }),
    ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
    ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId }),
    ...(request.clientIp === undefined ? {} : { clientIp: request.clientIp }),
  };

  try {
    // ONE ANSWER FOR AN ANONYMOUS CALLER, AT EVERY OPERATION.
    //
    // This is NOT where authorization happens — every service method
    // authenticates the subject and enforces its own capability, and that is the
    // decision that matters. What this guarantees is uniformity: without it, a
    // caller with no credential would receive a 400 for a malformed identifier
    // and a 401 for a well-formed one, so the shape of the refusal would vary
    // with the input at the one point where the platform knows nothing about who
    // is asking. A prober gets the same answer whatever they send.
    if (request.authorization === null || request.authorization === undefined) {
      throw new AIError('AUTH_REQUIRED', 'Authentication is required for workflow runs.');
    }

    const body = record(request.body);

    switch (request.operation) {
      case WORKFLOW_OPERATION.startRun: {
        const start: StartWorkflowRunRequest = {
          ...meta,
          workflowId: requireId(body.workflowId, 'workflowId'),
          // Passed through whole and validated by the WORKFLOW'S OWN declared
          // input contract, inside the engine. A shape check here would be a
          // second, weaker opinion about what a workflow accepts.
          input: body.input,
        };
        return ok({ run: await service.startRun(start) });
      }

      case WORKFLOW_OPERATION.advanceRun:
        return ok({
          run: await service.advanceRun({
            ...meta,
            workflowRunId: requireId(request.workflowRunId, 'workflowRunId'),
          }),
        });

      case WORKFLOW_OPERATION.cancelRun:
        return ok({
          run: await service.cancelRun({
            ...meta,
            workflowRunId: requireId(request.workflowRunId, 'workflowRunId'),
            reason: requireReason(body.reason, 'reason'),
          }),
        });

      case WORKFLOW_OPERATION.getRun:
        return ok({
          run: await service.getRun({
            ...meta,
            workflowRunId: requireId(request.workflowRunId, 'workflowRunId'),
          }),
        });

      case WORKFLOW_OPERATION.listRuns: {
        const states = readStates(request.states);
        return ok({
          runs: await service.listRuns({
            ...meta,
            ...(states.length === 0 ? {} : { states }),
            ...(request.limit === undefined ? {} : { limit: request.limit }),
          }),
        });
      }

      case WORKFLOW_OPERATION.listWorkflows:
        return ok({ workflows: await service.listWorkflows(meta) });

      case WORKFLOW_OPERATION.overview:
        return ok({ overview: await service.overview(meta) });

      case WORKFLOW_OPERATION.listApprovals: {
        const list: WorkflowApprovalListRequest = {
          ...meta,
          ...(request.pendingOnly === undefined ? {} : { pendingOnly: request.pendingOnly }),
          ...(request.workflowRunId === undefined
            ? {}
            : { workflowRunId: requireId(request.workflowRunId, 'workflowRunId') }),
          ...(request.limit === undefined ? {} : { limit: request.limit }),
        };
        return ok({ approvals: await service.listApprovals(list) });
      }

      case WORKFLOW_OPERATION.getApproval:
        return ok({
          approval: await service.getApproval({
            ...meta,
            workflowApprovalId: requireId(request.workflowApprovalId, 'workflowApprovalId'),
          }),
        });

      case WORKFLOW_OPERATION.decideApproval: {
        // Neither value is defaulted. A decision the caller did not clearly
        // make, or did not justify, is a 400 — never a quiet `approve`.
        if (body.decision !== 'approve' && body.decision !== 'reject') {
          throw new AIError('VALIDATION_FAILED', 'Field `decision` must be approve or reject.', {
            fields: ['decision'],
          });
        }
        return ok({
          approval: await service.decideApproval({
            ...meta,
            workflowApprovalId: requireId(
              request.workflowApprovalId ?? body.workflowApprovalId,
              'workflowApprovalId',
            ),
            decision: body.decision,
            reason: requireReason(body.reason, 'reason'),
          }),
        });
      }

      default:
        // Unreachable while the route table binds only declared operations.
        // Present so adding an operation to the union without a case here is a
        // 404 rather than an undefined response.
        throw new AIError('FEATURE_NOT_FOUND', 'Unknown workflow runtime operation.', {
          diagnostics: `operation=${String(request.operation)}`,
        });
    }
  } catch (error) {
    const aiError = toAIError(error);
    return {
      status: aiError.status,
      // `diagnostics` is deliberately absent. The caller gets a precise message,
      // a transport code and — where the failure is a workflow one — the typed
      // failure an operator console can act on. Server-side detail stays in the
      // log and the audit trail, where it is already recorded.
      body: {
        success: false,
        error: aiError.message,
        code: aiError.code,
        ...(isWorkflowError(error)
          ? { failure: error.failure, retryable: aiError.retryable }
          : {}),
        ...(aiError.fields?.length ? { fields: aiError.fields } : {}),
      },
    };
  }
}

function ok(payload: Record<string, unknown>): WorkflowHttpResponse {
  return { status: 200, body: { success: true, ...payload } };
}
