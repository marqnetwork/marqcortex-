/**
 * Deterministic record transformation and checkpoint re-chaining (BP-004 / A2).
 *
 * ── THE FACT THIS WHOLE MODULE EXISTS FOR ──────────────────────────────────
 *
 * `computeCheckpointDigest` includes `organizationId`. So does every digest
 * after it, because each link carries `previousDigest`. Therefore:
 *
 *   CHANGING A TENANT IDENTIFIER CHANGES EVERY CHECKPOINT DIGEST IN THE RUN.
 *
 * A backfill that rewrote `organizationId` and left the digests alone would
 * produce a chain that fails `verifyChain` on the first link it reached — and
 * the place that failure would surface is RESTART RECOVERY, on a live run,
 * after the cutover, with the original rows already considered migrated. The
 * corruption would be silent until the moment it was unrecoverable.
 *
 * So a remapped run is re-chained in version order, from the first link:
 *
 *   1. the SOURCE chain is verified before anything is computed;
 *   2. `organizationId` becomes the target UUID;
 *   3. version 1 keeps no `previousDigest`;
 *   4. version N takes the TRANSFORMED predecessor's digest;
 *   5. `digest` is recomputed with the ENGINE'S OWN `computeCheckpointDigest`;
 *   6. the run's `checkpointDigest` moves to the transformed tip.
 *
 * ── AND THE REFUSAL THAT MATTERS MORE THAN THE ALGORITHM ───────────────────
 *
 * A source chain that does not verify is NEVER re-chained. Re-chaining it would
 * MANUFACTURE a valid-looking chain over content whose integrity is already in
 * doubt — a preflight that turned evidence of tampering into a clean digest
 * would be the single worst thing this packet could ship. Such a tenant is
 * refused, and stays refused until the corruption is resolved somewhere else.
 *
 * ── WHAT MAY NOT CHANGE ────────────────────────────────────────────────────
 *
 * Every checkpoint field below is copied across explicitly rather than
 * rewritten, so "what a tenant translation is allowed to touch" is readable as
 * code: run id, version, state, node, cursor, step count, outputs,
 * outputsDigest, loop iterations, node visits, the parallel summary and
 * timestamps all travel untouched. Outputs are NOT re-digested — the stored
 * `outputsDigest` is carried, so a transformation cannot quietly bless outputs
 * that did not match their digest at source.
 *
 * An explicit construction can only drop a field that is added to the contract
 * later and never noticed. The migration-semantic fingerprint in
 * `fingerprint.ts` is the runtime backstop for exactly that: a dropped field
 * changes the fingerprint and the tenant is refused.
 *
 * ── CARRIED FINDING: A REMAP CAN CHANGE A FUTURE BRANCH ───────────────────
 *
 * `contracts/expression.ts` lists `organizationId` in `WORKFLOW_METADATA_FIELDS`,
 * so a workflow CONDITION may branch on it. Nothing stored changes shape
 * because of that — the records this module emits are proven equivalent by the
 * migration-semantic fingerprint, and already-recorded outputs are identical —
 * but a definition that compares `organizationId` to a literal would evaluate
 * DIFFERENTLY after a remap, on the next node it reaches.
 *
 * That is outside what a record transformation can fix, and BP-004 does not
 * attempt it. It is recorded here because the packet that performs a cutover
 * has to scan the registered definitions for that reference before remapping
 * any tenant, and a finding that lives only in a report is a finding the next
 * author does not have.
 *
 * ── APPROVALS KEEP THEIR IDENTIFIERS ───────────────────────────────────────
 *
 * `workflowApprovalIdFor` derives an approval id from the run id, the node, the
 * branch and the checkpoint version. It does NOT bind the organization, so a
 * tenant translation cannot change it, and inventing a new id would break the
 * idempotent re-request the gate depends on. `organizationId` is the only field
 * an approval gives up.
 */

import type { WorkflowRunRecord } from '../../contracts/run.ts';
import type { WorkflowCheckpoint } from '../../contracts/checkpoint.ts';
import type { WorkflowApprovalRecord } from '../../contracts/approval.ts';
import { computeCheckpointDigest, verifyChain } from '../../runtime/checkpointChain.ts';
import type { WorkflowRunBundle } from './inventory.ts';
import { isTransformableBundle } from './inventory.ts';

/** One checkpoint's digest, before and after. Evidence, not a lookup table. */
export interface CheckpointDigestMapping {
  readonly workflowRunId: string;
  readonly version: number;
  readonly sourceDigest: string;
  readonly transformedDigest: string;
}

export interface TransformedBundle {
  readonly run: WorkflowRunRecord;
  readonly checkpoints: readonly WorkflowCheckpoint[];
  readonly approvals: readonly WorkflowApprovalRecord[];
  readonly digestMap: readonly CheckpointDigestMapping[];
}

export type TransformVerdict =
  | { readonly ok: true; readonly bundles: readonly TransformedBundle[] }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * The transformed body of one checkpoint, with its digest not yet taken.
 *
 * Field by field on purpose. See the header.
 */
