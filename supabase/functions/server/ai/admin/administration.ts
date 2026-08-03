/**
 * AI Administration service — AI-01 Batch 2.
 *
 * The operational layer over the Batch 1 control plane. It administers the
 * plane; it is not a second way to use it. Every read here comes from the
 * plane's own state and every write goes through the plane's own settings
 * overlay, so there is nothing an administrator can change that the execution
 * path does not immediately observe, and nothing it can observe that the
 * console is guessing at.
 *
 * FIVE INVARIANTS, ENFORCED IN ONE PLACE.
 *
 *   1. Authorization is a capability check, server side, before anything else.
 *      There is no client-supplied role, and no endpoint performs its own
 *      comparison — `mutate` and `read` are the only doors.
 *
 *   2. Every mutation carries a reason. Not "should carry": a mutation with no
 *      reason is rejected before it reaches the plane, and the rejection is
 *      itself recorded.
 *
 *   3. Every mutation is audited with before and after — including the ones
 *      that fail authorization, which are the records a security review wants
 *      most and the ones a naive implementation never writes.
 *
 *   4. Administrative action may tighten the platform's posture freely and may
 *      loosen it only within the envelope the deployment granted. See
 *      `effectiveRealRequestsEnabled` in `runtime/operationalSettings.ts`.
 *
 *   5. Reads are tenant-scoped. A team or organization administrator sees their
 *      own organizations' audit records; only the platform operator sees all of
 *      them. The same boundary the execution path enforces, applied to reading.
 *
 * WHAT THIS MODULE DOES NOT DO, ON PURPOSE.
 *
 *   It does not enforce budgets — `policy/budget.ts` and `policy/spendLedger.ts`
 *   do, unchanged. It does not decide provider eligibility — `providers/selector.ts`
 *   does. It does not deny requests — the policy engine does. Every one of those
 *   would be a second implementation of a Batch 1 guarantee, and two
 *   implementations of a guarantee is zero guarantees.
 */

import type { AIControlPlane } from '../controlPlane.ts';
import type { AIAuditRecord } from '../observability/audit.ts';
import type { AIAuthenticator } from '../security/actor.ts';
import type { AIProviderHealth, AIModelDescriptor } from '../contracts/provider.ts';
import type { Clock } from '../runtime/clock.ts';
import type { IdFactory } from '../contracts/ids.ts';
import type { Logger } from '../observability/logger.ts';
import type { SpendRecord } from '../policy/spendLedger.ts';
import type {
  AIOperationalSettings,
  AIOperationalSettingsPatch,
} from '../runtime/operationalSettings.ts';
import type { AdminSettingsStore } from './settingsStore.ts';
import type { AdminAuditRecord, AdminAuditStore, AdminAuditWriter, AdminAction } from './adminAudit.ts';
import type { AIAdminActor, AIAdminCapability } from './rbac.ts';
import type { UsageReport } from './usage.ts';

import { AIError } from '../contracts/errors.ts';
import { CONTRACT_VERSION, PLATFORM_VERSION } from '../contracts/versions.ts';
import { SPEND_SCOPE, remainingMicroUsd } from '../policy/spendLedger.ts';
import {
  aiExecutionPermitted,
  effectivePreference,
  effectiveRealRequestsEnabled,
  MAX_REASON_LENGTH,
  normalizeOperationalSettings,
  normalizeProviderSetting,
} from '../runtime/operationalSettings.ts';
import { parseStoredSettings } from './settingsStore.ts';
import {
  ADMIN_ACTION,
  changedKeys,
  createAdminAuditWriter,
  createCompositeAdminAuditStore,
  createMemoryAdminAuditStore,
  toChangeMap,
} from './adminAudit.ts';
import { requireCapability, resolveAdminActor, scopeRecords } from './rbac.ts';
import { buildUsageReport } from './usage.ts';

/**
 * The absolute ceiling an administrator may raise the MARQ spend cap to.
 *
 * The same $10,000 clamp `runtime/config.ts` applies to `AI_MAX_SPEND_USD`, for
 * the same reason: a figure above it is far more likely a units mistake —
 * micro-USD typed into a dollar field — than an intention, and the console is a
 * more likely place to make that mistake than an environment file.
 */
export const MAX_ADMIN_SPEND_CAP_MICRO_USD = 10_000 * 1_000_000;

/** Minimum characters in an audit reason, after trimming. */
const MIN_REASON_LENGTH = 4;

export interface AdminRequestMeta {
  readonly correlationId?: string;
  readonly clientIp?: string;
}

// ── Read models ─────────────────────────────────────────────────────────────

