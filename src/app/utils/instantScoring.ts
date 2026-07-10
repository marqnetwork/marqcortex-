/**
 * INSTANT CLIENT-SIDE SCORING ENGINE
 *
 * Analyzes the 14 open-ended diagnostic answers immediately after submission
 * to produce a readiness score, insights, bottleneck theme, and ROI estimate.
 *
 * This runs entirely in the browser -- no API call required.
 * When BACKEND_INTEGRATION is true a server-side AI analysis will
 * eventually replace / augment this, but the instant score gives
 * the user immediate value.
 */

// ── Pain / opportunity keyword dictionaries ──────────────────────────────────

const PAIN_KEYWORDS = [
  'manual', 'manually', 'spreadsheet', 'copy-paste', 'copy paste',
  'broken', 'break', 'breaking', 'collapse', 'overwhelmed', 'chaos',
  'chaotic', 'fire', 'firefighting', 'bottleneck', 'slow', 'delayed',
  'lost', 'duplicated', 'error', 'mistake', 'frustrated', 'frustrating',
  'worry', 'worried', 'concern', 'burnout', 'burn out', 'depend on me',
  'depends on me', 'approval', 'sign-off', 'sign off', 'waiting',
  'repetitive', 'tedious', 'hours', 'time-consuming', 'low-value',
  'outdated', 'legacy', 'fragmented', 'disconnected', 'silo',
  'no visibility', 'can\'t see', 'don\'t know', 'guesswork',
  'reactive', 'no process', 'undocumented', 'heads', 'tribal knowledge',
];

const AUTOMATION_KEYWORDS = [
  'automate', 'automation', 'ai', 'artificial intelligence', 'machine learning',
  'chatbot', 'integration', 'api', 'workflow', 'system', 'platform',
  'dashboard', 'real-time', 'realtime', 'self-service', 'self service',
  'notification', 'alert', 'trigger', 'template', 'rule',
];

const SCALE_KEYWORDS = [
  'scale', 'scaling', 'growth', 'grow', 'expand', 'hire', 'headcount',
  'volume', 'increase', 'double', 'triple', '2x', '3x', '10x',
  'capacity', 'bandwidth', 'team size',
];

const URGENCY_KEYWORDS = [
  'asap', 'urgent', 'immediately', 'critical', 'crisis', 'emergency',
  'losing', 'losing money', 'hemorrhaging', 'behind', 'falling behind',
  'competitors', 'churn', 'turnover', 'deadline', 'collapse',
  'can\'t sustain', 'unsustainable',
];

// ── Industry-specific calibration ────────────────────────────────────────────

interface IndustryCalibration {
  /** Extra keywords that count as pain for this industry */
  extraPainKeywords: string[];
  /** Extra keywords that count as automation-readiness for this industry */
  extraAutomationKeywords: string[];
  /** Weight modifiers (multiplier applied to raw dimension before clamping) */
  weights: {
    maturityBias: number;        // + or - added to maturity score
    automationBias: number;      // + or - added to automation score
    scaleBias: number;           // + or - added to scale score
    urgencyBias: number;         // + or - added to urgency score
  };
  /** Industry-specific ROI multiplier label */
  roiLabel: string;
  /** Industry-specific insight if detected */
  industryInsight: {
    title: string;
    detail: string;
    color: string;
  } | null;
}

