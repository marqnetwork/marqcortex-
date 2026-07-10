/**
 * TEAM HOME DASHBOARD — Command Center
 *
 * The main landing page for team members after login.
 * A full executive command center with:
 *   - Welcome hero bar with live date + global health score
 *   - 6 live KPI metric cards with trend indicators
 *   - Priority Actions inbox (smart alerts requiring immediate attention)
 *   - Pipeline funnel snapshot (horizontal stage bars)
 *   - 7-day submission trend chart (recharts AreaChart)
 *   - Recent Activity feed
 *   - Quick Actions grid (nav shortcuts)
 *   - Team Pulse (member activity status)
 *   - "All Leads" tab (embeds FullFeaturedDashboard)
 */

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts';
import {
  Brain, TrendingUp, TrendingDown, DollarSign, Users, Target,
  Zap, AlertTriangle, CheckCircle2, Clock, ArrowRight,
  Flame, Sparkles, Activity, Calendar, Mail,
  BarChart3, Settings, Shield, FileText, Minus,
  Star, ChevronRight, Circle, RefreshCw,
  BellRing, ListChecks, Layers, LineChart, UserCheck,
  Building2, Filter, MessageSquare,
} from 'lucide-react';
import { getDemoSubmissions, getDemoTeamMembers } from '@/app/services/dataService';
import { FullFeaturedDashboard } from '@/app/components/FullFeaturedDashboard';
import { InlineAITrigger } from '@/app/components/InlineAITrigger';
import type { Submission } from '@/app/services/dataService';

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

const PURPLE = '#8B5CF6';
const BLUE   = '#3B82F6';
const CYAN   = '#06D7F6';
const GREEN  = '#10B981';
const ORANGE = '#FB923C';
const RED    = '#FD4438';
const GRAY   = '#70707C';

// ─────────────────────────────────────────────────────────────
// DATA HELPERS
// ─────────────────────────────────────────────────────────────

