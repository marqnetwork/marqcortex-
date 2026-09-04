/**
 * Provider routing, failover breadth and economics (AI-01 Batch 4F).
 *
 * ── WHAT AN OPERATOR COMES TO THIS PANEL TO ANSWER ─────────────────────────
 *
 *   Where is traffic going, and why is it going there?
 *   What is the current strategy costing compared with the cheapest option?
 *   How far may one request fail over, and who decided that?
 *   Did a request stop failing over because it ran out of providers, or
 *     because it ran out of the money that was held for it?
 *
 * Every number here is reconciled from the same attempts the spend ledger
 * settled. The panel is a READ over that, plus one control.
 *
 * ── NO PROVIDER NAME APPEARS IN AN EXECUTABLE BRANCH ───────────────────────
 *
 * The Batch 4C property, kept: this file renders whatever providers the server
 * reports and has no opinion about which vendors exist. A provider added by a
 * later batch appears here with no frontend change.
 *
 * ── HIDING A CONTROL IS A COURTESY, NEVER A CONTROL ────────────────────────
 *
 * The strategy selector is drawn for an operator who holds the provider grant
 * and the breadth field for one who holds the settings grant, because that is
 * what the server demands for each. Drawing them for somebody else would be a
 * worse experience and not a weaker boundary — the server refuses the same
 * patch whether or not the field was rendered.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, GitBranch, Loader2, RefreshCw } from 'lucide-react';

import {
  fetchAIRouting,
  formatMicroUsd,
  hasAICapability,
  updateAISettings,
  type AIAdminCapability,
  type AIRoutingStrategy,
  type AIRoutingView,
} from '@/app/services/aiAdminService';

interface Props {
  accessToken?: string;
  capabilities: AIAdminCapability[];
  withReason: (prompt: string, run: (reason: string) => Promise<unknown>) => Promise<void>;
  notify: (message: string, kind?: 'success' | 'error') => void;
  busy: boolean;
}

/**
 * The strategies, with what each one actually optimises for.
 *
 * The descriptions state the INVARIANTS as well as the intent, because the
 * question an operator asks before switching to `cost` is "will this send
 * everything to the free mock?" — and the answer is no, by construction.
 */
const STRATEGIES: { id: AIRoutingStrategy; label: string; detail: string }[] = [
  {
    id: 'preference',
    label: 'Preference',
    detail:
      'The configured order: the pinned default first, the fallback last. The platform behaves exactly as it did before routing was configurable.',
  },
  {
    id: 'cost',
    label: 'Cost',
    detail:
      'Cheapest projected cost first, among providers that charge. A provider that charges nothing is never promoted above paid capacity.',
  },
  {
    id: 'latency',
    label: 'Latency',
    detail:
      'Fastest observed provider first. A provider that has never answered is unproven rather than fast, and is tried after the ones that have.',
  },
  {
    id: 'resilience',
    label: 'Resilience',
    detail:
      'Healthiest first: circuit state, then consecutive failures, then the observed failure ratio.',
  },
];

