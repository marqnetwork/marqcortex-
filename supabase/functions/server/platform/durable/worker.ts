/**
 * The job runtime (BP-002 §16, CHECKPOINT 5).
 *
 * ONE PASS IS: claim a due job, decide whether it may happen, run it, settle
 * the result and its events together, and record what was decided. That is the
 * whole of it, and the order is the interesting part:
 *
 *     claim → AUTHORITY → execute → settle (result + events, atomically)
 *
 * The evaluation is between the claim and the execution, not before the claim
 * and not inside the handler. Before the claim it would be a decision about a
 * job nobody owns, which another worker may then run under a different one.
 * Inside the handler it would be a check each handler has to remember, which is
 * the arrangement BP-001 exists to replace.
 *
 * ── THE FOUR THINGS THIS FILE REFUSES TO DO ───────────────────────────────
 *
 *   IT NEVER CONVERTS `REQUIRE_APPROVAL` INTO A RUN. BP-002 §11 is explicit and
 *   the failure mode is specific: a worker that treats "a human must decide"
 *   as "retry later and hope the policy changes" will eventually run the work
 *   unattended when the policy does change for an unrelated reason. So an
 *   approval requirement is a TERMINAL outcome here — dead-letter, with its
 *   reason code, visible — and the run is resumed by whatever creates the
 *   approval, not by the passage of time.
 *
 *   IT NEVER RUNS WITHOUT AN ACTOR. A job whose actor context cannot be read
 *   fails closed. There is no default actor and no way to ask for one.
 *
 *   IT NEVER SETTLES WITHOUT ITS LEASE. Every settle presents the lease it was
 *   claimed under. A stale owner's settle returns false and writes nothing,
 *   events included.
 *
 *   IT NEVER SWALLOWS A HANDLER'S THROW. An exception is a retryable failure
 *   with a code, not a success and not a silent drop.
 *
 * ── WHY A HANDLER THROWING IS RETRYABLE AND A HANDLER RETURNING `failed`
 *    IS NOT ────────────────────────────────────────────────────────────────
 *
 * Because the two say different things. `failed` is a judgement the handler
 * made about its own work — it looked, and this will not succeed. A throw is
 * the absence of a judgement: something went wrong before the handler reached a
 * conclusion, and "an identical attempt could succeed later" is the honest
 * reading of that. The same distinction `workflows/runtime/retryPolicy.ts`
 * draws when it refuses to retry a child that failed with no code, from the
 * opposite side: there, no code means the agent DECIDED to stop.
 */

import {
  DURABLE_FAILURE,
  DurableRuntimeError,
  type DurableJob,
  type JobExecutionContext,
  type JobLease,
  type JobOutcome,
  type RegisteredJobHandler,
} from './contracts.ts';
import type { DurableJobStore, JobSettlement } from './ports.ts';
import type { JobHandlerRegistry } from './registry.ts';
import { attemptsExhausted, nextAvailableAt } from './retry.ts';
import { evaluateJobAuthority } from './authority.ts';
import { assertEventDraft, instantMs } from './guards.ts';
import {
  authorityAuditDetail,
  type AuthorityDecision,
  type PolicyConstraint,
} from '../authority/index.ts';

/**
 * Where a decision goes once it is made.
 *
 * A PORT, NOT A WRITER. BP-002 §13 says to reuse the existing audit
 * architecture and not to create a parallel general-purpose audit store, and
 * this folder cannot import the existing one — it may not reach into `ai/**`.
 * So the runtime hands its record to whoever composed it, and the composition
 * gives it the audit writer that already exists. The shape handed over is
 * `authorityAuditDetail`'s, which those writers already accept.
 */
export interface DurableAuditSink {
  record(entry: DurableAuditEntry): void;
}

export interface DurableAuditEntry {
  readonly at: string;
  readonly organizationId: string;
  readonly jobId: string;
  readonly jobType: string;
  readonly attempt: number;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly leaseOwner: string;
  readonly leaseGeneration: number;
  readonly outcome: 'succeeded' | 'retry' | 'dead_letter' | 'denied' | 'approval_required';
  readonly failureCode?: string;
  /** The BP-001 decision, projected into the existing audit shape. */
  readonly authority?: ReturnType<typeof authorityAuditDetail>;
  readonly eventIds: readonly string[];
}

/** Organization-level constraints in force. The seam onto existing policy. */
export interface DurablePolicySource {
  constraints(job: DurableJob): readonly PolicyConstraint[];
}

