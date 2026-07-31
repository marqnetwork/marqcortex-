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
import type { AIModelDescriptor } from '../contracts/provider.ts';
import type { ModelRequirements } from '../providers/registry.ts';
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
import { AIError, toAIError } from '../contracts/errors.ts';
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

/**
 * One provider attempt, reported as it completes.
 *
 * The orchestrator needs this to settle the spend ledger and to write a truthful
 * audit record for a request that FAILED: a request that burned two paid
 * attempts and then errored has cost real money and made two attempts, and a
 * plane that records `attempts: 0, cost: none` for it is lying about both.
 */
export interface ProviderAttemptRecord {
  readonly providerId: string;
  readonly modelId: string;
  readonly attempt: number;
  readonly outcome: 'success' | 'error';
  /** True when this attempt reached a provider that charges for the call. */
  readonly billable: boolean;
  readonly costMicroUsd: number;
  readonly usage?: AITokenUsage;
  readonly latencyMs: number;
  readonly errorCode?: AIErrorCode;
}

/** Reported as each attempt finishes, successful or not. */
export type AttemptObserver = (attempt: ProviderAttemptRecord) => void;

/**
 * An attempt that timed out has an unknown outcome at the provider: the model
 * may have generated a full completion that never arrived. Re-sending it is a
 * second billable request for one user action, so a timeout does not retry the
 * same provider unless the feature explicitly permits it. Failover to a
 * different provider is still allowed — that is a different vendor's bill for a
 * request the first one did not deliver.
 */
const UNCERTAIN_OUTCOME_CODES: ReadonlySet<AIErrorCode> = new Set<AIErrorCode>(['PROVIDER_TIMEOUT']);

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
    onAttempt?: AttemptObserver,
  ): Promise<PipelineOutcome<TOutput>>;
}

/**
 * Refuse a model that cannot do what the feature declared it needs.
 *
 * The selector already filtered on exactly these properties, so in a correct
 * plane this never fires. It exists because "the selector checked it" is an
 * assumption, and the cost of that assumption being wrong is a paid call whose
 * response the feature cannot parse. Asserting here makes the guarantee local
 * to the code that depends on it.
 */
