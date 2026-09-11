/**
 * Client portal authentication — S-6.
 *
 * The defect: `POST /auth/client/verify` took `{ email }` and answered with the
 * submission id, the company name, and an eight-hour session token. No code, no
 * link, no password. An email address was the whole credential.
 *
 * Two consequences, both reachable by anyone with no account:
 *
 *   1. Knowing a client's address was the same as being them — their diagnostic
 *      answers, report, proposal and message history, all readable.
 *   2. `exists: true` / `exists: false` made the route an oracle: post a list of
 *      addresses and learn which of them are MARQ clients, collecting each
 *      one's company name on the way past.
 *
 * A second door led to the same room: `requireClientAccess` accepted `?email=`
 * as an alternative to the session token on every read route.
 *
 * Earlier work on this path proved that a token, once issued, is bound to one
 * submission and cannot reach another client's data. That was true then and is
 * true now. It is a statement about what a token can DO, and it says nothing
 * about who is allowed to GET one — which is the half that was missing.
 *
 * The tests below run the real challenge module against an in-memory store, and
 * then scan the deployed server for the shapes that made either door possible.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  CHALLENGE_TTL_MS,
  MAX_ATTEMPTS,
  challengeKey,
  constantTimeEquals,
  generateCode,
  hashCode,
  redeemChallenge,
  requestChallenge,
  type ChallengeStore,
} from '../../supabase/functions/server/security/clientChallenge.ts';

const SERVER = new URL('../../supabase/functions/server/', import.meta.url);

/** The KV surface the challenge module uses, in memory. */
function memoryStore(): ChallengeStore & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  return {
    rows,
    get: (key) => Promise.resolve(rows.get(key)),
    set: (key, value) => {
      rows.set(key, value);
      return Promise.resolve();
    },
    del: (key) => {
      rows.delete(key);
      return Promise.resolve();
    },
  };
}

describe('a code is required, and it is a real one', () => {
  it('an address alone yields nothing to sign in with', async () => {
    const store = memoryStore();
    const { code } = await requestChallenge(store, 'victim@acme.test', 'sub-1');

    // The only thing the caller gets is a code to MAIL. Not a token, not the
    // submission id — the route hands back an acknowledgement and nothing else.
    assert.equal(typeof code, 'string');
    assert.match(code!, /^\d{6}$/);

    // And the stored record is not something an attacker could use either.
    const stored = JSON.parse(store.rows.get(challengeKey('victim@acme.test'))!);
    assert.ok(!Object.values(stored).includes(code), 'the code itself was stored');
    assert.match(stored.codeHash, /^[0-9a-f]{64}$/);
  });

  it('an address with no submission produces no challenge at all', async () => {
    const store = memoryStore();
    const { code } = await requestChallenge(store, 'stranger@nowhere.test', null);
    assert.equal(code, null);
    assert.equal(store.rows.size, 0, 'a challenge was minted for a non-client');

    // And redeeming against it fails the same way a wrong code does.
    const result = await redeemChallenge(store, 'stranger@nowhere.test', '000000');
    assert.equal(result.ok, false);
  });

  it('the right code opens it exactly once', async () => {
    const store = memoryStore();
    const { code } = await requestChallenge(store, 'client@acme.test', 'sub-7');

    const first = await redeemChallenge(store, 'client@acme.test', code!);
    assert.deepEqual(first, { ok: true, submissionId: 'sub-7' });

    const replay = await redeemChallenge(store, 'client@acme.test', code!);
    assert.equal(replay.ok, false, 'the code still worked after it was used');
  });

  it('a wrong code never opens it, and five of them destroy the challenge', async () => {
    const store = memoryStore();
    const { code } = await requestChallenge(store, 'client@acme.test', 'sub-7');
    const wrong = code === '111111' ? '222222' : '111111';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const result = await redeemChallenge(store, 'client@acme.test', wrong);
      assert.equal(result.ok, false, `attempt ${attempt} was accepted`);
    }

    // Exhausted. Even the REAL code is now dead — the attacker's guessing cost
    // the challenge, so continuing means making the mailbox receive another.
    const withRealCode = await redeemChallenge(store, 'client@acme.test', code!);
    assert.equal(withRealCode.ok, false, 'guessing past the cap left the code live');
    assert.equal(store.rows.size, 0);
  });

  it('a code expires', async () => {
    const store = memoryStore();
    let clock = 1_000_000;
    const { code } = await requestChallenge(store, 'client@acme.test', 'sub-7', () => clock);

    clock += CHALLENGE_TTL_MS + 1;
    const result = await redeemChallenge(store, 'client@acme.test', code!, () => clock);
    assert.equal(result.ok, false, 'an expired code still worked');
    assert.equal(store.rows.size, 0);
  });

  it('a code minted for one address does not work for another', async () => {
    const store = memoryStore();
    const { code } = await requestChallenge(store, 'alice@acme.test', 'sub-alice');
    await requestChallenge(store, 'mallory@evil.test', 'sub-mallory');

    // Mallory knows Alice's code — from a forwarded mail, a shoulder, a log.
    const stolen = await redeemChallenge(store, 'mallory@evil.test', code!);
    assert.equal(stolen.ok, false, "another client's code was accepted");

    // And it still works for Alice, so the failure was the binding, not a
    // side effect that consumed her challenge.
    const alice = await redeemChallenge(store, 'alice@acme.test', code!);
    assert.deepEqual(alice, { ok: true, submissionId: 'sub-alice' });
  });

  it('requesting again replaces the challenge rather than accumulating them', async () => {
    const store = memoryStore();
    const first = await requestChallenge(store, 'client@acme.test', 'sub-7');
    const second = await requestChallenge(store, 'client@acme.test', 'sub-7');

    assert.equal(store.rows.size, 1, 'challenges accumulated per request');
    const stale = await redeemChallenge(store, 'client@acme.test', first.code!);
    assert.equal(stale.ok, false, 'the superseded code still worked');
    const current = await redeemChallenge(store, 'client@acme.test', second.code!);
    assert.equal(current.ok, true);
  });

  it('the address is normalised, so case and padding are not a second identity', async () => {
    const store = memoryStore();
    const { code } = await requestChallenge(store, '  Client@Acme.TEST  ', 'sub-7');
    const result = await redeemChallenge(store, 'client@acme.test', code!);
    assert.deepEqual(result, { ok: true, submissionId: 'sub-7' });
  });
});

