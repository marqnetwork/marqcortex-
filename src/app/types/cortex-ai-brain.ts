/**
 * CORTEX AI BRAIN - INTERNAL PROCESSING PIPELINE
 * 
 * This file defines the THINKING PROCESS that happens between:
 * - Raw diagnostic responses (input)
 * - Cortex intelligence outputs (Lead, Diagnostic, Recommendation, etc.)
 * 
 * This is NOT shown to clients. This is internal AI reasoning.
 * 
 * BACKEND IMPLEMENTATION:
 * When GPT/Claude analyzes a diagnostic submission, it should:
 * 1. Process raw answers through these 8 steps
 * 2. Generate intermediate structured data
 * 3. Use that data to produce final CortexLeadData
 * 
 * WHY THIS MATTERS:
 * This is decision intelligence, not form filling.
 * This is your moat - the AI learns what works.
 */

import type { PillarType } from '@/app/types/cortex-data-schema';

export type { PillarType };

// ============================================================================
// 1️⃣ ANSWER INGESTION (Raw → Structured)
// ============================================================================

/**
 * Step 1: Parse long-form answers into signals, not text
 * 
 * Every answer is analyzed for:
 * - Pain words (delay, manual, approval, follow-up, chaos, blind, slow)
 * - Decision ownership patterns
 * - Process maturity indicators
 * - Tool fragmentation signals
 * - Scale stress indicators
 */

export interface SignalExtraction {
  questionId: string;
  rawAnswer: string;
  
  // Extracted signals
  painWords: {
    word: string;
    frequency: number;
    context: string;
  }[];
  
  decisionOwnership: 'founder' | 'manager' | 'team' | 'unclear' | 'distributed';
  
  processMaturity: 'ad-hoc' | 'semi-defined' | 'documented' | 'automated';
  
  toolFragmentation: {
    hasToolChaos: boolean;
    toolCount: number;
    integrationLevel: 'none' | 'manual' | 'partial' | 'full';
    usesSpreadsheets: boolean;
    usesChatApps: boolean;  // WhatsApp, Slack chaos
  };
  
  scaleStressIndicators: {
    breaksAtGrowth: boolean;
    hiringDependency: boolean;
    founderBottleneck: boolean;
    manualFollowups: boolean;
    missedOpportunities: boolean;
  };
}

export interface IngestionOutput {
  submissionId: string;
  extractedSignals: SignalExtraction[];
  overallPainLevel: number;  // 0-10
  primaryPainTheme: string;  // e.g., "Founder Bottleneck", "Tool Chaos"
}

// ============================================================================
// 2️⃣ PILLAR MAPPING (Core Intelligence)
// ============================================================================

/**
 * Step 2: Map each answer across 4 service pillars
 * 
 * CRITICAL: Each answer feeds MULTIPLE pillars, not just one.
 * Example: "All approvals come to me" triggers:
 * - Ops bottleneck (Operations)
 * - Founder dependency (Operations)
 * - Sales leakage (Revenue)
 * - Automation opportunity (Systems)
 * - Agent potential (AI Readiness)
 */

export interface PillarSignal {
  pillar: PillarType;
  signalStrength: number;  // 0-10
  trigger: string;  // What in the answer triggered this
  implication: string;  // What this means for the business
}

export interface PillarMappingOutput {
  submissionId: string;
  
  // Each answer contributes to multiple pillars
  answerPillarMaps: {
    questionId: string;
    rawAnswer: string;
    pillarSignals: PillarSignal[];
  }[];
  
  // Aggregated pillar signals
  pillarAggregates: {
    pillar: PillarType;
    totalSignalStrength: number;
    keyTriggers: string[];
    topImplications: string[];
  }[];
}

// ============================================================================
// 3️⃣ SEVERITY SCORING (0-5 per Pillar)
// ============================================================================

/**
 * Step 3: For each pillar, AI assigns scores across 4 dimensions
 * 
 * This is how you avoid guessing.
 */

export interface PillarSeverityScore {
  pillar: PillarType;
  
  // 4 dimensions (0-5 each)
  painSeverity: number;         // How bad is it now?
  costImpact: number;            // How much is it costing?
  urgency: number;               // How soon will it break?
  aiLeveragePotential: number;  // How much can AI help?
  
  // Overall pillar score (0-5)
  overallScore: number;  // Weighted average
  
  // Human-readable
  severity: 'stable' | 'needs-attention' | 'urgent' | 'critical';
  reasoning: string;
}

export interface SeverityScoringOutput {
  submissionId: string;
  pillarScores: PillarSeverityScore[];
  
  // Priority order (most urgent first)
  prioritySequence: PillarType[];
  
  // Overall business health (0-5)
  overallHealthScore: number;
}

// ============================================================================
// 4️⃣ PATTERN RECOGNITION (The Moat)
// ============================================================================

/**
 * Step 4: AI compares answers against historical data
 * 
 * This is why free audits convert.
 * The AI learns what patterns lead to successful implementations.
 */

