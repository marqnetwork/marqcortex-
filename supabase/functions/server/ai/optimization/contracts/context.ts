/**
 * Context value contracts (AI-01 Batch 3B, Part 6A).
 *
 * ── REQUIRED IS A PROPERTY OF THE ITEM, NOT A SCORE IT COMPETES ON ─────────
 *
 * The single most dangerous way to save tokens is to summarise away the thing
 * that constrains the model. `necessity: 'required'` is therefore not a high
 * relevance value — it is a different kind of item. Required items are placed
 * FIRST, are never deduplicated against optional ones, are never trimmed, and
 * are never displaced by an optional item however relevant it claims to be.
 *
 * When the required set alone will not fit, the engine does not "do its best".
 * It FAILS CLOSED with `required_context_exceeds_ceiling`, because a step that
 * cannot afford its own rules is a step that must not run — the same judgement
 * `agents/runtime/contextBuilder.ts` already makes about its protected kinds,
 * stated here as a contract rather than as a behaviour.
 *
 * ── WHY THIS IS METADATA AND NEVER TEXT ────────────────────────────────────
 *
 * A `ContextItem` carries an id, a digest and a token count. It does not carry
 * the content. The optimiser can therefore deduplicate, rank, budget and audit
 * without a tenant's business data entering the cost layer at all, and the
 * caller — which already holds the text — applies the returned selection. The
 * agent runtime's context builder keeps doing the assembling; this decides what
 * is worth assembling.
 */

/** Where an item came from. Authority ordering is derived from this. */
export const CONTEXT_SOURCES = [
  'system_authority',
  'safety_policy',
  'workflow_objective',
  'current_task',
  'approval_binding',
  'trusted_prior_output',
  'agent_definition',
  'tool_result',
  'retrieved_evidence',
  'conversation_history',
] as const;

export type ContextSource = (typeof CONTEXT_SOURCES)[number];

/**
 * Authority order. Lower binds more strongly.
 *
 * Deliberately the same shape of decision as `SECTION_KINDS` in the agent
 * runtime's context builder: authority comes from the SOURCE, never from
 * anything the content or the caller's priority field claims, so a tool result
 * cannot outrank the instructions that constrain it.
 */
export const CONTEXT_SOURCE_AUTHORITY: Readonly<Record<ContextSource, number>> = {
  system_authority: 0,
  safety_policy: 1,
  workflow_objective: 2,
  current_task: 3,
  approval_binding: 4,
  trusted_prior_output: 5,
  agent_definition: 6,
  tool_result: 7,
  retrieved_evidence: 8,
  conversation_history: 9,
};

/**
 * Sources whose items are ALWAYS required, whatever the caller declares.
 *
 * A caller that marks its safety policy `optional` is a caller with a bug, and
 * the correct handling of that bug is not to save the tokens. `normalise`
 * promotes these back to required before anything else runs.
 */
export const ALWAYS_REQUIRED_SOURCES: readonly ContextSource[] = [
  'system_authority',
  'safety_policy',
  'workflow_objective',
  'current_task',
  'approval_binding',
];

export type ContextNecessity = 'required' | 'optional';

export type ContextSensitivity = 'public' | 'internal' | 'confidential' | 'restricted';

/**
 * One candidate piece of context, as metadata.
 *
 * `relevance` and `freshness` are caller-declared 0–100 scores used ONLY to
 * order optional items against each other. They cannot promote an optional item
 * past a required one, and they cannot demote a required one at all.
 */
export interface ContextItem {
  readonly itemId: string;
  readonly source: ContextSource;
  readonly necessity: ContextNecessity;
  /** Digest of the content. Deduplication compares these, never text. */
  readonly digest: string;
  readonly estimatedTokens: number;
  /** 0–100. Higher is more relevant. Optional items only. */
  readonly relevance: number;
  /** 0–100. Higher is fresher. Optional items only. */
  readonly freshness: number;
  readonly sensitivity: ContextSensitivity;
  /** Where the content came from, for audit. Bounded label. */
  readonly provenance: string;
  /**
   * Items this one is meaningless without.
   *
   * An optional item whose dependency was dropped is dropped too — including a
   * dropped item's dependants is how a context ends up carrying half of a
   * two-part instruction, which is worse than carrying neither.
   */
  readonly dependsOn: readonly string[];
}

export type ContextExclusionReason =
  | 'duplicate'
  | 'irrelevant'
  | 'stale'
  | 'dependency_excluded'
  | 'token_budget';

export interface ContextExclusion {
  readonly itemId: string;
  readonly source: ContextSource;
  readonly reason: ContextExclusionReason;
  readonly estimatedTokens: number;
}

/**
 * What the engine decided about a candidate set.
 *
 * `beforeTokens` and `afterTokens` are the two numbers the savings ledger
 * attributes context reduction from, and they are produced HERE rather than
 * recomputed by the ledger — one measurement, one owner, no possibility of the
 * two disagreeing about what was saved.
 */
export interface ContextSelection {
  readonly includedItemIds: readonly string[];
  readonly excluded: readonly ContextExclusion[];
  readonly requiredTokens: number;
  readonly optionalTokens: number;
  readonly beforeTokens: number;
  readonly afterTokens: number;
  /** Tokens removed. Always `beforeTokens - afterTokens`, never negative. */
  readonly reducedTokens: number;
  /** 0–100, rounded. Zero when nothing was removed. */
  readonly reductionPercent: number;
  /** True when every candidate survived. */
  readonly complete: boolean;
}
