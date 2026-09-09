/**
 * EDITABLE BLOCK CARD — editable-blocks-schema.json §7 + ai-assist-per-block.md
 *
 * Each block shows (spec §7):
 *   ✓  Title
 *   ✓  Status badge (Draft / Approved / Locked)
 *   ✓  "Edit" button (if not locked)
 *   ✓  "History" button
 *   ✓  If pending revision: "Review changes" side-by-side diff (Accept / Reject / Edit Manually)
 *   ✓  No silent edits. Ever.
 *
 * AI actions (ai-assist-per-block.md §1):
 *   ✓  Improve / Expand / Simplify / Fix Issues
 *   ✓  Creates pending revision only — humans approve
 *   ✓  Loading state while AI runs
 *   ✓  Safety: roi_financial_snapshot disables AI buttons
 *   ✓  Safety: contract_clause shows admin-only notice
 *
 * UI review (spec §6):
 *   ✓  Side-by-side Current vs Proposed
 *   ✓  Highlighted diff for structured_json keys
 *   ✓  Edit manually — rejects AI revision, opens editor pre-filled with proposed content
 */

import React, { useState } from 'react';
import {
  Edit3, History, Lock, CheckCircle2, XCircle, ChevronDown, ChevronUp,
  Bot, User, AlertTriangle, Zap, Info, Eye, Save, X, Hourglass,
  Shield, FileText, Loader2, TriangleAlert,
  ArrowLeftRight, Minimize2, Expand, Wrench,
} from 'lucide-react';
import type { BlockState, RevisionChangeType } from '@/app/core/blockEngine';
import {
  BLOCK_TYPE_LABELS,
  STATUS_COLORS,
  SOURCE_COLORS,
  LOCK_REASON_LABELS,
  REFERENCE_ONLY_TYPES,
} from '@/app/core/blockEngine';
import type { AIAction } from '@/app/core/aiAssistEngine';
import { AI_ACTION_LABELS, AI_ACTION_DESCRIPTIONS } from '@/app/core/aiAssistEngine';
import type { UserRole } from '@/app/core/roleEngine';
import {
  canEditBlock,
  canAIAssistBlock,
  canApproveBlock,
  getPermissionDeniedReason,
  ROLE_LABELS,
  ROLE_COLORS,
} from '@/app/core/roleEngine';
import {
  brand,
  status as STATUS,
  text as TEXT,
} from '@/app/lib/tokens';

// ── Palette ──────────────────────────────────────────────────────────────────
//
// Read once at module scope. Deliberately not referenced as `status.x` inside
// the components below: one or more of them take a parameter of that name, and
// an unqualified reference there resolves to the parameter, not to the token.
const K_ACCENT       = brand.accent;
const K_ACCENT_ALT   = brand.accentAlt;
const K_CAUTION      = STATUS.caution;
const K_DANGER       = STATUS.danger;
const K_INFO         = STATUS.info;
const K_NEUTRAL      = STATUS.neutral;
const K_SUCCESS      = STATUS.success;
const K_TEXT_FAINT   = TEXT.faint;
const K_TEXT_MUTED   = TEXT.muted;
const K_TEXT_PRIMARY = TEXT.primary;
const K_WARNING      = STATUS.warning;


// ════════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════════

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  const hrs  = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (days > 0) return `${days}d ago`;
  if (hrs  > 0) return `${hrs}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return 'just now';
}

function stringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.length} item${v.length !== 1 ? 's' : ''}]`;
  if (typeof v === 'object' && v !== null) return '{…}';
  return String(v ?? '—');
}

// ════════════════════════════════════════════════════════════════════════════════
// CONTENT PREVIEW
// ════════════════════════════════════════════════════════════════════════════════

