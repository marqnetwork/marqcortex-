/**
 * CORTEX PIPELINE KANBAN — Phase 6B + 6C + 7B + 7C + 8A + 8B + 8C + 9A + 9B + 9C + 10A + 10B + 10C + 11A + 13E + 13F
 *
 * 6B: Drag-and-drop pipeline with outcome logging.
 * 6C: KV position persistence (survives refresh / tab switch).
 * 7B: Multi-select drag — group moves, bulk outcome modal, batch KV write.
 * 7C: Live board sync — 30 s background poll, remote-change detection,
 *     per-card pulse ring + Accept/Keep micro-buttons, banner notification,
 *     conflict chip (card saving locally + remote diff), LiveClock badge,
 *     tab-visibility resume, manual refresh trigger.
 *
 * Sync lifecycle (7C):
 *   Mount → load positions → start 30 s interval
 *   Interval fires → GET /cortex/pipeline-positions (skipped during saves)
 *   Diff remote vs positionsRef → collect RemoteChange[]
 *   If changes → add to remoteChanges Map + show banner
 *   Accept all → merge all remote positions, dismiss banner
 *   Accept one → merge single position, remove from map
 *   Keep local → remove from map without touching positions
 *   Tab becomes visible → immediate poll
 *
 * 11A: Loop trend indicators — per-card sparkline + direction badge showing
 *   whether the AI score is trending up, flat, or down. The 5-point history
 *   is seeded deterministically from (leadId × currentScore) so it's stable
 *   across renders and unique per card. Real score changes shift the anchor
 *   point so the sparkline visually reacts to data updates.
 *
 * 13E: Client engagement activity summaries — micro-row on each Kanban card
 *   showing the most recent client engagement event (report viewed, CTA clicked,
 *   proposal viewed, meeting scheduled, message sent, etc.). Fetches engagement
 *   summaries via GET /cortex/engagement-summary on mount + lead changes.
 *   High-intent events (meeting_scheduled, cta_clicked, proposal_viewed) get
 *   prominent styling; medium/low-intent events are muted. Helps ops team see
 *   which clients are actively engaging without opening individual cards.
 *
 * 13F: Quick actions dropdown menu — the ⋯ popover on each Kanban card is
 *   upgraded into a full contextual action panel with three new sections:
 *   (1) Engagement Signal — displays the latest client activity event and a
 *   one-click suggested next step driven by intent level (e.g. cta_clicked →
 *   "Send proposal now" moves the card to Proposal Sent; meeting_scheduled →
 *   "Prep call brief" opens the detail panel).
 *   (2) Priority flag — toggles high/medium priority, persists via
 *   PATCH /submissions/:id/status, and surfaces a P1 chip on the card footer.
 *   (3) Quick Note — inline textarea with note / action / flag type selector
 *   that saves to POST /submissions/:id/notes without navigating away.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { DndProvider, useDrag, useDrop, useDragLayer } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { motion, AnimatePresence } from 'motion/react';
import {
  Zap, Brain, Phone, FileText, TrendingUp, TrendingDown, XCircle,
  DollarSign, AlertTriangle, Loader2, Sparkles, Flame,
  GripVertical, ArrowRight, Target, CheckCircle2, RotateCcw, WifiOff, Cloud,
  MousePointerClick, Layers, X as XIcon, Check, Users, RefreshCw,
  ChevronDown, ChevronUp, Radio, BarChart2, Lightbulb, ScrollText, Download, Keyboard, Clock,
  Gauge, MoreVertical, Copy, ChevronLeft, ChevronRight,
  // 13E: engagement activity icons
  Eye, MessageSquare, Calendar,
  // 13F: quick-actions new icons
  Flag, PenLine,
} from 'lucide-react';
import type { Lead } from '@/app/types/cortex-types';
import { getReadinessColor } from '@/app/types/cortex-types';
import type { CortexStatusEntry, OutcomePayload, LearningLoopData } from '@/app/services/dataService';
import {
  logOutcome, updateSubmissionStatus,
  getPipelinePositions, savePipelinePosition, savePipelinePositions, resetPipelinePositions,
  getColumnCapacities, saveColumnCapacities,
  getLearningLoop,
  getEngagementSummary,
  addNote,
  type EngagementEvent,
} from '@/app/services/dataService';
import { useDashboard } from '@/app/contexts/DashboardContext';
import { isBackendEnabled, isVerboseLogging, shouldShowApiErrors } from '@/config/runtime';

// ── Constants ──────────────────────────────────────────────────────────────────
const DRAG_TYPE        = 'KANBAN_LEAD';
const POLL_INTERVAL_MS = 30_000;

// ── Drag item ──────────────────────────────────────────────────────────────────
interface DragItem {
  leadId: string;
  fromColumnId: string;
  selectedLeadIds: string[];
}

// ── Column definitions ─────────────────────────────────────────────────────────
export interface PipelineColumnDef {
  id: string;
  label: string;
  backendStatus: string;
  color: string;
  triggersOutcome: boolean;
  outcomeType?: 'win' | 'loss';
  Icon: React.ComponentType<{ className?: string }>;
}

export const PIPELINE_COLUMNS: PipelineColumnDef[] = [
  { id: 'new',            label: 'New Leads',      backendStatus: 'new',           color: '#3B82F6', triggersOutcome: false, Icon: Zap        },
  { id: 'needs-review',   label: 'Needs Review',   backendStatus: 'in-review',     color: '#8B5CF6', triggersOutcome: false, Icon: Brain      },
  { id: 'ready-for-call', label: 'Ready for Call', backendStatus: 'completed',     color: '#06D7F6', triggersOutcome: false, Icon: Phone      },
  { id: 'proposal-sent',  label: 'Proposal Sent',  backendStatus: 'proposal-sent', color: '#FB923C', triggersOutcome: false, Icon: FileText   },
  { id: 'converted',      label: 'Converted',      backendStatus: 'approved',      color: '#10B981', triggersOutcome: true,  outcomeType: 'win',  Icon: TrendingUp },
  { id: 'disqualified',   label: 'Lost',           backendStatus: 'rejected',      color: '#FD4438', triggersOutcome: true,  outcomeType: 'loss', Icon: XCircle    },
];

// ── 10B: Column capacity defaults (0 = unlimited) ─────────────────────────────
export const COLUMN_CAPACITY_DEFAULTS: Record<string, number> = {
  'new':            10,
  'needs-review':   8,
  'ready-for-call': 6,
  'proposal-sent':  6,
  'converted':      0,   // terminal — unlimited
  'disqualified':   0,   // terminal — unlimited
};

// ── Outcome form constants ─────────────────────────────────────────────────────
const LOST_REASONS = [
  'Budget constraints', 'Chose competitor', 'Not ready to invest',
  'Poor fit — wrong ICP', 'No follow-up from client', 'Timeline misalignment',
  'Internal priorities changed', 'Ghosted after proposal', 'Price too high', 'Other',
];
const IMPROVEMENT_TAGS = [
  'Discovery', 'Qualification', 'Pricing', 'Proposal quality',
  'Follow-up speed', 'Demo effectiveness', 'ROI messaging',
  'Competitive positioning', 'Expectation setting',
];

/**
 * Maps the keyword tokens stored by the Learning Loop server
 * back to the full display labels used in the LOST_REASONS grid.
 */
const REASON_MAP: Record<string, string> = {
  'budget':      'Budget constraints',
  'competitor':  'Chose competitor',
  'timing':      'Timeline misalignment',
  'wrong fit':   'Poor fit — wrong ICP',
  'no decision': 'No follow-up from client',
  'price':       'Price too high',
  'scope':       'Poor fit — wrong ICP',
  'size':        'Poor fit — wrong ICP',
  'other':       'Other',
};

// ── 9C: Card aging ────────────────────────────────────────────────────────────

/** Returns how stale a lead is based on lastActivityAt.
 *  0=fresh (<7d)  1=aging (7-13d)  2=stale (14-29d)  3=critical (30d+) */
function getAgeTier(lastActivityAt: string): 0 | 1 | 2 | 3 {
  const days = (Date.now() - new Date(lastActivityAt).getTime()) / 86_400_000;
  if (days >= 30) return 3;
  if (days >= 14) return 2;
  if (days >= 7)  return 1;
  return 0;
}

