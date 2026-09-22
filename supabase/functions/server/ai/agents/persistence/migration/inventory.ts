/**
 * A2-P08-C01 — the agent source inventory. READ-ONLY, IN MEMORY, NO REPAIR.
 *
 * Input is a snapshot of key-value rows a caller supplies; output is a
 * classification of every row, every run bundle and every tenant. Nothing is
 * written, nothing is fixed, and nothing here can reach a store: a finding is a
 * statement about the snapshot, and a module that could change the snapshot
 * would make every finding a statement about something that no longer exists.
 *
 * The grammar and the coercion are the PRODUCTION READER'S — `kvAgentStores.ts`
 * and `security/tenancy.ts` — restated rather than imported for BP-004's
 * reason (this folder must not reach into the security tree for a regex), and
 * pinned equal by a test in both directions.
 */

import type {
  AgentApprovalRequest,
  AgentCheckpoint,
  AgentRunRecord,
  AgentRunState,
} from '../../contracts/runtime.ts';
import { AGENT_RUN_STATES, isTerminalState } from '../../contracts/runtime.ts';
import { digestValue } from '../../runtime/digest.ts';
import { byNewest } from '../ports.ts';
import type {
  AgentActiveRunCensus,
  AgentChainLinkage,
  AgentInventoryRow,
  AgentPointerClassification,
  AgentRowClassification,
  AgentRunBundle,
  AgentSourceInventory,
  AgentSourceKind,
  AgentSourceRow,
  AgentTenantInventory,
} from './contracts.ts';
import {
  AGENT_CHECKPOINT_VERSION_WIDTH,
  AGENT_POINTER_CLASSIFICATIONS,
  AGENT_SCHEMA_MARKER_FIELD,
  AGENT_SOURCE_NAMESPACE,
  AGENT_SOURCE_SCHEMA,
  BLOCKING_AGENT_POINTER_CLASSIFICATIONS,
  isBlockingAgentRow,
} from './contracts.ts';

// ── Grammar ────────────────────────────────────────────────────────────────

const ORGANIZATION_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const SAFE_KEY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const NAMESPACE_TO_KIND: Readonly<Record<string, AgentSourceKind>> = {
  [AGENT_SOURCE_NAMESPACE.run]: 'run',
  [AGENT_SOURCE_NAMESPACE.checkpoint]: 'checkpoint',
  [AGENT_SOURCE_NAMESPACE.approval]: 'approval',
};

interface ParsedKey {
  readonly kind: AgentSourceKind;
  readonly sourceTenantId: string;
  readonly identity: string;
  readonly version?: number;
}

type KeyVerdict =
  | { readonly ok: true; readonly parsed: ParsedKey }
  | {
      readonly ok: false;
      readonly classification: 'invalid_key' | 'unknown_agent_namespace';
      readonly detail: string;
    };

