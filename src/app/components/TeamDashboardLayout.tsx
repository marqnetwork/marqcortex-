/**
 * PERSISTENT TEAM DASHBOARD LAYOUT
 *
 * Two-layer pattern:
 *   TeamDashboardLayout  — mounts GlobalAIChatProvider, then delegates to DashboardLayoutInner
 *   DashboardLayoutInner — lives INSIDE the provider, safe to call useGlobalAIChat()
 */

import { useState, type ReactNode, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  Brain,
  LogOut,
  ChevronRight,
  Menu,
  X,
  PanelLeft,
  Search as SearchIcon,
} from 'lucide-react';
import { useDashboard } from '@/app/contexts/DashboardContext';
import {
  NAV_GROUPS,
  SHORTCUT_DESTINATIONS,
  type DestinationId,
} from '@/app/core/navigationModel';
import { useKeyboardShortcuts, isMac } from '@/app/hooks/useKeyboardShortcuts';
import { useMediaQuery } from '@/app/hooks/usePerformance';
import { CommandPalette, useCommandPaletteCommands } from '@/app/components/CommandPalette';
import { KeyboardShortcutsHelp } from '@/app/components/KeyboardShortcutsHelp';
import { NotificationCenter } from '@/app/components/NotificationCenter';
import { KanbanAlertToastStack } from '@/app/components/KanbanAlertToast';
import { GlobalAIChatProvider, useGlobalAIChat } from '@/app/contexts/GlobalAIChatContext';
import { GlobalAIChat } from '@/app/components/GlobalAIChat';
import { getDemoSubmissions } from '@/app/services/dataService';

// ── Shared types ───────────────────────────────────────────────────────────────

export interface Breadcrumb {
  label: string;
  onClick?: () => void;
}

export interface TeamDashboardLayoutProps {
  children: ReactNode;
  /** The model owns the destination list — see navigationModel.ts. */
  currentPage: DestinationId;
  breadcrumbs?: Breadcrumb[];
  onLogout: () => void;
  onNavigate?: (page: string) => void;
  onFocusSearch?: () => void;
  onOpenSubmission?: (id: string) => void;
  accessToken?: string;
  /** When set, auto-grounds the AI chat on this submission */
  activeSubmissionId?: string;
}

// ── Outer shell — only responsibility is mounting the provider ─────────────────

export function TeamDashboardLayout(props: TeamDashboardLayoutProps) {
  return (
    <GlobalAIChatProvider>
      <DashboardLayoutInner {...props} />
    </GlobalAIChatProvider>
  );
}

// ── Inner layout — safe to call useGlobalAIChat() here ────────────────────────

