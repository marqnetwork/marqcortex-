/**
 * SNAPSHOT ENGINE — proposal-p2-implementation.md §1
 *
 * Proposal Snapshot Freeze System.
 *
 * Rules:
 *   • Snapshot is created when proposal status transitions to "sent"
 *     OR on ready_to_send → export.
 *   • After creation, snapshot.status = "immutable" — never mutated.
 *   • Future block edits do NOT touch existing snapshots.
 *   • Exports always pull from snapshot, not live proposal.
 *   • Every subsequent send increments version_number.
 *   • Full audit trail preserved in SNAPSHOT_STORE.
 */

import type { ProposalDraft } from '@/app/types/cortex-types';
import type { BlockState }    from './blockEngine';

// ════════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════════

/** Frozen block snapshot — only the content field is preserved per block. */
export interface FrozenBlock {
  block_id:     string;
  block_type:   string;
  label:        string;
  content:      Record<string, unknown>;
  status:       string;
  version:      number;
  approved_by?: string;
  approved_at?: string;
}

/** Full content snapshot captured at freeze time. */
export interface SnapshotContent {
  /** All blocks belonging to this proposal, frozen at accept time. */
  blocks: FrozenBlock[];
  /** financial_summary from the live draft at snapshot time. */
  roi_snapshot: ProposalDraft['financial_summary'] | null;
  /** ROI assumptions extracted from roi_financial_snapshot blocks. */
  assumptions_snapshot: Record<string, unknown>[];
  /** Contract clauses extracted from contract_clause blocks. */
  contract_snapshot: Record<string, unknown>[];
  /** Frozen copies of key proposal sections. */
  executive_brief:    ProposalDraft['executive_brief'];
  diagnosis_blocks:   ProposalDraft['diagnosis_blocks'];
  scope_boundaries:   ProposalDraft['scope_boundaries'];
  next_step_offer:    ProposalDraft['next_step_offer'];
  solutions?:         ProposalDraft['solutions'];
  implementation_phases?: ProposalDraft['implementation_phases'];
}

/** The immutable snapshot record. */
export interface ProposalSnapshot {
  proposal_snapshot_id: string;
  proposal_id:          string;
  version_number:       number;
  version_hash:         string;
  created_at:           string;
  created_by:           string;
  content_snapshot:     SnapshotContent;
  /** Always "immutable" — never modified after creation. */
  status:               'immutable';
  /** The export doc type that triggered creation. */
  triggered_by_export?: string;
}

// ════════════════════════════════════════════════════════════════════════════════
// IN-MEMORY STORE (production: replace with Supabase insert/query)
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Module-level store — persists across renders within a session.
 * Production: replaced by Supabase `proposal_snapshots` table.
 */
export const SNAPSHOT_STORE: ProposalSnapshot[] = [];

// ════════════════════════════════════════════════════════════════════════════════
// HASH GENERATION
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Generates a deterministic version hash from all block contents.
 * Uses a simple djb2-style accumulator — not cryptographic, but sufficient
 * for audit / change-detection purposes in this context.
 *
 * Production: replace with Web Crypto SHA-256 of JSON.stringify(blocks).
 */
