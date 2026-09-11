/**
 * Bounds on unauthenticated input — S-9.
 *
 * Four routes take a body from anybody. Three of them did `await c.req.json()`
 * and used the result: no size limit, no type check past truthiness, and the
 * whole of `answers` stored into KV exactly as it arrived.
 *
 * That made a request cost whatever its sender chose. The edge limiter allows
 * 120 a minute per caller, so a megabyte apiece is 120 MB a minute of database
 * growth from one address, into a table nobody is watching.
 *
 * It also turned malformed input into a server fault: `email` was checked for
 * truthiness and then `.split('@')` was called on it, so `{"email": 12345}`
 * answered 500 where it should have answered 400.
 *
 * The reader is tested against real streams, including one that lies about its
 * length, because the point of reading the stream rather than calling `.json()`
 * is that the limit binds on what ARRIVES rather than on what was declared.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  MAX_ANSWER_KEYS,
  MAX_ANSWER_LENGTH,
  MAX_BODY_BYTES,
  MAX_FIELD_LENGTH,
  boundedAnswers,
  boundedEmail,
  boundedString,
  optionalBoundedString,
  readBoundedJson,
} from '../../supabase/functions/server/security/inputLimits.ts';

const SERVER = new URL('../../supabase/functions/server/', import.meta.url);

/** A Request whose body is a real stream, with an optionally LYING length. */
function request(payload: string, declaredLength?: number): Request {
  const bytes = new TextEncoder().encode(payload);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // In chunks, so the reader's running total is exercised rather than a
      // single buffer it could have measured in one go.
      for (let at = 0; at < bytes.length; at += 1024) {
        controller.enqueue(bytes.subarray(at, Math.min(at + 1024, bytes.length)));
      }
      controller.close();
    },
  });
  const headers = new Headers({ 'content-type': 'application/json' });
  if (declaredLength !== undefined) headers.set('content-length', String(declaredLength));
  return new Request('https://example.test/', {
    method: 'POST',
    headers,
    body,
    // @ts-expect-error duplex is required for a streaming body and is not in the DOM lib
    duplex: 'half',
  });
}

describe('the body is bounded by what arrives', () => {
  it('reads a body inside the limit', async () => {
    const result = await readBoundedJson(request('{"email":"a@b.test"}'));
    assert.deepEqual(result, { ok: true, body: { email: 'a@b.test' } });
  });

  it('refuses a body past the limit', async () => {
    const huge = JSON.stringify({ blob: 'x'.repeat(MAX_BODY_BYTES + 1_000) });
    const result = await readBoundedJson(request(huge));
    assert.deepEqual(result, { ok: false, reason: 'too_large' });
  });

  it('refuses a body that LIES about its length', async () => {
    // The attack a Content-Length check alone misses: declare something small,
    // send something enormous. The limit has to bind on the stream.
    const huge = JSON.stringify({ blob: 'x'.repeat(MAX_BODY_BYTES + 1_000) });
    const result = await readBoundedJson(request(huge, 12));
    assert.deepEqual(
      result,
      { ok: false, reason: 'too_large' },
      'a declared length was believed over what actually arrived',
    );
  });

  it('refuses a declared length past the limit before reading anything', async () => {
    const result = await readBoundedJson(request('{}', MAX_BODY_BYTES + 1));
    assert.deepEqual(result, { ok: false, reason: 'too_large' });
  });

  it('reports malformed JSON as malformed, not as a server fault', async () => {
    assert.deepEqual(await readBoundedJson(request('{not json')), {
      ok: false,
      reason: 'malformed',
    });
    assert.deepEqual(await readBoundedJson(request('')), { ok: false, reason: 'malformed' });
  });

  it('honours a caller-supplied smaller limit', async () => {
    const payload = JSON.stringify({ email: 'x'.repeat(5_000) });
    assert.deepEqual(await readBoundedJson(request(payload), 4096), {
      ok: false,
      reason: 'too_large',
    });
    assert.equal((await readBoundedJson(request(payload))).ok, true);
  });
});

