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
import type { ExecutionPipeline, ProviderAttemptRecord } from './pipeline/executionPipeline.ts';
import type { BudgetEngine } from './policy/budget.ts';
import type { SpendGuard } from './policy/spendGuard.ts';
import type { AuditWriter } from './observability/audit.ts';
import type { Logger } from './observability/logger.ts';
import type { Metrics } from './observability/metrics.ts';
import type { Clock } from './runtime/clock.ts';
import type { IdFactory } from './contracts/ids.ts';
import { AIError, toAIError } from './contracts/errors.ts';
import { CONTRACT_VERSION, PLATFORM_VERSION } from './contracts/versions.ts';
import { adoptOrCreateId } from './contracts/ids.ts';
import { policyErrorFor } from './policy/policyEngine.ts';
import { METRIC } from './observability/metrics.ts';

export interface OrchestratorDependencies {
  readonly guard: AIGuard;
  readonly policy: PolicyEngine;
  readonly pipeline: ExecutionPipeline;
  readonly budget: BudgetEngine;
  readonly budgetPolicy: AIBudgetPolicy;
  /** The MARQ lifetime ceiling and real-request kill switch. */
  readonly spend: SpendGuard;
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
  const { guard, policy, pipeline, budget, budgetPolicy, spend, audit, logger, metrics, events, clock, ids } =
    deps;

  /**
   * Close out a spend reservation against what the attempts actually cost.
   *
   * Two cases, and the distinction is the point:
   *
   *   No billable attempt happened — the request was refused before a provider
   *   was reached, or it was served by the mock. The reservation is released in
   *   full; nothing was spent, so nothing is charged.
   *
   *   Billable attempts happened — each is charged at its measured cost. An
   *   attempt that failed reports no usage, because a provider that errored did
   *   not tell us what it billed; those are charged at a conservative share of
   *   the reservation rather than at zero, so an outage that burns attempts
   *   still moves the ledger toward the cap instead of looking free.
   */
  async function settleSpend(
    handle: Awaited<ReturnType<SpendGuard['reserve']>>,
    attempts: readonly ProviderAttemptRecord[],
    outcome: 'success' | 'failure',
  ): Promise<void> {
    if (!handle.reserved) return;

    const billableAttempts = attempts.filter((attempt) => attempt.billable);
    if (billableAttempts.length === 0) {
      await handle.release();
      return;
    }

    const measured = billableAttempts.reduce((sum, attempt) => sum + attempt.costMicroUsd, 0);
    const unmeasured = billableAttempts.filter((attempt) => attempt.usage === undefined).length;

    // A failed billable attempt's true cost is unknown. Charging it at the
    // per-attempt share of the reservation keeps the ledger conservative: it
    // over-counts slightly rather than letting a failing provider consume the
    // budget invisibly.
    const perAttemptShare =
      handle.estimateMicroUsd > 0 && billableAttempts.length > 0
        ? Math.ceil(handle.estimateMicroUsd / billableAttempts.length)
        : 0;
    const assumed = unmeasured * perAttemptShare;

    const total = outcome === 'success' ? measured + assumed : Math.max(measured + assumed, 0);
    await handle.settle(Math.min(total, handle.estimateMicroUsd));
  }

  /**
   * Build the minimum context an audit record needs for a guard-stage
   * rejection.
   *
   * Every field is either a fact the guard established or an explicit marker.
   * `organizationId` falls back to `'unresolved'` rather than to a default
   * tenant: the whole point of auditing this rejection is that the caller did
   * NOT resolve to an organization, and writing one in would erase that.
   */
  function synthesizeContext(
    envelope: AIRequestEnvelope<unknown>,
    security: NonNullable<AIError['securityContext']>,
    _latencyMs: number,
  ): AIRequestContext {
    const synthesized: AIRequestContext = {
      requestId: ids.next('req'),
      correlationId: adoptOrCreateId(envelope.correlationId, 'cor', ids),
      causationId: envelope.causationId,
      receivedAt: clock.isoNow(),
      platformVersion: PLATFORM_VERSION,
      contractVersion: envelope.contractVersion ?? CONTRACT_VERSION,
      featureId: envelope.featureId,
      featureVersion: 'unresolved',
      actor: {
        actorId: security.subjectId,
        actorType: security.actorType as AIRequestContext['actor']['actorType'],
        subjectId: security.subjectId,
        roles: security.roles,
        capabilities: [],
      },
      organization: {
        organizationId: security.organizationId ?? 'unresolved',
        tier: 'standard' as const,
        membershipVerified: false,
        isolationKey: `org:${security.organizationId ?? 'unresolved'}`,
      },
      channel: 'team_console',
      attributes: Object.freeze(
        security.requestedOrganizationId
          ? ({ requestedOrganizationId: security.requestedOrganizationId } as Record<string, string>)
          : ({} as Record<string, string>),
      ),
    };
    return Object.freeze(synthesized);
  }

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
      // Attempts are collected as they happen rather than read off the outcome,
      // because a request that FAILS has no outcome — and a failed request that
      // burned two paid attempts is exactly the one whose cost must be recorded.
      const attempts: ProviderAttemptRecord[] = [];
      let reservation: Awaited<ReturnType<SpendGuard['reserve']>> | undefined;

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

