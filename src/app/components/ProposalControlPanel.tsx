/**
 * PROPOSAL CONTROL PANEL — Phase 5: Proposal Control & Export
 *
 * §7 of ProposalDraftEditor
 *
 * Implements:
 *   1. State Machine visualization
 *   2. Proposal Integrity Lock (all 4 gates must pass)
 *   3. Client-Facing Simplification Layer
 *   4. Export Type selector (Executive / Detailed / Internal Review)
 *   5. Expiration Logic (14–30 day validity)
 *   6. Signature & Approval Block
 *   7. Export CTA (only active when ready_to_send + all gates pass)
 *   8. Print-formatted client preview modal
 */

import React, { useState, useMemo, useRef } from 'react';
import {
  Send, Download, Eye, Lock, Unlock, Clock, CheckCircle2,
  XCircle, AlertCircle, FileText, Shield, ShieldCheck, ShieldX,
  Calendar, User, Pen, RefreshCw, X, Check, Info,
  ArrowRight, Printer,
} from 'lucide-react';
import type {
  ProposalDraft, ExportType, ApprovalBlock, SignatureBlock,
} from '@/app/types/cortex-types';
import {
  runReadyGate, runPhase2Gate, runPhase3Gate, runPhase4Gate, runPhase5Gate,
} from '@/app/core/proposalGateEngine';
import type { GateResult } from '@/app/core/proposalGateEngine';

// ════════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════════════════════

const EXPORT_TYPES: { id: ExportType; label: string; desc: string; icon: React.FC<{ className?: string }> }[] = [
  {
    id:    'executive_pdf',
    label: 'Executive PDF',
    desc:  'Clean 4-page summary. Brief, Diagnosis, ROI, Governance. For C-suite.',
    icon:  FileText,
  },
  {
    id:    'detailed_pdf',
    label: 'Detailed PDF',
    desc:  'Full proposal with solution architecture and implementation timeline.',
    icon:  FileText,
  },
  {
    id:    'internal_review_pdf',
    label: 'Internal Review',
    desc:  'Includes all gates, version hash, and team annotations. Not for clients.',
    icon:  Shield,
  },
];

const STATE_PIPELINE: { id: ProposalDraft['status']; label: string; short: string }[] = [
  { id: 'draft',            label: 'Draft',             short: 'Draft'    },
  { id: 'internal_review',  label: 'Internal Review',   short: 'Int. Rev' },
  { id: 'financial_binding',label: 'Financial Binding', short: 'Fin. Bind'},
  { id: 'approved',         label: 'Approved',          short: 'Appvd'    },
  { id: 'ready_to_send',    label: 'Ready to Send',     short: 'Ready'    },
  { id: 'sent',             label: 'Sent',              short: 'Sent'     },
  { id: 'viewed',           label: 'Viewed',            short: 'Viewed'   },
];

const VALIDITY_DAYS = 30;

const DEFAULT_APPROVAL: ApprovalBlock = {
  signature_required:         true,
  payment_terms:              '50% upfront, 50% upon roadmap delivery',
  contract_reference_required: true,
};

const DEFAULT_SIGNATURE: SignatureBlock = {
  client_representative_name: '',
  title:                      '',
  date:                       null,
  authorized:                 false,
};

// ════════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════════

function gateStatusColor(result: GateResult): string {
  return result.passed ? '#10B981' : '#FD4438';
}

function gateStatusIcon(result: GateResult) {
  return result.passed
    ? <CheckCircle2 className="size-3 text-[#10B981]" />
    : <XCircle     className="size-3 text-[#FD4438]" />;
}

function formatExpiryCountdown(expiresAt: string | null): { text: string; color: string; urgent: boolean } {
  if (!expiresAt) return { text: 'Not yet sent', color: '#6B7280', urgent: false };
  const msLeft = new Date(expiresAt).getTime() - Date.now();
  if (msLeft <= 0) return { text: 'EXPIRED', color: '#FD4438', urgent: true };
  const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
  if (daysLeft <= 3) return { text: `${daysLeft}d remaining`, color: '#FD4438', urgent: true };
  if (daysLeft <= 7) return { text: `${daysLeft}d remaining`, color: '#FB923C', urgent: false };
  return { text: `${daysLeft}d remaining`, color: '#10B981', urgent: false };
}

// ════════════════════════════════════════════════════════════════════════════════
// CLIENT PREVIEW MODAL
// ════════════════════════════════════════════════════════════════════════════════

