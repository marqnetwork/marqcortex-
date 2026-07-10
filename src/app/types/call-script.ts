/**
 * READINESS CALL SCRIPT
 * 
 * This is the EXACT conversation framework for the 45-60 minute readiness call.
 * 
 * PURPOSE: Validate reality and reduce risk (NOT to sell AI)
 * 
 * RULES (NON-NEGOTIABLE):
 * ❌ Do not demo tools
 * ❌ Do not promise solutions
 * ❌ Do not quote final pricing early
 * ❌ Do not overload with AI talk
 * 
 * YOUR ONLY JOB: Validate reality and reduce risk.
 */

export interface ReadinessCallScript {
  lead_id: string;
  company_name: string;
  
  // Call structure (45-60 minutes)
  structure: {
    frame_call: CallSection;          // 5 min
    validate_diagnosis: CallSection;  // 15 min
    pressure_test_impact: CallSection; // 15 min
    qualify_fit: CallSection;         // 5 min
    present_path: CallSection;        // 5 min
    price_anchor: CallSection;        // 5 min
    close_or_exit: CallSection;       // 5 min
  };
  
  // Pre-populated from Cortex analysis
  client_context: {
    top_3_problems: string[];
    readiness_level: string;
    primary_pain_signal: string;
    urgency_score: number;
  };
}

export interface CallSection {
  section: string;
  duration_minutes: number;
  goal: string;
  script: CallScriptElement[];
  key_questions: string[];
  success_signals: string[];
  red_flags: string[];
}

export interface CallScriptElement {
  type: 'say' | 'ask' | 'listen' | 'note' | 'pause';
  content: string;
  timing?: string;
  rationale?: string;
}

// ============================================================================
// 1️⃣ OPENING FRAME (5 MIN)
// ============================================================================

export const OPENING_FRAME: CallSection = {
  section: "Opening Frame",
  duration_minutes: 5,
  goal: "Control expectations + establish authority",
  
  script: [
    {
      type: 'say',
      content: "This call is not a sales pitch.",
      rationale: "Set expectations immediately"
    },
    {
      type: 'say',
      content: "It's to validate what your readiness report surfaced, confirm what's actually costing you time or money, and decide if there's a real fit.",
      rationale: "Frame as diagnostic, not sales"
    },
    {
      type: 'say',
      content: "If there isn't a fit, I'll tell you.",
      rationale: "Build trust through honesty"
    },
    {
      type: 'ask',
      content: "Does that work for you?",
      rationale: "Get early agreement on format"
    },
    {
      type: 'pause',
      content: "Wait for confirmation",
      timing: "3-5 seconds"
    },
    {
      type: 'note',
      content: "If they hesitate, they're not qualified.",
      rationale: "Early disqualification signal"
    }
  ],
  
  key_questions: [
    "Does that work for you?"
  ],
  
  success_signals: [
    "They immediately agree",
    "They say 'that sounds good'",
    "They seem relieved (not defensive)"
  ],
  
  red_flags: [
    "They want to jump straight to pricing",
    "They ask 'what can you do for us?'",
    "They seem distracted or rushed"
  ]
};

// ============================================================================
// 2️⃣ VALIDATE THE DIAGNOSIS (15 MIN)
// ============================================================================

