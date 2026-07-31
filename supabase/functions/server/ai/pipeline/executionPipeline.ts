/**
 * AI Execution Pipeline.
 *
 * The ordered stages every AI request passes through after the guard and the
 * policy engine have admitted it. Stages are named and measured individually, so
 * "AI is slow" resolves to a stage rather than a guess.
 *
 *   prompt_render     resolve the registered prompt, render its variables
 *   input_guard       redact PII, neutralise injection attempts
 *   provider_select   requirements → ordered (provider, model) candidates
 *   provider_invoke   attempt loop: timeout, retry, circuit, failover
 *   output_guard      structural and compliance validation of the completion
 *   output_parse      feature-owned parsing into its typed contract
 *   fact_lock         deterministic restoration of authoritative fields
 *
 * The attempt loop is the heart of the reliability story, and the ordering
 * inside it is deliberate:
 *
 *   The output guard runs INSIDE the attempt. A model that returns malformed
 *   JSON has produced a retryable failure, and retrying costs one call; failing
 *   the user's request costs the interaction. Running the guard outside the loop
 *   would make every malformed response terminal.
 *
 *   Only provider faults open the circuit. A guard rejection means the provider
 *   answered correctly and the *content* was unacceptable — opening a circuit on
 *   that would take a healthy provider out of rotation because a prompt needs
 *   work.
 */

import type { AIError, AIErrorCode } from '../contracts/errors.ts';
import type {
  AIGenerationRequest,
  AIMessage,
  AIRequestContext,
  AITokenUsage,
} from '../contracts/request.ts';
import type { AIFeatureDescriptor } from '../contracts/policy.ts';
import type { AIEventBus } from '../contracts/events.ts';
import type { AIFeatureDefinition } from '../policy/featureCatalog.ts';
import type { PromptRegistry } from '../prompts/registry.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import type { ProviderSelector } from '../providers/selector.ts';
import type { CircuitBreaker } from '../providers/circuitBreaker.ts';
import type { RetryScheduler } from '../providers/retry.ts';
import type { Clock } from '../runtime/clock.ts';
import type { Logger } from '../observability/logger.ts';
import type { Metrics } from '../observability/metrics.ts';
import type { IdFactory } from '../contracts/ids.ts';
import type { AIControlPlaneConfig } from '../runtime/config.ts';
import { toAIError } from '../contracts/errors.ts';
import { applyInputGuard } from '../governance/inputGuard.ts';
import { applyOutputGuard, assertRequiredFields } from '../governance/outputGuard.ts';
import { enforceFactLock } from '../governance/factLock.ts';
import { estimateCostMicroUsd } from '../providers/selector.ts';
import { shouldFailover, shouldRetrySameProvider } from '../providers/retry.ts';
import { withTimeout } from '../providers/timeout.ts';
import { METRIC } from '../observability/metrics.ts';
import { sha256Hex } from '../prompts/hash.ts';