export interface AdminProviderView {
  readonly providerId: string;
  readonly displayName: string;
  readonly priority: number;
  readonly productionReady: boolean;
  readonly billable: boolean;
  readonly enabled: boolean;
  readonly health: AIProviderHealth;
  /** Why the selector would skip this provider, or `eligible`. */
  readonly selectionReason: string;
  /** Position in the effective preference order, or -1 when unlisted. */
  readonly preferenceIndex: number;
  readonly isDefault: boolean;
  readonly isFallback: boolean;
  readonly modelAllowList: readonly string[];
  readonly models: readonly {
    readonly modelId: string;
    readonly permitted: boolean;
    readonly isPinnedDefault: boolean;
    readonly promptMicroUsdPer1k: number;
    readonly completionMicroUsdPer1k: number;
    readonly capabilities: AIModelDescriptor['capabilities'];
  }[];
}

export interface AdminBudgetView {
  /** The MARQ-funded lifetime ceiling. */
  readonly platform: {
    readonly capMicroUsd: number;
    /** Settled spend. The "current spend" figure. */
    readonly spentMicroUsd: number;
    /** Held for requests in flight. */
    readonly reservedMicroUsd: number;
    /** Cap minus settled minus reserved, floored at zero. */
    readonly remainingMicroUsd: number;
    /** Settled spend across every reset — what the platform has ever spent. */
    readonly lifetimeSpentMicroUsd: number;
    readonly attemptCount: number;
    readonly updatedAt: string;
    readonly enforced: boolean;
  };
  readonly reservations: {
    readonly openCount: number;
    readonly openMicroUsd: number;
    readonly open: readonly {
      readonly reservationId: string;
      readonly reservedMicroUsd: number;
      readonly createdAt: string;
      readonly expiresAt: string;
      readonly owner?: string;
    }[];
    /** Headroom returned by expiry reclamation since the ledger was created. */
    readonly reclaimedMicroUsd: number;
    readonly reclaimedCount: number;
    /** Set when reserved money exists that no live hold accounts for. */
    readonly unattributedSince?: string;
  };
  readonly daily: {
    readonly organizationDailyMicroUsd: number;
    readonly actorDailyMicroUsd: number;
    readonly alertThresholdPercent: number;
    readonly enforce: boolean;
  };
  readonly resets: SpendRecord['resets'];
}

export interface AdminDiagnostics {
  readonly generatedAt: string;
  readonly versions: {
    readonly platformVersion: string;
    readonly contractVersion: string;
    readonly configurationVersion: number;
    readonly prompts: readonly { readonly reference: string; readonly fingerprint: string }[];
  };
  readonly environment: {
    /** Whether the DEPLOYMENT permits real spending. An admin cannot widen it. */
    readonly realRequestsPermittedByEnvironment: boolean;
    /** Whether real requests are actually reachable right now. */
    readonly realRequestsEffective: boolean;
    readonly spendDurable: boolean;
    readonly auditDurable: boolean;
    readonly auditRetentionDays: number;
    readonly redactionEnabled: boolean;
    readonly strictInputGuard: boolean;
    readonly logLevel: string;
    readonly defaultOrganizationId: string;
    readonly allowDefaultOrganization: boolean;
    readonly organizationAllowList: readonly string[];
  };
  readonly circuits: readonly {
    readonly providerId: string;
    readonly state: string;
    readonly consecutiveFailures: number;
    readonly lastFailureAt?: string;
    readonly lastRecoveryAt?: string;
  }[];
  readonly rateLimits: readonly {
    readonly featureId: string;
    readonly perActor: { readonly limit: number; readonly windowMs: number };
    readonly perOrganization: { readonly limit: number; readonly windowMs: number };
    readonly rateLimitCost: number;
  }[];
  readonly retry: AIOperationalSettings['retry'];
  readonly timeout: AIOperationalSettings['timeout'];
  readonly circuitPolicy: {
    readonly failureThreshold: number;
    readonly openMs: number;
    readonly halfOpenSuccessesToClose: number;
  };
}

export interface AdminOverview {
  readonly actor: {
    readonly actorId: string;
    readonly role: AIAdminActor['role'];
    readonly capabilities: readonly AIAdminCapability[];
    readonly organizationScope: readonly string[];
  };
  readonly settings: AIOperationalSettings;
  readonly effective: {
    readonly aiEnabled: boolean;
    readonly realRequestsEnabled: boolean;
    readonly providerPreference: readonly string[];
  };
  readonly health: ReturnType<AIControlPlane['health']>;
  readonly budget: AdminBudgetView;
  readonly usage: UsageReport;
}

// ── Service ─────────────────────────────────────────────────────────────────

export interface AdministrationDependencies {
  readonly plane: AIControlPlane;
  /** The SAME authentication port the AI Guard uses. Never a second one. */
  readonly authenticator: AIAuthenticator;
  readonly settingsStore: AdminSettingsStore;
  /** Durable stores written alongside the in-memory administrative trail. */
  readonly adminAuditStores?: readonly AdminAuditStore[];
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly logger: Logger;
  /** In-memory administrative trail size. */
  readonly auditBufferSize?: number;
}

