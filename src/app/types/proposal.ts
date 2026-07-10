/**
 * DIAGNOSTIC PROPOSAL STRUCTURE
 * 
 * Sent within 24 hours of the readiness call.
 * 
 * LENGTH: 3-5 pages max
 * FORMAT: PDF or secure link
 * TONE: Clean, calm, executive
 * 
 * PURPOSE:
 * ✔ Confirm understanding
 * ✔ Reduce risk
 * ✔ Define scope
 * ✔ Anchor value
 * ✔ Close cleanly
 */

export interface DiagnosticProposal {
  // Metadata
  proposal_id: string;
  lead_id: string;
  company_name: string;
  generated_date: string;
  sent_date?: string;
  status: 'draft' | 'sent' | 'viewed' | 'accepted' | 'rejected';
  
  // Structure
  cover: ProposalCover;
  executive_summary: ExecutiveSummary;
  confirmed_diagnosis: ConfirmedDiagnosis;
  recommended_step: RecommendedFirstStep;
  deliverables: Deliverables;
  timeline: Timeline;
  investment: Investment;
  next_steps: NextSteps;
  future_path?: FuturePath;  // Optional
  
  // Tracking
  viewed_at?: string;
  accepted_at?: string;
  accepted_by?: string;
}

// ============================================================================
// 1️⃣ COVER PAGE
// ============================================================================

export interface ProposalCover {
  company_name: string;
  date: string;
  title: string;  // "AI Readiness & Operations Diagnostic Proposal"
  subtitle: string;  // "Prepared based on your readiness assessment and follow-up discussion."
  prepared_by?: string;
  prepared_for?: string;
}

// ============================================================================
// 2️⃣ EXECUTIVE SUMMARY (½ PAGE)
// ============================================================================

/**
 * Purpose: Make them feel heard
 * 
 * Structure: 3 short paragraphs max
 */
export interface ExecutiveSummary {
  paragraphs: string[];  // Max 3
  
  // Example:
  // [
  //   "Based on our readiness assessment and conversation, your business is experiencing operational strain driven by manual execution, fragmented systems, and approval bottlenecks.",
  //   "These issues are not caused by lack of effort or talent — they are system problems that compound as you scale.",
  //   "This proposal outlines a structured diagnostic phase to confirm priorities, quantify ROI, and define a safe execution path."
  // ]
}

// ============================================================================
// 3️⃣ CONFIRMED DIAGNOSIS (1 PAGE)
// ============================================================================

/**
 * Purpose: Reinforce trust
 * 
 * Section Title: "What We Confirmed Together"
 * 
 * List 3-4 problems only
 */
export interface ConfirmedDiagnosis {
  section_title: string;  // "What We Confirmed Together"
  problems: ConfirmedProblem[];  // 3-4 max
}

export interface ConfirmedProblem {
  title: string;  // "Manual Follow-Up Leakage"
  description: string;  // Short description
  why_exists: string;  // Why it exists
  cost: string;  // What it's costing them
}

// ============================================================================
// 4️⃣ RECOMMENDED FIRST STEP (CORE OFFER)
// ============================================================================

/**
 * Purpose: Sell one thing only
 * 
 * Title: "AI Readiness & ROI Audit"
 */
export interface RecommendedFirstStep {
  service_name: string;  // "AI Readiness & ROI Audit"
  
  what_it_does: string;  // Brief explanation
  what_it_does_not: string[];  // Clear boundaries
  
  timeline: string;  // "2 weeks"
  
  includes: string[];  // What's included (5-7 items)
  does_not_include: string[];  // What's NOT included (3-4 items)
}

/**
 * Example includes:
 * - Deep workflow analysis
 * - AI opportunity mapping
 * - ROI estimation (time, cost, revenue)
 * - Risk & governance review
 * - 90-day execution roadmap
 * 
 * Example does NOT include:
 * - Tool implementation
 * - Automation builds
 * - Long-term commitments
 * 
 * This lowers resistance.
 */

// ============================================================================
// 5️⃣ DELIVERABLES (CLEAR & FINITE)
// ============================================================================

/**
 * Purpose: Remove scope anxiety
 */
export interface Deliverables {
  items: DeliverableItem[];
}

export interface DeliverableItem {
  name: string;  // "Written audit report"
  description: string;  // Brief description
  format?: string;  // "PDF", "Presentation", etc.
}

/**
 * Example deliverables:
 * - Written audit report
 * - Prioritized opportunity list
 * - ROI ranges (conservative & aggressive)
 * - Recommended execution sequence
 * - Optional next-phase paths
 * 
 * Nothing vague.
 */

// ============================================================================
// 6️⃣ TIMELINE
// ============================================================================

/**
 * Purpose: Signal speed without chaos
 */
export interface Timeline {
  phases: TimelinePhase[];
  total_duration: string;  // "2 weeks"
}

