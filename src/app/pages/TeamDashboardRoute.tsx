import { useNavigate, Navigate } from 'react-router';
import { useEffect, useState } from 'react';
import TeamDashboard from '@/app/components/TeamDashboardNew';
import { useApp } from '@/app/contexts/AppContext';

export function TeamDashboardRoute() {
  const navigate = useNavigate();
  const { teamAccessToken, logout, isSessionExpired } = useApp();
  const [expiredLogout, setExpiredLogout] = useState(false);

  // Handle expired session in an effect (not during render) to avoid
  // calling setState (logout) during the render phase.
  useEffect(() => {
    if (isSessionExpired && teamAccessToken) {
      logout();
      setExpiredLogout(true);
    }
  }, [isSessionExpired, teamAccessToken, logout]);

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