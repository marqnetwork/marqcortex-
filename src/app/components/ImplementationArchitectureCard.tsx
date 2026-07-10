/**
 * IMPLEMENTATION ARCHITECTURE CARD — implementation-architecture.md
 *
 * Three sections + governance panel:
 *   1. Implementation Roadmap — expandable phase cards with milestones &
 *      governance checkpoints (fully editable)
 *   2. Team & Responsibility Matrix — Cortex Team | Client Team columns
 *      with role, responsibility, phase involvement
 *   3. Technical Architecture Overview — systems, data sources, automation
 *      tools, AI models, security considerations (all editable string lists)
 *   4. Governance Controls — 4 boolean toggles (editable)
 *
 * Phase 4 gate validates this entire section before final export.
 */

import React, { useState, useCallback } from 'react';
import {
  Layers, Download, Flag, UserCheck, Users,
  Milestone, Calendar, CheckCircle2, AlertCircle,
  Database, Settings, Bot, Shield, Key,
  ChevronDown, ChevronRight, Edit3, Check, X,
  Plus, Trash2, Clock, MapPin, Lock, Unlock,
  RefreshCw, GitBranch,
} from 'lucide-react';
import type {
  ProposalDraft,
  ImplementationPlan,
  ImplementationPlanPhase,
  ImplementationMilestone,
  GovernanceCheckpoint,
  GovernanceCheckpointType,
  TeamMember,
} from '@/app/types/cortex-types';

// ════════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════════════════════

const PHASE_COLORS: Record<number, string> = {
  1: '#06D7F6',
  2: '#8B5CF6',
  3: '#FB923C',
};
function phaseColor(n: number): string { return PHASE_COLORS[n] ?? '#6B7280'; }

const CHECKPOINT_CFG: Record<GovernanceCheckpointType, { label: string; color: string; Icon: React.FC<{ className?: string }> }> = {
  internal_validation: { label: 'Internal Validation', color: '#06D7F6', Icon: CheckCircle2 },
  client_review:       { label: 'Client Review',       color: '#8B5CF6', Icon: UserCheck   },
  sign_off:            { label: 'Sign-Off',             color: '#10B981', Icon: Check       },
  roi_recheck:         { label: 'ROI Recheck',          color: '#FB923C', Icon: RefreshCw   },
};

const INTEGRATION_SECTIONS: {
  key: keyof ImplementationPlan['integration_architecture'];
  label: string;
  color: string;
  Icon: React.FC<{ className?: string }>;
}[] = [
  { key: 'systems_affected',      label: 'Systems Affected',      color: '#06D7F6', Icon: Layers   },
  { key: 'data_sources',          label: 'Data Sources',          color: '#8B5CF6', Icon: Database },
  { key: 'automation_tools',      label: 'Automation Tools',      color: '#10B981', Icon: Settings },
  { key: 'ai_models_used',        label: 'AI Models Used',        color: '#FB923C', Icon: Bot      },
  { key: 'security_considerations', label: 'Security Controls',   color: '#FD4438', Icon: Shield   },
];

const GOVERNANCE_FLAGS: {
  key: keyof ImplementationPlan['governance_controls'];
  label: string;
  description: string;
  Icon: React.FC<{ className?: string }>;
}[] = [
  { key: 'human_in_loop',                    label: 'Human-in-Loop',          description: 'Human oversight required for all AI decisions', Icon: UserCheck },
  { key: 'approval_required_for_automation', label: 'Approval Required',      description: 'Explicit approval before any automation goes live', Icon: Check     },
  { key: 'quarterly_review',                 label: 'Quarterly Review',       description: 'Scheduled QBR cadence for performance + ROI', Icon: Calendar  },
  { key: 'roi_revalidation_required',        label: 'ROI Revalidation',       description: 'ROI must be revalidated after each deployment phase', Icon: RefreshCw },
];

// ════════════════════════════════════════════════════════════════════════════════
// SHARED PRIMITIVES
// ════════════════════════════════════════════════════════════════════════════════

