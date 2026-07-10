import type { NormalizedAIRequest, NormalizedAIResponse } from './contracts.ts';
import { getIntelligenceConfig } from './config.ts';
import {
  createProviderError,
  IntelligenceGatewayError,
  normalizeUnknownError,
  throwProviderError,
} from './errors.ts';
import { resolveModelForFeature } from './modelRegistry.ts';
import { assertProviderAvailable } from './providerRegistry.ts';
import { buildTelemetryRecord, recordTelemetry } from './telemetry.ts';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateCapabilities(request: NormalizedAIRequest): void {
  if (request.responseFormat === 'json_object' && request.structuredOutput?.requiredFields?.length) {
    // validated after generation
  }
}

function validateOutput(request: NormalizedAIRequest, content: string): void {
  if (!content || !content.trim()) {
    throwProviderError(
      createProviderError('INVALID_OUTPUT', 'Provider returned empty content', request.requestId),
    );
  }
  if (request.responseFormat === 'json_object') {
    try {
      const parsed = JSON.parse(content);
      const required = request.structuredOutput?.requiredFields ?? [];
      for (const field of required) {
        if (!(field in (parsed as Record<string, unknown>))) {
          throwProviderError(
            createProviderError(
              'INVALID_OUTPUT',
              `Provider JSON missing required field: ${field}`,
              request.requestId,
            ),
          );
        }
      }
    } catch (err) {
      if (err instanceof IntelligenceGatewayError) throw err;
      throwProviderError(
        createProviderError(
          'INVALID_OUTPUT',
          `Provider response was not valid JSON: ${content.slice(0, 200)}`,
          request.requestId,
        ),
      );
    }
  }
}

export async function intelligenceGenerate(
  request: NormalizedAIRequest,
): Promise<NormalizedAIResponse> {
  const cfg = getIntelligenceConfig();
  const providerId = cfg.activeProviderId;
  const requestId = request.requestId || crypto.randomUUID();
  const normalizedRequest = { ...request, requestId };

  validateCapabilities(normalizedRequest);

  const modelConfig = resolveModelForFeature(normalizedRequest.feature, providerId);
  const adapter = assertProviderAvailable(providerId, requestId);

  const maxAttempts = cfg.retry.maxRetries + 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.timeout.timeoutMs);

    try {
      const response = await adapter.generate({
        request: {
          ...normalizedRequest,
          temperature: normalizedRequest.temperature ?? modelConfig.defaultTemperature,
          maxTokens: normalizedRequest.maxTokens ?? modelConfig.defaultMaxTokens,
        },
        resolvedModelId: modelConfig.modelId,
        providerId,
        attempt,
        signal: controller.signal,
      });

      validateOutput(normalizedRequest, response.content);

      recordTelemetry(
        buildTelemetryRecord({
          requestId,
          feature: normalizedRequest.feature,
          provider: response.provider,
          model: response.model,
          attempt,
          latencyMs: Date.now() - started,
          outcome: 'success',
          promptTokens: response.usage?.promptTokens,
          completionTokens: response.usage?.completionTokens,
          totalTokens: response.usage?.totalTokens,
        }),
      );

      return { ...response, requestId, attempt };
    } catch (err) {
      lastError = err;
      const normalized = normalizeUnknownError(err, requestId, providerId);
      recordTelemetry(
        buildTelemetryRecord({
          requestId,
          feature: normalizedRequest.feature,
          provider: providerId,
          model: modelConfig.modelId,
          attempt,
          latencyMs: Date.now() - started,
          outcome: 'error',
          errorCode: normalized.code,
        }),
      );
      if (!normalized.retryable || attempt >= maxAttempts) {
        throwProviderError(normalized);
      }
      await sleep(cfg.retry.retryDelayMs);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw normalizeUnknownError(lastError, requestId, providerId);
}

export function createIntelligenceRequest(
  partial: Omit<NormalizedAIRequest, 'requestId'> & { requestId?: string },
): NormalizedAIRequest {
  return {
    ...partial,
    requestId: partial.requestId ?? crypto.randomUUID(),
  };
}