export interface AIAdministration {
  /** Resolve and authorize the caller. Throws `AUTH_REQUIRED` or `FORBIDDEN`. */
  authorize(authorization: string | null, meta?: AdminRequestMeta): Promise<AIAdminActor>;
  /** Load stored settings over the deployment baseline. Idempotent. */
  hydrate(): Promise<AIOperationalSettings>;

  overview(actor: AIAdminActor): Promise<AdminOverview>;
  settings(actor: AIAdminActor): AIOperationalSettings;
  /**
   * `reason` is `unknown` on purpose across every mutation on this interface.
   * The service is the validator — it rejects a missing or too-short reason and
   * RECORDS that rejection — so a caller that has not checked the field yet is
   * expected, and a caller that pre-validates gains nothing. Typing it `string`
   * would push a cast to every HTTP boundary, which is where a check quietly
   * turns into `String(body.reason)` and an empty reason becomes "undefined".
   */
  updateSettings(
    actor: AIAdminActor,
    patch: AIOperationalSettingsPatch,
    reason: unknown,
    meta?: AdminRequestMeta,
  ): Promise<AIOperationalSettings>;
  setEmergencyStop(
    actor: AIAdminActor,
    engaged: boolean,
    reason: unknown,
    meta?: AdminRequestMeta,
  ): Promise<AIOperationalSettings>;

  providers(actor: AIAdminActor): readonly AdminProviderView[];
  updateProvider(
    actor: AIAdminActor,
    providerId: string,
    patch: { enabled?: boolean; modelAllowList?: readonly string[] | null },
    reason: unknown,
    meta?: AdminRequestMeta,
  ): Promise<readonly AdminProviderView[]>;

  budget(actor: AIAdminActor): Promise<AdminBudgetView>;
  resetSpend(
    actor: AIAdminActor,
    reason: unknown,
    options?: { newCapMicroUsd?: number },
    meta?: AdminRequestMeta,
  ): Promise<AdminBudgetView>;
  increaseSpendCap(
    actor: AIAdminActor,
    capMicroUsd: number,
    reason: unknown,
    meta?: AdminRequestMeta,
  ): Promise<AdminBudgetView>;

  usage(actor: AIAdminActor): Promise<UsageReport>;
  diagnostics(actor: AIAdminActor): AdminDiagnostics;
  executionAudit(actor: AIAdminActor, limit?: number): readonly AIAuditRecord[];
  adminAudit(actor: AIAdminActor, limit?: number): readonly AdminAuditRecord[];
  /** The administrative trail writer, for callers that must record a denial. */
  readonly trail: AdminAuditWriter;
}

