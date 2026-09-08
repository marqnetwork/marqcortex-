import { useNavigate, Navigate } from 'react-router';
import { useEffect, useState } from 'react';
import TeamDashboard from '@/app/components/TeamDashboardNew';
import { useApp } from '@/app/contexts/AppContext';
import { RouteRestoring } from '@/app/components/RouteRestoring';

export function TeamDashboardRoute() {
  const navigate = useNavigate();
  const { teamAccessToken, logout, isSessionExpired, isRestoringSession } = useApp();
  const [expiredLogout, setExpiredLogout] = useState(false);

  // Handle expired session in an effect (not during render) to avoid
  // calling setState (logout) during the render phase.
  useEffect(() => {
    if (isSessionExpired && teamAccessToken) {
      logout();
      setExpiredLogout(true);
    }
  }, [isSessionExpired, teamAccessToken, logout]);

  // Session restore runs in an effect, so on the FIRST render teamAccessToken
  // is null even for a signed-in operator. Redirecting here sent every cold
  // load to the login screen and discarded the requested URL — which is why a
  // refresh, a bookmark or a shared link to any in-app destination used to
  // land on the bare dashboard. Wait until the session is actually known.
  if (isRestoringSession) {
    return <RouteRestoring />;
  }

  // Not logged in (or just logged out due to expiry) — redirect to team login
  if (!teamAccessToken || expiredLogout) {
    return <Navigate to="/team/login" replace />;
  }

  return (
    <TeamDashboard
      onLogout={() => {
        logout();
        navigate('/');
      }}
      accessToken={teamAccessToken}
    />
  );
}