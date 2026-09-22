/**
 * Read-only source inventory over workflow key-value rows (BP-004 / A2).
 *
 * ── IT REPRODUCES THE PRODUCTION READER, IT DOES NOT IMPROVE ON IT ─────────
 *
 * `kvWorkflowStores.ts` coerces a stored value from an object OR a JSON string,
 * and refuses a record that does not carry its identity and its version. This
 * module applies THE SAME coercion and THE SAME four-field structural check,
 * because an inventory that were more permissive would count rows production
 * cannot read, and one that were stricter would report defects production does
 * not have. Either way the number would be about this file rather than about
 * the data.
 *
 * ── IT NEVER REPAIRS ───────────────────────────────────────────────────────
 *
 * Every defect is reported with the key that produced it and the row is left
 * exactly as it was found. There is no writer in this module and no path that
 * returns a corrected row: a preflight that silently fixed its own input would
 * be reporting on a snapshot that never existed, and the fix would then have to
 * be reproduced — by hand, under time pressure — during the real cutover.
 *
 * ── THE ENVELOPE IS LIFTED OFF HERE, AND ONLY THE ENVELOPE ─────────────────
 *
 * The key-value stores write `{...record, _schema: 'ai.workflow.run.v1'}`. The
 * marker is a STORAGE envelope: the engine never sets it, the domain contracts
 * do not declare it, and the SQL stores would never write it. So it is verified
 * and then removed, and what travels onward is the domain record.
 *
 * That removal is provably not a domain change: `computeCheckpointDigest`
 * projects named fields and `_schema` is not one of them, so no digest moves.
 * `migration/__tests__` pins both halves of that claim.
 *
 * ── WHY THE KEY IS PARSED FROM BOTH ENDS RATHER THAN SPLIT ─────────────────
 *
 * `SAFE_KEY_SEGMENT` in `security/tenancy.ts` ALLOWS a colon inside a segment,
 * and the platform uses that: a workflow approval id is
 * `wfa:{runId}:{nodeId}:{branch}:{checkpointVersion}`. Splitting a key on `:`
 * would therefore shred every approval key in the estate and report the whole
 * namespace as malformed. The tenant and the namespace are read from the front,
 * where colons are structural, and a checkpoint's padded version is read from
 * the back, where it is fixed width.
 */

import type { WorkflowRunRecord, WorkflowRunState } from '../../contracts/run.ts';
import type { WorkflowCheckpoint } from '../../contracts/checkpoint.ts';
import type { WorkflowApprovalRecord } from '../../contracts/approval.ts';
import { WORKFLOW_RUN_STATES, isTerminalWorkflowState } from '../../contracts/run.ts';
import { verifyChain } from '../../runtime/checkpointChain.ts';
import { sortWorkflowApprovals } from '../ports.ts';
import type {
  ActiveRunCensus,
  WorkflowInventoryRow,
  WorkflowRowClassification,
  WorkflowSourceKind,
  WorkflowSourceRow,
} from './contracts.ts';
import {
  CHECKPOINT_VERSION_WIDTH,
  SCHEMA_MARKER_FIELD,
  WORKFLOW_SOURCE_NAMESPACE,
  WORKFLOW_SOURCE_SCHEMA,
  isBlockingClassification,
} from './contracts.ts';

// ── Grammar, borrowed rather than re-invented ──────────────────────────────

/**
 * The same two patterns `security/tenancy.ts` enforces when it BUILDS a key.
 *
 * Restated here rather than imported because importing them would mean this
 * folder reaching into the security tree for a regular expression, and the two
 * files would then have to be kept in step in one direction only. They are
 * pinned equal by a test instead, which catches drift in both directions.
 */
const ORGANIZATION_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const SAFE_KEY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const KEY_PREFIX = 'org:';
const NAMESPACE_PREFIX = 'ai:';

const NAMESPACE_TO_KIND: Readonly<Record<string, WorkflowSourceKind>> = {
  [WORKFLOW_SOURCE_NAMESPACE.run]: 'run',
  [WORKFLOW_SOURCE_NAMESPACE.checkpoint]: 'checkpoint',
  [WORKFLOW_SOURCE_NAMESPACE.approval]: 'approval',
};

// ── Key parsing ─────────────────────────────────────────────────────────────

interface ParsedKey {
  readonly kind: WorkflowSourceKind;
  readonly sourceTenantId: string;
  readonly identity: string;
  readonly version?: number;
}

type KeyVerdict =
  | { readonly ok: true; readonly parsed: ParsedKey }
  | { readonly ok: false; readonly classification: 'invalid_key' | 'unknown_workflow_namespace'; readonly detail: string };

