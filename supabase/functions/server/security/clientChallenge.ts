/**
 * Client portal sign-in — S-6.
 *
 * ── WHAT WAS THERE ─────────────────────────────────────────────────────────
 *
 * `POST /auth/client/verify` took `{ email }` and answered with the matching
 * `submissionId`, the company name, and an eight-hour session token. Nothing
 * else was required. Not a password, not a code, not a link — the email address
 * alone.
 *
 * An email address is an IDENTIFIER. It says who you claim to be. It is printed
 * on business cards, it appears in the CC line of every thread the contact has
 * ever been on, and it is guessable from a name and a domain. Treating it as a
 * CREDENTIAL meant that anyone who knew a client's address could read that
 * client's diagnostic answers, their report, their proposal and their message
 * history. The route was named "verify" and verified nothing.
 *
 * The endpoint also answered `exists: true` or `exists: false`, which turned it
 * into an oracle: post a list of addresses, learn which of them are MARQ
 * clients, and collect each one's company name on the way past.
 *
 * Earlier work on this path proved that a token, ONCE ISSUED, is bound to one
 * submission and cannot reach another client's data. That was true and is still
 * true. It is a statement about what a token can do, and says nothing about who
 * is allowed to get one.
 *
 * ── WHAT REPLACES IT ───────────────────────────────────────────────────────
 *
 * A one-time code, which is the smallest mechanism that actually tests control
 * of the mailbox:
 *
 *   1. `requestChallenge(email)` — mints a six-digit code, stores its HASH, and
 *      hands the caller the code to email. Returns the SAME answer whether or
 *      not a submission exists, so the oracle closes with it.
 *   2. `redeemChallenge(email, code)` — checks the code and, only then, lets the
 *      route issue a session token.
 *
 * Four properties this module is responsible for:
 *
 *   THE CODE IS UNGUESSABLE. `crypto.getRandomValues`, rejection-sampled so the
 *   modulo does not make low codes likelier. `Math.random()` is seeded from
 *   nothing an attacker cannot also observe and is not a source of secrets.
 *
 *   THE CODE IS NOT STORED. Only its SHA-256. Whoever can read the KV table can
 *   already read the submissions, so this is not the main line of defence — but
 *   a stored code is a stored credential, and a log line or a backup that
 *   captures one hands over an account rather than a record of one.
 *
 *   GUESSES ARE COUNTED. Six digits is a million, which a script exhausts in
 *   minutes if nobody is counting. Five wrong answers destroy the challenge, so
 *   an attacker gets five out of a million and then has to make the real
 *   mailbox receive another mail.
 *
 *   CODES EXPIRE. Ten minutes. A code sitting in an inbox for a year is a
 *   password that the client did not choose and cannot change.
 *
 * ── THE DEPLOYMENT PRECONDITION ────────────────────────────────────────────
 *
 * This makes the client portal depend on outbound email. A deployment without
 * `RESEND_API_KEY` cannot deliver a code, and the route says so plainly instead
 * of failing in a way that reads like a wrong address. That is a release
 * checklist item, not something this module can paper over: a portal that lets
 * people in without the mail working is the defect it is fixing.
 */

/** How the store this module needs behaves. The real one is `kv_store.tsx`. */
export interface ChallengeStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

export const CODE_LENGTH = 6;
export const CHALLENGE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;

/** One live challenge per address: a new request replaces the previous one. */
export function challengeKey(email: string): string {
  return `client_challenge:${normalizeEmail(email)}`;
}

export function normalizeEmail(email: string): string {
  return String(email ?? '').toLowerCase().trim();
}

interface ChallengeRecord {
  readonly codeHash: string;
  readonly submissionId: string;
  readonly expiresAt: string;
  readonly attempts: number;
}

/**
 * A six-digit code with a uniform distribution.
 *
 * `value % 1_000_000` over a 32-bit draw is NOT uniform — 2^32 is not a
 * multiple of a million, so the first 967,296 codes come up slightly more often
 * than the rest. The bias is small and it is also free to remove, and a biased
 * secret is the kind of thing that is never noticed until it is quoted back.
 */
