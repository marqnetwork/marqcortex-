/**
 * Self-hosted provider hydration — AI-01 Batch 4E.
 *
 * `initializeControlPlane()` IS SYNCHRONOUS AND STAYS SYNCHRONOUS. Persisted
 * self-hosted definitions live in a database, reading a database is
 * asynchronous, and making bootstrap async would change the signature every
 * edge entry point calls — a breaking API change to buy a feature that does not
 * need it.
 *
 * So this follows the pattern the platform already uses twice: the credential
 * resolver's snapshot priming and `administration.hydrate()`. Bootstrap starts
 * the plane with the BUILT-IN providers, returns, and hydration lands shortly
 * afterwards.
 *
 * ── WHY THAT WINDOW IS SAFE ────────────────────────────────────────────────
 *
 * Until hydration lands the registry holds exactly what it held before this
 * batch: OpenAI, Anthropic and (by default) the mock. A request served in the
 * window is served by a certified adapter. Nothing degrades, nothing waits, and
 * a hydration that FAILS leaves that same state in place — which is why the
 * failure is loud rather than fatal.
 *
 * ── WHAT REGISTERS, AND WHAT DOES NOT ──────────────────────────────────────
 *
 *   a row with no `runtime` key        skipped in silence. This is every
 *                                      Batch 4C row: OpenAI's and Anthropic's
 *                                      configurations carry `{}`.
 *   a row naming a built-in provider   REFUSED, loudly. A stored row must never
 *                                      be able to repoint a reviewed adapter at
 *                                      a host of somebody's choosing, and this
 *                                      is the check that says so out loud
 *                                      rather than relying on the registry's
 *                                      duplicate error.
 *   a row already registered           skipped. Registration is idempotent, so
 *                                      a second hydration cannot throw.
 *   an invalid definition              REFUSED, with every reason reported. Its
 *                                      endpoint is never dialled, because a
 *                                      descriptor is never built for it.
 *   a valid definition                 registered with the enablement and
 *                                      certification `selfHostedRegistration`
 *                                      derives — see that function: enabled
 *                                      requires certified.
 *
 * ── NO PRIVILEGE IS WIDENED HERE ───────────────────────────────────────────
 *
 * This module reads storage and calls `registry.register`. It never writes a
 * configuration, never stores a credential, never sets a certification and
 * never touches the operational settings overlay. Every governance decision it
 * acts on was already recorded, by an authorised and audited administrator,
 * before this code ran.
 */

import type { AIModelDescriptor, AIProviderAdapter } from '../../contracts/provider.ts';
import type { ProviderRegistry } from '../registry.ts';
import type { ProviderCredentialResolver } from '../credentials/contracts.ts';
import type {
  AIProviderConfigurationRecord,
  ProviderAdministrationStore,
} from '../credentials/credentialStore.ts';
import type { CredentialProviderProfile } from '../credentials/resolver.ts';
import type { FetchLike } from '../openaiProvider.ts';
import type { SelfHostedProviderDefinition } from './definition.ts';
import {
  declaresSelfHostedRuntime,
  RESERVED_PROVIDER_IDS,
  selfHostedCredentialProfile,
  selfHostedRegistration,
  validateSelfHostedDefinition,
} from './definition.ts';
import { createSelfHostedProvider } from '../selfHostedProvider.ts';

export interface SelfHostedHydrationOutcome {
  readonly providerId: string;
  readonly status: 'registered' | 'reconciled' | 'refused' | 'already_registered';
  /** Never carries a stored value — only the reasons validation produced. */
  readonly reasons?: readonly string[];
}

export interface SelfHostedHydrationReport {
  readonly attempted: number;
  readonly registered: readonly string[];
  /** Providers whose stored definition changed and were rebuilt (M-4). */
  readonly reconciled: readonly string[];
  readonly refused: readonly SelfHostedHydrationOutcome[];
  readonly ranAt: string;
}