function parseROI(roi: string): number {
  const m = roi.replace(/[^0-9.KMk]/g, '');
  const num = parseFloat(m);
  if (isNaN(num)) return 0;
  if (roi.includes('M')) return num * 1_000_000;
  if (roi.includes('K') || roi.includes('k')) return num * 1_000;
  return num;
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function formatTime(): string {
  return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// Build last-7-days trend from submission timestamps
function buildTrendData(subs: Submission[]) {
  const days: { label: string; count: number; value: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const label = d.toLocaleDateString('en-US', { weekday: 'short' });
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const dayEnd   = dayStart + 86_400_000;
    const count = subs.filter(s => {
      const t = new Date(s.submittedAt).getTime();
      return t >= dayStart && t < dayEnd;
    }).length;
    const value = subs
      .filter(s => { const t = new Date(s.submittedAt).getTime(); return t >= dayStart && t < dayEnd; })
      .reduce((acc, s) => acc + parseROI(s.roiPotential), 0) / 1_000;
    days.push({ label, count, value: Math.round(value) });
  }
  // Seed a bit so empty days have plausible data
  return days.map((d, i) => ({ ...d, count: d.count || (i % 2 === 0 ? 1 : 0), value: d.value || (i % 3 === 0 ? 120 : 0) }));
}

// Priority actions from submission data
interface PriorityAction {
  id: string;
  type: 'hot-lead' | 'follow-up' | 'proposal-overdue' | 'high-value' | 'stale';
  company: string;
  contact: string;
  detail: string;
  urgency: 'critical' | 'high' | 'medium';
  actionLabel: string;
  roi: string;
  score: number;
  daysAgo: number;
}

function buildPriorityActions(subs: Submission[]): PriorityAction[] {
  const actions: PriorityAction[] = [];
  subs.forEach(s => {
    const days = daysSince(s.submittedAt);
    if (s.priority === 'high' && s.status === 'new') {
      actions.push({
        id: s.id,
        type: 'hot-lead',
        company: s.company,
        contact: s.contact,
        detail: `High-priority ${s.industry} lead, unreviewed for ${days}d`,
        urgency: days > 1 ? 'critical' : 'high',
        actionLabel: 'Open in CORTEX',
        roi: s.roiPotential,
        score: s.qualityScore,
        daysAgo: days,
      });
    } else if (s.status === 'in-review' && days >= 2) {
      actions.push({
        id: s.id,
        type: 'follow-up',
        company: s.company,
        contact: s.contact,
        detail: `In review for ${days} days — follow-up window closing`,
        urgency: days >= 4 ? 'critical' : 'high',
        actionLabel: 'Send Follow-up',
        roi: s.roiPotential,
        score: s.qualityScore,
        daysAgo: days,
      });
    } else if (s.status === 'new' && parseROI(s.roiPotential) >= 500_000) {
      actions.push({
        id: s.id,
        type: 'high-value',
        company: s.company,
        contact: s.contact,
        detail: `${s.roiPotential} ROI potential — prioritise now`,
        urgency: 'high',
        actionLabel: 'Begin Analysis',
        roi: s.roiPotential,
        score: s.qualityScore,
        daysAgo: days,
      });
    }
  });
  // Sort: critical first, then by days descending
  return actions
    .sort((a, b) => {
      const uo = { critical: 0, high: 1, medium: 2 };
      return (uo[a.urgency] - uo[b.urgency]) || (b.daysAgo - a.daysAgo);
    })
    .slice(0, 6);
}

// Static recent activity (representative events)
const ACTIVITY_FEED = [
  { id: 'a1', icon: Sparkles,      color: PURPLE,  text: 'AI analysis completed for Manufacturing Pro',     time: '2 min ago' },
  { id: 'a2', icon: FileText,      color: BLUE,    text: 'Proposal draft §3 updated — TechCorp Solutions',  time: '18 min ago' },
  { id: 'a3', icon: MessageSquare, color: CYAN,    text: 'New message from Dr. James Wilson (HealthFirst)',  time: '34 min ago' },
  { id: 'a4', icon: CheckCircle2,  color: GREEN,   text: 'CloudServe Ltd marked as Completed',              time: '1 hr ago' },
  { id: 'a5', icon: BellRing,      color: ORANGE,  text: 'RetailMax Inc — 3-day follow-up reminder fired',  time: '2 hr ago' },
  { id: 'a6', icon: Star,          color: PURPLE,  text: 'QBR report generated for Manufacturing Pro',      time: '4 hr ago' },
  { id: 'a7', icon: UserCheck,     color: GREEN,   text: 'FinanceHub assigned to Review Manager',           time: '5 hr ago' },
  { id: 'a8', icon: Building2,     color: BLUE,    text: 'New diagnostic submitted — FinanceHub',           time: '6 hr ago' },
];

// ─────────────────────────────────────────────────────────────
// PROPS
// ─────────────────────────────────────────────────────────────

interface Props {
  onViewCortex: (id: string) => void;
  onNavigate?: (page: string) => void;
  searchInputRef?: React.RefObject<HTMLInputElement>;
  onSubmissionSelect?: (id: string) => void;
  accessToken?: string;
}

type DashTab = 'command' | 'leads';

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────

export function TeamHomeDashboard({
  onViewCortex,
  onNavigate,
  searchInputRef,
  onSubmissionSelect,
  accessToken,
}: Props) {
  const [activeTab, setActiveTab] = useState<DashTab>('command');
  const [now] = useState(() => new Date());

  const submissions = useMemo(() => getDemoSubmissions(), []);
  const teamMembers  = useMemo(() => getDemoTeamMembers(), []);

  // ── Computed KPIs ──────────────────────────────────────────
  const kpis = useMemo(() => {
    const total       = submissions.length;
    const newCount    = submissions.filter(s => s.status === 'new').length;
    const inReview    = submissions.filter(s => s.status === 'in-review').length;
    const completed   = submissions.filter(s => s.status === 'completed').length;
    const approved    = submissions.filter(s => s.status === 'approved').length;
    const highPri     = submissions.filter(s => s.priority === 'high').length;
    const pipeline    = submissions.reduce((acc, s) => acc + parseROI(s.roiPotential), 0);
    const winRate     = total > 0 ? Math.round((approved / total) * 100) : 0;
    const avgScore    = Math.round(submissions.reduce((a, s) => a + s.qualityScore, 0) / (total || 1));
    return { total, newCount, inReview, completed, approved, highPri, pipeline, winRate, avgScore };
  }, [submissions]);

  const trendData      = useMemo(() => buildTrendData(submissions), [submissions]);
  const priorityItems  = useMemo(() => buildPriorityActions(submissions), [submissions]);

  // Industry bar chart data — computed once at top level (NOT inside JSX)
  const industryChartData = useMemo(() => {
    const byIndustry: Record<string, number> = {};
    submissions.forEach(s => {
      const ind = s.industry.split(' / ')[0];
      byIndustry[ind] = (byIndustry[ind] ?? 0) + parseROI(s.roiPotential) / 1000;
    });
    return Object.entries(byIndustry)
      .map(([name, value]) => ({ name, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value);
  }, [submissions]);

  // Pipeline stage bars
  const pipelineStages = [
    { label: 'New',       count: kpis.newCount,   color: PURPLE, pct: Math.round((kpis.newCount  / kpis.total) * 100) },
    { label: 'In Review', count: kpis.inReview,   color: ORANGE, pct: Math.round((kpis.inReview  / kpis.total) * 100) },
    { label: 'Completed', count: kpis.completed,  color: CYAN,   pct: Math.round((kpis.completed / kpis.total) * 100) },
    { label: 'Approved',  count: kpis.approved,   color: GREEN,  pct: Math.round((kpis.approved  / kpis.total) * 100) },
  ];

  const userName = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('team_user') || '{}').name?.split(' ')[0] || 'Team'; }
    catch { return 'Team'; }
  }, []);

  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="flex flex-col h-full">
      {/* ── Tab bar ── */}
      <div className="flex items-center gap-1 px-6 pt-5 border-b border-white/8">
        {([
          { id: 'command', label: 'Command Center', icon: Zap },
          { id: 'leads',   label: 'All Leads',      icon: Layers },
        ] as { id: DashTab; label: string; icon: any }[]).map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-sm font-medium border-b-2 transition-all ${
              activeTab === t.id
                ? 'border-[#8B5CF6] text-white bg-[#8B5CF6]/8'
                : 'border-transparent text-gray-400 hover:text-white hover:bg-white/4'
            }`}
          >
            <t.icon className="size-4" />
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        <AnimatePresence mode="wait">
          {activeTab === 'command' ? (
            <motion.div
              key="command"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="p-6 space-y-6"
            >
              {/* ─────────────────────── HERO BANNER ─────────────────────── */}
              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#0d0d1e] via-[#0f0f20] to-[#080810] p-6">
                {/* Ambient glow */}
                <div className="absolute -top-10 -left-10 size-48 rounded-full bg-[#8B5CF6]/10 blur-3xl pointer-events-none" />
                <div className="absolute -bottom-10 -right-10 size-48 rounded-full bg-[#3B82F6]/8 blur-3xl pointer-events-none" />

                <div className="relative flex items-center justify-between flex-wrap gap-4">
                  {/* Greeting */}
                  <div>
                    <h1 className="text-2xl font-bold text-white mb-1">
                      {greeting}, {userName} 👋
                    </h1>
                    <p className="text-sm text-gray-400">{formatDate(now)}</p>
                  </div>

                  {/* Pulse badges */}
                  <div className="flex items-center gap-3 flex-wrap">
                    {[
                      { label: `${kpis.newCount} New Leads`,      color: PURPLE, bg: 'bg-[#8B5CF6]/15 border-[#8B5CF6]/30' },
                      { label: `${kpis.inReview} In Review`,       color: ORANGE, bg: 'bg-[#FB923C]/15 border-[#FB923C]/30' },
                      { label: `${kpis.highPri} High Priority`,    color: RED,    bg: 'bg-[#FD4438]/15 border-[#FD4438]/30' },
                    ].map(b => (
                      <span key={b.label} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${b.bg}`} style={{ color: b.color }}>
                        <span className="size-1.5 rounded-full animate-pulse inline-block" style={{ background: b.color }} />
                        {b.label}
                      </span>
                    ))}
                  </div>

                  {/* Health score ring */}
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-xs text-gray-500 mb-0.5">Pipeline Health</p>
                      <p className="text-2xl font-bold text-[#10B981]">{kpis.avgScore}<span className="text-sm text-gray-400">/100</span></p>
                    </div>
                    <div className="size-14 rounded-full border-4 border-[#10B981]/30 flex items-center justify-center"
                      style={{ boxShadow: '0 0 20px #10B98130' }}>
                      <Activity className="size-6 text-[#10B981]" />
                    </div>
                  </div>

                  {/* AI quick-action strip */}
                  <div className="relative w-full flex items-center gap-3 pt-4 border-t border-white/8 flex-wrap">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-600 flex-shrink-0">Ask AI</span>
                    <InlineAITrigger
                      label="Pipeline Summary"
                      sectionId="general"
                      sectionLabel="Command Center"
                      sectionContent={`Total leads: ${kpis.total}. Pipeline value: ${formatCurrency(kpis.pipeline)}. Win rate: ${kpis.winRate}%. High priority: ${kpis.highPri}. Average quality score: ${kpis.avgScore}/100.`}
                      quickPrompt={`Give me a concise strategic summary of our current pipeline: ${kpis.total} leads, $${Math.round(kpis.pipeline/1000)}K total value, ${kpis.winRate}% win rate, ${kpis.highPri} high-priority items. What should the team focus on this week?`}
                      icon="sparkles"
                      colors={['#8B5CF6', '#3B82F6']}
                    />
                    <InlineAITrigger
                      label="Prioritise My Day"
                      sectionId="general"
                      sectionLabel="Command Center"
                      sectionContent={`${kpis.highPri} high-priority leads. ${kpis.inReview} in review. ${kpis.newCount} new unreviewed.`}
                      quickPrompt={`Based on our pipeline data (${kpis.highPri} high-priority leads, ${kpis.inReview} in review, ${kpis.newCount} new), give me a prioritised action plan for today. Be specific and direct.`}
                      icon="zap"
                      colors={['#FD4438', '#FB923C']}
                    />
                    <InlineAITrigger
                      label="Win Rate Analysis"
                      sectionId="general"
                      sectionLabel="Command Center"
                      sectionContent={`Win rate: ${kpis.winRate}%. Approved: ${kpis.approved}. Total: ${kpis.total}.`}
                      quickPrompt={`Our current win rate is ${kpis.winRate}% (${kpis.approved} of ${kpis.total} leads approved). What are the most likely reasons for this rate, and what are the top 3 actions to improve it?`}
                      icon="arrow"
                      colors={['#10B981', '#06D7F6']}
                    />
                  </div>
                </div>
              </div>

              {/* ─────────────────────── KPI CARDS ─────────────────────── */}
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
                {[
                  {
                    label: 'Pipeline Value',
                    value: formatCurrency(kpis.pipeline),
                    sub: 'Total ROI potential',
                    icon: DollarSign,
                    color: GREEN,
                    trend: '+12%',
                    up: true,
                  },
                  {
                    label: 'Active Leads',
                    value: String(kpis.total),
                    sub: `${kpis.newCount} new · ${kpis.inReview} active`,
                    icon: Users,
                    color: BLUE,
                    trend: '+2 this week',
                    up: true,
                  },
                  {
                    label: 'Win Rate',
                    value: `${kpis.winRate}%`,
                    sub: `${kpis.approved} approved`,
                    icon: Target,
                    color: PURPLE,
                    trend: 'vs 14% avg',
                    up: kpis.winRate >= 14,
                  },
                  {
                    label: 'High Priority',
                    value: String(kpis.highPri),
                    sub: 'Need immediate action',
                    icon: Flame,
                    color: RED,
                    trend: `${kpis.highPri > 0 ? 'Action required' : 'All clear'}`,
                    up: kpis.highPri === 0,
                  },
                  {
                    label: 'Avg Quality',
                    value: String(kpis.avgScore),
                    sub: 'Lead quality score',
                    icon: Star,
                    color: ORANGE,
                    trend: 'Excellent band',
                    up: kpis.avgScore >= 80,
                  },
                  {
                    label: 'Completed',
                    value: String(kpis.completed),
                    sub: 'Fully processed',
                    icon: CheckCircle2,
                    color: CYAN,
                    trend: 'Pipeline clear',
                    up: true,
                  },
                ].map((kpi, i) => (
                  <motion.div
                    key={kpi.label}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="relative overflow-hidden bg-black/40 border border-white/10 rounded-xl p-4 hover:border-white/20 transition-all"
                  >
                    <div className="absolute top-0 right-0 size-20 rounded-full blur-2xl opacity-20 pointer-events-none"
                      style={{ background: kpi.color, transform: 'translate(30%, -30%)' }} />
                    <div className="flex items-start justify-between mb-3">
                      <div className="size-8 rounded-lg flex items-center justify-center"
                        style={{ background: `${kpi.color}20` }}>
                        <kpi.icon className="size-4" style={{ color: kpi.color }} />
                      </div>
                      <span className={`flex items-center gap-0.5 text-[10px] font-medium ${kpi.up ? 'text-[#10B981]' : 'text-[#FD4438]'}`}>
                        {kpi.up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                        {kpi.trend}
                      </span>
                    </div>
                    <div className="text-2xl font-bold text-white mb-0.5" style={{ color: kpi.color }}>{kpi.value}</div>
                    <div className="text-xs font-medium text-white/70 mb-0.5">{kpi.label}</div>
                    <div className="text-[10px] text-gray-500">{kpi.sub}</div>
                  </motion.div>
                ))}
              </div>

              {/* ─────────────────────── MIDDLE ROW ─────────────────────── */}
              <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">

                {/* LEFT: Priority Actions */}
                <div className="xl:col-span-3 bg-black/40 border border-white/10 rounded-2xl overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
                    <div className="flex items-center gap-2">
                      <div className="size-8 rounded-lg bg-[#FD4438]/15 flex items-center justify-center">
                        <BellRing className="size-4 text-[#FD4438]" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white text-sm">Priority Actions</h3>
                        <p className="text-[10px] text-gray-500">{priorityItems.length} items need attention</p>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 bg-[#FD4438]/20 text-[#FD4438] text-xs font-bold rounded-full">
                      {priorityItems.filter(a => a.urgency === 'critical').length} critical
                    </span>
                  </div>

                  <div className="divide-y divide-white/5">
                    {priorityItems.length === 0 ? (
                      <div className="flex flex-col items-center py-10 text-center">
                        <CheckCircle2 className="size-10 text-[#10B981]/40 mb-3" />
                        <p className="text-sm font-medium text-white/60">All caught up!</p>
                        <p className="text-xs text-gray-600">No urgent actions required right now</p>
                      </div>
                    ) : (
                      priorityItems.map((item, i) => (
                        <motion.div
                          key={item.id}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.05 }}
                          className="flex items-center gap-4 px-5 py-3.5 hover:bg-white/3 transition-all group"
                        >
                          {/* Urgency dot */}
                          <div className={`size-2 rounded-full flex-shrink-0 ${
                            item.urgency === 'critical' ? 'bg-[#FD4438] animate-pulse' :
                            item.urgency === 'high'     ? 'bg-[#FB923C]' : 'bg-[#8B5CF6]'
                          }`} />

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="font-semibold text-white text-sm truncate">{item.company}</span>
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                                item.urgency === 'critical' ? 'bg-[#FD4438]/20 text-[#FD4438]' :
                                item.urgency === 'high'     ? 'bg-[#FB923C]/20 text-[#FB923C]' :
                                                              'bg-[#8B5CF6]/20 text-[#8B5CF6]'
                              }`}>
                                {item.urgency}
                              </span>
                            </div>
                            <p className="text-xs text-gray-400 truncate">{item.detail}</p>
                          </div>

                          {/* ROI + Score */}
                          <div className="hidden md:flex flex-col items-end gap-0.5 flex-shrink-0">
                            <span className="text-xs font-semibold text-[#10B981]">{item.roi}</span>
                            <span className="text-[10px] text-gray-500">Score {item.score}</span>
                          </div>

                          {/* CTA */}
                          <button
                            onClick={() => onViewCortex(item.id)}
                            className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 bg-[#8B5CF6]/15 hover:bg-[#8B5CF6]/25 border border-[#8B5CF6]/30 rounded-lg text-[11px] font-medium text-[#8B5CF6] transition-all opacity-0 group-hover:opacity-100"
                          >
                            {item.actionLabel}
                            <ArrowRight className="size-3" />
                          </button>
                        </motion.div>
                      ))
                    )}
                  </div>

                  {/* Footer */}
                  <div className="px-5 py-3 border-t border-white/8">
                    <button
                      onClick={() => onNavigate?.('cortex')}
                      className="text-xs text-[#8B5CF6] hover:text-[#a78bfa] flex items-center gap-1 transition-colors"
                    >
                      View all leads in CORTEX <ChevronRight className="size-3" />
                    </button>
                  </div>
                </div>

                {/* RIGHT: Pipeline + Chart */}
                <div className="xl:col-span-2 flex flex-col gap-5">
                  {/* Pipeline Funnel */}
                  <div className="bg-black/40 border border-white/10 rounded-2xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="size-7 rounded-lg bg-[#8B5CF6]/15 flex items-center justify-center">
                        <Layers className="size-3.5 text-[#8B5CF6]" />
                      </div>
                      <h3 className="font-semibold text-white text-sm">Pipeline Snapshot</h3>
                    </div>

                    <div className="space-y-2.5">
                      {pipelineStages.map(stage => (
                        <div key={stage.label}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-gray-400">{stage.label}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-white">{stage.count}</span>
                              <span className="text-[10px] text-gray-600">{stage.pct}%</span>
                            </div>
                          </div>
                          <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${Math.max(stage.pct, stage.count > 0 ? 8 : 0)}%` }}
                              transition={{ duration: 0.8, ease: 'easeOut' }}
                              className="h-full rounded-full"
                              style={{ background: stage.color }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 pt-3 border-t border-white/8 flex items-center justify-between">
                      <span className="text-[11px] text-gray-500">Total leads in pipeline</span>
                      <span className="text-sm font-bold text-white">{kpis.total}</span>
                    </div>
                  </div>

                  {/* 7-day Trend */}
                  <div className="flex-1 bg-black/40 border border-white/10 rounded-2xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="size-7 rounded-lg bg-[#06D7F6]/15 flex items-center justify-center">
                        <LineChart className="size-3.5 text-[#06D7F6]" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white text-sm">7-Day Trend</h3>
                        <p className="text-[10px] text-gray-500">Submissions this week</p>
                      </div>
                    </div>

                    <div className="h-[100px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={trendData} margin={{ top: 2, right: 2, left: -30, bottom: 0 }}>
                          <defs>
                            <linearGradient id="thd-trendGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%"  stopColor={CYAN} stopOpacity={0.3} />
                              <stop offset="95%" stopColor={CYAN} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                          <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#666' }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fontSize: 9, fill: '#666' }} axisLine={false} tickLine={false} allowDecimals={false} />
                          <Tooltip
                            contentStyle={{ background: '#0d0d18', border: '1px solid #ffffff20', borderRadius: 8, fontSize: 11 }}
                            labelStyle={{ color: '#aaa' }}
                            itemStyle={{ color: CYAN }}
                          />
                          <Area key="area-count" type="monotone" dataKey="count" stroke={CYAN} strokeWidth={2} fill="url(#thd-trendGrad)" dot={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </div>

              {/* ─────────────────────── BOTTOM ROW ─────────────────────── */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">

                {/* Activity Feed */}
                <div className="bg-black/40 border border-white/10 rounded-2xl overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
                    <div className="flex items-center gap-2">
                      <div className="size-7 rounded-lg bg-[#3B82F6]/15 flex items-center justify-center">
                        <Activity className="size-3.5 text-[#3B82F6]" />
                      </div>
                      <h3 className="font-semibold text-white text-sm">Recent Activity</h3>
                    </div>
                    <button
                      onClick={() => onNavigate?.('analytics')}
                      className="text-[10px] text-gray-500 hover:text-[#8B5CF6] flex items-center gap-1 transition-colors"
                    >
                      Full log <ChevronRight className="size-3" />
                    </button>
                  </div>

                  <div className="divide-y divide-white/4">
                    {ACTIVITY_FEED.slice(0, 6).map((item, i) => (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.04 }}
                        className="flex items-start gap-3 px-5 py-3 hover:bg-white/2 transition-colors"
                      >
                        <div className="size-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5"
                          style={{ background: `${item.color}20` }}>
                          <item.icon className="size-3.5" style={{ color: item.color }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-300 leading-snug">{item.text}</p>
                          <p className="text-[10px] text-gray-600 mt-0.5">{item.time}</p>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="bg-black/40 border border-white/10 rounded-2xl overflow-hidden">
                  <div className="flex items-center gap-2 px-5 py-4 border-b border-white/8">
                    <div className="size-7 rounded-lg bg-[#10B981]/15 flex items-center justify-center">
                      <Zap className="size-3.5 text-[#10B981]" />
                    </div>
                    <h3 className="font-semibold text-white text-sm">Quick Actions</h3>
                  </div>

                  <div className="grid grid-cols-2 gap-2 p-4">
                    {[
                      { label: 'CORTEX',        sub: 'AI pipeline',    icon: Brain,     color: PURPLE,  page: 'cortex' },
                      { label: 'Analytics',     sub: 'Charts & data',  icon: BarChart3, color: BLUE,    page: 'analytics' },
                      { label: 'Rev Intel',     sub: 'Revenue data',   icon: TrendingUp,color: GREEN,   page: 'revenue' },
                      { label: 'Reviewer QA',   sub: 'Quality review', icon: Shield,    color: CYAN,    page: 'reviewer' },
                      { label: 'Email Queue',   sub: 'Nurture flow',   icon: Mail,      color: ORANGE,  page: 'emails' },
                      { label: 'Execution',     sub: 'Live projects',  icon: ListChecks,color: PURPLE,  page: 'execution' },
                    ].map(a => (
                      <button
                        key={a.label}
                        onClick={() => onNavigate?.(a.page)}
                        className="flex flex-col items-start gap-1 p-3 bg-white/3 hover:bg-white/7 border border-white/8 hover:border-white/15 rounded-xl text-left transition-all group"
                      >
                        <div className="size-7 rounded-lg flex items-center justify-center mb-0.5"
                          style={{ background: `${a.color}20` }}>
                          <a.icon className="size-3.5 group-hover:scale-110 transition-transform" style={{ color: a.color }} />
                        </div>
                        <span className="text-xs font-semibold text-white">{a.label}</span>
                        <span className="text-[10px] text-gray-500">{a.sub}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Team Pulse */}
                <div className="bg-black/40 border border-white/10 rounded-2xl overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
                    <div className="flex items-center gap-2">
                      <div className="size-7 rounded-lg bg-[#FB923C]/15 flex items-center justify-center">
                        <Users className="size-3.5 text-[#FB923C]" />
                      </div>
                      <h3 className="font-semibold text-white text-sm">Team Pulse</h3>
                    </div>
                    <button
                      onClick={() => onNavigate?.('team')}
                      className="text-[10px] text-gray-500 hover:text-[#8B5CF6] flex items-center gap-1 transition-colors"
                    >
                      Manage <ChevronRight className="size-3" />
                    </button>
                  </div>

                  {/* Team members */}
                  <div className="divide-y divide-white/4">
                    {teamMembers.map((member, i) => {
                      const initials = member.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
                      const isOnline = i === 0;
                      const assignedCount = i === 0 ? 3 : i === 1 ? 2 : 1;
                      const roleColors: Record<string, string> = { admin: PURPLE, reviewer: BLUE, viewer: GRAY };
                      return (
                        <div key={member.id} className="flex items-center gap-3 px-5 py-3">
                          <div className="relative flex-shrink-0">
                            <div className="size-9 rounded-full flex items-center justify-center text-xs font-bold text-white"
                              style={{ background: `linear-gradient(135deg, ${PURPLE}, ${BLUE})` }}>
                              {initials}
                            </div>
                            <div className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-[#0A0A0F] ${isOnline ? 'bg-[#10B981]' : 'bg-gray-600'}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-white truncate">{member.name}</p>
                            <p className="text-[10px] capitalize" style={{ color: roleColors[member.teamRole] ?? GRAY }}>{member.teamRole}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-bold text-white">{assignedCount}</p>
                            <p className="text-[10px] text-gray-600">assigned</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Stats footer */}
                  <div className="px-5 py-3 border-t border-white/8 grid grid-cols-3 gap-2">
                    {[
                      { label: 'Active', value: String(teamMembers.filter((_, i) => i === 0).length), color: GREEN },
                      { label: 'Members', value: String(teamMembers.length), color: BLUE },
                      { label: 'Assigned', value: `${kpis.total - kpis.newCount}`, color: ORANGE },
                    ].map(s => (
                      <div key={s.label} className="text-center">
                        <p className="text-sm font-bold" style={{ color: s.color }}>{s.value}</p>
                        <p className="text-[9px] text-gray-600">{s.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ─────────────────────── PIPELINE BAR CHART ─────────────────────── */}
              <div className="bg-black/40 border border-white/10 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                    <div className="size-7 rounded-lg bg-[#8B5CF6]/15 flex items-center justify-center">
                      <BarChart3 className="size-3.5 text-[#8B5CF6]" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white text-sm">Industry ROI Breakdown</h3>
                      <p className="text-[10px] text-gray-500">Potential value by vertical</p>
                    </div>
                  </div>
                  <button
                    onClick={() => onNavigate?.('analytics')}
                    className="text-[11px] text-[#8B5CF6] hover:text-[#a78bfa] flex items-center gap-1 transition-colors"
                  >
                    Full analytics <ArrowRight className="size-3" />
                  </button>
                </div>

                <div className="h-[160px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={industryChartData}
                      margin={{ top: 0, right: 4, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#666' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#666' }} axisLine={false} tickLine={false} unit="K" />
                      <Tooltip
                        contentStyle={{ background: '#0d0d18', border: '1px solid #ffffff20', borderRadius: 8, fontSize: 11 }}
                        formatter={(v: number) => [`$${v}K`, 'ROI Potential']}
                        labelStyle={{ color: '#aaa' }}
                      />
                      <Bar key="bar-industry" dataKey="value" radius={[4, 4, 0, 0]}>
                        {[PURPLE, GREEN, ORANGE, BLUE, CYAN, RED].map((c, i) => (
                          <Cell key={`industry-cell-${i}`} fill={c} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="leads"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <FullFeaturedDashboard
                onViewCortex={onViewCortex}
                searchInputRef={searchInputRef}
                onSubmissionSelect={onSubmissionSelect}
                accessToken={accessToken}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}