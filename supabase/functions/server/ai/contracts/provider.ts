/**
 * Provider layer contracts.
 *
 * A provider adapter is the ONLY place in the platform allowed to know a vendor
 * API exists. It receives a fully-resolved, provider-neutral invocation and
 * returns a normalized completion. It never reads configuration, never decides
 * whether it should run, never retries, and never records telemetry — those are
 * control plane concerns, applied uniformly to every provider.
 *
 * Adding a provider is therefore: implement `AIProviderAdapter`, declare its
 * models in the capability registry, register it. No business logic changes.
 */

import type { AIGenerationRequest, AITokenUsage } from './request.ts';

/** What a model can do. The selector matches these against feature demands. */
export interface AIModelCapabilities {
  readonly textGeneration: boolean;
  readonly structuredOutput: boolean;
  readonly chatCompletions: boolean;
  readonly maxOutputTokens: number;
  readonly maxContextTokens: number;
  /** True when the vendor contractually excludes data from model training. */
  readonly zeroDataRetention: boolean;
}

/** A concrete model offered by a provider, with its commercial terms. */
export interface AIModelDescriptor {
  readonly modelId: string;
  readonly providerId: string;
  readonly capabilities: AIModelCapabilities;
  /** Micro-USD per 1,000 prompt tokens. Integer — no float drift. */
  readonly promptMicroUsdPer1k: number;
  /** Micro-USD per 1,000 completion tokens. */
  readonly completionMicroUsdPer1k: number;
}

export type AIProviderState = 'active' | 'degraded' | 'unavailable' | 'disabled';

export type AICertificationStatus =
  | 'unverified'
  | 'testing'
  | 'certified'
  | 'degraded'
  | 'disabled';

export interface AIProviderDescriptor {
  readonly providerId: string;
  readonly displayName: string;
  /** Lower wins when several providers satisfy a feature equally. */
  readonly priority: number;
  /** Models this provider serves, keyed by model id. */
  readonly models: readonly AIModelDescriptor[];
  /** True when the adapter is safe to serve production traffic. */
  readonly productionReady: boolean;
}

/** Everything an adapter needs for one attempt. Nothing more. */
export interface AIProviderInvocation {
  readonly requestId: string;
  readonly correlationId: string;
  readonly modelId: string;
  readonly generation: AIGenerationRequest;
  readonly attempt: number;
  readonly signal: AbortSignal;
}

export interface AIProviderCompletion {
  readonly content: string;
  readonly modelId: string;
  readonly usage: AITokenUsage;
  readonly finishReason?: string;
}

export interface AIProviderAdapter {
  readonly descriptor: AIProviderDescriptor;
  /** Whether credentials for this provider are present in the environment. */
  hasCredentials(): boolean;
  /** Execute exactly one attempt. Must throw `AIError` on failure. */
  invoke(invocation: AIProviderInvocation): Promise<AIProviderCompletion>;
}

/** Live operational state of one provider, as the registry sees it. */
export interface AIProviderHealth {
  readonly providerId: string;
  readonly state: AIProviderState;
  readonly certification: AICertificationStatus;
  readonly credentialsConfigured: boolean;
  readonly circuit: 'closed' | 'open' | 'half_open';
  readonly consecutiveFailures: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly lastLatencyMs?: number;
  readonly lastError?: string;
  readonly checkedAt: string;
}
