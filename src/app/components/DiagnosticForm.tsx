import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight, Send, CheckCircle2, Sparkles, Lightbulb } from 'lucide-react';
import { industrialQuestions } from '@/app/components/IndustrialQuestions';
import { universalQuestions } from '@/app/components/UniversalQuestions';
import { AIAssistant } from '@/app/components/AIAssistant';

export interface DiagnosticSubmissionData {
  contactName: string;
  email: string;
  phone: string;
  website: string;
  industry: string;
  answers: Record<number, string | number>;
}

interface DiagnosticFormProps {
  onComplete: (data: DiagnosticSubmissionData) => void;
  onBack: () => void;
  initialData?: {
    contactName: string;
    email: string;
    phone: string;
    website: string;
  };
}

// Industry definitions
const industries = [
  { id: 'ecommerce', name: 'E-commerce / DTC', icon: '🛒', color: '#8B5CF6' },
  { id: 'saas', name: 'SaaS / Software', icon: '💻', color: '#3B82F6' },
  { id: 'agency', name: 'Agency / Services', icon: '🎨', color: '#06D7F6' },
  { id: 'healthcare', name: 'Healthcare / Medical', icon: '⚕️', color: '#FB923C' },
  { id: 'nonprofit', name: 'Non-Profit / Education', icon: '🎓', color: '#FD4438' },
  { id: 'creators', name: 'Creators / Training / Courses', icon: '📚', color: '#10B981' },
  { id: 'government', name: 'Government / Public Sector', icon: '🏛️', color: '#6B7280' },
  { id: 'manufacturing', name: 'Manufacturing / Supply Chain', icon: '🏭', color: '#F59E0B' },
  { id: 'other', name: 'Other Business / General', icon: '🏢', color: '#9333EA' },
];

// E-COMMERCE / DTC QUESTIONS
export const ecommerceQuestions = [
  // 1️⃣ BUSINESS REALITY & DAILY OPERATIONS (5)
  {
    id: 1,
    category: 'Business Reality & Daily Operations',
    question: 'Walk us through a normal workday when things feel frustrating or chaotic. Where does your time actually go, and what fires come up repeatedly?',
    type: 'textarea',
    placeholder: 'Describe a typical chaotic day in detail...',
    motivationalQuote: "Understanding your daily reality is the first step to transforming it.",
    exampleAnswers: [
      "Morning starts with urgent customer emails, then inventory alerts, followed by team questions about fulfillment",
      "Constantly switching between order issues, marketing campaigns, and supplier communications",
      "Most time goes to firefighting rather than strategic work",
      "Days consumed by manual data entry, chasing updates, and resolving order mistakes",
    ],
    backgroundTheme: 'industry',
  },
  {
    id: 2,
    category: 'Business Reality & Daily Operations',
    question: 'Which tasks consume the most time in your e-commerce operation but feel repetitive or low-value? (Be specific about who does them and how often.)',
    type: 'textarea',
    placeholder: 'List the time-consuming repetitive tasks...',
    motivationalQuote: "Every repetitive task is an opportunity for automation and freedom.",
    exampleAnswers: [
      "I personally update inventory across 3 platforms daily (2-3 hours)",
      "Team manually processes refunds and responds to 'where\'s my order' emails (4-5 hours/day)",
      "Copying order data into spreadsheets for reporting (daily, 1 hour)",
      "Manually reconciling payments and updating customer records",
    ],
    backgroundTheme: 'team',
  },
  {
    id: 3,
    category: 'Business Reality & Daily Operations',
    question: 'What decisions, approvals, or checks still depend on you (or one key person) and slow everything down?',
    type: 'textarea',
    placeholder: 'Identify the bottleneck decisions...',
    motivationalQuote: "Breaking dependency chains unlocks your team's full potential.",
    exampleAnswers: [
      "All marketing spend and campaign approvals need my sign-off",
      "Customer service can't issue refunds over $100 without me",
      "Product pricing changes require founder approval",
      "Team waits for me to review orders before shipping large purchases",
    ],
    backgroundTheme: 'challenge',
  },
  {
    id: 4,
    category: 'Business Reality & Daily Operations',
    question: 'Where does information get lost, duplicated, or delayed across orders, customers, inventory, marketing, or support?',
    type: 'textarea',
    placeholder: 'Describe where information breaks down...',
    motivationalQuote: "Information clarity creates operational excellence.",
    exampleAnswers: [
      "Customer data lives in Shopify, support tickets in email, notes in Slack - nothing connects",
      "Inventory counts differ between warehouse spreadsheet and website",
      "Marketing doesn't know which customers already purchased, sends wrong campaigns",
      "Support team can't see order status without asking fulfillment",
    ],
    backgroundTheme: 'efficiency',
  },
  {
    id: 5,
    category: 'Business Reality & Daily Operations',
    question: 'If nothing changes in the next 6 months, what worries you most about your business?',
    type: 'textarea',
    placeholder: 'Share your biggest concern...',
    motivationalQuote: "Acknowledging fears is the catalyst for breakthrough change.",
    exampleAnswers: [
      "I'll burn out and the business will suffer because it all depends on me",
      "We'll lose customers to competitors who deliver faster and better",
      "We won't be able to scale beyond current revenue without hiring too many people",
      "Margins will keep shrinking due to inefficiencies we can't control",
    ],
    backgroundTheme: 'revenue',
  },

  // 2️⃣ BOTTLENECKS, SCALE & LEAKAGE (4)
  {
    id: 6,
    category: 'Bottlenecks, Scale & Leakage',
    question: 'Describe what actually happens from the moment someone visits your store to when they become a repeat customer.',
    type: 'textarea',
    placeholder: 'Walk through the complete customer journey...',
    motivationalQuote: "Mapping the journey reveals the transformation opportunities.",
    exampleAnswers: [
      "Visitor browses → adds to cart → often abandons → we manually send recovery email → sometimes converts → order fulfilled → no systematic follow-up",
      "Customer buys → gets generic confirmation → ships → crickets until they reach out with questions → no proactive retention",
      "Purchase happens → fulfillment takes 3-5 days → tracking is unclear → customer support is reactive → no repurchase automation",
    ],
    backgroundTheme: 'tools',
  },
  {
    id: 7,
    category: 'Bottlenecks, Scale & Leakage',
    question: 'As order volume increases, where does the business start to break first?',
    type: 'textarea',
    placeholder: 'Identify your breaking points...',
    motivationalQuote: "Knowing where you'll break helps you build resilience before it happens.",
    exampleAnswers: [
      "Customer support gets overwhelmed - response times balloon from hours to days",
      "Fulfillment errors spike because we're picking and packing manually",
      "I can't keep up with inventory decisions and we start running out of stock",
      "Returns and refunds pile up faster than we can process them",
    ],
    backgroundTheme: 'challenge',
  },
  {
    id: 8,
    category: 'Bottlenecks, Scale & Leakage',
    question: 'What work are humans doing today that clearly should not require human thinking?',
    type: 'textarea',
    placeholder: 'List the obvious automation opportunities...',
    motivationalQuote: "Human potential is wasted on tasks machines should handle.",
    exampleAnswers: [
      "Manually sending order confirmations and shipping notifications",
      "Copy-pasting customer info between systems",
      "Updating inventory counts across multiple sales channels",
      "Categorizing and tagging customer support tickets",
      "Generating daily sales reports by exporting and combining data",
    ],
    backgroundTheme: 'efficiency',
  },
  {
    id: 9,
    category: 'Bottlenecks, Scale & Leakage',
    question: 'Where do you believe money is being lost right now? (Missed follow-ups, abandoned carts, slow responses, refunds, poor visibility, etc.)',
    type: 'textarea',
    placeholder: 'Identify your revenue leakage points...',
    motivationalQuote: "Every leak plugged is profit reclaimed. You're already aware - now act.",
    exampleAnswers: [
      "60%+ cart abandonment with no systematic recovery process",
      "Customers don't repurchase because we have no retention automation",
      "Slow support response times lead to cancellations and bad reviews",
      "Over-refunding because we can't track root causes",
      "Poor inventory visibility causes stockouts on best-sellers",
    ],
    backgroundTheme: 'revenue',
  },

  // 3️⃣ SYSTEMS, TOOLS & READINESS (3)
  {
    id: 10,
    category: 'Systems, Tools & Readiness',
    question: 'What tools do you currently rely on, and where do they fail to support how your business actually runs?',
    type: 'textarea',
    placeholder: 'List your tools and their limitations...',
    motivationalQuote: "The right tools amplify your team. The wrong ones create busy work.",
    exampleAnswers: [
      "Shopify for store, Klaviyo for email, Google Sheets for inventory - nothing talks to each other",
      "Using Zendesk but team still uses personal email for half the conversations",
      "Have a 3PL system but manually export/import data daily",
      "Tools exist but no one was trained, so we revert to spreadsheets and Slack",
    ],
    backgroundTheme: 'tools',
  },
  {
    id: 11,
    category: 'Systems, Tools & Readiness',
    question: 'What information do you wish you had at your fingertips but don\'t today?',
    type: 'textarea',
    placeholder: 'Describe your visibility gaps...',
    motivationalQuote: "Data clarity transforms guesswork into confident decisions.",
    exampleAnswers: [
      "Real-time inventory across all channels in one view",
      "Customer lifetime value and purchase patterns without exporting reports",
      "Which products are driving profit vs. just revenue",
      "Live dashboard showing order status, support tickets, and fulfillment bottlenecks",
      "Accurate cash flow forecast based on actual inventory and sales velocity",
    ],
    backgroundTheme: 'efficiency',
  },
  {
    id: 12,
    category: 'Systems, Tools & Readiness',
    question: 'How documented are your workflows today? (Almost nothing / partially documented / mostly documented / fully documented — explain.)',
    type: 'textarea',
    placeholder: 'Describe your documentation reality...',
    motivationalQuote: "Documentation is the foundation of scalable growth.",
    exampleAnswers: [
      "Almost nothing - it's all in people's heads",
      "Partially documented - some Google Docs but outdated and incomplete",
      "Mostly documented - we have SOPs for fulfillment and support, but not marketing or ops",
      "Fully documented - comprehensive playbooks with regular updates",
      "Have docs but no one follows them because they don't match reality",
    ],
    backgroundTheme: 'team',
  },

  // 4️⃣ INTENT, OUTCOMES & CONSTRAINTS (2)
  {
    id: 13,
    category: 'Intent, Outcomes & Constraints',
    question: 'If we worked together for the next 90 days, what would success look like in practical terms?',
    type: 'textarea',
    placeholder: 'Define your 90-day success vision...',
    motivationalQuote: "Clear goals create unstoppable momentum.",
    exampleAnswers: [
      "I reclaim 15+ hours per week by automating repetitive work",
      "Customer support response time under 2 hours with no additional headcount",
      "Zero stock-outs on top 20 products with automated reordering",
      "Team operates independently without waiting for my approvals",
      "Revenue increases 20% through better cart recovery and retention automation",
    ],
    backgroundTheme: 'revenue',
  },
  {
    id: 14,
    category: 'Intent, Outcomes & Constraints',
    question: 'If a clear plan showed real time savings, cost reduction, or revenue improvement — what would realistically stop you from moving forward?',
    type: 'textarea',
    placeholder: 'Share your honest constraints...',
    motivationalQuote: "Transparency about constraints opens the path to solutions.",
    exampleAnswers: [
      "Budget - we're tight on cash right now",
      "Time - I don't have bandwidth to implement even if it makes sense",
      "Team resistance - my team struggles with change",
      "Technical complexity - worried about breaking what currently works",
      "Nothing - if ROI is clear, I'm ready to move",
    ],
    backgroundTheme: 'challenge',
  },
];

