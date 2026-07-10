/**
 * OBJECTION HANDLING INTELLIGENCE ENGINE — Phase 6
 *
 * Governance principle: Keyword scoring decides objection type. No LLM needed.
 * Playbooks are deterministic response templates, parameterised by proposal data.
 *
 * detectObjection(input) → ObjectionDetected { type, confidence, at_risk }
 * getPlaybook(type)      → ObjectionPlaybook  { response_points, email }
 * hydratePlaybook(pb, draft) → hydrated strings with real proposal data
 *
 * Spec: confidence > 0.65 → at_risk = true (Section B of revenue-control-process.md)
 */

import type {
  ObjectionType,
  ObjectionDetected,
  ObjectionPlaybook,
  ProposalDraft,
} from '@/app/types/cortex-types';

// ════════════════════════════════════════════════════════════════════════════════
// KEYWORD MAP — drives confidence scoring
// ════════════════════════════════════════════════════════════════════════════════

const KEYWORD_MAP: Record<ObjectionType, string[]> = {
  price: [
    'expensive', 'cost', 'price', 'budget', 'afford', 'too much', 'cheaper',
    'discount', 'fee', 'investment', 'costly', 'pricing', 'quote', 'value',
    'money', 'rate', 'overpriced', 'justify',
  ],
  risk: [
    'risk', 'risky', 'uncertain', 'fail', 'guarantee', 'proven', 'trust the ai',
    'data', 'security', 'compliance', 'error', 'mistake', 'liability', 'wrong',
    'backfire', 'concern', 'worried', 'what if', 'goes wrong', 'breach',
  ],
  timing: [
    'timing', 'not now', 'later', 'next quarter', 'busy', 'capacity', 'time',
    'wait', 'delay', 'current workload', 'resource', 'bandwidth', 'soon',
    'future', 'priorities', 'next year', 'too soon', 'not ready',
  ],
  trust: [
    'heard of you', 'experience', 'reference', 'case study', 'proof',
    'credibility', 'methodology', 'transparent', 'how do you', 'explain',
    'understand', 'black box', 'model', 'who are you', 'track record',
    'portfolio', 'reputation', 'background',
  ],
  internal_alignment: [
    'board', 'ceo', 'cfo', 'approval', 'sign off', 'committee', 'internal',
    'team', 'stakeholder', 'colleague', 'department', 'management', 'politics',
    'convince', 'alignment', 'consensus', 'buy in', 'buy-in', 'boss',
    'director', 'executive', 'get sign off', 'leadership', 'c-suite',
  ],
};

// ════════════════════════════════════════════════════════════════════════════════
// PLAYBOOKS — response templates, with {placeholder} tokens
// ════════════════════════════════════════════════════════════════════════════════

