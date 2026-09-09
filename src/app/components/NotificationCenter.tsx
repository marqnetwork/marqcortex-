/**
 * NOTIFICATION CENTER
 *
 * Fetches real notifications from Supabase KV via GET /notifications.
 * Polls every 30 seconds for new activity.
 * Marks all as read when the panel is opened.
 * Clicking a notification fires onNavigateToSubmission if provided.
 * 12A: Also accepts liveAlerts from DashboardContext (kanban event feed).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bell, X, CheckCheck, Zap, RefreshCw,
  ArrowRight, AlertTriangle, CheckCircle2, Clock,
  TrendingDown, TrendingUp, Users, Radio, TimerOff,
} from 'lucide-react';
import { getNotifications, markNotificationsRead, type AppNotification } from '@/app/services/dataService';
import type { KanbanAlert } from '@/app/contexts/DashboardContext';
import { isBackendEnabled, isVerboseLogging, shouldShowApiErrors } from '@/config/runtime';
import {
  brand,
  status as STATUS,
} from '@/app/lib/tokens';


interface Props {
  accessToken?: string;
  onNavigateToSubmission?: (submissionId: string) => void;
  /** 12A: live kanban alerts injected from DashboardContext */
  liveAlerts?:      KanbanAlert[];
  onMarkLiveRead?:  () => void;
}

const TYPE_CONFIG = {
  new_submission: {
    icon: Zap,
    color: brand.accent,
    bg: 'bg-cortex-accent/10',
    border: 'border-cortex-accent/25',
    dot: 'bg-cortex-accent',
    label: 'New',
  },
  status_change: {
    icon: CheckCircle2,
    color: STATUS.info,
    bg: 'bg-cortex-info/10',
    border: 'border-cortex-info/25',
    dot: 'bg-cortex-info',
    label: 'Update',
  },
  urgent: {
    icon: AlertTriangle,
    color: STATUS.danger,
    bg: 'bg-cortex-danger/10',
    border: 'border-cortex-danger/25',
    dot: 'bg-cortex-danger',
    label: 'Urgent',
  },
};

