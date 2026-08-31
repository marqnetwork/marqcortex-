/**
 * The provider-neutral credential resolver — AI-01 Batch 4C.
 *
 * ONE resolver, every provider. Before this existed each adapter read its own
 * environment variable inline, which meant adding a managed credential store
 * would have meant adding it twice, then three times, then once per vendor —
 * and the second implementation is always the one that forgets to check
 * revocation.
 *
 * PRECEDENCE, AND WHY IT IS SAFE FOR THE CERTIFIED BASELINE.
 *
 *   1. An ACTIVE managed Cortex credential.
 *   2. The deployment's environment variable, as a bootstrap, migration and
 *      emergency compatibility source.
 *   3. Nothing — the provider is unavailable, and says so.
 *
 * This ORDER cannot change what production does today, and that was the
 * governing constraint rather than a happy accident. Production holds no
 * managed credentials, so rule 1 never matches and every provider resolves
 * exactly where it resolved before Batch 4C: the environment. The Batch 4A
 * OpenAI certification and the Batch 4B Anthropic wiring are therefore
 * unaffected until an administrator deliberately stores a managed credential,
 * which is an authorised, audited act.
 *
 * The environment is NOT removed and NOT migrated. `AI_...` deployment secrets
 * remain a supported source: a deployment whose database is unreachable can
 * still serve, and an operator locked out of the console can still restore
 * service through a deploy. What the environment stops being is the ONLY
 * mechanism.
 *
 * PLAINTEXT IS NEVER CACHED. `describe` — the synchronous availability probe
 * the registry, the selector and the spend guard all call — reads a snapshot
 * that contains fingerprints and timestamps and no key material. `resolve` —
 * called once per attempt, from inside an adapter — reads managed storage and
 * decrypts, every time. That is the whole reason a revoked credential stops
 * working on the next request instead of at the end of a TTL.
 *
 * The snapshot itself is bounded by a TTL and refreshed explicitly after every
 * administrative change, so a stale snapshot can at worst misreport
 * availability for that long, on a screen. It can never authorise an execution:
 * the authority for that is `resolve`, which does not consult it.
 */

import { describeForOperator } from '../../contracts/errors.ts';
import type { Clock } from '../../runtime/clock.ts';
import type { EnvSource } from '../../runtime/env.ts';
import type {
  AICredentialSource,
  ProviderCredentialAvailability,
  ProviderCredentialResolver,
  ResolvedProviderCredential,
} from './contracts.ts';
import type {
  AIProviderScope,
  ProviderAdministrationStore,
} from './credentialStore.ts';
import type { SecretCipher } from './secretCipher.ts';

/**
 * What the resolver needs to know about a provider to resolve for it.
 *
 * Supplied by the provider's own descriptor rather than by a table in this
 * file, so registering a new adapter needs no edit here — the generic
 * administration contract Batch 4C exists to establish.
 */
export interface CredentialProviderProfile {
  readonly providerId: string;
  /** True when the adapter cannot execute without secret material. */
  readonly required: boolean;
  /** True when a managed credential may be stored for this provider. */
  readonly manageable: boolean;
  /** Deployment-managed variable, where the provider supports one. */
  readonly environmentVariable?: string;
}

/** Default staleness bound for the non-secret availability snapshot. */
export const DEFAULT_CREDENTIAL_SNAPSHOT_TTL_MS = 30_000;

function unavailable(providerId: string, checkedAt: string): ProviderCredentialAvailability {
  return {
    providerId,
    configured: false,
    source: 'none',
    environmentCredentialPresent: false,
    checkedAt,
  };
}

function environmentSecret(
  env: EnvSource | undefined,
  profile: CredentialProviderProfile | undefined,
): string | undefined {
  if (!env || !profile?.environmentVariable) return undefined;
  const raw = env.get(profile.environmentVariable);
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined;
}

export interface CredentialResolverOptions {
  /** Provider profiles, keyed by provider id. Derived from descriptors. */
  readonly profiles: readonly CredentialProviderProfile[];
  readonly clock: Clock;
  /** The deployment environment, for the compatibility source. */
  readonly env?: EnvSource;
  /** Managed storage. Absent means environment-only — the pre-4C behaviour. */
  readonly store?: ProviderAdministrationStore;
  /** Required to open a managed credential. Absent means managed is unusable. */
  readonly cipher?: SecretCipher;
  /** Scope this resolver serves. Batch 4C runtime resolves platform only. */
  readonly scope?: AIProviderScope;
  readonly snapshotTtlMs?: number;
  /** Reported when a managed credential exists but cannot be opened. */
  readonly onError?: (providerId: string, detail: string) => void;
}

/**
 * Build the resolver.
 *
 * With no `store` this is exactly an environment reader, which is what every
 * existing test and every current deployment gets. The managed path activates
 * only when a deployment injects storage AND a cipher — two separate things,
 * because a store without a working cipher must not silently degrade into
 * "managed credentials do not work and nobody said so".
 */
