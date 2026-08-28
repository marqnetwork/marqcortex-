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
 */

/** Where the secret material for a provider came from. */
export type AICredentialSource = 'managed' | 'environment' | 'none';

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
  /** Managed credentials only — carried so an audit record can name the row. */
  readonly credentialId?: string;
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
   */
  resolve(providerId: string): Promise<ResolvedProviderCredential | undefined>;
  /** Re-take the non-secret snapshot. Called after an administrative change. */
  refresh(): Promise<void>;
  /** Every provider this resolver currently has a snapshot for. */
  snapshot(): readonly ProviderCredentialAvailability[];
}
