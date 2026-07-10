/**
 * SYSTEM ARCHITECTURE — MARQ Cortex Product Architecture
 *
 * Interactive visual architecture diagram showing all layers:
 *   - Frontend (React + Tailwind)
 *   - Core Engine Pipeline (4-module deterministic)
 *   - Finance Engine Stack (ROI, Cashflow, DCF, IRR, Monte Carlo, Scenarios)
 *   - Backend (Supabase Edge Functions + KV Store + Storage)
 *   - AI Layer (GPT-4o-mini narrative only)
 *   - Client & Team Portals
 *
 * Shows data flow, dependencies, and module boundaries.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Brain, Layers, Database, Globe, Shield, Zap, Server,
  ArrowRight, ArrowDown, ChevronDown, ChevronUp,
  FileText, BarChart3, Users, Lock, Eye, Settings,
  Activity, Target, DollarSign, TrendingUp, Code,
  Cpu, Cloud, GitBranch, Boxes, Network, Workflow,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// ARCHITECTURE DATA
// ═══════════════════════════════════════════════════════════════════════════

interface ArchLayer {
  id: string;
  title: string;
  subtitle: string;
  color: string;
  icon: React.ComponentType<{ className?: string }>;
  modules: ArchModule[];
}

interface ArchModule {
  name: string;
  description: string;
  files?: string[];
  status: 'complete' | 'in-progress' | 'planned';
  type: 'core' | 'ui' | 'api' | 'data' | 'ai';
}

const LAYERS: ArchLayer[] = [
  {
    id: 'frontend',
    title: 'Frontend Application Layer',
    subtitle: 'React 18 + Tailwind CSS v4 + React Router (Hash) + Motion',
    color: '#8B5CF6',
    icon: Globe,
    modules: [
      { name: 'Landing Page & Lead Capture', description: 'Public-facing pages with diagnostic form, instant scoring, and lead magnet capture', files: ['LandingPage.tsx', 'LeadMagnetCapture.tsx', 'DiagnosticForm.tsx', 'ScorePage.tsx'], status: 'complete', type: 'ui' },
      { name: 'Client Portal', description: 'Authenticated client view with status tracking, readiness report, messaging, proposal viewer, and assessment review', files: ['ClientPortal.tsx', 'ClientReadinessReport.tsx', 'ClientMessaging.tsx', 'ProposalViewer.tsx', 'ClientQAReview.tsx'], status: 'complete', type: 'ui' },
      { name: 'Client Report Dashboard', description: 'Interactive deliverable report with charts, financials, timeline, and PDF export', files: ['ClientReportDashboard.tsx'], status: 'complete', type: 'ui' },
      { name: 'Team Dashboard (Command Center)', description: 'Executive command center with KPIs, pipeline funnel, submission trends, priority actions, and team pulse', files: ['TeamHomeDashboard.tsx', 'TeamDashboardLayout.tsx', 'FullFeaturedDashboard.tsx'], status: 'complete', type: 'ui' },
      { name: 'CORTEX AI Dashboard', description: 'Deep-dive analysis workbench with multi-tab layout: Diagnostics, ROI, Proposals, Execution', files: ['CortexDashboard.tsx', 'CortexDashboardSections.tsx', 'CortexModulesNew.tsx'], status: 'complete', type: 'ui' },
      { name: 'Proposal Draft System', description: 'Section-by-section proposal editor with AI assist per block, version history, and annotation', files: ['ProposalDraftEditor.tsx', 'ProposalSectionCopilot.tsx', 'ProposalAnnotationLayer.tsx', 'EditableBlockCard.tsx'], status: 'complete', type: 'ui' },
      { name: 'Revenue Intelligence Dashboard', description: 'Revenue analytics with deal scoring, pipeline health, and forecasting', files: ['RevenueIntelligenceDashboard.tsx'], status: 'complete', type: 'ui' },
      { name: 'Execution Dashboard', description: 'Sprint execution tracking with Kanban, milestones, and live progress', files: ['ExecutionDashboard.tsx', 'PipelineKanban.tsx'], status: 'complete', type: 'ui' },
      { name: 'Global AI Chat System', description: 'Floating AI copilot with lead context selector, section switcher, auto-grounding', files: ['GlobalAIChat.tsx', 'GlobalAIChatContext.tsx', 'InlineAITrigger.tsx', 'CopilotPanel.tsx'], status: 'complete', type: 'ai' },
      { name: 'Settings & Team Management', description: 'Team member management, role switching, notification center, keyboard shortcuts', files: ['SettingsPage.tsx', 'TeamManagement.tsx', 'RoleSwitcher.tsx', 'NotificationCenter.tsx'], status: 'complete', type: 'ui' },
    ],
  },
  {
    id: 'core-engine',
    title: 'Core Deterministic Engine',
    subtitle: 'Math decides priority. LLM only explains decisions.',
    color: '#3B82F6',
    icon: Cpu,
    modules: [
      { name: 'Input Normalizer', description: 'Converts raw diagnostic answers into structured NormalizedDiagnostics with causal categories, signal types, and domain pain counts', files: ['inputNormalizer.ts'], status: 'complete', type: 'core' },
      { name: 'Scoring Engine', description: 'Computes 6-domain DomainScores (0-100) with industry adjustment: pain_weight*0.4 + causal_weight*0.3 + maturity_weight*0.2 + cross_dept*0.1', files: ['scoringEngine.ts'], status: 'complete', type: 'core' },
      { name: 'Decision Engine', description: 'Selects core problem via math ranking. Identifies hybrid if top-2 gap < 10%. Generates deterministic reasoning', files: ['decisionEngine.ts'], status: 'complete', type: 'core' },
      { name: 'Template Assembler', description: 'Maps decision → sprint template → full CortexEnginePayload with phases, KPIs, risks, financials', files: ['templateAssembler.ts'], status: 'complete', type: 'core' },
      { name: 'Portfolio Engine', description: '7-department scan → multi-recommendation portfolio with cross-dependencies, capital allocation, execution sequencing', files: ['portfolioEngine.ts'], status: 'complete', type: 'core' },
      { name: 'Mapping Engine', description: 'Maps internal 6-domain scores to 7-department client-facing layer', files: ['mappingEngine.ts'], status: 'complete', type: 'core' },
      { name: 'Scope Engine', description: 'Determines scope boundaries per recommendation based on complexity and resource requirements', files: ['scopeEngine.ts'], status: 'complete', type: 'core' },
      { name: 'Consistency Validator', description: 'Cross-validates all engine outputs for mathematical consistency', files: ['consistencyValidator.ts'], status: 'complete', type: 'core' },
    ],
  },
  {
    id: 'finance-engine',
    title: 'Finance Engine Stack',
    subtitle: 'roi_engine_v1 → cashflow_v1 → dcf_v1 → irr_v2 → montecarlo_v3 → scenarios_v4',
    color: '#10B981',
    icon: DollarSign,
    modules: [
      { name: 'ROI Engine', description: 'Per-recommendation ROI with 4-type realization factors (efficiency/cost/revenue/risk), confidence weighting, 3-case range, dependency-safe aggregation', files: ['roiEngine.ts'], status: 'complete', type: 'core' },
      { name: 'Cost Model', description: 'Structured 5-category cost breakdown (engineering/strategy/tooling/change_mgmt/contingency). No lump sums.', files: ['costEngine.ts'], status: 'complete', type: 'core' },
      { name: 'Cashflow Engine', description: '12-month time-series with front-loaded investment, ramped gains, true payback month', files: ['cashflowEngine.ts'], status: 'complete', type: 'core' },
      { name: 'DCF Engine', description: 'Discounted cash flow / NPV. r_monthly = rate/12. DCF(n) = Net(n)/(1+r)^n', files: ['dcfEngine.ts'], status: 'complete', type: 'core' },
      { name: 'IRR Engine', description: 'Internal Rate of Return via binary search. Converges to 0.0001 tolerance', files: ['irrEngine.ts'], status: 'complete', type: 'core' },
      { name: 'Monte Carlo Engine', description: '1,000-run simulation with triangular/discrete distributions. P10/P50/P90 for ROI, payback, NPV', files: ['monteCarloEngine.ts'], status: 'complete', type: 'core' },
      { name: 'Scenario Engine', description: 'Conservative/Expected/Aggressive presets with ramp shift and confidence clamp', files: ['scenarioEngine.ts'], status: 'complete', type: 'core' },
      { name: 'Dependency Engine', description: 'DAG validation, topological sort, gain deduplication, circular dependency detection', files: ['dependencyEngine.ts'], status: 'complete', type: 'core' },
      { name: 'Version Engine', description: 'Immutable version history (25+ versions). Chat-driven recalculation. Delta logging', files: ['versionEngine.ts'], status: 'complete', type: 'core' },
    ],
  },
  {
    id: 'ai-layer',
    title: 'AI Narrative Layer',
    subtitle: 'GPT-4o-mini for explanation ONLY. Never decides priority or ROI.',
    color: '#EC4899',
    icon: Brain,
    modules: [
      { name: 'AI Scoring Prompts', description: 'Structured prompts for generating natural language explanations of math-derived decisions', files: ['cortexAIPrompts.ts', 'mockAIAnalysis.ts'], status: 'complete', type: 'ai' },
      { name: 'Proposal Section Copilot', description: 'Per-block AI assist for proposal draft editing. Suggests, rewrites, or expands sections', files: ['ProposalSectionCopilot.tsx'], status: 'complete', type: 'ai' },
      { name: 'Global AI Chat (chatWithAI)', description: 'Context-grounded AI chat with lead selector, section switcher, and auto-grounding via _LeadSyncer', files: ['api.ts (chatWithAI)', 'GlobalAIChatContext.tsx', 'GlobalAIChat.tsx'], status: 'complete', type: 'ai' },
      { name: 'AI Assist Engine', description: 'Inline AI suggestions for diagnostic answers, proposal blocks, and execution notes', files: ['aiAssistEngine.ts'], status: 'complete', type: 'ai' },
      { name: 'Objection Handler', description: 'AI-powered objection response generation for sales conversations', files: ['objectionEngine.ts', 'ObjectionHandlerPanel.tsx'], status: 'complete', type: 'ai' },
      { name: 'QBR Generator', description: 'Quarterly Business Review generation from live actuals + diagnostic data', files: ['qbrEngine.ts', 'QBRPanel.tsx'], status: 'complete', type: 'ai' },
    ],
  },
  {
    id: 'backend',
    title: 'Backend Infrastructure',
    subtitle: 'Supabase Edge Functions (Hono) + KV Store + Auth + Storage',
    color: '#FB923C',
    icon: Server,
    modules: [
      { name: 'Hono Web Server', description: 'Edge function running Hono with CORS, logging, and route-prefixed endpoints', files: ['server/index.tsx'], status: 'complete', type: 'api' },
      { name: 'KV Store', description: 'Key-value persistence layer for all application data. Supports get/set/del/mget/mset/mdel/getByPrefix', files: ['server/kv_store.tsx'], status: 'complete', type: 'data' },
      { name: 'Auth Service', description: 'Team login (admin/reviewer/viewer roles) and client login with session management', files: ['api.ts'], status: 'complete', type: 'api' },
      { name: 'Diagnostic Submission API', description: 'Submit, retrieve, update diagnostic submissions. Supports status workflow', files: ['api.ts'], status: 'complete', type: 'api' },
      { name: 'Engagement Tracking', description: 'Client portal event tracking (views, clicks, prints, meetings)', files: ['api.ts'], status: 'complete', type: 'api' },
      { name: 'Feature Flags', description: 'BACKEND_INTEGRATION toggle for demo/production mode switching', files: ['features.ts'], status: 'complete', type: 'data' },
    ],
  },
  {
    id: 'data-flow',
    title: 'Data Flow & State Management',
    subtitle: 'AppContext → DashboardContext → GlobalAIChatContext',
    color: '#06D7F6',
    icon: Network,
    modules: [
      { name: 'AppContext', description: 'Root state: auth sessions (team + client), login/logout, route guards', files: ['AppContext.tsx'], status: 'complete', type: 'data' },
      { name: 'DashboardContext', description: 'Team dashboard state: submissions list, active submission, filters, search', files: ['DashboardContext.tsx'], status: 'complete', type: 'data' },
      { name: 'GlobalAIChatContext', description: 'AI chat state: messages, active lead, section grounding, loading state', files: ['GlobalAIChatContext.tsx'], status: 'complete', type: 'data' },
      { name: 'Demo Data System', description: 'Centralized demo/seed data for all components when backend is disabled', files: ['demoData.ts', 'mockCortexData.ts', 'mockClientReport.ts'], status: 'complete', type: 'data' },
      { name: 'Client Report Generator', description: 'Converts Submission → ClientReadinessReportProps with executive-friendly language', files: ['clientReportGenerator.ts'], status: 'complete', type: 'data' },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// DATA PIPELINE STEPS (for flow diagram)
// ═══════════════════════════════════════════════════════════════════════════

const PIPELINE_STEPS = [
  { label: 'Client Submits Diagnostic', icon: FileText, color: '#8B5CF6' },
  { label: 'Input Normalizer', icon: Code, color: '#3B82F6' },
  { label: 'Scoring Engine (6 domains)', icon: BarChart3, color: '#3B82F6' },
  { label: 'Decision Engine (Math)', icon: Target, color: '#3B82F6' },
  { label: 'Template Assembler', icon: Boxes, color: '#3B82F6' },
  { label: 'Portfolio Builder (7 depts)', icon: Layers, color: '#10B981' },
  { label: 'ROI + Cost + Cashflow', icon: DollarSign, color: '#10B981' },
  { label: 'DCF + IRR + Monte Carlo', icon: TrendingUp, color: '#10B981' },
  { label: 'AI Narrative (GPT-4o-mini)', icon: Brain, color: '#EC4899' },
  { label: 'Client Report Delivered', icon: FileText, color: '#8B5CF6' },
];

// ═══════════════════════════════════════════════════════════════════════════
// WEAKNESSES / IMPROVEMENT AREAS
// ═══════════════════════════════════════════════════════════════════════════

const ARCHITECTURE_STRENGTHS = [
  { title: 'Deterministic Core', description: 'Math-first engine ensures reproducible, auditable results. No LLM in decision path.' },
  { title: 'Layered Finance Stack', description: '6-layer financial modeling (ROI → Cost → Cashflow → DCF → IRR → Monte Carlo) with scenario support.' },
  { title: 'Feature Flag System', description: 'Clean demo/production toggle. Zero API calls in demo mode.' },
  { title: 'Modular Engine Pipeline', description: '4-stage pipeline (Normalize → Score → Decide → Assemble) with locked data contracts.' },
  { title: 'Version Control Engine', description: 'Immutable version history with delta logging and chat-driven recalculation.' },
  { title: 'Client-Team Separation', description: 'Clean boundary between internal team tooling and client-facing deliverables.' },
];

const ARCHITECTURE_WEAKNESSES = [
  { title: 'State Management Complexity', description: '3 nested context providers. Consider Zustand or Jotai for flatter state.', severity: 'medium' },
  { title: 'Bundle Size', description: 'All routes are in one app. Consider code-splitting heavy components more aggressively.', severity: 'low' },
  { title: 'Testing Coverage', description: 'No unit tests for core engines. Critical path needs test harness.', severity: 'high' },
  { title: 'Real-time Updates', description: 'Polling-based (30s). Consider Supabase Realtime for push-based updates.', severity: 'medium' },
  { title: 'Error Recovery', description: 'Error boundaries exist but no retry logic or offline queue for failed mutations.', severity: 'medium' },
  { title: 'API Rate Limiting', description: 'No rate limiting on edge functions. Vulnerable to abuse at scale.', severity: 'high' },
  { title: 'Data Validation', description: 'KV store has no schema validation. Consider Zod for runtime validation.', severity: 'medium' },
  { title: 'Multi-tenancy', description: 'Single-tenant architecture. Needs tenant isolation for multiple consultancy accounts.', severity: 'high' },
];

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function SystemArchitecture() {
  const [expandedLayer, setExpandedLayer] = useState<string | null>('core-engine');
  const [activeTab, setActiveTab] = useState<'layers' | 'pipeline' | 'analysis'>('layers');

  const totalModules = LAYERS.reduce((s, l) => s + l.modules.length, 0);
  const completeModules = LAYERS.reduce((s, l) => s + l.modules.filter(m => m.status === 'complete').length, 0);

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white">
      {/* Header */}
      <div className="bg-black/80 border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="size-12 rounded-2xl bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center">
              <Workflow className="size-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">MARQ Cortex — System Architecture</h1>
              <p className="text-sm text-gray-400">Product architecture, data flow, and system analysis</p>
            </div>
          </div>
          {/* Stats bar */}
          <div className="flex items-center gap-6 text-xs">
            <span className="flex items-center gap-1.5 text-green-400"><Zap className="size-3.5" /> {completeModules}/{totalModules} modules complete</span>
            <span className="flex items-center gap-1.5 text-purple-400"><Layers className="size-3.5" /> {LAYERS.length} architecture layers</span>
            <span className="flex items-center gap-1.5 text-blue-400"><GitBranch className="size-3.5" /> {PIPELINE_STEPS.length}-step pipeline</span>
            <span className="flex items-center gap-1.5 text-cyan-400"><Shield className="size-3.5" /> Deterministic core</span>
          </div>
          {/* Tabs */}
          <nav className="flex gap-1 mt-4">
            {[
              { id: 'layers' as const, label: 'Architecture Layers' },
              { id: 'pipeline' as const, label: 'Data Pipeline' },
              { id: 'analysis' as const, label: 'Strengths & Weaknesses' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab.id ? 'bg-[#8B5CF6] text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <AnimatePresence mode="wait">
          {/* TAB 1: Architecture Layers */}
          {activeTab === 'layers' && (
            <motion.div key="layers" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
              {LAYERS.map((layer, lIdx) => (
                <LayerCard
                  key={layer.id}
                  layer={layer}
                  index={lIdx}
                  expanded={expandedLayer === layer.id}
                  onToggle={() => setExpandedLayer(expandedLayer === layer.id ? null : layer.id)}
                />
              ))}
            </motion.div>
          )}

          {/* TAB 2: Data Pipeline */}
          {activeTab === 'pipeline' && (
            <motion.div key="pipeline" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="bg-black/40 border border-white/10 rounded-2xl p-8">
                <h3 className="text-lg font-bold text-white mb-6">Core Data Pipeline</h3>
                <p className="text-sm text-gray-400 mb-8">
                  Data flows through a deterministic 10-step pipeline. The AI layer is explicitly gated:
                  it can only <strong className="text-white">explain</strong> decisions, never <strong className="text-white">make</strong> them.
                </p>
                <div className="space-y-3">
                  {PIPELINE_STEPS.map((step, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="flex items-center gap-4"
                    >
                      <div className="size-10 rounded-xl flex items-center justify-center flex-shrink-0 border"
                        style={{ background: `${step.color}15`, borderColor: `${step.color}30` }}>
                        <step.icon className="size-5" style={{ color: step.color }} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-gray-500">STEP {idx + 1}</span>
                          <span className="text-sm font-medium text-white">{step.label}</span>
                        </div>
                      </div>
                      {idx < PIPELINE_STEPS.length - 1 && (
                        <ArrowDown className="size-4 text-gray-600 flex-shrink-0" />
                      )}
                    </motion.div>
                  ))}
                </div>
                {/* Key rules */}
                <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <RuleCard icon={Lock} title="Math-First" description="Priority scores, ROI, and all financial metrics are computed deterministically. No LLM influence." color="#3B82F6" />
                  <RuleCard icon={Shield} title="Immutable Versions" description="Every recalculation creates a new immutable version. ≥25 versions stored with delta logs." color="#10B981" />
                  <RuleCard icon={Eye} title="Full Transparency" description="Every number traces back to its formula, assumptions, and input data. No black boxes." color="#8B5CF6" />
                </div>
              </div>

              {/* Engine dependency map */}
              <div className="mt-6 bg-black/40 border border-white/10 rounded-2xl p-8">
                <h3 className="text-lg font-bold text-white mb-4">Finance Engine Dependency Chain</h3>
                <div className="flex items-start gap-2 flex-wrap">
                  {[
                    { label: 'ROI Engine', sub: 'v1', color: '#10B981' },
                    { label: 'Cost Model', sub: 'v1', color: '#10B981' },
                    { label: 'Cashflow', sub: 'v1', color: '#3B82F6' },
                    { label: 'DCF/NPV', sub: 'v1', color: '#3B82F6' },
                    { label: 'IRR', sub: 'v2', color: '#8B5CF6' },
                    { label: 'Monte Carlo', sub: 'v3', color: '#EC4899' },
                    { label: 'Scenarios', sub: 'v4', color: '#FB923C' },
                  ].map((eng, idx) => (
                    <span key={eng.label} className="contents">
                      <div className="px-4 py-3 rounded-xl border text-center" style={{ background: `${eng.color}10`, borderColor: `${eng.color}30` }}>
                        <div className="text-sm font-bold text-white">{eng.label}</div>
                        <div className="text-xs mt-0.5" style={{ color: eng.color }}>{eng.sub}</div>
                      </div>
                      {idx < 6 && <ArrowRight className="size-4 text-gray-600 self-center flex-shrink-0" />}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-4">
                  Each engine runs sequentially. Downstream engines never modify upstream outputs. DCF/IRR/Monte Carlo operate on validated cashflow only.
                </p>
              </div>
            </motion.div>
          )}

          {/* TAB 3: Strengths & Weaknesses */}
          {activeTab === 'analysis' && (
            <motion.div key="analysis" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8">
              {/* Strengths */}
              <div>
                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                  <Zap className="size-5 text-green-400" /> Architecture Strengths
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {ARCHITECTURE_STRENGTHS.map((s, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}
                      className="p-5 bg-green-500/5 border border-green-500/20 rounded-2xl"
                    >
                      <h4 className="text-sm font-bold text-white mb-1">{s.title}</h4>
                      <p className="text-xs text-gray-400 leading-relaxed">{s.description}</p>
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* Weaknesses */}
              <div>
                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                  <AlertTriangle className="size-5 text-orange-400" /> Areas for Improvement
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {ARCHITECTURE_WEAKNESSES.map((w, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}
                      className={`p-5 rounded-2xl border ${
                        w.severity === 'high'
                          ? 'bg-red-500/5 border-red-500/20'
                          : w.severity === 'medium'
                          ? 'bg-orange-500/5 border-orange-500/20'
                          : 'bg-yellow-500/5 border-yellow-500/20'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-sm font-bold text-white">{w.title}</h4>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          w.severity === 'high' ? 'bg-red-500/20 text-red-400' :
                          w.severity === 'medium' ? 'bg-orange-500/20 text-orange-400' :
                          'bg-yellow-500/20 text-yellow-400'
                        }`}>
                          {w.severity}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 leading-relaxed">{w.description}</p>
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* Recommended Next Steps */}
              <div>
                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                  <Target className="size-5 text-purple-400" /> Recommended Architectural Next Steps
                </h3>
                <div className="space-y-3">
                  {[
                    { priority: 1, title: 'Add Core Engine Unit Tests', description: 'Create test harness for InputNormalizer, ScoringEngine, DecisionEngine, ROIEngine with ExampleCo gold-standard payload.', effort: 'Medium' },
                    { priority: 2, title: 'Implement API Rate Limiting', description: 'Add rate limiting middleware to Hono server. Protect auth endpoints and submission APIs.', effort: 'Low' },
                    { priority: 3, title: 'Add Zod Runtime Validation', description: 'Validate all KV store reads/writes against Zod schemas. Catch data corruption early.', effort: 'Medium' },
                    { priority: 4, title: 'Migrate to Zustand', description: 'Replace 3-layer context nesting with flat Zustand stores for better performance and DX.', effort: 'High' },
                    { priority: 5, title: 'Enable Supabase Realtime', description: 'Replace 30s polling with Supabase Realtime subscriptions for instant updates.', effort: 'Medium' },
                    { priority: 6, title: 'Multi-Tenant Architecture', description: 'Add tenant isolation (org_id prefix on all KV keys) to support multiple consultancy accounts.', effort: 'High' },
                  ].map(step => (
                    <div key={step.priority} className="flex items-start gap-4 p-4 bg-black/40 border border-white/10 rounded-xl">
                      <div className="size-8 rounded-lg bg-[#8B5CF6]/20 text-[#8B5CF6] flex items-center justify-center flex-shrink-0 text-sm font-bold">
                        {step.priority}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-white">{step.title}</h4>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            step.effort === 'Low' ? 'bg-green-500/20 text-green-400' :
                            step.effort === 'Medium' ? 'bg-blue-500/20 text-blue-400' :
                            'bg-orange-500/20 text-orange-400'
                          }`}>
                            {step.effort} effort
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">{step.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function LayerCard({ layer, index, expanded, onToggle }: {
  layer: ArchLayer; index: number; expanded: boolean; onToggle: () => void;
}) {
  const completeCount = layer.modules.filter(m => m.status === 'complete').length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}
      className="bg-black/40 border border-white/10 rounded-2xl overflow-hidden hover:border-white/15 transition-colors"
    >
      <button onClick={onToggle} className="w-full text-left p-5 flex items-start gap-4">
        <div className="size-10 rounded-xl flex items-center justify-center flex-shrink-0 border"
          style={{ background: `${layer.color}15`, borderColor: `${layer.color}30` }}>
          <layer.icon className="size-5" style={{ color: layer.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-white">{layer.title}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{layer.subtitle}</p>
          <div className="flex items-center gap-3 mt-2 text-xs">
            <span className="text-green-400">{completeCount}/{layer.modules.length} modules</span>
            <div className="flex-1 h-1.5 bg-white/5 rounded-full max-w-[120px]">
              <div className="h-full rounded-full" style={{ width: `${(completeCount / layer.modules.length) * 100}%`, background: layer.color }} />
            </div>
          </div>
        </div>
        {expanded ? <ChevronUp className="size-5 text-gray-400" /> : <ChevronDown className="size-5 text-gray-400" />}
      </button>

      {expanded && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
          className="border-t border-white/5 p-5"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {layer.modules.map((mod, mIdx) => (
              <div key={mIdx} className="p-3 bg-white/3 border border-white/5 rounded-xl">
                <div className="flex items-center gap-2 mb-1">
                  <div className={`size-2 rounded-full ${
                    mod.status === 'complete' ? 'bg-green-400' :
                    mod.status === 'in-progress' ? 'bg-yellow-400' : 'bg-gray-500'
                  }`} />
                  <span className="text-xs font-bold text-white">{mod.name}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    mod.type === 'core' ? 'bg-blue-500/20 text-blue-400' :
                    mod.type === 'ui' ? 'bg-purple-500/20 text-purple-400' :
                    mod.type === 'ai' ? 'bg-pink-500/20 text-pink-400' :
                    mod.type === 'api' ? 'bg-orange-500/20 text-orange-400' :
                    'bg-cyan-500/20 text-cyan-400'
                  }`}>
                    {mod.type}
                  </span>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">{mod.description}</p>
                {mod.files && mod.files.length > 0 && (
                  <div className="flex gap-1 flex-wrap mt-2">
                    {mod.files.map(f => (
                      <span key={f} className="text-xs px-1.5 py-0.5 bg-white/5 rounded text-gray-500 font-mono">{f}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

function RuleCard({ icon: Icon, title, description, color }: {
  icon: React.ComponentType<{ className?: string }>; title: string; description: string; color: string;
}) {
  return (
    <div className="p-4 rounded-xl border" style={{ background: `${color}08`, borderColor: `${color}20` }}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="size-4" style={{ color }} />
        <span className="text-sm font-bold text-white">{title}</span>
      </div>
      <p className="text-xs text-gray-400 leading-relaxed">{description}</p>
    </div>
  );
}

export default SystemArchitecture;
