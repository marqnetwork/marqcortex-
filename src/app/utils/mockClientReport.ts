/**
 * MOCK CLIENT REPORT DATA
 * 
 * Example data for the client-facing readiness report.
 * In production, this would be generated from Cortex AI analysis.
 */

export const EXAMPLE_CLIENT_REPORT = {
  // Company info
  companyName: "Acme Fashion Co.",
  industry: "E-commerce / DTC",
  generatedDate: "2026-01-28T10:00:00Z",
  
  // Executive snapshot
  readinessLevel: "Medium" as const,
  readinessInterpretation: "Your business has strong fundamentals but is losing leverage due to manual execution and fragmented systems.",
  whatThisMeans: [
    "You are scaling effort faster than systems",
    "Revenue is constrained by follow-up and approvals",
    "Hiring alone will increase cost without fixing root issues"
  ],
  immediateRisk: "If growth continues without system changes, operational strain will compound within 6–9 months.",
  
  // Core diagnosis (3-4 issues max)
  coreIssues: [
    {
      title: "Founder Approval Bottleneck",
      problem: "Decisions, approvals, or follow-ups depend on one or two people, slowing execution and creating risk.",
      whyItExists: "No delegation framework exists. Team has no authority to resolve customer issues independently. Founder is the single point of decision for all escalations.",
      businessImpact: [
        "Delayed responses to customers (24-48 hour approval cycles)",
        "Missed opportunities when founder is unavailable",
        "Team dependency prevents autonomous execution",
        "Burnout risk as volume increases"
      ]
    },
    {
      title: "Customer Service Capacity Constraint",
      problem: "Support team is underwater with 200+ tickets per week. Response times are stretching to 24-48 hours and getting worse.",
      whyItExists: "Reactive support model with no self-service options. Most questions are repetitive (order status, returns, shipping) but require manual response every time.",
      businessImpact: [
        "Customer satisfaction declining as response times increase",
        "Growth will push response times to 3-4 days",
        "Team burnout and turnover risk",
        "Negative review spiral if not addressed"
      ]
    },
    {
      title: "Multi-Channel Inventory Chaos",
      problem: "Manual inventory management across website, Amazon, and Instagram Shop causing 2-3 oversells per week.",
      whyItExists: "Spreadsheet-based tracking with manual sync. No real-time visibility across channels. Human error in data entry is unavoidable at current volume.",
      businessImpact: [
        "Customer frustration from oversell incidents",
        "Refund costs and shipping waste",
        "Brand reputation damage",
        "Problem compounds as channels expand"
      ]
    }
  ],
  
  // Operational heatmap
  operationalHeatmap: {
    operationsExecution: {
      score: "yellow" as const,
      label: "Needs Attention",
      explanation: "Operations function but are constrained by founder bottleneck and manual processes. Can't scale without breaking."
    },
    revenueGrowth: {
      score: "green" as const,
      label: "Stable",
      explanation: "Revenue growth is healthy. Strong product-market fit. CAC increasing but manageable. Primary constraint is operational, not market."
    },
    systemsAutomation: {
      score: "red" as const,
      label: "Immediate",
      explanation: "Heavy reliance on manual work for repetitive tasks. 40-50% of support tickets are automatable. Inventory chaos creating errors."
    },
    aiReadiness: {
      score: "yellow" as const,
      label: "Needs Attention",
      explanation: "Good foundation (structured processes, data exists) but no AI implementation. High leverage opportunity waiting to be captured."
    }
  },
  
  // AI opportunities
  highImpactAI: [
    "Remove manual follow-ups through automated workflows",
    "Standardize customer service responses for common questions",
    "Improve response speed with AI chatbot for tier-1 support",
    "Reduce admin load through inventory sync automation",
    "Enable self-service for order status and tracking"
  ],
  shouldNotAutomate: [
    "Strategic business decisions and growth planning",
    "Sensitive customer escalations requiring empathy and judgment",
    "Product development and creative direction"
  ],
  
  // Recommended first step
  recommendedService: "AI Readiness & ROI Audit",
  whyFirst: "Before implementing any automation, we validate priorities and quantify impact. This ensures we're solving the right problems in the right order—no wasted investment, no vendor dependency.",
  whatItUnlocks: "A clear 90-day roadmap with validated ROI estimates. You'll know exactly what to build, what to delay, and what the business impact will be before committing resources.",
  
  // Impact range
  impactRange: {
    hoursSavedPerMonth: "120 – 180 hours",
    costLeakageReduced: "$8,000 – $12,000 per month",
    revenueAcceleration: "15 – 25% improvement in close rates",
    disclaimer: "Based on similar businesses in your industry. Not a guarantee—actual results depend on implementation quality and team adoption."
  },
  
  // Phase 4 expansion — Competitive Landscape
  competitiveLandscape: {
    peerComparison: "Compared to other DTC brands at a similar revenue stage, your operational structure is typical — most are running on stitched-together tools with manual fulfilment oversight. The differentiator is which ones fix this proactively versus reactively after a major stockout or customer experience failure.",
    industryBenchmarks: [
      { metric: "Order Fulfilment Automation", yourPosition: "on-par" as const, detail: "Top-performing DTC brands automate 85%+ of order processing. Manual fulfilment becomes a growth ceiling above $2M ARR." },
      { metric: "Customer Data Unification", yourPosition: "behind" as const, detail: "Leading brands have a single customer view across all channels. Fragmented data is the #1 cause of poor retention in e-commerce." },
      { metric: "Multi-Channel Inventory Sync", yourPosition: "behind" as const, detail: "Best-in-class brands maintain real-time sync across all channels. Manual reconciliation causes 3–5% revenue leakage on average." },
      { metric: "Post-Purchase Automation", yourPosition: "ahead" as const, detail: "Top performers automate 90%+ of post-purchase communications. This single lever drives 15–30% of repeat purchase revenue." },
    ],
    competitiveWindow: "You have a 3–6 month window to address the structural gaps before they become competitive liabilities. Your peers who act now will have measurably better unit economics and customer experience within two quarters.",
  },

  // Phase 4 expansion — Quick Wins
  quickWins: [
    {
      title: "Document Your Top 5 Processes",
      description: "Identify the 5 most-repeated processes in your business and write step-by-step documentation. This alone reveals automation opportunities and reduces key-person dependency.",
      effort: "low" as const,
      expectedImpact: "Reduces onboarding time by 30% and creates the foundation for automation.",
    },
    {
      title: "Set Up Automated Review Requests",
      description: "Configure post-delivery review request emails with a 5–7 day delay. Most platforms support this natively with no custom code.",
      effort: "low" as const,
      expectedImpact: "15–25% increase in review volume within 30 days.",
    },
    {
      title: "Audit Your Tool Stack",
      description: "List every tool your team uses, who uses it, and what data it holds. Identify overlaps, gaps, and manual handoffs between tools.",
      effort: "low" as const,
      expectedImpact: "Reveals 2–4 integration opportunities and eliminates redundant subscriptions.",
    },
  ],

  // Phase 4 expansion — Implementation Timeline
  implementationTimeline: {
    phases: [
      { label: "Discovery & Validation", weeks: "Weeks 1–2", description: "We validate the diagnostic findings with your team, map current processes in detail, and quantify the true cost of each bottleneck.", milestones: ["Stakeholder interviews completed", "Current-state process maps documented", "Bottleneck cost quantification validated", "Quick win opportunities confirmed"] },
      { label: "Architecture & Quick Wins", weeks: "Weeks 3–5", description: "Design the target-state systems architecture while simultaneously implementing high-impact quick wins.", milestones: ["Target-state architecture approved", "2–3 quick win automations deployed", "Integration specs completed", "Team training plan developed"] },
      { label: "Build & Deploy", weeks: "Weeks 6–10", description: "Build and deploy core system improvements in iterative sprints.", milestones: ["Core automation workflows deployed", "System integrations live", "Team trained on new processes", "Performance dashboards operational"] },
      { label: "Optimise & Handoff", weeks: "Weeks 11–12", description: "Fine-tune performance and complete knowledge transfer.", milestones: ["Performance optimisation complete", "Edge cases resolved", "Documentation handoff", "ROI validation report delivered"] },
    ],
    totalDuration: "12 weeks",
  },

  // Call to action
  callSchedulingUrl: "https://calendly.com/marqcortex-team/readiness-call"
};

/**
 * PRODUCTION: This data comes from Cortex AI analysis
 * 
 * const report = await generateClientReport(leadId);
 * 
 * Backend would:
 * 1. Fetch CortexLeadData from database
 * 2. Transform into client-friendly language
 * 3. Remove internal details (confidence scores, overrides, etc.)
 * 4. Focus on diagnosis + next step (not full proposal)
 * 5. Return data matching ClientReadinessReportProps interface
 */