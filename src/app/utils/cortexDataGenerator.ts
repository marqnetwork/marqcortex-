/**
 * CORTEX DATA GENERATOR
 *
 * Converts a real Submission (from Supabase) into a full CortexLeadData object.
 * This is the bridge between the form submissions and the CORTEX decision engine.
 *
 * In production this would be an AI-powered backend analysis (GPT/Claude).
 * For now it uses deterministic rule-based generation from the submission data.
 */

import type {
  Lead,
  CortexLeadData,
  DiagnosticSummary,
  ServiceRecommendation,
  ROIEstimate,
  ProposalData,
  CallPrep,
  DecisionLog,
  NextAction,
  CoreProblem,
  RiskFlag,
  PillarHeatmap,
} from '@/app/types/cortex-types';
import type { Submission } from '@/app/services/dataService';
import {
  annotateResponses,
  buildBottleneckSourceMap,
  getQuestionsForIndustry,
  getBottleneckLabel,
  detectBottlenecks,
  type AnnotatedResponse,
} from '@/app/utils/questionRegistry';
import {
  runDiagnosticEngine,
  adaptOutputToUITypes,
  estimateEmployees,
  buildRecommendationV1,
} from '@/app/utils/diagnosticEngine';
import { runCortexEngine } from '@/app/core';
import { createInitialPortfolioState } from '@/app/core/versionEngine';

// ============================================================================
// MAIN GENERATOR
// ============================================================================

export function generateCortexData(submission: Submission): CortexLeadData {
  const lead = buildLead(submission);
  const diagnostic = buildDiagnostic(submission);
  const recommendation = buildRecommendation(submission);
  const roiEstimate = buildROIEstimate(submission);
  const proposal = buildProposal(submission, recommendation);
  const callPrep = buildCallPrep(submission, diagnostic);
  const decisionLog = buildDecisionLog(submission);
  const nextActions = buildNextActions(submission, recommendation);

  // ── CORTEX CORE ENGINE: 4-module pipeline ──
  // InputNormalizer → ScoringEngine → DecisionEngine → TemplateAssembler
  // Math decides priority. LLM only explains decisions.
  let enrichedRecommendation = recommendation;
  let roiModel: import('@/app/core/types').PortfolioROIModel | undefined;
  let portfolioState: import('@/app/core/types').PortfolioState | undefined;
  try {
    const answers = submission.answers || {};
    const annotated = annotateResponses(answers, submission.industry || submission.industryId || 'other');
    if (annotated.length >= 3) {
      // Run the new 4-module core engine
      const corePayload = runCortexEngine({
        answers,
        annotatedResponses: annotated,
        company: submission.company,
        industry: submission.industry || submission.industryId || 'other',
        employeeEstimate: estimateEmployees(submission.employees || ''),
      });

      // Merge core engine output into recommendation
      const rec = corePayload.recommendation_payload;
      enrichedRecommendation = {
        ...recommendation,
        // Override with template-driven focus areas and "what not to do"
        focusAreas: rec.focusAreas90Days,
        notRecommended: rec.whatNotToDo,
        // v1 schema fields
        confidenceScore: rec.primaryRecommendation.confidenceScore,
        expectedImpact: rec.primaryRecommendation.expectedImpact,
        implementationWindowDays: rec.primaryRecommendation.implementationWindowDays,
        investmentSummary: rec.investmentSummary,
        // v2 schema — full structured recommendation
        recommendationV2: corePayload.recommendation_v2,
        // Portfolio — multi-department recommendations
        portfolio: corePayload.portfolio,
        // Decision Transparency — full audit trail
        decisionTransparency: corePayload.decision_transparency,
      };
      // ROI Model — deterministic portfolio-level ROI
      roiModel = corePayload.roi_model;

      // Portfolio State — version control
      portfolioState = createInitialPortfolioState(
        submission.id,
        submission.company,
        submission.industry || submission.industryId || 'other',
        estimateEmployees(submission.employees || ''),
        answers as Record<string, string>,
        corePayload,
      );

      // Log core engine decision for debugging
      console.log('[CortexCore] Decision:', corePayload.selected_core_problem,
        '| Sprint:', corePayload.sprint_template_id,
        '| Confidence:', corePayload.confidence_score.toFixed(2),
        '| Portfolio:', corePayload.portfolio.recommendations.length, 'recs');
    }
  } catch (err) {
    console.log('[CortexCore] Engine error (falling back to legacy recommendation):', err);

    // Fallback: try the older v1 engine
    try {
      const answers = submission.answers || {};
      const annotated = annotateResponses(answers, submission.industry || submission.industryId || 'other');
      if (annotated.length >= 3) {
        const pillarHeatmap = buildPillarHeatmap(submission);
        const engineOutput = runDiagnosticEngine({
          annotatedResponses: annotated,
          company: submission.company,
          industry: submission.industry || submission.industryId || 'other',
          employeeEstimate: estimateEmployees(submission.employees || ''),
          pillarHeatmap,
        });
        const recV1 = buildRecommendationV1(engineOutput, estimateEmployees(submission.employees || ''));
        enrichedRecommendation = {
          ...recommendation,
          confidenceScore: recV1.confidenceScore,
          expectedImpact: recV1.expectedImpact,
          implementationWindowDays: recV1.implementationWindowDays,
          investmentSummary: recV1.investmentSummary,
        };
      }
    } catch (fallbackErr) {
      console.log('[CortexCore] Fallback v1 engine also failed:', fallbackErr);
    }
  }

  return {
    lead,
    diagnostic,
    recommendation: enrichedRecommendation,
    roiEstimate,
    roiModel,
    portfolioState,
    proposal,
    callPrep,
    decisionLog,
    nextActions,
  };
}

