/**
 * ANALYTICS DASHBOARD
 *
 * Pulls from two real Supabase endpoints:
 *   GET /analytics/overview  — server-aggregated fast stats
 *   GET /submissions          — full list for trend & distribution charts
 *
 * Charts (all recharts):
 *   1. KPI banner (5 live metrics)
 *   2. Status pipeline funnel
 *   3. Submission trend — AreaChart (last 14 days)
 *   4. Industry breakdown — horizontal BarChart
 *   5. Priority mix — PieChart / donut
 *   6. Score distribution — BarChart
 *   7. Quality metrics — progress bars
 */

import { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Zap, CheckCircle2, Clock, AlertCircle,
  Building2, BarChart3, Loader2, RefreshCw, Users, Target,
  ArrowUpRight, ArrowDownRight, Minus, Activity, FileText, Send, Eye, ThumbsUp,
} from 'lucide-react';
import { getAnalytics, getSubmissions, type Submission } from '@/app/services/dataService';
import { EngagementIntelligence } from '@/app/components/EngagementIntelligence';
import { isBackendEnabled, isVerboseLogging, canUseDemoFallback } from '@/config/runtime';

// ============================================================================
// COLOURS
// ============================================================================

const PURPLE = '#8B5CF6';
const BLUE   = '#3B82F6';
const CYAN   = '#06D7F6';
const ORANGE = '#FB923C';
const RED    = '#FD4438';
const GREEN  = '#10B981';
const GRAY   = '#70707C';

const STATUS_COLORS: Record<string, string> = {
  new:       PURPLE,
  'in-review': ORANGE,
  completed: BLUE,
  approved:  GREEN,
};

const PRIORITY_COLORS: Record<string, string> = {
  high:   RED,
  medium: ORANGE,
  low:    GRAY,
};

// ============================================================================
// TYPES
// ============================================================================

interface AnalyticsData {
  total: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  avgQuality: number;
  industryBreakdown: Record<string, number>;
  // Enhanced fields from server
  avgCompletion?: number;
  avgAiScore?: number;
  conversionRate?: number;
  avgTimeToReviewHours?: number | null;
  weeklyTrend?: { thisWeek: number; lastWeek: number; changePercent: number };
  proposalStats?: {
    total: number; draft: number; sent: number; viewed: number;
    accepted: number; rejected: number;
    conversionRate: number; viewRate: number;
  };
  highPriorityThisWeek?: number;
  dailyTrend?: { date: string; count: number }[];
  generatedAt?: string;
}