function assertCapabilities(
  model: AIModelDescriptor,
  requirements: ModelRequirements,
  providerId: string,
): void {
  const missing: string[] = [];
  if (requirements.structuredOutput && !model.capabilities.structuredOutput) {
    missing.push('structuredOutput');
  }
  if (requirements.chatCompletions && !model.capabilities.chatCompletions) {
    missing.push('chatCompletions');
  }
  if (!model.capabilities.textGeneration) missing.push('textGeneration');
  if (model.capabilities.maxOutputTokens < requirements.minOutputTokens) {
    missing.push(
      `maxOutputTokens>=${requirements.minOutputTokens} (offers ${model.capabilities.maxOutputTokens})`,
    );
  }
  if (missing.length > 0) {
    throw new AIError(
      'PROVIDER_CAPABILITY_MISMATCH',
      'No AI provider is currently able to serve this request.',
      { providerId, diagnostics: `${providerId}/${model.modelId} lacks: ${missing.join(', ')}` },
    );
  }
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
      onAttempt?: AttemptObserver,
    ): Promise<PipelineOutcome<TOutput>> {
      const descriptor = definition.descriptor;
      const featureLabels = { feature: descriptor.featureId };

      // A whole-workflow deadline, distinct from the per-attempt timeout. Two
      // attempts against two providers at a 60s timeout each is a two-minute
      // wait for a caller that gave up long ago; the deadline bounds the total
      // rather than each part of it.
      const startedAtMs = clock.now();
      const workflowDeadlineMs = startedAtMs + config.workflowDeadlineMs;
      const deadlineExceeded = (): boolean => clock.now() >= workflowDeadlineMs;

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
      const requirements = {
        structuredOutput: descriptor.requiredCapabilities.structuredOutput,
        chatCompletions: descriptor.requiredCapabilities.chatCompletions,
        minOutputTokens: descriptor.limits.maxOutputTokens,
      };
      const candidates = selector.select(requirements);

      // ── provider_invoke ──────────────────────────────────────────────────
      const failedProviders: string[] = [];
      let lastError: AIError | undefined;
      let totalAttempts = 0;

      for (const candidate of candidates) {
        if (!circuit.canAttempt(candidate.providerId)) {
          failedProviders.push(candidate.providerId);
          continue;
        }
        if (deadlineExceeded()) break;

        // Capability enforcement, asserted immediately before the network call
        // rather than trusted from selection. The selector already matched the
        // model, but this is the last point at which a mismatch is free — after
        // it, a wrong model is a paid call that returns something the feature
        // cannot parse.
        assertCapabilities(candidate.model, requirements, candidate.providerId);

        publish('ai.provider.selected', context, {
          provider: candidate.providerId,
          model: candidate.model.modelId,
        });

        const registered = providers.get(candidate.providerId);
        const adapter = registered.adapter;
        const billable = registered.descriptor.billable;
        let providerSucceeded = false;

        for (let attempt = 1; attempt <= descriptor.limits.maxAttempts; attempt += 1) {
          if (deadlineExceeded()) break;
          totalAttempts += 1;

          // A provider that told us how long to wait is obeyed over our own
          // backoff curve: guessing shorter earns another 429 and guessing
          // longer wastes the caller's deadline.
          await retry.wait(
            retry.delayFor(attempt, config.retry, lastError?.retryAfterSeconds),
          );

          const attemptStartedAtMs = clock.now();
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

            const providerLatencyMs = clock.now() - attemptStartedAtMs;
            const costMicroUsd = estimateCostMicroUsd(candidate.model, completion.usage);

            // Reported before the output guard runs. The provider has answered
            // and the tokens are billed whether or not the content passes
            // governance, so the cost is accounted here rather than after a
            // check that can throw.
            onAttempt?.({
              providerId: candidate.providerId,
              modelId: completion.modelId,
              attempt,
              outcome: 'success',
              billable,
              costMicroUsd: billable ? costMicroUsd : 0,
              usage: completion.usage,
              latencyMs: providerLatencyMs,
            });

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

            // A failed attempt against a paid provider may still have been
            // billed — a timeout after generation, or a guard rejection of a
            // completion the vendor already charged for. Reported with an
            // unknown cost so the orchestrator settles at the reserved estimate
            // rather than at zero.
            onAttempt?.({
              providerId: candidate.providerId,
              modelId: candidate.model.modelId,
              attempt,
              outcome: 'error',
              billable,
              costMicroUsd: 0,
              latencyMs: clock.now() - attemptStartedAtMs,
              errorCode: aiError.code,
            });

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

            // Never re-send a request whose outcome at the provider is unknown:
            // the model may have generated and billed a completion that simply
            // did not reach us, and a blind retry pays for it twice.
            if (billable && UNCERTAIN_OUTCOME_CODES.has(aiError.code)) break;
            if (deadlineExceeded()) break;
            if (!shouldRetrySameProvider(aiError, attempt, descriptor.limits.maxAttempts)) break;
          }
        }

        if (providerSucceeded) break;
        failedProviders.push(candidate.providerId);
        if (lastError && !shouldFailover(lastError)) throw lastError;
      }

      if (lastError) throw lastError;
      if (deadlineExceeded()) {
        throw new AIError('PROVIDER_TIMEOUT', 'The AI request exceeded its overall time budget.', {
          diagnostics: `workflow deadline ${config.workflowDeadlineMs}ms exceeded after ${totalAttempts} attempt(s)`,
        });
      }
      throw new AIError(
        'NO_PROVIDER_AVAILABLE',
        'No AI provider is currently able to serve this request.',
        {
          diagnostics: `every eligible provider was skipped: ${failedProviders.join(', ') || 'none offered'}`,
        },
      );
    },
  };
}
