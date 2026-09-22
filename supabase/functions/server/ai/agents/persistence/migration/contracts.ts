/**
 * A2-P08 — the vocabulary of the agent source inventory and its migration
 * readiness.
 *
 * THE AGENT COUNTERPART OF `workflows/persistence/migration/contracts.ts`, and
 * deliberately NOT a copy of it. What is genuinely generic — the canonical
 * organization catalog, the explicit mapping manifest and its resolution — is
 * REUSED from BP-004 (`tenantMapping.ts`) rather than restated, because "which
 * organization does this source tenant mean" is one question with one answer
 * regardless of which runtime's rows are being asked about.
 *
 * What is agent-specific is declared here, and the differences are the point:
 *
 *   THE CHAIN IS NOT A PROOF. A workflow checkpoint's digest covers its whole
 *   content and its predecessor; BP-004 verifies it with the engine's own
 *   verifier and refuses a broken one. An agent checkpoint's `progressDigest`
 *   covers its PROGRESS alone and `previousDigest` is "whatever `latest()` said
 *   at write time". So the agent inventory classifies chain LINKAGE as
 *   evidence (contiguous or irregular), and reserves a blocking integrity
 *   finding for the one thing it can actually prove: a stored progress whose
 *   digest no longer matches it (`progress_digest_mismatch`).
 *
 *   THE POINTER HAS NO DIGEST. An agent run points at its chain by version
 *   alone (`checkpointVersion`). The recoverable crash window — checkpoint
 *   written, run not yet saved — is therefore recognised as "the tip is exactly
 *   one version ahead AND links to the checkpoint the pointer names".
 *
 *   NOTHING HERE BINDS THE TENANT INTO A DIGEST. See `transform.ts`: a tenant
 *   translation rewrites identity fields and no integrity value.
 *
 * Pure data. No database, no environment, no clock.
 */

import type {
  AgentApprovalRequest,
  AgentCheckpoint,
  AgentRunRecord,
  AgentRunState,
} from '../../contracts/runtime.ts';

/** One key-value row, exactly as the platform store holds it. */
export interface AgentSourceRow {
  readonly key: string;
  readonly value: unknown;
}

export const AGENT_SOURCE_KINDS = ['run', 'checkpoint', 'approval'] as const;
export type AgentSourceKind = (typeof AGENT_SOURCE_KINDS)[number];

/** Mirrors `kvAgentStores.ts`. Pinned equal by a test. */
export const AGENT_SOURCE_NAMESPACE: Readonly<Record<AgentSourceKind, string>> = {
  run: 'agent_run',
  checkpoint: 'agent_checkpoint',
  approval: 'agent_approval',
};

/** Mirrors `kvAgentStores.ts`. Pinned equal by a test. */
export const AGENT_SOURCE_SCHEMA: Readonly<Record<AgentSourceKind, string>> = {
  run: 'ai.agent.run.v1',
  checkpoint: 'ai.agent.checkpoint.v1',
  approval: 'ai.agent.approval.v1',
};

export const AGENT_SCHEMA_MARKER_FIELD = '_schema';
export const AGENT_CHECKPOINT_VERSION_WIDTH = 6;

// ── Row classification ──────────────────────────────────────────────────────

/**
 * How a source row was judged. `valid` is the only one that may be
 * transformed. `unknown_agent_namespace` is the one that is NOT a defect: a
 * row belonging to some other part of the platform, counted so the inventory
 * proves it saw the whole snapshot.
 */
export const AGENT_ROW_CLASSIFICATIONS = [
  'valid',
  'corrupt_json',
  'wrong_schema',
  'key_payload_tenant_mismatch',
  'key_payload_identity_mismatch',
  'invalid_key',
  'unknown_agent_namespace',
  'orphan_checkpoint',
  'orphan_approval',
  'duplicate_logical_identity',
  'progress_digest_mismatch',
] as const;

export type AgentRowClassification = (typeof AGENT_ROW_CLASSIFICATIONS)[number];

export const BLOCKING_AGENT_ROW_CLASSIFICATIONS: readonly AgentRowClassification[] =
  AGENT_ROW_CLASSIFICATIONS.filter(
    (classification) => classification !== 'valid' && classification !== 'unknown_agent_namespace',
  );

export function isBlockingAgentRow(classification: AgentRowClassification): boolean {
  return BLOCKING_AGENT_ROW_CLASSIFICATIONS.includes(classification);
}

export interface AgentInventoryRow {
  readonly key: string;
  readonly classification: AgentRowClassification;
  readonly kind?: AgentSourceKind;
  readonly sourceTenantId?: string;
  /** Run id, approval id, or `runId` for a checkpoint. */
  readonly identity?: string;
  readonly version?: number;
  /** Why this row was rejected. Never business content. */
  readonly detail?: string;
  /** The domain record, storage envelope removed. Present only when valid. */
  readonly record?: AgentRunRecord | AgentCheckpoint | AgentApprovalRequest;
}

// ── Bundle classification ───────────────────────────────────────────────────