export interface TimelinePhase {
  phase: string;  // "Week 1", "Week 2"
  activities: string[];  // ["Data review", "Interviews", "Analysis"]
  duration?: string;
}

/**
 * Example:
 * - Week 1: Data review + interviews
 * - Week 2: Analysis + roadmap
 * - Delivery: End of Week 2
 * 
 * Short timelines increase trust.
 */

// ============================================================================
// 7️⃣ INVESTMENT (PRICE ANCHORED, CLEAN)
// ============================================================================

/**
 * Purpose: Close without negotiation
 */
export interface Investment {
  amount: number;  // Dollar amount
  currency: string;  // "USD"
  
  structure: 'fixed' | 'range';
  range_low?: number;  // If range
  range_high?: number;  // If range
  
  payment_terms: string;  // "One-time fee", "50% upfront, 50% on delivery"
  
  includes_note: string;  // "No hidden costs"
  credit_to_next_phase?: boolean;  // Powerful incentive
  credit_amount?: number;
  
  reassurance: string;  // "This diagnostic ensures we only recommend what creates measurable value."
}

/**
 * Format example:
 * 
 * Investment: $4,500 (fixed)
 * 
 * - One-time fee
 * - No hidden costs
 * - Full credit applies to next phase if approved within 30 days
 * 
 * This diagnostic ensures we only recommend what creates measurable value.
 */

// ============================================================================
// 8️⃣ NEXT STEPS (LOW FRICTION)
// ============================================================================

/**
 * Purpose: Make yes easy
 */
export interface NextSteps {
  steps: string[];  // Checklist format
  cta_text: string;  // "Approve & Start Audit"
  cta_url?: string;  // Link to approval page
}

/**
 * Example checklist:
 * 1. Approve proposal
 * 2. Pay invoice
 * 3. Schedule kickoff
 * 
 * Button: "Approve & Start Audit"
 */

// ============================================================================
// 9️⃣ FUTURE PATH (OPTIONAL - NOT A COMMITMENT)
// ============================================================================

/**
 * Purpose: Seed expansion without pressure
 */
export interface FuturePath {
  section_title: string;  // "What This Unlocks Next"
  note: string;  // "No commitment required - just possibilities"
  
  future_services: FutureService[];  // 3-5 items
}

export interface FutureService {
  name: string;  // "AI Transformation"
  brief_description: string;  // 1 sentence
  typical_timeline?: string;  // "30-90 days"
  // NO PRICING HERE. Just possibility.
}

/**
 * Example future services:
 * - AI Transformation Assessment
 * - AI Systems Build
 * - AI Agents Implementation
 * - AI Growth Systems
 * 
 * No pricing here. Just possibility.
 * Seeds the idea of continued engagement.
 */

// ============================================================================
// 🚫 WHAT THIS PROPOSAL NEVER DOES
// ============================================================================

export const PROPOSAL_NEVER_INCLUDES = [
  "Lists of tools or technologies",
  "Technical architecture diagrams",
  "Promises of guaranteed results",
  "Feature overload or complexity",
  "Consulting fluff or jargon",
  "Long-term commitments required",
  "Vague deliverables or timelines",
  "Hidden costs or surprise fees"
];

// ============================================================================
// ✅ WHY THIS CLOSES
// ============================================================================

export const WHY_THIS_WORKS = [
  "You sell diagnosis, not labor",
  "You reduce risk before asking for trust",
  "You avoid scope creep",
  "You filter unserious buyers",
  "You set the tone for premium delivery",
  "Short timeline signals confidence",
  "Clear scope removes anxiety",
  "Credit to next phase removes risk"
];

// ============================================================================
// PROPOSAL TEMPLATES
// ============================================================================

/**
 * Standard audit proposal template
 */
