/**
 * CORTEX DIAGNOSTIC INTELLIGENCE SCHEMA (pipeline / backend target)
 *
 * Domain: raw intake → signal extraction → scoring → synthesis → report.
 * NOT the team dashboard — use `cortex-types.ts` for UI/control-room shapes.
 *
 * Naming: types that share a concept with `cortex-types.ts` use a `Schema*` prefix
 * (e.g. `SchemaCoreProblem` vs dashboard `CoreProblem`) to prevent import collisions.
 *
 * COMPLETE DATA TRANSFORMATION PIPELINE:
 * Raw Intake → Signal Extraction → Scoring → Problems → Recommendations → Report
 */

// ============================================================================
// 1️⃣ INTAKE FORM STRUCTURE (RAW INPUT)
// ============================================================================

/**
 * Each intake submission creates one Diagnostic Object
 */
export interface DiagnosticIntake {
  // A. Metadata (Auto-captured)
  metadata: {
    lead_id: string;              // UUID
    company_name: string;
    industry: IndustryType;
    company_size: CompanySizeRange;
    revenue_range: RevenueRange;
    submitted_at: string;         // ISO 8601 timestamp
    traffic_source?: string;      // Where they came from
  };
  
  // B. Narrative Answers (Founder-Written)
  answers: NarrativeAnswer[];
}

export interface NarrativeAnswer {
  question_id: string;            // "Q1", "Q2", etc.
  pillar: PillarType;             // Which pillar this question maps to
  raw_answer: string;             // Long text, unprocessed
  confidence_score: number | null; // null until processed
}

export type IndustryType = 
  | 'e-commerce-dtc'
  | 'saas-software'
  | 'professional-services'
  | 'healthcare-medical'
  | 'real-estate'
  | 'manufacturing'
  | 'marketing-agency'
  | 'legal-finance'
  | 'nonprofit-education';

export type CompanySizeRange = 
  | '1-10'
  | '11-50'
  | '51-200'
  | '201-500'
  | '500+';

export type RevenueRange = 
  | 'under-500k'
  | '500k-1m'
  | '1m-5m'
  | '5m-10m'
  | '10m-50m'
  | '50m+';

export type PillarType = 
  | 'operations-execution'
  | 'revenue-growth'
  | 'systems-automation'
  | 'ai-readiness-governance';

/**
 * CRITICAL NOTE:
 * Nothing is scored yet. This is truth capture, not judgment.
 */

// ============================================================================
// 2️⃣ PRE-PROCESSING LAYER (CLEANING & SIGNAL EXTRACTION)
// ============================================================================

/**
 * Before AI analysis, we normalize text and extract signals
 */
export interface PreProcessedAnswer {
  question_id: string;
  original_raw_answer: string;
  
  // A. Normalized Text
  normalized: {
    cleaned_text: string;         // Filler removed, tense normalized
    key_entities: ExtractedEntities;
  };
  
  // B. Extracted Signals
  signals: ExtractedSignals;
}

export interface ExtractedEntities {
  tools: string[];                // ["Slack", "Notion", "HubSpot"]
  people: string[];               // ["founder", "manager", "team"]
  processes: string[];            // ["approval", "follow-up", "reporting"]
  emotions: string[];             // ["overwhelmed", "frustrated", "chaotic"]
  urgency: string[];              // ["urgent", "breaking", "immediate"]
}

/**
 * Signals are binary or weighted, not opinions.
 */
export interface ExtractedSignals {
  manual_work: boolean | number;           // 0-1 confidence
  founder_dependency: boolean | number;
  tool_sprawl: boolean | number;
  approval_delay: boolean | number;
  volume_pressure: boolean | number;
  hiring_intention: boolean | number;
  revenue_leakage: boolean | number;
  compliance_risk: boolean | number;
  scale_imminent: boolean | number;
  process_documented: boolean | number;
  ai_awareness: boolean | number;
}

// ============================================================================
// 3️⃣ PILLAR SCORING ENGINE
// ============================================================================

/**
 * Each pillar is scored independently based on:
 * - Signal frequency
 * - Signal severity
 * - Language intensity
 * - Repetition across answers
 */
export interface SchemaPillarScore {
  pillar: PillarType;
  score: number;                  // 0.0 - 5.0 (decimal precision)
  status: 'Green' | 'Yellow' | 'Red';
  
