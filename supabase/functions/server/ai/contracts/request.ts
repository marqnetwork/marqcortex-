/**
 * Request contracts for the AI Control Plane.
 *
 * `AIRequestEnvelope` is what a caller submits. `AIRequestContext` is what the
 * AI Guard produces from it after authentication, authorization, organization
 * resolution and actor resolution — the immutable, fully-resolved identity and
 * trace record that every downstream stage reads and no stage may rewrite.
 *
 * Business logic never names a provider or a model in these contracts. It names
 * a *feature*; the control plane decides how that feature executes.
 */

import type { AIErrorCode } from './errors.ts';

// ── Identity ────────────────────────────────────────────────────────────────

export type AIActorType = 'team_user' | 'client_contact' | 'service' | 'anonymous';

export interface AIActor {
  /** Stable identifier used for rate limiting, budgets and audit. */
  readonly actorId: string;
  readonly actorType: AIActorType;
  /** Auth subject (Supabase user id) when the actor is authenticated. */
  readonly subjectId?: string;
  readonly email?: string;
  readonly roles: readonly string[];
  /** Capability grants resolved at guard time. Enforced by the policy engine. */
  readonly capabilities: readonly string[];
}

export type AIOrganizationTier = 'internal' | 'standard' | 'enterprise';

export interface AIOrganization {
  readonly organizationId: string;
  readonly slug?: string;
  readonly tier: AIOrganizationTier;
  /**
   * True when this organization came from a membership the identity provider
   * confirmed the actor holds; false when it is the configured single-tenant
   * default.
   *
   * The distinction travels into the audit record on purpose. "Tenant isolation
   * enforced" and "everything landed in the default bucket because nobody has a
   * membership row yet" produce identical-looking audit trails unless the
   * difference is recorded, and only one of them is an isolation guarantee.
   */
  readonly membershipVerified: boolean;
  /**
   * The value every tenant-scoped read/write must be keyed by. Held separately
   * from `organizationId` so a future partition strategy (region, shard, BYO
   * key) can change without touching call sites.
   */
  readonly isolationKey: string;
}

export type AIChannel = 'team_console' | 'client_portal' | 'system';

// ── Envelope (caller input) ─────────────────────────────────────────────────

export interface AIRequestEnvelope<TInput = unknown> {
  /** Feature being invoked. The only routing key business logic supplies. */
  readonly featureId: string;
  /** Feature-specific payload. Validated by the feature's declared validator. */
  readonly input: TInput;
  /** Caller-supplied trace id linking related executions. Optional. */
  readonly correlationId?: string;
  /** requestId of the execution that caused this one. Optional. */
  readonly causationId?: string;
  /** Wire contract the caller was built against. Defaults to current. */
  readonly contractVersion?: string;
  /** Where the request entered the platform. */
  readonly channel?: AIChannel;
  /** Non-identifying labels propagated to logs, metrics and audit. */
  readonly attributes?: Readonly<Record<string, string>>;
}

/** Transport facts the guard needs. Framework-agnostic by design. */
export interface AIRequestTransport {
  readonly authorization: string | null;
  readonly clientIp?: string;
  readonly userAgent?: string;
  /** Organization hint supplied by the caller. Never trusted on its own. */
  readonly organizationHint?: string;
  /** Serialized body size in bytes, when the transport knows it. */
  readonly contentLength?: number;
}

// ── Resolved context ────────────────────────────────────────────────────────

export interface AIRequestContext {
  readonly requestId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly receivedAt: string;
  readonly platformVersion: string;
  readonly contractVersion: string;
  readonly featureId: string;
  readonly featureVersion: string;
  readonly actor: AIActor;
  readonly organization: AIOrganization;
  readonly channel: AIChannel;
  readonly clientIp?: string;
  readonly userAgent?: string;
  readonly attributes: Readonly<Record<string, string>>;
}

// ── Execution result ────────────────────────────────────────────────────────

export interface AITokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface AICostEstimate {
  /** Micro-USD (1e-6 USD) — integer arithmetic, no float drift in ledgers. */
  readonly microUsd: number;
  readonly basis: 'metered' | 'estimated';
}

export interface AIExecutionTrace {
  readonly providerId: string;
  readonly modelId: string;
  readonly attempts: number;
  readonly latencyMs: number;
  /** Providers tried and rejected before the one that answered. */
  readonly failedProviders: readonly string[];
}

export interface AIGovernanceTrace {
  readonly inputGuard: 'pass' | 'redacted' | 'blocked';
  /**
   * `flagged` means the output was returned but violated a soft rule (house
   * tone). Hard rules — guarantee language, unparseable structure — produce
   * `blocked`, and blocked output is never returned to a caller.
   */
  readonly outputGuard: 'pass' | 'flagged' | 'blocked';
  /** Categories of PII removed before the prompt left the platform. */
  readonly redactedCategories: readonly string[];
  /** Fields restored to their authoritative value after generation. */
  readonly factLockRestored: readonly string[];
}

export interface AIExecutionResult<TOutput = unknown> {
  readonly requestId: string;
  readonly correlationId: string;
  readonly featureId: string;
  readonly featureVersion: string;
  readonly platformVersion: string;
  readonly contractVersion: string;
  readonly promptId: string;
  readonly promptVersion: string;
  readonly promptHash: string;
  readonly output: TOutput;
  readonly usage: AITokenUsage;
  readonly cost: AICostEstimate;
  readonly execution: AIExecutionTrace;
  readonly governance: AIGovernanceTrace;
  readonly completedAt: string;
}

// ── Provider-neutral generation shapes ──────────────────────────────────────

export type AIMessageRole = 'system' | 'user' | 'assistant';

export interface AIMessage {
  readonly role: AIMessageRole;
  readonly content: string;
}

export type AIResponseFormat = 'text' | 'json_object';

/**
 * What a feature asks the plane to generate, after prompt rendering. Still
 * provider-neutral: no model id, no provider name, no vendor parameters.
 */
export interface AIGenerationRequest {
  readonly messages: readonly AIMessage[];
  readonly responseFormat: AIResponseFormat;
  readonly temperature: number;
  readonly maxOutputTokens: number;
}

/** Structured failure detail carried on the audit record. */
export interface AIFailureRecord {
  readonly code: AIErrorCode;
  readonly message: string;
  readonly providerId?: string;
}
