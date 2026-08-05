/**
 * The Cost Optimization Engine (AI-01 Batch 3B).
 *
 * WHERE THE MONEY ACTUALLY MOVES, AND WHY THIS MODULE DOES NOT MOVE IT.
 *
 * Batch 1 owns platform spend: `policy/spendLedger.ts` holds the MARQ-funded
 * lifetime ceiling and `policy/spendGuard.ts` reserves against it before every
 * billable provider call and settles to the measured cost afterwards. Every
 * workflow model step goes through `controlPlane.execute`, so every workflow
 * model step is already reserved and settled by that guard.
 *
 * This module therefore does NOT take a second reservation against the platform
 * ledger — the same decision `agents/runtime/costPolicy.ts` made, for the same
 * reason: two instruments holding money for one call would double-count the
 * headroom and refuse legitimate traffic at half the ceiling.
 *
 * What it does instead is what the platform ledger cannot:
 *
 *   PROJECT THE WHOLE EXPOSURE. A step is not one call. It is the call, plus the
 *   retries the node's policy allows, plus a repair call a structured-output
 *   failure can trigger, plus the branches a fan-out will open, plus the child
 *   agent run an agent node will create, plus the resumption a pending approval
 *   will eventually cause. Costing the happy path and being surprised by the
 *   retry is how a budget control fails while reporting that it held.
 *
 *   HOLD RUN-SCOPED. The workflow's own ledger reserves the projection for the
 *   node in flight, so one run cannot admit two steps it can only afford one of.
 *
 *   PREFLIGHT THE PLATFORM. It READS the remaining MARQ headroom and refuses
 *   before the spend guard would have to — earlier, and with a terminal workflow
 *   outcome instead of a mid-run error.
 *
 *   RETURN A DECISION, NOT A VERDICT. When a step does not fit, the answer is one
 *   of ten named actions, and the orchestrator acts on it.
 *
 * WHAT IT MAY NEVER WEAKEN. Safety, required capabilities, certification, tenant
 * isolation, the output contract and approval requirements are absent from every
 * decision path below, deliberately: there is no cost pressure that produces
 * "skip the approval" or "use the uncertified provider", because this module
 * cannot express either.
 */

import type { WorkflowLimits } from '../contracts/workflow.ts';
import type { WorkflowCostLedger } from '../contracts/runtime.ts';
import type { ModelProfile } from '../../agents/runtime/modelRouting.ts';
import { indicativeCostMicroUsd } from '../../agents/runtime/modelRouting.ts';

export function emptyWorkflowCostLedger(): WorkflowCostLedger {
  return {
    estimatedMicroUsd: 0,
    actualMicroUsd: 0,
    reservedMicroUsd: 0,
    avoidedMicroUsd: 0,
    reconciliationVarianceMicroUsd: 0,
  };
}

export interface CostProjectionInput {
  readonly profile: ModelProfile;
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** Attempts this node may make, INCLUDING the first. */
  readonly maxAttempts: number;
  /** True when a structured-output failure could trigger one repair call. */
  readonly repairPossible: boolean;
  /** Branches still to be opened downstream of this step. Zero on a leaf. */
  readonly pendingBranches?: number;
  /** Indicative cost of a child agent run this step creates. Usually zero. */
  readonly childAgentMicroUsd?: number;
  /** True when this step will park on an approval and resume later. */
  readonly approvalResumeExpected?: boolean;
}

export interface WorkflowCostProjection {
  /** Cost if everything works first time. */
  readonly baseMicroUsd: number;
  /** Additional cost the retry allowance can reach. */
  readonly retryRiskMicroUsd: number;
  /** Additional cost one repair call would add. */
  readonly repairMicroUsd: number;
  /** Additional cost the branches this step opens would add. */
  readonly parallelBranchMicroUsd: number;
  readonly childAgentMicroUsd: number;
  /** Cost of re-assembling context after an approval resumes the run. */
  readonly approvalResumeMicroUsd: number;
  readonly inputTokenMicroUsd: number;
  readonly outputTokenMicroUsd: number;
  /** What the engine reserves and checks against. The sum of the above. */
  readonly projectedMicroUsd: number;
}

