/**
 * Workflow cutover readiness contracts (BP-004 / A2).
 *
 * ── WHAT THIS FOLDER IS, AND WHAT IT DELIBERATELY IS NOT ───────────────────
 *
 * BP-003 proved a SQL implementation satisfies the three workflow persistence
 * contracts FOR UUID-BACKED TENANTS. It did not move authority, and neither
 * does this. What is here answers the questions a cutover has to answer before
 * anybody is allowed to attempt one:
 *
 *   what source data shape exists, which tenant identifiers are already
 *   canonical, which need an explicit mapping, what changes when one does, and
 *   whether a transformed record set is the same set of domain facts.
 *
 * Every module in this folder is PURE. No client, no clock, no environment, no
 * network, no randomness. It is handed rows and a catalog and it returns a
 * verdict. That is not stylistic: a preflight that could reach a database is a
 * preflight that could reach the wrong one, and the safety rule this packet is
 * built around is that no hosted system is touched at all.
 *
 * It is also NOT imported by the production assembly. `ai/bootstrap.ts`
 * constructs the key-value stores and must not be able to reach this code;
 * `tests/system/ai_boundary.test.ts` asserts it cannot.
 *
 * ── THE SOURCE INPUT IS READ-ONLY BY CONSTRUCTION ──────────────────────────
 *
 * `WorkflowSourceRow` is a key and a value and there is no third field, no
 * writer, no deleter and no repair method anywhere in this folder. A source row
 * is evidence. An inventory that could fix one would be an inventory whose
 * findings describe a state that no longer exists.
 */

import type { WorkflowRunRecord, WorkflowRunState } from '../../contracts/run.ts';
import type { WorkflowCheckpoint } from '../../contracts/checkpoint.ts';
import type { WorkflowApprovalRecord } from '../../contracts/approval.ts';

// ── The source ──────────────────────────────────────────────────────────────

/**
 * One key-value row, exactly as the platform store holds it.
 *
 * `value` is `unknown` rather than a parsed shape because the coercion the
 * production reader performs — object, or JSON string containing an object — is
 * part of what this layer has to reproduce rather than assume. See
 * `inventory.ts`.
 */
export interface WorkflowSourceRow {
  readonly key: string;
  readonly value: unknown;
}

/** The three workflow namespaces, and nothing else is recognised. */
export const WORKFLOW_SOURCE_KINDS = ['run', 'checkpoint', 'approval'] as const;

export type WorkflowSourceKind = (typeof WORKFLOW_SOURCE_KINDS)[number];

/** The key namespace segment each kind uses. Mirrors `kvWorkflowStores.ts`. */
export const WORKFLOW_SOURCE_NAMESPACE: Readonly<Record<WorkflowSourceKind, string>> = {
  run: 'workflow_run',
  checkpoint: 'workflow_checkpoint',
  approval: 'workflow_approval',
};

/** The `_schema` marker each kind carries. Mirrors `kvWorkflowStores.ts`. */
export const WORKFLOW_SOURCE_SCHEMA: Readonly<Record<WorkflowSourceKind, string>> = {
  run: 'ai.workflow.run.v1',
  checkpoint: 'ai.workflow.checkpoint.v1',
  approval: 'ai.workflow.approval.v1',
};

/** The storage envelope marker. Never a domain field. See `inventory.ts`. */
export const SCHEMA_MARKER_FIELD = '_schema';

/** Checkpoint key versions are zero-padded to this width. */
export const CHECKPOINT_VERSION_WIDTH = 6;

// ── Row classification ──────────────────────────────────────────────────────

/**
 * How a source row was judged.
 *
 * `valid` is the only one that may be transformed. Everything else is reported
 * with the key that produced it and blocks its tenant, except
 * `unknown_workflow_namespace`, which is the one classification that is NOT a
 * defect: it is a row belonging to some other part of the platform, counted so
 * the inventory can prove it saw the whole snapshot, and otherwise ignored.
 *
 * Two readings worth stating, because a reader will otherwise have to guess:
 *
 *   `wrong_schema` covers both a marker that names another schema and a payload
 *   that does not satisfy the schema its marker claims — a record marked
 *   `ai.workflow.run.v1` with no `runVersion` is a wrong-schema row, and the
 *   structural check this layer applies is the SAME four-field check the
 *   production reader in `kvWorkflowStores.ts` applies before it will hand a
 *   record to anything.
 *
 *   `invalid_key` is a key inside a workflow namespace whose shape is wrong.
 *   A key outside those namespaces is `unknown_workflow_namespace` instead, so
 *   "this is not ours" and "this is ours and it is broken" never collapse into
 *   one count.
 */
