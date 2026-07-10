/**
 * SCORE PAGE — Post-Diagnostic Instant Value
 *
 * Replaces the generic "Thank You" page.  After completing the 14-question
 * diagnostic, users immediately see:
 *   1. Animated AI Readiness Score reveal
 *   2. 3-5 personalised operational insights
 *   3. Primary bottleneck theme
 *   4. Dimension radar / bar visualisation
 *   5. Estimated ROI range
 *   6. CTA: "Book Your Readiness Call"
 *   7. Secondary CTA: "Get Full Report via Email"
 */

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Zap, TrendingUp, Clock, DollarSign, ArrowRight,
  CheckCircle2, AlertTriangle, BarChart3, Target,
  Calendar, Mail, Sparkles, ChevronDown,
  Activity, Shield, Layers,
} from 'lucide-react';
import type { InstantScoreResult, InstantInsight } from '@/app/utils/instantScoring';
import { InstantBookingOffer } from '@/app/components/InstantBooking';

// ── MARQ Cortex palette ──────────────────────────────────────────────────────────
const PURPLE = '#8B5CF6';
const BLUE   = '#3B82F6';
const CYAN   = '#06D7F6';
const ORANGE = '#FB923C';
const RED    = '#FD4438';
const GREEN  = '#10B981';

// ── Props ────────────────────────────────────────────────────────────────────

interface ScorePageProps {
  scoreResult: InstantScoreResult;
  contactInfo: {
    name: string;
    email: string;
    phone?: string;
    website?: string;
  };
  industry: string;
  isSubmitting?: boolean;
  onBackToHome: () => void;
  onBookCall?: () => void;
}

// ── Animated counter ─────────────────────────────────────────────────────────

function AnimatedScore({ target, duration = 2000 }: { target: number; duration?: number }) {
  const [current, setCurrent] = useState(0);
  const rafRef = useRef<number>();

  useEffect(() => {
    const start = performance.now();
    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setCurrent(Math.round(eased * target));
      if (progress < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);

  return <span>{current}</span>;
}

// ── Score ring SVG ───────────────────────────────────────────────────────────

function ScoreRing({ score, level }: { score: number; level: string }) {
  const radius = 90;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const gradientId = 'score-gradient';
  const ringColor =
    level === 'High' ? GREEN : level === 'Medium' ? ORANGE : RED;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="220" height="220" viewBox="0 0 220 220" className="transform -rotate-90 w-[180px] h-[180px] sm:w-[220px] sm:h-[220px]">
        {/* Background ring */}
        <circle
          cx="110" cy="110" r={radius}
          fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="14"
        />
        {/* Animated score ring */}
        <motion.circle
          cx="110" cy="110" r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 2, ease: 'easeOut', delay: 0.5 }}
        />
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={PURPLE} />
            <stop offset="50%" stopColor={BLUE} />
            <stop offset="100%" stopColor={ringColor} />
          </linearGradient>
        </defs>
      </svg>

      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-5xl sm:text-6xl font-bold text-white leading-none" style={{ fontFamily: 'Inter' }}>
          <AnimatedScore target={score} duration={2200} />
        </span>
        <span className="text-xs sm:text-sm text-white/50 mt-1">out of 100</span>
        <motion.span
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 2.3 }}
          className="mt-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider"
          style={{
            background: `${ringColor}20`,
            color: ringColor,
            border: `1px solid ${ringColor}40`,
          }}
        >
          {level} Readiness
        </motion.span>
      </div>
    </div>
  );
}

// ── Dimension bar ────────────────────────────────────────────────────────────

function DimensionBar({ label, value, color, delay }: { label: string; value: number; color: string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay }}
      className="space-y-1.5"
    >
      <div className="flex justify-between text-sm">
        <span className="text-white/70">{label}</span>
        <span className="font-semibold" style={{ color }}>{value}%</span>
      </div>
      <div className="h-2.5 bg-white/5 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${color}, ${color}90)` }}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 1.2, delay: delay + 0.2, ease: 'easeOut' }}
        />
      </div>
    </motion.div>
  );
}

