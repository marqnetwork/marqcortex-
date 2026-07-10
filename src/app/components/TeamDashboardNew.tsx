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

import { useState, useRef, lazy, Suspense } from 'react';
import { TeamDashboardLayout } from '@/app/components/TeamDashboardLayout';
import { DashboardProvider, useDashboard } from '@/app/contexts/DashboardContext';

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

function TeamDashboardContent({ onLogout, accessToken }: TeamDashboardProps) {
  const { state, setCortexState, resetState } = useDashboard();
  const [currentPage, setCurrentPage] = useState<PageView>('dashboard');
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
  const getBreadcrumbs = () => {
    switch (currentPage) {
      case 'cortex':
        const breadcrumbs = [
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
        
      case 'team':
        return [{ label: 'Team Management' }];
        
      case 'settings':
        return [{ label: 'Settings' }];
        
      case 'reviewer':
        return [{ label: 'Reviewer Dashboard' }];
        
      case 'analytics':
        return [{ label: 'Analytics Dashboard' }];
        
      case 'emails':
        return [{ label: 'Email Nurture Queue' }];

      case 'revenue':
        return [{ label: 'Revenue Intelligence' }];

      case 'mapping':
        return [{ label: 'Mapping Engine' }];

      case 'architecture':
        return [{ label: 'System Architecture' }];
        
      default:
        return [];
    }
  };

  // Handle navigation between pages
  const handleNavigate = (page: string) => {
    // Routes that leave the dashboard shell — navigate via hash-router URL
    if (page === 'execution') {
      window.location.href = '/#/team/execution';
      return;
    }
    if (page === 'architecture') {
      window.location.href = '/#/architecture';
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