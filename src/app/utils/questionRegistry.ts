/**
 * QUESTION REGISTRY
 *
 * Centralized registry mapping industryId -> questionId -> full question metadata.
 * Used by cortexDataGenerator, QATranscriptSheet, and client report generator
 * to resolve raw submission answers (Record<number, string>) back to the actual
 * questions that were asked, their categories, and signal-detection keywords.
 *
 * Signal detection keywords per question tell the analysis engine what patterns
 * in a given answer indicate pain, opportunity, risk, or strength.
 */

import { ecommerceQuestions, saasQuestions, agencyQuestions, healthcareQuestions, creatorsQuestions, nonprofitQuestions, governmentQuestions } from '@/app/components/DiagnosticForm';
import { industrialQuestions } from '@/app/components/IndustrialQuestions';
import { universalQuestions } from '@/app/components/UniversalQuestions';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QuestionDef {
  id: number;
  category: string;
  question: string;
  type: string;
  placeholder: string;
  motivationalQuote: string;
  exampleAnswers: string[];
  backgroundTheme: string;
}

export type SignalType = 'pain' | 'opportunity' | 'risk' | 'strength';

export interface SignalKeyword {
  keywords: string[];
  signal: SignalType;
  label: string;
}

export interface AnnotatedSignal {
  type: SignalType;
  label: string;
  confidence: 'high' | 'medium' | 'low';
  matchedKeywords: string[];
}

export interface AnnotatedResponse {
  questionId: number;
  questionText: string;
  category: string;
  answer: string;
  detectedSignals: AnnotatedSignal[];
  linkedBottlenecks: string[];
  maturityIndicator: 1 | 2 | 3 | 4 | 5;
}

// ── Industry → Questions map ──────────────────────────────────────────────────

const INDUSTRY_QUESTIONS: Record<string, QuestionDef[]> = {
  ecommerce: ecommerceQuestions as QuestionDef[],
  saas: saasQuestions as QuestionDef[],
  agency: agencyQuestions as QuestionDef[],
  healthcare: healthcareQuestions as QuestionDef[],
  creators: creatorsQuestions as QuestionDef[],
  nonprofit: nonprofitQuestions as QuestionDef[],
  government: governmentQuestions as QuestionDef[],
  manufacturing: industrialQuestions as QuestionDef[],
  other: universalQuestions as QuestionDef[],
};

// Aliases — the industry field from submissions may use display names
const INDUSTRY_ALIASES: Record<string, string> = {
  'E-commerce / DTC': 'ecommerce',
  'E-commerce': 'ecommerce',
  'ecommerce': 'ecommerce',
  'SaaS / Software': 'saas',
  'SaaS': 'saas',
  'saas': 'saas',
  'Agency / Services': 'agency',
  'agency': 'agency',
  'Healthcare / Medical': 'healthcare',
  'healthcare': 'healthcare',
  'Non-Profit / Education': 'nonprofit',
  'nonprofit': 'nonprofit',
  'Creators / Training / Courses': 'creators',
  'creators': 'creators',
  'Government / Public Sector': 'government',
  'government': 'government',
  'Manufacturing / Supply Chain': 'manufacturing',
  'manufacturing': 'manufacturing',
  'Other Business / General': 'other',
  'other': 'other',
};

/**
 * Resolve an industry string (id or display name) to its canonical key.
 */
