/**
 * PHASE 1B TASK 18 — browser timer handles typed with the Node-only namespace
 *
 * Three TS2503 diagnostics ("Cannot find namespace 'NodeJS'") shared one root
 * cause: three browser timer handles were annotated `NodeJS.Timeout`.
 *
 *   src/app/components/ExitIntentPopup.tsx   let idleTimer:  NodeJS.Timeout
 *   src/app/hooks/usePerformance.tsx         useRef<NodeJS.Timeout>()
 *   src/app/hooks/usePerformance.tsx         let timeoutId:  NodeJS.Timeout
 *
 * `NodeJS` is a global namespace contributed by @types/node. The frontend
 * boundary (tsconfig.app.json) deliberately does NOT load it — its `types` list
 * is `["vite/client", "react", "react-dom"]`, and the file says so in prose:
 * "Node globals are excluded." That is correct: this code runs in a browser,
 * where `setTimeout` returns `number`, not a Node `Timeout` object. So the
 * annotation was simply wrong about its own environment, and the namespace it
 * named was unresolvable — TypeScript fell back to `any` and reported TS2503.
 *
 * The fix names `ReturnType<typeof setTimeout>` — whatever the ambient
 * `setTimeout` actually returns at this boundary. That is already the repo's
 * established idiom for exactly this (BlockRegistryPanel, DCFPanel,
 * EngagementActivityFeed, NotificationCenter, PipelineKanban, WinCelebration,
 * ClientPortal and others all use it); these three sites were the stragglers.
 *
 * NOT the fix, deliberately: adding @types/node to the frontend `types` list
 * would have silenced all three too, by pulling Node globals into a browser
 * bundle boundary that documents their exclusion. The final assertion below
 * pins that the boundary was left intact, so a future "fix" of that shape
 * fails here.
 *
 * Type-only change: no timer created, cleared, reordered or re-delayed, so
 * runtime behaviour is byte-identical.
 *
 * TESTING APPROACH (documented limitation)
 *   ExitIntentPopup is a .tsx component and usePerformance is a .tsx hook module.
 *   The repository ships no React test renderer, and the runner
 *   (`node --experimental-strip-types`) strips types but does NOT transform JSX,
 *   so neither can be imported and executed here. Following the established
 *   pattern (frontendRuntimeDefects.test.ts / frontendIconContracts.test.ts),
 *   each guarantee is enforced structurally against the production source.
 *   Assertions are pattern-based, never line-number-based.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function readSource(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

/** Source with comments removed, so guards match code — never prose. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const EXIT_INTENT_REL = 'src/app/components/ExitIntentPopup.tsx';
const USE_PERF_REL = 'src/app/hooks/usePerformance.tsx';

/** The portable handle type the frontend boundary can actually resolve. */
const PORTABLE_HANDLE = /ReturnType<typeof setTimeout>/;

describe('Task 18 — the Node-only namespace is gone from the frontend boundary', () => {
  it('ExitIntentPopup types its idle timer with ReturnType<typeof setTimeout>', () => {
    const code = stripComments(readSource(EXIT_INTENT_REL));
    assert.match(
      code,
      /let\s+idleTimer\s*:\s*ReturnType<typeof setTimeout>\s*;/,
      'expected `let idleTimer: ReturnType<typeof setTimeout>;`',
    );
  });

  it('usePerformance types both timer handles with ReturnType<typeof setTimeout>', () => {
    const code = stripComments(readSource(USE_PERF_REL));
    assert.match(
      code,
      /useRef<ReturnType<typeof setTimeout>>\(\)/,
      'expected the debounced-callback ref to hold ReturnType<typeof setTimeout>',
    );
    assert.match(
      code,
      /let\s+timeoutId\s*:\s*ReturnType<typeof setTimeout>\s*;/,
      'expected `let timeoutId: ReturnType<typeof setTimeout>;`',
    );
  });

  it('no file under src/ references the NodeJS namespace at all', () => {
    // Repo-wide sweep, not a three-file check: the frontend boundary cannot
    // resolve `NodeJS` anywhere, so any reintroduction is a TS2503 waiting to
    // happen — in a new file as much as in these three.
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          walk(rel);
        } else if (/\.tsx?$/.test(entry.name)) {
          if (/\bNodeJS\s*\./.test(stripComments(readSource(rel)))) offenders.push(rel);
        }
      }
    };
    walk('src');

    assert.deepEqual(
      offenders,
      [],
      `these frontend files reference the Node-only NodeJS namespace: ${offenders.join(', ')}`,
    );
  });
});

describe('Task 18 — timer behaviour is unchanged', () => {
  it('ExitIntentPopup still arms and clears the 45s idle timer on the same paths', () => {
    const code = stripComments(readSource(EXIT_INTENT_REL));
    assert.match(code, /clearTimeout\(idleTimer\)/, 'idle timer is no longer cleared');
    assert.match(code, /idleTimer\s*=\s*setTimeout\(/, 'idle timer is no longer armed');
    // Two clears: one when resetting the timer, one on effect cleanup. Losing
    // the cleanup clear would leak a timer past unmount.
    const clears = code.match(/clearTimeout\(idleTimer\)/g) ?? [];
    assert.equal(clears.length, 2, 'expected the reset clear AND the cleanup clear');
  });

  it('usePerformance still debounces the callback and the resize handler', () => {
    const code = stripComments(readSource(USE_PERF_REL));
    assert.match(code, /clearTimeout\(timeoutRef\.current\)/, 'debounced callback no longer clears');
    assert.match(code, /timeoutRef\.current\s*=\s*setTimeout\(/, 'debounced callback no longer arms');
    assert.match(code, /clearTimeout\(timeoutId\)/, 'resize debounce no longer clears');
    assert.match(
      code,
      /timeoutId\s*=\s*setTimeout\(handleResize,\s*150\)/,
      'resize debounce delay changed — this task must not alter timings',
    );
  });
});

describe('Task 18 — the frontend type boundary was not weakened to get here', () => {
  it('tsconfig.app.json still excludes Node globals from its types list', () => {
    // The forbidden alternative fix. If `node` ever appears here the three
    // TS2503s vanish for the wrong reason, so this guard is the point of the task.
    const raw = readSource('tsconfig.app.json');
    const types = /"types"\s*:\s*\[([^\]]*)\]/.exec(stripComments(raw));
    assert.ok(types, 'expected a "types" array in tsconfig.app.json');

    const listed = types[1].split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
    assert.deepEqual(
      listed,
      ['vite/client', 'react', 'react-dom'],
      'the frontend types list changed — Node globals must stay out of the browser boundary',
    );
  });

  it('@types/node is not a frontend dependency', () => {
    const pkg = JSON.parse(readSource('package.json')) as {
      dependencies?: Record<string, string>;
    };
    assert.ok(
      !pkg.dependencies || !('@types/node' in pkg.dependencies),
      '@types/node must not be a runtime dependency of the browser bundle',
    );
  });
});
