/**
 * The live financial recorder (AI-01 Batch 3B, Integration Pass).
 *
 * THE ONE PRODUCER OF CANONICAL FINANCIAL EVENTS.
 *
 * ── WHAT IT IS, AND WHAT IT REFUSES TO BE ──────────────────────────────────
 *
 * It is an adapter. It takes execution facts from the Workflow Orchestrator,
 * asks Part 6A what the work should cost, asks Part 6B whether it needs to
 * happen, and hands the resulting artefacts to Part 6C's `deriveFinancialEvent`
 * — which assembles the event from THEM and never from anything this module
 * says. There is no arithmetic in this file. Search it for a `+` on a micro-USD
 * figure and there is none to find, and that absence is the design: a component
 * that could add two costs together is a component that has an opinion about
 * what something cost, and the platform already has exactly one of those.
 *
 * Concretely, and each of these is a defect that would otherwise be available:
 *
 *   IT DOES NOT COMPUTE A BASELINE. `compressCost` does, from a versioned policy
 *   that cannot see the result it is the denominator of.
 *
 *   IT DOES NOT PARTITION A SAVING. Part 6A's savings ledger does, and the plan
 *   carries the partition through untouched.
 *
 *   IT DOES NOT DECIDE A REUSE HIT. The Part 6B eligibility gate does. What
 *   arrives here is a resolution the gate already validated, and this module
 *   cannot construct one.
 *
 *   IT DOES NOT MAINTAIN A TOTAL. Not per run, not per branch, not per tenant.
 *   Every figure Part 6C publishes is a fold over the stored events, so there is
 *   no second accumulator here to disagree with them.
 *
 * ── FAIL-OPEN, DELIBERATELY, AND WITH A SIGNAL ─────────────────────────────
 *
 * Every method resolves. A financial store that is unavailable, a plan that
 * cannot be produced, a settlement that will not write — none of them abort an
 * advance, fail a node or block a terminal state.
 *
 * THE REASON IS NOT CONVENIENCE. Execution authority in this platform belongs to
 * the Workflow Orchestrator and the AI Control Plane. A reporting layer that
 * could refuse a terminal transition would hold a veto over execution, which is
 * a larger and less visible failure than an incomplete report: a run that cannot
 * end because its accountant is down still has a running child agent spending
 * real money, and now nothing can stop it.
 *
 * THE COST IS PAID IN COVERAGE, VISIBLY. A dropped event is a missing row, and a
 * missing row shows up in Part 6C's settlement coverage rather than as a
 * flattering total — an event that never settles becomes `unsettled_terminal`
 * and is reported as unknown spend, never as zero. Every degraded path also
 * increments `ai.workflow.financial.degraded` and logs with diagnostics, so the
 * gap is detectable rather than merely survivable.
 *
 * THE ONE THING THAT FAILS CLOSED is derivation. When a figure cannot be
 * established, NO event is written — a partial event, or one with a guessed
 * cost, would be a wrong number that looks exactly like a right one. Absence is
 * recoverable; a fabricated row is not.
 *
 * ── IDEMPOTENCY IS DERIVED, NOT REMEMBERED ─────────────────────────────────
 *
 * The event id is a digest of the material execution identity — tenant, run,
 * node, branch, child run, attempt, category and type — via
 * `workflowNodeTaskId` and Part 6C's `financialEventIdFor`. Nothing in this
 * module remembers what it has already written, because a memory in an edge
 * isolate is empty in the next one. Two isolates, a restart, a repeated
 * finalization and an operator refreshing a console all converge on the same
 * row, and the store's insert-if-absent refuses the rest.
 */

