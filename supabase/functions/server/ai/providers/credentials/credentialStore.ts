/**
 * Managed provider credential storage — the port, and the record it holds.
 *
 * FOUR CONCEPTS, FOUR RECORDS. Batch 4C exists partly to stop the platform
 * collapsing them into one row and one boolean:
 *
 *   configuration   HOW Cortex talks to a provider, and whether MARQ has it
 *                   switched on. One per (scope, provider key).
 *   credential      The secret material authorising that conversation. MANY
 *                   per configuration — primary, rotated, revoked history —
 *                   with exactly one `active` at a time.
 *   model           A model offered through the provider, separately enabled
 *                   and separately certified.
 *   certification   MARQ's governance decision, which is not "a key exists".
 *
 * WHAT THE PORT DELIBERATELY CANNOT DO.
 *
 * There is no `readSecret(credentialId)`. The only method that returns sealed
 * material is `activeCredential`, which is keyed by CONFIGURATION and returns
 * the one credential the runtime would execute with. So there is no shape of
 * call meaning "fetch that particular secret", and the administration service —
 * which never calls it — could not build one if it wanted to.
 *
 * Everything else returns `ProviderCredentialMetadata`, a type that structurally
 * has no field a secret could occupy.
 *
 * SCOPE IS ON EVERY RECORD, FROM THE START. Batch 4C administers PLATFORM-owned
 * providers only, and the administration service refuses any other scope. The
 * schema carries the scope anyway so Batch 4D can add organization-owned
 * credentials by admitting a value, not by reshaping a table that already has
 * production rows in it.
 *
 * ── AI-01 BATCH 4D CASHED THAT IN ──────────────────────────────────────────
 *
 * Customer BYOK adds NO TABLE and NO SECOND STORE. It admits the `organization`
 * value the scope column has always allowed, adds one non-secret policy field
 * (`credentialFallback`) and adds ONE read method — and the shape of that
 * method is the security decision:
 *
 *   `listOrganizationConfigurations(organizationId)` takes the tenant as its
 *   ONLY argument and is the only way to enumerate organization-owned rows.
 *   There is deliberately no `listConfigurations('organization')` that returns
 *   every tenant's rows for a caller to filter afterwards, because a filter a
 *   caller applies is a filter a caller can forget, and forgetting it here
 *   would hand one customer the list of another customer's configured
 *   providers.
 *
 * `listConfigurations(scope)` therefore stays what it was: the PLATFORM
 * enumeration, used by the resolver's non-secret snapshot and by the MARQ
 * console. It is documented and tested as refusing to enumerate tenants.
 */

import type { SealedSecret } from './secretCipher.ts';

/**
 * Who owns a provider configuration.
 *
 * `platform` is MARQ's own. `organization` is reserved for Batch 4D customer
 * BYOK and is REFUSED by every Batch 4C write path — declared here so the
 * storage layer, the RLS policy and the tenant-isolation tests are all written
 * against the final shape rather than retrofitted onto it.
 */
export type AIProviderScope = 'platform' | 'organization';

/**
 * What a tenant's execution falls back to when its own credential is absent
 * (AI-01 Batch 4D).
 *
 * `platform`     The Batch 4C resolution continues behind the tenant's own: a
 *                tenant that has not configured a credential, or has revoked
 *                one, executes on MARQ's platform credential exactly as it did
 *                before this batch. THE DEFAULT, because it is the only value
 *                that changes nothing for a tenant that never opts in.
 *
 * `tenant_only`  The tenant's own credential or nothing. Chosen by a customer
 *                whose policy is that their traffic must reach their vendor
 *                account and no other — revoking their key stops their AI
 *                rather than quietly moving the bill to MARQ.
 *
 * IT IS NOT A SECURITY BOUNDARY BETWEEN TENANTS and must not be read as one.
 * No value of this admits one customer's credential to another customer's
 * execution; that is decided by the organization id, which comes from an
 * authenticated membership. This decides only whether MARQ's own credential
 * stands behind a tenant that has none.
 */
export type AIByokFallbackPolicy = 'platform' | 'tenant_only';

/** MARQ's governance decision about a provider or a model. */
export type AIProviderCertificationState =
  | 'unverified'
  | 'testing'
  | 'certified'
  | 'degraded'
  | 'disabled';

/**
 * A credential's place in the rotation history.
 *
 *   active      The one the runtime executes with. At most one per configuration.
 *   superseded  Replaced by a rotation. Retained so the trail shows what was in
 *               force when, and never resolvable by the runtime.
 *   revoked     Withdrawn deliberately. Never resolvable, and never restorable —
 *               a revoked credential is re-established by entering a new secret.
 */