export type BusinessPattern = 
  | 'founder-choke-point'
  | 'tool-sprawl-no-orchestration'
  | 'growth-without-ops-backbone'
  | 'ai-interest-low-governance'
  | 'hiring-over-systems'
  | 'revenue-leakage-manual-followup'
  | 'compliance-risk-manual-data'
  | 'scale-imminent-ops-not-ready';

export interface PatternMatch {
  pattern: BusinessPattern;
  confidence: number;  // 0-100%
  evidenceSignals: string[];  // Which answers triggered this
  typicalOutcome: string;  // What usually happens with this pattern
  recommendedAction: string;  // What to do first
  whatNotToDo: string;  // Common mistakes to avoid
}

export interface PatternRecognitionOutput {
  submissionId: string;
  detectedPatterns: PatternMatch[];
  
  // Comparison to historical data
  similarLeads: {
    industry: string;
    patternMatch: number;  // % similarity
    converted: boolean;
    serviceUsed?: string;
    outcome?: string;
  }[];
  
  // Confidence in diagnosis
  diagnosisConfidence: 'low' | 'medium' | 'high' | 'very-high';
  confidenceReasons: string[];
}

// ============================================================================
// 5️⃣ SOLUTION ASSEMBLY (Not Recommendation Spam)
// ============================================================================

/**
 * Step 5: AI produces targeted recommendations
 * 
 * Does NOT say "buy everything"
 * Produces: What to start, what breaks next, what to delay
 */

export interface SolutionRecommendation {
  // What to start with
  primaryStartingPoint: {
    pillar: PillarType;
    serviceType: string;
    reasoning: string;
    expectedImpact: string;
    timeline: string;  // "30 days", "60 days", etc.
  };
  
  // Top 3 root problems
  rootProblems: {
    problem: string;
    whatsBreaking: string;
    whyBreaking: string;
    whatBreaksNext: string;
    urgencyScore: number;  // 0-10
  }[];
  
  // What NOT to do yet
  delayedActions: {
    action: string;
    reason: string;
    whenToRevisit: string;
  }[];
  
  // Sequencing logic
  implementationSequence: {
    phase: number;
    duration: string;
    focus: string;
    dependencies: string[];
  }[];
}

export interface SolutionAssemblyOutput {
  submissionId: string;
  recommendation: SolutionRecommendation;
  
  // Alternative paths (if primary doesn't work)
  alternativeApproaches: {
    condition: string;  // "If budget is constrained..."
    alternativeService: string;
    reasoning: string;
  }[];
}

// ============================================================================
// 6️⃣ ROI MODELING (Rough but Credible)
// ============================================================================

/**
 * Step 6: Estimate business impact
 * 
 * Based on:
 * - Team size
 * - Manual hours described
 * - Missed opportunities mentioned
 * - Decision delays
 * 
 * No fake precision. Ranges only.
 */

export interface ROIModelingInputs {
  teamSize: number;
  manualHoursDescribed: {
    activity: string;
    estimatedHoursPerWeek: number;
    automationPotential: number;  // 0-100%
  }[];
  
  missedOpportunities: {
    type: string;  // "Lost deals", "Delayed launches", etc.
    frequency: string;  // "2-3 per month", etc.
    estimatedValue: number;
  }[];
  
  decisionDelays: {
    process: string;
    delayDays: number;
    costPerDelay: number;
  }[];
}

export interface ROIModelingOutput {
  submissionId: string;
  
  // Conservative estimates
  conservative: {
    hoursSavedPerMonth: number;
    costAvoidedPerMonth: number;
    revenueLeakageReduced: number;
    assumptionNotes: string[];
  };
  
  // Aggressive estimates
  aggressive: {
    hoursSavedPerMonth: number;
    costAvoidedPerMonth: number;
    revenueLeakageReduced: number;
    assumptionNotes: string[];
  };
  
  // Operational risk
  operationalRiskReduction: 'low' | 'medium' | 'high' | 'very-high';
  riskReductionReasoning: string;
  
  // Validation questions
  questionsToValidateOnCall: string[];
}

// ============================================================================
// 7️⃣ INTERNAL CONFIDENCE SCORE
// ============================================================================

/**
 * Step 7: Before anything goes to client, assess confidence
 * 
 * If low confidence:
 * - Flag for human review
 * - Ask 2 follow-up questions
 * - No auto-proposal sent
 * 
 * This protects trust.
 */

export interface ConfidenceAssessment {
  submissionId: string;
  
  overallConfidence: 'low' | 'medium' | 'high' | 'very-high';
  confidenceScore: number;  // 0-100
  
  // Confidence breakdown
  diagnosticConfidence: number;  // 0-100 - Are we sure about the problems?
  recommendationConfidence: number;  // 0-100 - Are we sure about the solution?
  roiConfidence: number;  // 0-100 - Are we sure about the impact?
  
  // What affects confidence
  confidenceFactors: {
    factor: string;
    impact: 'positive' | 'negative';
    weight: number;  // How much it matters
  }[];
  
  // If low confidence, what to do
  humanReviewRequired: boolean;
  followUpQuestions: string[];  // Ask these before proceeding
  autoProposalAllowed: boolean;  // Can we send proposal automatically?
  
  // Why confidence is low/high
  reasoning: string;
}

