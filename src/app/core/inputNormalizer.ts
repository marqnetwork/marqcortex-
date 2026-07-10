/**
 * CORTEX CORE — MODULE 1: INPUT NORMALIZER
 *
 * Converts raw questionnaire answers into numeric metrics.
 * Handles missing data. Outputs structured diagnostic object.
 *
 * Pure function: same input → same output. No side effects.
 */

import type { AnnotatedResponse } from '@/app/utils/questionRegistry';
import type {
  NormalizedDiagnostics,
  NormalizedAnswer,
  CausalHit,
  CausalCategory,
  SignalType,
  DomainKey,
} from './types';
import { CAUSAL_TO_DOMAIN as causalToDomain } from './types';

// ── Causal keyword registry (deterministic classification) ────────────────────

const CAUSAL_KEYWORDS: Record<CausalCategory, string[]> = {
  manual_dependency: [
    'manual', 'manually', 'by hand', 'copy-paste', 'copy paste', 'spreadsheet',
    'repetitive', 'every time', 'same task', 'human doing', 'typed in',
    'enters it', 'one by one', 'no automation', 'we do it ourselves',
  ],
  tool_fragmentation: [
    'disconnected', 'nothing connects', 'too many tools', "doesn't integrate",
    'silo', 'siloed', 'fragmented', 'scattered', 'duplicate', 'legacy',
    'different system', 'separate tool', 'workaround', 'export and import',
  ],
  governance_bottleneck: [
    'approval', 'sign-off', 'depends on me', 'founder', 'waits for me',
    'bottleneck', "can't move without", 'my decision', 'escalat', 'permission',
    'only I', 'only person', 'single point', 'approval queue',
  ],
  revenue_leakage: [
    'lost revenue', 'losing money', 'abandoned cart', 'cart abandonment',
    'churn', 'cancellation', 'refund', 'wasted', 'missed', 'leakage',
    'not capturing', 'falling through', 'upsell', 'retention',
  ],
  scalability_risk: [
    'break', 'collapse', 'overwhelmed', "can't handle", 'capacity',
    'not scalable', "won't scale", 'burn out', 'burnout', 'stretched',
    'overloaded', 'breaking point', 'can not keep up', 'hiring just to',
  ],
  data_integrity: [
    'incorrect', 'wrong data', 'discrepancy', 'counts off', 'no visibility',
    "can't see", "don't know", 'no single source', 'data loss', 'error',
    'inaccurate', 'outdated', 'stale', 'conflicting', 'unreliable',
  ],
};

// ── Maturity heuristic ────────────────────────────────────────────────────────

function estimateMaturity(answer: string, causalHits: CausalHit[]): number {
  const lower = answer.toLowerCase();
  const wordCount = answer.split(/\s+/).filter(Boolean).length;
  const totalWeight = causalHits.reduce((s, h) => s + h.weight, 0);

  // Strong negative signals → low maturity
  if (totalWeight >= 5) return 1;
  if (totalWeight >= 3) return 2;

  // Positive signals
  const positiveKeywords = ['automated', 'dashboard', 'integrated', 'systematic', 'documented', 'sop', 'kpi', 'metrics'];
  const positiveHits = positiveKeywords.filter(kw => lower.includes(kw)).length;
  if (positiveHits >= 3) return 5;
  if (positiveHits >= 2) return 4;
  if (positiveHits >= 1) return 3;

  // Default based on answer quality
  if (wordCount < 10) return 2;
  return 3;
}

// ── Primary signal type classification ────────────────────────────────────────

