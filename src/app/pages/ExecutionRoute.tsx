/**
 * EXECUTION ROUTE — /team/execution
 *
 * Renders the Execution Dashboard for the latest available ExecutionProject.
 * Requires team login.
 *
 * An empty `EXECUTION_STORE` used to mean `MOCK_EXECUTION` — the ExampleCo
 * seed — which is to say: every workspace that had not yet converted a
 * proposal was shown a twelve-week programme, with owners, due dates and a
 * governance gate already signed off, for a client that does not exist. An
 * empty store now renders an empty state, which is what it means.
 */

import { Navigate, useNavigate } from 'react-router';
import { useApp } from '@/app/contexts/AppContext';
import { DashboardProvider } from '@/app/contexts/DashboardContext';
import { TeamDashboardLayout } from '@/app/components/TeamDashboardLayout';
import { ExecutionDashboard } from '@/app/components/ExecutionDashboard';
import { EXECUTION_STORE } from '@/app/core/executionEngine';
import { ProductDataState } from '@/app/components/ProductDataState';
// The destination travels in the URL, and its parameter name is declared once
// by the navigation model — so this route and the shell it hands off to cannot
// drift apart, and no sessionStorage side channel is needed to carry it.
import { externalRouteFor, PAGE_PARAM, type DestinationId } from '@/app/core/navigationModel';
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
    EXECUTION_STORE.length > 0 ? EXECUTION_STORE[EXECUTION_STORE.length - 1] : null;

  const handleNavigate = (page: string) => {
    if (page === 'execution') return;

    // Read from the navigation model rather than restated here. The literal
    // this replaces was one of three copies of the same fact, and the copies
    // were how `?page=execution` came to resolve to the Dashboard.
    const route = externalRouteFor(page as DestinationId);
    if (route) {
      navigate(route);
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
        <div className="p-6">
          <ProductDataState
            loading={false}
            reason={null}
            empty={project === null}
            subject="execution plans"
            emptyHint="An execution plan is created from an accepted proposal, through the Mapping Engine. Nothing has been converted in this workspace yet."
          >
            {project ? <ExecutionDashboard project={project} /> : null}
          </ProductDataState>
        </div>
      </TeamDashboardLayout>
    </DashboardProvider>
  );
}