export const WORKFLOW_ROW_CLASSIFICATIONS = [
  'valid',
  'corrupt_json',
  'wrong_schema',
  'key_payload_tenant_mismatch',
  'key_payload_identity_mismatch',
  'invalid_key',
  'unknown_workflow_namespace',
  'orphan_checkpoint',
  'orphan_approval',
  'duplicate_logical_identity',
  'invalid_checkpoint_chain',
  'run_checkpoint_pointer_mismatch',
] as const;

export type WorkflowRowClassification = (typeof WORKFLOW_ROW_CLASSIFICATIONS)[number];

/** Classifications that block the tenant they were found in. */
export const BLOCKING_ROW_CLASSIFICATIONS: readonly WorkflowRowClassification[] = [
  'corrupt_json',
  'wrong_schema',
  'key_payload_tenant_mismatch',
  'key_payload_identity_mismatch',
  'invalid_key',
  'orphan_checkpoint',
  'orphan_approval',
  'duplicate_logical_identity',
  'invalid_checkpoint_chain',
  'run_checkpoint_pointer_mismatch',
];

export function isBlockingClassification(
  classification: WorkflowRowClassification,
): boolean {
  return BLOCKING_ROW_CLASSIFICATIONS.includes(classification);
}

/**
 * One inventoried row.
 *
 * `record` is the DOMAIN record with the storage envelope removed — see
 * `inventory.ts` for why `_schema` is lifted off here rather than carried
 * forward — and is present only when `classification` is `valid`.
 */
export interface WorkflowInventoryRow {
  readonly key: string;
  readonly classification: WorkflowRowClassification;
  /** Absent when the key is not a recognised workflow key. */
  readonly kind?: WorkflowSourceKind;
  /** The tenant segment of the key. Absent when the key could not be parsed. */
  readonly sourceTenantId?: string;
  /** Run id, approval id, or `runId` for a checkpoint. */
  readonly identity?: string;
  /** Checkpoints only. */
  readonly version?: number;
  /** Why this row was rejected. Never business content. */
  readonly detail?: string;
  readonly record?: WorkflowRunRecord | WorkflowCheckpoint | WorkflowApprovalRecord;
}

// ── Tenant identity ─────────────────────────────────────────────────────────

/**
 * One canonical organization, as `public.organizations` holds it.
 *
 * Supplied to this layer rather than read by it. A catalog this code fetched
 * would be a database connection in a module whose whole claim is that it has
 * none.
 */
export interface CanonicalOrganization {
  readonly id: string;
  readonly slug: string;
  readonly status: 'active' | 'suspended' | 'archived';
  /** `deleted_at IS NOT NULL`. */
  readonly deleted: boolean;
}

/** Active and not deleted. The only state a migration target may be in. */
export function isEligibleOrganization(organization: CanonicalOrganization): boolean {
  return organization.status === 'active' && !organization.deleted;
}

/**
 * How a source tenant identifier relates to canonical tenancy.
 *
 * `EXPLICIT_MAPPING_RESOLVED` is added to the states the packet names, because
 * without it there is no way to SAY that a slug-shaped tenant was resolved by a
 * declared manifest — and the packet's own rule is that a manifest is one of
 * only two things that may authorise a transformation. Collapsing it into
 * `CANONICAL_UUID` would make the manifest invisible in the evidence, which is
 * the opposite of what requiring one is for.
 *
 * Only `CANONICAL_UUID` and `EXPLICIT_MAPPING_RESOLVED` may transform.
 * `SLUG_EXACT_CANDIDATE` is EVIDENCE AND NOT AUTHORITY, and is a blocker.
 */
export const TENANT_CLASSIFICATIONS = [
  'CANONICAL_UUID',
  'EXPLICIT_MAPPING_RESOLVED',
  'UUID_NOT_FOUND',
  'SLUG_EXACT_CANDIDATE',
  'EXPLICIT_MAPPING_REQUIRED',
  'MAPPING_CONFLICT',
  'TARGET_INACTIVE_OR_DELETED',
] as const;

export type TenantClassification = (typeof TENANT_CLASSIFICATIONS)[number];

/** The two classifications that authorise a transformation. Nothing else does. */
export const RESOLVED_TENANT_CLASSIFICATIONS: readonly TenantClassification[] = [
  'CANONICAL_UUID',
  'EXPLICIT_MAPPING_RESOLVED',
];

export function isResolvedTenant(classification: TenantClassification): boolean {
  return RESOLVED_TENANT_CLASSIFICATIONS.includes(classification);
}

/**
 * One declared mapping from a source tenant to a canonical organization.
 *
 * MIGRATION INPUT, NOT A RUNTIME TABLE. It is never persisted, never consulted
 * by the engine, and never derived: a mapping exists because somebody wrote it
 * down and said why.
 */
