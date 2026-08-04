/**
 * Canonical serialization and digests for the agent runtime.
 *
 * Two jobs, and the first one is what makes the second one mean anything:
 *
 *   CANONICAL FORM. `{a:1,b:2}` and `{b:2,a:1}` are the same intention and must
 *   produce the same fingerprint, or loop detection can be defeated by key
 *   order — which is not a hypothetical, since a model that emits JSON emits it
 *   in whatever order it likes. `canonicalJson` sorts object keys at every
 *   depth, so equality of digest means equality of value.
 *
 *   BOUNDED. Serialization refuses to walk deeper or wider than the declared
 *   bounds and never throws on a cyclic or exotic value: an agent that returns
 *   something unserializable gets a typed `invalid_action`, not a crash inside
 *   the orchestrator's persistence step.
 *
 * The digest is SHA-256 truncated to 32 hex characters (128 bits). Full-length
 * digests are used where a value is proved (checkpoint chaining); truncated
 * digests are used where a value is compared (fingerprints, no-progress), and
 * 128 bits is far beyond what an accidental collision inside one bounded run
 * could reach.
 */

import { sha256Hex } from '../../prompts/hash.ts';

const MAX_DEPTH = 16;
const MAX_NODES = 20_000;

/**
 * Deterministic JSON with sorted keys.
 *
 * Returns `undefined` when the value cannot be serialized within bounds, so the
 * caller decides what an unserializable payload means. Every caller in this
 * runtime treats it as `invalid_action`.
 */
export function canonicalJson(value: unknown): string | undefined {
  let nodes = 0;
  const seen = new Set<object>();

  const walk = (node: unknown, depth: number): string | undefined => {
    nodes += 1;
    if (nodes > MAX_NODES || depth > MAX_DEPTH) return undefined;

    if (node === null) return 'null';
    const type = typeof node;
    if (type === 'string') return JSON.stringify(node);
    if (type === 'number') return Number.isFinite(node) ? JSON.stringify(node) : undefined;
    if (type === 'boolean') return node ? 'true' : 'false';
    if (type === 'undefined') return undefined;
    if (type === 'function' || type === 'symbol' || type === 'bigint') return undefined;

    const object = node as object;
    // A cycle is not an error the runtime should throw on — it is a payload it
    // declines. Tracking the ancestry rather than every visited node keeps a
    // legitimately repeated sub-object (the same value in two fields) valid.
    if (seen.has(object)) return undefined;
    seen.add(object);
    try {
      if (Array.isArray(node)) {
        const parts: string[] = [];
        for (const entry of node) {
          const rendered = walk(entry, depth + 1);
          // An array hole or an undefined member serializes as null, matching
          // JSON.stringify, rather than dropping and shifting the indices.
          parts.push(rendered ?? 'null');
        }
        return `[${parts.join(',')}]`;
      }

      const entries = Object.entries(node as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const parts: string[] = [];
      for (const [key, entryValue] of entries) {
        const rendered = walk(entryValue, depth + 1);
        if (rendered === undefined) continue;
        parts.push(`${JSON.stringify(key)}:${rendered}`);
      }
      return `{${parts.join(',')}}`;
    } finally {
      seen.delete(object);
    }
  };

  return walk(value, 0);
}

/** UTF-8 byte length of a value's canonical form, or `undefined`. */
export function canonicalBytes(value: unknown): number | undefined {
  const json = canonicalJson(value);
  if (json === undefined) return undefined;
  return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json).length : json.length;
}

/** Full-length digest of text. Used where a value is proved. */
export function digestText(text: string): string {
  return sha256Hex(text);
}

/** 128-bit digest of a value's canonical form. Used where values are compared. */
export function digestValue(value: unknown): string {
  const json = canonicalJson(value);
  // A value that cannot be serialized still needs a stable digest for the audit
  // record. `null` is the canonical form of "nothing serializable", and the
  // caller has already rejected the action by the time this is reached.
  return sha256Hex(json ?? 'null').slice(0, 32);
}
