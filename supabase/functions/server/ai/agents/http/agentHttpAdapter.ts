/**
 * Framework-agnostic HTTP adapter for the agent runtime (AI-01 Batch 3A).
 *
 * The same shape as `ai/http/httpAdapter.ts` and `ai/admin/httpAdapter.ts`, and
 * for the same reasons: the whole request/response mapping is a pure function,
 * so status codes, error bodies and — most importantly — the authorization
 * boundary are unit-testable without a server.
 *
 * ONE ENTRY POINT. Every operation goes through `executeAgentHttpRequest`,
 * which AUTHORISES FIRST and DISPATCHES SECOND. There is no handler reachable
 * without the caller having been resolved to a runtime actor, because dispatch
 * happens inside the function that does the resolving. A route file cannot
 * forget the check — there is nothing in a route file to forget.
 *
 * THE OPERATION IS BOUND BY THE ROUTE TABLE, NEVER READ FROM THE BODY. A caller
 * cannot ask for `run.cancel` at the `run.get` endpoint. That is the same
 * decision the administration adapter made after a review found the alternative
 * pattern — a handler per operation, each repeating its own role comparison —
 * had produced two endpoints with no authentication at all.
 *
 * BODIES ARE READ FIELD BY FIELD. Each operation reads exactly the fields it
 * declares from an unknown body and ignores everything else, so an undeclared
 * key cannot reach the orchestrator. Identifiers are pattern-checked before
 * they are used, because they end up in storage keys and log lines.
 */

import type {
  AgentRequestMeta,
  AgentRuntimeService,
  CreateRunRequest,
} from '../service/agentRuntimeService.ts';
import type { AgentRunState } from '../contracts/runtime.ts';
import { AGENT_RUN_STATES } from '../contracts/runtime.ts';
import { AIError, toAIError } from '../../contracts/errors.ts';
import { isAgentRuntimeError } from '../contracts/failures.ts';

export const AGENT_OPERATION = {
  createRun: 'run.create',
  getRun: 'run.get',
  listRuns: 'run.list',
  pauseRun: 'run.pause',
  resumeRun: 'run.resume',
  cancelRun: 'run.cancel',
  retryRun: 'run.retry',
  runSteps: 'run.steps',
  runUsage: 'run.usage',
  submitApproval: 'approval.decide',
  listApprovals: 'approval.list',
  listAgents: 'registry.agents',
  listTools: 'registry.tools',
  overview: 'runtime.overview',
  audit: 'runtime.audit',
} as const;

export type AgentOperation = (typeof AGENT_OPERATION)[keyof typeof AGENT_OPERATION];

export interface AgentHttpRequest {
  /** Bound by the route table. Never read from the request body. */
  readonly operation: AgentOperation;
  readonly authorization: string | null;
  readonly body?: unknown;
  /** Path parameter. Pattern-checked before use. */
  readonly runId?: string;
  readonly approvalId?: string;
  readonly limit?: number;
  readonly states?: readonly string[];
  readonly agentId?: string;
  /** Platform readers only; ignored for everyone else. */
  readonly organizationId?: string;
  readonly correlationId?: string;
  readonly organizationHint?: string;
  readonly clientIp?: string;
}

export interface AgentHttpResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

