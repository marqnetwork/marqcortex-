/**
 * CORTEX GLOBAL AI CHAT — GPT-4o-mini
 *
 * Conversational AI assistant for the MARQ Cortex platform.
 * Context-aware: knows which section the user is targeting and can
 * generate apply-ready content marked with [APPLY] blocks.
 *
 * Core Rule: "Math decides priority, LLM only explains decisions."
 * The LLM assists with writing, tone, narrative — never overrides scores.
 */

import { isGatewayEnabledForFeature } from './intelligence/config.ts';
import {
  gatewayGenerateChat,
  mapGatewayErrorToLegacyMessage,
} from './intelligence/featureBridge.ts';
import './intelligence/bootstrap.ts';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatLeadContext {
  companyName: string;
  industry: string;
  companySize: string;
  primaryPainSignal: string;
  recommendedService?: string;
  roiSummary?: string;
}

export interface ChatRequest {
  message: string;
  section: string;          // e.g. 'proposal.executive_brief' | 'recommendation' | 'roi' | 'general'
  sectionLabel: string;
  sectionContent?: string;  // current raw text of the targeted section
  lead?: ChatLeadContext;
  history: ChatMessage[];
}

export interface ChatResponse {
  reply: string;
  applyContent?: string;   // extracted apply block, if present
  model: string;
  generated_at: string;
}

// ── System Prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are MARQ Cortex AI, an ultra-premium AI consultant assistant embedded inside the MARQ Cortex diagnostic platform used by the MARQ Cortex consulting team.

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

// ── Context Builder ───────────────────────────────────────────────────────────

function buildUserContext(req: ChatRequest): string {
  const parts: string[] = [];

  if (req.lead) {
    parts.push(`LEAD CONTEXT:
- Company: ${req.lead.companyName}
- Industry: ${req.lead.industry}
- Team size: ${req.lead.companySize}
- Primary pain signal: ${req.lead.primaryPainSignal}
${req.lead.recommendedService ? `- Recommended service: ${req.lead.recommendedService}` : ''}
${req.lead.roiSummary ? `- ROI summary: ${req.lead.roiSummary}` : ''}`);
  }

  if (req.section !== 'general') {
    parts.push(`TARGET SECTION: ${req.sectionLabel} (${req.section})`);
  }

  if (req.sectionContent) {
    parts.push(`CURRENT SECTION CONTENT (treat these facts as fixed — explain or rewrite, never fabricate new numbers):
${req.sectionContent}`);
  }

  return parts.join('\n\n');
}

// ── Main Chat Function ────────────────────────────────────────────────────────

function buildChatMessages(req: ChatRequest): { role: string; content: string }[] {
  const contextBlock = buildUserContext(req);
  const messages: { role: string; content: string }[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];
  if (contextBlock) {
    messages.push({
      role: 'user',
      content: `[CONTEXT PROVIDED BY PLATFORM]\n${contextBlock}`,
    });
    messages.push({
      role: 'assistant',
      content: 'Understood. I have the context loaded. How can I assist?',
    });
  }
  const recentHistory = req.history.slice(-10);
  for (const turn of recentHistory) {
    messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({ role: 'user', content: req.message });
  return messages;
}

function parseChatContent(fullText: string): { reply: string; applyContent?: string } {
  const applyMatch = fullText.match(/\[APPLY_START\]\s*([\s\S]*?)\s*\[APPLY_END\]/);
  const applyContent = applyMatch ? applyMatch[1].trim() : undefined;
  const reply = fullText.replace(/\[APPLY_START\][\s\S]*?\[APPLY_END\]/g, '').trim();
  return { reply, applyContent };
}

export async function handleCortexChatLegacy(req: ChatRequest): Promise<ChatResponse> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  const messages = buildChatMessages(req);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.7,
      max_tokens: 1200,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const fullText: string = data.choices?.[0]?.message?.content ?? '';
  const { reply, applyContent } = parseChatContent(fullText);

  return {
    reply,
    applyContent,
    model: data.model ?? 'gpt-4o-mini',
    generated_at: new Date().toISOString(),
  };
}

export async function handleCortexChat(req: ChatRequest): Promise<ChatResponse> {
  if (!isGatewayEnabledForFeature('chat')) {
    return handleCortexChatLegacy(req);
  }

  const messages = buildChatMessages(req);
  try {
    const result = await gatewayGenerateChat({
      messages: messages.map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      })),
      temperature: 0.7,
      maxTokens: 1200,
    });
    const { reply, applyContent } = parseChatContent(result.content);
    return {
      reply,
      applyContent,
      model: result.model,
      generated_at: result.generatedAt,
    };
  } catch (err) {
    throw mapGatewayErrorToLegacyMessage(err);
  }
}