  // What contributed to this score
  contributing_signals: {
    signal: keyof ExtractedSignals;
    weight: number;
    frequency: number;
  }[];
  
  // Breakdown by dimension
  breakdown: {
    pain_severity: number;        // 0-5
    cost_impact: number;          // 0-5
    urgency: number;              // 0-5
    ai_leverage_potential: number; // 0-5
  };
}

/**
 * Score ranges:
 * - 0.0 - 1.5: Green (Stable)
 * - 1.6 - 2.9: Yellow (Needs Attention)
 * - 3.0 - 5.0: Red (Immediate/Critical)
 * 
 * Scores are ranges, not absolutes.
 */
export interface PillarScoringResult {
  lead_id: string;
  pillars: SchemaPillarScore[];
  overall_health_score: number;   // 0-5 average
  priority_sequence: PillarType[]; // Order to address
  processed_at: string;
}

// ============================================================================
// 4️⃣ PROBLEM SYNTHESIS ENGINE
// ============================================================================

/**
 * This is where Cortex stops being a form.
 * From signals → problems
 */
export interface SchemaCoreProblem {
  problem: string;                // "Founder approval bottleneck"
  root_cause: string;             // "No standardized workflows"
  impact: string;                 // "Delays, burnout, missed follow-ups"
  
  // Evidence
  supporting_questions: string[]; // ["Q3", "Q7", "Q11"]
  signal_evidence: string[];      // ["founder_dependency: 0.92", "approval_delay: 0.85"]
  
  // Severity
  urgency_score: number;          // 0-10
  business_impact_level: 'Low' | 'Medium' | 'High' | 'Critical';
}

/**
 * RULES:
 * - Max 4 problems
 * - Must be cross-question validated (2+ questions support it)
 * - No single-answer conclusions
 */
export interface ProblemSynthesisResult {
  lead_id: string;
  core_problems: SchemaCoreProblem[];   // Max 4
  problem_clusters: {
    cluster_name: string;
    related_problems: string[];
  }[];
  confidence: number;             // 0-1 (overall synthesis confidence)
  processed_at: string;
}

// ============================================================================
// 5️⃣ READINESS CLASSIFIER
// ============================================================================

/**
 * Generates readiness level with confidence score
 */
export interface ReadinessClassification {
  lead_id: string;
  
  readiness_level: 'Low' | 'Medium' | 'High';
  confidence: number;             // 0-1
  
  // What influenced this classification
  factors: {
    positive: string[];           // ["Clear pain articulated", "Quantitative data provided"]
    negative: string[];           // ["Vague answers", "Contradictions detected"]
  };
  
  // Flags for human review
  review_flags: {
    vague_answers: boolean;
    contradictions: boolean;
    missing_operational_clarity: boolean;
    unrealistic_expectations: boolean;
  };
  
  processed_at: string;
}

/**
 * Confidence drops if:
 * - Answers are vague
 * - Contradictions exist
 * - Missing operational clarity
 * 
 * Low confidence = flagged for human review
 */

// ============================================================================
// 6️⃣ SERVICE MATCHING LOGIC
// ============================================================================

/**
 * Based on:
 * - Pillar heatmap
 * - Problem types
 * - Readiness level
 * - Industry constraints
 */
export interface SchemaServiceRecommendation {
  lead_id: string;
  
  // Recommended path (prioritized)
  recommended_path: ServiceMatch[];
  
  // What NOT to recommend yet
  do_not_recommend_yet: {
    service: string;
    reason: string;
  }[];
  
  // Rationale
  recommendation_logic: {
    primary_driver: string;       // "Multiple red pillars with unclear ROI"
    supporting_factors: string[];
    risk_factors: string[];
  };
  
  confidence: number;             // 0-1
  processed_at: string;
}

export interface ServiceMatch {
  service: string;                // "AI Readiness & ROI Audit"
  priority: number;               // 1, 2, 3
  why: string;                    // "Multiple red pillars with unclear ROI"
  expected_duration: string;      // "30 days", "60 days"
  prerequisites: string[];        // What must happen first
  unlocks: string[];              // What becomes possible after
}

/**
 * This prevents overselling.
 */

// ============================================================================
// 7️⃣ ROI RANGE ESTIMATION
// ============================================================================

/**
 * Uses:
 * - Company size
 * - Manual work signals
 * - Volume indicators
 */
export interface ROIEstimation {
  lead_id: string;
  
