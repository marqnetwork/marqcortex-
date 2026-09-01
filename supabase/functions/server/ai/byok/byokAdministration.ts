/**
 * Customer BYOK administration — AI-01 Batch 4D.
 *
 * The surface through which an authorised administrator of a CUSTOMER
 * organization configures their own organization's AI provider credentials.
 *
 *          CUSTOMER ORG ADMIN                    MARQ PLATFORM ADMIN
 *                  |                                     |
 *                  v                                     v
 *        BYOK ADMINISTRATION  <- this module     PROVIDER ADMINISTRATION
 *                  |                                     |
 *                  +------------------+------------------+
 *                                     |
 *                        ONE credential store, ONE cipher
 *                                     |
 *                                     v
 *                        ONE PROVIDER CREDENTIAL RESOLVER
 *                                     |
 *                                     v
 *                            ONE AI CONTROL PLANE
 *
 * TWO ADMINISTRATION SURFACES, ONE OF EVERYTHING BELOW THEM. That is the whole
 * shape of this batch. There is no second store, no second cipher, no second
 * resolver, no second execution path and no second audit trail — a customer's
 * credential is stored by the same code, sealed under the same root key, opened
 * by the same resolver and recorded on the same append-only trail as MARQ's
 * own. What differs is the SCOPE of the rows and WHO may touch them.
 *
 * ── WHAT THIS MODULE CANNOT DO, STRUCTURALLY ──────────────────────────────
 *
 *   IT CANNOT EXECUTE. Its provider knowledge arrives as `ByokProviderCatalogue`
 *   — a function returning non-secret descriptor facts. It holds no control
 *   plane, no registry and no adapter, so there is no object here with an
 *   `invoke` on it. Compare `providerAdministration.ts`, which holds the plane
 *   for its health reads and is kept honest by a source scan; this one cannot
 *   fail that scan because it has nothing to fail it with.
 *
 *   IT CANNOT REACH ANOTHER TENANT. Every storage call it makes is keyed by
 *   `actor.organization.organizationId`, which came from `resolveOrganization`
 *   and therefore from an authenticated membership. There is no method here
 *   that takes an organization id as an argument, so no call site can pass one
 *   it read off a request.
 *
 *   IT CANNOT REACH MARQ'S ESTATE. Every storage call names
 *   `ORGANIZATION_SCOPE`, a module constant. There is no argument, no field and
 *   no request shape that makes this module read or write a `platform` row —
 *   the mirror of the constant `PLATFORM_SCOPE` that keeps the MARQ surface out
 *   of customer rows.
 *
 *   IT CANNOT RETURN A SECRET. There is no `read`, no `reveal`, no
 *   `plaintextOf`. The only method that returns anything credential-shaped
 *   returns `ProviderCredentialMetadata`, a type that structurally has no field
 *   a secret could occupy — and the sealed record never enters this module at
 *   all, because the store's only sealed-material method is `activeCredential`
 *   and nothing here calls it.
 *
 * ── WHAT A CUSTOMER MAY AND MAY NOT CONFIGURE ─────────────────────────────
 *
 * A customer may bring a key for a provider MARQ has REGISTERED, CERTIFIED and
 * ENABLED, and that declares itself credential-manageable. They may not bring
 * one for anything else, and the reason is governance rather than tidiness: if
 * BYOK admitted an uncertified vendor, "bring your own key" would become a way
 * to route governed traffic through a provider MARQ never reviewed, which is
 * the one thing the certification gate exists to prevent.
 *
 * REVOCATION IS THE EXCEPTION AND IS NEVER GATED. A customer may withdraw their
 * credential whatever state the platform is in — provider disabled, provider
 * decertified, storage degraded. Containment that can be blocked by an
 * unrelated platform state is not containment.
 */

import type { Clock } from '../runtime/clock.ts';
import type { IdFactory } from '../contracts/ids.ts';
import type { Logger } from '../observability/logger.ts';
import type { AICertificationStatus } from '../contracts/provider.ts';
import type { AdminAuditWriter } from '../admin/adminAudit.ts';
import type {
  AIByokFallbackPolicy,
  AIProviderConfigurationRecord,
  AIProviderScope,
  ProviderAdministrationStore,
  ProviderCredentialMetadata,
} from '../providers/credentials/credentialStore.ts';
import type { ProviderCredentialResolver } from '../providers/credentials/contracts.ts';
import type { SecretCipher } from '../providers/credentials/secretCipher.ts';
import type { AIByokCapability, ByokActor } from './byokRbac.ts';

import { AIError } from '../contracts/errors.ts';
import { ADMIN_ACTION } from '../admin/adminAudit.ts';
import {
  createAuditedMutationRunner,
  createMutationChain,
} from '../admin/auditedMutation.ts';
import {
  acceptCredentialSecret,
  boundedCredentialName,
} from '../admin/providerAdministration.ts';
import { safeLastFour } from '../providers/credentials/secretCipher.ts';
import {
  decideTenantCredential,
  fallbackPolicyOf,
} from '../providers/credentials/tenantPrecedence.ts';
import { requireByokCapability } from './byokRbac.ts';

/**
 * The scope this module reads and writes. A CONSTANT, never a parameter.
 *
 * The mirror of `PLATFORM_SCOPE` in `providerAdministration.ts`: there is no
 * argument a caller can pass that makes this module touch MARQ's own rows, and
 * no argument a caller can pass to that one that reaches a customer's.
 */
