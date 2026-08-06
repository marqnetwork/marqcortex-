/**
 * Framework-agnostic HTTP adapter for the workflow runtime (AI-01 Batch 3B).
 *
 * The same shape as `ai/http/httpAdapter.ts`, `ai/admin/httpAdapter.ts` and
 * `ai/agents/http/agentHttpAdapter.ts`, and for the same reasons: the whole
 * request/response mapping is a pure function, so status codes, error bodies
 * and — most importantly — the authorization boundary are unit-testable without
 * a server.
 *
 * ONE ENTRY POINT. Every operation goes through `executeWorkflowHttpRequest`,
 * which AUTHORISES FIRST and DISPATCHES SECOND. There is no handler reachable
 * without the caller having been resolved to a runtime actor, because dispatch
 * happens inside the function that does the resolving. A route file cannot
 * forget the check — there is nothing in a route file to forget.
 *
 * THE OPERATION IS BOUND BY THE ROUTE TABLE, NEVER READ FROM THE BODY, so a
 * caller cannot ask for `run.cancel` at the `run.get` endpoint.
 *
 * BODIES ARE READ FIELD BY FIELD. Each operation reads exactly the fields it
 * declares from an unknown body and ignores everything else, so an undeclared
 * key cannot reach the orchestrator. Identifiers are pattern-checked before use,
 * because they end up in storage keys and log lines.
 *
 * SEED FACTS ARE THE ONE PLACE A CALLER SUPPLIES A MAP, and it is read the same
 * way: bounded key count, scalars only, and the orchestrator coerces again on
 * the far side. Two bounds on the same value is not redundancy when one of them
 * is at the trust boundary.
 */

import type {
  CreateWorkflowRunRequest,
  WorkflowRequestMeta,
  WorkflowService,
} from '../service/workflowService.ts';
import type { WorkflowRunState } from '../contracts/runtime.ts';
import { WORKFLOW_RUN_STATES } from '../contracts/runtime.ts';
import { AIError, toAIError } from '../../contracts/errors.ts';
import { isWorkflowRuntimeError } from '../contracts/failures.ts';

export const WORKFLOW_OPERATION = {
  createRun: 'workflow.run.create',
  getRun: 'workflow.run.get',
  listRuns: 'workflow.run.list',
  pauseRun: 'workflow.run.pause',
  resumeRun: 'workflow.run.resume',
  cancelRun: 'workflow.run.cancel',
  submitApproval: 'workflow.approval.decide',
  listApprovals: 'workflow.approval.list',
  listWorkflows: 'workflow.registry.list',
  overview: 'workflow.overview',
  optimization: 'workflow.optimization',
  audit: 'workflow.audit',
} as const;

export type WorkflowOperation =
  (typeof WORKFLOW_OPERATION)[keyof typeof WORKFLOW_OPERATION];

export interface WorkflowHttpRequest {
  /** Bound by the route table. Never read from the request body. */
  readonly operation: WorkflowOperation;
  readonly authorization: string | null;
  readonly body?: unknown;
  readonly workflowRunId?: string;
  readonly approvalId?: string;
  readonly limit?: number;
  readonly states?: readonly string[];
  readonly workflowId?: string;
  /** Platform readers only; ignored for everyone else. */
  readonly organizationId?: string;
  readonly correlationId?: string;
  readonly organizationHint?: string;
  readonly clientIp?: string;
}

export interface WorkflowHttpResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

/** Identifiers must be safe in a storage key, a log line and a URL path. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Seed fact keys. Deliberately narrower than an identifier. */
const FACT_KEY = /^[a-z][a-z0-9_]{0,59}$/;
const MAX_SEED_FACTS = 16;
const MAX_SEED_FACT_CHARS = 200;

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requireId(value: string | undefined, field: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new AIError('VALIDATION_FAILED', `A valid ${field} is required.`, { fields: [field] });
  }
  return value;
}

function optionalString(value: unknown, maxLength = 200): string | undefined {
  return typeof value === 'string' && value.length <= maxLength ? value : undefined;
}

function readStates(values: readonly string[] | undefined): readonly WorkflowRunState[] {
  if (!values) return [];
  return values.filter((value): value is WorkflowRunState =>
    (WORKFLOW_RUN_STATES as readonly string[]).includes(value),
  );
}

/**
 * Read seed facts from an unknown body.
 *
 * Anything that is not a well-named scalar is DROPPED rather than rejected. A
 * caller sending an extra field should not fail a run creation, and a caller
 * sending a nested object should not have it silently flattened into something
 * the fact map cannot hold — dropping is the only outcome that is both safe and
 * predictable.
 */