function rechainBody(
  checkpoint: WorkflowCheckpoint,
  organizationId: string,
  previousDigest: string | undefined,
): Omit<WorkflowCheckpoint, 'digest'> {
  return {
    workflowRunId: checkpoint.workflowRunId,
    organizationId,
    version: checkpoint.version,
    createdAt: checkpoint.createdAt,
    state: checkpoint.state,
    nodeId: checkpoint.nodeId,
    stepCount: checkpoint.stepCount,
    ...(checkpoint.cursorNodeId === undefined ? {} : { cursorNodeId: checkpoint.cursorNodeId }),
    outputs: checkpoint.outputs,
    outputsDigest: checkpoint.outputsDigest,
    loopIterations: checkpoint.loopIterations,
    nodeVisits: checkpoint.nodeVisits,
    parallel: checkpoint.parallel,
    ...(previousDigest === undefined ? {} : { previousDigest }),
  };
}

function transformBundle(
  bundle: WorkflowRunBundle,
  targetOrganizationId: string,
): TransformedBundle {
  const checkpoints: WorkflowCheckpoint[] = [];
  const digestMap: CheckpointDigestMapping[] = [];

  let previousDigest: string | undefined;
  for (const checkpoint of bundle.checkpoints) {
    // Version 1 opens the chain and carries no predecessor, whatever the loop
    // is holding — asserted rather than assumed, because a history that did not
    // start at 1 would otherwise inherit a digest from nowhere. `verifyChain`
    // has already refused such a history; this is the second lock.
    const link = checkpoint.version === 1 ? undefined : previousDigest;
    const body = rechainBody(checkpoint, targetOrganizationId, link);
    const digest = computeCheckpointDigest(body);
    const transformed: WorkflowCheckpoint = { ...body, digest };
    checkpoints.push(transformed);
    digestMap.push({
      workflowRunId: checkpoint.workflowRunId,
      version: checkpoint.version,
      sourceDigest: checkpoint.digest,
      transformedDigest: digest,
    });
    previousDigest = digest;
  }

  const tip = checkpoints[checkpoints.length - 1];
  const run: WorkflowRunRecord = {
    ...bundle.run,
    context: { ...bundle.run.context, organizationId: targetOrganizationId },
    // Absent stays absent. A run with no checkpoints must not acquire a pointer
    // it never had, and the inventory has already refused a run whose pointer
    // and chain disagreed.
    ...(tip === undefined ? {} : { checkpointDigest: tip.digest }),
  };

  const approvals = bundle.approvals.map((approval) => ({
    ...approval,
    organizationId: targetOrganizationId,
  }));

  return { run, checkpoints, approvals, digestMap };
}

/**
 * Transform one tenant's inventoried runs onto a canonical organization.
 *
 * Pure. Given the same bundles and the same target it returns the same records
 * and the same digests, every time, on any machine.
 */
export function transformTenant(
  sourceTenantId: string,
  targetOrganizationId: string,
  bundles: readonly WorkflowRunBundle[],
): TransformVerdict {
  const problems: string[] = [];

  for (const bundle of bundles) {
    if (isTransformableBundle(bundle)) continue;
    problems.push(
      `run ${bundle.run.context.workflowRunId} is not transformable: ${bundle.problems.join('; ')}`,
    );
  }
  // THE REFUSAL, BEFORE ANY DIGEST IS COMPUTED. See the header.
  if (problems.length > 0) return { ok: false, problems };

  // THE IDENTITY CASE. The tenant identifier does not move, so nothing may be
  // recomputed: the records are already the records, and a "transformation"
  // that rebuilt them would be a transformation that could differ from them.
  if (sourceTenantId === targetOrganizationId) {
    return {
      ok: true,
      bundles: bundles.map((bundle) => ({
        run: bundle.run,
        checkpoints: bundle.checkpoints,
        approvals: bundle.approvals,
        digestMap: bundle.checkpoints.map((checkpoint) => ({
          workflowRunId: checkpoint.workflowRunId,
          version: checkpoint.version,
          sourceDigest: checkpoint.digest,
          transformedDigest: checkpoint.digest,
        })),
      })),
    };
  }

  const transformed = bundles.map((bundle) => transformBundle(bundle, targetOrganizationId));

  // ── The transformed chain is verified too ────────────────────────────────
  //
  // The algorithm above is correct by construction and this check is still
  // here, because "correct by construction" is a claim about the code and
  // `verifyChain` is a measurement of the output. They are not the same
  // evidence, and it is the output that a backfill would write.
  for (const bundle of transformed) {
    const verdict = verifyChain(bundle.checkpoints);
    if (!verdict.ok) {
      problems.push(
        `transformed chain for run ${bundle.run.context.workflowRunId} does not verify: ${verdict.problem}`,
      );
      continue;
    }
    const tip = bundle.checkpoints[bundle.checkpoints.length - 1];
    if (tip !== undefined && bundle.run.checkpointDigest !== tip.digest) {
      problems.push(
        `transformed run ${bundle.run.context.workflowRunId} does not point at its transformed tip`,
      );
    }
  }
  if (problems.length > 0) return { ok: false, problems };

  return { ok: true, bundles: transformed };
}
