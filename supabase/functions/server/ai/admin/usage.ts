/**
 * Usage and cost analytics.
 *
 * A pure projection of the metrics the control plane already records into the
 * shape an operations dashboard asks for. Deliberately derived rather than
 * separately accumulated: a second counter incremented alongside the first is a
 * second thing that can be wrong, and when the dashboard and the metrics
 * disagree nobody knows which one to believe.
 *
 * ESTIMATED VERSUS ACTUAL COST is the distinction that matters most here, and
 * the platform genuinely has both:
 *
 *   Estimated  `ai_cost_micro_usd_total`, priced from the provider's reported
 *              token usage at the model's declared rate. It covers every
 *              request, including the ones served free by the mock, and it is
 *              what a per-feature or per-tenant breakdown is built from.
 *
 *   Actual     Settled spend in the MARQ ledger — money the platform has
 *              committed against its ceiling. It exists only for billable
 *              providers, it includes the conservative charge for attempts
 *              whose usage the vendor never reported, and it is the number that
 *              decides whether AI keeps running.
 *
 * They should be close and they will not be equal. Reporting one and labelling
 * it the other is how a platform ends up surprised by an invoice, so both are
 * carried, side by side, with the difference stated.
 *
 * RETRIES are derived, not counted: the plane records one request and N provider
 * attempts, so retries are `attempts − requests` floored at zero. That identity
 * holds regardless of how failover distributes the attempts across providers,
 * which a dedicated retry counter would have to be kept in step with by hand.
 */

import type { CounterSnapshot, MetricsSnapshot } from '../observability/metrics.ts';
import { METRIC } from '../observability/metrics.ts';

export interface UsageTotals {
  readonly requests: number;
  readonly succeeded: number;
  readonly failed: number;
  /** 0–100, rounded to two decimals. Zero requests reports 0, never NaN. */
  readonly successRatePercent: number;
  readonly failureRatePercent: number;
  readonly tokens: number;
  /** Priced from reported token usage across every provider. */
  readonly estimatedCostMicroUsd: number;
  /** Settled against the MARQ ceiling. Billable providers only. */
  readonly actualCostMicroUsd: number;
  readonly providerAttempts: number;
  /** `providerAttempts − requests`, floored at zero. */
  readonly retries: number;
  readonly failovers: number;
  readonly circuitOpenEvents: number;
  readonly guardRejections: number;
  readonly governanceBlocks: number;
  readonly governanceFlags: number;
  readonly redactions: number;
}

export interface FeatureUsage {
  readonly featureId: string;
  readonly requests: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly tokens: number;
  readonly estimatedCostMicroUsd: number;
  readonly successRatePercent: number;
}

export interface ProviderUsage {
  readonly providerId: string;
  readonly attempts: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly failovers: number;
  readonly circuitOpenEvents: number;
  readonly successRatePercent: number;
  /** Median and tail provider latency, in milliseconds. */
  readonly latency: { readonly p50: number; readonly p95: number; readonly p99: number };
}

export interface ErrorBreakdown {
  readonly code: string;
  readonly count: number;
}

export interface UsageReport {
  readonly generatedAt: string;
  /** Since the isolate started — metrics are in-process and not persisted. */
  readonly window: 'process_lifetime';
  readonly totals: UsageTotals;
  readonly features: readonly FeatureUsage[];
  readonly providers: readonly ProviderUsage[];
  readonly errors: readonly ErrorBreakdown[];
  readonly latency: { readonly p50: number; readonly p95: number; readonly p99: number };
}

function sumOf(counters: readonly CounterSnapshot[], name: string, match?: (labels: Readonly<Record<string, string>>) => boolean): number {
  return counters
    .filter((counter) => counter.name === name && (match?.(counter.labels) ?? true))
    .reduce((total, counter) => total + counter.value, 0);
}

/** Percentage to two decimals. A zero denominator reports 0 rather than NaN. */
function ratePercent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 10_000) / 100;
}

export interface UsageInputs {
  readonly metrics: MetricsSnapshot;
  /** Settled lifetime spend from the MARQ ledger, in micro-USD. */
  readonly settledMicroUsd: number;
  readonly generatedAt: string;
}

