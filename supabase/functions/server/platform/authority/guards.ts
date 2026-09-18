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
