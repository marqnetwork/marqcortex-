/**
 * OPERATIONS — the operational awareness surface.
 *
 * Renders two server reads that G5 shipped with no consumer: the enterprise
 * health roll-up (blueprint §IV-51) and the enterprise KPI report (§IV-48).
 *
 * ── THIS PANEL RENDERS. IT DOES NOT JUDGE. ──────────────────────────────────
 *
 * Both server modules were written around one discipline, and a renderer is
 * exactly where that discipline gets lost. So, restated here:
 *
 *   `unknown` NEVER READS AS HEALTHY. It has its own word ("Not known"), its
 *   own colour (grey, never green), and it sorts ABOVE healthy so an operator
 *   scanning the page meets what is not known before what is fine.
 *
 *   A DIMENSION NOTHING MEASURES SAYS SO. `observable: false` is a different
 *   statement from "observable and currently unknown", the two look identical
 *   on a status page, and the server names them separately precisely so this
 *   page can too.
 *
 *   `value: null` IS NOT ZERO. An unmeasured indicator renders as "Not
 *   measured", never as 0. A platform where nothing has happened and a platform
 *   whose signal cannot be read are different states.
 *
 *   THERE ARE NO TARGETS, THRESHOLDS OR GRADES. §IV-48 defers every numeric
 *   target to a later phase, and the report restates `targetsInScope: false` on
 *   every read. This page renders that statement rather than dropping it, and
 *   draws no progress bar, no RAG rating and no score — all of which would
 *   imply a target nobody has agreed.
 *
 * The page also invents no demo data. With the backend off it says nothing is
 * knowable, because a fabricated green is worse than a blank page.
 */

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Activity,
  AlertTriangle,
  EyeOff,
  RefreshCw,
  ShieldAlert,
  HelpCircle,
} from 'lucide-react';
import {
  fetchEnterpriseHealth,
  fetchEnterpriseKpis,
  compareHealthStates,
  formatKpiValue,
  groupKpisByCategory,
  formatSuccessDimension,
  OperationalAwarenessError,
  HEALTH_STATE_LABELS,
  HEALTH_STATE_COLORS,
  HEALTH_DIMENSION_LABELS,
  KPI_CATEGORY_LABELS,
  type EnterpriseHealth,
  type DimensionHealth,
  type KpiReport,
  type KpiReading,
} from '@/app/services/operationalAwarenessService';

const ACCENT = '#06D7F6';

interface Props {
  accessToken?: string;
}

/** Relative time — "3 minutes ago" is what an operator is actually asking. */
function relativeTime(iso: string | undefined): string {
  if (!iso) return 'never';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 'unknown';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

// ── State pill ──────────────────────────────────────────────────────────────

function StatePill({ state }: { state: EnterpriseHealth['state'] }) {
  const color = HEALTH_STATE_COLORS[state];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider"
      style={{ background: `${color}1A`, color, border: `1px solid ${color}40` }}
    >
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {HEALTH_STATE_LABELS[state]}
    </span>
  );
}

// ── Dimension card ──────────────────────────────────────────────────────────

