/**
 * The invalidation engine (AI-01 Batch 3B, Part 6B).
 *
 * ── INVALIDATION IS THE HALF OF CACHING THAT ACTUALLY DECIDES CORRECTNESS ─
 *
 * Storing an answer is easy and reversible. Failing to un-store it when the
 * world moves is neither. Every wrong answer a cache has ever served was stored
 * correctly; what went wrong was that nobody told it something changed.
 *
 * So invalidation here is a first-class operation with six declared scopes,
 * rather than a `delete` somebody remembers to call:
 *
 *   result        One record, by id. The surgical case.
 *   workflow      Everything a workflow produced, optionally at one version.
 *   agent         Everything an agent produced, optionally at one version.
 *   policy        Everything produced under a policy revision.
 *   organization  Everything a tenant holds. The blunt instrument, and the one
 *                 an incident response actually reaches for.
 *   dependency    Everything declaring a `kind:key`, optionally at one version.
 *
 * ── FOUR PROPERTIES, EACH LOAD-BEARING ─────────────────────────────────────
 *
 *   TENANT-SAFE   Every scope carries an organization and the store has no
 *                 unscoped write. An invalidation cannot reach another tenant's
 *                 records because there is no query that returns them.
 *
 *   IDEMPOTENT    Re-running an invalidation stamps nothing new. The first
 *                 stamp's time and reason are the record of what happened, and a
 *                 second call restating them as something else would make the
 *                 audit trail a function of how many times somebody clicked.
 *
 *   RECORDED      The report names every record it stamped and every one it
 *                 found already stamped. "We invalidated the cache" is not an
 *                 audit answer; "we stamped these eleven records with
 *                 policy_changed at this time" is.
 *
 *   REASON-CODED  From a closed vocabulary, because an operator reading
 *                 `invalidationReason` six months later needs it to mean the
 *                 same thing it meant when it was written.
 *
 * ── STAMPED, NOT DELETED ───────────────────────────────────────────────────
 *
 * The store has no delete method. An invalidated record is unusable — the gate
 * refuses it on the integrity dimension — and still readable, because the
 * evidence behind any avoided-call accounting that already cited it has to
 * outlive its usefulness for reuse. Losing eligibility and losing the audit
 * trail are different events and only one of them was asked for.
 */

import type { ReuseDependency } from '../contracts/dependency.ts';
import type {
  ReusableResultRecord,
  ReuseInvalidationReason,
} from '../contracts/reusableResult.ts';
import type { ReusableResultStore } from '../persistence/ports.ts';
import { MAX_SCAN_ROWS } from '../persistence/ports.ts';
import { reuseFailure } from '../contracts/failures.ts';

export type ReuseInvalidationScope =
  | { readonly kind: 'result'; readonly reusableResultId: string }
  | {
      readonly kind: 'workflow';
      readonly workflowId: string;
      /** Absent invalidates every version. */
      readonly workflowVersion?: string;
    }
  | {
      readonly kind: 'agent';
      readonly agentId: string;
      readonly agentVersion?: string;
    }
  | { readonly kind: 'policy'; readonly policyVersion: string }
  | { readonly kind: 'organization' }
  | {
      readonly kind: 'dependency';
      readonly dependency: Pick<ReuseDependency, 'kind' | 'key'>;
      /** Absent invalidates every version declaring the key. */
      readonly version?: string;
    };

export interface ReuseInvalidationCommand {
  readonly organizationId: string;
  readonly scope: ReuseInvalidationScope;
  readonly reason: ReuseInvalidationReason;
  /** Supplied by the caller's clock. This module reads none. */
  readonly at: number;
  /** Who asked. Recorded on the report, never on the record. */
  readonly requestedBy: string;
}

export interface ReuseInvalidationReport {
  readonly organizationId: string;
  readonly scope: ReuseInvalidationScope;
  readonly reason: ReuseInvalidationReason;
  readonly requestedBy: string;
  readonly at: number;
  /** Records considered. */
  readonly scanned: number;
  /** Records this call stamped. */
  readonly invalidated: number;
  /** Records already stamped when this call ran. Idempotency, counted. */
  readonly alreadyInvalidated: number;
  /** The ids this call stamped, sorted. Evidence, not a summary. */
  readonly invalidatedIds: readonly string[];
  /** True when the scan hit its row ceiling and may not have seen everything. */
  readonly truncated: boolean;
}

