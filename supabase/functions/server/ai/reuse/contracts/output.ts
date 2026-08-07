/**
 * The bounded trusted output contract (AI-01 Batch 3B, Part 6B).
 *
 * ── REPLAYING A PROVIDER RESPONSE IS NOT REUSE, IT IS A REPLAY ATTACK ON
 *    YOUR OWN PLATFORM ─────────────────────────────────────────────────────
 *
 * The obvious implementation of a response cache stores whatever the provider
 * returned and hands it back later. Everything wrong with that is invisible on
 * the happy path: the stored blob may contain hidden reasoning the tenant is not
 * licensed to see, tool arguments carrying a credential the gateway injected,
 * the internal prompt that produced it, provider-specific execution metadata, or
 * fields a later output guard would have blocked. None of those are checked on
 * the way OUT of a cache, because a cache read looks nothing like an inference.
 *
 * So a reusable result never carries a provider response. It carries an
 * ENVELOPE the producer sealed: a declared schema, a flat map of scalar fields,
 * and nothing else. What the consuming workflow or agent is allowed to receive
 * is decided once, by the producer, under the guards that were running at the
 * time — and the cache can only ever hand back that.
 *
 * ── REFUSE, DO NOT STRIP ───────────────────────────────────────────────────
 *
 * `sealReusableOutput` REFUSES an envelope containing a forbidden field name
 * rather than removing it. Stripping would mean the producer believes it stored
 * something it did not, and the difference surfaces later as an empty field in a
 * downstream node rather than as an error at the point of the mistake.
 *
 * ── FLAT AND BOUNDED, WHICH IS ALSO WHY THE DIGEST MEANS SOMETHING ────────
 *
 * Values are scalars or arrays of scalars. No nested objects, no unbounded
 * strings, no unbounded field counts. That keeps the envelope cheap to
 * canonicalise, cheap to digest and impossible to use as a smuggling channel for
 * a structure nobody reviewed — and it makes the integrity check a comparison of
 * two digests over a form that cannot vary by key order.
 */

import { canonicalJson, digestText } from '../../agents/runtime/digest.ts';
import { reuseFailure } from './failures.ts';

export type ReusableOutputScalar = string | number | boolean | null;

export type ReusableOutputValue = ReusableOutputScalar | readonly ReusableOutputScalar[];

export interface ReusableOutputEnvelope {
  /** The output contract the consuming node validates against. */
  readonly schema: string;
  readonly schemaVersion: string;
  /** Flat, scalar-valued, bounded. The whole of what a consumer receives. */
  readonly fields: Readonly<Record<string, ReusableOutputValue>>;
  /**
   * Field names the producer deliberately withheld.
   *
   * Recorded so a consumer can tell "this envelope has no `rationale` because
   * the model produced none" from "this envelope has no `rationale` because the
   * producer was not permitted to store one". Those are different facts and only
   * one of them is a reason to re-run the inference.
   */
  readonly redactions: readonly string[];
}

export const MAX_OUTPUT_FIELDS = 64;
export const MAX_OUTPUT_STRING_LENGTH = 16_384;
export const MAX_OUTPUT_ARRAY_LENGTH = 256;
const FIELD_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/**
 * Field names that must never appear in a reusable envelope.
 *
 * Matched case-insensitively against the whole name and against its parts, so
 * `apiKey`, `api_key` and `providerApiKey` are all refused. This is a
 * belt-and-braces control rather than the primary one — the primary one is that
 * the producer builds the envelope explicitly from values it chose — but a
 * deny list at the seal is what turns "we would never store a credential" into
 * something a test can assert.
 */
const FORBIDDEN_FIELD_TOKENS: readonly string[] = [
  'apikey',
  'api_key',
  'secret',
  'password',
  'credential',
  'authorization',
  'bearer',
  'accesstoken',
  'refreshtoken',
  'privatekey',
  'sessiontoken',
  'prompt',
  'systemprompt',
  'messages',
  'rawresponse',
  'providerresponse',
  'reasoning',
  'thinking',
  'chainofthought',
  'scratchpad',
  'toolcredential',
];

function normalizeFieldName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isForbiddenFieldName(name: string): boolean {
  const normalized = normalizeFieldName(name);
  return FORBIDDEN_FIELD_TOKENS.some((token) => normalized.includes(normalizeFieldName(token)));
}

function assertScalar(field: string, value: ReusableOutputScalar): void {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw reuseFailure('reusable_output_rejected', 'A reusable output field is not finite.', {
        diagnostics: `field=${field}`,
      });
    }
    return;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_OUTPUT_STRING_LENGTH) {
      throw reuseFailure('reusable_output_rejected', 'A reusable output field is too large.', {
        diagnostics: `field=${field} length=${value.length} max=${MAX_OUTPUT_STRING_LENGTH}`,
      });
    }
    return;
  }
  throw reuseFailure('reusable_output_rejected', 'A reusable output field is not a scalar.', {
    diagnostics: `field=${field} type=${typeof value}`,
  });
}

