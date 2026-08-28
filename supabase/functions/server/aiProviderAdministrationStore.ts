/**
 * Supabase-backed provider administration storage — AI-01 Batch 4C.
 *
 * The concrete implementation of `ProviderAdministrationStore`, over the three
 * tables migration `20260828120000_ai_provider_administration.sql` creates. It
 * lives OUTSIDE `ai/` for the reason every other adapter in this codebase does:
 * the control plane's modules take no Supabase dependency, so they stay
 * runnable and testable under plain Node, and the platform-specific piece
 * arrives as an injected port.
 *
 * SERVICE ROLE ONLY, AND THAT IS THE ACCESS CONTROL.
 *
 * `cortex.ai_provider_credential` has row level security enabled and NO POLICY.
 * A browser session token reaches nothing there — not even ciphertext. This
 * module runs as the service role inside the edge function, which is the one
 * context that also holds the decryption key and has the capability check, the
 * mandatory reason and the audit record wrapped around it.
 *
 * WHAT THIS MODULE NEVER DOES.
 *
 *   It never decrypts. It moves a sealed record between the database and the
 *   caller; opening one is `secretCipher.open`, called only from the credential
 *   resolver, only on the execution path.
 *
 *   It never logs a row. A row carries a sealed secret, and a debug log of "the
 *   record I just wrote" is how ciphertext and its binding end up in a log
 *   aggregator together. Errors here carry the operation and the provider, and
 *   nothing from the record.
 *
 *   It never offers a query by credential id that returns key material. The
 *   port's only sealed-material method is `activeCredential`, keyed by
 *   configuration — see the port's own comment.
 *
 * ── DEPLOYMENT PREREQUISITE: THE `cortex` SCHEMA MUST BE EXPOSED ───────────
 *
 * These tables live in `cortex`, not `public`, deliberately: `public` is the
 * browser-reachable schema and credential ciphertext has no business being one
 * misconfigured policy away from it.
 *
 * The cost is that PostgREST only serves schemas it has been told to serve.
 * `supabase/config.toml` already declares `schemas = ["public", "cortex"]`,
 * which covers local and CLI-driven environments; the HOSTED project's
 * Settings → API → Exposed schemas must match, or every call here fails with
 * PostgREST's `PGRST106` and provider administration is unavailable while the
 * rest of the platform runs normally.
 *
 * That failure is loud rather than silent — the message propagates through
 * `fail()` and reaches the console — and it cannot cause a credential to be
 * resolved incorrectly: the resolver treats an unreachable store as "no managed
 * credential" and falls back to the deployment environment, which is exactly
 * the pre-Batch-4C behaviour.
 */

import type {
  AIProviderConfigurationRecord,
  AIProviderModelRecord,
  AIProviderScope,
  ProviderAdministrationStore,
  ProviderCredentialMetadata,
  StoredProviderCredential,
} from './ai/index.ts';
import type { SealedSecret } from './ai/index.ts';

/**
 * The narrow slice of the Supabase client this module uses.
 *
 * Declared structurally rather than importing `SupabaseClient`, so this file
 * takes no client dependency of its own and a test can drive it with an object
 * literal. The same reason `RouteContext` in `aiRoutes.ts` is structural.
 */
export interface ProviderStoreClient {
  schema(name: string): {
    from(table: string): ProviderStoreTable;
    rpc(
      name: string,
      params: Record<string, unknown>,
    ): Promise<{ error: { message: string } | null }>;
  };
}

export interface ProviderStoreTable {
  select(columns: string): ProviderStoreQuery;
  insert(values: Record<string, unknown>): Promise<{ error: { message: string } | null }>;
  update(values: Record<string, unknown>): ProviderStoreFilter;
  upsert(
    values: Record<string, unknown>,
    options?: { onConflict?: string },
  ): Promise<{ error: { message: string } | null }>;
}

export interface ProviderStoreQuery {
  eq(column: string, value: unknown): ProviderStoreQuery;
  is(column: string, value: unknown): ProviderStoreQuery;
  order(column: string, options?: { ascending?: boolean }): ProviderStoreQuery;
  limit(count: number): ProviderStoreQuery;
  maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
  then<R>(
    onfulfilled: (value: {
      data: Record<string, unknown>[] | null;
      error: { message: string } | null;
    }) => R,
  ): Promise<R>;
}

export interface ProviderStoreFilter {
  eq(column: string, value: unknown): ProviderStoreFilter;
  then<R>(onfulfilled: (value: { error: { message: string } | null }) => R): Promise<R>;
}

const SCHEMA = 'cortex';
const CONFIGURATION_TABLE = 'ai_provider_configuration';
const CREDENTIAL_TABLE = 'ai_provider_credential';
const MODEL_TABLE = 'ai_provider_model';

