/**
 * Feature: cortex.section_copilot — narrative rewriting for the six first-class
 * proposal sections.
 *
 * This is the feature where the fact lock earns its keep. Two field groups are
 * authoritative and must survive any model output:
 *
 *   next_step_offer → price, currency, duration      (commercial terms)
 *   diagnosis_*     → severity, confidence, evidence  (deterministic scoring)
 *
 * The prompt asks the model to leave them alone; `applyFactLock` guarantees it.
 * Every restored field is reported to the caller in `fact_lock_enforced` and
 * recorded in the audit trail, so a model drifting toward rewriting commercial
 * terms shows up in telemetry rather than being silently corrected forever.
 */

import type { AIFeatureDefinition, FactLockOutcome } from '../policy/featureCatalog.ts';
import { INTERACTIVE_LIMITS, STANDARD_GOVERNANCE } from '../policy/featureCatalog.ts';
import {
  arrayOf,
  jsonObject,
  literal,
  num,
  object,
  optional,
  str,
  withDefault,
  type Validator,
} from '../security/validation.ts';
import { parseJsonObject } from '../governance/outputGuard.ts';
import { enforceFactLock, factLockTouched } from '../governance/factLock.ts';
import { AIError } from '../contracts/errors.ts';

export const SECTION_KEYS = [
  'executive_brief',
  'diagnosis_0',
  'diagnosis_1',
  'diagnosis_2',
  'scope_boundaries',
  'next_step_offer',
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const SECTION_ACTIONS = ['improve', 'expand', 'simplify', 'fix_gate', 'custom'] as const;
export type SectionAction = (typeof SECTION_ACTIONS)[number];

/**
 * Fields the model may never decide, per section. The single declaration site —
 * the prompt's instruction text and the enforcement both read from here, so the
 * two can never drift apart.
 */
export const LOCKED_FIELDS_BY_SECTION: Readonly<Record<string, readonly string[]>> = {
  next_step_offer: ['price', 'currency', 'duration'],
  diagnosis_0: ['severity', 'confidence', 'evidence'],
  diagnosis_1: ['severity', 'confidence', 'evidence'],
  diagnosis_2: ['severity', 'confidence', 'evidence'],
};

export const sectionCopilotInputValidator = object({
  section: literal(SECTION_KEYS),
  section_label: str({ minLength: 1, maxLength: 200 }),
  action: literal(SECTION_ACTIONS),
  current_content: jsonObject(),
  custom_prompt: optional(str({ maxLength: 2_000 })),
  rejection_contexts: optional(arrayOf(str({ maxLength: 600 }), { maxItems: 20 })),
  context: object({
    company: str({ minLength: 1, maxLength: 200 }),
    industry: optional(str({ maxLength: 120 })),
    locked_facts: optional(
      object({
        price: optional(num({ min: 0, max: 1_000_000_000 })),
        currency: optional(str({ maxLength: 8 })),
        duration: optional(str({ maxLength: 120 })),
      }),
    ),
  }),
});

export type SectionCopilotInput = typeof sectionCopilotInputValidator extends Validator<infer T>
  ? T
  : never;

export interface SectionCopilotOutput {
  readonly proposed_content: Record<string, unknown>;
  readonly diff_summary: string;
  readonly fact_lock_enforced: readonly string[];
}

const ACTION_LABELS: Record<SectionAction, string> = {
  improve: 'IMPROVE (boardroom polish, clarity, tighter language)',
  expand: 'EXPAND (add depth, structure, evidence-backed detail)',
  simplify: 'SIMPLIFY (client-facing, remove internal complexity, shorter sentences)',
  fix_gate: 'FIX GATE ISSUES (populate weak or missing narrative so readiness checks pass)',
  custom: 'CUSTOM (follow the user instruction, within the safety rules)',
};

export const sectionCopilotFeature: AIFeatureDefinition<SectionCopilotInput, SectionCopilotOutput> = {
  descriptor: {
    featureId: 'cortex.section_copilot',
    featureVersion: '1.0.0',
    displayName: 'Cortex Section Copilot',
    owner: 'MARQ Cortex — AI Platform',
    enabled: true,
    capability: 'ai.section.copilot',
    allowedActorTypes: ['team_user'],
    allowedChannels: ['team_console'],
    promptId: 'section.copilot',
    responseFormat: 'json_object',
    temperature: 0.45,
    budgetClass: 'interactive',
    limits: { ...INTERACTIVE_LIMITS, maxOutputTokens: 900, maxInputBytes: 128 * 1024 },
    governance: {
      ...STANDARD_GOVERNANCE,
      requiredOutputFields: ['proposed_content'],
      // Union of every section's locked fields. The per-section subset is
      // applied in `applyFactLock`; this is the declaration the audit reads.
      factLockedFields: ['price', 'currency', 'duration', 'severity', 'confidence', 'evidence'],
      maxOutputChars: 20_000,
    },
    requiredCapabilities: { structuredOutput: true, chatCompletions: true },
  },

  inputValidator: sectionCopilotInputValidator,

  buildVariables(input) {
    const locked = LOCKED_FIELDS_BY_SECTION[input.section] ?? [];
    const rejections = input.rejection_contexts ?? [];

    return {
      company: input.context.company,
      industrySuffix: input.context.industry ? ` (${input.context.industry})` : '',
      section: input.section,
      sectionLabel: input.section_label,
      actionLabel: ACTION_LABELS[input.action],
      customInstruction:
        input.action === 'custom' && input.custom_prompt
          ? `USER INSTRUCTION: "${input.custom_prompt}"`
          : '',
      lockedFieldsLine:
        locked.length > 0
          ? `FACT-LOCKED FIELDS for this section (leave exactly as-is — the server restores them regardless): ${locked.join(', ')}`
          : 'This section has no fact-locked fields, but never invent a number.',
      currentContent: JSON.stringify(input.current_content, null, 2),
      rejectionContext:
        rejections.length > 0
          ? `PREVIOUSLY REJECTED SUGGESTIONS (do not repeat these patterns):\n${rejections
              .slice(-3)
              .map((entry) => `  - ${entry}`)
              .join('\n')}`
          : '',
    };
  },

  parseOutput(content, input) {
    const parsed = parseJsonObject(content);
    const proposed = parsed.proposed_content;
    if (typeof proposed !== 'object' || proposed === null || Array.isArray(proposed)) {
      throw new AIError('INVALID_MODEL_OUTPUT', 'The AI response did not contain editable content.', {
        diagnostics: 'section copilot: proposed_content is not an object',
      });
    }
    return {
      proposed_content: proposed as Record<string, unknown>,
      diff_summary:
        typeof parsed.diff_summary === 'string' && parsed.diff_summary.trim() !== ''
          ? parsed.diff_summary.slice(0, 200)
          : `AI ${input.action} applied to ${input.section_label}`,
      // Populated by applyFactLock, which runs immediately after this.
      fact_lock_enforced: [],
    };
  },

  applyFactLock(output, input): FactLockOutcome<SectionCopilotOutput> {
    const locked = LOCKED_FIELDS_BY_SECTION[input.section] ?? [];
    const { authority } = resolveFactAuthority(input);
    const result = enforceFactLock(output.proposed_content, authority, locked);
    return {
      output: {
        proposed_content: result.content,
        diff_summary: output.diff_summary,
        fact_lock_enforced: factLockTouched(result),
      },
      restored: factLockTouched(result),
    };
  },
};

/**
 * Decide what counts as authoritative for this request, per field.
 *
 * `locked_facts` is the explicit authority channel: the console populates it
 * from the stored proposal, and it is validated as a typed shape rather than an
 * open object. `current_content` is the caller's echo of the section it is
 * editing — useful, but it arrives in the request body and a caller who wanted
 * to change a locked price could simply send a different one. It is therefore
 * used only for fields `locked_facts` does not cover, and never in preference
 * to it.
 *
 * KNOWN LIMITATION (documented rather than hidden): for fields covered only by
 * `current_content`, the "authority" is still caller-supplied. Closing that gap
 * means the AI boundary reading the proposal record itself, which is a storage
 * change outside AI-01 Batch 1. What Batch 1 does guarantee is the narrower and
 * still valuable property: the MODEL cannot change or invent a locked field,
 * and a field with no authority behind it is removed rather than accepted.
 */
function resolveFactAuthority(input: SectionCopilotInput): {
  authority: Readonly<Record<string, unknown>>;
  /** Which fields came from the explicit channel. Recorded for telemetry. */
  trusted: readonly string[];
} {
  const echo =
    typeof input.current_content === 'object' && input.current_content !== null
      ? (input.current_content as Record<string, unknown>)
      : {};

  const explicit = input.context.locked_facts;
  if (!explicit) return { authority: echo, trusted: [] };

  const authority: Record<string, unknown> = { ...echo };
  const trusted: string[] = [];
  for (const [field, value] of Object.entries(explicit)) {
    if (value === undefined) continue;
    authority[field] = value;
    trusted.push(field);
  }
  return { authority, trusted };
}
