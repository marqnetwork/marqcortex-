/**
 * Semantic fingerprints over a tenant's workflow records (BP-004 / A2).
 *
 * ── WHY A BYTE COMPARISON IS NOT AVAILABLE ─────────────────────────────────
 *
 * When a tenant identifier moves, four things are REQUIRED to change: the
 * organization id, every checkpoint digest, every `previousDigest`, and the
 * run's `checkpointDigest` pointer. A byte comparison of source and transformed
 * records would therefore fail for every correctly migrated tenant and pass for
 * none — it would be a check that can only ever report the thing that is meant
 * to happen.
 *
 * So there are two fingerprints, and which one is used is decided by whether
 * the identifier moved rather than by what the operator would like to prove.
 *
 *   EXACT                 every field, verbatim. Used when the source tenant is
 *                         already the target UUID, where the correct number of
 *                         changed fields is ZERO and any difference at all is a
 *                         defect.
 *
 *   MIGRATION-SEMANTIC    the four fields above, and ONLY those four, replaced
 *                         by a marker. Everything else — state, versions,
 *                         outputs, outputsDigest, loop and visit counters, the
 *                         parallel summary, step and transition history, usage,
 *                         input, timestamps, approval decisions, identifiers —
 *                         compares verbatim.
 *
 * ── THIS IS NOT "THE SAME BYTES", AND IT IS NOT CALLED THAT ────────────────
 *
 * A matching migration-semantic fingerprint proves DETERMINISTIC MIGRATION-
 * SEMANTIC EQUIVALENCE: the transformed records carry the same domain facts,
 * and every field whose value differs differs because the tenant translation
 * forced it to. It does not prove the bytes are equal, and a report that said
 * so would be claiming a stronger result than the evidence supports.
 *
 * ── PRESENT AND ABSENT ARE DIFFERENT, AND THE MARKER PRESERVES THAT ────────
 *
 * An elided field that was ABSENT stays absent rather than becoming the marker.
 * Without that, a transformation that ADDED a `checkpointDigest` to a run that
 * never had one, or a `previousDigest` to the first link in a chain, would
 * fingerprint identically to one that did not — and both are exactly the kind
 * of mistake a re-chaining algorithm makes.
 *
 * ── NO BUSINESS CONTENT LEAVES THIS MODULE ─────────────────────────────────
 *
 * The projection is hashed, never returned. What a caller receives is a digest
 * and a mode, so a readiness manifest can prove equivalence without carrying a
 * copy of any tenant's workflow inputs, outputs or approval evidence.
 */

import type { WorkflowRunRecord } from '../../contracts/run.ts';
import type { WorkflowCheckpoint } from '../../contracts/checkpoint.ts';
import type { WorkflowApprovalRecord } from '../../contracts/approval.ts';
import { canonicalJson, digestText } from '../../../agents/runtime/digest.ts';
import type { FingerprintMode, WorkflowFingerprint } from './contracts.ts';

/**
 * The marker an elided field becomes.
 *
 * It cannot collide with a real value: `ORGANIZATION_ID` in
 * `security/tenancy.ts` admits neither `<` nor `>`, and every digest this
 * platform stores is lower-case hex from `digestText`.
 */
const ELIDED = '<elided-for-migration-semantic-comparison>';

/** What a fingerprint is taken over. Runs with everything that points at them. */
export interface FingerprintableBundle {
  readonly run: WorkflowRunRecord;
  readonly checkpoints: readonly WorkflowCheckpoint[];
  readonly approvals: readonly WorkflowApprovalRecord[];
}

function projectRun(run: WorkflowRunRecord, mode: FingerprintMode): unknown {
  if (mode === 'exact') return run;
  return {
    ...run,
    context: { ...run.context, organizationId: ELIDED },
    ...(run.checkpointDigest === undefined ? {} : { checkpointDigest: ELIDED }),
  };
}

function projectCheckpoint(checkpoint: WorkflowCheckpoint, mode: FingerprintMode): unknown {
  if (mode === 'exact') return checkpoint;
  return {
    ...checkpoint,
    organizationId: ELIDED,
    digest: ELIDED,
    ...(checkpoint.previousDigest === undefined ? {} : { previousDigest: ELIDED }),
  };
}

function projectApproval(approval: WorkflowApprovalRecord, mode: FingerprintMode): unknown {
  if (mode === 'exact') return approval;
  return { ...approval, organizationId: ELIDED };
}

/**
 * A fingerprint over a tenant's whole record set.
 *
 * Ordered deterministically here rather than trusting the caller: a fingerprint
 * that moved with the order rows happened to arrive in would report a
 * difference every time a listing was planned differently, and a check that
 * cries wolf is a check that gets switched off.
 */
export function fingerprintBundles(
  bundles: readonly FingerprintableBundle[],
  mode: FingerprintMode,
): WorkflowFingerprint {
  const projection = [...bundles]
    .sort((a, b) =>
      a.run.context.workflowRunId < b.run.context.workflowRunId
        ? -1
        : a.run.context.workflowRunId > b.run.context.workflowRunId
          ? 1
          : 0,
    )
    .map((bundle) => ({
      run: projectRun(bundle.run, mode),
      checkpoints: [...bundle.checkpoints]
        .sort((a, b) => a.version - b.version)
        .map((checkpoint) => projectCheckpoint(checkpoint, mode)),
      approvals: [...bundle.approvals]
        .sort((a, b) =>
          a.workflowApprovalId < b.workflowApprovalId
            ? -1
            : a.workflowApprovalId > b.workflowApprovalId
              ? 1
              : 0,
        )
        .map((approval) => projectApproval(approval, mode)),
    }));

  // `canonicalJson` sorts object keys and bounds depth and size, so the digest
  // is a function of the CONTENT rather than of how the objects were built.
  const canonical = canonicalJson(projection);
  if (canonical === undefined) {
    // Unserializable here means a record the platform could not have stored, so
    // it is a refusal rather than a digest over a substitute value. A
    // fingerprint that silently stood in for "we could not read this" would
    // compare equal to another unreadable record set.
    throw new Error('workflow migration fingerprint projection could not be serialized');
  }
  return { mode, digest: digestText(canonical) };
}

export type FingerprintVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly problem: string };

/**
 * Compare a source fingerprint with a transformed one.
 *
 * Both must have been taken under the SAME mode, and that is checked rather
 * than assumed: comparing an exact fingerprint with a migration-semantic one
 * would report a difference that means nothing, and comparing two fingerprints
 * whose modes were chosen independently is how a weaker check quietly replaces
 * a stronger one.
 */
export function compareFingerprints(
  source: WorkflowFingerprint,
  transformed: WorkflowFingerprint,
): FingerprintVerdict {
  if (source.mode !== transformed.mode) {
    return {
      ok: false,
      problem: `fingerprints were taken under different modes: ${source.mode} and ${transformed.mode}`,
    };
  }
  if (source.digest !== transformed.digest) {
    return {
      ok: false,
      problem:
        source.mode === 'exact'
          ? 'the records changed although the tenant identifier did not'
          : 'a domain field changed that the tenant translation does not require',
    };
  }
  return { ok: true };
}