function ContentPreview({ content, format }: {
  content: Record<string, unknown>;
  format:  'rich_text' | 'structured_json';
}) {
  if (format === 'rich_text') {
    const text = (content.text as string) ?? '';
    return (
      <p className="text-[10px] text-cortex-muted leading-relaxed line-clamp-3">
        {text || <em className="text-cortex-faint">No content yet.</em>}
      </p>
    );
  }
  const entries = Object.entries(content).filter(([k]) => k !== '_note');
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-0.5">
      {entries.slice(0, 8).map(([k, v]) => (
        <div key={k} className="text-[9px]">
          <span className="text-cortex-faint uppercase tracking-wide">{k.replace(/_/g, ' ')}: </span>
          <span className="text-cortex-muted font-medium">
            {Array.isArray(v) ? `[${(v as unknown[]).length} items]` : String(v)}
          </span>
        </div>
      ))}
      {entries.length > 8 && (
        <span className="text-[8px] text-cortex-faint">+{entries.length - 8} more</span>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// SIDE-BY-SIDE DIFF — spec §6
// ════════════════════════════════════════════════════════════════════════════════

type DiffEntry = {
  key:     string;
  current: unknown;
  proposed: unknown;
  changed: boolean;
};

function diffContent(
  current:  Record<string, unknown>,
  proposed: Record<string, unknown>,
): DiffEntry[] {
  const allKeys = new Set([...Object.keys(current), ...Object.keys(proposed)]);
  return Array.from(allKeys)
    .filter(k => k !== '_note')
    .map(k => ({
      key:      k,
      current:  current[k],
      proposed: proposed[k],
      changed:  JSON.stringify(current[k]) !== JSON.stringify(proposed[k]),
    }));
}

function SideBySideDiff({
  block,
  proposedContent,
}: {
  block:           BlockState['block'];
  proposedContent: Record<string, unknown>;
}) {
  const isRich = block.content_format === 'rich_text';

  if (isRich) {
    const currentText  = (block.content.text as string) ?? '';
    const proposedText = (proposedContent.text as string) ?? '';
    return (
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-[8px] font-black uppercase tracking-widest text-cortex-faint mb-1.5 flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-gray-600 inline-block" />Current
          </div>
          <div className="bg-cortex-sunken rounded-cortex-sm p-2.5 text-[10px] text-cortex-faint leading-relaxed min-h-[80px]">
            {currentText || <em>Empty</em>}
          </div>
        </div>
        <div>
          <div className="text-[8px] font-black uppercase tracking-widest text-cortex-info mb-1.5 flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-cortex-info inline-block" />Proposed
          </div>
          <div className="bg-cortex-sunken rounded-cortex-sm p-2.5 text-[10px] text-white leading-relaxed min-h-[80px] border border-cortex-info/20">
            {proposedText || <em className="text-cortex-faint">Empty</em>}
          </div>
        </div>
      </div>
    );
  }

  // Structured JSON diff
  const diffs = diffContent(block.content, proposedContent);
  return (
    <div className="space-y-0.5 max-h-56 overflow-y-auto">
      {diffs.map(d => (
        <div
          key={d.key}
          className="grid grid-cols-[120px_1fr_1fr] gap-1.5 px-2 py-1 rounded text-[9px]"
          style={{ background: d.changed ? `${K_INFO}10` : 'transparent' }}
        >
          <span
            className="font-bold uppercase tracking-wide truncate"
            style={{ color: d.changed ? K_INFO : K_TEXT_FAINT }}
          >
            {d.key.replace(/_/g, ' ')}
            {d.changed && ' ✦'}
          </span>
          <span className="text-cortex-faint truncate">{stringify(d.current)}</span>
          <span
            className="truncate font-medium"
            style={{ color: d.changed ? K_SUCCESS : K_NEUTRAL }}
          >
            {stringify(d.proposed)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// INLINE EDITORS
// ════════════════════════════════════════════════════════════════════════════════

function RichTextEditor({
  initialText, onSave, onCancel,
}: {
  initialText: string;
  onSave:      (text: string, diffSummary: string) => void;
  onCancel:    () => void;
}) {
  const [text,        setText]        = useState(initialText);
  const [diffSummary, setDiffSummary] = useState('');
  const isValid = text.trim().length > 0 && diffSummary.trim().length >= 10;

  return (
    <div className="space-y-3 mt-3">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={6}
        placeholder="Write block content…"
        className="w-full bg-white/[0.04] border border-cortex-default rounded-cortex-sm px-3 py-2.5 text-xs text-white resize-y focus:outline-none focus:border-cortex-accent/60 placeholder:text-cortex-faint leading-relaxed"
      />
      <div>
        <label className="block text-[8px] font-bold uppercase tracking-wider text-cortex-faint mb-1">
          Change Summary <span className="text-cortex-danger">*</span>{' '}
          <em className="font-normal text-gray-800">(min 10 chars — no silent edits)</em>
        </label>
        <input
          value={diffSummary}
          onChange={e => setDiffSummary(e.target.value)}
          placeholder="Describe what changed and why…"
          className="w-full bg-white/[0.04] border border-cortex-default rounded-cortex-sm px-3 py-2 text-[10px] text-white focus:outline-none focus:border-cortex-accent/60 placeholder:text-cortex-faint"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => isValid && onSave(text, diffSummary)}
          disabled={!isValid}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-cortex-sm text-[10px] font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: isValid ? `${K_ACCENT}20` : `${K_TEXT_PRIMARY}10`, color: isValid ? K_ACCENT : K_NEUTRAL }}
        >
          <Save className="size-3" />Propose Revision
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-cortex-sm text-[10px] text-cortex-faint hover:text-white transition-colors"
        >
          <X className="size-3" />Cancel
        </button>
        <span className="ml-auto text-[8px] text-gray-800">Pending until accepted · §7</span>
      </div>
    </div>
  );
}

function StructuredJsonEditor({
  initialContent, onSave, onCancel,
}: {
  initialContent: Record<string, unknown>;
  onSave:         (content: Record<string, unknown>, diffSummary: string) => void;
  onCancel:       () => void;
}) {
  const [jsonText,    setJsonText]    = useState(JSON.stringify(initialContent, null, 2));
  const [diffSummary, setDiffSummary] = useState('');
  const [jsonError,   setJsonError]   = useState<string | null>(null);

  function handleJsonChange(val: string) {
    setJsonText(val);
    try { JSON.parse(val); setJsonError(null); }
    catch (e: any) { setJsonError(e.message); }
  }

  const isValid = !jsonError && diffSummary.trim().length >= 10;

  function handleSave() {
    if (!isValid) return;
    try { onSave(JSON.parse(jsonText), diffSummary); } catch { /* guarded */ }
  }

  return (
    <div className="space-y-3 mt-3">
      <textarea
        value={jsonText}
        onChange={e => handleJsonChange(e.target.value)}
        rows={8}
        spellCheck={false}
        className="w-full bg-white/[0.04] border border-cortex-default rounded-cortex-sm px-3 py-2.5 text-[10px] text-cortex-info font-mono resize-y focus:outline-none focus:border-cortex-accent/60 leading-relaxed"
        style={{ borderColor: jsonError ? `${K_DANGER}40` : undefined }}
      />
      {jsonError && (
        <div className="text-[8px] text-cortex-danger flex items-center gap-1">
          <AlertTriangle className="size-2.5" />{jsonError}
        </div>
      )}
      <div>
        <label className="block text-[8px] font-bold uppercase tracking-wider text-cortex-faint mb-1">
          Change Summary <span className="text-cortex-danger">*</span>
        </label>
        <input
          value={diffSummary}
          onChange={e => setDiffSummary(e.target.value)}
          placeholder="Describe what changed and why…"
          className="w-full bg-white/[0.04] border border-cortex-default rounded-cortex-sm px-3 py-2 text-[10px] text-white focus:outline-none focus:border-cortex-accent/60 placeholder:text-cortex-faint"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={!isValid}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-cortex-sm text-[10px] font-bold transition-all disabled:opacity-40"
          style={{ background: isValid ? `${K_ACCENT}20` : `${K_TEXT_PRIMARY}10`, color: isValid ? K_ACCENT : K_NEUTRAL }}
        >
          <Save className="size-3" />Propose Revision
        </button>
        <button onClick={onCancel} className="flex items-center gap-1.5 px-3 py-1.5 rounded-cortex-sm text-[10px] text-cortex-faint hover:text-white transition-colors">
          <X className="size-3" />Cancel
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// AI ACTION BUTTONS — ai-assist-per-block.md §1
// ════════════════════════════════════════════════════════════════════════════════

const AI_ACTION_ICONS: Record<AIAction, React.FC<{ className?: string }>> = {
  ai_improve:  Zap,
  ai_expand:   Expand,
  ai_simplify: Minimize2,
  fix_issues:  Wrench,
};

const AI_ACTION_COLORS: Record<AIAction, string> = {
  ai_improve:  K_ACCENT,
  ai_expand:   K_INFO,
  ai_simplify: K_CAUTION,
  fix_issues:  K_WARNING,
};

function AIActionButtons({
  blockType,
  isLocked,
  isReference,
  hasPending,
  isLoading,
  loadingAction,
  onAIAction,
  rolePermissionDenied,
  roleLabel,
}: {
  blockType:            string;
  isLocked:             boolean;
  isReference:          boolean;
  hasPending:           boolean;
  isLoading:            boolean;
  loadingAction:        AIAction | null;
  onAIAction:           (action: AIAction) => void;
  rolePermissionDenied?: boolean;
  roleLabel?:           string;
}) {
  // ROI snapshot — no AI buttons (spec §3)
  if (isReference) return null;

  // Contract clause — show admin notice but disable
  const isContractClause = blockType === 'contract_clause';

  const actions: AIAction[] = ['ai_improve', 'ai_expand', 'ai_simplify', 'fix_issues'];
  const disabled = isLocked || hasPending || isLoading || rolePermissionDenied;

  if (isContractClause) {
    return (
      <span
        className="flex items-center gap-1 px-2 py-1 rounded-cortex-sm text-[8px] border border-cortex-subtle text-cortex-faint"
        title="Contract clauses: AI suggestions visible to admin only"
      >
        <Bot className="size-3" />Admin AI only
      </span>
    );
  }

  // Role permission denied
  if (rolePermissionDenied) {
    return (
      <span
        className="flex items-center gap-1 px-2 py-1 rounded-cortex-sm text-[8px] border border-cortex-subtle text-cortex-faint"
        title={`${roleLabel ?? 'This role'}: no AI access for this block type`}
      >
        <Shield className="size-3" />{roleLabel} · no AI
      </span>
    );
  }

  if (isLoading && loadingAction) {
    const color = AI_ACTION_COLORS[loadingAction];
    return (
      <span
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-cortex-sm text-[9px] font-bold border"
        style={{ background: `${color}15`, borderColor: `${color}40`, color }}
      >
        <Loader2 className="size-3 animate-spin" />
        {AI_ACTION_LABELS[loadingAction]}…
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {actions.map(action => {
        const Icon  = AI_ACTION_ICONS[action];
        const color = AI_ACTION_COLORS[action];
        return (
          <button
            key={action}
            onClick={() => !disabled && onAIAction(action)}
            disabled={disabled}
            title={disabled
              ? hasPending ? 'Accept or reject the pending revision first'
              : isLocked   ? 'Block is locked'
              : 'Loading…'
              : AI_ACTION_DESCRIPTIONS[action]
            }
            className="flex items-center gap-1 px-2 py-1 rounded-cortex-sm text-[9px] font-bold border transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background:  `${color}0F`,
              borderColor: `${color}30`,
              color:        disabled ? K_NEUTRAL : color,
            }}
          >
            <Icon className="size-2.5" />
            {AI_ACTION_LABELS[action]}
          </button>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// REVISION REVIEW PANEL — spec §6 (side-by-side, Accept/Reject/Edit manually)
// ════════════════════════════════════════════════════════════════════════════════

function RevisionReviewPanel({
  blockState,
  onAccept,
  onReject,
  onEditManually,
}: {
  blockState:    BlockState;
  onAccept:      () => void;
  onReject:      () => void;
  onEditManually:() => void;
}) {
  const { block, pending_revision } = blockState;
  if (!pending_revision) return null;

  const isHuman = pending_revision.created_by_type === 'human';
  const authorColor = isHuman ? K_ACCENT_ALT : K_ACCENT;

  return (
    <div
      className="rounded-cortex-md border overflow-hidden"
      style={{ borderColor: `${K_CAUTION}30`, background: `${K_CAUTION}04` }}
    >
      {/* Review header */}
      <div className="flex items-start gap-3 px-4 py-3 border-b border-cortex-subtle">
        <Hourglass className="size-4 text-cortex-caution flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold text-cortex-caution mb-0.5">Review changes</div>
          <div className="text-[9px] text-cortex-muted">{pending_revision.diff_summary}</div>
          <div className="flex items-center gap-2 text-[8px] text-cortex-faint mt-1">
            {isHuman ? <User className="size-2.5" /> : <Bot className="size-2.5" />}
            <span style={{ color: authorColor }}>{isHuman ? 'Human' : 'AI'}</span>
            · {pending_revision.created_by}
            · <span className="font-mono">{pending_revision.revision_id}</span>
          </div>
        </div>
        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={onAccept}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-cortex-sm text-[10px] font-bold transition-colors"
            style={{ background: `${K_SUCCESS}20`, color: K_SUCCESS, border: `1px solid ${K_SUCCESS}40` }}
          >
            <CheckCircle2 className="size-3" />Accept
          </button>
          <button
            onClick={onEditManually}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-cortex-sm text-[10px] font-bold transition-colors border border-cortex-default text-cortex-muted hover:text-white hover:border-cortex-strong"
          >
            <Edit3 className="size-3" />Edit
          </button>
          <button
            onClick={onReject}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-cortex-sm text-[10px] font-bold transition-colors"
            style={{ background: `${K_DANGER}18`, color: K_DANGER, border: `1px solid ${K_DANGER}40` }}
          >
            <XCircle className="size-3" />Reject
          </button>
        </div>
      </div>

      {/* Side-by-side diff — spec §6 */}
      <div className="px-4 pt-3 pb-4 space-y-2">
        <div className="flex items-center gap-1.5 text-[8px] font-bold text-cortex-faint uppercase tracking-wide">
          <ArrowLeftRight className="size-3" />Side-by-side diff
        </div>
        <SideBySideDiff block={block} proposedContent={pending_revision.proposed_content} />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// ROI FINANCIAL SNAPSHOT VIEW
// ════════════════════════════════════════════════════════════════════════════════

function ROISnapshotView({ content }: { content: Record<string, unknown> }) {
  const metrics = [
    { label: 'ROI',         value: `${content.roi_percentage ?? '—'}%`,       color: K_SUCCESS },
    { label: 'Investment',  value: `$${((content.investment_total as number ?? 0) / 1_000).toFixed(0)}K`, color: K_ACCENT_ALT },
    { label: 'Annual Gain', value: `$${((content.annual_gain as number ?? 0) / 1_000).toFixed(0)}K`,     color: K_SUCCESS },
    { label: 'Payback',     value: `Mo. ${content.payback_month ?? '—'}`,      color: K_CAUTION },
    { label: 'Confidence',  value: `${content.confidence_score ?? '—'}%`,      color: K_ACCENT },
    { label: 'Scenario',    value: String(content.scenario ?? '—'),            color: K_INFO },
  ];
  return (
    <div>
      <div className="grid grid-cols-3 gap-1.5 mb-2">
        {metrics.map(m => (
          <div key={m.label} className="px-2 py-2 rounded-cortex-sm bg-black/20 border border-cortex-subtle text-center">
            <div className="text-[7px] uppercase tracking-wide text-cortex-faint mb-0.5">{m.label}</div>
            <div className="text-sm font-black" style={{ color: m.color }}>{m.value}</div>
          </div>
        ))}
      </div>
      <div className="flex items-start gap-1.5 text-[8px] text-cortex-faint">
        <Info className="size-3 flex-shrink-0 mt-0.5 text-cortex-accent" />
        <span>{content._note as string}</span>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// APPROVE BLOCK BUTTON
// ════════════════════════════════════════════════════════════════════════════════

function ApproveBlockButton({ blockState, onApprove, roleCanApprove }: {
  blockState: BlockState;
  onApprove:  () => void;
  roleCanApprove: boolean;
}) {
  const { block, pending_revision, lock } = blockState;
  if (block.status === 'approved' || block.status === 'locked' || pending_revision || lock) return null;
  return (
    <button
      onClick={onApprove}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-cortex-sm text-[10px] font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      style={{ background: `${K_SUCCESS}12`, borderColor: `${K_SUCCESS}40`, color: K_SUCCESS }}
      disabled={!roleCanApprove}
      title={!roleCanApprove ? 'Your role cannot approve this block type' : 'Approve this block'}
    >
      <CheckCircle2 className="size-3" />Approve Block
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// AI ERROR NOTICE
// ════════════════════════════════════════════════════════════════════════════════

function AIErrorNotice({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      className="flex items-start gap-2 px-3 py-2.5 rounded-cortex-md border text-[9px]"
      style={{ background: `${K_DANGER}10`, borderColor: `${K_DANGER}40` }}
    >
      <TriangleAlert className="size-3.5 text-cortex-danger flex-shrink-0 mt-0.5" />
      <div className="flex-1 text-cortex-muted">
        <span className="font-bold text-cortex-danger">AI assist failed: </span>{message}
      </div>
      <button onClick={onDismiss} className="text-cortex-faint hover:text-white">
        <X className="size-3" />
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT — EDITABLE BLOCK CARD
// ════════════════════════════════════════════════════════════════════════════════

export interface EditableBlockCardProps {
  blockState:       BlockState;
  onEdit:           (blockId: string, newContent: Record<string, unknown>, diffSummary: string) => void;
  onAcceptRevision: (blockId: string, revisionId: string) => void;
  onRejectRevision: (blockId: string, revisionId: string) => void;
  onApproveBlock:   (blockId: string) => void;
  onOpenHistory:    (blockId: string) => void;
  onAIAssist:       (blockId: string, action: AIAction) => Promise<void>;
  userRole:         UserRole;
}

export function EditableBlockCard({
  blockState,
  onEdit,
  onAcceptRevision,
  onRejectRevision,
  onApproveBlock,
  onOpenHistory,
  onAIAssist,
  userRole,
}: EditableBlockCardProps) {
  const { block, lock, pending_revision } = blockState;

  const [expanded,      setExpanded]      = useState(false);
  const [editing,       setEditing]       = useState(false);
  const [editInitial,   setEditInitial]   = useState<Record<string, unknown> | null>(null);
  const [isAILoading,   setIsAILoading]   = useState(false);
  const [loadingAction, setLoadingAction] = useState<AIAction | null>(null);
  const [aiError,       setAiError]       = useState<string | null>(null);

  const statusCfg   = STATUS_COLORS[block.status];
  const isLocked    = block.status === 'locked' || !!lock;
  const isReference = REFERENCE_ONLY_TYPES.has(block.block_type);
  const hasPending  = !!pending_revision;

  // Role permission checks (roleEngine — phase-p1-implementation.md §1)
  const roleCanEdit    = canEditBlock(userRole, block.block_type);
  const roleCanAI      = canAIAssistBlock(userRole, block.block_type);
  const roleCanApprove = canApproveBlock(userRole, block.block_type);
  const roleLabel      = ROLE_LABELS[userRole];
  const roleColor      = ROLE_COLORS[userRole];

  // canEdit: structural check PLUS role check
  const canEdit = !isLocked && !isReference && !pending_revision && roleCanEdit;

  // rolePermissionDenied used for AI button gating
  const rolePermissionDenied = !roleCanAI;

  function handleSave(content: Record<string, unknown>, diffSummary: string) {
    onEdit(block.block_id, content, diffSummary);
    setEditing(false);
    setEditInitial(null);
    setExpanded(true);
  }

  async function handleAIAction(action: AIAction) {
    if (isAILoading || hasPending || isLocked) return;
    setIsAILoading(true);
    setLoadingAction(action);
    setAiError(null);
    setExpanded(true);
    try {
      await onAIAssist(block.block_id, action);
    } catch (err: any) {
      setAiError(err?.message ?? String(err));
    } finally {
      setIsAILoading(false);
      setLoadingAction(null);
    }
  }

  function handleEditManually() {
    if (!pending_revision) return;
    // Spec §6: "Edit manually — turn proposed into editable draft"
    // Reject the AI revision, then open editor pre-filled with its proposed content
    onRejectRevision(block.block_id, pending_revision.revision_id);
    setEditInitial(pending_revision.proposed_content);
    setEditing(true);
    setExpanded(true);
  }

  const editorInitialContent = editInitial ?? block.content;
  const currentText = (editorInitialContent.text as string) ?? '';

  return (
    <div
      className="rounded-cortex-md border overflow-hidden transition-all"
      style={{
        borderColor: hasPending ? `${K_CAUTION}40` : isLocked ? `${K_NEUTRAL}30` : statusCfg.border,
        background:  isLocked ? `${K_TEXT_PRIMARY}03` : 'transparent',
      }}
    >
      {/* ── HEADER ── */}
      <div
        className="flex items-center gap-2 px-4 py-3 cursor-pointer flex-wrap"
        style={{
          background: hasPending ? `${K_CAUTION}08` : isLocked ? `${K_TEXT_PRIMARY}04` : `${K_TEXT_PRIMARY}06`,
        }}
        onClick={() => !editing && setExpanded(e => !e)}
      >
        {/* Type badge */}
        <span
          className="text-[7px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded flex-shrink-0"
          style={{ background: `${K_TEXT_PRIMARY}10`, color: K_TEXT_MUTED }}
        >
          {BLOCK_TYPE_LABELS[block.block_type]}
        </span>

        {/* Title */}
        <span className="text-[11px] font-bold text-white flex-1 truncate min-w-0">{block.title}</span>

        {/* Status badge */}
        <span
          className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border flex-shrink-0 flex items-center gap-1"
          style={{ background: statusCfg.bg, color: statusCfg.text, borderColor: statusCfg.border }}
        >
          {block.status === 'locked'   && <Lock className="size-2" />}
          {block.status === 'approved' && <CheckCircle2 className="size-2" />}
          {block.status}
        </span>

        {/* Pending indicator */}
        {hasPending && (
          <span
            className="text-[8px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
            style={{ background: `${K_CAUTION}20`, color: K_CAUTION }}
          >
            Pending
          </span>
        )}

        {/* Source + version */}
        <span
          className="text-[8px] font-bold flex-shrink-0 flex items-center gap-1"
          style={{ color: SOURCE_COLORS[block.source] }}
        >
          {block.source === 'ai'    && <Bot  className="size-2.5" />}
          {block.source === 'human' && <User className="size-2.5" />}
          {block.source === 'mixed' && <Zap  className="size-2.5" />}
          {block.source}
        </span>
        <span className="text-[8px] font-mono text-cortex-faint flex-shrink-0">v{block.version}</span>

        {/* Controls */}
        <div className="flex items-center gap-1.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
          {/* AI action buttons — ai-assist-per-block.md §1 */}
          <AIActionButtons
            blockType={block.block_type}
            isLocked={isLocked}
            isReference={isReference}
            hasPending={hasPending}
            isLoading={isAILoading}
            loadingAction={loadingAction}
            onAIAction={handleAIAction}
            rolePermissionDenied={rolePermissionDenied}
            roleLabel={roleLabel}
          />

          {/* Edit */}
          {canEdit && (
            <button
              onClick={() => { setEditing(e => !e); setExpanded(true); }}
              className="flex items-center gap-1 px-2 py-1 rounded-cortex-sm text-[9px] font-bold border transition-colors"
              style={{
                background:  editing ? `${K_ACCENT}20` : 'transparent',
                borderColor: editing ? `${K_ACCENT}40` : `${K_TEXT_PRIMARY}15`,
                color:       editing ? K_ACCENT   : K_TEXT_MUTED,
              }}
            >
              <Edit3 className="size-3" />Edit
            </button>
          )}

          {/* Role: no edit access indicator (when not locked/reference) */}
          {!canEdit && !isLocked && !isReference && !pending_revision && !roleCanEdit && (
            <span
              className="flex items-center gap-1 px-2 py-1 rounded-cortex-sm text-[8px] border border-cortex-subtle"
              style={{ color: roleColor }}
              title={getPermissionDeniedReason(userRole, block.block_type)}
            >
              <Shield className="size-2.5" />{roleLabel}
            </span>
          )}

          {/* Reference eye */}
          {isReference && (
            <span className="flex items-center gap-1 px-2 py-1 rounded-cortex-sm text-[9px] text-cortex-faint border border-cortex-subtle" title="Reference block (§9)">
              <Eye className="size-3" />Ref
            </span>
          )}

          {/* Lock indicator */}
          {isLocked && !isReference && (
            <span
              className="flex items-center gap-1 px-2 py-1 rounded-cortex-sm text-[9px] text-cortex-faint border border-cortex-subtle"
              title={lock ? `Locked: ${LOCK_REASON_LABELS[lock.lock_reason]}` : 'Locked'}
            >
              <Lock className="size-3" />
              {lock ? LOCK_REASON_LABELS[lock.lock_reason] : 'Locked'}
            </span>
          )}

          {/* History — always visible */}
          <button
            onClick={() => onOpenHistory(block.block_id)}
            className="flex items-center gap-1 px-2 py-1 rounded-cortex-sm text-[9px] font-bold border border-cortex-default text-cortex-faint hover:text-white hover:border-cortex-strong transition-colors"
          >
            <History className="size-3" />History
          </button>
        </div>

        {!editing && (
          expanded
            ? <ChevronUp   className="size-3.5 text-cortex-faint flex-shrink-0" />
            : <ChevronDown className="size-3.5 text-cortex-faint flex-shrink-0" />
        )}
      </div>

      {/* ── BODY ── */}
      {(expanded || editing) && (
        <div className="px-4 pb-4 space-y-3 pt-3">
          {/* AI error notice */}
          {aiError && (
            <AIErrorNotice message={aiError} onDismiss={() => setAiError(null)} />
          )}

          {/* Revision review panel — spec §6 */}
          {hasPending && (
            <RevisionReviewPanel
              blockState={blockState}
              onAccept={() => pending_revision && onAcceptRevision(block.block_id, pending_revision.revision_id)}
              onReject={() => pending_revision && onRejectRevision(block.block_id, pending_revision.revision_id)}
              onEditManually={handleEditManually}
            />
          )}

          {/* Lock notice */}
          {isLocked && lock && (
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-cortex-sm text-[9px]"
              style={{ background: `${K_NEUTRAL}10`, border: `1px solid ${K_NEUTRAL}20` }}
            >
              <Shield className="size-3 text-cortex-faint flex-shrink-0" />
              <span className="text-cortex-faint">
                Locked by <strong className="text-cortex-muted">{lock.locked_by}</strong> · {LOCK_REASON_LABELS[lock.lock_reason]}
              </span>
              {!lock.unlock_allowed && (
                <span className="ml-auto text-[8px] text-red-600 font-bold uppercase">unlock_allowed: false</span>
              )}
            </div>
          )}

          {/* ROI reference notice */}
          {isReference && (
            <div
              className="flex items-start gap-2 px-3 py-2 rounded-cortex-sm text-[9px]"
              style={{ background: `${K_ACCENT}10`, border: `1px solid ${K_ACCENT}30` }}
            >
              <Info className="size-3 text-cortex-accent flex-shrink-0 mt-0.5" />
              <span className="text-cortex-muted">
                <strong className="text-cortex-accent">ROI Protection (§9):</strong> Numbers come from the ROI engine. Edit <em>roi_summary_narrative</em> to change the narrative.
              </span>
            </div>
          )}

          {/* Content area */}
          <div>
            {!editing && (
              isReference
                ? <ROISnapshotView content={block.content} />
                : <ContentPreview content={block.content} format={block.content_format} />
            )}

            {editing && !isLocked && !isReference && (
              block.content_format === 'rich_text' ? (
                <RichTextEditor
                  initialText={currentText}
                  /* RichTextEditor yields the raw TEXT; handleSave forwards its
                     first argument to onEdit as the block's whole CONTENT record.
                     Passing handleSave directly replaced `{ text: '...' }` with a
                     bare string, so `block.content.text` went undefined and the
                     block rendered "Empty" after every rich-text edit. Re-wrap
                     the text into the content record, keeping sibling keys. */
                  onSave={(text, diffSummary) =>
                    handleSave({ ...editorInitialContent, text }, diffSummary)}
                  onCancel={() => { setEditing(false); setEditInitial(null); }}
                />
              ) : (
                <StructuredJsonEditor
                  initialContent={editorInitialContent}
                  onSave={handleSave}
                  onCancel={() => { setEditing(false); setEditInitial(null); }}
                />
              )
            )}
          </div>

          {/* Footer */}
          {!editing && (
            <div className="flex items-center justify-between pt-1 border-t border-cortex-subtle">
              <div className="text-[8px] text-gray-800 font-mono flex items-center gap-2">
                <FileText className="size-2.5" />
                {block.block_id} · {block.current_revision_id} · {timeAgo(block.updated_at)}
              </div>
              <ApproveBlockButton
                blockState={blockState}
                onApprove={() => onApproveBlock(block.block_id)}
                roleCanApprove={roleCanApprove}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}