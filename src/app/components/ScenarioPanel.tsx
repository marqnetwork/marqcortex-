/**
 * SCENARIO PANEL — finance_v4_scenarios
 *
 * §1 Purpose: one-click toggle between Conservative / Expected / Aggressive.
 * §5 Governance: switching triggers a version bump (via applyChangeRequest 'SwitchScenario').
 *
 * UI Sections:
 *   1. Scenario Toggle — 3 large interactive tabs
 *   2. Active Scenario Spotlight — ROI / NPV / Payback for selected scenario
 *   3. 3-Column Comparison Table — side-by-side all three scenarios
 *   4. Delta vs Expected — shows +/− differential for conservative and aggressive
 *   5. Locked Knobs Table — realization factors + ramp shift per scenario
 *   6. Governance Footer
 *
 * This component NEVER runs math. It reads scenario_model from PortfolioROIModel
 * and calls applyChangeRequest to switch scenarios (version bump per §5).
 */

import React, { useState } from 'react';
import {
  TrendingUp, TrendingDown, Minus, ChevronDown, ChevronRight,
  Shield, Zap, Target, Clock, Lock, RotateCcw, CheckCircle2, AlertTriangle, Activity,
} from 'lucide-react';
import { applyChangeRequest } from '@/app/core/versionEngine';
import type {
  ScenarioKey, ScenarioModel, ScenarioOutput, ScenarioPreset,
  PortfolioROIModel, PortfolioState, RecalcResult,
} from '@/app/core/types';
import { isScenarioModel } from '@/app/core/scenarioEngine';

// ════════════════════════════════════════════════════════════════════════════════
// SCENARIO CONFIG (colors + icons — display-only, not financial config)
// ════════════════════════════════════════════════════════════════════════════════

const SCENARIO_DISPLAY: Record<ScenarioKey, {
  label: string;
  subtitle: string;
  color: string;
  dimColor: string;
  bg: string;
  border: string;
  Icon: React.FC<{ className?: string }>;
}> = {
  conservative: {
    label: 'Conservative',
    subtitle: 'Low realization · +1mo ramp delay · Confidence capped at 80%',
    color: '#FB923C',
    dimColor: 'rgba(251,146,60,0.12)',
    bg: 'bg-[#FB923C]/5',
    border: 'border-[#FB923C]/20',
    Icon: Shield,
  },
  expected: {
    label: 'Expected',
    subtitle: 'Mid realization · Standard ramp · No confidence clamp',
    color: '#06D7F6',
    dimColor: 'rgba(6,215,246,0.12)',
    bg: 'bg-[#06D7F6]/5',
    border: 'border-[#06D7F6]/20',
    Icon: Target,
  },
  aggressive: {
    label: 'Aggressive',
    subtitle: 'High realization · −1mo accelerated ramp · Full adoption',
    color: '#10B981',
    dimColor: 'rgba(16,185,129,0.12)',
    bg: 'bg-[#10B981]/5',
    border: 'border-[#10B981]/20',
    Icon: Zap,
  },
};

const SCENARIOS: ScenarioKey[] = ['conservative', 'expected', 'aggressive'];

// ════════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════════

