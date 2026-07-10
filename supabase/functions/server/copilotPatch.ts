/**
 * CORTEX COPILOT — PATCH PLAN INTERPRETER (copilot-patch-plan.md)
 *
 * Receives a user natural-language request + a summary of available blocks,
 * calls GPT-4o-mini to:
 *   1. Classify the intent (rewrite_tone, expand_detail, etc.)
 *   2. Select which blocks to target
 *   3. Assign an action per block
 *   4. Return a structured PatchPlan (no edits yet — just the plan)
 *
 * Hard guardrails enforced in prompt:
 *   - Never target roi_financial_snapshot
 *   - Never target contract_clause without admin flag
 *   - No ROI number changes
 *   - No invented proof / no guarantee language
 */

import { isGatewayEnabledForFeature } from './intelligence/config.ts';
import {
  gatewayGenerateJson,
  GatewayPrompts,
  mapGatewayErrorToLegacyMessage,
} from './intelligence/featureBridge.ts';
import './intelligence/bootstrap.ts';

export type CopilotPatchIntent =
  | 'rewrite_tone'
  | 'expand_detail'
  | 'simplify_client_view'
  | 'fix_ready_gate_failures'
  | 'align_solution_to_diagnosis'
  | 'generate_missing_blocks'
  | 'summarize_for_email';

export interface BlockSummary {
  block_id:    string;
  block_type:  string;
  title:       string;
  status:      string;
  has_pending: boolean;
  is_locked:   boolean;
}

export interface CopilotInterpretRequest {
  user_input:      string;
  scope:           string;
  entity_id:       string;
  block_summaries: BlockSummary[];
  context: {
    company:  string;
    industry: string;
  };
}

export interface CopilotPatchTarget {
  block_id:    string;
  block_type:  string;
  title:       string;
  action:      'ai_improve' | 'ai_expand' | 'ai_simplify' | 'fix_issues';
  rationale:   string;
  constraints: {
    tone?:           string;
    do_not_change:   string[];
  };
}

export interface CopilotInterpretResponse {
  intent:              CopilotPatchIntent;
  intent_label:        string;
  targets:             CopilotPatchTarget[];
  skipped:             Array<{ block_id: string; title: string; reason: string }>;
  roi_recalc_required: boolean;
}

// ── Prompt builder ──────────────────────────────────────────────────────────

