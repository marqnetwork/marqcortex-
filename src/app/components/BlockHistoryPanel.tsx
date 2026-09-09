/**
 * BLOCK HISTORY PANEL — editable-blocks-schema.json §4
 *
 * Slide-in panel showing the full revision audit trail for a block.
 * Rule: Revisions are NEVER overwritten — this is the source of truth.
 *
 * Shows (newest first):
 *   revision_id, change_type badge, author, created_at,
 *   diff_summary, approval_status, approved_by + approved_at
 */

import React from 'react';
import {
  X, GitBranch, Clock, User, Bot, CheckCircle2, XCircle,
  Hourglass, Zap, Expand, Minimize2, Edit3, MessageSquare,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { BlockRevision, BlockState, RevisionChangeType } from '@/app/core/blockEngine';
import {
  CHANGE_TYPE_LABELS,
  SOURCE_COLORS,
  LOCK_REASON_LABELS,
} from '@/app/core/blockEngine';
import { useDialogBehavior } from '@/app/components/ui/cortex';
import {
  brand,
  status as STATUS,
  text as TEXT,
} from '@/app/lib/tokens';


// ════════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════════════════════

const CHANGE_TYPE_ICONS: Record<RevisionChangeType, LucideIcon> = {
  create:      Edit3,
  edit:        Edit3,
  ai_improve:  Zap,
  ai_expand:   Expand,
  ai_simplify: Minimize2,
  chat_patch:  MessageSquare,
};

const CHANGE_TYPE_COLORS: Record<RevisionChangeType, string> = {
  create:      STATUS.success,
  edit:        brand.accentAlt,
  ai_improve:  brand.accent,
  ai_expand:   STATUS.info,
  ai_simplify: STATUS.caution,
  chat_patch:  STATUS.warning,
};

const APPROVAL_CFG = {
  pending:  { label: 'Pending',  color: STATUS.caution, Icon: Hourglass    },
  accepted: { label: 'Accepted', color: STATUS.success, Icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: STATUS.danger, Icon: XCircle      },
};

// ════════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════════

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hrs   = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (days > 0)  return `${days}d ago`;
  if (hrs  > 0)  return `${hrs}h ago`;
  if (mins > 0)  return `${mins}m ago`;
  return 'just now';
}

// ════════════════════════════════════════════════════════════════════════════════
// REVISION ENTRY
// ════════════════════════════════════════════════════════════════════════════════

