/**
 * The Token Optimization Engine (AI-01 Batch 3B).
 *
 * Runs before EVERY billable model step and answers two questions: what should
 * this call actually see, and can the platform afford it?
 *
 * THE TEN STEPS, IN THE ORDER THEY RUN.
 *
 *   1  build the required context from the node's declarations
 *   2  estimate tokens per section
 *   3  detect duplicate content
 *   4  remove duplicate content
 *   5  apply per-section ceilings
 *   6  trim the lowest-authority history first
 *   7  include retrieval only where the node declared it required
 *   8  include memory only where it is explicitly approved
 *   9  calculate the expected completion allowance
 *  10  compare against the node, workflow, agent, actor, organization and
 *      platform ceilings, and choose one action
 *
 * DO NOT LOAD ALL AVAILABLE CONTEXT BY DEFAULT. That is the rule this module
 * exists to enforce. A section is included because the node declared it needed,
 * or because it is optional AND fits AND is fresh enough. Everything excluded is
 * named in the manifest with a reason, because "the model did not know X" is
 * otherwise an unanswerable question — and it is the first question asked when a
 * workflow produces a wrong answer.
 *
 * TRUSTED INSTRUCTIONS STAY ABOVE UNTRUSTED DATA. Rendering is delegated to the
 * hardened Batch 3A `buildContext`, which owns the authority ordering and the
 * per-section fence with its unpredictable nonce. This module SELECTS and TRIMS;
 * it does not re-implement fencing, because a second fence implementation is a
 * second thing to get wrong and the first one has already survived an
 * independent review that broke an earlier version of it.
 *
 * NO SEMANTIC SUMMARISATION. Batch 3B compresses by deduplicating, by dropping
 * the lowest-authority content, and by truncating on a character boundary with a
 * visible marker. Every one of those is reproducible. An LLM-summarised context
 * would make the token estimate — and therefore the budget control built on it —
 * non-deterministic, which is the property the rest of this engine is built on.
 *
 * SAVINGS ARE DIFFERENCES BETWEEN TWO COMPARABLE MEASUREMENTS, and the word
 * "comparable" is doing work. An earlier revision measured the baseline as the raw
 * character count of every candidate section and the final figure as the RENDERED
 * prompt — which includes section headings and the per-section fence. Those are not
 * the same unit: on a node with nothing to trim the "final" figure came out larger
 * than the "original", and a saving computed between them would have been noise
 * dressed as arithmetic.
 *
 * So the baseline is now a full second render: every candidate section, at full
 * length, through the same builder, at an unbounded budget. Both numbers are then
 * rendered prompt tokens, the subtraction means something, and a reviewer can redo
 * it. The extra build is bounded by the node's declared section cap and is
 * deterministic, which is a cheap price for a figure that is actually checkable.
 */

import type {
  WorkflowContextDeclaration,
  WorkflowModelNode,
} from '../contracts/workflow.ts';
import type { BuiltContext, ContextInput, ContextSectionKind } from '../../agents/runtime/contextBuilder.ts';
import { buildContext } from '../../agents/runtime/contextBuilder.ts';
import { estimatePromptTokens } from '../../agents/runtime/tokenIntelligence.ts';
import { digestValue } from '../../agents/runtime/digest.ts';

/** Version of the optimizer's decision rules. Recorded on every manifest. */
export const OPTIMIZER_VERSION = '1.0.0';

/** Authority bands that carry instruction rather than evidence. */
const INSTRUCTION_AUTHORITIES: readonly WorkflowContextDeclaration['authority'][] = [
  'system_instructions',
  'agent_definition',
  'objective',
];

/** Authority bands the optimizer trims first, in the order it trims them. */
const TRIM_ORDER: readonly WorkflowContextDeclaration['authority'][] = [
  'recent_history',
  'retrieved_evidence',
  'tool_result',
  'approved_memory',
  'handoff_context',
  'checkpoint',
];

export type SectionExclusionReason =
  | 'absent'
  | 'empty'
  | 'duplicate'
  | 'stale'
  | 'optional_not_required'
  | 'memory_not_approved'
  | 'section_ceiling'
  | 'history_trimmed'
  | 'total_budget'
  | 'cross_tenant';

