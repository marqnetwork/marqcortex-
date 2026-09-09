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
import type { LucideIcon } from 'lucide-react';
import { applyChangeRequest } from '@/app/core/versionEngine';
import type {
  ScenarioKey, ScenarioModel, ScenarioOutput, ScenarioPreset,
  PortfolioROIModel, PortfolioState, RecalcResult,
} from '@/app/core/types';
import { isScenarioModel } from '@/app/core/scenarioEngine';
import {
  border as BORDER,
  status as STATUS,
} from '@/app/lib/tokens';

// ── Palette ──────────────────────────────────────────────────────────────────
//
// Read once at module scope. Deliberately not referenced as `status.x` inside
// the components below: one or more of them take a parameter of that name, and
// an unqualified reference there resolves to the parameter, not to the token.
const K_BORDER_STRONG = BORDER.strong;
const K_INFO          = STATUS.info;
const K_NEUTRAL       = STATUS.neutral;
const K_SUCCESS       = STATUS.success;
const K_WARNING       = STATUS.warning;


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
  Icon: LucideIcon;
}> = {
  conservative: {
    label: 'Conservative',
    subtitle: 'Low realization · +1mo ramp delay · Confidence capped at 80%',
    color: K_WARNING,
    dimColor: `${K_WARNING}1F`,
    bg: 'bg-cortex-warning/5',
    border: 'border-cortex-warning/20',
    Icon: Shield,
  },
  expected: {
    label: 'Expected',
    subtitle: 'Mid realization · Standard ramp · No confidence clamp',
    color: K_INFO,
    dimColor: `${K_INFO}1F`,
    bg: 'bg-cortex-info/5',
    border: 'border-cortex-info/20',
    Icon: Target,
  },
  aggressive: {
    label: 'Aggressive',
    subtitle: 'High realization · −1mo accelerated ramp · Full adoption',
    color: K_SUCCESS,
    dimColor: `${K_SUCCESS}1F`,
    bg: 'bg-cortex-success/5',
    border: 'border-cortex-success/20',
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
  if (isZero) return <span className="text-cortex-faint text-[10px]">—</span>;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1 py-0 rounded ${
      positive ? 'text-cortex-success bg-cortex-success/10' : 'text-cortex-danger bg-cortex-danger/10'
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
    <div className="bg-cortex-raised border border-cortex-default rounded-cortex-md overflow-hidden">
      <button
        className="flex items-center justify-between w-full px-5 py-3 hover:bg-white/[0.02] transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-xs font-bold text-white flex items-center gap-2">
          <Lock className="size-3.5 text-cortex-accent" />
          Locked Knobs — §2 Scenario Preset Configuration
        </span>
        {open ? <ChevronDown className="size-3.5 text-cortex-muted" /> : <ChevronRight className="size-3.5 text-cortex-muted" />}
      </button>

      {open && (
        <div className="border-t border-cortex-subtle overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-cortex-subtle">
                <th className="px-4 py-2 text-left text-[9px] font-bold uppercase tracking-wider text-cortex-faint">Parameter</th>
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
                  <td className="px-4 py-2.5 text-cortex-muted font-medium">{row.label}</td>
                  {SCENARIOS.map(s => (
                    <td key={s} className="px-4 py-2.5 text-center font-mono font-bold" style={{ color: SCENARIO_DISPLAY[s].color }}>
                      {row.format(presets[s].realization_factors[row.key])}
                    </td>
                  ))}
                </tr>
              ))}

              {/* Ramp shift row */}
              <tr className="border-b border-white/[0.03]">
                <td className="px-4 py-2.5 text-cortex-muted font-medium">Ramp Speed Shift</td>
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
                <td className="px-4 py-2.5 text-cortex-muted font-medium">Confidence Clamp</td>
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
      <div className="bg-cortex-raised backdrop-blur-xl border border-cortex-default rounded-cortex-md p-5">
        <div className="flex items-center gap-3">
          <AlertTriangle className="size-5 text-cortex-warning" />
          <span className="text-sm font-bold text-white">Scenario Model — Not Computed</span>
          <span className="text-[9px] px-2 py-0.5 rounded-full bg-cortex-warning/10 text-cortex-warning font-bold">finance_v4_scenarios</span>
        </div>
        <p className="text-xs text-cortex-muted mt-2">Scenario model requires a valid portfolio ROI computation.</p>
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
          <div className="size-8 rounded-cortex-sm bg-cortex-accent/20 flex items-center justify-center flex-shrink-0">
            <RotateCcw className="size-4 text-cortex-accent" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2 flex-wrap">
              Scenario Modeling
              <span className="text-[9px] px-2 py-0.5 rounded-full bg-cortex-accent/10 border border-cortex-accent/20 text-cortex-accent font-bold uppercase tracking-wider">
                finance_v4_scenarios
              </span>
            </h3>
            <p className="text-[10px] text-cortex-muted mt-0.5">
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
              className={`relative flex flex-col p-4 rounded-cortex-md border transition-all duration-300 text-left group ${
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
                  <Activity className="size-3.5 animate-pulse text-cortex-muted" />
                </div>
              )}

              <div className="flex items-center gap-2 mb-2" style={{ color: isActive ? cfg.color : K_NEUTRAL }}>
                {cfg_icon}
                <span className={`text-xs font-bold ${isActive ? '' : 'text-cortex-muted'}`} style={{ color: isActive ? cfg.color : undefined }}>
                  {cfg.label}
                </span>
              </div>

              <div className="text-2xl font-black mb-0.5" style={{ color: isActive ? cfg.color : K_BORDER_STRONG }}>
                {fmtPct(output.roi_percent)}
              </div>
              <div className="text-[9px] text-cortex-faint">ROI</div>

              <div className="flex items-center gap-2 mt-2">
                <div className="text-[10px] text-cortex-muted">
                  NPV <span className="font-bold text-cortex-secondary">{fmt$(output.npv)}</span>
                </div>
                <div className="text-[10px] text-cortex-muted">
                  Mo {output.payback_month ?? '>12'}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Active Scenario Spotlight ─────────────────────────────────────── */}
      <div className={`rounded-cortex-md p-5 border ${activeCfg.bg} ${activeCfg.border}`}>
        <div className="flex items-start gap-4">
          <div className="flex items-center gap-2 flex-shrink-0">
            <activeCfg.Icon className="size-6" style={{ color: activeCfg.color }} />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: activeCfg.color }}>
                Active — {activeCfg.label}
              </div>
              <div className="text-[9px] text-cortex-muted mt-0.5">{activeCfg.subtitle}</div>
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
                <div className="text-[8px] font-bold uppercase tracking-wider text-cortex-faint">{item.label}</div>
                <div className="text-2xl font-black" style={{ color: activeCfg.color }}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 3-Column Comparison Table ─────────────────────────────────────── */}
      <div className="bg-cortex-raised backdrop-blur-xl border border-cortex-default rounded-cortex-md overflow-hidden">
        <div className="px-5 py-3 border-b border-cortex-subtle">
          <h4 className="text-sm font-bold text-white flex items-center gap-2">
            <Target className="size-4 text-cortex-info" />
            Side-by-Side Comparison
            <span className="text-[9px] text-cortex-faint font-normal">vs Expected baseline</span>
          </h4>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-cortex-subtle">
                <th className="px-5 py-2 text-left text-[9px] font-bold uppercase tracking-wider text-cortex-faint">Metric</th>
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
                <td className="px-5 py-3 text-cortex-muted font-medium">Portfolio ROI</td>
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
                <td className="px-5 py-3 text-cortex-muted font-medium">NPV (DCF)</td>
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
                <td className="px-5 py-3 text-cortex-muted font-medium">Payback Month</td>
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
                            paybackVal < expectedPb ? 'text-cortex-success bg-cortex-success/10' : paybackVal > expectedPb ? 'text-cortex-danger bg-cortex-danger/10' : 'text-cortex-faint'
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
      <div className="bg-white/[0.01] border border-white/[0.04] rounded-cortex-md p-3">
        <p className="text-[9px] text-cortex-faint leading-relaxed">
          <strong className="text-cortex-faint">finance_v4_scenarios Governance (§5):</strong>{' '}
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
        <div className="text-[9px] text-cortex-faint space-y-0.5 px-1">
          {notes.map((note, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <span className="text-cortex-accent mt-0.5 flex-shrink-0">§</span>
              {note}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
