/**
 * The diagnostic question catalogue, on the server side of the boundary.
 *
 * WHAT THIS IS FOR. A stored submission records the industry the client chose
 * and the answers they typed, keyed by question id. It does not record what
 * each question ASKED or which section it was asked under, because the client
 * renders those from its own catalogue. The certified readiness review needs
 * both: the deterministic authority reads `answer.category` to decide which
 * sections a domain's evidence spans, and a reviewer reads `questionText` to
 * know what the answer in front of them is an answer to.
 *
 * ── WHY THE CATALOGUE EXISTS TWICE, AND WHY THAT IS SAFE ───────────────────
 *
 * The canonical catalogue is the one the client renders from —
 * `src/app/components/DiagnosticForm.tsx`, `IndustrialQuestions.tsx` and
 * `UniversalQuestions.tsx`, assembled by `src/app/utils/questionRegistry.ts`.
 * It cannot be imported here: it is authored against the Vite `@/…` aliases and
 * lives in DOM source the edge runtime has no way to load. This is the same
 * constraint `deterministic/readinessAuthority.ts` already carries for the
 * canonical scoring engines, and it is answered the same way — the data exists
 * twice and a test asserts, field by field, that the two are identical.
 * `tests/features/diagnosticSubmissionSource.test.ts` parses the client sources
 * and fails on any difference in industry, order, id, category or question text.
 *
 * A question edited on one side and not the other is therefore a failing test,
 * not a review that quietly describes a client's answer with the wrong question.
 *
 * NOTHING HERE IS AUTHORED. Every category and every question below was copied
 * from the canonical source. There is no category in this file that a client was
 * not asked under, which is the property that lets a readiness result name a
 * qualified section truthfully.
 */

export interface DiagnosticQuestion {
  readonly id: number;
  /** The section heading the question is asked under. Never invented here. */
  readonly category: string;
  readonly question: string;
}

export const DIAGNOSTIC_INDUSTRY_KEYS = [
  'ecommerce',
  'saas',
  'agency',
  'healthcare',
  'creators',
  'nonprofit',
  'government',
  'manufacturing',
  'other',
] as const;

export type DiagnosticIndustryKey = (typeof DIAGNOSTIC_INDUSTRY_KEYS)[number];

/**
 * The display name of each industry, as the client's picker declares it.
 *
 * The dossier carries this rather than the label stored on the submission
 * record: `industryLabel()` in `index.tsx` maps several ids to the wrong name,
 * and the deterministic authority's industry adjustment matches on tokens in
 * that string. A submission whose id says manufacturing must not be scored as
 * whatever its stored label happens to say.
 */
export const DIAGNOSTIC_INDUSTRY_LABELS: Record<DiagnosticIndustryKey, string> = {
  ecommerce: 'E-commerce / DTC',
  saas: 'SaaS / Software',
  agency: 'Agency / Services',
  healthcare: 'Healthcare / Medical',
  creators: 'Creators / Training / Courses',
  nonprofit: 'Non-Profit / Education',
  government: 'Government / Public Sector',
  manufacturing: 'Manufacturing / Supply Chain',
  other: 'Other Business / General',
};

/**
 * Industry aliases, mirroring `questionRegistry.INDUSTRY_ALIASES`.
 *
 * EXACT MATCHES ONLY. The canonical resolver also falls back to a substring
 * scan and then to `other`, which is right for a client report that must render
 * something; it is wrong here. An industry resolved by guess would attach one
 * industry's questions and sections to another industry's answers — a wrong
 * dossier rather than a missing one — so anything that does not match exactly
 * resolves to `undefined` and the submission is refused.
 */
const INDUSTRY_ALIASES: Readonly<Record<string, DiagnosticIndustryKey>> = {
  'e-commerce / dtc': 'ecommerce',
  'saas / software': 'saas',
  'agency / services': 'agency',
  'healthcare / medical': 'healthcare',
  'creators / training / courses': 'creators',
  'non-profit / education': 'nonprofit',
  'government / public sector': 'government',
  'manufacturing / supply chain': 'manufacturing',
  'other business / general': 'other',
  'ecommerce': 'ecommerce',
  'saas': 'saas',
  'agency': 'agency',
  'healthcare': 'healthcare',
  'creators': 'creators',
  'nonprofit': 'nonprofit',
  'government': 'government',
  'manufacturing': 'manufacturing',
  'other': 'other',
  'e-commerce': 'ecommerce',
};

