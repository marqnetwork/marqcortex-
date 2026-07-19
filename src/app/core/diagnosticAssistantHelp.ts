/**
 * DIAGNOSTIC ASSISTANT — DETERMINISTIC CONTEXTUAL HELP
 *
 * Pure, side-effect-free logic that powers the in-diagnostic AIAssistant
 * (MQC-COMP-049). It maps the current question / progress / industry to a
 * contextual help message.
 *
 * ┌─ GOVERNANCE ───────────────────────────────────────────────────────────────┐
 * │  Core Rule: "Math decides priority. LLM only explains decisions."          │
 * │                                                                            │
 * │  This module contains NO LLM call and NO network I/O. Every message it     │
 * │  returns is produced by deterministic keyword routing over the question    │
 * │  text and a static industry table. The same inputs always yield the same   │
 * │  output. The assistant guides the user; it never scores, prices, or        │
 * │  otherwise determines any authoritative outcome.                           │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Extracted from AIAssistant.tsx (Batch 6) so the deterministic guidance can be
 * unit-tested independently of the React presentation layer.
 */

export interface AssistantMessage {
  type: 'help' | 'encouragement' | 'suggestion' | 'insight';
  content: string;
  suggestions?: string[];
}

/**
 * Deterministically generate the contextual help message for a diagnostic
 * question. Pure function — no LLM, no I/O, no randomness.
 */
export function generateContextualHelp(
  question: string,
  questionNumber: number,
  totalQuestions: number,
  industry: string,
  previousAnswers: Array<{ question: string; answer: string }> = [],
): AssistantMessage {
  // First question - welcome
  if (questionNumber === 1) {
    return {
      type: 'encouragement',
      content: `Welcome! I'm here to help you complete this assessment. Take your time and answer honestly - there are no wrong answers. ${totalQuestions} quick questions and you'll have your personalized roadmap!`,
    };
  }

  // Milestone celebrations
  if (questionNumber === Math.floor(totalQuestions / 2)) {
    return {
      type: 'encouragement',
      content: `🎉 You're halfway there! Great job so far. The insights we're gathering will help us create a truly personalized plan for you.`,
    };
  }

  if (questionNumber === totalQuestions) {
    return {
      type: 'encouragement',
      content: `🚀 Final question! You're doing amazing. Once you complete this, we'll analyze everything and create your custom readiness report.`,
    };
  }

  // Generate contextual help based on question keywords
  const lowerQuestion = question.toLowerCase();

  // Time-related questions
  if (lowerQuestion.includes('time') || lowerQuestion.includes('hours') || lowerQuestion.includes('spend')) {
    return {
      type: 'help',
      content: `Think about a typical week. Include all time spent on this task - both productive work and time wasted on manual processes.`,
      suggestions: [
        'Less than 5 hours/week',
        '5-15 hours/week',
        '15-30 hours/week',
        'More than 30 hours/week',
      ],
    };
  }

  // Process-related questions
  if (lowerQuestion.includes('process') || lowerQuestion.includes('workflow')) {
    return {
      type: 'help',
      content: `Consider your current workflow. How many manual steps are involved? How often do things get stuck or require intervention?`,
      suggestions: [
        'Mostly manual with frequent delays',
        'Some automation but still requires oversight',
        'Fairly automated but could improve',
        'Fully automated and efficient',
      ],
    };
  }

  // Team-related questions
  if (lowerQuestion.includes('team') || lowerQuestion.includes('people') || lowerQuestion.includes('employees')) {
    return {
      type: 'help',
      content: `Think about everyone involved in this process, including indirect time like coordination, communication, and handoffs.`,
      suggestions: [
        '1-2 people',
        '3-5 people',
        '6-10 people',
        'More than 10 people',
      ],
    };
  }

  // Cost/budget questions
  if (lowerQuestion.includes('cost') || lowerQuestion.includes('budget') || lowerQuestion.includes('spend')) {
    return {
      type: 'help',
      content: `Consider both direct costs (software, services) and indirect costs (employee time, lost opportunities).`,
      suggestions: [
        'Less than $1,000/month',
        '$1,000 - $5,000/month',
        '$5,000 - $20,000/month',
        'More than $20,000/month',
      ],
    };
  }

  // Problem/challenge questions
  if (lowerQuestion.includes('challenge') || lowerQuestion.includes('problem') || lowerQuestion.includes('pain')) {
    return {
      type: 'help',
      content: `What's the biggest bottleneck? What keeps you up at night? What would make the biggest impact if solved?`,
      suggestions: [
        'Manual data entry and errors',
        'Lack of visibility and reporting',
        'Slow turnaround times',
        'Team coordination and handoffs',
      ],
    };
  }

  // Data-related questions
  if (lowerQuestion.includes('data') || lowerQuestion.includes('information') || lowerQuestion.includes('report')) {
    return {
      type: 'help',
      content: `Think about how you currently collect, organize, and use this data. How accessible is it? How accurate?`,
      suggestions: [
        'Scattered across multiple systems',
        'Centralized but hard to analyze',
        'Well-organized with some manual work',
        'Fully integrated and automated',
      ],
    };
  }

  // Technology questions
  if (lowerQuestion.includes('software') || lowerQuestion.includes('tool') || lowerQuestion.includes('system')) {
    return {
      type: 'help',
      content: `List the main tools your team uses for this. Are they well-integrated? Do people avoid using them?`,
      suggestions: [
        'Basic tools, mostly manual',
        'Multiple tools, limited integration',
        'Good tools but underutilized',
        'Modern, integrated tech stack',
      ],
    };
  }

  // Default help based on industry
  const industryExamples = getIndustryExample(industry, question);
  if (industryExamples) {
    return {
      type: 'suggestion',
      content: `Here's what other ${industry} businesses typically answer:`,
      suggestions: industryExamples,
    };
  }

  // Generic helpful message
  return {
    type: 'help',
    content: `Take a moment to think about your current situation. Be as specific as possible - the more detail you provide, the better your personalized recommendations will be.`,
  };
}

/**
 * Static industry example table. Deterministic lookup — no inference.
 */
export function getIndustryExample(industry: string, _question: string): string[] | null {
  const examples: Record<string, Record<string, string[]>> = {
    'Professional Services': {
      default: [
        'Client onboarding takes 2-3 weeks',
        'Manual proposal creation (4-6 hours each)',
        'Scattered client communications',
        'Time tracking is inconsistent',
      ],
    },
    'E-commerce & Retail': {
      default: [
        'Order processing has 2-3 manual steps',
        'Inventory updates are done manually',
        'Customer support is reactive',
        'Returns take 5-7 days to process',
      ],
    },
    'Manufacturing': {
      default: [
        'Production planning uses spreadsheets',
        'Quality checks are manual',
        'Inventory tracking has delays',
        'Maintenance is reactive, not predictive',
      ],
    },
  };

  return examples[industry]?.default || null;
}