// SAAS / TECH BUSINESSES QUESTIONS
export const saasQuestions = [
  // 1️⃣ BUSINESS REALITY & DAILY OPERATIONS (5)
  {
    id: 1,
    category: 'Business Reality & Daily Operations',
    question: 'In your own words, explain what your product does, who it\'s for, and how revenue is generated today.',
    type: 'textarea',
    placeholder: 'Describe your product, target customer, and revenue model...',
    motivationalQuote: "Clarity about your value proposition is the foundation of everything else.",
    exampleAnswers: [
      "We're a project management tool for remote teams (B2B SaaS), $49-199/month subscriptions based on team size",
      "Analytics platform for e-commerce brands, freemium model with paid tiers starting at $99/month",
      "B2C mobile app for personal finance tracking, revenue from premium subscriptions ($9.99/month) and affiliate partnerships",
      "API platform for developers, usage-based pricing with enterprise contracts driving most revenue",
    ],
    backgroundTheme: 'industry',
  },
  {
    id: 2,
    category: 'Business Reality & Daily Operations',
    question: 'Describe a typical workday for you or your leadership team. Where does most time get spent that does not feel strategic?',
    type: 'textarea',
    placeholder: 'Walk through where your time actually goes...',
    motivationalQuote: "Time is your most valuable resource. Protect it strategically.",
    exampleAnswers: [
      "Mornings in customer calls fixing issues, afternoons in internal meetings about same recurring problems, evenings catching up on product priorities",
      "Constantly context-switching between support escalations, sales questions, and team check-ins - no deep work time",
      "Spending hours manually reviewing metrics across multiple dashboards to understand what's happening",
      "Leadership team spends most time firefighting instead of roadmap planning and strategic initiatives",
    ],
    backgroundTheme: 'team',
  },
  {
    id: 3,
    category: 'Business Reality & Daily Operations',
    question: 'Which decisions, approvals, or activities cannot move forward without you or a senior leader?',
    type: 'textarea',
    placeholder: 'List the bottleneck dependencies...',
    motivationalQuote: "Breaking bottlenecks multiplies your team's velocity.",
    exampleAnswers: [
      "All pricing changes, contract approvals over $5K, and feature prioritization decisions require my sign-off",
      "Support can't make exceptions or refunds without VP approval, causing ticket backlogs",
      "Marketing campaigns wait for founder review before launching",
      "Product team needs my input on every technical decision, slowing development cycles",
    ],
    backgroundTheme: 'challenge',
  },
  {
    id: 4,
    category: 'Business Reality & Daily Operations',
    question: 'Where do handoffs fail between sales, onboarding, support, product, or finance?',
    type: 'textarea',
    placeholder: 'Describe where information breaks down between teams...',
    motivationalQuote: "Seamless handoffs turn friction into flow.",
    exampleAnswers: [
      "Sales closes deals but onboarding doesn't know customer expectations or promised features",
      "Support tickets rarely make it to product team, so we keep fixing same issues without addressing root causes",
      "Finance doesn't know about expansion opportunities that sales is working on",
      "Customer success doesn't see product usage data, can't proactively prevent churn",
      "Onboarding completion data doesn't feed back to sales to improve qualification",
    ],
    backgroundTheme: 'efficiency',
  },
  {
    id: 5,
    category: 'Business Reality & Daily Operations',
    question: 'What part of the business worries you most as customer count or usage increases?',
    type: 'textarea',
    placeholder: 'Share your biggest scaling concern...',
    motivationalQuote: "Anticipating breaking points allows you to build strength before you need it.",
    exampleAnswers: [
      "Support will collapse - we can't hire fast enough to maintain quality as we scale",
      "Onboarding takes too much manual work, won't scale beyond current volume",
      "Product stability and performance - not confident infrastructure can handle 10x growth",
      "Churn will increase because we can't provide personalized attention at scale",
      "Customer success ratios will break and we'll lose revenue to preventable churn",
    ],
    backgroundTheme: 'revenue',
  },

  // 2️⃣ BOTTLENECKS, SCALE & LEAKAGE (4)
  {
    id: 6,
    category: 'Bottlenecks, Scale & Leakage',
    question: 'Describe what happens from the moment a lead shows interest to when they become an active, retained customer.',
    type: 'textarea',
    placeholder: 'Map out the complete lead-to-customer journey...',
    motivationalQuote: "Understanding the journey reveals where to optimize for growth.",
    exampleAnswers: [
      "Lead signs up → gets generic email sequence → some book demos → sales does manual outreach → trial starts → onboarding is mostly self-serve → many don't activate → no systematic engagement",
      "Inbound lead → sales qualification call → trial begins → onboarding via email templates → if they engage, we check in manually → conversion depends heavily on whether we catch them in time",
      "Lead downloads app → self-serve signup → automated tutorial → many drop off before completing setup → limited proactive intervention → conversion is mostly luck",
      "Demo request → sales call → custom contract negotiation → implementation kick-off → long onboarding → go-live → quarterly check-ins if we remember",
    ],
    backgroundTheme: 'tools',
  },
  {
    id: 7,
    category: 'Bottlenecks, Scale & Leakage',
    question: 'Where do prospects disengage, or customers churn — and why do you believe that happens?',
    type: 'textarea',
    placeholder: 'Identify your drop-off and churn points...',
    motivationalQuote: "Every point of friction is an opportunity for improvement.",
    exampleAnswers: [
      "Most trials never complete onboarding - setup is too complex and we don't intervene early enough",
      "Churn happens 3-6 months in when they realize they're not getting ROI - usually because they never fully adopted",
      "Drop-off during payment step because pricing isn't clear upfront or seems too high for perceived value",
      "Customers churn when key champion leaves their company and no one else knows how to use our product",
      "Free users never convert because we don't have clear upgrade triggers or proactive sales outreach",
    ],
    backgroundTheme: 'challenge',
  },
  {
    id: 8,
    category: 'Bottlenecks, Scale & Leakage',
    question: 'Which recurring tasks grow linearly with users or customers instead of staying flat?',
    type: 'textarea',
    placeholder: 'List the work that scales with customer count...',
    motivationalQuote: "Automation turns linear costs into fixed costs.",
    exampleAnswers: [
      "Manual onboarding calls for every new customer, takes 2-3 hours each",
      "Responding to 'how do I...' support tickets that should be handled by better docs or in-app guides",
      "Generating custom reports for enterprise customers, each takes 4-6 hours",
      "Account reviews and check-ins done manually for each customer",
      "Data migration and setup work that requires engineering time for each new customer",
    ],
    backgroundTheme: 'efficiency',
  },
  {
    id: 9,
    category: 'Bottlenecks, Scale & Leakage',
    question: 'Where do you believe money, time, or opportunities are being wasted today?',
    type: 'textarea',
    placeholder: 'Identify your leakage points...',
    motivationalQuote: "Plugging leaks is the fastest path to profitability and growth.",
    exampleAnswers: [
      "Spending heavily on acquisition but losing customers to preventable churn",
      "Engineering time spent on manual customer requests instead of building product",
      "Sales team chasing unqualified leads because we can't identify good fit early",
      "Paying for seats/tools that teams don't actually use effectively",
      "Missing expansion revenue because we don't track usage signals or have systematic upsell motions",
      "Support team answering same questions repeatedly instead of having self-serve solutions",
    ],
    backgroundTheme: 'revenue',
  },

  // 3️⃣ SYSTEMS, TOOLS & DATA READINESS (3)
  {
    id: 10,
    category: 'Systems, Tools & Data Readiness',
    question: 'List the main tools used across sales, onboarding, support, analytics, and internal operations. Where do they not align with how your team works?',
    type: 'textarea',
    placeholder: 'List your tech stack and its limitations...',
    motivationalQuote: "The right stack enables flow. The wrong one creates friction.",
    exampleAnswers: [
      "Salesforce for CRM, Intercom for support, Mixpanel for analytics, Notion for docs - nothing connects, lots of manual data transfer",
      "Using HubSpot but only for email, not actually tracking deals properly. Zendesk for support but it's overkill and underutilized",
      "Have powerful tools (Amplitude, Segment, Metabase) but team lacks training, so we still use spreadsheets",
      "Too many tools - Slack, Asana, Jira, Confluence, Monday - team confused about where info lives",
      "Outgrown our starter tools but can't justify/implement enterprise alternatives yet",
    ],
    backgroundTheme: 'tools',
  },
  {
    id: 11,
    category: 'Systems, Tools & Data Readiness',
    question: 'What information would help you make better decisions but is currently hard or slow to access?',
    type: 'textarea',
    placeholder: 'Describe your visibility gaps...',
    motivationalQuote: "Data visibility turns intuition into insight.",
    exampleAnswers: [
      "Real-time view of trial health - who's activated, who's at risk, who should sales call today",
      "Which features drive retention and expansion vs. which ones no one uses",
      "Customer health score combining usage, support tickets, and engagement - all in one place",
      "Accurate revenue forecasting based on pipeline, churn risk, and expansion opportunities",
      "Which marketing channels and campaigns actually lead to retained customers, not just signups",
      "Product adoption metrics by customer segment to understand what drives success",
    ],
    backgroundTheme: 'efficiency',
  },
  {
    id: 12,
    category: 'Systems, Tools & Data Readiness',
    question: 'How reliable and structured is your data today? (Usage data, customer data, support data, revenue data — explain.)',
    type: 'textarea',
    placeholder: 'Assess your data quality and structure...',
    motivationalQuote: "Clean data is the foundation of intelligent automation.",
    exampleAnswers: [
      "Usage data is solid (good tracking), but customer data is messy (duplicates, incomplete fields), support and revenue aren't connected",
      "Everything's in different systems with different formats - would take weeks to get clean unified view",
      "Tracking is inconsistent - some events well-instrumented, others missing. Can't trust reports",
      "Data exists but not structured for analysis - everything is raw logs that need manual processing",
      "Pretty clean in core systems but context and metadata is missing - can't segment or analyze effectively",
    ],
    backgroundTheme: 'team',
  },

  // 4️⃣ INTENT, OUTCOMES & CONSTRAINTS (2)
  {
    id: 13,
    category: 'Intent, Outcomes & Constraints',
    question: 'If this engagement succeeds, what must be meaningfully better in the next 90 days?',
    type: 'textarea',
    placeholder: 'Define your 90-day success criteria...',
    motivationalQuote: "Concrete goals create focused action and measurable wins.",
    exampleAnswers: [
      "Trial-to-paid conversion increases 20%+ through better onboarding automation",
      "Support ticket volume per customer drops 40% with self-serve resources and proactive guidance",
      "We have clear, real-time visibility into customer health and can prevent churn before it happens",
      "Leadership team reclaims 15+ hours/week previously spent on manual reporting and tactical work",
      "Onboarding process scales to 3x customer volume without adding headcount",
      "Revenue expansion from existing customers increases through systematic upsell identification",
    ],
    backgroundTheme: 'revenue',
  },
  {
    id: 14,
    category: 'Intent, Outcomes & Constraints',
    question: 'What concerns, risks, or internal blockers would make you hesitant to adopt automation or AI systems?',
    type: 'textarea',
    placeholder: 'Share your honest concerns and constraints...',
    motivationalQuote: "Addressing concerns upfront turns obstacles into stepping stones.",
    exampleAnswers: [
      "Worried about implementation time - can't afford to disrupt current operations",
      "Team resistance to change, especially if they fear being replaced",
      "Data privacy and security concerns with AI/automation handling customer data",
      "Technical complexity - worried our infrastructure or data quality isn't ready",
      "Budget constraints - ROI needs to be clear and quick",
      "Previous bad experiences with over-promised automation that didn't deliver",
      "Nothing major - if ROI is proven and implementation is phased, we're ready",
    ],
    backgroundTheme: 'challenge',
  },
];