export function buildUsageReport(inputs: UsageInputs): UsageReport {
  const { counters, histograms } = inputs.metrics;

  // `ai_requests_total` is labelled `outcome: success | error`. Summing both is
  // the request count; there is no separate total to drift from it.
  const succeeded = sumOf(counters, METRIC.requestsTotal, (l) => l.outcome === 'success');
  const failed = sumOf(counters, METRIC.requestsTotal, (l) => l.outcome === 'error');
  const requests = succeeded + failed;
  const providerAttempts = sumOf(counters, METRIC.providerAttemptsTotal);

  const totals: UsageTotals = {
    requests,
    succeeded,
    failed,
    successRatePercent: ratePercent(succeeded, requests),
    failureRatePercent: ratePercent(failed, requests),
    tokens: sumOf(counters, METRIC.tokensTotal),
    estimatedCostMicroUsd: sumOf(counters, METRIC.costMicroUsdTotal),
    actualCostMicroUsd: inputs.settledMicroUsd,
    providerAttempts,
    // Attempts beyond the first for each request: retries against the same
    // provider plus attempts against a provider we failed over to.
    retries: Math.max(0, providerAttempts - requests),
    failovers: sumOf(counters, METRIC.failoversTotal),
    circuitOpenEvents: sumOf(counters, METRIC.circuitOpenTotal),
    guardRejections: sumOf(counters, METRIC.guardRejectionsTotal),
    governanceBlocks: sumOf(counters, METRIC.governanceBlocksTotal),
    governanceFlags: sumOf(counters, METRIC.governanceFlagsTotal),
    redactions: sumOf(counters, METRIC.redactionsTotal),
  };

  // ── Per feature ───────────────────────────────────────────────────────────
  const featureIds = new Set<string>();
  for (const counter of counters) {
    if (typeof counter.labels.feature === 'string') featureIds.add(counter.labels.feature);
  }

  const features: FeatureUsage[] = [...featureIds]
    .sort()
    .map((featureId) => {
      const forFeature = (name: string, match?: (l: Readonly<Record<string, string>>) => boolean) =>
        sumOf(counters, name, (labels) => labels.feature === featureId && (match?.(labels) ?? true));
      const featureSucceeded = forFeature(METRIC.requestsTotal, (l) => l.outcome === 'success');
      const featureFailed = forFeature(METRIC.requestsTotal, (l) => l.outcome === 'error');
      const featureRequests = featureSucceeded + featureFailed;
      return {
        featureId,
        requests: featureRequests,
        succeeded: featureSucceeded,
        failed: featureFailed,
        tokens: forFeature(METRIC.tokensTotal),
        estimatedCostMicroUsd: forFeature(METRIC.costMicroUsdTotal),
        successRatePercent: ratePercent(featureSucceeded, featureRequests),
      };
    })
    // A feature with no requests carries no signal and only makes the console
    // harder to read during an incident.
    .filter((feature) => feature.requests > 0 || feature.tokens > 0);

  // ── Per provider ──────────────────────────────────────────────────────────
  const providerIds = new Set<string>();
  for (const counter of counters) {
    if (typeof counter.labels.provider === 'string') providerIds.add(counter.labels.provider);
  }
  for (const histogram of histograms) {
    if (typeof histogram.labels.provider === 'string') providerIds.add(histogram.labels.provider);
  }

  const providers: ProviderUsage[] = [...providerIds].sort().map((providerId) => {
    const forProvider = (name: string, match?: (l: Readonly<Record<string, string>>) => boolean) =>
      sumOf(counters, name, (labels) => labels.provider === providerId && (match?.(labels) ?? true));
    const providerSucceeded = forProvider(METRIC.providerAttemptsTotal, (l) => l.outcome === 'success');
    const providerFailed = forProvider(METRIC.providerAttemptsTotal, (l) => l.outcome === 'error');
    const attempts = providerSucceeded + providerFailed;

    // Latency is recorded per (provider, model). Several models under one
    // provider produce several histograms; the widest quantile is reported,
    // because a dashboard that averages tail latencies hides the tail.
    const providerHistograms = histograms.filter(
      (histogram) =>
        histogram.name === METRIC.providerLatencyMs && histogram.labels.provider === providerId,
    );
    const quantile = (pick: (h: (typeof providerHistograms)[number]) => number): number =>
      providerHistograms.reduce((max, histogram) => Math.max(max, pick(histogram)), 0);

    return {
      providerId,
      attempts,
      succeeded: providerSucceeded,
      failed: providerFailed,
      failovers: forProvider(METRIC.failoversTotal),
      circuitOpenEvents: forProvider(METRIC.circuitOpenTotal),
      successRatePercent: ratePercent(providerSucceeded, attempts),
      latency: {
        p50: quantile((h) => h.p50),
        p95: quantile((h) => h.p95),
        p99: quantile((h) => h.p99),
      },
    };
  });

  // ── Errors ────────────────────────────────────────────────────────────────
  const errorCounts = new Map<string, number>();
  for (const counter of counters) {
    if (counter.name !== METRIC.requestErrorsTotal) continue;
    const code = counter.labels.code ?? 'UNKNOWN';
    errorCounts.set(code, (errorCounts.get(code) ?? 0) + counter.value);
  }
  const errors: ErrorBreakdown[] = [...errorCounts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  const requestLatency = histograms.filter(
    (histogram) => histogram.name === METRIC.requestLatencyMs,
  );
  const latencyQuantile = (pick: (h: (typeof requestLatency)[number]) => number): number =>
    requestLatency.reduce((max, histogram) => Math.max(max, pick(histogram)), 0);

  return {
    generatedAt: inputs.generatedAt,
    window: 'process_lifetime',
    totals,
    features,
    providers,
    errors,
    latency: {
      p50: latencyQuantile((h) => h.p50),
      p95: latencyQuantile((h) => h.p95),
      p99: latencyQuantile((h) => h.p99),
    },
  };
}
