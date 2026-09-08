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

import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router';
import { TeamDashboardLayout } from '@/app/components/TeamDashboardLayout';
import type { Breadcrumb } from '@/app/components/TeamDashboardLayout';
import { DashboardProvider, useDashboard } from '@/app/contexts/DashboardContext';
import { restorablePage, navEntry, TEAM_DASHBOARD_PAGE_KEY } from '@/app/core/orientation';

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

// ── Panel skeleton shown while a lazy chunk is loading ────────────────────────
function PanelSkeleton() {
  return (
    <div style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {[80, 60, 100, 60, 80].map((w, i) => (
        <div
          key={i}
          style={{
            height: i === 0 ? '40px' : '20px',
            width: `${w}%`,
            borderRadius: '8px',
            background: 'rgba(255,255,255,0.05)',
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        />
      ))}
      <style>{`@keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:.8} }`}</style>
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

type PageView = 'dashboard' | 'cortex' | 'team' | 'settings' | 'reviewer' | 'analytics' | 'emails' | 'revenue' | 'execution' | 'mapping' | 'architecture';

/**
 * RECOVERY FROM A REFRESH.
 *
 * This used to read the stored page and DELETE it in the same breath, which
 * made the value a one-shot handoff from the execution route and nothing else.
 * The consequence was that a browser refresh — or a reconnect, or an
 * accidental reload mid-review — always dropped the user back on the dashboard,
 * losing where they were with no warning and no way back but re-navigating.
 *
 * The page is now WRITTEN on every change and read back on mount, so the shell
 * resumes where it was. `restorablePage` accepts only page keys the navigation
 * model knows, so a stale key from an older bundle, or a value edited in the
 * browser's own storage, resolves to the dashboard instead of leaving the shell
 * rendering nothing. The record is cleared on sign-out.
 */
function readInitialPage(): PageView {
  try {
    return restorablePage(sessionStorage.getItem(TEAM_DASHBOARD_PAGE_KEY)) as PageView;
  } catch {
    // sessionStorage unavailable (private mode, blocked storage) — the shell
    // still works, it just cannot resume.
    return 'dashboard';
  }
}

function rememberPage(page: PageView): void {
  try {
    sessionStorage.setItem(TEAM_DASHBOARD_PAGE_KEY, page);
  } catch {
    // Storage unavailable — resuming is a convenience, never a requirement.
  }
}

function forgetPage(): void {
  try {
    sessionStorage.removeItem(TEAM_DASHBOARD_PAGE_KEY);
  } catch {
    // Nothing to clear if nothing could be stored.
  }
}

function TeamDashboardContent({ onLogout, accessToken }: TeamDashboardProps) {
  const navigate = useNavigate();
  const { state, setCortexState, resetState } = useDashboard();
  const [currentPage, setCurrentPage] = useState<PageView>(readInitialPage);

  // One place records the page, so every route into it — a nav click, a
  // keyboard shortcut, the command palette, opening a submission — is
  // resumable. Writing it in an effect rather than at each call site means a
  // path added later cannot forget to.
  useEffect(() => { rememberPage(currentPage); }, [currentPage]);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Use CORTEX state from context
  const cortexState = state.cortexState;

  // Handle logout with state reset
  const handleLogout = () => {
    resetState();
    // The next person to sign in on this browser starts at the dashboard, not
    // wherever the previous session happened to stop.
    forgetPage();
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

      default: {
        const entry = navEntry(currentPage);
        return entry ? [{ label: entry.label }] : [];
      }
    }
  };

  // Handle navigation between pages
  const handleNavigate = (page: string) => {
    // Routes that leave the dashboard shell — navigate via hash-router URL
    if (page === 'execution') {
      navigate('/team/execution');
      return;
    }
    if (page === 'architecture') {
      navigate('/architecture');
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

      {/* Fallback */}
      {!['dashboard', 'cortex', 'team', 'settings', 'reviewer', 'analytics', 'emails', 'revenue', 'mapping'].includes(currentPage) && (
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