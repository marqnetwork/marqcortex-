/**
 * CLIENT REPORT GENERATOR
 *
 * Converts a real Submission (from Supabase) into ClientReadinessReportProps.
 *
 * This is the client-facing version of cortexDataGenerator.
 * Language is calm, executive, diagnostic — NOT internal consultant-speak.
 *
 * Rules:
 * ✔ Focus on what we found and what it means for THEM
 * ✔ Never mention internal scores or AI confidence
 * ✔ Never name specific tools unless the client mentioned them
 * ✔ Max 3 core issues
 * ✔ One clear next step — not a menu of services
 */

import type { Submission } from '@/app/services/dataService';

// Mirror of ClientReadinessReportProps
export interface ClientReportData {
  companyName: string;
  industry: string;
  generatedDate: string;
  contactName: string;
  contactEmail: string;

  readinessLevel: 'Low' | 'Medium' | 'High';
  readinessInterpretation: string;
  whatThisMeans: string[];
  immediateRisk: string;

  coreIssues: {
    title: string;
    problem: string;
    whyItExists: string;
    businessImpact: string[];
  }[];

  operationalHeatmap: {
    operationsExecution: { score: 'red' | 'yellow' | 'green'; label: string; explanation: string };
    revenueGrowth: { score: 'red' | 'yellow' | 'green'; label: string; explanation: string };
    systemsAutomation: { score: 'red' | 'yellow' | 'green'; label: string; explanation: string };
    aiReadiness: { score: 'red' | 'yellow' | 'green'; label: string; explanation: string };
  };

  highImpactAI: string[];
  shouldNotAutomate: string[];

  recommendedService: string;
  whyFirst: string;
  whatItUnlocks: string;

  impactRange: {
    hoursSavedPerMonth: string;
    costLeakageReduced: string;
    revenueAcceleration: string;
    disclaimer: string;
  };

  // Phase 4 expansion
  competitiveLandscape: {
    peerComparison: string;
    industryBenchmarks: { metric: string; yourPosition: 'ahead' | 'on-par' | 'behind'; detail: string }[];
    competitiveWindow: string;
  };

  quickWins: {
    title: string;
    description: string;
    effort: 'low' | 'medium';
    expectedImpact: string;
  }[];

  implementationTimeline: {
    phases: {
      label: string;
      weeks: string;
      description: string;
      milestones: string[];
    }[];
    totalDuration: string;
  };

  callSchedulingUrl: string;
}

// ============================================================================
// MAIN GENERATOR
// ============================================================================

export function generateClientReport(sub: Submission): ClientReportData {
  const answers = Object.values(sub.answers || {}).map(v => String(v));
  const answerText = answers.join(' ').toLowerCase();

  const readinessLevel = sub.completionScore >= 80 ? 'High' : sub.completionScore >= 55 ? 'Medium' : 'Low';

  return {
    companyName: sub.company,
    industry: sub.industry,
    generatedDate: new Date().toISOString(),
    contactName: sub.contact,
    contactEmail: sub.email,

    readinessLevel,
    readinessInterpretation: getReadinessInterpretation(readinessLevel, sub),
    whatThisMeans: getWhatThisMeans(readinessLevel, sub.industry),
    immediateRisk: getImmediateRisk(readinessLevel, sub.industry),

    coreIssues: getCoreIssues(sub, answerText),

    operationalHeatmap: getHeatmap(sub, answerText),

    highImpactAI: getHighImpactAI(sub.industry),
    shouldNotAutomate: getShouldNotAutomate(sub.industry),

    recommendedService: getRecommendedService(sub.industry, sub.completionScore),
    whyFirst: getWhyFirst(sub.industry, sub.company),
    whatItUnlocks: getWhatItUnlocks(sub.industry),

    impactRange: getImpactRange(sub),

    // Phase 4 expansion
    competitiveLandscape: {
      peerComparison: getPeerComparison(sub.industry),
      industryBenchmarks: getIndustryBenchmarks(sub.industry, sub.completionScore),
      competitiveWindow: getCompetitiveWindow(readinessLevel, sub.industry),
    },

    quickWins: getQuickWins(sub.industry, sub.completionScore),

    implementationTimeline: {
      phases: getImplementationPhases(sub.industry, sub.completionScore),
      totalDuration: '12 weeks',
    },

    callSchedulingUrl: 'https://calendly.com/marqcortex-team/readiness-call',
  };
}