interface Props {
  accessToken?: string;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function AnalyticsDashboard({ accessToken }: Props) {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'engagement'>('overview');

  const load = async (silent = false) => {
    if (!accessToken) { setIsLoading(false); return; }
    if (!silent) setIsLoading(true); else setIsRefreshing(true);
    setError(null);
    try {
      // Check feature flag before making API calls
      if (!isBackendEnabled()) {
        if (isVerboseLogging()) {
          console.log('📦 Using demo data for analytics (backend disabled)');
        }
        // Generate demo analytics data
        const demoSubmissions: Submission[] = generateDemoSubmissions();
        setSubmissions(demoSubmissions);
        setAnalytics(computeAnalyticsFromSubmissions(demoSubmissions));
        setLastUpdated(new Date());
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      const [analyticsRes, submissionsRes] = await Promise.all([
        getAnalytics(accessToken),
        getSubmissions(accessToken),
      ]);
      setAnalytics(analyticsRes.analytics);
      setSubmissions(submissionsRes.submissions || []);
      setLastUpdated(new Date());
    } catch (err: any) {
      if (isVerboseLogging()) {
        console.error('❌ Analytics load error:', err);
      }

      if (canUseDemoFallback()) {
        // Demo mode only (defence-in-depth; unreachable in live mode because the
        // isBackendEnabled() guard above early-returns demo data before the fetch).
        const demoSubmissions: Submission[] = generateDemoSubmissions();
        setSubmissions(demoSubmissions);
        setAnalytics(computeAnalyticsFromSubmissions(demoSubmissions));
        setLastUpdated(new Date());
      } else {
        // Live mode: never fabricate analytics. Show an honest error + empty state.
        setError(err.message || 'Failed to load analytics');
        setSubmissions([]);
        setAnalytics(null);
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => { load(); }, [accessToken]);

  // Derived data — all memoised
  // Prefer server-supplied dailyTrend (UTC-correct); fall back to client-side build
  const trendData   = useMemo(
    () => (analytics?.dailyTrend?.length ? analytics.dailyTrend : buildTrendData(submissions)),
    [analytics, submissions],
  );
  const scoreDistData = useMemo(() => buildScoreDistribution(submissions), [submissions]);
  const industryData  = useMemo(() => buildIndustryData(analytics, submissions), [analytics, submissions]);
  const priorityData  = useMemo(() => buildPriorityData(analytics), [analytics]);
  const statusData    = useMemo(() => buildStatusData(analytics), [analytics]);
  const kpis          = useMemo(() => buildKPIs(analytics, submissions), [analytics, submissions]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <Loader2 className="size-10 text-[#8B5CF6] animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading analytics…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 min-h-full">
      {/* ── Header ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-white">Analytics</h1>
            {analytics?.weeklyTrend && analytics.weeklyTrend.lastWeek > 0 && (
              <span
                className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${
                  analytics.weeklyTrend.changePercent > 0
                    ? 'bg-[#10B981]/10 border-[#10B981]/30 text-[#10B981]'
                    : analytics.weeklyTrend.changePercent < 0
                    ? 'bg-[#FD4438]/10 border-[#FD4438]/30 text-[#FD4438]'
                    : 'bg-white/5 border-white/15 text-gray-400'
                }`}
              >
                {analytics.weeklyTrend.changePercent > 0 ? (
                  <ArrowUpRight className="size-3" />
                ) : analytics.weeklyTrend.changePercent < 0 ? (
                  <ArrowDownRight className="size-3" />
                ) : (
                  <Minus className="size-3" />
                )}
                {analytics.weeklyTrend.changePercent > 0 ? '+' : ''}{analytics.weeklyTrend.changePercent}% this week
              </span>
            )}
          </div>
          <p className="text-gray-400 text-sm">
            {lastUpdated
              ? `Last updated ${lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
              : 'Live data from Supabase'}
            {analytics?.generatedAt && (
              <span className="text-gray-600 ml-2">
                · Server aggregated {analytics.total} submissions
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-gray-400 hover:text-white transition-all text-sm"
        >
          <RefreshCw className={`size-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────── */}
      <div className="flex gap-1.5 p-1 bg-black/40 border border-white/10 rounded-xl w-fit">
        {([
          { id: 'overview',    label: 'Overview',               icon: BarChart3 },
          { id: 'engagement',  label: 'Engagement Intelligence', icon: Activity  },
        ] as { id: 'overview' | 'engagement'; label: string; icon: any }[]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] text-white shadow-lg'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <tab.icon className="size-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Engagement Intelligence tab ───────────────────────── */}
      {activeTab === 'engagement' && (
        <EngagementIntelligence accessToken={accessToken} />
      )}

      {/* ── Overview tab ─────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <span className="contents">
          {error && (
            <div className="p-3 bg-[#FD4438]/10 border border-[#FD4438]/30 rounded-xl text-sm text-[#FD4438]">
              ⚠️ {error} — showing computed data from submissions.
            </div>
          )}

          {/* ── KPI Banner ───────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {kpis.map((kpi, i) => (
              <KPICard key={kpi.label} kpi={kpi} delay={i * 0.05} />
            ))}
          </div>

          {/* ── Status Pipeline ──────────────────────────────────── */}
          <SectionCard title="Submission Pipeline" icon={Target} delay={0.1}>
            <div className="grid grid-cols-4 gap-3">
              {statusData.map((s, i) => (
                <PipelineStage key={s.label} stage={s} index={i} total={statusData.length} />
              ))}
            </div>
          </SectionCard>

          {/* ── Trend + Industry ─────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Trend — takes 3/5 */}
            <SectionCard title="Submission Trend (14 days)" icon={TrendingUp} delay={0.15} className="lg:col-span-3">
              {trendData.length > 1 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={trendData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="ad-trendGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={PURPLE} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={PURPLE} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fill: '#6B7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#6B7280', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip content={<DarkTooltip />} />
                    <Area
                      key="area-count"
                      type="monotone" dataKey="count" stroke={PURPLE}
                      strokeWidth={2.5} fill="url(#ad-trendGrad)"
                      dot={{ fill: PURPLE, r: 3, strokeWidth: 0 }}
                      activeDot={{ fill: PURPLE, r: 5, strokeWidth: 0 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="Submit more data to see trends" />
              )}
            </SectionCard>

            {/* Industry — takes 2/5 */}
            <SectionCard title="By Industry" icon={Building2} delay={0.2} className="lg:col-span-2">
              {industryData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    layout="vertical"
                    data={industryData.slice(0, 6)}
                    margin={{ top: 0, right: 10, left: 0, bottom: 0 }}
                  >
                    <XAxis type="number" tick={{ fill: '#6B7280', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis
                      type="category" dataKey="name" width={90}
                      tick={{ fill: '#9CA3AF', fontSize: 10 }}
                      axisLine={false} tickLine={false}
                    />
                    <Tooltip content={<DarkTooltip />} />
                    <Bar key="bar-industry" dataKey="count" radius={[0, 4, 4, 0]}>
                      {industryData.map((entry, idx) => (
                        <Cell key={`industry-cell-${entry.name}`} fill={[PURPLE, BLUE, CYAN, ORANGE, GREEN, RED][idx % 6]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="No industry data yet" />
              )}
            </SectionCard>
          </div>

          {/* ── Priority + Score Distribution ────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Priority donut */}
            <SectionCard title="Priority Breakdown" icon={AlertCircle} delay={0.25}>
              {priorityData.some(p => p.value > 0) ? (
                <div className="flex items-center gap-6">
                  <div style={{ width: 160, height: 160 }}>
                    <PieChart width={160} height={160}>
                      <Pie
                        data={priorityData} cx="50%" cy="50%"
                        innerRadius={45} outerRadius={70}
                        paddingAngle={3} dataKey="value"
                        strokeWidth={0}
                      >
                        {priorityData.map((entry) => (
                          <Cell key={`priority-cell-${entry.name}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip content={<DarkTooltip />} />
                    </PieChart>
                  </div>
                  <div className="flex-1 space-y-3">
                    {priorityData.map(p => (
                      <div key={p.name} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="size-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                          <span className="text-sm text-gray-300 capitalize">{p.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">{p.value}</span>
                          <span className="text-xs text-gray-500">
                            {analytics?.total ? `${Math.round((p.value / analytics.total) * 100)}%` : '—'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <EmptyChart message="No priority data yet" />
              )}
            </SectionCard>

            {/* Score distribution */}
            <SectionCard title="Quality Score Distribution" icon={BarChart3} delay={0.3}>
              {scoreDistData.some(d => d.count > 0) ? (
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={scoreDistData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="range" tick={{ fill: '#6B7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#6B7280', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip content={<DarkTooltip />} />
                    <Bar key="bar-score" dataKey="count" radius={[4, 4, 0, 0]}>
                      {scoreDistData.map((d) => (
                        <Cell key={`score-cell-${d.range}`} fill={d.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="No score data yet" />
              )}
            </SectionCard>
          </div>

          {/* ── Quality Metrics ──────────────────────────────────── */}
          <SectionCard title="Average Scores" icon={CheckCircle2} delay={0.35}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <ScoreBar
                label="Completion Score"
                value={analytics?.avgCompletion ?? avgScore(submissions, 'completionScore')}
                color={PURPLE}
                description="How thoroughly clients filled in the diagnostic"
              />
              <ScoreBar
                label="Quality Score"
                value={analytics?.avgQuality ?? avgScore(submissions, 'qualityScore')}
                color={BLUE}
                description="Answer depth and specificity"
              />
              <ScoreBar
                label="AI Analysis Score"
                value={analytics?.avgAiScore ?? avgScore(submissions, 'aiScore')}
                color={CYAN}
                description="Confidence of AI-generated insights"
              />
            </div>
            {analytics?.avgTimeToReviewHours != null && (
              <div className="mt-5 pt-5 border-t border-white/10 flex items-center gap-3">
                <div className="size-8 rounded-lg bg-[#FB923C]/15 flex items-center justify-center">
                  <Clock className="size-4 text-[#FB923C]" />
                </div>
                <div>
                  <span className="text-sm text-white font-semibold">
                    {analytics.avgTimeToReviewHours}h avg time-to-review
                  </span>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Average hours from submission to first review action
                  </p>
                </div>
              </div>
            )}
          </SectionCard>

          {/* ── Proposal Intelligence ─────────────────────────────── */}
          {analytics?.proposalStats && analytics.proposalStats.total > 0 && (
            <SectionCard title="Proposal Intelligence" icon={FileText} delay={0.38}>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                {[
                  { icon: FileText, label: 'Total Proposals', value: analytics.proposalStats.total,    color: GRAY   },
                  { icon: Send,     label: 'Sent to Clients', value: analytics.proposalStats.sent,     color: BLUE   },
                  { icon: Eye,      label: 'Viewed',          value: analytics.proposalStats.viewed,   color: CYAN   },
                  { icon: ThumbsUp, label: 'Accepted',        value: analytics.proposalStats.accepted, color: GREEN  },
                  { icon: AlertCircle, label: 'Rejected',     value: analytics.proposalStats.rejected, color: RED    },
                ].map(stat => (
                  <div
                    key={stat.label}
                    className="rounded-xl p-4 border text-center"
                    style={{ backgroundColor: `${stat.color}10`, borderColor: `${stat.color}25` }}
                  >
                    <stat.icon className="size-4 mx-auto mb-2" style={{ color: stat.color }} />
                    <div className="text-2xl font-bold" style={{ color: stat.color }}>{stat.value}</div>
                    <div className="text-[10px] text-gray-500 mt-1 leading-tight">{stat.label}</div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-white/4 rounded-xl border border-white/8">
                  <div className="text-xs text-gray-400 mb-1">View Rate (sent → viewed)</div>
                  <div className="flex items-end gap-2">
                    <span className="text-2xl font-bold" style={{ color: analytics.proposalStats.viewRate >= 60 ? GREEN : ORANGE }}>
                      {analytics.proposalStats.viewRate}%
                    </span>
                    <span className="text-xs text-gray-500 mb-0.5">of sent proposals viewed</span>
                  </div>
                  <div className="mt-2 h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${analytics.proposalStats.viewRate}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                      className="h-full rounded-full"
                      style={{ backgroundColor: analytics.proposalStats.viewRate >= 60 ? GREEN : ORANGE }}
                    />
                  </div>
                </div>
                <div className="p-4 bg-white/4 rounded-xl border border-white/8">
                  <div className="text-xs text-gray-400 mb-1">Close Rate (sent → accepted)</div>
                  <div className="flex items-end gap-2">
                    <span className="text-2xl font-bold" style={{ color: analytics.proposalStats.conversionRate >= 30 ? GREEN : analytics.proposalStats.conversionRate >= 15 ? ORANGE : RED }}>
                      {analytics.proposalStats.conversionRate}%
                    </span>
                    <span className="text-xs text-gray-500 mb-0.5">of sent proposals closed</span>
                  </div>
                  <div className="mt-2 h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${analytics.proposalStats.conversionRate}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut', delay: 0.1 }}
                      className="h-full rounded-full"
                      style={{ backgroundColor: analytics.proposalStats.conversionRate >= 30 ? GREEN : analytics.proposalStats.conversionRate >= 15 ? ORANGE : RED }}
                    />
                  </div>
                </div>
              </div>
            </SectionCard>
          )}

          {/* ── Conversion funnel mini table ─────────────────────── */}
          {submissions.length > 0 && (
            <SectionCard title="Pipeline Conversion" icon={TrendingUp} delay={0.4}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      {['Stage', 'Count', '% of Total', 'Drop-off'].map(h => (
                        <th key={h} className="text-left py-3 px-4 text-gray-400 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {statusData.map((stage, i) => {
                      const prev = i > 0 ? statusData[i - 1].count : stage.count;
                      const dropoff = prev > 0 && i > 0 ? Math.round(((prev - stage.count) / prev) * 100) : null;
                      const total = analytics?.total || submissions.length || 1;
                      return (
                        <tr key={stage.label} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <div className="size-2 rounded-full" style={{ backgroundColor: stage.color }} />
                              <span className="text-white font-medium">{stage.label}</span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-white font-bold">{stage.count}</td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-white/10 rounded-full max-w-24">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{
                                    width: `${Math.round((stage.count / total) * 100)}%`,
                                    backgroundColor: stage.color,
                                  }}
                                />
                              </div>
                              <span className="text-gray-400 text-xs">{Math.round((stage.count / total) * 100)}%</span>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            {dropoff !== null ? (
                              <span className={`text-xs font-medium ${dropoff > 30 ? 'text-[#FD4438]' : dropoff > 10 ? 'text-[#FB923C]' : 'text-[#10B981]'}`}>
                                {dropoff > 0 ? `−${dropoff}%` : 'No drop'}
                              </span>
                            ) : (
                              <span className="text-gray-600 text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}
        </span>
      )}
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function SectionCard({
  title, icon: Icon, children, delay = 0, className = '',
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      className={`bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-6 ${className}`}
    >
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-5 flex items-center gap-2">
        <Icon className="size-4" />
        {title}
      </h2>
      {children}
    </motion.div>
  );
}

function KPICard({ kpi, delay }: { kpi: ReturnType<typeof buildKPIs>[0]; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-5 hover:border-white/20 transition-colors"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="size-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${kpi.color}20` }}>
          <kpi.icon className="size-4" style={{ color: kpi.color }} />
        </div>
        {kpi.trend !== 'neutral' && (
          <div className={`flex items-center gap-1 text-xs font-medium ${kpi.trend === 'up' ? 'text-[#10B981]' : 'text-[#FD4438]'}`}>
            {kpi.trend === 'up' ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
          </div>
        )}
      </div>
      <div className="text-2xl font-bold text-white mb-1" style={{ color: kpi.color }}>
        {kpi.value}
      </div>
      <div className="text-xs text-gray-400 mb-1">{kpi.label}</div>
      {kpi.detail && (
        <div className="text-[10px] text-gray-600 truncate">{kpi.detail}</div>
      )}
    </motion.div>
  );
}

function PipelineStage({
  stage, index, total,
}: {
  stage: { label: string; count: number; color: string; key: string };
  index: number;
  total: number;
}) {
  return (
    <div className="text-center">
      <div
        className="rounded-xl p-4 mb-3 border"
        style={{ backgroundColor: `${stage.color}15`, borderColor: `${stage.color}30` }}
      >
        <div className="text-3xl font-bold mb-1" style={{ color: stage.color }}>
          {stage.count}
        </div>
        <div className="text-xs text-gray-400">{stage.label}</div>
      </div>
      {index < total - 1 && (
        <div className="hidden md:flex items-center justify-center absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10">
          <div className="text-gray-600">→</div>
        </div>
      )}
    </div>
  );
}

function ScoreBar({
  label, value, color, description,
}: {
  label: string; value: number; color: string; description: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-white">{label}</span>
        <span className="text-lg font-bold" style={{ color }}>{value}%</span>
      </div>
      <div className="h-2 bg-white/10 rounded-full mb-2 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
        />
      </div>
      <p className="text-xs text-gray-500">{description}</p>
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-40 text-gray-600">
      <div className="text-center">
        <BarChart3 className="size-10 mx-auto mb-2 opacity-30" />
        <p className="text-sm">{message}</p>
      </div>
    </div>
  );
}

function DarkTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#0A0A0F] border border-white/20 rounded-xl px-4 py-3 shadow-2xl">
      {label && <p className="text-xs text-gray-400 mb-1">{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} className="text-sm font-bold" style={{ color: p.color || p.fill || '#fff' }}>
          {p.name ? `${p.name}: ` : ''}{p.value}
        </p>
      ))}
    </div>
  );
}

// ============================================================================
// DATA BUILDERS
// ============================================================================

function generateDemoSubmissions(): Submission[] {
  const industries = ['Technology', 'Healthcare', 'E-commerce', 'Manufacturing', 'Finance'];
  const statuses: Array<'new' | 'in-review' | 'completed' | 'approved'> = ['new', 'in-review', 'completed', 'approved'];
  const priorities: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high'];
  
  const demos: Submission[] = [];
  for (let i = 0; i < 20; i++) {
    const daysAgo = Math.floor(Math.random() * 14);
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    
    demos.push({
      id: `demo_sub_${i + 1}`,
      company: `Demo Company ${i + 1}`,
      contact: `Contact ${i + 1}`,
      email: `contact${i + 1}@democompany.com`,
      phone: '(555) 123-4567',
      website: `www.demo${i + 1}.com`,
      industry: industries[i % industries.length],
      industryId: industries[i % industries.length].toLowerCase(),
      employees: i % 3 === 0 ? '10-50' : i % 3 === 1 ? '51-200' : '201-500',
      revenue: i % 3 === 0 ? '$1M-$5M' : i % 3 === 1 ? '$5M-$20M' : '$20M-$50M',
      submittedAt: date.toISOString(),
      submittedDate: date.toLocaleDateString(),
      status: statuses[i % statuses.length],
      priority: priorities[i % priorities.length],
      completionScore: 60 + Math.floor(Math.random() * 35),
      qualityScore: 70 + Math.floor(Math.random() * 25),
      aiScore: 65 + Math.floor(Math.random() * 30),
      roiPotential: i % 2 === 0 ? 'High' : 'Medium',
      answers: { 1: 'Demo answer', 2: 'Demo answer 2' },
      isRead: i % 2 === 0,
    });
  }
  
  return demos;
}

function computeAnalyticsFromSubmissions(subs: Submission[]): AnalyticsData {
  const byStatus: Record<string, number> = { new: 0, 'in-review': 0, completed: 0, approved: 0 };
  const byPriority: Record<string, number> = { high: 0, medium: 0, low: 0 };
  const industryBreakdown: Record<string, number> = {};
  let totalQuality = 0;

  subs.forEach(s => {
    byStatus[s.status] = (byStatus[s.status] || 0) + 1;
    byPriority[s.priority] = (byPriority[s.priority] || 0) + 1;
    industryBreakdown[s.industry] = (industryBreakdown[s.industry] || 0) + 1;
    totalQuality += s.qualityScore || 0;
  });

  return {
    total: subs.length,
    byStatus,
    byPriority,
    avgQuality: subs.length > 0 ? Math.round(totalQuality / subs.length) : 0,
    industryBreakdown,
  };
}

function buildTrendData(submissions: Submission[]) {
  const today = new Date();
  const days: { date: string; count: number }[] = [];

  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const dateStr = d.toISOString().split('T')[0];

    const count = submissions.filter(s => {
      const subDate = s.submittedAt?.split('T')[0];
      return subDate === dateStr;
    }).length;

    days.push({ date: label, count });
  }

  return days;
}

function buildScoreDistribution(submissions: Submission[]) {
  const ranges = [
    { range: '0–25',   min: 0,  max: 25,  color: RED },
    { range: '26–50',  min: 26, max: 50,  color: ORANGE },
    { range: '51–75',  min: 51, max: 75,  color: BLUE },
    { range: '76–100', min: 76, max: 100, color: GREEN },
  ];

  return ranges.map(r => ({
    ...r,
    count: submissions.filter(s => s.qualityScore >= r.min && s.qualityScore <= r.max).length,
  }));
}

function buildIndustryData(analytics: AnalyticsData | null, submissions: Submission[]) {
  const breakdown = analytics?.industryBreakdown
    ?? computeAnalyticsFromSubmissions(submissions).industryBreakdown;

  return Object.entries(breakdown)
    .map(([name, count]) => ({
      name: name.length > 18 ? name.substring(0, 16) + '…' : name,
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

function buildPriorityData(analytics: AnalyticsData | null) {
  if (!analytics) return [];
  return [
    { name: 'High',   value: analytics.byPriority.high   || 0, color: RED },
    { name: 'Medium', value: analytics.byPriority.medium || 0, color: ORANGE },
    { name: 'Low',    value: analytics.byPriority.low    || 0, color: GRAY },
  ];
}

function buildStatusData(analytics: AnalyticsData | null) {
  if (!analytics) return [];
  return [
    { key: 'new',       label: 'New',        count: analytics.byStatus.new        || 0, color: PURPLE },
    { key: 'in-review', label: 'In Review',  count: analytics.byStatus['in-review'] || 0, color: ORANGE },
    { key: 'completed', label: 'Completed',  count: analytics.byStatus.completed  || 0, color: BLUE },
    { key: 'approved',  label: 'Converted',  count: analytics.byStatus.approved   || 0, color: GREEN },
  ];
}

interface KPI {
  label: string;
  value: string;
  color: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  trend: 'up' | 'down' | 'neutral';
  detail?: string;
}

function buildKPIs(analytics: AnalyticsData | null, submissions: Submission[]): KPI[] {
  const total        = analytics?.total ?? submissions.length;
  const highPriority = analytics?.byPriority.high ?? submissions.filter(s => s.priority === 'high').length;
  const approved     = analytics?.byStatus.approved ?? submissions.filter(s => s.status === 'approved').length;
  const convRate     = analytics?.conversionRate ?? (total > 0 ? Math.round((approved / total) * 100) : 0);

  // Week-over-week from server (falls back to client-side count if absent)
  const wt          = analytics?.weeklyTrend;
  const weekAgo     = new Date(Date.now() - 7 * 86400000);
  const newThisWeek = wt?.thisWeek ?? submissions.filter(s => new Date(s.submittedAt) > weekAgo).length;
  const weekChange  = wt?.changePercent ?? 0;

  const avgQuality  = analytics?.avgQuality ?? avgScore(submissions, 'qualityScore');

  return [
    {
      label:  'Total Submissions',
      value:  String(total),
      color:  PURPLE,
      icon:   Users,
      trend:  'neutral',
      detail: wt ? `${wt.thisWeek} this week` : undefined,
    },
    {
      label:  'New This Week',
      value:  String(newThisWeek),
      color:  BLUE,
      icon:   Zap,
      trend:  weekChange > 0 ? 'up' : weekChange < 0 ? 'down' : 'neutral',
      detail: wt && wt.lastWeek > 0
        ? `${weekChange > 0 ? '+' : ''}${weekChange}% vs last week`
        : undefined,
    },
    {
      label:  'Avg Quality Score',
      value:  `${avgQuality}%`,
      color:  avgQuality >= 75 ? GREEN : avgQuality >= 50 ? ORANGE : RED,
      icon:   BarChart3,
      trend:  avgQuality >= 70 ? 'up' : 'down',
      detail: analytics?.avgCompletion != null
        ? `${analytics.avgCompletion}% completion avg`
        : undefined,
    },
    {
      label:  'High Priority',
      value:  String(highPriority),
      color:  highPriority > 0 ? RED : GRAY,
      icon:   AlertCircle,
      trend:  highPriority > 3 ? 'down' : 'neutral',
      detail: analytics?.highPriorityThisWeek != null
        ? `${analytics.highPriorityThisWeek} this week`
        : undefined,
    },
    {
      label:  'Conversion Rate',
      value:  `${convRate}%`,
      color:  convRate >= 20 ? GREEN : convRate >= 10 ? ORANGE : GRAY,
      icon:   TrendingUp,
      trend:  convRate >= 15 ? 'up' : 'neutral',
      detail: analytics?.proposalStats
        ? `${analytics.proposalStats.conversionRate}% proposal close rate`
        : undefined,
    },
  ];
}

function avgScore(submissions: Submission[], key: 'completionScore' | 'qualityScore' | 'aiScore'): number {
  if (!submissions.length) return 0;
  return Math.round(submissions.reduce((s, sub) => s + (sub[key] || 0), 0) / submissions.length);
}