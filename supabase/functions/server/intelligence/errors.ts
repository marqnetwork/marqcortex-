import type { ProviderError, ProviderErrorCode } from './contracts.ts';

export class IntelligenceGatewayError extends Error {
  readonly providerError: ProviderError;

  constructor(providerError: ProviderError) {
    super(providerError.message);
    this.name = 'IntelligenceGatewayError';
    this.providerError = providerError;
  }
}

export function createProviderError(
  code: ProviderErrorCode,
  message: string,
  requestId: string,
  options?: { provider?: string; retryable?: boolean; diagnostics?: string },
): ProviderError {
  return {
    code,
    message,
    requestId,
    provider: options?.provider,
    retryable: options?.retryable ?? false,
    diagnostics: options?.diagnostics,
  };
}

export function normalizeUnknownError(
  err: unknown,
  requestId: string,
  provider?: string,
): ProviderError {
  if (err instanceof IntelligenceGatewayError) {
    return err.providerError;
  }
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('OPENAI_API_KEY') || message.includes('credentials')) {
    return createProviderError('MISSING_CREDENTIALS', message, requestId, {
      provider,
      retryable: false,
    });
  }
  if (message.includes('timeout') || message.includes('aborted')) {
    return createProviderError('TIMEOUT', message, requestId, {
      provider,
      retryable: true,
    });
  }
  if (message.includes('429') || message.toLowerCase().includes('rate limit')) {
    return createProviderError('RATE_LIMITED', message, requestId, {
      provider,
      retryable: true,
    });
  }
  if (message.includes('503') || message.toLowerCase().includes('unavailable')) {
    return createProviderError('PROVIDER_UNAVAILABLE', message, requestId, {
      provider,
      retryable: true,
    });
  }
  if (message.includes('Empty') || message.includes('invalid JSON') || message.includes('missing')) {
    return createProviderError('INVALID_OUTPUT', message, requestId, {
      provider,
      retryable: false,
    });
  }
  return createProviderError('UNKNOWN', message, requestId, { provider, retryable: false });
}

export function toHttpErrorPayload(error: ProviderError): {
  error: string;
  code: ProviderErrorCode;
  keyMissing?: boolean;
  requestId: string;
} {
  return {
    error: error.message,
    code: error.code,
    keyMissing: error.code === 'MISSING_CREDENTIALS',
    requestId: error.requestId,
  };
}

export function throwProviderError(error: ProviderError): never {
  throw new IntelligenceGatewayError(error);
}