export function parseAgentSourceKey(key: string): KeyVerdict {
  const unknown = (detail: string): KeyVerdict => ({ ok: false, classification: 'unknown_agent_namespace', detail });
  const invalid = (detail: string): KeyVerdict => ({ ok: false, classification: 'invalid_key', detail });

  if (!key.startsWith('org:')) return unknown('key does not open with the tenant prefix');
  const afterPrefix = key.slice('org:'.length);
  const tenantEnd = afterPrefix.indexOf(':');
  if (tenantEnd < 0) return unknown('key carries no namespace segment');
  const sourceTenantId = afterPrefix.slice(0, tenantEnd);
  const afterTenant = afterPrefix.slice(tenantEnd + 1);
  if (!afterTenant.startsWith('ai:')) return unknown('key is not in the AI namespace');
  const afterAi = afterTenant.slice('ai:'.length);
  const namespaceEnd = afterAi.indexOf(':');
  if (namespaceEnd < 0) return unknown('key carries no identity segment');
  const namespace = afterAi.slice(0, namespaceEnd);
  const remainder = afterAi.slice(namespaceEnd + 1);

  const kind = NAMESPACE_TO_KIND[namespace];
  // Every other AI namespace — workflow rows included — lands here, and that
  // is how the inventory proves it read the whole snapshot without claiming
  // rows that are not its business.
  if (kind === undefined) return unknown(`namespace ${namespace} is not an agent namespace`);

  if (!ORGANIZATION_ID.test(sourceTenantId)) {
    return invalid('key tenant segment is not a valid organization identifier');
  }
  if (kind !== 'checkpoint') {
    if (!SAFE_KEY_SEGMENT.test(remainder)) return invalid('key identity segment is malformed');
    return { ok: true, parsed: { kind, sourceTenantId, identity: remainder } };
  }

  const versionStart = remainder.lastIndexOf(':');
  if (versionStart < 0) return invalid('checkpoint key carries no version segment');
  const runId = remainder.slice(0, versionStart);
  const versionText = remainder.slice(versionStart + 1);
  if (versionText.length !== AGENT_CHECKPOINT_VERSION_WIDTH || !/^\d+$/.test(versionText)) {
    return invalid('checkpoint key version segment is not zero-padded to six digits');
  }
  if (!SAFE_KEY_SEGMENT.test(runId)) return invalid('checkpoint key run segment is malformed');
  const version = Number(versionText);
  if (version < 1) return invalid('checkpoint key names version zero');
  return { ok: true, parsed: { kind, sourceTenantId, identity: runId, version } };
}

// ── Payload handling ────────────────────────────────────────────────────────

/** The coercion `kvAgentStores.ts` performs, reproduced exactly. */
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

/** The SAME structural checks the production reader applies, per kind. */
function satisfiesShape(kind: AgentSourceKind, record: Record<string, unknown>): boolean {
  if (kind === 'run') {
    const context = record.context as Record<string, unknown> | undefined;
    return (
      typeof record.runVersion === 'number' &&
      typeof record.state === 'string' &&
      typeof context?.runId === 'string' &&
      typeof context?.organizationId === 'string'
    );
  }
  if (kind === 'checkpoint') {
    return (
      typeof record.version === 'number' &&
      typeof record.runId === 'string' &&
      typeof record.organizationId === 'string'
    );
  }
  return (
    typeof record.approvalVersion === 'number' &&
    typeof record.approvalId === 'string' &&
    typeof record.organizationId === 'string' &&
    typeof record.state === 'string'
  );
}

function tenantOf(kind: AgentSourceKind, record: Record<string, unknown>): string {
  if (kind === 'run') return String((record.context as Record<string, unknown>).organizationId);
  return String(record.organizationId);
}

function identityOf(kind: AgentSourceKind, record: Record<string, unknown>): string {
  if (kind === 'run') return String((record.context as Record<string, unknown>).runId);
  if (kind === 'checkpoint') return String(record.runId);
  return String(record.approvalId);
}

/** A shallow copy minus the storage envelope. Nothing else is touched. */
function withoutEnvelope(record: Record<string, unknown>): Record<string, unknown> {
  if (!(AGENT_SCHEMA_MARKER_FIELD in record)) return record;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key !== AGENT_SCHEMA_MARKER_FIELD) copy[key] = value;
  }
  return copy;
}

// ── One row ─────────────────────────────────────────────────────────────────

