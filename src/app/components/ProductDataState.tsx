/**
 * THE FIVE STATES AN AUTHENTICATED SURFACE MAY BE IN.
 *
 * Product Reality §10 recorded that empty states in MARQ Cortex were "rarely
 * reachable; demo data is always present" — which is a polite way of saying no
 * authenticated surface had ever been seen with nothing in it, because there
 * was always something invented to show. This component is what those surfaces
 * render instead.
 *
 *   LOADING            a skeleton, announced to assistive technology
 *   REAL DATA          the surface's own children
 *   EMPTY              "nothing yet", said plainly, with what to do about it
 *   ERROR              what failed, and a way to try again
 *   PERMISSION DENIED  "not you", which is not an error and not an empty list
 *
 * The distinction between the last three is the whole point. "No submissions
 * yet", "we could not reach the server" and "your account cannot see this" are
 * three different facts, an operator acts differently on each, and rendering
 * any of them as the others — or as a fabricated pipeline — is the defect this
 * sprint exists to remove.
 */

import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2, PlugZap, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  REASON_DETAIL,
  REASON_HEADLINE,
  type ProductDataReason,
} from '@/app/services/productData';

export interface ProductDataStateProps {
  /** True while the request is in flight and there is nothing to show yet. */
  loading: boolean;
  /** Set when the request could not produce data. Drives ERROR / DENIED / NOT CONNECTED. */
  reason: ProductDataReason | null;
  /** The server's own message, when it gave one worth repeating. */
  detail?: string | null;
  /** True when the request succeeded and the answer was "nothing". */
  empty?: boolean;
  /** What to call the thing that is missing, e.g. "submissions". */
  subject: string;
  /** Shown under the EMPTY headline — what the operator can do about it. */
  emptyHint?: string;
  /** Re-run the request. Omitted for states where retrying cannot help. */
  onRetry?: () => void;
  /** Rendered when there is real, non-empty data. */
  children?: ReactNode;
}

const REASON_ICON: Record<ProductDataReason, typeof AlertTriangle> = {
  'backend-not-configured': PlugZap,
  unreachable: AlertTriangle,
  unauthenticated: ShieldAlert,
  'permission-denied': ShieldAlert,
  'not-found': Inbox,
  'server-error': AlertTriangle,
};

/** Retrying a configuration problem or a refusal changes nothing. Do not offer it. */
function retryCanHelp(reason: ProductDataReason): boolean {
  return reason === 'unreachable' || reason === 'server-error';
}

function Frame({
  icon: Icon,
  tone,
  title,
  body,
  action,
  testId,
}: {
  icon: typeof AlertTriangle;
  tone: 'neutral' | 'warning';
  title: string;
  body: string;
  action?: ReactNode;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      data-product-data-state={testId}
      role={tone === 'warning' ? 'alert' : 'status'}
      className="rounded-xl border border-white/10 bg-white/[0.02] px-6 py-10 text-center"
    >
      <Icon
        aria-hidden="true"
        className={`mx-auto size-6 ${tone === 'warning' ? 'text-amber-500/80' : 'text-gray-600'}`}
      />
      <h3 className="mt-3 text-sm font-bold text-white">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-gray-500">{body}</p>
      {action}
    </div>
  );
}

function RetryButton({ onRetry }: { onRetry: () => void }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-xs font-medium text-white/80 hover:bg-white/5"
    >
      <RefreshCw aria-hidden="true" className="size-3.5" /> Try again
    </button>
  );
}

export function ProductDataState({
  loading,
  reason,
  detail,
  empty = false,
  subject,
  emptyHint,
  onRetry,
  children,
}: ProductDataStateProps) {
  if (loading) {
    return (
      <div
        data-testid="product-data-loading"
        data-product-data-state="loading"
        aria-busy="true"
        role="status"
        aria-label={`Loading ${subject}`}
        className="space-y-3"
      >
        <span className="sr-only">Loading {subject}…</span>
        {[0, 1, 2].map(row => (
          <div
            key={row}
            aria-hidden="true"
            className="h-20 animate-pulse rounded-xl border border-white/5 bg-white/[0.02]"
          />
        ))}
      </div>
    );
  }

  if (reason) {
    return (
      <Frame
        testId={reason === 'permission-denied' ? 'product-data-denied' : 'product-data-error'}
        icon={REASON_ICON[reason]}
        tone={reason === 'permission-denied' ? 'neutral' : 'warning'}
        title={REASON_HEADLINE[reason]}
        // The server's own sentence first when it gave one — it is more specific
        // than anything this component could say — and the standing explanation
        // of the reason after it.
        body={detail ? `${detail} ${REASON_DETAIL[reason]}` : REASON_DETAIL[reason]}
        action={onRetry && retryCanHelp(reason) ? <RetryButton onRetry={onRetry} /> : undefined}
      />
    );
  }

  if (empty) {
    return (
      <Frame
        testId="product-data-empty"
        icon={Inbox}
        tone="neutral"
        title={`No ${subject} yet`}
        body={
          emptyHint ??
          `Nothing has been recorded here. This is the real answer from your workspace, not a placeholder.`
        }
      />
    );
  }

  return <>{children}</>;
}

/**
 * The inline form, for a surface that has a header or a toolbar it wants to
 * keep visible while the body is unavailable.
 */
export function ProductDataNotice({
  reason,
  detail,
  onRetry,
}: {
  reason: ProductDataReason;
  detail?: string | null;
  onRetry?: () => void;
}) {
  const Icon = REASON_ICON[reason];
  return (
    <div
      data-testid={reason === 'permission-denied' ? 'product-data-denied' : 'product-data-error'}
      data-product-data-state={reason}
      role={reason === 'permission-denied' ? 'status' : 'alert'}
      className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] px-4 py-3"
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-500/80" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-white">{REASON_HEADLINE[reason]}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
          {detail ? `${detail} ${REASON_DETAIL[reason]}` : REASON_DETAIL[reason]}
        </p>
      </div>
      {onRetry && retryCanHelp(reason) ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-lg border border-white/15 px-3 py-1.5 text-[11px] font-medium text-white/80 hover:bg-white/5"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

/**
 * Loading placeholder for a surface that renders tiles rather than rows.
 */
export function ProductDataSkeleton({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div
      data-testid="product-data-loading"
      data-product-data-state="loading"
      aria-busy="true"
      role="status"
      aria-label={`Loading ${label}`}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      <span className="sr-only">Loading {label}…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="h-24 animate-pulse rounded-xl border border-white/5 bg-white/[0.02]"
        />
      ))}
    </div>
  );
}

/** The spinner form, for a surface whose body is a single object rather than a list. */
export function ProductDataLoading({ label }: { label: string }) {
  return (
    <div
      data-testid="product-data-loading"
      data-product-data-state="loading"
      role="status"
      aria-busy="true"
      className="flex items-center justify-center gap-3 py-20 text-gray-500"
    >
      <Loader2 aria-hidden="true" className="size-5 animate-spin" />
      <span className="text-xs">Loading {label}…</span>
    </div>
  );
}