// PROFESSIONAL SERVICES / AGENCIES QUESTIONS
export const agencyQuestions = [
  // 1️⃣ BUSINESS REALITY & DAILY OPERATIONS (5)
  {
    id: 1,
    category: 'Business Reality & Daily Operations',
    question: 'Describe exactly what services you sell today and how work is delivered from signed client to completion.',
    type: 'textarea',
    placeholder: 'Explain your service offerings and delivery process...',
    motivationalQuote: "Clarity in your process is the first step to scaling it.",
    exampleAnswers: [
      "We provide brand strategy and design - client kickoff → discovery workshop → strategy deck → design concepts → revisions → final delivery (typically 6-8 weeks)",
      "Digital marketing agency - onboarding call → account setup → monthly campaign planning → execution → reporting (ongoing retainer)",
      "Management consulting - proposal → data gathering → analysis → strategic recommendations → implementation support",
      "Web development - scoping call → wireframes → design approval → development → QA → launch → handoff",
    ],
    backgroundTheme: 'industry',
  },
  {
    id: 2,
    category: 'Business Reality & Daily Operations',
    question: 'Walk us through a typical workday when things feel busy or overwhelming. What keeps interrupting real progress?',
    type: 'textarea',
    placeholder: 'Describe your chaotic workdays...',
    motivationalQuote: "Understanding interruptions is the key to reclaiming focused time.",
    exampleAnswers: [
      "Mornings consumed by client emails and status requests, team check-ins eat the afternoon, actual work happens after 5pm",
      "Constantly switching between sales calls, client meetings, reviewing deliverables, and fighting fires",
      "Planned work gets derailed by urgent client requests, internal questions, and administrative tasks",
      "Days disappear into meetings while project work piles up for nights and weekends",
    ],
    backgroundTheme: 'team',
  },
  {
    id: 3,
    category: 'Business Reality & Daily Operations',
    question: 'What parts of client delivery, approvals, or decisions still rely heavily on you or one senior person?',
    type: 'textarea',
    placeholder: 'Identify your dependency bottlenecks...',
    motivationalQuote: "Breaking dependencies empowers your team and frees your time.",
    exampleAnswers: [
      "All proposals and scopes require my review before going to clients",
      "I'm on every client call because team doesn't have authority to make decisions",
      "Final deliverables need my approval, creating bottlenecks when I'm busy",
      "Client onboarding and kickoffs require my presence - team can't start without me",
      "Pricing decisions, contract negotiations, and scope changes all funnel through me",
    ],
    backgroundTheme: 'challenge',
  },
  {
    id: 4,
    category: 'Business Reality & Daily Operations',
    question: 'Where do misalignment, delays, or confusion happen with clients most often?',
    type: 'textarea',
    placeholder: 'Describe your client communication breakdowns...',
    motivationalQuote: "Clear communication transforms client relationships from friction to flow.",
    exampleAnswers: [
      "Clients don't understand what's happening week-to-week, leading to check-in calls and status emails",
      "Scope creep because expectations weren't set clearly upfront",
      "Delays waiting for client feedback or approvals that we didn't proactively manage",
      "Miscommunication between our team and client team about deliverables and timelines",
      "Clients surprised by invoices because we didn't track or communicate scope changes",
    ],
    backgroundTheme: 'efficiency',
  },
  {
    id: 5,
    category: 'Business Reality & Daily Operations',
    question: 'What worries you most about taking on more clients with your current setup?',
    type: 'textarea',
    placeholder: 'Share your biggest growth concern...',
    motivationalQuote: "Anticipating constraints allows you to build capacity before you need it.",
    exampleAnswers: [
      "Quality will suffer - we're already stretched thin and I can't oversee everything",
      "Team will burn out from working nights and weekends to keep up",
      "Client communication and project management will break down at higher volume",
      "I'll become an even bigger bottleneck as more decisions require my input",
      "Margins will erode because delivery becomes less efficient as we scale",
    ],
    backgroundTheme: 'revenue',
  },

  // 2️⃣ BOTTLENECKS, SCALE & LEAKAGE (4)
  {
    id: 6,
    category: 'Bottlenecks, Scale & Leakage',
    question: 'Describe what happens from first inquiry to signed contract. Where do deals slow down or fall through?',
    type: 'textarea',
    placeholder: 'Map your sales process and friction points...',
    motivationalQuote: "Every friction point removed is revenue unlocked.",
    exampleAnswers: [
      "Inquiry comes in → I respond (sometimes takes days) → discovery call → proposal draft → revisions → negotiation → contract. Deals die in proposal follow-up",
      "Inbound lead → qualification email → call scheduled (often takes 2 weeks) → proposal → ghosting. Lost deals from slow response",
      "Referral → casual conversation → I forget to follow up → opportunity goes cold",
      "Lead fills form → sits in inbox → by the time I respond they've chosen someone else",
    ],
    backgroundTheme: 'tools',
  },
  {
    id: 7,
    category: 'Bottlenecks, Scale & Leakage',
    question: 'Which parts of service delivery take the most time but don\'t increase client value?',
    type: 'textarea',
    placeholder: 'Identify your low-value time sinks...',
    motivationalQuote: "Eliminate waste to amplify impact.",
    exampleAnswers: [
      "Internal status meetings, updating project trackers, and generating progress reports",
      "Chasing client approvals and feedback repeatedly",
      "Reformatting deliverables and fixing inconsistencies from multiple team members",
      "Administrative work like time tracking, invoicing, and reconciling project budgets",
      "Redoing work because initial requirements weren't captured properly",
    ],
    backgroundTheme: 'challenge',
  },
  {
    id: 8,
    category: 'Bottlenecks, Scale & Leakage',
    question: 'What tasks increase directly with each new client instead of staying efficient?',
    type: 'textarea',
    placeholder: 'List the work that doesn\'t scale...',
    motivationalQuote: "Automation turns effort into assets that scale infinitely.",
    exampleAnswers: [
      "Custom onboarding process for every client - forms, kickoff decks, account setup",
      "Weekly status emails and reporting done manually for each account",
      "Gathering the same information repeatedly through unstructured intake processes",
      "Project setup - creating folders, documents, trackers from scratch each time",
      "Client communication and expectation management - completely manual",
    ],
    backgroundTheme: 'efficiency',
  },
  {
    id: 9,
    category: 'Bottlenecks, Scale & Leakage',
    question: 'Where do you believe profit is being lost today? (Unbilled time, scope creep, slow follow-ups, poor utilization, etc.)',
    type: 'textarea',
    placeholder: 'Identify your profit leakage points...',
    motivationalQuote: "Profit protection is as important as revenue growth.",
    exampleAnswers: [
      "Massive scope creep - we do extra work to keep clients happy but don't bill for it",
      "Team spends billable hours on internal admin and non-client work",
      "Poor time tracking means we underestimate projects and lose margin",
      "Slow proposal follow-up means deals die and pipeline leaks",
      "Over-servicing clients beyond the agreed scope without charging more",
      "Inefficient delivery processes mean projects take 30% longer than they should",
    ],
    backgroundTheme: 'revenue',
  },

  // 3️⃣ SYSTEMS, TOOLS & PROCESS READINESS (3)
  {
    id: 10,
    category: 'Systems, Tools & Process Readiness',
    question: 'List the tools you use across sales, delivery, communication, reporting, and billing. What feels disconnected or redundant?',
    type: 'textarea',
    placeholder: 'Describe your tool stack and pain points...',
    motivationalQuote: "Connected tools create seamless workflows.",
    exampleAnswers: [
      "HubSpot for leads, Asana for projects, Slack for comms, Google Docs for deliverables, QuickBooks for billing - nothing connects",
      "Using spreadsheets for everything because tools don't talk to each other",
      "Have Monday.com but also use email threads and Notion - clients confused, team confused",
      "Multiple tools doing similar things - Trello and Asana both in use, creating duplication",
      "Tools purchased but not adopted - team reverts to email and spreadsheets",
    ],
    backgroundTheme: 'tools',
  },
  {
    id: 11,
    category: 'Systems, Tools & Process Readiness',
    question: 'What information do you wish you had daily or weekly but don\'t today?',
    type: 'textarea',
    placeholder: 'Describe your visibility gaps...',
    motivationalQuote: "Visibility transforms reactive management into proactive leadership.",
    exampleAnswers: [
      "Real-time project profitability - which clients are making us money vs. losing money",
      "Team utilization and capacity - who's overloaded, who has bandwidth for new work",
      "Pipeline health - which deals are progressing, which are stalled, expected close dates",
      "Client health scores - who's happy, who's at risk, who might churn or expand",
      "Accurate project status across all accounts without asking each person individually",
    ],
    backgroundTheme: 'efficiency',
  },
  {
    id: 12,
    category: 'Systems, Tools & Process Readiness',
    question: 'How clearly documented are your sales, delivery, and client management processes?',
    type: 'textarea',
    placeholder: 'Assess your documentation reality...',
    motivationalQuote: "Documentation is the difference between chaos and consistency.",
    exampleAnswers: [
      "Almost nothing documented - everything lives in people's heads and tribal knowledge",
      "Have some templates and guides but they're outdated and no one follows them",
      "Partially documented - sales process is clear but delivery is ad-hoc per project",
      "Well documented but not enforced - team does their own thing anyway",
      "Comprehensive playbooks for everything with regular updates and team training",
    ],
    backgroundTheme: 'team',
  },

  // 4️⃣ INTENT, OUTCOMES & CONSTRAINTS (2)
  {
    id: 13,
    category: 'Intent, Outcomes & Constraints',
    question: 'If this engagement succeeds, what must improve in how your agency runs within 90 days?',
    type: 'textarea',
    placeholder: 'Define your 90-day success vision...',
    motivationalQuote: "Specific goals create measurable momentum.",
    exampleAnswers: [
      "I reclaim 20+ hours/week by delegating client delivery and internal operations",
      "Project profitability increases 25% through better scoping and delivery efficiency",
      "New client onboarding takes 1 hour instead of 1 day per client",
      "Team operates independently without needing me on every call or decision",
      "Lead response time under 2 hours with automated qualification and nurturing",
      "Zero scope creep through clear processes and proactive client communication",
    ],
    backgroundTheme: 'revenue',
  },
  {
    id: 14,
    category: 'Intent, Outcomes & Constraints',
    question: 'What internal concerns, risks, or limitations could slow down change or automation?',
    type: 'textarea',
    placeholder: 'Share your honest constraints...',
    motivationalQuote: "Naming obstacles is the first step to overcoming them.",
    exampleAnswers: [
      "Team is resistant to new processes - they like doing things their own way",
      "Worried clients will feel the 'personal touch' is lost with automation",
      "Don't have time to implement changes while juggling current client load",
      "Budget is tight - need quick ROI to justify investment",
      "Technical complexity - team isn't tech-savvy and I'm worried about adoption",
      "Previous process improvement attempts failed, creating skepticism",
      "None - if the plan is clear and ROI is proven, I'm ready to move",
    ],
    backgroundTheme: 'challenge',
  },
];

