/**
 * AI Control Plane runtime configuration.
 *
 * A pure function of an `EnvSource`: same environment in, same configuration
 * out, no globals read. Every value is bounded, so a malformed environment
 * variable degrades to a safe default instead of propagating NaN into a timeout
 * or a negative ceiling into a rate limiter.
 *
 * There are deliberately NO per-feature "use the gateway" switches here. Batch 1
 * establishes exactly one governed execution path; a flag that bypasses it would
 * be a second path by definition.
 */

import type { EnvSource } from './env.ts';
import { readBool, readInt, readList, readOptionalString, readString } from './env.ts';
import { DEFAULT_RESERVATION_TTL_MS } from '../policy/spendLedger.ts';

export interface AIControlPlaneConfig {
  /** Ordered provider preference. First healthy, capable provider wins. */
  readonly providerPreference: readonly string[];
  /** Provider used when no other provider can serve a request. */
  readonly fallbackProviderId?: string;
  /** Allow failover to the next preferred provider on a failoverable error. */
  readonly failoverEnabled: boolean;
  /**
   * The real-request kill switch. FALSE BY DEFAULT.
   *
   * While false, no provider that spends money with an external vendor may be
   * selected — the platform serves synthetic completions from the mock adapter
   * and cannot produce a bill. Turning it on is a deliberate, explicit act, and
   * it is deliberately not implied by "an API key is configured": a key present
   * in the environment must not by itself start spending.
   */
  readonly allowRealRequests: boolean;
  /** Refuse providers whose certification has not been established. */
  readonly requireCertifiedProviders: boolean;
  /**
   * Refuse AGENTS whose certification has not been established (AI-01 Batch 3A).
   *
   * A separate switch from the provider one, and separate for a reason an
   * independent review found the hard way: the agent runtime originally read
   * `requireCertifiedProviders`, so one operator action silently governed three
   * different populations. A setting whose name describes one thing and governs
   * three is a setting nobody can reason about during an incident.
   */
  readonly requireCertifiedAgents: boolean;
  /** Refuse TOOLS whose certification has not been established. */
  readonly requireCertifiedTools: boolean;
  /**
   * How long an isolate may serve a cached copy of the operational settings
   * before re-reading them from durable storage.
   *
   * Zero — the default — means every AI request re-reads, so an administrator's
   * kill switch reaches every warm isolate on its next request. Raising it
   * trades that immediacy for fewer key-value reads, and a deployment that
   * raises it is choosing to let a stopped platform keep serving for up to
   * this long.
   */
  readonly settingsRefreshMs: number;
  /**
   * Whole-workflow deadline, covering every attempt against every provider.
   * Distinct from the per-attempt timeout, which bounds one call.
   */
  readonly workflowDeadlineMs: number;

  readonly circuit: {
    readonly failureThreshold: number;
    readonly openMs: number;
    readonly halfOpenSuccessesToClose: number;
  };

  readonly retry: {
    readonly baseDelayMs: number;
    readonly maxDelayMs: number;
    /** Proportion of the delay randomised, 0–100 percent. */
    readonly jitterPercent: number;
  };

  readonly budget: {
    readonly organizationDailyMicroUsd: number;
    readonly actorDailyMicroUsd: number;
    /** Percentage of the ceiling that raises a threshold event. */
    readonly alertThresholdPercent: number;
    readonly enforce: boolean;
  };

  readonly spend: {
    /**
     * The MARQ-funded lifetime ceiling, in micro-USD. Set from
     * `AI_MAX_SPEND_USD` (default 9). It never resets on a timer — clearing it
     * requires an explicit, authorised, audited action.
     */
    readonly maxPlatformMicroUsd: number;
    /** Refuse requests at the ceiling. False records spend without refusing. */
    readonly enforce: boolean;
    /** Persist the ledger to durable storage. Off makes it isolate-local. */
    readonly durable: boolean;
    /**
     * How long a spend reservation stays valid before another isolate may
     * reclaim its headroom. Must outlast the longest request the platform will
     * admit, so the control plane floors it at twice the workflow deadline —
     * reclaiming a hold from a request that is still running would let the same
     * money be reserved twice.
     */
    readonly reservationTtlMs: number;
  };