export function resolveIndustryKey(industry: string): string {
  // Direct match
  if (INDUSTRY_QUESTIONS[industry]) return industry;
  // Alias match
  const alias = INDUSTRY_ALIASES[industry];
  if (alias) return alias;
  // Fuzzy match: check if any alias key is contained in the string
  for (const [key, val] of Object.entries(INDUSTRY_ALIASES)) {
    if (industry.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return 'other';
}

/**
 * Get the question set for a given industry.
 */
export function getQuestionsForIndustry(industry: string): QuestionDef[] {
  const key = resolveIndustryKey(industry);
  return INDUSTRY_QUESTIONS[key] || INDUSTRY_QUESTIONS['other'];
}

/**
 * Look up a single question by industry + question ID.
 */
export function getQuestion(industry: string, questionId: number): QuestionDef | undefined {
  const questions = getQuestionsForIndustry(industry);
  return questions.find(q => q.id === questionId);
}

// ── Signal Detection ──────────────────────────────────────────────────────────

/**
 * Universal signal keywords that apply across all industries.
 * Each entry defines a set of keywords, the signal type, and a human-readable label.
 */
const UNIVERSAL_SIGNALS: SignalKeyword[] = [
  // Pain signals
  { keywords: ['manual', 'manually', 'by hand', 'copy-paste', 'copy paste'], signal: 'pain', label: 'Manual Process Dependency' },
  { keywords: ['bottleneck', 'bottlenecked', 'blocked', 'waiting for', 'depends on me', 'depends on one'], signal: 'pain', label: 'Bottleneck / Single Point of Failure' },
  { keywords: ['spreadsheet', 'excel', 'google sheets', 'csv'], signal: 'pain', label: 'Spreadsheet-Based Operations' },
  { keywords: ['chaos', 'chaotic', 'overwhelmed', 'firefighting', 'fire-fighting', 'putting out fires'], signal: 'pain', label: 'Operational Chaos' },
  { keywords: ['burnout', 'burn out', 'exhausted', 'overworked', '80-hour', 'nights and weekends'], signal: 'pain', label: 'Team Burnout Risk' },
  { keywords: ['slow', 'delayed', 'delays', 'takes too long', 'time-consuming'], signal: 'pain', label: 'Process Delays' },
  { keywords: ['error', 'errors', 'mistake', 'mistakes', 'wrong', 'incorrect', 'rework'], signal: 'pain', label: 'Error-Prone Process' },
  { keywords: ['lost', 'losing', 'miss', 'missed', 'fall through', 'falls through', 'slip through'], signal: 'pain', label: 'Information / Revenue Leakage' },
  { keywords: ['silo', 'siloed', 'disconnected', 'fragmented', 'scattered', 'no visibility'], signal: 'pain', label: 'Data Silos / Fragmentation' },
  { keywords: ['approval', 'sign-off', 'sign off', 'my approval', 'founder', 'can\'t move without'], signal: 'pain', label: 'Approval Bottleneck' },
  { keywords: ['repetitive', 'same thing', 'over and over', 'again and again', 'every time'], signal: 'pain', label: 'Repetitive Task Burden' },
  { keywords: ['no process', 'no system', 'no documentation', 'undocumented', 'tribal knowledge', 'in their heads'], signal: 'pain', label: 'Undocumented Processes' },

  // Risk signals
  { keywords: ['compliance', 'hipaa', 'gdpr', 'regulation', 'audit', 'legal risk'], signal: 'risk', label: 'Compliance / Regulatory Risk' },
  { keywords: ['churn', 'losing customers', 'customers leave', 'cancel', 'cancellation'], signal: 'risk', label: 'Customer Churn Risk' },
  { keywords: ['break', 'collapse', 'crash', 'fail', 'unsustainable', 'can\'t sustain'], signal: 'risk', label: 'Scale-Breaking Risk' },
  { keywords: ['competitor', 'competitors', 'falling behind', 'market share'], signal: 'risk', label: 'Competitive Threat' },
  { keywords: ['turnover', 'quit', 'leaving', 'retention', 'can\'t hire', 'hard to hire'], signal: 'risk', label: 'Talent Retention Risk' },

  // Opportunity signals
  { keywords: ['automate', 'automation', 'automated', 'ai', 'artificial intelligence', 'chatbot'], signal: 'opportunity', label: 'Automation Opportunity' },
  { keywords: ['integrate', 'integration', 'connect', 'api', 'sync', 'unified'], signal: 'opportunity', label: 'System Integration Opportunity' },
  { keywords: ['dashboard', 'real-time', 'visibility', 'tracking', 'analytics', 'data-driven'], signal: 'opportunity', label: 'Data Visibility Opportunity' },
  { keywords: ['self-service', 'self service', 'portal', 'knowledge base', 'faq'], signal: 'opportunity', label: 'Self-Service Opportunity' },
  { keywords: ['template', 'standardize', 'playbook', 'sop', 'documentation'], signal: 'opportunity', label: 'Process Standardization' },
  { keywords: ['scale', 'scaling', 'growth', 'grow', 'expand', '2x', '3x', '10x', 'double', 'triple'], signal: 'opportunity', label: 'Scale Readiness' },

  // Strength signals
  { keywords: ['documented', 'playbook', 'sop', 'well-organized', 'systematic'], signal: 'strength', label: 'Documented Processes' },
  { keywords: ['strong team', 'great team', 'talented', 'experienced', 'skilled'], signal: 'strength', label: 'Strong Team Foundation' },
  { keywords: ['profitable', 'healthy margins', 'good revenue', 'growing revenue'], signal: 'strength', label: 'Financial Health' },
  { keywords: ['loyal customers', 'repeat', 'retention', 'referrals', 'word of mouth'], signal: 'strength', label: 'Customer Loyalty' },
  { keywords: ['ready', 'open to change', 'nothing stopping', 'let\'s go', 'ready to move'], signal: 'strength', label: 'Change Readiness' },
];

// ── Industry-Specific Signal Dictionaries ─────────────────────────────────────

const INDUSTRY_SIGNALS: Record<string, SignalKeyword[]> = {
  ecommerce: [
    { keywords: ['cart abandonment', 'abandoned cart', 'checkout drop'], signal: 'pain', label: 'Cart Abandonment Problem' },
    { keywords: ['returns', 'refund', 'refunds', 'return rate'], signal: 'pain', label: 'High Return Rate' },
    { keywords: ['inventory sync', 'oversell', 'stockout', 'out of stock', 'stock-out'], signal: 'pain', label: 'Inventory Sync Failure' },
    { keywords: ['multi-channel', 'omnichannel', 'marketplace', 'amazon', 'shopify'], signal: 'opportunity', label: 'Multi-Channel Expansion' },
    { keywords: ['ltv', 'lifetime value', 'repeat purchase', 'retention'], signal: 'opportunity', label: 'LTV Optimization' },
    { keywords: ['fulfillment', 'shipping', '3pl', 'warehouse'], signal: 'risk', label: 'Fulfillment Bottleneck' },
  ],
  saas: [
    { keywords: ['onboarding', 'time to value', 'activation', 'first value'], signal: 'pain', label: 'Onboarding Friction' },
    { keywords: ['churn', 'cancellation', 'downgrade', 'lost customer'], signal: 'pain', label: 'Churn Problem' },
    { keywords: ['mrr', 'arr', 'recurring revenue', 'monthly recurring'], signal: 'opportunity', label: 'MRR/ARR Growth Lever' },
    { keywords: ['self-serve', 'product-led', 'plg', 'freemium', 'trial'], signal: 'opportunity', label: 'Product-Led Growth' },
    { keywords: ['feature request', 'backlog', 'roadmap', 'prioritization'], signal: 'risk', label: 'Product Roadmap Overload' },
    { keywords: ['uptime', 'sla', 'downtime', 'incident', 'outage'], signal: 'risk', label: 'Reliability / SLA Risk' },
  ],
  agency: [
    { keywords: ['scope creep', 'out of scope', 'scope change', 'change order'], signal: 'pain', label: 'Scope Creep' },
    { keywords: ['utilization', 'billable', 'bench', 'underutilized'], signal: 'pain', label: 'Utilization Gap' },
    { keywords: ['client reporting', 'status update', 'weekly report'], signal: 'opportunity', label: 'Automated Client Reporting' },
    { keywords: ['retainer', 'recurring', 'monthly contract'], signal: 'opportunity', label: 'Retainer Revenue Model' },
    { keywords: ['talent', 'freelancer', 'subcontractor', 'contractor'], signal: 'risk', label: 'Talent Dependency Risk' },
    { keywords: ['pipeline', 'feast or famine', 'dry spell', 'lead gen'], signal: 'risk', label: 'Revenue Volatility' },
  ],
  healthcare: [
    { keywords: ['hipaa', 'phi', 'patient data', 'protected health'], signal: 'risk', label: 'HIPAA Compliance Risk' },
    { keywords: ['ehr', 'emr', 'electronic health record', 'medical record'], signal: 'opportunity', label: 'EHR Integration Opportunity' },
    { keywords: ['wait time', 'scheduling', 'no-show', 'appointment'], signal: 'pain', label: 'Patient Scheduling Inefficiency' },
    { keywords: ['billing', 'claims', 'insurance', 'reimbursement', 'denied claim'], signal: 'pain', label: 'Billing & Claims Friction' },
    { keywords: ['telehealth', 'telemedicine', 'virtual care', 'remote patient'], signal: 'opportunity', label: 'Telehealth Expansion' },
    { keywords: ['burnout', 'clinician', 'provider shortage', 'staffing'], signal: 'risk', label: 'Clinician Burnout / Shortage' },
  ],
  creators: [
    { keywords: ['content calendar', 'posting schedule', 'batch', 'content creation'], signal: 'opportunity', label: 'Content Pipeline Automation' },
    { keywords: ['student support', 'student question', 'community management'], signal: 'pain', label: 'Student Support Overload' },
    { keywords: ['course launch', 'launch', 'webinar', 'funnel'], signal: 'opportunity', label: 'Launch Automation' },
    { keywords: ['passive income', 'evergreen', 'recurring membership'], signal: 'opportunity', label: 'Passive Revenue Model' },
    { keywords: ['platform dependent', 'youtube', 'instagram', 'algorithm'], signal: 'risk', label: 'Platform Dependency Risk' },
    { keywords: ['imposter', 'overwhelmed', 'wearing all hats', 'solo'], signal: 'pain', label: 'Solo Operator Overload' },
  ],
  nonprofit: [
    { keywords: ['donor', 'donation', 'fundraising', 'grant', 'giving'], signal: 'opportunity', label: 'Donor Engagement Opportunity' },
    { keywords: ['volunteer', 'volunteer management', 'volunteer coordination'], signal: 'pain', label: 'Volunteer Coordination Gap' },
    { keywords: ['impact measurement', 'outcomes', 'reporting', 'impact report'], signal: 'opportunity', label: 'Impact Measurement Opportunity' },
    { keywords: ['donor retention', 'lapsed donor', 'donor churn'], signal: 'risk', label: 'Donor Retention Risk' },
    { keywords: ['grant reporting', 'compliance', 'audit', 'accountability'], signal: 'risk', label: 'Grant Compliance Burden' },
    { keywords: ['board', 'governance', 'stakeholder', 'transparency'], signal: 'strength', label: 'Governance Foundation' },
  ],
  government: [
    { keywords: ['procurement', 'rfp', 'bid', 'contracting'], signal: 'pain', label: 'Procurement Complexity' },
    { keywords: ['citizen', 'constituent', 'public service', 'service delivery'], signal: 'opportunity', label: 'Citizen Service Improvement' },
    { keywords: ['legacy system', 'legacy', 'mainframe', 'cobol', 'outdated'], signal: 'pain', label: 'Legacy System Dependency' },
    { keywords: ['inter-agency', 'cross-department', 'coordination'], signal: 'opportunity', label: 'Cross-Agency Coordination' },
    { keywords: ['security', 'fedramp', 'clearance', 'classified'], signal: 'risk', label: 'Security / Clearance Requirement' },
    { keywords: ['budget cycle', 'fiscal year', 'appropriation', 'budget'], signal: 'risk', label: 'Budget Cycle Constraint' },
  ],
  manufacturing: [
    { keywords: ['downtime', 'machine downtime', 'equipment failure', 'maintenance'], signal: 'pain', label: 'Equipment Downtime' },
    { keywords: ['supply chain', 'supplier', 'vendor', 'lead time', 'procurement'], signal: 'pain', label: 'Supply Chain Disruption' },
    { keywords: ['quality control', 'qc', 'defect', 'rejection', 'scrap rate'], signal: 'pain', label: 'Quality Control Gap' },
    { keywords: ['predictive maintenance', 'iot', 'sensor', 'condition monitoring'], signal: 'opportunity', label: 'Predictive Maintenance Opportunity' },
    { keywords: ['lean', 'six sigma', 'kaizen', 'continuous improvement'], signal: 'strength', label: 'Lean Foundation' },
    { keywords: ['osha', 'safety', 'incident', 'workplace injury'], signal: 'risk', label: 'Workplace Safety Risk' },
  ],
  other: [],
};

/**
 * Analyse a single answer text and detect signals.
 * Combines universal signals with industry-specific ones.
 */
export function detectSignals(answerText: string, industry?: string): AnnotatedSignal[] {
  if (!answerText || answerText.length < 10) return [];

  const lower = answerText.toLowerCase();
  const signals: AnnotatedSignal[] = [];
  const seen = new Set<string>();

  // Combine universal + industry-specific signal dictionaries
  const allSignals = [...UNIVERSAL_SIGNALS];
  if (industry) {
    const key = resolveIndustryKey(industry);
    const industrySpecific = INDUSTRY_SIGNALS[key];
    if (industrySpecific) allSignals.push(...industrySpecific);
  }

  for (const def of allSignals) {
    const matched = def.keywords.filter(kw => lower.includes(kw));
    if (matched.length > 0 && !seen.has(def.label)) {
      seen.add(def.label);
      signals.push({
        type: def.signal,
        label: def.label,
        confidence: matched.length >= 3 ? 'high' : matched.length >= 2 ? 'medium' : 'low',
        matchedKeywords: matched,
      });
    }
  }

  return signals;
}

/**
 * Calculate a maturity indicator (1-5) from the answer text.
 * 1 = Very immature (lots of pain, no systems)
 * 5 = Very mature (documented, systematic, stable)
 */
export function assessMaturity(answerText: string): 1 | 2 | 3 | 4 | 5 {
  if (!answerText || answerText.length < 10) return 3;

  const lower = answerText.toLowerCase();

  // Positive maturity signals
  const matureKeywords = ['documented', 'automated', 'systematic', 'standardized', 'integrated', 'real-time', 'dashboard', 'kpi', 'playbook', 'sop', 'well-organized', 'proactive'];
  const immatureKeywords = ['manual', 'spreadsheet', 'chaos', 'no process', 'tribal knowledge', 'firefighting', 'ad hoc', 'paper', 'broken', 'nothing documented', 'in their heads'];

  let score = 3; // Default neutral
  for (const kw of matureKeywords) {
    if (lower.includes(kw)) score += 0.5;
  }
  for (const kw of immatureKeywords) {
    if (lower.includes(kw)) score -= 0.5;
  }

  return Math.max(1, Math.min(5, Math.round(score))) as 1 | 2 | 3 | 4 | 5;
}

// ── Bottleneck Linking ────────────────────────────────────────────────────────

/**
 * Standard bottleneck categories that core problems map to.
 * Each answer is checked against these to build the answer→bottleneck graph.
 */
export const BOTTLENECK_CATEGORIES = [
  { id: 'founder-dependency', label: 'Founder / Leader Dependency', keywords: ['depends on me', 'approval', 'sign-off', 'sign off', 'my approval', 'bottleneck', 'can\'t move without', 'founder'] },
  { id: 'manual-operations', label: 'Manual Operations at Scale', keywords: ['manual', 'manually', 'by hand', 'spreadsheet', 'copy-paste', 'repetitive', 'every time'] },
  { id: 'data-fragmentation', label: 'Data & Visibility Gaps', keywords: ['silo', 'siloed', 'disconnected', 'fragmented', 'scattered', 'no visibility', 'can\'t see', 'don\'t know'] },
  { id: 'customer-experience', label: 'Customer Experience Breakdown', keywords: ['churn', 'complaint', 'slow response', 'wait time', 'frustrated', 'confused', 'abandoned', 'cart abandonment'] },
  { id: 'scale-constraint', label: 'Scale Constraint', keywords: ['break', 'collapse', 'can\'t handle', 'overwhelmed', 'capacity', 'not scalable', 'won\'t scale'] },
  { id: 'revenue-leakage', label: 'Revenue Leakage', keywords: ['losing money', 'lost revenue', 'missed', 'unbilled', 'scope creep', 'leakage', 'waste', 'wasted'] },
  { id: 'tool-chaos', label: 'Tool & System Chaos', keywords: ['too many tools', 'don\'t connect', 'doesn\'t integrate', 'duplicate', 'redundant', 'legacy', 'outdated'] },
  { id: 'team-capacity', label: 'Team Capacity / Burnout', keywords: ['burnout', 'burn out', 'overworked', 'turnover', 'can\'t hire', 'understaffed', 'nights and weekends', 'stretched thin'] },
] as const;

/**
 * Given an answer, return which bottleneck categories it maps to.
 */
export function detectBottlenecks(answerText: string): string[] {
  if (!answerText || answerText.length < 10) return [];
  const lower = answerText.toLowerCase();
  const matched: string[] = [];

  for (const cat of BOTTLENECK_CATEGORIES) {
    if (cat.keywords.some(kw => lower.includes(kw))) {
      matched.push(cat.id);
    }
  }
  return matched;
}

/**
 * Get the human-readable label for a bottleneck ID.
 */
export function getBottleneckLabel(id: string): string {
  return BOTTLENECK_CATEGORIES.find(b => b.id === id)?.label || id;
}

// ── Full Annotation Pipeline ──────────────────────────────────────────────────

/**
 * Given a submission's answers and industry, produce a fully annotated Q&A array.
 */
export function annotateResponses(
  answers: Record<number, string | number>,
  industry: string,
): AnnotatedResponse[] {
  const questions = getQuestionsForIndustry(industry);
  const annotated: AnnotatedResponse[] = [];

  for (const q of questions) {
    const rawAnswer = answers[q.id];
    if (rawAnswer === undefined || rawAnswer === null) continue;

    const answerText = String(rawAnswer);
    if (answerText.trim().length === 0) continue;

    annotated.push({
      questionId: q.id,
      questionText: q.question,
      category: q.category,
      answer: answerText,
      detectedSignals: detectSignals(answerText, industry),
      linkedBottlenecks: detectBottlenecks(answerText),
      maturityIndicator: assessMaturity(answerText),
    });
  }

  return annotated;
}

/**
 * Build a reverse map: bottleneckId → list of questionIds whose answers reference it.
 */
export function buildBottleneckSourceMap(
  annotatedResponses: AnnotatedResponse[],
): Record<string, number[]> {
  const map: Record<string, number[]> = {};
  for (const resp of annotatedResponses) {
    for (const bn of resp.linkedBottlenecks) {
      if (!map[bn]) map[bn] = [];
      if (!map[bn].includes(resp.questionId)) {
        map[bn].push(resp.questionId);
      }
    }
  }
  return map;
}