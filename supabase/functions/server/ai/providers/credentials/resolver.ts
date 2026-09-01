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
 *
 * ── AI-01 BATCH 4D — CUSTOMER BYOK, IN THIS FILE AND NOWHERE ELSE ──────────
 *
 * A customer organization may now bring its own vendor key. That is ONE new
 * branch at the top of `resolve`, reached only when the caller supplies an
 * AUTHENTICATED tenant. It is not a second resolver, not a second store and
 * not a second execution path — the whole reason Batch 4C built one
 * provider-neutral resolver was so this could be an argument rather than an
 * architecture.
 *
 * FIVE PROPERTIES OF THE TENANT BRANCH, EACH LOAD-BEARING.
 *
 *   IT IS ONLY REACHED WITH A VERIFIED TENANT. `membershipVerified: false` —
 *   the `AI_ALLOW_DEFAULT_ORGANIZATION` fallback, where a subject with no
 *   membership row lands in the deployment's default organization — is treated
 *   as NO TENANT. Otherwise an account belonging to nobody could execute on a
 *   paying customer's vendor key.
 *
 *   IT LOOKS THE ROW UP BY THE TENANT. `findConfiguration('organization',
 *   providerId, tenant.organizationId)` — there is no query here that returns
 *   rows for more than one organization, so there is nothing to filter and
 *   nothing to forget to filter.
 *
 *   IT VERIFIES THE ROW IT GOT BACK ANYWAY. The organization id on the record
 *   is compared with the one asked for before anything is decrypted. A store
 *   bug that returned the wrong row produces a refusal, not a cross-tenant
 *   execution. And the AAD makes it structurally impossible besides: a
 *   ciphertext sealed for one tenant does not open under another's binding.
 *
 *   IT NEVER FALLS THROUGH ON A FAILED DECRYPT. A tenant whose credential
 *   exists and will not open is REFUSED. Falling through would move that
 *   customer's traffic onto MARQ's vendor account at the exact moment their own
 *   key became unreadable — see `tenantPrecedence.ts`, which owns this rule.
 *
 *   AND IT HONOURS A POLICY IT HAS ALREADY READ. The configuration read and the
 *   credential read are separate, with separate catches, because the second one
 *   runs with the tenant's own fallback policy already in hand. A single catch
 *   answered both with "we learned nothing, fall through", which is true of the
 *   first and false of the second — and the difference was a `tenant_only`
 *   customer being moved onto MARQ's key by a transient read error. See
 *   `resolveTenant`.
 *
 * AND THE PLATFORM PATH IS UNTOUCHED. `resolve(providerId)` with no tenant
 * reads platform-scoped storage and the environment exactly as it did in Batch
 * 4C, and reads no organization-owned row at all. A customer's credential
 * cannot leak into MARQ's own execution because MARQ's own execution never asks
 * a question an organization row could answer.
 */

import { describeForOperator } from '../../contracts/errors.ts';
import type { Clock } from '../../runtime/clock.ts';
import type { EnvSource } from '../../runtime/env.ts';
import type {
  AICredentialSource,
  CredentialTenant,
  ProviderCredentialAvailability,
  ProviderCredentialResolver,
  ResolvedProviderCredential,
} from './contracts.ts';
import type {
  AIProviderConfigurationRecord,
  AIProviderScope,
  ProviderAdministrationStore,
} from './credentialStore.ts';
import type { SecretCipher } from './secretCipher.ts';
import { decideTenantCredential } from './tenantPrecedence.ts';

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

/**
 * The scope a tenant resolution reads (AI-01 Batch 4D).
 *
 * A CONSTANT, not `options.scope`. The resolver's configured scope describes
 * the PLATFORM estate it serves; a tenant branch that reused it would read
 * platform rows the moment somebody constructed a resolver differently, and
 * "the tenant executed on MARQ's key because a constructor argument changed"
 * is not a failure mode worth leaving available.
 */
