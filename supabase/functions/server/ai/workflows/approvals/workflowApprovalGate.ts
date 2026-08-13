/**
 * The workflow approval gate (AI-01 Batch 3B, Part 5).
 *
 * The one module that writes a `WorkflowApprovalRecord`. Everything the batch
 * claims about approvals is enforced here, and the claims are worth restating
 * as the operations that hold them up:
 *
 *   request   Writes a PENDING record before the run is parked. Adopts an
 *             identical pending request rather than minting a second one, which
 *             is what makes a crashed advance recoverable.
 *
 *   decide    Resolves authority server-side, checks the tenant, refuses an
 *             expired or already-decided request, and writes the answer under
 *             optimistic concurrency.
 *
 *   consume   Spends an APPROVED record on ONE position, exactly once. Every
 *             replay, every stale binding and every second attempt is refused.
 *
 *   expireIfDue / withdraw
 *             Close a request that can no longer be answered. NEITHER OF THEM
 *             EVER PRODUCES `approved`, and there is no path through this file
 *             that does so without a decider and a decision.
 *
 * ── THE ORDER OF CHECKS IN `decide` IS LOAD-BEARING ────────────────────────
 *
 *   1. the reason is present and bounded
 *   2. the record exists, in THIS tenant
 *   3. the decider holds an authorised role
 *   4. the request has not expired
 *   5. the request is still pending
 *
 * Authority before expiry, and both before state. A caller who may not decide
 * this approval must learn only that they may not decide it — telling them
 * "that has already been approved" or "that expired an hour ago" would answer a
 * question they were not entitled to ask, and would let an unauthorised caller
 * probe the state of decisions across a tenant one refusal at a time.
 *
 * ── TENANT SCOPE IS CHECKED TWICE, DELIBERATELY ────────────────────────────
 *
 * The store is keyed by organization, so a cross-tenant read cannot even form a
 * key — and `decide` compares the record's organization against the decider's
 * anyway. "The key was right" and "this person may act on this" are different
 * claims, and only one of them is about authorization. A future store that is
 * not keyed must not be able to silently weaken this.
 *
 * ── WHAT THIS MODULE DOES NOT DO ───────────────────────────────────────────
 *
 * It does not touch a run record, drive a node, move a cursor or know what a
 * plan is. `decide` is called by a person through the service; the run finds
 * out on its next advance, by reading the record. That separation is why a
 * decision survives an isolate that was never driving the run, and why nobody
 * needs to hold a run's version in order to answer a question about it.
 */

import type {
  WorkflowApprovalBinding,
  WorkflowApprovalDecision,
  WorkflowApprovalRecord,
  WorkflowApprovalSubjectEvidence,
  WorkflowRejectionPolicy,
} from '../contracts/approval.ts';
import {
  WORKFLOW_APPROVAL_BOUNDS,
  workflowApprovalIdFor,
} from '../contracts/approval.ts';
import type { WorkflowApprovalQuery, WorkflowApprovalStore } from '../persistence/ports.ts';
import { workflowFailure } from '../contracts/failures.ts';
import type { Clock } from '../../runtime/clock.ts';

export interface WorkflowApprovalGateDependencies {
  readonly store: WorkflowApprovalStore;
  readonly clock: Clock;
}

export interface RequestWorkflowApprovalInput {
  readonly workflowRunId: string;
  readonly organizationId: string;
  readonly workflowId: string;
  readonly nodeId: string;
  readonly branchId?: string;
  readonly branchName?: string;
  /** The actor the run belongs to. Never the person who will decide. */
  readonly requestedBy: string;
  readonly reason: string;
  readonly impactSummary: string;
  readonly estimatedAdditionalTokens: number;
  readonly estimatedAdditionalCostMicroUsd: number;
  /** From the approval NODE. Never from a caller. */
  readonly approverRoles: readonly string[];
  readonly onRejection: WorkflowRejectionPolicy;
  readonly expiresAfterMs: number;
  /**
   * What is being approved (Part 7D, F3).
   *
   * Resolved by the ENGINE from trusted node outputs before this is called — see
   * `contracts/approval.ts`. Absent for an approval node that declares none.
   * This module bounds it and writes it; it never derives one, because deriving
   * it here would mean deriving it from what this module can see, which is the
   * request rather than the run.
   */
  readonly subjectEvidence?: WorkflowApprovalSubjectEvidence;
  /** The position this approval will authorise movement from. */
  readonly checkpointVersion: number;
  readonly workflowRunVersion: number;
  readonly branchVersion?: number;
}