// ── Insight card ─────────────────────────────────────────────────────────────

function InsightCard({ insight, index }: { insight: InstantInsight; index: number }) {
  const severityIcon = insight.severity === 'critical'
    ? <AlertTriangle className="size-4" />
    : insight.severity === 'high'
    ? <Zap className="size-4" />
    : <CheckCircle2 className="size-4" />;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 2.6 + index * 0.15 }}
      className="p-5 rounded-2xl border transition-colors hover:border-opacity-40"
      style={{
        background: `linear-gradient(135deg, ${insight.color}08, transparent)`,
        borderColor: `${insight.color}20`,
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="size-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${insight.color}15`, color: insight.color }}
        >
          {severityIcon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-1">
            <h4 className="font-bold text-white text-sm">{insight.title}</h4>
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase flex-shrink-0"
              style={{
                background: `${insight.color}15`,
                color: insight.color,
              }}
            >
              {insight.category}
            </span>
          </div>
          <p className="text-sm text-white/60 leading-relaxed">{insight.detail}</p>
        </div>
      </div>
    </motion.div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function ScorePage({
  scoreResult,
  contactInfo,
  industry,
  isSubmitting,
  onBackToHome,
}: ScorePageProps) {
  const [showBooking, setShowBooking] = useState(false);
  const [meetingBooked, setMeetingBooked] = useState(false);
  const [showAllInsights, setShowAllInsights] = useState(false);

  const {
    readinessScore,
    readinessLevel,
    insights,
    bottleneckTheme,
    dimensions,
    estimatedROI,
  } = scoreResult;

  const visibleInsights = showAllInsights ? insights : insights.slice(0, 3);

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white overflow-hidden">
      {/* Submitting overlay */}
      <AnimatePresence>
        {isSubmitting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center"
          >
            <div className="text-center">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                className="size-12 border-4 border-white/20 border-t-[#8B5CF6] rounded-full mx-auto mb-4"
              />
              <p className="text-white/70">Saving your responses...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12">

        {/* ── Header ── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-10"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 200, delay: 0.2 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#8B5CF6]/10 border border-[#8B5CF6]/30 mb-6"
          >
            <Sparkles className="size-4 text-[#8B5CF6]" />
            <span className="text-sm font-medium text-[#8B5CF6]" style={{ fontFamily: 'Inter' }}>
              Your AI Readiness Score
            </span>
          </motion.div>

          <h1
            className="text-3xl sm:text-5xl font-bold mb-3 bg-gradient-to-r from-white via-white/90 to-white/70 bg-clip-text text-transparent"
            style={{ fontFamily: 'Inter' }}
          >
            Here's Where You Stand
          </h1>
          <p className="text-lg text-white/50" style={{ fontFamily: 'Inter' }}>
            Based on your {industry || 'business'} diagnostic responses
          </p>
        </motion.div>

        {/* ── Score Ring ── */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3, type: 'spring' }}
          className="flex justify-center mb-12"
        >
          <ScoreRing score={readinessScore} level={readinessLevel} />
        </motion.div>

        {/* ── Dimension Bars ── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5 }}
          className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-12 p-6 rounded-2xl bg-black/40 border border-white/8"
        >
          <DimensionBar label="Operational Maturity" value={dimensions.operationalMaturity} color={PURPLE} delay={1.6} />
          <DimensionBar label="Automation Readiness" value={dimensions.automationReadiness} color={CYAN} delay={1.8} />
          <DimensionBar label="Scale Preparedness" value={dimensions.scaleReadiness} color={BLUE} delay={2.0} />
          <DimensionBar label="Urgency Level" value={dimensions.urgencyLevel} color={ORANGE} delay={2.2} />
        </motion.div>

        {/* ── Bottleneck Theme ── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 2.4 }}
          className="mb-10 p-5 sm:p-6 rounded-2xl border"
          style={{
            background: `linear-gradient(135deg, ${bottleneckTheme.color}08, transparent)`,
            borderColor: `${bottleneckTheme.color}25`,
          }}
        >
          <div className="flex flex-col sm:flex-row items-start gap-3 sm:gap-4">
            <div
              className="size-12 sm:size-14 rounded-2xl flex items-center justify-center text-xl sm:text-2xl flex-shrink-0"
              style={{ background: `${bottleneckTheme.color}15` }}
            >
              {bottleneckTheme.icon}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: bottleneckTheme.color }}>
                Primary Bottleneck
              </p>
              <h3 className="text-lg sm:text-xl font-bold text-white mb-2" style={{ fontFamily: 'Inter' }}>
                {bottleneckTheme.label}
              </h3>
              <p className="text-sm text-white/60 leading-relaxed">{bottleneckTheme.description}</p>
            </div>
          </div>
        </motion.div>

        {/* ── Personalised Insights ── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2.5 }}
          className="mb-10"
        >
          <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3" style={{ fontFamily: 'Inter' }}>
            <Target className="size-6 text-[#06D7F6]" />
            Your Operational Insights
          </h2>
          <div className="space-y-4">
            {visibleInsights.map((insight, i) => (
              <InsightCard key={`${insight.category}-${i}`} insight={insight} index={i} />
            ))}
          </div>
          {insights.length > 3 && !showAllInsights && (
            <button
              onClick={() => setShowAllInsights(true)}
              className="mt-4 flex items-center gap-2 text-sm text-white/50 hover:text-white/80 transition-colors mx-auto"
            >
              Show more insights <ChevronDown className="size-4" />
            </button>
          )}
        </motion.div>

        {/* ── ROI Estimate ── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 3.0 }}
          className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-12"
        >
          <ROICard
            icon={<Clock className="size-5" />}
            label="Est. Time Savings"
            value={`${estimatedROI.timeSavingsHoursPerWeek} hrs/wk`}
            color={CYAN}
          />
          <ROICard
            icon={<TrendingUp className="size-5" />}
            label="Cost Reduction"
            value={estimatedROI.costReductionPercent}
            color={GREEN}
          />
          <ROICard
            icon={<DollarSign className="size-5" />}
            label="Revenue Impact"
            value={estimatedROI.revenueImpactPercent}
            color={ORANGE}
          />
        </motion.div>

        {/* ── CTA: Book Your Readiness Call ── */}
        {!meetingBooked && !showBooking && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 3.3 }}
            className="mb-10"
          >
            <div className="bg-gradient-to-br from-[#8B5CF6]/15 via-[#3B82F6]/10 to-[#06D7F6]/15 border-2 border-[#8B5CF6]/30 rounded-2xl p-6 sm:p-8 text-center">
              <h2 className="text-2xl sm:text-3xl font-bold mb-3" style={{ fontFamily: 'Inter' }}>
                Ready to Unlock Your Score&apos;s Full Potential?
              </h2>
              <p className="text-sm sm:text-base text-white/60 mb-6 max-w-lg mx-auto">
                In a 30-minute Readiness Call, we&apos;ll walk through your insights, explore quick wins,
                and map a 90-day plan tailored to your {industry || 'business'}.
              </p>

              <motion.button
                whileHover={{ scale: 1.04, y: -2 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setShowBooking(true)}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-3 px-6 sm:px-8 py-4 bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] rounded-xl text-base sm:text-lg font-bold hover:shadow-2xl hover:shadow-[#8B5CF6]/40 transition-all"
                style={{ fontFamily: 'Inter' }}
              >
                <Calendar className="size-5" />
                Book Your Readiness Call
                <ArrowRight className="size-5" />
              </motion.button>

              <p className="mt-4 text-xs text-white/40">Free &bull; 30 minutes &bull; No commitment</p>
            </div>
          </motion.div>
        )}

        {/* Booking widget */}
        {showBooking && !meetingBooked && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mb-10"
          >
            <InstantBookingOffer
              contactInfo={{
                name: contactInfo.name,
                email: contactInfo.email,
                companyName: contactInfo.website || 'Your Company',
              }}
              onBooked={async () => setMeetingBooked(true)}
            />
          </motion.div>
        )}

        {/* Booking confirmed */}
        {meetingBooked && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-10 p-8 rounded-2xl bg-gradient-to-br from-[#10B981]/15 to-[#06D7F6]/15 border-2 border-[#10B981]/30 text-center"
          >
            <CheckCircle2 className="size-12 text-[#10B981] mx-auto mb-4" />
            <h3 className="text-2xl font-bold mb-2">Call Booked!</h3>
            <p className="text-white/60">
              We'll prepare a detailed analysis of your score before the call.
              Check <strong className="text-[#06D7F6]">{contactInfo.email}</strong> for confirmation.
            </p>
          </motion.div>
        )}

        {/* ── Email confirmation ── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 3.5 }}
          className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-[#8B5CF6]/10 to-[#3B82F6]/10 border border-[#8B5CF6]/20 mb-8"
        >
          <div className="flex flex-col sm:flex-row items-start gap-3 sm:gap-4">
            <div className="size-10 sm:size-11 rounded-xl bg-[#8B5CF6]/20 flex items-center justify-center flex-shrink-0">
              <Mail className="size-5 text-[#8B5CF6]" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-white mb-1 text-sm sm:text-base" style={{ fontFamily: 'Inter' }}>Your Full Report is Being Prepared</h3>
              <p className="text-xs sm:text-sm text-white/60 break-words">
                Our AI engine (CORTEX) is running a deeper analysis on your responses. You&apos;ll receive the
                full report at <strong className="text-[#06D7F6]">{contactInfo.email}</strong> within 4-6 hours.
              </p>
            </div>
          </div>
        </motion.div>

        {/* ── What's Next ── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 3.7 }}
          className="p-6 rounded-2xl bg-black/40 border border-white/8 mb-8"
        >
          <h3 className="text-lg font-bold mb-5 flex items-center gap-2" style={{ fontFamily: 'Inter' }}>
            <Layers className="size-5 text-[#3B82F6]" />
            What Happens Next
          </h3>
          <div className="space-y-4">
            {[
              { n: 1, title: 'CORTEX deep analysis running', desc: 'Our AI is cross-referencing your answers against industry benchmarks', time: 'Now', color: PURPLE },
              { n: 2, title: 'Human expert review', desc: 'A team member quality-checks the analysis for accuracy', time: '4-6 hours', color: BLUE },
              { n: 3, title: 'Full report delivered', desc: 'Detailed PDF with recommendations sent to your email', time: 'Same day', color: CYAN },
              { n: 4, title: 'Readiness Call', desc: 'Walk through opportunities and build your 90-day plan', time: 'You choose', color: GREEN },
            ].map((step) => (
              <div key={step.n} className="flex gap-4 items-start">
                <div
                  className="size-9 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
                  style={{ background: `${step.color}15`, color: step.color, border: `1px solid ${step.color}30` }}
                >
                  {step.n}
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-white text-sm">{step.title}</h4>
                  <p className="text-xs text-white/50">{step.desc}</p>
                </div>
                <span className="text-xs font-medium whitespace-nowrap" style={{ color: step.color }}>{step.time}</span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* ── Footer actions ── */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mt-8 mb-4">
          <button
            onClick={onBackToHome}
            className="px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-semibold transition-all text-sm"
            style={{ fontFamily: 'Inter' }}
          >
            Back to Home
          </button>
        </div>

        <p className="text-xs text-white/30 text-center mt-6 mb-4" style={{ fontFamily: 'Inter' }}>
          Questions?{' '}
          <a href="mailto:support@marqcortex.com" className="text-[#06D7F6] hover:underline">
            Contact support
          </a>
        </p>
      </div>
    </div>
  );
}

// ── ROI card sub-component ───────────────────────────────────────────────────

function ROICard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div
      className="p-5 rounded-2xl border text-center"
      style={{ background: `${color}06`, borderColor: `${color}18` }}
    >
      <div className="inline-flex items-center justify-center size-10 rounded-xl mb-3" style={{ background: `${color}15`, color }}>
        {icon}
      </div>
      <p className="text-2xl font-bold text-white mb-1" style={{ fontFamily: 'Inter' }}>{value}</p>
      <p className="text-xs text-white/50">{label}</p>
    </div>
  );
}