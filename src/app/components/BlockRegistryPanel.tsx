/**
 * BLOCK REGISTRY PANEL — editable-blocks-schema.json §7 + §8
 *
 * Full registry view for all blocks linked to a proposal.
 * Includes:
 *   §7  EditableBlockCard for each block
 *   §8  Ready Gate strip — required blocks + approval state
 *   §4  Revision accept / reject callbacks wired to blockEngine
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Layers, Filter, CheckCircle2, XCircle, ShieldCheck, ShieldX,
  RefreshCw, Info, Bot, AlertTriangle, Save, Loader2, Cloud,
} from 'lucide-react';
import {
  BLOCK_STORE,
  REVISION_STORE,
  LINK_STORE,
  LOCK_STORE,
  getBlocksByProposal,
  acceptRevision,
  rejectRevision,
  approveBlock,
  createRevision,
  checkBlocksReadyGate,
  BLOCK_TYPE_LABELS,
  type Block,
  type BlockRevision,
  type BlockLink,
  type BlockLock,
  type BlockState,
  type BlockType,
  type BlockStatus,
  type BlocksGateResult,
} from '@/app/core/blockEngine';
import { EditableBlockCard } from './EditableBlockCard';
import { BlockHistoryPanel } from './BlockHistoryPanel';
import { CopilotPanel } from './CopilotPanel';
import { RoleSwitcher } from './RoleSwitcher';
import { useApp } from '@/app/contexts/AppContext';
import { getBlockRegistry, saveBlockRegistry } from '@/app/services/dataService';
import { isBackendEnabled } from '@/config/runtime';
import {
  proposalBlockIdSet,
  extractProposalSubset,
  mergeProposalSubset,
} from '@/app/core/blockRegistrySync';
import {
  callBlockAIAssist,
  assembleAIContext,
  type AIAction,
} from '@/app/core/aiAssistEngine';
import type { UserRole } from '@/app/core/roleEngine';
import { canUseCopilot } from '@/app/core/roleEngine';
import {
  computeChangeImpact,
  type ChangeImpact,
} from '@/app/core/changeImpactEngine';
import {
  runConsistencyValidator,
  type ConsistencyResult,
} from '@/app/core/consistencyValidator';

// ════════════════════════════════════════════════════════════════════════════════
// FILTER TYPES
// ════════════════════════════════════════════════════════════════════════════════

type StatusFilter = 'all' | BlockStatus;

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string; color: string }[] = [
  { value: 'all',      label: 'All',      color: '#9CA3AF' },
  { value: 'draft',    label: 'Draft',    color: '#8B5CF6' },
  { value: 'approved', label: 'Approved', color: '#10B981' },
  { value: 'locked',   label: 'Locked',   color: '#70707C' },
];

// ════════════════════════════════════════════════════════════════════════════════
// READY GATE STRIP — spec §8
// ════════════════════════════════════════════════════════════════════════════════

function ReadyGateStrip({ result }: { result: BlocksGateResult }) {
  const Icon = result.passed ? ShieldCheck : ShieldX;
  const accentColor = result.passed ? '#10B981' : '#F59E0B';

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        borderColor: `${accentColor}30`,
        background:  `${accentColor}06`,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/5">
        <Icon className="size-4 flex-shrink-0" style={{ color: accentColor }} />
        <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: accentColor }}>
          Blocks Ready Gate
        </span>
        <span
          className="text-[8px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide"
          style={{
            background:  result.passed ? '#10B98120' : '#F59E0B20',
            color:       result.passed ? '#10B981'   : '#F59E0B',
          }}
        >
          {result.passed ? 'Cleared' : 'Blocked'}
        </span>
        <span className="ml-auto text-[9px] text-gray-600">{result.summary}</span>
      </div>

      {/* Requirements */}
      <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
        {result.requirements.map(req => (
          <div
            key={req.block_type}
            className="flex flex-col gap-1 px-3 py-2.5 rounded-xl border"
            style={{
              borderColor: req.passed ? '#10B98130' : '#FD443830',
              background:  req.passed ? '#10B98108' : '#FD443808',
            }}
          >
            <div className="flex items-center gap-1.5">
              {req.passed
                ? <CheckCircle2 className="size-3 text-[#10B981] flex-shrink-0" />
                : <XCircle      className="size-3 text-[#FD4438] flex-shrink-0" />
              }
              <span
                className="text-[8px] font-bold"
                style={{ color: req.passed ? '#10B981' : '#FD4438' }}
              >
                {req.passed ? 'Pass' : 'Fail'}
              </span>
            </div>
            <div className="text-[9px] text-gray-500 font-medium leading-tight">{req.label}</div>
            <div className="text-[8px] text-gray-700">
              {req.approved} / {req.min_count} approved
              {req.total > req.approved && ` (${req.total - req.approved} not yet)`}
            </div>
          </div>
        ))}
      </div>

      {!result.passed && (
        <div className="px-4 pb-3 text-[8px] text-gray-700 flex items-start gap-1.5">
          <Info className="size-3 flex-shrink-0 mt-0.5 text-gray-600" />
          Approve all required blocks above to clear this gate. Later phases (timeline / team / governance) add additional requirements.
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// CHANGE IMPACT BANNER — phase-p1-implementation.md §2
// ════════════════════════════════════════════════════════════════════════════════

function ImpactBanner({ impact, onDismiss }: { impact: ChangeImpact; onDismiss: () => void }) {
  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ background: '#F59E0B08', borderColor: '#F59E0B40' }}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <AlertTriangle className="size-4 text-[#F59E0B] flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold text-[#F59E0B] mb-0.5">Change Impact Detected</div>
          <div className="text-[9px] text-gray-500 leading-relaxed">{impact.trigger_reason}</div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {impact.roi_recalc_required && (
              <span className="text-[8px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#F59E0B20', color: '#F59E0B' }}>
                ROI Recalc Required
              </span>
            )}
            {impact.contract_invalidated && (
              <span className="text-[8px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#FD443820', color: '#FD4438' }}>
                Contract Invalidated
              </span>
            )}
            {impact.export_blocked && (
              <span className="text-[8px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#6B728020', color: '#9CA3AF' }}>
                Export Blocked
              </span>
            )}
            {impact.proposal_auto_draft && (
              <span className="text-[8px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#8B5CF620', color: '#8B5CF6' }}>
                Proposal → Draft
              </span>
            )}
          </div>
          <div className="text-[8px] text-gray-800 mt-1.5">
            Revalidation path: re-run ROI engine → pass Consistency Validator → ready_to_send.
          </div>
        </div>
        <button onClick={onDismiss} className="flex-shrink-0 text-gray-700 hover:text-white transition-colors">
          <XCircle className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// CONSISTENCY PANEL — phase-p1-implementation.md §3
// ════════════════════════════════════════════════════════════════════════════════

function ConsistencyPanel({
  result,
  onClose,
}: {
  result:  ConsistencyResult;
  onClose: () => void;
}) {
  const sectionColors: Record<string, string> = {
    structural: '#06D7F6',
    financial:  '#10B981',
    narrative:  '#8B5CF6',
  };

  const sectionIcons: Record<string, React.FC<{ className?: string }>> = {
    structural: ShieldCheck,
    financial:  CheckCircle2,
    narrative:  Info,
  };

  const overallColor = result.validation_passed ? '#10B981' : '#FD4438';
  const Icon = result.validation_passed ? ShieldCheck : ShieldX;

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ background: `${overallColor}06`, borderColor: `${overallColor}30` }}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/5">
        <Icon className="size-4 flex-shrink-0" style={{ color: overallColor }} />
        <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: overallColor }}>
          Consistency Validator
        </span>
        <span
          className="text-[8px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide"
          style={{ background: `${overallColor}20`, color: overallColor }}
        >
          {result.validation_passed ? 'Passed' : `${result.errors.length} Error${result.errors.length !== 1 ? 's' : ''}`}
        </span>
        <span className="ml-auto text-[8px] text-gray-700 font-mono">
          {new Date(result.run_at).toLocaleTimeString()} · {result.block_count} blocks
        </span>
        <button onClick={onClose} className="text-gray-700 hover:text-white transition-colors">
          <XCircle className="size-3.5" />
        </button>
      </div>

      {/* Section summary row */}
      <div className="grid grid-cols-3 divide-x divide-white/5 border-b border-white/5">
        {(['structural', 'financial', 'narrative'] as const).map(s => {
          const passed = result.summary[s];
          const color  = sectionColors[s];
          const Ic     = sectionIcons[s];
          return (
            <div key={s} className="flex flex-col items-center gap-0.5 py-2">
              <div className="flex items-center gap-1">
                <Ic className="size-3 flex-shrink-0" style={{ color: passed ? color : '#FD4438' }} />
                <span className="text-[9px] font-bold" style={{ color: passed ? color : '#FD4438' }}>
                  {passed ? 'Pass' : 'Fail'}
                </span>
              </div>
              <span className="text-[8px] text-gray-700 capitalize">{s}</span>
            </div>
          );
        })}
      </div>

      {/* Errors */}
      {result.errors.length > 0 && (
        <div className="px-4 py-3 space-y-1.5">
          {result.errors.map((err, i) => (
            <div key={i} className="flex items-start gap-2 text-[9px]">
              <XCircle className="size-3 text-[#FD4438] flex-shrink-0 mt-0.5" />
              <div>
                <span
                  className="text-[7px] font-bold uppercase tracking-wide mr-1.5 px-1 py-0.5 rounded"
                  style={{
                    background: `${sectionColors[err.section]}20`,
                    color:       sectionColors[err.section],
                  }}
                >
                  {err.section} · {err.type.replace(/_/g, ' ')}
                </span>
                <span className="text-gray-500">{err.message}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div className="px-4 pb-3 space-y-1">
          <div className="text-[8px] font-bold text-gray-700 uppercase tracking-wide">Warnings</div>
          {result.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-[9px]">
              <AlertTriangle className="size-3 text-[#F59E0B] flex-shrink-0 mt-0.5" />
              <span className="text-gray-600">{w.message}</span>
            </div>
          ))}
        </div>
      )}

      {result.validation_passed && (
        <div className="px-4 pb-3 flex items-center gap-2 text-[9px] text-[#10B981]">
          <CheckCircle2 className="size-3.5" />
          All consistency checks passed — proposal is eligible for ready_to_send status.
        </div>
      )}

      {!result.validation_passed && (
        <div className="px-4 pb-3 text-[8px] text-gray-800 flex items-start gap-1.5">
          <Info className="size-3 flex-shrink-0 mt-0.5" />
          Resolve all errors above before advancing proposal status. Export remains blocked.
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// SUMMARY COUNTS STRIP
// ════════════════════════════════════════════════════════════════════════════════

function SummaryStrip({ states }: { states: BlockState[] }) {
  const counts = {
    total:    states.length,
    draft:    states.filter(s => s.block.status === 'draft').length,
    approved: states.filter(s => s.block.status === 'approved').length,
    locked:   states.filter(s => s.block.status === 'locked').length,
    pending:  states.filter(s => !!s.pending_revision).length,
  };
  const metrics = [
    { label: 'Total Blocks', value: counts.total,    color: '#9CA3AF' },
    { label: 'Approved',     value: counts.approved, color: '#10B981' },
    { label: 'Draft',        value: counts.draft,    color: '#8B5CF6' },
    { label: 'Locked',       value: counts.locked,   color: '#70707C' },
    { label: 'Pending Rev.', value: counts.pending,  color: '#F59E0B' },
  ];
  return (
    <div className="flex items-stretch divide-x divide-white/5 bg-black/20 rounded-xl border border-white/8 overflow-hidden">
      {metrics.map(m => (
        <div key={m.label} className="flex-1 flex flex-col items-center py-3 gap-0.5">
          <span className="text-lg font-black" style={{ color: m.color }}>{m.value}</span>
          <span className="text-[8px] uppercase tracking-wide text-gray-700">{m.label}</span>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE FILTER PILL
// ════════════════════════════════════════════════════════════════════════════════

function TypePill({
  value, options, onChange,
}: {
  value:   string;
  options: Array<{ value: string; label: string }>;
  onChange:(v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[9px]">
      <span className="text-gray-700 uppercase tracking-wide font-bold">Type</span>
      <div className="flex items-center gap-1 px-2 py-1 rounded-lg border border-white/10 bg-white/[0.03]">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="bg-transparent text-[9px] font-bold outline-none cursor-pointer text-gray-400"
        >
          {options.map(o => (
            <option key={o.value} value={o.value} className="bg-[#0D0D18] text-white">
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// REGISTRY SAVE INDICATOR — reflects KV persistence state
// ════════════════════════════════════════════════════════════════════════════════

function RegistrySaveIndicator({
  persistEnabled, loading, status, rev,
}: {
  persistEnabled: boolean;
  loading:        boolean;
  status:         'idle' | 'saving' | 'saved' | 'error' | 'conflict';
  rev:            number | null;
}) {
  const pill = (color: string, label: React.ReactNode, title?: string) => (
    <span
      className="flex items-center gap-1 text-[8px] font-bold px-1.5 py-0.5 rounded-full border"
      style={{ color, borderColor: `${color}33`, background: `${color}14` }}
      title={title}
    >
      {label}
    </span>
  );

  if (!persistEnabled) {
    return pill('#6B7280', <><Cloud className="size-2.5" />Demo</>, 'Demo mode — changes are not persisted');
  }
  if (loading) return pill('#8B5CF6', <><Loader2 className="size-2.5 animate-spin" />Loading</>);
  if (status === 'saving') return pill('#8B5CF6', <><Loader2 className="size-2.5 animate-spin" />Saving</>);
  if (status === 'conflict') return pill('#F59E0B', <><AlertTriangle className="size-2.5" />Reloaded</>, 'Another session updated the registry — latest version reloaded');
  if (status === 'error') return pill('#FD4438', <><XCircle className="size-2.5" />Save failed</>);
  if (status === 'saved') return pill('#10B981', <><Save className="size-2.5" />Saved{rev != null ? ` · r${rev}` : ''}</>);
  return null;
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ════════════════════════════════════════════════════════════════════════════════

interface BlockRegistryPanelProps {
  proposalId:           string;
  onProposalDowngrade?: () => void;
}

export function BlockRegistryPanel({ proposalId, onProposalDowngrade }: BlockRegistryPanelProps) {
  const { teamAccessToken } = useApp();
  const accessToken = teamAccessToken ?? '';

  // ── Local copies of the four stores ────────────────────────────────────────
  // Seeded from the engine stores, then overlaid with the persisted snapshot.
  const [blocks,    setBlocks]    = useState<Block[]>(BLOCK_STORE);
  const [revisions, setRevisions] = useState<BlockRevision[]>(REVISION_STORE);
  const [links]                   = useState<BlockLink[]>(LINK_STORE);
  const [locks,     setLocks]     = useState<BlockLock[]>(LOCK_STORE);

  // ── KV persistence ──────────────────────────────────────────────────────────
  type RegSaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';
  const persistEnabled = Boolean(accessToken) && isBackendEnabled();
  const [regLoading, setRegLoading] = useState(persistEnabled);
  const [regStatus,  setRegStatus]  = useState<RegSaveStatus>('idle');
  const revRef        = useRef<number | null>(null); // last-known document revision
  const hasLoadedRef  = useRef(false);
  const saveTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // block_ids that belong to this proposal (membership is via links → static)
  const proposalIds = useMemo(() => proposalBlockIdSet(proposalId, links), [proposalId, links]);

  // Load the persisted snapshot on mount and overlay it onto the seed stores.
  useEffect(() => {
    let cancelled = false;
    if (!persistEnabled || !accessToken) { hasLoadedRef.current = true; setRegLoading(false); return; }
    setRegLoading(true);
    getBlockRegistry(proposalId, accessToken)
      .then((res) => {
        if (cancelled) return;
        if (res.registry) {
          const merged = mergeProposalSubset(
            proposalIds,
            { blocks: BLOCK_STORE, revisions: REVISION_STORE, locks: LOCK_STORE },
            { blocks: res.registry.blocks, revisions: res.registry.revisions, locks: res.registry.locks },
          );
          setBlocks(merged.blocks);
          setRevisions(merged.revisions);
          setLocks(merged.locks);
          revRef.current = res.registry.rev;
          setRegStatus('saved');
        }
      })
      .catch((err) => console.error('BlockRegistryPanel load error:', err))
      .finally(() => { if (!cancelled) { hasLoadedRef.current = true; setRegLoading(false); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalId, accessToken, persistEnabled]);

  // Persist this proposal's subset; reconciles on an optimistic-lock 409.
  const persistRegistry = useCallback(async (
    nextBlocks: Block[],
    nextRevisions: BlockRevision[],
    nextLocks: BlockLock[],
  ) => {
    if (!persistEnabled || !accessToken) return;
    const subset = extractProposalSubset(proposalIds, nextBlocks, nextRevisions, nextLocks);
    setRegStatus('saving');
    try {
      const res = await saveBlockRegistry(
        proposalId,
        { ...subset, baseRev: revRef.current ?? undefined },
        accessToken,
      );
      revRef.current = res.registry.rev;
      setRegStatus('saved');
    } catch (err: any) {
      if (err?.conflict) {
        // Another session advanced the registry — reload and let the user retry.
        setRegStatus('conflict');
        try {
          const res = await getBlockRegistry(proposalId, accessToken);
          if (res.registry) {
            const merged = mergeProposalSubset(
              proposalIds,
              { blocks: BLOCK_STORE, revisions: REVISION_STORE, locks: LOCK_STORE },
              { blocks: res.registry.blocks, revisions: res.registry.revisions, locks: res.registry.locks },
            );
            setBlocks(merged.blocks);
            setRevisions(merged.revisions);
            setLocks(merged.locks);
            revRef.current = res.registry.rev;
          }
        } catch { /* keep conflict status */ }
      } else {
        console.error('BlockRegistryPanel save error:', err);
        setRegStatus('error');
      }
    }
  }, [persistEnabled, accessToken, proposalId, proposalIds]);

  // Debounced autosave whenever blocks/revisions/locks change post-load.
  useEffect(() => {
    if (!persistEnabled || !hasLoadedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { void persistRegistry(blocks, revisions, locks); }, 1000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [blocks, revisions, locks, persistEnabled, persistRegistry]);

  // ── Filters ─────────────────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter,   setTypeFilter]   = useState<string>('all');
  const [historyBlockId, setHistoryBlockId] = useState<string | null>(null);
  const [copilotOpen,    setCopilotOpen]    = useState(false);

  // Phase P1: role, impact, consistency
  const [currentRole,        setCurrentRole]        = useState<UserRole>('admin');
  const [currentImpact,      setCurrentImpact]      = useState<ChangeImpact | null>(null);
  const [consistencyResult,  setConsistencyResult]  = useState<ConsistencyResult | null>(null);

  // ── All block states for this proposal ──────────────────────────────────────
  const allStates = useMemo(
    () => getBlocksByProposal(proposalId, blocks, revisions, links, locks),
    [blocks, revisions, links, locks, proposalId],
  );

  // ── Ready Gate (spec §8) ─────────────────────────────────────────────────────
  const gateResult = useMemo(() => checkBlocksReadyGate(allStates), [allStates]);

  // ── Type filter options (dynamic from loaded blocks) ─────────────────────────
  const typeOptions = useMemo(() => {
    const types = new Set(allStates.map(s => s.block.block_type));
    return [
      { value: 'all', label: 'All Types' },
      ...Array.from(types).map(t => ({ value: t, label: BLOCK_TYPE_LABELS[t] })),
    ];
  }, [allStates]);

  // ── Filtered states ──────────────────────────────────────────────────────────
  const filteredStates = useMemo(() => {
    return allStates.filter(s => {
      if (statusFilter !== 'all' && s.block.status !== statusFilter) return false;
      if (typeFilter   !== 'all' && s.block.block_type !== typeFilter) return false;
      return true;
    });
  }, [allStates, statusFilter, typeFilter]);

  // ── History panel ─────────────────────────────────────────────────────────────
  const historyState = useMemo(() => {
    if (!historyBlockId) return null;
    return allStates.find(s => s.block.block_id === historyBlockId) ?? null;
  }, [historyBlockId, allStates]);

  // ── Action handlers ──────────────────────────────────────────────────────────

  const handleEdit = useCallback((blockId: string, newContent: Record<string, unknown>, diffSummary: string) => {
    const block = blocks.find(b => b.block_id === blockId);
    if (!block) return;
    try {
      const newRevision = createRevision(block, revisions, locks, {
        change_type:      'edit',
        proposed_content: newContent,
        diff_summary:     diffSummary,
        created_by:       'U-01',
        created_by_type:  'human',
      });
      setRevisions(prev => [...prev, newRevision]);
    } catch (err: any) {
      alert(`Cannot propose revision: ${err.message}`);
    }
  }, [blocks, revisions, locks]);

  const handleAcceptRevision = useCallback((blockId: string, revisionId: string) => {
    const block    = blocks.find(b => b.block_id === blockId);
    const revision = revisions.find(r => r.revision_id === revisionId);
    if (!block || !revision) return;
    try {
      const { block: updatedBlock, revision: updatedRevision } = acceptRevision(block, revision, 'U-01');
      setBlocks(prev    => prev.map(b => b.block_id === blockId ? updatedBlock : b));
      setRevisions(prev => prev.map(r => r.revision_id === revisionId ? updatedRevision : r));

      // ── Change Impact Engine — phase-p1-implementation.md §2 ───────────
      const impact = computeChangeImpact(
        block.block_type,
        block.content,
        revision.proposed_content,
      );
      if (impact) {
        setCurrentImpact(impact);
        if (impact.proposal_auto_draft && onProposalDowngrade) {
          onProposalDowngrade();
        }
      }
    } catch (err: any) {
      alert(`Cannot accept revision: ${err.message}`);
    }
  }, [blocks, revisions, onProposalDowngrade]);

  const handleRejectRevision = useCallback((blockId: string, revisionId: string) => {
    const revision = revisions.find(r => r.revision_id === revisionId);
    if (!revision) return;
    try {
      const updatedRevision = rejectRevision(revision, 'U-01');
      setRevisions(prev => prev.map(r => r.revision_id === revisionId ? updatedRevision : r));
    } catch (err: any) {
      alert(`Cannot reject revision: ${err.message}`);
    }
  }, [revisions]);

  const handleApproveBlock = useCallback((blockId: string) => {
    const block = blocks.find(b => b.block_id === blockId);
    if (!block) return;
    try {
      const updated = approveBlock(block);
      setBlocks(prev => prev.map(b => b.block_id === blockId ? updated : b));
    } catch (err: any) {
      alert(`Cannot approve block: ${err.message}`);
    }
  }, [blocks]);

  // ── AI Assist handler — ai-assist-per-block.md ───────────────────────────
  const handleAIAssist = useCallback(async (blockId: string, action: AIAction) => {
    const blockState = allStates.find(s => s.block.block_id === blockId);
    if (!blockState) throw new Error(`Block ${blockId} not found`);

    // Check: only one pending revision per block (blockEngine §4)
    if (blockState.pending_revision) {
      throw new Error('Accept or reject the existing pending revision before requesting AI assistance.');
    }

    // Assemble context from sibling blocks (spec §2)
    const context = assembleAIContext(blockId, allStates);

    // Call AI — returns a pending BlockRevision
    const { revision } = await callBlockAIAssist(blockState, action, context, accessToken);

    // Append the pending revision to state — no auto-accept
    setRevisions(prev => [...prev, revision]);
  }, [allStates, accessToken]);

  // ── Copilot batch revisions — copilot-patch-plan.md ─────────────────────
  const handleRevisionsBatch = useCallback((newRevisions: BlockRevision[]) => {
    setRevisions(prev => [...prev, ...newRevisions]);
  }, []);

  // ── Run Consistency Validator — phase-p1-implementation.md §3 ───────────
  const handleRunConsistency = useCallback(() => {
    const result = runConsistencyValidator(allStates);
    setConsistencyResult(result);
  }, [allStates]);

  // ════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-4">
      {/* ── Panel header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <Layers className="size-4 text-[#06D7F6]" />
          <span className="text-sm font-bold text-white">Block Registry</span>
          <span
            className="text-[9px] px-1.5 py-0.5 rounded-full font-bold border uppercase tracking-wider"
            style={{ color: '#06D7F6', borderColor: '#06D7F633', background: '#06D7F614' }}
          >
            Foundation
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[9px] text-gray-700">
            {allStates.length} blocks · proposal {proposalId}
          </span>
          <RegistrySaveIndicator
            persistEnabled={persistEnabled}
            loading={regLoading}
            status={regStatus}
            rev={revRef.current}
          />
          {/* Role Switcher */}
          <RoleSwitcher currentRole={currentRole} onChange={setCurrentRole} />
          {/* Validate button */}
          <button
            onClick={handleRunConsistency}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[9px] font-bold border transition-colors"
            style={{ background: '#10B98110', borderColor: '#10B98130', color: '#10B981' }}
            title="Run Proposal Consistency Validator (phase-p1-implementation.md §3)"
          >
            <ShieldCheck className="size-3" />Validate
          </button>
          {/* Copilot toggle */}
          <button
            onClick={() => canUseCopilot(currentRole) && setCopilotOpen(o => !o)}
            disabled={!canUseCopilot(currentRole)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[9px] font-bold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background:  copilotOpen ? '#06D7F620' : '#06D7F60F',
              borderColor: copilotOpen ? '#06D7F650' : '#06D7F630',
              color:       '#06D7F6',
            }}
            title={canUseCopilot(currentRole) ? 'Open CORTEX Copilot' : 'Copilot requires Admin or Strategist role'}
          >
            <Bot className="size-3" />
            Copilot
          </button>
        </div>
      </div>

      {/* ── Change Impact Banner ─────────────────────────────────────────── */}
      {currentImpact && (
        <ImpactBanner impact={currentImpact} onDismiss={() => setCurrentImpact(null)} />
      )}

      {/* ── Consistency Result Panel ─────────────────────────────────────── */}
      {consistencyResult && (
        <ConsistencyPanel
          result={consistencyResult}
          onClose={() => setConsistencyResult(null)}
        />
      )}

      {/* ── Summary counts ────────────────────────────────────────────────── */}
      <SummaryStrip states={allStates} />

      {/* ── Ready Gate strip — spec §8 ───────────────────────────────────── */}
      <ReadyGateStrip result={gateResult} />

      {/* ── Filter bar ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-black/20 rounded-xl border border-white/5">
        <div className="flex items-center gap-1.5">
          <Filter className="size-3 text-gray-700" />
          <span className="text-[9px] font-bold text-gray-600 uppercase tracking-wide">Filter</span>
        </div>

        {/* Status pills */}
        <div className="flex items-center gap-1">
          {STATUS_FILTER_OPTIONS.map(o => (
            <button
              key={o.value}
              onClick={() => setStatusFilter(o.value)}
              className="px-2.5 py-1 rounded-lg text-[9px] font-bold border transition-colors"
              style={{
                borderColor: statusFilter === o.value ? `${o.color}50` : '#ffffff10',
                background:  statusFilter === o.value ? `${o.color}15` : 'transparent',
                color:       statusFilter === o.value ? o.color         : '#6B7280',
              }}
            >
              {o.label}
            </button>
          ))}
        </div>

        <div className="h-4 w-px bg-white/5" />

        <TypePill value={typeFilter} options={typeOptions} onChange={setTypeFilter} />

        <button
          onClick={() => { setStatusFilter('all'); setTypeFilter('all'); }}
          className="ml-auto flex items-center gap-1 text-[9px] text-gray-700 hover:text-white transition-colors"
        >
          <RefreshCw className="size-3" />Reset
        </button>
      </div>

      {/* ── Block list ────────────────────────────────────────────────────── */}
      <div className="space-y-2.5">
        {filteredStates.length === 0 ? (
          <div className="text-center py-10 text-[10px] text-gray-700">
            No blocks match current filters.
          </div>
        ) : (
          filteredStates.map(state => (
            <EditableBlockCard
              key={state.block.block_id}
              blockState={state}
              onEdit={handleEdit}
              onAcceptRevision={handleAcceptRevision}
              onRejectRevision={handleRejectRevision}
              onApproveBlock={handleApproveBlock}
              onOpenHistory={id => setHistoryBlockId(id)}
              onAIAssist={handleAIAssist}
              userRole={currentRole}
            />
          ))
        )}
      </div>

      {/* ── Governance footnote ───────────────────────────────────────────── */}
      <div className="text-[8px] text-gray-800 px-1 flex items-start gap-1.5 leading-relaxed">
        <Info className="size-3 flex-shrink-0 mt-0.5" />
        No silent edits. Every change creates a revision (schema §4). Revisions are never overwritten.
        Accepting a revision increments block version and updates block.content.
        Locked blocks (schema §6): only admin can create revisions.
        ROI snapshot blocks (schema §9): immutable reference — edit the narrative block instead.
      </div>

      {/* ── History panel (slide-in) ──────────────────────────────────────── */}
      {historyState && (
        <BlockHistoryPanel
          blockState={historyState}
          onClose={() => setHistoryBlockId(null)}
        />
      )}

      {/* ── Copilot panel (fixed right drawer) — copilot-patch-plan.md ──── */}
      {copilotOpen && (
        <CopilotPanel
          proposalId={proposalId}
          allStates={allStates}
          onRevisionsBatch={handleRevisionsBatch}
          onAcceptRevision={handleAcceptRevision}
          onRejectRevision={handleRejectRevision}
          onClose={() => setCopilotOpen(false)}
        />
      )}
    </div>
  );
}