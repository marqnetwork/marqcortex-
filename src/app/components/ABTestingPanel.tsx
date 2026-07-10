/**
 * A/B SUBJECT LINE TESTING PANEL
 *
 * Shows per-template subject line variants with:
 *   - Side-by-side comparison of variant A vs B
 *   - Send distribution bar (A vs B)
 *   - Winner badge when one variant leads
 *   - Bulk "Apply Winner" to all pending emails
 *   - Per-email variant toggle in the queue
 */

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Beaker, Trophy, ArrowRight, ToggleLeft, ToggleRight,
  CheckCircle2, ChevronDown, ChevronUp, Zap, BarChart3,
  Mail, RefreshCw, Sparkles,
} from 'lucide-react';
import {
  seedABVariants,
  getABTestStats,
  bulkApplyVariant,
  switchVariant,
  getEmailQueue,
  type ABTestStats,
  type QueuedEmail,
  type EmailTemplateId,
} from '@/app/utils/emailNurtureQueue';

// ── Palette ──────────────────────────────────────────────────────────────────
const PURPLE = '#8B5CF6';
const BLUE = '#3B82F6';
const CYAN = '#06D7F6';
const ORANGE = '#FB923C';
const GREEN = '#10B981';

// ── Main component ───────────────────────────────────────────────────────────

interface ABTestingPanelProps {
  onRefreshQueue: () => void;
}

