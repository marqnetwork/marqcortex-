/**
 * EMPTY STATE — the shared shape for "there is nothing to show".
 *
 * Product Experience Ch. 9 asks every surface to reduce uncertainty. An empty
 * list is the moment a surface has the least to say and the most chance of
 * saying something wrong, and the wrong thing here has a specific shape:
 *
 *   NOTHING EXISTS YET and NOTHING MATCHES YOUR FILTERS ARE DIFFERENT STATES.
 *
 * Panels across Cortex rendered one message for both — a reviewer opening an
 * empty queue with no filter set was told "No submissions match your filters"
 * and sent to fix filters they had never touched, while the actual situation
 * (the queue is empty) went unsaid. The two states have different causes and
 * different next actions, so they get different components:
 *
 *   <EmptyState>          nothing exists yet. Says what is absent, and offers
 *                         the action that would produce some.
 *   <NoResultsState>      things exist, none match. Says what is filtering
 *                         them out, and offers to clear it.
 *
 * Neither invents an explanation it does not have. A panel that cannot say why
 * a list is empty should say only that it is.
 */

import type { LucideIcon } from 'lucide-react';
import { SearchX } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  /** What is absent, as a statement. Not "No data". */
  title: string;
  /** One line on why that is so, or what would change it. Optional. */
  body?: string;
  /** The action that would produce some. Optional — many lists fill themselves. */
  action?: { label: string; onClick: () => void };
  /** Tightens the vertical padding for a state inside a small card. */
  compact?: boolean;
}

export function EmptyState({ icon: Icon, title, body, action, compact }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center text-center ${compact ? 'py-8 px-4' : 'py-16 px-6'}`}
      role="status"
    >
      <Icon className="size-10 text-white/20 mb-3" aria-hidden="true" />
      <p className="text-sm font-semibold text-white/70">{title}</p>
      {body && (
        <p className="mt-1 max-w-sm text-xs text-gray-500 leading-relaxed">{body}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-cortex-accent/30 bg-cortex-accent/15 px-4 py-2 text-xs font-medium text-cortex-accent transition-colors hover:bg-cortex-accent/25"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

interface NoResultsStateProps {
  /** What is being filtered, plural. e.g. "submissions". */
  noun: string;
  /**
   * How many exist behind the filter.
   *
   * Required, because it is the whole point: "none of 42" tells the operator
   * their filter is the reason, and that clearing it will show something.
   */
  totalCount: number;
  /** Clears every filter and search term. */
  onClear: () => void;
  compact?: boolean;
}

export function NoResultsState({ noun, totalCount, onClear, compact }: NoResultsStateProps) {
  return (
    <div
      className={`flex flex-col items-center text-center ${compact ? 'py-8 px-4' : 'py-16 px-6'}`}
      role="status"
    >
      <SearchX className="size-10 text-white/20 mb-3" aria-hidden="true" />
      <p className="text-sm font-semibold text-white/70">
        No {noun} match your filters
      </p>
      <p className="mt-1 max-w-sm text-xs text-gray-500 leading-relaxed">
        {totalCount === 1
          ? `There is 1 ${noun.replace(/s$/, '')}, and the current filters exclude it.`
          : `There are ${totalCount} ${noun}, and the current filters exclude all of them.`}
      </p>
      <button
        onClick={onClear}
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-4 py-2 text-xs font-medium text-gray-300 transition-colors hover:bg-white/5"
      >
        Clear filters
      </button>
    </div>
  );
}
