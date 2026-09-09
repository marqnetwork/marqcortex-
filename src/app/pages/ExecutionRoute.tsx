/**
 * EXECUTION ROUTE — /team/execution
 *
 * Renders the Execution Dashboard for the latest available ExecutionProject.
 * Uses MOCK_EXECUTION (ExampleCo seed) when EXECUTION_STORE is empty.
 * Requires team login.
 */

import { Navigate, useNavigate } from 'react-router';
import { useApp } from '@/app/contexts/AppContext';
import { DashboardProvider } from '@/app/contexts/DashboardContext';
import { TeamDashboardLayout } from '@/app/components/TeamDashboardLayout';
import { ExecutionDashboard } from '@/app/components/ExecutionDashboard';
import { EXECUTION_STORE, MOCK_EXECUTION } from '@/app/core/executionEngine';
// The destination travels in the URL, and its parameter name is declared once
// by the navigation model — so this route and the shell it hands off to cannot
// drift apart, and no sessionStorage side channel is needed to carry it.
import { PAGE_PARAM } from '@/app/core/navigationModel';
import { RouteRestoring } from '@/app/components/RouteRestoring';

export function ExecutionRoute() {
  const navigate = useNavigate();
  const { teamAccessToken, logout, isRestoringSession } = useApp();

  // Same reason as TeamDashboardRoute: on the first render the session has not
  // been restored yet, and treating "not known" as "signed out" bounces every
  // cold load through the login screen.
  if (isRestoringSession) {
    return <RouteRestoring />;
  }

  if (!teamAccessToken) {
    return <Navigate to="/team/login" replace />;
  }

  const project =
    EXECUTION_STORE.length > 0
      ? EXECUTION_STORE[EXECUTION_STORE.length - 1]
      : MOCK_EXECUTION;

  const handleNavigate = (page: string) => {
    if (page === 'execution') return;

    if (page === 'architecture') {
      navigate('/architecture');
      return;
    }

    // The destination now travels in the URL, so this is an ordinary
    // navigation. It used to be handed over through a sessionStorage key
    // declared as a literal in two files — a side channel that existed only
    // because in-app pages had no address of their own.
    navigate(
      page === 'dashboard'
        ? '/team/dashboard'
        : `/team/dashboard?${PAGE_PARAM}=${encodeURIComponent(page)}`,
    );
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <DashboardProvider>
      <TeamDashboardLayout
        currentPage="execution"
        breadcrumbs={[{ label: 'Execution' }]}
        onLogout={handleLogout}
        onNavigate={handleNavigate}
        accessToken={teamAccessToken}
      >
        <ExecutionDashboard project={project} />
      </TeamDashboardLayout>
    </DashboardProvider>
  );
}
