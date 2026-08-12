/**
 * Budget utilisation (AI-01 Batch 3B, Part 6C).
 *
 * ── READ-ONLY, AND STRUCTURALLY SO ─────────────────────────────────────────
 *
 * Financial Intelligence reports on budgets. It must never change one, and the
 * way that is guaranteed here is that this module holds no budget engine and no
 * ledger — it takes SNAPSHOTS as plain values and computes percentages from
 * them. There is no object in scope with a `charge` or a `record` method, so
 * there is nothing to call by accident.
 *
 * The boundary scan asserts the same thing on the source, because a behavioural
 * test can prove the reporting path does not mutate and cannot prove that no
 * second path does.
 *
 * ── UTILISATION IS A RATIO, NOT A VERDICT ──────────────────────────────────
 *
 * Nothing here decides whether spend is permitted. The Budget Engine remains the
 * only authority on that, and it decides at admission time against its own
 * ledger. A report that computed its own view of "is this over budget" would be
 * a second answer to a question that already has one, and the two would disagree
 * exactly when it mattered — during an incident, with a window boundary in play.
 *
 * So `denied` and `exhausted` counts below are OBSERVATIONS the caller supplies
 * from what the Budget Engine actually did, not conclusions this module reached.
 */

import { percentOf } from '../contracts/report.ts';
import { financialFailure } from '../contracts/failures.ts';

/**
 * A budget state snapshot, shaped to `AIBudgetState` without importing it.
 *
 * Deliberately structural rather than a type import: this module takes VALUES
 * from a caller that already read them, and depending on the policy contract
 * would be the first step towards depending on the engine that owns it.
 */
export interface BudgetSnapshot {
  readonly scope: string;
  readonly spentMicroUsd: number;
  readonly limitMicroUsd: number;
  readonly windowResetsAt: number;
}

/** The MARQ-funded lifetime ceiling, as the administration layer reports it. */
export interface PlatformCeilingSnapshot {
  readonly capMicroUsd: number;
  readonly spentMicroUsd: number;
  readonly reservedMicroUsd: number;
  readonly lifetimeSpentMicroUsd: number;
  readonly enforced: boolean;
}

export interface BudgetUtilizationEntry {
  readonly scope: string;
  readonly spentMicroUsd: number;
  readonly limitMicroUsd: number;
  readonly remainingMicroUsd: number;
  /** 0–100, one decimal. Capped at 100 for display; overshoot is its own field. */
  readonly utilizationPercent: number;
  /** Spend above the limit, when a bounded overshoot occurred. */
  readonly overshootMicroUsd: number;
  readonly windowResetsAt: number;
}

export interface BudgetUtilizationReport {
  readonly organization?: BudgetUtilizationEntry;
  readonly actors: readonly BudgetUtilizationEntry[];
  readonly workflows: readonly BudgetUtilizationEntry[];
  readonly platform?: {
    readonly capMicroUsd: number;
    readonly spentMicroUsd: number;
    readonly reservedMicroUsd: number;
    readonly remainingMicroUsd: number;
    readonly lifetimeSpentMicroUsd: number;
    readonly utilizationPercent: number;
    readonly enforced: boolean;
  };
  /** Calls the Budget Engine refused. Observed, never inferred. */
  readonly budgetDeniedCalls: number;
  /** Workflow runs that stopped because their budget was exhausted. */
  readonly budgetExhaustedWorkflows: number;
}

export interface BudgetUtilizationInput {
  readonly organizationId: string;
  readonly organization?: BudgetSnapshot;
  readonly actors?: readonly BudgetSnapshot[];
  readonly workflows?: readonly BudgetSnapshot[];
  readonly platform?: PlatformCeilingSnapshot;
  readonly budgetDeniedCalls?: number;
  readonly budgetExhaustedWorkflows?: number;
}

function entryFor(snapshot: BudgetSnapshot): BudgetUtilizationEntry {
  const spent = Math.max(0, Math.floor(snapshot.spentMicroUsd));
  const limit = Math.max(0, Math.floor(snapshot.limitMicroUsd));
  return {
    scope: snapshot.scope,
    spentMicroUsd: spent,
    limitMicroUsd: limit,
    remainingMicroUsd: Math.max(0, limit - spent),
    // Capped at 100 so a display never renders a 340% bar, with the overshoot
    // reported as its own figure. The Budget Engine is check-then-charge, so a
    // bounded overshoot is expected behaviour rather than a defect — and hiding
    // it inside a clamped percentage would make it invisible.
    utilizationPercent: Math.min(100, percentOf(spent, limit)),
    overshootMicroUsd: Math.max(0, spent - limit),
    windowResetsAt: snapshot.windowResetsAt,
  };
}

/**
 * Compute utilisation from snapshots.
 *
 * Pure and total. Refuses only a missing organization id, because a budget
 * report without a tenant is a budget report that could be shown to the wrong
 * one.
 */
export function reportBudgetUtilization(
  input: BudgetUtilizationInput,
): BudgetUtilizationReport {
  if (typeof input.organizationId !== 'string' || input.organizationId === '') {
    throw financialFailure(
      'financial_tenant_mismatch',
      'A budget report must name the organization it describes.',
    );
  }

  const platform = input.platform;

  return {
    ...(input.organization === undefined ? {} : { organization: entryFor(input.organization) }),
    actors: (input.actors ?? []).map(entryFor).sort((a, b) => b.spentMicroUsd - a.spentMicroUsd),
    workflows: (input.workflows ?? [])
      .map(entryFor)
      .sort((a, b) => b.spentMicroUsd - a.spentMicroUsd),
    ...(platform === undefined
      ? {}
      : {
          platform: {
            capMicroUsd: platform.capMicroUsd,
            spentMicroUsd: platform.spentMicroUsd,
            reservedMicroUsd: platform.reservedMicroUsd,
            remainingMicroUsd: Math.max(
              0,
              platform.capMicroUsd - platform.spentMicroUsd - platform.reservedMicroUsd,
            ),
            lifetimeSpentMicroUsd: platform.lifetimeSpentMicroUsd,
            // Reservations count towards utilisation. Money held for a request
            // in flight is money that cannot fund another one, and a percentage
            // that ignored it would report headroom the platform does not have.
            utilizationPercent: Math.min(
              100,
              percentOf(platform.spentMicroUsd + platform.reservedMicroUsd, platform.capMicroUsd),
            ),
            enforced: platform.enforced,
          },
        }),
    budgetDeniedCalls: Math.max(0, Math.floor(input.budgetDeniedCalls ?? 0)),
    budgetExhaustedWorkflows: Math.max(0, Math.floor(input.budgetExhaustedWorkflows ?? 0)),
  };
}