function classifyRow(row: AgentSourceRow): AgentInventoryRow {
  const key = parseAgentSourceKey(row.key);
  if (!key.ok) return { key: row.key, classification: key.classification, detail: key.detail };
  const { kind, sourceTenantId, identity, version } = key.parsed;
  const base = { key: row.key, kind, sourceTenantId, identity, ...(version === undefined ? {} : { version }) };

  const payload = coerce(row.value);
  if (!payload) return { ...base, classification: 'corrupt_json', detail: 'stored value is not a readable object' };

  const marker = payload[AGENT_SCHEMA_MARKER_FIELD];
  if (marker !== AGENT_SOURCE_SCHEMA[kind]) {
    return {
      ...base,
      classification: 'wrong_schema',
      detail: typeof marker === 'string'
        ? `schema marker is ${marker}, expected ${AGENT_SOURCE_SCHEMA[kind]}`
        : `schema marker is absent, expected ${AGENT_SOURCE_SCHEMA[kind]}`,
    };
  }
  if (!satisfiesShape(kind, payload)) {
    return {
      ...base,
      classification: 'wrong_schema',
      detail: `payload does not satisfy ${AGENT_SOURCE_SCHEMA[kind]}: identity or version is missing`,
    };
  }
  if (tenantOf(kind, payload) !== sourceTenantId) {
    return { ...base, classification: 'key_payload_tenant_mismatch', detail: 'the key and the payload name different tenants' };
  }
  if (identityOf(kind, payload) !== identity) {
    return { ...base, classification: 'key_payload_identity_mismatch', detail: 'the key and the payload name different records' };
  }
  if (kind === 'checkpoint' && payload.version !== version) {
    return {
      ...base,
      classification: 'key_payload_identity_mismatch',
      detail: 'the key and the payload name different checkpoint versions',
    };
  }

  // THE ONE INTEGRITY FACT AN AGENT CHECKPOINT CAN PROVE. `writeCheckpoint`
  // stores `progressDigest = digestValue(progress)`; a stored progress that
  // no longer hashes to its own digest was edited or damaged after it was
  // written, and copying it would carry the damage into the new authority
  // under a digest that vouches for something else.
  if (kind === 'checkpoint' && payload.progressDigest !== digestValue(payload.progress)) {
    return {
      ...base,
      classification: 'progress_digest_mismatch',
      detail: 'the stored progress does not hash to its own progressDigest',
    };
  }

  return { ...base, classification: 'valid', record: withoutEnvelope(payload) as unknown as AgentInventoryRow['record'] };
}

// ── Bundles ─────────────────────────────────────────────────────────────────

function classifyPointer(
  run: AgentRunRecord,
  checkpoints: readonly AgentCheckpoint[],
): { pointer: AgentPointerClassification; problem?: string } {
  const pointer = run.checkpointVersion;
  const tip = checkpoints[checkpoints.length - 1];
  if (tip === undefined) {
    return pointer === 0
      ? { pointer: 'EMPTY_CHAIN' }
      : { pointer: 'POINTER_WITHOUT_CHAIN', problem: `the run points at version ${pointer} and no checkpoint is stored` };
  }
  if (tip.version === pointer) return { pointer: 'EXACT_TIP_MATCH' };
  if (tip.version === pointer + 1) {
    const named = pointer === 0 ? undefined : checkpoints.find((c) => c.version === pointer);
    const links = pointer === 0 ? tip.previousDigest === undefined : named !== undefined && tip.previousDigest === named.progressDigest;
    if (links) {
      return {
        pointer: 'RECOVERABLE_ONE_AHEAD_CANDIDATE',
        problem: `the chain tip ${tip.version} is one ahead of the run pointer ${pointer} and links to it`,
      };
    }
  }
  return {
    pointer: 'ACTUAL_POINTER_MISMATCH',
    problem: `the run points at version ${pointer} and the chain tip is version ${tip.version}`,
  };
}

function classifyLinkage(checkpoints: readonly AgentCheckpoint[]): AgentChainLinkage {
  if (checkpoints.length === 0) return 'EMPTY';
  for (let index = 0; index < checkpoints.length; index += 1) {
    const checkpoint = checkpoints[index];
    if (checkpoint.version !== index + 1) return 'IRREGULAR';
    const expected = index === 0 ? undefined : checkpoints[index - 1].progressDigest;
    if (checkpoint.previousDigest !== expected) return 'IRREGULAR';
  }
  return 'CONTIGUOUS_LINKED';
}

function emptyCensus() {
  const byState = {} as Record<AgentRunState, number>;
  for (const state of AGENT_RUN_STATES) byState[state] = 0;
  return {
    terminal: 0,
    active: 0,
    byState,
    waitingForApproval: 0,
    withPendingAction: 0,
    workflowLinked: 0,
    childRuns: 0,
    withClaimedToolKeys: 0,
  };
}

