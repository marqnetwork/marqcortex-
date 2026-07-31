/**
 * Policy and feature catalog contracts.
 *
 * A feature descriptor is the declarative definition of one AI capability:
 * who may call it, what it may cost, which prompt it uses, what the model is
 * allowed to see and what it is allowed to return. Adding or retuning a feature
 * is a data change in the catalog — not a code change in the execution path.
 * (Engineering principle 5: configuration over code.)
 */

import type { AIActorType, AIChannel, AIResponseFormat } from './request.ts';

/** Capabilities the platform can grant to an actor. */
export type AICapability =
  | 'ai.narrative.generate'
  | 'ai.analysis.run'
  | 'ai.chat.converse'
  | 'ai.block.assist'
  | 'ai.copilot.plan'
  | 'ai.section.copilot';

/** Cost class drives the budget bucket a feature draws from. */
export type AIBudgetClass = 'interactive' | 'batch' | 'background';

export interface AIRateLimitRule {
  /** Requests allowed per window, per subject. */
  readonly limit: number;
  readonly windowMs: number;
}

export interface AIFeatureLimits {
  /** Per-actor rate limit. Protects one user from exhausting their org. */
  readonly perActor: AIRateLimitRule;
  /** Per-organization rate limit. Protects the platform from one tenant. */
  readonly perOrganization: AIRateLimitRule;
  /** Hard ceiling on serialized input bytes accepted for this feature. */
  readonly maxInputBytes: number;
  /** Hard ceiling on tokens the model may emit. */
  readonly maxOutputTokens: number;
  /** Wall-clock budget for one provider attempt. */
  readonly timeoutMs: number;
  /** Attempts per provider before the plane fails over. */
  readonly maxAttempts: number;
}

export interface AIGovernanceRules {
  /** Redact PII from prompt content before it leaves the platform. */
  readonly redactInput: boolean;
  /** Reject model output that asserts a guarantee ("guaranteed ROI", …). */
  readonly forbidGuaranteeLanguage: boolean;
  /** Reject model output containing banned low-signal jargon. */
  readonly enforceToneBans: boolean;
  /** Require the model's declared response format to parse cleanly. */
  readonly enforceResponseFormat: boolean;
  /**
   * Top-level fields a JSON response must contain. A response missing one is a
   * retryable failure, not a partial success handed to a caller.
   */
  readonly requiredOutputFields: readonly string[];
  /** Fields the model may never change; restored deterministically after. */
  readonly factLockedFields: readonly string[];
  /** Maximum characters of model output accepted. */
  readonly maxOutputChars: number;
}

export interface AIFeatureDescriptor {
  readonly featureId: string;
  /** Bumped whenever the feature's contract or governance changes. */
  readonly featureVersion: string;
  readonly displayName: string;
  /** Team accountable for this feature's behaviour and prompt. */
  readonly owner: string;
  readonly enabled: boolean;
  readonly capability: AICapability;
  /** Actor types permitted to invoke the feature. */
  readonly allowedActorTypes: readonly AIActorType[];
  /** Channels permitted to invoke the feature. */
  readonly allowedChannels: readonly AIChannel[];
  /** Prompt this feature renders. Resolved through the prompt registry. */
  readonly promptId: string;
  readonly responseFormat: AIResponseFormat;
  readonly temperature: number;
  readonly budgetClass: AIBudgetClass;
  readonly limits: AIFeatureLimits;
  readonly governance: AIGovernanceRules;
  /** Model capabilities a provider must offer to serve this feature. */
  readonly requiredCapabilities: {
    readonly structuredOutput: boolean;
    readonly chatCompletions: boolean;
  };
}

// ── Policy decisions ────────────────────────────────────────────────────────

export type AIPolicyEffect = 'allow' | 'deny';

export interface AIPolicyViolation {
  readonly rule: string;
  readonly detail: string;
}

export interface AIPolicyDecision {
  readonly effect: AIPolicyEffect;
  /** Rules that were evaluated, in order. Recorded on the audit trail. */
  readonly evaluated: readonly string[];
  readonly violation?: AIPolicyViolation;
}

// ── Budget ──────────────────────────────────────────────────────────────────

export interface AIBudgetWindow {
  readonly windowMs: number;
  /** Ceiling in micro-USD for the window. */
  readonly limitMicroUsd: number;
}

export interface AIBudgetPolicy {
  readonly organizationDaily: AIBudgetWindow;
  readonly actorDaily: AIBudgetWindow;
}

export interface AIBudgetState {
  readonly scope: string;
  readonly spentMicroUsd: number;
  readonly limitMicroUsd: number;
  readonly windowResetsAt: number;
}
