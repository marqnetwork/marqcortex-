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

import type { AIErrorCode } from '../contracts/errors.ts';
import type {
  AIGenerationRequest,
  AIMessage,
  AIRequestContext,
  AITokenUsage,
} from '../contracts/request.ts';
import type { AIFeatureDescriptor } from '../contracts/policy.ts';
import type { AIModelDescriptor } from '../contracts/provider.ts';
import type { AICredentialSourceCategory } from '../providers/credentials/contracts.ts';
import type { ExecutionFundingLatch } from '../providers/credentials/executionFunding.ts';
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
import type { RoutingDecision, RoutingOutcome } from '../routing/contracts/routing.ts';
import { reconcileRouting } from '../routing/engine/economics.ts';
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
  /**
   * WHICH credential authorised this attempt (AI-01 Batch 4D).
   *
   * Reported by the adapter, carried here unchanged. It matters most on the
   * attempts nobody looks at until an invoice arrives: a request that failed
   * over from a customer's own key to MARQ's produces two attempts with two
   * different categories, and a settlement that recorded only the last one
   * would attribute both to whoever paid for the second.
   *
   * Absent on a failed attempt, where no credential was successfully resolved
   * or the provider refused before answering.
   */
  readonly credentialSource?: AICredentialSourceCategory;
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

/**
 * Bytes of declared input per prompt token, for the routing projection.
 *
 * The SAME ratio `policy/spendGuard.ts` sizes a reservation with, and stated
 * here for the same reason it is stated there: it sizes a projection and never
 * bills anything. Billing always uses the provider's reported usage. Two
 * different ratios would put the routing premium and the reservation on
 * different bases and make them impossible to reconcile.
 */
const BYTES_PER_PROMPT_TOKEN = 4;

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
  /**
   * Where routing decisions and their reconciled outcomes are recorded
   * (AI-01 Batch 4F).
   *
   * Optional. A pipeline without one routes identically and simply reports
   * nothing — the recorder is an operational view, never a participant in the
   * decision, and a control plane assembled without it must still execute.
   */
  readonly routing?: RoutingRecorder;
}

/** The routing ledger, as the pipeline needs it. See `routing/routingLedger.ts`. */
export interface RoutingRecorder {
  recordDecision(decision: RoutingDecision, organizationId: string): void;
  recordOutcome(outcome: RoutingOutcome): void;
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
  /** The credential category the ANSWERING attempt executed on (Batch 4D). */
  readonly credentialSource: AICredentialSourceCategory;
  /** The routing decision this execution was planned against (Batch 4F). */
  readonly routing: RoutingDecision;
  /** Attempts against a provider that charges. Bounded by the routed budget. */
  readonly billableAttempts: number;
}

