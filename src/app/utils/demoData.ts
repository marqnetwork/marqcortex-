/**
 * CENTRALIZED DEMO DATA
 *
 * Single source of truth for ALL demo/seed data used when
 * FEATURES.BACKEND_INTEGRATION is false.
 *
 * Components should import from here instead of defining inline demo objects.
 * This makes it easy to:
 *   - Keep demo data consistent across views
 *   - Add/edit demo leads in one place
 *   - Avoid duplicated data and drift between components
 *
 * The mockCortexData.ts file is kept separate because it contains
 * complex CORTEX-specific AI analysis structures — it already acts
 * as a centralized mock for the CortexDashboard.
 */

import type { Submission } from '@/app/lib/api';
import type { TeamMemberRecord } from '@/app/lib/api';
import type { Message } from '@/app/lib/api';

// ============================================================================
// DEMO CLIENT LOGINS
// ============================================================================

export interface DemoClient {
  email: string;
  submissionId: string;
  companyName: string;
}

export const DEMO_CLIENTS: DemoClient[] = [
  { email: 'client@company.com',  submissionId: 'demo-sub-001', companyName: 'Acme Fashion Co.' },
  { email: 'john@business.com',   submissionId: 'demo-sub-002', companyName: 'TechFlow SaaS' },
  { email: 'sarah@startup.io',    submissionId: 'demo-sub-003', companyName: 'Creative Agency Pro' },
];

/** Lookup a demo client by email (case-insensitive). Returns null if not found. */
export function findDemoClient(email: string): DemoClient | null {
  return DEMO_CLIENTS.find((c) => c.email.toLowerCase() === email.toLowerCase()) ?? null;
}

// ============================================================================
// DEMO TEAM MEMBERS
// ============================================================================

export function getDemoTeamMembers(): TeamMemberRecord[] {
  return [
    {
      id: 'user_001',
      email: 'admin@marqcortex.com',
      name: 'Admin User',
      teamRole: 'admin',
      status: 'active',
      joinedDate: '2026-01-01',
      lastActive: new Date().toISOString(),
      isSelf: true,
    },
    {
      id: 'user_002',
      email: 'reviewer@marqcortex.com',
      name: 'Review Manager',
      teamRole: 'reviewer',
      status: 'active',
      joinedDate: '2026-01-15',
      lastActive: new Date().toISOString(),
      isSelf: false,
    },
    {
      id: 'user_003',
      email: 'viewer@marqcortex.com',
      name: 'Team Viewer',
      teamRole: 'viewer',
      status: 'active',
      joinedDate: '2026-02-01',
      lastActive: new Date(Date.now() - 86400000).toISOString(),
      isSelf: false,
    },
  ];
}

/** Minimal fallback team (just the admin) — used in catch blocks. */
export function getDemoTeamFallback(): TeamMemberRecord[] {
  return [getDemoTeamMembers()[0]];
}

// ============================================================================
// DEMO SUBMISSIONS (Full-Featured Dashboard)
// ============================================================================