function ClientPreviewModal({
  draft,
  exportType,
  approvalBlock,
  signatureBlock,
  onClose,
}: {
  draft:         ProposalDraft;
  exportType:    ExportType;
  approvalBlock: ApprovalBlock;
  signatureBlock: SignatureBlock;
  onClose:       () => void;
}) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`
      <!DOCTYPE html><html><head>
        <title>${draft.executive_brief.title || 'Proposal'} — ${draft.client.company_name}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #111; background: #fff; padding: 40px; }
          h1 { font-size: 28px; font-weight: 900; margin-bottom: 8px; }
          h2 { font-size: 18px; font-weight: 700; color: #8B5CF6; margin: 32px 0 12px; border-bottom: 2px solid #8B5CF6; padding-bottom: 6px; }
          h3 { font-size: 14px; font-weight: 700; margin: 16px 0 6px; }
          p { font-size: 13px; line-height: 1.6; color: #333; margin-bottom: 8px; }
          .subtitle { color: #666; font-size: 14px; margin-bottom: 4px; }
          .cover { text-align: center; padding: 60px 0; border-bottom: 3px solid #8B5CF6; margin-bottom: 40px; }
          .cover .client { font-size: 20px; font-weight: 700; color: #8B5CF6; margin-bottom: 8px; }
          .cover .date { font-size: 12px; color: #888; margin-top: 16px; }
          ul { padding-left: 20px; }
          li { font-size: 13px; line-height: 1.7; color: #333; }
          .metric { display: inline-block; background: #f3f0ff; color: #8B5CF6; font-weight: 700; padding: 4px 12px; border-radius: 20px; font-size: 14px; margin: 4px 4px 4px 0; }
          .diagnosis { background: #fafafa; border-left: 4px solid #8B5CF6; padding: 16px; margin-bottom: 16px; border-radius: 4px; }
          .sig-block { border: 2px solid #eee; padding: 24px; margin-top: 40px; }
          .sig-row { display: flex; gap: 40px; margin-top: 24px; }
          .sig-field { flex: 1; border-bottom: 1px solid #aaa; padding-bottom: 32px; }
          .sig-label { font-size: 11px; color: #888; margin-top: 4px; }
          .payment { font-size: 12px; color: #555; margin-top: 12px; font-style: italic; }
          @media print { body { padding: 20px; } }
        </style>
      </head><body>
        ${content.innerHTML}
      </body></html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 500);
  };

  const fs  = draft.financial_summary;
  const eb  = draft.executive_brief;
  const now = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const isInternal = exportType === 'internal_review_pdf';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto">
      <div className="w-full max-w-3xl bg-[#0D0D14] border border-white/15 rounded-2xl overflow-hidden shadow-2xl my-6">
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/30">
          <span className="flex items-center gap-2.5 text-sm font-bold text-white">
            <Eye className="size-4 text-[#8B5CF6]" />
            Client Preview
            <span className="text-[9px] px-2 py-0.5 rounded-full border text-[#8B5CF6] border-[#8B5CF6]/30 bg-[#8B5CF6]/10 font-bold uppercase tracking-wider">
              {EXPORT_TYPES.find(t => t.id === exportType)?.label}
            </span>
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#8B5CF6]/15 border border-[#8B5CF6]/30 text-[#8B5CF6] text-[10px] font-bold rounded-lg hover:bg-[#8B5CF6]/25 transition-colors"
            >
              <Printer className="size-3" />Print / Save PDF
            </button>
            <button onClick={onClose} className="text-gray-600 hover:text-gray-300 transition-colors">
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* Printable content */}
        <div className="p-6 overflow-y-auto max-h-[75vh]">
          <div
            ref={printRef}
            className="bg-white text-gray-900 rounded-xl p-8 text-sm leading-relaxed"
          >
            {/* Cover */}
            <div className="text-center pb-8 mb-8 border-b-4 border-purple-600">
              <div className="text-purple-600 font-bold text-lg mb-2">{draft.client.company_name}</div>
              <h1 className="text-3xl font-black text-gray-900 mb-3">
                {eb.title || 'Strategic Transformation Proposal'}
              </h1>
              <div className="text-gray-500 text-sm">
                Prepared by MARQ Cortex · {now}
              </div>
              <div className="text-gray-400 text-xs mt-2">
                {draft.client.primary_contact.name} · {draft.client.primary_contact.title}
              </div>
              {isInternal && (
                <div className="mt-4 inline-block bg-red-50 border border-red-200 text-red-600 text-xs font-bold px-3 py-1 rounded-full">
                  INTERNAL REVIEW — NOT FOR CLIENT DISTRIBUTION
                </div>
              )}
            </div>

            {/* Executive Brief */}
            <h2 className="text-lg font-black text-purple-700 border-b-2 border-purple-200 pb-2 mb-4">
              Executive Overview
            </h2>
            {eb.strategic_context && (
              <div className="mb-4">
                <h3 className="font-bold text-gray-800 text-sm mb-2">Strategic Context</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{eb.strategic_context}</p>
              </div>
            )}
            {eb.why_now && (
              <div className="mb-4">
                <h3 className="font-bold text-gray-800 text-sm mb-2">Why Now</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{eb.why_now}</p>
              </div>
            )}
            {eb.what_success_looks_like && (
              <div className="mb-4">
                <h3 className="font-bold text-gray-800 text-sm mb-2">What Success Looks Like</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{eb.what_success_looks_like}</p>
              </div>
            )}
            {eb.positioning_statement && (
              <blockquote className="border-l-4 border-purple-400 pl-4 italic text-purple-700 my-4">
                "{eb.positioning_statement}"
              </blockquote>
            )}

            {/* Diagnosis */}
            <h2 className="text-lg font-black text-purple-700 border-b-2 border-purple-200 pb-2 mb-4 mt-8">
              Confirmed Diagnosis
            </h2>
            {draft.diagnosis_blocks.map((b, i) => (
              <div key={b.diagnosis_id} className="mb-4 bg-gray-50 border-l-4 border-purple-400 pl-4 py-3 rounded-r-lg">
                <div className="font-bold text-gray-800 text-sm mb-1">{b.title}</div>
                <p className="text-gray-600 text-xs leading-relaxed mb-2">{b.description}</p>
                {b.financial_impact.length > 0 && (
                  <ul className="list-disc list-inside text-xs text-gray-500 space-y-0.5">
                    {b.financial_impact.map((f, fi) => <li key={fi}>{f}</li>)}
                  </ul>
                )}
              </div>
            ))}

            {/* Solutions summary (always show, even in executive) */}
            {draft.solutions && draft.solutions.length > 0 && (
              <span className="contents">
                <h2 className="text-lg font-black text-purple-700 border-b-2 border-purple-200 pb-2 mb-4 mt-8">
                  Solution Architecture
                </h2>
                {draft.solutions.map((s, i) => (
                  <div key={s.solution_id} className="mb-4">
                    <div className="font-bold text-gray-800 text-sm">{s.title}</div>
                    <p className="text-gray-600 text-xs mt-1">{s.system_description}</p>
                    {s.expected_operational_outcomes.length > 0 && (
                      <ul className="list-disc list-inside text-xs text-gray-500 mt-2 space-y-0.5">
                        {s.expected_operational_outcomes.slice(0, 3).map((o, oi) => <li key={oi}>{o}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </span>
            )}

            {/* Timeline */}
            {draft.implementation_plan?.phases && draft.implementation_plan.phases.length > 0 && (
              <span className="contents">
                <h2 className="text-lg font-black text-purple-700 border-b-2 border-purple-200 pb-2 mb-4 mt-8">
                  Implementation Timeline
                </h2>
                <div className="space-y-3">
                  {draft.implementation_plan.phases.map(phase => (
                    <div key={phase.phase_number} className="flex gap-4 items-start">
                      <div className="text-xs font-bold text-purple-600 w-20 flex-shrink-0 pt-0.5">
                        Phase {phase.phase_number}
                      </div>
                      <div>
                        <div className="font-bold text-gray-800 text-xs">{phase.title}</div>
                        <div className="text-gray-500 text-xs">{phase.duration_weeks} weeks</div>
                      </div>
                    </div>
                  ))}
                </div>
              </span>
            )}

            {/* Financial — expected scenario only (client view) */}
            {fs && exportType !== 'internal_review_pdf' && (
              <span className="contents">
                <h2 className="text-lg font-black text-purple-700 border-b-2 border-purple-200 pb-2 mb-4 mt-8">
                  Investment &amp; Financial Outlook
                </h2>
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="bg-purple-50 rounded-lg p-4 text-center">
                    <div className="text-2xl font-black text-purple-700">
                      ${(fs.investment_total ?? 0).toLocaleString()}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">Total Investment</div>
                  </div>
                  <div className="bg-green-50 rounded-lg p-4 text-center">
                    <div className="text-2xl font-black text-green-700">
                      {(fs.roi_percentage ?? 0).toFixed(0)}%
                    </div>
                    <div className="text-xs text-gray-500 mt-1">Expected ROI</div>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-4 text-center">
                    <div className="text-2xl font-black text-blue-700">
                      Month {fs.payback_month ?? '—'}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">Break-Even</div>
                  </div>
                </div>
                <p className="text-xs text-gray-400 italic">
                  Projections based on expected scenario. Actual results depend on implementation quality and client engagement.
                </p>
              </span>
            )}

            {/* Internal-only: confidence scores + version */}
            {isInternal && fs && (
              <span className="contents">
                <h2 className="text-lg font-black text-red-700 border-b-2 border-red-200 pb-2 mb-4 mt-8">
                  Internal: Financial Detail
                </h2>
                <div className="text-xs text-gray-600 space-y-1">
                  <div>Confidence Score: <strong>{fs.confidence_score}%</strong></div>
                  <div>Monte Carlo Mean ROI: <strong>{(fs.monte_carlo?.mean_roi ?? 0).toFixed(1)}%</strong></div>
                  <div>P10–P90 ROI Range: <strong>{(fs.monte_carlo?.p10_roi ?? 0).toFixed(0)}% – {(fs.monte_carlo?.p90_roi ?? 0).toFixed(0)}%</strong></div>
                  <div>IRR (Annual): <strong>{(fs.irr_annual ?? 0).toFixed(1)}%</strong></div>
                  <div>NPV: <strong>${(fs.npv ?? 0).toLocaleString()}</strong></div>
                  <div>Portfolio Version: <strong>{fs.portfolio_version_id}</strong></div>
                </div>
              </span>
            )}

            {/* Governance */}
            {draft.implementation_plan?.governance_controls && (
              <span className="contents">
                <h2 className="text-lg font-black text-purple-700 border-b-2 border-purple-200 pb-2 mb-4 mt-8">
                  Governance
                </h2>
                <ul className="text-xs text-gray-600 space-y-1.5 list-disc list-inside">
                  {draft.implementation_plan.governance_controls.human_in_loop && (
                    <li>Human-in-loop oversight on all AI-automated decisions</li>
                  )}
                  {draft.implementation_plan.governance_controls.approval_required_for_automation && (
                    <li>Client approval required before any automation is activated</li>
                  )}
                  {draft.implementation_plan.governance_controls.quarterly_review && (
                    <li>Quarterly review sessions scheduled throughout engagement</li>
                  )}
                  {draft.implementation_plan.governance_controls.roi_revalidation_required && (
                    <li>ROI revalidation required at each phase milestone</li>
                  )}
                </ul>
              </span>
            )}

            {/* Signature & Approval */}
            <div className="border-2 border-gray-200 rounded-lg p-6 mt-10">
              <h2 className="text-lg font-black text-gray-800 mb-1">Signature &amp; Approval</h2>
              <p className="text-xs text-gray-500 mb-4">
                Payment Terms: <strong>{approvalBlock.payment_terms}</strong>
              </p>
              <div className="grid grid-cols-2 gap-8 mt-6">
                <div>
                  <div className="border-b border-gray-400 pb-8 mb-2">
                    {signatureBlock.authorized && signatureBlock.client_representative_name && (
                      <div className="text-gray-400 italic text-sm">
                        {signatureBlock.client_representative_name}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    {signatureBlock.client_representative_name || 'Client Representative'} · {signatureBlock.title || 'Title'}
                  </div>
                </div>
                <div>
                  <div className="border-b border-gray-400 pb-8 mb-2" />
                  <div className="text-xs text-gray-500">
                    Date: {signatureBlock.date || '________________'}
                  </div>
                </div>
              </div>
              {approvalBlock.contract_reference_required && (
                <p className="text-xs text-gray-400 mt-4 italic">
                  This proposal is subject to the MARQ Cortex Master Services Agreement. A contract reference number will be issued upon signature.
                </p>
              )}
            </div>

            {/* Footer */}
            <div className="text-center text-xs text-gray-400 mt-8 pt-4 border-t border-gray-100">
              Proposal v{draft.metadata.version} · Generated {now} · MARQ Cortex Intelligence Platform
              {isInternal && ` · Hash: #${draft.metadata.version}`}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// INTEGRITY LOCK PANEL