/** Does a record fall inside a scope? Pure; the store decides what it is given. */
function inScope(record: ReusableResultRecord, scope: ReuseInvalidationScope): boolean {
  switch (scope.kind) {
    case 'result':
      return record.reusableResultId === scope.reusableResultId;
    case 'workflow': {
      if (record.sourceWorkflowId !== scope.workflowId) return false;
      if (scope.workflowVersion === undefined) return true;
      return record.sourceWorkflowVersion === scope.workflowVersion;
    }
    case 'agent': {
      if (record.sourceAgentId !== scope.agentId) return false;
      if (scope.agentVersion === undefined) return true;
      return record.sourceAgentVersion === scope.agentVersion;
    }
    case 'policy':
      // A record is produced under exactly one governance policy version and one
      // optimisation policy version. Either matching is enough: the question the
      // operator asked is "what did this revision touch", and a result computed
      // under a withdrawn optimisation policy is as suspect as one computed
      // under a withdrawn governance policy.
      return (
        record.policyVersion === scope.policyVersion ||
        record.optimizationPolicyVersion === scope.policyVersion
      );
    case 'organization':
      // The store already scoped the scan. Everything it returned is in scope.
      return true;
    case 'dependency': {
      const id = `${scope.dependency.kind}:${scope.dependency.key}`;
      const declared = [...record.evidenceDependencies, ...record.dataDependencies].filter(
        (candidate) => `${candidate.kind}:${candidate.key}` === id,
      );
      if (declared.length === 0) return false;
      if (scope.version === undefined) return true;
      // A version was named: invalidate the records pinned to the OLD version,
      // which are the ones the change made stale. Records already declaring the
      // new version were produced after it and are not affected.
      return declared.some((candidate) => candidate.version === scope.version);
    }
  }
}

/**
 * Collect the records a scope covers.
 *
 * Every path here is tenant-scoped, and there is no branch that widens: the
 * `result` scope is a point read, `dependency` uses the store's indexed listing,
 * and everything else walks the organization's own bounded prefix.
 */
async function collect(
  store: ReusableResultStore,
  command: ReuseInvalidationCommand,
): Promise<{ records: readonly ReusableResultRecord[]; truncated: boolean }> {
  const scope = command.scope;

  if (scope.kind === 'result') {
    const record = await store.getById(command.organizationId, scope.reusableResultId);
    return { records: record === undefined ? [] : [record], truncated: false };
  }

  if (scope.kind === 'dependency') {
    const records = await store.listByDependency(
      command.organizationId,
      scope.dependency,
      MAX_SCAN_ROWS,
    );
    return { records, truncated: records.length >= MAX_SCAN_ROWS };
  }

  const records = await store.findCandidates({
    organizationId: command.organizationId,
    limit: MAX_SCAN_ROWS,
  });
  return { records, truncated: records.length >= MAX_SCAN_ROWS };
}

/**
 * Invalidate everything in scope, and report exactly what happened.
 *
 * The store's own `invalidate` is the idempotency point: it resolves false for a
 * record already stamped and for one that lost a concurrent write, so the counts
 * below are what this call DID rather than what it intended.
 */
export async function invalidateReusableResults(
  store: ReusableResultStore,
  command: ReuseInvalidationCommand,
): Promise<ReuseInvalidationReport> {
  if (typeof command.organizationId !== 'string' || command.organizationId === '') {
    throw reuseFailure(
      'reuse_tenant_mismatch',
      'An invalidation must name the organization it applies to.',
    );
  }
  if (!Number.isFinite(command.at) || command.at <= 0) {
    throw reuseFailure('reuse_input_invalid', 'An invalidation needs a valid time.', {
      diagnostics: `at=${String(command.at)}`,
    });
  }

  const { records, truncated } = await collect(store, command);

  let scanned = 0;
  let invalidated = 0;
  let alreadyInvalidated = 0;
  const invalidatedIds: string[] = [];

  for (const record of records) {
    if (record.organizationId !== command.organizationId) continue;
    if (!inScope(record, command.scope)) continue;
    scanned += 1;

    if (record.invalidatedAt !== undefined) {
      alreadyInvalidated += 1;
      continue;
    }
    const stamped = await store.invalidate(
      command.organizationId,
      record.reusableResultId,
      command.at,
      command.reason,
    );
    if (stamped) {
      invalidated += 1;
      invalidatedIds.push(record.reusableResultId);
    } else {
      // Lost a race with another invalidation, or was stamped between the read
      // and the write. Either way it is now invalid and this call did not do it.
      alreadyInvalidated += 1;
    }
  }

  return {
    organizationId: command.organizationId,
    scope: command.scope,
    reason: command.reason,
    requestedBy: command.requestedBy,
    at: Math.floor(command.at),
    scanned,
    invalidated,
    alreadyInvalidated,
    invalidatedIds: invalidatedIds.sort(),
    truncated,
  };
}