// ── The inventory ───────────────────────────────────────────────────────────

/**
 * Inventory a snapshot. Two passes: the second decides everything that is a
 * statement about a row's RELATIONSHIP to other rows (duplicates, orphans,
 * pointers, linkage), which one row at a time cannot.
 */
export function inventoryAgentSource(rows: readonly AgentSourceRow[]): AgentSourceInventory {
  const classified = rows.map(classifyRow);

  // Duplicates: a logical identity that arrives twice is ambiguous; both copies
  // are marked, so the report names the collision rather than a survivor.
  const seen = new Map<string, number[]>();
  classified.forEach((row, index) => {
    if (row.classification !== 'valid' || row.kind === undefined) return;
    const logical = `${row.sourceTenantId}\u0000${row.kind}\u0000${row.identity}\u0000${row.version ?? ''}`;
    const bucket = seen.get(logical);
    if (bucket) bucket.push(index);
    else seen.set(logical, [index]);
  });
  const final: AgentInventoryRow[] = [...classified];
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

  const runsByTenant = new Map<string, Map<string, AgentRunRecord>>();
  const checkpointRows = new Map<string, number[]>();
  const approvalRows = new Map<string, number[]>();
  final.forEach((row, index) => {
    if (row.classification !== 'valid' || row.kind === undefined || row.sourceTenantId === undefined) return;
    const tenant = row.sourceTenantId;
    if (row.kind === 'run') {
      const bucket = runsByTenant.get(tenant) ?? new Map<string, AgentRunRecord>();
      bucket.set(String(row.identity), row.record as AgentRunRecord);
      runsByTenant.set(tenant, bucket);
      return;
    }
    const target = row.kind === 'checkpoint' ? checkpointRows : approvalRows;
    const runId = row.kind === 'checkpoint' ? String(row.identity) : (row.record as AgentApprovalRequest).runId;
    const logical = `${tenant}\u0000${runId}`;
    const bucket = target.get(logical);
    if (bucket) bucket.push(index);
    else target.set(logical, [index]);
  });

  // Orphans: a checkpoint or approval with no valid run in ITS tenant. The
  // relational authority's composite foreign key would refuse it outright.
  const orphan = (index: number, classification: 'orphan_checkpoint' | 'orphan_approval', runId: string) => {
    final[index] = { ...final[index], classification, detail: `no valid agent run ${runId} in this tenant`, record: undefined };
  };
  for (const [logical, indexes] of checkpointRows) {
    const [tenant, runId] = logical.split('\u0000');
    if (!runsByTenant.get(tenant)?.has(runId)) for (const index of indexes) orphan(index, 'orphan_checkpoint', runId);
  }
  for (const [logical, indexes] of approvalRows) {
    const [tenant, runId] = logical.split('\u0000');
    if (!runsByTenant.get(tenant)?.has(runId)) for (const index of indexes) orphan(index, 'orphan_approval', runId);
  }

  const tenantIds = new Set<string>();
  for (const row of final) if (row.sourceTenantId !== undefined && row.kind !== undefined) tenantIds.add(row.sourceTenantId);

  const tenants: AgentTenantInventory[] = [];
  for (const sourceTenantId of [...tenantIds].sort()) {
    const runs = runsByTenant.get(sourceTenantId) ?? new Map<string, AgentRunRecord>();
    const census = emptyCensus();
    const pointerCounts = Object.fromEntries(AGENT_POINTER_CLASSIFICATIONS.map((c) => [c, 0])) as Record<AgentPointerClassification, number>;
    const bundles: AgentRunBundle[] = [];
    let checkpointCount = 0;
    let approvalCount = 0;
    let pendingApprovalCount = 0;
    let irregularChainCount = 0;
    let danglingPendingApprovalCount = 0;

    for (const runId of [...runs.keys()].sort()) {
      const run = runs.get(runId) as AgentRunRecord;
      const logical = `${sourceTenantId}\u0000${runId}`;
      const checkpoints = (checkpointRows.get(logical) ?? [])
        .map((index) => final[index])
        .filter((row) => row.classification === 'valid')
        .map((row) => row.record as AgentCheckpoint)
        .sort((a, b) => a.version - b.version);
      const approvals = (approvalRows.get(logical) ?? [])
        .map((index) => final[index])
        .filter((row) => row.classification === 'valid')
        .map((row) => row.record as AgentApprovalRequest)
        .sort(byNewest);

      checkpointCount += checkpoints.length;
      approvalCount += approvals.length;
      pendingApprovalCount += approvals.filter((a) => a.state === 'pending').length;

      const problems: string[] = [];
      const { pointer, problem } = classifyPointer(run, checkpoints);
      pointerCounts[pointer] += 1;
      if (problem) problems.push(`${pointer}: ${problem}`);

      const linkage = classifyLinkage(checkpoints);
      if (linkage === 'IRREGULAR') {
        irregularChainCount += 1;
        problems.push('IRREGULAR_CHAIN: versions or links are not contiguous (evidence, not blocking)');
      }

      const danglingPendingApproval =
        run.pendingApprovalId !== undefined && !approvals.some((a) => a.approvalId === run.pendingApprovalId);
      if (danglingPendingApproval) {
        danglingPendingApprovalCount += 1;
        problems.push('DANGLING_PENDING_APPROVAL: the run names an approval that is not stored');
      }

      census.byState[run.state] += 1;
      if (isTerminalState(run.state)) census.terminal += 1;
      else census.active += 1;
      if (run.state === 'waiting_for_approval') census.waitingForApproval += 1;
      if (run.pendingAction !== undefined) census.withPendingAction += 1;
      if (run.context.workflowId !== undefined) census.workflowLinked += 1;
      if (run.context.parentRunId !== undefined) census.childRuns += 1;
      if (run.claimedToolKeys.length > 0) census.withClaimedToolKeys += 1;

      bundles.push({ run, checkpoints, approvals, pointer, linkage, danglingPendingApproval, problems });
    }

    const tenantRows = final.filter((row) => row.sourceTenantId === sourceTenantId && row.kind !== undefined);
    const blockingRows = tenantRows.filter((row) => isBlockingAgentRow(row.classification));
    const count = (classification: AgentRowClassification) =>
      tenantRows.filter((row) => row.classification === classification).length;

    tenants.push({
      sourceTenantId,
      bundles,
      runCount: runs.size,
      checkpointCount,
      approvalCount,
      pendingApprovalCount,
      blockingRowCount: blockingRows.length,
      orphanCheckpointCount: count('orphan_checkpoint'),
      orphanApprovalCount: count('orphan_approval'),
      progressDigestMismatchCount: count('progress_digest_mismatch'),
      pointerCounts,
      irregularChainCount,
      danglingPendingApprovalCount,
      census: census as AgentActiveRunCensus,
      problems: [
        ...blockingRows.map((row) => `${row.classification}: ${row.key}`),
        ...bundles.flatMap((bundle) => bundle.problems.map((p) => `${bundle.run.context.runId}: ${p}`)),
      ],
    });
  }

  return {
    rows: final,
    tenants,
    sourceRowCount: rows.length,
    recognizedAgentRowCount: final.filter((row) => row.kind !== undefined).length,
    unknownAgentRowCount: final.filter((row) => row.classification === 'unknown_agent_namespace').length,
  };
}

/** Does this tenant hold anything that blocks a faithful copy? */
export function agentTenantBlockers(tenant: AgentTenantInventory): readonly string[] {
  const blockers: string[] = [];
  if (tenant.blockingRowCount > 0) blockers.push(`${tenant.blockingRowCount} blocking source row(s)`);
  for (const classification of BLOCKING_AGENT_POINTER_CLASSIFICATIONS) {
    if (tenant.pointerCounts[classification] > 0) {
      blockers.push(`${tenant.pointerCounts[classification]} run(s) with ${classification}`);
    }
  }
  return blockers;
}
