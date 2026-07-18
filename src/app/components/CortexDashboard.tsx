/**
 * CORTEX DECISION INTELLIGENCE SYSTEM — COMPLETE 10-MODULE BUILD
 *
 * WHO USES IT: Strategist, Ops Architect, Account Lead, AI Reviewer
 * PURPOSE: Know who came in, what's broken, what to sell, and when.
 *
 * 10 MODULES:
 * 1. Lead Intelligence (overview list)
 * 2. Diagnostic Engine
 * 3. AI Recommendation
 * 4. ROI Estimator
 * 5. Proposal Builder
 * 6. Call Prep Panel
 * 7. Reviewer / QA
 * 8. Decision Log
 * 9. Next Actions
 * 10. Outcome & Learning Loop
 *
 * + Global Learning Insights view
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, Brain, AlertTriangle, Target, Zap, DollarSign, Phone,
  FileText, TrendingUp, TrendingDown, Clock, CheckCircle2, Edit3, Send, Download,
  Eye, Flame, Shield, BarChart3, Lightbulb, Users, Calendar,
  Flag, MessageSquare, Loader2, RefreshCw, Sparkles, XCircle, Kanban, List,
  Search, ArrowUpDown, Table2, LayoutList,
} from 'lucide-react';
import { getMockLeads, getMockCortexLeadData } from '@/app/services/cortexDataService';
import {
  getReadinessColor, getPillarColor, getStatusColor, getServiceLabel,
} from '@/app/types/cortex-types';
import type { Lead, CortexLeadData, LeadStatus } from '@/app/types/cortex-types';
import {
  DiagnosticSummarySection, RecommendationSection, ROISection, ProposalSection,
  CallPrepSection,
} from '@/app/components/CortexDashboardSections';
import { LearningLoopPanel } from '@/app/components/LearningLoopPanel';
import { CortexReviewerModule } from '@/app/components/CortexReviewerModule';
import { DecisionLogModule, NextActionsModule, OutcomeModule } from '@/app/components/CortexModulesNew';
import { generateCortexData } from '@/app/services/cortexDataService';
import { PipelineKanban } from '@/app/components/PipelineKanban';
import type { OutcomePayload } from '@/app/services/dataService';
import { WinCelebration } from '@/app/components/WinCelebration';
import type { WinCelebrationData } from '@/app/components/WinCelebration';
import {
  getSubmissions, updateSubmissionStatus, getNotes, getCortexAnalysis,
  analyzeSubmission, clearCortexAnalysis, getCortexStatus, analyzeSubmissionsBatch,
  getOutcomesMap,
  type Submission, type CortexAnalysisResult, type CortexStatusEntry,
} from '@/app/services/dataService';
import { SubmissionNotesPanel } from '@/app/components/SubmissionNotesPanel';
import { TeamMessageThread } from '@/app/components/TeamMessageThread';
import { CortexProposalModule } from '@/app/components/CortexProposalModule';
import { CortexChatPanel } from '@/app/components/CortexChatPanel';
import { isBackendEnabled, isVerboseLogging, shouldShowApiErrors } from '@/config/runtime';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Merge AI analysis results onto the deterministic base CortexLeadData.
 * Only overwrites fields where the AI produced a value.
 */
