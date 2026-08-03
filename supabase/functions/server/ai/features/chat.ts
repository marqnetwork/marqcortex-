/**
 * Feature: cortex.chat — the conversational assistant in the team console.
 *
 * The only feature that carries multi-turn state, and the only one where the
 * model's output is applied directly to a proposal section (via the apply
 * block). Both facts shape its governance:
 *
 *   History is bounded to the last ten turns. An unbounded history is an
 *   unbounded prompt, an unbounded bill and an unbounded injection surface —
 *   every prior turn is attacker-influenceable text.
 *
 *   The apply block is extracted, never executed. It is returned as a proposed
 *   value for a human to accept in the UI. Nothing in this path writes to a
 *   proposal.
 */

import type { AIFeatureDefinition } from '../policy/featureCatalog.ts';
import { INTERACTIVE_LIMITS, STANDARD_GOVERNANCE } from '../policy/featureCatalog.ts';
import type { AIMessage } from '../contracts/request.ts';
import {
  arrayOf,
  literal,
  object,
  optional,
  str,
  withDefault,
  type Validator,
} from '../security/validation.ts';

/** Turns older than this are dropped before the prompt is built. */
const MAX_HISTORY_TURNS = 10;

const chatTurn = object({
  role: literal(['user', 'assistant'] as const),
  content: str({ minLength: 1, maxLength: 8_000 }),
});

export const chatInputValidator = object({
  message: str({ minLength: 1, maxLength: 8_000 }),
  section: withDefault(str({ maxLength: 120 }), 'general'),
  sectionLabel: withDefault(str({ maxLength: 200 }), 'General'),
  sectionContent: optional(str({ maxLength: 20_000 })),
  lead: optional(
    object({
      companyName: withDefault(str({ maxLength: 200 }), 'Not specified'),
      industry: withDefault(str({ maxLength: 120 }), 'Not specified'),
      companySize: withDefault(str({ maxLength: 80 }), 'Not specified'),
      primaryPainSignal: withDefault(str({ maxLength: 500 }), 'Not specified'),
      recommendedService: optional(str({ maxLength: 200 })),
      roiSummary: optional(str({ maxLength: 1_000 })),
    }),
  ),
  history: withDefault(arrayOf(chatTurn, { maxItems: 50 }), []),
});

export type ChatInput = typeof chatInputValidator extends Validator<infer T> ? T : never;

export interface ChatOutput {
  readonly reply: string;
  readonly applyContent?: string;
}

const APPLY_BLOCK = /\[APPLY_START\]\s*([\s\S]*?)\s*\[APPLY_END\]/;

export const chatFeature: AIFeatureDefinition<ChatInput, ChatOutput> = {
  descriptor: {
    featureId: 'cortex.chat',
    featureVersion: '1.0.0',
    displayName: 'Cortex Chat',
    owner: 'MARQ Cortex — AI Platform',
    enabled: true,
    capability: 'ai.chat.converse',
    allowedActorTypes: ['team_user'],
    allowedChannels: ['team_console'],
    promptId: 'chat.cortex_assistant',
    responseFormat: 'text',
    temperature: 0.7,
    budgetClass: 'interactive',
    limits: { ...INTERACTIVE_LIMITS, maxOutputTokens: 1_200 },
    governance: { ...STANDARD_GOVERNANCE, maxOutputChars: 16_000 },
    requiredCapabilities: { structuredOutput: false, chatCompletions: true },
  },

  inputValidator: chatInputValidator,

  buildVariables(input) {
    const parts: string[] = [];

    if (input.lead) {
      const lead = input.lead;
      const optionalLines = [
        lead.recommendedService ? `- Recommended service: ${lead.recommendedService}` : '',
        lead.roiSummary ? `- ROI summary: ${lead.roiSummary}` : '',
      ].filter(Boolean);
      parts.push(
        [
          'LEAD CONTEXT:',
          `- Company: ${lead.companyName}`,
          `- Industry: ${lead.industry}`,
          `- Team size: ${lead.companySize}`,
          `- Primary pain signal: ${lead.primaryPainSignal}`,
          ...optionalLines,
        ].join('\n'),
      );
    }

    if (input.section !== 'general') {
      parts.push(`TARGET SECTION: ${input.sectionLabel} (${input.section})`);
    }

    if (input.sectionContent) {
      parts.push(
        `CURRENT SECTION CONTENT (these figures are engine-computed facts — explain or rewrite around them, never change them):\n${input.sectionContent}`,
      );
    }

    return {
      context: parts.length > 0 ? parts.join('\n\n') : 'No additional context was supplied.',
    };
  },

  buildConversation(input) {
    const messages: AIMessage[] = [
      // Acknowledgement turn: the rendered prompt is delivered as a user
      // message, so the model needs an assistant turn before the history to
      // keep the conversation strictly alternating for every provider.
      { role: 'assistant', content: 'Context loaded. How can I assist?' },
    ];
    for (const turn of input.history.slice(-MAX_HISTORY_TURNS)) {
      messages.push({ role: turn.role, content: turn.content });
    }
    messages.push({ role: 'user', content: input.message });
    return messages;
  },

  parseOutput(content) {
    const match = content.match(APPLY_BLOCK);
    const applyContent = match ? match[1].trim() : undefined;
    const reply = content.replace(new RegExp(APPLY_BLOCK.source, 'g'), '').trim();
    return applyContent === undefined ? { reply } : { reply, applyContent };
  },
};
