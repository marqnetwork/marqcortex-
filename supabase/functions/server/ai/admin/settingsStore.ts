/**
 * Durable storage for operational settings.
 *
 * A narrow port — load the whole record, save the whole record — for the same
 * reason the spend ledger's store is narrow: a wider interface invites a
 * read-modify-write that the caller does not hold a lock for.
 *
 * The interesting work here is not the storage, it is `parseStoredSettings`.
 * Settings arrive from a key-value store as untyped JSON that a previous
 * revision wrote, that an operator may have edited, or that may simply be
 * truncated. Three failure modes and only one acceptable answer to each:
 *
 *   Unreadable      Fall back to the deployment baseline, loudly. A plane that
 *                   refuses to start because its settings blob is corrupt has
 *                   turned a configuration problem into an outage.
 *
 *   Partially valid Take the fields that parse, default the rest. A settings
 *                   record written before a field existed is the normal state
 *                   after every deploy that adds one.
 *
 *   Valid but wider Drop what is not declared. A stored key nobody reads is
 *                   how a stale value survives a rename and comes back.
 *
 * Parsing is total and never throws: every input produces usable settings.
 */

import type { AIControlPlaneConfig } from '../runtime/config.ts';
import type {
  AIEmergencyStop,
  AIOperationalSettings,
  AIProviderSetting,
} from '../runtime/operationalSettings.ts';
import {
  asIdentifier,
  baselineSettings,
  MAX_REASON_LENGTH,
  normalizeOperationalSettings,
  normalizeProviderSetting,
  SETTINGS_BOUNDS,
} from '../runtime/operationalSettings.ts';

export interface AdminSettingsStore {
  load(): Promise<AIOperationalSettings | undefined>;
  save(settings: AIOperationalSettings): Promise<void>;
}

/** In-memory store. Correct for tests and a single-instance deployment. */
export function createMemorySettingsStore(
  initial?: AIOperationalSettings,
): AdminSettingsStore & { readonly saves: number } {
  let stored = initial;
  let saves = 0;
  return {
    load: () => Promise.resolve(stored),
    save: (settings) => {
      stored = settings;
      saves += 1;
      return Promise.resolve();
    },
    get saves() {
      return saves;
    },
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed.slice(0, max);
}

function parseEmergencyStop(value: unknown): AIEmergencyStop {
  const raw = record(value);
  // Anything unreadable resolves to "not engaged". An emergency stop is the
  // one setting where failing closed would be wrong: a corrupt blob must not
  // silently halt a platform nobody deliberately halted, and an administrator
  // re-engaging a stop is one click, whereas diagnosing a phantom one is not.
  if (!raw || raw.engaged !== true) return { engaged: false };
  return {
    engaged: true,
    reason: text(raw.reason, MAX_REASON_LENGTH),
    engagedBy: text(raw.engagedBy, 120),
    engagedAt: text(raw.engagedAt, 40),
  };
}

function parseProviders(value: unknown): Record<string, AIProviderSetting> {
  const raw = record(value);
  if (!raw) return {};
  const out: Record<string, AIProviderSetting> = {};
  for (const [key, entry] of Object.entries(raw)) {
    const providerId = asIdentifier(key);
    const setting = record(entry);
    if (providerId === undefined || !setting) continue;
    out[providerId] = normalizeProviderSetting(undefined, {
      enabled: typeof setting.enabled === 'boolean' ? setting.enabled : true,
      modelAllowList: Array.isArray(setting.modelAllowList)
        ? (setting.modelAllowList as readonly unknown[]).filter(
            (model): model is string => typeof model === 'string',
          )
        : undefined,
    });
    if (Object.keys(out).length >= SETTINGS_BOUNDS.maxPreferenceEntries * 2) break;
  }
  return out;
}

/**
 * Turn whatever storage returned into usable settings.
 *
 * `undefined` in means "nothing stored", which produces the deployment
 * baseline. Anything else is normalised through the same function an
 * administrator's patch goes through, so a stored value can never take effect
 * that a console field would have rejected.
 */
export function parseStoredSettings(
  raw: unknown,
  config: AIControlPlaneConfig,
  at: string,
): { settings: AIOperationalSettings; recovered: boolean } {
  const baseline = baselineSettings(config, at);
  const stored = record(raw);
  if (!stored) return { settings: baseline, recovered: raw !== undefined && raw !== null };

  const normalized = normalizeOperationalSettings(baseline, {
    aiEnabled: typeof stored.aiEnabled === 'boolean' ? stored.aiEnabled : undefined,
    realRequestsEnabled:
      typeof stored.realRequestsEnabled === 'boolean' ? stored.realRequestsEnabled : undefined,
    defaultProviderId: typeof stored.defaultProviderId === 'string' ? stored.defaultProviderId : null,
    providerPreference: Array.isArray(stored.providerPreference)
      ? (stored.providerPreference as readonly unknown[]).filter(
          (entry): entry is string => typeof entry === 'string',
        )
      : undefined,
    fallbackProviderId:
      typeof stored.fallbackProviderId === 'string' ? stored.fallbackProviderId : null,
    failoverEnabled: typeof stored.failoverEnabled === 'boolean' ? stored.failoverEnabled : undefined,
    requireCertifiedProviders:
      typeof stored.requireCertifiedProviders === 'boolean'
        ? stored.requireCertifiedProviders
        : undefined,
    defaultModelId: typeof stored.defaultModelId === 'string' ? stored.defaultModelId : null,
    retry: record(stored.retry) as Partial<AIOperationalSettings['retry']> | undefined,
    timeout: record(stored.timeout) as Partial<AIOperationalSettings['timeout']> | undefined,
    budget: record(stored.budget) as Partial<AIOperationalSettings['budget']> | undefined,
  });

  const version =
    typeof stored.configurationVersion === 'number' &&
    Number.isFinite(stored.configurationVersion) &&
    stored.configurationVersion >= 1
      ? Math.floor(stored.configurationVersion)
      : baseline.configurationVersion;

  return {
    settings: {
      ...normalized,
      configurationVersion: version,
      emergencyStop: parseEmergencyStop(stored.emergencyStop),
      providers: parseProviders(stored.providers),
      updatedAt: text(stored.updatedAt, 40) ?? baseline.updatedAt,
      updatedBy: text(stored.updatedBy, 120) ?? baseline.updatedBy,
      updatedReason: text(stored.updatedReason, MAX_REASON_LENGTH) ?? baseline.updatedReason,
    },
    recovered: false,
  };
}