const ORGANIZATION_SCOPE: AIProviderScope = 'organization';

const MIN_REASON_LENGTH = 4;
const MAX_REASON_LENGTH = 500;

// ── Read models ─────────────────────────────────────────────────────────────

/**
 * What this organization's requests currently authenticate with.
 *
 * DELIBERATELY COARSER THAN THE PLATFORM'S OWN VOCABULARY. The runtime
 * distinguishes `platform_managed` from `environment`; a customer is told
 * `platform` for both, because which of MARQ's two arrangements is in force is
 * a fact about MARQ's deployment and not about this customer. Collapsing it
 * here rather than in the console is what makes "the customer is never sent
 * MARQ's credential details" true of the API rather than of a template.
 */
export type ByokEffectiveSource =
  /** This organization's own credential. Their vendor account is billed. */
  | 'customer_byok'
  /** The MARQ platform arrangement, whatever it is. Never described further. */
  | 'platform'
  /** Nothing would authenticate a request for this organization right now. */
  | 'none';

/** The lifecycle state of THIS organization's credential for one provider. */
export type ByokCredentialStatus =
  /** Stored, in force, and what this organization's requests execute on. */
  | 'active'
  /** Stored and deliberately switched off. Nothing executes on it. */
  | 'inactive'
  /** Withdrawn. Restoring service means entering a new credential. */
  | 'revoked'
  /** This organization has never stored one for this provider. */
  | 'not_configured';

/**
 * Non-secret facts about ONE organization's credential for ONE provider.
 *
 * NOTE WHAT IS ABSENT AND NOTE THAT IT CANNOT BE ADDED BY ACCIDENT: there is no
 * `secret`, no `value`, no `encrypted`, no `iv`, no `ct`, no `kid` and no root
 * key identity. The last two are the interesting omissions — a key identity is
 * safe on MARQ's own console, where an operator uses it to find every
 * credential affected by a root key rotation, and it is MARQ deployment
 * information that a customer has no operation for.
 */
export interface ByokCredentialView {
  readonly status: ByokCredentialStatus;
  readonly configured: boolean;
  readonly credentialId?: string;
  readonly credentialName?: string;
  /** Keyed, truncated digest. Identifies a key without revealing one. */
  readonly fingerprint?: string;
  /** At most four characters, and only where the secret was long enough. */
  readonly lastFour?: string;
  readonly secretVersion?: number;
  readonly createdAt?: string;
  readonly rotatedAt?: string;
  readonly revokedAt?: string;
}

export interface ByokProviderView {
  readonly providerId: string;
  readonly displayName: string;
  /** True when calls to this provider spend money at the vendor. */
  readonly billable: boolean;
  /**
   * Whether this organization may configure a credential for this provider.
   *
   * Derived from MARQ's registration, certification and enablement, and from
   * the adapter's own credential policy — never from anything the caller sent.
   */
  readonly available: boolean;
  /** Why not, when it is not. Names a platform STATE, never a platform secret. */
  readonly unavailableReason?: string;
  /**
   * The adapter's own declaration, so the console renders generically.
   *
   * `environmentVariable` is deliberately NOT here. It is the name of a MARQ
   * deployment secret; it is on the platform surface because an operator needs
   * to find it, and it is nothing a customer has an action for.
   */
  readonly credentialPolicy: {
    readonly required: boolean;
    readonly manageable: boolean;
    readonly credentialFormatHint?: string;
  };
  readonly credential: ByokCredentialView;
  /** This organization's own fallback policy. See `AIByokFallbackPolicy`. */
  readonly fallback: AIByokFallbackPolicy;
  /** What this organization's requests authenticate with right now. */
  readonly effectiveSource: ByokEffectiveSource;
  /**
   * Whether MARQ's runtime can execute against this provider AT ALL right now.
   *
   * SEPARATE FROM `effectiveSource`, AND THE SEPARATION IS THE POINT.
   * `effectiveSource` answers "whose key would authenticate a request"; this
   * answers "would a request happen". A stored, active, correctly sealed
   * customer credential is genuinely the key that would be used AND can be
   * accompanied by no requests at all — while `AI_ALLOW_REAL_REQUESTS` is off,
   * or while the platform holds no credential of its own for this provider.
   * Folding the two into one field would force the surface to lie about one of
   * them.
   */
  readonly serviceable: boolean;
  /** Why the runtime cannot serve it. A platform STATE, never a platform secret. */
  readonly unserviceableReason?: string;
  /** One sentence an administrator can act on. Derived from the state above. */
  readonly message: string;
}

/**
 * One entry in THIS organization's own credential history.
 *
 * A SEPARATE TYPE FROM `ProviderCredentialMetadata`, AND THE DIFFERENCE IS THE
 * POINT. The platform's own metadata record carries two fields a customer must
 * not receive:
 *
 *   `keyId`            the identity of the MARQ ROOT KEY the record was sealed
 *                      under. It is safe and useful on MARQ's own console — an
 *                      operator uses it to find every credential affected by a
 *                      root key rotation — and it is a fact about MARQ's
 *                      deployment that a customer has no operation for. Handing
 *                      it out would also let a customer correlate their own
 *                      records with a platform-wide key change they are not
 *                      entitled to observe.
 *
 *   `configurationId`  an internal identifier. Nothing on the customer surface
 *                      takes one — every route names a provider — so it could
 *                      only ever be a value to guess with.
 *
 * A NARROWED SHAPE rather than a delete-before-serialising, so a field added to
 * `ProviderCredentialMetadata` later cannot reach a customer by default. This
 * type has to be edited for that to happen.
 */
