/**
 * CLIENT SOLUTION VIEW — Plain-English Solutions for Non-Technical Clients
 *
 * Shows what problems were found and what the recommended solutions are,
 * written in clear, jargon-free language that any business owner can understand.
 *
 * Step 3: generateSolutionsFromSubmission() derives solutions dynamically
 * from real submission data (industry + answers) instead of always returning
 * the same hardcoded fallback.  The ClientPortal passes this in as the
 * `solutions` prop — the component itself remains presentational.
 */

import { motion } from 'motion/react';
import {
  Lightbulb, CheckCircle2, ArrowRight, Zap, TrendingUp,
  AlertCircle, Wrench, Clock, DollarSign, Users,
  ShieldCheck, Brain, Sparkles, Target,
} from 'lucide-react';
import { BRAND } from '@/app/utils/designTokens';
import type { Submission } from '@/app/services/dataService';

interface SolutionItem {
  problem: string;
  problemPlain: string;
  solution: string;
  solutionPlain: string;
  whyThisSolution: string;
  expectedOutcome: string;
  icon: 'speed' | 'money' | 'people' | 'insight' | 'automation' | 'quality';
}

interface ClientSolutionViewProps {
  companyName: string;
  industry: string;
  solutions?: SolutionItem[];
  onScheduleCall?: () => void;
  onViewReport?: () => void;
}

const ICON_MAP = {
  speed: Clock,
  money: DollarSign,
  people: Users,
  insight: TrendingUp,
  automation: Zap,
  quality: ShieldCheck,
};

const ICON_COLORS = {
  speed: BRAND.cyan,
  money: BRAND.green,
  people: BRAND.blue,
  insight: BRAND.purple,
  automation: BRAND.orange,
  quality: BRAND.green,
};

// ── Dynamic solution generator ────────────────────────────────────────────────
// Called by ClientPortal and passed in as the `solutions` prop so this
// component stays purely presentational.

export function generateSolutionsFromSubmission(
  submission: Submission,
): SolutionItem[] {
  const industry = submission.industry ?? '';
  const company = submission.company ?? 'your business';
  const answers = Object.values(submission.answers ?? {})
    .map(v => String(v).toLowerCase())
    .join(' ');
  const readiness = submission.completionScore ?? 50;

  // ── Industry-aware solution pool ─────────────────────────────────────────

  // Solution 1 — always derived from the industry's primary pain-point
  const industrySolution = getIndustrySolution(industry, company);

  // Solution 2 — manual-process signal (very common across all industries)
  const manualProcessSolution: SolutionItem = {
    problem: 'Key workflows depend on manual work that slows your team down',
    problemPlain: `At ${company}, important tasks — like updating records, sending follow-ups, or pulling reports — require someone to do them by hand every time. This creates a hidden tax on your team's time and introduces mistakes that compound as you grow.`,
    solution: 'Workflow Automation',
    solutionPlain: `We map the most time-consuming repetitive tasks and automate them using tools your team already has or that integrate cleanly into your existing stack — no rip-and-replace required. Automations run silently in the background so your team focuses on the work that actually requires a human.`,
    whyThisSolution: `Because every hour spent on manual repetitive work is an hour not spent on growth. Based on what you told us, this is where ${company} is losing the most recoverable capacity right now. Automating it delivers results within weeks, not months.`,
    expectedOutcome: `Recover 5–15 hours per week across the team and reduce process errors by 60–80%`,
    icon: 'automation',
  };

  // Solution 3 — data/visibility gap (nearly universal)
  const visibilitySolution: SolutionItem = {
    problem: 'You can\'t see what\'s happening in your business in real time',
    problemPlain: `Right now, getting a clear picture of how ${company} is performing means pulling data from multiple places — a process that's slow, incomplete, and always slightly out of date. Decisions are being made on yesterday's information, not today's reality.`,
    solution: 'Live Performance Dashboard',
    solutionPlain: `We connect your key data sources into a single dashboard that updates automatically. You'll see revenue, operations, and team performance in one place — in real time, without anyone having to compile it manually. On any device.`,
    whyThisSolution: `Because you can't manage what you can't measure. And right now, measuring anything requires effort. This gives you the visibility to catch problems early and act on opportunities before your competition does.`,
    expectedOutcome: `Save 4–8 hours per week on manual reporting and make faster, better-informed decisions`,
    icon: 'insight',
  };

  // Solution 4 — revenue/growth-specific (triggered by low quality score or specific answer signals)
  const revenueSolution: SolutionItem | null =
    readiness < 65 || answers.includes('revenue') || answers.includes('growth') || answers.includes('sales')
      ? {
          problem: 'Revenue opportunities are slipping through operational gaps',
          problemPlain: `${company} is likely missing revenue it has already earned — through slow follow-ups, missed upsell moments, or leads that fall through the cracks when the team is busy. These aren't sales problems; they're systems problems.`,
          solution: 'Revenue Operations Automation',
          solutionPlain: `We close the gaps in your revenue pipeline using automation: instant follow-ups, systematic upsell triggers, and lead nurturing that happens automatically — without relying on someone remembering to do it.`,
          whyThisSolution: `Because the fastest revenue growth comes from converting what you already have, not acquiring more. The diagnostic signals suggest ${company} is leaving 10–20% of achievable revenue uncaptured due to gaps in follow-through.`,
          expectedOutcome: `Recover 10–20% of missed revenue opportunities through systematic follow-through`,
          icon: 'money',
        }
      : null;

  // Solution 5 — people/scaling (triggered by team-size or scale signals)
  const scalingSolution: SolutionItem | null =
    answers.includes('team') || answers.includes('hire') || answers.includes('staff') || answers.includes('headcount')
      ? {
          problem: 'Scaling the team is the only way to grow capacity right now',
          problemPlain: `At ${company}, when work volume increases, the current answer is to add more people. But each new hire brings onboarding time, management overhead, and fixed cost — and the underlying process problems remain. You're scaling cost rather than efficiency.`,
          solution: 'Systems-Led Capacity Scaling',
          solutionPlain: `We design your operations so that capacity grows through systems, not headcount. The next 50% of work volume increase gets absorbed by automation and better-designed processes — not a 50% bigger team.`,
          whyThisSolution: `Because hiring is expensive, slow, and doesn't fix the root cause. The businesses that grow most profitably are the ones that scale systems first and hire to a higher leverage point.`,
          expectedOutcome: `Support 30–50% more work volume without proportional headcount increases`,
          icon: 'people',
        }
      : null;

  const pool: SolutionItem[] = [
    industrySolution,
    manualProcessSolution,
    visibilitySolution,
    ...(revenueSolution ? [revenueSolution] : []),
    ...(scalingSolution ? [scalingSolution] : []),
  ].filter(Boolean) as SolutionItem[];

  // Return the top 4 most relevant (industry solution first, then sorted by signal strength)
  return pool.slice(0, 4);
}

