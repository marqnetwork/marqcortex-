/**
 * INDUSTRY-SPECIFIC SOLUTION BLUEPRINTS
 *
 * Returns a SolutionBlueprint tailored to the lead's industry.
 * Used by mockCortexData.ts to generate realistic blueprints for all 9 industries.
 */

import type { SolutionBlueprint } from '@/app/types/cortex-types';

export function getIndustryBlueprint(industry: string, company: string): SolutionBlueprint {
  switch (industry) {
    case 'SaaS / Software':
      return saasBlueprint(company);
    case 'Agency / Services':
      return agencyBlueprint(company);
    case 'Healthcare / Medical':
      return healthcareBlueprint(company);
    case 'Manufacturing / Supply Chain':
      return manufacturingBlueprint(company);
    case 'Creators / Training / Courses':
      return creatorsBlueprint(company);
    case 'Non-Profit / Education':
      return nonprofitBlueprint(company);
    case 'Government / Public Sector':
      return governmentBlueprint(company);
    default:
      return ecommerceBlueprint(company);
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

const universalRisks = (industry: string) => [
  { risk: 'Team resistance to new tools and workflows', probability: 'low' as const, impact: 'high' as const, mitigation: 'Involve team in design from Day 1. Show individual time savings clearly. 30-day check-in to address concerns.', owner: 'Operations Lead' },
];

// ── E-commerce / DTC ──────────────────────────────────────────────────────────

function ecommerceBlueprint(company: string): SolutionBlueprint {
  return {
    executiveSummary: `${company} is losing an estimated $5-8K/month in revenue leakage and burning 120+ hours/month on manual tasks. This 30-day sprint targets customer service overload, multi-channel inventory chaos, and cart abandonment. We project 40-60% ticket reduction, zero oversells, and 15-20% revenue lift within 90 days.`,
    phases: [
      {
        name: 'Customer Service AI', duration: 'Days 1-10',
        objectives: ['Eliminate 60% of tier-1 support tickets via AI chatbot', 'Reduce average response time from 24hrs to under 2hrs', 'Free support team for complex, high-value interactions'],
        deliverables: [
          { item: 'AI Chatbot Implementation', description: 'Trained on FAQ, order status, returns policy, and shipping updates. Handles 60%+ of tickets autonomously.' },
          { item: 'Self-Service Order Tracking Portal', description: 'Branded portal showing real-time order status, tracking info, and delivery estimates.' },
          { item: 'Automated Shipping Notifications', description: 'Proactive email/SMS at order confirmation, shipment, out-for-delivery, and delivered.' },
          { item: 'Support Team Playbook', description: 'Documented escalation paths, response templates, and decision authority.' },
        ],
        teamRequired: ['AI Engineer', 'UX Designer', 'CS Team Lead'],
        milestones: [{ day: 'Day 3', milestone: 'Chatbot prototype live in staging' }, { day: 'Day 5', milestone: 'Self-service portal UI complete' }, { day: 'Day 7', milestone: 'Internal testing with support team' }, { day: 'Day 10', milestone: 'Production rollout + team training' }],
        linkedBottleneck: 'Customer Service Bottleneck',
        risksMitigated: ['Scale-breaking ticket volume', 'Founder approval bottleneck', 'Response time degradation'],
      },
      {
        name: 'Inventory Sync & Visibility', duration: 'Days 11-20',
        objectives: ['Eliminate manual inventory sync across all channels', 'Zero oversells through real-time stock validation', 'Live inventory dashboard for leadership'],
        deliverables: [
          { item: 'Multi-Channel Inventory Integration', description: 'API-based real-time sync between Shopify, Amazon, and social channels.' },
          { item: 'Low-Stock Alert System', description: 'Automated alerts when top SKUs hit reorder thresholds.' },
          { item: 'Inventory Analytics Dashboard', description: 'Real-time stock levels by channel, sell-through rates, dead stock identification.' },
          { item: 'Fulfillment Partner API Connection', description: 'Direct API integration replacing manual CSV exports/imports.' },
        ],
        teamRequired: ['Integration Engineer', 'Data Analyst', 'Operations Lead'],
        milestones: [{ day: 'Day 12', milestone: 'Shopify-Amazon sync live in test' }, { day: 'Day 15', milestone: 'Alert system configured' }, { day: 'Day 18', milestone: 'Dashboard deployed' }, { day: 'Day 20', milestone: 'Full production sync' }],
        linkedBottleneck: 'Multi-Channel Inventory Chaos',
        risksMitigated: ['Oversell incidents', 'Stockout revenue loss', 'Manual data entry errors'],
      },
      {
        name: 'Retention & Revenue Recovery', duration: 'Days 21-30',
        objectives: ['Recover 15-20% of abandoned carts', 'Post-purchase retention flow for repeat revenue', 'Customer segmentation for targeted marketing'],
        deliverables: [
          { item: 'Cart Abandonment Recovery System', description: '3-email sequence triggered within 1hr, 24hr, and 72hr of abandonment.' },
          { item: 'Post-Purchase Retention Flow', description: 'Automated 5-email sequence: confirmation, shipping, delivery, review request, repurchase incentive.' },
          { item: 'Customer Segmentation Engine', description: 'RFM-based segmentation into VIP, At-Risk, Lapsed, and New segments.' },
          { item: 'Win-Back Campaign Template', description: 'Lapsed customer re-engagement sequence with progressive incentives.' },
        ],
        teamRequired: ['Email Marketing Specialist', 'Data Analyst', 'Growth Lead'],
        milestones: [{ day: 'Day 22', milestone: 'Cart recovery emails live' }, { day: 'Day 25', milestone: 'Post-purchase flow activated' }, { day: 'Day 28', milestone: 'Segmentation complete' }, { day: 'Day 30', milestone: 'Full system handoff' }],
        linkedBottleneck: 'High Customer Acquisition Costs',
        risksMitigated: ['Cart abandonment revenue loss', 'Customer lifetime value erosion', 'Marketing spend waste'],
      },
    ],
    kpis: [
      { metric: 'Support Ticket Volume', baseline: '200+/week', target30: '<120/week', target60: '<100/week', target90: '<80/week', measurementMethod: 'Helpdesk ticket count (excluding chatbot-resolved)' },
      { metric: 'Average Response Time', baseline: '24+ hours', target30: '<4 hours', target60: '<2 hours', target90: '<1 hour', measurementMethod: 'Helpdesk first-response time' },
      { metric: 'Inventory Oversell Incidents', baseline: '2-3x/week', target30: '<1/week', target60: '0/week', target90: '0/week', measurementMethod: 'Order cancellation tracking for oversells' },
      { metric: 'Cart Recovery Rate', baseline: '~2% (manual)', target30: '8-10%', target60: '12-15%', target90: '15-20%', measurementMethod: 'Abandoned cart recovery email conversion' },
      { metric: 'Repeat Purchase Rate', baseline: '40%', target30: '42%', target60: '45%', target90: '48-50%', measurementMethod: 'Shopify returning customer percentage' },
      { metric: 'Founder Hours Freed', baseline: '0 hrs/week', target30: '8 hrs/week', target60: '12 hrs/week', target90: '15+ hrs/week', measurementMethod: 'Time tracking on operational vs strategic work' },
    ],
    riskRegister: [
      { risk: 'Chatbot quality issues frustrate customers', probability: 'medium', impact: 'high', mitigation: 'Phased rollout starting with low-risk queries. Human escalation for anything uncertain. 2-week monitoring.', owner: 'AI Engineer + CS Lead' },
      { risk: 'Inventory sync API instability', probability: 'medium', impact: 'medium', mitigation: 'Retry logic, fallback manual sync trigger, daily reconciliation for first 2 weeks.', owner: 'Integration Engineer' },
      ...universalRisks('E-commerce / DTC'),
      { risk: 'Email deliverability — cart recovery emails hit spam', probability: 'low', impact: 'medium', mitigation: 'Verified sending domain, warm up reputation gradually, A/B test subject lines.', owner: 'Email Marketing Specialist' },
    ],
    investmentSummary: { totalRange: '$12K - $18K', breakdownByPhase: [{ phase: 'Phase 1: Customer Service AI', range: '$4K - $6K' }, { phase: 'Phase 2: Inventory Sync', range: '$4K - $6K' }, { phase: 'Phase 3: Retention Engine', range: '$4K - $6K' }], paybackPeriod: '6-8 weeks', roiTimeline: '400-600%' },
    resourcePlan: [
      { role: 'AI Engineer', allocation: 'Full-time', phase: 'Phase 1 (Days 1-10)' },
      { role: 'UX Designer', allocation: '50%', phase: 'Phase 1 (Days 1-10)' },
      { role: 'Integration Engineer', allocation: 'Full-time', phase: 'Phase 2 (Days 11-20)' },
      { role: 'Data Analyst', allocation: '50%', phase: 'Phase 2-3 (Days 11-30)' },
      { role: 'Email Marketing Specialist', allocation: 'Full-time', phase: 'Phase 3 (Days 21-30)' },
      { role: 'Operations Lead', allocation: '25%', phase: 'All Phases' },
    ],
  };
}

// ── SaaS / Software ───────────────────────────────────────────────────────────

function saasBlueprint(company: string): SolutionBlueprint {
  return {
    executiveSummary: `${company} is experiencing churn driven by manual onboarding and missing activation triggers. This 30-day sprint targets onboarding automation, churn signal detection, and expansion revenue capture. We project 20-30% churn reduction and 15% expansion revenue lift within 90 days.`,
    phases: [
      {
        name: 'Onboarding Automation', duration: 'Days 1-10',
        objectives: ['Automate 80% of onboarding with self-serve flows', 'Implement activation milestone triggers', 'Reduce time-to-value from 14 days to 3 days'],
        deliverables: [
          { item: 'Self-Serve Onboarding Flow', description: 'Interactive product tour with milestone-based progress tracking and automated check-ins.' },
          { item: 'Activation Trigger System', description: 'Event-based triggers detecting key actions, automatically advancing users through onboarding.' },
          { item: 'Onboarding Health Dashboard', description: 'Real-time completion rates, drop-off points, and time-to-activation by cohort.' },
          { item: 'CS Escalation Playbook', description: 'Automated alerts when users stall at critical steps, with templated intervention sequences.' },
        ],
        teamRequired: ['Product Engineer', 'Customer Success Lead', 'Data Analyst'],
        milestones: [{ day: 'Day 3', milestone: 'Onboarding flow prototype in staging' }, { day: 'Day 5', milestone: 'Activation triggers configured' }, { day: 'Day 7', milestone: 'Health dashboard live' }, { day: 'Day 10', milestone: 'Full production rollout' }],
        linkedBottleneck: 'Manual Onboarding',
        risksMitigated: ['Early churn', 'CS capacity constraints', 'Inconsistent activation rates'],
      },
      {
        name: 'Churn Signal Detection', duration: 'Days 11-20',
        objectives: ['Detect at-risk accounts 30+ days before churn', 'Automate intervention workflows', 'Build usage-based health scoring'],
        deliverables: [
          { item: 'Customer Health Score Model', description: 'Composite score from login frequency, feature adoption, support sentiment, and billing patterns.' },
          { item: 'At-Risk Alert System', description: 'Real-time Slack/email alerts when accounts drop below health thresholds.' },
          { item: 'Retention Playbook Automation', description: 'Outreach sequences triggered by churn signals: usage decline, failed payments, escalations.' },
          { item: 'Churn Prediction Dashboard', description: 'Weekly risk-tier view with trend analysis and revenue impact projections.' },
        ],
        teamRequired: ['Data Engineer', 'CS Manager', 'Product Manager'],
        milestones: [{ day: 'Day 12', milestone: 'Health score model v1 deployed' }, { day: 'Day 15', milestone: 'At-risk alerting live' }, { day: 'Day 18', milestone: 'Retention playbooks automated' }, { day: 'Day 20', milestone: 'Dashboard live with historical data' }],
        linkedBottleneck: 'Customer Churn',
        risksMitigated: ['Silent churn', 'Reactive CS model', 'Revenue predictability gaps'],
      },
      {
        name: 'Expansion Revenue Engine', duration: 'Days 21-30',
        objectives: ['Surface upsell opportunities from usage data', 'Automate expansion triggers', 'Increase net revenue retention to 110%+'],
        deliverables: [
          { item: 'Usage-Based Upsell Triggers', description: 'Automated detection of accounts exceeding plan limits, triggering contextual upgrade prompts.' },
          { item: 'In-App Expansion Prompts', description: 'Behaviour-driven feature discovery and upgrade CTAs with frequency caps.' },
          { item: 'CS Expansion Playbook', description: 'QBR templates and expansion conversation guides based on account health.' },
          { item: 'Revenue Expansion Dashboard', description: 'Expansion MRR tracking, upgrade rates, and pipeline by segment.' },
        ],
        teamRequired: ['Growth Engineer', 'CS Lead', 'Product Manager'],
        milestones: [{ day: 'Day 22', milestone: 'Upsell triggers configured' }, { day: 'Day 25', milestone: 'In-app prompts live' }, { day: 'Day 28', milestone: 'CS playbook delivered' }, { day: 'Day 30', milestone: 'System handoff + optimisation guide' }],
        linkedBottleneck: 'Flat Net Revenue Retention',
        risksMitigated: ['Missed expansion revenue', 'NRR below 100%', 'Manual upsell processes'],
      },
    ],
    kpis: [
      { metric: 'Time-to-Activation', baseline: '14 days', target30: '5 days', target60: '3 days', target90: '2 days', measurementMethod: 'Median days to first core action' },
      { metric: 'Monthly Churn Rate', baseline: '5%', target30: '4%', target60: '3.5%', target90: '3%', measurementMethod: 'MRR lost / starting MRR' },
      { metric: 'Net Revenue Retention', baseline: '95%', target30: '100%', target60: '105%', target90: '110%+', measurementMethod: 'Expansion offset against contraction + churn' },
      { metric: 'Onboarding Completion', baseline: '45%', target30: '65%', target60: '75%', target90: '80%+', measurementMethod: 'Milestones completed within 7 days' },
    ],
    riskRegister: [
      { risk: 'Onboarding changes cause short-term confusion', probability: 'medium', impact: 'medium', mitigation: 'A/B test against existing flow. Gradual rollout to new signups only.', owner: 'Product Engineer' },
      { risk: 'Health score produces false positives', probability: 'medium', impact: 'low', mitigation: 'Conservative thresholds. Manual review for first 2 weeks.', owner: 'Data Engineer' },
      ...universalRisks('SaaS / Software'),
    ],
    investmentSummary: { totalRange: '$18K - $28K', breakdownByPhase: [{ phase: 'Phase 1: Onboarding', range: '$6K - $10K' }, { phase: 'Phase 2: Churn Detection', range: '$6K - $9K' }, { phase: 'Phase 3: Expansion', range: '$6K - $9K' }], paybackPeriod: '4-6 weeks', roiTimeline: '500-800%' },
    resourcePlan: [
      { role: 'Product Engineer', allocation: 'Full-time', phase: 'Phase 1' },
      { role: 'Data Engineer', allocation: 'Full-time', phase: 'Phase 2' },
      { role: 'Growth Engineer', allocation: 'Full-time', phase: 'Phase 3' },
      { role: 'CS Lead', allocation: '50%', phase: 'All Phases' },
    ],
  };
}

// ── Agency / Services ─────────────────────────────────────────────────────────

function agencyBlueprint(company: string): SolutionBlueprint {
  return {
    executiveSummary: `${company} is constrained by founder dependency and inconsistent delivery quality. This 30-day sprint targets delegation frameworks, delivery standardisation, and client reporting automation. We project 15+ hours/week freed for founders and 30% faster project delivery within 90 days.`,
    phases: [
      {
        name: 'Founder Delegation Framework', duration: 'Days 1-10',
        objectives: ['Eliminate founder bottleneck for 80% of decisions', 'Create clear authority boundaries', 'Build approval automation'],
        deliverables: [
          { item: 'Decision Authority Matrix', description: 'Documentation of who approves what, with dollar thresholds and escalation rules.' },
          { item: 'Automated Approval Workflows', description: 'Slack-based approval flows for routine decisions with auto-approve after 24h.' },
          { item: 'Client Communication Templates', description: 'Pre-approved response templates empowering team to act without founder.' },
          { item: 'Weekly Review Cadence', description: 'Structured review replacing ad-hoc check-ins. Async-first, sync for exceptions.' },
        ],
        teamRequired: ['Operations Consultant', 'Founder/CEO', 'Team Leads'],
        milestones: [{ day: 'Day 3', milestone: 'Decision matrix drafted' }, { day: 'Day 5', milestone: 'Approval workflows in Slack' }, { day: 'Day 7', milestone: 'Templates library created' }, { day: 'Day 10', milestone: 'Team trained, new cadence launched' }],
        linkedBottleneck: 'Founder Approval Bottleneck',
        risksMitigated: ['Founder burnout', 'Decision delays', 'Team dependency'],
      },
      {
        name: 'Delivery Standardisation', duration: 'Days 11-20',
        objectives: ['Standardise 70% of delivery into templates', 'Reduce project setup time by 60%', 'Consistent quality across all team members'],
        deliverables: [
          { item: 'Project Template Library', description: 'Pre-built templates for top 5 engagement types with milestones and allocations.' },
          { item: 'Quality Checklist System', description: 'Stage-gate checklists auto-assigned at milestone completion.' },
          { item: 'Client Onboarding Automation', description: 'Standardised onboarding with automated welcome, kickoff scheduling, asset collection.' },
          { item: 'Capacity Planning Dashboard', description: 'Real-time utilisation, upcoming capacity, and project health.' },
        ],
        teamRequired: ['Operations Consultant', 'Senior PM', 'Design Lead'],
        milestones: [{ day: 'Day 12', milestone: 'Top 5 templates drafted' }, { day: 'Day 15', milestone: 'Quality checklists configured' }, { day: 'Day 18', milestone: 'Client onboarding automated' }, { day: 'Day 20', milestone: 'Capacity dashboard live' }],
        linkedBottleneck: 'Delivery Quality Inconsistency',
        risksMitigated: ['Quality variance', 'Setup inefficiency', 'Scope creep'],
      },
      {
        name: 'Client Reporting Automation', duration: 'Days 21-30',
        objectives: ['Eliminate manual report creation (save 8+ hrs/week)', 'Real-time client project visibility', 'Automated feedback loops'],
        deliverables: [
          { item: 'Automated Status Reports', description: 'Weekly reports auto-generated from PM data. Customisable templates per client.' },
          { item: 'Client Portal', description: 'Branded dashboard showing project progress, deliverables, and milestones.' },
          { item: 'Automated NPS Collection', description: 'Post-milestone and post-project surveys with automated detractor follow-up.' },
          { item: 'Revenue Forecasting Model', description: 'Pipeline-based forecast with project timelines and retainer renewals.' },
        ],
        teamRequired: ['Automation Specialist', 'Data Analyst', 'Account Manager'],
        milestones: [{ day: 'Day 22', milestone: 'Report templates automated' }, { day: 'Day 25', milestone: 'Client portal prototype live' }, { day: 'Day 28', milestone: 'NPS system configured' }, { day: 'Day 30', milestone: 'System handoff + playbook' }],
        linkedBottleneck: 'Manual Client Reporting',
        risksMitigated: ['PM time waste', 'Client visibility gaps', 'Revenue unpredictability'],
      },
    ],
    kpis: [
      { metric: 'Founder Hours on Ops', baseline: '25+ hrs/week', target30: '15 hrs', target60: '10 hrs', target90: '<8 hrs', measurementMethod: 'Time tracking' },
      { metric: 'Project Setup Time', baseline: '8-12 hours', target30: '4 hours', target60: '2 hours', target90: '<1 hour', measurementMethod: 'SOW to kickoff' },
      { metric: 'Team Utilisation Rate', baseline: 'Unknown', target30: '65%', target60: '72%', target90: '78%', measurementMethod: 'Billable / available hours' },
      { metric: 'Report Generation', baseline: '3-4 hrs/client/week', target30: '30 min', target60: '15 min', target90: 'Automated', measurementMethod: 'PM time logs' },
    ],
    riskRegister: [
      { risk: 'Team resists delegation — continues escalating', probability: 'medium', impact: 'high', mitigation: 'Involve team in design. Start with low-stakes decisions. Celebrate autonomous decisions.', owner: 'Founder/CEO' },
      ...universalRisks('Agency / Services'),
    ],
    investmentSummary: { totalRange: '$10K - $16K', breakdownByPhase: [{ phase: 'Phase 1: Delegation', range: '$3K - $5K' }, { phase: 'Phase 2: Standardisation', range: '$4K - $6K' }, { phase: 'Phase 3: Reporting', range: '$3K - $5K' }], paybackPeriod: '4-6 weeks', roiTimeline: '350-500%' },
    resourcePlan: [
      { role: 'Operations Consultant', allocation: 'Full-time', phase: 'Phase 1-2' },
      { role: 'Automation Specialist', allocation: 'Full-time', phase: 'Phase 3' },
      { role: 'Founder/CEO', allocation: '25%', phase: 'All Phases' },
    ],
  };
}

// ── Healthcare / Medical ──────────────────────────────────────────────────────

function healthcareBlueprint(company: string): SolutionBlueprint {
  return {
    executiveSummary: `${company} is losing clinical capacity to administrative overhead. This sprint targets patient intake automation, scheduling optimisation, and compliance-safe documentation workflows. We project 20+ hours/week freed per clinician and 25-40% no-show reduction within 90 days.`,
    phases: [
      {
        name: 'Patient Intake Automation', duration: 'Days 1-10',
        objectives: ['Digitise 100% of intake forms', 'Reduce check-in from 15 to 3 minutes', 'Eliminate data entry errors'],
        deliverables: [
          { item: 'Digital Pre-Visit Forms', description: 'HIPAA-compliant digital forms sent 48h before appointment. Auto-populates EHR.' },
          { item: 'Automated Insurance Verification', description: 'Pre-visit eligibility check with alerts for coverage issues.' },
          { item: 'Smart Check-In Flow', description: 'Tablet-based check-in confirming pre-submitted data and routing patients.' },
          { item: 'Data Quality Dashboard', description: 'Intake completion rates, errors, and insurance verification status.' },
        ],
        teamRequired: ['Healthcare IT Specialist', 'Compliance Officer', 'Front Desk Lead'],
        milestones: [{ day: 'Day 3', milestone: 'Digital forms HIPAA-reviewed' }, { day: 'Day 5', milestone: 'Insurance API connected' }, { day: 'Day 7', milestone: 'Pilot with 10 patients' }, { day: 'Day 10', milestone: 'Full rollout' }],
        linkedBottleneck: 'Administrative Overhead',
        risksMitigated: ['Data entry errors', 'Check-in delays', 'Insurance claim denials'],
      },
      {
        name: 'Scheduling & No-Show Reduction', duration: 'Days 11-20',
        objectives: ['Reduce no-shows by 25-40%', 'Automate multi-channel reminders', 'Optimise schedule to 90%+ utilisation'],
        deliverables: [
          { item: 'Multi-Channel Reminders', description: 'SMS/email/voice at 72h, 24h, 2h with one-tap confirm/reschedule.' },
          { item: 'Waitlist Automation', description: 'Automatic backfill of cancelled slots from waitlist.' },
          { item: 'Schedule Optimisation', description: 'AI-suggested patterns based on no-show data and appointment durations.' },
          { item: 'No-Show Analytics', description: 'Rates by provider, day, appointment type, and patient segment.' },
        ],
        teamRequired: ['Healthcare IT Specialist', 'Office Manager', 'Provider Champion'],
        milestones: [{ day: 'Day 12', milestone: 'Reminders live' }, { day: 'Day 15', milestone: 'Waitlist automation configured' }, { day: 'Day 18', milestone: 'Schedule optimisation live' }, { day: 'Day 20', milestone: 'Analytics deployed' }],
        linkedBottleneck: 'Revenue Loss from No-Shows',
        risksMitigated: ['Lost revenue', 'Communication gaps', 'Schedule inefficiency'],
      },
      {
        name: 'Documentation & Compliance', duration: 'Days 21-30',
        objectives: ['Reduce documentation time by 40%', '100% compliance with audit-ready records', 'Automate follow-up care coordination'],
        deliverables: [
          { item: 'Smart Documentation Templates', description: 'Specialty-specific templates with auto-populated fields. 50%+ less typing.' },
          { item: 'Compliance Audit Trail', description: 'Automated logging of all patient data access and changes.' },
          { item: 'Care Coordination Automation', description: 'Referral tracking, lab follow-ups, and preventive care reminders.' },
          { item: 'Provider Productivity Dashboard', description: 'Patients seen, documentation time, no-show rate, satisfaction scores.' },
        ],
        teamRequired: ['Healthcare IT Specialist', 'Compliance Officer', 'Clinical Lead'],
        milestones: [{ day: 'Day 22', milestone: 'Templates deployed' }, { day: 'Day 25', milestone: 'Audit trail live' }, { day: 'Day 28', milestone: 'Care coordination automated' }, { day: 'Day 30', milestone: 'Handoff + compliance sign-off' }],
        linkedBottleneck: 'Documentation Burden',
        risksMitigated: ['Compliance violations', 'Provider burnout', 'Missed follow-ups'],
      },
    ],
    kpis: [
      { metric: 'Check-In Time', baseline: '15 min', target30: '5 min', target60: '3 min', target90: '<2 min', measurementMethod: 'Front desk timing' },
      { metric: 'No-Show Rate', baseline: '18-22%', target30: '14%', target60: '11%', target90: '<10%', measurementMethod: 'Scheduling system tracking' },
      { metric: 'Documentation Time', baseline: '25 min/visit', target30: '18 min', target60: '15 min', target90: '12 min', measurementMethod: 'EHR session duration' },
      { metric: 'Schedule Utilisation', baseline: '72%', target30: '80%', target60: '85%', target90: '90%+', measurementMethod: 'Filled / available slots' },
    ],
    riskRegister: [
      { risk: 'Provider resistance to new documentation', probability: 'medium', impact: 'high', mitigation: 'Clinical champion from Day 1. Pilot with tech-savvy provider. Weekly time savings data.', owner: 'Clinical Lead' },
      { risk: 'HIPAA compliance gap during transition', probability: 'low', impact: 'high', mitigation: 'Compliance officer reviews every change before deployment.', owner: 'Compliance Officer' },
      ...universalRisks('Healthcare / Medical'),
    ],
    investmentSummary: { totalRange: '$20K - $35K', breakdownByPhase: [{ phase: 'Phase 1: Intake', range: '$6K - $10K' }, { phase: 'Phase 2: Scheduling', range: '$7K - $12K' }, { phase: 'Phase 3: Documentation', range: '$7K - $13K' }], paybackPeriod: '6-10 weeks', roiTimeline: '300-500%' },
    resourcePlan: [
      { role: 'Healthcare IT Specialist', allocation: 'Full-time', phase: 'All Phases' },
      { role: 'Compliance Officer', allocation: '25%', phase: 'All Phases' },
      { role: 'Office Manager', allocation: '50%', phase: 'Phase 2' },
    ],
  };
}

// ── Manufacturing / Supply Chain ──────────────────────────────────────────────

function manufacturingBlueprint(company: string): SolutionBlueprint {
  return {
    executiveSummary: `${company} is running on spreadsheet-based inventory and disconnected production tracking. This sprint targets real-time inventory visibility, production scheduling automation, and quality control digitalisation. We project 30-50% reduction in stockouts and 20% improvement in production throughput within 90 days.`,
    phases: [
      {
        name: 'Inventory Visibility System', duration: 'Days 1-12',
        objectives: ['Replace spreadsheets with real-time inventory tracking', 'Automate reorder point alerts', 'Unified view across warehouses'],
        deliverables: [
          { item: 'Real-Time Inventory Dashboard', description: 'Live stock levels across all warehouses with drill-down by SKU, location, and age.' },
          { item: 'Automated Reorder System', description: 'Velocity-based reorder triggers with suggested PO quantities and lead time calculations.' },
          { item: 'Barcode/QR Scanning Integration', description: 'Mobile scanning for receiving, picking, and cycle counts replacing manual entry.' },
          { item: 'Supplier Performance Tracker', description: 'Lead time, defect rate, and on-time delivery tracking by supplier.' },
        ],
        teamRequired: ['Systems Engineer', 'Warehouse Manager', 'Data Analyst'],
        milestones: [{ day: 'Day 4', milestone: 'Dashboard prototype with sample data' }, { day: 'Day 7', milestone: 'Scanning integration tested' }, { day: 'Day 10', milestone: 'Reorder alerts configured' }, { day: 'Day 12', milestone: 'Full warehouse rollout' }],
        linkedBottleneck: 'Spreadsheet-Based Inventory',
        risksMitigated: ['Stockouts', 'Overstock carrying costs', 'Manual counting errors'],
      },
      {
        name: 'Production Scheduling', duration: 'Days 13-22',
        objectives: ['Automate production scheduling based on demand', 'Reduce changeover time waste by 25%', 'Real-time production status visibility'],
        deliverables: [
          { item: 'Production Planning Engine', description: 'Demand-driven scheduling with capacity constraints and material availability checks.' },
          { item: 'Shop Floor Dashboard', description: 'Real-time production status, machine utilisation, and bottleneck identification.' },
          { item: 'Changeover Optimisation', description: 'Sequencing algorithm that minimises changeover time between production runs.' },
          { item: 'Production Alert System', description: 'Automated alerts for delays, quality holds, and capacity constraints.' },
        ],
        teamRequired: ['Manufacturing Engineer', 'Production Manager', 'Systems Engineer'],
        milestones: [{ day: 'Day 14', milestone: 'Planning engine v1 with test data' }, { day: 'Day 17', milestone: 'Shop floor dashboard live' }, { day: 'Day 20', milestone: 'Changeover sequencing active' }, { day: 'Day 22', milestone: 'Alert system deployed' }],
        linkedBottleneck: 'Manual Production Scheduling',
        risksMitigated: ['Production delays', 'Capacity waste', 'Communication gaps'],
      },
      {
        name: 'Quality Control Digitalisation', duration: 'Days 23-30',
        objectives: ['Digitalise quality inspection workflows', 'Automate non-conformance tracking', 'Build traceability for compliance'],
        deliverables: [
          { item: 'Digital Inspection Forms', description: 'Mobile inspection checklists with photo capture and auto-routing to quality team.' },
          { item: 'Non-Conformance Management', description: 'Automated NCR creation, assignment, and resolution tracking with root cause analysis.' },
          { item: 'Traceability System', description: 'Lot/batch tracking from raw material receipt through finished goods shipment.' },
          { item: 'Quality KPI Dashboard', description: 'Defect rates, first-pass yield, CAPA status, and supplier quality trends.' },
        ],
        teamRequired: ['Quality Engineer', 'Systems Engineer', 'Production Lead'],
        milestones: [{ day: 'Day 24', milestone: 'Digital forms deployed' }, { day: 'Day 26', milestone: 'NCR workflow automated' }, { day: 'Day 28', milestone: 'Traceability system live' }, { day: 'Day 30', milestone: 'Quality dashboard + handoff' }],
        linkedBottleneck: 'Manual Quality Processes',
        risksMitigated: ['Compliance gaps', 'Defect escape', 'Recall risk'],
      },
    ],
    kpis: [
      { metric: 'Stockout Incidents', baseline: '8-12/month', target30: '4-6', target60: '2-3', target90: '<2', measurementMethod: 'Inventory system stockout tracking' },
      { metric: 'Production Throughput', baseline: 'Baseline', target30: '+10%', target60: '+15%', target90: '+20%', measurementMethod: 'Units produced per shift' },
      { metric: 'First-Pass Yield', baseline: '88%', target30: '91%', target60: '93%', target90: '95%', measurementMethod: 'Good units / total units produced' },
      { metric: 'Inventory Accuracy', baseline: '82%', target30: '92%', target60: '96%', target90: '98%+', measurementMethod: 'Cycle count accuracy' },
    ],
    riskRegister: [
      { risk: 'Shop floor staff resist digital tools', probability: 'medium', impact: 'high', mitigation: 'Involve operators in design. Simple tablet UI. Show how it removes paperwork, not adds to it.', owner: 'Production Manager' },
      ...universalRisks('Manufacturing / Supply Chain'),
    ],
    investmentSummary: { totalRange: '$22K - $38K', breakdownByPhase: [{ phase: 'Phase 1: Inventory', range: '$8K - $14K' }, { phase: 'Phase 2: Scheduling', range: '$8K - $12K' }, { phase: 'Phase 3: Quality', range: '$6K - $12K' }], paybackPeriod: '8-12 weeks', roiTimeline: '300-500%' },
    resourcePlan: [
      { role: 'Systems Engineer', allocation: 'Full-time', phase: 'All Phases' },
      { role: 'Warehouse Manager', allocation: '50%', phase: 'Phase 1' },
      { role: 'Production Manager', allocation: '50%', phase: 'Phase 2' },
      { role: 'Quality Engineer', allocation: '50%', phase: 'Phase 3' },
    ],
  };
}

// ── Creators / Training / Courses ─────────────────────────────────────────────

function creatorsBlueprint(company: string): SolutionBlueprint {
  return {
    executiveSummary: `${company} is losing 60% of creator/founder time to manual student support and course operations. This sprint targets student self-service, automated course delivery, and revenue optimisation. We project 20+ hours/week freed and 25% revenue increase from better conversion and retention within 90 days.`,
    phases: [
      {
        name: 'Student Self-Service & Support AI', duration: 'Days 1-10',
        objectives: ['Eliminate 70% of repetitive student questions', 'Build self-service knowledge base', 'Free creator for content creation'],
        deliverables: [
          { item: 'AI Support Bot', description: 'Trained on course FAQs, billing questions, and technical troubleshooting.' },
          { item: 'Self-Service Knowledge Base', description: 'Searchable help centre with video walkthroughs and common solutions.' },
          { item: 'Automated Onboarding Sequence', description: 'Welcome emails, platform tour, and first-lesson nudges for new students.' },
          { item: 'Support Analytics Dashboard', description: 'Question categories, resolution rates, and content gaps identified.' },
        ],
        teamRequired: ['AI Specialist', 'Content Writer', 'Course Creator'],
        milestones: [{ day: 'Day 3', milestone: 'Support bot prototype' }, { day: 'Day 5', milestone: 'Knowledge base published' }, { day: 'Day 7', milestone: 'Onboarding sequence live' }, { day: 'Day 10', milestone: 'Full deployment + handoff' }],
        linkedBottleneck: 'Manual Student Support',
        risksMitigated: ['Creator burnout', 'Slow response times', 'Student frustration'],
      },
      {
        name: 'Course Delivery Automation', duration: 'Days 11-20',
        objectives: ['Automate drip content delivery', 'Build progress tracking and completion nudges', 'Reduce drop-off by 30%'],
        deliverables: [
          { item: 'Drip Content System', description: 'Scheduled content release with engagement-based pacing adjustments.' },
          { item: 'Progress Tracking Dashboard', description: 'Student progress, completion rates, and engagement scores per module.' },
          { item: 'Re-Engagement Automation', description: 'Automated nudges for inactive students with personalised content recommendations.' },
          { item: 'Completion Certificate System', description: 'Automated certificate generation and delivery on course completion.' },
        ],
        teamRequired: ['Automation Specialist', 'Course Creator', 'Email Marketer'],
        milestones: [{ day: 'Day 12', milestone: 'Drip system configured' }, { day: 'Day 15', milestone: 'Progress tracking live' }, { day: 'Day 18', milestone: 'Re-engagement sequences active' }, { day: 'Day 20', milestone: 'Certificate system deployed' }],
        linkedBottleneck: 'Manual Course Operations',
        risksMitigated: ['Student drop-off', 'Manual content scheduling', 'Engagement tracking gaps'],
      },
      {
        name: 'Revenue Optimisation', duration: 'Days 21-30',
        objectives: ['Increase course conversion rate by 20%', 'Build upsell and cross-sell automation', 'Launch referral and affiliate system'],
        deliverables: [
          { item: 'Sales Page Optimisation', description: 'A/B tested landing pages with social proof, testimonials, and urgency elements.' },
          { item: 'Upsell & Cross-Sell Flows', description: 'Post-purchase sequences recommending next courses based on completion and interests.' },
          { item: 'Referral System', description: 'Student referral program with automated tracking and reward distribution.' },
          { item: 'Revenue Dashboard', description: 'Sales, refunds, LTV, conversion rates, and affiliate performance in one view.' },
        ],
        teamRequired: ['Growth Marketer', 'Automation Specialist', 'Course Creator'],
        milestones: [{ day: 'Day 22', milestone: 'A/B tests launched' }, { day: 'Day 25', milestone: 'Upsell flows active' }, { day: 'Day 28', milestone: 'Referral system live' }, { day: 'Day 30', milestone: 'Revenue dashboard + handoff' }],
        linkedBottleneck: 'Underoptimised Revenue',
        risksMitigated: ['Low conversion rates', 'Single-product dependency', 'No referral engine'],
      },
    ],
    kpis: [
      { metric: 'Creator Support Hours', baseline: '25+ hrs/week', target30: '10 hrs', target60: '5 hrs', target90: '<3 hrs', measurementMethod: 'Time tracking on support tasks' },
      { metric: 'Course Completion Rate', baseline: '35%', target30: '45%', target60: '55%', target90: '60%+', measurementMethod: 'Students completing all modules' },
      { metric: 'Conversion Rate', baseline: '2.5%', target30: '3.5%', target60: '4.5%', target90: '5%+', measurementMethod: 'Visitors to paid students' },
      { metric: 'Student NPS', baseline: 'Not measured', target30: 'Baseline', target60: '50+', target90: '65+', measurementMethod: 'Automated post-course surveys' },
    ],
    riskRegister: [
      { risk: 'AI bot gives wrong course information', probability: 'medium', impact: 'medium', mitigation: 'Start with FAQ-only scope. Creator reviews all bot training data. Human escalation for complex questions.', owner: 'Course Creator' },
      ...universalRisks('Creators / Training / Courses'),
    ],
    investmentSummary: { totalRange: '$8K - $14K', breakdownByPhase: [{ phase: 'Phase 1: Support AI', range: '$3K - $5K' }, { phase: 'Phase 2: Delivery', range: '$3K - $5K' }, { phase: 'Phase 3: Revenue', range: '$2K - $4K' }], paybackPeriod: '4-6 weeks', roiTimeline: '400-700%' },
    resourcePlan: [
      { role: 'AI Specialist', allocation: 'Full-time', phase: 'Phase 1' },
      { role: 'Automation Specialist', allocation: 'Full-time', phase: 'Phase 2-3' },
      { role: 'Course Creator', allocation: '25%', phase: 'All Phases' },
    ],
  };
}

// ── Non-Profit / Education ────────────────────────────────────────────────────

function nonprofitBlueprint(company: string): SolutionBlueprint {
  return {
    executiveSummary: `${company} has donor data scattered across multiple tools with no unified view, limiting fundraising effectiveness and donor retention. This sprint targets donor data unification, automated engagement workflows, and impact reporting. We project 30% improvement in donor retention and 20+ hours/week saved on administrative tasks within 90 days.`,
    phases: [
      {
        name: 'Donor Data Unification', duration: 'Days 1-12',
        objectives: ['Single source of truth for all donor data', 'Eliminate duplicate records', 'Unified donor timeline view'],
        deliverables: [
          { item: 'CRM Migration & Cleanup', description: 'Consolidation of donor data from 4+ tools into a single CRM with deduplication.' },
          { item: 'Donor Profile Dashboard', description: 'Unified view of giving history, engagement, communications, and events per donor.' },
          { item: 'Segmentation Engine', description: 'Automated donor segmentation by giving level, recency, frequency, and engagement.' },
          { item: 'Data Quality Monitoring', description: 'Automated alerts for missing fields, duplicate entries, and stale records.' },
        ],
        teamRequired: ['CRM Specialist', 'Data Analyst', 'Development Director'],
        milestones: [{ day: 'Day 4', milestone: 'Data audit complete' }, { day: 'Day 7', milestone: 'CRM migration 80% complete' }, { day: 'Day 10', milestone: 'Segmentation configured' }, { day: 'Day 12', milestone: 'Full migration + team training' }],
        linkedBottleneck: 'Data Fragmentation',
        risksMitigated: ['Data loss', 'Donor miscommunication', 'Missed giving opportunities'],
      },
      {
        name: 'Engagement Automation', duration: 'Days 13-22',
        objectives: ['Automate donor thank-you and stewardship', 'Build recurring giving conversion flows', 'Reduce manual communication effort by 60%'],
        deliverables: [
          { item: 'Automated Thank-You System', description: 'Instant personalised thank-you emails with tax receipts on every donation.' },
          { item: 'Stewardship Sequences', description: 'Automated touchpoint cadence: impact update, annual report, anniversary, renewal ask.' },
          { item: 'Recurring Giving Conversion', description: 'Automated prompts to convert one-time donors to monthly giving based on engagement signals.' },
          { item: 'Event Follow-Up Automation', description: 'Post-event thank-you, survey, and giving opportunity sequences.' },
        ],
        teamRequired: ['Email Automation Specialist', 'Development Associate', 'Communications Lead'],
        milestones: [{ day: 'Day 14', milestone: 'Thank-you automation live' }, { day: 'Day 17', milestone: 'Stewardship sequences configured' }, { day: 'Day 20', milestone: 'Recurring giving prompts active' }, { day: 'Day 22', milestone: 'Event follow-up templates deployed' }],
        linkedBottleneck: 'Manual Donor Communications',
        risksMitigated: ['Donor lapsing', 'Missed stewardship touchpoints', 'Staff overload'],
      },
      {
        name: 'Impact Reporting & Analytics', duration: 'Days 23-30',
        objectives: ['Automate impact report generation', 'Build board-ready dashboards', 'Enable data-driven fundraising decisions'],
        deliverables: [
          { item: 'Impact Report Generator', description: 'Automated annual and quarterly impact reports with giving trends and programme outcomes.' },
          { item: 'Board Dashboard', description: 'Real-time fundraising performance, donor retention, and campaign ROI for board meetings.' },
          { item: 'Campaign Analytics', description: 'Per-campaign performance tracking with cost-per-dollar-raised and donor acquisition metrics.' },
          { item: 'Donor Retention Scorecard', description: 'Monthly retention tracking with at-risk donor identification and re-engagement triggers.' },
        ],
        teamRequired: ['Data Analyst', 'Development Director', 'Communications Lead'],
        milestones: [{ day: 'Day 24', milestone: 'Report templates configured' }, { day: 'Day 26', milestone: 'Board dashboard live' }, { day: 'Day 28', milestone: 'Campaign analytics deployed' }, { day: 'Day 30', milestone: 'System handoff + staff training' }],
        linkedBottleneck: 'Manual Reporting',
        risksMitigated: ['Board reporting delays', 'Fundraising blind spots', 'Donor churn'],
      },
    ],
    kpis: [
      { metric: 'Donor Retention Rate', baseline: '42%', target30: '48%', target60: '53%', target90: '58%+', measurementMethod: 'Year-over-year donor retention' },
      { metric: 'Admin Hours on Data Entry', baseline: '20+ hrs/week', target30: '8 hrs', target60: '4 hrs', target90: '<2 hrs', measurementMethod: 'Staff time tracking' },
      { metric: 'Recurring Giving %', baseline: '15%', target30: '20%', target60: '25%', target90: '30%', measurementMethod: 'Recurring donors / total active donors' },
      { metric: 'Thank-You Response Time', baseline: '3-5 days', target30: '<24 hours', target60: '<1 hour', target90: 'Instant', measurementMethod: 'Time from donation to thank-you delivery' },
    ],
    riskRegister: [
      { risk: 'Data migration causes temporary donor confusion', probability: 'medium', impact: 'medium', mitigation: 'Communication freeze during migration week. Personal outreach to major donors.', owner: 'Development Director' },
      ...universalRisks('Non-Profit / Education'),
    ],
    investmentSummary: { totalRange: '$10K - $18K', breakdownByPhase: [{ phase: 'Phase 1: Data Unification', range: '$4K - $7K' }, { phase: 'Phase 2: Engagement', range: '$3K - $6K' }, { phase: 'Phase 3: Reporting', range: '$3K - $5K' }], paybackPeriod: '6-8 weeks', roiTimeline: '250-400%' },
    resourcePlan: [
      { role: 'CRM Specialist', allocation: 'Full-time', phase: 'Phase 1' },
      { role: 'Email Automation Specialist', allocation: 'Full-time', phase: 'Phase 2' },
      { role: 'Data Analyst', allocation: '50%', phase: 'Phase 1 + 3' },
      { role: 'Development Director', allocation: '25%', phase: 'All Phases' },
    ],
  };
}

// ── Government / Public Sector ────────────────────────────────────────────────

function governmentBlueprint(company: string): SolutionBlueprint {
  return {
    executiveSummary: `${company} is constrained by legacy systems blocking citizen service modernisation. This sprint targets citizen-facing service digitalisation, internal workflow automation, and data integration. We project 40% reduction in service request processing time and measurable improvement in citizen satisfaction within 90 days.`,
    phases: [
      {
        name: 'Citizen Service Digitalisation', duration: 'Days 1-12',
        objectives: ['Move top 5 citizen services to digital self-service', 'Reduce in-person wait times by 50%', 'Provide 24/7 service availability'],
        deliverables: [
          { item: 'Citizen Self-Service Portal', description: 'Online portal for top 5 service requests with status tracking and document uploads.' },
          { item: 'Automated Request Routing', description: 'AI-powered categorisation and routing of citizen requests to appropriate departments.' },
          { item: 'Service Request Dashboard', description: 'Real-time tracking of request volumes, processing times, and resolution rates by department.' },
          { item: 'Accessibility Compliance Audit', description: 'WCAG 2.1 compliance verification for all digital touchpoints.' },
        ],
        teamRequired: ['Government IT Specialist', 'UX Designer', 'Department Liaisons'],
        milestones: [{ day: 'Day 4', milestone: 'Portal prototype reviewed' }, { day: 'Day 7', milestone: 'Top 3 services digitalised' }, { day: 'Day 10', milestone: 'Routing logic configured' }, { day: 'Day 12', milestone: 'Public launch + staff training' }],
        linkedBottleneck: 'Legacy Service Delivery',
        risksMitigated: ['Long wait times', 'Paper-based processes', 'Accessibility gaps'],
      },
      {
        name: 'Internal Workflow Automation', duration: 'Days 13-22',
        objectives: ['Automate interdepartmental approvals', 'Reduce paper-based processes by 70%', 'Build audit trail for compliance'],
        deliverables: [
          { item: 'Digital Approval Workflows', description: 'Automated routing of approvals through department chains with escalation rules.' },
          { item: 'Document Management System', description: 'Centralised document storage with version control and department-level access controls.' },
          { item: 'Compliance Audit Trail', description: 'Automated logging of all actions, approvals, and changes for regulatory compliance.' },
          { item: 'Internal Communications Hub', description: 'Structured channel for cross-department coordination replacing email chains.' },
        ],
        teamRequired: ['Systems Integrator', 'Compliance Officer', 'Department Managers'],
        milestones: [{ day: 'Day 14', milestone: 'Approval workflows configured' }, { day: 'Day 17', milestone: 'Document system deployed' }, { day: 'Day 20', milestone: 'Audit trail active' }, { day: 'Day 22', milestone: 'Staff training complete' }],
        linkedBottleneck: 'Manual Interdepartmental Processes',
        risksMitigated: ['Approval delays', 'Document loss', 'Compliance risk'],
      },
      {
        name: 'Data Integration & Reporting', duration: 'Days 23-30',
        objectives: ['Unify data across departments', 'Build performance dashboards for leadership', 'Enable data-driven policy decisions'],
        deliverables: [
          { item: 'Cross-Department Data Hub', description: 'Unified data layer connecting citizen services, HR, finance, and operations data.' },
          { item: 'Leadership Performance Dashboard', description: 'KPI tracking for citizen satisfaction, processing times, cost per service, and staff productivity.' },
          { item: 'Automated Reporting', description: 'Monthly and quarterly reports auto-generated from live data for council/board meetings.' },
          { item: 'Open Data Portal', description: 'Public-facing data portal with anonymised service metrics for transparency.' },
        ],
        teamRequired: ['Data Engineer', 'Government IT Specialist', 'Policy Analyst'],
        milestones: [{ day: 'Day 24', milestone: 'Data integrations configured' }, { day: 'Day 26', milestone: 'Leadership dashboard live' }, { day: 'Day 28', milestone: 'Automated reports configured' }, { day: 'Day 30', milestone: 'System handoff + documentation' }],
        linkedBottleneck: 'Data Silos',
        risksMitigated: ['Information asymmetry', 'Manual reporting burden', 'Transparency gaps'],
      },
    ],
    kpis: [
      { metric: 'Service Request Processing Time', baseline: '5-7 business days', target30: '3-4 days', target60: '2 days', target90: '<1 day', measurementMethod: 'Portal submission to resolution tracking' },
      { metric: 'Digital Service Adoption', baseline: '0%', target30: '30%', target60: '50%', target90: '70%+', measurementMethod: 'Digital submissions / total submissions' },
      { metric: 'Paper Process Reduction', baseline: '100% paper', target30: '50% digital', target60: '70% digital', target90: '85%+ digital', measurementMethod: 'Paper forms processed vs digital' },
      { metric: 'Citizen Satisfaction', baseline: 'Not measured', target30: 'Baseline set', target60: '65%+', target90: '75%+', measurementMethod: 'Post-service digital survey' },
    ],
    riskRegister: [
      { risk: 'Legacy system integration complexity', probability: 'high', impact: 'high', mitigation: 'API-first approach. Middleware layer. No direct database coupling. Fallback to manual bridge if needed.', owner: 'Government IT Specialist' },
      { risk: 'Citizen adoption of digital services', probability: 'medium', impact: 'medium', mitigation: 'In-person assistance at service centres. Gradual rollout. Paper option maintained during transition.', owner: 'Department Liaisons' },
      ...universalRisks('Government / Public Sector'),
    ],
    investmentSummary: { totalRange: '$25K - $45K', breakdownByPhase: [{ phase: 'Phase 1: Citizen Services', range: '$10K - $18K' }, { phase: 'Phase 2: Workflows', range: '$8K - $14K' }, { phase: 'Phase 3: Data', range: '$7K - $13K' }], paybackPeriod: '10-16 weeks', roiTimeline: '200-400%' },
    resourcePlan: [
      { role: 'Government IT Specialist', allocation: 'Full-time', phase: 'All Phases' },
      { role: 'UX Designer', allocation: '50%', phase: 'Phase 1' },
      { role: 'Data Engineer', allocation: 'Full-time', phase: 'Phase 3' },
      { role: 'Compliance Officer', allocation: '25%', phase: 'All Phases' },
    ],
  };
}
