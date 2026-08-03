/**
 * Operational settings — the live, administrator-owned overlay on top of the
 * deployment's environment configuration.
 *
 * Batch 1 made `AIControlPlaneConfig` a pure function of the environment: same
 * environment in, same configuration out. That is exactly right for the values
 * a deployment owns, and exactly wrong for the values an operator has to change
 * at 3am without a redeploy — which provider serves traffic, whether AI runs at
 * all, how much of the daily allowance a tenant gets.
 *
 * So Batch 2 adds one layer and no second path. The environment configuration
 * remains the deployment's statement of what is *permitted*; this overlay is the
 * administrator's statement of what is *currently in effect*, and the control
 * plane reads its live values through getters at the point of use. Nothing here
 * enforces anything: the selector still decides provider eligibility, the spend
 * guard still enforces the ceiling, the policy engine still denies. They simply
 * read a value that an authorised administrator can move.
 *
 * TWO RULES MAKE THIS SAFE, AND NEITHER IS OPTIONAL.
 *
 *   The overlay may narrow, never widen. `AI_ALLOW_REAL_REQUESTS=false` means a
 *   deployment has not authorised spending real money, and no console toggle may
 *   overturn that — the effective value is the AND of the environment's
 *   permission and the administrator's choice. An administrator can always turn
 *   real requests OFF (that is the kill switch, and it must work instantly);
 *   turning them ON requires the deployment to have permitted it first. The same
 *   asymmetry applies to every switch here: administrative action can tighten
 *   the platform's posture unilaterally and can only loosen it within the
 *   envelope the deployment already granted.
 *
 *   Every value is normalised, and normalisation lives here alone. An
 *   administrator's input passes through `normalizeOperationalSettings` before
 *   it can reach the plane, with the same bounds the environment reader applies,
 *   so a typo in a console field degrades to a safe value rather than to NaN in
 *   a timeout or a negative ceiling in a budget.
 *
 * The overlay carries a `configurationVersion` that increases on every accepted
 * change. It is the number an operator quotes when asking "which configuration
 * was live when this happened?", and it is stamped on the admin audit record for
 * the change that produced it.
 */

import type { AIControlPlaneConfig } from './config.ts';

export interface AIRetryPolicy {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  /** Proportion of the delay randomised, 0–100 percent. */
  readonly jitterPercent: number;
}

export interface AITimeoutPolicy {
  /** Whole-workflow deadline covering every attempt against every provider. */
  readonly workflowDeadlineMs: number;
}

export interface AIBudgetSettings {
  readonly organizationDailyMicroUsd: number;
  readonly actorDailyMicroUsd: number;
  readonly alertThresholdPercent: number;
  readonly enforce: boolean;
}

export interface AIProviderSetting {
  readonly enabled: boolean;
  /**
   * Model ids this provider may serve. Empty means "every model the adapter
   * declares" — an allow list is an administrative narrowing, so an empty one
   * cannot accidentally mean "none".
   */
  readonly modelAllowList: readonly string[];
}

export interface AIEmergencyStop {
  readonly engaged: boolean;
  readonly reason?: string;
  readonly engagedBy?: string;
  readonly engagedAt?: string;
}

export interface AIOperationalSettings {
  /** Increases on every accepted change. Never resets. */
  readonly configurationVersion: number;
  /** Master switch. False denies every AI request at the policy engine. */
  readonly aiEnabled: boolean;
  /**
   * Administrator's position on real provider requests. The EFFECTIVE value is
   * this AND the deployment's `AI_ALLOW_REAL_REQUESTS` AND not stopped — see
   * `effectiveRealRequestsEnabled`.
   */
  readonly realRequestsEnabled: boolean;
  /** The emergency kill switch. Engaged stops AI harder than `aiEnabled`. */
  readonly emergencyStop: AIEmergencyStop;
  /** Provider tried first, ahead of the preference order. */
  readonly defaultProviderId?: string;
  readonly providerPreference: readonly string[];
  readonly fallbackProviderId?: string;
  readonly failoverEnabled: boolean;
  readonly requireCertifiedProviders: boolean;
  /** Preferred model, used wherever it is registered and meets requirements. */
  readonly defaultModelId?: string;
  /** Per-provider operational state, keyed by provider id. */
  readonly providers: Readonly<Record<string, AIProviderSetting>>;
  readonly retry: AIRetryPolicy;
  readonly timeout: AITimeoutPolicy;
  readonly budget: AIBudgetSettings;
  readonly updatedAt: string;
  /** Actor who made the most recent change. `system` only for the baseline. */
  readonly updatedBy: string;
  readonly updatedReason: string;
}

