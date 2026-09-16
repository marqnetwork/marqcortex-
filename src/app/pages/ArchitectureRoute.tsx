/**
 * ARCHITECTURE ROUTE — /architecture
 *
 * `architecture` is a declared destination in `NAV_GROUPS`. It appears in the
 * sidebar, in the command palette and in the shortcut table like every other
 * destination — and until CP-1, selecting it dropped the operator out of the
 * product entirely.
 *
 * `#/architecture` rendered `SystemArchitecture` as a bare page: no sidebar, no
 * header, no breadcrumb, no active navigation item, and no way back except the
 * browser's own Back button. On a phone, where the sidebar is a drawer, there
 * was no navigation on the screen at all. A destination the navigation model
 * declares must be somewhere the navigation model can still reach you from.
 *
 * It renders inside the same shell as everything else now, with its own
 * destination selected, exactly as `ExecutionRoute` does. The component itself
 * is unchanged.
 */

import { Navigate, useNavigate } from 'react-router';
import { useApp } from '@/app/contexts/AppContext';
import { DashboardProvider } from '@/app/contexts/DashboardContext';
import { TeamDashboardLayout } from '@/app/components/TeamDashboardLayout';
import { SystemArchitecture } from '@/app/components/SystemArchitecture';
import { externalRouteFor, PAGE_PARAM, type DestinationId } from '@/app/core/navigationModel';
import { RouteRestoring } from '@/app/components/RouteRestoring';

export function ArchitectureRoute() {
  const navigate = useNavigate();
  const { teamAccessToken, logout, isRestoringSession } = useApp();

  // Same reason as the other authenticated routes: on the first render the
  // session has not been restored, and treating "not known" as "signed out"
  // bounces every cold load through the login screen and discards the URL.
  if (isRestoringSession) {
    return <RouteRestoring />;
  }

  if (!teamAccessToken) {
    return <Navigate to="/team/login" replace />;
  }

  const handleNavigate = (page: string) => {
    if (page === 'architecture') return;

    const route = externalRouteFor(page as DestinationId);
    if (route) {
      navigate(route);
      return;
    }

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
        currentPage="architecture"
        breadcrumbs={[{ label: 'Architecture' }]}
        onLogout={handleLogout}
        onNavigate={handleNavigate}
        accessToken={teamAccessToken}
      >
        <SystemArchitecture />
      </TeamDashboardLayout>
    </DashboardProvider>
  );
}