// ============================================================================
// LEAD
// ============================================================================

function buildLead(sub: Submission): Lead {
  const urgency = sub.priority === 'high' ? 8 : sub.priority === 'medium' ? 5 : 3;
  const impact = Math.round((sub.completionScore + sub.qualityScore) / 20);

  const readinessScore =
    sub.completionScore >= 80 ? 'High' : sub.completionScore >= 60 ? 'Medium' : 'Low';

  const confidenceScore =
    sub.qualityScore >= 90 ? 'Very High' :
    sub.qualityScore >= 75 ? 'High' :
    sub.qualityScore >= 50 ? 'Medium' : 'Low';

  return {
    id: sub.id,
    companyName: sub.company,
    contactEmail: sub.email,
    industry: sub.industry,
    companySize: sub.employees || 'Unknown',
    submittedAt: sub.submittedAt,
    readinessScore,
    confidenceScore,
    primaryPainSignal: getPrimaryPainSignal(sub),
    status: mapSubmissionStatus(sub.status),
    assignedTo: undefined,
    lastActivityAt: sub.updatedAt || sub.submittedAt,
    urgencyLevel: Math.min(urgency + Math.round(sub.completionScore / 20), 10),
    impactPotential: Math.min(impact, 10),
  };
}

function mapSubmissionStatus(status: string) {
  switch (status) {
    case 'new': return 'new' as const;
    case 'in-review': return 'needs-review' as const;
    case 'completed': return 'ready-for-call' as const;
    case 'approved': return 'converted' as const;
    default: return 'new' as const;
  }
}

function getPrimaryPainSignal(sub: Submission): string {
  const answers = sub.answers || {};
  const firstAnswer = Object.values(answers)[0];
  if (firstAnswer && typeof firstAnswer === 'string' && firstAnswer.length > 30) {
    return firstAnswer.substring(0, 120) + (firstAnswer.length > 120 ? '...' : '');
  }
  return getDefaultPainSignal(sub.industry);
}

function getDefaultPainSignal(industry: string): string {
  const signals: Record<string, string> = {
    'E-commerce / DTC': 'Manual fulfillment and customer service bottlenecks blocking scale',
    'SaaS / Software': 'Manual onboarding and lack of product analytics causing churn',
    'Agency / Services': 'Founder dependency on all approvals — team cannot move without sign-off',
    'Healthcare / Medical': 'Compliance overhead and manual patient coordination consuming capacity',
    'Manufacturing': 'Supply chain visibility gaps and manual reporting delaying decisions',
    'Government / Public': 'Outdated systems causing duplication and service delivery gaps',
  };
  return signals[industry] || 'Operational inefficiencies limiting revenue growth and scale';
}

// ============================================================================
// DIAGNOSTIC SUMMARY
// ============================================================================

