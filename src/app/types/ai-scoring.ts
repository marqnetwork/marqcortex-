/**
 * AI SCORING SYSTEM - TYPE DEFINITIONS
 * 
 * This file defines the data structure for AI analysis of diagnostic submissions.
 * 
 * BACKEND IMPLEMENTATION NOTES:
 * When implementing the real backend with GPT/Claude APIs:
 * 1. Send the full submission (all answers) to the AI
 * 2. Ask the AI to analyze based on the scoring rubrics defined here
 * 3. Return a response matching the AIAnalysis interface
 * 4. Store the analysis in your database linked to the submission
 */

// Individual question analysis
export interface QuestionAnalysis {
  questionId: number;
  category: string;
  question: string;
  answer: string;
  
  // AI-generated insights for this specific answer
  keyInsights: string[];           // 2-4 key takeaways from this answer
  painPoints: string[];            // Specific problems identified
  opportunityAreas: string[];      // Areas for improvement/automation
  
  // Scoring (0-10 scale)
  maturityScore: number;           // How mature/sophisticated is their current state?
  urgencyScore: number;            // How urgent is this problem? (based on pain expressed)
  aiReadinessScore: number;        // How ready are they for AI/automation here?
}

// Overall submission analysis
export interface AIAnalysis {
  submissionId: string;
  industry: string;
  companyName: string;
  analyzedAt: string;              // ISO timestamp
  
  // Question-by-question analysis
  questionAnalyses: QuestionAnalysis[];
  
  // Overall scores (0-100 scale)
  overallScores: {
    maturityScore: number;         // Average across all questions
    urgencyScore: number;          // Average urgency
    aiReadinessScore: number;      // Overall readiness for AI transformation
    impactPotential: number;       // Potential business impact of transformation
  };
  
  // Category-level insights
  categoryInsights: {
    categoryName: string;
    averageMaturityScore: number;
    keyFindings: string[];         // 2-3 key findings for this category
    topOpportunities: string[];    // Top 2-3 opportunities in this category
  }[];
  
  // Executive summary
  executiveSummary: {
    currentState: string;          // 2-3 sentence summary of where they are today
    biggestPainPoints: string[];   // Top 3-5 pain points identified
    quickWins: string[];           // Top 3-5 quick wins (high impact, low effort)
    strategicOpportunities: string[]; // Top 3-5 strategic transformation opportunities
    estimatedImpact: string;       // Narrative about potential business impact
  };
  
  // Readiness assessment
  readinessAssessment: {
    readinessLevel: 'Low' | 'Medium' | 'High' | 'Very High';
    readinessFactors: {
      factor: string;              // e.g., "Technical Infrastructure"
      status: 'Blocker' | 'Challenge' | 'Ready' | 'Advantage';
      description: string;
    }[];
    recommendedApproach: string;   // "Quick wins first" vs "Strategic transformation" etc.
    estimatedTimeframe: string;    // "3-6 months" etc.
  };
  
  // Priorities and roadmap
  recommendedPriorities: {
    priority: number;              // 1, 2, 3, etc.
    area: string;                  // e.g., "Customer Support Automation"
    rationale: string;             // Why this priority?
    estimatedImpact: 'Low' | 'Medium' | 'High' | 'Very High';
    estimatedEffort: 'Low' | 'Medium' | 'High' | 'Very High';
    quickWin: boolean;             // Is this a quick win?
  }[];
  
  // Risk flags
  riskFlags: {
    riskType: 'Critical' | 'High' | 'Medium' | 'Low';
    area: string;
    description: string;
    mitigation: string;
  }[];
}

/**
 * BACKEND AI PROMPT GUIDANCE
 * 
 * When calling GPT/Claude API, use a prompt structure like:
 * 
 * """
 * You are an AI operations consultant analyzing a business diagnostic questionnaire.
 * 
 * INDUSTRY: {industry}
 * COMPANY: {companyName}
 * 
 * DIAGNOSTIC RESPONSES:
 * {all question/answer pairs}
 * 
 * Analyze this submission and provide:
 * 
 * 1. QUESTION-BY-QUESTION ANALYSIS
 *    For each answer, identify:
 *    - Key insights (what does this tell us?)
 *    - Pain points (what problems exist?)
 *    - Opportunity areas (where can AI/automation help?)
 *    - Maturity score (0-10: How sophisticated is their current state?)
 *    - Urgency score (0-10: How urgent is this problem based on the pain expressed?)
 *    - AI readiness score (0-10: How ready are they for automation here?)
 * 
 * 2. OVERALL ASSESSMENT
 *    - Current state summary
 *    - Top 3-5 biggest pain points
 *    - Top 3-5 quick wins (high impact, low effort)
 *    - Top 3-5 strategic opportunities
 *    - Estimated business impact
 * 
 * 3. READINESS ASSESSMENT
 *    - Overall readiness level (Low/Medium/High/Very High)
 *    - Factors affecting readiness (blockers, challenges, advantages)
 *    - Recommended approach
 *    - Estimated timeframe
 * 
 * 4. PRIORITIZED ROADMAP
 *    Rank opportunities by:
 *    - Business impact potential
 *    - Implementation effort
 *    - Quick win potential
 * 
 * 5. RISK FLAGS
 *    Identify any critical risks or concerns
 * 
 * Return as JSON matching the AIAnalysis interface.
 * """
 */

// Scoring rubrics for reference (to guide AI analysis)
export const SCORING_RUBRICS = {
  maturity: {
    '0-2': 'Ad-hoc / Manual / No processes',
    '3-4': 'Basic processes / Spreadsheet-based / Reactive',
    '5-6': 'Defined processes / Some tools / Semi-automated',
    '7-8': 'Optimized processes / Integrated systems / Proactive',
    '9-10': 'Best-in-class / AI-enabled / Continuously improving'
  },
  urgency: {
    '0-2': 'Minor inconvenience / Low priority',
    '3-4': 'Noticeable pain / Should address',
    '5-6': 'Significant pain / Actively seeking solutions',
    '7-8': 'Critical pain / Urgent need / Blocking growth',
    '9-10': 'Crisis level / Existential threat / Immediate action required'
  },
  aiReadiness: {
    '0-2': 'Not ready / Major blockers / High resistance',
    '3-4': 'Low readiness / Significant challenges / Limited tech capacity',
    '5-6': 'Moderate readiness / Some infrastructure / Open to change',
    '7-8': 'Good readiness / Systems in place / Previous automation success',
    '9-10': 'Very ready / Strong tech foundation / AI-native culture'
  },
  impactPotential: {
    '0-20': 'Minimal impact / Limited opportunity',
    '21-40': 'Low impact / Incremental improvements',
    '41-60': 'Moderate impact / Meaningful improvements',
    '61-80': 'High impact / Significant transformation',
    '81-100': 'Very high impact / Game-changing transformation'
  }
};

// Helper function to determine readiness level from score
export const getReadinessLevel = (score: number): 'Low' | 'Medium' | 'High' | 'Very High' => {
  if (score >= 75) return 'Very High';
  if (score >= 60) return 'High';
  if (score >= 40) return 'Medium';
  return 'Low';
};

// Helper function to get color coding for scores
export const getScoreColor = (score: number): string => {
  if (score >= 75) return '#10B981'; // Green
  if (score >= 60) return '#3B82F6'; // Blue
  if (score >= 40) return '#FB923C'; // Orange
  return '#FD4438'; // Red
};
