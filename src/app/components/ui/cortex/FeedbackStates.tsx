/**
 * THE FOUR STATES EVERY DATA SURFACE HAS.
 *
 * Loading, empty, error, and the content itself. The console had a shared
 * component for none of them, so each panel invented its own — or, more often,
 * skipped one. The gaps were not evenly distributed, and the two that mattered
 * most were the two most often missing:
 *
 *   * NO LOADING STATE. Panels rendered their computed values while the first
 *     fetch was still in flight, which meant a full grid of zeros. To a
 *     workspace with two thousand submissions, the console said "you have
 *     nothing" for as long as the request took. That is the single failure a
 *     loading state exists to prevent, and it is worse than a spinner because
 *     it is a confident lie rather than an obvious wait.
 *
 *   * NO EMPTY STATE WITH ANYWHERE TO GO. Where an empty state existed at all
 *     it was an icon and a sentence — "No team members found" — which tells a
 *     new organization what is absent and nothing about what to do. §4.9 asks
 *     every surface to answer "what should happen next?".
 *
 * `EmptyState` therefore takes an action and encourages one. It is optional
 * because a genuinely terminal empty — a filter that matched nothing — has no
 * next step but changing the filter, and inventing one would be worse.
 */
import type { ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Surface } from './Surface';

// ── Loading ───────────────────────────────────────────────────────────────────

export interface LoadingStateProps {
  /** What is being loaded, for the screen reader and for the wait itself. */
  label: string;
  /** How many placeholder rows to draw. Match the shape of what will arrive. */
  rows?: number;
  className?: string;
}

/**
 * A skeleton, not a spinner: it holds the space the content will occupy, so the
 * page does not jump when the data lands.
 *
 * `aria-busy` and a live region mean the wait is announced rather than being a
 * silent stretch of decorative rectangles.
 */
export function LoadingState({ label, rows = 4, className = '' }: LoadingStateProps) {
  return (
    <div
      className={`space-y-3 ${className}`}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="h-4 rounded-cortex-sm bg-cortex-control animate-pulse"
          // Varying widths read as content rather than as a loading bar, and
          // the variation is deterministic so it does not shimmer differently
          // on every render.
          style={{ width: `${[92, 68, 84, 55, 76][i % 5]}%`, height: i === 0 ? '28px' : undefined }}
        />
      ))}
    </div>
  );
}

// ── Empty ─────────────────────────────────────────────────────────────────────

export interface EmptyStateProps {
  /** What is not here, stated as a fact rather than as a failure. */
  title: string;
  /** Why it is not here, and what will put something here. */
  description: string;
  icon?: ReactNode;
  /** The one thing to do next, when there is one. */
  action?: { label: string; onClick: () => void };
  /** A quieter second option — documentation, a different filter. */
  secondaryAction?: { label: string; onClick: () => void };
  className?: string;
}

export function EmptyState({
  title, description, icon, action, secondaryAction, className = '',
}: EmptyStateProps) {
  return (
    <Surface
      level="sunken"
      padding="loose"
      className={`text-center ${className}`}
    >
      {icon && (
        <div className="flex justify-center mb-3 text-cortex-faint" aria-hidden="true">
          {icon}
        </div>
      )}
      <h3 className="text-cortex-primary font-semibold text-[length:var(--cortex-font-size-heading)]">
        {title}
      </h3>
      <p className="mt-1.5 mx-auto max-w-md text-cortex-muted text-[length:var(--cortex-font-size-body)]">
        {description}
      </p>
      {(action || secondaryAction) && (
        <div className="mt-5 flex items-center justify-center gap-3 flex-wrap">
          {action && (
            <button
              onClick={action.onClick}
              className="px-5 rounded-cortex-md bg-gradient-to-r from-cortex-accent to-cortex-accent-alt text-white font-semibold text-[length:var(--cortex-font-size-body)] hover:opacity-90 transition-opacity"
              style={{ height: 'var(--cortex-control-height-comfortable)' }}
            >
              {action.label}
            </button>
          )}
          {secondaryAction && (
            <button
              onClick={secondaryAction.onClick}
              className="px-5 rounded-cortex-md bg-cortex-control hover:bg-cortex-control-hover border border-cortex-default text-cortex-secondary font-semibold text-[length:var(--cortex-font-size-body)] transition-colors"
              style={{ height: 'var(--cortex-control-height-comfortable)' }}
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </Surface>
  );
}

// ── Error ─────────────────────────────────────────────────────────────────────

export interface ErrorStateProps {
  /** What failed, in the user's terms rather than the request's. */
  title: string;
  /** The detail, when there is one worth showing. Never a stack trace. */
  detail?: string;
  onRetry?: () => void;
  className?: string;
}

/**
 * `role="alert"` because a failure that appears silently after a user action is
 * a failure the user does not know about.
 */
export function ErrorState({ title, detail, onRetry, className = '' }: ErrorStateProps) {
  return (
    <Surface
      level="sunken"
      padding="loose"
      className={`border-cortex-danger/30 ${className}`}
    >
      <div role="alert" className="flex items-start gap-3">
        <AlertTriangle className="size-5 text-cortex-danger flex-shrink-0 mt-0.5" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="text-cortex-primary font-semibold text-[length:var(--cortex-font-size-heading)]">
            {title}
          </h3>
          {detail && (
            <p className="mt-1 text-cortex-muted text-[length:var(--cortex-font-size-body)] break-words">
              {detail}
            </p>
          )}
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-4 inline-flex items-center gap-2 px-4 rounded-cortex-md bg-cortex-control hover:bg-cortex-control-hover border border-cortex-default text-cortex-secondary font-semibold text-[length:var(--cortex-font-size-body)] transition-colors"
              style={{ height: 'var(--cortex-control-height-compact)' }}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Try again
            </button>
          )}
        </div>
      </div>
    </Surface>
  );
}