function buildDiagnostic(sub: Submission): DiagnosticSummary {
  const answers = sub.answers || {};
  const answerValues = Object.values(answers).filter(a => a && String(a).length > 10);

  // Build annotated responses with signal detection
  const annotated = annotateResponses(answers, sub.industry || sub.industryId || 'other');
  const bottleneckMap = buildBottleneckSourceMap(annotated);

  // Build core problems with source answer tracing
  const coreProblems = buildCoreProblemsWithSources(sub, answerValues, annotated, bottleneckMap);

  const pillarHeatmap = buildPillarHeatmap(sub);

  // ── Run the diagnostic engine (8-layer analysis) ──
  let engineSections: ReturnType<typeof adaptOutputToUITypes> | null = null;
  try {
    if (annotated.length >= 3) {
      const engineOutput = runDiagnosticEngine({
        annotatedResponses: annotated,
        company: sub.company,
        industry: sub.industry || sub.industryId || 'other',
        employeeEstimate: estimateEmployees(sub.employees || ''),
        pillarHeatmap,
      });
      engineSections = adaptOutputToUITypes(engineOutput);
    }
  } catch (err) {
    console.log('[CortexDataGenerator] Diagnostic engine error (falling back to legacy):', err);
  }

  return {
    leadId: sub.id,
    coreProblems,
    pillarHeatmap,
    riskFlags: buildRiskFlags(sub, answerValues),
    allResponses: buildAllResponses(sub),
    annotatedResponses: annotated,
    bottleneckSourceMap: bottleneckMap,
    // Attach engine-generated sections (if available)
    ...(engineSections && {
      executiveOverview: engineSections.executiveOverview,
      bottleneckDeepDives: engineSections.bottleneckDeepDives,
      systemicPatterns: engineSections.systemicPatterns,
      pillarInterpretations: engineSections.pillarInterpretations,
      financialModel: engineSections.financialModel,
      enhancedRisks: engineSections.enhancedRisks,
      confidenceLayer: engineSections.confidenceLayer,
    }),
  };
}

function buildCoreProblems(sub: Submission, answers: (string | number)[]): CoreProblem[] {
  const problems = getIndustryProblems(sub.industry, sub.company, answers);
  return problems.slice(0, 3);
}

function buildCoreProblemsWithSources(
  sub: Submission,
  answers: (string | number)[],
  annotated: AnnotatedResponse[],
  bottleneckMap: Record<string, number[]>,
): CoreProblem[] {
  const base = buildCoreProblems(sub, answers);

  // Enrich each problem with source answers and bottleneck IDs
  // Map problem titles to bottleneck categories
  const titleToBottleneck: Record<string, string> = {
    'Decision-Making Dependency': 'founder-dependency',
    'Data & Visibility Gaps': 'data-fragmentation',
    'Manual Processes at Scale': 'manual-operations',
    'Operational Bottleneck Identified': 'scale-constraint',
    'Customer Service Bottleneck': 'customer-experience',
    'Multi-Channel Inventory Chaos': 'data-fragmentation',
    'High Customer Acquisition Costs': 'revenue-leakage',
  };

  return base.map(problem => {
    const bnId = titleToBottleneck[problem.title];
    const sourceAnswers = bnId ? (bottleneckMap[bnId] || []) : [];

    // If no specific mapping, scan all annotated answers for relevant signals
    if (sourceAnswers.length === 0) {
      const problemKeywords = problem.whatsbroken.toLowerCase().split(/\s+/).filter(w => w.length > 4);
      for (const resp of annotated) {
        const answerLower = resp.answer.toLowerCase();
        const matchCount = problemKeywords.filter(kw => answerLower.includes(kw)).length;
        if (matchCount >= 2) {
          sourceAnswers.push(resp.questionId);
        }
      }
    }

    return {
      ...problem,
      bottleneckId: bnId,
      sourceAnswers: [...new Set(sourceAnswers)].slice(0, 5),
    };
  });
}

