/**
 * Feature: cortex.copilot_plan — natural language to a structured patch plan.
 *
 * Plans only. It selects which blocks to act on and with what action; it never
 * edits content. Execution of the plan is a separate, human-initiated step.
 *
 * The block partition — targetable versus pre-skipped — is computed here, not
 * asked of the model. Locked blocks, blocks with a pending revision, the ROI
 * reference block and contract clauses are removed from the candidate set before
 * the prompt is built, so the model is never in a position to target one. Asking
 * a model to respect an exclusion list is a request; not showing it the excluded
 * items is a guarantee.
 *
 * The returned plan is then re-filtered against the same partition, because a
 * model can invent a block id that was never offered.
 */

import type { AIFeatureDefinition } from '../policy/featureCatalog.ts';
import { INTERACTIVE_LIMITS, STANDARD_GOVERNANCE } from '../policy/featureCatalog.ts';
import {
  arrayOf,
  bool,
  object,
  str,
  withDefault,
  type Validator,
} from '../security/validation.ts';
import { parseJsonObject } from '../governance/outputGuard.ts';
import { AIError } from '../contracts/errors.ts';
import { BLOCK_ACTIONS, REFERENCE_BLOCK_TYPE, type BlockAction } from './blockAssist.ts';

export const COPILOT_INTENTS = [
  'rewrite_tone',
  'expand_detail',
  'simplify_client_view',
  'fix_ready_gate_failures',
  'align_solution_to_diagnosis',
  'generate_missing_blocks',
  'summarize_for_email',
] as const;
export type CopilotIntent = (typeof COPILOT_INTENTS)[number];

/** Block types the copilot may never target, whatever the request says. */
const FORBIDDEN_BLOCK_TYPES: readonly string[] = [REFERENCE_BLOCK_TYPE, 'contract_clause'];

/** Targets in these block types force an ROI recalculation downstream. */
const ROI_AFFECTING_TYPES: readonly string[] = [
  'proposal_solution',
  'proposal_timeline',
  'proposal_next_step',
];

const blockSummary = object({
  block_id: str({ minLength: 1, maxLength: 128 }),
  block_type: str({ minLength: 1, maxLength: 120 }),
  title: withDefault(str({ maxLength: 200 }), 'Untitled block'),
  status: withDefault(str({ maxLength: 60 }), 'draft'),
  has_pending: withDefault(bool(), false),
  is_locked: withDefault(bool(), false),
});

export const copilotPlanInputValidator = object({
  user_input: str({ minLength: 1, maxLength: 4_000 }),
  scope: withDefault(str({ maxLength: 120 }), 'proposal'),
  entity_id: withDefault(str({ maxLength: 128 }), 'unknown'),
  block_summaries: arrayOf(blockSummary, { maxItems: 200 }),
  context: object({
    company: str({ minLength: 1, maxLength: 200 }),
    industry: withDefault(str({ maxLength: 120 }), 'Not specified'),
  }),
});

export type CopilotPlanInput = typeof copilotPlanInputValidator extends Validator<infer T>
  ? T
  : never;

export interface CopilotPatchTarget {
  readonly block_id: string;
  readonly block_type: string;
  readonly title: string;
  readonly action: BlockAction;
  readonly rationale: string;
  readonly constraints: { readonly tone: string; readonly do_not_change: readonly string[] };
}

export interface CopilotPlanOutput {
  readonly intent: CopilotIntent;
  readonly intent_label: string;
  readonly targets: readonly CopilotPatchTarget[];
  readonly skipped: readonly { block_id: string; title: string; reason: string }[];
  readonly roi_recalc_required: boolean;
}

type BlockSummary = CopilotPlanInput['block_summaries'][number];

function isTargetable(block: BlockSummary): boolean {
  return (
    !block.is_locked && !block.has_pending && !FORBIDDEN_BLOCK_TYPES.includes(block.block_type)
  );
}

function skipReason(block: BlockSummary): string {
  if (block.is_locked) return 'locked';
  if (block.has_pending) return 'already has a pending revision';
  if (block.block_type === REFERENCE_BLOCK_TYPE) return 'reference block — ROI figures are immutable';
  return 'contract clause — not editable by the copilot';
}

