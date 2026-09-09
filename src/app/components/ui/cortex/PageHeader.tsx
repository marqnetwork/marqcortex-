/**
 * PAGE HEADER — the title block every panel opens with.
 *
 * Each panel wrote its own, and they disagreed on everything: heading size,
 * whether a description existed, where the actions sat, how much space came
 * after. The result was that moving between two pages of the same console felt
 * like moving between two products.
 *
 * The heading is a real `<h1>`/`<h2>`, not a styled `<div>`, so the page has a
 * document outline a screen reader can navigate.
 */
import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  description?: string;
  /** Buttons or controls for the page as a whole. */
  actions?: ReactNode;
  /** An icon or badge shown before the title. */
  leading?: ReactNode;
  /** `h1` for a page's own title, `h2` for a section within one. */
  level?: 'h1' | 'h2';
  className?: string;
}

export function PageHeader({
  title, description, actions, leading, level = 'h1', className = '',
}: PageHeaderProps) {
  const Heading = level;
  return (
    <div className={`flex items-start justify-between gap-4 flex-wrap ${className}`}>
      <div className="flex items-start gap-3 min-w-0">
        {leading && <div className="flex-shrink-0 mt-0.5">{leading}</div>}
        <div className="min-w-0">
          <Heading className="text-cortex-primary font-semibold text-[length:var(--cortex-font-size-title)] leading-tight">
            {title}
          </Heading>
          {description && (
            <p className="mt-1 text-cortex-muted text-[length:var(--cortex-font-size-body)]">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}
