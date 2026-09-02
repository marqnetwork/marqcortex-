/**
 * Provider credential contracts — AI-01 Batch 4C.
 *
 * A provider adapter needs exactly one thing from the platform's credential
 * layer: the secret material for one attempt, at the moment of that attempt.
 * It must not know where the secret came from, must not know that a database
 * exists, and must not be written twice — once for OpenAI and once for
 * Anthropic. So there is ONE port, and every adapter takes it.
 *
 *   Provider Adapter
 *         │
 *         ▼
 *   ProviderCredentialResolver
 *         ├── managed      a Cortex-administered, encrypted credential
 *         ├── environment  the deployment's own variable, for bootstrap and
 *         │                emergency compatibility
 *         └── none         the provider cannot execute
 *
 * TWO OPERATIONS, AND THE SPLIT IS THE DESIGN.
 *
 *   `describe` answers "is this provider configured, and by what?" It is
 *   SYNCHRONOUS and returns NO SECRET, because that question is asked by the
 *   registry's health read, by the selector's eligibility test and by the
 *   spend guard's "could this cost money?" probe — all of which run on a
 *   synchronous path and none of which has any business holding key material.
 *
 *   `resolve` answers "what is the secret?" It is ASYNCHRONOUS because a
 *   managed credential is decrypted server-side at execution time, and it is
 *   called from exactly one place per adapter: inside `invoke`.
 *
 * WHAT IS NOT HERE, ON PURPOSE. There is no `read`, no `reveal`, no
 * `plaintextOf(credentialId)`. `resolve` is keyed by PROVIDER, not by
 * credential id, so there is no shape of call that means "show me that
 * secret" — the resolver can only answer "what would you execute with right
 * now", which is the only question the runtime ever has.
 *
 * ── AI-01 BATCH 4D: THE SAME PORT, NOW TENANT-AWARE ────────────────────────
 *
 * A customer organization may bring its own vendor key. That does NOT add a
 * second resolver, a second port or a second execution path — it adds ONE
 * OPTIONAL ARGUMENT to `resolve`, and the argument is a TENANT the caller has
 * already authenticated:
 *
 *   Provider Adapter
 *         │  resolve(providerId, tenant?)
 *         ▼
 *   ProviderCredentialResolver
 *         ├── organization  the tenant's own encrypted credential  (4D)
 *         ├── managed       MARQ's own encrypted credential        (4C)
 *         ├── environment   the deployment's variable              (4A/4B)
 *         └── none          the provider cannot execute
 *
 * THE ARGUMENT IS NOT A HINT AND CANNOT BE ONE. It carries an organization id
 * that the AI Guard already resolved from an authenticated membership, and the
 * resolver treats an unverified one as no tenant at all — see
 * `CredentialTenant.membershipVerified`. Nothing a caller puts in a body or a
 * header reaches this type without passing through `resolveOrganization`.
 *
 * OMITTING IT IS THE PLATFORM PATH, BYTE FOR BYTE. `resolve(providerId)` with
 * no tenant behaves exactly as it did in Batch 4C: it reads platform-scoped
 * storage and the deployment environment, and it never touches an
 * organization-owned row. That is what keeps a customer's credential out of
 * MARQ's own execution rather than merely unlikely to appear in it.
 */

import type { ExecutionFundingLatch } from './executionFunding.ts';

/** Where the secret material for a provider came from. */
export type AICredentialSource = 'managed' | 'environment' | 'none';

/**
 * The credential source, at the granularity provenance needs (AI-01 Batch 4D).
 *
 * `AICredentialSource` answers "managed or not", which was the only question
 * before customers could manage one too. This answers "managed BY WHOM", which
 * is the question an audit record, a cost attribution and an incident review
 * all actually ask — and it is the only credential fact any of them records.
 *
 * It is a CATEGORY, never a locator. There is no credential id here, no
 * fingerprint and no organization id: those belong on the records that already
 * carry them, and widening a provenance enum into a lookup key is how a
 * category ends up being used as one.
 */
export type AICredentialSourceCategory =
  /** The tenant's own credential. The tenant's vendor account is billed. */
  | 'customer_byok'
  /** MARQ's Cortex-managed credential. MARQ's vendor account is billed. */
  | 'platform_managed'
  /** The deployment's environment variable. */
  | 'environment'
  /** Nothing authenticated this call — the synthetic mock, or a refusal. */
  | 'none';

/**
 * The tenant a resolution is FOR (AI-01 Batch 4D).
 *
 * Built from a resolved `AIOrganization` and from nothing else. The resolver
 * does not accept an organization id as a bare string anywhere, so a call site
 * cannot pass one it read off a request body without first constructing this
 * shape — and the field that makes the shape usable is the one a request body
 * cannot supply.
 */
