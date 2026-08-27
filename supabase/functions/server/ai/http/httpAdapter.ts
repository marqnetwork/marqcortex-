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
 * `meta` carries the provenance of the run: which provider and which model
 * answered, how many attempts it took, what it consumed, and what governance
 * did to it. A caller that wants to know how an answer was produced reads
 * `meta` and nothing else — see the note on `meta.model` below for what
 * happens when half of that story lives somewhere else.
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
    return errorResponse(aiError, request, newTraceId());
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
      // The model belongs beside the provider that served it (AI-01 Batch 4B).
      //
      // It is ALSO at the top level, and that is not redundancy — it is the
      // whole defect. `model` sits at the top level because the pre-Batch-1
      // clients read it there, and Batch 1 kept every existing field where it
      // was. But provenance moved into `meta`, and a reader who finds
      // `meta.provider` reasonably looks for `meta.model` next. It was not
      // there, so the Batch 4A production proof — reading both from the one
      // place provenance lives — reported `provider=openai model=null` for a
      // request that had in fact recorded its model correctly everywhere else:
      // in the execution trace, in the audit record and in the log line.
      //
      // The completion is answered by a (provider, model) PAIR. Splitting the
      // pair across two levels of one response is what made a correct platform
      // look like a broken one, so both halves are reported together here and
      // the top-level field stays exactly where its clients expect it.
      model: result.execution.modelId,
      attempts: result.execution.attempts,
      latencyMs: result.execution.latencyMs,
      usage: result.usage,
      governance: result.governance,
    },
  };
}

function errorResponse(error: AIError, request: AIHttpRequest, fallbackTraceId: string): AIHttpResponse {
  // Every response carries a usable trace id. A failure inside the plane brings
  // the context's own ids with it; a failure before the guard ran has none, so
  // the adapter supplies one rather than returning an empty string a caller
  // cannot quote in a support ticket.
  const correlationId =
    error.correlationId ?? sanitizeTraceId(request.correlationId) ?? fallbackTraceId;
  const body: Record<string, unknown> = {
    ...error.toResponseBody(error.requestId ?? fallbackTraceId, correlationId),
    keyMissing: CREDENTIAL_CODES.has(error.code),
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Request-Id': String(body.requestId ?? fallbackTraceId),
    'X-Correlation-Id': correlationId,
  };
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

/**
 * Read a trace id from inbound headers, tolerating either spelling.
 *
 * The value is sanitised here, at the edge, rather than trusted to the guard.
 * The guard does validate it — but the error path can echo a correlation id
 * back to the caller before the guard ever runs, and an unbounded header value
 * reflected into a response body and a log line is how a header becomes an
 * injection vector.
 */
export function correlationIdFromHeaders(
  read: (name: string) => string | null | undefined,
): string | undefined {
  return (
    sanitizeTraceId(read('x-correlation-id')) ?? sanitizeTraceId(read('x-request-id')) ?? undefined
  );
}

/** Caller-supplied trace ids must be safe in a log line, a header and a body. */
const SAFE_TRACE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function sanitizeTraceId(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return SAFE_TRACE_ID.test(trimmed) ? trimmed : undefined;
}

/** A trace id for a failure that never reached the guard. */
function newTraceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `cor_${crypto.randomUUID().replace(/-/g, '')}`;
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return `cor_${out}`;
}
