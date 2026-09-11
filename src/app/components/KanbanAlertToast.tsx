/**
 * KANBAN ALERT TOAST STACK — 12E
 *
 * Bottom-right ephemeral toast layer driven by DashboardContext kanbanAlerts.
 *
 * Behaviour:
 *  • Seeded: current kanbanAlerts at mount are marked seen → never retroactively
 *    toasted (the backlog stays in the bell, not on screen).
 *  • New alert detected → pushed onto activeToasts (oldest evicted if > 3).
 *  • Each toast auto-dismisses after 5 s (clock pauses on hover, resumes on leave).
 *  • Progress bar depletes via CSS animation; animation-play-state synced with hover.
 *  • X button dismisses immediately.
 *  • "View CORTEX" button calls onNavigate('cortex') and dismisses.
 *  • Severity overrides for stale_escalation: warning = amber, critical = red.
 *  • Stack: newest toast is closest to the corner (bottom); older ones above it.
 *  • AnimatePresence handles enter (slide-in from right + fade) and exit (slide-out).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  X, TrendingDown, TrendingUp, Users, AlertTriangle, TimerOff,
  ChevronRight, Building2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { KanbanAlert, KanbanAlertKind, KanbanAlertSeverity } from '@/app/contexts/DashboardContext';
import {
  border as BORDER,
  status as STATUS,
  surface as SURFACE,
} from '@/app/lib/tokens';


// ── Colour config ─────────────────────────────────────────────────────────────

interface ColourSet {
  hex:    string;  // icon & accent text
  bg:     string;  // card background tint
  bar:    string;  // progress bar colour
  left:   string;  // left border colour
  chip:   string;  // company chip background
  label:  string;  // kind label
}

const KIND_COLORS: Record<KanbanAlertKind, ColourSet> = {
  score_low: {
    hex: STATUS.danger, bg: `${STATUS.danger}12`, bar: STATUS.danger,
    left: STATUS.danger, chip: `${STATUS.danger}26`, label: 'Critical Score',
  },
  score_high: {
    hex: STATUS.success, bg: `${STATUS.success}12`, bar: STATUS.success,
    left: STATUS.success, chip: `${STATUS.success}26`, label: 'High Score',
  },
  remote_move: {
    hex: STATUS.info, bg: `${STATUS.info}0F`, bar: STATUS.info,
    left: STATUS.info, chip: `${STATUS.info}1F`, label: 'Card Moved',
  },
  conflict: {
    hex: STATUS.warning, bg: `${STATUS.warning}12`, bar: STATUS.warning,
    left: STATUS.warning, chip: `${STATUS.warning}26`, label: 'Conflict',
  },
  stale_escalation: {
    hex: STATUS.cautionDeep, bg: 'rgba(217,119,6,0.07)', bar: STATUS.cautionDeep,
    left: STATUS.cautionDeep, chip: 'rgba(217,119,6,0.15)', label: 'Stale Lead',
  },
};

// Severity overrides for stale_escalation
function resolveColors(kind: KanbanAlertKind, severity: KanbanAlertSeverity): ColourSet {
  if (kind === 'stale_escalation' && severity === 'critical') {
    return {
      hex: STATUS.danger, bg: `${STATUS.danger}12`, bar: STATUS.danger,
      left: STATUS.danger, chip: `${STATUS.danger}26`, label: 'Silent Lead',
    };
  }
  return KIND_COLORS[kind];
}

const KIND_ICONS: Record<KanbanAlertKind, LucideIcon> = {
  score_low:        TrendingDown,
  score_high:       TrendingUp,
  remote_move:      Users,
  conflict:         AlertTriangle,
  stale_escalation: TimerOff,
};

// ── Duration ──────────────────────────────────────────────────────────────────

const TOAST_DURATION_MS = 5000;

// ── Inject keyframes once ─────────────────────────────────────────────────────

function injectKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('kat-kf')) return;
  const s = document.createElement('style');
  s.id = 'kat-kf';
  s.textContent = `
    @keyframes kat-shrink {
      from { width: 100%; }
      to   { width: 0%;   }
    }
  `;
  document.head.appendChild(s);
}

// ── Single toast ──────────────────────────────────────────────────────────────

interface ToastProps {
  alert:      KanbanAlert;
  onDismiss:  (id: string) => void;
  onNavigate: (page: string) => void;
}

function KanbanToast({ alert, onDismiss, onNavigate }: ToastProps) {
  const colors      = resolveColors(alert.kind, alert.severity);
  const Icon        = KIND_ICONS[alert.kind];
  const [hovered, setHovered] = useState(false);
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt   = useRef<number>(Date.now());
  const remaining   = useRef<number>(TOAST_DURATION_MS);

  // Start / pause / resume timer
  const startTimer = useCallback(() => {
    timerRef.current = setTimeout(() => onDismiss(alert.id), remaining.current);
    startedAt.current = Date.now();
  }, [alert.id, onDismiss]);

  const pauseTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      remaining.current -= Date.now() - startedAt.current;
    }
  }, []);

  useEffect(() => {
    startTimer();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [startTimer]);

  const handleMouseEnter = () => { setHovered(true);  pauseTimer();  };
  const handleMouseLeave = () => { setHovered(false); startTimer(); };

  function handleView() {
    onDismiss(alert.id);
    onNavigate('cortex');
  }

  // Relative time
  function timeAgo(iso: string): string {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 10)  return 'just now';
    if (s < 60)  return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 48, scale: 0.95 }}
      animate={{ opacity: 1, x: 0,  scale: 1    }}
      exit={{    opacity: 0, x: 48, scale: 0.95, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', damping: 22, stiffness: 300 }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        width:        360,
        background:   colors.bg,
        backdropFilter: 'blur(20px)',
        border:        `1px solid ${BORDER.default}`,
        borderLeft:    `4px solid ${colors.left}`,
        borderRadius:  14,
        overflow:      'hidden',
        boxShadow:     '0 8px 40px rgba(0,0,0,0.65), 0 2px 8px rgba(0,0,0,0.4)',
        backgroundColor: SURFACE.overlay,
      }}
    >
      {/* ── Header row ── */}
      <div className="flex items-start gap-3 px-4 pt-3.5 pb-2">
        {/* Kind icon */}
        <div
          className="size-8 rounded-cortex-sm flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{ background: `${colors.hex}18`, border: `1px solid ${colors.hex}30` }}
        >
          <Icon className="size-4" style={{ color: colors.hex }} />
        </div>

        {/* Title + body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-bold text-white leading-tight">{alert.title}</span>
            {/* Severity badge */}
            {alert.severity === 'critical' && (
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                style={{ background: `${STATUS.danger}20`, color: STATUS.danger, border: `1px solid ${STATUS.danger}59` }}
              >
                CRITICAL
              </span>
            )}
            {alert.severity === 'warning' && (
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                style={{ background: 'rgba(217,119,6,0.2)', color: STATUS.cautionDeep, border: '1px solid rgba(217,119,6,0.35)' }}
              >
                WARNING
              </span>
            )}
          </div>
          <p className="text-xs text-cortex-muted leading-relaxed line-clamp-2">{alert.body}</p>
        </div>

        {/* Dismiss X */}
        <button
          onClick={() => onDismiss(alert.id)}
          className="p-1 rounded-cortex-sm flex-shrink-0 transition-colors"
          style={{ color: BORDER.default }}
          onMouseEnter={e => (e.currentTarget.style.color = 'white')}
          onMouseLeave={e => (e.currentTarget.style.color = BORDER.default)}
          aria-label="Dismiss"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* ── Footer row ── */}
      <div className="flex items-center justify-between px-4 pb-3">
        {/* Company chip */}
        <div
          className="flex items-center gap-1.5 px-2 py-1 rounded-cortex-sm text-xs font-medium"
          style={{ background: colors.chip, color: colors.hex }}
        >
          <Building2 className="size-3" />
          <span className="truncate max-w-[130px]">{alert.companyName}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Timestamp */}
          <span className="text-[11px] text-cortex-faint">{timeAgo(alert.at)}</span>

          {/* View CTA */}
          <button
            onClick={handleView}
            className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-cortex-sm transition-all"
            style={{ background: `${colors.hex}18`, color: colors.hex, border: `1px solid ${colors.hex}30` }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = `${colors.hex}28`;
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = `${colors.hex}18`;
            }}
          >
            View <ChevronRight className="size-3" />
          </button>
        </div>
      </div>

      {/* ── Progress bar ── */}
      <div
        className="h-0.5"
        style={{ background: BORDER.default }}
      >
        <div
          style={{
            height:             '100%',
            background:         colors.bar,
            animationName:      'kat-shrink',
            animationDuration:  `${TOAST_DURATION_MS}ms`,
            animationTimingFunction: 'linear',
            animationFillMode:  'forwards',
            animationPlayState: hovered ? 'paused' : 'running',
            transformOrigin:    'left',
          }}
        />
      </div>
    </motion.div>
  );
}

