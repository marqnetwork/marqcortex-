/**
 * Framework-agnostic HTTP adapter for the AI Control Plane.
 *
 * Maps an HTTP-shaped request onto `controlPlane.execute` and an execution
 * result — or an `AIError` — onto an HTTP-shaped response. It takes no web
 * framework dependency, so the whole request/response mapping (status codes,
 * trace headers, error bodies) is unit-testable without a server, and binding a
 * different framework later is a new twenty-line file rather than a rewrite.
 *
 * RESPONSE SHAPE — the feature's output is spread at the top level alongside
 * `success`, `model` and `generated_at`. That is the contract the existing
 * frontend clients read, and Batch 1 is a platform change, not a client-visible
 * API change: every existing response field keeps its name, position and
 * meaning. Trace identity is added alongside, never in place of.
 *
 * `keyMissing` is preserved for the same reason. The console shows a specific
 * "AI is not configured" state off that flag; it is now derived from the
 * provider-credential error codes rather than from string-matching an exception
 * message, which is both more accurate and no longer coupled to one vendor's
 * environment variable name.
 */

import type { AIChannel, AIExecutionResult } from '../contracts/request.ts';
import type { AIControlPlane } from '../controlPlane.ts';
import { AIError, toAIError } from '../contracts/errors.ts';

export interface AIHttpRequest {
  readonly featureId: string;
  readonly body: unknown;
  readonly authorization: string | null;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly contractVersion?: string;
  readonly organizationHint?: string;
  readonly clientIp?: string;
  readonly userAgent?: string;
  readonly contentLength?: number;
  readonly channel?: AIChannel;
}

export interface AIHttpResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly headers: Readonly<Record<string, string>>;
}

/** Error codes that mean "AI is not configured", which the console renders. */
const CREDENTIAL_CODES = new Set(['PROVIDER_AUTH_FAILED', 'NO_PROVIDER_AVAILABLE']);

export async function executeAIHttpRequest(
  plane: AIControlPlane,
  request: AIHttpRequest,
): Promise<AIHttpResponse> {
  try {
    const result = await plane.execute<Record<string, unknown>>(
      {
        featureId: request.featureId,
        input: request.body,
        correlationId: request.correlationId,
        causationId: request.causationId,
        contractVersion: request.contractVersion,
        channel: request.channel ?? 'team_console',
      },
      {
        authorization: request.authorization,
        clientIp: request.clientIp,
        userAgent: request.userAgent,
        organizationHint: request.organizationHint,
        contentLength: request.contentLength,
      },
    );

    return {
      status: 200,
      body: successBody(result),
      headers: traceHeaders(result.requestId, result.correlationId),
    };
  } catch (error) {
    const aiError = toAIError(error);
    return errorResponse(aiError, request);
  }
}

function successBody(result: AIExecutionResult<Record<string, unknown>>): Record<string, unknown> {
  const output =
    typeof result.output === 'object' && result.output !== null ? result.output : {};

  return {
    success: true,
    ...output,

    // Existing client contract.
    model: result.execution.modelId,
    generated_at: result.completedAt,

    // Trace and provenance, additive.
    requestId: result.requestId,
    correlationId: result.correlationId,
    meta: {
      featureId: result.featureId,
      featureVersion: result.featureVersion,
      platformVersion: result.platformVersion,
      contractVersion: result.contractVersion,
      promptId: result.promptId,
      promptVersion: result.promptVersion,
      promptHash: result.promptHash,
      provider: result.execution.providerId,
      attempts: result.execution.attempts,
      latencyMs: result.execution.latencyMs,
      usage: result.usage,
      governance: result.governance,
    },
  };
}

function errorResponse(error: AIError, request: AIHttpRequest): AIHttpResponse {
  // Trace ids exist only once the guard has run. When a request is rejected
  // before that, the body still carries the fields the client reads — empty
  // rather than absent, so no client has to branch on their presence.
  const body: Record<string, unknown> = {
    ...error.toResponseBody('', request.correlationId ?? ''),
    keyMissing: CREDENTIAL_CODES.has(error.code),
  };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (error.retryAfterSeconds !== undefined) {
    headers['Retry-After'] = String(error.retryAfterSeconds);
  }

  return { status: error.status, body, headers };
}

function traceHeaders(requestId: string, correlationId: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Request-Id': requestId,
    'X-Correlation-Id': correlationId,
  };
}

/** Read a trace id from inbound headers, tolerating either spelling. */
export function correlationIdFromHeaders(
  read: (name: string) => string | null | undefined,
): string | undefined {
  return read('x-correlation-id') ?? read('x-request-id') ?? undefined;
}