function getIndustryProblems(industry: string, company: string, answers: (string | number)[]): CoreProblem[] {
  const extractedProblem = answers[0] ? {
    title: 'Operational Bottleneck Identified',
    whatsbroken: typeof answers[0] === 'string' ? answers[0].substring(0, 200) : String(answers[0]),
    whyBreaking: 'Without systematic intervention, this bottleneck compounds under growth pressure.',
    whatBreaksNext: 'Revenue growth stalls, team burns out, and customer experience degrades.',
    urgencyScore: 8,
    editable: true,
  } : null;

  const genericProblems: CoreProblem[] = [
    {
      title: 'Decision-Making Dependency',
      whatsbroken: `Key decisions at ${company} still flow through one or two individuals, creating approval bottlenecks that slow execution across departments.`,
      whyBreaking: 'No documented decision framework exists, so every new situation requires escalation. This scales linearly with complexity.',
      whatBreaksNext: 'Growth compounds this problem. Doubling revenue means doubling the number of decisions hitting the same bottleneck.',
      urgencyScore: 7,
      editable: true,
    },
    {
      title: 'Data & Visibility Gaps',
      whatsbroken: `Critical operational data at ${company} is siloed across multiple systems with no unified view, meaning decisions are made on incomplete or lagging information.`,
      whyBreaking: 'Without real-time visibility, reactive management becomes the default — teams firefight instead of preventing issues.',
      whatBreaksNext: 'Continued revenue leakage through preventable churn, missed upsell opportunities, and operational waste.',
      urgencyScore: 6,
      editable: true,
    },
    {
      title: 'Manual Processes at Scale',
      whatsbroken: 'High-value team members are executing low-complexity, repetitive tasks that should be automated — wasting capacity that should be on strategic work.',
      whyBreaking: `The manual processes that got ${company} to current revenue are fundamentally incompatible with 2x or 3x scale.`,
      whatBreaksNext: 'Forced to hire to solve capacity problems that should be solved with systems — margin compression accelerates.',
      urgencyScore: 9,
      editable: true,
    },
  ];

  if (extractedProblem) {
    return [extractedProblem, ...genericProblems.slice(0, 2)];
  }
  return genericProblems;
}

function buildPillarHeatmap(sub: Submission): PillarHeatmap {
  const base = sub.completionScore / 20; // 0-5 scale
  const quality = sub.qualityScore / 20;

  return {
    operationsExecution: Math.max(0, Math.min(5, Math.round(base * 0.8))) as 0|1|2|3|4|5,
    revenueGrowth: Math.max(0, Math.min(5, Math.round(quality * 0.9))) as 0|1|2|3|4|5,
    systemsAutomation: Math.max(0, Math.min(5, Math.round(base * 0.6))) as 0|1|2|3|4|5,
    aiReadinessGovernance: Math.max(0, Math.min(5, Math.round(quality * 0.7))) as 0|1|2|3|4|5,
  };
}

function buildRiskFlags(sub: Submission, answers: (string | number)[]): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const answerText = answers.join(' ').toLowerCase();

  if (answerText.includes('me') || answerText.includes('myself') || answerText.includes('founder')) {
    flags.push({
      type: 'founder-dependency',
      label: 'Founder Dependency',
      description: 'Multiple responses indicate the founder is a single point of failure for key decisions and operations.',
      severity: 'critical',
    });
  }

  if (answerText.includes('hire') || answerText.includes('headcount') || answerText.includes('staff')) {
    flags.push({
      type: 'hiring-instead-of-systems',
      label: 'Hiring vs Systems Risk',
      description: 'Signals indicate the business is solving scale problems with headcount rather than systems — this is expensive and fragile.',
      severity: 'high',
    });
  }

  if (answerText.includes('tool') || answerText.includes('software') || answerText.includes('platform')) {
    flags.push({
      type: 'tool-chaos',
      label: 'Tool Chaos Detected',
      description: 'Multiple tool references suggest a fragmented tech stack with integration gaps causing data loss and manual work.',
      severity: 'medium',
    });
  }

  if (flags.length === 0) {
    flags.push({
      type: 'scale-risk',
      label: 'Scale-Readiness Risk',
      description: 'Current operational model shows signs of being incompatible with next-stage growth without structural changes.',
      severity: 'high',
    });
  }

  return flags;
}

function buildAllResponses(sub: Submission) {
  const answers = sub.answers || {};
  const questions = getQuestionsForIndustry(sub.industry || sub.industryId || 'other');

  return Object.entries(answers).map(([key, value]) => {
    const qId = parseInt(key, 10);
    const qDef = questions.find(q => q.id === qId);
    return {
      question: qDef?.question || `Question ${key}`,
      answer: String(value),
      category: qDef?.category || 'Business Assessment',
    };
  });
}

// ============================================================================
// RECOMMENDATION
// ============================================================================

