/**
 * CONTRACT DRAFT VIEWER — Phase 6: Contract Auto-Generation
 *
 * §8 of ProposalDraftEditor
 *
 * Renders auto-generated ContractPayload derived from ProposalDraft.
 * Implements:
 *   1. Auto-generation banner (what was derived and from where)
 *   2. Contract status machine: draft → sent → signed
 *   3. Scope of Work (solutions → deliverables)
 *   4. Implementation Milestones (phases → milestones + payment %)
 *   5. Payment Schedule
 *   6. Legal Protection Blocks (non-editable, locked display)
 *   7. Signature Block (read-only when signed)
 *   8. Project Kickoff Trigger (auto-fires when signed)
 *   9. Print-formatted full contract preview
 */

import React, { useState, useMemo, useRef, useCallback } from 'react';
import {
  FileText, CheckCircle2, Clock, AlertCircle, Lock,
  ChevronDown, ChevronRight, Shield, DollarSign,
  Users, Zap, Copy, Check, X, Eye, Printer,
  ArrowRight, Pen, Rocket, Package, Milestone,
  CreditCard, ShieldAlert, Send, RefreshCw,
} from 'lucide-react';
import type {
  ContractPayload, ContractStatus, ProposalDraft,
} from '@/app/types/cortex-types';
import { generateContractPayload } from '@/app/core/contractEngine';
import { runContractReadyGate }    from '@/app/core/contractEngine';
import type { ContractGateResult } from '@/app/core/contractEngine';

// ════════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════════════════════

const STATUS_PIPELINE: { id: ContractStatus; label: string; short: string }[] = [
  { id: 'draft',  label: 'Contract Draft',  short: 'Draft'  },
  { id: 'sent',   label: 'Sent to Client',  short: 'Sent'   },
  { id: 'signed', label: 'Signed',          short: 'Signed' },
];

const STATUS_CFG: Record<ContractStatus, { color: string; bg: string; label: string }> = {
  draft:  { color: '#8B5CF6', bg: '#8B5CF614', label: 'Draft'  },
  sent:   { color: '#06D7F6', bg: '#06D7F614', label: 'Sent'   },
  signed: { color: '#10B981', bg: '#10B98114', label: 'Signed' },
};

// ════════════════════════════════════════════════════════════════════════════════
// CONTRACT STATUS STRIP
// ════════════════════════════════════════════════════════════════════════════════