const ORGANIZATION_SCOPE: AIProviderScope = 'organization';

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

  /**
   * Resolve for ONE authenticated tenant, or say the platform path applies.
   *
   * THE RETURN TYPE CARRIES THREE ANSWERS, AND CONFLATING ANY TWO IS THE BUG
   * THIS BATCH EXISTS TO AVOID:
   *
   *   a credential  This tenant executes on its own key.
   *   `null`        REFUSE. Either the tenant's policy is `tenant_only` and it
   *                 has no usable credential, or it has one that will not open.
   *                 Both are final; neither continues to MARQ's key.
   *   `undefined`   The platform resolution applies. This is what a tenant that
   *                 never opted in gets, on every request, forever.
   *
   * A boolean could not express the middle one, and a thrown error for it would
   * put a tenant policy decision on the same footing as an outage.
   */
  async function resolveTenant(
    providerId: string,
    tenant: CredentialTenant,
    store: ProviderAdministrationStore,
    cipher: SecretCipher,
  ): Promise<ResolvedProviderCredential | null | undefined> {
    // TWO READS, TWO CATCHES, AND THE SPLIT IS THE WHOLE POINT.
    //
    // An independent certification gate found these merged into one `try`, and
    // the merge quietly cost a customer the one guarantee they bought. If the
    // CONFIGURATION read succeeded and the CREDENTIAL read then failed, a single
    // catch discarded a policy it had already read: a `tenant_only`
    // organization — one whose stated policy is that their traffic reaches
    // their vendor account or none — fell through to MARQ's platform key,
    // silently, on a transient read error. The console went on reporting
    // `customer_byok` while the invoice moved.
    //
    // The two failures are not the same failure and must not share an answer:
    //
    //   THE CONFIGURATION READ FAILED. We learned NOTHING — not whether this
    //   tenant has a credential, and not what their fallback policy is. There is
    //   no policy to honour because none was read, so this keeps the Batch 4C
    //   posture: report it and let the pre-existing resolution stand. Refusing
    //   here would take AI down for EVERY tenant — including the overwhelming
    //   majority who never opted into BYOK and for whom refusing buys nothing —
    //   on a `cortex` schema misconfiguration, in a deployment holding a
    //   perfectly good platform key.
    //
    //   THE CREDENTIAL READ FAILED. We DID learn the policy: the configuration
    //   is in hand. So the tenant's own instruction decides, exactly as it does
    //   when the credential is merely absent, and `decideTenantCredential`
    //   answers it from the facts below rather than this catch inventing one.
    let configuration: AIProviderConfigurationRecord | undefined;
    try {
      // KEYED BY THE TENANT. There is no query in this function that can return
      // a row belonging to another organization.
      configuration = await store.findConfiguration(
        ORGANIZATION_SCOPE,
        providerId,
        tenant.organizationId,
      );
    } catch (error) {
      options.onError?.(
        providerId,
        `organization credential storage is unreachable for the authenticated tenant, ` +
          `falling back to the platform resolution: ${describeForOperator(error)}`,
      );
      return undefined;
    }

    let active: Awaited<ReturnType<ProviderAdministrationStore['activeCredential']>>;
    // Tracks WHY there is no active credential, because a policy decision made
    // on an unreadable table must not be recorded as "the customer had none".
    let credentialReadFailed = false;
    try {
      active = configuration
        ? await store.activeCredential(configuration.configurationId)
        : undefined;
    } catch (error) {
      credentialReadFailed = true;
      active = undefined;
      options.onError?.(
        providerId,
        `the authenticated tenant's credential could not be read; their own fallback ` +
          `policy decides what happens next: ${describeForOperator(error)}`,
      );
    }

    // BELT AND BRACES. The lookup was keyed by this tenant, so a mismatch here
    // is a storage bug rather than an attack — and a storage bug that returned
    // another customer's configuration is exactly the one that must not proceed
    // to a decryption attempt. The AAD would refuse it anyway; this refuses it
    // one step earlier, and says why.
    if (configuration && configuration.organizationId !== tenant.organizationId) {
      options.onError?.(
        providerId,
        'organization credential storage returned a configuration for a different tenant; ' +
          'the resolution was refused',
      );
      return null;
    }

    const decision = decideTenantCredential({
      configurationPresent: configuration !== undefined,
      configurationEnabled: configuration?.enabled === true,
      activeCredentialPresent: active !== undefined,
      fallback: configuration?.credentialFallback,
    });

    if (decision.action === 'platform') return undefined;
    if (decision.action === 'fail_closed') {
      // Not an error and not a fallback. The tenant asked for exactly this.
      //
      // The suffix distinguishes the two ways a `tenant_only` tenant reaches
      // here: their credential is genuinely absent, or it could not be read.
      // An operator triaging a customer's outage needs to know which, and the
      // two are indistinguishable from the decision alone.
      options.onError?.(
        providerId,
        `no credential resolved for the authenticated tenant: ${decision.reason}` +
          (credentialReadFailed
            ? ' (its credential could not be read, and its policy forbids the platform credential)'
            : ''),
      );
      return null;
    }

    // `action === 'tenant'`, which the decision only returns when both of these
    // are present. Narrowed rather than asserted, so a future change to the
    // decision cannot turn a missing row into a thrown TypeError on the
    // execution path.
    if (!configuration || !active) return undefined;

    try {
      const secret = await cipher.open(active.sealed, {
        providerKey: configuration.providerKey,
        scope: configuration.scope,
        credentialId: active.credentialId,
        // THE TENANT IS IN THE AAD. A ciphertext copied onto another
        // organization's row does not open, so cross-tenant credential reuse is
        // refused by the cipher and not merely by the query above it.
        organizationId: configuration.organizationId,
      });
      return {
        secret,
        source: 'managed',
        category: 'customer_byok',
        credentialId: active.credentialId,
        organizationId: configuration.organizationId,
      };
    } catch (error) {
      // FAIL CLOSED, AND NEVER ONTO MARQ'S KEY. This tenant HAS a credential
      // and the platform cannot honour it. Continuing to the platform
      // resolution would move their traffic onto MARQ's vendor account at the
      // one moment their own credential became unreadable, while the console
      // went on reporting `customer_byok` from a row that still says `active`.
      //
      // `describeForOperator` composes the diagnostic — key identities and the
      // remedy — for the deployment's server-side log. It reaches no response
      // body: this returns `null`, the adapter raises its own caller-facing
      // PROVIDER_AUTH_FAILED, and no part of this text travels with it.
      options.onError?.(providerId, describeForOperator(error));
      return null;
    }
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

    async resolve(providerId, tenant): Promise<ResolvedProviderCredential | undefined> {
      const profile = profiles.get(providerId);
      if (!profile?.required) return undefined;

      // ── 0. The tenant's own credential (AI-01 Batch 4D) ───────────────────
      //
      // Reached only for a caller that supplied an AUTHENTICATED tenant, and
      // only when this deployment can open a managed credential at all. With no
      // tenant this whole block is skipped and the resolution below is byte for
      // byte the Batch 4C one.
      if (
        tenant !== undefined &&
        // membershipVerified: false is the AI_ALLOW_DEFAULT_ORGANIZATION
        // fallback — an account with no membership row placed in the
        // deployment's default organization. It is not a statement that this
        // caller belongs to that customer, so it buys no access to that
        // customer's vendor key.
        tenant.membershipVerified === true &&
        profile.manageable &&
        managedAvailable &&
        options.store &&
        options.cipher
      ) {
        const decision = await resolveTenant(providerId, tenant, options.store, options.cipher);
        // `undefined` means "this tenant has no usable credential of its own,
        // and its policy permits the platform's" — fall through. Anything else
        // is a final answer, including the deliberate `null` refusal.
        if (decision !== undefined) return decision ?? undefined;
      }

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
            return {
              secret,
              source: 'managed',
              category: 'platform_managed',
              credentialId: active.credentialId,
            };
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
      if (fromEnv !== undefined) {
        return { secret: fromEnv, source: 'environment', category: 'environment' };
      }

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