export const VALIDATE_DIAGNOSIS: CallSection = {
  section: "Validate the Diagnosis",
  duration_minutes: 15,
  goal: "Make them say 'yes, that's us'",
  
  script: [
    {
      type: 'note',
      content: "Use the report. Don't read it. Reference it.",
      rationale: "You should have already read it thoroughly"
    },
    {
      type: 'say',
      content: "You mentioned that [INSERT THEIR EXACT WORDS FROM DIAGNOSTIC].",
      rationale: "Start with their language, not yours"
    },
    {
      type: 'ask',
      content: "Where does that hurt the most day-to-day?",
      rationale: "Get specific, current pain"
    },
    {
      type: 'pause',
      content: "Let them talk. Don't interrupt.",
      timing: "As long as they need"
    },
    {
      type: 'say',
      content: "The report identified [PROBLEM 1] as a core issue.",
      rationale: "Reference diagnosis, don't re-explain"
    },
    {
      type: 'ask',
      content: "Is this accurate?",
      rationale: "Simple validation question"
    },
    {
      type: 'ask',
      content: "What happens if this stays broken for the next 6 months?",
      rationale: "Future-pace the consequence"
    },
    {
      type: 'note',
      content: "Repeat for problems 2 and 3 (max 3 total)",
      rationale: "Don't overwhelm with 4+ problems"
    }
  ],
  
  key_questions: [
    "Where does that hurt the most day-to-day?",
    "Is this accurate?",
    "What happens if this stays broken for the next 6 months?",
    "Who on your team feels this pain the most?",
    "Have you tried to fix this before? What happened?"
  ],
  
  success_signals: [
    "They say 'yes, that's exactly it'",
    "They provide specific examples unprompted",
    "They show emotional response (frustration, fatigue)",
    "They mention financial consequences",
    "They say 'how did you know that?'"
  ],
  
  red_flags: [
    "They minimize the pain",
    "They say 'it's not that bad'",
    "They can't give specific examples",
    "They keep pivoting to other topics",
    "They're defensive about current state"
  ]
};

// ============================================================================
// 3️⃣ PRESSURE-TEST THE IMPACT (15 MIN)
// ============================================================================

export const PRESSURE_TEST_IMPACT: CallSection = {
  section: "Pressure-Test the Impact",
  duration_minutes: 15,
  goal: "Turn pain into consequence",
  
  script: [
    {
      type: 'note',
      content: "Ask ONLY impact questions. No solutions yet.",
      rationale: "Deepen the pain before offering relief"
    },
    {
      type: 'ask',
      content: "How many hours per week does this eat?",
      rationale: "Quantify time waste"
    },
    {
      type: 'ask',
      content: "Who feels this pain the most?",
      rationale: "Identify human cost"
    },
    {
      type: 'ask',
      content: "What breaks when volume increases?",
      rationale: "Test scale readiness"
    },
    {
      type: 'ask',
      content: "What happens if one key person is unavailable?",
      rationale: "Test dependency risk"
    },
    {
      type: 'say',
      content: "So the issue isn't growth — it's that growth is stressing the system.",
      rationale: "Reframe: problem is leverage, not revenue"
    },
    {
      type: 'pause',
      content: "Let them agree.",
      timing: "Wait for verbal confirmation"
    }
  ],
  
  key_questions: [
    "How many hours per week does this eat?",
    "Who feels this pain the most?",
    "What breaks when volume increases?",
    "What happens if one key person is unavailable?",
    "What's the cost if this continues for another quarter?",
    "Is this getting better or worse?"
  ],
  
  success_signals: [
    "They provide specific numbers (hours, dollars)",
    "They mention burnout or team frustration",
    "They admit 'it's getting worse'",
    "They say 'we can't keep doing this'",
    "They connect problem to revenue/growth impact"
  ],
  
  red_flags: [
    "They can't quantify impact",
    "They say 'we're managing'",
    "They blame external factors only",
    "They avoid answering direct questions",
    "They claim 'hiring will fix it'"
  ]
};

// ============================================================================
// 4️⃣ QUALIFY FIT (HARD GATE) (5 MIN)
// ============================================================================

