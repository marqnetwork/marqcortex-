/**
 * Feature: cortex.block_assist — per-block proposal content assistance.
 *
 * Improves, expands, simplifies or repairs the narrative of a single proposal
 * block. Two structural guarantees:
 *
 *   `roi_financial_snapshot` is rejected at validation. It is a reference block
 *   rendering engine-computed figures; there is no narrative in it to improve,
 *   so AI editing is refused rather than governed. The rejection lives in the
 *   validator so it is a 400 from the guard, not a 500 from deep in the
 *   pipeline.
 *
 *   Per-block-type output requirements are computed in `buildVariables` and
 *   injected as a single prompt variable. The prompt template stays a document
 *   with no branching, while the per-type rules stay typed and testable here.
 */

import type { AIFeatureDefinition } from '../policy/featureCatalog.ts';
import { INTERACTIVE_LIMITS, STANDARD_GOVERNANCE } from '../policy/featureCatalog.ts';
import {
  arrayOf,
  jsonObject,
  literal,
  object,
  optional,
  str,
  withDefault,
  type ValidationResult,
  type Validator,
} from '../security/validation.ts';
import { parseJsonObject } from '../governance/outputGuard.ts';
import { AIError } from '../contracts/errors.ts';

export const BLOCK_ACTIONS = ['ai_improve', 'ai_expand', 'ai_simplify', 'fix_issues'] as const;
export type BlockAction = (typeof BLOCK_ACTIONS)[number];

/** Reference block whose values come from the ROI engine. Never AI-editable. */
export const REFERENCE_BLOCK_TYPE = 'roi_financial_snapshot';

/**
 * Block type, rejecting the reference block by name. Expressed as a validator
 * so the refusal is a validation failure at the security boundary rather than
 * a special case inside the pipeline.
 */
const editableBlockType: Validator<string> = {
  validate(value, path = '') {
    const base = str({ minLength: 1, maxLength: 120 }).validate(value, path);
    if (!base.ok) return base;
    if (base.value === REFERENCE_BLOCK_TYPE) {
      const rejection: ValidationResult<string> = {
        ok: false,
        issues: [
          {
            path: path || 'block_type',
            message:
              'is a reference block rendering engine-computed figures — edit the roi_summary_narrative block instead',
          },
        ],
      };
      return rejection;
    }
    return base;
  },
};

export const blockAssistInputValidator = object({
  block_id: str({ minLength: 1, maxLength: 128 }),
  block_type: editableBlockType,
  title: str({ minLength: 1, maxLength: 200 }),
  current_content: jsonObject(),
  action: literal(BLOCK_ACTIONS),
  context: object({
    company: str({ minLength: 1, maxLength: 200 }),
    industry: withDefault(str({ maxLength: 120 }), 'Not specified'),
    tone: withDefault(str({ maxLength: 80 }), 'boardroom_premium'),
    roi_snapshot: optional(jsonObject()),
    linked_diagnoses: optional(arrayOf(jsonObject(), { maxItems: 20 })),
  }),
});

export type BlockAssistInput = typeof blockAssistInputValidator extends Validator<infer T>
  ? T
  : never;

export interface BlockAssistOutput {
  readonly proposed_content: Record<string, unknown>;
  readonly diff_summary: string;
  readonly change_type: BlockAction;
}

const ACTION_LABELS: Record<BlockAction, string> = {
  ai_improve: 'IMPROVE (boardroom polish, clarity, tighter language)',
  ai_expand: 'EXPAND (add depth, structure, detail — populate all required fields)',
  ai_simplify: 'SIMPLIFY (client-facing, remove internal complexity, shorter sentences)',
  fix_issues: 'FIX ISSUES (address reviewer gaps, strengthen weak sections)',
};

/**
 * Per-block-type output contract. Data, not branching logic in a template: a
 * new block type is a new entry here.
 */