describe('the code is drawn from a real source of randomness', () => {
  it('rejection-samples rather than taking a biased modulus', () => {
    // 0xFFFFFFFF is above the rejection limit, so a generator that does not
    // resample would return it modulo a million and be observably biased.
    const draws = [0xffffffff, 0xfffffff0, 42];
    let i = 0;
    const code = generateCode((buffer) => {
      buffer[0] = draws[Math.min(i++, draws.length - 1)];
      return buffer;
    });

    assert.equal(code, '000042', 'the out-of-range draws were not resampled');
    assert.equal(i, 3, 'the generator accepted a draw above the rejection limit');
  });

  it('spans the whole six-digit space, keeping leading zeros', () => {
    assert.equal(generateCode((b) => { b[0] = 0; return b; }), '000000');
    assert.equal(generateCode((b) => { b[0] = 999_999; return b; }), '999999');
    assert.equal(generateCode((b) => { b[0] = 7; return b; }), '000007');
  });

  it('hashes differ per address, and compare without leaking position', async () => {
    const a = await hashCode('alice@acme.test', '123456');
    const b = await hashCode('bob@acme.test', '123456');
    assert.notEqual(a, b, 'the same code hashed identically for two addresses');

    assert.equal(constantTimeEquals(a, a), true);
    assert.equal(constantTimeEquals(a, b), false);
    assert.equal(constantTimeEquals(a, a.slice(0, -1)), false);
    assert.equal(constantTimeEquals('', ''), true);
  });
});

describe('neither door back into the building is open', () => {
  async function serverSource(name: string): Promise<string> {
    return readFile(new URL(name, SERVER), 'utf8');
  }

  it('the guard takes a token and nothing else', async () => {
    const source = await serverSource('index.tsx');
    const start = source.indexOf('async function requireClientAccess(');
    assert.notEqual(start, -1, 'requireClientAccess is gone');
    const body = source.slice(start, source.indexOf('\n}', start));

    assert.ok(
      !/emailQuery/.test(body),
      'requireClientAccess accepts an email again — an address is not a credential',
    );
    assert.ok(
      !/req\.query\(/.test(body),
      'requireClientAccess reads the query string, which the caller controls',
    );
    assert.match(body, /verifyClientToken\(authHeader\)/);
  });

  it('no route passes an email into the guard', async () => {
    const source = await serverSource('index.tsx');
    const calls = source.match(/requireClientAccess\((?:[^()]|\([^()]*\))*\)/g) ?? [];
    assert.ok(calls.length >= 8, `expected the portal routes, found ${calls.length}`);

    for (const call of calls) {
      assert.ok(
        !/email/i.test(call),
        `a call site still supplies an email: ${call}`,
      );
    }
  });

  it('the sign-in route issues no token and answers the same either way', async () => {
    const source = await serverSource('index.tsx');
    const start = source.indexOf('app.post("/make-server-324f4fbe/auth/client/verify"');
    assert.notEqual(start, -1, 'the challenge route is gone');
    const body = source.slice(start, source.indexOf('\napp.post(', start + 1));

    assert.ok(
      !/client_session:/.test(body) && !/sessionToken/.test(body),
      'the challenge route mints a session again',
    );
    assert.ok(
      !/exists\s*:/.test(body),
      'the challenge route reports whether the address is a client',
    );
    assert.ok(
      !/companyName/.test(body),
      'the challenge route discloses the company before anything is proven',
    );
    assert.match(body, /requestChallenge\(/, 'the route no longer mints a challenge');
  });

  it('a session is only minted after a code is redeemed', async () => {
    const source = await serverSource('index.tsx');

    // Every write of a client session token in the deployed server.
    const writes = [...source.matchAll(/kv\.set\(\s*`client_session:/g)];
    assert.equal(writes.length, 1, `expected exactly one mint site, found ${writes.length}`);

    // The route that contains it must be the one that checks a code. Scoped to
    // the enclosing handler, not a fixed window: a window wide enough to reach
    // the redemption from anywhere is a window that proves nothing.
    const site = writes[0].index!;
    const handlerStart = source.lastIndexOf('app.post(', site);
    const handler = source.slice(handlerStart, site);
    assert.match(
      handler,
      /redeemChallenge\(/,
      'a session token is minted in a route that never checks a code',
    );
  });

  it('the front end has no way to ask for a session without a code', async () => {
    const api = await readFile(new URL('../../src/app/lib/api.ts', import.meta.url), 'utf8');
    assert.ok(!/verifyClientEmail/.test(api), 'the one-step call is back');
    assert.match(api, /requestClientSignInCode/);
    assert.match(api, /exchangeClientSignInCode/);

    const exchange = api.slice(api.indexOf('export async function exchangeClientSignInCode'));
    assert.match(
      exchange.slice(0, 400),
      /body: JSON\.stringify\(\{ email, code \}\)/,
      'the exchange no longer sends a code',
    );
  });
});
