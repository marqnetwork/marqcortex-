/**
 * CLIENT PORTAL — SUPABASE CONNECTED
 *
 * Shows the client their real diagnostic submission data:
 * - Live status timeline (where they are in the process)
 * - Personalised readiness report generated from their actual answers
 * - Meeting scheduler
 *
 * Design: Dark MARQ Cortex header → white report body (print-ready)
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import type { ComponentType } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Brain, CheckCircle2, Clock, Calendar, LogOut, FileText,
  Loader2, AlertTriangle, ArrowRight, RefreshCw, Mail, Building2,
  Zap, ChevronRight, User, Phone, Eye, Sparkles,
  MessageSquare,
} from 'lucide-react';
import {
  getClientSubmission, trackEngagement, getClientReport,
  getDemoClientSubmission, generateClientReport, type Submission, type ClientReportData,
  type ClientAuthContext,
} from '@/app/services/dataService';
import { ClientReadinessReport } from '@/app/components/ClientReadinessReport';
import { MeetingScheduler } from '@/app/components/MeetingScheduler';
import { ClientMessaging } from '@/app/components/ClientMessaging';
import { ProposalViewer } from '@/app/components/ProposalViewer';
import { StageTracker } from '@/app/components/StageTracker';
import { EngagementActivityFeed } from '@/app/components/EngagementActivityFeed';
import { isBackendEnabled, isVerboseLogging, canUseDemoFallback } from '@/config/runtime';
import { SkeletonClientPortal } from '@/app/components/Skeletons';
import { ClientQAReview } from '@/app/components/ClientQAReview';
import { ClientReportDashboard } from '@/app/components/ClientReportDashboard';
import { ClientSolutionView, generateSolutionsFromSubmission } from '@/app/components/ClientSolutionView';

interface ClientPortalProps {
  onLogout: () => void;
  submissionId?: string;
  clientEmail?: string;
  companyName?: string;
  sessionToken?: string | null;
}

type PortalView = 'status' | 'solution' | 'report' | 'schedule' | 'messages' | 'proposal' | 'assessment' | 'strategic-report';

// ============================================================================
// STATUS STAGES
// ============================================================================

type StageId = 'submitted' | 'in-review' | 'report-ready' | 'call-scheduled';

const STAGES: { id: StageId; label: string; description: string }[] = [
  {
    id: 'submitted',
    label: 'Submitted',
    description: 'Your diagnostic was received successfully.',
  },
  {
    id: 'in-review',
    label: 'Under Review',
    description: 'Our team is analysing your operational diagnostic.',
  },
  {
    id: 'report-ready',
    label: 'Report Ready',
    description: 'Your personalised readiness report is available.',
  },
  {
    id: 'call-scheduled',
    label: 'Call Scheduled',
    description: 'Your discovery call is confirmed.',
  },
];

function getActiveStage(status: string): StageId {
  switch (status) {
    case 'new': return 'submitted';
    case 'in-review': return 'in-review';
    case 'completed': return 'report-ready';
    case 'approved': return 'call-scheduled';
    default: return 'submitted';
  }
}

function stageIndex(id: StageId): number {
  return STAGES.findIndex(s => s.id === id);
}

// ============================================================================
// MAIN PORTAL
// ============================================================================

export default function ClientPortal({
  onLogout, submissionId, clientEmail, companyName, sessionToken,
}: ClientPortalProps) {
  const clientAuth = useMemo<ClientAuthContext | undefined>(() => {
    if (!submissionId && !clientEmail && !sessionToken) return undefined;
    return { sessionToken: sessionToken ?? null, email: clientEmail };
  }, [submissionId, clientEmail, sessionToken]);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [reportData, setReportData] = useState<ClientReportData | null>(null);
  const [isAIPowered, setIsAIPowered] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<PortalView>('status');
  const [meetingScheduled, setMeetingScheduled] = useState(false);
  const [msgUnread, setMsgUnread] = useState(false);
  // 13A: timestamp of last successful data refresh — drives StageTracker live badge
  const [lastUpdated, setLastUpdated] = useState<string>(new Date().toISOString());
  const reportViewTracked   = useRef(false);
  const proposalViewTracked = useRef(false);    // 13C
  const portalOpenTracked   = useRef(false);    // 13C
  // 13C: bump this to trigger EngagementActivityFeed re-fetch after tracking an event
  const [feedTick, setFeedTick] = useState(0);
  const bumpFeed = () => setFeedTick(t => t + 1);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadSubmission();
    // Poll every 30s so status changes are reflected live
    pollRef.current = setInterval(() => loadSubmission(true), 30000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [submissionId, clientAuth]);

  // Track report_viewed when user opens the report tab for the first time
  useEffect(() => {
    if (activeView === 'report' && submissionId && !reportViewTracked.current) {
      reportViewTracked.current = true;
      trackEngagement(submissionId, 'report_viewed', undefined, clientAuth);
      bumpFeed();
    }
    // Clear unread badge when opening messages
    if (activeView === 'messages') {
      setMsgUnread(false);
    }
    // Track portal_opened when user opens the portal for the first time
    if (activeView === 'status' && submissionId && !portalOpenTracked.current) {
      portalOpenTracked.current = true;
      trackEngagement(submissionId, 'portal_opened', undefined, clientAuth);
      bumpFeed();
    }
    // Track proposal_viewed when user opens the proposal tab for the first time
    if (activeView === 'proposal' && submissionId && !proposalViewTracked.current) {
      proposalViewTracked.current = true;
      trackEngagement(submissionId, 'proposal_viewed', undefined, clientAuth);
      bumpFeed();
    }
  }, [activeView, submissionId, clientAuth]);

  const loadSubmission = async (silent = false) => {
    if (!submissionId) {
      setIsLoading(false);
      return;
    }

    if (!silent) setIsLoading(true);
    else setIsRefreshing(true);
    setError(null);

    try {
      // Check feature flag before making API calls
      if (!isBackendEnabled()) {
        if (isVerboseLogging()) {
          console.log('📦 Using demo data for client portal (backend disabled)');
        }
        
        // Create demo submission data
        const demoSubmission: Submission = getDemoClientSubmission({ submissionId, companyName, clientEmail });
        
        setSubmission(demoSubmission);
        setReportData(generateClientReport(demoSubmission));
        setIsAIPowered(false);
        setIsLoading(false);
        setIsRefreshing(false);
        setLastUpdated(new Date().toISOString());
        return;
      }

      const result = await getClientSubmission(submissionId, clientAuth);
      if (result.submission) {
        setSubmission(result.submission);

        // Try AI-powered report first, fall back to deterministic
        try {
          const aiReport = await getClientReport(submissionId, clientAuth);
          if (aiReport.report && aiReport.aiPowered) {
            setReportData(aiReport.report as any);
            setIsAIPowered(true);
          } else {
            setReportData(generateClientReport(result.submission));
            setIsAIPowered(false);
          }
        } catch {
          // Silently fall back to deterministic
          setReportData(generateClientReport(result.submission));
          setIsAIPowered(false);
        }
      }
    } catch (err: any) {
      if (isVerboseLogging()) {
        console.error('❌ Failed to load client submission:', err);
      }
      
      if (canUseDemoFallback()) {
        // Demo mode only (defence-in-depth; unreachable in live mode because the
        // isBackendEnabled() guard above early-returns demo data before the fetch).
        if (isVerboseLogging()) {
          console.log('📦 Demo mode: loading demo submission');
        }
        const demoSubmission = getDemoClientSubmission({ submissionId, companyName, clientEmail });
        setSubmission(demoSubmission);
        setReportData(generateClientReport(demoSubmission));
        setIsAIPowered(false);
      } else {
        // Live mode: NEVER show a fabricated submission/report to a real client.
        // Surface an honest error; leave submission unset so the error screen renders.
        setError(err.message || 'Failed to load your submission data.');
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
      setLastUpdated(new Date().toISOString()); // 13A: stamp every successful poll
    }
  };

  // Loading state
  if (isLoading) {
    return <SkeletonClientPortal />;
  }

  // Error state
  if (error && !submission) {
    return (
      <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <AlertTriangle className="size-16 text-[#FD4438] mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Unable to Load Report</h2>
          <p className="text-gray-400 mb-6">{error}</p>
          <button
            onClick={() => loadSubmission()}
            className="px-6 py-3 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-xl font-medium transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const activeStage = submission ? getActiveStage(submission.status) : 'submitted';
  const activeStageIdx = stageIndex(activeStage);
  const displayCompany = submission?.company || companyName || 'Your Company';
  const displayEmail = submission?.email || clientEmail || '';
  const isReportReady = activeStageIdx >= stageIndex('report-ready');

  return (
    <div className="min-h-screen bg-[#0A0A0F]">
      {/* ================================================================== */}
      {/* DARK MARQ CORTEX HEADER — sticky, unified design */}
      {/* ================================================================== */}
      <div className="sticky top-0 z-50 bg-[#0A0A0F]/85 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Brand + company */}
            <div className="flex items-center gap-4">
              <div className="size-10 rounded-xl bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center flex-shrink-0 shadow-lg shadow-[#8B5CF6]/25">
                <Brain className="size-5 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#8B5CF6] uppercase tracking-wider">MARQ Cortex</span>
                  <span className="text-gray-700">|</span>
                  <h1 className="font-bold text-white text-lg leading-tight">{displayCompany}</h1>
                </div>
                <p className="text-xs text-gray-500">{displayEmail}</p>
              </div>
            </div>

            {/* Nav + logout */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => loadSubmission(true)}
                disabled={isRefreshing}
                className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                title="Refresh"
              >
                <RefreshCw className={`size-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={onLogout}
                className="flex items-center gap-2 px-3 py-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors text-sm"
              >
                <LogOut className="size-4" />
                Logout
              </button>
            </div>
          </div>

          {/* Portal navigation tabs */}
          <nav className="flex gap-1 mt-4 flex-wrap -mx-1" role="tablist" aria-label="Portal sections">
            {[
              { id: 'status' as PortalView, label: 'Your Status', icon: Clock },
              { id: 'solution' as PortalView, label: 'Solution', icon: Sparkles },
              { id: 'report' as PortalView, label: isAIPowered ? 'Readiness Report ✦' : 'Readiness Report', icon: FileText, locked: !isReportReady },
              { id: 'schedule' as PortalView, label: 'Schedule a Call', icon: Calendar },
              { id: 'proposal' as PortalView, label: 'Proposal', icon: FileText },
              { id: 'messages' as PortalView, label: 'Messages', icon: MessageSquare, badge: msgUnread },
              { id: 'assessment' as PortalView, label: 'Your Assessment', icon: Eye },
              { id: 'strategic-report' as PortalView, label: 'Strategic Report', icon: FileText },
            ].map(tab => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeView === tab.id}
                aria-disabled={tab.locked}
                onClick={() => !tab.locked && setActiveView(tab.id)}
                disabled={tab.locked}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeView === tab.id
                    ? 'bg-[#8B5CF6] text-white'
                    : tab.locked
                    ? 'text-gray-600 cursor-not-allowed'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <tab.icon className="size-4" />
                {tab.label}
                {tab.locked && <span className="text-xs bg-white/10 px-1.5 py-0.5 rounded text-gray-500">Soon</span>}
                {tab.badge && !tab.locked && (
                  <span className="size-2 rounded-full bg-[#FD4438] animate-pulse" />
                )}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* ================================================================== */}
      {/* CONTENT */}
      {/* ================================================================== */}
      <AnimatePresence mode="wait">
        {activeView === 'status' && (
          <motion.div
            key="status"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <StatusView
              submission={submission}
              activeStage={activeStage}
              activeStageIdx={activeStageIdx}
              displayCompany={displayCompany}
              isReportReady={isReportReady}
              lastUpdated={lastUpdated}
              isRefreshing={isRefreshing}
              onViewReport={() => setActiveView('report')}
              onScheduleCall={() => setActiveView('schedule')}
              submissionId={submissionId}
              feedTick={feedTick}
            />
          </motion.div>
        )}

        {activeView === 'solution' && (
          <motion.div
            key="solution"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <ClientSolutionView
              companyName={displayCompany}
              industry={submission?.industry || 'Technology'}
              solutions={submission ? generateSolutionsFromSubmission(submission) : undefined}
              onScheduleCall={() => setActiveView('schedule')}
              onViewReport={() => setActiveView('report')}
            />
          </motion.div>
        )}

        {activeView === 'report' && reportData && (
          <motion.div
            key="report"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div>
              {(() => {
                const { contactName, contactEmail, ...reportProps } = reportData;
                return (
                  <ClientReadinessReport
                    {...reportProps}
                    aiPowered={isAIPowered}
                    onCTAClick={() => {
                      if (submissionId) trackEngagement(submissionId, 'cta_clicked', undefined, clientAuth);
                      setActiveView('schedule');
                    }}
                    onPrintClick={() => {
                      if (submissionId) trackEngagement(submissionId, 'pdf_printed', undefined, clientAuth);
                    }}
                    onScheduleCall={() => setActiveView('schedule')}
                  />
                );
              })()}

              {!meetingScheduled && (
                <div className="max-w-4xl mx-auto px-6 py-12">
                  <div className="bg-gradient-to-br from-[#8B5CF6]/15 to-[#3B82F6]/10 rounded-2xl p-8 text-center border border-[#8B5CF6]/20">
                    <h3 className="text-2xl font-bold text-white mb-3">
                      Ready to discuss your opportunities?
                    </h3>
                    <p className="text-gray-400 mb-6 max-w-xl mx-auto">
                      Let's walk through your report together and explore next steps.
                      No pressure — just a conversation about what's possible.
                    </p>
                    <button
                      onClick={() => {
                        if (submissionId) trackEngagement(submissionId, 'cta_clicked', undefined, clientAuth);
                        setActiveView('schedule');
                      }}
                      className="px-8 py-4 bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] hover:opacity-90 text-white rounded-xl font-semibold text-lg transition-all inline-flex items-center gap-2"
                    >
                      <Calendar className="size-5" />
                      Schedule Your Readiness Call
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {activeView === 'report' && !reportData && (
          <motion.div
            key="report-loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center justify-center min-h-[60vh]"
          >
            <ReportNotReadyCard onViewStatus={() => setActiveView('status')} />
          </motion.div>
        )}

        {activeView === 'schedule' && (
          <motion.div
            key="schedule"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="py-12"
          >
            <div className="max-w-6xl mx-auto px-6">
              <MeetingScheduler
                clientData={{
                  name: submission?.contact || displayCompany,
                  email: displayEmail,
                  companyName: displayCompany,
                  readinessScore: submission
                    ? submission.completionScore >= 80 ? 'High' : 'Medium'
                    : 'Medium',
                  submissionId: submissionId || 'demo',
                }}
                onScheduled={(meetingData) => {
                  if (submissionId) {
                    trackEngagement(submissionId, 'meeting_scheduled', undefined, clientAuth);
                    bumpFeed();
                  }
                  setMeetingScheduled(true);
                  setActiveView('status');
                }}
              />
            </div>
          </motion.div>
        )}

        {activeView === 'messages' && submissionId && (
          <motion.div
            key="messages"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="max-w-3xl mx-auto px-6 py-8"
          >
            <ClientMessaging
              submissionId={submissionId}
              clientName={submission?.contact || clientEmail || 'Client'}
              companyName={displayCompany}
              clientAuth={clientAuth}
            />
          </motion.div>
        )}

        {activeView === 'proposal' && submissionId && (
          <motion.div
            key="proposal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="max-w-3xl mx-auto px-6 py-8"
          >
            <ProposalViewer
              submissionId={submissionId}
              clientName={submission?.contact || clientEmail || 'Client'}
              companyName={displayCompany}
              clientAuth={clientAuth}
            />
          </motion.div>
        )}

        {activeView === 'assessment' && submission && (
          <motion.div
            key="assessment"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="px-6 py-8"
          >
            <ClientQAReview
              submission={submission}
              companyName={displayCompany}
            />
          </motion.div>
        )}

        {activeView === 'strategic-report' && (
          <motion.div
            key="strategic-report"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <ClientReportDashboard
              companyName={displayCompany}
              industry={submission?.industry || 'Technology'}
              onBack={() => setActiveView('status')}
              onScheduleCall={() => setActiveView('schedule')}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// STATUS VIEW
// ============================================================================

function StatusView({
  submission,
  activeStage,
  activeStageIdx,
  displayCompany,
  isReportReady,
  lastUpdated,
  isRefreshing,
  onViewReport,
  onScheduleCall,
  submissionId,
  feedTick,
}: {
  submission:     Submission | null;
  activeStage:    StageId;
  activeStageIdx: number;
  displayCompany: string;
  isReportReady:  boolean;
  lastUpdated?:   string;
  isRefreshing?:  boolean;
  onViewReport:   () => void;
  onScheduleCall: () => void;
  submissionId?:  string;
  feedTick?:      number;
}) {
  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-8">

      {/* Welcome card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-[#8B5CF6]/20 to-[#3B82F6]/10 border border-[#8B5CF6]/30 rounded-2xl p-8"
      >
        <div className="flex items-start gap-5">
          <div className="size-14 rounded-2xl bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center flex-shrink-0">
            <Brain className="size-7 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white mb-1">
              Welcome back{displayCompany !== 'Your Company' ? `, ${displayCompany}` : ''}
            </h2>
            <p className="text-gray-300 text-lg">
              {getStatusMessage(activeStage)}
            </p>
            {submission && (
              <p className="text-gray-500 text-sm mt-2">
                Submitted {new Date(submission.submittedAt).toLocaleDateString('en-US', {
                  weekday: 'long', month: 'long', day: 'numeric',
                })}
              </p>
            )}
          </div>
        </div>
      </motion.div>

      {/* 13A: Horizontal Stage Tracker */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <StageTracker
          activeStage={activeStage}
          submittedAt={submission?.submittedAt}
          lastUpdated={lastUpdated}
          isRefreshing={isRefreshing}
          onViewReport={isReportReady ? onViewReport : undefined}
          onSchedule={onScheduleCall}
        />
      </motion.div>

      {/* Submission details */}
      {submission && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-black/40 border border-white/10 rounded-2xl p-6"
        >
          <h3 className="text-white font-bold mb-5 flex items-center gap-2">
            <FileText className="size-4 text-[#8B5CF6]" />
            Submission Details
          </h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <DetailItem icon={Building2} label="Company" value={submission.company} />
            <DetailItem icon={Mail} label="Email" value={submission.email} />
            <DetailItem icon={User} label="Contact" value={submission.contact} />
            <DetailItem icon={Zap} label="Industry" value={submission.industry} />
            <DetailItem icon={Clock} label="Submitted" value={new Date(submission.submittedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} />
            <DetailItem
              icon={CheckCircle2}
              label="Completion"
              value={`${submission.completionScore}% complete`}
              valueColor={submission.completionScore >= 80 ? '#10B981' : submission.completionScore >= 60 ? '#FB923C' : '#FD4438'}
            />
          </div>
        </motion.div>
      )}

      {/* Action CTAs */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="grid grid-cols-1 sm:grid-cols-2 gap-4"
      >
        <button
          onClick={onViewReport}
          disabled={!isReportReady}
          className={`flex items-center justify-between p-5 rounded-xl border transition-all text-left group ${
            isReportReady
              ? 'bg-gradient-to-br from-[#8B5CF6]/20 to-[#3B82F6]/10 border-[#8B5CF6]/40 hover:border-[#8B5CF6]/70 cursor-pointer'
              : 'bg-white/3 border-white/10 opacity-50 cursor-not-allowed'
          }`}
        >
          <div>
            <div className="font-bold text-white mb-1 flex items-center gap-2">
              <FileText className="size-4 text-[#8B5CF6]" />
              View Your Report
            </div>
            <p className="text-sm text-gray-400">
              {isReportReady ? 'Your personalised readiness report is ready' : 'Available once review is complete'}
            </p>
          </div>
          <ArrowRight className={`size-5 flex-shrink-0 transition-transform ${isReportReady ? 'text-[#8B5CF6] group-hover:translate-x-1' : 'text-gray-600'}`} />
        </button>

        <button
          onClick={onScheduleCall}
          className="flex items-center justify-between p-5 rounded-xl border border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10 transition-all text-left group cursor-pointer"
        >
          <div>
            <div className="font-bold text-white mb-1 flex items-center gap-2">
              <Calendar className="size-4 text-[#06D7F6]" />
              Schedule a Call
            </div>
            <p className="text-sm text-gray-400">Book a 30-min discovery conversation</p>
          </div>
          <ArrowRight className="size-5 text-[#06D7F6] flex-shrink-0 group-hover:translate-x-1 transition-transform" />
        </button>
      </motion.div>

      {/* What happens next */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="bg-black/40 border border-white/10 rounded-2xl p-6"
      >
        <h3 className="text-white font-bold mb-4">What happens next</h3>
        <div className="space-y-3">
          {getNextSteps(activeStage).map((step, idx) => (
            <div key={idx} className="flex items-start gap-3 text-sm text-gray-300">
              <div className="size-5 rounded-full bg-[#8B5CF6]/20 text-[#8B5CF6] flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-bold">
                {idx + 1}
              </div>
              {step}
            </div>
          ))}
        </div>
      </motion.div>

      {/* 13C: Engagement activity feed */}
      {submissionId && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <EngagementActivityFeed
            submissionId={submissionId}
            refreshTick={feedTick}
            clientAuth={clientAuth}
          />
        </motion.div>
      )}
    </div>
  );
}

function DetailItem({
  icon: Icon, label, value, valueColor,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="size-4 text-gray-500 flex-shrink-0 mt-0.5" />
      <div>
        <div className="text-gray-500 text-xs mb-0.5">{label}</div>
        <div className="text-white font-medium" style={valueColor ? { color: valueColor } : {}}>{value}</div>
      </div>
    </div>
  );
}

function ReportNotReadyCard({ onViewStatus }: { onViewStatus: () => void }) {
  return (
    <div className="text-center p-12">
      <Clock className="size-16 text-gray-600 mx-auto mb-4" />
      <h3 className="text-xl font-bold text-white mb-2">Report Not Yet Available</h3>
      <p className="text-gray-400 mb-6 max-w-sm mx-auto">
        Our team is currently analysing your diagnostic. Your report will be available here shortly.
      </p>
      <button
        onClick={onViewStatus}
        className="px-6 py-3 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-xl font-medium transition-colors"
      >
        View Your Status
      </button>
    </div>
  );
}

// ============================================================================
// CONTENT HELPERS
// ============================================================================

function getStatusMessage(stage: StageId): string {
  switch (stage) {
    case 'submitted':
      return "Your diagnostic has been received. Our team will begin the review shortly.";
    case 'in-review':
      return "Our team is currently analysing your operational diagnostic. You'll be notified when your report is ready.";
    case 'report-ready':
      return "Your personalised readiness report is ready to view.";
    case 'call-scheduled':
      return "Your discovery call is confirmed. Check your email for the calendar invite.";
  }
}

function getNextSteps(stage: StageId): string[] {
  switch (stage) {
    case 'submitted':
      return [
        'Our team reviews your diagnostic within 1–2 business days',
        'We analyse your answers against industry benchmarks and operational patterns',
        'Your personalised readiness report is generated and made available here',
        'You\'ll receive an email notification when your report is ready',
      ];
    case 'in-review':
      return [
        'Analysis is in progress — typically completed within 24 hours',
        'Your report will appear in the "Readiness Report" tab when complete',
        'Consider scheduling your discovery call in advance so you\'re ready to move quickly',
      ];
    case 'report-ready':
      return [
        'Review your full readiness report in the "Readiness Report" tab',
        'Schedule a 30-minute call to walk through your findings with our team',
        'We\'ll discuss prioritised next steps and answer any questions about the report',
      ];
    case 'call-scheduled':
      return [
        'Check your email for the calendar invite and call details',
        'Review your readiness report before the call to come prepared',
        'Prepare any specific questions about the recommendations',
      ];
  }
}