/**
 * CORTEX CORE — MODULE 3: DECISION ENGINE
 *
 * Picks primary sprint. Calculates confidence.
 * Handles tie logic + hybrid mode.
 *
 * CRITICAL RULE: Math decides priority. Never LLM.
 *
 * Decision algorithm:
 *   1. Rank domains by rawScore DESC
 *   2. If gap between #1 and #2 < 10% → hybrid mode
 *   3. Map winning domain → sprint template
 *   4. Calculate confidence from data quality + score gap + signal density
 *   5. Generate "why not others" explanations (deterministic templates)
 */

import type {
  NormalizedDiagnostics,
  DomainScores,
  DomainKey,
  DecisionOutput,
  SprintTemplateId,
} from './types';
import {
  DOMAIN_TO_SPRINT,
  DOMAIN_LABELS,
  CORE_PROBLEM_LABELS,
} from './types';

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT: makeDecision
// ═══════════════════════════════════════════════════════════════════════════════

export function makeDecision(
  scores: DomainScores,
  diagnostics: NormalizedDiagnostics,
): DecisionOutput {
  // ── 1. Rank domains ──
  const ranked = (Object.values(scores) as DomainScores[keyof DomainScores][])
    .sort((a, b) => b.rawScore - a.rawScore)
    .map(d => ({ domain: d.key, score: d.rawScore }));

  const top = ranked[0];
  const second = ranked[1];

  // ── 2. Tie / hybrid detection ──
  const gap = top.score - (second?.score || 0);
  const gapPercent = top.score > 0 ? (gap / top.score) * 100 : 100;
  const isHybrid = gapPercent < 10 && top.score > 0;

  // ── 3. Map to sprint ──
  const selectedDomain = top.domain;
  const sprintTemplateId = DOMAIN_TO_SPRINT[selectedDomain];
  const selectedCoreProblem = CORE_PROBLEM_LABELS[selectedDomain];

  // ── 4. Confidence calculation ──
  const confidenceScore = calculateConfidence(diagnostics, gap, top.score);

  // ── 5. Why not others ──
  const whyNotOthers = ranked.slice(1, 4).map(r => ({
    domain: DOMAIN_LABELS[r.domain],
    reason: generateWhyNot(r.domain, selectedDomain, r.score, top.score),
  }));

  // ── 6. Decision reasoning (deterministic, not LLM) ──
  const decisionReasoning = buildDecisionReasoning(
    selectedDomain, top.score, second?.domain, second?.score || 0, isHybrid, diagnostics,
  );

  return {
    selectedCoreProblem,
    selectedCoreProblemDomain: selectedDomain,
    sprintTemplateId,
    confidenceScore,
    isHybrid,
    hybridSecondary: isHybrid ? second?.domain : undefined,
    rankedDomains: ranked,
    decisionReasoning,
    whyNotOthers,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIDENCE CALCULATOR
// ═══════════════════════════════════════════════════════════════════════════════

function calculateConfidence(
  diagnostics: NormalizedDiagnostics,
  scoreGap: number,
  topScore: number,
): number {
  // Component 1: Data completeness (30%)
  const completeness = diagnostics.completenessRatio;

  // Component 2: Answer quality — avg word count (20%)
  const qualityRatio = Math.min(1, diagnostics.avgWordCount / 60); // 60 words = "full" quality

  // Component 3: Score gap clarity (30%)
  // Larger gap = higher confidence in the decision
  const gapClarity = topScore > 0 ? Math.min(1, scoreGap / 30) : 0; // 30pt gap = max confidence

  // Component 4: Signal density (20%)
  // More signals detected = more data to base decision on
  const signalDensity = Math.min(1, diagnostics.totalSignals / 12); // 12 signals = saturated

  const raw = (completeness * 0.30) + (qualityRatio * 0.20) + (gapClarity * 0.30) + (signalDensity * 0.20);

  // Clamp to reasonable range [0.3, 0.98]
  return Math.max(0.30, Math.min(0.98, parseFloat(raw.toFixed(2))));
}

// ═══════════════════════════════════════════════════════════════════════════════
// WHY-NOT TEMPLATES (deterministic)
// ═══════════════════════════════════════════════════════════════════════════════

function generateWhyNot(domain: DomainKey, winner: DomainKey, score: number, topScore: number): string {
  const delta = topScore - score;
  const label = DOMAIN_LABELS[domain];
  const winnerLabel = DOMAIN_LABELS[winner];

  if (delta > 30) {
    return `${label} scored ${delta} points below ${winnerLabel}. Addressing ${winnerLabel.toLowerCase()} first will likely improve ${label.toLowerCase()} as a downstream effect.`;
  }
  if (delta > 15) {
    return `${label} is a secondary concern (score: ${score}/100). Fixing ${winnerLabel.toLowerCase()} creates the capacity and infrastructure to address ${label.toLowerCase()} effectively in Phase 2.`;
  }
  return `${label} (score: ${score}/100) is close to the primary problem but sequencing matters. Solving ${winnerLabel.toLowerCase()} first avoids parallel complexity and compounds the fix.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DECISION REASONING (deterministic narrative)
// ═══════════════════════════════════════════════════════════════════════════════

function buildDecisionReasoning(
  domain: DomainKey,
  topScore: number,
  secondDomain: DomainKey | undefined,
  secondScore: number,
  isHybrid: boolean,
  diagnostics: NormalizedDiagnostics,
): string {
  const label = CORE_PROBLEM_LABELS[domain];
  const domainLabel = DOMAIN_LABELS[domain];
  const painCount = diagnostics.domainPainCounts[domain];

  let base = `${domainLabel} scored highest at ${topScore}/100 with ${painCount} pain signals detected across ${diagnostics.answeredQuestions} analyzed responses.`;

  if (isHybrid && secondDomain) {
    const secondLabel = DOMAIN_LABELS[secondDomain];
    base += ` Note: ${secondLabel} scored very close (${secondScore}/100), indicating a hybrid problem space. The recommended sprint addresses both domains.`;
  }

  base += ` Primary core problem identified: "${label}".`;
  base += ` Confidence is based on ${diagnostics.completenessRatio >= 0.8 ? 'high' : diagnostics.completenessRatio >= 0.5 ? 'moderate' : 'limited'} data completeness (${Math.round(diagnostics.completenessRatio * 100)}%).`;

  return base;
}
