/**
 * Feature: cortex.analysis — structured diagnostic intelligence extraction.
 *
 * The only feature whose output is persisted and then drives downstream
 * deterministic engines, which makes its sanitizer the most important code in
 * this directory. Every numeric field the model returns is clamped to its
 * declared range, every enumerated field is checked against its allowed set,
 * and every string is length-bounded before anything is stored.
 *
 * That is not defensive padding. A model returning `urgencyLevel: 47` on a 0–10
 * scale would silently distort every dashboard and priority ranking built on
 * top of it — the LLM would have decided an outcome, which Article 6 forbids.
 * The sanitizer is where "the model may not decide" becomes enforceable for
 * structured output.
 */

import type { AIFeatureDefinition } from '../policy/featureCatalog.ts';
import { HEAVY_LIMITS, STANDARD_GOVERNANCE } from '../policy/featureCatalog.ts';
import { object, str, stringMap, withDefault, type Validator } from '../security/validation.ts';
import { parseJsonObject } from '../governance/outputGuard.ts';

export const analysisInputValidator = object({
  submissionId: str({ minLength: 1, maxLength: 128 }),
  company: withDefault(str({ maxLength: 200 }), 'Unknown'),
  industry: withDefault(str({ maxLength: 120 }), 'Not specified'),
  employees: withDefault(str({ maxLength: 80 }), 'Not specified'),
  revenue: withDefault(str({ maxLength: 80 }), 'Not specified'),
  answers: withDefault(
    stringMap({ maxEntries: 60, maxKeyLength: 80, maxValueLength: 2_000 }),
    {} as Record<string, string>,
  ),
});

export type AnalysisInput = typeof analysisInputValidator extends Validator<infer T> ? T : never;

export type AnalysisOutput = Record<string, unknown>;

const VALID_SERVICES = [
  'operations-audit',
  'ai-implementation',
  'automation-sprint',
  'systems-integration',
  'strategic-roadmap',
  'founder-leverage',
] as const;

const VALID_RISK_TYPES = [
  'founder-dependency',
  'hiring-instead-of-systems',
  'compliance-risk',
  'tool-chaos',
  'scale-risk',
] as const;

const SERVICE_LABELS: Record<string, string> = {
  'operations-audit': 'Operations Audit',
  'ai-implementation': 'AI Implementation',
  'automation-sprint': 'Automation Sprint',
  'systems-integration': 'Systems Integration',
  'strategic-roadmap': 'Strategic Roadmap',
  'founder-leverage': 'Founder Leverage Package',
};