function ContractStatusStrip({ status }: { status: ContractStatus }) {
  const currentIdx = STATUS_PIPELINE.findIndex(s => s.id === status);

  return (
    <div className="flex items-center gap-0">
      {STATUS_PIPELINE.map((state, i) => {
        const isCurrent = state.id === status;
        const isPast    = i < currentIdx;

        return (
          <span key={state.id} className="contents">
            <div className="flex-shrink-0 flex flex-col items-center gap-1">
              <div
                className="flex items-center justify-center rounded-full transition-all"
                style={{
                  width:      isCurrent ? 26 : 18,
                  height:     isCurrent ? 26 : 18,
                  background: isCurrent ? '#8B5CF6' : isPast ? '#10B981' : '#ffffff0a',
                  border:     isCurrent ? '2px solid #8B5CF6' : isPast ? '2px solid #10B981' : '2px solid #ffffff15',
                  boxShadow:  isCurrent ? '0 0 10px #8B5CF640' : undefined,
                }}
              >
                {isPast    && <Check className="size-2.5 text-white" />}
                {isCurrent && <span className="size-1.5 rounded-full bg-white" />}
              </div>
              <span
                className="text-[8px] font-bold uppercase tracking-wide"
                style={{ color: isCurrent ? '#A78BFA' : isPast ? '#6EE7B7' : '#374151', minWidth: 36, textAlign: 'center' }}
              >
                {state.short}
              </span>
            </div>
            {i < STATUS_PIPELINE.length - 1 && (
              <div className="h-px flex-1 mx-1.5 min-w-[20px]"
                style={{ background: i < currentIdx ? '#10B981' : '#ffffff0a' }} />
            )}
          </span>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// LEGAL BLOCK ROW — non-editable
// ════════════════════════════════════════════════════════════════════════════════

function LegalBlockRow({
  block,
  expanded,
  onToggle,
}: {
  block: ContractPayload['legal_blocks'][0];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border border-white/6 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-2.5 bg-black/20 hover:bg-black/30 transition-colors text-left"
      >
        <Lock className="size-3 text-[#FD4438] flex-shrink-0" />
        <span className="flex-1 text-[10px] font-semibold text-gray-300">{block.title}</span>
        <span className="text-[9px] text-[#FD4438] font-bold mr-2">NON-EDITABLE</span>
        {expanded
          ? <ChevronDown  className="size-3 text-gray-600" />
          : <ChevronRight className="size-3 text-gray-600" />
        }
      </button>
      {expanded && (
        <div className="px-4 py-3 bg-[#FD4438]/[0.02] border-t border-white/5">
          <p className="text-[10px] text-gray-400 leading-relaxed">{block.text}</p>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// KICKOFF TRIGGER PANEL
// ════════════════════════════════════════════════════════════════════════════════

function KickoffTriggerPanel({ contract }: { contract: ContractPayload }) {
  const items = [
    { icon: FileText,  label: 'Invoice Generated',          desc: 'First payment invoice issued per payment schedule' },
    { icon: Package,   label: 'Project Created',            desc: 'Delivery project initialised with timeline and milestones' },
    { icon: Users,     label: 'Team Assigned',              desc: 'MARQ Cortex delivery team allocated to engagement' },
    { icon: Zap,       label: 'Onboarding Sequence Triggered', desc: 'Client onboarding workflow initiated automatically' },
  ];

  return (
    <div className="bg-[#10B981]/[0.04] border border-[#10B981]/20 rounded-xl p-4 space-y-4">
      <div className="flex items-center gap-2.5">
        <Rocket className="size-4 text-[#10B981]" />
        <div>
          <div className="text-sm font-bold text-[#10B981]">Project Kickoff Triggered</div>
          <div className="text-[9px] text-[#10B981]/60">Contract signed — all downstream actions initiated automatically</div>
        </div>
        {contract.signed_at && (
          <div className="ml-auto text-[9px] text-[#10B981]/60">
            Signed {new Date(contract.signed_at).toLocaleDateString()}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {items.map(item => (
          <div
            key={item.label}
            className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-[#10B981]/[0.06] border border-[#10B981]/15"
          >
            <CheckCircle2 className="size-3.5 text-[#10B981] flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-[10px] font-bold text-[#10B981]">{item.label}</div>
              <div className="text-[9px] text-gray-500 leading-snug">{item.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// CONTRACT PRINT PREVIEW MODAL
// ════════════════════════════════════════════════════════════════════════════════

function ContractPrintModal({
  contract,
  draft,
  onClose,
}: {
  contract: ContractPayload;
  draft: ProposalDraft;
  onClose: () => void;
}) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head>
      <title>${contract.contract_id} — ${contract.client_legal_name}</title>
      <style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family:'Helvetica Neue',Arial,sans-serif; color:#111; background:#fff; padding:48px; font-size:13px; }
        h1 { font-size:24px; font-weight:900; margin-bottom:6px; }
        h2 { font-size:15px; font-weight:700; color:#8B5CF6; border-bottom:2px solid #8B5CF6; padding-bottom:5px; margin:28px 0 12px; }
        h3 { font-size:12px; font-weight:700; margin:14px 0 5px; }
        p  { line-height:1.65; color:#333; margin-bottom:8px; }
        .cover { border-bottom:3px solid #8B5CF6; padding-bottom:32px; margin-bottom:32px; }
        .cover .ref { font-size:11px; color:#8B5CF6; font-weight:700; margin-bottom:4px; text-transform:uppercase; letter-spacing:.08em; }
        .cover .client { font-size:18px; font-weight:700; color:#8B5CF6; margin-bottom:4px; }
        .meta-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin:16px 0; }
        .meta-cell .label { font-size:10px; color:#888; text-transform:uppercase; letter-spacing:.06em; margin-bottom:2px; }
        .meta-cell .value { font-size:13px; font-weight:600; }
        table { width:100%; border-collapse:collapse; margin:12px 0; }
        th { font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:#666; text-align:left; padding:6px 8px; border-bottom:2px solid #eee; }
        td { padding:8px 8px; border-bottom:1px solid #f0f0f0; font-size:12px; }
        .legal { background:#fff8f8; border-left:3px solid #FD4438; padding:10px 14px; margin:10px 0; }
        .legal .lt { font-size:10px; color:#FD4438; font-weight:700; text-transform:uppercase; margin-bottom:4px; }
        .legal p  { font-size:11px; color:#555; margin:0; }
        .sig-block { border:1.5px solid #ddd; border-radius:6px; padding:20px; margin-top:32px; }
        .sig-row { display:grid; grid-template-columns:1fr 1fr; gap:32px; margin-top:20px; }
        .sig-line { border-bottom:1px solid #aaa; padding-bottom:28px; margin-bottom:4px; }
        .sig-label { font-size:10px; color:#888; }
        .badge { display:inline-block; padding:2px 8px; border-radius:12px; font-size:10px; font-weight:700; }
        .badge-draft  { background:#ede9fe; color:#7c3aed; }
        .badge-sent   { background:#e0f2fe; color:#0369a1; }
        .badge-signed { background:#dcfce7; color:#15803d; }
        @media print { body { padding:20px; } }
      </style>
    </head><body>${content.innerHTML}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 500);
  };

  const fs  = contract;
  const now = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto">
      <div className="w-full max-w-3xl bg-[#0D0D14] border border-white/15 rounded-2xl overflow-hidden shadow-2xl my-6">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/30">
          <span className="flex items-center gap-2.5 text-sm font-bold text-white">
            <Eye className="size-4 text-[#8B5CF6]" />
            Contract Preview — {contract.contract_id}
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
          <div ref={printRef} className="bg-white text-gray-900 rounded-xl p-8 text-sm leading-relaxed">
            {/* Cover */}
            <div className="cover">
              <div className="ref">Services Agreement — {contract.contract_id}</div>
              <h1>Master Services Agreement</h1>
              <div className="client">{contract.client_legal_name}</div>
              <div className="meta-grid">
                <div className="meta-cell">
                  <div className="label">Generated</div>
                  <div className="value">{now}</div>
                </div>
                <div className="meta-cell">
                  <div className="label">Proposal Reference</div>
                  <div className="value">{contract.proposal_id}</div>
                </div>
                <div className="meta-cell">
                  <div className="label">Total Investment</div>
                  <div className="value">{contract.currency} {contract.investment.toLocaleString()}</div>
                </div>
                <div className="meta-cell">
                  <div className="label">Payment Terms</div>
                  <div className="value">{contract.payment_terms}</div>
                </div>
              </div>
            </div>

            {/* SOW */}
            <h2>Scope of Work</h2>
            {contract.engagement_scope.map((d, i) => (
              <div key={d.deliverable_id} style={{ marginBottom: 16 }}>
                <h3>{d.deliverable_id}: {d.title}</h3>
                <p>{d.description}</p>
                {d.acceptance_criteria.length > 0 && (
                  <ul style={{ paddingLeft: 18, marginTop: 4 }}>
                    {d.acceptance_criteria.map((c, ci) => (
                      <li key={ci} style={{ fontSize: 12, color: '#555', lineHeight: 1.7 }}>{c}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}

            {/* Exclusions */}
            {contract.exclusions.length > 0 && (
              <span className="contents">
                <h2>Scope Exclusions</h2>
                <ul style={{ paddingLeft: 18 }}>
                  {contract.exclusions.map((ex, i) => (
                    <li key={i} style={{ fontSize: 12, color: '#555', lineHeight: 1.7 }}>{ex}</li>
                  ))}
                </ul>
              </span>
            )}

            {/* Milestones */}
            {contract.milestones.length > 0 && (
              <span className="contents">
                <h2>Implementation Milestones</h2>
                <table>
                  <thead>
                    <tr>
                      <th>Milestone</th>
                      <th>Phase</th>
                      <th>Duration</th>
                      <th style={{ textAlign: 'right' }}>Payment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contract.milestones.map(ms => (
                      <tr key={ms.milestone_id}>
                        <td style={{ fontWeight: 600 }}>{ms.title}</td>
                        <td>Phase {ms.phase_number}</td>
                        <td>{ms.duration_weeks}w</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#8B5CF6' }}>
                          {ms.payment_percentage}% ({contract.currency} {Math.round(contract.investment * ms.payment_percentage / 100).toLocaleString()})
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </span>
            )}

            {/* Payment Schedule */}
            <h2>Payment Schedule</h2>
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Trigger</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {contract.payment_schedule.map((ps, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{ps.label}</td>
                    <td style={{ color: '#666' }}>{ps.due_trigger}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>
                      {contract.currency} {ps.amount.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Legal Blocks */}
            <h2>Legal Protections & Governing Clauses</h2>
            {contract.legal_blocks.map(lb => (
              <div key={lb.id} className="legal">
                <div className="lt">{lb.title}</div>
                <p>{lb.text}</p>
              </div>
            ))}

            {/* Signature */}
            <div className="sig-block">
              <h2 style={{ margin: '0 0 4px', border: 'none', color: '#111' }}>Signature & Execution</h2>
              <p style={{ color: '#666', fontSize: 12, marginBottom: 0 }}>
                By signing below, both parties agree to the terms and conditions set out in this agreement.
              </p>
              <div className="sig-row">
                <div>
                  <div className="sig-line" />
                  <div className="sig-label">Client Authorised Signatory</div>
                  <div className="sig-label" style={{ marginTop: 4 }}>Name / Title / Date</div>
                </div>
                <div>
                  <div className="sig-line" />
                  <div className="sig-label">MARQ Cortex Authorised Signatory</div>
                  <div className="sig-label" style={{ marginTop: 4 }}>Name / Title / Date</div>
                </div>
              </div>
              <p style={{ fontSize: 11, color: '#888', marginTop: 12, fontStyle: 'italic' }}>
                {contract.termination_clause}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// ROOT EXPORT
// ════════════════════════════════════════════════════════════════════════════════

export interface ContractDraftViewerProps {
  draft:             ProposalDraft;
  onContractChange?: (contract: ContractPayload) => void;
}

export function ContractDraftViewer({ draft, onContractChange }: ContractDraftViewerProps) {
  const [contract, setContract]         = useState<ContractPayload>(() => generateContractPayload(draft));
  const [expandedLegal, setExpandedLegal] = useState<Set<string>>(new Set());
  const [showPreview, setShowPreview]   = useState(false);
  const [copiedEmail, setCopiedEmail]   = useState(false);

  const cfg = STATUS_CFG[contract.status];

  const handleRegenerate = useCallback(() => {
    const fresh = generateContractPayload(draft);
    setContract(fresh);
    onContractChange?.(fresh);
    console.log(`[ContractEngine] Regenerated → ${fresh.contract_id} from ${draft.proposal_id}`);
  }, [draft, onContractChange]);

  const handleAdvanceStatus = useCallback((next: ContractStatus) => {
    const now = new Date().toISOString();
    const updated: ContractPayload = {
      ...contract,
      status:            next,
      sent_at:           next === 'sent'   ? now : contract.sent_at,
      signed_at:         next === 'signed' ? now : contract.signed_at,
      kickoff_triggered: next === 'signed' ? true : contract.kickoff_triggered,
    };
    setContract(updated);
    onContractChange?.(updated);
    console.log(`[ContractEngine] Status → ${next} (${updated.contract_id})`);
  }, [contract, onContractChange]);

  const toggleLegal = useCallback((id: string) => {
    setExpandedLegal(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const totalWeeks = useMemo(() =>
    contract.milestones.reduce((a, m) => a + m.duration_weeks, 0),
  [contract.milestones]);

  const pctCheck = useMemo(() => {
    const sum = contract.payment_schedule.reduce((a, p) => a + p.percentage, 0);
    return Math.abs(sum - 100) <= 1;
  }, [contract.payment_schedule]);

  /** Contract Ready Gate — deterministic, blocks Send to Client if failed */
  const gateResult = useMemo(
    () => runContractReadyGate(draft, contract),
    [draft, contract],
  );

  /** ROI drift: portfolio_version_id changed after contract was generated */
  const roiInvalidated = Boolean(
    contract.roi_version_snapshot &&
    draft.financial_summary?.portfolio_version_id &&
    contract.roi_version_snapshot !== draft.financial_summary.portfolio_version_id,
  );

  return (
    <span className="contents">
      {showPreview && (
        <ContractPrintModal
          contract={contract}
          draft={draft}
          onClose={() => setShowPreview(false)}
        />
      )}

      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5">
          <span className="flex items-center gap-2.5 text-sm font-bold text-white">
            <FileText className="size-4" style={{ color: '#10B981' }} />
            §8 Contract Auto-Generation
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full font-bold border uppercase tracking-wider"
              style={{ color: '#10B981', borderColor: '#10B98133', background: '#10B98114' }}
            >
              Phase 6
            </span>
          </span>

          <div className="flex items-center gap-2">
            {/* Status badge */}
            <span
              className="text-[9px] px-2 py-1 rounded-lg font-bold border"
              style={{ color: cfg.color, borderColor: `${cfg.color}33`, background: cfg.bg }}
            >
              {contract.contract_id} · {cfg.label.toUpperCase()}
            </span>
            {/* Regenerate */}
            {contract.status === 'draft' && (
              <button
                onClick={handleRegenerate}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[9px] font-bold rounded-lg text-gray-500 hover:text-white border border-white/10 hover:border-white/20 bg-white/[0.02] hover:bg-white/5 transition-colors"
              >
                <RefreshCw className="size-2.5" />Regenerate
              </button>
            )}
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Status machine */}
          <div className="space-y-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-gray-600">Contract Lifecycle</div>
            <ContractStatusStrip status={contract.status} />
          </div>

          {/* Auto-generation banner */}
          <div className="bg-[#10B981]/[0.04] border border-[#10B981]/20 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <Zap className="size-3.5 text-[#10B981] flex-shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <div className="text-[10px] font-bold text-[#10B981]">Auto-Generated from Proposal Data</div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[9px] text-gray-500">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-2.5 text-[#10B981]" />
                    {contract.engagement_scope.length} deliverable{contract.engagement_scope.length !== 1 ? 's' : ''} from solutions[]
                  </span>
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-2.5 text-[#10B981]" />
                    {contract.milestones.length} milestone{contract.milestones.length !== 1 ? 's' : ''} from implementation phases
                  </span>
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-2.5 text-[#10B981]" />
                    {contract.exclusions.length} exclusion{contract.exclusions.length !== 1 ? 's' : ''} from scope_boundaries
                  </span>
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-2.5 text-[#10B981]" />
                    {contract.legal_blocks.length} legal blocks auto-injected
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Summary metrics */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Investment',    value: `${contract.currency} ${contract.investment.toLocaleString()}`, color: '#8B5CF6', icon: DollarSign },
              { label: 'Milestones',    value: String(contract.milestones.length),                            color: '#06D7F6', icon: Milestone  },
              { label: 'Total Duration',value: `${totalWeeks}w`,                                             color: '#F59E0B', icon: Clock      },
              { label: 'Legal Blocks',  value: String(contract.legal_blocks.length),                         color: '#FD4438', icon: Shield     },
            ].map(metric => (
              <div
                key={metric.label}
                className="flex flex-col gap-1 px-3 py-2.5 rounded-lg border border-white/6 bg-black/20"
              >
                <metric.icon className="size-3" style={{ color: metric.color }} />
                <div className="text-base font-black leading-none" style={{ color: metric.color }}>{metric.value}</div>
                <div className="text-[8px] text-gray-600 uppercase tracking-wider">{metric.label}</div>
              </div>
            ))}
          </div>

          {/* SOW */}
          {contract.engagement_scope.length > 0 && (
            <div className="space-y-2">
              <div className="text-[9px] font-bold uppercase tracking-wider text-gray-600 flex items-center gap-2">
                <Package className="size-3" />Scope of Work — Deliverables
              </div>
              <div className="space-y-2">
                {contract.engagement_scope.map(d => (
                  <div
                    key={d.deliverable_id}
                    className="px-4 py-3 rounded-lg bg-black/20 border border-white/6 space-y-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[8px] font-bold px-1.5 py-0.5 rounded font-mono"
                        style={{ color: '#8B5CF6', background: '#8B5CF615' }}
                      >{d.deliverable_id}</span>
                      <span className="text-[10px] font-bold text-gray-200">{d.title}</span>
                    </div>
                    <p className="text-[9px] text-gray-500 leading-relaxed">{d.description}</p>
                    {d.acceptance_criteria.length > 0 && (
                      <div className="space-y-0.5">
                        {d.acceptance_criteria.map((c, ci) => (
                          <div key={ci} className="flex items-start gap-1.5 text-[9px] text-gray-600">
                            <CheckCircle2 className="size-2.5 text-[#10B981] flex-shrink-0 mt-0.5" />
                            <span>{c}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Exclusions */}
          {contract.exclusions.length > 0 && (
            <div className="space-y-2">
              <div className="text-[9px] font-bold uppercase tracking-wider text-gray-600">Scope Exclusions</div>
              <div className="flex flex-wrap gap-1.5">
                {contract.exclusions.map((ex, i) => (
                  <span
                    key={i}
                    className="text-[9px] px-2 py-1 rounded-lg bg-[#FD4438]/[0.06] border border-[#FD4438]/15 text-[#FD4438]/70"
                  >
                    {ex}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Milestones + Payment Schedule side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Milestones */}
            {contract.milestones.length > 0 && (
              <div className="space-y-2">
                <div className="text-[9px] font-bold uppercase tracking-wider text-gray-600 flex items-center gap-2">
                  <Milestone className="size-3" />Implementation Milestones
                </div>
                <div className="space-y-1.5">
                  {contract.milestones.map(ms => (
                    <div
                      key={ms.milestone_id}
                      className="px-3 py-2.5 rounded-lg bg-black/20 border border-white/6 flex items-start gap-3"
                    >
                      <div
                        className="size-5 rounded-full flex items-center justify-center flex-shrink-0 text-[8px] font-black mt-0.5"
                        style={{ background: '#06D7F614', color: '#06D7F6', border: '1px solid #06D7F630' }}
                      >
                        {ms.phase_number}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-bold text-gray-200 truncate">{ms.title}</div>
                        <div className="text-[9px] text-gray-600">{ms.duration_weeks}w</div>
                      </div>
                      <div
                        className="text-[9px] font-black flex-shrink-0"
                        style={{ color: '#8B5CF6' }}
                      >
                        {ms.payment_percentage}%
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Payment Schedule */}
            <div className="space-y-2">
              <div className="text-[9px] font-bold uppercase tracking-wider text-gray-600 flex items-center gap-2">
                <CreditCard className="size-3" />Payment Schedule
                {!pctCheck && (
                  <span className="text-[9px] text-[#FD4438] font-bold">⚠ Rounding</span>
                )}
              </div>
              <div className="space-y-1.5">
                {contract.payment_schedule.map((ps, i) => (
                  <div
                    key={i}
                    className="px-3 py-2.5 rounded-lg bg-black/20 border border-white/6 space-y-0.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold text-gray-200 truncate">{ps.label}</span>
                      <span className="text-[10px] font-black text-[#8B5CF6] flex-shrink-0">
                        {contract.currency} {ps.amount.toLocaleString()}
                      </span>
                    </div>
                    <div className="text-[9px] text-gray-600">{ps.due_trigger}</div>
                  </div>
                ))}
                <div className="flex items-center justify-between px-3 py-1.5 text-[9px] font-bold border-t border-white/5">
                  <span className="text-gray-600">Total</span>
                  <span className="text-white">{contract.currency} {contract.investment.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Legal Protection Blocks */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="text-[9px] font-bold uppercase tracking-wider text-gray-600 flex items-center gap-2">
                <ShieldAlert className="size-3 text-[#FD4438]" />Legal Protection Blocks
              </div>
              <span className="text-[9px] text-[#FD4438] font-bold">Mandatory · Non-Editable</span>
            </div>
            <div className="space-y-1.5">
              {contract.legal_blocks.map(lb => (
                <LegalBlockRow
                  key={lb.id}
                  block={lb}
                  expanded={expandedLegal.has(lb.id)}
                  onToggle={() => toggleLegal(lb.id)}
                />
              ))}
            </div>
          </div>

          {/* Kickoff trigger panel (when signed) */}
          {contract.kickoff_triggered && <KickoffTriggerPanel contract={contract} />}

          {/* ── ROI Invalidation Warning ────────────────────────────────────── */}
          {roiInvalidated && (
            <div className="flex items-start gap-3 px-4 py-3.5 rounded-xl bg-[#F59E0B]/[0.06] border border-[#F59E0B]/25">
              <AlertCircle className="size-4 text-[#F59E0B] flex-shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <div className="text-[10px] font-bold text-[#F59E0B]">Contract Invalidated — ROI Version Drift Detected</div>
                <div className="text-[9px] text-[#F59E0B]/70 leading-relaxed">
                  The financial summary has changed since this contract was generated (snapshot: <span className="font-mono">{contract.roi_version_snapshot}</span> → current: <span className="font-mono">{draft.financial_summary?.portfolio_version_id}</span>).
                  Regenerate the contract to bind it to the current ROI version before sending.
                </div>
              </div>
              <button
                onClick={handleRegenerate}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[9px] font-bold rounded-lg flex-shrink-0 transition-colors"
                style={{ background: '#F59E0B14', color: '#F59E0B', border: '1px solid #F59E0B30' }}
              >
                <RefreshCw className="size-2.5" />Regenerate
              </button>
            </div>
          )}

          {/* ── Contract Ready Gate ─────────────────────────────────────────── */}
          {contract.status === 'draft' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="text-[9px] font-bold uppercase tracking-wider text-gray-600 flex items-center gap-2">
                  <Shield className="size-3" style={{ color: gateResult.passed ? '#10B981' : '#FD4438' }} />
                  Contract Ready Gate
                </div>
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded font-bold border"
                  style={{
                    color:       gateResult.passed ? '#10B981' : '#FD4438',
                    borderColor: gateResult.passed ? '#10B98130' : '#FD443830',
                    background:  gateResult.passed ? '#10B98110' : '#FD443810',
                  }}
                >
                  {gateResult.passed
                    ? `ALL ${gateResult.checks.length} CHECKS PASSED`
                    : `${gateResult.checks.filter(c => !c.passed).length} BLOCKER${gateResult.checks.filter(c => !c.passed).length !== 1 ? 'S' : ''}`
                  }
                </span>
              </div>
              <div className="space-y-1">
                {gateResult.checks.map(check => (
                  <div
                    key={check.id}
                    className="flex items-start gap-2.5 px-3 py-2 rounded-lg border"
                    style={{
                      borderColor: check.passed ? '#10B98120' : '#FD443820',
                      background:  check.passed ? '#10B98106' : '#FD443806',
                    }}
                  >
                    {check.passed
                      ? <CheckCircle2 className="size-3 text-[#10B981] flex-shrink-0 mt-0.5" />
                      : <X            className="size-3 text-[#FD4438] flex-shrink-0 mt-0.5" />
                    }
                    <div className="flex-1">
                      <div
                        className="text-[9px] font-semibold leading-tight"
                        style={{ color: check.passed ? '#10B981' : '#FD4438' }}
                      >
                        {check.label}
                      </div>
                      {!check.passed && check.reason && (
                        <div className="text-[9px] text-gray-600 mt-0.5 leading-relaxed">{check.reason}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action footer */}
          <div className="flex items-center justify-between gap-3 pt-1 border-t border-white/5">
            <div className="text-[9px] text-gray-700 flex items-center gap-1.5">
              <Lock className="size-2.5" />
              {contract.status === 'signed'
                ? 'Contract signed. All downstream actions have been triggered.'
                : contract.status === 'sent'
                ? 'Contract sent. Awaiting client signature.'
                : gateResult.passed
                ? 'Gate passed. Contract ready to send.'
                : 'Contract gate blockers must be resolved before sending.'
              }
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setShowPreview(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-white/5 border border-white/10 text-gray-300 text-[10px] font-bold rounded-lg hover:bg-white/10 hover:border-white/20 transition-colors"
              >
                <Eye className="size-3" />Preview Contract
              </button>

              {/* Status advance buttons */}
              {contract.status === 'draft' && (
                <button
                  onClick={() => { if (gateResult.passed && !roiInvalidated) handleAdvanceStatus('sent'); }}
                  disabled={!gateResult.passed || roiInvalidated}
                  className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-bold rounded-lg transition-all"
                  style={{
                    background:  (gateResult.passed && !roiInvalidated)
                      ? 'linear-gradient(135deg, #06D7F6, #3B82F6)'
                      : '#ffffff08',
                    color:       (gateResult.passed && !roiInvalidated) ? '#0A0A0F' : '#374151',
                    cursor:      (gateResult.passed && !roiInvalidated) ? 'pointer' : 'not-allowed',
                    boxShadow:   (gateResult.passed && !roiInvalidated) ? '0 4px 16px #06D7F625' : undefined,
                    border:      (gateResult.passed && !roiInvalidated) ? 'none' : '1px solid #ffffff10',
                  }}
                >
                  <Send className="size-3" />
                  {gateResult.passed && !roiInvalidated ? 'Send to Client' : `Gate: ${gateResult.checks.filter(c => !c.passed).length} blocker${gateResult.checks.filter(c => !c.passed).length !== 1 ? 's' : ''}`}
                </button>
              )}
              {contract.status === 'sent' && (
                <button
                  onClick={() => handleAdvanceStatus('signed')}
                  className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-bold rounded-lg transition-all"
                  style={{
                    background: 'linear-gradient(135deg, #10B981, #059669)',
                    color: '#fff',
                    boxShadow: '0 4px 16px #10B98125',
                  }}
                >
                  <Check className="size-3.5" />Mark as Signed — Trigger Kickoff
                </button>
              )}
              {contract.status === 'signed' && (
                <div
                  className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-bold rounded-lg"
                  style={{ background: '#10B98114', color: '#10B981', border: '1px solid #10B98133' }}
                >
                  <CheckCircle2 className="size-3" />Signed &amp; Active
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </span>
  );
}