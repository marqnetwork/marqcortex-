/**
 * Avoided-call accounting and the optimisation score (AI-01 Batch 3B).
 *
 * THE CLAIM THIS LEDGER HAS TO SURVIVE. "We saved money" is the easiest untrue
 * statement a platform can make about itself: an optimisation that reports its
 * own success against a baseline it also chose will always look like a success.
 * So every figure here is defined against something the platform independently
 * measured, and the two halves are never mixed.
 *
 *   AVOIDED is what a call WOULD have cost, taken from the call it replaced. A
 *   cache hit is credited with the cost and usage the ORIGINAL call reported —
 *   money the control plane actually settled once, at a moment that is in the
 *   audit trail — not with a fresh estimate of what the skipped call might have
 *   cost. There is no way to inflate it, because nothing in the hit path is free
 *   to choose the number.
 *
 *   PROJECTED is what a cheaper routing decision is expected to avoid, priced at
 *   the same upper-bound rates the cost projection uses. It is carried in its
 *   own fields and never added to the avoided total, because a projection and a
 *   settled cost are different kinds of fact and reporting them as one is how a
 *   saving becomes a story.
 *
 * THE SCORE IS A RATIO, NOT A GRADE. `optimizationScore` is the share of the
 * work's total notional cost that was avoided: avoided ÷ (avoided + spent),
 * as an integer percentage. A run that spent nothing and avoided nothing scores
 * zero rather than one hundred — "perfect efficiency" for a run that did no work
 * is the kind of number that ends up on a slide.
 *
 * BOUNDED AND MONOTONIC. Every counter only increases, every input is clamped to
 * a non-negative integer, and the record carries no per-call history — a ledger
 * that grew a row per step would be a second copy of the step list.
 */

import type { AITokenUsage } from '../contracts/request.ts';
import type { CacheRefusal } from './promptCache.ts';

export interface OptimizationLedger {
  // ── Avoided: measured against calls that really happened ──────────────────
  /** Model calls not made because a stored governed answer was served. */
  readonly avoidedCalls: number;
  readonly avoidedPromptTokens: number;
  readonly avoidedCompletionTokens: number;
  readonly avoidedTotalTokens: number;
  /** Micro-USD the replaced calls originally cost. Never an estimate. */
  readonly avoidedMicroUsd: number;

  // ── Projected: expected savings from cheaper decisions ────────────────────
  /** Steps routed to a cheaper profile than the one requested. */
  readonly profileDowngrades: number;
  /** Indicative micro-USD those downgrades are expected to avoid. */
  readonly projectedDowngradeMicroUsd: number;
  /** Prompt tokens removed by deterministic context reduction. */
  readonly contextTokensSaved: number;
  /** Context sections removed as duplicate, contained or low value. */
  readonly contextSectionsRemoved: number;

  // ── Cache behaviour ───────────────────────────────────────────────────────
  readonly cacheLookups: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  /** Steps that were never eligible to be cached, by reason. */
  readonly cacheIneligible: number;

  // ── The denominator ───────────────────────────────────────────────────────
  /** Micro-USD actually settled through the control plane for this work. */
  readonly spentMicroUsd: number;
}

export function emptyOptimizationLedger(): OptimizationLedger {
  return {
    avoidedCalls: 0,
    avoidedPromptTokens: 0,
    avoidedCompletionTokens: 0,
    avoidedTotalTokens: 0,
    avoidedMicroUsd: 0,
    profileDowngrades: 0,
    projectedDowngradeMicroUsd: 0,
    contextTokensSaved: 0,
    contextSectionsRemoved: 0,
    cacheLookups: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheIneligible: 0,
    spentMicroUsd: 0,
  };
}