function buildRecommendation(sub: Submission): ServiceRecommendation {
  const industry = sub.industry;
  const score = sub.completionScore;

  let primaryService: ServiceRecommendation['primaryService'] = 'operations-audit';
  let reasoning = '';
  let focusAreas: string[] = [];
  let timeline = '90-days';

  if (industry.includes('SaaS') || industry.includes('Software')) {
    primaryService = 'ai-implementation';
    reasoning = `${sub.company}'s diagnostic reveals the core leverage point is in intelligent automation of customer touchpoints — onboarding, activation, and retention flows. The SaaS model demands systematic, data-driven operations at scale, and manual processes are the primary churn driver.`;
    focusAreas = ['Customer onboarding automation', 'Churn prediction signals', 'Product usage analytics', 'Revenue expansion triggers'];
  } else if (industry.includes('Agency') || industry.includes('Services')) {
    primaryService = 'automation-sprint';
    reasoning = `Agency operations at ${sub.company} are constrained by manual delivery processes and founder approval gates. A focused automation sprint targeting client onboarding, reporting, and internal approvals will immediately free capacity and improve margins.`;
    focusAreas = ['Client onboarding workflow', 'Automated reporting', 'Internal approval gates', 'Resource allocation systems'];
  } else if (industry.includes('E-commerce') || industry.includes('DTC')) {
    primaryService = 'systems-integration';
    reasoning = `The E-commerce operation at ${sub.company} is losing revenue through disconnected systems — inventory, orders, customer service, and marketing are not talking to each other. Integration is the highest-ROI intervention.`;
    focusAreas = ['Order management integration', 'Customer data unification', 'Inventory automation', 'Marketing attribution'];
  } else if (industry.includes('Healthcare')) {
    primaryService = 'operations-audit';
    reasoning = `Healthcare operations at ${sub.company} require a systematic audit before automation — compliance requirements mean any process changes need documentation and validation. Start with a full operational audit to identify safe automation opportunities.`;
    focusAreas = ['Compliance mapping', 'Patient workflow optimization', 'Data governance', 'Reporting automation'];
  } else if (industry.includes('Non-Profit') || industry.includes('Education')) {
    primaryService = 'systems-integration';
    reasoning = `${sub.company}'s diagnostic reveals fragmented donor and volunteer data across multiple tools, limiting visibility and engagement effectiveness. Integrating these systems will immediately improve donor retention and operational efficiency while reducing manual reporting burden.`;
    focusAreas = ['Donor data unification', 'Volunteer management automation', 'Impact reporting dashboard', 'Grant compliance streamlining'];
  } else if (industry.includes('Government') || industry.includes('Public')) {
    primaryService = 'operations-audit';
    reasoning = `${sub.company}'s legacy systems and inter-agency coordination challenges require a comprehensive audit before any modernization work begins. Understanding the full constraint landscape — procurement rules, security requirements, and stakeholder dependencies — is critical to designing viable solutions.`;
    focusAreas = ['Legacy system assessment', 'Citizen service workflow mapping', 'Cross-department data flow', 'Compliance & security review'];
  } else if (industry.includes('Creator') || industry.includes('Training') || industry.includes('Course')) {
    primaryService = 'automation-sprint';
    reasoning = `As a creator business, ${sub.company} is losing significant time to manual student support and content operations. An automation sprint targeting community management, student onboarding, and content scheduling will free the founder to focus on high-value creation and growth.`;
    focusAreas = ['Student support automation', 'Content pipeline optimization', 'Launch sequence automation', 'Community engagement systems'];
  } else if (industry.includes('Manufacturing') || industry.includes('Supply Chain')) {
    primaryService = 'systems-integration';
    reasoning = `${sub.company}'s manufacturing operations are constrained by disconnected production, inventory, and supply chain systems. Integrating these into a unified visibility layer will eliminate manual tracking, reduce errors, and enable data-driven production decisions.`;
    focusAreas = ['Production-inventory integration', 'Supply chain visibility', 'Quality control automation', 'Predictive maintenance readiness'];
  } else if (score >= 80) {
    primaryService = 'strategic-roadmap';
    reasoning = `${sub.company} shows high diagnostic completion and quality scores, indicating an organization ready for strategic transformation. A comprehensive roadmap will sequence the automation and AI opportunities for maximum ROI.`;
    focusAreas = ['Strategic sequencing', 'Priority quick wins', 'Long-term architecture', 'Change management'];
  } else {
    primaryService = 'operations-audit';
    reasoning = `Before recommending specific solutions for ${sub.company}, a full operational audit is needed to map the current state, identify the highest-leverage bottlenecks, and sequence interventions for maximum impact.`;
    focusAreas = ['Process mapping', 'Bottleneck identification', 'Quick wins', 'Technology assessment'];
  }

  return {
    primaryService,
    primaryServiceLabel: getServiceLabel(primaryService),
    reasoning,
    notRecommended: [
      {
        service: 'Full AI Implementation',
        reason: 'Data infrastructure needs to be solidified first before AI layer can be effective',
      },
      {
        service: 'Enterprise Platform Migration',
        reason: 'Current processes need optimization before adding complexity of a platform change',
      },
    ],
    focusAreas,
    suggestedTimeline: timeline,
    recommendationStatus: 'pending',
  };
}

