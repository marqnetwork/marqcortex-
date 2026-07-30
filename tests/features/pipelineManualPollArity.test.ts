/**
 * PHASE 1B TASK 12 — PipelineKanban manual-poll callback arity correction
 *
 * One TS2554 diagnostic was repaired in this task:
 *
 *     src/app/components/PipelineKanban.tsx
 *       error TS2554: Expected 0 arguments, but got 1.
 *
 * `handleManualPoll` is declared as a zero-argument function whose body always
 * performs a forced manual poll:
 *
 *     const handleManualPoll = () => {
 *       setIsManualPoll(true);
 *       pollPositions(true);   // the `true` is pollPositions' `manual` flag
 *     };
 *
 * The manual-refresh button already wires it with no argument
 * (`onClick={handleManualPoll}`), but the 'r'/'R' keyboard shortcut passed a
 * vestigial boolean — `handleManualPoll(true)` — to a function that declares no
 * parameters and never reads `arguments`. The literal was evaluated and
 * discarded; whether the call is `handleManualPoll()` or `handleManualPoll(true)`
 * the body runs identically. TypeScript (correctly) rejected the extra argument.
 *
 * The fix removes the vestigial argument at the single incorrect call site
 * (Approach A): the keyboard shortcut now calls `handleManualPoll()`, matching
 * the button and the declared zero-argument contract. No optional/rest parameter
 * was added to absorb it (that boolean has no semantic meaning anywhere). The
 * emitted JavaScript for the call differs only by not evaluating a discarded
 * `true`; the manual-poll behaviour — forced poll via `pollPositions(true)` —
 * and the independent automatic-poll interval are both untouched.
 *
 * TESTING APPROACH (documented limitation)
 *   PipelineKanban is a .tsx component. The repository ships no React test
 *   renderer, and the runner (`node --experimental-strip-types`) strips types
 *   but does NOT transform JSX, so the component cannot be imported and rendered
 *   here. Following the established pattern (frontendIconContracts.test.ts /
 *   frontendRuntimeDefects.test.ts / teamSessionKeys.test.ts), each guarantee is
 *   enforced structurally against the production source: the zero-argument
 *   contract, the absence of any vestigial argument at every call site, the
 *   preserved UI wiring (button + keyboard shortcut), the preserved forced-poll
 *   body, and the untouched automatic-poll interval. Assertions are
 *   pattern-based, never line-number-based. `typecheck:web` proves at the type
 *   level that no call passes a surplus argument (that is the diagnostic removed).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

const KANBAN_REL = 'src/app/components/PipelineKanban.tsx';
const raw = readSource(KANBAN_REL);
const code = stripComments(raw);

describe('PipelineKanban — handleManualPoll is a zero-argument callback', () => {
  it('is declared as a zero-parameter arrow function', () => {
    assert.match(
      code,
      /const\s+handleManualPoll\s*=\s*\(\s*\)\s*=>/,
      'expected `const handleManualPoll = () =>` (no parameters)',
    );
  });

  it('no call site passes a vestigial argument', () => {
    // A call is `handleManualPoll(` with no space before the paren; the
    // declaration `handleManualPoll = ()` does not match this. `[^)\s]` after
    // the paren means "some argument", so `handleManualPoll(true)` matches and
    // fails, while `handleManualPoll()` does not. This is exactly the TS2554
    // this task removed.
    assert.doesNotMatch(
      code,
      /handleManualPoll\(\s*[^)\s]/,
      'no call to handleManualPoll may pass an argument',
    );
  });
});

describe('PipelineKanban — manual-poll UI wiring preserved', () => {
  it('the manual refresh button still calls handleManualPoll on click', () => {
    assert.match(
      code,
      /onClick=\{handleManualPoll\}/,
      'expected the refresh button to keep onClick={handleManualPoll}',
    );
  });

  it("the 'r'/'R' keyboard shortcut still invokes handleManualPoll with zero arguments", () => {
    assert.match(
      code,
      /if\s*\(\s*accessToken\s*&&\s*positionsLoaded\s*\)\s*handleManualPoll\(\s*\)\s*;/,
      "expected the 'r'/'R' shortcut to call handleManualPoll()",
    );
  });
});

describe('PipelineKanban — manual and automatic poll behaviour unchanged', () => {
  it('handleManualPoll still forces a poll (setIsManualPoll + pollPositions(true))', () => {
    // Behaviour guard: the body must still flag the manual state and force the
    // poll. If either were dropped the manual refresh would stop working; the
    // arity fix must not touch this.
    assert.match(
      code,
      /const\s+handleManualPoll\s*=\s*\(\s*\)\s*=>\s*\{\s*setIsManualPoll\(true\)\s*;\s*pollPositions\(true\)\s*;\s*\}/,
      'expected handleManualPoll body to remain { setIsManualPoll(true); pollPositions(true); }',
    );
  });

  it('the automatic-poll interval still polls without the manual flag', () => {
    // The background interval performs a non-manual poll (`pollPositions()`),
    // independent of handleManualPoll. Proves the fix did not disturb automatic
    // polling frequency or behaviour.
    assert.match(
      code,
      /setInterval\(\s*\(\s*\)\s*=>\s*pollPositions\(\s*\)\s*,\s*POLL_INTERVAL_MS\s*\)/,
      'expected the automatic poll interval `setInterval(() => pollPositions(), POLL_INTERVAL_MS)` unchanged',
    );
  });
});
