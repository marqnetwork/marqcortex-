/**
 * Operational awareness API client — the enterprise health roll-up (§IV-51) and
 * the enterprise KPI report (§IV-48).
 *
 * G5 built both server surfaces and shipped them with no consumer. This is the
 * consumer. It is thin on purpose: both endpoints are team-authenticated reads
 * over signals the platform already publishes, and every judgement about what a
 * signal MEANS was made server-side, where the discipline is enforced.
 *
 * ── WHAT THIS CLIENT MUST NOT DO ────────────────────────────────────────────
 *
 * IT INVENTS NO DEMO DATA. Every other dashboard service here falls back to
 * seed data when the backend is off, which is right for a sales demo and wrong
 * for an operational surface: an operator reading a fabricated green is in a
 * worse position than one reading nothing. With the backend disabled these
 * functions say so.
 *
 * IT DOES NOT GRADE, THRESHOLD OR TARGET. §IV-48 puts numeric targets,
 * thresholds and formulas explicitly out of scope for this phase, and the
 * report restates `targetsInScope: false` on every read. A client that derived
 * a score, a percentage-of-target or a RAG rating would be inventing the exact
 * product the blueprint deferred.
 *
 * IT DOES NOT COLLAPSE `unknown` INTO `healthy`, OR `null` INTO `0`. Both
 * server modules treat "I could not find out" as a first-class answer, for the
 * reason stated there: a framework that reports green because a probe was never
 * wired is worse than no framework. The helpers below preserve that distinction
 * rather than smoothing it away for the renderer's convenience.
 */

import { edgeFunctionBaseUrl } from '@/config/supabase.config';
import { isBackendEnabled } from '@/config/runtime';

const BASE = edgeFunctionBaseUrl;

// ── Server contracts ────────────────────────────────────────────────────────
//
// Structural mirrors of supabase/functions/server/health/contracts.ts and
// kpi/contracts.ts. Partial on purpose: this surface renders what it
// understands and ignores the rest, so a server that adds a signal does not
// break a deployed console.

/** The four dimensions §IV-51 fixes. Not extensible by configuration. */
export type HealthDimension = 'organizational' | 'product' | 'platform' | 'ai';

/**
 * `unknown` is an answer, not an error — and it must never read as `healthy`.
 */
export type HealthState = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface HealthSignal {
  name: string;
  state: HealthState;
  detail: string;
}

export interface DimensionHealth {
  dimension: HealthDimension;
  state: HealthState;
  /**
   * True when nothing in this dimension is machine-observable in this
   * deployment — as opposed to observable and currently unknown. The two look
   * identical on a status page and mean completely different things.
   */
  observable: boolean;
  signals: HealthSignal[];
}

export interface EnterpriseHealth {
  state: HealthState;
  generatedAt: string;
  dimensions: DimensionHealth[];
  unobservedDimensions: HealthDimension[];
}

export type KpiCategory = 'strategic' | 'operational' | 'quality' | 'customer';

export type KpiUnit = 'count' | 'ratio_percent' | 'micro_usd' | 'milliseconds';

export interface KpiReading {
  id: string;
  category: KpiCategory;
  name: string;
  unit: KpiUnit;
  serves: string[];
  /** `null` is not zero. See the module comment. */
  value: number | null;
  basis: string;
  observedAt: string;
}

export interface KpiReport {
  generatedAt: string;
  readings: KpiReading[];
  /** Indicators whose measurement could not be taken. Named, not inferred. */
  unmeasured: string[];
  /** Restated by the server on every report; rendered, never dropped. */
  targetsInScope: false;
}

// ── Errors ──────────────────────────────────────────────────────────────────

export class OperationalAwarenessError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'OperationalAwarenessError';
    this.status = status;
  }

  /** True when the operator's role is the problem, not their request. */
  get isForbidden(): boolean {
    return this.status === 401 || this.status === 403;
  }

  /** True when there is no live backend to read, so nothing is knowable. */
  get isBackendDisabled(): boolean {
    return this.status === 503;
  }
}

const BACKEND_DISABLED = new OperationalAwarenessError(
  'Operational awareness requires the live backend. Nothing can be reported while it is off.',
  503,
);