export function generateCode(
  randomValues: (buffer: Uint32Array) => Uint32Array = (buffer) =>
    crypto.getRandomValues(buffer),
): string {
  const ceiling = 1_000_000;
  const limit = Math.floor(0xffffffff / ceiling) * ceiling;
  const buffer = new Uint32Array(1);
  let draw = 0;
  do {
    draw = randomValues(buffer)[0];
  } while (draw >= limit);
  return String(draw % ceiling).padStart(CODE_LENGTH, '0');
}

/** SHA-256, hex. The code itself is never written anywhere. */
export async function hashCode(email: string, code: string): Promise<string> {
  // The address is mixed in so a hash lifted from one row cannot be replayed
  // against another: the same code for a different client is a different hash.
  const data = new TextEncoder().encode(`${normalizeEmail(email)}:${code}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Length-independent, value-independent comparison of two hex digests. */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

function parseRecord(raw: unknown): ChallengeRecord | null {
  const value = typeof raw === 'string' ? safeParse(raw) : raw;
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.codeHash !== 'string') return null;
  if (typeof record.submissionId !== 'string') return null;
  if (typeof record.expiresAt !== 'string') return null;
  return {
    codeHash: record.codeHash,
    submissionId: record.submissionId,
    expiresAt: record.expiresAt,
    attempts: typeof record.attempts === 'number' ? record.attempts : 0,
  };
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Mint a challenge for an address that HAS a submission.
 *
 * The caller decides whether a submission exists, and calls this only when one
 * does — but it answers the caller the same way either way, because the route
 * must not branch visibly on the answer. `code` is `null` when there is nothing
 * to send, and the route sends nothing and says the same thing it always says.
 */
export async function requestChallenge(
  store: ChallengeStore,
  email: string,
  submissionId: string | null,
  now: () => number = () => Date.now(),
  makeCode: () => string = generateCode,
): Promise<{ code: string | null }> {
  if (submissionId === null) return { code: null };

  const code = makeCode();
  const record: ChallengeRecord = {
    codeHash: await hashCode(email, code),
    submissionId,
    expiresAt: new Date(now() + CHALLENGE_TTL_MS).toISOString(),
    attempts: 0,
  };
  await store.set(challengeKey(email), JSON.stringify(record));
  return { code };
}

export type RedeemResult =
  | { ok: true; submissionId: string }
  | { ok: false; reason: 'no_challenge' | 'expired' | 'exhausted' | 'wrong_code' };

/**
 * Check a code.
 *
 * Every refusal is reported to the CALLER as the same message; the reasons here
 * are for the log. A response that distinguishes "no challenge" from "wrong
 * code" tells an attacker whether the address is a client, which is the oracle
 * this whole change exists to close.
 */
export async function redeemChallenge(
  store: ChallengeStore,
  email: string,
  code: string,
  now: () => number = () => Date.now(),
): Promise<RedeemResult> {
  const key = challengeKey(email);
  const record = parseRecord(await store.get(key));
  if (!record) return { ok: false, reason: 'no_challenge' };

  if (Date.parse(record.expiresAt) <= now()) {
    await store.del(key);
    return { ok: false, reason: 'expired' };
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    await store.del(key);
    return { ok: false, reason: 'exhausted' };
  }

  const candidate = await hashCode(email, String(code ?? '').trim());
  if (!constantTimeEquals(candidate, record.codeHash)) {
    const attempts = record.attempts + 1;
    // The count is written BEFORE the refusal is returned. A counter that is
    // only incremented on the way out of a successful path is not a counter.
    if (attempts >= MAX_ATTEMPTS) await store.del(key);
    else await store.set(key, JSON.stringify({ ...record, attempts }));
    return { ok: false, reason: 'wrong_code' };
  }

  // Single use. A code that still works after it has been used is a password.
  await store.del(key);
  return { ok: true, submissionId: record.submissionId };
}
