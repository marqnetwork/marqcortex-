import type {
  AIProviderAdapter,
  ModelCapabilities,
  NormalizedAIResponse,
  ProviderInvokeContext,
} from './contracts.ts';
import { createProviderError, throwProviderError } from '../errors.ts';

export type MockScenario =
  | 'success_text'
  | 'success_structured'
  | 'timeout'
  | 'unavailable'
  | 'invalid_json'
  | 'missing_fields'
  | 'empty_response'
  | 'capability_mismatch'
  | 'rate_limit'
  | 'disabled'
  | 'degraded';

function scenarioFromMetadata(ctx: ProviderInvokeContext): MockScenario {
  const scenario = ctx.request.metadata?.scenario as MockScenario | undefined;
  return scenario ?? 'success_text';
}

export function createMockProvider(): AIProviderAdapter {
  const capabilities: ModelCapabilities = {
    textGeneration: true,
    structuredOutput: true,
    chatCompletions: true,
    maxOutputTokens: 4096,
  };

  return {
    providerId: 'mock',
    displayName: 'Deterministic Mock Provider',
    capabilities,
    checkCredentials: () => true,
    async generate(ctx: ProviderInvokeContext): Promise<NormalizedAIResponse> {
      const scenario = scenarioFromMetadata(ctx);
      const requestId = ctx.request.requestId;

      if (scenario === 'disabled') {
        throwProviderError(
          createProviderError('PROVIDER_DISABLED', 'Mock provider disabled', requestId, {
            provider: 'mock',
          }),
        );
      }
      if (scenario === 'unavailable') {
        throwProviderError(
          createProviderError('PROVIDER_UNAVAILABLE', 'Mock provider unavailable', requestId, {
            provider: 'mock',
            retryable: true,
          }),
        );
      }
      if (scenario === 'rate_limit') {
        throwProviderError(
          createProviderError('RATE_LIMITED', 'Mock rate limit', requestId, {
            provider: 'mock',
            retryable: true,
          }),
        );
      }
      if (scenario === 'timeout') {
        throwProviderError(
          createProviderError('TIMEOUT', 'Mock timeout', requestId, {
            provider: 'mock',
            retryable: true,
          }),
        );
      }
      if (scenario === 'capability_mismatch') {
        throwProviderError(
          createProviderError('CAPABILITY_MISMATCH', 'Mock capability mismatch', requestId, {
            provider: 'mock',
          }),
        );
      }
      if (scenario === 'empty_response') {
        throwProviderError(
          createProviderError('INVALID_OUTPUT', 'Mock empty response', requestId, {
            provider: 'mock',
          }),
        );
      }

      let content: string;
      if (scenario === 'invalid_json') {
        content = 'not-json{{{';
      } else if (scenario === 'missing_fields') {
        content = JSON.stringify({ partial: true });
      } else if (scenario === 'success_structured' || ctx.request.responseFormat === 'json_object') {
        content = JSON.stringify({
          narrative: `Mock structured output for ${ctx.request.feature}`,
          proposed_content: { text: 'Mock revised content' },
          diff_summary: 'Mock diff summary',
          intent: 'rewrite_tone',
          targets: [],
          skipped: [],
          roi_recalc_required: false,
        });
      } else {
        content = `Mock narrative for ${ctx.request.feature} using profile ${ctx.request.modelProfile}. Math decides priority — this is explanation only.`;
      }

      return {
        requestId,
        content,
        model: ctx.resolvedModelId,
        provider: 'mock',
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        finishReason: 'stop',
        generatedAt: new Date().toISOString(),
        attempt: ctx.attempt,
      };
    },
  };
}
