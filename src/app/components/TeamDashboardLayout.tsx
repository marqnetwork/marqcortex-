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
  ChevronDown,
  Menu,
  X,
  PanelLeft,
  Search as SearchIcon,
} from 'lucide-react';
import { useDashboard } from '@/app/contexts/DashboardContext';
import { useApp } from '@/app/contexts/AppContext';
import { TEAM_ROLE_LABELS } from '@/app/lib/teamRole';
import {
  VISIBLE_NAV_GROUPS,
  SHORTCUT_DESTINATIONS,
  isSystemGroup,
  type DestinationId,
} from '@/app/core/navigationModel';
import { useKeyboardShortcuts, isMac } from '@/app/hooks/useKeyboardShortcuts';
import { useMediaQuery } from '@/app/hooks/usePerformance';
import { CommandPalette, useCommandPaletteCommands } from '@/app/components/CommandPalette';
import { DemoExperienceBanner } from '@/app/components/DemoExperienceBanner';
import { KeyboardShortcutsHelp } from '@/app/components/KeyboardShortcutsHelp';
import { NotificationCenter } from '@/app/components/NotificationCenter';
import { KanbanAlertToastStack } from '@/app/components/KanbanAlertToast';
import { GlobalAIChatProvider, useGlobalAIChat } from '@/app/contexts/GlobalAIChatContext';
import { GlobalAIChat } from '@/app/components/GlobalAIChat';

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


  // ── Dashboard context ──────────────────────────────────────────────────────
  const { state, setSidebarCollapsed, setActiveFilter, kanbanAlerts, markKanbanAlertsRead } =
    useDashboard();

  const loadedSubmissions = state.searchableSubmissions;

  /**
   * The signed-in operator, from the session — never a placeholder.
   *
   * An em dash where a name would be is the honest rendering of "the session
   * has not resolved a name yet"; a plausible-looking invented one is not.
   */
  const { teamUser, teamRole } = useApp();
  const accountName = teamUser?.name?.trim() || 'Signed in';
  const accountEmail = teamUser?.email?.trim() || '—';
  const accountRole = TEAM_ROLE_LABELS[teamRole] ?? teamRole;
  const accountInitials =
    accountName
      .split(/\s+/)
      .map(part => part[0])
      .filter(Boolean)
      .join('')
      .slice(0, 2)
      .toUpperCase() || '—';

  // The AI's notion of "the lead you are looking at" used to be resolved
  // against `getDemoSubmissions()` — so whatever record the operator had open,
  // the assistant was briefed on an invented company with the same position in
  // a fixture list, or on nothing. It resolves against the submissions this
  // session actually loaded, and when the id is not among them it sets no lead
  // rather than the wrong one.
  useEffect(() => {
    if (!activeSubmissionId) return;
    const sub = loadedSubmissions.find(s => s.id === activeSubmissionId);
    if (!sub) { setActiveLead(null); return; }
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
  }, [activeSubmissionId, loadedSubmissions, setActiveLead]);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  // Kept for the palette's own input, not for the header control — see
  // `handleFocusSearch`. It was never attached to anything, which is exactly
  // why the header's search button was a dead end.
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

  /**
   * Which folded nav groups the operator has opened, this session.
   *
   * Only groups made entirely of system-tier destinations are foldable, and a
   * fold is presentation, never reachability: the destinations inside stay in
   * the command palette and keep their accelerators whether the group is open
   * or shut (Ch. 21.8 — power users must never feel constrained).
   */
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const toggleGroup = (id: string) =>
    setOpenGroups(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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

  /**
   * The magnifier in the header.
   *
   * IT DID NOTHING, almost everywhere. It called `searchInputRef.current
   * ?.focus()` on a ref this layout declares and never attaches to any element,
   * then `onFocusSearch?.()`, which the shell implements as "focus the
   * submissions filter, IF the current page is the Dashboard". So on the other
   * nine destinations a person clicked a search icon and the focus ring landed
   * back on the button. Confirmed in a browser on Analytics: focus went
   * BODY → BUTTON and nothing opened.
   *
   * The product already has a global search that works on every destination and
   * searches both destinations and submissions — the command palette. The icon
   * promised search; this is the search it promised. The Dashboard's filter box
   * is still focused as well, where it exists, because that was a real (if
   * narrow) affordance and removing it would be a second change.
   */
  const handleFocusSearch = () => {
    setShowCommandPalette(true);
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
    <div className="flex h-screen bg-cortex-canvas text-white overflow-hidden">
      {/* The first thing a keyboard user reaches. Without it, every visit to
          every page starts by tabbing through the whole sidebar to get to the
          content — thirteen destinations and an account block, on every
          navigation. Visible only while focused. */}
      <a
        href="#cortex-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[60] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-cortex-accent focus:text-white focus:font-medium"
      >
        Skip to main content
      </a>

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
                <div className="size-10 rounded-xl bg-gradient-to-br from-cortex-accent to-cortex-accent-alt flex items-center justify-center">
                  <Brain className="size-5 text-white" aria-hidden="true" />
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
                  : sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'
              }
              aria-expanded={isCompact ? drawerOpen : !sidebarCollapsed}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors"
            >
              {!isCompact && sidebarCollapsed ? (
                <Menu className="size-5 text-gray-400" aria-hidden="true" />
              ) : (
                <X className="size-5 text-gray-400" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {/* Nav items — grouped by intent (Ch. 21.2), read from the one
            navigation model every surface shares (Ch. 21.4). */}
        <nav className="flex-1 p-4 space-y-4 overflow-y-auto" aria-label="Primary">
          {/* VISIBLE, not declared. CP-2's rule: a sidebar entry is a promise,
              and `capabilityStatus.ts` decides which destinations can keep one.
              A group whose members are all hidden does not render an empty
              heading — it does not render. */}
          {VISIBLE_NAV_GROUPS.map(group => {
            // A group of nothing but platform plumbing folds until asked for
            // (Ch. 13.1). It is a disclosure, not a hiding place: one click
            // opens it, and the command palette reaches inside it by name
            // whether it is open or shut.
            const foldable = isSystemGroup(group);
            const groupId = `nav-group-${group.id}`;
            const expanded = !foldable || openGroups.has(group.id);
            // A folded group cannot be allowed to hide the page the operator is
            // actually on — that would leave the sidebar showing no current
            // destination at all.
            const holdsCurrent = group.destinations.some(d => d.id === currentPage);
            const showEntries = expanded || holdsCurrent;

            return (
            <div key={group.id} className="space-y-1">
              {/* The group heading is the operator's intent. Collapsed, the
                  heading would not fit, so the grouping is carried by the
                  separator alone and the labels move onto each button. */}
              {!sidebarCollapsed || isCompact ? (
                foldable ? (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    aria-expanded={expanded}
                    aria-controls={groupId}
                    className="w-full flex items-center justify-between px-4 pt-1 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-600 hover:text-gray-400 transition-colors"
                  >
                    <span>{group.label}</span>
                    {expanded
                      ? <ChevronDown className="size-3" aria-hidden="true" />
                      : <ChevronRight className="size-3" aria-hidden="true" />}
                  </button>
                ) : (
                  <p className="px-4 pt-1 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-600">
                    {group.label}
                  </p>
                )
              ) : (
                <div className="mx-3 border-t border-white/5" role="presentation" />
              )}

              <div id={groupId} hidden={!showEntries}>
              {group.destinations.map(destination => {
                const Icon = destination.icon;
                const isActive = currentPage === destination.id;
                return (
                  <button
                    key={destination.id}
                    onClick={() => navigateAndClose(destination.id)}
                    aria-current={isActive ? 'page' : undefined}
                    /* The destination's own id, on the control that goes there.
                       `tests/smoke/navigation-truth.spec.ts` reads the full
                       registered list off the rendered sidebar and drives every
                       entry, so a destination added to NAV_GROUPS is tested
                       without anybody adding it to a list in the test. */
                    data-destination={destination.id}
                    /* Collapsed, only the icon renders. Without these the
                       collapsed sidebar is unreadable to a screen reader and
                       unlabelled on hover. */
                    title={sidebarCollapsed && !isCompact ? destination.label : undefined}
                    aria-label={destination.label}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all ${
                      isActive
                        ? 'bg-gradient-to-r from-cortex-accent/20 to-cortex-accent-alt/20 border border-cortex-accent/30 text-white'
                        : 'hover:bg-white/5 text-gray-400 hover:text-white'
                    }`}
                  >
                    <Icon className="size-5 flex-shrink-0" aria-hidden="true" />
                    {(!sidebarCollapsed || isCompact) && (
                      <span className="flex-1 text-left font-medium">{destination.label}</span>
                    )}
                  </button>
                );
              })}
              </div>
            </div>
            );
          })}
        </nav>

        {/* ── WHO IS SIGNED IN ────────────────────────────────────────────
            "Team User", "team@example.com" and the initials "TU" were literals.
            Every operator, on every screen, in every configuration, saw the same
            invented person in the account block — beside a greeting three feet
            away that used their real name, and above the Sign out button. It is
            the smallest fabrication CP-1 found and the one hardest to argue was
            ever intentional. */}
        <div className="p-4 border-t border-white/10">
          {(!sidebarCollapsed || isCompact) && (
            <div className="flex items-center gap-3 mb-3">
              <div className="size-10 rounded-full bg-gradient-to-br from-cortex-accent to-cortex-accent-alt flex items-center justify-center font-bold">
                {accountInitials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">{accountName}</p>
                <p className="text-xs text-gray-400 truncate">{accountEmail}</p>
                {/* The role decides what the server will let this person do,
                    and the shell knew it and did not say it. Six roles exist;
                    which one you hold is the difference between the Team
                    surface working and refusing. */}
                <p className="text-[10px] text-gray-500 truncate">{accountRole}</p>
              </div>
            </div>
          )}
          <button
            onClick={onLogout}
            aria-label="Sign out"
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-red-500/10 text-red-400 hover:text-red-300 transition-all"
          >
            <LogOut className="size-5 flex-shrink-0" aria-hidden="true" />
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
                  <PanelLeft className="size-5 text-gray-400" aria-hidden="true" />
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
                  <ChevronRight className="size-4 text-gray-500 flex-shrink-0" aria-hidden="true" />
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
                title={`Search (${isMac() ? "\u2318" : "Ctrl+"}K)`}
                className="p-2 hover:bg-white/5 rounded-lg transition-colors"
                onClick={handleFocusSearch}
              >
                <SearchIcon className="size-5 text-gray-400" aria-hidden="true" />
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

        {/* If this build serves fabricated data, it says so, above the work and
            on every destination. Renders nothing in any other configuration. */}
        <DemoExperienceBanner />

        {/* Page content */}
        {/* WHICH DESTINATION IS ACTUALLY ON SCREEN.
            The deep-link suite used to answer that question by comparing the
            first 40 characters of `#cortex-main`'s text between two loads —
            which cannot distinguish two destinations that happen to start the
            same way, and cannot detect a silent fallback to the Dashboard at
            all if both loads fall back. The shell knows the answer; it says so. */}
        <main
          id="cortex-main"
          data-destination={currentPage}
          tabIndex={-1}
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