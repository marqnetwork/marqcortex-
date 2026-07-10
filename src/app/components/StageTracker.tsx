/**
 * STAGE TRACKER — 13A
 *
 * Read-only horizontal pipeline timeline for the client portal.
 * Updates live via ClientPortal's 30 s polling loop.
 *
 * Sections:
 *   • Track header  — "Your Journey" + live-sync badge + last-updated clock
 *   • Connector bar — gradient fill that animates as stages advance
 *   • Stage nodes   — icon + label + sub-label, 3 visual states
 *   • Stage detail  — expanded card beneath the active step
 *   • ETA chips     — estimated timeframe on future steps
 *   • Status-change toast — brief "Status Updated" flash when stage advances
 */

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  CheckCircle2, Loader2, Search, FileText, Calendar,
  Radio, Sparkles, Clock, ChevronRight,
} from 'lucide-react';

// ── Stage definitions ─────────────────────────────────────────────────────────

type StageId = 'submitted' | 'in-review' | 'report-ready' | 'call-scheduled';

const STAGES: {
  id:            StageId;
  label:         string;
  shortLabel:    string;
  description:   string;
  completedMsg:  string;
  etaMessage:    string;
  icon:          React.ComponentType<{ className?: string }>;
}[] = [
  {
    id:           'submitted',
    label:        'Diagnostic Submitted',
    shortLabel:   'Submitted',
    description:  'Your operational diagnostic was received. Our team has been notified.',
    completedMsg: 'Submission confirmed',
    etaMessage:   'Typically instant',
    icon:         CheckCircle2,
  },
  {
    id:           'in-review',
    label:        'Under Review',
    shortLabel:   'In Review',
    description:  'Our analysts are cross-referencing your answers against 200+ operational patterns to generate your personalised readiness score.',
    completedMsg: 'Analysis complete',
    etaMessage:   '1–2 business days',
    icon:         Search,
  },
  {
    id:           'report-ready',
    label:        'Report Available',
    shortLabel:   'Report Ready',
    description:  'Your personalised readiness report is now available. Review your full score breakdown and prioritised recommendations.',
    completedMsg: 'Report generated',
    etaMessage:   'Unlocks after review',
    icon:         FileText,
  },
  {
    id:           'call-scheduled',
    label:        'Discovery Call Booked',
    shortLabel:   'Call Booked',
    description:  'Your discovery call is confirmed. We\'ll walk through your report together and map out the highest-impact next steps.',
    completedMsg: 'Call confirmed',
    etaMessage:   'Book anytime',
    icon:         Calendar,
  },
];

function stageIndex(id: StageId): number {
  return STAGES.findIndex(s => s.id === id);
}

// ── Live-clock sub-component ──────────────────────────────────────────────────

function LiveClock({ iso }: { iso: string }) {
  const [label, setLabel] = useState(() => timeAgo(iso));
  useEffect(() => {
    const id = setInterval(() => setLabel(timeAgo(iso)), 5000);
    return () => clearInterval(id);
  }, [iso]);
  return <span className="contents">{label}</span>;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 10)  return 'just now';
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Main component ────────────────────────────────────────────────────────────

interface StageTrackerProps {
  activeStage:    StageId;
  submittedAt?:   string;
  lastUpdated?:   string; // ISO — when ClientPortal last polled successfully
  isRefreshing?:  boolean;
  onViewReport?:  () => void;
  onSchedule?:    () => void;
}