function classifyPrimarySignal(causalHits: CausalHit[], answer: string): SignalType | null {
  if (causalHits.length === 0) return null;
  const lower = answer.toLowerCase();

  // Check for opportunity signals
  const opportunityWords = ['want to', 'plan to', 'looking to', 'interested in', 'exploring', 'considering'];
  if (opportunityWords.some(w => lower.includes(w))) return 'opportunity';

  // Check for strength signals
  const strengthWords = ['already have', 'works well', 'effective', 'strong', 'successful', 'efficient'];
  if (strengthWords.some(w => lower.includes(w))) return 'strength';

  // Risk vs pain based on causal categories
  const riskCategories: CausalCategory[] = ['scalability_risk', 'data_integrity'];
  const isRisk = causalHits.some(h => riskCategories.includes(h.category));
  return isRisk ? 'risk' : 'pain';
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT: normalizeInput
// ════════════════════════════════════════════════════════════════════════════════

export interface NormalizerInput {
  answers: Record<number | string, string | number>;
  annotatedResponses: AnnotatedResponse[];
  company: string;
  industry: string;
  employeeEstimate: number;
}

export function normalizeInput(input: NormalizerInput): NormalizedDiagnostics {
  const { answers, annotatedResponses, company, industry, employeeEstimate } = input;

  // ── Per-answer normalization ──
  const normalizedAnswers: NormalizedAnswer[] = [];
  let totalWordCount = 0;
  let answeredCount = 0;

  for (const resp of annotatedResponses) {
    const answerText = String(resp.answer || '');
    const isEmpty = answerText.trim().length < 5;
    const wordCount = isEmpty ? 0 : answerText.split(/\s+/).filter(Boolean).length;

    // Causal classification
    const causalHits = classifyAnswerCausal(answerText);

    // Signal type
    const signalType = isEmpty ? null : classifyPrimarySignal(causalHits, answerText);

    // Maturity
    const maturityScore = isEmpty ? 1 : estimateMaturity(answerText, causalHits);

    normalizedAnswers.push({
      questionId: resp.questionId,
      questionText: resp.questionText,
      category: resp.category,
      answer: answerText,
      wordCount,
      causalCategories: causalHits,
      signalType,
      maturityScore,
      isEmpty,
    });

    totalWordCount += wordCount;
    if (!isEmpty) answeredCount++;
  }

  // ── Aggregate signal counts ──
  const signalsByType: Record<SignalType, number> = { pain: 0, opportunity: 0, risk: 0, strength: 0 };
  let totalSignals = 0;
  for (const a of normalizedAnswers) {
    if (a.signalType) {
      signalsByType[a.signalType]++;
      totalSignals++;
    }
  }

  // ── Domain pain counts ──
  const domainPainCounts: Record<DomainKey, number> = {
    operations: 0, revenue: 0, systems: 0,
    governance: 0, customer_experience: 0, data: 0,
  };

  for (const a of normalizedAnswers) {
    for (const hit of a.causalCategories) {
      const domain = causalToDomain[hit.category];
      if (domain) {
        domainPainCounts[domain] += hit.weight;
      }
    }
    // Customer experience: inferred from answer category keywords
    const catLower = a.category.toLowerCase();
    if (catLower.includes('customer') || catLower.includes('support') || catLower.includes('service')) {
      if (a.signalType === 'pain' || a.signalType === 'risk') {
        domainPainCounts.customer_experience += 2;
      }
    }
  }

  const totalQuestions = Object.keys(answers).length || annotatedResponses.length || 14;

  return {
    company,
    industry,
    employeeEstimate,
    answers: normalizedAnswers,
    totalSignals,
    signalsByType,
    domainPainCounts,
    answerCount: totalQuestions,
    answeredQuestions: answeredCount,
    avgWordCount: answeredCount > 0 ? Math.round(totalWordCount / answeredCount) : 0,
    completenessRatio: Math.min(1, answeredCount / Math.max(1, totalQuestions)),
  };
}

// ── Internal: classify a single answer text into causal categories ─────────

function classifyAnswerCausal(answerText: string): CausalHit[] {
  const lower = answerText.toLowerCase();
  const hits: CausalHit[] = [];

  for (const [cat, keywords] of Object.entries(CAUSAL_KEYWORDS) as [CausalCategory, string[]][]) {
    const matched = keywords.filter(kw => lower.includes(kw));
    if (matched.length > 0) {
      hits.push({ category: cat, weight: matched.length, matchedKeywords: matched });
    }
  }

  return hits;
}