export function RoutingPanel({ accessToken, capabilities, withReason, notify, busy }: Props) {
  const [view, setView] = useState<AIRoutingView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const maySteer = hasAICapability(capabilities, 'ai.admin.provider.write');
  const mayBound = hasAICapability(capabilities, 'ai.admin.settings.write');

  const load = useCallback(async () => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setView(await fetchAIRouting(accessToken, 50));
      setError(null);
    } catch (err) {
      // Reported in place rather than blanking the console: an operator who may
      // read providers but not routing should still see everything else.
      setError(err instanceof Error ? err.message : 'The routing view is unavailable.');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const setStrategy = (strategy: AIRoutingStrategy) => {
    if (!accessToken || strategy === view?.strategy) return;
    void withReason(
      `Route AI traffic by ${strategy}. This changes which eligible provider serves first; it cannot make an ineligible provider eligible.`,
      async (reason) => {
        await updateAISettings(accessToken, { routing: { strategy } }, reason);
        await load();
        notify(`Routing strategy set to ${strategy}.`);
      },
    );
  };

  const setBreadth = (maxProviders: number) => {
    if (!accessToken || maxProviders === view?.maxProviders) return;
    void withReason(
      `Allow one request to be routed across at most ${maxProviders} provider(s).`,
      async (reason) => {
        const settings = await updateAISettings(accessToken, { routing: { maxProviders } }, reason);
        await load();
        notify(
          settings.routing.maxProviders === maxProviders
            ? `Failover breadth set to ${settings.routing.maxProviders}.`
            : `Failover breadth capped at ${settings.routing.maxProviders} by this deployment.`,
        );
      },
    );
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading routing state…
      </div>
    );
  }

  if (error || !view) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-semibold">Routing is not readable</p>
          <p className="mt-1">{error ?? 'No routing state was returned.'}</p>
        </div>
      </div>
    );
  }

  const { summary } = view;
  // Signed on purpose. Negative means the platform held more than it spent,
  // which is safe; positive means the projection is under-stating real spend,
  // which is the condition a ceiling exists to prevent.
  const varianceLabel = `${summary.varianceMicroUsd >= 0 ? '+' : '−'}${formatMicroUsd(
    Math.abs(summary.varianceMicroUsd),
  )}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-slate-400" />
          <h3 className="font-semibold text-slate-900">Routing</h3>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {/* ── Strategy ─────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h4 className="text-sm font-semibold text-slate-900">Strategy</h4>
        <p className="mt-1 text-xs text-slate-500">
          Routing orders providers the platform has already found eligible. It cannot enable a
          provider, admit an uncertified one, reach one without credentials, or spend money this
          deployment has not authorised.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {STRATEGIES.map((strategy) => {
            const active = view.strategy === strategy.id;
            return (
              <button
                key={strategy.id}
                type="button"
                disabled={!maySteer || busy}
                onClick={() => setStrategy(strategy.id)}
                className={`rounded-lg border p-3 text-left transition ${
                  active
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 disabled:opacity-60'
                }`}
              >
                <span className="text-sm font-semibold">{strategy.label}</span>
                <span
                  className={`mt-1 block text-xs ${active ? 'text-slate-200' : 'text-slate-500'}`}
                >
                  {strategy.detail}
                </span>
              </button>
            );
          })}
        </div>
        {!maySteer && (
          <p className="mt-3 text-xs text-slate-500">
            Changing the strategy requires provider administration.
          </p>
        )}
      </section>

      {/* ── Failover breadth ─────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h4 className="text-sm font-semibold text-slate-900">Failover breadth</h4>
        <p className="mt-1 text-xs text-slate-500">
          Providers one request may be routed across. It bounds latency and spend together: each
          additional provider is another vendor that can be dialled before a request gives up. This
          deployment permits at most {view.deploymentMaxProviders}.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {Array.from({ length: view.deploymentMaxProviders }, (_, index) => index + 1).map(
            (count) => (
              <button
                key={count}
                type="button"
                disabled={!mayBound || busy}
                onClick={() => setBreadth(count)}
                className={`h-9 w-9 rounded-lg border text-sm font-semibold ${
                  view.maxProviders === count
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-60'
                }`}
              >
                {count}
              </button>
            ),
          )}
          <span className="ml-2 text-xs text-slate-500">
            Failover is currently {view.failoverEnabled ? 'enabled' : 'disabled'}.
          </span>
        </div>
      </section>

      {/* ── Economics ────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h4 className="text-sm font-semibold text-slate-900">Economics since this instance started</h4>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Decisions" value={String(summary.decisions)} />
          <Metric label="Executions" value={String(summary.executions)} />
          <Metric label="Failovers" value={String(summary.failovers)} />
          <Metric label="Budget exhaustions" value={String(summary.budgetExhaustions)} />
          <Metric label="Projected" value={formatMicroUsd(summary.projectedMicroUsd)} />
          <Metric label="Realized" value={formatMicroUsd(summary.realizedMicroUsd)} />
          <Metric label="Variance" value={varianceLabel} />
          <Metric label="Routing premium" value={formatMicroUsd(summary.premiumMicroUsd)} />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          The premium is what this strategy accepted, per attempt, over the cheapest paid
          alternative. Under the cost strategy it is zero by construction. A budget exhaustion is a
          request that stopped failing over because it had spent the paid attempts reserved for it —
          not because it ran out of providers.
        </p>
      </section>

      {/* ── By provider ──────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h4 className="text-sm font-semibold text-slate-900">By provider</h4>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                <th className="pb-2 pr-4 font-medium">Provider</th>
                <th className="pb-2 pr-4 font-medium">Ranked first</th>
                <th className="pb-2 pr-4 font-medium">Served</th>
                <th className="pb-2 pr-4 font-medium">Failed</th>
                <th className="pb-2 pr-4 font-medium">Realized</th>
                <th className="pb-2 pr-4 font-medium">Premium</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary.providers.map((provider) => (
                <tr key={provider.providerId}>
                  <td className="py-2 pr-4 font-medium text-slate-800">{provider.providerId}</td>
                  <td className="py-2 pr-4 text-slate-700">{provider.chosen}</td>
                  <td className="py-2 pr-4 text-slate-700">{provider.served}</td>
                  <td className="py-2 pr-4 text-slate-700">{provider.failed}</td>
                  <td className="py-2 pr-4 text-slate-700">
                    {formatMicroUsd(provider.realizedMicroUsd)}
                  </td>
                  <td className="py-2 pr-4 text-slate-700">
                    {formatMicroUsd(provider.premiumMicroUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {summary.providers.length === 0 && (
            <p className="text-sm text-slate-500">No routing decision has been made yet.</p>
          )}
        </div>
      </section>

      {/* ── Recent decisions ─────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h4 className="text-sm font-semibold text-slate-900">Recent decisions</h4>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                <th className="pb-2 pr-4 font-medium">Feature</th>
                <th className="pb-2 pr-4 font-medium">Ranked first</th>
                <th className="pb-2 pr-4 font-medium">Served</th>
                <th className="pb-2 pr-4 font-medium">Attempts</th>
                <th className="pb-2 pr-4 font-medium">Realized</th>
                <th className="pb-2 pr-4 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {view.recent.map((outcome, index) => (
                <tr key={`${outcome.occurredAt}-${index}`}>
                  <td className="py-2 pr-4 text-slate-700">{outcome.featureId}</td>
                  <td className="py-2 pr-4 text-slate-700">{outcome.chosenProviderId}</td>
                  <td className="py-2 pr-4 text-slate-700">
                    {outcome.servedProviderId ?? '—'}
                    {outcome.servedProviderId !== undefined &&
                      outcome.servedProviderId !== outcome.chosenProviderId && (
                        <span className="ml-1 text-xs text-amber-600">failover</span>
                      )}
                  </td>
                  <td className="py-2 pr-4 text-slate-700">
                    {outcome.attempts}
                    <span className="text-xs text-slate-400">
                      {' '}
                      ({outcome.billableAttempts} paid)
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-slate-700">
                    {formatMicroUsd(outcome.realizedMicroUsd)}
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={
                        outcome.outcome === 'success' ? 'text-emerald-600' : 'text-rose-600'
                      }
                    >
                      {outcome.outcome}
                    </span>
                    {outcome.budgetExhausted && (
                      <span className="ml-1 text-xs text-amber-600">budget spent</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {view.recent.length === 0 && (
            <p className="text-sm text-slate-500">
              No AI request has been routed since this instance started.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}