function readSeedFacts(value: unknown): Record<string, string | number | boolean> | undefined {
  const source = record(value);
  const facts: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(source)) {
    if (Object.keys(facts).length >= MAX_SEED_FACTS) break;
    if (!FACT_KEY.test(key)) continue;
    if (typeof entry === 'boolean') facts[key] = entry;
    else if (typeof entry === 'number' && Number.isFinite(entry)) facts[key] = entry;
    else if (typeof entry === 'string') facts[key] = entry.slice(0, MAX_SEED_FACT_CHARS);
  }
  return Object.keys(facts).length === 0 ? undefined : facts;
}

export async function executeWorkflowHttpRequest(
  service: WorkflowService,
  request: WorkflowHttpRequest,
): Promise<WorkflowHttpResponse> {
  const meta: WorkflowRequestMeta = {
    authorization: request.authorization,
    ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId }),
    ...(request.organizationHint === undefined
      ? {}
      : { organizationHint: request.organizationHint }),
    ...(request.clientIp === undefined ? {} : { clientIp: request.clientIp }),
  };

  try {
    // Authorization before dispatch, for every operation without exception.
    const actor = await service.authorize(meta);
    const body = record(request.body);

    switch (request.operation) {
      case WORKFLOW_OPERATION.createRun: {
        const seeded = readSeedFacts(body.facts);
        const create: CreateWorkflowRunRequest = {
          workflowId: requireId(optionalString(body.workflowId, 128), 'workflowId'),
          ...(seeded === undefined ? {} : { facts: seeded }),
          ...(body.surface === 'system' || body.surface === 'client_portal'
            ? { surface: body.surface }
            : {}),
          ...(typeof body.feature === 'string' ? { feature: body.feature.slice(0, 60) } : {}),
        };
        return ok({ run: await service.createRun(actor, create, meta) });
      }

      case WORKFLOW_OPERATION.getRun:
        return ok({
          run: await service.getRun(
            actor,
            requireId(request.workflowRunId, 'workflowRunId'),
            request.organizationId,
          ),
        });

      case WORKFLOW_OPERATION.listRuns:
        return ok({
          runs: await service.listRuns(actor, {
            states: readStates(request.states),
            ...(request.workflowId === undefined ? {} : { workflowId: request.workflowId }),
            ...(request.limit === undefined ? {} : { limit: request.limit }),
            ...(request.organizationId === undefined
              ? {}
              : { organizationId: request.organizationId }),
          }),
        });

      case WORKFLOW_OPERATION.pauseRun:
        return ok({
          run: await service.pauseRun(
            actor,
            requireId(request.workflowRunId, 'workflowRunId'),
            body.reason,
            meta,
          ),
        });

      case WORKFLOW_OPERATION.resumeRun:
        return ok({
          run: await service.resumeRun(
            actor,
            requireId(request.workflowRunId, 'workflowRunId'),
            body.reason,
            meta,
          ),
        });

      case WORKFLOW_OPERATION.cancelRun:
        return ok({
          run: await service.cancelRun(
            actor,
            requireId(request.workflowRunId, 'workflowRunId'),
            body.reason,
            meta,
          ),
        });

      case WORKFLOW_OPERATION.submitApproval: {
        if (body.decision !== 'approve' && body.decision !== 'reject') {
          throw new AIError('VALIDATION_FAILED', 'Field `decision` must be approve or reject.', {
            fields: ['decision'],
          });
        }
        return ok({
          run: await service.submitApproval(
            actor,
            {
              workflowRunId: requireId(request.workflowRunId, 'workflowRunId'),
              approvalId: requireId(
                request.approvalId ?? optionalString(body.approvalId, 128),
                'approvalId',
              ),
              decision: body.decision,
              reason: body.reason,
            },
            meta,
          ),
        });
      }

      case WORKFLOW_OPERATION.listApprovals:
        return ok({
          approvals: await service.listPendingApprovals(
            actor,
            request.organizationId,
            request.limit,
          ),
        });

      case WORKFLOW_OPERATION.listWorkflows:
        return ok({ workflows: service.listWorkflows(actor) });

      case WORKFLOW_OPERATION.overview:
        return ok({ overview: await service.overview(actor, request.organizationId) });

      case WORKFLOW_OPERATION.optimization:
        return ok({ optimization: await service.optimization(actor, request.organizationId) });

      case WORKFLOW_OPERATION.audit:
        return ok({ records: service.recentAudit(actor, request.limit) });

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
      // a transport code and — where the failure is a runtime one — the typed
      // failure an operator console can act on. Server-side detail stays in the
      // log and the workflow audit trail, where it is already recorded.
      body: {
        success: false,
        error: aiError.message,
        code: aiError.code,
        ...(isWorkflowRuntimeError(error)
          ? { failure: error.failure, retryable: error.retryable }
          : {}),
        ...(aiError.fields?.length ? { fields: aiError.fields } : {}),
      },
    };
  }
}

function ok(payload: Record<string, unknown>): WorkflowHttpResponse {
  return { status: 200, body: { success: true, ...payload } };
}
