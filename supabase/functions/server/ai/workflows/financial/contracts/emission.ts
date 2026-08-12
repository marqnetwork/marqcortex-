/**
 * The live financial emission contract (AI-01 Batch 3B, Integration Pass).
 *
 * ── ONE CANONICAL FINANCIAL PATH, EXPRESSED AS A TYPE ──────────────────────
 *
 * Parts 6A, 6B and 6C built a baseline model, a savings partition, an
 * avoided-call ledger, a canonical financial event and a set of read models
 * derived from it. What they did not have was a producer: every figure in the
 * Part 6C suites came from a fixture. This is the seam through which a real
 * workflow run produces them.
 *
 * The seam is ONE port with five methods, and the shape is the whole argument:
 *
 *   THE ENGINE HANDS OVER FACTS, NEVER FIGURES. There is no parameter on
 *   `recordAttempt` through which the workflow engine could state a cost, a
 *   baseline or a saving. It supplies identity, an attempt number, an outcome
 *   and — at settlement — the measurement the ALREADY-CERTIFIED usage path
 *   produced. Everything financial is derived on the other side by
 *   `deriveFinancialEvent`, from a Part 6A plan, exactly as the fixtures did.
 *
 *   THERE IS ONE PRODUCER. The workflow engine is the only caller, and this is
 *   the only port it has. A second emitter — a branch scheduler with its own
 *   totals, a reuse layer publishing its own savings, an optimisation layer with
 *   an incompatible rollup — is not caught by review here; it has nowhere to
 *   plug in.
 *
 * ── WHY `decideNode` LIVES ON THE SAME PORT AND STILL DECIDES NOTHING ──────
 *
 * `decideNode` returns a Part 6A `CompressionPlan`. A plan is ADVICE: it says
 * what the work would have cost unoptimised, what it is projected to cost, and
 * whether a validated prior output or a declared deterministic path means the
 * call need not happen at all. It carries no authority.
 *
 * The Workflow Orchestrator is the component that ACTS on it, and it is the only
 * one that can: it holds the run record, the checkpoint chain, the approval gate
 * and the agent port. Nothing reachable from this port can create an agent run,
 * drive one, cancel one, write a checkpoint, spend an approval or move a run's
 * state. When the port is unavailable the engine executes exactly as it did
 * before this pass existed — see `decideNode`'s `undefined` return.
 *
 * That is the line the batch draws: financial intelligence REPORTS on execution
 * and advises it. It never becomes a hidden execution authority.
 *
 * ── WHAT IS DELIBERATELY ABSENT ────────────────────────────────────────────
 *
 * No delete, no rewrite, no `adjust`, no `correct`. The only mutation this port
 * exposes is settlement, which Part 6C already permits exactly once per event.
 */

import type { CompressionPlan } from '../../../optimization/costCompressionEngine.ts';
import type { ReuseType } from '../../../reuse/accounting/avoidedCallLedger.ts';
import type {
  FinancialOutcome,
  ProviderIdentity,
} from '../../../financial/contracts/event.ts';

/**
 * Everything the emission path may learn about one node attempt.
 *
 * Every field is either an identity the run record already carries or a fact the
 * plan step already declares. Nothing here is measured, estimated or inferred —
 * see `financialFacts.ts` for the assembly, and note what it cannot reach: an
 * agent definition, a model profile, a provider adapter or a price table.
 */
export interface WorkflowNodeFinancialFacts {
  readonly organizationId: string;
  readonly actorId: string;
  readonly workflowId: string;
  readonly workflowVersion: string;
  readonly workflowRunId: string;
  /** The administrative configuration in force. Stamped as the policy version. */
  readonly configurationVersion: number;

  readonly nodeId: string;
  readonly branchId?: string;
  readonly groupId?: string;
  readonly agentId: string;
  /**
   * The child agent run this attempt produced, when one exists.
   *
   * ABSENT on an avoided call, and that absence is load-bearing: an avoided call
   * has no child run because no call was made, and an event claiming one would
   * be claiming an execution that never happened.
   */
  readonly agentRunId?: string;
  /** The child's own version, as the trusted usage path reported it. */
  readonly agentVersion?: string;
  /**
   * The registered feature the spend belongs to.
   *
   * A workflow node names an AGENT, not a feature, and the agent runtime resolves
   * the feature per model call. The workflow engine therefore cannot establish
   * one, and this stays absent rather than being filled with the workflow id
   * wearing a feature's name.
   */
  readonly featureId?: string;

  /** Which attempt of this node this is. 1 is the primary attempt. */
  readonly attempt: number;
  /** Attempts the node's definition permits. Used as the optimised projection. */
  readonly maxAttempts: number;
  /**
   * Mandatory, safety-critical or approval-bound work.
   *
   * Read by Part 6C's waste analysis, which must never label required safety or
   * approval work as waste.
   */
  readonly protectedWork: boolean;
  /** Supplied by the engine's clock. Nothing under this port reads one. */
  readonly occurredAt: number;
}

/** The run-level facts established when a run is created. */
export interface WorkflowFinancialRunContext {
  readonly organizationId: string;
  readonly actorId: string;
  readonly workflowId: string;
  readonly workflowVersion: string;
  readonly workflowRunId: string;
  readonly configurationVersion: number;
  readonly occurredAt: number;
}

