/**
 * Cost-aware orchestration (AI-01 Batch 3A).
 *
 * WHERE THE MONEY ACTUALLY MOVES, AND WHY THIS MODULE DOES NOT MOVE IT.
 *
 * Batch 1 already owns platform spend: `policy/spendLedger.ts` holds the
 * MARQ-funded lifetime ceiling, and `policy/spendGuard.ts` reserves against it
 * before every billable provider call and settles to the measured cost
 * afterwards. Every agent model step goes through `controlPlane.execute`, so
 * every agent model step is already reserved and settled by that guard.
 *
 * This module therefore does NOT take a second reservation against the platform
 * ledger, and that is a deliberate decision rather than an omission. Two
 * instruments holding money for the same call would double-count the headroom:
 * a run-level hold of its projected cost plus a per-call hold of the same cost
 * would refuse legitimate traffic at half the ceiling, and reconciling them
 * would mean two places that can disagree about how much has been spent.
 *
 * What it does instead is three things the platform ledger cannot do:
 *
 *   RUN-SCOPED RESERVATION. The run's own budget reserves the projected cost of
 *   the step in flight (`AgentCostLedger.reservedMicroUsd`), so a run cannot
 *   authorise two concurrent steps it can only afford one of.
 *
 *   PLATFORM PREFLIGHT. It READS the remaining platform headroom before a step
 *   and refuses when the projection would cross it — earlier than the spend
 *   guard would, and with a terminal run outcome instead of a mid-run error.
 *
 *   A DECISION, NOT JUST A VERDICT. When a step does not fit, the answer is not
 *   only "no". It is one of: compress the context, use a smaller profile,
 *   reduce the completion allowance, re-plan, ask a human, or deny. The
 *   orchestrator acts on that decision; the policy that produces it is
 *   deterministic and lives here in one function.
 *
 * ESTIMATES INCLUDE THE THINGS THAT ACTUALLY COST MONEY. A step's projection is
 * not one call — it is the call plus the retry allowance the runtime may spend
 * on it, plus the repair call a structured-output failure can trigger. Costing
 * the happy path and then being surprised by the retry is how a budget control
 * fails while reporting that it held.
 */

import type { AgentLimits } from '../contracts/agent.ts';
import type { AgentCostLedger } from '../contracts/runtime.ts';
import type { ModelProfile } from './modelRouting.ts';
import { indicativeCostMicroUsd } from './modelRouting.ts';

export function emptyCostLedger(): AgentCostLedger {
  return {
    estimatedMicroUsd: 0,
    actualMicroUsd: 0,
    reservedMicroUsd: 0,
    reconciliationVarianceMicroUsd: 0,
  };
}

export interface CostProjectionInput {
  readonly profile: ModelProfile;
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** Attempts the control plane may make for this step, from the feature. */
  readonly maxAttempts: number;
  /** True when a structured-output failure could trigger one repair call. */
  readonly repairPossible: boolean;
  /** Indicative cost of a handoff this step also performs. Usually zero. */
  readonly handoffMicroUsd?: number;
}

export interface CostProjection {
  /** Cost if everything works first time. */
  readonly baseMicroUsd: number;
  /** Additional cost the retry allowance can reach. */
  readonly retryRiskMicroUsd: number;
  /** Additional cost one repair call would add. */
  readonly repairMicroUsd: number;
  readonly handoffMicroUsd: number;
  /** What the runtime reserves and checks against. The sum of the above. */
  readonly projectedMicroUsd: number;
}

export function projectStepCost(input: CostProjectionInput): CostProjection {
  const base = indicativeCostMicroUsd(input.profile, input.promptTokens, input.completionTokens);
  const attempts = Math.max(1, Math.floor(input.maxAttempts));
  const retryRisk = base * (attempts - 1);
  const repair = input.repairPossible ? base : 0;
  const handoff = Math.max(0, Math.floor(input.handoffMicroUsd ?? 0));
  return {
    baseMicroUsd: base,
    retryRiskMicroUsd: retryRisk,
    repairMicroUsd: repair,
    handoffMicroUsd: handoff,
    projectedMicroUsd: base + retryRisk + repair + handoff,
  };
}

export type CostAction =
  | 'execute'
  | 'compress_context'
  | 'downgrade_profile'
  | 'reduce_completion'
  | 'replan'
  | 'require_approval'
  | 'deny';

export interface CostDecision {
  readonly action: CostAction;
  /** Caller-safe explanation. Goes into the step record and the audit trail. */
  readonly reason: string;
  readonly diagnostics: string;
  readonly projection: CostProjection;
  /** Set when the decision is `deny`: which ceiling stopped it. */
  readonly blockedBy?: 'run_estimate' | 'run_actual' | 'platform_ceiling';
}

export interface CostPolicyInput {
  readonly projection: CostProjection;
  readonly ledger: AgentCostLedger;
  readonly limits: AgentLimits;
  /** Micro-USD still available under the MARQ lifetime ceiling. */
  readonly platformRemainingMicroUsd: number;
  /** True when a cheaper profile exists that could serve this step. */
  readonly cheaperProfileAvailable: boolean;
  /** True when the context could be trimmed further without losing authority. */
  readonly contextCompressible: boolean;
  /** True when the completion allowance is above the profile's floor. */
  readonly completionReducible: boolean;
  /** Micro-USD above which the agent's policy demands a human decision. */
  readonly approvalThresholdMicroUsd?: number;
}

