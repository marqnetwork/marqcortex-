/**
 * The readiness fact lock (Part 7B, Phase 5).
 *
 * Constitution Article 6 — "math decides, the model explains" — expressed as a
 * reconciliation that runs after every generation, unconditionally, and reports
 * everything it had to do.
 *
 * ── WHY THIS EXISTS BESIDE `governance/factLock.ts` RATHER THAN INSTEAD ────
 *
 * The platform lock reconciles DOTTED PATHS on an object, and it is used here
 * for exactly the paths that are dotted: `readiness.overallScore`,
 * `readiness.band`, `readiness.domainScores`. It cannot address a LIST — a path
 * walker that meets an array returns "not found" — so `recommendations.rank`
 * and its three siblings are outside what any path list can express.
 *
 * That gap is the whole reason this module exists. A lock that protected the
 * three scalar paths and left the recommendation list alone would be a lock a
 * model could walk around by rewriting a rank, and the rank is the field a
 * reader acts on first.
 *
 * ── THE FOUR CASES, AND THE TWO THAT ARE USUALLY MISSED ────────────────────
 *
 *   CHANGED   the model wrote a different value  → restored, reported
 *   OMITTED   the model left the field out       → restored, reported
 *   INVENTED  the model produced a field with no authority behind it
 *                                                → removed, reported
 *   INVENTED  the model produced a whole RECOMMENDATION with no authority
 *   ENTRY     behind it                          → removed, reported
 *
 * The third and fourth are the ones an incomplete lock skips, and skipping them
 * inverts the guarantee: there is nothing to compare an invented value against,
 * so nothing looks wrong.
 *
 * ── UNCONDITIONAL ──────────────────────────────────────────────────────────
 *
 * There is no "the output looks unchanged, skip the reconciliation" path. Such
 * a check would be a comparison the model can influence, and a lock that can be
 * skipped is a lock that will be, by the output that was worth skipping it for.
 * `enforceReadinessFactLock` always rebuilds every locked value from the
 * authority.
 *
 * ── THE REPORT IS BOUNDED; THE CORRECTION IS NOT (Part 7D, F1) ─────────────
 *
 * The number of paths this function can report is driven by the model: an
 * invented recommendation entry contributes one path per authoritative
 * recommendation field, so enough of them overflow what `ReviewRecordContent`
 * declares. The CORRECTION stays unconditional and complete — every invented
 * entry is still removed, whatever the count — and only the list of path names
 * is summarised, with a final `+N more` entry stating exactly how many did not
 * fit. See `boundFactLockPaths` in `contracts/review.ts`.
 */

import { enforceFactLock } from '../../../governance/factLock.ts';
import type {
  ReadinessAuthority,
  ReadinessRecommendation,
} from '../contracts/readiness.ts';
import {
  AUTHORITATIVE_FIELDS,
  AUTHORITATIVE_RECOMMENDATION_FIELDS,
} from '../contracts/readiness.ts';
import { FACT_LOCK_REPORT, boundFactLockPaths } from '../contracts/review.ts';

/** What a model produced, before reconciliation. Shape-tolerant on purpose. */
export interface ProposedReview {
  readonly readiness?: unknown;
  readonly recommendations?: unknown;
  readonly [key: string]: unknown;
}

export interface ReadinessFactLockResult {
  /** The reconciled object. Every locked value is the authority's. */
  readonly content: Record<string, unknown>;
  /**
   * Locked paths whose value was changed or omitted, and put back.
   *
   * Bounded — see the header. A `+N more fact-lock paths` entry is the last
   * element when the report did not fit.
   */
  readonly restored: readonly string[];
  /** Locked values the model invented, and which were taken out. Bounded. */
  readonly removed: readonly string[];
  /**
   * Paths the lock ACTED ON, before the report was summarised.
   *
   * The correction is complete whatever these numbers are; they are here so a
   * caller — and the certification suite — can tell a bounded report from a
   * short one without re-deriving the lock.
   */
  readonly restoredCount: number;
  readonly removedCount: number;
}

/**
 * A recommendation id as it may appear inside a reported path.
 *
 * Model output, so bounded where the path is BUILT rather than trimmed out of
 * an assembled string later: a path whose id was cut mid-way still names the
 * field it is about, which is what a reader of the report needs.
 */
function pathId(id: string): string {
  return id.length > FACT_LOCK_REPORT.maxIdLength
    ? id.slice(0, FACT_LOCK_REPORT.maxIdLength)
    : id;
}

