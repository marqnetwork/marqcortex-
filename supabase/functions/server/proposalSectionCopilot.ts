/**
 * PROPOSAL SECTION COPILOT — section-level AI copilot (ai-assist-per-block.md · §12 proposal layer)
 *
 * Backend for ProposalSectionCopilot.tsx. Unlike the Block Registry copilot which
 * targets the block schema, this operates on the 6 first-class proposal sections:
 *   • executive_brief   • diagnosis_0 / diagnosis_1 / diagnosis_2
 *   • scope_boundaries  • next_step_offer
 *
 * GOVERNANCE (core rule — "Math decides, LLM only explains"):
 *   The LLM may ONLY rewrite or explain narrative text. It may NOT alter
 *   authoritative calculations, scores, outcomes, or business rules. The
 *   fact-locked fields below are re-injected deterministically from the caller's
 *   current content AFTER the model responds, so no model output can change them:
 *     - next_step_offer → price, currency, duration   (pricing / commercial terms)
 *     - diagnosis_*     → severity, confidence, evidence (deterministic scoring + proof)
 *
 * All generation is routed through the Intelligence Gateway (feature: block_assist),
 * keeping provider independence. A legacy direct-OpenAI path is retained as a
 * fallback for parity with blockAiAssist.
 *
 * Returns: { proposed_content, diff_summary, model, generated_at, fact_lock_enforced }
 * The revision is ALWAYS pending — the human accepts/rejects in the UI.
 */

import { isGatewayEnabledForFeature } from './intelligence/config.ts';
import {
  gatewayGenerateJson,
  GatewayPrompts,
  mapGatewayErrorToLegacyMessage,
} from './intelligence/featureBridge.ts';
import './intelligence/bootstrap.ts';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SectionKey =
  | 'executive_brief'
  | 'diagnosis_0'
  | 'diagnosis_1'
  | 'diagnosis_2'
  | 'scope_boundaries'
  | 'next_step_offer';

export type SectionAction = 'improve' | 'expand' | 'simplify' | 'fix_gate' | 'custom';

export const VALID_SECTIONS: SectionKey[] = [
  'executive_brief', 'diagnosis_0', 'diagnosis_1', 'diagnosis_2',
  'scope_boundaries', 'next_step_offer',
];

export const VALID_ACTIONS: SectionAction[] = [
  'improve', 'expand', 'simplify', 'fix_gate', 'custom',
];

export interface ProposalSectionCopilotRequest {
  section:         SectionKey;
  section_label:   string;
  action:          SectionAction;
  current_content: Record<string, unknown>;
  custom_prompt?:  string;
  rejection_contexts?: string[];
  context: {
    company:      string;
    industry?:    string;
    locked_facts?: {
      price?:    number;
      currency?: string;
      duration?: string;
    };
  };
}

export interface ProposalSectionCopilotResponse {
  proposed_content:   Record<string, unknown>;
  diff_summary:       string;
  model:              string;
  generated_at:       string;
  /** Names of fact-locked fields that were restored to their authoritative value. */
  fact_lock_enforced: string[];
}

// ── Fact-lock policy (deterministic — never trusts the LLM) ────────────────────

/**
 * Fields the LLM is forbidden from changing, keyed by section. These carry
 * authoritative calculations, scores, or commercial terms — not narrative.
 */
export const LOCKED_FIELDS_BY_SECTION: Record<string, string[]> = {
  next_step_offer: ['price', 'currency', 'duration'],
  diagnosis_0:     ['severity', 'confidence', 'evidence'],
  diagnosis_1:     ['severity', 'confidence', 'evidence'],
  diagnosis_2:     ['severity', 'confidence', 'evidence'],
};

/**
 * Re-inject the authoritative value for every locked field of a section,
 * overwriting whatever the model produced. Pure and deterministic — this is the
 * hard guarantee that AI cannot alter calculations, scores, or business rules.
 *
 * @returns the sanitized content plus the list of fields that had to be restored
 *          (i.e. the model tried to change them).
 */
export function enforceFactLock(
  section: string,
  proposed: Record<string, unknown>,
  current: Record<string, unknown>,
): { content: Record<string, unknown>; restored: string[] } {
  const locked = LOCKED_FIELDS_BY_SECTION[section];
  if (!locked || !proposed || typeof proposed !== 'object') {
    return { content: proposed, restored: [] };
  }
  const content: Record<string, unknown> = { ...proposed };
  const restored: string[] = [];
  for (const field of locked) {
    if (!(field in current)) continue; // nothing authoritative to protect
    const authoritative = current[field];
    if (JSON.stringify(content[field]) !== JSON.stringify(authoritative)) {
      restored.push(field);
    }
    content[field] = authoritative;
  }
  return { content, restored };
}

// ── Shared safety preamble ─────────────────────────────────────────────────────

