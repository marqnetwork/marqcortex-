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

export interface AIControlPlaneConfig {
  /** Ordered provider preference. First healthy, capable provider wins. */
  readonly providerPreference: readonly string[];
  /** Provider used when no other provider can serve a request. */
  readonly fallbackProviderId?: string;
  /** Allow failover to the next preferred provider on a failoverable error. */
  readonly failoverEnabled: boolean;

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
}

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

function readLogLevel(env: EnvSource): AIControlPlaneConfig['observability']['logLevel'] {
  const raw = readString(env, 'AI_LOG_LEVEL', 'info').toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(raw)
    ? (raw as AIControlPlaneConfig['observability']['logLevel'])
    : 'info';
}

export function loadControlPlaneConfig(env: EnvSource): AIControlPlaneConfig {
  return {
    providerPreference: readList(env, 'AI_PROVIDER_PREFERENCE', ['openai', 'anthropic', 'mock']),
    fallbackProviderId: readOptionalString(env, 'AI_FALLBACK_PROVIDER'),
    failoverEnabled: readBool(env, 'AI_FAILOVER_ENABLED', true),

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
  };
}