export function parseWorkflowSourceKey(key: string): KeyVerdict {
  const unknown = (detail: string): KeyVerdict => ({
    ok: false,
    classification: 'unknown_workflow_namespace',
    detail,
  });
  const invalid = (detail: string): KeyVerdict => ({
    ok: false,
    classification: 'invalid_key',
    detail,
  });

  if (!key.startsWith(KEY_PREFIX)) return unknown('key does not open with the tenant prefix');
  const afterPrefix = key.slice(KEY_PREFIX.length);

  const tenantEnd = afterPrefix.indexOf(':');
  if (tenantEnd < 0) return unknown('key carries no namespace segment');
  const sourceTenantId = afterPrefix.slice(0, tenantEnd);
  const afterTenant = afterPrefix.slice(tenantEnd + 1);

  if (!afterTenant.startsWith(NAMESPACE_PREFIX)) return unknown('key is not in the AI namespace');
  const afterAi = afterTenant.slice(NAMESPACE_PREFIX.length);

  const namespaceEnd = afterAi.indexOf(':');
  if (namespaceEnd < 0) return unknown('key carries no identity segment');
  const namespace = afterAi.slice(0, namespaceEnd);
  const remainder = afterAi.slice(namespaceEnd + 1);

  const kind = NAMESPACE_TO_KIND[namespace];
  // NOT AN ERROR. Every other AI namespace the platform owns lands here, and
  // landing here is how a preflight proves it read the whole snapshot without
  // claiming authority over rows that are not its business.
  if (kind === undefined) return unknown(`namespace ${namespace} is not a workflow namespace`);

  // From here the row IS ours, so a shape problem is a defect rather than a
  // different owner.
  if (!ORGANIZATION_ID.test(sourceTenantId)) {
    return invalid('key tenant segment is not a valid organization identifier');
  }

  if (kind !== 'checkpoint') {
    if (!SAFE_KEY_SEGMENT.test(remainder)) return invalid('key identity segment is malformed');
    return { ok: true, parsed: { kind, sourceTenantId, identity: remainder } };
  }

  const versionStart = remainder.lastIndexOf(':');
  if (versionStart < 0) return invalid('checkpoint key carries no version segment');
  const workflowRunId = remainder.slice(0, versionStart);
  const versionText = remainder.slice(versionStart + 1);

  if (versionText.length !== CHECKPOINT_VERSION_WIDTH || !/^\d+$/.test(versionText)) {
    return invalid('checkpoint key version segment is not zero-padded to six digits');
  }
  if (!SAFE_KEY_SEGMENT.test(workflowRunId)) return invalid('checkpoint key run segment is malformed');

  const version = Number(versionText);
  // Checkpoint versions start at 1. A padded zero is a key the current writer
  // cannot produce for a real checkpoint, and the relational chain constraint
  // refuses it outright.
  if (version < 1) return invalid('checkpoint key names version zero');

  return { ok: true, parsed: { kind, sourceTenantId, identity: workflowRunId, version } };
}

// ── Payload handling ────────────────────────────────────────────────────────

/** The coercion `kvWorkflowStores.ts` performs, reproduced exactly. */
function coerce(raw: unknown): Record<string, unknown> | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') return undefined;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return undefined;
}

/** The SAME four-field structural check the production reader applies. */
function satisfiesShape(kind: WorkflowSourceKind, record: Record<string, unknown>): boolean {
  if (kind === 'run') {
    const context = record.context as Record<string, unknown> | undefined;
    return (
      typeof record.runVersion === 'number' &&
      typeof record.state === 'string' &&
      typeof context?.workflowRunId === 'string' &&
      typeof context?.organizationId === 'string'
    );
  }
  if (kind === 'checkpoint') {
    return (
      typeof record.version === 'number' &&
      typeof record.digest === 'string' &&
      typeof record.workflowRunId === 'string' &&
      typeof record.organizationId === 'string'
    );
  }
  return (
    typeof record.approvalVersion === 'number' &&
    typeof record.approvalState === 'string' &&
    typeof record.workflowApprovalId === 'string' &&
    typeof record.workflowRunId === 'string' &&
    typeof record.organizationId === 'string'
  );
}

function tenantOf(kind: WorkflowSourceKind, record: Record<string, unknown>): string {
  if (kind === 'run') {
    const context = record.context as Record<string, unknown>;
    return String(context.organizationId);
  }
  return String(record.organizationId);
}

function identityOf(kind: WorkflowSourceKind, record: Record<string, unknown>): string {
  if (kind === 'run') {
    const context = record.context as Record<string, unknown>;
    return String(context.workflowRunId);
  }
  if (kind === 'checkpoint') return String(record.workflowRunId);
  return String(record.workflowApprovalId);
}

