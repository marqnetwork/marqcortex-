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

import type { AIProviderAdapter } from '../../contracts/provider.ts';
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
  readonly status: 'registered' | 'refused' | 'already_registered';
  /** Never carries a stored value — only the reasons validation produced. */
  readonly reasons?: readonly string[];
}

export interface SelfHostedHydrationReport {
  readonly attempted: number;
  readonly registered: readonly string[];
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
    return { attempted: 0, registered: [], refused: [], ranAt: options.now() };
  }

  /**
   * Register ONE validated definition, or explain why it was not.
   *
   * The profile is published BEFORE `registry.register`, so there is no instant
   * at which an adapter is selectable while the resolver does not yet know how
   * to answer for it.
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
    if (registered.has(providerId) || registry.find(providerId) !== undefined) {
      return { providerId, status: 'already_registered' };
    }

    const validation = validateSelfHostedDefinition(record, {
      allowPrivateEndpoints: options.allowPrivateEndpoints,
    });
    if (validation.ok !== true) {
      return { providerId, status: 'refused', reasons: validation.reasons };
    }

    const definition = validation.definition;
    // Published first. `profiles()` is read live by the resolver.
    registered.set(providerId, definition);

    let adapter: AIProviderAdapter;
    try {
      adapter = createSelfHostedProvider({
        definition,
        credentials: options.credentials(),
        fetchImpl: options.fetchImpl,
      });
      registry.register(adapter, selfHostedRegistration(definition));
    } catch (error) {
      // Roll the profile back. A profile for a provider that is not registered
      // would make the resolver's snapshot claim a provider the registry does
      // not have, and the console would render a credential form for something
      // that cannot execute.
      registered.delete(providerId);
      return {
        providerId,
        status: 'refused',
        reasons: [error instanceof Error ? error.message : String(error)],
      };
    }

    return { providerId, status: 'registered' };
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
      refused: outcomes.filter((outcome) => outcome.status === 'refused'),
      ranAt: options.now(),
    };

    for (const outcome of next.refused) {
      options.onError?.(
        outcome.providerId,
        `self-hosted provider definition refused: ${(outcome.reasons ?? []).join('; ')}`,
      );
    }
    for (const providerId of next.registered) {
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

  return {
    hydrate() {
      // Single-flight only while a hydration is actually running. Once it has
      // settled the slot is released, so a later call re-reads storage — which
      // is what makes a provider defined after bootstrap reachable without a
      // restart — and `admit` keeps that second pass idempotent.
      inFlight ??= run().finally(() => {
        inFlight = undefined;
      });
      return inFlight;
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