export interface WorkflowApprovalDecisionInput {
  readonly organizationId: string;
  readonly workflowApprovalId: string;
  readonly decision: WorkflowApprovalDecision;
  readonly reason: string;
  readonly deciderId: string;
  /** Roles resolved server-side from the authenticated subject. */
  readonly deciderRoles: readonly string[];
}

export interface WorkflowApprovalGate {
  /** Create, or adopt, a pending request. Written before the run is parked. */
  request(input: RequestWorkflowApprovalInput): Promise<WorkflowApprovalRecord>;
  /** Record a decision. Refuses a stale, expired, decided or unauthorised one. */
  decide(input: WorkflowApprovalDecisionInput): Promise<WorkflowApprovalRecord>;
  /**
   * Spend an approved request on one position, once.
   *
   * Refuses anything that is not `approved`, and anything whose binding no
   * longer matches the run — see `contracts/approval.ts` for why the binding
   * differs between the main line and a branch.
   */
  consume(
    organizationId: string,
    workflowApprovalId: string,
    binding: WorkflowApprovalBinding,
  ): Promise<WorkflowApprovalRecord>;
  /** Read one, tenant-scoped. */
  get(
    organizationId: string,
    workflowApprovalId: string,
  ): Promise<WorkflowApprovalRecord | undefined>;
  /** Read one, or refuse. The engine's form — a parked run must find its request. */
  require(
    organizationId: string,
    workflowApprovalId: string,
  ): Promise<WorkflowApprovalRecord>;
  /**
   * Read a tenant's approvals, oldest first.
   *
   * ONE listing method rather than a `pending` and a `forRun` that would
   * eventually disagree about what a combined filter means. `pending` below is
   * the queue shorthand every caller actually wants, built on this.
   */
  list(query: WorkflowApprovalQuery): Promise<readonly WorkflowApprovalRecord[]>;
  /** The operator queue for one organization, oldest first. */
  pending(organizationId: string, limit?: number): Promise<readonly WorkflowApprovalRecord[]>;
  /**
   * Mark an overdue request expired, durably.
   *
   * Called when a parked run is advanced or read. Expiry is derived from the
   * stamp rather than driven by a timer: a sweeper that has to be scheduled is
   * a sweeper that is not running in the deployment where it matters. EXPIRY IS
   * NEVER APPROVAL — this returns an `expired` record and nothing else.
   */
  expireIfDue(record: WorkflowApprovalRecord): Promise<WorkflowApprovalRecord>;
  /**
   * Close a pending request whose run has ended.
   *
   * A cancelled or expired run can never spend its approval, and leaving the
   * request pending would leave an undecidable question at the top of an
   * operator's queue forever. `withdrawn` rather than `rejected` because nobody
   * rejected it, and rather than `expired` because its deadline had not passed.
   */
  withdraw(
    record: WorkflowApprovalRecord,
    reason: string,
  ): Promise<WorkflowApprovalRecord>;
}