const OUTPUT_REQUIREMENTS: Record<string, { expand?: string; default: string }> = {
  proposal_executive_brief: {
    expand: `OUTPUT must include:
  - "text": a full boardroom narrative covering strategic context, why now (with the figures supplied), the quantified consequence of inaction, and a measurable definition of success.`,
    default: `OUTPUT: { "text": "improved narrative" } — same structure, higher boardroom quality.`,
  },
  proposal_diagnosis: {
    default: `OUTPUT must preserve the full object structure. You may update:
  - "description" (tighten, add precision)
  - "operational_impact" (array of strings, at least 2 items)
  - "financial_impact" (array of strings, at least 2 items)
  Do not change: "severity", "confidence", "evidence".`,
  },
  proposal_solution: {
    expand: `OUTPUT must include:
  - "description", "systems_affected", "integration_points", "deliverables",
    "expected_operational_outcomes", "dependencies_risks", "diagnosis_tie_back".
  Do not change: "pillar", "timeline_weeks", "complexity_score".`,
    default: `OUTPUT: same structure as the current content — improve the quality of existing fields. Do not change "pillar", "timeline_weeks" or "complexity_score".`,
  },
  proposal_timeline: {
    default: `OUTPUT must include:
  - "phases": array of { phase_number, title, duration_weeks, milestones: [{ week, title, owner, deliverables }], governance_checkpoint }
  Be specific week by week. No vague phases.`,
  },
  followup_email_template: {
    default: `OUTPUT must include:
  - "subject": short, deliverability-safe subject line, max 60 characters
  - "body": plain-text executive email body, 150 words or fewer
  Banned: excessive exclamation marks, "Click here", "Act now", "Limited time".`,
  },
  roi_summary_narrative: {
    default: `OUTPUT: { "text": "improved narrative" }
  The narrative explains the ROI figures; it never changes them. Reference the ROI snapshot exactly as supplied.`,
  },
  crm_note: {
    default: `OUTPUT: { "text": "improved note" } — a clearer, action-oriented stakeholder summary.`,
  },
};

export const blockAssistFeature: AIFeatureDefinition<BlockAssistInput, BlockAssistOutput> = {
  descriptor: {
    featureId: 'cortex.block_assist',
    featureVersion: '1.0.0',
    displayName: 'Cortex Block Assist',
    owner: 'MARQ Cortex — AI Platform',
    enabled: true,
    capability: 'ai.block.assist',
    allowedActorTypes: ['team_user'],
    allowedChannels: ['team_console'],
    promptId: 'block.assist',
    responseFormat: 'json_object',
    temperature: 0.45,
    budgetClass: 'interactive',
    limits: { ...INTERACTIVE_LIMITS, maxOutputTokens: 900, maxInputBytes: 128 * 1024 },
    governance: {
      ...STANDARD_GOVERNANCE,
      requiredOutputFields: ['proposed_content'],
      maxOutputChars: 20_000,
    },
    requiredCapabilities: { structuredOutput: true, chatCompletions: true },
  },

  inputValidator: blockAssistInputValidator,

  buildVariables(input) {
    const requirements = OUTPUT_REQUIREMENTS[input.block_type];
    const outputRequirements = requirements
      ? (input.action === 'ai_expand' && requirements.expand) || requirements.default
      : `OUTPUT: the same JSON structure as the current content, with the ${ACTION_LABELS[input.action]} action applied.`;

    return {
      company: input.context.company,
      industry: input.context.industry,
      blockType: input.block_type,
      title: input.title,
      actionLabel: ACTION_LABELS[input.action],
      currentContent: JSON.stringify(input.current_content, null, 2),
      roiSnapshot: input.context.roi_snapshot
        ? `ROI SNAPSHOT (read-only — these figures cannot change):\n${JSON.stringify(input.context.roi_snapshot, null, 2)}`
        : '',
      linkedDiagnoses: input.context.linked_diagnoses?.length
        ? `LINKED DIAGNOSES (tie your output back to these — do not invent new ones):\n${JSON.stringify(input.context.linked_diagnoses, null, 2)}`
        : '',
      outputRequirements,
    };
  },

  parseOutput(content, input) {
    const parsed = parseJsonObject(content);
    const proposed = parsed.proposed_content;
    if (typeof proposed !== 'object' || proposed === null || Array.isArray(proposed)) {
      // Reported as a model-output fault so the pipeline retries: one malformed
      // response should not fail the consultant's action.
      throw new AIError('INVALID_MODEL_OUTPUT', 'The AI response did not contain editable content.', {
        diagnostics: 'block assist: proposed_content is not an object',
      });
    }
    return {
      proposed_content: proposed as Record<string, unknown>,
      diff_summary:
        typeof parsed.diff_summary === 'string' && parsed.diff_summary.trim() !== ''
          ? parsed.diff_summary.slice(0, 200)
          : `AI ${input.action.replace('_', ' ')} applied to ${input.block_type}`,
      change_type: input.action,
    };
  },
};