const INDUSTRY_CALIBRATIONS: Record<string, IndustryCalibration> = {
  ecommerce: {
    extraPainKeywords: ['cart abandonment', 'abandoned cart', 'stockout', 'stock-out', 'oversell', 'returns', 'refund', 'shipping', 'fulfillment', '3pl', 'inventory'],
    extraAutomationKeywords: ['shopify', 'woocommerce', 'klaviyo', 'crm', 'segmentation', 'lifecycle', 'retention'],
    weights: { maturityBias: 0, automationBias: 5, scaleBias: -3, urgencyBias: 3 },
    roiLabel: 'revenue recovery',
    industryInsight: {
      title: 'E-commerce Revenue Recovery',
      detail: 'Cart abandonment and post-purchase leakage are the two fastest ROI wins for DTC brands. Most see 15-25% revenue uplift within 60 days of addressing these.',
      color: '#8B5CF6',
    },
  },
  saas: {
    extraPainKeywords: ['churn', 'onboarding', 'trial', 'activation', 'adoption', 'tickets', 'support tickets', 'NPS', 'CSAT', 'expansion revenue'],
    extraAutomationKeywords: ['product-led', 'PLG', 'self-serve', 'in-app', 'segment', 'amplitude', 'mixpanel', 'intercom', 'hubspot'],
    weights: { maturityBias: 5, automationBias: 8, scaleBias: 0, urgencyBias: -2 },
    roiLabel: 'net revenue retention',
    industryInsight: {
      title: 'SaaS Growth Efficiency',
      detail: 'For SaaS, reducing time-to-value during onboarding and automating expansion triggers typically has 3-5x the impact of adding new acquisition channels.',
      color: '#3B82F6',
    },
  },
  agency: {
    extraPainKeywords: ['scope creep', 'utilisation', 'utilization', 'billable', 'non-billable', 'client management', 'deliverables', 'revisions', 'project management', 'timesheets'],
    extraAutomationKeywords: ['SOPs', 'playbook', 'template', 'proposal generator', 'project management', 'asana', 'monday', 'clickup'],
    weights: { maturityBias: -3, automationBias: 0, scaleBias: -5, urgencyBias: 5 },
    roiLabel: 'billable hour recovery',
    industryInsight: {
      title: 'Agency Capacity Unlock',
      detail: 'The #1 lever for service businesses is reducing non-billable admin hours. Typical agencies reclaim 8-15 hours/week per person through process automation.',
      color: '#06D7F6',
    },
  },
  healthcare: {
    extraPainKeywords: ['no-show', 'no show', 'claim', 'claims', 'denied', 'denial', 'prior auth', 'prior authorization', 'EHR', 'HIPAA', 'compliance', 'billing', 'scheduling', 'wait time'],
    extraAutomationKeywords: ['patient portal', 'telehealth', 'EHR', 'EMR', 'practice management', 'revenue cycle', 'RCM'],
    weights: { maturityBias: -5, automationBias: -3, scaleBias: -5, urgencyBias: 8 },
    roiLabel: 'collections improvement',
    industryInsight: {
      title: 'Healthcare Operations Alert',
      detail: 'No-show reduction and revenue cycle automation are the fastest wins in healthcare. Most practices recover $3K-8K/month within 90 days of implementation.',
      color: '#FB923C',
    },
  },
  manufacturing: {
    extraPainKeywords: ['supply chain', 'lead time', 'quality control', 'downtime', 'maintenance', 'production', 'waste', 'scrap', 'defect', 'OEE', 'lean'],
    extraAutomationKeywords: ['IoT', 'sensors', 'predictive maintenance', 'ERP', 'MES', 'SCADA', 'real-time monitoring'],
    weights: { maturityBias: -5, automationBias: -5, scaleBias: 0, urgencyBias: 5 },
    roiLabel: 'waste/downtime reduction',
    industryInsight: {
      title: 'Manufacturing Efficiency Gap',
      detail: 'Supply chain visibility and predictive maintenance are the highest-impact entry points. Even basic process digitisation can reduce waste by 15-25%.',
      color: '#F59E0B',
    },
  },
  nonprofit: {
    extraPainKeywords: ['donor', 'grant', 'reporting', 'compliance', 'volunteer', 'fundraising', 'impact measurement', 'stakeholder'],
    extraAutomationKeywords: ['CRM', 'donor management', 'grant tracking', 'impact reporting', 'volunteer management'],
    weights: { maturityBias: -8, automationBias: -5, scaleBias: -3, urgencyBias: 3 },
    roiLabel: 'operational savings',
    industryInsight: {
      title: 'Non-Profit Impact Multiplier',
      detail: 'Automating grant reporting and donor stewardship lets small teams serve more beneficiaries without adding headcount — the ultimate force multiplier.',
      color: '#FD4438',
    },
  },
  creators: {
    extraPainKeywords: ['launch', 'content', 'course', 'cohort', 'community', 'membership', 'coaching', 'feedback', 'live', 'recording'],
    extraAutomationKeywords: ['funnel', 'email sequence', 'drip', 'onboarding', 'upsell', 'cross-sell', 'webinar', 'checkout'],
    weights: { maturityBias: -3, automationBias: 5, scaleBias: -8, urgencyBias: 0 },
    roiLabel: 'time-to-revenue',
    industryInsight: {
      title: 'Creator Scalability Path',
      detail: 'The transition from 1:1 to 1:many is the biggest leverage point. Automated delivery + smart segmentation can 3x revenue without increasing your hours.',
      color: '#10B981',
    },
  },
  government: {
    extraPainKeywords: ['citizen', 'constituent', 'mandate', 'regulation', 'procurement', 'audit', 'transparency', 'interagency', 'backlog'],
    extraAutomationKeywords: ['digital transformation', 'e-government', 'case management', 'citizen portal', 'self-service'],
    weights: { maturityBias: -10, automationBias: -8, scaleBias: 0, urgencyBias: 5 },
    roiLabel: 'efficiency gains',
    industryInsight: {
      title: 'Public Sector Modernisation',
      detail: 'Digital intake forms and automated case routing are the fastest wins. Most agencies see 30-50% reduction in processing time for routine requests.',
      color: '#6B7280',
    },
  },
  other: {
    extraPainKeywords: [],
    extraAutomationKeywords: [],
    weights: { maturityBias: 0, automationBias: 0, scaleBias: 0, urgencyBias: 0 },
    roiLabel: 'operational improvement',
    industryInsight: null,
  },
};

