/**
 * A static scanner that cannot see part of the file certifies that part.
 *
 * The security suite's guarantees are only as wide as the text the scanners
 * actually read. `tests/security/errorDisclosure.test.ts` is the standing
 * regression for S-1 and S-10, and its own header argues that "a detector that
 * knows one spelling of a mistake certifies the other spellings" — which was
 * true, and was not the only way it could be narrow.
 *
 * It stripped comments with a regex, and a regex does not know that `/*` inside
 * a string literal is not a comment. The Hono middleware is mounted on the path
 * `"/*"`, so the scan treated that string as a comment opener and deleted
 * everything up to the next `*` + `/` — 101 lines, 4,146 characters, containing
 * the CORS policy, the edge rate limiter and its 429 response body.
 *
 * So this file checks the checkers. Two claims:
 *
 *   1. the stripper removes comments and NOT strings, regexes or code; and
 *   2. after stripping, the server router still contains the security-relevant
 *      middleware — named literally, so the check fails if the blindness comes
 *      back by any route, not only the one that caused it.
 *
 * The second is the one that would have caught the original defect. The first
 * is why it stays caught.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { stripComments } from '../helpers/stripComments.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = join(root, 'supabase', 'functions', 'server', 'index.tsx');
const source = readFileSync(SERVER, 'utf8');

describe('the comment stripper removes comments and nothing else', () => {
  it('a block comment goes', () => {
    assert.equal(stripComments('a /* gone */ b').replace(/\s+/g, ' ').trim(), 'a b');
  });

  it('a line comment goes, and the newline stays', () => {
    assert.equal(stripComments('a // gone\nb'), 'a  \nb');
  });

  it('a comment opener inside a double-quoted string is not a comment', () => {
    const text = 'app.use("/*", handler);\nconst after = 1;';
    assert.equal(stripComments(text), text);
  });

  it('a comment opener inside a single-quoted string is not a comment', () => {
    const text = "app.use('/*', handler);\nconst after = 1;";
    assert.equal(stripComments(text), text);
  });

  it('a comment opener inside a template literal is not a comment', () => {
    const text = 'const p = `/*`;\nconst after = 1;';
    assert.equal(stripComments(text), text);
  });

  it('a regex literal containing an escaped comment terminator survives', () => {
    // This exact pattern is what the old stripper was built from, and treated
    // as code it opens a comment that never closes.
    const text = 'const re = /\\/\\*[\\s\\S]*?\\*\\//g;\nconst after = 1;';
    assert.equal(stripComments(text), text);
  });

  it('an escaped quote does not end the string early', () => {
    const text = 'const s = "a \\" /* still a string */ b";\nconst after = 1;';
    assert.equal(stripComments(text), text);
  });

  it('code after a string containing "/*" is still scannable', () => {
    const stripped = stripComments('app.use("/*", x);\ncredentials: true;');
    assert.match(
      stripped,
      /credentials:\s*true/,
      'a string literal swallowed the code after it — the original defect',
    );
  });
});

describe('the server router is fully visible to the scanners', () => {
  const scanned = stripComments(source);

  /**
   * Named literally rather than measured as a percentage. A ratio check passes
   * while the one region that matters is missing; naming the middleware means
   * the failure says which guard went blind.
   */
  const MUST_REMAIN = [
    ['the CORS policy', 'cors({'],
    ['the CORS allow-list', 'CORS_ALLOWED_ORIGINS'],
    ['the edge rate limiter', 'createRequestRateLimiter'],
    ['the rate limiter\'s refusal body', 'Too many requests'],
    ['the rate-limit response headers', 'X-RateLimit-Limit'],
  ] as const;

  for (const [what, needle] of MUST_REMAIN) {
    it(`${what} survives comment stripping`, () => {
      assert.ok(
        source.includes(needle),
        `${needle} is no longer in the source — re-point this check, do not delete it`,
      );
      assert.ok(
        scanned.includes(needle),
        `${what} was removed by comment stripping, so every static scanner that reads ` +
          `index.tsx is blind to it. This is how 4,146 characters including the rate ` +
          `limiter went unscanned.`,
      );
    });
  }

  it('every response literal in the file is still there to be scanned', () => {
    const inSource = (source.match(/c\.json\(/g) ?? []).length;
    const inScanned = (scanned.match(/c\.json\(/g) ?? []).length;
    assert.equal(
      inScanned,
      inSource,
      `${inSource - inScanned} response literal(s) vanished during comment stripping. ` +
        `The error-disclosure scanner examines exactly these, so a vanished one is a ` +
        `route whose 500 body nobody checks.`,
    );
  });
});
