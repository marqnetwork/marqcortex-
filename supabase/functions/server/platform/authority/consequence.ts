/**
 * Deterministic consequence classification (BP-001 §4.4).
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE: no model decides this.
 *
 * BP-001 permits an LLM to RECOMMEND a classification in a later packet and
 * forbids one from producing the enforced result. The distinction survives only
 * if the enforced result is computed somewhere a model cannot reach, from
 * inputs a model did not choose. That is this function: a pure fold over the
 * request's own declared facts, with no I/O, no randomness, no clock and no
 * configuration. The same request classifies the same way on every isolate, in
 * every deployment, forever — which is what makes a consequence ceiling an
 * authorization boundary rather than a suggestion.
 *
 * IT ONLY EVER RAISES. Every rule below can push a classification up and none
 * can pull one down, including the subsystem port. A caller that knows more
 * than the platform does — a tool registry that has declared a call `high` risk,
 * a payment processor that knows the amount — can sharpen the answer upward;
 * nothing can argue a dangerous action down to `low`. A classifier where the
 * most specific knowledge could lower the result would be one where the way to
 * get a free hand is to describe your action in more detail.
 */

import {
  type ActionRequest,
  type ConsequenceLevel,
  type ConsequenceSource,
  maxConsequence,
} from './contracts.ts';
import { isConsequenceLevel, isDataClassification, isRequestedEffect } from './guards.ts';

/**
 * The floor implied by what the action DOES to the world.
 *
 * `authority_change` is `critical` without qualification, and it is the one
 * entry worth defending explicitly: an action that changes who may do what is
 * the authority system operating on itself, and getting it wrong does not
 * damage one record — it changes the set of people who can damage every record.
 * There is no version of that which is routine.
 *
 * `external_effect` is `high` because it leaves. A wrong write inside the
 * tenant is a wrong row that can be corrected; a wrong email has been read, a
 * wrong payment has been received, and the platform's ability to undo it ended
 * the moment it left.
 */
const EFFECT_FLOOR: Readonly<Record<ActionRequest['requestedEffect'], ConsequenceLevel>> = {
  read: 'low',
  write: 'medium',
  delete: 'high',
  external_effect: 'high',
  authority_change: 'critical',
};

/**
 * The floor implied by the sensitivity of the data touched.
 *
 * `restricted` reaches `high` rather than `critical` on its own: touching the
 * most sensitive data the platform holds is serious, and it is not automatically
 * as serious as changing who may touch it. Where both apply, the fold takes the
 * higher, which is `critical` — so the combination is not lost, it is simply not
 * asserted by this axis alone.
 */
const DATA_FLOOR: Readonly<Record<ActionRequest['dataClassification'], ConsequenceLevel>> = {
  public: 'low',
  internal: 'low',
  confidential: 'medium',
  restricted: 'high',
};

/**
 * Spend thresholds, in micro-USD.
 *
 * Fixed rather than configurable, deliberately. A per-tenant threshold would
 * make the same action classify differently in two organizations, and a
 * classification that moves with configuration cannot be reasoned about from a
 * record — the reader would need the configuration as it stood at the time,
 * which nothing keeps. A TENANT'S OWN spend limit is expressed where it belongs:
 * `AuthorityEnvelope.maxCostMicroUsd`, which the evaluator checks separately
 * and which an audit record does name.
 *
 * 1_000_000 micro-USD is one dollar.
 */
const COST_MEDIUM_MICRO_USD = 1_000_000;
const COST_HIGH_MICRO_USD = 25_000_000;
const COST_CRITICAL_MICRO_USD = 250_000_000;

function costFloor(estimatedCostMicroUsd: number | undefined): ConsequenceLevel {
  // An UNSTATED cost is `low`, and an UNUSABLE one is `critical`.
  //
  // The asymmetry is the point. Most actions genuinely cost nothing and should
  // not be dragged upward for staying silent. But a caller that supplied a
  // cost field holding NaN, Infinity or a negative number has a defect, and a
  // defect in the number that decides how much money an agent may spend
  // unattended is exactly the case that must not degrade to "probably fine".
  if (estimatedCostMicroUsd === undefined) return 'low';
  if (!Number.isFinite(estimatedCostMicroUsd) || estimatedCostMicroUsd < 0) return 'critical';
  if (estimatedCostMicroUsd >= COST_CRITICAL_MICRO_USD) return 'critical';
  if (estimatedCostMicroUsd >= COST_HIGH_MICRO_USD) return 'high';
  if (estimatedCostMicroUsd >= COST_MEDIUM_MICRO_USD) return 'medium';
  return 'low';
}

