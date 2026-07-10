/**
 * CLIENT READINESS REPORT — Phase 4 Complete (10 sections)
 *
 * Scrollable single-page web document. All 10 sections flow naturally.
 * - Full dark theme throughout (Eclipse UI)
 * - Alternating #0A0A0F / #0d0d14 section backgrounds
 * - Sticky top toolbar with section nav + print
 * - CTA and PDF buttons fire engagement callbacks
 * - Print-optimised CSS included
 *
 * Sections:
 *  1. Cover
 *  2. Executive Snapshot
 *  3. Core Diagnosis
 *  4. Operational Heatmap
 *  5. AI Opportunities
 *  6. Competitive Landscape (NEW — Phase 4)
 *  7. Recommended First Step
 *  8. Quick Wins (NEW — Phase 4)
 *  9. Impact Range
 * 10. Implementation Timeline (NEW — Phase 4)
 * 11. CTA
 */

import { useState, useEffect, useRef } from 'react';
import { motion, useScroll, useMotionValueEvent } from 'motion/react';
import {
  Calendar, Download, TrendingUp, AlertTriangle, CheckCircle2,
  XCircle, Target, Zap, Brain, ArrowRight, ChevronDown,
  BarChart3, Shield, Lightbulb, DollarSign, Printer,
  Users, Clock, Rocket,
} from 'lucide-react';

import { exportToPDF } from '@/app/utils/pdfExport';

// ── Props ─────────────────────────────────────────────────────────────────────

interface ClientReadinessReportProps {
  companyName: string;
  industry: string;
  generatedDate: string;

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
    revenueGrowth:       { score: 'red' | 'yellow' | 'green'; label: string; explanation: string };
    systemsAutomation:   { score: 'red' | 'yellow' | 'green'; label: string; explanation: string };
    aiReadiness:         { score: 'red' | 'yellow' | 'green'; label: string; explanation: string };
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

  // ── Phase 4 Expansion: 3 new sections ────────────────────────────────────
  competitiveLandscape?: {
    peerComparison: string;
    industryBenchmarks: { metric: string; yourPosition: 'ahead' | 'on-par' | 'behind'; detail: string }[];
    competitiveWindow: string;
  };

  quickWins?: {
    title: string;
    description: string;
    effort: 'low' | 'medium';
    expectedImpact: string;
  }[];

  implementationTimeline?: {
    phases: {
      label: string;
      weeks: string;
      description: string;
      milestones: string[];
    }[];
    totalDuration: string;
  };

  callSchedulingUrl?: string;

  /** True when this report was generated from real CORTEX AI analysis */
  aiPowered?: boolean;

