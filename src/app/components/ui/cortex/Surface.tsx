/**
 * SURFACE — the one container the console builds panels out of.
 *
 * Before this existed, "a panel" was written out by hand on every screen, and
 * the hand differed: `bg-black/40 border border-white/10 rounded-2xl p-6` in one
 * file, `bg-black/30 border border-white/8 rounded-xl p-5` in the next, for
 * containers doing exactly the same job. Three panel fills and four hairline
 * borders were in simultaneous use, which is why depth had stopped carrying any
 * meaning — a nested card could be lighter than the panel holding it.
 *
 * `level` is the only decision left: `raised` for a panel on the page, `sunken`
 * for something nested inside one, `overlay` for something genuinely floating.
 * Everything else follows from the tokens.
 */
import type { ElementType, ReactNode } from 'react';

export type SurfaceLevel = 'raised' | 'sunken' | 'overlay';
export type SurfacePadding = 'none' | 'tight' | 'default' | 'loose';

const LEVEL_CLASS: Record<SurfaceLevel, string> = {
  raised: 'bg-cortex-raised border border-cortex-default',
  sunken: 'bg-cortex-sunken border border-cortex-subtle',
  overlay: 'bg-cortex-overlay border border-cortex-strong shadow-[0_20px_40px_-12px_rgba(0,0,0,0.6)]',
};

const PADDING_CLASS: Record<SurfacePadding, string> = {
  none: '',
  tight: 'p-4',
  default: 'p-5',
  loose: 'p-6',
};

export interface SurfaceProps {
  children: ReactNode;
  level?: SurfaceLevel;
  padding?: SurfacePadding;
  /** Render as a different element — `section`, `article`, `li` — when the
   *  surface carries meaning a `div` would not convey. */
  as?: ElementType;
  className?: string;
  /** Set when the surface itself is labelled by a heading it contains. */
  'aria-labelledby'?: string;
  'aria-label'?: string;
}

export function Surface({
  children,
  level = 'raised',
  padding = 'default',
  as: Component = 'div',
  className = '',
  ...aria
}: SurfaceProps) {
  return (
    <Component
      className={`rounded-cortex-lg ${LEVEL_CLASS[level]} ${PADDING_CLASS[padding]} ${className}`}
      {...aria}
    >
      {children}
    </Component>
  );
}