export interface SelfHostedRegistrarOptions {
  /**
   * Lazily supplied, because the registrar is constructed BEFORE the plane —
   * the credential resolver needs this registrar's profiles, and the plane
   * needs the resolver. A getter breaks the cycle without a mutable module
   * slot.
   */
  readonly registry: () => ProviderRegistry | undefined;
  readonly credentials: () => ProviderCredentialResolver;
  /** Durable storage. Absent, hydration is a no-op and says so. */
  readonly store?: ProviderAdministrationStore;
  /** Off by default. See `AI_SELF_HOSTED_PROVIDERS_ENABLED` in the config. */
  readonly enabled: boolean;
  /** The narrowly-scoped local-development exception. See the endpoint policy. */
  readonly allowPrivateEndpoints?: boolean;
  readonly fetchImpl?: FetchLike;
  readonly now: () => string;
  /**
   * The governed spending-exposure decision, applied to a candidate before it
   * is admitted (AI-01 Batch 4E remediation, M-2).
   *
   * Returns a refusal reason, or `undefined` to admit. INJECTED rather than
   * computed here: the answer needs the feature catalogue, the live provider
   * estate and the deployment's reservation ceiling, and a registrar that
   * acquired those would be a second place the exposure question is answered.
   *
   * It exists because the administration write path refused an over-ceiling
   * definition and HYDRATION did not — so a row written before the ceiling was
   * lowered, or by anything else holding the service role, registered a
   * catalogue that raises the pessimistic hold on every request the platform
   * serves. Absent, no exposure decision is made, which is the pre-remediation
   * behaviour and is correct only for a caller that has no plane.
   */
  readonly admissionGuard?: (candidate: {
    readonly providerId: string;
    readonly models: readonly AIModelDescriptor[];
  }) => string | undefined;
  /** Operator channel. Never carries a stored value or a credential. */
  readonly onError?: (providerId: string, detail: string) => void;
  readonly onRegistered?: (providerId: string, detail: string) => void;
}

export interface SelfHostedRegistrar {
  /**
   * Load, validate and register persisted definitions.
   *
   * IDEMPOTENT AND SINGLE-FLIGHT. Concurrent calls join one storage read, and a
   * definition already registered is skipped rather than re-registered — so
   * neither a second bootstrap in the same isolate nor a hydration that races
   * an administration write can produce the registry's duplicate error.
   */
  hydrate(): Promise<SelfHostedHydrationReport>;
  /**
   * Load, validate and register persisted definitions, GUARANTEEING that the
   * storage read begins after this call (AI-01 Batch 4E remediation, H-2).
   *
   * THE DIFFERENCE FROM `hydrate()` IS THE WHOLE POINT, and it is the Batch 4C
   * M-3 lesson applied to a second component. `hydrate()` coalesces: ten
   * concurrent observers of a cold registry should produce one storage read,
   * not ten. But a caller that has just WRITTEN a row and needs to see it must
   * not be handed a promise for a read that started before the write — an
   * independent certification gate proved that exact interleaving, and the cost
   * was a committed configuration row, an unregistered provider, and a
   * `PROVIDER_NOT_FOUND` reported to the administrator who had just created it.
   *
   * So this waits for any in-flight run to settle and then starts a fresh one.
   * Every caller that has just persisted something uses it; the TTL-free
   * bootstrap path keeps `hydrate()`.
   */
  refresh(): Promise<SelfHostedHydrationReport>;
  /**
   * Credential profiles for every registered self-hosted provider.
   *
   * Read by the shared resolver through `additionalProfiles`, on every call, so
   * a provider registered by hydration can resolve a managed credential without
   * the resolver having been rebuilt.
   */
  profiles(): readonly CredentialProviderProfile[];
  /** The definitions currently registered. Non-secret facts only. */
  definitions(): readonly SelfHostedProviderDefinition[];
  /** The last report, or `undefined` before the first hydration completed. */
  lastReport(): SelfHostedHydrationReport | undefined;
}