export const QUALIFY_FIT: CallSection = {
  section: "Qualify Fit (Hard Gate)",
  duration_minutes: 5,
  goal: "Protect your time and positioning",
  
  script: [
    {
      type: 'note',
      content: "This is the HARD GATE. Ask directly.",
      rationale: "No soft language here"
    },
    {
      type: 'ask',
      content: "If we could remove these bottlenecks without adding headcount, is that something you're prepared to invest in?",
      rationale: "Test budget readiness"
    },
    {
      type: 'pause',
      content: "Wait. Do not fill the silence.",
      timing: "5+ seconds if needed"
    },
    {
      type: 'note',
      content: "If yes → continue. If vague → slow down.",
      rationale: "Vague = not ready"
    },
    {
      type: 'ask',
      content: "Are you looking for clarity first, or are you trying to build immediately?",
      rationale: "Determines audit vs. build path"
    },
    {
      type: 'note',
      content: "This decides: Audit path OR direct build (rare)",
      rationale: "Most should choose audit"
    }
  ],
  
  key_questions: [
    "If we could remove these bottlenecks without adding headcount, is that something you're prepared to invest in?",
    "Are you looking for clarity first, or are you trying to build immediately?",
    "What's your timeline for addressing this?",
    "Who else needs to be involved in this decision?",
    "What happens if you do nothing?"
  ],
  
  success_signals: [
    "They say 'yes' without hesitation",
    "They mention a budget or range",
    "They say 'clarity first'",
    "They ask 'what would that look like?'",
    "They're the decision maker"
  ],
  
  red_flags: [
    "They say 'maybe' or 'probably'",
    "They need to 'check with someone'",
    "They ask 'what's the cheapest option?'",
    "They want free consulting",
    "They're shopping for quotes"
  ]
};

// ============================================================================
// 5️⃣ PRESENT THE PATH (NOT THE SOLUTION) (5 MIN)
// ============================================================================

export const PRESENT_PATH: CallSection = {
  section: "Present the Path",
  duration_minutes: 5,
  goal: "Sell the first step only",
  
  script: [
    {
      type: 'say',
      content: "Based on what we discussed, the right next step is not building anything yet.",
      rationale: "Defy expectations (builds trust)"
    },
    {
      type: 'say',
      content: "It's validating priorities and ROI through a structured AI Readiness & ROI Audit.",
      rationale: "Name the service"
    },
    {
      type: 'say',
      content: "Here's what it does: [BRIEF EXPLANATION]",
      rationale: "Keep it to 2-3 sentences"
    },
    {
      type: 'say',
      content: "Here's what it does NOT do: [BRIEF EXPLANATION]",
      rationale: "Set boundaries (builds trust)"
    },
    {
      type: 'say',
      content: "Timeline is [X DAYS]. Outcome is [SPECIFIC DELIVERABLE].",
      rationale: "Concrete expectations"
    },
    {
      type: 'note',
      content: "No features. No tools. Just outcomes.",
      rationale: "Stay executive-level"
    }
  ],
  
  key_questions: [
    "Does that approach make sense?",
    "What questions do you have about the audit process?"
  ],
  
  success_signals: [
    "They say 'that makes sense'",
    "They ask clarifying questions (not objections)",
    "They say 'what's the next step?'",
    "They appreciate the 'clarity first' approach"
  ],
  
  red_flags: [
    "They want to skip to building",
    "They ask 'why can't you just tell us now?'",
    "They're focused on features/tools",
    "They want a free version"
  ]
};

// ============================================================================
// 6️⃣ PRICE ANCHOR (CONTROLLED) (5 MIN)
// ============================================================================

export const PRICE_ANCHOR: CallSection = {
  section: "Price Anchor (Controlled)",
  duration_minutes: 5,
  goal: "Remove sticker shock without negotiating",
  
  script: [
    {
      type: 'say',
      content: "That audit typically sits in the low-to-mid four-figure range, depending on complexity.",
      rationale: "Anchor without exact number"
    },
    {
      type: 'say',
      content: "If it confirms what we think, it gives you a clear execution roadmap.",
      rationale: "Frame as investment in clarity"
    },
    {
      type: 'pause',
      content: "Then stop talking. Silence closes.",
      timing: "5-10 seconds minimum",
      rationale: "Who speaks first loses"
    }
  ],
  
  key_questions: [
    // NO questions. Just anchor and pause.
  ],
  
  success_signals: [
    "They don't flinch",
    "They say 'that's reasonable'",
    "They ask about next steps (not price)",
    "They say 'send me the details'"
  ],
  
  red_flags: [
    "They immediately negotiate",
    "They say 'we need to think about it'",
    "They ask for a discount",
    "They compare to other quotes",
    "They reveal budget is lower"
  ]
};

