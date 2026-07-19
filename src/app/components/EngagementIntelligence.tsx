/**
 * ENGAGEMENT INTELLIGENCE — Phase 3D
 *
 * Synthesises all Phase 3 data into actionable analytics:
 *   - Report delivery funnel (Phase 3C engagement tracking)
 *   - Notes activity (Phase 3B team notes)
 *   - Client intent signals (top engaged leads table)
 *   - Unified recent activity feed
 *
 * Fetches from GET /analytics/engagement
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
} from 'recharts';
import {
  Eye, Calendar, FileText, MessageSquare, RefreshCw, Loader2,
  AlertTriangle, TrendingUp, CheckCircle2, Zap, StickyNote,
  Lightbulb, Flag, ArrowRight, Clock, Download, Activity,
  BarChart3, Target,
} from 'lucide-react';
import { getEngagementAnalytics, type EngagementAnalytics } from '@/app/services/dataService';
import { isBackendEnabled, isVerboseLogging, canUseDemoFallback } from '@/config/runtime';

// ── Colours ────────────────────────────────────────────────────────────────

const PURPLE = '#8B5CF6';
const BLUE   = '#3B82F6';
const CYAN   = '#06D7F6';
const ORANGE = '#FB923C';
const RED    = '#FD4438';
const GREEN  = '#10B981';

const NOTE_TYPE_COLOURS: Record<string, string> = {
  note:    '#9CA3AF',
  action:  ORANGE,
  flag:    RED,
  insight: PURPLE,
};

const NOTE_TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  note:    StickyNote,
  action:  Zap,
  flag:    Flag,
  insight: Lightbulb,
};

const ACTIVITY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  report_viewed: Eye,
  cta_clicked:   Calendar,
  pdf_printed:   Download,
  note_added:    MessageSquare,
};

const ACTIVITY_COLOURS: Record<string, string> = {
  report_viewed: CYAN,
  cta_clicked:   GREEN,
  pdf_printed:   PURPLE,
  note_added:    ORANGE,
};

const ACTIVITY_LABELS: Record<string, string> = {
  report_viewed: 'Report viewed',
  cta_clicked:   'CTA clicked',
  pdf_printed:   'PDF saved',
  note_added:    'Note added',
};

// ── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function pct(n: number) {
  return `${n}%`;
}

// ── Props ───────────────────────────────────────────────────────────────────

interface Props {
  accessToken?: string;
}

// ── Component ───────────────────────────────────────────────────────────────

export function EngagementIntelligence({ accessToken }: Props) {
  const [data, setData] = useState<EngagementAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!accessToken) { setIsLoading(false); return; }
    if (!silent) setIsLoading(true); else setIsRefreshing(true);
    setError(null);
    try {
      // Check feature flag before making API calls
      if (!isBackendEnabled()) {
        if (isVerboseLogging()) {
          console.log('📦 Using demo data for engagement analytics (backend disabled)');
        }
        // Generate demo engagement data
        const demoData: EngagementAnalytics = {
          reportDelivery: {
            reportAvailable: 15,
            totalViewed: 12,
            totalCTAClicked: 8,
            totalPDFSaved: 5,
            totalViews: 34,
            avgViewsPerViewed: 2.8,
            viewRate: 80,
            ctaRate: 67,
            pdfRate: 42,
          },
          notes: {
            total: 47,
            submissionsWithNotes: 10,
            byType: { note: 20, action: 15, flag: 7, insight: 5 },
            topCommented: [
              { id: 'demo_1', company: 'Demo Company 1', count: 8 },
              { id: 'demo_2', company: 'Demo Company 2', count: 6 },
              { id: 'demo_3', company: 'Demo Company 3', count: 5 },
            ],
          },
          topEngagedLeads: [
            {
              id: 'demo_1',
              company: 'High Engagement Co',
              industry: 'Technology',
              status: 'completed',
              viewCount: 5,
              lastViewedAt: new Date(Date.now() - 3600000).toISOString(),
              ctaClicked: true,
              pdfSaved: true,
              noteCount: 8,
              engagementScore: 95,
            },
            {
              id: 'demo_2',
              company: 'Active Prospect Inc',
              industry: 'Healthcare',
              status: 'in-review',
              viewCount: 3,
              lastViewedAt: new Date(Date.now() - 7200000).toISOString(),
              ctaClicked: true,
              pdfSaved: false,
              noteCount: 6,
              engagementScore: 78,
            },
          ],
          recentActivity: [
            {
              type: 'report_viewed',
              company: 'Demo Company 1',
              detail: 'Viewed report 3rd time',
              timestamp: new Date(Date.now() - 1800000).toISOString(),
              submissionId: 'demo_1',
            },
            {
              type: 'cta_clicked',
              company: 'Demo Company 2',
              detail: 'Clicked "Schedule Call"',
              timestamp: new Date(Date.now() - 3600000).toISOString(),
              submissionId: 'demo_2',
            },
          ],
        };
        setData(demoData);
        setLastUpdated(new Date());
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      const res = await getEngagementAnalytics(accessToken);
      setData(res.engagement);
      setLastUpdated(new Date());
    } catch (err: any) {
      if (isVerboseLogging()) {
        console.error('❌ Engagement analytics error:', err);
      }
      
      if (canUseDemoFallback()) {
        // Demo mode only (defence-in-depth; unreachable in live mode because the
        // isBackendEnabled() guard above early-returns demo data before the fetch).
        const demoData: EngagementAnalytics = {
          reportDelivery: {
            reportAvailable: 15,
            totalViewed: 12,
            totalCTAClicked: 8,
            totalPDFSaved: 5,
            totalViews: 34,
            avgViewsPerViewed: 2.8,
            viewRate: 80,
            ctaRate: 67,
            pdfRate: 42,
          },
          notes: {
            total: 47,
            submissionsWithNotes: 10,
            byType: { note: 20, action: 15, flag: 7, insight: 5 },
            topCommented: [
              { id: 'demo_1', company: 'Demo Company 1', count: 8 },
            ],
          },
          topEngagedLeads: [],
          recentActivity: [],
        };
        setData(demoData);
        setLastUpdated(new Date());
      } else {
        // Live mode: never fabricate engagement metrics. Show an honest error state.
        setError(err.message || 'Failed to load engagement data');
        setData(null);
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [accessToken]);

  useEffect(() => { load(); }, [load]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-80">
        <div className="text-center">
          <Loader2 className="size-10 text-[#8B5CF6] animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading engagement data…</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex items-center justify-center min-h-80">
        <div className="text-center max-w-sm">
          <AlertTriangle className="size-10 text-[#FD4438] mx-auto mb-4" />
          <p className="text-white font-semibold mb-2">Failed to load engagement analytics</p>
          <p className="text-gray-500 text-sm mb-5">{error}</p>
          <button
            onClick={() => load()}
            className="px-5 py-2.5 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-xl text-sm font-medium transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Empty state (no engagement yet) ──
  if (!data || (data.reportDelivery.totalViewed === 0 && data.notes.total === 0)) {
    return <EngagementEmptyState onRefresh={() => load(true)} isRefreshing={isRefreshing} />;
  }

  const { reportDelivery, notes, topEngagedLeads, recentActivity } = data;

  // ── Note type donut data ──
  const noteDonutData = Object.entries(notes.byType)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ name: k, value: v, color: NOTE_TYPE_COLOURS[k] }));

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Activity className="size-5 text-[#8B5CF6]" />
            Engagement Intelligence
          </h2>
          <p className="text-gray-400 text-sm mt-0.5">
            {lastUpdated
              ? `Last updated ${lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
              : 'Live data from Phase 3A · 3B · 3C'}
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

      {/* ── Phase source legend ── */}
      <div className="flex items-center gap-3 flex-wrap">
        {[
          { label: '3A Notifications', color: BLUE },
          { label: '3B Team Notes',    color: ORANGE },
          { label: '3C Client Delivery', color: CYAN },
        ].map(({ label, color }) => (
          <div key={label} className="flex items-center gap-1.5 text-xs text-gray-500">
            <div className="size-2 rounded-full" style={{ backgroundColor: color }} />
            {label}
          </div>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 1 — REPORT DELIVERY KPIs
      ═══════════════════════════════════════════════════════════════════ */}
      <ECard title="Report Delivery" icon={FileText}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            {
              label: 'Report View Rate',
              value: pct(reportDelivery.viewRate),
              sub: `${reportDelivery.totalViewed} of ${reportDelivery.reportAvailable} delivered`,
              color: CYAN,
              icon: Eye,
              tooltip: '% of published reports opened by clients',
            },
            {
              label: 'CTA Conversion',
              value: pct(reportDelivery.ctaRate),
              sub: `${reportDelivery.totalCTAClicked} clicked Schedule Call`,
              color: GREEN,
              icon: Calendar,
              tooltip: '% of report viewers who clicked the CTA',
            },
            {
              label: 'PDF Save Rate',
              value: pct(reportDelivery.pdfRate),
              sub: `${reportDelivery.totalPDFSaved} reports saved`,
              color: PURPLE,
              icon: Download,
              tooltip: '% of viewers who saved as PDF',
            },
            {
              label: 'Avg Views / Report',
              value: String(reportDelivery.avgViewsPerViewed),
              sub: `${reportDelivery.totalViews} total views`,
              color: ORANGE,
              icon: TrendingUp,
              tooltip: 'Average times each viewed report was opened',
            },
          ].map((kpi, i) => (
            <motion.div
              key={kpi.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="bg-black/30 border border-white/8 rounded-xl p-4"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="size-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${kpi.color}20` }}>
                  <kpi.icon className="size-4" style={{ color: kpi.color }} />
                </div>
              </div>
              <div className="text-2xl font-black mb-1" style={{ color: kpi.color }}>{kpi.value}</div>
              <div className="text-xs font-semibold text-white mb-1">{kpi.label}</div>
              <div className="text-xs text-gray-600">{kpi.sub}</div>
            </motion.div>
          ))}
        </div>

        {/* Delivery funnel */}
        <div className="bg-black/20 border border-white/5 rounded-xl p-5">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">
            Delivery Funnel
          </p>
          <div className="flex items-center gap-0 overflow-x-auto pb-1">
            {[
              { label: 'Reports Delivered', count: reportDelivery.reportAvailable, color: BLUE },
              { label: 'Report Viewed',     count: reportDelivery.totalViewed,     color: CYAN },
              { label: 'CTA Clicked',       count: reportDelivery.totalCTAClicked, color: GREEN },
              { label: 'PDF Saved',         count: reportDelivery.totalPDFSaved,   color: PURPLE },
            ].map((stage, i, arr) => {
              const prevCount = i > 0 ? arr[i - 1].count : stage.count;
              const dropPct   = prevCount > 0 && i > 0
                ? Math.round(((prevCount - stage.count) / prevCount) * 100)
                : null;
              return (
                <div key={stage.label} className="flex items-center">
                  <div className="text-center min-w-[96px]">
                    <div
                      className="rounded-xl px-3 py-3 border text-center mb-2"
                      style={{ backgroundColor: `${stage.color}12`, borderColor: `${stage.color}30` }}
                    >
                      <div className="text-2xl font-black" style={{ color: stage.color }}>
                        {stage.count}
                      </div>
                    </div>
                    <div className="text-[10px] text-gray-500 leading-tight px-1">{stage.label}</div>
                    {dropPct !== null && (
                      <div className={`text-[10px] font-semibold mt-0.5 ${dropPct > 40 ? 'text-[#FD4438]' : dropPct > 20 ? 'text-[#FB923C]' : 'text-[#10B981]'}`}>
                        {dropPct > 0 ? `−${dropPct}%` : 'No drop'}
                      </div>
                    )}
                  </div>
                  {i < arr.length - 1 && (
                    <ArrowRight className="size-4 text-gray-700 flex-shrink-0 mx-1" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </ECard>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 2 — NOTES ACTIVITY  +  TOP ENGAGED LEADS
      ═══════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Notes Activity */}
        <ECard title="Notes Activity" icon={MessageSquare}>
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { label: 'Total Notes',        value: notes.total,              color: ORANGE },
              { label: 'Leads with Notes',   value: notes.submissionsWithNotes, color: BLUE },
              { label: 'Avg Notes / Lead',   value: notes.submissionsWithNotes > 0
                  ? (notes.total / notes.submissionsWithNotes).toFixed(1) : '0', color: PURPLE },
            ].map(m => (
              <div key={m.label} className="bg-black/30 border border-white/8 rounded-xl p-3 text-center">
                <div className="text-2xl font-black mb-0.5" style={{ color: m.color }}>{m.value}</div>
                <div className="text-[10px] text-gray-500">{m.label}</div>
              </div>
            ))}
          </div>

          {/* Donut + legend */}
          {noteDonutData.length > 0 ? (
            <div className="flex items-center gap-5">
              <ResponsiveContainer width={120} height={120}>
                <PieChart>
                  <Pie
                    data={noteDonutData}
                    cx="50%" cy="50%"
                    innerRadius={32} outerRadius={52}
                    paddingAngle={3} dataKey="value"
                    strokeWidth={0}
                  >
                    {noteDonutData.map((d, i) => (
                      <Cell key={i} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) =>
                      active && payload?.length ? (
                        <div className="bg-[#0A0A0F] border border-white/20 rounded-xl px-3 py-2 text-xs">
                          <span className="capitalize font-bold" style={{ color: payload[0].payload.color }}>
                            {payload[0].name}
                          </span>
                          <span className="text-gray-300 ml-1">× {payload[0].value}</span>
                        </div>
                      ) : null
                    }
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-2.5">
                {Object.entries(notes.byType).map(([type, count]) => {
                  const Icon = NOTE_TYPE_ICONS[type] ?? StickyNote;
                  const color = NOTE_TYPE_COLOURS[type];
                  const total = notes.total || 1;
                  return (
                    <div key={type} className="flex items-center gap-2">
                      <Icon className="size-3.5 flex-shrink-0" style={{ color }} />
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-xs capitalize text-gray-300">{type}</span>
                          <span className="text-xs font-bold" style={{ color }}>{count}</span>
                        </div>
                        <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.round((count / total) * 100)}%` }}
                            transition={{ duration: 0.7, ease: 'easeOut' }}
                            className="h-full rounded-full"
                            style={{ backgroundColor: color }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-24 text-gray-600">
              <MessageSquare className="size-8 opacity-30 mb-2" />
              <p className="text-xs">No notes yet</p>
            </div>
          )}

          {/* Top commented */}
          {notes.topCommented.length > 0 && (
            <div className="mt-5 pt-5 border-t border-white/8">
              <p className="text-[10px] font-bold text-gray-600 uppercase tracking-wider mb-3">
                Most Discussed Leads
              </p>
              <div className="space-y-2">
                {notes.topCommented.slice(0, 4).map((item, i) => (
                  <div key={item.id} className="flex items-center gap-3">
                    <span className="text-gray-700 text-xs w-4">{i + 1}</span>
                    <span className="flex-1 text-gray-300 text-xs truncate">{item.company}</span>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#FB923C]/15 text-[#FB923C]">
                      {item.count} notes
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </ECard>

        {/* Top Engaged Leads */}
        <ECard title="Most Engaged Clients" icon={Target}>
          {topEngagedLeads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-gray-600">
              <Eye className="size-8 opacity-30 mb-2" />
              <p className="text-xs">No engagement data yet</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {topEngagedLeads.slice(0, 7).map((lead, i) => (
                <motion.div
                  key={lead.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center gap-3 p-3 bg-black/25 border border-white/6 rounded-xl"
                >
                  {/* Rank */}
                  <div className="size-6 rounded-full bg-white/5 flex items-center justify-center text-[10px] font-bold text-gray-500 flex-shrink-0">
                    {i + 1}
                  </div>

                  {/* Company + industry */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{lead.company}</div>
                    <div className="text-xs text-gray-600 truncate">{lead.industry}</div>
                  </div>

                  {/* Signal icons */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#06D7F6]/10 text-[10px] font-bold text-[#06D7F6]">
                      <Eye className="size-2.5" />
                      {lead.viewCount}
                    </div>
                    {lead.ctaClicked && (
                      <div className="size-5 rounded bg-[#10B981]/15 flex items-center justify-center" title="CTA clicked">
                        <Calendar className="size-3 text-[#10B981]" />
                      </div>
                    )}
                    {lead.pdfSaved && (
                      <div className="size-5 rounded bg-[#8B5CF6]/15 flex items-center justify-center" title="PDF saved">
                        <Download className="size-3 text-[#8B5CF6]" />
                      </div>
                    )}
                    {lead.noteCount > 0 && (
                      <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#FB923C]/10 text-[10px] font-bold text-[#FB923C]">
                        <MessageSquare className="size-2.5" />
                        {lead.noteCount}
                      </div>
                    )}
                  </div>

                  {/* Engagement score */}
                  <div
                    className="text-xs font-black w-10 text-right flex-shrink-0"
                    style={{ color: lead.engagementScore >= 50 ? GREEN : lead.engagementScore >= 20 ? ORANGE : '#6B7280' }}
                  >
                    {lead.engagementScore}
                  </div>
                </motion.div>
              ))}
              {topEngagedLeads.length > 7 && (
                <p className="text-xs text-gray-600 text-center pt-1">
                  +{topEngagedLeads.length - 7} more engaged leads
                </p>
              )}
            </div>
          )}
        </ECard>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 3 — RECENT ACTIVITY FEED
      ═══════════════════════════════════════════════════════════════════ */}
      <ECard title="Recent Activity Feed" icon={Activity}>
        {recentActivity.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-600">
            <Clock className="size-8 opacity-30 mb-2" />
            <p className="text-sm">No activity yet — activity appears here as clients engage with reports and team adds notes</p>
          </div>
        ) : (
          <div className="space-y-0 divide-y divide-white/5">
            {recentActivity.map((event, i) => {
              const Icon  = ACTIVITY_ICONS[event.type]  ?? Activity;
              const color = ACTIVITY_COLOURS[event.type] ?? '#6B7280';
              const label = ACTIVITY_LABELS[event.type]  ?? event.type;
              return (
                <motion.div
                  key={`${event.submissionId}-${event.type}-${i}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.025 }}
                  className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
                >
                  {/* Icon */}
                  <div
                    className="size-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ backgroundColor: `${color}18` }}
                  >
                    <Icon className="size-3.5" style={{ color }} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold" style={{ color }}>{label}</span>
                      <span className="text-white text-xs font-medium truncate">{event.company}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{event.detail}</p>
                  </div>

                  {/* Time */}
                  <div className="text-[10px] text-gray-700 flex-shrink-0 mt-0.5 whitespace-nowrap">
                    {timeAgo(event.timestamp)}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </ECard>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function ECard({
  title, icon: Icon, children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-6"
    >
      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-5 flex items-center gap-2">
        <Icon className="size-4" />
        {title}
      </h3>
      {children}
    </motion.div>
  );
}

function EngagementEmptyState({ onRefresh, isRefreshing }: { onRefresh: () => void; isRefreshing: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-black/40 border border-white/10 rounded-2xl p-12 text-center"
    >
      <div className="size-16 rounded-2xl bg-gradient-to-br from-[#8B5CF6]/20 to-[#3B82F6]/20 border border-[#8B5CF6]/30 flex items-center justify-center mx-auto mb-5">
        <Activity className="size-8 text-[#8B5CF6]" />
      </div>
      <h3 className="text-xl font-bold text-white mb-2">No Engagement Data Yet</h3>
      <p className="text-gray-500 text-sm max-w-md mx-auto mb-6 leading-relaxed">
        Engagement data appears here once clients view their reports, click CTAs, or save PDFs.
        Team notes activity from Phase 3B will also surface here.
      </p>

      <div className="grid grid-cols-3 gap-3 max-w-sm mx-auto mb-8">
        {[
          { icon: Eye,            label: 'Report viewed',  color: CYAN   },
          { icon: Calendar,       label: 'CTA clicked',    color: GREEN  },
          { icon: MessageSquare,  label: 'Note added',     color: ORANGE },
        ].map(({ icon: Icon, label, color }) => (
          <div key={label} className="bg-black/30 border border-white/8 rounded-xl p-3 text-center">
            <div className="size-8 rounded-lg flex items-center justify-center mx-auto mb-2" style={{ backgroundColor: `${color}18` }}>
              <Icon className="size-4" style={{ color }} />
            </div>
            <div className="text-[10px] text-gray-500">{label}</div>
          </div>
        ))}
      </div>

      <button
        onClick={onRefresh}
        disabled={isRefreshing}
        className="flex items-center gap-2 px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-gray-400 hover:text-white transition-all text-sm mx-auto"
      >
        <RefreshCw className={`size-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        Check for activity
      </button>
    </motion.div>
  );
}