  // Conservative estimates
  conservative: {
    hours_saved_monthly: string;    // "40–70"
    cost_avoided_monthly: string;   // "$4,000–$7,000"
    revenue_leakage_reduced: string; // "$10k–$25k/quarter"
  };
  
  // Aggressive estimates
  aggressive: {
    hours_saved_monthly: string;    // "70–120"
    cost_avoided_monthly: string;   // "$7,000–$12,000"
    revenue_leakage_reduced: string; // "$25k–$50k/quarter"
  };
  
  // Calculation assumptions
  assumptions: string[];            // ["Team of 15 @ $75/hr loaded cost", "40% of tickets automatable"]
  
  // Validation needed
  questions_to_validate: string[];  // ["Confirm ticket volume", "Verify team hourly rate"]
  
  confidence: number;               // 0-1
  processed_at: string;
}

/**
 * CRITICAL:
 * - Ranges only
 * - Never promises
 * - Always include assumptions
 * - Always include validation questions
 */

// ============================================================================
// 8️⃣ REPORT GENERATOR (CLIENT-FACING)
// ============================================================================

/**
 * Pulls from:
 * - Readiness
 * - Problems
 * - Pillar heatmap
 * - Recommended path
 * - ROI ranges
 * 
 * Everything is editable before sending.
 */
export interface SchemaClientReportData {
  lead_id: string;
  
  // Report metadata
  report_id: string;
  generated_at: string;
  status: 'draft' | 'review' | 'approved' | 'sent';
  
  // Content (all editable)
  content: {
    // Executive snapshot
    readiness: {
      level: 'Low' | 'Medium' | 'High';
      interpretation: string;
      what_this_means: string[];
      immediate_risk: string;
    };
    
    // Core diagnosis
    core_issues: {
      title: string;
      problem: string;
      why_exists: string;
      business_impact: string[];
    }[];
    
    // Operational heatmap
    heatmap: {
      pillar: PillarType;
      score: 'Green' | 'Yellow' | 'Red';
      label: string;
      explanation: string;
    }[];
    
    // AI opportunities
    ai_opportunities: {
      high_impact: string[];
      should_not_automate: string[];
    };
    
    // Recommended first step
    first_step: {
      service: string;
      why_first: string;
      what_unlocks: string;
    };
    
    // Impact range
    impact: {
      hours_saved: string;
      cost_avoided: string;
      revenue_impact: string;
      disclaimer: string;
    };
  };
  
  // Team notes (internal only)
  internal_notes?: string;
  edited_by?: string;
  edited_at?: string;
}

// ============================================================================
// 9️⃣ INTERNAL REVIEW FLAGS
// ============================================================================

/**
 * Before sending, system checks for review needs
 */
export interface ReviewFlags {
  lead_id: string;
  
  needs_human_review: boolean;
  
  // Why review is needed
  risk_flags: SchemaRiskFlag[];
  
  // Confidence issues
  low_confidence_areas: {
    area: string;
    confidence: number;
    reason: string;
  }[];
  
  // Suggested actions
  reviewer_checklist: string[];
  
  flagged_at: string;
}

export interface SchemaRiskFlag {
  type: 'operational' | 'financial' | 'cultural' | 'timing';
  flag: string;                   // "Founder dependency", "Hiring masking system gaps"
  severity: 'Low' | 'Medium' | 'High' | 'Critical';
  recommendation: string;         // What reviewer should do
}

/**
 * Reviewer can:
 * - Edit language
 * - Adjust recommendations
 * - Add call notes
 * - Override AI suggestions
 */
export interface ReviewerAction {
  lead_id: string;
  reviewer_id: string;
  action_type: 'approve' | 'edit' | 'override' | 'reject';
  
  changes?: {
    section: string;
    original: string;
    edited: string;
    reason: string;
  }[];
  
  notes?: string;
  actioned_at: string;
}

// ============================================================================
// 🔟 LEARNING LOOP (POST-OUTCOME)
// ============================================================================

/**
 * After calls + conversions, this retrains:
 * - Signal weights
 * - Scoring logic
 * - Recommendation confidence
 */
export interface SchemaOutcomeFeedback {
  lead_id: string;
  
  // Outcome
  converted: boolean;
  service_purchased?: string;
  deal_value?: number;
  time_to_close_days?: number;
  