// ============================================================================
// READINESS INTERPRETATION
// ============================================================================

function getReadinessInterpretation(level: 'Low' | 'Medium' | 'High', sub: Submission): string {
  const company = sub.company;
  if (level === 'High') {
    return `${company} has strong operational foundations and shows clear readiness for intelligent automation. Your team is asking the right questions and the diagnostic revealed well-defined, addressable bottlenecks.`;
  }
  if (level === 'Medium') {
    return `${company} has solid fundamentals but is scaling effort faster than systems. The diagnostic identified clear leverage points where structured intervention would unlock significant capacity and revenue.`;
  }
  return `${company} is at a critical inflection point. The diagnostic identified foundational gaps that, if left unaddressed, will compound under growth pressure. The good news: these are solvable and the path is clear.`;
}

function getWhatThisMeans(level: 'Low' | 'Medium' | 'High', industry: string): string[] {
  if (level === 'High') {
    return [
      'Your operations are structured enough to layer automation without disruption',
      'The bottlenecks we found are tactical — not architectural',
      'You are 60–90 days from meaningful operational leverage',
    ];
  }
  if (level === 'Medium') {
    return [
      'You are scaling effort faster than systems can support',
      'Revenue growth is constrained by operational execution, not market demand',
      'Hiring more people will compound costs without fixing root causes',
    ];
  }
  return [
    'Core processes lack the structure needed to support sustainable growth',
    'Revenue is leaking through gaps that are invisible without a diagnostic lens',
    'The business is highly dependent on individual effort rather than repeatable systems',
  ];
}

function getImmediateRisk(level: 'Low' | 'Medium' | 'High', industry: string): string {
  if (level === 'High') {
    return 'Risk is low but the window for competitive advantage is time-sensitive. Early movers in AI-enabled operations are establishing durable advantages.';
  }
  if (level === 'Medium') {
    return 'If growth continues without system changes, operational strain will compound within 6–9 months — leading to team burnout, customer experience decline, and margin compression.';
  }
  return 'Without structural intervention, current trajectory leads to significant operational breakdown within 3–6 months as volume increases.';
}

// ============================================================================
// CORE ISSUES
// ============================================================================

