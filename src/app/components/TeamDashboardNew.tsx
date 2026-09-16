/**
 * REFACTORED TEAM DASHBOARD WITH PERSISTENT LAYOUT
 * 
 * This version uses TeamDashboardLayout to provide:
 * - Persistent sidebar navigation
 * - Persistent header with breadcrumbs
 * - Consistent logout button
 * - No more getting lost in navigation!
 *
 * ── PERFORMANCE ───────────────────────────────────────────────────────────────
 * All 8 panel components are React.lazy split points. Only the panel the user
 * is currently viewing is in the JS chunk list; every other panel's module
 * (recharts, motion tree-shake aside, heavy engine imports, etc.) loads on
 * first navigation to that panel, not on TeamDashboard mount.
 */

import { useEffect, useState, useRef, lazy, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { TeamDashboardLayout } from '@/app/components/TeamDashboardLayout';
import type { Breadcrumb } from '@/app/components/TeamDashboardLayout';
import { DashboardProvider, useDashboard } from '@/app/contexts/DashboardContext';
import {
  SHELL_DESTINATIONS,
  destinationLabel,
  externalRouteFor,
  PAGE_PARAM,
  type DestinationId,
} from '@/app/core/navigationModel';
import { LoadingState } from '@/app/components/ui/cortex';

// ── Lazy panels ───────────────────────────────────────────────────────────────
// Each import() is its own Vite split point.
const CortexDashboard            = lazy(() => import('@/app/components/CortexDashboard').then(m => ({ default: m.CortexDashboard })));
const TeamManagement             = lazy(() => import('@/app/components/TeamManagement').then(m => ({ default: m.TeamManagement })));
const SettingsPage               = lazy(() => import('@/app/components/SettingsPage').then(m => ({ default: m.SettingsPage })));
const ReviewerDashboard          = lazy(() => import('@/app/components/ReviewerDashboard').then(m => ({ default: m.ReviewerDashboard })));
const AnalyticsDashboard         = lazy(() => import('@/app/components/AnalyticsDashboard').then(m => ({ default: m.AnalyticsDashboard })));
const EmailNurturePanel          = lazy(() => import('@/app/components/EmailNurturePanel').then(m => ({ default: m.EmailNurturePanel })));
const RevenueIntelligenceDashboard = lazy(() => import('@/app/components/RevenueIntelligenceDashboard').then(m => ({ default: m.RevenueIntelligenceDashboard })));
const TeamHomeDashboard          = lazy(() => import('@/app/components/TeamHomeDashboard').then(m => ({ default: m.TeamHomeDashboard })));
const MappingEnginePanel         = lazy(() => import('@/app/components/MappingEnginePanel').then(m => ({ default: m.MappingEnginePanel })));
// The AI Control Plane, as a first-class destination. This is the SAME console
// the Settings "AI" tab mounts, not a copy: Ch. 21.4 wants many paths to one
// canonical entity. It resolves the operator's role server-side and renders its
// own unauthorized state, exactly as it does under Settings.
const AIAdministrationConsole    = lazy(() => import('@/app/components/AIAdministrationConsole').then(m => ({ default: m.AIAdministrationConsole })));
// Operational awareness (§IV-51 health, §IV-48 KPIs).
const OperationsPanel            = lazy(() => import('@/app/components/OperationsPanel').then(m => ({ default: m.OperationsPanel })));

/**
 * Shown while a lazily-split panel's chunk is downloading.
 *
 * This was a hand-built skeleton with its own hard-coded surface colour, radius
 * and keyframes — and no accessible name, so a screen-reader user got silence
 * for the length of the download. It is now the shared `LoadingState`, which
 * announces the wait and is styled from the token layer like every other
 * loading surface in the console.
 */
function PanelSkeleton() {
  return (
    <div className="p-8">
      <LoadingState label="Loading this section" rows={5} />
    </div>
  );
}

interface TeamDashboardProps {
  onLogout: () => void;
  accessToken?: string;
}

export default function TeamDashboard({ onLogout, accessToken }: TeamDashboardProps) {
  return (
    <DashboardProvider>
      <TeamDashboardContent onLogout={onLogout} accessToken={accessToken} />
    </DashboardProvider>
  );
}

// The navigation model owns the destination list; this alias keeps the local
// name while the single source of truth stays in one place (Ch. 21.4).
type PageView = DestinationId;

/**
 * The destinations this shell renders in place.
 *
 * Derived from the model's `externalRoute` field rather than from a hand-kept
 * list. The previous version restated `['execution', 'architecture']` here as a
 * literal, which meant the shell and `handleNavigate` each knew half of a fact
 * neither could check against the other.
 */
const SHELL_PAGES: ReadonlySet<DestinationId> = new Set(
  SHELL_DESTINATIONS.map(d => d.id),
);

/**
 * RECOVERY FROM A REFRESH.
 *
 * The shell used to keep the page in `useState`, seeded from a sessionStorage
 * key that was read and DELETED in the same breath — so a refresh, a reconnect
 * or an accidental reload mid-review always dropped the operator back on the
 * dashboard, losing where they were with no warning. The URL is now the record,
 * which restores on refresh, survives a shared link and makes Back mean what it
 * says.
 *
 * THREE ANSWERS, NOT TWO. The previous version returned a `PageView` and so had
 * only "this destination" or "the dashboard" to choose between — which is why
 * `?page=execution` rendered the Dashboard. `execution` is a REAL destination
 * that this shell cannot render, and collapsing it into the fallback made a
 * correct URL behave exactly like a typo.
 *
 *   { kind: 'shell' }    render it here
 *   { kind: 'external' } it lives at its own route — go there
 *   { kind: 'unknown' }  a typo, or an id that no longer exists — the dashboard
 *
 * Only the third falls back, and falling back is right for it: `?page=nonsense`
 * is user-typed and must land somewhere real rather than on an error screen.
 */
type Resolution =
  | { kind: 'shell'; page: PageView }
  | { kind: 'external'; route: string }
  | { kind: 'unknown' };

function resolvePage(raw: string | null): Resolution {
  if (!raw) return { kind: 'shell', page: 'dashboard' };
  if (SHELL_PAGES.has(raw as DestinationId)) return { kind: 'shell', page: raw as PageView };
  const external = externalRouteFor(raw as DestinationId);
  if (external) return { kind: 'external', route: external };
  return { kind: 'unknown' };
}

function TeamDashboardContent({ onLogout, accessToken }: TeamDashboardProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { state, setCortexState, resetState } = useDashboard();

  // The URL is the source of truth for which destination is showing, so Back,
  // Forward, a refresh and a shared link all agree with the sidebar.
  const resolution = resolvePage(searchParams.get(PAGE_PARAM));
  const currentPage: PageView = resolution.kind === 'shell' ? resolution.page : 'dashboard';

  /**
   * A URL naming a destination that lives outside this shell.
   *
   * `#/team/dashboard?page=execution` used to render the Dashboard, silently.
   * It now goes where the URL says. `replace: true` because the shell URL was
   * never a place the operator meant to be — leaving it in history would put a
   * Back press onto a redirect that immediately fires again.
   */
  const externalRoute = resolution.kind === 'external' ? resolution.route : null;
  useEffect(() => {
    if (externalRoute) navigate(externalRoute, { replace: true });
  }, [externalRoute, navigate]);

  const setCurrentPage = (page: PageView) => {
    setSearchParams(
      previous => {
        const next = new URLSearchParams(previous);
        // The dashboard is the shell's root; it needs no parameter, and
        // carrying one would make two URLs for one place.
        if (page === 'dashboard') next.delete(PAGE_PARAM);
        else next.set(PAGE_PARAM, page);
        return next;
      },
      // A destination change is a navigation, so it belongs in history: Back
      // returns to where the operator came from, which is the whole point.
      { replace: false },
    );
  };
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Use CORTEX state from context
  const cortexState = state.cortexState;

  // Handle logout with state reset
  const handleLogout = () => {
    resetState();
    onLogout();
  };

  // Handle search focus
  const handleFocusSearch = () => {
    if (currentPage === 'dashboard') {
      searchInputRef.current?.focus();
    }
  };

  // Generate breadcrumbs based on current page
  const getBreadcrumbs = (): Breadcrumb[] => {
    switch (currentPage) {
      case 'cortex':
        const breadcrumbs: Breadcrumb[] = [
          { 
            label: 'CORTEX', 
            onClick: cortexState.view !== 'overview' 
              ? () => setCortexState({ view: 'overview' })
              : undefined
          }
        ];
        
        if (cortexState.view === 'detail') {
          breadcrumbs.push({ label: 'Lead Detail' });
        } else if (cortexState.view === 'insights') {
          breadcrumbs.push({ label: 'Learning Insights' });
        }
        
        return breadcrumbs;
        
      // Every other page is named once, by the navigation model. These cases
      // used to be eight hand-written labels that had already drifted from the
      // sidebar's — the same page was "Reviewer QA" in the sidebar and
      // "Reviewer Dashboard" in the trail, which is precisely the kind of
      // small inconsistency that makes a user doubt they are where they think
      // they are.
      // The header always renders "Dashboard" as the trail's root, so the home
      // page adds nothing after it.
      case 'dashboard':
        return [];

      default:
        // Ch. 21.12 — orientation is continuous. A destination with no bespoke
        // trail still says where the operator is, using the same label the
        // sidebar used to get them here.
        return [{ label: destinationLabel(currentPage) }];
    }
  };

  // Handle navigation between pages
  const handleNavigate = (page: string) => {
    // Destinations that live outside this shell — read from the navigation
    // model rather than restated here. These two `if (page === …)` branches
    // were the ONLY record that `execution` and `architecture` have their own
    // routes, so the sidebar knew and the URL did not.
    const route = externalRouteFor(page as DestinationId);
    if (route) {
      navigate(route);
      return;
    }
    setCurrentPage(page as PageView);
    // Always reset state when switching pages so CORTEX starts at overview
    setCortexState({ view: 'overview' });
    setSelectedSubmissionId(null);
  };

  // Handle back from CORTEX
  const handleBackFromCortex = () => {
    setCurrentPage('dashboard');
    setCortexState({ view: 'overview' });
  };

  // Handle view CORTEX
  const handleViewCortex = (submissionId: string) => {
    setSelectedSubmissionId(submissionId);
    setCurrentPage('cortex');
  };

  return (
    <TeamDashboardLayout
      currentPage={currentPage}
      breadcrumbs={getBreadcrumbs()}
      onLogout={handleLogout}
      onNavigate={handleNavigate}
      onFocusSearch={handleFocusSearch}
      onOpenSubmission={(id) => {
        setSelectedSubmissionId(id);
        setCurrentPage('cortex');
        setCortexState({ view: 'detail', leadId: id });
      }}
      accessToken={accessToken}
    >
      {/* Render content based on current page - use key to force remount */}
      {currentPage === 'dashboard' && (
        <Suspense fallback={<PanelSkeleton />}>
          <TeamHomeDashboard
            key="dashboard-page"
            onViewCortex={handleViewCortex}
            onNavigate={handleNavigate}
            searchInputRef={searchInputRef}
            onSubmissionSelect={setSelectedSubmissionId}
            accessToken={accessToken}
          />
        </Suspense>
      )}

      {currentPage === 'cortex' && (
        <Suspense fallback={<PanelSkeleton />}>
          <CortexDashboard 
            key="cortex-page"
            onBack={handleBackFromCortex}
            onStateChange={setCortexState}
            currentState={cortexState}
            submissionId={selectedSubmissionId || undefined}
            accessToken={accessToken}
          />
        </Suspense>
      )}

      {currentPage === 'team' && (
        <Suspense fallback={<PanelSkeleton />}>
          <TeamManagement key="team-page" accessToken={accessToken} />
        </Suspense>
      )}

      {currentPage === 'settings' && (
        <Suspense fallback={<PanelSkeleton />}>
          <SettingsPage key="settings-page" accessToken={accessToken} />
        </Suspense>
      )}

      {currentPage === 'analytics' && (
        <Suspense fallback={<PanelSkeleton />}>
          <AnalyticsDashboard key="analytics-page" accessToken={accessToken} />
        </Suspense>
      )}

      {currentPage === 'reviewer' && (
        <Suspense fallback={<PanelSkeleton />}>
          <ReviewerDashboard key="reviewer-page" />
        </Suspense>
      )}

      {currentPage === 'emails' && (
        <Suspense fallback={<PanelSkeleton />}>
          <EmailNurturePanel key="emails-page" />
        </Suspense>
      )}

      {currentPage === 'revenue' && (
        <Suspense fallback={<PanelSkeleton />}>
          <RevenueIntelligenceDashboard key="revenue-page" accessToken={accessToken} />
        </Suspense>
      )}

      {currentPage === 'mapping' && (
        <Suspense fallback={<PanelSkeleton />}>
          <MappingEnginePanel key="mapping-page" />
        </Suspense>
      )}

      {currentPage === 'control-plane' && (
        <Suspense fallback={<PanelSkeleton />}>
          <AIAdministrationConsole key="control-plane-page" accessToken={accessToken} />
        </Suspense>
      )}

      {currentPage === 'operations' && (
        <Suspense fallback={<PanelSkeleton />}>
          <OperationsPanel key="operations-page" accessToken={accessToken} />
        </Suspense>
      )}

      {/* Fallback. Derived from the destinations this shell actually renders —
          'execution' and 'architecture' are handled by handleNavigate, which
          leaves the shell entirely, so they never become currentPage. */}
      {!SHELL_PAGES.has(currentPage) && (
        <div className="p-6 text-center">
          <div className="text-red-500 text-xl mb-2">⚠️ ERROR</div>
          <div className="text-white">Invalid page: {currentPage}</div>
          <button
            onClick={() => setCurrentPage('dashboard')}
            className="mt-4 px-6 py-2 bg-purple-600 rounded-lg"
          >
            Go to Dashboard
          </button>
        </div>
      )}
    </TeamDashboardLayout>
  );
}