/**
 * Where the run's pointer stands relative to its stored chain.
 *
 *   EMPTY_CHAIN                      pointer 0, nothing stored — a run created
 *                                    and interrupted before its entry
 *                                    checkpoint, or simply never checkpointed
 *   EXACT_TIP_MATCH                  pointer = tip
 *   RECOVERABLE_ONE_AHEAD_CANDIDATE  tip = pointer + 1 and the tip links to
 *                                    the checkpoint the pointer names (or has
 *                                    no predecessor when the pointer is 0) —
 *                                    the checkpoint-before-pointer crash window
 *   ACTUAL_POINTER_MISMATCH          anything else with a chain present
 *   POINTER_WITHOUT_CHAIN            pointer > 0 and nothing stored
 *
 * The one-ahead candidate is EVIDENCE, not repair. It is NOT blocking because
 * a faithful copy reproduces exactly the state the production authority holds
 * today — the runtime reads `latest()` for progress and would meet the same
 * tip in either store — and a migration that "fixed" it would be inventing a
 * run state no isolate ever wrote. It is counted and named so the transition
 * decision is taken against numbers.
 */
export const AGENT_POINTER_CLASSIFICATIONS = [
  'EMPTY_CHAIN',
  'EXACT_TIP_MATCH',
  'RECOVERABLE_ONE_AHEAD_CANDIDATE',
  'ACTUAL_POINTER_MISMATCH',
  'POINTER_WITHOUT_CHAIN',
] as const;

export type AgentPointerClassification = (typeof AGENT_POINTER_CLASSIFICATIONS)[number];

export const BLOCKING_AGENT_POINTER_CLASSIFICATIONS: readonly AgentPointerClassification[] = [
  'ACTUAL_POINTER_MISMATCH',
  'POINTER_WITHOUT_CHAIN',
];

/**
 * Chain linkage — EVIDENCE, never blocking on its own, because the agent
 * contract does not promise it (see the header). `CONTIGUOUS_LINKED` is
 * versions 1..n with each link naming its immediate predecessor's digest.
 */
export type AgentChainLinkage = 'EMPTY' | 'CONTIGUOUS_LINKED' | 'IRREGULAR';

export interface AgentRunBundle {
  readonly run: AgentRunRecord;
  /** Version order, oldest first. */
  readonly checkpoints: readonly AgentCheckpoint[];
  /** Newest first, the agent approval listing's order. */
  readonly approvals: readonly AgentApprovalRequest[];
  readonly pointer: AgentPointerClassification;
  readonly linkage: AgentChainLinkage;
  /** The run names a pending approval that is not stored. Evidence. */
  readonly danglingPendingApproval: boolean;
  /** Structured, non-business explanations. */
  readonly problems: readonly string[];
}

export function isTransformableAgentBundle(bundle: AgentRunBundle): boolean {
  return !BLOCKING_AGENT_POINTER_CLASSIFICATIONS.includes(bundle.pointer);
}

// ── Census ──────────────────────────────────────────────────────────────────

/**
 * Counted, not decided. The agent transition strategy (P08-C03, gated behind
 * the hosted estate) is chosen against these numbers.
 */
export interface AgentActiveRunCensus {
  readonly terminal: number;
  readonly active: number;
  readonly byState: Readonly<Record<AgentRunState, number>>;
  /** Runs parked on a human decision. */
  readonly waitingForApproval: number;
  /** Runs holding a sealed, unexecuted action. */
  readonly withPendingAction: number;
  /** Runs started by a workflow node (`context.workflowId`). */
  readonly workflowLinked: number;
  /** Runs created by a handoff (`context.parentRunId`). */
  readonly childRuns: number;
  /** Runs that have claimed a non-idempotent tool key. */
  readonly withClaimedToolKeys: number;
}

export interface AgentTenantInventory {
  readonly sourceTenantId: string;
  readonly bundles: readonly AgentRunBundle[];
  readonly runCount: number;
  readonly checkpointCount: number;
  readonly approvalCount: number;
  readonly pendingApprovalCount: number;
  readonly blockingRowCount: number;
  readonly orphanCheckpointCount: number;
  readonly orphanApprovalCount: number;
  readonly progressDigestMismatchCount: number;
  readonly pointerCounts: Readonly<Record<AgentPointerClassification, number>>;
  readonly irregularChainCount: number;
  readonly danglingPendingApprovalCount: number;
  readonly census: AgentActiveRunCensus;
  readonly problems: readonly string[];
}

export interface AgentSourceInventory {
  readonly rows: readonly AgentInventoryRow[];
  readonly tenants: readonly AgentTenantInventory[];
  readonly sourceRowCount: number;
  readonly recognizedAgentRowCount: number;
  readonly unknownAgentRowCount: number;
}

// ── Readiness ───────────────────────────────────────────────────────────────

/**
 * BP-004's vocabulary, deliberately: the strongest thing an inventory may say
 * is that a later, separately approved backfill may be written. There is no
 * value meaning "cut over".
 */
export type AgentReadinessVerdict = 'GO_FOR_LATER_BACKFILL_PACKET' | 'NO_GO';

export const AGENT_PREFLIGHT_TOOL = 'a2-p08-agent-migration-preflight';
export const AGENT_PREFLIGHT_TOOL_VERSION = '1.0.0';