function getServiceLabel(service: string): string {
  const labels: Record<string, string> = {
    'operations-audit': 'Operations Audit',
    'ai-implementation': 'AI Implementation',
    'automation-sprint': 'Automation Sprint',
    'systems-integration': 'Systems Integration',
    'strategic-roadmap': 'Strategic Roadmap',
    'founder-leverage': 'Founder Leverage Package',
  };
  return labels[service] || service;
}

// ============================================================================
// ROI ESTIMATE
// ============================================================================

function buildROIEstimate(sub: Submission): ROIEstimate {
  const industryMultiplier = getIndustryROIMultiplier(sub.industry);
  const sizeMultiplier = getSizeMultiplier(sub.employees);

  const baseHours = 40 * industryMultiplier * sizeMultiplier;
  const hourlyRate = 85;

  const conservative = Math.round(baseHours * 0.6);
  const aggressive = Math.round(baseHours * 1.4);
  const costConservative = Math.round(conservative * hourlyRate);
  const costAggressive = Math.round(aggressive * hourlyRate);
  const revConservative = Math.round(costConservative * 1.5);
  const revAggressive = Math.round(costAggressive * 2.2);

  // Build 12-month projections for the expected scenario
  const totalInvestment = Math.round((costConservative + costAggressive) / 2 * 1.8);
  const monthlyBenefit = Math.round((costConservative + revConservative + costAggressive + revAggressive) / 4);
  const monthlyProjections: ROIEstimate['monthlyProjections'] = [];
  let cumulative = 0;
  for (let m = 1; m <= 12; m++) {
    const ramp = m <= 1 ? 0.3 : m <= 2 ? 0.6 : m <= 3 ? 0.85 : 1.0;
    const hours = Math.round(((conservative + aggressive) / 2) * ramp);
    const cost = Math.round(((costConservative + costAggressive) / 2) * ramp);
    const rev = Math.round(((revConservative + revAggressive) / 2) * ramp);
    cumulative += cost + rev;
    monthlyProjections.push({
      month: m,
      label: `Month ${m}`,
      hoursSaved: hours,
      costAvoided: cost,
      revenueRecovered: rev,
      cumulativeROI: cumulative,
      investmentToDate: totalInvestment,
      netValue: cumulative - totalInvestment,
    });
  }

  const breakEvenMonth = monthlyProjections.findIndex(p => p.netValue >= 0) + 1 || 3;

  return {
    hoursSavedPerMonth: { conservative, aggressive },
    costAvoidedPerMonth: { conservative: costConservative, aggressive: costAggressive },
    revenueLeakageReduced: { conservative: revConservative, aggressive: revAggressive },
    operationalRiskReduction: sub.completionScore >= 80 ? 'very-high' : sub.completionScore >= 60 ? 'high' : 'medium',
    notes: `ROI estimates based on ${sub.industry} industry benchmarks and ${sub.employees || 'company'} size profile. Validate against actual hourly cost rate during discovery call.`,
    confidenceLevel: sub.qualityScore >= 80 ? 'conservative' : 'needs-validation',

    monthlyProjections,

    scenarioComparison: {
      scenarios: [
        {
          name: 'Conservative',
          color: '#3B82F6',
          totalInvestment,
          year1Return: Math.round((costConservative + revConservative) * 12 * 0.85),
          roi: Math.round(((costConservative + revConservative) * 12 * 0.85 / totalInvestment - 1) * 100),
          paybackMonths: Math.max(1, breakEvenMonth + 1),
          netPresentValue: Math.round((costConservative + revConservative) * 12 * 0.85 * 0.9 - totalInvestment),
        },
        {
          name: 'Expected',
          color: '#8B5CF6',
          totalInvestment,
          year1Return: cumulative,
          roi: Math.round((cumulative / totalInvestment - 1) * 100),
          paybackMonths: breakEvenMonth,
          netPresentValue: Math.round(cumulative * 0.92 - totalInvestment),
        },
        {
          name: 'Aggressive',
          color: '#10B981',
          totalInvestment,
          year1Return: Math.round((costAggressive + revAggressive) * 12 * 0.95),
          roi: Math.round(((costAggressive + revAggressive) * 12 * 0.95 / totalInvestment - 1) * 100),
          paybackMonths: Math.max(1, breakEvenMonth - 1),
          netPresentValue: Math.round((costAggressive + revAggressive) * 12 * 0.95 * 0.92 - totalInvestment),
        },
      ],
    },

    breakEvenAnalysis: {
      breakEvenMonth,
      totalInvestment,
      monthlyBenefit,
      confidenceRange: { low: Math.max(1, breakEvenMonth - 1), high: breakEvenMonth + 1 },
    },

    editableAssumptions: [
      { id: 'hours-saved', label: 'Hours Saved per Month', value: Math.round((conservative + aggressive) / 2), unit: 'hours', min: 10, max: 300, category: 'savings', description: 'Expected monthly hours freed through automation and process improvements' },
      { id: 'hourly-rate', label: 'Effective Hourly Rate', value: hourlyRate, unit: '$', min: 30, max: 200, category: 'cost', description: 'Fully-loaded hourly cost of team members whose time is freed' },
      { id: 'revenue-multiplier', label: 'Revenue Recovery Factor', value: Math.round(industryMultiplier * 100), unit: '%', min: 50, max: 300, category: 'revenue', description: 'Expected revenue recovered as a percentage of operational savings' },
      { id: 'ramp-months', label: 'Full Ramp-Up Time', value: 3, unit: 'months', min: 1, max: 6, category: 'cost', description: 'Months until benefits reach full steady-state level' },
    ],
  };
}