function fmt$(n: number): string {
  if (!isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

function fmtPct(n: number): string {
  return `${n.toFixed(0)}%`;
}

function fmtDelta(val: number, baseline: number): { text: string; positive: boolean; isZero: boolean } {
  const delta = val - baseline;
  if (Math.abs(delta) < 0.5) return { text: 'Same', positive: true, isZero: true };
  const positive = delta > 0;
  return {
    text: `${positive ? '+' : ''}${Math.round(delta)}`,
    positive,
    isZero: false,
  };
}

function DeltaBadge({ value, baseline, suffix = '' }: { value: number; baseline: number; suffix?: string }) {
  const { text, positive, isZero } = fmtDelta(value, baseline);
  if (isZero) return <span className="text-gray-600 text-[10px]">—</span>;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1 py-0 rounded ${
      positive ? 'text-[#10B981] bg-[#10B981]/10' : 'text-[#FD4438] bg-[#FD4438]/10'
    }`}>
      {positive ? <TrendingUp className="size-2.5" /> : <TrendingDown className="size-2.5" />}
      {text}{suffix}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// LOCKED KNOBS TABLE — realization factors per scenario
// ════════════════════════════════════════════════════════════════════════════════

function LockedKnobsTable({ presets }: { presets: Record<ScenarioKey, ScenarioPreset> }) {
  const [open, setOpen] = useState(false);

  const rows = [
    { label: 'Efficiency Realization', key: 'efficiency' as const, format: (v: number) => `${(v * 100).toFixed(0)}%` },
    { label: 'Cost Realization',       key: 'cost'       as const, format: (v: number) => `${(v * 100).toFixed(0)}%` },
    { label: 'Revenue Realization',    key: 'revenue'    as const, format: (v: number) => `${(v * 100).toFixed(0)}%` },
    { label: 'Risk Reduction',         key: 'risk'       as const, format: (v: number) => `${(v * 100).toFixed(0)}%` },
  ];

  return (
    <div className="bg-black/40 border border-white/10 rounded-xl overflow-hidden">
      <button
        className="flex items-center justify-between w-full px-5 py-3 hover:bg-white/[0.02] transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-xs font-bold text-white flex items-center gap-2">
          <Lock className="size-3.5 text-[#8B5CF6]" />
          Locked Knobs — §2 Scenario Preset Configuration
        </span>
        {open ? <ChevronDown className="size-3.5 text-gray-500" /> : <ChevronRight className="size-3.5 text-gray-500" />}
      </button>

      {open && (
        <div className="border-t border-white/5 overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-4 py-2 text-left text-[9px] font-bold uppercase tracking-wider text-gray-600">Parameter</th>
                {SCENARIOS.map(s => {
                  const cfg = SCENARIO_DISPLAY[s];
                  return (
                    <th key={s} className="px-4 py-2 text-center text-[9px] font-bold uppercase tracking-wider" style={{ color: cfg.color }}>
                      {cfg.label}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.key} className="border-b border-white/[0.03]">
                  <td className="px-4 py-2.5 text-gray-400 font-medium">{row.label}</td>
                  {SCENARIOS.map(s => (
                    <td key={s} className="px-4 py-2.5 text-center font-mono font-bold" style={{ color: SCENARIO_DISPLAY[s].color }}>
                      {row.format(presets[s].realization_factors[row.key])}
                    </td>
                  ))}
                </tr>
              ))}

              {/* Ramp shift row */}
              <tr className="border-b border-white/[0.03]">
                <td className="px-4 py-2.5 text-gray-400 font-medium">Ramp Speed Shift</td>
                {SCENARIOS.map(s => {
                  const shift = presets[s].ramp_shift_months;
                  return (
                    <td key={s} className="px-4 py-2.5 text-center font-mono font-bold" style={{ color: SCENARIO_DISPLAY[s].color }}>
                      {shift > 0 ? `+${shift}mo delay` : shift < 0 ? `${shift}mo faster` : 'Standard'}
                    </td>
                  );
                })}
              </tr>

              {/* Confidence clamp row */}
              <tr>
                <td className="px-4 py-2.5 text-gray-400 font-medium">Confidence Clamp</td>
                {SCENARIOS.map(s => {
                  const clamp = presets[s].confidence_clamp_max;
                  return (
                    <td key={s} className="px-4 py-2.5 text-center font-mono font-bold" style={{ color: SCENARIO_DISPLAY[s].color }}>
                      {clamp !== null ? `≤ ${clamp}%` : 'None'}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// ROOT EXPORT: ScenarioPanel
// ════════════════════════════════════════════════════════════════════════════════

interface ScenarioPanelProps {
  roiModel: PortfolioROIModel;
  portfolioState?: PortfolioState;
  onPortfolioUpdate?: (state: PortfolioState, result: RecalcResult) => void;
}

export function ScenarioPanel({ roiModel, portfolioState, onPortfolioUpdate }: ScenarioPanelProps) {
  const [switching, setSwitching] = useState<ScenarioKey | null>(null);

  const sm = roiModel.scenario_model;
  if (!sm || !isScenarioModel(sm)) {
    return (
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-5">
        <div className="flex items-center gap-3">
          <AlertTriangle className="size-5 text-[#FB923C]" />
          <span className="text-sm font-bold text-white">Scenario Model — Not Computed</span>
          <span className="text-[9px] px-2 py-0.5 rounded-full bg-[#FB923C]/10 text-[#FB923C] font-bold">finance_v4_scenarios</span>
        </div>
        <p className="text-xs text-gray-500 mt-2">Scenario model requires a valid portfolio ROI computation.</p>
      </div>
    );
  }

  const { active_scenario, scenario_outputs, scenario_presets, notes } = sm;
  const activeOutput   = scenario_outputs[active_scenario];
  const expectedOutput = scenario_outputs.expected;
  const activeCfg      = SCENARIO_DISPLAY[active_scenario];

  const handleSwitchScenario = async (newScenario: ScenarioKey) => {
    if (!portfolioState || !onPortfolioUpdate || newScenario === active_scenario) return;
    setSwitching(newScenario);
    try {
      const result = applyChangeRequest(
        portfolioState,
        {
          type: 'SwitchScenario',
          changes: [{
            path: 'active_scenario',
            value: newScenario,
            reason: `User switched scenario to ${newScenario} via Scenario Panel`,
          }],
        },
        'team_user',
        'manual_edit',
      );
      if (result.success) {
        onPortfolioUpdate(result.state, result);
      }
    } finally {
      setSwitching(null);
    }
  };

  return (
    <div className="space-y-4">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-lg bg-[#8B5CF6]/20 flex items-center justify-center flex-shrink-0">
            <RotateCcw className="size-4 text-[#8B5CF6]" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2 flex-wrap">
              Scenario Modeling
              <span className="text-[9px] px-2 py-0.5 rounded-full bg-[#8B5CF6]/10 border border-[#8B5CF6]/20 text-[#8B5CF6] font-bold uppercase tracking-wider">
                finance_v4_scenarios
              </span>
            </h3>
            <p className="text-[10px] text-gray-500 mt-0.5">
              Conservative / Expected / Aggressive · 3 locked presets · Version bump on switch · §5 governance
            </p>
          </div>
        </div>
      </div>

      {/* ── §1 Scenario Toggle ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        {SCENARIOS.map(s => {
          const cfg = SCENARIO_DISPLAY[s];
          const output = scenario_outputs[s];
          const isActive = s === active_scenario;
          const isLoading = switching === s;
          const cfg_icon = <cfg.Icon className="size-4 flex-shrink-0" />;

          return (
            <button
              key={s}
              onClick={() => handleSwitchScenario(s)}
              disabled={!portfolioState || !onPortfolioUpdate || isLoading}
              className={`relative flex flex-col p-4 rounded-xl border transition-all duration-300 text-left group ${
                isActive
                  ? `${cfg.bg} ${cfg.border} shadow-lg`
                  : 'bg-white/[0.02] border-white/[0.06] hover:border-white/15 hover:bg-white/[0.04]'
              }`}
            >
              {/* Active indicator */}
              {isActive && (
                <div className="absolute top-2 right-2">
                  <CheckCircle2 className="size-3.5" style={{ color: cfg.color }} />
                </div>
              )}

              {/* Loading spinner */}
              {isLoading && (
                <div className="absolute top-2 right-2">
                  <Activity className="size-3.5 animate-pulse text-gray-400" />
                </div>
              )}

              <div className="flex items-center gap-2 mb-2" style={{ color: isActive ? cfg.color : '#6B7280' }}>
                {cfg_icon}
                <span className={`text-xs font-bold ${isActive ? '' : 'text-gray-400'}`} style={{ color: isActive ? cfg.color : undefined }}>
                  {cfg.label}
                </span>
              </div>

              <div className="text-2xl font-black mb-0.5" style={{ color: isActive ? cfg.color : '#374151' }}>
                {fmtPct(output.roi_percent)}
              </div>
              <div className="text-[9px] text-gray-600">ROI</div>

              <div className="flex items-center gap-2 mt-2">
                <div className="text-[10px] text-gray-500">
                  NPV <span className="font-bold text-gray-300">{fmt$(output.npv)}</span>
                </div>
                <div className="text-[10px] text-gray-500">
                  Mo {output.payback_month ?? '>12'}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Active Scenario Spotlight ─────────────────────────────────────── */}
      <div className={`rounded-xl p-5 border ${activeCfg.bg} ${activeCfg.border}`}>
        <div className="flex items-start gap-4">
          <div className="flex items-center gap-2 flex-shrink-0">
            <activeCfg.Icon className="size-6" style={{ color: activeCfg.color }} />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: activeCfg.color }}>
                Active — {activeCfg.label}
              </div>
              <div className="text-[9px] text-gray-500 mt-0.5">{activeCfg.subtitle}</div>
            </div>
          </div>

          {/* Big numbers */}
          <div className="flex items-center gap-6 ml-auto flex-shrink-0 flex-wrap">
            {[
              { label: 'Portfolio ROI', value: fmtPct(activeOutput.roi_percent) },
              { label: 'NPV',           value: fmt$(activeOutput.npv) },
              { label: 'Payback',       value: activeOutput.payback_month !== null ? `Month ${activeOutput.payback_month}` : '> 12mo' },
            ].map(item => (
              <div key={item.label} className="text-center">
                <div className="text-[8px] font-bold uppercase tracking-wider text-gray-600">{item.label}</div>
                <div className="text-2xl font-black" style={{ color: activeCfg.color }}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 3-Column Comparison Table ─────────────────────────────────────── */}
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-white/5">
          <h4 className="text-sm font-bold text-white flex items-center gap-2">
            <Target className="size-4 text-[#06D7F6]" />
            Side-by-Side Comparison
            <span className="text-[9px] text-gray-600 font-normal">vs Expected baseline</span>
          </h4>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-5 py-2 text-left text-[9px] font-bold uppercase tracking-wider text-gray-600">Metric</th>
                {SCENARIOS.map(s => {
                  const cfg = SCENARIO_DISPLAY[s];
                  return (
                    <th key={s} className="px-4 py-2 text-center text-[9px] font-bold uppercase tracking-wider" style={{ color: cfg.color }}>
                      {cfg.label}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {/* ROI % */}
              <tr className="border-b border-white/[0.03]">
                <td className="px-5 py-3 text-gray-400 font-medium">Portfolio ROI</td>
                {SCENARIOS.map(s => {
                  const output = scenario_outputs[s];
                  const cfg    = SCENARIO_DISPLAY[s];
                  return (
                    <td key={s} className="px-4 py-3 text-center">
                      <div className="font-black text-sm" style={{ color: cfg.color }}>{fmtPct(output.roi_percent)}</div>
                      {s !== 'expected' && (
                        <div className="mt-0.5">
                          <DeltaBadge value={output.roi_percent} baseline={expectedOutput.roi_percent} suffix="pp" />
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>

              {/* NPV */}
              <tr className="border-b border-white/[0.03]">
                <td className="px-5 py-3 text-gray-400 font-medium">NPV (DCF)</td>
                {SCENARIOS.map(s => {
                  const output = scenario_outputs[s];
                  const cfg    = SCENARIO_DISPLAY[s];
                  return (
                    <td key={s} className="px-4 py-3 text-center">
                      <div className="font-bold text-sm" style={{ color: cfg.color }}>{fmt$(output.npv)}</div>
                      {s !== 'expected' && (
                        <div className="mt-0.5">
                          <DeltaBadge value={output.npv} baseline={expectedOutput.npv} />
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>

              {/* Payback */}
              <tr>
                <td className="px-5 py-3 text-gray-400 font-medium">Payback Month</td>
                {SCENARIOS.map(s => {
                  const output = scenario_outputs[s];
                  const cfg    = SCENARIO_DISPLAY[s];
                  const paybackVal = output.payback_month;
                  const expectedPb = expectedOutput.payback_month;
                  return (
                    <td key={s} className="px-4 py-3 text-center">
                      <div className="font-bold text-sm" style={{ color: cfg.color }}>
                        {paybackVal !== null ? `Month ${paybackVal}` : '> 12mo'}
                      </div>
                      {s !== 'expected' && paybackVal !== null && expectedPb !== null && (
                        <div className="mt-0.5">
                          {/* For payback, lower is better — flip delta positive logic */}
                          <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1 py-0 rounded ${
                            paybackVal < expectedPb ? 'text-[#10B981] bg-[#10B981]/10' : paybackVal > expectedPb ? 'text-[#FD4438] bg-[#FD4438]/10' : 'text-gray-600'
                          }`}>
                            {paybackVal < expectedPb ? <TrendingUp className="size-2.5" /> : paybackVal > expectedPb ? <TrendingDown className="size-2.5" /> : <Minus className="size-2.5" />}
                            {paybackVal - expectedPb > 0 ? '+' : ''}{paybackVal - expectedPb}mo
                          </span>
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Locked Knobs ─────────────────────────────────────────────────── */}
      <LockedKnobsTable presets={scenario_presets} />

      {/* ── Governance Footer ────────────────────────────────────────────── */}
      <div className="bg-white/[0.01] border border-white/[0.04] rounded-xl p-3">
        <p className="text-[9px] text-gray-700 leading-relaxed">
          <strong className="text-gray-600">finance_v4_scenarios Governance (§5):</strong>{' '}
          Scenario must NEVER change baselines or assumptions.
          Scenario must NEVER increase confidence scores.
          Investment cost is scenario-independent.
          Scenario selection triggers a version bump and is stored in version history.
          Gain tiers map to existing roi_range.low/mid/high_case — no re-computation of individual ROIs.
          Application order: Dependency Validation → Cost Model → Cash Flow → Apply Scenario Knobs → ROI math → DCF → IRR → Monte Carlo.
        </p>
      </div>

      {/* ── Notes / Audit ────────────────────────────────────────────────── */}
      {notes.length > 0 && (
        <div className="text-[9px] text-gray-700 space-y-0.5 px-1">
          {notes.map((note, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <span className="text-[#8B5CF6] mt-0.5 flex-shrink-0">§</span>
              {note}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
