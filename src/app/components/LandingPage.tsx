import { motion } from 'motion/react';
import { useRef } from 'react';
import {
  ArrowRight, BarChart3, Shield, LogIn, ChevronDown,
  FileText, Layers, UserCog, TrendingDown, MessageCircle, Clock,
  Search, DollarSign, Wrench, Zap, Target, CheckCircle2,
  XCircle, Lock, Eye, Heart, AlertTriangle,
} from 'lucide-react';

interface LandingPageProps {
  onStartDiagnostic: () => void;
  onTeamLogin: () => void;
  onClientLogin: () => void;
}

const FONT = { fontFamily: 'Inter' } as const;
const PURPLE = '#8B5CF6';
const BLUE = '#3B82F6';
const CYAN = '#06D7F6';
const ORANGE = '#FB923C';
const RED = '#FD4438';

export default function LandingPage({ onStartDiagnostic, onTeamLogin, onClientLogin }: LandingPageProps) {
  const howItWorksRef = useRef<HTMLDivElement>(null);

  const scrollToHowItWorks = () => {
    howItWorksRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-xl border-b border-[#1a1a1a]" role="banner">
        <nav className="max-w-7xl mx-auto px-4 sm:px-8 h-16 sm:h-20 flex items-center justify-between" aria-label="Main navigation">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 sm:w-10 sm:h-10 bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] rounded-lg flex items-center justify-center">
              <BarChart3 size={20} className="text-white sm:hidden" />
              <BarChart3 size={24} className="text-white hidden sm:block" />
            </div>
            <span className="text-xl sm:text-2xl font-bold tracking-tight" style={FONT}>
              MARQ <span className="text-[#8B5CF6]">Cortex</span>
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <button
              onClick={onClientLogin}
              className="flex items-center gap-1 sm:gap-2 px-3 sm:px-4 py-2 text-[#F5F5FF] hover:text-white transition-colors text-sm"
              style={FONT}
            >
              <LogIn size={16} />
              <span className="hidden sm:inline">Client Portal</span>
            </button>
            <button
              onClick={onTeamLogin}
              className="flex items-center gap-1 sm:gap-2 px-4 sm:px-6 py-2 sm:py-3 bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] rounded-lg font-medium hover:opacity-90 transition-opacity text-sm"
              style={FONT}
            >
              <Shield size={16} />
              <span className="hidden sm:inline">Team Login</span>
            </button>
          </div>
        </nav>
      </header>

      {/* ── 1.1 HERO SECTION ──────────────────────────────────────────── */}
      <main>
      <section className="relative pt-32 sm:pt-40 pb-20 sm:pb-28 px-4 sm:px-8 overflow-hidden">
        {/* Background effects */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute w-[600px] h-[600px] rounded-full opacity-15 blur-[120px] -top-40 -left-40" style={{ background: `radial-gradient(circle, ${PURPLE}, transparent)` }} />
          <div className="absolute w-[500px] h-[500px] rounded-full opacity-10 blur-[100px] -bottom-20 -right-40" style={{ background: `radial-gradient(circle, ${BLUE}, transparent)` }} />
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: `linear-gradient(${PURPLE}40 1px, transparent 1px), linear-gradient(90deg, ${PURPLE}40 1px, transparent 1px)`,
              backgroundSize: '60px 60px',
            }}
          />
        </div>

        <div className="max-w-5xl mx-auto relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
            className="text-center"
          >
            <div className="inline-block mb-8 px-5 py-2.5 bg-[#1a1a1a] border border-[#8B5CF6]/40 rounded-full">
              <span className="text-xs sm:text-sm font-semibold text-[#8B5CF6] tracking-wide uppercase" style={FONT}>
                AI Operations Diagnostic
              </span>
            </div>

            <h1
              className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold mb-6 leading-[1.1] tracking-tight"
              style={FONT}
            >
              <span className="bg-gradient-to-r from-[#F5F5FF] via-white to-[#F5F5FF] bg-clip-text text-transparent">
                Your Business Doesn't Need
              </span>
              <br />
              <span className="bg-gradient-to-r from-[#F5F5FF] via-white to-[#F5F5FF] bg-clip-text text-transparent">
                More Tools.{' '}
              </span>
              <span className="bg-gradient-to-r from-[#8B5CF6] to-[#06D7F6] bg-clip-text text-transparent">
                It Needs
              </span>
              <br />
              <span className="bg-gradient-to-r from-[#8B5CF6] via-[#3B82F6] to-[#06D7F6] bg-clip-text text-transparent">
                AI-Driven Operations.
              </span>
            </h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.6 }}
              className="text-lg sm:text-xl md:text-2xl text-[#A0A0B0] mb-4 leading-relaxed max-w-3xl mx-auto"
              style={FONT}
            >
              MARQ Cortex installs AI systems that reduce manual work, remove bottlenecks, and scale revenue — without hiring more people.
            </motion.p>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-sm sm:text-base text-[#70707C] mb-10 sm:mb-12 font-medium"
              style={FONT}
            >
              Built for growth-stage companies between $1M–$50M.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-4"
            >
              <motion.button
                whileHover={{ scale: 1.04, y: -2 }}
                whileTap={{ scale: 0.97 }}
                onClick={onStartDiagnostic}
                className="inline-flex items-center gap-3 px-8 sm:px-10 py-4 sm:py-5 bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] rounded-xl text-base sm:text-lg font-bold hover:shadow-2xl hover:shadow-[#8B5CF6]/40 transition-all"
                style={FONT}
              >
                Get Your AI Readiness Score
                <ArrowRight size={22} />
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={scrollToHowItWorks}
                className="inline-flex items-center gap-2 px-6 py-4 text-[#A0A0B0] hover:text-white transition-colors text-base font-medium"
                style={FONT}
              >
                See How It Works
                <ChevronDown size={18} />
              </motion.button>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ── 1.2 AUTHORITY STRIP ───────────────────────────────────────── */}
      <section className="py-10 sm:py-14 px-4 sm:px-8 border-y border-[#1a1a1a] bg-[#050508]">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8 mb-8">
            {[
              { label: 'Operational redesign.', color: PURPLE },
              { label: 'AI workflow architecture.', color: BLUE },
              { label: 'Revenue system automation.', color: CYAN },
              { label: 'Human-supervised AI deployment.', color: ORANGE },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="text-center"
              >
                <div className="w-1 h-8 mx-auto mb-3 rounded-full" style={{ backgroundColor: item.color }} />
                <p className="text-sm sm:text-base font-semibold text-[#F5F5FF]" style={FONT}>
                  {item.label}
                </p>
              </motion.div>
            ))}
          </div>
          <p className="text-center text-sm sm:text-base text-[#70707C] font-medium" style={FONT}>
            Built for operators who care about structure, not hype.
          </p>
        </div>
      </section>

      {/* ── 1.3 PROBLEM SECTION ───────────────────────────────────────── */}
      <section className="py-20 sm:py-28 px-4 sm:px-8">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-14"
          >
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold mb-4 tracking-tight" style={FONT}>
              Growth Shouldn't Feel This{' '}
              <span className="bg-gradient-to-r from-[#FD4438] to-[#FB923C] bg-clip-text text-transparent">Messy.</span>
            </h2>
            <p className="text-lg sm:text-xl text-[#A0A0B0]" style={FONT}>
              Revenue is growing. But internally, things are slowing down.
            </p>
          </motion.div>

          <div className="max-w-2xl mx-auto space-y-4">
            {[
              'Follow-ups slip through.',
              'Reports take hours.',
              'Approvals stall in Slack.',
              'CRM updates happen manually.',
              'New hires are fixing old inefficiencies.',
            ].map((line, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className="flex items-center gap-4 py-3 px-5 bg-[#FD4438]/5 border border-[#FD4438]/15 rounded-xl"
              >
                <AlertTriangle size={18} className="text-[#FD4438] flex-shrink-0" />
                <p className="text-base sm:text-lg text-[#E0E0EA]" style={FONT}>{line}</p>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mt-12 text-center"
          >
            <p className="text-lg sm:text-xl text-[#70707C] mb-2" style={FONT}>
              Hiring hasn't solved the problem.
            </p>
            <p className="text-xl sm:text-2xl font-bold text-[#FB923C]" style={FONT}>
              It's just made the chaos more expensive.
            </p>
          </motion.div>
        </div>
      </section>

      {/* ── 1.4 OPERATIONAL SYMPTOMS GRID ─────────────────────────────── */}
      <section className="py-20 sm:py-28 px-4 sm:px-8 bg-[#050508]">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
            {[
              {
                icon: <FileText size={26} />,
                title: 'Manual Reporting',
                desc: 'Leadership waits for numbers that should be instant.',
                color: PURPLE,
              },
              {
                icon: <Layers size={26} />,
                title: 'Tool Fragmentation',
                desc: 'Your stack exists. It just doesn\'t communicate.',
                color: BLUE,
              },
              {
                icon: <UserCog size={26} />,
                title: 'Admin Overload',
                desc: 'High-value employees doing low-value work.',
                color: CYAN,
              },
              {
                icon: <TrendingDown size={26} />,
                title: 'Sales Bottlenecks',
                desc: 'Deals slow down because systems don\'t support reps.',
                color: ORANGE,
              },
              {
                icon: <MessageCircle size={26} />,
                title: 'Support Repetition',
                desc: 'The same questions answered over and over.',
                color: RED,
              },
              {
                icon: <Clock size={26} />,
                title: 'Approval Delays',
                desc: 'Momentum lost in internal loops.',
                color: PURPLE,
              },
            ].map((card, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className="p-7 bg-gradient-to-br from-[#111115] to-[#0A0A0E] border border-[#1E1E24] rounded-2xl hover:border-opacity-60 transition-all group"
                style={{ borderColor: `${card.color}30` }}
              >
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center mb-5 group-hover:scale-110 transition-transform"
                  style={{ background: `linear-gradient(135deg, ${card.color}20, ${card.color}08)` }}
                >
                  <span style={{ color: card.color }}>{card.icon}</span>
                </div>
                <h3 className="text-lg font-bold mb-2 text-[#F5F5FF]" style={FONT}>{card.title}</h3>
                <p className="text-[#70707C] leading-relaxed text-sm sm:text-base" style={FONT}>{card.desc}</p>
              </motion.div>
            ))}
          </div>

          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="text-center mt-10 text-base sm:text-lg font-semibold text-[#FB923C]"
            style={FONT}
          >
            Hidden cost: time, payroll, opportunity.
          </motion.p>
        </div>
      </section>

      {/* ── 1.5 POSITIONING SECTION ───────────────────────────────────── */}
      <section className="py-20 sm:py-28 px-4 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-14"
          >
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold mb-4 tracking-tight" style={FONT}>
              We Don't Sell AI Tools.{' '}
              <br className="hidden sm:block" />
              <span className="bg-gradient-to-r from-[#8B5CF6] to-[#06D7F6] bg-clip-text text-transparent">
                We Install AI Infrastructure.
              </span>
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-10 sm:gap-14 items-start">
            {/* What we're NOT */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="space-y-4"
            >
              {[
                'We are not a chatbot agency.',
                'We are not a freelance automation shop.',
                'We are not a generic dev firm.',
              ].map((line, i) => (
                <div key={i} className="flex items-center gap-3 py-2">
                  <XCircle size={18} className="text-[#FD4438] flex-shrink-0" />
                  <p className="text-base sm:text-lg text-[#A0A0B0]" style={FONT}>{line}</p>
                </div>
              ))}

              <div className="pt-4">
                <p className="text-xl sm:text-2xl font-bold text-white" style={FONT}>
                  MARQ Cortex is an{' '}
                  <span className="bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] bg-clip-text text-transparent">
                    AI Operations partner.
                  </span>
                </p>
              </div>

              <div className="space-y-3 pt-2">
                {[
                  'We redesign workflows.',
                  'We embed AI into real systems.',
                  'We measure time saved and cost reduced.',
                ].map((line, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <CheckCircle2 size={18} className="text-[#10B981] flex-shrink-0" />
                    <p className="text-base sm:text-lg text-[#E0E0EA]" style={FONT}>{line}</p>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Method */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="p-8 bg-gradient-to-br from-[#111115] to-[#0A0A0E] border border-[#8B5CF6]/20 rounded-2xl"
            >
              <p className="text-xs font-bold uppercase tracking-widest text-[#8B5CF6] mb-6" style={FONT}>
                Our Method
              </p>
              <div className="space-y-5">
                {[
                  { step: 'Audit', icon: <Search size={20} />, color: PURPLE },
                  { step: 'Transform', icon: <Wrench size={20} />, color: BLUE },
                  { step: 'Build', icon: <Layers size={20} />, color: CYAN },
                  { step: 'Automate', icon: <Zap size={20} />, color: ORANGE },
                  { step: 'Optimize', icon: <Target size={20} />, color: '#10B981' },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: `${item.color}18` }}
                    >
                      <span style={{ color: item.color }}>{item.icon}</span>
                    </div>
                    <div className="flex-1 flex items-center gap-3">
                      <span className="text-base font-bold text-[#F5F5FF]" style={FONT}>{item.step}</span>
                      {i < 4 && <ArrowRight size={14} className="text-[#70707C]" />}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-8 pt-6 border-t border-[#242424] space-y-1">
                <p className="text-sm text-[#70707C]" style={FONT}>No experiments.</p>
                <p className="text-sm text-[#70707C]" style={FONT}>No random deliverables.</p>
                <p className="text-sm font-semibold text-[#F5F5FF]" style={FONT}>Structured transformation.</p>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── 1.6 DIAGNOSTIC INTRODUCTION ───────────────────────────────── */}
      <section className="py-20 sm:py-28 px-4 sm:px-8 bg-[#050508]">
        <div className="max-w-4xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold mb-6 tracking-tight" style={FONT}>
              Before Installing AI,{' '}
              <span className="bg-gradient-to-r from-[#06D7F6] to-[#3B82F6] bg-clip-text text-transparent">
                We Diagnose.
              </span>
            </h2>
            <p className="text-lg sm:text-xl text-[#A0A0B0] mb-12 max-w-2xl mx-auto" style={FONT}>
              The AI Operations Diagnostic identifies:
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl mx-auto text-left mb-12">
            {[
              { text: 'Where manual work is draining time', icon: <Clock size={18} /> },
              { text: 'Where revenue is leaking', icon: <DollarSign size={18} /> },
              { text: 'Where tools are disconnected', icon: <Layers size={18} /> },
              { text: 'Where approvals are slowing growth', icon: <AlertTriangle size={18} /> },
              { text: 'Where AI can be deployed safely', icon: <Shield size={18} /> },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className={`flex items-center gap-4 py-4 px-5 bg-[#06D7F6]/5 border border-[#06D7F6]/15 rounded-xl ${i === 4 ? 'sm:col-span-2 sm:max-w-sm sm:mx-auto' : ''}`}
              >
                <span className="text-[#06D7F6] flex-shrink-0">{item.icon}</span>
                <p className="text-sm sm:text-base text-[#E0E0EA]" style={FONT}>{item.text}</p>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
          >
            <p className="text-base sm:text-lg text-[#70707C] mb-2" style={FONT}>
              This isn't a quiz.
            </p>
            <p className="text-xl sm:text-2xl font-bold text-[#06D7F6]" style={FONT}>
              It's an operational X-ray.
            </p>
          </motion.div>
        </div>
      </section>

      {/* ── 1.7 HOW IT WORKS ──────────────────────────────────────────── */}
      <section ref={howItWorksRef} className="py-20 sm:py-28 px-4 sm:px-8">
        <div className="max-w-4xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-center mb-16 tracking-tight"
            style={FONT}
          >
            How It Works
          </motion.h2>

          <div className="space-y-8">
            {[
              {
                step: '01',
                title: 'Select your industry.',
                desc: 'Choose from 9 industries so the diagnostic adapts to your operational context.',
                color: PURPLE,
              },
              {
                step: '02',
                title: 'Complete a structured operational diagnostic.',
                desc: 'Answer 14 deep, open-ended questions about how your business actually runs today.',
                color: BLUE,
              },
              {
                step: '03',
                title: 'Receive your AI Readiness Score and key insights.',
                desc: 'Get your score instantly with personalised insights, bottleneck analysis, and estimated ROI.',
                color: CYAN,
              },
            ].map((item, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.12 }}
                className="flex gap-6 sm:gap-8 items-start"
              >
                <div
                  className="flex-shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-2xl flex items-center justify-center text-2xl sm:text-3xl font-extrabold"
                  style={{
                    ...FONT,
                    background: `linear-gradient(135deg, ${item.color}20, ${item.color}05)`,
                    border: `2px solid ${item.color}40`,
                    color: item.color,
                  }}
                >
                  {item.step}
                </div>
                <div className="flex-1 pt-2 sm:pt-4">
                  <h3 className="text-xl sm:text-2xl font-bold mb-2 text-[#F5F5FF]" style={FONT}>
                    {item.title}
                  </h3>
                  <p className="text-[#70707C] text-base sm:text-lg leading-relaxed" style={FONT}>
                    {item.desc}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mt-12 p-6 bg-[#111115] border border-[#242424] rounded-2xl text-center"
          >
            <p className="text-base sm:text-lg text-[#A0A0B0] mb-1" style={FONT}>
              If there's a fit, you'll be invited to book a readiness call.
            </p>
            <p className="text-sm text-[#70707C]" style={FONT}>
              No pressure. No generic pitch.
            </p>
          </motion.div>
        </div>
      </section>

      {/* ── 1.8 WHO THIS IS FOR ───────────────────────────────────────── */}
      <section className="py-20 sm:py-28 px-4 sm:px-8 bg-[#050508]">
        <div className="max-w-5xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-center mb-16 tracking-tight"
            style={FONT}
          >
            Who This Is For
          </motion.h2>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Built For */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="p-8 bg-gradient-to-br from-[#10B981]/5 to-transparent border border-[#10B981]/20 rounded-2xl"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-lg bg-[#10B981]/15 flex items-center justify-center">
                  <CheckCircle2 size={22} className="text-[#10B981]" />
                </div>
                <h3 className="text-xl font-bold text-[#10B981]" style={FONT}>Built For</h3>
              </div>
              <div className="space-y-4">
                {[
                  'Founders scaling beyond founder-led chaos',
                  'COOs managing growing complexity',
                  'Ops leaders drowning in admin',
                  'Teams of 8–50 employees',
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <CheckCircle2 size={16} className="text-[#10B981] mt-1 flex-shrink-0" />
                    <p className="text-base text-[#E0E0EA]" style={FONT}>{item}</p>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Not Built For */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="p-8 bg-gradient-to-br from-[#FD4438]/5 to-transparent border border-[#FD4438]/20 rounded-2xl"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-lg bg-[#FD4438]/15 flex items-center justify-center">
                  <XCircle size={22} className="text-[#FD4438]" />
                </div>
                <h3 className="text-xl font-bold text-[#FD4438]" style={FONT}>Not Built For</h3>
              </div>
              <div className="space-y-4">
                {[
                  'Solo freelancers',
                  'DIY automation seekers',
                  'Very early-stage startups',
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <XCircle size={16} className="text-[#FD4438] mt-1 flex-shrink-0" />
                    <p className="text-base text-[#A0A0B0]" style={FONT}>{item}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>

          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="text-center mt-10 text-base sm:text-lg font-medium text-[#70707C]"
            style={FONT}
          >
            We work best where structure matters.
          </motion.p>
        </div>
      </section>

      {/* ── 1.9 COMPLIANCE & TRUST ────────────────────────────────────── */}
      <section className="py-16 sm:py-20 px-4 sm:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="p-8 sm:p-10 bg-gradient-to-br from-[#111115] to-[#0A0A0E] border border-[#242424] rounded-2xl">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-lg bg-[#3B82F6]/15 flex items-center justify-center">
                <Lock size={22} className="text-[#3B82F6]" />
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-[#F5F5FF]" style={FONT}>
                Compliance & Trust
              </h3>
            </div>

            <div className="grid sm:grid-cols-2 gap-4 mb-8">
              {[
                { text: 'GDPR-aware data handling', icon: <Shield size={18} /> },
                { text: 'Human-in-the-loop oversight', icon: <Eye size={18} /> },
                { text: 'No automated medical or legal decisions', icon: <Heart size={18} /> },
                { text: 'HIPAA-aligned workflows available upon request', icon: <Lock size={18} /> },
              ].map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08 }}
                  className="flex items-center gap-3 py-3 px-4 bg-[#3B82F6]/5 border border-[#3B82F6]/15 rounded-xl"
                >
                  <span className="text-[#3B82F6] flex-shrink-0">{item.icon}</span>
                  <p className="text-sm sm:text-base text-[#E0E0EA]" style={FONT}>{item.text}</p>
                </motion.div>
              ))}
            </div>

            <p className="text-sm sm:text-base text-[#70707C] font-medium" style={FONT}>
              AI should increase control, not introduce risk.
            </p>
          </div>
        </div>
      </section>

      {/* ── 1.10 FINAL CTA SECTION ────────────────────────────────────── */}
      <section className="relative py-24 sm:py-32 px-4 sm:px-8 overflow-hidden">
        {/* Background glow */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute w-[700px] h-[700px] rounded-full opacity-15 blur-[150px] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" style={{ background: `radial-gradient(circle, ${PURPLE}, ${BLUE}, transparent)` }} />
        </div>

        <div className="max-w-4xl mx-auto text-center relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold mb-6 tracking-tight leading-tight" style={FONT}>
              Your Operations Are Already{' '}
              <br className="hidden sm:block" />
              <span className="bg-gradient-to-r from-[#FB923C] to-[#FD4438] bg-clip-text text-transparent">
                Costing More Than You Think.
              </span>
            </h2>

            <div className="max-w-2xl mx-auto space-y-3 mb-8">
              <p className="text-lg sm:text-xl text-[#A0A0B0]" style={FONT}>
                The longer manual systems remain,
              </p>
              <p className="text-lg sm:text-xl text-[#A0A0B0]" style={FONT}>
                the more expensive growth becomes.
              </p>
            </div>

            <p className="text-base sm:text-lg text-[#70707C] mb-2" style={FONT}>
              Stop adding people to broken workflows.
            </p>
            <p className="text-lg sm:text-xl font-bold text-white mb-12" style={FONT}>
              Start installing AI-driven infrastructure.
            </p>

            <motion.button
              whileHover={{ scale: 1.04, y: -3 }}
              whileTap={{ scale: 0.97 }}
              onClick={onStartDiagnostic}
              className="inline-flex items-center gap-3 px-10 sm:px-12 py-5 sm:py-6 bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] rounded-xl text-lg sm:text-xl font-bold hover:shadow-2xl hover:shadow-[#8B5CF6]/50 transition-all"
              style={FONT}
            >
              Get Your AI Readiness Score
              <ArrowRight size={24} />
            </motion.button>

            <p className="mt-5 text-sm text-[#70707C]" style={FONT}>
              Executive-level diagnostic. Built for serious operators.
            </p>
          </motion.div>
        </div>
      </section>
      </main>

      {/* ── FOOTER ─────────────────────────────────────────────────────── */}
      <footer className="py-10 sm:py-12 px-4 sm:px-8 border-t border-[#1a1a1a]" role="contentinfo">
        <div className="max-w-7xl mx-auto text-center text-[#70707C]" style={FONT}>
          <p>&copy; 2026 MARQ Cortex. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}