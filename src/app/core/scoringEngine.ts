/**
 * CORTEX CORE — MODULE 2: SCORING ENGINE
 *
 * Applies weighted formula to normalized diagnostics.
 * Returns severity scores per domain. Deterministic only.
 *
 * Scoring formula per domain:
 *   rawScore = (painWeight * 40) + (causalWeight * 30) + (maturityPenalty * 20) + (crossDeptBonus * 10)
 *   Clamped to 0-100.
 *
 * RULE: Same input → same scores. No randomness. No LLM.
 */

import type {
  NormalizedDiagnostics,
  DomainScores,
  DomainScore,
  DomainKey,
  CausalCategory,
} from './types';
import { CAUSAL_TO_DOMAIN, DOMAIN_LABELS } from './types';

// ── Severity thresholds ──────────────────────────────────────────────────────

function scoreSeverity(score: number): DomainScore['severity'] {
  if (score >= 75) return 'Critical';
  if (score >= 50) return 'High';
  if (score >= 25) return 'Moderate';
  return 'Low';
}

// ── Domain weights (industry-agnostic base) ──────────────────────────────────
// Each domain gets a base sensitivity multiplier. Industries can adjust later.

const DOMAIN_SENSITIVITY: Record<DomainKey, number> = {
  operations: 1.0,
  revenue: 1.1,        // Revenue problems always high-priority
  systems: 0.9,
  governance: 1.0,
  customer_experience: 1.05,
  data: 0.85,
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT: scoreDomains
// ═══════════════════════════════════════════════════════════════════════════════

export function scoreDomains(diagnostics: NormalizedDiagnostics): DomainScores {
  const domains: DomainKey[] = ['operations', 'revenue', 'systems', 'governance', 'customer_experience', 'data'];
  const result: Partial<DomainScores> = {};

  // Pre-compute per-domain causal weight and contributing questions
  const domainCausal: Record<DomainKey, { totalWeight: number; questions: Set<number>; categories: Set<CausalCategory> }> = {} as any;
  for (const d of domains) {
    domainCausal[d] = { totalWeight: 0, questions: new Set(), categories: new Set() };
  }

  for (const answer of diagnostics.answers) {
    for (const hit of answer.causalCategories) {
      const domain = CAUSAL_TO_DOMAIN[hit.category];
      if (domain && domainCausal[domain]) {
        domainCausal[domain].totalWeight += hit.weight;
        domainCausal[domain].questions.add(answer.questionId);
        domainCausal[domain].categories.add(hit.category);
      }
    }
  }

  // Pre-compute cross-department presence per domain
  const categoryToDepts = new Map<DomainKey, Set<string>>();
  for (const d of domains) categoryToDepts.set(d, new Set());

  for (const answer of diagnostics.answers) {
    for (const hit of answer.causalCategories) {
      const domain = CAUSAL_TO_DOMAIN[hit.category];
      if (domain) {
        categoryToDepts.get(domain)?.add(answer.category);
      }
    }
  }

  // ── Score each domain ──
  for (const domain of domains) {
    const painCount = diagnostics.domainPainCounts[domain] || 0;
    const causalWeight = domainCausal[domain].totalWeight;
    const questions = domainCausal[domain].questions;
    const depts = categoryToDepts.get(domain) || new Set();
    const sensitivity = DOMAIN_SENSITIVITY[domain];

    // Component 1: Pain signal density (40% weight)
    const maxPain = 20; // theoretical max pain signals per domain
    const painComponent = Math.min(100, (painCount / maxPain) * 100) * 0.40;

    // Component 2: Causal keyword density (30% weight)
    const maxCausal = 15;
    const causalComponent = Math.min(100, (causalWeight / maxCausal) * 100) * 0.30;

    // Component 3: Maturity penalty (20% weight)
    // Low average maturity in relevant questions = higher score (worse)
    const relevantAnswers = diagnostics.answers.filter(a =>
      a.causalCategories.some(h => CAUSAL_TO_DOMAIN[h.category] === domain)
    );
    const avgMaturity = relevantAnswers.length > 0
      ? relevantAnswers.reduce((s, a) => s + a.maturityScore, 0) / relevantAnswers.length
      : 3; // default neutral
    const maturityPenalty = Math.max(0, (5 - avgMaturity) / 4) * 100 * 0.20; // invert: low maturity = high penalty

    // Component 4: Cross-department presence bonus (10% weight)
    const crossDeptBonus = depts.size >= 3 ? 100 * 0.10 : depts.size >= 2 ? 60 * 0.10 : 0;

    // Final score with sensitivity
    const rawScore = Math.min(100, Math.round(
      (painComponent + causalComponent + maturityPenalty + crossDeptBonus) * sensitivity
    ));

    result[domain] = {
      key: domain,
      label: DOMAIN_LABELS[domain],
      rawScore,
      severity: scoreSeverity(rawScore),
      painSignalCount: painCount,
      topCausalCategories: Array.from(domainCausal[domain].categories),
      contributingQuestions: Array.from(questions),
    };
  }

  return result as DomainScores;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INDUSTRY ADJUSTMENT (optional override for industry-specific tuning)
// ═══════════════════════════════════════════════════════════════════════════════

export function applyIndustryAdjustment(scores: DomainScores, industry: string): DomainScores {
  const lower = industry.toLowerCase();
  const adjusted = { ...scores };

  // E-commerce: customer experience and revenue are amplified
  if (lower.includes('commerce') || lower.includes('dtc') || lower.includes('retail')) {
    adjusted.customer_experience = bump(adjusted.customer_experience, 1.15);
    adjusted.revenue = bump(adjusted.revenue, 1.10);
  }

  // SaaS: systems and data are amplified
  if (lower.includes('saas') || lower.includes('software')) {
    adjusted.systems = bump(adjusted.systems, 1.15);
    adjusted.data = bump(adjusted.data, 1.10);
  }

  // Agency: governance is amplified
  if (lower.includes('agency') || lower.includes('service')) {
    adjusted.governance = bump(adjusted.governance, 1.15);
  }

  // Healthcare: data and governance are amplified
  if (lower.includes('health') || lower.includes('medical')) {
    adjusted.data = bump(adjusted.data, 1.15);
    adjusted.governance = bump(adjusted.governance, 1.10);
  }

  // Manufacturing: operations is amplified
  if (lower.includes('manufactur') || lower.includes('supply chain') || lower.includes('industrial')) {
    adjusted.operations = bump(adjusted.operations, 1.15);
  }

  return adjusted;
}

function bump(score: DomainScore, multiplier: number): DomainScore {
  const newRaw = Math.min(100, Math.round(score.rawScore * multiplier));
  return {
    ...score,
    rawScore: newRaw,
    severity: scoreSeverity(newRaw),
  };
}