  // Accuracy feedback
  accuracy_feedback: {
    readiness_accurate: boolean;
    problems_accurate: boolean;
    recommendation_accurate: boolean;
    roi_accurate: boolean;
  };
  
  // What we learned
  insights: {
    what_worked: string[];
    what_didnt_work: string[];
    unexpected_signals: string[];
  };
  
  // System adjustments
  suggested_adjustments: {
    signal: string;
    current_weight: number;
    suggested_weight: number;
    reason: string;
  }[];
  
  logged_at: string;
  logged_by: string;
}

/**
 * Learning loop updates:
 */
export interface SystemLearning {
  // Signal weight adjustments
  signal_weights: {
    [K in keyof ExtractedSignals]: number;
  };
  
  // Scoring logic refinements
  scoring_adjustments: {
    pillar: PillarType;
    adjustment_factor: number;
    based_on_outcomes: number;  // How many outcomes informed this
  }[];
  
  // Recommendation confidence
  recommendation_accuracy: {
    service: string;
    recommended_count: number;
    conversion_rate: number;
    avg_deal_value: number;
  }[];
  
  // Overall metrics
  system_metrics: {
    total_diagnostics: number;
    conversion_rate: number;
    avg_confidence: number;
    accuracy_trend: 'improving' | 'stable' | 'declining';
  };
  
  last_updated: string;
}

// ============================================================================
// COMPLETE DIAGNOSTIC OBJECT (ALL STAGES)
// ============================================================================

/**
 * The complete diagnostic object as it moves through the pipeline
 */
export interface CompleteDiagnosticObject {
  // Stage 1: Raw intake
  intake: DiagnosticIntake;
  
  // Stage 2: Pre-processing
  preprocessed: PreProcessedAnswer[];
  
  // Stage 3: Pillar scoring
  pillar_scores: PillarScoringResult;
  
  // Stage 4: Problem synthesis
  problems: ProblemSynthesisResult;
  
  // Stage 5: Readiness classification
  readiness: ReadinessClassification;
  
  // Stage 6: Service matching
  recommendation: SchemaServiceRecommendation;
  
  // Stage 7: ROI estimation
  roi: ROIEstimation;
  
  // Stage 8: Report generation
  report: SchemaClientReportData;
  
  // Stage 9: Review flags
  review: ReviewFlags;
  
  // Stage 10: Outcome (after conversion/disqualification)
  outcome?: SchemaOutcomeFeedback;
  
  // Metadata
  processing_metadata: {
    started_at: string;
    completed_at: string;
    processing_time_ms: number;
    ai_model_used: string;
    prompt_version: string;
  };
}

// ============================================================================
// DATABASE SCHEMA GUIDANCE
// ============================================================================

/**
 * RECOMMENDED DATABASE TABLES:
 * 
 * 1. diagnostic_intakes
 *    - Stores raw intake data (metadata + answers)
 *    - One row per submission
 * 
 * 2. diagnostic_preprocessing
 *    - Stores preprocessed answers + signals
 *    - Links to intake via lead_id
 * 
 * 3. diagnostic_scoring
 *    - Stores pillar scores
 *    - Links to intake via lead_id
 * 
 * 4. diagnostic_problems
 *    - Stores synthesized problems
 *    - Links to intake via lead_id
 * 
 * 5. diagnostic_readiness
 *    - Stores readiness classification
 *    - Links to intake via lead_id
 * 
 * 6. diagnostic_recommendations
 *    - Stores service recommendations
 *    - Links to intake via lead_id
 * 
 * 7. diagnostic_roi
 *    - Stores ROI estimations
 *    - Links to intake via lead_id
 * 
 * 8. diagnostic_reports
 *    - Stores client-facing report data
 *    - Links to intake via lead_id
 *    - Editable before sending
 * 
 * 9. diagnostic_reviews
 *    - Stores review flags and actions
 *    - Links to intake via lead_id
 * 
 * 10. diagnostic_outcomes
 *     - Stores post-call outcomes
 *     - Links to intake via lead_id
 *     - Used for learning loop
 * 
 * 11. system_learning
 *     - Stores system-wide learning metrics
 *     - Signal weights, scoring adjustments
 *     - Updated periodically based on outcomes
 */

/**
 * ONE-LINE SUMMARY:
 * 
 * This schema turns free-text founder answers into structured operational 
 * intelligence — without becoming a CRM or SaaS.
 */
