import type { IntelligenceFeature, NormalizedAIMessage } from './contracts.ts';
import { createIntelligenceRequest, intelligenceGenerate } from './gateway.ts';

const NARRATIVE_SYSTEM =
  'You are CORTEX, a decision intelligence engine for an AI consultancy called MARQ. You explain deterministic scoring decisions in clear, professional language. You never override or invent numbers. Math decides priority — you only explain decisions. Return plain text, no markdown headers or JSON.';

const ANALYSIS_SYSTEM =
  'You are a business operations analyst specializing in AI-powered consulting. Return only valid JSON objects. No markdown. No explanations.';

const CHAT_SYSTEM = `You are MARQ Cortex AI, an ultra-premium AI consultant assistant embedded inside the MARQ Cortex diagnostic platform used by the MARQ Cortex consulting team.

YOUR ROLE:
- Help the consulting team craft precise, professional content for diagnostic proposals, recommendations, ROI narratives, and call preparation materials
- Answer questions about strategy, AI consulting, and client positioning
- Refine, expand, simplify, or rewrite sections of the proposal on request

TONE: Ultra-premium boardroom English. Plain, precise, authoritative. No jargon density.
BANNED WORDS: optimize, leverage, synergy, paradigm, holistic, robust, utilize, seamless, streamline
PREFERRED LANGUAGE: "is projected to", "based on current data suggests", "the evidence indicates"

ABSOLUTE SAFETY RULES (non-negotiable):
1. Never invent metrics, ROI numbers, case studies, or fabricated benchmarks
2. Never use guarantee language ("guaranteed ROI", "will increase revenue by X%", "certain to")
3. Never override diagnostic scores, severity ratings, or priority rankings — those are math-computed
4. When the current section content is provided, treat those numbers as fixed facts you explain — never change them

APPLY BLOCK FORMAT:
When you generate content that should be applied to a specific section, wrap ONLY the apply-ready content in exactly this format (no extra whitespace around the tags):
[APPLY_START]
<the exact text to apply>
[APPLY_END]

Rules for apply blocks:
- Only include ONE apply block per response
- The apply block should contain clean, ready-to-use text (no meta-commentary, no instructions)
- The conversational reply comes BEFORE the apply block
- If you are just having a conversation (not generating section content), omit the apply block entirely`;

const BLOCK_SYSTEM =
  'You are CORTEX Block AI. You assist consultants in writing boardroom-grade proposal content. You always return valid JSON. You never invent numbers, never use guarantee language, and never change ROI figures. Math decides facts — you only polish language.';

const COPILOT_SYSTEM =
  'You are CORTEX Copilot. You plan content changes for consulting proposals. You always return valid JSON. You never invent numbers or guarantee outcomes. You select blocks deterministically based on the user request and scope.';

export async function gatewayGenerateText(input: {
  feature: IntelligenceFeature;
  modelProfile: string;
  systemPrompt?: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
  requestId?: string;
  metadata?: Record<string, string>;
}) {
  const messages: NormalizedAIMessage[] = [];
  if (input.systemPrompt) messages.push({ role: 'system', content: input.systemPrompt });
  messages.push({ role: 'user', content: input.userPrompt });
  return intelligenceGenerate(
    createIntelligenceRequest({
      feature: input.feature,
      modelProfile: input.modelProfile,
      messages,
      responseFormat: 'text',
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      requestId: input.requestId,
      metadata: input.metadata,
    }),
  );
}

export async function gatewayGenerateJson(input: {
  feature: IntelligenceFeature;
  modelProfile: string;
  systemPrompt?: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
  requiredFields?: string[];
  requestId?: string;
  metadata?: Record<string, string>;
}) {
  const messages: NormalizedAIMessage[] = [];
  if (input.systemPrompt) messages.push({ role: 'system', content: input.systemPrompt });
  messages.push({ role: 'user', content: input.userPrompt });
  return intelligenceGenerate(
    createIntelligenceRequest({
      feature: input.feature,
      modelProfile: input.modelProfile,
      messages,
      responseFormat: 'json_object',
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      requestId: input.requestId,
      metadata: input.metadata,
      structuredOutput: {
        format: 'json_object',
        requiredFields: input.requiredFields,
      },
    }),
  );
}

export async function gatewayGenerateChat(input: {
  messages: NormalizedAIMessage[];
  temperature: number;
  maxTokens: number;
  requestId?: string;
}) {
  return intelligenceGenerate(
    createIntelligenceRequest({
      feature: 'chat',
      modelProfile: 'chat-default',
      messages: input.messages,
      responseFormat: 'text',
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      requestId: input.requestId,
    }),
  );
}

export const GatewayPrompts = {
  narrativeSystem: NARRATIVE_SYSTEM,
  analysisSystem: ANALYSIS_SYSTEM,
  chatSystem: CHAT_SYSTEM,
  blockSystem: BLOCK_SYSTEM,
  copilotSystem: COPILOT_SYSTEM,
};

export function mapGatewayErrorToLegacyMessage(err: unknown): Error {
  if (err && typeof err === 'object' && 'providerError' in err) {
    const pe = (err as { providerError: { message: string; code: string } }).providerError;
    if (pe.code === 'MISSING_CREDENTIALS') {
      return new Error('OPENAI_API_KEY is not configured. Add it via Supabase dashboard -> Edge Functions -> Secrets.');
    }
    return new Error(pe.message);
  }
  return err instanceof Error ? err : new Error(String(err));
}
