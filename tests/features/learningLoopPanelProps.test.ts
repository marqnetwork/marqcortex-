/**
 * PHASE 1B TASK 24 — a prop passed to a component that never declared it
 *
 * One TS2322: CortexDashboard rendered
 *
 *     <LearningLoopPanel onBack={handleBackFromInsights} onMainBack={onBack} accessToken={accessToken} />
 *
 * but `LearningLoopPanel` declares only `{ onBack: () => void; accessToken?: string }`.
 * `onMainBack` was excess, so the element's prop object was not assignable.
 *
 * WHY REMOVING IT IS BEHAVIOUR-PRESERVING, not a feature deletion
 *   `onMainBack` appeared exactly once in the entire repository — at that one
 *   call site. `LearningLoopPanel` never destructures it, never reads
 *   `props.onMainBack`, and never spreads its props onto a child, so there is
 *   no code path by which the value could be observed. A React function
 *   component cannot react to a prop it never reads: passing it and not passing
 *   it produce identical renders, identical handlers and identical DOM.
 *
 *   That is what separates this from an unimplemented-feature stub. The prop was
 *   not latent logic waiting on a condition; it was inert under every condition.
 *
 * DELIBERATELY NOT DONE
 *   The alternative repair — giving LearningLoopPanel a real second-level "back
 *   to CORTEX" control and declaring the prop — adds a visible control and is a
 *   product decision, not a type correction. It is left for human review.
 *
 * The panel keeps its working back button: `onBack` still receives
 * `handleBackFromInsights`, unchanged.
 *
 * TESTING APPROACH (documented limitation)
 *   Both modules are .tsx and the runner (`node --experimental-strip-types`)
 *   strips types but does NOT transform JSX, so neither can be imported and
 *   rendered here. Following the established pattern, each guarantee is
 *   enforced structurally against the production source. Assertions are
 *   pattern-based, never line-number-based.
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

const DASHBOARD_REL = 'src/app/components/CortexDashboard.tsx';
const PANEL_REL = 'src/app/components/LearningLoopPanel.tsx';

describe('LearningLoopPanel is rendered with exactly the props it declares', () => {
  const dashboard = stripComments(readSource(DASHBOARD_REL));
  const panel = stripComments(readSource(PANEL_REL));

  it('the call site passes onBack and accessToken, and nothing else', () => {
    assert.match(
      dashboard,
      /<LearningLoopPanel onBack=\{handleBackFromInsights\} accessToken=\{accessToken\} \/>/,
      'the LearningLoopPanel render changed',
    );
  });

  it('the panel still declares only onBack and accessToken', () => {
    assert.match(
      panel,
      /export function LearningLoopPanel\(\{\s*onBack,\s*accessToken,\s*\}: \{\s*onBack:\s*\(\) => void;\s*accessToken\?:\s*string;\s*\}\)/,
      'the LearningLoopPanel prop contract changed',
    );
  });

  it('the panel still receives a working back handler', () => {
    // The fix removed a dead prop, not the live one. If `onBack` ever stopped
    // being passed, the panel would lose its back button for real.
    assert.match(dashboard, /onBack=\{handleBackFromInsights\}/, 'onBack is no longer passed');
    assert.match(
      dashboard,
      /const handleBackFromInsights\s*=/,
      'handleBackFromInsights was removed',
    );
  });
});

describe('onMainBack was inert, and is now gone entirely', () => {
  it('no file under src/ mentions onMainBack any more', () => {
    // It existed at exactly one site — the call. A repo-wide sweep is therefore
    // the honest guard: if the name reappears, either a component grew a real
    // handler for it (fine, but re-review this task) or the dead prop is back.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(entry.name) && /\bonMainBack\b/.test(stripComments(readSource(rel)))) {
          offenders.push(rel);
        }
      }
    };
    walk('src');
    assert.deepEqual(offenders, [], `onMainBack reappeared in: ${offenders.join(', ')}`);
  });

  it('the panel destructures its props, so an undeclared one is unreachable', () => {
    // The fact that made removal behaviour-preserving: LearningLoopPanel binds
    // its parameters by destructuring two named props rather than taking a
    // props object, so a third prop has no name to be read by.
    //
    // Deliberately NOT a file-wide `props.` sweep: the module also contains a
    // Recharts tooltip render function whose own inner `props` parameter is
    // unrelated to the component's contract.
    const panel = stripComments(readSource(PANEL_REL));
    const signature = /export function LearningLoopPanel\(([\s\S]*?)\)\s*\{/.exec(panel);
    assert.ok(signature, 'could not locate the LearningLoopPanel signature');
    assert.match(signature[1], /^\s*\{[\s\S]*\}\s*:/, 'the panel no longer destructures its props');
    assert.doesNotMatch(signature[1], /\bonMainBack\b/, 'onMainBack came back into the signature');
  });

  it('the panel spreads nothing onto its children', () => {
    // If a spread were introduced, an undeclared prop could become observable
    // again and the reasoning behind this task would no longer hold.
    assert.doesNotMatch(
      stripComments(readSource(PANEL_REL)),
      /\{\s*\.\.\.\s*(?:props|rest)\b/,
      'the panel now spreads a props object onto a child',
    );
  });
});