/**
 * The domain record, with the storage envelope removed.
 *
 * A shallow copy minus one key. Nothing else is touched, so the removal cannot
 * reorder, coerce or drop a domain field on its way past.
 */
function withoutEnvelope(record: Record<string, unknown>): Record<string, unknown> {
  if (!(SCHEMA_MARKER_FIELD in record)) return record;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key !== SCHEMA_MARKER_FIELD) copy[key] = value;
  }
  return copy;
}

// ── One row ─────────────────────────────────────────────────────────────────

function classifyRow(row: WorkflowSourceRow): WorkflowInventoryRow {
  const key = parseWorkflowSourceKey(row.key);
  if (!key.ok) {
    return { key: row.key, classification: key.classification, detail: key.detail };
  }
  const { kind, sourceTenantId, identity, version } = key.parsed;
  const base = { key: row.key, kind, sourceTenantId, identity, ...(version === undefined ? {} : { version }) };

  const payload = coerce(row.value);
  if (!payload) {
    return { ...base, classification: 'corrupt_json', detail: 'stored value is not a readable object' };
  }

  const marker = payload[SCHEMA_MARKER_FIELD];
  if (marker !== WORKFLOW_SOURCE_SCHEMA[kind]) {
    return {
      ...base,
      classification: 'wrong_schema',
      detail:
        typeof marker === 'string'
          ? `schema marker is ${marker}, expected ${WORKFLOW_SOURCE_SCHEMA[kind]}`
          : `schema marker is absent, expected ${WORKFLOW_SOURCE_SCHEMA[kind]}`,
    };
  }

  if (!satisfiesShape(kind, payload)) {
    return {
      ...base,
      classification: 'wrong_schema',
      detail: `payload does not satisfy ${WORKFLOW_SOURCE_SCHEMA[kind]}: identity or version is missing`,
    };
  }

  if (tenantOf(kind, payload) !== sourceTenantId) {
    return {
      ...base,
      classification: 'key_payload_tenant_mismatch',
      detail: 'the key and the payload name different tenants',
    };
  }

  if (identityOf(kind, payload) !== identity) {
    return {
      ...base,
      classification: 'key_payload_identity_mismatch',
      detail: 'the key and the payload name different records',
    };
  }

  if (kind === 'checkpoint' && payload.version !== version) {
    return {
      ...base,
      classification: 'key_payload_identity_mismatch',
      detail: 'the key and the payload name different checkpoint versions',
    };
  }

  const record = withoutEnvelope(payload);
  return { ...base, classification: 'valid', record: record as unknown as WorkflowInventoryRow['record'] };
}

// ── Bundles and tenants ─────────────────────────────────────────────────────

/** One run with everything that points at it, in the order a reader wants. */
export interface WorkflowRunBundle {
  readonly run: WorkflowRunRecord;
  /** Version order, oldest first. */
  readonly checkpoints: readonly WorkflowCheckpoint[];
  /** Oldest first, the approval queue's order. */
  readonly approvals: readonly WorkflowApprovalRecord[];
  readonly chainValid: boolean;
  readonly pointerValid: boolean;
  /** Structured, non-business explanations. Empty when the bundle is sound. */
  readonly problems: readonly string[];
}

export function isTransformableBundle(bundle: WorkflowRunBundle): boolean {
  return bundle.chainValid && bundle.pointerValid;
}

export interface WorkflowTenantInventory {
  readonly sourceTenantId: string;
  readonly bundles: readonly WorkflowRunBundle[];
  readonly runCount: number;
  readonly checkpointCount: number;
  readonly approvalCount: number;
  readonly pendingApprovalCount: number;
  readonly corruptRowCount: number;
  readonly orphanCheckpointCount: number;
  readonly orphanApprovalCount: number;
  readonly invalidChainCount: number;
  readonly pointerMismatchCount: number;
  readonly census: ActiveRunCensus;
  readonly problems: readonly string[];
}

export interface WorkflowSourceInventory {
  readonly rows: readonly WorkflowInventoryRow[];
  readonly tenants: readonly WorkflowTenantInventory[];
  readonly sourceRowCount: number;
  readonly recognizedWorkflowRowCount: number;
  readonly unknownWorkflowRowCount: number;
}

function emptyCensus(): { terminal: number; active: number; byState: Record<WorkflowRunState, number>; withPendingRetry: number; withPendingNode: number } {
  const byState = {} as Record<WorkflowRunState, number>;
  for (const state of WORKFLOW_RUN_STATES) byState[state] = 0;
  return { terminal: 0, active: 0, byState, withPendingRetry: 0, withPendingNode: 0 };
}

