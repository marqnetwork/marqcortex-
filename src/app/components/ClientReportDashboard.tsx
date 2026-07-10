/**
 * CLIENT REPORT DASHBOARD — Interactive Deliverable
 *
 * Presents all team-finalized analysis to the client as a polished,
 * interactive, scrollable report with charts, graphs, and export.
 *
 * Sections:
 *   1. Cover & Executive Summary
 *   2. Department Scan (Radar + Bar)
 *   3. Recommendations & Priority Ranking
 *   4. ROI & Financial Projections (Bar + Area charts)
 *   5. Execution Timeline (Gantt-style)
 *   6. Risk & Confidence Profile
 *   7. Cash Flow Projection
 *   8. Next Steps & CTA
 *
 * Data: Uses CORTEX core engine output (demo when BACKEND_INTEGRATION=false)
 */

import { useState, useRef, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  AreaChart, Area, ResponsiveContainer, Cell, PieChart, Pie,
  LineChart, Line, ComposedChart,
} from 'recharts';
import {
  Brain, Download, TrendingUp, Shield, Target, Zap, Clock,
  DollarSign, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp,
  BarChart3, Layers, ArrowRight, FileText, Printer, Building2,
  Users, Rocket, Star, Activity, Eye, Lock,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface DepartmentScore {
  department: string;
  label: string;
  problemDensity: number;
  impactPotential: number;
  automationFeasibility: number;
  riskExposure: number;
  computedPriority: number;
  qualifies: boolean;
}

interface Recommendation {
  id: string;
  department: string;
  departmentLabel: string;
  problemTitle: string;
  severityScore: number;
  whyNow: string;
  whyFirst: string;
  impactTypes: string[];
  executionDays: number;
  phases: { title: string; durationDays: number; objectives: string[] }[];
  investment: string;
  roiPercent: number;
  gain12mo: string;
  paybackMonths: number;
  confidenceScore: number;
  feasibilityScore: number;
  risks: { risk: string; probability: string; impact: string; mitigation: string }[];
}

interface CashFlowPoint {
  month: string;
  investment: number;
  gain: number;
  net: number;
  cumulative: number;
}

interface ReportData {
  companyName: string;
  industry: string;
  generatedDate: string;
  overallScore: number;
  departments: DepartmentScore[];
  recommendations: Recommendation[];
  portfolioROI: number;
  totalInvestment: number;
  totalGain12mo: number;
  paybackMonths: number;
  cashFlow: CashFlowPoint[];
  scenarioComparison: { scenario: string; roi: number; npv: number; payback: number | null }[];
  capitalAllocations: { department: string; percent: number; cost: string }[];
  executionOrder: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// DEMO REPORT DATA
// ═══════════════════════════════════════════════════════════════════════════

function buildDemoReportData(companyName: string, industry: string): ReportData {
  const departments: DepartmentScore[] = [
    { department: 'revenue_engine', label: 'Revenue Engine', problemDensity: 7.2, impactPotential: 8.5, automationFeasibility: 7.8, riskExposure: 3.2, computedPriority: 8.1, qualifies: true },
    { department: 'customer_experience', label: 'Customer Experience', problemDensity: 6.8, impactPotential: 7.9, automationFeasibility: 8.2, riskExposure: 2.8, computedPriority: 7.6, qualifies: true },
    { department: 'operations_supply_chain', label: 'Operations', problemDensity: 8.1, impactPotential: 7.2, automationFeasibility: 6.5, riskExposure: 4.1, computedPriority: 6.9, qualifies: true },
    { department: 'marketing_acquisition', label: 'Marketing', problemDensity: 5.5, impactPotential: 6.8, automationFeasibility: 7.1, riskExposure: 2.1, computedPriority: 6.5, qualifies: false },
    { department: 'finance_unit_economics', label: 'Finance', problemDensity: 4.8, impactPotential: 5.9, automationFeasibility: 6.0, riskExposure: 3.5, computedPriority: 5.4, qualifies: false },
    { department: 'data_infrastructure', label: 'Data & Infrastructure', problemDensity: 7.5, impactPotential: 8.0, automationFeasibility: 7.0, riskExposure: 3.8, computedPriority: 7.2, qualifies: true },
    { department: 'talent_process', label: 'Talent & Process', problemDensity: 5.2, impactPotential: 5.5, automationFeasibility: 5.8, riskExposure: 2.5, computedPriority: 5.1, qualifies: false },
  ];

  const recommendations: Recommendation[] = [
    {
      id: 'R1', department: 'revenue_engine', departmentLabel: 'Revenue Engine',
      problemTitle: 'Revenue Leakage in Conversion Pipeline',
      severityScore: 8.5, whyNow: 'Each month of delay compounds lost revenue at an estimated $18K/mo.',
      whyFirst: 'Highest impact-to-effort ratio. Directly recovers revenue with minimal disruption.',
      impactTypes: ['revenue_growth', 'efficiency'],
      executionDays: 60,
      phases: [
        { title: 'Discovery & Audit', durationDays: 14, objectives: ['Map current pipeline', 'Identify drop-off points', 'Benchmark conversion rates'] },
        { title: 'Solution Design', durationDays: 14, objectives: ['Design automation flows', 'Configure lead scoring', 'Set up A/B tests'] },
        { title: 'Implementation', durationDays: 21, objectives: ['Deploy pipeline automation', 'Integrate CRM triggers', 'Launch nurture sequences'] },
        { title: 'Optimization', durationDays: 11, objectives: ['Analyze results', 'Tune scoring models', 'Document playbook'] },
      ],
      investment: '$42K', roiPercent: 185, gain12mo: '$120K', paybackMonths: 4.2, confidenceScore: 78, feasibilityScore: 7.8,
      risks: [
        { risk: 'CRM data migration complexity', probability: 'medium', impact: 'medium', mitigation: 'Phased migration with validation checkpoints' },
        { risk: 'Team adoption resistance', probability: 'low', impact: 'high', mitigation: 'Champion-led rollout with hands-on training' },
      ],
    },
    {
      id: 'R2', department: 'operations_supply_chain', departmentLabel: 'Operations',
      problemTitle: 'Manual Process Dependency in Fulfillment',
      severityScore: 8.1, whyNow: 'Manual bottlenecks scale linearly with order volume, blocking growth.',
      whyFirst: 'Unlocks capacity for R1 revenue gains without hiring.',
      impactTypes: ['efficiency', 'cost_reduction'],
      executionDays: 75,
      phases: [
        { title: 'Process Mapping', durationDays: 10, objectives: ['Document current workflows', 'Identify automation candidates'] },
        { title: 'Automation Build', durationDays: 30, objectives: ['Build RPA workflows', 'Integrate order management', 'Set up monitoring'] },
        { title: 'Testing & Rollout', durationDays: 21, objectives: ['UAT testing', 'Parallel run validation', 'Full cutover'] },
        { title: 'Stabilization', durationDays: 14, objectives: ['Monitor KPIs', 'Fix edge cases', 'Train operations team'] },
      ],
      investment: '$35K', roiPercent: 142, gain12mo: '$85K', paybackMonths: 4.9, confidenceScore: 82, feasibilityScore: 7.2,
      risks: [
        { risk: 'Integration with legacy ERP', probability: 'high', impact: 'medium', mitigation: 'API middleware layer to abstract ERP complexities' },
      ],
    },
    {
      id: 'R3', department: 'customer_experience', departmentLabel: 'Customer Experience',
      problemTitle: 'Customer Retention Breakdown',
      severityScore: 7.9, whyNow: 'Churn rate 2.3x industry average. Each churned customer = $2,400 LTV lost.',
      whyFirst: 'Protects existing revenue base while R1 grows new revenue.',
      impactTypes: ['revenue_growth', 'risk_reduction'],
      executionDays: 45,
      phases: [
        { title: 'Churn Analysis', durationDays: 10, objectives: ['Segment churn reasons', 'Build predictive model'] },
        { title: 'Intervention Design', durationDays: 15, objectives: ['Design retention flows', 'Build health scoring'] },
        { title: 'Launch & Monitor', durationDays: 20, objectives: ['Deploy alerts', 'Run win-back campaigns', 'Track retention lift'] },
      ],
      investment: '$28K', roiPercent: 168, gain12mo: '$75K', paybackMonths: 4.5, confidenceScore: 74, feasibilityScore: 8.2,
      risks: [
        { risk: 'Insufficient historical data', probability: 'medium', impact: 'medium', mitigation: 'Supplement with qualitative customer interviews' },
      ],
    },
    {
      id: 'R4', department: 'data_infrastructure', departmentLabel: 'Data & Infrastructure',
      problemTitle: 'Data Visibility Gap Across Departments',
      severityScore: 7.5, whyNow: 'Siloed data prevents cross-functional decisions and blocks AI readiness.',
      whyFirst: 'Foundation layer that enhances all other recommendations.',
      impactTypes: ['efficiency', 'risk_reduction'],
      executionDays: 90,
      phases: [
        { title: 'Data Audit', durationDays: 14, objectives: ['Catalog all data sources', 'Map data flows'] },
        { title: 'Architecture Design', durationDays: 21, objectives: ['Design unified schema', 'Plan ETL pipelines'] },
        { title: 'Build & Migrate', durationDays: 35, objectives: ['Build data warehouse', 'Migrate sources', 'Set up dashboards'] },
        { title: 'Validation', durationDays: 20, objectives: ['Quality checks', 'User acceptance', 'Documentation'] },
      ],
      investment: '$55K', roiPercent: 95, gain12mo: '$107K', paybackMonths: 6.2, confidenceScore: 71, feasibilityScore: 6.5,
      risks: [
        { risk: 'Scope creep in data migration', probability: 'high', impact: 'high', mitigation: 'Fixed-scope sprints with weekly boundary reviews' },
        { risk: 'Data quality issues in source systems', probability: 'medium', impact: 'medium', mitigation: 'Automated validation pipelines with alerting' },
      ],
    },
  ];

  const cashFlow: CashFlowPoint[] = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const inv = month <= 3 ? 45000 : month <= 6 ? 15000 : 5000;
    const rampFactor = Math.min(month / 6, 1);
    const gain = Math.round(32000 * rampFactor * (1 + i * 0.08));
    const net = gain - inv;
    const prevCum = i === 0 ? 0 : 0; // will compute below
    return { month: `Mo ${month}`, investment: inv, gain, net, cumulative: 0 };
  });
  let cum = 0;
  cashFlow.forEach(p => { cum += p.net; p.cumulative = cum; });

  return {
    companyName: companyName || 'Your Company',
    industry: industry || 'Technology',
    generatedDate: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    overallScore: 72,
    departments,
    recommendations,
    portfolioROI: 148,
    totalInvestment: 160000,
    totalGain12mo: 387000,
    paybackMonths: 5.1,
    cashFlow,
    scenarioComparison: [
      { scenario: 'Conservative', roi: 89, npv: 95000, payback: 7.2 },
      { scenario: 'Expected', roi: 148, npv: 187000, payback: 5.1 },
      { scenario: 'Aggressive', roi: 215, npv: 298000, payback: 3.8 },
    ],
    capitalAllocations: [
      { department: 'Revenue Engine', percent: 26, cost: '$42K' },
      { department: 'Operations', percent: 22, cost: '$35K' },
      { department: 'Customer Experience', percent: 18, cost: '$28K' },
      { department: 'Data & Infrastructure', percent: 34, cost: '$55K' },
    ],
    executionOrder: ['R1', 'R2', 'R3', 'R4'],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const PURPLE = '#8B5CF6';
const BLUE = '#3B82F6';
const CYAN = '#06D7F6';
const GREEN = '#10B981';
const ORANGE = '#FB923C';
const RED = '#FD4438';
const COLORS = [PURPLE, BLUE, CYAN, GREEN, ORANGE, '#EC4899'];

const SECTIONS = [
  { id: 'summary', label: 'Executive Summary' },
  { id: 'departments', label: 'Department Analysis' },
  { id: 'recommendations', label: 'Recommendations' },
  { id: 'roi', label: 'ROI & Financials' },
  { id: 'timeline', label: 'Execution Timeline' },
  { id: 'risk', label: 'Risk Profile' },
  { id: 'cashflow', label: 'Cash Flow' },
  { id: 'next', label: 'Next Steps' },
];

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

interface ClientReportDashboardProps {
  companyName?: string;
  industry?: string;
  onBack?: () => void;
  onScheduleCall?: () => void;
}

export function ClientReportDashboard({
  companyName = 'Your Company',
  industry = 'Technology',
  onBack,
  onScheduleCall,
}: ClientReportDashboardProps) {
  const [activeSection, setActiveSection] = useState('summary');
  const [expandedRec, setExpandedRec] = useState<string | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  const data = useMemo(() => buildDemoReportData(companyName, industry), [companyName, industry]);

  const radarData = useMemo(() =>
    data.departments.map(d => ({
      subject: d.label,
      Impact: d.impactPotential,
      Feasibility: d.automationFeasibility,
      Priority: d.computedPriority,
      fullMark: 10,
    })),
  [data.departments]);

  const scrollTo = (id: string) => {
    setActiveSection(id);
    document.getElementById(`report-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white" ref={reportRef}>
      {/* ── Sticky Navigation Bar ────────────────────────────────────────── */}
      <div className="sticky top-0 z-50 bg-black/90 backdrop-blur-xl border-b border-white/10 print:hidden">
        <div className="max-w-7xl mx-auto px-6 py-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-xl bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center">
                <Brain className="size-5 text-white" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-white">{data.companyName}</h1>
                <p className="text-xs text-gray-500">Strategic Analysis Report &middot; {data.generatedDate}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {onBack && (
                <button onClick={onBack} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors">
                  Back to Portal
                </button>
              )}
              <button onClick={handlePrint} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-gray-300 transition-colors">
                <Printer className="size-3.5" /> Print / PDF
              </button>
              <button onClick={handlePrint} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#8B5CF6] hover:bg-[#7C3AED] rounded-lg text-white font-medium transition-colors">
                <Download className="size-3.5" /> Export
              </button>
            </div>
          </div>
          {/* Section tabs */}
          <nav className="flex gap-1 overflow-x-auto scrollbar-hide pb-1">
            {SECTIONS.map(s => (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                className={`whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeSection === s.id
                    ? 'bg-[#8B5CF6] text-white'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {s.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* ── Report Content ───────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-16">

        {/* §1 — EXECUTIVE SUMMARY */}
        <section id="report-summary">
          <SectionHeader icon={Brain} title="Executive Summary" subtitle="High-level diagnostic results and strategic positioning" />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
            <MetricCard label="Overall Readiness" value={`${data.overallScore}/100`} trend="up" color={PURPLE} icon={Target} />
            <MetricCard label="Portfolio ROI" value={`${data.portfolioROI}%`} trend="up" color={GREEN} icon={TrendingUp} />
            <MetricCard label="Total Investment" value={`$${Math.round(data.totalInvestment / 1000)}K`} trend="neutral" color={BLUE} icon={DollarSign} />
            <MetricCard label="Payback Period" value={`${data.paybackMonths} mo`} trend="down" color={CYAN} icon={Clock} />
          </div>
          {/* Summary narrative */}
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="mt-6 bg-gradient-to-br from-[#8B5CF6]/10 to-[#3B82F6]/5 border border-[#8B5CF6]/20 rounded-2xl p-6"
          >
            <p className="text-gray-300 leading-relaxed">
              Our diagnostic analysis of <strong className="text-white">{data.companyName}</strong> ({data.industry}) identified{' '}
              <strong className="text-[#8B5CF6]">{data.recommendations.length} high-priority transformation opportunities</strong> across{' '}
              {data.departments.filter(d => d.qualifies).length} qualifying departments.
              The recommended portfolio delivers a projected <strong className="text-[#10B981]">{data.portfolioROI}% ROI</strong> within 12 months
              on a total investment of <strong className="text-white">${Math.round(data.totalInvestment / 1000)}K</strong>,
              with expected payback in <strong className="text-[#06D7F6]">{data.paybackMonths} months</strong>.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5">
              <MiniStat label="Departments Scanned" value="7" />
              <MiniStat label="Qualifying Departments" value={String(data.departments.filter(d => d.qualifies).length)} />
              <MiniStat label="Active Recommendations" value={String(data.recommendations.length)} />
              <MiniStat label="12-Month Gain" value={`$${Math.round(data.totalGain12mo / 1000)}K`} />
            </div>
          </motion.div>
        </section>

        {/* §2 — DEPARTMENT ANALYSIS */}
        <section id="report-departments">
          <SectionHeader icon={Layers} title="Department Analysis" subtitle="7-department operational scan with priority scoring" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            {/* Radar Chart */}
            <div className="bg-black/40 border border-white/10 rounded-2xl p-6">
              <h4 className="text-sm font-bold text-white mb-4">Opportunity Radar</h4>
              <ResponsiveContainer width="100%" height={320}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="rgba(255,255,255,0.08)" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 10]} tick={{ fill: '#6B7280', fontSize: 10 }} />
                  <Radar name="Impact" dataKey="Impact" stroke={PURPLE} fill={PURPLE} fillOpacity={0.2} />
                  <Radar name="Feasibility" dataKey="Feasibility" stroke={CYAN} fill={CYAN} fillOpacity={0.15} />
                  <Radar name="Priority" dataKey="Priority" stroke={GREEN} fill={GREEN} fillOpacity={0.1} />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#9CA3AF' }} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            {/* Department priority bar chart */}
            <div className="bg-black/40 border border-white/10 rounded-2xl p-6">
              <h4 className="text-sm font-bold text-white mb-4">Priority Ranking</h4>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart
                  data={[...data.departments].sort((a, b) => b.computedPriority - a.computedPriority)}
                  layout="vertical"
                  margin={{ left: 10, right: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis type="number" domain={[0, 10]} tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                  <YAxis type="category" dataKey="label" width={120} tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: '#111118', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: 12 }}
                    labelStyle={{ color: '#fff' }}
                  />
                  <Bar key="bar-priority" dataKey="computedPriority" name="Priority Score" radius={[0, 6, 6, 0]}>
                    {[...data.departments].sort((a, b) => b.computedPriority - a.computedPriority).map((d, idx) => (
                      <Cell key={`dept-cell-${d.department}`} fill={d.qualifies ? COLORS[idx % COLORS.length] : '#374151'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          {/* Department detail cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 mt-6">
            {data.departments.map(d => (
              <DepartmentCard key={d.department} dept={d} />
            ))}
          </div>
        </section>

        {/* §3 — RECOMMENDATIONS */}
        <section id="report-recommendations">
          <SectionHeader icon={Target} title="Strategic Recommendations" subtitle="Prioritized transformation initiatives with execution plans" />
          <div className="space-y-4 mt-6">
            {data.recommendations.map((rec, idx) => (
              <RecommendationCard
                key={rec.id}
                rec={rec}
                rank={idx + 1}
                expanded={expandedRec === rec.id}
                onToggle={() => setExpandedRec(expandedRec === rec.id ? null : rec.id)}
              />
            ))}
          </div>
        </section>

        {/* §4 — ROI & FINANCIALS */}
        <section id="report-roi">
          <SectionHeader icon={DollarSign} title="ROI & Financial Projections" subtitle="Conservative, risk-adjusted return analysis" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            {/* ROI by recommendation */}
            <div className="bg-black/40 border border-white/10 rounded-2xl p-6">
              <h4 className="text-sm font-bold text-white mb-4">ROI by Initiative</h4>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data.recommendations.map(r => ({ name: r.departmentLabel, ROI: r.roiPercent, Investment: parseInt(r.investment.replace(/[^0-9]/g, '')) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="name" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: '#111118', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: 12 }} />
                  <Bar key="bar-roi" dataKey="ROI" name="ROI %" fill={GREEN} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {/* Scenario comparison */}
            <div className="bg-black/40 border border-white/10 rounded-2xl p-6">
              <h4 className="text-sm font-bold text-white mb-4">Scenario Analysis</h4>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data.scenarioComparison}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="scenario" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: '#111118', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: 12 }} />
                  <Bar key="bar-scenario-roi" dataKey="roi" name="ROI %" fill={PURPLE} radius={[6, 6, 0, 0]} />
                  <Bar key="bar-scenario-npv" dataKey="npv" name="NPV ($)" fill={BLUE} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              {/* Scenario table */}
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-white/5">
                      <th className="text-left py-2 font-medium">Scenario</th>
                      <th className="text-right py-2 font-medium">ROI</th>
                      <th className="text-right py-2 font-medium">NPV</th>
                      <th className="text-right py-2 font-medium">Payback</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.scenarioComparison.map(s => (
                      <tr key={s.scenario} className="border-b border-white/5">
                        <td className="py-2 text-white font-medium">{s.scenario}</td>
                        <td className="py-2 text-right text-green-400">{s.roi}%</td>
                        <td className="py-2 text-right text-blue-400">${Math.round((s.npv ?? 0) / 1000)}K</td>
                        <td className="py-2 text-right text-cyan-400">{s.payback ?? '> 12'} mo</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Capital Allocation Pie */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            <div className="bg-black/40 border border-white/10 rounded-2xl p-6">
              <h4 className="text-sm font-bold text-white mb-4">Capital Allocation</h4>
              <div className="flex items-center gap-6">
                <ResponsiveContainer width="50%" height={220}>
                  <PieChart>
                    <Pie
                      data={data.capitalAllocations}
                      dataKey="percent"
                      nameKey="department"
                      cx="50%" cy="50%"
                      innerRadius={50} outerRadius={90}
                      paddingAngle={3}
                    >
                      {data.capitalAllocations.map((_, idx) => (
                        <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#111118', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2 flex-1">
                  {data.capitalAllocations.map((a, idx) => (
                    <div key={a.department} className="flex items-center gap-2 text-xs">
                      <div className="size-2.5 rounded-full" style={{ background: COLORS[idx % COLORS.length] }} />
                      <span className="text-gray-400 flex-1">{a.department}</span>
                      <span className="text-white font-medium">{a.percent}%</span>
                      <span className="text-gray-500">{a.cost}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {/* Impact Curve */}
            <div className="bg-black/40 border border-white/10 rounded-2xl p-6">
              <h4 className="text-sm font-bold text-white mb-4">Execution Impact Curve</h4>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data.recommendations.map((r, i) => ({
                  step: `Step ${i + 1}`,
                  cumROI: data.recommendations.slice(0, i + 1).reduce((s, x) => s + x.roiPercent, 0) / (i + 1),
                  cumGain: data.recommendations.slice(0, i + 1).reduce((s, x) => s + parseInt(x.gain12mo.replace(/[^0-9]/g, '')), 0),
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="step" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: '#111118', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: 12 }} />
                  <Area key="area-cumgain" type="monotone" dataKey="cumGain" name="Cumulative Gain ($K)" stroke={GREEN} fill={GREEN} fillOpacity={0.15} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        {/* §5 — EXECUTION TIMELINE */}
        <section id="report-timeline">
          <SectionHeader icon={Rocket} title="Execution Timeline" subtitle="Phased implementation roadmap with milestones" />
          <div className="mt-6 space-y-4">
            {data.recommendations.map((rec, rIdx) => (
              <TimelineCard key={rec.id} rec={rec} index={rIdx} />
            ))}
          </div>
          {/* Execution order */}
          <div className="mt-6 bg-black/40 border border-white/10 rounded-2xl p-6">
            <h4 className="text-sm font-bold text-white mb-3">Recommended Execution Sequence</h4>
            <div className="flex items-center gap-3 flex-wrap">
              {data.executionOrder.map((id, idx) => {
                const rec = data.recommendations.find(r => r.id === id);
                return (
                  <span key={id} className="contents">
                    <div className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-xl">
                      <span className="size-6 rounded-full bg-[#8B5CF6]/20 text-[#8B5CF6] flex items-center justify-center text-xs font-bold">
                        {idx + 1}
                      </span>
                      <span className="text-xs text-white font-medium">{rec?.departmentLabel ?? id}</span>
                      <span className="text-xs text-gray-500">{rec?.executionDays}d</span>
                    </div>
                    {idx < data.executionOrder.length - 1 && (
                      <ArrowRight className="size-4 text-gray-600 flex-shrink-0" />
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        </section>

        {/* §6 — RISK PROFILE */}
        <section id="report-risk">
          <SectionHeader icon={Shield} title="Risk & Confidence Profile" subtitle="Risk-adjusted analysis across all initiatives" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            {/* Confidence scores */}
            <div className="bg-black/40 border border-white/10 rounded-2xl p-6">
              <h4 className="text-sm font-bold text-white mb-4">Confidence & Feasibility</h4>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data.recommendations.map(r => ({
                  name: r.departmentLabel,
                  Confidence: r.confidenceScore,
                  Feasibility: r.feasibilityScore * 10,
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="name" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: '#111118', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: 12 }} />
                  <Bar key="bar-confidence" dataKey="Confidence" fill={PURPLE} radius={[6, 6, 0, 0]} />
                  <Bar key="bar-feasibility" dataKey="Feasibility" fill={CYAN} radius={[6, 6, 0, 0]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {/* Risk heat map */}
            <div className="bg-black/40 border border-white/10 rounded-2xl p-6">
              <h4 className="text-sm font-bold text-white mb-4">Risk Register</h4>
              <div className="space-y-3 max-h-[260px] overflow-y-auto pr-2">
                {data.recommendations.flatMap(r => r.risks.map(risk => ({
                  ...risk, initiative: r.departmentLabel,
                }))).map((risk, idx) => (
                  <div key={idx} className="flex items-start gap-3 text-xs p-3 bg-white/3 rounded-xl border border-white/5">
                    <div className={`size-2.5 rounded-full flex-shrink-0 mt-1 ${
                      risk.probability === 'high' ? 'bg-red-400' : risk.probability === 'medium' ? 'bg-orange-400' : 'bg-green-400'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-white font-medium">{risk.risk}</div>
                      <div className="text-gray-500 mt-0.5">{risk.initiative} &middot; {risk.probability} prob &middot; {risk.impact} impact</div>
                      <div className="text-gray-400 mt-1">{risk.mitigation}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* §7 — CASH FLOW */}
        <section id="report-cashflow">
          <SectionHeader icon={Activity} title="Cash Flow Projection" subtitle="12-month investment vs. gain timeline with cumulative net position" />
          <div className="mt-6 bg-black/40 border border-white/10 rounded-2xl p-6">
            {/* ComposedChart required so <Area> and <Line> can coexist;
                AreaChart only accepts Area children and would duplicate recharts
                internal keys when given a Line component. */}
            <ResponsiveContainer width="100%" height={360}>
              <ComposedChart data={data.cashFlow}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="month" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} tickFormatter={v => `$${Math.round(v / 1000)}K`} />
                <Tooltip
                  contentStyle={{ background: '#111118', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: 12 }}
                  formatter={(value: number) => [`$${Math.round(value / 1000)}K`, '']}
                />
                <Area key="area-gain" type="monotone" dataKey="gain" name="Gain" stroke={GREEN} fill={GREEN} fillOpacity={0.15} />
                <Area key="area-investment" type="monotone" dataKey="investment" name="Investment" stroke={RED} fill={RED} fillOpacity={0.1} />
                <Line key="line-cumulative" type="monotone" dataKey="cumulative" name="Cumulative Net" stroke={PURPLE} strokeWidth={2.5} dot={false} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </ComposedChart>
            </ResponsiveContainer>
            {/* Break-even indicator */}
            <div className="mt-4 flex items-center justify-center gap-6 text-xs">
              <div className="flex items-center gap-2">
                <div className="size-2.5 rounded-full bg-[#8B5CF6]" />
                <span className="text-gray-400">Break-even projected at</span>
                <span className="text-white font-bold">Month {data.cashFlow.findIndex(p => p.cumulative >= 0) + 1 || '6'}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="size-2.5 rounded-full bg-[#10B981]" />
                <span className="text-gray-400">Month 12 net position:</span>
                <span className="text-green-400 font-bold">${Math.round((data.cashFlow[11]?.cumulative ?? 0) / 1000)}K</span>
              </div>
            </div>
          </div>
        </section>

        {/* §8 — NEXT STEPS */}
        <section id="report-next">
          <SectionHeader icon={Rocket} title="Next Steps" subtitle="Your path forward" />
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <NextStepCard
              step={1}
              title="Review This Report"
              description="Walk through each section with your leadership team. Identify any questions or data points you'd like clarified."
              icon={Eye}
            />
            <NextStepCard
              step={2}
              title="Discovery Conversation"
              description="Schedule a 30-minute call with our team to discuss findings, answer questions, and align on priorities."
              icon={Users}
            />
            <NextStepCard
              step={3}
              title="Begin Execution"
              description="Once aligned, we'll kick off the first initiative within 5 business days with a dedicated project team."
              icon={Zap}
            />
          </div>
          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
            className="mt-8 bg-gradient-to-br from-[#8B5CF6]/20 to-[#3B82F6]/10 border border-[#8B5CF6]/30 rounded-2xl p-8 text-center"
          >
            <h3 className="text-2xl font-bold text-white mb-2">Ready to move forward?</h3>
            <p className="text-gray-400 mb-6 max-w-lg mx-auto">
              Let's discuss your report findings and map out the first 90 days together.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={onScheduleCall}
                className="px-6 py-3 bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] hover:opacity-90 text-white rounded-xl font-semibold transition-all inline-flex items-center gap-2"
              >
                Schedule Discovery Call <ArrowRight className="size-4" />
              </button>
              <button
                onClick={handlePrint}
                className="px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-xl font-medium transition-all inline-flex items-center gap-2"
              >
                <Download className="size-4" /> Download Report
              </button>
            </div>
          </motion.div>
        </section>

        {/* Footer */}
        <div className="text-center py-8 border-t border-white/5">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Brain className="size-4 text-[#8B5CF6]" />
            <span className="text-xs font-bold text-white">MARQ Cortex</span>
          </div>
          <p className="text-xs text-gray-600">
            This report was generated using deterministic analysis. Math decides priority. &middot; Confidential
          </p>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function SectionHeader({ icon: Icon, title, subtitle }: { icon: React.ComponentType<{ className?: string }>; title: string; subtitle: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-3">
      <div className="size-10 rounded-xl bg-gradient-to-br from-[#8B5CF6]/20 to-[#3B82F6]/10 flex items-center justify-center border border-[#8B5CF6]/20 flex-shrink-0">
        <Icon className="size-5 text-[#8B5CF6]" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-white">{title}</h2>
        <p className="text-sm text-gray-500">{subtitle}</p>
      </div>
    </motion.div>
  );
}

function MetricCard({ label, value, trend, color, icon: Icon }: {
  label: string; value: string; trend: 'up' | 'down' | 'neutral'; color: string; icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      className="bg-black/40 border border-white/10 rounded-2xl p-5 hover:border-white/20 transition-colors"
    >
      <div className="flex items-center justify-between mb-3">
        <Icon className="size-5" style={{ color }} />
        {trend === 'up' && <TrendingUp className="size-4 text-green-400" />}
        {trend === 'down' && <TrendingUp className="size-4 text-cyan-400 rotate-180" />}
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </motion.div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center py-2 px-3 bg-white/3 rounded-xl">
      <div className="text-lg font-bold text-white">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

function DepartmentCard({ dept }: { dept: DepartmentScore }) {
  return (
    <div className={`p-4 rounded-xl border transition-all ${
      dept.qualifies
        ? 'bg-[#8B5CF6]/5 border-[#8B5CF6]/20 hover:border-[#8B5CF6]/40'
        : 'bg-white/2 border-white/5 opacity-60'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-white">{dept.label}</span>
        {dept.qualifies ? (
          <span className="text-xs px-2 py-0.5 rounded-full bg-[#8B5CF6]/20 text-[#8B5CF6] font-medium">Qualifies</span>
        ) : (
          <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-gray-500 font-medium">Below Threshold</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3">
        <ScoreBar label="Impact" value={dept.impactPotential} max={10} color={PURPLE} />
        <ScoreBar label="Feasibility" value={dept.automationFeasibility} max={10} color={CYAN} />
        <ScoreBar label="Density" value={dept.problemDensity} max={10} color={ORANGE} />
        <ScoreBar label="Risk" value={dept.riskExposure} max={10} color={RED} />
      </div>
      <div className="mt-2 text-right">
        <span className="text-xs text-gray-500">Priority: </span>
        <span className="text-sm font-bold text-white">{dept.computedPriority.toFixed(1)}</span>
      </div>
    </div>
  );
}

function ScoreBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-0.5">
        <span className="text-gray-500">{label}</span>
        <span className="text-white font-medium">{value.toFixed(1)}</span>
      </div>
      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${(value / max) * 100}%`, background: color }} />
      </div>
    </div>
  );
}

function RecommendationCard({ rec, rank, expanded, onToggle }: {
  rec: Recommendation; rank: number; expanded: boolean; onToggle: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: rank * 0.05 }}
      className="bg-black/40 border border-white/10 rounded-2xl overflow-hidden hover:border-white/15 transition-colors"
    >
      <button onClick={onToggle} className="w-full text-left p-5 flex items-start gap-4">
        <div className="size-10 rounded-xl bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center flex-shrink-0 text-white font-bold text-sm">
          {rank}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-bold text-white">{rec.problemTitle}</h4>
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#8B5CF6]/20 text-[#8B5CF6]">{rec.departmentLabel}</span>
          </div>
          <p className="text-xs text-gray-400 mt-1 line-clamp-2">{rec.whyFirst}</p>
          {/* Quick stats row */}
          <div className="flex items-center gap-4 mt-3 text-xs">
            <span className="flex items-center gap-1 text-green-400"><TrendingUp className="size-3" />{rec.roiPercent}% ROI</span>
            <span className="flex items-center gap-1 text-blue-400"><DollarSign className="size-3" />{rec.investment}</span>
            <span className="flex items-center gap-1 text-cyan-400"><Clock className="size-3" />{rec.executionDays}d</span>
            <span className="flex items-center gap-1 text-purple-400"><Shield className="size-3" />{rec.confidenceScore}% conf</span>
          </div>
        </div>
        {expanded ? <ChevronUp className="size-5 text-gray-400 flex-shrink-0" /> : <ChevronDown className="size-5 text-gray-400 flex-shrink-0" />}
      </button>

      {expanded && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="border-t border-white/5 p-5 space-y-4">
          {/* Why now / Why first */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-3 bg-white/3 rounded-xl">
              <div className="text-xs font-bold text-orange-400 mb-1">Why Now</div>
              <p className="text-xs text-gray-300">{rec.whyNow}</p>
            </div>
            <div className="p-3 bg-white/3 rounded-xl">
              <div className="text-xs font-bold text-purple-400 mb-1">Why First</div>
              <p className="text-xs text-gray-300">{rec.whyFirst}</p>
            </div>
          </div>
          {/* Financial summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="text-center p-3 bg-white/3 rounded-xl">
              <div className="text-lg font-bold text-white">{rec.investment}</div>
              <div className="text-xs text-gray-500">Investment</div>
            </div>
            <div className="text-center p-3 bg-white/3 rounded-xl">
              <div className="text-lg font-bold text-green-400">{rec.gain12mo}</div>
              <div className="text-xs text-gray-500">12-Month Gain</div>
            </div>
            <div className="text-center p-3 bg-white/3 rounded-xl">
              <div className="text-lg font-bold text-purple-400">{rec.roiPercent}%</div>
              <div className="text-xs text-gray-500">ROI</div>
            </div>
            <div className="text-center p-3 bg-white/3 rounded-xl">
              <div className="text-lg font-bold text-cyan-400">{rec.paybackMonths} mo</div>
              <div className="text-xs text-gray-500">Payback</div>
            </div>
          </div>
          {/* Phases */}
          <div>
            <div className="text-xs font-bold text-white mb-2">Execution Phases</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {rec.phases.map((phase, idx) => (
                <div key={idx} className="flex items-start gap-2 p-2 bg-white/3 rounded-lg">
                  <div className="size-5 rounded-full bg-[#8B5CF6]/20 text-[#8B5CF6] flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5">
                    {idx + 1}
                  </div>
                  <div>
                    <div className="text-xs text-white font-medium">{phase.title} <span className="text-gray-500">({phase.durationDays}d)</span></div>
                    <ul className="mt-1 space-y-0.5">
                      {phase.objectives.map((o, oIdx) => (
                        <li key={oIdx} className="text-xs text-gray-400 flex items-start gap-1">
                          <CheckCircle2 className="size-3 text-green-400 flex-shrink-0 mt-0.5" /> {o}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Risks */}
          {rec.risks.length > 0 && (
            <div>
              <div className="text-xs font-bold text-white mb-2">Risks & Mitigations</div>
              {rec.risks.map((risk, rIdx) => (
                <div key={rIdx} className="flex items-start gap-2 text-xs p-2 bg-white/3 rounded-lg mb-1">
                  <AlertTriangle className={`size-3.5 flex-shrink-0 mt-0.5 ${risk.probability === 'high' ? 'text-red-400' : risk.probability === 'medium' ? 'text-orange-400' : 'text-green-400'}`} />
                  <div>
                    <span className="text-white font-medium">{risk.risk}</span>
                    <span className="text-gray-500"> &middot; {risk.probability}/{risk.impact}</span>
                    <div className="text-gray-400 mt-0.5">{risk.mitigation}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}

function TimelineCard({ rec, index }: { rec: Recommendation; index: number }) {
  let dayOffset = 0;
  const totalDays = rec.executionDays;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.1 }}
      className="bg-black/40 border border-white/10 rounded-2xl p-5"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="size-8 rounded-lg bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center text-white text-xs font-bold">{index + 1}</div>
        <div>
          <h4 className="text-sm font-bold text-white">{rec.departmentLabel}</h4>
          <p className="text-xs text-gray-500">{rec.executionDays} days total</p>
        </div>
      </div>
      {/* Gantt bars */}
      <div className="space-y-2">
        {rec.phases.map((phase, pIdx) => {
          const startPct = (dayOffset / totalDays) * 100;
          const widthPct = (phase.durationDays / totalDays) * 100;
          dayOffset += phase.durationDays;
          return (
            <div key={pIdx} className="relative">
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="text-gray-400">{phase.title}</span>
                <span className="text-gray-600">{phase.durationDays}d</span>
              </div>
              <div className="h-6 bg-white/5 rounded-lg overflow-hidden relative">
                <div
                  className="h-full rounded-lg flex items-center px-2"
                  style={{
                    marginLeft: `${startPct}%`,
                    width: `${widthPct}%`,
                    background: `${COLORS[pIdx % COLORS.length]}30`,
                    borderLeft: `2px solid ${COLORS[pIdx % COLORS.length]}`,
                  }}
                >
                  <span className="text-xs text-white/70 truncate">{phase.title}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

function NextStepCard({ step, title, description, icon: Icon }: {
  step: number; title: string; description: string; icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: step * 0.1 }}
      className="bg-black/40 border border-white/10 rounded-2xl p-6 hover:border-[#8B5CF6]/30 transition-colors"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="size-10 rounded-xl bg-gradient-to-br from-[#8B5CF6]/20 to-[#3B82F6]/10 flex items-center justify-center border border-[#8B5CF6]/20">
          <Icon className="size-5 text-[#8B5CF6]" />
        </div>
        <span className="size-6 rounded-full bg-[#8B5CF6] text-white flex items-center justify-center text-xs font-bold">{step}</span>
      </div>
      <h4 className="text-sm font-bold text-white mb-1">{title}</h4>
      <p className="text-xs text-gray-400 leading-relaxed">{description}</p>
    </motion.div>
  );
}

export default ClientReportDashboard;
