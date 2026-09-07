/**
 * INSTANT BOOKING — the countdown timer is an effect, not a state initialiser
 *
 * `CountdownTimer` in src/app/components/InstantBooking.tsx scheduled its
 * one-second interval with `useState`, not `useEffect`:
 *
 *     useState(() => {
 *       const interval = setInterval(...);
 *       return () => clearInterval(interval);
 *     }, []);
 *
 *     src/app/components/InstantBooking.tsx(345,6)
 *       error TS2554: Expected 0-1 arguments, but got 2.
 *
 * TypeScript flagged only the surplus `[]`, but the defect is what the first
 * argument does. React treats a function passed to `useState` as a LAZY
 * INITIALISER: it calls it once during render and stores the return value as
 * state. So the interval was created as a side effect during render, and the
 * cleanup closure it returned became the component's state — a value nothing
 * ever calls. The dependency array was discarded.
 *
 * The consequences are the ones a missing cleanup always has: the interval
 * outlived the component and kept calling `setTimeLeft` after unmount, and
 * because the initialiser also re-runs when React re-mounts the component
 * (StrictMode double-invoke, or the booking panel being closed and reopened),
 * intervals accumulated — each one ticking the same countdown down faster.
 *
 * `useEffect` is the correct hook: it runs after commit rather than during
 * render, honours the `[]` dependency array, and calls the returned cleanup on
 * unmount.
 *
 * TESTING APPROACH (documented limitation)
 *   This is a .tsx component and the repository ships no React test renderer;
 *   the runner (`node --experimental-strip-types`) strips types but does not
 *   transform JSX, so the component cannot be mounted here. Following the
 *   established pattern in frontendRuntimeDefects.test.ts and
 *   teamSessionKeys.test.ts, the guarantee is enforced structurally against the
 *   production source with pattern-based assertions, never line numbers.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SOURCE_REL = 'src/app/components/InstantBooking.tsx';

/** Source with comments removed, so guards match code — never prose. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const source = stripComments(readFileSync(join(REPO_ROOT, SOURCE_REL), 'utf8'));

describe('InstantBooking — CountdownTimer schedules its interval in an effect', () => {
  it('sets the interval inside useEffect', () => {
    assert.match(
      source,
      /useEffect\(\(\) => \{\s*const interval = setInterval\(/,
      'the countdown interval must be scheduled from useEffect, which runs after commit',
    );
  });

  it('never passes a dependency array to useState', () => {
    // The exact shape of the defect: useState given a second argument. React
    // ignores it, so nothing crashes and nothing warns — only this catches it.
    assert.doesNotMatch(
      source,
      /useState\((?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>[\s\S]*?\}\s*,\s*\[\s*\]\s*\)/,
      'useState takes an initial value or a lazy initialiser — never a dependency array',
    );
  });

  it('never calls setInterval from a useState initialiser', () => {
    assert.doesNotMatch(
      source,
      /useState\(\(\) => \{\s*const interval = setInterval\(/,
      'scheduling an interval from useState runs it during render and never cleans it up',
    );
  });

  it('clears the interval, so the timer does not outlive the component', () => {
    assert.match(source, /return \(\) => clearInterval\(interval\)/);
  });

  it('imports useEffect, so the hook resolves at runtime', () => {
    // A missing import here is a ReferenceError on mount, not a type error:
    // this file is only reached through typecheck:web, which the repository
    // still carries pre-existing debt in.
    assert.match(
      source,
      /import \{[^}]*\buseEffect\b[^}]*\} from 'react'/,
      'useEffect must be imported from react',
    );
  });
});