  // Engagement callbacks — fired when client interacts
  onCTAClick?: () => void;
  onPrintClick?: () => void;
  onScheduleCall?: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const READINESS_COLOURS: Record<string, string> = {
  High:   '#10B981',
  Medium: '#FB923C',
  Low:    '#FD4438',
};

const HEAT_COLOURS: Record<string, string> = {
  green:  '#10B981',
  yellow: '#FB923C',
  red:    '#FD4438',
};

const HEAT_LABELS: Record<string, string> = {
  green:  'Stable',
  yellow: 'Needs Attention',
  red:    'Immediate',
};

const SECTIONS = [
  { id: 'executive',    label: 'Executive Snapshot' },
  { id: 'diagnosis',    label: 'Core Diagnosis' },
  { id: 'heatmap',      label: 'Heatmap' },
  { id: 'ai',           label: 'AI Opportunities' },
  { id: 'competitive',  label: 'Industry Context' },
  { id: 'first-step',   label: 'First Step' },
  { id: 'quick-wins',   label: 'Quick Wins' },
  { id: 'impact',       label: 'Impact Range' },
  { id: 'timeline',     label: 'Timeline' },
  { id: 'cta',          label: 'Schedule Call' },
];

// ── Main component ────────────────────────────────────────────────────────────

export function ClientReadinessReport(props: ClientReadinessReportProps) {
  const readinessColor = READINESS_COLOURS[props.readinessLevel];
  const [activeSection, setActiveSection] = useState('executive');
  const [navVisible, setNavVisible] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const coverRef = useRef<HTMLDivElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll();

  // Show sticky nav once user scrolls past cover
  useMotionValueEvent(scrollY, 'change', (y) => {
    setNavVisible(y > 420);
  });

  // Scrollspy
  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(`report-${id}`);
      if (!el) return;
      const obs = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActiveSection(id); },
        { rootMargin: '-40% 0px -50% 0px' }
      );
      obs.observe(el);
      observers.push(obs);
    });
    return () => observers.forEach(o => o.disconnect());
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(`report-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleCTA = () => {
    props.onCTAClick?.();
    if (props.callSchedulingUrl) {
      window.open(props.callSchedulingUrl, '_blank');
    } else {
      scrollTo('cta');
    }
  };

  const handlePrint = async () => {
    props.onPrintClick?.();
    if (!reportRef.current) {
      window.print();
      return;
    }
    setIsExporting(true);
    try {
      const result = await exportToPDF(reportRef.current, {
        filename: `${props.companyName.replace(/[^a-zA-Z0-9]/g, '-')}-AI-Readiness-Report.pdf`,
        orientation: 'portrait',
        format: 'a4',
        scale: 2,
      });
      if (!result.success) {
        console.error('PDF export error:', result.error);
        // Fallback to browser print
        window.print();
      }
    } catch (err) {
      console.error('PDF export failed, falling back to print:', err);
      window.print();
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div ref={reportRef} className="bg-[#0A0A0F] text-gray-100 font-[Inter,sans-serif]">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .page-break { page-break-before: always; }
          body { font-size: 12px; }
        }
        #report-cover { min-height: 100vh; }
        #report-cta   { min-height: 60vh; }
      `}</style>

      {/* ══════════════════════════════════════════════════════════════════════
          STICKY NAV TOOLBAR
      ══════════════════════════════════════════════════════════════════════ */}
      <motion.div
        initial={{ y: -60, opacity: 0 }}
        animate={{ y: navVisible ? 0 : -60, opacity: navVisible ? 1 : 0 }}
        transition={{ duration: 0.2 }}
        className="no-print fixed top-0 left-0 right-0 z-50 bg-[#0A0A0F]/95 backdrop-blur-xl border-b border-white/10 shadow-sm"
      >
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          {/* Brand + company */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="size-7 rounded-lg bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center">
              <Brain className="size-3.5 text-white" />
            </div>
            <span className="font-bold text-white text-sm hidden sm:block">{props.companyName}</span>
            <span className="hidden sm:block text-gray-600">·</span>
            <span
              className="text-xs font-bold px-2 py-0.5 rounded-full hidden sm:block"
              style={{ color: readinessColor, backgroundColor: `${readinessColor}18`, border: `1px solid ${readinessColor}40` }}
            >
              {props.readinessLevel} Readiness
            </span>
          </div>

          {/* Section links */}
          <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-hide">
            {SECTIONS.map(s => (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-all ${
                  activeSection === s.id
                    ? 'bg-[#8B5CF6]/20 text-[#8B5CF6]'
                    : 'text-gray-500 hover:text-white hover:bg-white/5'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handlePrint}
              disabled={isExporting}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/8 hover:bg-white/15 text-gray-300 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
            >
              {isExporting ? (
                <svg className="size-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25"/><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75"/></svg>
              ) : (
                <Printer className="size-3.5" />
              )}
              <span className="hidden sm:block">{isExporting ? 'Exporting...' : 'Print'}</span>
            </button>
            <button
              onClick={handleCTA}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] text-white rounded-lg text-xs font-semibold transition-all hover:opacity-90"
            >
              <Calendar className="size-3.5" />
              <span className="hidden sm:block">Book a Call</span>
            </button>
          </div>
        </div>
      </motion.div>

      {/* ══════════════════════════════════════════════════════════════════════
          1. COVER
      ══════════════════════════════════════════════════════════════════════ */}
      <div
        id="report-cover"
        ref={coverRef}
        className="flex flex-col items-center justify-center bg-gradient-to-br from-[#0A0A0F] via-[#0f0f1e] to-[#1a1a2e] text-white px-8 py-24"
      >
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-3xl text-center"
        >
          {/* Brand mark */}
          <div className="flex items-center justify-center gap-3 mb-14">
            <div className="size-14 rounded-2xl bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center shadow-lg shadow-[#8B5CF6]/30">
              <Brain className="size-7 text-white" />
            </div>
            <div className="text-left">
              <div className="font-bold text-white text-lg leading-tight">MARQ Cortex</div>
              <div className="text-gray-400 text-xs">Operational Intelligence</div>
            </div>
          </div>

          {/* Badge */}
          <div className="inline-block px-4 py-1.5 bg-gradient-to-r from-[#8B5CF6]/30 to-[#3B82F6]/30 border border-[#8B5CF6]/40 rounded-full text-sm font-semibold text-[#A78BFA] mb-4 tracking-wide uppercase">
            AI Readiness & Operations Report
          </div>

          {/* AI-powered indicator */}
          {props.aiPowered && (
            <div className="flex items-center justify-center gap-2 mb-8">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/15 border border-emerald-500/30 rounded-full text-xs font-medium text-emerald-400">
                <svg className="size-3 fill-emerald-400" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4"/></svg>
                Powered by CORTEX Intelligence · GPT-4o-mini Analysis
              </div>
            </div>
          )}

          {/* Company */}
          <h1 className="text-5xl md:text-7xl font-bold mb-5 tracking-tight leading-none">
            {props.companyName}
          </h1>

          {/* Subtitle */}
          <p className="text-xl text-gray-300 mb-10">
            An AI Readiness & Operations Diagnostic
          </p>

          {/* Meta chips */}
          <div className="flex items-center justify-center gap-3 flex-wrap mb-14 text-sm">
            <span className="px-4 py-1.5 bg-white/8 border border-white/15 rounded-full text-gray-300">
              {props.industry}
            </span>
            <span className="px-4 py-1.5 bg-white/8 border border-white/15 rounded-full text-gray-300">
              {new Date(props.generatedDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </span>
            <span
              className="px-4 py-1.5 rounded-full font-semibold text-sm"
              style={{ backgroundColor: `${readinessColor}20`, color: readinessColor, border: `1px solid ${readinessColor}40` }}
            >
              {props.readinessLevel} Readiness
            </span>
          </div>

          {/* Scroll cue */}
          <button
            onClick={() => scrollTo('executive')}
            className="no-print flex flex-col items-center gap-2 text-gray-500 hover:text-gray-300 transition-colors mx-auto"
          >
            <span className="text-xs uppercase tracking-widest">Read Report</span>
            <ChevronDown className="size-5 animate-bounce" />
          </button>

          <div className="mt-14 pt-8 border-t border-white/10">
            <p className="text-sm text-gray-500 italic">
              {props.aiPowered
                ? 'This report was generated by CORTEX AI, analysing your diagnostic responses against operational patterns across 1,000+ businesses.'
                : 'This report is based on your responses and operational patterns observed across similar businesses.'}
            </p>
          </div>
        </motion.div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          2. EXECUTIVE SNAPSHOT
      ══════════════════════════════════════════════════════════════════════ */}
      <div id="report-executive" className="page-break bg-[#0A0A0F] px-8 py-20">
        <div className="max-w-4xl mx-auto">
          <SectionLabel>Executive Snapshot</SectionLabel>
          <h2 className="text-4xl font-bold text-white mb-3">Your Operational Readiness</h2>
          <p className="text-gray-500 mb-14 text-lg">A clear-eyed view of where you stand right now</p>

          {/* Readiness score + interpretation */}
          <div
            className="flex gap-8 items-start p-8 rounded-2xl mb-10 border"
            style={{ backgroundColor: `${readinessColor}08`, borderColor: `${readinessColor}30` }}
          >
            {/* Circle badge */}
            <div
              className="size-28 rounded-full flex flex-col items-center justify-center flex-shrink-0 border-4 shadow-lg"
              style={{
                borderColor: readinessColor,
                backgroundColor: `${readinessColor}15`,
                boxShadow: `0 0 32px ${readinessColor}20`,
              }}
            >
              <span className="text-2xl font-black" style={{ color: readinessColor }}>
                {props.readinessLevel}
              </span>
            </div>
            <div>
              <h3 className="text-2xl font-bold text-white mb-3">
                Readiness Level: <span style={{ color: readinessColor }}>{props.readinessLevel}</span>
              </h3>
              <p className="text-gray-300 text-lg leading-relaxed">{props.readinessInterpretation}</p>
            </div>
          </div>

          {/* What this means */}
          <h3 className="text-xl font-bold text-white mb-5">What This Means for You</h3>
          <div className="grid gap-3 mb-10">
            {props.whatThisMeans.map((point, i) => (
              <div key={i} className="flex items-start gap-4 p-5 bg-white/5 rounded-xl border border-white/10">
                <div className="size-8 rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                  {i + 1}
                </div>
                <p className="text-gray-300 text-base leading-relaxed">{point}</p>
              </div>
            ))}
          </div>

          {/* Immediate risk */}
          <div className="flex gap-4 items-start p-6 bg-[#FD4438]/10 border border-[#FD4438]/25 rounded-xl">
            <AlertTriangle className="size-6 text-[#FD4438] flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-[#FD4438] uppercase tracking-wider mb-1.5">Immediate Risk</p>
              <p className="text-gray-300 leading-relaxed">{props.immediateRisk}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          3. CORE DIAGNOSIS
      ══════════════════════════════════════════════════════════════════════ */}
      <div id="report-diagnosis" className="page-break bg-[#0d0d14] px-8 py-20">
        <div className="max-w-4xl mx-auto">
          <SectionLabel>Core Diagnosis</SectionLabel>
          <h2 className="text-4xl font-bold text-white mb-3">What's Slowing You Down Right Now</h2>
          <p className="text-gray-500 mb-14 text-lg">The core constraints identified through your diagnostic</p>

          <div className="space-y-8">
            {props.coreIssues.map((issue, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: idx * 0.08 }}
                className="bg-black/40 rounded-2xl border border-white/10 overflow-hidden"
              >
                {/* Issue header bar */}
                <div className="flex items-center gap-4 px-8 pt-8 pb-5">
                  <div className="size-11 rounded-full bg-gradient-to-br from-[#FD4438] to-[#FB923C] text-white flex items-center justify-center font-black text-lg flex-shrink-0">
                    {idx + 1}
                  </div>
                  <h3 className="text-2xl font-bold text-white">{issue.title}</h3>
                </div>

                <div className="px-8 pb-8 space-y-6">
                  <p className="text-gray-300 text-base leading-relaxed">{issue.problem}</p>

                  <div className="bg-[#FB923C]/10 border border-[#FB923C]/20 rounded-xl p-5">
                    <p className="text-xs font-bold text-[#FB923C] uppercase tracking-wider mb-2">Why It Exists</p>
                    <p className="text-gray-300 text-sm leading-relaxed">{issue.whyItExists}</p>
                  </div>

                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Business Impact</p>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {issue.businessImpact.map((impact, j) => (
                        <div key={j} className="flex items-start gap-2.5 p-3 bg-white/5 rounded-lg">
                          <div className="size-1.5 rounded-full bg-[#FD4438] flex-shrink-0 mt-1.5" />
                          <span className="text-gray-300 text-sm leading-relaxed">{impact}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          4. OPERATIONAL HEATMAP
      ══════════════════════════════════════════════════════════════════════ */}
      <div id="report-heatmap" className="page-break bg-[#0A0A0F] px-8 py-20">
        <div className="max-w-4xl mx-auto">
          <SectionLabel>Operational Heatmap</SectionLabel>
          <h2 className="text-4xl font-bold text-white mb-3">Where You Stand Across Four Areas</h2>
          <p className="text-gray-500 mb-14 text-lg">A colour-coded view of your operational landscape</p>

          <div className="grid sm:grid-cols-2 gap-5 mb-10">
            {[
              { title: 'Operations & Execution', data: props.operationalHeatmap.operationsExecution, icon: BarChart3 },
              { title: 'Revenue & Growth',        data: props.operationalHeatmap.revenueGrowth,       icon: TrendingUp },
              { title: 'Systems & Automation',    data: props.operationalHeatmap.systemsAutomation,   icon: Zap },
              { title: 'AI Readiness',            data: props.operationalHeatmap.aiReadiness,         icon: Brain },
            ].map(({ title, data, icon: Icon }) => {
              const col = HEAT_COLOURS[data.score];
              return (
                <motion.div
                  key={title}
                  initial={{ opacity: 0, scale: 0.97 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  className="p-6 bg-white/5 border border-white/10 rounded-2xl"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="size-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${col}18` }}>
                      <Icon className="size-4.5" style={{ color: col }} />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-white">{title}</div>
                      <div
                        className="text-xs font-semibold px-2 py-0.5 rounded-full inline-block mt-0.5"
                        style={{ backgroundColor: `${col}15`, color: col }}
                      >
                        {HEAT_LABELS[data.score]}
                      </div>
                    </div>
                    {/* Coloured dot */}
                    <div className="ml-auto size-3.5 rounded-full flex-shrink-0" style={{ backgroundColor: col }} />
                  </div>
                  <p className="text-sm text-gray-400 leading-relaxed">{data.explanation}</p>
                </motion.div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center justify-center gap-6 pt-6 border-t border-white/10">
            {[
              { color: '#FD4438', label: 'Immediate Attention' },
              { color: '#FB923C', label: 'Near-Term Priority' },
              { color: '#10B981', label: 'Stable' },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-2">
                <div className="size-3 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-sm text-gray-500">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          5. WHAT AI CAN FIX
      ══════════════════════════════════════════════════════════════════════ */}
      <div id="report-ai" className="page-break bg-[#0d0d14] px-8 py-20">
        <div className="max-w-4xl mx-auto">
          <SectionLabel>AI Analysis</SectionLabel>
          <h2 className="text-4xl font-bold text-white mb-3">What AI Can Fix — And What It Shouldn't</h2>
          <p className="text-gray-500 mb-14 text-lg">Cutting through the hype to show you what's real</p>

          <div className="grid sm:grid-cols-2 gap-6">
            {/* High-impact */}
            <div className="bg-black/40 rounded-2xl border-l-4 border-[#10B981] border border-white/10 p-7">
              <div className="flex items-center gap-3 mb-5">
                <div className="size-9 rounded-xl bg-[#10B981]/15 flex items-center justify-center">
                  <Lightbulb className="size-4.5 text-[#10B981]" />
                </div>
                <h3 className="text-lg font-bold text-white">High-Impact AI Opportunities</h3>
              </div>
              <div className="space-y-3">
                {props.highImpactAI.map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <CheckCircle2 className="size-5 text-[#10B981] flex-shrink-0 mt-0.5" />
                    <span className="text-gray-300 text-sm leading-relaxed">{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Should not automate */}
            <div className="bg-black/40 rounded-2xl border-l-4 border-[#FB923C] border border-white/10 p-7">
              <div className="flex items-center gap-3 mb-5">
                <div className="size-9 rounded-xl bg-[#FB923C]/15 flex items-center justify-center">
                  <Shield className="size-4.5 text-[#FB923C]" />
                </div>
                <h3 className="text-lg font-bold text-white">What Should NOT Be Automated</h3>
              </div>
              <div className="space-y-3">
                {props.shouldNotAutomate.map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <XCircle className="size-5 text-[#FB923C] flex-shrink-0 mt-0.5" />
                    <span className="text-gray-300 text-sm leading-relaxed">{item}</span>
                  </div>
                ))}
              </div>
              <div className="mt-6 pt-5 border-t border-white/10">
                <p className="text-xs text-gray-500 italic">
                  We're not here to automate everything — we're here to solve the right problems with precision.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          5B. COMPETITIVE LANDSCAPE (NEW)
      ══════════════════════════════════════════════════════════════════════ */}
      {props.competitiveLandscape && (
        <div id="report-competitive" className="page-break bg-[#0A0A0F] px-8 py-20">
          <div className="max-w-4xl mx-auto">
            <SectionLabel>Industry Context</SectionLabel>
            <h2 className="text-4xl font-bold text-white mb-3">How You Compare to Your Peers</h2>
            <p className="text-gray-500 mb-14 text-lg">Where you stand relative to similar businesses in your sector</p>

            {/* Peer comparison summary */}
            <div className="bg-gradient-to-br from-[#3B82F6]/10 to-[#06D7F6]/8 border border-[#3B82F6]/20 rounded-2xl p-8 mb-10">
              <div className="flex items-center gap-3 mb-4">
                <Users className="size-5 text-[#3B82F6]" />
                <h3 className="text-lg font-bold text-white">Peer Comparison</h3>
              </div>
              <p className="text-gray-300 leading-relaxed">{props.competitiveLandscape.peerComparison}</p>
            </div>

            {/* Benchmark cards */}
            <div className="space-y-4 mb-10">
              {props.competitiveLandscape.industryBenchmarks.map((bm, i) => {
                const posColor = bm.yourPosition === 'ahead' ? '#10B981' : bm.yourPosition === 'on-par' ? '#FB923C' : '#FD4438';
                const posLabel = bm.yourPosition === 'ahead' ? 'Ahead' : bm.yourPosition === 'on-par' ? 'On Par' : 'Behind';
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -12 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.06 }}
                    className="flex items-center gap-5 p-5 bg-white/5 rounded-xl border border-white/10"
                  >
                    <div
                      className="px-3 py-1 rounded-full text-xs font-bold flex-shrink-0"
                      style={{ backgroundColor: `${posColor}15`, color: posColor, border: `1px solid ${posColor}30` }}
                    >
                      {posLabel}
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-white text-sm">{bm.metric}</p>
                      <p className="text-gray-400 text-sm leading-relaxed mt-1">{bm.detail}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {/* Competitive window */}
            <div className="flex gap-4 items-start p-6 bg-[#3B82F6]/10 border border-[#3B82F6]/20 rounded-xl">
              <Clock className="size-5 text-[#3B82F6] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-[#3B82F6] uppercase tracking-wider mb-1.5">Competitive Window</p>
                <p className="text-gray-300 leading-relaxed">{props.competitiveLandscape.competitiveWindow}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          6. RECOMMENDED FIRST STEP
      ══════════════════════════════════════════════════════════════════════ */}
      <div id="report-first-step" className="page-break bg-[#0d0d14] px-8 py-20">
        <div className="max-w-4xl mx-auto">
          <SectionLabel>Recommendation</SectionLabel>
          <h2 className="text-4xl font-bold text-white mb-3">Where to Start (Safely)</h2>
          <p className="text-gray-500 mb-14 text-lg">The logical first move given everything we found</p>

          <div className="bg-gradient-to-br from-[#8B5CF6]/12 to-[#3B82F6]/8 border-2 border-[#8B5CF6]/25 rounded-2xl p-10">
            <div className="flex items-center gap-5 mb-8">
              <div className="size-16 rounded-2xl bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center shadow-lg shadow-[#8B5CF6]/25">
                <Target className="size-8 text-white" />
              </div>
              <div>
                <p className="text-xs text-[#8B5CF6] font-bold uppercase tracking-wider mb-1">Recommended First Service</p>
                <h3 className="text-2xl font-bold text-white">{props.recommendedService}</h3>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-8">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Why This Comes First</p>
                <p className="text-gray-300 leading-relaxed">{props.whyFirst}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">What It Unlocks Next</p>
                <p className="text-gray-300 leading-relaxed">{props.whatItUnlocks}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          6B. QUICK WINS (NEW)
      ══════════════════════════════════════════════════════════════════════ */}
      {props.quickWins && props.quickWins.length > 0 && (
        <div id="report-quick-wins" className="page-break bg-[#0A0A0F] px-8 py-20">
          <div className="max-w-4xl mx-auto">
            <SectionLabel>Quick Wins</SectionLabel>
            <h2 className="text-4xl font-bold text-white mb-3">Actions You Can Take This Week</h2>
            <p className="text-gray-500 mb-14 text-lg">Low-effort, high-impact moves you can start immediately — no engagement required</p>

            <div className="grid gap-5">
              {props.quickWins.map((win, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.06 }}
                  className="bg-black/40 rounded-2xl border border-white/10 p-7"
                >
                  <div className="flex items-start gap-5">
                    <div className="size-11 rounded-xl bg-gradient-to-br from-[#10B981] to-[#06D7F6] flex items-center justify-center flex-shrink-0">
                      <Rocket className="size-5 text-white" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <h3 className="font-bold text-white">{win.title}</h3>
                        <span
                          className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                            win.effort === 'low'
                              ? 'bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/30'
                              : 'bg-[#FB923C]/15 text-[#FB923C] border border-[#FB923C]/30'
                          }`}
                        >
                          {win.effort === 'low' ? 'Low Effort' : 'Medium Effort'}
                        </span>
                      </div>
                      <p className="text-gray-400 text-sm leading-relaxed mb-3">{win.description}</p>
                      <div className="flex items-center gap-2 text-sm">
                        <TrendingUp className="size-4 text-[#8B5CF6]" />
                        <span className="font-medium text-[#8B5CF6]">Expected Impact:</span>
                        <span className="text-gray-300">{win.expectedImpact}</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          7. IMPACT RANGE
      ══════════════════════════════════════════════════════════════════════ */}
      <div id="report-impact" className="page-break bg-[#0d0d14] px-8 py-20">
        <div className="max-w-4xl mx-auto">
          <SectionLabel>Expected Impact</SectionLabel>
          <h2 className="text-4xl font-bold text-white mb-3">What Businesses Like Yours Typically See</h2>
          <p className="text-gray-500 mb-14 text-lg">Conservative estimates based on your diagnostic profile</p>

          <div className="grid sm:grid-cols-3 gap-5 mb-8">
            {[
              {
                label: 'Hours Saved Per Month',
                value: props.impactRange.hoursSavedPerMonth,
                icon: Zap,
                color: '#3B82F6',
                bg: '#3B82F6',
              },
              {
                label: 'Cost Leakage Reduced',
                value: props.impactRange.costLeakageReduced,
                icon: DollarSign,
                color: '#10B981',
                bg: '#10B981',
              },
              {
                label: 'Revenue Acceleration',
                value: props.impactRange.revenueAcceleration,
                icon: TrendingUp,
                color: '#8B5CF6',
                bg: '#8B5CF6',
              },
            ].map(({ label, value, icon: Icon, color, bg }) => (
              <motion.div
                key={label}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="bg-black/40 rounded-2xl border border-white/10 p-7 text-center"
              >
                <div
                  className="size-12 rounded-xl flex items-center justify-center mx-auto mb-4"
                  style={{ backgroundColor: `${bg}18` }}
                >
                  <Icon className="size-6" style={{ color }} />
                </div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{label}</p>
                <p className="text-2xl font-black text-white leading-tight">{value}</p>
              </motion.div>
            ))}
          </div>

          <div className="p-5 bg-white/5 border border-white/10 rounded-xl">
            <p className="text-sm text-gray-500 italic text-center">{props.impactRange.disclaimer}</p>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          7B. IMPLEMENTATION TIMELINE (NEW)
      ══════════════════════════════════════════════════════════════════════ */}
      {props.implementationTimeline && (
        <div id="report-timeline" className="page-break bg-[#0A0A0F] px-8 py-20">
          <div className="max-w-4xl mx-auto">
            <SectionLabel>Implementation Roadmap</SectionLabel>
            <h2 className="text-4xl font-bold text-white mb-3">Your {props.implementationTimeline.totalDuration} Path Forward</h2>
            <p className="text-gray-500 mb-14 text-lg">A phased approach designed for minimal disruption and maximum momentum</p>

            <div className="relative">
              {/* Vertical timeline line */}
              <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gradient-to-b from-[#8B5CF6] via-[#3B82F6] to-[#06D7F6] hidden sm:block" />

              <div className="space-y-8">
                {props.implementationTimeline.phases.map((phase, i) => {
                  const phaseColors = ['#8B5CF6', '#3B82F6', '#06D7F6', '#10B981'];
                  const color = phaseColors[i % phaseColors.length];
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -16 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.1 }}
                      className="flex gap-6"
                    >
                      {/* Timeline dot */}
                      <div className="relative flex-shrink-0 hidden sm:flex">
                        <div
                          className="size-12 rounded-full flex items-center justify-center border-4 border-[#0A0A0F] shadow-lg z-10"
                          style={{ backgroundColor: color }}
                        >
                          <span className="text-white font-black text-sm">{i + 1}</span>
                        </div>
                      </div>

                      {/* Phase card */}
                      <div className="flex-1 bg-white/5 rounded-2xl border border-white/10 p-7">
                        <div className="flex items-center gap-3 mb-3 flex-wrap">
                          <h3 className="font-bold text-white text-lg">{phase.label}</h3>
                          <span
                            className="text-xs font-semibold px-3 py-1 rounded-full"
                            style={{ backgroundColor: `${color}15`, color, border: `1px solid ${color}30` }}
                          >
                            {phase.weeks}
                          </span>
                        </div>
                        <p className="text-gray-400 text-sm leading-relaxed mb-4">{phase.description}</p>
                        <div className="space-y-2">
                          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Key Milestones</p>
                          {phase.milestones.map((ms, j) => (
                            <div key={j} className="flex items-start gap-2.5">
                              <CheckCircle2 className="size-4 flex-shrink-0 mt-0.5" style={{ color }} />
                              <span className="text-sm text-gray-300">{ms}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          8. CTA
      ══════════════════════════════════════════════════════════════════════ */}
      <div
        id="report-cta"
        className="flex flex-col items-center justify-center bg-gradient-to-br from-[#0A0A0F] via-[#0f0f1e] to-[#1a1a2e] text-white px-8 py-24 text-center"
      >
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-2xl"
        >
          <div className="size-16 rounded-2xl bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center mx-auto mb-8 shadow-lg shadow-[#8B5CF6]/30">
            <Calendar className="size-8 text-white" />
          </div>

          <h2 className="text-5xl font-bold mb-5 tracking-tight">Next Step</h2>
          <p className="text-2xl text-gray-300 mb-5">
            Book a 30-minute Readiness Call to walk through this report.
          </p>
          <p className="text-gray-400 mb-10 text-lg leading-relaxed">
            We'll validate what we've identified, answer your questions, and map out a clear path forward. No pressure — if there's no fit, we'll say so.
          </p>

          <button
            onClick={handleCTA}
            className="no-print inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] hover:opacity-90 text-white rounded-xl text-lg font-bold transition-all shadow-lg shadow-[#8B5CF6]/30 mb-5"
          >
            <Calendar className="size-5" />
            Schedule Your Readiness Call
            <ArrowRight className="size-5" />
          </button>

          <div>
            <p className="text-gray-500 text-sm mb-6">No obligation. 30 minutes. Clear outcome.</p>
          </div>

          <div className="pt-8 border-t border-white/10 flex items-center justify-center gap-4 no-print">
            <button
              onClick={handlePrint}
              disabled={isExporting}
              className="flex items-center gap-2 px-5 py-2.5 bg-white/8 hover:bg-white/15 border border-white/15 text-white rounded-lg text-sm font-medium transition-all disabled:opacity-50"
            >
              {isExporting ? (
                <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25"/><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75"/></svg>
              ) : (
                <Download className="size-4" />
              )}
              {isExporting ? 'Generating PDF...' : 'Save as PDF'}
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// ── Helper sub-component ──────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 mb-4">
      <div className="size-1.5 rounded-full bg-[#8B5CF6]" />
      <span className="text-xs font-bold text-[#8B5CF6] uppercase tracking-widest">{children}</span>
    </div>
  );
}