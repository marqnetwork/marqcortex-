/**
 * Anthropic provider adapter.
 *
 * Implemented in Batch 1 rather than deferred, for one reason: an abstraction
 * that has only ever had a single real implementation is an unproven
 * abstraction. Building the second provider is what proves the control plane's
 * contracts are genuinely provider-neutral — and it surfaced two places where
 * they were not, both fixed before this file was finished:
 *
 *   1. Anthropic takes the system prompt as a top-level `system` parameter, not
 *      as a message with `role: "system"`. A contract that assumed OpenAI's
 *      message array would have forced vendor knowledge upward. The neutral
 *      contract carries messages; each adapter maps them to its own shape.
 *
 *   2. Anthropic has no `response_format: json_object`. Structured output is
 *      obtained by prefilling an assistant turn with `{`, which the adapter must
 *      then restore on the way out. That is adapter-local knowledge, and the
 *      control plane's JSON parsing is unchanged by it.
 *
 * The provider is registered whenever `ANTHROPIC_API_KEY` is present. With no
 * key it stays registered but reports no credentials, so the selector skips it —
 * exactly the behaviour an operator needs to turn a provider on without a
 * deploy.
 *
 * AI-01 Batch 4B certifies this adapter for MARQ-funded production spending
 * alongside OpenAI. Nothing about the execution path changed to make that true,
 * which is the point: Anthropic reaches a model through the same guard, policy
 * engine, spend reservation, selector, retry curve, circuit breaker, output
 * guard and audit writer as every other provider. What 4B added is the evidence
 * — `__tests__/anthropicGovernedPath.test.ts` drives that whole sequence — and
 * the narrowed catalogue below.
 */

import type {
  AIProviderAdapter,
  AIProviderCompletion,
  AIProviderDescriptor,
  AIProviderInvocation,
} from '../contracts/provider.ts';
import type { EnvSource } from '../runtime/env.ts';
import type { Clock } from '../runtime/clock.ts';
import type { ProviderCredentialResolver } from './credentials/contracts.ts';
import type { CredentialProviderProfile } from './credentials/resolver.ts';
import { createEnvironmentCredentialResolver } from './credentials/resolver.ts';
import { systemClock } from '../runtime/clock.ts';
import { AIError } from '../contracts/errors.ts';
import type { FetchLike } from './openaiProvider.ts';

export interface AnthropicProviderOptions {
  readonly env: EnvSource;
  readonly fetchImpl?: FetchLike;
  readonly apiBase?: string;
  /**
   * The provider-neutral credential resolver (AI-01 Batch 4C). Absent, the
   * adapter builds an environment-only resolver over its own `env` and behaves
   * exactly as it did before Batch 4C.
   */
  readonly credentials?: ProviderCredentialResolver;
  readonly clock?: Clock;
}

/**
 * This adapter's credential profile. See `OPENAI_CREDENTIAL_PROFILE` for why it
 * is exported: the vendor's environment variable name stays inside the provider
 * boundary, and the adapter and the production resolver share one definition.
 */
export const ANTHROPIC_CREDENTIAL_PROFILE: CredentialProviderProfile = {
  providerId: 'anthropic',
  required: true,
  manageable: true,
  environmentVariable: 'ANTHROPIC_API_KEY',
};

const CREDENTIAL_ENV_VAR = ANTHROPIC_CREDENTIAL_PROFILE.environmentVariable!;

const API_VERSION = '2023-06-01';

