/**
 * Request Orchestrator.
 *
 * The single sequence every AI request follows:
 *
 *   guard → policy → pipeline → account → audit → result
 *
 * The orchestrator owns cross-cutting concerns that must happen exactly once
 * per request and must happen whether the request succeeds or fails: audit,
 * metrics, lifecycle events and budget accounting. Keeping them here rather than
 * inside the pipeline is what guarantees a rejected request is as observable as
 * a successful one — a guard rejection produces an audit record, a metric and an
 * event just as a completion does.
 *
 * There is one nuance worth stating: a request rejected *before* the guard
 * produces a context has no identity to audit against. Those failures are
 * logged and counted with a synthetic identity rather than dropped, so a spike
 * of malformed or unauthenticated traffic is still visible on the dashboard.
 */

import type {
  AIExecutionResult,
  AIRequestContext,
  AIRequestEnvelope,
  AIRequestTransport,
} from './contracts/request.ts';
import type { AIBudgetPolicy, AIPolicyDecision } from './contracts/policy.ts';
import type { AIEventBus, AIEventName } from './contracts/events.ts';
import type { AIGuard } from './security/guard.ts';
import type { PolicyEngine } from './policy/policyEngine.ts';
import type { ExecutionPipeline } from './pipeline/executionPipeline.ts';
import type { BudgetEngine } from './policy/budget.ts';
import type { AuditWriter } from './observability/audit.ts';
import type { Logger } from './observability/logger.ts';
import type { Metrics } from './observability/metrics.ts';
import type { Clock } from './runtime/clock.ts';
import type { IdFactory } from './contracts/ids.ts';
import { AIError, toAIError } from './contracts/errors.ts';
import { policyErrorFor } from './policy/policyEngine.ts';
import { METRIC } from './observability/metrics.ts';

export interface OrchestratorDependencies {
  readonly guard: AIGuard;
  readonly policy: PolicyEngine;
  readonly pipeline: ExecutionPipeline;
  readonly budget: BudgetEngine;
  readonly budgetPolicy: AIBudgetPolicy;
  readonly audit: AuditWriter;
  readonly logger: Logger;
  readonly metrics: Metrics;
  readonly events: AIEventBus;
  readonly clock: Clock;
  readonly ids: IdFactory;
}

export interface RequestOrchestrator {
  execute<TOutput>(
    envelope: AIRequestEnvelope<unknown>,
    transport: AIRequestTransport,
  ): Promise<AIExecutionResult<TOutput>>;
}

