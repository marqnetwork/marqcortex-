/**
 * CORTEX MODULE #9: PROPOSAL BUILDER — Phase 4C
 *
 * Auto-generates diagnostic proposals from Cortex analysis.
 * Persists to Supabase via KV store.
 * Team can edit, save draft, and send to client.
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FileText, Send, Edit3, Eye, CheckCircle2, Clock, DollarSign,
  Calendar, Download, AlertCircle, Zap, Target, TrendingUp, Shield,
  XCircle, Loader2, Save, RefreshCw, CheckCheck, AlertTriangle,
} from 'lucide-react';
import type { CortexLeadData } from '@/app/types/cortex-types';
import type { DiagnosticProposal } from '@/app/types/proposal';
import { generateProposal } from '@/app/types/proposal';
import { getProposal, saveProposal, sendProposal } from '@/app/services/dataService';
import { FEATURES } from '@/config/features';
import { exportHTMLToPDF } from '@/app/utils/pdfExport';
import { generateAnnotatedProposalHTML } from '@/app/utils/proposalExport';

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  draft:    { label: 'Draft',    color: 'text-white/60 bg-white/10',          icon: Edit3 },
  sent:     { label: 'Sent',     color: 'text-[#3B82F6] bg-[#3B82F6]/20',     icon: Send },
  viewed:   { label: 'Viewed',   color: 'text-[#06D7F6] bg-[#06D7F6]/20',     icon: Eye },
  accepted: { label: 'Accepted', color: 'text-[#10B981] bg-[#10B981]/20',     icon: CheckCheck },
  rejected: { label: 'Rejected', color: 'text-[#FD4438] bg-[#FD4438]/20',     icon: XCircle },
};

interface CortexProposalModuleProps {
  data: CortexLeadData;
  submissionId?: string;
  accessToken?: string;
}

export function CortexProposalModule({ data, submissionId, accessToken }: CortexProposalModuleProps) {
  const [proposal, setProposal]         = useState<DiagnosticProposal | null>(null);
  const [isLoading, setIsLoading]       = useState(true);
  const [isSaving, setIsSaving]         = useState(false);
  const [isSending, setIsSending]       = useState(false);
  const [editMode, setEditMode]         = useState(false);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [toast, setToast]               = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [isExportingPDF, setIsExportingPDF] = useState(false);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Generate a fresh local proposal from Cortex data ──
  const buildFromData = useCallback((): DiagnosticProposal => {
    return generateProposal({
      lead_id:           data.lead.id,
      company_name:      data.lead.companyName,
      top_problems:      data.diagnostic.coreProblems.slice(0, 4).map(p => ({
        title:       p.title,
        description: p.whatsbroken,
        why_exists:  p.whyBreaking,
        cost:        p.whatBreaksNext,
      })),
      readiness_level:   data.lead.readinessScore,
      primary_pain_signal: data.lead.primaryPainSignal,
    });
  }, [data]);

  // ── Load from server on mount ──
  useEffect(() => {
    const load = async () => {
      if (!submissionId || !accessToken) {
        setProposal(buildFromData());
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      try {
        if (!FEATURES.BACKEND_INTEGRATION) {
          if (FEATURES.VERBOSE_LOGGING) {
            console.log('📦 Using demo data for proposal (backend disabled)');
          }
          setProposal(buildFromData());
          setIsLoading(false);
          return;
        }

        const res = await getProposal(submissionId, accessToken);
        if (res.proposal) {
          setProposal(res.proposal as DiagnosticProposal);
        } else {
          setProposal(buildFromData());
        }
      } catch (err: any) {
        if (FEATURES.VERBOSE_LOGGING) {
          console.error('❌ Load proposal error:', err);
        }
        setProposal(buildFromData());
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [submissionId, accessToken, buildFromData]);

  // ── Save draft ──
  const handleSave = async () => {
    if (!proposal || !submissionId || !accessToken) return;
    
    // Check feature flag before making API calls
    if (!FEATURES.BACKEND_INTEGRATION) {
      if (FEATURES.VERBOSE_LOGGING) {
        console.log('📦 Save proposal disabled (backend disabled)');
      }
      showToast('Demo mode - proposal changes are not persisted', 'error');
      return;
    }

    setIsSaving(true);
    try {
      const res = await saveProposal(submissionId, proposal, accessToken);
      setProposal(res.proposal as DiagnosticProposal);
      showToast('Draft saved successfully');
    } catch (err: any) {
      if (FEATURES.VERBOSE_LOGGING) {
        console.error('❌ Failed to save proposal:', err);
      }
      showToast(err.message || 'Failed to save draft', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Send to client ──
  const handleSend = async () => {
    if (!proposal || !submissionId || !accessToken) return;

    // Check feature flag before making API calls
    if (!FEATURES.BACKEND_INTEGRATION) {
      if (FEATURES.VERBOSE_LOGGING) {
        console.log('📦 Send proposal disabled (backend disabled)');
      }
      showToast('Demo mode - proposal cannot be sent', 'error');
      return;
    }

    // Must save first if it's a local-only proposal
    setIsSending(true);
    try {
      // Auto-save current state before sending
      await saveProposal(submissionId, proposal, accessToken);
      const res = await sendProposal(submissionId, accessToken);
      setProposal(res.proposal as DiagnosticProposal);
      showToast('Proposal sent to client!');
      setEditMode(false);
    } catch (err: any) {
      if (FEATURES.VERBOSE_LOGGING) {
        console.error('❌ Failed to send proposal:', err);
      }
      showToast(err.message || 'Failed to send proposal', 'error');
    } finally {
      setIsSending(false);
    }
  };

  // ── Print / export PDF ──
  const handlePrint = async () => {
    if (!proposal) return;
    setIsExportingPDF(true);
    const companyName = data.lead.companyName;
    try {
      const html = generateAnnotatedProposalHTML(proposal, [], companyName);
      const result = await exportHTMLToPDF(html, {
        filename: `${companyName.replace(/[^a-zA-Z0-9]/g, '-')}-Proposal.pdf`,
        orientation: 'portrait',
        format: 'a4',
      });
      if (!result.success) {
        console.error('PDF export failed, falling back to print window:', result.error);
        const win = window.open('', '_blank');
        if (win) { win.document.write(html); win.document.close(); win.print(); }
      }
    } catch (err) {
      console.error('PDF export error:', err);
      window.print();
    } finally {
      setIsExportingPDF(false);
    }
  };

  if (isLoading || !proposal) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="size-8 text-[#8B5CF6] animate-spin" />
      </div>
    );
  }

  const isSent       = proposal.status !== 'draft';
  const isFinalized  = proposal.status === 'accepted' || proposal.status === 'rejected';
  const statusCfg    = STATUS_CONFIG[proposal.status] || STATUS_CONFIG.draft;
  const StatusIcon   = statusCfg.icon;

  return (
    <div className="space-y-6">

      {/* ── Toast ── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium ${
              toast.type === 'success'
                ? 'bg-[#10B981]/10 border-[#10B981]/30 text-[#10B981]'
                : 'bg-[#FD4438]/10 border-[#FD4438]/30 text-[#FD4438]'
            }`}
          >
            {toast.type === 'success'
              ? <CheckCircle2 className="size-4 flex-shrink-0" />
              : <AlertTriangle className="size-4 flex-shrink-0" />
            }
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Header with Status ── */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
            <FileText className="size-6 text-[#8B5CF6]" />
            Diagnostic Proposal
          </h2>
          <p className="text-white/60 text-sm">
            Auto-generated from Cortex analysis
            {proposal.savedAt && ` · Saved ${new Date(proposal.savedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`}
            {proposal.sent_date && ` · Sent ${new Date(proposal.sent_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
          </p>
        </div>
        {/* Status badge */}
        <div className={`px-4 py-2 rounded-full flex items-center gap-2 ${statusCfg.color}`}>
          <StatusIcon className="size-4" />
          <span className="font-semibold">{statusCfg.label}</span>
        </div>
      </div>

      {/* ── Accepted / Rejected Banner ── */}
      {proposal.status === 'accepted' && (
        <div className="flex items-center gap-3 px-5 py-4 bg-[#10B981]/10 border border-[#10B981]/30 rounded-xl">
          <CheckCheck className="size-6 text-[#10B981] flex-shrink-0" />
          <div>
            <p className="font-semibold text-[#10B981]">Proposal Accepted!</p>
            <p className="text-sm text-gray-400">
              {proposal.accepted_by && `Accepted by ${proposal.accepted_by}`}
              {proposal.accepted_at && ` on ${new Date(proposal.accepted_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`}
            </p>
          </div>
        </div>
      )}
      {proposal.status === 'rejected' && (
        <div className="flex items-center gap-3 px-5 py-4 bg-[#FD4438]/10 border border-[#FD4438]/30 rounded-xl">
          <XCircle className="size-6 text-[#FD4438] flex-shrink-0" />
          <div>
            <p className="font-semibold text-[#FD4438]">Proposal Declined</p>
            <p className="text-sm text-gray-400">The client declined this proposal. Consider reaching out to understand their concerns.</p>
          </div>
        </div>
      )}

      {/* ── Quick Actions ── */}
      <div className={`grid gap-4 ${isFinalized ? 'grid-cols-2' : 'grid-cols-5'}`}>
        {!isFinalized && (
          <span className="contents">
            <motion.button
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              onClick={() => setEditMode(!editMode)}
              disabled={isSent}
              className={`px-4 py-3 rounded-xl border flex items-center justify-center gap-2 transition-all text-sm ${
                editMode
                  ? 'bg-[#8B5CF6] border-[#8B5CF6] text-white'
                  : isSent
                  ? 'bg-black/20 border-white/5 text-white/30 cursor-not-allowed'
                  : 'bg-black/40 border-white/10 text-white/80 hover:border-[#8B5CF6]/50'
              }`}
            >
              <Edit3 className="size-4" />
              {editMode ? 'Editing' : 'Edit'}
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              onClick={handleSave}
              disabled={isSaving || isSent}
              className="px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white/80 hover:border-[#10B981]/50 flex items-center justify-center gap-2 transition-all text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {isSaving ? 'Saving…' : 'Save Draft'}
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              onClick={handlePrint}
              className="px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white/80 hover:border-[#06D7F6]/50 flex items-center justify-center gap-2 transition-all text-sm"
            >
              <Download className="size-4" />
              Export PDF
            </motion.button>
          </span>
        )}

        {isFinalized ? (
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={handlePrint}
            className="px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white/80 hover:border-[#06D7F6]/50 flex items-center justify-center gap-2 transition-all text-sm"
          >
            <Download className="size-4" />
            Export PDF
          </motion.button>
        ) : isSent ? (
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            disabled
            className="col-span-2 px-4 py-3 rounded-xl bg-[#3B82F6]/10 border border-[#3B82F6]/30 text-[#3B82F6] flex items-center justify-center gap-2 transition-all text-sm font-semibold cursor-not-allowed"
          >
            <CheckCircle2 className="size-4" />
            Proposal Delivered to Client
          </motion.button>
        ) : (
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={handleSend}
            disabled={isSending || !submissionId || !accessToken}
            className="col-span-2 px-4 py-3 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] text-white font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed text-sm"
          >
            {isSending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {isSending ? 'Sending…' : 'Send to Client'}
          </motion.button>
        )}

        {isFinalized && (
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            disabled
            className="px-4 py-3 rounded-xl bg-black/20 border border-white/5 text-white/30 flex items-center justify-center gap-2 cursor-not-allowed text-sm"
          >
            <CheckCircle2 className="size-4" />
            Proposal Closed
          </motion.button>
        )}
      </div>

      {/* ── Proposal Sections Grid ── */}
      <div className="grid grid-cols-3 gap-4">
        <ProposalSectionCard
          title="Executive Summary"
          icon={<Target className="size-5 text-[#8B5CF6]" />}
          status="complete"
          onClick={() => setSelectedSection(selectedSection === 'executive' ? null : 'executive')}
          isSelected={selectedSection === 'executive'}
        >
          <div className="text-sm text-white/60 line-clamp-2">
            {proposal.executive_summary.paragraphs[0]}
          </div>
        </ProposalSectionCard>

        <ProposalSectionCard
          title="Confirmed Diagnosis"
          icon={<AlertCircle className="size-5 text-[#FD4438]" />}
          status="complete"
          count={proposal.confirmed_diagnosis.problems.length}
          onClick={() => setSelectedSection(selectedSection === 'diagnosis' ? null : 'diagnosis')}
          isSelected={selectedSection === 'diagnosis'}
        >
          <div className="text-sm text-white/60">
            {proposal.confirmed_diagnosis.problems.length} problems identified
          </div>
        </ProposalSectionCard>

        <ProposalSectionCard
          title="Recommended Step"
          icon={<Zap className="size-5 text-[#FB923C]" />}
          status="complete"
          onClick={() => setSelectedSection(selectedSection === 'recommendation' ? null : 'recommendation')}
          isSelected={selectedSection === 'recommendation'}
        >
          <div className="text-sm text-white/60">
            {proposal.recommended_step.service_name}
          </div>
        </ProposalSectionCard>

        <ProposalSectionCard
          title="Deliverables"
          icon={<CheckCircle2 className="size-5 text-[#06D7F6]" />}
          status="complete"
          count={proposal.deliverables.items.length}
          onClick={() => setSelectedSection(selectedSection === 'deliverables' ? null : 'deliverables')}
          isSelected={selectedSection === 'deliverables'}
        >
          <div className="text-sm text-white/60">
            {proposal.deliverables.items.length} deliverables defined
          </div>
        </ProposalSectionCard>

        <ProposalSectionCard
          title="Timeline"
          icon={<Calendar className="size-5 text-[#3B82F6]" />}
          status="complete"
          onClick={() => setSelectedSection(selectedSection === 'timeline' ? null : 'timeline')}
          isSelected={selectedSection === 'timeline'}
        >
          <div className="text-sm text-white/60">
            {proposal.timeline.total_duration}
          </div>
        </ProposalSectionCard>

        <ProposalSectionCard
          title="Investment"
          icon={<DollarSign className="size-5 text-[#06D7F6]" />}
          status="complete"
          onClick={() => setSelectedSection(selectedSection === 'investment' ? null : 'investment')}
          isSelected={selectedSection === 'investment'}
        >
          <div className="text-xl font-bold text-[#06D7F6]">
            ${proposal.investment.amount.toLocaleString()}
          </div>
        </ProposalSectionCard>
      </div>

      {/* ── Detailed View of Selected Section ── */}
      <AnimatePresence>
        {selectedSection && (
          <motion.div
            key={selectedSection}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6"
          >
            {selectedSection === 'executive'      && <ExecutiveSummaryDetail proposal={proposal} editMode={editMode && !isSent} onUpdate={p => setProposal(p)} />}
            {selectedSection === 'diagnosis'      && <ConfirmedDiagnosisDetail proposal={proposal} editMode={editMode && !isSent} onUpdate={p => setProposal(p)} />}
            {selectedSection === 'recommendation' && <RecommendedStepDetail proposal={proposal} editMode={editMode && !isSent} />}
            {selectedSection === 'deliverables'   && <DeliverablesDetail proposal={proposal} editMode={editMode && !isSent} />}
            {selectedSection === 'timeline'       && <TimelineDetail proposal={proposal} editMode={editMode && !isSent} />}
            {selectedSection === 'investment'     && <InvestmentDetail proposal={proposal} editMode={editMode && !isSent} onUpdate={p => setProposal(p)} />}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Proposal Metrics ── */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard label="Estimated Close Rate" value="43%"    subtext="Based on similar profiles"  icon={<TrendingUp className="size-5 text-[#06D7F6]" />} />
        <MetricCard label="Avg Time to Close"    value="8 days" subtext="From proposal sent"          icon={<Clock className="size-5 text-[#8B5CF6]" />} />
        <MetricCard label="Expected Value"       value={`$${proposal.investment.amount.toLocaleString()}`} subtext="Audit phase only" icon={<DollarSign className="size-5 text-[#06D7F6]" />} />
        <MetricCard label="Potential Lifetime"   value="$45K–$120K" subtext="If full implementation" icon={<Target className="size-5 text-[#FB923C]" />} />
      </div>

      {/* ── AI Confidence ── */}
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Shield className="size-5 text-[#8B5CF6]" />
            AI Confidence
          </h3>
          <span className="text-2xl font-bold text-[#06D7F6]">87%</span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <ConfidenceIndicator label="Problem diagnosis"  score={92} />
          <ConfidenceIndicator label="ROI estimates"      score={85} />
          <ConfidenceIndicator label="Service fit"        score={88} />
          <ConfidenceIndicator label="Close probability"  score={82} />
        </div>
      </div>
    </div>
  );
}

// ── Section card ───────────────────────────────────────────────────────────────

function ProposalSectionCard({
  title, icon, status, count, onClick, isSelected, children,
}: {
  title: string; icon: React.ReactNode; status: 'complete' | 'draft' | 'missing';
  count?: number; onClick: () => void; isSelected: boolean; children: React.ReactNode;
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`bg-black/40 backdrop-blur-xl border rounded-xl p-4 text-left transition-all ${
        isSelected ? 'border-[#8B5CF6] bg-[#8B5CF6]/10' : 'border-white/10 hover:border-white/20'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-semibold text-sm">{title}</span>
        </div>
        {count !== undefined && (
          <span className="text-xs px-2 py-1 rounded-full bg-white/10">{count}</span>
        )}
      </div>
      {children}
      <div className="flex items-center gap-1 mt-3 text-xs text-[#06D7F6]">
        <CheckCircle2 className="size-3" />
        Complete
      </div>
    </motion.button>
  );
}

// ── Detail sections ─────────────────────────────────────────────────────────────

function ExecutiveSummaryDetail({
  proposal, editMode, onUpdate,
}: {
  proposal: DiagnosticProposal; editMode: boolean;
  onUpdate: (p: DiagnosticProposal) => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-xl font-bold mb-4">Executive Summary</h3>
      {proposal.executive_summary.paragraphs.map((para, idx) => (
        <div key={idx}>
          {editMode ? (
            <textarea
              className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-white/90 focus:outline-none focus:border-[#8B5CF6]/50 resize-none"
              rows={3}
              defaultValue={para}
              onChange={e => {
                const updated = { ...proposal };
                updated.executive_summary.paragraphs[idx] = e.target.value;
                onUpdate(updated);
              }}
            />
          ) : (
            <p className="text-white/80 leading-relaxed">{para}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function ConfirmedDiagnosisDetail({
  proposal, editMode, onUpdate,
}: {
  proposal: DiagnosticProposal; editMode: boolean;
  onUpdate: (p: DiagnosticProposal) => void;
}) {
  return (
    <div className="space-y-6">
      <h3 className="text-xl font-bold">{proposal.confirmed_diagnosis.section_title}</h3>
      <div className="space-y-4">
        {proposal.confirmed_diagnosis.problems.map((problem, idx) => (
          <div
            key={idx}
            className="bg-gradient-to-br from-[#FD4438]/10 to-[#FB923C]/10 border border-[#FD4438]/20 rounded-xl p-4"
          >
            <h4 className="font-bold text-lg mb-2 text-[#FD4438]">{idx + 1}. {problem.title}</h4>
            {editMode ? (
              <span className="contents">
                <textarea
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/90 focus:outline-none resize-none mb-2"
                  rows={2} defaultValue={problem.description} placeholder="Description"
                  onChange={e => {
                    const updated = { ...proposal };
                    updated.confirmed_diagnosis.problems[idx].description = e.target.value;
                    onUpdate(updated);
                  }}
                />
                <textarea
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/90 focus:outline-none resize-none"
                  rows={2} defaultValue={problem.cost} placeholder="What it's costing them"
                  onChange={e => {
                    const updated = { ...proposal };
                    updated.confirmed_diagnosis.problems[idx].cost = e.target.value;
                    onUpdate(updated);
                  }}
                />
              </span>
            ) : (
              <span className="contents">
                <p className="text-white/70 text-sm mb-2">{problem.description}</p>
                <p className="text-white/60 text-sm italic">Cost: {problem.cost}</p>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function RecommendedStepDetail({ proposal, editMode }: { proposal: DiagnosticProposal; editMode: boolean }) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-bold mb-2">{proposal.recommended_step.service_name}</h3>
        <p className="text-white/70">{proposal.recommended_step.what_it_does}</p>
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div>
          <h4 className="font-semibold mb-3 flex items-center gap-2 text-[#06D7F6]">
            <CheckCircle2 className="size-4" /> What This Includes
          </h4>
          <ul className="space-y-2">
            {proposal.recommended_step.includes.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2 text-sm text-white/70">
                <CheckCircle2 className="size-4 text-[#06D7F6] flex-shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="font-semibold mb-3 flex items-center gap-2 text-[#FB923C]">
            <XCircle className="size-4" /> What This Does NOT Include
          </h4>
          <ul className="space-y-2">
            {proposal.recommended_step.does_not_include.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2 text-sm text-white/70">
                <XCircle className="size-4 text-[#FB923C] flex-shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function DeliverablesDetail({ proposal, editMode }: { proposal: DiagnosticProposal; editMode: boolean }) {
  return (
    <div className="space-y-4">
      <h3 className="text-xl font-bold mb-4">Deliverables</h3>
      <div className="space-y-3">
        {proposal.deliverables.items.map((item, idx) => (
          <div key={idx} className="bg-black/40 border border-white/10 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <div className="size-8 rounded-full bg-[#8B5CF6]/20 flex items-center justify-center flex-shrink-0 text-sm font-bold text-[#8B5CF6]">
                {idx + 1}
              </div>
              <div className="flex-1">
                <h4 className="font-semibold mb-1">{item.name}</h4>
                <p className="text-sm text-white/60">{item.description}</p>
                {item.format && (
                  <span className="inline-block mt-2 text-xs px-2 py-1 rounded-full bg-white/10 text-white/70">
                    {item.format}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineDetail({ proposal, editMode }: { proposal: DiagnosticProposal; editMode: boolean }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-bold">Timeline</h3>
        <div className="text-2xl font-bold text-[#06D7F6]">{proposal.timeline.total_duration}</div>
      </div>
      <div className="relative">
        <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gradient-to-b from-[#8B5CF6] via-[#3B82F6] to-[#06D7F6]" />
        <div className="space-y-6">
          {proposal.timeline.phases.map((phase, idx) => (
            <div key={idx} className="relative pl-12">
              <div className="absolute left-0 size-8 rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center font-bold">
                {idx + 1}
              </div>
              <div className="bg-black/40 border border-white/10 rounded-lg p-4">
                <h4 className="font-semibold mb-2">{phase.phase}</h4>
                <ul className="space-y-1">
                  {phase.activities.map((activity, aidx) => (
                    <li key={aidx} className="text-sm text-white/70 flex items-start gap-2">
                      <span className="text-[#06D7F6]">•</span>
                      {activity}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function InvestmentDetail({
  proposal, editMode, onUpdate,
}: {
  proposal: DiagnosticProposal; editMode: boolean;
  onUpdate: (p: DiagnosticProposal) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-bold mb-2">Investment</h3>
        {editMode ? (
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl text-[#06D7F6] font-bold">$</span>
            <input
              type="number"
              className="bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-2xl font-bold text-[#06D7F6] focus:outline-none focus:border-[#8B5CF6]/50 w-48"
              defaultValue={proposal.investment.amount}
              onChange={e => {
                const updated = { ...proposal };
                updated.investment.amount = Number(e.target.value) || 0;
                onUpdate(updated);
              }}
            />
          </div>
        ) : (
          <div className="text-4xl font-bold text-[#06D7F6] mb-1">
            ${proposal.investment.amount.toLocaleString()}
          </div>
        )}
        <p className="text-white/60 text-sm uppercase tracking-wide">
          {proposal.investment.structure} · {proposal.investment.currency}
        </p>
      </div>
      <div className="bg-black/40 border border-white/10 rounded-lg p-4 space-y-3">
        <div className="flex items-start gap-2">
          <CheckCircle2 className="size-4 text-[#06D7F6] flex-shrink-0 mt-1" />
          <span className="text-sm text-white/80">{proposal.investment.payment_terms}</span>
        </div>
        <div className="flex items-start gap-2">
          <CheckCircle2 className="size-4 text-[#06D7F6] flex-shrink-0 mt-1" />
          <span className="text-sm text-white/80">{proposal.investment.includes_note}</span>
        </div>
        {proposal.investment.credit_to_next_phase && (
          <div className="flex items-start gap-2">
            <Zap className="size-4 text-[#FB923C] flex-shrink-0 mt-1" />
            <span className="text-sm text-white/80">
              <strong className="text-[#FB923C]">Full credit to next phase:</strong>{' '}
              The entire ${proposal.investment.credit_amount?.toLocaleString()} audit fee is credited to your first build phase.
            </span>
          </div>
        )}
      </div>
      <div className="bg-gradient-to-br from-[#8B5CF6]/10 to-[#3B82F6]/10 border border-[#8B5CF6]/30 rounded-lg p-4">
        <p className="text-sm text-white/80 italic">{proposal.investment.reassurance}</p>
      </div>
    </div>
  );
}

// ── Utility components ─────────────────────────────────────────────────────────

function MetricCard({ label, value, subtext, icon }: {
  label: string; value: string; subtext: string; icon: React.ReactNode;
}) {
  return (
    <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-white/60">{label}</span>
        {icon}
      </div>
      <div className="text-2xl font-bold mb-1">{value}</div>
      <div className="text-xs text-white/50">{subtext}</div>
    </div>
  );
}

function ConfidenceIndicator({ label, score }: { label: string; score: number }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-white/70">{label}</span>
        <span className="text-sm font-semibold text-white/90">{score}%</span>
      </div>
      <div className="h-2 bg-black/40 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 1, ease: 'easeOut' }}
          className="h-full bg-gradient-to-r from-[#8B5CF6] to-[#06D7F6] rounded-full"
        />
      </div>
    </div>
  );
}