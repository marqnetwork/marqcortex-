/**
 * Provider Administration — AI-01 Batch 4C.
 *
 * The canonical surface through which a MARQ platform administrator manages the
 * platform's AI provider estate: which providers exist, which are switched on,
 * what credential each executes with, which models each may serve, and what all
 * of that means for the governed spending exposure.
 *
 *                        MARQ ADMIN
 *                            |
 *                            v
 *                 PROVIDER ADMINISTRATION   <- this module
 *                            |
 *              +-------------+-------------+
 *              |             |             |
 *         Providers     Credentials      Models
 *              |             |             |
 *              +-------------+-------------+
 *                            v
 *                     AI CONTROL PLANE
 *
 * WHAT THIS MODULE IS NOT, AND THE DISTINCTION IS THE WHOLE BATCH.
 *
 * It does not execute anything. It never calls a provider, never holds a
 * completion and never decides which provider serves a request. It CONFIGURES
 * the control plane, which remains the single execution authority. Every
 * runtime consequence of a change here reaches execution through the same two
 * mechanisms that already existed — the operational settings overlay and the
 * provider credential resolver — and through no third one.
 *
 * SIX CONCEPTS, KEPT APART.
 *
 *   Provider definition   How Cortex talks to a vendor. Owned by the adapter,
 *                         declared in its descriptor, NOT editable here.
 *   Credential            Secret material authorising that conversation.
 *   Model                 A model offered through the provider.
 *   Certification         Whether MARQ permits a provider/model for governed
 *                         use. A GOVERNANCE decision, derived from the
 *                         certified catalogue, never from console input.
 *   Configuration         Whether it is switched on and eligible.
 *   Runtime health        Whether it can execute right now.
 *
 * "Somebody added an API key" is none of these except the second. A console
 * that collapsed them would let a key entry silently certify a vendor.
 *
 * THE SECRET RULES, ENFORCED HERE AND NOWHERE ELSE.
 *
 *   A submitted secret is sealed and forgotten. It is never returned, never
 *   logged, never put in an audit record, never placed in an error and never
 *   held past the call that stored it.
 *
 *   There is NO operation on this service that returns a stored secret. Not for
 *   a super admin, not for the service role, not for a support flow. The only
 *   code that ever opens a sealed record is the credential resolver, on the
 *   execution path, inside an adapter.
 *
 *   `credentials(actor, providerId)` returns METADATA whose type structurally
 *   has no field a secret could occupy.
 */

import type { AIControlPlane } from '../controlPlane.ts';
import type { Clock } from '../runtime/clock.ts';
import type { IdFactory } from '../contracts/ids.ts';
import type { Logger } from '../observability/logger.ts';
import type {
  AICertificationStatus,
  AIModelCapabilities,
} from '../contracts/provider.ts';
import type { AIOperationalSettings } from '../runtime/operationalSettings.ts';
import type { AdminAction } from './adminAudit.ts';
import type { AIAdminActor, AIAdminCapability } from './rbac.ts';
import type {
  AIProviderConfigurationRecord,
  AIProviderModelRecord,
  AIProviderScope,
  ProviderAdministrationStore,
  ProviderCredentialMetadata,
} from '../providers/credentials/credentialStore.ts';
import type { ProviderCredentialResolver } from '../providers/credentials/contracts.ts';
import type { SecretCipher } from '../providers/credentials/secretCipher.ts';
import type { ExposureCatalogueEntry, ExposureReport } from '../policy/exposure.ts';

import { AIError } from '../contracts/errors.ts';
import { ADMIN_ACTION } from './adminAudit.ts';
import { requireCapability } from './rbac.ts';
import { exposureReport, judgeExposureChange } from '../policy/exposure.ts';
import { safeLastFour } from '../providers/credentials/secretCipher.ts';
import { normalizeProviderSetting } from '../runtime/operationalSettings.ts';

/**
 * Batch 4C administers the PLATFORM estate and refuses every other scope.
 *
 * A constant rather than a parameter, so there is no argument a caller can pass
 * that reaches organization-owned rows. Batch 4D widens this deliberately, with
 * its own tenant-isolation tests; until then a request naming another scope is
 * a rejection, not a filter that happens to match nothing.
 */
export const PLATFORM_SCOPE: AIProviderScope = 'platform';

const MAX_CREDENTIAL_NAME = 80;
const MAX_SECRET_LENGTH = 8_192;
const MIN_SECRET_LENGTH = 8;

// ── Read models ─────────────────────────────────────────────────────────────

/** How a provider's credential is managed. Never how to obtain it. */
export type CredentialManagement =
  /** A Cortex-managed credential is in force. Rotatable without a deploy. */
  | 'cortex_managed'
  /** A deployment environment variable is in force. Changing it needs a deploy. */
  | 'deployment_managed'
  /** This provider needs no credential — the synthetic mock. */
  | 'not_required'
  /** Nothing is configured. The provider cannot execute. */
  | 'unconfigured';

