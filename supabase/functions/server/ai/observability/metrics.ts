/**
 * Metrics for the AI Control Plane.
 *
 * Counters, histograms and gauges with bounded-cardinality labels. Everything a
 * capacity or reliability question needs — request rate by feature, error rate
 * by code, latency distribution by provider, token spend by organization — is
 * derivable from what is recorded here.
 *
 * Two design constraints, both learned the expensive way in systems like this:
 *
 *   Bounded cardinality. Labels never carry a requestId, an actorId or any
 *   other unbounded value. A metrics store with per-request label sets is a
 *   metrics store that falls over. Per-request detail belongs in logs and audit,
 *   which are indexed for it.
 *
 *   Bounded memory. Histograms are fixed bucket arrays, not sample lists, so a
 *   long-lived edge instance cannot grow without limit. Percentiles are read off
 *   the buckets.
 */

export type MetricLabels = Readonly<Record<string, string>>;

export interface CounterSnapshot {
  readonly name: string;
  readonly labels: MetricLabels;
  readonly value: number;
}

export interface HistogramSnapshot {
  readonly name: string;
  readonly labels: MetricLabels;
  readonly count: number;
  readonly sum: number;
  readonly min: number;
  readonly max: number;
  /** Upper bound → cumulative count at or below that bound. */
  readonly buckets: Readonly<Record<string, number>>;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

export interface MetricsSnapshot {
  readonly counters: readonly CounterSnapshot[];
  readonly histograms: readonly HistogramSnapshot[];
  readonly gauges: readonly CounterSnapshot[];
}

export interface Metrics {
  increment(name: string, labels?: MetricLabels, by?: number): void;
  observe(name: string, value: number, labels?: MetricLabels): void;
  gauge(name: string, value: number, labels?: MetricLabels): void;
  snapshot(): MetricsSnapshot;
  reset(): void;
}

/** Latency buckets in milliseconds. Chosen for LLM call shapes, not web calls. */
const LATENCY_BUCKETS = [50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 20_000, 40_000, 60_000];

/** Labels are dropped past this many distinct series per metric name. */
const MAX_SERIES_PER_METRIC = 500;

function seriesKey(name: string, labels: MetricLabels): string {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  return entries.length === 0 ? name : `${name}|${entries.map(([k, v]) => `${k}=${v}`).join(',')}`;
}

interface Histogram {
  name: string;
  labels: MetricLabels;
  counts: number[];
  overflow: number;
  count: number;
  sum: number;
  min: number;
  max: number;
}

export function createMetrics(): Metrics {
  const counters = new Map<string, CounterSnapshot & { value: number }>();
  const gauges = new Map<string, CounterSnapshot & { value: number }>();
  const histograms = new Map<string, Histogram>();
  const seriesPerName = new Map<string, Set<string>>();

  /** False when this metric name has already hit its series budget. */
  function admit(name: string, key: string): boolean {
    const known = seriesPerName.get(name) ?? new Set<string>();
    if (!known.has(key) && known.size >= MAX_SERIES_PER_METRIC) return false;
    known.add(key);
    seriesPerName.set(name, known);
    return true;
  }

  function percentile(histogram: Histogram, ratio: number): number {
    if (histogram.count === 0) return 0;
    const target = histogram.count * ratio;
    let cumulative = 0;
    for (let i = 0; i < LATENCY_BUCKETS.length; i += 1) {
      cumulative += histogram.counts[i];
      if (cumulative >= target) return LATENCY_BUCKETS[i];
    }
    return histogram.max;
  }

  return {
    increment(name, labels = {}, by = 1) {
      const key = seriesKey(name, labels);
      if (!admit(name, key)) return;
      const existing = counters.get(key);
      if (existing) existing.value += by;
      else counters.set(key, { name, labels, value: by });
    },

    observe(name, value, labels = {}) {
      const key = seriesKey(name, labels);
      if (!admit(name, key)) return;
      let histogram = histograms.get(key);
      if (!histogram) {
        histogram = {
          name,
          labels,
          counts: new Array(LATENCY_BUCKETS.length).fill(0),
          overflow: 0,
          count: 0,
          sum: 0,
          min: Number.POSITIVE_INFINITY,
          max: 0,
        };
        histograms.set(key, histogram);
      }
      histogram.count += 1;
      histogram.sum += value;
      histogram.min = Math.min(histogram.min, value);
      histogram.max = Math.max(histogram.max, value);
      const index = LATENCY_BUCKETS.findIndex((bound) => value <= bound);
      if (index === -1) histogram.overflow += 1;
      else histogram.counts[index] += 1;
    },

    gauge(name, value, labels = {}) {
      const key = seriesKey(name, labels);
      if (!admit(name, key)) return;
      gauges.set(key, { name, labels, value });
    },

    snapshot() {
      return {
        counters: [...counters.values()].map((c) => ({ ...c })),
        gauges: [...gauges.values()].map((g) => ({ ...g })),
        histograms: [...histograms.values()].map((histogram) => {
          const buckets: Record<string, number> = {};
          let cumulative = 0;
          for (let i = 0; i < LATENCY_BUCKETS.length; i += 1) {
            cumulative += histogram.counts[i];
            buckets[`le_${LATENCY_BUCKETS[i]}`] = cumulative;
          }
          buckets.le_inf = cumulative + histogram.overflow;
          return {
            name: histogram.name,
            labels: histogram.labels,
            count: histogram.count,
            sum: histogram.sum,
            min: histogram.count === 0 ? 0 : histogram.min,
            max: histogram.max,
            buckets,
            p50: percentile(histogram, 0.5),
            p95: percentile(histogram, 0.95),
            p99: percentile(histogram, 0.99),
          };
        }),
      };
    },

    reset() {
      counters.clear();
      gauges.clear();
      histograms.clear();
      seriesPerName.clear();
    },
  };
}

/** Metric names. Centralised so a dashboard query never guesses a string. */
export const METRIC = {
  requestsTotal: 'ai_requests_total',
  requestErrorsTotal: 'ai_request_errors_total',
  requestLatencyMs: 'ai_request_latency_ms',
  providerAttemptsTotal: 'ai_provider_attempts_total',
  providerLatencyMs: 'ai_provider_latency_ms',
  providerFailuresTotal: 'ai_provider_failures_total',
  failoversTotal: 'ai_provider_failovers_total',
  circuitOpenTotal: 'ai_circuit_open_total',
  tokensTotal: 'ai_tokens_total',
  costMicroUsdTotal: 'ai_cost_micro_usd_total',
  guardRejectionsTotal: 'ai_guard_rejections_total',
  governanceBlocksTotal: 'ai_governance_blocks_total',
  governanceFlagsTotal: 'ai_governance_flags_total',
  redactionsTotal: 'ai_redactions_total',
  factLockRestoresTotal: 'ai_fact_lock_restores_total',
  routingDecisionsTotal: 'ai_routing_decisions_total',
  routingPremiumMicroUsdTotal: 'ai_routing_premium_micro_usd_total',
  routingBudgetExhaustedTotal: 'ai_routing_budget_exhausted_total',
  rateLimitScopes: 'ai_rate_limit_scopes',
} as const;