// 12A: config for live kanban alert kinds
const LIVE_KIND_CONFIG: Record<KanbanAlert['kind'], {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string; bg: string; border: string; dot: string; label: string;
}> = {
  score_low: {
    icon: TrendingDown,
    color: STATUS.danger,
    bg: 'bg-cortex-danger/10',
    border: 'border-cortex-danger/25',
    dot: 'bg-cortex-danger',
    label: 'Critical',
  },
  score_high: {
    icon: TrendingUp,
    color: STATUS.success,
    bg: 'bg-cortex-success/10',
    border: 'border-cortex-success/25',
    dot: 'bg-cortex-success',
    label: 'Hot',
  },
  remote_move: {
    icon: Users,
    color: STATUS.info,
    bg: 'bg-cortex-info/10',
    border: 'border-cortex-info/25',
    dot: 'bg-cortex-info',
    label: 'Sync',
  },
  conflict: {
    icon: AlertTriangle,
    color: STATUS.warning,
    bg: 'bg-cortex-warning/10',
    border: 'border-cortex-warning/25',
    dot: 'bg-cortex-warning',
    label: 'Conflict',
  },
  // 12D: stale escalation — base config; severity overrides applied in LiveAlertRow
  stale_escalation: {
    icon: TimerOff,
    color: STATUS.cautionDeep,
    bg: 'bg-cortex-caution-deep/10',
    border: 'border-cortex-caution-deep/25',
    dot: 'bg-cortex-caution-deep',
    label: 'Stale',
  },
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function NotificationCenter({ accessToken, onNavigateToSubmission, liveAlerts = [], onMarkLiveRead }: Props) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNotifications = useCallback(async (silent = false) => {
    // If backend integration is disabled, don't fetch
    if (!isBackendEnabled() || !accessToken) {
      if (isVerboseLogging() && !silent) {
        console.log('🔔 Notification fetching skipped (backend integration disabled or no access token)');
      }
      return;
    }

    if (!silent) setIsLoading(true);
    try {
      if (isVerboseLogging()) {
        console.log('🔔 Fetching notifications from backend...');
      }
      const res = await getNotifications(accessToken);
      if (isVerboseLogging()) {
        console.log('✅ Notifications loaded:', res);
      }
      // The response is narrowed before it reaches state, because it is
      // untrusted input and this component sits in the CONSOLE HEADER.
      //
      // `getNotifications` returns `data as { notifications: … }` — an
      // assertion, not a check. A 200 whose body lacks `notifications` (a
      // partial deploy, a proxy answering with a stub, an error payload
      // returned with the wrong status) therefore set state to `undefined`,
      // and the next render read `notifications.length` and threw. Because
      // the bell is rendered by the shell on EVERY page, that single malformed
      // response replaced the whole console with the route error boundary —
      // not the notification list, the entire application.
      //
      // The dashboard's own submissions call already guarded this way
      // (`result.submissions ?? []`). This one did not.
      setNotifications(Array.isArray(res?.notifications) ? res.notifications : []);
      setUnreadCount(typeof res?.unreadCount === 'number' && Number.isFinite(res.unreadCount)
        ? res.unreadCount
        : 0);
      setLastFetch(new Date());
    } catch (err) {
      if (isVerboseLogging()) {
        console.error('❌ NotificationCenter fetch error:', err);
        console.error('Error details:', {
          message: err instanceof Error ? err.message : String(err),
          type: typeof err,
          name: err?.constructor?.name,
        });
      }
      // Don't throw - let notifications fail silently
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  // Initial fetch + 30s poll
  useEffect(() => {
    fetchNotifications();
    intervalRef.current = setInterval(() => fetchNotifications(true), 30000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchNotifications]);

  // Mark all read when panel opens
  useEffect(() => {
    if (open) {
      if (unreadCount > 0 && accessToken) {
        markNotificationsRead(accessToken)
          .then(() => {
            setUnreadCount(0);
            setNotifications(prev => prev.map(n => ({ ...n, read: true })));
          })
          .catch(err => console.error('Mark read error:', err));
      }
      // 12A: mark live alerts read too
      if (liveAlerts.some(a => !a.read)) {
        onMarkLiveRead?.();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accessToken]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleNotificationClick = (n: AppNotification) => {
    if (onNavigateToSubmission && n.submissionId) {
      onNavigateToSubmission(n.submissionId);
      setOpen(false);
    }
  };

  // 12A: total badge = server unread + live unread
  const liveUnread   = liveAlerts.filter(a => !a.read).length;
  const totalUnread  = unreadCount + liveUnread;
  const hasAnything  = notifications.length > 0 || liveAlerts.length > 0;

  return (
    <div className="relative" ref={panelRef}>
      {/* ── Bell Button ── */}
      <button
        onClick={() => setOpen(prev => !prev)}
        className="p-2 hover:bg-cortex-control rounded-cortex-sm transition-colors relative"
        aria-label="Notifications"
      >
        <Bell className={`size-5 transition-colors ${open ? 'text-white' : 'text-cortex-muted'}`} />
        <AnimatePresence>
          {totalUnread > 0 && (
            <motion.span
              key="badge"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-cortex-danger text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none"
            >
              {totalUnread > 9 ? '9+' : totalUnread}
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      {/* ── Panel ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-12 w-[400px] bg-cortex-overlay border border-white/15 rounded-cortex-lg shadow-2xl shadow-black/60 z-50 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-cortex-default">
              <div className="flex items-center gap-2">
                <Bell className="size-4 text-cortex-accent" />
                <span className="font-semibold text-white text-sm">Notifications</span>
                {hasAnything && (
                  <span className="text-xs text-cortex-muted ml-1">
                    ({notifications.length + liveAlerts.length})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => fetchNotifications()}
                  disabled={isLoading}
                  className="p-1.5 hover:bg-cortex-control rounded-cortex-sm transition-colors"
                  title="Refresh"
                >
                  <RefreshCw className={`size-3.5 text-cortex-muted ${isLoading ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 hover:bg-cortex-control rounded-cortex-sm transition-colors"
                >
                  <X className="size-3.5 text-cortex-muted" />
                </button>
              </div>
            </div>

            {/* Notification list */}
            <div className="max-h-[480px] overflow-y-auto">
              {isLoading && !hasAnything ? (
                <div className="py-12 text-center">
                  <RefreshCw className="size-6 text-cortex-accent animate-spin mx-auto mb-3" />
                  <p className="text-cortex-muted text-sm">Loading…</p>
                </div>
              ) : !hasAnything ? (
                <EmptyState />
              ) : (
                <div className="p-2 space-y-1">
                  {/* 12A: Live kanban alerts — rendered first with a section header */}
                  {liveAlerts.length > 0 && (
                    <span className="contents">
                      <div className="flex items-center gap-2 px-2 pt-1 pb-0.5">
                        <Radio className="size-3 text-cortex-info" />
                        <span className="text-[11px] font-semibold text-cortex-info uppercase tracking-wider">
                          Live · Kanban
                        </span>
                        {liveUnread > 0 && (
                          <span className="ml-auto text-[10px] bg-cortex-info/15 text-cortex-info px-1.5 py-0.5 rounded-full font-semibold">
                            {liveUnread} new
                          </span>
                        )}
                      </div>
                      {liveAlerts.map((alert, i) => (
                        <LiveAlertRow key={alert.id} alert={alert} index={i} />
                      ))}
                    </span>
                  )}

                  {/* Divider if both sections have content */}
                  {liveAlerts.length > 0 && notifications.length > 0 && (
                    <div className="flex items-center gap-2 px-2 pt-2 pb-0.5">
                      <div className="flex-1 h-px bg-white/8" />
                      <span className="text-[11px] text-cortex-faint font-semibold uppercase tracking-wider">Server</span>
                      <div className="flex-1 h-px bg-white/8" />
                    </div>
                  )}

                  {/* Server notifications */}
                  {notifications.map((n, i) => (
                    <NotificationRow
                      key={n.id}
                      notification={n}
                      index={i}
                      onClick={() => handleNotificationClick(n)}
                      canNavigate={!!onNavigateToSubmission}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            {hasAnything && (
              <div className="px-5 py-3 border-t border-cortex-default flex items-center justify-between">
                <span className="text-xs text-cortex-faint">
                  {lastFetch ? `Updated ${timeAgo(lastFetch.toISOString())}` : 'Live'}
                </span>
                <div className="flex items-center gap-1 text-xs text-cortex-muted">
                  <CheckCheck className="size-3" />
                  All caught up
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

// 12A: Live alert row
function LiveAlertRow({ alert, index }: { alert: KanbanAlert; index: number }) {
  const cfg  = LIVE_KIND_CONFIG[alert.kind] ?? LIVE_KIND_CONFIG.remote_move;
  const Icon = cfg.icon;

  // 12D: for stale_escalation, override colour based on severity
  const isCriticalStale = alert.kind === 'stale_escalation' && alert.severity === 'critical';
  const color  = isCriticalStale ? STATUS.danger : cfg.color;
  const dotCls = isCriticalStale ? 'bg-cortex-danger' : cfg.dot;
  const bgCls  = isCriticalStale ? 'bg-cortex-danger/10'  : cfg.bg;
  const bdrCls = isCriticalStale ? 'border-cortex-danger/25' : cfg.border;
  const label  = isCriticalStale ? 'Critical'
               : alert.kind === 'stale_escalation' ? 'Stale · 14d+'
               : cfg.label;

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.025 }}
      className={`
        relative flex gap-3 p-3 rounded-cortex-md border
        ${bgCls} ${bdrCls}
        ${!alert.read ? 'opacity-100' : 'opacity-55'}
      `}
    >
      {/* Unread dot */}
      {!alert.read && (
        <span className={`absolute top-3 right-3 size-1.5 rounded-full ${dotCls}`} />
      )}

      {/* Icon */}
      <div
        className="size-8 rounded-cortex-sm flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ backgroundColor: `${color}20` }}
      >
        <Icon className="size-4" style={{ color }} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pr-3">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-semibold text-white">{alert.title}</span>
          <span
            className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: `${color}20`, color }}
          >
            {label}
          </span>
        </div>
        <p className="text-xs text-cortex-muted leading-relaxed line-clamp-2">{alert.body}</p>
        <div className="flex items-center gap-2 mt-1.5">
          <Clock className="size-3 text-cortex-faint" />
          <span className="text-[11px] text-cortex-faint">{timeAgo(alert.at)}</span>
        </div>
      </div>
    </motion.div>
  );
}

function NotificationRow({
  notification: n,
  index,
  onClick,
  canNavigate,
}: {
  notification: AppNotification;
  index: number;
  onClick: () => void;
  canNavigate: boolean;
}) {
  const cfg = TYPE_CONFIG[n.type] || TYPE_CONFIG.new_submission;
  const Icon = cfg.icon;

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.03 }}
      onClick={onClick}
      className={`
        group relative flex gap-3 p-3 rounded-cortex-md border transition-all
        ${cfg.bg} ${cfg.border}
        ${canNavigate ? 'cursor-pointer hover:brightness-125' : 'cursor-default'}
        ${!n.read ? 'opacity-100' : 'opacity-60'}
      `}
    >
      {/* Unread dot */}
      {!n.read && (
        <span className={`absolute top-3 right-3 size-1.5 rounded-full ${cfg.dot}`} />
      )}

      {/* Icon */}
      <div
        className="size-8 rounded-cortex-sm flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ backgroundColor: `${cfg.color}20` }}
      >
        <Icon className="size-4" style={{ color: cfg.color }} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pr-3">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-semibold text-white">{n.title}</span>
          <span
            className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: `${cfg.color}20`, color: cfg.color }}
          >
            {cfg.label}
          </span>
        </div>
        <p className="text-xs text-cortex-muted leading-relaxed line-clamp-2">{n.message}</p>
        <div className="flex items-center gap-2 mt-1.5">
          <Clock className="size-3 text-cortex-faint" />
          <span className="text-[11px] text-cortex-faint">{timeAgo(n.createdAt)}</span>
          {canNavigate && n.submissionId && (
            <span className="ml-auto text-[11px] text-cortex-faint group-hover:text-white transition-colors flex items-center gap-0.5">
              View <ArrowRight className="size-2.5" />
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function EmptyState() {
  return (
    <div className="py-14 px-6 text-center">
      <div className="size-14 rounded-cortex-lg bg-cortex-control flex items-center justify-center mx-auto mb-4">
        <Bell className="size-6 text-cortex-faint" />
      </div>
      <p className="text-white font-medium text-sm mb-1">All quiet</p>
      <p className="text-cortex-muted text-xs leading-relaxed">
        Notifications appear here when new diagnostics are submitted or statuses change.
      </p>
    </div>
  );
}