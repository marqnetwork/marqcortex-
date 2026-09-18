/**
 * Runtime validation for the authority boundary (BP-001 hardening).
 *
 * TYPES ARE NOT SECURITY. Every value the evaluator weighs is typed, and not
 * one of those types exists at runtime. An envelope arrives from a port a
 * subsystem implements, a consequence level arrives from a classifier that
 * subsystem wrote, and a policy constraint arrives from whatever the policy
 * source decided to return. `ConsequenceLevel` does not stop any of them from
 * being the string `"catastrophic"`, the number `7`, or `null`.
 *
 * WHAT WENT WRONG WITHOUT THESE GUARDS. Probed against the unhardened
 * evaluator, malformed values did not fail closed — they failed OPEN, because
 * the comparisons that enforce the ceilings are lookups into rank tables:
 *
 *   CONSEQUENCE_RANK["catastrophic"]  is  undefined
 *   undefined > 0                     is  false        -> "does not exceed"
 *   undefined >= 0                    is  false        -> maxConsequence LOWERS
 *
 * So a classifier returning an unrecognised string did not raise the level, it
 * quietly reduced it to whatever it was compared against, and the action was
 * ALLOWED. The same shape allowed an unreadable envelope ceiling, an unreadable
 * data ceiling and an unreadable approval threshold. An `undefined` on either
 * side of `>` is the most dangerous value in an authorization system precisely
 * because it makes every comparison answer "no".
 *
 * TWO OTHER FAMILIES, BOTH REAL:
 *
 *   A SCOPE THAT IS NOT AN ARRAY. `allowedTools` as the string
 *   `"crm.lookup,payments.charge"` passed the tool check, because
 *   `String.prototype.includes` does SUBSTRING matching. A malformed envelope
 *   became a wildcard.
 *
 *   A CONSTRAINT THAT IS NOT THE SHAPE IT CLAIMS. `effect: "DENY"` — the right
 *   word in the wrong case — matched neither `'deny'` nor `'require_approval'`,
 *   so a policy that meant to refuse was silently ignored and the action was
 *   allowed. A deny that can be misspelled into an allow is not a deny.
 *
 * THE RULE THESE GUARDS ENFORCE: an authorization fact that cannot be READ is
 * an authorization fact that cannot be HONOURED, and the only safe reading of
 * one is refusal. Malformed never means "skip this check".
 *
 * They are plain predicates on purpose. A schema library would be a dependency
 * the evaluator does not have and does not want — this module must keep
 * importing nothing but its own contracts, which is what
 * `tests/system/ai_boundary.test.ts` asserts.
 */

import {
  ACTOR_TYPES,
  type ActorType,
  type ConsequenceLevel,
  type DataClassification,
  type EnvelopeStatus,
  type PolicyConstraint,
  type RequestedEffect,
} from './contracts.ts';

const CONSEQUENCE_LEVEL_VALUES: readonly string[] = ['low', 'medium', 'high', 'critical'];
const DATA_CLASSIFICATION_VALUES: readonly string[] = [
  'public',
  'internal',
  'confidential',
  'restricted',
];
const REQUESTED_EFFECT_VALUES: readonly string[] = [
  'read',
  'write',
  'delete',
  'external_effect',
  'authority_change',
];
const ENVELOPE_STATUS_VALUES: readonly string[] = ['active', 'suspended', 'expired'];
const POLICY_EFFECT_VALUES: readonly string[] = ['allow', 'deny', 'require_approval'];

export function isConsequenceLevel(value: unknown): value is ConsequenceLevel {
  return typeof value === 'string' && CONSEQUENCE_LEVEL_VALUES.includes(value);
}

export function isDataClassification(value: unknown): value is DataClassification {
  return typeof value === 'string' && DATA_CLASSIFICATION_VALUES.includes(value);
}

export function isRequestedEffect(value: unknown): value is RequestedEffect {
  return typeof value === 'string' && REQUESTED_EFFECT_VALUES.includes(value);
}

export function isEnvelopeStatus(value: unknown): value is EnvelopeStatus {
  return typeof value === 'string' && ENVELOPE_STATUS_VALUES.includes(value);
}

export function isActorType(value: unknown): value is ActorType {
  return typeof value === 'string' && (ACTOR_TYPES as readonly string[]).includes(value);
}

