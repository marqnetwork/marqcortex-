/**
 * EXPORT PANEL — proposal-p2-implementation.md §2
 *
 * Executive Export Engine UI.
 *
 * Sections:
 *   1. Export Safety Gate — live traffic-light check
 *   2. Three export type cards — Executive Summary / Full Technical / Contract Attachment
 *   3. "Snapshot & Export" flow — creates immutable snapshot, assembles payload, opens preview
 *   4. Export Preview Modal — all sections rendered with print support
 *
 * Source rule (spec §2 B): export always pulls from snapshot, never live blocks.
 * Safety gate (spec §2 D): blocked if roi_recalc_required | !validation_passed | contract_invalidated.
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  Download, ShieldCheck, ShieldX, AlertTriangle, CheckCircle2,
  XCircle, FileText, FileBarChart2, Pen, ChevronRight,
  Printer, X, Lock, Camera, Eye, Hash, Clock, Info,
  ArrowRight, Package,
} from 'lucide-react';
import type { ProposalDraft }       from '@/app/types/cortex-types';
import type { BlockState }          from '@/app/core/blockEngine';
import {
  BLOCK_STORE, REVISION_STORE, LINK_STORE, LOCK_STORE,
  getBlocksByProposal,
} from '@/app/core/blockEngine';
import {
  runConsistencyValidator,
} from '@/app/core/consistencyValidator';
import type { ConsistencyResult }   from '@/app/core/consistencyValidator';
import {
  createProposalSnapshot,
  getSnapshotsByProposal,
  isProposalDriftedFromSnapshot,
  SNAPSHOT_STORE,
  type ProposalSnapshot,
} from '@/app/core/snapshotEngine';
import {
  checkExportSafety,
  assembleExportPayload,
  EXPORT_DOC_LABELS,
  EXPORT_DOC_DESCRIPTIONS,
  type ExportDocType,
  type ExportPayload,
  type ExportSafetyGate,
  type ExportSectionContent,
} from '@/app/core/exportEngine';

// ════════════════════════════════════════════════════════════════════════════════
// EXPORT TYPE CONFIG
// ════════════════════════════════════════════════════════════════════════════════

interface DocTypeConfig {
  type:        ExportDocType;
  icon:        React.FC<{ className?: string }>;
  color:       string;
  sectionCount: number;
}

const DOC_TYPES: DocTypeConfig[] = [
  { type: 'executive_summary',   icon: FileBarChart2, color: '#06D7F6', sectionCount: 5 },
  { type: 'full_technical',      icon: FileText,      color: '#8B5CF6', sectionCount: 8 },
  { type: 'contract_attachment', icon: Pen,           color: '#10B981', sectionCount: 4 },
];

// ════════════════════════════════════════════════════════════════════════════════
// SAFETY GATE PANEL
// ════════════════════════════════════════════════════════════════════════════════

function SafetyGatePanel({
  gate, onRunValidation, validationRan,
}: {
  gate:            ExportSafetyGate;
  onRunValidation: () => void;
  validationRan:   boolean;
}) {
  const GateIcon   = gate.blocked ? ShieldX : ShieldCheck;
  const gateColor  = gate.blocked ? '#FD4438' : '#10B981';
  const gateLabel  = gate.blocked ? 'Export Blocked' : 'Export Cleared';

  const flagRows = [
    { key: 'wrong_status',        label: 'Proposal Status', ok: !gate.flags.wrong_status,    failMsg: 'Must be ready_to_send' },
    { key: 'roi_recalc_required', label: 'ROI Engine',      ok: !gate.flags.roi_recalc_required, failMsg: 'Recalculation required' },
    { key: 'validation_failed',   label: 'Consistency',     ok: !gate.flags.validation_failed,   failMsg: 'Errors unresolved' },
    { key: 'contract_invalidated',label: 'Contract Clauses',ok: !gate.flags.contract_invalidated, failMsg: 'Clauses stale' },
  ];

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ borderColor: `${gateColor}30`, background: `${gateColor}06` }}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/5">
        <GateIcon className="size-4 flex-shrink-0" style={{ color: gateColor }} />
        <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: gateColor }}>
          Export Safety Gate
        </span>
        <span
          className="text-[8px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide"
          style={{ background: `${gateColor}20`, color: gateColor }}
        >
          {gateLabel}
        </span>
        <button
          onClick={onRunValidation}
          className="ml-auto flex items-center gap-1.5 text-[8px] font-bold px-2 py-1 rounded-lg border transition-colors"
          style={{ borderColor: '#10B98130', color: '#10B981', background: '#10B98110' }}
          title="Run Consistency Validator"
        >
          <ShieldCheck className="size-2.5" />
          {validationRan ? 'Re-Validate' : 'Validate'}
        </button>
      </div>

      {/* Flag checklist */}
      <div className="px-4 py-3 grid grid-cols-2 gap-2">
        {flagRows.map(row => (
          <div
            key={row.key}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border"
            style={{
              borderColor: row.ok ? '#10B98130' : '#FD443830',
              background:  row.ok ? '#10B98108' : '#FD443808',
            }}
          >
            {row.ok
              ? <CheckCircle2 className="size-3 text-[#10B981] flex-shrink-0" />
              : <XCircle      className="size-3 text-[#FD4438] flex-shrink-0" />
            }
            <div>
              <div className="text-[8px] font-bold" style={{ color: row.ok ? '#10B981' : '#FD4438' }}>
                {row.label}
              </div>
              {!row.ok && (
                <div className="text-[7px] text-gray-700">{row.failMsg}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Blockers list */}
      {gate.reasons.length > 0 && (
        <div className="px-4 pb-3 space-y-1">
          {gate.reasons.map((reason, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[8px] text-gray-600">
              <AlertTriangle className="size-2.5 flex-shrink-0 mt-0.5 text-[#F59E0B]" />
              {reason}
            </div>
          ))}
        </div>
      )}

      {!gate.blocked && (
        <div className="px-4 pb-3 flex items-center gap-2 text-[9px] text-[#10B981]">
          <CheckCircle2 className="size-3.5" />
          All checks passed — proposal is cleared for export. A snapshot will be created.
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// EXPORT TYPE CARD
// ════════════════════════════════════════════════════════════════════════════════

function ExportTypeCard({
  config, blocked, onSelect, selected,
}: {
  config:   DocTypeConfig;
  blocked:  boolean;
  onSelect: (t: ExportDocType) => void;
  selected: boolean;
}) {
  const Icon = config.icon;
  return (
    <button
      onClick={() => !blocked && onSelect(config.type)}
      disabled={blocked}
      className="flex flex-col gap-2 px-4 py-4 rounded-xl border text-left transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        borderColor: selected ? `${config.color}60` : `${config.color}20`,
        background:  selected ? `${config.color}14`  : `${config.color}07`,
      }}
    >
      <div className="flex items-center justify-between">
        <Icon className="size-5" style={{ color: config.color }} />
        <span
          className="text-[7px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full"
          style={{ background: `${config.color}20`, color: config.color }}
        >
          {config.sectionCount} section{config.sectionCount !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="text-[11px] font-bold text-white">{EXPORT_DOC_LABELS[config.type]}</div>
      <div className="text-[8px] text-gray-600 leading-relaxed">{EXPORT_DOC_DESCRIPTIONS[config.type]}</div>
      {selected && (
        <div className="flex items-center gap-1 text-[8px] font-bold mt-1" style={{ color: config.color }}>
          <CheckCircle2 className="size-2.5" />Selected
        </div>
      )}
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// SECTION CONTENT RENDERER
// ════════════════════════════════════════════════════════════════════════════════

function RenderContent({ items }: { items: ExportSectionContent[] }) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => {
        switch (item.type) {
          case 'heading':
            return (
              <h3 key={i} className="text-sm font-bold text-white mt-3 first:mt-0">
                {item.text}
              </h3>
            );
          case 'paragraph':
            return (
              <p key={i} className="text-[10px] text-gray-500 leading-relaxed">
                {item.text}
              </p>
            );
          case 'kv_row':
            return (
              <div key={i} className="flex items-start gap-3 text-[9px]">
                <span className="text-gray-700 font-bold min-w-[120px] flex-shrink-0">
                  {item.label}
                </span>
                <span style={{ color: item.accent ?? '#D1D5DB' }}>{item.value}</span>
              </div>
            );
          case 'bullet':
            return (
              <div
                key={i}
                className="flex items-start gap-2 text-[9px] text-gray-500"
                style={{ paddingLeft: item.level === 2 ? '1.5rem' : '0.25rem' }}
              >
                <span className="flex-shrink-0 mt-1" style={{ color: '#06D7F6' }}>•</span>
                {item.text}
              </div>
            );
          case 'divider':
            return <div key={i} className="border-t border-white/5 my-3" />;
          case 'signature_field':
            return (
              <div key={i} className="flex items-end gap-4 py-2">
                <span className="text-[9px] text-gray-700 font-bold min-w-[160px]">
                  {item.label}:
                </span>
                <div
                  className="flex-1 border-b"
                  style={{ borderColor: '#ffffff20', minHeight: '20px' }}
                >
                  {item.value && (
                    <span className="text-[9px] text-gray-500">{item.value}</span>
                  )}
                </div>
              </div>
            );
          case 'tag_row':
            return (
              <div key={i} className="flex flex-wrap gap-1.5">
                {item.tags.map((tag, ti) => (
                  <span
                    key={ti}
                    className="text-[7px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
                    style={{ background: `${tag.color}20`, color: tag.color }}
                  >
                    {tag.label}
                  </span>
                ))}
              </div>
            );
          case 'metric_row':
            return (
              <div key={i} className="grid grid-cols-2 gap-2">
                {item.metrics.map((m, mi) => (
                  <div
                    key={mi}
                    className="flex flex-col gap-0.5 px-3 py-2.5 rounded-lg border"
                    style={{
                      borderColor: `${m.accent ?? '#9CA3AF'}20`,
                      background:  `${m.accent ?? '#9CA3AF'}08`,
                    }}
                  >
                    <span className="text-base font-black" style={{ color: m.accent ?? '#9CA3AF' }}>
                      {m.value}
                    </span>
                    <span className="text-[7px] uppercase tracking-wide text-gray-700">{m.label}</span>
                  </div>
                ))}
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// EXPORT PREVIEW MODAL
// ════════════════════════════════════════════════════════════════════════════════

function ExportPreviewModal({
  payload,
  snapshot,
  onClose,
}: {
  payload:  ExportPayload;
  snapshot: ProposalSnapshot;
  onClose:  () => void;
}) {
  const [activeSectionId, setActiveSectionId] = useState(payload.sections[0]?.id ?? '');

  const handlePrint = () => {
    window.print();
  };

  const activeSection = payload.sections.find(s => s.id === activeSectionId);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch" style={{ background: 'rgba(0,0,0,0.85)' }}>
      {/* Sidebar nav */}
      <div
        className="w-56 flex-shrink-0 flex flex-col border-r border-white/10 overflow-y-auto"
        style={{ background: '#0A0A14' }}
      >
        {/* Header */}
        <div className="px-4 py-4 border-b border-white/10">
          <div className="text-[10px] font-black uppercase tracking-widest text-[#06D7F6]">
            Export Preview
          </div>
          <div className="text-[9px] text-gray-700 mt-0.5">
            {EXPORT_DOC_LABELS[payload.doc_type]}
          </div>
          <div className="text-[8px] text-gray-800 font-mono mt-1">
            {snapshot.proposal_snapshot_id} · v{payload.version_number}
          </div>
        </div>

        {/* Section nav */}
        <nav className="flex-1 py-2">
          {payload.sections.map(section => (
            <button
              key={section.id}
              onClick={() => setActiveSectionId(section.id)}
              className="w-full text-left px-4 py-2.5 text-[9px] transition-colors flex items-center gap-2"
              style={{
                background: activeSectionId === section.id ? '#06D7F614' : 'transparent',
                color:      activeSectionId === section.id ? '#06D7F6'   : '#6B7280',
                borderLeft: activeSectionId === section.id ? '2px solid #06D7F6' : '2px solid transparent',
              }}
            >
              <span className="text-[8px] font-mono text-gray-800 w-4">{section.order}</span>
              {section.title}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-white/10 space-y-2">
          <button
            onClick={handlePrint}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[9px] font-bold border transition-colors"
            style={{ background: '#06D7F614', borderColor: '#06D7F630', color: '#06D7F6' }}
          >
            <Printer className="size-3" />Print / Save PDF
          </button>
          <button
            onClick={onClose}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[9px] font-bold border transition-colors"
            style={{ background: '#FD443810', borderColor: '#FD443830', color: '#FD4438' }}
          >
            <X className="size-3" />Close
          </button>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 overflow-y-auto" style={{ background: '#080810' }}>
        {/* Top bar */}
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-6 py-3 border-b border-white/10"
          style={{ background: '#080810' }}
        >
          <div className="flex items-center gap-3">
            <span className="text-[9px] font-bold text-gray-600">{activeSection?.title}</span>
            {activeSection?.subtitle && (
              <span className="text-[8px] text-gray-800">— {activeSection.subtitle}</span>
            )}
          </div>
          <div className="flex items-center gap-3 text-[8px] text-gray-700">
            <span className="flex items-center gap-1"><Lock className="size-2.5" />Snapshot {snapshot.proposal_snapshot_id}</span>
            <span className="flex items-center gap-1"><Hash className="size-2.5" />{snapshot.version_hash}</span>
            <span className="flex items-center gap-1"><Clock className="size-2.5" />{new Date(payload.generated_at).toLocaleTimeString()}</span>
          </div>
        </div>

        {/* Section content */}
        <div className="px-8 py-6 max-w-3xl mx-auto">
          {activeSection && (
            <div>
              <div className="mb-6">
                <h2 className="text-xl font-black text-white">{activeSection.title}</h2>
                {activeSection.subtitle && (
                  <p className="text-[10px] text-gray-600 mt-1">{activeSection.subtitle}</p>
                )}
              </div>
              <RenderContent items={activeSection.content} />
            </div>
          )}

          {/* Next section arrow */}
          {payload.sections.findIndex(s => s.id === activeSectionId) < payload.sections.length - 1 && (
            <button
              onClick={() => {
                const idx = payload.sections.findIndex(s => s.id === activeSectionId);
                setActiveSectionId(payload.sections[idx + 1].id);
              }}
              className="mt-8 flex items-center gap-2 text-[9px] text-gray-700 hover:text-white transition-colors"
            >
              <ArrowRight className="size-3" />
              Next: {payload.sections[payload.sections.findIndex(s => s.id === activeSectionId) + 1]?.title}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// DRIFT BANNER
// ════════════════════════════════════════════════════════════════════════════════

function DriftBanner({ latestSnap }: { latestSnap: ProposalSnapshot }) {
  return (
    <div
      className="rounded-xl border px-4 py-3 flex items-start gap-3"
      style={{ borderColor: '#F59E0B40', background: '#F59E0B08' }}
    >
      <AlertTriangle className="size-4 text-[#F59E0B] flex-shrink-0 mt-0.5" />
      <div>
        <div className="text-[10px] font-bold text-[#F59E0B]">Proposal Drifted from Snapshot</div>
        <div className="text-[8px] text-gray-600 mt-0.5 leading-relaxed">
          The live proposal has changed since snapshot <span className="font-mono">{latestSnap.proposal_snapshot_id}</span> (v{latestSnap.version_number},&nbsp;
          {new Date(latestSnap.created_at).toLocaleDateString()}).
          A new snapshot (v{latestSnap.version_number + 1}) will be created on next export.
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ════════════════════════════════════════════════════════════════════════════════

interface ExportPanelProps {
  draft:               ProposalDraft;
  /** Optional: surface an active change impact so gate can reflect it. */
  roiRecalcRequired?:  boolean;
  /** Optional: if contract was invalidated by a recent block change. */
  contractInvalidated?: boolean;
  /** Called after a successful snapshot + export. */
  onExported?:         (snapshot: ProposalSnapshot) => void;
}

export function ExportPanel({
  draft,
  roiRecalcRequired  = false,
  contractInvalidated = false,
  onExported,
}: ExportPanelProps) {
  // ── Block states (needed for snapshot creation) ──────────────────────────
  const [allBlockStates] = useState<BlockState[]>(() =>
    getBlocksByProposal(draft.proposal_id, BLOCK_STORE, REVISION_STORE, LINK_STORE, LOCK_STORE),
  );

  // ── Consistency validation ───────────────────────────────────────────────
  const [consistencyResult, setConsistencyResult] = useState<ConsistencyResult | null>(null);
  const [validationRan,     setValidationRan]     = useState(false);

  const handleRunValidation = useCallback(() => {
    const result = runConsistencyValidator(allBlockStates);
    setConsistencyResult(result);
    setValidationRan(true);
  }, [allBlockStates]);

  // ── Snapshot state ───────────────────────────────────────────────────────
  const [snapshots, setSnapshots] = useState<ProposalSnapshot[]>(
    () => getSnapshotsByProposal(draft.proposal_id),
  );

  const latestSnapshot = snapshots.length > 0 ? snapshots[0] : null;
  const isDrifted      = latestSnapshot
    ? isProposalDriftedFromSnapshot(draft, latestSnapshot)
    : false;

  // ── Safety gate ──────────────────────────────────────────────────────────
  const gate = useMemo<ExportSafetyGate>(() => checkExportSafety(
    roiRecalcRequired,
    consistencyResult ? consistencyResult.validation_passed : true,
    contractInvalidated,
    draft.status,
  ), [roiRecalcRequired, consistencyResult, contractInvalidated, draft.status]);

  // ── Export selection ─────────────────────────────────────────────────────
  const [selectedDocType, setSelectedDocType] = useState<ExportDocType>('executive_summary');
  const [exporting,       setExporting]       = useState(false);
  const [exportPayload,   setExportPayload]   = useState<ExportPayload | null>(null);
  const [previewSnapshot, setPreviewSnapshot] = useState<ProposalSnapshot | null>(null);
  const [previewOpen,     setPreviewOpen]     = useState(false);

  // ── Export action ────────────────────────────────────────────────────────
  const handleExport = useCallback(() => {
    if (gate.blocked) return;

    setExporting(true);

    // 1. Create immutable snapshot
    const snapshot = createProposalSnapshot(
      draft,
      allBlockStates,
      'U-01',          // userId — production: pull from auth context
      selectedDocType,
    );

    // 2. Refresh local snapshot list
    setSnapshots(getSnapshotsByProposal(draft.proposal_id));

    // 3. Assemble payload from snapshot (never from live proposal)
    const payload = assembleExportPayload(snapshot, selectedDocType);

    setExportPayload(payload);
    setPreviewSnapshot(snapshot);
    setPreviewOpen(true);
    setExporting(false);

    onExported?.(snapshot);
  }, [gate.blocked, draft, allBlockStates, selectedDocType, onExported]);

  return (
    <div className="space-y-4">
      {/* Panel header */}
      <div className="flex items-center gap-2.5">
        <Download className="size-4 text-[#06D7F6]" />
        <span className="text-sm font-bold text-white">Export Engine</span>
        <span
          className="text-[9px] px-1.5 py-0.5 rounded-full font-bold border uppercase tracking-wider"
          style={{ color: '#06D7F6', borderColor: '#06D7F633', background: '#06D7F614' }}
        >
          P2
        </span>
        {snapshots.length > 0 && (
          <span className="ml-auto text-[8px] text-gray-700 flex items-center gap-1">
            <Camera className="size-2.5" />
            {snapshots.length} snapshot{snapshots.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Drift banner */}
      {latestSnapshot && isDrifted && (
        <DriftBanner latestSnap={latestSnapshot} />
      )}

      {/* Safety Gate */}
      <SafetyGatePanel
        gate={gate}
        onRunValidation={handleRunValidation}
        validationRan={validationRan}
      />

      {/* Export type selection */}
      <div>
        <div className="text-[9px] font-bold text-gray-700 uppercase tracking-wide mb-2">
          Select Export Type
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {DOC_TYPES.map(cfg => (
            <ExportTypeCard
              key={cfg.type}
              config={cfg}
              blocked={gate.blocked}
              onSelect={setSelectedDocType}
              selected={selectedDocType === cfg.type}
            />
          ))}
        </div>
      </div>

      {/* Export action */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleExport}
          disabled={gate.blocked || exporting}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background:  gate.blocked ? '#FD443820' : '#06D7F620',
            borderColor: gate.blocked ? '#FD443840' : '#06D7F640',
            color:       gate.blocked ? '#FD4438'   : '#06D7F6',
            border:      '1px solid',
          }}
          title={gate.blocked ? gate.reasons[0] : `Snapshot + export as ${EXPORT_DOC_LABELS[selectedDocType]}`}
        >
          {gate.blocked
            ? <span className="contents"><ShieldX className="size-3.5" />Export Blocked</span>
            : exporting
              ? <span className="contents"><div className="size-3 rounded-full border border-current border-t-transparent animate-spin" />Creating Snapshot…</span>
              : <span className="contents"><Camera className="size-3.5" />Snapshot &amp; Export</span>
          }
          {!gate.blocked && !exporting && (
            <span className="text-[8px] opacity-60 ml-1">· {EXPORT_DOC_LABELS[selectedDocType]}</span>
          )}
        </button>

        {/* Preview last export */}
        {exportPayload && previewSnapshot && (
          <button
            onClick={() => setPreviewOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-[9px] font-bold border transition-colors"
            style={{ borderColor: '#8B5CF630', color: '#8B5CF6', background: '#8B5CF610' }}
          >
            <Eye className="size-3" />Preview Last Export
          </button>
        )}
      </div>

      {/* Last export info */}
      {exportPayload && previewSnapshot && (
        <div
          className="rounded-xl border px-4 py-3 flex items-center gap-3"
          style={{ borderColor: '#10B98120', background: '#10B98108' }}
        >
          <CheckCircle2 className="size-4 text-[#10B981] flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[9px] font-bold text-white">
              Snapshot created · {EXPORT_DOC_LABELS[exportPayload.doc_type]}
            </div>
            <div className="text-[8px] text-gray-700 flex items-center gap-3 mt-0.5 flex-wrap">
              <span className="font-mono">{previewSnapshot.proposal_snapshot_id}</span>
              <span>v{exportPayload.version_number}</span>
              <span className="font-mono">{exportPayload.version_hash}</span>
              <span>{new Date(exportPayload.generated_at).toLocaleTimeString()}</span>
            </div>
          </div>
          <Lock className="size-3.5 text-gray-700 flex-shrink-0" title="Immutable snapshot" />
        </div>
      )}

      {/* Export source rule footnote */}
      <div className="text-[8px] text-gray-800 px-1 flex items-start gap-1.5 leading-relaxed">
        <Info className="size-3 flex-shrink-0 mt-0.5" />
        Exports always pull from proposal_snapshot.content_snapshot — never from live blocks.
        A new immutable snapshot is created on each export. Version number increments with each snapshot.
        Engagements, CRM tracking, and follow-ups reference snapshot_id, not the live proposal.
      </div>

      {/* Preview modal */}
      {previewOpen && exportPayload && previewSnapshot && (
        <ExportPreviewModal
          payload={exportPayload}
          snapshot={previewSnapshot}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}