  readonly audit: {
    /** Persist audit records to durable storage as well as the buffer. */
    readonly durable: boolean;
    /** Retention for durable audit records, in days. */
    readonly retentionDays: number;
    /** In-memory ring buffer size for the operational audit endpoint. */
    readonly bufferSize: number;
  };

  readonly observability: {
    readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
    /** Emit one structured JSON line per log record. */
    readonly structuredLogs: boolean;
    readonly metricsBufferSize: number;
  };

  readonly governance: {
    /** Master switch for PII redaction. Off is a deliberate, audited choice. */
    readonly redactionEnabled: boolean;
    /** Reject rather than redact when input contains PII. */
    readonly strictInputGuard: boolean;
  };

  /** Default organization for single-tenant deployments of the console. */
  readonly defaultOrganizationId: string;
  /** Organizations allowed to call AI features. Empty means "all". */
  readonly organizationAllowList: readonly string[];
  /**
   * Permit a subject with no verified membership to fall back to the default
   * organization. False fails such requests closed. See `security/tenancy.ts`
   * for why this defaults to false.
   */
  readonly allowDefaultOrganization: boolean;
}

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

function readLogLevel(env: EnvSource): AIControlPlaneConfig['observability']['logLevel'] {
  const raw = readString(env, 'AI_LOG_LEVEL', 'info').toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(raw)
    ? (raw as AIControlPlaneConfig['observability']['logLevel'])
    : 'info';
}

/**
 * Default provider order, which follows the real-request kill switch.
 *
 * With real requests OFF, mock is first: the deployment cannot spend money and
 * should serve the only thing it is permitted to serve.
 *
 * With real requests ON, mock goes LAST. Keeping it first would mean a
 * deployment that had explicitly authorised real spending still answered every
 * request with a synthetic completion — the platform would look healthy, cost
 * nothing, and be wrong about every answer it gave. The mock stays registered
 * as a last resort rather than being removed, so a total vendor outage degrades
 * to something rather than nothing.
 *
 * An operator who sets `AI_PROVIDER_PREFERENCE` explicitly overrides all of
 * this and gets exactly the order they asked for.
 */
function defaultProviderPreference(env: EnvSource): readonly string[] {
  return readBool(env, 'AI_ALLOW_REAL_REQUESTS', false)
    ? ['openai', 'anthropic', 'mock']
    : ['mock', 'openai', 'anthropic'];
}

/** The MARQ-funded ceiling, in micro-USD. Default $9. */
export const DEFAULT_MAX_SPEND_USD = 9;

/**
 * Read `AI_MAX_SPEND_USD` as dollars and convert to micro-USD.
 *
 * Read as a decimal string rather than through `readInt` so an operator can set
 * a ceiling of `2.50`. A malformed or negative value falls back to the default
 * rather than to "no limit" — a typo in a spending cap must never widen it.
 */
function readMaxSpendMicroUsd(env: EnvSource): number {
  const raw = env.get('AI_MAX_SPEND_USD');
  if (raw === undefined || raw.trim() === '') return DEFAULT_MAX_SPEND_USD * 1_000_000;
  const parsed = Number.parseFloat(raw.trim());
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_MAX_SPEND_USD * 1_000_000;
  // Ten thousand dollars is far beyond any Batch 1 authorisation; a value above
  // it is far more likely a units mistake (micro-USD pasted into a USD field)
  // than an intention, so it is clamped rather than honoured.
  return Math.round(Math.min(parsed, 10_000) * 1_000_000);
}

