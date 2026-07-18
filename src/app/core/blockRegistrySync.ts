/**
 * BLOCK REGISTRY SYNC — split/merge helpers for KV-backed persistence.
 *
 * The BlockRegistryPanel holds the *global* block stores (all proposals) and
 * filters by proposal via links. Persistence is per-proposal, so we need to:
 *   - extract just this proposal's blocks/revisions/locks to save, and
 *   - merge a stored snapshot back over the global stores on load,
 * without disturbing other proposals' blocks.
 *
 * Pure functions (type-only imports) so they are unit-testable in isolation.
 */
import type { Block, BlockRevision, BlockLink, BlockLock } from '@/app/core/blockEngine';

export interface BlockSubset {
  blocks:    Block[];
  revisions: BlockRevision[];
  locks:     BlockLock[];
}

/** The set of block_ids linked to a given proposal (membership is defined by links). */
export function proposalBlockIdSet(proposalId: string, links: BlockLink[]): Set<string> {
  return new Set(
    links
      .filter(l => l.entity_type === 'proposal' && l.entity_id === proposalId)
      .map(l => l.block_id),
  );
}

/** Pull just this proposal's blocks/revisions/locks out of the global stores. */
export function extractProposalSubset(
  ids: Set<string>,
  blocks: Block[],
  revisions: BlockRevision[],
  locks: BlockLock[],
): BlockSubset {
  return {
    blocks:    blocks.filter(b => ids.has(b.block_id)),
    revisions: revisions.filter(r => ids.has(r.block_id)),
    locks:     locks.filter(l => ids.has(l.block_id)),
  };
}

/**
 * Overlay a stored per-proposal snapshot onto the global stores.
 * Entries belonging to the proposal are taken from `stored`; every other
 * proposal's entries in `base` are left untouched. Blocks created within the
 * proposal that are not yet in `base` are appended.
 */
export function mergeProposalSubset(
  ids: Set<string>,
  base: BlockSubset,
  stored: BlockSubset,
): BlockSubset {
  const storedBlockById = new Map(stored.blocks.map(b => [b.block_id, b]));

  const blocks = base.blocks.map(b =>
    ids.has(b.block_id) && storedBlockById.has(b.block_id)
      ? storedBlockById.get(b.block_id)!
      : b,
  );
  for (const b of stored.blocks) {
    if (!blocks.some(x => x.block_id === b.block_id)) blocks.push(b);
  }

  return {
    blocks,
    revisions: [...base.revisions.filter(r => !ids.has(r.block_id)), ...stored.revisions],
    locks:     [...base.locks.filter(l => !ids.has(l.block_id)), ...stored.locks],
  };
}