/** Deep structural equality over JSON values. Key order is not a difference. */
function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== typeof right) return false;
  if (left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => sameValue(item, right[index]));
  }
  if (typeof left === 'object') {
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => key in b && sameValue(a[key], b[key]));
  }
  return Number.isNaN(left) && Number.isNaN(right);
}

/**
 * Reconcile one generated review against the authority.
 *
 * `proposed` is whatever came back from the model, already parsed and already
 * through the platform's output guard. It is treated as untyped: a lock that
 * assumed the shape it is protecting would be a lock that trusted the thing it
 * is checking.
 */
export function enforceReadinessFactLock(
  proposed: ProposedReview,
  authority: ReadinessAuthority,
): ReadinessFactLockResult {
  // ── The scalar and nested-object half, through the platform lock ──
  //
  // Reused rather than reimplemented: `readiness.band` and its siblings are
  // exactly what a dotted-path lock is for, and a second implementation of the
  // same reconciliation would be a second set of edge cases.
  const scalar = enforceFactLock(
    { ...proposed } as Record<string, unknown>,
    { readiness: authority.readiness } as Record<string, unknown>,
    [...AUTHORITATIVE_FIELDS],
  );

  const restored = [...scalar.restored];
  const removed = [...scalar.removed];
  const content: Record<string, unknown> = { ...scalar.content };

  // ── The list half ──
  //
  // Authoritative entries are keyed by recommendation id. Every entry the
  // authority has is present with its authoritative fields; every entry it does
  // not have is removed whole.
  const authoritative = new Map<string, ReadinessRecommendation>(
    authority.recommendations.map((entry) => [entry.recommendationId, entry] as const),
  );

  const produced = Array.isArray(proposed.recommendations)
    ? (proposed.recommendations as unknown[])
    : [];
  const producedById = new Map<string, Record<string, unknown>>();

  for (const entry of produced) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.recommendationId === 'string' ? record.recommendationId : undefined;
    if (id === undefined) {
      // An entry with no id cannot be matched to an authority, so every
      // authoritative field on it is invention by definition.
      for (const field of AUTHORITATIVE_RECOMMENDATION_FIELDS) {
        if (field in record) removed.push(`recommendations.<unidentified>.${field}`);
      }
      continue;
    }
    if (!authoritative.has(id)) {
      // A WHOLE RECOMMENDATION NOBODY COMPUTED. Removed — always, and whatever
      // the count — and reported per locked field so the report says what
      // authority was claimed rather than merely that something was dropped.
      for (const field of AUTHORITATIVE_RECOMMENDATION_FIELDS) {
        removed.push(`recommendations.${pathId(id)}.${field}`);
      }
      continue;
    }
    // A duplicate id is the same claim made twice; the first is kept and the
    // second is treated as an entry the authority does not have.
    if (producedById.has(id)) {
      for (const field of AUTHORITATIVE_RECOMMENDATION_FIELDS) {
        removed.push(`recommendations.${pathId(id)}.${field}`);
      }
      continue;
    }
    producedById.set(id, record);
  }

  const reconciled: Record<string, unknown>[] = [];
  for (const entry of authority.recommendations) {
    const source = producedById.get(entry.recommendationId);
    // The model's non-authoritative fields survive — commentary belongs to it.
    // Every authoritative field is written from the authority, whatever was
    // there, which is what makes the reconciliation unconditional.
    const merged: Record<string, unknown> = { ...(source ?? {}) };

    for (const field of AUTHORITATIVE_RECOMMENDATION_FIELDS) {
      const authoritativeValue = entry[field];
      const producedValue = source === undefined ? undefined : source[field];
      const wasPresent = source !== undefined && field in source;
      if (!wasPresent || !sameValue(producedValue, authoritativeValue)) {
        restored.push(`recommendations.${entry.recommendationId}.${field}`);
      }
      merged[field] = authoritativeValue;
    }

    // The identity is authoritative too. A model that renamed one would have
    // detached the commentary from the thing it is about.
    merged.recommendationId = entry.recommendationId;
    merged.department = entry.department;
    reconciled.push(merged);
  }

  content.recommendations = reconciled;

  // THE CORRECTION ABOVE IS COMPLETE. Only the REPORT is held to the record's
  // declared bounds, and the counts of what was actually acted on travel beside
  // it so a summarised report is never mistaken for a short one.
  return {
    content,
    restored: boundFactLockPaths(restored),
    removed: boundFactLockPaths(removed),
    restoredCount: restored.length,
    removedCount: removed.length,
  };
}