function getCoreIssues(sub: Submission, answerText: string) {
  const company = sub.company;
  const industry = sub.industry;

  const pool = [
    // Universal issue 1 — founder/leadership bottleneck
    answerText.includes('me') || answerText.includes('myself') || answerText.includes('approve') ? {
      title: 'Decision-Making Bottleneck',
      problem: `Key decisions at ${company} are concentrated with one or two individuals. Every significant action requires approval, creating a compounding delay across the business.`,
      whyItExists: `No structured delegation framework exists. The team lacks clear authority boundaries, so everything escalates. This was manageable at earlier scale but has become the primary operational constraint.`,
      businessImpact: [
        'Execution velocity is capped by the availability of one person',
        'Team develops learned helplessness — stops solving independently',
        'Growth compounds the problem: more volume means more approvals through the same bottleneck',
        'Founder burnout risk increases with every new hire',
      ],
    } : null,

    // Universal issue 2 — manual processes
    {
      title: 'Manual Processes at Scale',
      problem: `A significant portion of ${company}'s operational output depends on manual execution — tasks that are repetitive, time-consuming, and error-prone. These were necessary at an earlier stage but now create a growth ceiling.`,
      whyItExists: `The processes that worked at $1M revenue are not designed for $5M revenue. What was once a manageable workload has become a structural constraint as volume increased without corresponding system improvement.`,
      businessImpact: [
        'High-value team capacity spent on low-value, automatable tasks',
        `Every new customer adds proportional operational load — margins compress`,
        'Error rates increase as volume scales beyond human capacity',
        'Growth requires hiring rather than systems — cost model deteriorates',
      ],
    },

    // Industry-specific issue
    getIndustryIssue(industry, company),

    // Universal issue 3 — data visibility
    {
      title: 'Operational Visibility Gap',
      problem: `${company} lacks real-time visibility into its critical operational metrics. Decisions are made on delayed, incomplete, or manually assembled data — meaning the business is always reacting rather than anticipating.`,
      whyItExists: `Data sits in disconnected tools and spreadsheets with no unified view. Producing even basic performance reports requires manual collection from multiple sources, which is both slow and prone to error.`,
      businessImpact: [
        'Strategic decisions based on lagging indicators rather than real-time signals',
        'Revenue leakage through missed patterns and trends',
        'Time lost to manual reporting that could be fully automated',
        'Inability to catch problems early before they become expensive',
      ],
    },
  ].filter(Boolean);

  return pool.slice(0, 3) as {
    title: string;
    problem: string;
    whyItExists: string;
    businessImpact: string[];
  }[];
}

function getIndustryIssue(industry: string, company: string) {
  if (industry.includes('E-commerce') || industry.includes('DTC')) {
    return {
      title: 'Multi-Channel Coordination Breakdown',
      problem: `Inventory, order management, and customer communications at ${company} are not synchronised across channels — creating errors, delays, and customer experience failures at scale.`,
      whyItExists: `Each channel (website, marketplace, social) was added independently without integrating into a unified backend. The result is manual reconciliation between systems that should be automatic.`,
      businessImpact: [
        'Oversell incidents damage customer trust and create refund costs',
        'Customer service load increases as errors multiply',
        'Marketing efforts undermined by fulfilment gaps',
        'Channel expansion makes the problem exponentially worse',
      ],
    };
  }
  if (industry.includes('SaaS') || industry.includes('Software')) {
    return {
      title: 'Customer Lifecycle Gaps Driving Churn',
      problem: `${company}'s customer onboarding, activation, and retention processes rely heavily on manual intervention — making it impossible to scale without proportional headcount increases.`,
      whyItExists: `Early customer success was delivered through high-touch, manual effort — which built relationships but created a model that doesn't scale. No automated lifecycle triggers exist to replace this human effort efficiently.`,
      businessImpact: [
        'Churn risk increases as manual attention becomes harder to maintain at scale',
        'Onboarding quality varies by team member availability',
        'Expansion revenue is left uncaptured due to no systematic upsell triggers',
        'Every 10% ARR growth requires equivalent CS headcount growth',
      ],
    };
  }
  if (industry.includes('Agency') || industry.includes('Services')) {
    return {
      title: 'Delivery Quality Inconsistency',
      problem: `Client delivery at ${company} is inconsistent across engagements — quality and speed vary based on which team member is assigned rather than repeatable systems.`,
      whyItExists: `Processes exist in people's heads, not documented systems. Each project is treated as unique even when 60-70% of the work is repeatable. This makes scaling delivery quality nearly impossible.`,
      businessImpact: [
        'Client satisfaction fluctuates unpredictably',
        'Senior team members pulled into execution rather than strategy',
        'Capacity planning is guesswork without standardised delivery metrics',
        'Growth requires senior hires rather than leveraging systems',
      ],
    };
  }
  if (industry.includes('Healthcare')) {
    return {
      title: 'Administrative Overhead Consuming Clinical Capacity',
      problem: `Administrative tasks — scheduling, documentation, billing coordination, patient follow-up — are consuming disproportionate time at ${company}, reducing capacity for high-value clinical work.`,
      whyItExists: `Healthcare operations have unique compliance requirements that have historically made automation seem risky. This has resulted in over-reliance on manual processes where safe, compliant automation is available.`,
      businessImpact: [
        'Clinical staff spending significant time on administrative tasks',
        'Patient throughput constrained by administrative bottlenecks',
        'Billing delays and errors reducing revenue realisation',
        'Staff burnout risk from administrative overload',
      ],
    };
  }
  return {
    title: 'System Fragmentation Creating Operational Drag',
    problem: `The tools and systems at ${company} are not integrated — creating data silos, manual handoffs, and duplication of effort that collectively consume significant operational capacity.`,
    whyItExists: `Systems were adopted reactively to solve individual problems, without consideration for how they'd need to work together. The result is a fragmented stack where information doesn't flow automatically between functions.`,
    businessImpact: [
      'Team spends hours weekly on manual data entry between systems',
      'Information asymmetry leads to errors and miscommunication',
      'Customer experience suffers from fragmented data',
      'Business intelligence is incomplete due to data silos',
    ],
  };
}