/** Compact human label: "today", "7d", "21d" … */
function formatAgeDays(lastActivityAt: string): string {
  const days = Math.floor((Date.now() - new Date(lastActivityAt).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  return `${days}d`;
}

// ── 11A: Loop trend sparkline helpers ─────────────────────────────────────────

/**
 * Generates 5 pseudo-random score points ending at `currentScore`.
 * Pattern (rising / flat / declining) is seeded from the lead ID so every
 * card gets a unique, stable sparkline that reacts when the real score changes.
 */
function getSeededSparkline(leadId: string, currentScore: number): number[] {
  let h = 0;
  for (let i = 0; i < leadId.length; i++) {
    h = ((h << 5) - h) + leadId.charCodeAt(i);
    h |= 0;
  }
  const pattern = ((h >>> 0) % 3); // 0 = rising  1 = flat  2 = declining
  const history = Array.from({ length: 4 }, (_, i) => {
    const dist  = 4 - i;
    const noise = (((h >>> (i * 5)) & 0x1F) % 9) - 4;   // −4 .. +4
    const base  = pattern === 0
      ? currentScore - dist * 2.5 + noise   // was lower, rising into current
      : pattern === 2
        ? currentScore + dist * 2.5 + noise // was higher, declining into current
        : currentScore + noise;              // flat with jitter
    return Math.max(5, Math.min(99, Math.round(base)));
  });
  return [...history, currentScore];
}

/** Returns the trend direction from a series of score snapshots. */
function getSparklineTrend(pts: number[]): 'up' | 'flat' | 'down' {
  if (pts.length < 2) return 'flat';
  const delta = pts[pts.length - 1] - pts[0];
  if (delta >  4) return 'up';
  if (delta < -4) return 'down';
  return 'flat';
}

/** Visual config per tier — index 0 is null (no indicator for fresh cards). */
const AGE_TIER_CONFIG: (null | {
  label:  string;
  color:  string;
  bg:     string;
  border: string;
  topGradient: string;
})[] = [
  null,
  { label: 'Aging',    color: '#D97706', bg: 'rgba(217,119,6,0.11)',  border: 'rgba(217,119,6,0.3)',  topGradient: 'linear-gradient(180deg, rgba(217,119,6,0.05) 0%, rgba(15,15,28,0.9) 40%)'  },
  { label: 'Stale',    color: '#EA580C', bg: 'rgba(234,88,12,0.12)',  border: 'rgba(234,88,12,0.33)', topGradient: 'linear-gradient(180deg, rgba(234,88,12,0.07) 0%, rgba(15,15,28,0.9) 40%)'  },
  { label: 'Critical', color: '#DC2626', bg: 'rgba(220,38,38,0.12)',  border: 'rgba(220,38,38,0.35)', topGradient: 'linear-gradient(180deg, rgba(220,38,38,0.09) 0%, rgba(15,15,28,0.9) 40%)'  },
];

// ── Domain types ───────────────────────────────────────────────────────────────
interface PendingDrop {
  leads: Lead[];
  toColumn: PipelineColumnDef;
}

type OutcomeMap = Record<string, {
  didConvert: boolean;
  conversionValue: number | null;
  loggedAt: string;
}>;

/** A position that differs between server and local state */
interface RemoteChange {
  leadId:     string;
  fromColumn: string;   // what we had locally
  toColumn:   string;   // what the server returned
  detectedAt: number;   // Date.now() when detected
}

interface PollBanner {
  count:       number;
  detectedAt:  number;
}

// ── 8C: Activity feed entry ────────────────────────────────────────────────────
interface ActivityEntry {
  id:          string;
  type:        'move' | 'bulk_move' | 'win' | 'loss' | 'bulk_win' | 'bulk_loss' | 'remote_sync' | 'reset';
  ts:          number;
  leadId?:     string;
  company?:    string;
  companies?:  string[];
  count?:      number;
  fromCol?:    string;
  toCol?:      string;
  value?:      number;
  lostReason?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function timeAgoShort(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5)  return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

// ── LiveClock — isolated 1 s ticker ───────────────────────────────────────────
function LiveClock({ ts, prefix = '' }: { ts: number; prefix?: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="contents">{prefix}{timeAgoShort(ts)}</span>;
}

// ── MultiDragLayer — custom ghost for group drags ──────────────────────────────
function MultiDragLayer({ selectedCount }: { selectedCount: number }) {
  const { isDragging, currentOffset, item } = useDragLayer(monitor => ({
    isDragging:    monitor.isDragging(),
    currentOffset: monitor.getClientOffset(),
    item:          monitor.getItem() as DragItem | null,
  }));
  const isMulti = (item?.selectedLeadIds?.length ?? 1) > 1;
  if (!isDragging || !currentOffset || !isMulti) return null;
  const count = item?.selectedLeadIds?.length ?? selectedCount;
  return (
    <div style={{ position: 'fixed', pointerEvents: 'none', top: 0, left: 0, width: '100%', height: '100%', zIndex: 9999 }}>
      <div style={{
        position: 'absolute', left: currentOffset.x + 14, top: currentOffset.y + 14,
        background: 'linear-gradient(135deg, rgba(139,92,246,0.92), rgba(59,130,246,0.88))',
        border: '1.5px solid rgba(139,92,246,0.9)', borderRadius: '10px',
        padding: '7px 14px', color: 'white', fontSize: '12px', fontWeight: 700,
        backdropFilter: 'blur(12px)',
        boxShadow: '0 12px 40px rgba(139,92,246,0.45), 0 0 0 1px rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center', gap: '8px', letterSpacing: '0.01em',
      }}>
        <Layers style={{ width: 14, height: 14, opacity: 0.85 }} />
        <span style={{ background: 'rgba(255,255,255,0.22)', borderRadius: '6px', padding: '1px 7px', fontSize: '13px' }}>
          {count}
        </span>
        cards moving
      </div>
    </div>
  );
}

// ── RemoteChangeBanner ────────────���────────────────────────────────────────────
function RemoteChangeBanner({
  banner,
  remoteChanges,
  leads,
  onAcceptAll,
  onDismiss,
}: {
  banner:        PollBanner;
  remoteChanges: Map<string, RemoteChange>;
  leads:         Lead[];
  onAcceptAll:   () => void;
  onDismiss:     () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const count = remoteChanges.size;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10, height: 0 }}
      animate={{ opacity: 1, y: 0,   height: 'auto' }}
      exit={{   opacity: 0, y: -10,  height: 0 }}
      className="mb-4 rounded-xl overflow-hidden"
      style={{ background: 'rgba(6,215,246,0.06)', border: '1px solid rgba(6,215,246,0.22)' }}
    >
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-2.5">
        {/* Live pulse dot */}
        <span className="relative flex size-2 flex-shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: '#06D7F6' }} />
          <span className="relative inline-flex rounded-full size-2" style={{ background: '#06D7F6' }} />
        </span>

        <span className="text-xs font-semibold flex-1" style={{ color: '#06D7F6' }}>
          {count} card{count !== 1 ? 's' : ''} moved by a team member
        </span>
        <span className="text-[11px] text-gray-600">
          · <LiveClock ts={banner.detectedAt} />
        </span>

        <div className="flex items-center gap-2 ml-2">
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-200 transition-colors"
          >
            Review {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </button>
          <button
            onClick={onAcceptAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all"
            style={{ background: 'rgba(6,215,246,0.18)', border: '1px solid rgba(6,215,246,0.38)', color: '#06D7F6' }}
          >
            <CheckCircle2 className="size-3" />
            Accept all
          </button>
          <button
            onClick={onDismiss}
            className="p-1.5 rounded-lg text-gray-600 hover:text-gray-300 transition-colors"
          >
            <XIcon className="size-3" />
          </button>
        </div>
      </div>

      {/* Expanded detail list */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{   opacity: 0 }}
            className="px-4 pb-3 space-y-1.5 border-t"
            style={{ borderColor: 'rgba(6,215,246,0.12)' }}
          >
            <div className="pt-2.5 space-y-1.5">
              {Array.from(remoteChanges.values()).map(change => {
                const lead    = leads.find(l => l.id === change.leadId);
                const fromCol = PIPELINE_COLUMNS.find(c => c.id === change.fromColumn);
                const toCol   = PIPELINE_COLUMNS.find(c => c.id === change.toColumn);
                if (!lead || !fromCol || !toCol) return null;
                return (
                  <div key={change.leadId} className="flex items-center gap-3 text-xs">
                    <span className="text-white font-medium w-28 truncate flex-shrink-0">{lead.companyName}</span>
                    <span className="text-gray-600 truncate">{fromCol.label}</span>
                    <ArrowRight className="size-3 flex-shrink-0" style={{ color: '#06D7F6' }} />
                    <span className="font-semibold flex-shrink-0" style={{ color: toCol.color }}>{toCol.label}</span>
                    <span className="ml-auto text-[10px] text-gray-600">
                      <LiveClock ts={change.detectedAt} />
                    </span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── 10C: Card quick-actions popover ───────────────────────────────────────────

/** Reusable action row inside CardQuickPopover */
function QpRow({
  icon, label, color, disabled = false, onClick,
}: {
  icon:      React.ReactNode;
  label:     string;
  color:     string;
  disabled?: boolean;
  onClick:   () => void;
}) {
  const hoverBg = `${color}18`;
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className="flex items-center gap-2 w-full rounded-lg transition-all text-left"
      style={{
        padding:    '6px 10px',
        background: 'transparent',
        border:     'none',
        cursor:     disabled ? 'not-allowed' : 'pointer',
        color:      disabled ? '#374151' : color,
        fontSize:   11,
        fontWeight: disabled ? 400 : 600,
        opacity:    disabled ? 0.45 : 1,
      }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = hoverBg; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
    >
      <span className="flex-shrink-0" style={{ color: disabled ? '#374151' : color }}>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

/**
 * 13F: Enhanced position:fixed popover anchored to a viewport {x,y} point.
 * Sections: Engagement Signal → Move → Actions (+ Priority) → Quick Note → Copy
 */
function CardQuickPopover({
  lead, columnId, position, onClose,
  onOpenDetail, onToggleSelect, isSelected,
  onQuickMove, copyDone, onCopy,
  latestEngagement, isPriority, onTogglePriority, onQuickNote,
}: {
  lead:              Lead;
  columnId:          string;
  position:          { x: number; y: number };
  onClose:           () => void;
  onOpenDetail:      () => void;
  onToggleSelect:    () => void;
  isSelected:        boolean;
  onQuickMove:       (toColId: string) => void;
  copyDone:          boolean;
  onCopy:            () => void;
  latestEngagement?: EngagementEvent | null;
  isPriority:        boolean;
  onTogglePriority:  () => void;
  onQuickNote:       (content: string, type: 'note' | 'action' | 'flag') => Promise<void>;
}) {
  const [noteExpanded, setNoteExpanded] = useState(false);
  const [noteText,     setNoteText]     = useState('');
  const [noteType,     setNoteType]     = useState<'note' | 'action' | 'flag'>('note');
  const [noteSaving,   setNoteSaving]   = useState(false);
  const [noteSaved,    setNoteSaved]    = useState(false);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest('[data-card-qp]')) onClose();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 60);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', handler); };
  }, [onClose]);

  const colIdx  = PIPELINE_COLUMNS.findIndex(c => c.id === columnId);
  const prevCol = colIdx > 0 ? PIPELINE_COLUMNS[colIdx - 1] : null;
  const nextCol = colIdx < PIPELINE_COLUMNS.length - 1 ? PIPELINE_COLUMNS[colIdx + 1] : null;

  const POP_W = 222;
  const left  = Math.min(position.x, window.innerWidth  - POP_W - 12);
  const top   = Math.min(position.y + 6, window.innerHeight - 380);

  const divider = <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '3px 10px' }} />;

  const engCfg   = latestEngagement ? ENGAGEMENT_EVENT_CONFIG[latestEngagement.type] : null;
  const nextStep = latestEngagement ? ENGAGEMENT_NEXT_STEPS[latestEngagement.type]   : null;

  const handleSaveNote = async () => {
    if (!noteText.trim() || noteSaving) return;
    setNoteSaving(true);
    try {
      await onQuickNote(noteText.trim(), noteType);
      setNoteSaved(true);
      setNoteText('');
      setNoteExpanded(false);
      setTimeout(() => setNoteSaved(false), 2200);
    } catch {
      // parent logs
    } finally {
      setNoteSaving(false);
    }
  };

  return (
    <motion.div
      data-card-qp="1"
      initial={{ opacity: 0, scale: 0.92, y: -6 }}
      animate={{ opacity: 1, scale: 1,    y: 0  }}
      exit={{   opacity: 0, scale: 0.92,  y: -6 }}
      transition={{ type: 'spring', stiffness: 480, damping: 32 }}
      style={{
        position:       'fixed',
        left,
        top,
        width:          POP_W,
        zIndex:         9999,
        background:     'linear-gradient(180deg, #111128 0%, #0A0A18 100%)',
        border:         '1px solid rgba(255,255,255,0.1)',
        borderRadius:   12,
        boxShadow:      '0 20px 56px rgba(0,0,0,0.7), 0 0 0 1px rgba(139,92,246,0.1)',
        backdropFilter: 'blur(18px)',
        overflow:       'hidden',
      }}
    >
      {/* ── Header ── */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '9px 12px 7px' }}>
        <p className="text-[11px] font-bold text-white leading-tight truncate">{lead.companyName}</p>
        <p className="text-[9px] font-semibold mt-0.5 uppercase tracking-widest" style={{ color: '#4B5563' }}>
          Quick Actions
        </p>
      </div>

      {/* ── 13F: Engagement Signal + contextual next step ── */}
      {engCfg && nextStep && latestEngagement && (
        <div style={{ background: `${engCfg.color}0d`, borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '8px 12px' }}>
          <p style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#4B5563', marginBottom: 5 }}>
            Engagement Signal
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
            <engCfg.Icon style={{ width: 9, height: 9, color: engCfg.color, flexShrink: 0 }} />
            <span style={{ fontSize: 10, fontWeight: 600, color: engCfg.color, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {engCfg.label}
            </span>
            <span style={{ fontSize: 9, color: '#374151', flexShrink: 0 }}>{isoTimeAgo(latestEngagement.at)}</span>
          </div>
          <button
            onClick={() => {
              if (nextStep.action === 'move_proposal' && columnId !== 'proposal-sent') {
                onQuickMove('proposal-sent');
              } else {
                onOpenDetail();
              }
              onClose();
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, width: '100%',
              background: `${nextStep.color}15`, border: `1px solid ${nextStep.color}30`,
              borderRadius: 8, padding: '5px 9px', color: nextStep.color,
              fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s', textAlign: 'left',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = `${nextStep.color}28`; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = `${nextStep.color}15`; }}
          >
            <nextStep.Icon style={{ width: 10, height: 10, flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{nextStep.label}</span>
            <ArrowRight style={{ width: 9, height: 9, opacity: 0.55, flexShrink: 0 }} />
          </button>
        </div>
      )}

      {/* ── Move section ── */}
      <div className="p-1 pt-1.5">
        <p className="text-[9px] font-bold uppercase tracking-widest px-2.5 pb-0.5" style={{ color: '#374151' }}>Move</p>
        <QpRow
          icon={<ChevronLeft className="size-3" />}
          label={prevCol ? prevCol.label : 'First stage'}
          color={prevCol ? (prevCol.color ?? '#8B5CF6') : '#374151'}
          disabled={!prevCol}
          onClick={() => prevCol && onQuickMove(prevCol.id)}
        />
        <QpRow
          icon={<ChevronRight className="size-3" />}
          label={nextCol ? nextCol.label : 'Last stage'}
          color={nextCol ? (nextCol.color ?? '#3B82F6') : '#374151'}
          disabled={!nextCol}
          onClick={() => nextCol && onQuickMove(nextCol.id)}
        />
      </div>

      {divider}

      {/* ── Actions (13F: Priority flag added) ── */}
      <div className="p-1">
        <QpRow icon={<ArrowRight className="size-3" />} label="Open Detail" color="#06D7F6" onClick={onOpenDetail} />
        <QpRow
          icon={isSelected ? <Check className="size-3" strokeWidth={3} /> : <MousePointerClick className="size-3" />}
          label={isSelected ? 'Deselect card' : 'Select card'}
          color="#8B5CF6"
          onClick={onToggleSelect}
        />
        <QpRow
          icon={<Flag className="size-3" />}
          label={isPriority ? 'Remove priority' : 'Mark as priority'}
          color={isPriority ? '#FB923C' : '#6B7280'}
          onClick={onTogglePriority}
        />
      </div>

      {divider}

      {/* ── 13F: Quick Note inline form ── */}
      <div className="p-1" data-card-qp="1">
        {noteExpanded ? (
          <div style={{ padding: '5px 8px 8px' }}>
            <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
              {(['note', 'action', 'flag'] as const).map(t => (
                <button
                  key={t}
                  onClick={e => { e.stopPropagation(); setNoteType(t); }}
                  style={{
                    flex: 1, padding: '2px 0', borderRadius: 5, fontSize: 9, fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                    border: `1px solid ${noteType === t ? NOTE_TYPE_COLORS[t] : 'rgba(255,255,255,0.08)'}`,
                    background: noteType === t ? `${NOTE_TYPE_COLORS[t]}20` : 'transparent',
                    color: noteType === t ? NOTE_TYPE_COLORS[t] : '#374151',
                    cursor: 'pointer', transition: 'all 0.12s',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
            <textarea
              autoFocus
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              onKeyDown={e => {
                e.stopPropagation();
                if (e.key === 'Escape') { setNoteExpanded(false); setNoteText(''); }
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSaveNote();
              }}
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
              placeholder={noteType === 'note' ? 'Type a note…' : noteType === 'action' ? 'Action item…' : 'Flag reason…'}
              rows={3}
              style={{
                width: '100%', background: 'rgba(255,255,255,0.05)',
                border: `1px solid ${NOTE_TYPE_COLORS[noteType]}30`, borderRadius: 8,
                padding: '5px 7px', color: 'white', fontSize: 11, lineHeight: 1.5,
                resize: 'none', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
              <button
                onClick={e => { e.stopPropagation(); setNoteExpanded(false); setNoteText(''); }}
                style={{ fontSize: 10, color: '#4B5563', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
              >
                Cancel
              </button>
              <button
                disabled={!noteText.trim() || noteSaving}
                onClick={e => { e.stopPropagation(); handleSaveNote(); }}
                style={{
                  flex: 1, fontSize: 11, fontWeight: 700,
                  color: noteSaving ? '#374151' : NOTE_TYPE_COLORS[noteType],
                  background: noteSaving ? 'transparent' : `${NOTE_TYPE_COLORS[noteType]}18`,
                  border: `1px solid ${noteSaving ? 'rgba(255,255,255,0.06)' : `${NOTE_TYPE_COLORS[noteType]}35`}`,
                  borderRadius: 7, padding: '3px 8px',
                  cursor: noteSaving || !noteText.trim() ? 'not-allowed' : 'pointer',
                  transition: 'all 0.12s', opacity: !noteText.trim() ? 0.4 : 1,
                }}
              >
                {noteSaving ? 'Saving…' : '⌘↵ Save'}
              </button>
            </div>
          </div>
        ) : (
          <QpRow
            icon={noteSaved ? <CheckCircle2 className="size-3" /> : <PenLine className="size-3" />}
            label={noteSaved ? '✓ Note saved' : 'Add quick note'}
            color={noteSaved ? '#10B981' : '#6B7280'}
            onClick={() => { if (!noteSaved) setNoteExpanded(true); }}
          />
        )}
      </div>

      {divider}

      {/* ── Copy section ── */}
      <div className="p-1 pb-1.5">
        <QpRow
          icon={copyDone ? <CheckCircle2 className="size-3" /> : <Copy className="size-3" />}
          label={copyDone ? '✓ Copied!' : 'Copy company name'}
          color={copyDone ? '#10B981' : '#6B7280'}
          onClick={onCopy}
        />
      </div>
    </motion.div>
  );
}

// ── 11A: ScoreTrendSparkline ──────────────────────────────────────────────────

/**
 * Tiny SVG sparkline + micro direction icon rendered next to the AI score chip.
 * All data is derived purely from leadId + currentScore — no extra API calls.
 */
function ScoreTrendSparkline({
  leadId, currentScore, history,
}: {
  leadId:       string;
  currentScore: number;
  /** 11B: real recorded AI-score snapshots. When ≥2 exist, these replace the
   *  seeded estimate and the sparkline renders as "live" (solid line + dot). */
  history?:     number[];
}) {
  // 11B: use real snapshots when available, fall back to seeded estimate
  const isLive = (history?.length ?? 0) >= 2;
  const points = isLive
    ? history!.slice(-5)                         // most recent 5 real readings
    : getSeededSparkline(leadId, currentScore);  // deterministic seed fallback
  const trend  = getSparklineTrend(points);
  const color  = trend === 'up' ? '#10B981' : trend === 'down' ? '#FD4438' : '#6B7280';

  const W = 30, H = 10;
  const minV  = Math.min(...points) - 2;
  const maxV  = Math.max(...points) + 2;
  const range = maxV - minV || 1;

  const coords = points.map((v, i) => {
    const x = ((i / (points.length - 1)) * W).toFixed(1);
    const y = (H - ((v - minV) / range) * (H - 2) - 1).toFixed(1);
    return `${x},${y}`;
  });
  const [lxStr, lyStr] = coords[coords.length - 1].split(',');
  const lx = parseFloat(lxStr), ly = parseFloat(lyStr);

  const delta = points[points.length - 1] - points[0];
  const tipLabel = isLive
    ? `Live trend · ${trend} (${delta > 0 ? '+' : ''}${delta} pts · ${history!.length} snapshot${history!.length !== 1 ? 's' : ''})`
    : trend === 'up'
      ? `Est. trend · up (+${Math.abs(delta)} pts) · awaiting live data`
      : trend === 'down'
        ? `Est. trend · down (−${Math.abs(delta)} pts) · awaiting live data`
        : 'Est. trend · stable · awaiting live data';

  return (
    <div
      className="flex items-center gap-0.5 flex-shrink-0"
      title={tipLabel}
    >
      <svg
        width={W} height={H}
        viewBox={`0 0 ${W} ${H}`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {/* Glow underlay */}
        <polyline
          points={coords.join(' ')}
          fill="none"
          stroke={color}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.1"
        />
        {/* Main line — solid for live data, dashed for estimated */}
        <polyline
          points={coords.join(' ')}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={isLive ? 0.82 : 0.45}
          strokeDasharray={isLive ? undefined : '2.5 2'}
        />
        {/* Terminal dot */}
        <circle cx={lx} cy={ly} r="2" fill={color} opacity={isLive ? 0.95 : 0.6} />
      </svg>

      {/* Direction icon */}
      {trend === 'up'   && <TrendingUp   style={{ width: 8, height: 8, color, opacity: isLive ? 0.9 : 0.55, flexShrink: 0 }} />}
      {trend === 'down' && <TrendingDown style={{ width: 8, height: 8, color, opacity: isLive ? 0.9 : 0.55, flexShrink: 0 }} />}
      {trend === 'flat' && (
        <span style={{ fontSize: 9, color, opacity: isLive ? 0.75 : 0.45, fontWeight: 700, lineHeight: 1, flexShrink: 0 }}>
          ─
        </span>
      )}

      {/* 11B: live status dot — only shown once real snapshot data exists */}
      {isLive && (
        <span
          style={{
            display: 'inline-block', width: 4, height: 4,
            borderRadius: '50%', background: color,
            opacity: 0.65, flexShrink: 0, marginLeft: 1,
          }}
        />
      )}
    </div>
  );
}

// ── 13E: Engagement event display config ──────────────────────────────────────

type EngagementIntent = 'high' | 'medium' | 'low';

interface EngagementCfg {
  Icon:   React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color:  string;
  label:  string;
  intent: EngagementIntent;
}

const ENGAGEMENT_EVENT_CONFIG: Record<string, EngagementCfg> = {
  portal_opened:     { Icon: Eye,           color: '#A78BFA', label: 'Opened portal',    intent: 'low'    },
  report_viewed:     { Icon: FileText,      color: '#06D7F6', label: 'Viewed report',    intent: 'medium' },
  cta_clicked:       { Icon: Zap,           color: '#FB923C', label: 'Clicked schedule', intent: 'high'   },
  pdf_printed:       { Icon: ScrollText,    color: '#10B981', label: 'Saved PDF',        intent: 'medium' },
  proposal_viewed:   { Icon: FileText,      color: '#A78BFA', label: 'Viewed proposal',  intent: 'high'   },
  meeting_scheduled: { Icon: Calendar,      color: '#34D399', label: 'Meeting booked',   intent: 'high'   },
  message_sent:      { Icon: MessageSquare, color: '#60A5FA', label: 'Sent message',     intent: 'low'    },
};

// ── 13F: Engagement-driven suggested next steps ───────────────────────────────

interface EngagementNextStep {
  Icon:   React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label:  string;
  color:  string;
  /** 'open_detail' opens detail panel; 'move_proposal' quick-moves to Proposal Sent */
  action: 'open_detail' | 'move_proposal';
}

const ENGAGEMENT_NEXT_STEPS: Partial<Record<string, EngagementNextStep>> = {
  meeting_scheduled: { Icon: FileText,      label: 'Prep call brief',       color: '#34D399', action: 'open_detail'   },
  cta_clicked:       { Icon: FileText,      label: 'Send proposal now',     color: '#FB923C', action: 'move_proposal' },
  proposal_viewed:   { Icon: MessageSquare, label: 'Follow up on proposal', color: '#A78BFA', action: 'open_detail'   },
  report_viewed:     { Icon: Phone,         label: 'Schedule a call',       color: '#06D7F6', action: 'open_detail'   },
  message_sent:      { Icon: MessageSquare, label: 'Reply to message',      color: '#60A5FA', action: 'open_detail'   },
  portal_opened:     { Icon: Eye,           label: 'Send portal update',    color: '#A78BFA', action: 'open_detail'   },
};

/** Note type → accent colour used in the Quick Note form */
const NOTE_TYPE_COLORS: Record<string, string> = {
  note:   '#8B5CF6',
  action: '#FB923C',
  flag:   '#FD4438',
};

function isoTimeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 10)   return 'now';
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  const h = Math.floor(s / 3600);
  if (h < 24)   return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Compact micro-row showing the most recent client engagement event on a card. */
function ClientActivityRow({ event }: { event: EngagementEvent }) {
  const cfg = ENGAGEMENT_EVENT_CONFIG[event.type];
  if (!cfg) return null;
  const { Icon, color, label, intent } = cfg;
  const isHigh   = intent === 'high';
  const isMedium = intent === 'medium';

  return (
    <div
      className="flex items-center gap-1.5 mt-2 mb-0.5 px-1.5 py-1 rounded-lg"
      style={{
        background: isHigh   ? `${color}12` : 'transparent',
        border:     isHigh   ? `1px solid ${color}28` : 'none',
      }}
      title={`Last client activity: ${label}`}
    >
      <Icon
        className="size-2.5 flex-shrink-0"
        style={{ color: isHigh || isMedium ? color : '#6B7280' }}
      />
      <span
        className="text-[10px] flex-1 truncate font-medium leading-none"
        style={{ color: isHigh ? color : isMedium ? 'rgba(255,255,255,0.45)' : '#6B7280' }}
      >
        {label}
      </span>
      <span className="text-[10px] text-gray-600 flex-shrink-0 tabular-nums leading-none">
        {isoTimeAgo(event.at)}
      </span>
    </div>
  );
}

// ── KanbanCard ─────────────────────────────────────────────────────────────────
function KanbanCard({
  lead, aiStatus, outcome, onCardClick, isSaving,
  isSelectMode, isSelected, onToggleSelect, columnId, selectedIds,
  remoteChange, isConflict, onAcceptRemote, onDismissRemote, isFocused,
  staleFilterActive, onQuickMove, scoreHistory, latestEngagement,
  isPriority, onTogglePriority, onAddNote,
}: {
  lead:           Lead;
  aiStatus:       CortexStatusEntry | null;
  outcome:        OutcomeMap[string] | null;
  onCardClick:    (id: string) => void;
  isSaving:       boolean;
  isSelectMode:   boolean;
  isSelected:     boolean;
  onToggleSelect: (id: string) => void;
  columnId:       string;
  selectedIds:    Set<string>;
  remoteChange:   RemoteChange | null;
  isConflict:     boolean;
  onAcceptRemote: (leadId: string, toColumnId: string) => void;
  onDismissRemote:(leadId: string) => void;
  /** 9B: true when keyboard focus is on this card */
  isFocused:      boolean;
  /** 9C: when true, fresh (tier-0) cards are dimmed to highlight stale ones */
  staleFilterActive: boolean;
  /** 10C: move this card directly to another column (triggers drop flow) */
  onQuickMove:    (leadId: string, toColId: string) => void;
  /** 11B: recorded AI-score snapshots for this lead (oldest → newest) */
  scoreHistory?:  number[];
  /** 13E: most recent client engagement event from the portal activity log */
  latestEngagement?: EngagementEvent | null;
  /** 13F: whether this lead is flagged as high priority */
  isPriority:        boolean;
  /** 13F: toggle priority flag — updates API + local state */
  onTogglePriority:  (leadId: string) => void;
  /** 13F: save a quick note inline without leaving the board */
  onAddNote:         (leadId: string, content: string, type: 'note' | 'action' | 'flag') => Promise<void>;
}) {
  const [{ isDragging }, dragRef] = useDrag<DragItem, void, { isDragging: boolean }>({
    type: DRAG_TYPE,
    item: () => ({
      leadId:           lead.id,
      fromColumnId:     columnId,
      selectedLeadIds:  isSelectMode && selectedIds.has(lead.id)
        ? Array.from(selectedIds)
        : [lead.id],
    }),
    collect: monitor => ({ isDragging: monitor.isDragging() }),
  });

  const readinessColor  = getReadinessColor(lead.readinessScore);
  const isGroupDragging = isDragging && isSelectMode && isSelected;
  const toCol           = remoteChange ? PIPELINE_COLUMNS.find(c => c.id === remoteChange.toColumn) : null;

  // 10C: quick-actions popover state
  const [qpOpen,    setQpOpen]    = useState(false);
  const [qpPos,     setQpPos]     = useState({ x: 0, y: 0 });
  const [copyDone,  setCopyDone]  = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const openQp = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setQpPos({ x: rect.right, y: rect.bottom });
    setQpOpen(true);
  };
  const closeQp = () => setQpOpen(false);

  const handleQpCopy = () => {
    navigator.clipboard.writeText(lead.companyName).catch(() => {});
    setCopyDone(true);
    setTimeout(() => setCopyDone(false), 1500);
  };

  // 9C: Aging — suppressed for terminal columns (converted / disqualified)
  const isTerminal   = columnId === 'converted' || columnId === 'disqualified';
  const ageTier      = isTerminal ? 0 : getAgeTier(lead.lastActivityAt);
  const ageDaysLabel = formatAgeDays(lead.lastActivityAt);
  const ageConfig    = AGE_TIER_CONFIG[ageTier] ?? null;

  // 12C: Score thresholds — suppressed for terminal columns
  const scoreIsCritical = !isTerminal && aiStatus !== null && aiStatus.aiScore <= 38;
  const scoreIsHot      = !isTerminal && aiStatus !== null && aiStatus.aiScore >= 85;

  const handleCardClick = (e: React.MouseEvent) => {
    if (isSelectMode) { e.stopPropagation(); onToggleSelect(lead.id); }
  };

  // Border & shadow — priority order: conflict > remote > score-critical > focused > selected > saving > score-hot
  let borderStyle = '1px solid rgba(255,255,255,0.07)';
  let boxShadow   = '0 1px 3px rgba(0,0,0,0.4)';
  let animation   = '';
  if (isConflict) {
    borderStyle = '1.5px solid rgba(251,146,60,0.6)';
    boxShadow   = '0 0 0 3px rgba(251,146,60,0.12), 0 1px 3px rgba(0,0,0,0.4)';
  } else if (remoteChange) {
    borderStyle = '1.5px solid rgba(6,215,246,0.45)';
    animation   = 'card-remote-pulse 1.8s ease-in-out infinite';
  } else if (scoreIsCritical) {
    // 12C: critical AI score — red pulsing ring to demand attention
    borderStyle = '1.5px solid rgba(253,68,56,0.55)';
    animation   = 'card-score-critical-pulse 2.2s ease-in-out infinite';
  } else if (isFocused) {
    // 9B: keyboard focus ring — cyan, highest priority after conflict/remote/critical
    borderStyle = '2px solid rgba(6,215,246,0.7)';
    boxShadow   = '0 0 0 3px rgba(6,215,246,0.12), 0 1px 3px rgba(0,0,0,0.4)';
  } else if (isSelected) {
    borderStyle = '1.5px solid rgba(139,92,246,0.55)';
    boxShadow   = '0 0 0 3px rgba(139,92,246,0.18), 0 1px 3px rgba(0,0,0,0.4)';
  } else if (isSaving) {
    borderStyle = '1px solid rgba(139,92,246,0.5)';
  } else if (scoreIsHot) {
    // 12C: elevated AI score — subtle green breathe (informational, lowest priority)
    borderStyle = '1.5px solid rgba(16,185,129,0.4)';
    animation   = 'card-score-hot-pulse 3s ease-in-out infinite';
  }

  return (
    <div
      ref={dragRef as unknown as React.RefObject<HTMLDivElement>}
      onClick={handleCardClick}
      data-kb-card-focused={isFocused ? 'true' : undefined}
      className="group relative rounded-xl p-4 transition-all duration-200 select-none cortex-card"
      style={{
        opacity: isGroupDragging ? 0.3 : isDragging ? 0.35
          : (staleFilterActive && ageTier === 0) ? 0.2
          : 1,
        transform:  isDragging ? 'scale(0.96)' : 'scale(1)',
        // 9C: tier 2+ cards get a subtle warm top gradient; selection overrides
        background: isSelected
          ? 'rgba(139,92,246,0.1)'
          : ageConfig && ageTier >= 2
            ? ageConfig.topGradient
            : 'rgba(15,15,28,0.9)',
        border:     borderStyle,
        cursor:     isSelectMode ? 'pointer' : isDragging ? 'grabbing' : 'grab',
        boxShadow,
        animation,
      }}
    >
      {/* Top-right area: spinner / conflict chip / ⋯ quick-actions trigger */}
      {isSaving && !isConflict ? (
        <div className="absolute top-2 right-2">
          <Loader2 className="size-3 animate-spin text-[#8B5CF6]" />
        </div>
      ) : isConflict ? (
        <div className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold"
          style={{ background: 'rgba(251,146,60,0.2)', border: '1px solid rgba(251,146,60,0.4)', color: '#FB923C' }}>
          <AlertTriangle className="size-2.5" />
          Conflict
        </div>
      ) : !isSelectMode ? (
        /* 10C: quick-actions trigger — visible on hover */
        <button
          ref={triggerRef}
          onClick={openQp}
          title="Quick actions"
          className="absolute top-1.5 right-1.5 flex items-center justify-center size-6 rounded-lg transition-all"
          style={{
            background:  qpOpen ? 'rgba(139,92,246,0.25)' : 'transparent',
            border:      qpOpen ? '1px solid rgba(139,92,246,0.45)' : '1px solid transparent',
            color:       qpOpen ? '#C4B5FD' : 'transparent',
            // Only show on group-hover; CSS hack via opacity on group hover
          }}
          // Show via class on the parent's group-hover
          data-qp-trigger="1"
        >
          <MoreVertical className="size-3" />
        </button>
      ) : null}

      {/* Checkbox (select mode) */}
      <AnimatePresence>
        {isSelectMode && (
          <motion.button
            initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.15 }}
            onClick={e => { e.stopPropagation(); onToggleSelect(lead.id); }}
            className="absolute top-3 left-3 z-10 flex items-center justify-center size-5 rounded-md transition-all"
            style={{
              background: isSelected ? 'rgba(139,92,246,1)' : 'rgba(255,255,255,0.08)',
              border:     isSelected ? '1.5px solid rgba(139,92,246,1)' : '1.5px solid rgba(255,255,255,0.2)',
            }}
          >
            {isSelected && <Check className="size-3 text-white" strokeWidth={3} />}
          </motion.button>
        )}
      </AnimatePresence>

      {/* 10C: popover rendered via position:fixed so it escapes scroll clipping */}
      <AnimatePresence>
        {qpOpen && (
          <CardQuickPopover
            lead={lead}
            columnId={columnId}
            position={qpPos}
            onClose={closeQp}
            onOpenDetail={() => { closeQp(); onCardClick(lead.id); }}
            onToggleSelect={() => { closeQp(); onToggleSelect(lead.id); }}
            isSelected={isSelected}
            onQuickMove={(toColId) => { closeQp(); onQuickMove(lead.id, toColId); }}
            copyDone={copyDone}
            onCopy={handleQpCopy}
            latestEngagement={latestEngagement}
            isPriority={isPriority}
            onTogglePriority={() => onTogglePriority(lead.id)}
            onQuickNote={(content, type) => onAddNote(lead.id, content, type)}
          />
        )}
      </AnimatePresence>

      {/* ── Remote change indicator strip ─────────────────────────────────── */}
      <AnimatePresence>
        {remoteChange && toCol && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: 8 }}
            exit={{   opacity: 0, height: 0, marginBottom: 0 }}
            className="rounded-lg overflow-hidden"
            style={{ background: 'rgba(6,215,246,0.08)', border: '1px solid rgba(6,215,246,0.2)' }}
          >
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
              <div className="flex items-center gap-1.5 text-[10px] min-w-0" style={{ color: '#06D7F6' }}>
                <Users className="size-2.5 flex-shrink-0" />
                <span className="truncate font-medium">
                  Team → <span style={{ color: toCol.color }}>{toCol.label}</span>
                </span>
                <span className="text-gray-600 flex-shrink-0">
                  · <LiveClock ts={remoteChange.detectedAt} />
                </span>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={e => { e.stopPropagation(); onAcceptRemote(lead.id, remoteChange.toColumn); }}
                  title="Accept team's position"
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded transition-colors"
                  style={{ background: 'rgba(6,215,246,0.2)', color: '#06D7F6' }}
                >
                  ✓
                </button>
                <button
                  onClick={e => { e.stopPropagation(); onDismissRemote(lead.id); }}
                  title="Keep my position"
                  className="text-[10px] text-gray-600 hover:text-gray-300 px-1 py-0.5 rounded transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-2"
        style={{ paddingLeft: isSelectMode ? '22px' : '0' }}>
        <h4 className="text-sm font-bold text-white leading-tight pr-4">{lead.companyName}</h4>
        <span
          className="px-1.5 py-0.5 rounded-md text-[10px] font-bold flex-shrink-0"
          style={{ background: `${readinessColor}18`, color: readinessColor, border: `1px solid ${readinessColor}35` }}
        >
          {lead.readinessScore}
        </span>
      </div>

      <p className="text-[11px] text-gray-500 mb-2">{lead.industry} · {lead.companySize}</p>
      <p className="text-[11px] text-gray-400 leading-relaxed line-clamp-2 mb-3 min-h-[2.4em]">
        {lead.primaryPainSignal}
      </p>

      {/* Footer */}
      <div className="flex items-center justify-between gap-1.5 flex-wrap">
        {aiStatus ? (
          /* 11A: score chip + trend sparkline grouped together */
          <div className="flex items-center gap-1 flex-shrink-0">
            <span
              className="text-[10px] font-bold flex items-center gap-1 px-1.5 py-0.5 rounded-md"
              style={{
                color:      aiStatus.aiScore >= 75 ? '#10B981' : aiStatus.aiScore >= 50 ? '#FB923C' : '#FD4438',
                background: aiStatus.aiScore >= 75 ? 'rgba(16,185,129,0.1)' : aiStatus.aiScore >= 50 ? 'rgba(251,146,60,0.1)' : 'rgba(253,68,56,0.1)',
              }}
            >
              <Sparkles className="size-2.5" />{aiStatus.aiScore}
            </span>
            <ScoreTrendSparkline leadId={lead.id} currentScore={aiStatus.aiScore} history={scoreHistory} />
          </div>
        ) : (
          <span className="text-[10px] text-gray-600 flex items-center gap-1">
            <Brain className="size-2.5" />–
          </span>
        )}

        {lead.urgencyLevel >= 8 && <Flame className="size-3 text-[#FD4438] flex-shrink-0" />}

        {/* 12C: Score-threshold chips — critical or hot, never both */}
        <AnimatePresence>
          {scoreIsCritical && !isConflict && (
            <motion.span
              key="score-critical"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{   opacity: 0, scale: 0.7 }}
              transition={{ duration: 0.18 }}
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-md flex items-center gap-0.5 flex-shrink-0"
              title={`AI score ${aiStatus?.aiScore} — below critical threshold (38)`}
              style={{
                background: 'rgba(253,68,56,0.14)',
                border:     '1px solid rgba(253,68,56,0.38)',
                color:      '#FD4438',
              }}
            >
              <AlertTriangle className="size-2.5" />Critical
            </motion.span>
          )}
          {scoreIsHot && !isConflict && (
            <motion.span
              key="score-hot"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{   opacity: 0, scale: 0.7 }}
              transition={{ duration: 0.18 }}
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-md flex items-center gap-0.5 flex-shrink-0"
              title={`AI score ${aiStatus?.aiScore} — elevated (≥ 85)`}
              style={{
                background: 'rgba(16,185,129,0.12)',
                border:     '1px solid rgba(16,185,129,0.32)',
                color:      '#10B981',
              }}
            >
              <Sparkles className="size-2.5" />Hot
            </motion.span>
          )}
        </AnimatePresence>

        {/* 9C: Age chip — shows how long the card has been inactive */}
        {ageTier > 0 && ageConfig && !isSaving && !isConflict && (
          <motion.span
            key={ageTier}
            initial={{ opacity: 0, scale: 0.75 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
            className="text-[10px] font-bold px-1.5 py-0.5 rounded-md flex items-center gap-0.5 flex-shrink-0"
            title={`Last activity: ${ageDaysLabel} ago — ${ageConfig.label}`}
            style={{
              background: ageConfig.bg,
              border:     `1px solid ${ageConfig.border}`,
              color:      ageConfig.color,
            }}
          >
            <Clock className="size-2.5" />
            {ageDaysLabel}
          </motion.span>
        )}

        {outcome && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md flex items-center gap-1"
            style={{
              background: outcome.didConvert ? 'rgba(16,185,129,0.15)' : 'rgba(253,68,56,0.1)',
              color:      outcome.didConvert ? '#10B981' : '#FD4438',
              border:     `1px solid ${outcome.didConvert ? 'rgba(16,185,129,0.3)' : 'rgba(253,68,56,0.25)'}`,
            }}>
            {outcome.didConvert ? <TrendingUp className="size-2.5" /> : <TrendingDown className="size-2.5" />}
            {outcome.didConvert
              ? outcome.conversionValue ? `WON · $${Math.round(outcome.conversionValue / 1000)}K` : 'WON'
              : 'LOST'}
          </span>
        )}

        {/* 13F: Priority chip — shown when lead is flagged as high priority */}
        <AnimatePresence>
          {isPriority && (
            <motion.span
              key="priority-flag"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{   opacity: 0, scale: 0.7 }}
              transition={{ duration: 0.18 }}
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-md flex items-center gap-0.5 flex-shrink-0"
              title="Marked as high priority — click ⋯ to remove"
              style={{
                background: 'rgba(251,146,60,0.12)',
                border:     '1px solid rgba(251,146,60,0.32)',
                color:      '#FB923C',
              }}
            >
              <Flag className="size-2.5" />P1
            </motion.span>
          )}
        </AnimatePresence>

        {!isSelectMode && (
          <button
            onClick={e => { e.stopPropagation(); onCardClick(lead.id); }}
            className="ml-auto text-[10px] text-gray-600 hover:text-[#8B5CF6] transition-colors flex items-center gap-0.5 font-medium"
          >
            Detail <ArrowRight className="size-2.5" />
          </button>
        )}
      </div>

      {/* 13E: Client activity row — shows the most recent engagement event */}
      {latestEngagement && <ClientActivityRow event={latestEngagement} />}

      {/* 9C: Bottom accent bar — tier 1+ only */}
      {ageTier > 0 && ageConfig && (
        <div
          className="absolute bottom-0 left-0 right-0 rounded-b-xl"
          style={{
            height:     '2px',
            background: `linear-gradient(90deg, ${ageConfig.color}65, transparent)`,
          }}
        />
      )}
    </div>
  );
}

// ── KanbanColumnView ───────────────────────────────────────────────────────────
function KanbanColumnView({
  column, leads, aiStatusMap, outcomesMap, onDrop, onCardClick, savingIds,
  isSelectMode, selectedIds, onToggleSelect,
  remoteChanges, conflictIds, onAcceptRemote, onDismissRemote,
  onSelectAllColumn,
  isFocusedCol, focusedCardIdx, onFocusCol,
  staleFilterActive,
  capacity,
  onCapUpdate,
  onQuickMove,
  scoreHistoryMap,
  engagementMap,
  priorityMap,
  onTogglePriority,
  onAddNote,
}: {
  column:            PipelineColumnDef;
  leads:             Lead[];
  aiStatusMap:       Record<string, CortexStatusEntry>;
  outcomesMap:       OutcomeMap;
  onDrop:            (leadId: string, fromColumnId: string, toColumn: PipelineColumnDef, selectedLeadIds: string[]) => void;
  onCardClick:       (id: string) => void;
  savingIds:         Set<string>;
  isSelectMode:      boolean;
  selectedIds:       Set<string>;
  onToggleSelect:    (id: string) => void;
  remoteChanges:     Map<string, RemoteChange>;
  conflictIds:       Set<string>;
  onAcceptRemote:    (leadId: string, toColumnId: string) => void;
  onDismissRemote:   (leadId: string) => void;
  /** 8B: called with all lead IDs in this column; parent toggles selection */
  onSelectAllColumn: (ids: string[]) => void;
  /** 9B: keyboard focus props */
  isFocusedCol:      boolean;
  focusedCardIdx:    number | null;
  onFocusCol:        () => void;
  /** 9C: stale filter mode — dims fresh cards */
  staleFilterActive: boolean;
  /** 10B: max cards for this column (0 = unlimited) */
  capacity:          number;
  /** 12B: inline cap editor — called when the user commits a new cap value */
  onCapUpdate:       (newCap: number) => void;
  /** 10C: move card to another column via quick-actions popover */
  onQuickMove:       (leadId: string, toColId: string) => void;
  /** 11B: map of leadId → score snapshot array, passed down to each card */
  scoreHistoryMap:   Record<string, number[]>;
  /** 13E: map of submissionId → latest engagement event */
  engagementMap:     Record<string, EngagementEvent | null>;
  /** 13F: priority state map (leadId → boolean) */
  priorityMap:       Record<string, boolean>;
  /** 13F: toggle priority for a lead */
  onTogglePriority:  (leadId: string) => void;
  /** 13F: save a quick note inline */
  onAddNote:         (leadId: string, content: string, type: 'note' | 'action' | 'flag') => Promise<void>;
}) {
  const [{ isOver, canDrop }, dropRef] = useDrop<DragItem, void, { isOver: boolean; canDrop: boolean }>({
    accept: DRAG_TYPE,
    drop: item => {
      if (item.fromColumnId !== column.id) {
        onDrop(item.leadId, item.fromColumnId, column, item.selectedLeadIds);
      }
    },
    canDrop: item => item.fromColumnId !== column.id,
    collect: monitor => ({ isOver: monitor.isOver(), canDrop: monitor.canDrop() }),
  });

  const isActive    = isOver && canDrop;
  const totalRevenue = column.id === 'converted'
    ? leads.reduce((s, l) => s + (outcomesMap[l.id]?.conversionValue || 0), 0)
    : 0;

  // ── 12B: Inline cap edit state ───────────────────────────────────────────────
  const [editingCap, setEditingCap] = useState(false);
  const [capInputVal, setCapInputVal] = useState('');
  const capInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingCap) {
      capInputRef.current?.focus();
      capInputRef.current?.select();
    }
  }, [editingCap]);

  const startEditCap = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (column.triggersOutcome) return;
    setCapInputVal(cap !== null ? String(cap) : '0');
    setEditingCap(true);
  };

  const commitCapEdit = () => {
    const val = parseInt(capInputVal, 10);
    if (!isNaN(val) && val >= 0) onCapUpdate(val);
    setEditingCap(false);
  };

  // ── 8B: column-level selection state ────────────────────────────────────────
  const colLeadIds        = leads.map(l => l.id);
  const selectedInColCount = colLeadIds.filter(id => selectedIds.has(id)).length;
  const allSelected        = colLeadIds.length > 0 && selectedInColCount === colLeadIds.length;
  const someSelected       = selectedInColCount > 0 && !allSelected;

  // ── 9C: Stale counts for this column ────────────────────────────────────────
  const isTerminalCol  = column.id === 'converted' || column.id === 'disqualified';
  const staleCount     = isTerminalCol ? 0 : leads.filter(l => getAgeTier(l.lastActivityAt) >= 1).length;
  const criticalCount  = isTerminalCol ? 0 : leads.filter(l => getAgeTier(l.lastActivityAt) >= 3).length;
  const showAgingRow   = staleCount > 0;

  // ── 10B: Capacity helpers ────────────────────────────────────────────────────
  const cap           = capacity > 0 ? capacity : null;   // null → unlimited
  const atCapacity    = cap !== null && leads.length >= cap;
  const nearCapacity  = cap !== null && !atCapacity && leads.length / cap >= 0.8;
  const capBadgeColor = atCapacity  ? '#FD4438'
                      : nearCapacity ? '#D97706'
                      : isSelectMode && (allSelected || someSelected) ? '#C4B5FD'
                      : column.color;
  const capBadgeBg    = atCapacity  ? 'rgba(253,68,56,0.18)'
                      : nearCapacity ? 'rgba(217,119,6,0.18)'
                      : isSelectMode && (allSelected || someSelected) ? 'rgba(139,92,246,0.22)'
                      : `${column.color}20`;
  // Amber drop-zone tint overrides blue when at capacity
  const dropColor     = isActive && atCapacity ? '#D97706' : column.color;

  return (
    <div
      ref={dropRef as unknown as React.RefObject<HTMLDivElement>}
      data-kb-col-focused={isFocusedCol ? 'true' : undefined}
      className="flex flex-col w-[270px] flex-shrink-0 rounded-2xl transition-all duration-200"
      style={{
        background: isActive
          ? `linear-gradient(180deg, ${dropColor}12 0%, rgba(10,10,20,0.7) 100%)`
          : 'rgba(255,255,255,0.02)',
        border:     isActive ? `1.5px solid ${dropColor}70` : '1.5px solid rgba(255,255,255,0.06)',
        boxShadow:  isActive ? `0 0 40px ${dropColor}18, inset 0 0 20px ${dropColor}06` : 'none',
        // 9B: purple outline ring when this column has keyboard focus
        outline:       isFocusedCol && !isActive ? '2px solid rgba(139,92,246,0.45)' : 'none',
        outlineOffset: '2px',
      }}
    >
      {/* Column header — clicking focuses this column for keyboard nav */}
      <div className="px-4 pt-4 pb-3 flex-shrink-0 cursor-default" onClick={onFocusCol}>
        <div className="flex items-center justify-between mb-1">

          <div className="flex items-center gap-2">
            {/* ── 8B: Column select-all checkbox ── */}
            <AnimatePresence>
              {isSelectMode && (
                <motion.button
                  key="col-checkbox"
                  initial={{ opacity: 0, scale: 0.6, width: 0, marginRight: 0 }}
                  animate={{ opacity: 1, scale: 1,   width: 20,  marginRight: 0 }}
                  exit={{   opacity: 0, scale: 0.6, width: 0,  marginRight: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  onClick={() => onSelectAllColumn(colLeadIds)}
                  disabled={leads.length === 0}
                  title={
                    leads.length === 0  ? 'No cards to select'
                    : allSelected       ? `Deselect all ${leads.length} in ${column.label}`
                                        : `Select all ${leads.length} in ${column.label}`
                  }
                  className="flex items-center justify-center size-5 rounded-md flex-shrink-0 transition-all disabled:opacity-25"
                  style={{
                    background: allSelected
                      ? 'rgba(139,92,246,1)'
                      : someSelected
                        ? 'rgba(139,92,246,0.3)'
                        : 'rgba(255,255,255,0.08)',
                    border: allSelected
                      ? '1.5px solid rgba(139,92,246,1)'
                      : someSelected
                        ? '1.5px solid rgba(139,92,246,0.55)'
                        : '1.5px solid rgba(255,255,255,0.18)',
                  }}
                >
                  {allSelected && (
                    <Check className="size-3 text-white" strokeWidth={3} />
                  )}
                  {someSelected && (
                    <div className="w-2.5 h-[2px] rounded-full bg-[#C4B5FD]" />
                  )}
                </motion.button>
              )}
            </AnimatePresence>

            <column.Icon className="size-3.5 flex-shrink-0" style={{ color: column.color }} />
            <span className="text-xs font-bold text-white tracking-wide">{column.label}</span>
          </div>

          {/* 10B / 12B: Count badge — static in select mode, inline-editable cap otherwise */}
          {isSelectMode ? (
            <motion.span
              layout
              className="text-xs font-bold px-2 py-0.5 rounded-full min-w-[32px] text-center transition-colors"
              style={{ background: capBadgeBg, color: capBadgeColor }}
            >
              {someSelected ? `${selectedInColCount}/${leads.length}` : leads.length}
            </motion.span>
          ) : (
            <div
              className="flex items-center gap-0.5 text-xs font-bold px-2 py-0.5 rounded-full transition-colors select-none"
              style={{ background: capBadgeBg, color: capBadgeColor }}
              title={column.triggersOutcome ? undefined : cap ? `${leads.length}/${cap} — click cap to edit` : 'Click ∞ to set a WIP cap'}
            >
              {/* Current count — always static */}
              <span>{leads.length}</span>

              {/* Separator + cap — only for non-terminal columns */}
              {!column.triggersOutcome && (
                <span className="contents">
                  <span className="opacity-40 mx-0.5">/</span>
                  {editingCap ? (
                    // ── Inline input ──
                    <input
                      ref={capInputRef}
                      type="number"
                      min="0"
                      max="99"
                      value={capInputVal}
                      onChange={e => setCapInputVal(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); commitCapEdit(); }
                        if (e.key === 'Escape') setEditingCap(false);
                        e.stopPropagation();
                      }}
                      onBlur={commitCapEdit}
                      onClick={e => e.stopPropagation()}
                      className="w-7 bg-transparent border-b border-current/50 text-center font-bold outline-none focus:border-current"
                      style={{ color: capBadgeColor }}
                    />
                  ) : (
                    // ── Clickable cap number (or ∞) ──
                    <span
                      onClick={startEditCap}
                      className="cursor-text transition-opacity hover:opacity-70 active:opacity-50"
                      title="Click to edit WIP cap (0 = unlimited)"
                    >
                      {cap !== null ? cap : <span className="opacity-30 text-[11px]">∞</span>}
                    </span>
                  )}
                </span>
              )}
            </div>
          )}
        </div>

        {column.id === 'converted' && totalRevenue > 0 && (
          <div className="text-[11px] text-[#10B981] font-semibold flex items-center gap-1 mt-1">
            <DollarSign className="size-2.5" />
            ${totalRevenue >= 1000000 ? `${(totalRevenue / 1000000).toFixed(1)}M` : `${Math.round(totalRevenue / 1000)}K`} logged
          </div>
        )}

        {isActive && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
            className="mt-2 text-[10px] font-semibold text-center py-1 rounded-lg"
            style={{ background: `${dropColor}18`, color: dropColor }}>
            {atCapacity
              ? `⚠ Full (${leads.length}/${cap}) · drop to override`
              : column.triggersOutcome
                ? column.outcomeType === 'win' ? '🎉 Log as win…' : 'Log as lost…'
                : 'Move here →'}
          </motion.div>
        )}

        {/* 9C: Stale summary row */}
        <AnimatePresence>
          {showAgingRow && (
            <motion.div
              key="stale-row"
              initial={{ opacity: 0, height: 0, marginTop: 0 }}
              animate={{ opacity: 1, height: 'auto', marginTop: 6 }}
              exit={{   opacity: 0, height: 0, marginTop: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-2 overflow-hidden"
            >
              <div className="flex items-center gap-1">
                <Clock className="size-2.5 flex-shrink-0" style={{ color: '#D97706' }} />
                <span className="text-[9px] font-bold" style={{ color: '#D97706' }}>
                  {staleCount} stale
                </span>
              </div>
              {criticalCount > 0 && (
                <span className="text-[9px] font-semibold" style={{ color: '#DC2626' }}>
                  · {criticalCount} critical
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Separator — tints purple when any cards in this column are selected */}
        <div
          className="mt-3 h-px transition-all duration-300"
          style={{
            background: isSelectMode && (allSelected || someSelected)
              ? 'linear-gradient(90deg, rgba(139,92,246,0.6), transparent)'
              : `linear-gradient(90deg, ${column.color}40, transparent)`,
          }}
        />
      </div>

      {/* Cards */}
      <div className="flex-1 px-3 pb-4 pt-1 space-y-2.5 overflow-y-auto"
        style={{ maxHeight: 'calc(100vh - 310px)', minHeight: '120px' }}>
        <AnimatePresence mode="popLayout">
          {leads.length === 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex items-center justify-center rounded-xl border-2 border-dashed"
              style={{ borderColor: isActive ? `${column.color}50` : 'rgba(255,255,255,0.06)', minHeight: '80px' }}>
              <span className="text-[11px] text-gray-600">{isActive ? 'Drop here' : 'Empty'}</span>
            </motion.div>
          ) : (
            leads.map((lead, cardIdx) => (
              <motion.div key={lead.id} layout
                initial={{ opacity: 0, y: 12, scale: 0.96 }}
                animate={{ opacity: 1, y: 0,  scale: 1    }}
                exit={{   opacity: 0, y: -8,  scale: 0.94 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}>
                <KanbanCard
                  lead={lead}
                  aiStatus={aiStatusMap[lead.id] || null}
                  outcome={outcomesMap[lead.id] || null}
                  onCardClick={onCardClick}
                  isSaving={savingIds.has(lead.id)}
                  isSelectMode={isSelectMode}
                  isSelected={selectedIds.has(lead.id)}
                  onToggleSelect={onToggleSelect}
                  columnId={column.id}
                  selectedIds={selectedIds}
                  remoteChange={remoteChanges.get(lead.id) ?? null}
                  isConflict={conflictIds.has(lead.id)}
                  onAcceptRemote={onAcceptRemote}
                  onDismissRemote={onDismissRemote}
                  isFocused={isFocusedCol && focusedCardIdx === cardIdx}
                  staleFilterActive={staleFilterActive}
                  onQuickMove={onQuickMove}
                  scoreHistory={scoreHistoryMap[lead.id]}
                  latestEngagement={engagementMap[lead.id] ?? null}
                  isPriority={priorityMap[lead.id] ?? false}
                  onTogglePriority={onTogglePriority}
                  onAddNote={onAddNote}
                />
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── 8C: Activity Drawer helpers ───────────────────────────────────────────────
const ACTIVITY_META: Record<ActivityEntry['type'], { Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; color: string }> = {
  move:        { Icon: ArrowRight,   color: '#06D7F6' },
  bulk_move:   { Icon: Layers,       color: '#8B5CF6' },
  win:         { Icon: TrendingUp,   color: '#10B981' },
  loss:        { Icon: TrendingDown, color: '#FD4438' },
  bulk_win:    { Icon: TrendingUp,   color: '#10B981' },
  bulk_loss:   { Icon: TrendingDown, color: '#FD4438' },
  remote_sync: { Icon: Radio,        color: '#FB923C' },
  reset:       { Icon: RotateCcw,    color: '#6B7280' },
};

function getColLabel(colId: string): string {
  return PIPELINE_COLUMNS.find(c => c.id === colId)?.label ?? colId;
}

function getEntryHeadline(e: ActivityEntry): string {
  switch (e.type) {
    case 'move':        return e.company ?? 'Card';
    case 'bulk_move':   return `${e.count ?? e.companies?.length ?? 2} cards moved`;
    case 'win':         return e.company ?? 'Deal';
    case 'loss':        return e.company ?? 'Deal';
    case 'bulk_win':    return `${e.count ?? 2} win${(e.count ?? 2) !== 1 ? 's' : ''} logged`;
    case 'bulk_loss':   return `${e.count ?? 2} loss${(e.count ?? 2) !== 1 ? 'es' : ''} logged`;
    case 'remote_sync': return e.company ? `Remote: ${e.company}` : 'Remote change';
    case 'reset':       return 'Board reset';
  }
}

function getEntryDetail(e: ActivityEntry): string {
  switch (e.type) {
    case 'move':
    case 'bulk_move':
      return e.fromCol && e.toCol
        ? `${getColLabel(e.fromCol)} → ${getColLabel(e.toCol)}`
        : e.toCol ? `→ ${getColLabel(e.toCol)}` : '';
    case 'win':
      return `WON${e.value ? ` · $${(e.value / 1000).toFixed(0)}K` : ''}`;
    case 'loss':
      return `LOST${e.lostReason ? ` · ${e.lostReason}` : ''}`;
    case 'bulk_win':
      return `Converted${e.value ? ` · $${(e.value / 1000).toFixed(0)}K total` : ''}`;
    case 'bulk_loss':
      return `Disqualified${e.lostReason ? ` · ${e.lostReason}` : ''}`;
    case 'remote_sync':
      return e.fromCol && e.toCol
        ? `${getColLabel(e.fromCol)} → ${getColLabel(e.toCol)}`
        : 'Position changed remotely';
    case 'reset':
      return 'Layout restored to submission statuses';
  }
}

/** Small isolated ticker so each entry gets its own live "X ago" display */
function ActivityTimeAgo({ ts }: { ts: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);
  return <span className="contents">{timeAgoShort(ts)}</span>;
}

// ── 8C: Activity Feed Drawer ───────────────────────────────────────────────────
function ActivityDrawer({
  feed,
  isOpen,
  onClose,
  onJumpToCard,
}: {
  feed:         ActivityEntry[];
  isOpen:       boolean;
  onClose:      () => void;
  onJumpToCard: (leadId: string) => void;
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="activity-drawer"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', stiffness: 420, damping: 38 }}
          className="fixed right-0 top-0 h-screen z-40 flex flex-col"
          style={{
            width: '300px',
            background: 'linear-gradient(180deg, #0D0D1A 0%, #09090F 100%)',
            borderLeft: '1px solid rgba(255,255,255,0.07)',
            boxShadow: '-20px 0 60px rgba(0,0,0,0.55), -2px 0 0 rgba(139,92,246,0.08)',
          }}
        >
          {/* ── Header ── */}
          <div
            className="px-5 py-4 flex-shrink-0"
            style={{
              background: 'linear-gradient(135deg, rgba(139,92,246,0.08), transparent 65%)',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div className="flex items-center justify-between mb-0.5">
              <div className="flex items-center gap-2">
                <ScrollText className="size-3.5 text-[#8B5CF6]" />
                <span className="text-[10px] font-bold text-white tracking-widest uppercase">
                  Activity Feed
                </span>
              </div>
              <button
                onClick={onClose}
                className="size-7 flex items-center justify-center rounded-lg text-gray-600 hover:text-white transition-colors"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
            <p className="text-[10px] text-gray-700">
              {feed.length === 0
                ? 'Waiting for events…'
                : `${feed.length} event${feed.length !== 1 ? 's' : ''} this session`}
              {' · '}Session only
            </p>
          </div>

          {/* ── Feed list ── */}
          <div className="flex-1 overflow-y-auto py-2">
            {feed.length === 0 ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
                <div
                  className="size-14 rounded-2xl flex items-center justify-center"
                  style={{ background: 'rgba(139,92,246,0.09)', border: '1px solid rgba(139,92,246,0.18)' }}
                >
                  <ScrollText className="size-7 text-[#8B5CF6] opacity-50" />
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-600">No activity yet</p>
                  <p className="text-[10px] text-gray-700 mt-1.5 leading-relaxed">
                    Move a card, log an outcome, or wait for a live sync to see events here.
                  </p>
                </div>
              </div>
            ) : (
              <div className="px-2 space-y-px">
                {feed.map((entry, i) => {
                  const { Icon, color } = ACTIVITY_META[entry.type];
                  const headline  = getEntryHeadline(entry);
                  const detail    = getEntryDetail(entry);
                  const hasBulkNames = (
                    entry.type === 'bulk_move' ||
                    entry.type === 'bulk_win'  ||
                    entry.type === 'bulk_loss'
                  ) && (entry.companies?.length ?? 0) > 0;
                  const canJump = !!entry.leadId;

                  return (
                    <motion.div
                      key={entry.id}
                      initial={i === 0 ? { opacity: 0, y: -10, scale: 0.97 } : false}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      className="group flex gap-3 px-3 py-3 rounded-xl transition-colors"
                      style={{
                        background: 'transparent',
                        borderLeft: `2px solid ${color}38`,
                        marginLeft: '2px',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.02)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                    >
                      {/* Icon bubble */}
                      <div
                        className="size-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                        style={{ background: `${color}14`, border: `1px solid ${color}28` }}
                      >
                        <Icon className="size-3.5" style={{ color }} />
                      </div>

                      {/* Text content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-1.5">
                          <p className="text-[11px] font-bold text-white leading-tight truncate">
                            {headline}
                          </p>
                          {canJump && (
                            <button
                              onClick={() => { onJumpToCard(entry.leadId!); onClose(); }}
                              className="flex-shrink-0 flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider text-gray-700 hover:text-[#8B5CF6] transition-colors opacity-0 group-hover:opacity-100"
                            >
                              Jump <ArrowRight className="size-2.5" />
                            </button>
                          )}
                        </div>

                        {detail && (
                          <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">{detail}</p>
                        )}

                        {hasBulkNames && entry.companies && (
                          <p className="text-[9px] text-gray-700 mt-0.5 leading-tight">
                            {entry.companies.slice(0, 3).join(', ')}
                            {entry.companies.length > 3 && (
                              <span className="text-gray-600"> +{entry.companies.length - 3} more</span>
                            )}
                          </p>
                        )}

                        <p className="text-[9px] text-gray-700 mt-1.5 tabular-nums">
                          <ActivityTimeAgo ts={entry.ts} />
                        </p>
                      </div>
                    </motion.div>
                  );
                })}

                {/* Session-start divider */}
                <div className="flex items-center gap-3 px-3 py-4 mt-1">
                  <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.05)' }} />
                  <span className="text-[9px] text-gray-700 font-medium uppercase tracking-widest flex-shrink-0">
                    Session start
                  </span>
                  <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.05)' }} />
                </div>
              </div>
            )}
          </div>

          {/* ── Footer ── */}
          {feed.length > 0 && (
            <div
              className="px-5 py-3 flex-shrink-0"
              style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
            >
              <p className="text-[9px] text-gray-700 text-center">
                In-memory only · clears on page refresh
              </p>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── 8A: Advisory text builder ──────────────────────────────────────────────────
function buildAdvisory(data: LearningLoopData, lead: Lead): string {
  const parts: string[] = [];
  const ind = data.byIndustry.find(b =>
    b.industry.toLowerCase() === lead.industry.toLowerCase()
  );
  if (ind && ind.total >= 2) {
    parts.push(
      `${ind.total} ${lead.industry} deals tracked — ${ind.conversionRate}% win rate across the sector.`
    );
  }
  if (data.topLostReasons.length > 0) {
    const top = data.topLostReasons[0];
    const label = REASON_MAP[top.reason] || top.reason;
    parts.push(`"${label}" is the #1 loss driver (×${top.count}).`);
  }
  if (data.recommendationAccuracy !== null) {
    parts.push(
      `Our recommendation prevented loss in ${data.recommendationAccuracy}% of cases where it was applied.`
    );
  }
  return parts.slice(0, 3).join(' ');
}

// ── 8A: Loss Intelligence Panel ────────────────────────────────────────────────
function LossIntelPanel({
  primaryLead,
  accessToken,
  onSuggestReason,
  onSuggestArea,
  currentReason,
  currentTags,
}: {
  primaryLead:     Lead;
  accessToken?:    string;
  onSuggestReason: (reason: string) => void;
  onSuggestArea:   (area: string) => void;
  currentReason:   string;
  currentTags:     string[];
}) {
  const [data,    setData]    = useState<LearningLoopData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEmpty, setIsEmpty] = useState(false);

  useEffect(() => {
    if (!isBackendEnabled() || !accessToken) { setLoading(false); return; }
    getLearningLoop(accessToken)
      .then(res => {
        if (res.isEmpty || !res.data) setIsEmpty(true);
        else setData(res.data);
      })
      .catch(() => setIsEmpty(true))
      .finally(() => setLoading(false));
  }, []);

  const industryMatch = data?.byIndustry.find(b =>
    b.industry.toLowerCase() === primaryLead.industry.toLowerCase()
  ) ?? null;

  const scoreBand = data
    ? primaryLead.readinessScore === 'High'
      ? data.scoreCorrelation.highScore
      : primaryLead.readinessScore === 'Medium'
        ? data.scoreCorrelation.midScore
        : data.scoreCorrelation.lowScore
    : null;

  const topReasons = data?.topLostReasons.slice(0, 4) ?? [];
  const topAreas   = data?.improvementAreas.slice(0, 4) ?? [];
  const advisory   = data ? buildAdvisory(data, primaryLead) : '';

  return (
    <div
      className="w-full md:w-[272px] flex-shrink-0 flex flex-col"
      style={{
        borderTop:  '1px solid rgba(255,255,255,0.06)',
        borderLeft: undefined, // applied via CSS below
      }}
    >
      {/* Panel header */}
      <div
        className="px-4 py-3.5 flex-shrink-0"
        style={{
          background:   'linear-gradient(135deg, rgba(139,92,246,0.08), rgba(253,68,56,0.05))',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <div className="flex items-center gap-2 mb-0.5">
          <Brain className="size-3.5 text-[#8B5CF6]" />
          <span className="text-[10px] font-bold text-white tracking-widest uppercase">
            CORTEX Intelligence
          </span>
        </div>
        <p className="text-[10px] text-gray-600 leading-relaxed">
          {loading
            ? 'Fetching loss patterns…'
            : isEmpty
              ? 'No prior loss data yet'
              : `Based on ${data!.totalLost} prior loss${data!.totalLost !== 1 ? 'es' : ''}`}
        </p>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

        {/* ── Loading skeleton ─────────────────────────────────────────────── */}
        {loading && (
          <div className="space-y-3 pt-1">
            {[75, 55, 68, 45, 80].map(w => (
              <div
                key={w}
                className="rounded-lg animate-pulse"
                style={{ width: `${w}%`, height: '28px', background: 'rgba(255,255,255,0.05)' }}
              />
            ))}
          </div>
        )}

        {/* ── Empty / first loss state ─────────────────────────────────────── */}
        {!loading && isEmpty && (
          <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
            <div
              className="size-12 rounded-2xl flex items-center justify-center"
              style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)' }}
            >
              <Sparkles className="size-6 text-[#8B5CF6]" />
            </div>
            <div>
              <p className="text-xs font-bold text-white">First loss to be logged</p>
              <p className="text-[10px] text-gray-600 mt-1 leading-relaxed">
                Intelligence grows with each outcome. Future losses will surface pattern matches here.
              </p>
            </div>
            <div
              className="px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-widest"
              style={{ background: 'rgba(139,92,246,0.15)', color: '#8B5CF6', border: '1px solid rgba(139,92,246,0.3)' }}
            >
              Writing history
            </div>
          </div>
        )}

        {/* ── Populated intelligence ───────────────────────────────────────── */}
        {!loading && !isEmpty && data && (
          <span className="contents">
            {/* Industry Context */}
            {industryMatch && (
              <div>
                <p className="text-[9px] font-bold text-gray-600 uppercase tracking-widest mb-2">
                  Industry Context
                </p>
                <div
                  className="rounded-xl p-3"
                  style={{ background: 'rgba(253,68,56,0.07)', border: '1px solid rgba(253,68,56,0.15)' }}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-white">{industryMatch.industry}</span>
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-md"
                      style={{
                        background: industryMatch.conversionRate >= 50 ? 'rgba(16,185,129,0.15)' : 'rgba(253,68,56,0.15)',
                        color:      industryMatch.conversionRate >= 50 ? '#10B981' : '#FD4438',
                      }}
                    >
                      {industryMatch.conversionRate}% won
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-gray-500 mb-2">
                    <span>{industryMatch.total} deals</span>
                    <span>{industryMatch.total - industryMatch.converted} lost</span>
                    {industryMatch.avgDealSize > 0 && (
                      <span>avg ${Math.round(industryMatch.avgDealSize / 1000)}K</span>
                    )}
                  </div>
                  {/* Progress bar */}
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width:      `${industryMatch.conversionRate}%`,
                        background: industryMatch.conversionRate >= 50
                          ? 'linear-gradient(90deg,#059669,#10B981)'
                          : 'linear-gradient(90deg,#DC2626,#FD4438)',
                        transition: 'width 0.6s ease',
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Common Blockers */}
            {topReasons.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[9px] font-bold text-gray-600 uppercase tracking-widest">
                    Common Blockers
                  </p>
                  <span className="text-[9px] text-gray-700">tap to select</span>
                </div>
                <div className="space-y-1.5">
                  {topReasons.map((r, i) => {
                    const fullLabel = REASON_MAP[r.reason] || r.reason;
                    const isActive  = currentReason === fullLabel;
                    const isTop     = i === 0;
                    return (
                      <motion.button
                        key={r.reason}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => onSuggestReason(fullLabel)}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs text-left transition-all"
                        style={{
                          background: isActive
                            ? 'rgba(253,68,56,0.22)'
                            : isTop
                              ? 'rgba(253,68,56,0.09)'
                              : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${
                            isActive ? 'rgba(253,68,56,0.55)'
                            : isTop  ? 'rgba(253,68,56,0.22)'
                                     : 'rgba(255,255,255,0.06)'
                          }`,
                          color: isActive ? '#FCA5A5' : isTop ? '#FDB4AF' : '#6B7280',
                        }}
                      >
                        <span className="truncate font-medium">{fullLabel}</span>
                        <span
                          className="ml-2 flex-shrink-0 text-[9px] px-1.5 py-0.5 rounded font-bold"
                          style={{
                            background: isTop ? 'rgba(253,68,56,0.2)' : 'rgba(255,255,255,0.06)',
                            color:      isTop ? '#FD4438' : '#4B5563',
                          }}
                        >
                          ×{r.count}
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Flagged Improvement Areas */}
            {topAreas.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[9px] font-bold text-gray-600 uppercase tracking-widest">
                    Flagged Areas
                  </p>
                  <span className="text-[9px] text-gray-700">tap to tag</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {topAreas.map((a, i) => {
                    const isTagged = currentTags.includes(a.area);
                    const isTop    = i === 0;
                    return (
                      <motion.button
                        key={a.area}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => onSuggestArea(a.area)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-all"
                        style={{
                          background: isTagged
                            ? 'rgba(139,92,246,0.22)'
                            : isTop
                              ? 'rgba(251,146,60,0.1)'
                              : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${
                            isTagged ? 'rgba(139,92,246,0.5)'
                            : isTop  ? 'rgba(251,146,60,0.3)'
                                     : 'rgba(255,255,255,0.07)'
                          }`,
                          color: isTagged ? '#C4B5FD' : isTop ? '#FB923C' : '#6B7280',
                        }}
                      >
                        {isTagged && <Check className="size-2.5 flex-shrink-0" strokeWidth={3} />}
                        <span>{a.area}</span>
                        <span className="opacity-60">×{a.count}</span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Score Band Insight */}
            {scoreBand && scoreBand.total > 0 && (
              <div>
                <p className="text-[9px] font-bold text-gray-600 uppercase tracking-widest mb-2">
                  Score Band Insight
                </p>
                <div
                  className="rounded-xl p-3"
                  style={{ background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.15)' }}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] text-gray-400">
                      {primaryLead.readinessScore} readiness · {scoreBand.range}
                    </span>
                    <span
                      className="text-xs font-bold"
                      style={{ color: (scoreBand.rate ?? 0) >= 50 ? '#10B981' : '#FB923C' }}
                    >
                      {scoreBand.rate !== null ? `${scoreBand.rate}% wins` : '—'}
                    </span>
                  </div>
                  <div className="h-1 rounded-full overflow-hidden mb-1.5" style={{ background: 'rgba(255,255,255,0.07)' }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width:      `${scoreBand.rate ?? 0}%`,
                        background: (scoreBand.rate ?? 0) >= 50
                          ? 'linear-gradient(90deg,#059669,#10B981)'
                          : 'linear-gradient(90deg,#D97706,#FB923C)',
                        transition: 'width 0.6s ease',
                      }}
                    />
                  </div>
                  <p className="text-[9px] text-gray-600">{scoreBand.total} outcomes in this band</p>
                </div>
              </div>
            )}

            {/* Recommendation Accuracy */}
            {data.recommendationAccuracy !== null && (
              <div>
                <p className="text-[9px] font-bold text-gray-600 uppercase tracking-widest mb-2">
                  Rec Accuracy
                </p>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width:      `${data.recommendationAccuracy}%`,
                        background: data.recommendationAccuracy >= 70
                          ? 'linear-gradient(90deg,#059669,#10B981)'
                          : data.recommendationAccuracy >= 50
                            ? 'linear-gradient(90deg,#D97706,#FB923C)'
                            : 'linear-gradient(90deg,#DC2626,#FD4438)',
                        transition: 'width 0.6s ease',
                      }}
                    />
                  </div>
                  <span
                    className="text-xs font-bold flex-shrink-0"
                    style={{
                      color: data.recommendationAccuracy >= 70
                        ? '#10B981'
                        : data.recommendationAccuracy >= 50
                          ? '#FB923C'
                          : '#FD4438',
                    }}
                  >
                    {data.recommendationAccuracy}%
                  </span>
                </div>
                <p className="text-[9px] text-gray-600 mt-1">Prevented loss when applied</p>
              </div>
            )}

            {/* CORTEX Advisory */}
            {advisory && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="rounded-xl p-3"
                style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)' }}
              >
                <div className="flex items-center gap-1.5 mb-2">
                  <Lightbulb className="size-3 text-[#8B5CF6] flex-shrink-0" />
                  <span className="text-[9px] font-bold text-[#8B5CF6] uppercase tracking-widest">
                    CORTEX Advisory
                  </span>
                </div>
                <p className="text-[11px] text-gray-400 leading-relaxed">{advisory}</p>
              </motion.div>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

// ── OutcomeModal ───────────────────────────────────────────────────────────────
function OutcomeModal({
  pending, accessToken, onConfirm, onCancel,
}: {
  pending:     PendingDrop;
  accessToken?: string;
  onConfirm:  (payload: OutcomePayload) => Promise<void>;
  onCancel:   () => void;
}) {
  const isWin       = pending.toColumn.outcomeType === 'win';
  const accentColor = isWin ? '#10B981' : '#FD4438';
  const isBulk      = pending.leads.length > 1;

  const [dealValue,  setDealValue]  = useState('');
  const [lostReason, setLostReason] = useState('');
  const [recWorked,  setRecWorked]  = useState<boolean | null>(null);
  const [learned,    setLearned]    = useState('');
  const [tags,       setTags]       = useState<string[]>([]);
  const [isSaving,   setIsSaving]   = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const canSave = isWin ? true : lostReason.length > 0;

  // 8A: helper passed to LossIntelPanel so clicking a flagged area auto-tags it
  const handleSuggestArea = (area: string) => {
    setTags(prev => prev.includes(area) ? prev : [...prev, area]);
  };

  const handleSave = async () => {
    if (!canSave || isSaving) return;
    setIsSaving(true); setError(null);
    const payload: OutcomePayload = {
      didConvert:           isWin,
      conversionValue:      isWin && dealValue ? Number(dealValue) : null,
      lostReason:           !isWin ? lostReason || null : null,
      recommendationWorked: recWorked,
      whatWeLearned:        learned || undefined,
      improvementAreas:     tags.length ? tags : undefined,
    };
    try { await onConfirm(payload); }
    catch (e: any) { setError(e.message || 'Failed to log outcome'); setIsSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)' }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 20 }}
        animate={{ opacity: 1, scale: 1,    y: 0  }}
        exit={{   opacity: 0, scale: 0.94,  y: 16 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className={`w-full rounded-2xl overflow-hidden flex ${isWin ? 'max-w-[500px] flex-col' : 'max-w-[860px] flex-col md:flex-row max-h-[90vh]'}`}
        style={{
          background: 'linear-gradient(180deg, #0D0D1A 0%, #0A0A14 100%)',
          border:     `1px solid ${accentColor}45`,
          boxShadow:  `0 24px 80px rgba(0,0,0,0.7), 0 0 40px ${accentColor}12`,
        }}
      >
        {/* ── Left: form panel ───────────────────────────────────────────── */}
        <div className={`flex flex-col ${isWin ? '' : 'flex-1 min-w-0 md:overflow-hidden'}`}>

        {/* Header */}
        <div className="px-6 py-5"
          style={{ background: `linear-gradient(135deg, ${accentColor}12, transparent 60%)`, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-start gap-3">
            <div className="size-11 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ background: `${accentColor}20`, border: `1px solid ${accentColor}35` }}>
              {isWin
                ? <TrendingUp className="size-5" style={{ color: accentColor }} />
                : <XCircle   className="size-5" style={{ color: accentColor }} />}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-bold text-white">
                {isWin ? '🎉 Log Win' : 'Log Loss'}
                {isBulk && (
                  <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: 'rgba(139,92,246,0.2)', color: '#C4B5FD', border: '1px solid rgba(139,92,246,0.35)' }}>
                    {pending.leads.length} leads
                  </span>
                )}
              </h2>
              {!isBulk ? (
                <p className="text-xs text-gray-400 mt-0.5">{pending.leads[0].companyName} · {pending.leads[0].industry}</p>
              ) : (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {pending.leads.map(l => (
                    <span key={l.id} className="text-[10px] font-medium px-2 py-0.5 rounded-md"
                      style={{ background: `${accentColor}14`, color: accentColor, border: `1px solid ${accentColor}30` }}>
                      {l.companyName}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="text-[10px] text-gray-600 text-right leading-relaxed flex-shrink-0">
              Feeds CORTEX<br />Learning Loop
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5 overflow-y-auto" style={{ maxHeight: isWin ? '60vh' : '55vh' }}>
          {isWin && (
            <div>
              <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                {isBulk ? `Combined Deal Value (USD) — split equally across ${pending.leads.length} leads` : 'Deal Value (USD)'}
              </label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-500" />
                <input type="number" placeholder="e.g. 75000" value={dealValue}
                  onChange={e => setDealValue(e.target.value)} autoFocus
                  className="w-full rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none transition-colors"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
                  onFocus={e => (e.target.style.borderColor = `${accentColor}60`)}
                  onBlur={e  => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')} />
              </div>
              {isBulk && dealValue && Number(dealValue) > 0 && (
                <p className="text-[10px] text-gray-600 mt-1.5">
                  ≈ ${Math.round(Number(dealValue) / pending.leads.length).toLocaleString()} per lead
                </p>
              )}
            </div>
          )}

          {!isWin && (
            <div>
              <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Primary Reason Lost <span className="text-[#FD4438]">*</span>
                {isBulk && <span className="text-gray-600 ml-1 normal-case font-normal">(all {pending.leads.length} leads)</span>}
              </label>
              <div className="grid grid-cols-2 gap-2">
                {LOST_REASONS.map(reason => (
                  <button key={reason} onClick={() => setLostReason(reason)}
                    className="px-3 py-2 rounded-lg text-xs font-medium text-left transition-all"
                    style={{
                      background: lostReason === reason ? 'rgba(253,68,56,0.18)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${lostReason === reason ? 'rgba(253,68,56,0.5)' : 'rgba(255,255,255,0.08)'}`,
                      color:  lostReason === reason ? '#FCA5A5' : '#6B7280',
                    }}>
                    {reason}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Did our recommendation help close / prevent close?
            </label>
            <div className="flex gap-2">
              {[
                { val: true,  label: '✓ Yes',   color: '#10B981' },
                { val: false, label: '✗ No',    color: '#FD4438' },
                { val: null,  label: '~ Unsure', color: '#6B7280' },
              ].map(opt => (
                <button key={String(opt.val)} onClick={() => setRecWorked(opt.val)}
                  className="flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all"
                  style={{
                    background: recWorked === opt.val ? `${opt.color}18` : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${recWorked === opt.val ? opt.color + '55' : 'rgba(255,255,255,0.08)'}`,
                    color:  recWorked === opt.val ? opt.color : '#6B7280',
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Improvement Areas <span className="text-gray-600 normal-case font-normal">(optional)</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {IMPROVEMENT_TAGS.map(tag => (
                <button key={tag}
                  onClick={() => setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all"
                  style={{
                    background: tags.includes(tag) ? 'rgba(139,92,246,0.2)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${tags.includes(tag) ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.08)'}`,
                    color:  tags.includes(tag) ? '#C4B5FD' : '#6B7280',
                  }}>
                  {tag}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
              What we learned <span className="text-gray-600 normal-case font-normal">(optional)</span>
            </label>
            <textarea placeholder="Key insight from this deal…" rows={2} value={learned}
              onChange={e => setLearned(e.target.value)}
              className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 resize-none focus:outline-none transition-colors"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              onFocus={e => (e.target.style.borderColor = 'rgba(139,92,246,0.4)')}
              onBlur={e  => (e.target.style.borderColor = 'rgba(255,255,255,0.08)')} />
          </div>

          {error && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm"
              style={{ background: 'rgba(253,68,56,0.1)', border: '1px solid rgba(253,68,56,0.3)', color: '#FCA5A5' }}>
              <AlertTriangle className="size-4 flex-shrink-0" />{error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 flex gap-3 flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <button onClick={onCancel} disabled={isSaving}
            className="flex-1 py-3 rounded-xl text-sm font-semibold text-gray-400 hover:text-white transition-all"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            Cancel — keep in place
          </button>
          <button onClick={handleSave} disabled={isSaving || !canSave}
            className="flex-1 py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40"
            style={{
              background: isWin ? 'linear-gradient(135deg, #059669, #10B981)' : 'linear-gradient(135deg, #DC2626, #FD4438)',
              boxShadow:  canSave && !isSaving ? `0 4px 20px ${accentColor}35` : 'none',
            }}>
            {isSaving
              ? <Loader2 className="size-4 animate-spin mx-auto" />
              : isWin
                ? isBulk ? `🎉 Confirm ${pending.leads.length} Wins` : '🎉 Confirm Win'
                : isBulk ? `Confirm ${pending.leads.length} Losses` : 'Confirm Loss'}
          </button>
        </div>

        </div>{/* end left form panel */}

        {/* ── Right: 8A Loss Intelligence Panel ──────────────────────────── */}
        {!isWin && (
          <div style={{ borderLeft: '1px solid rgba(255,255,255,0.06)' }}>
            <LossIntelPanel
              primaryLead={pending.leads[0]}
              accessToken={accessToken}
              onSuggestReason={setLostReason}
              onSuggestArea={handleSuggestArea}
              currentReason={lostReason}
              currentTags={tags}
            />
          </div>
        )}

      </motion.div>
    </div>
  );
}

// ── 9B: Shortcut legend data ──────────────────────────────────────────────────
const SHORTCUT_GROUPS = [
  {
    label: 'Navigate',
    items: [
      { desc: 'Move between columns', keys: ['←', '→'] },
      { desc: 'Move between cards',   keys: ['↑', '↓'] },
      { desc: 'Open card detail',     keys: ['↵'] },
    ],
  },
  {
    label: 'Selection',
    items: [
      { desc: 'Toggle card selected', keys: ['Space'] },
      { desc: 'Enter select mode',    keys: ['S'] },
      { desc: 'Exit / clear focus',   keys: ['Esc'] },
    ],
  },
  {
    label: 'Board',
    items: [
      { desc: 'Toggle activity feed',     keys: ['A'] },
      { desc: 'Learning Loop panel',      keys: ['L'] },
      { desc: 'Column capacity limits',   keys: ['C'] },
      { desc: 'Refresh from server',      keys: ['R'] },
      { desc: 'Keyboard shortcuts',       keys: ['?'] },
    ],
  },
] as const;

// ── 9B: ShortcutLegend component ──────────────────────────────────────────────
function ShortcutLegend({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      key="shortcut-legend"
      initial={{ opacity: 0, y: 18, scale: 0.94 }}
      animate={{ opacity: 1, y: 0,  scale: 1    }}
      exit={{   opacity: 0, y: 18, scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      className="fixed bottom-6 right-6 z-50 flex flex-col overflow-hidden"
      style={{
        width: '280px',
        background: 'linear-gradient(180deg, #0D0D1A 0%, #09090F 100%)',
        border:      '1px solid rgba(255,255,255,0.08)',
        borderRadius: '16px',
        boxShadow:   '0 24px 64px rgba(0,0,0,0.65), 0 0 0 1px rgba(139,92,246,0.1)',
      }}
    >
      {/* Header */}
      <div
        className="px-4 py-3 flex items-center justify-between flex-shrink-0"
        style={{
          background:   'linear-gradient(135deg, rgba(139,92,246,0.09), transparent 60%)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <div className="flex items-center gap-2">
          <Keyboard className="size-3.5 text-[#8B5CF6]" />
          <span className="text-[10px] font-bold text-white tracking-widest uppercase">
            Keyboard Shortcuts
          </span>
        </div>
        <button
          onClick={onClose}
          className="size-6 flex items-center justify-center rounded-md text-gray-600 hover:text-white transition-colors"
          style={{ background: 'rgba(255,255,255,0.04)' }}
        >
          <XIcon className="size-3" />
        </button>
      </div>

      {/* Groups */}
      <div className="px-4 py-3 space-y-3.5">
        {SHORTCUT_GROUPS.map(group => (
          <div key={group.label}>
            <p className="text-[9px] font-bold text-gray-600 uppercase tracking-widest mb-2">
              {group.label}
            </p>
            <div className="space-y-1.5">
              {group.items.map(item => (
                <div key={item.desc} className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-gray-500 leading-tight">{item.desc}</span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {item.keys.map(k => (
                      <kbd
                        key={k}
                        className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded text-[#C4B5FD] text-center"
                        style={{
                          background:  'rgba(139,92,246,0.15)',
                          border:      '1px solid rgba(139,92,246,0.3)',
                          minWidth:    k.length > 1 ? 'auto' : 22,
                          display:     'inline-block',
                        }}
                      >
                        {k}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div
        className="px-4 py-2 flex-shrink-0"
        style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
      >
        <p className="text-[9px] text-gray-700 text-center">
          Press <span className="text-gray-600 font-mono font-bold">?</span> to toggle ·
          <span className="text-gray-600 font-mono font-bold"> Esc</span> to dismiss
        </p>
      </div>
    </motion.div>
  );
}

// ── 10B: CapacityConfigPanel ───────────────────────────────────────────────────

/** Inline capacity editor — sits between toolbar and board like the Loop panel */
function CapacityConfigPanel({
  capacities,
  onUpdate,
  onClose,
  saveStatus,
}: {
  capacities:  Record<string, number>;
  onUpdate:    (colId: string, val: number) => void;
  onClose:     () => void;
  saveStatus:  'idle' | 'saving' | 'saved' | 'error';
}) {
  const editableCols = PIPELINE_COLUMNS.filter(c => !c.triggersOutcome);

  return (
    <motion.div
      key="cap-panel"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{   opacity: 0, height: 0 }}
      transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
      className="overflow-hidden mb-4"
    >
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: 'linear-gradient(180deg, rgba(251,146,60,0.05) 0%, rgba(10,10,15,0.97) 100%)',
          border:     '1px solid rgba(251,146,60,0.18)',
          boxShadow:  '0 4px 24px rgba(251,146,60,0.06)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="size-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(251,146,60,0.12)', border: '1px solid rgba(251,146,60,0.25)' }}
            >
              <Gauge className="size-3.5 text-[#FB923C]" />
            </div>
            <div>
              <span className="text-xs font-bold text-white tracking-wide">COLUMN CAPACITY</span>
              <span className="ml-2 text-[9px] text-gray-600">Max cards per active stage · 0 = unlimited</span>
            </div>
          </div>
          <button
            onClick={onClose}
            title="Close capacity panel"
            className="flex items-center justify-center size-[26px] rounded-lg text-gray-600 hover:text-white transition-colors"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <XIcon className="size-3" />
          </button>
        </div>

        {/* Grid of column steppers */}
        <div className="px-4 py-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {editableCols.map(col => {
            const val       = capacities[col.id] ?? 0;
            const unlimited = val === 0;
            return (
              <div
                key={col.id}
                className="rounded-xl p-3 flex flex-col gap-2"
                style={{
                  background: unlimited ? 'rgba(255,255,255,0.02)' : `${col.color}09`,
                  border:     `1px solid ${unlimited ? 'rgba(255,255,255,0.07)' : col.color + '30'}`,
                }}
              >
                {/* Column name row */}
                <div className="flex items-center gap-1.5">
                  <col.Icon className="size-3 flex-shrink-0" style={{ color: col.color }} />
                  <span className="text-[10px] font-semibold text-white leading-tight truncate">
                    {col.label}
                  </span>
                </div>

                {/* Stepper row */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => onUpdate(col.id, Math.max(0, val - 1))}
                    className="size-6 rounded-lg flex items-center justify-center text-xs font-bold transition-all"
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      border:     '1px solid rgba(255,255,255,0.1)',
                      color:      '#9CA3AF',
                    }}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={0}
                    max={999}
                    value={val}
                    onChange={e => {
                      const n = parseInt(e.target.value, 10);
                      if (!isNaN(n) && n >= 0) onUpdate(col.id, n);
                    }}
                    className="flex-1 min-w-0 text-center text-xs font-bold rounded-lg py-0.5 focus:outline-none transition-colors"
                    style={{
                      background:  'rgba(255,255,255,0.05)',
                      border:      `1px solid ${unlimited ? 'rgba(255,255,255,0.1)' : col.color + '45'}`,
                      color:       unlimited ? '#6B7280' : col.color,
                    }}
                  />
                  <button
                    onClick={() => onUpdate(col.id, val + 1)}
                    className="size-6 rounded-lg flex items-center justify-center text-xs font-bold transition-all"
                    style={{
                      background: `${col.color}15`,
                      border:     `1px solid ${col.color}35`,
                      color:      col.color,
                    }}
                  >
                    +
                  </button>
                </div>

                {/* Status label */}
                <span
                  className="text-[9px] font-semibold text-center"
                  style={{ color: unlimited ? '#4B5563' : col.color }}
                >
                  {unlimited ? 'Unlimited' : `Max ${val} cards`}
                </span>
              </div>
            );
          })}
        </div>

        {/* Footer: save indicator + reset */}
        <div
          className="px-4 py-2 flex items-center justify-between gap-3"
          style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
        >
          {/* Save status */}
          <p className="text-[9px] flex items-center gap-1.5">
            {saveStatus === 'idle'   && <span className="text-gray-600">Auto-saved to team workspace</span>}
            {saveStatus === 'saving' && <span className="contents"><span className="size-2 rounded-full bg-[#FB923C] animate-pulse inline-block" /><span className="text-[#FB923C]">Saving…</span></span>}
            {saveStatus === 'saved'  && <span className="contents"><span className="size-2 rounded-full bg-[#10B981] inline-block" /><span className="text-[#10B981]">Saved ✓</span></span>}
            {saveStatus === 'error'  && <span className="contents"><span className="size-2 rounded-full bg-[#FD4438] inline-block" /><span className="text-[#FD4438]">Save failed — retry</span></span>}
          </p>
          <button
            onClick={() =>
              PIPELINE_COLUMNS.filter(c => !c.triggersOutcome).forEach(c =>
                onUpdate(c.id, COLUMN_CAPACITY_DEFAULTS[c.id] ?? 0)
              )
            }
            className="text-[9px] text-gray-700 hover:text-gray-400 transition-colors flex-shrink-0"
          >
            Reset defaults
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ── 9A: Loss Report CSV export ────────────────────────────────────────────────

/** Safely wrap a cell value in CSV quotes only when necessary */
function csvEscape(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (/[,"\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Compile a LearningLoopData snapshot into a multi-section CSV string.
 * Sections: Summary · Top Loss Reasons · Improvement Areas ·
 *           Performance by Industry · Score Band Analysis · Recent Outcomes
 */
function generateLossReportCSV(data: LearningLoopData): string {
  const rows: string[]   = [];
  const row  = (...cells: (string | number | null | undefined)[]) => rows.push(cells.map(csvEscape).join(','));
  const blank   = () => rows.push('');
  const section = (title: string) => { blank(); rows.push(title); };

  // ── Title block ────────────────────────────────────────────────────────────
  rows.push('CORTEX LOSS INTELLIGENCE REPORT');
  row('Generated', new Date().toISOString().slice(0, 10));
  row('Scope', 'All logged outcomes — all time');

  // ── Summary ────────────────────────────────────────────────────────────────
  section('SUMMARY');
  row('Total Outcomes',       data.totalOutcomes);
  row('Total Losses',         data.totalLost);
  row('Total Wins',           data.totalConverted);
  row('Conversion Rate',      `${data.conversionRate.toFixed(1)}%`);
  row('Total Revenue Won',    data.totalRevenue > 0 ? `$${data.totalRevenue.toLocaleString()}` : '$0');
  if (data.avgDealSize > 0) row('Average Deal Size',  `$${Math.round(data.avgDealSize).toLocaleString()}`);
  if (data.recommendationAccuracy !== null)
    row('Recommendation Accuracy', `${data.recommendationAccuracy}%`);
  if (data.avgDaysToClose !== null)
    row('Average Days to Close', `${data.avgDaysToClose} days`);

  // ── Top Loss Reasons ───────────────────────────────────────────────────────
  section('TOP LOSS REASONS');
  row('Rank', 'Reason', 'Count', '% of Losses');
  data.topLostReasons.forEach((r, i) => {
    const label = REASON_MAP[r.reason] || r.reason;
    const share = data.totalLost > 0
      ? ((r.count / data.totalLost) * 100).toFixed(1)
      : '—';
    row(i + 1, label, r.count, share);
  });

  // ── Improvement Areas ──────────────────────────────────────────────────────
  section('IMPROVEMENT AREAS FLAGGED');
  row('Rank', 'Area', 'Times Flagged');
  data.improvementAreas.forEach((a, i) => row(i + 1, a.area, a.count));

  // ── By Industry ───────────────────────────────────────────────────────────
  section('PERFORMANCE BY INDUSTRY');
  row('Industry', 'Total Deals', 'Wins', 'Losses', 'Win Rate (%)', 'Avg Deal Size ($)');
  data.byIndustry.forEach(ind => {
    row(
      ind.industry,
      ind.total,
      ind.converted,
      ind.total - ind.converted,
      ind.conversionRate.toFixed(1),
      Math.round(ind.avgDealSize),
    );
  });

  // ── Score Band Analysis ────────────────────────────────────────────────────
  section('SCORE BAND ANALYSIS');
  row('Band', 'Total Outcomes', 'Wins', 'Win Rate (%)');
  [
    { label: 'High Score (70–100)', band: data.scoreCorrelation.highScore },
    { label: 'Mid Score  (40–69)',  band: data.scoreCorrelation.midScore  },
    { label: 'Low Score  (0–39)',   band: data.scoreCorrelation.lowScore  },
  ].forEach(({ label, band }) => {
    row(label, band.total, band.converted, band.rate !== null ? band.rate.toFixed(1) : null);
  });

  // ── Recent Outcomes ────────────────────────────────────────────────────────
  if (data.recentOutcomes.length > 0) {
    section('RECENT OUTCOMES (most recent first)');
    row('Date', 'Company', 'Industry', 'Result', 'Value ($)', 'Recommended Service', 'Rec. Worked', 'AI Score');
    data.recentOutcomes.forEach(o => {
      row(
        new Date(o.loggedAt).toISOString().slice(0, 10),
        o.company,
        o.industry,
        o.didConvert ? 'WON' : 'LOST',
        o.conversionValue ? Math.round(o.conversionValue) : null,
        o.recommendedService,
        o.recommendationWorked === null ? null : o.recommendationWorked ? 'Yes' : 'No',
        o.aiScore,
      );
    });
  }

  blank();
  rows.push('--- END OF REPORT ---');
  rows.push('Generated by CORTEX Decision Intelligence System');
  return rows.join('\n');
}

/** Trigger a browser file download from a plain-text string */
function downloadCSV(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href     = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ── PipelineStats ──────────────────────────────────────────────────────────────
function PipelineStats({ leads, outcomesMap }: { leads: Lead[]; outcomesMap: OutcomeMap }) {
  const wins         = Object.values(outcomesMap).filter(o =>  o.didConvert).length;
  const losses       = Object.values(outcomesMap).filter(o => !o.didConvert).length;
  const total        = wins + losses;
  const convRate     = total > 0 ? Math.round((wins / total) * 100) : null;
  const totalRevenue = Object.values(outcomesMap).filter(o => o.didConvert).reduce((s, o) => s + (o.conversionValue || 0), 0);

  return (
    <div className="flex items-center gap-4 flex-wrap">
      {[
        { label: 'In Pipeline', value: leads.length,   color: '#8B5CF6' },
        { label: 'Wins',        value: wins,            color: '#10B981' },
        { label: 'Losses',      value: losses,          color: '#FD4438' },
        { label: 'Conv. Rate',  value: convRate !== null ? `${convRate}%` : '–', color: convRate !== null ? (convRate >= 50 ? '#10B981' : '#FB923C') : '#6B7280' },
        { label: 'Revenue',     value: totalRevenue > 0 ? (totalRevenue >= 1000000 ? `$${(totalRevenue / 1000000).toFixed(1)}M` : `$${Math.round(totalRevenue / 1000)}K`) : '$–', color: '#06D7F6' },
      ].map(s => (
        <div key={s.label} className="flex items-center gap-2">
          <div className="size-1.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
          <span className="text-xs text-gray-500">{s.label}:</span>
          <span className="text-xs font-bold" style={{ color: s.color }}>{s.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── 10A: Inline Learning Loop Panel ───────────────────────────────────────────

function fmtMoney(n: number): string {
  if (n <= 0)         return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

/** SVG win-rate ring — no Recharts, pure SVG */
function LoopMiniDonut({ won, lost }: { won: number; lost: number }) {
  const total   = won + lost;
  const r = 34, cx = 44, cy = 44;
  const circ    = 2 * Math.PI * r;
  const winRate = total > 0 ? won / total : 0;
  const wonLen  = circ * winRate;
  const ringColor = winRate >= 0.6 ? '#10B981' : winRate >= 0.4 ? '#FB923C' : '#FD4438';

  return (
    <div className="relative flex-shrink-0" style={{ width: 88, height: 88 }}>
      <svg width="88" height="88" viewBox="0 0 88 88">
        {/* Track */}
        <circle cx={cx} cy={cy} r={r} fill="none"
          stroke="rgba(255,255,255,0.07)" strokeWidth="10" />
        {/* Win arc */}
        {total > 0 && (
          <circle cx={cx} cy={cy} r={r} fill="none"
            stroke={ringColor} strokeWidth="10"
            strokeDasharray={`${wonLen} ${circ - wonLen}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        )}
        {/* Center text */}
        <text x={cx} y={cy - 5} textAnchor="middle" fill="white" fontSize="14"
          fontWeight="700" fontFamily="Inter, system-ui, sans-serif">
          {total === 0 ? '—' : `${Math.round(winRate * 100)}%`}
        </text>
        <text x={cx} y={cy + 8} textAnchor="middle" fill="#6B7280" fontSize="7"
          letterSpacing="0.08em" fontFamily="Inter, system-ui, sans-serif">
          WIN RATE
        </text>
      </svg>
    </div>
  );
}

/** Compact KPI chip */
function LoopKPI({ label, value, color, sub }: {
  label: string; value: string; color: string; sub?: string;
}) {
  return (
    <div className="flex flex-col gap-1 px-3 py-2.5 rounded-xl"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <span className="text-[19px] font-bold leading-none" style={{ color }}>{value}</span>
      <span className="text-[10px] font-semibold text-white">{label}</span>
      {sub && <span className="text-[9px] text-gray-600 leading-tight">{sub}</span>}
      <div className="h-px rounded-full mt-0.5"
        style={{ background: `linear-gradient(90deg, ${color}50, transparent)` }} />
    </div>
  );
}

/** Horizontal CSS bar for loss reasons */
function LoopLossBar({ label, count, maxCount, color }: {
  label: string; count: number; maxCount: number; color: string;
}) {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-gray-400 truncate">{label}</span>
        <span className="text-[10px] font-bold flex-shrink-0" style={{ color }}>{count}×</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.05)' }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.55, ease: 'easeOut' }}
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${color}, ${color}80)` }}
        />
      </div>
    </div>
  );
}

/** Compact animated score-band row */
function LoopScoreBand({ label, rate, total, color, i }: {
  label: string; rate: number | null; total: number; color: string; i: number;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-mono text-gray-500">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-gray-700">{total} deals</span>
          <span className="text-[10px] font-bold w-8 text-right"
            style={{ color: rate === null ? '#4B5563' : color }}>
            {rate === null ? '—' : `${rate}%`}
          </span>
        </div>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.05)' }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${rate ?? 0}%` }}
          transition={{ duration: 0.65, delay: i * 0.1, ease: 'easeOut' }}
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${color}, ${color}80)` }}
        />
      </div>
    </div>
  );
}

const LOOP_LOSS_PALETTE = ['#FD4438', '#E84040', '#D44848', '#C05050'];

/** The full collapsible intelligence panel rendered between toolbar and board */
function InlineLearningLoopPanel({
  data, status, onRefresh, onClose, onOpenFull, lastRefreshedAt,
}: {
  data:            LearningLoopData | null;
  status:          'idle' | 'loading' | 'error' | 'ready';
  onRefresh:       () => void;
  onClose:         () => void;
  onOpenFull?:     () => void;
  lastRefreshedAt: number | null;
}) {
  return (
    <motion.div
      key="loop-panel"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{   opacity: 0, height: 0 }}
      transition={{ duration: 0.26, ease: [0.4, 0, 0.2, 1] }}
      className="overflow-hidden mb-4"
    >
      <div className="rounded-2xl overflow-hidden"
        style={{
          background: 'linear-gradient(180deg, rgba(16,185,129,0.05) 0%, rgba(10,10,15,0.97) 100%)',
          border:     '1px solid rgba(16,185,129,0.18)',
          boxShadow:  '0 4px 24px rgba(16,185,129,0.06)',
        }}>

        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(16,185,129,0.13)', border: '1px solid rgba(16,185,129,0.25)' }}>
              <Brain className="size-3.5 text-[#10B981]" />
            </div>
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="text-xs font-bold text-white tracking-wide">LEARNING LOOP</span>
              <span className="text-[9px] text-gray-600">Pattern intelligence</span>
              {data && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                  style={{ background: 'rgba(16,185,129,0.1)', color: '#10B981', border: '1px solid rgba(16,185,129,0.22)' }}
                >
                  {data.totalOutcomes} outcome{data.totalOutcomes !== 1 ? 's' : ''}
                </motion.span>
              )}
              {lastRefreshedAt && (
                <span className="text-[9px] text-gray-700 flex-shrink-0">
                  Updated <LiveClock ts={lastRefreshedAt} />
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
            {onOpenFull && (
              <button
                onClick={onOpenFull}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-all"
                style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', color: '#10B981' }}
              >
                Full Report <ArrowRight className="size-2.5" />
              </button>
            )}
            <button
              onClick={onRefresh}
              disabled={status === 'loading'}
              title="Refresh intelligence data"
              className="flex items-center justify-center size-[26px] rounded-lg text-gray-600 hover:text-gray-300 transition-colors disabled:opacity-40"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
            >
              <RefreshCw className={`size-3 ${status === 'loading' ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              title="Close (L)"
              className="flex items-center justify-center size-[26px] rounded-lg text-gray-600 hover:text-white transition-colors"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
            >
              <XIcon className="size-3" />
            </button>
          </div>
        </div>

        {/* ── Body ──────────────────────────────────────────────────────── */}
        <div className="px-4 py-4">

          {/* Loading */}
          {status === 'loading' && (
            <div className="flex items-center justify-center gap-3 py-8">
              <Brain className="size-5 text-[#10B981] animate-pulse" />
              <span className="text-xs text-gray-500">Aggregating intelligence data…</span>
            </div>
          )}

          {/* Error / empty */}
          {(status === 'error' || status === 'idle') && (
            <div className="flex items-center gap-3 py-6">
              <AlertTriangle className="size-4 text-[#D97706] flex-shrink-0" />
              <span className="text-[11px] text-gray-500">
                No outcome data yet — drop a lead on{' '}
                <span className="text-[#10B981] font-semibold">Converted</span> or{' '}
                <span className="text-[#FD4438] font-semibold">Lost</span> to start the loop.
              </span>
              {status === 'error' && (
                <button onClick={onRefresh} className="text-[10px] text-[#8B5CF6] hover:underline flex-shrink-0">Retry</button>
              )}
            </div>
          )}

          {/* Ready */}
          {status === 'ready' && data && (
            <div className="space-y-4">

              {/* ── KPI strip ─────────────────────────────────────────── */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                <LoopKPI
                  label="Outcomes" color="#8B5CF6"
                  value={String(data.totalOutcomes)}
                  sub={`${data.totalConverted} won · ${data.totalLost} lost`}
                />
                <LoopKPI
                  label="Win Rate"
                  color={data.conversionRate >= 60 ? '#10B981' : data.conversionRate >= 40 ? '#FB923C' : '#FD4438'}
                  value={`${data.conversionRate}%`}
                  sub={`${data.totalConverted} of ${data.totalOutcomes} deals`}
                />
                <LoopKPI
                  label="Revenue Won" color="#06D7F6"
                  value={fmtMoney(data.totalRevenue)}
                  sub={data.avgDealSize > 0 ? `Avg ${fmtMoney(data.avgDealSize)}` : 'No deal values yet'}
                />
                <LoopKPI
                  label="Rec. Accuracy" color="#FB923C"
                  value={data.recommendationAccuracy !== null ? `${data.recommendationAccuracy}%` : 'N/A'}
                  sub={data.avgDaysToClose !== null ? `Avg ${data.avgDaysToClose}d to close` : 'Insufficient data'}
                />
              </div>

              {/* ── Row 2: Donut + Loss Reasons ───────────────────────── */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

                {/* Win/loss donut + legend */}
                <div className="flex items-center gap-4 p-3 rounded-xl"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <LoopMiniDonut won={data.totalConverted} lost={data.totalLost} />
                  <div className="flex flex-col gap-2 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="size-2 rounded-full flex-shrink-0" style={{ background: '#10B981' }} />
                      <span className="text-[11px] text-gray-400 flex-1">Won</span>
                      <span className="text-[12px] font-bold text-[#10B981]">{data.totalConverted}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="size-2 rounded-full flex-shrink-0" style={{ background: '#FD4438' }} />
                      <span className="text-[11px] text-gray-400 flex-1">Lost</span>
                      <span className="text-[12px] font-bold text-[#FD4438]">{data.totalLost}</span>
                    </div>
                    {data.totalRevenue > 0 && (
                      <div className="px-2 py-1 rounded-lg text-[10px] mt-1"
                        style={{ background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.15)' }}>
                        <span className="text-gray-500">Revenue: </span>
                        <span className="text-[#10B981] font-bold">{fmtMoney(data.totalRevenue)}</span>
                        {data.avgDealSize > 0 && (
                          <span className="text-gray-600"> · avg {fmtMoney(data.avgDealSize)}</span>
                        )}
                      </div>
                    )}
                    {data.avgDaysToClose !== null && (
                      <div className="px-2 py-1 rounded-lg text-[10px]"
                        style={{ background: 'rgba(6,215,246,0.05)', border: '1px solid rgba(6,215,246,0.12)' }}>
                        <span className="text-gray-500">Avg close: </span>
                        <span className="text-[#06D7F6] font-bold">{data.avgDaysToClose}d</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Top loss reasons */}
                <div className="p-3 rounded-xl space-y-2.5"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <p className="text-[9px] font-bold text-gray-600 uppercase tracking-widest">
                    Top Loss Reasons
                  </p>
                  {data.topLostReasons.length === 0 ? (
                    <p className="text-[10px] text-gray-700">No losses logged yet</p>
                  ) : (
                    data.topLostReasons.slice(0, 4).map((r, i) => (
                      <LoopLossBar
                        key={r.reason}
                        label={REASON_MAP[r.reason] || r.reason}
                        count={r.count}
                        maxCount={data.topLostReasons[0]?.count || 1}
                        color={LOOP_LOSS_PALETTE[Math.min(i, LOOP_LOSS_PALETTE.length - 1)]}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* ── Row 3: Score bands + Improvement tags + Recent ─────── */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

                {/* Score bands */}
                <div className="p-3 rounded-xl space-y-2.5"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <p className="text-[9px] font-bold text-gray-600 uppercase tracking-widest">
                    Score Band Win Rate
                  </p>
                  <LoopScoreBand
                    label={`High · ${data.scoreCorrelation.highScore.range}`}
                    rate={data.scoreCorrelation.highScore.rate}
                    total={data.scoreCorrelation.highScore.total}
                    color="#10B981" i={0}
                  />
                  <LoopScoreBand
                    label={`Mid  · ${data.scoreCorrelation.midScore.range}`}
                    rate={data.scoreCorrelation.midScore.rate}
                    total={data.scoreCorrelation.midScore.total}
                    color="#FB923C" i={1}
                  />
                  <LoopScoreBand
                    label={`Low  · ${data.scoreCorrelation.lowScore.range}`}
                    rate={data.scoreCorrelation.lowScore.rate}
                    total={data.scoreCorrelation.lowScore.total}
                    color="#FD4438" i={2}
                  />
                  {data.scoreCorrelation.highScore.rate !== null &&
                   data.scoreCorrelation.lowScore.rate  !== null && (
                    <motion.p
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
                      className="text-[9px] text-gray-600 leading-snug pt-0.5"
                    >
                      {(data.scoreCorrelation.highScore.rate ?? 0) > (data.scoreCorrelation.lowScore.rate ?? 0)
                        ? '✓ High-score leads convert better — AI calibration confirmed.'
                        : 'Flat rate across bands — consider refining scoring weights.'}
                    </motion.p>
                  )}
                </div>

                {/* Improvement tags + most recent outcomes */}
                <div className="p-3 rounded-xl space-y-3"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>

                  {data.improvementAreas.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[9px] font-bold text-gray-600 uppercase tracking-widest">
                        Improvement Votes
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {data.improvementAreas.slice(0, 5).map((area, i) => {
                          const max   = data.improvementAreas[0]?.count || 1;
                          const ratio = area.count / max;
                          return (
                            <span key={i}
                              className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                              title={`Flagged ${area.count}×`}
                              style={{
                                background: `rgba(251,146,60,${0.07 + ratio * 0.1})`,
                                border:     `1px solid rgba(251,146,60,${0.2 + ratio * 0.2})`,
                                color:      `rgba(251,146,60,${0.6 + ratio * 0.4})`,
                              }}
                            >
                              {area.area} {area.count}×
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {data.recentOutcomes.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[9px] font-bold text-gray-600 uppercase tracking-widest">
                        Most Recent Outcomes
                      </p>
                      {data.recentOutcomes.slice(0, 3).map((o, i) => (
                        <motion.div
                          key={o.submissionId}
                          initial={{ opacity: 0, x: 6 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.07 }}
                          className="flex items-center gap-2 py-1.5"
                          style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                        >
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                            style={{
                              background: o.didConvert ? 'rgba(16,185,129,0.12)' : 'rgba(253,68,56,0.1)',
                              color:      o.didConvert ? '#10B981' : '#FD4438',
                            }}>
                            {o.didConvert ? 'WON' : 'LOST'}
                          </span>
                          <span className="text-[10px] text-white font-medium truncate flex-1">{o.company}</span>
                          {o.conversionValue && o.didConvert && (
                            <span className="text-[9px] font-bold text-[#06D7F6] flex-shrink-0">
                              {fmtMoney(o.conversionValue)}
                            </span>
                          )}
                          {o.aiScore > 0 && (
                            <span className="text-[9px] font-bold flex-shrink-0"
                              style={{ color: o.aiScore >= 75 ? '#10B981' : o.aiScore >= 50 ? '#FB923C' : '#FD4438' }}>
                              {o.aiScore}
                            </span>
                          )}
                        </motion.div>
                      ))}
                    </div>
                  )}

                </div>
              </div>

            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ── Main PipelineKanban ────────────────────────────────────────────────────────
export interface PipelineKanbanProps {
  leads:          Lead[];
  cortexStatus:   Record<string, CortexStatusEntry>;
  outcomesMap:    OutcomeMap;
  accessToken?:   string;
  onSelectLead:   (id: string) => void;
  onOutcomeLogged?: (leadId: string, toColumnId: string, payload: OutcomePayload, localOutcome: OutcomeMap[string]) => void;
  onStatusChanged?: (leadId: string, toColumnId: string) => void;
  /** 10A: navigate to the full standalone LearningLoopPanel */
  onViewLearningLoop?: () => void;
}

export function PipelineKanban({
  leads, cortexStatus, outcomesMap: outcomesMapProp,
  accessToken, onSelectLead, onOutcomeLogged, onStatusChanged,
  onViewLearningLoop,
}: PipelineKanbanProps) {

  // ── 11B: AI-score history — records every unique score value per lead ────────
  // Updated synchronously during render so cards always see the freshest data.
  // Maps leadId → [oldest … newest] snapshot array, capped at 8 entries.
  const scoreHistoryRef = useRef<Record<string, number[]>>({});
  Object.entries(cortexStatus).forEach(([leadId, entry]) => {
    const prev = scoreHistoryRef.current[leadId] ?? [];
    if (prev[prev.length - 1] !== entry.aiScore) {
      scoreHistoryRef.current[leadId] = [...prev, entry.aiScore].slice(-8);
    }
  });

  // ── 6C position persistence ────────────────────────────────────────────────
  const [positions,       setPositions]       = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    leads.forEach(l => { m[l.id] = l.status; });
    return m;
  });
  const [localOutcomes,   setLocalOutcomes]   = useState<OutcomeMap>(outcomesMapProp);
  const [savingIds,       setSavingIds]       = useState<Set<string>>(new Set());
  const [pendingDrop,     setPendingDrop]     = useState<PendingDrop | null>(null);

  type SyncStatus = 'loading' | 'idle' | 'saving' | 'saved' | 'error';
  const [syncStatus,      setSyncStatus]      = useState<SyncStatus>(accessToken ? 'loading' : 'idle');
  const [syncError,       setSyncError]       = useState<string | null>(null);
  const [positionsLoaded, setPositionsLoaded] = useState(!accessToken);

  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markSaved = () => {
    setSyncStatus('saved');
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSyncStatus('idle'), 2500);
  };

  // ── 7B multi-select ────────────────────────────────────────────────────────
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds,  setSelectedIds]  = useState<Set<string>>(new Set());
  const enterSelectMode = () => setIsSelectMode(true);
  const exitSelectMode  = () => { setIsSelectMode(false); setSelectedIds(new Set()); };
  const toggleSelect    = useCallback((id: string) => {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);
  const clearSelection = () => setSelectedIds(new Set());

  // ── 8B: Column-level select-all (auto-enters select mode) ─────────────────
  const handleColumnSelectAll = useCallback((columnLeadIds: string[]) => {
    // Clicking a column checkbox while not in select mode → enter it automatically
    setIsSelectMode(true);
    setSelectedIds(prev => {
      const next = new Set(prev);
      const colAllSelected = columnLeadIds.length > 0
        && columnLeadIds.every(id => next.has(id));
      if (colAllSelected) {
        // All already selected → deselect the whole column
        columnLeadIds.forEach(id => next.delete(id));
      } else {
        // Partial or none → select everything in this column
        columnLeadIds.forEach(id => next.add(id));
      }
      return next;
    });
  }, []);

  // ── 9A: Loss report export ────────────────────────────────────────────────
  const [exportStatus, setExportStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const exportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleExportLossReport = useCallback(async () => {
    if (!isBackendEnabled() || !accessToken || exportStatus === 'loading') return;
    setExportStatus('loading');
    try {
      const res = await getLearningLoop(accessToken);
      if (res.isEmpty || !res.data) {
        setExportStatus('error');
        exportTimerRef.current = setTimeout(() => setExportStatus('idle'), 2500);
        return;
      }
      const csv  = generateLossReportCSV(res.data);
      const date = new Date().toISOString().slice(0, 10);
      downloadCSV(csv, `cortex-loss-report-${date}.csv`);
      setExportStatus('success');
      exportTimerRef.current = setTimeout(() => setExportStatus('idle'), 2500);
    } catch (err) {
      console.error('[Pipeline] Loss report export failed:', err);
      setExportStatus('error');
      exportTimerRef.current = setTimeout(() => setExportStatus('idle'), 2500);
    }
  }, [accessToken, exportStatus]);

  // ── 8C: Activity feed state ────────────────────────────────────────────────
  const [feed,         setFeed]         = useState<ActivityEntry[]>([]);
  const [feedOpen,     setFeedOpen]     = useState(false);
  const [unreadCount,  setUnreadCount]  = useState(0);
  const feedIdRef   = useRef(0);
  const feedOpenRef = useRef(false);
  useEffect(() => { feedOpenRef.current = feedOpen; }, [feedOpen]);

  const pushActivity = useCallback((entry: Omit<ActivityEntry, 'id' | 'ts'>) => {
    const full: ActivityEntry = { id: String(feedIdRef.current++), ts: Date.now(), ...entry };
    setFeed(prev => [full, ...prev].slice(0, 50));
    if (!feedOpenRef.current) setUnreadCount(prev => prev + 1);
  }, []);

  const openFeed  = () => { setFeedOpen(true);  setUnreadCount(0); };
  const closeFeed = () => setFeedOpen(false);

  // ── 9B: Keyboard navigation state ─────────────────────────────────────────
  const [focusedColIdx,  setFocusedColIdx]  = useState<number | null>(null);
  const [focusedCardIdx, setFocusedCardIdx] = useState<number | null>(null);
  const [showShortcuts,  setShowShortcuts]  = useState(false);
  /** Stable reference always updated to the freshest handler closure. */
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});

  // ── 9C: Stale filter ───────────────────────────────────────────────────────
  const [staleFilterActive, setStaleFilterActive] = useState(false);

  // ── 10B / 12B: Column capacity ─────────────────────────────────────────────
  const [columnCapacity,  setColumnCapacity]  = useState<Record<string, number>>({ ...COLUMN_CAPACITY_DEFAULTS });
  const [capPanelOpen,    setCapPanelOpen]    = useState(false);
  const [capSaveStatus,   setCapSaveStatus]   = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const columnCapacityRef = useRef(columnCapacity);
  const capDebounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capSaveTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { columnCapacityRef.current = columnCapacity; }, [columnCapacity]);

  // 12B: Load persisted caps on mount
  useEffect(() => {
    if (!isBackendEnabled()) return;
    if (!accessToken) return;
    getColumnCapacities(accessToken)
      .then(res => {
        if (Object.keys(res.capacities).length > 0) {
          setColumnCapacity(prev => ({ ...COLUMN_CAPACITY_DEFAULTS, ...prev, ...res.capacities }));
        }
      })
      .catch(err => console.error('Load column capacities error:', err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  // 12B: handleCapacityUpdate — immediate local update + debounced KV persist
  const handleCapacityUpdate = useCallback((colId: string, val: number) => {
    const newCaps = { ...columnCapacityRef.current, [colId]: val };
    setColumnCapacity(newCaps);
    if (!isBackendEnabled() || !accessToken) return;
    if (capDebounceRef.current) clearTimeout(capDebounceRef.current);
    capDebounceRef.current = setTimeout(() => {
      setCapSaveStatus('saving');
      saveColumnCapacities(newCaps, accessToken)
        .then(() => {
          setCapSaveStatus('saved');
          if (capSaveTimerRef.current) clearTimeout(capSaveTimerRef.current);
          capSaveTimerRef.current = setTimeout(() => setCapSaveStatus('idle'), 2200);
        })
        .catch(err => {
          console.error('Cap save error:', err);
          setCapSaveStatus('error');
          if (capSaveTimerRef.current) clearTimeout(capSaveTimerRef.current);
          capSaveTimerRef.current = setTimeout(() => setCapSaveStatus('idle'), 3500);
        });
    }, 600);
  }, [accessToken]);

  // ── 13E: Engagement activity summaries ─────────────────────────────────────
  const [engagementMap, setEngagementMap] = useState<Record<string, EngagementEvent | null>>({});
  const engagementLoadedRef = useRef(false);

  // 13E: Load engagement summaries on mount + whenever leads change
  useEffect(() => {
    if (!isBackendEnabled()) return;
    if (!accessToken || leads.length === 0) return;
    const submissionIds = leads.map(l => l.id);
    getEngagementSummary(accessToken, submissionIds)
      .then(res => {
        setEngagementMap(res.summary);
        engagementLoadedRef.current = true;
      })
      .catch(err => console.error('[Pipeline] Engagement summary fetch error:', err));
  }, [accessToken, leads]);

  // ── 13F: Priority map — user can flag/unflag leads as high priority ─────────
  // Initialised lazily from cortexStatus; user toggles override per session.
  const [priorityMap, setPriorityMap] = useState<Record<string, boolean>>({});

  // Seed from cortexStatus when it first populates (only fills entries not yet user-toggled)
  const prioritySeededRef = useRef(false);
  useEffect(() => {
    if (prioritySeededRef.current) return;
    const entries = Object.entries(cortexStatus);
    if (entries.length === 0) return;
    prioritySeededRef.current = true;
    setPriorityMap(prev => {
      const next = { ...prev };
      entries.forEach(([id, entry]) => {
        if (!(id in next)) next[id] = entry.priority === 'high';
      });
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cortexStatus]);

  // 13F: Toggle priority for a single lead + persist to backend
  const handleTogglePriority = useCallback((leadId: string) => {
    setPriorityMap(prev => {
      const next = !prev[leadId];
      if (isBackendEnabled() && accessToken) {
        updateSubmissionStatus(leadId, accessToken, { priority: next ? 'high' : 'medium' })
          .catch(err => console.error('[Kanban 13F] Priority toggle failed:', err));
      }
      return { ...prev, [leadId]: next };
    });
  }, [accessToken]);

  // 13F: Save a quick note inline (no page navigation required)
  const handleAddNote = useCallback(async (
    leadId: string,
    content: string,
    type: 'note' | 'action' | 'flag',
  ) => {
    if (!isBackendEnabled() || !accessToken) return;
    try {
      await addNote(leadId, content, type, accessToken);
    } catch (err) {
      console.error('[Kanban 13F] Quick note save failed:', err);
    }
  }, [accessToken]);

  // ── 10A: Learning Loop inline panel state ─────────────────────────────────
  const [loopOpen,        setLoopOpen]        = useState(false);
  const [loopData,        setLoopData]        = useState<LearningLoopData | null>(null);
  const [loopStatus,      setLoopStatus]      = useState<'idle' | 'loading' | 'error' | 'ready'>('idle');
  const [loopLastRefresh, setLoopLastRefresh] = useState<number | null>(null);
  const loopLoadedRef     = useRef(false);
  /** Stable ref so handleOutcomeConfirm can trigger a silent refresh without dep-chain issues */
  const loadLoopDataRef   = useRef<((silent?: boolean) => void)>(() => {});

  // ── 7C live sync state ─────────────────────────────────────────────────────
  const [remoteChanges, setRemoteChanges] = useState<Map<string, RemoteChange>>(new Map());
  const [pollBanner,    setPollBanner]    = useState<PollBanner | null>(null);
  const [lastPolledAt,  setLastPolledAt]  = useState<number | null>(null);
  const [liveStatus,    setLiveStatus]    = useState<'live' | 'polling' | 'offline' | 'idle'>('idle');
  const [isManualPoll,  setIsManualPoll]  = useState(false);

  // Stable refs so the polling callback never goes stale
  const positionsRef       = useRef(positions);
  const savingIdsRef       = useRef(savingIds);
  const positionsLoadedRef = useRef(positionsLoaded);
  const pendingDropRef     = useRef(pendingDrop);
  const leadsRef           = useRef(leads);

  useEffect(() => { positionsRef.current       = positions;       }, [positions]);
  useEffect(() => { savingIdsRef.current        = savingIds;        }, [savingIds]);
  useEffect(() => { positionsLoadedRef.current  = positionsLoaded;  }, [positionsLoaded]);
  useEffect(() => { pendingDropRef.current      = pendingDrop;      }, [pendingDrop]);
  useEffect(() => { leadsRef.current            = leads;            }, [leads]);

  // Conflict = a card is saving locally AND remote disagrees
  const conflictIds = new Set<string>(
    Array.from(remoteChanges.keys()).filter(id => savingIds.has(id))
  );

  // ── 12A: Live kanban alert detection ───────────────────────────────────────
  // Fires push-once events into DashboardContext so the header bell can show them.
  // firedAlertsRef dedups so the same event never fires twice.
  const { pushKanbanAlert } = useDashboard();
  const firedAlertsRef = useRef<Set<string>>(new Set());

  // ① AI score threshold crossings
  useEffect(() => {
    Object.entries(cortexStatus).forEach(([leadId, entry]) => {
      const lead = leads.find(l => l.id === leadId);
      if (!lead) return;
      if (entry.aiScore <= 38) {
        const key = `score_low:${leadId}:${Math.floor(entry.aiScore / 5)}`;
        if (!firedAlertsRef.current.has(key)) {
          firedAlertsRef.current.add(key);
          pushKanbanAlert({
            kind:        'score_low',
            severity:    'critical',
            title:       'AI Score Critical',
            body:        `${lead.companyName} dropped to ${entry.aiScore} — review urgently`,
            leadId,
            companyName: lead.companyName,
          });
        }
      } else if (entry.aiScore >= 85) {
        const key = `score_high:${leadId}:${Math.floor(entry.aiScore / 5)}`;
        if (!firedAlertsRef.current.has(key)) {
          firedAlertsRef.current.add(key);
          pushKanbanAlert({
            kind:        'score_high',
            severity:    'info',
            title:       'AI Score Elevated',
            body:        `${lead.companyName} scored ${entry.aiScore} — prime engagement window`,
            leadId,
            companyName: lead.companyName,
          });
        }
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cortexStatus]);

  // ② Remote teammate moves
  useEffect(() => {
    remoteChanges.forEach((change, leadId) => {
      const key = `remote_move:${leadId}:${change.toColumn}:${change.detectedAt}`;
      if (!firedAlertsRef.current.has(key)) {
        firedAlertsRef.current.add(key);
        const lead     = leads.find(l => l.id === leadId);
        const colLabel = PIPELINE_COLUMNS.find(c => c.id === change.toColumn)?.label ?? change.toColumn;
        pushKanbanAlert({
          kind:        'remote_move',
          severity:    'info',
          title:       'Card Moved Remotely',
          body:        `${lead?.companyName ?? leadId} → ${colLabel} (teammate)`,
          leadId,
          companyName: lead?.companyName ?? leadId,
        });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteChanges]);

  // ③ Stage conflicts (local save races with remote move)
  useEffect(() => {
    Array.from(remoteChanges.keys())
      .filter(id => savingIds.has(id))
      .forEach(leadId => {
        const key = `conflict:${leadId}`;
        if (!firedAlertsRef.current.has(key)) {
          firedAlertsRef.current.add(key);
          const lead = leads.find(l => l.id === leadId);
          pushKanbanAlert({
            kind:        'conflict',
            severity:    'warning',
            title:       'Stage Conflict',
            body:        `${lead?.companyName ?? leadId} — conflicting position, resolve on the card`,
            leadId,
            companyName: lead?.companyName ?? leadId,
          });
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteChanges, savingIds]);

  // ④ Stale-lead tier escalations (12D)
  // Fires once-per-lead-per-tier-per-session via firedAlertsRef.
  // • tier 2 (14–29 d inactive) → severity 'warning'  · "Lead Going Stale"
  // • tier 3 (30 d+  inactive)  → severity 'critical' · "Lead Gone Silent"
  // Runs on mount and on every leads refresh (30 s poll).
  useEffect(() => {
    leads.forEach(lead => {
      const colId = positionsRef.current[lead.id] ?? lead.status;
      if (colId === 'converted' || colId === 'disqualified') return;

      const tier     = getAgeTier(lead.lastActivityAt);
      const days     = Math.floor((Date.now() - new Date(lead.lastActivityAt).getTime()) / 86_400_000);
      const colLabel = PIPELINE_COLUMNS.find(c => c.id === colId)?.label ?? colId;

      // Tier 2: 14 d+ → warning (fires independently from tier 3)
      if (tier >= 2) {
        const key = `stale_t2:${lead.id}`;
        if (!firedAlertsRef.current.has(key)) {
          firedAlertsRef.current.add(key);
          pushKanbanAlert({
            kind:        'stale_escalation',
            severity:    'warning',
            title:       'Lead Going Stale',
            body:        `${lead.companyName} inactive ${days}d in ${colLabel} — follow up needed`,
            leadId:      lead.id,
            companyName: lead.companyName,
          });
        }
      }

      // Tier 3: 30 d+ → critical escalation (separate key so it fires even after tier-2 alert)
      if (tier >= 3) {
        const key = `stale_t3:${lead.id}`;
        if (!firedAlertsRef.current.has(key)) {
          firedAlertsRef.current.add(key);
          pushKanbanAlert({
            kind:        'stale_escalation',
            severity:    'critical',
            title:       'Lead Gone Silent',
            body:        `${lead.companyName} inactive ${days}d in ${colLabel} — escalate immediately`,
            leadId:      lead.id,
            companyName: lead.companyName,
          });
        }
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads]);

  // ── Load saved positions on mount ──────────────────────────────────────────
  useEffect(() => {
    if (!isBackendEnabled() || !accessToken) { setPositionsLoaded(true); setSyncStatus('idle'); return; }
    setSyncStatus('loading');
    getPipelinePositions(accessToken)
      .then(res => {
        const saved = res.positions || {};
        setPositions(prev => {
          const merged = { ...prev };
          leads.forEach(l => { if (!(l.id in saved)) saved[l.id] = l.status; });
          Object.assign(merged, saved);
          return merged;
        });
        setPositionsLoaded(true);
        setSyncStatus('idle');
      })
      .catch(err => {
        console.warn('[Pipeline] Could not load saved positions:', err);
        setPositionsLoaded(true);
        setSyncStatus('idle');
      });
  }, [accessToken]);

  // ── 7C: Polling logic ──────────────────────────────────────────────────────
  const pollPositions = useCallback(async (manual = false) => {
    if (!isBackendEnabled())      return;
    if (!accessToken)                       return;
    if (!positionsLoadedRef.current)        return;
    if (savingIdsRef.current.size > 0)      return; // skip during our own saves
    if (pendingDropRef.current !== null)    return; // skip while outcome modal is open

    setLiveStatus('polling');
    try {
      const res    = await getPipelinePositions(accessToken);
      const remote = res.positions || {};
      const now    = Date.now();
      const cur    = positionsRef.current;

      const changes: RemoteChange[] = [];
      Object.entries(remote).forEach(([leadId, remoteCol]) => {
        const localCol = cur[leadId];
        // Only flag as remote change if:
        //   • we know this card's position locally
        //   • the server position is different
        //   • the server column is a valid PIPELINE_COLUMN
        if (
          localCol &&
          localCol !== remoteCol &&
          PIPELINE_COLUMNS.some(c => c.id === remoteCol)
        ) {
          changes.push({ leadId, fromColumn: localCol, toColumn: remoteCol, detectedAt: now });
        }
      });

      setLastPolledAt(now);
      setLiveStatus('live');

      if (changes.length > 0) {
        setRemoteChanges(prev => {
          const next = new Map(prev);
          changes.forEach(c => next.set(c.leadId, c));
          return next;
        });
        setPollBanner({ count: changes.length, detectedAt: now });

        // 8C: push one activity entry per remote change
        changes.forEach(c => {
          const lead = leadsRef.current.find(l => l.id === c.leadId);
          pushActivity({
            type:    'remote_sync',
            leadId:  c.leadId,
            company: lead?.companyName,
            fromCol: c.fromColumn,
            toCol:   c.toColumn,
          });
        });
      }
    } catch (err) {
      console.warn('[Pipeline] Poll failed:', err);
      setLiveStatus('offline');
    } finally {
      if (manual) setIsManualPoll(false);
    }
  }, [accessToken, pushActivity]);

  // ── 7C: 30 s interval + visibilitychange resume ────────────────────────────
  useEffect(() => {
    if (!accessToken || !positionsLoaded) return;

    const intervalId = setInterval(() => pollPositions(), POLL_INTERVAL_MS);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        pollPositions(); // immediate poll when tab regains focus
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [accessToken, positionsLoaded, pollPositions]);

  // ── 7C: Accept / dismiss handlers ─────────────────────────────────────────
  const handleAcceptAll = useCallback(() => {
    setPositions(prev => {
      const next = { ...prev };
      remoteChanges.forEach((change, leadId) => { next[leadId] = change.toColumn; });
      return next;
    });
    setRemoteChanges(new Map());
    setPollBanner(null);
  }, [remoteChanges]);

  const handleAcceptOne = useCallback((leadId: string, toColumnId: string) => {
    setPositions(prev => ({ ...prev, [leadId]: toColumnId }));
    setRemoteChanges(prev => {
      const next = new Map(prev);
      next.delete(leadId);
      if (next.size === 0) setPollBanner(null);
      return next;
    });
  }, []);

  const handleDismissOne = useCallback((leadId: string) => {
    setRemoteChanges(prev => {
      const next = new Map(prev);
      next.delete(leadId);
      if (next.size === 0) setPollBanner(null);
      return next;
    });
  }, []);

  const handleDismissBanner = useCallback(() => {
    setRemoteChanges(new Map());
    setPollBanner(null);
  }, []);

  const handleManualPoll = () => {
    setIsManualPoll(true);
    pollPositions(true);
  };
  // ─────────────────────────────────────────────────────────────────────────

  // ── 10A: Learning Loop data loader ────────────────────────────────────────
  const loadLoopData = useCallback(async (silent = false) => {
    if (!isBackendEnabled() || !accessToken) { setLoopStatus('error'); return; }
    if (!silent) setLoopStatus('loading');
    try {
      const res = await getLearningLoop(accessToken);
      if (res.isEmpty || !res.data) {
        if (!silent) setLoopStatus('error');
      } else {
        setLoopData(res.data);
        setLoopStatus('ready');
        setLoopLastRefresh(Date.now());
        loopLoadedRef.current = true;
      }
    } catch (err) {
      console.error('[Loop] Load failed:', err);
      if (!silent) setLoopStatus('error');
    }
  }, [accessToken]);

  // Keep ref in sync so handleOutcomeConfirm can call without dep-chain issues
  useEffect(() => { loadLoopDataRef.current = (s = false) => loadLoopData(s); }, [loadLoopData]);

  const openLoopPanel = useCallback(() => {
    setLoopOpen(true);
    if (!loopLoadedRef.current || loopStatus === 'idle') loadLoopData();
  }, [loopStatus, loadLoopData]);

  // ── Single-position persist ─────────────────���──────────────────────────────
  const persistPosition = useCallback(async (leadId: string, columnId: string) => {
    if (!isBackendEnabled() || !accessToken) return;
    setSyncStatus('saving'); setSyncError(null);
    try {
      await savePipelinePosition(leadId, columnId, accessToken);
      markSaved();
    } catch (err: any) {
      setSyncError(err.message || 'Sync failed');
      setSyncStatus('error');
    }
  }, [accessToken]);

  const handleRetrySync = useCallback(async () => {
    if (!isBackendEnabled() || !accessToken) return;
    setSyncStatus('saving'); setSyncError(null);
    try {
      await savePipelinePositions(positions, accessToken);
      markSaved();
    } catch (err: any) {
      setSyncError(err.message || 'Retry failed');
      setSyncStatus('error');
    }
  }, [accessToken, positions]);

  const handleResetPositions = useCallback(async () => {
    if (!isBackendEnabled() || !accessToken) return;
    setSyncStatus('saving');
    try {
      await resetPipelinePositions(accessToken);
      const defaults: Record<string, string> = {};
      leads.forEach(l => { defaults[l.id] = l.status; });
      setPositions(defaults);
      markSaved();
      pushActivity({ type: 'reset' }); // 8C
    } catch (err: any) {
      setSyncError(err.message || 'Reset failed');
      setSyncStatus('error');
    }
  }, [accessToken, leads, pushActivity]);

  // Sync positions when leads prop changes
  useEffect(() => {
    setPositions(prev => {
      const next = { ...prev };
      leads.forEach(l => { if (!(l.id in next)) next[l.id] = l.status; });
      return next;
    });
  }, [leads]);

  useEffect(() => { setLocalOutcomes(outcomesMapProp); }, [outcomesMapProp]);

  // ── 7B: Drop handler ──────────────────────────────────────────────────────
  const handleDrop = useCallback((
    leadId: string,
    fromColumnId: string,
    toColumn: PipelineColumnDef,
    selectedLeadIds: string[],
  ) => {
    const isBulk      = selectedLeadIds.length > 1;
    const leadsToMove = isBulk
      ? leads.filter(l => selectedLeadIds.includes(l.id))
      : [leads.find(l => l.id === leadId)].filter(Boolean) as Lead[];

    if (leadsToMove.length === 0) return;

    if (toColumn.triggersOutcome) {
      setPendingDrop({ leads: leadsToMove, toColumn });
      return;
    }

    setPositions(prev => {
      const next = { ...prev };
      leadsToMove.forEach(l => { next[l.id] = toColumn.id; });
      return next;
    });

    if (isBackendEnabled() && accessToken) {
      const idsSet = new Set(leadsToMove.map(l => l.id));
      setSavingIds(prev => new Set([...prev, ...idsSet]));
      const newPositions: Record<string, string> = {};
      leadsToMove.forEach(l => { newPositions[l.id] = toColumn.id; });

      Promise.all([
        ...leadsToMove.map(l => updateSubmissionStatus(l.id, accessToken, { status: toColumn.backendStatus })),
        savePipelinePositions(newPositions, accessToken),
      ])
        .then(() => {
          markSaved();
          leadsToMove.forEach(l => onStatusChanged?.(l.id, toColumn.id));
          if (isBulk) { setSelectedIds(new Set()); setIsSelectMode(false); }
          // Clear any stale remote-change entries for moved cards
          setRemoteChanges(prev => {
            const next = new Map(prev);
            leadsToMove.forEach(l => next.delete(l.id));
            if (next.size === 0) setPollBanner(null);
            return next;
          });
          // 8C: activity event
          if (isBulk) {
            pushActivity({ type: 'bulk_move', companies: leadsToMove.map(l => l.companyName), count: leadsToMove.length, fromCol: fromColumnId, toCol: toColumn.id });
          } else {
            pushActivity({ type: 'move', leadId: leadsToMove[0].id, company: leadsToMove[0].companyName, fromCol: fromColumnId, toCol: toColumn.id });
          }
        })
        .catch(err => {
          console.error('[Pipeline] Move failed:', err);
          setPositions(prev => {
            const next = { ...prev };
            leadsToMove.forEach(l => { next[l.id] = positions[l.id] ?? l.status; });
            return next;
          });
          setSyncError(err.message || 'Move failed');
          setSyncStatus('error');
        })
        .finally(() => setSavingIds(prev => {
          const s = new Set(prev);
          idsSet.forEach(id => s.delete(id));
          return s;
        }));
    } else {
      leadsToMove.forEach(l => onStatusChanged?.(l.id, toColumn.id));
      if (isBulk) { setSelectedIds(new Set()); setIsSelectMode(false); }
      // 8C: activity event (no-auth path)
      if (isBulk) {
        pushActivity({ type: 'bulk_move', companies: leadsToMove.map(l => l.companyName), count: leadsToMove.length, fromCol: fromColumnId, toCol: toColumn.id });
      } else {
        pushActivity({ type: 'move', leadId: leadsToMove[0].id, company: leadsToMove[0].companyName, fromCol: fromColumnId, toCol: toColumn.id });
      }
    }
  }, [leads, accessToken, onStatusChanged, positions, pushActivity]);

  // ── 7B: Outcome confirm (bulk) ─────────────────────────────────────────────
  const handleOutcomeConfirm = useCallback(async (payload: OutcomePayload) => {
    if (!pendingDrop) return;
    const { toColumn, leads: pendingLeads } = pendingDrop;
    const isBulk       = pendingLeads.length > 1;
    const perLeadValue = payload.conversionValue && isBulk
      ? Math.round(payload.conversionValue / pendingLeads.length)
      : payload.conversionValue;

    if (isBackendEnabled() && accessToken) {
      await Promise.all(
        pendingLeads.flatMap(l => [
          logOutcome(l.id, { ...payload, conversionValue: perLeadValue ?? null }, accessToken),
          updateSubmissionStatus(l.id, accessToken, { status: toColumn.backendStatus }),
        ])
      );

      const newPositions: Record<string, string> = {};
      pendingLeads.forEach(l => { newPositions[l.id] = toColumn.id; });
      await savePipelinePositions(newPositions, accessToken);
    }
    markSaved();

    const now = new Date().toISOString();
    setPositions(prev => ({ ...prev, ...newPositions }));
    pendingLeads.forEach(l => {
      const entry: OutcomeMap[string] = {
        didConvert:      payload.didConvert,
        conversionValue: perLeadValue ?? null,
        loggedAt:        now,
      };
      setLocalOutcomes(prev => ({ ...prev, [l.id]: entry }));
      onOutcomeLogged?.(l.id, toColumn.id, { ...payload, conversionValue: perLeadValue ?? null }, entry);
    });

    if (isBulk) { setSelectedIds(new Set()); setIsSelectMode(false); }
    setPendingDrop(null);
    // Clear remote changes for confirmed leads
    setRemoteChanges(prev => {
      const next = new Map(prev);
      pendingLeads.forEach(l => next.delete(l.id));
      if (next.size === 0) setPollBanner(null);
      return next;
    });

    // 10A: silently refresh the inline loop panel after every outcome log
    if (loopLoadedRef.current) loadLoopDataRef.current(true);

    // 8C: activity event — win or loss, single or bulk
    if (payload.didConvert) {
      pushActivity({
        type:      isBulk ? 'bulk_win' : 'win',
        leadId:    !isBulk ? pendingLeads[0].id       : undefined,
        company:   !isBulk ? pendingLeads[0].companyName : undefined,
        companies: isBulk  ? pendingLeads.map(l => l.companyName) : undefined,
        count:     pendingLeads.length,
        value:     payload.conversionValue ?? undefined,
        toCol:     toColumn.id,
      });
    } else {
      pushActivity({
        type:       isBulk ? 'bulk_loss' : 'loss',
        leadId:     !isBulk ? pendingLeads[0].id       : undefined,
        company:    !isBulk ? pendingLeads[0].companyName : undefined,
        companies:  isBulk  ? pendingLeads.map(l => l.companyName) : undefined,
        count:      pendingLeads.length,
        lostReason: payload.lostReason ?? undefined,
        toCol:      toColumn.id,
      });
    }
  }, [pendingDrop, accessToken, onOutcomeLogged, pushActivity]);

  const handleOutcomeCancel = useCallback(() => setPendingDrop(null), []);

  // ── 10C: Quick-move (reuses the full handleDrop path incl. outcome modal) ───
  const handleQuickMove = useCallback((leadId: string, toColId: string) => {
    const toColumn = PIPELINE_COLUMNS.find(c => c.id === toColId);
    if (!toColumn) return;
    const fromColId = positions[leadId] ?? leads.find(l => l.id === leadId)?.status ?? 'new';
    if (toColumn.id === fromColId) return;
    handleDrop(leadId, fromColId, toColumn, [leadId]);
  }, [positions, leads, handleDrop]);

  // Build column → leads map
  const leadsByColumn: Record<string, Lead[]> = {};
  PIPELINE_COLUMNS.forEach(col => { leadsByColumn[col.id] = []; });
  leads.forEach(lead => {
    const colId    = positionsLoaded ? (positions[lead.id] ?? lead.status) : lead.status;
    const validCol = PIPELINE_COLUMNS.find(c => c.id === colId) ? colId : 'new';
    (leadsByColumn[validCol] = leadsByColumn[validCol] || []).push(lead);
  });

  // 10B: count active non-terminal columns at or over their cap
  const overCapCount = PIPELINE_COLUMNS.filter(c => !c.triggersOutcome).filter(c => {
    const cap = columnCapacity[c.id];
    if (!cap) return false;
    return (leadsByColumn[c.id]?.length ?? 0) >= cap;
  }).length;

  // ── 9B: Key handler — "latest ref" pattern ────────────────────────────────
  // Runs after EVERY render; captures the freshest closed-over values (leadsByColumn,
  // focusedColIdx, isSelectMode, pendingDrop, feedOpen, showShortcuts, etc.)
  // so the stable addEventListener below never goes stale.
  useEffect(() => {
    keyHandlerRef.current = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      // Never intercept inside text-input elements or contentEditable
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement).isContentEditable) return;
      // Skip board shortcuts while the outcome modal is open
      if (pendingDrop) return;

      const colCount = PIPELINE_COLUMNS.length;

      switch (e.key) {
        case 'ArrowLeft': {
          e.preventDefault();
          setFocusedColIdx(prev => prev === null ? 0 : Math.max(0, prev - 1));
          setFocusedCardIdx(null);
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          setFocusedColIdx(prev => prev === null ? 0 : Math.min(colCount - 1, prev + 1));
          setFocusedCardIdx(null);
          break;
        }
        case 'ArrowUp': {
          if (focusedColIdx === null) break;
          e.preventDefault();
          const upLeads = leadsByColumn[PIPELINE_COLUMNS[focusedColIdx].id] || [];
          setFocusedCardIdx(prev =>
            prev === null ? upLeads.length - 1 : Math.max(0, prev - 1)
          );
          break;
        }
        case 'ArrowDown': {
          if (focusedColIdx === null) break;
          e.preventDefault();
          const downLeads = leadsByColumn[PIPELINE_COLUMNS[focusedColIdx].id] || [];
          setFocusedCardIdx(prev =>
            prev === null ? 0 : Math.min(downLeads.length - 1, prev + 1)
          );
          break;
        }
        case ' ': {
          // Don't steal Space from focused buttons / links
          if (tag === 'BUTTON' || tag === 'A') return;
          if (focusedColIdx === null || focusedCardIdx === null) break;
          e.preventDefault();
          const spaceLead = (leadsByColumn[PIPELINE_COLUMNS[focusedColIdx].id] || [])[focusedCardIdx];
          if (!spaceLead) break;
          if (!isSelectMode) setIsSelectMode(true);
          toggleSelect(spaceLead.id);
          break;
        }
        case 'Enter': {
          if (tag === 'BUTTON' || tag === 'A') return;
          if (focusedColIdx === null || focusedCardIdx === null) break;
          e.preventDefault();
          const enterLead = (leadsByColumn[PIPELINE_COLUMNS[focusedColIdx].id] || [])[focusedCardIdx];
          if (enterLead) onSelectLead(enterLead.id);
          break;
        }
        case 'l':
        case 'L': {
          e.preventDefault();
          if (loopOpen) { setLoopOpen(false); } else { openLoopPanel(); }
          break;
        }
        case 'c':
        case 'C': {
          e.preventDefault();
          setCapPanelOpen(s => !s);
          break;
        }
        case 'Escape': {
          if (showShortcuts) { setShowShortcuts(false); return; }
          if (capPanelOpen)  { setCapPanelOpen(false); return; }
          if (loopOpen)      { setLoopOpen(false); return; }
          if (feedOpen)      { closeFeed(); return; }
          if (isSelectMode)  { exitSelectMode(); return; }
          if (focusedColIdx !== null) {
            setFocusedColIdx(null);
            setFocusedCardIdx(null);
          }
          break;
        }
        case 's': case 'S': {
          if (isSelectMode) break;
          enterSelectMode();
          break;
        }
        case 'a': case 'A': {
          if (feedOpen) closeFeed(); else openFeed();
          break;
        }
        case '?': {
          setShowShortcuts(s => !s);
          break;
        }
        case 'r': case 'R': {
          if (accessToken && positionsLoaded) handleManualPoll(true);
          break;
        }
      }
    };
  }); // intentionally no dep array — re-runs after every render

  // Stable global listener — registered once, always delegates to the latest handler
  useEffect(() => {
    const handle = (e: KeyboardEvent) => keyHandlerRef.current(e);
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 9B: Auto-scroll focused card into view when card focus changes
  useEffect(() => {
    if (focusedCardIdx === null) return;
    requestAnimationFrame(() => {
      document.querySelector('[data-kb-card-focused="true"]')
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }, [focusedColIdx, focusedCardIdx]);

  // 9B: Auto-scroll focused column into view when column focus changes
  useEffect(() => {
    if (focusedColIdx === null) return;
    requestAnimationFrame(() => {
      document.querySelector('[data-kb-col-focused="true"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    });
  }, [focusedColIdx]);

  const selectionCount = selectedIds.size;

  // 9C: total stale leads across active (non-terminal) columns
  const totalStaleCount = leads.filter(l => {
    const col = positions[l.id] ?? l.status;
    return getAgeTier(l.lastActivityAt) >= 1
      && col !== 'converted' && col !== 'disqualified';
  }).length;

  return (
    <DndProvider backend={HTML5Backend}>
      {/* Keyframe injection */}
      <style>{`
        @keyframes card-remote-pulse {
          0%, 100% { box-shadow: 0 0 0 0   rgba(6,215,246,0.4),   0 1px 3px rgba(0,0,0,0.4); }
          50%       { box-shadow: 0 0 0 5px rgba(6,215,246,0.12),  0 1px 3px rgba(0,0,0,0.4); }
        }
        /* 12C: critical score pulse — slow red throb */
        @keyframes card-score-critical-pulse {
          0%, 100% { box-shadow: 0 0 0 0px rgba(253,68,56,0.5),   0 1px 3px rgba(0,0,0,0.4); }
          50%       { box-shadow: 0 0 0 6px rgba(253,68,56,0.10),  0 1px 3px rgba(0,0,0,0.4); }
        }
        /* 12C: hot score shimmer — gentle green breathe */
        @keyframes card-score-hot-pulse {
          0%, 100% { box-shadow: 0 0 0 0px rgba(16,185,129,0.4),  0 1px 3px rgba(0,0,0,0.4); }
          50%       { box-shadow: 0 0 0 5px rgba(16,185,129,0.08), 0 1px 3px rgba(0,0,0,0.4); }
        }
        /* 10C: show ⋯ trigger on card hover */
        .cortex-card:hover [data-qp-trigger] {
          color:   #6B7280 !important;
          border-color: rgba(255,255,255,0.1) !important;
          background: rgba(255,255,255,0.05) !important;
        }
        .cortex-card:hover [data-qp-trigger]:hover {
          color:   #C4B5FD !important;
          border-color: rgba(139,92,246,0.45) !important;
          background: rgba(139,92,246,0.18) !important;
        }
      `}</style>

      <MultiDragLayer selectedCount={selectionCount} />

      <div className="relative">

        {/* ── 7C: Remote-change banner ────────────────────────────────────── */}
        <AnimatePresence>
          {pollBanner && remoteChanges.size > 0 && (
            <RemoteChangeBanner
              banner={pollBanner}
              remoteChanges={remoteChanges}
              leads={leads}
              onAcceptAll={handleAcceptAll}
              onDismiss={handleDismissBanner}
            />
          )}
        </AnimatePresence>

        {/* ── Toolbar ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">

          {/* Left: stats or selection info */}
          <AnimatePresence mode="wait">
            {isSelectMode ? (
              <motion.div key="select" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}
                className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold"
                  style={{
                    background: selectionCount > 0 ? 'rgba(139,92,246,0.18)' : 'rgba(255,255,255,0.05)',
                    border:     selectionCount > 0 ? '1px solid rgba(139,92,246,0.4)' : '1px solid rgba(255,255,255,0.1)',
                    color:      selectionCount > 0 ? '#C4B5FD' : '#6B7280',
                  }}>
                  <Layers className="size-3" />
                  {selectionCount === 0 ? 'Click cards to select' : `${selectionCount} card${selectionCount !== 1 ? 's' : ''} selected`}
                </div>
                {selectionCount > 0 && (
                  <button onClick={clearSelection}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-gray-500 hover:text-white transition-colors"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <XIcon className="size-3" />Clear
                  </button>
                )}
                {selectionCount > 1 && (
                  <span className="text-[11px] text-gray-600 hidden sm:block">
                    Drag any selected card to move all {selectionCount}
                  </span>
                )}
              </motion.div>
            ) : (
              <motion.div key="stats" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}>
                <PipelineStats leads={leads} outcomesMap={localOutcomes} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Right: controls + live status */}
          <div className="flex items-center gap-2 flex-shrink-0">

            {/* 7C: Live staleness badge */}
            {lastPolledAt && (
              <div className="flex items-center gap-1.5 text-[11px]"
                style={{ color: liveStatus === 'offline' ? '#FD4438' : '#4B5563' }}>
                <span className="size-1.5 rounded-full flex-shrink-0" style={{
                  background: liveStatus === 'live' ? '#10B981' : liveStatus === 'polling' ? '#FB923C' : liveStatus === 'offline' ? '#FD4438' : '#6B7280',
                }} />
                {liveStatus === 'polling'
                  ? 'Syncing…'
                  : liveStatus === 'offline'
                    ? 'Offline'
                    : <LiveClock ts={lastPolledAt} prefix="Live · " />}
              </div>
            )}

            {/* 7C: Manual refresh button */}
            {accessToken && positionsLoaded && (
              <button
                onClick={handleManualPoll}
                disabled={isManualPoll || liveStatus === 'polling'}
                title="Check for board changes now"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-gray-500 hover:text-gray-200 transition-colors disabled:opacity-40"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
              >
                <RefreshCw className={`size-3 ${isManualPoll || liveStatus === 'polling' ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            )}

            {/* 10B: Capacity config toggle */}
            {positionsLoaded && (
              <button
                onClick={() => setCapPanelOpen(s => !s)}
                title={capPanelOpen
                  ? 'Close capacity settings'
                  : overCapCount > 0
                    ? `${overCapCount} column${overCapCount !== 1 ? 's' : ''} at capacity — configure limits`
                    : 'Configure column capacity limits'}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all"
                style={{
                  background: capPanelOpen    ? 'rgba(251,146,60,0.18)' :
                              overCapCount > 0 ? 'rgba(251,146,60,0.1)'  : 'rgba(255,255,255,0.04)',
                  border:     capPanelOpen    ? '1px solid rgba(251,146,60,0.45)' :
                              overCapCount > 0 ? '1px solid rgba(251,146,60,0.3)'  : '1px solid rgba(255,255,255,0.08)',
                  color:      capPanelOpen || overCapCount > 0 ? '#FB923C' : '#6B7280',
                }}
              >
                <Gauge className="size-3" />
                Cap
                {/* Badge: number of over-capacity columns */}
                {!capPanelOpen && overCapCount > 0 && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="flex items-center justify-center text-[9px] font-bold rounded-full"
                    style={{
                      minWidth: 16, height: 16,
                      background: 'rgba(251,146,60,0.22)',
                      border:     '1px solid rgba(251,146,60,0.4)',
                      color:      '#FB923C',
                      padding:    '0 3px',
                    }}
                  >
                    {overCapCount}
                  </motion.span>
                )}
              </button>
            )}

            {/* 9C: Stale filter toggle */}
            {positionsLoaded && (
              <button
                onClick={() => setStaleFilterActive(s => !s)}
                title={staleFilterActive
                  ? 'Show all cards'
                  : totalStaleCount > 0
                    ? `${totalStaleCount} stale lead${totalStaleCount !== 1 ? 's' : ''} — click to highlight`
                    : 'Highlight stale cards (7+ days inactive)'}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all"
                style={{
                  background: staleFilterActive ? 'rgba(217,119,6,0.18)' : 'rgba(255,255,255,0.04)',
                  border:     staleFilterActive ? '1px solid rgba(217,119,6,0.45)' : '1px solid rgba(255,255,255,0.08)',
                  color:      staleFilterActive ? '#D97706' : totalStaleCount > 0 ? '#D97706' : '#6B7280',
                }}
              >
                <Clock className="size-3" />
                Stale
                {/* Count badge — only shown when filter is off and there are stale leads */}
                {!staleFilterActive && totalStaleCount > 0 && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="flex items-center justify-center text-[9px] font-bold rounded-full"
                    style={{
                      minWidth: 16, height: 16,
                      background: 'rgba(217,119,6,0.2)',
                      border:     '1px solid rgba(217,119,6,0.35)',
                      color:      '#D97706',
                      padding:    '0 3px',
                    }}
                  >
                    {totalStaleCount}
                  </motion.span>
                )}
              </button>
            )}

            {/* 9A: Loss Report export */}
            {accessToken && positionsLoaded && (
              <button
                onClick={handleExportLossReport}
                disabled={exportStatus === 'loading'}
                title={
                  exportStatus === 'error'
                    ? 'No loss data — log some outcomes first'
                    : exportStatus === 'success'
                      ? 'Report downloaded!'
                      : 'Download CORTEX loss pattern report as CSV'
                }
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all disabled:opacity-60"
                style={{
                  background: exportStatus === 'success'
                    ? 'rgba(16,185,129,0.12)'
                    : exportStatus === 'error'
                      ? 'rgba(253,68,56,0.1)'
                      : 'rgba(255,255,255,0.04)',
                  border: exportStatus === 'success'
                    ? '1px solid rgba(16,185,129,0.3)'
                    : exportStatus === 'error'
                      ? '1px solid rgba(253,68,56,0.25)'
                      : '1px solid rgba(255,255,255,0.08)',
                  color: exportStatus === 'success'
                    ? '#10B981'
                    : exportStatus === 'error'
                      ? '#FD4438'
                      : '#6B7280',
                }}
              >
                {exportStatus === 'loading' && <Loader2 className="size-3 animate-spin" />}
                {exportStatus === 'success' && <CheckCircle2 className="size-3" />}
                {exportStatus === 'error'   && <AlertTriangle className="size-3" />}
                {exportStatus === 'idle'    && <Download className="size-3" />}
                <span>
                  {exportStatus === 'loading' ? 'Generating…'
                    : exportStatus === 'success' ? 'Downloaded!'
                    : exportStatus === 'error'   ? 'No data yet'
                    : 'Loss Report'}
                </span>
              </button>
            )}

            {/* 8C: Activity feed toggle */}
            <button
              onClick={feedOpen ? closeFeed : openFeed}
              title="Toggle activity feed"
              className="relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all"
              style={{
                background: feedOpen ? 'rgba(139,92,246,0.18)' : 'rgba(255,255,255,0.04)',
                border:     feedOpen ? '1px solid rgba(139,92,246,0.45)' : '1px solid rgba(255,255,255,0.08)',
                color:      feedOpen ? '#C4B5FD' : '#6B7280',
              }}
            >
              <ScrollText className="size-3" />
              Activity
              {!feedOpen && unreadCount > 0 && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="flex items-center justify-center text-[9px] font-bold rounded-full text-white leading-none"
                  style={{
                    minWidth: 16, height: 16,
                    background: '#8B5CF6',
                    padding: '0 4px',
                  }}
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </motion.span>
              )}
            </button>

            {/* 10A: Learning Loop toggle */}
            {positionsLoaded && (
              <button
                onClick={loopOpen ? () => setLoopOpen(false) : openLoopPanel}
                title={loopOpen ? 'Close Learning Loop (L)' : 'Open Learning Loop intelligence panel (L)'}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all"
                style={{
                  background: loopOpen ? 'rgba(16,185,129,0.18)' : 'rgba(255,255,255,0.04)',
                  border:     loopOpen ? '1px solid rgba(16,185,129,0.45)' : '1px solid rgba(255,255,255,0.08)',
                  color:      loopOpen ? '#10B981' : '#6B7280',
                }}
              >
                <Brain className="size-3" />
                Loop
                {!loopOpen && loopData && (
                  <motion.span
                    initial={{ scale: 0 }} animate={{ scale: 1 }}
                    className="text-[9px] font-bold rounded-full flex items-center justify-center flex-shrink-0"
                    style={{
                      minWidth: 16, height: 16,
                      background: 'rgba(16,185,129,0.18)',
                      border:     '1px solid rgba(16,185,129,0.3)',
                      color:      '#10B981',
                      padding:    '0 3px',
                    }}
                  >
                    {loopData.totalOutcomes}
                  </motion.span>
                )}
              </button>
            )}

            {/* 7B: Select mode toggle */}
            {isSelectMode ? (
              <button onClick={exitSelectMode}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all"
                style={{ background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.5)', color: '#C4B5FD' }}>
                <XIcon className="size-3" />Exit select mode
              </button>
            ) : (
              <button onClick={enterSelectMode} title="Enable multi-select"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-gray-500 hover:text-gray-200 transition-colors"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <MousePointerClick className="size-3" />Select
              </button>
            )}

            {/* Sync status */}
            <AnimatePresence mode="wait">
              {syncStatus === 'loading' && (
                <motion.div key="loading" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium"
                  style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)', color: '#A78BFA' }}>
                  <Loader2 className="size-3 animate-spin" />Loading layout…
                </motion.div>
              )}
              {syncStatus === 'saving' && (
                <motion.div key="saving" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium"
                  style={{ background: 'rgba(6,215,246,0.08)', border: '1px solid rgba(6,215,246,0.2)', color: '#06D7F6' }}>
                  <Cloud className="size-3" />Saving…
                </motion.div>
              )}
              {syncStatus === 'saved' && (
                <motion.div key="saved" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium"
                  style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', color: '#10B981' }}>
                  <CheckCircle2 className="size-3" />Board synced
                </motion.div>
              )}
              {syncStatus === 'error' && (
                <motion.div key="error" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium"
                  style={{ background: 'rgba(253,68,56,0.1)', border: '1px solid rgba(253,68,56,0.25)', color: '#FCA5A5' }}>
                  <WifiOff className="size-3" />
                  {syncError || 'Sync failed'}
                  <button onClick={handleRetrySync} className="ml-1 underline hover:no-underline text-[#FD4438]">Retry</button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 12B: Cap save indicator (shows briefly after inline or panel edit) */}
            <AnimatePresence>
              {capSaveStatus === 'saving' && (
                <motion.div key="cap-saving" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium"
                  style={{ background: 'rgba(251,146,60,0.1)', border: '1px solid rgba(251,146,60,0.2)', color: '#FB923C' }}>
                  <Gauge className="size-3 animate-pulse" />Saving caps…
                </motion.div>
              )}
              {capSaveStatus === 'saved' && (
                <motion.div key="cap-saved" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium"
                  style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', color: '#10B981' }}>
                  <CheckCircle2 className="size-3" />Caps saved
                </motion.div>
              )}
              {capSaveStatus === 'error' && (
                <motion.div key="cap-error" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium"
                  style={{ background: 'rgba(253,68,56,0.1)', border: '1px solid rgba(253,68,56,0.25)', color: '#FCA5A5' }}>
                  <AlertTriangle className="size-3" />Cap save failed
                </motion.div>
              )}
            </AnimatePresence>

            {/* Reset */}
            {accessToken && syncStatus !== 'loading' && (
              <button onClick={handleResetPositions} title="Reset board layout to submission statuses"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-gray-600 hover:text-gray-300 transition-colors"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <RotateCcw className="size-3" />Reset layout
              </button>
            )}

            {/* 9B: Keyboard shortcuts toggle */}
            <button
              onClick={() => setShowShortcuts(s => !s)}
              title="Keyboard shortcuts (?)"
              className="flex items-center justify-center size-[30px] rounded-lg text-[11px] font-bold transition-all"
              style={{
                background: showShortcuts ? 'rgba(139,92,246,0.18)' : 'rgba(255,255,255,0.03)',
                border:     showShortcuts ? '1px solid rgba(139,92,246,0.45)' : '1px solid rgba(255,255,255,0.07)',
                color:      showShortcuts ? '#C4B5FD' : '#6B7280',
              }}
            >
              <Keyboard className="size-3.5" />
            </button>
          </div>
        </div>

        {/* ── 10B: Capacity Config Panel ──────────────────────────────── */}
        <AnimatePresence>
          {capPanelOpen && (
            <CapacityConfigPanel
              capacities={columnCapacity}
              onUpdate={handleCapacityUpdate}
              onClose={() => setCapPanelOpen(false)}
              saveStatus={capSaveStatus}
            />
          )}
        </AnimatePresence>

        {/* ── 10A: Inline Learning Loop Panel ─────────────────────────── */}
        <AnimatePresence>
          {loopOpen && (
            <InlineLearningLoopPanel
              data={loopData}
              status={loopStatus}
              onRefresh={() => loadLoopData()}
              onClose={() => setLoopOpen(false)}
              onOpenFull={onViewLearningLoop}
              lastRefreshedAt={loopLastRefresh}
            />
          )}
        </AnimatePresence>

        {/* Board */}
        {!positionsLoaded ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="size-6 text-[#8B5CF6] animate-spin" />
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-8 pt-1 -mx-1 px-1">
            {PIPELINE_COLUMNS.map((col, colIdx) => (
              <KanbanColumnView
                key={col.id}
                column={col}
                leads={leadsByColumn[col.id] || []}
                aiStatusMap={cortexStatus}
                outcomesMap={localOutcomes}
                onDrop={handleDrop}
                onCardClick={onSelectLead}
                savingIds={savingIds}
                isSelectMode={isSelectMode}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                remoteChanges={remoteChanges}
                conflictIds={conflictIds}
                onAcceptRemote={handleAcceptOne}
                onDismissRemote={handleDismissOne}
                onSelectAllColumn={handleColumnSelectAll}
                isFocusedCol={focusedColIdx === colIdx}
                focusedCardIdx={focusedColIdx === colIdx ? focusedCardIdx : null}
                onFocusCol={() => { setFocusedColIdx(colIdx); setFocusedCardIdx(null); }}
                staleFilterActive={staleFilterActive}
                capacity={columnCapacity[col.id] ?? 0}
                onCapUpdate={val => handleCapacityUpdate(col.id, val)}
                onQuickMove={handleQuickMove}
                scoreHistoryMap={scoreHistoryRef.current}
                engagementMap={engagementMap}
                priorityMap={priorityMap}
                onTogglePriority={handleTogglePriority}
                onAddNote={handleAddNote}
              />
            ))}
          </div>
        )}

        {/* Legend */}
        <div className="flex items-center gap-4 mt-2 text-[11px] text-gray-600 flex-wrap">
          <div className="flex items-center gap-1.5">
            <GripVertical className="size-3" />Drag cards between stages
          </div>
          <div className="flex items-center gap-1.5">
            <MousePointerClick className="size-3 text-[#8B5CF6]" />
            <span className="text-[#8B5CF6] font-semibold">Select</span> to multi-drag a group
          </div>
          <div className="flex items-center gap-1.5">
            <Layers className="size-3 text-[#8B5CF6]" />
            Column <span className="text-[#8B5CF6] font-semibold">☑</span> selects all cards in that stage
          </div>
          <div className="flex items-center gap-1.5">
            <Radio className="size-3 text-[#06D7F6]" />
            <span className="text-[#06D7F6] font-semibold">Live sync</span> · polls every 30 s
          </div>
          <div className="flex items-center gap-1.5">
            <BarChart2 className="size-3 text-[#8B5CF6]" />
            Sparkline = <span className="text-[#8B5CF6] font-semibold">live</span> after 2+ score reads · dashed = estimated
          </div>
          <div className="flex items-center gap-1.5">
            <TrendingUp className="size-3 text-[#10B981]" />
            Drop on <span className="text-[#10B981] font-semibold">Converted</span> to log a win
          </div>
          <div className="flex items-center gap-1.5">
            <XCircle className="size-3 text-[#FD4438]" />
            Drop on <span className="text-[#FD4438] font-semibold">Lost</span> to log a loss
          </div>
          <div className="flex items-center gap-1.5">
            <ScrollText className="size-3 text-[#8B5CF6]" />
            <span className="text-[#8B5CF6] font-semibold">Activity</span> logs every board event
          </div>
          <div className="flex items-center gap-1.5">
            <Download className="size-3 text-[#06D7F6]" />
            <span className="text-[#06D7F6] font-semibold">Loss Report</span> exports Learning Loop as CSV
          </div>
          <div className="flex items-center gap-1.5">
            <Keyboard className="size-3 text-[#8B5CF6]" />
            <span className="text-[#8B5CF6] font-semibold">?</span> keyboard shortcuts · <span className="text-[#8B5CF6] font-semibold">← →</span> columns · <span className="text-[#8B5CF6] font-semibold">↑ ↓</span> cards
          </div>
          <div className="flex items-center gap-1.5">
            <Brain className="size-3 text-[#10B981]" />
            <span className="text-[#10B981] font-semibold">Loop</span>
            inline Learning Loop · win rate · loss reasons · score bands
          </div>
          <div className="flex items-center gap-1.5">
            <Gauge className="size-3 text-[#FB923C]" />
            <span className="text-[#FB923C] font-semibold">Cap</span>
            click <span className="text-[#FB923C] font-semibold">N/cap</span> denominator to edit · auto-saved to team workspace
          </div>
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="size-3 text-[#FD4438]" />
            <span className="text-[#FD4438] font-semibold">Critical</span>
            red pulsing border + chip when AI score ≤ 38
          </div>
          <div className="flex items-center gap-1.5">
            <Sparkles className="size-3 text-[#10B981]" />
            <span className="text-[#10B981] font-semibold">Hot</span>
            green border + chip when AI score ≥ 85
          </div>
          <div className="flex items-center gap-1.5">
            <MoreVertical className="size-3 text-[#8B5CF6]" />
            <span className="text-[#8B5CF6] font-semibold">⋯</span>
            hover a card · quick-move prev/next · select · copy name
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="size-3 text-[#D97706]" />
            <span className="text-[#D97706] font-semibold">Stale</span>
            highlights leads inactive 7d+ ·
            <span className="font-semibold" style={{ color: '#EA580C' }}>14d+</span> stale ·
            <span className="font-semibold" style={{ color: '#DC2626' }}>30d+</span> critical ·
            <span className="text-[#D97706] font-semibold">🔔 bell alert at each tier</span>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <Cloud className="size-3 text-[#06D7F6]" />
            <span className="text-[#06D7F6]">Layout auto-saves to cloud</span>
          </div>
        </div>
      </div>

      {/* Outcome Modal */}
      <AnimatePresence>
        {pendingDrop && (
          <OutcomeModal
            pending={pendingDrop}
            accessToken={accessToken}
            onConfirm={handleOutcomeConfirm}
            onCancel={handleOutcomeCancel}
          />
        )}
      </AnimatePresence>

      {/* ── 8C: Activity Feed Drawer ─────────────────────────────────────── */}
      <ActivityDrawer
        feed={feed}
        isOpen={feedOpen}
        onClose={closeFeed}
        onJumpToCard={leadId => { onSelectLead(leadId); closeFeed(); }}
      />

      {/* ── 9B: Keyboard Shortcut Legend ─────────────────────────────────── */}
      <AnimatePresence>
        {showShortcuts && (
          <ShortcutLegend onClose={() => setShowShortcuts(false)} />
        )}
      </AnimatePresence>
    </DndProvider>
  );
}
