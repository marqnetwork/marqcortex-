/**
 * AI Control Plane error taxonomy.
 *
 * One error type for the whole plane. Every failure — security, policy,
 * governance, provider — is expressed as an `AIError` carrying a stable
 * machine code, an HTTP status, a retryability flag and a caller-safe message.
 *
 * Two message channels, deliberately separated:
 *   `message`     — safe to return to the caller. Never contains prompt text,
 *                   model output, credentials or another tenant's data.
 *   `diagnostics` — server-side only. Logged and audited, never serialized
 *                   into an HTTP response body.
 */

export type AIErrorCode =
  // ── Security ──────────────────────────────────────────────────────────────
  | 'AUTH_REQUIRED'
  | 'AUTH_INVALID'
  | 'FORBIDDEN'
  | 'ORGANIZATION_REQUIRED'
  | 'ORGANIZATION_NOT_RESOLVED'
  | 'TENANT_ISOLATION_VIOLATION'
  | 'CAPABILITY_DENIED'
  // ── Request validation ────────────────────────────────────────────────────
  | 'VALIDATION_FAILED'
  | 'PAYLOAD_TOO_LARGE'
  | 'CONTRACT_VERSION_UNSUPPORTED'
  // ── Quota and policy ──────────────────────────────────────────────────────
  | 'RATE_LIMITED'
  | 'BUDGET_EXCEEDED'
  | 'POLICY_DENIED'
  | 'FEATURE_NOT_FOUND'
  | 'FEATURE_DISABLED'
  // ── Governance ────────────────────────────────────────────────────────────
  | 'INPUT_GUARD_BLOCKED'
  | 'OUTPUT_GUARD_BLOCKED'
  // ── Prompt management ─────────────────────────────────────────────────────
  | 'PROMPT_NOT_FOUND'
  | 'PROMPT_RENDER_FAILED'
  // ── Provider layer ────────────────────────────────────────────────────────
  | 'NO_PROVIDER_AVAILABLE'
  | 'PROVIDER_NOT_FOUND'
  | 'PROVIDER_DISABLED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_AUTH_FAILED'
  | 'PROVIDER_CAPABILITY_MISMATCH'
  | 'CIRCUIT_OPEN'
  | 'INVALID_MODEL_OUTPUT'
  // ── Fallback ──────────────────────────────────────────────────────────────
  | 'INTERNAL_ERROR';

interface ErrorTrait {
  status: number;
  /** Whether the *same* request may succeed on a later attempt. */
  retryable: boolean;
  /** Whether a different provider may satisfy the request. */
  failoverable: boolean;
}

const TRAITS: Record<AIErrorCode, ErrorTrait> = {
  AUTH_REQUIRED: { status: 401, retryable: false, failoverable: false },
  AUTH_INVALID: { status: 401, retryable: false, failoverable: false },
  FORBIDDEN: { status: 403, retryable: false, failoverable: false },
  ORGANIZATION_REQUIRED: { status: 400, retryable: false, failoverable: false },
  ORGANIZATION_NOT_RESOLVED: { status: 403, retryable: false, failoverable: false },
  TENANT_ISOLATION_VIOLATION: { status: 403, retryable: false, failoverable: false },
  CAPABILITY_DENIED: { status: 403, retryable: false, failoverable: false },

  VALIDATION_FAILED: { status: 400, retryable: false, failoverable: false },
  PAYLOAD_TOO_LARGE: { status: 413, retryable: false, failoverable: false },
  CONTRACT_VERSION_UNSUPPORTED: { status: 400, retryable: false, failoverable: false },

  RATE_LIMITED: { status: 429, retryable: true, failoverable: false },
  BUDGET_EXCEEDED: { status: 429, retryable: false, failoverable: false },
  POLICY_DENIED: { status: 403, retryable: false, failoverable: false },
  FEATURE_NOT_FOUND: { status: 404, retryable: false, failoverable: false },
  FEATURE_DISABLED: { status: 503, retryable: false, failoverable: false },

  INPUT_GUARD_BLOCKED: { status: 422, retryable: false, failoverable: false },
  OUTPUT_GUARD_BLOCKED: { status: 422, retryable: true, failoverable: true },

  PROMPT_NOT_FOUND: { status: 500, retryable: false, failoverable: false },
  PROMPT_RENDER_FAILED: { status: 500, retryable: false, failoverable: false },

  NO_PROVIDER_AVAILABLE: { status: 503, retryable: true, failoverable: false },
  PROVIDER_NOT_FOUND: { status: 500, retryable: false, failoverable: true },
  PROVIDER_DISABLED: { status: 503, retryable: false, failoverable: true },
  PROVIDER_UNAVAILABLE: { status: 503, retryable: true, failoverable: true },
  PROVIDER_TIMEOUT: { status: 504, retryable: true, failoverable: true },
  PROVIDER_RATE_LIMITED: { status: 429, retryable: true, failoverable: true },
  PROVIDER_AUTH_FAILED: { status: 503, retryable: false, failoverable: true },
  PROVIDER_CAPABILITY_MISMATCH: { status: 500, retryable: false, failoverable: true },
  CIRCUIT_OPEN: { status: 503, retryable: true, failoverable: true },
  INVALID_MODEL_OUTPUT: { status: 502, retryable: true, failoverable: true },

  INTERNAL_ERROR: { status: 500, retryable: false, failoverable: false },
};