export interface ContextManifestSection {
  readonly sectionId: string;
  readonly source: string;
  readonly authority: WorkflowContextDeclaration['authority'];
  readonly relevanceReason: string;
  readonly required: boolean;
  readonly maxTokens: number;
  readonly sensitivity: string;
  readonly tenantScope: string;
  readonly digest: string;
  readonly originalTokens: number;
  readonly finalTokens: number;
  readonly truncated: boolean;
}

export interface ContextManifestExclusion {
  readonly sectionId: string;
  readonly authority: WorkflowContextDeclaration['authority'];
  readonly reason: SectionExclusionReason;
  readonly originalTokens: number;
}

/**
 * The record of what the model saw and what it did not.
 *
 * `authorityOrder` is recorded explicitly rather than implied by array position,
 * so a reviewer can confirm the fence ordering held without re-deriving it from
 * the renderer's rules.
 */
export interface WorkflowContextManifest {
  readonly nodeId: string;
  readonly optimizerVersion: string;
  readonly included: readonly ContextManifestSection[];
  readonly excluded: readonly ContextManifestExclusion[];
  readonly authorityOrder: readonly string[];
  readonly originalContextTokens: number;
  readonly finalContextTokens: number;
  readonly savedTokens: number;
  readonly budgetTokens: number;
  readonly digest: string;
}

export interface TokenSavingsBreakdown {
  readonly originalContextTokens: number;
  readonly finalContextTokens: number;
  readonly duplicateTokensRemoved: number;
  readonly historyTokensRemoved: number;
  readonly retrievalTokensAvoided: number;
  readonly memoryTokensAvoided: number;
  readonly completionTokensReduced: number;
  readonly cachedTokensUsed: number;
  readonly totalTokensSaved: number;
}

export type OptimizationAction =
  | 'execute'
  | 'trim'
  | 'compress'
  | 'reduce_completion'
  | 'route_smaller_profile'
  | 'require_approval'
  | 'deny';

export interface OptimizationDecision {
  readonly action: OptimizationAction;
  readonly reason: string;
  readonly diagnostics: string;
  /** Which ceiling bound the decision, when one did. */
  readonly boundBy?:
    | 'node'
    | 'workflow'
    | 'agent'
    | 'actor'
    | 'organization'
    | 'platform';
}

/** Every ceiling the optimizer compares a step against, in widening order. */
export interface TokenCeilings {
  readonly nodeTokens: number;
  readonly workflowRemainingTokens: number;
  readonly workflowMaxPromptTokens: number;
  readonly workflowMaxCompletionTokens: number;
  /** Remaining allowance of the agent that owns this step, when inside one. */
  readonly agentRemainingTokens?: number;
  /** Per-actor allowance, when the deployment sets one. */
  readonly actorRemainingTokens?: number;
  readonly organizationRemainingTokens?: number;
  readonly platformRemainingTokens?: number;
}

/** One candidate section, already resolved to text by the caller. */
export interface ResolvedContextSection {
  readonly declaration: WorkflowContextDeclaration;
  /** Resolved content, or undefined when the mapping found nothing. */
  readonly content: string | undefined;
  /** Age of the value in milliseconds, when the caller can determine it. */
  readonly ageMs?: number;
  /** True when this section is approved memory a human signed off. */
  readonly memoryApproved?: boolean;
}

export interface OptimizeContextInput {
  readonly node: WorkflowModelNode;
  readonly sections: readonly ResolvedContextSection[];
  /** Trusted instruction text the engine always supplies. Never trimmed. */
  readonly systemInstructions: string;
  readonly objective: string;
  readonly ceilings: TokenCeilings;
  /** Completion allowance the routed profile offers, before reduction. */
  readonly completionAllowance: number;
  /** Organization the run belongs to. Cross-tenant sections are refused. */
  readonly organizationId: string;
  /** Tokens a cache hit already saved on this node, if any. */
  readonly cachedTokensUsed?: number;
  /** Pinned nonce source. Tests only; production uses the hardened default. */
  readonly nonce?: () => string;
}

export interface OptimizedContext {
  readonly built: BuiltContext;
  readonly manifest: WorkflowContextManifest;
  readonly savings: TokenSavingsBreakdown;
  readonly promptTokens: number;
  readonly completionAllowance: number;
  readonly decision: OptimizationDecision;
  readonly evidenceSections: number;
}

/** Map a workflow authority band onto the Batch 3A renderer's section kind. */
function sectionKindFor(
  authority: WorkflowContextDeclaration['authority'],
): ContextSectionKind {
  // The two vocabularies are deliberately identical in content and separate in
  // type: the workflow declares authority in its own contract, and the renderer
  // owns the ordering. A direct cast would couple a definition's data model to
  // an internal enum of another module.
  return authority as ContextSectionKind;
}