/** Identifiers must be safe in a storage key, a log line and a URL path. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

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

function readStates(values: readonly string[] | undefined): readonly AgentRunState[] {
  if (!values) return [];
  return values.filter((value): value is AgentRunState =>
    (AGENT_RUN_STATES as readonly string[]).includes(value),
  );
}

export async function executeAgentHttpRequest(
  service: AgentRuntimeService,
  request: AgentHttpRequest,
): Promise<AgentHttpResponse> {
  const meta: AgentRequestMeta = {
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
      case AGENT_OPERATION.createRun: {
        const create: CreateRunRequest = {
          agentId: requireId(optionalString(body.agentId, 128), 'agentId'),
          objective: typeof body.objective === 'string' ? body.objective : '',
          input: body.input,
          ...(typeof body.workflowId === 'string'
            ? { workflowId: requireId(body.workflowId, 'workflowId') }
            : {}),
          ...(body.surface === 'system' || body.surface === 'client_portal'
            ? { surface: body.surface }
            : {}),
          ...(typeof body.feature === 'string' ? { feature: body.feature.slice(0, 60) } : {}),
        };
        return ok({ run: await service.createRun(actor, create, meta) });
      }

      case AGENT_OPERATION.getRun:
        return ok({
          run: await service.getRun(
            actor,
            requireId(request.runId, 'runId'),
            request.organizationId,
          ),
        });

      case AGENT_OPERATION.listRuns:
        return ok({
          runs: await service.listRuns(actor, {
            states: readStates(request.states),
            ...(request.agentId === undefined ? {} : { agentId: request.agentId }),
            ...(request.limit === undefined ? {} : { limit: request.limit }),
            ...(request.organizationId === undefined
              ? {}
              : { organizationId: request.organizationId }),
          }),
        });

      case AGENT_OPERATION.pauseRun:
        return ok({
          run: await service.pauseRun(actor, requireId(request.runId, 'runId'), body.reason, meta),
        });

      case AGENT_OPERATION.resumeRun:
        return ok({
          run: await service.resumeRun(actor, requireId(request.runId, 'runId'), body.reason, meta),
        });

      case AGENT_OPERATION.cancelRun:
        return ok({
          run: await service.cancelRun(actor, requireId(request.runId, 'runId'), body.reason, meta),
        });

      case AGENT_OPERATION.retryRun:
        return ok({
          run: await service.retryRun(actor, requireId(request.runId, 'runId'), body.reason, meta),
        });

      case AGENT_OPERATION.runSteps:
        return ok({
          steps: await service.getRunSteps(
            actor,
            requireId(request.runId, 'runId'),
            request.organizationId,
          ),
        });

      case AGENT_OPERATION.runUsage:
        return ok({
          usage: await service.getRunUsage(
            actor,
            requireId(request.runId, 'runId'),
            request.organizationId,
          ),
        });

      case AGENT_OPERATION.submitApproval: {
        const decision = body.decision === 'reject' ? 'reject' : 'approve';
        if (body.decision !== 'approve' && body.decision !== 'reject') {
          throw new AIError('VALIDATION_FAILED', 'Field `decision` must be approve or reject.', {
            fields: ['decision'],
          });
        }
        return ok({
          run: await service.submitApproval(
            actor,
            {
              runId: requireId(request.runId, 'runId'),
              approvalId: requireId(request.approvalId ?? optionalString(body.approvalId, 128), 'approvalId'),
              decision,
              reason: body.reason,
            },
            meta,
          ),
        });
      }

      case AGENT_OPERATION.listApprovals:
        return ok({
          approvals: await service.listPendingApprovals(
            actor,
            request.organizationId,
            request.limit,
          ),
        });

      case AGENT_OPERATION.listAgents:
        return ok({ agents: service.listAgents(actor) });

      case AGENT_OPERATION.listTools:
        return ok({ tools: service.listTools(actor) });

      case AGENT_OPERATION.overview:
        return ok({ overview: await service.overview(actor, request.organizationId) });

      case AGENT_OPERATION.audit:
        return ok({ records: service.recentAudit(actor, request.limit) });

      default:
        // Unreachable while the route table binds only declared operations.
        // Present so adding an operation to the union without a case here is a
        // 404 rather than an undefined response.
        throw new AIError('FEATURE_NOT_FOUND', 'Unknown agent runtime operation.', {
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
      // log and the agent audit trail, where it is already recorded.
      body: {
        success: false,
        error: aiError.message,
        code: aiError.code,
        ...(isAgentRuntimeError(error) ? { failure: error.failure, retryable: error.retryable } : {}),
        ...(aiError.fields?.length ? { fields: aiError.fields } : {}),
      },
    };
  }
}

function ok(payload: Record<string, unknown>): AgentHttpResponse {
  return { status: 200, body: { success: true, ...payload } };
}
