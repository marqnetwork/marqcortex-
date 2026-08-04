/**
 * Budget Engine.
 *
 * Enforces spend ceilings per organization and per actor over a rolling daily
 * window, in micro-USD integers so a ledger never accumulates float error.
 *
 * The engine is check-then-charge, not reserve-then-settle: an AI call's true
 * cost is unknown until the provider reports token usage, so the plane admits a
 * request when the *already recorded* spend is under the ceiling and charges the
 * measured cost afterwards. The worst case is a single request's overshoot,
 * which is bounded by the feature's `maxOutputTokens`. A reservation scheme
 * would trade that bounded overshoot for systematically under-using every
 * budget, which is worse for a consultancy workload.
 *
 * The ledger is a port. The in-memory implementation here is correct for a
 * single edge instance; `createDurableBudgetLedger` in ../adapters wires the
 * same interface to shared storage when spend must be accurate across
 * instances.
 */

import type { Clock } from '../runtime/clock.ts';
import type { AIBudgetPolicy, AIBudgetState } from '../contracts/policy.ts';

export interface BudgetLedger {
  /** Current spend for a scope inside its window. */
  read(scope: string, windowMs: number): AIBudgetState;
  /** Add measured spend. Returns the state after the charge. */
  charge(scope: string, windowMs: number, microUsd: number): AIBudgetState;
  /** Drop windows that have fully elapsed. Returns how many were removed. */
  sweep(): number;
}

export interface BudgetVerdict {
  readonly allowed: boolean;
  readonly scope?: string;
  readonly state?: AIBudgetState;
  /** True when spend crossed the alerting threshold but is still under the cap. */
  readonly thresholdReached: boolean;
}

export interface BudgetEngine {
  /** Decide whether a request may proceed. Never records spend. */
  authorize(organizationId: string, actorId: string, policy: AIBudgetPolicy): BudgetVerdict;
  /** Record measured spend against both scopes. */
  record(organizationId: string, actorId: string, policy: AIBudgetPolicy, microUsd: number): void;
  /** Read the current state of both scopes, for the health endpoint. */
  inspect(organizationId: string, actorId: string, policy: AIBudgetPolicy): {
    organization: AIBudgetState;
    actor: AIBudgetState;
  };
}

const budgetScope = {
  organization: (organizationId: string) => `budget:org:${organizationId}`,
  actor: (organizationId: string, actorId: string) => `budget:actor:${organizationId}:${actorId}`,
};

export function createInMemoryBudgetLedger(clock: Clock): BudgetLedger {
  interface Window {
    spentMicroUsd: number;
    startedAtMs: number;
  }
  const windows = new Map<string, Window>();

  function currentWindow(scope: string, windowMs: number): Window {
    const nowMs = clock.now();
    const existing = windows.get(scope);
    if (existing && nowMs - existing.startedAtMs < windowMs) return existing;
    const fresh: Window = { spentMicroUsd: 0, startedAtMs: nowMs };
    windows.set(scope, fresh);
    return fresh;
  }

  function toState(scope: string, window: Window, windowMs: number, limit: number): AIBudgetState {
    return {
      scope,
      spentMicroUsd: window.spentMicroUsd,
      limitMicroUsd: limit,
      windowResetsAt: window.startedAtMs + windowMs,
    };
  }

  return {
    read(scope, windowMs) {
      return toState(scope, currentWindow(scope, windowMs), windowMs, 0);
    },
    charge(scope, windowMs, microUsd) {
      const window = currentWindow(scope, windowMs);
      window.spentMicroUsd += Math.max(0, Math.round(microUsd));
      return toState(scope, window, windowMs, 0);
    },
    sweep() {
      const nowMs = clock.now();
      let removed = 0;
      for (const [scope, window] of windows) {
        // 25 hours covers the widest window the policy contract allows plus
        // clock skew between edge instances.
        if (nowMs - window.startedAtMs > 25 * 3_600_000) {
          windows.delete(scope);
          removed += 1;
        }
      }
      return removed;
    },
  };
}

export function createBudgetEngine(
  ledger: BudgetLedger,
  options: { readonly alertThresholdPercent: number; readonly enforce: boolean },
): BudgetEngine {
  // Read per call, not cached at construction. AI-01 Batch 2 lets an
  // administrator move the alert threshold and the enforce flag at runtime, and
  // the control plane supplies `options` as live getters; a ratio computed once
  // here would pin the threshold to whatever it was when the isolate started.
  const thresholdRatio = () => Math.min(100, Math.max(1, options.alertThresholdPercent)) / 100;

  function stateFor(scope: string, windowMs: number, limitMicroUsd: number): AIBudgetState {
    const base = ledger.read(scope, windowMs);
    return { ...base, limitMicroUsd };
  }

  return {
    authorize(organizationId, actorId, policy) {
      const orgScope = budgetScope.organization(organizationId);
      const actorScope = budgetScope.actor(organizationId, actorId);
      const org = stateFor(orgScope, policy.organizationDaily.windowMs, policy.organizationDaily.limitMicroUsd);
      const actor = stateFor(actorScope, policy.actorDaily.windowMs, policy.actorDaily.limitMicroUsd);

      const overspent = [org, actor].find(
        (state) => state.limitMicroUsd > 0 && state.spentMicroUsd >= state.limitMicroUsd,
      );
      if (overspent && options.enforce) {
        return { allowed: false, scope: overspent.scope, state: overspent, thresholdReached: true };
      }

      const ratio = thresholdRatio();
      const nearing = [org, actor].some(
        (state) => state.limitMicroUsd > 0 && state.spentMicroUsd >= state.limitMicroUsd * ratio,
      );
      return { allowed: true, thresholdReached: nearing };
    },

    record(organizationId, actorId, policy, microUsd) {
      if (microUsd <= 0) return;
      ledger.charge(budgetScope.organization(organizationId), policy.organizationDaily.windowMs, microUsd);
      ledger.charge(budgetScope.actor(organizationId, actorId), policy.actorDaily.windowMs, microUsd);
    },

    inspect(organizationId, actorId, policy) {
      return {
        organization: stateFor(
          budgetScope.organization(organizationId),
          policy.organizationDaily.windowMs,
          policy.organizationDaily.limitMicroUsd,
        ),
        actor: stateFor(
          budgetScope.actor(organizationId, actorId),
          policy.actorDaily.windowMs,
          policy.actorDaily.limitMicroUsd,
        ),
      };
    },
  };
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Build the daily budget policy from control plane configuration. */
export function budgetPolicyFrom(config: {
  organizationDailyMicroUsd: number;
  actorDailyMicroUsd: number;
}): AIBudgetPolicy {
  return {
    organizationDaily: { windowMs: ONE_DAY_MS, limitMicroUsd: config.organizationDailyMicroUsd },
    actorDaily: { windowMs: ONE_DAY_MS, limitMicroUsd: config.actorDailyMicroUsd },
  };
}
