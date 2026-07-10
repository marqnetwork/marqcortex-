import { useNavigate, Navigate } from 'react-router';
import ClientPortal from '@/app/components/ClientPortal';
import { useApp } from '@/app/contexts/AppContext';

export function ClientPortalRoute() {
  const navigate = useNavigate();
  const { clientSession, isClientSessionExpired, logout } = useApp();

  // Not logged in or session expired — redirect to client login
  if (!clientSession || isClientSessionExpired) {
    if (isClientSessionExpired) logout();
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
