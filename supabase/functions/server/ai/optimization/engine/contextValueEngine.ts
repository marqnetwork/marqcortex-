/**
 * Context value engine (AI-01 Batch 3B, Part 6A).
 *
 * ── THE LARGEST LINE ITEM, AND THE MOST DANGEROUS ONE TO CUT ───────────────
 *
 * Input tokens dominate the bill of a typical agent step, so context is where
 * the money is. It is also where the system's instructions, its safety policy
 * and the current task live — which makes an over-eager optimiser here not
 * expensive but UNSAFE. Every rule below exists to keep the first fact from
 * being pursued at the expense of the second.
 *
 * ── FIVE RULES, IN THE ORDER THEY APPLY ────────────────────────────────────
 *
 *   1. PROMOTE. Items from an authority source are required whatever the caller
 *      declared. A caller that marked its safety policy optional has a bug, and
 *      the right response to that bug is not to bank the tokens.
 *
 *   2. DEDUPLICATE WITHIN NECESSITY. Two optional items with the same digest are
 *      one item. An optional item is NEVER deduplicated against a required one:
 *      dropping the optional copy would be right, and dropping the required copy
 *      because an optional twin exists would silently move an instruction into
 *      a slot that can later be trimmed. Required items are deduplicated only
 *      against each other.
 *
 *   3. RESERVE. Required tokens are subtracted from the ceiling BEFORE any
 *      optional item is considered. This is the mechanism by which optional
 *      content cannot displace required content — not a check afterwards, but an
 *      allowance that was never available to spend.
 *
 *   4. FAIL CLOSED. If the required set alone exceeds the ceiling, the engine
 *      throws `required_context_exceeds_ceiling`. It does not trim a required
 *      item, does not summarise one, and does not proceed with a partial
 *      authority set. A step that cannot afford its own rules must not run.
 *
 *   5. SELECT. Optional items are ordered by authority, then relevance, then
 *      freshness, then id — a total order, so the selection is reproducible —
 *      and admitted greedily until the optional allowance is gone. An item whose
 *      dependency did not make it is dropped with its own reason code, because
 *      half of a two-part instruction is worse than neither half.
 *
 * ── IT DOES NOT SUMMARISE ──────────────────────────────────────────────────
 *
 * No semantic compression, no embeddings, no model-assisted condensation.
 * Deduplication, relevance filtering and budgeted selection are deterministic;
 * summarisation is not, and a context whose contents depend on a model's mood
 * cannot be reproduced when somebody asks why an answer was wrong. The safe
 * compression that already exists — `agents/runtime/contextBuilder.ts` and its
 * per-section caps — remains the only mechanism that shortens an item.
 */

import type {
  ContextExclusion,
  ContextItem,
  ContextSelection,
} from '../contracts/context.ts';
import {
  ALWAYS_REQUIRED_SOURCES,
  CONTEXT_SOURCE_AUTHORITY,
} from '../contracts/context.ts';
import { compressionFailure } from '../contracts/compression.ts';

export interface ContextBudget {
  /**
   * Total prompt tokens available. Supplied by the caller from its OWN limits;
   * the engine treats it as a hard ceiling and never raises it.
   */
  readonly ceilingTokens: number;
  /**
   * Relevance below which an optional item is dropped as irrelevant, 0–100.
   *
   * Applied before the budget, so an irrelevant item is reported as irrelevant
   * rather than as having lost a competition for space. The two are different
   * facts about the run.
   */
  readonly minimumRelevance: number;
  /**
   * Freshness below which an optional item is dropped as stale, 0–100.
   *
   * Zero disables the check, which is the correct default for context that has
   * no meaningful age.
   */
  readonly minimumFreshness: number;
}

/** Promote authority sources to required, whatever the caller declared. */
function normalise(item: ContextItem): ContextItem {
  if (item.necessity === 'required') return item;
  if (!ALWAYS_REQUIRED_SOURCES.includes(item.source)) return item;
  return { ...item, necessity: 'required' };
}

function order(left: ContextItem, right: ContextItem): number {
  return (
    CONTEXT_SOURCE_AUTHORITY[left.source] - CONTEXT_SOURCE_AUTHORITY[right.source] ||
    right.relevance - left.relevance ||
    right.freshness - left.freshness ||
    left.itemId.localeCompare(right.itemId)
  );
}

