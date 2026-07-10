/**
 * ENGAGEMENT ACTIVITY FEED — 13C
 *
 * Micro-timeline of client engagement events on the portal Status view.
 *
 * Events:
 *   portal_opened       — opened their client portal
 *   report_viewed       — opened the readiness report
 *   cta_clicked         — clicked "Schedule a Call"
 *   pdf_printed         — printed / saved the report as PDF
 *   proposal_viewed     — opened the proposal tab
 *   meeting_scheduled   — booked a discovery call
 *   message_sent        — sent a message to the team
 *
 * Features:
 *   • Fetches from GET /client/submission/:id/engagement/log
 *   • Polls every 30 s to catch same-session events recorded server-side
 *   • Consecutive identical events collapsed into a count badge
 *   • "Show all" toggle when more than MAX_VISIBLE items
 *   • Skeleton while loading; empty state if no events yet
 *   • Live "• LIVE" indicator pulses while polling
 *   • Each event row: coloured dot + icon + label + relative timestamp
 *   • AnimatePresence stagger entrance on initial load
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Eye, FileText, Zap, Printer, FileCheck2, Calendar, MessageSquare,
  Clock, Activity, ChevronDown, ChevronUp, RefreshCw,
} from 'lucide-react';
import {
  getEngagementLog, getDemoEngagementEvents,
  type EngagementEvent, type EngagementEventType, type ClientAuthContext,
} from '@/app/services/dataService';
import { isBackendEnabled, isVerboseLogging, shouldShowApiErrors } from '@/config/runtime';

// ── Event config ──────────────────────────────────────────────────────────────

interface EventConfig {
  icon:  React.ComponentType<{ className?: string }>;
  color: string;         // hex for dot, icon, label
  bg:    string;         // rgba fill for dot bg
  label: string;
}

const EVENT_CONFIG: Record<EngagementEventType, EventConfig> = {
  portal_opened:     { icon: Eye,           color: '#8B5CF6', bg: 'rgba(139,92,246,0.18)',  label: 'Opened client portal'           },
  report_viewed:     { icon: FileText,      color: '#06D7F6', bg: 'rgba(6,215,246,0.15)',   label: 'Viewed readiness report'        },
  cta_clicked:       { icon: Zap,           color: '#FB923C', bg: 'rgba(251,146,60,0.18)',  label: 'Clicked "Schedule a Call"'     },
  pdf_printed:       { icon: Printer,       color: '#10B981', bg: 'rgba(16,185,129,0.15)',  label: 'Printed / saved report'         },
  proposal_viewed:   { icon: FileCheck2,    color: '#A78BFA', bg: 'rgba(167,139,250,0.18)', label: 'Opened your proposal'           },
  meeting_scheduled: { icon: Calendar,      color: '#34D399', bg: 'rgba(52,211,153,0.15)',  label: 'Scheduled a discovery call'    },
  message_sent:      { icon: MessageSquare, color: '#60A5FA', bg: 'rgba(96,165,250,0.15)',  label: 'Sent a message to the team'    },
};

const DEFAULT_CONFIG: EventConfig = {
  icon:  Activity,
  color: '#6B7280',
  bg:    'rgba(107,114,128,0.15)',
  label: 'Activity',
};

function getConfig(type: string): EventConfig {
  return EVENT_CONFIG[type as EngagementEventType] ?? DEFAULT_CONFIG;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 10)   return 'just now';
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  const h = Math.floor(s / 3600);
  if (h < 24)   return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** Collapse consecutive runs of the same event type into one item + count */
interface CollapsedEvent {
  event: EngagementEvent;
  count: number;
}

function collapseRuns(events: EngagementEvent[]): CollapsedEvent[] {
  if (!events.length) return [];
  const result: CollapsedEvent[] = [];
  let current: CollapsedEvent = { event: events[0], count: 1 };

  for (let i = 1; i < events.length; i++) {
    if (events[i].type === current.event.type) {
      current.count++;
    } else {
      result.push(current);
      current = { event: events[i], count: 1 };
    }
  }
  result.push(current);
  return result;
}

// ── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-2.5 animate-pulse">
      <div className="size-7 rounded-full bg-white/8 flex-shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 bg-white/8 rounded w-2/3" />
        <div className="h-2.5 bg-white/5 rounded w-1/3" />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const MAX_VISIBLE  = 6;
const POLL_MS      = 30_000;

interface Props {
  submissionId: string;
  /** Trigger a fresh fetch each time this increments (e.g. after tracking an event) */
  refreshTick?: number;
  clientAuth?: ClientAuthContext;
}

