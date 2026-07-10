/**
 * CORTEX NARRATIVE GENERATION — Intelligence Gateway
 *
 * Generates explanation-layer narratives:
 *   - why_now: urgency analysis
 *   - confidence_reasoning: confidence score breakdown
 *   - strategic_decision: why this recommendation first
 *
 * Core Rule: "Math decides priority, LLM only explains decisions."
 */

import { isGatewayEnabledForFeature } from './intelligence/config.ts';
import {
  gatewayGenerateText,
  GatewayPrompts,
  mapGatewayErrorToLegacyMessage,
} from './intelligence/featureBridge.ts';
import './intelligence/bootstrap.ts';

// ============================================================================
// TYPES
// ============================================================================

export interface NarrativeRequest {
  type: 'why_now' | 'confidence_reasoning' | 'strategic_decision';
  context: {
    company: string;
    industry: string;
    employee_estimate: number;
    current_version: string;
    assumptions: Record<string, number>;
    top_recommendation?: {
      problem_title: string;
      severity_score: number;
      pillar_impact: string[];
      confidence_score: number;
      priority_score: {
        impact_score: number;
        feasibility_score: number;
        risk_score: number;
        computed_priority: number;
      };
      why_first: string;
      evidence_strength?: {
        validated_signals: number;
        cross_department_validations: number;
        contradiction_flags: number;
      };
    };
    recommendation_count: number;
  };
}

export interface NarrativeResponse {
  type: string;
  narrative: string;
  model: string;
  generated_at: string;
}

// ============================================================================
// PROMPT BUILDERS
// ============================================================================

function buildWhyNowPrompt(ctx: NarrativeRequest['context']): string {
  const a = ctx.assumptions;
  return `You are CORTEX, a decision intelligence engine. Generate a concise "Why Now" urgency narrative (3-5 sentences) for ${ctx.company} (${ctx.industry}, ~${ctx.employee_estimate} employees).

DETERMINISTIC INPUTS (do not override — explain only):
- Support tickets/week: ${a.support_tickets_per_week ?? 'N/A'}
- Avg response time: ${a.avg_response_time_hours ?? 'N/A'} hours
- Monthly revenue: $${(a.monthly_revenue ?? 0).toLocaleString()}
- Top recommendation: "${ctx.top_recommendation?.problem_title ?? 'N/A'}"
- Severity: ${ctx.top_recommendation?.severity_score ?? 0}/10
- Current analysis version: ${ctx.current_version}
- Total recommendations: ${ctx.recommendation_count}

RULES:
1. Reference specific numbers from the inputs above
2. Explain the compounding cost of inaction per quarter
3. Reference industry trends (${ctx.industry}) favoring automation
4. Mention the urgency window narrowing
5. DO NOT invent numbers not in the inputs
6. Keep it professional and data-driven

Return ONLY the narrative text, no JSON wrapping.`;
}

function buildConfidenceReasoningPrompt(ctx: NarrativeRequest['context']): string {
  const rec = ctx.top_recommendation;
  return `You are CORTEX, a decision intelligence engine. Generate a "Confidence Reasoning" explanation (3-5 sentences) for ${ctx.company}.

DETERMINISTIC INPUTS (do not override — explain only):
- Confidence score: ${rec?.confidence_score ?? 0}/100
- Priority score components:
  - Impact: ${rec?.priority_score.impact_score ?? 0}/10 (weight: 40%)
  - Feasibility: ${rec?.priority_score.feasibility_score ?? 0}/10 (weight: 30%)
  - Risk: ${rec?.priority_score.risk_score ?? 0}/10
  - Computed priority: ${rec?.priority_score.computed_priority ?? 0}
- Evidence strength:
  - Validated signals: ${rec?.evidence_strength?.validated_signals ?? 0}
  - Cross-department validations: ${rec?.evidence_strength?.cross_department_validations ?? 0}
  - Contradiction flags: ${rec?.evidence_strength?.contradiction_flags ?? 0}
- Total recommendations: ${ctx.recommendation_count}
- Confidence formula: priority*0.4 + feasibility*0.3 + evidence*0.3 (scaled 0-100)

RULES:
1. Explain each component's contribution to the confidence score
2. Reference the formula: confidence = priority*0.4 + feasibility*0.3 + evidence*0.3
3. Explain what contradiction flags mean for confidence
4. End with: "The score reflects deterministic calculation, not AI opinion."
5. DO NOT invent numbers

Return ONLY the narrative text, no JSON wrapping.`;
}