export interface JobWorkerDependencies {
  readonly store: DurableJobStore;
  readonly registry: JobHandlerRegistry;
  readonly nowIso: () => string;
  /** This worker's identity. Must be stable for the life of one isolate. */
  readonly workerId: string;
  readonly audit?: DurableAuditSink;
  readonly policies?: DurablePolicySource;
  readonly leaseTtlMs?: number;
}

/** What one `runOnce` did. `undefined` job means nothing was claimable. */
export interface JobPassResult {
  readonly claimed: boolean;
  readonly job?: DurableJob;
  readonly outcome?: DurableAuditEntry['outcome'];
  readonly failureCode?: string;
  readonly decision?: AuthorityDecision;
  readonly eventIds: readonly string[];
}

export interface JobWorker {
  /** Claim and run at most one job. */
  runOnce(organizationId: string, jobTypes?: readonly string[]): Promise<JobPassResult>;
  /** Claim and run up to `max` jobs, stopping when nothing is claimable. */
  drain(
    organizationId: string,
    max: number,
    jobTypes?: readonly string[],
  ): Promise<readonly JobPassResult[]>;
  /** Return abandoned work to the queue. Cross-tenant, by design. */
  recover(limit?: number): Promise<{ recovered: number; deadLettered: number }>;
}

const IDLE: JobPassResult = { claimed: false, eventIds: [] };

