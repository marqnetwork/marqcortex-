/**
 * Viewport queries for layout decisions the CSS cannot make alone.
 *
 * Most responsive behaviour belongs in CSS, and stays there. This hook exists
 * for the cases where the COMPONENT TREE has to differ, not just its styling:
 * the team console's sidebar is a column of the page layout on a wide screen
 * and an overlay drawer on a narrow one, and a drawer that is merely hidden
 * with CSS is still in the tab order and still read aloud.
 *
 * Pure browser API, no dependencies, and safe to call before `window` exists
 * (server render, test environment): it reports `false` until the first effect
 * runs, so the wide layout is the default and nothing flashes a drawer open.
 */
import { useEffect, useState } from 'react';

/**
 * Below this width the console switches to its compact layout.
 *
 * 1024px, matching Tailwind's `lg`, so the JavaScript decision and the CSS
 * breakpoints used around it agree. The team console's sidebar is 280px; below
 * `lg` that leaves too little for the dense content beside it.
 */
export const COMPACT_VIEWPORT_MAX = 1023;

/** True while the viewport is narrow enough for the compact layout. */
export function useIsCompactViewport(): boolean {
  return useMediaQuery(`(max-width: ${COMPACT_VIEWPORT_MAX}px)`);
}

/** True when the visitor has asked their system to reduce motion. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);

  return matches;
}