export const OBJECTION_PLAYBOOKS: Record<ObjectionType, ObjectionPlaybook> = {
  price: {
    type:  'price',
    label: 'Price Objection',
    response_points: [
      'ROI realism: The expected-scenario model shows break-even at {payback_month} months, derived from your diagnostic data — not a marketing claim.',
      'Cost of inaction: The diagnostic confirmed {annual_impact}/year in operational drag. The engagement cost is a measured fraction of that figure.',
      'Payback timeline: Every month without action is {monthly_drag} in continuing operational cost at current run rate.',
      'Phased entry: An Audit-First model is available. Full commitment only after Phase 1 validates the methodology in your environment.',
    ],
    email_subject: 'Re: Investment Conversation — What the Numbers Actually Show',
    email_body: `Dear {contact_name},

Thank you for the candid feedback on investment. I want to give you the full picture before you make a decision.

The diagnostic confirmed {annual_impact} in annual operational drag across {bottleneck_count} identified bottlenecks. Our engagement is priced relative to that confirmed impact — not as an arbitrary cost.

Two points I'd like to clarify:

1. The financial model shows break-even at {payback_month} months under the expected scenario. That figure is derived directly from your diagnostic data and uses conservative assumptions throughout.

2. We can structure entry with an Audit-First phase at lower initial commitment. You proceed to full implementation only after Phase 1 demonstrates the methodology against your real environment.

I'm not asking for an immediate yes. I'm asking for 30 minutes to walk through the model together.

When works for you?

MARQ Cortex`,
  },

  risk: {
    type:  'risk',
    label: 'Risk Objection',
    response_points: [
      'Human-in-loop governance: No AI decision is automated without a designated human reviewer approving it — built into the delivery contract.',
      'Phased deployment: We operate in controlled phases. Each phase is validated and signed off before the next begins.',
      'Audit-first model: Phase 1 is observation and diagnostic mapping only. No systems are modified until you have full visibility.',
      'Conservative modeling: ROI projections use conservative scenario assumptions. We do not model upside-only outcomes.',
    ],
    email_subject: 'Re: Risk Concerns — Our Governance Model Explained',
    email_body: `Dear {contact_name},

I want to address the risk concerns directly, because they're the right concerns to have.

Our governance model is built around one non-negotiable principle: AI augments human judgement — it does not replace it.

In practice, this means:

• No automated decision goes live without a designated human approver in your team
• Phase 1 is observation and mapping only — nothing changes in your systems until you have full diagnostic visibility
• All models are explainable and version-controlled — we document the decision logic at every step
• Human oversight requirements are written into the delivery contract as enforceable obligations, not best-effort commitments

This isn't a standard reassurance. It's the operational model.

I'd like to walk you through a client scenario where these controls were specifically tested and validated. Would that help?

MARQ Cortex`,
  },

  timing: {
    type:  'timing',
    label: 'Timing Objection',
    response_points: [
      'Operational cost of delay: Every month of delay is approximately {monthly_drag} in confirmed ongoing operational drag.',
      'Capacity drain compounds: The bottlenecks identified are consuming team capacity that accumulates month-over-month.',
      'Phase 1 is low-lift: The Audit phase requires minimal client time — MARQ Cortex conducts the analysis; your team reviews.',
      'Cycle positioning: Engaging now delivers measurable operational improvement before the next planning cycle.',
    ],
    email_subject: 'Re: Timing — The Compounding Cost of Waiting',
    email_body: `Dear {contact_name},

I understand the timing concern completely. Before you make that decision, I want to make sure you have accurate numbers.

The diagnostic identified operational drag that is active right now. It doesn't pause while other priorities are addressed. At current trajectory, waiting one quarter represents approximately {monthly_drag} per month in unrecovered operational cost.

Phase 1 of our engagement is specifically structured for constrained teams. We conduct the analysis. Your team reviews and approves. Client-side time commitment in the first 30 days is minimal.

I'm happy to map our Phase 1 timeline against your current workload calendar to find a low-friction start point.

Would that be useful?

MARQ Cortex`,
  },

  trust: {
    type:  'trust',
    label: 'Trust Objection',
    response_points: [
      'Method transparency: Every recommendation cites the specific diagnostic signal that generated it — no black-box outputs.',
      'Version control: All models and assumptions are versioned. You can audit every change made to the financial model.',
      'Conservative modeling: We use conservative scenario assumptions by default. You would see inflated numbers if we didn\'t.',
      'Explainable AI: Decision logic is documented and presented in plain language at every stage of engagement.',
    ],
    email_subject: 'Re: Our Methodology — Full Transparency Offered',
    email_body: `Dear {contact_name},

I want to address the trust question directly, because it is the right question to raise.

Our diagnostic system is rule-based at the detection stage. Every finding cites the specific question response, operational pattern, or financial data signal that generated it. There is no AI interpretation at diagnosis — it is deterministic signal scoring.

Our ROI model is versioned and fully auditable. Every assumption is documented, visible, and adjustable with your explicit sign-off. We model conservative, expected, and aggressive scenarios and present all three — we do not present only the optimistic case.

I'd like to share our methodology documentation and walk you through how a single finding traces from raw diagnostic response to final recommendation. That takes approximately 20 minutes and should resolve most of the uncertainty.

When are you available?

MARQ Cortex`,
  },

  internal_alignment: {
    type:  'internal_alignment',
    label: 'Internal Alignment Objection',
    response_points: [
      'Executive brief: We provide a one-page executive summary designed for internal stakeholder sign-off — no jargon.',
      'Board-ready financials: The ROI model is formatted for C-suite and finance review with all assumptions visible.',
      'Risk framing: We can frame Phase 1 as a contained audit with defined scope — typically easier to get internal approval.',
      'Stakeholder Q&A: We offer a 30-minute direct session with your internal decision-makers if that would accelerate alignment.',
    ],
    email_subject: 'Re: Internal Alignment — Supporting Materials for Your Review',
    email_body: `Dear {contact_name},

I understand you need to bring this to your internal stakeholders. I want to make that process as clear and straightforward as possible.

I can provide the following to support your internal review:

1. A one-page Executive Summary formatted specifically for board or C-suite review
2. The financial model with all assumptions visible and clearly labelled — suitable for CFO-level review
3. A risk register showing each governance control and how it mitigates the identified concerns
4. A 30-minute Q&A session directly with your internal decision-makers, if that would help resolve questions more efficiently

The goal is to give your team everything they need to evaluate this independently, without any time pressure.

What format or materials would be most useful for your internal process?

MARQ Cortex`,
  },
};