export function createAIAdministration(deps: AdministrationDependencies): AIAdministration {
  const { plane, authenticator, settingsStore, clock, ids, logger } = deps;

  const memoryTrail = createMemoryAdminAuditStore(deps.auditBufferSize ?? 200);
  const trailStore =
    deps.adminAuditStores && deps.adminAuditStores.length > 0
      ? createCompositeAdminAuditStore(memoryTrail, deps.adminAuditStores, (error) =>
          logger.error('ai.admin.audit.durable_write_failed', {
            diagnostics: error instanceof Error ? error.message : String(error),
          }),
        )
      : memoryTrail;
  const trail = createAdminAuditWriter({
    store: trailStore,
    clock,
    newAuditId: () => ids.next('adm'),
  });

  const live = () => plane.settings.current();

  /**
   * A reason, or a rejection.
   *
   * Enforced before authorization is even consulted for the *content* of the
   * change, because "an administrator tried to do something and gave no reason"
   * is itself worth recording — and recording it needs the reason field to have
   * a defined value.
   */
  function requireReason(reason: unknown): string {
    const trimmed = typeof reason === 'string' ? reason.trim() : '';
    if (trimmed.length < MIN_REASON_LENGTH) {
      throw new AIError(
        'VALIDATION_FAILED',
        'A reason is required for every AI administration change.',
        { fields: ['reason'] },
      );
    }
    return trimmed.slice(0, MAX_REASON_LENGTH);
  }

  /** Persist the overlay and project it onto the plane. Order matters. */
  async function commit(next: AIOperationalSettings): Promise<AIOperationalSettings> {
    // Persist BEFORE applying. If storage fails, the plane keeps serving under
    // the settings it already had rather than under settings that will vanish
    // on the next isolate — a change that silently un-applies itself is worse
    // than one that visibly failed.
    const applied = plane.settings.replace(next, clock.isoNow());
    try {
      await settingsStore.save(applied);
    } catch (error) {
      logger.error('ai.admin.settings.persist_failed', {
        configurationVersion: applied.configurationVersion,
        diagnostics: error instanceof Error ? error.message : String(error),
      });
      throw new AIError('INTERNAL_ERROR', 'The AI settings change could not be saved.', {
        diagnostics: error instanceof Error ? error.message : String(error),
        cause: error,
      });
    }
    plane.applySettings();
    return applied;
  }

  /**
   * The single door every mutation goes through.
   *
   * Capability, then reason, then the change, then persistence, then the audit
   * record. A failure at any step is recorded as `rejected` with the code that
   * caused it, so the trail shows attempts as well as successes.
   */
  async function mutate<T>(
    actor: AIAdminActor,
    options: {
      /**
       * EVERY capability this change implies, not just the endpoint's headline
       * one. A patch that moves a retry curve and a spending ceiling in one
       * call needs both grants, or the permissive field becomes the route
       * around the restricted one.
       */
      capabilities: readonly AIAdminCapability[];
      action: AdminAction;
      reason: unknown;
      target?: string;
      meta?: AdminRequestMeta;
      before: () => Promise<Readonly<Record<string, unknown>>>;
      run: (reason: string) => Promise<{
        after: Readonly<Record<string, unknown>>;
        result: T;
        configurationVersion?: number;
        action?: AdminAction;
      }>;
    },
  ): Promise<T> {
    const reasonText =
      typeof options.reason === 'string' ? options.reason.trim().slice(0, MAX_REASON_LENGTH) : '';
    // Empty until the change is authorised. A rejection that happened before
    // the prior state was read records an empty `before`, which is the truth:
    // nothing was read, so nothing can be claimed about it.
    let before: Readonly<Record<string, unknown>> = {};

    const audit = (
      outcome: 'applied' | 'rejected',
      extra: {
        reason?: string;
        after?: Readonly<Record<string, unknown>>;
        configurationVersion?: number;
        rejectionCode?: string;
        action?: AdminAction;
      },
    ): void => {
      trail.record({
        action: extra.action ?? options.action,
        outcome,
        actorId: actor.actorId,
        actorEmail: actor.email,
        actorRole: actor.role,
        organizationScope: actor.organizationScope,
        target: options.target,
        reason: extra.reason ?? (reasonText === '' ? '(no reason supplied)' : reasonText),
        before: toChangeMap(before),
        after: toChangeMap(extra.after ?? {}),
        configurationVersion: extra.configurationVersion,
        correlationId: options.meta?.correlationId,
        clientIp: options.meta?.clientIp,
        rejectionCode: extra.rejectionCode,
      });
    };

    try {
      for (const capability of options.capabilities) requireCapability(actor, capability);
      const reason = requireReason(options.reason);
      before = await options.before();
      const outcome = await options.run(reason);
      audit('applied', {
        reason,
        after: outcome.after,
        configurationVersion: outcome.configurationVersion,
        action: outcome.action,
      });
      logger.info('ai.admin.change_applied', {
        action: outcome.action ?? options.action,
        actorId: actor.actorId,
        role: actor.role,
        target: options.target,
        configurationVersion: outcome.configurationVersion,
        changed: changedKeys(toChangeMap(before), toChangeMap(outcome.after)).join(','),
      });
      return outcome.result;
    } catch (error) {
      const aiError = error instanceof AIError ? error : undefined;
      audit('rejected', { rejectionCode: aiError?.code ?? 'INTERNAL_ERROR' });
      logger.warn('ai.admin.change_rejected', {
        action: options.action,
        actorId: actor.actorId,
        role: actor.role,
        target: options.target,
        code: aiError?.code ?? 'INTERNAL_ERROR',
        diagnostics: aiError?.diagnostics,
      });
      throw error;
    }
  }

  /**
   * The capabilities a settings patch demands, derived from the FIELDS it
   * touches rather than from the endpoint it arrived at. One endpoint that can
   * change anything is one endpoint whose least-privileged caller can change
   * everything.
   */
  function capabilitiesForPatch(patch: AIOperationalSettingsPatch): readonly AIAdminCapability[] {
    const required = new Set<AIAdminCapability>();
    if (patch.aiEnabled !== undefined || patch.realRequestsEnabled !== undefined) {
      required.add('ai.admin.killswitch');
    }
    if (patch.budget !== undefined) required.add('ai.admin.budget.write');
    if (
      patch.defaultProviderId !== undefined ||
      patch.defaultModelId !== undefined ||
      patch.fallbackProviderId !== undefined ||
      patch.providerPreference !== undefined ||
      patch.requireCertifiedProviders !== undefined
    ) {
      required.add('ai.admin.provider.write');
    }
    if (
      patch.retry !== undefined ||
      patch.timeout !== undefined ||
      patch.failoverEnabled !== undefined
    ) {
      required.add('ai.admin.settings.write');
    }
    // An empty patch still demands a grant. Without this, a caller with no
    // write capability at all could reach the mutation path, be audited as
    // "applied", and bump the configuration version with nothing in it.
    if (required.size === 0) required.add('ai.admin.settings.write');
    return [...required];
  }

  /** Read-side capability gate. Reads are not audited — they are not changes. */
  function read(actor: AIAdminActor, capability: AIAdminCapability): void {
    requireCapability(actor, capability);
  }

  // ── Views ─────────────────────────────────────────────────────────────────

  function providerViews(): readonly AdminProviderView[] {
    const settings = live();
    const preference = effectivePreference(settings);
    // Eligibility comes from the health snapshot rather than a second probe, so
    // the reason shown in the console is by construction the same reason the
    // health endpoint reports — two probes would eventually disagree.
    const selection = plane.health().selection;

    return plane.providers.list().map((provider) => {
      const { providerId } = provider.descriptor;
      const setting = settings.providers[providerId];
      const allowList = setting?.modelAllowList ?? [];
      const permitted = plane.providers.models(providerId).map((model) => model.modelId);

      return {
        providerId,
        displayName: provider.descriptor.displayName,
        priority: provider.descriptor.priority,
        productionReady: provider.descriptor.productionReady,
        billable: provider.descriptor.billable,
        enabled: provider.enabled,
        health: plane.providers.health(providerId),
        selectionReason: selection[providerId] ?? 'not evaluated',
        preferenceIndex: preference.indexOf(providerId),
        isDefault: settings.defaultProviderId === providerId,
        isFallback: settings.fallbackProviderId === providerId,
        modelAllowList: allowList,
        models: provider.descriptor.models.map((model) => ({
          modelId: model.modelId,
          permitted: permitted.includes(model.modelId),
          isPinnedDefault: settings.defaultModelId === model.modelId,
          promptMicroUsdPer1k: model.promptMicroUsdPer1k,
          completionMicroUsdPer1k: model.completionMicroUsdPer1k,
          capabilities: model.capabilities,
        })),
      };
    });
  }

  function budgetView(record: SpendRecord): AdminBudgetView {
    const settings = live();
    // Money cleared by past resets plus what is settled now. Without this, an
    // authorised reset would make the platform's spend history look like it
    // never happened — which is exactly what an auditor is checking for.
    const clearedByResets = record.resets.reduce((total, reset) => total + reset.clearedMicroUsd, 0);

    return {
      platform: {
        capMicroUsd: record.capMicroUsd,
        spentMicroUsd: record.spentMicroUsd,
        reservedMicroUsd: record.reservedMicroUsd,
        remainingMicroUsd: remainingMicroUsd(record),
        lifetimeSpentMicroUsd: clearedByResets + record.spentMicroUsd,
        attemptCount: record.attemptCount,
        updatedAt: record.updatedAt,
        enforced: plane.config.spend.enforce,
      },
      reservations: {
        openCount: record.openReservations.length,
        openMicroUsd: record.openReservations.reduce(
          (total, hold) => total + hold.reservedMicroUsd,
          0,
        ),
        open: record.openReservations.map((hold) => ({
          reservationId: hold.reservationId,
          reservedMicroUsd: hold.reservedMicroUsd,
          createdAt: hold.createdAt,
          expiresAt: hold.expiresAt,
          owner: hold.owner,
        })),
        reclaimedMicroUsd: record.reclaimedMicroUsd,
        reclaimedCount: record.reclaimedCount,
        unattributedSince: record.unattributedSince,
      },
      daily: { ...settings.budget },
      resets: record.resets,
    };
  }

  return {
    trail,

    async authorize(authorization, meta) {
      const subject = await authenticator.authenticate(authorization);
      try {
        return resolveAdminActor(subject);
      } catch (error) {
        // A refused administrative access attempt is a security event, and it
        // is recorded whether or not the caller ever had a role. This is the
        // one place the trail records an actor it could not resolve.
        const aiError = error instanceof AIError ? error : undefined;
        trail.record({
          action: ADMIN_ACTION.accessDenied,
          outcome: 'rejected',
          actorId: subject?.subjectId ?? 'unauthenticated',
          actorEmail: subject?.email,
          actorRole: 'unauthorized',
          reason: 'administration access refused',
          rejectionCode: aiError?.code ?? 'FORBIDDEN',
          correlationId: meta?.correlationId,
          clientIp: meta?.clientIp,
        });
        throw error;
      }
    },

    async hydrate() {
      let raw: unknown;
      try {
        raw = await settingsStore.load();
      } catch (error) {
        // Storage being unavailable must not stop the plane from serving. It
        // runs on the deployment baseline, which is the safe posture by
        // construction, and the failure is loud.
        logger.error('ai.admin.settings.load_failed', {
          diagnostics: error instanceof Error ? error.message : String(error),
        });
        return live();
      }
      if (raw === undefined || raw === null) return live();

      const { settings: parsed, recovered } = parseStoredSettings(
        raw,
        plane.config,
        clock.isoNow(),
      );
      if (recovered) {
        logger.error('ai.admin.settings.unreadable', {
          diagnostics: 'stored AI operational settings could not be parsed; using the deployment baseline',
        });
        return live();
      }
      plane.settings.hydrate(parsed);
      plane.applySettings();
      logger.info('ai.admin.settings.hydrated', {
        configurationVersion: parsed.configurationVersion,
        aiEnabled: parsed.aiEnabled,
        emergencyStop: parsed.emergencyStop.engaged,
      });
      return parsed;
    },

    settings(actor) {
      read(actor, 'ai.admin.view');
      return live();
    },

    async overview(actor) {
      read(actor, 'ai.admin.view');
      const settings = live();
      const spend = await plane.spendStatus();
      return {
        actor: {
          actorId: actor.actorId,
          role: actor.role,
          capabilities: actor.capabilities,
          organizationScope: actor.organizationScope,
        },
        settings,
        effective: {
          aiEnabled: aiExecutionPermitted(settings),
          realRequestsEnabled: effectiveRealRequestsEnabled(
            settings,
            plane.config.allowRealRequests,
          ),
          providerPreference: effectivePreference(settings),
        },
        health: plane.health(),
        budget: budgetView(spend),
        usage: buildUsageReport({
          metrics: plane.metrics(),
          settledMicroUsd: spend.spentMicroUsd,
          generatedAt: clock.isoNow(),
        }),
      };
    },

    updateSettings(actor, patch, reason, meta) {
      return mutate(actor, {
        capabilities: capabilitiesForPatch(patch),
        action: patch.budget !== undefined ? ADMIN_ACTION.budgetUpdated : ADMIN_ACTION.settingsUpdated,
        reason,
        meta,
        before: () => Promise.resolve(settingsFacts(live())),
        run: async (auditReason) => {
          const current = live();
          const next = normalizeOperationalSettings(current, patch);
          const applied = await commit({
            ...next,
            updatedBy: actor.actorId,
            updatedReason: auditReason,
          });
          return {
            after: settingsFacts(applied),
            result: applied,
            configurationVersion: applied.configurationVersion,
            action: resolveSettingsAction(current, applied),
          };
        },
      });
    },

    setEmergencyStop(actor, engaged, reason, meta) {
      return mutate(actor, {
        capabilities: ['ai.admin.killswitch'],
        action: engaged ? ADMIN_ACTION.emergencyStopEngaged : ADMIN_ACTION.emergencyStopReleased,
        reason,
        meta,
        before: () => Promise.resolve(settingsFacts(live())),
        run: async (auditReason) => {
          const current = live();
          const applied = await commit({
            ...current,
            // Engaging the stop does NOT clear `aiEnabled` or
            // `realRequestsEnabled`. The stop is an overlay on top of them, so
            // releasing it restores exactly the posture the platform had before
            // the incident rather than an ambiguous one an operator has to
            // reconstruct from memory.
            emergencyStop: engaged
              ? {
                  engaged: true,
                  reason: auditReason,
                  engagedBy: actor.actorId,
                  engagedAt: clock.isoNow(),
                }
              : { engaged: false },
            updatedBy: actor.actorId,
            updatedReason: auditReason,
          });
          return {
            after: settingsFacts(applied),
            result: applied,
            configurationVersion: applied.configurationVersion,
          };
        },
      });
    },

    providers(actor) {
      read(actor, 'ai.admin.view');
      return providerViews();
    },

    updateProvider(actor, providerId, patch, reason, meta) {
      return mutate(actor, {
        capabilities: ['ai.admin.provider.write'],
        action: ADMIN_ACTION.providerUpdated,
        target: providerId,
        reason,
        meta,
        before: () => Promise.resolve(providerFacts(providerId, live())),
        run: async (auditReason) => {
          // The registry, not the settings blob, decides whether a provider
          // exists. An administrator cannot create one by naming it, and a
          // typo produces a clear rejection rather than a stored setting that
          // silently does nothing.
          const registered = plane.providers.find(providerId);
          if (!registered) {
            throw new AIError('PROVIDER_NOT_FOUND', 'That AI provider is not registered.', {
              diagnostics: `providerId=${providerId}`,
            });
          }

          const current = live();
          const nextSetting = normalizeProviderSetting(current.providers[providerId], patch);
          const applied = await commit({
            ...current,
            providers: { ...current.providers, [providerId]: nextSetting },
            updatedBy: actor.actorId,
            updatedReason: auditReason,
          });

          const wasEnabled = current.providers[providerId]?.enabled ?? registered.enabled;
          return {
            after: providerFacts(providerId, applied),
            result: providerViews(),
            configurationVersion: applied.configurationVersion,
            action:
              nextSetting.enabled === wasEnabled
                ? ADMIN_ACTION.providerUpdated
                : nextSetting.enabled
                  ? ADMIN_ACTION.providerEnabled
                  : ADMIN_ACTION.providerDisabled,
          };
        },
      });
    },

    async budget(actor) {
      read(actor, 'ai.admin.view');
      return budgetView(await plane.spendStatus());
    },

    resetSpend(actor, reason, options, meta) {
      return mutate(actor, {
        capabilities: ['ai.admin.budget.reset'],
        action: ADMIN_ACTION.spendReset,
        target: SPEND_SCOPE.platform,
        reason,
        meta,
        before: async () => spendFacts(await plane.spendStatus()),
        run: async (auditReason) => {
          const before = await plane.spendStatus();
          const cap =
            options?.newCapMicroUsd === undefined
              ? undefined
              : clampCap(options.newCapMicroUsd, before.capMicroUsd);

          // Delegated to the Batch 1 ledger, which is the only thing that may
          // clear spend and which already demands an authorising actor and a
          // reason. This layer supplies them; it does not reimplement the reset.
          const after = await plane.spendLedger.reset(SPEND_SCOPE.platform, {
            authorizedBy: actor.actorId,
            reason: auditReason,
            newCapMicroUsd: cap,
          });
          return { after: spendFacts(after), result: budgetView(after) };
        },
      });
    },

    increaseSpendCap(actor, capMicroUsd, reason, meta) {
      return mutate(actor, {
        capabilities: ['ai.admin.budget.reset'],
        action: ADMIN_ACTION.spendCapRaised,
        target: SPEND_SCOPE.platform,
        reason,
        meta,
        before: async () => spendFacts(await plane.spendStatus()),
        run: async (auditReason) => {
          const before = await plane.spendStatus();
          const cap = clampCap(capMicroUsd, before.capMicroUsd);
          if (cap <= before.capMicroUsd) {
            // Lowering the ceiling through the "increase" operation would be a
            // surprising way to disable AI. Lowering is a deployment change to
            // `AI_MAX_SPEND_USD`, which the ledger already honours on the next
            // read and which leaves a record outside the console.
            throw new AIError(
              'VALIDATION_FAILED',
              'The new AI spending cap must be higher than the current one.',
              {
                fields: ['capMicroUsd'],
                diagnostics: `requested=${cap} current=${before.capMicroUsd}`,
              },
            );
          }

          // The ledger's own cap-raise: settled spend and every open hold are
          // preserved. Raising a ceiling is not forgiving what was spent under
          // it, and using `reset` here — the only cap-changing operation Batch 1
          // had — would have destroyed the spend history to grant more headroom.
          const after = await plane.spendLedger.raiseCap(SPEND_SCOPE.platform, {
            authorizedBy: actor.actorId,
            reason: auditReason,
            newCapMicroUsd: cap,
          });
          return { after: spendFacts(after), result: budgetView(after) };
        },
      });
    },

    async usage(actor) {
      read(actor, 'ai.admin.view');
      const spend = await plane.spendStatus();
      return buildUsageReport({
        metrics: plane.metrics(),
        settledMicroUsd: spend.spentMicroUsd,
        generatedAt: clock.isoNow(),
      });
    },

    diagnostics(actor) {
      read(actor, 'ai.admin.view');
      const settings = live();
      const health = plane.health();
      return {
        generatedAt: clock.isoNow(),
        versions: {
          platformVersion: PLATFORM_VERSION,
          contractVersion: CONTRACT_VERSION,
          configurationVersion: settings.configurationVersion,
          prompts: plane.prompts.list().map((prompt) => ({
            reference: prompt.reference,
            fingerprint: prompt.fingerprint,
          })),
        },
        environment: {
          realRequestsPermittedByEnvironment: plane.config.allowRealRequests,
          realRequestsEffective: effectiveRealRequestsEnabled(
            settings,
            plane.config.allowRealRequests,
          ),
          spendDurable: plane.config.spend.durable,
          auditDurable: plane.config.audit.durable,
          auditRetentionDays: plane.config.audit.retentionDays,
          redactionEnabled: plane.config.governance.redactionEnabled,
          strictInputGuard: plane.config.governance.strictInputGuard,
          logLevel: plane.config.observability.logLevel,
          defaultOrganizationId: plane.config.defaultOrganizationId,
          allowDefaultOrganization: plane.config.allowDefaultOrganization,
          organizationAllowList: plane.config.organizationAllowList,
        },
        circuits: health.providers.map((provider) => ({
          providerId: provider.providerId,
          state: provider.circuit,
          consecutiveFailures: provider.consecutiveFailures,
          lastFailureAt: provider.lastFailureAt,
          lastRecoveryAt: provider.lastRecoveryAt,
        })),
        rateLimits: plane.catalog.list().map((descriptor) => ({
          featureId: descriptor.featureId,
          perActor: descriptor.limits.perActor,
          perOrganization: descriptor.limits.perOrganization,
          rateLimitCost: descriptor.limits.rateLimitCost ?? 1,
        })),
        retry: settings.retry,
        timeout: settings.timeout,
        circuitPolicy: plane.config.circuit,
      };
    },

    executionAudit(actor, limit = 50) {
      read(actor, 'ai.admin.audit.read');
      const bounded = Math.min(Math.max(Math.trunc(limit) || 50, 1), 200);
      // Scoped BEFORE truncation would give a narrow-scoped admin fewer records
      // than they asked for whenever another tenant is busy. Read wide, filter,
      // then truncate — the buffer is bounded either way.
      const records = plane.recentAudit(200);
      return scopeRecords(actor, records, (record) => record.organizationId).slice(0, bounded);
    },

    adminAudit(actor, limit = 50) {
      read(actor, 'ai.admin.audit.read');
      const bounded = Math.min(Math.max(Math.trunc(limit) || 50, 1), 200);
      const records = trail.recent(200);
      if (actor.role === 'super_admin') return records.slice(0, bounded);
      // Administrative changes are platform-wide, so there is no organization
      // to scope them by. A non-platform administrator sees the changes they
      // themselves made — enough to review their own actions, not enough to
      // enumerate what other administrators are doing.
      return records.filter((record) => record.actorId === actor.actorId).slice(0, bounded);
    },
  };
}

