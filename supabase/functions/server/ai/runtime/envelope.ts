/**
 * The deployment envelope — the one place that decides what an administrator
 * may not loosen.
 *
 * AI-01 Batch 2 stated the rule ("the overlay may narrow, never widen") and
 * implemented it for exactly one switch, `AI_ALLOW_REAL_REQUESTS`. Certification
 * enforcement, budget enforcement and the daily ceilings were all read straight
 * from the overlay, so a console could turn off a control the deployment had
 * turned on. This module is the remediation, and it is a single function
 * deliberately: the previous shape — an `&&` at each consumer — is what let
 * three of the five safety-sensitive settings be forgotten.
 *
 * TWO KINDS OF BOUND, AND THEY ARE NOT THE SAME THING.
 *
 *   Absolute bounds     `SETTINGS_BOUNDS` in `operationalSettings.ts`. What any
 *                       value of this kind may ever be, in any deployment.
 *                       A retry delay of 999_999 ms is nonsense everywhere.
 *
 *   Deployment envelope this module. What THIS deployment has authorised,
 *                       expressed as its own configuration. An administrator
 *                       moves freely below it and cannot cross it.
 *
 * Normalisation applies the absolute bounds; the envelope is applied on top.
 * A value has to pass both.
 *
 * WHY THE RETRY CURVE IS BOUNDED ABSOLUTELY AND NOT BY THE DEPLOYMENT'S VALUE.
 *
 * A longer backoff is not a permission — it cannot reach a provider the
 * deployment withheld, spend money it did not authorise, or admit a caller it
 * refused. What it can do is keep a request alive longer, and that is bounded
 * by the workflow deadline, which IS clamped to the deployment's value. So the
 * retry curve stays an operational tuning knob with an absolute ceiling, and
 * the thing that actually governs a request's lifetime is the thing the
 * deployment pins. Clamping the curve to the deployment's current value would
 * make `AI_RETRY_BASE_DELAY_MS=0` mean "retries may never be delayed", which is
 * a tuning decision no deployment intends to make permanent.
 */

import type { AIControlPlaneConfig } from './config.ts';
import type { AIOperationalSettings } from './operationalSettings.ts';

export interface DeploymentEnvelope {
  /** May this deployment reach a billable provider at all? */
  readonly allowRealRequests: boolean;
  /** Does this deployment require certified providers? True cannot be undone. */
  readonly requireCertifiedProviders: boolean;
  /** Does this deployment require certified agents? True cannot be undone. */
  readonly requireCertifiedAgents: boolean;
  /** Does this deployment require certified tools? True cannot be undone. */
  readonly requireCertifiedTools: boolean;
  /** Does this deployment enforce daily budgets? True cannot be undone. */
  readonly budgetEnforce: boolean;
  /** The highest daily organization allowance an administrator may set. */
  readonly organizationDailyMicroUsd: number;
  /** The highest daily per-actor allowance an administrator may set. */
  readonly actorDailyMicroUsd: number;
  /** The longest whole-workflow deadline an administrator may set. */
  readonly workflowDeadlineMs: number;
  /**
   * The widest failover breadth an administrator may set (AI-01 Batch 4F).
   *
   * A spend and latency bound rather than a tuning knob: every additional
   * provider one request may be routed across is another vendor that can be
   * dialled before the request gives up. The deployment states the ceiling and
   * an administrator moves below it.
   */
  readonly routingMaxProviders: number;
}

export function envelopeFrom(config: AIControlPlaneConfig): DeploymentEnvelope {
  return {
    allowRealRequests: config.allowRealRequests,
    requireCertifiedProviders: config.requireCertifiedProviders,
    requireCertifiedAgents: config.requireCertifiedAgents,
    requireCertifiedTools: config.requireCertifiedTools,
    budgetEnforce: config.budget.enforce,
    organizationDailyMicroUsd: config.budget.organizationDailyMicroUsd,
    actorDailyMicroUsd: config.budget.actorDailyMicroUsd,
    workflowDeadlineMs: config.workflowDeadlineMs,
    routingMaxProviders: config.routing.maxProviders,
  };
}