// HEALTHCARE SERVICES QUESTIONS
export const healthcareQuestions = [
  // 1️⃣ CARE DELIVERY & DAILY OPERATIONS (5)
  {
    id: 1,
    category: 'Care Delivery & Daily Operations',
    question: 'Describe the full patient journey from first contact to post-visit follow-up. Where does it feel slow, manual, or inconsistent?',
    type: 'textarea',
    placeholder: 'Walk through your patient journey and pain points...',
    motivationalQuote: "A seamless patient journey improves outcomes and practice efficiency.",
    exampleAnswers: [
      "Patient calls → front desk schedules → sends forms via email → patient shows up, fills paper forms again → wait time → visit → checkout → we forget follow-up",
      "Online booking → automated confirmation → patient arrives → manual check-in → EHR entry → visit → billing happens days later → no systematic follow-up",
      "Referral received → staff calls to schedule → multiple voicemails → finally connects → appointment → visit notes dictated later → referring provider never gets update",
      "New patient inquiry → qualification call → intake forms sent → forms come back incomplete → back-and-forth → first visit → inconsistent post-visit communication",
    ],
    backgroundTheme: 'industry',
  },
  {
    id: 2,
    category: 'Care Delivery & Daily Operations',
    question: 'What happens on a "busy but normal" day at your practice? Where do delays, mistakes, or stress usually appear?',
    type: 'textarea',
    placeholder: 'Describe a typical busy day...',
    motivationalQuote: "Identifying patterns in chaos is the first step to creating calm.",
    exampleAnswers: [
      "Morning starts with overbooked schedule, patients running late, staff scrambling for missing records, providers behind all day, checkout backlog by afternoon",
      "Front desk overwhelmed with calls while trying to check patients in, insurance verification delays, documentation piles up for providers after hours",
      "Double-bookings happen when online and phone scheduling don't sync, staff manually resolving conflicts, patients frustrated by wait times",
      "Urgent add-ons disrupt the schedule, staff can't find patient history quickly, billing errors from rushed documentation",
    ],
    backgroundTheme: 'team',
  },
  {
    id: 3,
    category: 'Care Delivery & Daily Operations',
    question: 'Which tasks consume provider or staff time but shouldn\'t require clinical attention?',
    type: 'textarea',
    placeholder: 'List non-clinical work eating clinical time...',
    motivationalQuote: "Protecting clinical time protects your practice's most valuable resource.",
    exampleAnswers: [
      "Providers spend 2+ hours daily on documentation, prior authorizations, and insurance follow-ups",
      "Nurses fielding routine questions that could be handled by automated FAQs or triage systems",
      "Clinicians tracking down test results, referral status, or patient records manually",
      "Staff calling patients for appointment reminders, rescheduling no-shows, collecting payments",
      "Providers answering routine patient messages that don't require clinical judgment",
    ],
    backgroundTheme: 'challenge',
  },
  {
    id: 4,
    category: 'Care Delivery & Daily Operations',
    question: 'Where does scheduling break down? (No-shows, rescheduling, overbooking, underutilized capacity, etc.)',
    type: 'textarea',
    placeholder: 'Describe your scheduling challenges...',
    motivationalQuote: "Optimal scheduling maximizes care delivery and revenue.",
    exampleAnswers: [
      "15-20% no-show rate with no systematic prevention or backfill strategy",
      "Overbooking to compensate for no-shows but then chaos when everyone shows up",
      "Prime time slots filled weeks out while early morning and late afternoon sit empty",
      "Different providers have different booking rules but system can't handle complexity",
      "Last-minute cancellations leave gaps we can't fill, losing revenue daily",
      "Online scheduling shows availability that's not accurate, creating double-books",
    ],
    backgroundTheme: 'efficiency',
  },
  {
    id: 5,
    category: 'Care Delivery & Daily Operations',
    question: 'What decisions or escalations still require you or a senior clinician to step in?',
    type: 'textarea',
    placeholder: 'Identify your operational bottlenecks...',
    motivationalQuote: "Empowering your team multiplies your practice's capacity.",
    exampleAnswers: [
      "All patient complaints or billing disputes escalate to me",
      "Staff can't make scheduling exceptions or policy decisions without approval",
      "Treatment plan modifications or refund requests require my review",
      "Hiring, training, and operational changes wait for my availability",
      "Insurance denials and prior auth appeals funnel through me personally",
    ],
    backgroundTheme: 'revenue',
  },

  // 2️⃣ BOTTLENECKS, RISK & LEAKAGE (4)
  {
    id: 6,
    category: 'Bottlenecks, Risk & Leakage',
    question: 'Which admin tasks feel repetitive, time-consuming, or error-prone today?',
    type: 'textarea',
    placeholder: 'List your administrative pain points...',
    motivationalQuote: "Eliminating administrative friction unlocks clinical excellence.",
    exampleAnswers: [
      "Insurance verification done manually for every patient, high error rate, delays care",
      "Manually entering patient information across multiple systems that don't communicate",
      "Chasing unpaid claims and patient balances through phone calls and letters",
      "Prior authorization paperwork taking hours per patient",
      "Manually tracking referrals and following up on specialist appointments",
      "Patient intake forms collected but then re-entered into EHR manually",
    ],
    backgroundTheme: 'tools',
  },
  {
    id: 7,
    category: 'Bottlenecks, Risk & Leakage',
    question: 'Where do patients get confused, delayed, or frustrated in communication?',
    type: 'textarea',
    placeholder: 'Describe patient communication breakdowns...',
    motivationalQuote: "Clear communication builds trust and reduces administrative burden.",
    exampleAnswers: [
      "Patients don't know what their appointment is for or what to bring",
      "Test results take too long to communicate, patients call repeatedly asking for updates",
      "Insurance and billing questions go unanswered for days, leading to frustration",
      "Pre-visit instructions unclear, patients show up unprepared",
      "No clear point of contact - patients bounce between front desk, nurses, and billing",
      "Follow-up care instructions given verbally but patients forget or misunderstand",
    ],
    backgroundTheme: 'challenge',
  },
  {
    id: 8,
    category: 'Bottlenecks, Risk & Leakage',
    question: 'Where do you believe revenue or efficiency is being lost? (No-shows, slow billing, missed follow-ups, underfilled schedules.)',
    type: 'textarea',
    placeholder: 'Identify your revenue leakage points...',
    motivationalQuote: "Every efficiency gain translates to better care and profitability.",
    exampleAnswers: [
      "No-shows cost us $5K+ per week in lost revenue with no prevention system",
      "Billing happens days or weeks after service, increasing denials and write-offs",
      "Don't systematically book follow-ups, patients drop off and we lose continuity revenue",
      "Underutilized provider time due to scheduling gaps that could be filled",
      "Slow claims submission and follow-up means cash flow is 60-90 days behind",
      "Don't capture all billable services because documentation is incomplete",
    ],
    backgroundTheme: 'revenue',
  },
  {
    id: 9,
    category: 'Bottlenecks, Risk & Leakage',
    question: 'What compliance, documentation, or audit concerns keep you cautious or slow to change?',
    type: 'textarea',
    placeholder: 'Share your compliance concerns...',
    motivationalQuote: "Smart automation can enhance compliance while reducing burden.",
    exampleAnswers: [
      "HIPAA compliance concerns with any new communication or automation tools",
      "Documentation needs to be thorough for liability and insurance, takes providers forever",
      "State licensing and scope of practice rules limit what staff can do",
      "Worried about audit risk if billing or documentation isn't perfectly detailed",
      "Patient consent and privacy requirements slow down process improvements",
      "Medical record retention and security requirements limit system flexibility",
    ],
    backgroundTheme: 'challenge',
  },

  // 3️⃣ SYSTEMS, DATA & READINESS (3)
  {
    id: 10,
    category: 'Systems, Data & Readiness',
    question: 'List the systems you use (EHR, scheduling, billing, communication, reporting). What feels fragmented or outdated?',
    type: 'textarea',
    placeholder: 'Describe your tech stack and frustrations...',
    motivationalQuote: "Integrated systems create seamless operations.",
    exampleAnswers: [
      "EHR is clunky and outdated, separate scheduling system doesn't sync, billing is manual export/import, communication via personal phone",
      "Using [Epic/Cerner/Athena] but only scratching the surface of functionality, everything feels disconnected",
      "Have multiple point solutions that don't talk - EHR, practice management, patient portal, billing, reminders all separate",
      "Legacy system that can't integrate with modern tools, stuck with manual workflows",
      "Too many logins and systems, staff frustrated, high error rate from manual data transfer",
    ],
    backgroundTheme: 'tools',
  },
  {
    id: 11,
    category: 'Systems, Data & Readiness',
    question: 'What data do you wish you had real-time visibility into but currently don\'t?',
    type: 'textarea',
    placeholder: 'Describe your visibility gaps...',
    motivationalQuote: "Data visibility enables proactive management.",
    exampleAnswers: [
      "Real-time provider productivity and utilization rates",
      "Patient satisfaction and at-risk indicators before they become complaints",
      "Revenue cycle health - claims status, denial reasons, collection rates",
      "Schedule optimization metrics - no-show patterns, underutilized slots, wait times",
      "Patient flow bottlenecks - where delays happen in the patient journey",
      "Financial performance by provider, service line, or payer",
    ],
    backgroundTheme: 'efficiency',
  },
  {
    id: 12,
    category: 'Systems, Data & Readiness',
    question: 'How standardized are processes across staff, providers, or locations?',
    type: 'textarea',
    placeholder: 'Assess your process consistency...',
    motivationalQuote: "Consistency creates predictable excellence.",
    exampleAnswers: [
      "Every provider does things their own way - no standardized workflows",
      "Front desk procedures vary by who's working, patient experience is inconsistent",
      "Have written protocols but they're not followed or enforced",
      "One location runs smoothly, others are chaotic - can't replicate success",
      "New staff learn through shadowing, pick up bad habits, inconsistency multiplies",
      "Mostly standardized with clear protocols, regular training, and accountability",
    ],
    backgroundTheme: 'team',
  },

  // 4️⃣ INTENT, OUTCOMES & CONSTRAINTS (2)
  {
    id: 13,
    category: 'Intent, Outcomes & Constraints',
    question: 'If this engagement works, what must measurably improve in 90 days?',
    type: 'textarea',
    placeholder: 'Define your 90-day success metrics...',
    motivationalQuote: "Clear outcomes create focused transformation.",
    exampleAnswers: [
      "No-show rate drops from 18% to under 8% through automated reminders and waitlist management",
      "Provider documentation time reduced by 50% through better workflows and templates",
      "Patient satisfaction scores increase 20+ points with better communication and reduced wait times",
      "Claims submission within 48 hours of service, reducing days in A/R by 30%",
      "Schedule utilization increases 15% by optimizing booking rules and filling gaps",
      "Administrative staff reclaims 10+ hours/week from automated routine tasks",
    ],
    backgroundTheme: 'revenue',
  },
  {
    id: 14,
    category: 'Intent, Outcomes & Constraints',
    question: 'What internal limits (compliance, staff resistance, budget, risk tolerance) must be respected?',
    type: 'textarea',
    placeholder: 'Share your constraints honestly...',
    motivationalQuote: "Understanding boundaries enables sustainable change.",
    exampleAnswers: [
      "HIPAA compliance is non-negotiable - any solution must be fully compliant and auditable",
      "Staff is older and tech-averse, need extremely simple solutions with heavy training support",
      "Budget is limited - need clear, fast ROI to justify any investment",
      "Can't disrupt patient care during implementation - changes must be phased carefully",
      "Regulatory and licensing constraints limit what can be delegated or automated",
      "Previous failed implementations created skepticism - need proven, low-risk approach",
      "Minimal constraints - if it improves care and operations, we're ready to move",
    ],
    backgroundTheme: 'challenge',
  },
];

// CREATORS / TRAINING / COURSES QUESTIONS
export const creatorsQuestions = [
  // 1️⃣ OFFER, CONTENT & DELIVERY REALITY (4)
  {
    id: 1,
    category: 'Offer, Content & Delivery Reality',
    question: 'Describe what you sell today (courses, cohorts, memberships, 1:1, bundles). Which parts feel scalable, and which feel tied directly to you?',
    type: 'textarea',
    placeholder: 'Explain your offerings and what scales vs. what depends on you...',
    motivationalQuote: "Leverage is the difference between income and impact at scale.",
    exampleAnswers: [
      "Self-paced course ($497) feels scalable, but weekly Q&A calls and 1:1 feedback sessions require my time and limit growth",
      "Cohort-based program ($2K) - delivers great results but completely dependent on me running live sessions, can only do 2-3 per year",
      "Membership ($97/month) with mix of recorded content (scalable) and monthly coaching calls (not scalable)",
      "High-ticket 1:1 coaching ($5K) generates revenue but trades time for money, can't grow without cloning myself",
    ],
    backgroundTheme: 'industry',
  },
  {
    id: 2,
    category: 'Offer, Content & Delivery Reality',
    question: 'What does it take to create, update, and deliver content consistently? Where does it feel slow, exhausting, or repetitive?',
    type: 'textarea',
    placeholder: 'Describe your content creation reality...',
    motivationalQuote: "Systems turn creative energy into sustainable output.",
    exampleAnswers: [
      "Every lesson filmed from scratch, editing takes 2-3 hours per video, uploading and organizing is manual chaos",
      "Constantly updating content when platform features change, feels like running on a treadmill",
      "Creating weekly emails, social posts, lessons - no templates or systems, starts from zero each time",
      "Recording is fast but editing, transcription, repurposing takes forever - most content created once and never reused",
      "Student questions repeat but I answer them individually every time instead of building a knowledge base",
    ],
    backgroundTheme: 'team',
  },
  {
    id: 3,
    category: 'Offer, Content & Delivery Reality',
    question: 'Where do learners get confused, disengaged, or drop off during your programs?',
    type: 'textarea',
    placeholder: 'Identify your learner friction points...',
    motivationalQuote: "Student success is your best marketing and retention strategy.",
    exampleAnswers: [
      "Many buy but never start - onboarding is unclear and they get overwhelmed",
      "Drop-off happens around module 3-4 when content gets more advanced and support isn't proactive",
      "Students get stuck on technical setup and lose momentum before reaching valuable content",
      "Completion rates under 15% - no accountability structure, students lose motivation",
      "Too much content with no clear path, students don't know what to prioritize",
      "Community is quiet, students feel alone, don't get questions answered quickly",
    ],
    backgroundTheme: 'challenge',
  },
  {
    id: 4,
    category: 'Offer, Content & Delivery Reality',
    question: 'Which parts of delivery, support, or motivation still require you personally?',
    type: 'textarea',
    placeholder: 'List what only you can do...',
    motivationalQuote: "Delegation and automation multiply your impact without multiplying your hours.",
    exampleAnswers: [
      "All student questions come to me directly via email, DM, or community",
      "I personally onboard every student with welcome message and kick-off call",
      "Providing feedback on assignments, reviewing student work, giving personalized advice",
      "Running live sessions, accountability check-ins, motivational messages",
      "Handling refund requests, technical issues, payment problems",
    ],
    backgroundTheme: 'efficiency',
  },

  // 2️⃣ GROWTH, FUNNELS & REVENUE LEAKAGE (4)
  {
    id: 5,
    category: 'Growth, Funnels & Revenue Leakage',
    question: 'How do people currently discover you and enter your world? Where does momentum break or stall?',
    type: 'textarea',
    placeholder: 'Map your lead generation and friction points...',
    motivationalQuote: "A frictionless journey from awareness to enrollment compounds growth.",
    exampleAnswers: [
      "Mostly organic social media → profile → link in bio → confused by too many options → they leave",
      "YouTube videos drive traffic but no clear call-to-action or next step, viewers don't convert",
      "Launch strategy works but nothing happens between launches, revenue is feast or famine",
      "Email list grows but nurture is inconsistent, people forget about me before I launch again",
      "Referrals come in but no systematic way to capture and follow up with them",
    ],
    backgroundTheme: 'tools',
  },
  {
    id: 6,
    category: 'Growth, Funnels & Revenue Leakage',
    question: 'Where do interested people hesitate, delay, or disappear before buying?',
    type: 'textarea',
    placeholder: 'Identify your conversion bottlenecks...',
    motivationalQuote: "Every objection unaddressed is revenue left on the table.",
    exampleAnswers: [
      "People engage with content but don't know pricing until sales page, sticker shock causes abandonment",
      "Interested leads ask questions via DM but I'm slow to respond and they buy elsewhere",
      "Long application process for high-ticket program, many start but don't finish",
      "No payment plans offered, price barrier prevents purchase",
      "Sales page doesn't address common objections, people have doubts but nowhere to get them answered",
      "Launch cart abandonment is high - they add to cart but don't complete checkout",
    ],
    backgroundTheme: 'challenge',
  },
  {
    id: 7,
    category: 'Growth, Funnels & Revenue Leakage',
    question: 'How are leads and students followed up with today? What\'s manual, inconsistent, or missing?',
    type: 'textarea',
    placeholder: 'Describe your follow-up reality...',
    motivationalQuote: "Consistent follow-up turns interest into investment.",
    exampleAnswers: [
      "No systematic follow-up - if they don't buy immediately, they fall through the cracks",
      "Manually sending DMs to interested people but can't keep up as list grows",
      "Email sequences exist but incomplete, many leads never hear from me after opting in",
      "Students who fall behind get no check-in or re-engagement",
      "Alumni aren't nurtured or invited to upsells, leaving money on the table",
      "Cart abandoners get no recovery sequence",
    ],
    backgroundTheme: 'efficiency',
  },
  {
    id: 8,
    category: 'Growth, Funnels & Revenue Leakage',
    question: 'What\'s currently limiting revenue growth: traffic, conversion, delivery capacity, or time?',
    type: 'textarea',
    placeholder: 'Identify your growth ceiling...',
    motivationalQuote: "Identifying the constraint is the first step to breaking through it.",
    exampleAnswers: [
      "Have traffic but conversion is terrible - need better funnels and follow-up",
      "Conversion is fine but capped on delivery - can't onboard more students without more of my time",
      "Don't have enough qualified traffic - audience is growing but not the right people",
      "Revenue limited by my time - trading hours for dollars, can't scale current model",
      "Have both traffic and conversion but delivery quality suffers at volume",
    ],
    backgroundTheme: 'revenue',
  },

  // 3️⃣ SYSTEMS, OPERATIONS & SCALE (4)
  {
    id: 9,
    category: 'Systems, Operations & Scale',
    question: 'List the tools you use (platforms, email, payments, community, analytics). What feels disconnected or hard to manage?',
    type: 'textarea',
    placeholder: 'Describe your tool stack and pain points...',
    motivationalQuote: "The right stack creates flow. The wrong one creates friction.",
    exampleAnswers: [
      "Teachable for courses, ConvertKit for email, Stripe for payments, Facebook group for community, Google Analytics - nothing connects",
      "Using 10+ tools, logging in/out constantly, data scattered everywhere",
      "Course platform has terrible user experience but too invested to switch",
      "Email tool doesn't integrate with course platform, manual tagging and segmentation",
      "Community lives on Discord but students also email, DM on Instagram - communication is fragmented",
    ],
    backgroundTheme: 'tools',
  },
  {
    id: 10,
    category: 'Systems, Operations & Scale',
    question: 'Which non-creative tasks consume time but don\'t directly grow revenue?',
    type: 'textarea',
    placeholder: 'List your operational time drains...',
    motivationalQuote: "Eliminate the trivial to amplify the essential.",
    exampleAnswers: [
      "Manually enrolling students, sending access credentials, troubleshooting login issues",
      "Answering the same basic questions repeatedly instead of having good onboarding",
      "Uploading content to multiple platforms, organizing files, updating lesson links",
      "Invoicing, refund processing, tax document prep",
      "Managing community spam, duplicate posts, organizing channels",
      "Reporting and analytics - manually pulling data from different sources",
    ],
    backgroundTheme: 'efficiency',
  },
  {
    id: 11,
    category: 'Systems, Operations & Scale',
    question: 'How are questions, feedback, and support handled today? What breaks as volume increases?',
    type: 'textarea',
    placeholder: 'Describe your support system (or lack thereof)...',
    motivationalQuote: "Scalable support maintains quality as you grow.",
    exampleAnswers: [
      "Everything funnels to me - email, DM, community tags - drowning in notifications",
      "Community is active but I'm the only one answering questions, can't keep up",
      "No FAQ or help center, students ask same questions over and over",
      "Response time has gone from hours to days as student count increased",
      "Technical support vs. learning support all mixed together, no triage system",
      "Student feedback goes into the void - no organized way to track and implement improvements",
    ],
    backgroundTheme: 'challenge',
  },
  {
    id: 12,
    category: 'Systems, Operations & Scale',
    question: 'What numbers do you wish you could see clearly but can\'t today?',
    type: 'textarea',
    placeholder: 'Describe your data blind spots...',
    motivationalQuote: "What gets measured gets managed and improved.",
    exampleAnswers: [
      "Student progress and completion rates - who's engaged vs. at risk of dropping off",
      "True revenue per student (LTV) factoring in upsells, renewals, and retention",
      "Which marketing channels actually lead to paying customers, not just email signups",
      "Content performance - which lessons get watched, where people drop off",
      "Community engagement quality - who are power users, where are the gaps",
      "Real profitability after all tool costs, contractor expenses, and my time",
    ],
    backgroundTheme: 'team',
  },

  // 4️⃣ DIRECTION, INTENT & CONSTRAINTS (2)
  {
    id: 13,
    category: 'Direction, Intent & Constraints',
    question: 'If everything worked, what would this business look like in 6–12 months without more personal workload?',
    type: 'textarea',
    placeholder: 'Paint your ideal future state...',
    motivationalQuote: "Vision without systems is a dream. Systems without vision is chaos. Both together is mastery.",
    exampleAnswers: [
      "Evergreen funnels generate 20+ enrollments weekly without launches, I focus on creating new content and high-level strategy",
      "Team handles operations, support, and community, I only show up for live teaching and content creation",
      "Revenue 3x current with same time input through better systems, automation, and delivery leverage",
      "Students succeed at higher rates with less intervention from me due to better onboarding and accountability systems",
      "Passive income from courses funds lifestyle while I explore new creative projects",
    ],
    backgroundTheme: 'revenue',
  },
  {
    id: 14,
    category: 'Direction, Intent & Constraints',
    question: 'What must be protected at all costs? (Brand voice, quality, authenticity, student experience, budget, control.)',
    type: 'textarea',
    placeholder: 'Define your non-negotiables...',
    motivationalQuote: "Knowing what not to compromise guides every decision.",
    exampleAnswers: [
      "Authenticity and personal connection - won't automate to the point where it feels robotic",
      "Student results and transformation - refuse to sacrifice quality for scale",
      "Creative control - won't hand off content creation or brand voice to anyone else",
      "Budget is tight - need bootstrapped solutions with fast ROI, not enterprise tools",
      "Simple systems - opposed to complexity, want elegant solutions my small team can manage",
      "Personal brand integrity - won't do aggressive marketing or tactics that feel off-brand",
    ],
    backgroundTheme: 'challenge',
  },
];