/** The reuse evidence behind an avoided call. Read from the Part 6B resolution. */
export interface WorkflowReuseEvidence {
  readonly reuseType: ReuseType;
  readonly sourceReusableResultId: string;
  /** Digest of the gate's verdict. Recomputable from the verdict itself. */
  readonly eligibilityEvidenceDigest: string;
  /** What the source generation cost when it happened. Provenance only. */
  readonly sourceOriginalCostMicroUsd: number;
  /**
   * The stored result's fields, for the node to adopt as its output.
   *
   * Handed back RAW. The engine applies the node's own declared output contract
   * to it before it becomes a trusted output — the same contract a child agent's
   * result passes through — so a reused value is governed exactly as a freshly
   * generated one is, and never more loosely.
   */
  readonly output: unknown;
}

/**
 * What Part 6A and Part 6B say about one node attempt.
 *
 * `avoided` and `refused` are derived from the plan rather than supplied
 * alongside it, so a caller cannot describe a plan as something it is not.
 */
export interface WorkflowNodeCostDecision {
  readonly plan: CompressionPlan;
  /** True when no provider call is required and the work still happens. */
  readonly avoided: boolean;
  /** True when the plan declined the work. A refusal claims NO saving. */
  readonly refused: boolean;
  /** Present only when the avoidance came from a Part 6B reuse hit. */
  readonly reuse?: WorkflowReuseEvidence;
}

/** The measurement the certified usage path produced for one child agent run. */
export interface WorkflowNodeSettlement {
  readonly actualCostMicroUsd: number;
  readonly actualTokens: number;
  /**
   * What the spend bought.
   *
   * The CHILD's outcome, not the workflow's: a node that failed after two model
   * steps bought a failure, and the run it belonged to may still complete.
   */
  readonly outcome: Extract<FinancialOutcome, 'succeeded' | 'failed'>;
  /** Identity only, and only when the trusted usage record established one. */
  readonly provider?: ProviderIdentity;
}

export interface WorkflowFinalizationInput {
  readonly organizationId: string;
  readonly workflowId: string;
  readonly workflowRunId: string;
  /** The terminal outcome. `in_progress` is refused. */
  readonly outcome: FinancialOutcome;
  readonly occurredAt: number;
  /** The run's own lifetime, so the scan is bounded to its own events. */
  readonly fromMs: number;
}

/** What one finalization pass did. Returned so a test can assert convergence. */
export interface WorkflowFinalizationReport {
  readonly examined: number;
  /** Events that had already settled and were left exactly as they were. */
  readonly preserved: number;
  /** Pending events marked `unsettled_terminal`. Never converted to zero. */
  readonly abandoned: number;
  /**
   * True when the financial store could not be read or written.
   *
   * The run still reaches its terminal state — see `workflowFinancialRecorder.ts`
   * for the fail-open decision and why it is fail-open — and this flag, the
   * `ai.workflow.financial.degraded` metric and the warning log are the
   * detectable signal that a coverage figure computed afterwards is incomplete.
   */
  readonly degraded: boolean;
}

/**
 * The one path from workflow execution to canonical financial evidence.
 *
 * Every method resolves rather than throwing. A reporting layer that could abort
 * an advance would be an execution authority, which is exactly what this batch
 * forbids; the recorder catches, counts, logs and returns.
 */
export interface WorkflowFinancialPort {
  /**
   * Establish the run's financial context.
   *
   * Emits NO event, deliberately. A run that has executed no node has spent
   * nothing, and an event written at creation would be money the platform
   * claimed before anything proposed it. What this does is bind the run to the
   * baseline policy version every one of its later events will carry, so a
   * reader can tell which reference a run's savings were measured against
   * without consulting a second table.
   */
  openRun(context: WorkflowFinancialRunContext): Promise<void>;

  /**
   * Ask Parts 6A and 6B what this node attempt should be.
   *
   * Returns `undefined` when no decision can be established — no envelope for
   * the agent, or the optimisation path itself failed. The engine then executes
   * the node exactly as it did before this pass, and records nothing rather than
   * recording a guess.
   */
  decideNode(facts: WorkflowNodeFinancialFacts): Promise<WorkflowNodeCostDecision | undefined>;

  /**
   * Emit the canonical event for one node attempt.
   *
   * An inference is emitted `pending`: its measurement has not arrived, and
   * pending is NOT zero. An avoided call is emitted settled at zero on
   * `measured_absence`. A refusal is emitted claiming nothing at all.
   */
  recordAttempt(
    facts: WorkflowNodeFinancialFacts,
    decision: WorkflowNodeCostDecision,
  ): Promise<void>;

  /**
   * Settle one node attempt against measured spend.
   *
   * Idempotent in both directions: it appends the event first when a crash lost
   * the pending write, and Part 6C's store refuses a second settlement of one
   * event, so a re-observed child cannot pay for one call twice.
   */
  settleAttempt(
    facts: WorkflowNodeFinancialFacts,
    decision: WorkflowNodeCostDecision,
    settlement: WorkflowNodeSettlement,
  ): Promise<void>;

  /** The bounded terminal finalization. Idempotent, and safe to repeat. */
  finalizeRun(input: WorkflowFinalizationInput): Promise<WorkflowFinalizationReport>;
}