describe('fields are bounded and typed', () => {
  it('a non-string field is refused rather than coerced', () => {
    // `12345` became `"12345"` the moment anything called String() on it, and
    // every later reader treated a number as a name.
    for (const value of [12345, true, null, undefined, {}, [], () => {}]) {
      assert.equal(boundedString(value), null, `${typeof value} was accepted as text`);
    }
  });

  it('an over-long field is refused', () => {
    assert.equal(boundedString('x'.repeat(MAX_FIELD_LENGTH)), 'x'.repeat(MAX_FIELD_LENGTH));
    assert.equal(boundedString('x'.repeat(MAX_FIELD_LENGTH + 1)), null);
  });

  it('an optional field distinguishes absent from malformed', () => {
    assert.equal(optionalBoundedString(undefined), '');
    assert.equal(optionalBoundedString(''), '');
    assert.equal(optionalBoundedString('  spaced  '), 'spaced');
    assert.equal(optionalBoundedString(12345), null, 'a number passed as an optional string');
    assert.equal(optionalBoundedString('x'.repeat(MAX_FIELD_LENGTH + 1)), null);
  });

  it('an email is shape-checked, length-capped and lowercased', () => {
    assert.equal(boundedEmail('  Client@Acme.TEST '), 'client@acme.test');
    for (const bad of [
      12345,
      'not-an-email',
      'no@tld',
      '@nolocal.test',
      'spaces in@it.test',
      'two@@at.test',
      `${'x'.repeat(250)}@acme.test`,
      '',
    ]) {
      assert.equal(boundedEmail(bad), null, `${String(bad).slice(0, 24)} was accepted`);
    }
  });
});

describe('the answers map is bounded in both directions', () => {
  it('accepts an ordinary diagnostic', () => {
    const answers: Record<string, unknown> = {};
    for (let i = 1; i <= 28; i++) answers[String(i)] = `answer ${i}`;
    const result = boundedAnswers(answers);
    assert.equal(result.ok, true);
    assert.equal(Object.keys((result as { answers: object }).answers).length, 28);
  });

  it('preserves the type an answer was given as', () => {
    const result = boundedAnswers({ a: 'text', b: 4, c: true, d: null });
    assert.deepEqual(result, { ok: true, answers: { a: 'text', b: 4, c: true, d: null } });
  });

  it('refuses too many keys', () => {
    const answers: Record<string, string> = {};
    for (let i = 0; i <= MAX_ANSWER_KEYS; i++) answers[`q${i}`] = 'x';
    assert.deepEqual(boundedAnswers(answers), { ok: false, reason: 'too_many_keys' });
  });

  it('refuses one enormous answer', () => {
    assert.deepEqual(boundedAnswers({ q1: 'x'.repeat(MAX_ANSWER_LENGTH + 1) }), {
      ok: false,
      reason: 'answer_too_long',
    });
  });

  it('refuses a nested shape', () => {
    // Scalars only. The map is stored whole and read back into responses and
    // into an AI prompt, so a nested value would let a caller choose the SHAPE
    // of what a consumer receives, not only its size.
    assert.deepEqual(boundedAnswers({ q1: { nested: true } }), {
      ok: false,
      reason: 'not_an_object',
    });
    assert.deepEqual(boundedAnswers({ q1: ['a'] }), { ok: false, reason: 'not_an_object' });
    assert.deepEqual(boundedAnswers(['a']), { ok: false, reason: 'not_an_object' });
    assert.deepEqual(boundedAnswers('answers'), { ok: false, reason: 'not_an_object' });
  });

  it('treats an absent map as empty', () => {
    assert.deepEqual(boundedAnswers(undefined), { ok: true, answers: {} });
    assert.deepEqual(boundedAnswers(null), { ok: true, answers: {} });
  });
});

describe('every unauthenticated write goes through the bound', () => {
  const PUBLIC_WRITES = [
    '/make-server-324f4fbe/submissions',
    '/make-server-324f4fbe/leads/capture',
    '/make-server-324f4fbe/leads/exit-intent',
    '/make-server-324f4fbe/bookings',
    '/make-server-324f4fbe/auth/client/verify',
    '/make-server-324f4fbe/auth/client/session',
  ];

  it('no public route reads an unbounded body', async () => {
    const source = await readFile(new URL('index.tsx', SERVER), 'utf8');
    const offenders: string[] = [];

    for (const route of PUBLIC_WRITES) {
      const start = source.indexOf(`app.post("${route}"`);
      assert.notEqual(start, -1, `${route} is gone`);
      const handler = source.slice(start, source.indexOf('\napp.', start + 1));

      if (!/readBoundedJson\(/.test(handler)) offenders.push(`${route}: no bound`);
      if (/await c\.req\.json\(\)/.test(handler)) offenders.push(`${route}: c.req.json()`);
    }

    assert.deepEqual(offenders, [], 'these accept a body of any size from anybody');
  });

  it('the diagnostic submission validates its fields rather than trusting them', async () => {
    const source = await readFile(new URL('index.tsx', SERVER), 'utf8');
    const start = source.indexOf('app.post("/make-server-324f4fbe/submissions"');
    const handler = source.slice(start, source.indexOf('\napp.', start + 1));

    assert.match(handler, /boundedEmail\(body\.email\)/, 'email is not shape-checked');
    assert.match(handler, /boundedString\(body\.industry\)/, 'industry is not bounded');
    assert.match(handler, /boundedAnswers\(body\.answers\)/, 'answers are not bounded');
  });
});
