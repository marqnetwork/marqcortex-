/**
 * ENHANCED ROI & FINANCIAL MODELING
 *
 * Phase 3: Expands the ROI tab with:
 * - 12-month projection chart (cumulative ROI vs investment)
 * - Scenario comparison table (conservative / expected / aggressive)
 * - Break-even indicator
 * - Editable assumptions with live recalculation
 */

import { useState, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, BarChart, Bar, Legend, Cell,
} from 'recharts';
import {
  TrendingUp, DollarSign, Calculator, Sliders, Target,
  CheckCircle2, ArrowUpRight, Clock,
} from 'lucide-react';
import type {
  MonthlyProjection, ScenarioComparison, BreakEvenAnalysis, ROIAssumption,
} from '@/app/types/cortex-types';

// ── Props ─────────────────────────────────────────────────────────────────────

interface EnhancedROIProps {
  monthlyProjections: MonthlyProjection[];
  scenarioComparison: ScenarioComparison;
  breakEvenAnalysis: BreakEvenAnalysis;
  editableAssumptions: ROIAssumption[];
  companyName: string;
}

// ── Main Component ────────────────────────────────────────────────────────────

export function EnhancedROIView({
  monthlyProjections,
  scenarioComparison,
  breakEvenAnalysis,
  editableAssumptions,
  companyName,
}: EnhancedROIProps) {
  const [activeTab, setActiveTab] = useState<'projections' | 'scenarios' | 'assumptions'>('projections');
  const [assumptions, setAssumptions] = useState(editableAssumptions);

  // ── Live recalculation from assumption changes ───────────────────────────
  // We compute scaling factors per category by comparing current values
  // to original values, then apply those factors to the base projections.
  const scalingFactors = useMemo(() => {
    const factor = (category: 'cost' | 'savings' | 'revenue') => {
      const originals = editableAssumptions.filter(a => a.category === category);
      const currents = assumptions.filter(a => a.category === category);
      if (originals.length === 0) return 1;
      const origSum = originals.reduce((s, a) => s + a.value, 0);
      const currSum = currents.reduce((s, a) => s + a.value, 0);
      return origSum > 0 ? currSum / origSum : 1;
    };
    return {
      cost: factor('cost'),
      savings: factor('savings'),
      revenue: factor('revenue'),
    };
  }, [assumptions, editableAssumptions]);

  const adjustedProjections = useMemo(() => {
    let cumROI = 0;
    return monthlyProjections.map(row => {
      const costAvoided = Math.round(row.costAvoided * scalingFactors.savings);
      const revenueRecovered = Math.round(row.revenueRecovered * scalingFactors.revenue);
      const investmentToDate = Math.round(row.investmentToDate * scalingFactors.cost);
      cumROI += costAvoided + revenueRecovered;
      return {
        ...row,
        costAvoided,
        revenueRecovered,
        investmentToDate,
        cumulativeROI: cumROI,
        netValue: cumROI - investmentToDate,
      };
    });
  }, [monthlyProjections, scalingFactors]);

  const adjustedBreakEven = useMemo(() => {
    const beMonth = adjustedProjections.findIndex(p => p.netValue >= 0);
    const month = beMonth >= 0 ? beMonth + 1 : breakEvenAnalysis.breakEvenMonth;
    const monthlyBenefit = adjustedProjections.length > 0
      ? Math.round(adjustedProjections.reduce((s, p) => s + p.costAvoided + p.revenueRecovered, 0) / adjustedProjections.length)
      : breakEvenAnalysis.monthlyBenefit;
    const totalInv = adjustedProjections.length > 0
      ? adjustedProjections[0].investmentToDate
      : breakEvenAnalysis.totalInvestment;
    return {
      breakEvenMonth: month,
      totalInvestment: totalInv,
      monthlyBenefit,
      confidenceRange: {
        low: Math.max(1, month - 1),
        high: month + 2,
      },
    };
  }, [adjustedProjections, breakEvenAnalysis]);

  const adjustedScenarios = useMemo(() => {
    const avgFactor = (scalingFactors.savings + scalingFactors.revenue) / 2;
    return {
      scenarios: scenarioComparison.scenarios.map(s => {
        const totalInvestment = Math.round(s.totalInvestment * scalingFactors.cost);
        const year1Return = Math.round(s.year1Return * avgFactor);
        const roi = totalInvestment > 0 ? Math.round(((year1Return - totalInvestment) / totalInvestment) * 100) : s.roi;
        const paybackMonths = year1Return > 0 ? Math.max(1, Math.round((totalInvestment / (year1Return / 12)))) : s.paybackMonths;
        const npv = Math.round(year1Return * 0.9 - totalInvestment); // simplified 10% discount
        return { ...s, totalInvestment, year1Return, roi, paybackMonths, netPresentValue: npv };
      }),
    };
  }, [scenarioComparison, scalingFactors]);

  // Use adjusted data for summary
  const year1Total = adjustedProjections[adjustedProjections.length - 1]?.cumulativeROI || 0;
  const investment = adjustedProjections[adjustedProjections.length - 1]?.investmentToDate || 0;
  const netROI = year1Total - investment;
  const roiPercent = investment > 0 ? Math.round((netROI / investment) * 100) : 0;

  // Has user changed anything?
  const hasChanges = assumptions.some((a, i) => a.value !== editableAssumptions[i]?.value);

  const handleReset = () => setAssumptions(editableAssumptions);

  const tabs = [
    { id: 'projections' as const, label: '12-Month Projections', icon: TrendingUp },
    { id: 'scenarios' as const, label: 'Scenario Comparison', icon: Target },
    { id: 'assumptions' as const, label: 'Editable Assumptions', icon: Sliders },
  ];

  return (
    <div className="space-y-6">
      {/* Assumptions changed indicator */}
      {hasChanges && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-[#8B5CF6]/10 border border-[#8B5CF6]/20 rounded-xl">
          <Sliders className="size-4 text-[#8B5CF6]" />
          <span className="text-xs text-[#8B5CF6] font-medium flex-1">
            Projections updated based on your adjusted assumptions
          </span>
          <button
            onClick={handleReset}
            className="text-xs text-gray-400 hover:text-white underline"
          >
            Reset to defaults
          </button>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <SummaryCard
          label="12-Month Return"
          value={`$${year1Total.toLocaleString()}`}
          color="#10B981"
          icon={TrendingUp}
        />
        <SummaryCard
          label="Total Investment"
          value={`$${investment.toLocaleString()}`}
          color="#3B82F6"
          icon={DollarSign}
        />
        <SummaryCard
          label="Net ROI"
          value={`${roiPercent}%`}
          color="#8B5CF6"
          icon={ArrowUpRight}
        />
        <SummaryCard
          label="Break-Even"
          value={`Month ${adjustedBreakEven.breakEvenMonth}`}
          subtext={`(${adjustedBreakEven.confidenceRange.low}-${adjustedBreakEven.confidenceRange.high} month range)`}
          color="#06D7F6"
          icon={CheckCircle2}
        />
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1.5">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-all ${
              activeTab === tab.id
                ? 'bg-[#8B5CF6] text-white'
                : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
            }`}
          >
            <tab.icon className="size-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'projections' && (
        <ProjectionsChart
          data={adjustedProjections}
          breakEvenMonth={adjustedBreakEven.breakEvenMonth}
          investment={investment}
        />
      )}
      {activeTab === 'scenarios' && (
        <ScenarioTable scenarios={adjustedScenarios} companyName={companyName} />
      )}
      {activeTab === 'assumptions' && (
        <AssumptionsEditor
          assumptions={assumptions}
          onChange={setAssumptions}
        />
      )}
    </div>
  );
}

// ── Summary Card ──────────────────────────────────────────────────────────────

function SummaryCard({
  label, value, subtext, color, icon: Icon,
}: {
  label: string; value: string; subtext?: string; color: string; icon: typeof TrendingUp;
}) {
  return (
    <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="size-5" style={{ color }} />
        <span className="text-xs font-bold uppercase tracking-wider text-gray-500">{label}</span>
      </div>
      <div className="text-2xl font-bold" style={{ color }}>{value}</div>
      {subtext && <div className="text-[10px] text-gray-500 mt-1">{subtext}</div>}
    </div>
  );
}

// ── 12-Month Projections Chart ────────────────────────────────────────────────

function ProjectionsChart({
  data, breakEvenMonth, investment,
}: {
  data: MonthlyProjection[]; breakEvenMonth: number; investment: number;
}) {
  const chartData = data.map(d => ({
    ...d,
    name: `M${d.month}`,
    monthlyBenefit: d.costAvoided + d.revenueRecovered,
  }));

  return (
    <div className="space-y-6">
      {/* Cumulative ROI vs Investment */}
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
        <h4 className="text-lg font-bold mb-1 flex items-center gap-2">
          <TrendingUp className="size-5 text-[#10B981]" />
          Cumulative ROI vs. Investment
        </h4>
        <p className="text-xs text-gray-500 mb-4">
          Break-even at Month {breakEvenMonth} — after that, every dollar is net positive
        </p>

        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="roiGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="investGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#FD4438" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#FD4438" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="name" tick={{ fill: '#6B7280', fontSize: 12 }} />
            <YAxis
              tick={{ fill: '#6B7280', fontSize: 12 }}
              tickFormatter={v => `$${(v / 1000).toFixed(0)}K`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1A1A2E',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value: number, name: string) => [
                `$${value.toLocaleString()}`,
                name === 'cumulativeROI' ? 'Cumulative Savings' :
                name === 'investmentToDate' ? 'Investment' : name,
              ]}
            />
            <ReferenceLine
              x={`M${breakEvenMonth}`}
              stroke="#06D7F6"
              strokeDasharray="5 5"
              label={{ value: 'Break-even', fill: '#06D7F6', fontSize: 11, position: 'top' }}
            />
            <Area
              type="monotone"
              dataKey="cumulativeROI"
              stroke="#10B981"
              strokeWidth={2}
              fill="url(#roiGrad)"
              name="cumulativeROI"
            />
            <Area
              type="monotone"
              dataKey="investmentToDate"
              stroke="#FD4438"
              strokeWidth={2}
              fill="url(#investGrad)"
              name="investmentToDate"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Monthly Breakdown Bar */}
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
        <h4 className="text-lg font-bold mb-1 flex items-center gap-2">
          <DollarSign className="size-5 text-[#8B5CF6]" />
          Monthly Savings Breakdown
        </h4>
        <p className="text-xs text-gray-500 mb-4">Cost avoided + revenue recovered per month</p>

        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="name" tick={{ fill: '#6B7280', fontSize: 12 }} />
            <YAxis tick={{ fill: '#6B7280', fontSize: 12 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1A1A2E',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value: number) => [`$${value.toLocaleString()}`]}
            />
            <Bar dataKey="costAvoided" stackId="a" fill="#3B82F6" name="Cost Avoided" radius={[0, 0, 0, 0]} />
            <Bar dataKey="revenueRecovered" stackId="a" fill="#10B981" name="Revenue Recovered" radius={[4, 4, 0, 0]} />
            <Legend
              iconType="square"
              wrapperStyle={{ fontSize: 11, color: '#9CA3AF' }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Monthly detail table */}
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-500">Month</th>
              <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-500">Hours Saved</th>
              <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-500">Cost Avoided</th>
              <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-500">Revenue Recovered</th>
              <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-500">Cumulative</th>
              <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-500">Net Value</th>
            </tr>
          </thead>
          <tbody>
            {data.map(row => (
              <tr
                key={row.month}
                className={`border-b border-white/5 ${row.month === breakEvenMonth ? 'bg-[#06D7F6]/5' : ''}`}
              >
                <td className="px-4 py-2.5 font-medium text-white">
                  {row.label}
                  {row.month === breakEvenMonth && (
                    <span className="ml-2 text-[10px] font-bold text-[#06D7F6] uppercase">Break-even</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right text-gray-400">{row.hoursSaved}h</td>
                <td className="px-4 py-2.5 text-right text-[#3B82F6]">${row.costAvoided.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right text-[#10B981]">${row.revenueRecovered.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right text-white font-semibold">${row.cumulativeROI.toLocaleString()}</td>
                <td className={`px-4 py-2.5 text-right font-bold ${row.netValue >= 0 ? 'text-[#10B981]' : 'text-[#FD4438]'}`}>
                  {row.netValue >= 0 ? '+' : ''}${row.netValue.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Scenario Comparison ───────────────────────────────────────────────────────

function ScenarioTable({
  scenarios, companyName,
}: {
  scenarios: ScenarioComparison; companyName: string;
}) {
  return (
    <div className="space-y-6">
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
        <h4 className="text-lg font-bold mb-4 flex items-center gap-2">
          <Target className="size-5 text-[#8B5CF6]" />
          Scenario Comparison for {companyName}
        </h4>

        <div className="grid grid-cols-3 gap-4 mb-6">
          {scenarios.scenarios.map(s => (
            <div
              key={s.name}
              className="rounded-xl p-5 text-center"
              style={{
                backgroundColor: `${s.color}10`,
                border: `1px solid ${s.color}30`,
              }}
            >
              <div className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: s.color }}>
                {s.name}
              </div>
              <div className="text-3xl font-bold text-white mb-1">
                {s.roi}%
              </div>
              <div className="text-xs text-gray-500">12-Month ROI</div>

              <div className="mt-4 space-y-2 text-left">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Investment</span>
                  <span className="text-gray-300">${s.totalInvestment.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Year 1 Return</span>
                  <span style={{ color: s.color }}>${s.year1Return.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Payback</span>
                  <span className="text-gray-300">{s.paybackMonths} month{s.paybackMonths > 1 ? 's' : ''}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">NPV</span>
                  <span className="text-gray-300">${s.netPresentValue.toLocaleString()}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Visual bar comparison */}
        <div className="space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Year 1 Return Comparison</div>
          {scenarios.scenarios.map(s => {
            const maxReturn = Math.max(...scenarios.scenarios.map(sc => sc.year1Return));
            const pct = (s.year1Return / maxReturn) * 100;
            return (
              <div key={s.name} className="flex items-center gap-3">
                <div className="w-24 text-xs font-medium" style={{ color: s.color }}>{s.name}</div>
                <div className="flex-1 h-6 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full flex items-center justify-end pr-2 text-[10px] font-bold text-white"
                    style={{ width: `${pct}%`, backgroundColor: s.color }}
                  >
                    ${s.year1Return.toLocaleString()}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Editable Assumptions ──────────────────────────────────────────────────────

function AssumptionsEditor({
  assumptions, onChange,
}: {
  assumptions: ROIAssumption[]; onChange: (a: ROIAssumption[]) => void;
}) {
  const grouped = useMemo(() => {
    const groups: Record<string, ROIAssumption[]> = { cost: [], savings: [], revenue: [] };
    for (const a of assumptions) {
      if (groups[a.category]) groups[a.category].push(a);
    }
    return groups;
  }, [assumptions]);

  const categoryLabels: Record<string, { label: string; color: string }> = {
    cost: { label: 'Cost Inputs', color: '#FD4438' },
    savings: { label: 'Savings Assumptions', color: '#3B82F6' },
    revenue: { label: 'Revenue Assumptions', color: '#10B981' },
  };

  const handleChange = (id: string, newValue: number) => {
    onChange(assumptions.map(a => a.id === id ? { ...a, value: newValue } : a));
  };

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#8B5CF6]/10 to-[#3B82F6]/10 border border-[#8B5CF6]/20 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <Calculator className="size-5 text-[#8B5CF6] flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-bold text-white mb-1">Sensitivity Analysis</div>
            <p className="text-xs text-gray-400">
              Adjust the assumptions below to see how they affect ROI projections.
              Drag sliders or type values directly. All calculations update in real-time.
            </p>
          </div>
        </div>
      </div>

      {Object.entries(grouped).map(([category, items]) => {
        if (items.length === 0) return null;
        const meta = categoryLabels[category];

        return (
          <div key={category} className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
            <h4 className="text-base font-bold mb-4 flex items-center gap-2">
              <div className="size-3 rounded-full" style={{ backgroundColor: meta.color }} />
              {meta.label}
            </h4>
            <div className="space-y-5">
              {items.map(assumption => (
                <AssumptionSlider
                  key={assumption.id}
                  assumption={assumption}
                  color={meta.color}
                  onChange={val => handleChange(assumption.id, val)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AssumptionSlider({
  assumption, color, onChange,
}: {
  assumption: ROIAssumption; color: string; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="text-sm font-medium text-white">{assumption.label}</span>
          <p className="text-[10px] text-gray-500">{assumption.description}</p>
        </div>
        <div className="flex items-center gap-1 text-lg font-bold" style={{ color }}>
          {assumption.unit === '$' && '$'}
          <input
            type="number"
            value={assumption.value}
            onChange={e => onChange(Number(e.target.value))}
            min={assumption.min}
            max={assumption.max}
            className="w-20 bg-transparent text-right focus:outline-none focus:ring-1 focus:ring-[#8B5CF6] rounded px-1"
            style={{ color }}
          />
          {assumption.unit !== '$' && <span className="text-xs text-gray-400 ml-1">{assumption.unit}</span>}
        </div>
      </div>
      <input
        type="range"
        min={assumption.min}
        max={assumption.max}
        value={assumption.value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, ${color} ${((assumption.value - assumption.min) / (assumption.max - assumption.min)) * 100}%, rgba(255,255,255,0.1) ${((assumption.value - assumption.min) / (assumption.max - assumption.min)) * 100}%)`,
        }}
      />
      <div className="flex justify-between text-[10px] text-gray-600 mt-1">
        <span>{assumption.unit === '$' ? '$' : ''}{assumption.min}{assumption.unit !== '$' ? ` ${assumption.unit}` : ''}</span>
        <span>{assumption.unit === '$' ? '$' : ''}{assumption.max}{assumption.unit !== '$' ? ` ${assumption.unit}` : ''}</span>
      </div>
    </div>
  );
}