import type { Logger } from '../../observability/logger.ts';
import type { Metrics } from '../../observability/metrics.ts';
import type { ValidatedPriorOutput } from '../../optimization/contracts/task.ts';
import { compressCost } from '../../optimization/costCompressionEngine.ts';
import type { AvoidedCallEntry, ReuseType } from '../../reuse/accounting/avoidedCallLedger.ts';
import {
  emptyAvoidedCallLedger,
  recordAvoidedCall,
} from '../../reuse/accounting/avoidedCallLedger.ts';
import type { FinancialEvent, FinancialOutcome } from '../../financial/contracts/event.ts';
import { isTerminalOutcome } from '../../financial/contracts/event.ts';
import type { FinancialEventContext } from '../../financial/ledger/financialEventLedger.ts';
import {
  abandonSettlement,
  deriveFinancialEvent,
  deriveSettlementsFromUsage,
  settleFinancialEvent,
} from '../../financial/ledger/financialEventLedger.ts';
import type { FinancialEventStore } from '../../financial/persistence/ports.ts';
import type {
  WorkflowFinalizationInput,
  WorkflowFinalizationReport,
  WorkflowFinancialPort,
  WorkflowFinancialRunContext,
  WorkflowNodeCostDecision,
  WorkflowNodeFinancialFacts,
  WorkflowNodeSettlement,
} from './contracts/emission.ts';
import type {
  WorkflowNodeCostProfile,
  WorkflowNodeLimits,
} from './nodeCostProfile.ts';
import {
  WORKFLOW_OPTIMIZATION_POLICY_VERSION,
  workflowNodeEnvelope,
  workflowNodeTask,
  workflowPolicyVersionFor,
} from './nodeCostProfile.ts';

/**
 * A reuse hit the Part 6B pipeline already validated.
 *
 * The RESOLUTION crosses the boundary, not the pipeline. `resolveReuse` needs a
 * reusable-result store, a task fingerprint, dependency declarations and a
 * freshness policy — none of which the workflow engine holds or should hold — so
 * a deployment assembles the resolver and this tree consumes its verdict. The
 * consequence is the property that matters: nothing in `workflows/` can decide
 * that a prior output is still valid, and `priorOutput` arrives already carrying
 * the gate's `contractValidated`.
 */
export interface WorkflowReuseCandidate {
  readonly priorOutput: ValidatedPriorOutput;
  readonly reuseType: ReuseType;
  readonly reusableResultId: string;
  /** Digest of the gate's verdict, computed where the verdict was produced. */
  readonly eligibilityEvidenceDigest: string;
  /** What the source generation cost. Provenance only; nothing sums it. */
  readonly sourceOriginalCostMicroUsd: number;
  /** The stored fields, for the node's own output contract to accept or refuse. */
  readonly output: unknown;
}

export interface WorkflowReuseResolver {
  /** Resolve a hit, or `undefined` for a miss. A miss claims nothing. */
  resolve(facts: WorkflowNodeFinancialFacts): Promise<WorkflowReuseCandidate | undefined>;
}

export interface WorkflowFinancialRecorderOptions {
  readonly store: FinancialEventStore;
  /**
   * The agent's OWN declared limits, resolved by the assembly.
   *
   * The workflow tree cannot read the agent registry — one module may, and it is
   * the runtime assembly — so the ceilings arrive as a function. Returning
   * `undefined` means no envelope can be established for that agent, and the
   * recorder then produces no decision and no event rather than pricing the work
   * against a ceiling it invented.
   */
  limitsFor(agentId: string): WorkflowNodeLimits | undefined;
  /** What a deployment declares about a node's economics. Optional. */
  profileFor?: (facts: WorkflowNodeFinancialFacts) => WorkflowNodeCostProfile | undefined;
  /** The Part 6B resolver. Absent disables reuse for this deployment. */
  readonly reuse?: WorkflowReuseResolver;
  /** The kill switch, read live. Passed to the envelope, never re-decided here. */
  aiEnabled(): boolean;
  readonly logger: Logger;
  readonly metrics: Metrics;
}

/** Rows one finalization pass will look at. Bounded, like every Part 6C scan. */
const MAX_FINALIZATION_ROWS = 2_000;