export function createSelfHostedRegistrar(
  options: SelfHostedRegistrarOptions,
): SelfHostedRegistrar {
  const registered = new Map<string, SelfHostedProviderDefinition>();
  let inFlight: Promise<SelfHostedHydrationReport> | undefined;
  let report: SelfHostedHydrationReport | undefined;

  function emptyReport(): SelfHostedHydrationReport {
    return { attempted: 0, registered: [], reconciled: [], refused: [], ranAt: options.now() };
  }

  /**
   * A stable digest of what a definition MEANS to the runtime.
   *
   * Compared across hydrations to decide whether a registered provider has to
   * be rebuilt (M-4). It covers exactly the facts that change behaviour — the
   * dialled URL, the credential requirement, priority, the model catalogue and
   * its prices, and the two governed states — and nothing that does not, so a
   * touched `updated_at` does not churn the registry mid-flight.
   */
  function shapeOf(definition: SelfHostedProviderDefinition): string {
    return JSON.stringify([
      definition.endpoint.chatCompletionsUrl,
      definition.credentialRequired,
      definition.priority,
      definition.displayName,
      definition.deploymentId ?? null,
      definition.certification,
      definition.administrativelyEnabled,
      definition.models.map((model) => [
        model.modelId,
        model.promptMicroUsdPer1k,
        model.completionMicroUsdPer1k,
        model.capabilities.textGeneration,
        model.capabilities.structuredOutput,
        model.capabilities.chatCompletions,
        model.capabilities.zeroDataRetention,
        model.capabilities.maxOutputTokens,
        model.capabilities.maxContextTokens,
      ]),
    ]);
  }

  /**
   * Register or RECONCILE one validated definition, or explain why not.
   *
   * ── ORDER OF OPERATIONS, WHICH IS THE DESIGN ────────────────────────────
   *
   *   reserved id       refused before anything is read. A stored row must
   *                     never be able to repoint a reviewed adapter.
   *   validation        the endpoint policy runs BEFORE anything is admitted,
   *                     on every hydration — not only on the write path — so a
   *                     row that reached storage by any other route still
   *                     cannot become a callable endpoint.
   *   exposure          the governed ceiling, applied to the SAME candidate the
   *                     administration surface applies it to (M-2).
   *   admit or replace  a new provider is registered; one whose meaning has
   *                     changed is REBUILT (M-4); one that is unchanged is left
   *                     strictly alone.
   *
   * NOTHING IS WIDENED TRANSIENTLY. A replacement is a single synchronous swap
   * carrying the new definition's own enablement and certification, so there is
   * no instant at which the old adapter is gone and nothing has taken its
   * place, and none at which a provider is enabled beyond what its definition
   * permits.
   */
  function admit(
    record: AIProviderConfigurationRecord,
    registry: ProviderRegistry,
  ): SelfHostedHydrationOutcome {
    const providerId = record.providerKey;

    if (RESERVED_PROVIDER_IDS.includes(providerId)) {
      return {
        providerId,
        status: 'refused',
        reasons: [`${providerId} is a built-in adapter and cannot be defined by a stored row`],
      };
    }

    const known = registered.get(providerId);
    // A provider this registrar does not own but the registry already holds is
    // somebody else's — a built-in registered under a name not on the reserved
    // list, say. Left untouched rather than replaced.
    if (known === undefined && registry.find(providerId) !== undefined) {
      return { providerId, status: 'already_registered' };
    }

    const validation = validateSelfHostedDefinition(record, {
      allowPrivateEndpoints: options.allowPrivateEndpoints,
    });
    if (validation.ok !== true) {
      // FAILS CLOSED IN BOTH DIRECTIONS. A new definition is not admitted; an
      // EXISTING one keeps the last shape that passed, because tearing a
      // working provider down over an edit that does not validate would turn a
      // typo into an outage. The refusal is reported either way.
      return { providerId, status: 'refused', reasons: validation.reasons };
    }

    const definition = validation.definition;

    const exposureRefusal = options.admissionGuard?.({
      providerId,
      models: definition.models,
    });
    if (exposureRefusal !== undefined) {
      return { providerId, status: 'refused', reasons: [exposureRefusal] };
    }

    if (known !== undefined && shapeOf(known) === shapeOf(definition)) {
      return { providerId, status: 'already_registered' };
    }

    const previous = known;
    // Published BEFORE the registry write, so there is no instant at which an
    // adapter is selectable while the resolver cannot answer for it.
    registered.set(providerId, definition);

    let adapter: AIProviderAdapter;
    try {
      adapter = createSelfHostedProvider({
        definition,
        credentials: options.credentials(),
        fetchImpl: options.fetchImpl,
      });
      const registration = selfHostedRegistration(definition);
      if (previous === undefined) registry.register(adapter, registration);
      else registry.replace(adapter, registration);
    } catch (error) {
      // Roll back to exactly the previous state. A profile for a provider the
      // registry does not have would make the resolver's snapshot claim one,
      // and the console would render a credential form for something that
      // cannot execute.
      if (previous === undefined) registered.delete(providerId);
      else registered.set(providerId, previous);
      return {
        providerId,
        status: 'refused',
        reasons: [error instanceof Error ? error.message : String(error)],
      };
    }

    return { providerId, status: previous === undefined ? 'registered' : 'reconciled' };
  }

  async function run(): Promise<SelfHostedHydrationReport> {
    if (!options.enabled) {
      options.onError?.(
        'self_hosted',
        'self-hosted providers are disabled in this deployment ' +
          '(AI_SELF_HOSTED_PROVIDERS_ENABLED); no persisted definition was loaded',
      );
      return emptyReport();
    }
    const registry = options.registry();
    if (!registry) {
      options.onError?.('self_hosted', 'hydration ran before the provider registry existed');
      return emptyReport();
    }
    if (!options.store) {
      options.onError?.(
        'self_hosted',
        'no provider administration store is configured; self-hosted provider definitions ' +
          'cannot be loaded and only built-in providers are registered',
      );
      return emptyReport();
    }

    // THE PLATFORM ENUMERATION, and only that. A self-hosted provider is MARQ
    // infrastructure; there is no call here that can reach an organization-owned
    // row, and a customer cannot define a provider the platform dials.
    const rows = await options.store.listConfigurations('platform');
    const candidates = rows.filter(declaresSelfHostedRuntime);

    const outcomes = candidates.map((record) => admit(record, registry));
    const next: SelfHostedHydrationReport = {
      attempted: candidates.length,
      registered: outcomes
        .filter((outcome) => outcome.status === 'registered')
        .map((outcome) => outcome.providerId),
      reconciled: outcomes
        .filter((outcome) => outcome.status === 'reconciled')
        .map((outcome) => outcome.providerId),
      refused: outcomes.filter((outcome) => outcome.status === 'refused'),
      ranAt: options.now(),
    };

    for (const outcome of next.refused) {
      options.onError?.(
        outcome.providerId,
        `self-hosted provider definition refused: ${(outcome.reasons ?? []).join('; ')}`,
      );
    }
    for (const providerId of [...next.registered, ...next.reconciled]) {
      const definition = registered.get(providerId)!;
      const registration = selfHostedRegistration(definition);
      options.onRegistered?.(
        providerId,
        `registered ${definition.runtime} provider on ${definition.endpoint.host} with ` +
          `${definition.models.length} model(s), certification=${registration.certification}, ` +
          `enabled=${registration.enabled}`,
      );
    }

    report = next;
    return next;
  }

  /** Start a run and hold it in the shared slot until it settles. */
  function start(): Promise<SelfHostedHydrationReport> {
    const attempt = run().finally(() => {
      // Only release the slot if it is still this run's. A refresh that
      // overtook a coalesced hydration must not release the other's.
      if (inFlight === attempt) inFlight = undefined;
    });
    inFlight = attempt;
    return attempt;
  }

  return {
    hydrate() {
      // Single-flight only while a hydration is actually running. Once it has
      // settled the slot is released, so a later call re-reads storage — which
      // is what makes a provider defined after bootstrap reachable without a
      // restart — and `admit` keeps that second pass idempotent.
      inFlight ??= start();
      return inFlight;
    },

    async refresh() {
      // ── THE NON-COALESCING READ (4E remediation, H-2) ───────────────────
      //
      // A caller that has just written a row must observe its own write. The
      // in-flight run may have read storage BEFORE that write, so joining it
      // would return a snapshot that cannot contain the new definition — and
      // the caller would then report failure for something it had successfully
      // persisted. That is Batch 4C's M-3 defect, and this is the same remedy
      // the credential resolver adopted for it.
      //
      // AWAIT, THEN START. The in-flight run is not cancelled: it may be
      // bootstrap's own and other callers are waiting on it. We let it settle —
      // its outcome is irrelevant here, hence the swallow — and then take a
      // fresh read that is guaranteed to begin after this call did.
      const pending = inFlight;
      if (pending !== undefined) {
        await pending.catch(() => undefined);
      }
      return start();
    },

    profiles() {
      return [...registered.values()].map(selfHostedCredentialProfile);
    },

    definitions() {
      return [...registered.values()];
    },

    lastReport() {
      return report;
    },
  };
}