// ── Industry-specific lead solution ─────────────────────────────────────────

function getIndustrySolution(industry: string, company: string): SolutionItem {
  if (industry.includes('E-commerce') || industry.includes('DTC') || industry.includes('Retail')) {
    return {
      problem: 'Orders, inventory, and customer data live in disconnected systems',
      problemPlain: `When a customer buys from ${company}, information flows through multiple disconnected tools — your online store, your fulfilment system, your customer service inbox, and a spreadsheet somewhere. Nothing talks to anything else automatically. The result: manual reconciliation, overselling, and customer experience gaps.`,
      solution: 'Unified Commerce Operations Hub',
      solutionPlain: `We connect your store, inventory, fulfilment, and customer service into one automated flow. When an order comes in, everything updates in real time — no manual data entry, no overselling, no conflicting records. Customer queries get resolved faster because the data is all in one place.`,
      whyThisSolution: `Because disconnected systems are the #1 operational problem for e-commerce brands at your stage. Every manual step between your systems is a point of failure that compounds as order volume grows. Fixing this is the single highest-leverage improvement ${company} can make.`,
      expectedOutcome: 'Eliminate overselling, reduce fulfilment errors by 80%, and save 6+ hours/day of manual work',
      icon: 'quality',
    };
  }
  if (industry.includes('SaaS') || industry.includes('Software')) {
    return {
      problem: 'Customer onboarding and retention rely on manual effort that doesn\'t scale',
      problemPlain: `At ${company}, getting a new customer to their first success moment and keeping them engaged over time requires manual work from your team — personalised emails, check-in calls, monitoring who's using the product and who isn't. This creates incredible value at small scale but becomes impossible as you grow.`,
      solution: 'Automated Customer Lifecycle System',
      solutionPlain: `We build automated lifecycle touchpoints triggered by customer behaviour — when they activate, when they go quiet, when they hit a usage milestone. Your team gets notified when a human touch is actually needed; everything else runs automatically.`,
      whyThisSolution: `Because churn is the silent revenue killer for every SaaS business, and most of it is preventable with the right signals and the right automated responses. This gives ${company} a scalable retention system that works whether you have 50 customers or 500.`,
      expectedOutcome: 'Reduce churn by 15–30% and improve activation rates through systematic lifecycle automation',
      icon: 'automation',
    };
  }
  if (industry.includes('Agency') || industry.includes('Consulting') || industry.includes('Services')) {
    return {
      problem: 'Client delivery quality varies depending on who\'s doing the work',
      problemPlain: `Right now at ${company}, client results are good when the right people are available and paying attention. But outcomes vary. Deadlines slip. Context gets lost when team members are on holiday or leave. Your delivery quality is a function of individual effort, not repeatable systems.`,
      solution: 'Standardised Delivery Framework',
      solutionPlain: `We document and systematise your core delivery processes so they produce consistent results regardless of who's executing them. Client handoffs, status updates, quality checkpoints, and deliverable templates all become systematised — reducing variation and freeing your senior team for higher-value work.`,
      whyThisSolution: `Because inconsistency is what limits agency growth. When you can't guarantee consistent delivery, you can't confidently take on more clients or larger accounts. Standardisation is what transforms ${company} from a boutique dependent on key people into a scalable operation.`,
      expectedOutcome: 'Improve delivery consistency, reduce rework by 40%, and free senior team time for strategic work',
      icon: 'quality',
    };
  }
  if (industry.includes('Healthcare') || industry.includes('Medical')) {
    return {
      problem: 'Administrative work is consuming capacity that should go to patient care',
      problemPlain: `At ${company}, a significant portion of the day is spent on tasks that aren't clinical — scheduling, reminders, documentation, billing coordination, follow-up calls. These are important but they don't require clinical expertise. They're taking time and energy away from the work your team is trained for.`,
      solution: 'Administrative Automation System',
      solutionPlain: `We implement automated patient communications, intake workflows, and scheduling systems that handle the administrative load without clinical staff involvement. Appointment reminders go out automatically. Intake forms arrive before the visit. Routine follow-ups are systematised.`,
      whyThisSolution: `Because reducing administrative burden is the fastest way to increase clinical capacity without hiring. Every hour reclaimed from admin is an hour available for patient care — or simply for not burning out the people who provide it.`,
      expectedOutcome: 'Reclaim 2–4 clinical hours per day and reduce no-shows by 25–40% through systematic automation',
      icon: 'people',
    };
  }
  if (industry.includes('Real Estate') || industry.includes('Property')) {
    return {
      problem: 'Lead follow-up is inconsistent and opportunities go cold',
      problemPlain: `In real estate, timing is everything — and right now at ${company}, whether a lead gets followed up promptly depends on how busy the team is at that moment. Hot leads go cold. Nurture sequences don't happen. The CRM has incomplete data because entry is manual.`,
      solution: 'Automated Lead Nurture & Follow-Up',
      solutionPlain: `We build an automated follow-up and nurture system that responds to every lead within minutes — not hours — and keeps prospects engaged over months with personalised sequences. Your agents focus on clients who are ready to transact; the system handles everyone else.`,
      whyThisSolution: `Because the difference between winning and losing a deal in real estate is often just who followed up first and most persistently. Automation ensures ${company} is always first, always consistent — without adding headcount.`,
      expectedOutcome: 'Improve lead conversion by 20–35% through faster, more consistent follow-up automation',
      icon: 'money',
    };
  }
  if (industry.includes('Finance') || industry.includes('Accounting') || industry.includes('FinTech')) {
    return {
      problem: 'Manual data processing creates errors and audit risk',
      problemPlain: `At ${company}, financial data moves between systems manually — exports, imports, reconciliations, report compilation. Every manual step is a potential error. These errors accumulate, require correction, and create audit trail gaps. The team spends hours each week on work that should be instant and automatic.`,
      solution: 'Financial Data Automation Pipeline',
      solutionPlain: `We build automated data flows between your financial systems — eliminating manual exports, reducing reconciliation time, and creating audit-ready data trails. Reports generate automatically on schedule. Exceptions surface automatically for human review.`,
      whyThisSolution: `Because in finance, errors aren't just inefficiencies — they're liabilities. Automating data flows eliminates the human error factor from routine processing, reduces audit risk, and frees your team from grunt work to focus on analysis and advisory.`,
      expectedOutcome: 'Eliminate manual reconciliation errors and reclaim 8–15 hours per week of accounting staff time',
      icon: 'money',
    };
  }
  if (industry.includes('Manufacturing') || industry.includes('Industrial')) {
    return {
      problem: 'Production visibility is too slow to prevent costly bottlenecks',
      problemPlain: `At ${company}, by the time a production problem becomes visible, it has already caused delays, waste, or customer impact. Status updates come from manual reports, walk-throughs, or people remembering to communicate. There's no real-time signal that something is off.`,
      solution: 'Production Monitoring & Alert System',
      solutionPlain: `We connect your production data into a live monitoring system with automated alerts when key metrics deviate from targets — before problems cascade. Shift supervisors see issues in real time, not at the end of the shift.`,
      whyThisSolution: `Because in manufacturing, late detection is expensive detection. An issue caught in the first 15 minutes costs a fraction of what it costs after 2 hours. Real-time visibility transforms ${company} from reactive to proactive operations management.`,
      expectedOutcome: 'Reduce production downtime by 20–35% through earlier detection and faster response to anomalies',
      icon: 'speed',
    };
  }
  // Universal fallback
  return {
    problem: 'Processes that worked at smaller scale are creating drag at current size',
    problemPlain: `The way ${company} operates today was built for a smaller, simpler version of the business. What were once manageable workarounds have become structural constraints. The same energy that used to produce growth now goes into maintaining existing operations — leaving less room for moving forward.`,
    solution: 'Operational Systems Rebuild',
    solutionPlain: `We audit your core workflows, identify the highest-friction points, and rebuild them with scalable, automated systems. The goal is operations that grow with your business rather than requiring constant manual intervention as volume increases.`,
    whyThisSolution: `Because operational drag is a compounding problem — the longer it goes unaddressed, the more it costs. Addressing it now, at current scale, is significantly cheaper than waiting until growth forces a crisis-mode intervention.`,
    expectedOutcome: 'Reduce operational friction by 40–60% and restore growth capacity without proportional cost increases',
    icon: 'speed',
  };
}