function getIndustryROIMultiplier(industry: string): number {
  if (industry.includes('SaaS') || industry.includes('Software')) return 1.4;
  if (industry.includes('E-commerce') || industry.includes('DTC')) return 1.3;
  if (industry.includes('Manufacturing')) return 1.5;
  if (industry.includes('Healthcare')) return 1.2;
  if (industry.includes('Agency') || industry.includes('Services')) return 1.1;
  return 1.0;
}

function getSizeMultiplier(employees: string): number {
  if (!employees) return 1.0;
  if (employees.includes('500') || employees.includes('1000')) return 2.0;
  if (employees.includes('200')) return 1.6;
  if (employees.includes('51') || employees.includes('200')) return 1.3;
  if (employees.includes('11') || employees.includes('50')) return 1.0;
  return 0.8;
}

// ============================================================================
// PROPOSAL
// ============================================================================

function buildProposal(sub: Submission, rec: ServiceRecommendation): ProposalData {
  return {
    leadId: sub.id,
    clientContext: `${sub.company} is a ${sub.industry} business seeking to address operational inefficiencies and scale revenue. Key diagnostic signals indicate ${rec.focusAreas[0]?.toLowerCase() || 'process optimization'} is the primary leverage point.`,
    diagnosedProblems: rec.focusAreas,
    recommendedServicePath: rec.primaryServiceLabel,
    timeline: '90-days',
    pricingBand: getPricingBand(sub),
    pricingLocked: false,
    scopeItems: [
      `${rec.primaryServiceLabel} — Full engagement`,
      'Discovery & current-state mapping (Week 1-2)',
      'Solution architecture & implementation plan (Week 3-4)',
      'Build & deployment phase (Week 5-10)',
      '30-day post-launch optimization & support',
    ],
    exclusions: [
      'Ongoing managed services beyond engagement period',
      'Third-party software licensing costs',
      'Change management training (available as add-on)',
    ],
    upsellNotes: `High probability of expansion into ${rec.focusAreas[1]?.toLowerCase() || 'additional automation'} once Phase 1 delivers results. Book the expansion conversation at the 60-day check-in.`,
    generatedAt: new Date().toISOString(),
  };
}

function getPricingBand(sub: Submission): '$5K-$10K' | '$10K-$20K' | '$20K-$50K' | '$50K-$100K' | '$100K+' {
  const employees = sub.employees || '';
  if (employees.includes('1000') || employees.includes('500+')) return '$50K-$100K';
  if (employees.includes('201') || employees.includes('500')) return '$20K-$50K';
  if (employees.includes('51') || employees.includes('200')) return '$10K-$20K';
  if (employees.includes('11') || employees.includes('50')) return '$5K-$10K';
  return '$5K-$10K';
}

// ============================================================================
// CALL PREP
// ============================================================================

