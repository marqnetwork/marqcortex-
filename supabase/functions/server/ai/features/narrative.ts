/**
 * Feature: cortex.narrative — the explanation layer over deterministic scoring.
 *
 * Constitution Article 6 in feature form. The deterministic engines compute
 * severity, priority, confidence and sequencing; this feature turns those
 * numbers into board-readable prose and is structurally incapable of changing
 * them: every figure the model sees arrives as a pre-formatted string variable,
 * and the output is plain text that is never parsed back into a score.
 *
 * Three narrative types share one feature because they share one governance
 * posture. They differ only in which registered prompt is rendered, which is
 * exactly what `resolvePromptId` exists for.
 */

import type { AIFeatureDefinition } from '../policy/featureCatalog.ts';
import { INTERACTIVE_LIMITS, STANDARD_GOVERNANCE } from '../policy/featureCatalog.ts';
import {
  int,
  literal,
  num,
  object,
  optional,
  str,
  withDefault,
  type Validator,
} from '../security/validation.ts';

export const NARRATIVE_TYPES = ['why_now', 'confidence_reasoning', 'strategic_decision'] as const;
export type NarrativeType = (typeof NARRATIVE_TYPES)[number];

const priorityScore = object({
  impact_score: withDefault(num({ min: 0, max: 10 }), 0),
  feasibility_score: withDefault(num({ min: 0, max: 10 }), 0),
  risk_score: withDefault(num({ min: 0, max: 10 }), 0),
  computed_priority: withDefault(num({ min: 0, max: 100 }), 0),
});

const evidenceStrength = object({
  validated_signals: withDefault(int({ min: 0, max: 10_000 }), 0),
  cross_department_validations: withDefault(int({ min: 0, max: 10_000 }), 0),
  contradiction_flags: withDefault(int({ min: 0, max: 10_000 }), 0),
});

const topRecommendation = object({
  problem_title: withDefault(str({ maxLength: 200 }), 'Not specified'),
  severity_score: withDefault(num({ min: 0, max: 10 }), 0),
  pillar_impact: withDefault(str({ maxLength: 400 }), ''),
  confidence_score: withDefault(num({ min: 0, max: 100 }), 0),
  priority_score: withDefault(priorityScore, {
    impact_score: 0,
    feasibility_score: 0,
    risk_score: 0,
    computed_priority: 0,
  }),
  why_first: withDefault(str({ maxLength: 600 }), 'Not specified'),
  evidence_strength: optional(evidenceStrength),
});

const assumptions = object({
  support_tickets_per_week: optional(num({ min: 0, max: 1_000_000 })),
  avg_response_time_hours: optional(num({ min: 0, max: 100_000 })),
  monthly_revenue: optional(num({ min: 0, max: 1_000_000_000_000 })),
});

/** Every member is optional, so "no assumptions supplied" is this value. */
const EMPTY_ASSUMPTIONS = {
  support_tickets_per_week: undefined,
  avg_response_time_hours: undefined,
  monthly_revenue: undefined,
};

export const narrativeInputValidator = object({
  type: literal(NARRATIVE_TYPES),
  context: object({
    company: str({ minLength: 1, maxLength: 200 }),
    industry: withDefault(str({ maxLength: 120 }), 'Not specified'),
    employee_estimate: withDefault(int({ min: 0, max: 10_000_000 }), 0),
    current_version: withDefault(str({ maxLength: 50 }), 'v1'),
    // `assumptions` has only optional members, so an absent object and an
    // empty one are the same thing — the validator returns the empty shape.
    assumptions: withDefault(assumptions, EMPTY_ASSUMPTIONS),
    top_recommendation: optional(topRecommendation),
    recommendation_count: withDefault(int({ min: 0, max: 1_000 }), 0),
  }),
});

export type NarrativeInput = typeof narrativeInputValidator extends Validator<infer T> ? T : never;

export interface NarrativeOutput {
  readonly type: NarrativeType;
  readonly narrative: string;
}

const PROMPT_BY_TYPE: Record<NarrativeType, string> = {
  why_now: 'narrative.why_now',
  confidence_reasoning: 'narrative.confidence_reasoning',
  strategic_decision: 'narrative.strategic_decision',
};

/** Formats a figure for the prompt. Absent means absent — never zero. */
const figure = (value: number | undefined): string =>
  value === undefined ? 'not recorded' : String(value);

const currency = (value: number | undefined): string =>
  value === undefined ? 'not recorded' : `$${Math.round(value).toLocaleString('en-US')}`;

export const narrativeFeature: AIFeatureDefinition<NarrativeInput, NarrativeOutput> = {
  descriptor: {
    featureId: 'cortex.narrative',
    featureVersion: '1.0.0',
    displayName: 'Cortex Narrative',
    owner: 'MARQ Cortex — AI Platform',
    enabled: true,
    capability: 'ai.narrative.generate',
    allowedActorTypes: ['team_user', 'service'],
    allowedChannels: ['team_console', 'system'],
    promptId: 'narrative.why_now',
    responseFormat: 'text',
    temperature: 0.4,
    budgetClass: 'interactive',
    limits: { ...INTERACTIVE_LIMITS, maxOutputTokens: 600 },
    governance: { ...STANDARD_GOVERNANCE, maxOutputChars: 6_000 },
    requiredCapabilities: { structuredOutput: false, chatCompletions: true },
  },

  inputValidator: narrativeInputValidator,

  resolvePromptId: (input) => PROMPT_BY_TYPE[input.type],

  buildVariables(input) {
    const { context } = input;
    const recommendation = context.top_recommendation;
    const priority = recommendation?.priority_score;
    const evidence = recommendation?.evidence_strength;

    // One variable map covers all three prompts. Each prompt declares the
    // subset it uses, and the registry rejects a template that references
    // anything not declared — so an unused key here can never silently rot.
    return {
      company: context.company,
      industry: context.industry,
      employeeEstimate: String(context.employee_estimate),
      currentVersion: context.current_version,
      recommendationCount: String(context.recommendation_count),
      supportTicketsPerWeek: figure(context.assumptions.support_tickets_per_week),
      avgResponseTimeHours: figure(context.assumptions.avg_response_time_hours),
      monthlyRevenue: currency(context.assumptions.monthly_revenue),
      topRecommendationTitle: recommendation?.problem_title ?? 'the primary recommendation',
      severityScore: figure(recommendation?.severity_score),
      confidenceScore: figure(recommendation?.confidence_score),
      impactScore: figure(priority?.impact_score),
      feasibilityScore: figure(priority?.feasibility_score),
      riskScore: figure(priority?.risk_score),
      computedPriority: figure(priority?.computed_priority),
      validatedSignals: figure(evidence?.validated_signals),
      crossDepartmentValidations: figure(evidence?.cross_department_validations),
      contradictionFlags: figure(evidence?.contradiction_flags),
      pillarImpact: recommendation?.pillar_impact || 'not recorded',
      whyFirst: recommendation?.why_first ?? 'not recorded',
    };
  },

  parseOutput(content, input) {
    return { type: input.type, narrative: content.trim() };
  },
};