// NON-PROFIT / EDUCATION QUESTIONS
export const nonprofitQuestions = [
  // 1️⃣ MISSION, IMPACT & REALITY (4)
  {
    id: 1,
    category: 'Mission, Impact & Reality',
    question: 'Describe your mission in one paragraph. Now describe what actually consumes most of your time and energy day-to-day.',
    type: 'textarea',
    placeholder: 'Share your mission and daily reality...',
    motivationalQuote: "Closing the gap between mission and daily work multiplies impact.",
    exampleAnswers: [
      "Mission: Empower underserved youth through education. Reality: 60% of my time is fundraising, admin, and compliance instead of program delivery",
      "Mission: Provide mental health services to low-income families. Reality: Drowning in grant reporting, scheduling, and billing - limited time for actual service expansion",
      "Mission: Environmental conservation through community action. Reality: Coordinating volunteers, chasing donations, fixing website issues - mission work feels secondary",
      "Mission: Adult literacy and job training. Reality: Most energy goes to maintaining operations, not innovating or reaching more people",
    ],
    backgroundTheme: 'industry',
  },
  {
    id: 2,
    category: 'Mission, Impact & Reality',
    question: 'How do you currently measure impact or success? Where does it feel unclear, manual, or hard to communicate?',
    type: 'textarea',
    placeholder: 'Describe your impact measurement challenges...',
    motivationalQuote: "Clear metrics turn stories into strategy and donors into partners.",
    exampleAnswers: [
      "Track program participation numbers but not outcomes - hard to prove we're actually making a difference",
      "Collecting success stories manually through emails and interviews - inconsistent and time-consuming",
      "Have metrics but they're scattered across spreadsheets, can't easily show trends or progress to board/donors",
      "Measure outputs (workshops delivered) but not outcomes (skills gained, lives changed)",
      "Different programs use different tracking methods - no unified view of organizational impact",
    ],
    backgroundTheme: 'team',
  },
  {
    id: 3,
    category: 'Mission, Impact & Reality',
    question: 'Which programs or initiatives are hardest to run smoothly — and why?',
    type: 'textarea',
    placeholder: 'Identify your operational friction points...',
    motivationalQuote: "Smooth execution amplifies impact without burning out your team.",
    exampleAnswers: [
      "Multi-site programs - coordination across locations is chaotic, inconsistent quality and communication",
      "Volunteer-dependent programs - high turnover, constant retraining, unpredictable capacity",
      "Partnership programs - too much manual coordination with external organizations, things fall through cracks",
      "Intake and eligibility processes - paper forms, manual verification, slow enrollment, people drop off",
      "Grant-funded pilots - great ideas but no systems to sustain or scale after funding ends",
    ],
    backgroundTheme: 'challenge',
  },
  {
    id: 4,
    category: 'Mission, Impact & Reality',
    question: 'Where do decisions, approvals, or progress slow down because too much depends on a few people?',
    type: 'textarea',
    placeholder: 'Identify your leadership bottlenecks...',
    motivationalQuote: "Distributed authority creates organizational resilience and speed.",
    exampleAnswers: [
      "Executive Director approves everything - grants, hiring, partnerships, budgets - creates delays and burnout",
      "Board approval required for operational decisions that should be delegated to staff",
      "Program decisions wait for weekly staff meetings instead of empowering team leads",
      "Financial decisions bottleneck with treasurer who's hard to reach",
      "Only 2-3 people understand key systems, so vacation or turnover creates crisis",
    ],
    backgroundTheme: 'efficiency',
  },

  // 2️⃣ FUNDING, DONORS & SUSTAINABILITY (4)
  {
    id: 5,
    category: 'Funding, Donors & Sustainability',
    question: 'Describe all current funding sources (grants, donors, sponsors, fees, memberships). Which feel stable, and which feel stressful or unpredictable?',
    type: 'textarea',
    placeholder: 'Map your funding landscape...',
    motivationalQuote: "Diversified, predictable funding enables mission-focused decisions.",
    exampleAnswers: [
      "80% grant-funded - stable for now but restrictive and time-consuming to manage, always chasing renewals",
      "Mix of individual donors (unpredictable), corporate sponsors (relationship-dependent), and small earned revenue (underdeveloped)",
      "Heavily reliant on one major donor - grateful but terrified of losing them",
      "Government contracts provide stability but bureaucracy is suffocating",
      "Monthly donors are most stable, one-time donors never return, grants are feast or famine",
    ],
    backgroundTheme: 'revenue',
  },
  {
    id: 6,
    category: 'Funding, Donors & Sustainability',
    question: 'Where do relationships weaken over time due to lack of follow-up, reporting, or communication?',
    type: 'textarea',
    placeholder: 'Describe your relationship gaps...',
    motivationalQuote: "Stewardship is not overhead—it's the foundation of sustainability.",
    exampleAnswers: [
      "Donors give once, we send thank you, then don't communicate again until next ask - they don't give again",
      "Grant reports submitted but don't proactively share wins or challenges with funders throughout the year",
      "Board members drift away because we don't keep them engaged between meetings",
      "Corporate sponsors don't renew because we didn't demonstrate impact or show appreciation beyond initial check",
      "Alumni/past participants lose connection - no systematic way to keep them engaged as advocates or donors",
    ],
    backgroundTheme: 'challenge',
  },
  {
    id: 7,
    category: 'Funding, Donors & Sustainability',
    question: 'What reporting, compliance, or documentation work drains the most time?',
    type: 'textarea',
    placeholder: 'List your administrative burdens...',
    motivationalQuote: "Smart systems turn compliance from burden to baseline.",
    exampleAnswers: [
      "Grant reporting - each funder has different requirements, manually pulling data from multiple sources for each report",
      "Financial audits and 990 prep consume weeks of staff time annually",
      "Donor acknowledgment letters, receipts, and year-end statements mostly manual",
      "Program documentation for compliance - participant files, attendance, outcomes tracking all paper or disconnected spreadsheets",
      "Board reporting packages assembled from scratch each month",
    ],
    backgroundTheme: 'tools',
  },
  {
    id: 8,
    category: 'Funding, Donors & Sustainability',
    question: 'What stops you from expanding impact right now: funding, staff capacity, systems, or coordination?',
    type: 'textarea',
    placeholder: 'Identify your growth constraint...',
    motivationalQuote: "Knowing the constraint focuses improvement efforts where they matter most.",
    exampleAnswers: [
      "Have funding but can't hire fast enough or onboard staff effectively",
      "Could serve more people but systems would break - current processes don't scale",
      "Funding is there but restricted - can't use it for infrastructure or staff we actually need",
      "Staff capacity maxed out - working nights and weekends, adding more would break current team",
      "Coordination across programs/locations is limiting - could do more if we worked together better",
    ],
    backgroundTheme: 'efficiency',
  },

  // 3️⃣ OPERATIONS, SYSTEMS & PEOPLE (4)
  {
    id: 9,
    category: 'Operations, Systems & People',
    question: 'Which internal processes feel slow, manual, or duplicated across teams?',
    type: 'textarea',
    placeholder: 'Describe your operational inefficiencies...',
    motivationalQuote: "Streamlined operations free resources for mission delivery.",
    exampleAnswers: [
      "Every program tracks participants separately in their own spreadsheets - no centralized database",
      "Expense reimbursement and purchasing approvals are paper-based, take weeks",
      "Onboarding new staff/volunteers is ad hoc, inconsistent, relies on whoever has time to train",
      "Communications (emails, social, newsletters) created from scratch each time by different people",
      "Meeting scheduling, room booking, resource sharing all manual and chaotic",
    ],
    backgroundTheme: 'team',
  },
  {
    id: 10,
    category: 'Operations, Systems & People',
    question: 'List the tools, platforms, or spreadsheets you rely on today. What feels fragmented or hard to trust?',
    type: 'textarea',
    placeholder: 'Describe your tech ecosystem...',
    motivationalQuote: "Integrated tools create single sources of truth, not chaos.",
    exampleAnswers: [
      "QuickBooks for accounting, Excel for program tracking, Google Forms for intake, Mailchimp for donors, shared drives for documents - nothing talks to each other",
      "Using outdated donor database that's clunky, limited reporting, doesn't integrate with anything",
      "Critical data lives in individual staff member's spreadsheets - no single source of truth",
      "Free/cheap tools that barely work because we can't afford better, constantly working around limitations",
      "Too many logins, permissions issues, data scattered everywhere",
    ],
    backgroundTheme: 'tools',
  },
  {
    id: 11,
    category: 'Operations, Systems & People',
    question: 'What breaks when onboarding, coordinating, or supporting staff and volunteers?',
    type: 'textarea',
    placeholder: 'Identify your people management gaps...',
    motivationalQuote: "Empowered, supported teams multiply organizational capacity.",
    exampleAnswers: [
      "No structured onboarding - new people learn by shadowing whoever is available, picks up bad habits",
      "Volunteer scheduling is manual chaos via email and texts, constant double-booking and no-shows",
      "Training materials outdated or non-existent, everyone learns differently",
      "No clear roles or authority - staff unsure who can make decisions on what",
      "Recognition and feedback are inconsistent - good people leave because they feel undervalued",
      "Remote/hybrid coordination failing - lack of communication and accountability",
    ],
    backgroundTheme: 'challenge',
  },
  {
    id: 12,
    category: 'Operations, Systems & People',
    question: 'What information do leaders wish they had in one place but don\'t today?',
    type: 'textarea',
    placeholder: 'Describe your visibility gaps...',
    motivationalQuote: "Data visibility enables proactive leadership, not reactive crisis management.",
    exampleAnswers: [
      "Real-time program performance - who's being served, completion rates, outcomes across all programs",
      "Unified donor view - giving history, engagement level, communication history in one place",
      "Financial health dashboard - budget vs actuals, cash flow, restricted vs unrestricted funds",
      "Staff/volunteer capacity and utilization - who's overloaded, who has capacity, skills inventory",
      "Pipeline view of grants - what's pending, reporting due dates, renewal timelines",
      "Organizational KPIs in one dashboard instead of scattered across reports",
    ],
    backgroundTheme: 'efficiency',
  },

  // 4️⃣ FUTURE DIRECTION & CONSTRAINTS (2)
  {
    id: 13,
    category: 'Future Direction & Constraints',
    question: 'If systems were not the bottleneck, what impact would you want to achieve in the next year?',
    type: 'textarea',
    placeholder: 'Paint your impact vision...',
    motivationalQuote: "Systems enable strategy. Strategy without systems is just dreaming.",
    exampleAnswers: [
      "Serve 3x more people with same staff through better processes and technology",
      "Launch in 2 new cities without reinventing the wheel - replicate proven model",
      "Increase program completion rates by 40% through better participant tracking and engagement",
      "Diversify funding - reduce grant dependency from 80% to 50%, grow individual giving program",
      "Achieve true collaboration across programs - break down silos, share resources and learnings",
      "Free leadership to focus on strategy and partnerships instead of daily firefighting",
    ],
    backgroundTheme: 'revenue',
  },
  {
    id: 14,
    category: 'Future Direction & Constraints',
    question: 'What constraints must be respected? (Budget limits, donor expectations, compliance, transparency, community trust.)',
    type: 'textarea',
    placeholder: 'Define your non-negotiables...',
    motivationalQuote: "Constraints focus innovation on what matters most to your mission.",
    exampleAnswers: [
      "Budget is extremely limited - need low-cost solutions with clear ROI",
      "Transparency and data privacy are non-negotiable - community trust is our most valuable asset",
      "Donor restrictions must be honored precisely - can't commingle funds or violate grant terms",
      "Board oversight and approval required for major changes - need their buy-in",
      "Must maintain program quality - won't sacrifice participant experience for efficiency",
      "Cultural sensitivity and community voice must be centered in any changes",
      "Compliance requirements (audits, reporting, licenses) cannot be compromised",
    ],
    backgroundTheme: 'challenge',
  },
];