export function createWorkflowFinancialRecorder(
  options: WorkflowFinancialRecorderOptions,
): WorkflowFinancialPort {
  const { store, logger, metrics } = options;

  /**
   * Record a degraded path and carry on.
   *
   * The whole of the fail-open policy is here, in one function, so there is one
   * place to read to know what the platform does when its accountant is down —
   * and one place a reviewer can check that it does not also swallow the fact.
   */
  function degrade(operation: string, facts: Partial<WorkflowNodeFinancialFacts>, error: unknown): void {
    metrics.increment('ai.workflow.financial.degraded', { operation });
    logger.warn('ai.workflow.financial.degraded', {
      operation,
      ...(facts.workflowRunId === undefined ? {} : { workflowRunId: facts.workflowRunId }),
      ...(facts.workflowId === undefined ? {} : { workflowId: facts.workflowId }),
      ...(facts.nodeId === undefined ? {} : { nodeId: facts.nodeId }),
      ...(facts.branchId === undefined ? {} : { branchId: facts.branchId }),
      ...(facts.attempt === undefined ? {} : { attempt: facts.attempt }),
      diagnostics: error instanceof Error ? error.message : String(error),
    });
  }

  /**
   * The context Part 6C derives an event from.
   *
   * Assembled in ONE place, so the identity a `recordAttempt` writes and the
   * identity a `settleAttempt` looks for are the same identity by construction
   * rather than by two call sites agreeing. `costCategory` is deliberately NOT
   * supplied: Part 6C's own classifier reads the attempt, the branch and the
   * child run and decides, which keeps "what kind of spend is this" answered in
   * one place across both writes.
   */
  function contextFor(
    facts: WorkflowNodeFinancialFacts,
    decision: WorkflowNodeCostDecision,
    outcome: FinancialOutcome,
    extras: {
      readonly settlement?: WorkflowNodeSettlement;
      readonly avoidedCall?: AvoidedCallEntry;
    },
  ): FinancialEventContext {
    const provider = extras.settlement?.provider;
    return {
      actorId: facts.actorId,
      workflowId: facts.workflowId,
      workflowVersion: facts.workflowVersion,
      workflowRunId: facts.workflowRunId,
      nodeId: facts.nodeId,
      ...(facts.branchId === undefined ? {} : { branchId: facts.branchId }),
      ...(facts.groupId === undefined ? {} : { groupId: facts.groupId }),
      ...(facts.agentRunId === undefined ? {} : { agentRunId: facts.agentRunId }),
      agentId: facts.agentId,
      ...(facts.agentVersion === undefined ? {} : { agentVersion: facts.agentVersion }),
      ...(facts.featureId === undefined ? {} : { featureId: facts.featureId }),
      // Absent unless the trusted usage record established a single identity.
      // A blank identity is the honest report for spend whose provider the
      // platform cannot name; a guessed one would be attribution fiction.
      ...(provider === undefined ? {} : { provider }),
      retryAttempt: facts.attempt,
      outcome,
      protectedWork: facts.protectedWork,
      policyVersion: workflowPolicyVersionFor(facts.configurationVersion),
      optimizationPolicyVersion: WORKFLOW_OPTIMIZATION_POLICY_VERSION,
      occurredAt: facts.occurredAt,
      ...(extras.settlement === undefined
        ? {}
        : {
            settlement: {
              actualCostMicroUsd: extras.settlement.actualCostMicroUsd,
              actualTokens: extras.settlement.actualTokens,
            },
          }),
      ...(extras.avoidedCall === undefined ? {} : { avoidedCall: extras.avoidedCall }),
    };
  }

  /**
   * The Part 6B avoided-call entry behind one reuse hit.
   *
   * Built through `recordAvoidedCall` rather than by hand, because that function
   * is where the reuse controls live: it refuses a plan that did not decide
   * `reuse`, refuses a second reuse type for one call, and reads the baseline
   * from the plan instead of taking one from a caller. A hand-built entry would
   * bypass all three.
   *
   * The ledger it is recorded into is a fresh, empty one each time, and that is
   * not a weakening of the single-attribution control — it is a statement about
   * where the control lives. An in-process map is empty again after a restart,
   * so the DURABLE control against counting one avoided call twice is the
   * derived financial event id and the store's insert-if-absent, which survives
   * a recycled isolate. This ledger enforces the per-call rules; the store
   * enforces the once-ever rule.
   */
  function avoidedCallFor(
    decision: WorkflowNodeCostDecision,
  ): AvoidedCallEntry | undefined {
    const reuse = decision.reuse;
    if (reuse === undefined) return undefined;
    const ledger = recordAvoidedCall({
      ledger: emptyAvoidedCallLedger(),
      plan: decision.plan,
      reuseType: reuse.reuseType,
      sourceReusableResultId: reuse.sourceReusableResultId,
      eligibilityEvidenceDigest: reuse.eligibilityEvidenceDigest,
      sourceOriginalCostMicroUsd: reuse.sourceOriginalCostMicroUsd,
    });
    return ledger.entries.get(decision.plan.taskId);
  }

  /** The outcome an unsettled attempt carries at the moment it is recorded. */
  function recordedOutcome(decision: WorkflowNodeCostDecision): FinancialOutcome {
    // A refusal is a decision, and `policy_denied` is what it was. An avoided
    // call produced the node's answer, so it succeeded. An inference has not
    // finished, and `in_progress` is what keeps its settlement `pending` rather
    // than permanently unknown.
    if (decision.refused) return 'policy_denied';
    return decision.avoided ? 'succeeded' : 'in_progress';
  }

  return {
    openRun(context: WorkflowFinancialRunContext): Promise<void> {
      // No event. See `contracts/emission.ts` — a run that has executed no node
      // has spent nothing, and the baseline that matters is established per node
      // by the plan that prices it. What this does is make the run's financial
      // context visible at its start, so an operator reading an incident can see
      // which configuration and which optimisation policy its events will carry.
      metrics.increment('ai.workflow.financial.run_opened', {
        workflow: context.workflowId,
      });
      logger.info('ai.workflow.financial.run_opened', {
        workflowRunId: context.workflowRunId,
        workflowId: context.workflowId,
        workflowVersion: context.workflowVersion,
        organizationId: context.organizationId,
        policyVersion: workflowPolicyVersionFor(context.configurationVersion),
        optimizationPolicyVersion: WORKFLOW_OPTIMIZATION_POLICY_VERSION,
      });
      return Promise.resolve();
    },

    async decideNode(facts) {
      try {
        const limits = options.limitsFor(facts.agentId);
        if (limits === undefined) {
          // No declared ceiling means no truthful baseline. The node executes
          // normally and nothing is recorded, which is the honest outcome: a
          // baseline priced against an invented envelope would be a savings
          // denominator nobody could defend.
          metrics.increment('ai.workflow.financial.no_envelope', { agent: facts.agentId });
          return undefined;
        }

        const declared = options.profileFor?.(facts);

        // ── A CALL THAT EXISTS CANNOT BE AVOIDED ──────────────────────────────
        //
        // `agentRunId` present means a child agent run was already created for
        // this attempt, which means the call has happened or is happening. Every
        // avoidance input is stripped for such a node — no reuse consultation,
        // no deterministic capabilities — so no plan derived for it can come back
        // `reuse` or `deterministic`.
        //
        // Without this rule the settlement path, which re-derives the decision
        // from durable facts, could produce an avoided-call event for an
        // inference that really happened: actual cost zero, full baseline saved,
        // and a provider invoice that disagrees. It also makes the branch path
        // safe by construction, since a branch's decision is taken after its
        // child exists.
        const executed = facts.agentRunId !== undefined;
        const profile =
          declared === undefined
            ? undefined
            : executed
              ? { ...declared, deterministicCapabilities: [] }
              : declared;

        const envelope = workflowNodeEnvelope({
          limits,
          aiEnabled: options.aiEnabled(),
          ...(profile === undefined ? {} : { profile }),
        });

        const candidate = executed ? undefined : await resolveCandidate(facts);
        const task = workflowNodeTask({
          facts,
          envelope,
          ...(profile === undefined ? {} : { profile }),
          ...(candidate === undefined ? {} : { priorOutputs: [candidate.priorOutput] }),
        });

        const plan = compressCost({
          task,
          envelope,
          // No declared context metadata in the workflow tree. See
          // `nodeCostProfile.ts` for why an empty list understates the baseline
          // and why understating it is the safe direction.
          contextItems: [],
          plannedAttempts: facts.maxAttempts,
        });

        const refused = plan.decision === 'deny' || plan.decision === 'defer';
        const avoided = !refused && plan.inferenceAvoided;

        // A candidate the admission did NOT turn into a reuse decision is a
        // rejected candidate, and a rejected candidate is not a hit. The evidence
        // is dropped rather than carried, so nothing downstream can attribute a
        // saving to a prior output the plan declined to use.
        const hit = avoided && plan.decision === 'reuse' && candidate !== undefined;
        if (candidate !== undefined && !hit) {
          metrics.increment('ai.workflow.financial.reuse_candidate_rejected', {
            workflow: facts.workflowId,
            decision: plan.decision,
          });
        }

        return {
          plan,
          avoided,
          refused,
          ...(hit && candidate !== undefined
            ? {
                reuse: {
                  reuseType: candidate.reuseType,
                  sourceReusableResultId: candidate.reusableResultId,
                  eligibilityEvidenceDigest: candidate.eligibilityEvidenceDigest,
                  sourceOriginalCostMicroUsd: candidate.sourceOriginalCostMicroUsd,
                  output: candidate.output,
                },
              }
            : {}),
        };
      } catch (error) {
        degrade('decide', facts, error);
        return undefined;
      }
    },

    async recordAttempt(facts, decision) {
      try {
        const avoidedCall = avoidedCallFor(decision);
        const event = deriveFinancialEvent(
          decision.plan,
          contextFor(facts, decision, recordedOutcome(decision), {
            ...(avoidedCall === undefined ? {} : { avoidedCall }),
          }),
        );
        const outcome = await store.append(event);
        metrics.increment('ai.workflow.financial.event', {
          workflow: facts.workflowId,
          type: event.eventType,
          stored: outcome.stored ? 'yes' : 'duplicate',
        });
      } catch (error) {
        degrade('record', facts, error);
      }
    },

    async settleAttempt(facts, decision, settlement) {
      try {
        const avoidedCall = avoidedCallFor(decision);
        const settled = deriveFinancialEvent(
          decision.plan,
          contextFor(facts, decision, settlement.outcome, {
            settlement,
            ...(avoidedCall === undefined ? {} : { avoidedCall }),
          }),
        );

        // APPEND FIRST, AND THAT ORDER IS THE CRASH-WINDOW FIX. An isolate that
        // died between persisting the pending node and writing its pending event
        // left no row at all; the settled event is inserted here in one step and
        // the spend is not lost. When the pending row IS there, the insert is
        // refused and the settlement replaces it.
        const appended = await store.append(settled);
        if (appended.stored) {
          metrics.increment('ai.workflow.financial.settled', {
            workflow: facts.workflowId,
            path: 'recovered',
          });
          return;
        }

        if (appended.event.settlementState === 'settled') {
          // Already paid for. A re-observed child, a second advance over the same
          // terminal handle, or a restart — all of them arrive here, and none of
          // them may pay twice.
          metrics.increment('ai.workflow.financial.settle_duplicate', {
            workflow: facts.workflowId,
          });
          return;
        }

        const applied = await store.settle(settled);
        metrics.increment('ai.workflow.financial.settled', {
          workflow: facts.workflowId,
          path: applied ? 'applied' : 'refused',
        });
      } catch (error) {
        degrade('settle', facts, error);
      }
    },

    async finalizeRun(input) {
      let examined = 0;
      let preserved = 0;
      let settled = 0;
      let abandoned = 0;

      if (!isTerminalOutcome(input.outcome)) {
        // Finalization is what a TERMINAL run does. Asked to finalize a live one
        // it does nothing at all rather than marking live spend permanently
        // unknown, which would be the one way this step could destroy evidence.
        return { examined: 0, preserved: 0, settled: 0, abandoned: 0, degraded: false };
      }

      let page: { readonly events: readonly FinancialEvent[] };
      try {
        page = await store.list({
          organizationId: input.organizationId,
          workflowRunId: input.workflowRunId,
          window: { fromMs: Math.max(0, input.fromMs), toMs: input.occurredAt + 1 },
          limit: MAX_FINALIZATION_ROWS,
        });
      } catch (error) {
        degrade('finalize_read', { workflowRunId: input.workflowRunId }, error);
        return { examined: 0, preserved: 0, settled: 0, abandoned: 0, degraded: true };
      }

      // The measurements the run's OWN ledger holds, keyed by child agent run.
      // Read through Part 6C's own derivation rather than folded here — the
      // rows are already the certified accounting port's high-water marks, and a
      // second reading of them would be a second answer.
      const measured = deriveSettlementsFromUsage(input.usageRows);

      let degraded = false;
      for (const event of page.events) {
        examined += 1;
        if (event.settlementState !== 'pending') {
          // ALREADY SETTLED STAYS SETTLED. A measurement that arrived is not
          // revisited by a run ending, and `unsettled_terminal` is not re-marked.
          preserved += 1;
          continue;
        }

        const measurement =
          event.agentRunId === undefined ? undefined : measured.get(event.agentRunId);

        try {
          if (measurement !== undefined) {
            // SETTLED FROM THE LEDGER. A run cancelled while a child was still
            // running never reached the drive that would have settled this, and
            // the spend is real and measured. Reporting it as unknown would be
            // just as wrong as reporting it as zero.
            const applied = await store.settle({
              ...settleFinancialEvent(event, measurement),
              outcome: input.outcome,
            });
            if (applied) settled += 1;
            else preserved += 1;
            continue;
          }

          // NEVER ZERO. `abandonSettlement` moves the state and leaves the
          // measurement ABSENT, so the spend shows up as unknown rather than as
          // free — and the outcome is stamped so the run's failure, cancellation
          // or expiry is visible on the row it produced.
          const applied = await store.settle({
            ...abandonSettlement(event),
            outcome: input.outcome,
          });
          if (applied) abandoned += 1;
          else preserved += 1;
        } catch (error) {
          degraded = true;
          degrade('finalize_settle', { workflowRunId: input.workflowRunId }, error);
        }
      }

      metrics.increment('ai.workflow.financial.finalized', {
        workflow: input.workflowId,
        outcome: input.outcome,
      });
      if (abandoned > 0) {
        logger.info('ai.workflow.financial.unsettled_terminal', {
          workflowRunId: input.workflowRunId,
          workflowId: input.workflowId,
          outcome: input.outcome,
          unsettled: abandoned,
          settledAtFinalization: settled,
          alreadySettled: preserved,
        });
      }
      return { examined, preserved, settled, abandoned, degraded };
    },
  };

  async function resolveCandidate(
    facts: WorkflowNodeFinancialFacts,
  ): Promise<WorkflowReuseCandidate | undefined> {
    if (options.reuse === undefined) return undefined;
    try {
      return await options.reuse.resolve(facts);
    } catch (error) {
      // A reuse resolver that fails is a MISS, never a hit. Failing open towards
      // execution costs money; failing open towards reuse would serve a stale
      // answer because a store was unreachable.
      degrade('reuse_resolve', facts, error);
      return undefined;
    }
  }
}

/**
 * The port a deployment gets when financial recording is switched off.
 *
 * It decides nothing and records nothing, which makes "the engine executes
 * identically with the recorder absent" a property of the type rather than a
 * claim about the engine's branches. `decideNode` returning `undefined` is the
 * same signal a missing envelope produces, so there is one path through the
 * engine for "no financial advice available" rather than two.
 */
export function createNoopWorkflowFinancialPort(): WorkflowFinancialPort {
  return {
    openRun: () => Promise.resolve(),
    decideNode: () => Promise.resolve(undefined),
    recordAttempt: () => Promise.resolve(),
    settleAttempt: () => Promise.resolve(),
    finalizeRun: () =>
      Promise.resolve({ examined: 0, preserved: 0, settled: 0, abandoned: 0, degraded: false }),
  };
}