export function getDemoSubmissions(): Submission[] {
  const now = Date.now();
  return [
    {
      id: 'DEMO-001',
      company: 'TechCorp Solutions',
      contact: 'Sarah Chen',
      email: 'sarah@techcorp.io',
      phone: '',
      website: 'techcorp.io',
      industry: 'SaaS / Software',
      industryId: 'saas',
      employees: '51-200',
      revenue: '$5M - $10M',
      submittedAt: new Date(now - 86400000).toISOString(),
      submittedDate: 'Feb 18, 2026',
      status: 'new',
      priority: 'high',
      completionScore: 95,
      qualityScore: 94,
      aiScore: 92,
      roiPotential: '$450K/year',
      answers: {},
      isRead: false,
    },
    {
      id: 'DEMO-002',
      company: 'HealthFirst Medical',
      contact: 'Dr. James Wilson',
      email: 'jwilson@healthfirst.com',
      phone: '',
      website: 'healthfirst.com',
      industry: 'Healthcare / Medical',
      industryId: 'healthcare',
      employees: '11-50',
      revenue: '$1M - $5M',
      submittedAt: new Date(now - 172800000).toISOString(),
      submittedDate: 'Feb 17, 2026',
      status: 'in-review',
      priority: 'high',
      completionScore: 88,
      qualityScore: 90,
      aiScore: 89,
      roiPotential: '$280K/year',
      answers: {},
      isRead: false,
    },
    {
      id: 'DEMO-003',
      company: 'RetailMax Inc',
      contact: 'Maria Rodriguez',
      email: 'maria@retailmax.com',
      phone: '',
      website: 'retailmax.com',
      industry: 'E-commerce / DTC',
      industryId: 'ecommerce',
      employees: '201-500',
      revenue: '$10M - $50M',
      submittedAt: new Date(now - 259200000).toISOString(),
      submittedDate: 'Feb 16, 2026',
      status: 'new',
      priority: 'medium',
      completionScore: 92,
      qualityScore: 85,
      aiScore: 87,
      roiPotential: '$680K/year',
      answers: {},
      isRead: false,
    },
    {
      id: 'DEMO-004',
      company: 'Manufacturing Pro',
      contact: 'John Smith',
      email: 'jsmith@mfgpro.com',
      phone: '',
      website: 'mfgpro.com',
      industry: 'Manufacturing',
      industryId: 'industrial',
      employees: '501-1000',
      revenue: '$50M+',
      submittedAt: new Date(now - 345600000).toISOString(),
      submittedDate: 'Feb 15, 2026',
      status: 'in-review',
      priority: 'high',
      completionScore: 85,
      qualityScore: 88,
      aiScore: 91,
      roiPotential: '$1.2M/year',
      answers: {},
      isRead: false,
    },
    {
      id: 'DEMO-005',
      company: 'CloudServe Ltd',
      contact: 'Michael Park',
      email: 'mpark@cloudserve.net',
      phone: '',
      website: 'cloudserve.net',
      industry: 'SaaS / Software',
      industryId: 'saas',
      employees: '1-10',
      revenue: '$500K - $1M',
      submittedAt: new Date(now - 432000000).toISOString(),
      submittedDate: 'Feb 14, 2026',
      status: 'completed',
      priority: 'low',
      completionScore: 100,
      qualityScore: 98,
      aiScore: 96,
      roiPotential: '$120K/year',
      answers: {},
      isRead: true,
    },
    {
      id: 'DEMO-006',
      company: 'FinanceHub',
      contact: 'Emily Zhang',
      email: 'ezhang@financehub.io',
      phone: '',
      website: 'financehub.io',
      industry: 'Agency / Services',
      industryId: 'agency',
      employees: '51-200',
      revenue: '$5M - $10M',
      submittedAt: new Date(now - 518400000).toISOString(),
      submittedDate: 'Feb 13, 2026',
      status: 'new',
      priority: 'medium',
      completionScore: 90,
      qualityScore: 92,
      aiScore: 88,
      roiPotential: '$390K/year',
      answers: {},
      isRead: false,
    },
  ];
}

// ============================================================================
// DEMO CLIENT PORTAL SUBMISSION
// ============================================================================