// GOVERNMENT / PUBLIC SECTOR QUESTIONS
export const governmentQuestions = [
  // 1️⃣ MANDATE, OUTCOMES & REALITY (4)
  {
    id: 1,
    category: 'Mandate, Outcomes & Reality',
    question: 'What is your department\'s official mandate or responsibility? Where does execution fall short in reality?',
    type: 'textarea',
    placeholder: 'Describe your mandate and the execution gap...',
    motivationalQuote: "Closing the gap between mandate and execution restores public trust.",
    exampleAnswers: [
      "Mandate: Process permits within 30 days. Reality: Average 90+ days due to manual review, backlogs, and inter-department dependencies",
      "Mandate: Provide timely constituent services. Reality: Lost in email overload, no tracking system, constituents fall through cracks",
      "Mandate: Transparent budget oversight. Reality: Data scattered across systems, reports assembled manually, outdated by publication",
      "Mandate: Safe infrastructure maintenance. Reality: Reactive instead of preventive due to poor asset tracking and coordination",
    ],
    backgroundTheme: 'industry',
  },
  {
    id: 2,
    category: 'Mandate, Outcomes & Reality',
    question: 'Which public-facing services are slow, inefficient, or complaint-heavy — and why?',
    type: 'textarea',
    placeholder: 'Identify your service delivery pain points...',
    motivationalQuote: "Efficient service delivery transforms how citizens experience government.",
    exampleAnswers: [
      "Permit applications require in-person visits, paper forms, multiple departments - takes months, citizens complain constantly",
      "Public records requests manually fulfilled, no portal, takes weeks to locate documents",
      "License renewals still paper-based, long lines, outdated database causes errors",
      "Complaint/request intake fragmented across phone, email, walk-ins - no unified tracking or response management",
      "Benefits applications complex and opaque - applicants don't know status, call repeatedly",
    ],
    backgroundTheme: 'challenge',
  },
  {
    id: 3,
    category: 'Mandate, Outcomes & Reality',
    question: 'Where do good policies fail during execution due to systems, approvals, or coordination?',
    type: 'textarea',
    placeholder: 'Describe policy-to-action breakdowns...',
    motivationalQuote: "Policy without operational support is just paperwork.",
    exampleAnswers: [
      "New transparency policy passed but no system to publish data consistently - manual exports, inconsistent formats",
      "Streamlined approval policy created but still requires 7 signatures across departments - process unchanged",
      "Digital-first initiative announced but staff lack training, citizens lack access, reverts to paper",
      "Data sharing policy approved but IT systems can't talk to each other, still manual transfers",
      "Faster response time mandated but no additional staff or tools provided to achieve it",
    ],
    backgroundTheme: 'efficiency',
  },
  {
    id: 4,
    category: 'Mandate, Outcomes & Reality',
    question: 'Which processes depend too heavily on specific individuals to function correctly?',
    type: 'textarea',
    placeholder: 'Identify your leadership/expertise bottlenecks...',
    motivationalQuote: "Institutional knowledge should live in systems, not just in people.",
    exampleAnswers: [
      "One person knows the legacy database - if they're out, work stops",
      "Director approval required for routine decisions, creates delays and dependency",
      "Veteran staff hold all procedural knowledge, no documentation, new hires struggle",
      "Budget officer is sole person who understands accounting codes and allocation rules",
      "Single GIS specialist - if unavailable, all mapping/spatial analysis requests stall",
    ],
    backgroundTheme: 'team',
  },

  // 2️⃣ COMPLIANCE, REPORTING & OVERSIGHT (4)
  {
    id: 5,
    category: 'Compliance, Reporting & Oversight',
    question: 'What compliance, audit, or reporting requirements consume the most time or resources?',
    type: 'textarea',
    placeholder: 'List your compliance burdens...',
    motivationalQuote: "Smart systems make compliance continuous, not crisis-driven.",
    exampleAnswers: [
      "Annual audit prep takes months - manually gathering documentation, explaining variances, proving compliance",
      "Quarterly performance reports to oversight bodies assembled by hand from multiple systems",
      "FOIA requests consume staff time - searching emails, files, redacting, tracking deadlines",
      "Grant compliance reporting - each funder has unique requirements, all manual compilation",
      "Legislative reporting deadlines create recurring chaos - data not readily available in required format",
    ],
    backgroundTheme: 'tools',
  },
  {
    id: 6,
    category: 'Compliance, Reporting & Oversight',
    question: 'Which documents, approvals, or records are hardest to track, retrieve, or verify?',
    type: 'textarea',
    placeholder: 'Describe your documentation challenges...',
    motivationalQuote: "Organized records are the foundation of accountable government.",
    exampleAnswers: [
      "Contract documents scattered across email, shared drives, paper files - often can't find originals",
      "Approval chains undocumented - unclear who approved what and when",
      "Meeting minutes and decisions inconsistently recorded, hard to search historical decisions",
      "Personnel records partially paper, partially digital, not centralized",
      "Asset purchase records incomplete - can't verify equipment history or warranties",
    ],
    backgroundTheme: 'challenge',
  },
  {
    id: 7,
    category: 'Compliance, Reporting & Oversight',
    question: 'Where do errors, delays, or miscommunication expose the organization to risk or scrutiny?',
    type: 'textarea',
    placeholder: 'Identify your risk exposure points...',
    motivationalQuote: "Proactive risk management protects mission and public trust.",
    exampleAnswers: [
      "Missed deadlines for statutory reporting draw negative attention and potential penalties",
      "Payment processing errors due to manual data entry cause vendor complaints and audit findings",
      "Inconsistent handling of public records requests creates legal risk",
      "Budget variances discovered late - lack of real-time monitoring",
      "Contract compliance not tracked systematically - discover violations during audits",
      "Public-facing communication errors due to lack of approval workflow",
    ],
    backgroundTheme: 'revenue',
  },
  {
    id: 8,
    category: 'Compliance, Reporting & Oversight',
    question: 'What information is hardest to surface clearly for leadership, oversight bodies, or the public?',
    type: 'textarea',
    placeholder: 'Describe your transparency gaps...',
    motivationalQuote: "Transparent data builds accountability and trust.",
    exampleAnswers: [
      "Real-time budget status - actual vs planned spending by program",
      "Service delivery metrics - how many requests processed, average time, backlog size",
      "Program outcomes and impact data - we track activities but not results",
      "Resource allocation and workload distribution across teams",
      "Trend analysis - data exists but in silos, can't easily show patterns over time",
      "Public-facing dashboard of key performance indicators doesn't exist",
    ],
    backgroundTheme: 'efficiency',
  },

  // 3️⃣ OPERATIONS, SYSTEMS & WORKFORCE (4)
  {
    id: 9,
    category: 'Operations, Systems & Workforce',
    question: 'Which workflows are the slowest or most bureaucratic — and what causes the delay?',
    type: 'textarea',
    placeholder: 'Map your bottleneck processes...',
    motivationalQuote: "Streamlined processes serve citizens better and cost taxpayers less.",
    exampleAnswers: [
      "Procurement: 5-step approval process, all on paper, takes 6+ weeks for basic purchases",
      "Hiring: Civil service rules + manual HR processes = 6-9 months to fill positions",
      "Budget modifications require council approval for tiny amounts, delays program execution",
      "Interdepartmental requests routed via email and phone calls, no tracking, things get lost",
      "Policy development involves endless meetings and reviews, no structured workflow",
    ],
    backgroundTheme: 'challenge',
  },
  {
    id: 10,
    category: 'Operations, Systems & Workforce',
    question: 'List the systems, platforms, or tools currently in use. Which are outdated, siloed, or unreliable?',
    type: 'textarea',
    placeholder: 'Describe your technology landscape...',
    motivationalQuote: "Modern systems enable modern government.",
    exampleAnswers: [
      "Financial system from the 1990s, clunky interface, limited reporting, doesn't integrate with anything",
      "Multiple databases that don't communicate - citizens enter same info in different departments",
      "Email and Excel for everything - no workflow automation, prone to errors",
      "Aging GIS system that crashes frequently, expensive to maintain",
      "Document management is shared drives + paper filing - no version control or search capability",
      "Separate systems for payroll, HR, asset management - massive duplicate data entry",
    ],
    backgroundTheme: 'tools',
  },
  {
    id: 11,
    category: 'Operations, Systems & Workforce',
    question: 'Where does staff capacity, skill gaps, or burnout limit performance?',
    type: 'textarea',
    placeholder: 'Identify your workforce challenges...',
    motivationalQuote: "Empowered, capable staff deliver better outcomes for citizens.",
    exampleAnswers: [
      "High turnover - can't compete with private sector salaries, constantly training new people",
      "Aging workforce nearing retirement - losing institutional knowledge",
      "Staff lack digital skills for modern tools, training budget minimal",
      "Chronic understaffing - positions frozen, workload increasing, burnout rising",
      "Generalists stretched thin - no specialized expertise for complex issues",
      "Remote work transition exposed technology and management skill gaps",
    ],
    backgroundTheme: 'team',
  },
  {
    id: 12,
    category: 'Operations, Systems & Workforce',
    question: 'Where does handoff between departments or agencies break down?',
    type: 'textarea',
    placeholder: 'Describe your coordination failures...',
    motivationalQuote: "Seamless coordination multiplies collective impact.",
    exampleAnswers: [
      "Building permits require input from planning, fire, utilities, public works - each works in silos, delays and confusion",
      "Case management crosses multiple agencies - no shared system, duplicate interviews, clients frustrated",
      "Budget/finance doesn't communicate effectively with program departments - surprises and conflict",
      "IT serves all departments but doesn't understand their needs - generic solutions don't fit",
      "Emergency response coordination during incidents is chaotic - no common operating picture",
      "State and local agencies have mandated coordination but no actual systems to do so",
    ],
    backgroundTheme: 'challenge',
  },

  // 4️⃣ MODERNIZATION & CONSTRAINTS (2)
  {
    id: 13,
    category: 'Modernization & Constraints',
    question: 'If constraints were removed, what would a more efficient, responsive operation look like in 12–24 months?',
    type: 'textarea',
    placeholder: 'Paint your modernization vision...',
    motivationalQuote: "Vision drives transformation. Constraints inform the path.",
    exampleAnswers: [
      "Full digital service delivery - permits, records, applications all online with real-time status tracking",
      "Unified data platform - all departments share core information, eliminate duplicate entry and errors",
      "Automated workflows - approvals, routing, notifications happen systematically, not via email",
      "Self-service analytics - leadership can access real-time dashboards without requesting custom reports",
      "Proactive service - predictive analytics identify issues before they become problems",
      "Transparent operations - public can see performance metrics, budget spending, service levels in real-time",
    ],
    backgroundTheme: 'revenue',
  },
  {
    id: 14,
    category: 'Modernization & Constraints',
    question: 'What constraints must always be respected? (Procurement rules, data privacy laws, security, public accountability, political oversight.)',
    type: 'textarea',
    placeholder: 'Define your non-negotiable constraints...',
    motivationalQuote: "Working within constraints demonstrates competence and builds credibility.",
    exampleAnswers: [
      "Procurement and contracting rules are non-negotiable - must follow competitive bidding, local vendor preferences",
      "Data security and privacy laws - HIPAA, FERPA, PII protection cannot be compromised",
      "Public records and transparency requirements - must maintain accessibility and accountability",
      "Budget limitations are real - need low-cost or grant-funded solutions",
      "Union agreements and civil service rules constrain HR flexibility",
      "Political oversight and approval processes - elected officials must be kept informed and supportive",
      "Accessibility requirements - solutions must serve all citizens including those with disabilities or limited technology access",
    ],
    backgroundTheme: 'challenge',
  },
];


