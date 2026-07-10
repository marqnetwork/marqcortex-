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
import type { SolutionBlueprint as SolutionBlueprintType, ImplementationPhase, BlueprintKPI, BlueprintRisk } from '@/app/types/cortex-types';

// ── Props ─────────────────────────────────────────────────────────────────────

interface SolutionBlueprintProps {
  blueprint: SolutionBlueprintType;
  companyName: string;
}

// ── Phase colors ──────────────────────────────────────────────────────────────

const PHASE_COLORS = [
  { primary: '#8B5CF6', bg: 'rgba(139,92,246,0.12)', border: 'rgba(139,92,246,0.3)' },
  { primary: '#3B82F6', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.3)' },
  { primary: '#06D7F6', bg: 'rgba(6,215,246,0.12)', border: 'rgba(6,215,246,0.3)' },
  { primary: '#10B981', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)' },
];

const RISK_COLORS = {
  high: { bg: 'rgba(253,68,56,0.12)', text: '#FD4438', border: 'rgba(253,68,56,0.3)' },
  medium: { bg: 'rgba(251,146,60,0.12)', text: '#FB923C', border: 'rgba(251,146,60,0.3)' },
  low: { bg: 'rgba(16,185,129,0.12)', text: '#10B981', border: 'rgba(16,185,129,0.3)' },
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
      <div className="bg-gradient-to-br from-[#8B5CF6]/10 to-[#3B82F6]/10 border border-[#8B5CF6]/20 rounded-xl p-6">
        <div className="flex items-start gap-3 mb-4">
          <Target className="size-6 text-[#8B5CF6] flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-lg font-bold text-white mb-2">Executive Summary</h3>
            <p className="text-sm text-gray-300 leading-relaxed">{blueprint.executiveSummary}</p>
          </div>
        </div>
      </div>

      {/* Section nav */}
      <div className="flex gap-1.5 flex-wrap">
        {sections.map(sec => (
          <button
            key={sec.id}
            onClick={() => setActiveSection(sec.id)}
            className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-all ${
              activeSection === sec.id
                ? 'bg-[#8B5CF6] text-white'
                : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
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

function RoadmapSection({ phases }: { phases: ImplementationPhase[] }) {
  const [expandedPhase, setExpandedPhase] = useState<number>(0);

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold flex items-center gap-2">
        <Calendar className="size-5 text-[#8B5CF6]" />
        Phased Implementation Roadmap
      </h3>

      {/* Timeline visual */}
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
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
                  <ArrowRight className="size-4 text-gray-600 flex-shrink-0" />
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
                <div className="text-[11px] text-gray-500">{phase.duration}</div>
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
            className="rounded-xl overflow-hidden"
            style={{ backgroundColor: color.bg, border: `1px solid ${color.border}` }}
          >
            <button
              onClick={() => setExpandedPhase(isExpanded ? -1 : idx)}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-white/5 transition-colors"
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
                  <div className="text-xs text-gray-400">{phase.duration} &middot; {phase.deliverables.length} deliverables</div>
                </div>
              </div>
              {isExpanded ? <ChevronDown className="size-5 text-gray-400" /> : <ChevronRight className="size-5 text-gray-400" />}
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
                      <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Objectives</div>
                      <ul className="space-y-1.5">
                        {phase.objectives.map((obj, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                            <CheckCircle2 className="size-4 flex-shrink-0 mt-0.5" style={{ color: color.primary }} />
                            {obj}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Deliverables */}
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Deliverables</div>
                      <div className="space-y-2">
                        {phase.deliverables.map((del, i) => (
                          <div key={i} className="bg-black/30 rounded-lg p-3">
                            <div className="text-sm font-semibold text-white mb-1">{del.item}</div>
                            <div className="text-xs text-gray-400">{del.description}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Milestones */}
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Milestones</div>
                      <div className="flex flex-wrap gap-2">
                        {phase.milestones.map((ms, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs"
                            style={{ backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                          >
                            <Clock className="size-3" style={{ color: color.primary }} />
                            <span className="font-bold" style={{ color: color.primary }}>{ms.day}</span>
                            <span className="text-gray-300">{ms.milestone}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Team + Risks */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Team Required</div>
                        <div className="flex flex-wrap gap-1.5">
                          {phase.teamRequired.map((role, i) => (
                            <span key={i} className="px-2 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-gray-300">
                              {role}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Risks Mitigated</div>
                        <div className="flex flex-wrap gap-1.5">
                          {phase.risksMitigated.map((risk, i) => (
                            <span key={i} className="px-2 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: 'rgba(16,185,129,0.12)', color: '#10B981', border: '1px solid rgba(16,185,129,0.3)' }}>
                              {risk}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {phase.linkedBottleneck && (
                      <div className="text-xs text-gray-500 flex items-center gap-1 pt-2 border-t border-white/5">
                        <Zap className="size-3 text-[#06D7F6]" />
                        Addresses Core Problem: <span className="text-[#06D7F6] font-semibold">{phase.linkedBottleneck}</span>
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

function DeliverablesSection({ phases }: { phases: ImplementationPhase[] }) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold flex items-center gap-2">
        <FileText className="size-5 text-[#3B82F6]" />
        Complete Deliverables Matrix
      </h3>

      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-500">Phase</th>
              <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-500">Deliverable</th>
              <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-500">Description</th>
              <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-500">Timeline</th>
            </tr>
          </thead>
          <tbody>
            {phases.map((phase, phaseIdx) =>
              phase.deliverables.map((del, delIdx) => {
                const color = PHASE_COLORS[phaseIdx % PHASE_COLORS.length];
                return (
                  <tr
                    key={`${phaseIdx}-${delIdx}`}
                    className="border-b border-white/5 hover:bg-white/3 transition-colors"
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
                    <td className="px-4 py-3 text-xs text-gray-400 max-w-xs">{del.description}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{phase.duration}</td>
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
        <BarChart3 className="size-5 text-[#10B981]" />
        Success KPIs for {companyName}
      </h3>

      <div className="grid grid-cols-1 gap-3">
        {kpis.map((kpi, idx) => (
          <div key={idx} className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="text-sm font-bold text-white mb-1">{kpi.metric}</div>
                <div className="text-xs text-gray-500">Measured via: {kpi.measurementMethod}</div>
              </div>
              <TrendingUp className="size-5 text-[#10B981]" />
            </div>
            <div className="grid grid-cols-4 gap-4">
              <KPICell label="Baseline" value={kpi.baseline} color="#6B7280" />
              <KPICell label="30-Day Target" value={kpi.target30} color="#FB923C" />
              <KPICell label="60-Day Target" value={kpi.target60} color="#3B82F6" />
              <KPICell label="90-Day Target" value={kpi.target90} color="#10B981" />
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
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">{label}</div>
      <div className="text-lg font-bold" style={{ color }}>{value}</div>
    </div>
  );
}

// ── Resource Plan ─────────────────────────────────────────────────────────────

function ResourceSection({ resources, phases }: { resources: SolutionBlueprintType['resourcePlan']; phases: ImplementationPhase[] }) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold flex items-center gap-2">
        <Users className="size-5 text-[#06D7F6]" />
        Resource Allocation Plan
      </h3>

      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-500">Role</th>
              <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-500">Allocation</th>
              <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-500">Active During</th>
            </tr>
          </thead>
          <tbody>
            {resources.map((res, idx) => (
              <tr key={idx} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                <td className="px-4 py-3 text-sm font-medium text-white">{res.role}</td>
                <td className="px-4 py-3 text-sm text-gray-300">{res.allocation}</td>
                <td className="px-4 py-3 text-xs text-gray-400">{res.phase}</td>
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
        <Shield className="size-5 text-[#FB923C]" />
        Risk Register & Mitigation
      </h3>

      <div className="space-y-3">
        {risks.map((risk, idx) => {
          const probColor = RISK_COLORS[risk.probability];
          const impactColor = RISK_COLORS[risk.impact];
          return (
            <div key={idx} className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-5">
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
                <span className="text-xs text-gray-500">Owner: {risk.owner}</span>
              </div>
              <div className="bg-[#10B981]/10 border border-[#10B981]/20 rounded-lg p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#10B981] mb-1">Mitigation Strategy</div>
                <p className="text-xs text-gray-300">{risk.mitigation}</p>
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
        <DollarSign className="size-5 text-[#10B981]" />
        Investment & ROI Summary
      </h3>

      {/* Total investment */}
      <div className="bg-gradient-to-br from-[#10B981]/10 to-[#3B82F6]/10 border border-[#10B981]/20 rounded-xl p-6">
        <div className="grid grid-cols-3 gap-6">
          <div className="text-center">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Total Investment</div>
            <div className="text-3xl font-bold text-[#10B981]">{investment.totalRange}</div>
          </div>
          <div className="text-center">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Payback Period</div>
            <div className="text-3xl font-bold text-[#3B82F6]">{investment.paybackPeriod}</div>
          </div>
          <div className="text-center">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">12-Month ROI</div>
            <div className="text-3xl font-bold text-[#8B5CF6]">{investment.roiTimeline}</div>
          </div>
        </div>
      </div>

      {/* Phase breakdown */}
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-5">
        <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-4">Cost Breakdown by Phase</div>
        <div className="space-y-3">
          {investment.breakdownByPhase.map((item, idx) => {
            const color = PHASE_COLORS[idx % PHASE_COLORS.length];
            return (
              <div key={idx} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
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
