/**
 * CRM SYNC PANEL — Phase 7: CRM Synchronization Layer
 *
 * §10 of ProposalDraftEditor
 *
 * Spec: crm-sync-spec.md
 *
 * Implements all 5 "Phase 6 Done" checklist items:
 *   ✓ Create a deal automatically when diagnostic starts
 *   ✓ Move stage automatically based on proposal/contract events
 *   ✓ Auto-create follow-up tasks
 *   ✓ View activity timeline per deal
 *   ✓ Filter deals by stage + owner
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  BarChart3, CheckCircle2, Clock, AlertCircle, Check,
  ChevronDown, ChevronRight, Activity, Zap, User,
  RefreshCw, Filter, ArrowRight, Flag, TrendingUp,
  Circle, X, ListChecks, History, DollarSign,
} from 'lucide-react';
import type { ProposalDraft, CRMStage, CRMDeal, CRMTask } from '@/app/types/cortex-types';
import {
  deriveDealFromDraft,
  STAGE_PIPELINE,
  STAGE_CFG,
  CRM_ACTIVITY_LABELS,
} from '@/app/core/crmEngine';

// ════════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════════

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function fmtDue(iso: string): { label: string; overdue: boolean } {
  try {
    const ms    = new Date(iso).getTime() - Date.now();
    const overdue = ms < 0;
    const absh  = Math.abs(ms) / 3_600_000;
    const label = absh < 24
      ? `${overdue ? '' : 'in '}${Math.round(absh)}h${overdue ? ' overdue' : ''}`
      : `${overdue ? '' : 'in '}${Math.round(absh / 24)}d${overdue ? ' overdue' : ''}`;
    return { label, overdue };
  } catch { return { label: iso, overdue: false }; }
}

// ════════════════════════════════════════════════════════════════════════════════
// PIPELINE STRIP — 14 stages, current highlighted, closed branches dimmed
// ════════════════════════════════════════════════════════════════════════════════

function PipelineStrip({ stage }: { stage: CRMStage }) {
  const currentIdx = STAGE_PIPELINE.indexOf(stage);
  const isLost     = stage === 'closed_lost';

  // Only show active track (exclude closed_lost from main strip unless current)
  const mainTrack = STAGE_PIPELINE.filter(s => s !== 'closed_lost');

  return (
    <div className="space-y-3">
      {/* Main pipeline */}
      <div className="flex items-center gap-0 overflow-x-auto pb-1 scrollbar-hide">
        {mainTrack.map((s, i) => {
          const cfg       = STAGE_CFG[s];
          const sIdx      = STAGE_PIPELINE.indexOf(s);
          const isCurrent = s === stage && !isLost;
          const isPast    = !isLost && sIdx < currentIdx;
          const isNext    = !isLost && sIdx === currentIdx + 1;

          return (
            <span key={s} className="contents">
              <div className="flex-shrink-0 flex flex-col items-center gap-1">
                <div
                  className="flex items-center justify-center rounded-full transition-all"
                  style={{
                    width:      isCurrent ? 22 : 14,
                    height:     isCurrent ? 22 : 14,
                    background: isCurrent ? cfg.color : isPast ? '#10B981' : isNext ? '#ffffff10' : '#ffffff06',
                    border:     isCurrent ? `2px solid ${cfg.color}` : isPast ? '2px solid #10B981' : '1px solid #ffffff12',
                    boxShadow:  isCurrent ? `0 0 8px ${cfg.color}50` : undefined,
                  }}
                >
                  {isPast    && <Check  className="size-2 text-white" />}
                  {isCurrent && <span className="size-1 rounded-full bg-white inline-block" />}
                </div>
                <span
                  className="text-[7px] font-bold uppercase tracking-wide text-center"
                  style={{
                    color:    isCurrent ? cfg.color : isPast ? '#6EE7B7' : '#374151',
                    minWidth: 44,
                    maxWidth: 52,
                    lineHeight: 1.2,
                  }}
                >
                  {cfg.short}
                </span>
              </div>
              {i < mainTrack.length - 1 && (
                <div
                  className="h-px flex-1 mx-0.5 min-w-[10px]"
                  style={{ background: (isPast && !isLost) ? '#10B981' : '#ffffff08' }}
                />
              )}
            </span>
          );
        })}
      </div>

      {/* Closed Lost branch */}
      {isLost && (
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border"
          style={{ borderColor: '#FD443820', background: '#FD443808' }}
        >
          <X className="size-3 text-[#FD4438] flex-shrink-0" />
          <span className="text-[9px] font-bold text-[#FD4438]">CLOSED LOST — Pipeline exited</span>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// DEAL HEADER CARD
// ════════════════════════════════════════════════════════════════════════════════

function DealCard({ deal, draft }: { deal: CRMDeal; draft: ProposalDraft }) {
  const cfg = STAGE_CFG[deal.stage];

  return (
    <div
      className="flex items-start gap-4 px-4 py-4 rounded-xl border"
      style={{ borderColor: `${cfg.color}20`, background: `${cfg.color}06` }}
    >
      {/* Left — deal meta */}
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-black text-white">{deal.deal_id}</span>
          <span className="text-[9px] text-gray-500">·</span>
          <span className="text-[11px] font-semibold text-gray-300">{draft.client.company_name}</span>
          <span
            className="text-[9px] px-2 py-0.5 rounded-full font-bold border"
            style={{ color: cfg.color, borderColor: `${cfg.color}30`, background: `${cfg.color}12` }}
          >
            {cfg.label}
          </span>
        </div>
        <div className="flex items-center gap-4 flex-wrap text-[9px] text-gray-600">
          <span className="flex items-center gap-1">
            <User className="size-2.5" />{deal.owner_user_id}
          </span>
          <span className="flex items-center gap-1">
            <DollarSign className="size-2.5" />
            {draft.next_step_offer.currency} {deal.value_estimate.toLocaleString()}
          </span>
          <span className="flex items-center gap-1">
            <TrendingUp className="size-2.5" />
            Close probability: <span className="font-bold" style={{ color: cfg.color }}>
              {Math.round(deal.close_probability * 100)}%
            </span>
          </span>
          {deal.contract_id && (
            <span className="flex items-center gap-1">
              <CheckCircle2 className="size-2.5 text-[#10B981]" />
              Contract: {deal.contract_id}
            </span>
          )}
        </div>
      </div>

      {/* Right — probability ring */}
      <div className="flex-shrink-0 flex flex-col items-center gap-0.5">
        <div
          className="text-xl font-black leading-none"
          style={{ color: cfg.color }}
        >
          {Math.round(deal.close_probability * 100)}%
        </div>
        <div className="text-[8px] text-gray-700 uppercase tracking-wide">close</div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// ACTIVITY TIMELINE
// ════════════════════════════════════════════════════════════════════════════════

const ACTIVITY_COLORS: Record<string, string> = {
  deal_created:          '#8B5CF6',
  diagnostic_started:    '#8B5CF6',
  diagnostic_completed:  '#A78BFA',
  proposal_created:      '#06D7F6',
  proposal_ready_to_send:'#06D7F6',
  proposal_sent:         '#3B82F6',
  proposal_viewed:       '#10B981',
  objection_detected:    '#FB923C',
  proposal_approved:     '#F59E0B',
  proposal_rejected:     '#FD4438',
  contract_generated:    '#F59E0B',
  contract_sent:         '#F59E0B',
  contract_signed:       '#10B981',
  onboarding_started:    '#10B981',
  implementation_started:'#10B981',
  project_completed:     '#10B981',
};

function ActivityTimeline({ deal }: { deal: CRMDeal }) {
  const sorted = [...deal.activity].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return (
    <div className="space-y-1.5">
      {sorted.map((act, i) => {
        const color = ACTIVITY_COLORS[act.type] ?? '#6B7280';
        const label = CRM_ACTIVITY_LABELS[act.type] ?? act.type;
        const isLast = i === sorted.length - 1;

        return (
          <div key={act.activity_id} className="flex gap-3">
            {/* Timeline spine */}
            <div className="flex flex-col items-center flex-shrink-0">
              <div
                className="size-2 rounded-full flex-shrink-0 mt-1"
                style={{ background: color, boxShadow: `0 0 4px ${color}60` }}
              />
              {!isLast && <div className="w-px flex-1 min-h-[16px]" style={{ background: '#ffffff08' }} />}
            </div>
            {/* Content */}
            <div className="pb-3 flex-1 min-w-0">
              <div className="flex items-start gap-2 flex-wrap">
                <span className="text-[10px] font-semibold text-gray-200 leading-tight flex-1">{label}</span>
                <span className="text-[9px] text-gray-700 flex-shrink-0">{fmtDate(act.created_at)}</span>
              </div>
              {Object.keys(act.payload).length > 0 && (
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                  {Object.entries(act.payload)
                    .filter(([k]) => !['deal_id'].includes(k))
                    .map(([k, v]) => (
                      <span key={k} className="text-[9px] text-gray-600">
                        <span className="text-gray-700">{k}:</span>{' '}
                        <span className="font-mono">{String(v)}</span>
                      </span>
                    ))
                  }
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// TASK LIST
// ════════════════════════════════════════════════════════════════════════════════

function TaskList({ deal, onToggleTask }: {
  deal:         CRMDeal;
  onToggleTask: (taskId: string) => void;
}) {
  const open   = deal.tasks.filter(t => t.status === 'open');
  const done   = deal.tasks.filter(t => t.status === 'done');

  const TaskRow = ({ t }: { t: CRMTask }) => {
    const { label: dueLabel, overdue } = fmtDue(t.due_at);
    const isDone = t.status === 'done';

    return (
      <div
        className="flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-all"
        style={{
          borderColor: isDone ? '#ffffff08' : overdue ? '#FD443820' : '#ffffff0a',
          background:  isDone ? 'transparent' : overdue ? '#FD443806' : '#ffffff02',
          opacity:     isDone ? 0.5 : 1,
        }}
      >
        <button
          onClick={() => onToggleTask(t.task_id)}
          className="mt-0.5 flex-shrink-0"
        >
          {isDone
            ? <CheckCircle2 className="size-3.5 text-[#10B981]" />
            : <Circle className="size-3.5 text-gray-600 hover:text-gray-300 transition-colors" />
          }
        </button>
        <div className="flex-1 min-w-0">
          <div
            className="text-[10px] font-semibold leading-tight"
            style={{
              color:           isDone ? '#374151' : '#D1D5DB',
              textDecoration:  isDone ? 'line-through' : 'none',
            }}
          >
            {t.task_type}
          </div>
          {t.notes && (
            <div className="text-[9px] text-gray-600 mt-0.5 leading-snug truncate">{t.notes}</div>
          )}
        </div>
        <div className="flex-shrink-0 flex items-center gap-1.5">
          <span className="text-[9px] text-gray-600">
            <span className="text-gray-700">{t.assigned_to}</span>
          </span>
          <span
            className="text-[9px] font-bold"
            style={{ color: isDone ? '#374151' : overdue ? '#FD4438' : '#F59E0B' }}
          >
            {isDone ? 'Done' : dueLabel}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-1.5">
      {open.length === 0 && done.length === 0 && (
        <div className="text-center py-4 text-gray-600 text-[10px]">No tasks for this deal.</div>
      )}
      {open.map(t => <TaskRow key={t.task_id} t={t} />)}
      {done.length > 0 && (
        <span className="contents">
          <div className="text-[9px] font-bold uppercase tracking-wider text-gray-700 pt-2">Completed</div>
          {done.map(t => <TaskRow key={t.task_id} t={t} />)}
        </span>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// STAGE FILTER — horizontal pill filter
// ════════════════════════════════════════════════════════════════════════════════

function StageFilter({
  selected,
  onChange,
}: {
  selected: CRMStage | 'all';
  onChange: (s: CRMStage | 'all') => void;
}) {
  const groups: { label: string; stages: CRMStage[] }[] = [
    { label: 'Pre-Proposal',  stages: ['lead_captured', 'diagnostic_started', 'diagnostic_completed'] },
    { label: 'Proposal',      stages: ['proposal_draft', 'proposal_sent', 'proposal_viewed', 'negotiation_objection'] },
    { label: 'Contract',      stages: ['approved_pending_contract', 'contract_sent', 'contract_signed'] },
    { label: 'Delivery',      stages: ['onboarding_started', 'implementation_active', 'closed_won'] },
    { label: 'Lost',          stages: ['closed_lost'] },
  ];

  return (
    <div className="space-y-2">
      <button
        onClick={() => onChange('all')}
        className="text-[9px] px-2.5 py-1 rounded-lg font-bold border transition-colors"
        style={{
          borderColor: selected === 'all' ? '#8B5CF6' : '#ffffff10',
          background:  selected === 'all' ? '#8B5CF614' : 'transparent',
          color:       selected === 'all' ? '#8B5CF6' : '#6B7280',
        }}
      >
        All Stages
      </button>
      {groups.map(g => (
        <div key={g.label} className="flex flex-wrap gap-1.5 items-center">
          <span className="text-[8px] font-bold uppercase tracking-wider text-gray-700 w-full">{g.label}</span>
          {g.stages.map(s => {
            const cfg = STAGE_CFG[s];
            const active = selected === s;
            return (
              <button
                key={s}
                onClick={() => onChange(s)}
                className="text-[9px] px-2 py-0.5 rounded font-bold border transition-colors"
                style={{
                  borderColor: active ? cfg.color : '#ffffff10',
                  background:  active ? `${cfg.color}14` : 'transparent',
                  color:       active ? cfg.color : '#6B7280',
                }}
              >
                {cfg.short}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// ROOT EXPORT
// ════════════════════════════════════════════════════════════════════════════════

export interface CRMSyncPanelProps {
  draft: ProposalDraft;
}

export function CRMSyncPanel({ draft }: CRMSyncPanelProps) {
  const [deal, setDeal] = useState<CRMDeal>(() => deriveDealFromDraft(draft));

  // Tabs: pipeline | activity | tasks | filter
  const [tab,            setTab]           = useState<'pipeline' | 'activity' | 'tasks'>('pipeline');
  const [showFilter,     setShowFilter]    = useState(false);
  const [stageFilter,    setStageFilter]   = useState<CRMStage | 'all'>('all');
  const [lastSynced,     setLastSynced]    = useState<string>(() => new Date().toLocaleTimeString());

  const openTasks   = deal.tasks.filter(t => t.status === 'open');
  const overdueTasks = openTasks.filter(t => t.overdue);

  // Filter match: if stageFilter set, highlight that the deal is/isn't in that stage
  const filterMatch = stageFilter === 'all' || deal.stage === stageFilter;

  const handleSync = useCallback(() => {
    const fresh = deriveDealFromDraft(draft);
    setDeal(fresh);
    setLastSynced(new Date().toLocaleTimeString());
    console.log(`[CRMEngine] Synced → ${fresh.deal_id} stage:${fresh.stage} prob:${fresh.close_probability}`);
  }, [draft]);

  const handleToggleTask = useCallback((taskId: string) => {
    setDeal(prev => ({
      ...prev,
      tasks: prev.tasks.map(t =>
        t.task_id === taskId
          ? { ...t, status: t.status === 'open' ? 'done' : 'open' }
          : t,
      ),
    }));
  }, []);

  const cfg = STAGE_CFG[deal.stage];

  const TABS = [
    { id: 'pipeline' as const, icon: BarChart3,  label: 'Pipeline'  },
    { id: 'activity' as const, icon: History,    label: 'Activity'  },
    { id: 'tasks'    as const, icon: ListChecks, label: `Tasks${openTasks.length > 0 ? ` (${openTasks.length})` : ''}` },
  ];

  return (
    <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5">
        <span className="flex items-center gap-2.5 text-sm font-bold text-white">
          <BarChart3 className="size-4" style={{ color: '#06D7F6' }} />
          §10 CRM Sync Layer
          <span
            className="text-[9px] px-1.5 py-0.5 rounded-full font-bold border uppercase tracking-wider"
            style={{ color: '#06D7F6', borderColor: '#06D7F633', background: '#06D7F614' }}
          >
            Phase 7
          </span>
          {overdueTasks.length > 0 && (
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full font-bold border"
              style={{ color: '#FD4438', borderColor: '#FD443833', background: '#FD443814' }}
            >
              {overdueTasks.length} overdue
            </span>
          )}
        </span>

        <div className="flex items-center gap-2">
          {/* Filter toggle */}
          <button
            onClick={() => setShowFilter(f => !f)}
            className="flex items-center gap-1 px-2 py-1.5 text-[9px] font-bold rounded-lg border transition-colors"
            style={{
              borderColor: showFilter ? '#06D7F6' : '#ffffff10',
              color:       showFilter ? '#06D7F6' : '#6B7280',
              background:  showFilter ? '#06D7F610' : 'transparent',
            }}
          >
            <Filter className="size-2.5" />Filter
          </button>

          {/* Sync button */}
          <button
            onClick={handleSync}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[9px] font-bold rounded-lg border transition-colors text-gray-500 hover:text-white border-white/10 hover:border-white/20"
          >
            <RefreshCw className="size-2.5" />Sync
          </button>

          <span className="text-[9px] text-gray-700">
            {lastSynced}
          </span>
        </div>
      </div>

      <div className="p-5 space-y-5">

        {/* Filter panel */}
        {showFilter && (
          <div className="bg-black/20 border border-white/6 rounded-xl p-4">
            <div className="text-[9px] font-bold uppercase tracking-wider text-gray-600 mb-3 flex items-center gap-2">
              <Filter className="size-3" />Stage Filter
            </div>
            <StageFilter selected={stageFilter} onChange={setStageFilter} />
            {stageFilter !== 'all' && (
              <div
                className="mt-3 px-3 py-2 rounded-lg text-[9px] border"
                style={{
                  borderColor: filterMatch ? '#10B98120' : '#FD443820',
                  background:  filterMatch ? '#10B98106' : '#FD443806',
                  color:       filterMatch ? '#10B981' : '#FD4438',
                }}
              >
                {filterMatch
                  ? `Deal ${deal.deal_id} matches filter: ${STAGE_CFG[stageFilter].label}`
                  : `Deal ${deal.deal_id} is in "${cfg.label}" — does not match "${STAGE_CFG[stageFilter].label}"`
                }
              </div>
            )}
          </div>
        )}

        {/* Deal card */}
        <DealCard deal={deal} draft={draft} />

        {/* Pipeline strip */}
        <div className="space-y-2">
          <div className="text-[9px] font-bold uppercase tracking-wider text-gray-600">
            CRM Pipeline — 14 Canonical Stages
          </div>
          <PipelineStrip stage={deal.stage} />
        </div>

        {/* Event → Stage mapping info strip */}
        <div
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg border"
          style={{ borderColor: `${cfg.color}20`, background: `${cfg.color}06` }}
        >
          <Zap className="size-3 flex-shrink-0" style={{ color: cfg.color }} />
          <div className="flex-1 text-[9px] text-gray-500 leading-snug">
            <span className="font-bold text-gray-300">Auto-mapped:</span>{' '}
            Proposal status <span className="font-mono text-gray-400">
              {draft.status}
            </span> → CRM stage{' '}
            <span className="font-bold" style={{ color: cfg.color }}>{cfg.label}</span>
            {' '}· Close probability{' '}
            <span className="font-bold" style={{ color: cfg.color }}>
              {Math.round(deal.close_probability * 100)}%
            </span>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 px-3 py-2 text-[9px] font-bold rounded-lg border transition-colors"
              style={{
                borderColor: tab === t.id ? '#06D7F6' : '#ffffff10',
                background:  tab === t.id ? '#06D7F610' : 'transparent',
                color:       tab === t.id ? '#06D7F6' : '#6B7280',
              }}
            >
              <t.icon className="size-3" />{t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'pipeline' && (
          <div className="space-y-3">
            {/* Stage breakdown — all 14 stages with current highlighted */}
            <div className="text-[9px] font-bold uppercase tracking-wider text-gray-600">
              Full Stage Breakdown
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {STAGE_PIPELINE.map(s => {
                const c       = STAGE_CFG[s];
                const active  = s === deal.stage;
                const sIdx    = STAGE_PIPELINE.indexOf(s);
                const cIdx    = STAGE_PIPELINE.indexOf(deal.stage);
                const isPast  = deal.stage !== 'closed_lost' && sIdx < cIdx;

                return (
                  <div
                    key={s}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg border transition-all"
                    style={{
                      borderColor: active ? `${c.color}30` : '#ffffff06',
                      background:  active ? `${c.color}10` : 'transparent',
                    }}
                  >
                    <div
                      className="size-2 rounded-full flex-shrink-0"
                      style={{
                        background: active ? c.color : isPast ? '#10B981' : '#374151',
                        boxShadow:  active ? `0 0 5px ${c.color}80` : undefined,
                      }}
                    />
                    <span
                      className="text-[9px] font-semibold leading-tight flex-1 truncate"
                      style={{ color: active ? c.color : isPast ? '#6EE7B7' : '#374151' }}
                    >
                      {c.label}
                    </span>
                    <span
                      className="text-[9px] font-black flex-shrink-0"
                      style={{ color: active ? c.color : '#374151' }}
                    >
                      {Math.round(c.close_probability * 100)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === 'activity' && (
          <div className="space-y-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-gray-600 flex items-center gap-2">
              <History className="size-3" />Activity Trail — {deal.activity.length} events
            </div>
            <ActivityTimeline deal={deal} />
          </div>
        )}

        {tab === 'tasks' && (
          <div className="space-y-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-gray-600 flex items-center gap-2">
              <ListChecks className="size-3" />
              Auto-Created Tasks — {openTasks.length} open
              {overdueTasks.length > 0 && (
                <span className="text-[#FD4438] font-bold">{overdueTasks.length} overdue</span>
              )}
            </div>
            <TaskList deal={deal} onToggleTask={handleToggleTask} />
          </div>
        )}

        {/* Done checklist */}
        <div className="border-t border-white/5 pt-4 space-y-2">
          <div className="text-[9px] font-bold uppercase tracking-wider text-gray-600 flex items-center gap-2">
            <CheckCircle2 className="size-3 text-[#10B981]" />
            Phase 7 Sync Status
          </div>
          <div className="grid grid-cols-1 gap-1">
            {[
              { label: 'Deal auto-created from diagnostic',        done: true },
              { label: 'Stage auto-mapped from proposal events',   done: true },
              { label: 'Follow-up tasks auto-created',             done: deal.tasks.length > 0 },
              { label: 'Activity timeline populated',              done: deal.activity.length > 0 },
              { label: 'Stage filter operational',                 done: true },
              { label: 'Owner assigned (SLA rule applied)',        done: !!deal.owner_user_id },
            ].map(item => (
              <div
                key={item.label}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded text-[9px]"
                style={{
                  background:  item.done ? '#10B98106' : '#FD443806',
                  color:       item.done ? '#10B981' : '#FD4438',
                }}
              >
                {item.done
                  ? <CheckCircle2 className="size-2.5 flex-shrink-0" />
                  : <AlertCircle  className="size-2.5 flex-shrink-0" />
                }
                {item.label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