/** Per-client demo profiles keyed by submissionId */
const CLIENT_PROFILES: Record<string, {
  contact: string;
  phone: string;
  website: string;
  industry: string;
  industryId: string;
  employees: string;
  revenue: string;
  status: string;
  priority: string;
  completionScore: number;
  qualityScore: number;
  aiScore: number;
  roiPotential: string;
  daysAgo: number;
  answers: Record<number, string>;
}> = {
  'demo-sub-001': {
    contact: 'Rachel Nguyen',
    phone: '(415) 555-8192',
    website: 'www.acmefashion.com',
    industry: 'E-commerce / DTC',
    industryId: 'ecommerce',
    employees: '51-200',
    revenue: '$5M - $10M',
    status: 'completed',
    priority: 'high',
    completionScore: 92,
    qualityScore: 91,
    aiScore: 89,
    roiPotential: '$340K/year',
    daysAgo: 3,
    answers: {
      1: 'We process approximately 2,400 orders per month through Shopify, but our fulfillment workflow is largely manual. Staff copy-paste tracking numbers between systems, and we lose about 6 hours per day on order verification alone.',
      2: 'Customer service handles roughly 180 tickets/day. About 60% are repetitive questions about shipping, returns, or sizing. We have a basic FAQ page but no chatbot or automated routing.',
      3: 'Our inventory is tracked in a combination of Shopify, a Google Sheet maintained by our warehouse team, and our 3PL\'s portal. Discrepancies cause overselling about 3-4 times per week.',
      4: 'Marketing runs campaigns on Meta, Google, and TikTok but performance data lives in separate dashboards. We compile a weekly report manually, which takes our marketing coordinator about 5 hours.',
      5: 'Our return rate is 18%, which is above industry average. We suspect sizing issues but don\'t have a systematic way to analyze return reasons or feed that data back into product descriptions.',
      6: 'We use Shopify POS for our two retail locations plus the online store, but the inventory doesn\'t sync in real-time. Store managers call the warehouse to check stock levels.',
      7: 'Email marketing generates 28% of revenue. We use Klaviyo with basic segmentation (new vs returning customers) but haven\'t set up predictive analytics or advanced personalization beyond first name.',
      8: 'Our customer lifetime value is around $185 but we don\'t have a formal retention program. Post-purchase communication is a single "your order shipped" email.',
      9: 'We\'ve grown 40% YoY but our operations team has grown 65% in the same period. The founder still approves every purchase order over $500.',
      10: 'We tried implementing an AI chatbot 6 months ago but abandoned it after 2 weeks because it couldn\'t handle our product-specific questions. We\'re open to trying again with better training data.',
      11: 'Financial reporting is done monthly by our part-time CFO using QuickBooks exports merged in Excel. It typically takes 3-4 days after month-end to get a P&L.',
      12: 'Our biggest fear is that a competitor with better technology will outpace us. We\'ve seen brands half our size with better customer experiences because they invested in automation early.',
      13: 'If we could automate one thing, it would be the entire order-to-fulfillment pipeline. The manual touches add cost, introduce errors, and slow down our shipping promise.',
      14: 'We\'d be comfortable investing $30-50K in the first phase if we could see measurable ROI within 6 months. Our board has approved an "operational excellence" budget for this year.',
    },
  },
  'demo-sub-002': {
    contact: 'John Miller',
    phone: '(628) 555-4073',
    website: 'www.techflow.io',
    industry: 'SaaS / Software',
    industryId: 'saas',
    employees: '11-50',
    revenue: '$1M - $5M',
    status: 'completed',
    priority: 'high',
    completionScore: 88,
    qualityScore: 94,
    aiScore: 92,
    roiPotential: '$280K/year',
    daysAgo: 5,
    answers: {
      1: 'We have 1,200 active users on our project management platform. Monthly churn is around 5.8%, which we know is too high. Most churn happens between month 2 and month 4.',
      2: 'Our onboarding flow is a 7-step wizard that takes about 15 minutes. Completion rate is only 34%. Users who complete onboarding retain at 3x the rate of those who don\'t.',
      3: 'Support runs through Intercom. We get about 90 tickets per day, with a 4-hour average first response time. Our two support reps are maxed out and we\'re debating hiring a third.',
      4: 'Product usage data lives in Mixpanel but our CS team doesn\'t have access. They rely on users self-reporting issues. We have no health scoring or proactive outreach.',
      5: 'We ship features bi-weekly but have no systematic way to measure feature adoption. Our PM makes decisions based on gut feel and a handful of power-user conversations.',
      6: 'Our sales process is founder-led. I personally handle all demos and close about 30% of qualified leads. We\'ve tried hiring AEs twice but they couldn\'t replicate the founder pitch.',
      7: 'We use Stripe for billing but dunning is the default Stripe emails. We lose about $8K/month to failed payments that could likely be recovered with better retry logic.',
      8: 'Our API documentation is in a Notion wiki that\'s perpetually outdated. Integration partners have complained, and we\'ve lost at least 3 enterprise deals because of it.',
      9: 'We track MRR, churn, and CAC in a Sheets dashboard that our head of growth updates weekly. It takes him about 3 hours every Monday morning.',
      10: 'We\'re most excited about AI for customer support triage and automated onboarding. We believe we could reduce support load by 40% with an AI copilot.',
      11: 'Our engineering team is 8 people. They spend roughly 20% of their time on manual QA and deployment tasks that could be automated.',
      12: 'We compete with 4 main players in our space. Two of them recently launched AI features that we don\'t have yet. Customers are asking about it.',
      13: 'The bottleneck to growth right now is the founder dependency in sales. If I could clone myself or systematize the sales motion, we could 3x pipeline.',
      14: 'Budget is flexible — we recently closed a $2M seed round. We\'d rather invest $40-60K now and get it right than piece together cheaper solutions.',
    },
  },
  'demo-sub-003': {
    contact: 'Sarah Kim',
    phone: '(310) 555-6281',
    website: 'www.creativeagencypro.com',
    industry: 'Agency / Services',
    industryId: 'agency',
    employees: '11-50',
    revenue: '$1M - $5M',
    status: 'completed',
    priority: 'medium',
    completionScore: 85,
    qualityScore: 87,
    aiScore: 84,
    roiPotential: '$190K/year',
    daysAgo: 7,
    answers: {
      1: 'We run a 22-person creative agency specializing in brand identity and digital campaigns. Our clients range from Series A startups to mid-market consumer brands.',
      2: 'Project scoping is our biggest pain point. We consistently underestimate hours by 20-30%, which eats into margins. Scope creep happens on about 70% of projects.',
      3: 'We use Monday.com for project management but adoption is inconsistent. Some PMs track hours religiously, others submit timesheets at the end of the month from memory.',
      4: 'Client communication happens across email, Slack, and sometimes text. There\'s no single thread for a project, so context gets lost and we duplicate work.',
      5: 'Our proposal process takes 2-3 days per proposal. We pull from old proposals but there\'s no template library. Each account director has their own style.',
      6: 'New business comes primarily through referrals (60%) and our founder\'s LinkedIn presence (25%). We have no outbound motion and no CRM.',
      7: 'We bill monthly in arrears based on hours tracked. Invoice disputes happen on about 15% of projects because clients question the hours.',
      8: 'Our creative team uses Adobe Creative Suite and Figma. Files live across personal Dropbox accounts and a shared Google Drive. Version control is chaotic.',
      9: 'We\'ve lost 3 senior designers in the last year to burnout. The common complaint is too many projects, unclear priorities, and constant context-switching.',
      10: 'We\'re interested in AI for proposal generation, client reporting automation, and potentially AI-assisted design iteration. We see competitors offering AI-powered services.',
      11: 'Reporting to clients is manual — we build custom decks for each client quarterly. It takes about 8 hours per client per quarter.',
      12: 'Our utilization rate is around 62%, below the 70-75% industry benchmark. We think better resource allocation and project scoping could close the gap.',
      13: 'If we could fix one thing, it would be having real-time visibility into project profitability. Right now we don\'t know if a project is profitable until 2 months after it ends.',
      14: 'We\'d start with a $15-25K engagement if the scope was clear and the ROI could be demonstrated in the first 90 days.',
    },
  },
};