export const PIPELINE_STAGES = [
  'prompt_render',
  'input_guard',
  'provider_select',
  'provider_invoke',
  'output_guard',
  'output_parse',
  'fact_lock',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Failures that mean the provider itself is unhealthy. */
const PROVIDER_FAULTS: ReadonlySet<AIErrorCode> = new Set<AIErrorCode>([
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_AUTH_FAILED',
  'INVALID_MODEL_OUTPUT',
]);

export interface PipelineDependencies {
  readonly prompts: PromptRegistry;
  readonly providers: ProviderRegistry;
  readonly selector: ProviderSelector;
  readonly circuit: CircuitBreaker;
  readonly retry: RetryScheduler;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly metrics: Metrics;
  readonly events: AIEventBus;
  readonly ids: IdFactory;
  readonly config: AIControlPlaneConfig;
}

export interface PipelineOutcome<TOutput> {
  readonly output: TOutput;
  readonly promptId: string;
  readonly promptVersion: string;
  readonly promptHash: string;
  readonly inputDigest: string;
  readonly outputDigest: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly attempts: number;
  readonly failedProviders: readonly string[];
  readonly usage: AITokenUsage;
  readonly costMicroUsd: number;
  readonly inputGuardStatus: 'pass' | 'redacted' | 'blocked';
  readonly outputGuardStatus: 'pass' | 'flagged';
  readonly redactedCategories: readonly string[];
  readonly governanceFlags: readonly string[];
  readonly factLockRestored: readonly string[];
  readonly providerLatencyMs: number;
}

export interface ExecutionPipeline {
  run<TInput, TOutput>(
    context: AIRequestContext,
    definition: AIFeatureDefinition<TInput, TOutput>,
    input: TInput,
  ): Promise<PipelineOutcome<TOutput>>;
}

export function createExecutionPipeline(deps: PipelineDependencies): ExecutionPipeline {
  const { prompts, providers, selector, circuit, retry, clock, logger, metrics, events, ids, config } =
    deps;

  function publish(
    name: Parameters<AIEventBus['publish']>[0]['name'],
    context: AIRequestContext,
    detail: Readonly<Record<string, string | number | boolean>>,
    errorCode?: AIErrorCode,
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
    async run<TInput, TOutput>(
      context: AIRequestContext,
      definition: AIFeatureDefinition<TInput, TOutput>,
      input: TInput,
    ): Promise<PipelineOutcome<TOutput>> {
      const descriptor = definition.descriptor;
      const featureLabels = { feature: descriptor.featureId };

      // ── prompt_render ────────────────────────────────────────────────────
      const promptId = definition.resolvePromptId?.(input) ?? descriptor.promptId;
      const variables = definition.buildVariables(input, context);
      const rendered = prompts.render(promptId, variables);

      const baseMessages: AIMessage[] = [
        { role: 'system', content: rendered.system },
        { role: 'user', content: rendered.user },
        ...(definition.buildConversation?.(input) ?? []),
      ];

      // ── input_guard ──────────────────────────────────────────────────────
      const guarded = applyInputGuard(baseMessages, descriptor.governance, {
        redactionEnabled: config.governance.redactionEnabled,
        strict: config.governance.strictInputGuard,
      });

      if (guarded.redactedCategories.length > 0) {
        metrics.increment(METRIC.redactionsTotal, featureLabels, guarded.redactedCategories.length);
        publish('ai.governance.input_redacted', context, {
          categories: guarded.redactedCategories.join(','),
        });
      }
      if (guarded.neutralizedInjections > 0) {
        logger.warn('ai.input_guard.injection_neutralized', {
          requestId: context.requestId,
          correlationId: context.correlationId,
          feature: descriptor.featureId,
          count: guarded.neutralizedInjections,
        });
      }

      const generation: AIGenerationRequest = {
        messages: guarded.messages,
        responseFormat: descriptor.responseFormat,
        temperature: descriptor.temperature,
        maxOutputTokens: descriptor.limits.maxOutputTokens,
      };

      const inputDigest = sha256Hex(
        guarded.messages.map((message) => `${message.role}:${message.content}`).join('\n'),
      );

      // ── provider_select ──────────────────────────────────────────────────
      const candidates = selector.select({
        structuredOutput: descriptor.requiredCapabilities.structuredOutput,
        chatCompletions: descriptor.requiredCapabilities.chatCompletions,
        minOutputTokens: descriptor.limits.maxOutputTokens,
      });

      // ── provider_invoke ──────────────────────────────────────────────────
      const failedProviders: string[] = [];
      let lastError: AIError | undefined;
      let totalAttempts = 0;

      for (const candidate of candidates) {
        if (!circuit.canAttempt(candidate.providerId)) {
          failedProviders.push(candidate.providerId);
          continue;
        }

        publish('ai.provider.selected', context, {
          provider: candidate.providerId,
          model: candidate.model.modelId,
        });

        const adapter = providers.get(candidate.providerId).adapter;
        let providerSucceeded = false;

        for (let attempt = 1; attempt <= descriptor.limits.maxAttempts; attempt += 1) {
          totalAttempts += 1;
          await retry.wait(retry.delayFor(attempt, config.retry));

          const startedAtMs = clock.now();
          try {
            const completion = await withTimeout(
              descriptor.limits.timeoutMs,
              candidate.providerId,
              (handle) =>
                adapter.invoke({
                  requestId: context.requestId,
                  correlationId: context.correlationId,
                  modelId: candidate.model.modelId,
                  generation,
                  attempt,
                  signal: handle.signal,
                }),
            );

            const providerLatencyMs = clock.now() - startedAtMs;

            // ── output_guard (inside the attempt: a bad completion is retryable)
            const outputGuard = applyOutputGuard(
              completion.content,
              descriptor.governance,
              descriptor.responseFormat,
            );
            if (outputGuard.parsed && descriptor.governance.requiredOutputFields.length > 0) {
              assertRequiredFields(outputGuard.parsed, descriptor.governance.requiredOutputFields);
            }

            circuit.recordSuccess(candidate.providerId);
            providers.recordSuccess(candidate.providerId, providerLatencyMs);
            providerSucceeded = true;

            metrics.increment(METRIC.providerAttemptsTotal, {
              ...featureLabels,
              provider: candidate.providerId,
              outcome: 'success',
            });
            metrics.observe(METRIC.providerLatencyMs, providerLatencyMs, {
              provider: candidate.providerId,
              model: candidate.model.modelId,
            });

            if (outputGuard.flags.length > 0) {
              metrics.increment(METRIC.governanceFlagsTotal, featureLabels, outputGuard.flags.length);
            }

            // ── output_parse ─────────────────────────────────────────────
            let output = definition.parseOutput(outputGuard.content, input);

            // ── fact_lock ────────────────────────────────────────────────
            let restored: readonly string[] = [];
            if (definition.applyFactLock) {
              const locked = definition.applyFactLock(output, input);
              output = locked.output;
              restored = locked.restored;
            }
            if (restored.length > 0) {
              metrics.increment(METRIC.factLockRestoresTotal, featureLabels, restored.length);
              publish('ai.governance.fact_lock_enforced', context, {
                fields: restored.join(','),
                provider: candidate.providerId,
              });
              logger.warn('ai.fact_lock.restored', {
                requestId: context.requestId,
                correlationId: context.correlationId,
                feature: descriptor.featureId,
                provider: candidate.providerId,
                fields: restored.join(','),
              });
            }

            const costMicroUsd = estimateCostMicroUsd(candidate.model, completion.usage);
            metrics.increment(METRIC.tokensTotal, featureLabels, completion.usage.totalTokens);
            metrics.increment(METRIC.costMicroUsdTotal, featureLabels, costMicroUsd);

            if (failedProviders.length > 0) {
              metrics.increment(METRIC.failoversTotal, {
                ...featureLabels,
                provider: candidate.providerId,
              });
            }

            return {
              output,
              promptId: rendered.promptId,
              promptVersion: rendered.promptVersion,
              promptHash: rendered.promptHash,
              inputDigest,
              outputDigest: sha256Hex(outputGuard.content),
              providerId: candidate.providerId,
              modelId: completion.modelId,
              attempts: totalAttempts,
              failedProviders,
              usage: completion.usage,
              costMicroUsd,
              inputGuardStatus: guarded.status,
              outputGuardStatus: outputGuard.status,
              redactedCategories: guarded.redactedCategories,
              governanceFlags: outputGuard.flags,
              factLockRestored: restored,
              providerLatencyMs,
            };
          } catch (error) {
            const aiError = toAIError(error);
            lastError = aiError;

            metrics.increment(METRIC.providerAttemptsTotal, {
              ...featureLabels,
              provider: candidate.providerId,
              outcome: 'error',
            });
            metrics.increment(METRIC.providerFailuresTotal, {
              provider: candidate.providerId,
              code: aiError.code,
            });

            if (aiError.code === 'OUTPUT_GUARD_BLOCKED') {
              metrics.increment(METRIC.governanceBlocksTotal, featureLabels);
              publish('ai.governance.output_blocked', context, {
                provider: candidate.providerId,
                attempt,
              }, aiError.code);
            }

            // Only a provider fault reflects on provider health. A governance
            // rejection means the provider answered and the content was
            // unacceptable — that must not take a healthy provider offline.
            if (PROVIDER_FAULTS.has(aiError.code)) {
              providers.recordFailure(candidate.providerId, aiError.diagnostics ?? aiError.message);
              if (circuit.recordFailure(candidate.providerId)) {
                metrics.increment(METRIC.circuitOpenTotal, { provider: candidate.providerId });
                publish('ai.provider.circuit_opened', context, {
                  provider: candidate.providerId,
                  code: aiError.code,
                });
                logger.error('ai.circuit.opened', {
                  provider: candidate.providerId,
                  code: aiError.code,
                  requestId: context.requestId,
                });
              }
            }

            publish('ai.provider.attempt_failed', context, {
              provider: candidate.providerId,
              attempt,
              retryable: aiError.retryable,
            }, aiError.code);

            logger.warn('ai.provider.attempt_failed', {
              requestId: context.requestId,
              correlationId: context.correlationId,
              feature: descriptor.featureId,
              provider: candidate.providerId,
              attempt,
              code: aiError.code,
              diagnostics: aiError.diagnostics,
            });

            if (!shouldRetrySameProvider(aiError, attempt, descriptor.limits.maxAttempts)) break;
          }
        }

        if (providerSucceeded) break;
        failedProviders.push(candidate.providerId);
        if (lastError && !shouldFailover(lastError)) throw lastError;
      }

      throw (
        lastError ??
        toAIError(new Error('No AI provider attempt was made for an admitted request.'))
      );
    },
  };
}
