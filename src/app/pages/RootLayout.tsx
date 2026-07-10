/**
 * ROOT LAYOUT — Wraps all routes with AppProvider + ErrorBoundary
 *
 * Also shows a full-screen loading spinner when the router is navigating
 * to a lazy-loaded route (fixes blank-screen during lazy loading).
 */

import { Outlet, useNavigation } from 'react-router';
import { AppProvider } from '@/app/contexts/AppContext';
import { ErrorBoundary } from '@/app/components/ErrorBoundary';
import { OfflineBanner } from '@/app/components/OfflineBanner';

function NavigationAwareOutlet() {
  const navigation = useNavigation();

  // While the router is loading a new route (lazy import in progress),
  // show a spinner so the user never sees a blank dark screen.
  if (navigation.state === 'loading') {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: '#0A0A0F',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          fontFamily: 'Inter, -apple-system, sans-serif',
          color: '#6B7280',
          fontSize: '14px',
        }}
      >
        <div
          style={{
            width: '20px',
            height: '20px',
            border: '2px solid rgba(139,92,246,0.2)',
            borderTop: '2px solid #8B5CF6',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        Loading…
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return <Outlet />;
}

export function RootLayout() {
  return (
    <AppProvider>
      <ErrorBoundary>
        <OfflineBanner />
        <NavigationAwareOutlet />
      </ErrorBoundary>
    </AppProvider>
  );
}