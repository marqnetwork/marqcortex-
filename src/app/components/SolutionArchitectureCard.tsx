/**
 * SOLUTION ARCHITECTURE CARD — solution-architecture-binding.md
 *
 * Renders the solutions[] and implementation_phases[] sections of a ProposalDraft.
 *
 * For each solution:
 *   - Header: pillar badge, title, linked diagnosis chips, complexity dots, confidence
 *   - Body: system description, implementation scope (2×2 grid), operational outcomes,
 *           financial levers (horizontal bars), dependencies, risk flags
 *
 * Phase Timeline:
 *   - Horizontal phase cards with duration, solution assignments, deliverables
 *
 * Edit rules:
 *   - Solutions are fully editable inline (per-row toggle like DiagnosisBlockCard)
 *   - Phase deliverables are editable; solution assignments via checkboxes
 *   - Every save bumps proposal version via onSave callback
 */

import React, { useState, useCallback } from 'react';
import {
  Bot, Workflow, TrendingUp, Activity,
  Layers, GitMerge, Cpu, Plug2,
  BarChart3, Calendar, Flag, Package, Clock,
  AlertCircle, Check, X, Edit3, Plus, Trash2,
  ChevronDown, ChevronRight, Info, Lock,
  Link2, Zap, DollarSign, Shield,
} from 'lucide-react';
import type {
  ProposalDraft, Solution, SolutionPillar,
  ImplementationPhase,
} from '@/app/types/cortex-types';

// ════════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════════════════════

const PILLAR_CFG: Record<SolutionPillar, {
  label: string; color: string; bg: string; Icon: React.FC<{ className?: string }>;
}> = {
  workflow:   { label: 'Workflow',   color: '#06D7F6', bg: 'bg-[#06D7F6]/10',  Icon: Workflow  },
  agents:     { label: 'Agents',     color: '#8B5CF6', bg: 'bg-[#8B5CF6]/10',  Icon: Bot       },
  revenue:    { label: 'Revenue',    color: '#10B981', bg: 'bg-[#10B981]/10',  Icon: TrendingUp},
  monitoring: { label: 'Monitoring', color: '#FB923C', bg: 'bg-[#FB923C]/10',  Icon: Activity  },
};

const LEVER_CFG = [
  { key: 'efficiency_gain' as const, label: 'Efficiency Gain',  color: '#06D7F6', Icon: Zap       },
  { key: 'revenue_uplift'  as const, label: 'Revenue Uplift',   color: '#10B981', Icon: TrendingUp},
  { key: 'cost_reduction'  as const, label: 'Cost Reduction',   color: '#8B5CF6', Icon: DollarSign},
  { key: 'risk_mitigation' as const, label: 'Risk Mitigation',  color: '#FB923C', Icon: Shield    },
];

const SCOPE_SECTIONS = [
  { key: 'systems_affected'   as const, label: 'Systems Affected',   Icon: Layers,   color: '#06D7F6' },
  { key: 'automation_layers'  as const, label: 'Automation Layers',  Icon: GitMerge, color: '#8B5CF6' },
  { key: 'ai_components'      as const, label: 'AI Components',      Icon: Cpu,      color: '#10B981' },
  { key: 'integration_points' as const, label: 'Integration Points', Icon: Plug2,    color: '#FB923C' },
];

// ════════════════════════════════════════════════════════════════════════════════
// SHARED PRIMITIVES
// ════════════════════════════════════════════════════════════════════════════════

function bumpVersion(draft: ProposalDraft): ProposalDraft['metadata'] {
  return {
    ...draft.metadata,
    version: draft.metadata.version + 1,
    last_updated_at: new Date().toISOString(),
  };
}

function MiniLabel({ children, color = '#6B7280' }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="text-[9px] font-bold uppercase tracking-wider mb-1.5" style={{ color }}>
      {children}
    </div>
  );
}

function ComplexityDots({ score, max = 5 }: { score: number; max?: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={`size-1.5 rounded-full ${i < score ? 'bg-[#FB923C]' : 'bg-white/10'}`}
        />
      ))}
    </span>
  );
}