export const STANDARD_AUDIT_PROPOSAL: Partial<DiagnosticProposal> = {
  cover: {
    company_name: "{{COMPANY_NAME}}",
    date: "{{DATE}}",
    title: "AI Readiness & Operations Diagnostic Proposal",
    subtitle: "Prepared based on your readiness assessment and follow-up discussion."
  },
  
  recommended_step: {
    service_name: "AI Readiness & ROI Audit",
    what_it_does: "A structured diagnostic to confirm priorities, quantify ROI, and define a safe execution path before any implementation.",
    what_it_does_not: [
      "Tool implementation",
      "Automation builds",
      "Long-term commitments"
    ],
    timeline: "2 weeks",
    includes: [
      "Deep workflow analysis across Operations, Revenue, Systems, and AI Readiness",
      "AI opportunity mapping (what to automate, what not to)",
      "ROI estimation with conservative and aggressive ranges",
      "Risk & governance review",
      "90-day execution roadmap with phased approach",
      "Team alignment session to present findings"
    ],
    does_not_include: [
      "Tool implementation or software builds",
      "Ongoing managed services",
      "Custom development",
      "Long-term retainer commitments"
    ]
  },
  
  timeline: {
    phases: [
      {
        phase: "Week 1",
        activities: [
          "Data collection and workflow review",
          "Stakeholder interviews (3-5 key people)",
          "Initial analysis and pattern detection"
        ]
      },
      {
        phase: "Week 2",
        activities: [
          "ROI modeling and opportunity prioritization",
          "Roadmap creation and risk assessment",
          "Report writing and presentation preparation"
        ]
      },
      {
        phase: "Delivery",
        activities: [
          "Complete audit report delivered (PDF)",
          "90-minute presentation and Q&A",
          "Optional next-phase recommendations"
        ]
      }
    ],
    total_duration: "2 weeks"
  },
  
  deliverables: {
    items: [
      {
        name: "Written Audit Report",
        description: "Complete analysis of current state, opportunities, and recommendations",
        format: "PDF (20-30 pages)"
      },
      {
        name: "Prioritized Opportunity List",
        description: "Ranked list of automation and AI opportunities with effort vs. impact scores"
      },
      {
        name: "ROI Estimates",
        description: "Conservative and aggressive ROI ranges for top opportunities"
      },
      {
        name: "90-Day Execution Roadmap",
        description: "Phased implementation plan with clear milestones and dependencies"
      },
      {
        name: "Presentation & Q&A",
        description: "90-minute session to walk through findings and answer questions"
      }
    ]
  }
};

// ============================================================================
// PROPOSAL GENERATION
// ============================================================================

/**
 * Generate a complete proposal from Cortex lead data
 */
export function generateProposal(leadData: {
  lead_id: string;
  company_name: string;
  top_problems: ConfirmedProblem[];
  readiness_level: string;
  primary_pain_signal: string;
  call_notes?: string;
}): DiagnosticProposal {
  const today = new Date().toISOString();
  
  return {
    proposal_id: `prop_${Date.now()}`,
    lead_id: leadData.lead_id,
    company_name: leadData.company_name,
    generated_date: today,
    status: 'draft',
    
    cover: {
      company_name: leadData.company_name,
      date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      title: "AI Readiness & Operations Diagnostic Proposal",
      subtitle: "Prepared based on your readiness assessment and follow-up discussion."
    },
    
    executive_summary: {
      paragraphs: [
        `Based on our readiness assessment and conversation, ${leadData.company_name} is experiencing operational strain driven by manual execution, fragmented systems, and process bottlenecks.`,
        "These issues are not caused by lack of effort or talent — they are system problems that compound as you scale.",
        "This proposal outlines a structured diagnostic phase to confirm priorities, quantify ROI, and define a safe execution path."
      ]
    },
    
    confirmed_diagnosis: {
      section_title: "What We Confirmed Together",
      problems: leadData.top_problems.slice(0, 4)  // Max 4
    },
    
    recommended_step: STANDARD_AUDIT_PROPOSAL.recommended_step!,
    timeline: STANDARD_AUDIT_PROPOSAL.timeline!,
    deliverables: STANDARD_AUDIT_PROPOSAL.deliverables!,
    
    investment: {
      amount: 4500,
      currency: "USD",
      structure: 'fixed',
      payment_terms: "One-time fee, payable upon acceptance",
      includes_note: "No hidden costs. No long-term commitments.",
      credit_to_next_phase: true,
      credit_amount: 4500,
      reassurance: "This diagnostic ensures we only recommend what creates measurable value. If we proceed to implementation, the full audit fee is credited to your first build phase."
    },
    
    next_steps: {
      steps: [
        "Review and approve this proposal",
        "Complete payment (invoice sent upon approval)",
        "Schedule kickoff call (within 48 hours)",
        "Begin Week 1 data collection"
      ],
      cta_text: "Approve & Start Audit",
      cta_url: `/proposals/${leadData.lead_id}/approve`
    },
    
    future_path: {
      section_title: "What This Unlocks Next",
      note: "No commitment required — these are possibilities based on audit findings",
      future_services: [
        {
          name: "AI Transformation Sprint",
          brief_description: "30-day focused implementation of highest-ROI opportunity identified in audit",
          typical_timeline: "30 days"
        },
        {
          name: "Systems Integration & Automation",
          brief_description: "Connect fragmented tools and automate manual workflows",
          typical_timeline: "60-90 days"
        },
        {
          name: "AI Agent Implementation",
          brief_description: "Deploy AI agents for customer service, sales follow-up, or operations",
          typical_timeline: "60 days"
        },
        {
          name: "Ongoing Optimization Retainer",
          brief_description: "Monthly optimization and expansion based on results",
          typical_timeline: "Ongoing"
        }
      ]
    }
  };
}

/**
 * ONE-LINE SUMMARY:
 * 
 * This proposal turns clarity into commitment — without pressure, hype, or complexity.
 */