// ── Audit fact extraction ───────────────────────────────────────────────────

/** The settings fields worth putting on a change record, flattened. */
function settingsFacts(settings: AIOperationalSettings): Readonly<Record<string, unknown>> {
  return {
    configurationVersion: settings.configurationVersion,
    aiEnabled: settings.aiEnabled,
    realRequestsEnabled: settings.realRequestsEnabled,
    emergencyStopEngaged: settings.emergencyStop.engaged,
    defaultProviderId: settings.defaultProviderId ?? '(none)',
    defaultModelId: settings.defaultModelId ?? '(none)',
    providerPreference: settings.providerPreference,
    fallbackProviderId: settings.fallbackProviderId ?? '(none)',
    failoverEnabled: settings.failoverEnabled,
    requireCertifiedProviders: settings.requireCertifiedProviders,
    retryBaseDelayMs: settings.retry.baseDelayMs,
    retryMaxDelayMs: settings.retry.maxDelayMs,
    retryJitterPercent: settings.retry.jitterPercent,
    workflowDeadlineMs: settings.timeout.workflowDeadlineMs,
    budgetOrganizationDailyMicroUsd: settings.budget.organizationDailyMicroUsd,
    budgetActorDailyMicroUsd: settings.budget.actorDailyMicroUsd,
    budgetAlertThresholdPercent: settings.budget.alertThresholdPercent,
    budgetEnforce: settings.budget.enforce,
  };
}