export function generateVersionHash(data: unknown): string {
  const str = JSON.stringify(data);
  let hash  = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash & hash; // convert to 32-bit int
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0').toUpperCase();
  return `SHA-${hex}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// SNAPSHOT ID GENERATOR
// ════════════════════════════════════════════════════════════════════════════════

function nextSnapshotId(store: ProposalSnapshot[]): string {
  const n = store.length + 1;
  return `PS-${String(n).padStart(4, '0')}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN FUNCTION — createProposalSnapshot
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Creates and stores an immutable snapshot of the proposal at this instant.
 *
 * Should be called:
 *   • When proposal transitions to "sent" via handleExportProposal.
 *   • Optionally when proposal reaches "ready_to_send" as a dry-run capture.
 *
 * Returns the snapshot — caller appends to SNAPSHOT_STORE.
 */
export function createProposalSnapshot(
  draft:       ProposalDraft,
  blockStates: BlockState[],
  userId:      string,
  triggeredBy?: string,
): ProposalSnapshot {
  const proposalBlocks = blockStates.filter(
    s => s.links.some(l => l.linked_entity_type === 'proposal' && l.linked_entity_id === draft.proposal_id),
  );

  const frozenBlocks: FrozenBlock[] = proposalBlocks.map(s => ({
    block_id:     s.block.block_id,
    block_type:   s.block.block_type,
    label:        s.block.label,
    content:      { ...s.block.content },
    status:       s.block.status,
    version:      s.block.version,
    approved_by:  s.block.approved_by,
    approved_at:  s.block.approved_at,
  }));

  const assumptionsBlocks = proposalBlocks
    .filter(s => s.block.block_type === 'roi_financial_snapshot')
    .map(s => ({ ...s.block.content }));

  const contractBlocks = proposalBlocks
    .filter(s => s.block.block_type === 'contract_clause')
    .map(s => ({ ...s.block.content }));

  const content: SnapshotContent = {
    blocks:               frozenBlocks,
    roi_snapshot:         draft.financial_summary ?? null,
    assumptions_snapshot: assumptionsBlocks,
    contract_snapshot:    contractBlocks,
    executive_brief:      { ...draft.executive_brief },
    diagnosis_blocks:     draft.diagnosis_blocks.map(d => ({ ...d })),
    scope_boundaries:     {
      included:    [...draft.scope_boundaries.included],
      excluded:    [...draft.scope_boundaries.excluded],
      assumptions: [...draft.scope_boundaries.assumptions],
    },
    next_step_offer:        { ...draft.next_step_offer },
    solutions:              draft.solutions ? draft.solutions.map(s => ({ ...s })) : undefined,
    implementation_phases:  draft.implementation_phases ? draft.implementation_phases.map(p => ({ ...p })) : undefined,
  };

  const versionHash = generateVersionHash(content);

  // Version number: 1 + count of existing snapshots for this proposal
  const existingSnapshots = SNAPSHOT_STORE.filter(s => s.proposal_id === draft.proposal_id);
  const versionNumber     = existingSnapshots.length + 1;

  const snapshot: ProposalSnapshot = {
    proposal_snapshot_id: nextSnapshotId(SNAPSHOT_STORE),
    proposal_id:          draft.proposal_id,
    version_number:       versionNumber,
    version_hash:         versionHash,
    created_at:           new Date().toISOString(),
    created_by:           userId,
    content_snapshot:     content,
    status:               'immutable',
    triggered_by_export:  triggeredBy,
  };

  // Append to module-level store
  SNAPSHOT_STORE.push(snapshot);

  return snapshot;
}

// ════════════════════════════════════════════════════════════════════════════════
// QUERIES
// ════════════════════════════════════════════════════════════════════════════════

/** Returns all snapshots for a proposal, newest-first. */
export function getSnapshotsByProposal(proposalId: string): ProposalSnapshot[] {
  return SNAPSHOT_STORE
    .filter(s => s.proposal_id === proposalId)
    .sort((a, b) => b.version_number - a.version_number);
}

/** Returns the most recent snapshot for a proposal, or null if none. */
export function getLatestSnapshot(proposalId: string): ProposalSnapshot | null {
  const all = getSnapshotsByProposal(proposalId);
  return all.length > 0 ? all[0] : null;
}

/** Returns whether the proposal has been edited since its last snapshot. */
export function isProposalDriftedFromSnapshot(
  draft:    ProposalDraft,
  snapshot: ProposalSnapshot,
): boolean {
  const currentHash = generateVersionHash({
    executive_brief:      draft.executive_brief,
    diagnosis_blocks:     draft.diagnosis_blocks,
    scope_boundaries:     draft.scope_boundaries,
    next_step_offer:      draft.next_step_offer,
    solutions:            draft.solutions,
    implementation_phases: draft.implementation_phases,
  });
  return currentHash !== snapshot.version_hash;
}
