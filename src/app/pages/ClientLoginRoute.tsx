import { useNavigate, Navigate } from 'react-router';
import ClientLogin from '@/app/components/ClientLogin';
import { useApp } from '@/app/contexts/AppContext';

export function ClientLoginRoute() {
  const navigate = useNavigate();
  const { clientSession, isClientSessionExpired, loginClient } = useApp();

  // Already logged in with a still-valid session — redirect to portal.
  // An expired session must not bounce back to the portal; the user stays here
  // and signs in again.
  if (clientSession && !isClientSessionExpired) {
    return <Navigate to="/client/portal" replace />;
  }

  return (
    <ClientLogin
      onLogin={(submissionId, email, companyName, sessionToken) => {
        loginClient(submissionId, email, companyName, sessionToken ?? null);
      }}
      onBack={() => navigate('/')}
    />
  );
}