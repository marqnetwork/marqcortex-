import { useNavigate, Navigate } from 'react-router';
import ClientLogin from '@/app/components/ClientLogin';
import { useApp } from '@/app/contexts/AppContext';

export function ClientLoginRoute() {
  const navigate = useNavigate();
  const { clientSession, loginClient } = useApp();

  // Already logged in — redirect to portal
  if (clientSession) {
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