function mergeAIIntoCortexData(base: CortexLeadData, ai: CortexAnalysisResult): CortexLeadData {
  return {
    ...base,
    lead: {
      ...base.lead,
      urgencyLevel: ai.urgencyLevel ?? base.lead.urgencyLevel,
      impactPotential: ai.impactPotential ?? base.lead.impactPotential,
      readinessScore: (ai.readinessScore as any) ?? base.lead.readinessScore,
      confidenceScore: (ai.confidenceScore as any) ?? base.lead.confidenceScore,
      primaryPainSignal: ai.primaryPainSignal || base.lead.primaryPainSignal,
    },
    diagnostic: {
      ...base.diagnostic,
      coreProblems: ai.coreProblems?.length
        ? ai.coreProblems.map(p => ({ ...p, editable: true }))
        : base.diagnostic.coreProblems,
      pillarHeatmap: ai.pillarHeatmap
        ? (ai.pillarHeatmap as any)
        : base.diagnostic.pillarHeatmap,
      riskFlags: ai.riskFlags?.length
        ? (ai.riskFlags as any)
        : base.diagnostic.riskFlags,
    },
    recommendation: ai.recommendation
      ? {
          ...base.recommendation,
          primaryService: (ai.recommendation.primaryService as any) ?? base.recommendation.primaryService,
          primaryServiceLabel: ai.recommendation.primaryServiceLabel ?? base.recommendation.primaryServiceLabel,
          reasoning: ai.recommendation.reasoning ?? base.recommendation.reasoning,
          notRecommended: ai.recommendation.notRecommended ?? base.recommendation.notRecommended,
          focusAreas: ai.recommendation.focusAreas ?? base.recommendation.focusAreas,
          suggestedTimeline: ai.recommendation.suggestedTimeline ?? base.recommendation.suggestedTimeline,
        }
      : base.recommendation,
    roiEstimate: ai.roiEstimate
      ? {
          ...base.roiEstimate,
          hoursSavedPerMonth: ai.roiEstimate.hoursSavedPerMonth ?? base.roiEstimate.hoursSavedPerMonth,
          costAvoidedPerMonth: ai.roiEstimate.costAvoidedPerMonth ?? base.roiEstimate.costAvoidedPerMonth,
          revenueLeakageReduced: ai.roiEstimate.revenueLeakageReduced ?? base.roiEstimate.revenueLeakageReduced,
          operationalRiskReduction: (ai.roiEstimate.operationalRiskReduction as any) ?? base.roiEstimate.operationalRiskReduction,
          notes: ai.roiEstimate.notes ?? base.roiEstimate.notes,
        }
      : base.roiEstimate,
    callPrep: ai.callPrep
      ? {
          ...(base.callPrep || {}),
          leadId: base.lead.id,
          suggestedAgenda: ai.callPrep.suggestedAgenda?.length
            ? ai.callPrep.suggestedAgenda
            : (base.callPrep?.suggestedAgenda ?? []),
          keyQuestionsToValidate: ai.callPrep.keyQuestionsToValidate?.length
            ? ai.callPrep.keyQuestionsToValidate
            : (base.callPrep?.keyQuestionsToValidate ?? []),
          expectedObjections: ai.callPrep.expectedObjections?.length
            ? ai.callPrep.expectedObjections
            : (base.callPrep?.expectedObjections ?? []),
          doNotPitchYetWarnings: ai.callPrep.doNotPitchYetWarnings?.length
            ? ai.callPrep.doNotPitchYetWarnings
            : (base.callPrep?.doNotPitchYetWarnings ?? []),
          expansionSignalsToListenFor: ai.callPrep.expansionSignalsToListenFor?.length
            ? ai.callPrep.expansionSignalsToListenFor
            : (base.callPrep?.expansionSignalsToListenFor ?? []),
        }
      : base.callPrep,
  };
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface EngagementData {
  reportViewCount: number;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
  ctaClickedAt: string | null;
  pdfPrintedAt: string | null;
}

function ClientEngagementBadge({ engagement }: { engagement: EngagementData | null }) {
  if (!engagement || !engagement.firstViewedAt) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* View count */}
      <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#06D7F6]/10 border border-[#06D7F6]/25 rounded-lg text-xs">
        <Eye className="size-3 text-[#06D7F6]" />
        <span className="text-[#06D7F6] font-medium">
          {engagement.reportViewCount} view{engagement.reportViewCount !== 1 ? 's' : ''}
        </span>
      </div>
      {/* Last viewed */}
      {engagement.lastViewedAt && (
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white/5 border border-white/10 rounded-lg text-xs text-gray-400">
          <Clock className="size-3" />
          Last viewed {timeAgo(engagement.lastViewedAt)}
        </div>
      )}
      {/* CTA clicked */}
      {engagement.ctaClickedAt && (
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#10B981]/10 border border-[#10B981]/25 rounded-lg text-xs text-[#10B981] font-medium">
          <CheckCircle2 className="size-3" />
          CTA clicked
        </div>
      )}
      {/* PDF saved */}
      {engagement.pdfPrintedAt && (
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#8B5CF6]/10 border border-[#8B5CF6]/25 rounded-lg text-xs text-[#8B5CF6]">
          <Download className="size-3" />
          PDF saved
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PROPS
// ============================================================================

interface CortexDashboardProps {
  onBack: () => void;
  onStateChange?: (state: { view: 'overview' | 'detail' | 'insights'; leadId?: string }) => void;
  currentState?: { view: 'overview' | 'detail' | 'insights'; leadId?: string };
  /** When set, jump directly to this submission's detail view */
  submissionId?: string;
  accessToken?: string;
}

// ============================================================================
// CORTEX DASHBOARD ROOT
// ============================================================================

export function CortexDashboard({
  onBack, onStateChange, currentState, submissionId, accessToken,
}: CortexDashboardProps) {
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(
    submissionId || currentState?.leadId || null
  );
  const [activeSection, setActiveSection] = useState<'overview' | 'insights'>(
    currentState?.view === 'insights' ? 'insights' : 'overview'
  );

  // If a specific submissionId is passed, jump to detail immediately;
  // otherwise reset to overview (e.g. sidebar nav click)
  useEffect(() => {
    if (submissionId) {
      setSelectedLeadId(submissionId);
      onStateChange?.({ view: 'detail', leadId: submissionId });
    } else {
      setSelectedLeadId(null);
      setActiveSection('overview');
    }
  }, [submissionId]);

  const handleSelectLead = (leadId: string) => {
    setSelectedLeadId(leadId);
    onStateChange?.({ view: 'detail', leadId });
  };

  const handleBackToOverview = () => {
    setSelectedLeadId(null);
    onStateChange?.({ view: 'overview' });
  };

  const handleViewInsights = () => {
    setActiveSection('insights');
    onStateChange?.({ view: 'insights' });
  };

  const handleBackFromInsights = () => {
    setActiveSection('overview');
    onStateChange?.({ view: 'overview' });
  };

  if (selectedLeadId) {
    return (
      <CortexLeadDetail
        leadId={selectedLeadId}
        onBack={handleBackToOverview}
        accessToken={accessToken}
      />
    );
  }

  if (activeSection === 'insights') {
    return <LearningLoopPanel onBack={handleBackFromInsights} onMainBack={onBack} accessToken={accessToken} />;
  }

  return (
    <LeadOverviewView
      onSelectLead={handleSelectLead}
      onViewInsights={handleViewInsights}
      onBack={onBack}
      accessToken={accessToken}
    />
  );
}

// ============================================================================
// MODULE 1 — LEAD OVERVIEW (HOME)
// ============================================================================

function LeadOverviewView({
  onSelectLead, onViewInsights, onBack, accessToken,
}: {
  onSelectLead: (id: string) => void;
  onViewInsights: () => void;
  onBack: () => void;
  accessToken?: string;
}) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'all' | LeadStatus>('all');
  const [cortexStatus, setCortexStatus] = useState<Record<string, CortexStatusEntry>>({});
  const [outcomesMap, setOutcomesMap] = useState<Record<string, { didConvert: boolean; conversionValue: number | null; loggedAt: string }>>({});
  const [isBatchAnalyzing, setIsBatchAnalyzing] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  // View mode toggle: cards, table, or pipeline
  const [viewMode, setViewMode] = useState<'list' | 'table' | 'pipeline'>('list');
  // Search query
  const [searchQuery, setSearchQuery] = useState('');
  // Sort
  const [sortBy, setSortBy] = useState<'date' | 'urgency' | 'readiness'>('date');

  // ── 7A: Win celebration overlay ────────────────────────────────────────────
  const [winCelebration, setWinCelebration] = useState<WinCelebrationData | null>(null);

  const loadCortexStatus = async () => {
    if (!accessToken) return;
    try {
      const r = await getCortexStatus(accessToken);
      setCortexStatus(r.analyzed || {});
    } catch (err) {
      console.warn('Could not load cortex status (non-fatal):', err);
    }
  };

  const loadOutcomesMap = async () => {
    if (!accessToken) return;
    try {
      const r = await getOutcomesMap(accessToken);
      setOutcomesMap(r.outcomes || {});
    } catch (err) {
      console.warn('Could not load outcomes map (non-fatal):', err);
    }
  };

  const loadLeads = async (silent = false) => {
    if (!silent) setIsLoading(true);
    else setIsRefreshing(true);
    try {
      // Check feature flag before making API calls
      if (!isBackendEnabled()) {
        if (isVerboseLogging()) {
          console.log('📦 Using demo data for CORTEX dashboard (backend disabled)');
        }
        setLeads(getMockLeads());
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      if (accessToken) {
        // Load leads + cortex status + outcomes in parallel
        const [result] = await Promise.all([
          getSubmissions(accessToken),
          loadCortexStatus(),
          loadOutcomesMap(),
        ]);
        const realLeads: Lead[] = (result.submissions || []).map(sub => ({
          id: sub.id,
          companyName: sub.company,
          contactEmail: sub.email,
          industry: sub.industry,
          companySize: sub.employees || 'Unknown',
          submittedAt: sub.submittedAt,
          readinessScore: (sub.completionScore >= 80 ? 'High' : sub.completionScore >= 60 ? 'Medium' : 'Low') as 'High' | 'Medium' | 'Low',
          confidenceScore: (sub.qualityScore >= 90 ? 'Very High' : sub.qualityScore >= 75 ? 'High' : 'Medium') as 'Very High' | 'High' | 'Medium' | 'Low',
          primaryPainSignal: Object.values(sub.answers || {})[0]
            ? String(Object.values(sub.answers)[0]).substring(0, 120)
            : 'Operational inefficiencies identified via diagnostic',
          status: mapToLeadStatus(sub.status),
          assignedTo: undefined,
          lastActivityAt: sub.updatedAt || sub.submittedAt,
          urgencyLevel: sub.priority === 'high' ? 8 : sub.priority === 'medium' ? 5 : 3,
          impactPotential: Math.min(Math.round(sub.completionScore / 10), 10),
        }));
        setLeads(realLeads.length > 0 ? realLeads : getMockLeads());
      } else {
        setLeads(getMockLeads());
      }
    } catch (err) {
      if (isVerboseLogging()) {
        console.error('❌ Failed to load CORTEX leads:', err);
      }
      setLeads(getMockLeads());
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => { loadLeads(); }, [accessToken]);

  const handleBatchAnalyze = async () => {
    if (!accessToken || isBatchAnalyzing) return;
    
    // Check feature flag before making API calls
    if (!isBackendEnabled()) {
      if (isVerboseLogging()) {
        console.log('📦 Batch analysis disabled (backend disabled)');
      }
      setBatchError('Backend integration is disabled. Enable it in feature flags to use AI analysis.');
      return;
    }

    const unanalyzedIds = leads
      .filter(l => !cortexStatus[l.id])
      .map(l => l.id);
    if (unanalyzedIds.length === 0) return;
    setIsBatchAnalyzing(true);
    setBatchError(null);
    setBatchProgress({ done: 0, total: unanalyzedIds.length });
    try {
      const result = await analyzeSubmissionsBatch(unanalyzedIds, accessToken);
      // Update cortex status with newly analyzed IDs
      const updatedStatus = { ...cortexStatus };
      result.results.forEach(r => {
        if (r.success) {
          updatedStatus[r.id] = {
            analyzedAt: new Date().toISOString(),
            aiScore: r.aiScore ?? 0,
            model: 'gpt-4o-mini',
            priority: 'medium',
          };
        }
      });
      setCortexStatus(updatedStatus);
      setBatchProgress({ done: result.analyzed, total: result.total });
    } catch (err: any) {
      if (isVerboseLogging()) {
        console.error('❌ Batch analysis failed:', err);
      }
      setBatchError(err.message || 'Batch analysis failed');
    } finally {
      setIsBatchAnalyzing(false);
    }
  };

  const filteredLeads = leads
    .filter(l => filterStatus === 'all' || l.status === filterStatus)
    .filter(l => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        l.companyName.toLowerCase().includes(q) ||
        l.contactEmail.toLowerCase().includes(q) ||
        l.industry.toLowerCase().includes(q) ||
        l.primaryPainSignal.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (sortBy === 'urgency') return b.urgencyLevel - a.urgencyLevel;
      if (sortBy === 'readiness') {
        const order: Record<string, number> = { 'High': 3, 'Medium': 2, 'Low': 1 };
        return (order[b.readinessScore] || 0) - (order[a.readinessScore] || 0);
      }
      return new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();
    });

  const stats = {
    total: leads.length,
    new: leads.filter(l => l.status === 'new').length,
    readyForCall: leads.filter(l => l.status === 'ready-for-call').length,
    proposalSent: leads.filter(l => l.status === 'proposal-sent').length,
    highUrgency: leads.filter(l => l.urgencyLevel >= 8).length,
    outcomesLogged: Object.keys(outcomesMap).length,
  };

  return (
    <span className="contents">
    {/* ── 7A: Win Celebration Overlay ──────────────────────────────────────── */}
    <AnimatePresence>
      {winCelebration && (
        <WinCelebration
          {...winCelebration}
          onClose={() => setWinCelebration(null)}
        />
      )}
    </AnimatePresence>

    <div className="min-h-screen bg-[#0A0A0F] text-white">
      {/* Header */}
      <div className="border-b border-white/10 bg-black/40 backdrop-blur-xl sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <button
                onClick={onBack}
                className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
              >
                <ArrowLeft className="size-4" />
                Dashboard
              </button>
              <div className="flex items-center gap-3">
                <div className="size-12 rounded-xl bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center">
                  <Brain className="size-6 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold">CORTEX</h1>
                  <p className="text-gray-400 text-xs">Decision Intelligence · 10 Modules</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => loadLeads(true)}
                disabled={isRefreshing}
                className="p-2 hover:bg-white/5 rounded-lg transition-colors text-gray-400"
              >
                <RefreshCw className={`size-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>

              {/* Analyze All Unanalyzed */}
              {(() => {
                const unanalyzedCount = leads.filter(l => !cortexStatus[l.id]).length;
                if (unanalyzedCount === 0) return null;
                return (
                  <button
                    onClick={handleBatchAnalyze}
                    disabled={isBatchAnalyzing || !accessToken}
                    className="px-4 py-2 rounded-lg flex items-center gap-2 font-medium transition-all text-sm disabled:opacity-50"
                    style={{
                      background: 'linear-gradient(135deg, rgba(139,92,246,0.2), rgba(59,130,246,0.15))',
                      border: '1px solid rgba(139,92,246,0.4)',
                      color: '#C4B5FD',
                    }}
                    title={`AI-analyze ${unanalyzedCount} unanalyzed lead${unanalyzedCount !== 1 ? 's' : ''}`}
                  >
                    {isBatchAnalyzing ? (
                      <span className="contents"><Loader2 className="size-4 animate-spin" />Analyzing…</span>
                    ) : (
                      <span className="contents"><Sparkles className="size-4" />Analyze All ({unanalyzedCount})</span>
                    )}
                  </button>
                );
              })()}

              <button
                onClick={onViewInsights}
                className="px-4 py-2 bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] text-white rounded-lg flex items-center gap-2 font-medium hover:opacity-90 transition-opacity"
              >
                <TrendingUp className="size-4" />
                Learning Insights
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-6 gap-3">
            <StatCard label="Total Leads" value={stats.total} icon={Users} color="#8B5CF6" />
            <StatCard label="New" value={stats.new} icon={Zap} color="#3B82F6" />
            <StatCard label="Ready for Call" value={stats.readyForCall} icon={Phone} color="#06D7F6" />
            <StatCard label="Proposals Out" value={stats.proposalSent} icon={FileText} color="#FB923C" />
            <StatCard label="High Urgency" value={stats.highUrgency} icon={Flame} color="#FD4438" />
            <StatCard label="Outcomes Logged" value={stats.outcomesLogged} icon={TrendingUp} color="#10B981" />
          </div>

          {/* Batch analyze progress/error banner */}
          <AnimatePresence>
            {(batchProgress || batchError) && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-3 overflow-hidden"
              >
                {batchError ? (
                  <div className="px-4 py-3 rounded-xl flex items-center justify-between gap-3"
                    style={{ background: 'rgba(253,68,56,0.08)', border: '1px solid rgba(253,68,56,0.25)', color: '#FCA5A5' }}>
                    <div className="flex items-center gap-2 text-sm">
                      <AlertTriangle className="size-4 text-[#FD4438] flex-shrink-0" />
                      {batchError}
                    </div>
                    <button onClick={() => setBatchError(null)} className="text-gray-500 hover:text-white">✕</button>
                  </div>
                ) : batchProgress && (
                  <div className="px-4 py-3 rounded-xl flex items-center gap-3"
                    style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', color: '#6EE7B7' }}>
                    <Sparkles className="size-4 flex-shrink-0" />
                    <span className="text-sm">
                      {isBatchAnalyzing
                        ? `AI analyzing ${batchProgress.total} submissions…`
                        : `✓ Analyzed ${batchProgress.done}/${batchProgress.total} submissions successfully`}
                    </span>
                    {!isBatchAnalyzing && (
                      <button onClick={() => setBatchProgress(null)} className="ml-auto text-gray-500 hover:text-white text-xs">✕</button>
                    )}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Search bar */}
        <div className="relative mb-4">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search leads by company, email, industry…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-black/40 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-[#8B5CF6]/50 focus:ring-1 focus:ring-[#8B5CF6]/30 transition-all text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
            >
              <XCircle className="size-4" />
            </button>
          )}
        </div>

        {/* Toolbar: view toggle + sort + filters */}
        <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
          {/* View mode toggle */}
          <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <button
              onClick={() => setViewMode('list')}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: viewMode === 'list' ? 'rgba(139,92,246,0.25)' : 'transparent',
                border: viewMode === 'list' ? '1px solid rgba(139,92,246,0.4)' : '1px solid transparent',
                color: viewMode === 'list' ? '#C4B5FD' : '#6B7280',
              }}
            >
              <LayoutList className="size-3.5" />
              Cards
            </button>
            <button
              onClick={() => setViewMode('table')}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: viewMode === 'table' ? 'rgba(59,130,246,0.2)' : 'transparent',
                border: viewMode === 'table' ? '1px solid rgba(59,130,246,0.35)' : '1px solid transparent',
                color: viewMode === 'table' ? '#93C5FD' : '#6B7280',
              }}
            >
              <Table2 className="size-3.5" />
              Table
            </button>
            <button
              onClick={() => setViewMode('pipeline')}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: viewMode === 'pipeline' ? 'rgba(6,215,246,0.18)' : 'transparent',
                border: viewMode === 'pipeline' ? '1px solid rgba(6,215,246,0.35)' : '1px solid transparent',
                color: viewMode === 'pipeline' ? '#06D7F6' : '#6B7280',
              }}
            >
              <Kanban className="size-3.5" />
              Pipeline
            </button>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Sort control */}
            {viewMode !== 'pipeline' && (
              <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <ArrowUpDown className="size-3.5 text-gray-500 ml-2" />
                {([
                  { id: 'date', label: 'Newest' },
                  { id: 'urgency', label: 'Urgency' },
                  { id: 'readiness', label: 'Readiness' },
                ] as const).map(s => (
                  <button
                    key={s.id}
                    onClick={() => setSortBy(s.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      sortBy === s.id
                        ? 'bg-white/10 text-white'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}

            {/* Status filters — only visible in list/table mode */}
            {viewMode !== 'pipeline' && (
              <div className="flex items-center gap-2 flex-wrap">
                {[
                  { id: 'all', label: 'All Leads' },
                { id: 'new', label: 'New' },
                { id: 'needs-review', label: 'Needs Review' },
                { id: 'ready-for-call', label: 'Ready for Call' },
                { id: 'proposal-sent', label: 'Proposals' },
                { id: 'converted', label: 'Converted' },
              ].map(f => (
                <button
                  key={f.id}
                  onClick={() => setFilterStatus(f.id as typeof filterStatus)}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-all text-sm ${
                    filterStatus === f.id
                      ? 'bg-[#8B5CF6] text-white'
                      : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
          </div>
        </div>

        {/* Results count */}
        {!isLoading && viewMode !== 'pipeline' && (
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">
              {filteredLeads.length} lead{filteredLeads.length !== 1 ? 's' : ''}
              {filterStatus !== 'all' && ` · ${filterStatus.replace(/-/g, ' ')}`}
              {searchQuery && ` · matching "${searchQuery}"`}
            </p>
          </div>
        )}

        {/* Content: Pipeline Kanban, Table, or Lead Cards list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-8 text-[#8B5CF6] animate-spin" />
          </div>
        ) : viewMode === 'pipeline' ? (
          <PipelineKanban
            leads={leads}
            cortexStatus={cortexStatus}
            outcomesMap={outcomesMap}
            accessToken={accessToken}
            onSelectLead={onSelectLead}
            onOutcomeLogged={(leadId, _toColumnId, payload, localOutcome) => {
              // Optimistically update outcomesMap so the stat badge reflects instantly
              const updatedOutcomes = { ...outcomesMap, [leadId]: localOutcome };
              setOutcomesMap(updatedOutcomes);
              // Refresh from backend after a short delay to pick up any server-side changes
              setTimeout(() => loadOutcomesMap(), 1500);

              // ── 7A: Fire win celebration overlay on confirmed wins ────────
              if (payload.didConvert) {
                const lead = leads.find(l => l.id === leadId);
                const prevRevenue = Object.values(outcomesMap)
                  .filter(o => o.didConvert)
                  .reduce((sum, o) => sum + (o.conversionValue || 0), 0);
                const newRevenue = prevRevenue + (payload.conversionValue || 0);
                const allOutcomes = Object.values(updatedOutcomes);
                const wins  = allOutcomes.filter(o => o.didConvert).length;
                const total = allOutcomes.length;
                setWinCelebration({
                  companyName:     lead?.companyName ?? 'Deal',
                  industry:        lead?.industry,
                  dealValue:       payload.conversionValue ?? null,
                  previousRevenue: prevRevenue,
                  newRevenue,
                  totalWins:       wins,
                  conversionRate:  total > 0 ? Math.round((wins / total) * 100) : null,
                });
              }
              // ─────────────────────────────────────────────────────────────
            }}
            onStatusChanged={(_leadId, _toColumnId) => {
              // Refresh leads silently so list view reflects new status if user switches back
              loadLeads(true);
            }}
            onViewLearningLoop={onViewInsights}
          />
        ) : filteredLeads.length === 0 ? (
          <div className="text-center py-20 text-gray-600">
            <Brain className="size-16 mx-auto mb-4 opacity-20" />
            <p className="text-lg">No leads {searchQuery ? 'matching your search' : 'in this category'}</p>
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="mt-3 text-sm text-[#8B5CF6] hover:underline">
                Clear search
              </button>
            )}
          </div>
        ) : viewMode === 'table' ? (
          <LeadTable
            leads={filteredLeads}
            cortexStatus={cortexStatus}
            outcomesMap={outcomesMap}
            onSelectLead={onSelectLead}
          />
        ) : (
          <div className="space-y-4">
            {filteredLeads.map(lead => (
              <LeadCard
                key={lead.id}
                lead={lead}
                onClick={() => onSelectLead(lead.id)}
                aiStatus={cortexStatus[lead.id] || null}
                outcome={outcomesMap[lead.id] || null}
              />
            ))}
          </div>
        )}
      </div>
    </div>
    </span>
  );
}

// ============================================================================
// COMPACT TABLE VIEW
// ============================================================================

function LeadTable({ leads, cortexStatus, outcomesMap, onSelectLead }: {
  leads: Lead[];
  cortexStatus: Record<string, CortexStatusEntry>;
  outcomesMap: Record<string, { didConvert: boolean; conversionValue: number | null; loggedAt: string }>;
  onSelectLead: (id: string) => void;
}) {
  return (
    <div className="bg-black/40 border border-white/10 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-left">
            <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Company</th>
            <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Industry</th>
            <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Status</th>
            <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center">Readiness</th>
            <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center">Urgency</th>
            <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center">AI</th>
            <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center">Outcome</th>
            <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Submitted</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead, i) => {
            const statusStyle = getStatusColor(lead.status);
            const readinessColor = getReadinessColor(lead.readinessScore);
            const ai = cortexStatus[lead.id];
            const outcome = outcomesMap[lead.id];
            return (
              <motion.tr
                key={lead.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.03 }}
                onClick={() => onSelectLead(lead.id)}
                className="border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors group"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="size-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{ background: `${statusStyle.bg}20`, color: statusStyle.text }}
                    >
                      {lead.companyName.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-white truncate group-hover:text-[#8B5CF6] transition-colors">
                        {lead.companyName}
                      </p>
                      <p className="text-xs text-gray-500 truncate">{lead.contactEmail}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">{lead.industry}</td>
                <td className="px-4 py-3">
                  <span
                    className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase"
                    style={{
                      backgroundColor: `${statusStyle.bg}20`,
                      color: statusStyle.text,
                      border: `1px solid ${statusStyle.border}`,
                    }}
                  >
                    {lead.status.replace(/-/g, ' ')}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <span
                    className="px-2 py-0.5 rounded text-xs font-bold"
                    style={{ color: readinessColor }}
                  >
                    {lead.readinessScore}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-0.5">
                    {[...Array(10)].map((_, j) => (
                      <div
                        key={j}
                        className={`size-1.5 rounded-full ${j < lead.urgencyLevel ? 'bg-[#FD4438]' : 'bg-white/10'}`}
                      />
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  {ai ? (
                    <span
                      className="text-xs font-bold"
                      style={{ color: ai.aiScore >= 75 ? '#10B981' : ai.aiScore >= 50 ? '#FB923C' : '#FD4438' }}
                    >
                      {ai.aiScore}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  {outcome ? (
                    <span className="text-xs font-bold" style={{ color: outcome.didConvert ? '#10B981' : '#FD4438' }}>
                      {outcome.didConvert ? (outcome.conversionValue ? `$${Math.round(outcome.conversionValue / 1000)}K` : 'WON') : 'LOST'}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">
                  {new Date(lead.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function mapToLeadStatus(status: string): LeadStatus {
  switch (status) {
    case 'new':           return 'new';
    case 'in-review':     return 'needs-review';
    case 'completed':     return 'ready-for-call';
    case 'proposal-sent': return 'proposal-sent';
    case 'approved':      return 'converted';
    case 'rejected':      return 'disqualified';
    default:              return 'new';
  }
}

// Lead Card
function LeadCard({ lead, onClick, aiStatus, outcome }: {
  lead: Lead;
  onClick: () => void;
  aiStatus?: CortexStatusEntry | null;
  outcome?: { didConvert: boolean; conversionValue: number | null; loggedAt: string } | null;
}) {
  const statusStyle = getStatusColor(lead.status);
  const readinessColor = getReadinessColor(lead.readinessScore);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      onClick={onClick}
      className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6 hover:border-[#8B5CF6]/50 transition-all cursor-pointer"
    >
      <div className="flex items-start justify-between gap-6">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <h3 className="text-xl font-bold">{lead.companyName}</h3>
            <span
              className="px-3 py-1 rounded-full text-xs font-bold"
              style={{
                backgroundColor: `${statusStyle.bg}20`,
                color: statusStyle.text,
                border: `1px solid ${statusStyle.border}`,
              }}
            >
              {lead.status.toUpperCase().replace(/-/g, ' ')}
            </span>
            {lead.urgencyLevel >= 8 && (
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-[#FD4438]/20 text-[#FD4438] border border-[#FD4438]/30 flex items-center gap-1">
                <Flame className="size-3" /> HIGH URGENCY
              </span>
            )}
            {/* Outcome badge */}
            {outcome && (
              <span
                className="px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1"
                style={{
                  background: outcome.didConvert ? 'rgba(16,185,129,0.15)' : 'rgba(253,68,56,0.1)',
                  border: `1px solid ${outcome.didConvert ? 'rgba(16,185,129,0.35)' : 'rgba(253,68,56,0.3)'}`,
                  color: outcome.didConvert ? '#10B981' : '#FD4438',
                }}
              >
                {outcome.didConvert
                  ? <TrendingUp className="size-3" />
                  : <TrendingDown className="size-3" />}
                {outcome.didConvert
                  ? outcome.conversionValue ? `WON · $${Math.round(outcome.conversionValue / 1000)}K` : 'WON'
                  : 'LOST'}
              </span>
            )}
            {/* AI analysis badge */}
            {aiStatus ? (
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1"
                style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: '#10B981' }}>
                <Sparkles className="size-3" />
                AI · {aiStatus.aiScore}
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-full text-xs font-medium text-gray-500 border border-white/10 flex items-center gap-1">
                <Brain className="size-3" />
                Not analyzed
              </span>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4 text-sm mb-4">
            <div><span className="text-gray-400">Industry: </span><span className="text-white">{lead.industry}</span></div>
            <div><span className="text-gray-400">Size: </span><span className="text-white">{lead.companySize}</span></div>
            <div><span className="text-gray-400">Submitted: </span><span className="text-white">
              {new Date(lead.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span></div>
          </div>

          <div className="bg-[#FD4438]/10 border border-[#FD4438]/20 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="size-4 text-[#FD4438] flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-semibold text-[#FD4438] mb-1">PRIMARY PAIN SIGNAL</div>
                <p className="text-sm text-gray-300">{lead.primaryPainSignal}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 items-end flex-shrink-0">
          <div className="text-center">
            <div className="text-xs text-gray-400 mb-2">Readiness</div>
            <div
              className="px-4 py-2 rounded-lg font-bold text-lg"
              style={{
                backgroundColor: `${readinessColor}20`,
                color: readinessColor,
                border: `2px solid ${readinessColor}`,
              }}
            >
              {lead.readinessScore}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-400 mb-2">Urgency</div>
            <div className="flex items-center gap-0.5">
              {[...Array(10)].map((_, i) => (
                <div
                  key={i}
                  className={`size-2 rounded-full ${i < lead.urgencyLevel ? 'bg-[#FD4438]' : 'bg-white/10'}`}
                />
              ))}
            </div>
          </div>
          {aiStatus && (
            <div className="text-center">
              <div className="text-xs text-gray-400 mb-1">AI Score</div>
              <div className="text-2xl font-bold" style={{ color: aiStatus.aiScore >= 75 ? '#10B981' : aiStatus.aiScore >= 50 ? '#FB923C' : '#FD4438' }}>
                {aiStatus.aiScore}
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================================
// CORTEX LEAD DETAIL — ALL 10 MODULES
// ============================================================================

type DetailTab =
  | 'diagnostic'      // 2
  | 'recommendation'  // 3
  | 'roi'             // 4
  | 'proposal'        // 5
  | 'callprep'        // 6
  | 'reviewer'        // 7
  | 'decisions'       // 8
  | 'actions'         // 9
  | 'outcome'         // 10
  | 'notes'           // 11 — Team Notes (Phase 3B)
  | 'messages';       // 12 — Client Messages (Phase 4B)

function CortexLeadDetail({
  leadId, onBack, accessToken,
}: {
  leadId: string;
  onBack: () => void;
  accessToken?: string;
}) {
  const [data, setData] = useState<CortexLeadData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<DetailTab>('diagnostic');
  const [currentStatus, setCurrentStatus] = useState<LeadStatus>('new');
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [notesCount, setNotesCount] = useState<number | null>(null);
  const [engagement, setEngagement] = useState<EngagementData | null>(null);
  const [msgUnread, setMsgUnread] = useState(0);
  // AI analysis state
  const [aiAnalysis, setAIAnalysis] = useState<CortexAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [keyMissing, setKeyMissing] = useState(false);

  // Portfolio state management — updated by CortexChatPanel
  const handlePortfolioUpdate = (newState: import('@/app/core/types').PortfolioState, result: import('@/app/core/types').RecalcResult) => {
    setData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        portfolioState: newState,
        // If recalc produced new recommendations, sync them into the top-level data
        ...(newState.outputs.recommendations.length > 0 ? {
          recommendation: {
            ...prev.recommendation,
            recommendationV2: newState.outputs.recommendations[0],
          },
        } : {}),
        // Sync ROI model
        ...(newState.outputs.roi ? { roiModel: newState.outputs.roi } : {}),
      };
    });
    if (isVerboseLogging()) {
      console.log(`[CortexLeadDetail] Portfolio updated → ${result.new_version}`, result.summary);
    }
  };

  useEffect(() => {
    loadLeadData();
  }, [leadId, accessToken]);

  // Fetch note count for badge
  useEffect(() => {
    if (!accessToken || !leadId || !isBackendEnabled()) return;
    getNotes(leadId, accessToken)
      .then(res => setNotesCount(res.notes.length))
      .catch(() => setNotesCount(null));
  }, [leadId, accessToken]);

  // Fetch engagement data
  useEffect(() => {
    if (!accessToken || !leadId || !isBackendEnabled()) return;
    getSubmissions(accessToken)
      .then(res => {
        const sub = res.submissions?.find((s: Submission) => s.id === leadId);
        if (sub && (sub as any).engagement) {
          setEngagement((sub as any).engagement);
        }
      })
      .catch(() => {});
  }, [leadId, accessToken]);

  const loadLeadData = async () => {
    setIsLoading(true);
    try {
      // Check feature flag before making API calls
      if (!isBackendEnabled()) {
        if (isVerboseLogging()) {
          console.log('📦 Using demo data for lead details (backend disabled)');
        }
        const mockData = getMockCortexLeadData(leadId);
        setData(mockData);
        setCurrentStatus(mockData.lead.status);
        setIsLoading(false);
        return;
      }

      let baseData: CortexLeadData | null = null;

      if (accessToken) {
        // 1. Build deterministic base from real submission
        const result = await getSubmissions(accessToken);
        const realSub = result.submissions?.find((s: Submission) => s.id === leadId);
        if (realSub) {
          baseData = generateCortexData(realSub);
        }

        // 2. Try to load stored AI analysis and merge on top
        try {
          const aiResult = await getCortexAnalysis(leadId, accessToken);
          if (aiResult.analysis) {
            setAIAnalysis(aiResult.analysis);
            if (baseData) {
              baseData = mergeAIIntoCortexData(baseData, aiResult.analysis);
            }
          }
        } catch (aiErr) {
          if (isVerboseLogging()) {
            console.warn('Could not load AI analysis (non-fatal):', aiErr);
          }
        }
      }

      if (baseData) {
        setData(baseData);
        setCurrentStatus(baseData.lead.status);
      } else {
        // Fallback to mock
        const mockData = getMockCortexLeadData(leadId);
        setData(mockData);
        setCurrentStatus(mockData.lead.status);
      }
    } catch (err) {
      if (isVerboseLogging()) {
        console.error('❌ Failed to load lead data:', err);
      }
      const mockData = getMockCortexLeadData(leadId);
      setData(mockData);
      setCurrentStatus(mockData.lead.status);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnalyzeWithAI = async () => {
    if (!accessToken || isAnalyzing) return;
    
    // Check feature flag before making API calls
    if (!isBackendEnabled()) {
      if (isVerboseLogging()) {
        console.log('📦 AI analysis disabled (backend disabled)');
      }
      setAnalyzeError('Backend integration is disabled. Enable it in feature flags to use AI analysis.');
      return;
    }

    setIsAnalyzing(true);
    setAnalyzeError(null);
    setKeyMissing(false);
    try {
      const result = await analyzeSubmission(leadId, accessToken);
      const newAnalysis = result.analysis;
      setAIAnalysis(newAnalysis);
      // Merge into current data immediately
      setData(prev => prev ? mergeAIIntoCortexData(prev, newAnalysis) : prev);
    } catch (err: any) {
      if (isVerboseLogging()) {
        console.error('❌ AI analysis failed:', err);
      }
      if ((err as any).keyMissing) {
        setKeyMissing(true);
        setAnalyzeError('OpenAI API key not configured. Add OPENAI_API_KEY to Supabase Edge Function secrets.');
      } else {
        setAnalyzeError(err.message || 'Analysis failed. Please try again.');
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleClearAIAnalysis = async () => {
    if (!accessToken) return;
    
    // Check feature flag before making API calls
    if (!isBackendEnabled()) {
      if (isVerboseLogging()) {
        console.log('📦 Clear AI analysis disabled (backend disabled)');
      }
      setAIAnalysis(null);
      setAnalyzeError(null);
      setKeyMissing(false);
      loadLeadData();
      return;
    }

    try {
      await clearCortexAnalysis(leadId, accessToken);
      setAIAnalysis(null);
      setAnalyzeError(null);
      setKeyMissing(false);
      // Reload without AI overlay
      loadLeadData();
    } catch (err) {
      if (isVerboseLogging()) {
        console.error('❌ Failed to clear analysis:', err);
      }
    }
  };

  const handleStatusChange = async (newStatus: LeadStatus) => {
    setShowStatusMenu(false);
    if (!accessToken) {
      setCurrentStatus(newStatus);
      return;
    }
    
    // Check feature flag before making API calls
    if (!isBackendEnabled()) {
      if (isVerboseLogging()) {
        console.log('📦 Status update disabled (backend disabled)');
      }
      setCurrentStatus(newStatus);
      return;
    }

    setIsUpdatingStatus(true);
    try {
      // Map CORTEX LeadStatus back to submission status
      const mappedStatus = mapFromLeadStatus(newStatus);
      await updateSubmissionStatus(leadId, accessToken, { status: mappedStatus });
      setCurrentStatus(newStatus);
    } catch (err) {
      if (isVerboseLogging()) {
        console.error('❌ Failed to update status:', err);
      }
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  function mapFromLeadStatus(s: LeadStatus): string {
    switch (s) {
      case 'new': return 'new';
      case 'needs-review': return 'in-review';
      case 'ready-for-call': return 'completed';
      case 'proposal-sent': return 'completed';
      case 'converted': return 'approved';
      case 'disqualified': return 'completed';
      default: return 'new';
    }
  }

  const tabs: { id: DetailTab; label: string; icon: any; badge?: string }[] = [
    { id: 'diagnostic',     label: 'Diagnostic',     icon: Brain },
    { id: 'recommendation', label: 'Recommendation', icon: Target },
    { id: 'roi',            label: 'ROI',            icon: DollarSign },
    { id: 'proposal',       label: 'Proposal',       icon: FileText },
    { id: 'callprep',       label: 'Call Prep',      icon: Phone },
    { id: 'reviewer',       label: 'Reviewer QA',    icon: Shield },
    { id: 'decisions',      label: 'Decision Log',   icon: Clock },
    { id: 'actions',        label: 'Next Actions',   icon: Flag },
    { id: 'outcome',        label: 'Outcome',        icon: TrendingUp },
    {
      id: 'notes',
      label: 'Notes',
      icon: MessageSquare,
      badge: notesCount != null && notesCount > 0 ? String(notesCount) : undefined,
    },
    {
      id: 'messages',
      label: 'Client Messages',
      icon: MessageSquare,
      badge: msgUnread > 0 ? String(msgUnread) : undefined,
    },
  ];

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0A0A0F]">
        <Loader2 className="size-10 text-[#8B5CF6] animate-spin" />
      </div>
    );
  }

  // Full-screen overlay while AI is actively analyzing
  if (isAnalyzing && !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0A0A0F] gap-6">
        <div className="size-20 rounded-2xl bg-gradient-to-br from-[#8B5CF6]/20 to-[#3B82F6]/20 border border-[#8B5CF6]/30 flex items-center justify-center">
          <Brain className="size-10 text-[#8B5CF6] animate-pulse" />
        </div>
        <div className="text-center">
          <p className="text-xl font-bold text-white mb-2">CORTEX is thinking…</p>
          <p className="text-gray-400 text-sm">Running 8-step intelligence analysis via GPT-4o-mini</p>
        </div>
        <div className="flex gap-1.5">
          {[0, 1, 2].map(i => (
            <motion.div
              key={i}
              className="size-2 rounded-full bg-[#8B5CF6]"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.4 }}
            />
          ))}
        </div>
      </div>
    );
  }

  const statusStyle = getStatusColor(currentStatus);

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white">
      {/* Sticky Header */}
      <div className="border-b border-white/10 bg-black/40 backdrop-blur-xl sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-3"
          >
            <ArrowLeft className="size-4" />
            Back to CORTEX Overview
          </button>

          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold mb-1">{data.lead.companyName}</h1>
              <div className="flex items-center gap-4 text-sm text-gray-400 mb-2">
                <span>{data.lead.industry}</span>
                <span>•</span>
                <span>{data.lead.companySize}</span>
                <span>•</span>
                <span>{data.lead.contactEmail}</span>
              </div>
              {/* AI Analysis timestamp */}
              {aiAnalysis && (
                <div className="text-xs text-[#8B5CF6]/80 flex items-center gap-1 mb-1">
                  <Sparkles className="size-3" />
                  AI analyzed {timeAgo(aiAnalysis.analyzedAt)} · {aiAnalysis.model}
                </div>
              )}
              {/* Client engagement badges */}
              <ClientEngagementBadge engagement={engagement} />
            </div>

            <div className="flex gap-3 items-center flex-wrap justify-end relative">

              {/* ── AI Analyze Button ── */}
              {!aiAnalysis ? (
                <button
                  onClick={handleAnalyzeWithAI}
                  disabled={isAnalyzing || !accessToken}
                  className="px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all disabled:opacity-50"
                  style={{
                    background: isAnalyzing
                      ? 'rgba(139,92,246,0.15)'
                      : 'linear-gradient(135deg, rgba(139,92,246,0.25), rgba(59,130,246,0.25))',
                    border: '1px solid rgba(139,92,246,0.5)',
                    color: '#C4B5FD',
                  }}
                  title={!accessToken ? 'Team login required' : 'Run AI analysis on this submission'}
                >
                  {isAnalyzing ? (
                    <span className="contents">
                      <Loader2 className="size-4 animate-spin" />
                      Analyzing…
                    </span>
                  ) : (
                    <span className="contents">
                      <Sparkles className="size-4" />
                      Analyze with AI
                    </span>
                  )}
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <div
                    className="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5"
                    style={{
                      background: 'rgba(16,185,129,0.15)',
                      border: '1px solid rgba(16,185,129,0.4)',
                      color: '#10B981',
                    }}
                  >
                    <Sparkles className="size-3" />
                    AI-Powered
                  </div>
                  <button
                    onClick={handleAnalyzeWithAI}
                    disabled={isAnalyzing}
                    className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors"
                    title="Re-run AI analysis"
                  >
                    {isAnalyzing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                  </button>
                  <button
                    onClick={handleClearAIAnalysis}
                    className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/5 transition-colors"
                    title="Clear AI analysis"
                  >
                    <XCircle className="size-3.5" />
                  </button>
                </div>
              )}

              {/* ── Error Banner ── */}
              {analyzeError && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute top-full mt-2 right-0 z-50 max-w-sm"
                >
                  <div
                    className="p-3 rounded-xl text-xs leading-relaxed"
                    style={{
                      background: 'rgba(253,68,56,0.1)',
                      border: '1px solid rgba(253,68,56,0.35)',
                      color: '#FCA5A5',
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="size-3.5 text-[#FD4438] flex-shrink-0 mt-0.5" />
                      <div>
                        {keyMissing ? (
                          <span className="contents">
                            <strong className="text-[#FD4438]">API Key Required</strong>
                            <br />Add <code className="bg-white/10 px-1 rounded">OPENAI_API_KEY</code> in Supabase
                            {' '}Edge Functions → Secrets.
                          </span>
                        ) : analyzeError}
                        <button
                          onClick={() => setAnalyzeError(null)}
                          className="ml-2 text-gray-500 hover:text-white"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* ── Status Dropdown — saves to Supabase ── */}
              <div className="relative">
                <button
                  onClick={() => setShowStatusMenu(!showStatusMenu)}
                  disabled={isUpdatingStatus}
                  className="px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all hover:opacity-80"
                  style={{
                    backgroundColor: `${statusStyle.bg}30`,
                    color: statusStyle.text,
                    border: `1px solid ${statusStyle.border}`,
                  }}
                >
                  {isUpdatingStatus
                    ? <Loader2 className="size-4 animate-spin" />
                    : null}
                  {currentStatus.replace(/-/g, ' ').toUpperCase()}
                  <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <AnimatePresence>
                  {showStatusMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      className="absolute top-full mt-2 right-0 bg-[#0A0A0F] border border-white/20 rounded-xl shadow-2xl z-30 min-w-48 overflow-hidden"
                    >
                      {([
                        'new', 'needs-review', 'ready-for-call',
                        'proposal-sent', 'converted', 'disqualified',
                      ] as LeadStatus[]).map(s => {
                        const sc = getStatusColor(s);
                        return (
                          <button
                            key={s}
                            onClick={() => handleStatusChange(s)}
                            className={`w-full px-4 py-3 text-left text-sm hover:bg-white/5 transition-colors flex items-center gap-2 ${
                              currentStatus === s ? 'bg-white/10' : ''
                            }`}
                          >
                            <span
                              className="size-2 rounded-full flex-shrink-0"
                              style={{ backgroundColor: sc.bg }}
                            />
                            <span style={{ color: sc.text }}>
                              {s.replace(/-/g, ' ').toUpperCase()}
                            </span>
                          </button>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <button className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-lg transition-colors flex items-center gap-2 text-sm font-medium">
                <Download className="size-4" />
                Export
              </button>
            </div>
          </div>

          {/* 9-tab navigation */}
          <div className="flex gap-1.5 flex-wrap">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-2 rounded-lg transition-all flex items-center gap-1.5 text-sm font-medium ${
                  activeTab === tab.id
                    ? 'bg-[#8B5CF6] text-white'
                    : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                }`}
              >
                <tab.icon className="size-3.5" />
                {tab.label}
                {tab.badge && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none ${
                    activeTab === tab.id
                      ? 'bg-white/20 text-white'
                      : 'bg-[#8B5CF6]/20 text-[#8B5CF6]'
                  }`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* AI Analysis Notes banner */}
      {aiAnalysis?.analysisNotes && (
        <div className="max-w-7xl mx-auto px-6 pt-6">
          <div
            className="p-4 rounded-xl flex items-start gap-3"
            style={{
              background: 'linear-gradient(135deg, rgba(139,92,246,0.08), rgba(59,130,246,0.06))',
              border: '1px solid rgba(139,92,246,0.25)',
            }}
          >
            <Sparkles className="size-4 text-[#8B5CF6] flex-shrink-0 mt-0.5" />
            <div>
              <span className="text-xs font-semibold text-[#8B5CF6] uppercase tracking-wider mr-2">
                CORTEX Intelligence Note
              </span>
              <span className="text-sm text-gray-300">{aiAnalysis.analysisNotes}</span>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
          >
            {activeTab === 'diagnostic'     && <DiagnosticSummarySection data={data} />}
            {activeTab === 'recommendation' && <RecommendationSection data={data} onPortfolioUpdate={handlePortfolioUpdate} />}
            {activeTab === 'roi'            && <ROISection data={data} onPortfolioUpdate={handlePortfolioUpdate} />}
            {activeTab === 'proposal'       && (
              <ProposalSection data={data} />
            )}
            {activeTab === 'callprep'       && <CallPrepSection data={data} />}
            {activeTab === 'reviewer'       && (
              <CortexReviewerModule
                leadId={leadId}
                companyName={data.lead.companyName}
                reviewType="report"
                accessToken={accessToken}
              />
            )}
            {activeTab === 'decisions'      && <DecisionLogModule data={data} />}
            {activeTab === 'actions'        && <NextActionsModule data={data} />}
            {activeTab === 'outcome'        && (
              <OutcomeModule
                data={data}
                submissionId={leadId}
                accessToken={accessToken}
              />
            )}
            {activeTab === 'notes'          && (
              <SubmissionNotesPanel
                submissionId={leadId}
                companyName={data.lead.companyName}
                accessToken={accessToken}
              />
            )}
            {activeTab === 'messages'       && (
              <TeamMessageThread
                submissionId={leadId}
                companyName={data.lead.companyName}
                contactName={data.lead.contactEmail?.split('@')[0]}
                accessToken={accessToken}
                onUnreadCountChange={setMsgUnread}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* CORTEX Chat Panel — floating recalculation engine */}
      <CortexChatPanel
        portfolioState={data.portfolioState}
        companyName={data.lead.companyName}
        onPortfolioUpdate={handlePortfolioUpdate}
        accessToken={accessToken}
      />
    </div>
  );
}

// Stat Card
function StatCard({ label, value, icon: Icon, color }: {
  label: string; value: number;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
}) {
  return (
    <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <Icon className="size-5" style={{ color }} />
        <span className="text-2xl font-bold" style={{ color }}>{value}</span>
      </div>
      <div className="text-xs text-gray-400">{label}</div>
    </div>
  );
}