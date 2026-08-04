/**
 * The model execution port, and its one implementation over the AI Control
 * Plane (AI-01 Batch 3A).
 *
 * This is the ONLY place in the agent runtime that can cause a model call, and
 * it causes one by doing exactly what a route does: building an
 * `AIRequestEnvelope` and handing it to `controlPlane.execute`. It has no
 * provider import, no adapter reference, no model id and no credential. What it
 * knows is a feature id and a payload.
 *
 * THE PORT EXISTS SO THE ORCHESTRATOR CANNOT KNOW MORE THAN THAT. A test
 * substitutes a fake port and exercises the whole orchestrator without a plane;
 * production substitutes this one. There is no third implementation and no way
 * for the orchestrator to reach past the interface, because the interface is
 * all it is given.
 *
 * CREDENTIALS ARE CARRIED, NEVER STORED.
 *
 * The control plane authenticates every request. An agent step is a request, so
 * it needs a credential — and the run record must never hold one. So the
 * caller's authorization travels as an argument on the invocation that drives
 * the run and is discarded when that call returns. The consequence is
 * deliberate and worth stating plainly: a run advances only while an
 * authenticated caller is driving it. Resuming a paused run requires somebody
 * to resume it, and that somebody's own authority is re-checked by the guard on
 * every subsequent step. A background scheduler that advanced runs on a stored
 * token would be a stored token, which is precisely the thing this platform
 * does not do.
 *
 * TENANT SCOPE IS RE-PROVEN, NOT ASSERTED. The envelope carries the run's
 * organization as a HINT, and the guard honours a hint only when the
 * authenticated subject actually holds a membership in it. So a run whose
 * record says `globex` cannot execute a step on a caller who only belongs to
 * `acme` — the step fails at the guard, not at a check this module wrote.
 */

import type { AIControlPlane } from '../../controlPlane.ts';
import type { AITokenUsage } from '../../contracts/request.ts';
import { toAIError } from '../../contracts/errors.ts';
import { agentFailure } from '../contracts/failures.ts';

export interface ModelStepRequest {
  /** Registered control plane feature the routed profile executes through. */
  readonly featureId: string;
  readonly input: unknown;
  readonly correlationId: string;
  /** The requestId of the API call driving this run. Links the two trails. */
  readonly causationId?: string;
  readonly organizationId: string;
  /** The driving caller's credential. Never persisted anywhere. */
  readonly authorization: string | null;
  readonly clientIp?: string;
}

export interface ModelStepResult {
  /** The control plane's request id. The join key into the AI audit trail. */
  readonly requestId: string;
  readonly output: unknown;
  readonly usage: AITokenUsage;
  readonly costMicroUsd: number;
  readonly providerId: string;
  readonly modelId: string;
  readonly promptId: string;
  readonly promptVersion: string;
  readonly completedAt: string;
}

export interface ModelExecutionPort {
  execute(request: ModelStepRequest): Promise<ModelStepResult>;
}

export function createControlPlaneModelPort(plane: AIControlPlane): ModelExecutionPort {
  return {
    async execute(request) {
      try {
        const result = await plane.execute<Record<string, unknown>>(
          {
            featureId: request.featureId,
            input: request.input,
            correlationId: request.correlationId,
            causationId: request.causationId,
            // `system` would be wrong: the run is driven by a console caller
            // whose channel restrictions the feature declares. The agent step
            // feature permits both, and using the honest one keeps the audit
            // record truthful about where the request came from.
            channel: 'team_console',
          },
          {
            authorization: request.authorization,
            organizationHint: request.organizationId,
            clientIp: request.clientIp,
          },
        );

        return {
          requestId: result.requestId,
          output: result.output,
          usage: result.usage,
          costMicroUsd: result.cost.microUsd,
          providerId: result.execution.providerId,
          modelId: result.execution.modelId,
          promptId: result.promptId,
          promptVersion: result.promptVersion,
          completedAt: result.completedAt,
        };
      } catch (error) {
        // The control plane's own taxonomy is preserved in `diagnostics` and
        // translated into the runtime's. Budget and policy refusals are
        // re-raised as the terminal failures they are so a run stops rather
        // than retrying against a decision that has already been made.
        const aiError = toAIError(error);
        const diagnostics = `control plane ${aiError.code}: ${aiError.diagnostics ?? aiError.message}`;

        if (aiError.code === 'BUDGET_EXCEEDED') {
          throw agentFailure('cost_budget_exhausted', aiError.message, { diagnostics, cause: error });
        }
        if (aiError.code === 'AI_DISABLED') {
          throw agentFailure('runtime_disabled', aiError.message, { diagnostics, cause: error });
        }
        if (
          aiError.code === 'CAPABILITY_DENIED' ||
          aiError.code === 'POLICY_DENIED' ||
          aiError.code === 'FEATURE_DISABLED' ||
          aiError.code === 'FORBIDDEN'
        ) {
          throw agentFailure('capability_denied', aiError.message, { diagnostics, cause: error });
        }
        if (
          aiError.code === 'TENANT_ISOLATION_VIOLATION' ||
          aiError.code === 'ORGANIZATION_NOT_RESOLVED' ||
          aiError.code === 'ORGANIZATION_REQUIRED'
        ) {
          throw agentFailure('tenant_isolation_violation', aiError.message, {
            diagnostics,
            cause: error,
          });
        }
        if (
          aiError.code === 'NO_PROVIDER_AVAILABLE' ||
          aiError.code === 'PROVIDER_UNAVAILABLE' ||
          aiError.code === 'PROVIDER_TIMEOUT' ||
          aiError.code === 'CIRCUIT_OPEN' ||
          aiError.code === 'PROVIDER_AUTH_FAILED'
        ) {
          throw agentFailure('provider_unavailable', aiError.message, { diagnostics, cause: error });
        }
        if (aiError.code === 'AUTH_REQUIRED' || aiError.code === 'AUTH_INVALID') {
          throw agentFailure('unauthorized', aiError.message, { diagnostics, cause: error });
        }
        // Everything else — a malformed completion, a governance block, a rate
        // limit — is a step failure the runtime may retry within its own
        // allowance. The message is the control plane's caller-safe one.
        throw agentFailure('model_failed', aiError.message, { diagnostics, cause: error });
      }
    },
  };
}
