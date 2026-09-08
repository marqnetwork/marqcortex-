/**
 * PERSISTENT TEAM DASHBOARD LAYOUT
 *
 * Two-layer pattern:
 *   TeamDashboardLayout  — mounts GlobalAIChatProvider, then delegates to DashboardLayoutInner
 *   DashboardLayoutInner — lives INSIDE the provider, safe to call useGlobalAIChat()
 *
 * ── WHAT UI SPRINT 7 CHANGED, AND WHY ────────────────────────────────────────
 *
 * 1. THE SIDEBAR NAMED A PERSON WHO DOES NOT EXIST. It rendered "Team User",
 *    "team@example.com" and the initials "TU" as literals, for every session,
 *    while `AppContext` had held the authenticated member all along. A console
 *    that shows a fake identity beside real data teaches the user not to trust
 *    either. It now reads the signed-in member and their role.
 *
 * 2. ELEVEN FLAT ENTRIES, IN CODEBASE ORDER. §4.8 asks that a first-time user
 *    immediately understand how to begin and never feel overwhelmed; §13.1
 *    names organising navigation around the codebase, and exposing internal
 *    architecture, as anti-patterns. The entries now come from `NAV_MODEL`,
 *    grouped by the work they serve, with the two system tools folded behind a
 *    disclosure. Nothing was removed: every page is one click away, the
 *    disclosure remembers being opened, and the command palette reaches all of
 *    them by name.
 *
 * 3. NO COMPACT LAYOUT AT ALL. A 280px sidebar sat in the page flow at every
 *    width, so a narrow viewport lost most of the content area to navigation.
 *    Below `lg` the sidebar is now an overlay drawer, opened from the header,
 *    dismissed by Escape or a click outside — and it is not RENDERED when
 *    closed, so it is not in the tab order and not read aloud either.
 *
 * 4. NOTHING WAS REACHABLE BY KEYBOARD OR SCREEN READER IN ANY ORDERLY WAY.
 *    There is now a skip link, a labelled navigation landmark, labelled groups,
 *    `aria-current` on the active entry, an `aria-expanded` disclosure, and an
 *    accessible name on every icon-only control.
 */

import { useState, type ReactNode, useRef, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  LogOut,
  ChevronRight,
  ChevronDown,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Search as SearchIcon,
  Brain,
} from 'lucide-react';
import { useDashboard } from '@/app/contexts/DashboardContext';
import { useApp } from '@/app/contexts/AppContext';
import { useKeyboardShortcuts, isMac } from '@/app/hooks/useKeyboardShortcuts';
import { useIsCompactViewport } from '@/app/hooks/useViewport';
import { CommandPalette, useCommandPaletteCommands } from '@/app/components/CommandPalette';
import { KeyboardShortcutsHelp } from '@/app/components/KeyboardShortcutsHelp';
import { NotificationCenter } from '@/app/components/NotificationCenter';
import { KanbanAlertToastStack } from '@/app/components/KanbanAlertToast';
import { GlobalAIChatProvider, useGlobalAIChat } from '@/app/contexts/GlobalAIChatContext';
import { GlobalAIChat } from '@/app/components/GlobalAIChat';
import { getDemoSubmissions } from '@/app/services/dataService';
import { navigationGroups, navEntry } from '@/app/core/orientation';
import { navIconFor } from '@/app/lib/navIcons';
import { TEAM_ROLE_LABELS } from '@/app/lib/teamRole';

// ── Shared types ───────────────────────────────────────────────────────────────

export interface Breadcrumb {
  label: string;
  onClick?: () => void;
}

export interface TeamDashboardLayoutProps {
  children: ReactNode;
  /**
   * The page currently rendered. Typed as the page key rather than a closed
   * union so the shell and `NAV_MODEL` cannot drift; `orientation.test.ts`
   * asserts the model covers every page the shell renders.
   */
  currentPage: string;
  breadcrumbs?: Breadcrumb[];
  onLogout: () => void;
  onNavigate?: (page: string) => void;
  onFocusSearch?: () => void;
  onOpenSubmission?: (id: string) => void;
  accessToken?: string;
  /** When set, auto-grounds the AI chat on this submission */
  activeSubmissionId?: string;
}

/** Remembers that the system group was opened, across reloads of this tab. */
const SYSTEM_GROUP_KEY = 'marq_cortex_nav_system_open';