/** The administrator-supplied shape. Every field optional; absent means keep. */
export interface AIOperationalSettingsPatch {
  readonly aiEnabled?: boolean;
  readonly realRequestsEnabled?: boolean;
  readonly defaultProviderId?: string | null;
  readonly providerPreference?: readonly string[];
  readonly fallbackProviderId?: string | null;
  readonly failoverEnabled?: boolean;
  readonly requireCertifiedProviders?: boolean;
  readonly defaultModelId?: string | null;
  readonly retry?: Partial<AIRetryPolicy>;
  readonly timeout?: Partial<AITimeoutPolicy>;
  readonly budget?: Partial<AIBudgetSettings>;
}

// ── Bounds ──────────────────────────────────────────────────────────────────
//
// The same bounds the environment reader applies, expressed once and used by
// both. An administrator's field and an operator's environment variable are two
// inputs to the same value, and two different bounds on one value is how a
// console lets somebody set something the deployment would have rejected.

export const SETTINGS_BOUNDS = {
  retryBaseDelayMs: { min: 0, max: 10_000 },
  retryMaxDelayMs: { min: 0, max: 60_000 },
  retryJitterPercent: { min: 0, max: 100 },
  workflowDeadlineMs: { min: 1_000, max: 600_000 },
  budgetMicroUsd: { min: 0, max: 100_000_000_000 },
  alertThresholdPercent: { min: 1, max: 100 },
  /** Providers an administrator may list in a preference order. */
  maxPreferenceEntries: 12,
  maxModelAllowList: 24,
  /** Identifier shape accepted for a provider or model id. */
  identifier: /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/,
} as const;

function clampInt(value: unknown, bounds: { min: number; max: number }, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(value)));
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** An identifier, or `undefined` when it is absent or unusable. */
export function asIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return SETTINGS_BOUNDS.identifier.test(trimmed) ? trimmed : undefined;
}