function RevisionEntry({
  revision,
  isCurrentRevision,
  isFirst,
}: {
  revision:          BlockRevision;
  isCurrentRevision: boolean;
  isFirst:           boolean;
}) {
  const changeColor  = CHANGE_TYPE_COLORS[revision.change_type];
  const ChangeIcon   = CHANGE_TYPE_ICONS[revision.change_type];
  const approvalCfg  = APPROVAL_CFG[revision.approval_status];
  const ApprovalIcon = approvalCfg.Icon;
  const isHuman      = revision.created_by_type === 'human';

  return (
    <div className="relative flex gap-3">
      {/* Timeline spine */}
      {!isFirst && (
        <div
          className="absolute left-[13px] bottom-full h-3 w-px"
          style={{ background: `${TEXT.primary}08` }}
        />
      )}

      {/* Icon */}
      <div
        className="flex-shrink-0 size-7 rounded-full flex items-center justify-center border mt-0.5"
        style={{
          background:  `${changeColor}18`,
          borderColor: `${changeColor}40`,
        }}
      >
        <ChangeIcon className="size-3.5" style={{ color: changeColor }} />
      </div>

      {/* Content */}
      <div
        className="flex-1 min-w-0 pb-4 border-b border-white/[0.04] last:border-0"
      >
        {/* Row 1: change type + current badge + timestamp */}
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span
            className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded"
            style={{ background: `${changeColor}20`, color: changeColor }}
          >
            {CHANGE_TYPE_LABELS[revision.change_type]}
          </span>

          {isCurrentRevision && (
            <span className="text-[8px] px-1.5 py-0.5 rounded border border-green-500/30 bg-green-500/10 text-green-400 font-bold uppercase tracking-wide">
              Active
            </span>
          )}

          <span className="ml-auto text-[8px] text-cortex-faint flex items-center gap-1">
            <Clock className="size-2.5" />
            {timeAgo(revision.created_at)}
          </span>
        </div>

        {/* Row 2: diff summary */}
        <p className="text-[10px] text-cortex-muted leading-relaxed mb-1.5">
          {revision.diff_summary}
        </p>

        {/* Row 3: author + approval status */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1 text-[8px] text-cortex-faint">
            {isHuman
              ? <User className="size-2.5" />
              : <Bot  className="size-2.5" />
            }
            <span style={{ color: SOURCE_COLORS[revision.created_by_type === 'human' ? 'human' : 'ai'] }}>
              {revision.created_by_type === 'human' ? 'Human' : 'AI'}
            </span>
            · {revision.created_by}
          </span>

          <span
            className="flex items-center gap-1 text-[8px] font-bold"
            style={{ color: approvalCfg.color }}
          >
            <ApprovalIcon className="size-2.5" />
            {approvalCfg.label}
            {revision.approved_by && revision.approved_at && (
              <span className="font-normal text-cortex-faint">
                · by {revision.approved_by}, {timeAgo(revision.approved_at)}
              </span>
            )}
          </span>

          <span className="ml-auto text-[8px] text-gray-800 font-mono">
            {revision.revision_id}
          </span>
        </div>

        {/* Full timestamp (tooltip-style) */}
        <div className="text-[7px] text-gray-800 mt-0.5">
          {fmtDate(revision.created_at)}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ════════════════════════════════════════════════════════════════════════════════

interface BlockHistoryPanelProps {
  blockState: BlockState;
  onClose:    () => void;
}

export function BlockHistoryPanel({ blockState, onClose }: BlockHistoryPanelProps) {
  const { dialogProps } = useDialogBehavior({ open: true, onClose, label: 'Revision history' });

  const { block, revisions, lock } = blockState;

  // Stats
  const humanRevs  = revisions.filter(r => r.created_by_type === 'human').length;
  const aiRevs     = revisions.filter(r => r.created_by_type === 'ai').length;
  const pendingRev = revisions.find(r => r.approval_status === 'pending');

  return (
    /* Slide-in overlay */
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel. A slide-in drawer is still a modal overlay: it covers the page,
          it takes the interaction, and it needs to say so and hold focus. */}
      <div {...dialogProps} className="relative w-full max-w-md h-full bg-cortex-overlay border-l border-cortex-default flex flex-col shadow-2xl overflow-hidden outline-none">

        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-white/8 bg-cortex-sunken">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <GitBranch className="size-3.5 text-cortex-accent" />
              <span className="text-[10px] font-black uppercase tracking-widest text-cortex-muted">
                Revision History
              </span>
            </div>
            <div className="text-sm font-bold text-white leading-tight">{block.title}</div>
            <div className="text-[9px] text-cortex-faint mt-0.5 font-mono">{block.block_id}</div>
          </div>
          <button
            onClick={onClose}
            className="size-7 rounded-cortex-sm flex items-center justify-center text-cortex-faint hover:text-white hover:bg-cortex-control transition-colors flex-shrink-0"
          >
            <X className="size-3.5" />
          </button>
        </div>

        {/* Stats strip */}
        <div className="flex items-center gap-0 border-b border-cortex-subtle bg-black/20">
          {[
            { label: 'Versions',   value: block.version,   color: brand.accent },
            { label: 'Total Rev.',  value: revisions.length, color: brand.accentAlt },
            { label: 'Human',      value: humanRevs,       color: brand.accentAlt },
            { label: 'AI',         value: aiRevs,          color: brand.accent },
          ].map((s, i) => (
            <div
              key={s.label}
              className="flex-1 flex flex-col items-center py-2.5 border-r border-cortex-subtle last:border-0"
            >
              <span className="text-sm font-black" style={{ color: s.color }}>{s.value}</span>
              <span className="text-[7px] uppercase tracking-wide text-cortex-faint">{s.label}</span>
            </div>
          ))}
        </div>

        {/* Lock notice */}
        {lock && (
          <div className="mx-4 mt-3 flex items-center gap-2 px-3 py-2 rounded-cortex-sm bg-gray-900/60 border border-cortex-subtle text-[9px] text-cortex-muted">
            <span className="text-cortex-faint">Locked:</span>
            <span className="font-bold text-cortex-muted">{LOCK_REASON_LABELS[lock.lock_reason]}</span>
            ·
            <span>{lock.locked_by}</span>
            {!lock.unlock_allowed && (
              <span className="ml-auto text-[8px] text-red-600 font-bold uppercase">No unlock</span>
            )}
          </div>
        )}

        {/* Pending notice */}
        {pendingRev && (
          <div className="mx-4 mt-2 flex items-center gap-2 px-3 py-2 rounded-cortex-sm border text-[9px]"
            style={{ background: `${STATUS.caution}08`, borderColor: `${STATUS.caution}30`, color: STATUS.caution }}>
            <Hourglass className="size-3 flex-shrink-0" />
            Pending revision awaiting review — see block card to Accept / Reject
          </div>
        )}

        {/* Revision timeline */}
        <div className="flex-1 overflow-y-auto p-5 space-y-0">
          {revisions.length === 0 ? (
            <div className="text-center py-12 text-[10px] text-cortex-faint">
              No revisions recorded yet.
            </div>
          ) : (
            revisions.map((rev, idx) => (
              <RevisionEntry
                key={rev.revision_id}
                revision={rev}
                isCurrentRevision={rev.revision_id === block.current_revision_id}
                isFirst={idx === 0}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-cortex-subtle bg-black/20 text-[8px] text-cortex-faint">
          Rule (schema §4): Revisions are never overwritten. This is the permanent audit trail.
        </div>
      </div>
    </div>
  );
}