/**
 * Select, deduplicate, trim and render.
 *
 * The unoptimized estimate is computed first, from every candidate at full
 * length, because every saving reported below is that number minus the final
 * one. Computing it afterwards from what survived would make the savings
 * tautologically zero.
 */
export function optimizeWorkflowContext(input: OptimizeContextInput): OptimizedContext {
  const { node } = input;
  const budgetTokens = Math.max(
    1,
    Math.min(
      node.tokenAllowance,
      input.ceilings.workflowMaxPromptTokens,
      Math.max(1, input.ceilings.workflowRemainingTokens - input.completionAllowance),
    ),
  );

  /** Sections dropped before rendering, with the reason each was dropped. */
  const excluded: ContextManifestExclusion[] = [];
  const exclude = (
    declaration: WorkflowContextDeclaration,
    reason: SectionExclusionReason,
    originalTokens: number,
  ): void => {
    excluded.push({
      sectionId: declaration.sectionId,
      authority: declaration.authority,
      reason,
      originalTokens,
    });
  };

  // ── 1–2: build candidates and estimate per section ────────────────────────
  interface Candidate {
    readonly declaration: WorkflowContextDeclaration;
    readonly content: string;
    readonly originalTokens: number;
    readonly digest: string;
  }

  const candidates: Candidate[] = [];
  for (const section of input.sections) {
    const declaration = section.declaration;
    const content = section.content?.trim() ?? '';
    // Per-section raw estimate. Used for the per-exclusion figures in the manifest,
    // where "how big was the thing we dropped?" is the question — not for the
    // baseline total, which is a rendered figure. See the module header.
    const originalTokens = estimatePromptTokens(content);

    if (section.content === undefined) {
      exclude(declaration, 'absent', 0);
      continue;
    }
    if (content === '') {
      exclude(declaration, 'empty', 0);
      continue;
    }
    // A section declared for another tenant scope never enters the prompt, and
    // it is refused before anything else looks at it. Tenant isolation is not a
    // budget question and must not be reachable by relaxing a budget.
    if (declaration.tenantScope !== 'run_organization' && declaration.tenantScope !== 'platform') {
      exclude(declaration, 'cross_tenant', originalTokens);
      continue;
    }
    // ── 7: retrieval only where the node declared it required ──────────────
    if (declaration.authority === 'retrieved_evidence' && !declaration.required) {
      exclude(declaration, 'optional_not_required', originalTokens);
      continue;
    }
    // ── 8: memory only when explicitly approved ────────────────────────────
    if (declaration.authority === 'approved_memory' && section.memoryApproved !== true) {
      exclude(declaration, 'memory_not_approved', originalTokens);
      continue;
    }
    // Freshness. A required section that is stale is still refused: serving a
    // model a value the definition itself called too old is worse than serving
    // it nothing, because the answer looks informed.
    if (
      declaration.maxAgeMs > 0 &&
      section.ageMs !== undefined &&
      section.ageMs > declaration.maxAgeMs
    ) {
      exclude(declaration, 'stale', originalTokens);
      continue;
    }

    candidates.push({
      declaration,
      content,
      originalTokens,
      digest: digestValue(content),
    });
  }

  // ── 3–4: duplicate detection and removal ─────────────────────────────────
  //
  // By content digest WITHIN an authority band: the same tool result contributed
  // twice is one section, while identical text appearing as both an objective
  // and a history entry is legitimately both.
  const seen = new Set<string>();
  const deduped: Candidate[] = [];
  let duplicateTokensRemoved = 0;
  for (const candidate of candidates) {
    const key = `${candidate.declaration.authority}:${candidate.digest}`;
    if (seen.has(key)) {
      duplicateTokensRemoved += candidate.originalTokens;
      exclude(candidate.declaration, 'duplicate', candidate.originalTokens);
      continue;
    }
    seen.add(key);
    deduped.push(candidate);
  }

  // ── 5: per-section ceilings ──────────────────────────────────────────────
  interface Clipped extends Candidate {
    readonly clipped: string;
    readonly finalTokens: number;
    readonly truncated: boolean;
  }
  const clipped: Clipped[] = deduped.map((candidate) => {
    const cap = Math.max(1, candidate.declaration.maxTokens);
    if (candidate.originalTokens <= cap) {
      return {
        ...candidate,
        clipped: candidate.content,
        finalTokens: candidate.originalTokens,
        truncated: false,
      };
    }
    // Four bytes per token is the ratio the platform's estimator uses, so the
    // cap and the estimate cannot disagree about what fits.
    const characterCap = Math.max(80, cap * 4);
    const body = `${candidate.content.slice(0, characterCap)}\n[... trimmed to the section ceiling ...]`;
    return {
      ...candidate,
      clipped: body,
      finalTokens: estimatePromptTokens(body),
      truncated: true,
    };
  });

  // ── 6: trim the lowest authority first ───────────────────────────────────
  //
  // Instruction bands are never dropped: a context that discarded the rules to
  // fit the evidence has inverted the exercise, and a step that cannot afford
  // its own rules is refused rather than run unconstrained.
  const trimPriority = (authority: WorkflowContextDeclaration['authority']): number => {
    const index = TRIM_ORDER.indexOf(authority);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };

  const instruction = clipped.filter((entry) =>
    INSTRUCTION_AUTHORITIES.includes(entry.declaration.authority),
  );
  const trimmable = clipped
    .filter((entry) => !INSTRUCTION_AUTHORITIES.includes(entry.declaration.authority))
    .sort(
      (a, b) =>
        // Required content is kept over optional content of the same band, then
        // higher declared priority, then the trim order, then the section id so
        // the result is total.
        Number(b.declaration.required) - Number(a.declaration.required) ||
        b.declaration.priority - a.declaration.priority ||
        trimPriority(a.declaration.authority) - trimPriority(b.declaration.authority) ||
        a.declaration.sectionId.localeCompare(b.declaration.sectionId),
    );

  const instructionTokens =
    estimatePromptTokens(input.systemInstructions) +
    estimatePromptTokens(input.objective) +
    instruction.reduce((sum, entry) => sum + entry.finalTokens, 0);

  const kept: Clipped[] = [...instruction];
  let used = instructionTokens;
  let historyTokensRemoved = 0;
  let retrievalTokensAvoided = 0;
  let memoryTokensAvoided = 0;

  for (const entry of trimmable) {
    if (used + entry.finalTokens <= budgetTokens) {
      kept.push(entry);
      used += entry.finalTokens;
      continue;
    }
    // A REQUIRED section that does not fit is not silently dropped. It is kept,
    // and the ceiling comparison below is what refuses the step — the alternative
    // is a model call missing the evidence its own definition said it needed,
    // reported as a success.
    if (entry.declaration.required) {
      kept.push(entry);
      used += entry.finalTokens;
      continue;
    }
    const reason: SectionExclusionReason =
      entry.declaration.authority === 'recent_history' ? 'history_trimmed' : 'total_budget';
    exclude(entry.declaration, reason, entry.originalTokens);
    if (entry.declaration.authority === 'recent_history') {
      historyTokensRemoved += entry.finalTokens;
    } else if (entry.declaration.authority === 'retrieved_evidence') {
      retrievalTokensAvoided += entry.finalTokens;
    } else if (entry.declaration.authority === 'approved_memory') {
      memoryTokensAvoided += entry.finalTokens;
    }
  }

  for (const entry of excluded) {
    if (entry.reason === 'optional_not_required') retrievalTokensAvoided += entry.originalTokens;
    if (entry.reason === 'memory_not_approved') memoryTokensAvoided += entry.originalTokens;
  }

  // ── Render through the hardened Batch 3A builder ──────────────────────────
  const inputs: ContextInput[] = [
    {
      sectionId: 'workflow_instructions',
      kind: 'system_instructions',
      label: 'Workflow instructions',
      content: input.systemInstructions,
      trusted: true,
      priority: 100,
    },
    {
      sectionId: 'node_objective',
      kind: 'objective',
      label: 'Node objective',
      content: input.objective,
      // The objective derives from a definition the platform owns, but it is
      // rendered through the objective band rather than as a trusted
      // instruction: `buildContext` treats the band as authority and a caller
      // cannot promote content by asserting `trusted`.
      trusted: true,
      priority: 95,
    },
    ...kept
      .filter((entry) => entry.declaration.authority !== 'system_instructions')
      .map((entry) => ({
        sectionId: entry.declaration.sectionId,
        kind: sectionKindFor(entry.declaration.authority),
        label: `${entry.declaration.sectionId} (${entry.declaration.relevanceReason})`.slice(0, 120),
        content: entry.clipped,
        // Never trusted. Everything that reached here came through a mapping
        // over model output, tool output or caller input, and the fence is what
        // says so in the transcript.
        trusted: false,
        priority: entry.declaration.priority,
      })),
  ];

  const built = buildContext(inputs, {
    budgetTokens: Math.max(1, budgetTokens),
    ...(input.nonce === undefined ? {} : { nonce: input.nonce }),
  });

  // ── The comparable baseline ───────────────────────────────────────────────
  //
  // Every section this node could have carried, at full length, rendered through
  // the same builder. This is what the prompt WOULD have cost with no optimization
  // at all, in the same unit as the figure below — see the module header for why
  // the two have to match.
  const baselineInputs: ContextInput[] = [
    {
      sectionId: 'workflow_instructions',
      kind: 'system_instructions',
      label: 'Workflow instructions',
      content: input.systemInstructions,
      trusted: true,
      priority: 100,
    },
    {
      sectionId: 'node_objective',
      kind: 'objective',
      label: 'Node objective',
      content: input.objective,
      trusted: true,
      priority: 95,
    },
    ...input.sections
      .filter((section) => (section.content?.trim() ?? '') !== '')
      .map((section) => ({
        sectionId: section.declaration.sectionId,
        kind: sectionKindFor(section.declaration.authority),
        label: `${section.declaration.sectionId} (${section.declaration.relevanceReason})`.slice(
          0,
          120,
        ),
        content: section.content ?? '',
        trusted: false,
        priority: section.declaration.priority,
      })),
  ];
  const baseline = buildContext(baselineInputs, {
    // Deliberately generous: the baseline is "what if nothing were trimmed", so it
    // must not be shaped by the budget the optimizer was working inside.
    budgetTokens: Number.MAX_SAFE_INTEGER,
    maxSectionChars: Number.MAX_SAFE_INTEGER,
    ...(input.nonce === undefined ? {} : { nonce: input.nonce }),
  });

  const originalRenderedTokens = baseline.manifest.estimatedPromptTokens;
  const finalContextTokens = built.manifest.estimatedPromptTokens;
  const cachedTokensUsed = Math.max(0, Math.floor(input.cachedTokensUsed ?? 0));

  // ── 9: completion allowance ──────────────────────────────────────────────
  const completionAllowance = Math.max(
    1,
    Math.min(
      input.completionAllowance,
      input.ceilings.workflowMaxCompletionTokens,
      Math.max(1, node.tokenAllowance - finalContextTokens),
    ),
  );
  const completionTokensReduced = Math.max(0, input.completionAllowance - completionAllowance);

  const savings: TokenSavingsBreakdown = {
    originalContextTokens: originalRenderedTokens,
    finalContextTokens,
    duplicateTokensRemoved,
    historyTokensRemoved,
    retrievalTokensAvoided,
    memoryTokensAvoided,
    completionTokensReduced,
    cachedTokensUsed,
    totalTokensSaved:
      Math.max(0, originalRenderedTokens - finalContextTokens) +
      completionTokensReduced +
      cachedTokensUsed,
  };

  const includedSections: ContextManifestSection[] = kept.map((entry) => ({
    sectionId: entry.declaration.sectionId,
    source: entry.declaration.source,
    authority: entry.declaration.authority,
    relevanceReason: entry.declaration.relevanceReason,
    required: entry.declaration.required,
    maxTokens: entry.declaration.maxTokens,
    sensitivity: entry.declaration.sensitivity,
    tenantScope: entry.declaration.tenantScope,
    digest: entry.digest,
    originalTokens: entry.originalTokens,
    finalTokens: entry.finalTokens,
    truncated: entry.truncated,
  }));

  const manifest: WorkflowContextManifest = {
    nodeId: node.nodeId,
    optimizerVersion: OPTIMIZER_VERSION,
    included: includedSections,
    excluded,
    // Read off the rendered context, so it reflects what the model saw rather
    // than what this module intended it to see.
    authorityOrder: built.manifest.included.map((section) => section.kind),
    originalContextTokens: originalRenderedTokens,
    finalContextTokens,
    savedTokens: savings.totalTokensSaved,
    budgetTokens,
    digest: built.manifest.digest,
  };

  const decision = decideTokenAction({
    promptTokens: finalContextTokens,
    completionTokens: completionAllowance,
    ceilings: input.ceilings,
    node,
    trimmedAnything: excluded.length > 0 || completionTokensReduced > 0,
  });

  return {
    built,
    manifest,
    savings,
    promptTokens: finalContextTokens,
    completionAllowance,
    decision,
    evidenceSections: includedSections.filter(
      (section) => !INSTRUCTION_AUTHORITIES.includes(section.authority),
    ).length,
  };
}