function readSystemGroupOpen(): boolean {
  try {
    return sessionStorage.getItem(SYSTEM_GROUP_KEY) === 'true';
  } catch {
    return false;
  }
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

  // ── Who is signed in ───────────────────────────────────────────────────────
  // Real session state. This block used to be three string literals.
  const { teamUser, teamRole } = useApp();
  const displayName = teamUser?.name?.trim() || 'Your account';
  const displayEmail = teamUser?.email ?? '';
  const initials = useMemo(() => {
    const source = teamUser?.name?.trim();
    if (!source) return '—';
    return source
      .split(/\s+/)
      .map(part => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }, [teamUser]);

  // ── Dashboard context ──────────────────────────────────────────────────────
  const { state, setSidebarCollapsed, setActiveFilter, kanbanAlerts, markKanbanAlertsRead } =
    useDashboard();
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [systemGroupOpen, setSystemGroupOpen] = useState(readSystemGroupOpen);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const isCompact = useIsCompactViewport();

  // On a narrow viewport the sidebar is an overlay, so "collapsed to 80px" —
  // a wide-layout affordance — must not apply to it.
  const sidebarCollapsed = !isCompact && state.viewPreferences.sidebarCollapsed;

  const groups = useMemo(() => navigationGroups(), []);

  // Navigating always closes the drawer: on a narrow viewport the destination
  // is behind the overlay the user just tapped through.
  const goTo = (page: string) => {
    setDrawerOpen(false);
    onNavigate?.(page);
  };

  const toggleSystemGroup = () => {
    setSystemGroupOpen(open => {
      const next = !open;
      try { sessionStorage.setItem(SYSTEM_GROUP_KEY, String(next)); } catch { /* storage unavailable */ }
      return next;
    });
  };

  // The drawer closes on Escape, like every other transient overlay here.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  // Widening the viewport past the breakpoint leaves no overlay behind.
  useEffect(() => {
    if (!isCompact) setDrawerOpen(false);
  }, [isCompact]);

  const handleFocusSearch = () => {
    searchInputRef.current?.focus();
    onFocusSearch?.();
  };

  const commands = useCommandPaletteCommands({
    onNavigate: page => goTo(page),
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
        action: () => (isCompact ? setDrawerOpen(open => !open) : setSidebarCollapsed(!sidebarCollapsed)),
      },
      {
        key: '1',
        meta: isMac(),
        ctrl: !isMac(),
        description: 'Go to Dashboard',
        action: () => goTo('dashboard'),
      },
      {
        key: '2',
        meta: isMac(),
        ctrl: !isMac(),
        description: 'Go to CORTEX',
        action: () => goTo('cortex'),
      },
      {
        key: '3',
        meta: isMac(),
        ctrl: !isMac(),
        description: 'Go to Team',
        action: () => goTo('team'),
      },
      {
        key: '4',
        meta: isMac(),
        ctrl: !isMac(),
        description: 'Go to Settings',
        action: () => goTo('settings'),
      },
    ],
  });

  // ── Sidebar body — one definition, rendered in the column or the drawer ────
  const sidebarBody = (
    <>
      {/* Logo */}
      <div className="p-6 border-b border-white/10">
        <div className="flex items-center justify-between">
          {!sidebarCollapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-3"
            >
              <div className="size-10 rounded-xl bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center">
                <Brain className="size-5 text-white" aria-hidden="true" />
              </div>
              <div>
                <h2 className="font-bold text-lg">MARQ Cortex</h2>
                <p className="text-xs text-gray-400">Team workspace</p>
              </div>
            </motion.div>
          )}
          {isCompact ? (
            <button
              onClick={() => setDrawerOpen(false)}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors"
              aria-label="Close navigation"
            >
              <X className="size-5 text-gray-400" aria-hidden="true" />
            </button>
          ) : (
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors"
              aria-label={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
              aria-expanded={!sidebarCollapsed}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="size-5 text-gray-400" aria-hidden="true" />
              ) : (
                <PanelLeftClose className="size-5 text-gray-400" aria-hidden="true" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 p-4 space-y-4 overflow-y-auto" aria-label="Primary">
        {groups.map(group => {
          const groupId = `nav-group-${group.label.toLowerCase().replace(/\s+/g, '-')}`;
          const expanded = !group.collapsible || systemGroupOpen;

          return (
            <div key={group.label}>
              {/* A collapsible group gets a real disclosure button; a permanent
                  one gets a heading. Both label the list that follows. */}
              {group.collapsible ? (
                <button
                  id={`${groupId}-label`}
                  onClick={toggleSystemGroup}
                  aria-expanded={expanded}
                  aria-controls={groupId}
                  className="w-full flex items-center gap-2 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-300 transition-colors"
                >
                  <ChevronDown
                    className={`size-3.5 flex-shrink-0 transition-transform ${expanded ? '' : '-rotate-90'}`}
                    aria-hidden="true"
                  />
                  {!sidebarCollapsed && <span>{group.label}</span>}
                </button>
              ) : (
                !sidebarCollapsed && (
                  <h3
                    id={`${groupId}-label`}
                    className="px-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500"
                  >
                    {group.label}
                  </h3>
                )
              )}

              {expanded && (
                <ul id={groupId} aria-labelledby={`${groupId}-label`} className="space-y-1">
                  {group.entries.map(entry => {
                    const Icon = navIconFor(entry.id);
                    const isActive = currentPage === entry.id;
                    return (
                      <li key={entry.id}>
                        <button
                          onClick={() => goTo(entry.id)}
                          aria-current={isActive ? 'page' : undefined}
                          // The label survives the collapsed sidebar, where the
                          // text is hidden but the control is still focusable.
                          aria-label={entry.label}
                          title={sidebarCollapsed ? `${entry.label} — ${entry.description}` : entry.description}
                          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                            isActive
                              ? 'bg-gradient-to-r from-[#8B5CF6]/20 to-[#3B82F6]/20 border border-[#8B5CF6]/30 text-white'
                              : 'hover:bg-white/5 text-gray-400 hover:text-white'
                          }`}
                        >
                          <Icon className="size-5 flex-shrink-0" aria-hidden="true" />
                          {!sidebarCollapsed && (
                            <span className="flex-1 text-left font-medium">{entry.label}</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      {/* User section — the signed-in member, not a placeholder */}
      <div className="p-4 border-t border-white/10">
        {!sidebarCollapsed && (
          <div className="flex items-center gap-3 mb-3">
            <div
              className="size-10 rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center font-bold"
              aria-hidden="true"
            >
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm truncate">{displayName}</p>
              <p className="text-xs text-gray-400 truncate">
                {displayEmail ? `${displayEmail} · ` : ''}
                {TEAM_ROLE_LABELS[teamRole]}
              </p>
            </div>
          </div>
        )}
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-red-500/10 text-red-400 hover:text-red-300 transition-all"
          aria-label="Sign out"
        >
          <LogOut className="size-5 flex-shrink-0" aria-hidden="true" />
          {!sidebarCollapsed && <span className="font-medium">Sign out</span>}
        </button>
      </div>
    </>
  );

  const activeEntry = navEntry(currentPage);

  return (
    <div className="flex h-screen bg-[#0A0A0F] text-white overflow-hidden">
      {/* Keyboard users reach the content without walking the whole sidebar. */}
      <a
        href="#cortex-main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-3 focus:left-3 focus:px-4 focus:py-2 focus:rounded-lg focus:bg-[#8B5CF6] focus:text-white focus:font-semibold"
      >
        Skip to main content
      </a>

      {/* ── Sidebar, wide layout ─────────────────────────────────────────── */}
      {!isCompact && (
        <motion.aside
          initial={false}
          animate={{ width: sidebarCollapsed ? 80 : 280 }}
          className="bg-black/40 backdrop-blur-xl border-r border-white/10 flex flex-col flex-shrink-0"
        >
          {sidebarBody}
        </motion.aside>
      )}

      {/* ── Sidebar, compact layout — an overlay drawer ───────────────────── */}
      {/* Not rendered when closed: a drawer hidden only by CSS is still
          focusable and still announced. */}
      {isCompact && drawerOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside
            className="fixed inset-y-0 left-0 z-50 w-[280px] max-w-[85vw] bg-[#0A0A0F] border-r border-white/10 flex flex-col"
            aria-label="Navigation"
          >
            {sidebarBody}
          </aside>
        </>
      )}

      {/* ── Main content ────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Header */}
        <header className="bg-black/40 backdrop-blur-xl border-b border-white/10 px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {isCompact && (
                <button
                  onClick={() => setDrawerOpen(true)}
                  className="p-2 hover:bg-white/5 rounded-lg transition-colors flex-shrink-0"
                  aria-label="Open navigation"
                  aria-expanded={drawerOpen}
                >
                  <Menu className="size-5 text-gray-400" aria-hidden="true" />
                </button>
              )}

              <nav className="flex items-center gap-2 text-sm min-w-0" aria-label="Breadcrumb">
                <button
                  onClick={() => goTo('dashboard')}
                  className="text-gray-400 hover:text-white transition-colors flex-shrink-0"
                >
                  Dashboard
                </button>
                {/* On a narrow viewport the breadcrumb trail collapses to the
                    page you are on — the trail is orientation, not decoration,
                    and a wrapped one orients nobody. */}
                {(isCompact ? breadcrumbs.slice(-1) : breadcrumbs).map((crumb, i) => (
                  <div key={i} className="flex items-center gap-2 min-w-0">
                    <ChevronRight className="size-4 text-gray-500 flex-shrink-0" aria-hidden="true" />
                    {crumb.onClick ? (
                      <button
                        onClick={crumb.onClick}
                        className="text-gray-400 hover:text-white transition-colors truncate"
                      >
                        {crumb.label}
                      </button>
                    ) : (
                      <span className="text-white font-medium truncate">{crumb.label}</span>
                    )}
                  </div>
                ))}
              </nav>
            </div>

            <div className="flex items-center gap-3 flex-shrink-0">
              <button
                className="p-2 hover:bg-white/5 rounded-lg transition-colors"
                onClick={handleFocusSearch}
                aria-label="Search submissions"
              >
                <SearchIcon className="size-5 text-gray-400" aria-hidden="true" />
              </button>
              <NotificationCenter
                accessToken={accessToken}
                onNavigateToSubmission={() => goTo('cortex')}
                liveAlerts={kanbanAlerts}
                onMarkLiveRead={markKanbanAlertsRead}
              />
            </div>
          </div>
        </header>

        {/* Page content */}
        <main
          id="cortex-main"
          tabIndex={-1}
          aria-label={activeEntry ? activeEntry.label : 'Main content'}
          className="flex-1 overflow-auto"
        >
          {children}
        </main>
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