function providerFacts(
  providerId: string,
  settings: AIOperationalSettings,
): Readonly<Record<string, unknown>> {
  const setting = settings.providers[providerId];
  return {
    providerId,
    enabled: setting?.enabled ?? '(registry default)',
    modelAllowList: setting?.modelAllowList ?? [],
    configurationVersion: settings.configurationVersion,
  };
}

function spendFacts(record: SpendRecord): Readonly<Record<string, unknown>> {
  return {
    capMicroUsd: record.capMicroUsd,
    spentMicroUsd: record.spentMicroUsd,
    reservedMicroUsd: record.reservedMicroUsd,
    openReservations: record.openReservations.length,
    resets: record.resets.length,
  };
}

/**
 * Name the change for the trail.
 *
 * A settings patch that toggles the master switch or the real-request switch is
 * recorded under the action that names it, so an incident review can filter the
 * trail for "who turned AI off" without reading every settings diff.
 */
function resolveSettingsAction(
  before: AIOperationalSettings,
  after: AIOperationalSettings,
): AdminAction {
  if (before.aiEnabled !== after.aiEnabled) {
    return after.aiEnabled ? ADMIN_ACTION.aiEnabled : ADMIN_ACTION.aiDisabled;
  }
  if (before.realRequestsEnabled !== after.realRequestsEnabled) {
    return after.realRequestsEnabled
      ? ADMIN_ACTION.realRequestsEnabled
      : ADMIN_ACTION.realRequestsDisabled;
  }
  if (before.defaultModelId !== after.defaultModelId) return ADMIN_ACTION.modelPinned;
  if (
    before.budget.organizationDailyMicroUsd !== after.budget.organizationDailyMicroUsd ||
    before.budget.actorDailyMicroUsd !== after.budget.actorDailyMicroUsd ||
    before.budget.alertThresholdPercent !== after.budget.alertThresholdPercent ||
    before.budget.enforce !== after.budget.enforce
  ) {
    return ADMIN_ACTION.budgetUpdated;
  }
  return ADMIN_ACTION.settingsUpdated;
}

/**
 * Bound a requested cap.
 *
 * A non-finite or negative figure keeps the current cap rather than becoming
 * zero: a malformed spending ceiling must never be interpreted as "stop
 * spending" by accident, because that is an outage caused by a typo.
 */
function clampCap(requested: number, current: number): number {
  if (!Number.isFinite(requested) || requested < 0) return current;
  return Math.min(MAX_ADMIN_SPEND_CAP_MICRO_USD, Math.round(requested));
}
