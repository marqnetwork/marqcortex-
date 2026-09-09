/**
 * ORIENTATION PANEL — what a new organization sees instead of an empty grid.
 *
 * A workspace that has never received a diagnostic used to open onto the same
 * command centre as a workspace running two thousand engagements: six KPI cards
 * reading zero, a pipeline funnel with nothing in it, four charts with no data,
 * and a priority inbox saying nothing needs attention. Technically accurate,
 * and useless — it answered "what is happening?" and left "how do I begin?"
 * entirely unaddressed, which §4.8 asks the product to answer first.
 *
 * Everything here comes from `@/app/core/orientation`, which derives it from
 * real workspace state. There is no stored progress and nothing to dismiss: a
 * step is done because the workspace shows it is done. That is what makes this
 * safe to show — it cannot congratulate somebody for work they have not done,
 * and it cannot nag somebody about work they have.
 */
import { CheckCircle2, Circle, ArrowRight, HelpCircle } from 'lucide-react';
import { Surface, PageHeader } from '@/app/components/ui/cortex';
import { orientationSteps, orientationProgress, type OrientationInput } from '@/app/core/orientation';

interface Props {
  facts: OrientationInput;
  onNavigate: (page: string) => void;
  /** Shown above the steps — the workspace's name, or a greeting. */
  title: string;
  description: string;
}

export function OrientationPanel({ facts, onNavigate, title, description }: Props) {
  const steps = orientationSteps(facts);
  const progress = orientationProgress(facts);

  return (
    <Surface level="raised" padding="loose" as="section" aria-labelledby="orientation-heading">
      <PageHeader
        level="h2"
        title={title}
        description={description}
        actions={
          <span className="text-cortex-muted text-[length:var(--cortex-font-size-caption)]">
            {/* Unknown steps are counted out of the denominator rather than
                being reported as outstanding — the console does not know, and
                saying "2 of 4" when it cannot resolve one of them is a guess. */}
            {progress.done} of {progress.total - progress.unknown} done
          </span>
        }
      />
      <span id="orientation-heading" className="sr-only">Getting started with Cortex</span>

      <ol className="mt-5 space-y-2">
        {steps.map(step => {
          const isNext = step.state === 'next';
          const isDone = step.state === 'done';
          const isUnknown = step.state === 'unknown';

          return (
            <li key={step.id}>
              <div
                className={`flex items-start gap-3 rounded-cortex-md border p-4 transition-colors ${
                  isNext
                    ? 'border-cortex-accent/40 bg-cortex-accent/8'
                    : 'border-cortex-subtle bg-cortex-sunken'
                }`}
              >
                <span className="flex-shrink-0 mt-0.5" aria-hidden="true">
                  {isDone ? (
                    <CheckCircle2 className="size-5 text-cortex-success" />
                  ) : isUnknown ? (
                    <HelpCircle className="size-5 text-cortex-faint" />
                  ) : (
                    <Circle className={`size-5 ${isNext ? 'text-cortex-accent' : 'text-cortex-faint'}`} />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <p className={`font-semibold text-[length:var(--cortex-font-size-body)] ${
                    isDone ? 'text-cortex-muted line-through' : 'text-cortex-primary'
                  }`}>
                    {step.title}
                    {/* The state is carried in text, not only in the icon and
                        the strikethrough — colour and decoration alone are not
                        an accessible way to say "done". */}
                    <span className="sr-only">
                      {isDone ? ' — done' : isNext ? ' — do this next' : isUnknown ? ' — not yet known' : ' — later'}
                    </span>
                  </p>
                  <p className="mt-0.5 text-cortex-muted text-[length:var(--cortex-font-size-caption)]">
                    {step.detail}
                    {/* An unknown step keeps its own explanation and gains a
                        note about why it has no tick — replacing the detail
                        with "waiting for the workspace to load" claimed the
                        wrong thing was pending, which is its own small lie. */}
                    {isUnknown && (
                      <span className="text-cortex-faint"> Cortex has not confirmed this one yet.</span>
                    )}
                  </p>
                </div>

                {/* Only the next step gets a button. Offering one on every row
                    turns a sequence into a menu, and the point of orientation is
                    that there is one thing to do. */}
                {isNext && step.target && step.actionLabel && (
                  <button
                    onClick={() => onNavigate(step.target!)}
                    className="flex-shrink-0 inline-flex items-center gap-2 px-4 rounded-cortex-md bg-gradient-to-r from-cortex-accent to-cortex-accent-alt text-white font-semibold text-[length:var(--cortex-font-size-caption)] hover:opacity-90 transition-opacity"
                    style={{ height: 'var(--cortex-control-height-compact)' }}
                  >
                    {step.actionLabel}
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Surface>
  );
}