/** Clamp to a non-negative integer. A malformed figure contributes nothing. */
function count(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/**
 * A cache hit: one call not made.
 *
 * `usage` and `costMicroUsd` come from the stored entry, which recorded what the
 * original call actually consumed and cost.
 */
export function recordAvoidedCall(
  ledger: OptimizationLedger,
  input: { readonly usage: AITokenUsage; readonly costMicroUsd: number },
): OptimizationLedger {
  return {
    ...ledger,
    avoidedCalls: ledger.avoidedCalls + 1,
    avoidedPromptTokens: ledger.avoidedPromptTokens + count(input.usage.promptTokens),
    avoidedCompletionTokens: ledger.avoidedCompletionTokens + count(input.usage.completionTokens),
    avoidedTotalTokens: ledger.avoidedTotalTokens + count(input.usage.totalTokens),
    avoidedMicroUsd: ledger.avoidedMicroUsd + count(input.costMicroUsd),
    cacheLookups: ledger.cacheLookups + 1,
    cacheHits: ledger.cacheHits + 1,
  };
}

/** A lookup that found nothing. Counted, because a hit rate needs a denominator. */
export function recordCacheMiss(ledger: OptimizationLedger): OptimizationLedger {
  return {
    ...ledger,
    cacheLookups: ledger.cacheLookups + 1,
    cacheMisses: ledger.cacheMisses + 1,
  };
}

/**
 * A step that could never have been served from cache.
 *
 * Counted separately from a miss on purpose: a deployment with a low hit rate
 * and a high ineligible count has a policy question, and one with a low hit rate
 * and no ineligible steps has a cache question.
 */
export function recordCacheIneligible(
  ledger: OptimizationLedger,
  _reason: CacheRefusal,
): OptimizationLedger {
  return { ...ledger, cacheIneligible: ledger.cacheIneligible + 1 };
}

/** A step routed to a cheaper profile than the agent requested. */
export function recordProfileDowngrade(
  ledger: OptimizationLedger,
  projectedSavingMicroUsd: number,
): OptimizationLedger {
  return {
    ...ledger,
    profileDowngrades: ledger.profileDowngrades + 1,
    projectedDowngradeMicroUsd:
      ledger.projectedDowngradeMicroUsd + count(projectedSavingMicroUsd),
  };
}

/** Deterministic context reduction, in the unit the ceilings are enforced in. */
export function recordContextSaving(
  ledger: OptimizationLedger,
  input: { readonly tokensSaved: number; readonly sectionsRemoved: number },
): OptimizationLedger {
  return {
    ...ledger,
    contextTokensSaved: ledger.contextTokensSaved + count(input.tokensSaved),
    contextSectionsRemoved: ledger.contextSectionsRemoved + count(input.sectionsRemoved),
  };
}

/** Money the control plane settled. The score's denominator, in part. */
export function recordSpend(ledger: OptimizationLedger, microUsd: number): OptimizationLedger {
  return { ...ledger, spentMicroUsd: ledger.spentMicroUsd + count(microUsd) };
}

/** Fold one ledger into another. Used to roll runs up into a report. */
export function mergeOptimizationLedgers(
  a: OptimizationLedger,
  b: OptimizationLedger,
): OptimizationLedger {
  return {
    avoidedCalls: a.avoidedCalls + b.avoidedCalls,
    avoidedPromptTokens: a.avoidedPromptTokens + b.avoidedPromptTokens,
    avoidedCompletionTokens: a.avoidedCompletionTokens + b.avoidedCompletionTokens,
    avoidedTotalTokens: a.avoidedTotalTokens + b.avoidedTotalTokens,
    avoidedMicroUsd: a.avoidedMicroUsd + b.avoidedMicroUsd,
    profileDowngrades: a.profileDowngrades + b.profileDowngrades,
    projectedDowngradeMicroUsd: a.projectedDowngradeMicroUsd + b.projectedDowngradeMicroUsd,
    contextTokensSaved: a.contextTokensSaved + b.contextTokensSaved,
    contextSectionsRemoved: a.contextSectionsRemoved + b.contextSectionsRemoved,
    cacheLookups: a.cacheLookups + b.cacheLookups,
    cacheHits: a.cacheHits + b.cacheHits,
    cacheMisses: a.cacheMisses + b.cacheMisses,
    cacheIneligible: a.cacheIneligible + b.cacheIneligible,
    spentMicroUsd: a.spentMicroUsd + b.spentMicroUsd,
  };
}

/**
 * The share of notional cost that was avoided, as an integer 0–100.
 *
 * Only the AVOIDED total participates. Projected downgrade savings are
 * deliberately excluded: they are what the platform expected to save by choosing
 * a cheaper route, and the money it did spend on that route is already in
 * `spentMicroUsd`. Counting both would credit the same decision twice — once for
 * being cheap and once for not being expensive.
 */
export function optimizationScore(ledger: OptimizationLedger): number {
  const notional = ledger.avoidedMicroUsd + ledger.spentMicroUsd;
  if (notional <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((ledger.avoidedMicroUsd * 100) / notional)));
}

/** Cache hit rate as an integer 0–100. Zero when nothing was ever looked up. */
export function cacheHitRate(ledger: OptimizationLedger): number {
  if (ledger.cacheLookups <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((ledger.cacheHits * 100) / ledger.cacheLookups)));
}

/** A ledger read back from storage, made total. Unknown fields become zero. */
export function coerceOptimizationLedger(value: unknown): OptimizationLedger {
  const empty = emptyOptimizationLedger();
  if (typeof value !== 'object' || value === null) return empty;
  const stored = value as Record<string, unknown>;
  const read = (key: keyof OptimizationLedger): number => count(stored[key] as number | undefined);
  return {
    avoidedCalls: read('avoidedCalls'),
    avoidedPromptTokens: read('avoidedPromptTokens'),
    avoidedCompletionTokens: read('avoidedCompletionTokens'),
    avoidedTotalTokens: read('avoidedTotalTokens'),
    avoidedMicroUsd: read('avoidedMicroUsd'),
    profileDowngrades: read('profileDowngrades'),
    projectedDowngradeMicroUsd: read('projectedDowngradeMicroUsd'),
    contextTokensSaved: read('contextTokensSaved'),
    contextSectionsRemoved: read('contextSectionsRemoved'),
    cacheLookups: read('cacheLookups'),
    cacheHits: read('cacheHits'),
    cacheMisses: read('cacheMisses'),
    cacheIneligible: read('cacheIneligible'),
    spentMicroUsd: read('spentMicroUsd'),
  };
}
