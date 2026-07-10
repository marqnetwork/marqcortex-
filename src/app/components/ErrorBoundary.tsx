/**
 * ERROR BOUNDARY — Catches rendering errors and shows a recovery UI
 *
 * Prevents the entire app from white-screening when a single component throws.
 * In production, this could also log to an error tracking service.
 */

import { Component, type ReactNode, type ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          style={{
            minHeight: '100vh',
            background: '#0A0A0F',
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
              background: '#111118',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '16px',
              padding: '40px',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: '56px',
                height: '56px',
                background: 'rgba(253,68,56,0.12)',
                border: '1px solid rgba(253,68,56,0.3)',
                borderRadius: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 20px',
              }}
            >
              <AlertTriangle size={28} color="#FD4438" />
            </div>

            <h2
              style={{
                color: '#fff',
                fontSize: '20px',
                fontWeight: 700,
                margin: '0 0 8px',
              }}
            >
              Something went wrong
            </h2>

            <p
              style={{
                color: '#9CA3AF',
                fontSize: '14px',
                lineHeight: 1.6,
                margin: '0 0 24px',
              }}
            >
              An unexpected error occurred. You can try refreshing the page or returning to the home screen.
            </p>

            {this.state.error && (
              <div
                style={{
                  background: '#0D0D14',
                  border: '1px solid rgba(253,68,56,0.2)',
                  borderRadius: '10px',
                  padding: '12px 16px',
                  marginBottom: '24px',
                  textAlign: 'left',
                }}
              >
                <p
                  style={{
                    color: '#FD4438',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    margin: 0,
                    wordBreak: 'break-word',
                  }}
                >
                  {this.state.error.message}
                </p>
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                onClick={this.handleReset}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 20px',
                  background: 'rgba(139,92,246,0.12)',
                  border: '1px solid rgba(139,92,246,0.3)',
                  borderRadius: '10px',
                  color: '#8B5CF6',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <RefreshCw size={16} />
                Try Again
              </button>

              <button
                onClick={this.handleGoHome}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 20px',
                  background: 'rgba(59,130,246,0.12)',
                  border: '1px solid rgba(59,130,246,0.3)',
                  borderRadius: '10px',
                  color: '#3B82F6',
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

    return this.props.children;
  }
}
