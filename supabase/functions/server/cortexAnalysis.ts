/**
 * CORTEX AI ANALYSIS ENGINE — Phase 5C
 *
 * Transforms raw diagnostic answers into structured CORTEX intelligence
 * by calling OpenAI GPT-4o-mini with a structured JSON prompt.
 *
 * KV key: cortex:{submissionId}
 * Status: "complete" | "pending" | "error"
 */

import { isGatewayEnabledForFeature } from './intelligence/config.ts';
import {
  gatewayGenerateJson,
  GatewayPrompts,
  mapGatewayErrorToLegacyMessage,
} from './intelligence/featureBridge.ts';
import './intelligence/bootstrap.ts';

// ============================================================================
// PROMPT BUILDER
// ============================================================================

export function buildCortexPrompt(sub: Record<string, any>): string {
  const answers = sub.answers || {};
  const answerLines = Object.entries(answers)
    .map(([key, val]) => `Q${key}: ${String(val).substring(0, 600)}`)
    .join('\n');

  const answerCount = Object.keys(answers).length;

  return `You are CORTEX, a decision intelligence engine for operational consulting.

Analyze the following business diagnostic submission and return ONLY valid JSON.
No markdown code blocks. No explanation. Just the JSON object.

---
COMPANY PROFILE:
Name: ${sub.company || 'Unknown'}
Industry: ${sub.industry || 'Not specified'}
Employees: ${sub.employees || 'Not specified'}
Revenue: ${sub.revenue || 'Not specified'}
Email: ${sub.email || ''}

DIAGNOSTIC RESPONSES (${answerCount} answers):
${answerLines || 'No answers provided.'}
---

SCORING GUIDE:
- pillarHeatmap scores: 0 = critical failure (most broken), 5 = fully optimized (stable)
- urgencyLevel: 0 = no urgency, 10 = must act this week
- impactPotential: 0 = minimal upside, 10 = transformative
- aiScore: overall lead quality 0-100 (completeness + quality of answers + pain signal clarity)
- priority: "high" if aiScore >= 75 or urgencyLevel >= 8, "medium" if >= 50, else "low"

VALID primaryService values (use exactly one):
"operations-audit" | "ai-implementation" | "automation-sprint" | "systems-integration" | "strategic-roadmap" | "founder-leverage"

VALID riskFlag type values:
"founder-dependency" | "hiring-instead-of-systems" | "compliance-risk" | "tool-chaos" | "scale-risk"

Return this exact JSON structure with NO extra fields:
{
  "urgencyLevel": <integer 0-10>,
  "impactPotential": <integer 0-10>,
  "readinessScore": "<Low|Medium|High>",
  "confidenceScore": "<Low|Medium|High|Very High>",
  "primaryPainSignal": "<one clear sentence describing the single biggest operational pain>",
  "aiScore": <integer 0-100>,
  "qualityScore": <integer 0-100>,
  "priority": "<low|medium|high>",
  "coreProblems": [
    {
      "title": "<short problem title, max 6 words>",
      "whatsbroken": "<what is currently broken, 1-2 sentences>",
      "whyBreaking": "<root cause, 1-2 sentences>",
      "whatBreaksNext": "<downstream consequence if ignored, 1 sentence>",
      "urgencyScore": <integer 0-10>
    },
    {
      "title": "<short problem title>",
      "whatsbroken": "<description>",
      "whyBreaking": "<root cause>",
      "whatBreaksNext": "<consequence>",
      "urgencyScore": <integer 0-10>
    },
    {
      "title": "<short problem title>",
      "whatsbroken": "<description>",
      "whyBreaking": "<root cause>",
      "whatBreaksNext": "<consequence>",
      "urgencyScore": <integer 0-10>
    }
  ],
  "pillarHeatmap": {
    "operationsExecution": <integer 0-5>,
    "revenueGrowth": <integer 0-5>,
    "systemsAutomation": <integer 0-5>,
    "aiReadinessGovernance": <integer 0-5>
  },
  "riskFlags": [
    {
      "type": "<valid type from list above>",
      "label": "<short human label>",
      "description": "<clear description with evidence from answers>",
      "severity": "<critical|high|medium>"
    }
  ],
  "recommendation": {
    "primaryService": "<valid service type from list above>",
    "primaryServiceLabel": "<human-readable service name>",
    "reasoning": "<why this service first — 2-3 sentences referencing specific answers>",
    "notRecommended": [
      { "service": "<service name>", "reason": "<why not yet — 1 sentence>" },
      { "service": "<service name>", "reason": "<why not yet — 1 sentence>" }
    ],
    "focusAreas": ["<specific deliverable 1>", "<specific deliverable 2>", "<specific deliverable 3>"],
    "suggestedTimeline": "<e.g. 8-12 weeks>"
  },
  "roiEstimate": {
    "hoursSavedPerMonth": { "conservative": <integer>, "aggressive": <integer> },
    "costAvoidedPerMonth": { "conservative": <integer>, "aggressive": <integer> },
    "revenueLeakageReduced": { "conservative": <integer>, "aggressive": <integer> },
    "operationalRiskReduction": "<low|medium|high|very-high>"
  },
  "callPrep": {
    "suggestedAgenda": ["<agenda item 1>", "<agenda item 2>", "<agenda item 3>"],
    "keyQuestionsToValidate": ["<validation question 1>", "<validation question 2>", "<validation question 3>"],
    "expectedObjections": [
      { "objection": "<likely objection>", "response": "<concise response>" },
      { "objection": "<likely objection>", "response": "<concise response>" }
    ],
    "doNotPitchYetWarnings": ["<what NOT to pitch yet and why>"],
    "expansionSignalsToListenFor": ["<signal 1>", "<signal 2>"]
  },
  "analysisNotes": "<1-2 sentences of internal team notes about this lead — conversion potential, red flags, next move>"
}`;
}

