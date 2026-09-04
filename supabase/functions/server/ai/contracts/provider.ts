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
import type {
  AICredentialSourceCategory,
  CredentialTenant,
} from '../providers/credentials/contracts.ts';

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

/**
 * How a provider is authenticated, declared by the adapter (AI-01 Batch 4C).
 *
 * This is METADATA, not a switch. It exists so the administration surface and
 * the console can be written once, generically, instead of as a chain of
 * `if (providerId === 'openai') ... else if (providerId === 'anthropic')`.
 * A future adapter declares its own policy and the console renders it with no
 * edit — which is the whole test of whether Batch 4C's contract is real.
 */
export interface AIProviderCredentialPolicy {
  /** True when the adapter cannot execute without secret material. */
  readonly required: boolean;
  /**
   * True when a MARQ platform administrator may store a MANAGED credential for
   * this provider through the console.
   *
   * False for the synthetic mock provider: it has no vendor, no account and no
   * key, so a credential form for it would be a control that does nothing.
   */
  readonly manageable: boolean;
  /**
   * The deployment-managed environment variable this provider also accepts, for
   * bootstrap and emergency compatibility.
   *
   * A NAME, never a value. Nothing reads the variable through this field except
   * the credential resolver, and no administration response ever carries what
   * it contains.
   */
  readonly environmentVariable?: string;
  /** A hint for the console's credential form. Never an example of a real key. */
  readonly credentialFormatHint?: string;
}

export interface AIProviderDescriptor {
  readonly providerId: string;
  readonly displayName: string;
  /** Lower wins when several providers satisfy a feature equally. */
  readonly priority: number;
  /** Models this provider serves, keyed by model id. */
  readonly models: readonly AIModelDescriptor[];
  /** True when the adapter is safe to serve production traffic. */
  readonly productionReady: boolean;
  /**
   * True when invoking this provider spends real money with an external vendor.
   *
   * This is the flag the real-request kill switch and the MARQ spend ceiling are
   * built on, and it is a property of the adapter rather than a configuration
   * value precisely so it cannot be turned off to make a cap go away. A provider
   * that reaches a paid API declares `billable: true` and is refused entirely
   * while `AI_ALLOW_REAL_REQUESTS` is false.
   */
  readonly billable: boolean;
  /** How this provider is authenticated. See `AIProviderCredentialPolicy`. */
  readonly credential: AIProviderCredentialPolicy;
  /**
   * True when this provider may not be ENABLED until MARQ has CERTIFIED it
   * (AI-01 Batch 4E remediation, M-1).
   *
   * A DURABLE GATE, not a starting value. Registration already chose an initial
   * enabled state, but `applySettings()` re-derives every provider's enabled
   * flag from the persisted operational overlay on each settings adoption — so
   * a gate applied only at registration is overwritten by the first stored
   * setting that says `enabled: true`. An independent certification gate proved
   * exactly that: a self-hosted provider registered `enabled: false,
   * certification: unverified` came back `enabled: true` with its certification
   * untouched.
   *
   * The distinction it preserves is the one this platform is built on:
   * ENABLED is an operational switch an administrator flips; CERTIFIED is a
   * governance decision somebody made about whether this provider may serve at
   * all. Neither implies the other, and an operator turning a switch must not
   * be able to substitute for the decision.
   *
   * OPTIONAL, AND ABSENCE IS THE EXISTING BEHAVIOUR. OpenAI, Anthropic and the
   * mock omit it and are governed exactly as they were: their certification is
   * chosen at registration by reviewed bootstrap code, not by a stored row.
   * Only providers whose DEFINITION arrives from storage set it.
   */
  readonly certificationGatesEnablement?: boolean;
}

