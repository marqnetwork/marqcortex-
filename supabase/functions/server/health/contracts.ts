/**
 * The Operational Health Framework — contracts.
 *
 * `MARQ_CORTEX_MASTER_BLUEPRINT_v1.0.md` §IV-51 defines enterprise health as
 * FOUR DIMENSIONS and states the approved future state precisely: "a principled
 * operational-health framework rolling health signals up to the four
 * dimensions, with SLO/monitoring instrumentation deferred and excluded from
 * this phase".
 *
 * This module is that roll-up and nothing more. What §IV-51 excludes, it
 * excludes here too:
 *
 *   NO SLOs, NO THRESHOLDS, NO ALERTING, NO DASHBOARD. There is no number in
 *   this module that anybody has to agree to, because §IV-48 puts numeric
 *   targets explicitly out of scope for this phase and a health framework that
 *   invented them would be inventing product.
 *
 * ── THE ONE DISCIPLINE THAT MAKES IT WORTH HAVING ──────────────────────────
 *
 * AN UNREADABLE SIGNAL IS `unknown`, AND `unknown` NEVER ROLLS UP AS HEALTHY.
 *
 * The failure mode of every health page is reporting green because a probe was
 * never wired, or was wired and then broke. A framework that treats "I could
 * not find out" as "fine" is worse than no framework, because somebody trusts
 * it. So the roll-up has four states, `unknown` is one of them, and a dimension
 * whose signals cannot be read says so rather than passing.
 *
 * ── ORGANIZATIONAL HEALTH IS NOT AUTOMATICALLY OBSERVABLE, AND SAYS SO ──────
 *
 * §IV-51 defines organizational health as operating coherently under the
 * governance frame — "clear authority, alignment to the Constitution, no
 * drift". Most of that is a human judgement made in review, not a probe. The
 * framework therefore reports the governance state it CAN read and is explicit
 * that the dimension is not fully machine-observable. Reporting a confident
 * green for a dimension nothing measures would be the exact failure above,
 * dressed as governance.
 */

/** The four dimensions §IV-51 fixes. Not extensible by configuration. */
export type HealthDimension = 'organizational' | 'product' | 'platform' | 'ai';

export const HEALTH_DIMENSIONS: readonly HealthDimension[] = [
  'organizational',
  'product',
  'platform',
  'ai',
];

/**
 * A signal's state.
 *
 * `unknown` is a first-class answer, not an error: a deployment that has not
 * enabled a subsystem genuinely does not know its health, and saying so is
 * accurate. What it must never do is read as `healthy`.
 */
export type HealthState = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

/** Worst-first, so a roll-up is a maximum over this order. */
export const HEALTH_SEVERITY: Readonly<Record<HealthState, number>> = {
  healthy: 0,
  unknown: 1,
  degraded: 2,
  unhealthy: 3,
};

export interface HealthSignal {
  /** Stable identifier, e.g. `ai.control_plane`. Never a sentence. */
  readonly name: string;
  readonly state: HealthState;
  /**
   * One line an operator can act on. It carries no tenant data and no secret:
   * this roll-up is read across every tenant, and the scoping around it is only
   * as good as the absence of anything worth scoping.
   */
  readonly detail: string;
}

export interface DimensionHealth {
  readonly dimension: HealthDimension;
  readonly state: HealthState;
  /**
   * True when NOTHING in this dimension is machine-observable in this
   * deployment — as opposed to observable and currently unknown. The two look
   * identical on a status page and mean completely different things.
   */
  readonly observable: boolean;
  readonly signals: readonly HealthSignal[];
}

export interface EnterpriseHealth {
  /** The worst dimension. See `HEALTH_SEVERITY`. */
  readonly state: HealthState;
  readonly generatedAt: string;
  readonly dimensions: readonly DimensionHealth[];
  /**
   * Dimensions carrying no observable signal at all.
   *
   * Named on the report rather than left to be inferred from a state, because
   * "we are not measuring this" is the single most important thing a health
   * framework can tell the person reading it.
   */
  readonly unobservedDimensions: readonly HealthDimension[];
}

/**
 * A source of health signals for one dimension.
 *
 * A PORT, so this module depends on "somewhere signals come from" rather than
 * on the AI control plane, the storage layer or the key-value store. Health
 * that imported its subjects would be a module every subsystem has to depend on
 * to be observed, which is how a health check ends up able to break the thing
 * it observes.
 *
 * `collect` MUST NOT THROW. A source that cannot answer returns an `unknown`
 * signal saying why — the roll-up runs it inside a guard as well, because a
 * contract that only one side honours is not a contract.
 */
export interface HealthSignalSource {
  readonly dimension: HealthDimension;
  readonly name: string;
  collect(): Promise<HealthSignal> | HealthSignal;
}
