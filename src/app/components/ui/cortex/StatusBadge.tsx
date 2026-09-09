/**
 * STATUS BADGE — one status, one colour, one shape.
 *
 * Every panel that showed a submission's status built its own pill, and the
 * colours did not agree: `new` was purple on one screen and blue on another,
 * `in-review` was orange in one file and amber in the next. A user reading two
 * panels of the same dashboard could not tell whether they were looking at the
 * same state.
 *
 * The colour now comes from `SUBMISSION_STATUS_COLOR` and `PRIORITY_COLOR` in
 * the token layer, which the design-token test proves are total: every status
 * and every priority has exactly one colour, and no two share it.
 */
import { SUBMISSION_STATUS_COLOR, PRIORITY_COLOR, status as statusToken } from '@/app/lib/tokens';

export type SubmissionStatus = keyof typeof SUBMISSION_STATUS_COLOR;
export type Priority = keyof typeof PRIORITY_COLOR;
export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'caution' | 'neutral';

const STATUS_LABEL: Record<SubmissionStatus, string> = {
  new: 'New',
  'in-review': 'In review',
  completed: 'Completed',
  approved: 'Approved',
};

const PRIORITY_LABEL: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

interface BaseProps {
  /** A dot before the label, for a badge that sits in a dense list. */
  dot?: boolean;
  className?: string;
}

/**
 * The shared shell. Colour arrives as a single value and is applied to text,
 * background and border at fixed opacities, so a badge can never be styled
 * into illegibility by picking its three colours separately.
 */
function Badge({ colour, label, dot, className = '' }: BaseProps & { colour: string; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-cortex-pill border font-semibold text-[length:var(--cortex-font-size-caption)] ${className}`}
      style={{
        color: colour,
        background: `color-mix(in srgb, ${colour} 12%, transparent)`,
        borderColor: `color-mix(in srgb, ${colour} 30%, transparent)`,
      }}
    >
      {dot && <span className="size-1.5 rounded-full" style={{ background: colour }} aria-hidden="true" />}
      {label}
    </span>
  );
}

export function StatusBadge({ status, ...rest }: BaseProps & { status: SubmissionStatus }) {
  return <Badge colour={SUBMISSION_STATUS_COLOR[status]} label={STATUS_LABEL[status]} {...rest} />;
}

export function PriorityBadge({ priority, ...rest }: BaseProps & { priority: Priority }) {
  return <Badge colour={PRIORITY_COLOR[priority]} label={`${PRIORITY_LABEL[priority]} priority`} {...rest} />;
}

/** For states the domain does not enumerate — a count, a mode, a free label. */
export function ToneBadge({ tone, label, ...rest }: BaseProps & { tone: Tone; label: string }) {
  return <Badge colour={statusToken[tone]} label={label} {...rest} />;
}
