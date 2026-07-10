/**
 * BLOCK AI ASSIST — ai-assist-per-block.md
 *
 * Handles GPT-4o-mini calls for per-block AI actions:
 *   ai_improve  — boardroom polish, clarity, tighten
 *   ai_expand   — add depth, structure, detail
 *   ai_simplify — client-facing, remove internal complexity
 *   fix_issues  — address reviewer notes / missing gate items
 *
 * Safety rules enforced in every prompt (spec §3):
 *   - ROI numbers CANNOT be changed (block_type guard upstream)
 *   - No invented proof, no fake case studies, no fabricated metrics
 *   - No guarantee language ("guaranteed ROI", "will increase revenue by X%")
 *   - Use probability/conservative language
 *   - Tone: ultra-premium boardroom
 *
 * Returns: { proposed_content, diff_summary, change_type }
 * AI revision is ALWAYS pending — humans approve (spec §4).
 */

import { isGatewayEnabledForFeature } from './intelligence/config.ts';
import {
  gatewayGenerateJson,
  GatewayPrompts,
  mapGatewayErrorToLegacyMessage,
} from './intelligence/featureBridge.ts';
import './intelligence/bootstrap.ts';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AIBlockAction = 'ai_improve' | 'ai_expand' | 'ai_simplify' | 'fix_issues';

export interface BlockAIAssistRequest {
  block_id:        string;
  block_type:      string;
  title:           string;
  current_content: Record<string, unknown>;
  action:          AIBlockAction;
  context: {
    company:            string;
    industry:           string;
    tone:               string;
    roi_snapshot?:      Record<string, unknown>;
    scope_boundaries?:  Record<string, unknown>;
    linked_diagnoses?:  Record<string, unknown>[];
  };
}

export interface BlockAIAssistResponse {
  proposed_content: Record<string, unknown>;
  diff_summary:     string;
  change_type:      AIBlockAction;
  model:            string;
  generated_at:     string;
}

// ── Shared safety preamble injected into every prompt ─────────────────────────

const SAFETY_RULES = `
ABSOLUTE SAFETY RULES (non-negotiable — violation = immediate rejection):
1. DO NOT change any numeric values that represent ROI, price, or timeline. These come from the deterministic ROI engine.
2. DO NOT invent proof — no fake case studies, no fabricated certifications, no made-up benchmarks.
3. DO NOT use guarantee language. Banned phrases: "guaranteed ROI", "will increase revenue by X%", "certain to", "guaranteed to". Use: "is projected to", "is estimated to", "based on current data suggests".
4. DO NOT increase confidence or severity scores beyond what is present in current content.
5. Tone: ultra-premium boardroom. Plain English. No jargon density (avoid: optimize, leverage, synergy, paradigm, holistic, robust, utilize).
6. Return ONLY a raw JSON object — no markdown fences, no explanation outside the JSON.`.trim();

// ── Block-type-specific prompt builders ───────────────────────────────────────