// ============================================================================
// 8️⃣ HUMAN OVERRIDE LAYER
// ============================================================================

/**
 * Step 8: Your team can edit AI insights
 * 
 * AI assists. Humans decide.
 */

export interface HumanOverride {
  submissionId: string;
  timestamp: string;
  teamMember: string;
  
  overrideType: 
    | 'edit-insight'
    | 'adjust-priority'
    | 'change-recommendation'
    | 'lock-recommendation'
    | 'delay-proposal';
  
  originalValue: any;
  newValue: any;
  reason: string;
  
  // For learning loop
  feedbackToAI: {
    whatWasWrong: string;
    whatShouldChange: string;
    applyToSimilarCases: boolean;
  };
}

export interface HumanOverrideLog {
  submissionId: string;
  overrides: HumanOverride[];
  
  // Status
  reviewStatus: 'pending' | 'reviewed' | 'approved' | 'needs-revision';
  reviewedBy?: string;
  reviewedAt?: string;
  
  // Final decision
  proceedWithRecommendation: boolean;
  modifiedRecommendation?: any;
}

// ============================================================================
// COMPLETE AI BRAIN PIPELINE
// ============================================================================

/**
 * This is the complete thinking process from raw answers → Cortex outputs
 */

export interface CortexAIBrain {
  submissionId: string;
  
  // 8-step processing pipeline
  step1_ingestion: IngestionOutput;
  step2_pillarMapping: PillarMappingOutput;
  step3_severityScoring: SeverityScoringOutput;
  step4_patternRecognition: PatternRecognitionOutput;
  step5_solutionAssembly: SolutionAssemblyOutput;
  step6_roiModeling: ROIModelingOutput;
  step7_confidenceAssessment: ConfidenceAssessment;
  step8_humanOverride: HumanOverrideLog;
  
  // Final outputs (what becomes CortexLeadData)
  finalOutputs: {
    diagnosticSummary: any;  // Maps to DiagnosticSummary
    recommendation: any;      // Maps to ServiceRecommendation
    roiEstimate: any;         // Maps to ROIEstimate
    callPrep: any;           // Maps to CallPrep
    proposal: any;           // Maps to ProposalData
  };
  
  // Metadata
  processedAt: string;
  processingTimeMs: number;
  aiModel: string;  // "GPT-4", "Claude-3.5", etc.
  promptVersion: string;
}

// ============================================================================
// LEARNING LOOP DATA STRUCTURES
// ============================================================================

/**
 * After outcomes are logged, feed this back to improve the AI
 */

export interface LearningLoopFeedback {
  submissionId: string;
  
  // What was predicted
  predicted: {
    pattern: BusinessPattern;
    recommendedService: string;
    estimatedROI: number;
    confidenceScore: number;
  };
  
  // What actually happened
  actual: {
    converted: boolean;
    serviceUsed?: string;
    actualROI?: number;
    timeToClose?: number;
    dealValue?: number;
  };
  
  // Analysis
  accuracy: {
    patternMatchCorrect: boolean;
    recommendationCorrect: boolean;
    roiAccurate: boolean;
    confidenceCalibrated: boolean;
  };
  
  // Lessons learned
  insights: {
    whatWorked: string[];
    whatDidntWork: string[];
    unexpectedSignals: string[];
    suggestedImprovements: string[];
  };
  
  // System updates
  systemUpdates: {
    updateType: 'scoring-weight' | 'pattern-definition' | 'roi-model' | 'risk-flag';
    change: string;
    applyToIndustry?: string;
  }[];
}

/**
 * API INTEGRATION - HOW TO USE THIS
 * 
 * Backend flow:
 * 
 * 1. Receive diagnostic submission
 * 2. Call GPT/Claude with structured prompt (see cortexAIPrompts.ts)
 * 3. AI processes through 8 steps, returns CortexAIBrain object
 * 4. Store intermediate steps in database (for learning loop)
 * 5. Extract finalOutputs → convert to CortexLeadData
 * 6. Return to frontend
 * 
 * Example:
 * 
 * const aiResponse = await callGPT4({
 *   prompt: CORTEX_ANALYSIS_PROMPT,
 *   diagnosticAnswers: submission.answers,
 *   companyInfo: submission.company,
 *   responseSchema: CortexAIBrain
 * });
 * 
 * const cortexData: CortexLeadData = {
 *   lead: buildLeadFromAI(aiResponse),
 *   diagnostic: aiResponse.finalOutputs.diagnosticSummary,
 *   recommendation: aiResponse.finalOutputs.recommendation,
 *   roiEstimate: aiResponse.finalOutputs.roiEstimate,
 *   // ... etc
 * };
 * 
 * // Store for learning loop
 * await db.cortexAIProcessing.create({
 *   submissionId: submission.id,
 *   aiThinkingProcess: aiResponse,
 *   processedAt: new Date()
 * });
 */

/**
 * WHY THIS IS NOT "JUST AN INTAKE FORM"
 * 
 * CRMs collect data.
 * Agencies ask questions.
 * Cortex interprets intent, pain, and leverage.
 * 
 * This is decision intelligence, not form filling.
 * This is your moat.
 */