export function createRequestOrchestrator(deps: OrchestratorDependencies): RequestOrchestrator {
  const { guard, policy, pipeline, budget, budgetPolicy, audit, logger, metrics, events, clock, ids } =
    deps;

  function emit(
    name: AIEventName,
    context: AIRequestContext,
    detail: Readonly<Record<string, string | number | boolean>>,
    errorCode?: AIError['code'],
  ): void {
    events.publish({
      eventId: ids.next('evt'),
      name,
      occurredAt: clock.isoNow(),
      identity: {
        requestId: context.requestId,
        correlationId: context.correlationId,
        featureId: context.featureId,
        organizationId: context.organization.organizationId,
        actorId: context.actor.actorId,
      },
      detail,
      errorCode,
    });
  }

  return {
    async execute<TOutput>(
      envelope: AIRequestEnvelope<unknown>,
      transport: AIRequestTransport,
    ): Promise<AIExecutionResult<TOutput>> {
      const startedAtMs = clock.now();
      let context: AIRequestContext | undefined;
      // Held outside the try so a denial records WHICH rule denied it. Without
      // this, a compliance review of a refused request sees only the code.
      let decision: AIPolicyDecision | undefined;

      try {
        // ── guard ────────────────────────────────────────────────────────
        const admitted = await guard.admit<unknown>(envelope, transport);
        context = admitted.context;

        emit('ai.request.received', context, {
          channel: context.channel,
          actorType: context.actor.actorType,
        });

        // ── policy ───────────────────────────────────────────────────────
        // Evaluated once, then raised here rather than inside `enforce`, so the
        // decision is captured for the audit trail before the throw unwinds it.
        const evaluation = policy.evaluate(context, admitted.definition.descriptor);
        decision = evaluation.decision;
        if (decision.effect === 'deny') {
          throw policyErrorFor(decision, admitted.definition.descriptor);
        }
        emit('ai.request.authorized', context, {
          rules: evaluation.decision.evaluated.length,
        });
        if (evaluation.budget.thresholdReached) {
          emit('ai.budget.threshold_reached', context, {
            organizationId: context.organization.organizationId,
          });
        }

        // ── pipeline ─────────────────────────────────────────────────────
        const outcome = await pipeline.run(context, admitted.definition, admitted.input);

        // ── account ──────────────────────────────────────────────────────
        budget.record(
          context.organization.organizationId,
          context.actor.actorId,
          budgetPolicy,
          outcome.costMicroUsd,
        );

        const latencyMs = clock.now() - startedAtMs;

        // ── audit ────────────────────────────────────────────────────────
        audit.record(context, {
          outcome: 'success',
          latencyMs,
          attempts: outcome.attempts,
          failedProviders: outcome.failedProviders,
          providerId: outcome.providerId,
          modelId: outcome.modelId,
          promptId: outcome.promptId,
          promptVersion: outcome.promptVersion,
          promptHash: outcome.promptHash,
          inputDigest: outcome.inputDigest,
          outputDigest: outcome.outputDigest,
          usage: outcome.usage,
          costMicroUsd: outcome.costMicroUsd,
          policy: evaluation.decision,
          inputGuard: outcome.inputGuardStatus,
          outputGuard: outcome.outputGuardStatus,
          redactedCategories: outcome.redactedCategories,
          governanceFlags: outcome.governanceFlags,
          factLockRestored: outcome.factLockRestored,
        });

        metrics.increment(METRIC.requestsTotal, {
          feature: context.featureId,
          outcome: 'success',
          provider: outcome.providerId,
        });
        metrics.observe(METRIC.requestLatencyMs, latencyMs, { feature: context.featureId });

        emit('ai.request.succeeded', context, {
          provider: outcome.providerId,
          model: outcome.modelId,
          attempts: outcome.attempts,
          latencyMs,
          totalTokens: outcome.usage.totalTokens,
          costMicroUsd: outcome.costMicroUsd,
        });

        logger.info('ai.request.succeeded', {
          requestId: context.requestId,
          correlationId: context.correlationId,
          feature: context.featureId,
          organizationId: context.organization.organizationId,
          provider: outcome.providerId,
          model: outcome.modelId,
          attempts: outcome.attempts,
          latencyMs,
          totalTokens: outcome.usage.totalTokens,
          costMicroUsd: outcome.costMicroUsd,
          factLockRestored: outcome.factLockRestored.length,
        });

        return {
          requestId: context.requestId,
          correlationId: context.correlationId,
          featureId: context.featureId,
          featureVersion: context.featureVersion,
          platformVersion: context.platformVersion,
          contractVersion: context.contractVersion,
          promptId: outcome.promptId,
          promptVersion: outcome.promptVersion,
          promptHash: outcome.promptHash,
          output: outcome.output as TOutput,
          usage: outcome.usage,
          cost: { microUsd: outcome.costMicroUsd, basis: 'metered' },
          execution: {
            providerId: outcome.providerId,
            modelId: outcome.modelId,
            attempts: outcome.attempts,
            latencyMs: outcome.providerLatencyMs,
            failedProviders: outcome.failedProviders,
          },
          governance: {
            inputGuard: outcome.inputGuardStatus,
            outputGuard: outcome.outputGuardStatus,
            redactedCategories: outcome.redactedCategories,
            factLockRestored: outcome.factLockRestored,
          },
          completedAt: clock.isoNow(),
        };
      } catch (error) {
        const aiError = toAIError(error);
        const latencyMs = clock.now() - startedAtMs;

        if (context) {
          audit.record(context, {
            outcome: 'failure',
            latencyMs,
            attempts: 0,
            policy: decision,
            errorCode: aiError.code,
            errorMessage: aiError.message,
          });
          emit('ai.request.failed', context, { latencyMs }, aiError.code);
          metrics.increment(METRIC.requestsTotal, {
            feature: context.featureId,
            outcome: 'error',
            code: aiError.code,
          });
          metrics.increment(METRIC.requestErrorsTotal, {
            feature: context.featureId,
            code: aiError.code,
          });
          logger.error('ai.request.failed', {
            requestId: context.requestId,
            correlationId: context.correlationId,
            feature: context.featureId,
            organizationId: context.organization.organizationId,
            code: aiError.code,
            status: aiError.status,
            latencyMs,
            diagnostics: aiError.diagnostics,
          });
        } else {
          // Rejected before an identity existed. Counted under the requested
          // feature id so a spike of malformed or unauthenticated traffic is
          // still visible, without inventing an actor or an organization.
          metrics.increment(METRIC.guardRejectionsTotal, {
            feature: envelope.featureId,
            code: aiError.code,
          });
          logger.warn('ai.request.rejected', {
            feature: envelope.featureId,
            code: aiError.code,
            status: aiError.status,
            latencyMs,
            diagnostics: aiError.diagnostics,
          });
        }

        throw aiError;
      }
    },
  };
}
