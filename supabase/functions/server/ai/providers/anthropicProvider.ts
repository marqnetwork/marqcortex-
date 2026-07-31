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
 */

import type {
  AIProviderAdapter,
  AIProviderCompletion,
  AIProviderDescriptor,
  AIProviderInvocation,
} from '../contracts/provider.ts';
import type { EnvSource } from '../runtime/env.ts';
import { AIError } from '../contracts/errors.ts';
import type { FetchLike } from './openaiProvider.ts';

export interface AnthropicProviderOptions {
  readonly env: EnvSource;
  readonly fetchImpl?: FetchLike;
  readonly apiBase?: string;
}

const API_VERSION = '2023-06-01';

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
  {
    modelId: 'claude-sonnet-4-5-20250929',
    providerId: 'anthropic',
    capabilities: {
      textGeneration: true,
      structuredOutput: true,
      chatCompletions: true,
      maxOutputTokens: 64_000,
      maxContextTokens: 200_000,
      zeroDataRetention: true,
    },
    promptMicroUsdPer1k: 3_000,
    completionMicroUsdPer1k: 15_000,
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
  };

  return {
    descriptor,

    hasCredentials() {
      const key = options.env.get('ANTHROPIC_API_KEY');
      return typeof key === 'string' && key.trim() !== '';
    },

    async invoke(invocation: AIProviderInvocation): Promise<AIProviderCompletion> {
      const apiKey = options.env.get('ANTHROPIC_API_KEY')?.trim();
      if (!apiKey) {
        throw new AIError('PROVIDER_AUTH_FAILED', 'The AI provider is not configured.', {
          providerId: 'anthropic',
          diagnostics: 'ANTHROPIC_API_KEY is not set',
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
