/**
 * EMAIL NURTURE PANEL — Team Dashboard Module
 *
 * Shows the email nurture queue with:
 *   • Summary stats (pending / sent / skipped)
 *   • Per-template pipeline counts
 *   • Full queue list with preview, status, and actions
 *   • Ability to mark pending emails as sent or skipped
 *   • Per-lead drill-down to see the full sequence
 */

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Mail, Clock, CheckCircle2, XCircle, AlertTriangle,
  ChevronDown, ChevronUp, Send, Eye, RefreshCw,
  Inbox, BarChart3, Filter, Search, Zap, Users,
  Wifi, WifiOff, Loader2, TestTube2,
} from 'lucide-react';
import {
  getEmailQueue,
  getQueueStats,
  markEmailSent,
  markEmailSkipped,
  seedABVariants,
  EMAIL_TEMPLATE_CONFIGS,
  getDemoDeliveryStats,
  getDemoTemplatePerformance,
  getEmailPreview,
  type QueuedEmail,
  type EmailStatus,
  type EmailTemplateId,
} from '@/app/utils/emailNurtureQueue';
import { ABTestingPanel } from '@/app/components/ABTestingPanel';
import { Beaker } from 'lucide-react';
import { FEATURES } from '@/config/features';
import { getEmailStatus, sendTestEmailRequest } from '@/app/services/dataService';
import { log } from '@/app/utils/logger';

// ── Palette ──────────────────────────────────────────────────────────────────
const PURPLE = '#8B5CF6';
const BLUE = '#3B82F6';
const CYAN = '#06D7F6';
const ORANGE = '#FB923C';
const RED = '#FD4438';
const GREEN = '#10B981';

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 0) return timeUntil(iso);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  const h = Math.floor(s / 3600);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

function timeUntil(iso: string): string {
  const s = Math.floor((new Date(iso).getTime() - Date.now()) / 1000);
  if (s < 60) return 'in < 1m';
  if (s < 3600) return `in ${Math.floor(s / 60)}m`;
  const h = Math.floor(s / 3600);
  if (h < 24) return `in ${h}h`;
  const d = Math.floor(h / 24);
  return `in ${d}d`;
}

function statusConfig(status: EmailStatus) {
  switch (status) {
    case 'sent':
      return { label: 'Sent', color: GREEN, bg: `${GREEN}15`, icon: CheckCircle2 };
    case 'pending':
      return { label: 'Pending', color: ORANGE, bg: `${ORANGE}15`, icon: Clock };
    case 'skipped':
      return { label: 'Skipped', color: '#6B7280', bg: 'rgba(107,114,128,0.15)', icon: XCircle };
    case 'failed':
      return { label: 'Failed', color: RED, bg: `${RED}15`, icon: AlertTriangle };
  }
}

function getTemplateConfig(id: EmailTemplateId) {
  return EMAIL_TEMPLATE_CONFIGS.find((t) => t.id === id)!;
}

// ── Main component ───────────────────────────────────────────────────────────