export function projectWorkflowStepCost(input: CostProjectionInput): WorkflowCostProjection {
  const inputCost = indicativeCostMicroUsd(input.profile, input.promptTokens, 0);
  const outputCost = indicativeCostMicroUsd(input.profile, 0, input.completionTokens);
  const base = inputCost + outputCost;
  const attempts = Math.max(1, Math.floor(input.maxAttempts));
  const retryRisk = base * (attempts - 1);
  const repair = input.repairPossible ? base : 0;
  const branches = Math.max(0, Math.floor(input.pendingBranches ?? 0));
  const child = Math.max(0, Math.floor(input.childAgentMicroUsd ?? 0));
  // A resumed step re-assembles and re-sends its context but does not re-run the
  // whole node, so the exposure is the input half rather than the full call.
  const approvalResume = input.approvalResumeExpected ? inputCost : 0;

  return {
    baseMicroUsd: base,
    retryRiskMicroUsd: retryRisk,
    repairMicroUsd: repair,
    parallelBranchMicroUsd: base * branches,
    childAgentMicroUsd: child,
    approvalResumeMicroUsd: approvalResume,
    inputTokenMicroUsd: inputCost,
    outputTokenMicroUsd: outputCost,
    projectedMicroUsd:
      base + retryRisk + repair + base * branches + child + approvalResume,
  };
}

export type WorkflowCostAction =
  | 'execute'
  | 'reduce_context'
  | 'reduce_completion'
  | 'downgrade_profile'
  | 'serialize_parallel_work'
  | 'skip_optional_step'
  | 'use_cache'
  | 'require_approval'
  | 'replan'
  | 'deny';

export interface WorkflowCostDecision {
  readonly action: WorkflowCostAction;
  /** Caller-safe explanation. Goes into the node record and the audit trail. */
  readonly reason: string;
  readonly diagnostics: string;
  readonly projection: WorkflowCostProjection;
  readonly totalProjectedWorkflowCostMicroUsd: number;
  /** Set when the decision is `deny`: which ceiling stopped it. */
  readonly blockedBy?:
    | 'node_allowance'
    | 'workflow_estimate'
    | 'workflow_actual'
    | 'organization'
    | 'actor'
    | 'platform_ceiling';
}

export interface WorkflowCostPolicyInput {
  readonly projection: WorkflowCostProjection;
  readonly ledger: WorkflowCostLedger;
  readonly limits: WorkflowLimits;
  /** The node's own cost allowance. The tightest ceiling. */
  readonly nodeAllowanceMicroUsd: number;
  /** Micro-USD still available under the MARQ lifetime ceiling. */
  readonly platformRemainingMicroUsd: number;
  readonly organizationRemainingMicroUsd?: number;
  readonly actorRemainingMicroUsd?: number;
  /** True when a cheaper profile exists that could still serve this step. */
  readonly cheaperProfileAvailable: boolean;
  /** True when the context could be trimmed further without losing authority. */
  readonly contextCompressible: boolean;
  /** True when the completion allowance is above the floor. */
  readonly completionReducible: boolean;
  /** True when this step is inside a fan-out that could be run one arm at a time. */
  readonly parallelWorkSerializable: boolean;
  /** True when the node is declared optional and could be skipped entirely. */
  readonly nodeOptional: boolean;
  /** True when a cache entry could answer this node. */
  readonly cacheAvailable: boolean;
  /** Micro-USD above which the node's policy demands a human decision. */
  readonly approvalThresholdMicroUsd?: number;
}

/**
 * Decide what happens to a step that has been costed.
 *
 * ORDER IS THE POLICY, and it encodes the platform's preference: never spend
 * money the platform does not have; then never exceed the tenant's own ceilings;
 * then try every cheaper way of doing the same work before refusing; and ask a
 * human only when the step is affordable but large enough that somebody should
 * know.
 *
 * The recovery ladder within a ceiling breach is ordered cheapest-to-apply
 * first: use a cache entry (free), skip an optional step (free), serialize a
 * fan-out (no quality change), reduce the completion allowance (bounded quality
 * change), compress the context (bounded evidence change), downgrade the profile
 * (quality change, reported), replan, deny.
 */
