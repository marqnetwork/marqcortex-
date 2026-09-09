/**
 * ROUTE ERROR FALLBACK
 *
 * Displayed when a lazy-loaded route's module fails to load.
 * Shows a friendly error instead of a blank page.
 * Uses useRouteError() to capture and display the actual error.
 */

import { RefreshCw, Home } from 'lucide-react';
import { useRouteError } from 'react-router';
import {
  border as BORDER,
  brand,
  status as STATUS,
  surface as SURFACE,
  text as TEXT,
} from '@/app/lib/tokens';


export function RouteErrorFallback() {
  const error = useRouteError();

  // Extract a human-readable message
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'An unknown error occurred while loading this page.';

  // Log for debugging
  console.error('[RouteErrorFallback] Caught route error:', error);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: SURFACE.canvas,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
        padding: '24px',
      }}
    >
      <div
        style={{
          maxWidth: '480px',
          width: '100%',
          background: SURFACE.overlay,
          border: `1px solid ${BORDER.default}`,
          borderRadius: '16px',
          padding: '40px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: '56px',
            height: '56px',
            background: `${STATUS.danger}1F`,
            border: `1px solid ${STATUS.danger}4C`,
            borderRadius: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
            fontSize: '28px',
          }}
        >
          ⚠️
        </div>

        <h2
          style={{
            color: '#fff',
            fontSize: '20px',
            fontWeight: 700,
            margin: '0 0 8px',
          }}
        >
          Page failed to load
        </h2>

        <p
          style={{
            color: TEXT.muted,
            fontSize: '14px',
            lineHeight: 1.6,
            margin: '0 0 16px',
          }}
        >
          This section encountered an error while loading. Check the browser console for details,
          or return to the home screen.
        </p>

        {message && (
          <div
            style={{
              background: SURFACE.overlay,
              border: `1px solid ${STATUS.danger}40`,
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '24px',
              textAlign: 'left',
            }}
          >
            <pre
              style={{
                color: STATUS.danger,
                fontSize: '11px',
                fontFamily: 'monospace',
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {message.slice(0, 500)}
            </pre>
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <button
            onClick={() => window.location.reload()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 20px',
              background: `${brand.accent}1F`,
              border: `1px solid ${brand.accent}4C`,
              borderRadius: '10px',
              color: brand.accent,
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <RefreshCw size={16} />
            Reload
          </button>

          <button
            onClick={() => { window.location.href = '/'; }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 20px',
              background: `${brand.accentAlt}1F`,
              border: `1px solid ${brand.accentAlt}4C`,
              borderRadius: '10px',
              color: brand.accentAlt,
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Home size={16} />
            Home
          </button>
        </div>
      </div>
    </div>
  );
}