// ============================================================================
// HEATMAP
// ============================================================================

function getHeatmap(sub: Submission, answerText: string) {
  const ops = sub.completionScore >= 70 ? 'yellow' : sub.completionScore >= 85 ? 'green' : 'red';
  const rev = sub.qualityScore >= 75 ? 'green' : sub.qualityScore >= 55 ? 'yellow' : 'red';
  const sys = sub.completionScore >= 80 ? 'yellow' : 'red';
  const ai = sub.qualityScore >= 80 ? 'yellow' : 'red';

  return {
    operationsExecution: {
      score: ops as 'red' | 'yellow' | 'green',
      label: ops === 'green' ? 'Stable' : ops === 'yellow' ? 'Needs Attention' : 'Immediate',
      explanation: ops === 'green'
        ? 'Operations are well-structured and can support near-term growth with targeted improvements.'
        : ops === 'yellow'
        ? 'Operations function but are constrained. Manual processes and approval bottlenecks limit throughput. Cannot scale without structural change.'
        : 'Operational structure is fragile. Current processes will break under increased volume — immediate intervention required.',
    },
    revenueGrowth: {
      score: rev as 'red' | 'yellow' | 'green',
      label: rev === 'green' ? 'Stable' : rev === 'yellow' ? 'Needs Attention' : 'Immediate',
      explanation: rev === 'green'
        ? 'Revenue growth is healthy. Strong market position with clear expansion opportunities once operational constraints are resolved.'
        : rev === 'yellow'
        ? 'Revenue is growing but constrained by operational execution, not market demand. Fixing operations will unlock faster growth.'
        : 'Revenue growth is being actively suppressed by operational breakdowns. Customer experience and delivery quality need immediate attention.',
    },
    systemsAutomation: {
      score: sys as 'red' | 'yellow' | 'green',
      label: sys === 'green' ? 'Stable' : sys === 'yellow' ? 'Needs Attention' : 'Immediate',
      explanation: sys === 'green'
        ? 'Good automation foundation in place. Opportunities exist to extend further for additional leverage.'
        : sys === 'yellow'
        ? 'Partial automation exists but significant manual work remains. High-value automation opportunities are clearly identifiable and achievable.'
        : 'Heavy reliance on manual work for repetitive tasks. Automation is not just an opportunity — it is a business continuity requirement.',
    },
    aiReadiness: {
      score: ai as 'red' | 'yellow' | 'green',
      label: ai === 'green' ? 'Stable' : ai === 'yellow' ? 'Needs Attention' : 'Immediate',
      explanation: ai === 'green'
        ? 'Strong foundation for AI implementation. Data is accessible, processes are documented, and the team is ready.'
        : ai === 'yellow'
        ? 'Good potential for AI implementation. Process documentation and data structure improvements will maximise return on AI investment.'
        : 'Foundation work required before AI implementation will be effective. Rushing AI without this groundwork typically leads to poor adoption and wasted investment.',
    },
  };
}