/**
 * Columns read for credential METADATA.
 *
 * Written out rather than `select('*')`, and that is a control rather than a
 * style preference: a metadata read that says `*` returns `encrypted_secret`
 * too, and the sealed record would then flow wherever the metadata flows —
 * into a console response, into a log line, into an error body. The one place
 * that needs the sealed column names it explicitly, below.
 */
const CREDENTIAL_METADATA_COLUMNS =
  'id, configuration_id, credential_name, status, fingerprint, last_four, secret_version, ' +
  'key_id, created_at, updated_at, rotated_at, revoked_at, created_by, revoked_by';

/** The metadata columns plus the sealed record. Used by ONE method. */
const CREDENTIAL_EXECUTION_COLUMNS = `${CREDENTIAL_METADATA_COLUMNS}, encrypted_secret`;

export interface ProviderAdministrationStoreOptions {
  readonly client: ProviderStoreClient;
  /** Reported without the row. Never called with record contents. */
  readonly onError?: (operation: string, detail: string) => void;
}

function fail(operation: string, message: string): never {
  throw new Error(`ai provider administration storage failed (${operation}): ${message}`);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function toConfiguration(row: Record<string, unknown>): AIProviderConfigurationRecord {
  const configuration = row.configuration;
  return {
    configurationId: text(row.id),
    providerKey: text(row.provider_key),
    displayName: text(row.display_name),
    scope: text(row.scope) === 'organization' ? 'organization' : 'platform',
    organizationId: optionalText(row.organization_id),
    enabled: row.enabled === true,
    certification: text(row.certification) as AIProviderConfigurationRecord['certification'],
    configuration:
      typeof configuration === 'object' && configuration !== null && !Array.isArray(configuration)
        ? (configuration as Record<string, string>)
        : {},
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    createdBy: text(row.created_by),
    updatedBy: text(row.updated_by),
  };
}

function toCredentialMetadata(
  row: Record<string, unknown>,
  providerKey: string,
): ProviderCredentialMetadata {
  return {
    credentialId: text(row.id),
    configurationId: text(row.configuration_id),
    providerKey,
    credentialName: text(row.credential_name),
    status: text(row.status) as ProviderCredentialMetadata['status'],
    fingerprint: text(row.fingerprint),
    lastFour: optionalText(row.last_four),
    secretVersion: Number(row.secret_version ?? 1),
    keyId: text(row.key_id),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    rotatedAt: optionalText(row.rotated_at),
    revokedAt: optionalText(row.revoked_at),
    createdBy: text(row.created_by),
    revokedBy: optionalText(row.revoked_by),
  };
}

function toModel(row: Record<string, unknown>, providerKey: string): AIProviderModelRecord {
  return {
    modelRecordId: text(row.id),
    configurationId: text(row.configuration_id),
    providerKey,
    modelId: text(row.model_id),
    displayName: text(row.display_name),
    enabled: row.enabled === true,
    certification: text(row.certification) as AIProviderModelRecord['certification'],
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    updatedBy: text(row.updated_by),
  };
}

export function createSupabaseProviderAdministrationStore(
  options: ProviderAdministrationStoreOptions,
): ProviderAdministrationStore {
  const table = (name: string) => options.client.schema(SCHEMA).from(name);

  /** Provider key for a configuration id, so metadata rows can carry it. */
  const providerKeyCache = new Map<string, string>();

  async function providerKeyOf(configurationId: string): Promise<string> {
    const cached = providerKeyCache.get(configurationId);
    if (cached !== undefined) return cached;
    const { data, error } = await table(CONFIGURATION_TABLE)
      .select('provider_key')
      .eq('id', configurationId)
      .maybeSingle();
    if (error) fail('providerKeyOf', error.message);
    const key = text(data?.provider_key);
    if (key !== '') providerKeyCache.set(configurationId, key);
    return key;
  }

  return {
    async listConfigurations(scope: AIProviderScope) {
      const { data, error } = await table(CONFIGURATION_TABLE)
        .select('*')
        .eq('scope', scope)
        .order('provider_key', { ascending: true });
      if (error) fail('listConfigurations', error.message);
      return (data ?? []).map(toConfiguration);
    },

    async findConfiguration(scope, providerKey, organizationId) {
      let query = table(CONFIGURATION_TABLE)
        .select('*')
        .eq('scope', scope)
        .eq('provider_key', providerKey);
      // `is(null)` rather than `eq(null)`: PostgREST renders `eq` as `= NULL`,
      // which is never true, so a platform row would never be found. The two
      // spellings differ in exactly the case this table's partial unique index
      // depends on.
      query =
        organizationId === undefined
          ? query.is('organization_id', null)
          : query.eq('organization_id', organizationId);
      const { data, error } = await query.maybeSingle();
      if (error) fail('findConfiguration', error.message);
      return data ? toConfiguration(data) : undefined;
    },

    async saveConfiguration(record) {
      const { error } = await table(CONFIGURATION_TABLE).upsert(
        {
          id: record.configurationId,
          provider_key: record.providerKey,
          display_name: record.displayName,
          scope: record.scope,
          organization_id: record.organizationId ?? null,
          enabled: record.enabled,
          certification: record.certification,
          configuration: record.configuration,
          created_at: record.createdAt,
          updated_at: record.updatedAt,
          created_by: record.createdBy,
          updated_by: record.updatedBy,
        },
        { onConflict: 'id' },
      );
      if (error) fail('saveConfiguration', error.message);
      providerKeyCache.set(record.configurationId, record.providerKey);
    },

    async listCredentials(configurationId) {
      const providerKey = await providerKeyOf(configurationId);
      // METADATA COLUMNS ONLY. `encrypted_secret` is not in this projection, so
      // no sealed record exists in this result set to leak downstream.
      const { data, error } = await table(CREDENTIAL_TABLE)
        .select(CREDENTIAL_METADATA_COLUMNS)
        .eq('configuration_id', configurationId)
        .order('created_at', { ascending: false });
      if (error) fail('listCredentials', error.message);
      return (data ?? []).map((row) => toCredentialMetadata(row, providerKey));
    },

    async activeCredential(configurationId) {
      const providerKey = await providerKeyOf(configurationId);
      const { data, error } = await table(CREDENTIAL_TABLE)
        .select(CREDENTIAL_EXECUTION_COLUMNS)
        .eq('configuration_id', configurationId)
        .eq('status', 'active')
        .maybeSingle();
      if (error) fail('activeCredential', error.message);
      if (!data) return undefined;
      const sealed = data.encrypted_secret;
      if (typeof sealed !== 'object' || sealed === null) {
        // A row that exists and cannot be read is reported and treated as
        // absent, so the resolver moves on rather than throwing on the
        // execution path. It never falls back to the environment for a
        // credential that IS configured — that decision is the resolver's, and
        // it refuses.
        options.onError?.('activeCredential', `configuration ${configurationId} has no sealed record`);
        return undefined;
      }
      return {
        ...toCredentialMetadata(data, providerKey),
        sealed: sealed as unknown as SealedSecret,
      } satisfies StoredProviderCredential;
    },

    async putActiveCredential(record) {
      // ONE TRANSACTION, THROUGH ONE FUNCTION CALL.
      //
      // Supersede-then-insert as two PostgREST calls is two transactions, and
      // anything failing between them leaves the configuration with ZERO active
      // credentials — after which the runtime silently resolves the deployment
      // environment variable instead, while the console reports a successful
      // rotation. `cortex.ai_provider_credential_activate` does both statements
      // in one plpgsql body so a failure rolls the supersede back with it.
      //
      // The partial unique index still guarantees at most one active row. What
      // this supplies is atomicity in reaching that state.
      const { error } = await options.client
        .schema(SCHEMA)
        .rpc('ai_provider_credential_activate', {
          p_credential_id: record.credentialId,
          p_configuration_id: record.configurationId,
          p_credential_name: record.credentialName,
          p_encrypted_secret: record.sealed,
          p_key_id: record.keyId,
          p_fingerprint: record.fingerprint,
          p_last_four: record.lastFour ?? null,
          p_secret_version: record.secretVersion,
          p_created_at: record.createdAt,
          p_rotated_at: record.rotatedAt ?? null,
          p_created_by: record.createdBy,
        });
      // The message is the database's, which names constraints and columns and
      // never row values. The sealed record is not in it and is not added.
      if (error) fail('putActiveCredential', error.message);
    },

    async revokeCredential(configurationId, credentialId, at, by) {
      const { error } = await table(CREDENTIAL_TABLE)
        .update({ status: 'revoked', revoked_at: at, revoked_by: by, updated_at: at })
        .eq('configuration_id', configurationId)
        .eq('id', credentialId);
      if (error) fail('revokeCredential', error.message);
    },

    async listModels(configurationId) {
      const providerKey = await providerKeyOf(configurationId);
      const { data, error } = await table(MODEL_TABLE)
        .select('*')
        .eq('configuration_id', configurationId)
        .order('model_id', { ascending: true });
      if (error) fail('listModels', error.message);
      return (data ?? []).map((row) => toModel(row, providerKey));
    },

    async saveModel(record) {
      const { error } = await table(MODEL_TABLE).upsert(
        {
          id: record.modelRecordId,
          configuration_id: record.configurationId,
          model_id: record.modelId,
          display_name: record.displayName,
          enabled: record.enabled,
          certification: record.certification,
          created_at: record.createdAt,
          updated_at: record.updatedAt,
          updated_by: record.updatedBy,
        },
        { onConflict: 'configuration_id,model_id' },
      );
      if (error) fail('saveModel', error.message);
    },
  };
}