export function createJobWorker(deps: JobWorkerDependencies): JobWorker {
  const leaseTtlMs = deps.leaseTtlMs ?? 60_000;

  async function settleAndReport(
    job: DurableJob,
    lease: JobLease,
    settlement: JobSettlement,
    outcome: DurableAuditEntry['outcome'],
    decision: AuthorityDecision | undefined,
    eventIds: readonly string[],
  ): Promise<JobPassResult> {
    const at = deps.nowIso();
    const settled = await deps.store.settle(lease, settlement, at);

    if (!settled) {
      // THE LEASE WAS NOT OURS ANY MORE. Either it expired and somebody
      // recovered the job, or the tenant cancelled it while we ran. Nothing was
      // written — not the result, not the events — which is the guarantee this
      // whole design is for. It is REPORTED rather than retried: retrying would
      // mean running the work a second time on a job another worker may already
      // own.
      deps.audit?.record({
        at,
        organizationId: job.organizationId,
        jobId: job.jobId,
        jobType: job.jobType,
        attempt: job.attempt,
        correlationId: job.correlationId,
        ...(job.causationId === undefined ? {} : { causationId: job.causationId }),
        leaseOwner: lease.owner,
        leaseGeneration: lease.generation,
        outcome: 'retry',
        failureCode: DURABLE_FAILURE.leaseLost,
        eventIds: [],
      });
      return {
        claimed: true,
        job,
        outcome: 'retry',
        failureCode: DURABLE_FAILURE.leaseLost,
        eventIds: [],
      };
    }

    deps.audit?.record({
      at,
      organizationId: job.organizationId,
      jobId: job.jobId,
      jobType: job.jobType,
      attempt: job.attempt,
      correlationId: job.correlationId,
      ...(job.causationId === undefined ? {} : { causationId: job.causationId }),
      leaseOwner: lease.owner,
      leaseGeneration: lease.generation,
      outcome,
      ...(settlement.disposition === 'succeeded'
        ? {}
        : { failureCode: settlement.failureCode }),
      ...(decision === undefined ? {} : { authority: authorityAuditDetail(decision) }),
      eventIds,
    });

    return {
      claimed: true,
      job,
      outcome,
      ...(settlement.disposition === 'succeeded'
        ? {}
        : { failureCode: settlement.failureCode }),
      ...(decision === undefined ? {} : { decision }),
      eventIds,
    };
  }

  /**
   * Turn a retryable failure into the right settlement.
   *
   * ONE PLACE DECIDES "retry again or give up", so the exhaustion rule cannot
   * be applied differently to a thrown error and a returned `retry`.
   */
  function retryOrDeadLetter(
    job: DurableJob,
    failureCode: string,
    failureDetail: string | undefined,
    nowMs: number,
  ): { settlement: JobSettlement; outcome: DurableAuditEntry['outcome'] } {
    if (attemptsExhausted(job.attempt, job.maxAttempts)) {
      return {
        settlement: {
          disposition: 'dead_letter',
          failureCode,
          ...(failureDetail === undefined ? {} : { failureDetail }),
        },
        outcome: 'dead_letter',
      };
    }
    return {
      settlement: {
        disposition: 'retry',
        failureCode,
        ...(failureDetail === undefined ? {} : { failureDetail }),
        // The next attempt is `job.attempt + 1`; the claim already spent the
        // current one. `nextAvailableAt` is deterministic, so this stamp can be
        // recomputed by anybody reading the row.
        availableAt: nextAvailableAt(job.retry, job.attempt + 1, nowMs),
      },
      outcome: 'retry',
    };
  }

  async function execute(
    job: DurableJob,
    lease: JobLease,
    registered: RegisteredJobHandler,
  ): Promise<JobPassResult> {
    const startedIso = deps.nowIso();
    const nowMs = instantMs(startedIso) ?? Date.now();

    // ── AUTHORITY ─────────────────────────────────────────────────────────
    //
    // Only for work that CAN cause a consequential effect. A handler that only
    // reads and returns a count has no consequence to weigh, and evaluating it
    // anyway would put a meaningless ALLOW in the trail on every tick of every
    // sweep — which is how a trail becomes something nobody reads. The
    // declaration cannot lie about this: `assertHandlerDeclaration` refuses a
    // handler that declares a world-changing effect and `consequential: false`.
    let decision: AuthorityDecision | undefined;
    if (registered.declaration.consequential) {
      decision = evaluateJobAuthority({
        job,
        declaration: registered.declaration,
        policies: deps.policies?.constraints(job),
        traceId: `${job.jobId}#${job.attempt}`,
        nowIso: startedIso,
      });

      if (decision.decision === 'DENY') {
        // A DENIAL IS A GOVERNED OUTCOME, NOT AN ERROR TO RETRY. BP-002 §11:
        // "authority denial is a governed job outcome, not something to
        // catch-and-ignore." Retrying it would re-ask a question that was
        // answered, spending the whole attempt budget to get the same no.
        return settleAndReport(
          job,
          lease,
          {
            disposition: 'dead_letter',
            failureCode: DURABLE_FAILURE.authorityDenied,
            failureDetail: `${decision.reason} [${decision.reasonCodes.join(',')}]`,
          },
          'denied',
          decision,
          [],
        );
      }

      if (decision.decision === 'REQUIRE_APPROVAL') {
        // NEVER CONVERTED TO AN ALLOW, AND NEVER PARKED AS A RETRY. See the
        // file header for why "retry later" is the dangerous reading.
        return settleAndReport(
          job,
          lease,
          {
            disposition: 'dead_letter',
            failureCode: DURABLE_FAILURE.authorityApprovalRequired,
            failureDetail:
              decision.approvalRequirement?.summary ??
              'a person must decide before this work may happen',
          },
          'approval_required',
          decision,
          [],
        );
      }
    }

    // ── EXECUTION ─────────────────────────────────────────────────────────
    const context: JobExecutionContext = {
      job,
      lease,
      nowIso: startedIso,
      heartbeat: async () => {
        const extended = await deps.store.heartbeat(lease, job.leaseTtlMs, deps.nowIso());
        return extended !== undefined;
      },
    };

    let outcome: JobOutcome;
    try {
      outcome = await registered.handle(context);
    } catch (error) {
      // See the header: a throw is the ABSENCE of a judgement, so it is
      // retryable. A `DurableRuntimeError` carries its own code, which is more
      // useful than `handler.threw`.
      const code =
        error instanceof DurableRuntimeError ? error.code : DURABLE_FAILURE.handlerThrew;
      const detail = error instanceof Error ? error.message : String(error);
      const { settlement, outcome: reported } = retryOrDeadLetter(job, code, detail, nowMs);
      return settleAndReport(job, lease, settlement, reported, decision, []);
    }

    // ── THE EVENTS ARE VALIDATED BEFORE ANYTHING IS SETTLED ───────────────
    //
    // BP-002 §17.24 requires that a malformed or oversized payload fails
    // closed, and this is where "closed" is decided. Letting the draft reach
    // the settle would make the store throw mid-write — and a `settle` that
    // throws leaves the job LEASED, to be recovered minutes later and run
    // again, with the same handler producing the same unwritable event. An
    // unbounded loop, paced by the lease TTL, on a defect that will never fix
    // itself.
    //
    // So the check happens here, the failure is attributed to the job, and it
    // is RETRYABLE-then-dead-lettered like any other: the attempt budget is
    // what turns a permanent defect into a bounded number of tries and one
    // visible dead-letter row.
    const eventFailure = firstInvalidEvent(outcome, job);
    if (eventFailure !== undefined) {
      const { settlement, outcome: reported } = retryOrDeadLetter(
        job,
        eventFailure.code,
        eventFailure.detail,
        nowMs,
      );
      return settleAndReport(job, lease, settlement, reported, decision, []);
    }

    if (outcome.kind === 'succeeded') {
      const eventIds = (outcome.events ?? []).map((event) => event.eventId);
      return settleAndReport(
        job,
        lease,
        {
          disposition: 'succeeded',
          ...(outcome.result === undefined ? {} : { result: outcome.result }),
          ...(outcome.events === undefined ? {} : { events: outcome.events }),
        },
        'succeeded',
        decision,
        eventIds,
      );
    }

    if (outcome.kind === 'failed') {
      // TERMINAL BY THE HANDLER'S OWN JUDGEMENT, with attempts still on the
      // clock. Straight to dead-letter — and its events still publish, because
      // "this failed permanently" is exactly the kind of fact something
      // downstream needs to hear.
      const eventIds = (outcome.events ?? []).map((event) => event.eventId);
      return settleAndReport(
        job,
        lease,
        {
          disposition: 'dead_letter',
          failureCode: outcome.failureCode,
          ...(outcome.failureDetail === undefined
            ? {}
            : { failureDetail: outcome.failureDetail }),
          ...(outcome.events === undefined ? {} : { events: outcome.events }),
        },
        'dead_letter',
        decision,
        eventIds,
      );
    }

    const { settlement, outcome: reported } = retryOrDeadLetter(
      job,
      outcome.failureCode,
      outcome.failureDetail,
      nowMs,
    );
    return settleAndReport(job, lease, settlement, reported, decision, []);
  }

  return {
    async runOnce(organizationId, jobTypes) {
      const claim = await deps.store.claim(
        organizationId,
        jobTypes ?? deps.registry.jobTypes(),
        deps.workerId,
        leaseTtlMs,
        deps.nowIso(),
      );
      if (!claim) return IDLE;

      const registered = deps.registry.resolve(claim.job.jobType);
      if (!registered) {
        // FAIL CLOSED AND VISIBLY. A job whose handler was removed, renamed or
        // never deployed goes to dead-letter rather than being retried forever
        // against a registry that will not change until somebody deploys.
        return settleAndReport(
          claim.job,
          claim.lease,
          {
            disposition: 'dead_letter',
            failureCode: DURABLE_FAILURE.handlerMissing,
            failureDetail: `no handler is registered for job type ${claim.job.jobType}`,
          },
          'dead_letter',
          undefined,
          [],
        );
      }

      return execute(claim.job, claim.lease, registered);
    },

    async drain(organizationId, max, jobTypes) {
      const results: JobPassResult[] = [];
      const ceiling = Math.min(Math.max(1, Math.floor(max)), 500);
      for (let index = 0; index < ceiling; index += 1) {
        const result = await this.runOnce(organizationId, jobTypes);
        if (!result.claimed) break;
        results.push(result);
      }
      return results;
    },

    async recover(limit) {
      return deps.store.recoverExpiredLeases(deps.nowIso(), limit ?? 100);
    },
  };
}

/**
 * The first event draft that cannot be written down, if there is one.
 *
 * Uses the SAME validator the store uses — `eventRecordFrom` calls
 * `assertEventDraft` — so a draft that passes here cannot fail there. Two
 * validators would mean a draft accepted by the worker and refused by the
 * store, which is precisely the mid-write failure this check exists to prevent.
 */
function firstInvalidEvent(
  outcome: JobOutcome,
  job: DurableJob,
): { readonly code: string; readonly detail: string } | undefined {
  if (outcome.kind === 'retry') return undefined;
  for (const draft of outcome.events ?? []) {
    try {
      assertEventDraft(draft);
    } catch (error) {
      if (error instanceof DurableRuntimeError) {
        return {
          code: error.code,
          detail: `${error.detail ?? error.message} (event ${draft.eventId} of job ${job.jobId})`,
        };
      }
      return {
        code: DURABLE_FAILURE.eventInvalid,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return undefined;
}