/**
 * Build a demo Submission for the client portal.
 * Accepts optional overrides so the portal can pass submissionId/email/company
 * from the login context.
 */
export function getDemoClientSubmission(overrides?: {
  submissionId?: string;
  clientEmail?: string;
  companyName?: string;
}): Submission {
  const id = overrides?.submissionId || 'demo-sub-001';
  const profile = CLIENT_PROFILES[id] || CLIENT_PROFILES['demo-sub-001'];
  const submittedAt = new Date(Date.now() - profile.daysAgo * 86400000).toISOString();

  return {
    id,
    company: overrides?.companyName || 'Acme Fashion Co.',
    contact: profile.contact,
    email: overrides?.clientEmail || 'client@company.com',
    phone: profile.phone,
    website: profile.website,
    industry: profile.industry,
    industryId: profile.industryId,
    employees: profile.employees,
    revenue: profile.revenue,
    submittedAt,
    submittedDate: new Date(submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    status: profile.status,
    priority: profile.priority,
    completionScore: profile.completionScore,
    qualityScore: profile.qualityScore,
    aiScore: profile.aiScore,
    roiPotential: profile.roiPotential,
    answers: profile.answers,
    isRead: true,
    engagement: {
      reportViewCount: 5,
      firstViewedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
      lastViewedAt: new Date(Date.now() - 3600000).toISOString(),
      ctaClickedAt: new Date(Date.now() - 7200000).toISOString(),
      pdfPrintedAt: null,
    },
  };
}

// ============================================================================
// DEMO PROPOSAL (Rich, fully-structured proposal for ProposalViewer)
// ============================================================================

export function getDemoProposal(companyName: string) {
  return {
    status: 'sent',
    sentAt: new Date(Date.now() - 86400000).toISOString(),
    company_name: companyName,
    generated_date: new Date(Date.now() - 86400000).toISOString(),

    executive_summary: {
      paragraphs: [
        `Following our comprehensive diagnostic of ${companyName}'s operations, we have identified significant opportunities to transform your business through targeted AI and automation initiatives. Your organization demonstrates strong market positioning and growth trajectory, but operational inefficiencies are creating a drag on margins and limiting your ability to scale.`,
        `Our analysis reveals that manual process overhead is consuming approximately 32% of your team's productive capacity — the equivalent of losing 3.2 full-time employees to administrative tasks that could be automated. This represents both immediate cost savings and unlocked growth potential.`,
        `We recommend a phased engagement beginning with a 60-day AI Operations Audit, designed to validate our findings, build your automation roadmap, and deliver a quick-win pilot that demonstrates measurable ROI within the first month.`,
      ],
    },

    confirmed_diagnosis: {
      problems: [
        {
          title: 'Order-to-Fulfillment Pipeline Bottleneck',
          description: 'Manual order verification, copy-paste tracking workflows, and disconnected systems create 6+ hours of daily overhead. Error rates of 2.3% on orders result in costly reshipping and customer complaints.',
          cost: '$8,200/month in labor + $3,400/month in error-related costs',
        },
        {
          title: 'Customer Service Saturation',
          description: '60% of 180 daily tickets are repetitive, answerable questions (shipping, returns, sizing). Without intelligent routing or self-service automation, your support team is at capacity with no room for growth.',
          cost: '$6,800/month in unnecessary support labor',
        },
        {
          title: 'Inventory Synchronization Gaps',
          description: 'Three disconnected inventory systems (Shopify, Google Sheets, 3PL portal) cause overselling 3-4 times weekly, resulting in cancelled orders, disappointed customers, and manual reconciliation time.',
          cost: '$4,200/month in lost sales + reconciliation labor',
        },
        {
          title: 'Revenue Intelligence Blindspot',
          description: 'Marketing performance data siloed across Meta, Google, and TikTok dashboards. 5 hours/week spent manually compiling reports means decisions are made on stale data, and attribution is unreliable.',
          cost: '$2,800/month in marketing coordinator time + estimated $12K/month in sub-optimal ad spend',
        },
      ],
    },

    recommended_step: {
      service_name: 'AI Operations Audit & Quick-Win Pilot',
      what_it_does: `A structured 60-day engagement where our team maps your current workflows, identifies the highest-impact automation opportunities, builds your prioritized transformation roadmap, and delivers one fully-functional automation pilot to prove the concept and generate immediate ROI. This is not a theoretical consulting report — it's a working prototype backed by data.`,
      includes: [
        'Full-day on-site (or virtual) discovery workshop with your leadership team',
        'Process mapping across all 4 diagnosed bottleneck areas',
        'Quantified ROI model for each automation opportunity',
        'Prioritized 12-month transformation roadmap',
        'One quick-win automation pilot (deployed and operational)',
        'Executive presentation with findings, recommendations, and live demo',
        'Team training session on the pilot automation',
        '30-day post-delivery support window',
      ],
      does_not_include: [
        'Full implementation of all identified automations (Phase 2+)',
        'Custom software development beyond the pilot scope',
        'Hardware procurement or infrastructure changes',
        'Ongoing managed services (available as a separate engagement)',
      ],
    },

    deliverables: {
      items: [
        {
          name: 'Operational Diagnostic Report',
          description: 'Comprehensive 40-page analysis documenting every manual process, bottleneck, and automation opportunity across your four key departments. Includes process flow diagrams, time studies, and cost-of-inaction modeling.',
          format: 'Interactive PDF + Live Dashboard',
        },
        {
          name: 'AI Automation Roadmap',
          description: 'Prioritized 12-month plan ranking all identified opportunities by ROI, feasibility, and strategic alignment. Each initiative includes estimated investment, timeline, expected returns, and prerequisite dependencies.',
          format: 'Strategic Deck + Gantt Chart',
        },
        {
          name: 'Quick-Win Pilot Automation',
          description: 'A fully functional automation deployed in your environment — we recommend the customer service triage bot as your pilot, projected to deflect 45% of repetitive tickets within the first 30 days.',
          format: 'Deployed System + Documentation',
        },
        {
          name: 'ROI Tracking Dashboard',
          description: 'Live dashboard connected to your systems that tracks the pilot\'s performance against baseline metrics. Visible proof that the approach works before committing to Phase 2.',
          format: 'Web Dashboard (Real-time)',
        },
        {
          name: 'Executive Recommendation Deck',
          description: 'Board-ready presentation summarizing findings, demonstrating pilot results, and presenting the business case for Phase 2 implementation. Designed for your leadership team and investors.',
          format: 'Presentation Deck + Video Walkthrough',
        },
      ],
    },

    timeline: {
      total_duration: '60 Days',
      phases: [
        {
          phase: 'Phase 1: Discovery & Mapping (Days 1-14)',
          activities: [
            'Kickoff workshop with leadership + department heads',
            'Shadowing sessions with operations, CS, and marketing teams',
            'Systems audit — documenting all tools, integrations, and data flows',
            'Stakeholder interviews (8-10 team members)',
            'Baseline metric collection across all four bottleneck areas',
          ],
        },
        {
          phase: 'Phase 2: Analysis & Design (Days 15-30)',
          activities: [
            'Process mapping and time-study analysis',
            'Automation opportunity scoring (ROI, feasibility, risk)',
            'Technology stack evaluation and vendor assessment',
            'Quick-win pilot design and architecture',
            'Draft roadmap review with your team (mid-point checkpoint)',
          ],
        },
        {
          phase: 'Phase 3: Pilot Build & Deploy (Days 31-50)',
          activities: [
            'Build and configure the quick-win automation (CS triage bot)',
            'Integration with your existing Intercom + Shopify stack',
            'Training data preparation and model fine-tuning',
            'UAT testing with your support team',
            'Soft launch with 20% of ticket volume',
          ],
        },
        {
          phase: 'Phase 4: Results & Roadmap Delivery (Days 51-60)',
          activities: [
            'Full pilot rollout to 100% of applicable tickets',
            'Performance data collection and ROI measurement',
            'Final roadmap refinement based on pilot learnings',
            'Executive presentation and recommendation delivery',
            'Phase 2 scoping conversation (no obligation)',
          ],
        },
      ],
    },

    investment: {
      amount: 28500,
      currency: 'USD',
      structure: 'Fixed Fee',
      payment_terms: '50% upon kickoff, 50% upon delivery of final presentation. All fees due within NET 15.',
      includes_note: 'Includes all travel expenses for up to 2 on-site visits, all tools and technology required for the pilot, and 30 days of post-delivery support.',
      credit_to_next_phase: true,
      credit_amount: 28500,
      reassurance: 'This is a diagnostic and proof-of-concept engagement. There\'s no obligation to proceed to Phase 2. Our goal is to deliver enough value in 60 days that the decision to continue becomes obvious. If at any point during the engagement you feel we\'re not meeting expectations, we\'ll pause and course-correct immediately.',
    },

    next_steps: {
      steps: [
        'Review this proposal and share with your leadership team',
        'Accept the proposal using the button below (or let us know if you have questions)',
        'We\'ll send a short onboarding form and schedule the kickoff workshop',
        'Engagement begins within 5 business days of acceptance',
        'You\'ll have a working pilot automation within 50 days',
      ],
    },

    future_path: {
      section_title: 'What This Unlocks Next',
      note: 'These are optional follow-on engagements available after the audit. No commitment required.',
      future_services: [
        {
          name: 'Full Automation Implementation',
          brief_description: 'Deploy all priority automations identified in the roadmap, including order pipeline, inventory sync, and marketing intelligence.',
          typical_timeline: '3-6 months',
        },
        {
          name: 'AI Customer Experience Suite',
          brief_description: 'Expand the pilot chatbot into a full omnichannel AI assistant with product recommendations, proactive outreach, and predictive support.',
          typical_timeline: '2-4 months',
        },
        {
          name: 'Revenue Intelligence Platform',
          brief_description: 'Unified marketing analytics, real-time ad spend optimization, and predictive revenue modeling powered by your consolidated data.',
          typical_timeline: '6-8 weeks',
        },
        {
          name: 'Managed AI Operations',
          brief_description: 'Ongoing monitoring, optimization, and evolution of your AI systems. We act as your fractional AI operations team.',
          typical_timeline: 'Ongoing retainer',
        },
      ],
    },
  };
}

// ============================================================================
// DEMO MESSAGES (Rich conversation thread)
// ============================================================================

export function getDemoMessages(submissionId: string, clientName: string): Message[] {
  const now = Date.now();
  return [
    {
      id: 'msg_001',
      submissionId,
      author: 'team',
      authorName: 'MARQ Cortex Team',
      content: `Hi ${clientName.split(' ')[0]}! Thank you for completing the operational diagnostic. We've received your submission and our analysis team has already started reviewing your responses. Based on a preliminary scan, we can see some really interesting patterns — particularly around your fulfillment workflow and customer service operations. We'll have your full readiness report ready within 24 hours.`,
      createdAt: new Date(now - 72 * 3600000).toISOString(),
    },
    {
      id: 'msg_002',
      submissionId,
      author: 'client',
      authorName: clientName,
      content: 'Thanks for the quick response! I\'m curious — will the report include specific recommendations for which tools or platforms we should consider? We\'ve been evaluating a few options internally and would love to cross-reference.',
      createdAt: new Date(now - 68 * 3600000).toISOString(),
    },
    {
      id: 'msg_003',
      submissionId,
      author: 'team',
      authorName: 'Marcus Chen — Lead Analyst',
      content: `Great question! Yes, the readiness report will include tool-agnostic recommendations first (so you understand the "what" and "why"), and then in the proposal stage we'll recommend specific technology stacks based on your existing systems. I noticed you mentioned Shopify + Klaviyo in your diagnostic — that's a strong foundation and we have deep experience with that ecosystem. The report will also include an ROI projection for each recommendation so you can prioritize based on business impact.`,
      createdAt: new Date(now - 64 * 3600000).toISOString(),
    },
    {
      id: 'msg_004',
      submissionId,
      author: 'client',
      authorName: clientName,
      content: 'That sounds perfect. One more thing — our CEO wants to be involved in the discovery call. She\'s generally available Tuesday and Thursday mornings (PST). Is that something we can accommodate?',
      createdAt: new Date(now - 48 * 3600000).toISOString(),
    },
    {
      id: 'msg_005',
      submissionId,
      author: 'team',
      authorName: 'MARQ Cortex Team',
      content: `Absolutely! We'd love to have your CEO on the call — leadership alignment is one of the strongest predictors of successful AI transformation. Tuesday and Thursday mornings work well for our team. Once your report is published (should be later today), you can use the "Schedule a Call" tab to pick a specific slot, or just let us know here and we'll coordinate. We'll make sure to prepare a brief executive overview so your CEO can get up to speed quickly without needing to read the full report.`,
      createdAt: new Date(now - 44 * 3600000).toISOString(),
    },
    {
      id: 'msg_006',
      submissionId,
      author: 'team',
      authorName: 'Marcus Chen — Lead Analyst',
      content: `Quick update — your readiness report is now live! You can view it in the "Readiness Report" tab. A few highlights: your overall readiness score came in at "High" which is great, but we identified 4 specific bottleneck areas where you're leaving significant value on the table. The order-to-fulfillment pipeline alone has an estimated $140K/year improvement opportunity. Happy to walk through everything on the call!`,
      createdAt: new Date(now - 24 * 3600000).toISOString(),
    },
    {
      id: 'msg_007',
      submissionId,
      author: 'client',
      authorName: clientName,
      content: 'Wow, just went through the report — really impressed with the depth of analysis. The fulfillment pipeline section is spot on. We\'ve been feeling that pain but never quantified it. I\'ll get a call scheduled this week. Thanks Marcus!',
      createdAt: new Date(now - 18 * 3600000).toISOString(),
    },
  ];
}

// ============================================================================
// DEMO ENGAGEMENT EVENTS
// ============================================================================

export function getDemoEngagementEvents(submissionId: string) {
  const now = Date.now();
  return [
    { id: 'evt_001', submissionId, event: 'portal_opened',     timestamp: new Date(now - 72 * 3600000).toISOString() },
    { id: 'evt_002', submissionId, event: 'report_viewed',     timestamp: new Date(now - 48 * 3600000).toISOString() },
    { id: 'evt_003', submissionId, event: 'report_viewed',     timestamp: new Date(now - 36 * 3600000).toISOString() },
    { id: 'evt_004', submissionId, event: 'message_sent',      timestamp: new Date(now - 68 * 3600000).toISOString() },
    { id: 'evt_005', submissionId, event: 'message_sent',      timestamp: new Date(now - 48 * 3600000).toISOString() },
    { id: 'evt_006', submissionId, event: 'proposal_viewed',   timestamp: new Date(now - 24 * 3600000).toISOString() },
    { id: 'evt_007', submissionId, event: 'cta_clicked',       timestamp: new Date(now - 20 * 3600000).toISOString() },
    { id: 'evt_008', submissionId, event: 'report_viewed',     timestamp: new Date(now - 12 * 3600000).toISOString() },
    { id: 'evt_009', submissionId, event: 'portal_opened',     timestamp: new Date(now - 6 * 3600000).toISOString() },
    { id: 'evt_010', submissionId, event: 'message_sent',      timestamp: new Date(now - 18 * 3600000).toISOString() },
    { id: 'evt_011', submissionId, event: 'pdf_printed',       timestamp: new Date(now - 10 * 3600000).toISOString() },
  ];
}

// ============================================================================
// DEMO SCHEDULED MEETING
// ============================================================================

export function getDemoScheduledMeeting() {
  // Next Tuesday at 10:00 AM
  const now = new Date();
  const daysUntilTuesday = (2 - now.getDay() + 7) % 7 || 7;
  const meetingDate = new Date(now);
  meetingDate.setDate(now.getDate() + daysUntilTuesday);
  meetingDate.setHours(10, 0, 0, 0);

  return {
    id: 'meeting_demo_001',
    scheduledAt: meetingDate.toISOString(),
    duration: 45,
    meetingUrl: 'https://zoom.us/j/98765432100?pwd=demo',
    calendarEventId: 'cal_demo_001',
    attendees: [
      { name: 'Marcus Chen', role: 'Lead Analyst', avatar: 'MC' },
      { name: 'Priya Sharma', role: 'Solutions Architect', avatar: 'PS' },
    ],
    agenda: [
      'Review your readiness report findings (10 min)',
      'Deep-dive into top 3 priority recommendations (15 min)',
      'ROI walkthrough and investment discussion (10 min)',
      'Q&A and next steps (10 min)',
    ],
  };
}

// ============================================================================
// DEMO NURTURE LEADS (Email Queue)
// ============================================================================

export interface DemoNurtureLead {
  name: string;
  email: string;
  company: string;
  industry: string;
  score: number;
  theme: string;
  /** How long ago (in ms) the lead submitted — used to compute schedules. */
  ageMs: number;
}

export const DEMO_NURTURE_LEADS: DemoNurtureLead[] = [
  { name: 'Sarah Chen',      email: 'sarah@acmefashion.com',     company: 'Acme Fashion Co.',       industry: 'ecommerce',     score: 72, theme: 'Manual & Repetitive Operations',       ageMs: 6 * 3600_000 },
  { name: 'John Miller',     email: 'john@techflow.io',          company: 'TechFlow SaaS',          industry: 'saas',          score: 58, theme: 'Scaling Ceiling',                       ageMs: 28 * 3600_000 },
  { name: 'Mike Ross',       email: 'mike@creativeagency.com',   company: 'Creative Agency Pro',     industry: 'agency',        score: 45, theme: 'Founder / Key-Person Dependency',       ageMs: 72 * 3600_000 },
  { name: 'Dr. Priya Patel', email: 'priya@sunriseclinic.com',   company: 'Sunrise Family Clinic',   industry: 'healthcare',    score: 38, theme: 'Data & System Fragmentation',           ageMs: 12 * 3600_000 },
  { name: 'Tom Nguyen',      email: 'tom@precisionparts.co',     company: 'Precision Parts Mfg.',    industry: 'manufacturing', score: 51, theme: 'Manual & Repetitive Operations',       ageMs: 96 * 3600_000 },
  { name: 'Lisa Grant',      email: 'lisa@coursecraft.co',       company: 'CourseCraft Academy',     industry: 'creators',      score: 67, theme: 'Customer Experience Gaps',               ageMs: 2 * 3600_000 },
];