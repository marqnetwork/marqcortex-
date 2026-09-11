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

import { stripComments } from '../helpers/stripComments.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(join(root, 'supabase', 'functions', 'server', 'index.tsx'), 'utf8');

/**
 * Source with comments removed, so the explanation is never the violation.
 *
 * This used to be two `replace` calls with the same regex every scanner here
 * uses. It deleted 4,146 characters of this very file — `app.use("/*", ...)`
 * opens a comment as far as a regex is concerned, and it ran to the next `*` +
 * `/` 101 lines later — so this scanner could not see the CORS policy, the edge
 * rate limiter or its 429 response AT ALL. Nothing in the region was disclosing
 * when that was found; the guard simply was not guarding it.
 */
const body = stripComments(source);

/**
 * Every way a caught value can be rendered into a response.
 *
 * The first version of this matched only `${err}` — template interpolation.
 * The re-audit found `error: String(err)` on the HEALTH endpoint, which is
 * unauthenticated, and the scanner had walked straight past it. A detector that
 * knows one spelling of a mistake certifies the other spellings.
 */
const RENDERS_CAUGHT_VALUE =
  /\$\{\s*(err|error|e)\b[^}]*\}|String\(\s*(err|error|e)\s*\)|\b(err|error|e)\.(message|stack|name|code)\b|JSON\.stringify\(\s*(err|error|e)\s*\)|\berrorType\b/;

/** The balanced object literal each `c.json({...})` is given. */
function responseLiterals(text: string): string[] {
  const literals: string[] = [];
  for (const match of text.matchAll(/c\.json\(\s*\{/g)) {
    const start = match.index! + match[0].length - 1;
    let depth = 0;
    let end = start;
    for (; end < text.length; end += 1) {
      if (text[end] === '{') depth += 1;
      else if (text[end] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    literals.push(text.slice(start, end + 1));
  }
  return literals;
}

describe('error disclosure — the caught value never reaches the caller', () => {
  it('no response renders a caught error, in any spelling', () => {
    // Scoped to the object literal `c.json` is given, matched with a balanced
    // brace walk rather than a fixed window — a window long enough to hold the
    // biggest body also runs into whatever follows it, which is how the first
    // version of this assertion reported a SUCCESS response as a leak.
    const leaks = responseLiterals(body)
      .filter((literal) => RENDERS_CAUGHT_VALUE.test(literal))
      .map((literal) => literal.replace(/\s+/g, ' ').slice(0, 140));
    assert.deepEqual(leaks, [], `responses carrying the caught value:\n${leaks.join('\n')}`);
  });

  it('the unauthenticated routes disclose nothing at all', () => {
    // These answer anybody, so a driver message here names a host and a table to
    // whoever asked. `health` is the one the re-audit caught.
    const PUBLIC = [
      '/make-server-324f4fbe/ping',
      '/make-server-324f4fbe/health',
      '/make-server-324f4fbe/leads/capture',
      '/make-server-324f4fbe/leads/exit-intent',
      '/make-server-324f4fbe/submissions',
      '/make-server-324f4fbe/bookings',
      '/make-server-324f4fbe/auth/client/verify',
      '/make-server-324f4fbe/auth/client/session',
    ];

    for (const route of PUBLIC) {
      const at = body.search(new RegExp(`app\\.(get|post)\\("${route.replace(/\//g, '\\/')}"`));
      assert.notEqual(at, -1, `${route} is gone`);
      const next = body.slice(at + 10).search(/\napp\.(get|post|put|patch|delete)\(/);
      const handler = body.slice(at, next === -1 ? undefined : at + 10 + next);

      for (const literal of responseLiterals(handler)) {
        assert.ok(
          !RENDERS_CAUGHT_VALUE.test(literal),
          `${route} discloses a caught value to an unauthenticated caller:\n${literal.slice(0, 200)}`,
        );
      }
    }
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