/** Clamp to an integer inside [min, max]. Non-numeric input becomes `min`. */
function clamp(value: unknown, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function text(value: unknown, maxLength: number, fallback = ''): string {
  const raw = value === undefined || value === null ? fallback : String(value);
  return raw.slice(0, maxLength);
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Clamp, bound and normalise raw model output into the stored analysis record.
 * Exported so the contract can be tested directly against adversarial input.
 */
export function sanitizeAnalysis(
  raw: Record<string, unknown>,
  submissionId: string,
): Record<string, unknown> {
  const coreProblems = list(raw.coreProblems)
    .slice(0, 3)
    .map((entry) => {
      const problem = (entry ?? {}) as Record<string, unknown>;
      return {
        title: text(problem.title, 80, 'Operational Issue'),
        whatsbroken: text(problem.whatsbroken, 400),
        whyBreaking: text(problem.whyBreaking, 400),
        whatBreaksNext: text(problem.whatBreaksNext, 300),
        urgencyScore: clamp(problem.urgencyScore, 0, 10),
        editable: true,
      };
    });

  const heatmap = (raw.pillarHeatmap ?? {}) as Record<string, unknown>;
  const rawRecommendation = (raw.recommendation ?? {}) as Record<string, unknown>;
  const primaryService = oneOf(rawRecommendation.primaryService, VALID_SERVICES, 'operations-audit');

  const rawRoi = (raw.roiEstimate ?? {}) as Record<string, unknown>;
  const hours = (rawRoi.hoursSavedPerMonth ?? {}) as Record<string, unknown>;
  const cost = (rawRoi.costAvoidedPerMonth ?? {}) as Record<string, unknown>;
  const revenue = (rawRoi.revenueLeakageReduced ?? {}) as Record<string, unknown>;

  const rawCallPrep = (raw.callPrep ?? {}) as Record<string, unknown>;
  const boundedStrings = (value: unknown, count: number, maxLength: number): string[] =>
    list(value)
      .slice(0, count)
      .map((entry) => text(entry, maxLength));

  return {
    submissionId,
    status: 'complete',

    urgencyLevel: clamp(raw.urgencyLevel, 0, 10),
    impactPotential: clamp(raw.impactPotential, 0, 10),
    readinessScore: oneOf(raw.readinessScore, ['Low', 'Medium', 'High'] as const, 'Medium'),
    confidenceScore: oneOf(
      raw.confidenceScore,
      ['Low', 'Medium', 'High', 'Very High'] as const,
      'Medium',
    ),
    primaryPainSignal: text(raw.primaryPainSignal, 300),
    aiScore: clamp(raw.aiScore, 0, 100),
    qualityScore: clamp(raw.qualityScore, 0, 100),
    priority: oneOf(raw.priority, ['low', 'medium', 'high'] as const, 'medium'),

    coreProblems,

    pillarHeatmap: {
      operationsExecution: clamp(heatmap.operationsExecution, 0, 5),
      revenueGrowth: clamp(heatmap.revenueGrowth, 0, 5),
      systemsAutomation: clamp(heatmap.systemsAutomation, 0, 5),
      aiReadinessGovernance: clamp(heatmap.aiReadinessGovernance, 0, 5),
    },

    riskFlags: list(raw.riskFlags)
      .slice(0, 4)
      .map((entry) => {
        const flag = (entry ?? {}) as Record<string, unknown>;
        return {
          type: oneOf(flag.type, VALID_RISK_TYPES, 'scale-risk'),
          label: text(flag.label, 60, 'Risk Identified'),
          description: text(flag.description, 400),
          severity: oneOf(flag.severity, ['critical', 'high', 'medium'] as const, 'medium'),
        };
      }),

    recommendation: {
      primaryService,
      primaryServiceLabel: text(
        rawRecommendation.primaryServiceLabel,
        120,
        SERVICE_LABELS[primaryService] ?? primaryService,
      ),
      reasoning: text(rawRecommendation.reasoning, 800),
      notRecommended: list(rawRecommendation.notRecommended)
        .slice(0, 3)
        .map((entry) => {
          const item = (entry ?? {}) as Record<string, unknown>;
          return { service: text(item.service, 80), reason: text(item.reason, 200) };
        }),
      focusAreas: boundedStrings(rawRecommendation.focusAreas, 5, 120),
      suggestedTimeline: text(rawRecommendation.suggestedTimeline, 50, '8-12 weeks'),
      recommendationStatus: 'pending',
    },

    roiEstimate: {
      hoursSavedPerMonth: {
        conservative: clamp(hours.conservative, 0, 9_999),
        aggressive: clamp(hours.aggressive, 0, 9_999),
      },
      costAvoidedPerMonth: {
        conservative: clamp(cost.conservative, 0, 999_999),
        aggressive: clamp(cost.aggressive, 0, 999_999),
      },
      revenueLeakageReduced: {
        conservative: clamp(revenue.conservative, 0, 999_999),
        aggressive: clamp(revenue.aggressive, 0, 999_999),
      },
      operationalRiskReduction: oneOf(
        rawRoi.operationalRiskReduction,
        ['low', 'medium', 'high', 'very-high'] as const,
        'medium',
      ),
      notes: 'AI-generated estimates. Validate on discovery call.',
      confidenceLevel: 'conservative',
    },

    callPrep: {
      leadId: submissionId,
      suggestedAgenda: boundedStrings(rawCallPrep.suggestedAgenda, 6, 200),
      keyQuestionsToValidate: boundedStrings(rawCallPrep.keyQuestionsToValidate, 6, 200),
      expectedObjections: list(rawCallPrep.expectedObjections)
        .slice(0, 4)
        .map((entry) => {
          const item = (entry ?? {}) as Record<string, unknown>;
          return { objection: text(item.objection, 200), response: text(item.response, 400) };
        }),
      doNotPitchYetWarnings: boundedStrings(rawCallPrep.doNotPitchYetWarnings, 3, 200),
      expansionSignalsToListenFor: boundedStrings(rawCallPrep.expansionSignalsToListenFor, 4, 200),
    },

    analysisNotes: text(raw.analysisNotes, 500),
  };
}

export const analysisFeature: AIFeatureDefinition<AnalysisInput, AnalysisOutput> = {
  descriptor: {
    featureId: 'cortex.analysis',
    featureVersion: '1.0.0',
    displayName: 'Cortex Diagnostic Analysis',
    owner: 'MARQ Cortex — AI Platform',
    enabled: true,
    capability: 'ai.analysis.run',
    allowedActorTypes: ['team_user', 'service'],
    allowedChannels: ['team_console', 'system'],
    promptId: 'analysis.diagnostic_intelligence',
    responseFormat: 'json_object',
    temperature: 0.3,
    budgetClass: 'batch',
    limits: HEAVY_LIMITS,
    governance: {
      ...STANDARD_GOVERNANCE,
      // Structured extraction is not prose: house-tone bans would flag ordinary
      // field values ("systems integration") without improving anything.
      enforceToneBans: false,
      requiredOutputFields: ['aiScore', 'coreProblems', 'recommendation'],
      maxOutputChars: 40_000,
    },
    requiredCapabilities: { structuredOutput: true, chatCompletions: true },
  },

  inputValidator: analysisInputValidator,

  buildVariables(input) {
    const entries = Object.entries(input.answers);
    return {
      company: input.company,
      industry: input.industry,
      employees: input.employees,
      revenue: input.revenue,
      answerCount: String(entries.length),
      answers:
        entries.length === 0
          ? 'No answers provided.'
          : entries.map(([key, value]) => `Q${key}: ${value.slice(0, 600)}`).join('\n'),
    };
  },

  parseOutput(content, input) {
    return sanitizeAnalysis(parseJsonObject(content), input.submissionId);
  },
};