function getCalibration(industry: string): IndustryCalibration {
  return INDUSTRY_CALIBRATIONS[industry] || INDUSTRY_CALIBRATIONS['other'];
}

// ── Bottleneck theme categories ──────────────────────────────────────────────

interface BottleneckTheme {
  id: string;
  label: string;
  description: string;
  keywords: string[];
  color: string;
  icon: string; // emoji
}

const BOTTLENECK_THEMES: BottleneckTheme[] = [
  {
    id: 'founder-dependency',
    label: 'Founder / Key-Person Dependency',
    description: 'Too many decisions, approvals, and knowledge live with one person. Growth is capped by their bandwidth.',
    keywords: ['depend on me', 'depends on me', 'approval', 'sign-off', 'sign off', 'can\'t move', 'waiting for me', 'I have to', 'only I', 'bottleneck', 'one person'],
    color: '#8B5CF6',
    icon: '👤',
  },
  {
    id: 'manual-operations',
    label: 'Manual & Repetitive Operations',
    description: 'Core processes are manual, error-prone, and eat team hours that should go to strategic work.',
    keywords: ['manual', 'manually', 'spreadsheet', 'copy-paste', 'copy paste', 'repetitive', 'tedious', 'hours', 'data entry', 'error', 'mistake'],
    color: '#FB923C',
    icon: '🔧',
  },
  {
    id: 'data-fragmentation',
    label: 'Data & System Fragmentation',
    description: 'Information is siloed across disconnected tools. No single source of truth, leading to bad decisions.',
    keywords: ['disconnected', 'fragmented', 'silo', 'no visibility', 'can\'t see', 'don\'t know', 'guesswork', 'spreadsheet', 'multiple systems', 'different systems', 'lost', 'duplicated'],
    color: '#3B82F6',
    icon: '🔀',
  },
  {
    id: 'customer-experience',
    label: 'Customer Experience Gaps',
    description: 'Customer-facing processes are reactive, slow, or inconsistent -- driving churn and missed revenue.',
    keywords: ['customer', 'client', 'support', 'response time', 'churn', 'abandon', 'follow-up', 'follow up', 'retention', 'satisfaction', 'complaint', 'no-show'],
    color: '#06D7F6',
    icon: '💬',
  },
  {
    id: 'scaling-ceiling',
    label: 'Scaling Ceiling',
    description: 'Current processes break under higher volume. Growth requires linearly more people or hours.',
    keywords: ['scale', 'scaling', 'growth', 'break', 'collapse', 'volume', 'capacity', 'hire', 'headcount', 'overwhelmed', 'can\'t keep up'],
    color: '#FD4438',
    icon: '📈',
  },
];

// ── Scoring helpers ──────────────────────────────────────────────────────────