// ============================================================================
// AI OPPORTUNITIES
// ============================================================================

function getHighImpactAI(industry: string): string[] {
  const universal = [
    'Automate status updates and follow-up communications',
    'Replace manual reporting with real-time dashboards',
    'Systematise client/customer onboarding workflows',
  ];
  const industrySpecific: Record<string, string[]> = {
    'E-commerce / DTC': [
      'Automate customer service responses for order status and common queries',
      'Synchronise inventory across all channels in real time',
      'Personalise post-purchase follow-up sequences automatically',
    ],
    'SaaS / Software': [
      'Automate onboarding milestone triggers and check-ins',
      'Detect churn signals early with usage-based alerts',
      'Surface expansion opportunities from product usage data',
    ],
    'Agency / Services': [
      'Automate client reporting and delivery notifications',
      'Systematise project templates to reduce setup time per engagement',
      'Create automated feedback loops after project milestones',
    ],
    'Healthcare / Medical': [
      'Automate appointment reminders and patient follow-up sequences',
      'Streamline intake and documentation with structured forms',
      'Flag at-risk patients through pattern-based monitoring',
    ],
  };

  const specific = industrySpecific[industry] || [
    'Automate internal approval and sign-off workflows',
    'Create AI-powered routing for customer and team requests',
    'Build automated exception alerts for key operational metrics',
  ];
  return [...specific, ...universal].slice(0, 5);
}

function getShouldNotAutomate(industry: string): string[] {
  return [
    'Strategic decisions and growth planning',
    'Sensitive customer situations requiring human empathy and judgment',
    'Creative direction, product decisions, and brand positioning',
  ];
}

// ============================================================================
// RECOMMENDED SERVICE
// ============================================================================

function getRecommendedService(industry: string, completionScore: number): string {
  if (completionScore >= 80) return 'AI Readiness & Automation Audit';
  if (industry.includes('SaaS') || industry.includes('Software')) return 'Product Operations Audit';
  if (industry.includes('E-commerce') || industry.includes('DTC')) return 'Operations & Integration Audit';
  if (industry.includes('Agency') || industry.includes('Services')) return 'Delivery Systems Audit';
  if (industry.includes('Healthcare')) return 'Healthcare Operations Review';
  return 'Operational Readiness Audit';
}

function getWhyFirst(industry: string, company: string): string {
  return `Before recommending specific solutions for ${company}, we validate the diagnostic and quantify the true cost of each bottleneck. This ensures every dollar invested goes toward the highest-leverage problem — not the most visible one. No wasted investment, no vendor dependency, no scope creep.`;
}

function getWhatItUnlocks(industry: string): string {
  return `A clear, sequenced 90-day roadmap with validated ROI estimates for each intervention. You will know exactly what to build, what to delay, and what the business impact will be before committing any resources to implementation.`;
}

// ============================================================================
// IMPACT RANGE
// ============================================================================

function getImpactRange(sub: Submission) {
  const base = Math.round(sub.completionScore * 1.2);
  const low = base;
  const high = Math.round(base * 1.6);
  const costLow = Math.round(low * 80);
  const costHigh = Math.round(high * 80);

  return {
    hoursSavedPerMonth: `${low} – ${high} hours`,
    costLeakageReduced: `$${formatCurrency(costLow)} – $${formatCurrency(costHigh)} per month`,
    revenueAcceleration: '10 – 25% improvement in operational throughput',
    disclaimer: `Based on diagnostic data and similar businesses in your sector. Not a guarantee — actual results depend on implementation quality and team adoption.`,
  };
}

function formatCurrency(n: number): string {
  if (n >= 1000) return `${Math.round(n / 100) / 10}K`;
  return n.toString();
}

// ============================================================================
// PHASE 4 EXPANSION
// ============================================================================