export function loadControlPlaneConfig(env: EnvSource): AIControlPlaneConfig {
  return {
    providerPreference: readList(env, 'AI_PROVIDER_PREFERENCE', defaultProviderPreference(env)),
    fallbackProviderId: readOptionalString(env, 'AI_FALLBACK_PROVIDER'),
    failoverEnabled: readBool(env, 'AI_FAILOVER_ENABLED', true),
    allowRealRequests: readBool(env, 'AI_ALLOW_REAL_REQUESTS', false),
    requireCertifiedProviders: readBool(env, 'AI_REQUIRE_CERTIFIED_PROVIDERS', true),
    // Default true, like providers: an uncertified agent or tool has never been
    // shown to behave against this platform's contract, and production traffic
    // is not the place to find out.
    requireCertifiedAgents: readBool(env, 'AI_REQUIRE_CERTIFIED_AGENTS', true),
    requireCertifiedTools: readBool(env, 'AI_REQUIRE_CERTIFIED_TOOLS', true),
    settingsRefreshMs: readInt(env, 'AI_SETTINGS_REFRESH_MS', 0, { min: 0, max: 300_000 }),
    workflowDeadlineMs: readInt(env, 'AI_WORKFLOW_DEADLINE_MS', 90_000, {
      min: 1_000,
      max: 600_000,
    }),

    circuit: {
      failureThreshold: readInt(env, 'AI_CIRCUIT_FAILURE_THRESHOLD', 5, { min: 1, max: 100 }),
      openMs: readInt(env, 'AI_CIRCUIT_OPEN_MS', 30_000, { min: 1_000, max: 600_000 }),
      halfOpenSuccessesToClose: readInt(env, 'AI_CIRCUIT_HALF_OPEN_SUCCESSES', 2, {
        min: 1,
        max: 20,
      }),
    },

    retry: {
      baseDelayMs: readInt(env, 'AI_RETRY_BASE_DELAY_MS', 250, { min: 0, max: 10_000 }),
      maxDelayMs: readInt(env, 'AI_RETRY_MAX_DELAY_MS', 4_000, { min: 0, max: 60_000 }),
      jitterPercent: readInt(env, 'AI_RETRY_JITTER_PERCENT', 20, { min: 0, max: 100 }),
    },

    budget: {
      organizationDailyMicroUsd: readInt(env, 'AI_BUDGET_ORG_DAILY_MICRO_USD', 50_000_000, {
        min: 0,
        max: 100_000_000_000,
      }),
      actorDailyMicroUsd: readInt(env, 'AI_BUDGET_ACTOR_DAILY_MICRO_USD', 5_000_000, {
        min: 0,
        max: 100_000_000_000,
      }),
      alertThresholdPercent: readInt(env, 'AI_BUDGET_ALERT_PERCENT', 80, { min: 1, max: 100 }),
      enforce: readBool(env, 'AI_BUDGET_ENFORCE', true),
    },

    spend: {
      maxPlatformMicroUsd: readMaxSpendMicroUsd(env),
      enforce: readBool(env, 'AI_SPEND_ENFORCE', true),
      durable: readBool(env, 'AI_SPEND_DURABLE', true),
      reservationTtlMs: readInt(
        env,
        'AI_SPEND_RESERVATION_TTL_MS',
        DEFAULT_RESERVATION_TTL_MS,
        { min: 60_000, max: 3_600_000 },
      ),
    },

    audit: {
      durable: readBool(env, 'AI_AUDIT_DURABLE', true),
      retentionDays: readInt(env, 'AI_AUDIT_RETENTION_DAYS', 400, { min: 1, max: 3_650 }),
      bufferSize: readInt(env, 'AI_AUDIT_BUFFER_SIZE', 200, { min: 10, max: 5_000 }),
    },

    observability: {
      logLevel: readLogLevel(env),
      structuredLogs: readBool(env, 'AI_STRUCTURED_LOGS', true),
      metricsBufferSize: readInt(env, 'AI_METRICS_BUFFER_SIZE', 500, { min: 50, max: 10_000 }),
    },

    governance: {
      redactionEnabled: readBool(env, 'AI_REDACTION_ENABLED', true),
      strictInputGuard: readBool(env, 'AI_STRICT_INPUT_GUARD', false),
    },

    defaultOrganizationId: readString(env, 'AI_DEFAULT_ORGANIZATION_ID', 'marq-cortex'),
    organizationAllowList: readList(env, 'AI_ORGANIZATION_ALLOW_LIST', []),
    allowDefaultOrganization: readBool(env, 'AI_ALLOW_DEFAULT_ORGANIZATION', false),
  };
}
