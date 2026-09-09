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
import { useDialogBehavior } from '@/app/components/ui/cortex';
import {
  brand,
  status as tokenStatus,
  border as tokenBorder,
  surface as tokenSurface,
} from '@/app/lib/tokens';

// ── Palette ──────────────────────────────────────────────────────────────────
//
// Read once at module scope: `ContractStatusStrip` takes a parameter called
// `status`, so an unqualified `status.success` inside it would resolve to the
// parameter rather than to the token.
const K_ACCENT         = brand.accent;
const K_ACCENT_LIGHT   = brand.accentLight;
const K_ACCENT_ALT     = brand.accentAlt;
const K_SUCCESS        = tokenStatus.success;
const K_SUCCESS_LIGHT  = tokenStatus.successLight;
const K_SUCCESS_DEEP   = tokenStatus.successDeep;
const K_DANGER         = tokenStatus.danger;
const K_CAUTION        = tokenStatus.caution;
const K_INFO           = tokenStatus.info;
const K_BORDER_STRONG  = tokenBorder.strong;
const K_BORDER_DEFAULT = tokenBorder.default;
const K_BORDER_SUBTLE  = tokenBorder.subtle;
const K_CANVAS         = tokenSurface.canvas;
const K_OVERLAY        = tokenSurface.overlay;


// ════════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════════════════════

const STATUS_PIPELINE: { id: ContractStatus; label: string; short: string }[] = [
  { id: 'draft',  label: 'Contract Draft',  short: 'Draft'  },
  { id: 'sent',   label: 'Sent to Client',  short: 'Sent'   },
  { id: 'signed', label: 'Signed',          short: 'Signed' },
];