export function StageTracker({
  activeStage,
  submittedAt,
  lastUpdated,
  isRefreshing = false,
  onViewReport,
  onSchedule,
}: StageTrackerProps) {
  // Inject keyframes for the live-radio-pulse animation
  if (typeof document !== 'undefined' && !document.getElementById('stage-tracker-kf')) {
    const s = document.createElement('style');
    s.id = 'stage-tracker-kf';
    s.textContent = `
      @keyframes live-radio-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.35; }
      }
    `;
    document.head.appendChild(s);
  }
  const activeIdx   = stageIndex(activeStage);
  const prevIdxRef  = useRef(activeIdx);
  const [flash, setFlash]  = useState(false);
  const [expanded, setExpanded] = useState<number>(activeIdx);

  // Flash "Status Updated" when stage advances
  useEffect(() => {
    if (activeIdx !== prevIdxRef.current) {
      prevIdxRef.current = activeIdx;
      setExpanded(activeIdx);
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 3200);
      return () => clearTimeout(t);
    }
  }, [activeIdx]);

  // progress fraction for the connector bar: 0 → 1
  const progress = activeIdx / (STAGES.length - 1);

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.09)' }}
    >
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-6 pt-6 pb-4"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div>
          <h3 className="text-white font-bold text-base leading-tight">Your Journey</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">Real-time progress through our engagement process</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Status-change flash */}
          <AnimatePresence>
            {flash && (
              <motion.div
                initial={{ opacity: 0, scale: 0.85, x: 10 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.85, x: 10 }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold"
                style={{
                  background: 'rgba(16,185,129,0.15)',
                  border:     '1px solid rgba(16,185,129,0.35)',
                  color:      '#10B981',
                }}
              >
                <Sparkles className="size-3" />
                Status Updated
              </motion.div>
            )}
          </AnimatePresence>

          {/* Live-sync badge */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium"
            style={{
              background: 'rgba(6,215,246,0.08)',
              border:     '1px solid rgba(6,215,246,0.18)',
              color:      '#06D7F6',
            }}
          >
            {isRefreshing
              ? <Loader2 className="size-3 animate-spin" />
              : <Radio className="size-3" style={{ animation: 'live-radio-pulse 2.4s ease-in-out infinite' }} />}
            <span>Live</span>
            {lastUpdated && (
              <span className="text-[#06D7F6]/60">· <LiveClock iso={lastUpdated} /></span>
            )}
          </div>
        </div>
      </div>

      {/* ── Horizontal track ──────────────────────────────────────────── */}
      <div className="px-6 pt-8 pb-4">
        {/* Node + connector row */}
        <div className="relative flex items-start">
          {/* Background rail */}
          <div
            className="absolute top-6 left-6 right-6 h-0.5 rounded-full"
            style={{ background: 'rgba(255,255,255,0.06)' }}
          />
          {/* Filled rail */}
          <motion.div
            className="absolute top-6 left-6 h-0.5 rounded-full"
            style={{
              background: 'linear-gradient(90deg, #8B5CF6, #3B82F6, #06D7F6)',
              transformOrigin: 'left',
            }}
            initial={false}
            animate={{ width: `calc(${progress * 100}% - 48px * ${progress})` }}
            transition={{ duration: 0.9, ease: [0.4, 0, 0.2, 1] }}
          />

          {/* Stage nodes */}
          {STAGES.map((stage, idx) => {
            const isDone    = idx < activeIdx;
            const isActive  = idx === activeIdx;
            const isFuture  = idx > activeIdx;
            const Icon      = stage.icon;

            return (
              <div
                key={stage.id}
                className="flex-1 flex flex-col items-center gap-2 relative cursor-pointer group"
                onClick={() => setExpanded(expanded === idx ? -1 : idx)}
              >
                {/* Node circle */}
                <motion.div
                  className="relative z-10 flex items-center justify-center rounded-full"
                  style={{
                    width:  48,
                    height: 48,
                    background: isDone
                      ? 'linear-gradient(135deg, #10B981, #059669)'
                      : isActive
                        ? 'linear-gradient(135deg, #8B5CF6, #3B82F6)'
                        : 'rgba(255,255,255,0.04)',
                    border: isDone
                      ? '2px solid #10B981'
                      : isActive
                        ? '2px solid #8B5CF6'
                        : '2px solid rgba(255,255,255,0.12)',
                    boxShadow: isActive
                      ? '0 0 0 6px rgba(139,92,246,0.12), 0 0 20px rgba(139,92,246,0.25)'
                      : isDone
                        ? '0 0 0 4px rgba(16,185,129,0.10)'
                        : 'none',
                  }}
                  animate={isActive ? { scale: [1, 1.06, 1] } : { scale: 1 }}
                  transition={isActive ? { duration: 2.4, repeat: Infinity, ease: 'easeInOut' } : {}}
                >
                  {isDone ? (
                    <CheckCircle2 className="size-5 text-white" />
                  ) : isActive ? (
                    <Icon className="size-5 text-white" />
                  ) : (
                    <Icon className="size-5" style={{ color: 'rgba(255,255,255,0.2)' }} />
                  )}

                  {/* Active pulse ring */}
                  {isActive && (
                    <motion.div
                      className="absolute inset-0 rounded-full"
                      style={{ border: '2px solid rgba(139,92,246,0.5)' }}
                      animate={{ scale: [1, 1.35, 1], opacity: [0.5, 0, 0.5] }}
                      transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
                    />
                  )}
                </motion.div>

                {/* Stage label */}
                <div className="text-center px-1">
                  <div
                    className="text-[11px] font-bold leading-tight"
                    style={{
                      color: isDone ? '#10B981' : isActive ? '#FFFFFF' : 'rgba(255,255,255,0.25)',
                    }}
                  >
                    {stage.shortLabel}
                  </div>

                  {/* Status badge */}
                  {isActive && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold"
                      style={{
                        background: 'rgba(139,92,246,0.2)',
                        border:     '1px solid rgba(139,92,246,0.4)',
                        color:      '#C4B5FD',
                      }}
                    >
                      <span className="size-1.5 rounded-full bg-[#8B5CF6] animate-pulse inline-block" />
                      NOW
                    </motion.div>
                  )}
                  {isDone && (
                    <div
                      className="mt-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold"
                      style={{
                        background: 'rgba(16,185,129,0.15)',
                        border:     '1px solid rgba(16,185,129,0.3)',
                        color:      '#6EE7B7',
                      }}
                    >
                      ✓ Done
                    </div>
                  )}
                  {isFuture && (
                    <div
                      className="mt-1 inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px]"
                      style={{ color: 'rgba(255,255,255,0.18)' }}
                    >
                      <Clock className="size-2.5" />
                      {stage.etaMessage}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Expanded stage detail ─────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {expanded >= 0 && (
          <motion.div
            key={expanded}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <StageDetailCard
              stage={STAGES[expanded]}
              state={
                expanded < activeIdx ? 'done'
                : expanded === activeIdx ? 'active'
                : 'future'
              }
              submittedAt={expanded === 0 ? submittedAt : undefined}
              onViewReport={expanded === stageIndex('report-ready') ? onViewReport : undefined}
              onSchedule={expanded === stageIndex('call-scheduled') ? onSchedule : undefined}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Bottom bar — step N of M + submission date ───────────────── */}
      <div
        className="flex items-center justify-between px-6 py-3 text-[11px] text-gray-600"
        style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
      >
        <span>
          Step <span className="text-white font-semibold">{activeIdx + 1}</span> of{' '}
          <span className="text-white font-semibold">{STAGES.length}</span>
        </span>
        {submittedAt && (
          <span>
            Submitted{' '}
            {new Date(submittedAt).toLocaleDateString('en-US', {
              month: 'short', day: 'numeric', year: 'numeric',
            })}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Stage detail card ─────────────────────────────────────────────────────────

function StageDetailCard({
  stage,
  state,
  submittedAt,
  onViewReport,
  onSchedule,
}: {
  stage:        typeof STAGES[number];
  state:        'done' | 'active' | 'future';
  submittedAt?: string;
  onViewReport?: () => void;
  onSchedule?:  () => void;
}) {
  const Icon   = stage.icon;
  const accent = state === 'done' ? '#10B981' : state === 'active' ? '#8B5CF6' : 'rgba(255,255,255,0.25)';
  const bgAcc  = state === 'done' ? 'rgba(16,185,129,0.06)' : state === 'active' ? 'rgba(139,92,246,0.06)' : 'rgba(255,255,255,0.02)';

  return (
    <div
      className="mx-6 mb-5 rounded-xl p-4"
      style={{ background: bgAcc, border: `1px solid ${accent}30` }}
    >
      <div className="flex items-start gap-3">
        <div
          className="size-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: `${accent}18`, border: `1px solid ${accent}30` }}
        >
          <Icon className="size-4" style={{ color: accent }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-bold text-white">{stage.label}</span>
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
              style={{ background: `${accent}18`, color: accent }}
            >
              {state === 'done' ? stage.completedMsg : state === 'active' ? 'In Progress' : 'Upcoming'}
            </span>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed">{stage.description}</p>

          {/* Submitted-at for stage 0 */}
          {submittedAt && state === 'done' && (
            <div className="flex items-center gap-1.5 mt-2 text-[11px] text-gray-600">
              <Clock className="size-3" />
              {new Date(submittedAt).toLocaleString('en-US', {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
              })}
            </div>
          )}

          {/* Action buttons */}
          {onViewReport && state !== 'future' && (
            <button
              onClick={onViewReport}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
              style={{
                background: 'rgba(139,92,246,0.18)',
                border:     '1px solid rgba(139,92,246,0.35)',
                color:      '#C4B5FD',
              }}
            >
              View Report <ChevronRight className="size-3" />
            </button>
          )}
          {onSchedule && (
            <button
              onClick={onSchedule}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
              style={{
                background: 'rgba(6,215,246,0.12)',
                border:     '1px solid rgba(6,215,246,0.25)',
                color:      '#06D7F6',
              }}
            >
              Book a Call <ChevronRight className="size-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}