export interface ProviderCredentialView {
  readonly configured: boolean;
  readonly source: 'managed' | 'environment' | 'none';
  readonly management: CredentialManagement;
  readonly credentialId?: string;
  readonly credentialName?: string;
  /** Keyed, truncated digest. Identifies a key; never reveals one. */
  readonly fingerprint?: string;
  readonly lastFour?: string;
  readonly createdAt?: string;
  readonly rotatedAt?: string;
  /**
   * True when a deployment variable also exists.
   *
   * Reported so the console can say "a managed credential is in force; a
   * deployment-managed one also exists" instead of implying the environment
   * value disappeared. Its VALUE is never read here and never returned.
   */
  readonly environmentCredentialPresent: boolean;
  /** The variable's NAME, for an operator who needs to find it. Not its value. */
  readonly environmentVariable?: string;
  /** True when a managed credential can be stored at all in this deployment. */
  readonly managedStorageAvailable: boolean;
  /** Why managed storage is unavailable, when it is. Never a secret. */
  readonly managedStorageBlocker?: string;
}

export interface ProviderModelView {
  readonly modelId: string;
  readonly displayName: string;
  /** Declared by the adapter — the platform knows this model exists. */
  readonly known: true;
  /** MARQ permits this provider/model for governed use. */
  readonly certification: AICertificationStatus;
  /** An administrator has switched it on. */
  readonly enabled: boolean;
  /** It survives the administrative allow list AND could be selected. */
  readonly runtimeEligible: boolean;
  readonly isPinnedDefault: boolean;
  readonly promptMicroUsdPer1k: number;
  readonly completionMicroUsdPer1k: number;
  readonly capabilities: AIModelCapabilities;
}

export interface ProviderAdministrationView {
  readonly providerId: string;
  readonly displayName: string;
  readonly priority: number;
  readonly productionReady: boolean;
  readonly billable: boolean;
  /** Declared by the adapter. Drives the console generically. */
  readonly credentialPolicy: {
    readonly required: boolean;
    readonly manageable: boolean;
    readonly environmentVariable?: string;
    readonly credentialFormatHint?: string;
  };
  readonly enabled: boolean;
  readonly certification: AICertificationStatus;
  /** Live operational state, from the registry. */
  readonly health: {
    readonly state: string;
    readonly circuit: 'closed' | 'open' | 'half_open';
    readonly consecutiveFailures: number;
    readonly successCount: number;
    readonly failureCount: number;
    readonly lastLatencyMs?: number;
    readonly lastError?: string;
    readonly lastFailureAt?: string;
    readonly lastRecoveryAt?: string;
    readonly checkedAt: string;
  };
  /** True when the selector would admit this provider right now. */
  readonly eligible: boolean;
  /** Why not, when it would not. The selector's own words. */
  readonly selectionReason: string;
  readonly credential: ProviderCredentialView;
  readonly models: readonly ProviderModelView[];
  readonly modelsAvailable: number;
  readonly modelsEnabled: number;
  /** True when a durable administration record exists for this provider. */
  readonly configurationPersisted: boolean;
  readonly lastConfigurationChangeAt?: string;
  readonly lastConfigurationChangeBy?: string;
  /**
   * One sentence an operator can act on, derived from the state above.
   *
   * Derived rather than stored, so it cannot drift from the facts beside it,
   * and never a message the vendor wrote — provider error text can echo request
   * content.
   */
  readonly message: string;
}

export interface ProviderAdministrationSummary {
  readonly providers: readonly ProviderAdministrationView[];
  /** Governed spending exposure under the CURRENT catalogue. */
  readonly exposure: {
    readonly maxReservationMicroUsd: number;
    readonly maxFeatureId?: string;
    readonly maxProviderId?: string;
    readonly maxModelId?: string;
    readonly ceilingMicroUsd: number;
    readonly withinCeiling: boolean;
  };
  /** Whether managed credentials can be stored in this deployment at all. */
  readonly managedCredentials: {
    readonly available: boolean;
    readonly durable: boolean;
    readonly keyId?: string;
    readonly blocker?: string;
  };
  readonly generatedAt: string;
}

// ── Dependencies ────────────────────────────────────────────────────────────

/**
 * The audited-mutation runner this service borrows from the administration
 * service.
 *
 * Borrowed rather than reimplemented, and that is the point: capability check,
 * mandatory reason, mutation lock, before/after audit record and rejection
 * recording are one implementation shared by every administrative write on the
 * platform. A provider-administration-shaped copy of that machinery would be a
 * second place for the audit record to be forgotten.
 */
export type AdminMutationRunner = <T>(
  actor: AIAdminActor,
  options: {
    capabilities: readonly AIAdminCapability[];
    action: AdminAction;
    reason: unknown;
    target?: string;
    meta?: { readonly correlationId?: string; readonly clientIp?: string };
    before: () => Promise<Readonly<Record<string, unknown>>>;
    run: (reason: string) => Promise<{
      after: Readonly<Record<string, unknown>>;
      result: T;
      configurationVersion?: number;
      action?: AdminAction;
    }>;
  },
) => Promise<T>;

/** Commit a change to the operational settings overlay. Supplied by the host. */
export type SettingsCommit = (
  apply: (base: AIOperationalSettings) => AIOperationalSettings,
  actorId: string,
  reason: string,
) => Promise<AIOperationalSettings>;