export function EngagementActivityFeed({ submissionId, refreshTick = 0, clientAuth }: Props) {
  const [events,     setEvents]     = useState<EngagementEvent[]>([]);
  const [isLoading,  setIsLoading]  = useState(true);
  const [isPolling,  setIsPolling]  = useState(false);
  const [showAll,    setShowAll]    = useState(false);
  const [liveFlash,  setLiveFlash]  = useState(false);
  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevCountRef = useRef(0);

  const load = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    else         setIsPolling(true);
    try {
      if (isBackendEnabled()) {
        const res = await getEngagementLog(submissionId, clientAuth);
        setEvents(res.events);
        // Flash "LIVE" if new events arrived during a silent poll
        if (silent && res.events.length > prevCountRef.current) {
          setLiveFlash(true);
          setTimeout(() => setLiveFlash(false), 2000);
        }
        prevCountRef.current = res.events.length;
      } else {
        // Demo mode: use rich engagement events from centralized demo data
        if (events.length === 0 && !silent) {
          const rawEvents = getDemoEngagementEvents(submissionId);
          const demoEvents: EngagementEvent[] = rawEvents.map(e => ({
            id: e.id,
            type: e.event as EngagementEventType,
            at: e.timestamp,
          }));
          setEvents(demoEvents);
          prevCountRef.current = demoEvents.length;
          if (isVerboseLogging()) {
            console.log('Demo mode: loaded rich engagement events');
          }
        }
      }
    } catch (err) {
      console.error('EngagementActivityFeed load error:', err);
    } finally {
      setIsLoading(false);
      setIsPolling(false);
    }
  }, [submissionId, clientAuth]);

  // Initial load
  useEffect(() => { load(); }, [load]);

  // Re-fetch when parent increments refreshTick (e.g. after a trackEngagement call)
  useEffect(() => {
    if (refreshTick > 0) load(true);
  }, [refreshTick, load]);

  // 30-second poll
  useEffect(() => {
    intervalRef.current = setInterval(() => load(true), POLL_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [load]);

  const collapsed = collapseRuns(events);
  const visible   = showAll ? collapsed : collapsed.slice(0, MAX_VISIBLE);
  const extra     = collapsed.length - MAX_VISIBLE;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'rgba(0,0,0,0.38)', border: '1px solid rgba(255,255,255,0.09)' }}
    >
      {/* ── Header ── */}
      <div
        className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="size-7 rounded-lg flex items-center justify-center"
            style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.25)' }}
          >
            <Activity className="size-3.5 text-[#8B5CF6]" />
          </div>
          <span className="font-bold text-white text-sm">Your Activity</span>

          {/* Live flash badge */}
          <AnimatePresence>
            {liveFlash && (
              <motion.span
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(52,211,153,0.15)', color: '#34D399', border: '1px solid rgba(52,211,153,0.3)' }}
              >
                <span className="size-1.5 rounded-full bg-[#34D399] animate-pulse inline-block" />
                NEW
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-center gap-3">
          {events.length > 0 && (
            <span className="text-[11px] text-gray-600">{events.length} event{events.length !== 1 ? 's' : ''}</span>
          )}
          {/* Subtle polling spinner */}
          {isPolling && (
            <RefreshCw className="size-3 text-gray-600 animate-spin" />
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="px-6 py-3">
        {isLoading ? (
          /* Skeleton */
          <div className="space-y-0.5">
            {[0, 1, 2].map(i => <SkeletonRow key={i} />)}
          </div>
        ) : events.length === 0 ? (
          /* Empty state */
          <div className="py-10 text-center">
            <div
              className="size-12 rounded-xl flex items-center justify-center mx-auto mb-3"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <Clock className="size-5 text-gray-600" />
            </div>
            <p className="text-sm font-medium text-gray-500 mb-1">No activity yet</p>
            <p className="text-xs text-gray-600 max-w-[220px] mx-auto leading-relaxed">
              Events appear here as you interact with your portal — viewing your report, scheduling a call, and more.
            </p>
          </div>
        ) : (
          /* Event list */
          <div className="relative">
            {/* Vertical timeline rail */}
            <div
              className="absolute left-[13px] top-4 bottom-4 w-px"
              style={{ background: 'linear-gradient(to bottom, rgba(139,92,246,0.3), rgba(59,130,246,0.15), transparent)' }}
            />

            <AnimatePresence initial>
              <div className="space-y-0.5">
                {visible.map(({ event, count }, idx) => {
                  const cfg  = getConfig(event.type);
                  const Icon = cfg.icon;
                  return (
                    <motion.div
                      key={event.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.04, duration: 0.18 }}
                      className="flex items-center gap-3 py-2.5 group relative"
                    >
                      {/* Coloured dot node */}
                      <div
                        className="size-7 rounded-full flex items-center justify-center flex-shrink-0 relative z-10 transition-transform group-hover:scale-110"
                        style={{ background: cfg.bg, border: `1px solid ${cfg.color}40` }}
                      >
                        <Icon className="size-3.5" style={{ color: cfg.color }} />
                      </div>

                      {/* Label + timestamp */}
                      <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm text-gray-200 truncate leading-tight">
                            {cfg.label}
                          </span>
                          {/* Count badge for consecutive duplicates */}
                          {count > 1 && (
                            <span
                              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                              style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}35` }}
                            >
                              ×{count}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1 text-[11px] text-gray-600 flex-shrink-0">
                          <Clock className="size-2.5" />
                          {timeAgo(event.at)}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </AnimatePresence>

            {/* Show all / collapse toggle */}
            {extra > 0 && (
              <button
                onClick={() => setShowAll(v => !v)}
                className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-all"
                style={{
                  background:  'rgba(255,255,255,0.03)',
                  border:      '1px solid rgba(255,255,255,0.07)',
                  color:       'rgba(255,255,255,0.4)',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)';
                  (e.currentTarget as HTMLElement).style.color      = 'rgba(255,255,255,0.7)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)';
                  (e.currentTarget as HTMLElement).style.color      = 'rgba(255,255,255,0.4)';
                }}
              >
                {showAll ? (
                  <span className="contents"><ChevronUp className="size-3.5" /> Show less</span>
                ) : (
                  <span className="contents"><ChevronDown className="size-3.5" /> +{extra} more event{extra !== 1 ? 's' : ''}</span>
                )}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Footer: polling note ── */}
      {!isLoading && events.length > 0 && (
        <div
          className="px-6 py-2.5 flex items-center gap-1.5 text-[10px] text-gray-700"
          style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
        >
          <span className="size-1.5 rounded-full bg-[#34D399]/40 inline-block animate-pulse" />
          Updates every 30 seconds
        </div>
      )}
    </div>
  );
}