function DashboardLayoutInner({
  children,
  currentPage,
  breadcrumbs = [],
  onLogout,
  onNavigate,
  onFocusSearch,
  onOpenSubmission,
  accessToken,
  activeSubmissionId,
}: TeamDashboardLayoutProps) {
  // ── AI Chat context (safe — we are inside GlobalAIChatProvider) ────────────
  const { setAccessToken, setActiveLead } = useGlobalAIChat();

  useEffect(() => {
    setAccessToken(accessToken);
  }, [accessToken, setAccessToken]);

  useEffect(() => {
    if (!activeSubmissionId) return;
    const sub = getDemoSubmissions().find(s => s.id === activeSubmissionId);
    if (!sub) return;
    setActiveLead({
      id: sub.id,
      companyName: sub.company,
      contactName: sub.contact,
      industry: sub.industry,
      status: sub.status,
      priority: sub.priority,
      roiPotential: sub.roiPotential,
      qualityScore: sub.qualityScore,
      aiContext: {
        companyName: sub.company,
        industry: sub.industry,
        companySize: sub.employees,
        primaryPainSignal: `${sub.industry} business with ${sub.employees} employees — ROI potential ${sub.roiPotential}`,
        recommendedService: undefined,
        roiSummary: sub.roiPotential,
      },
    });
  }, [activeSubmissionId, setActiveLead]);

  // ── Dashboard context ──────────────────────────────────────────────────────
  const { state, setSidebarCollapsed, setActiveFilter, kanbanAlerts, markKanbanAlertsRead } =
    useDashboard();
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const sidebarCollapsed = state.viewPreferences.sidebarCollapsed;

  /**
   * Below this width the sidebar stops being a column and becomes a drawer.
   *
   * The shell had NO breakpoint at all: a fixed 280px sidebar sat beside the
   * content as a flex sibling under `h-screen overflow-hidden`, so on a 375px
   * phone the entire product ran in the remaining 95px. Ch. 21.10 asks for one
   * mental model across interaction modes — the same destinations, the same
   * grouping, the same order — and only the interaction changing. That is what
   * this is: the identical <nav>, presented as an overlay.
   */
  const isCompact = useMediaQuery('(max-width: 1023px)');
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Leaving compact width must not strand an open overlay over the desktop
  // layout, where there is no scrim to dismiss it.
  useEffect(() => {
    if (!isCompact) setDrawerOpen(false);
  }, [isCompact]);

  // A drawer that stays open behind the page it just navigated to is a drawer
  // covering the thing the operator asked for.
  const navigateAndClose = (page: string) => {
    setDrawerOpen(false);
    onNavigate?.(page);
  };

  const handleFocusSearch = () => {
    searchInputRef.current?.focus();
    onFocusSearch?.();
  };

  const commands = useCommandPaletteCommands({
    onNavigate: page => onNavigate?.(page),
    onToggleSidebar: () => setSidebarCollapsed(!sidebarCollapsed),
    onFocusSearch: handleFocusSearch,
    onSetFilter: filter => setActiveFilter(filter),
    submissions: state.searchableSubmissions,
    onOpenSubmission,
  });

  useKeyboardShortcuts({
    shortcuts: [
      {
        key: 'k',
        meta: isMac(),
        ctrl: !isMac(),
        description: 'Open command palette',
        action: () => setShowCommandPalette(true),
      },
      {
        key: '/',
        meta: isMac(),
        ctrl: !isMac(),
        description: 'Show keyboard shortcuts',
        action: () => setShowKeyboardHelp(true),
      },
      {
        key: '?',
        description: 'Show keyboard shortcuts',
        action: () => setShowKeyboardHelp(true),
      },
      {
        key: 'b',
        meta: isMac(),
        ctrl: !isMac(),
        description: 'Toggle sidebar',
        // At compact width there is no rail to collapse — the same intent
        // ("show me navigation") is the drawer. Ch. 21.10: one model, and only
        // the interaction changes.
        action: () =>
          isCompact ? setDrawerOpen(!drawerOpen) : setSidebarCollapsed(!sidebarCollapsed),
      },
      {
        key: 'Escape',
        description: 'Close navigation',
        // Registered only while the drawer is actually open, and it never
        // calls preventDefault: Escape belongs to whatever modal is on top
        // (the command palette, the shortcuts sheet), and this must not take
        // it from them.
        enabled: drawerOpen,
        preventDefault: false,
        action: () => setDrawerOpen(false),
      },
      // Ch. 21.4 — the accelerators are the third path to the same
      // destinations, so they are derived from the model rather than restated.
      ...SHORTCUT_DESTINATIONS.map(destination => ({
        key: String(destination.shortcutDigit),
        meta: isMac(),
        ctrl: !isMac(),
        description: `Go to ${destination.label}`,
        action: () => onNavigate?.(destination.id),
      })),
    ],
  });

  return (
    <div className="flex h-screen bg-[#0A0A0F] text-white overflow-hidden">
      {/* ── Scrim ───────────────────────────────────────────────────────
          Only at compact width, and only while the drawer is open. It is what
          makes "tap outside to dismiss" true. */}
      {isCompact && drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <motion.aside
        initial={false}
        animate={
          isCompact
            // As a drawer it is always full-width-for-a-drawer; collapsing it
            // to an icon rail would be a second, worse navigation on the screen
            // that can least afford one.
            //
            // `visibility` matters as much as `x`: off-screen is not the same
            // as absent, and a drawer left visible-but-translated keeps every
            // one of its controls in the tab order, where a keyboard user can
            // reach things they cannot see. Motion applies a discrete value
            // like this at the END of the outgoing animation and at the START
            // of the incoming one, so the slide still plays both ways.
            ? {
                width: 280,
                x: drawerOpen ? 0 : -280,
                visibility: drawerOpen ? 'visible' : 'hidden',
              }
            : { width: sidebarCollapsed ? 80 : 280, x: 0, visibility: 'visible' }
        }
        transition={{ type: 'tween', duration: 0.2 }}
        aria-hidden={isCompact && !drawerOpen ? true : undefined}
        className={
          isCompact
            ? 'fixed inset-y-0 left-0 z-50 bg-black/90 backdrop-blur-xl border-r border-white/10 flex flex-col'
            : 'bg-black/40 backdrop-blur-xl border-r border-white/10 flex flex-col'
        }
      >
        {/* Logo */}
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center justify-between">
            {(!sidebarCollapsed || isCompact) && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-3"
              >
                <div className="size-10 rounded-xl bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center">
                  <Brain className="size-5 text-white" />
                </div>
                <div>
                  <h2 className="font-bold text-lg">MARQ Cortex</h2>
                  <p className="text-xs text-gray-400">Internal Dashboard</p>
                </div>
              </motion.div>
            )}
            {/* At compact width this closes the drawer; at desktop width it
                collapses the rail, exactly as it always did. */}
            <button
              onClick={() =>
                isCompact ? setDrawerOpen(false) : setSidebarCollapsed(!sidebarCollapsed)
              }
              aria-label={
                isCompact
                  ? 'Close navigation'
                  : sidebarCollapsed
                    ? 'Expand sidebar'
                    : 'Collapse sidebar'
              }
              aria-expanded={isCompact ? drawerOpen : !sidebarCollapsed}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors"
            >
              {!isCompact && sidebarCollapsed ? (
                <Menu className="size-5 text-gray-400" />
              ) : (
                <X className="size-5 text-gray-400" />
              )}
            </button>
          </div>
        </div>

        {/* Nav items — grouped by intent (Ch. 21.2), read from the one
            navigation model every surface shares (Ch. 21.4). */}
        <nav className="flex-1 p-4 space-y-4 overflow-y-auto" aria-label="Primary">
          {NAV_GROUPS.map(group => (
            <div key={group.id} className="space-y-1">
              {/* The group heading is the operator's intent. Collapsed, the
                  heading would not fit, so the grouping is carried by the
                  separator alone and the labels move onto each button. */}
              {!sidebarCollapsed || isCompact ? (
                <p className="px-4 pt-1 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-600">
                  {group.label}
                </p>
              ) : (
                <div className="mx-3 border-t border-white/5" role="presentation" />
              )}

              {group.destinations.map(destination => {
                const Icon = destination.icon;
                const isActive = currentPage === destination.id;
                return (
                  <button
                    key={destination.id}
                    onClick={() => navigateAndClose(destination.id)}
                    aria-current={isActive ? 'page' : undefined}
                    /* Collapsed, only the icon renders. Without these the
                       collapsed sidebar is unreadable to a screen reader and
                       unlabelled on hover. */
                    title={sidebarCollapsed && !isCompact ? destination.label : undefined}
                    aria-label={destination.label}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all ${
                      isActive
                        ? 'bg-gradient-to-r from-[#8B5CF6]/20 to-[#3B82F6]/20 border border-[#8B5CF6]/30 text-white'
                        : 'hover:bg-white/5 text-gray-400 hover:text-white'
                    }`}
                  >
                    <Icon className="size-5 flex-shrink-0" />
                    {(!sidebarCollapsed || isCompact) && (
                      <span className="flex-1 text-left font-medium">{destination.label}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* User section */}
        <div className="p-4 border-t border-white/10">
          {(!sidebarCollapsed || isCompact) && (
            <div className="flex items-center gap-3 mb-3">
              <div className="size-10 rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center font-bold">
                TU
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">Team User</p>
                <p className="text-xs text-gray-400 truncate">team@example.com</p>
              </div>
            </div>
          )}
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-red-500/10 text-red-400 hover:text-red-300 transition-all"
          >
            <LogOut className="size-5 flex-shrink-0" />
            {(!sidebarCollapsed || isCompact) && <span className="font-medium">Logout</span>}
          </button>
        </div>
      </motion.aside>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-black/40 backdrop-blur-xl border-b border-white/10 px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <nav className="flex items-center gap-2 text-sm min-w-0" aria-label="Breadcrumb">
              {/* The only way to open the drawer. Without it, compact width has
                  no navigation at all — which is what the shell shipped with. */}
              {isCompact && (
                <button
                  onClick={() => setDrawerOpen(true)}
                  aria-label="Open navigation"
                  aria-expanded={drawerOpen}
                  className="-ml-1 mr-1 p-2 hover:bg-white/5 rounded-lg transition-colors flex-shrink-0"
                >
                  <PanelLeft className="size-5 text-gray-400" />
                </button>
              )}
              <button
                onClick={() => onNavigate?.('dashboard')}
                className="text-gray-400 hover:text-white transition-colors flex-shrink-0"
              >
                Dashboard
              </button>
              {breadcrumbs.map((crumb, i) => (
                <div key={i} className="flex items-center gap-2">
                  <ChevronRight className="size-4 text-gray-500 flex-shrink-0" />
                  {crumb.onClick ? (
                    <button
                      onClick={crumb.onClick}
                      className="text-gray-400 hover:text-white transition-colors"
                    >
                      {crumb.label}
                    </button>
                  ) : (
                    <span className="text-white font-medium truncate">{crumb.label}</span>
                  )}
                </div>
              ))}
            </nav>

            <div className="flex items-center gap-1 sm:gap-3 flex-shrink-0">
              <button
                aria-label="Search"
                className="p-2 hover:bg-white/5 rounded-lg transition-colors"
                onClick={handleFocusSearch}
              >
                <SearchIcon className="size-5 text-gray-400" />
              </button>
              <NotificationCenter
                accessToken={accessToken}
                onNavigateToSubmission={() => onNavigate?.('cortex')}
                liveAlerts={kanbanAlerts}
                onMarkLiveRead={markKanbanAlertsRead}
              />
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">{children}</main>
      </div>

      {/* ── Overlays ────────────────────────────────────────────────────── */}
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        commands={commands}
      />
      <KeyboardShortcutsHelp
        isOpen={showKeyboardHelp}
        onClose={() => setShowKeyboardHelp(false)}
      />
      <KanbanAlertToastStack kanbanAlerts={kanbanAlerts} onNavigate={onNavigate} />

      {/* Global AI Chat — floating on every page */}
      <GlobalAIChat />
    </div>
  );
}