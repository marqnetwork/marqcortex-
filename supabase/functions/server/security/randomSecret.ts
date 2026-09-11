/**
 * Secrets come from the CSPRNG — S-8.
 *
 * The team invite route minted its temporary password as
 * `Cortex${Math.random().toString(36).slice(2, 8).toUpperCase()}!`, and that
 * password is returned to the inviting admin to hand over.
 *
 * `Math.random()` is not a source of secrets. V8 implements it as xorshift128+
 * with a per-isolate seed, and the generator's internal state is recoverable
 * from a handful of its outputs — which is what makes this more than a
 * theoretical objection here. The same isolate hands `Math.random()` results to
 * callers constantly: notification ids, message ids, lead ids, note ids, all
 * returned in ordinary API responses. A team member with the lowest role could
 * collect those, recover the state, predict the NEXT invite's password, and
 * sign in as the new account before the admin had finished passing it along.
 *
 * `crypto.getRandomValues` has none of that structure, costs nothing here, and
 * is already what the client portal's sign-in code uses.
 *
 * ── WHY THE ALPHABET LOOKS LIKE THIS ───────────────────────────────────────
 *
 * A caller reads this out loud or types it from a chat message, so `0`/`O` and
 * `1`/`l`/`I` are gone. That costs about four bits against a 24-character
 * secret and buys back the retry a misread character would have caused. The
 * remaining alphabet is 56 symbols, so 24 characters is roughly 139 bits —
 * enough that the reduction does not matter.
 */

/**
 * Unambiguous when read aloud or transcribed. Excludes 0 O o 1 l I.
 * 24 uppercase + 24 lowercase + 8 digits = 56 symbols.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** Long enough that the alphabet's readability concessions are free. */
export const DEFAULT_SECRET_LENGTH = 24;

/**
 * A secret drawn uniformly from `ALPHABET`.
 *
 * Rejection-sampled, like the portal's sign-in code and for the same reason:
 * 256 is not a multiple of 56, so taking a byte modulo the alphabet would make
 * the first `256 % 56` symbols likelier than the rest. The bias is small and it
 * is also free to remove.
 */
export function randomSecret(
  length: number = DEFAULT_SECRET_LENGTH,
  randomValues: (buffer: Uint8Array) => Uint8Array = (buffer) =>
    crypto.getRandomValues(buffer),
): string {
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  const out: string[] = [];
  // A FIXED buffer, refilled. `crypto.getRandomValues` refuses anything over
  // 65536 bytes, so sizing the buffer from `length` made a long secret throw
  // rather than return a long secret — which the distribution test found by
  // asking for 60,000 characters. Refilling costs one extra call per 256
  // characters and has no such ceiling.
  const buffer = new Uint8Array(256);

  while (out.length < length) {
    randomValues(buffer);
    for (const byte of buffer) {
      if (out.length >= length) break;
      if (byte >= limit) continue;
      out.push(ALPHABET[byte % ALPHABET.length]);
    }
  }
  return out.join('');
}

/**
 * A temporary password for an invited team member.
 *
 * Kept distinct from `randomSecret` by name so that a future caller reaching for
 * "a password" lands here rather than inventing another one, which is how the
 * `Math.random()` version came to exist in the first place.
 */
export function temporaryPassword(): string {
  // A trailing symbol and digit so the value satisfies a complexity policy
  // wherever one is configured, without the alphabet having to carry symbols
  // that are awkward to transcribe.
  return `${randomSecret(DEFAULT_SECRET_LENGTH)}7!`;
}