/**
 * The industry a submission was asked under, or `undefined`.
 *
 * Candidates are tried in order, which is how the stored `industryId` — the
 * value the client picker wrote — wins over the display label derived from it.
 */
export function resolveDiagnosticIndustry(
  ...candidates: readonly (string | undefined)[]
): DiagnosticIndustryKey | undefined {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const key = INDUSTRY_ALIASES[candidate.trim().toLowerCase()];
    if (key !== undefined) return key;
  }
  return undefined;
}

/** The questions that industry's diagnostic asks, in the order it asks them. */
export function diagnosticQuestionsFor(
  industry: DiagnosticIndustryKey,
): readonly DiagnosticQuestion[] {
  return DIAGNOSTIC_QUESTION_CATALOGUE[industry];
}

export const DIAGNOSTIC_QUESTION_CATALOGUE: Record<
  DiagnosticIndustryKey,
  readonly DiagnosticQuestion[]
> = {
  ecommerce: [
    { id: 1, category: 'Business Reality & Daily Operations', question: 'Walk us through a normal workday when things feel frustrating or chaotic. Where does your time actually go, and what fires come up repeatedly?' },
    { id: 2, category: 'Business Reality & Daily Operations', question: 'Which tasks consume the most time in your e-commerce operation but feel repetitive or low-value? (Be specific about who does them and how often.)' },
    { id: 3, category: 'Business Reality & Daily Operations', question: 'What decisions, approvals, or checks still depend on you (or one key person) and slow everything down?' },
    { id: 4, category: 'Business Reality & Daily Operations', question: 'Where does information get lost, duplicated, or delayed across orders, customers, inventory, marketing, or support?' },
    { id: 5, category: 'Business Reality & Daily Operations', question: 'If nothing changes in the next 6 months, what worries you most about your business?' },
    { id: 6, category: 'Bottlenecks, Scale & Leakage', question: 'Describe what actually happens from the moment someone visits your store to when they become a repeat customer.' },
    { id: 7, category: 'Bottlenecks, Scale & Leakage', question: 'As order volume increases, where does the business start to break first?' },
    { id: 8, category: 'Bottlenecks, Scale & Leakage', question: 'What work are humans doing today that clearly should not require human thinking?' },
    { id: 9, category: 'Bottlenecks, Scale & Leakage', question: 'Where do you believe money is being lost right now? (Missed follow-ups, abandoned carts, slow responses, refunds, poor visibility, etc.)' },
    { id: 10, category: 'Systems, Tools & Readiness', question: 'What tools do you currently rely on, and where do they fail to support how your business actually runs?' },
    { id: 11, category: 'Systems, Tools & Readiness', question: 'What information do you wish you had at your fingertips but don\'t today?' },
    { id: 12, category: 'Systems, Tools & Readiness', question: 'How documented are your workflows today? (Almost nothing / partially documented / mostly documented / fully documented — explain.)' },
    { id: 13, category: 'Intent, Outcomes & Constraints', question: 'If we worked together for the next 90 days, what would success look like in practical terms?' },
    { id: 14, category: 'Intent, Outcomes & Constraints', question: 'If a clear plan showed real time savings, cost reduction, or revenue improvement — what would realistically stop you from moving forward?' },
  ],
  saas: [
    { id: 1, category: 'Business Reality & Daily Operations', question: 'In your own words, explain what your product does, who it\'s for, and how revenue is generated today.' },
    { id: 2, category: 'Business Reality & Daily Operations', question: 'Describe a typical workday for you or your leadership team. Where does most time get spent that does not feel strategic?' },
    { id: 3, category: 'Business Reality & Daily Operations', question: 'Which decisions, approvals, or activities cannot move forward without you or a senior leader?' },
    { id: 4, category: 'Business Reality & Daily Operations', question: 'Where do handoffs fail between sales, onboarding, support, product, or finance?' },
    { id: 5, category: 'Business Reality & Daily Operations', question: 'What part of the business worries you most as customer count or usage increases?' },
    { id: 6, category: 'Bottlenecks, Scale & Leakage', question: 'Describe what happens from the moment a lead shows interest to when they become an active, retained customer.' },
    { id: 7, category: 'Bottlenecks, Scale & Leakage', question: 'Where do prospects disengage, or customers churn — and why do you believe that happens?' },
    { id: 8, category: 'Bottlenecks, Scale & Leakage', question: 'Which recurring tasks grow linearly with users or customers instead of staying flat?' },
    { id: 9, category: 'Bottlenecks, Scale & Leakage', question: 'Where do you believe money, time, or opportunities are being wasted today?' },
    { id: 10, category: 'Systems, Tools & Data Readiness', question: 'List the main tools used across sales, onboarding, support, analytics, and internal operations. Where do they not align with how your team works?' },
    { id: 11, category: 'Systems, Tools & Data Readiness', question: 'What information would help you make better decisions but is currently hard or slow to access?' },
    { id: 12, category: 'Systems, Tools & Data Readiness', question: 'How reliable and structured is your data today? (Usage data, customer data, support data, revenue data — explain.)' },
    { id: 13, category: 'Intent, Outcomes & Constraints', question: 'If this engagement succeeds, what must be meaningfully better in the next 90 days?' },
    { id: 14, category: 'Intent, Outcomes & Constraints', question: 'What concerns, risks, or internal blockers would make you hesitant to adopt automation or AI systems?' },
  ],
  agency: [
    { id: 1, category: 'Business Reality & Daily Operations', question: 'Describe exactly what services you sell today and how work is delivered from signed client to completion.' },
    { id: 2, category: 'Business Reality & Daily Operations', question: 'Walk us through a typical workday when things feel busy or overwhelming. What keeps interrupting real progress?' },
    { id: 3, category: 'Business Reality & Daily Operations', question: 'What parts of client delivery, approvals, or decisions still rely heavily on you or one senior person?' },
    { id: 4, category: 'Business Reality & Daily Operations', question: 'Where do misalignment, delays, or confusion happen with clients most often?' },
    { id: 5, category: 'Business Reality & Daily Operations', question: 'What worries you most about taking on more clients with your current setup?' },
    { id: 6, category: 'Bottlenecks, Scale & Leakage', question: 'Describe what happens from first inquiry to signed contract. Where do deals slow down or fall through?' },
    { id: 7, category: 'Bottlenecks, Scale & Leakage', question: 'Which parts of service delivery take the most time but don\'t increase client value?' },
    { id: 8, category: 'Bottlenecks, Scale & Leakage', question: 'What tasks increase directly with each new client instead of staying efficient?' },
    { id: 9, category: 'Bottlenecks, Scale & Leakage', question: 'Where do you believe profit is being lost today? (Unbilled time, scope creep, slow follow-ups, poor utilization, etc.)' },
    { id: 10, category: 'Systems, Tools & Process Readiness', question: 'List the tools you use across sales, delivery, communication, reporting, and billing. What feels disconnected or redundant?' },
    { id: 11, category: 'Systems, Tools & Process Readiness', question: 'What information do you wish you had daily or weekly but don\'t today?' },
    { id: 12, category: 'Systems, Tools & Process Readiness', question: 'How clearly documented are your sales, delivery, and client management processes?' },
    { id: 13, category: 'Intent, Outcomes & Constraints', question: 'If this engagement succeeds, what must improve in how your agency runs within 90 days?' },
    { id: 14, category: 'Intent, Outcomes & Constraints', question: 'What internal concerns, risks, or limitations could slow down change or automation?' },
  ],
  healthcare: [
    { id: 1, category: 'Care Delivery & Daily Operations', question: 'Describe the full patient journey from first contact to post-visit follow-up. Where does it feel slow, manual, or inconsistent?' },
    { id: 2, category: 'Care Delivery & Daily Operations', question: 'What happens on a "busy but normal" day at your practice? Where do delays, mistakes, or stress usually appear?' },
    { id: 3, category: 'Care Delivery & Daily Operations', question: 'Which tasks consume provider or staff time but shouldn\'t require clinical attention?' },
    { id: 4, category: 'Care Delivery & Daily Operations', question: 'Where does scheduling break down? (No-shows, rescheduling, overbooking, underutilized capacity, etc.)' },
    { id: 5, category: 'Care Delivery & Daily Operations', question: 'What decisions or escalations still require you or a senior clinician to step in?' },
    { id: 6, category: 'Bottlenecks, Risk & Leakage', question: 'Which admin tasks feel repetitive, time-consuming, or error-prone today?' },
    { id: 7, category: 'Bottlenecks, Risk & Leakage', question: 'Where do patients get confused, delayed, or frustrated in communication?' },
    { id: 8, category: 'Bottlenecks, Risk & Leakage', question: 'Where do you believe revenue or efficiency is being lost? (No-shows, slow billing, missed follow-ups, underfilled schedules.)' },
    { id: 9, category: 'Bottlenecks, Risk & Leakage', question: 'What compliance, documentation, or audit concerns keep you cautious or slow to change?' },
    { id: 10, category: 'Systems, Data & Readiness', question: 'List the systems you use (EHR, scheduling, billing, communication, reporting). What feels fragmented or outdated?' },
    { id: 11, category: 'Systems, Data & Readiness', question: 'What data do you wish you had real-time visibility into but currently don\'t?' },
    { id: 12, category: 'Systems, Data & Readiness', question: 'How standardized are processes across staff, providers, or locations?' },
    { id: 13, category: 'Intent, Outcomes & Constraints', question: 'If this engagement works, what must measurably improve in 90 days?' },
    { id: 14, category: 'Intent, Outcomes & Constraints', question: 'What internal limits (compliance, staff resistance, budget, risk tolerance) must be respected?' },
  ],
  creators: [
    { id: 1, category: 'Offer, Content & Delivery Reality', question: 'Describe what you sell today (courses, cohorts, memberships, 1:1, bundles). Which parts feel scalable, and which feel tied directly to you?' },
    { id: 2, category: 'Offer, Content & Delivery Reality', question: 'What does it take to create, update, and deliver content consistently? Where does it feel slow, exhausting, or repetitive?' },
    { id: 3, category: 'Offer, Content & Delivery Reality', question: 'Where do learners get confused, disengaged, or drop off during your programs?' },
    { id: 4, category: 'Offer, Content & Delivery Reality', question: 'Which parts of delivery, support, or motivation still require you personally?' },
    { id: 5, category: 'Growth, Funnels & Revenue Leakage', question: 'How do people currently discover you and enter your world? Where does momentum break or stall?' },
    { id: 6, category: 'Growth, Funnels & Revenue Leakage', question: 'Where do interested people hesitate, delay, or disappear before buying?' },
    { id: 7, category: 'Growth, Funnels & Revenue Leakage', question: 'How are leads and students followed up with today? What\'s manual, inconsistent, or missing?' },
    { id: 8, category: 'Growth, Funnels & Revenue Leakage', question: 'What\'s currently limiting revenue growth: traffic, conversion, delivery capacity, or time?' },
    { id: 9, category: 'Systems, Operations & Scale', question: 'List the tools you use (platforms, email, payments, community, analytics). What feels disconnected or hard to manage?' },
    { id: 10, category: 'Systems, Operations & Scale', question: 'Which non-creative tasks consume time but don\'t directly grow revenue?' },
    { id: 11, category: 'Systems, Operations & Scale', question: 'How are questions, feedback, and support handled today? What breaks as volume increases?' },
    { id: 12, category: 'Systems, Operations & Scale', question: 'What numbers do you wish you could see clearly but can\'t today?' },
    { id: 13, category: 'Direction, Intent & Constraints', question: 'If everything worked, what would this business look like in 6–12 months without more personal workload?' },
    { id: 14, category: 'Direction, Intent & Constraints', question: 'What must be protected at all costs? (Brand voice, quality, authenticity, student experience, budget, control.)' },
  ],
  nonprofit: [
    { id: 1, category: 'Mission, Impact & Reality', question: 'Describe your mission in one paragraph. Now describe what actually consumes most of your time and energy day-to-day.' },
    { id: 2, category: 'Mission, Impact & Reality', question: 'How do you currently measure impact or success? Where does it feel unclear, manual, or hard to communicate?' },
    { id: 3, category: 'Mission, Impact & Reality', question: 'Which programs or initiatives are hardest to run smoothly — and why?' },
    { id: 4, category: 'Mission, Impact & Reality', question: 'Where do decisions, approvals, or progress slow down because too much depends on a few people?' },
    { id: 5, category: 'Funding, Donors & Sustainability', question: 'Describe all current funding sources (grants, donors, sponsors, fees, memberships). Which feel stable, and which feel stressful or unpredictable?' },
    { id: 6, category: 'Funding, Donors & Sustainability', question: 'Where do relationships weaken over time due to lack of follow-up, reporting, or communication?' },
    { id: 7, category: 'Funding, Donors & Sustainability', question: 'What reporting, compliance, or documentation work drains the most time?' },
    { id: 8, category: 'Funding, Donors & Sustainability', question: 'What stops you from expanding impact right now: funding, staff capacity, systems, or coordination?' },
    { id: 9, category: 'Operations, Systems & People', question: 'Which internal processes feel slow, manual, or duplicated across teams?' },
    { id: 10, category: 'Operations, Systems & People', question: 'List the tools, platforms, or spreadsheets you rely on today. What feels fragmented or hard to trust?' },
    { id: 11, category: 'Operations, Systems & People', question: 'What breaks when onboarding, coordinating, or supporting staff and volunteers?' },
    { id: 12, category: 'Operations, Systems & People', question: 'What information do leaders wish they had in one place but don\'t today?' },
    { id: 13, category: 'Future Direction & Constraints', question: 'If systems were not the bottleneck, what impact would you want to achieve in the next year?' },
    { id: 14, category: 'Future Direction & Constraints', question: 'What constraints must be respected? (Budget limits, donor expectations, compliance, transparency, community trust.)' },
  ],
  government: [
    { id: 1, category: 'Mandate, Outcomes & Reality', question: 'What is your department\'s official mandate or responsibility? Where does execution fall short in reality?' },
    { id: 2, category: 'Mandate, Outcomes & Reality', question: 'Which public-facing services are slow, inefficient, or complaint-heavy — and why?' },
    { id: 3, category: 'Mandate, Outcomes & Reality', question: 'Where do good policies fail during execution due to systems, approvals, or coordination?' },
    { id: 4, category: 'Mandate, Outcomes & Reality', question: 'Which processes depend too heavily on specific individuals to function correctly?' },
    { id: 5, category: 'Compliance, Reporting & Oversight', question: 'What compliance, audit, or reporting requirements consume the most time or resources?' },
    { id: 6, category: 'Compliance, Reporting & Oversight', question: 'Which documents, approvals, or records are hardest to track, retrieve, or verify?' },
    { id: 7, category: 'Compliance, Reporting & Oversight', question: 'Where do errors, delays, or miscommunication expose the organization to risk or scrutiny?' },
    { id: 8, category: 'Compliance, Reporting & Oversight', question: 'What information is hardest to surface clearly for leadership, oversight bodies, or the public?' },
    { id: 9, category: 'Operations, Systems & Workforce', question: 'Which workflows are the slowest or most bureaucratic — and what causes the delay?' },
    { id: 10, category: 'Operations, Systems & Workforce', question: 'List the systems, platforms, or tools currently in use. Which are outdated, siloed, or unreliable?' },
    { id: 11, category: 'Operations, Systems & Workforce', question: 'Where does staff capacity, skill gaps, or burnout limit performance?' },
    { id: 12, category: 'Operations, Systems & Workforce', question: 'Where does handoff between departments or agencies break down?' },
    { id: 13, category: 'Modernization & Constraints', question: 'If constraints were removed, what would a more efficient, responsive operation look like in 12–24 months?' },
    { id: 14, category: 'Modernization & Constraints', question: 'What constraints must always be respected? (Procurement rules, data privacy laws, security, public accountability, political oversight.)' },
  ],
  manufacturing: [
    { id: 1, category: 'Business & Production Reality', question: 'Describe what you manufacture or distribute, how production flows today, and where value is actually created.' },
    { id: 2, category: 'Business & Production Reality', question: 'What happens when orders increase by 20–30%? What part of production, fulfillment, or coordination breaks first?' },
    { id: 3, category: 'Business & Production Reality', question: 'Which production, purchasing, or operational decisions still depend on you or senior managers?' },
    { id: 4, category: 'Operations, Processes & Bottlenecks', question: 'Where do delays, idle time, rework, or handoff issues occur most often?' },
    { id: 5, category: 'Operations, Processes & Bottlenecks', question: 'Which tasks still rely on phone calls, WhatsApp, emails, or spreadsheets to "keep things moving"?' },
    { id: 6, category: 'Operations, Processes & Bottlenecks', question: 'Where do errors happen — and how late are they usually discovered?' },
    { id: 7, category: 'Operations, Processes & Bottlenecks', question: 'If these inefficiencies continue for 12 months, what is the real cost? (Waste, overtime, missed orders, staff burnout, lost clients.)' },
    { id: 8, category: 'Systems, Data & Visibility', question: 'List the systems used for: Production planning, Inventory, Purchasing, Logistics, Reporting.' },
    { id: 9, category: 'Systems, Data & Visibility', question: 'Which systems don\'t talk to each other and force double entry or manual reconciliation?' },
    { id: 10, category: 'Systems, Data & Visibility', question: 'What do you not have real-time visibility into today? (Inventory, production status, delays, costs, demand.)' },
    { id: 11, category: 'Systems, Data & Visibility', question: 'How long does it take to get a clear operational or financial picture?' },
    { id: 12, category: 'AI Readiness & Future State', question: 'Have you attempted automation or digital transformation before? What failed or stalled?' },
    { id: 13, category: 'AI Readiness & Future State', question: 'What must never be automated without strict control? (Compliance, safety, audits, customer commitments.)' },
    { id: 14, category: 'AI Readiness & Future State', question: 'If this worked perfectly, what would run smoother, faster, or cheaper without more headcount?' },
  ],
  other: [
    { id: 1, category: 'Business Reality & Model', question: 'Describe what your business does, who you serve, and how money comes in today.' },
    { id: 2, category: 'Business Reality & Model', question: 'How do you deliver value to customers (service, product, digital, physical, hybrid)?' },
    { id: 3, category: 'Business Reality & Model', question: 'If demand increased by 30% tomorrow, what part of the business would break first?' },
    { id: 4, category: 'Operations & Execution Pain', question: 'What tasks or processes slow your team down every day?' },
    { id: 5, category: 'Operations & Execution Pain', question: 'Which decisions or approvals still require you personally?' },
    { id: 6, category: 'Operations & Execution Pain', question: 'List the most repetitive tasks your team does weekly.' },
    { id: 7, category: 'Operations & Execution Pain', question: 'What do these inefficiencies cost you in time, money, or missed opportunities?' },
    { id: 8, category: 'Systems, Data & Visibility', question: 'What tools do you currently use across sales, operations, finance, and support?' },
    { id: 9, category: 'Systems, Data & Visibility', question: 'Where do tools fail to connect, causing double work or confusion?' },
    { id: 10, category: 'Systems, Data & Visibility', question: 'What information do you wish you could see in real time but can\'t?' },
    { id: 11, category: 'Systems, Data & Visibility', question: 'How long does it take to understand business performance today?' },
    { id: 12, category: 'AI Readiness & Future State', question: 'Have you tried automation, AI, or digital systems before? What didn\'t work?' },
    { id: 13, category: 'AI Readiness & Future State', question: 'What parts of the business must stay tightly controlled or human-approved?' },
    { id: 14, category: 'AI Readiness & Future State', question: 'If AI worked perfectly, what would improve without hiring more people?' },
  ],
};