export function EmailNurturePanel() {
  const [queue, setQueue] = useState<QueuedEmail[]>([]);
  const [stats, setStats] = useState(getQueueStats());
  const [filter, setFilter] = useState<'all' | EmailStatus>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<'time' | 'lead'>('time');
  const [resendStatus, setResendStatus] = useState<{ configured: boolean; note: string } | null>(null);
  const [resendLoading, setResendLoading] = useState(false);
  const [testEmailSending, setTestEmailSending] = useState(false);
  const [testEmailResult, setTestEmailResult] = useState<string | null>(null);

  // Check Resend status on mount (only if backend is live)
  useEffect(() => {
    if (!FEATURES.BACKEND_INTEGRATION) {
      setResendStatus({ configured: false, note: 'Backend integration is off (demo mode). Emails are simulated.' });
      return;
    }
    setResendLoading(true);
    const token = localStorage.getItem('team_access_token') || '';
    getEmailStatus(token)
      .then((data) => setResendStatus({ configured: data.resendConfigured, note: data.note }))
      .catch((err) => {
        log.warn('Could not check Resend status:', err);
        setResendStatus({ configured: false, note: 'Could not reach server to check email status.' });
      })
      .finally(() => setResendLoading(false));
  }, []);

  const handleTestEmail = async () => {
    if (!FEATURES.BACKEND_INTEGRATION) {
      setTestEmailResult('Demo mode — no real email sent. Flip BACKEND_INTEGRATION to test.');
      return;
    }
    setTestEmailSending(true);
    setTestEmailResult(null);
    try {
      const token = localStorage.getItem('team_access_token') || '';
      const result = await sendTestEmailRequest(token);
      if (result.resendKeyConfigured) {
        setTestEmailResult(`Test email sent to ${result.to}`);
      } else {
        setTestEmailResult('No RESEND_API_KEY set — email was logged but not delivered.');
      }
    } catch (err: any) {
      setTestEmailResult(`Error: ${err.message}`);
    } finally {
      setTestEmailSending(false);
    }
  };

  const refresh = () => {
    // Show only the REAL persisted queue (built from actual questionnaire
    // submissions). No fabricated demo leads are injected — an empty queue
    // renders the empty state below.
    seedABVariants(); // idempotent — seeds A/B variants onto existing emails only
    setQueue(getEmailQueue());
    setStats(getQueueStats());
  };

  useEffect(() => { refresh(); }, []);

  // Filtered queue
  const filtered = useMemo(() => {
    return queue.filter((e) => {
      if (filter !== 'all' && e.status !== filter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          e.contactName.toLowerCase().includes(q) ||
          e.companyName.toLowerCase().includes(q) ||
          e.contactEmail.toLowerCase().includes(q) ||
          e.subject.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [queue, filter, search]);

  // Group by lead
  const groupedByLead = useMemo(() => {
    if (groupBy !== 'lead') return null;
    const map = new Map<string, QueuedEmail[]>();
    for (const e of filtered) {
      const key = e.submissionId;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return Array.from(map.entries()).map(([subId, emails]) => ({
      submissionId: subId,
      contactName: emails[0].contactName,
      companyName: emails[0].companyName,
      contactEmail: emails[0].contactEmail,
      industry: emails[0].industry,
      readinessScore: emails[0].readinessScore,
      emails: emails.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()),
    }));
  }, [filtered, groupBy]);

  const handleSend = (id: string) => {
    markEmailSent(id);
    refresh();
  };

  const handleSkip = (id: string) => {
    markEmailSkipped(id);
    refresh();
  };

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white" role="main" aria-label="Email Nurture Queue">
      {/* Header */}
      <div className="border-b border-white/10 bg-black/40 backdrop-blur-xl sticky top-0 z-20">
        <div className="max-w-[1400px] mx-auto px-6 py-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
                <Mail className="size-8 text-[#8B5CF6]" />
                Email Nurture Queue
              </h1>
              <p className="text-white/60">
                Pre-call nurture sequence &bull; {stats.total} emails across {new Set(queue.map((e) => e.submissionId)).size} leads
              </p>
            </div>
            <button
              onClick={refresh}
              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all flex items-center gap-2 text-sm"
            >
              <RefreshCw className="size-4" />
              Refresh
            </button>
          </div>

          {/* Resend delivery status bar */}
          <div className={`mb-6 p-3 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center gap-3 ${
            resendStatus?.configured
              ? 'bg-[#10B981]/5 border-[#10B981]/20'
              : 'bg-[#FB923C]/5 border-[#FB923C]/20'
          }`}>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {resendLoading ? (
                <Loader2 className="size-4 text-white/50 animate-spin flex-shrink-0" />
              ) : resendStatus?.configured ? (
                <Wifi className="size-4 text-[#10B981] flex-shrink-0" />
              ) : (
                <WifiOff className="size-4 text-[#FB923C] flex-shrink-0" />
              )}
              <span className="text-xs text-white/60 truncate">
                {resendLoading ? 'Checking email delivery...' : (
                  resendStatus?.configured
                    ? 'Resend connected — emails will be delivered'
                    : (resendStatus?.note || 'Resend not configured')
                )}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={handleTestEmail}
                disabled={testEmailSending}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50"
              >
                {testEmailSending ? <Loader2 className="size-3 animate-spin" /> : <TestTube2 className="size-3" />}
                Send Test Email
              </button>
              {testEmailResult && (
                <span className={`text-[10px] max-w-[200px] truncate ${
                  testEmailResult.startsWith('Error') ? 'text-[#FD4438]' : 'text-[#10B981]'
                }`}>
                  {testEmailResult}
                </span>
              )}
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Pending" value={stats.pending} color={ORANGE} icon={<Clock className="size-5" />} />
            <StatCard label="Sent" value={stats.sent} color={GREEN} icon={<CheckCircle2 className="size-5" />} />
            <StatCard label="Skipped" value={stats.skipped} color="#6B7280" icon={<XCircle className="size-5" />} />
            <StatCard label="Total" value={stats.total} color={PURPLE} icon={<Inbox className="size-5" />} />
          </div>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-6 py-6">
        {/* Pipeline by template */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
          {EMAIL_TEMPLATE_CONFIGS.filter((t) => t.id !== 'proposal_delivered').map((tpl) => (
            <div
              key={tpl.id}
              className="p-4 rounded-xl border"
              style={{ background: `${tpl.color}06`, borderColor: `${tpl.color}20` }}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{tpl.icon}</span>
                <span className="text-xs font-bold text-white/70 truncate">{tpl.label}</span>
              </div>
              <div className="text-2xl font-bold" style={{ color: tpl.color }}>
                {stats.byTemplate[tpl.id] || 0}
              </div>
              <div className="text-[10px] text-white/40 uppercase tracking-wider">pending</div>
            </div>
          ))}
        </div>

        {/* Filters + Search */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-white/40" />
            <input
              type="text"
              placeholder="Search by name, company, or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search emails by name, company, or email"
              className="w-full pl-10 pr-4 py-2.5 bg-black/40 border border-white/10 rounded-xl text-white text-sm placeholder-white/40 focus:outline-none focus:border-[#8B5CF6]/50"
            />
          </div>

          <div className="flex gap-2">
            {(['all', 'pending', 'sent', 'skipped'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                  filter === f
                    ? 'bg-[#8B5CF6]/20 text-[#8B5CF6] border border-[#8B5CF6]/40'
                    : 'bg-white/5 text-white/60 border border-white/10 hover:bg-white/10'
                }`}
              >
                {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          <div className="flex gap-1 bg-white/5 border border-white/10 rounded-lg p-0.5">
            <button
              onClick={() => setGroupBy('time')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                groupBy === 'time' ? 'bg-[#8B5CF6]/30 text-white' : 'text-white/50 hover:text-white/80'
              }`}
            >
              <Clock className="size-3.5 inline mr-1" />Timeline
            </button>
            <button
              onClick={() => setGroupBy('lead')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                groupBy === 'lead' ? 'bg-[#8B5CF6]/30 text-white' : 'text-white/50 hover:text-white/80'
              }`}
            >
              <Users className="size-3.5 inline mr-1" />By Lead
            </button>
          </div>
        </div>

        {/* Queue list */}
        {groupBy === 'time' ? (
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {filtered.map((email, idx) => (
                <motion.div
                  key={email.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ delay: idx * 0.02 }}
                >
                  <EmailRow
                    email={email}
                    expanded={expandedId === email.id}
                    onToggle={() => setExpandedId(expandedId === email.id ? null : email.id)}
                    onSend={() => handleSend(email.id)}
                    onSkip={() => handleSkip(email.id)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        ) : (
          <div className="space-y-6">
            {groupedByLead?.map((group) => (
              <LeadGroup
                key={group.submissionId}
                group={group}
                onSend={handleSend}
                onSkip={handleSkip}
              />
            ))}
          </div>
        )}

        {filtered.length === 0 && (
          <div className="text-center py-20 text-white/40">
            <Mail className="size-12 mx-auto mb-4 opacity-30" />
            {queue.length === 0 ? (
              <>
                <p className="text-lg font-semibold mb-1">No nurture emails yet</p>
                <p className="text-sm">Emails are queued automatically when a diagnostic is submitted.</p>
              </>
            ) : (
              <>
                <p className="text-lg font-semibold mb-1">No emails match your filters</p>
                <p className="text-sm">Try adjusting the filter or search terms.</p>
              </>
            )}
          </div>
        )}
      </div>

      {/* AB Testing Panel */}
      <div className="max-w-[1400px] mx-auto px-6 pb-8">
        <div className="border-t border-white/10 pt-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="size-10 rounded-xl bg-gradient-to-br from-[#06D7F6]/20 to-[#8B5CF6]/20 border border-[#06D7F6]/30 flex items-center justify-center">
              <Beaker className="size-5 text-[#06D7F6]" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">A/B Subject Line Testing</h2>
              <p className="text-sm text-white/50">Compare variant performance and apply winners across pending emails</p>
            </div>
          </div>
          <ABTestingPanel onRefreshQueue={refresh} />
        </div>
      </div>

      {/* Delivery Analytics Panel */}
      <div className="max-w-[1400px] mx-auto px-6 pb-8">
        <div className="border-t border-white/10 pt-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="size-10 rounded-xl bg-gradient-to-br from-[#3B82F6]/20 to-[#06D7F6]/20 border border-[#3B82F6]/30 flex items-center justify-center">
              <BarChart3 className="size-5 text-[#3B82F6]" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Delivery Analytics</h2>
              <p className="text-sm text-white/50">
                {FEATURES.BACKEND_INTEGRATION
                  ? 'Live delivery metrics from Resend'
                  : 'Simulated metrics (demo mode) \u2014 connect Resend to see real data'}
              </p>
            </div>
          </div>
          <DeliveryAnalytics />
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, color, icon }: { label: string; value: number; color: string; icon: React.ReactNode }) {
  return (
    <div className="p-4 rounded-xl bg-black/40 border border-white/10">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-white/60">{label}</span>
        <span style={{ color }}>{icon}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

function EmailRow({
  email,
  expanded,
  onToggle,
  onSend,
  onSkip,
}: {
  email: QueuedEmail;
  expanded: boolean;
  onToggle: () => void;
  onSend: () => void;
  onSkip: () => void;
}) {
  const tpl = getTemplateConfig(email.templateId);
  const sc = statusConfig(email.status);
  const StatusIcon = sc.icon;

  return (
    <div
      className="rounded-xl border transition-all"
      style={{ borderColor: expanded ? `${tpl.color}40` : 'rgba(255,255,255,0.08)', background: expanded ? `${tpl.color}04` : 'rgba(0,0,0,0.3)' }}
    >
      <button onClick={onToggle} className="w-full px-5 py-4 flex items-center gap-4 text-left">
        {/* Template icon */}
        <span className="text-xl flex-shrink-0">{tpl.icon}</span>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-semibold text-sm text-white truncate">{email.subject}</span>
            {email.activeVariant && (
              <span
                className="px-1.5 py-0.5 rounded text-[9px] font-bold flex-shrink-0 uppercase tracking-wider"
                style={{
                  background: email.activeVariant === 'A' ? `${PURPLE}25` : `${CYAN}25`,
                  color: email.activeVariant === 'A' ? PURPLE : CYAN,
                }}
              >
                {email.activeVariant}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-white/50">
            <span>{email.contactName}</span>
            <span>&bull;</span>
            <span>{email.companyName}</span>
            <span>&bull;</span>
            <span className="truncate">{email.contactEmail}</span>
          </div>
        </div>

        {/* Status badge */}
        <div
          className="px-2.5 py-1 rounded-full flex items-center gap-1.5 text-xs font-semibold flex-shrink-0"
          style={{ background: sc.bg, color: sc.color }}
        >
          <StatusIcon className="size-3" />
          {sc.label}
        </div>

        {/* Time */}
        <div className="text-xs text-white/40 flex-shrink-0 w-20 text-right">
          {email.status === 'pending' ? timeUntil(email.scheduledAt) : timeAgo(email.sentAt || email.scheduledAt)}
        </div>

        {/* Chevron */}
        {expanded ? <ChevronUp className="size-4 text-white/30" /> : <ChevronDown className="size-4 text-white/30" />}
      </button>

      {/* Expanded preview */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 pt-0 border-t border-white/5">
              <div className="p-4 rounded-xl bg-white/3 mt-3 mb-4">
                <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-1">Preview</p>
                <p className="text-sm text-white/70 leading-relaxed">{email.previewText}</p>
              </div>

              {/* Full HTML preview */}
              <EmailHTMLPreview emailId={email.id} />

              <div className="flex items-center gap-3 text-xs text-white/40">
                <span>Template: <strong className="text-white/60">{tpl.label}</strong></span>
                {email.readinessScore != null && (
                  <span className="contents">
                    <span>&bull;</span>
                    <span>Score: <strong className="text-white/60">{email.readinessScore}/100</strong></span>
                  </span>
                )}
                {email.bottleneckTheme && (
                  <span className="contents">
                    <span>&bull;</span>
                    <span>Theme: <strong className="text-white/60">{email.bottleneckTheme}</strong></span>
                  </span>
                )}
                <div className="flex-1" />

                {email.status === 'pending' && (
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); onSend(); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] text-white text-xs font-semibold hover:opacity-90 transition-opacity"
                    >
                      <Send className="size-3" />
                      Mark Sent
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onSkip(); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 text-xs font-semibold transition-all"
                    >
                      <XCircle className="size-3" />
                      Skip
                    </button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function LeadGroup({
  group,
  onSend,
  onSkip,
}: {
  group: {
    submissionId: string;
    contactName: string;
    companyName: string;
    contactEmail: string;
    industry: string;
    readinessScore?: number;
    emails: QueuedEmail[];
  };
  onSend: (id: string) => void;
  onSkip: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const pending = group.emails.filter((e) => e.status === 'pending').length;
  const sent = group.emails.filter((e) => e.status === 'sent').length;

  return (
    <div className="rounded-2xl border border-white/10 overflow-hidden bg-black/30">
      {/* Lead header */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-6 py-4 flex items-center gap-4 text-left hover:bg-white/3 transition-colors"
      >
        <div className="size-10 rounded-xl bg-gradient-to-br from-[#8B5CF6]/20 to-[#3B82F6]/20 flex items-center justify-center flex-shrink-0">
          <Mail className="size-5 text-[#8B5CF6]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-white">{group.contactName}</div>
          <div className="text-xs text-white/50">{group.companyName} &bull; {group.contactEmail}</div>
        </div>
        {group.readinessScore != null && (
          <div className="px-2.5 py-1 rounded-full bg-[#8B5CF6]/15 text-[#8B5CF6] text-xs font-bold flex-shrink-0">
            Score: {group.readinessScore}
          </div>
        )}
        <div className="flex gap-2 text-xs flex-shrink-0">
          <span className="px-2 py-1 rounded-full" style={{ background: `${GREEN}15`, color: GREEN }}>{sent} sent</span>
          {pending > 0 && (
            <span className="px-2 py-1 rounded-full" style={{ background: `${ORANGE}15`, color: ORANGE }}>{pending} pending</span>
          )}
        </div>
        {open ? <ChevronUp className="size-4 text-white/30" /> : <ChevronDown className="size-4 text-white/30" />}
      </button>

      {/* Sequence timeline */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="px-6 pb-4 space-y-1">
              {group.emails.map((email, i) => {
                const tpl = getTemplateConfig(email.templateId);
                const sc = statusConfig(email.status);
                const StatusIcon = sc.icon;

                return (
                  <div key={email.id} className="flex items-center gap-3 py-2.5 relative">
                    {/* Timeline connector */}
                    {i < group.emails.length - 1 && (
                      <div className="absolute left-[15px] top-[28px] bottom-[-4px] w-px bg-white/8" />
                    )}

                    {/* Dot */}
                    <div
                      className="size-[30px] rounded-full flex items-center justify-center flex-shrink-0 z-10 text-sm"
                      style={{ background: sc.bg, color: sc.color }}
                    >
                      <StatusIcon className="size-3.5" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{tpl.icon}</span>
                        <span className="text-sm font-semibold text-white truncate">{tpl.label}</span>
                        {email.activeVariant && (
                          <span
                            className="px-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider flex-shrink-0"
                            style={{
                              background: email.activeVariant === 'A' ? `${PURPLE}25` : `${CYAN}25`,
                              color: email.activeVariant === 'A' ? PURPLE : CYAN,
                            }}
                          >
                            {email.activeVariant}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-white/40 truncate">{email.subject}</p>
                    </div>

                    {/* Time */}
                    <span className="text-xs text-white/40 flex-shrink-0">
                      {email.status === 'pending' ? timeUntil(email.scheduledAt) : timeAgo(email.sentAt || email.scheduledAt)}
                    </span>

                    {/* Actions */}
                    {email.status === 'pending' && (
                      <div className="flex gap-1.5 flex-shrink-0">
                        <button
                          onClick={() => onSend(email.id)}
                          className="p-1.5 rounded-lg bg-[#8B5CF6]/20 text-[#8B5CF6] hover:bg-[#8B5CF6]/30 transition-colors"
                          title="Mark as sent"
                        >
                          <Send className="size-3" />
                        </button>
                        <button
                          onClick={() => onSkip(email.id)}
                          className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:bg-white/10 transition-colors"
                          title="Skip"
                        >
                          <XCircle className="size-3" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Email HTML Preview (toggle in expanded row) ──────────────────────────────

function EmailHTMLPreview({ emailId }: { emailId: string }) {
  const [showHTML, setShowHTML] = useState(false);
  const preview = useMemo(() => showHTML ? getEmailPreview(emailId) : null, [showHTML, emailId]);

  return (
    <div className="mb-4">
      <button
        onClick={(e) => { e.stopPropagation(); setShowHTML(!showHTML); }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/50 text-xs font-semibold transition-all mb-3"
      >
        <Eye className="size-3" />
        {showHTML ? 'Hide' : 'Show'} Email Preview
      </button>

      {showHTML && preview && (
        <div className="rounded-xl border border-white/10 overflow-hidden">
          {/* Email header bar */}
          <div className="px-4 py-3 bg-white/5 border-b border-white/10 space-y-1">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-white/40 w-12">From:</span>
              <span className="text-white/70">{preview.from}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-white/40 w-12">To:</span>
              <span className="text-white/70">{preview.to}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-white/40 w-12">Subject:</span>
              <span className="text-white font-semibold">{preview.subject}</span>
            </div>
          </div>
          {/* Rendered HTML */}
          <div className="p-1">
            <iframe
              srcDoc={preview.html}
              title="Email preview"
              className="w-full border-0 rounded-lg bg-[#0A0A1A]"
              style={{ height: '320px', pointerEvents: 'none' }}
              sandbox=""
            />
          </div>
          {/* Personalisation tokens */}
          <div className="px-4 py-2 border-t border-white/5 flex flex-wrap gap-2">
            {Object.entries(preview.personalisation).filter(([, v]) => v).map(([k, v]) => (
              <span key={k} className="px-2 py-0.5 rounded-full bg-[#8B5CF6]/10 text-[#8B5CF6] text-[10px] font-mono">
                {`{{${k}}}`} = {v}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Delivery Analytics Panel ─────────────────────────────────────────────────

function DeliveryAnalytics() {
  const stats = useMemo(() => getDemoDeliveryStats(), []);
  const templatePerf = useMemo(() => getDemoTemplatePerformance(), []);

  const overviewCards: { label: string; value: string; sub: string; color: string }[] = [
    { label: 'Delivery Rate', value: `${stats.deliveryRate}%`, sub: `${stats.delivered} / ${stats.totalSent}`, color: GREEN },
    { label: 'Open Rate', value: `${stats.openRate}%`, sub: `${stats.opened} opened`, color: BLUE },
    { label: 'Click Rate', value: `${stats.clickRate}%`, sub: `${stats.clicked} clicks`, color: CYAN },
    { label: 'Bounce Rate', value: `${stats.bounceRate}%`, sub: `${stats.bounced} bounced`, color: stats.bounceRate > 5 ? RED : ORANGE },
  ];

  return (
    <div className="space-y-6">
      {/* Overview cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {overviewCards.map((card) => (
          <div key={card.label} className="p-5 rounded-xl bg-black/40 border border-white/10 relative overflow-hidden">
            <div className="absolute inset-0 opacity-5 rounded-xl" style={{ background: `radial-gradient(circle at 80% 20%, ${card.color}, transparent 70%)` }} />
            <div className="relative">
              <p className="text-xs text-white/50 mb-1">{card.label}</p>
              <p className="text-3xl font-bold" style={{ color: card.color }}>{card.value}</p>
              <p className="text-[11px] text-white/40 mt-1">{card.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Per-template performance table */}
      <div className="rounded-xl border border-white/10 overflow-hidden bg-black/30">
        <div className="px-5 py-3 border-b border-white/10 bg-white/3">
          <h3 className="text-sm font-bold text-white/80">Performance by Template</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left px-5 py-3 text-xs font-semibold text-white/40 uppercase tracking-wider">Template</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-white/40 uppercase tracking-wider">Sent</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-white/40 uppercase tracking-wider">Delivered</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-white/40 uppercase tracking-wider">Open Rate</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-white/40 uppercase tracking-wider">Click Rate</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-white/40 uppercase tracking-wider hidden lg:table-cell">Best Subject</th>
              </tr>
            </thead>
            <tbody>
              {templatePerf.map((tp) => {
                const tplCfg = getTemplateConfig(tp.templateId);
                return (
                  <tr key={tp.templateId} className="border-b border-white/5 last:border-0 hover:bg-white/3 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{tplCfg.icon}</span>
                        <span className="font-medium text-white/80">{tp.label}</span>
                      </div>
                    </td>
                    <td className="text-right px-4 py-3 text-white/70 font-mono text-xs">{tp.stats.totalSent}</td>
                    <td className="text-right px-4 py-3 text-white/70 font-mono text-xs">{tp.stats.delivered}</td>
                    <td className="text-right px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${tp.stats.openRate}%`, background: tp.stats.openRate >= 50 ? GREEN : tp.stats.openRate >= 30 ? ORANGE : RED }} />
                        </div>
                        <span className="text-xs font-mono text-white/70 w-10 text-right">{tp.stats.openRate}%</span>
                      </div>
                    </td>
                    <td className="text-right px-4 py-3">
                      <span className="text-xs font-mono text-white/70">{tp.stats.clickRate}%</span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-xs text-white/50 truncate block max-w-[240px]">{tp.bestSubjectLine}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Demo mode disclaimer */}
      {!FEATURES.BACKEND_INTEGRATION && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#FB923C]/5 border border-[#FB923C]/15">
          <Zap className="size-4 text-[#FB923C] flex-shrink-0" />
          <p className="text-xs text-white/50">
            <span className="text-[#FB923C] font-semibold">Demo Mode</span> — These metrics are simulated based on industry
            benchmarks. Connect Resend and flip <code className="text-white/60 bg-white/5 px-1 rounded">BACKEND_INTEGRATION</code> to
            true for real delivery tracking via webhooks.
          </p>
        </div>
      )}
    </div>
  );
}