/**
 * Validate an envelope and return it frozen, or refuse it.
 *
 * The returned value is the ONLY thing the cache ever stores as output, and the
 * only thing a consumer ever receives from a hit.
 */
export function sealReusableOutput(envelope: ReusableOutputEnvelope): ReusableOutputEnvelope {
  if (typeof envelope.schema !== 'string' || envelope.schema.trim() === '') {
    throw reuseFailure('reusable_output_rejected', 'A reusable output must declare its schema.');
  }
  if (typeof envelope.schemaVersion !== 'string' || envelope.schemaVersion.trim() === '') {
    throw reuseFailure(
      'reusable_output_rejected',
      'A reusable output must declare its schema version.',
    );
  }

  const names = Object.keys(envelope.fields);
  if (names.length > MAX_OUTPUT_FIELDS) {
    throw reuseFailure('reusable_output_rejected', 'A reusable output declares too many fields.', {
      diagnostics: `${names.length} fields exceeds ${MAX_OUTPUT_FIELDS}`,
    });
  }

  const fields: Record<string, ReusableOutputValue> = {};
  for (const name of names.sort()) {
    if (!FIELD_NAME_PATTERN.test(name)) {
      throw reuseFailure('reusable_output_rejected', 'A reusable output field name is invalid.', {
        diagnostics: `field=${name}`,
      });
    }
    if (isForbiddenFieldName(name)) {
      throw reuseFailure(
        'reusable_output_rejected',
        'A reusable output may not carry that kind of field.',
        { diagnostics: `field=${name} matches a forbidden field token` },
      );
    }
    const value = envelope.fields[name];
    if (Array.isArray(value)) {
      if (value.length > MAX_OUTPUT_ARRAY_LENGTH) {
        throw reuseFailure('reusable_output_rejected', 'A reusable output array is too long.', {
          diagnostics: `field=${name} length=${value.length} max=${MAX_OUTPUT_ARRAY_LENGTH}`,
        });
      }
      for (const entry of value) assertScalar(name, entry);
      fields[name] = [...value];
      continue;
    }
    assertScalar(name, value as ReusableOutputScalar);
    fields[name] = value;
  }

  const redactions = [...new Set(envelope.redactions)].sort();
  for (const redaction of redactions) {
    if (!FIELD_NAME_PATTERN.test(redaction)) {
      throw reuseFailure('reusable_output_rejected', 'A redaction name is invalid.', {
        diagnostics: `redaction=${redaction}`,
      });
    }
  }

  return Object.freeze({
    schema: envelope.schema,
    schemaVersion: envelope.schemaVersion,
    fields: Object.freeze(fields),
    redactions: Object.freeze(redactions),
  });
}

/**
 * The digest an integrity check compares against.
 *
 * Over the CANONICAL form, so a record that came back from storage with its keys
 * in a different order still verifies — and a record whose fields were edited in
 * storage does not.
 */
export function digestReusableOutput(envelope: ReusableOutputEnvelope): string {
  const canonical = canonicalJson({
    schema: envelope.schema,
    schemaVersion: envelope.schemaVersion,
    fields: envelope.fields,
    redactions: envelope.redactions,
  });
  if (canonical === undefined) {
    throw reuseFailure(
      'reusable_output_rejected',
      'A reusable output could not be canonicalised.',
      { diagnostics: `schema=${envelope.schema}` },
    );
  }
  return digestText(canonical);
}

/**
 * Structural check for a value that came back FROM storage.
 *
 * Separate from `sealReusableOutput` because the two answer different questions:
 * sealing asks "may this be stored", reading asks "is this a whole envelope".
 * A read that ran the seal's deny list would refuse a record that was legitimate
 * when written and whose field names the deny list later grew to cover, which is
 * a different decision from refusing to write one.
 */
export function isWellFormedOutput(value: unknown): value is ReusableOutputEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.schema !== 'string' || candidate.schema === '') return false;
  if (typeof candidate.schemaVersion !== 'string' || candidate.schemaVersion === '') return false;
  if (!Array.isArray(candidate.redactions)) return false;
  const fields = candidate.fields;
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) return false;
  for (const entry of Object.values(fields as Record<string, unknown>)) {
    if (Array.isArray(entry)) {
      if (entry.some((item) => item !== null && !['string', 'number', 'boolean'].includes(typeof item))) {
        return false;
      }
      continue;
    }
    if (entry !== null && !['string', 'number', 'boolean'].includes(typeof entry)) return false;
  }
  return true;
}
