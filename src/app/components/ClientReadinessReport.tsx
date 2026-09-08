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
import { brand, status } from '@/app/lib/tokens';

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
  High:   status.success,
  Medium: status.warning,
  Low:    status.danger,
};

const HEAT_COLOURS: Record<string, string> = {
  green:  status.success,
  yellow: status.warning,
  red:    status.danger,
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
    <div ref={reportRef} className="bg-cortex-canvas text-gray-100 font-[Inter,sans-serif]">
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
        className="no-print fixed top-0 left-0 right-0 z-50 bg-cortex-canvas/95 backdrop-blur-xl border-b border-cortex-default shadow-sm"
      >
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          {/* Brand + company */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="size-7 rounded-cortex-sm bg-gradient-to-br from-cortex-accent to-cortex-accent-alt flex items-center justify-center">
              <Brain className="size-3.5 text-white" />
            </div>
            <span className="font-bold text-white text-sm hidden sm:block">{props.companyName}</span>
            <span className="hidden sm:block text-cortex-faint">·</span>
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
                    ? 'bg-cortex-accent/20 text-cortex-accent'
                    : 'text-cortex-muted hover:text-white hover:bg-cortex-control'
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
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/8 hover:bg-white/15 text-cortex-secondary rounded-cortex-sm text-xs font-medium transition-all disabled:opacity-50"
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
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-cortex-accent to-cortex-accent-alt text-white rounded-cortex-sm text-xs font-semibold transition-all hover:opacity-90"
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
        className="flex flex-col items-center justify-center bg-gradient-to-br from-cortex-canvas via-cortex-overlay to-cortex-overlay text-white px-8 py-24"
      >
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-3xl text-center"
        >
          {/* Brand mark */}
          <div className="flex items-center justify-center gap-3 mb-14">
            <div className="size-14 rounded-cortex-lg bg-gradient-to-br from-cortex-accent to-cortex-accent-alt flex items-center justify-center shadow-lg shadow-cortex-accent/30">
              <Brain className="size-7 text-white" />
            </div>
            <div className="text-left">
              <div className="font-bold text-white text-lg leading-tight">MARQ Cortex</div>
              <div className="text-cortex-muted text-xs">Operational Intelligence</div>
            </div>
          </div>

          {/* Badge */}
          <div className="inline-block px-4 py-1.5 bg-gradient-to-r from-cortex-accent/30 to-cortex-accent-alt/30 border border-cortex-accent/40 rounded-full text-sm font-semibold text-cortex-accent-light mb-4 tracking-wide uppercase">
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
          {/* `h2`, not `h1`: this renders INSIDE the client portal, whose
              header already carries the page's `h1` (the company name). Two
              `h1`s in one document give a screen reader two page titles and no
              way to tell which one names the page. */}
          <h2 className="text-5xl md:text-7xl font-bold mb-5 tracking-tight leading-none">
            {props.companyName}
          </h2>

          {/* Subtitle */}
          <p className="text-xl text-cortex-secondary mb-10">
            An AI Readiness & Operations Diagnostic
          </p>

          {/* Meta chips */}
          <div className="flex items-center justify-center gap-3 flex-wrap mb-14 text-sm">
            <span className="px-4 py-1.5 bg-white/8 border border-white/15 rounded-full text-cortex-secondary">
              {props.industry}
            </span>
            <span className="px-4 py-1.5 bg-white/8 border border-white/15 rounded-full text-cortex-secondary">
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
            className="no-print flex flex-col items-center gap-2 text-cortex-muted hover:text-cortex-secondary transition-colors mx-auto"
          >
            <span className="text-xs uppercase tracking-widest">Read Report</span>
            <ChevronDown className="size-5 animate-bounce" />
          </button>

          <div className="mt-14 pt-8 border-t border-cortex-default">
            <p className="text-sm text-cortex-muted italic">
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
      <div id="report-executive" className="page-break bg-cortex-canvas px-8 py-20">
        <div className="max-w-4xl mx-auto">
          <SectionLabel>Executive Snapshot</SectionLabel>
          <h2 className="text-4xl font-bold text-white mb-3">Your Operational Readiness</h2>
          <p className="text-cortex-muted mb-14 text-lg">A clear-eyed view of where you stand right now</p>

          {/* Readiness score + interpretation */}
          <div
            className="flex gap-8 items-start p-8 rounded-cortex-lg mb-10 border"
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
              <p className="text-cortex-secondary text-lg leading-relaxed">{props.readinessInterpretation}</p>
            </div>
          </div>

          {/* What this means */}
          <h3 className="text-xl font-bold text-white mb-5">What This Means for You</h3>
          <div className="grid gap-3 mb-10">
            {props.whatThisMeans.map((point, i) => (
              <div key={i} className="flex items-start gap-4 p-5 bg-cortex-control rounded-cortex-md border border-cortex-default">
                <div className="size-8 rounded-full bg-gradient-to-br from-cortex-accent to-cortex-accent-alt text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                  {i + 1}
                </div>
                <p className="text-cortex-secondary text-base leading-relaxed">{point}</p>
              </div>
            ))}
          </div>

          {/* Immediate risk */}
          <div className="flex gap-4 items-start p-6 bg-cortex-danger/10 border border-cortex-danger/25 rounded-cortex-md">
            <AlertTriangle className="size-6 text-cortex-danger flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-cortex-danger uppercase tracking-wider mb-1.5">Immediate Risk</p>
              <p className="text-cortex-secondary leading-relaxed">{props.immediateRisk}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          3. CORE DIAGNOSIS
      ══════════════════════════════════════════════════════════════════════ */}
      <div id="report-diagnosis" className="page-break bg-cortex-overlay px-8 py-20">
        <div className="max-w-4xl mx-auto">
          <SectionLabel>Core Diagnosis</SectionLabel>
          <h2 className="text-4xl font-bold text-white mb-3">What's Slowing You Down Right Now</h2>
          <p className="text-cortex-muted mb-14 text-lg">The core constraints identified through your diagnostic</p>

          <div className="space-y-8">
            {props.coreIssues.map((issue, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: idx * 0.08 }}
                className="bg-cortex-raised rounded-cortex-lg border border-cortex-default overflow-hidden"
              >
                {/* Issue header bar */}
                <div className="flex items-center gap-4 px-8 pt-8 pb-5">
                  <div className="size-11 rounded-full bg-gradient-to-br from-cortex-danger to-cortex-warning text-white flex items-center justify-center font-black text-lg flex-shrink-0">
                    {idx + 1}
                  </div>
                  <h3 className="text-2xl font-bold text-white">{issue.title}</h3>
                </div>

                <div className="px-8 pb-8 space-y-6">
                  <p className="text-cortex-secondary text-base leading-relaxed">{issue.problem}</p>

                  <div className="bg-cortex-warning/10 border border-cortex-warning/20 rounded-cortex-md p-5">
                    <p className="text-xs font-bold text-cortex-warning uppercase tracking-wider mb-2">Why It Exists</p>
                    <p className="text-cortex-secondary text-sm leading-relaxed">{issue.whyItExists}</p>
                  </div>

                  <div>
                    <p className="text-xs font-bold text-cortex-muted uppercase tracking-wider mb-3">Business Impact</p>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {issue.businessImpact.map((impact, j) => (
                        <div key={j} className="flex items-start gap-2.5 p-3 bg-cortex-control rounded-cortex-sm">
                          <div className="size-1.5 rounded-full bg-cortex-danger flex-shrink-0 mt-1.5" />
                          <span className="text-cortex-secondary text-sm leading-relaxed">{impact}</span>
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
      <div id="report-heatmap" className="page-break bg-cortex-canvas px-8 py-20">
        <div className="max-w-4xl mx-auto">
          <SectionLabel>Operational Heatmap</SectionLabel>
          <h2 className="text-4xl font-bold text-white mb-3">Where You Stand Across Four Areas</h2>
          <p className="text-cortex-muted mb-14 text-lg">A colour-coded view of your operational landscape</p>

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
                  className="p-6 bg-cortex-control border border-cortex-default rounded-cortex-lg"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="size-9 rounded-cortex-md flex items-center justify-center" style={{ backgroundColor: `${col}18` }}>
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
                  <p className="text-sm text-cortex-muted leading-relaxed">{data.explanation}</p>
                </motion.div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center justify-center gap-6 pt-6 border-t border-cortex-default">
            {[
              { color: status.danger, label: 'Immediate Attention' },
              { color: status.warning, label: 'Near-Term Priority' },
              { color: status.success, label: 'Stable' },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-2">
                <div className="size-3 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-sm text-cortex-muted">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          5. WHAT AI CAN FIX
      ══════════════════════════════════════════════════════════════════════ */}
      <div id="report-ai" className="page-break bg-cortex-overlay px-8 py-20">
        <div className="max-w-4xl mx-auto">
          <SectionLabel>AI Analysis</SectionLabel>
          <h2 className="text-4xl font-bold text-white mb-3">What AI Can Fix — And What It Shouldn't</h2>
          <p className="text-cortex-muted mb-14 text-lg">Cutting through the hype to show you what's real</p>

          <div className="grid sm:grid-cols-2 gap-6">
            {/* High-impact */}
            <div className="bg-cortex-raised rounded-cortex-lg border-l-4 border-cortex-success border border-cortex-default p-7">
              <div className="flex items-center gap-3 mb-5">
                <div className="size-9 rounded-cortex-md bg-cortex-success/15 flex items-center justify-center">
                  <Lightbulb className="size-4.5 text-cortex-success" />
                </div>
                <h3 className="text-lg font-bold text-white">High-Impact AI Opportunities</h3>
              </div>
              <div className="space-y-3">
                {props.highImpactAI.map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <CheckCircle2 className="size-5 text-cortex-success flex-shrink-0 mt-0.5" />
                    <span className="text-cortex-secondary text-sm leading-relaxed">{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Should not automate */}
            <div className="bg-cortex-raised rounded-cortex-lg border-l-4 border-cortex-warning border border-cortex-default p-7">
              <div className="flex items-center gap-3 mb-5">
                <div className="size-9 rounded-cortex-md bg-cortex-warning/15 flex items-center justify-center">
                  <Shield className="size-4.5 text-cortex-warning" />
                </div>
                <h3 className="text-lg font-bold text-white">What Should NOT Be Automated</h3>
              </div>
              <div className="space-y-3">
                {props.shouldNotAutomate.map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <XCircle className="size-5 text-cortex-warning flex-shrink-0 mt-0.5" />
                    <span className="text-cortex-secondary text-sm leading-relaxed">{item}</span>
                  </div>
                ))}
              </div>
              <div className="mt-6 pt-5 border-t border-cortex-default">
                <p className="text-xs text-cortex-muted italic">
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
        <div id="report-competitive" className="page-break bg-cortex-canvas px-8 py-20">
          <div className="max-w-4xl mx-auto">
            <SectionLabel>Industry Context</SectionLabel>
            <h2 className="text-4xl font-bold text-white mb-3">How You Compare to Your Peers</h2>
            <p className="text-cortex-muted mb-14 text-lg">Where you stand relative to similar businesses in your sector</p>

            {/* Peer comparison summary */}
            <div className="bg-gradient-to-br from-cortex-accent-alt/10 to-cortex-info/8 border border-cortex-accent-alt/20 rounded-cortex-lg p-8 mb-10">
              <div className="flex items-center gap-3 mb-4">
                <Users className="size-5 text-cortex-accent-alt" />
                <h3 className="text-lg font-bold text-white">Peer Comparison</h3>
              </div>
              <p className="text-cortex-secondary leading-relaxed">{props.competitiveLandscape.peerComparison}</p>
            </div>

            {/* Benchmark cards */}
            <div className="space-y-4 mb-10">
              {props.competitiveLandscape.industryBenchmarks.map((bm, i) => {
                const posColor = bm.yourPosition === 'ahead' ? status.success : bm.yourPosition === 'on-par' ? status.warning : status.danger;
                const posLabel = bm.yourPosition === 'ahead' ? 'Ahead' : bm.yourPosition === 'on-par' ? 'On Par' : 'Behind';
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -12 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.06 }}
                    className="flex items-center gap-5 p-5 bg-cortex-control rounded-cortex-md border border-cortex-default"
                  >
                    <div
                      className="px-3 py-1 rounded-full text-xs font-bold flex-shrink-0"
                      style={{ backgroundColor: `${posColor}15`, color: posColor, border: `1px solid ${posColor}30` }}
                    >
                      {posLabel}
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-white text-sm">{bm.metric}</p>
                      <p className="text-cortex-muted text-sm leading-relaxed mt-1">{bm.detail}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {/* Competitive window */}
            <div className="flex gap-4 items-start p-6 bg-cortex-accent-alt/10 border border-cortex-accent-alt/20 rounded-cortex-md">
              <Clock className="size-5 text-cortex-accent-alt flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-cortex-accent-alt uppercase tracking-wider mb-1.5">Competitive Window</p>
                <p className="text-cortex-secondary leading-relaxed">{props.competitiveLandscape.competitiveWindow}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          6. RECOMMENDED FIRST STEP
      ══════════════════════════════════════════════════════════════════════ */}
      <div id="report-first-step" className="page-break bg-cortex-overlay px-8 py-20">
        <div className="max-w-4xl mx-auto">
          <SectionLabel>Recommendation</SectionLabel>
          <h2 className="text-4xl font-bold text-white mb-3">Where to Start (Safely)</h2>
          <p className="text-cortex-muted mb-14 text-lg">The logical first move given everything we found</p>

          <div className="bg-gradient-to-br from-cortex-accent/12 to-cortex-accent-alt/8 border-2 border-cortex-accent/25 rounded-cortex-lg p-10">
            <div className="flex items-center gap-5 mb-8">
              <div className="size-16 rounded-cortex-lg bg-gradient-to-br from-cortex-accent to-cortex-accent-alt flex items-center justify-center shadow-lg shadow-cortex-accent/25">
                <Target className="size-8 text-white" />
              </div>
              <div>
                <p className="text-xs text-cortex-accent font-bold uppercase tracking-wider mb-1">Recommended First Service</p>
                <h3 className="text-2xl font-bold text-white">{props.recommendedService}</h3>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-8">
              <div>
                <p className="text-xs font-bold text-cortex-muted uppercase tracking-wider mb-3">Why This Comes First</p>
                <p className="text-cortex-secondary leading-relaxed">{props.whyFirst}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-cortex-muted uppercase tracking-wider mb-3">What It Unlocks Next</p>
                <p className="text-cortex-secondary leading-relaxed">{props.whatItUnlocks}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          6B. QUICK WINS (NEW)
      ══════════════════════════════════════════════════════════════════════ */}
      {props.quickWins && props.quickWins.length > 0 && (
        <div id="report-quick-wins" className="page-break bg-cortex-canvas px-8 py-20">
          <div className="max-w-4xl mx-auto">
            <SectionLabel>Quick Wins</SectionLabel>
            <h2 className="text-4xl font-bold text-white mb-3">Actions You Can Take This Week</h2>
            <p className="text-cortex-muted mb-14 text-lg">Low-effort, high-impact moves you can start immediately — no engagement required</p>

            <div className="grid gap-5">
              {props.quickWins.map((win, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.06 }}
                  className="bg-cortex-raised rounded-cortex-lg border border-cortex-default p-7"
                >
                  <div className="flex items-start gap-5">
                    <div className="size-11 rounded-cortex-md bg-gradient-to-br from-cortex-success to-cortex-info flex items-center justify-center flex-shrink-0">
                      <Rocket className="size-5 text-white" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <h3 className="font-bold text-white">{win.title}</h3>
                        <span
                          className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                            win.effort === 'low'
                              ? 'bg-cortex-success/15 text-cortex-success border border-cortex-success/30'
                              : 'bg-cortex-warning/15 text-cortex-warning border border-cortex-warning/30'
                          }`}
                        >
                          {win.effort === 'low' ? 'Low Effort' : 'Medium Effort'}
                        </span>
                      </div>
                      <p className="text-cortex-muted text-sm leading-relaxed mb-3">{win.description}</p>
                      <div className="flex items-center gap-2 text-sm">
                        <TrendingUp className="size-4 text-cortex-accent" />
                        <span className="font-medium text-cortex-accent">Expected Impact:</span>
                        <span className="text-cortex-secondary">{win.expectedImpact}</span>
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
      <div id="report-impact" className="page-break bg-cortex-overlay px-8 py-20">
        <div className="max-w-4xl mx-auto">
          <SectionLabel>Expected Impact</SectionLabel>
          <h2 className="text-4xl font-bold text-white mb-3">What Businesses Like Yours Typically See</h2>
          <p className="text-cortex-muted mb-14 text-lg">Conservative estimates based on your diagnostic profile</p>

          <div className="grid sm:grid-cols-3 gap-5 mb-8">
            {[
              {
                label: 'Hours Saved Per Month',
                value: props.impactRange.hoursSavedPerMonth,
                icon: Zap,
                color: brand.accentAlt,
                bg: brand.accentAlt,
              },
              {
                label: 'Cost Leakage Reduced',
                value: props.impactRange.costLeakageReduced,
                icon: DollarSign,
                color: status.success,
                bg: status.success,
              },
              {
                label: 'Revenue Acceleration',
                value: props.impactRange.revenueAcceleration,
                icon: TrendingUp,
                color: brand.accent,
                bg: brand.accent,
              },
            ].map(({ label, value, icon: Icon, color, bg }) => (
              <motion.div
                key={label}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="bg-cortex-raised rounded-cortex-lg border border-cortex-default p-7 text-center"
              >
                <div
                  className="size-12 rounded-cortex-md flex items-center justify-center mx-auto mb-4"
                  style={{ backgroundColor: `${bg}18` }}
                >
                  <Icon className="size-6" style={{ color }} />
                </div>
                <p className="text-xs font-bold text-cortex-muted uppercase tracking-wider mb-2">{label}</p>
                <p className="text-2xl font-black text-white leading-tight">{value}</p>
              </motion.div>
            ))}
          </div>

          <div className="p-5 bg-cortex-control border border-cortex-default rounded-cortex-md">
            <p className="text-sm text-cortex-muted italic text-center">{props.impactRange.disclaimer}</p>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          7B. IMPLEMENTATION TIMELINE (NEW)
      ══════════════════════════════════════════════════════════════════════ */}
      {props.implementationTimeline && (
        <div id="report-timeline" className="page-break bg-cortex-canvas px-8 py-20">
          <div className="max-w-4xl mx-auto">
            <SectionLabel>Implementation Roadmap</SectionLabel>
            <h2 className="text-4xl font-bold text-white mb-3">Your {props.implementationTimeline.totalDuration} Path Forward</h2>
            <p className="text-cortex-muted mb-14 text-lg">A phased approach designed for minimal disruption and maximum momentum</p>

            <div className="relative">
              {/* Vertical timeline line */}
              <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gradient-to-b from-cortex-accent via-cortex-accent-alt to-cortex-info hidden sm:block" />

              <div className="space-y-8">
                {props.implementationTimeline.phases.map((phase, i) => {
                  const phaseColors = [brand.accent, brand.accentAlt, status.info, status.success];
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
                          className="size-12 rounded-full flex items-center justify-center border-4 border-cortex-canvas shadow-lg z-10"
                          style={{ backgroundColor: color }}
                        >
                          <span className="text-white font-black text-sm">{i + 1}</span>
                        </div>
                      </div>

                      {/* Phase card */}
                      <div className="flex-1 bg-cortex-control rounded-cortex-lg border border-cortex-default p-7">
                        <div className="flex items-center gap-3 mb-3 flex-wrap">
                          <h3 className="font-bold text-white text-lg">{phase.label}</h3>
                          <span
                            className="text-xs font-semibold px-3 py-1 rounded-full"
                            style={{ backgroundColor: `${color}15`, color, border: `1px solid ${color}30` }}
                          >
                            {phase.weeks}
                          </span>
                        </div>
                        <p className="text-cortex-muted text-sm leading-relaxed mb-4">{phase.description}</p>
                        <div className="space-y-2">
                          <p className="text-xs font-bold text-cortex-muted uppercase tracking-wider">Key Milestones</p>
                          {phase.milestones.map((ms, j) => (
                            <div key={j} className="flex items-start gap-2.5">
                              <CheckCircle2 className="size-4 flex-shrink-0 mt-0.5" style={{ color }} />
                              <span className="text-sm text-cortex-secondary">{ms}</span>
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
        className="flex flex-col items-center justify-center bg-gradient-to-br from-cortex-canvas via-cortex-overlay to-cortex-overlay text-white px-8 py-24 text-center"
      >
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-2xl"
        >
          <div className="size-16 rounded-cortex-lg bg-gradient-to-br from-cortex-accent to-cortex-accent-alt flex items-center justify-center mx-auto mb-8 shadow-lg shadow-cortex-accent/30">
            <Calendar className="size-8 text-white" />
          </div>

          <h2 className="text-5xl font-bold mb-5 tracking-tight">Next Step</h2>
          <p className="text-2xl text-cortex-secondary mb-5">
            Book a 30-minute Readiness Call to walk through this report.
          </p>
          <p className="text-cortex-muted mb-10 text-lg leading-relaxed">
            We'll validate what we've identified, answer your questions, and map out a clear path forward. No pressure — if there's no fit, we'll say so.
          </p>

          <button
            onClick={handleCTA}
            className="no-print inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-cortex-accent to-cortex-accent-alt hover:opacity-90 text-white rounded-cortex-md text-lg font-bold transition-all shadow-lg shadow-cortex-accent/30 mb-5"
          >
            <Calendar className="size-5" />
            Schedule Your Readiness Call
            <ArrowRight className="size-5" />
          </button>

          <div>
            <p className="text-cortex-muted text-sm mb-6">No obligation. 30 minutes. Clear outcome.</p>
          </div>

          <div className="pt-8 border-t border-cortex-default flex items-center justify-center gap-4 no-print">
            <button
              onClick={handlePrint}
              disabled={isExporting}
              className="flex items-center gap-2 px-5 py-2.5 bg-white/8 hover:bg-white/15 border border-white/15 text-white rounded-cortex-sm text-sm font-medium transition-all disabled:opacity-50"
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
      <div className="size-1.5 rounded-full bg-cortex-accent" />
      <span className="text-xs font-bold text-cortex-accent uppercase tracking-widest">{children}</span>
    </div>
  );
}