async function read<T>(path: string, accessToken: string, what: string): Promise<T> {
  // No demo fallback, deliberately. See the module comment.
  if (!isBackendEnabled()) throw BACKEND_DISABLED;

  const response = await fetch(`${BASE}${path}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  let payload: Record<string, unknown>;
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new OperationalAwarenessError(
      `The ${what} service returned an unreadable response.`,
      response.status,
    );
  }

  if (!response.ok || payload.success !== true) {
    throw new OperationalAwarenessError(
      typeof payload.error === 'string' ? payload.error : `The ${what} request failed.`,
      response.status,
    );
  }

  return payload as T;
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function fetchEnterpriseHealth(accessToken: string): Promise<EnterpriseHealth> {
  const { health } = await read<{ health: EnterpriseHealth }>(
    '/health/enterprise',
    accessToken,
    'enterprise health',
  );
  return health;
}

export async function fetchEnterpriseKpis(accessToken: string): Promise<KpiReport> {
  const { kpis } = await read<{ kpis: KpiReport }>('/kpis', accessToken, 'enterprise KPI');
  return kpis;
}

// ── Presentation helpers ────────────────────────────────────────────────────
//
// Formatting only. Nothing here converts a measurement into a judgement.

/** Worst-first, mirroring the server's HEALTH_SEVERITY. */
const HEALTH_SEVERITY: Record<HealthState, number> = {
  healthy: 0,
  unknown: 1,
  degraded: 2,
  unhealthy: 3,
};

/**
 * Orders states worst-first for display.
 *
 * `unknown` sorts ABOVE `healthy` — an operator scanning a list should meet
 * what is not known before what is fine.
 */
export function compareHealthStates(a: HealthState, b: HealthState): number {
  return HEALTH_SEVERITY[b] - HEALTH_SEVERITY[a];
}

export const HEALTH_STATE_LABELS: Record<HealthState, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  unhealthy: 'Unhealthy',
  // Never "OK", never "—". The word has to carry its meaning on a status page.
  unknown: 'Not known',
};

/**
 * Display colour per state.
 *
 * `unknown` is amber-grey and never green. This is the discipline the server
 * module exists to enforce, and the renderer is where it would be lost.
 */
export const HEALTH_STATE_COLORS: Record<HealthState, string> = {
  healthy: '#22C55E',
  degraded: '#FB923C',
  unhealthy: '#FD4438',
  unknown: '#8B8B9A',
};

export const HEALTH_DIMENSION_LABELS: Record<HealthDimension, string> = {
  organizational: 'Organizational',
  product: 'Product',
  platform: 'Platform',
  ai: 'AI',
};

export const KPI_CATEGORY_LABELS: Record<KpiCategory, string> = {
  strategic: 'Strategic',
  operational: 'Operational',
  quality: 'Quality',
  customer: 'Customer',
};

/**
 * Renders a reading's measurement.
 *
 * An unmeasured indicator returns `null`, NOT the string '0'. The caller must
 * render that as its own state — "not measured" — because a platform where
 * nothing has happened and a platform whose signal cannot be read are different
 * states, and showing both as 0 makes a KPI report reassuring at the exact
 * moment it stops working.
 */
export function formatKpiValue(reading: KpiReading): string | null {
  if (reading.value === null) return null;

  switch (reading.unit) {
    case 'ratio_percent':
      return `${reading.value.toFixed(1)}%`;
    case 'micro_usd':
      // The server counts in micro-USD; showing raw micro-dollars to an
      // operator is a unit nobody reasons in.
      return `$${(reading.value / 1_000_000).toFixed(2)}`;
    case 'milliseconds':
      return reading.value >= 1000
        ? `${(reading.value / 1000).toFixed(1)}s`
        : `${Math.round(reading.value)}ms`;
    case 'count':
    default:
      return reading.value.toLocaleString();
  }
}

/** Groups readings by category, preserving the server's order within each. */
export function groupKpisByCategory(
  readings: readonly KpiReading[],
): { category: KpiCategory; readings: KpiReading[] }[] {
  const categories: KpiCategory[] = ['strategic', 'operational', 'quality', 'customer'];
  return categories
    .map(category => ({
      category,
      readings: readings.filter(r => r.category === category),
    }))
    .filter(group => group.readings.length > 0);
}

/** A success dimension identifier as a human phrase. */
export function formatSuccessDimension(dimension: string): string {
  return dimension.replace(/_/g, ' ');
}
