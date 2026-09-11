/**
 * A wildcard origin is safe for exactly one reason, and nothing checked it.
 *
 * `app.use('/*', cors({ origin: '*' }))` is the default, and it is defensible:
 * this function sets no authentication cookie, so a browser attaches no
 * ambient authority to a cross-origin request. Every authenticated route wants
 * a bearer token in the `Authorization` header, and a page on another origin
 * cannot read the token out of the app origin's storage to send one. A
 * cross-origin caller can therefore reach the unauthenticated routes — which is
 * deliberate, because the diagnostic form is embedded on origins this function
 * does not know — and nothing else.
 *
 * That argument holds only while the premise does. `Access-Control-Allow-Origin`
 * paired with `Access-Control-Allow-Credentials` is the classic critical
 * misconfiguration: it turns every authenticated route into a cross-origin read
 * for any page the victim visits. The premise was recorded in a comment and
 * asserted nowhere, so a one-word change could have removed it silently.
 *
 * The security campaign swept authentication, RBAC, RLS, SSRF, secrets and the
 * supply chain. CORS was named in the release requirements and was the one item
 * with no test behind it. This is that test. It is a guard on an invariant, not
 * a fix for a live defect — the configuration is correct as it stands.
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

/**
 * Source with comments removed, so the explanation is never the violation.
 *
 * String-aware, and it has to be: the route this policy is mounted on is the
 * literal `"/*"`, which a regex-based stripper reads as the start of a comment
 * and which therefore deleted this entire middleware from the scan.
 */
const body = stripComments(source);

/** The balanced object literal passed to the one `cors(...)` call. */
function corsOptions(): string {
  const match = /\bcors\(\s*\{/.exec(body);
  assert.ok(match, 'no cors({...}) call found — this suite has lost its subject');

  const start = match.index + match[0].length - 1;
  let depth = 0;
  for (let i = start; i < body.length; i += 1) {
    if (body[i] === '{') depth += 1;
    else if (body[i] === '}') {
      depth -= 1;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  assert.fail('the cors({...}) options literal is unbalanced');
}

describe('CORS — the wildcard is safe only while credentials are off', () => {
  it('there is exactly one CORS middleware, so one place decides the policy', () => {
    const calls = body.match(/\bcors\(/g) ?? [];
    assert.equal(
      calls.length,
      1,
      'more than one cors() call: a second policy can widen the first without touching it',
    );
  });

  it('credentials are never enabled', () => {
    const options = corsOptions();
    assert.doesNotMatch(
      options,
      /credentials\s*:\s*true/,
      'CORS credentials enabled. With a wildcard or reflected origin this makes every ' +
        'authenticated route readable cross-origin by any page the victim visits. If ' +
        'credentials are genuinely needed, the origin must become an explicit allow-list ' +
        'first, and this test must be rewritten to assert that — not deleted.',
    );
  });

  it('the origin is a literal or an allow-list, never the caller\'s own Origin header', () => {
    const options = corsOptions();
    // Reflecting the request's Origin is a wildcard that defeats an allow-list
    // check, and it is what a credentialed misconfiguration usually looks like.
    assert.doesNotMatch(
      options,
      /origin\s*:[^,]*\breq\b[^,]*\bheader\b/i,
      'the CORS origin is reflected from the request. An allow-list that echoes whatever ' +
        'it is given allows everything.',
    );
    assert.match(
      options,
      /origin\s*:/,
      'the cors() call declares no origin at all',
    );
  });

  it('the allow-list comes from the environment, so narrowing needs no code change', () => {
    assert.match(
      body,
      /CORS_ALLOWED_ORIGINS/,
      'CORS_ALLOWED_ORIGINS is gone. Narrowing the origin at deployment time is the ' +
        'documented remedy in the readiness plan; without it the wildcard is permanent.',
    );
  });

  it('no authentication cookie is set, which is why ambient authority does not exist', () => {
    // The premise of the whole argument above. A `Set-Cookie` carrying a session
    // would mean the browser attaches credentials on its own, and the wildcard
    // would stop being safe regardless of what the cors() options say.
    assert.doesNotMatch(
      body,
      /Set-Cookie|setCookie\s*\(/,
      'the server sets a cookie. If it carries a session, a cross-origin request now ' +
        'travels with ambient authority and the wildcard origin is no longer defensible.',
    );
  });

  it('the Authorization header is the credential the policy expects', () => {
    const options = corsOptions();
    assert.match(
      options,
      /allowHeaders\s*:[\s\S]*Authorization/,
      'Authorization is not in allowHeaders, so the bearer token this policy assumes ' +
        'callers use could not be sent',
    );
  });
});