function countKeywordHits(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.reduce((count, kw) => count + (lower.includes(kw) ? 1 : 0), 0);
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ── Public types ─────────────────────────────────────────────────────────────

export interface InstantInsight {
  title: string;
  detail: string;
  category: string;
  severity: 'critical' | 'high' | 'medium';
  color: string;
}

export interface InstantScoreResult {
  readinessScore: number;          // 0-100
  readinessLevel: 'Low' | 'Medium' | 'High';
  insights: InstantInsight[];      // 3-5 personalised insights
  bottleneckTheme: {
    id: string;
    label: string;
    description: string;
    color: string;
    icon: string;
  };
  dimensions: {
    operationalMaturity: number;   // 0-100
    automationReadiness: number;   // 0-100
    scaleReadiness: number;        // 0-100
    urgencyLevel: number;          // 0-100
  };
  estimatedROI: {
    timeSavingsHoursPerWeek: string;
    costReductionPercent: string;
    revenueImpactPercent: string;
  };
  completionQuality: number;       // 0-100 (how thorough were the answers)
}

// ── Main scoring function ────────────────────────────────────────────────────

export function computeInstantScore(
  answers: Record<number, string | number>,
  industry: string,
): InstantScoreResult {
  const cal = getCalibration(industry);

  // Combine all textual answers into one blob for keyword analysis
  const allText = Object.values(answers)
    .filter((v): v is string => typeof v === 'string')
    .join(' ');

  const totalWords = wordCount(allText);

  // ── 1. Completion quality (0-100) ──────────────────────────────────────────
  // 14 questions: excellent = 80+ words avg, good = 40+, thin < 20
  const avgWords = totalWords / Math.max(Object.keys(answers).length, 1);
  const completionQuality = Math.min(100, Math.round((avgWords / 60) * 100));

  // ── 2. Pain / urgency signals (augmented by industry keywords) ─────────────
  const painHits = countKeywordHits(allText, [...PAIN_KEYWORDS, ...cal.extraPainKeywords]);
  const urgencyHits = countKeywordHits(allText, URGENCY_KEYWORDS);
  const automationHits = countKeywordHits(allText, [...AUTOMATION_KEYWORDS, ...cal.extraAutomationKeywords]);
  const scaleHits = countKeywordHits(allText, SCALE_KEYWORDS);

  // Normalize to 0-100 (calibrated for ~14 open-ended answers)
  const painScore = Math.min(100, Math.round((painHits / 14) * 100));
  const urgencyScore = Math.min(100, Math.round((urgencyHits / 5) * 100));
  const automationScore = Math.min(100, Math.round((automationHits / 8) * 100));
  const scaleScore = Math.min(100, Math.round((scaleHits / 5) * 100));

  // ── 3. Dimension scores (with industry calibration biases) ─────────────────
  // Operational maturity: inverse of pain (lots of pain = low maturity)
  const operationalMaturity = Math.max(15, Math.min(85,
    100 - painScore + Math.round(completionQuality * 0.15) + cal.weights.maturityBias
  ));
  // Automation readiness: combination of awareness + current tooling
  const automationReadiness = Math.max(20, Math.min(90,
    30 + automationScore + Math.round(completionQuality * 0.2) + cal.weights.automationBias
  ));
  // Scale readiness: inverse of scale-breakage signals
  const scaleReadiness = Math.max(15, Math.min(85,
    70 - Math.round(scaleScore * 0.5) + Math.round(automationScore * 0.3) + cal.weights.scaleBias
  ));
  const urgencyLevel = Math.max(20, Math.min(95,
    urgencyScore + Math.round(painScore * 0.4) + cal.weights.urgencyBias
  ));

  // ── 4. Overall readiness score ─────────────────────────────────────────────
  // Weighted blend: maturity 25%, automation 30%, scale 20%, inverse-urgency 10%, quality 15%
  const rawScore =
    operationalMaturity * 0.25 +
    automationReadiness * 0.30 +
    scaleReadiness * 0.20 +
    (100 - urgencyLevel) * 0.10 +
    completionQuality * 0.15;

  const readinessScore = Math.max(18, Math.min(92, Math.round(rawScore)));

  const readinessLevel: 'Low' | 'Medium' | 'High' =
    readinessScore >= 65 ? 'High' : readinessScore >= 40 ? 'Medium' : 'Low';

  // ── 5. Detect primary bottleneck theme ─────────────────────────────────────
  const themeScores = BOTTLENECK_THEMES.map((theme) => ({
    theme,
    score: countKeywordHits(allText, theme.keywords),
  }));
  themeScores.sort((a, b) => b.score - a.score);

  const primaryTheme = themeScores[0].theme;

  // ── 6. Generate personalised insights ──────────────────────────────────────
  const insights: InstantInsight[] = [];

  // Industry-specific insight (always first if available)
  if (cal.industryInsight) {
    insights.push({
      title: cal.industryInsight.title,
      detail: cal.industryInsight.detail,
      category: 'Industry',
      severity: 'high',
      color: cal.industryInsight.color,
    });
  }

  // Insight from Q3 (decisions/approvals depending on key person)
  const q3 = String(answers[3] || '');
  if (q3.length > 20) {
    const hasDependency = countKeywordHits(q3, ['approval', 'sign-off', 'depends on me', 'I have to', 'wait', 'bottleneck']) > 0;
    insights.push({
      title: hasDependency ? 'Key-Person Bottleneck Detected' : 'Decision Flow Analysis',
      detail: hasDependency
        ? 'Critical decisions still funnel through one person. This caps throughput and creates a single point of failure for growth.'
        : 'Your decision-making structure shows some delegation, but there may be room to empower the team further.',
      category: 'Governance',
      severity: hasDependency ? 'critical' : 'medium',
      color: '#8B5CF6',
    });
  }

  // Insight from Q8 (work humans do that shouldn't require human thinking)
  const q8 = String(answers[8] || '');
  if (q8.length > 20) {
    const automatable = countKeywordHits(q8, ['manual', 'copy', 'update', 'enter', 'entry', 'send', 'email', 'report']);
    insights.push({
      title: automatable > 2 ? 'High Automation Potential' : 'Automation Opportunities Identified',
      detail: automatable > 2
        ? 'Multiple tasks you described are strong candidates for immediate automation -- each one is leaking hours every week.'
        : 'There are clear tasks that could be automated or streamlined to free up strategic capacity.',
      category: 'Automation',
      severity: automatable > 2 ? 'high' : 'medium',
      color: '#06D7F6',
    });
  }

  // Insight from Q9 (where money is being lost)
  const q9 = String(answers[9] || '');
  if (q9.length > 20) {
    insights.push({
      title: 'Revenue Leakage Identified',
      detail: 'The areas you highlighted are common revenue drains. Addressing even one could recover significant margin within 90 days.',
      category: 'Revenue',
      severity: 'high',
      color: '#FB923C',
    });
  }

  // Insight from Q5 (what worries you most)
  const q5 = String(answers[5] || '');
  if (q5.length > 20) {
    insights.push({
      title: 'Growth Risk Flagged',
      detail: 'The concern you raised is a leading indicator we see in businesses right before a growth stall. The good news: it\'s addressable.',
      category: 'Risk',
      severity: 'high',
      color: '#FD4438',
    });
  }

  // Insight from Q13 (90-day success vision)
  const q13 = String(answers[13] || '');
  if (q13.length > 20) {
    insights.push({
      title: 'Clear Success Vision',
      detail: 'Your 90-day goals are specific and measurable -- that clarity is a strong predictor of successful transformation outcomes.',
      category: 'Strategy',
      severity: 'medium',
      color: '#3B82F6',
    });
  }

  // Fallback insights if answers were too thin
  if (insights.length < 3) {
    const fallbacks: InstantInsight[] = [
      {
        title: 'Process Maturity Assessment',
        detail: `Your overall operational maturity indicates ${operationalMaturity > 55 ? 'a solid foundation to build on' : 'significant room for systematisation and optimisation'}.`,
        category: 'Operations',
        severity: operationalMaturity > 55 ? 'medium' : 'high',
        color: '#8B5CF6',
      },
      {
        title: 'AI & Automation Readiness',
        detail: `Based on your responses, your ${industry || 'business'} shows ${automationReadiness > 55 ? 'strong readiness' : 'emerging readiness'} for AI-assisted workflows.`,
        category: 'Technology',
        severity: 'medium',
        color: '#06D7F6',
      },
      {
        title: 'Scale Preparedness',
        detail: `${scaleReadiness > 55 ? 'Your operations appear reasonably prepared for growth.' : 'Key processes may break under increased volume -- proactive investment is recommended.'}`,
        category: 'Growth',
        severity: scaleReadiness > 55 ? 'medium' : 'high',
        color: '#3B82F6',
      },
    ];
    for (const fb of fallbacks) {
      if (insights.length >= 5) break;
      if (!insights.some((i) => i.category === fb.category)) insights.push(fb);
    }
  }

  // Cap at 5
  const finalInsights = insights.slice(0, 5);

  // ── 7. ROI estimates (conservative, calibrated per industry) ────────────────
  const timeSavings = painScore > 60 ? '12-20' : painScore > 35 ? '6-12' : '3-6';
  const costReduction = painScore > 60 ? '25-40%' : painScore > 35 ? '15-25%' : '8-15%';
  const revenueImpact = urgencyScore > 50 ? '15-30%' : urgencyScore > 25 ? '10-20%' : '5-12%';

  return {
    readinessScore,
    readinessLevel,
    insights: finalInsights,
    bottleneckTheme: {
      id: primaryTheme.id,
      label: primaryTheme.label,
      description: primaryTheme.description,
      color: primaryTheme.color,
      icon: primaryTheme.icon,
    },
    dimensions: {
      operationalMaturity,
      automationReadiness,
      scaleReadiness,
      urgencyLevel,
    },
    estimatedROI: {
      timeSavingsHoursPerWeek: timeSavings,
      costReductionPercent: costReduction,
      revenueImpactPercent: revenueImpact,
    },
    completionQuality,
  };
}