/**
 * The certified Anthropic catalogue for MARQ Cortex.
 *
 * ONE MODEL, DELIBERATELY (AI-01 Batch 4B). Batch 1 declared Haiku 4.5 and
 * Sonnet 4.5 together, on the reasoning that an adapter should offer what the
 * vendor offers. Certifying a provider for MARQ-funded production spending
 * changes that calculus in two ways, and both point the same direction:
 *
 *   1. THE CATALOGUE IS THE ALLOW LIST. Nothing above this file names a model;
 *      the selector picks the cheapest model that meets a feature's declared
 *      requirements, and an administrator may only NARROW what is declared here
 *      (`ModelPolicy`, `registry.ts`). So the set declared here IS the set this
 *      platform is certified to spend money on. A model nobody has certified
 *      against this contract does not belong in it.
 *
 *   2. AN EXPENSIVE DECLARED MODEL RAISES EVERY REQUEST'S HOLD. The spend guard
 *      reserves the worst case a feature can cost across the FULL declared
 *      catalogue of every billable provider — not the permitted subset, and not
 *      the model that will actually be selected (`spendGuard.ts`). Declaring
 *      Sonnet 4.5 at 3,000/15,000 µUSD per 1k therefore raised the pessimistic
 *      hold on every interactive request from ~106,000 to ~134,000 µUSD, for a
 *      model the selector would never choose. Against the MARQ-funded lifetime
 *      ceiling that is headroom spent on nothing.
 *
 * Every Cortex feature asks for at most 2,500 completion tokens
 * (`HEAVY_LIMITS`), which Haiku 4.5 covers with headroom. Certifying a larger
 * Anthropic model is a deliberate decision with a measurable cost — it belongs
 * in the batch that needs it, with the reservation arithmetic re-checked, not
 * in a catalogue that grew by default.
 *
 * The model id is the DATED SNAPSHOT rather than the `claude-haiku-4-5` alias.
 * An alias may be repointed at a new model version by the vendor; a snapshot
 * may not. An audit record that says which model produced a completion has to
 * stay true a year later, and a certification that can be moved underneath the
 * platform is not a certification.
 *
 * Rates are the published Anthropic list price, in micro-USD per 1,000 tokens:
 * $1.00 / MTok input and $5.00 / MTok output.
 *
 * `maxOutputTokens` is stated conservatively. It is read as a FLOOR — the
 * selector refuses a model whose declared ceiling is below what a feature asks
 * for — so understating it can only remove this provider from a request it
 * could have served, never send an oversized one.
 */
const MODELS: AIProviderDescriptor['models'] = [
  {
    modelId: 'claude-haiku-4-5-20251001',
    providerId: 'anthropic',
    capabilities: {
      textGeneration: true,
      structuredOutput: true,
      chatCompletions: true,
      maxOutputTokens: 8_192,
      maxContextTokens: 200_000,
      zeroDataRetention: true,
    },
    promptMicroUsdPer1k: 1_000,
    completionMicroUsdPer1k: 5_000,
  },
];