// ============================================================================
// OPENAI CALLER (legacy + Intelligence Gateway)
// ============================================================================

export async function callOpenAILegacy(prompt: string): Promise<Record<string, any>> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured. Add it via the Supabase dashboard → Edge Functions → Secrets.');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: GatewayPrompts.analysisSystem,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 2500,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response from OpenAI');

  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`Failed to parse OpenAI JSON response: ${content.substring(0, 200)}`);
  }
}

export async function callOpenAI(prompt: string): Promise<Record<string, any>> {
  if (!isGatewayEnabledForFeature('analysis')) {
    return callOpenAILegacy(prompt);
  }
  try {
    const result = await gatewayGenerateJson({
      feature: 'analysis',
      modelProfile: 'analysis-default',
      systemPrompt: GatewayPrompts.analysisSystem,
      userPrompt: prompt,
      temperature: 0.3,
      maxTokens: 2500,
    });
    return JSON.parse(result.content);
  } catch (err) {
    throw mapGatewayErrorToLegacyMessage(err);
  }
}

// ============================================================================
// VALIDATOR + SANITIZER
// ============================================================================

/** Clamp a number between min and max */
function clamp(n: unknown, min: number, max: number): number {
  const num = typeof n === 'number' ? n : parseInt(String(n), 10);
  if (isNaN(num)) return min;
  return Math.max(min, Math.min(max, num));
}

const VALID_SERVICES = [
  'operations-audit', 'ai-implementation', 'automation-sprint',
  'systems-integration', 'strategic-roadmap', 'founder-leverage',
];

const VALID_RISK_TYPES = [
  'founder-dependency', 'hiring-instead-of-systems',
  'compliance-risk', 'tool-chaos', 'scale-risk',
];