// ============================================================================
// 7️⃣ CLOSE OR EXIT CLEANLY (5 MIN)
// ============================================================================

export const CLOSE_OR_EXIT: CallSection = {
  section: "Close or Exit Cleanly",
  duration_minutes: 5,
  goal: "Get commitment or preserve brand",
  
  script: [
    {
      type: 'note',
      content: "If YES:",
      rationale: "They're ready to proceed"
    },
    {
      type: 'say',
      content: "I'll send a short diagnostic proposal within 24 hours.",
      rationale: "Set clear timeline"
    },
    {
      type: 'say',
      content: "If it makes sense, we proceed. If not, no pressure.",
      rationale: "Low-pressure close"
    },
    {
      type: 'note',
      content: "If NO:",
      rationale: "They're not ready"
    },
    {
      type: 'say',
      content: "That's completely fine.",
      rationale: "No guilt, no desperation"
    },
    {
      type: 'say',
      content: "You at least leave with clarity — which most teams don't have.",
      rationale: "Preserve value of call"
    },
    {
      type: 'note',
      content: "This preserves brand.",
      rationale: "They'll remember you positively"
    }
  ],
  
  key_questions: [
    "Should I send that proposal?",
    "Is there anything else you need from me?"
  ],
  
  success_signals: [
    "Clear yes or clear no (not 'maybe')",
    "They thank you for the clarity",
    "They say 'send it over'",
    "They ask when they can expect it"
  ],
  
  red_flags: [
    "They say 'let us think about it'",
    "They want to 'circle back later'",
    "They ask for more free consulting",
    "They ghost after call"
  ]
};

// ============================================================================
// 🚫 WHAT YOU NEVER SAY
// ============================================================================

export const NEVER_SAY = [
  "We can build anything",
  "Our AI is very advanced",
  "We'll automate everything",
  "Let me show you a demo",
  "This will 10x your business",
  "We have the best solution",
  "Trust me, this will work",
  "Everyone's using AI now",
  "You need to do this",
  "This is a limited time offer"
];

/**
 * These are red flags to serious operators.
 * They signal desperation, hype, or lack of expertise.
 */

// ============================================================================
// ✅ SUCCESS SIGNALS (OVERALL CALL)
// ============================================================================

export const OVERALL_SUCCESS_SIGNALS = [
  "That's exactly what's happening",
  "We've tried tools, nothing stuck",
  "This feels structured",
  "What would it take to start?",
  "I appreciate the honesty",
  "This is the first time someone's actually understood our problem",
  "How soon can we get started?",
  "Send me the proposal"
];

/**
 * You know the call worked when they say any of these.
 */

// ============================================================================
// COMPLETE CALL SCRIPT TEMPLATE
// ============================================================================

export function generateCallScript(leadData: {
  lead_id: string;
  company_name: string;
  top_3_problems: string[];
  readiness_level: string;
  primary_pain_signal: string;
  urgency_score: number;
}): ReadinessCallScript {
  return {
    lead_id: leadData.lead_id,
    company_name: leadData.company_name,
    
    structure: {
      frame_call: OPENING_FRAME,
      validate_diagnosis: VALIDATE_DIAGNOSIS,
      pressure_test_impact: PRESSURE_TEST_IMPACT,
      qualify_fit: QUALIFY_FIT,
      present_path: PRESENT_PATH,
      price_anchor: PRICE_ANCHOR,
      close_or_exit: CLOSE_OR_EXIT
    },
    
    client_context: {
      top_3_problems: leadData.top_3_problems,
      readiness_level: leadData.readiness_level,
      primary_pain_signal: leadData.primary_pain_signal,
      urgency_score: leadData.urgency_score
    }
  };
}

/**
 * ONE-LINE SUMMARY:
 * 
 * This call does not sell AI.
 * It sells clarity, control, and reduced risk.
 */
