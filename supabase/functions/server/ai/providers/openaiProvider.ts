/**
 * OpenAI provider adapter.
 *
 * The only file in the platform that knows the OpenAI chat completions wire
 * format exists. It performs exactly one attempt and translates vendor failures
 * into the platform error taxonomy. Retry, timeout, circuit breaking, telemetry
 * and governance are the control plane's job and are applied identically to
 * every provider.
 *
 * `fetch` is injected so the adapter is fully testable without network access
 * and without a module-level mutable override.
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

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface OpenAIProviderOptions {
  readonly env: EnvSource;
  readonly fetchImpl?: FetchLike;
  readonly apiBase?: string;
  /**
   * The provider-neutral credential resolver (AI-01 Batch 4C).
   *
   * OPTIONAL, and the default is the point: with none supplied the adapter
   * builds an environment-only resolver over the same `env` it was already
   * given, so its behaviour is byte-for-byte what it was before Batch 4C.
   * Production injects the layered resolver; every existing test keeps working
   * unchanged.
   */
  readonly credentials?: ProviderCredentialResolver;
  readonly clock?: Clock;
}

/**
 * This adapter's credential profile — the single place its environment
 * contract is written down (AI-01 Batch 4C).
 *
 * EXPORTED, and exported for a boundary reason rather than a convenience one.
 * The credential resolver production assembles needs a profile per provider,
 * and the bootstrap that assembles it lives OUTSIDE `ai/providers/` — where the
 * boundary scan forbids a provider credential variable from appearing. Naming
 * it here and importing the profile there keeps the vendor's variable name
 * inside the provider boundary, where every other vendor-specific fact lives,
 * and gives the adapter and the resolver ONE definition rather than two that
 * can drift.
 */
export const OPENAI_CREDENTIAL_PROFILE: CredentialProviderProfile = {
  providerId: 'openai',
  required: true,
  manageable: true,
  environmentVariable: 'OPENAI_API_KEY',
};

const CREDENTIAL_ENV_VAR = OPENAI_CREDENTIAL_PROFILE.environmentVariable!;

/**
 * Declared models with published pricing in micro-USD per 1,000 tokens.
 * Pricing lives beside the capability declaration because both are inputs to
 * selection, and a second copy of a price table is how a budget engine drifts.
 */
const MODELS: AIProviderDescriptor['models'] = [
  {
    modelId: 'gpt-4o-mini',
    providerId: 'openai',
    capabilities: {
      textGeneration: true,
      structuredOutput: true,
      chatCompletions: true,
      maxOutputTokens: 16_384,
      maxContextTokens: 128_000,
      zeroDataRetention: false,
    },
    promptMicroUsdPer1k: 150,
    completionMicroUsdPer1k: 600,
  },
  {
    modelId: 'gpt-4o',
    providerId: 'openai',
    capabilities: {
      textGeneration: true,
      structuredOutput: true,
      chatCompletions: true,
      maxOutputTokens: 16_384,
      maxContextTokens: 128_000,
      zeroDataRetention: false,
    },
    promptMicroUsdPer1k: 2_500,
    completionMicroUsdPer1k: 10_000,
  },
];

export function createOpenAIProvider(options: OpenAIProviderOptions): AIProviderAdapter {
  const apiBase = options.apiBase ?? 'https://api.openai.com/v1';
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));

  const descriptor: AIProviderDescriptor = {
    providerId: 'openai',
    displayName: 'OpenAI',
    priority: 10,
    models: MODELS,
    productionReady: true,
    // Reaches the paid OpenAI API. Refused entirely while real requests are off.
    billable: true,
    credential: {
      required: true,
      manageable: true,
      environmentVariable: CREDENTIAL_ENV_VAR,
      credentialFormatHint: 'OpenAI secret API key',
    },
  };

  const credentials =
    options.credentials ??
    createEnvironmentCredentialResolver(
      OPENAI_CREDENTIAL_PROFILE,
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
      // Resolved HERE, once, per attempt. The adapter does not know whether the
      // secret came from a managed record or from the deployment environment,
      // and it never holds one for longer than this call.
      const resolved = await credentials.resolve(descriptor.providerId);
      const apiKey = resolved?.secret.trim();
      if (!apiKey) {
        throw new AIError('PROVIDER_AUTH_FAILED', 'The AI provider is not configured.', {
          providerId: 'openai',
          diagnostics: 'no managed or environment credential resolved for openai',
        });
      }

      const body: Record<string, unknown> = {
        model: invocation.modelId,
        messages: invocation.generation.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        temperature: invocation.generation.temperature,
        max_tokens: invocation.generation.maxOutputTokens,
      };
      if (invocation.generation.responseFormat === 'json_object') {
        body.response_format = { type: 'json_object' };
      }

      let response: Response;
      try {
        response = await fetchImpl(`${apiBase}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            // Lets OpenAI-side support correlate an incident with our trace
            // without exposing anything about the tenant.
            'X-Request-Id': invocation.requestId,
          },
          body: JSON.stringify(body),
          signal: invocation.signal,
        });
      } catch (error) {
        throw new AIError('PROVIDER_UNAVAILABLE', 'The AI provider could not be reached.', {
          providerId: 'openai',
          diagnostics: error instanceof Error ? error.message : String(error),
          cause: error,
        });
      }

      if (!response.ok) {
        throw await translateHttpFailure(response);
      }

      let payload: OpenAIChatResponse;
      try {
        payload = (await response.json()) as OpenAIChatResponse;
      } catch (error) {
        throw new AIError('INVALID_MODEL_OUTPUT', 'The AI provider returned an unreadable response.', {
          providerId: 'openai',
          diagnostics: error instanceof Error ? error.message : String(error),
        });
      }

      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim() === '') {
        throw new AIError('INVALID_MODEL_OUTPUT', 'The AI provider returned an empty response.', {
          providerId: 'openai',
          diagnostics: `finish_reason=${payload.choices?.[0]?.finish_reason ?? 'unknown'}`,
        });
      }

      return {
        content,
        modelId: payload.model ?? invocation.modelId,
        usage: {
          promptTokens: payload.usage?.prompt_tokens ?? 0,
          completionTokens: payload.usage?.completion_tokens ?? 0,
          totalTokens:
            payload.usage?.total_tokens ??
            (payload.usage?.prompt_tokens ?? 0) + (payload.usage?.completion_tokens ?? 0),
        },
        finishReason: payload.choices?.[0]?.finish_reason,
      };
    },
  };
}

interface OpenAIChatResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/**
 * Map an HTTP failure onto the taxonomy. The vendor's error text goes to
 * diagnostics only: OpenAI echoes request content in some 400 bodies, and that
 * content may include a tenant's business data.
 */
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
      providerId: 'openai',
      diagnostics,
    });
  }
  if (response.status === 429) {
    const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
    return new AIError('PROVIDER_RATE_LIMITED', 'The AI provider is rate limiting this platform.', {
      providerId: 'openai',
      diagnostics,
      retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
    });
  }
  if (response.status >= 500) {
    return new AIError('PROVIDER_UNAVAILABLE', 'The AI provider is temporarily unavailable.', {
      providerId: 'openai',
      diagnostics,
    });
  }
  return new AIError('INVALID_MODEL_OUTPUT', 'The AI provider rejected the request.', {
    providerId: 'openai',
    diagnostics,
    retryable: false,
  });
}
