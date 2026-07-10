/**
 * PROPOSAL VIEWER — Phase 4C
 *
 * Client-facing read-only proposal view inside the portal.
 * Loads via GET /client/submission/:id/proposal (public).
 * Auto-marks as 'viewed' on first open (server-side).
 * Accept / Decline buttons call POST /respond.
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FileText, CheckCircle2, XCircle, Clock, DollarSign, Calendar,
  Loader2, AlertTriangle, Zap, Target, CheckCheck, RefreshCw,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  getClientProposal, respondToProposal, getDemoProposal,
  type ClientAuthContext,
} from '@/app/services/dataService';
import { isBackendEnabled, isVerboseLogging, shouldShowApiErrors } from '@/config/runtime';
import {
  AnnotationProvider, AnnotationPanelToggle, AnnotatableText,
  ExportAnnotationsButton,
} from '@/app/components/ProposalAnnotationLayer';

const PURPLE = '#8B5CF6';
const BLUE   = '#3B82F6';
const CYAN   = '#06D7F6';
const ORANGE = '#FB923C';
const RED    = '#FD4438';
const GREEN  = '#10B981';

interface Props {
  submissionId: string;
  clientName: string;
  companyName: string;
  clientAuth?: ClientAuthContext;
}

export function ProposalViewer({ submissionId, clientName, companyName, clientAuth }: Props) {
  const [proposal, setProposal]     = useState<any | null>(null);
  const [isLoading, setIsLoading]   = useState(true);
  const [isResponding, setIsResponding] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [expanded, setExpanded]     = useState<Record<string, boolean>>({
    summary: true, diagnosis: false, service: false,
    deliverables: false, timeline: false, investment: false,
  });

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (isBackendEnabled()) {
        const res = await getClientProposal(submissionId, clientAuth);
        setProposal(res.proposal);
      } else {
        // Demo mode: show a rich, fully-structured proposal
        if (isVerboseLogging()) {
          console.log('Demo mode: loading rich mock proposal');
        }
        setProposal(getDemoProposal(companyName));
      }
    } catch (err: any) {
      console.error('ProposalViewer load error:', err);
      setError(err.message || 'Failed to load proposal');
    } finally {
      setIsLoading(false);
    }
  }, [submissionId, companyName, clientAuth]);

  useEffect(() => { load(); }, [load]);

  const handleRespond = async (response: 'accepted' | 'rejected') => {
    if (isResponding) return;
    setIsResponding(true);
    try {
      if (isBackendEnabled()) {
        const res = await respondToProposal(submissionId, response, clientName, clientAuth);
        setProposal(res.proposal);
      } else {
        if (isVerboseLogging()) {
          console.log(`Demo mode: proposal ${response}`);
        }
        setProposal((prev: any) => ({ ...prev, status: response }));
      }
    } catch (err: any) {
      setError(err.message || `Failed to ${response === 'accepted' ? 'accept' : 'decline'} proposal`);
    } finally {
      setIsResponding(false);
    }
  };

  const toggle = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  // ── Loading ──
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <Loader2 className="size-10 text-[#8B5CF6] animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading your proposal…</p>
        </div>
      </div>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center max-w-sm">
          <AlertTriangle className="size-10 text-[#FD4438] mx-auto mb-4" />
          <p className="text-white font-semibold mb-2">Failed to load proposal</p>
          <p className="text-gray-500 text-sm mb-5">{error}</p>
          <button onClick={load} className="px-5 py-2.5 bg-[#8B5CF6] text-white rounded-xl text-sm font-medium hover:bg-[#7C3AED] transition-colors">
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Not yet sent ──
  if (!proposal) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className="py-20 flex flex-col items-center gap-5 text-center"
      >
        <div className="size-20 rounded-2xl bg-gradient-to-br from-[#8B5CF6]/15 to-[#3B82F6]/10 border border-[#8B5CF6]/20 flex items-center justify-center">
          <FileText className="size-9 text-[#8B5CF6]/50" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-white mb-2">Proposal Coming Soon</h3>
          <p className="text-gray-400 text-sm max-w-sm leading-relaxed">
            Our team is preparing a personalised proposal based on your diagnostic results.
            You'll see it here once it's ready — usually within 24 hours of your readiness call.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <Clock className="size-3.5" />
          Typically delivered within 24 hours of your call
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-gray-400 hover:text-white transition-all text-sm"
        >
          <RefreshCw className="size-4" />
          Check Again
        </button>
      </motion.div>
    );
  }

  const isAccepted = proposal.status === 'accepted';
  const isRejected = proposal.status === 'rejected';
  const isFinalized = isAccepted || isRejected;
  const canRespond = proposal.status === 'viewed' || proposal.status === 'sent';

  return (
    <AnnotationProvider submissionId={submissionId}>
    <div className="max-w-2xl mx-auto space-y-5">

      {/* ── Cover ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl border border-[#8B5CF6]/30 bg-gradient-to-br from-[#8B5CF6]/10 via-[#3B82F6]/5 to-transparent p-8"
      >
        <div className="absolute top-0 right-0 w-48 h-48 bg-[#8B5CF6]/10 rounded-full blur-3xl" />
        <div className="relative">
          <div className="flex items-center justify-between gap-2 mb-6">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center">
                <FileText className="size-4 text-white" />
              </div>
              <span className="text-xs font-bold text-[#8B5CF6] uppercase tracking-wider">CORTEX Proposal</span>
            </div>
            {/* 13B: Annotation panel toggle + 13D: Export PDF */}
            <div className="flex items-center gap-2">
              <ExportAnnotationsButton proposal={proposal} companyName={companyName} />
              <AnnotationPanelToggle />
            </div>
          </div>
          <h1 className="text-2xl font-black text-white mb-2">
            AI Readiness & Operations Diagnostic Proposal
          </h1>
          <p className="text-gray-400 text-sm mb-5">
            Prepared for {proposal.company_name || companyName} ·{' '}
            {proposal.generated_date
              ? new Date(proposal.generated_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
              : 'Confidential'}
          </p>

          {/* Status pill */}
          {isAccepted && (
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-[#10B981]/15 border border-[#10B981]/30 rounded-full text-[#10B981] text-sm font-semibold">
              <CheckCheck className="size-4" /> Proposal Accepted
            </div>
          )}
          {isRejected && (
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-[#FD4438]/15 border border-[#FD4438]/30 rounded-full text-[#FD4438] text-sm font-semibold">
              <XCircle className="size-4" /> Proposal Declined
            </div>
          )}
          {!isFinalized && (
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-[#8B5CF6]/15 border border-[#8B5CF6]/30 rounded-full text-[#8B5CF6] text-sm font-semibold">
              <Clock className="size-4" /> Awaiting Your Response
            </div>
          )}
        </div>
      </motion.div>

      {/* ── Accepted / Rejected confirmation ── */}
      <AnimatePresence>
        {isAccepted && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-start gap-4 p-5 bg-[#10B981]/10 border border-[#10B981]/25 rounded-2xl"
          >
            <CheckCheck className="size-6 text-[#10B981] flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-[#10B981] mb-1">You've accepted this proposal!</p>
              <p className="text-gray-400 text-sm leading-relaxed">
                Our team will reach out within 24 hours to confirm your kickoff call and send over the invoice.
                The audit fee will be credited in full if you proceed to implementation.
              </p>
            </div>
          </motion.div>
        )}
        {isRejected && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-start gap-4 p-5 bg-[#FD4438]/10 border border-[#FD4438]/25 rounded-2xl"
          >
            <XCircle className="size-6 text-[#FD4438] flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-[#FD4438] mb-1">You've declined this proposal.</p>
              <p className="text-gray-400 text-sm leading-relaxed">
                No problem at all. Feel free to send us a message if you'd like to discuss different options,
                timing, or scope. We're happy to revisit when the time is right.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Executive Summary ── */}
      {proposal.executive_summary && (
        <ProposalSection
          title="Executive Summary"
          icon={<Target className="size-4" style={{ color: PURPLE }} />}
          color={PURPLE}
          expanded={expanded.summary}
          onToggle={() => toggle('summary')}
          sectionKey="summary"
        >
          <div className="space-y-4">
            {proposal.executive_summary.paragraphs?.map((para: string, i: number) => (
              <p key={i} className="text-gray-300 text-sm leading-relaxed">
                <AnnotatableText text={para} sectionKey="summary" />
              </p>
            ))}
          </div>
        </ProposalSection>
      )}

      {/* ── Confirmed Diagnosis ── */}
      {proposal.confirmed_diagnosis?.problems?.length > 0 && (
        <ProposalSection
          title="What We Confirmed Together"
          icon={<AlertTriangle className="size-4" style={{ color: RED }} />}
          color={RED}
          expanded={expanded.diagnosis}
          onToggle={() => toggle('diagnosis')}
          sectionKey="diagnosis"
        >
          <div className="space-y-4">
            {proposal.confirmed_diagnosis.problems.map((p: any, i: number) => (
              <div key={i} className="pl-4 border-l-2 border-[#FD4438]/40">
                <h4 className="font-semibold text-white mb-1 text-sm">{i + 1}. {p.title}</h4>
                <p className="text-gray-400 text-sm leading-relaxed mb-1">
                  <AnnotatableText text={p.description} sectionKey="diagnosis" />
                </p>
                {p.cost && <p className="text-[#FD4438]/70 text-xs italic">Cost: {p.cost}</p>}
              </div>
            ))}
          </div>
        </ProposalSection>
      )}

      {/* ── Recommended Service ── */}
      {proposal.recommended_step && (
        <ProposalSection
          title="Recommended First Step"
          icon={<Zap className="size-4" style={{ color: ORANGE }} />}
          color={ORANGE}
          expanded={expanded.service}
          onToggle={() => toggle('service')}
          sectionKey="service"
        >
          <div className="space-y-5">
            <div>
              <h4 className="font-bold text-white mb-2">{proposal.recommended_step.service_name}</h4>
              <p className="text-gray-400 text-sm leading-relaxed">
                <AnnotatableText text={proposal.recommended_step.what_it_does} sectionKey="service" />
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <p className="text-xs font-bold text-[#06D7F6] uppercase tracking-wider mb-3">Includes</p>
                <ul className="space-y-2">
                  {proposal.recommended_step.includes?.map((item: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                      <CheckCircle2 className="size-3.5 text-[#06D7F6] flex-shrink-0 mt-0.5" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-bold text-[#FB923C] uppercase tracking-wider mb-3">Does NOT Include</p>
                <ul className="space-y-2">
                  {proposal.recommended_step.does_not_include?.map((item: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-400">
                      <XCircle className="size-3.5 text-[#FB923C] flex-shrink-0 mt-0.5" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </ProposalSection>
      )}

      {/* ── Deliverables ── */}
      {proposal.deliverables?.items?.length > 0 && (
        <ProposalSection
          title="Deliverables"
          icon={<CheckCircle2 className="size-4" style={{ color: CYAN }} />}
          color={CYAN}
          expanded={expanded.deliverables}
          onToggle={() => toggle('deliverables')}
          sectionKey="deliverables"
        >
          <div className="space-y-3">
            {proposal.deliverables.items.map((item: any, i: number) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-black/20 rounded-xl border border-white/5">
                <div className="size-7 rounded-full bg-[#06D7F6]/15 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-[#06D7F6]">
                  {i + 1}
                </div>
                <div>
                  <h5 className="font-semibold text-white text-sm mb-0.5">{item.name}</h5>
                  <p className="text-gray-500 text-xs leading-relaxed">
                    <AnnotatableText text={item.description} sectionKey="deliverables" />
                  </p>
                  {item.format && (
                    <span className="inline-block mt-1.5 text-[10px] px-2 py-0.5 rounded-full bg-white/8 text-gray-500">
                      {item.format}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ProposalSection>
      )}

      {/* ── Timeline ── */}
      {proposal.timeline?.phases?.length > 0 && (
        <ProposalSection
          title={`Timeline — ${proposal.timeline.total_duration}`}
          icon={<Calendar className="size-4" style={{ color: BLUE }} />}
          color={BLUE}
          expanded={expanded.timeline}
          onToggle={() => toggle('timeline')}
          sectionKey="timeline"
        >
          <div className="relative">
            <div className="absolute left-3.5 top-0 bottom-0 w-px bg-gradient-to-b from-[#8B5CF6] via-[#3B82F6] to-[#06D7F6]" />
            <div className="space-y-5">
              {proposal.timeline.phases.map((phase: any, i: number) => (
                <div key={i} className="relative pl-10">
                  <div className="absolute left-0 size-7 rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center text-[10px] font-bold text-white">
                    {i + 1}
                  </div>
                  <div className="bg-black/20 border border-white/6 rounded-xl p-3.5">
                    <h5 className="font-semibold text-white text-sm mb-2">{phase.phase}</h5>
                    <ul className="space-y-1">
                      {phase.activities?.map((act: string, ai: number) => (
                        <li key={ai} className="text-xs text-gray-400 flex items-start gap-2">
                          <span className="text-[#06D7F6] mt-0.5">•</span>
                          {act}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </ProposalSection>
      )}

      {/* ── Investment ── */}
      {proposal.investment && (
        <ProposalSection
          title="Investment"
          icon={<DollarSign className="size-4" style={{ color: CYAN }} />}
          color={CYAN}
          expanded={expanded.investment}
          onToggle={() => toggle('investment')}
          sectionKey="investment"
        >
          <div className="space-y-5">
            <div className="text-center py-4">
              <div className="text-5xl font-black text-[#06D7F6] mb-1">
                ${proposal.investment.amount?.toLocaleString()}
              </div>
              <p className="text-gray-500 text-sm uppercase tracking-wider">
                {proposal.investment.structure} · {proposal.investment.currency}
              </p>
            </div>

            <div className="space-y-3 border-t border-white/8 pt-4">
              {[
                proposal.investment.payment_terms,
                proposal.investment.includes_note,
              ].filter(Boolean).map((line: string, i: number) => (
                <div key={i} className="flex items-start gap-2.5">
                  <CheckCircle2 className="size-4 text-[#06D7F6] flex-shrink-0 mt-0.5" />
                  <span className="text-sm text-gray-300">{line}</span>
                </div>
              ))}
              {proposal.investment.credit_to_next_phase && (
                <div className="flex items-start gap-2.5 p-3 bg-[#FB923C]/8 border border-[#FB923C]/20 rounded-xl">
                  <Zap className="size-4 text-[#FB923C] flex-shrink-0 mt-0.5" />
                  <span className="text-sm text-gray-300">
                    <strong className="text-[#FB923C]">Full credit to next phase:</strong>{' '}
                    If you proceed to implementation, the entire ${proposal.investment.credit_amount?.toLocaleString()} audit fee is credited to your first build phase.
                  </span>
                </div>
              )}
            </div>

            {proposal.investment.reassurance && (
              <div className="p-4 bg-gradient-to-r from-[#8B5CF6]/8 to-[#3B82F6]/5 border border-[#8B5CF6]/15 rounded-xl">
                <p className="text-sm text-gray-300 italic">
                  <AnnotatableText text={proposal.investment.reassurance} sectionKey="investment" />
                </p>
              </div>
            )}
          </div>
        </ProposalSection>
      )}

      {/* ── Next Steps ── */}
      {proposal.next_steps?.steps?.length > 0 && (
        <div className="bg-gradient-to-br from-[#8B5CF6]/10 to-[#3B82F6]/5 border border-[#8B5CF6]/20 rounded-2xl p-6">
          <h3 className="font-bold text-white mb-4 flex items-center gap-2">
            <CheckCircle2 className="size-5 text-[#8B5CF6]" />
            Next Steps
          </h3>
          <div className="space-y-2.5 mb-6">
            {proposal.next_steps.steps.map((step: string, i: number) => (
              <div key={i} className="flex items-start gap-3">
                <span className="size-5 rounded-full bg-[#8B5CF6]/20 border border-[#8B5CF6]/40 flex items-center justify-center text-[10px] font-bold text-[#8B5CF6] flex-shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <span className="text-sm text-gray-300">{step}</span>
              </div>
            ))}
          </div>

          {/* Accept / Decline CTAs */}
          {canRespond && !isFinalized && (
            <div className="flex gap-3">
              <button
                onClick={() => handleRespond('accepted')}
                disabled={isResponding}
                className="flex-1 py-3.5 bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {isResponding
                  ? <Loader2 className="size-4 animate-spin" />
                  : <CheckCheck className="size-4" />
                }
                Accept Proposal
              </button>
              <button
                onClick={() => handleRespond('rejected')}
                disabled={isResponding}
                className="px-5 py-3.5 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 hover:text-white rounded-xl font-medium text-sm transition-all disabled:opacity-50"
              >
                Decline
              </button>
            </div>
          )}

          {isAccepted && (
            <div className="flex items-center gap-2 py-3 justify-center text-[#10B981] font-semibold text-sm">
              <CheckCheck className="size-5" />
              Proposal Accepted — Our team will be in touch shortly
            </div>
          )}
          {isRejected && (
            <div className="py-3 text-center text-gray-500 text-sm">
              You've declined this proposal. Send us a message if you'd like to discuss alternatives.
            </div>
          )}
        </div>
      )}

      {/* ── Future Path ── */}
      {proposal.future_path?.future_services?.length > 0 && (
        <div className="bg-black/30 border border-white/8 rounded-2xl p-6">
          <h3 className="font-bold text-white mb-1">{proposal.future_path.section_title || 'What This Unlocks Next'}</h3>
          {proposal.future_path.note && (
            <p className="text-gray-500 text-xs mb-4">{proposal.future_path.note}</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            {proposal.future_path.future_services.map((svc: any, i: number) => (
              <div key={i} className="p-3.5 bg-black/20 border border-white/6 rounded-xl">
                <h5 className="font-semibold text-white text-sm mb-1">{svc.name}</h5>
                <p className="text-gray-500 text-xs leading-relaxed">{svc.brief_description}</p>
                {svc.typical_timeline && (
                  <span className="inline-block mt-2 text-[10px] px-2 py-0.5 rounded-full bg-[#8B5CF6]/10 text-[#8B5CF6]/70">
                    {svc.typical_timeline}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
    </AnnotationProvider>
  );
}

// ── Collapsible section card ──────────────────────────────────────────────────

function ProposalSection({
  title, icon, color, expanded, onToggle, sectionKey, children,
}: {
  title:       string;
  icon:        React.ReactNode;
  color:       string;
  expanded:    boolean;
  onToggle:    () => void;
  sectionKey?: string;
  children:    React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-black/40 border border-white/10 rounded-2xl overflow-hidden"
      data-section-key={sectionKey}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/3 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}18` }}>
            {icon}
          </div>
          <span className="font-semibold text-white text-sm">{title}</span>
        </div>
        {expanded
          ? <ChevronUp className="size-4 text-gray-500" />
          : <ChevronDown className="size-4 text-gray-500" />
        }
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 border-t border-white/8">
              <div className="pt-4">{children}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}