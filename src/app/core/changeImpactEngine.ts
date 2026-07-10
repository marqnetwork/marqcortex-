/**
 * CHANGE IMPACT ENGINE — phase-p1-implementation.md §2
 *
 * Prevents silent drift. When any of the trigger block types are modified
 * (revision accepted), the system sets:
 *   roi_recalc_required:  true
 *   proposal_auto_draft:  true  (auto-downgrade from ready_to_send / sent)
 *   contract_invalidated: true
 *   export_blocked:       true
 *
 * Special case: proposal_next_step only triggers if the `price` field changed.
 *
 * Auto-downgrade rule (spec §2 B):
 *   If proposal status is ready_to_send or sent → revert to draft.
 *
 * Revalidation requirement (spec §2 C):
 *   Before returning to ready_to_send: ROI recalculated + consistency validator passes.
 */

import type { BlockType } from './blockEngine';

// ════════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════════

export interface ChangeImpact {
  /** ROI engine re-run required. */
  roi_recalc_required:  boolean;
  /** Proposal should auto-revert to 'draft' if it was ready_to_send or sent. */
  proposal_auto_draft:  boolean;
  /** Contract PDF/clauses are now stale. */
  contract_invalidated: boolean;
  /** All export actions are blocked until revalidated. */
  export_blocked:       boolean;
  /** Human-readable reason for the impact trigger. */
  trigger_reason:       string;
  /** The block type(s) that triggered the impact. */
  trigger_block_types:  BlockType[];
}

/** Proposal statuses that auto-downgrade to 'draft' when triggered. */
export const AUTO_DOWNGRADE_STATUSES = new Set([
  'ready_to_send',
  'sent',
]);

// ════════════════════════════════════════════════════════════════════════════════
// TRIGGER CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Block types that always trigger full impact when a revision is accepted.
 * Matches spec §2 A trigger conditions.
 */
const FULL_TRIGGER_TYPES: ReadonlySet<BlockType> = new Set([
  'proposal_solution',
  'proposal_timeline',
  'proposal_team',
]);

/**
 * Block types that trigger only if a specific field changes (price-sensitive).
 * proposal_next_step → triggers if content.price changes.
 */
const PRICE_SENSITIVE_TYPES: ReadonlySet<BlockType> = new Set([
  'proposal_next_step',
]);

// ════════════════════════════════════════════════════════════════════════════════
// HELPER: Is the price field different between two content snapshots?
// ════════════════════════════════════════════════════════════════════════════════

function isPriceChanged(
  currentContent?:  Record<string, unknown>,
  proposedContent?: Record<string, unknown>,
): boolean {
  if (!currentContent || !proposedContent) return true; // conservative: assume changed
  return currentContent.price !== proposedContent.price;
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN FUNCTION — computeChangeImpact
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Computes the change impact for a given block type and content delta.
 *
 * Returns null if no impact is triggered.
 * Returns a ChangeImpact object if impact is triggered.
 *
 * @param blockType       The block type whose revision was just accepted.
 * @param currentContent  Content BEFORE the revision (block.content at time of acceptance).
 * @param proposedContent Content IN the accepted revision (revision.proposed_content).
 */
export function computeChangeImpact(
  blockType:        BlockType,
  currentContent?:  Record<string, unknown>,
  proposedContent?: Record<string, unknown>,
): ChangeImpact | null {
  // Always-trigger types
  if (FULL_TRIGGER_TYPES.has(blockType)) {
    return {
      roi_recalc_required:  true,
      proposal_auto_draft:  true,
      contract_invalidated: true,
      export_blocked:       true,
      trigger_reason:       `Block type "${blockType.replace(/_/g, ' ')}" modified — scope, timeline, or team changed.`,
      trigger_block_types:  [blockType],
    };
  }

  // Price-sensitive check for proposal_next_step
  if (PRICE_SENSITIVE_TYPES.has(blockType)) {
    if (isPriceChanged(currentContent, proposedContent)) {
      return {
        roi_recalc_required:  true,
        proposal_auto_draft:  true,
        contract_invalidated: true,
        export_blocked:       true,
        trigger_reason:       `Engagement price changed — investment reference updated. ROI recalculation required.`,
        trigger_block_types:  [blockType],
      };
    }
    return null; // price unchanged → no impact
  }

  return null; // no impact for this block type
}

/**
 * Convenience predicate: does this block type ALWAYS trigger impact
 * (used in UI to surface warnings before apply, e.g. in Copilot plan preview)?
 */
export function isAlwaysTrigger(blockType: BlockType): boolean {
  return FULL_TRIGGER_TYPES.has(blockType);
}

/**
 * Convenience predicate: is this a price-sensitive trigger type?
 */
export function isPriceSensitiveTrigger(blockType: BlockType): boolean {
  return PRICE_SENSITIVE_TYPES.has(blockType);
}

/**
 * Merge multiple ChangeImpact results into one (for batch operations).
 */
export function mergeImpacts(impacts: Array<ChangeImpact | null>): ChangeImpact | null {
  const active = impacts.filter((i): i is ChangeImpact => i !== null);
  if (active.length === 0) return null;

  return {
    roi_recalc_required:  active.some(i => i.roi_recalc_required),
    proposal_auto_draft:  active.some(i => i.proposal_auto_draft),
    contract_invalidated: active.some(i => i.contract_invalidated),
    export_blocked:       active.some(i => i.export_blocked),
    trigger_reason:       active.map(i => i.trigger_reason).join(' · '),
    trigger_block_types:  Array.from(new Set(active.flatMap(i => i.trigger_block_types))),
  };
}