export interface ByokCredentialHistoryEntry {
  readonly credentialId: string;
  readonly providerId: string;
  readonly credentialName: string;
  readonly status: 'active' | 'superseded' | 'revoked';
  /** Keyed, truncated digest. Identifies a key without revealing it. */
  readonly fingerprint: string;
  readonly lastFour?: string;
  readonly secretVersion: number;
  readonly createdAt: string;
  readonly rotatedAt?: string;
  readonly revokedAt?: string;
  /** The subject that stored it. This organization's own administrator. */
  readonly createdBy: string;
  readonly revokedBy?: string;
}

export interface ByokSummary {
  /** The organization this answer is about. Resolved, never echoed from input. */
  readonly organizationId: string;
  readonly providers: readonly ByokProviderView[];
  /**
   * Whether this deployment can store a customer credential at all.
   *
   * `blocker` names a DEPLOYMENT state — "secure credential encryption is not
   * configured" — and never a variable name, a key identity or anything else
   * about MARQ's environment. A customer needs to know their submission will
   * fail and whom to ask; they do not need MARQ's configuration.
   */
  readonly credentialStorage: {
    readonly available: boolean;
    readonly blocker?: string;
  };
  readonly generatedAt: string;
}

// ── Dependencies ────────────────────────────────────────────────────────────

/**
 * One provider, as this module is allowed to know it.
 *
 * NON-SECRET DESCRIPTOR FACTS ONLY, and no object with behaviour. This is why
 * the BYOK service cannot execute: there is no adapter here to invoke, no
 * registry to look one up in and no plane to ask.
 */
export interface ByokProviderCatalogueEntry {
  readonly providerId: string;
  readonly displayName: string;
  readonly billable: boolean;
  /** MARQ's governance decision. Copied, never made here. */
  readonly certification: AICertificationStatus;
  /** Whether MARQ has this provider switched on platform-wide. */
  readonly enabled: boolean;
  /**
   * Whether MARQ's RUNTIME can currently select this provider at all
   * (independent certification gate, AI-01 Batch 4D).
   *
   * WHY A CUSTOMER SURFACE NEEDS THIS. Customer BYOK decides WHICH KEY a
   * selected provider executes on; it does not by itself bring a provider into
   * service. The provider selector rejects a provider whose credentials the
   * PLATFORM cannot see, and it rejects every billable provider outright while
   * `AI_ALLOW_REAL_REQUESTS` is false — which is the deployment default. In
   * either state a customer could store a perfectly good credential and have
   * the console tell them, in words, that their requests were now billed to
   * their own vendor account, while every request in fact returned
   * `NO_PROVIDER_AVAILABLE`.
   *
   * A credential console that overstates service is worse than one that
   * understates it: an administrator who believes their key is live stops
   * looking for the reason their AI does not work, and a finance team believes
   * an invoice is coming that never does.
   *
   * IT IS A PLATFORM STATE, NEVER A PLATFORM SECRET. It is one boolean saying
   * whether the runtime can serve this provider. It does not say why, does not
   * distinguish "MARQ holds no key" from "real requests are switched off", and
   * carries nothing about MARQ's own credential, its source or its identity —
   * the same disclosure boundary `unavailableReason` already draws.
   */
  readonly runtimeSelectable: boolean;
  readonly credential: {
    readonly required: boolean;
    readonly manageable: boolean;
    readonly credentialFormatHint?: string;
  };
}

/** Supplied by the host, read on every call so it cannot go stale. */
export type ByokProviderCatalogue = () => readonly ByokProviderCatalogueEntry[];

export interface ByokAdministrationOptions {
  readonly catalogue: ByokProviderCatalogue;
  /**
   * The SAME store the platform surface and the runtime resolver use.
   *
   * Absent, this surface is unavailable rather than isolate-local: a customer
   * credential that does not survive a restart is a credential they will
   * believe they configured.
   */
  readonly store?: ProviderAdministrationStore;
  /** The SAME cipher. Absent or unavailable, nothing is stored. Never a fallback. */
  readonly cipher: SecretCipher;
  /**
   * The runtime resolver, refreshed after a change.
   *
   * Optional and used for ONE thing: `refresh()`, so the platform's own
   * non-secret snapshot is re-taken after a write. Nothing in this module reads
   * the resolver's tenant path — the console's answer is derived from storage
   * and from `decideTenantCredential`, which is the same function the resolver
   * itself asks, so the two cannot disagree.
   */
  readonly credentials?: ProviderCredentialResolver;
  /** The SAME append-only administrative trail. */
  readonly trail: AdminAuditWriter;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly logger: Logger;
}

export interface ByokRequestMeta {
  readonly correlationId?: string;
  readonly clientIp?: string;
}

