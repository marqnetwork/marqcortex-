/**
 * Secrets come from the CSPRNG — S-8.
 *
 * The team invite route minted its temporary password with `Math.random()`, and
 * that password is returned to the inviting admin to pass on. V8's
 * `Math.random()` is xorshift128+ with a per-isolate seed and its state is
 * recoverable from a few outputs — and this isolate publishes outputs
 * constantly: notification ids, message ids, lead ids, note ids, all returned in
 * ordinary responses. A team member with the lowest role could collect those,
 * recover the state, predict the next invite's password, and use it before the
 * admin had finished handing it over.
 *
 * Two things are tested here. That the generator is uniform and long enough,
 * against an injected byte source so the distribution is checked rather than
 * hoped for. And that no route reaches for `Math.random()` to make something a
 * person will authenticate with.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  DEFAULT_SECRET_LENGTH,
  randomSecret,
  temporaryPassword,
} from '../../supabase/functions/server/security/randomSecret.ts';

const SERVER = new URL('../../supabase/functions/server/', import.meta.url);

describe('the generator is uniform and unguessable', () => {
  it('rejection-samples rather than taking a biased modulus', () => {
    // The alphabet is 56 symbols, so the 32 byte values from 224 upward would
    // skew the first 32 symbols if a byte were taken modulo the alphabet
    // directly. They must be discarded and redrawn instead.
    const feed = [224, 255, 0, 1, 55, 55];
    let cursor = 0;
    const secret = randomSecret(3, (buffer) => {
      for (let i = 0; i < buffer.length; i++) buffer[i] = feed[Math.min(cursor++, feed.length - 1)];
      return buffer;
    });

    // 224 and 255 are discarded, leaving 0, 1 and 55 — the first, second and
    // LAST symbols of the alphabet. Taking them modulo instead would have
    // produced 224 % 56 = 0 and 255 % 56 = 31, so the first symbol would appear
    // where a rejection was due.
    assert.equal(secret, 'AB9', `biased draws were accepted: ${secret}`);
  });

  it('covers the alphabet evenly across many draws', () => {
    // A real CSPRNG draw, checked for the shape a biased generator would break:
    // every symbol reachable, and none wildly over-represented.
    const counts = new Map<string, number>();
    const sample = randomSecret(60_000);
    for (const symbol of sample) counts.set(symbol, (counts.get(symbol) ?? 0) + 1);

    assert.equal(counts.size, 56, `only ${counts.size} of 56 symbols appeared`);
    const expected = 60_000 / 56;
    for (const [symbol, count] of counts) {
      assert.ok(
        count > expected * 0.7 && count < expected * 1.3,
        `${symbol} appeared ${count} times, expected about ${Math.round(expected)}`,
      );
    }
  });

  it('excludes the characters people misread', () => {
    const sample = randomSecret(20_000);
    for (const ambiguous of ['0', 'O', 'o', '1', 'l', 'I']) {
      assert.ok(
        !sample.includes(ambiguous),
        `${ambiguous} is in the alphabet — it will be transcribed wrong`,
      );
    }
  });

  it('is long enough that the readable alphabet costs nothing', () => {
    assert.ok(DEFAULT_SECRET_LENGTH >= 20, 'the secret got shorter');
    // log2(56) * 24 is about 139 bits.
    const bits = Math.log2(56) * DEFAULT_SECRET_LENGTH;
    assert.ok(bits > 128, `only ${Math.round(bits)} bits of entropy`);
  });

  it('does not repeat itself', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(temporaryPassword());
    assert.equal(seen.size, 500, 'the generator returned a duplicate in 500 draws');
  });

  it('produces a password a complexity policy will accept', () => {
    for (let i = 0; i < 50; i++) {
      const password = temporaryPassword();
      assert.ok(password.length >= 22, `too short: ${password.length}`);
      assert.match(password, /[0-9]/, 'no digit');
      assert.match(password, /[^A-Za-z0-9]/, 'no symbol');
    }
  });
});

describe('no credential is drawn from Math.random', () => {
  it('the invite route uses the CSPRNG generator', async () => {
    const source = await readFile(new URL('index.tsx', SERVER), 'utf8');
    const start = source.indexOf('app.post("/make-server-324f4fbe/team/invite"');
    assert.notEqual(start, -1, 'the invite route is gone');
    // Comments are stripped first: the line that REPLACED the Math.random call
    // explains what it replaced, and a scanner that cannot tell prose from code
    // teaches people to delete the prose.
    const handler = source
      .slice(start, source.indexOf('\napp.', start + 1))
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

    assert.match(handler, /temporaryPassword\(\)/, 'the invite route no longer uses the generator');
    assert.ok(
      !/Math\.random/.test(handler),
      'the invite route draws from Math.random again',
    );
  });

  it('nothing anywhere builds a credential out of Math.random', async () => {
    const source = await readFile(new URL('index.tsx', SERVER), 'utf8');
    const offenders: string[] = [];

    for (const line of source.split('\n')) {
      if (!/Math\.random/.test(line)) continue;
      if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) continue;
      // Identifiers are fine — a message id is not a credential, and since the
      // client portal stopped treating a submission id as one (S-6), none of
      // these grant anything. A value BOUND to a credential name is not fine.
      if (/\b[\w$]*(?:password|secret|token|api_?key|credential|code)\s*[:=]/i.test(line)) {
        offenders.push(line.trim().slice(0, 90));
      }
    }

    assert.deepEqual(offenders, [], 'these mint something authenticating from a predictable source');
  });
});