export type AICredentialStatus = 'active' | 'superseded' | 'revoked';

export interface AIProviderConfigurationRecord {
  readonly configurationId: string;
  readonly providerKey: string;
  readonly displayName: string;
  readonly scope: AIProviderScope;
  /** Set only for `organization` scope. Null for platform-owned records. */
  readonly organizationId?: string;
  readonly enabled: boolean;
  /**
   * What this configuration's execution falls back to (AI-01 Batch 4D).
   *
   * Meaningful only for `organization` scope; a platform row is always
   * `platform`, which the database asserts. Absent is read as `platform` by
   * every consumer, so a Batch 4C row that predates the column behaves exactly
   * as it always has.
   */
  readonly credentialFallback?: AIByokFallbackPolicy;
  readonly certification: AIProviderCertificationState;
  /** Free-form, bounded configuration that is NOT secret. Never key material. */
  readonly configuration: Readonly<Record<string, string>>;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: string;
  readonly updatedBy: string;
}

/**
 * Everything about a credential EXCEPT the secret.
 *
 * This is what the administration API returns, what the console renders and
 * what the audit trail records. Note what it does not contain and note that it
 * cannot: there is no optional `secret`, no `value`, no `encrypted` field for a
 * careless serialiser to spread into a response.
 */
export interface ProviderCredentialMetadata {
  readonly credentialId: string;
  readonly configurationId: string;
  readonly providerKey: string;
  readonly credentialName: string;
  readonly status: AICredentialStatus;
  /** Keyed, truncated digest. Identifies a key without revealing it. */
  readonly fingerprint: string;
  /** Present only when the secret was long enough for four characters to be safe. */
  readonly lastFour?: string;
  /** Increments on every rotation of this credential's slot. */
  readonly secretVersion: number;
  /** Root key identity the secret was sealed under. */
  readonly keyId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly rotatedAt?: string;
  readonly revokedAt?: string;
  readonly createdBy: string;
  readonly revokedBy?: string;
}

/** Metadata plus the sealed material. Produced by writes, read by the runtime. */
export interface StoredProviderCredential extends ProviderCredentialMetadata {
  readonly sealed: SealedSecret;
}

export interface AIProviderModelRecord {
  readonly modelRecordId: string;
  readonly configurationId: string;
  readonly providerKey: string;
  readonly modelId: string;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly certification: AIProviderCertificationState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

/**
 * Durable storage for provider administration.
 *
 * Narrow, domain-shaped operations only — there is no `query(sql)` and no
 * generic upsert, because a generic write is how a caller ends up setting a
 * column the domain has an opinion about.
 */
export interface ProviderAdministrationStore {
  /**
   * Every configuration in a scope.
   *
   * FOR THE PLATFORM SCOPE. Calling it with `organization` returns rows across
   * EVERY tenant, which is why no tenant-facing code path calls it and why the
   * tenant enumeration below exists instead. The Batch 4D administration
   * service does not import this method at all.
   */
  listConfigurations(scope: AIProviderScope): Promise<readonly AIProviderConfigurationRecord[]>;
  /**
   * Every configuration owned by ONE organization (AI-01 Batch 4D).
   *
   * The tenant is the only argument, so there is no shape of call here that
   * means "every tenant's rows, and I will filter". A store implementation that
   * returned a row for another organization would be returning something this
   * signature cannot express a request for.
   */
  listOrganizationConfigurations(
    organizationId: string,
  ): Promise<readonly AIProviderConfigurationRecord[]>;
  findConfiguration(
    scope: AIProviderScope,
    providerKey: string,
    organizationId?: string,
  ): Promise<AIProviderConfigurationRecord | undefined>;
  saveConfiguration(record: AIProviderConfigurationRecord): Promise<void>;

  /** Metadata for every credential of a configuration, newest first. */
  listCredentials(configurationId: string): Promise<readonly ProviderCredentialMetadata[]>;
  /**
   * The one credential the runtime would execute with, sealed.
   *
   * THE ONLY method on this port that returns key material, and it is keyed by
   * configuration rather than by credential id on purpose — see the module
   * comment.
   */
  activeCredential(configurationId: string): Promise<StoredProviderCredential | undefined>;
  /**
   * Store a new credential and make it the active one, marking any previous
   * active credential `superseded` in the SAME operation.
   *
   * One operation because two would leave a window with zero active
   * credentials (the provider goes dark mid-rotation) or two (the runtime has
   * to pick, and any tiebreak is a guess).
   */
  putActiveCredential(record: StoredProviderCredential): Promise<void>;
  /** Withdraw a credential. Irreversible; a new secret is how it comes back. */
  revokeCredential(
    configurationId: string,
    credentialId: string,
    at: string,
    by: string,
  ): Promise<void>;