export function ABTestingPanel({ onRefreshQueue }: ABTestingPanelProps) {
  const [stats, setStats] = useState<ABTestStats[]>([]);
  const [expandedTemplate, setExpandedTemplate] = useState<EmailTemplateId | null>(null);
  const [queue, setQueue] = useState<QueuedEmail[]>([]);
  const [isSeeded, setIsSeeded] = useState(false);

  const refresh = () => {
    seedABVariants(); // idempotent
    setStats(getABTestStats());
    setQueue(getEmailQueue());
    setIsSeeded(true);
  };

  useEffect(() => { refresh(); }, []);

  // Overall stats
  const totals = useMemo(() => {
    let sentA = 0, sentB = 0, pendingA = 0, pendingB = 0;
    for (const s of stats) {
      sentA += s.sentA;
      sentB += s.sentB;
      pendingA += s.pendingA;
      pendingB += s.pendingB;
    }
    return { sentA, sentB, pendingA, pendingB, totalSent: sentA + sentB, totalPending: pendingA + pendingB };
  }, [stats]);

  const handleBulkApply = (templateId: EmailTemplateId, variant: 'A' | 'B') => {
    bulkApplyVariant(templateId, variant);
    refresh();
    onRefreshQueue();
  };

  const handleToggleVariant = (emailId: string) => {
    switchVariant(emailId);
    refresh();
    onRefreshQueue();
  };

  if (!isSeeded || stats.length === 0) {
    return (
      <div className="text-center py-16 text-white/40">
        <Beaker className="size-12 mx-auto mb-4 opacity-30" />
        <p className="text-lg font-semibold mb-1">No A/B tests available</p>
        <p className="text-sm">Queue some emails first, then A/B variants will auto-generate.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Summary Cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <SummaryCard
          label="Total Sent"
          value={totals.totalSent}
          subtitle={`${totals.sentA} A / ${totals.sentB} B`}
          color={GREEN}
          icon={<CheckCircle2 className="size-5" />}
        />
        <SummaryCard
          label="Pending"
          value={totals.totalPending}
          subtitle={`${totals.pendingA} A / ${totals.pendingB} B`}
          color={ORANGE}
          icon={<Mail className="size-5" />}
        />
        <SummaryCard
          label="Templates"
          value={stats.length}
          subtitle="with A/B variants"
          color={PURPLE}
          icon={<Beaker className="size-5" />}
        />
        <SummaryCard
          label="Split"
          value={totals.totalSent > 0
            ? `${Math.round((totals.sentA / totals.totalSent) * 100)}/${Math.round((totals.sentB / totals.totalSent) * 100)}`
            : '50/50'
          }
          subtitle="A/B distribution"
          color={CYAN}
          icon={<BarChart3 className="size-5" />}
        />
      </div>

      {/* ── Per-Template Cards ──────────────────────────────────── */}
      <div className="space-y-4">
        {stats.map((stat) => {
          const isExpanded = expandedTemplate === stat.templateId;
          const totalSent = stat.sentA + stat.sentB;
          const aWinning = stat.sentA > stat.sentB;
          const bWinning = stat.sentB > stat.sentA;
          const tied = stat.sentA === stat.sentB;
          const aPct = totalSent > 0 ? Math.round((stat.sentA / totalSent) * 100) : 50;

          // Emails for this template
          const templateEmails = queue.filter(
            (e) => e.templateId === stat.templateId && e.subjectVariantA && e.subjectVariantB
          );
          const pendingEmails = templateEmails.filter((e) => e.status === 'pending');

          return (
            <motion.div
              key={stat.templateId}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border overflow-hidden"
              style={{
                borderColor: isExpanded ? `${stat.color}40` : 'rgba(255,255,255,0.08)',
                background: isExpanded ? `${stat.color}04` : 'rgba(0,0,0,0.3)',
              }}
            >
              {/* Header */}
              <button
                onClick={() => setExpandedTemplate(isExpanded ? null : stat.templateId)}
                className="w-full px-6 py-5 flex items-center gap-4 text-left hover:bg-white/[0.02] transition-colors"
              >
                <span className="text-2xl flex-shrink-0">{stat.icon}</span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-bold text-white">{stat.label}</span>
                    {totalSent > 0 && !tied && (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                        style={{
                          background: `${GREEN}20`,
                          color: GREEN,
                        }}
                      >
                        <Trophy className="size-3" />
                        {aWinning ? 'A leading' : 'B leading'}
                      </span>
                    )}
                    {totalSent > 0 && tied && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white/10 text-white/60">
                        Tied
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-white/40">
                    {totalSent} sent ({stat.sentA}A / {stat.sentB}B) &bull; {stat.pendingA + stat.pendingB} pending
                  </div>
                </div>

                {/* Mini distribution bar */}
                <div className="w-32 flex-shrink-0 hidden sm:block">
                  <div className="h-2 rounded-full bg-white/10 overflow-hidden flex">
                    <div
                      className="h-full rounded-l-full transition-all duration-500"
                      style={{ width: `${aPct}%`, background: PURPLE }}
                    />
                    <div
                      className="h-full rounded-r-full transition-all duration-500"
                      style={{ width: `${100 - aPct}%`, background: CYAN }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-white/30 mt-1">
                    <span>A {aPct}%</span>
                    <span>B {100 - aPct}%</span>
                  </div>
                </div>

                {isExpanded ? <ChevronUp className="size-5 text-white/30" /> : <ChevronDown className="size-5 text-white/30" />}
              </button>

              {/* Expanded content */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-6 pb-6 pt-2 border-t border-white/5">
                      {/* A vs B comparison */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                        <VariantCard
                          variant="A"
                          subject={stat.sampleSubjectA}
                          sentCount={stat.sentA}
                          pendingCount={stat.pendingA}
                          isWinning={aWinning}
                          color={PURPLE}
                          totalSent={totalSent}
                        />
                        <VariantCard
                          variant="B"
                          subject={stat.sampleSubjectB}
                          sentCount={stat.sentB}
                          pendingCount={stat.pendingB}
                          isWinning={bWinning}
                          color={CYAN}
                          totalSent={totalSent}
                        />
                      </div>

                      {/* Bulk actions */}
                      {pendingEmails.length > 0 && (
                        <div className="flex items-center gap-3 mb-6 p-4 rounded-xl bg-white/[0.03] border border-white/5">
                          <Zap className="size-4 text-[#FB923C] flex-shrink-0" />
                          <span className="text-sm text-white/70 flex-1">
                            Apply winning variant to all <strong className="text-white">{pendingEmails.length}</strong> pending emails?
                          </span>
                          <button
                            onClick={() => handleBulkApply(stat.templateId, 'A')}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                            style={{
                              background: aWinning ? `${PURPLE}30` : 'rgba(255,255,255,0.05)',
                              color: aWinning ? PURPLE : 'rgba(255,255,255,0.5)',
                              border: aWinning ? `1px solid ${PURPLE}50` : '1px solid rgba(255,255,255,0.08)',
                            }}
                          >
                            Apply A to all
                          </button>
                          <button
                            onClick={() => handleBulkApply(stat.templateId, 'B')}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                            style={{
                              background: bWinning ? `${CYAN}30` : 'rgba(255,255,255,0.05)',
                              color: bWinning ? CYAN : 'rgba(255,255,255,0.5)',
                              border: bWinning ? `1px solid ${CYAN}50` : '1px solid rgba(255,255,255,0.08)',
                            }}
                          >
                            Apply B to all
                          </button>
                        </div>
                      )}

                      {/* Per-email list (pending only for toggling) */}
                      {pendingEmails.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs text-white/40 uppercase tracking-wider font-bold mb-3">
                            Pending Emails &mdash; click to toggle variant
                          </p>
                          {pendingEmails.map((email) => (
                            <div
                              key={email.id}
                              className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-colors"
                            >
                              <span
                                className="px-2 py-0.5 rounded text-[10px] font-bold flex-shrink-0"
                                style={{
                                  background: email.activeVariant === 'A' ? `${PURPLE}25` : `${CYAN}25`,
                                  color: email.activeVariant === 'A' ? PURPLE : CYAN,
                                }}
                              >
                                {email.activeVariant || 'A'}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-white truncate">{email.subject}</p>
                                <p className="text-xs text-white/40 truncate">
                                  {email.contactName} &bull; {email.companyName}
                                </p>
                              </div>
                              <button
                                onClick={() => handleToggleVariant(email.id)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-white/60 hover:text-white transition-all flex-shrink-0"
                              >
                                <RefreshCw className="size-3" />
                                Switch to {email.activeVariant === 'A' ? 'B' : 'A'}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Sent emails summary */}
                      {totalSent > 0 && (
                        <div className="mt-4 pt-4 border-t border-white/5">
                          <p className="text-xs text-white/40 uppercase tracking-wider font-bold mb-2">
                            Sent Distribution
                          </p>
                          <div className="h-8 rounded-lg overflow-hidden flex">
                            {stat.sentA > 0 && (
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${(stat.sentA / totalSent) * 100}%` }}
                                transition={{ duration: 0.6, ease: 'easeOut' }}
                                className="h-full flex items-center justify-center text-[10px] font-bold text-white"
                                style={{ background: PURPLE }}
                              >
                                {stat.sentA > 0 && `A: ${stat.sentA}`}
                              </motion.div>
                            )}
                            {stat.sentB > 0 && (
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${(stat.sentB / totalSent) * 100}%` }}
                                transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 }}
                                className="h-full flex items-center justify-center text-[10px] font-bold text-white"
                                style={{ background: CYAN }}
                              >
                                {stat.sentB > 0 && `B: ${stat.sentB}`}
                              </motion.div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({
  label, value, subtitle, color, icon,
}: {
  label: string;
  value: number | string;
  subtitle: string;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="p-4 rounded-xl bg-black/40 border border-white/10">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-white/60">{label}</span>
        <span style={{ color }}>{icon}</span>
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-[10px] text-white/40">{subtitle}</div>
    </div>
  );
}

function VariantCard({
  variant, subject, sentCount, pendingCount, isWinning, color, totalSent,
}: {
  variant: 'A' | 'B';
  subject: string;
  sentCount: number;
  pendingCount: number;
  isWinning: boolean;
  color: string;
  totalSent: number;
}) {
  const pct = totalSent > 0 ? Math.round((sentCount / totalSent) * 100) : 0;

  return (
    <div
      className="p-5 rounded-xl border transition-all"
      style={{
        borderColor: isWinning ? `${color}60` : 'rgba(255,255,255,0.08)',
        background: isWinning ? `${color}08` : 'rgba(255,255,255,0.02)',
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span
          className="px-2.5 py-1 rounded-lg text-xs font-bold"
          style={{ background: `${color}25`, color }}
        >
          Variant {variant}
        </span>
        {isWinning && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase" style={{ color: GREEN }}>
            <Trophy className="size-3" />
            Winner
          </span>
        )}
      </div>

      <p className="text-sm font-medium text-white mb-4 leading-relaxed min-h-[40px]">
        &ldquo;{subject}&rdquo;
      </p>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-white/50">Sent</span>
          <span className="font-bold text-white">{sentCount} ({pct}%)</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="h-full rounded-full"
            style={{ background: color }}
          />
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-white/50">Pending</span>
          <span className="text-white/70">{pendingCount}</span>
        </div>
      </div>
    </div>
  );
}
