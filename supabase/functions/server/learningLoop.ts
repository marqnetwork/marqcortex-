/**
 * LEARNING LOOP — deterministic outcome aggregation (recommendation-engine-guide.md)
 *
 * Powers GET /cortex/learning-loop and LearningLoopPanel. Reads persisted
 * `outcome:*` records and aggregates them into win/loss intelligence:
 * conversion rate, score↔conversion correlation, lost-reason keyword tally,
 * per-industry breakdown, improvement-area frequency, recency, cycle time.
 *
 * GOVERNANCE:
 *   Fully deterministic. No LLM. This is a READ-ONLY insight view — it never
 *   self-modifies scoring rules, prompts, or business logic, and it never
 *   fabricates data (empty input → isEmpty:true). Any human action on these
 *   insights happens elsewhere, explicitly. Pure module (no Deno/KV) so it is
 *   unit-testable under the Node runner.
 */

export interface LearningOutcome {
  submissionId?:        string;
  company?:             string;
  industry?:            string;
  didConvert?:          boolean;
  conversionValue?:     number | null;
  recommendationWorked?: boolean | null;
  recommendedService?:  string;
  aiScore?:             number;
  lostReason?:          string;
  improvementAreas?:    string[];
  submittedAt?:         string;
  loggedAt?:            string;
  [k: string]: unknown;
}

export interface ScoreBucket {
  range:     string;
  total:     number;
  converted: number;
  rate:      number | null;
}

export interface LearningLoopData {
  totalOutcomes:         number;
  totalConverted:        number;
  totalLost:             number;
  conversionRate:        number;
  totalRevenue:          number;
  avgDealSize:           number;
  recommendationAccuracy: number | null;
  byIndustry: Array<{ industry: string; total: number; converted: number; conversionRate: number; avgDealSize: number }>;
  scoreCorrelation: { highScore: ScoreBucket; midScore: ScoreBucket; lowScore: ScoreBucket };
  topLostReasons: Array<{ reason: string; count: number }>;
  recentOutcomes: Array<Record<string, unknown>>;
  improvementAreas: Array<{ area: string; count: number }>;
  avgDaysToClose: number | null;
}

const REASON_KEYWORDS = ['budget', 'timing', 'competitor', 'wrong fit', 'no decision', 'price', 'scope', 'size'];

/**
 * Deterministically aggregate persisted outcomes. Returns `{ isEmpty: true,
 * data: null }` for an empty set rather than fabricating placeholder metrics.
 */
export function aggregateLearningLoop(
  outcomes: LearningOutcome[],
): { isEmpty: boolean; data: LearningLoopData | null } {
  if (!Array.isArray(outcomes) || outcomes.length === 0) {
    return { isEmpty: true, data: null };
  }

  const converted = outcomes.filter(o => o.didConvert);
  const lost = outcomes.filter(o => !o.didConvert);
  const total = outcomes.length;

  const conversionRate = Math.round((converted.length / total) * 100);
  const totalRevenue = converted.reduce((sum, o) => sum + (o.conversionValue || 0), 0);
  const avgDealSize = converted.length > 0 ? Math.round(totalRevenue / converted.length) : 0;

  const recRated = outcomes.filter(o => o.recommendationWorked !== null && o.recommendationWorked !== undefined);
  const recWorked = recRated.filter(o => o.recommendationWorked === true);
  const recommendationAccuracy = recRated.length > 0 ? Math.round((recWorked.length / recRated.length) * 100) : null;

  const industryMap: Record<string, { total: number; converted: number; revenue: number }> = {};
  for (const o of outcomes) {
    const ind = o.industry || 'Unknown';
    if (!industryMap[ind]) industryMap[ind] = { total: 0, converted: 0, revenue: 0 };
    industryMap[ind].total++;
    if (o.didConvert) {
      industryMap[ind].converted++;
      industryMap[ind].revenue += (o.conversionValue || 0);
    }
  }
  const byIndustry = Object.entries(industryMap)
    .map(([industry, d]) => ({
      industry, total: d.total, converted: d.converted,
      conversionRate: Math.round((d.converted / d.total) * 100),
      avgDealSize: d.converted > 0 ? Math.round(d.revenue / d.converted) : 0,
    }))
    .sort((a, b) => b.conversionRate - a.conversionRate);

  const toRate = (arr: LearningOutcome[]) =>
    arr.length > 0 ? Math.round((arr.filter(o => o.didConvert).length / arr.length) * 100) : null;
  const highScoreArr = outcomes.filter(o => (o.aiScore ?? 0) >= 80);
  const midScoreArr  = outcomes.filter(o => (o.aiScore ?? 0) >= 60 && (o.aiScore ?? 0) < 80);
  const lowScoreArr  = outcomes.filter(o => (o.aiScore ?? 0) < 60);
  const scoreCorrelation = {
    highScore: { range: '80+',   total: highScoreArr.length, converted: highScoreArr.filter(o => o.didConvert).length, rate: toRate(highScoreArr) },
    midScore:  { range: '60–79', total: midScoreArr.length,  converted: midScoreArr.filter(o => o.didConvert).length,  rate: toRate(midScoreArr) },
    lowScore:  { range: '<60',   total: lowScoreArr.length,  converted: lowScoreArr.filter(o => o.didConvert).length,  rate: toRate(lowScoreArr) },
  };

  const reasonMap: Record<string, number> = {};
  for (const o of lost) {
    const text = (o.lostReason || '').toLowerCase();
    let matched = false;
    for (const kw of REASON_KEYWORDS) {
      if (text.includes(kw)) { reasonMap[kw] = (reasonMap[kw] || 0) + 1; matched = true; break; }
    }
    if (!matched && o.lostReason) reasonMap['other'] = (reasonMap['other'] || 0) + 1;
  }
  const topLostReasons = Object.entries(reasonMap)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count).slice(0, 6);

  const allAreas: string[] = [];
  for (const o of outcomes) {
    if (Array.isArray(o.improvementAreas)) allAreas.push(...o.improvementAreas);
  }
  const areaMap: Record<string, number> = {};
  for (const area of allAreas) areaMap[area] = (areaMap[area] || 0) + 1;
  const improvementAreas = Object.entries(areaMap)
    .map(([area, count]) => ({ area, count }))
    .sort((a, b) => b.count - a.count);

  const recentOutcomes = [...outcomes]
    .sort((a, b) => new Date(b.loggedAt ?? 0).getTime() - new Date(a.loggedAt ?? 0).getTime())
    .slice(0, 10)
    .map(o => ({
      submissionId: o.submissionId, company: o.company, industry: o.industry,
      didConvert: o.didConvert, conversionValue: o.conversionValue,
      recommendedService: o.recommendedService, recommendationWorked: o.recommendationWorked,
      aiScore: o.aiScore, loggedAt: o.loggedAt,
    }));

  let totalDays = 0; let daysCount = 0;
  for (const o of outcomes) {
    if (o.submittedAt && o.loggedAt) {
      const days = (new Date(o.loggedAt).getTime() - new Date(o.submittedAt).getTime()) / 86_400_000;
      if (days >= 0) { totalDays += days; daysCount++; }
    }
  }
  const avgDaysToClose = daysCount > 0 ? Math.round(totalDays / daysCount) : null;

  return {
    isEmpty: false,
    data: {
      totalOutcomes: total, totalConverted: converted.length, totalLost: lost.length,
      conversionRate, totalRevenue, avgDealSize, recommendationAccuracy,
      byIndustry, scoreCorrelation, topLostReasons, recentOutcomes, improvementAreas, avgDaysToClose,
    },
  };
}