export interface ProviderAdministrationOptions {
  readonly plane: AIControlPlane;
  readonly mutate: AdminMutationRunner;
  readonly commitSettings: SettingsCommit;
  /** The live operational overlay. Read on every call, never cached. */
  readonly liveSettings: () => AIOperationalSettings;
  /**
   * Durable storage. Absent, provider administration is READ-ONLY and says so:
   * a credential that does not survive an isolate restart is a credential the
   * operator will believe they configured.
   */
  readonly store?: ProviderAdministrationStore;
  /** Absent or unavailable, credentials cannot be stored. Never a fallback. */
  readonly cipher: SecretCipher;
  /** Refreshed after every credential change so the console reflects it at once. */
  readonly credentials?: ProviderCredentialResolver;
  /** Governed worst-case single-request reservation, in micro-USD. */
  readonly reservationCeilingMicroUsd: number;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly logger: Logger;
}

export interface ProviderAdministration {
  list(actor: AIAdminActor): Promise<ProviderAdministrationSummary>;
  get(actor: AIAdminActor, providerId: string): Promise<ProviderAdministrationView>;
  /** Credential METADATA. There is no operation that returns a secret. */
  credentials(
    actor: AIAdminActor,
    providerId: string,
  ): Promise<readonly ProviderCredentialMetadata[]>;
  setProviderEnabled(
    actor: AIAdminActor,
    providerId: string,
    enabled: boolean,
    reason: unknown,
    meta?: { correlationId?: string; clientIp?: string },
  ): Promise<ProviderAdministrationView>;
  /**
   * Store a credential, replacing any active one.
   *
   * ONE operation for "set" and "rotate", because they are one operation: a
   * rotation is a set that had a predecessor. Two endpoints would differ only
   * in which one an operator is allowed to call when, and getting that wrong
   * means either a rotation that fails because nothing was there or a first
   * credential that fails because something was.
   */
  setCredential(
    actor: AIAdminActor,
    providerId: string,
    input: { secret: unknown; credentialName?: unknown },
    reason: unknown,
    meta?: { correlationId?: string; clientIp?: string },
  ): Promise<ProviderAdministrationView>;
  revokeCredential(
    actor: AIAdminActor,
    providerId: string,
    credentialId: string,
    reason: unknown,
    meta?: { correlationId?: string; clientIp?: string },
  ): Promise<ProviderAdministrationView>;
  setModelEnabled(
    actor: AIAdminActor,
    providerId: string,
    modelId: string,
    enabled: boolean,
    reason: unknown,
    meta?: { correlationId?: string; clientIp?: string },
  ): Promise<ProviderAdministrationView>;
}

// ── Implementation ──────────────────────────────────────────────────────────

function bounded(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed.slice(0, max);
}