function buildStrategicDecisionPrompt(ctx: NarrativeRequest['context']): string {
  const rec = ctx.top_recommendation;
  return `You are CORTEX, a decision intelligence engine. Generate a "Strategic Decision" explanation (3-5 sentences) for why "${rec?.problem_title ?? 'the primary recommendation'}" was selected first for ${ctx.company}.

DETERMINISTIC INPUTS (do not override — explain only):
- Problem: "${rec?.problem_title ?? 'N/A'}"
- Computed priority: ${rec?.priority_score.computed_priority ?? 0}/10
- Impact score: ${rec?.priority_score.impact_score ?? 0}/10
- Feasibility score: ${rec?.priority_score.feasibility_score ?? 0}/10
- Severity: ${rec?.severity_score ?? 0}/10
- Pillar impact: ${rec?.pillar_impact?.join(', ') ?? 'N/A'}
- Why first (from engine): "${rec?.why_first ?? 'N/A'}"
- Total recommendations: ${ctx.recommendation_count}

SEQUENCING RULES (Cortex deterministic rules):
1. Resolve constraints before optimization
2. Fix bottlenecks before growth
3. Close data gaps before AI implementation
4. Reduce risk before increasing spend

RULES:
1. State this is a math-driven decision, not AI preference
2. Reference the specific scores and how the formula ranked this first
3. Mention which sequencing rule(s) apply
4. Explain how this recommendation unlocks downstream value for the remaining ${ctx.recommendation_count - 1} recommendations
5. DO NOT invent numbers

Return ONLY the narrative text, no JSON wrapping.`;
}

function buildPromptForType(request: NarrativeRequest): string {
  switch (request.type) {
    case 'why_now':
      return buildWhyNowPrompt(request.context);
    case 'confidence_reasoning':
      return buildConfidenceReasoningPrompt(request.context);
    case 'strategic_decision':
      return buildStrategicDecisionPrompt(request.context);
    default:
      throw new Error(`Unknown narrative type: ${(request as NarrativeRequest).type}`);
  }
}

// ============================================================================
// LEGACY PATH (rollback)
// ============================================================================

export async function generateNarrativeLegacy(request: NarrativeRequest): Promise<NarrativeResponse> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured. Add it via Supabase dashboard -> Edge Functions -> Secrets.');
  }

  const prompt = buildPromptForType(request);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: GatewayPrompts.narrativeSystem },
        { role: 'user', content: prompt },
      ],
      temperature: 0.4,
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response from OpenAI for narrative generation');

  return {
    type: request.type,
    narrative: content.trim(),
    model: data.model ?? 'gpt-4o-mini',
    generated_at: new Date().toISOString(),
  };
}

// ============================================================================
// GATEWAY PATH
// ============================================================================

async function generateNarrativeViaGateway(request: NarrativeRequest): Promise<NarrativeResponse> {
  const prompt = buildPromptForType(request);
  try {
    const result = await gatewayGenerateText({
      feature: 'narrative',
      modelProfile: 'narrative-default',
      systemPrompt: GatewayPrompts.narrativeSystem,
      userPrompt: prompt,
      temperature: 0.4,
      maxTokens: 500,
      metadata: { narrativeType: request.type },
    });
    return {
      type: request.type,
      narrative: result.content.trim(),
      model: result.model,
      generated_at: result.generatedAt,
    };
  } catch (err) {
    throw mapGatewayErrorToLegacyMessage(err);
  }
}

export async function generateNarrative(request: NarrativeRequest): Promise<NarrativeResponse> {
  if (!isGatewayEnabledForFeature('narrative')) {
    return generateNarrativeLegacy(request);
  }
  return generateNarrativeViaGateway(request);
}