export interface ExecutionPipeline {
  run<TInput, TOutput>(
    context: AIRequestContext,
    definition: AIFeatureDefinition<TInput, TOutput>,
    input: TInput,
    onAttempt?: AttemptObserver,
    /**
     * Whose credentials this execution may reach (AI-01 Batch 4D remediation).
     *
     * Passed in rather than derived here, and carried onto every attempt, so
     * the constraint is a property of the REQUEST and not of whichever provider
     * the loop below happens to be on. Deriving it per provider is the
     * certified defect: an organization with `tenant_only` on one vendor has no
     * row for the next one, so the failover read an absent policy as
     * `platform` and reached MARQ's credential.
     *
     * Omitted, the execution is unconstrained — the Batch 4C behaviour.
     */
    funding?: ExecutionFundingLatch,
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
  const routingRecorder = deps.routing;

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
      funding?: ExecutionFundingLatch,
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
      // ── ROUTING (AI-01 Batch 4F) ─────────────────────────────────────────
      //
      // `route` runs the SAME eligibility pass `select` always did and then
      // orders its answer. The decision it returns carries the economics that
      // justified the order and the request's billable attempt budget, both of
      // which are enforced below rather than merely reported.
      const workload = {
        featureId: descriptor.featureId,
        promptTokens: Math.ceil(descriptor.limits.maxInputBytes / BYTES_PER_PROMPT_TOKEN),
        completionTokens: descriptor.limits.maxOutputTokens,
        maxAttempts: descriptor.limits.maxAttempts,
      };
      const { decision, candidates } = selector.route(requirements, workload);
      routingRecorder?.recordDecision(decision, context.organization.organizationId);
      const chosen = decision.order[0];
      if (chosen) {
        metrics.increment(METRIC.routingDecisionsTotal, {
          ...featureLabels,
          strategy: decision.strategy,
          provider: chosen.providerId,
        });
        if (decision.premiumMicroUsd > 0) {
          metrics.increment(
            METRIC.routingPremiumMicroUsdTotal,
            { ...featureLabels, strategy: decision.strategy },
            decision.premiumMicroUsd,
          );
        }
        publish('ai.routing.decided', context, {
          strategy: decision.strategy,
          provider: chosen.providerId,
          model: chosen.modelId,
          projectedMicroUsd: chosen.projectedMicroUsd,
          premiumMicroUsd: decision.premiumMicroUsd,
          plannedProviders: decision.order.length,
          billableAttemptBudget: decision.billableAttemptBudget,
        });
      }

      // ── provider_invoke ──────────────────────────────────────────────────
      const failedProviders: string[] = [];
      let lastError: AIError | undefined;
      let totalAttempts = 0;
      /**
       * Attempts made against a provider that CHARGES, across the whole request.
       *
       * ── WHY THIS IS COUNTED PER REQUEST AND NOT PER PROVIDER ──────────────
       *
       * The spend guard reserves `worst-case model x maxAttempts` for one
       * request. This loop used to grant a fresh allowance of `maxAttempts` to
       * every failover candidate, so a request with a two-attempt allowance and
       * three eligible providers could make six paid attempts against a hold
       * that covered two. Nobody decided the ceiling should be crossed; it was
       * crossed by an allowance counted in one unit and reserved in another.
       *
       * Non-billable attempts do not spend the budget. The mock costs nothing,
       * is still bounded by the routed failover breadth and the workflow
       * deadline, and remains the last resort it was designed to be — so a
       * total vendor outage still degrades to something rather than nothing.
       */
      let billableAttempts = 0;
      let budgetExhausted = false;
      const skippedForBudget: string[] = [];

      /** Report what the request actually did, against what was planned. */
      function settleRouting(
        outcome: 'success' | 'failure',
        served?: { providerId: string; modelId: string },
        realizedMicroUsd = 0,
      ): void {
        routingRecorder?.recordOutcome(
          reconcileRouting(decision, {
            organizationId: context.organization.organizationId,
            servedProviderId: served?.providerId,
            servedModelId: served?.modelId,
            failedProviders,
            attempts: totalAttempts,
            billableAttempts,
            realizedMicroUsd,
            outcome,
            budgetExhausted,
            occurredAt: clock.isoNow(),
          }),
        );
      }

      try {
      for (const candidate of candidates) {
        if (!circuit.canAttempt(candidate.providerId)) {
          failedProviders.push(candidate.providerId);
          continue;
        }
        if (deadlineExceeded()) break;

        const registered = providers.get(candidate.providerId);
        const adapter = registered.adapter;
        const billable = registered.descriptor.billable;

        // THE BUDGET, APPLIED BEFORE THE PROVIDER IS EVEN ANNOUNCED. A
        // candidate skipped here has not failed and must not be recorded as
        // having failed — an operator reading `failedProviders` would otherwise
        // go looking for an outage at a vendor that was never dialled.
        if (billable && billableAttempts >= decision.billableAttemptBudget) {
          budgetExhausted = true;
          skippedForBudget.push(candidate.providerId);
          continue;
        }

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

        let providerSucceeded = false;

        for (let attempt = 1; attempt <= descriptor.limits.maxAttempts; attempt += 1) {
          if (deadlineExceeded()) break;
          if (billable && billableAttempts >= decision.billableAttemptBudget) {
            budgetExhausted = true;
            break;
          }
          totalAttempts += 1;
          if (billable) billableAttempts += 1;

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
                  // ── THE TENANT (AI-01 Batch 4D) ────────────────────────
                  //
                  // THE ONE PLACE a tenant enters the credential layer, and it
                  // is built from `context.organization` — which the AI Guard
                  // resolved from an authenticated membership before this
                  // pipeline was reached. There is no path from a request body
                  // to this object: `resolveOrganization` refuses a hint the
                  // subject does not hold, and `membershipVerified` travels
                  // with the answer so the resolver can tell a verified tenant
                  // from the single-tenant default fallback.
                  //
                  // The adapter passes it to the resolver and does nothing else
                  // with it. It never reaches a vendor.
                  //
                  // `funding` is the SAME latch object on every attempt of
                  // this request — every retry, every failover candidate,
                  // every model fallback — which is what makes a customer's
                  // "our own credentials only" survive leaving the provider
                  // they declared it on.
                  tenant: {
                    organizationId: context.organization.organizationId,
                    membershipVerified: context.organization.membershipVerified,
                    funding,
                  },
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
              credentialSource: completion.credentialSource,
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

            settleRouting(
              'success',
              { providerId: candidate.providerId, modelId: completion.modelId },
              billable ? costMicroUsd : 0,
            );

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
              // The ANSWERING attempt's category. A request that failed over
              // reports the credential that actually produced the answer, which
              // is the one whose vendor account was charged for it.
              credentialSource: completion.credentialSource ?? 'none',
              routing: decision,
              billableAttempts,
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

      if (budgetExhausted) {
        // Said out loud, on both the metric and the event stream. A request
        // that stopped failing over because it had spent its allowance looks
        // exactly like one that ran out of providers, and an operator tuning
        // failover breadth or a feature's attempt allowance needs to know
        // which of the two happened.
        metrics.increment(METRIC.routingBudgetExhaustedTotal, {
          ...featureLabels,
          strategy: decision.strategy,
        });
        publish('ai.routing.budget_exhausted', context, {
          strategy: decision.strategy,
          billableAttempts,
          budget: decision.billableAttemptBudget,
          skipped: skippedForBudget.join(',') || '(none)',
        });
        logger.warn('ai.routing.budget_exhausted', {
          requestId: context.requestId,
          correlationId: context.correlationId,
          feature: descriptor.featureId,
          billableAttempts,
          budget: decision.billableAttemptBudget,
          skipped: skippedForBudget.join(','),
        });
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
          diagnostics:
            `every eligible provider was skipped: ${failedProviders.join(', ') || 'none offered'}` +
            (skippedForBudget.length > 0
              ? `; not attempted on the request's billable allowance of ` +
                `${decision.billableAttemptBudget}: ${skippedForBudget.join(', ')}`
              : ''),
        },
      );
      } catch (error) {
        // Recorded on the way out rather than at each throw site. A routing view
        // that only ever saw successful requests would report the strategy as
        // free at exactly the moment failover is costing the most.
        settleRouting('failure');
        throw error;
      }
    },
  };
}