export function sanitizeAnalysis(ai: Record<string, any>, submissionId: string): Record<string, any> {
  const now = new Date().toISOString();

  // Sanitize coreProblems — ensure exactly 3
  const rawProblems = Array.isArray(ai.coreProblems) ? ai.coreProblems : [];
  const coreProblems = rawProblems.slice(0, 3).map((p: any) => ({
    title: String(p?.title || 'Operational Issue').substring(0, 80),
    whatsbroken: String(p?.whatsbroken || '').substring(0, 400),
    whyBreaking: String(p?.whyBreaking || '').substring(0, 400),
    whatBreaksNext: String(p?.whatBreaksNext || '').substring(0, 300),
    urgencyScore: clamp(p?.urgencyScore, 0, 10),
    editable: true,
  }));

  // Sanitize pillarHeatmap
  const rawHeatmap = ai.pillarHeatmap || {};
  const pillarHeatmap = {
    operationsExecution: clamp(rawHeatmap.operationsExecution, 0, 5),
    revenueGrowth: clamp(rawHeatmap.revenueGrowth, 0, 5),
    systemsAutomation: clamp(rawHeatmap.systemsAutomation, 0, 5),
    aiReadinessGovernance: clamp(rawHeatmap.aiReadinessGovernance, 0, 5),
  };

  // Sanitize riskFlags
  const rawFlags = Array.isArray(ai.riskFlags) ? ai.riskFlags : [];
  const riskFlags = rawFlags.slice(0, 4).map((f: any) => ({
    type: VALID_RISK_TYPES.includes(f?.type) ? f.type : 'scale-risk',
    label: String(f?.label || 'Risk Identified').substring(0, 60),
    description: String(f?.description || '').substring(0, 400),
    severity: ['critical', 'high', 'medium'].includes(f?.severity) ? f.severity : 'medium',
  }));

  // Sanitize recommendation
  const rawRec = ai.recommendation || {};
  const primaryService = VALID_SERVICES.includes(rawRec.primaryService)
    ? rawRec.primaryService
    : 'operations-audit';
  const recommendation = {
    primaryService,
    primaryServiceLabel: String(rawRec.primaryServiceLabel || labelFromService(primaryService)),
    reasoning: String(rawRec.reasoning || '').substring(0, 800),
    notRecommended: Array.isArray(rawRec.notRecommended)
      ? rawRec.notRecommended.slice(0, 3).map((nr: any) => ({
          service: String(nr?.service || '').substring(0, 80),
          reason: String(nr?.reason || '').substring(0, 200),
        }))
      : [],
    focusAreas: Array.isArray(rawRec.focusAreas)
      ? rawRec.focusAreas.slice(0, 5).map((a: any) => String(a).substring(0, 120))
      : [],
    suggestedTimeline: String(rawRec.suggestedTimeline || '8-12 weeks').substring(0, 50),
    recommendationStatus: 'pending' as const,
  };

  // Sanitize ROI
  const rawROI = ai.roiEstimate || {};
  const hrs = rawROI.hoursSavedPerMonth || {};
  const cost = rawROI.costAvoidedPerMonth || {};
  const rev = rawROI.revenueLeakageReduced || {};
  const roiEstimate = {
    hoursSavedPerMonth: { conservative: clamp(hrs.conservative, 0, 9999), aggressive: clamp(hrs.aggressive, 0, 9999) },
    costAvoidedPerMonth: { conservative: clamp(cost.conservative, 0, 999999), aggressive: clamp(cost.aggressive, 0, 999999) },
    revenueLeakageReduced: { conservative: clamp(rev.conservative, 0, 999999), aggressive: clamp(rev.aggressive, 0, 999999) },
    operationalRiskReduction: ['low', 'medium', 'high', 'very-high'].includes(rawROI.operationalRiskReduction)
      ? rawROI.operationalRiskReduction
      : 'medium',
    notes: 'AI-generated estimates. Validate on discovery call.',
    confidenceLevel: 'conservative' as const,
  };

  // Sanitize callPrep
  const rawCall = ai.callPrep || {};
  const callPrep = {
    leadId: submissionId,
    suggestedAgenda: Array.isArray(rawCall.suggestedAgenda)
      ? rawCall.suggestedAgenda.slice(0, 6).map((a: any) => String(a).substring(0, 200))
      : [],
    keyQuestionsToValidate: Array.isArray(rawCall.keyQuestionsToValidate)
      ? rawCall.keyQuestionsToValidate.slice(0, 6).map((q: any) => String(q).substring(0, 200))
      : [],
    expectedObjections: Array.isArray(rawCall.expectedObjections)
      ? rawCall.expectedObjections.slice(0, 4).map((o: any) => ({
          objection: String(o?.objection || '').substring(0, 200),
          response: String(o?.response || '').substring(0, 400),
        }))
      : [],
    doNotPitchYetWarnings: Array.isArray(rawCall.doNotPitchYetWarnings)
      ? rawCall.doNotPitchYetWarnings.slice(0, 3).map((w: any) => String(w).substring(0, 200))
      : [],
    expansionSignalsToListenFor: Array.isArray(rawCall.expansionSignalsToListenFor)
      ? rawCall.expansionSignalsToListenFor.slice(0, 4).map((s: any) => String(s).substring(0, 200))
      : [],
  };

  return {
    submissionId,
    analyzedAt: now,
    model: 'gpt-4o-mini',
    status: 'complete',
    // Lead scores
    urgencyLevel: clamp(ai.urgencyLevel, 0, 10),
    impactPotential: clamp(ai.impactPotential, 0, 10),
    readinessScore: ['Low', 'Medium', 'High'].includes(ai.readinessScore) ? ai.readinessScore : 'Medium',
    confidenceScore: ['Low', 'Medium', 'High', 'Very High'].includes(ai.confidenceScore) ? ai.confidenceScore : 'Medium',
    primaryPainSignal: String(ai.primaryPainSignal || '').substring(0, 300),
    aiScore: clamp(ai.aiScore, 0, 100),
    qualityScore: clamp(ai.qualityScore, 0, 100),
    priority: ['low', 'medium', 'high'].includes(ai.priority) ? ai.priority : 'medium',
    // Analysis
    coreProblems,
    pillarHeatmap,
    riskFlags,
    recommendation,
    roiEstimate,
    callPrep,
    analysisNotes: String(ai.analysisNotes || '').substring(0, 500),
  };
}

// ============================================================================
// MAIN ORCHESTRATOR
// ============================================================================

export async function runCortexAnalysis(submission: Record<string, any>): Promise<Record<string, any>> {
  const prompt = buildCortexPrompt(submission);
  const rawAI = await callOpenAI(prompt);
  return sanitizeAnalysis(rawAI, submission.id);
}

// ============================================================================
// HELPER
// ============================================================================

function labelFromService(s: string): string {
  const m: Record<string, string> = {
    'operations-audit': 'Operations Audit',
    'ai-implementation': 'AI Implementation',
    'automation-sprint': 'Automation Sprint',
    'systems-integration': 'Systems Integration',
    'strategic-roadmap': 'Strategic Roadmap',
    'founder-leverage': 'Founder Leverage Package',
  };
  return m[s] || s;
}