function MiniLabel({ children, color = '#6B7280' }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="text-[9px] font-bold uppercase tracking-wider mb-1.5" style={{ color }}>
      {children}
    </div>
  );
}

function PhaseChip({ n }: { n: number }) {
  const c = phaseColor(n);
  return (
    <span
      className="text-[9px] font-bold px-1.5 py-0.5 rounded font-mono"
      style={{ background: `${c}20`, color: c, border: `1px solid ${c}33` }}
    >
      P{n}
    </span>
  );
}

function StringListEditor({
  items, onChange, accent = '#8B5CF6', placeholder = 'Add item…',
}: {
  items: string[]; onChange: (v: string[]) => void;
  accent?: string; placeholder?: string;
}) {
  const [newItem, setNewItem] = useState('');
  const add = () => { const v = newItem.trim(); if (v) { onChange([...items, v]); setNewItem(''); } };
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const update  = (i: number, v: string) => onChange(items.map((it, idx) => idx === i ? v : it));
  return (
    <div className="space-y-1">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5 group">
          <span className="size-1.5 rounded-full flex-shrink-0" style={{ background: accent }} />
          <input
            value={item}
            onChange={e => update(i, e.target.value)}
            className="flex-1 bg-transparent text-[10px] text-gray-300 focus:outline-none focus:text-white border-b border-transparent focus:border-white/10 py-0.5"
          />
          <button onClick={() => remove(i)} className="opacity-0 group-hover:opacity-100 text-gray-700 hover:text-[#FD4438] transition-all">
            <Trash2 className="size-2.5" />
          </button>
        </div>
      ))}
      <div className="flex gap-1.5 mt-1">
        <input
          value={newItem}
          onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder={placeholder}
          className="flex-1 bg-white/[0.03] border border-white/8 rounded px-2 py-1 text-[10px] text-white placeholder:text-gray-700 focus:outline-none focus:border-white/20"
        />
        <button
          onClick={add}
          className="px-2 py-1 rounded text-[9px] font-bold flex items-center gap-0.5 transition-colors"
          style={{ background: `${accent}20`, color: accent }}
        >
          <Plus className="size-2.5" />Add
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// MILESTONE ROW (view + edit)
// ════════════════════════════════════════════════════════════════════════════════