// ════════════════════════════════════════════════════════════════════════════════

function IntegrityLock({ draft }: { draft: ProposalDraft }) {
  const gates = useMemo(() => ({
    p1: runReadyGate(draft),
    p2: runPhase2Gate(draft),
    p3: runPhase3Gate(draft),
    p4: runPhase4Gate(draft),
  }), [draft]);

  const allPass    = gates.p1.passed && gates.p2.passed && gates.p3.passed && gates.p4.passed;
  const versionOk  = !draft.financial_summary ||
    draft.financial_summary.portfolio_version_id === draft.linkage.portfolio_version_id;

  const rows: { label: string; sub: string; result: GateResult }[] = [
    { label: 'Phase 1 Ready Gate',           sub: `${gates.p1.checks_passed}/${gates.p1.checks_total} checks`, result: gates.p1 },
    { label: 'Phase 2 Solution Binding',      sub: `${gates.p2.checks_passed}/${gates.p2.checks_total} checks`, result: gates.p2 },
    { label: 'Phase 3 ROI Bound',             sub: `${gates.p3.checks_passed}/${gates.p3.checks_total} checks`, result: gates.p3 },
    { label: 'Phase 4 Timeline Complete',     sub: `${gates.p4.checks_passed}/${gates.p4.checks_total} checks`, result: gates.p4 },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-3">
        {allPass && versionOk
          ? <ShieldCheck className="size-3.5 text-[#10B981]" />
          : <ShieldX     className="size-3.5 text-[#FD4438]" />
        }
        <span className="text-[9px] font-bold uppercase tracking-wider text-gray-500">
          Proposal Integrity Lock
        </span>
        <span
          className="text-[9px] px-1.5 py-0.5 rounded font-bold"
          style={{
            color:      allPass && versionOk ? '#10B981' : '#FD4438',
            background: allPass && versionOk ? '#10B98115' : '#FD443815',
          }}
        >
          {allPass && versionOk ? 'CLEARED' : 'BLOCKED'}
        </span>
      </div>

      {rows.map(row => (
        <div
          key={row.label}
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg border"
          style={{
            borderColor: row.result.passed ? '#10B98120' : '#FD443818',
            background:  row.result.passed ? '#10B98108' : '#FD443808',
          }}
        >
          {gateStatusIcon(row.result)}
          <span className="flex-1 min-w-0">
            <span className="text-[10px] font-semibold text-gray-300 block leading-none">{row.label}</span>
            <span className="text-[9px] text-gray-600">{row.sub}</span>
          </span>
          {!row.result.passed && (
            <span className="text-[9px] text-[#FD4438] font-bold flex-shrink-0">
              {row.result.missing.length} issue{row.result.missing.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      ))}

      {/* ROI version check */}
      <div
        className="flex items-center gap-2.5 px-3 py-2 rounded-lg border"
        style={{
          borderColor: versionOk ? '#10B98120' : '#FD443818',
          background:  versionOk ? '#10B98108' : '#FD443808',
        }}
      >
        {versionOk
          ? <CheckCircle2 className="size-3 text-[#10B981]" />
          : <XCircle      className="size-3 text-[#FD4438]" />
        }
        <span className="flex-1 min-w-0">
          <span className="text-[10px] font-semibold text-gray-300 block leading-none">No Pending ROI Recalculation</span>
          <span className="text-[9px] text-gray-600">Portfolio version matches financial summary</span>
        </span>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// STATE MACHINE STRIP
// ════════════════════════════════════════════════════════════════════════════════

function StateMachineStrip({ currentStatus }: { currentStatus: ProposalDraft['status'] }) {
  const currentIdx = STATE_PIPELINE.findIndex(s => s.id === currentStatus);

  return (
    <div className="flex items-center gap-0 overflow-x-auto pb-1">
      {STATE_PIPELINE.map((state, i) => {
        const isCurrent = state.id === currentStatus;
        const isPast    = i < currentIdx;
        const isFuture  = i > currentIdx;

        return (
          <span key={state.id} className="contents">
            <div className="flex-shrink-0 flex flex-col items-center gap-1">
              <div
                className="relative flex items-center justify-center rounded-full transition-all"
                style={{
                  width:      isCurrent ? 28 : 20,
                  height:     isCurrent ? 28 : 20,
                  background: isCurrent
                    ? '#8B5CF6'
                    : isPast
                    ? '#10B981'
                    : '#ffffff0a',
                  border:     isCurrent
                    ? '2px solid #8B5CF6'
                    : isPast
                    ? '2px solid #10B981'
                    : '2px solid #ffffff15',
                  boxShadow:  isCurrent ? '0 0 12px #8B5CF640' : undefined,
                }}
              >
                {isPast && <Check className="size-2.5 text-white" />}
                {isCurrent && <span className="size-2 rounded-full bg-white" />}
              </div>
              <span
                className="text-[8px] font-bold uppercase tracking-wide text-center leading-none"
                style={{
                  color: isCurrent ? '#A78BFA' : isPast ? '#6EE7B7' : '#374151',
                  minWidth: 40,
                }}
              >
                {state.short}
              </span>
            </div>
            {i < STATE_PIPELINE.length - 1 && (
              <div
                className="h-px flex-1 mx-1 min-w-[12px]"
                style={{
                  background: i < currentIdx ? '#10B981' : '#ffffff0a',
                }}
              />
            )}
          </span>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// ROOT EXPORT: ProposalControlPanel
// ════════════════════════════════════════════════════════════════════════════════

export interface ProposalControlPanelProps {
  draft:           ProposalDraft;
  onExport:        (exportType: ExportType) => void;
  gateResult5?:    GateResult | null;
}

export function ProposalControlPanel({
  draft,
  onExport,
  gateResult5,
}: ProposalControlPanelProps) {
  const [exportType,     setExportType]     = useState<ExportType>('executive_pdf');
  const [showPreview,    setShowPreview]     = useState(false);
  const [approvalBlock,  setApprovalBlock]   = useState<ApprovalBlock>(
    draft.approval_block ?? DEFAULT_APPROVAL,
  );
  const [signatureBlock, setSignatureBlock]  = useState<SignatureBlock>(
    draft.signature_block ?? DEFAULT_SIGNATURE,
  );
  const [editingSig,     setEditingSig]      = useState(false);

  const isReadyToSend   = draft.status === 'ready_to_send';
  // 'approved' is the INTERNAL Phase-3 approval state — NOT a post-send state.
  // isSent must only be true for states after the 30-day clock has started.
  const isSent          = draft.status === 'sent' || draft.status === 'viewed' || draft.status === 'rejected' || draft.status === 'expired';
  const isLocked        = isSent || draft.proposal_state?.locked === true;

  // Compute integrity lock without Phase 5 status check (for display purposes)
  const integrityOk = useMemo(() => {
    const p1 = runReadyGate(draft);
    const p2 = runPhase2Gate(draft);
    const p3 = runPhase3Gate(draft);
    const p4 = runPhase4Gate(draft);
    const versionOk = !draft.financial_summary ||
      draft.financial_summary.portfolio_version_id === draft.linkage.portfolio_version_id;
    return p1.passed && p2.passed && p3.passed && p4.passed && versionOk;
  }, [draft]);

  const canExport = isReadyToSend && integrityOk;

  // Expiry info
  const expiryInfo = useMemo(() =>
    formatExpiryCountdown(draft.proposal_state?.expires_at ?? null),
  [draft.proposal_state]);

  return (
    <span className="contents">
      {showPreview && (
        <ClientPreviewModal
          draft={draft}
          exportType={exportType}
          approvalBlock={approvalBlock}
          signatureBlock={signatureBlock}
          onClose={() => setShowPreview(false)}
        />
      )}

      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5">
          <span className="flex items-center gap-2.5 text-sm font-bold text-white">
            <Send className="size-4" style={{ color: '#06D7F6' }} />
            §7 Proposal Control &amp; Export
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full font-bold border uppercase tracking-wider"
              style={{ color: '#06D7F6', borderColor: '#06D7F633', background: '#06D7F614' }}
            >
              Phase 5
            </span>
            {isLocked && (
              <span className="flex items-center gap-1 text-[9px] text-gray-600 font-normal">
                <Lock className="size-2.5" />locked
              </span>
            )}
          </span>
          {isReadyToSend && (
            <span className="text-[9px] px-2 py-1 rounded-lg bg-[#10B981]/10 text-[#10B981] font-bold border border-[#10B981]/20">
              READY TO EXPORT
            </span>
          )}
        </div>

        <div className="p-5 space-y-5">

          {/* ── State Machine ──────────────────���────────────────────────── */}
          <div className="space-y-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-gray-600">Proposal State Machine</div>
            <StateMachineStrip currentStatus={draft.status} />
          </div>

          {/* ── Phase 5 gate result panel (shown after attempting export) ── */}
          {gateResult5 && !gateResult5.passed && (
            <div className="border border-[#FD4438]/20 bg-[#FD4438]/[0.03] rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <ShieldX className="size-4 text-[#FD4438]" />
                <span className="text-sm font-bold text-[#FD4438]">
                  Export Blocked — {gateResult5.missing.length} Integrity Violation{gateResult5.missing.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="space-y-1.5">
                {gateResult5.missing.map((m, i) => (
                  <div key={i} className="flex items-start gap-2 text-[10px]">
                    <span className="text-[#FD4438] font-bold mt-0.5">✗</span>
                    <span className="text-gray-400 leading-relaxed">{m.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Two-column: Integrity Lock + Export Config ─────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Left: Integrity Lock */}
            <div className="bg-black/20 border border-white/6 rounded-xl p-4">
              <IntegrityLock draft={draft} />
            </div>

            {/* Right: Export type + Client view */}
            <div className="space-y-4">
              {/* Export type selector */}
              <div className="bg-black/20 border border-white/6 rounded-xl p-4">
                <div className="text-[9px] font-bold uppercase tracking-wider text-gray-600 mb-3">
                  Export Type
                </div>
                <div className="space-y-2">
                  {EXPORT_TYPES.map(et => (
                    <button
                      key={et.id}
                      onClick={() => !isLocked && setExportType(et.id)}
                      disabled={isLocked}
                      className="w-full flex items-start gap-3 p-2.5 rounded-lg border text-left transition-all"
                      style={{
                        borderColor: exportType === et.id ? '#06D7F640' : '#ffffff0a',
                        background:  exportType === et.id ? '#06D7F60a' : 'transparent',
                        opacity:     isLocked ? 0.5 : 1,
                      }}
                    >
                      <div
                        className="size-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5"
                        style={{
                          borderColor: exportType === et.id ? '#06D7F6' : '#ffffff20',
                          background:  exportType === et.id ? '#06D7F630' : 'transparent',
                        }}
                      >
                        {exportType === et.id && <span className="size-1.5 rounded-full bg-[#06D7F6]" />}
                      </div>
                      <div>
                        <div className="text-[10px] font-bold text-gray-200">{et.label}</div>
                        <div className="text-[9px] text-gray-600 leading-snug mt-0.5">{et.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Client view settings (read-only display) */}
              <div className="bg-black/20 border border-white/6 rounded-xl p-4">
                <div className="text-[9px] font-bold uppercase tracking-wider text-gray-600 mb-3">
                  Client View Settings
                </div>
                <div className="space-y-1.5">
                  {[
                    { label: 'ROI: Expected scenario only',        active: exportType !== 'internal_review_pdf' },
                    { label: 'Hide internal confidence scores',    active: exportType !== 'internal_review_pdf' },
                    { label: 'Hide Monte Carlo raw distribution',  active: exportType !== 'internal_review_pdf' },
                    { label: 'Simplify financial language',        active: exportType !== 'internal_review_pdf' },
                    { label: 'Hide complexity & dependency matrix',active: exportType !== 'internal_review_pdf' },
                  ].map(item => (
                    <div key={item.label} className="flex items-center gap-2">
                      {item.active
                        ? <CheckCircle2 className="size-3 text-[#10B981] flex-shrink-0" />
                        : <AlertCircle  className="size-3 text-[#F59E0B] flex-shrink-0" />
                      }
                      <span className="text-[9px] text-gray-500">{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── Expiration ─────────────────────────────────────────────── */}
          <div className="bg-black/20 border border-white/6 rounded-xl p-4 flex items-center gap-4">
            <Clock className="size-4 flex-shrink-0" style={{ color: expiryInfo.color }} />
            <div className="flex-1">
              <div className="text-[9px] font-bold uppercase tracking-wider text-gray-600 mb-1">
                Proposal Validity — {VALIDITY_DAYS}-Day Window
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs font-bold" style={{ color: expiryInfo.color }}>
                  {expiryInfo.text}
                </span>
                {draft.proposal_state?.sent_at && (
                  <span className="text-[9px] text-gray-600">
                    Sent: {new Date(draft.proposal_state.sent_at).toLocaleDateString()}
                  </span>
                )}
                {draft.proposal_state?.expires_at && (
                  <span className="text-[9px] text-gray-600">
                    Expires: {new Date(draft.proposal_state.expires_at).toLocaleDateString()}
                  </span>
                )}
                {!draft.proposal_state?.sent_at && (
                  <span className="text-[9px] text-gray-700 italic">
                    {VALIDITY_DAYS}-day clock starts upon send. Expiry triggers mandatory ROI revalidation.
                  </span>
                )}
              </div>
            </div>
            {expiryInfo.urgent && (
              <AlertCircle className="size-4 text-[#FD4438] flex-shrink-0" />
            )}
          </div>

          {/* ── Signature & Approval Block ─────────────────────────────── */}
          <div className="bg-black/20 border border-white/6 rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-[9px] font-bold uppercase tracking-wider text-gray-600 flex items-center gap-2">
                <Pen className="size-3" />Signature &amp; Approval Block
              </div>
              {!isLocked && (
                <button
                  onClick={() => setEditingSig(e => !e)}
                  className="text-[9px] font-bold text-gray-500 hover:text-[#8B5CF6] transition-colors px-2 py-1 rounded hover:bg-[#8B5CF6]/10"
                >
                  {editingSig ? 'View' : 'Edit'}
                </button>
              )}
            </div>

            {editingSig && !isLocked ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold uppercase tracking-wider text-gray-600">Client Representative Name</label>
                    <input
                      value={signatureBlock.client_representative_name}
                      onChange={e => setSignatureBlock(s => ({ ...s, client_representative_name: e.target.value }))}
                      placeholder="e.g. Sarah Mitchell"
                      className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#8B5CF6]/50 placeholder:text-gray-700"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold uppercase tracking-wider text-gray-600">Title</label>
                    <input
                      value={signatureBlock.title}
                      onChange={e => setSignatureBlock(s => ({ ...s, title: e.target.value }))}
                      placeholder="e.g. Chief Operating Officer"
                      className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#8B5CF6]/50 placeholder:text-gray-700"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-bold uppercase tracking-wider text-gray-600">Payment Terms</label>
                  <input
                    value={approvalBlock.payment_terms}
                    onChange={e => setApprovalBlock(a => ({ ...a, payment_terms: e.target.value }))}
                    className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#8B5CF6]/50"
                  />
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={approvalBlock.signature_required}
                      onChange={e => setApprovalBlock(a => ({ ...a, signature_required: e.target.checked }))}
                      className="accent-[#8B5CF6] size-3"
                    />
                    <span className="text-[10px] text-gray-400">Signature Required</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={approvalBlock.contract_reference_required}
                      onChange={e => setApprovalBlock(a => ({ ...a, contract_reference_required: e.target.checked }))}
                      className="accent-[#8B5CF6] size-3"
                    />
                    <span className="text-[10px] text-gray-400">Contract Reference Required</span>
                  </label>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-4 text-[10px]">
                  <div>
                    <div className="text-[9px] text-gray-600 uppercase tracking-wider mb-0.5">Client Representative</div>
                    <div className="text-gray-300 font-semibold">
                      {signatureBlock.client_representative_name || <span className="text-gray-600 italic">Not set</span>}
                    </div>
                    {signatureBlock.title && (
                      <div className="text-gray-600 text-[9px]">{signatureBlock.title}</div>
                    )}
                  </div>
                  <div>
                    <div className="text-[9px] text-gray-600 uppercase tracking-wider mb-0.5">Payment Terms</div>
                    <div className="text-gray-300 font-semibold">{approvalBlock.payment_terms}</div>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-[9px] text-gray-600">
                  <span className="flex items-center gap-1">
                    {approvalBlock.signature_required
                      ? <CheckCircle2 className="size-2.5 text-[#10B981]" />
                      : <XCircle      className="size-2.5 text-gray-600" />
                    }
                    Signature Required
                  </span>
                  <span className="flex items-center gap-1">
                    {approvalBlock.contract_reference_required
                      ? <CheckCircle2 className="size-2.5 text-[#10B981]" />
                      : <XCircle      className="size-2.5 text-gray-600" />
                    }
                    Contract Reference Required
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* ── Not ready banner ───────────────────────────────────────── */}
          {!isReadyToSend && !isSent && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-white/[0.025] border border-white/8">
              <Info className="size-3.5 text-gray-500 flex-shrink-0" />
              <p className="text-[10px] text-gray-500 leading-relaxed">
                Export is locked until proposal reaches <span className="font-mono text-gray-400">ready_to_send</span> status.
                Complete Phases 1–4 and advance via the <span className="font-bold text-gray-400">Ready to Send</span> action in the meta strip above.
              </p>
            </div>
          )}

          {/* ── Sent confirmation ──────────────────────────────────────── */}
          {isSent && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-[#10B981]/[0.05] border border-[#10B981]/20">
              <CheckCircle2 className="size-3.5 text-[#10B981] flex-shrink-0" />
              <p className="text-[10px] text-[#10B981]/80 leading-relaxed">
                Proposal has been sent. Financial fields are locked. Any edits require duplicating this proposal.
                {draft.proposal_state?.sent_at && (
                  <span className="contents"> Sent {new Date(draft.proposal_state.sent_at).toLocaleString()}.</span>
                )}
              </p>
            </div>
          )}

          {/* ── Export footer ──────────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-3 pt-1 border-t border-white/5">
            <div className="text-[9px] text-gray-700 flex items-center gap-1.5">
              <Lock className="size-2.5" />
              Only <span className="font-mono mx-0.5">ready_to_send</span> proposals can be exported.
              Once sent, financial fields lock permanently.
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setShowPreview(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-white/5 border border-white/10 text-gray-300 text-[10px] font-bold rounded-lg hover:bg-white/10 hover:border-white/20 transition-colors"
              >
                <Eye className="size-3" />Preview Client Version
              </button>
              <button
                onClick={() => canExport && onExport(exportType)}
                disabled={!canExport}
                className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-bold rounded-lg transition-all"
                style={{
                  background:  canExport ? 'linear-gradient(135deg, #06D7F6, #3B82F6)' : '#ffffff08',
                  color:       canExport ? '#0A0A0F' : '#374151',
                  cursor:      canExport ? 'pointer' : 'not-allowed',
                  boxShadow:   canExport ? '0 4px 16px #06D7F625' : undefined,
                }}
              >
                <Download className="size-3.5" />
                {canExport ? `Export ${EXPORT_TYPES.find(t => t.id === exportType)?.label}` : 'Export Locked'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </span>
  );
}