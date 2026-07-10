import { useNavigate, Navigate } from 'react-router';
import TeamLogin from '@/app/components/TeamLogin';
import { useApp } from '@/app/contexts/AppContext';

export function TeamLoginRoute() {
  const navigate = useNavigate();
  const { teamAccessToken, loginTeam } = useApp();

  // Already logged in — redirect to dashboard
  if (teamAccessToken) {
    return <Navigate to="/team/dashboard" replace />;
  }

  return (
    <TeamLogin
      onLogin={(token) => {
        // Only set state — do NOT call navigate() here.
        // The state update re-renders this component, hits the
        // teamAccessToken guard above, and declaratively renders
        // <Navigate to="/team/dashboard" />.  One clean navigation
        // avoids a double-nav race that can cancel lazy loading.
        loginTeam(token);
      }}
      onBack={() => navigate('/')}
    />
  );
}