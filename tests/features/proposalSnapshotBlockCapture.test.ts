/**
 * PROPOSAL SNAPSHOT — block capture contract
 *
 * `createProposalSnapshot` (src/app/core/snapshotEngine.ts) froze an EMPTY
 * block set for every proposal, and had done since the engine was written.
 *
 * Three reads in one function named fields that their types do not declare, so
 * each evaluated to `undefined` at runtime:
 *
 *     src/app/core/snapshotEngine.ts(130,30) TS2339  BlockLink.linked_entity_type
 *     src/app/core/snapshotEngine.ts(130,69) TS2339  BlockLink.linked_entity_id
 *     src/app/core/snapshotEngine.ts(136,27) TS2339  Block.label
 *     src/app/core/snapshotEngine.ts(140,27) TS2339  Block.approved_by
 *     src/app/core/snapshotEngine.ts(141,27) TS2339  Block.approved_at
 *
 * The first two are the load-bearing pair. `BlockLink` declares `entity_type`
 * and `entity_id` (blockEngine §5); read as `linked_entity_*` the membership
 * filter compared `undefined === 'proposal'` for every link, matched nothing,
 * and handed an empty array to everything downstream. The snapshot's `blocks`,
 * `assumptions_snapshot` and `contract_snapshot` were therefore always `[]` —
 * a "Save Version" that saved no blocks, and an export that pulled from a
 * snapshot with nothing in it.
 *
 * `Block.label` does not exist either; the field is `title`, and `FrozenBlock`
 * spells it `label`. Approval is not on the block at all: `Block` carries no
 * approver, and `approved_by` / `approved_at` live on the `BlockRevision` that
 * `current_revision_id` points at, where `null` means unapproved.
 *
 * WHY THIS WAS SAFE TO REPAIR
 *   Purely client-side. The registry audit records both call sites — Export PDF
 *   (MQC-INT-127) and Save Version (MQC-INT-144) — as client-side engines with
 *   no backend call, so correcting the reads changes no request, no header and
 *   no stored record. This is the opposite of the ClientPortal auth cluster
 *   (see clientPortalAuthContract.test.ts), which is deliberately NOT repaired
 *   because it would alter what the browser sends over the wire.
 *
 * TESTING APPROACH
 *   snapshotEngine's only imports are type-only, so the runner can load it for
 *   real. These are behavioural assertions against the actual engine, not
 *   structural ones — the defect was that the function returned the wrong
 *   VALUE, and a source-shape assertion would not have caught it.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const engine = await import('../../src/app/core/snapshotEngine.ts');
const { createProposalSnapshot, SNAPSHOT_STORE } = engine as any;

const PROPOSAL_ID = 'prop_1';

function draft(): any {
  return {
    proposal_id: PROPOSAL_ID,
    financial_summary: null,
    executive_brief: { headline: 'x' },
    diagnosis_blocks: [],
    scope_boundaries: { included: [], excluded: [], assumptions: [] },
    next_step_offer: { label: 'book' },
  };
}

/** One BlockState, linked to PROPOSAL_ID under the names BlockLink declares. */
function blockState(over: {
  blockId: string;
  type: string;
  title: string;
  revisionId?: string;
  approvedBy?: string | null;
  approvedAt?: string | null;
  linkedTo?: string;
}): any {
  const revisionId = over.revisionId ?? `rev_${over.blockId}`;
  return {
    block: {
      block_id: over.blockId,
      block_type: over.type,
      title: over.title,
      content: { body: `content of ${over.blockId}` },
      status: 'accepted',
      version: 3,
      current_revision_id: revisionId,
    },
    revisions: [
      {
        revision_id: revisionId,
        approved_by: over.approvedBy ?? null,
        approved_at: over.approvedAt ?? null,
      },
    ],
    links: [
      { link_id: `lnk_${over.blockId}`, block_id: over.blockId, entity_type: 'proposal', entity_id: over.linkedTo ?? PROPOSAL_ID },
    ],
    lock: null,
    pending_revision: null,
  };
}