function DimensionCard({ dimension }: { dimension: DimensionHealth }) {
  // Worst-first within the dimension too: the reason to open a dimension is
  // whatever is wrong or unread in it, not whatever happens to be first.
  const signals = [...dimension.signals].sort((a, b) =>
    compareHealthStates(a.state, b.state),
  );

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-bold text-white truncate">
            {HEALTH_DIMENSION_LABELS[dimension.dimension]}
          </h3>
          {/* `observable: false` is its own statement, not a flavour of
              unknown. The server names it separately so this page can. */}
          {!dimension.observable && (
            <span
              className="inline-flex items-center gap-1 rounded-md border border-white/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-gray-500"
              title="Nothing in this dimension is machine-observable in this deployment"
            >
              <EyeOff className="size-2.5" />
              Not measured
            </span>
          )}
        </div>
        <StatePill state={dimension.state} />
      </div>

      {signals.length === 0 ? (
        <p className="px-4 py-4 text-xs text-gray-500 leading-relaxed">
          No signal is published for this dimension in this deployment. That is
          not a healthy reading — it is the absence of one.
        </p>
      ) : (
        <ul className="divide-y divide-white/5">
          {signals.map(signal => (
            <li key={signal.name} className="flex items-start gap-3 px-4 py-2.5">
              <span
                className="mt-1.5 size-1.5 rounded-full flex-shrink-0"
                style={{ background: HEALTH_STATE_COLORS[signal.state] }}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-mono text-[11px] text-gray-300">{signal.name}</span>
                  <span
                    className="text-[9px] font-bold uppercase tracking-wider"
                    style={{ color: HEALTH_STATE_COLORS[signal.state] }}
                  >
                    {HEALTH_STATE_LABELS[signal.state]}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 leading-relaxed mt-0.5">
                  {signal.detail}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── KPI reading ─────────────────────────────────────────────────────────────

function ReadingRow({ reading }: { reading: KpiReading }) {
  const formatted = formatKpiValue(reading);
  const measured = formatted !== null;

  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3 border-b border-white/5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-semibold text-white">{reading.name}</span>
          <span className="font-mono text-[9px] text-gray-600">{reading.id}</span>
        </div>
        <p className="text-[11px] text-gray-500 leading-relaxed mt-0.5">{reading.basis}</p>
        {/* Every indicator names the constitutional dimensions it serves —
            that is the condition of it being registered at all, so the page
            shows it rather than hiding the reason the number exists. */}
        <div className="flex flex-wrap gap-1 mt-1.5">
          {reading.serves.map(dimension => (
            <span
              key={dimension}
              className="rounded border border-white/10 px-1.5 py-0.5 text-[9px] text-gray-500"
            >
              {formatSuccessDimension(dimension)}
            </span>
          ))}
        </div>
      </div>

      <div className="text-right flex-shrink-0">
        {measured ? (
          <span className="text-lg font-black tabular-nums" style={{ color: ACCENT }}>
            {formatted}
          </span>
        ) : (
          // NOT '0'. A signal that could not be read is a different state from
          // a count of zero, and collapsing the two is how a KPI report becomes
          // reassuring at the exact moment it stops working.
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-gray-600">
            <HelpCircle className="size-3" />
            Not measured
          </span>
        )}
      </div>
    </div>
  );
}

// ── Empty / error states ────────────────────────────────────────────────────

function Notice({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: typeof Activity;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-6 py-10 text-center">
      <Icon className="mx-auto size-6 text-gray-600" />
      <h3 className="mt-3 text-sm font-bold text-white">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-md text-xs text-gray-500 leading-relaxed">{body}</p>
      {action}
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading operational awareness">
      {[0, 1, 2, 3].map(i => (
        <div
          key={i}
          className="h-24 rounded-xl border border-white/5 bg-white/[0.02] animate-pulse"
        />
      ))}
    </div>
  );
}

// ── Panel ───────────────────────────────────────────────────────────────────

export function OperationsPanel({ accessToken }: Props) {
  const [health, setHealth] = useState<EnterpriseHealth | null>(null);
  const [kpis, setKpis] = useState<KpiReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; forbidden: boolean } | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!accessToken) { setLoading(false); return; }
    if (!silent) setLoading(true);
    setError(null);
    try {
      // Read both together. They are independent surfaces, and one of them
      // failing should not blank the other — so failures are settled, not raced.
      const [healthResult, kpiResult] = await Promise.allSettled([
        fetchEnterpriseHealth(accessToken),
        fetchEnterpriseKpis(accessToken),
      ]);

      setHealth(healthResult.status === 'fulfilled' ? healthResult.value : null);
      setKpis(kpiResult.status === 'fulfilled' ? kpiResult.value : null);

      if (healthResult.status === 'rejected' && kpiResult.status === 'rejected') {
        // A refusal is a normal outcome for an operational page, not a crash.
        const reason = healthResult.reason;
        const awarenessError =
          reason instanceof OperationalAwarenessError ? reason : null;
        setError({
          message:
            awarenessError?.message ?? 'The operational awareness services are unavailable.',
          forbidden: awarenessError?.isForbidden ?? false,
        });
      }
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { void load(); }, [load]);

  const dimensions = health
    // Worst-first, so the page opens on what needs attention.
    ? [...health.dimensions].sort((a, b) => compareHealthStates(a.state, b.state))
    : [];

  return (
    <div className="flex flex-col h-full bg-[#0A0A0F] text-white overflow-auto">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="px-6 pt-6 pb-4 border-b border-white/10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="size-9 rounded-xl bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center shadow-lg shadow-[#8B5CF6]/20">
                <Activity className="size-4 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white tracking-tight">Operations</h1>
                <p className="text-xs text-gray-500 font-mono">
                  enterprise health · enterprise KPIs
                </p>
              </div>
              {health && <StatePill state={health.state} />}
            </div>
            <p className="text-sm text-gray-400 max-w-2xl mt-2">
              Signals this platform already publishes, rolled up to the four approved
              dimensions. No SLO, no threshold, no alert — and a signal that cannot be
              read says so rather than passing.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-shrink-0 mt-1">
            {health && (
              <span className="text-[11px] text-gray-600">
                read {relativeTime(health.generatedAt)}
              </span>
            )}
            <button
              onClick={() => void load()}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 border border-white/10 transition-colors disabled:opacity-40"
            >
              <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 px-6 py-5 space-y-8">
        {loading ? (
          <PanelSkeleton />
        ) : !accessToken || error ? (
          <Notice
            icon={error?.forbidden ? ShieldAlert : AlertTriangle}
            title={error?.forbidden ? 'Not authorized' : 'Unavailable'}
            body={
              error?.message ??
              'Operational awareness requires a signed-in team session.'
            }
            action={
              error?.forbidden ? undefined : (
                <button
                  onClick={() => void load()}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-white/5"
                >
                  <RefreshCw className="size-4" /> Retry
                </button>
              )
            }
          />
        ) : (
          <>
            {/* ── Health ─────────────────────────────────────────────── */}
            <motion.section
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              aria-labelledby="ops-health-heading"
            >
              <h2
                id="ops-health-heading"
                className="text-[10px] font-bold uppercase tracking-widest text-gray-600 mb-3"
              >
                Enterprise health
              </h2>

              {!health ? (
                <Notice
                  icon={AlertTriangle}
                  title="Health could not be read"
                  body="The enterprise health roll-up did not answer. Nothing is being reported as healthy in its place."
                />
              ) : (
                <>
                  {/* Named on the report rather than inferred from a state:
                      "we are not measuring this" is the most important thing a
                      health framework can say. */}
                  {health.unobservedDimensions.length > 0 && (
                    <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
                      <EyeOff className="mt-0.5 size-3.5 flex-shrink-0 text-gray-500" />
                      <p className="text-[11px] text-gray-400 leading-relaxed">
                        <strong className="font-semibold text-gray-300">
                          Not machine-observable in this deployment:
                        </strong>{' '}
                        {health.unobservedDimensions
                          .map(d => HEALTH_DIMENSION_LABELS[d])
                          .join(', ')}
                        . These dimensions are not reported as healthy — they are
                        not reported at all.
                      </p>
                    </div>
                  )}

                  <div className="grid gap-3 md:grid-cols-2">
                    {dimensions.map(dimension => (
                      <DimensionCard key={dimension.dimension} dimension={dimension} />
                    ))}
                  </div>
                </>
              )}
            </motion.section>

            {/* ── KPIs ───────────────────────────────────────────────── */}
            <motion.section
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              aria-labelledby="ops-kpi-heading"
            >
              <div className="flex items-baseline justify-between gap-4 mb-3">
                <h2
                  id="ops-kpi-heading"
                  className="text-[10px] font-bold uppercase tracking-widest text-gray-600"
                >
                  Enterprise KPIs
                </h2>
                {/* The server restates this on every report. Rendering it is
                    what stops a reader quietly treating these as scored. */}
                {kpis && kpis.targetsInScope === false && (
                  <span className="text-[10px] text-gray-600">
                    Measurements only — no targets, thresholds or grades in this phase
                  </span>
                )}
              </div>

              {!kpis ? (
                <Notice
                  icon={AlertTriangle}
                  title="KPIs could not be read"
                  body="The enterprise KPI report did not answer. No indicator is being shown as zero in its place."
                />
              ) : (
                <>
                  {kpis.unmeasured.length > 0 && (
                    <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
                      <HelpCircle className="mt-0.5 size-3.5 flex-shrink-0 text-gray-500" />
                      <p className="text-[11px] text-gray-400 leading-relaxed">
                        <strong className="font-semibold text-gray-300">
                          Could not be measured:
                        </strong>{' '}
                        <span className="font-mono">{kpis.unmeasured.join(', ')}</span>. These
                        are unread, not zero.
                      </p>
                    </div>
                  )}

                  <div className="space-y-4">
                    {groupKpisByCategory(kpis.readings).map(group => (
                      <div
                        key={group.category}
                        className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden"
                      >
                        <div className="px-4 py-2.5 border-b border-white/5">
                          <h3 className="text-xs font-bold text-white">
                            {KPI_CATEGORY_LABELS[group.category]}
                          </h3>
                        </div>
                        {group.readings.map(reading => (
                          <ReadingRow key={reading.id} reading={reading} />
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </motion.section>
          </>
        )}
      </div>
    </div>
  );
}