// Background animation components for each theme
const BackgroundAnimations = ({ theme }: { theme: string }) => {
  const animations: Record<string, JSX.Element> = {
    industry: (
      <span className="contents">
        {[...Array(8)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-24 h-24 rounded-3xl opacity-10"
            style={{
              background: `linear-gradient(135deg, ${['#8B5CF6', '#3B82F6', '#06D7F6', '#FB923C'][i % 4]}, transparent)`,
              left: `${10 + (i % 4) * 25}%`,
              top: `${10 + Math.floor(i / 4) * 40}%`,
            }}
            animate={{
              rotate: [0, 180, 360],
              scale: [1, 1.2, 1],
              opacity: [0.05, 0.15, 0.05],
            }}
            transition={{
              duration: 8 + i * 2,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        ))}
      </span>
    ),
    team: (
      <span className="contents">
        {[...Array(12)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-16 h-16 rounded-full opacity-10"
            style={{
              background: 'linear-gradient(135deg, #3B82F6, #06D7F6)',
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
            }}
            animate={{
              x: [0, Math.random() * 100 - 50, 0],
              y: [0, Math.random() * 100 - 50, 0],
              scale: [1, 1.3, 1],
            }}
            transition={{
              duration: 10 + Math.random() * 5,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        ))}
      </span>
    ),
    revenue: (
      <span className="contents">
        {[...Array(10)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-2 opacity-10"
            style={{
              background: 'linear-gradient(180deg, #8B5CF6, #3B82F6)',
              left: `${10 + i * 9}%`,
              bottom: 0,
              height: `${20 + (i + 1) * 6}%`,
            }}
            animate={{
              height: [`${20 + (i + 1) * 6}%`, `${25 + (i + 1) * 6}%`, `${20 + (i + 1) * 6}%`],
            }}
            transition={{
              duration: 3,
              repeat: Infinity,
              delay: i * 0.2,
              ease: "easeInOut",
            }}
          />
        ))}
      </span>
    ),
    challenge: (
      <span className="contents">
        {[...Array(6)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute opacity-10"
            style={{
              width: `${100 + i * 20}px`,
              height: `${100 + i * 20}px`,
              border: '3px solid #FB923C',
              borderRadius: '50%',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
            }}
            animate={{
              rotate: i % 2 === 0 ? 360 : -360,
              scale: [1, 1.1, 1],
            }}
            transition={{
              duration: 15 + i * 2,
              repeat: Infinity,
              ease: "linear",
            }}
          />
        ))}
      </span>
    ),
    efficiency: (
      <span className="contents">
        {[...Array(20)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-1 h-20 opacity-10"
            style={{
              background: `linear-gradient(180deg, #06D7F6, transparent)`,
              left: `${i * 5}%`,
              top: '50%',
              transformOrigin: 'bottom',
            }}
            animate={{
              scaleY: [0, 1, 0],
              opacity: [0, 0.2, 0],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              delay: i * 0.1,
              ease: "easeInOut",
            }}
          />
        ))}
      </span>
    ),
    tools: (
      <span className="contents">
        {[...Array(15)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-12 h-12 rounded-xl opacity-10"
            style={{
              background: 'linear-gradient(135deg, #8B5CF6, #3B82F6)',
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
            }}
            animate={{
              rotate: [0, 90, 180, 270, 360],
              x: [0, Math.random() * 50 - 25, 0],
              y: [0, Math.random() * 50 - 25, 0],
            }}
            transition={{
              duration: 12 + Math.random() * 5,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        ))}
      </span>
    ),
    process: (
      <span className="contents">
        {[...Array(5)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute flex items-center"
            style={{
              left: `${10 + i * 20}%`,
              top: '50%',
            }}
          >
            <motion.div
              className="w-16 h-16 rounded-full opacity-10"
              style={{ background: 'linear-gradient(135deg, #8B5CF6, #3B82F6)' }}
              animate={{
                scale: [1, 1.3, 1],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                delay: i * 0.3,
              }}
            />
            {i < 4 && (
              <motion.div
                className="w-24 h-1 opacity-10"
                style={{ background: '#8B5CF6' }}
                animate={{
                  scaleX: [0, 1],
                }}
                transition={{
                  duration: 1,
                  repeat: Infinity,
                  delay: i * 0.3 + 0.5,
                  repeatDelay: 1,
                }}
              />
            )}
          </motion.div>
        ))}
      </span>
    ),
    optimize: (
      <span className="contents">
        {[...Array(30)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-2 h-2 rounded-full opacity-10"
            style={{
              background: '#06D7F6',
              left: '50%',
              top: '50%',
            }}
            animate={{
              x: Math.cos(i * 12 * Math.PI / 180) * (100 + (i % 3) * 50),
              y: Math.sin(i * 12 * Math.PI / 180) * (100 + (i % 3) * 50),
              rotate: [0, 360],
            }}
            transition={{
              duration: 10,
              repeat: Infinity,
              ease: "linear",
            }}
          />
        ))}
      </span>
    ),
    goals: (
      <span className="contents">
        {[...Array(20)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-3 h-3 opacity-10"
            style={{
              background: '#FB923C',
              clipPath: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
            }}
            animate={{
              scale: [1, 1.5, 1],
              rotate: [0, 180, 360],
              opacity: [0.05, 0.15, 0.05],
            }}
            transition={{
              duration: 5 + Math.random() * 3,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        ))}
      </span>
    ),
    complete: (
      <span className="contents">
        {[...Array(40)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-2 h-2 rounded-full"
            style={{
              background: ['#8B5CF6', '#3B82F6', '#06D7F6', '#FB923C'][i % 4],
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              opacity: 0.1,
            }}
            animate={{
              y: [0, -50, 0],
              opacity: [0.1, 0.3, 0.1],
              scale: [1, 1.5, 1],
            }}
            transition={{
              duration: 3 + Math.random() * 2,
              repeat: Infinity,
              delay: Math.random() * 2,
              ease: "easeInOut",
            }}
          />
        ))}
      </span>
    ),
  };

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {animations[theme]}
    </div>
  );
};

