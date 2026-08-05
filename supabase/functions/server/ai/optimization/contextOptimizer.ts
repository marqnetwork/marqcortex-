/**
 * Deterministic context and token optimisation (AI-01 Batch 3B).
 *
 * A PRE-PASS, NOT A SECOND CONTEXT BUILDER.
 *
 * `agents/runtime/contextBuilder.ts` owns authority order, fencing, per-kind
 * budgets, truncation and the manifest. None of that is repeated here, and this
 * module cannot promote a section, reorder the authority, unfence untrusted
 * content or raise a budget — it takes the contributions an agent offered,
 * removes what provably adds nothing, and hands the smaller set to the certified
 * builder. Everything the builder guarantees still holds afterwards, because the
 * builder still runs.
 *
 * WHAT IT REMOVES, AND WHY EACH ONE IS SAFE.
 *
 *   WHITESPACE NORMALISATION. Runs of blank lines and trailing spaces are
 *   collapsed. Tokens are charged for them and no meaning is carried by them.
 *   Normalisation happens BEFORE the duplicate check, so two sections that
 *   differ only in formatting are correctly seen as one.
 *
 *   CROSS-KIND DUPLICATES. The builder de-duplicates WITHIN a kind, on purpose:
 *   the same text as an objective and as history is legitimately both. But the
 *   same tool result contributed as `tool_result` and again as
 *   `retrieved_evidence` is one fact charged twice, and the model gains nothing
 *   from the second copy. The higher-authority occurrence is kept.
 *
 *   CONTAINED FRAGMENTS. A section whose entire normalised body appears inside
 *   another retained section of the same or higher authority is dropped. This is
 *   substring containment, not similarity — there is no threshold to tune and no
 *   case where a fragment survives removal carrying information its container
 *   does not have.
 *
 *   LOW-VALUE HISTORY ON SMALL WORK. When the step classifies `low`, recent
 *   history beyond the most recent contribution is dropped. This is the only
 *   rule that depends on the classification, and it is the only one that can
 *   remove something a model might have used — so it is confined to the class
 *   where the step is small enough that history is not what makes it answerable,
 *   and it never touches instructions, the agent definition, the objective, a
 *   checkpoint or a handoff payload.
 *
 * DETERMINISM IS THE POINT. The same contributions always produce the same
 * reduced set, in the same order, with the same reported saving. Nothing here
 * summarises, embeds, ranks by similarity or asks a model what matters — all
 * four would make the prompt irreproducible, which is the property every other
 * control in this runtime is built on.
 *
 * THE SAVING IS MEASURED, NOT ESTIMATED TWICE. Tokens saved are computed with
 * `estimatePromptTokens`, the same estimator the preflight and the spend guard
 * use, so a saving reported here is denominated in the same unit the ceilings
 * are enforced in.
 */

import type { ContextInput, ContextSectionKind } from '../agents/runtime/contextBuilder.ts';
import { SECTION_KINDS } from '../agents/runtime/contextBuilder.ts';
import { estimatePromptTokens } from '../agents/runtime/tokenIntelligence.ts';
import { digestValue } from '../agents/runtime/digest.ts';
import type { ComplexityClassification } from './complexity.ts';

export type ContextRemovalReason =
  | 'empty'
  | 'cross_kind_duplicate'
  | 'contained_in_higher_authority'
  | 'low_complexity_history';

export interface ContextRemoval {
  readonly sectionId: string;
  readonly kind: ContextSectionKind;
  readonly reason: ContextRemovalReason;
  readonly estimatedTokens: number;
}

export interface ContextOptimization {
  /** What to hand the certified builder. Same shape, fewer or smaller sections. */
  readonly inputs: readonly ContextInput[];
  readonly removed: readonly ContextRemoval[];
  /** Prompt tokens the reduction is expected to avoid. Never negative. */
  readonly tokensSaved: number;
  /** Characters removed, including whitespace normalisation. */
  readonly charsSaved: number;
  /** Digest of the reduced set, so two runs can be compared for identity. */
  readonly digest: string;
}

/** Kinds that are never removed or trimmed, whatever the classification. */
const PROTECTED_KINDS: readonly ContextSectionKind[] = [
  'system_instructions',
  'agent_definition',
  'objective',
  'checkpoint',
  'handoff_context',
];