export interface ByokAdministration {
  /** This organization's provider/credential status. Never a secret. */
  status(actor: ByokActor): Promise<ByokSummary>;
  /**
   * This organization's credential history for one provider. METADATA ONLY.
   *
   * The return type structurally has no field a secret could occupy, so this
   * cannot carry one however it is serialised downstream.
   */
  credentials(
    actor: ByokActor,
    providerId: string,
  ): Promise<readonly ByokCredentialHistoryEntry[]>;
  /**
   * Store this organization's credential, replacing any active one.
   *
   * ONE operation for "configure" and "rotate", because they are one operation:
   * a rotation is a configure that had a predecessor. Two endpoints would
   * differ only in which one a customer is allowed to call when, and getting
   * that wrong means either a rotation that fails because nothing was there or
   * a first credential that fails because something was.
   */
  configureCredential(
    actor: ByokActor,
    providerId: string,
    input: { secret: unknown; credentialName?: unknown },
    reason: unknown,
    meta?: ByokRequestMeta,
  ): Promise<ByokProviderView>;
  /** Withdraw this organization's credential. Never gated on platform state. */
  revokeCredential(
    actor: ByokActor,
    providerId: string,
    credentialId: string,
    reason: unknown,
    meta?: ByokRequestMeta,
  ): Promise<ByokProviderView>;
  /** Choose what this organization falls back to when it has no credential. */
  setFallbackPolicy(
    actor: ByokActor,
    providerId: string,
    fallback: AIByokFallbackPolicy,
    reason: unknown,
    meta?: ByokRequestMeta,
  ): Promise<ByokProviderView>;
}

// ── Implementation ──────────────────────────────────────────────────────────