export function createProviderCredentialResolver(
  options: CredentialResolverOptions,
): ProviderCredentialResolver {
  const profiles = new Map(options.profiles.map((profile) => [profile.providerId, profile]));
  const scope: AIProviderScope = options.scope ?? 'platform';
  const ttlMs = options.snapshotTtlMs ?? DEFAULT_CREDENTIAL_SNAPSHOT_TTL_MS;
  const managedAvailable = options.store !== undefined && options.cipher?.available === true;

  /** Non-secret managed facts, keyed by provider id. Never holds a secret. */
  let managedSnapshot = new Map<string, ProviderCredentialAvailability>();
  let snapshotAtMs = Number.NEGATIVE_INFINITY;
  let refreshInFlight: Promise<void> | undefined;

  async function takeSnapshot(): Promise<void> {
    if (!managedAvailable || !options.store) {
      managedSnapshot = new Map();
      snapshotAtMs = options.clock.now();
      return;
    }
    const at = options.clock.isoNow();
    const next = new Map<string, ProviderCredentialAvailability>();
    // Any failure here propagates to `refresh`, which catches it, reports it
    // and leaves the previous snapshot in place. A snapshot failure degrades
    // the CONSOLE's view and never execution — `resolve` does not read it.
    const configurations = await options.store.listConfigurations(scope);
    for (const configuration of configurations) {
      const profile = profiles.get(configuration.providerKey);
      if (!profile?.manageable) continue;
      const active = await options.store.activeCredential(configuration.configurationId);
      if (!active) continue;
      next.set(configuration.providerKey, {
        providerId: configuration.providerKey,
        configured: true,
        source: 'managed',
        credentialId: active.credentialId,
        credentialName: active.credentialName,
        fingerprint: active.fingerprint,
        lastFour: active.lastFour,
        createdAt: active.createdAt,
        rotatedAt: active.rotatedAt,
        environmentCredentialPresent: false,
        checkedAt: at,
      });
    }
    managedSnapshot = next;
    snapshotAtMs = options.clock.now();
  }

  /**
   * Re-take the snapshot.
   *
   * `coalesce` is what the TTL-driven background path asks for: ten concurrent
   * requests observing a stale snapshot should produce one storage read, not
   * ten.
   *
   * An EXPLICIT refresh — the one the administration service awaits after
   * storing a credential — must not be coalesced onto an in-flight read that
   * STARTED BEFORE THE WRITE. Doing so returned a promise for the pre-write
   * snapshot and then stamped it as current, so for a full TTL the console
   * reported `deployment_managed` and "rotating it requires a deploy" beside
   * the new credential's own fingerprint, read from durable storage in the same
   * response. A self-contradicting panel immediately after the most
   * security-sensitive action on the surface is the worst moment to have one.
   */
  function refresh(options?: { coalesce?: boolean }): Promise<void> {
    if (options?.coalesce !== true) return startRefresh();
    refreshInFlight ??= startRefresh();
    return refreshInFlight;
  }

  function startRefresh(): Promise<void> {
    const inFlight = takeSnapshot()
      .catch((error: unknown) => {
        // A snapshot failure degrades the CONSOLE's view, never execution:
        // `resolve` reads storage directly and is unaffected. Reported rather
        // than swallowed, because "the console shows no managed credential"
        // and "there is no managed credential" must be distinguishable.
        options.onError?.('snapshot', describeForOperator(error));
        snapshotAtMs = options.clock.now();
      })
      .finally(() => {
        // Only clear the shared slot if it is still this refresh's. An explicit
        // refresh that overtook a background one must not release the other's.
        if (refreshInFlight === inFlight) refreshInFlight = undefined;
      });
    refreshInFlight = inFlight;
    return inFlight;
  }

  function describe(providerId: string): ProviderCredentialAvailability {
    const at = options.clock.isoNow();
    const profile = profiles.get(providerId);
    if (!profile) return unavailable(providerId, at);

    // A provider that needs no credential is CONFIGURED, by definition. The
    // mock adapter is the case, and reporting it as "credentials missing"
    // would put a permanent red state on a console for something working
    // exactly as designed.
    if (!profile.required) {
      return {
        providerId,
        configured: true,
        source: 'none',
        environmentCredentialPresent: false,
        checkedAt: at,
      };
    }

    if (managedAvailable && options.clock.now() - snapshotAtMs > ttlMs) {
      // Deliberately not awaited, and deliberately COALESCED. `describe` is
      // synchronous by contract, and a synchronous caller — the selector, the
      // spend guard — must not be made to wait on storage. The refreshed answer
      // arrives for the next call.
      void refresh({ coalesce: true });
    }

    const environmentPresent = environmentSecret(options.env, profile) !== undefined;
    const managed = managedSnapshot.get(providerId);
    if (managed) return { ...managed, environmentCredentialPresent: environmentPresent, checkedAt: at };

    if (environmentPresent) {
      return {
        providerId,
        configured: true,
        source: 'environment',
        environmentCredentialPresent: true,
        checkedAt: at,
      };
    }
    return unavailable(providerId, at);
  }

  return {
    describe,
    refresh,

    snapshot() {
      return [...profiles.keys()].sort().map(describe);
    },

    async resolve(providerId): Promise<ResolvedProviderCredential | undefined> {
      const profile = profiles.get(providerId);
      if (!profile?.required) return undefined;

      // ── 1. The managed credential, read fresh and decrypted here ──────────
      //
      // Read at execution time rather than from the snapshot, so a credential
      // revoked one second ago is not used one second later.
      //
      // TWO FAILURE MODES HERE, AND THEY MUST NOT BE TREATED THE SAME.
      //
      //   STORAGE IS UNREACHABLE — the database is down, or the `cortex` schema
      //   is not exposed to the API. We learned NOTHING about whether a managed
      //   credential exists, so falling through to the deployment environment
      //   restores exactly the pre-Batch-4C behaviour. That is what makes "a
      //   deployment whose database is unreachable can still serve" true rather
      //   than aspirational: without this catch, a `cortex` schema
      //   misconfiguration would throw out of every adapter attempt, open every
      //   circuit breaker, and take AI down platform-wide in a deployment
      //   holding a perfectly good environment key.
      //
      //   A CREDENTIAL EXISTS AND WILL NOT OPEN — we learned something
      //   definite: an administrator's decision is recorded and we cannot honour
      //   it. Falling through here would mean an operator who rotated a key kept
      //   executing on the old one because the new one failed to decrypt, with
      //   the platform reporting success. So this one refuses.
      if (managedAvailable && options.store && options.cipher) {
        let active: Awaited<ReturnType<ProviderAdministrationStore['activeCredential']>>;
        let configuration: Awaited<ReturnType<ProviderAdministrationStore['findConfiguration']>>;
        try {
          configuration = await options.store.findConfiguration(scope, providerId);
          active =
            configuration && profile.manageable
              ? await options.store.activeCredential(configuration.configurationId)
              : undefined;
        } catch (error) {
          // Storage said nothing. Report it and fall through — see above.
          options.onError?.(
            providerId,
            `managed credential storage is unreachable, falling back to the deployment ` +
              `environment: ${describeForOperator(error)}`,
          );
          configuration = undefined;
          active = undefined;
        }

        if (configuration && active) {
          try {
            const secret = await options.cipher.open(active.sealed, {
              providerKey: configuration.providerKey,
              scope: configuration.scope,
              credentialId: active.credentialId,
              organizationId: configuration.organizationId,
            });
            return { secret, source: 'managed', credentialId: active.credentialId };
          } catch (error) {
            // A credential that exists and cannot be opened. REFUSES rather
            // than falling through — see above.
            //
            // AND REPORTS THE DIAGNOSTIC, NOT JUST THE MESSAGE.
            //
            // `error.message` on this path is always the same generic sentence
            // — 'A stored provider credential cannot be read.' — because it is
            // written for a caller. The fact an operator needs is in
            // `error.diagnostics`, and this site used to drop it: a deployment
            // whose root key had changed logged a sentence that named neither
            // the cause nor the remedy, on the one failure where the remedy is
            // not guessable from the symptom. An independent production gate
            // found it.
            //
            // `describeForOperator` composes both halves. It goes to the
            // deployment's server-side reporting channel and NOWHERE ELSE:
            // `resolve` returns `undefined`, the adapter raises its own
            // caller-facing `PROVIDER_AUTH_FAILED`, and no part of this text
            // reaches a response body. It carries key IDS — non-secret keyed
            // digests — and never a root key, a ciphertext, a provider secret
            // or an authorization header.
            options.onError?.(providerId, describeForOperator(error));
            return undefined;
          }
        }
      }

      // ── 2. Deployment compatibility ───────────────────────────────────────
      const fromEnv = environmentSecret(options.env, profile);
      if (fromEnv !== undefined) return { secret: fromEnv, source: 'environment' };

      // ── 3. Nothing ────────────────────────────────────────────────────────
      return undefined;
    },
  };
}

/**
 * An environment-only resolver for a single provider.
 *
 * The default an adapter constructs when a deployment injects none, so an
 * adapter's behaviour with no resolver supplied is byte-for-byte what it was
 * before Batch 4C. Used by every existing test unchanged.
 */
export function createEnvironmentCredentialResolver(
  profile: CredentialProviderProfile,
  env: EnvSource | undefined,
  clock: Clock,
): ProviderCredentialResolver {
  return createProviderCredentialResolver({ profiles: [profile], env, clock });
}

/** The credential source a health read reports, given an availability record. */
export function credentialSourceOf(
  availability: ProviderCredentialAvailability,
): AICredentialSource {
  return availability.source;
}