describe('createProposalSnapshot — the block set is actually captured', () => {
  beforeEach(() => {
    SNAPSHOT_STORE.length = 0;
  });

  it('freezes the blocks linked to the proposal, not an empty array', () => {
    const snap = createProposalSnapshot(
      draft(),
      [blockState({ blockId: 'b1', type: 'narrative', title: 'Summary' })],
      'user_1',
    );

    // The regression: this was [] for every proposal ever snapshotted.
    assert.equal(snap.content_snapshot.blocks.length, 1);
    assert.equal(snap.content_snapshot.blocks[0].block_id, 'b1');
  });

  it('reads the link under the names BlockLink declares (entity_type/entity_id)', () => {
    const linked = blockState({ blockId: 'mine', type: 'narrative', title: 'Mine' });
    const other = blockState({ blockId: 'theirs', type: 'narrative', title: 'Theirs', linkedTo: 'prop_OTHER' });

    const snap = createProposalSnapshot(draft(), [linked, other], 'user_1');

    const ids = snap.content_snapshot.blocks.map((b: any) => b.block_id);
    assert.deepEqual(ids, ['mine'], 'a block linked to another proposal must not be frozen into this one');
  });

  it("takes FrozenBlock.label from Block.title, since Block has no label", () => {
    const snap = createProposalSnapshot(
      draft(),
      [blockState({ blockId: 'b1', type: 'narrative', title: 'Executive Summary' })],
      'user_1',
    );

    assert.equal(snap.content_snapshot.blocks[0].label, 'Executive Summary');
  });

  it('takes approval from the accepted revision, and reports unapproved as absent', () => {
    const approved = blockState({
      blockId: 'ok', type: 'narrative', title: 'Approved',
      approvedBy: 'reviewer_1', approvedAt: '2026-03-01T00:00:00.000Z',
    });
    const pending = blockState({ blockId: 'pending', type: 'narrative', title: 'Pending' });

    const snap = createProposalSnapshot(draft(), [approved, pending], 'user_1');
    const [a, p] = snap.content_snapshot.blocks;

    assert.equal(a.approved_by, 'reviewer_1');
    assert.equal(a.approved_at, '2026-03-01T00:00:00.000Z');
    // null on the revision means unapproved; FrozenBlock spells that absent,
    // so a consumer doing `if (b.approved_by)` is not handed a null surprise.
    assert.equal(p.approved_by, undefined);
    assert.equal(p.approved_at, undefined);
  });

  it('only the accepted revision supplies approval, not merely the first one', () => {
    const state = blockState({ blockId: 'b1', type: 'narrative', title: 'T', revisionId: 'rev_current' });
    // A newer, still-unapproved revision sitting ahead of the accepted one.
    state.revisions.unshift({ revision_id: 'rev_draft', approved_by: 'WRONG', approved_at: 'WRONG' });

    const snap = createProposalSnapshot(draft(), [state], 'user_1');
    assert.notEqual(snap.content_snapshot.blocks[0].approved_by, 'WRONG');
  });

  it('the roi and contract sub-snapshots are populated from the same block set', () => {
    const snap = createProposalSnapshot(
      draft(),
      [
        blockState({ blockId: 'roi', type: 'roi_financial_snapshot', title: 'ROI' }),
        blockState({ blockId: 'cl', type: 'contract_clause', title: 'Clause' }),
      ],
      'user_1',
    );

    // These derive from proposalBlocks too, so the empty-filter defect emptied
    // them as well.
    assert.equal(snap.content_snapshot.assumptions_snapshot.length, 1);
    assert.equal(snap.content_snapshot.contract_snapshot.length, 1);
  });

  it('the frozen content is a copy, so later block edits cannot mutate a snapshot', () => {
    const state = blockState({ blockId: 'b1', type: 'narrative', title: 'T' });
    const snap = createProposalSnapshot(draft(), [state], 'user_1');

    state.block.content.body = 'edited after the freeze';

    assert.equal(snap.content_snapshot.blocks[0].content.body, 'content of b1');
  });
});