export default function DiagnosticForm({ onComplete, onBack, initialData }: DiagnosticFormProps) {
  // ── Autosave ────────────────────────────────────────────────────────────────
  const AUTOSAVE_KEY = 'marq_cortex_diagnostic_autosave';
  const savedState = (() => {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as { industry: string | null; step: number; answers: Record<number, string | number> };
    } catch { return null; }
  })();

  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(savedState?.industry ?? null);
  const [currentStep, setCurrentStep] = useState(savedState?.step ?? 0);
  const [answers, setAnswers] = useState<Record<number, string | number>>(savedState?.answers ?? {});
  const [direction, setDirection] = useState(1);
  const [showRestoreBanner, setShowRestoreBanner] = useState(!!savedState && Object.keys(savedState?.answers ?? {}).length > 0);

  const saveProgress = useCallback(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ industry: selectedIndustry, step: currentStep, answers }));
    } catch { /* ignore */ }
  }, [selectedIndustry, currentStep, answers]);
  useEffect(() => { saveProgress(); }, [saveProgress]);

  const clearAutosave = useCallback(() => { try { localStorage.removeItem(AUTOSAVE_KEY); } catch {} }, []);
  const handleDiscardRestore = () => {
    setShowRestoreBanner(false);
    setSelectedIndustry(null);
    setCurrentStep(0);
    setAnswers({});
    clearAutosave();
  };

  // Get questions based on selected industry
  const getQuestionsForIndustry = (industryId: string) => {
    switch (industryId) {
      case 'ecommerce':
        return ecommerceQuestions;
      case 'saas':
        return saasQuestions;
      case 'agency':
        return agencyQuestions;
      case 'healthcare':
        return healthcareQuestions;
      case 'creators':
        return creatorsQuestions;
      case 'nonprofit':
        return nonprofitQuestions;
      case 'government':
        return governmentQuestions;
      case 'manufacturing':
        return industrialQuestions;
      case 'other':
        return universalQuestions;
      default:
        return universalQuestions; // Use universal as default fallback
    }
  };

  const questions = selectedIndustry ? getQuestionsForIndustry(selectedIndustry) : [];

  // If no industry selected, show industry selection screen
  if (!selectedIndustry) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col relative overflow-hidden">
        {/* Animated Background */}
        <div className="absolute inset-0">
          <BackgroundAnimations theme="industry" />
        </div>

        {/* Background gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-black/90 via-black/80 to-black/90 pointer-events-none" />

        {/* Header */}
        <header className="border-b border-[#1a1a1a] bg-black/50 backdrop-blur-xl relative z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 py-4 sm:py-6">
            <button
              onClick={onBack}
              className="flex items-center gap-2 text-[#70707C] hover:text-white transition-colors"
              style={{ fontFamily: 'Inter' }}
            >
              <ChevronLeft size={20} />
              Back to Home
            </button>
          </div>
        </header>

        {/* Industry Selection Content */}
        <main className="flex-1 flex items-center justify-center px-4 sm:px-8 lg:px-12 py-8 sm:py-12 relative z-10">
          <div className="max-w-5xl w-full">
            {/* Title Section */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center mb-16"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", delay: 0.2 }}
                className="inline-flex items-center gap-3 px-6 py-3 bg-gradient-to-r from-[#8B5CF6]/20 to-[#3B82F6]/20 border border-[#8B5CF6]/30 rounded-full mb-8"
              >
                <Sparkles className="text-[#8B5CF6]" size={24} />
                <span className="text-sm font-semibold text-[#8B5CF6] uppercase tracking-wider" style={{ fontFamily: 'Inter' }}>
                  Step 1: Select Your Industry
                </span>
              </motion.div>

              <h1 className="text-3xl sm:text-4xl lg:text-6xl font-bold mb-6 bg-gradient-to-r from-white via-[#F5F5FF] to-[#8B5CF6] bg-clip-text text-transparent" style={{ fontFamily: 'Inter' }}>
                What Industry Are You In?
              </h1>
              <p className="text-xl text-[#70707C] max-w-2xl mx-auto leading-relaxed" style={{ fontFamily: 'Inter' }}>
                We'll customize the diagnostic questions based on your industry to provide the most relevant insights for your business.
              </p>
            </motion.div>

            {/* Industry Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {industries.map((industry, index) => (
                <motion.button
                  key={industry.id}
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + index * 0.1 }}
                  whileHover={{ scale: 1.05, y: -8 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setSelectedIndustry(industry.id)}
                  className="group relative p-5 sm:p-8 bg-[#1a1a1a]/60 backdrop-blur-sm border-2 border-[#242424] rounded-2xl hover:border-[#8B5CF6] transition-all overflow-hidden"
                >
                  {/* Hover Gradient */}
                  <motion.div
                    className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{
                      background: `linear-gradient(135deg, ${industry.color}15, transparent)`,
                    }}
                  />

                  {/* Content */}
                  <div className="relative z-10">
                    <div
                      className="text-6xl mb-4 transform group-hover:scale-110 transition-transform"
                    >
                      {industry.icon}
                    </div>
                    <h3 className="text-2xl font-bold text-[#F5F5FF] mb-2 group-hover:text-white transition-colors" style={{ fontFamily: 'Inter' }}>
                      {industry.name}
                    </h3>
                    <motion.div
                      className="flex items-center gap-2 text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ color: industry.color, fontFamily: 'Inter' }}
                    >
                      Start Diagnostic
                      <ChevronRight size={16} />
                    </motion.div>
                  </div>

                  {/* Accent Corner */}
                  <div
                    className="absolute top-0 right-0 w-24 h-24 opacity-0 group-hover:opacity-20 transition-opacity"
                    style={{
                      background: `radial-gradient(circle at top right, ${industry.color}, transparent)`,
                    }}
                  />
                </motion.button>
              ))}
            </div>

            {/* Helper Text */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1 }}
              className="mt-12 text-center"
            >
              <p className="text-sm text-[#70707C] italic" style={{ fontFamily: 'Inter' }}>
                💡 Don't see your exact industry? Choose the closest match or select "Other Industry"
              </p>
            </motion.div>
          </div>
        </main>
      </div>
    );
  }

  // Rest of the diagnostic form (questions) - existing code
  const currentQuestion = questions[currentStep];
  const progress = ((currentStep + 1) / questions.length) * 100;
  const isLastQuestion = currentStep === questions.length - 1;

  const handleNext = () => {
    if (currentStep < questions.length - 1) {
      setDirection(1);
      setCurrentStep(currentStep + 1);
    } else if (isLastQuestion && answers[currentQuestion.id]) {
      clearAutosave();
      onComplete({
        contactName: initialData?.contactName || '',
        email: initialData?.email || '',
        phone: initialData?.phone || '',
        website: initialData?.website || '',
        industry: selectedIndustry || 'other',
        answers,
      });
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setDirection(-1);
      setCurrentStep(currentStep - 1);
    } else {
      // Go back to industry selection instead of leaving entirely
      setSelectedIndustry(null);
    }
  };

  const handleAnswer = (value: string | number) => {
    setAnswers({ ...answers, [currentQuestion.id]: value });
  };

  const isAnswered = answers[currentQuestion.id] !== undefined && answers[currentQuestion.id] !== '';

  return (
    <div className="min-h-screen bg-black text-white flex flex-col relative overflow-hidden">
      {/* Restore banner */}
      {showRestoreBanner && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-[#8B5CF6]/90 backdrop-blur-sm px-4 py-3 flex items-center justify-center gap-4 text-sm">
          <span className="text-white font-medium">We found your previous progress. Continue where you left off?</span>
          <button onClick={() => setShowRestoreBanner(false)} className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded text-white text-xs font-bold transition-colors">Continue</button>
          <button onClick={handleDiscardRestore} className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded text-white/70 text-xs font-medium transition-colors">Start Fresh</button>
        </div>
      )}

      {/* Animated Background - Changes per question */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentStep}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8 }}
          className="absolute inset-0"
        >
          <BackgroundAnimations theme={currentQuestion.backgroundTheme} />
        </motion.div>
      </AnimatePresence>

      {/* Background gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-black/90 via-black/80 to-black/90 pointer-events-none" />

      {/* Enhanced Header with Progress */}
      <header className="border-b border-[#1a1a1a] bg-black/50 backdrop-blur-xl relative z-10">
        <div className="max-w-[1800px] mx-auto px-4 sm:px-8 lg:px-12 py-4 sm:py-6">
          <div className="flex items-center justify-between mb-4 sm:mb-6">
            <button
              onClick={handleBack}
              className="flex items-center gap-2 text-[#70707C] hover:text-white transition-colors"
              style={{ fontFamily: 'Inter' }}
            >
              <ChevronLeft size={20} />
              Back
            </button>
            <div className="flex items-center gap-4">
              <Sparkles className="text-[#8B5CF6]" size={20} />
              <span className="text-sm font-medium text-[#F5F5FF]" style={{ fontFamily: 'Inter' }}>
                {currentStep + 1} of {questions.length} Questions
              </span>
            </div>
          </div>

          {/* Animated Progress Bar */}
          <div className="relative">
            <div className="h-2 bg-[#1a1a1a] rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{
                  background: 'linear-gradient(90deg, #8B5CF6, #3B82F6, #06D7F6)',
                }}
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              />
            </div>
            <motion.div
              className="absolute -top-1 w-4 h-4 rounded-full bg-white shadow-lg shadow-[#8B5CF6]/50"
              animate={{ left: `calc(${progress}% - 8px)` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </div>

          {/* Encouraging Progress Message */}
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 text-center"
          >
            <p className="text-sm font-medium text-[#8B5CF6]" style={{ fontFamily: 'Inter' }}>
              {progress < 30 && "🚀 Great start! Keep going..."}
              {progress >= 30 && progress < 60 && "💪 You're doing amazing! Halfway there..."}
              {progress >= 60 && progress < 90 && "🔥 Almost there! You've got this..."}
              {progress >= 90 && "🎉 Final step! You're about to unlock powerful insights..."}
            </p>
          </motion.div>
        </div>
      </header>

      {/* Split Screen: Question + Examples */}
      <main className="flex-1 flex flex-col lg:flex-row relative z-10 overflow-y-auto">
        {/* Left Side - Question */}
        <div className="flex-1 flex items-center justify-center px-4 sm:px-8 lg:px-12 py-6 sm:py-8 lg:py-12">
          <div className="max-w-2xl w-full">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={currentStep}
                custom={direction}
                initial={{ opacity: 0, x: direction > 0 ? 100 : -100 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: direction > 0 ? -100 : 100 }}
                transition={{ duration: 0.4 }}
              >
                {/* Motivational Quote */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="mb-8 p-6 bg-gradient-to-r from-[#8B5CF6]/10 to-[#3B82F6]/10 border border-[#8B5CF6]/30 rounded-2xl backdrop-blur-sm"
                >
                  <div className="flex items-start gap-4">
                    <Sparkles className="text-[#8B5CF6] flex-shrink-0 mt-1" size={24} />
                    <p className="text-lg italic text-[#F5F5FF] leading-relaxed" style={{ fontFamily: 'Inter' }}>
                      "{currentQuestion.motivationalQuote}"
                    </p>
                  </div>
                </motion.div>

                {/* Question */}
                <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-6 sm:mb-10 text-[#F5F5FF] leading-tight" style={{ fontFamily: 'Inter' }}>
                  {currentQuestion.question}
                </h2>

                {/* Select Options */}
                {currentQuestion.type === 'select' && (
                  <div className="space-y-3">
                    {currentQuestion.options?.map((option, index) => (
                      <motion.button
                        key={option}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.3 + index * 0.05 }}
                        whileHover={{ scale: 1.02, x: 8 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => handleAnswer(option)}
                        className={`w-full p-6 rounded-2xl text-left font-medium text-lg transition-all ${
                          answers[currentQuestion.id] === option
                            ? 'bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] text-white border-transparent shadow-xl shadow-[#8B5CF6]/30'
                            : 'bg-[#1a1a1a]/80 backdrop-blur-sm text-[#F5F5FF] border border-[#242424] hover:border-[#8B5CF6]'
                        }`}
                        style={{ fontFamily: 'Inter' }}
                      >
                        <div className="flex items-center justify-between">
                          {option}
                          {answers[currentQuestion.id] === option && (
                            <motion.div
                              initial={{ scale: 0, rotate: -180 }}
                              animate={{ scale: 1, rotate: 0 }}
                              transition={{ type: "spring" }}
                            >
                              <CheckCircle2 size={28} />
                            </motion.div>
                          )}
                        </div>
                      </motion.button>
                    ))}
                  </div>
                )}

                {/* Textarea */}
                {currentQuestion.type === 'textarea' && (
                  <motion.textarea
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    value={(answers[currentQuestion.id] as string) || ''}
                    onChange={(e) => handleAnswer(e.target.value)}
                    placeholder={currentQuestion.placeholder}
                    className="w-full p-6 bg-[#1a1a1a]/80 backdrop-blur-sm border-2 border-[#242424] rounded-2xl text-lg text-white placeholder:text-[#70707C] focus:border-[#8B5CF6] focus:outline-none resize-none h-48"
                    style={{ fontFamily: 'Inter' }}
                  />
                )}

                {/* Email Input */}
                {currentQuestion.type === 'email' && (
                  <motion.input
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    type="email"
                    value={(answers[currentQuestion.id] as string) || ''}
                    onChange={(e) => handleAnswer(e.target.value)}
                    placeholder={currentQuestion.placeholder}
                    className="w-full p-6 bg-[#1a1a1a]/80 backdrop-blur-sm border-2 border-[#242424] rounded-2xl text-lg text-white placeholder:text-[#70707C] focus:border-[#8B5CF6] focus:outline-none"
                    style={{ fontFamily: 'Inter' }}
                  />
                )}

                {/* Scale */}
                {currentQuestion.type === 'scale' && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-5 sm:flex sm:justify-between gap-2 sm:gap-3">
                      {Array.from({ length: 10 }, (_, i) => i + 1).map((num, index) => (
                        <motion.button
                          key={num}
                          initial={{ opacity: 0, scale: 0 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: 0.3 + index * 0.05, type: "spring" }}
                          whileHover={{ scale: 1.15, y: -4 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => handleAnswer(num)}
                          className={`w-12 h-12 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl font-bold text-base sm:text-xl transition-all ${
                            answers[currentQuestion.id] === num
                              ? 'bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] text-white scale-110 shadow-2xl shadow-[#8B5CF6]/50'
                              : 'bg-[#1a1a1a]/80 backdrop-blur-sm text-[#70707C] hover:bg-[#242424] hover:text-white border-2 border-[#242424] hover:border-[#8B5CF6]'
                          }`}
                          style={{ fontFamily: 'Inter' }}
                        >
                          {num}
                        </motion.button>
                      ))}
                    </div>
                    <div className="flex justify-between text-sm text-[#70707C]" style={{ fontFamily: 'Inter' }}>
                      <span>😞 Very Poor</span>
                      <span>😊 Excellent</span>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            {/* Navigation Button */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mt-12"
            >
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleNext}
                disabled={!isAnswered}
                className={`w-full py-6 rounded-2xl text-xl font-bold flex items-center justify-center gap-3 transition-all ${
                  isAnswered
                    ? 'bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] text-white hover:shadow-2xl hover:shadow-[#8B5CF6]/50'
                    : 'bg-[#1a1a1a]/60 backdrop-blur-sm text-[#70707C] cursor-not-allowed'
                }`}
                style={{ fontFamily: 'Inter' }}
              >
                {isLastQuestion ? (
                  <span className="contents">
                    <Send size={24} />
                    Complete & Get My Report
                  </span>
                ) : (
                  <span className="contents">
                    Continue
                    <ChevronRight size={24} />
                  </span>
                )}
              </motion.button>
            </motion.div>
          </div>
        </div>

        {/* Right Side - Example Answers (hidden on mobile, visible on lg+) */}
        <div className="hidden lg:flex flex-1 items-center justify-center px-8 lg:px-12 py-8 lg:py-12 border-l border-[#1a1a1a]/50">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              transition={{ duration: 0.4, delay: 0.2 }}
              className="max-w-xl w-full"
            >
              {/* Header */}
              <div className="flex items-center gap-3 mb-8">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#06D7F6]/20 to-[#3B82F6]/20 border border-[#06D7F6]/30 flex items-center justify-center backdrop-blur-sm">
                  <Lightbulb className="text-[#06D7F6]" size={24} />
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-[#F5F5FF]" style={{ fontFamily: 'Inter' }}>
                    Example Answers
                  </h3>
                  <p className="text-sm text-[#70707C]" style={{ fontFamily: 'Inter' }}>
                    Get inspired by these real examples
                  </p>
                </div>
              </div>

              {/* Example Answers List */}
              <div className="space-y-4">
                {currentQuestion.exampleAnswers.map((example, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 + index * 0.1 }}
                    className="p-5 bg-[#1a1a1a]/60 backdrop-blur-sm border border-[#242424]/50 rounded-xl hover:border-[#06D7F6]/50 transition-all group"
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#06D7F6] to-[#3B82F6] flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-xs font-bold text-white" style={{ fontFamily: 'Inter' }}>
                          {index + 1}
                        </span>
                      </div>
                      <p className="text-[#F5F5FF] leading-relaxed group-hover:text-white transition-colors" style={{ fontFamily: 'Inter' }}>
                        {example}
                      </p>
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Helper Text */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
                className="mt-8 p-4 bg-[#8B5CF6]/10 border border-[#8B5CF6]/20 rounded-xl backdrop-blur-sm"
              >
                <p className="text-sm text-[#F5F5FF] italic" style={{ fontFamily: 'Inter' }}>
                  💡 Feel free to use your own words - these are just examples to guide you!
                </p>
              </motion.div>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* AI ASSISTANT */}
      <AIAssistant
        currentQuestion={currentQuestion.question}
        questionNumber={currentStep + 1}
        totalQuestions={questions.length}
        industry={industries.find(i => i.id === selectedIndustry)?.name || 'General'}
        previousAnswers={Object.entries(answers).map(([id, answer]) => ({
          question: questions.find(q => q.id === parseInt(id))?.question || '',
          answer: String(answer)
        }))}
        onSuggestionClick={(suggestion) => {
          // Auto-fill the answer when user clicks a suggestion
          handleAnswer(suggestion);
        }}
      />
    </div>
  );
}