export function isPolicyEffect(value: unknown): value is PolicyConstraint['effect'] {
  return typeof value === 'string' && POLICY_EFFECT_VALUES.includes(value);
}

/**
 * A REAL array of strings.
 *
 * `Array.isArray` first, and that is the load-bearing half: a string also has
 * `.includes`, `.length` and `.find`, so a scope that arrived as a string would
 * satisfy every duck-typed check the evaluator makes while matching substrings
 * instead of entries. An empty array is valid and means "admits nothing" — the
 * evaluator's own reading, and not this function's business.
 */
export function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/**
 * A usable spend ceiling: a real, finite, non-negative number.
 *
 * NaN is the case worth naming. Every comparison against it is false, including
 * `cost > NaN`, so a ceiling of NaN is not a high ceiling — it is NO ceiling,
 * silently, while still appearing in the record as a configured limit.
 */
export function isSpendLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** A non-empty string after trimming. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** A plain object — not null, not an array, not a primitive. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A REAL boolean.
 *
 * `reversible` feeds the irreversibility floor, and that floor is applied with
 * `if (!request.reversible)`. Truthiness is the wrong test for it: the STRING
 * `"false"` is truthy, so a caller that serialised the flag through a form, a
 * query string or a JSON round-trip that stringified it would suppress the
 * floor entirely — an irreversible action classified as though it could be
 * undone. `1` did the same. Only `true` and `false` are answers.
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/**
 * An ISO-8601 instant, strictly.
 *
 * `Date.parse` IS NOT A VALIDATOR, and treating "it returned a finite number"
 * as proof of a timestamp is how the worst bug in this file's history got in:
 *
 *   Date.parse("99")          ->  year 99, a finite, entirely plausible instant
 *   Date.parse("01/02/2030")  ->  a US-format date, finite, locale-dependent
 *
 * An envelope that EXPIRED in 2020, evaluated with `nowIso: "99"`, therefore
 * looked live — "now" resolved to the year 99, which is before the expiry, so
 * the validity window passed and the action was ALLOWED. A timestamp nobody
 * meant reopened authority that had been deliberately closed.
 *
 * So the shape is checked before the value: `YYYY-MM-DDTHH:MM:SS`, optional
 * fractional seconds, and a MANDATORY zone — `Z` or `±HH:MM`.
 *
 * THE ZONE IS NOT OPTIONAL, and that is a deliberate narrowing of what
 * JavaScript would accept. A date-only or zone-less string is ambiguous by
 * construction, and an ambiguous instant in a validity window is an envelope
 * whose expiry moves with whoever is reading it. BP-001 says ISO-8601
 * timestamps; this requires an unambiguous one.
 *
 * The regex bounds the FORM; `Date.parse` still bounds the VALUE, so an
 * impossible date that matches the shape — month 13, the 32nd — is rejected by
 * the parse rather than needing calendar arithmetic here.
 */
const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

/** Days in a month, with the Gregorian leap rule. */
function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isIsoInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_INSTANT.exec(value);
  if (!match) return false;

  // THE CALENDAR IS CHECKED HERE, NOT LEFT TO `Date.parse`, because
  // `Date.parse` SILENTLY ROLLS OVER an impossible day:
  //
  //   Date.parse("2026-02-30T00:00:00Z")  ->  2026-03-02
  //   Date.parse("2026-04-31T00:00:00Z")  ->  2026-05-01
  //
  // It returns a finite number and the shape matches, so both would otherwise
  // pass — as an instant two days away from the one written down. In a validity
  // window that is an expiry silently moved, which is precisely the class of
  // "malformed but parseable" this guard exists to refuse. Month 13 and day 32
  // do yield NaN, so only the in-range-but-impossible days need this.
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;

  // The value still has to parse: this bounds the DATE, and `Date.parse` bounds
  // the time-of-day and the offset.
  return Number.isFinite(Date.parse(value));
}

/**
 * The epoch milliseconds of a strict ISO instant, or `undefined`.
 *
 * One function so that "is it valid?" and "what is it?" can never disagree —
 * two call sites doing their own `Date.parse` is how a value gets validated in
 * one place and re-read differently in another.
 */
export function isoInstantMs(value: unknown): number | undefined {
  if (!isIsoInstant(value)) return undefined;
  return Date.parse(value);
}