// ── Toast stack ───────────────────────────────────────────────────────────────

const MAX_TOASTS = 3;

interface StackProps {
  kanbanAlerts: KanbanAlert[];
  onNavigate?:  (page: string) => void;
}

export function KanbanAlertToastStack({ kanbanAlerts, onNavigate }: StackProps) {
  injectKeyframes();

  // Seed with all current IDs on mount — these never trigger a toast
  const seenIds    = useRef<Set<string>>(new Set(kanbanAlerts.map(a => a.id)));
  const [toasts, setToasts] = useState<KanbanAlert[]>([]);

  // Detect new alerts added after mount
  useEffect(() => {
    const incoming: KanbanAlert[] = [];
    for (const alert of kanbanAlerts) {
      if (!seenIds.current.has(alert.id)) {
        seenIds.current.add(alert.id);
        incoming.push(alert);
      }
    }
    if (incoming.length === 0) return;

    setToasts(prev => {
      // Newest first; cap at MAX_TOASTS (oldest evicted if overflow)
      const merged = [...incoming, ...prev];
      return merged.slice(0, MAX_TOASTS);
    });
  }, [kanbanAlerts]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    /*
     * `aria-label` is PROHIBITED on an element with no role: a bare <div> is
     * `role="generic"`, which does not support being named, so the name was
     * silently discarded by assistive technology and axe reported it as a
     * serious violation on every one of the thirteen destinations — the toast
     * container mounts in the shell, so one element failed everywhere.
     *
     * `status` is the live-region role for advisory messages. It permits the
     * name, and its implicit `aria-live` is already what this declared.
     * `aria-atomic="false"` so an arriving toast is announced on its own rather
     * than re-reading the whole stack — the behaviour a queue of alerts needs,
     * and the opposite of the role's default.
     */
    <div
      className="fixed bottom-6 right-6 z-[9900] flex flex-col gap-3 items-end pointer-events-none"
      role="status"
      aria-live="polite"
      aria-atomic="false"
      aria-label="Pipeline alerts"
    >
      <AnimatePresence mode="sync">
        {/* Render oldest → newest so newest is visually at bottom */}
        {[...toasts].reverse().map(alert => (
          <div key={alert.id} className="pointer-events-auto">
            <KanbanToast
              alert={alert}
              onDismiss={dismiss}
              onNavigate={page => onNavigate?.(page)}
            />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}