const STATUS_CFG: Record<ContractStatus, { color: string; bg: string; label: string }> = {
  draft:  { color: K_ACCENT, bg: `${K_ACCENT}14`, label: 'Draft'  },
  sent:   { color: K_INFO, bg: `${K_INFO}14`, label: 'Sent'   },
  signed: { color: K_SUCCESS, bg: `${K_SUCCESS}14`, label: 'Signed' },
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
                  background: isCurrent ? K_ACCENT : isPast ? K_SUCCESS : K_BORDER_SUBTLE,
                  border:     isCurrent ? `2px solid ${K_ACCENT}` : isPast ? `2px solid ${K_SUCCESS}` : `2px solid ${K_BORDER_DEFAULT}`,
                  boxShadow:  isCurrent ? `0 0 10px ${K_ACCENT}40` : undefined,
                }}
              >
                {isPast    && <Check className="size-2.5 text-white" />}
                {isCurrent && <span className="size-1.5 rounded-full bg-white" />}
              </div>
              <span
                className="text-[8px] font-bold uppercase tracking-wide"
                style={{ color: isCurrent ? K_ACCENT_LIGHT : isPast ? K_SUCCESS_LIGHT : K_BORDER_STRONG, minWidth: 36, textAlign: 'center' }}
              >
                {state.short}
              </span>
            </div>
            {i < STATUS_PIPELINE.length - 1 && (
              <div className="h-px flex-1 mx-1.5 min-w-[20px]"
                style={{ background: i < currentIdx ? K_SUCCESS : K_BORDER_SUBTLE }} />
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
    <div className="border border-white/6 rounded-cortex-sm overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-2.5 bg-black/20 hover:bg-cortex-sunken transition-colors text-left"
      >
        <Lock className="size-3 text-cortex-danger flex-shrink-0" />
        <span className="flex-1 text-[10px] font-semibold text-cortex-secondary">{block.title}</span>
        <span className="text-[9px] text-cortex-danger font-bold mr-2">NON-EDITABLE</span>
        {expanded
          ? <ChevronDown  className="size-3 text-cortex-faint" />
          : <ChevronRight className="size-3 text-cortex-faint" />
        }
      </button>
      {expanded && (
        <div className="px-4 py-3 bg-cortex-danger/[0.02] border-t border-cortex-subtle">
          <p className="text-[10px] text-cortex-muted leading-relaxed">{block.text}</p>
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
    <div className="bg-cortex-success/[0.04] border border-cortex-success/20 rounded-cortex-md p-4 space-y-4">
      <div className="flex items-center gap-2.5">
        <Rocket className="size-4 text-cortex-success" />
        <div>
          <div className="text-sm font-bold text-cortex-success">Project Kickoff Triggered</div>
          <div className="text-[9px] text-cortex-success/60">Contract signed — all downstream actions initiated automatically</div>
        </div>
        {contract.signed_at && (
          <div className="ml-auto text-[9px] text-cortex-success/60">
            Signed {new Date(contract.signed_at).toLocaleDateString()}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {items.map(item => (
          <div
            key={item.label}
            className="flex items-start gap-2.5 px-3 py-2.5 rounded-cortex-sm bg-cortex-success/[0.06] border border-cortex-success/15"
          >
            <CheckCircle2 className="size-3.5 text-cortex-success flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-[10px] font-bold text-cortex-success">{item.label}</div>
              <div className="text-[9px] text-cortex-muted leading-snug">{item.desc}</div>
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
  // Declares this overlay as a dialog and gives it the four behaviours it
  // never had: focus in and back out, a Tab trap, Escape, and a scroll lock.
  // See `useDialogBehavior` for why the behaviour is separable from `Modal`.
  const { dialogProps } = useDialogBehavior({ open: true, onClose, label: 'Contract draft' });

  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;
    const win = window.open('', '_blank');
    if (!win) return;
    // THE PRINTED CONTRACT.
    //
    // A standalone LIGHT document written into a new window. The console's CSS
    // variables do not exist there, so `var(--cortex-*)` would resolve to
    // nothing — the two colours that must track the product interpolate their
    // token VALUES instead. Every other colour below is this document's own
    // vocabulary: paper greys and badge pastels that have no dark-console
    // counterpart and must not be given one.
    win.document.write(`<!DOCTYPE html><html><head>
      <title>${contract.contract_id} — ${contract.client_legal_name}</title>
      <style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family:'Helvetica Neue',Arial,sans-serif; color:#111; background:#fff; padding:48px; font-size:13px; }
        h1 { font-size:24px; font-weight:900; margin-bottom:6px; }
        h2 { font-size:15px; font-weight:700; color:${K_ACCENT}; border-bottom:2px solid ${K_ACCENT}; padding-bottom:5px; margin:28px 0 12px; }
        h3 { font-size:12px; font-weight:700; margin:14px 0 5px; }
        p  { line-height:1.65; color:#333; margin-bottom:8px; }
        .cover { border-bottom:3px solid ${K_ACCENT}; padding-bottom:32px; margin-bottom:32px; }
        .cover .ref { font-size:11px; color:${K_ACCENT}; font-weight:700; margin-bottom:4px; text-transform:uppercase; letter-spacing:.08em; }
        .cover .client { font-size:18px; font-weight:700; color:${K_ACCENT}; margin-bottom:4px; }
        .meta-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin:16px 0; }
        .meta-cell .label { font-size:10px; color:#888; text-transform:uppercase; letter-spacing:.06em; margin-bottom:2px; }
        .meta-cell .value { font-size:13px; font-weight:600; }
        table { width:100%; border-collapse:collapse; margin:12px 0; }
        th { font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:#666; text-align:left; padding:6px 8px; border-bottom:2px solid #eee; }
        td { padding:8px 8px; border-bottom:1px solid #f0f0f0; font-size:12px; }
        .legal { background:#fff8f8; border-left:3px solid ${K_DANGER}; padding:10px 14px; margin:10px 0; }
        .legal .lt { font-size:10px; color:${K_DANGER}; font-weight:700; text-transform:uppercase; margin-bottom:4px; }
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
      <div {...dialogProps} className="w-full max-w-3xl bg-cortex-overlay border border-white/15 rounded-cortex-lg overflow-hidden shadow-2xl my-6 outline-none">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-cortex-default bg-cortex-sunken">
          <span className="flex items-center gap-2.5 text-sm font-bold text-white">
            <Eye className="size-4 text-cortex-accent" />
            Contract Preview — {contract.contract_id}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-cortex-accent/15 border border-cortex-accent/30 text-cortex-accent text-[10px] font-bold rounded-cortex-sm hover:bg-cortex-accent/25 transition-colors"
            >
              <Printer className="size-3" />Print / Save PDF
            </button>
            <button onClick={onClose} className="text-cortex-faint hover:text-cortex-secondary transition-colors">
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* Printable content */}
        <div className="p-6 overflow-y-auto max-h-[75vh]">
          <div ref={printRef} className="bg-white text-gray-900 rounded-cortex-md p-8 text-sm leading-relaxed">
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
                        <td style={{ textAlign: 'right', fontWeight: 700, color: K_ACCENT }}>
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

      <div className="bg-cortex-raised backdrop-blur-xl border border-cortex-default rounded-cortex-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-cortex-subtle">
          <span className="flex items-center gap-2.5 text-sm font-bold text-white">
            <FileText className="size-4" style={{ color: K_SUCCESS }} />
            §8 Contract Auto-Generation
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full font-bold border uppercase tracking-wider"
              style={{ color: K_SUCCESS, borderColor: `${K_SUCCESS}33`, background: `${K_SUCCESS}14` }}
            >
              Phase 6
            </span>
          </span>

          <div className="flex items-center gap-2">
            {/* Status badge */}
            <span
              className="text-[9px] px-2 py-1 rounded-cortex-sm font-bold border"
              style={{ color: cfg.color, borderColor: `${cfg.color}33`, background: cfg.bg }}
            >
              {contract.contract_id} · {cfg.label.toUpperCase()}
            </span>
            {/* Regenerate */}
            {contract.status === 'draft' && (
              <button
                onClick={handleRegenerate}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[9px] font-bold rounded-cortex-sm text-cortex-muted hover:text-white border border-cortex-default hover:border-cortex-strong bg-white/[0.02] hover:bg-cortex-control transition-colors"
              >
                <RefreshCw className="size-2.5" />Regenerate
              </button>
            )}
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Status machine */}
          <div className="space-y-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-cortex-faint">Contract Lifecycle</div>
            <ContractStatusStrip status={contract.status} />
          </div>

          {/* Auto-generation banner */}
          <div className="bg-cortex-success/[0.04] border border-cortex-success/20 rounded-cortex-md p-4">
            <div className="flex items-start gap-3">
              <Zap className="size-3.5 text-cortex-success flex-shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <div className="text-[10px] font-bold text-cortex-success">Auto-Generated from Proposal Data</div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[9px] text-cortex-muted">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-2.5 text-cortex-success" />
                    {contract.engagement_scope.length} deliverable{contract.engagement_scope.length !== 1 ? 's' : ''} from solutions[]
                  </span>
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-2.5 text-cortex-success" />
                    {contract.milestones.length} milestone{contract.milestones.length !== 1 ? 's' : ''} from implementation phases
                  </span>
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-2.5 text-cortex-success" />
                    {contract.exclusions.length} exclusion{contract.exclusions.length !== 1 ? 's' : ''} from scope_boundaries
                  </span>
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-2.5 text-cortex-success" />
                    {contract.legal_blocks.length} legal blocks auto-injected
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Summary metrics */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Investment',    value: `${contract.currency} ${contract.investment.toLocaleString()}`, color: K_ACCENT, icon: DollarSign },
              { label: 'Milestones',    value: String(contract.milestones.length),                            color: K_INFO, icon: Milestone  },
              { label: 'Total Duration',value: `${totalWeeks}w`,                                             color: K_CAUTION, icon: Clock      },
              { label: 'Legal Blocks',  value: String(contract.legal_blocks.length),                         color: K_DANGER, icon: Shield     },
            ].map(metric => (
              <div
                key={metric.label}
                className="flex flex-col gap-1 px-3 py-2.5 rounded-cortex-sm border border-white/6 bg-black/20"
              >
                <metric.icon className="size-3" style={{ color: metric.color }} />
                <div className="text-base font-black leading-none" style={{ color: metric.color }}>{metric.value}</div>
                <div className="text-[8px] text-cortex-faint uppercase tracking-wider">{metric.label}</div>
              </div>
            ))}
          </div>

          {/* SOW */}
          {contract.engagement_scope.length > 0 && (
            <div className="space-y-2">
              <div className="text-[9px] font-bold uppercase tracking-wider text-cortex-faint flex items-center gap-2">
                <Package className="size-3" />Scope of Work — Deliverables
              </div>
              <div className="space-y-2">
                {contract.engagement_scope.map(d => (
                  <div
                    key={d.deliverable_id}
                    className="px-4 py-3 rounded-cortex-sm bg-black/20 border border-white/6 space-y-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[8px] font-bold px-1.5 py-0.5 rounded font-mono"
                        style={{ color: K_ACCENT, background: `${K_ACCENT}15` }}
                      >{d.deliverable_id}</span>
                      <span className="text-[10px] font-bold text-gray-200">{d.title}</span>
                    </div>
                    <p className="text-[9px] text-cortex-muted leading-relaxed">{d.description}</p>
                    {d.acceptance_criteria.length > 0 && (
                      <div className="space-y-0.5">
                        {d.acceptance_criteria.map((c, ci) => (
                          <div key={ci} className="flex items-start gap-1.5 text-[9px] text-cortex-faint">
                            <CheckCircle2 className="size-2.5 text-cortex-success flex-shrink-0 mt-0.5" />
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
              <div className="text-[9px] font-bold uppercase tracking-wider text-cortex-faint">Scope Exclusions</div>
              <div className="flex flex-wrap gap-1.5">
                {contract.exclusions.map((ex, i) => (
                  <span
                    key={i}
                    className="text-[9px] px-2 py-1 rounded-cortex-sm bg-cortex-danger/[0.06] border border-cortex-danger/15 text-cortex-danger/70"
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
                <div className="text-[9px] font-bold uppercase tracking-wider text-cortex-faint flex items-center gap-2">
                  <Milestone className="size-3" />Implementation Milestones
                </div>
                <div className="space-y-1.5">
                  {contract.milestones.map(ms => (
                    <div
                      key={ms.milestone_id}
                      className="px-3 py-2.5 rounded-cortex-sm bg-black/20 border border-white/6 flex items-start gap-3"
                    >
                      <div
                        className="size-5 rounded-full flex items-center justify-center flex-shrink-0 text-[8px] font-black mt-0.5"
                        style={{ background: `${K_INFO}14`, color: K_INFO, border: `1px solid ${K_INFO}30` }}
                      >
                        {ms.phase_number}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-bold text-gray-200 truncate">{ms.title}</div>
                        <div className="text-[9px] text-cortex-faint">{ms.duration_weeks}w</div>
                      </div>
                      <div
                        className="text-[9px] font-black flex-shrink-0"
                        style={{ color: K_ACCENT }}
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
              <div className="text-[9px] font-bold uppercase tracking-wider text-cortex-faint flex items-center gap-2">
                <CreditCard className="size-3" />Payment Schedule
                {!pctCheck && (
                  <span className="text-[9px] text-cortex-danger font-bold">⚠ Rounding</span>
                )}
              </div>
              <div className="space-y-1.5">
                {contract.payment_schedule.map((ps, i) => (
                  <div
                    key={i}
                    className="px-3 py-2.5 rounded-cortex-sm bg-black/20 border border-white/6 space-y-0.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold text-gray-200 truncate">{ps.label}</span>
                      <span className="text-[10px] font-black text-cortex-accent flex-shrink-0">
                        {contract.currency} {ps.amount.toLocaleString()}
                      </span>
                    </div>
                    <div className="text-[9px] text-cortex-faint">{ps.due_trigger}</div>
                  </div>
                ))}
                <div className="flex items-center justify-between px-3 py-1.5 text-[9px] font-bold border-t border-cortex-subtle">
                  <span className="text-cortex-faint">Total</span>
                  <span className="text-white">{contract.currency} {contract.investment.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Legal Protection Blocks */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="text-[9px] font-bold uppercase tracking-wider text-cortex-faint flex items-center gap-2">
                <ShieldAlert className="size-3 text-cortex-danger" />Legal Protection Blocks
              </div>
              <span className="text-[9px] text-cortex-danger font-bold">Mandatory · Non-Editable</span>
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
            <div className="flex items-start gap-3 px-4 py-3.5 rounded-cortex-md bg-cortex-caution/[0.06] border border-cortex-caution/25">
              <AlertCircle className="size-4 text-cortex-caution flex-shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <div className="text-[10px] font-bold text-cortex-caution">Contract Invalidated — ROI Version Drift Detected</div>
                <div className="text-[9px] text-cortex-caution/70 leading-relaxed">
                  The financial summary has changed since this contract was generated (snapshot: <span className="font-mono">{contract.roi_version_snapshot}</span> → current: <span className="font-mono">{draft.financial_summary?.portfolio_version_id}</span>).
                  Regenerate the contract to bind it to the current ROI version before sending.
                </div>
              </div>
              <button
                onClick={handleRegenerate}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[9px] font-bold rounded-cortex-sm flex-shrink-0 transition-colors"
                style={{ background: `${K_CAUTION}14`, color: K_CAUTION, border: `1px solid ${K_CAUTION}30` }}
              >
                <RefreshCw className="size-2.5" />Regenerate
              </button>
            </div>
          )}

          {/* ── Contract Ready Gate ─────────────────────────────────────────── */}
          {contract.status === 'draft' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="text-[9px] font-bold uppercase tracking-wider text-cortex-faint flex items-center gap-2">
                  <Shield className="size-3" style={{ color: gateResult.passed ? K_SUCCESS : K_DANGER }} />
                  Contract Ready Gate
                </div>
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded font-bold border"
                  style={{
                    color:       gateResult.passed ? K_SUCCESS : K_DANGER,
                    borderColor: gateResult.passed ? `${K_SUCCESS}30` : `${K_DANGER}30`,
                    background:  gateResult.passed ? `${K_SUCCESS}10` : `${K_DANGER}10`,
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
                    className="flex items-start gap-2.5 px-3 py-2 rounded-cortex-sm border"
                    style={{
                      borderColor: check.passed ? `${K_SUCCESS}20` : `${K_DANGER}20`,
                      background:  check.passed ? `${K_SUCCESS}06` : `${K_DANGER}06`,
                    }}
                  >
                    {check.passed
                      ? <CheckCircle2 className="size-3 text-cortex-success flex-shrink-0 mt-0.5" />
                      : <X            className="size-3 text-cortex-danger flex-shrink-0 mt-0.5" />
                    }
                    <div className="flex-1">
                      <div
                        className="text-[9px] font-semibold leading-tight"
                        style={{ color: check.passed ? K_SUCCESS : K_DANGER }}
                      >
                        {check.label}
                      </div>
                      {!check.passed && check.reason && (
                        <div className="text-[9px] text-cortex-faint mt-0.5 leading-relaxed">{check.reason}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action footer */}
          <div className="flex items-center justify-between gap-3 pt-1 border-t border-cortex-subtle">
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
                className="flex items-center gap-1.5 px-3 py-2 bg-cortex-control border border-cortex-default text-cortex-secondary text-[10px] font-bold rounded-cortex-sm hover:bg-cortex-control-hover hover:border-cortex-strong transition-colors"
              >
                <Eye className="size-3" />Preview Contract
              </button>

              {/* Status advance buttons */}
              {contract.status === 'draft' && (
                <button
                  onClick={() => { if (gateResult.passed && !roiInvalidated) handleAdvanceStatus('sent'); }}
                  disabled={!gateResult.passed || roiInvalidated}
                  className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-bold rounded-cortex-sm transition-all"
                  style={{
                    background:  (gateResult.passed && !roiInvalidated)
                      ? `linear-gradient(135deg, ${K_INFO}, ${K_ACCENT_ALT})`
                      : K_BORDER_SUBTLE,
                    color:       (gateResult.passed && !roiInvalidated) ? K_CANVAS : K_BORDER_STRONG,
                    cursor:      (gateResult.passed && !roiInvalidated) ? 'pointer' : 'not-allowed',
                    boxShadow:   (gateResult.passed && !roiInvalidated) ? `0 4px 16px ${K_INFO}25` : undefined,
                    border:      (gateResult.passed && !roiInvalidated) ? 'none' : `1px solid ${K_BORDER_DEFAULT}`,
                  }}
                >
                  <Send className="size-3" />
                  {gateResult.passed && !roiInvalidated ? 'Send to Client' : `Gate: ${gateResult.checks.filter(c => !c.passed).length} blocker${gateResult.checks.filter(c => !c.passed).length !== 1 ? 's' : ''}`}
                </button>
              )}
              {contract.status === 'sent' && (
                <button
                  onClick={() => handleAdvanceStatus('signed')}
                  className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-bold rounded-cortex-sm transition-all"
                  style={{
                    background: `linear-gradient(135deg, ${K_SUCCESS}, ${K_SUCCESS_DEEP})`,
                    color: '#fff',
                    boxShadow: `0 4px 16px ${K_SUCCESS}25`,
                  }}
                >
                  <Check className="size-3.5" />Mark as Signed — Trigger Kickoff
                </button>
              )}
              {contract.status === 'signed' && (
                <div
                  className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-bold rounded-cortex-sm"
                  style={{ background: `${K_SUCCESS}14`, color: K_SUCCESS, border: `1px solid ${K_SUCCESS}33` }}
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