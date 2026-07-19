/**
 * Operational readiness report builder (Workstream 8 — Observability).
 *
 * Produces an HONEST, secret-free readiness snapshot for operators. The
 * builder is a pure function of already-gathered inputs so it can be unit
 * tested without a live edge/Deno environment. The calling route is
 * responsible for gathering inputs (env presence booleans, a KV round-trip,
 * intelligence provider health) and must NEVER pass secret values in.
 *
 * Distinctions this report makes explicit (per audit requirement):
 *   - liveness      : the process is up and serving.
 *   - readiness     : required configuration + hard dependencies are usable.
 *   - dependencies  : status of each hard dependency (config, KV, intelligence).
 *   - integrations  : status of OPTIONAL integrations (e.g. email) — their
 *                     absence degrades but does not fail readiness.
 *
 * It never claims a capability it cannot verify and never reports a secret
 * value — only booleans describing whether a secret is present.
 */

export type ReadinessStatus = 'ready' | 'degraded' | 'not_ready';
export type DependencyStatus = 'ok' | 'degraded' | 'failed' | 'not_configured';

export interface ReadinessConfigInput {
  /** Whether each REQUIRED server secret is present (never the value itself). */
  supabaseUrl: boolean;
  serviceRoleKey: boolean;
  anonKey: boolean;
}

export interface ReadinessKvInput {
  /** Result of a live KV round-trip, or null when the check was skipped. */
  reachable: boolean;
}

export interface ReadinessIntelligenceInput {
  activeProvider: string;
  /** Whether the ACTIVE provider's credentials are configured. */
  credentialsConfigured: boolean;
  providerHealth: Array<{
    providerId: string;
    status: string;
    certificationStatus: string;
    credentialsConfigured: boolean;
  }>;
  /** Optional recent-telemetry summary (safe counts only). */
  recent?: { total: number; errors: number };
}

export interface ReadinessInput {
  config: ReadinessConfigInput;
  kv: ReadinessKvInput | null;
  intelligence: ReadinessIntelligenceInput;
  integrations: {
    email: { configured: boolean };
  };
}

export interface ReadinessReport {
  status: ReadinessStatus;
  liveness: 'ok';
  timestamp: string;
  warnings: string[];
  dependencies: {
    config: {
      status: DependencyStatus;
      requiredSecretsPresent: boolean;
      present: ReadinessConfigInput;
      missing: string[];
    };
    kv: { status: DependencyStatus };
    intelligence: {
      status: DependencyStatus;
      activeProvider: string;
      credentialsConfigured: boolean;
      mockProviderActive: boolean;
      providers: ReadinessIntelligenceInput['providerHealth'];
      recent?: { total: number; errors: number };
    };
  };
  integrations: {
    email: { status: DependencyStatus };
  };
}

const REQUIRED_CONFIG_KEYS: Array<keyof ReadinessConfigInput> = [
  'supabaseUrl',
  'serviceRoleKey',
  'anonKey',
];

const CONFIG_ENV_NAMES: Record<keyof ReadinessConfigInput, string> = {
  supabaseUrl: 'SUPABASE_URL',
  serviceRoleKey: 'SUPABASE_SERVICE_ROLE_KEY',
  anonKey: 'SUPABASE_ANON_KEY',
};

export function buildReadinessReport(
  input: ReadinessInput,
  now: Date = new Date(),
): ReadinessReport {
  const warnings: string[] = [];

  // ── Config dependency ──────────────────────────────────────────────────
  const missing = REQUIRED_CONFIG_KEYS.filter((k) => !input.config[k]).map(
    (k) => CONFIG_ENV_NAMES[k],
  );
  const requiredSecretsPresent = missing.length === 0;
  const configStatus: DependencyStatus = requiredSecretsPresent ? 'ok' : 'failed';
  if (!requiredSecretsPresent) {
    warnings.push(`Missing required configuration: ${missing.join(', ')}`);
  }

  // ── KV dependency ──────────────────────────────────────────────────────
  let kvStatus: DependencyStatus;
  if (input.kv === null) {
    kvStatus = 'degraded';
    warnings.push('KV readiness was not verified in this check.');
  } else if (input.kv.reachable) {
    kvStatus = 'ok';
  } else {
    kvStatus = 'failed';
    warnings.push('KV store round-trip failed.');
  }

  // ── Intelligence dependency ────────────────────────────────────────────
  const mockProviderActive = input.intelligence.activeProvider === 'mock';
  let intelligenceStatus: DependencyStatus;
  if (mockProviderActive) {
    // A mock provider must never run silently in production.
    intelligenceStatus = 'degraded';
    warnings.push(
      'Intelligence Gateway is running the MOCK provider — AI output is synthetic, not production-grade.',
    );
  } else if (!input.intelligence.credentialsConfigured) {
    intelligenceStatus = 'failed';
    warnings.push(
      `Active AI provider "${input.intelligence.activeProvider}" has no credentials configured.`,
    );
  } else {
    intelligenceStatus = 'ok';
  }

  // ── Optional integrations ──────────────────────────────────────────────
  const emailStatus: DependencyStatus = input.integrations.email.configured
    ? 'ok'
    : 'not_configured';
  if (!input.integrations.email.configured) {
    warnings.push('Email (Resend) is not configured — outbound email is logged but not delivered.');
  }

  // ── Overall readiness roll-up ──────────────────────────────────────────
  // Hard dependencies (config, KV, intelligence) drive readiness. Optional
  // integrations only ever produce warnings, never not_ready.
  const hardStatuses = [configStatus, kvStatus, intelligenceStatus];
  let status: ReadinessStatus;
  if (hardStatuses.includes('failed')) {
    status = 'not_ready';
  } else if (hardStatuses.includes('degraded')) {
    status = 'degraded';
  } else {
    status = 'ready';
  }

  return {
    status,
    liveness: 'ok',
    timestamp: now.toISOString(),
    warnings,
    dependencies: {
      config: {
        status: configStatus,
        requiredSecretsPresent,
        present: { ...input.config },
        missing,
      },
      kv: { status: kvStatus },
      intelligence: {
        status: intelligenceStatus,
        activeProvider: input.intelligence.activeProvider,
        credentialsConfigured: input.intelligence.credentialsConfigured,
        mockProviderActive,
        providers: input.intelligence.providerHealth,
        recent: input.intelligence.recent,
      },
    },
    integrations: {
      email: { status: emailStatus },
    },
  };
}