/**
 * Compare against every ceiling and choose one action.
 *
 * NARROWEST CEILING FIRST. The node's own allowance is checked before the
 * workflow's, the workflow's before the agent's, and the platform's last. That
 * ordering is what makes the refusal useful: "this node asked for too much" is
 * an actionable finding, while "the platform is out of tokens" reported for the
 * same step would send an operator to the wrong place.
 *
 * A step that does not fit produces a RECOVERY, not just a refusal, whenever one
 * exists — trim, compress, reduce the completion allowance, or route to a
 * smaller profile. `deny` is reached only when nothing cheaper could work.
 */
export function decideTokenAction(input: {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly ceilings: TokenCeilings;
  readonly node: WorkflowModelNode;
  readonly trimmedAnything: boolean;
}): OptimizationDecision {
  const total = input.promptTokens + input.completionTokens;
  const { ceilings } = input;

  const over = (limit: number | undefined): boolean =>
    limit !== undefined && Number.isFinite(limit) && total > limit;

  if (input.promptTokens > ceilings.workflowMaxPromptTokens) {
    return {
      action: 'compress',
      reason: 'The assembled context is above the prompt ceiling and must be compressed.',
      diagnostics: `prompt=${input.promptTokens} ceiling=${ceilings.workflowMaxPromptTokens}`,
      boundBy: 'workflow',
    };
  }

  if (total > ceilings.nodeTokens) {
    // The node's allowance is the tightest, and two recoveries exist before a
    // refusal: shrink the answer, or shrink the evidence.
    if (input.completionTokens > 256) {
      return {
        action: 'reduce_completion',
        reason: 'This step exceeds the node token allowance; reducing the completion allowance.',
        diagnostics: `total=${total} nodeAllowance=${ceilings.nodeTokens}`,
        boundBy: 'node',
      };
    }
    if (!input.trimmedAnything) {
      return {
        action: 'trim',
        reason: 'This step exceeds the node token allowance; trimming optional context.',
        diagnostics: `total=${total} nodeAllowance=${ceilings.nodeTokens}`,
        boundBy: 'node',
      };
    }
    return {
      action: 'deny',
      reason: 'This node cannot fit its required context inside its token allowance.',
      diagnostics: `total=${total} nodeAllowance=${ceilings.nodeTokens} after trimming`,
      boundBy: 'node',
    };
  }

  if (over(ceilings.workflowRemainingTokens)) {
    return {
      action: 'deny',
      reason: 'This run reached its token allowance.',
      diagnostics: `total=${total} workflowRemaining=${ceilings.workflowRemainingTokens}`,
      boundBy: 'workflow',
    };
  }
  if (over(ceilings.agentRemainingTokens)) {
    return {
      action: 'route_smaller_profile',
      reason: 'The owning agent is close to its token allowance; a smaller profile is required.',
      diagnostics: `total=${total} agentRemaining=${ceilings.agentRemainingTokens}`,
      boundBy: 'agent',
    };
  }
  if (over(ceilings.actorRemainingTokens)) {
    return {
      action: 'require_approval',
      reason: 'This actor has reached their token allowance and needs approval to continue.',
      diagnostics: `total=${total} actorRemaining=${ceilings.actorRemainingTokens}`,
      boundBy: 'actor',
    };
  }
  if (over(ceilings.organizationRemainingTokens)) {
    return {
      action: 'deny',
      reason: 'This organization has reached its token allowance.',
      diagnostics: `total=${total} organizationRemaining=${ceilings.organizationRemainingTokens}`,
      boundBy: 'organization',
    };
  }
  if (over(ceilings.platformRemainingTokens)) {
    return {
      action: 'deny',
      reason: 'The platform token ceiling has no headroom for this step.',
      diagnostics: `total=${total} platformRemaining=${ceilings.platformRemainingTokens}`,
      boundBy: 'platform',
    };
  }

  return {
    action: 'execute',
    reason: 'Within every token ceiling.',
    diagnostics: `prompt=${input.promptTokens} completion=${input.completionTokens} total=${total}`,
  };
}