const SAFETY_RULES = `
ABSOLUTE SAFETY RULES (non-negotiable — violation = immediate rejection):
1. You may ONLY rewrite or explain narrative text. You must NOT compute, invent, or change any number, score, price, timeline, or business rule.
2. DO NOT change fact-locked fields: price, currency, duration, severity, confidence, or evidence. These come from the deterministic engine and are restored by the server regardless.
3. DO NOT invent proof — no fake case studies, no fabricated certifications, no made-up benchmarks or metrics.
4. DO NOT use guarantee language. Banned: "guaranteed ROI", "will increase revenue by X%", "certain to", "guaranteed to". Use: "is projected to", "is estimated to", "current data suggests".
5. Preserve the exact JSON shape of the current content — same keys, same types. Only the wording of narrative fields may change.
6. Tone: ultra-premium boardroom. Plain English. Avoid jargon: optimize, leverage, synergy, paradigm, holistic, robust, utilize, seamless, streamline.
7. Return ONLY a raw JSON object — no markdown fences, no prose outside the JSON.`.trim();

const ACTION_LABEL: Record<SectionAction, string> = {
  improve:  'IMPROVE (boardroom polish, clarity, tighter language)',
  expand:   'EXPAND (add depth, structure, evidence-backed detail)',
  simplify: 'SIMPLIFY (client-facing, remove internal complexity, shorter sentences)',
  fix_gate: 'FIX GATE ISSUES (populate weak/missing narrative to pass readiness checks)',
  custom:   'CUSTOM (follow the user instruction, within the safety rules)',
};

// ── Prompt builder ──────────────────────────────────────────────────────────────

export function buildSectionCopilotPrompt(req: ProposalSectionCopilotRequest): string {
  const { section, section_label, action, current_content, custom_prompt, context } = req;
  const contentStr = JSON.stringify(current_content, null, 2);
  const locked = LOCKED_FIELDS_BY_SECTION[section] ?? [];

  const rejectionCtx = (req.rejection_contexts && req.rejection_contexts.length > 0)
    ? `PREVIOUSLY REJECTED SUGGESTIONS (do NOT repeat these patterns):\n${req.rejection_contexts.slice(-3).map(r => `  - ${r}`).join('\n')}`
    : '';

  const customLine = action === 'custom' && custom_prompt
    ? `USER INSTRUCTION: "${custom_prompt}"`
    : '';

  const lockedLine = locked.length > 0
    ? `FACT-LOCKED FIELDS for this section (leave EXACTLY as-is): ${locked.join(', ')}`
    : 'No fact-locked fields in this section — but still never invent numbers.';

  return `You are CORTEX Section Copilot — a specialist narrative engine for MARQ Cortex, an elite AI consultancy.

CLIENT: ${context.company}${context.industry ? ` (${context.industry})` : ''}
SECTION: ${section} — "${section_label}"
ACTION: ${ACTION_LABEL[action]}
${customLine}

${SAFETY_RULES}

${lockedLine}

CURRENT CONTENT:
${contentStr}

${rejectionCtx}

Respond ONLY with a JSON object in this exact shape (no markdown, no explanation):
{
  "proposed_content": { /* the full updated section content, same keys/types as CURRENT CONTENT */ },
  "diff_summary": "One sentence describing what changed and why. Max 120 chars."
}`.trim();
}

// ── Legacy direct-OpenAI path (parity fallback) ────────────────────────────────

async function handleSectionCopilotLegacy(
  req: ProposalSectionCopilotRequest,
): Promise<ProposalSectionCopilotResponse> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured. Add it via Supabase dashboard -> Edge Functions -> Secrets.');
  }

  const prompt = buildSectionCopilotPrompt(req);
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: GatewayPrompts.blockSystem },
        { role: 'user', content: prompt },
      ],
      temperature:     0.45,
      max_tokens:      900,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const raw  = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('OpenAI returned empty content for section copilot request');

  return finalizeResponse(req, raw, data.model ?? 'gpt-4o-mini', new Date().toISOString());
}

// ── Shared response finalizer (parse → validate → fact-lock) ───────────────────

function finalizeResponse(
  req: ProposalSectionCopilotRequest,
  raw: string,
  model: string,
  generatedAt: string,
): ProposalSectionCopilotResponse {
  let parsed: { proposed_content: Record<string, unknown>; diff_summary?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`AI response was not valid JSON: ${raw.slice(0, 200)}`);
  }
  if (!parsed.proposed_content || typeof parsed.proposed_content !== 'object') {
    throw new Error('AI response missing proposed_content field');
  }

  // Deterministic fact-lock — restore authoritative fields the model may have touched.
  const { content, restored } = enforceFactLock(req.section, parsed.proposed_content, req.current_content);

  return {
    proposed_content:   content,
    diff_summary:       parsed.diff_summary ?? `AI ${req.action} applied to ${req.section_label}`,
    model,
    generated_at:       generatedAt,
    fact_lock_enforced: restored,
  };
}

// ── Main handler ────────────────────────────────────────────────────────────────

export async function handleProposalSectionCopilot(
  req: ProposalSectionCopilotRequest,
): Promise<ProposalSectionCopilotResponse> {
  if (!isGatewayEnabledForFeature('block_assist')) {
    return handleSectionCopilotLegacy(req);
  }

  const prompt = buildSectionCopilotPrompt(req);
  try {
    const result = await gatewayGenerateJson({
      feature:       'block_assist',
      modelProfile:  'block-default',
      systemPrompt:  GatewayPrompts.blockSystem,
      userPrompt:    prompt,
      temperature:   0.45,
      maxTokens:     900,
      requiredFields: ['proposed_content'],
    });
    return finalizeResponse(req, result.content, result.model, result.generatedAt);
  } catch (err) {
    throw mapGatewayErrorToLegacyMessage(err);
  }
}
