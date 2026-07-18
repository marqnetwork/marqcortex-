/**
 * PROPOSAL DRAFT EDITOR — proposal-data-model.json Phase 1
 *
 * Four editable cards:
 *   1. Executive Brief      (executive_brief.*)    — fully editable
 *   2. Confirmed Diagnosis  (diagnosis_blocks[])   — fully editable
 *   3. Scope Boundaries     (scope_boundaries.*)   — fully editable
 *   4. Next Step Offer      (next_step_offer.*)    — price editable; rest read-only
 *
 * Ready Gate (ready-gate-rules.md + phase1-gate-criteria.md):
 *   - "Mark Internal Review" button runs the deterministic gate engine.
 *   - Gate output panel shows: pass (transition logged) or fail (grouped blockers).
 *   - Live readiness score updates in real-time via useMemo.
 *   - All edits clear the gate result (forces re-check after changes).
 *
 * Edit rules:
 *   - Only the 4 editable sections are mutable.
 *   - Every save → metadata.version += 1, metadata.last_updated_at = now.
 *   - Linkage / client / metadata fields are read-only / system-filled.
 *   - Save is per-card for surgical version increments.
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Target, AlertTriangle, Shield, Zap,
  ChevronDown, ChevronRight, Edit3, Check, X,
  Plus, Trash2, Lock, GitBranch, Link2, Info,
  Clock, CheckCircle2, Send, Download,
  ShieldCheck, ShieldX, RefreshCw, AlertCircle,
  ClipboardList, ArrowRight, LayoutDashboard,
} from 'lucide-react';
import type {
  ProposalDraft, DiagnosisBlock, DiagnosisSeverity,
} from '@/app/types/cortex-types';
import {
  runReadyGate,
  runPhase2Gate,
  runPhase3Gate,
  runPhase4Gate,
  runPhase5Gate,
  GATE_SECTION_LABELS,
  GATE_SECTION_ORDER,
} from '@/app/core/proposalGateEngine';
import type { GateResult, GateMissing, GateSection } from '@/app/core/proposalGateEngine';
import { SolutionArchitectureCard }       from './SolutionArchitectureCard';
import { FinancialSummaryCard }           from './FinancialSummaryCard';
import { ImplementationArchitectureCard } from './ImplementationArchitectureCard';
import { ProposalControlPanel }           from './ProposalControlPanel';
import { ContractDraftViewer }           from './ContractDraftViewer';
import { ObjectionHandlerPanel }         from './ObjectionHandlerPanel';
import { CRMSyncPanel }                  from './CRMSyncPanel';
import { ROITrackingPanel }              from './ROITrackingPanel';
import { BlockRegistryPanel }            from './BlockRegistryPanel';
import { ExportPanel }                   from './ExportPanel';
import { SnapshotHistoryPanel }          from './SnapshotHistoryPanel';
import { ProposalSectionCopilot }        from './ProposalSectionCopilot';
import { InlineAITrigger, AIToolbar }    from './InlineAITrigger';
import { useGlobalAIChat }               from '@/app/contexts/GlobalAIChatContext';
import type { ExportType }               from '@/app/types/cortex-types';
import {
  getSnapshotsByProposal,
  type ProposalSnapshot,
} from '@/app/core/snapshotEngine';

// ════════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════════════════════

const SEV_CFG: Record<DiagnosisSeverity, { label: string; color: string; dot: string }> = {
  critical: { label: 'Critical', color: '#FD4438', dot: 'bg-[#FD4438]' },
  high:     { label: 'High',     color: '#FB923C', dot: 'bg-[#FB923C]' },
  medium:   { label: 'Medium',   color: '#F59E0B', dot: 'bg-[#F59E0B]' },
  low:      { label: 'Low',      color: '#6B7280', dot: 'bg-gray-500'  },
};

const STATUS_CFG: Record<ProposalDraft['status'], { label: string; color: string; bg: string }> = {
  draft:            { label: 'Draft',            color: '#8B5CF6', bg: 'bg-[#8B5CF6]/10' },
  review:           { label: 'Review',           color: '#FB923C', bg: 'bg-[#FB923C]/10' },
  internal_review:  { label: 'Internal Review',  color: '#06D7F6', bg: 'bg-[#06D7F6]/10' },
  financial_binding:{ label: 'Financial Binding',color: '#10B981', bg: 'bg-[#10B981]/10' },
  approved:         { label: 'Approved',          color: '#F59E0B', bg: 'bg-[#F59E0B]/10' },
  ready_to_send:    { label: 'Ready to Send',     color: '#06D7F6', bg: 'bg-[#06D7F6]/10' },
  sent:             { label: 'Sent',              color: '#3B82F6', bg: 'bg-[#3B82F6]/10' },
  viewed:           { label: 'Viewed',            color: '#10B981', bg: 'bg-[#10B981]/10' },
  rejected:         { label: 'Rejected',          color: '#FD4438', bg: 'bg-[#FD4438]/10' },
  expired:          { label: 'Expired',           color: '#6B7280', bg: 'bg-gray-700/10'  },
};

const EVIDENCE_SOURCE_LABELS: Record<
  ProposalDraft['diagnosis_blocks'][0]['evidence'][0]['source'],
  string
> = {
  questionnaire:   'Questionnaire',
  ops_pattern:     'Ops Pattern',
  team_assessment: 'Team Assessment',
  financial_data:  'Financial Data',
};

// ════════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════════

function bumpVersion(draft: ProposalDraft): ProposalDraft['metadata'] {
  return {
    ...draft.metadata,
    version: draft.metadata.version + 1,
    last_updated_at: new Date().toISOString(),
  };
}

function gateScoreColor(passed: number, total: number): string {
  if (total === 0) return '#6B7280';
  const pct = passed / total;
  if (pct >= 1)    return '#10B981';
  if (pct >= 0.75) return '#F59E0B';
  return '#FD4438';
}

// ════════════════════════════════════════════════════════════════════════════════
// SHARED: CARD SHELL
// ════════════════════════════════════════════════════════════════════════════════

function CardShell({
  icon: Icon, title, badge, accent = '#8B5CF6', locked = false,
  editSlot, children,
}: {
  icon: React.FC<{ className?: string }>;
  title: string;
  badge?: string;
  accent?: string;
  locked?: boolean;
  editSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5">
        <span className="flex items-center gap-2.5 text-sm font-bold text-white">
          <Icon className="size-4 flex-shrink-0" style={{ color: accent }} />
          {title}
          {badge && (
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full font-bold border uppercase tracking-wider"
              style={{ color: accent, borderColor: `${accent}33`, background: `${accent}14` }}
            >
              {badge}
            </span>
          )}
          {locked && (
            <span className="flex items-center gap-1 text-[9px] text-gray-600 font-normal">
              <Lock className="size-2.5" />read-only
            </span>
          )}
        </span>
        {editSlot}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// EDITABLE FIELD PRIMITIVES
// ════════════════════════════════════════════════════════════════════════════════

function EditableText({
  label, value, onChange, multiline = false, placeholder = '',
  hint,
}: {
  label: string; value: string; onChange: (v: string) => void;
  multiline?: boolean; placeholder?: string; hint?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-[9px] font-bold uppercase tracking-wider text-gray-600">{label}</label>
        {hint && <span className="text-[9px] text-gray-700">{hint}</span>}
      </div>
      {multiline ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-xs text-white resize-y focus:outline-none focus:border-[#8B5CF6]/50 placeholder:text-gray-700 leading-relaxed"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#8B5CF6]/50 placeholder:text-gray-700"
        />
      )}
    </div>
  );
}

function StringListEditor({
  label, items, onChange, accent = '#8B5CF6', placeholder = 'Add item…',
}: {
  label: string; items: string[]; onChange: (items: string[]) => void;
  accent?: string; placeholder?: string;
}) {
  const [newItem, setNewItem] = useState('');
  const add = () => {
    const v = newItem.trim();
    if (v) { onChange([...items, v]); setNewItem(''); }
  };
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const update  = (i: number, v: string) => onChange(items.map((it, idx) => idx === i ? v : it));

  return (
    <div className="space-y-1.5">
      <label className="text-[9px] font-bold uppercase tracking-wider text-gray-600">{label}</label>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2 group">
            <span className="size-1.5 rounded-full flex-shrink-0" style={{ background: accent }} />
            <input
              value={item}
              onChange={e => update(i, e.target.value)}
              className="flex-1 bg-transparent text-xs text-gray-300 focus:outline-none focus:text-white border-b border-transparent focus:border-white/10 py-0.5"
            />
            <button
              onClick={() => remove(i)}
              className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-[#FD4438] transition-all"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-1">
        <input
          value={newItem}
          onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder={placeholder}
          className="flex-1 bg-white/[0.03] border border-white/8 rounded-lg px-2.5 py-1.5 text-[10px] text-white placeholder:text-gray-700 focus:outline-none focus:border-white/20"
        />
        <button
          onClick={add}
          className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors"
          style={{ background: `${accent}22`, color: accent }}
        >
          <Plus className="size-3" />Add
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// READY GATE PANEL
// ════════════════════════════════════════════════════════════════════════════════

function ReadyGatePanel({
  result, onRecheck, onClose,
}: {
  result: GateResult;
  onRecheck: () => void;
  onClose: () => void;
}) {
  // Group failures by section in spec order
  const grouped = useMemo(() => {
    const map: Partial<Record<GateSection, GateMissing[]>> = {};
    result.missing.forEach(m => {
      if (!map[m.section]) map[m.section] = [];
      map[m.section]!.push(m);
    });
    return map;
  }, [result.missing]);

  const boardroomCount  = result.missing.filter(m => m.layer === 'boardroom').length;
  const structuralCount = result.missing.filter(m => m.layer === 'structural').length;

  return (
    <div
      className={`border rounded-xl overflow-hidden transition-all ${
        result.passed
          ? 'border-[#10B981]/30 bg-[#10B981]/[0.04]'
          : 'border-[#FD4438]/20 bg-[#FD4438]/[0.03]'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5">
        <span className="flex items-center gap-2.5 text-sm font-bold">
          {result.passed ? (
            <span className="contents">
              <ShieldCheck className="size-4 text-[#10B981]" />
              <span className="text-[#10B981]">All Gate Checks Passed</span>
              <span className="text-[9px] font-normal text-gray-600">
                — Status transitioning: draft → internal_review
              </span>
            </span>
          ) : (
            <span className="contents">
              <ShieldX className="size-4 text-[#FD4438]" />
              <span className="text-[#FD4438]">
                {result.missing.length} Blocker{result.missing.length !== 1 ? 's' : ''} — Status Remains Draft
              </span>
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onRecheck}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-white/10 text-gray-400 text-[10px] font-bold rounded-lg hover:bg-white/10 transition-colors"
          >
            <RefreshCw className="size-3" />Re-check
          </button>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-400 transition-colors">
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="p-5">
        {/* ── PASS STATE ── */}
        {result.passed ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-[#10B981]/10 border border-[#10B981]/20 rounded-xl px-4 py-3 text-center">
                <div className="text-2xl font-black text-[#10B981]">{result.checks_passed}</div>
                <div className="text-[9px] text-gray-500 uppercase tracking-wider mt-0.5">Checks Passed</div>
              </div>
              <div className="bg-black/20 border border-white/8 rounded-xl px-4 py-3 text-center">
                <div className="text-base font-black text-white font-mono tracking-tight">
                  #{result.version_hash}
                </div>
                <div className="text-[9px] text-gray-500 uppercase tracking-wider mt-0.5">Version Hash</div>
              </div>
              <div className="bg-black/20 border border-white/8 rounded-xl px-4 py-3 text-center">
                <div className="text-xs font-bold text-gray-300 leading-snug">
                  {result.validation_timestamp
                    ? new Date(result.validation_timestamp).toLocaleString()
                    : '—'
                  }
                </div>
                <div className="text-[9px] text-gray-500 uppercase tracking-wider mt-0.5">Validated At</div>
              </div>
            </div>
            <p className="text-[10px] text-[#10B981]/70 flex items-start gap-2 leading-relaxed">
              <CheckCircle2 className="size-3.5 flex-shrink-0 mt-0.5" />
              {result.gate === 'phase5_export_ready'
                ? <span className="contents">Integrity lock cleared. Status → <span className="font-mono font-bold">sent</span>. All 4 gates confirmed, no pending ROI recalculation. Financial fields locked. Hash <span className="font-mono">#{result.version_hash}</span> recorded.</span>
                : result.gate === 'phase4_sent'
                ? <span className="contents">Status → <span className="font-mono font-bold">ready_to_send</span>. Implementation architecture validated. 30-day expiry clock started. Scroll to §7 to export. Hash <span className="font-mono">#{result.version_hash}</span> logged.</span>
                : result.gate === 'phase3_approved'
                ? <span className="contents">Proposal status has been set to <span className="font-mono font-bold">approved</span>. Financial summary validated and locked to portfolio version <span className="font-mono">{result.version_hash.slice(0, 4)}</span>. Hash <span className="font-mono">#{result.version_hash}</span> logged.</span>
                : result.gate === 'phase2_financial_binding'
                ? <span className="contents">Proposal status has been set to <span className="font-mono font-bold">financial_binding</span>. Solution architecture binding confirmed. Version bumped. Hash <span className="font-mono">#{result.version_hash}</span> logged.</span>
                : <span className="contents">Proposal status has been set to <span className="font-mono font-bold">internal_review</span>. Version bumped. Hash <span className="font-mono">#{result.version_hash}</span> recorded in audit log at {result.validation_timestamp ? new Date(result.validation_timestamp).toLocaleString() : '—'}.</span>
              }
            </p>
          </div>
        ) : (
          /* ── FAIL STATE ── */
          <div className="space-y-5">
            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-gray-500">Gate readiness</span>
                <span className="font-bold text-gray-300">
                  {result.checks_passed} / {result.checks_total} checks
                </span>
              </div>
              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${result.checks_total > 0 ? (result.checks_passed / result.checks_total) * 100 : 0}%`,
                    background: 'linear-gradient(90deg, #FD4438, #FB923C)',
                  }}
                />
              </div>
              {(structuralCount > 0 || boardroomCount > 0) && (
                <div className="flex items-center gap-3 text-[9px] text-gray-600">
                  {structuralCount > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="size-1.5 rounded-full bg-[#FD4438] inline-block" />
                      {structuralCount} structural
                    </span>
                  )}
                  {boardroomCount > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="size-1.5 rounded-full bg-[#8B5CF6] inline-block" />
                      {boardroomCount} boardroom-grade
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Grouped failures — rendered in spec section order */}
            <div className="space-y-4">
              {GATE_SECTION_ORDER.map(section => {
                const items = grouped[section];
                if (!items || items.length === 0) return null;
                return (
                  <div key={section}>
                    <div className="flex items-center gap-2 mb-2">
                      <AlertCircle className="size-3 text-[#FD4438] flex-shrink-0" />
                      <span className="text-[9px] font-bold uppercase tracking-wider text-gray-500">
                        {GATE_SECTION_LABELS[section]}
                      </span>
                      <span className="text-[9px] text-[#FD4438] font-bold">
                        ({items.length} issue{items.length !== 1 ? 's' : ''})
                      </span>
                    </div>
                    <div className="space-y-1.5 pl-2">
                      {items.map((m, i) => (
                        <div
                          key={i}
                          className={`flex items-start gap-3 rounded-lg px-3 py-2 border ${
                            m.layer === 'boardroom'
                              ? 'bg-[#8B5CF6]/[0.04] border-[#8B5CF6]/15'
                              : 'bg-[#FD4438]/[0.04] border-[#FD4438]/10'
                          }`}
                        >
                          <span
                            className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider flex-shrink-0 mt-0.5 ${
                              m.layer === 'boardroom'
                                ? 'text-[#8B5CF6] bg-[#8B5CF6]/10'
                                : 'text-[#FD4438] bg-[#FD4438]/10'
                            }`}
                          >
                            {m.layer === 'boardroom' ? '§§' : '§'}
                          </span>
                          <span className="font-mono text-[9px] text-gray-500 flex-shrink-0 mt-0.5 min-w-[160px] max-w-[180px] truncate">
                            {m.path}
                          </span>
                          <span className="text-[10px] text-gray-400 leading-relaxed">{m.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 text-[9px] text-gray-700 border-t border-white/5 pt-3">
              <span className="flex items-center gap-1.5">
                <span className="text-[#FD4438] font-bold">§</span>
                Structural — field-level rule
              </span>
              <span className="flex items-center gap-1.5">
                <span className="text-[#8B5CF6] font-bold">§§</span>
                Boardroom-grade — institutional standard
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// PROPOSAL META STRIP (read-only system info + gate CTA)
// ════════════════════════════════════════════════════════════════════════════════

function ProposalMetaStrip({
  draft,
  gateScore,
  onMarkInternalReview,
  onAdvanceToFinancialBinding,
  onAdvanceToApproved,
  onAdvanceToSent,
}: {
  draft: ProposalDraft;
  gateScore: { passed: number; total: number };
  onMarkInternalReview: () => void;
  onAdvanceToFinancialBinding?: () => void;
  onAdvanceToApproved?: () => void;
  onAdvanceToSent?: () => void;
}) {
  const statusCfg         = STATUS_CFG[draft.status];
  const scoreColor        = gateScoreColor(gateScore.passed, gateScore.total);
  const allPassed         = gateScore.passed === gateScore.total && gateScore.total > 0;
  const isDraft           = draft.status === 'draft';
  const isInternalReview  = draft.status === 'internal_review';
  const isFinancialBinding= draft.status === 'financial_binding';
  const isApproved        = draft.status === 'approved';
  const isReadyToSend     = draft.status === 'ready_to_send';

  return (
    <div className="bg-black/30 border border-white/8 rounded-xl px-5 py-3.5 flex items-center justify-between gap-4 flex-wrap">
      {/* Left: ID + status + version */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-mono font-bold text-gray-400">{draft.proposal_id}</span>
        <span
          className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${statusCfg.bg}`}
          style={{ color: statusCfg.color }}
        >
          {statusCfg.label}
        </span>
        <span className="text-[9px] text-gray-600 font-mono">v{draft.metadata.version}</span>
      </div>

      {/* Centre: Client + Linkage */}
      <div className="flex items-center gap-4 text-[10px] text-gray-500">
        <span className="flex items-center gap-1">
          <span className="font-bold text-gray-300">{draft.client.company_name}</span>
          <span>·</span>
          <span>{draft.client.industry}</span>
          <span>·</span>
          <span>{draft.client.region}</span>
        </span>
        <span className="flex items-center gap-1.5 text-[9px] text-gray-600">
          <Link2 className="size-2.5" />
          <span className="font-mono">{draft.linkage.diagnostic_id}</span>
          <span>·</span>
          <span className="font-mono">{draft.linkage.portfolio_version_id}</span>
        </span>
      </div>

      {/* Right: Live gate score + CTA */}
      <div className="flex items-center gap-3">
        {/* Live gate score pill */}
        <span
          className="flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-lg border"
          style={{
            color:        scoreColor,
            borderColor:  `${scoreColor}30`,
            background:   `${scoreColor}0e`,
          }}
        >
          <ClipboardList className="size-3" />
          {gateScore.passed}/{gateScore.total} gate checks
        </span>

        {/* Phase 1 CTA — draft status */}
        {isDraft && (
          <button
            onClick={onMarkInternalReview}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-bold transition-all ${
              allPassed
                ? 'bg-[#10B981] hover:bg-[#059669] text-white shadow-lg shadow-[#10B981]/20'
                : 'bg-[#8B5CF6]/10 hover:bg-[#8B5CF6]/20 text-[#8B5CF6] border border-[#8B5CF6]/25 hover:border-[#8B5CF6]/40'
            }`}
          >
            <ShieldCheck className="size-3.5" />
            {allPassed ? 'Confirm Internal Review' : 'Mark Internal Review'}
          </button>
        )}

        {/* Phase 2 CTA — internal_review status */}
        {isInternalReview && onAdvanceToFinancialBinding && (
          <button
            onClick={onAdvanceToFinancialBinding}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-bold bg-[#06D7F6]/10 hover:bg-[#06D7F6]/20 text-[#06D7F6] border border-[#06D7F6]/25 hover:border-[#06D7F6]/40 transition-all"
          >
            <ShieldCheck className="size-3.5" />
            Advance to Financial Binding
          </button>
        )}

        {/* Phase 3 CTA — financial_binding status */}
        {isFinancialBinding && onAdvanceToApproved && (
          <button
            onClick={onAdvanceToApproved}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-bold bg-[#10B981]/10 hover:bg-[#10B981]/20 text-[#10B981] border border-[#10B981]/25 hover:border-[#10B981]/40 transition-all"
          >
            <ShieldCheck className="size-3.5" />
            Approve Proposal
          </button>
        )}

        {/* Phase 4 CTA — approved status → advance to ready_to_send */}
        {isApproved && onAdvanceToSent && (
          <button
            onClick={onAdvanceToSent}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-bold bg-[#06D7F6]/10 hover:bg-[#06D7F6]/20 text-[#06D7F6] border border-[#06D7F6]/25 hover:border-[#06D7F6]/40 transition-all"
          >
            <Send className="size-3.5" />
            Ready to Send
          </button>
        )}

        {/* Phase 5 badge — ready_to_send status */}
        {isReadyToSend && (
          <span className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-bold bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20">
            <ShieldCheck className="size-3.5" />Export Ready ↓
          </span>
        )}

        {/* Re-validate — only for sent/viewed/rejected/expired. Excluded from ready_to_send
            because clicking it would destructively revert status to internal_review if Phase 1 passes.
            The ProposalControlPanel (§7) provides the integrity lock display for ready_to_send. */}
        {!isDraft && !isInternalReview && !isFinancialBinding && !isApproved && !isReadyToSend && (
          <button
            onClick={onMarkInternalReview}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold text-gray-500 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-colors bg-white/[0.02] hover:bg-white/5"
          >
            <RefreshCw className="size-3" />Re-validate
          </button>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// §1 — EXECUTIVE BRIEF CARD
// ════════════════════════════════════════════════════════════════════════════════

function ExecutiveBriefCard({
  draft, onSave,
}: { draft: ProposalDraft; onSave: (d: ProposalDraft) => void }) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState({ ...draft.executive_brief });
  const [appliedBanner, setAppliedBanner] = useState(false);
  const { registerApplyHandler, unregisterApplyHandler } = useGlobalAIChat();

  // Register apply handler: AI content → strategic_context field
  useEffect(() => {
    registerApplyHandler('proposal.executive_brief', (content: string) => {
      setLocal(l => ({ ...l, strategic_context: content }));
      setEditing(true);
      setAppliedBanner(true);
      setTimeout(() => setAppliedBanner(false), 3500);
    });
    return () => unregisterApplyHandler('proposal.executive_brief');
  }, [registerApplyHandler, unregisterApplyHandler]);

  const handleSave = () => {
    onSave({ ...draft, executive_brief: local, metadata: bumpVersion(draft) });
    setEditing(false);
  };
  const handleCancel = () => { setLocal({ ...draft.executive_brief }); setEditing(false); };

  const eb = editing ? local : draft.executive_brief;

  const editSlot = (
    <div className="flex items-center gap-2">
      {editing ? (
        <span className="contents">
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#10B981]/10 border border-[#10B981]/25 text-[#10B981] text-[10px] font-bold rounded-lg hover:bg-[#10B981]/20 transition-colors"
          >
            <Check className="size-3" />Save
          </button>
          <button
            onClick={handleCancel}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-white/10 text-gray-400 text-[10px] font-bold rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="size-3" />Cancel
          </button>
        </span>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-white/10 text-gray-400 text-[10px] font-bold rounded-lg hover:border-[#8B5CF6]/40 hover:text-[#8B5CF6] transition-colors"
        >
          <Edit3 className="size-3" />Edit
        </button>
      )}
    </div>
  );

  const eb0 = draft.executive_brief;
  const ebContent = `Title: ${eb0.title}. Strategic context: ${eb0.strategic_context ?? ''}. Why now: ${eb0.why_now ?? ''}. Success vision: ${eb0.what_success_looks_like ?? ''}.`;

  return (
    <CardShell icon={Target} title="Executive Brief" badge="Editable" accent="#8B5CF6" editSlot={editSlot}>
      {/* AI Apply banner */}
      {appliedBanner && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 bg-[#8B5CF6]/10 border border-[#8B5CF6]/30 rounded-lg animate-pulse">
          <CheckCircle2 className="size-3.5 text-[#8B5CF6] flex-shrink-0" />
          <p className="text-[11px] text-[#8B5CF6] font-semibold">
            AI content applied to Strategic Context — review and save when ready.
          </p>
        </div>
      )}
      {/* AI quick-generate row */}
      {!editing && (
        <div className="mb-4">
          <AIToolbar
            sectionId="proposal.executive_brief"
            sectionLabel="Executive Brief"
            sectionContent={ebContent}
            actions={[
              { label: 'Polish Tone', prompt: 'Polish the tone of this executive brief for C-suite presentation. Keep all facts exactly as they are — only improve clarity and authority.' },
              { label: 'Sharpen Why Now', prompt: 'Strengthen the "why now" urgency argument in this executive brief. Ground it in operational timing without fabricating numbers.', icon: 'zap' },
              { label: 'Simplify Language', prompt: 'Simplify the language for a non-technical executive. Remove any consulting jargon while keeping the strategic framing.', icon: 'message' },
            ]}
          />
        </div>
      )}
      {editing ? (
        <div className="space-y-4">
          <EditableText
            label="Title"
            value={local.title}
            onChange={v => setLocal(l => ({ ...l, title: v }))}
          />
          <EditableText
            label="Strategic Context"
            value={local.strategic_context}
            onChange={v => setLocal(l => ({ ...l, strategic_context: v }))}
            multiline
            placeholder="Describe the client's current operational situation with specific numbers…"
            hint={`${local.strategic_context.length} / 300 min chars`}
          />
          <EditableText
            label="Why Now"
            value={local.why_now}
            onChange={v => setLocal(l => ({ ...l, why_now: v }))}
            multiline
            placeholder="What makes this moment time-critical? Quantify the monthly cost of inaction…"
            hint={`${local.why_now.length} / 200 min chars`}
          />
          <EditableText
            label="What Success Looks Like"
            value={local.what_success_looks_like}
            onChange={v => setLocal(l => ({ ...l, what_success_looks_like: v }))}
            multiline
            placeholder="Describe measurable outcomes in 90 days with specific targets…"
            hint={`${local.what_success_looks_like.length} / 200 min chars`}
          />
          <EditableText
            label="Positioning Statement"
            value={local.positioning_statement}
            onChange={v => setLocal(l => ({ ...l, positioning_statement: v }))}
            placeholder="Our one-line pitch…"
          />
          <p className="text-[9px] text-gray-700 flex items-center gap-1.5">
            <Info className="size-2.5" />
            Gate requires ≥ 600 total words across brief, ≥ 2 quantified statements, no vague phrases.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <h3 className="text-base font-black text-white leading-tight">{eb.title}</h3>
          {[
            { label: 'Strategic Context',       value: eb.strategic_context,       color: '#06D7F6' },
            { label: 'Why Now',                 value: eb.why_now,                 color: '#FB923C' },
            { label: 'What Success Looks Like', value: eb.what_success_looks_like, color: '#10B981' },
          ].map(f => (
            <div key={f.label} className="space-y-1">
              <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: f.color }}>
                {f.label}
              </div>
              <p className="text-xs text-gray-300 leading-relaxed">
                {f.value || <span className="text-gray-600 italic">Not filled in — click Edit to add content</span>}
              </p>
            </div>
          ))}
          {eb.positioning_statement && (
            <div className="border-l-2 border-[#8B5CF6] pl-3">
              <p className="text-xs italic text-[#A78BFA] leading-relaxed">"{eb.positioning_statement}"</p>
            </div>
          )}
        </div>
      )}
    </CardShell>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// §2 — CONFIRMED DIAGNOSIS CARD
// ════════════════════════════════════════════════════════════════════════════════

function DiagnosisBlockCard({
  block, index, onUpdate, onRemove,
}: {
  block: DiagnosisBlock; index: number;
  onUpdate: (b: DiagnosisBlock) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(index === 0);
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState({ ...block });
  const sevCfg = SEV_CFG[block.severity] ?? SEV_CFG['medium'];

  const handleSave = () => { onUpdate(local); setEditing(false); };
  const handleCancel = () => { setLocal({ ...block }); setEditing(false); };

  return (
    <div
      className={`border rounded-xl overflow-hidden transition-colors ${
        open ? 'border-white/10' : 'border-white/5'
      } bg-black/20`}
    >
      {/* Row header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => setOpen(o => !o)} className="flex-1 flex items-center gap-3 text-left min-w-0">
          <div className={`size-2 rounded-full flex-shrink-0 ${sevCfg.dot}`} />
          <span className="text-xs font-bold text-white flex-1 truncate min-w-0">
            {block.title || `Diagnosis ${index + 1}`}
          </span>
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
            style={{ color: sevCfg.color, background: `${sevCfg.color}14` }}
          >
            {sevCfg.label}
          </span>
          <span className="text-[9px] text-gray-600 font-mono flex-shrink-0">
            {block.confidence}% conf.
          </span>
          {open
            ? <ChevronDown className="size-3.5 text-gray-600 flex-shrink-0" />
            : <ChevronRight className="size-3.5 text-gray-600 flex-shrink-0" />
          }
        </button>
        <button
          onClick={() => { setEditing(e => !e); setOpen(true); }}
          className="text-[9px] text-gray-600 hover:text-[#8B5CF6] transition-colors px-1.5 py-1 rounded hover:bg-[#8B5CF6]/10 flex-shrink-0"
        >
          {editing ? 'View' : <Edit3 className="size-3" />}
        </button>
        <button
          onClick={onRemove}
          className="text-[9px] text-gray-700 hover:text-[#FD4438] transition-colors px-1 py-1 rounded hover:bg-[#FD4438]/10 flex-shrink-0"
        >
          <Trash2 className="size-3" />
        </button>
      </div>

      {open && (
        <div className="border-t border-white/5 px-4 py-4">
          {editing ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <EditableText
                  label="Title"
                  value={local.title}
                  onChange={v => setLocal(l => ({ ...l, title: v }))}
                  hint={`${local.title.length} / 8 min chars`}
                />
                <div className="space-y-1">
                  <label className="text-[9px] font-bold uppercase tracking-wider text-gray-600">Severity</label>
                  <div className="flex gap-1">
                    {(['critical', 'high', 'medium', 'low'] as DiagnosisSeverity[]).map(s => (
                      <button
                        key={s}
                        onClick={() => setLocal(l => ({ ...l, severity: s }))}
                        className="flex-1 py-1.5 rounded-lg text-[9px] font-bold transition-all border"
                        style={{
                          color:       local.severity === s ? SEV_CFG[s].color : '#6B7280',
                          background:  local.severity === s ? `${SEV_CFG[s].color}14` : 'transparent',
                          borderColor: local.severity === s ? `${SEV_CFG[s].color}33` : '#ffffff10',
                        }}
                      >
                        {SEV_CFG[s].label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 items-end">
                <EditableText
                  label="Description"
                  value={local.description}
                  onChange={v => setLocal(l => ({ ...l, description: v }))}
                  multiline
                  hint={`${local.description.length} / 200 min chars`}
                />
                <div className="space-y-1">
                  <label className="text-[9px] font-bold uppercase tracking-wider text-gray-600">
                    Confidence (0–100)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={local.confidence}
                      onChange={e => setLocal(l => ({ ...l, confidence: Number(e.target.value) }))}
                      className="flex-1 accent-[#8B5CF6]"
                    />
                    <span
                      className="text-xs font-bold font-mono w-8 text-right"
                      style={{ color: local.confidence >= 70 ? '#10B981' : '#FD4438' }}
                    >
                      {local.confidence}
                    </span>
                  </div>
                  <p className="text-[9px] text-gray-700">Gate requires ≥ 70</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <StringListEditor
                  label="Operational Impact (min 2, ≥ 30 chars each)"
                  items={local.operational_impact}
                  onChange={v => setLocal(l => ({ ...l, operational_impact: v }))}
                  accent="#FB923C"
                  placeholder="Add impact item…"
                />
                <StringListEditor
                  label="Financial Impact (min 2, ≥ 30 chars each)"
                  items={local.financial_impact}
                  onChange={v => setLocal(l => ({ ...l, financial_impact: v }))}
                  accent="#10B981"
                  placeholder="Add impact item…"
                />
              </div>

              <div className="flex gap-2 justify-end pt-1">
                <button
                  onClick={handleCancel}
                  className="px-3 py-1.5 text-[10px] font-bold text-gray-500 hover:text-white border border-white/10 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="px-3 py-1.5 text-[10px] font-bold text-[#10B981] bg-[#10B981]/10 border border-[#10B981]/25 rounded-lg hover:bg-[#10B981]/20 transition-colors flex items-center gap-1"
                >
                  <Check className="size-3" />Save Block
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-gray-300 leading-relaxed">{block.description}</p>

              <div className="grid grid-cols-2 gap-3">
                {block.operational_impact.length > 0 && (
                  <div>
                    <div className="text-[9px] font-bold text-[#FB923C] uppercase mb-1">Operational Impact</div>
                    <ul className="space-y-0.5">
                      {block.operational_impact.map((imp, i) => (
                        <li key={i} className="text-[10px] text-gray-400 flex items-start gap-1.5">
                          <span className="size-1 rounded-full bg-[#FB923C] mt-1.5 flex-shrink-0" />{imp}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {block.financial_impact.length > 0 && (
                  <div>
                    <div className="text-[9px] font-bold text-[#10B981] uppercase mb-1">Financial Impact</div>
                    <ul className="space-y-0.5">
                      {block.financial_impact.map((imp, i) => (
                        <li key={i} className="text-[10px] text-gray-400 flex items-start gap-1.5">
                          <span className="size-1 rounded-full bg-[#10B981] mt-1.5 flex-shrink-0" />{imp}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {block.evidence.length > 0 && (
                <div className="border-t border-white/5 pt-3">
                  <div className="text-[9px] font-bold text-gray-600 uppercase mb-2">Evidence</div>
                  <div className="space-y-1">
                    {block.evidence.map((ev, i) => (
                      <div key={i} className="flex items-start gap-2 text-[10px]">
                        <span className="px-1.5 py-0.5 rounded bg-white/5 text-gray-600 font-mono text-[9px] flex-shrink-0">
                          {EVIDENCE_SOURCE_LABELS[ev.source]}
                        </span>
                        <span className="font-mono text-gray-500 flex-shrink-0">{ev.ref}</span>
                        {ev.note && <span className="text-gray-500 leading-relaxed">{ev.note}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DiagnosisCard({
  draft, onSave,
}: { draft: ProposalDraft; onSave: (d: ProposalDraft) => void }) {
  const [blocks, setBlocks] = useState<DiagnosisBlock[]>(draft.diagnosis_blocks);
  const [dirty, setDirty] = useState(false);
  const [aiAppliedIdx, setAiAppliedIdx] = useState<number | null>(null);
  const { registerApplyHandler, unregisterApplyHandler } = useGlobalAIChat();

  // Register apply handler: AI content → first block's description field
  useEffect(() => {
    registerApplyHandler('proposal.diagnosis', (content: string) => {
      setBlocks(prev => {
        if (prev.length === 0) return prev;
        const updated = [...prev];
        updated[0] = { ...updated[0], description: content };
        return updated;
      });
      setDirty(true);
      setAiAppliedIdx(0);
      setTimeout(() => setAiAppliedIdx(null), 3500);
    });
    return () => unregisterApplyHandler('proposal.diagnosis');
  }, [registerApplyHandler, unregisterApplyHandler]);

  const update = (i: number, b: DiagnosisBlock) => {
    const next = blocks.map((bl, idx) => idx === i ? b : bl);
    setBlocks(next);
    setDirty(true);
  };
  const remove = (i: number) => { setBlocks(b => b.filter((_, idx) => idx !== i)); setDirty(true); };
  const addBlock = () => {
    const newBlock: DiagnosisBlock = {
      diagnosis_id: `DX-0${blocks.length + 1}`,
      title: '', description: '',
      operational_impact: [], financial_impact: [],
      evidence: [], severity: 'high', confidence: 70,
    };
    setBlocks(b => [...b, newBlock]);
    setDirty(true);
  };
  const saveAll = () => {
    onSave({ ...draft, diagnosis_blocks: blocks, metadata: bumpVersion(draft) });
    setDirty(false);
  };

  return (
    <CardShell
      icon={AlertTriangle}
      title={`Confirmed Diagnosis (${blocks.length})`}
      badge="Editable"
      accent="#FD4438"
      editSlot={
        <div className="flex items-center gap-2">
          {dirty && (
            <button
              onClick={saveAll}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#10B981]/10 border border-[#10B981]/25 text-[#10B981] text-[10px] font-bold rounded-lg hover:bg-[#10B981]/20 transition-colors"
            >
              <Check className="size-3" />Save All
            </button>
          )}
          <button
            onClick={addBlock}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-white/10 text-gray-400 text-[10px] font-bold rounded-lg hover:border-[#FD4438]/30 hover:text-[#FD4438] transition-colors"
          >
            <Plus className="size-3" />Add Block
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {/* AI Apply banner */}
        {aiAppliedIdx !== null && (
          <div className="flex items-center gap-2 px-3 py-2 bg-[#FD4438]/10 border border-[#FD4438]/30 rounded-lg">
            <CheckCircle2 className="size-3.5 text-[#FD4438] flex-shrink-0" />
            <p className="text-[11px] text-[#FD4438] font-semibold">
              AI content applied to Block 1 description — review and save when ready.
            </p>
          </div>
        )}
        {/* AI quick-generate for Diagnosis section */}
        <AIToolbar
          sectionId="proposal.diagnosis"
          sectionLabel="Diagnosis Blocks"
          sectionContent={blocks.map((b, i) => `Block ${i + 1}: ${b.title} — ${b.description}`).join('\n')}
          actions={[
            { label: 'Deepen Argument', prompt: 'Deepen the logical argument for the diagnosis blocks. Add "what breaks next if unresolved" framing without inventing new data.' },
            { label: 'Executive Language', prompt: 'Rewrite the diagnosis blocks in executive-level language — remove jargon, add business impact framing.', icon: 'zap' },
            { label: 'Add Urgency', prompt: 'Add compelling urgency framing to the diagnosis narrative. Explain the compounding cost of inaction.', icon: 'message' },
          ]}
        />
        {blocks.map((b, i) => (
          <DiagnosisBlockCard
            key={b.diagnosis_id}
            block={b}
            index={i}
            onUpdate={bl => update(i, bl)}
            onRemove={() => remove(i)}
          />
        ))}
        {blocks.length === 0 && (
          <div className="text-center py-8 text-gray-600 text-xs">
            No diagnosis blocks yet. Gate requires ≥ 3 — click "Add Block" to begin.
          </div>
        )}
        <p className="text-[9px] text-gray-700 flex items-center gap-1.5 pt-1">
          <Info className="size-2.5" />
          Gate requires ≥ 3 blocks; each needs ≥ 8-char title, ≥ 200-char description, 2 impact items each (≥ 30 chars), 1 evidence item, confidence ≥ 70, and at least 1 High or Critical block.
        </p>
      </div>
    </CardShell>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// §3 — SCOPE BOUNDARIES CARD
// ════════════════════════════════════════════════════════════════════════════════

function ScopeCard({
  draft, onSave,
}: { draft: ProposalDraft; onSave: (d: ProposalDraft) => void }) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState({ ...draft.scope_boundaries });

  const handleSave = () => {
    onSave({ ...draft, scope_boundaries: local, metadata: bumpVersion(draft) });
    setEditing(false);
  };
  const handleCancel = () => { setLocal({ ...draft.scope_boundaries }); setEditing(false); };

  const s = editing ? local : draft.scope_boundaries;

  return (
    <CardShell
      icon={Shield}
      title="Scope Boundaries"
      badge="Editable"
      accent="#3B82F6"
      editSlot={
        editing ? (
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#10B981]/10 border border-[#10B981]/25 text-[#10B981] text-[10px] font-bold rounded-lg hover:bg-[#10B981]/20 transition-colors"
            >
              <Check className="size-3" />Save
            </button>
            <button
              onClick={handleCancel}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-white/10 text-gray-400 text-[10px] font-bold rounded-lg hover:bg-white/10 transition-colors"
            >
              <X className="size-3" />Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-white/10 text-gray-400 text-[10px] font-bold rounded-lg hover:border-[#3B82F6]/40 hover:text-[#3B82F6] transition-colors"
          >
            <Edit3 className="size-3" />Edit
          </button>
        )
      }
    >
      {editing ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StringListEditor
              label="✓ Included (min 3)"
              items={local.included}
              onChange={v => setLocal(l => ({ ...l, included: v }))}
              accent="#10B981"
              placeholder="Add included item…"
            />
            <StringListEditor
              label="✗ Excluded (min 2)"
              items={local.excluded}
              onChange={v => setLocal(l => ({ ...l, excluded: v }))}
              accent="#FD4438"
              placeholder="Add excluded item…"
            />
            <StringListEditor
              label="Assumptions (min 2)"
              items={local.assumptions}
              onChange={v => setLocal(l => ({ ...l, assumptions: v }))}
              accent="#F59E0B"
              placeholder="Add assumption…"
            />
          </div>
          <p className="text-[9px] text-gray-700 flex items-center gap-1.5">
            <Info className="size-2.5" />
            Gate requires excluded scope to explicitly block legal/medical/financial advisory and fully autonomous AI.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <div className="text-[9px] font-bold text-[#10B981] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <CheckCircle2 className="size-3" />Included
            </div>
            <ul className="space-y-1.5">
              {s.included.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-gray-300">
                  <span className="size-1.5 rounded-full bg-[#10B981] mt-1 flex-shrink-0" />{item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-[9px] font-bold text-[#FD4438] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <X className="size-3" />Excluded
            </div>
            <ul className="space-y-1.5">
              {s.excluded.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-gray-400">
                  <span className="size-1.5 rounded-full bg-[#FD4438]/50 mt-1 flex-shrink-0" />{item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-[9px] font-bold text-[#F59E0B] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Info className="size-3" />Assumptions
            </div>
            <ul className="space-y-1.5">
              {s.assumptions.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-gray-400">
                  <span className="size-1.5 rounded-full bg-[#F59E0B]/50 mt-1 flex-shrink-0" />{item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </CardShell>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// §4 — NEXT STEP OFFER CARD
// ════════════════════════════════════════════════════════════════════════════════

function NextStepOfferCard({
  draft, onSave,
}: { draft: ProposalDraft; onSave: (d: ProposalDraft) => void }) {
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceInput, setPriceInput] = useState(String(draft.next_step_offer.price));

  const handleSavePrice = () => {
    const parsed = parseInt(priceInput.replace(/\D/g, ''), 10);
    if (!isNaN(parsed) && parsed > 0) {
      onSave({
        ...draft,
        next_step_offer: { ...draft.next_step_offer, price: parsed },
        metadata: bumpVersion(draft),
      });
    }
    setEditingPrice(false);
  };

  const offer = draft.next_step_offer;

  return (
    <CardShell icon={Zap} title="Next Step Offer" accent="#FB923C">
      <div className="space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Price — editable */}
          <div className="bg-gradient-to-br from-[#10B981]/10 to-[#06D7F6]/10 border border-[#10B981]/20 rounded-xl px-4 py-3">
            <div className="text-[9px] font-bold text-gray-600 uppercase mb-1 flex items-center gap-1">
              Price
              <button
                onClick={() => { setEditingPrice(e => !e); setPriceInput(String(offer.price)); }}
                className="text-[#8B5CF6] hover:text-[#A78BFA] transition-colors ml-1"
              >
                <Edit3 className="size-2.5" />
              </button>
            </div>
            {editingPrice ? (
              <div className="flex items-center gap-1.5">
                <span className="text-gray-400 text-sm">$</span>
                <input
                  type="number"
                  value={priceInput}
                  onChange={e => setPriceInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSavePrice();
                    if (e.key === 'Escape') setEditingPrice(false);
                  }}
                  className="w-full bg-transparent text-base font-black text-white focus:outline-none"
                  autoFocus
                />
                <button onClick={handleSavePrice} className="text-[#10B981]">
                  <Check className="size-3" />
                </button>
              </div>
            ) : (
              <div className="text-xl font-black text-[#10B981]">
                ${offer.price.toLocaleString()}{' '}
                <span className="text-[10px] font-normal text-gray-500">{offer.currency}</span>
              </div>
            )}
          </div>

          {/* Duration */}
          <div className="bg-white/[0.025] border border-white/8 rounded-xl px-4 py-3">
            <div className="text-[9px] font-bold text-gray-600 uppercase mb-1 flex items-center gap-1">
              <Clock className="size-2.5" />Duration <Lock className="size-2.5 ml-1 text-gray-700" />
            </div>
            <div className="text-sm font-black text-[#06D7F6]">{offer.duration}</div>
          </div>

          {/* Offer name */}
          <div className="bg-white/[0.025] border border-white/8 rounded-xl px-4 py-3 col-span-2">
            <div className="text-[9px] font-bold text-gray-600 uppercase mb-1 flex items-center gap-1">
              Offer Name <Lock className="size-2.5 ml-1 text-gray-700" />
            </div>
            <div className="text-sm font-bold text-white">{offer.offer_name}</div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pt-1">
          <button className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-gradient-to-r from-[#8B5CF6] to-[#6D28D9] text-white text-sm font-bold rounded-xl hover:from-[#7C3AED] hover:to-[#5B21B6] transition-all shadow-lg shadow-[#8B5CF6]/20">
            <CheckCircle2 className="size-4" />{offer.primary_cta}
          </button>
          <button className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-white/5 border border-white/10 text-gray-300 text-sm font-semibold rounded-xl hover:bg-white/10 hover:border-white/20 transition-all">
            <Send className="size-4" />{offer.secondary_cta}
          </button>
        </div>

        <p className="text-[9px] text-gray-700 flex items-center gap-1.5">
          <Lock className="size-2.5" />
          Offer name, duration, and CTAs are system-defined for Phase 1. Price is editable.
          All edits create a new proposal version.
        </p>
      </div>
    </CardShell>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// ROOT EXPORT: ProposalDraftEditor
// ════════════════════════════════════════════════════════════════════════════════

interface ProposalDraftEditorProps {
  initialDraft: ProposalDraft;
  onDraftChange?: (updated: ProposalDraft) => void;
  submissionId?: string;
  accessToken?: string;
}

export function ProposalDraftEditor({ initialDraft, onDraftChange, submissionId, accessToken }: ProposalDraftEditorProps) {
  const [draft, setDraft]             = useState<ProposalDraft>(initialDraft);
  const [gateResult,  setGateResult]  = useState<GateResult | null>(null);
  const [gateResult2, setGateResult2] = useState<GateResult | null>(null);
  const [gateResult3, setGateResult3] = useState<GateResult | null>(null);
  const [gateResult4, setGateResult4] = useState<GateResult | null>(null);
  const [gateResult5, setGateResult5] = useState<GateResult | null>(null);

  // Phase P2: snapshot history (refreshed after each export)
  const [snapshots, setSnapshots] = useState<ProposalSnapshot[]>(
    () => getSnapshotsByProposal(initialDraft.proposal_id),
  );
  const handleSnapshotCreated = useCallback((_snap: ProposalSnapshot) => {
    setSnapshots(getSnapshotsByProposal(draft.proposal_id));
  }, [draft.proposal_id]);

  // Live Phase 1 gate score (meta strip score pill)
  const liveGate = useMemo(() => runReadyGate(draft), [draft]);

  const save = useCallback((updated: ProposalDraft) => {
    setDraft(updated);
    setGateResult(null);
    setGateResult2(null);
    setGateResult3(null);
    setGateResult4(null);
    setGateResult5(null);
    onDraftChange?.(updated);
  }, [onDraftChange]);

  // ── Copilot section apply ──
  // Called when user accepts an AI revision for a specific proposal section.
  // Routes content to the correct draft field and bumps version.
  const handleCopilotApply = useCallback((section: string, content: Record<string, unknown>) => {
    let updated: ProposalDraft;
    const now = new Date().toISOString();
    const nextMeta = { ...draft.metadata, version: draft.metadata.version + 1, last_updated_at: now };

    if (section === 'executive_brief') {
      updated = { ...draft, executive_brief: content as ProposalDraft['executive_brief'], metadata: nextMeta };
    } else if (section === 'scope_boundaries') {
      updated = { ...draft, scope_boundaries: content as ProposalDraft['scope_boundaries'], metadata: nextMeta };
    } else if (section === 'next_step_offer') {
      updated = { ...draft, next_step_offer: content as ProposalDraft['next_step_offer'], metadata: nextMeta };
    } else if (section.startsWith('diagnosis_')) {
      const idx = parseInt(section.split('_')[1] ?? '0', 10);
      const newBlocks = [...draft.diagnosis_blocks];
      if (idx < newBlocks.length) newBlocks[idx] = content as ProposalDraft['diagnosis_blocks'][0];
      updated = { ...draft, diagnosis_blocks: newBlocks, metadata: nextMeta };
    } else {
      return; // unknown section — no-op
    }
    save(updated);
  }, [draft, save]);

  const handleMarkInternalReview = useCallback(() => {
    const result = runReadyGate(draft);
    if (result.passed) {
      const updated: ProposalDraft = {
        ...draft,
        status: 'internal_review',
        metadata: { ...draft.metadata, version: draft.metadata.version + 1, last_updated_at: result.validation_timestamp },
      };
      setDraft(updated);
      onDraftChange?.(updated);
      console.log(`[Phase1Gate] PASSED — v${updated.metadata.version} hash:#${result.version_hash}`);
    } else {
      console.log(`[Phase1Gate] FAILED — ${result.missing.length} blockers`, result.missing.map(m => `${m.path}: ${m.reason}`));
    }
    setGateResult(result);
    requestAnimationFrame(() => {
      document.getElementById('proposal-gate-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, [draft, onDraftChange]);

  const handleAdvanceToFinancialBinding = useCallback(() => {
    const result = runPhase2Gate(draft);
    if (result.passed) {
      const updated: ProposalDraft = {
        ...draft,
        status: 'financial_binding',
        metadata: { ...draft.metadata, version: draft.metadata.version + 1, last_updated_at: result.validation_timestamp },
      };
      setDraft(updated);
      onDraftChange?.(updated);
      console.log(`[Phase2Gate] PASSED — v${updated.metadata.version} hash:#${result.version_hash}`);
    } else {
      console.log(`[Phase2Gate] FAILED — ${result.missing.length} blockers`, result.missing.map(m => `${m.path}: ${m.reason}`));
    }
    setGateResult2(result);
    requestAnimationFrame(() => {
      document.getElementById('proposal-gate2-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, [draft, onDraftChange]);

  // Phase 4 gate → transitions to ready_to_send.
  // expires_at is NOT set here — the 30-day validity clock starts from sent_at, not from ready_to_send.
  const handleAdvanceToSent = useCallback(() => {
    const result = runPhase4Gate(draft);
    if (result.passed) {
      const updated: ProposalDraft = {
        ...draft,
        status: 'ready_to_send',
        proposal_state: {
          status:      'ready_to_send',
          locked:      false,
          sent_at:     null,
          viewed_at:   null,
          approved_at: null,
          expires_at:  null,   // clock starts on Export, not on Ready-to-Send
          approved_by: null,
        },
        metadata: { ...draft.metadata, version: draft.metadata.version + 1, last_updated_at: result.validation_timestamp },
      };
      setDraft(updated);
      onDraftChange?.(updated);
      console.log(`[Phase4Gate] PASSED → ready_to_send — v${updated.metadata.version} hash:#${result.version_hash}`);
    } else {
      console.log(`[Phase4Gate] FAILED — ${result.missing.length} blockers`, result.missing.map(m => `${m.path}: ${m.reason}`));
    }
    setGateResult4(result);
    requestAnimationFrame(() => {
      document.getElementById('proposal-gate4-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, [draft, onDraftChange]);

  // Phase 5 export gate → transitions to sent and locks financial fields
  const handleExportProposal = useCallback((exportType: ExportType) => {
    const result = runPhase5Gate(draft);
    if (result.passed) {
      const now       = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const updated: ProposalDraft = {
        ...draft,
        status: 'sent',
        proposal_state: {
          status:      'sent',
          locked:      true,
          sent_at:     now,
          viewed_at:   null,
          approved_at: null,
          expires_at:  expiresAt,
          approved_by: null,
        },
        metadata: { ...draft.metadata, version: draft.metadata.version + 1, last_updated_at: result.validation_timestamp },
      };
      setDraft(updated);
      onDraftChange?.(updated);
      console.log(`[Phase5Gate] PASSED → sent — type:${exportType} v${updated.metadata.version} hash:#${result.version_hash}`);
    } else {
      console.log(`[Phase5Gate] FAILED — ${result.missing.length} blockers`, result.missing.map(m => `${m.path}: ${m.reason}`));
    }
    setGateResult5(result);
    requestAnimationFrame(() => {
      document.getElementById('proposal-control-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, [draft, onDraftChange]);

  const handleAdvanceToApproved = useCallback(() => {
    const result = runPhase3Gate(draft);
    if (result.passed) {
      const updated: ProposalDraft = {
        ...draft,
        status: 'approved',
        metadata: { ...draft.metadata, version: draft.metadata.version + 1, last_updated_at: result.validation_timestamp },
      };
      setDraft(updated);
      onDraftChange?.(updated);
      console.log(`[Phase3Gate] PASSED — v${updated.metadata.version} hash:#${result.version_hash}`);
    } else {
      console.log(`[Phase3Gate] FAILED — ${result.missing.length} blockers`, result.missing.map(m => `${m.path}: ${m.reason}`));
    }
    setGateResult3(result);
    requestAnimationFrame(() => {
      document.getElementById('proposal-gate3-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, [draft, onDraftChange]);

  return (
    <div className="space-y-4">
      {/* Meta strip */}
      <ProposalMetaStrip
        draft={draft}
        gateScore={{ passed: liveGate.checks_passed, total: liveGate.checks_total }}
        onMarkInternalReview={handleMarkInternalReview}
        onAdvanceToFinancialBinding={draft.status === 'internal_review' ? handleAdvanceToFinancialBinding : undefined}
        onAdvanceToApproved={draft.status === 'financial_binding' ? handleAdvanceToApproved : undefined}
        onAdvanceToSent={draft.status === 'approved' ? handleAdvanceToSent : undefined}
      />

      {/* Phase 1 gate panel */}
      {gateResult && (
        <div id="proposal-gate-panel">
          <ReadyGatePanel result={gateResult} onRecheck={handleMarkInternalReview} onClose={() => setGateResult(null)} />
        </div>
      )}

      {/* Phase 2 gate panel */}
      {gateResult2 && (
        <div id="proposal-gate2-panel">
          <ReadyGatePanel result={gateResult2} onRecheck={handleAdvanceToFinancialBinding} onClose={() => setGateResult2(null)} />
        </div>
      )}

      {/* Phase 3 gate panel */}
      {gateResult3 && (
        <div id="proposal-gate3-panel">
          <ReadyGatePanel result={gateResult3} onRecheck={handleAdvanceToApproved} onClose={() => setGateResult3(null)} />
        </div>
      )}

      {/* Phase 4 gate panel */}
      {gateResult4 && (
        <div id="proposal-gate4-panel">
          <ReadyGatePanel result={gateResult4} onRecheck={handleAdvanceToSent} onClose={() => setGateResult4(null)} />
        </div>
      )}

      {/* ── AI Copilot — section-targeted feedback loop ── */}
      <ProposalSectionCopilot
        draft={draft}
        onApply={handleCopilotApply}
        accessToken={accessToken}
      />

      {/* §1 Executive Brief */}
      <ExecutiveBriefCard draft={draft} onSave={save} />

      {/* §2 Confirmed Diagnosis */}
      <DiagnosisCard draft={draft} onSave={save} />

      {/* §3 Solution Architecture (Phase 2) */}
      <SolutionArchitectureCard draft={draft} onSave={save} />

      {/* §4 Financial Summary (Phase 3) */}
      <FinancialSummaryCard draft={draft} />

      {/* §5 Implementation Architecture (Phase 4) */}
      <ImplementationArchitectureCard draft={draft} onSave={save} />

      {/* §6 Scope Boundaries */}
      <ScopeCard draft={draft} onSave={save} />

      {/* §6 Next Step Offer */}
      <NextStepOfferCard draft={draft} onSave={save} />

      {/* §7 Proposal Control & Export (Phase 5) */}
      <div id="proposal-control-panel">
        <ProposalControlPanel
          draft={draft}
          onExport={handleExportProposal}
          gateResult5={gateResult5}
        />
      </div>

      {/* §8 Contract Auto-Generation (Phase 6) — visible once proposal is sent */}
      {(draft.status === 'sent' || draft.status === 'viewed' || draft.status === 'approved' ||
        draft.status === 'ready_to_send') && (
        <ContractDraftViewer draft={draft} />
      )}

      {/* §9 Objection Handling Intelligence (Phase 6) — visible once proposal is sent */}
      {(draft.status === 'sent' || draft.status === 'viewed') && (
        <ObjectionHandlerPanel draft={draft} submissionId={submissionId} accessToken={accessToken} />
      )}

      {/* §10 CRM Sync Layer (Phase 7) — always visible; deal auto-created at diagnostic start */}
      <CRMSyncPanel draft={draft} />

      {/* §11 Post-Implementation ROI Tracking (Phase 8) — always visible */}
      <ROITrackingPanel draft={draft} />

      {/* §12 Universal Block Registry (Foundation) — editable-blocks-schema.json */}
      <BlockRegistryPanel
        proposalId={draft.proposal_id}
        onProposalDowngrade={() => {
          // Change Impact Engine §2 B: auto-downgrade from ready_to_send / sent → draft
          if (draft.status === 'ready_to_send' || draft.status === 'sent') {
            save({ ...draft, status: 'draft' });
          }
        }}
      />

      {/* §13 Executive Export Engine — proposal-p2-implementation.md §2 */}
      <ExportPanel
        draft={draft}
        onExported={handleSnapshotCreated}
      />

      {/* §14 Snapshot History — proposal-p2-implementation.md §1 */}
      <SnapshotHistoryPanel
        proposalId={draft.proposal_id}
        snapshots={snapshots}
      />

      {/* §15 Execution Dashboard launch — visible once proposal is sent */}
      {(draft.status === 'sent' || draft.status === 'viewed' || draft.status === 'approved') && (
        <div
          className="rounded-xl border px-5 py-4 flex items-center gap-4"
          style={{ borderColor: '#06D7F625', background: '#06D7F608' }}
        >
          <LayoutDashboard className="size-5 text-[#06D7F6] flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-bold text-white">Execution Dashboard Ready</div>
            <div className="text-[9px] text-gray-600 mt-0.5 leading-relaxed">
              Proposal is {draft.status}. Launch the Execution Blueprint Engine to manage workstreams,
              milestones, tasks, gates, and live ROI tracking — all derived from the immutable snapshot.
            </div>
          </div>
          <button
            onClick={() => window.open('/team/execution', '_blank')}
            className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-bold border transition-colors"
            style={{ borderColor: '#06D7F630', color: '#06D7F6', background: '#06D7F614' }}
          >
            <LayoutDashboard className="size-3.5" />
            Launch Execution
            <ArrowRight className="size-3" />
          </button>
        </div>
      )}

      {/* Version / audit footer */}
      <div className="flex items-center justify-between text-[9px] text-gray-700 px-1">
        <span className="flex items-center gap-1.5">
          <GitBranch className="size-2.5" />
          Proposal v{draft.metadata.version} · Every card save increments version
        </span>
        <span>
          Last updated: {new Date(draft.metadata.last_updated_at).toLocaleString()}
        </span>
      </div>
    </div>
  );
}