function buildCopilotPrompt(req: CopilotInterpretRequest): string {
  const targetable = req.block_summaries.filter(
    b => !b.is_locked && !b.has_pending &&
         b.block_type !== 'roi_financial_snapshot' &&
         b.block_type !== 'contract_clause',
  );

  const skippable = req.block_summaries.filter(
    b => b.is_locked || b.has_pending ||
         b.block_type === 'roi_financial_snapshot' ||
         b.block_type === 'contract_clause',
  );

  const targetableStr = targetable.length > 0
    ? targetable.map(b => `  - ${b.block_id} | ${b.block_type} | "${b.title}" | status:${b.status}`).join('\n')
    : '  (none available)';

  const skippableStr = skippable.length > 0
    ? skippable.map(b => {
        const reason = b.is_locked         ? 'locked'
          : b.has_pending                  ? 'already has pending revision'
          : b.block_type === 'roi_financial_snapshot' ? 'reference block — ROI numbers immutable'
          : 'contract clause — admin only';
        return `  - ${b.block_id} | "${b.title}" → ${reason}`;
      }).join('\n')
    : '  (none)';

  return `You are CORTEX Copilot — a structured planning engine for a consulting proposal system.

USER REQUEST: "${req.user_input}"
CLIENT: ${req.context.company} (${req.context.industry})
SCOPE: ${req.scope} / entity: ${req.entity_id}

TARGETABLE BLOCKS (can be patched — not locked, no pending revision):
${targetableStr}

PRE-SKIPPED BLOCKS (will appear in skipped array with reasons):
${skippableStr}

SUPPORTED INTENTS:
- rewrite_tone            → polish language, improve boardroom clarity
- expand_detail           → add depth, structure, integration points, outcomes
- simplify_client_view    → shorten, remove internal complexity, client-safe
- fix_ready_gate_failures → fix unapproved/draft blocks to enable proposal gate
- align_solution_to_diagnosis → ensure each solution references linked diagnosis
- generate_missing_blocks → flag missing required block types (cannot create — only flag)
- summarize_for_email     → summarize proposal for follow-up email template

HARD RULES (violation = revision rejected):
1. NEVER target roi_financial_snapshot — ROI numbers are locked by the engine
2. NEVER target contract_clause without admin=true flag
3. DO NOT change any numbers: ROI %, investment, annual_gain, payback, timeline_weeks, price
4. NO invented proof, no fabricated case studies, no fake benchmarks
5. NO guarantee language: banned phrases "guaranteed ROI", "will increase by X%"
6. Maximum 1 action per block_id
7. roi_recalc_required = true if ANY target is a proposal_solution, proposal_timeline, or proposal_next_step block

Return ONLY a valid JSON object (no markdown fences, no explanation outside JSON):
{
  "intent": "one_of_the_supported_intents",
  "intent_label": "Short human-readable label (max 5 words)",
  "targets": [
    {
      "block_id": "string",
      "block_type": "string",
      "title": "string",
      "action": "ai_improve | ai_expand | ai_simplify | fix_issues",
      "rationale": "One sentence explaining why this block was selected for this action.",
      "constraints": {
        "tone": "boardroom_premium",
        "do_not_change": ["numbers", "pricing", "timeline_weeks"]
      }
    }
  ],
  "skipped": [
    { "block_id": "string", "title": "string", "reason": "string" }
  ],
  "roi_recalc_required": false
}`.trim();
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleCopilotInterpretLegacy(
  req: CopilotInterpretRequest,
): Promise<CopilotInterpretResponse> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured.');
  }

  const prompt = buildCopilotPrompt(req);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: GatewayPrompts.copilotSystem },
        { role: 'user', content: prompt },
      ],
      temperature:     0.3,
      max_tokens:      800,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const raw  = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('OpenAI returned empty content for copilot interpret');

  let parsed: CopilotInterpretResponse;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`OpenAI response was not valid JSON: ${raw.slice(0, 200)}`);
  }

  if (!parsed.intent || !Array.isArray(parsed.targets)) {
    throw new Error('OpenAI response missing required fields: intent, targets');
  }

  return {
    intent:              parsed.intent              ?? 'rewrite_tone',
    intent_label:        parsed.intent_label        ?? parsed.intent,
    targets:             parsed.targets             ?? [],
    skipped:             parsed.skipped             ?? [],
    roi_recalc_required: parsed.roi_recalc_required ?? false,
  };
}

export async function handleCopilotInterpret(
  req: CopilotInterpretRequest,
): Promise<CopilotInterpretResponse> {
  if (!isGatewayEnabledForFeature('copilot')) {
    return handleCopilotInterpretLegacy(req);
  }

  const prompt = buildCopilotPrompt(req);
  try {
    const result = await gatewayGenerateJson({
      feature: 'copilot',
      modelProfile: 'copilot-default',
      systemPrompt: GatewayPrompts.copilotSystem,
      userPrompt: prompt,
      temperature: 0.3,
      maxTokens: 800,
      requiredFields: ['intent', 'targets'],
    });
    const parsed = JSON.parse(result.content) as CopilotInterpretResponse;
    if (!parsed.intent || !Array.isArray(parsed.targets)) {
      throw new Error('OpenAI response missing required fields: intent, targets');
    }
    return {
      intent: parsed.intent ?? 'rewrite_tone',
      intent_label: parsed.intent_label ?? parsed.intent,
      targets: parsed.targets ?? [],
      skipped: parsed.skipped ?? [],
      roi_recalc_required: parsed.roi_recalc_required ?? false,
    };
  } catch (err) {
    throw mapGatewayErrorToLegacyMessage(err);
  }
}