function getPeerComparison(industry: string): string {
  const comparisons: Record<string, string> = {
    'E-commerce / DTC': 'Compared to other DTC brands at a similar revenue stage, your operational structure is typical — most are running on stitched-together tools with manual fulfilment oversight. The differentiator is which ones fix this proactively versus reactively after a major stockout or customer experience failure.',
    'SaaS / Software': 'Among SaaS companies at your stage, you are in line with industry norms on product-market fit indicators but lagging on operational infrastructure. Most Series A–B SaaS companies share this pattern — revenue grows faster than the systems supporting it.',
    'Agency / Services': 'Relative to agencies of similar size, your delivery quality is strong but your operational leverage is low. Most agencies plateau at this stage because they scale with headcount rather than systems — the ones that break through invest in repeatable delivery infrastructure.',
    'Healthcare / Medical': 'Within healthcare practices of your size, your clinical quality appears strong but administrative efficiency is below average. Most practices lose 20–30% of available clinical capacity to administrative tasks that could be streamlined or automated within compliance boundaries.',
  };
  return comparisons[industry] || `Among businesses in the ${industry} sector at a comparable scale, your diagnostic profile reveals strengths in team capability but structural gaps in systems and processes. The companies that pull ahead at this stage invest in operational infrastructure before the next growth surge — not after it breaks.`;
}

function getIndustryBenchmarks(industry: string, completionScore: number): { metric: string; yourPosition: 'ahead' | 'on-par' | 'behind'; detail: string }[] {
  const position = (threshold: number): 'ahead' | 'on-par' | 'behind' =>
    completionScore >= threshold + 15 ? 'ahead' : completionScore >= threshold - 10 ? 'on-par' : 'behind';

  if (industry.includes('E-commerce') || industry.includes('DTC')) {
    return [
      { metric: 'Order Fulfilment Automation', yourPosition: position(70), detail: 'Top-performing DTC brands automate 85%+ of order processing. Manual fulfilment becomes a growth ceiling above $2M ARR.' },
      { metric: 'Customer Data Unification', yourPosition: position(65), detail: 'Leading brands have a single customer view across all channels. Fragmented data is the #1 cause of poor retention in e-commerce.' },
      { metric: 'Multi-Channel Inventory Sync', yourPosition: position(75), detail: 'Best-in-class brands maintain real-time sync across all channels. Manual reconciliation causes 3–5% revenue leakage on average.' },
      { metric: 'Post-Purchase Automation', yourPosition: position(60), detail: 'Top performers automate 90%+ of post-purchase communications. This single lever drives 15–30% of repeat purchase revenue.' },
    ];
  }
  if (industry.includes('SaaS') || industry.includes('Software')) {
    return [
      { metric: 'Customer Onboarding Automation', yourPosition: position(70), detail: 'Leading SaaS companies achieve 80%+ self-serve onboarding. Manual onboarding scales linearly with headcount — a churn driver in disguise.' },
      { metric: 'Churn Signal Detection', yourPosition: position(75), detail: 'Top SaaS operators detect at-risk accounts 30+ days before churn. Without automated signals, most companies learn about churn after it happens.' },
      { metric: 'Product-Led Growth Infrastructure', yourPosition: position(65), detail: 'PLG-enabled SaaS companies convert trial users at 2–3x higher rates. The gap is usually in activation triggers, not product quality.' },
      { metric: 'Revenue Expansion Automation', yourPosition: position(60), detail: 'Best-in-class SaaS captures 30%+ of net new revenue from existing customers. Without systematic triggers, expansion revenue is left on the table.' },
    ];
  }
  if (industry.includes('Agency') || industry.includes('Services')) {
    return [
      { metric: 'Delivery Standardisation', yourPosition: position(65), detail: 'Top agencies standardise 60–70% of delivery. Treating every engagement as bespoke erodes margins and limits scale.' },
      { metric: 'Client Reporting Automation', yourPosition: position(60), detail: 'Leading agencies automate 80%+ of client reporting. Manual reporting is one of the highest hidden costs in services businesses.' },
      { metric: 'Utilisation Rate Visibility', yourPosition: position(70), detail: 'Best agencies maintain real-time utilisation dashboards. Without this, revenue forecasting is guesswork and bench time is invisible.' },
      { metric: 'Pipeline Predictability', yourPosition: position(55), detail: 'Top performers maintain 3+ months of pipeline visibility. Feast-or-famine revenue is a systems problem, not a sales problem.' },
    ];
  }
  // Universal fallback
  return [
    { metric: 'Process Documentation', yourPosition: position(65), detail: 'Operationally mature businesses have 70%+ of core processes documented. Tribal knowledge is the #1 risk factor for growing companies.' },
    { metric: 'Automation Coverage', yourPosition: position(70), detail: 'Leading businesses automate 60%+ of repetitive tasks. Manual execution is the primary margin compressor at scale.' },
    { metric: 'Data Accessibility', yourPosition: position(60), detail: 'Best-in-class operations have real-time access to key metrics. Delayed data leads to reactive rather than proactive management.' },
    { metric: 'Decision Velocity', yourPosition: position(55), detail: 'Top-performing teams make 80%+ of operational decisions without escalation. Approval bottlenecks are the hidden growth limiter.' },
  ];
}

