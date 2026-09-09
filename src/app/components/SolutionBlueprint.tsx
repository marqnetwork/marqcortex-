/**
 * SOLUTION BLUEPRINT
 *
 * Multi-section operational document replacing the shallow recommendation view.
 * Renders phased implementation plans, deliverables matrix, KPI dashboard,
 * risk register, and financial summary.
 *
 * Integrated into the Recommendation tab of CortexDashboard.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Target, Zap, CheckCircle2, Clock, ChevronDown, ChevronRight,
  DollarSign, AlertTriangle, Users, BarChart3, Shield, Calendar,
  TrendingUp, FileText, ArrowRight, Milestone,
} from 'lucide-react';
// `SolutionBlueprint.phases` is `BlueprintPhase[]` — the recommendation-engine
// phase model (name / duration / objectives / structured deliverables /
// milestones / teamRequired / risksMitigated). It is a different domain object
// from the proposal-draft `ImplementationPhase` (phase_number / title /
// duration_weeks / solution_ids / string deliverables), which this file
// previously named by mistake while reading every field off BlueprintPhase.
import type { SolutionBlueprint as SolutionBlueprintType, BlueprintPhase, BlueprintKPI, BlueprintRisk } from '@/app/types/cortex-types';
import {
  border as BORDER,
  brand,
  status as STATUS,
} from '@/app/lib/tokens';


// ── Props ─────────────────────────────────────────────────────────────────────

interface SolutionBlueprintProps {
  blueprint: SolutionBlueprintType;
  companyName: string;
}

// ── Phase colors ──────────────────────────────────────────────────────────────

const PHASE_COLORS = [
  { primary: brand.accent, bg: `${brand.accent}1F`, border: `${brand.accent}4C` },
  { primary: brand.accentAlt, bg: `${brand.accentAlt}1F`, border: `${brand.accentAlt}4C` },
  { primary: STATUS.info, bg: `${STATUS.info}1F`, border: `${STATUS.info}4C` },
  { primary: STATUS.success, bg: `${STATUS.success}1F`, border: `${STATUS.success}4C` },
];

const RISK_COLORS = {
  high: { bg: `${STATUS.danger}1F`, text: STATUS.danger, border: `${STATUS.danger}4C` },
  medium: { bg: `${STATUS.warning}1F`, text: STATUS.warning, border: `${STATUS.warning}4C` },
  low: { bg: `${STATUS.success}1F`, text: STATUS.success, border: `${STATUS.success}4C` },
};

// ── Main component ────────────────────────────────────────────────────────────

export function SolutionBlueprintView({ blueprint, companyName }: SolutionBlueprintProps) {
  const [activeSection, setActiveSection] = useState<string>('roadmap');

  const sections = [
    { id: 'roadmap', label: 'Implementation Roadmap', icon: Calendar },
    { id: 'deliverables', label: 'Deliverables Matrix', icon: FileText },
    { id: 'kpis', label: 'Success KPIs', icon: BarChart3 },
    { id: 'resources', label: 'Resource Plan', icon: Users },
    { id: 'risks', label: 'Risk Register', icon: Shield },
    { id: 'financials', label: 'Investment Summary', icon: DollarSign },
  ];

  return (
    <div className="space-y-6">
      {/* Executive Summary */}
      <div className="bg-gradient-to-br from-cortex-accent/10 to-cortex-accent-alt/10 border border-cortex-accent/20 rounded-cortex-md p-6">
        <div className="flex items-start gap-3 mb-4">
          <Target className="size-6 text-cortex-accent flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-lg font-bold text-white mb-2">Executive Summary</h3>
            <p className="text-sm text-cortex-secondary leading-relaxed">{blueprint.executiveSummary}</p>
          </div>
        </div>
      </div>

      {/* Section nav */}
      <div className="flex gap-1.5 flex-wrap">
        {sections.map(sec => (
          <button
            key={sec.id}
            onClick={() => setActiveSection(sec.id)}
            className={`px-3 py-2 rounded-cortex-sm text-sm font-medium flex items-center gap-1.5 transition-all ${
              activeSection === sec.id
                ? 'bg-cortex-accent text-white'
                : 'bg-cortex-control text-cortex-muted hover:bg-cortex-control-hover hover:text-white'
            }`}
          >
            <sec.icon className="size-3.5" />
            {sec.label}
          </button>
        ))}
      </div>

      {/* Section content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeSection}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
        >
          {activeSection === 'roadmap' && <RoadmapSection phases={blueprint.phases} />}
          {activeSection === 'deliverables' && <DeliverablesSection phases={blueprint.phases} />}
          {activeSection === 'kpis' && <KPISection kpis={blueprint.kpis} companyName={companyName} />}
          {activeSection === 'resources' && <ResourceSection resources={blueprint.resourcePlan} phases={blueprint.phases} />}
          {activeSection === 'risks' && <RiskSection risks={blueprint.riskRegister} />}
          {activeSection === 'financials' && <FinancialSection investment={blueprint.investmentSummary} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ── Implementation Roadmap ────────────────────────────────────────────────────

function RoadmapSection({ phases }: { phases: BlueprintPhase[] }) {
  const [expandedPhase, setExpandedPhase] = useState<number>(0);

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold flex items-center gap-2">
        <Calendar className="size-5 text-cortex-accent" />
        Phased Implementation Roadmap
      </h3>

      {/* Timeline visual */}
      <div className="bg-cortex-raised backdrop-blur-xl border border-cortex-default rounded-cortex-md p-6">
        <div className="flex items-center gap-2 mb-6">
          {phases.map((phase, idx) => {
            const color = PHASE_COLORS[idx % PHASE_COLORS.length];
            return (
              <div key={idx} className="flex-1 flex items-center gap-2">
                <div
                  className="flex-1 h-2 rounded-full"
                  style={{ backgroundColor: color.bg, border: `1px solid ${color.border}` }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{ backgroundColor: color.primary, width: '100%' }}
                  />
                </div>
                {idx < phases.length - 1 && (
                  <ArrowRight className="size-4 text-cortex-faint flex-shrink-0" />
                )}
              </div>
            );
          })}
        </div>
        <div className="flex items-start gap-2">
          {phases.map((phase, idx) => {
            const color = PHASE_COLORS[idx % PHASE_COLORS.length];
            return (
              <div key={idx} className="flex-1 text-center">
                <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: color.primary }}>
                  Phase {idx + 1}
                </div>
                <div className="text-sm font-semibold text-white">{phase.name}</div>
                <div className="text-[11px] text-cortex-muted">{phase.duration}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Phase cards */}
      {phases.map((phase, idx) => {
        const color = PHASE_COLORS[idx % PHASE_COLORS.length];
        const isExpanded = expandedPhase === idx;

        return (
          <div
            key={idx}
            className="rounded-cortex-md overflow-hidden"
            style={{ backgroundColor: color.bg, border: `1px solid ${color.border}` }}
          >
            <button
              onClick={() => setExpandedPhase(isExpanded ? -1 : idx)}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-cortex-control transition-colors"
            >
              <div className="flex items-center gap-4">
                <div
                  className="size-10 rounded-full flex items-center justify-center text-lg font-bold"
                  style={{ backgroundColor: color.primary, color: 'white' }}
                >
                  {idx + 1}
                </div>
                <div className="text-left">
                  <div className="font-bold text-white">{phase.name}</div>
                  <div className="text-xs text-cortex-muted">{phase.duration} &middot; {phase.deliverables.length} deliverables</div>
                </div>
              </div>
              {isExpanded ? <ChevronDown className="size-5 text-cortex-muted" /> : <ChevronRight className="size-5 text-cortex-muted" />}
            </button>

            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-6 pb-5 space-y-5">
                    {/* Objectives */}
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wider text-cortex-muted mb-2">Objectives</div>
                      <ul className="space-y-1.5">
                        {phase.objectives.map((obj, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-cortex-secondary">
                            <CheckCircle2 className="size-4 flex-shrink-0 mt-0.5" style={{ color: color.primary }} />
                            {obj}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Deliverables */}
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wider text-cortex-muted mb-2">Deliverables</div>
                      <div className="space-y-2">
                        {phase.deliverables.map((del, i) => (
                          <div key={i} className="bg-cortex-sunken rounded-cortex-sm p-3">
                            <div className="text-sm font-semibold text-white mb-1">{del.item}</div>
                            <div className="text-xs text-cortex-muted">{del.description}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Milestones */}
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wider text-cortex-muted mb-2">Milestones</div>
                      <div className="flex flex-wrap gap-2">
                        {phase.milestones.map((ms, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-cortex-sm text-xs"
                            style={{ backgroundColor: BORDER.subtle, border: `1px solid ${BORDER.default}` }}
                          >
                            <Clock className="size-3" style={{ color: color.primary }} />
                            <span className="font-bold" style={{ color: color.primary }}>{ms.day}</span>
                            <span className="text-cortex-secondary">{ms.milestone}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Team + Risks */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wider text-cortex-muted mb-2">Team Required</div>
                        <div className="flex flex-wrap gap-1.5">
                          {phase.teamRequired.map((role, i) => (
                            <span key={i} className="px-2 py-1 rounded-full bg-cortex-control border border-cortex-default text-xs text-cortex-secondary">
                              {role}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wider text-cortex-muted mb-2">Risks Mitigated</div>
                        <div className="flex flex-wrap gap-1.5">
                          {phase.risksMitigated.map((risk, i) => (
                            <span key={i} className="px-2 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: `${STATUS.success}1F`, color: STATUS.success, border: `1px solid ${STATUS.success}4C` }}>
                              {risk}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {phase.linkedBottleneck && (
                      <div className="text-xs text-cortex-muted flex items-center gap-1 pt-2 border-t border-cortex-subtle">
                        <Zap className="size-3 text-cortex-info" />
                        Addresses Core Problem: <span className="text-cortex-info font-semibold">{phase.linkedBottleneck}</span>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

// ── Deliverables Matrix ───────────────────────────────────────────────────────

function DeliverablesSection({ phases }: { phases: BlueprintPhase[] }) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold flex items-center gap-2">
        <FileText className="size-5 text-cortex-accent-alt" />
        Complete Deliverables Matrix
      </h3>

      <div className="bg-cortex-raised backdrop-blur-xl border border-cortex-default rounded-cortex-md overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-cortex-default">
              <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-cortex-muted">Phase</th>
              <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-cortex-muted">Deliverable</th>
              <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-cortex-muted">Description</th>
              <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-cortex-muted">Timeline</th>
            </tr>
          </thead>
          <tbody>
            {phases.map((phase, phaseIdx) =>
              phase.deliverables.map((del, delIdx) => {
                const color = PHASE_COLORS[phaseIdx % PHASE_COLORS.length];
                return (
                  <tr
                    key={`${phaseIdx}-${delIdx}`}
                    className="border-b border-cortex-subtle hover:bg-white/3 transition-colors"
                  >
                    {delIdx === 0 ? (
                      <td
                        className="px-4 py-3 text-sm font-bold align-top"
                        rowSpan={phase.deliverables.length}
                        style={{ color: color.primary }}
                      >
                        Phase {phaseIdx + 1}
                      </td>
                    ) : null}
                    <td className="px-4 py-3 text-sm font-medium text-white">{del.item}</td>
                    <td className="px-4 py-3 text-xs text-cortex-muted max-w-xs">{del.description}</td>
                    <td className="px-4 py-3 text-xs text-cortex-muted">{phase.duration}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── KPI Dashboard ─────────────────────────────────────────────────────────────

function KPISection({ kpis, companyName }: { kpis: BlueprintKPI[]; companyName: string }) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold flex items-center gap-2">
        <BarChart3 className="size-5 text-cortex-success" />
        Success KPIs for {companyName}
      </h3>

      <div className="grid grid-cols-1 gap-3">
        {kpis.map((kpi, idx) => (
          <div key={idx} className="bg-cortex-raised backdrop-blur-xl border border-cortex-default rounded-cortex-md p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="text-sm font-bold text-white mb-1">{kpi.metric}</div>
                <div className="text-xs text-cortex-muted">Measured via: {kpi.measurementMethod}</div>
              </div>
              <TrendingUp className="size-5 text-cortex-success" />
            </div>
            <div className="grid grid-cols-4 gap-4">
              <KPICell label="Baseline" value={kpi.baseline} color={STATUS.neutral} />
              <KPICell label="30-Day Target" value={kpi.target30} color={STATUS.warning} />
              <KPICell label="60-Day Target" value={kpi.target60} color={brand.accentAlt} />
              <KPICell label="90-Day Target" value={kpi.target90} color={STATUS.success} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KPICell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="text-center">
      <div className="text-[10px] font-bold uppercase tracking-wider text-cortex-muted mb-1">{label}</div>
      <div className="text-lg font-bold" style={{ color }}>{value}</div>
    </div>
  );
}

// ── Resource Plan ─────────────────────────────────────────────────────────────

function ResourceSection({ resources, phases }: { resources: SolutionBlueprintType['resourcePlan']; phases: BlueprintPhase[] }) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold flex items-center gap-2">
        <Users className="size-5 text-cortex-info" />
        Resource Allocation Plan
      </h3>

      <div className="bg-cortex-raised backdrop-blur-xl border border-cortex-default rounded-cortex-md overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-cortex-default">
              <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-cortex-muted">Role</th>
              <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-cortex-muted">Allocation</th>
              <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-cortex-muted">Active During</th>
            </tr>
          </thead>
          <tbody>
            {resources.map((res, idx) => (
              <tr key={idx} className="border-b border-cortex-subtle hover:bg-white/3 transition-colors">
                <td className="px-4 py-3 text-sm font-medium text-white">{res.role}</td>
                <td className="px-4 py-3 text-sm text-cortex-secondary">{res.allocation}</td>
                <td className="px-4 py-3 text-xs text-cortex-muted">{res.phase}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Risk Register ─────────────────────────────────────────────────────────────

function RiskSection({ risks }: { risks: BlueprintRisk[] }) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold flex items-center gap-2">
        <Shield className="size-5 text-cortex-warning" />
        Risk Register & Mitigation
      </h3>

      <div className="space-y-3">
        {risks.map((risk, idx) => {
          const probColor = RISK_COLORS[risk.probability];
          const impactColor = RISK_COLORS[risk.impact];
          return (
            <div key={idx} className="bg-cortex-raised backdrop-blur-xl border border-cortex-default rounded-cortex-md p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="size-5 flex-shrink-0 mt-0.5" style={{ color: impactColor.text }} />
                  <div>
                    <div className="text-sm font-bold text-white mb-1">{risk.risk}</div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ backgroundColor: probColor.bg, color: probColor.text, border: `1px solid ${probColor.border}` }}>
                        Probability: {risk.probability}
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ backgroundColor: impactColor.bg, color: impactColor.text, border: `1px solid ${impactColor.border}` }}>
                        Impact: {risk.impact}
                      </span>
                    </div>
                  </div>
                </div>
                <span className="text-xs text-cortex-muted">Owner: {risk.owner}</span>
              </div>
              <div className="bg-cortex-success/10 border border-cortex-success/20 rounded-cortex-sm p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-cortex-success mb-1">Mitigation Strategy</div>
                <p className="text-xs text-cortex-secondary">{risk.mitigation}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Financial Summary ─────────────────────────────────────────────────────────

function FinancialSection({ investment }: { investment: SolutionBlueprintType['investmentSummary'] }) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold flex items-center gap-2">
        <DollarSign className="size-5 text-cortex-success" />
        Investment & ROI Summary
      </h3>

      {/* Total investment */}
      <div className="bg-gradient-to-br from-cortex-success/10 to-cortex-accent-alt/10 border border-cortex-success/20 rounded-cortex-md p-6">
        <div className="grid grid-cols-3 gap-6">
          <div className="text-center">
            <div className="text-xs font-bold uppercase tracking-wider text-cortex-muted mb-2">Total Investment</div>
            <div className="text-3xl font-bold text-cortex-success">{investment.totalRange}</div>
          </div>
          <div className="text-center">
            <div className="text-xs font-bold uppercase tracking-wider text-cortex-muted mb-2">Payback Period</div>
            <div className="text-3xl font-bold text-cortex-accent-alt">{investment.paybackPeriod}</div>
          </div>
          <div className="text-center">
            <div className="text-xs font-bold uppercase tracking-wider text-cortex-muted mb-2">12-Month ROI</div>
            <div className="text-3xl font-bold text-cortex-accent">{investment.roiTimeline}</div>
          </div>
        </div>
      </div>

      {/* Phase breakdown */}
      <div className="bg-cortex-raised backdrop-blur-xl border border-cortex-default rounded-cortex-md p-5">
        <div className="text-xs font-bold uppercase tracking-wider text-cortex-muted mb-4">Cost Breakdown by Phase</div>
        <div className="space-y-3">
          {investment.breakdownByPhase.map((item, idx) => {
            const color = PHASE_COLORS[idx % PHASE_COLORS.length];
            return (
              <div key={idx} className="flex items-center justify-between py-2 border-b border-cortex-subtle last:border-0">
                <div className="flex items-center gap-3">
                  <div className="size-3 rounded-full" style={{ backgroundColor: color.primary }} />
                  <span className="text-sm font-medium text-white">{item.phase}</span>
                </div>
                <span className="text-sm font-bold" style={{ color: color.primary }}>{item.range}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