export function createAnthropicProvider(options: AnthropicProviderOptions): AIProviderAdapter {
  const apiBase = options.apiBase ?? 'https://api.anthropic.com/v1';
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));

  const descriptor: AIProviderDescriptor = {
    providerId: 'anthropic',
    displayName: 'Anthropic',
    priority: 20,
    models: MODELS,
    productionReady: true,
    // Reaches the paid Anthropic API. Refused entirely while real requests are off.
    billable: true,
    credential: {
      required: true,
      manageable: true,
      environmentVariable: CREDENTIAL_ENV_VAR,
      credentialFormatHint: 'Anthropic API key',
    },
  };

  const credentials =
    options.credentials ??
    createEnvironmentCredentialResolver(
      ANTHROPIC_CREDENTIAL_PROFILE,
      options.env,
      options.clock ?? systemClock,
    );

  return {
    descriptor,

    hasCredentials() {
      return credentials.describe(descriptor.providerId).configured;
    },

    credentialStatus() {
      const availability = credentials.describe(descriptor.providerId);
      return { source: availability.source, fingerprint: availability.fingerprint };
    },

    async invoke(invocation: AIProviderInvocation): Promise<AIProviderCompletion> {
      // One resolution per attempt, through the same provider-neutral port the
      // OpenAI adapter uses. There is deliberately no Anthropic-specific
      // credential pipeline — that is the Batch 4C guarantee.
      const resolved = await credentials.resolve(descriptor.providerId);
      const apiKey = resolved?.secret.trim();
      if (!apiKey) {
        throw new AIError('PROVIDER_AUTH_FAILED', 'The AI provider is not configured.', {
          providerId: 'anthropic',
          diagnostics: 'no managed or environment credential resolved for anthropic',
        });
      }

      const system = invocation.generation.messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n\n');

      const turns = invocation.generation.messages
        .filter((message) => message.role !== 'system')
        .map((message) => ({ role: message.role, content: message.content }));

      // Anthropic requires the conversation to start with a user turn.
      if (turns.length === 0 || turns[0].role !== 'user') {
        turns.unshift({ role: 'user', content: 'Proceed using the instructions above.' });
      }

      // No native JSON mode: prefill an assistant turn with the opening brace so
      // the model can only continue an object. The brace is restored below.
      const wantsJson = invocation.generation.responseFormat === 'json_object';
      if (wantsJson) turns.push({ role: 'assistant', content: '{' });

      const body: Record<string, unknown> = {
        model: invocation.modelId,
        max_tokens: invocation.generation.maxOutputTokens,
        temperature: invocation.generation.temperature,
        messages: turns,
      };
      if (system) body.system = system;

      let response: Response;
      try {
        response = await fetchImpl(`${apiBase}/messages`, {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': API_VERSION,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: invocation.signal,
        });
      } catch (error) {
        throw new AIError('PROVIDER_UNAVAILABLE', 'The AI provider could not be reached.', {
          providerId: 'anthropic',
          diagnostics: error instanceof Error ? error.message : String(error),
          cause: error,
        });
      }

      if (!response.ok) {
        throw await translateHttpFailure(response);
      }

      let payload: AnthropicMessageResponse;
      try {
        payload = (await response.json()) as AnthropicMessageResponse;
      } catch (error) {
        throw new AIError('INVALID_MODEL_OUTPUT', 'The AI provider returned an unreadable response.', {
          providerId: 'anthropic',
          diagnostics: error instanceof Error ? error.message : String(error),
        });
      }

      const text = (payload.content ?? [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('');

      if (text.trim() === '') {
        throw new AIError('INVALID_MODEL_OUTPUT', 'The AI provider returned an empty response.', {
          providerId: 'anthropic',
          diagnostics: `stop_reason=${payload.stop_reason ?? 'unknown'}`,
        });
      }

      return {
        // Restore the prefilled brace so the control plane's JSON parsing is
        // identical for every provider.
        content: wantsJson ? `{${text}` : text,
        modelId: payload.model ?? invocation.modelId,
        usage: {
          promptTokens: payload.usage?.input_tokens ?? 0,
          completionTokens: payload.usage?.output_tokens ?? 0,
          totalTokens: (payload.usage?.input_tokens ?? 0) + (payload.usage?.output_tokens ?? 0),
        },
        finishReason: payload.stop_reason,
      };
    },
  };
}

interface AnthropicMessageResponse {
  model?: string;
  stop_reason?: string;
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

async function translateHttpFailure(response: Response): Promise<AIError> {
  let detail = '';
  try {
    detail = (await response.text()).slice(0, 500);
  } catch {
    detail = '(response body unavailable)';
  }
  const diagnostics = `HTTP ${response.status}: ${detail}`;

  if (response.status === 401 || response.status === 403) {
    return new AIError('PROVIDER_AUTH_FAILED', 'The AI provider rejected the platform credential.', {
      providerId: 'anthropic',
      diagnostics,
    });
  }
  if (response.status === 429) {
    const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
    return new AIError('PROVIDER_RATE_LIMITED', 'The AI provider is rate limiting this platform.', {
      providerId: 'anthropic',
      diagnostics,
      retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
    });
  }
  if (response.status === 529 || response.status >= 500) {
    return new AIError('PROVIDER_UNAVAILABLE', 'The AI provider is temporarily unavailable.', {
      providerId: 'anthropic',
      diagnostics,
    });
  }
  return new AIError('INVALID_MODEL_OUTPUT', 'The AI provider rejected the request.', {
    providerId: 'anthropic',
    diagnostics,
    retryable: false,
  });
}