function getCompetitiveWindow(readinessLevel: 'Low' | 'Medium' | 'High', industry: string): string {
  if (readinessLevel === 'High') {
    return 'Your readiness level places you in a strong position to move first. The competitive window for AI-enabled operations is 6–12 months — companies that build this infrastructure now will establish structural advantages that are expensive and slow for competitors to replicate.';
  }
  if (readinessLevel === 'Medium') {
    return 'You have a 3–6 month window to address the structural gaps before they become competitive liabilities. Your peers who act now will have measurably better unit economics and customer experience within two quarters. Delay compounds the gap.';
  }
  return 'The window for addressing these foundational gaps is narrow — 1–3 months before growth pressure makes them significantly more expensive to fix. Companies that wait until they are forced to change pay 2–3x more and take twice as long to achieve results.';
}

function getQuickWins(industry: string, completionScore: number): { title: string; description: string; effort: 'low' | 'medium'; expectedImpact: string }[] {
  const universal: { title: string; description: string; effort: 'low' | 'medium'; expectedImpact: string }[] = [
    {
      title: 'Document Your Top 5 Processes',
      description: 'Identify the 5 most-repeated processes in your business and write step-by-step documentation. This alone reveals automation opportunities and reduces key-person dependency.',
      effort: 'low',
      expectedImpact: 'Reduces onboarding time by 30% and creates the foundation for automation.',
    },
    {
      title: 'Audit Your Tool Stack',
      description: 'List every tool your team uses, who uses it, and what data it holds. Identify overlaps, gaps, and manual handoffs between tools.',
      effort: 'low',
      expectedImpact: 'Reveals 2–4 integration opportunities and eliminates redundant subscriptions.',
    },
  ];

  const industryWins: Record<string, { title: string; description: string; effort: 'low' | 'medium'; expectedImpact: string }[]> = {
    'E-commerce / DTC': [
      { title: 'Set Up Automated Review Requests', description: 'Configure post-delivery review request emails with a 5–7 day delay. Most platforms support this natively with no custom code.', effort: 'low', expectedImpact: '15–25% increase in review volume within 30 days.' },
      { title: 'Create a Returns Self-Service Flow', description: 'Build a simple self-service returns portal using your existing platform tools. Removes 40%+ of customer service tickets related to returns.', effort: 'medium', expectedImpact: '30–40% reduction in return-related support tickets.' },
    ],
    'SaaS / Software': [
      { title: 'Implement Welcome Email Sequences', description: 'Set up a 5-email onboarding sequence triggered at signup. Focus on activating the core feature within the first 48 hours.', effort: 'low', expectedImpact: '10–20% improvement in activation rate within 60 days.' },
      { title: 'Add Usage-Based Health Scoring', description: 'Create a simple scoring model (login frequency + core feature usage) and flag accounts below threshold for CS outreach.', effort: 'medium', expectedImpact: 'Catch 60% of at-risk accounts before they churn.' },
    ],
    'Agency / Services': [
      { title: 'Templatise Project Kickoffs', description: 'Create a standard kickoff template with pre-filled agendas, stakeholder roles, and milestone schedules. Saves 3–5 hours per new engagement.', effort: 'low', expectedImpact: '20% faster project start and more consistent client experience.' },
      { title: 'Automate Weekly Status Emails', description: 'Set up automatic status report generation from your project management tool. Most PMs spend 2+ hours weekly on this manually.', effort: 'medium', expectedImpact: 'Reclaim 8+ hours per month of senior team capacity.' },
    ],
    'Healthcare / Medical': [
      { title: 'Automate Appointment Reminders', description: 'Configure automated SMS/email reminders at 72h, 24h, and 2h before appointments. Most EHR systems support this natively.', effort: 'low', expectedImpact: '25–40% reduction in no-show rates.' },
      { title: 'Digitise Intake Forms', description: 'Move paper intake forms to digital pre-visit forms sent via email/text. Reduces check-in time and data entry errors.', effort: 'medium', expectedImpact: '15–20 minutes saved per patient visit on administrative tasks.' },
    ],
  };

  const specific = industryWins[industry] || [
    { title: 'Centralise Team Communication', description: 'Consolidate project discussions from email, chat, and meetings into one tool with clear channel structure. Reduces information loss and meeting load.', effort: 'low', expectedImpact: '20–30% reduction in internal meetings and context-switching.' },
  ];

  return [...universal.slice(0, 1), ...specific.slice(0, 1), ...universal.slice(1, 2)].slice(0, 3);
}