export interface AIErrorOptions {
  /** Server-side detail. Logged and audited; never returned to the caller. */
  diagnostics?: string;
  /** Overrides the taxonomy default when a provider states otherwise. */
  retryable?: boolean;
  /** Provider that produced the failure, when applicable. */
  providerId?: string;
  /** Seconds the caller should wait before retrying (429/503). */
  retryAfterSeconds?: number;
  /** Field-level detail for VALIDATION_FAILED. Caller-safe. */
  fields?: readonly string[];
  /** Original throwable, preserved for logging. */
  cause?: unknown;
  /**
   * Trace identity, stamped once the guard has produced a context.
   *
   * Without these a failed request returns an empty requestId, and the one
   * identifier a support engineer needs to find the matching audit record is
   * exactly the one that does not survive the failure path.
   */
  requestId?: string;
  correlationId?: string;
  /**
   * Identity resolved before the failure, when any was.
   *
   * A request rejected inside the guard has no `AIRequestContext` — the guard
   * throws before building one — so a tenant-isolation or organization-
   * resolution failure would otherwise produce a metric and a log line and no
   * audit record at all. That is the wrong outcome for the one class of
   * rejection a security review most wants a durable trail of: a caller who
   * authenticated successfully and then reached for another tenant's data.
   */
  securityContext?: AISecurityContext;
}

/** Whatever identity was established before a guard-stage rejection. */
export interface AISecurityContext {
  readonly subjectId: string;
  readonly actorType: string;
  readonly roles: readonly string[];
  readonly organizationId?: string;
  /** Organization the caller ASKED for, when it differs from what they hold. */
  readonly requestedOrganizationId?: string;
}

export class AIError extends Error {
  readonly code: AIErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly failoverable: boolean;
  readonly diagnostics?: string;
  readonly providerId?: string;
  readonly retryAfterSeconds?: number;
  readonly fields?: readonly string[];
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly securityContext?: AISecurityContext;

  constructor(code: AIErrorCode, message: string, options: AIErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    const trait = TRAITS[code] ?? TRAITS.INTERNAL_ERROR;
    this.name = 'AIError';
    this.code = code;
    this.status = trait.status;
    this.retryable = options.retryable ?? trait.retryable;
    this.failoverable = trait.failoverable;
    this.diagnostics = options.diagnostics;
    this.providerId = options.providerId;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.fields = options.fields;
    this.requestId = options.requestId;
    this.correlationId = options.correlationId;
    this.securityContext = options.securityContext;
  }

  /**
   * Attach the identity that was resolved before this failure.
   *
   * Called by the guard as it rejects, so the orchestrator can write an audit
   * record for a rejection that never produced a full request context.
   */
  withSecurityContext(securityContext: AISecurityContext): AIError {
    const stamped = new AIError(this.code, this.message, {
      diagnostics: this.diagnostics,
      retryable: this.retryable,
      providerId: this.providerId,
      retryAfterSeconds: this.retryAfterSeconds,
      fields: this.fields,
      cause: this.cause,
      requestId: this.requestId,
      correlationId: this.correlationId,
      securityContext,
    });
    stamped.stack = this.stack;
    return stamped;
  }

  /**
   * Return a copy carrying trace identity. Errors are thrown from deep in the
   * plane, where the request context is not in scope; the orchestrator stamps
   * the ids on the way out rather than threading a context through every throw
   * site.
   */
  withTrace(requestId: string, correlationId: string): AIError {
    if (this.requestId === requestId && this.correlationId === correlationId) return this;
    const traced = new AIError(this.code, this.message, {
      diagnostics: this.diagnostics,
      retryable: this.retryable,
      providerId: this.providerId,
      retryAfterSeconds: this.retryAfterSeconds,
      fields: this.fields,
      cause: this.cause,
      requestId,
      correlationId,
      securityContext: this.securityContext,
    });
    traced.stack = this.stack;
    return traced;
  }

  /**
   * Caller-safe HTTP body. Deliberately excludes `diagnostics`.
   *
   * The ids stamped on the error win over the arguments: once the guard has
   * produced a context, that context's identity is the authoritative one, and
   * the caller-supplied fallback is only for failures that happened before it
   * existed.
   */
  toResponseBody(requestId: string, correlationId: string): {
    success: false;
    error: string;
    code: AIErrorCode;
    requestId: string;
    correlationId: string;
    retryable: boolean;
    fields?: readonly string[];
    retryAfterSeconds?: number;
  } {
    const body = {
      success: false as const,
      error: this.message,
      code: this.code,
      requestId: this.requestId ?? requestId,
      correlationId: this.correlationId ?? correlationId,
      retryable: this.retryable,
    };
    if (this.fields?.length) Object.assign(body, { fields: this.fields });
    if (this.retryAfterSeconds !== undefined) {
      Object.assign(body, { retryAfterSeconds: this.retryAfterSeconds });
    }
    return body;
  }
}

export function isAIError(value: unknown): value is AIError {
  return value instanceof AIError;
}

/** HTTP status for a code, without constructing an error. */
export function statusForCode(code: AIErrorCode): number {
  return (TRAITS[code] ?? TRAITS.INTERNAL_ERROR).status;
}

/** True when another provider is worth trying for this code. */
export function isFailoverable(code: AIErrorCode): boolean {
  return (TRAITS[code] ?? TRAITS.INTERNAL_ERROR).failoverable;
}

/**
 * Coerce an unknown throwable into an AIError. Unknown throwables never leak
 * their message to the caller — the raw text is preserved in `diagnostics`
 * only, because a provider SDK may embed request payloads in its errors.
 */
export function toAIError(err: unknown): AIError {
  if (isAIError(err)) return err;
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return new AIError('INTERNAL_ERROR', 'AI request failed.', {
    diagnostics: raw,
    cause: err,
  });
}
