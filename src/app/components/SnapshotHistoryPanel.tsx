/**
 * SNAPSHOT HISTORY PANEL — proposal-p2-implementation.md §1 D
 *
 * Version history for a proposal's immutable snapshots.
 * Each row shows: version, snapshot_id, hash, created_at, block count, export type.
 * All snapshots are labelled "Immutable" — they cannot be edited.
 */

import React, { useState } from 'react';
import {
  Lock, ChevronDown, ChevronUp, GitBranch,
  Clock, Package, Hash, CheckCircle2, Camera,
} from 'lucide-react';
import type { ProposalSnapshot } from '@/app/core/snapshotEngine';

// ════════════════════════════════════════════════════════════════════════════════
// SNAPSHOT ROW
// ════════════════════════════════════════════════════════════════════════════════

function SnapshotRow({ snap }: { snap: ProposalSnapshot }) {
  const [expanded, setExpanded] = useState(false);

  const blockCount = snap.content_snapshot.blocks.length;
  const diagCount  = snap.content_snapshot.diagnosis_blocks.length;
  const solCount   = (snap.content_snapshot.solutions ?? []).length;
  const conCount   = snap.content_snapshot.contract_snapshot.length;

  return (
    <div
      className="rounded-xl border overflow-hidden transition-colors"
      style={{ borderColor: '#10B98130', background: '#10B98106' }}
    >
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Version badge */}
        <div
          className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center font-black text-sm"
          style={{ background: '#10B98120', color: '#10B981' }}
        >
          v{snap.version_number}
        </div>

        {/* Core info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold text-white font-mono">{snap.proposal_snapshot_id}</span>
            {/* Immutable badge */}
            <span
              className="text-[7px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full"
              style={{ background: '#10B98120', color: '#10B981' }}
            >
              <Lock className="inline size-2 mr-0.5" />Immutable
            </span>
            {snap.triggered_by_export && (
              <span
                className="text-[7px] font-bold uppercase px-1.5 py-0.5 rounded-full"
                style={{ background: '#06D7F620', color: '#06D7F6' }}
              >
                {snap.triggered_by_export.replace(/_/g, ' ')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <span className="text-[8px] text-gray-700 flex items-center gap-1">
              <Clock className="size-2.5" />
              {new Date(snap.created_at).toLocaleString()}
            </span>
            <span className="text-[8px] text-gray-700 flex items-center gap-1">
              <Package className="size-2.5" />
              {blockCount} block{blockCount !== 1 ? 's' : ''}
            </span>
            <span className="text-[8px] text-gray-800 flex items-center gap-1 font-mono">
              <Hash className="size-2.5" />
              {snap.version_hash}
            </span>
          </div>
        </div>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex-shrink-0 p-1.5 rounded-lg text-gray-700 hover:text-white hover:bg-white/5 transition-colors"
          title="Expand snapshot details"
        >
          {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/5 pt-3">
          {/* Section counts */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Blocks',        value: blockCount, color: '#9CA3AF' },
              { label: 'Diagnoses',     value: diagCount,  color: '#FD4438' },
              { label: 'Solutions',     value: solCount,   color: '#06D7F6' },
              { label: 'Contract Items',value: conCount,   color: '#8B5CF6' },
              { label: 'ROI Snapshots', value: snap.content_snapshot.assumptions_snapshot.length, color: '#10B981' },
            ].map(m => (
              <div
                key={m.label}
                className="flex flex-col items-center py-2 rounded-lg border"
                style={{ borderColor: `${m.color}20`, background: `${m.color}08` }}
              >
                <span className="text-base font-black" style={{ color: m.color }}>{m.value}</span>
                <span className="text-[7px] uppercase tracking-wide text-gray-700">{m.label}</span>
              </div>
            ))}
          </div>

          {/* Executive brief preview */}
          {snap.content_snapshot.executive_brief?.title && (
            <div className="space-y-1">
              <div className="text-[8px] font-bold text-gray-700 uppercase tracking-wide">Frozen Executive Brief</div>
              <div className="text-[9px] text-gray-500 italic leading-relaxed line-clamp-2">
                "{snap.content_snapshot.executive_brief.strategic_context}"
              </div>
            </div>
          )}

          {/* Next step offer */}
          {snap.content_snapshot.next_step_offer?.price && (
            <div className="flex items-center gap-4 text-[9px]">
              <span className="text-gray-700">Engagement Price:</span>
              <span className="font-black text-[#10B981]">
                {new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: snap.content_snapshot.next_step_offer.currency ?? 'USD',
                  maximumFractionDigits: 0,
                }).format(snap.content_snapshot.next_step_offer.price)}
              </span>
              <span className="text-gray-700">· {snap.content_snapshot.next_step_offer.duration}</span>
            </div>
          )}

          {/* Created by */}
          <div className="text-[8px] text-gray-800 flex items-center gap-1.5">
            <CheckCircle2 className="size-2.5 text-[#10B981]" />
            Snapshot created by <span className="font-mono text-gray-600">{snap.created_by}</span>
            · Cannot be modified after creation.
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ════════════════════════════════════════════════════════════════════════════════

interface SnapshotHistoryPanelProps {
  proposalId: string;
  snapshots:  ProposalSnapshot[];
}

export function SnapshotHistoryPanel({ proposalId, snapshots }: SnapshotHistoryPanelProps) {
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <Camera className="size-4 text-[#10B981]" />
        <span className="text-sm font-bold text-white">Snapshot History</span>
        <span
          className="text-[9px] px-1.5 py-0.5 rounded-full font-bold border uppercase tracking-wider"
          style={{ color: '#10B981', borderColor: '#10B98133', background: '#10B98114' }}
        >
          {snapshots.length} snapshot{snapshots.length !== 1 ? 's' : ''}
        </span>
        <span className="ml-auto text-[8px] text-gray-700 flex items-center gap-1">
          <GitBranch className="size-2.5" />proposal {proposalId}
        </span>
      </div>

      {/* Empty state */}
      {snapshots.length === 0 ? (
        <div
          className="rounded-xl border border-white/5 py-8 flex flex-col items-center gap-2"
          style={{ background: '#ffffff04' }}
        >
          <Camera className="size-8 text-gray-800" />
          <div className="text-[10px] text-gray-700 font-medium">No snapshots yet</div>
          <div className="text-[9px] text-gray-800 text-center max-w-xs leading-relaxed">
            A snapshot is created automatically when the proposal is exported (status → sent).
            Each snapshot is immutable — full audit trail.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {snapshots.map(snap => (
            <SnapshotRow key={snap.proposal_snapshot_id} snap={snap} />
          ))}
        </div>
      )}

      {/* Governance note */}
      <div className="text-[8px] text-gray-800 px-1 flex items-start gap-1.5 leading-relaxed">
        <Lock className="size-3 flex-shrink-0 mt-0.5 text-gray-700" />
        All snapshots are immutable records. Engagements, CRM tracking, and follow-ups reference
        snapshot_id — not the live proposal. Exports always pull from snapshot, not live blocks.
      </div>
    </div>
  );
}