export const copilotPlanFeature: AIFeatureDefinition<CopilotPlanInput, CopilotPlanOutput> = {
  descriptor: {
    featureId: 'cortex.copilot_plan',
    featureVersion: '1.0.0',
    displayName: 'Cortex Copilot Planner',
    owner: 'MARQ Cortex — AI Platform',
    enabled: true,
    capability: 'ai.copilot.plan',
    allowedActorTypes: ['team_user'],
    allowedChannels: ['team_console'],
    promptId: 'copilot.patch_plan',
    responseFormat: 'json_object',
    temperature: 0.3,
    budgetClass: 'interactive',
    limits: { ...INTERACTIVE_LIMITS, maxOutputTokens: 800 },
    governance: {
      ...STANDARD_GOVERNANCE,
      enforceToneBans: false,
      requiredOutputFields: ['intent', 'targets'],
      maxOutputChars: 16_000,
    },
    requiredCapabilities: { structuredOutput: true, chatCompletions: true },
  },

  inputValidator: copilotPlanInputValidator,

  buildVariables(input) {
    const targetable = input.block_summaries.filter(isTargetable);
    const skipped = input.block_summaries.filter((block) => !isTargetable(block));

    return {
      userInput: input.user_input,
      company: input.context.company,
      industry: input.context.industry,
      scope: input.scope,
      entityId: input.entity_id,
      targetableBlocks:
        targetable.length > 0
          ? targetable
              .map(
                (block) =>
                  `  - ${block.block_id} | ${block.block_type} | "${block.title}" | status:${block.status}`,
              )
              .join('\n')
          : '  (none available)',
      skippedBlocks:
        skipped.length > 0
          ? skipped.map((block) => `  - ${block.block_id} | "${block.title}" → ${skipReason(block)}`).join('\n')
          : '  (none)',
    };
  },

  parseOutput(content, input) {
    const parsed = parseJsonObject(content);

    if (typeof parsed.intent !== 'string' || !Array.isArray(parsed.targets)) {
      throw new AIError('INVALID_MODEL_OUTPUT', 'The AI response was not a usable plan.', {
        diagnostics: 'copilot plan: intent or targets missing',
      });
    }

    const intent: CopilotIntent = (COPILOT_INTENTS as readonly string[]).includes(parsed.intent)
      ? (parsed.intent as CopilotIntent)
      : 'rewrite_tone';

    const targetableById = new Map(
      input.block_summaries.filter(isTargetable).map((block) => [block.block_id, block]),
    );

    // Re-filter against the offered set: a model can name a block that was
    // never targetable, and honouring that would defeat the exclusion.
    const seen = new Set<string>();
    const targets: CopilotPatchTarget[] = [];
    const rejected: { block_id: string; title: string; reason: string }[] = [];

    for (const entry of parsed.targets) {
      const raw = (entry ?? {}) as Record<string, unknown>;
      const blockId = typeof raw.block_id === 'string' ? raw.block_id : '';
      const block = targetableById.get(blockId);
      if (!block) {
        rejected.push({
          block_id: blockId || '(unknown)',
          title: typeof raw.title === 'string' ? raw.title.slice(0, 200) : '',
          reason: 'not an eligible block for this request',
        });
        continue;
      }
      // One action per block: a duplicate would queue two revisions on the
      // same block and the second would land on stale content.
      if (seen.has(blockId)) continue;
      seen.add(blockId);

      const action = (BLOCK_ACTIONS as readonly string[]).includes(String(raw.action))
        ? (raw.action as BlockAction)
        : 'ai_improve';

      targets.push({
        block_id: block.block_id,
        block_type: block.block_type,
        title: block.title,
        action,
        rationale:
          typeof raw.rationale === 'string' ? raw.rationale.slice(0, 400) : 'Selected by the copilot.',
        constraints: { tone: 'boardroom_premium', do_not_change: ['numbers', 'pricing', 'timeline_weeks'] },
      });
    }

    const modelSkipped = Array.isArray(parsed.skipped)
      ? parsed.skipped.slice(0, 50).map((entry) => {
          const raw = (entry ?? {}) as Record<string, unknown>;
          return {
            block_id: typeof raw.block_id === 'string' ? raw.block_id.slice(0, 128) : '(unknown)',
            title: typeof raw.title === 'string' ? raw.title.slice(0, 200) : '',
            reason: typeof raw.reason === 'string' ? raw.reason.slice(0, 200) : 'skipped',
          };
        })
      : [];

    // Recomputed from the accepted targets, not taken from the model: an ROI
    // recalculation is a deterministic consequence of what is being edited.
    const roiRecalcRequired = targets.some((target) =>
      ROI_AFFECTING_TYPES.includes(target.block_type),
    );

    return {
      intent,
      intent_label:
        typeof parsed.intent_label === 'string' && parsed.intent_label.trim() !== ''
          ? parsed.intent_label.slice(0, 80)
          : intent.replace(/_/g, ' '),
      targets,
      skipped: [...modelSkipped, ...rejected],
      roi_recalc_required: roiRecalcRequired,
    };
  },
};