function asIdentifierList(value: unknown, max: number): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const entry of value) {
    const id = asIdentifier(entry);
    // A malformed entry is dropped rather than failing the whole list: a
    // preference order with one bad id should still steer traffic with the ids
    // that were valid, and the dropped entry is visible in the resulting
    // settings the caller gets back.
    if (id !== undefined && !out.includes(id)) out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

/** Bounded free text for an audit reason. Never empty — callers must supply one. */
export const MAX_REASON_LENGTH = 500;

/**
 * The baseline settings a deployment starts from: exactly what the environment
 * configuration says, with nothing overridden. A platform with no stored
 * settings behaves precisely as Batch 1 did.
 */
export function baselineSettings(
  config: AIControlPlaneConfig,
  at: string,
): AIOperationalSettings {
  return {
    configurationVersion: 1,
    aiEnabled: true,
    realRequestsEnabled: config.allowRealRequests,
    emergencyStop: { engaged: false },
    defaultProviderId: undefined,
    providerPreference: [...config.providerPreference],
    fallbackProviderId: config.fallbackProviderId,
    failoverEnabled: config.failoverEnabled,
    requireCertifiedProviders: config.requireCertifiedProviders,
    defaultModelId: undefined,
    providers: {},
    retry: { ...config.retry },
    timeout: { workflowDeadlineMs: config.workflowDeadlineMs },
    budget: { ...config.budget },
    updatedAt: at,
    updatedBy: 'system',
    updatedReason: 'deployment baseline from environment configuration',
  };
}

/**
 * Apply a patch to the current settings, normalising every field.
 *
 * Pure, and deliberately total: any input produces valid settings. The caller
 * decides whether the result differs enough to persist and audit — this
 * function has no opinion about authorization, which belongs to the admin RBAC
 * layer, and none about persistence, which belongs to the store.
 */
export function normalizeOperationalSettings(
  current: AIOperationalSettings,
  patch: AIOperationalSettingsPatch,
): AIOperationalSettings {
  const retry = patch.retry ?? {};
  const timeout = patch.timeout ?? {};
  const budget = patch.budget ?? {};

  // `null` clears an optional id, `undefined` leaves it alone. Without that
  // distinction there is no way to un-pin a default provider through a patch.
  const nullableId = (value: string | null | undefined, existing?: string): string | undefined => {
    if (value === null) return undefined;
    if (value === undefined) return existing;
    return asIdentifier(value) ?? existing;
  };

  return {
    ...current,
    aiEnabled: asBool(patch.aiEnabled, current.aiEnabled),
    realRequestsEnabled: asBool(patch.realRequestsEnabled, current.realRequestsEnabled),
    defaultProviderId: nullableId(patch.defaultProviderId, current.defaultProviderId),
    providerPreference:
      asIdentifierList(patch.providerPreference, SETTINGS_BOUNDS.maxPreferenceEntries) ??
      current.providerPreference,
    fallbackProviderId: nullableId(patch.fallbackProviderId, current.fallbackProviderId),
    failoverEnabled: asBool(patch.failoverEnabled, current.failoverEnabled),
    requireCertifiedProviders: asBool(
      patch.requireCertifiedProviders,
      current.requireCertifiedProviders,
    ),
    defaultModelId: nullableId(patch.defaultModelId, current.defaultModelId),
    retry: {
      baseDelayMs: clampInt(
        retry.baseDelayMs,
        SETTINGS_BOUNDS.retryBaseDelayMs,
        current.retry.baseDelayMs,
      ),
      maxDelayMs: clampInt(
        retry.maxDelayMs,
        SETTINGS_BOUNDS.retryMaxDelayMs,
        current.retry.maxDelayMs,
      ),
      jitterPercent: clampInt(
        retry.jitterPercent,
        SETTINGS_BOUNDS.retryJitterPercent,
        current.retry.jitterPercent,
      ),
    },
    timeout: {
      workflowDeadlineMs: clampInt(
        timeout.workflowDeadlineMs,
        SETTINGS_BOUNDS.workflowDeadlineMs,
        current.timeout.workflowDeadlineMs,
      ),
    },
    budget: {
      organizationDailyMicroUsd: clampInt(
        budget.organizationDailyMicroUsd,
        SETTINGS_BOUNDS.budgetMicroUsd,
        current.budget.organizationDailyMicroUsd,
      ),
      actorDailyMicroUsd: clampInt(
        budget.actorDailyMicroUsd,
        SETTINGS_BOUNDS.budgetMicroUsd,
        current.budget.actorDailyMicroUsd,
      ),
      alertThresholdPercent: clampInt(
        budget.alertThresholdPercent,
        SETTINGS_BOUNDS.alertThresholdPercent,
        current.budget.alertThresholdPercent,
      ),
      enforce: asBool(budget.enforce, current.budget.enforce),
    },
  };
}

/** Normalise a per-provider setting supplied by an administrator. */
export function normalizeProviderSetting(
  current: AIProviderSetting | undefined,
  patch: { enabled?: boolean; modelAllowList?: readonly string[] | null },
): AIProviderSetting {
  const base: AIProviderSetting = current ?? { enabled: true, modelAllowList: [] };
  return {
    enabled: asBool(patch.enabled, base.enabled),
    modelAllowList:
      patch.modelAllowList === null
        ? []
        : (asIdentifierList(patch.modelAllowList, SETTINGS_BOUNDS.maxModelAllowList) ??
          base.modelAllowList),
  };
}

/**
 * The provider order the selector should use: the pinned default first, then
 * the configured preference. Derived rather than stored, so "make this the
 * default provider" cannot drift out of step with the preference list.
 */
export function effectivePreference(settings: AIOperationalSettings): readonly string[] {
  const preference = settings.providerPreference.filter(
    (providerId) => providerId !== settings.defaultProviderId,
  );
  return settings.defaultProviderId === undefined
    ? preference
    : [settings.defaultProviderId, ...preference];
}

/**
 * Whether a billable provider may be reached right now.
 *
 * The AND is the security property: an administrator can withdraw permission
 * the deployment granted, and can never grant permission the deployment
 * withheld. Both the emergency stop and the master switch cut it independently,
 * so neither depends on the other having been set correctly.
 */
export function effectiveRealRequestsEnabled(
  settings: AIOperationalSettings,
  environmentAllowsRealRequests: boolean,
): boolean {
  return (
    environmentAllowsRealRequests &&
    settings.realRequestsEnabled &&
    settings.aiEnabled &&
    !settings.emergencyStop.engaged
  );
}

/** Whether AI execution is permitted at all. */
export function aiExecutionPermitted(settings: AIOperationalSettings): boolean {
  return settings.aiEnabled && !settings.emergencyStop.engaged;
}

// ── The live holder ─────────────────────────────────────────────────────────

export interface OperationalSettingsStore {
  /** The settings currently in effect. Never null. */
  current(): AIOperationalSettings;
  /**
   * Replace the settings wholesale, bumping the configuration version.
   *
   * The version is owned here rather than by the caller so two administrators
   * acting through different isolates cannot both write version 7.
   */
  replace(next: AIOperationalSettings, at: string): AIOperationalSettings;
  /**
   * Adopt settings loaded from durable storage WITHOUT bumping the version —
   * hydration is not a change, and treating it as one would inflate the version
   * on every isolate start until the number meant nothing.
   */
  hydrate(loaded: AIOperationalSettings): void;
}

export function createOperationalSettingsStore(
  initial: AIOperationalSettings,
): OperationalSettingsStore {
  let settings = initial;
  return {
    current: () => settings,
    replace(next, at) {
      settings = {
        ...next,
        configurationVersion: settings.configurationVersion + 1,
        updatedAt: at,
      };
      return settings;
    },
    hydrate(loaded) {
      settings = loaded;
    },
  };
}