export function createByokAdministration(
  options: ByokAdministrationOptions,
): ByokAdministration {
  const { clock, ids, logger } = options;

  const withMutationLock = createMutationChain();

  /**
   * A reason, or a rejection.
   *
   * The same rule the platform surface applies, for the same reason: "a
   * customer administrator replaced their organization's vendor key and gave no
   * reason" is not an acceptable audit record, and enforcing it here means the
   * trail never depends on somebody remembering to write one.
   */
  function requireReason(reason: unknown): string {
    const trimmed = typeof reason === 'string' ? reason.trim() : '';
    if (trimmed.length < MIN_REASON_LENGTH) {
      throw new AIError(
        'VALIDATION_FAILED',
        'A reason is required for every provider credential change.',
        { fields: ['reason'] },
      );
    }
    return trimmed.slice(0, MAX_REASON_LENGTH);
  }

  const runAuditedMutation = createAuditedMutationRunner({
    trail: options.trail,
    logger,
    lock: withMutationLock,
    requireReason,
  });

  /** Why customer credential storage is unavailable, or `undefined`. */
  function storageBlocker(): string | undefined {
    if (!options.store) {
      return 'this deployment has no durable provider credential storage configured';
    }
    if (!options.cipher.available) {
      return 'this deployment has no secure credential encryption configured';
    }
    return undefined;
  }

  /**
   * The catalogue entry for a provider, or a rejection.
   *
   * THE CATALOGUE IS THE AUTHORITY on which providers exist. A customer cannot
   * bring a provider into being by naming it in a path segment, so a typo
   * produces a clear refusal rather than a stored configuration for something
   * that will never execute — and a hostile path cannot register an arbitrary
   * vendor.
   */
  function requireCatalogued(providerId: string): ByokProviderCatalogueEntry {
    const entry = options.catalogue().find((provider) => provider.providerId === providerId);
    if (!entry) {
      throw new AIError('PROVIDER_NOT_FOUND', 'That AI provider is not available.', {
        diagnostics: `providerId=${providerId}`,
      });
    }
    return entry;
  }

  /**
   * Whether a customer may configure this provider, and why not when they may
   * not.
   *
   * FOUR GATES, ORDERED MOST-FUNDAMENTAL FIRST, so an administrator is told the
   * ONE thing standing between them and a working credential rather than a list
   * they have to rank themselves.
   */
  function availability(entry: ByokProviderCatalogueEntry): {
    available: boolean;
    reason?: string;
  } {
    if (!entry.credential.required || !entry.credential.manageable) {
      // The synthetic mock is the case. Refused by DESCRIPTOR rather than by a
      // provider-id comparison, so a future keyless adapter is refused too with
      // no edit here.
      return {
        available: false,
        reason: 'this provider does not accept a customer-supplied credential',
      };
    }
    if (entry.certification !== 'certified') {
      // GOVERNANCE, NOT TIDINESS. If BYOK admitted an uncertified vendor,
      // "bring your own key" would become a way to route governed traffic
      // through a provider MARQ never reviewed.
      return {
        available: false,
        reason: `this provider is not certified for governed use (${entry.certification})`,
      };
    }
    if (!entry.enabled) {
      return { available: false, reason: 'this provider is currently switched off' };
    }
    const blocker = storageBlocker();
    if (blocker !== undefined) return { available: false, reason: blocker };
    return { available: true };
  }

  /** This organization's configuration for one provider, or `undefined`. */
  async function tenantConfiguration(
    actor: ByokActor,
    providerId: string,
  ): Promise<AIProviderConfigurationRecord | undefined> {
    if (!options.store) return undefined;
    const record = await options.store.findConfiguration(
      ORGANIZATION_SCOPE,
      providerId,
      // THE AUTHENTICATED ORGANIZATION. Not a parameter of this function, not a
      // field of a request — the actor's own resolved tenant.
      actor.organization.organizationId,
    );
    // BELT AND BRACES. The lookup was tenant-keyed, so a record for another
    // organization is a storage bug rather than an attack — and it is exactly
    // the bug that must not be allowed to become a cross-tenant read.
    if (record && record.organizationId !== actor.organization.organizationId) {
      throw new AIError(
        'TENANT_ISOLATION_VIOLATION',
        'The requested resource belongs to another organization.',
        {
          diagnostics:
            `configuration organization=${record.organizationId ?? 'none'} ` +
            `actor organization=${actor.organization.organizationId}`,
        },
      );
    }
    return record;
  }

  /** This organization's credential metadata for one configuration. */
  async function tenantCredentials(
    configuration: AIProviderConfigurationRecord | undefined,
  ): Promise<readonly ProviderCredentialMetadata[]> {
    if (!options.store || !configuration) return [];
    return options.store.listCredentials(configuration.configurationId);
  }

  /** Narrow one stored metadata record to what a customer may see. */
  function customerHistoryEntry(
    record: ProviderCredentialMetadata,
  ): ByokCredentialHistoryEntry {
    return {
      credentialId: record.credentialId,
      providerId: record.providerKey,
      credentialName: record.credentialName,
      status: record.status,
      fingerprint: record.fingerprint,
      lastFour: record.lastFour,
      secretVersion: record.secretVersion,
      createdAt: record.createdAt,
      rotatedAt: record.rotatedAt,
      revokedAt: record.revokedAt,
      createdBy: record.createdBy,
      revokedBy: record.revokedBy,
    };
  }

  function credentialView(
    configuration: AIProviderConfigurationRecord | undefined,
    history: readonly ProviderCredentialMetadata[],
  ): ByokCredentialView {
    const active = history.find((record) => record.status === 'active');
    if (active) {
      return {
        // A stored, active credential on a configuration the customer has
        // switched off is `inactive`, not `active`: `active` on this view means
        // "this is what your requests execute on", and a disabled configuration
        // executes on nothing of the customer's.
        status: configuration?.enabled === false ? 'inactive' : 'active',
        configured: true,
        credentialId: active.credentialId,
        credentialName: active.credentialName,
        fingerprint: active.fingerprint,
        lastFour: active.lastFour,
        secretVersion: active.secretVersion,
        createdAt: active.createdAt,
        rotatedAt: active.rotatedAt,
      };
    }
    const latest = history[0];
    if (latest) {
      return {
        status: 'revoked',
        configured: false,
        credentialId: latest.credentialId,
        credentialName: latest.credentialName,
        fingerprint: latest.fingerprint,
        lastFour: latest.lastFour,
        secretVersion: latest.secretVersion,
        createdAt: latest.createdAt,
        rotatedAt: latest.rotatedAt,
        revokedAt: latest.revokedAt,
      };
    }
    return { status: 'not_configured', configured: false };
  }

  /**
   * What this organization's requests authenticate with right now.
   *
   * ASKED OF `decideTenantCredential` — THE SAME FUNCTION THE RESOLVER ASKS.
   * Deriving it here independently is how a console ends up reporting "your key
   * is in force" beside traffic still billing MARQ's vendor account.
   */
  function effectiveSource(
    configuration: AIProviderConfigurationRecord | undefined,
    credential: ByokCredentialView,
  ): { source: ByokEffectiveSource; reason: string } {
    const decision = decideTenantCredential({
      configurationPresent: configuration !== undefined,
      configurationEnabled: configuration?.enabled === true,
      activeCredentialPresent: credential.status === 'active',
      fallback: configuration?.credentialFallback,
    });
    if (decision.action === 'tenant') return { source: 'customer_byok', reason: decision.reason };
    if (decision.action === 'platform') return { source: 'platform', reason: decision.reason };
    return { source: 'none', reason: decision.reason };
  }

  /**
   * Whether MARQ's runtime can serve this provider at all, and why not.
   *
   * A PLATFORM STATE. It says the runtime cannot serve requests; it does not
   * say whether that is because MARQ holds no key of its own or because real
   * provider requests are switched off, because a customer has no action for
   * either and neither is theirs to observe.
   */
  function serviceability(entry: ByokProviderCatalogueEntry): {
    serviceable: boolean;
    reason?: string;
  } {
    if (entry.runtimeSelectable) return { serviceable: true };
    return {
      serviceable: false,
      reason:
        'the MARQ platform cannot currently execute requests for this provider, so no ' +
        'request will reach your vendor account until that is resolved',
    };
  }

  function messageFor(
    entry: ByokProviderCatalogueEntry,
    available: { available: boolean; reason?: string },
    credential: ByokCredentialView,
    source: ByokEffectiveSource,
    serviceable: { serviceable: boolean; reason?: string },
  ): string {
    if (credential.status === 'active') {
      // STORED IS NOT THE SAME AS SERVING, and this is the one message where
      // conflating them costs an administrator a working system. Their key IS
      // the key that would authenticate a request; there are no requests.
      if (!serviceable.serviceable) {
        return (
          `Your credential is stored and would authenticate requests to ` +
          `${entry.displayName} — but ${serviceable.reason}. Nothing is being billed to ` +
          `your vendor account.`
        );
      }
      return (
        `In service on your organization's own credential. Requests to ` +
        `${entry.displayName} are billed to your vendor account.`
      );
    }
    if (!available.available) {
      return `Not available for a customer-supplied credential: ${available.reason}.`;
    }
    if (credential.status === 'inactive') {
      return 'Your credential is stored but switched off. Nothing executes on it.';
    }
    if (source === 'none') {
      return (
        'No credential is available for your organization, and your policy is to use your ' +
        'own credential only. Add a credential to bring this provider into service.'
      );
    }
    return credential.status === 'revoked'
      ? 'Your credential was revoked. Requests use the MARQ platform arrangement; ' +
          'add a new credential to bring your own account back into service.'
      : 'No credential is configured for your organization. Requests use the MARQ ' +
          'platform arrangement.';
  }

  async function buildView(actor: ByokActor, providerId: string): Promise<ByokProviderView> {
    const entry = requireCatalogued(providerId);
    const configuration = await tenantConfiguration(actor, providerId);
    const history = await tenantCredentials(configuration);
    return viewFrom(entry, configuration, history);
  }

  function viewFrom(
    entry: ByokProviderCatalogueEntry,
    configuration: AIProviderConfigurationRecord | undefined,
    history: readonly ProviderCredentialMetadata[],
  ): ByokProviderView {
    const available = availability(entry);
    const credential = credentialView(configuration, history);
    const { source } = effectiveSource(configuration, credential);
    const serviceable = serviceability(entry);
    return {
      providerId: entry.providerId,
      displayName: entry.displayName,
      billable: entry.billable,
      available: available.available,
      unavailableReason: available.reason,
      credentialPolicy: {
        required: entry.credential.required,
        manageable: entry.credential.manageable,
        credentialFormatHint: entry.credential.credentialFormatHint,
      },
      credential,
      fallback: fallbackPolicyOf(configuration?.credentialFallback),
      effectiveSource: source,
      serviceable: serviceable.serviceable,
      unserviceableReason: serviceable.reason,
      message: messageFor(entry, available, credential, source, serviceable),
    };
  }

  /**
   * The store, or a rejection naming the deployment state.
   *
   * FAIL CLOSED. There is no branch that stores a credential any other way — no
   * base64, no plaintext column, no "store it now and encrypt later".
   */
  function requireStorage(): ProviderAdministrationStore {
    const blocker = storageBlocker();
    if (blocker !== undefined || !options.store) {
      throw new AIError(
        'INTERNAL_ERROR',
        'Provider credentials cannot be stored in this deployment.',
        { diagnostics: blocker ?? 'no provider credential storage', retryable: false },
      );
    }
    return options.store;
  }

  /**
   * Create this organization's configuration row if it does not exist.
   *
   * Lazy rather than seeded, so the table reflects organizations that actually
   * configured something. Certification is copied FROM THE CATALOGUE, which
   * took it from MARQ's registration — the row records the governance decision
   * rather than making one, and there is no request field that reaches it.
   */
  async function ensureConfiguration(
    actor: ByokActor,
    entry: ByokProviderCatalogueEntry,
    store: ProviderAdministrationStore,
  ): Promise<AIProviderConfigurationRecord> {
    const existing = await tenantConfiguration(actor, entry.providerId);
    if (existing) return existing;

    const at = clock.isoNow();
    const record: AIProviderConfigurationRecord = {
      configurationId: ids.next('pvc'),
      providerKey: entry.providerId,
      displayName: entry.displayName,
      scope: ORGANIZATION_SCOPE,
      organizationId: actor.organization.organizationId,
      enabled: true,
      // The tenant's default is the value that changes nothing about their
      // service if they later revoke: MARQ's arrangement stands behind them
      // unless they deliberately choose otherwise.
      credentialFallback: 'platform',
      certification: entry.certification as AIProviderConfigurationRecord['certification'],
      configuration: {},
      createdAt: at,
      updatedAt: at,
      createdBy: actor.actorId,
      updatedBy: actor.actorId,
    };
    await store.saveConfiguration(record);
    return record;
  }

  /**
   * Facts recorded on the audit trail. NEVER A SECRET.
   *
   * The recorded set is exactly the platform surface's, minus MARQ's deployment
   * facts: the provider, the organization, the credential id, the keyed
   * fingerprint, the status and the policy. The fingerprint is what makes
   * "which key was in force when this happened?" answerable from the trail
   * without the trail ever holding a key.
   */
  async function facts(
    actor: ByokActor,
    providerId: string,
  ): Promise<Record<string, unknown>> {
    let configuration: AIProviderConfigurationRecord | undefined;
    try {
      configuration = await tenantConfiguration(actor, providerId);
    } catch {
      // A `before` read that fails must not replace the caller's own error with
      // a different one. An empty before is the truth: nothing was read.
      return { providerId, organizationId: actor.organization.organizationId };
    }
    const history = await tenantCredentials(configuration);
    const active = history.find((record) => record.status === 'active');
    return {
      providerId,
      organizationId: actor.organization.organizationId,
      configurationId: configuration?.configurationId,
      configured: active !== undefined,
      credentialId: active?.credentialId,
      credentialFingerprint: active?.fingerprint,
      secretVersion: active?.secretVersion,
      fallback: fallbackPolicyOf(configuration?.credentialFallback),
      credentialCount: history.length,
    };
  }

  /** The actor, as the shared audited-mutation runner records it. */
  function auditActor(actor: ByokActor) {
    return {
      actorId: actor.actorId,
      email: actor.email,
      actorRole: 'customer_byok_admin' as const,
      // EXACTLY ONE ORGANIZATION. A BYOK record names the customer it was for,
      // so "which tenant was this?" is answerable from the record alone.
      organizationScope: [actor.organization.organizationId],
    };
  }

  function mutate<T>(
    actor: ByokActor,
    options_: {
      capabilities: readonly AIByokCapability[];
      action: (typeof ADMIN_ACTION)[keyof typeof ADMIN_ACTION];
      providerId: string;
      target: string;
      reason: unknown;
      meta?: ByokRequestMeta;
      run: (reason: string) => Promise<{
        after: Readonly<Record<string, unknown>>;
        result: T;
        action?: (typeof ADMIN_ACTION)[keyof typeof ADMIN_ACTION];
      }>;
    },
  ): Promise<T> {
    return runAuditedMutation(auditActor(actor), {
      action: options_.action,
      reason: options_.reason,
      target: options_.target,
      meta: options_.meta,
      authorize: () => {
        for (const capability of options_.capabilities) requireByokCapability(actor, capability);
      },
      before: () => facts(actor, options_.providerId),
      run: options_.run,
    });
  }

  return {
    async status(actor) {
      requireByokCapability(actor, 'ai.byok.view');
      const organizationId = actor.organization.organizationId;

      // ONE tenant-keyed enumeration, then a lookup per provider from what it
      // returned. The store's `listOrganizationConfigurations` takes the tenant
      // as its only argument, so there is no result set here containing another
      // organization's rows for this code to filter.
      const configurations = options.store
        ? await options.store.listOrganizationConfigurations(organizationId)
        : [];
      const byProvider = new Map(
        configurations
          .filter((record) => record.organizationId === organizationId)
          .map((record) => [record.providerKey, record]),
      );

      const providers: ByokProviderView[] = [];
      for (const entry of options.catalogue()) {
        // Providers this organization can never configure — the synthetic mock
        // — are omitted entirely rather than listed as permanently unavailable.
        // A customer console that nags about something working exactly as
        // designed is a console people learn to ignore.
        if (!entry.credential.required || !entry.credential.manageable) continue;
        const configuration = byProvider.get(entry.providerId);
        const history = await tenantCredentials(configuration);
        providers.push(viewFrom(entry, configuration, history));
      }

      const blocker = storageBlocker();
      return {
        organizationId,
        providers,
        credentialStorage: { available: blocker === undefined, blocker },
        generatedAt: clock.isoNow(),
      };
    },

    async credentials(actor, providerId) {
      requireByokCapability(actor, 'ai.byok.view');
      requireCatalogued(providerId);
      const configuration = await tenantConfiguration(actor, providerId);
      // NARROWED, not forwarded. The store's metadata type has no secret field,
      // so it could not carry one — but it does carry MARQ's root key identity
      // and an internal configuration id, neither of which is a customer's
      // business. Mapped field by field so a field added upstream cannot reach
      // a customer by default. See `ByokCredentialHistoryEntry`.
      return (await tenantCredentials(configuration)).map(customerHistoryEntry);
    },

    configureCredential(actor, providerId, input, reason, meta) {
      return mutate(actor, {
        capabilities: ['ai.byok.manage'],
        action: ADMIN_ACTION.byokConfigured,
        providerId,
        target: `${actor.organization.organizationId}:${providerId}`,
        reason,
        meta,
        run: async () => {
          const entry = requireCatalogued(providerId);

          // TWO REFUSALS, DELIBERATELY DISTINCT, BECAUSE THEY BLAME DIFFERENT
          // PEOPLE.
          //
          // `requireStorage` is a DEPLOYMENT state — no durable storage, or no
          // root key — and it is nobody's input. It raises `INTERNAL_ERROR` so
          // an administrator is not told their perfectly good credential was
          // rejected. Checked FIRST, because a deployment that cannot encrypt
          // could not accept the credential whatever the governance answer.
          //
          // `availability` is a GOVERNANCE state — the provider is uncertified,
          // switched off, or accepts no customer credential — and it is a
          // legitimate 400: the request named something it may not name.
          const store = requireStorage();

          const available = availability(entry);
          if (!available.available) {
            throw new AIError(
              'VALIDATION_FAILED',
              `A credential cannot be stored for this provider: ${available.reason}.`,
              { fields: ['secret'], diagnostics: `providerId=${providerId}` },
            );
          }
          // Validated by the SHARED acceptor, whose refusal names the bounds
          // and never the value.
          const secret = acceptCredentialSecret(input.secret);

          const configuration = await ensureConfiguration(actor, entry, store);
          const previous = (await store.listCredentials(configuration.configurationId)).find(
            (record) => record.status === 'active',
          );
          const credentialId = ids.next('pvk');
          const at = clock.isoNow();

          const sealed = await options.cipher.seal(secret, {
            providerKey: configuration.providerKey,
            scope: configuration.scope,
            credentialId,
            // THE TENANT IS IN THE AAD. This is what makes moving a customer's
            // ciphertext onto another customer's row structurally useless
            // rather than merely difficult: it does not open under a different
            // organization's binding.
            organizationId: configuration.organizationId,
          });
          const fingerprint = await options.cipher.fingerprint(secret);
          const lastFour = safeLastFour(secret);

          // ATOMIC. `putActiveCredential` supersedes the previous active
          // credential and inserts its replacement in ONE operation — one
          // plpgsql transaction in the durable store — so a failed rotation
          // cannot leave this organization with zero active credentials and
          // silently move their traffic onto the platform arrangement while
          // the console reports a successful rotation.
          await store.putActiveCredential({
            credentialId,
            configurationId: configuration.configurationId,
            providerKey: configuration.providerKey,
            credentialName:
              boundedCredentialName(input.credentialName) ?? (previous ? 'rotated' : 'primary'),
            status: 'active',
            fingerprint,
            lastFour,
            secretVersion: (previous?.secretVersion ?? 0) + 1,
            keyId: sealed.kid,
            createdAt: at,
            updatedAt: at,
            rotatedAt: previous ? at : undefined,
            createdBy: actor.actorId,
            sealed,
          });

          // The platform's non-secret snapshot is re-taken so the MARQ console
          // reflects storage at once. It carries no tenant credential — the
          // snapshot is platform-scoped — and this is the only thing this
          // module ever asks the resolver to do.
          await options.credentials?.refresh();

          // The log line names the FINGERPRINT and nothing else about the key.
          logger.info('ai.byok.credential.stored', {
            providerId,
            organizationId: actor.organization.organizationId,
            credentialId,
            fingerprint,
            rotated: previous !== undefined,
          });

          return {
            after: await facts(actor, providerId),
            result: await buildView(actor, providerId),
            action: previous ? ADMIN_ACTION.byokRotated : ADMIN_ACTION.byokConfigured,
          };
        },
      });
    },

    revokeCredential(actor, providerId, credentialId, reason, meta) {
      return mutate(actor, {
        capabilities: ['ai.byok.manage'],
        action: ADMIN_ACTION.byokRevoked,
        providerId,
        target: `${actor.organization.organizationId}:${providerId}:${credentialId}`,
        reason,
        meta,
        run: async () => {
          // DELIBERATELY NOT GATED ON `availability`. A customer may withdraw
          // their credential whatever state the platform is in — provider
          // disabled, provider decertified, certification withdrawn.
          // Containment that an unrelated platform state can block is not
          // containment.
          requireCatalogued(providerId);
          const store = requireStorage();

          const configuration = await tenantConfiguration(actor, providerId);
          if (!configuration) {
            throw new AIError(
              'FEATURE_NOT_FOUND',
              'Your organization has no credential for that provider.',
              { diagnostics: `providerId=${providerId}` },
            );
          }

          // THE CREDENTIAL IS LOOKED UP WITHIN THIS ORGANIZATION'S OWN
          // CONFIGURATION. A credential id belonging to another tenant is not
          // in this list, so it is `FEATURE_NOT_FOUND` — the same answer as an
          // id that does not exist at all, which is the answer that tells a
          // prober nothing.
          const existing = (await store.listCredentials(configuration.configurationId)).find(
            (record) => record.credentialId === credentialId,
          );
          if (!existing) {
            throw new AIError('FEATURE_NOT_FOUND', 'That credential does not exist.', {
              diagnostics:
                `providerId=${providerId} credentialId=${credentialId} ` +
                `organizationId=${actor.organization.organizationId}`,
            });
          }
          if (existing.status === 'revoked') {
            // Idempotent rather than an error: an administrator clicking twice
            // during an incident should get the state they asked for, not a
            // failure that makes them wonder whether the first one worked.
            return {
              after: await facts(actor, providerId),
              result: await buildView(actor, providerId),
            };
          }

          await store.revokeCredential(
            configuration.configurationId,
            credentialId,
            clock.isoNow(),
            actor.actorId,
          );
          await options.credentials?.refresh();

          logger.warn('ai.byok.credential.revoked', {
            providerId,
            organizationId: actor.organization.organizationId,
            credentialId,
            fingerprint: existing.fingerprint,
          });

          return {
            after: await facts(actor, providerId),
            result: await buildView(actor, providerId),
          };
        },
      });
    },

    setFallbackPolicy(actor, providerId, fallback, reason, meta) {
      return mutate(actor, {
        capabilities: ['ai.byok.manage'],
        action: ADMIN_ACTION.byokFallbackChanged,
        providerId,
        target: `${actor.organization.organizationId}:${providerId}`,
        reason,
        meta,
        run: async () => {
          const entry = requireCatalogued(providerId);
          if (fallback !== 'platform' && fallback !== 'tenant_only') {
            throw new AIError('VALIDATION_FAILED', 'Unknown credential fallback policy.', {
              fields: ['fallback'],
            });
          }
          const store = requireStorage();
          const configuration = await ensureConfiguration(actor, entry, store);
          await store.saveConfiguration({
            ...configuration,
            credentialFallback: fallback,
            updatedAt: clock.isoNow(),
            updatedBy: actor.actorId,
          });
          await options.credentials?.refresh();

          logger.info('ai.byok.fallback.changed', {
            providerId,
            organizationId: actor.organization.organizationId,
            fallback,
          });

          return {
            after: await facts(actor, providerId),
            result: await buildView(actor, providerId),
          };
        },
      });
    },
  };
}