// ── Main Component ───────────────────────────────────────────────────────────

export function ClientSolutionView({
  companyName,
  industry,
  solutions: providedSolutions,
  onScheduleCall,
  onViewReport,
}: ClientSolutionViewProps) {
  const solutions = providedSolutions || getDefaultSolutions(companyName);

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-8">
      {/* Hero header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl border border-white/10"
        style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(59,130,246,0.10), rgba(6,215,246,0.08))' }}
      >
        <div className="p-8 md:p-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="size-12 rounded-xl bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center shadow-lg shadow-[#8B5CF6]/25">
              <Lightbulb className="size-6 text-white" />
            </div>
            <div>
              <span className="text-xs font-bold text-[#8B5CF6] uppercase tracking-wider">Your Solutions</span>
              <h2 className="text-2xl font-bold text-white leading-tight">What We Recommend & Why</h2>
            </div>
          </div>
          <p className="text-gray-300 text-lg leading-relaxed max-w-2xl">
            Based on our diagnostic of <span className="text-white font-semibold">{companyName}</span>, 
            here's what we found and — in plain English — what we'd do about it and why.
          </p>
          <p className="text-gray-500 text-sm mt-3">
            No jargon. No buzzwords. Just clear problems and clear fixes.
          </p>
        </div>
        {/* Decorative glow */}
        <div className="absolute -top-20 -right-20 size-60 bg-[#8B5CF6]/10 rounded-full blur-3xl pointer-events-none" />
      </motion.div>

      {/* How to read this section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-black/40 border border-white/10 rounded-xl p-5"
      >
        <div className="flex items-center gap-3 mb-3">
          <AlertCircle className="size-4 text-[#06D7F6]" />
          <span className="text-sm font-semibold text-white">How to Read This</span>
        </div>
        <p className="text-gray-400 text-sm leading-relaxed">
          Each card below shows <span className="text-white">what the problem is</span> in everyday language, 
          <span className="text-white"> what we'd do to fix it</span>, and 
          <span className="text-white"> why this particular approach makes sense</span> for your business. 
          These aren't generic recommendations — they're based on what you told us in your diagnostic.
        </p>
      </motion.div>

      {/* Solution Cards */}
      <div className="space-y-6">
        {solutions.map((item, idx) => {
          const Icon = ICON_MAP[item.icon] || Zap;
          const iconColor = ICON_COLORS[item.icon] || BRAND.purple;

          return (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + idx * 0.08 }}
              className="bg-black/40 border border-white/10 rounded-2xl overflow-hidden hover:border-white/20 transition-colors"
            >
              {/* Solution header */}
              <div className="flex items-center gap-4 px-6 pt-6 pb-4">
                <div
                  className="size-11 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `${iconColor}20`, border: `1px solid ${iconColor}30` }}
                >
                  <Icon className="size-5" style={{ color: iconColor }} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Solution {idx + 1}</span>
                  </div>
                  <h3 className="text-lg font-bold text-white">{item.solution}</h3>
                </div>
              </div>

              <div className="px-6 pb-6 space-y-5">
                {/* THE PROBLEM */}
                <div className="bg-[#FD4438]/8 border border-[#FD4438]/20 rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="size-4 text-[#FD4438]" />
                    <span className="text-xs font-bold text-[#FD4438] uppercase tracking-wider">The Problem</span>
                  </div>
                  <p className="text-sm font-semibold text-gray-300 mb-2">{item.problem}</p>
                  <p className="text-sm text-gray-400 leading-relaxed">{item.problemPlain}</p>
                </div>

                {/* THE SOLUTION */}
                <div className="bg-[#10B981]/8 border border-[#10B981]/20 rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <Wrench className="size-4 text-[#10B981]" />
                    <span className="text-xs font-bold text-[#10B981] uppercase tracking-wider">What We'll Do</span>
                  </div>
                  <p className="text-sm text-gray-300 leading-relaxed">{item.solutionPlain}</p>
                </div>

                {/* WHY THIS SOLUTION */}
                <div className="bg-[#8B5CF6]/8 border border-[#8B5CF6]/20 rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <Brain className="size-4 text-[#8B5CF6]" />
                    <span className="text-xs font-bold text-[#8B5CF6] uppercase tracking-wider">Why This Approach</span>
                  </div>
                  <p className="text-sm text-gray-300 leading-relaxed">{item.whyThisSolution}</p>
                </div>

                {/* EXPECTED OUTCOME */}
                <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-5 py-3.5">
                  <div className="size-8 rounded-lg bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center flex-shrink-0">
                    <TrendingUp className="size-4 text-white" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Expected Outcome</span>
                    <p className="text-sm font-semibold text-white">{item.expectedOutcome}</p>
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Bottom summary */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="bg-black/40 border border-white/10 rounded-2xl p-8"
      >
        <div className="flex items-center gap-3 mb-4">
          <Sparkles className="size-5 text-[#8B5CF6]" />
          <h3 className="text-lg font-bold text-white">The Big Picture</h3>
        </div>
        <p className="text-gray-300 leading-relaxed mb-4">
          These solutions aren't about replacing your team with technology — they're about 
          <span className="text-white font-semibold"> freeing your people to do the work that actually matters</span>. 
          Every automation we recommend exists to remove busywork, reduce mistakes, and give you 
          clearer visibility into what's really going on in your business.
        </p>
        <p className="text-gray-400 text-sm">
          We don't believe in automating everything. Some things need a human touch. 
          The solutions above focus specifically on the areas where automation makes a clear, measurable difference for {companyName}.
        </p>
      </motion.div>

      {/* CTA buttons */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7 }}
        className="grid grid-cols-1 sm:grid-cols-2 gap-4"
      >
        {onViewReport && (
          <button
            onClick={onViewReport}
            className="flex items-center justify-between p-5 rounded-xl border border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10 transition-all text-left group cursor-pointer"
          >
            <div>
              <div className="font-bold text-white mb-1 flex items-center gap-2">
                <Target className="size-4 text-[#8B5CF6]" />
                View Detailed Report
              </div>
              <p className="text-sm text-gray-400">See the full technical analysis behind these solutions</p>
            </div>
            <ArrowRight className="size-5 text-[#8B5CF6] flex-shrink-0 group-hover:translate-x-1 transition-transform" />
          </button>
        )}

        {onScheduleCall && (
          <button
            onClick={onScheduleCall}
            className="flex items-center justify-between p-5 rounded-xl border border-[#8B5CF6]/30 bg-gradient-to-br from-[#8B5CF6]/15 to-[#3B82F6]/10 hover:border-[#8B5CF6]/50 transition-all text-left group cursor-pointer"
          >
            <div>
              <div className="font-bold text-white mb-1 flex items-center gap-2">
                <Sparkles className="size-4 text-[#06D7F6]" />
                Let's Talk About This
              </div>
              <p className="text-sm text-gray-400">Book a 30-min call to walk through these solutions together</p>
            </div>
            <ArrowRight className="size-5 text-[#06D7F6] flex-shrink-0 group-hover:translate-x-1 transition-transform" />
          </button>
        )}
      </motion.div>
    </div>
  );
}