export interface CredentialTenant {
  readonly organizationId: string;
  /**
   * True when the organization came from a VERIFIED membership.
   *
   * FALSE MEANS NO TENANT, NOT "TRY ANYWAY". `AI_ALLOW_DEFAULT_ORGANIZATION`
   * lets a subject with no membership row land in the deployment's default
   * organization; that is a legitimate single-tenant convenience and it is NOT
   * a statement that this caller belongs to that customer. Honouring a BYOK
   * credential on the strength of it would let an account with no membership
   * anywhere execute on a paying customer's vendor key.
   */
  readonly membershipVerified: boolean;
  /**
   * What this EXECUTION may be funded by (4D remediation, BLOCKER B-1).
   *
   * Resolved once per request from the organization's whole provider estate and
   * carried here, so retries, same-provider retries, cross-provider failover,
   * model fallback and provider selection all read one object rather than
   * re-deriving an answer from whichever provider they happen to be on.
   *
   * The certified defect was exactly that re-derivation: a `tenant_only`
   * organization had no configuration for the SECOND provider, so the absent
   * per-provider policy read as `platform` and MARQ's credential executed their
   * traffic. A per-provider fact cannot express a constraint that has to
   * survive leaving that provider.
   *
   * It is a LATCH, not a constant. The resolver tightens it the moment it
   * observes a `tenant_only` configuration, so the guarantee holds even when
   * the request-level pre-read was unavailable. Nothing widens it.
   *
   * Absent means unconstrained, which is the Batch 4C behaviour and what every
   * caller that never opts into BYOK gets.
   */
  readonly funding?: ExecutionFundingLatch;
}

/**
 * Non-secret facts about a provider's credential state.
 *
 * Everything here is safe in an API response, a log line and an audit record.
 * There is deliberately no field that could carry key material: `fingerprint`
 * is a truncated digest and `lastFour` is at most four characters chosen by
 * the writer, neither of which narrows a search for the secret meaningfully.
 */
export interface ProviderCredentialAvailability {
  readonly providerId: string;
  /** True when SOMETHING would be used to authenticate. */
  readonly configured: boolean;
  readonly source: AICredentialSource;
  /** Managed credentials only. Absent for environment and none. */
  readonly credentialId?: string;
  readonly credentialName?: string;
  /** Truncated digest of the secret. Never the secret, never reversible. */
  readonly fingerprint?: string;
  /** Last four characters, where the vendor's format makes that safe. */
  readonly lastFour?: string;
  readonly createdAt?: string;
  readonly rotatedAt?: string;
  /**
   * True when the deployment ALSO carries an environment variable for this
   * provider. Reported so the console can say "a managed credential is in
   * force; a deployment-managed one also exists" rather than implying the
   * environment value vanished when a managed one was stored.
   */
  readonly environmentCredentialPresent: boolean;
  /** When this snapshot was taken. A stale snapshot is a visible fact. */
  readonly checkedAt: string;
}

/** The secret, plus where it came from. Lives only on the execution path. */
export interface ResolvedProviderCredential {
  readonly secret: string;
  readonly source: 'managed' | 'environment';
  /**
   * WHO manages it (AI-01 Batch 4D). This is the value that reaches the audit
   * record; `source` is kept for the Batch 4C callers that already read it.
   */
  readonly category: AICredentialSourceCategory;
  /** Managed credentials only — carried so an audit record can name the row. */
  readonly credentialId?: string;
  /**
   * The owning tenant, for a customer-managed credential only.
   *
   * Present exactly when `category` is `customer_byok`, and equal to the
   * organization id the caller asked for — a resolver that returned any other
   * value would be returning another tenant's credential, so the equality is
   * asserted at the point of resolution rather than trusted here.
   */
  readonly organizationId?: string;
}

export interface ProviderCredentialResolver {
  /**
   * Non-secret availability, from the current snapshot. Synchronous by
   * contract: every caller of this is on a synchronous path, and making it
   * async would push a database read into the selector.
   */
  describe(providerId: string): ProviderCredentialAvailability;
  /**
   * The secret to execute with, or `undefined` when the provider has none.
   *
   * Reads managed storage at CALL TIME. Nothing here caches plaintext, so a
   * revoked credential stops working on the next request rather than at the
   * end of a cache window.
   *
   * `tenant` (AI-01 Batch 4D) is the AUTHENTICATED organization this execution
   * belongs to. Supplied, the tenant's own credential is considered first;
   * omitted, the resolution is exactly the Batch 4C platform one and no
   * organization-owned row is read at all.
   */
  resolve(
    providerId: string,
    tenant?: CredentialTenant,
  ): Promise<ResolvedProviderCredential | undefined>;
  /**
   * Re-take the non-secret snapshot.
   *
   * `coalesce: true` may join an in-flight refresh and is what the TTL-driven
   * background path uses. The default takes a FRESH read, because a caller that
   * awaits this after writing a credential needs a snapshot that saw the write
   * — joining one that started before it would report the previous state and
   * then stamp it as current.
   */
  refresh(options?: { coalesce?: boolean }): Promise<void>;
  /** Every provider this resolver currently has a snapshot for. */
  snapshot(): readonly ProviderCredentialAvailability[];
}