function MilestoneRow({
  milestone, phaseNum, editing,
  onUpdate, onRemove,
}: {
  milestone: ImplementationMilestone;
  phaseNum: number;
  editing: boolean;
  onUpdate: (m: ImplementationMilestone) => void;
  onRemove: () => void;
}) {
  const [local, setLocal] = useState({ ...milestone });
  const color = phaseColor(phaseNum);

  if (editing) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-2">
        <div className="grid grid-cols-[auto_1fr_1fr] gap-2 items-start">
          {/* Week */}
          <div className="space-y-1">
            <MiniLabel color={color}>Wk</MiniLabel>
            <input
              type="number" min={1} max={52}
              value={local.week}
              onChange={e => setLocal(l => ({ ...l, week: Number(e.target.value) }))}
              className="w-10 bg-white/[0.04] border border-white/10 rounded px-1.5 py-1 text-[10px] text-white focus:outline-none focus:border-white/25 text-center"
            />
          </div>
          {/* Title */}
          <div className="space-y-1">
            <MiniLabel color={color}>Milestone Title</MiniLabel>
            <input
              value={local.title}
              onChange={e => setLocal(l => ({ ...l, title: e.target.value }))}
              placeholder="Milestone title…"
              className="w-full bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[10px] text-white focus:outline-none focus:border-white/25"
            />
          </div>
          {/* Owner */}
          <div className="space-y-1">
            <MiniLabel color={color}>Owner</MiniLabel>
            <input
              value={local.owner}
              onChange={e => setLocal(l => ({ ...l, owner: e.target.value }))}
              placeholder="Role / name…"
              className="w-full bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[10px] text-white focus:outline-none focus:border-white/25"
            />
          </div>
        </div>
        {/* Deliverables */}
        <div className="space-y-1">
          <MiniLabel color={color}>Deliverables</MiniLabel>
          <StringListEditor
            items={local.deliverables}
            onChange={v => setLocal(l => ({ ...l, deliverables: v }))}
            accent={color}
            placeholder="Add deliverable…"
          />
        </div>
        {/* Save / Remove */}
        <div className="flex justify-between pt-1 border-t border-white/5">
          <button onClick={onRemove} className="text-[9px] text-gray-700 hover:text-[#FD4438] transition-colors flex items-center gap-1">
            <Trash2 className="size-2.5" />Remove milestone
          </button>
          <button
            onClick={() => onUpdate(local)}
            className="text-[9px] font-bold text-[#10B981] hover:text-white transition-colors flex items-center gap-1 px-2.5 py-1 bg-[#10B981]/10 rounded border border-[#10B981]/25"
          >
            <Check className="size-2.5" />Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-white/[0.04] last:border-0">
      {/* Week badge */}
      <div
        className="flex-shrink-0 size-7 rounded-full flex items-center justify-center text-[9px] font-black"
        style={{ background: `${color}20`, color }}
      >
        W{milestone.week}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold text-white">{milestone.title}</div>
        <div className="flex items-center gap-1 mt-0.5">
          <UserCheck className="size-2.5" style={{ color }} />
          <span className="text-[9px] text-gray-500">{milestone.owner}</span>
        </div>
        {milestone.deliverables.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {milestone.deliverables.map((d, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[9px] text-gray-500">
                <span className="size-1 rounded-full mt-1 flex-shrink-0" style={{ background: color }} />
                {d}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// GOVERNANCE CHECKPOINT CHIP
// ════════════════════════════════════════════════════════════════════════════════

function GovernanceChip({ checkpoint }: { checkpoint: GovernanceCheckpoint }) {
  const cfg = CHECKPOINT_CFG[checkpoint.type] ?? CHECKPOINT_CFG.internal_validation;
  const { Icon } = cfg;
  return (
    <div
      className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg border text-[9px]"
      style={{ color: cfg.color, borderColor: `${cfg.color}33`, background: `${cfg.color}0A` }}
    >
      <Icon className="size-2.5 flex-shrink-0 mt-0.5" />
      <div>
        <span className="font-bold">{cfg.label}</span>
        {checkpoint.required && (
          <span className="ml-1 text-[8px] uppercase tracking-wider opacity-60">required</span>
        )}
        {checkpoint.description && (
          <div className="text-gray-600 mt-0.5">{checkpoint.description}</div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// PHASE CARD (roadmap section)
// ════════════════════════════════════════════════════════════════════════════════

function PhaseCard({
  phase, solutions, editing, onUpdate,
}: {
  phase: ImplementationPlanPhase;
  solutions: ProposalDraft['solutions'];
  editing: boolean;
  onUpdate: (p: ImplementationPlanPhase) => void;
}) {
  const [open, setOpen]         = useState(true);
  const [local, setLocal]       = useState<ImplementationPlanPhase>({ ...phase });
  const [addingCp, setAddingCp] = useState(false);
  const [newCpType, setNewCpType] = useState<GovernanceCheckpointType>('internal_validation');
  const [newCpDesc, setNewCpDesc] = useState('');

  const color = phaseColor(phase.phase_number);
  const linkedSolutions = (solutions ?? []).filter(s => phase.solution_ids.includes(s.solution_id));

  const updateMilestone = (idx: number, m: ImplementationMilestone) => {
    const updated = { ...local, milestones: local.milestones.map((ms, i) => i === idx ? m : ms) };
    setLocal(updated);
    onUpdate(updated);
  };

  const removeMilestone = (idx: number) => {
    const updated = { ...local, milestones: local.milestones.filter((_, i) => i !== idx) };
    setLocal(updated);
    onUpdate(updated);
  };

  const addMilestone = () => {
    const nextWeek = Math.max(0, ...local.milestones.map(m => m.week)) + 1;
    const updated = {
      ...local,
      milestones: [...local.milestones, {
        week: nextWeek, title: 'New Milestone', owner: '', deliverables: [],
      }],
    };
    setLocal(updated);
    onUpdate(updated);
  };

  const addCheckpoint = () => {
    const updated = {
      ...local,
      governance_checkpoints: [
        ...local.governance_checkpoints,
        { type: newCpType, required: true, description: newCpDesc },
      ],
    };
    setLocal(updated);
    onUpdate(updated);
    setAddingCp(false);
    setNewCpType('internal_validation');
    setNewCpDesc('');
  };

  const removeCheckpoint = (idx: number) => {
    const updated = {
      ...local,
      governance_checkpoints: local.governance_checkpoints.filter((_, i) => i !== idx),
    };
    setLocal(updated);
    onUpdate(updated);
  };

  return (
    <div className="border rounded-xl overflow-hidden transition-colors bg-black/20" style={{ borderColor: `${color}33` }}>
      {/* ── Phase header ── */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        {/* Phase number badge */}
        <span
          className="flex-shrink-0 size-7 rounded-full text-[10px] font-black flex items-center justify-center"
          style={{ background: `${color}20`, color }}
        >
          {phase.phase_number}
        </span>

        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-white">{phase.title}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[9px] text-gray-600 flex items-center gap-1">
              <Clock className="size-2.5" />{phase.duration_weeks}w
            </span>
            <span className="text-[9px] text-gray-600 flex items-center gap-1">
              <Milestone className="size-2.5" />{local.milestones.length} milestones
            </span>
            <span className="text-[9px] text-gray-600 flex items-center gap-1">
              <Shield className="size-2.5" />{local.governance_checkpoints.length} checkpoints
            </span>
            {/* Linked solution chips */}
            {linkedSolutions.map(s => (
              <span
                key={s.solution_id}
                className="text-[8px] font-mono px-1 py-0.5 rounded"
                style={{ background: `${color}14`, color }}
              >
                {s.solution_id}
              </span>
            ))}
          </div>
        </div>

        {open
          ? <ChevronDown  className="size-3.5 text-gray-600 flex-shrink-0" />
          : <ChevronRight className="size-3.5 text-gray-600 flex-shrink-0" />
        }
      </button>

      {/* ── Expanded body ── */}
      {open && (
        <div className="border-t px-4 py-4 space-y-4" style={{ borderColor: `${color}1A` }}>
          {/* Milestones */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <MiniLabel color={color}>Milestones</MiniLabel>
              {editing && (
                <button
                  onClick={addMilestone}
                  className="text-[9px] font-bold flex items-center gap-0.5 px-2 py-0.5 rounded transition-colors"
                  style={{ color, background: `${color}14` }}
                >
                  <Plus className="size-2.5" />Add Milestone
                </button>
              )}
            </div>
            <div>
              {local.milestones.map((ms, idx) => (
                <MilestoneRow
                  key={idx}
                  milestone={ms}
                  phaseNum={phase.phase_number}
                  editing={editing}
                  onUpdate={m => updateMilestone(idx, m)}
                  onRemove={() => removeMilestone(idx)}
                />
              ))}
            </div>
          </div>

          {/* Governance checkpoints */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <MiniLabel color="#10B981">Governance Checkpoints</MiniLabel>
              {editing && !addingCp && (
                <button
                  onClick={() => setAddingCp(true)}
                  className="text-[9px] font-bold flex items-center gap-0.5 px-2 py-0.5 rounded bg-[#10B981]/10 text-[#10B981] transition-colors"
                >
                  <Plus className="size-2.5" />Add
                </button>
              )}
            </div>

            <div className="space-y-1.5">
              {local.governance_checkpoints.map((cp, idx) => (
                <div key={idx} className="flex items-start gap-1.5">
                  <div className="flex-1">
                    <GovernanceChip checkpoint={cp} />
                  </div>
                  {editing && (
                    <button
                      onClick={() => removeCheckpoint(idx)}
                      className="text-gray-700 hover:text-[#FD4438] transition-colors pt-1.5"
                    >
                      <Trash2 className="size-2.5" />
                    </button>
                  )}
                </div>
              ))}

              {/* Add checkpoint inline form */}
              {editing && addingCp && (
                <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <MiniLabel color="#10B981">Type</MiniLabel>
                      <select
                        value={newCpType}
                        onChange={e => setNewCpType(e.target.value as GovernanceCheckpointType)}
                        className="w-full bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[10px] text-white focus:outline-none"
                      >
                        <option value="internal_validation">Internal Validation</option>
                        <option value="client_review">Client Review</option>
                        <option value="sign_off">Sign-Off</option>
                        <option value="roi_recheck">ROI Recheck</option>
                      </select>
                    </div>
                    <div>
                      <MiniLabel>Description (optional)</MiniLabel>
                      <input
                        value={newCpDesc}
                        onChange={e => setNewCpDesc(e.target.value)}
                        placeholder="Checkpoint detail…"
                        className="w-full bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[10px] text-white focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setAddingCp(false)} className="text-[9px] text-gray-600 hover:text-white px-2 py-1">Cancel</button>
                    <button onClick={addCheckpoint} className="text-[9px] font-bold text-[#10B981] bg-[#10B981]/10 border border-[#10B981]/25 px-2 py-1 rounded flex items-center gap-1">
                      <Plus className="size-2.5" />Add
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// TEAM MATRIX
// ════════════════════════════════════════════════════════════════════════════════

function TeamMemberRow({
  member, accent, editing, onUpdate, onRemove,
}: {
  member: TeamMember; accent: string; editing: boolean;
  onUpdate: (m: TeamMember) => void; onRemove: () => void;
}) {
  const [local, setLocal] = useState({ ...member });

  if (editing) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <MiniLabel color={accent}>Role</MiniLabel>
            <input
              value={local.role}
              onChange={e => setLocal(l => ({ ...l, role: e.target.value }))}
              className="w-full bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[10px] text-white focus:outline-none"
              placeholder="Role title…"
            />
          </div>
          <div className="space-y-1">
            <MiniLabel color={accent}>Phase Involvement (CSV)</MiniLabel>
            <input
              value={local.involvement_phase.join(',')}
              onChange={e => {
                const phases = e.target.value.split(',').map(v => parseInt(v.trim(), 10)).filter(n => !isNaN(n));
                setLocal(l => ({ ...l, involvement_phase: phases }));
              }}
              placeholder="1,2,3"
              className="w-full bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[10px] text-white focus:outline-none"
            />
          </div>
        </div>
        <div className="space-y-1">
          <MiniLabel color={accent}>Responsibility</MiniLabel>
          <input
            value={local.responsibility}
            onChange={e => setLocal(l => ({ ...l, responsibility: e.target.value }))}
            className="w-full bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[10px] text-white focus:outline-none"
            placeholder="What this person does…"
          />
        </div>
        <div className="flex justify-between pt-1 border-t border-white/5">
          <button onClick={onRemove} className="text-[9px] text-gray-700 hover:text-[#FD4438] flex items-center gap-1">
            <Trash2 className="size-2.5" />Remove
          </button>
          <button
            onClick={() => onUpdate(local)}
            className="text-[9px] font-bold text-[#10B981] bg-[#10B981]/10 border border-[#10B981]/25 px-2.5 py-1 rounded flex items-center gap-1"
          >
            <Check className="size-2.5" />Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="py-2.5 border-b border-white/[0.04] last:border-0">
      <div className="flex items-start gap-2">
        <span className="size-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: accent }} />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-white">{member.role}</div>
          <div className="text-[9px] text-gray-500 mt-0.5 leading-relaxed">{member.responsibility}</div>
          <div className="flex items-center gap-1 mt-1">
            {member.involvement_phase.map(p => <PhaseChip key={p} n={p} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamColumn({
  title, members, accent, editing,
  onUpdateMembers,
}: {
  title: string; members: TeamMember[]; accent: string;
  editing: boolean; onUpdateMembers: (m: TeamMember[]) => void;
}) {
  const [local, setLocal] = useState<TeamMember[]>(members);

  const update = (idx: number, m: TeamMember) => {
    const next = local.map((item, i) => i === idx ? m : item);
    setLocal(next);
    onUpdateMembers(next);
  };
  const remove = (idx: number) => {
    const next = local.filter((_, i) => i !== idx);
    setLocal(next);
    onUpdateMembers(next);
  };
  const add = () => {
    const next = [...local, { role: 'New Role', responsibility: '', involvement_phase: [1] }];
    setLocal(next);
    onUpdateMembers(next);
  };

  return (
    <div className="flex-1 min-w-0 bg-white/[0.02] border border-white/8 rounded-xl overflow-hidden">
      {/* Column header */}
      <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between"
        style={{ background: `${accent}0A` }}>
        <div className="flex items-center gap-2">
          <Users className="size-3" style={{ color: accent }} />
          <span className="text-[10px] font-bold" style={{ color: accent }}>{title}</span>
          <span className="text-[9px] text-gray-600">({local.length} members)</span>
        </div>
        {editing && (
          <button
            onClick={add}
            className="text-[9px] font-bold flex items-center gap-0.5 px-1.5 py-0.5 rounded transition-colors"
            style={{ color: accent, background: `${accent}14` }}
          >
            <Plus className="size-2.5" />Add
          </button>
        )}
      </div>
      <div className="px-4 py-2">
        {local.map((m, idx) => (
          <TeamMemberRow
            key={idx}
            member={m}
            accent={accent}
            editing={editing}
            onUpdate={u => update(idx, u)}
            onRemove={() => remove(idx)}
          />
        ))}
        {local.length === 0 && (
          <p className="text-[10px] text-gray-700 italic py-3 text-center">No members added</p>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// ROOT EXPORT: ImplementationArchitectureCard
// ════════════════════════════════════════════════════════════════════════════════

interface ImplementationArchitectureCardProps {
  draft: ProposalDraft;
  onSave: (partial: Partial<ProposalDraft>) => void;
}

export function ImplementationArchitectureCard({ draft, onSave }: ImplementationArchitectureCardProps) {
  const plan      = draft.implementation_plan;
  const solutions = draft.solutions ?? [];

  const [editingRoadmap,      setEditingRoadmap]     = useState(false);
  const [editingTeam,         setEditingTeam]         = useState(false);
  const [editingIntegration,  setEditingIntegration]  = useState(false);
  const [localPlan, setLocalPlan] = useState<ImplementationPlan | undefined>(plan);

  const save = useCallback((nextPlan: ImplementationPlan) => {
    setLocalPlan(nextPlan);
    onSave({ implementation_plan: nextPlan });
  }, [onSave]);

  const updatePhase = (idx: number, phase: ImplementationPlanPhase) => {
    if (!localPlan) return;
    const next = { ...localPlan, phases: localPlan.phases.map((p, i) => i === idx ? phase : p) };
    save(next);
  };

  const toggleGovernanceControl = (key: keyof ImplementationPlan['governance_controls']) => {
    if (!localPlan) return;
    const next = {
      ...localPlan,
      governance_controls: { ...localPlan.governance_controls, [key]: !localPlan.governance_controls[key] },
    };
    save(next);
  };

  const updateIntegrationField = (key: keyof ImplementationPlan['integration_architecture'], value: string[]) => {
    if (!localPlan) return;
    const next = { ...localPlan, integration_architecture: { ...localPlan.integration_architecture, [key]: value } };
    save(next);
  };

  const totalWeeks = (localPlan?.phases ?? []).reduce((s, p) => s + (p.duration_weeks ?? 0), 0);
  const allPhases  = localPlan?.phases ?? [];

  if (!localPlan) {
    return (
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-white/5">
          <GitBranch className="size-4 text-[#FB923C]" />
          <span className="text-sm font-bold text-white">Implementation Architecture</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold border uppercase tracking-wider"
            style={{ color: '#FB923C', borderColor: '#FB923C33', background: '#FB923C14' }}>Phase 4</span>
        </div>
        <div className="p-10 text-center space-y-2">
          <GitBranch className="size-8 text-gray-700 mx-auto" />
          <p className="text-sm font-bold text-gray-600">Implementation plan not yet defined</p>
          <p className="text-xs text-gray-700 max-w-sm mx-auto">
            The implementation plan defines WHO, WHEN, HOW, and WHAT SYSTEMS are involved.
            Required for Phase 4 gate and final proposal export.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden">
      {/* ── Card header ── */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5">
        <span className="flex items-center gap-2.5 text-sm font-bold text-white">
          <GitBranch className="size-4 text-[#FB923C]" />
          Implementation Architecture
          <span
            className="text-[9px] px-1.5 py-0.5 rounded-full font-bold border uppercase tracking-wider"
            style={{ color: '#FB923C', borderColor: '#FB923C33', background: '#FB923C14' }}
          >
            Phase 4
          </span>
          <span className="text-[9px] text-gray-600 font-normal">
            {allPhases.length} phases · {totalWeeks} weeks total
          </span>
        </span>
        <span className="text-[9px] text-gray-700 flex items-center gap-1">
          <Download className="size-2.5" />Export gate target
        </span>
      </div>

      <div className="p-5 space-y-6">

        {/* ══ SECTION 1: IMPLEMENTATION ROADMAP ══ */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[9px] font-bold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
              <Milestone className="size-2.5 text-[#06D7F6]" />Implementation Roadmap
            </div>
            <button
              onClick={() => setEditingRoadmap(e => !e)}
              className="text-[9px] font-bold flex items-center gap-1 px-2 py-1 rounded border transition-colors"
              style={editingRoadmap
                ? { color: '#10B981', borderColor: '#10B98133', background: '#10B98114' }
                : { color: '#6B7280', borderColor: '#ffffff10', background: 'transparent' }
              }
            >
              {editingRoadmap ? <span className="contents"><Check className="size-2.5" />Done</span> : <span className="contents"><Edit3 className="size-2.5" />Edit Phases</span>}
            </button>
          </div>

          <div className="space-y-3">
            {allPhases.map((phase, idx) => (
              <PhaseCard
                key={phase.phase_number}
                phase={phase}
                solutions={solutions}
                editing={editingRoadmap}
                onUpdate={p => updatePhase(idx, p)}
              />
            ))}
          </div>
        </div>

        {/* ══ SECTION 2: TEAM & RESPONSIBILITY MATRIX ══ */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[9px] font-bold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
              <Users className="size-2.5 text-[#8B5CF6]" />Team & Responsibility Matrix
            </div>
            <button
              onClick={() => setEditingTeam(e => !e)}
              className="text-[9px] font-bold flex items-center gap-1 px-2 py-1 rounded border transition-colors"
              style={editingTeam
                ? { color: '#10B981', borderColor: '#10B98133', background: '#10B98114' }
                : { color: '#6B7280', borderColor: '#ffffff10', background: 'transparent' }
              }
            >
              {editingTeam ? <span className="contents"><Check className="size-2.5" />Done</span> : <span className="contents"><Edit3 className="size-2.5" />Edit Team</span>}
            </button>
          </div>

          <div className="flex gap-3">
            <TeamColumn
              title="MARQ Cortex Team"
              members={localPlan.team_structure?.cortex_team ?? []}
              accent="#8B5CF6"
              editing={editingTeam}
              onUpdateMembers={members => save({
                ...localPlan,
                team_structure: { ...localPlan.team_structure, cortex_team: members },
              })}
            />
            <TeamColumn
              title="Client Team Required"
              members={localPlan.team_structure?.client_team_required ?? []}
              accent="#06D7F6"
              editing={editingTeam}
              onUpdateMembers={members => save({
                ...localPlan,
                team_structure: { ...localPlan.team_structure, client_team_required: members },
              })}
            />
          </div>
        </div>

        {/* ══ SECTION 3: TECHNICAL ARCHITECTURE OVERVIEW ══ */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[9px] font-bold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="size-2.5 text-[#10B981]" />Technical Architecture Overview
            </div>
            <button
              onClick={() => setEditingIntegration(e => !e)}
              className="text-[9px] font-bold flex items-center gap-1 px-2 py-1 rounded border transition-colors"
              style={editingIntegration
                ? { color: '#10B981', borderColor: '#10B98133', background: '#10B98114' }
                : { color: '#6B7280', borderColor: '#ffffff10', background: 'transparent' }
              }
            >
              {editingIntegration ? <span className="contents"><Check className="size-2.5" />Done</span> : <span className="contents"><Edit3 className="size-2.5" />Edit Architecture</span>}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {INTEGRATION_SECTIONS.map(({ key, label, color, Icon }) => {
              const items = localPlan.integration_architecture?.[key] ?? [];
              return (
                <div key={key} className="bg-white/[0.02] border border-white/8 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className="size-3" style={{ color }} />
                    <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color }}>{label}</span>
                    <span
                      className="ml-auto text-[9px] font-mono px-1.5 py-0.5 rounded"
                      style={{ color, background: `${color}14` }}
                    >
                      {items.length}
                    </span>
                  </div>

                  {editingIntegration ? (
                    <StringListEditor
                      items={items}
                      onChange={v => updateIntegrationField(key, v)}
                      accent={color}
                      placeholder={`Add ${label.toLowerCase()}…`}
                    />
                  ) : (
                    <ul className="space-y-1">
                      {items.map((item, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-[9px] text-gray-500">
                          <span className="size-1 rounded-full mt-1.5 flex-shrink-0" style={{ background: color }} />
                          {item}
                        </li>
                      ))}
                      {items.length === 0 && (
                        <li className="text-[9px] text-gray-700 italic">Not yet defined</li>
                      )}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ══ SECTION 4: GOVERNANCE CONTROLS ══ */}
        <div className="space-y-3">
          <div className="text-[9px] font-bold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
            <Shield className="size-2.5 text-[#10B981]" />Governance Controls
            <span className="text-gray-700 font-normal normal-case">— toggleable, required for Phase 4 gate</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {GOVERNANCE_FLAGS.map(({ key, label, description, Icon }) => {
              const active = localPlan.governance_controls?.[key] ?? false;
              return (
                <button
                  key={key}
                  onClick={() => toggleGovernanceControl(key)}
                  className="flex items-start gap-3 p-3 rounded-xl border text-left transition-all"
                  style={{
                    borderColor: active ? `${active ? '#10B981' : '#6B7280'}30` : '#ffffff0A',
                    background:  active ? '#10B98108' : 'transparent',
                  }}
                >
                  <div
                    className="flex-shrink-0 size-6 rounded-full flex items-center justify-center mt-0.5 transition-colors"
                    style={{
                      background: active ? '#10B98120' : 'rgba(255,255,255,0.04)',
                      color:      active ? '#10B981' : '#4B5563',
                    }}
                  >
                    {active ? <Lock className="size-3" /> : <Unlock className="size-3" />}
                  </div>
                  <div>
                    <div className="text-[10px] font-bold" style={{ color: active ? '#10B981' : '#6B7280' }}>
                      {label}
                    </div>
                    <div className="text-[9px] text-gray-700 mt-0.5 leading-relaxed">{description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}