/**
 * Collapse formatting without touching content.
 *
 * Three replacements and nothing clever: trailing whitespace per line, runs of
 * three or more newlines, and runs of spaces or tabs. A normaliser that stripped
 * punctuation or lower-cased would be changing what the model reads, which is a
 * different and much larger claim than "this costs tokens and says nothing".
 */
export function normalizeContent(content: string): string {
  return content
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function authorityOf(kind: ContextSectionKind): number {
  const index = SECTION_KINDS.indexOf(kind);
  return index === -1 ? SECTION_KINDS.length : index;
}

/**
 * Reduce a step's context contributions.
 *
 * Total: an unusable contribution is removed rather than raising, because a
 * malformed context section must not be able to stop a run that the certified
 * builder would happily have bounded.
 */
export function optimizeContext(
  inputs: readonly ContextInput[],
  classification: ComplexityClassification,
): ContextOptimization {
  const removed: ContextRemoval[] = [];
  let charsSaved = 0;
  let tokensSaved = 0;

  const drop = (
    input: ContextInput,
    content: string,
    reason: ContextRemovalReason,
  ): void => {
    removed.push({
      sectionId: input.sectionId,
      kind: input.kind,
      reason,
      estimatedTokens: estimatePromptTokens(content),
    });
    charsSaved += content.length;
    tokensSaved += estimatePromptTokens(content);
  };

  // Pass 1 — normalise, and account for what normalisation alone removed.
  const normalized: { input: ContextInput; content: string; authority: number }[] = [];
  for (const input of inputs) {
    const original = input.content ?? '';
    const content = normalizeContent(original);
    if (content === '') {
      drop(input, original, 'empty');
      continue;
    }
    charsSaved += Math.max(0, original.length - content.length);
    normalized.push({ input, content, authority: authorityOf(input.kind) });
  }

  // Pass 2 — authority order, then priority, then declaration order. The same
  // ordering the builder applies, so "the higher-authority occurrence is kept"
  // means the one the builder would itself have ranked first.
  const ordered = normalized
    .map((entry, index) => ({ ...entry, index }))
    .sort(
      (a, b) =>
        a.authority - b.authority ||
        b.input.priority - a.input.priority ||
        a.index - b.index,
    );

  // Pass 3 — cross-kind duplicates and contained fragments, plus the one
  // classification-dependent rule.
  const seenDigests = new Set<string>();
  const kept: { input: ContextInput; content: string }[] = [];
  let historyKept = 0;

  for (const entry of ordered) {
    const protectedKind = PROTECTED_KINDS.includes(entry.input.kind);

    if (!protectedKind) {
      const digest = digestValue(entry.content);
      if (seenDigests.has(digest)) {
        drop(entry.input, entry.content, 'cross_kind_duplicate');
        continue;
      }

      const contained = kept.some(
        (retained) =>
          retained.content.length > entry.content.length &&
          retained.content.includes(entry.content),
      );
      if (contained) {
        drop(entry.input, entry.content, 'contained_in_higher_authority');
        continue;
      }

      if (entry.input.kind === 'recent_history' && classification.complexity === 'low') {
        historyKept += 1;
        if (historyKept > 1) {
          drop(entry.input, entry.content, 'low_complexity_history');
          continue;
        }
      }

      seenDigests.add(digest);
    }

    kept.push({ input: entry.input, content: entry.content });
  }

  // Restore the caller's declaration order. The builder sorts by authority
  // itself, and handing it a set already re-ordered by this module would make
  // the two orderings two things that have to agree.
  const position = new Map(inputs.map((input, index) => [input.sectionId, index]));
  const reduced = kept
    .sort(
      (a, b) =>
        (position.get(a.input.sectionId) ?? 0) - (position.get(b.input.sectionId) ?? 0),
    )
    .map(({ input, content }) => ({ ...input, content }));

  return {
    inputs: reduced,
    removed,
    tokensSaved,
    charsSaved,
    digest: digestValue(
      reduced.map((input) => ({
        sectionId: input.sectionId,
        kind: input.kind,
        content: input.content,
      })),
    ),
  };
}