function buildPrompt(req: BlockAIAssistRequest): string {
  const { block_type, title, current_content, action, context } = req;
  const contentStr = JSON.stringify(current_content, null, 2);
  const actionLabel = {
    ai_improve:  'IMPROVE (boardroom polish, clarity, tighter language)',
    ai_expand:   'EXPAND (add depth, structure, detail — populate all required fields)',
    ai_simplify: 'SIMPLIFY (client-facing, remove internal complexity, shorter sentences)',
    fix_issues:  'FIX ISSUES (address reviewer gaps, strengthen weak sections)',
  }[action];

  const roiSnap = context.roi_snapshot
    ? `ROI SNAPSHOT (READ-ONLY — numbers cannot change):\n${JSON.stringify(context.roi_snapshot, null, 2)}`
    : '';

  const diagCtx = context.linked_diagnoses?.length
    ? `LINKED DIAGNOSES (tie your output back to these — do not invent new ones):\n${JSON.stringify(context.linked_diagnoses, null, 2)}`
    : '';

  // ── Block-type specific output requirements ────────────────────────────────
  let outputRequirements = '';

  if (block_type === 'proposal_executive_brief') {
    outputRequirements = action === 'ai_expand'
      ? `OUTPUT must include all these fields in the JSON:
  - "text": full boardroom narrative covering:
    1. strategic_context (why this client, what landscape)
    2. why_now (compounding cost of inaction with $-figures from inputs)
    3. consequence_of_inaction (quantified risk if not acted upon)
    4. success_definition (measurable outcomes, not vague aspirations)`
      : `OUTPUT: { "text": "improved narrative" } — same structure, higher boardroom quality`;

  } else if (block_type === 'proposal_diagnosis') {
    outputRequirements = `OUTPUT must preserve the full object structure. You may update:
  - "description" (tighten, add precision)
  - "operational_impact" (array of strings — must have ≥2 items)
  - "financial_impact" (array of strings — must have ≥2 items)
  - "diff_summary_hint": what changed
  DO NOT change: "severity", "confidence", "evidence"`;

  } else if (block_type === 'proposal_solution') {
    outputRequirements = action === 'ai_expand'
      ? `OUTPUT must include all these fields:
  - "description": what it changes, written plainly
  - "systems_affected": array of system names
  - "integration_points": array — how systems connect
  - "deliverables": array — concrete handoffs per phase
  - "expected_operational_outcomes": array — measurable outcomes
  - "dependencies_risks": array — dependencies and risk controls
  - "diagnosis_tie_back": one sentence linking to the diagnosis it addresses
  DO NOT change: "pillar", "timeline_weeks", "complexity_score"`
      : `OUTPUT: same structure as current — improve quality of existing fields. DO NOT change pillar, timeline_weeks, complexity_score.`;

  } else if (block_type === 'proposal_timeline') {
    outputRequirements = `OUTPUT must include:
  - "phases": array of { phase_number, title, duration_weeks, milestones: [{ week, title, owner, deliverables }], governance_checkpoint }
  Tone: specific, week-by-week. No vague phases.`;

  } else if (block_type === 'followup_email_template') {
    outputRequirements = `OUTPUT must include:
  - "subject": short, no-spam subject line (max 60 chars)
  - "body": plain-text email body — executive, short (≤150 words), deliverability-safe
  Banned: excessive exclamation marks, "Click here", "Act now", "Limited time".`;

  } else if (block_type === 'roi_summary_narrative') {
    outputRequirements = `OUTPUT: { "text": "improved narrative" }
  The narrative explains the ROI numbers — it does NOT change them.
  Reference the ROI snapshot numbers exactly as given.`;

  } else if (block_type === 'crm_note') {
    outputRequirements = `OUTPUT: { "text": "improved note" } — clearer stakeholder summary, action-oriented.`;

  } else {
    outputRequirements = `OUTPUT: same JSON structure as current content — apply the ${actionLabel} action.`;
  }

  return `You are CORTEX Block AI — a specialist content engine for MARQ Cortex, an elite AI consultancy.

CLIENT: ${context.company} (${context.industry})
BLOCK: ${block_type} — "${title}"
ACTION: ${actionLabel}

${SAFETY_RULES}

CURRENT CONTENT:
${contentStr}

${roiSnap}
${diagCtx}

${outputRequirements}

Respond ONLY with a JSON object in this exact shape (no markdown, no explanation):
{
  "proposed_content": { /* the full updated block content */ },
  "diff_summary": "One sentence describing what changed and why. Mention what spec rule this satisfies. Max 120 chars."
}`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleBlockAIAssistLegacy(req: BlockAIAssistRequest): Promise<BlockAIAssistResponse> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured. Add it via Supabase dashboard → Edge Functions → Secrets.');
  }

  if (req.block_type === 'roi_financial_snapshot') {
    throw new Error('ROI financial snapshot is a reference block. AI actions are disabled. Edit the roi_summary_narrative block to update the narrative.');
  }

  const prompt = buildPrompt(req);

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
      temperature:  0.45,
      max_tokens:   900,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const raw  = data.choices?.[0]?.message?.content;

  if (!raw) {
    throw new Error('OpenAI returned empty content for block AI assist request');
  }

  let parsed: { proposed_content: Record<string, unknown>; diff_summary: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`OpenAI response was not valid JSON: ${raw.slice(0, 200)}`);
  }

  if (!parsed.proposed_content || typeof parsed.proposed_content !== 'object') {
    throw new Error('OpenAI response missing proposed_content field');
  }

  return {
    proposed_content: parsed.proposed_content,
    diff_summary:     parsed.diff_summary ?? `AI ${req.action.replace('_', ' ')} applied to ${req.block_type}`,
    change_type:      req.action,
    model:            data.model ?? 'gpt-4o-mini',
    generated_at:     new Date().toISOString(),
  };
}

export async function handleBlockAIAssist(req: BlockAIAssistRequest): Promise<BlockAIAssistResponse> {
  if (req.block_type === 'roi_financial_snapshot') {
    throw new Error('ROI financial snapshot is a reference block. AI actions are disabled. Edit the roi_summary_narrative block to update the narrative.');
  }

  if (!isGatewayEnabledForFeature('block_assist')) {
    return handleBlockAIAssistLegacy(req);
  }

  const prompt = buildPrompt(req);
  try {
    const result = await gatewayGenerateJson({
      feature: 'block_assist',
      modelProfile: 'block-default',
      systemPrompt: GatewayPrompts.blockSystem,
      userPrompt: prompt,
      temperature: 0.45,
      maxTokens: 900,
      requiredFields: ['proposed_content'],
    });
    const parsed = JSON.parse(result.content) as {
      proposed_content: Record<string, unknown>;
      diff_summary?: string;
    };
    if (!parsed.proposed_content || typeof parsed.proposed_content !== 'object') {
      throw new Error('OpenAI response missing proposed_content field');
    }
    return {
      proposed_content: parsed.proposed_content,
      diff_summary: parsed.diff_summary ?? `AI ${req.action.replace('_', ' ')} applied to ${req.block_type}`,
      change_type: req.action,
      model: result.model,
      generated_at: result.generatedAt,
    };
  } catch (err) {
    throw mapGatewayErrorToLegacyMessage(err);
  }
}
