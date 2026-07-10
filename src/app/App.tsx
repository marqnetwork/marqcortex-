/**
 * MARQ CORTEX — Application Root
 *
 * Uses createHashRouter instead of createBrowserRouter so the app works
 * correctly in iframe-based preview environments (like Figma Make) where
 * the History API may be restricted.
 *
 * Route mapping:
 *   #/                → Landing page
 *   #/get-started     → Lead magnet capture
 *   #/diagnostic      → 14-question diagnostic form
 *   #/score           → Instant score results
 *   #/team/login      → Team (CORTEX) login
 *   #/team/dashboard  → CORTEX internal dashboard
 *   #/team/execution  → CORTEX execution plan
 *   #/client/login    → Client portal login
 *   #/client/portal   → Client portal
 *   #/architecture    → System architecture view
 *   #/registry        → System Registry (codebase ID map / debug tool)
 *
 * ── PERFORMANCE NOTES ────────────────────────────────────────────────────────
 * Only LandingPageRoute is eagerly bundled (it's the first paint).
 * Every other route — including LeadMagnetRoute (which pulls jsPDF via
 * pdfExport.ts), the full TeamDashboard shell, and the 500-node RegistryViewer
 * — is a separate async chunk loaded only when the user navigates there.
 *
 * Split points by group:
 *   Public funnel  : get-started · diagnostic · score
 *   Auth gates     : team/login · client/login
 *   App shells     : team/dashboard · team/execution · client/portal
 *   Dev utilities  : architecture · registry
 */

import { Suspense } from 'react';
import { RouterProvider, createHashRouter } from 'react-router';
import { RootLayout }       from '@/app/pages/RootLayout';
import { LandingPageRoute } from '@/app/pages/LandingPageRoute'; // only eager route
import { NotFound }         from '@/app/components/NotFound';
import { RouteErrorFallback } from '@/app/components/RouteErrorFallback';

// ── Loading fallback ──────────────────────────────────────────────────────────
function RouteLoader() {
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

// ── Lazy-route factory ────────────────────────────────────────────────────────
// Each call becomes its own Vite/Rollup split point.
// The generic constraint ensures key must actually exist in the module.
function makeLazy<M extends Record<string, React.ComponentType>>(
  importer: () => Promise<M>,
  key: keyof M,
) {
  return async () => {
    try {
      const mod = await importer();
      return { Component: mod[key] };
    } catch (err) {
      console.error(`[Router] Failed to load chunk "${String(key)}":`, err);
      throw err;
    }
  };
}

// ── Router ────────────────────────────────────────────────────────────────────
const router = createHashRouter([
  {
    path: '/',
    Component: RootLayout,
    HydrateFallback: RouteLoader,
    children: [
      // Landing page — the only eager chunk (users land here first)
      { index: true, Component: LandingPageRoute },

      // ── Public funnel (each a separate chunk) ──────────────────────────────
      // get-started pulls LeadMagnetCapture → pdfExport (jsPDF) — now split
      {
        path: 'get-started',
        errorElement: <RouteErrorFallback />,
        lazy: makeLazy(() => import('@/app/pages/LeadMagnetRoute'), 'LeadMagnetRoute'),
      },
      {
        path: 'diagnostic',
        errorElement: <RouteErrorFallback />,
        lazy: makeLazy(() => import('@/app/pages/DiagnosticRoute'), 'DiagnosticRoute'),
      },
      {
        path: 'score',
        errorElement: <RouteErrorFallback />,
        lazy: makeLazy(() => import('@/app/pages/ScoreRoute'), 'ScoreRoute'),
      },

      // ── Auth gates ────────────────────────────────────────────────────────
      {
        path: 'team/login',
        errorElement: <RouteErrorFallback />,
        lazy: makeLazy(() => import('@/app/pages/TeamLoginRoute'), 'TeamLoginRoute'),
      },
      {
        path: 'client/login',
        errorElement: <RouteErrorFallback />,
        lazy: makeLazy(() => import('@/app/pages/ClientLoginRoute'), 'ClientLoginRoute'),
      },

      // ── Dev / utility (large data payloads — definitely split) ────────────
      {
        path: 'architecture',
        errorElement: <RouteErrorFallback />,
        lazy: makeLazy(() => import('@/app/components/SystemArchitecture'), 'SystemArchitecture'),
      },
      {
        path: 'registry',
        errorElement: <RouteErrorFallback />,
        lazy: makeLazy(() => import('@/app/components/RegistryViewer'), 'RegistryViewer'),
      },

      // ── Authenticated app shells ───────────────────────────────────────────
      {
        path: 'team/dashboard',
        errorElement: <RouteErrorFallback />,
        lazy: makeLazy(() => import('@/app/pages/TeamDashboardRoute'), 'TeamDashboardRoute'),
      },
      {
        path: 'team/execution',
        errorElement: <RouteErrorFallback />,
        lazy: makeLazy(() => import('@/app/pages/ExecutionRoute'), 'ExecutionRoute'),
      },
      {
        path: 'client/portal',
        errorElement: <RouteErrorFallback />,
        lazy: makeLazy(() => import('@/app/pages/ClientPortalRoute'), 'ClientPortalRoute'),
      },

      { path: '*', Component: NotFound },
    ],
  },
]);

// ── App entry ─────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <Suspense fallback={<RouteLoader />}>
      <RouterProvider router={router} />
    </Suspense>
  );
}