function buildCallPrep(sub: Submission, diagnostic: DiagnosticSummary): CallPrep {
  const problem = diagnostic.coreProblems[0];
  const company = sub.company;

  return {
    leadId: sub.id,
    suggestedAgenda: [
      `Open (5 min): Thank them for the diagnostic, confirm the 3 core problems resonated`,
      `Deep Dive (15 min): Explore "${problem?.title || 'primary pain point'}" — get specific numbers (how many hours/week, what's the cost of not fixing it)`,
      `Vision (10 min): Paint the picture of what good looks like 90 days from now`,
      `Solution Preview (10 min): Walk through the recommended service path and why it fits`,
      `Objections & Questions (10 min): Address concerns, validate assumptions`,
      `Next Steps (10 min): Proposal timeline, decision process, who else is involved`,
    ],
    keyQuestionsToValidate: [
      `"Walk me through what a bad week looks like operationally — how much time is lost to [${problem?.title || 'this problem'}]?"`,
      `"Who else on the leadership team needs to be involved in this decision?"`,
      `"If we could solve this in 90 days, what does that unlock for you in terms of revenue or capacity?"`,
      `"What's held you back from solving this before?"`,
      `"What does your current tech stack look like — what are you working with?"`,
      `"What's the timeline pressure? Is there an external deadline driving urgency?"`,
    ],
    expectedObjections: [
      {
        objection: 'We don\'t have the budget right now',
        response: `"I hear that. The ROI estimates show ${company} is losing approximately $${getROIHint(sub)}/month to this problem. At that rate, the cost of waiting is higher than the engagement cost. Can we explore a phased approach that self-funds from early wins?"`,
      },
      {
        objection: 'We\'re too busy to implement anything new right now',
        response: '"That\'s exactly the signal. When businesses are too busy to fix the thing making them busy, the bottleneck compounds. Our implementation is designed to run alongside your operations — we handle the build, your team validates. Minimum disruption."',
      },
      {
        objection: 'We\'ve tried this before and it didn\'t work',
        response: '"Tell me more about what you tried. In most cases, previous failures come from one of three places: wrong sequencing, no internal champion, or solutions that were too complex to stick. We\'ve specifically designed our approach to avoid all three."',
      },
      {
        objection: 'We need to think about it',
        response: '"Absolutely. What specifically needs more clarity? Let me make sure you have everything you need to make a confident decision — I can send a summary doc and we can schedule a 15-minute follow-up for any remaining questions."',
      },
    ],
    doNotPitchYetWarnings: diagnostic.riskFlags
      .filter(f => f.severity === 'critical')
      .map(f => `Do not sell past "${f.label}" — this needs to be addressed and validated before commitment. ${f.description}`),
    expansionSignalsToListenFor: [
      'Mentions of other departments with similar problems',
      'References to upcoming growth, fundraise, or hiring plans',
      'Frustration with current tools or vendors',
      'Desire for ongoing partnership vs. one-time project',
      'Decision-maker bringing others into the conversation',
    ],
  };
}

function getROIHint(sub: Submission): string {
  const base = sub.qualityScore * 50;
  return new Intl.NumberFormat('en-US').format(base);
}

// ============================================================================
// DECISION LOG
// ============================================================================

function buildDecisionLog(sub: Submission): DecisionLog[] {
  return [
    {
      leadId: sub.id,
      timestamp: sub.submittedAt,
      fromStatus: 'new' as const,
      toStatus: 'new' as const,
      reason: 'Submission received via diagnostic form',
      actionTakenBy: 'System',
      notes: `Submission auto-processed. Completion score: ${sub.completionScore}%. Quality score: ${sub.qualityScore}%.`,
    },
  ];
}

// ============================================================================
// NEXT ACTIONS
// ============================================================================

function buildNextActions(sub: Submission, rec: ServiceRecommendation): NextAction[] {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86400000).toISOString();
  const nextWeek = new Date(now.getTime() + 604800000).toISOString();

  return [
    {
      leadId: sub.id,
      action: `Review ${sub.company} diagnostic submission and validate AI-generated analysis`,
      priority: 'urgent',
      dueDate: tomorrow,
      assignedTo: 'Account Lead',
    },
    {
      leadId: sub.id,
      action: `Send personalised outreach to ${sub.contact || sub.email} acknowledging their submission`,
      priority: 'high',
      dueDate: tomorrow,
      assignedTo: 'Account Lead',
    },
    {
      leadId: sub.id,
      action: `Schedule discovery call to validate "${rec.focusAreas[0]}" as primary opportunity`,
      priority: 'high',
      dueDate: nextWeek,
      assignedTo: 'Strategist',
    },
    {
      leadId: sub.id,
      action: `Prepare customised proposal draft for ${rec.primaryServiceLabel}`,
      priority: 'medium',
      dueDate: nextWeek,
      assignedTo: 'Ops Architect',
    },
  ];
}