export function createWorkflowApprovalGate(
  deps: WorkflowApprovalGateDependencies,
): WorkflowApprovalGate {
  const { store, clock } = deps;

  function isDue(record: WorkflowApprovalRecord, nowMs: number): boolean {
    const expiresMs = Date.parse(record.expiresAt);
    // An unreadable stamp is NOT treated as expired. Guessing would turn a
    // corrupt field into a run that dies for no reason; the run's own deadline
    // still bounds it, so the conservative direction is safe.
    return Number.isFinite(expiresMs) && expiresMs <= nowMs;
  }

  /**
   * The two ways a request closes WITHOUT an answer.
   *
   * The parameter is `approvalState` rather than `state` for the reason
   * `contracts/approval.ts` gives: a run has a `state`, a branch has a `state`,
   * and a third meaning of the word here would make the boundary scan's
   * "workflow run state is assigned in exactly one place" assertion unable to
   * tell a closed request from a terminated run.
   */
  async function close(
    record: WorkflowApprovalRecord,
    approvalState: 'expired' | 'withdrawn',
    reason: string,
  ): Promise<WorkflowApprovalRecord> {
    const closed: WorkflowApprovalRecord = {
      ...record,
      approvalState,
      closureReason: reason.slice(0, WORKFLOW_APPROVAL_BOUNDS.decisionReason.max),
      // NEITHER CLOSURE IS A DECISION. `decision`, `decidedBy` and
      // `decisionReason` are untouched and stay absent, so no reader can
      // mistake a timed-out request for one somebody answered.
      failure: approvalState === 'expired' ? 'workflow_approval_expired' : undefined,
      approvalVersion: record.approvalVersion + 1,
    };
    await store.save(closed, record.approvalVersion);
    return closed;
  }

  function bounded(value: string, max: number): string {
    return value.trim().slice(0, max);
  }

  /**
   * Subject evidence, checked rather than coerced (Part 7D, F3).
   *
   * `bounded()` above trims prose, which is right for prose. Evidence is not
   * prose: a `contentDigest` that has been cut to fit is a value that matches no
   * content at all, and a `subjectId` that has been cut names a different
   * subject. Both would produce a queue entry that looks authoritative and is
   * not, so the request is REFUSED instead. The engine has already bounded these
   * — this is the second of the two checks, in the module that writes the record.
   */
  function boundedEvidence(
    evidence: WorkflowApprovalSubjectEvidence | undefined,
    workflowApprovalId: string,
  ): WorkflowApprovalSubjectEvidence | undefined {
    if (evidence === undefined) return undefined;
    const bounds = WORKFLOW_APPROVAL_BOUNDS.subjectEvidence;
    const subjectId = evidence.subjectId?.trim() ?? '';
    const contentDigest = evidence.contentDigest?.trim() ?? '';
    if (
      subjectId === '' ||
      contentDigest === '' ||
      subjectId.length > bounds.subjectId ||
      contentDigest.length > bounds.contentDigest
    ) {
      throw workflowFailure(
        'workflow_invalid_definition',
        'This approval could not say what it is about.',
        {
          diagnostics:
            `approval ${workflowApprovalId} carries subject evidence that is empty or ` +
            'longer than an identifier may be',
        },
      );
    }
    return { subjectId, contentDigest };
  }

  function estimate(value: number): number {
    const bounds = WORKFLOW_APPROVAL_BOUNDS.estimate;
    if (!Number.isFinite(value)) return bounds.min;
    return Math.min(bounds.max, Math.max(bounds.min, Math.floor(value)));
  }

  /**
   * Does this approval still authorise movement from where the run now is?
   *
   * A branch approval is judged on `branchVersion` alone; a main-line one on
   * `checkpointVersion` AND `workflowRunVersion`. See `contracts/approval.ts`
   * for why a sibling branch legitimately moves the two run-wide numbers while
   * this branch sits untouched, and why enforcing them there would make branch
   * approvals unspendable by design rather than by defect.
   */
  function bindingMismatch(
    record: WorkflowApprovalRecord,
    binding: WorkflowApprovalBinding,
  ): string | undefined {
    if (record.nodeId !== binding.nodeId) {
      return `approval authorises node ${record.nodeId}, not ${binding.nodeId}`;
    }
    if ((record.branchId ?? undefined) !== (binding.branchId ?? undefined)) {
      return (
        `approval authorises branch ${record.branchId ?? 'main'}, ` +
        `not ${binding.branchId ?? 'main'}`
      );
    }

    if (record.branchId !== undefined) {
      if (record.branchVersion !== binding.branchVersion) {
        return (
          `approval authorises branch version ${String(record.branchVersion)}, ` +
          `branch is at ${String(binding.branchVersion)}`
        );
      }
      return undefined;
    }

    if (record.checkpointVersion !== binding.checkpointVersion) {
      return (
        `approval authorises checkpoint ${record.checkpointVersion}, ` +
        `run is at ${binding.checkpointVersion}`
      );
    }
    if (record.workflowRunVersion !== binding.workflowRunVersion) {
      return (
        `approval authorises run version ${record.workflowRunVersion}, ` +
        `run is at ${binding.workflowRunVersion}`
      );
    }
    return undefined;
  }

  return {
    async request(input) {
      const workflowApprovalId = workflowApprovalIdFor(
        input.workflowRunId,
        input.nodeId,
        input.branchId,
        input.checkpointVersion,
      );

      // ADOPT OR REFUSE, never overwrite. The id is a pure function of durable
      // facts, so an existing record here is this same request made again by an
      // advance that died before it could park the run. Still pending means the
      // previous attempt got exactly this far and the work is already done;
      // anything else means the question has been answered or closed, and a run
      // asking it a second time from the same position is a replay.
      const existing = await store.load(input.organizationId, workflowApprovalId);
      if (existing) {
        if (existing.approvalState === 'pending') return existing;
        throw workflowFailure(
          'workflow_approval_conflict',
          'That approval has already been decided.',
          {
            workflowRunId: input.workflowRunId,
            nodeId: input.nodeId,
            diagnostics:
              `approval ${workflowApprovalId} is ${existing.approvalState} and ` +
              'cannot be requested again from the same position',
          },
        );
      }

      const subjectEvidence = boundedEvidence(input.subjectEvidence, workflowApprovalId);

      const createdAtMs = clock.now();
      const expiresAfterMs = Math.min(
        WORKFLOW_APPROVAL_BOUNDS.expiresAfterMs.max,
        Math.max(
          WORKFLOW_APPROVAL_BOUNDS.expiresAfterMs.min,
          Math.floor(
            Number.isFinite(input.expiresAfterMs)
              ? input.expiresAfterMs
              : WORKFLOW_APPROVAL_BOUNDS.expiresAfterMs.default,
          ),
        ),
      );

      const record: WorkflowApprovalRecord = {
        workflowApprovalId,
        workflowRunId: input.workflowRunId,
        organizationId: input.organizationId,
        workflowId: input.workflowId,
        nodeId: input.nodeId,
        ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
        ...(input.branchName === undefined ? {} : { branchName: input.branchName }),
        requestedBy: input.requestedBy,
        reason: bounded(input.reason, WORKFLOW_APPROVAL_BOUNDS.reason.max),
        impactSummary: bounded(
          input.impactSummary,
          WORKFLOW_APPROVAL_BOUNDS.impactSummary.max,
        ),
        estimatedAdditionalTokens: estimate(input.estimatedAdditionalTokens),
        estimatedAdditionalCostMicroUsd: estimate(input.estimatedAdditionalCostMicroUsd),
        // From the approval NODE, lower-cased and frozen. Reading it live at
        // decision time would let a definition edited while a request was
        // pending widen who may answer it.
        authorizedRoles: [
          ...new Set(
            input.approverRoles
              .map((role) => role.trim().toLowerCase())
              .filter((role) => role !== ''),
          ),
        ]
          .slice(0, WORKFLOW_APPROVAL_BOUNDS.approverRoles.max)
          .sort(),
        // WHAT is being approved. Written verbatim from what the engine
        // resolved, and REFUSED rather than trimmed if it does not fit: a
        // truncated digest matches nothing, so an approval carrying one would
        // be an approval no commit could ever satisfy — and it would look
        // exactly like a valid one in the queue.
        ...(subjectEvidence === undefined ? {} : { subjectEvidence }),
        checkpointVersion: input.checkpointVersion,
        workflowRunVersion: input.workflowRunVersion,
        ...(input.branchVersion === undefined ? {} : { branchVersion: input.branchVersion }),
        createdAt: clock.isoNow(),
        expiresAt: new Date(createdAtMs + expiresAfterMs).toISOString(),
        singleUse: true,
        approvalState: 'pending',
        onRejection: input.onRejection,
        // Version 1; version 0 is the store's way of saying "nothing is here",
        // and no stored approval ever carries it.
        approvalVersion: 1,
      };

      await store.create(record);
      return record;
    },

    async decide(input) {
      const reason = input.reason?.trim() ?? '';
      const bounds = WORKFLOW_APPROVAL_BOUNDS.decisionReason;
      if (reason.length < bounds.min || reason.length > bounds.max) {
        throw workflowFailure(
          'workflow_invalid_definition',
          'An approval decision needs a reason.',
          { diagnostics: `decision reason length ${reason.length} is outside the permitted range` },
        );
      }

      const stored = await store.load(input.organizationId, input.workflowApprovalId);
      if (!stored) {
        // A request in another tenant is indistinguishable from one that does
        // not exist, and that is the point: a caller must not be able to probe
        // for the existence of another organization's decisions.
        throw workflowFailure('workflow_approval_not_found', 'That approval is not available.', {
          diagnostics:
            `approval ${input.workflowApprovalId} not found for ${input.organizationId}`,
        });
      }
      if (stored.organizationId !== input.organizationId) {
        throw workflowFailure(
          'workflow_tenant_isolation_violation',
          'That approval belongs to another organization.',
          {
            workflowRunId: stored.workflowRunId,
            diagnostics: 'approval organization mismatch',
          },
        );
      }

      // AUTHORITY BEFORE EVERYTHING ELSE. See the header for why an
      // unauthorised caller must not learn the request's state.
      const authorised = input.deciderRoles.some((role) =>
        stored.authorizedRoles.includes(role.trim().toLowerCase()),
      );
      if (!authorised) {
        throw workflowFailure(
          'workflow_approval_unauthorized',
          'Your role may not decide this approval.',
          {
            workflowRunId: stored.workflowRunId,
            nodeId: stored.nodeId,
            diagnostics:
              `decider=${input.deciderId} roles=${input.deciderRoles.join(',') || 'none'} ` +
              `required=${stored.authorizedRoles.join(',')}`,
          },
        );
      }

      if (stored.approvalState === 'pending' && isDue(stored, clock.now())) {
        // Persist the expiry before refusing, so the queue stops offering a
        // decision that can no longer be made.
        const expired = await close(stored, 'expired', 'The decision window closed.');
        throw workflowFailure(
          'workflow_approval_expired',
          'That approval request has expired.',
          {
            workflowRunId: expired.workflowRunId,
            nodeId: expired.nodeId,
            diagnostics: `approval ${expired.workflowApprovalId} expired at ${expired.expiresAt}`,
          },
        );
      }

      if (stored.approvalState !== 'pending') {
        throw workflowFailure(
          'workflow_approval_conflict',
          'That approval has already been decided.',
          {
            workflowRunId: stored.workflowRunId,
            nodeId: stored.nodeId,
            diagnostics: `approval ${stored.workflowApprovalId} is ${stored.approvalState}`,
          },
        );
      }

      const decided: WorkflowApprovalRecord = {
        ...stored,
        approvalState: input.decision === 'approve' ? 'approved' : 'rejected',
        decision: input.decision,
        decidedAt: clock.isoNow(),
        decidedBy: input.deciderId,
        decisionReason: reason,
        ...(input.decision === 'reject' ? { failure: 'workflow_approval_rejected' } : {}),
        approvalVersion: stored.approvalVersion + 1,
      };
      // A lost compare-and-swap here is two people deciding at once. The store
      // raises `stale_workflow_approval`; the caller re-reads and finds the
      // decision that won, which is the correct outcome — not a merge.
      await store.save(decided, stored.approvalVersion);
      return decided;
    },

    async consume(organizationId, workflowApprovalId, binding) {
      const stored = await store.load(organizationId, workflowApprovalId);
      if (!stored) {
        throw workflowFailure('workflow_approval_not_found', 'That approval is not available.', {
          diagnostics: `approval ${workflowApprovalId} not found for ${organizationId}`,
        });
      }

      // THE BINDING FIRST. An approval granted for a position the run has left
      // is stale whatever its state, and reporting "already consumed" for a
      // decision that was in fact granted somewhere else would send an operator
      // looking for a replay that never happened.
      const mismatch = bindingMismatch(stored, binding);
      if (mismatch) {
        throw workflowFailure(
          'stale_workflow_approval',
          'That approval no longer matches this run.',
          {
            workflowRunId: stored.workflowRunId,
            nodeId: stored.nodeId,
            diagnostics: mismatch,
          },
        );
      }

      if (stored.approvalState === 'pending' && isDue(stored, clock.now())) {
        const expired = await close(stored, 'expired', 'The decision window closed.');
        throw workflowFailure(
          'workflow_approval_expired',
          'That approval expired before it was used.',
          {
            workflowRunId: expired.workflowRunId,
            nodeId: expired.nodeId,
            diagnostics: `approval ${workflowApprovalId} expired at ${expired.expiresAt}`,
          },
        );
      }

      if (stored.approvalState === 'rejected') {
        throw workflowFailure('workflow_approval_rejected', 'That step was rejected.', {
          workflowRunId: stored.workflowRunId,
          nodeId: stored.nodeId,
          diagnostics: `approval ${workflowApprovalId} was rejected`,
        });
      }
      if (stored.approvalState === 'consumed') {
        // REPLAY. The binding matched, so this is either a crashed advance
        // re-driving the same release — which the engine handles by checking
        // the binding itself before it calls here — or a genuine second spend.
        // Either way this method does not spend it twice.
        throw workflowFailure(
          'workflow_approval_conflict',
          'That approval has already been used.',
          {
            workflowRunId: stored.workflowRunId,
            nodeId: stored.nodeId,
            diagnostics: `approval ${workflowApprovalId} was consumed at ${String(stored.consumedAt)}`,
          },
        );
      }
      if (stored.approvalState !== 'approved') {
        throw workflowFailure(
          'workflow_approval_conflict',
          'That step has not been approved.',
          {
            workflowRunId: stored.workflowRunId,
            nodeId: stored.nodeId,
            diagnostics: `approval ${workflowApprovalId} is ${stored.approvalState}`,
          },
        );
      }

      const consumed: WorkflowApprovalRecord = {
        ...stored,
        approvalState: 'consumed',
        consumedAt: clock.isoNow(),
        approvalVersion: stored.approvalVersion + 1,
      };
      // THE SINGLE-USE GUARANTEE, and it is this line. Two advances racing to
      // spend one approval both read version N and both write N+1; the store
      // lets exactly one win, and the loser is told the approval moved.
      await store.save(consumed, stored.approvalVersion);
      return consumed;
    },

    get: (organizationId, workflowApprovalId) => store.load(organizationId, workflowApprovalId),

    async require(organizationId, workflowApprovalId) {
      const stored = await store.load(organizationId, workflowApprovalId);
      if (!stored) {
        throw workflowFailure('workflow_approval_not_found', 'That approval is not available.', {
          diagnostics: `approval ${workflowApprovalId} not found for ${organizationId}`,
        });
      }
      return stored;
    },

    list: (query) => store.list(query),

    pending: (organizationId, limit) =>
      store.list({
        organizationId,
        pendingOnly: true,
        ...(limit === undefined ? {} : { limit }),
      }),

    async expireIfDue(record) {
      if (record.approvalState !== 'pending' || !isDue(record, clock.now())) return record;
      return close(record, 'expired', 'The decision window closed.');
    },

    async withdraw(record, reason) {
      if (record.approvalState !== 'pending') return record;
      return close(record, 'withdrawn', reason);
    },
  };
}
