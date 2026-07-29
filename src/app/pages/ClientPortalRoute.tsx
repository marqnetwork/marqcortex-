import { useNavigate, Navigate } from 'react-router';
import { useEffect, useState } from 'react';
import ClientPortal from '@/app/components/ClientPortal';
import { useApp } from '@/app/contexts/AppContext';

export function ClientPortalRoute() {
  const navigate = useNavigate();
  const { clientSession, isClientSessionExpired, logout } = useApp();
  const [expiredLogout, setExpiredLogout] = useState(false);

  // Handle expired session in an effect (not during render) to avoid
  // calling setState (logout) during the render phase.
  useEffect(() => {
    if (isClientSessionExpired && clientSession) {
      logout();
      setExpiredLogout(true);
    }
  }, [isClientSessionExpired, clientSession, logout]);

  // Not logged in (or just logged out due to expiry) — redirect to client login
  if (!clientSession || isClientSessionExpired || expiredLogout) {
    return <Navigate to="/client/login" replace />;
  }

  return (
    <ClientPortal
      onLogout={() => {
        logout();
        navigate('/');
      }}
      submissionId={clientSession.submissionId}
      clientEmail={clientSession.email}
      companyName={clientSession.companyName}
      sessionToken={clientSession.sessionToken}
    />
  );
}