export function createProviderAdministration(
  options: ProviderAdministrationOptions,
): ProviderAdministration {
  const { plane, clock, ids, logger } = options;

  /** Why managed credential storage is unavailable, or `undefined`. */
  function managedBlocker(): string | undefined {
    if (!options.store) {
      return 'no durable provider administration storage is configured in this deployment';
    }
    if (!options.cipher.available) {
      return 'secure credential encryption is not configured (AI_CREDENTIAL_ENCRYPTION_KEY)';
    }
    return undefined;
  }

  /**
   * The registered adapter, or a rejection.
   *
   * THE REGISTRY IS THE AUTHORITY on which providers exist. An administrator
   * cannot bring a provider into being by naming it in a request body, so a
   * typo produces a clear refusal rather than a stored configuration for
   * something that will never execute — and, more importantly, a hostile body
   * cannot register an arbitrary endpoint. Batch 4E adds self-hosted providers
   * by adding ADAPTERS, which are reviewed code, not by relaxing this.
   */
  function requireRegistered(providerId: string) {
    const registered = plane.providers.find(providerId);
    if (!registered) {
      throw new AIError('PROVIDER_NOT_FOUND', 'That AI provider is not registered.', {
        diagnostics: `providerId=${providerId}`,
      });
    }
    return registered;
  }

  /**
   * Every model every registered provider DECLARES.
   *
   * This is the catalogue the spend guard reserves against — deliberately, and
   * documented in `spendGuard.ts`: a disabled provider can be enabled between
   * the estimate and the call, so an estimate that assumed otherwise would
   * under-reserve exactly when configuration is in flux. It is therefore the
   * right catalogue for REPORTING the platform's exposure.
   */
  function currentCatalogue(): readonly ExposureCatalogueEntry[] {
    return plane.providers.list().map((provider) => ({
      providerId: provider.descriptor.providerId,
      billable: provider.descriptor.billable,
      models: provider.descriptor.models,
    }));
  }

  /**
   * Every model an administrator has actually left enabled.
   *
   * This is the right catalogue for JUDGING A CHANGE, and the distinction is
   * not academic: comparing a proposed narrowing against the declared catalogue
   * compares a subset to its superset, which can never be larger, which made
   * the exposure guard incapable of refusing anything.
   */
  function effectiveCatalogue(): readonly ExposureCatalogueEntry[] {
    const settings = options.liveSettings();
    return plane.providers.list().map((provider) => {
      const { providerId } = provider.descriptor;
      const allowList = settings.providers[providerId]?.modelAllowList ?? [];
      return {
        providerId,
        billable: provider.descriptor.billable,
        models:
          allowList.length === 0
            ? provider.descriptor.models
            : provider.descriptor.models.filter((model) => allowList.includes(model.modelId)),
      };
    });
  }

  function currentExposure(): ExposureReport {
    return exposureReport(plane.catalog.list(), currentCatalogue());
  }

  async function storedConfiguration(
    providerId: string,
  ): Promise<AIProviderConfigurationRecord | undefined> {
    if (!options.store) return undefined;
    return options.store.findConfiguration(PLATFORM_SCOPE, providerId);
  }

  async function storedModels(
    configurationId: string | undefined,
  ): Promise<readonly AIProviderModelRecord[]> {
    if (!options.store || configurationId === undefined) return [];
    return options.store.listModels(configurationId);
  }

  /**
   * The operational message, derived from state.
   *
   * Ordered most-blocking first, so an operator is told the ONE thing standing
   * between this provider and serving traffic rather than a list they have to
   * rank themselves.
   */
  function messageFor(
    view: Omit<ProviderAdministrationView, 'message'>,
  ): string {
    if (!view.enabled) return 'Disabled by an administrator. It will not serve traffic.';
    if (view.certification === 'disabled') return 'Certification withdrawn. It will not serve traffic.';
    if (view.credentialPolicy.required && !view.credential.configured) {
      return view.credential.managedStorageAvailable
        ? 'No credential is configured. Add one to bring this provider into service.'
        : `No credential is configured, and managed storage is unavailable: ${
            view.credential.managedStorageBlocker ?? 'unknown reason'
          }.`;
    }
    if (view.health.circuit === 'open') {
      return 'The circuit breaker is open after repeated failures. It will retry automatically.';
    }
    // CERTIFICATION IS CHECKED BEFORE MODEL ELIGIBILITY, and the order is the
    // whole point. An uncertified provider has no eligible models BECAUSE it is
    // uncertified, so reporting the symptom first would tell an operator to
    // "enable a certified model" on a provider where no model can be certified
    // — an instruction that cannot be followed. The synthetic mock is the
    // standing example: it works exactly as designed and is deliberately not
    // certified, and a console that nagged about it would be a console people
    // learn to ignore.
    if (view.certification !== 'certified') {
      return view.productionReady
        ? `Not certified for governed use (${view.certification}). It will not serve traffic.`
        : `A non-production provider, certified as "${view.certification}". ` +
            'It serves only where a certified provider cannot.';
    }
    if (view.modelsEnabled === 0) {
      return 'No model is currently eligible. Enable a certified model to bring it into service.';
    }
    if (!view.eligible) return `Not currently eligible: ${view.selectionReason}.`;
    if (view.credential.source === 'environment') {
      // NAMED, and named for a specific failure. An operator who has just
      // REVOKED a managed credential is still being served — by the deployment
      // variable the runtime falls back to. That is correct behaviour and a
      // dangerous thing to leave implied: revocation reads as containment, and
      // if the environment holds the same vendor key it has contained nothing.
      // So the message says which variable is in force and that Cortex cannot
      // withdraw it.
      const variable = view.credential.environmentVariable ?? 'a deployment variable';
      return (
        `In service on the deployment-managed credential ${variable}. ` +
        'Cortex cannot rotate or revoke it — that requires a deploy. ' +
        'To take this provider out of service now, disable the provider.'
      );
    }
    return 'In service.';
  }

  async function buildView(providerId: string): Promise<ProviderAdministrationView> {
    const registered = requireRegistered(providerId);
    const descriptor = registered.descriptor;
    const settings = options.liveSettings();
    const health = plane.providers.health(providerId);
    const selection = plane.health().selection;
    const setting = settings.providers[providerId];
    const allowList = setting?.modelAllowList ?? [];
    const permitted = new Set(plane.providers.models(providerId).map((model) => model.modelId));

    const configuration = await storedConfiguration(providerId);
    const modelRecords = await storedModels(configuration?.configurationId);
    const modelState = new Map(modelRecords.map((record) => [record.modelId, record]));

    const blocker = managedBlocker();

    const credentialView: ProviderCredentialView = {
      configured: health.credentialsConfigured,
      source: health.credentialSource,
      management: !descriptor.credential.required
        ? 'not_required'
        : health.credentialSource === 'managed'
          ? 'cortex_managed'
          : health.credentialSource === 'environment'
            ? 'deployment_managed'
            : 'unconfigured',
      fingerprint: health.credentialFingerprint,
      environmentCredentialPresent: false,
      environmentVariable: descriptor.credential.environmentVariable,
      managedStorageAvailable: descriptor.credential.manageable && blocker === undefined,
      managedStorageBlocker: descriptor.credential.manageable ? blocker : undefined,
    };

    // Managed metadata, when there is a managed credential. Read from storage
    // rather than from the resolver's snapshot so the console shows the
    // durable truth, and NEVER including the sealed record.
    let enriched = credentialView;
    if (options.store && configuration) {
      const active = (await options.store.listCredentials(configuration.configurationId)).find(
        (record) => record.status === 'active',
      );
      const availability = options.credentials?.describe(providerId);
      enriched = {
        ...credentialView,
        environmentCredentialPresent: availability?.environmentCredentialPresent ?? false,
        ...(active === undefined
          ? {}
          : {
              credentialId: active.credentialId,
              credentialName: active.credentialName,
              fingerprint: active.fingerprint,
              lastFour: active.lastFour,
              createdAt: active.createdAt,
              rotatedAt: active.rotatedAt,
            }),
      };
    } else {
      const availability = options.credentials?.describe(providerId);
      enriched = {
        ...credentialView,
        environmentCredentialPresent: availability?.environmentCredentialPresent ?? false,
      };
    }

    // MODEL CERTIFICATION IS DERIVED, NOT ADMINISTERED.
    //
    // A model is certified when the adapter DECLARES it and the provider itself
    // is certified. The declared catalogue is the curated one — Batch 4B
    // withdrew Sonnet from the Anthropic adapter precisely so it could not be
    // selected — so deriving from it means the console cannot certify a model
    // by having somebody type its name, and cannot silently re-add one either.
    const models: ProviderModelView[] = descriptor.models.map((model) => {
      const record = modelState.get(model.modelId);
      const certified = registered.certification === 'certified';
      const certification: AICertificationStatus = certified
        ? 'certified'
        : registered.certification;
      // ENABLED IS READ FROM THE RUNTIME, NOT FROM THE STORED ROW.
      //
      // The allow list in the operational overlay is what the selector actually
      // consults; the stored model row is the administration RECORD of who
      // changed it and when. The two are written together here, but they can
      // still be moved apart — the Batch 2 `PATCH /ai/admin/providers/:id`
      // surface can clear an allow list without touching a model row — and when
      // they disagree the console must show what the platform will do, not what
      // somebody once asked for. Deriving from the allow list makes that
      // divergence unrepresentable rather than merely unlikely.
      const enabled =
        allowList.length === 0 ? permitted.has(model.modelId) : allowList.includes(model.modelId);
      return {
        modelId: model.modelId,
        displayName: record?.displayName ?? model.modelId,
        known: true as const,
        certification,
        enabled,
        runtimeEligible: enabled && permitted.has(model.modelId) && certified && registered.enabled,
        isPinnedDefault: settings.defaultModelId === model.modelId,
        promptMicroUsdPer1k: model.promptMicroUsdPer1k,
        completionMicroUsdPer1k: model.completionMicroUsdPer1k,
        capabilities: model.capabilities,
      };
    });

    const base: Omit<ProviderAdministrationView, 'message'> = {
      providerId,
      displayName: descriptor.displayName,
      priority: descriptor.priority,
      productionReady: descriptor.productionReady,
      billable: descriptor.billable,
      credentialPolicy: {
        required: descriptor.credential.required,
        manageable: descriptor.credential.manageable,
        environmentVariable: descriptor.credential.environmentVariable,
        credentialFormatHint: descriptor.credential.credentialFormatHint,
      },
      enabled: registered.enabled,
      certification: registered.certification,
      health: {
        state: health.state,
        circuit: health.circuit,
        consecutiveFailures: health.consecutiveFailures,
        successCount: health.successCount,
        failureCount: health.failureCount,
        lastLatencyMs: health.lastLatencyMs,
        lastError: health.lastError,
        lastFailureAt: health.lastFailureAt,
        lastRecoveryAt: health.lastRecoveryAt,
        checkedAt: health.checkedAt,
      },
      eligible: (selection[providerId] ?? 'not evaluated') === 'eligible',
      selectionReason: selection[providerId] ?? 'not evaluated',
      credential: enriched,
      models,
      modelsAvailable: models.length,
      modelsEnabled: models.filter((model) => model.runtimeEligible).length,
      configurationPersisted: configuration !== undefined,
      lastConfigurationChangeAt: configuration?.updatedAt,
      lastConfigurationChangeBy: configuration?.updatedBy,
    };

    return { ...base, message: messageFor(base) };
  }

  /**
   * Create the durable configuration row if it does not exist.
   *
   * Lazy rather than seeded, so the table reflects providers somebody actually
   * administered. Certification is copied FROM THE REGISTRY, which took it from
   * the deployment's own registration — the row records the governance decision
   * rather than making one.
   */
  async function ensureConfiguration(
    providerId: string,
    actorId: string,
  ): Promise<AIProviderConfigurationRecord> {
    if (!options.store) {
      throw new AIError(
        'INTERNAL_ERROR',
        'Provider administration storage is not configured in this deployment.',
        {
          diagnostics: 'no ProviderAdministrationStore was injected at bootstrap',
          retryable: false,
        },
      );
    }
    const existing = await options.store.findConfiguration(PLATFORM_SCOPE, providerId);
    if (existing) return existing;

    const registered = requireRegistered(providerId);
    const at = clock.isoNow();
    const record: AIProviderConfigurationRecord = {
      configurationId: ids.next('pvc'),
      providerKey: providerId,
      displayName: registered.descriptor.displayName,
      scope: PLATFORM_SCOPE,
      enabled: registered.enabled,
      certification: registered.certification,
      configuration: {},
      createdAt: at,
      updatedAt: at,
      createdBy: actorId,
      updatedBy: actorId,
    };
    await options.store.saveConfiguration(record);
    return record;
  }

  /** Facts recorded on the audit trail before a change. Never a secret. */
  async function providerFacts(providerId: string): Promise<Record<string, unknown>> {
    const registered = plane.providers.find(providerId);
    const settings = options.liveSettings();
    const configuration = await storedConfiguration(providerId);
    const health = registered ? plane.providers.health(providerId) : undefined;
    let activeCredentialId: string | undefined;
    let activeFingerprint: string | undefined;
    if (options.store && configuration) {
      const active = (await options.store.listCredentials(configuration.configurationId)).find(
        (record) => record.status === 'active',
      );
      activeCredentialId = active?.credentialId;
      activeFingerprint = active?.fingerprint;
    }
    return {
      providerId,
      enabled: registered?.enabled,
      certification: registered?.certification,
      credentialSource: health?.credentialSource,
      credentialId: activeCredentialId,
      // The FINGERPRINT, which identifies a key without revealing it. This is
      // the field that makes "which key was in force when this happened?"
      // answerable from the trail without the trail ever holding a key.
      credentialFingerprint: activeFingerprint,
      modelAllowList: (settings.providers[providerId]?.modelAllowList ?? []).join(','),
      configurationId: configuration?.configurationId,
    };
  }

  /** Persist an administered enable/disable to BOTH authorities, together. */
  async function commitProviderState(
    providerId: string,
    patch: { enabled?: boolean; modelAllowList?: readonly string[] },
    actorId: string,
    reason: string,
  ): Promise<AIOperationalSettings> {
    const applied = await options.commitSettings(
      (base) => ({
        ...base,
        providers: {
          ...base.providers,
          [providerId]: normalizeProviderSetting(base.providers[providerId], patch),
        },
      }),
      actorId,
      reason,
    );
    plane.applySettings();
    return applied;
  }

  return {
    async list(actor) {
      requireCapability(actor, 'ai.providers.view');
      await plane.refreshSettings();
      const providers: ProviderAdministrationView[] = [];
      for (const provider of plane.providers.list()) {
        providers.push(await buildView(provider.descriptor.providerId));
      }
      const exposure = currentExposure();
      const blocker = managedBlocker();
      return {
        providers,
        exposure: {
          maxReservationMicroUsd: exposure.maxReservationMicroUsd,
          maxFeatureId: exposure.maxFeatureId,
          maxProviderId: exposure.maxProviderId,
          maxModelId: exposure.maxModelId,
          ceilingMicroUsd: options.reservationCeilingMicroUsd,
          withinCeiling: exposure.maxReservationMicroUsd <= options.reservationCeilingMicroUsd,
        },
        managedCredentials: {
          available: blocker === undefined,
          durable: options.store !== undefined,
          keyId: options.cipher.keyId,
          blocker,
        },
        generatedAt: clock.isoNow(),
      };
    },

    async get(actor, providerId) {
      requireCapability(actor, 'ai.providers.view');
      await plane.refreshSettings();
      return buildView(providerId);
    },

    async credentials(actor, providerId) {
      requireCapability(actor, 'ai.providers.view');
      requireRegistered(providerId);
      if (!options.store) return [];
      const configuration = await options.store.findConfiguration(PLATFORM_SCOPE, providerId);
      if (!configuration) return [];
      // METADATA. The store's own type has no secret field, so this cannot
      // carry one however it is serialised downstream.
      return options.store.listCredentials(configuration.configurationId);
    },

    setProviderEnabled(actor, providerId, enabled, reason, meta) {
      return options.mutate(actor, {
        capabilities: ['ai.providers.manage'],
        action: enabled ? ADMIN_ACTION.providerEnabled : ADMIN_ACTION.providerDisabled,
        target: providerId,
        reason,
        meta,
        before: () => providerFacts(providerId),
        run: async (auditReason) => {
          requireRegistered(providerId);
          const applied = await commitProviderState(
            providerId,
            { enabled },
            actor.actorId,
            auditReason,
          );

          // The durable administration record follows the overlay, never leads
          // it. The overlay is what the runtime reads; a row that said
          // "enabled" while the runtime had the provider off would be a console
          // that lies during an incident.
          if (options.store) {
            const configuration = await ensureConfiguration(providerId, actor.actorId);
            await options.store.saveConfiguration({
              ...configuration,
              enabled,
              updatedAt: clock.isoNow(),
              updatedBy: actor.actorId,
            });
          }

          return {
            after: await providerFacts(providerId),
            result: await buildView(providerId),
            configurationVersion: applied.configurationVersion,
          };
        },
      });
    },

    setCredential(actor, providerId, input, reason, meta) {
      return options.mutate(actor, {
        capabilities: ['ai.providers.credentials.manage'],
        action: ADMIN_ACTION.credentialCreated,
        target: providerId,
        reason,
        meta,
        before: () => providerFacts(providerId),
        run: async (auditReason) => {
          const registered = requireRegistered(providerId);

          if (!registered.descriptor.credential.manageable) {
            // The mock provider is the case. Refused by DESCRIPTOR rather than
            // by a `providerId === 'mock'` test, so a future synthetic or
            // keyless adapter is refused too, with no edit here.
            throw new AIError(
              'VALIDATION_FAILED',
              'This provider does not accept a managed credential.',
              {
                fields: ['secret'],
                diagnostics: `providerId=${providerId} manageable=false`,
              },
            );
          }

          const blocker = managedBlocker();
          if (blocker !== undefined) {
            // FAIL CLOSED. No base64, no plaintext column, no "store it for now
            // and encrypt later". A credential that cannot be encrypted is not
            // stored, and the operator is told exactly why.
            throw new AIError(
              'INTERNAL_ERROR',
              'Managed provider credentials cannot be stored in this deployment.',
              { diagnostics: blocker, retryable: false },
            );
          }

          const store = options.store!;
          const secret = typeof input.secret === 'string' ? input.secret.trim() : '';
          if (secret.length < MIN_SECRET_LENGTH || secret.length > MAX_SECRET_LENGTH) {
            // The message names the BOUNDS, never the value. A validation error
            // that echoes the rejected input is a validation error that logs a
            // secret the first time somebody pastes one with a typo.
            throw new AIError(
              'VALIDATION_FAILED',
              `A credential must be between ${MIN_SECRET_LENGTH} and ${MAX_SECRET_LENGTH} characters.`,
              { fields: ['secret'] },
            );
          }

          const configuration = await ensureConfiguration(providerId, actor.actorId);
          const previous = await store.activeCredential(configuration.configurationId);
          const credentialId = ids.next('pvk');
          const at = clock.isoNow();

          const sealed = await options.cipher.seal(secret, {
            providerKey: configuration.providerKey,
            scope: configuration.scope,
            credentialId,
            // Absent for a platform configuration, which is every configuration
            // Batch 4C creates. Passed anyway so the sealing and opening sides
            // are written against the same binding from the start.
            organizationId: configuration.organizationId,
          });
          const fingerprint = await options.cipher.fingerprint(secret);
          const lastFour = safeLastFour(secret);

          await store.putActiveCredential({
            credentialId,
            configurationId: configuration.configurationId,
            providerKey: configuration.providerKey,
            credentialName:
              bounded(input.credentialName, MAX_CREDENTIAL_NAME) ??
              (previous ? 'rotated' : 'primary'),
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

          // The resolver's non-secret snapshot is refreshed at once, so the
          // console reflects the new credential on the next read rather than
          // when the TTL happens to expire.
          await options.credentials?.refresh();

          // The log line names the fingerprint and NOTHING ELSE about the key.
          logger.info('ai.admin.provider.credential.stored', {
            providerId,
            credentialId,
            fingerprint,
            rotated: previous !== undefined,
            keyId: sealed.kid,
          });

          return {
            after: await providerFacts(providerId),
            result: await buildView(providerId),
            action: previous ? ADMIN_ACTION.credentialRotated : ADMIN_ACTION.credentialCreated,
          };
        },
      });
    },

    revokeCredential(actor, providerId, credentialId, reason, meta) {
      return options.mutate(actor, {
        capabilities: ['ai.providers.credentials.manage'],
        action: ADMIN_ACTION.credentialRevoked,
        target: `${providerId}:${credentialId}`,
        reason,
        meta,
        before: () => providerFacts(providerId),
        run: async () => {
          requireRegistered(providerId);
          if (!options.store) {
            throw new AIError(
              'INTERNAL_ERROR',
              'Provider administration storage is not configured in this deployment.',
              { diagnostics: 'no ProviderAdministrationStore was injected', retryable: false },
            );
          }
          const configuration = await options.store.findConfiguration(PLATFORM_SCOPE, providerId);
          if (!configuration) {
            throw new AIError('FEATURE_NOT_FOUND', 'That provider has no managed credential.', {
              diagnostics: `providerId=${providerId}`,
            });
          }
          const existing = (await options.store.listCredentials(configuration.configurationId)).find(
            (record) => record.credentialId === credentialId,
          );
          if (!existing) {
            throw new AIError('FEATURE_NOT_FOUND', 'That credential does not exist.', {
              diagnostics: `providerId=${providerId} credentialId=${credentialId}`,
            });
          }
          if (existing.status === 'revoked') {
            // Idempotent rather than an error: an operator clicking twice
            // during an incident should get the state they asked for, not a
            // failure that makes them wonder whether the first one worked.
            return {
              after: await providerFacts(providerId),
              result: await buildView(providerId),
            };
          }

          await options.store.revokeCredential(
            configuration.configurationId,
            credentialId,
            clock.isoNow(),
            actor.actorId,
          );
          await options.credentials?.refresh();

          logger.warn('ai.admin.provider.credential.revoked', {
            providerId,
            credentialId,
            fingerprint: existing.fingerprint,
          });

          return {
            after: await providerFacts(providerId),
            result: await buildView(providerId),
          };
        },
      });
    },

    setModelEnabled(actor, providerId, modelId, enabled, reason, meta) {
      return options.mutate(actor, {
        capabilities: ['ai.providers.models.manage'],
        action: enabled ? ADMIN_ACTION.modelEnabled : ADMIN_ACTION.modelDisabled,
        target: `${providerId}:${modelId}`,
        reason,
        meta,
        before: () => providerFacts(providerId),
        run: async (auditReason) => {
          const registered = requireRegistered(providerId);

          // AN ARBITRARY MODEL STRING CANNOT BECOME PRODUCTION-ELIGIBLE.
          //
          // The adapter's declared catalogue is the only source of models, and
          // it is reviewed code. Typing a name into the console reaches this
          // check and stops.
          const declared = registered.descriptor.models.find(
            (model) => model.modelId === modelId,
          );
          if (!declared) {
            throw new AIError(
              'VALIDATION_FAILED',
              'That model is not offered by this provider.',
              {
                fields: ['modelId'],
                diagnostics:
                  `providerId=${providerId} modelId=${modelId} ` +
                  `declared=${registered.descriptor.models.map((m) => m.modelId).join(',')}`,
              },
            );
          }

          // CERTIFICATION IS A GOVERNANCE DECISION, NOT A CONSOLE ACTION. An
          // uncertified provider's models cannot be switched into service here;
          // certifying the provider is a separate, deliberate act.
          if (enabled && registered.certification !== 'certified') {
            throw new AIError(
              'VALIDATION_FAILED',
              'A model cannot be enabled while its provider is not certified.',
              {
                fields: ['modelId'],
                diagnostics: `providerId=${providerId} certification=${registered.certification}`,
              },
            );
          }

          const settings = options.liveSettings();
          const current = settings.providers[providerId]?.modelAllowList ?? [];
          const allDeclared = registered.descriptor.models.map((model) => model.modelId);
          // An empty allow list means "every declared model", so switching one
          // model OFF from that state has to materialise the full list first —
          // otherwise the narrowing would silently be a no-op.
          const effective = current.length === 0 ? allDeclared : current;
          const next = enabled
            ? [...new Set([...effective, modelId])]
            : effective.filter((entry) => entry !== modelId);

          if (next.length === 0) {
            throw new AIError(
              'VALIDATION_FAILED',
              'A provider must keep at least one enabled model. Disable the provider instead.',
              {
                fields: ['modelId'],
                diagnostics: `providerId=${providerId} would have an empty model allow list`,
              },
            );
          }

          // ── The governed exposure guard ──────────────────────────────────
          //
          // Enabling a model can raise the worst-case reservation every request
          // takes against the MARQ ceiling. A change that raises it PAST what
          // the deployment governs is refused, with the number named, rather
          // than accepted into a state nobody chose.
          //
          // BOTH SIDES ARE EFFECTIVE CATALOGUES. An earlier revision compared
          // the DECLARED catalogue (every model of every provider) against the
          // narrowed one, which made the guard inert: a narrowing is always a
          // subset, a subset's maximum can never exceed the superset's, so
          // `raises` was false on every path and nothing could ever be refused.
          // An independent review of this batch found the dead branch; the
          // tests had only ever exercised `judgeExposureChange` as a pure
          // function, which is exactly the shape of coverage that hides it.
          //
          // Comparing two REACHABLE states — what the platform will hold before
          // this change and after it — is what makes the verdict mean something.
          const before = exposureReport(plane.catalog.list(), effectiveCatalogue());
          const hypothetical = effectiveCatalogue().map((entry) =>
            entry.providerId !== providerId
              ? entry
              : {
                  ...entry,
                  models: registered.descriptor.models.filter((model) =>
                    next.includes(model.modelId),
                  ),
                },
          );
          const verdict = judgeExposureChange(
            before,
            exposureReport(plane.catalog.list(), hypothetical),
            options.reservationCeilingMicroUsd,
          );
          if (!verdict.permitted) {
            throw new AIError(
              'VALIDATION_FAILED',
              'This change would raise the platform’s worst-case AI spending exposure past the governed ceiling.',
              { fields: ['modelId'], diagnostics: verdict.reason, retryable: false },
            );
          }

          const applied = await commitProviderState(
            providerId,
            // A list covering every declared model is stored as EMPTY, which is
            // the overlay's own encoding of "no narrowing". Storing the full
            // list instead would work today and break the day the adapter
            // declares a new model: the stored list would silently exclude it.
            { modelAllowList: next.length === allDeclared.length ? [] : next },
            actor.actorId,
            auditReason,
          );

          if (options.store) {
            const configuration = await ensureConfiguration(providerId, actor.actorId);
            const at = clock.isoNow();
            const existing = (await options.store.listModels(configuration.configurationId)).find(
              (record) => record.modelId === modelId,
            );
            await options.store.saveModel({
              modelRecordId: existing?.modelRecordId ?? ids.next('pvm'),
              configurationId: configuration.configurationId,
              providerKey: providerId,
              modelId,
              displayName: existing?.displayName ?? modelId,
              enabled,
              // Copied from the registry's governance decision. There is no
              // request field that reaches this column.
              certification: registered.certification,
              createdAt: existing?.createdAt ?? at,
              updatedAt: at,
              updatedBy: actor.actorId,
            });
          }

          return {
            after: await providerFacts(providerId),
            result: await buildView(providerId),
            configurationVersion: applied.configurationVersion,
          };
        },
      });
    },
  };
}