  listModels(configurationId: string): Promise<readonly AIProviderModelRecord[]>;
  saveModel(record: AIProviderModelRecord): Promise<void>;
}

/**
 * In-memory store with the same semantics as the durable one.
 *
 * Used by tests and by a deployment that has not injected a database port. The
 * second case is reported loudly at bootstrap rather than silently accepted:
 * a credential that does not survive an isolate restart is a credential the
 * operator will believe they configured.
 */
export function createMemoryProviderAdministrationStore(): ProviderAdministrationStore & {
  /** Raw rows, for tests asserting on what storage actually holds. */
  readonly rows: {
    readonly configurations: Map<string, AIProviderConfigurationRecord>;
    readonly credentials: Map<string, StoredProviderCredential>;
    readonly models: Map<string, AIProviderModelRecord>;
  };
} {
  const configurations = new Map<string, AIProviderConfigurationRecord>();
  const credentials = new Map<string, StoredProviderCredential>();
  const models = new Map<string, AIProviderModelRecord>();

  const keyOf = (
    scope: AIProviderScope,
    providerKey: string,
    organizationId?: string,
  ): string => `${scope}:${organizationId ?? '-'}:${providerKey}`;

  function stripSecret(record: StoredProviderCredential): ProviderCredentialMetadata {
    // Destructured rather than spread-and-delete, so a field added to
    // `StoredProviderCredential` later cannot leak by default.
    const { sealed: _sealed, ...metadata } = record;
    return metadata;
  }

  return {
    rows: { configurations, credentials, models },

    listConfigurations(scope) {
      return Promise.resolve(
        [...configurations.values()]
          .filter((record) => record.scope === scope)
          .sort((a, b) => a.providerKey.localeCompare(b.providerKey)),
      );
    },

    listOrganizationConfigurations(organizationId) {
      // BOTH halves of the predicate, deliberately. Matching on the tenant
      // alone would be correct only for as long as `organizationId` stays null
      // on every platform row, and that is a property of a CHECK constraint in
      // another file rather than of this function.
      return Promise.resolve(
        [...configurations.values()]
          .filter(
            (record) =>
              record.scope === 'organization' && record.organizationId === organizationId,
          )
          .sort((a, b) => a.providerKey.localeCompare(b.providerKey)),
      );
    },

    findConfiguration(scope, providerKey, organizationId) {
      return Promise.resolve(configurations.get(keyOf(scope, providerKey, organizationId)));
    },

    saveConfiguration(record) {
      configurations.set(
        keyOf(record.scope, record.providerKey, record.organizationId),
        record,
      );
      return Promise.resolve();
    },

    listCredentials(configurationId) {
      return Promise.resolve(
        [...credentials.values()]
          .filter((record) => record.configurationId === configurationId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map(stripSecret),
      );
    },

    activeCredential(configurationId) {
      return Promise.resolve(
        [...credentials.values()].find(
          (record) => record.configurationId === configurationId && record.status === 'active',
        ),
      );
    },

    putActiveCredential(record) {
      for (const [id, existing] of credentials) {
        if (existing.configurationId === record.configurationId && existing.status === 'active') {
          credentials.set(id, { ...existing, status: 'superseded', updatedAt: record.createdAt });
        }
      }
      credentials.set(record.credentialId, record);
      return Promise.resolve();
    },

    revokeCredential(configurationId, credentialId, at, by) {
      const existing = credentials.get(credentialId);
      if (!existing || existing.configurationId !== configurationId) return Promise.resolve();
      credentials.set(credentialId, {
        ...existing,
        status: 'revoked',
        revokedAt: at,
        revokedBy: by,
        updatedAt: at,
      });
      return Promise.resolve();
    },

    listModels(configurationId) {
      return Promise.resolve(
        [...models.values()]
          .filter((record) => record.configurationId === configurationId)
          .sort((a, b) => a.modelId.localeCompare(b.modelId)),
      );
    },

    saveModel(record) {
      models.set(`${record.configurationId}:${record.modelId}`, record);
      return Promise.resolve();
    },
  };
}
