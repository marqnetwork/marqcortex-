/**
 * CORTEX DASHBOARD - DETAIL SECTIONS
 * Part 2: All the detail view sections
 *
 * Diagnostic tab follows the 7-section structure:
 *   A. Executive Diagnostic Overview
 *   B. Primary Bottleneck Deep Dive
 *   C. Cross-System Patterns
 *   D. Operational Pillar Matrix
 *   E. Financial & Efficiency Model
 *   F. Operational Risk Assessment
 *   G. Full Diagnostic Transcript
 */

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Edit3,
  Target,
  Zap,
  DollarSign,
  Phone,
  FileText,
  TrendingUp,
  TrendingDown,
  Clock,
  Lightbulb,
  Shield,
  BarChart3,
  Calendar,
  Send,
  Brain,
  Activity,
  ChevronDown,
  ChevronRight,
  Layers,
  Network,
  Eye,
  EyeOff,
  Filter,
  ArrowRight,
  GitBranch,
  Gauge,
  Users,
  Info,
  FileCheck,
  X,
  RefreshCw,
} from 'lucide-react';
import { getPillarColor } from '@/app/types/cortex-types';
import type {
  CortexLeadData, BottleneckDeepDive, SystemicPattern, EnhancedRiskFlag,
  PillarInterpretation, ConfidenceLayer, ProposalDraft, DiagnosisSeverity,
} from '@/app/types/cortex-types';
import { QATranscriptSheet, SourceAnswersBadge } from '@/app/components/QATranscriptSheet';
import { revertToVersion } from '@/app/core/versionEngine';
import { SolutionBlueprintView } from '@/app/components/SolutionBlueprint';
import { EnhancedROIView } from '@/app/components/EnhancedROI';
import { ROIExecutiveDashboard } from '@/app/components/ROIExecutiveDashboard';
import type { ROIAnalysisData } from '@/app/components/ROIExecutiveDashboard';
import { ROIAssumptionsEditor } from '@/app/components/ROIAssumptionsEditor';
import { DCFPanel } from '@/app/components/DCFPanel';
import { MonteCarloPanel } from '@/app/components/MonteCarloPanel';
import { ScenarioPanel } from '@/app/components/ScenarioPanel';
import { ROITabLayout } from '@/app/components/ROITabLayout';
import { ProposalDraftEditor } from '@/app/components/ProposalDraftEditor';
import roiAnalysisJSON from '@/imports/roi-analysis.json';
import { AIToolbar } from '@/app/components/InlineAITrigger';

// ── Colour maps ──────────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
  Critical: '#FD4438', High: '#FB923C', Moderate: '#3B82F6', Low: '#10B981',
  critical: '#FD4438', high: '#FB923C', medium: '#3B82F6', moderate: '#3B82F6',
};

const PRIORITY_COLORS: Record<string, string> = {
  Critical: '#FD4438', Immediate: '#FD4438', High: '#FB923C', Moderate: '#3B82F6',
};

const CATEGORY_COLORS: Record<string, string> = {
  Revenue: '#10B981', Operations: '#8B5CF6', Governance: '#FB923C', Compliance: '#3B82F6',
  Ops: '#8B5CF6', Risk: '#FD4438',
};

const RISK_TYPE_COLORS: Record<string, string> = {
  Scalability: '#FD4438', Data: '#FB923C', Dependency: '#8B5CF6', Compliance: '#3B82F6',
};

const GROWTH_RISK_COLORS: Record<string, string> = {
  Critical: '#FD4438', Elevated: '#FB923C', Moderate: '#3B82F6', Low: '#10B981',
};

const READINESS_CAT_COLORS: Record<string, string> = {
  Manual: '#FD4438', Fragmented: '#FB923C', Transitional: '#3B82F6', Structured: '#10B981',
};

// ============================================================================
// 2️⃣ DIAGNOSTIC SUMMARY SECTION — NEW 7-SECTION LAYOUT
// ============================================================================