/** Everything an adapter needs for one attempt. Nothing more. */
export interface AIProviderInvocation {
  readonly requestId: string;
  readonly correlationId: string;
  readonly modelId: string;
  readonly generation: AIGenerationRequest;
  readonly attempt: number;
  readonly signal: AbortSignal;
  /**
   * The AUTHENTICATED tenant this attempt belongs to (AI-01 Batch 4D).
   *
   * The adapter does exactly one thing with it: hands it to the credential
   * resolver. It is not a routing key, not a header, not a vendor parameter and
   * not something an adapter may branch on — a customer's organization id must
   * never reach a vendor, and nothing here sends it anywhere.
   *
   * OPTIONAL, AND ABSENCE IS THE PLATFORM PATH. Every existing caller and every
   * existing test omits it and gets the Batch 4C resolution unchanged. It is
   * populated by ONE call site — the execution pipeline — from the organization
   * the AI Guard already resolved.
   */
  readonly tenant?: CredentialTenant;
}

export interface AIProviderCompletion {
  readonly content: string;
  readonly modelId: string;
  readonly usage: AITokenUsage;
  readonly finishReason?: string;
  /**
   * WHICH credential authorised this attempt (AI-01 Batch 4D).
   *
   * Reported by the adapter because the adapter is the only thing that knows:
   * it is the one place `resolve` is called, and the resolution depends on the
   * tenant, on storage and on the environment all at execution time. The
   * pipeline carries it to the audit record so provenance can say "this
   * customer's own key paid for this" without any layer above having to guess.
   *
   * A CATEGORY AND NOTHING MORE. There is no credential id here, no
   * fingerprint, no organization id and — obviously — no secret. Optional, so
   * every existing adapter double stays valid.
   */
  readonly credentialSource?: AICredentialSourceCategory;
}

export interface AIProviderAdapter {
  readonly descriptor: AIProviderDescriptor;
  /**
   * Whether credential material is available for this provider right now.
   *
   * SYNCHRONOUS, and deliberately so: the registry's health read, the
   * selector's eligibility test and the spend guard's "could this cost money?"
   * probe all ask this, and none of them should be waiting on storage. The
   * authoritative resolution happens inside `invoke`.
   */
  hasCredentials(): boolean;
  /**
   * Non-secret facts about the credential in force (AI-01 Batch 4C).
   *
   * Optional, so an adapter with no credential concept — the mock — and every
   * test double stay valid without implementing it. Returns METADATA ONLY;
   * there is no member of the returned shape a secret could occupy.
   */
  credentialStatus?(): {
    readonly source: 'managed' | 'environment' | 'none';
    readonly fingerprint?: string;
  };
  /** Execute exactly one attempt. Must throw `AIError` on failure. */
  invoke(invocation: AIProviderInvocation): Promise<AIProviderCompletion>;
}

/** Live operational state of one provider, as the registry sees it. */
export interface AIProviderHealth {
  readonly providerId: string;
  readonly state: AIProviderState;
  readonly certification: AICertificationStatus;
  readonly credentialsConfigured: boolean;
  /**
   * WHERE the credential in force came from (AI-01 Batch 4C).
   *
   * Reported beside `credentialsConfigured` rather than folded into it, because
   * "configured" and "managed by Cortex" are different facts and an operator
   * deciding whether a rotation needs a deploy has to be able to tell them
   * apart. Never carries the credential.
   */
  readonly credentialSource: 'managed' | 'environment' | 'none';
  /** Keyed digest of the credential in force, when one is managed. */
  readonly credentialFingerprint?: string;
  readonly circuit: 'closed' | 'open' | 'half_open';
  readonly consecutiveFailures: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly lastLatencyMs?: number;
  readonly lastError?: string;
  /** When this provider last failed. Absent means it never has. */
  readonly lastFailureAt?: string;
  /**
   * When it last succeeded after a failure. Absent means it has never had to
   * recover — which is a different statement from "it is not recovered", and an
   * operations console has to be able to tell them apart.
   */
  readonly lastRecoveryAt?: string;
  readonly checkedAt: string;
}