export function decideWorkflowCost(input: WorkflowCostPolicyInput): WorkflowCostDecision {
  const { projection, ledger, limits } = input;
  const projected = projection.projectedMicroUsd;
  const totalProjected = ledger.actualMicroUsd + ledger.reservedMicroUsd + projected;
  const base = { projection, totalProjectedWorkflowCostMicroUsd: totalProjected };

  const recover = (
    reason: string,
    diagnostics: string,
  ): WorkflowCostDecision | undefined => {
    if (input.cacheAvailable) {
      return { ...base, action: 'use_cache', reason: `${reason} Serving from cache.`, diagnostics };
    }
    if (input.nodeOptional) {
      return {
        ...base,
        action: 'skip_optional_step',
        reason: `${reason} Skipping this optional step.`,
        diagnostics,
      };
    }
    if (input.parallelWorkSerializable) {
      return {
        ...base,
        action: 'serialize_parallel_work',
        reason: `${reason} Running the parallel work one branch at a time.`,
        diagnostics,
      };
    }
    if (input.completionReducible) {
      return {
        ...base,
        action: 'reduce_completion',
        reason: `${reason} Reducing the completion allowance.`,
        diagnostics,
      };
    }
    if (input.contextCompressible) {
      return {
        ...base,
        action: 'reduce_context',
        reason: `${reason} Compressing the context.`,
        diagnostics,
      };
    }
    if (input.cheaperProfileAvailable) {
      return {
        ...base,
        action: 'downgrade_profile',
        reason: `${reason} Using a smaller model profile.`,
        diagnostics,
      };
    }
    return undefined;
  };

  // 1 — The platform ceiling. This is MARQ's money and the only ceiling that is
  // not the tenant's to spend. Refused first, and refused terminally.
  if (projected > input.platformRemainingMicroUsd) {
    const diagnostics = `projected=${projected} platformRemaining=${input.platformRemainingMicroUsd}`;
    const recovery = recover('Platform AI spending headroom is low.', diagnostics);
    if (recovery) return recovery;
    return {
      ...base,
      action: 'deny',
      blockedBy: 'platform_ceiling',
      reason: 'The platform AI spending cap has no headroom for this step.',
      diagnostics,
    };
  }

  // 2 — The organization and the actor, when the deployment sets either.
  if (
    input.organizationRemainingMicroUsd !== undefined &&
    projected > input.organizationRemainingMicroUsd
  ) {
    const diagnostics = `projected=${projected} organizationRemaining=${input.organizationRemainingMicroUsd}`;
    const recovery = recover('This organization is close to its spending limit.', diagnostics);
    if (recovery) return recovery;
    return {
      ...base,
      action: 'deny',
      blockedBy: 'organization',
      reason: 'This organization has reached its AI spending limit.',
      diagnostics,
    };
  }
  if (input.actorRemainingMicroUsd !== undefined && projected > input.actorRemainingMicroUsd) {
    // An actor ceiling is the one budget a HUMAN can legitimately lift by taking
    // responsibility, so it asks rather than refusing outright.
    return {
      ...base,
      action: 'require_approval',
      reason: 'This step costs more than this actor may spend without approval.',
      diagnostics: `projected=${projected} actorRemaining=${input.actorRemainingMicroUsd}`,
    };
  }

  // 3 — The run's measured spend. A run that has already spent its allowance
  // does not get another step regardless of how cheap the next one looks.
  if (ledger.actualMicroUsd >= limits.maxActualCostMicroUsd) {
    return {
      ...base,
      action: 'deny',
      blockedBy: 'workflow_actual',
      reason: 'This run has spent its cost allowance.',
      diagnostics: `actual=${ledger.actualMicroUsd} limit=${limits.maxActualCostMicroUsd}`,
    };
  }

  // 4 — The node's own allowance, checked before the workflow's so the refusal
  // names the node the author can actually fix.
  if (input.nodeAllowanceMicroUsd > 0 && projected > input.nodeAllowanceMicroUsd) {
    const diagnostics = `projected=${projected} nodeAllowance=${input.nodeAllowanceMicroUsd}`;
    const recovery = recover('This step exceeds the node cost allowance.', diagnostics);
    if (recovery) return recovery;
    return {
      ...base,
      action: 'deny',
      blockedBy: 'node_allowance',
      reason: 'This node cannot be executed inside its cost allowance.',
      diagnostics,
    };
  }

  // 5 — The run's projected spend, including what is already held for a step in
  // flight. Reserved is counted so two steps cannot each be admitted against the
  // same headroom.
  const committed = ledger.estimatedMicroUsd + ledger.reservedMicroUsd + projected;
  if (committed > limits.maxEstimatedCostMicroUsd) {
    const diagnostics = `committed=${committed} limit=${limits.maxEstimatedCostMicroUsd}`;
    const recovery = recover('This step exceeds the workflow budget.', diagnostics);
    if (recovery) return recovery;
    // Nothing cheaper is available and the run is not out of money yet — a
    // different route through the graph might still finish, which is what
    // `replan` asks the orchestrator to consider before it gives up.
    if (ledger.actualMicroUsd < limits.maxActualCostMicroUsd / 2) {
      return {
        ...base,
        action: 'replan',
        reason: 'This step exceeds the workflow budget and no cheaper execution is available.',
        diagnostics,
      };
    }
    return {
      ...base,
      action: 'deny',
      blockedBy: 'workflow_estimate',
      reason: 'This run cannot afford another model step.',
      diagnostics,
    };
  }

  // 6 — Affordable, but large. A threshold turns "expensive" into a decision
  // somebody made rather than one nobody saw.
  if (
    input.approvalThresholdMicroUsd !== undefined &&
    projected > input.approvalThresholdMicroUsd
  ) {
    return {
      ...base,
      action: 'require_approval',
      reason: 'This step costs more than the workflow may spend without approval.',
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

/** Hold the projection for a node about to run. */
export function reserveWorkflowCost(
  ledger: WorkflowCostLedger,
  microUsd: number,
): WorkflowCostLedger {
  return {
    ...ledger,
    estimatedMicroUsd: ledger.estimatedMicroUsd + microUsd,
    reservedMicroUsd: ledger.reservedMicroUsd + microUsd,
  };
}

/**
 * Settle a held projection against what the node actually cost.
 *
 * The hold is released in full and the measured cost recorded, so the reserved
 * figure returns to zero between nodes. The variance is kept because a projection
 * that is consistently wrong is a control that will eventually be wrong in the
 * expensive direction, and the only way to know is to keep the difference.
 */
export function settleWorkflowCost(
  ledger: WorkflowCostLedger,
  reservedMicroUsd: number,
  actualMicroUsd: number,
): WorkflowCostLedger {
  return {
    ...ledger,
    actualMicroUsd: ledger.actualMicroUsd + actualMicroUsd,
    reservedMicroUsd: Math.max(0, ledger.reservedMicroUsd - reservedMicroUsd),
    reconciliationVarianceMicroUsd:
      ledger.reconciliationVarianceMicroUsd + (actualMicroUsd - reservedMicroUsd),
  };
}

/** Release a hold for a node that never ran. Nothing is charged. */
export function releaseWorkflowCost(
  ledger: WorkflowCostLedger,
  reservedMicroUsd: number,
): WorkflowCostLedger {
  return {
    ...ledger,
    estimatedMicroUsd: Math.max(0, ledger.estimatedMicroUsd - reservedMicroUsd),
    reservedMicroUsd: Math.max(0, ledger.reservedMicroUsd - reservedMicroUsd),
  };
}

/** Credit money a call never spent. Never charged, only recorded. */
export function recordAvoidedCost(
  ledger: WorkflowCostLedger,
  microUsd: number,
): WorkflowCostLedger {
  return { ...ledger, avoidedMicroUsd: ledger.avoidedMicroUsd + Math.max(0, microUsd) };
}