/**
 * The platform floor: what this action is worth regardless of who asked.
 *
 * Exported so tests and callers can assert the floor independently of whatever
 * a subsystem port adds on top.
 */
export function platformConsequenceFloor(request: ActionRequest): ConsequenceLevel {
  // AN UNRECOGNISED AXIS VALUE IS `critical`, NOT A MISSING FLOOR. The evaluator
  // refuses a malformed request before it gets here, so this is the second lock
  // — and it matters because this function is also exported and called directly
  // by the agent adapter's ceiling probe, which is not behind that gate.
  let level: ConsequenceLevel = isRequestedEffect(request.requestedEffect)
    ? EFFECT_FLOOR[request.requestedEffect]
    : 'critical';
  level = maxConsequence(
    level,
    isDataClassification(request.dataClassification)
      ? DATA_FLOOR[request.dataClassification]
      : 'critical',
  );
  level = maxConsequence(level, costFloor(request.estimatedCostMicroUsd));

  // IRREVERSIBILITY IS AT LEAST `high`.
  //
  // Not because an irreversible action is always grave, but because the cost of
  // misjudging one has no recovery path. A reversible mistake costs the time to
  // reverse it; an irreversible one costs whatever it cost. A `read` is exempt:
  // it changes nothing, so "reversible" does not describe it, and marking every
  // read `high` would drain the word of meaning everywhere else.
  if (!request.reversible && request.requestedEffect !== 'read') {
    level = maxConsequence(level, 'high');
  }

  return level;
}

/**
 * What the classification step concluded.
 *
 * `malformed` is carried separately from `level` because RAISING TO `critical`
 * IS NOT ENOUGH on its own. An envelope whose ceiling is `critical` and which
 * sets no approval threshold would happily allow a `critical` action — so a
 * classifier returning nonsense would have been "handled" by pushing it to the
 * top and then permitted anyway, on the widest envelopes, which are exactly the
 * actors where a broken classifier matters most.
 *
 * A subsystem that could not classify has not classified. That is a malfunction
 * in an authorization input, and BP-001's fail-closed rule makes it a DENY with
 * a reason code, not a level to be weighed.
 */
export interface ConsequenceVerdict {
  readonly level: ConsequenceLevel;
  /** True when a source returned something unusable, or threw. */
  readonly malformed: boolean;
}

/**
 * The enforced classification.
 *
 * `platformConsequenceFloor` combined with whatever the subsystem port offers,
 * taking the HIGHER — and reporting separately whether the port answered at all.
 */
export function classifyConsequence(
  request: ActionRequest,
  source?: ConsequenceSource,
): ConsequenceVerdict {
  const floor = platformConsequenceFloor(request);
  if (!source) return { level: floor, malformed: false };

  let offered: ConsequenceLevel | undefined;
  try {
    offered = source.classify(request);
  } catch {
    // A classifier that threw did not say the action was safe. It said nothing.
    return { level: 'critical', malformed: true };
  }

  // An ABSENT opinion is legitimate and means "the platform floor stands".
  // It is the one case here that is not a malfunction.
  if (offered === undefined) return { level: floor, malformed: false };

  // A LEVEL NOBODY RECOGNISES IS A BROKEN CLASSIFIER.
  //
  // Unguarded, an unrecognised string flowed straight into `maxConsequence`,
  // where its rank lookup returned `undefined`, where `undefined >= 0` is
  // false — so the invalid value LOST the comparison and the floor was kept.
  // Worse, when the floor was the other operand the invalid value could replace
  // a real level with a lower one. A classifier that malfunctioned made the
  // action look SAFER than it was, and the action was allowed.
  if (!isConsequenceLevel(offered)) return { level: 'critical', malformed: true };

  return { level: maxConsequence(floor, offered), malformed: false };
}