/**
 * Choose the context worth paying for.
 *
 * Throws `required_context_exceeds_ceiling` — and only that — when the required
 * set does not fit. Every other outcome is a selection, possibly an empty
 * optional one.
 */
export function selectContext(
  items: readonly ContextItem[],
  budget: ContextBudget,
): ContextSelection {
  const ceiling = Math.max(0, Math.floor(budget.ceilingTokens));
  const normalised = items.map(normalise);
  const beforeTokens = normalised.reduce((sum, item) => sum + Math.max(0, item.estimatedTokens), 0);

  const excluded: ContextExclusion[] = [];
  const exclude = (item: ContextItem, reason: ContextExclusion['reason']): void => {
    excluded.push({
      itemId: item.itemId,
      source: item.source,
      reason,
      estimatedTokens: Math.max(0, item.estimatedTokens),
    });
  };

  // ── 1 & 2: partition, then deduplicate WITHIN each necessity ──────────────
  const required: ContextItem[] = [];
  const optional: ContextItem[] = [];
  const requiredDigests = new Set<string>();
  const optionalDigests = new Set<string>();

  for (const item of [...normalised].sort(order)) {
    if (item.necessity === 'required') {
      if (requiredDigests.has(item.digest)) {
        exclude(item, 'duplicate');
        continue;
      }
      requiredDigests.add(item.digest);
      required.push(item);
      continue;
    }
    if (optionalDigests.has(item.digest)) {
      exclude(item, 'duplicate');
      continue;
    }
    optionalDigests.add(item.digest);
    optional.push(item);
  }

  // An optional item that merely restates something already required is waste,
  // and dropping it is safe in a way the converse never is — the required copy
  // stays, so nothing is lost.
  const survivingOptional: ContextItem[] = [];
  for (const item of optional) {
    if (requiredDigests.has(item.digest)) {
      exclude(item, 'duplicate');
      continue;
    }
    survivingOptional.push(item);
  }

  // ── 3 & 4: reserve the required tokens, or fail closed ────────────────────
  const requiredTokens = required.reduce((sum, item) => sum + Math.max(0, item.estimatedTokens), 0);
  if (requiredTokens > ceiling) {
    throw compressionFailure(
      'required_context_exceeds_ceiling',
      'This task needs more required context than it is allowed to send.',
      {
        diagnostics:
          `required=${requiredTokens} ceiling=${ceiling} ` +
          `items=${required.length} (required context is never trimmed)`,
      },
    );
  }

  // ── 5: spend what is left on optional content ─────────────────────────────
  const included = new Set<string>(required.map((item) => item.itemId));
  let optionalAllowance = ceiling - requiredTokens;
  let optionalTokens = 0;

  for (const item of survivingOptional) {
    if (item.relevance < budget.minimumRelevance) {
      exclude(item, 'irrelevant');
      continue;
    }
    if (budget.minimumFreshness > 0 && item.freshness < budget.minimumFreshness) {
      exclude(item, 'stale');
      continue;
    }
    // Dependencies are checked against what has ALREADY been admitted, and the
    // ordering guarantees authority flows one way, so this is a single pass
    // rather than a fixed point. An optional item that depends on a lower-
    // authority item it was ordered before is dropped — which is the right
    // answer: an inverted dependency is a declaration error, not a puzzle.
    const missing = item.dependsOn.filter((dependency) => !included.has(dependency));
    if (missing.length > 0) {
      exclude(item, 'dependency_excluded');
      continue;
    }
    const tokens = Math.max(0, item.estimatedTokens);
    if (tokens > optionalAllowance) {
      exclude(item, 'token_budget');
      continue;
    }
    optionalAllowance -= tokens;
    optionalTokens += tokens;
    included.add(item.itemId);
  }

  const afterTokens = requiredTokens + optionalTokens;
  const reducedTokens = Math.max(0, beforeTokens - afterTokens);

  return {
    // Emitted in the engine's own authority order rather than the caller's, so
    // the selection is a total, reproducible sequence and two runs of the same
    // task produce identical manifests.
    includedItemIds: [...required, ...survivingOptional]
      .filter((item) => included.has(item.itemId))
      .map((item) => item.itemId),
    excluded,
    requiredTokens,
    optionalTokens,
    beforeTokens,
    afterTokens,
    reducedTokens,
    reductionPercent: beforeTokens === 0 ? 0 : Math.round((reducedTokens / beforeTokens) * 100),
    complete: excluded.length === 0,
  };
}