/**
 * Narrow settings to the deployment envelope.
 *
 * Total and idempotent: applying it twice changes nothing, and any input
 * produces settings that respect the envelope. That matters because it runs on
 * three paths — an administrator's write, a record loaded from durable storage,
 * and a record refreshed from another isolate — and a record that was written
 * by an older revision, or edited by hand in the key-value store, must not be
 * able to widen the platform simply by being loaded.
 *
 * Booleans use OR for "required" flags and AND for "permitted" flags, which is
 * the same asymmetry stated in `effectiveRealRequestsEnabled`: an administrator
 * may always add a restriction and may never remove one the deployment set.
 */
export function applyEnvelope(
  settings: AIOperationalSettings,
  envelope: DeploymentEnvelope,
): AIOperationalSettings {
  return {
    ...settings,
    // A permission: the deployment must grant it before the overlay can.
    realRequestsEnabled: settings.realRequestsEnabled && envelope.allowRealRequests,
    // A restriction: the deployment may impose it and the overlay may add it,
    // but the overlay may never lift one the deployment imposed.
    requireCertifiedProviders:
      settings.requireCertifiedProviders || envelope.requireCertifiedProviders,
    // Each population narrows independently. An administrator may ADD a
    // certification requirement to any of the three and may never lift one the
    // deployment imposed — and turning one on never turns another on.
    requireCertifiedAgents: settings.requireCertifiedAgents || envelope.requireCertifiedAgents,
    requireCertifiedTools: settings.requireCertifiedTools || envelope.requireCertifiedTools,
    routing: {
      // The strategy is NOT clamped. It cannot admit a provider, cannot spend
      // money the deployment withheld and cannot lift a certification
      // requirement — it only orders what is already eligible, so it is a
      // tuning decision the administrator owns outright. The breadth IS
      // clamped, because it bounds how many vendors one request may reach.
      ...settings.routing,
      maxProviders: Math.min(settings.routing.maxProviders, envelope.routingMaxProviders),
    },
    timeout: {
      workflowDeadlineMs: Math.min(
        settings.timeout.workflowDeadlineMs,
        envelope.workflowDeadlineMs,
      ),
    },
    budget: {
      ...settings.budget,
      organizationDailyMicroUsd: Math.min(
        settings.budget.organizationDailyMicroUsd,
        envelope.organizationDailyMicroUsd,
      ),
      actorDailyMicroUsd: Math.min(
        settings.budget.actorDailyMicroUsd,
        envelope.actorDailyMicroUsd,
      ),
      enforce: settings.budget.enforce || envelope.budgetEnforce,
    },
  };
}

/**
 * Fields a patch asked for that the envelope refused, as human-readable text.
 *
 * The console needs to say "your change was accepted, and this part of it was
 * capped by the deployment" rather than silently showing a different number
 * from the one the operator typed. Returned rather than thrown: a patch that
 * mixes an allowed change with a capped one should still apply the allowed
 * part, which is what clamping does.
 */
export function envelopeAdjustments(
  requested: AIOperationalSettings,
  applied: AIOperationalSettings,
): readonly string[] {
  const notes: string[] = [];
  if (requested.realRequestsEnabled !== applied.realRequestsEnabled) {
    notes.push('real requests are not permitted by this deployment');
  }
  if (requested.requireCertifiedProviders !== applied.requireCertifiedProviders) {
    notes.push('this deployment requires certified providers');
  }
  if (requested.requireCertifiedAgents !== applied.requireCertifiedAgents) {
    notes.push('this deployment requires certified agents');
  }
  if (requested.requireCertifiedTools !== applied.requireCertifiedTools) {
    notes.push('this deployment requires certified tools');
  }
  if (requested.budget.enforce !== applied.budget.enforce) {
    notes.push('this deployment enforces daily budgets');
  }
  if (
    requested.budget.organizationDailyMicroUsd !== applied.budget.organizationDailyMicroUsd
  ) {
    notes.push(
      `organization daily allowance capped at ${applied.budget.organizationDailyMicroUsd} micro-USD`,
    );
  }
  if (requested.budget.actorDailyMicroUsd !== applied.budget.actorDailyMicroUsd) {
    notes.push(`actor daily allowance capped at ${applied.budget.actorDailyMicroUsd} micro-USD`);
  }
  if (requested.routing.maxProviders !== applied.routing.maxProviders) {
    notes.push(
      `failover breadth capped at ${applied.routing.maxProviders} provider(s) by this deployment`,
    );
  }
  if (requested.timeout.workflowDeadlineMs !== applied.timeout.workflowDeadlineMs) {
    notes.push(`workflow deadline capped at ${applied.timeout.workflowDeadlineMs} ms`);
  }
  return notes;
}