        // ── spend ────────────────────────────────────────────────────────
        // The MARQ lifetime ceiling, reserved BEFORE the pipeline can reach a
        // provider. A request projected to cross the cap is refused here, with
        // no vendor call made and nothing to refund.
        reservation = await spend.reserve(admitted.definition.descriptor, context.requestId);
        if (reservation.reserved) {
          emit('ai.spend.reserved', context, { estimateMicroUsd: reservation.estimateMicroUsd });
        }

        // ── pipeline ─────────────────────────────────────────────────────
        const outcome = await pipeline.run(
          context,
          admitted.definition,
          admitted.input,
          (attempt) => attempts.push(attempt),
        );

        // ── account ──────────────────────────────────────────────────────
        budget.record(
          context.organization.organizationId,
          context.actor.actorId,
          budgetPolicy,
          outcome.costMicroUsd,
        );
        await settleSpend(reservation, attempts, 'success');

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

        // Settle before anything else in the failure path. Attempts that
        // reached a paid provider are charged whether the request succeeded or
        // not, and a reservation held by a failed request must not stay held.
        if (reservation) {
          try {
            await settleSpend(reservation, attempts, 'failure');
          } catch (settlementError) {
            logger.error('ai.spend.settlement_failed', {
              requestId: context?.requestId,
              diagnostics:
                settlementError instanceof Error
                  ? settlementError.message
                  : String(settlementError),
            });
          }
        }

        const billedMicroUsd = attempts.reduce((sum, attempt) => sum + attempt.costMicroUsd, 0);
        if (context && billedMicroUsd > 0) {
          budget.record(
            context.organization.organizationId,
            context.actor.actorId,
            budgetPolicy,
            billedMicroUsd,
          );
        }

        if (context) {
          const lastAttempt = attempts.at(-1);
          audit.record(context, {
            outcome: 'failure',
            latencyMs,
            attempts: attempts.length,
            failedProviders: [...new Set(attempts.map((attempt) => attempt.providerId))],
            providerId: lastAttempt?.providerId,
            modelId: lastAttempt?.modelId,
            costMicroUsd: billedMicroUsd,
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
          metrics.increment(METRIC.guardRejectionsTotal, {
            feature: envelope.featureId,
            code: aiError.code,
          });
          logger.warn('ai.request.rejected', {
            feature: envelope.featureId,
            code: aiError.code,
            status: aiError.status,
            latencyMs,
            subjectId: aiError.securityContext?.subjectId,
            requestedOrganizationId: aiError.securityContext?.requestedOrganizationId,
            diagnostics: aiError.diagnostics,
          });

          // An authenticated caller who was then refused — a cross-tenant reach,
          // an unresolvable organization — is attributable, so it is audited.
          // Only a request rejected before authentication has nobody to
          // attribute it to; those stay counted and logged rather than audited
          // against an invented actor.
          const security = aiError.securityContext;
          if (security) {
            audit.record(
              synthesizeContext(envelope, security, latencyMs),
              {
                outcome: 'failure',
                latencyMs,
                attempts: 0,
                errorCode: aiError.code,
                errorMessage: aiError.message,
              },
            );
          }
        }

        // One identifier survives the whole path, success or failure. A support
        // engineer holding the requestId from a failed response can find the
        // audit record, the log lines and the events without a join.
        throw context ? aiError.withTrace(context.requestId, context.correlationId) : aiError;
      }
    },
  };
}
