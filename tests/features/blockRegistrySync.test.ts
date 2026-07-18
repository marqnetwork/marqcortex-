/**
 * BATCH 4 — BlockRegistryPanel persistence split/merge contract
 *
 * The panel persists only the current proposal's slice of the global block
 * stores. These tests lock the extract/merge round-trip so that:
 *   - saving pulls exactly this proposal's blocks/revisions/locks, and
 *   - loading overlays the stored slice without disturbing other proposals.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  proposalBlockIdSet,
  extractProposalSubset,
  mergeProposalSubset,
} from '../../src/app/core/blockRegistrySync.ts';

// Minimal shapes — only the fields the sync helpers read.
const links = [
  { link_id: 'l1', block_id: 'B-1', entity_type: 'proposal', entity_id: 'P-1', created_at: '' },
  { link_id: 'l2', block_id: 'B-2', entity_type: 'proposal', entity_id: 'P-1', created_at: '' },
  { link_id: 'l3', block_id: 'B-9', entity_type: 'proposal', entity_id: 'P-2', created_at: '' },
] as any;

const blocks = [
  { block_id: 'B-1', version: 1 },
  { block_id: 'B-2', version: 1 },
  { block_id: 'B-9', version: 5 }, // belongs to another proposal
] as any;

const revisions = [
  { revision_id: 'R-1', block_id: 'B-1' },
  { revision_id: 'R-9', block_id: 'B-9' },
] as any;

const locks = [
  { lock_id: 'K-9', block_id: 'B-9' },
] as any;

describe('proposalBlockIdSet', () => {
  it('collects only block_ids linked to the proposal', () => {
    const ids = proposalBlockIdSet('P-1', links);
    assert.deepEqual([...ids].sort(), ['B-1', 'B-2']);
  });
});

describe('extractProposalSubset', () => {
  it('pulls only this proposal’s blocks/revisions/locks', () => {
    const ids = proposalBlockIdSet('P-1', links);
    const subset = extractProposalSubset(ids, blocks, revisions, locks);
    assert.deepEqual(subset.blocks.map((b: any) => b.block_id), ['B-1', 'B-2']);
    assert.deepEqual(subset.revisions.map((r: any) => r.revision_id), ['R-1']);
    assert.deepEqual(subset.locks, []); // no locks belong to P-1
  });
});

describe('mergeProposalSubset', () => {
  it('overlays the stored slice without touching other proposals', () => {
    const ids = proposalBlockIdSet('P-1', links);
    const base = { blocks, revisions, locks };
    // Stored: B-1 advanced to v2, plus a new lock on B-2.
    const stored = {
      blocks: [{ block_id: 'B-1', version: 2 }, { block_id: 'B-2', version: 3 }],
      revisions: [{ revision_id: 'R-1', block_id: 'B-1' }, { revision_id: 'R-1b', block_id: 'B-1' }],
      locks: [{ lock_id: 'K-2', block_id: 'B-2' }],
    } as any;

    const merged = mergeProposalSubset(ids, base as any, stored);

    // B-1 replaced by stored v2, other proposal's B-9 untouched (v5 kept).
    assert.equal(merged.blocks.find((b: any) => b.block_id === 'B-1').version, 2);
    assert.equal(merged.blocks.find((b: any) => b.block_id === 'B-9').version, 5);
    // Proposal revisions replaced by stored; B-9's revision preserved.
    assert.deepEqual(merged.revisions.map((r: any) => r.revision_id).sort(), ['R-1', 'R-1b', 'R-9']);
    // Stored lock added; B-9's lock preserved.
    assert.deepEqual(merged.locks.map((l: any) => l.lock_id).sort(), ['K-2', 'K-9']);
  });

  it('round-trips: extract(merge(...)) equals the stored slice', () => {
    const ids = proposalBlockIdSet('P-1', links);
    const stored = {
      blocks: [{ block_id: 'B-1', version: 2 }, { block_id: 'B-2', version: 1 }],
      revisions: [{ revision_id: 'R-1', block_id: 'B-1' }],
      locks: [] as any[],
    } as any;
    const merged = mergeProposalSubset(ids, { blocks, revisions, locks } as any, stored);
    const reExtracted = extractProposalSubset(ids, merged.blocks, merged.revisions, merged.locks);
    assert.deepEqual(reExtracted.blocks.map((b: any) => b.block_id).sort(), ['B-1', 'B-2']);
    assert.deepEqual(reExtracted.revisions, stored.revisions);
    assert.deepEqual(reExtracted.locks, stored.locks);
  });
});