function LeverBar({ value, color, label, Icon }: {
  value: number; color: string; label: string;
  Icon: React.FC<{ className?: string }>;
}) {
  const pct = Math.min(100, Math.max(0, value ?? 0));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-[9px] font-bold text-gray-500">
          <Icon className="size-2.5" style={{ color }} />{label}
        </span>
        <span className="text-[9px] font-bold font-mono" style={{ color }}>
          {pct > 0 ? `${pct}%` : '—'}
        </span>
      </div>
      <div className="h-1 bg-white/5 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color, opacity: pct > 0 ? 1 : 0.2 }}
        />
      </div>
    </div>
  );
}

function SmallList({
  items, color, icon: Icon,
}: { items: string[]; color: string; icon: React.FC<{ className?: string }> }) {
  if (!items.length) return <span className="text-[10px] text-gray-700 italic">None specified</span>;
  return (
    <ul className="space-y-0.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-1.5 text-[10px] text-gray-400">
          <span className="size-1 rounded-full mt-1.5 flex-shrink-0" style={{ background: color }} />
          {item}
        </li>
      ))}
    </ul>
  );
}

function StringListEditor({
  items, onChange, accent = '#8B5CF6', placeholder = 'Add item…',
}: {
  items: string[]; onChange: (items: string[]) => void;
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
// SOLUTION ROW (editable)
// ════════════════════════════════════════════════════════════════════════════════

function SolutionRow({
  solution, index, diagnosisBlocks, onUpdate, onRemove,
}: {
  solution: Solution;
  index: number;
  diagnosisBlocks: ProposalDraft['diagnosis_blocks'];
  onUpdate: (s: Solution) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(index === 0);
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState<Solution>({ ...solution });

  const pillarCfg = PILLAR_CFG[solution.pillar] ?? PILLAR_CFG['workflow'];
  const { Icon: PillarIcon } = pillarCfg;

  const handleSave = () => { onUpdate(local); setEditing(false); };
  const handleCancel = () => { setLocal({ ...solution }); setEditing(false); };

  const toggleDxLink = (dxId: string) => {
    const linked = local.linked_diagnosis_ids.includes(dxId)
      ? local.linked_diagnosis_ids.filter(id => id !== dxId)
      : [...local.linked_diagnosis_ids, dxId];
    setLocal(l => ({ ...l, linked_diagnosis_ids: linked }));
  };

  const setComplexity = (v: number) => setLocal(l => ({ ...l, complexity_score: v }));
  const setLever = (key: keyof Solution['financial_levers'], v: number) =>
    setLocal(l => ({ ...l, financial_levers: { ...l.financial_levers, [key]: v } }));

  return (
    <div className={`border rounded-xl overflow-hidden transition-colors bg-black/20 ${open ? 'border-white/10' : 'border-white/5'}`}>
      {/* ── Header row ── */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => setOpen(o => !o)} className="flex-1 flex items-center gap-3 text-left min-w-0">
          {/* Pillar badge */}
          <span
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-bold flex-shrink-0 ${pillarCfg.bg}`}
            style={{ color: pillarCfg.color }}
          >
            <PillarIcon className="size-2.5" />
            {pillarCfg.label}
          </span>

          {/* Title */}
          <span className="text-xs font-bold text-white flex-1 truncate min-w-0">
            {solution.title || `Solution ${index + 1}`}
          </span>

          {/* Linked diagnosis chips */}
          <span className="flex items-center gap-1 flex-shrink-0">
            {solution.linked_diagnosis_ids.map(id => (
              <span key={id} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-gray-500">{id}</span>
            ))}
          </span>

          {/* Complexity dots */}
          <ComplexityDots score={solution.complexity_score} />

          {/* Confidence */}
          <span className="text-[9px] font-bold font-mono text-gray-500 flex-shrink-0">
            {solution.confidence_score}% conf.
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

      {/* ── Expanded body ── */}
      {open && (
        <div className="border-t border-white/5 px-4 py-4">
          {editing ? (
            /* ─── EDIT MODE ─── */
            <div className="space-y-4">
              {/* Core identity */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <MiniLabel>Title</MiniLabel>
                  <input
                    value={local.title}
                    onChange={e => setLocal(l => ({ ...l, title: e.target.value }))}
                    className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#8B5CF6]/50"
                  />
                </div>
                <div className="space-y-1">
                  <MiniLabel>Pillar</MiniLabel>
                  <div className="flex gap-1.5">
                    {(Object.keys(PILLAR_CFG) as SolutionPillar[]).map(p => {
                      const cfg = PILLAR_CFG[p];
                      return (
                        <button
                          key={p}
                          onClick={() => setLocal(l => ({ ...l, pillar: p }))}
                          className="flex-1 py-1.5 rounded-lg text-[9px] font-bold border transition-all"
                          style={{
                            color:       local.pillar === p ? cfg.color : '#6B7280',
                            background:  local.pillar === p ? `${cfg.color}14` : 'transparent',
                            borderColor: local.pillar === p ? `${cfg.color}33` : '#ffffff10',
                          }}
                        >
                          {cfg.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Root problem + system description */}
              <div className="space-y-1">
                <MiniLabel color="#FB923C">Root Problem Addressed</MiniLabel>
                <textarea
                  value={local.root_problem_addressed}
                  onChange={e => setLocal(l => ({ ...l, root_problem_addressed: e.target.value }))}
                  rows={2}
                  className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-xs text-white resize-y focus:outline-none focus:border-[#8B5CF6]/50 placeholder:text-gray-700"
                  placeholder="What specific problem does this solution eliminate?"
                />
              </div>
              <div className="space-y-1">
                <MiniLabel color="#06D7F6">System Description</MiniLabel>
                <textarea
                  value={local.system_description}
                  onChange={e => setLocal(l => ({ ...l, system_description: e.target.value }))}
                  rows={3}
                  className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-xs text-white resize-y focus:outline-none focus:border-[#8B5CF6]/50 placeholder:text-gray-700"
                  placeholder="Boardroom-level explanation of what this system does and how it changes the operation…"
                />
              </div>

              {/* Linked diagnoses */}
              <div className="space-y-1">
                <MiniLabel>Linked Diagnoses</MiniLabel>
                <div className="flex flex-wrap gap-2">
                  {diagnosisBlocks.map(b => {
                    const linked = local.linked_diagnosis_ids.includes(b.diagnosis_id);
                    return (
                      <button
                        key={b.diagnosis_id}
                        onClick={() => toggleDxLink(b.diagnosis_id)}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all"
                        style={{
                          color:       linked ? '#10B981' : '#6B7280',
                          background:  linked ? '#10B98114' : 'transparent',
                          borderColor: linked ? '#10B98133' : '#ffffff10',
                        }}
                      >
                        <span className="font-mono text-[9px]">{b.diagnosis_id}</span>
                        {b.title.slice(0, 24)}{b.title.length > 24 ? '…' : ''}
                        {linked && <Check className="size-2.5" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Complexity + confidence */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <MiniLabel>Complexity (1–5)</MiniLabel>
                  <div className="flex gap-1.5">
                    {[1, 2, 3, 4, 5].map(n => (
                      <button
                        key={n}
                        onClick={() => setComplexity(n)}
                        className="flex-1 py-1.5 rounded-lg text-[10px] font-bold border transition-all"
                        style={{
                          color:       local.complexity_score === n ? '#FB923C' : '#6B7280',
                          background:  local.complexity_score === n ? '#FB923C14' : 'transparent',
                          borderColor: local.complexity_score === n ? '#FB923C33' : '#ffffff10',
                        }}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <MiniLabel>Confidence (0–100)</MiniLabel>
                  <div className="flex items-center gap-2">
                    <input
                      type="range" min={0} max={100}
                      value={local.confidence_score}
                      onChange={e => setLocal(l => ({ ...l, confidence_score: Number(e.target.value) }))}
                      className="flex-1 accent-[#8B5CF6]"
                    />
                    <span
                      className="text-xs font-bold font-mono w-8 text-right"
                      style={{ color: local.confidence_score >= 70 ? '#10B981' : '#FD4438' }}
                    >
                      {local.confidence_score}
                    </span>
                  </div>
                  <p className="text-[9px] text-gray-700">Gate requires ≥ 70</p>
                </div>
              </div>

              {/* Implementation scope — 2×2 grid */}
              <div>
                <MiniLabel color="#8B5CF6">Implementation Scope</MiniLabel>
                <div className="grid grid-cols-2 gap-3">
                  {SCOPE_SECTIONS.map(sc => (
                    <div key={sc.key} className="space-y-1">
                      <div className="text-[9px] font-bold text-gray-600 flex items-center gap-1">
                        <sc.Icon className="size-2.5" style={{ color: sc.color }} />{sc.label}
                      </div>
                      <StringListEditor
                        items={local.implementation_scope[sc.key]}
                        onChange={v => setLocal(l => ({
                          ...l, implementation_scope: { ...l.implementation_scope, [sc.key]: v },
                        }))}
                        accent={sc.color}
                        placeholder={`Add ${sc.label.toLowerCase()} item…`}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Operational outcomes */}
              <div className="space-y-1">
                <MiniLabel color="#10B981">Expected Operational Outcomes</MiniLabel>
                <StringListEditor
                  items={local.expected_operational_outcomes}
                  onChange={v => setLocal(l => ({ ...l, expected_operational_outcomes: v }))}
                  accent="#10B981"
                  placeholder="Add measurable outcome…"
                />
              </div>

              {/* Financial levers */}
              <div>
                <MiniLabel>Financial Levers (%)</MiniLabel>
                <div className="grid grid-cols-2 gap-3">
                  {LEVER_CFG.map(lc => (
                    <div key={lc.key} className="space-y-1">
                      <div className="flex items-center justify-between text-[9px]">
                        <span className="flex items-center gap-1" style={{ color: lc.color }}>
                          <lc.Icon className="size-2.5" />{lc.label}
                        </span>
                        <span className="font-mono font-bold" style={{ color: lc.color }}>
                          {local.financial_levers[lc.key]}%
                        </span>
                      </div>
                      <input
                        type="range" min={0} max={100}
                        value={local.financial_levers[lc.key]}
                        onChange={e => setLever(lc.key, Number(e.target.value))}
                        className="w-full"
                        style={{ accentColor: lc.color }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Dependencies + risk flags */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <MiniLabel color="#06D7F6">Dependencies</MiniLabel>
                  <StringListEditor
                    items={local.dependencies}
                    onChange={v => setLocal(l => ({ ...l, dependencies: v }))}
                    accent="#06D7F6"
                    placeholder="Add dependency…"
                  />
                </div>
                <div className="space-y-1">
                  <MiniLabel color="#FD4438">Risk Flags</MiniLabel>
                  <StringListEditor
                    items={local.risk_flags}
                    onChange={v => setLocal(l => ({ ...l, risk_flags: v }))}
                    accent="#FD4438"
                    placeholder="Add risk flag…"
                  />
                </div>
              </div>

              {/* Save / cancel */}
              <div className="flex gap-2 justify-end pt-1 border-t border-white/5">
                <button onClick={handleCancel} className="px-3 py-1.5 text-[10px] font-bold text-gray-500 hover:text-white border border-white/10 rounded-lg transition-colors">
                  Cancel
                </button>
                <button onClick={handleSave} className="px-3 py-1.5 text-[10px] font-bold text-[#10B981] bg-[#10B981]/10 border border-[#10B981]/25 rounded-lg hover:bg-[#10B981]/20 transition-colors flex items-center gap-1">
                  <Check className="size-3" />Save Solution
                </button>
              </div>
            </div>
          ) : (
            /* ─── VIEW MODE ─── */
            <div className="space-y-4">
              {/* Root problem */}
              {solution.root_problem_addressed && (
                <div className="border-l-2 pl-3" style={{ borderColor: pillarCfg.color }}>
                  <div className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: pillarCfg.color }}>
                    Root Problem Addressed
                  </div>
                  <p className="text-xs text-gray-400 leading-relaxed">{solution.root_problem_addressed}</p>
                </div>
              )}

              {/* System description */}
              <div>
                <MiniLabel color="#06D7F6">System Description</MiniLabel>
                <p className="text-xs text-gray-300 leading-relaxed">{solution.system_description}</p>
              </div>

              {/* Implementation scope — 2×2 grid */}
              <div>
                <MiniLabel color="#8B5CF6">Implementation Scope</MiniLabel>
                <div className="grid grid-cols-2 gap-4">
                  {SCOPE_SECTIONS.map(sc => (
                    <div key={sc.key}>
                      <div className="text-[9px] font-bold mb-1 flex items-center gap-1" style={{ color: sc.color }}>
                        <sc.Icon className="size-2.5" />{sc.label}
                      </div>
                      <SmallList
                        items={solution.implementation_scope[sc.key]}
                        color={sc.color}
                        icon={sc.Icon}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Operational outcomes */}
              {solution.expected_operational_outcomes.length > 0 && (
                <div>
                  <MiniLabel color="#10B981">Expected Operational Outcomes</MiniLabel>
                  <ul className="space-y-1">
                    {solution.expected_operational_outcomes.map((o, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-gray-300">
                        <span className="size-1.5 rounded-full bg-[#10B981] mt-1 flex-shrink-0" />
                        {o}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Financial levers */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <BarChart3 className="size-3 text-gray-600" />
                  <MiniLabel>Financial Impact Drivers</MiniLabel>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                  {LEVER_CFG.map(lc => (
                    <LeverBar
                      key={lc.key}
                      value={solution.financial_levers[lc.key] ?? 0}
                      color={lc.color}
                      label={lc.label}
                      Icon={lc.Icon}
                    />
                  ))}
                </div>
              </div>

              {/* Dependencies + risk flags */}
              {(solution.dependencies.length > 0 || solution.risk_flags.length > 0) && (
                <div className="grid grid-cols-2 gap-4 border-t border-white/5 pt-3">
                  {solution.dependencies.length > 0 && (
                    <div>
                      <div className="text-[9px] font-bold text-[#06D7F6] uppercase mb-1.5 flex items-center gap-1">
                        <Package className="size-2.5" />Dependencies
                      </div>
                      <SmallList items={solution.dependencies} color="#06D7F6" icon={Package} />
                    </div>
                  )}
                  {solution.risk_flags.length > 0 && (
                    <div>
                      <div className="text-[9px] font-bold text-[#FD4438] uppercase mb-1.5 flex items-center gap-1">
                        <AlertCircle className="size-2.5" />Risk Flags
                      </div>
                      <SmallList items={solution.risk_flags} color="#FD4438" icon={AlertCircle} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// PHASE TIMELINE
// ════════════════════════════════════════════════════════════════════════════════

function PhaseTimeline({
  phases, solutions, onUpdate,
}: {
  phases: ImplementationPhase[];
  solutions: Solution[];
  onUpdate: (phases: ImplementationPhase[]) => void;
}) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [localPhase, setLocalPhase] = useState<ImplementationPhase | null>(null);

  const startEdit = (i: number) => { setEditingIdx(i); setLocalPhase({ ...phases[i] }); };
  const cancelEdit = () => { setEditingIdx(null); setLocalPhase(null); };
  const saveEdit = (i: number) => {
    if (!localPhase) return;
    onUpdate(phases.map((p, idx) => idx === i ? localPhase : p));
    setEditingIdx(null);
    setLocalPhase(null);
  };

  const totalWeeks = phases.reduce((s, p) => s + p.duration_weeks, 0);

  if (!phases.length) return null;

  return (
    <div className="mt-6 pt-5 border-t border-white/5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-[10px] font-bold text-gray-500">
          <Calendar className="size-3" />
          IMPLEMENTATION PHASES · {phases.length} phases · {totalWeeks} weeks total
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {phases.map((phase, i) => {
          const phaseSolutions = solutions.filter(s => phase.solution_ids.includes(s.solution_id));
          const isEditing = editingIdx === i;

          return (
            <div key={phase.phase_number} className="bg-black/30 border border-white/8 rounded-xl overflow-hidden">
              {/* Phase header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-black text-white/20 font-mono leading-none">
                    {String(phase.phase_number).padStart(2, '0')}
                  </span>
                  <div>
                    <div className="text-xs font-bold text-white leading-tight">{phase.title}</div>
                    <div className="text-[9px] text-gray-600 flex items-center gap-1 mt-0.5">
                      <Clock className="size-2" />{phase.duration_weeks} weeks
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => isEditing ? cancelEdit() : startEdit(i)}
                  className="text-[9px] text-gray-600 hover:text-[#8B5CF6] transition-colors px-1.5 py-1 rounded hover:bg-[#8B5CF6]/10"
                >
                  {isEditing ? <X className="size-3" /> : <Edit3 className="size-3" />}
                </button>
              </div>

              <div className="p-3 space-y-2.5">
                {/* Solution assignments */}
                <div>
                  <div className="text-[9px] font-bold text-gray-600 uppercase mb-1.5 flex items-center gap-1">
                    <Link2 className="size-2.5" />Solutions
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {phaseSolutions.length > 0 ? phaseSolutions.map(s => {
                      const pc = PILLAR_CFG[s.pillar];
                      return (
                        <span
                          key={s.solution_id}
                          className="text-[9px] px-1.5 py-0.5 rounded font-bold"
                          style={{ color: pc.color, background: `${pc.color}14` }}
                        >
                          {s.solution_id}
                        </span>
                      );
                    }) : (
                      <span className="text-[9px] text-gray-700 italic">No solutions assigned</span>
                    )}
                  </div>
                </div>

                {/* Deliverables */}
                <div>
                  <div className="text-[9px] font-bold text-gray-600 uppercase mb-1.5 flex items-center gap-1">
                    <Flag className="size-2.5" />Deliverables
                  </div>
                  {isEditing && localPhase ? (
                    <div className="space-y-1.5">
                      <StringListEditor
                        items={localPhase.deliverables}
                        onChange={v => setLocalPhase(p => p ? { ...p, deliverables: v } : p)}
                        accent="#10B981"
                        placeholder="Add deliverable…"
                      />
                      <button
                        onClick={() => saveEdit(i)}
                        className="w-full mt-1 py-1 text-[9px] font-bold text-[#10B981] bg-[#10B981]/10 border border-[#10B981]/20 rounded-lg hover:bg-[#10B981]/20 transition-colors flex items-center justify-center gap-1"
                      >
                        <Check className="size-2.5" />Save Phase
                      </button>
                    </div>
                  ) : (
                    <ul className="space-y-0.5">
                      {phase.deliverables.map((d, di) => (
                        <li key={di} className="flex items-start gap-1.5 text-[10px] text-gray-400">
                          <span className="size-1 rounded-full bg-[#10B981] mt-1.5 flex-shrink-0" />{d}
                        </li>
                      ))}
                      {phase.deliverables.length === 0 && (
                        <li className="text-[10px] text-gray-700 italic">No deliverables defined</li>
                      )}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Duration bar */}
      <div className="flex items-center gap-1 mt-3">
        {phases.map((p, i) => (
          <div
            key={p.phase_number}
            className="h-1 rounded-full flex-1 relative"
            style={{
              background: i === 0 ? '#8B5CF6' : i === 1 ? '#06D7F6' : '#10B981',
              flexGrow: p.duration_weeks,
            }}
            title={`Phase ${p.phase_number}: ${p.duration_weeks} weeks`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[8px] text-gray-700 mt-1">
        <span>Week 1</span>
        <span>Week {totalWeeks}</span>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// ROOT EXPORT: SolutionArchitectureCard
// ════════════════════════════════════════════════════════════════════════════════

interface SolutionArchitectureCardProps {
  draft: ProposalDraft;
  onSave: (d: ProposalDraft) => void;
}

export function SolutionArchitectureCard({ draft, onSave }: SolutionArchitectureCardProps) {
  const solutions = draft.solutions ?? [];
  const phases    = draft.implementation_phases ?? [];

  const saveSolutions = useCallback((updated: Solution[]) => {
    onSave({ ...draft, solutions: updated, metadata: bumpVersion(draft) });
  }, [draft, onSave]);

  const savePhases = useCallback((updated: ImplementationPhase[]) => {
    onSave({ ...draft, implementation_phases: updated, metadata: bumpVersion(draft) });
  }, [draft, onSave]);

  const updateSolution = (i: number, s: Solution) => {
    saveSolutions(solutions.map((sol, idx) => idx === i ? s : sol));
  };

  const removeSolution = (i: number) => {
    saveSolutions(solutions.filter((_, idx) => idx !== i));
  };

  const addSolution = () => {
    const newSol: Solution = {
      solution_id:                   `SOL-0${solutions.length + 1}`,
      title:                         '',
      pillar:                        'workflow',
      linked_diagnosis_ids:          [],
      root_problem_addressed:        '',
      system_description:            '',
      implementation_scope:          { systems_affected: [], automation_layers: [], ai_components: [], integration_points: [] },
      expected_operational_outcomes: [],
      financial_levers:              { efficiency_gain: 0, revenue_uplift: 0, cost_reduction: 0, risk_mitigation: 0 },
      dependencies:                  [],
      risk_flags:                    [],
      complexity_score:              1,
      confidence_score:              70,
    };
    saveSolutions([...solutions, newSol]);
  };

  return (
    <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden">
      {/* Card header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5">
        <span className="flex items-center gap-2.5 text-sm font-bold text-white">
          <Bot className="size-4 flex-shrink-0 text-[#8B5CF6]" />
          Solution Architecture
          <span
            className="text-[9px] px-1.5 py-0.5 rounded-full font-bold border uppercase tracking-wider"
            style={{ color: '#8B5CF6', borderColor: '#8B5CF633', background: '#8B5CF614' }}
          >
            Phase 2
          </span>
          {solutions.length > 0 && (
            <span className="text-[9px] text-gray-600 font-normal">
              {solutions.length} solution{solutions.length !== 1 ? 's' : ''} · {phases.length} phase{phases.length !== 1 ? 's' : ''}
            </span>
          )}
        </span>
        <button
          onClick={addSolution}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-white/10 text-gray-400 text-[10px] font-bold rounded-lg hover:border-[#8B5CF6]/40 hover:text-[#8B5CF6] transition-colors"
        >
          <Plus className="size-3" />Add Solution
        </button>
      </div>

      <div className="p-5">
        {solutions.length === 0 ? (
          <div className="text-center py-10 space-y-2">
            <Bot className="size-8 text-gray-700 mx-auto" />
            <p className="text-sm font-bold text-gray-600">No solutions defined yet</p>
            <p className="text-xs text-gray-700 max-w-xs mx-auto">
              Phase 2 gate requires ≥ 2 solutions, each mapped to a confirmed diagnosis with measurable financial levers.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {solutions.map((sol, i) => (
              <SolutionRow
                key={sol.solution_id}
                solution={sol}
                index={i}
                diagnosisBlocks={draft.diagnosis_blocks}
                onUpdate={s => updateSolution(i, s)}
                onRemove={() => removeSolution(i)}
              />
            ))}
          </div>
        )}

        {/* Phase timeline — always shown if phases exist */}
        {phases.length > 0 && (
          <PhaseTimeline
            phases={phases}
            solutions={solutions}
            onUpdate={savePhases}
          />
        )}

        {solutions.length > 0 && (
          <p className="text-[9px] text-gray-700 flex items-center gap-1.5 mt-4 pt-3 border-t border-white/5">
            <Info className="size-2.5" />
            Phase 2 gate requires: ≥ 2 solutions, all diagnoses mapped, every solution has financial levers &gt; 0, every solution assigned to a phase, avg confidence ≥ 70.
          </p>
        )}
      </div>
    </div>
  );
}