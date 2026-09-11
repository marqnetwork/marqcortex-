/**
 * Bounds on what an unauthenticated caller can send — S-9.
 *
 * Four routes accept a body from anybody: the diagnostic submission, two lead
 * captures, and the booking. Three of them did `await c.req.json()` and used
 * whatever came back. No size limit, no type check beyond truthiness, and the
 * whole of `answers` stored into KV exactly as received.
 *
 * That is a write amplifier. The edge limiter allows 120 requests a minute per
 * caller, so the cost of a request is whatever the body weighs — and the body
 * weighed whatever the sender chose. A megabyte apiece is 120 MB a minute of
 * database growth from one address, against a table nobody is watching.
 *
 * It also made the routes fragile in a way that reads as a server fault. `email`
 * was checked for truthiness and then `.split('@')` was called on it, so
 * `{"email": 12345}` is a 500 rather than a 400 — the caller's malformed input
 * reported as the server's problem.
 *
 * ── THE BODY IS BOUNDED BEFORE IT IS READ, NOT AFTER ───────────────────────
 *
 * `readBoundedJson` reads the request STREAM and stops at the limit. Checking
 * `Content-Length` and then calling `.json()` would not do: a chunked request
 * declares no length, and by the time a parsed body can be measured it is
 * already in memory, which is the thing being defended. The declared length is
 * still checked first, because rejecting before reading anything is cheaper.
 *
 * ── THE NUMBERS ────────────────────────────────────────────────────────────
 *
 * The diagnostic asks 28 questions. The caps below are roughly ten times any
 * legitimate submission, so they bound abuse without ever being reached by a
 * real one — a limit that real traffic trips is a limit that gets raised until
 * it means nothing.
 */

/** 256 KiB. Ten times the largest plausible 28-answer diagnostic. */
export const MAX_BODY_BYTES = 256 * 1024;

/** Names, emails, URLs, industry labels. */
export const MAX_FIELD_LENGTH = 512;

/** One answer. Long-form prose is expected; a novel is not. */
export const MAX_ANSWER_LENGTH = 10_000;

/** The bank has 28 questions. */
export const MAX_ANSWER_KEYS = 128;

export type BodyFailure = 'too_large' | 'malformed';

export type BoundedBody =
  | { ok: true; body: unknown }
  | { ok: false; reason: BodyFailure };

/**
 * Read and parse a JSON body, refusing anything past `maxBytes`.
 *
 * The stream is cancelled at the limit rather than drained, so an oversized
 * request costs the limit and not its own size.
 */
export async function readBoundedJson(
  request: Request,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<BoundedBody> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, reason: 'too_large' };
  }

  const stream = request.body;
  if (stream === null) return { ok: false, reason: 'malformed' };

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: 'too_large' };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }

  try {
    return { ok: true, body: JSON.parse(new TextDecoder().decode(joined)) };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

/**
 * A string of at most `max` characters, or `null`.
 *
 * `null` for a non-string on purpose. Coercing `12345` to `"12345"` would let a
 * caller store a number where a name belongs and have every later reader treat
 * it as text — the route should say the field is wrong, not quietly fix it.
 */
export function boundedString(value: unknown, max: number = MAX_FIELD_LENGTH): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}

/** Like `boundedString`, but an absent or empty field is `''` rather than a refusal. */
export function optionalBoundedString(
  value: unknown,
  max: number = MAX_FIELD_LENGTH,
): string | null {
  if (value === undefined || value === null || value === '') return '';
  return boundedString(value, max);
}

/**
 * A syntactically plausible email address, lowercased, or `null`.
 *
 * Deliberately not a full RFC 5322 grammar. This is a length and shape bound on
 * something that becomes a KV key and a log line; whether the mailbox exists is
 * settled by sending to it, which is what the portal's sign-in code does.
 */
export function boundedEmail(value: unknown): string | null {
  const text = boundedString(value, 254);
  if (text === null) return null;
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(text)) return null;
  return text.toLowerCase();
}

export type AnswersFailure = 'not_an_object' | 'too_many_keys' | 'answer_too_long';

export type BoundedAnswers =
  | { ok: true; answers: Record<string, string | number | boolean | null> }
  | { ok: false; reason: AnswersFailure };

/**
 * The answers map, bounded in both directions.
 *
 * Scalars only. The map is stored whole and later read back into a response, so
 * accepting a nested object would let a caller choose the SHAPE of what a
 * consumer receives, not just its size — and one of those consumers is an AI
 * prompt.
 */
export function boundedAnswers(value: unknown): BoundedAnswers {
  if (value === undefined || value === null) return { ok: true, answers: {} };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'not_an_object' };
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_ANSWER_KEYS) return { ok: false, reason: 'too_many_keys' };

  const answers: Record<string, string | number | boolean | null> = {};
  for (const [key, raw] of entries) {
    if (key.length > MAX_FIELD_LENGTH) return { ok: false, reason: 'too_many_keys' };
    if (raw === null || raw === undefined) {
      answers[key] = null;
    } else if (typeof raw === 'number' || typeof raw === 'boolean') {
      answers[key] = raw;
    } else if (typeof raw === 'string') {
      if (raw.length > MAX_ANSWER_LENGTH) return { ok: false, reason: 'answer_too_long' };
      answers[key] = raw;
    } else {
      return { ok: false, reason: 'not_an_object' };
    }
  }
  return { ok: true, answers };
}

/** The message and status a body failure becomes. Never echoes the body. */
export function bodyFailureResponse(reason: BodyFailure): {
  message: string;
  status: 400 | 413;
} {
  return reason === 'too_large'
    ? { message: 'Request body is too large.', status: 413 }
    : { message: 'Request body is not valid JSON.', status: 400 };
}