/**
 * Inventory a snapshot.
 *
 * Two passes, and the second one is why there are two: `orphan_checkpoint`,
 * `duplicate_logical_identity`, `invalid_checkpoint_chain` and
 * `run_checkpoint_pointer_mismatch` are all statements about a row's
 * RELATIONSHIP to other rows, and none of them can be decided while reading one
 * row at a time.
 */
export function inventoryWorkflowSource(
  rows: readonly WorkflowSourceRow[],
): WorkflowSourceInventory {
  const classified = rows.map(classifyRow);

  // ── Duplicates, before anything is indexed ───────────────────────────────
  //
  // A logical identity that arrives twice is ambiguous, and picking either copy
  // would be the preflight guessing. Both are marked, so the report names the
  // collision rather than a survivor.
  const seen = new Map<string, number[]>();
  classified.forEach((row, index) => {
    if (row.classification !== 'valid' || row.kind === undefined) return;
    const logical = `${row.sourceTenantId}\u0000${row.kind}\u0000${row.identity}\u0000${row.version ?? ''}`;
    const bucket = seen.get(logical);
    if (bucket) bucket.push(index);
    else seen.set(logical, [index]);
  });
  const final: WorkflowInventoryRow[] = [...classified];
  for (const indexes of seen.values()) {
    if (indexes.length < 2) continue;
    for (const index of indexes) {
      final[index] = {
        ...final[index],
        classification: 'duplicate_logical_identity',
        detail: `${indexes.length} rows share one logical identity`,
        record: undefined,
      };
    }
  }

  // ── Index the survivors ──────────────────────────────────────────────────
  const runsByTenant = new Map<string, Map<string, WorkflowRunRecord>>();
  const checkpointRows = new Map<string, number[]>();
  const approvalRows = new Map<string, number[]>();

  final.forEach((row, index) => {
    if (row.classification !== 'valid' || row.kind === undefined || row.sourceTenantId === undefined) return;
    const tenant = row.sourceTenantId;
    if (row.kind === 'run') {
      const bucket = runsByTenant.get(tenant) ?? new Map<string, WorkflowRunRecord>();
      bucket.set(String(row.identity), row.record as WorkflowRunRecord);
      runsByTenant.set(tenant, bucket);
      return;
    }
    const target = row.kind === 'checkpoint' ? checkpointRows : approvalRows;
    const runId = row.kind === 'checkpoint'
      ? String(row.identity)
      : (row.record as WorkflowApprovalRecord).workflowRunId;
    const logical = `${tenant}\u0000${runId}`;
    const bucket = target.get(logical);
    if (bucket) bucket.push(index);
    else target.set(logical, [index]);
  });

  // ── Orphans ──────────────────────────────────────────────────────────────
  const orphan = (
    index: number,
    classification: Extract<WorkflowRowClassification, 'orphan_checkpoint' | 'orphan_approval'>,
    runId: string,
  ) => {
    final[index] = {
      ...final[index],
      classification,
      detail: `no valid workflow run ${runId} in this tenant`,
      record: undefined,
    };
  };
  for (const [logical, indexes] of checkpointRows) {
    const [tenant, runId] = logical.split('\u0000');
    if (runsByTenant.get(tenant)?.has(runId)) continue;
    for (const index of indexes) orphan(index, 'orphan_checkpoint', runId);
  }
  for (const [logical, indexes] of approvalRows) {
    const [tenant, runId] = logical.split('\u0000');
    if (runsByTenant.get(tenant)?.has(runId)) continue;
    for (const index of indexes) orphan(index, 'orphan_approval', runId);
  }

  // ── Chains, pointers and the per-tenant roll-up ──────────────────────────
  const tenantIds = new Set<string>();
  for (const row of final) {
    if (row.sourceTenantId !== undefined && row.kind !== undefined) tenantIds.add(row.sourceTenantId);
  }

  const tenants: WorkflowTenantInventory[] = [];
  for (const sourceTenantId of [...tenantIds].sort()) {
    const runs = runsByTenant.get(sourceTenantId) ?? new Map<string, WorkflowRunRecord>();
    const bundles: WorkflowRunBundle[] = [];
    const census = emptyCensus();
    let checkpointCount = 0;
    let approvalCount = 0;
    let pendingApprovalCount = 0;
    let invalidChainCount = 0;
    let pointerMismatchCount = 0;

    for (const runId of [...runs.keys()].sort()) {
      const run = runs.get(runId) as WorkflowRunRecord;
      const logical = `${sourceTenantId}\u0000${runId}`;

      const checkpoints = (checkpointRows.get(logical) ?? [])
        .map((index) => final[index])
        .filter((row) => row.classification === 'valid')
        .map((row) => row.record as WorkflowCheckpoint)
        .sort((a, b) => a.version - b.version);

      const approvals = sortWorkflowApprovals(
        (approvalRows.get(logical) ?? [])
          .map((index) => final[index])
          .filter((row) => row.classification === 'valid')
          .map((row) => row.record as WorkflowApprovalRecord),
      );

      checkpointCount += checkpoints.length;
      approvalCount += approvals.length;
      pendingApprovalCount += approvals.filter((a) => a.approvalState === 'pending').length;

      const problems: string[] = [];

      // THE SOURCE CHAIN, VERIFIED WITH THE ENGINE'S OWN VERIFIER. A second
      // implementation of "is this chain intact" would be a second opinion
      // about the one thing the whole transformation rests on.
      const verdict = verifyChain(checkpoints);
      const chainValid = verdict.ok;
      if (!chainValid) {
        invalidChainCount += 1;
        problems.push(`invalid_checkpoint_chain: ${verdict.problem}`);
      }

      // ── CARRIED FINDING, FOR THE PACKET THAT DECIDES THE CUTOVER ────────
      //
      // The rule below is STRICTER than "the data is intact", deliberately, and
      // the next packet has to classify the difference before a hosted
      // preflight runs against a live estate.
      //
      // `workflowOrchestrator.ts` writes a checkpoint BEFORE it saves the run
      // carrying the new pointer. An isolate that dies between the two leaves
      // checkpoint vN stored with the run still pointing at vN-1 — which is a
      // RECOVERABLE state, not corruption: the engine's next pass recomputes
      // the same checkpoint and adopts the stored one when the digests match.
      //
      // BP-004 refuses it anyway, because the packet's gate is that a run's
      // pointer equals its chain tip, and a preflight that guessed which
      // mismatches were benign would be guessing about the one field restart
      // recovery trusts. A hosted preflight will meet this state, so the next
      // packet should decide explicitly whether "the tip is exactly one ahead
      // AND its `previousDigest` is the run's pointer" is acceptable — and say
      // so in code rather than relaxing the check by feel.
      const tip = checkpoints[checkpoints.length - 1];
      let pointerValid: boolean;
      if (tip === undefined) {
        pointerValid = run.checkpointVersion === 0 && run.checkpointDigest === undefined;
        if (!pointerValid) {
          problems.push(
            'run_checkpoint_pointer_mismatch: the run names a checkpoint and none is stored',
          );
        }
      } else {
        pointerValid =
          run.checkpointVersion === tip.version && run.checkpointDigest === tip.digest;
        if (!pointerValid) {
          problems.push(
            `run_checkpoint_pointer_mismatch: the run points at version ${run.checkpointVersion} ` +
              `and the chain tip is version ${tip.version}`,
          );
        }
      }
      if (!pointerValid) pointerMismatchCount += 1;

      census.byState[run.state] += 1;
      if (isTerminalWorkflowState(run.state)) census.terminal += 1;
      else census.active += 1;
      if (run.retries.length > 0) census.withPendingRetry += 1;
      if (run.pendingNode !== undefined) census.withPendingNode += 1;

      bundles.push({ run, checkpoints, approvals, chainValid, pointerValid, problems });
    }

    const tenantRows = final.filter(
      (row) => row.sourceTenantId === sourceTenantId && row.kind !== undefined,
    );
    const defective = tenantRows.filter((row) => isBlockingClassification(row.classification));

    tenants.push({
      sourceTenantId,
      bundles,
      runCount: runs.size,
      checkpointCount,
      approvalCount,
      pendingApprovalCount,
      corruptRowCount: defective.length,
      orphanCheckpointCount: tenantRows.filter((row) => row.classification === 'orphan_checkpoint').length,
      orphanApprovalCount: tenantRows.filter((row) => row.classification === 'orphan_approval').length,
      invalidChainCount,
      pointerMismatchCount,
      census,
      problems: [
        ...defective.map((row) => `${row.classification}: ${row.key}`),
        ...bundles.flatMap((bundle) => bundle.problems),
      ],
    });
  }

  const recognized = final.filter((row) => row.kind !== undefined).length;
  return {
    rows: final,
    tenants,
    sourceRowCount: rows.length,
    recognizedWorkflowRowCount: recognized,
    unknownWorkflowRowCount: final.filter(
      (row) => row.classification === 'unknown_workflow_namespace',
    ).length,
  };
}
