/**
 * CORTEX COPILOT PANEL — copilot-patch-plan.md
 *
 * Fixed right-side drawer. Three-step pipeline (spec §2):
 *   Step 1 (idle)        — input + scope selector + quick commands
 *   Step 2 (plan_ready)  — structured patch plan preview (no edits yet)
 *   Step 3 (review)      — review queue: Accept All / Accept Selected / Reject All
 *
 * Guardrails displayed (spec §5):
 *   - ROI recalc drift warning when solution/timeline blocks are touched
 *   - Accept All disabled if batch had failures
 *   - Full patch_id → revision audit trail
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  X, Send, Loader2, CheckCircle2, XCircle, TriangleAlert,
  Zap, Expand, Minimize2, Wrench, Link2, Mail, Bot,
  ChevronRight, ChevronDown, ShieldAlert, RefreshCw, Sparkles,
  Info, ListChecks, AlertCircle, Check, Square, CheckSquare,
} from 'lucide-react';
import type { BlockRevision, BlockState } from '@/app/core/blockEngine';
import { BLOCK_TYPE_LABELS } from '@/app/core/blockEngine';
import {
  interpretRequest,
  applyPatchPlan,
  QUICK_COMMANDS,
  PATCH_SCOPE_LABELS,
  type PatchPlan,
  type PatchScope,
  type PatchTarget,
  type BatchApplyResult,
  type SkippedBlock,
} from '@/app/core/copilotEngine';
import type { AIAction } from '@/app/core/aiAssistEngine';
import { AI_ACTION_LABELS } from '@/app/core/aiAssistEngine';

// ════════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════════

type Step = 'idle' | 'interpreting' | 'plan_ready' | 'applying' | 'review';

const QUICK_ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  wrench:   Wrench,
  zap:      Zap,
  expand:   Expand,
  minimize: Minimize2,
  link:     Link2,
  mail:     Mail,
};

const ACTION_COLORS: Record<AIAction, string> = {
  ai_improve:  '#8B5CF6',
  ai_expand:   '#06D7F6',
  ai_simplify: '#F59E0B',
  fix_issues:  '#FB923C',
};

// ════════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ════════════════════════════════════════════════════════════════════════════════

function ActionBadge({ action }: { action: AIAction }) {
  const color = ACTION_COLORS[action];
  return (
    <span
      className="text-[7px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full flex-shrink-0"
      style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}
    >
      {AI_ACTION_LABELS[action]}
    </span>
  );
}

function BlockTypeBadge({ blockType }: { blockType: string }) {
  return (
    <span
      className="text-[7px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded flex-shrink-0"
      style={{ background: '#ffffff10', color: '#9CA3AF' }}
    >
      {BLOCK_TYPE_LABELS[blockType as any] ?? blockType}
    </span>
  );
}

function ROIRecalcBanner() {
  return (
    <div
      className="flex items-start gap-2.5 px-3 py-3 rounded-xl border text-[9px]"
      style={{ background: '#F59E0B08', borderColor: '#F59E0B40' }}
    >
      <ShieldAlert className="size-4 text-[#F59E0B] flex-shrink-0 mt-0.5" />
      <div>
        <div className="font-bold text-[#F59E0B] mb-0.5">ROI Recalc Required</div>
        <div className="text-gray-500 leading-relaxed">
          This patch touches solution or timeline blocks. The ROI engine should be
          re-run before proceeding to the proposal gate. Numbers in the ROI
          Snapshot block are <strong className="text-gray-400">not</strong> changed
          by this patch — only narrative content is updated.
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// STEP 1 — IDLE
// ════════════════════════════════════════════════════════════════════════════════

function IdleStep({
  userInput,
  scope,
  onUserInput,
  onScope,
  onInterpret,
  onQuickCommand,
}: {
  userInput:       string;
  scope:           PatchScope;
  onUserInput:     (v: string) => void;
  onScope:         (s: PatchScope) => void;
  onInterpret:     () => void;
  onQuickCommand:  (input: string, scope: PatchScope) => void;
}) {
  const scopes: PatchScope[] = ['current_page', 'whole_proposal', 'full_engagement'];
  const canInterpret = userInput.trim().length >= 10;

  return (
    <div className="space-y-4">
      {/* Context scope selector */}
      <div>
        <label className="text-[8px] font-bold uppercase tracking-widest text-gray-700 block mb-1.5">
          Context Scope
        </label>
        <div className="flex gap-1.5 flex-wrap">
          {scopes.map(s => (
            <button
              key={s}
              onClick={() => onScope(s)}
              className="px-2.5 py-1.5 rounded-lg text-[9px] font-bold border transition-colors"
              style={{
                borderColor: scope === s ? '#06D7F650' : '#ffffff10',
                background:  scope === s ? '#06D7F615' : 'transparent',
                color:       scope === s ? '#06D7F6'   : '#6B7280',
              }}
            >
              {PATCH_SCOPE_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Quick command chips */}
      <div>
        <label className="text-[8px] font-bold uppercase tracking-widest text-gray-700 block mb-1.5">
          Quick Commands
        </label>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_COMMANDS.map(cmd => {
            const Icon = QUICK_ICON_MAP[cmd.icon] ?? Zap;
            return (
              <button
                key={cmd.label}
                onClick={() => onQuickCommand(cmd.input, cmd.scope)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[9px] font-bold border transition-colors"
                style={{
                  background:  `${cmd.color}0F`,
                  borderColor: `${cmd.color}30`,
                  color:        cmd.color,
                }}
              >
                <Icon className="size-2.5" />
                {cmd.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Input */}
      <div>
        <label className="text-[8px] font-bold uppercase tracking-widest text-gray-700 block mb-1.5">
          What do you want to change?
        </label>
        <textarea
          value={userInput}
          onChange={e => onUserInput(e.target.value)}
          placeholder="e.g. Rewrite all solution blocks in boardroom tone and add integration points…"
          rows={4}
          className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white resize-none focus:outline-none focus:border-[#06D7F6]/50 placeholder:text-gray-700 leading-relaxed"
        />
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[8px] text-gray-800">Min 10 characters · No silent edits</span>
          <span className="text-[8px]" style={{ color: canInterpret ? '#10B981' : '#6B7280' }}>
            {userInput.length} chars
          </span>
        </div>
      </div>

      {/* Interpret button */}
      <button
        onClick={onInterpret}
        disabled={!canInterpret}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[11px] font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          background:   canInterpret ? 'linear-gradient(135deg, #06D7F620, #8B5CF620)' : '#ffffff08',
          border:       canInterpret ? '1px solid #06D7F640'                           : '1px solid #ffffff10',
          color:        canInterpret ? '#06D7F6'                                        : '#6B7280',
        }}
      >
        <Sparkles className="size-4" />
        Interpret Request
        <ChevronRight className="size-3 ml-auto" />
      </button>

      {/* Safety footer */}
      <div className="flex items-start gap-1.5 text-[8px] text-gray-800 leading-relaxed">
        <Info className="size-3 flex-shrink-0 mt-0.5" />
        Copilot generates a <strong className="text-gray-600">patch plan first</strong> — no edits are applied until you review and approve. All changes become pending revisions.
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// STEP 2 — PLAN READY
// ════════════════════════════════════════════════════════════════════════════════

function PlanReadyStep({
  plan,
  onApply,
  onCancel,
}: {
  plan:     PatchPlan;
  onApply:  () => void;
  onCancel: () => void;
}) {
  const [showSkipped, setShowSkipped] = useState(false);

  return (
    <div className="space-y-4">
      {/* Plan header */}
      <div
        className="flex items-start gap-3 px-4 py-3 rounded-xl border"
        style={{ background: '#06D7F608', borderColor: '#06D7F630' }}
      >
        <ListChecks className="size-4 text-[#06D7F6] flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold text-[#06D7F6] mb-0.5">Patch Plan Ready</div>
          <div className="text-[9px] text-gray-500">
            <span className="font-mono text-gray-600">{plan.patch_id}</span>
            {' · '}{plan.intent_label}
          </div>
          <div className="text-[8px] text-gray-700 mt-0.5 italic">"{plan.user_input.slice(0, 80)}{plan.user_input.length > 80 ? '…' : ''}"</div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-base font-black text-white">{plan.targets.length}</div>
          <div className="text-[7px] text-gray-700 uppercase tracking-wide">targets</div>
        </div>
      </div>

      {/* ROI recalc warning */}
      {plan.roi_recalc_required && <ROIRecalcBanner />}

      {/* Targets list */}
      <div>
        <div className="text-[8px] font-bold uppercase tracking-widest text-gray-700 mb-2">
          Planned Changes ({plan.targets.length})
        </div>
        {plan.targets.length === 0 ? (
          <div className="text-center py-6 text-[10px] text-gray-700">
            No targetable blocks found for this request.
          </div>
        ) : (
          <div className="space-y-1.5">
            {plan.targets.map(t => (
              <div
                key={t.block_id}
                className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border"
                style={{ background: '#ffffff04', borderColor: '#ffffff08' }}
              >
                <ChevronRight className="size-3 text-[#06D7F6] flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                    <BlockTypeBadge blockType={t.block_type} />
                    <ActionBadge action={t.action} />
                  </div>
                  <div className="text-[10px] font-bold text-white truncate">{t.title}</div>
                  <div className="text-[8px] text-gray-600 mt-0.5">{t.rationale}</div>
                </div>
                <span className="text-[7px] font-mono text-gray-800 flex-shrink-0 mt-0.5">{t.block_id}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Skipped blocks (collapsible) */}
      {plan.skipped.length > 0 && (
        <div>
          <button
            onClick={() => setShowSkipped(s => !s)}
            className="flex items-center gap-1.5 text-[8px] text-gray-700 hover:text-gray-500 transition-colors"
          >
            {showSkipped ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            {plan.skipped.length} blocks skipped
          </button>
          {showSkipped && (
            <div className="mt-1.5 space-y-0.5">
              {plan.skipped.map(s => (
                <div key={s.block_id} className="flex items-start gap-2 px-2 py-1.5 rounded text-[8px]" style={{ background: '#ffffff04' }}>
                  <XCircle className="size-3 text-gray-700 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="text-gray-500">{s.title}</span>
                    <span className="text-gray-800 ml-1.5">— {s.reason}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Global constraints notice */}
      <div className="flex items-start gap-1.5 text-[8px] text-gray-800 leading-relaxed">
        <Info className="size-3 flex-shrink-0 mt-0.5" />
        <span>
          All patches respect: <strong className="text-gray-600">no ROI number changes</strong> ·
          {' '}<strong className="text-gray-600">no invented facts</strong> ·
          {' '}<strong className="text-gray-600">no guarantee language</strong> ·
          boardroom tone enforced.
        </span>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={onApply}
          disabled={plan.targets.length === 0}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[11px] font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: plan.targets.length > 0 ? '#10B98120' : '#ffffff08',
            border:     plan.targets.length > 0 ? '1px solid #10B98140' : '1px solid #ffffff10',
            color:      plan.targets.length > 0 ? '#10B981' : '#6B7280',
          }}
        >
          <Zap className="size-3.5" />
          Apply {plan.targets.length} Patch{plan.targets.length !== 1 ? 'es' : ''}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-3 rounded-xl text-[11px] font-bold border border-white/10 text-gray-600 hover:text-white hover:border-white/20 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// STEP 3 — REVIEW QUEUE
// ════════════════════════════════════════════════════════════════════════════════

function ReviewQueueStep({
  batchResult,
  onAcceptRevision,
  onRejectRevision,
  onReset,
}: {
  batchResult:       BatchApplyResult;
  onAcceptRevision:  (blockId: string, revisionId: string) => void;
  onRejectRevision:  (blockId: string, revisionId: string) => void;
  onReset:           () => void;
}) {
  const [selected,    setSelected]    = useState<Set<string>>(new Set());
  const [actedUpon,   setActedUpon]   = useState<Map<string, 'accepted' | 'rejected'>>(new Map());

  const pending = batchResult.applied.filter(
    a => !actedUpon.has(a.revision.revision_id),
  );

  function markActed(revisionId: string, status: 'accepted' | 'rejected') {
    setActedUpon(prev => new Map(prev).set(revisionId, status));
    setSelected(prev => { const s = new Set(prev); s.delete(revisionId); return s; });
  }

  function doAccept(blockId: string, revisionId: string) {
    onAcceptRevision(blockId, revisionId);
    markActed(revisionId, 'accepted');
  }

  function doReject(blockId: string, revisionId: string) {
    onRejectRevision(blockId, revisionId);
    markActed(revisionId, 'rejected');
  }

  function acceptAll() {
    pending.forEach(a => doAccept(a.revision.block_id, a.revision.revision_id));
  }

  function rejectAll() {
    pending.forEach(a => doReject(a.revision.block_id, a.revision.revision_id));
  }

  function acceptSelected() {
    pending
      .filter(a => selected.has(a.revision.revision_id))
      .forEach(a => doAccept(a.revision.block_id, a.revision.revision_id));
  }

  function toggleSelect(revisionId: string) {
    setSelected(prev => {
      const s = new Set(prev);
      s.has(revisionId) ? s.delete(revisionId) : s.add(revisionId);
      return s;
    });
  }

  const acceptAllDisabled = batchResult.failed.length > 0 || pending.length === 0;
  const acceptedCount  = Array.from(actedUpon.values()).filter(v => v === 'accepted').length;
  const rejectedCount  = Array.from(actedUpon.values()).filter(v => v === 'rejected').length;
  const allDone = batchResult.applied.length > 0 && pending.length === 0;

  // Group by block_type
  const grouped = useMemo(() => {
    const map = new Map<string, typeof batchResult.applied>();
    for (const entry of batchResult.applied) {
      const bt = entry.target.block_type;
      if (!map.has(bt)) map.set(bt, []);
      map.get(bt)!.push(entry);
    }
    return map;
  }, [batchResult.applied]);

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div
        className="flex items-center gap-3 px-4 py-3 rounded-xl border"
        style={{ background: allDone ? '#10B98108' : '#06D7F608', borderColor: allDone ? '#10B98130' : '#06D7F630' }}
      >
        {allDone
          ? <CheckCircle2 className="size-4 text-[#10B981] flex-shrink-0" />
          : <ListChecks   className="size-4 text-[#06D7F6] flex-shrink-0" />
        }
        <div className="flex-1">
          <div className="text-[10px] font-bold" style={{ color: allDone ? '#10B981' : '#06D7F6' }}>
            {allDone ? 'Review Complete' : 'Review Queue'}
          </div>
          <div className="text-[8px] text-gray-600 mt-0.5">
            {batchResult.applied.length} applied · {batchResult.failed.length} failed ·{' '}
            {acceptedCount} accepted · {rejectedCount} rejected · {pending.length} pending
            <span className="ml-2 font-mono text-gray-800">{batchResult.patch_id}</span>
          </div>
        </div>
      </div>

      {/* ROI recalc */}
      {batchResult.roi_recalc_required && <ROIRecalcBanner />}

      {/* Failures */}
      {batchResult.failed.length > 0 && (
        <div
          className="px-3 py-2.5 rounded-xl border space-y-1"
          style={{ background: '#FD443808', borderColor: '#FD443830' }}
        >
          <div className="text-[8px] font-bold text-[#FD4438] flex items-center gap-1.5 mb-1">
            <AlertCircle className="size-3" />
            {batchResult.failed.length} patch{batchResult.failed.length !== 1 ? 'es' : ''} failed
          </div>
          {batchResult.failed.map((f, i) => (
            <div key={i} className="text-[8px] text-gray-600 pl-4">
              <span className="text-gray-400 font-bold">{f.target.title}</span>: {f.error}
            </div>
          ))}
          <div className="text-[7px] text-gray-800 pt-1">
            Accept All is disabled when failures exist. Review and accept individually.
          </div>
        </div>
      )}

      {/* Bulk action bar */}
      {pending.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={acceptAll}
            disabled={acceptAllDisabled}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[9px] font-bold border transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ background: '#10B98115', borderColor: '#10B98140', color: '#10B981' }}
            title={batchResult.failed.length > 0 ? 'Disabled: batch has failures' : 'Accept all pending revisions'}
          >
            <Check className="size-3" />Accept All
          </button>
          <button
            onClick={acceptSelected}
            disabled={selected.size === 0}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[9px] font-bold border border-white/10 text-gray-500 hover:text-white hover:border-white/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <CheckSquare className="size-3" />Accept Selected ({selected.size})
          </button>
          <button
            onClick={rejectAll}
            disabled={pending.length === 0}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[9px] font-bold border transition-colors disabled:opacity-30"
            style={{ background: '#FD443812', borderColor: '#FD443840', color: '#FD4438' }}
          >
            <X className="size-3" />Reject All
          </button>
        </div>
      )}

      {/* Revisions grouped by block_type */}
      <div className="space-y-3">
        {Array.from(grouped.entries()).map(([blockType, entries]) => (
          <div key={blockType}>
            <div className="text-[8px] font-black uppercase tracking-widest text-gray-700 mb-1.5 flex items-center gap-1">
              <span
                className="size-1.5 rounded-full inline-block"
                style={{ background: '#9CA3AF' }}
              />
              {BLOCK_TYPE_LABELS[blockType as any] ?? blockType}
              <span className="ml-1 text-gray-800">({entries.length})</span>
            </div>
            <div className="space-y-1.5">
              {entries.map(({ target, revision }) => {
                const status = actedUpon.get(revision.revision_id);
                const isPending = !status;
                const isSelected = selected.has(revision.revision_id);

                return (
                  <div
                    key={revision.revision_id}
                    className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border transition-all"
                    style={{
                      borderColor: status === 'accepted' ? '#10B98130'
                        : status === 'rejected'          ? '#FD443830'
                        : isSelected                     ? '#06D7F630'
                        : '#ffffff08',
                      background:  status === 'accepted' ? '#10B98108'
                        : status === 'rejected'          ? '#FD443808'
                        : isSelected                     ? '#06D7F608'
                        : '#ffffff03',
                    }}
                  >
                    {/* Checkbox */}
                    {isPending && (
                      <button
                        onClick={() => toggleSelect(revision.revision_id)}
                        className="flex-shrink-0 mt-0.5 text-gray-700 hover:text-[#06D7F6] transition-colors"
                      >
                        {isSelected
                          ? <CheckSquare className="size-3.5 text-[#06D7F6]" />
                          : <Square      className="size-3.5" />
                        }
                      </button>
                    )}
                    {status === 'accepted' && <CheckCircle2 className="size-3.5 text-[#10B981] flex-shrink-0 mt-0.5" />}
                    {status === 'rejected' && <XCircle      className="size-3.5 text-[#FD4438] flex-shrink-0 mt-0.5" />}

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        <ActionBadge action={target.action} />
                        <span className="text-[9px] font-bold text-white truncate">{target.title}</span>
                      </div>
                      <div className="text-[8px] text-gray-600 leading-relaxed">{revision.diff_summary}</div>
                      <div className="text-[7px] text-gray-800 font-mono mt-0.5">{revision.revision_id}</div>
                    </div>

                    {/* Per-item action buttons */}
                    {isPending && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => doAccept(revision.block_id, revision.revision_id)}
                          className="flex items-center gap-0.5 px-2 py-1 rounded text-[8px] font-bold transition-colors"
                          style={{ background: '#10B98118', color: '#10B981' }}
                          title="Accept this revision"
                        >
                          <CheckCircle2 className="size-2.5" />OK
                        </button>
                        <button
                          onClick={() => doReject(revision.block_id, revision.revision_id)}
                          className="flex items-center gap-0.5 px-2 py-1 rounded text-[8px] font-bold transition-colors"
                          style={{ background: '#FD443812', color: '#FD4438' }}
                          title="Reject this revision"
                        >
                          <XCircle className="size-2.5" />No
                        </button>
                      </div>
                    )}
                    {status && (
                      <span
                        className="text-[7px] font-black uppercase tracking-wide flex-shrink-0"
                        style={{ color: status === 'accepted' ? '#10B981' : '#FD4438' }}
                      >
                        {status}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* New request button */}
      <button
        onClick={onReset}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-bold border border-white/10 text-gray-600 hover:text-white hover:border-white/20 transition-colors"
      >
        <RefreshCw className="size-3" />New Request
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// APPLYING STEP
// ════════════════════════════════════════════════════════════════════════════════

function ApplyingStep({
  completed,
  total,
  currentTitle,
}: {
  completed:    number;
  total:        number;
  currentTitle: string;
}) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center justify-center">
        <div className="relative size-16">
          <svg className="size-16 -rotate-90" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="28" fill="none" stroke="#ffffff10" strokeWidth="4" />
            <circle
              cx="32" cy="32" r="28"
              fill="none"
              stroke="#06D7F6"
              strokeWidth="4"
              strokeDasharray={`${2 * Math.PI * 28}`}
              strokeDashoffset={`${2 * Math.PI * 28 * (1 - pct / 100)}`}
              strokeLinecap="round"
              className="transition-all duration-500"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm font-black text-white">{pct}%</span>
          </div>
        </div>
      </div>
      <div className="text-center space-y-1">
        <div className="text-xs font-bold text-white">Applying Patches…</div>
        <div className="text-[9px] text-gray-600">
          {completed} of {total} complete
        </div>
        {currentTitle && (
          <div className="text-[8px] text-gray-700 italic truncate px-4">
            Processing: "{currentTitle}"
          </div>
        )}
      </div>
      <div className="text-[8px] text-gray-800 text-center">
        Each patch creates a pending revision — no silent edits.
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// INTERPRETING STEP
// ════════════════════════════════════════════════════════════════════════════════

function InterpretingStep({ userInput }: { userInput: string }) {
  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center justify-center">
        <div className="relative">
          <Bot className="size-12 text-[#06D7F6]" />
          <Loader2 className="size-5 text-[#06D7F6] animate-spin absolute -bottom-1 -right-1" />
        </div>
      </div>
      <div className="text-center space-y-1">
        <div className="text-xs font-bold text-white">Interpreting Request…</div>
        <div className="text-[8px] text-gray-700 italic px-4 line-clamp-2">
          "{userInput}"
        </div>
      </div>
      <div className="text-[8px] text-gray-800 text-center">
        Identifying intent · Selecting target blocks · Checking guardrails
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT — COPILOT PANEL
// ════════════════════════════════════════════════════════════════════════════════

export interface CopilotPanelProps {
  proposalId:       string;
  allStates:        BlockState[];
  onRevisionsBatch: (revisions: BlockRevision[]) => void;
  onAcceptRevision: (blockId: string, revisionId: string) => void;
  onRejectRevision: (blockId: string, revisionId: string) => void;
  onClose:          () => void;
}

export function CopilotPanel({
  proposalId,
  allStates,
  onRevisionsBatch,
  onAcceptRevision,
  onRejectRevision,
  onClose,
}: CopilotPanelProps) {
  const [step,          setStep]          = useState<Step>('idle');
  const [userInput,     setUserInput]     = useState('');
  const [scope,         setScope]         = useState<PatchScope>('whole_proposal');
  const [plan,          setPlan]          = useState<PatchPlan | null>(null);
  const [batchResult,   setBatchResult]   = useState<BatchApplyResult | null>(null);
  const [error,         setError]         = useState<string | null>(null);
  const [progress,      setProgress]      = useState({ completed: 0, total: 0, currentTitle: '' });

  // ── Step 1: Interpret ────────────────────────────────────────────────────
  async function handleInterpret() {
    if (userInput.trim().length < 10) return;
    setStep('interpreting');
    setError(null);
    try {
      const newPlan = await interpretRequest(
        userInput, scope, proposalId, allStates,
        { company: 'Vesper Dynamics', industry: 'SaaS / Revenue Tech' },
      );
      setPlan(newPlan);
      setStep('plan_ready');
    } catch (err: any) {
      setError(err?.message ?? String(err));
      setStep('idle');
    }
  }

  // ── Step 2: Apply ────────────────────────────────────────────────────────
  async function handleApply() {
    if (!plan) return;
    setStep('applying');
    setProgress({ completed: 0, total: plan.targets.length, currentTitle: '' });
    setError(null);

    try {
      const result = await applyPatchPlan(
        plan,
        allStates,
        (completed, total, currentTitle) => {
          setProgress({ completed, total, currentTitle });
        },
      );

      // Push all new pending revisions into BlockRegistryPanel state
      const newRevisions = result.applied.map(a => a.revision);
      if (newRevisions.length > 0) {
        onRevisionsBatch(newRevisions);
      }

      setBatchResult(result);
      setStep('review');
    } catch (err: any) {
      setError(err?.message ?? String(err));
      setStep('plan_ready');
    }
  }

  // ── Quick command ────────────────────────────────────────────────────────
  function handleQuickCommand(input: string, cmdScope: PatchScope) {
    setUserInput(input);
    setScope(cmdScope);
  }

  // ── Reset ────────────────────────────────────────────────────────────────
  function handleReset() {
    setStep('idle');
    setUserInput('');
    setPlan(null);
    setBatchResult(null);
    setError(null);
    setProgress({ completed: 0, total: 0, currentTitle: '' });
  }

  // ── Step label ───────────────────────────────────────────────────────────
  const stepLabels: Record<Step, string> = {
    idle:          '1 · Request',
    interpreting:  '2 · Interpreting',
    plan_ready:    '2 · Review Plan',
    applying:      '3 · Applying',
    review:        '3 · Review Queue',
  };

  return (
    <span className="contents">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed top-0 right-0 h-full z-50 flex flex-col"
        style={{
          width: 'min(480px, 100vw)',
          background: '#0D0D1E',
          borderLeft: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '-16px 0 60px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-5 py-4 border-b border-white/5 flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #06D7F608, #8B5CF608)' }}
        >
          <Bot className="size-5 text-[#06D7F6] flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-black text-white tracking-tight">CORTEX Copilot</div>
            <div className="text-[8px] text-gray-600 uppercase tracking-widest">
              Global Patch Engine · {stepLabels[step]}
            </div>
          </div>
          <span
            className="text-[7px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full border flex-shrink-0"
            style={{ color: '#06D7F6', borderColor: '#06D7F640', background: '#06D7F610' }}
          >
            Phase C
          </span>
          <button
            onClick={onClose}
            className="flex-shrink-0 text-gray-600 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/5"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <div
            className="flex items-start gap-2 mx-4 mt-3 px-3 py-2.5 rounded-xl border text-[9px] flex-shrink-0"
            style={{ background: '#FD443810', borderColor: '#FD443840' }}
          >
            <TriangleAlert className="size-3.5 text-[#FD4438] flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-gray-400">
              <span className="font-bold text-[#FD4438]">Error: </span>{error}
            </div>
            <button onClick={() => setError(null)} className="text-gray-600 hover:text-white">
              <X className="size-3" />
            </button>
          </div>
        )}

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-0">
          {step === 'idle' && (
            <IdleStep
              userInput={userInput}
              scope={scope}
              onUserInput={setUserInput}
              onScope={setScope}
              onInterpret={handleInterpret}
              onQuickCommand={handleQuickCommand}
            />
          )}

          {step === 'interpreting' && (
            <InterpretingStep userInput={userInput} />
          )}

          {step === 'plan_ready' && plan && (
            <PlanReadyStep
              plan={plan}
              onApply={handleApply}
              onCancel={handleReset}
            />
          )}

          {step === 'applying' && (
            <ApplyingStep
              completed={progress.completed}
              total={progress.total}
              currentTitle={progress.currentTitle}
            />
          )}

          {step === 'review' && batchResult && (
            <ReviewQueueStep
              batchResult={batchResult}
              onAcceptRevision={onAcceptRevision}
              onRejectRevision={onRejectRevision}
              onReset={handleReset}
            />
          )}
        </div>

        {/* Governance footer */}
        <div className="px-4 py-3 border-t border-white/5 flex-shrink-0">
          <div className="text-[7px] text-gray-800 leading-relaxed">
            No silent edits · Revisions never auto-applied · Full patch_id → revision audit trail ·
            Fact lock + coherence + jargon validators enforced on every revision.
          </div>
        </div>
      </div>
    </span>
  );
}
