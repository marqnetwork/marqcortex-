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

const TEAM_DASHBOARD_PAGE_KEY = 'teamDashboardPage';

export function ExecutionRoute() {
  const navigate = useNavigate();
  const { teamAccessToken, logout } = useApp();

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

    sessionStorage.setItem(TEAM_DASHBOARD_PAGE_KEY, page);
    navigate('/team/dashboard');
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
