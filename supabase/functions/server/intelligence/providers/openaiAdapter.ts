import { readEnv } from '../env.ts';
import type {
  AIProviderAdapter,
  ModelCapabilities,
  NormalizedAIResponse,
  ProviderInvokeContext,
  ProviderUsage,
} from '../contracts.ts';
import { createProviderError, throwProviderError } from '../errors.ts';

export type FetchFn = typeof fetch;

let fetchImpl: FetchFn = fetch;

export function setFetchImplementationForTests(impl: FetchFn): void {
  fetchImpl = impl;
}

export function resetFetchImplementation(): void {
  fetchImpl = fetch;
}

function parseUsage(data: Record<string, unknown>): ProviderUsage | undefined {
  const usage = data.usage as Record<string, number> | undefined;
  if (!usage) return undefined;
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

export function createOpenAIAdapter(apiBase = 'https://api.openai.com/v1'): AIProviderAdapter {
  const capabilities: ModelCapabilities = {
    textGeneration: true,
    structuredOutput: true,
    chatCompletions: true,
    maxOutputTokens: 4096,
  };

  return {
    providerId: 'openai',
    displayName: 'OpenAI HTTP Adapter',
    capabilities,
    checkCredentials: () => Boolean(readEnv('OPENAI_API_KEY')),
    async generate(ctx: ProviderInvokeContext): Promise<NormalizedAIResponse> {
      const apiKey = readEnv('OPENAI_API_KEY');
      const requestId = ctx.request.requestId;
      if (!apiKey) {
        throwProviderError(
          createProviderError(
            'MISSING_CREDENTIALS',
            'OPENAI_API_KEY is not configured.',
            requestId,
            { provider: 'openai', retryable: false },
          ),
        );
      }

      const body: Record<string, unknown> = {
        model: ctx.resolvedModelId,
        messages: ctx.request.messages,
        temperature: ctx.request.temperature,
        max_tokens: ctx.request.maxTokens,
      };
      if (ctx.request.responseFormat === 'json_object') {
        body.response_format = { type: 'json_object' };
      }

      const response = await fetchImpl(`${apiBase}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: ctx.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        const code = response.status === 429
          ? 'RATE_LIMITED'
          : response.status >= 500
          ? 'PROVIDER_UNAVAILABLE'
          : 'UNKNOWN';
        throwProviderError(
          createProviderError(
            code,
            `OpenAI API error ${response.status}: ${errText}`,
            requestId,
            { provider: 'openai', retryable: code !== 'UNKNOWN', diagnostics: errText.slice(0, 500) },
          ),
        );
      }

      const data = await response.json() as Record<string, unknown>;
      const choices = data.choices as Array<{ message?: { content?: string }; finish_reason?: string }> | undefined;
      const content = choices?.[0]?.message?.content;
      if (!content) {
        throwProviderError(
          createProviderError('INVALID_OUTPUT', 'Empty response from OpenAI', requestId, {
            provider: 'openai',
          }),
        );
      }

      return {
        requestId,
        content: String(content),
        model: String(data.model ?? ctx.resolvedModelId),
        provider: 'openai',
        usage: parseUsage(data),
        finishReason: choices?.[0]?.finish_reason,
        generatedAt: new Date().toISOString(),
        attempt: ctx.attempt,
      };
    },
  };
}