function getImplementationPhases(industry: string, completionScore: number): { label: string; weeks: string; description: string; milestones: string[] }[] {
  return [
    {
      label: 'Discovery & Validation',
      weeks: 'Weeks 1–2',
      description: 'We validate the diagnostic findings with your team, map current processes in detail, and quantify the true cost of each bottleneck. No assumptions — just data.',
      milestones: [
        'Stakeholder interviews and process walkthroughs completed',
        'Current-state process maps documented for top 5 workflows',
        'Bottleneck cost quantification validated with real numbers',
        'Quick win opportunities confirmed and prioritised',
      ],
    },
    {
      label: 'Architecture & Quick Wins',
      weeks: 'Weeks 3–5',
      description: 'Design the target-state systems architecture while simultaneously implementing high-impact quick wins that deliver immediate value and build momentum.',
      milestones: [
        'Target-state architecture designed and approved',
        '2–3 quick win automations deployed and operational',
        'Integration specifications completed for core systems',
        'Team training plan developed for new workflows',
      ],
    },
    {
      label: 'Build & Deploy',
      weeks: 'Weeks 6–10',
      description: 'Build and deploy the core system improvements in iterative sprints. Each sprint delivers working functionality that your team can use immediately.',
      milestones: [
        'Core automation workflows deployed and tested',
        'System integrations live and data flowing',
        'Team trained on new processes with documentation',
        'Performance dashboards operational with real-time data',
      ],
    },
    {
      label: 'Optimise & Handoff',
      weeks: 'Weeks 11–12',
      description: 'Fine-tune performance based on real usage data, resolve edge cases, and complete the knowledge transfer so your team owns the systems independently.',
      milestones: [
        'Performance optimisation based on 30 days of live data',
        'Edge cases identified and resolved',
        'Complete documentation and runbook handoff',
        'ROI validation report delivered with actual vs projected metrics',
      ],
    },
  ];
}