/**
 * Decide what happens to a step that has been costed.
 *
 * Order matters and encodes the platform's preference: never spend money the
 * platform does not have; then never exceed the run's own ceilings; then try
 * every cheaper way of doing the same work before refusing; and ask a human only
 * when the step is affordable but large enough that somebody should know.
 */
export function decideCost(input: CostPolicyInput): CostDecision {
  const { projection, ledger, limits } = input;
  const projected = projection.projectedMicroUsd;

  const base = {
    projection,
  };

  // 1 — The platform ceiling. This is MARQ's money and the only ceiling that is
  // not the tenant's to spend. Refused first, and refused terminally.
  if (projected > input.platformRemainingMicroUsd) {
    if (input.cheaperProfileAvailable) {
      return {
        ...base,
        action: 'downgrade_profile',
        reason: 'Platform AI spending headroom is low; using a smaller model profile.',
        diagnostics: `projected=${projected} platformRemaining=${input.platformRemainingMicroUsd}`,
      };
    }
    return {
      ...base,
      action: 'deny',
      blockedBy: 'platform_ceiling',
      reason: 'The platform AI spending cap has no headroom for this step.',
      diagnostics: `projected=${projected} platformRemaining=${input.platformRemainingMicroUsd}`,
    };
  }

  // 2 — The run's measured spend. A run that has already spent its allowance
  // does not get another step regardless of how cheap the next one looks.
  if (ledger.actualMicroUsd >= limits.maxActualCostMicroUsd) {
    return {
      ...base,
      action: 'deny',
      blockedBy: 'run_actual',
      reason: 'This run has spent its cost allowance.',
      diagnostics: `actual=${ledger.actualMicroUsd} limit=${limits.maxActualCostMicroUsd}`,
    };
  }

  // 3 — The run's projected spend, including what is already held for a step in
  // flight. Reserved is counted so two steps cannot each be admitted against
  // the same headroom.
  const committed = ledger.estimatedMicroUsd + ledger.reservedMicroUsd + projected;
  if (committed > limits.maxEstimatedCostMicroUsd) {
    if (input.cheaperProfileAvailable) {
      return {
        ...base,
        action: 'downgrade_profile',
        reason: 'This step exceeds the run budget; using a smaller model profile.',
        diagnostics: `committed=${committed} limit=${limits.maxEstimatedCostMicroUsd}`,
      };
    }
    if (input.completionReducible) {
      return {
        ...base,
        action: 'reduce_completion',
        reason: 'This step exceeds the run budget; reducing the completion allowance.',
        diagnostics: `committed=${committed} limit=${limits.maxEstimatedCostMicroUsd}`,
      };
    }
    if (input.contextCompressible) {
      return {
        ...base,
        action: 'compress_context',
        reason: 'This step exceeds the run budget; compressing the context.',
        diagnostics: `committed=${committed} limit=${limits.maxEstimatedCostMicroUsd}`,
      };
    }
    return {
      ...base,
      action: 'deny',
      blockedBy: 'run_estimate',
      reason: 'This run cannot afford another model step.',
      diagnostics: `committed=${committed} limit=${limits.maxEstimatedCostMicroUsd}`,
    };
  }

  // 4 — Affordable, but large. A threshold turns "expensive" into a decision
  // somebody made rather than one nobody saw.
  if (
    input.approvalThresholdMicroUsd !== undefined &&
    projected > input.approvalThresholdMicroUsd
  ) {
    return {
      ...base,
      action: 'require_approval',
      reason: 'This step costs more than the agent may spend without approval.',
      diagnostics: `projected=${projected} threshold=${input.approvalThresholdMicroUsd}`,
    };
  }

  return {
    ...base,
    action: 'execute',
    reason: 'Within budget.',
    diagnostics: `projected=${projected} committed=${committed}`,
  };
}

/** Hold the projection for a step about to run. */
export function reserveCost(ledger: AgentCostLedger, microUsd: number): AgentCostLedger {
  return {
    ...ledger,
    estimatedMicroUsd: ledger.estimatedMicroUsd + microUsd,
    reservedMicroUsd: ledger.reservedMicroUsd + microUsd,
  };
}

/**
 * Settle a held projection against what the step actually cost.
 *
 * The hold is released in full and the measured cost recorded, so the reserved
 * figure returns to zero between steps. The variance is kept for the same
 * reason the token ledger keeps its own: a projection that is consistently
 * wrong is a control that will eventually be wrong in the expensive direction.
 */
export function settleCost(
  ledger: AgentCostLedger,
  reservedMicroUsd: number,
  actualMicroUsd: number,
): AgentCostLedger {
  return {
    ...ledger,
    actualMicroUsd: ledger.actualMicroUsd + actualMicroUsd,
    reservedMicroUsd: Math.max(0, ledger.reservedMicroUsd - reservedMicroUsd),
    reconciliationVarianceMicroUsd:
      ledger.reconciliationVarianceMicroUsd + (actualMicroUsd - reservedMicroUsd),
  };
}

/** Release a hold for a step that never ran. Nothing is charged. */
export function releaseCost(ledger: AgentCostLedger, reservedMicroUsd: number): AgentCostLedger {
  return {
    ...ledger,
    estimatedMicroUsd: Math.max(0, ledger.estimatedMicroUsd - reservedMicroUsd),
    reservedMicroUsd: Math.max(0, ledger.reservedMicroUsd - reservedMicroUsd),
  };
}