export interface WorkflowTenantMappingEntry {
  readonly sourceTenantId: string;
  readonly targetOrganizationId: string;
  /** Checked exactly when supplied. A mismatch is a conflict, not a warning. */
  readonly expectedTargetSlug?: string;
  /** Why this mapping is believed correct. Recorded, never interpreted. */
  readonly reason: string;
}

/** The verdict for one source tenant identifier. */
export interface TenantResolution {
  readonly sourceTenantId: string;
  readonly classification: TenantClassification;
  /** Present only when the classification resolves. */
  readonly targetOrganizationId?: string;
  readonly targetSlug?: string;
  /** True when the tenant identifier changes, so digests must be re-chained. */
  readonly digestRewriteRequired: boolean;
  /** True when a manifest entry is required and was not supplied. */
  readonly mappingRequired: boolean;
  /** Structured, non-business explanation. Always at least one when blocked. */
  readonly reasons: readonly string[];
}

// ── Active-run safety ───────────────────────────────────────────────────────

/**
 * Run states counted separately in the readiness report.
 *
 * BP-004 does not choose a policy for active runs. It counts them, by the state
 * the runtime actually uses, so the packet that does choose is choosing against
 * numbers rather than against an intuition about how many there probably are.
 */
export interface ActiveRunCensus {
  readonly terminal: number;
  readonly active: number;
  readonly byState: Readonly<Record<WorkflowRunState, number>>;
  /** Runs carrying a durable retry/backoff record. */
  readonly withPendingRetry: number;
  /** Runs carrying a pending-node pointer — a child in flight. */
  readonly withPendingNode: number;
}

// ── Fingerprints ────────────────────────────────────────────────────────────

/**
 * Which comparison a fingerprint was taken under.
 *
 * `exact` proves nothing changed at all, and is the only mode used when a
 * tenant identifier does not move. `migration-semantic` elides the four fields
 * whose change is FORCED by the tenant translation and nothing else — see
 * `fingerprint.ts` for the list and for why calling it "the same bytes" would
 * be a lie.
 */
export type FingerprintMode = 'exact' | 'migration-semantic';

export interface WorkflowFingerprint {
  readonly mode: FingerprintMode;
  readonly digest: string;
}

// ── Readiness ───────────────────────────────────────────────────────────────

/**
 * The verdict.
 *
 * `GO_FOR_LATER_BACKFILL_PACKET` is as far as this packet's evidence can reach.
 * There is deliberately no value meaning "cut over now": the strongest thing a
 * preflight can say is that a separately reviewed backfill packet may be
 * written, and a vocabulary that could say more would eventually be read as
 * saying it.
 */
export type ReadinessVerdict = 'GO_FOR_LATER_BACKFILL_PACKET' | 'NO_GO';

export interface TenantReadiness {
  readonly sourceTenantId: string;
  readonly classification: TenantClassification;
  readonly targetOrganizationId?: string;
  readonly targetSlug?: string;
  readonly runCount: number;
  readonly checkpointCount: number;
  readonly approvalCount: number;
  readonly activeRunCount: number;
  readonly terminalRunCount: number;
  readonly pendingApprovalCount: number;
  readonly corruptRowCount: number;
  readonly orphanCheckpointCount: number;
  readonly orphanApprovalCount: number;
  readonly invalidChainCount: number;
  readonly pointerMismatchCount: number;
  readonly mappingRequired: boolean;
  readonly digestRewriteRequired: boolean;
  readonly census: ActiveRunCensus;
  readonly sourceFingerprint?: WorkflowFingerprint;
  readonly transformedFingerprint?: WorkflowFingerprint;
  readonly readiness: ReadinessVerdict;
  readonly reasons: readonly string[];
}

export interface ReadinessManifest {
  readonly sourceRowCount: number;
  readonly recognizedWorkflowRowCount: number;
  readonly unknownWorkflowRowCount: number;
  readonly tenantCount: number;
  readonly readyTenantCount: number;
  readonly blockedTenantCount: number;
  readonly allSourceChainsValid: boolean;
  readonly allMappingsExplicit: boolean;
  readonly allTargetsCanonical: boolean;
  readonly localBackfillVerified: boolean;
  readonly goNoGo: ReadinessVerdict;
  readonly generatedAt: string;
  readonly tool: string;
  readonly toolVersion: string;
  readonly tenants: readonly TenantReadiness[];
  readonly reasons: readonly string[];
}

/** Named once so evidence carries the producer that made it. */
export const PREFLIGHT_TOOL = 'bp004-workflow-cutover-preflight';
export const PREFLIGHT_TOOL_VERSION = '1.0.0';