export function DiagnosticSummarySection({ data }: { data: CortexLeadData }) {
  const [highlightQuestion, setHighlightQuestion] = useState<number | null>(null);
  const [showTranscript, setShowTranscript] = useState(false); // collapsed by default per spec
  const [transcriptFilter, setTranscriptFilter] = useState<string | null>(null);

  const scrollToAnswer = (qId: number) => {
    setHighlightQuestion(qId);
    setShowTranscript(true);
    setTimeout(() => {
      const el = document.getElementById(`qa-answer-${qId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => setHighlightQuestion(null), 3000);
    }, 100);
  };

  const d = data.diagnostic;

  return (
    <div className="space-y-8">
      {/* ─── SECTION A — Executive Diagnostic Overview ─── */}
      {d.executiveOverview ? (
        <SectionA overview={d.executiveOverview} confidenceLayer={d.confidenceLayer} />
      ) : (
        /* Fallback: legacy Core Problems intro */
        <LegacyCoreProblemsIntro coreProblems={d.coreProblems} onScrollToAnswer={scrollToAnswer} />
      )}

      {/* ─── SECTION B — Primary Bottleneck Deep Dive ─── */}
      {d.bottleneckDeepDives && d.bottleneckDeepDives.length > 0 ? (
        <section>
          <h2 className="text-2xl font-bold mb-5 flex items-center gap-2">
            <Layers className="size-6 text-[#FD4438]" />
            Primary Bottleneck Deep Dive
          </h2>
          <div className="space-y-4">
            {d.bottleneckDeepDives.map((bn, idx) => (
              <BottleneckDeepDiveCard key={idx} bottleneck={bn} rank={idx + 1} onScrollToAnswer={scrollToAnswer} />
            ))}
          </div>
        </section>
      ) : (
        <LegacyCoreProblemsIntro coreProblems={d.coreProblems} onScrollToAnswer={scrollToAnswer} />
      )}

      {/* ─── SECTION C — Cross-System Patterns ─── */}
      {d.systemicPatterns && d.systemicPatterns.length > 0 && (
        <section>
          <h2 className="text-2xl font-bold mb-5 flex items-center gap-2">
            <Network className="size-6 text-[#06D7F6]" />
            Systemic Pattern Detection
          </h2>
          <div className="space-y-3">
            {d.systemicPatterns.map((p, idx) => (
              <PatternCard key={idx} pattern={p} />
            ))}
          </div>
        </section>
      )}

      {/* ─── SECTION D — Operational Pillar Matrix ─── */}
      <section>
        <h2 className="text-2xl font-bold mb-5 flex items-center gap-2">
          <BarChart3 className="size-6 text-[#8B5CF6]" />
          Operational Pillar Matrix
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <PillarCard
            label="Operations & Execution"
            score={d.pillarHeatmap.operationsExecution}
            interpretation={d.pillarInterpretations?.operationsExecution}
          />
          <PillarCard
            label="Revenue & Growth"
            score={d.pillarHeatmap.revenueGrowth}
            interpretation={d.pillarInterpretations?.revenueGrowth}
          />
          <PillarCard
            label="Systems & Automation"
            score={d.pillarHeatmap.systemsAutomation}
            interpretation={d.pillarInterpretations?.systemsAutomation}
          />
          <PillarCard
            label="AI Readiness & Governance"
            score={d.pillarHeatmap.aiReadinessGovernance}
            interpretation={d.pillarInterpretations?.aiReadinessGovernance}
          />
        </div>
      </section>

      {/* ─── SECTION E — Financial & Efficiency Model ─── */}
      {d.financialModel && (
        <section>
          <h2 className="text-2xl font-bold mb-5 flex items-center gap-2">
            <DollarSign className="size-6 text-[#10B981]" />
            Financial &amp; Efficiency Model
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            <FinancialCard label="Direct Revenue Leakage" value={d.financialModel.directRevenuLeakageFormatted} color="#FD4438" />
            <FinancialCard label="Hidden Operational Drag" value={d.financialModel.hiddenOperationalDragFormatted} color="#FB923C" />
            <FinancialCard label="Payroll Misallocation" value={d.financialModel.payrollMisallocationFormatted} color="#8B5CF6" />
            <FinancialCard label="Opportunity Cost" value={d.financialModel.opportunityCostFormatted} color="#3B82F6" />
            <FinancialCard label="Compounding Growth Tax" value={d.financialModel.compoundingGrowthTaxFormatted} color="#06D7F6" />
            <FinancialCard label="Total Annual Impact" value={d.financialModel.totalEstimatedAnnualImpactFormatted} color="#10B981" highlight />
          </div>
        </section>
      )}

      {/* ─── SECTION F — Operational Risk Assessment ─── */}
      {d.enhancedRisks && d.enhancedRisks.length > 0 ? (
        <section>
          <h2 className="text-2xl font-bold mb-5 flex items-center gap-2">
            <Shield className="size-6 text-[#FB923C]" />
            Operational Risk Assessment
          </h2>
          <div className="space-y-4">
            {d.enhancedRisks.map((risk, idx) => (
              <EnhancedRiskCard key={idx} risk={risk} />
            ))}
          </div>
        </section>
      ) : (
        /* fallback to legacy risk flags */
        <section>
          <h2 className="text-2xl font-bold mb-5 flex items-center gap-2">
            <Shield className="size-6 text-[#FB923C]" />
            Operational Risk Assessment
          </h2>
          <div className="space-y-3">
            {d.riskFlags.map((risk, idx) => (
              <LegacyRiskFlagCard key={idx} risk={risk} />
            ))}
          </div>
        </section>
      )}

      {/* ─── SECTION G — Full Diagnostic Transcript ─── */}
      {d.annotatedResponses && d.annotatedResponses.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <FileText className="size-6 text-[#06D7F6]" />
              Full Diagnostic Transcript
            </h2>
            <button
              onClick={() => setShowTranscript(!showTranscript)}
              className="text-sm text-gray-400 hover:text-white transition-colors flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10"
            >
              {showTranscript ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              {showTranscript ? 'Collapse' : 'Expand'} Transcript
            </button>
          </div>

          {/* Filter chips */}
          {showTranscript && (
            <div className="flex items-center gap-2 mb-4">
              <Filter className="size-4 text-gray-500" />
              {['pain', 'risk', 'opportunity', 'strength'].map(f => (
                <button
                  key={f}
                  onClick={() => setTranscriptFilter(transcriptFilter === f ? null : f)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold capitalize transition-all border ${
                    transcriptFilter === f
                      ? 'bg-white/15 border-white/30 text-white'
                      : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                  }`}
                >
                  {f}
                </button>
              ))}
              {transcriptFilter && (
                <button
                  onClick={() => setTranscriptFilter(null)}
                  className="text-xs text-gray-500 hover:text-gray-300 ml-2 underline"
                >
                  Clear
                </button>
              )}
            </div>
          )}

          <AnimatePresence>
            {showTranscript && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden"
              >
                <QATranscriptSheet
                  annotatedResponses={
                    transcriptFilter
                      ? d.annotatedResponses.filter(r =>
                          r.detectedSignals.some(s => s.type === transcriptFilter)
                        )
                      : d.annotatedResponses
                  }
                  bottleneckSourceMap={d.bottleneckSourceMap}
                  highlightQuestionId={highlightQuestion}
                  onBottleneckClick={(bnId) => {
                    const problemEl = document.querySelector(`[data-bottleneck="${bnId}"]`);
                    if (problemEl) problemEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION A — Executive Diagnostic Overview
// ═══════════════════════════════════════════════════════════════════════════════

function ConfidenceMetric({ label, value, color, highlight }: {
  label: string; value: string; color: string; highlight?: boolean;
}) {
  return (
    <div className={`rounded-lg p-3 text-center ${highlight ? 'bg-white/[0.06] border border-white/10' : 'bg-white/[0.03]'}`}>
      <div className="text-2xl font-black mb-1" style={{ color }}>{value}</div>
      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">{label}</div>
    </div>
  );
}

function SectionA({ overview, confidenceLayer }: {
  overview: NonNullable<CortexLeadData['diagnostic']['executiveOverview']>;
  confidenceLayer?: ConfidenceLayer;
}) {
  const readinessColor = READINESS_CAT_COLORS[overview.readinessCategory] || '#FB923C';
  const growthColor = GROWTH_RISK_COLORS[overview.growthRiskIndicator] || '#FB923C';

  return (
    <section>
      <h2 className="text-2xl font-bold mb-5 flex items-center gap-2">
        <Brain className="size-6 text-[#8B5CF6]" />
        Executive Diagnostic Overview
      </h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* LEFT — Primary Signal Card */}
        <div className="bg-gradient-to-br from-[#8B5CF6]/15 to-[#3B82F6]/15 border border-[#8B5CF6]/30 rounded-xl p-6 flex flex-col justify-between">
          {/* Score ring */}
          <div className="flex items-center gap-6 mb-6">
            <div className="relative size-24 flex-shrink-0">
              <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="10" />
                <circle
                  cx="50" cy="50" r="42"
                  fill="none"
                  stroke={readinessColor}
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={`${(overview.readinessScore / 100) * 264} 264`}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl font-black" style={{ color: readinessColor }}>
                  {overview.readinessScore}
                </span>
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">AI Readiness Score</div>
              <div className="text-xl font-bold mb-1" style={{ color: readinessColor }}>
                {overview.readinessCategory}
              </div>
              <div className="text-xs text-gray-400">Confidence: {overview.confidenceLevel}</div>
            </div>
          </div>

          {/* Growth Risk */}
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg" style={{ backgroundColor: `${growthColor}12`, border: `1px solid ${growthColor}30` }}>
            <Activity className="size-5" style={{ color: growthColor }} />
            <div>
              <div className="text-xs text-gray-400">Growth Risk Indicator</div>
              <div className="text-sm font-bold" style={{ color: growthColor }}>{overview.growthRiskIndicator}</div>
            </div>
          </div>
        </div>

        {/* RIGHT — Diagnostic Summary */}
        <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
          <div className="space-y-4 mb-5">
            <div>
              <div className="text-xs font-semibold text-[#FD4438] uppercase tracking-wider mb-1">Primary Bottleneck</div>
              <div className="text-lg font-bold text-white">{overview.primaryBottleneckTheme}</div>
            </div>
            <div>
              <div className="text-xs font-semibold text-[#FB923C] uppercase tracking-wider mb-1">Secondary Bottleneck</div>
              <div className="text-base font-semibold text-gray-200">{overview.secondaryBottleneck}</div>
            </div>
            <div className="flex items-center gap-3">
              <DollarSign className="size-5 text-[#10B981]" />
              <div>
                <div className="text-xs text-gray-400">Estimated Annual Impact</div>
                <div className="text-lg font-bold text-[#10B981]">{overview.estimatedAnnualImpactRange}</div>
              </div>
            </div>
          </div>

          {/* Summary Narrative */}
          <div className="pt-4 border-t border-white/10">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Summary</div>
            <p className="text-sm text-gray-300 leading-relaxed">{overview.summaryNarrative}</p>
          </div>
        </div>
      </div>

      {/* ── Confidence & Integrity Strip ── */}
      {confidenceLayer && (
        <div className="mt-5 bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="size-5 text-[#06D7F6]" />
            <span className="text-sm font-semibold text-white">Confidence & Integrity Layer</span>
            <span className="ml-auto text-xs text-gray-500">Analysis quality metrics</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <ConfidenceMetric
              label="AI Confidence"
              value={`${Math.round(confidenceLayer.aiConfidenceScore * 100)}%`}
              color={confidenceLayer.aiConfidenceScore >= 0.8 ? '#10B981' : confidenceLayer.aiConfidenceScore >= 0.5 ? '#FB923C' : '#FD4438'}
              highlight
            />
            <ConfidenceMetric
              label="Signals Detected"
              value={String(confidenceLayer.totalSignalsDetected)}
              color="#8B5CF6"
            />
            <ConfidenceMetric
              label="Corroborated"
              value={String(confidenceLayer.corroboratedPatterns)}
              color="#3B82F6"
            />
            <ConfidenceMetric
              label="Contradictions"
              value={String(confidenceLayer.contradictionFlags)}
              color={confidenceLayer.contradictionFlags > 2 ? '#FD4438' : confidenceLayer.contradictionFlags > 0 ? '#FB923C' : '#10B981'}
            />
            <ConfidenceMetric
              label="Weak Signals"
              value={String(confidenceLayer.weakSignalFlags)}
              color={confidenceLayer.weakSignalFlags > 3 ? '#FD4438' : confidenceLayer.weakSignalFlags > 1 ? '#FB923C' : '#10B981'}
            />
          </div>
        </div>
      )}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION B — Bottleneck Deep Dive Card
// ═══════════════════════════════════════════════════════════════════════════════

function BottleneckDeepDiveCard({
  bottleneck: bn,
  rank,
  onScrollToAnswer,
}: {
  bottleneck: BottleneckDeepDive;
  rank: number;
  onScrollToAnswer: (qId: number) => void;
}) {
  const [expanded, setExpanded] = useState(rank === 1); // first one expanded by default

  const prioColor = SEVERITY_COLORS[bn.severity] || '#3B82F6';
  const catColor = CATEGORY_COLORS[bn.category] || '#8B5CF6';

  return (
    <div
      className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden"
      data-bottleneck={bn.bottleneckId || ''}
    >
      {/* B1 — Header (always visible) */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-5 flex items-start gap-4 hover:bg-white/[0.02] transition-colors"
      >
        <div
          className="size-10 rounded-lg flex items-center justify-center text-lg font-black flex-shrink-0"
          style={{ backgroundColor: `${prioColor}20`, color: prioColor }}
        >
          {rank}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <h3 className="text-lg font-bold text-white truncate">{bn.title}</h3>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2 py-0.5 rounded text-xs font-bold uppercase" style={{ backgroundColor: `${prioColor}20`, color: prioColor }}>
              {bn.severity}
            </span>
            <span className="px-2 py-0.5 rounded text-xs font-bold uppercase" style={{ backgroundColor: `${catColor}20`, color: catColor }}>
              {bn.category}
            </span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
              bn.patternStrength >= 8 ? 'bg-[#10B981]/15 text-[#10B981]'
              : bn.patternStrength >= 4 ? 'bg-[#FB923C]/15 text-[#FB923C]'
              : 'bg-white/10 text-gray-400'
            }`}>
              Strength: {bn.patternStrength}
            </span>
          </div>
        </div>
        {expanded ? <ChevronDown className="size-5 text-gray-400 flex-shrink-0 mt-1" /> : <ChevronRight className="size-5 text-gray-400 flex-shrink-0 mt-1" />}
      </button>

      {/* Expandable body: B2–B6 */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 space-y-5 border-t border-white/5 pt-5">
              {/* Causal Chain (5-step) */}
              <div>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Causal Chain</div>
                <div className="space-y-2">
                  {['Trigger', 'Immediate Effect', 'Secondary Effect', 'Compounding Effect', 'Failure Outcome'].map((step, idx) => (
                    <div key={idx} className="flex items-start gap-3">
                      <div className="mt-1.5 size-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                        style={{ backgroundColor: `${idx >= 3 ? '#FD4438' : idx >= 1 ? '#FB923C' : '#3B82F6'}20`, color: idx >= 3 ? '#FD4438' : idx >= 1 ? '#FB923C' : '#3B82F6' }}>
                        {idx + 1}
                      </div>
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{step}</span>
                        <p className="text-sm text-gray-300">{bn.causalChain[idx]}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Evidence Mapping */}
              <div>
                <div className="text-xs font-semibold text-[#06D7F6] uppercase tracking-wider mb-3">Evidence Mapping</div>
                <div className="space-y-3">
                  {bn.evidence.map((ev, idx) => (
                    <div key={idx} className="bg-white/[0.03] border border-white/5 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <button
                          onClick={() => onScrollToAnswer(ev.questionId)}
                          className="px-2 py-0.5 rounded bg-[#06D7F6]/15 text-[#06D7F6] text-xs font-bold hover:bg-[#06D7F6]/25 transition-colors"
                        >
                          {ev.questionRef}
                        </button>
                        <span className="text-xs text-gray-500">Client answer</span>
                      </div>
                      <p className="text-sm text-gray-300 italic mb-2">&ldquo;{ev.clientExcerpt}&rdquo;</p>
                      <div className="flex items-start gap-2 mb-2">
                        <Brain className="size-4 text-[#8B5CF6] flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-gray-400">{ev.aiInterpretation}</p>
                      </div>
                      {ev.structuralImplication && (
                        <div className="flex items-start gap-2 pt-2 border-t border-white/5">
                          <ArrowRight className="size-3.5 text-[#FB923C] flex-shrink-0 mt-0.5" />
                          <p className="text-xs text-[#FB923C]">{ev.structuralImplication}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Root Cause Hierarchy (4 levels) */}
              <div>
                <div className="text-xs font-semibold text-[#FB923C] uppercase tracking-wider mb-3">Root Cause Hierarchy</div>
                <div className="space-y-2">
                  {[
                    { level: 'L1 Symptom', text: bn.rootCauseHierarchy.level_1_symptom },
                    { level: 'L2 Process Failure', text: bn.rootCauseHierarchy.level_2_process_failure },
                    { level: 'L3 Architecture Failure', text: bn.rootCauseHierarchy.level_3_architecture_failure },
                    { level: 'L4 Governance Failure', text: bn.rootCauseHierarchy.level_4_governance_failure },
                  ].map((item, idx) => (
                    <div key={idx} className="flex items-start gap-3 p-2.5 rounded-lg" style={{ backgroundColor: `rgba(251,146,60,${0.03 + idx * 0.03})` }}>
                      <span className="text-[10px] font-bold text-[#FB923C] uppercase tracking-wider whitespace-nowrap mt-0.5">{item.level}</span>
                      <p className="text-xs text-gray-300">{item.text}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Stress Simulation */}
              <div>
                <div className="text-xs font-semibold text-[#FD4438] uppercase tracking-wider mb-3">Stress Simulation</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { label: '+20% Volume', value: bn.stressSimulation.growth_20_percent, icon: TrendingUp },
                    { label: '+30% Growth', value: bn.stressSimulation.growth_30_percent, icon: TrendingDown },
                    { label: 'Founder Absence', value: bn.stressSimulation.founder_absence, icon: Target },
                    { label: 'System Failure', value: bn.stressSimulation.system_failure, icon: AlertTriangle },
                  ].map((item, idx) => (
                    <div key={idx} className="p-3 rounded-lg bg-[#FD4438]/5 border border-[#FD4438]/10">
                      <div className="flex items-center gap-2 mb-1">
                        <item.icon className="size-3.5 text-[#FD4438]" />
                        <span className="text-xs font-semibold text-[#FD4438]">{item.label}</span>
                      </div>
                      <p className="text-xs text-gray-300">{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quantified Impact */}
              <div>
                <div className="text-xs font-semibold text-[#10B981] uppercase tracking-wider mb-3">Quantified Impact</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Revenue Leakage', value: `$${((bn.quantifiedImpact?.revenue_leakage_estimate ?? 0) / 1000).toFixed(0)}K/yr`, color: '#FD4438' },
                    { label: 'Payroll Inflation', value: `$${((bn.quantifiedImpact?.payroll_inflation_risk ?? 0) / 1000).toFixed(0)}K/yr`, color: '#FB923C' },
                    { label: 'Time Waste', value: `${bn.quantifiedImpact?.time_waste_hours_per_week ?? 0} hrs/wk`, color: '#8B5CF6' },
                    { label: 'Growth Ceiling', value: `${bn.quantifiedImpact?.growth_ceiling_percent ?? 0}%`, color: '#3B82F6' },
                  ].map((item, idx) => (
                    <div key={idx} className="p-3 rounded-lg border" style={{ backgroundColor: `${item.color}08`, borderColor: `${item.color}20` }}>
                      <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: item.color }}>{item.label}</div>
                      <div className="text-lg font-black" style={{ color: item.color }}>{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Intervention Path */}
              <div>
                <div className="text-xs font-semibold text-[#10B981] uppercase tracking-wider mb-3">Intervention Path</div>
                <div className="space-y-3">
                  {[
                    { label: 'Short-Term', text: bn.intervention.short_term, color: '#10B981' },
                    { label: 'Mid-Term', text: bn.intervention.mid_term, color: '#3B82F6' },
                    { label: 'Structural Redesign', text: bn.intervention.structural_redesign, color: '#8B5CF6' },
                  ].map((item, idx) => (
                    <div key={idx} className="flex items-start gap-3">
                      <div className="mt-1 size-2 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                      <div>
                        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: item.color }}>{item.label}</span>
                        <p className="text-sm text-gray-300 mt-0.5">{item.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION C — Cross-System Pattern Card
// ═══════════════════════════════════════════════════════════════════════════════

function PatternCard({
  pattern,
}: {
  pattern: SystemicPattern;
}) {
  const color = SEVERITY_COLORS[pattern.severity] || '#3B82F6';

  return (
    <div className="p-4 rounded-xl border bg-black/30 backdrop-blur-xl" style={{ borderColor: `${color}25` }}>
      <div className="flex items-start gap-3">
        <GitBranch className="size-5 flex-shrink-0 mt-0.5" style={{ color }} />
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="px-2 py-0.5 rounded text-xs font-bold uppercase" style={{ backgroundColor: `${color}15`, color }}>
              {pattern.severity}
            </span>
            <span className="text-xs text-gray-500">{pattern.signalCount} signals</span>
            {pattern.crossDepartmentalPresence && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-[#8B5CF6]/15 text-[#8B5CF6]">Cross-Dept</span>
            )}
            <span className="text-xs text-gray-500">{Math.round(pattern.recurrenceProbability * 100)}% recurrence</span>
          </div>
          <p className="text-sm text-gray-200 font-medium mb-1">{pattern.patternName}</p>
          <p className="text-xs text-gray-400">{pattern.failureCascadePotential}</p>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION D — Pillar Card (with interpretation)
// ═══════════════════════════════════════════════════════════════════════════════

function PillarCard({
  label,
  score,
  interpretation,
}: {
  label: string;
  score: number;
  interpretation?: PillarInterpretation;
}) {
  const color = getPillarColor(score as any);
  const percentage = (score / 5) * 100;

  return (
    <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-white">{label}</div>
        <span className="text-2xl font-black" style={{ color }}>{score}<span className="text-sm font-normal text-gray-500">/5</span></span>
      </div>
      <div className="h-2.5 bg-white/5 rounded-full overflow-hidden mb-3">
        <div className="h-full rounded-full transition-all" style={{ width: `${percentage}%`, backgroundColor: color }} />
      </div>
      <div className="text-xs mb-1" style={{ color }}>
        {score >= 4 ? '✓ Stable' : score >= 2 ? '⚠ Fix Soon' : '🚨 Urgent'}
      </div>

      {interpretation && (
        <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
          <p className="text-xs text-gray-400 leading-relaxed">{interpretation.interpretation}</p>
          <div className="flex items-start gap-2">
            <AlertTriangle className="size-3 text-[#FB923C] flex-shrink-0 mt-0.5" />
            <p className="text-xs text-[#FB923C]">{interpretation.dominantWeakness}</p>
          </div>
          {interpretation.automationLeveragePotential && (
            <div className="flex items-start gap-2">
              <Zap className="size-3 text-[#06D7F6] flex-shrink-0 mt-0.5" />
              <p className="text-xs text-[#06D7F6]">{interpretation.automationLeveragePotential}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION E — Financial Metric Card
// ═══════════════════════════════════════════════════════════════════════════════

function FinancialCard({ label, value, color, highlight }: { label: string; value: string; color: string; highlight?: boolean }) {
  return (
    <div className={`backdrop-blur-xl border rounded-xl p-5 ${highlight ? 'bg-gradient-to-br from-[#10B981]/10 to-transparent border-[#10B981]/30' : 'bg-black/40 border-white/10'}`}>
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{label}</div>
      <div className={`font-black ${highlight ? 'text-2xl' : 'text-xl'}`} style={{ color }}>{value}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION F — Enhanced Risk Card
// ═══════════════════════════════════════════════════════════════════════════════

function EnhancedRiskCard({ risk }: { risk: EnhancedRiskFlag }) {
  const sevColor = SEVERITY_COLORS[risk.severity] || '#3B82F6';
  const typeColor = RISK_TYPE_COLORS[risk.riskType] || '#3B82F6';

  return (
    <div className="p-5 rounded-xl border bg-black/30 backdrop-blur-xl" style={{ borderColor: `${sevColor}25`, borderLeftWidth: 4, borderLeftColor: sevColor }}>
      <div className="flex items-start gap-3">
        <Shield className="size-5 flex-shrink-0 mt-0.5" style={{ color: sevColor }} />
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="px-2 py-0.5 rounded text-xs font-bold uppercase" style={{ backgroundColor: `${sevColor}15`, color: sevColor }}>
              {risk.severity}
            </span>
            <span className="px-2 py-0.5 rounded text-xs font-semibold" style={{ backgroundColor: `${typeColor}12`, color: typeColor }}>
              {risk.riskType}
            </span>
            <span className="text-xs text-gray-500">{risk.probabilityPercent}% probability</span>
          </div>
          <p className="text-sm text-gray-300 mb-3">{risk.cascadePath}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-white/5">
            <div className="flex items-start gap-2">
              <Gauge className="size-3.5 text-gray-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-gray-500"><span className="font-semibold text-gray-400">Trigger:</span> {risk.triggerThreshold}</p>
            </div>
            <div className="flex items-start gap-2">
              <Clock className="size-3.5 text-gray-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-gray-500"><span className="font-semibold text-gray-400">Time to failure:</span> {risk.timeToFailureEstimate}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEGACY FALLBACKS (used when new data isn't available)
// ═══════════════════════════════════════════════════════════════════════════════

function LegacyCoreProblemsIntro({
  coreProblems,
  onScrollToAnswer,
}: {
  coreProblems: any[];
  onScrollToAnswer: (qId: number) => void;
}) {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <AlertTriangle className="size-6 text-[#FD4438]" />
        Core Problems
      </h2>
      <div className="space-y-4">
        {coreProblems.map((problem, idx) => (
          <LegacyCoreProblemCard key={idx} problem={problem} rank={idx + 1} onScrollToAnswer={onScrollToAnswer} />
        ))}
      </div>
    </div>
  );
}

function LegacyCoreProblemCard({
  problem,
  rank,
  onScrollToAnswer,
}: {
  problem: any;
  rank: number;
  onScrollToAnswer?: (qId: number) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div
      className="bg-gradient-to-br from-[#FD4438]/20 to-[#FB923C]/20 border border-[#FD4438]/30 rounded-xl p-6"
      data-bottleneck={problem.bottleneckId || ''}
    >
      <div className="flex items-start gap-4">
        <div className="size-12 rounded-full bg-[#FD4438] flex items-center justify-center text-xl font-bold flex-shrink-0">
          {rank}
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xl font-bold">{problem.title}</h4>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Urgency:</span>
              <span className="text-sm font-bold text-[#FD4438]">{problem.urgencyScore}/10</span>
              {problem.editable && (
                <button
                  onClick={() => setIsEditing(!isEditing)}
                  className="p-1 hover:bg-white/10 rounded transition-colors"
                >
                  <Edit3 className="size-4 text-gray-400" />
                </button>
              )}
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <div className="text-xs font-semibold text-[#FD4438] mb-1">What&apos;s Broken:</div>
              <p className="text-sm text-gray-300">{problem.whatsbroken}</p>
            </div>
            <div>
              <div className="text-xs font-semibold text-[#FB923C] mb-1">Why It&apos;s Breaking:</div>
              <p className="text-sm text-gray-300">{problem.whyBreaking}</p>
            </div>
            <div>
              <div className="text-xs font-semibold text-[#FD4438] mb-1">What Breaks Next:</div>
              <p className="text-sm text-gray-300">{problem.whatBreaksNext}</p>
            </div>
          </div>
          {problem.sourceAnswers && problem.sourceAnswers.length > 0 && (
            <SourceAnswersBadge sourceAnswers={problem.sourceAnswers} onClickAnswer={onScrollToAnswer} />
          )}
          {isEditing && (
            <div className="mt-4 pt-4 border-t border-white/10">
              <button className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-lg transition-colors text-sm font-medium">
                Save Changes
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LegacyRiskFlagCard({ risk }: { risk: any }) {
  const color = SEVERITY_COLORS[risk.severity] || '#3B82F6';
  return (
    <div
      className="p-4 rounded-xl"
      style={{
        backgroundColor: `${color}08`,
        border: `1px solid ${color}25`,
        borderLeft: `4px solid ${color}`,
      }}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="size-5 flex-shrink-0 mt-0.5" style={{ color }} />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 rounded-full text-xs font-bold uppercase" style={{ backgroundColor: `${color}20`, color }}>
              {risk.severity}
            </span>
            <h4 className="font-semibold">{risk.label}</h4>
          </div>
          <p className="text-sm text-gray-300">{risk.description}</p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 3️⃣ AI RECOMMENDATION ENGINE SECTION — v2 Schema-Locked
// ============================================================================

const PILLAR_COLORS: Record<string, string> = { consultancy: '#8B5CF6', software: '#3B82F6', growth: '#10B981', operations: '#06D7F6' };
const IMPACT_TYPE_LABELS: Record<string, string> = { revenue_growth: 'Revenue Growth', cost_reduction: 'Cost Reduction', efficiency: 'Efficiency', risk_reduction: 'Risk Reduction' };
const RISK_MATRIX_COLORS: Record<string, { bg: string; text: string }> = {
  high: { bg: 'rgba(253,68,56,0.12)', text: '#FD4438' },
  medium: { bg: 'rgba(251,146,60,0.12)', text: '#FB923C' },
  low: { bg: 'rgba(16,185,129,0.12)', text: '#10B981' },
};

export function RecommendationSection({ data, onPortfolioUpdate }: { data: CortexLeadData; onPortfolioUpdate?: (state: import('@/app/core/types').PortfolioState, result: import('@/app/core/types').RecalcResult) => void }) {
  const [status, setStatus] = useState(data.recommendation.recommendationStatus);
  const [overrideReason, setOverrideReason] = useState('');
  const rec = data.recommendation;
  const v2 = rec.recommendationV2;
  const hasV1 = rec.confidenceScore !== undefined;

  const handleAccept = () => { setStatus('accepted'); };
  const handleOverride = (reason?: string) => {
    const r = reason || overrideReason;
    if (!r.trim()) return;
    setOverrideReason(r);
    setStatus('overridden');
  };

  // Confidence
  const confPct = v2 ? v2.confidence_model.confidence_score : hasV1 ? Math.round((rec.confidenceScore ?? 0) * 100) : null;
  const confColor = confPct !== null ? confPct >= 75 ? '#10B981' : confPct >= 50 ? '#FB923C' : '#FD4438' : '#8B5CF6';

  return (
    <div className="space-y-6">

      {/* "WHAT CHANGED" BANNER — shows after chat recalculation */}
      {data.portfolioState && data.portfolioState.history.length > 1 && data.portfolioState.history[0].source === 'chat' && (
        <WhatChangedBanner portfolioState={data.portfolioState} />
      )}

      {/* AI Toolbar — quick-generate actions for Recommendation section */}
      <AIToolbar
        sectionId="recommendation"
        sectionLabel="AI Recommendation"
        sectionContent={
          v2
            ? `Problem: ${v2.core_problem.problem_title}. Reasoning: ${v2.core_problem.why_first ?? ''}. Service: ${rec.primaryServiceLabel ?? ''}.`
            : `Recommended: ${rec.primaryServiceLabel}. Reasoning: ${rec.reasoning ?? ''}.`
        }
        leadContext={{
          companyName: data.lead?.companyName ?? '',
          industry: data.lead?.industry ?? '',
          companySize: String(data.lead?.employeeEstimate ?? ''),
          primaryPainSignal: data.lead?.primaryPainSignal ?? '',
          recommendedService: rec.primaryServiceLabel ?? '',
        }}
        actions={[
          { label: 'Strengthen Reasoning', prompt: 'Strengthen the recommendation reasoning. Explain why this service is the right first move, grounded in the diagnostic data provided.' },
          { label: 'Why Now Argument', prompt: 'Generate a compelling "why this recommendation, why now" argument based on the lead data and diagnostic findings.', icon: 'zap' },
          { label: 'Risk of Inaction', prompt: 'Write a brief "risk of inaction" narrative for this recommendation. What happens if the client delays by one quarter?', icon: 'arrow' },
        ]}
      />

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* A. CORE PROBLEM + SEVERITY + PILLAR IMPACT                          */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <div className="bg-gradient-to-br from-[#8B5CF6]/20 to-[#3B82F6]/20 border border-[#8B5CF6]/30 rounded-xl p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              {v2 ? 'CORE PROBLEM IDENTIFIED' : 'AI RECOMMENDS'}
            </div>
            <h2 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] bg-clip-text text-transparent">
              {v2 ? v2.core_problem.problem_title : rec.primaryServiceLabel}
            </h2>
          </div>
          <Target className="size-8 text-[#8B5CF6] flex-shrink-0" />
        </div>

        {/* Severity + Pillar badges */}
        {v2 && (
          <div className="flex flex-wrap items-center gap-3 mb-5">
            {/* Severity ring */}
            <div className="flex items-center gap-2 bg-black/40 rounded-lg px-3 py-2">
              <div className="relative size-10">
                <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                  <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
                  <circle cx="50" cy="50" r="40" fill="none" stroke={v2.core_problem.severity_score >= 7 ? '#FD4438' : v2.core_problem.severity_score >= 4 ? '#FB923C' : '#10B981'} strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={`${(v2.core_problem.severity_score / 10) * 251} 251`} />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center text-xs font-black text-white">{v2.core_problem.severity_score}</div>
              </div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase">Severity<br />/10</div>
            </div>
            {/* Pillar badges */}
            {v2.core_problem.pillar_impact.map(p => (
              <span key={p} className="px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider"
                style={{ backgroundColor: `${PILLAR_COLORS[p] || '#8B5CF6'}20`, color: PILLAR_COLORS[p] || '#8B5CF6', border: `1px solid ${PILLAR_COLORS[p] || '#8B5CF6'}40` }}>
                {p}
              </span>
            ))}
          </div>
        )}

        {/* VERSION + METADATA STRIP (§8) */}
        {v2 && (
          <VersionMetadataStrip v2={v2} portfolioState={data.portfolioState} onPortfolioUpdate={onPortfolioUpdate} />
        )}

        {/* Priority Score bar */}
        {v2 && (
          <div className="grid grid-cols-4 gap-3 mb-5">
            {[
              { label: 'Impact', value: v2.priority_score.impact_score, color: '#8B5CF6' },
              { label: 'Feasibility', value: v2.priority_score.feasibility_score, color: '#3B82F6' },
              { label: 'Risk', value: v2.priority_score.risk_score, color: '#FB923C' },
              { label: 'Priority', value: v2.priority_score.computed_priority, color: '#10B981' },
            ].map(item => (
              <div key={item.label} className="bg-black/40 rounded-lg p-3 text-center">
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">{item.label}</div>
                <div className="text-xl font-black" style={{ color: item.color }}>{item.value}</div>
                <div className="w-full bg-white/5 rounded-full h-1.5 mt-2">
                  <div className="h-full rounded-full" style={{ width: `${(item.value / 10) * 100}%`, backgroundColor: item.color }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Confidence + time to impact strip */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
          {confPct !== null && (
            <div className="bg-black/40 rounded-lg p-4 flex flex-col items-center justify-center">
              <div className="relative size-14 mb-1.5">
                <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                  <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
                  <circle cx="50" cy="50" r="40" fill="none" stroke={confColor} strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={`${((confPct ?? 0) / 100) * 251} 251`} />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-sm font-black" style={{ color: confColor }}>{confPct}%</span>
                </div>
              </div>
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Confidence</div>
            </div>
          )}
          {(v2 || hasV1) && (
            <span className="contents">
              <div className="bg-black/40 rounded-lg p-4 text-center flex flex-col justify-center">
                <TrendingUp className="size-4 text-[#10B981] mx-auto mb-1" />
                <div className="text-xl font-black text-[#10B981]">+{rec.expectedImpact?.revenueLiftPercent ?? 0}%</div>
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Revenue Lift</div>
              </div>
              <div className="bg-black/40 rounded-lg p-4 text-center flex flex-col justify-center">
                <TrendingDown className="size-4 text-[#06D7F6] mx-auto mb-1" />
                <div className="text-xl font-black text-[#06D7F6]">-{rec.expectedImpact?.costReductionPercent ?? 0}%</div>
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Cost Reduction</div>
              </div>
              <div className="bg-black/40 rounded-lg p-4 text-center flex flex-col justify-center">
                <Clock className="size-4 text-[#FB923C] mx-auto mb-1" />
                <div className="text-xl font-black text-[#FB923C]">{rec.expectedImpact?.timeSavedHoursMonth ?? 0}h</div>
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Hours/Month</div>
              </div>
              <div className="bg-black/40 rounded-lg p-4 text-center flex flex-col justify-center">
                <Calendar className="size-4 text-[#3B82F6] mx-auto mb-1" />
                <div className="text-xl font-black text-[#3B82F6]">{v2?.strategic_decision.expected_time_to_impact_days ?? rec.implementationWindowDays ?? 30}d</div>
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Time to Impact</div>
              </div>
            </span>
          )}
        </div>

        {/* Action Buttons */}
        {status === 'pending' && (
          <div className="flex gap-3">
            <button onClick={handleAccept} className="flex-1 px-4 py-3 bg-[#10B981] hover:bg-[#059669] text-white rounded-lg transition-colors font-semibold flex items-center justify-center gap-2">
              <CheckCircle2 className="size-5" /> Accept
            </button>
            <button className="flex-1 px-4 py-3 bg-[#3B82F6] hover:bg-[#2563EB] text-white rounded-lg transition-colors font-semibold flex items-center justify-center gap-2">
              <Edit3 className="size-5" /> Modify
            </button>
            <button onClick={() => { const r = prompt('Why are you overriding this recommendation?'); if (r) handleOverride(r); }}
              className="flex-1 px-4 py-3 bg-[#FD4438] hover:bg-[#DC2626] text-white rounded-lg transition-colors font-semibold flex items-center justify-center gap-2">
              <XCircle className="size-5" /> Override
            </button>
          </div>
        )}
        {status === 'accepted' && (
          <div className="p-3 bg-[#10B981]/20 border border-[#10B981]/30 rounded-lg text-[#10B981] font-medium flex items-center gap-2">
            <CheckCircle2 className="size-5" /> Recommendation Accepted
          </div>
        )}
        {status === 'overridden' && (
          <div className="p-3 bg-[#FD4438]/20 border border-[#FD4438]/30 rounded-lg">
            <div className="text-[#FD4438] font-medium flex items-center gap-2 mb-2"><XCircle className="size-5" /> Overridden</div>
            {overrideReason && <p className="text-sm text-gray-300">Reason: {overrideReason}</p>}
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* B. STRATEGIC DECISION — Why Now / Why First                          */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
        <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
          <Brain className="size-5 text-[#8B5CF6]" />
          Strategic Decision
        </h3>
        {v2 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white/[0.03] border border-white/5 rounded-lg p-4">
              <div className="text-xs font-semibold text-[#FD4438] uppercase tracking-wider mb-2">WHY NOW</div>
              <p className="text-gray-300 text-sm leading-relaxed">{v2.strategic_decision.why_now}</p>
            </div>
            <div className="bg-white/[0.03] border border-white/5 rounded-lg p-4">
              <div className="text-xs font-semibold text-[#8B5CF6] uppercase tracking-wider mb-2">WHY THIS FIRST</div>
              <p className="text-gray-300 text-sm leading-relaxed">{v2.strategic_decision.why_first}</p>
            </div>
          </div>
        ) : (
          <div className="bg-white/[0.03] border border-white/5 rounded-lg p-4">
            <div className="text-xs font-semibold text-[#8B5CF6] uppercase tracking-wider mb-2">WHY THIS SERVICE FIRST</div>
            <p className="text-gray-300 leading-relaxed">{rec.reasoning}</p>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* C. IMPACT PROFILE — Primary metric with 30/60/90d targets           */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {v2 && (
        <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
          <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
            <BarChart3 className="size-5 text-[#06D7F6]" />
            Impact Profile
          </h3>
          {/* Impact type badges */}
          <div className="flex flex-wrap gap-2 mb-4">
            {v2.impact_profile.impact_type.map(t => (
              <span key={t} className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-[#06D7F6]/15 text-[#06D7F6] border border-[#06D7F6]/30">
                {IMPACT_TYPE_LABELS[t] || t}
              </span>
            ))}
          </div>
          {/* Primary metric trajectory */}
          <div className="bg-white/[0.03] border border-white/5 rounded-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-semibold text-white">{v2.impact_profile.primary_metric}</div>
                <div className="text-xs text-gray-500 uppercase">{v2.impact_profile.unit}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-500">Baseline</div>
                <div className="text-lg font-black text-gray-400">{v2.impact_profile.baseline_value}</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: '30 Days', value: v2.impact_profile.target_value_30d, color: '#3B82F6' },
                { label: '60 Days', value: v2.impact_profile.target_value_60d, color: '#8B5CF6' },
                { label: '90 Days', value: v2.impact_profile.target_value_90d, color: '#10B981' },
              ].map(target => {
                const baseline = v2.impact_profile.baseline_value;
                const isLowerBetter = ['hours', 'dollars', 'count', 'tickets'].includes(v2.impact_profile.unit);
                const pctChange = baseline > 0 ? Math.round(((target.value - baseline) / baseline) * 100) : 0;
                return (
                  <div key={target.label} className="bg-black/40 rounded-lg p-3 text-center">
                    <div className="text-[10px] font-semibold text-gray-500 uppercase">{target.label}</div>
                    <div className="text-xl font-black mt-1" style={{ color: target.color }}>{target.value}</div>
                    <div className="text-[10px] font-semibold mt-1" style={{ color: isLowerBetter ? (pctChange <= 0 ? '#10B981' : '#FD4438') : (pctChange >= 0 ? '#10B981' : '#FD4438') }}>
                      {pctChange >= 0 ? '+' : ''}{pctChange}%
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* D. EXECUTION PLAN — Phased timeline                                 */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {v2 && (
        <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
          <h3 className="text-xl font-bold mb-2 flex items-center gap-2">
            <Calendar className="size-5 text-[#3B82F6]" />
            Execution Plan
          </h3>
          <div className="text-xs text-gray-500 mb-5">Total Duration: {v2.execution_plan.total_duration_days} days</div>
          <div className="space-y-4">
            {v2.execution_plan.phases.map((phase, idx) => {
              const colors = ['#8B5CF6', '#3B82F6', '#06D7F6', '#10B981'];
              const c = colors[idx % colors.length];
              return (
                <div key={phase.phase_id} className="rounded-lg border p-5" style={{ borderColor: `${c}30`, backgroundColor: `${c}08` }}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="size-8 rounded-full flex items-center justify-center text-xs font-black text-white" style={{ backgroundColor: `${c}40` }}>{idx + 1}</div>
                      <div>
                        <div className="font-bold text-white">{phase.title}</div>
                        <div className="text-xs text-gray-400">{phase.duration_days} days{phase.dependencies.length > 0 && ` · depends on ${phase.dependencies.join(', ')}`}</div>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                    <div>
                      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Objectives</div>
                      <ul className="space-y-1">
                        {phase.objectives.map((obj, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                            <ArrowRight className="size-3 flex-shrink-0 mt-1" style={{ color: c }} />
                            {obj}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Deliverables</div>
                      <ul className="space-y-1">
                        {phase.deliverables.map((del, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                            <CheckCircle2 className="size-3 flex-shrink-0 mt-1 text-[#10B981]" />
                            {del}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* E. RESOURCE REQUIREMENTS                                            */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {v2 && v2.resource_requirements.length > 0 && (
        <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
          <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Users className="size-5 text-[#FB923C]" />
            Resource Requirements
          </h3>
          <div className="space-y-3">
            {v2.resource_requirements.map((r, idx) => (
              <div key={idx} className="flex items-center gap-4 bg-white/[0.03] border border-white/5 rounded-lg p-4">
                <div className="flex-1">
                  <div className="font-semibold text-white text-sm">{r.role}</div>
                  <div className="text-xs text-gray-500">Active: {r.active_phase}</div>
                </div>
                <div className="w-32">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-gray-500">Allocation</span>
                    <span className="text-xs font-bold text-[#FB923C]">{r.allocation_percent}%</span>
                  </div>
                  <div className="w-full bg-white/5 rounded-full h-2">
                    <div className="h-full rounded-full bg-[#FB923C]" style={{ width: `${r.allocation_percent}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* F. RISK PROFILE                                                     */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {v2 && v2.risk_profile.length > 0 && (
        <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
          <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Shield className="size-5 text-[#FD4438]" />
            Risk Profile
          </h3>
          <div className="space-y-3">
            {v2.risk_profile.map(risk => {
              const probColor = RISK_MATRIX_COLORS[risk.probability] || RISK_MATRIX_COLORS.low;
              const impColor = RISK_MATRIX_COLORS[risk.impact] || RISK_MATRIX_COLORS.low;
              return (
                <div key={risk.risk_id} className="bg-white/[0.03] border border-white/5 rounded-lg p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase" style={{ backgroundColor: probColor.bg, color: probColor.text }}>
                      P: {risk.probability}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase" style={{ backgroundColor: impColor.bg, color: impColor.text }}>
                      I: {risk.impact}
                    </span>
                  </div>
                  <div className="text-sm text-gray-300 mb-1">{risk.mitigation}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* G. FEASIBILITY + EVIDENCE + CONFIDENCE + ROI GATE                    */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {v2 && (
        <div className="space-y-4">
          {/* Feasibility Scoring (§1) */}
          {v2.feasibility && (
            <div className={`border rounded-xl p-5 ${v2.feasibility.high_execution_risk ? 'bg-[#FD4438]/5 border-[#FD4438]/20' : 'bg-white/[0.02] border-white/10'}`}>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <Shield className="size-4 text-[#3B82F6]" />
                  Feasibility Score (Execution Reality Check)
                </h4>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-black" style={{ color: (v2.feasibility.computed_feasibility ?? 0) >= 7 ? '#10B981' : (v2.feasibility.computed_feasibility ?? 0) >= 5 ? '#FB923C' : '#FD4438' }}>
                    {(v2.feasibility.computed_feasibility ?? 0).toFixed(1)}
                  </span>
                  {v2.feasibility.high_execution_risk && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#FD4438]/15 text-[#FD4438] uppercase">High Risk</span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Technical', value: v2.feasibility.technical_feasibility, color: '#3B82F6', weight: '×0.3' },
                  { label: 'Data Readiness', value: v2.feasibility.data_readiness, color: '#10B981', weight: '×0.3' },
                  { label: 'Org Readiness', value: v2.feasibility.organizational_readiness, color: '#8B5CF6', weight: '×0.25' },
                  { label: 'Complexity', value: v2.feasibility.change_complexity, color: '#FD4438', weight: '−0.15' },
                ].map(f => (
                  <div key={f.label} className="bg-black/30 rounded-lg p-2.5 text-center">
                    <div className="text-[9px] text-gray-500 uppercase mb-1">{f.label} <span className="text-gray-600">{f.weight}</span></div>
                    <div className="text-base font-black" style={{ color: f.color }}>{f.value ?? 0}/10</div>
                    <div className="w-full bg-white/5 rounded-full h-1 mt-1">
                      <div className="h-full rounded-full" style={{ width: `${(f.value ?? 0) * 10}%`, backgroundColor: f.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Evidence Strength (§2) */}
          {v2.evidence_strength && (
            <div className="bg-white/[0.02] border border-white/10 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <FileCheck className="size-4 text-[#10B981]" />
                  Evidence Strength
                </h4>
                <span className="text-lg font-black" style={{ color: (v2.evidence_strength.computed_evidence ?? 0) >= 3 ? '#10B981' : (v2.evidence_strength.computed_evidence ?? 0) >= 1.5 ? '#FB923C' : '#FD4438' }}>
                  {(v2.evidence_strength.computed_evidence ?? 0).toFixed(1)}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div className="bg-black/30 rounded-lg p-2.5 text-center">
                  <div className="text-[9px] text-gray-500 uppercase">Validated <span className="text-gray-600">×0.4</span></div>
                  <div className="text-base font-black text-[#10B981]">{v2.evidence_strength.validated_signals ?? 0}</div>
                </div>
                <div className="bg-black/30 rounded-lg p-2.5 text-center">
                  <div className="text-[9px] text-gray-500 uppercase">Cross-Dept <span className="text-gray-600">×0.3</span></div>
                  <div className="text-base font-black text-[#3B82F6]">{v2.evidence_strength.cross_department_validations ?? 0}</div>
                </div>
                <div className="bg-black/30 rounded-lg p-2.5 text-center">
                  <div className="text-[9px] text-gray-500 uppercase">Contradictions <span className="text-gray-600">−0.2</span></div>
                  <div className="text-base font-black" style={{ color: (v2.evidence_strength.contradiction_flags ?? 0) > 0 ? '#FD4438' : '#10B981' }}>{v2.evidence_strength.contradiction_flags ?? 0}</div>
                </div>
                <div className="bg-black/30 rounded-lg p-2.5 text-center">
                  <div className="text-[9px] text-gray-500 uppercase">Weak Signals <span className="text-gray-600">−0.1</span></div>
                  <div className="text-base font-black" style={{ color: (v2.evidence_strength.weak_signal_flags ?? 0) > 1 ? '#FB923C' : '#10B981' }}>{v2.evidence_strength.weak_signal_flags ?? 0}</div>
                </div>
              </div>
            </div>
          )}

          {/* Confidence Score (§3) — replaces old simple confidence */}
          <div className="bg-gradient-to-r from-[#8B5CF6]/10 to-[#3B82F6]/10 border border-[#8B5CF6]/20 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <Gauge className="size-4 text-[#8B5CF6]" />
                Confidence Score (Final Authority)
              </h4>
              <span className="text-2xl font-black" style={{ color: v2.confidence_model.confidence_score >= 80 ? '#10B981' : v2.confidence_model.confidence_score >= 60 ? '#FB923C' : '#FD4438' }}>
                {v2.confidence_model.confidence_score}/100
              </span>
            </div>
            {v2.confidence_model.formula_inputs && (
              <div className="flex items-center gap-3 mb-3">
                {[
                  { label: 'Priority', value: v2.confidence_model.formula_inputs.priority_component, weight: '×0.4', color: '#FB923C' },
                  { label: 'Feasibility', value: v2.confidence_model.formula_inputs.feasibility_component, weight: '×0.3', color: '#3B82F6' },
                  { label: 'Evidence', value: v2.confidence_model.formula_inputs.evidence_component, weight: '×0.3', color: '#10B981' },
                ].map((c, i) => (
                  <span key={c.label} className="contents">
                    {i > 0 && <span className="text-gray-600 text-xs">+</span>}
                    <div className="bg-black/30 rounded-lg px-3 py-2 text-center flex-1">
                      <div className="text-[9px] text-gray-500 uppercase">{c.label} <span className="text-gray-600">{c.weight}</span></div>
                      <div className="text-sm font-black" style={{ color: c.color }}>{c.value}</div>
                    </div>
                  </span>
                ))}
                <span className="text-gray-600 text-xs">=</span>
                <div className="bg-black/30 rounded-lg px-3 py-2 text-center">
                  <div className="text-[9px] text-gray-500 uppercase">Scaled</div>
                  <div className="text-sm font-black text-white">{v2.confidence_model.confidence_score}</div>
                </div>
              </div>
            )}
            <p className="text-xs text-gray-400 leading-relaxed">{v2.confidence_model.confidence_reasoning}</p>
          </div>

          {/* ROI Eligibility Gate (§4) */}
          {v2.roi_eligibility && (
            <div className={`border rounded-xl p-5 ${v2.roi_eligibility.is_roi_eligible ? 'bg-[#10B981]/5 border-[#10B981]/20' : 'bg-[#FB923C]/5 border-[#FB923C]/20'}`}>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <CheckCircle2 className="size-4" style={{ color: v2.roi_eligibility.is_roi_eligible ? '#10B981' : '#FB923C' }} />
                  ROI Eligibility Gate
                </h4>
                <span className={`text-xs font-bold px-2 py-1 rounded ${v2.roi_eligibility.is_roi_eligible ? 'bg-[#10B981]/15 text-[#10B981]' : 'bg-[#FB923C]/15 text-[#FB923C]'}`}>
                  {v2.roi_eligibility.is_roi_eligible ? 'ROI CALCULABLE' : 'ROI NOT CALCULABLE YET'}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {[
                  { label: 'Baseline', pass: v2.roi_eligibility.has_measurable_baseline },
                  { label: 'KPI Defined', pass: v2.roi_eligibility.has_defined_kpi },
                  { label: 'Timeline', pass: v2.roi_eligibility.has_timeline },
                  { label: 'Feasibility ≥ 5', pass: v2.roi_eligibility.feasibility_above_5 },
                  { label: 'Confidence ≥ 60', pass: v2.roi_eligibility.confidence_above_60 },
                ].map(g => (
                  <div key={g.label} className="flex items-center gap-1.5 text-[11px]">
                    <div className={`size-3 rounded-full flex items-center justify-center ${g.pass ? 'bg-[#10B981]/20' : 'bg-[#FD4438]/20'}`}>
                      {g.pass ? <CheckCircle2 className="size-2 text-[#10B981]" /> : <XCircle className="size-2 text-[#FD4438]" />}
                    </div>
                    <span className={g.pass ? 'text-gray-400' : 'text-[#FD4438]'}>{g.label}</span>
                  </div>
                ))}
              </div>
              {v2.roi_eligibility.gate_failures.length > 0 && (
                <div className="mt-2 text-[10px] text-[#FB923C]">
                  Failures: {v2.roi_eligibility.gate_failures.join(' · ')}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* H. ASSUMPTIONS                                                      */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {v2 && v2.assumptions_used.length > 0 && (
        <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
          <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Info className="size-5 text-gray-400" />
            Assumptions
          </h3>
          <ul className="space-y-2">
            {v2.assumptions_used.map((a, idx) => (
              <li key={idx} className="flex items-start gap-2 text-sm text-gray-400">
                <span className="text-gray-600 mt-0.5">-</span>
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* I. INVESTMENT SUMMARY                                               */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {rec.investmentSummary && (
        <div className="bg-gradient-to-r from-[#10B981]/15 to-[#06D7F6]/15 border border-[#10B981]/30 rounded-xl p-6">
          <h3 className="text-xl font-bold mb-5 flex items-center gap-2">
            <DollarSign className="size-5 text-[#10B981]" />
            Investment Summary
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-black/40 rounded-lg p-5 text-center">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Estimated Cost</div>
              <div className="text-2xl font-black text-[#10B981]">{rec.investmentSummary.estimatedCostRange}</div>
            </div>
            <div className="bg-black/40 rounded-lg p-5 text-center">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Payback Period</div>
              <div className="text-2xl font-black text-[#06D7F6]">{rec.investmentSummary.paybackPeriodWeeks}</div>
            </div>
            <div className="bg-black/40 rounded-lg p-5 text-center">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">12-Month ROI</div>
              <div className="text-2xl font-black text-[#8B5CF6]">{rec.investmentSummary.roiPercent12Month}</div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* J. WHAT NOT TO DO + 90-DAY FOCUS                                    */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 90-Day Focus */}
        <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
            <Zap className="size-5 text-[#06D7F6]" />
            90-Day Focus
          </h3>
          <div className="space-y-2">
            {rec.focusAreas.map((area, idx) => (
              <div key={idx} className="flex items-start gap-3 p-2 bg-white/[0.03] border border-white/5 rounded-lg">
                <div className="flex-shrink-0 size-6 rounded-full bg-[#06D7F6]/15 text-[#06D7F6] flex items-center justify-center text-[10px] font-bold">{idx + 1}</div>
                <span className="text-sm text-gray-300">{area}</span>
              </div>
            ))}
          </div>
        </div>

        {/* What NOT to do */}
        <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
            <XCircle className="size-5 text-[#FD4438]" />
            What NOT to Do Yet
          </h3>
          <div className="space-y-2">
            {rec.notRecommended.map((item, idx) => (
              <div key={idx} className="p-3 bg-[#FD4438]/8 border border-[#FD4438]/20 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="size-3 text-[#FD4438]" />
                  <span className="font-semibold text-white text-sm">{item.service}</span>
                </div>
                <p className="text-xs text-gray-400 pl-5">{item.reason}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* K. SOLUTION BLUEPRINT (legacy — still supported)                    */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {rec.solutionBlueprint && (
        <div>
          <h3 className="text-2xl font-bold mb-4 flex items-center gap-2">
            <Target className="size-6 text-[#8B5CF6]" />
            Solution Blueprint
          </h3>
          <SolutionBlueprintView blueprint={rec.solutionBlueprint} companyName={data.lead.companyName} />
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* L. DECISION TRANSPARENCY — Why Math Chose This                      */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {rec.decisionTransparency && <DecisionTransparencyPanel transparency={rec.decisionTransparency} />}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* M. PORTFOLIO — Multi-Department Recommendations                     */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {rec.portfolio && (rec.portfolio.recommendations.length > 1 || rec.portfolio.global_priority_ranking.length > 1 || (rec.portfolio.department_scan && rec.portfolio.department_scan.length > 0)) && (
        <PortfolioPanel portfolio={rec.portfolio} primaryDomain={v2?.core_problem.problem_id} />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// DECISION TRANSPARENCY PANEL
// ════════════════════════════════════════════════════════════════════════════════

function DecisionTransparencyPanel({ transparency }: { transparency: import('@/app/core/types').DecisionTransparency }) {
  const [expanded, setExpanded] = useState(false);
  const dt = transparency;
  const DOMAIN_COLORS: Record<string, string> = {
    operations: '#FB923C', revenue: '#10B981', systems: '#3B82F6',
    governance: '#8B5CF6', customer_experience: '#06D7F6', data: '#F59E0B',
  };
  const GRADE_COLORS: Record<string, string> = { A: '#10B981', B: '#3B82F6', C: '#FB923C', D: '#FD4438', F: '#FD4438' };

  return (
    <div className="bg-gradient-to-br from-gray-900/80 to-gray-800/40 border border-white/10 rounded-xl overflow-hidden">
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-lg bg-[#8B5CF6]/20 flex items-center justify-center">
            <Eye className="size-5 text-[#8B5CF6]" />
          </div>
          <div className="text-left">
            <h3 className="text-lg font-bold text-white">Decision Transparency</h3>
            <p className="text-xs text-gray-500">Full audit trail — why math chose this priority</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-2">
            <span className="text-xs text-gray-500">Data Quality:</span>
            <span className="text-sm font-bold" style={{ color: GRADE_COLORS[dt.data_quality.quality_grade] }}>
              Grade {dt.data_quality.quality_grade}
            </span>
          </div>
          <ChevronDown className={`size-5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-6 space-y-5 border-t border-white/5 pt-5">
          {/* Domain Ranking */}
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">DOMAIN SCORING (RANKED)</div>
            <div className="space-y-2">
              {dt.ranked_domains.map(d => (
                <div key={d.domain} className="flex items-center gap-3">
                  <div className="w-36 md:w-48 flex items-center gap-2">
                    {d.is_primary && <Target className="size-3 text-[#8B5CF6] flex-shrink-0" />}
                    <span className={`text-xs font-semibold truncate ${d.is_primary ? 'text-white' : 'text-gray-400'}`}>
                      {d.rank}. {d.label}
                    </span>
                  </div>
                  <div className="flex-1 flex items-center gap-2">
                    <div className="flex-1 bg-white/5 rounded-full h-4 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500 flex items-center justify-end pr-2"
                        style={{
                          width: `${Math.max(8, d.score)}%`,
                          backgroundColor: `${DOMAIN_COLORS[d.domain] || '#8B5CF6'}${d.is_primary ? '' : '80'}`,
                        }}>
                        {d.score >= 15 && <span className="text-[10px] font-bold text-white">{d.score}</span>}
                      </div>
                    </div>
                    {d.score < 15 && <span className="text-[10px] font-bold text-gray-500 w-6">{d.score}</span>}
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{
                      backgroundColor: d.severity === 'Critical' ? 'rgba(253,68,56,0.15)' : d.severity === 'High' ? 'rgba(251,146,60,0.15)' : d.severity === 'Moderate' ? 'rgba(59,130,246,0.15)' : 'rgba(16,185,129,0.15)',
                      color: d.severity === 'Critical' ? '#FD4438' : d.severity === 'High' ? '#FB923C' : d.severity === 'Moderate' ? '#3B82F6' : '#10B981',
                    }}>{d.severity}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Score Gap Analysis */}
          <div className="bg-white/[0.03] border border-white/5 rounded-lg p-4">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">SCORE GAP ANALYSIS</div>
            <div className="flex items-center gap-4 mb-3">
              <div className="text-center">
                <div className="text-2xl font-black" style={{ color: DOMAIN_COLORS[dt.score_gap_analysis.primary_domain] }}>
                  {dt.score_gap_analysis.primary_score}
                </div>
                <div className="text-[10px] text-gray-500">Primary</div>
              </div>
              <div className="flex-1 flex items-center gap-2">
                <div className="flex-1 h-px bg-white/10" />
                <div className="px-2 py-1 bg-white/5 rounded text-xs font-bold text-white">
                  {dt.score_gap_analysis.gap_points}pt gap ({dt.score_gap_analysis.gap_percent}%)
                </div>
                <div className="flex-1 h-px bg-white/10" />
              </div>
              <div className="text-center">
                <div className="text-2xl font-black text-gray-500">{dt.score_gap_analysis.secondary_score}</div>
                <div className="text-[10px] text-gray-500">Secondary</div>
              </div>
            </div>
            {dt.score_gap_analysis.is_hybrid && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-[#FB923C]/10 border border-[#FB923C]/20 rounded text-xs text-[#FB923C] font-semibold mb-2">
                <AlertTriangle className="size-3" /> Hybrid Mode Active
              </div>
            )}
            <p className="text-xs text-gray-400 leading-relaxed">{dt.score_gap_analysis.gap_interpretation}</p>
          </div>

          {/* Confidence Factors */}
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">CONFIDENCE FACTOR BREAKDOWN</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Data Completeness', ...dt.confidence_factors.data_completeness, color: '#3B82F6' },
                { label: 'Answer Quality', ...dt.confidence_factors.answer_quality, color: '#8B5CF6' },
                { label: 'Score Gap Clarity', ...dt.confidence_factors.score_gap_clarity, color: '#10B981' },
                { label: 'Signal Density', ...dt.confidence_factors.signal_density, color: '#06D7F6' },
              ].map(f => (
                <div key={f.label} className="bg-black/40 rounded-lg p-3 text-center">
                  <div className="text-[10px] font-semibold text-gray-500 uppercase mb-1">{f.label}</div>
                  <div className="text-lg font-black" style={{ color: f.color }}>{Math.round(f.value * 100)}%</div>
                  <div className="flex items-center justify-between mt-1 text-[9px] text-gray-600">
                    <span>W: {Math.round(f.weight * 100)}%</span>
                    <span>→ {((f.contribution ?? 0) * 100).toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-white/5 rounded-full h-1 mt-1">
                    <div className="h-full rounded-full" style={{ width: `${f.value * 100}%`, backgroundColor: f.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Why Not Others */}
          {dt.why_not_others.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">WHY NOT OTHERS</div>
              <div className="space-y-2">
                {dt.why_not_others.map(w => (
                  <div key={w.domain} className="flex items-start gap-3 bg-white/[0.02] border border-white/5 rounded-lg p-3">
                    <div className="flex-shrink-0 mt-0.5">
                      <div className="size-6 rounded-full flex items-center justify-center text-[10px] font-bold text-gray-500"
                        style={{ backgroundColor: `${DOMAIN_COLORS[w.domain] || '#555'}20` }}>
                        {w.score}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-semibold text-gray-300">{w.label}</span>
                        <span className="text-[10px] text-gray-600">-{w.delta_from_primary}pts</span>
                      </div>
                      <p className="text-[11px] text-gray-500 leading-relaxed">{w.reasoning}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Data Quality + Scoring Formula */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white/[0.03] border border-white/5 rounded-lg p-4">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">DATA QUALITY</div>
              <div className="flex items-center gap-3 mb-2">
                <div className="text-3xl font-black" style={{ color: GRADE_COLORS[dt.data_quality.quality_grade] }}>
                  {dt.data_quality.quality_grade}
                </div>
                <div className="text-xs text-gray-500">
                  <div>{dt.data_quality.questions_answered}/{dt.data_quality.total_questions} questions</div>
                  <div>Avg {dt.data_quality.avg_word_count} words</div>
                  <div>{dt.data_quality.completeness_pct}% complete</div>
                </div>
              </div>
              <p className="text-[11px] text-gray-500">{dt.data_quality.quality_interpretation}</p>
            </div>
            <div className="bg-white/[0.03] border border-white/5 rounded-lg p-4">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">SCORING FORMULA</div>
              <div className="space-y-1.5">
                {[
                  { label: 'Pain Signal Density', weight: dt.scoring_formula.pain_weight },
                  { label: 'Causal Keyword Weight', weight: dt.scoring_formula.causal_weight },
                  { label: 'Maturity Penalty', weight: dt.scoring_formula.maturity_weight },
                  { label: 'Cross-Dept Bonus', weight: dt.scoring_formula.cross_dept_weight },
                ].map(f => (
                  <div key={f.label} className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">{f.label}</span>
                    <span className="font-bold text-white">{Math.round(f.weight * 100)}%</span>
                  </div>
                ))}
                <div className="pt-1 border-t border-white/5 flex items-center justify-between text-xs">
                  <span className="text-gray-400">Industry Adj.</span>
                  <span className="font-bold text-[#8B5CF6]">{dt.scoring_formula.industry_adjustment_applied ? 'Applied' : 'None'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// PORTFOLIO PANEL — Multi-Department Transformation View
// ════════════════════════════════════════════════════════════════════════════════

function PortfolioPanel({ portfolio, primaryDomain }: { portfolio: import('@/app/core/types').BusinessTransformationPortfolio; primaryDomain?: string }) {
  const [expanded, setExpanded] = useState(false);
  const ptf = portfolio;
  const DEPT_COLORS: Record<string, string> = {
    revenue_engine: '#10B981', customer_experience: '#06D7F6', operations_supply_chain: '#FB923C',
    marketing_acquisition: '#EC4899', finance_unit_economics: '#F59E0B', data_infrastructure: '#3B82F6',
    talent_process: '#8B5CF6',
    // Legacy fallbacks
    operations: '#FB923C', revenue: '#10B981', systems: '#3B82F6',
    governance: '#8B5CF6', data: '#F59E0B',
  };
  const DEP_TYPE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
    required_before: { bg: 'rgba(253,68,56,0.12)', text: '#FD4438', label: 'Required Before' },
    enhances: { bg: 'rgba(16,185,129,0.12)', text: '#10B981', label: 'Enhances' },
    'reduces-risk': { bg: 'rgba(59,130,246,0.12)', text: '#3B82F6', label: 'Reduces Risk' },
    blocks: { bg: 'rgba(253,68,56,0.12)', text: '#FD4438', label: 'Blocks' },
  };
  const SCORE_LABELS = ['Density', 'Impact', 'Automation', 'Risk'];
  const SCORE_COLORS = ['#FB923C', '#10B981', '#3B82F6', '#FD4438'];
  const qualifiedCount = ptf.department_scan?.filter(d => d.qualifies).length ?? ptf.recommendations.length;
  const totalCount = ptf.department_scan?.length ?? 7;

  return (
    <div className="bg-gradient-to-br from-[#06D7F6]/5 to-[#3B82F6]/5 border border-[#06D7F6]/20 rounded-xl overflow-hidden">
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-lg bg-[#06D7F6]/20 flex items-center justify-center">
            <Layers className="size-5 text-[#06D7F6]" />
          </div>
          <div className="text-left">
            <h3 className="text-lg font-bold text-white">Transformation Portfolio</h3>
            <p className="text-xs text-gray-500">
              {qualifiedCount}/{totalCount} departments qualify · {ptf.capital_allocation_model.total_estimated_investment} · {ptf.execution_sequence_model.total_duration_days}d
            </p>
          </div>
        </div>
        <ChevronDown className={`size-5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="px-5 pb-6 space-y-5 border-t border-white/5 pt-5">
          {/* Business Snapshot */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'Company', value: ptf.business_snapshot.company, color: '#FFF' },
              { label: 'Industry', value: ptf.business_snapshot.industry, color: '#FFF' },
              { label: 'Team', value: `~${ptf.business_snapshot.employee_estimate}`, color: '#3B82F6' },
              { label: 'Data', value: `${Math.round(ptf.business_snapshot.data_completeness * 100)}%`, color: '#10B981' },
              { label: 'Signals', value: String(ptf.business_snapshot.total_signals_detected), color: '#8B5CF6' },
            ].map(item => (
              <div key={item.label} className="bg-black/30 rounded-lg p-3 text-center">
                <div className="text-[10px] font-semibold text-gray-500 uppercase">{item.label}</div>
                <div className="text-sm font-bold mt-0.5 truncate" style={{ color: item.color }}>{item.value}</div>
              </div>
            ))}
          </div>

          {/* 7-Department Scan */}
          {ptf.department_scan && ptf.department_scan.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">DEPARTMENT SCAN — 4-SCORE MATRIX</div>
              <div className="space-y-2">
                {[...ptf.department_scan].sort((a, b) => b.computed_priority - a.computed_priority).map(dept => {
                  const c = DEPT_COLORS[dept.department] || '#8B5CF6';
                  const deptScores = [dept.problem_density_score, dept.impact_potential_score, dept.automation_feasibility_score, dept.risk_exposure_score];
                  return (
                    <div key={dept.department} className={`rounded-lg p-3 border ${dept.qualifies ? 'bg-white/[0.03] border-white/10' : 'bg-white/[0.01] border-white/5 opacity-60'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="size-2 rounded-full" style={{ backgroundColor: c }} />
                          <span className="text-xs font-bold text-white">{dept.label}</span>
                          {dept.qualifies ? (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#10B981]/15 text-[#10B981] uppercase">Qualifies</span>
                          ) : (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-white/5 text-gray-600 uppercase">Below threshold</span>
                          )}
                        </div>
                        <span className="text-xs font-black" style={{ color: c }}>{(dept.computed_priority ?? 0).toFixed(1)}</span>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        {deptScores.map((s, i) => (
                          <div key={SCORE_LABELS[i]} className="text-center">
                            <div className="text-[9px] text-gray-600 mb-0.5">{SCORE_LABELS[i]}</div>
                            <div className="w-full bg-white/5 rounded-full h-1.5">
                              <div className="h-full rounded-full" style={{ width: `${s * 10}%`, backgroundColor: SCORE_COLORS[i] }} />
                            </div>
                            <div className="text-[10px] font-bold mt-0.5" style={{ color: i === 3 ? (s >= 7 ? '#FD4438' : '#10B981') : SCORE_COLORS[i] }}>{s}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 text-[10px] text-gray-600">Threshold: density ≥ 6 AND impact ≥ 6 · Priority = impact×0.4 + automation×0.3 + density×0.2 - risk×0.1</div>
            </div>
          )}

          {/* Priority Ranking */}
          {ptf.global_priority_ranking.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">EXECUTION PRIORITY (RANKED)</div>
            <div className="space-y-2">
              {ptf.global_priority_ranking.map(r => {
                const rec = ptf.recommendations.find(rc => rc.recommendation_id === r.recommendation_id);
                const dept = (r as any).department || (r as any).domain || '';
                const isPrimary = dept === primaryDomain || rec?.core_problem.problem_id === primaryDomain;
                const c = DEPT_COLORS[dept] || '#8B5CF6';
                return (
                  <div key={r.recommendation_id}
                    className={`flex items-center gap-3 rounded-lg p-3 border ${isPrimary ? 'bg-white/[0.04] border-white/10' : 'bg-white/[0.02] border-white/5'}`}>
                    <div className="size-8 rounded-full flex items-center justify-center text-sm font-black text-white"
                      style={{ backgroundColor: `${c}30` }}>{r.rank}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white truncate">{rec?.core_problem.problem_title || dept}</span>
                        {isPrimary && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#8B5CF6]/20 text-[#8B5CF6] uppercase">Primary</span>}
                      </div>
                      <div className="text-[10px] text-gray-500">Severity: {rec?.core_problem.severity_score}/10 · Priority: {r.computed_priority}</div>
                    </div>
                    <div className="text-right hidden md:block">
                      <div className="text-xs font-bold text-gray-300">{r.cumulative_investment_at_rank}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          )}

          {/* Cross-Dependencies */}
          {ptf.cross_dependencies.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">CROSS-DEPENDENCIES</div>
              <div className="space-y-2">
                {ptf.cross_dependencies.map((dep, idx) => {
                  const style = DEP_TYPE_COLORS[dep.dependency_type] || DEP_TYPE_COLORS.enhances;
                  return (
                    <div key={idx} className="flex items-center gap-2 bg-white/[0.02] border border-white/5 rounded-lg p-3 text-xs">
                      <span className="font-semibold" style={{ color: DEPT_COLORS[(dep as any).source_department || (dep as any).source_domain] }}>{((dep as any).source_department || (dep as any).source_domain || '').replace(/_/g, ' ')}</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase" style={{ backgroundColor: style.bg, color: style.text }}>{style.label}</span>
                      <ArrowRight className="size-3 text-gray-600" />
                      <span className="font-semibold" style={{ color: DEPT_COLORS[(dep as any).target_department || (dep as any).target_domain] }}>{((dep as any).target_department || (dep as any).target_domain || '').replace(/_/g, ' ')}</span>
                      <span className="text-gray-500 flex-1 text-[11px] hidden md:inline truncate">— {dep.description}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Capital Allocation + Efficiency */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white/[0.03] border border-white/5 rounded-lg p-4">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">BUDGET ALLOCATION</div>
              <div className="space-y-2">
                {ptf.capital_allocation_model.allocations.map(a => {
                  const deptId = (a as any).department || (a as any).domain || '';
                  return (
                  <div key={a.recommendation_id} className="flex items-center gap-2">
                    <div className="w-28 text-[11px] font-semibold text-gray-400 truncate">{deptId.replace(/_/g, ' ')}</div>
                    <div className="flex-1 bg-white/5 rounded-full h-3">
                      <div className="h-full rounded-full flex items-center justify-end pr-1.5"
                        style={{ width: `${Math.max(10, a.percent_of_budget)}%`, backgroundColor: DEPT_COLORS[deptId] || '#8B5CF6' }}>
                        <span className="text-[8px] font-bold text-white">{a.percent_of_budget}%</span>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold text-gray-400 w-12 text-right">{a.estimated_cost}</span>
                  </div>
                  );
                })}
                <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                  <span className="text-xs text-gray-500">Total</span>
                  <span className="text-sm font-black text-[#10B981]">{ptf.capital_allocation_model.total_estimated_investment}</span>
                </div>
              </div>
            </div>
            <div className="bg-white/[0.03] border border-white/5 rounded-lg p-4">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">CAPITAL EFFICIENCY</div>
              <div className="space-y-2">
                {ptf.capital_allocation_model.capital_efficiency_ranking.map((ce, idx) => {
                  const ceId = (ce as any).department || (ce as any).domain || '';
                  return (
                  <div key={ce.recommendation_id} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-600 w-4">{idx + 1}.</span>
                      <span className="font-semibold" style={{ color: DEPT_COLORS[ceId] || '#8B5CF6' }}>{ceId.replace(/_/g, ' ')}</span>
                    </div>
                    <span className="font-bold text-white">{(ce.roi_per_dollar ?? 0).toFixed(1)}x</span>
                  </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Execution Sequence */}
          <div className="bg-white/[0.03] border border-white/5 rounded-lg p-4">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">EXECUTION SEQUENCE</div>
            <div className="flex items-center gap-2 flex-wrap mb-3">
              {ptf.execution_sequence_model.recommended_execution_order.map((id, idx) => {
                const rec = ptf.recommendations.find(r => r.recommendation_id === id);
                const dept = rec?.core_problem.problem_id || '';
                const c = DEPT_COLORS[dept] || '#8B5CF6';
                return (
                  <span key={id} className="contents">
                    {idx > 0 && <ArrowRight className="size-3 text-gray-600" />}
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold"
                      style={{ backgroundColor: `${c}20`, color: c, border: `1px solid ${c}30` }}>
                      {dept.replace(/_/g, ' ')}
                    </span>
                  </span>
                );
              })}
            </div>
            {ptf.execution_sequence_model.sequencing_rules_applied && ptf.execution_sequence_model.sequencing_rules_applied.length > 0 && (
              <div className="mb-2 space-y-1">
                {ptf.execution_sequence_model.sequencing_rules_applied.map((rule, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-[10px] text-gray-400">
                    <CheckCircle2 className="size-3 text-[#8B5CF6] flex-shrink-0" />
                    {rule}
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-gray-500 leading-relaxed">{ptf.execution_sequence_model.sequence_reasoning}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 4️⃣ ROI & IMPACT ESTIMATES SECTION
// ============================================================================

export function ROISection({ data, onPortfolioUpdate }: { data: CortexLeadData; onPortfolioUpdate?: (newState: import('@/app/core/types').PortfolioState, result: import('@/app/core/types').RecalcResult) => void }) {
  const [notes, setNotes] = useState(data.roiEstimate.notes);
  const [confidence, setConfidence] = useState(data.roiEstimate.confidenceLevel);
  const roi = data.roiModel;

  const DEPT_COLORS: Record<string, string> = {
    revenue_engine: '#10B981', customer_experience: '#06D7F6', operations_supply_chain: '#FB923C',
    marketing_acquisition: '#EC4899', finance_unit_economics: '#F59E0B', data_infrastructure: '#3B82F6',
    talent_process: '#8B5CF6', operations: '#FB923C', revenue: '#10B981', systems: '#3B82F6',
    governance: '#8B5CF6', data: '#F59E0B',
  };

  // If we have the new ROI model, render the wireframe-compliant layout (roi-wireframe.md)
  if (roi) {
    const roiSummary = `Total investment: ${roi.portfolio_totals.total_investment_label}. 12-month adjusted gain: $${Math.round((roi.portfolio_totals.total_adjusted_gain_12mo ?? 0) / 1000)}K. ROI: ${roi.portfolio_totals.total_adjusted_roi_percent}%. Payback: ${roi.portfolio_payback_months}mo.`;
    return (
      <div className="space-y-4">
        <AIToolbar
          sectionId="roi"
          sectionLabel="ROI Summary"
          sectionContent={roiSummary}
          leadContext={{
            companyName: data.lead?.companyName ?? '',
            industry: data.lead?.industry ?? '',
            companySize: String(data.lead?.employeeEstimate ?? ''),
            primaryPainSignal: data.lead?.primaryPainSignal ?? '',
            roiSummary,
          }}
          actions={[
            { label: 'ROI Executive Summary', prompt: 'Generate a concise executive-ready ROI summary paragraph. Use only the exact numbers provided — do not fabricate new figures.' },
            { label: 'Investment Framing', prompt: 'Reframe the ROI as an investment decision rather than a cost. Use the existing figures and payback period.', icon: 'arrow' },
            { label: 'Conservative Case', prompt: 'Write a conservative ROI narrative that manages expectations while still demonstrating clear value.', icon: 'message' },
          ]}
        />
        <ROITabLayout
          roi={roi}
          portfolioState={data.portfolioState}
          sensitivityData={(roiAnalysisJSON as ROIAnalysisData).sensitivity_analysis}
          onPortfolioUpdate={onPortfolioUpdate}
        />
      </div>
    );
  }

  if (roi /* legacy block unreachable — kept for reference */) {
    const eligible = roi.recommendation_rois.filter((r) => r.is_roi_eligible);
    const locked   = roi.recommendation_rois.filter((r) => !r.is_roi_eligible);
    return (
      <div className="space-y-6">
        {/* Legacy panel stack — superseded by ROITabLayout */}

        {/* Portfolio Summary */}
        <div className="bg-gradient-to-r from-[#10B981]/10 to-[#06D7F6]/10 border border-[#10B981]/20 rounded-xl p-6">
          <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <DollarSign className="size-5 text-[#10B981]" />
            Portfolio ROI Summary
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            {[
              { label: 'Total Investment', value: roi.portfolio_totals.total_investment_label, color: '#FFF' },
              { label: '12-Month Gain', value: `$${Math.round(roi.portfolio_totals.total_adjusted_gain_12mo / 1000)}K`, color: '#10B981' },
              { label: 'Adjusted ROI', value: `${roi.portfolio_totals.total_adjusted_roi_percent}%`, color: roi.portfolio_totals.total_adjusted_roi_percent >= 100 ? '#10B981' : roi.portfolio_totals.total_adjusted_roi_percent >= 0 ? '#FB923C' : '#FD4438' },
              { label: 'Payback', value: roi.portfolio_payback_months < 1 ? '<1mo' : `${roi.portfolio_payback_months}mo`, color: '#06D7F6' },
            ].map(m => (
              <div key={m.label} className="bg-black/30 rounded-lg p-4 text-center">
                <div className="text-[10px] font-semibold text-gray-500 uppercase mb-1">{m.label}</div>
                <div className="text-2xl font-black" style={{ color: m.color }}>{m.value}</div>
              </div>
            ))}
          </div>
          <div className="text-[10px] text-gray-500 text-center">
            Risk-adjusted return: ${Math.round(roi.portfolio_totals.risk_adjusted_return / 1000)}K · Formula: Adjusted ROI = Raw ROI × (Confidence / 100)
          </div>
        </div>

        {/* §4 — Three-Case Range */}
        <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <BarChart3 className="size-5 text-[#8B5CF6]" />
            Portfolio Range (3-Case Model)
          </h3>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Low Case', sub: '60% efficiency', gain: roi.portfolio_range.low_case_total, roiPct: roi.portfolio_range.low_case_roi, color: '#FD4438' },
              { label: 'Mid Case', sub: '80% efficiency', gain: roi.portfolio_range.mid_case_total, roiPct: roi.portfolio_range.mid_case_roi, color: '#FB923C' },
              { label: 'High Case', sub: '100% efficiency', gain: roi.portfolio_range.high_case_total, roiPct: roi.portfolio_range.high_case_roi, color: '#10B981' },
            ].map(c => (
              <div key={c.label} className="bg-white/[0.02] border border-white/5 rounded-lg p-4 text-center">
                <div className="text-xs font-semibold text-gray-400 uppercase">{c.label}</div>
                <div className="text-[10px] text-gray-600 mb-2">{c.sub}</div>
                <div className="text-xl font-black" style={{ color: c.color }}>${Math.round(c.gain / 1000)}K</div>
                <div className="text-sm font-bold mt-1" style={{ color: c.roiPct >= 0 ? c.color : '#FD4438' }}>{c.roiPct}% ROI</div>
              </div>
            ))}
          </div>
        </div>

        {/* Per-Recommendation ROI */}
        {eligible.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <TrendingUp className="size-5 text-[#10B981]" />
              Per-Department ROI
            </h3>
            {eligible.map(r => {
              const c = DEPT_COLORS[r.department] || '#8B5CF6';
              return (
                <div key={r.recommendation_id} className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="size-3 rounded-full" style={{ backgroundColor: c }} />
                      <span className="text-sm font-bold text-white">{r.department.replace(/_/g, ' ')}</span>
                    </div>
                    <span className="text-lg font-black" style={{ color: r.adjusted_roi_percent >= 100 ? '#10B981' : r.adjusted_roi_percent >= 0 ? '#FB923C' : '#FD4438' }}>
                      {r.display.adjusted_roi_label}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
                    {[
                      { label: 'Investment', value: r.display.investment, color: '#FFF' },
                      { label: '90-Day Gain', value: r.display.gain_90d, color: '#3B82F6' },
                      { label: '12-Month Gain', value: r.display.gain_12mo, color: '#10B981' },
                      { label: 'Payback', value: r.display.payback_timeline, color: '#06D7F6' },
                      { label: 'Conf-Adj ROI', value: r.display.adjusted_roi_label, color: '#8B5CF6' },
                    ].map(f => (
                      <div key={f.label} className="bg-white/[0.02] rounded-lg p-2 text-center">
                        <div className="text-[9px] text-gray-600 uppercase">{f.label}</div>
                        <div className="text-sm font-bold" style={{ color: f.color }}>{f.value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-gray-500 mb-2">
                    <span>Low: ${Math.round(r.roi_range.low_case.gain / 1000)}K ({r.roi_range.low_case.roi_percent}%)</span><span>·</span>
                    <span>Mid: ${Math.round(r.roi_range.mid_case.gain / 1000)}K ({r.roi_range.mid_case.roi_percent}%)</span><span>·</span>
                    <span>High: ${Math.round(r.roi_range.high_case.gain / 1000)}K ({r.roi_range.high_case.roi_percent}%)</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {r.impact_calculations.revenue_impact && (
                      <span className="text-[9px] px-2 py-0.5 rounded bg-[#10B981]/10 text-[#10B981]">Revenue: ${Math.round(r.impact_calculations.revenue_impact.projected_gain / 1000)}K</span>
                    )}
                    {r.impact_calculations.cost_reduction && (
                      <span className="text-[9px] px-2 py-0.5 rounded bg-[#3B82F6]/10 text-[#3B82F6]">Cost Savings: ${Math.round(r.impact_calculations.cost_reduction.savings / 1000)}K</span>
                    )}
                    {r.impact_calculations.risk_reduction && (
                      <span className="text-[9px] px-2 py-0.5 rounded bg-[#8B5CF6]/10 text-[#8B5CF6]">Risk Avoided: ${Math.round(r.impact_calculations.risk_reduction.expected_loss_avoided / 1000)}K</span>
                    )}
                  </div>
                  <div className="space-y-0.5">
                    {r.display.assumptions.map((a, idx) => (<div key={idx} className="text-[9px] text-gray-600">- {a}</div>))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Locked */}
        {locked.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-bold text-gray-400 flex items-center gap-2">
              <AlertTriangle className="size-4 text-[#FB923C]" />
              ROI Not Calculable Yet
            </h4>
            {locked.map(r => (
              <div key={r.recommendation_id} className="bg-[#FB923C]/5 border border-[#FB923C]/20 rounded-lg p-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="size-2 rounded-full" style={{ backgroundColor: DEPT_COLORS[r.department] || '#8B5CF6' }} />
                  <span className="text-xs font-bold text-gray-400">{r.department.replace(/_/g, ' ')}</span>
                </div>
                <span className="text-[10px] text-[#FB923C]">{r.roi_locked_reason}</span>
              </div>
            ))}
          </div>
        )}

        {/* Execution Impact Curve */}
        {roi.execution_impact_curve.length > 1 && (
          <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-5">
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
              <Activity className="size-4 text-[#06D7F6]" />
              Execution Order Impact Curve
            </h3>
            <div className="space-y-2">
              {roi.execution_impact_curve.map(step => {
                const sc = DEPT_COLORS[step.department] || '#8B5CF6';
                const maxInv = roi.execution_impact_curve[roi.execution_impact_curve.length - 1].cumulative_investment || 1;
                const maxGain = roi.execution_impact_curve[roi.execution_impact_curve.length - 1].cumulative_gain_12mo || 1;
                return (
                  <div key={step.recommendation_id} className="flex items-center gap-3">
                    <div className="size-6 rounded-full flex items-center justify-center text-[10px] font-black text-white" style={{ backgroundColor: `${sc}40` }}>{step.step}</div>
                    <div className="flex-1 space-y-1">
                      <div className="text-[10px] font-semibold text-gray-400">{step.department.replace(/_/g, ' ')}</div>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <div className="text-[8px] text-gray-600 mb-0.5">Investment</div>
                          <div className="bg-white/5 rounded-full h-2"><div className="h-full rounded-full bg-[#FD4438]" style={{ width: `${Math.max(5, (step.cumulative_investment / maxInv) * 100)}%` }} /></div>
                        </div>
                        <div className="flex-1">
                          <div className="text-[8px] text-gray-600 mb-0.5">12mo Gain</div>
                          <div className="bg-white/5 rounded-full h-2"><div className="h-full rounded-full bg-[#10B981]" style={{ width: `${Math.max(5, (step.cumulative_gain_12mo / maxGain) * 100)}%` }} /></div>
                        </div>
                      </div>
                    </div>
                    <div className="text-right w-20">
                      <div className="text-xs font-black" style={{ color: step.cumulative_roi_percent >= 0 ? '#10B981' : '#FD4438' }}>{step.cumulative_roi_percent}% ROI</div>
                      <div className="text-[9px] text-gray-600">${Math.round(step.cumulative_investment / 1000)}K → ${Math.round(step.cumulative_gain_12mo / 1000)}K</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Dependency Adjustments */}
        {roi.dependency_adjustments.length > 0 && (
          <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4">
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">DEPENDENCY-SAFE ADJUSTMENTS</h4>
            <div className="space-y-1.5">
              {roi.dependency_adjustments.map((adj, idx) => (
                <div key={idx} className="flex items-center gap-2 text-[10px] text-gray-500">
                  <span className="font-semibold" style={{ color: DEPT_COLORS[adj.source_department] }}>{adj.source_department.replace(/_/g, ' ')}</span>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-[#FB923C]/10 text-[#FB923C]">
                    {adj.adjustment_type === 'efficiency_credit_only' ? 'Efficiency Only' : 'Revenue → Target'}
                  </span>
                  <ArrowRight className="size-3 text-gray-600" />
                  <span className="font-semibold" style={{ color: DEPT_COLORS[adj.target_department] }}>{adj.target_department.replace(/_/g, ' ')}</span>
                </div>
              ))}
              <div className="text-[9px] text-gray-600 mt-1">If A enables B, only B gets full revenue credit. A gets efficiency credit only. Prevents stacking fantasy ROI.</div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Fallback: legacy ROI view
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-6">
        <ROIMetricCard label="Hours Saved / Month" conservative={data.roiEstimate.hoursSavedPerMonth.conservative} aggressive={data.roiEstimate.hoursSavedPerMonth.aggressive} unit="hrs" icon={Clock} />
        <ROIMetricCard label="Cost Avoided / Month" conservative={data.roiEstimate.costAvoidedPerMonth.conservative} aggressive={data.roiEstimate.costAvoidedPerMonth.aggressive} unit="$" icon={DollarSign} />
        <ROIMetricCard label="Revenue Leakage Reduced" conservative={data.roiEstimate.revenueLeakageReduced.conservative} aggressive={data.roiEstimate.revenueLeakageReduced.aggressive} unit="$" icon={TrendingUp} />
        <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-3"><Shield className="size-6 text-[#10B981]" /><div className="text-sm font-semibold text-gray-400">Operational Risk Reduction</div></div>
          <div className="text-3xl font-bold text-[#10B981] capitalize">{data.roiEstimate.operationalRiskReduction.replace('-', ' ')}</div>
        </div>
      </div>
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
        <h3 className="text-lg font-bold mb-4">Team Notes</h3>
        <div className="mb-4">
          <label className="text-sm text-gray-400 mb-2 block">Confidence Level</label>
          <div className="flex gap-2">
            {(['needs-validation', 'conservative', 'aggressive'] as const).map(level => (
              <button key={level} onClick={() => setConfidence(level)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${confidence === level ? 'bg-[#8B5CF6] text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>
                {level.replace('-', ' ').toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full h-32 bg-white/5 border border-white/10 rounded-lg p-3 text-white resize-none focus:outline-none focus:border-[#8B5CF6]" placeholder="Add context, assumptions, or things to validate on call..." />
        <button className="mt-4 px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-lg transition-colors font-medium">Save Notes</button>
      </div>
      {data.roiEstimate.monthlyProjections && data.roiEstimate.scenarioComparison && data.roiEstimate.breakEvenAnalysis && data.roiEstimate.editableAssumptions && (
        <EnhancedROIView monthlyProjections={data.roiEstimate.monthlyProjections} scenarioComparison={data.roiEstimate.scenarioComparison} breakEvenAnalysis={data.roiEstimate.breakEvenAnalysis} editableAssumptions={data.roiEstimate.editableAssumptions} companyName={data.lead.companyName} />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// "WHAT CHANGED" BANNER — Visible summary after recalculation
// ════════════════════════════════════════════════════════════════════════════════

function WhatChangedBanner({ portfolioState }: { portfolioState: import('@/app/core/types').PortfolioState }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const latest = portfolioState.history[0];
  if (!latest || latest.source === 'initial') return null;

  const changedEngines = Object.entries(latest.recalc).filter(([, v]) => v).map(([k]) => k);
  const dcf = latest.dcf_delta_summary;
  const hasFinanceChange = latest.finance_recalc_required;

  return (
    <div className="bg-gradient-to-r from-[#06D7F6]/10 to-[#8B5CF6]/10 border border-[#06D7F6]/30 rounded-xl p-4 relative">
      <button onClick={() => setDismissed(true)} className="absolute top-2 right-2 text-gray-600 hover:text-white transition-colors">
        <X className="size-4" />
      </button>
      <div className="flex items-start gap-3">
        <div className="size-8 rounded-lg bg-[#06D7F6]/20 flex items-center justify-center flex-shrink-0">
          <RefreshCw className="size-4 text-[#06D7F6]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-black text-white">{latest.version}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold uppercase bg-[#06D7F6]/15 text-[#06D7F6]">
              {latest.source}
            </span>
            <span className="text-[10px] text-gray-600">
              {latest.actor} · {new Date(latest.timestamp).toLocaleString()}
            </span>
          </div>
          <div className="text-sm text-white/80 mb-2">{latest.summary}</div>

          {/* Delta log */}
          {latest.delta_log.length > 0 && (
            <div className="space-y-0.5 mb-2">
              {latest.delta_log.map((d, i) => (
                <div key={i} className="text-[10px] flex items-center gap-1.5">
                  <span className="text-[#FB923C] font-semibold">{d.path.split('.').pop()?.replace(/_/g, ' ')}</span>
                  <span className="text-gray-600">{String(d.old)}</span>
                  <ArrowRight className="size-3 text-gray-600" />
                  <span className="text-[#10B981] font-semibold">{String(d.new_value)}</span>
                  {d.reason && <span className="text-gray-700 text-[9px]">({d.reason})</span>}
                </div>
              ))}
            </div>
          )}

          {/* ── finance_v1_dcf: DCF delta callout ── */}
          {dcf && (
            <div className="flex flex-wrap items-center gap-3 mb-2 px-3 py-2 bg-[#8B5CF6]/8 border border-[#8B5CF6]/15 rounded-lg">
              <span className="text-[9px] font-bold uppercase tracking-wider text-[#8B5CF6]">DCF</span>
              {/* NPV delta */}
              <span className="flex items-center gap-1 text-[10px]">
                <span className="text-gray-500">NPV</span>
                <span className="font-mono text-gray-400">${(dcf.npv_old / 1000).toFixed(0)}K</span>
                <ArrowRight className="size-3 text-gray-600" />
                <span className={`font-mono font-bold ${dcf.npv_new >= 0 ? 'text-[#10B981]' : 'text-[#FD4438]'}`}>
                  ${(dcf.npv_new / 1000).toFixed(0)}K
                </span>
                <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${dcf.npv_delta >= 0 ? 'bg-[#10B981]/10 text-[#10B981]' : 'bg-[#FD4438]/10 text-[#FD4438]'}`}>
                  {dcf.npv_delta >= 0 ? '+' : ''}${(dcf.npv_delta / 1000).toFixed(0)}K
                </span>
              </span>
              {/* Rate delta */}
              {dcf.discount_rate_old !== dcf.discount_rate_new && (
                <span className="flex items-center gap-1 text-[10px]">
                  <span className="text-gray-500">Rate</span>
                  <span className="font-mono text-gray-400">{dcf.discount_rate_old}%</span>
                  <ArrowRight className="size-3 text-gray-600" />
                  <span className="font-mono font-bold text-[#8B5CF6]">{dcf.discount_rate_new}%</span>
                </span>
              )}
              {/* Discounted payback delta */}
              {dcf.payback_delta !== null && dcf.payback_delta !== 0 && (
                <span className="flex items-center gap-1 text-[10px]">
                  <span className="text-gray-500">DCF Payback</span>
                  <span className="font-mono text-gray-400">M{dcf.discounted_payback_old ?? '?'}</span>
                  <ArrowRight className="size-3 text-gray-600" />
                  <span className="font-mono font-bold text-[#FB923C]">M{dcf.discounted_payback_new ?? '?'}</span>
                  <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${(dcf.payback_delta ?? 0) <= 0 ? 'bg-[#10B981]/10 text-[#10B981]' : 'bg-[#FB923C]/10 text-[#FB923C]'}`}>
                    {(dcf.payback_delta ?? 0) >= 0 ? '+' : ''}{dcf.payback_delta}mo
                  </span>
                </span>
              )}
            </div>
          )}

          {/* ── finance_v2_dcf_irr: IRR delta callout ── */}
          {(() => {
            const irr = latest.irr_delta_summary;
            if (!irr) return null;
            const hasIRRDelta = irr.irr_delta !== null && irr.irr_delta !== 0;
            const statusChanged = irr.status_old !== irr.status_new;
            if (!hasIRRDelta && !statusChanged) return null;
            return (
              <div className="flex flex-wrap items-center gap-3 mb-2 px-3 py-2 bg-[#06D7F6]/5 border border-[#06D7F6]/10 rounded-lg">
                <span className="text-[9px] font-bold uppercase tracking-wider text-[#06D7F6]">IRR</span>
                {hasIRRDelta && (
                  <span className="flex items-center gap-1 text-[10px]">
                    <span className="text-gray-500">Annual</span>
                    <span className="font-mono text-gray-400">{irr.irr_annual_old?.toFixed(1) ?? '—'}%</span>
                    <ArrowRight className="size-3 text-gray-600" />
                    <span className={`font-mono font-bold ${(irr.irr_annual_new ?? 0) > 0 ? 'text-[#06D7F6]' : 'text-[#FD4438]'}`}>
                      {irr.irr_annual_new?.toFixed(1) ?? '—'}%
                    </span>
                    <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${(irr.irr_delta ?? 0) >= 0 ? 'bg-[#10B981]/10 text-[#10B981]' : 'bg-[#FD4438]/10 text-[#FD4438]'}`}>
                      {(irr.irr_delta ?? 0) >= 0 ? '+' : ''}{irr.irr_delta?.toFixed(1) ?? '—'}pp
                    </span>
                  </span>
                )}
                {statusChanged && (
                  <span className="flex items-center gap-1 text-[10px]">
                    <span className="text-gray-500">Status</span>
                    <span className="text-gray-400">{irr.status_old.replace(/_/g, ' ')}</span>
                    <ArrowRight className="size-3 text-gray-600" />
                    <span className={`font-bold ${irr.status_new === 'converged' ? 'text-[#10B981]' : 'text-[#FB923C]'}`}>
                      {irr.status_new.replace(/_/g, ' ')}
                    </span>
                  </span>
                )}
              </div>
            );
          })()}

          {/* finance_recalc_required stale notice (no dcf_delta yet) */}
          {hasFinanceChange && !dcf && (
            <div className="flex items-center gap-2 mb-2 px-3 py-1.5 bg-[#FB923C]/8 border border-[#FB923C]/15 rounded-lg">
              <AlertTriangle className="size-3 text-[#FB923C] flex-shrink-0" />
              <span className="text-[10px] text-[#FB923C] font-medium">
                DCF + IRR recalculation flagged — NPV and IRR may be stale. Use the DCF Panel to refresh.
              </span>
            </div>
          )}

          {/* Scenario switch notice */}
          {latest.scenario_switched && latest.scenario_delta_summary && (
            <div className="flex items-center gap-2 mb-2 px-3 py-1.5 bg-[#8B5CF6]/8 border border-[#8B5CF6]/15 rounded-lg">
              <Activity className="size-3 text-[#8B5CF6] flex-shrink-0" />
              <span className="text-[10px] text-[#8B5CF6] font-medium">
                Scenario switched: <strong>{latest.scenario_delta_summary.scenario_old}</strong> → <strong>{latest.scenario_delta_summary.scenario_new}</strong>
                {latest.scenario_delta_summary.roi_old !== null && (
                  <span className="contents"> · ROI: {latest.scenario_delta_summary.roi_old.toFixed(0)}% → {latest.scenario_delta_summary.roi_new.toFixed(0)}%</span>
                )}
                {' '}· Monte Carlo re-simulated under new scenario.
              </span>
            </div>
          )}

          {/* Monte Carlo recalculated notice */}
          {latest.roi_recalculated && !latest.scenario_switched && (
            <div className="flex items-center gap-2 mb-2 px-3 py-1.5 bg-[#8B5CF6]/8 border border-[#8B5CF6]/15 rounded-lg">
              <Activity className="size-3 text-[#8B5CF6] flex-shrink-0" />
              <span className="text-[10px] text-[#8B5CF6] font-medium">
                Monte Carlo re-simulated — probability bands and payback distributions reflect latest portfolio state.
              </span>
            </div>
          )}

          {/* Recalculated engines */}
          <div className="flex flex-wrap gap-1">
            <span className="text-[9px] text-gray-500 mr-1">Recalculated:</span>
            {changedEngines.map(engine => (
              <span key={engine} className="text-[8px] px-1.5 py-0.5 rounded bg-[#8B5CF6]/10 text-[#8B5CF6] font-semibold">
                {engine.replace('cortex_', '')}
              </span>
            ))}
            {hasFinanceChange && (
              <span className="text-[8px] px-1.5 py-0.5 rounded bg-[#FB923C]/10 text-[#FB923C] font-semibold border border-[#FB923C]/20">
                finance_v1_dcf
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// VERSION METADATA STRIP (§8 — Enterprise-grade per-recommendation card)
// ════════════════════════════════════════════════════════════════════════════════

function VersionMetadataStrip({ v2, portfolioState, onPortfolioUpdate }: {
  v2: import('@/app/core/types').RecommendationV2;
  portfolioState?: import('@/app/core/types').PortfolioState;
  onPortfolioUpdate?: (state: import('@/app/core/types').PortfolioState, result: import('@/app/core/types').RecalcResult) => void;
}) {
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [showDeltaLog, setShowDeltaLog] = useState(false);
  const [revertingTo, setRevertingTo] = useState<string | null>(null);

  const version = portfolioState?.current_version || `v${v2.calc_version || 1}`;
  const history = portfolioState?.history || [];
  const latestRecord = history[0];
  const isApproved = latestRecord?.is_approved || false;
  const confScore = v2.confidence_model?.confidence_score ?? 0;
  const confColor = confScore >= 80 ? '#10B981' : confScore >= 60 ? '#FB923C' : '#FD4438';

  return (
    <div className="bg-black/30 border border-white/5 rounded-lg p-3 mb-4 space-y-2">
      {/* Top row: version + confidence + status + last updated */}
      <div className="flex flex-wrap items-center gap-2 text-[10px]">
        {/* Version badge */}
        <span className={`px-2 py-0.5 rounded font-black uppercase tracking-wider ${isApproved ? 'bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/30' : 'bg-[#8B5CF6]/15 text-[#8B5CF6] border border-[#8B5CF6]/30'}`}>
          {version} {isApproved && '(LOCKED)'}
        </span>

        {/* Confidence */}
        <span className="px-2 py-0.5 rounded font-bold" style={{ backgroundColor: `${confColor}15`, color: confColor, border: `1px solid ${confColor}30` }}>
          Confidence: {confScore}/100
        </span>

        {/* Calc version */}
        <span className="px-2 py-0.5 rounded bg-white/5 text-gray-500 font-semibold">
          Calc v{v2.calc_version || 1}
        </span>

        {/* Source */}
        {latestRecord && (
          <span className="text-gray-600">
            Last: {latestRecord.source} by {latestRecord.actor} · {new Date(latestRecord.timestamp).toLocaleDateString()}
          </span>
        )}

        {/* Updated summary */}
        {latestRecord && latestRecord.source !== 'initial' && (
          <span className="px-2 py-0.5 rounded bg-[#06D7F6]/10 text-[#06D7F6] font-semibold">
            {latestRecord.summary.substring(0, 80)}{latestRecord.summary.length > 80 ? '...' : ''}
          </span>
        )}
      </div>

      {/* Collapsible: Assumptions Used */}
      <div>
        <button onClick={() => setShowAssumptions(!showAssumptions)}
          className="flex items-center gap-1 text-[9px] font-semibold text-gray-500 hover:text-gray-300 uppercase tracking-wider">
          <ChevronRight className={`size-3 transition-transform ${showAssumptions ? 'rotate-90' : ''}`} />
          Assumptions ({v2.assumptions_used?.length || 0})
        </button>
        {showAssumptions && v2.assumptions_used && (
          <div className="mt-1 pl-4 space-y-0.5">
            {v2.assumptions_used.map((a, i) => (
              <div key={i} className="text-[9px] text-gray-600">- {a}</div>
            ))}
            {portfolioState?.inputs?.assumptions && (
              <div className="mt-1 pt-1 border-t border-white/5 grid grid-cols-3 gap-1">
                {Object.entries(portfolioState.inputs.assumptions).slice(0, 9).map(([k, v]) => (
                  <div key={k} className="text-[8px] text-gray-600">
                    <span className="text-gray-500">{k.replace(/_/g, ' ')}:</span> {typeof v === 'number' && k.includes('percent') ? `${v}%` : typeof v === 'number' && (k.includes('revenue') || k.includes('cost') || k.includes('order')) ? `$${v.toLocaleString()}` : v}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Collapsible: Delta Log (version history) */}
      {history.length > 0 && (
        <div>
          <button onClick={() => setShowDeltaLog(!showDeltaLog)}
            className="flex items-center gap-1 text-[9px] font-semibold text-gray-500 hover:text-gray-300 uppercase tracking-wider">
            <ChevronRight className={`size-3 transition-transform ${showDeltaLog ? 'rotate-90' : ''}`} />
            Version History ({history.length})
          </button>
          {showDeltaLog && (
            <div className="mt-1 pl-4 space-y-1.5 max-h-48 overflow-y-auto">
              {history.map((record, idx) => (
                <div key={record.version} className="text-[9px] border-l-2 pl-2 py-0.5" style={{ borderColor: record.is_approved ? '#10B981' : record.source === 'chat' ? '#06D7F6' : '#8B5CF6' }}>
                  <div className="flex items-center gap-1.5">
                    <span className="font-black text-white">{record.version}</span>
                    <span className="text-gray-600">{record.source}</span>
                    <span className="text-gray-700">{new Date(record.timestamp).toLocaleString()}</span>
                    {record.is_approved && <span className="text-[8px] px-1 py-0 rounded bg-[#10B981]/15 text-[#10B981]">APPROVED</span>}
                    {/* Revert button — only for non-current versions */}
                    {idx > 0 && portfolioState && onPortfolioUpdate && !record.is_approved && (
                      <button
                        onClick={() => {
                          setRevertingTo(record.version);
                          const result = revertToVersion(portfolioState, record.version);
                          if (result.success) {
                            onPortfolioUpdate(result.state, result);
                          }
                          setTimeout(() => setRevertingTo(null), 500);
                        }}
                        disabled={revertingTo === record.version}
                        className="ml-auto flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#FB923C]/10 hover:bg-[#FB923C]/20 text-[#FB923C] border border-[#FB923C]/20 hover:border-[#FB923C]/40 transition-all disabled:opacity-50"
                        title={`Revert to ${record.version}`}
                      >
                        {revertingTo === record.version ? (
                          <RefreshCw className="size-2.5 animate-spin" />
                        ) : (
                          <GitBranch className="size-2.5" />
                        )}
                        Revert to {record.version}
                      </button>
                    )}
                  </div>
                  <div className="text-gray-500">{record.summary}</div>
                  {record.delta_log.length > 0 && (
                    <div className="mt-0.5 space-y-0">
                      {record.delta_log.map((d, di) => (
                        <div key={di} className="text-[8px] text-gray-600">
                          <span className="text-[#FB923C]">{d.path.split('.').pop()}</span>: {String(d.old)} → <span className="text-[#10B981]">{String(d.new_value)}</span>
                          {d.reason && <span className="text-gray-700"> ({d.reason})</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Recalc flags */}
                  <div className="flex gap-1 mt-0.5 flex-wrap">
                    {Object.entries(record.recalc).filter(([, v]) => v).map(([k]) => (
                      <span key={k} className="text-[7px] px-1 rounded bg-white/5 text-gray-600">{k}</span>
                    ))}
                    {record.finance_recalc_required && (
                      <span className="text-[7px] px-1 rounded bg-[#FB923C]/10 text-[#FB923C] border border-[#FB923C]/20 font-bold">finance_v1_dcf</span>
                    )}
                  </div>
                  {/* IRR delta callout — shows IRR change for this version */}
                  {record.irr_delta_summary && (() => {
                    const irr = record.irr_delta_summary!;
                    const hasIRRDelta = irr.irr_delta !== null && Math.abs(irr.irr_delta) >= 0.01;
                    const statusChanged = irr.status_old !== irr.status_new;
                    if (!hasIRRDelta && !statusChanged) return null;
                    return (
                      <div className="mt-1 flex flex-wrap items-center gap-2 px-2 py-1 bg-[#06D7F6]/5 border border-[#06D7F6]/10 rounded text-[8px]">
                        <span className="font-bold text-[#06D7F6] uppercase tracking-wider">IRR Δ</span>
                        {hasIRRDelta && (
                          <span className="flex items-center gap-0.5 text-gray-500">
                            <span className="font-mono text-gray-400">{irr.irr_annual_old?.toFixed(1) ?? '—'}%</span>
                            →
                            <span className={`font-mono font-bold ${(irr.irr_annual_new ?? 0) > 0 ? 'text-[#06D7F6]' : 'text-[#FD4438]'}`}>
                              {irr.irr_annual_new?.toFixed(1) ?? '—'}%
                            </span>
                            <span className={`ml-0.5 font-bold ${(irr.irr_delta ?? 0) >= 0 ? 'text-[#10B981]' : 'text-[#FD4438]'}`}>
                              ({(irr.irr_delta ?? 0) >= 0 ? '+' : ''}{irr.irr_delta?.toFixed(1) ?? '—'}pp)
                            </span>
                          </span>
                        )}
                        {statusChanged && (
                          <span className="text-gray-600">
                            {irr.status_old.replace(/_/g, ' ')} → <span className={`font-bold ${irr.status_new === 'converged' ? 'text-[#10B981]' : 'text-[#FB923C]'}`}>{irr.status_new.replace(/_/g, ' ')}</span>
                          </span>
                        )}
                      </div>
                    );
                  })()}
                  {/* DCF delta callout — shows NPV/payback change for this version */}
                  {record.dcf_delta_summary && (
                    <div className="mt-1 flex flex-wrap items-center gap-2 px-2 py-1 bg-[#8B5CF6]/5 border border-[#8B5CF6]/10 rounded text-[8px]">
                      <span className="font-bold text-[#8B5CF6] uppercase tracking-wider">DCF Δ</span>
                      <span className="flex items-center gap-0.5 text-gray-500">
                        NPV <span className="font-mono text-gray-400">${(record.dcf_delta_summary.npv_old / 1000).toFixed(0)}K</span>
                        →
                        <span className={`font-mono font-bold ${record.dcf_delta_summary.npv_new >= 0 ? 'text-[#10B981]' : 'text-[#FD4438]'}`}>
                          ${(record.dcf_delta_summary.npv_new / 1000).toFixed(0)}K
                        </span>
                        <span className={`px-0.5 rounded font-bold ${record.dcf_delta_summary.npv_delta >= 0 ? 'text-[#10B981]' : 'text-[#FD4438]'}`}>
                          ({record.dcf_delta_summary.npv_delta >= 0 ? '+' : ''}${(record.dcf_delta_summary.npv_delta / 1000).toFixed(0)}K)
                        </span>
                      </span>
                      {record.dcf_delta_summary.discount_rate_old !== record.dcf_delta_summary.discount_rate_new && (
                        <span className="text-gray-600">
                          Rate: {record.dcf_delta_summary.discount_rate_old}% → <span className="text-[#8B5CF6] font-bold">{record.dcf_delta_summary.discount_rate_new}%</span>
                        </span>
                      )}
                      {record.dcf_delta_summary.payback_delta !== null && record.dcf_delta_summary.payback_delta !== 0 && (
                        <span className="text-gray-600">
                          DCF Payback: M{record.dcf_delta_summary.discounted_payback_old ?? '?'} → <span className="text-[#FB923C] font-bold">M{record.dcf_delta_summary.discounted_payback_new ?? '?'}</span>
                          <span className={`ml-0.5 font-bold ${record.dcf_delta_summary.payback_delta <= 0 ? 'text-[#10B981]' : 'text-[#FB923C]'}`}>
                            ({record.dcf_delta_summary.payback_delta >= 0 ? '+' : ''}{record.dcf_delta_summary.payback_delta}mo)
                          </span>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ROIMetricCard({ label, conservative, aggressive, unit, icon: Icon }: any) {
  return (
    <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <Icon className="size-6 text-[#8B5CF6]" />
        <div className="text-sm font-semibold text-gray-400">{label}</div>
      </div>
      
      <div className="space-y-3">
        <div>
          <div className="text-xs text-gray-500 mb-1">Conservative</div>
          <div className="text-2xl font-bold text-[#3B82F6]">
            {unit === '$' ? `$${conservative.toLocaleString()}` : `${conservative} ${unit}`}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">Aggressive</div>
          <div className="text-2xl font-bold text-[#10B981]">
            {unit === '$' ? `$${aggressive.toLocaleString()}` : `${aggressive} ${unit}`}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 5️⃣ PROPOSAL BUILDER SECTION
// ============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// Helper: generate a ProposalDraft from any CortexLeadData
// Used when data.proposal_draft is undefined (non-ExampleCo leads).
// ─────────────────────────────────────────────────────────────────────────────
function buildProposalDraftFromLead(data: CortexLeadData): ProposalDraft {
  const now      = new Date().toISOString();
  const problems = data.diagnostic.coreProblems.slice(0, 3);
  const sevMap: Record<string, DiagnosisSeverity> = {
    critical: 'critical', high: 'high', medium: 'medium', low: 'low',
  };
  // ── Resolve via the lead sub-object (CortexLeadData has no top-level leadId/companyName) ──
  const leadId      = data.lead.id;
  const companyName = data.lead.companyName;
  const primaryPain = data.lead.primaryPainSignal;

  return {
    proposal_id: `P-${leadId}`,
    status: 'draft',
    client: {
      client_id: leadId,
      company_name: companyName,
      industry: data.lead.industry,
      region: 'Global',
      primary_contact: {
        name: data.lead.contactEmail.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        title: 'Decision Maker',
        email: data.lead.contactEmail,
      },
    },
    linkage: {
      diagnostic_id: `DIAG-${leadId}`,
      portfolio_version_id: 'v1.0',
      generated_from: ['diagnostic', 'recommendations', 'roi'],
    },
    executive_brief: {
      title: `${companyName} — AI Readiness & Operational Efficiency Proposal`,
      strategic_context: `${companyName} is experiencing operational strain driven by ${primaryPain}. Our diagnostic has identified ${problems.length} core bottlenecks that are directly impacting growth trajectory and operational efficiency.`,
      why_now: `With a ${data.lead.companySize} team and current growth pressures, the cost of inaction compounds monthly. Organisations in your band that delay systematic AI integration face an average 18–24 month competitive disadvantage. Early intervention delivers the highest ROI.`,
      what_success_looks_like: `Within 30 days, ${companyName} achieves a measurable reduction in manual overhead, improved pipeline velocity, and a clear AI integration roadmap backed by validated ROI projections.`,
      positioning_statement: `MARQ Cortex brings the diagnostic clarity and implementation certainty that ${companyName} needs to unlock its next growth phase — without guesswork.`,
    },
    diagnosis_blocks: problems.map((p, i) => ({
      diagnosis_id: `DIAG-${leadId}-${i}`,
      title: p.title,
      description: p.whatsbroken || '',
      operational_impact: [
        p.whatBreaksNext || 'Operational inefficiency compounds across teams',
        'Manual workarounds increase error rate and slow delivery',
      ],
      financial_impact: [
        'Revenue leakage from process gaps',
        'Increased operating cost from manual overhead',
        p.whyBreaking ? `Root cause: ${p.whyBreaking}` : 'Systemic inefficiency drives cost escalation',
      ],
      evidence: [{
        source: 'questionnaire' as const,
        ref: p.sourceAnswers?.length ? `Q-${p.sourceAnswers.join(',')}` : 'Q-AUTO',
        note: p.whyBreaking || 'Identified and validated via Cortex diagnostic questionnaire',
      }],
      severity: (sevMap[
        p.urgencyScore >= 8 ? 'critical' :
        p.urgencyScore >= 6 ? 'high' :
        p.urgencyScore >= 4 ? 'medium' : 'low'
      ]) as DiagnosisSeverity,
      confidence: Math.min(p.urgencyScore * 10, 95),
    })),
    scope_boundaries: {
      included: [
        'AI readiness assessment and gap analysis',
        'Operational bottleneck mapping and prioritisation',
        'Priority automation opportunity identification',
        'ROI projection with scenario modelling',
        'Implementation roadmap — Phase 1 (30 days)',
      ],
      excluded: [
        'Full-scale multi-phase implementation (Phase 2+)',
        'Third-party software licensing fees',
        'Infrastructure changes outside agreed scope',
        'Ongoing management post-engagement',
      ],
      assumptions: [
        'Client provides access to key operational stakeholders',
        'Existing systems documentation is available',
        'Decision-maker engagement maintained throughout',
        'Agreed scope does not expand without a formal change order',
      ],
    },
    next_step_offer: {
      offer_name: 'AI Readiness & ROI Audit',
      price: 4500,
      currency: 'USD',
      duration: '2 weeks',
      primary_cta: 'Proceed with Audit',
      secondary_cta: 'Schedule a discovery call first',
    },
    metadata: {
      created_at: now,
      last_updated_at: now,
      created_by: 'CORTEX Auto-Generate',
      version: 1,
    },
  };
}

export function ProposalSection({ data }: { data: CortexLeadData }) {
  // Always render ProposalDraftEditor — use existing draft or auto-generate from lead data.
  // This means every lead (not just ExampleCo / lead_010) gets the full proposal system.
  const draft = data.proposal_draft ?? buildProposalDraftFromLead(data);

  return (
    <ProposalDraftEditor
      initialDraft={draft}
      onDraftChange={(updated) => {
        // Production: POST /api/proposal/:id  with updated payload
        console.log('[ProposalDraft] Saved v' + updated.metadata.version, updated);
      }}
    />
  );
}

// ============================================================================
// 6️⃣ CALL PREP PANEL SECTION
// ============================================================================

export function CallPrepSection({ data }: { data: CortexLeadData }) {
  if (!data.callPrep) {
    return (
      <div className="text-center py-12">
        <Phone className="size-16 text-gray-600 mx-auto mb-4" />
        <p className="text-gray-400 mb-4">No call scheduled yet</p>
        <button className="px-6 py-3 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-lg transition-colors font-semibold">
          Generate Call Prep
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* AI quick-generate for Call Prep */}
      <AIToolbar
        sectionId="call_prep"
        sectionLabel="Call Prep"
        sectionContent={`Company: ${data.lead?.companyName ?? ''}. Industry: ${data.lead?.industry ?? ''}. Primary pain: ${data.lead?.primaryPainSignal ?? ''}.`}
        leadContext={{
          companyName: data.lead?.companyName ?? '',
          industry: data.lead?.industry ?? '',
          companySize: String(data.lead?.employeeEstimate ?? ''),
          primaryPainSignal: data.lead?.primaryPainSignal ?? '',
        }}
        actions={[
          { label: 'Opening Gambit', prompt: 'Write a strong, confident opening 2-3 sentences for the discovery call with this client, based on their diagnostic profile.' },
          { label: 'Handle Objections', prompt: 'Suggest responses to the 3 most likely objections from this type of client in this industry.', icon: 'zap' },
          { label: 'Closing Language', prompt: 'Write soft, confident closing language for the call that moves toward a clear next step without being pushy.', icon: 'arrow' },
        ]}
      />

      {data.callPrep.scheduledFor && (
        <div className="bg-gradient-to-r from-[#10B981]/20 to-[#06D7F6]/20 border border-[#10B981]/30 rounded-xl p-6">
          <div className="flex items-center gap-4">
            <Calendar className="size-8 text-[#10B981]" />
            <div>
              <div className="text-sm text-gray-400">Call Scheduled</div>
              <div className="text-2xl font-bold text-white">
                {new Date(data.callPrep.scheduledFor).toLocaleString('en-US', {
                  weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-[#FD4438]/10 border border-[#FD4438]/30 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle className="size-6 text-[#FD4438]" />
          <h3 className="text-xl font-bold text-[#FD4438]">DO NOT PITCH YET</h3>
        </div>
        <ul className="space-y-2">
          {(data.callPrep.doNotPitchYetWarnings ?? []).map((warning, idx) => (
            <li key={idx} className="flex items-start gap-3">
              <span className="text-[#FD4438] flex-shrink-0">{'\u26A0\uFE0F'}</span>
              <span className="text-gray-300">{warning}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
        <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
          <CheckCircle2 className="size-6 text-[#8B5CF6]" />
          Suggested Agenda
        </h3>
        <ol className="space-y-3">
          {(data.callPrep.suggestedAgenda ?? []).map((item, idx) => (
            <li key={idx} className="flex items-start gap-3">
              <span className="size-6 rounded-full bg-[#8B5CF6] text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                {idx + 1}
              </span>
              <span className="text-gray-300 flex-1">{item}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
        <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
          <Target className="size-6 text-[#3B82F6]" />
          Key Questions to Validate
        </h3>
        <ul className="space-y-3">
          {(data.callPrep.keyQuestionsToValidate ?? []).map((question, idx) => (
            <li key={idx} className="flex items-start gap-3">
              <span className="text-[#3B82F6] flex-shrink-0 font-bold">?</span>
              <span className="text-gray-300">{question}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
        <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
          <AlertTriangle className="size-6 text-[#FB923C]" />
          Expected Objections & Responses
        </h3>
        <div className="space-y-4">
          {(data.callPrep.expectedObjections ?? []).map((obj, idx) => (
            <div key={idx} className="p-4 bg-white/5 rounded-lg border border-white/10">
              <div className="font-semibold text-[#FB923C] mb-2">
                Objection: &quot;{obj.objection}&quot;
              </div>
              <div className="text-sm text-gray-300">
                <span className="text-[#10B981] font-semibold">Response:</span> {obj.response}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-gradient-to-br from-[#10B981]/20 to-[#06D7F6]/20 border border-[#10B981]/30 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <Lightbulb className="size-6 text-[#10B981]" />
          <h3 className="text-xl font-bold">Expansion Signals to Listen For</h3>
        </div>
        <ul className="space-y-2">
          {(data.callPrep.expansionSignalsToListenFor ?? []).map((signal, idx) => (
            <li key={idx} className="flex items-start gap-3">
              <span className="flex-shrink-0">{signal.slice(0, 2)}</span>
              <span className="text-gray-300">{signal.slice(2)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
        <h3 className="text-xl font-bold mb-4">Call Notes</h3>
        <textarea
          defaultValue={data.callPrep.callNotes}
          className="w-full h-48 bg-white/5 border border-white/10 rounded-lg p-4 text-white resize-none focus:outline-none focus:border-[#8B5CF6]"
          placeholder="Take notes during the call..."
        />
        <button className="mt-4 px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-lg transition-colors font-medium">
          Save Notes
        </button>
      </div>
    </div>
  );
}