// ════════════════════════════════════════════════════════════════════════════════
// DETECTION
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Score keyword matches to determine objection type and confidence.
 * Spec (revenue-control-process.md §B): confidence > 0.65 → at_risk = true.
 */
export function detectObjection(input: string): ObjectionDetected {
  const lower = input.toLowerCase();

  const scores: Record<ObjectionType, number> = {
    price: 0, risk: 0, timing: 0, trust: 0, internal_alignment: 0,
  };

  (Object.entries(KEYWORD_MAP) as [ObjectionType, string[]][]).forEach(([type, keywords]) => {
    keywords.forEach(kw => {
      if (lower.includes(kw)) scores[type] += 1;
    });
  });

  const entries  = Object.entries(scores) as [ObjectionType, number][];
  const maxScore = Math.max(...entries.map(([, v]) => v));

  if (maxScore === 0) {
    return { type: 'price', confidence: 0.25, at_risk: false };
  }

  const sorted     = [...entries].sort((a, b) => b[1] - a[1]);
  const topType    = sorted[0][0];
  const confidence = Math.min(0.97, 0.35 + maxScore * 0.13);

  return {
    type:    topType,
    confidence,
    at_risk: confidence > 0.65,   // Spec threshold (was 0.7, corrected to 0.65)
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// PLAYBOOK RETRIEVAL + HYDRATION
// ════════════════════════════════════════════════════════════════════════════════

export function getPlaybook(type: ObjectionType): ObjectionPlaybook {
  return OBJECTION_PLAYBOOKS[type];
}

/**
 * Replace {placeholder} tokens in playbook strings using real proposal data.
 */
export function hydratePlaybook(
  playbook: ObjectionPlaybook,
  draft: ProposalDraft,
): ObjectionPlaybook {
  const investment      = draft.financial_summary?.investment_total ?? draft.next_step_offer.price ?? 0;
  const paybackMonth    = draft.financial_summary?.payback_month ?? '—';
  const annualGain      = draft.financial_summary?.annual_gain_conf_weighted ?? 0;
  const annualImpact    = annualGain > 0
    ? `$${annualGain.toLocaleString()}`
    : `$${Math.round(investment * 2.5).toLocaleString()} (estimated)`;
  const monthlyDrag     = annualGain > 0
    ? `$${Math.round(annualGain / 12).toLocaleString()}`
    : `$${Math.round(investment * 0.2).toLocaleString()}`;
  const contactName     = draft.client.primary_contact.name || 'there';
  const bottleneckCount = draft.diagnosis_blocks.length.toString();

  const replace = (str: string) =>
    str
      .replace(/\{payback_month\}/g, String(paybackMonth))
      .replace(/\{annual_impact\}/g, annualImpact)
      .replace(/\{monthly_drag\}/g, monthlyDrag)
      .replace(/\{contact_name\}/g, contactName)
      .replace(/\{bottleneck_count\}/g, bottleneckCount);

  return {
    ...playbook,
    response_points: playbook.response_points.map(replace),
    email_subject:   replace(playbook.email_subject),
    email_body:      replace(playbook.email_body),
  };
}