/**
 * A 500 must not tell a stranger how the server is built.
 *
 * Every route used to interpolate the caught error straight into the response
 * body — `Failed to fetch submission: ${err}` — on 67 routes, and one returned
 * the stack trace as well. Those messages are not generic: a PostgREST failure
 * names the table, the column and the constraint it tripped, and a driver
 * failure can name the host it could not reach. Handing them to whoever made
 * the request is information disclosure on the one path nobody exercises by
 * hand.
 *
 * The detail is not lost — `failureResponse` logs it in full against a short
 * reference and returns that reference — so this suite pins the SPLIT rather
 * than the absence of error handling.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(join(root, 'supabase', 'functions', 'server', 'index.tsx'), 'utf8');

/** Source with comments removed, so the explanation is never the violation. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
const body = code(source);

describe('error disclosure — the caught value never reaches the caller', () => {
  it('no response interpolates a caught error into its body', () => {
    const leaks = [...body.matchAll(/c\.json\(\s*\{[^}]*error:[^}]*\$\{\s*(err|error|e)\b[^}]*\}/g)]
      .map((match) => match[0].slice(0, 140));
    assert.deepEqual(leaks, [], `responses carrying the caught error:\n${leaks.join('\n')}`);
  });

  it('no response carries a stack trace or an error class name', () => {
    // Scoped to the object literal `c.json` is given, matched with a balanced
    // brace walk rather than a fixed window — a window long enough to hold the
    // biggest body also runs into whatever follows it, which is how the first
    // version of this assertion reported a SUCCESS response as a leak.
    for (const match of body.matchAll(/c\.json\(\s*\{/g)) {
      const start = match.index! + match[0].length - 1;
      let depth = 0;
      let end = start;
      for (; end < body.length; end += 1) {
        if (body[end] === '{') depth += 1;
        else if (body[end] === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const literal = body.slice(start, end + 1);
      assert.ok(!/\bstack\s*:/.test(literal), `a response returns a stack trace:\n${literal.slice(0, 200)}`);
      assert.ok(!/\berrorType\s*:/.test(literal), `a response returns an error class:\n${literal.slice(0, 200)}`);
    }
  });

  it('the failure path still records the detail server-side', () => {
    // The point is a SPLIT, not silence. A helper that returned a tidy message
    // and logged nothing would pass the two assertions above and leave an
    // operator with no way to diagnose anything.
    assert.match(body, /function failureResponse\(/);
    assert.match(body, /console\.error\(/);
    assert.match(body, /errorField\(err, 'stack'\)/);
  });

  it('the caller receives a reference that ties their report to the log', () => {
    assert.match(body, /const reference = crypto\.randomUUID\(\)/);
    assert.match(body, /error: `\$\{context\} failed\.`, reference/);
  });

  it("validation messages that echo the caller's own input are untouched", () => {
    // Echoing what somebody just sent is not disclosure, and those messages are
    // the actionable ones. If this ever reads zero, the fix went too far.
    const echoes = [...body.matchAll(/error:\s*`Invalid \w+: \$\{/g)];
    assert.ok(echoes.length > 0, 'the caller-input validation messages were rewritten too');
  });

  it('every route that catches uses the helper rather than its own shape', () => {
    const helperUses = [...body.matchAll(/return failureResponse\(/g)].length;
    assert.ok(helperUses >= 60, `expected the helper on the failure paths, found ${helperUses}`);
  });
});
