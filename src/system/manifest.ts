/**
 * ══════════════════════════════════════════════════════════════════════════════
 * MARQ CORTEX — System Manifest  v2.0
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ┌─ WHAT THIS FILE IS ────────────────────────────────────────────────────────┐
 * │                                                                            │
 * │  This is the single authoritative map of every file in the MARQ Cortex    │
 * │  platform. Every page, component, engine module, service, hook, and type  │
 * │  schema has one entry here. Each entry maps to an exact file path.        │
 * │                                                                            │
 * │  It is the circuit diagram of the product.                                │
 * │                                                                            │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ HOW TO USE THIS FILE (for AI agents and developers) ──────────────────────┐
 * │                                                                            │
 * │  STEP 1 — Identify the node                                               │
 * │    Search this file by feature name, domain, or keyword.                  │
 * │    Every node has a description that explains what it does in plain terms. │
 * │                                                                            │
 * │  STEP 2 — Get the file path                                               │
 * │    The `filePath` field is the exact location of the file.               │
 * │    Open that file. Do not scan the filesystem.                            │
 * │                                                                            │
 * │  STEP 3 — Check dependencies before changing anything                    │
 * │    The `dependencies` array lists IDs of what this node imports.         │
 * │    The `dependents` array lists IDs of what imports this node.           │
 * │    A change to this node affects every node in `dependents`.             │
 * │                                                                            │
 * │  STEP 4 — Read the `notes` field                                         │
 * │    If a node has a `notes` field, read it before editing. It contains    │
 * │    known issues, debt, or constraints that will save you debugging time.  │
 * │                                                                            │
 * │  STEP 5 — When you create a new file, add it here first                  │
 * │    The ID comes before the implementation. Always.                        │
 * │                                                                            │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ ID FORMAT ─────────────────────────────────────────────────────────────────┐
 * │                                                                            │
 * │  MQC - {TYPE} - {NNN}                                                     │
 * │   │      │       └── Zero-padded 3-digit sequence within the type group   │
 * │   │      └────────── PAGE | COMP | CORE | SVC | HOOK | TYPE               │
 * │   └───────────────── Product prefix. Always MQC.                          │
 * │                                                                            │
 * │  IDs never change once assigned. If a file is deleted, its ID is retired  │
 * │  (status: MISSING) — never reused.                                        │
 * │                                                                            │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ STATUS MEANINGS ───────────────────────────────────────────────────────────┐
 * │  LIVE    — Works end-to-end. Real data. No mock bypass.                   │
 * │  DEMO    — Renders correctly but uses mock data (BACKEND_INTEGRATION=false)│
 * │  GATED   — Exists but hidden behind a condition not yet met               │
 * │  MISSING — Referenced but file does not exist on disk                     │
 * │  SYSTEM  — Internal dev/utility node, not part of the product surface     │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ CORE RULE (governs the entire system) ────────────────────────────────────┐
 * │  "Math decides priority. LLM only explains decisions."                    │
 * │  No AI service may determine an outcome. It may only narrate one.         │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Total nodes: 158  (PAGE ×12 · COMP ×89 · CORE ×35 · SVC ×9 · HOOK ×6 · TYPE ×7)
 * Last verified: 2026-03-05
 * BACKEND_INTEGRATION: false (demo mode — target: flip to true)
 */

import type { SystemManifest } from './types';

export const manifest: SystemManifest = {
  version: '2.0.0',
  lastVerified: '2026-07-11',
  coreRule: 'Math decides priority. LLM only explains decisions.',
  backendIntegration: false,

  nodes: {

    // ══════════════════════════════════════════════════════════════════════════
    // PAGES — Routes registered in App.tsx  (MQC-PAGE-001 → MQC-PAGE-012)
    // ══════════════════════════════════════════════════════════════════════════

    'MQC-PAGE-000': {
      id: 'MQC-PAGE-000',
      name: 'RootLayout',
      type: 'PAGE',
      status: 'LIVE',
      domain: 'SYSTEM',
      filePath: 'src/app/pages/RootLayout.tsx',
      description: 'The top-level layout shell wrapping every route. Mounts global providers, the offline banner, and the error boundary that catches any unhandled route-level exceptions.',
      dependencies: ['MQC-COMP-081', 'MQC-COMP-084', 'MQC-HOOK-004'],
      dependents: [],
      route: '#/',
    },

    'MQC-PAGE-001': {
      id: 'MQC-PAGE-001',
      name: 'LandingPageRoute',
      type: 'PAGE',
      status: 'LIVE',
      domain: 'LEAD',
      filePath: 'src/app/pages/LandingPageRoute.tsx',
      description: 'The public landing page. The only eagerly-bundled route — all others are lazy. First paint for every visitor.',
      dependencies: ['MQC-COMP-071'],
      dependents: [],
      route: '#/',
    },

    'MQC-PAGE-002': {
      id: 'MQC-PAGE-002',
      name: 'LeadMagnetRoute',
      type: 'PAGE',
      status: 'LIVE',
      domain: 'LEAD',
      filePath: 'src/app/pages/LeadMagnetRoute.tsx',
      description: 'The get-started / lead capture route. Lazy-loaded. Hosts LeadMagnetCapture which dynamically imports pdfExport to prevent jsPDF from blocking the initial bundle.',
      dependencies: ['MQC-COMP-072'],
      dependents: [],
      route: '#/get-started',
      notes: 'pdfExport must remain a dynamic import() inside the handler, never a top-level import. See LeadMagnetCapture notes.',
    },

    'MQC-PAGE-003': {
      id: 'MQC-PAGE-003',
      name: 'DiagnosticRoute',
      type: 'PAGE',
      status: 'LIVE',
      domain: 'DIAGNOSTIC',
      filePath: 'src/app/pages/DiagnosticRoute.tsx',
      description: 'Route wrapper for the 14-question AI-readiness diagnostic form. Lazy-loaded as a separate chunk.',
      dependencies: ['MQC-COMP-004'],
      dependents: [],
      route: '#/diagnostic',
    },

    'MQC-PAGE-004': {
      id: 'MQC-PAGE-004',
      name: 'ScoreRoute',
      type: 'PAGE',
      status: 'LIVE',
      domain: 'DIAGNOSTIC',
      filePath: 'src/app/pages/ScoreRoute.tsx',
      description: 'Route wrapper for the instant score results page shown after diagnostic completion. Lazy-loaded.',
      dependencies: ['MQC-COMP-008'],
      dependents: [],
      route: '#/score',
    },

    'MQC-PAGE-005': {
      id: 'MQC-PAGE-005',
      name: 'TeamLoginRoute',
      type: 'PAGE',
      status: 'LIVE',
      domain: 'AUTH',
      filePath: 'src/app/pages/TeamLoginRoute.tsx',
      description: 'Route wrapper for the CORTEX team login screen. Lazy-loaded.',
      dependencies: ['MQC-COMP-002'],
      dependents: [],
      route: '#/team/login',
    },

    'MQC-PAGE-006': {
      id: 'MQC-PAGE-006',
      name: 'TeamDashboardRoute',
      type: 'PAGE',
      status: 'LIVE',
      domain: 'EXECUTION',
      filePath: 'src/app/pages/TeamDashboardRoute.tsx',
      description: 'Route wrapper for the internal CORTEX team dashboard. Lazy-loaded. The heaviest route — mounts TeamDashboardLayout which wraps GlobalAIChatProvider.',
      dependencies: ['MQC-COMP-036', 'MQC-COMP-037'],
      dependents: [],
      route: '#/team/dashboard',
    },

    'MQC-PAGE-007': {
      id: 'MQC-PAGE-007',
      name: 'ExecutionRoute',
      type: 'PAGE',
      status: 'LIVE',
      domain: 'EXECUTION',
      filePath: 'src/app/pages/ExecutionRoute.tsx',
      description: 'Route wrapper for the sprint execution view. Lazy-loaded.',
      dependencies: ['MQC-COMP-040'],
      dependents: [],
      route: '#/team/execution',
    },

    'MQC-PAGE-008': {
      id: 'MQC-PAGE-008',
      name: 'ClientLoginRoute',
      type: 'PAGE',
      status: 'LIVE',
      domain: 'AUTH',
      filePath: 'src/app/pages/ClientLoginRoute.tsx',
      description: 'Route wrapper for the client portal login screen. Lazy-loaded.',
      dependencies: ['MQC-COMP-001'],
      dependents: [],
      route: '#/client/login',
    },

    'MQC-PAGE-009': {
      id: 'MQC-PAGE-009',
      name: 'ClientPortalRoute',
      type: 'PAGE',
      status: 'LIVE',
      domain: 'PORTAL',
      filePath: 'src/app/pages/ClientPortalRoute.tsx',
      description: 'Route wrapper for the full client portal with 8 tabs. Lazy-loaded. Tab order: Status → Solution → Readiness Report → Schedule a Call → Proposal → Messages → Your Assessment → Strategic Report.',
      dependencies: ['MQC-COMP-010'],
      dependents: [],
      route: '#/client/portal',
    },

    'MQC-PAGE-010': {
      id: 'MQC-PAGE-010',
      name: 'SystemArchitecture',
      type: 'PAGE',
      status: 'SYSTEM',
      domain: 'SYSTEM',
      filePath: 'src/app/components/SystemArchitecture.tsx',
      description: 'Developer utility: visual architecture diagram of the entire platform. Not exposed in the product UI. Accessible at #/architecture.',
      dependencies: [],
      dependents: [],
      route: '#/architecture',
    },

    'MQC-PAGE-011': {
      id: 'MQC-PAGE-011',
      name: 'RegistryViewer',
      type: 'PAGE',
      status: 'SYSTEM',
      domain: 'SYSTEM',
      filePath: 'src/app/components/RegistryViewer.tsx',
      description: 'Developer utility: the live system registry viewer with 7 tabs — Registry, Bug Patterns, KV Directory, Stats, Processes, Interactions, and Audit. Reads from this manifest. Accessible at #/registry.',
      dependencies: [],
      dependents: [],
      route: '#/registry',
      notes: 'File was accidentally wiped in a session on 2026-03-05. Must be restored from git before the debounce + pagination performance fix can be applied.',
    },

    // ══════════════════════════════════════════════════════════════════════════
    // COMPONENTS — /src/app/components  (MQC-COMP-001 → MQC-COMP-089)
    // ══════════════════════════════════════════════════════════════════════════

    // ── AUTH ─────────────────────────────────────────────────────────────────

    'MQC-COMP-001': {
      id: 'MQC-COMP-001',
      name: 'ClientLogin',
      type: 'COMP',
      status: 'LIVE',
      domain: 'AUTH',
      filePath: 'src/app/components/ClientLogin.tsx',
      description: 'Login form for clients accessing their portal. Authenticates via Supabase auth and redirects to #/client/portal on success.',
      dependencies: ['MQC-SVC-001', 'MQC-HOOK-004'],
      dependents: ['MQC-PAGE-008'],
      inputs: ['email', 'password'],
      outputs: ['session token'],
    },

    'MQC-COMP-002': {
      id: 'MQC-COMP-002',
      name: 'TeamLogin',
      type: 'COMP',
      status: 'LIVE',
      domain: 'AUTH',
      filePath: 'src/app/components/TeamLogin.tsx',
      description: 'Login form for CORTEX team members. Authenticates via Supabase and grants access to the internal team dashboard.',
      dependencies: ['MQC-SVC-001', 'MQC-HOOK-004'],
      dependents: ['MQC-PAGE-005'],
      inputs: ['email', 'password'],
      outputs: ['session token'],
    },

    'MQC-COMP-003': {
      id: 'MQC-COMP-003',
      name: 'RoleSwitcher',
      type: 'COMP',
      status: 'LIVE',
      domain: 'AUTH',
      filePath: 'src/app/components/RoleSwitcher.tsx',
      description: 'UI control allowing authorised team members to switch their active role between admin, reviewer, and consultant views without logging out.',
      dependencies: ['MQC-CORE-027', 'MQC-HOOK-004'],
      dependents: ['MQC-COMP-036'],
      inputs: ['currentRole'],
      outputs: ['newRole'],
    },

    // ── DIAGNOSTIC ───────────────────────────────────────────────────────────

    'MQC-COMP-004': {
      id: 'MQC-COMP-004',
      name: 'DiagnosticForm',
      type: 'COMP',
      status: 'LIVE',
      domain: 'DIAGNOSTIC',
      filePath: 'src/app/components/DiagnosticForm.tsx',
      description: 'The 14-question AI readiness diagnostic form. Orchestrates question flow, validates inputs, runs the scoring engine on completion, and submits results to the backend.',
      dependencies: ['MQC-COMP-005', 'MQC-COMP-006', 'MQC-COMP-007', 'MQC-CORE-030', 'MQC-CORE-016', 'MQC-SVC-001'],
      dependents: ['MQC-PAGE-003'],
      inputs: ['DiagnosticFormData'],
      outputs: ['ScoringResult', 'submission to backend'],
    },

    'MQC-COMP-005': {
      id: 'MQC-COMP-005',
      name: 'DiagnosticQuestion',
      type: 'COMP',
      status: 'LIVE',
      domain: 'DIAGNOSTIC',
      filePath: 'src/app/components/DiagnosticQuestion.tsx',
      description: 'A single question card in the diagnostic form. Renders the question text, answer options, and handles selection state.',
      dependencies: [],
      dependents: ['MQC-COMP-004'],
      inputs: ['QuestionConfig', 'currentAnswer'],
      outputs: ['onAnswer callback'],
    },

    'MQC-COMP-006': {
      id: 'MQC-COMP-006',
      name: 'UniversalQuestions',
      type: 'COMP',
      status: 'LIVE',
      domain: 'DIAGNOSTIC',
      filePath: 'src/app/components/UniversalQuestions.tsx',
      description: 'The set of questions asked to every respondent regardless of industry. These form the base of the scoring model.',
      dependencies: ['MQC-COMP-005'],
      dependents: ['MQC-COMP-004'],
    },

    'MQC-COMP-007': {
      id: 'MQC-COMP-007',
      name: 'IndustrialQuestions',
      type: 'COMP',
      status: 'LIVE',
      domain: 'DIAGNOSTIC',
      filePath: 'src/app/components/IndustrialQuestions.tsx',
      description: 'Industry-specific questions appended to the diagnostic based on the respondent\'s sector. Provides contextual depth to the scoring model.',
      dependencies: ['MQC-COMP-005'],
      dependents: ['MQC-COMP-004'],
    },

    'MQC-COMP-008': {
      id: 'MQC-COMP-008',
      name: 'ScorePage',
      type: 'COMP',
      status: 'LIVE',
      domain: 'DIAGNOSTIC',
      filePath: 'src/app/components/ScorePage.tsx',
      description: 'Displays the AI readiness score immediately after diagnostic completion. Shows the score band, key findings, and a CTA to schedule a call or see the full report.',
      dependencies: ['MQC-CORE-030', 'MQC-CORE-012', 'MQC-SVC-001'],
      dependents: ['MQC-PAGE-004'],
      inputs: ['ScoringResult'],
      outputs: ['displayed score + recommendations'],
    },

    'MQC-COMP-009': {
      id: 'MQC-COMP-009',
      name: 'StageTracker',
      type: 'COMP',
      status: 'LIVE',
      domain: 'DIAGNOSTIC',
      filePath: 'src/app/components/StageTracker.tsx',
      description: 'Visual progress indicator showing which stage of the engagement a submission is at. Used in both the team and client views.',
      dependencies: [],
      dependents: ['MQC-COMP-010', 'MQC-COMP-043'],
      inputs: ['stage', 'submissionStatus'],
    },

    // ── PORTAL (client-facing) ────────────────────────────────────────────────

    'MQC-COMP-010': {
      id: 'MQC-COMP-010',
      name: 'ClientPortal',
      type: 'COMP',
      status: 'LIVE',
      domain: 'PORTAL',
      filePath: 'src/app/components/ClientPortal.tsx',
      description: 'The 8-tab client portal shell. Tab order is fixed: Status → Solution → Readiness Report → Schedule a Call → Proposal → Messages → Your Assessment → Strategic Report.',
      dependencies: ['MQC-COMP-011', 'MQC-COMP-012', 'MQC-COMP-013', 'MQC-COMP-014', 'MQC-COMP-016', 'MQC-COMP-018', 'MQC-COMP-015', 'MQC-COMP-011', 'MQC-HOOK-004'],
      dependents: ['MQC-PAGE-009'],
      notes: 'Tab order is a product decision — do not reorder without explicit instruction.',
    },

    'MQC-COMP-011': {
      id: 'MQC-COMP-011',
      name: 'ClientReportDashboard',
      type: 'COMP',
      status: 'LIVE',
      domain: 'PORTAL',
      filePath: 'src/app/components/ClientReportDashboard.tsx',
      description: 'The Status tab of the client portal. Shows current engagement stage, outstanding actions, and a summary of progress.',
      dependencies: ['MQC-COMP-009', 'MQC-SVC-001'],
      dependents: ['MQC-COMP-010'],
    },

    'MQC-COMP-012': {
      id: 'MQC-COMP-012',
      name: 'ClientSolutionView',
      type: 'COMP',
      status: 'LIVE',
      domain: 'PORTAL',
      filePath: 'src/app/components/ClientSolutionView.tsx',
      description: 'The Solution tab of the client portal. Renders the recommended solution architecture and implementation path derived from the diagnostic.',
      dependencies: ['MQC-COMP-025', 'MQC-COMP-026', 'MQC-SVC-001'],
      dependents: ['MQC-COMP-010'],
    },

    'MQC-COMP-013': {
      id: 'MQC-COMP-013',
      name: 'ClientReadinessReport',
      type: 'COMP',
      status: 'LIVE',
      domain: 'PORTAL',
      filePath: 'src/app/components/ClientReadinessReport.tsx',
      description: 'The Readiness Report tab of the client portal. Renders the full AI readiness report with scored dimensions and narrative explanations.',
      dependencies: ['MQC-CORE-030', 'MQC-SVC-001'],
      dependents: ['MQC-COMP-010'],
    },

    'MQC-COMP-014': {
      id: 'MQC-COMP-014',
      name: 'ClientMessaging',
      type: 'COMP',
      status: 'LIVE',
      domain: 'PORTAL',
      filePath: 'src/app/components/ClientMessaging.tsx',
      description: 'The Messages tab of the client portal. Allows clients and team to exchange messages within the platform. Threads are stored in KV.',
      dependencies: ['MQC-SVC-001', 'MQC-SVC-009'],
      dependents: ['MQC-COMP-010'],
    },

    'MQC-COMP-015': {
      id: 'MQC-COMP-015',
      name: 'ClientQAReview',
      type: 'COMP',
      status: 'LIVE',
      domain: 'PORTAL',
      filePath: 'src/app/components/ClientQAReview.tsx',
      description: 'The Your Assessment tab of the client portal. Shows the client their answered diagnostic questions and the scores assigned to each response.',
      dependencies: ['MQC-SVC-001'],
      dependents: ['MQC-COMP-010'],
    },

    'MQC-COMP-016': {
      id: 'MQC-COMP-016',
      name: 'InstantBooking',
      type: 'COMP',
      status: 'LIVE',
      domain: 'PORTAL',
      filePath: 'src/app/components/InstantBooking.tsx',
      description: 'The Schedule a Call tab of the client portal. Allows clients to book a consultation call directly from their portal.',
      dependencies: ['MQC-COMP-017'],
      dependents: ['MQC-COMP-010'],
    },

    'MQC-COMP-017': {
      id: 'MQC-COMP-017',
      name: 'MeetingScheduler',
      type: 'COMP',
      status: 'LIVE',
      domain: 'PORTAL',
      filePath: 'src/app/components/MeetingScheduler.tsx',
      description: 'Calendar-based meeting booking widget embedded in InstantBooking. Handles time slot selection and confirmation.',
      dependencies: [],
      dependents: ['MQC-COMP-016'],
    },

    // ── PROPOSAL ─────────────────────────────────────────────────────────────

    'MQC-COMP-018': {
      id: 'MQC-COMP-018',
      name: 'ProposalViewer',
      type: 'COMP',
      status: 'LIVE',
      domain: 'PROPOSAL',
      filePath: 'src/app/components/ProposalViewer.tsx',
      description: 'Read-only proposal display for the client portal Proposal tab. Renders the assembled proposal sections with annotation layer support.',
      dependencies: ['MQC-COMP-022', 'MQC-SVC-001'],
      dependents: ['MQC-COMP-010'],
    },

    'MQC-COMP-019': {
      id: 'MQC-COMP-019',
      name: 'ProposalDraftEditor',
      type: 'COMP',
      status: 'LIVE',
      domain: 'PROPOSAL',
      filePath: 'src/app/components/ProposalDraftEditor.tsx',
      description: 'Rich-text editor for team members to author and refine proposal sections. Integrates with the copilot for AI-assisted writing suggestions.',
      dependencies: ['MQC-COMP-021', 'MQC-CORE-033', 'MQC-SVC-004'],
      dependents: ['MQC-COMP-020'],
    },

    'MQC-COMP-020': {
      id: 'MQC-COMP-020',
      name: 'ProposalControlPanel',
      type: 'COMP',
      status: 'LIVE',
      domain: 'PROPOSAL',
      filePath: 'src/app/components/ProposalControlPanel.tsx',
      description: 'Team-side control panel for managing proposal state — draft, review, sent, accepted, declined. Gates client visibility via proposalGateEngine.',
      dependencies: ['MQC-COMP-019', 'MQC-CORE-022', 'MQC-SVC-001'],
      dependents: ['MQC-COMP-044'],
    },

    'MQC-COMP-021': {
      id: 'MQC-COMP-021',
      name: 'ProposalSectionCopilot',
      type: 'COMP',
      status: 'DEMO',
      domain: 'PROPOSAL',
      filePath: 'src/app/components/ProposalSectionCopilot.tsx',
      description: 'AI writing assistant sidebar in the proposal editor. Suggests text for individual sections based on the submission data. Currently in demo mode — real responses require BACKEND_INTEGRATION: true.',
      dependencies: ['MQC-SVC-004', 'MQC-HOOK-006'],
      dependents: ['MQC-COMP-019'],
      notes: 'Requires copilotPatch backend service to be wired. Demo fallback returns static suggestion text.',
    },

    'MQC-COMP-022': {
      id: 'MQC-COMP-022',
      name: 'ProposalAnnotationLayer',
      type: 'COMP',
      status: 'LIVE',
      domain: 'PROPOSAL',
      filePath: 'src/app/components/ProposalAnnotationLayer.tsx',
      description: 'Overlay layer that allows reviewers to add inline comments and annotations to proposal sections without modifying the underlying text.',
      dependencies: [],
      dependents: ['MQC-COMP-018'],
    },

    'MQC-COMP-023': {
      id: 'MQC-COMP-023',
      name: 'ContractDraftViewer',
      type: 'COMP',
      status: 'LIVE',
      domain: 'PROPOSAL',
      filePath: 'src/app/components/ContractDraftViewer.tsx',
      description: 'Renders the auto-generated contract draft produced by contractEngine. Read-only viewer with section highlights.',
      dependencies: ['MQC-CORE-006'],
      dependents: ['MQC-COMP-044'],
    },

    'MQC-COMP-024': {
      id: 'MQC-COMP-024',
      name: 'SolutionBlueprint',
      type: 'COMP',
      status: 'LIVE',
      domain: 'PROPOSAL',
      filePath: 'src/app/components/SolutionBlueprint.tsx',
      description: 'Visual blueprint of the proposed AI solution. Shows tech stack, integration points, and phasing.',
      dependencies: ['MQC-CORE-029'],
      dependents: ['MQC-COMP-012'],
    },

    'MQC-COMP-025': {
      id: 'MQC-COMP-025',
      name: 'SolutionArchitectureCard',
      type: 'COMP',
      status: 'LIVE',
      domain: 'PROPOSAL',
      filePath: 'src/app/components/SolutionArchitectureCard.tsx',
      description: 'Summary card showing the recommended solution architecture. Used in both the client portal and team dashboard.',
      dependencies: [],
      dependents: ['MQC-COMP-012', 'MQC-COMP-044'],
    },

    'MQC-COMP-026': {
      id: 'MQC-COMP-026',
      name: 'ImplementationArchitectureCard',
      type: 'COMP',
      status: 'LIVE',
      domain: 'PROPOSAL',
      filePath: 'src/app/components/ImplementationArchitectureCard.tsx',
      description: 'Summary card showing the implementation roadmap and technical architecture. Companion to SolutionArchitectureCard.',
      dependencies: [],
      dependents: ['MQC-COMP-012'],
    },

    // ── ROI ──────────────────────────────────────────────────────────────────

    'MQC-COMP-027': {
      id: 'MQC-COMP-027',
      name: 'ROITabLayout',
      type: 'COMP',
      status: 'LIVE',
      domain: 'ROI',
      filePath: 'src/app/components/ROITabLayout.tsx',
      description: 'Tab shell containing all ROI analysis panels — Executive Summary, Tracking, Assumptions Editor, Enhanced ROI, DCF, Monte Carlo, and Scenario panels.',
      dependencies: ['MQC-COMP-028', 'MQC-COMP-029', 'MQC-COMP-030', 'MQC-COMP-031', 'MQC-COMP-033', 'MQC-COMP-034', 'MQC-COMP-035'],
      dependents: ['MQC-COMP-010', 'MQC-COMP-044'],
    },

    'MQC-COMP-028': {
      id: 'MQC-COMP-028',
      name: 'ROIExecutiveDashboard',
      type: 'COMP',
      status: 'LIVE',
      domain: 'ROI',
      filePath: 'src/app/components/ROIExecutiveDashboard.tsx',
      description: 'C-suite-ready ROI summary showing headline numbers, payback period, and 3-year NPV. Pulls from roiEngine calculations.',
      dependencies: ['MQC-CORE-025', 'MQC-COMP-032'],
      dependents: ['MQC-COMP-027'],
      inputs: ['ROIInputs'],
      outputs: ['ROISummary'],
    },

    'MQC-COMP-029': {
      id: 'MQC-COMP-029',
      name: 'ROITrackingPanel',
      type: 'COMP',
      status: 'LIVE',
      domain: 'ROI',
      filePath: 'src/app/components/ROITrackingPanel.tsx',
      description: 'Post-implementation ROI tracking. Compares projected vs actual returns using roiTrackingEngine and roiActualsEngine.',
      dependencies: ['MQC-CORE-026', 'MQC-CORE-024'],
      dependents: ['MQC-COMP-027'],
    },

    'MQC-COMP-030': {
      id: 'MQC-COMP-030',
      name: 'ROIAssumptionsEditor',
      type: 'COMP',
      status: 'LIVE',
      domain: 'ROI',
      filePath: 'src/app/components/ROIAssumptionsEditor.tsx',
      description: 'Editable table of ROI model assumptions. Changes propagate through all ROI panels via DashboardContext.',
      dependencies: ['MQC-CORE-025', 'MQC-HOOK-005'],
      dependents: ['MQC-COMP-027'],
    },

    'MQC-COMP-031': {
      id: 'MQC-COMP-031',
      name: 'EnhancedROI',
      type: 'COMP',
      status: 'LIVE',
      domain: 'ROI',
      filePath: 'src/app/components/EnhancedROI.tsx',
      description: 'Extended ROI analysis with qualitative value drivers alongside the quantitative model.',
      dependencies: ['MQC-CORE-025', 'MQC-CORE-008'],
      dependents: ['MQC-COMP-027'],
    },

    'MQC-COMP-032': {
      id: 'MQC-COMP-032',
      name: 'FinancialSummaryCard',
      type: 'COMP',
      status: 'LIVE',
      domain: 'ROI',
      filePath: 'src/app/components/FinancialSummaryCard.tsx',
      description: 'Compact financial summary card used across multiple panels. Shows NPV, IRR, payback period.',
      dependencies: ['MQC-CORE-025', 'MQC-CORE-017'],
      dependents: ['MQC-COMP-028', 'MQC-COMP-044'],
    },

    'MQC-COMP-033': {
      id: 'MQC-COMP-033',
      name: 'DCFPanel',
      type: 'COMP',
      status: 'LIVE',
      domain: 'ROI',
      filePath: 'src/app/components/DCFPanel.tsx',
      description: 'Discounted cash flow model panel. Renders year-by-year cashflow projections using dcfEngine.',
      dependencies: ['MQC-CORE-011', 'MQC-CORE-003'],
      dependents: ['MQC-COMP-027'],
      inputs: ['DCFInputs'],
      outputs: ['DCFResult'],
    },

    'MQC-COMP-034': {
      id: 'MQC-COMP-034',
      name: 'MonteCarloPanel',
      type: 'COMP',
      status: 'LIVE',
      domain: 'ROI',
      filePath: 'src/app/components/MonteCarloPanel.tsx',
      description: 'Monte Carlo simulation panel. Runs probability distributions across ROI assumptions to show confidence intervals.',
      dependencies: ['MQC-CORE-019'],
      dependents: ['MQC-COMP-027'],
    },

    'MQC-COMP-035': {
      id: 'MQC-COMP-035',
      name: 'ScenarioPanel',
      type: 'COMP',
      status: 'LIVE',
      domain: 'ROI',
      filePath: 'src/app/components/ScenarioPanel.tsx',
      description: 'Best / base / worst case scenario comparison panel. Uses scenarioEngine to calculate outcomes across assumption ranges.',
      dependencies: ['MQC-CORE-028'],
      dependents: ['MQC-COMP-027'],
    },

    // ── TEAM / EXECUTION ─────────────────────────────────────────────────────

    'MQC-COMP-036': {
      id: 'MQC-COMP-036',
      name: 'TeamDashboardLayout',
      type: 'COMP',
      status: 'LIVE',
      domain: 'EXECUTION',
      filePath: 'src/app/components/TeamDashboardLayout.tsx',
      description: 'Two-layer layout wrapper for all team dashboard content. Layer 1: GlobalAIChatProvider. Layer 2: DashboardContext. Every team panel must live inside this component.',
      dependencies: ['MQC-HOOK-006', 'MQC-HOOK-005', 'MQC-COMP-046'],
      dependents: ['MQC-PAGE-006'],
      notes: 'The two-layer provider pattern is intentional. Do not collapse the layers — GlobalAIChatProvider must be the outer layer so AI chat is available to all inner components.',
    },

    'MQC-COMP-037': {
      id: 'MQC-COMP-037',
      name: 'TeamDashboardNew',
      type: 'COMP',
      status: 'LIVE',
      domain: 'EXECUTION',
      filePath: 'src/app/components/TeamDashboardNew.tsx',
      description: 'The main team dashboard content. All 8+ panels are React.lazy loaded for performance. Hosts the tabbed navigation between all team views.',
      dependencies: ['MQC-COMP-036', 'MQC-HOOK-005'],
      dependents: ['MQC-PAGE-006'],
      notes: 'All panel imports must remain React.lazy. Do not convert any panel to an eager import.',
    },

    'MQC-COMP-038': {
      id: 'MQC-COMP-038',
      name: 'TeamHomeDashboard',
      type: 'COMP',
      status: 'LIVE',
      domain: 'EXECUTION',
      filePath: 'src/app/components/TeamHomeDashboard.tsx',
      description: 'The home/overview tab of the team dashboard. Shows submission pipeline summary, recent activity, and quick-action shortcuts.',
      dependencies: ['MQC-COMP-079', 'MQC-SVC-001'],
      dependents: ['MQC-COMP-037'],
    },

    'MQC-COMP-039': {
      id: 'MQC-COMP-039',
      name: 'TeamManagement',
      type: 'COMP',
      status: 'LIVE',
      domain: 'AUTH',
      filePath: 'src/app/components/TeamManagement.tsx',
      description: 'Admin panel for managing team members — adding, removing, and assigning roles.',
      dependencies: ['MQC-CORE-027', 'MQC-SVC-009'],
      dependents: ['MQC-COMP-037'],
    },

    'MQC-COMP-040': {
      id: 'MQC-COMP-040',
      name: 'ExecutionDashboard',
      type: 'COMP',
      status: 'LIVE',
      domain: 'EXECUTION',
      filePath: 'src/app/components/ExecutionDashboard.tsx',
      description: 'Sprint execution view showing active implementation tasks, sprint progress, and client delivery milestones.',
      dependencies: ['MQC-CORE-014', 'MQC-CORE-032', 'MQC-SVC-001'],
      dependents: ['MQC-PAGE-007'],
    },

    'MQC-COMP-041': {
      id: 'MQC-COMP-041',
      name: 'PipelineKanban',
      type: 'COMP',
      status: 'LIVE',
      domain: 'EXECUTION',
      filePath: 'src/app/components/PipelineKanban.tsx',
      description: 'Kanban board view of all submissions by pipeline stage. Drag-and-drop to advance or regress a submission stage.',
      dependencies: ['MQC-SVC-001', 'MQC-COMP-087'],
      dependents: ['MQC-COMP-037'],
    },

    'MQC-COMP-042': {
      id: 'MQC-COMP-042',
      name: 'SubmissionsListPage',
      type: 'COMP',
      status: 'LIVE',
      domain: 'EXECUTION',
      filePath: 'src/app/components/SubmissionsListPage.tsx',
      description: 'Paginated list of all diagnostic submissions. Searchable and filterable by status, score band, and industry.',
      dependencies: ['MQC-SVC-001', 'MQC-HOOK-003'],
      dependents: ['MQC-COMP-037'],
      notes: 'Search input must use useDebounce from MQC-HOOK-003 — do not add raw onChange search without debouncing.',
    },

    'MQC-COMP-043': {
      id: 'MQC-COMP-043',
      name: 'FullFeaturedDashboard',
      type: 'COMP',
      status: 'LIVE',
      domain: 'EXECUTION',
      filePath: 'src/app/components/FullFeaturedDashboard.tsx',
      description: 'The comprehensive submission detail dashboard. Shows all data for a single submission across score, ROI, proposal, and execution views.',
      dependencies: ['MQC-COMP-009', 'MQC-COMP-032', 'MQC-COMP-027', 'MQC-SVC-001', 'MQC-HOOK-003'],
      dependents: ['MQC-COMP-037'],
      notes: 'Debounced search has been applied (2026-03-05 performance pass).',
    },

    'MQC-COMP-044': {
      id: 'MQC-COMP-044',
      name: 'CortexDashboard',
      type: 'COMP',
      status: 'LIVE',
      domain: 'EXECUTION',
      filePath: 'src/app/components/CortexDashboard.tsx',
      description: 'High-level CORTEX intelligence dashboard. Aggregates cross-submission insights and shows the overall health of the pipeline.',
      dependencies: ['MQC-CORE-010', 'MQC-SVC-002'],
      dependents: ['MQC-COMP-037'],
    },

    'MQC-COMP-045': {
      id: 'MQC-COMP-045',
      name: 'CortexDashboardSections',
      type: 'COMP',
      status: 'LIVE',
      domain: 'EXECUTION',
      filePath: 'src/app/components/CortexDashboardSections.tsx',
      description: 'Section components used inside CortexDashboard. Separated for performance — each section renders independently.',
      dependencies: ['MQC-CORE-010'],
      dependents: ['MQC-COMP-044'],
    },

    // ── AI ───────────────────────────────────────────────────────────────────

    'MQC-COMP-046': {
      id: 'MQC-COMP-046',
      name: 'GlobalAIChat',
      type: 'COMP',
      status: 'DEMO',
      domain: 'AI',
      filePath: 'src/app/components/GlobalAIChat.tsx',
      description: 'Floating AI chat panel available across all team dashboard views. Powered by cortexChat backend. Currently in demo mode — responses are mocked.',
      dependencies: ['MQC-HOOK-006', 'MQC-SVC-006'],
      dependents: ['MQC-COMP-036'],
      notes: 'Must remain mounted at the TeamDashboardLayout level so it persists across tab navigation.',
    },

    'MQC-COMP-047': {
      id: 'MQC-COMP-047',
      name: 'CortexChatPanel',
      type: 'COMP',
      status: 'DEMO',
      domain: 'AI',
      filePath: 'src/app/components/CortexChatPanel.tsx',
      description: 'Embedded chat panel for the Cortex AI assistant in specific contexts. Distinct from GlobalAIChat — this is context-aware and injects submission data.',
      dependencies: ['MQC-HOOK-006', 'MQC-SVC-006'],
      dependents: ['MQC-COMP-044'],
      notes: 'BACKEND_INTEGRATION: false returns demo responses. Wire MQC-SVC-006 to make live.',
    },

    'MQC-COMP-048': {
      id: 'MQC-COMP-048',
      name: 'CopilotPanel',
      type: 'COMP',
      status: 'DEMO',
      domain: 'AI',
      filePath: 'src/app/components/CopilotPanel.tsx',
      description: 'AI writing copilot panel for team members drafting proposals and reports. Interprets intent and suggests structured text.',
      dependencies: ['MQC-CORE-007', 'MQC-SVC-004'],
      dependents: ['MQC-COMP-037'],
      notes: 'Requires copilotPatch backend (MQC-SVC-004) to be wired for live mode.',
    },

    'MQC-COMP-049': {
      id: 'MQC-COMP-049',
      name: 'AIAssistant',
      type: 'COMP',
      status: 'DEMO',
      domain: 'AI',
      filePath: 'src/app/components/AIAssistant.tsx',
      description: 'General-purpose AI assistant component that can be embedded in any panel to answer contextual questions about the current submission.',
      dependencies: ['MQC-CORE-001', 'MQC-HOOK-006'],
      dependents: [],
    },

    'MQC-COMP-050': {
      id: 'MQC-COMP-050',
      name: 'InlineAITrigger',
      type: 'COMP',
      status: 'DEMO',
      domain: 'AI',
      filePath: 'src/app/components/InlineAITrigger.tsx',
      description: 'Small trigger button that opens the AI assistant inline within a specific form field or section. Provides contextual AI help without leaving the flow.',
      dependencies: ['MQC-HOOK-006'],
      dependents: [],
    },

    'MQC-COMP-051': {
      id: 'MQC-COMP-051',
      name: 'ObjectionHandlerPanel',
      type: 'COMP',
      status: 'DEMO',
      domain: 'AI',
      filePath: 'src/app/components/ObjectionHandlerPanel.tsx',
      description: 'AI-powered panel that generates responses to common client objections based on the submission data and proposal context.',
      dependencies: ['MQC-CORE-020', 'MQC-SVC-005'],
      dependents: ['MQC-COMP-037'],
      notes: 'Requires cortexAnalysis backend (MQC-SVC-005) for live responses.',
    },

    'MQC-COMP-052': {
      id: 'MQC-COMP-052',
      name: 'CortexModulesNew',
      type: 'COMP',
      status: 'DEMO',
      domain: 'AI',
      filePath: 'src/app/components/CortexModulesNew.tsx',
      description: 'Container for all Cortex AI module cards. Each module represents a distinct AI capability that can be activated for a submission.',
      dependencies: ['MQC-SVC-002'],
      dependents: ['MQC-COMP-037'],
    },

    'MQC-COMP-053': {
      id: 'MQC-COMP-053',
      name: 'CortexProposalModule',
      type: 'COMP',
      status: 'DEMO',
      domain: 'AI',
      filePath: 'src/app/components/CortexProposalModule.tsx',
      description: 'Cortex AI module specifically for proposal generation. Uses narrative engine to produce first-draft proposal text from scoring data.',
      dependencies: ['MQC-SVC-007', 'MQC-SVC-002'],
      dependents: ['MQC-COMP-052'],
      notes: 'Requires cortexNarrative backend (MQC-SVC-007) for live generation.',
    },

    'MQC-COMP-054': {
      id: 'MQC-COMP-054',
      name: 'CortexReviewerModule',
      type: 'COMP',
      status: 'DEMO',
      domain: 'AI',
      filePath: 'src/app/components/CortexReviewerModule.tsx',
      description: 'Cortex AI module for automated proposal review. Checks for consistency, completeness, and alignment with the diagnostic findings.',
      dependencies: ['MQC-SVC-005', 'MQC-SVC-002'],
      dependents: ['MQC-COMP-052'],
    },

    // ── ANALYTICS ────────────────────────────────────────────────────────────

    'MQC-COMP-055': {
      id: 'MQC-COMP-055',
      name: 'AnalyticsDashboard',
      type: 'COMP',
      status: 'LIVE',
      domain: 'ANALYTICS',
      filePath: 'src/app/components/AnalyticsDashboard.tsx',
      description: 'Platform-wide analytics dashboard. Shows submission volume, conversion rates, score distributions, and time-in-stage metrics.',
      dependencies: ['MQC-CORE-010', 'MQC-SVC-001'],
      dependents: ['MQC-COMP-037'],
    },

    'MQC-COMP-056': {
      id: 'MQC-COMP-056',
      name: 'RevenueIntelligenceDashboard',
      type: 'COMP',
      status: 'DEMO',
      domain: 'ANALYTICS',
      filePath: 'src/app/components/RevenueIntelligenceDashboard.tsx',
      description: 'Predictive revenue intelligence showing pipeline value, win probability, and projected monthly recurring revenue.',
      dependencies: ['MQC-CORE-021', 'MQC-SVC-002'],
      dependents: ['MQC-COMP-037'],
      notes: 'Uses cortexDataService demo data. Wire MQC-SVC-002 and MQC-SVC-005 for live predictions.',
    },

    'MQC-COMP-057': {
      id: 'MQC-COMP-057',
      name: 'EngagementIntelligence',
      type: 'COMP',
      status: 'DEMO',
      domain: 'ANALYTICS',
      filePath: 'src/app/components/EngagementIntelligence.tsx',
      description: 'Client engagement scoring panel. Tracks portal activity, response times, and engagement signals to predict deal health.',
      dependencies: ['MQC-COMP-058', 'MQC-SVC-002'],
      dependents: ['MQC-COMP-037'],
    },

    'MQC-COMP-058': {
      id: 'MQC-COMP-058',
      name: 'EngagementActivityFeed',
      type: 'COMP',
      status: 'LIVE',
      domain: 'ANALYTICS',
      filePath: 'src/app/components/EngagementActivityFeed.tsx',
      description: 'Chronological activity feed for a submission. Shows every client action — portal visits, message reads, document views.',
      dependencies: ['MQC-SVC-001'],
      dependents: ['MQC-COMP-057', 'MQC-COMP-043'],
    },

    'MQC-COMP-059': {
      id: 'MQC-COMP-059',
      name: 'ABTestingPanel',
      type: 'COMP',
      status: 'GATED',
      domain: 'ANALYTICS',
      filePath: 'src/app/components/ABTestingPanel.tsx',
      description: 'A/B testing panel for proposal variants. Tracks which proposal formats have higher acceptance rates.',
      dependencies: ['MQC-SVC-002'],
      dependents: [],
      notes: 'Gated — not exposed in any current navigation. Will be added to AnalyticsDashboard when sufficient data volume exists.',
    },

    'MQC-COMP-060': {
      id: 'MQC-COMP-060',
      name: 'QBRPanel',
      type: 'COMP',
      status: 'LIVE',
      domain: 'ANALYTICS',
      filePath: 'src/app/components/QBRPanel.tsx',
      description: 'Quarterly Business Review panel. Generates QBR-ready slides with delivered value metrics and next-quarter planning.',
      dependencies: ['MQC-CORE-023', 'MQC-SVC-001'],
      dependents: ['MQC-COMP-037'],
    },

    'MQC-COMP-061': {
      id: 'MQC-COMP-061',
      name: 'LearningLoopPanel',
      type: 'COMP',
      status: 'GATED',
      domain: 'ANALYTICS',
      filePath: 'src/app/components/LearningLoopPanel.tsx',
      description: 'Feedback loop panel that feeds win/loss outcomes back into the scoring model to improve future predictions.',
      dependencies: ['MQC-CORE-030', 'MQC-SVC-002'],
      dependents: [],
      notes: 'Gated — requires minimum 50 closed submissions to produce meaningful feedback signal. Not yet exposed in UI.',
    },

    // ── BLOCKS / REGISTRY ────────────────────────────────────────────────────

    'MQC-COMP-062': {
      id: 'MQC-COMP-062',
      name: 'BlockHistoryPanel',
      type: 'COMP',
      status: 'LIVE',
      domain: 'EXECUTION',
      filePath: 'src/app/components/BlockHistoryPanel.tsx',
      description: 'Version history for execution blocks. Shows all previous states with diff highlighting and one-click rollback.',
      dependencies: ['MQC-CORE-002', 'MQC-CORE-034'],
      dependents: ['MQC-COMP-037'],
    },

    'MQC-COMP-063': {
      id: 'MQC-COMP-063',
      name: 'BlockRegistryPanel',
      type: 'COMP',
      status: 'LIVE',
      domain: 'EXECUTION',
      filePath: 'src/app/components/BlockRegistryPanel.tsx',
      description: 'Registry of all reusable execution blocks. Team members can browse, search, and insert blocks into execution plans.',
      dependencies: ['MQC-CORE-002', 'MQC-SVC-003'],
      dependents: ['MQC-COMP-037'],
    },

    'MQC-COMP-064': {
      id: 'MQC-COMP-064',
      name: 'EditableBlockCard',
      type: 'COMP',
      status: 'LIVE',
      domain: 'EXECUTION',
      filePath: 'src/app/components/EditableBlockCard.tsx',
      description: 'Individual block card with inline editing. Supports title, description, assignee, and status fields.',
      dependencies: ['MQC-CORE-002'],
      dependents: ['MQC-COMP-063', 'MQC-COMP-040'],
    },

    'MQC-COMP-065': {
      id: 'MQC-COMP-065',
      name: 'MappingEnginePanel',
      type: 'COMP',
      status: 'LIVE',
      domain: 'EXECUTION',
      filePath: 'src/app/components/MappingEnginePanel.tsx',
      description: 'Visual mapping panel showing how diagnostic answers drive solution recommendations. Exposes the mappingEngine logic as an interactive diagram.',
      dependencies: ['MQC-CORE-018'],
      dependents: ['MQC-COMP-037'],
    },

    'MQC-COMP-066': {
      id: 'MQC-COMP-066',
      name: 'SnapshotHistoryPanel',
      type: 'COMP',
      status: 'LIVE',
      domain: 'EXECUTION',
      filePath: 'src/app/components/SnapshotHistoryPanel.tsx',
      description: 'Timeline of submission snapshots. Each snapshot captures the full state of a submission at a point in time for audit and comparison.',
      dependencies: ['MQC-CORE-031'],
      dependents: ['MQC-COMP-037'],
    },

    // ── CRM / COMMS ──────────────────────────────────────────────────────────

    'MQC-COMP-067': {
      id: 'MQC-COMP-067',
      name: 'CRMSyncPanel',
      type: 'COMP',
      status: 'GATED',
      domain: 'COMMS',
      filePath: 'src/app/components/CRMSyncPanel.tsx',
      description: 'CRM integration panel. Syncs submission data to external CRMs (HubSpot, Salesforce). Currently gated — integration not yet configured.',
      dependencies: ['MQC-CORE-009', 'MQC-SVC-001'],
      dependents: [],
      notes: 'Gated until CRM API credentials are configured. crmEngine is built but the backend webhook endpoint is not yet wired.',
    },

    'MQC-COMP-068': {
      id: 'MQC-COMP-068',
      name: 'EmailNurturePanel',
      type: 'COMP',
      status: 'LIVE',
      domain: 'COMMS',
      filePath: 'src/app/components/EmailNurturePanel.tsx',
      description: 'Email nurture sequence manager. Configures and triggers automated follow-up emails via the emailService backend.',
      dependencies: ['MQC-SVC-008'],
      dependents: ['MQC-COMP-037'],
    },

    'MQC-COMP-069': {
      id: 'MQC-COMP-069',
      name: 'TeamMessageThread',
      type: 'COMP',
      status: 'LIVE',
      domain: 'COMMS',
      filePath: 'src/app/components/TeamMessageThread.tsx',
      description: 'Internal team message thread for a specific submission. Team-only — not visible to clients.',
      dependencies: ['MQC-SVC-001'],
      dependents: ['MQC-COMP-043'],
    },

    'MQC-COMP-070': {
      id: 'MQC-COMP-070',
      name: 'NotificationCenter',
      type: 'COMP',
      status: 'LIVE',
      domain: 'COMMS',
      filePath: 'src/app/components/NotificationCenter.tsx',
      description: 'In-app notification centre for team members. Shows submission events, client actions, and system alerts.',
      dependencies: ['MQC-SVC-001'],
      dependents: ['MQC-COMP-036'],
    },

    // ── LEAD CAPTURE ─────────────────────────────────────────────────────────

    'MQC-COMP-071': {
      id: 'MQC-COMP-071',
      name: 'LandingPage',
      type: 'COMP',
      status: 'LIVE',
      domain: 'LEAD',
      filePath: 'src/app/components/LandingPage.tsx',
      description: 'The public-facing landing page. Hero section, value proposition, social proof, and CTA to start the diagnostic.',
      dependencies: ['MQC-COMP-073'],
      dependents: ['MQC-PAGE-001'],
    },

    'MQC-COMP-072': {
      id: 'MQC-COMP-072',
      name: 'LeadMagnetCapture',
      type: 'COMP',
      status: 'LIVE',
      domain: 'LEAD',
      filePath: 'src/app/components/LeadMagnetCapture.tsx',
      description: 'Lead capture form for the get-started flow. Collects name, email, and company before routing to the diagnostic. Generates a PDF report on completion using dynamically imported pdfExport.',
      dependencies: ['MQC-SVC-001'],
      dependents: ['MQC-PAGE-002'],
      notes: 'pdfExport MUST be dynamically imported inside the submit handler via import(). Never import it at the top of this file. Eager import blocks the entire app bundle.',
    },

    'MQC-COMP-073': {
      id: 'MQC-COMP-073',
      name: 'ExitIntentPopup',
      type: 'COMP',
      status: 'LIVE',
      domain: 'LEAD',
      filePath: 'src/app/components/ExitIntentPopup.tsx',
      description: 'Exit-intent popup triggered when the user moves their cursor toward the browser chrome. Offers a compelling reason to stay and start the diagnostic.',
      dependencies: [],
      dependents: ['MQC-COMP-071'],
    },

    // ── REVIEWER / QA ────────────────────────────────────────────────────────

    'MQC-COMP-074': {
      id: 'MQC-COMP-074',
      name: 'ReviewerDashboard',
      type: 'COMP',
      status: 'LIVE',
      domain: 'REVIEWER',
      filePath: 'src/app/components/ReviewerDashboard.tsx',
      description: 'Dashboard for CORTEX reviewers. Shows submissions awaiting review, review checklist progress, and reviewer assignment.',
      dependencies: ['MQC-SVC-001', 'MQC-SVC-002'],
      dependents: ['MQC-COMP-037'],
    },

    'MQC-COMP-075': {
      id: 'MQC-COMP-075',
      name: 'QATranscriptSheet',
      type: 'COMP',
      status: 'LIVE',
      domain: 'REVIEWER',
      filePath: 'src/app/components/QATranscriptSheet.tsx',
      description: 'Side-panel showing the full diagnostic transcript for a submission. Reviewers use this to verify scoring accuracy.',
      dependencies: ['MQC-SVC-001'],
      dependents: ['MQC-COMP-074'],
    },

    'MQC-COMP-076': {
      id: 'MQC-COMP-076',
      name: 'SubmissionNotesPanel',
      type: 'COMP',
      status: 'LIVE',
      domain: 'REVIEWER',
      filePath: 'src/app/components/SubmissionNotesPanel.tsx',
      description: 'Structured notes panel for reviewers. Notes are tagged by category and persist in KV alongside the submission.',
      dependencies: ['MQC-SVC-001'],
      dependents: ['MQC-COMP-043'],
    },

    'MQC-COMP-077': {
      id: 'MQC-COMP-077',
      name: 'ExportPanel',
      type: 'COMP',
      status: 'LIVE',
      domain: 'REVIEWER',
      filePath: 'src/app/components/ExportPanel.tsx',
      description: 'Export control panel. Allows team members to export submission data, reports, and proposals in PDF or CSV format.',
      dependencies: ['MQC-CORE-015'],
      dependents: ['MQC-COMP-043'],
    },

    // ── SYSTEM UTILITIES ─────────────────────────────────────────────────────

    'MQC-COMP-078': {
      id: 'MQC-COMP-078',
      name: 'SettingsPage',
      type: 'COMP',
      status: 'LIVE',
      domain: 'SYSTEM',
      filePath: 'src/app/components/SettingsPage.tsx',
      description: 'Platform settings page. Manages notification preferences, team configuration, and integration toggles.',
      dependencies: ['MQC-SVC-009'],
      dependents: ['MQC-COMP-037'],
    },

    'MQC-COMP-079': {
      id: 'MQC-COMP-079',
      name: 'QuickActions',
      type: 'COMP',
      status: 'LIVE',
      domain: 'SYSTEM',
      filePath: 'src/app/components/QuickActions.tsx',
      description: 'Quick-action button tray for common team operations — create submission, assign reviewer, send proposal.',
      dependencies: ['MQC-SVC-001'],
      dependents: ['MQC-COMP-038'],
    },

    'MQC-COMP-080': {
      id: 'MQC-COMP-080',
      name: 'CommandPalette',
      type: 'COMP',
      status: 'LIVE',
      domain: 'SYSTEM',
      filePath: 'src/app/components/CommandPalette.tsx',
      description: 'Cmd+K command palette for power users. Exposes all major navigation and actions via keyboard-driven search.',
      dependencies: ['MQC-HOOK-001'],
      dependents: ['MQC-PAGE-000'],
    },

    'MQC-COMP-081': {
      id: 'MQC-COMP-081',
      name: 'ErrorBoundary',
      type: 'COMP',
      status: 'LIVE',
      domain: 'SYSTEM',
      filePath: 'src/app/components/ErrorBoundary.tsx',
      description: 'React error boundary wrapping the entire application. Catches unhandled errors and renders a recovery UI instead of a blank screen.',
      dependencies: [],
      dependents: ['MQC-PAGE-000'],
    },

    'MQC-COMP-082': {
      id: 'MQC-COMP-082',
      name: 'RouteErrorFallback',
      type: 'COMP',
      status: 'LIVE',
      domain: 'SYSTEM',
      filePath: 'src/app/components/RouteErrorFallback.tsx',
      description: 'Error element used as the errorElement prop on every lazy route. Shows a contextual error with retry and go-home options.',
      dependencies: [],
      dependents: [],
    },

    'MQC-COMP-083': {
      id: 'MQC-COMP-083',
      name: 'NotFound',
      type: 'COMP',
      status: 'LIVE',
      domain: 'SYSTEM',
      filePath: 'src/app/components/NotFound.tsx',
      description: '404 not found page. Rendered for the wildcard (*) route.',
      dependencies: [],
      dependents: [],
    },

    'MQC-COMP-084': {
      id: 'MQC-COMP-084',
      name: 'OfflineBanner',
      type: 'COMP',
      status: 'LIVE',
      domain: 'SYSTEM',
      filePath: 'src/app/components/OfflineBanner.tsx',
      description: 'Sticky banner shown when the user loses internet connectivity. Uses useOnlineStatus hook to detect network state.',
      dependencies: ['MQC-HOOK-002'],
      dependents: ['MQC-PAGE-000'],
    },

    'MQC-COMP-085': {
      id: 'MQC-COMP-085',
      name: 'ProgressModal',
      type: 'COMP',
      status: 'LIVE',
      domain: 'SYSTEM',
      filePath: 'src/app/components/ProgressModal.tsx',
      description: 'Modal overlay showing a progress indicator for long-running operations like bulk exports or AI generation.',
      dependencies: [],
      dependents: [],
    },

    'MQC-COMP-086': {
      id: 'MQC-COMP-086',
      name: 'Skeletons',
      type: 'COMP',
      status: 'LIVE',
      domain: 'SYSTEM',
      filePath: 'src/app/components/Skeletons.tsx',
      description: 'Library of skeleton loading placeholders for all major panel shapes. Used as Suspense fallbacks throughout the dashboard.',
      dependencies: [],
      dependents: [],
    },

    'MQC-COMP-087': {
      id: 'MQC-COMP-087',
      name: 'KanbanAlertToast',
      type: 'COMP',
      status: 'LIVE',
      domain: 'SYSTEM',
      filePath: 'src/app/components/KanbanAlertToast.tsx',
      description: 'Toast notification component specifically for Kanban stage-change events. Distinct from the general notification system.',
      dependencies: [],
      dependents: ['MQC-COMP-041'],
    },

    'MQC-COMP-088': {
      id: 'MQC-COMP-088',
      name: 'WinCelebration',
      type: 'COMP',
      status: 'LIVE',
      domain: 'SYSTEM',
      filePath: 'src/app/components/WinCelebration.tsx',
      description: 'Confetti celebration animation triggered when a submission is moved to Won status.',
      dependencies: [],
      dependents: ['MQC-COMP-041'],
    },

    'MQC-COMP-089': {
      id: 'MQC-COMP-089',
      name: 'KeyboardShortcutsHelp',
      type: 'COMP',
      status: 'LIVE',
      domain: 'SYSTEM',
      filePath: 'src/app/components/KeyboardShortcutsHelp.tsx',
      description: 'Modal displaying all available keyboard shortcuts. Triggered by ? key via useKeyboardShortcuts hook.',
      dependencies: ['MQC-HOOK-001'],
      dependents: ['MQC-PAGE-000'],
    },

    // ══════════════════════════════════════════════════════════════════════════
    // CORE ENGINE MODULES — /src/app/core  (MQC-CORE-001 → MQC-CORE-035)
    // These are pure deterministic functions. No React. No side effects.
    // Math decides priority. LLM only explains decisions.
    // ══════════════════════════════════════════════════════════════════════════

    'MQC-CORE-001': {
      id: 'MQC-CORE-001',
      name: 'aiAssistEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'AI',
      filePath: 'src/app/core/aiAssistEngine.ts',
      description: 'Prepares structured prompts and context payloads for AI backend services. Formats submission data into the shape each AI service expects.',
      dependencies: ['MQC-CORE-016'],
      dependents: ['MQC-COMP-049'],
      inputs: ['SubmissionData', 'ContextType'],
      outputs: ['AIPromptPayload'],
    },

    'MQC-CORE-002': {
      id: 'MQC-CORE-002',
      name: 'blockEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'EXECUTION',
      filePath: 'src/app/core/blockEngine.ts',
      description: 'Creates, updates, validates, and sequences execution blocks. The core data model for sprint-based delivery.',
      dependencies: ['MQC-CORE-034'],
      dependents: ['MQC-COMP-062', 'MQC-COMP-063', 'MQC-COMP-064'],
      inputs: ['BlockConfig'],
      outputs: ['Block', 'BlockValidationResult'],
    },

    'MQC-CORE-003': {
      id: 'MQC-CORE-003',
      name: 'cashflowEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'ROI',
      filePath: 'src/app/core/cashflowEngine.ts',
      description: 'Calculates projected cash flows year-by-year from cost and benefit assumptions. Primary input to DCF and IRR calculations.',
      dependencies: ['MQC-CORE-008'],
      dependents: ['MQC-CORE-011', 'MQC-CORE-017'],
      inputs: ['CostInputs', 'BenefitInputs'],
      outputs: ['CashflowProjection[]'],
    },

    'MQC-CORE-004': {
      id: 'MQC-CORE-004',
      name: 'changeImpactEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'EXECUTION',
      filePath: 'src/app/core/changeImpactEngine.ts',
      description: 'Assesses the change management impact of a proposed AI implementation. Scores organisational readiness dimensions.',
      dependencies: ['MQC-CORE-016'],
      dependents: [],
      inputs: ['DiagnosticAnswers'],
      outputs: ['ChangeImpactScore'],
    },

    'MQC-CORE-005': {
      id: 'MQC-CORE-005',
      name: 'consistencyValidator',
      type: 'CORE',
      status: 'LIVE',
      domain: 'SYSTEM',
      filePath: 'src/app/core/consistencyValidator.ts',
      description: 'Cross-checks all calculated values for internal consistency. Flags contradictions between ROI inputs, scoring outputs, and proposal assumptions.',
      dependencies: [],
      dependents: ['MQC-CORE-012'],
      inputs: ['FullSubmissionState'],
      outputs: ['ValidationIssue[]'],
    },

    'MQC-CORE-006': {
      id: 'MQC-CORE-006',
      name: 'contractEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'PROPOSAL',
      filePath: 'src/app/core/contractEngine.ts',
      description: 'Generates contract draft text from proposal parameters. Produces structured contract sections ready for legal review.',
      dependencies: ['MQC-CORE-033'],
      dependents: ['MQC-COMP-023'],
      inputs: ['ProposalData'],
      outputs: ['ContractDraft'],
    },

    'MQC-CORE-007': {
      id: 'MQC-CORE-007',
      name: 'copilotEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'AI',
      filePath: 'src/app/core/copilotEngine.ts',
      description: 'Processes copilot intent and structures the request payload for the copilotPatch backend service.',
      dependencies: ['MQC-CORE-001'],
      dependents: ['MQC-COMP-048'],
      inputs: ['CopilotInterpretRequest'],
      outputs: ['CopilotPayload'],
    },

    'MQC-CORE-008': {
      id: 'MQC-CORE-008',
      name: 'costEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'ROI',
      filePath: 'src/app/core/costEngine.ts',
      description: 'Calculates implementation costs from scoping inputs — licenses, development, change management, and ongoing maintenance.',
      dependencies: ['MQC-CORE-029'],
      dependents: ['MQC-CORE-003', 'MQC-COMP-031'],
      inputs: ['ScopeInputs'],
      outputs: ['CostBreakdown'],
    },

    'MQC-CORE-009': {
      id: 'MQC-CORE-009',
      name: 'crmEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'COMMS',
      filePath: 'src/app/core/crmEngine.ts',
      description: 'Transforms submission data into CRM-compatible contact and deal objects. Ready for HubSpot/Salesforce sync when credentials are configured.',
      dependencies: ['MQC-CORE-016'],
      dependents: ['MQC-COMP-067'],
      inputs: ['SubmissionData'],
      outputs: ['CRMContact', 'CRMDeal'],
    },

    'MQC-CORE-010': {
      id: 'MQC-CORE-010',
      name: 'dashboardAggregator',
      type: 'CORE',
      status: 'LIVE',
      domain: 'ANALYTICS',
      filePath: 'src/app/core/dashboardAggregator.ts',
      description: 'Aggregates data across multiple submissions to produce platform-level metrics — pipeline health, average score, conversion rates.',
      dependencies: [],
      dependents: ['MQC-COMP-044', 'MQC-COMP-055'],
      inputs: ['Submission[]'],
      outputs: ['DashboardMetrics'],
    },

    'MQC-CORE-011': {
      id: 'MQC-CORE-011',
      name: 'dcfEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'ROI',
      filePath: 'src/app/core/dcfEngine.ts',
      description: 'Discounted cash flow calculation engine. Takes projected cashflows and a discount rate, returns NPV.',
      dependencies: ['MQC-CORE-003'],
      dependents: ['MQC-COMP-033'],
      inputs: ['CashflowProjection[]', 'discountRate'],
      outputs: ['NPV', 'DCFResult'],
    },

    'MQC-CORE-012': {
      id: 'MQC-CORE-012',
      name: 'decisionEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'DIAGNOSTIC',
      filePath: 'src/app/core/decisionEngine.ts',
      description: 'The primary decision router. Takes a scoring result and deterministically selects the recommended solution path. No LLM involvement here.',
      dependencies: ['MQC-CORE-030', 'MQC-CORE-005'],
      dependents: ['MQC-COMP-008', 'MQC-COMP-044'],
      inputs: ['ScoringResult'],
      outputs: ['DecisionOutput', 'RecommendedPath'],
      notes: 'This is the most critical engine in the system. Changes here affect every downstream recommendation. Test thoroughly.',
    },

    'MQC-CORE-013': {
      id: 'MQC-CORE-013',
      name: 'dependencyEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'EXECUTION',
      filePath: 'src/app/core/dependencyEngine.ts',
      description: 'Resolves dependencies between execution blocks. Determines sequencing constraints and flags circular dependencies.',
      dependencies: ['MQC-CORE-002'],
      dependents: ['MQC-COMP-040'],
      inputs: ['Block[]'],
      outputs: ['DependencyGraph', 'SequencedBlocks'],
    },

    'MQC-CORE-014': {
      id: 'MQC-CORE-014',
      name: 'executionEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'EXECUTION',
      filePath: 'src/app/core/executionEngine.ts',
      description: 'Manages sprint state transitions — planning, active, review, completed. Calculates velocity and completion forecasts.',
      dependencies: ['MQC-CORE-002', 'MQC-CORE-013', 'MQC-CORE-032'],
      dependents: ['MQC-COMP-040'],
      inputs: ['Sprint', 'Block[]'],
      outputs: ['SprintState', 'VelocityMetrics'],
    },

    'MQC-CORE-015': {
      id: 'MQC-CORE-015',
      name: 'exportEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'REVIEWER',
      filePath: 'src/app/core/exportEngine.ts',
      description: 'Prepares data for PDF and CSV export. Structures and formats submission data into export-ready payloads.',
      dependencies: [],
      dependents: ['MQC-COMP-077'],
      inputs: ['ExportRequest'],
      outputs: ['ExportPayload'],
    },

    'MQC-CORE-016': {
      id: 'MQC-CORE-016',
      name: 'inputNormalizer',
      type: 'CORE',
      status: 'LIVE',
      domain: 'DIAGNOSTIC',
      filePath: 'src/app/core/inputNormalizer.ts',
      description: 'Normalises raw diagnostic form inputs before scoring. Handles type coercion, null defaults, and value range validation.',
      dependencies: [],
      dependents: ['MQC-CORE-030', 'MQC-COMP-004'],
      inputs: ['RawFormData'],
      outputs: ['NormalisedInputs'],
      notes: 'All numeric outputs from this engine must use the ?? 0 null-safe pattern before calling .toFixed(). This convention exists because API data can return null.',
    },

    'MQC-CORE-017': {
      id: 'MQC-CORE-017',
      name: 'irrEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'ROI',
      filePath: 'src/app/core/irrEngine.ts',
      description: 'Internal Rate of Return calculation using Newton-Raphson iteration. Companion to dcfEngine.',
      dependencies: ['MQC-CORE-003'],
      dependents: ['MQC-COMP-032'],
      inputs: ['CashflowProjection[]'],
      outputs: ['IRR'],
    },

    'MQC-CORE-018': {
      id: 'MQC-CORE-018',
      name: 'mappingEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'EXECUTION',
      filePath: 'src/app/core/mappingEngine.ts',
      description: 'Maps diagnostic answer combinations to specific solution recommendations. The core rules engine connecting inputs to outputs.',
      dependencies: ['MQC-CORE-016'],
      dependents: ['MQC-COMP-065', 'MQC-CORE-012'],
      inputs: ['NormalisedInputs'],
      outputs: ['SolutionMapping'],
    },

    'MQC-CORE-019': {
      id: 'MQC-CORE-019',
      name: 'monteCarloEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'ROI',
      filePath: 'src/app/core/monteCarloEngine.ts',
      description: 'Runs Monte Carlo simulation across configurable ROI assumption ranges. Produces confidence intervals for NPV outcomes.',
      dependencies: ['MQC-CORE-011'],
      dependents: ['MQC-COMP-034'],
      inputs: ['MonteCarloConfig'],
      outputs: ['SimulationResults', 'ConfidenceIntervals'],
    },

    'MQC-CORE-020': {
      id: 'MQC-CORE-020',
      name: 'objectionEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'AI',
      filePath: 'src/app/core/objectionEngine.ts',
      description: 'Selects and ranks relevant objection responses based on submission scoring profile. Deterministic selection — AI only provides the narrative text.',
      dependencies: ['MQC-CORE-030'],
      dependents: ['MQC-COMP-051'],
      inputs: ['ScoringResult', 'ObjectionCategory'],
      outputs: ['RankedObjectionResponses'],
    },

    'MQC-CORE-021': {
      id: 'MQC-CORE-021',
      name: 'portfolioEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'ANALYTICS',
      filePath: 'src/app/core/portfolioEngine.ts',
      description: 'Aggregates a portfolio of submissions to produce pipeline value metrics, risk distribution, and win probability weighting.',
      dependencies: ['MQC-CORE-010'],
      dependents: ['MQC-COMP-056'],
      inputs: ['Submission[]'],
      outputs: ['PortfolioMetrics'],
    },

    'MQC-CORE-022': {
      id: 'MQC-CORE-022',
      name: 'proposalGateEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'PROPOSAL',
      filePath: 'src/app/core/proposalGateEngine.ts',
      description: 'Determines whether a proposal is ready to be sent to a client. Checks required sections, approval status, and consistency validation.',
      dependencies: ['MQC-CORE-005'],
      dependents: ['MQC-COMP-020'],
      inputs: ['ProposalState'],
      outputs: ['GateCheckResult', 'BlockingIssues[]'],
    },

    'MQC-CORE-023': {
      id: 'MQC-CORE-023',
      name: 'qbrEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'ANALYTICS',
      filePath: 'src/app/core/qbrEngine.ts',
      description: 'Calculates delivered value metrics for QBR reports. Compares contracted scope against delivered outcomes.',
      dependencies: ['MQC-CORE-024', 'MQC-CORE-025'],
      dependents: ['MQC-COMP-060'],
      inputs: ['DeliveredWork', 'ContractedScope'],
      outputs: ['QBRMetrics'],
    },

    'MQC-CORE-024': {
      id: 'MQC-CORE-024',
      name: 'roiActualsEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'ROI',
      filePath: 'src/app/core/roiActualsEngine.ts',
      description: 'Processes actual post-implementation ROI data. Compares actuals against projections and calculates variance.',
      dependencies: [],
      dependents: ['MQC-COMP-029', 'MQC-CORE-023'],
      inputs: ['ActualMetrics', 'ProjectedMetrics'],
      outputs: ['ROIVariance'],
    },

    'MQC-CORE-025': {
      id: 'MQC-CORE-025',
      name: 'roiEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'ROI',
      filePath: 'src/app/core/roiEngine.ts',
      description: 'Primary ROI calculation engine. Combines cost and benefit projections to produce headline ROI metrics — the numbers shown to clients.',
      dependencies: ['MQC-CORE-003', 'MQC-CORE-008', 'MQC-CORE-011'],
      dependents: ['MQC-COMP-028', 'MQC-COMP-030', 'MQC-COMP-031'],
      inputs: ['ROIInputs'],
      outputs: ['ROISummary', 'HeadlineMetrics'],
      notes: 'This is a load-bearing engine. Every ROI number the client sees comes from here. Any change requires full regression testing across all ROI panels.',
    },

    'MQC-CORE-026': {
      id: 'MQC-CORE-026',
      name: 'roiTrackingEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'ROI',
      filePath: 'src/app/core/roiTrackingEngine.ts',
      description: 'Manages time-series tracking of ROI KPIs post-implementation. Stores tracking cadence and alert thresholds.',
      dependencies: ['MQC-CORE-024'],
      dependents: ['MQC-COMP-029'],
      inputs: ['TrackingConfig', 'ActualMetrics'],
      outputs: ['TrackingState', 'AlertFlags'],
    },

    'MQC-CORE-027': {
      id: 'MQC-CORE-027',
      name: 'roleEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'AUTH',
      filePath: 'src/app/core/roleEngine.ts',
      description: 'Determines what a user can see and do based on their role. Returns permission sets for admin, reviewer, and consultant roles.',
      dependencies: [],
      dependents: ['MQC-COMP-003', 'MQC-COMP-039'],
      inputs: ['UserRole'],
      outputs: ['PermissionSet'],
    },

    'MQC-CORE-028': {
      id: 'MQC-CORE-028',
      name: 'scenarioEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'ROI',
      filePath: 'src/app/core/scenarioEngine.ts',
      description: 'Calculates best, base, and worst case ROI outcomes by adjusting assumption ranges systematically.',
      dependencies: ['MQC-CORE-025'],
      dependents: ['MQC-COMP-035'],
      inputs: ['BaseAssumptions', 'VarianceRanges'],
      outputs: ['ScenarioSet'],
    },

    'MQC-CORE-029': {
      id: 'MQC-CORE-029',
      name: 'scopeEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'PROPOSAL',
      filePath: 'src/app/core/scopeEngine.ts',
      description: 'Determines implementation scope from diagnostic answers. Maps readiness scores to recommended phase count, team size, and delivery timeline.',
      dependencies: ['MQC-CORE-016'],
      dependents: ['MQC-CORE-008', 'MQC-COMP-024'],
      inputs: ['NormalisedInputs'],
      outputs: ['ScopeDefinition'],
    },

    'MQC-CORE-030': {
      id: 'MQC-CORE-030',
      name: 'scoringEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'DIAGNOSTIC',
      filePath: 'src/app/core/scoringEngine.ts',
      description: 'The primary scoring algorithm. Takes normalised diagnostic inputs and produces a weighted composite AI readiness score across all dimensions.',
      dependencies: ['MQC-CORE-016'],
      dependents: ['MQC-COMP-004', 'MQC-COMP-008', 'MQC-CORE-012', 'MQC-CORE-020'],
      inputs: ['NormalisedInputs'],
      outputs: ['ScoringResult', 'DimensionScores'],
      notes: 'Load-bearing engine. Every score shown anywhere in the platform originates here. Do not change weighting without a scoring committee review.',
    },

    'MQC-CORE-031': {
      id: 'MQC-CORE-031',
      name: 'snapshotEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'EXECUTION',
      filePath: 'src/app/core/snapshotEngine.ts',
      description: 'Creates and restores point-in-time snapshots of full submission state for audit and rollback.',
      dependencies: [],
      dependents: ['MQC-COMP-066'],
      inputs: ['SubmissionState'],
      outputs: ['Snapshot'],
    },

    'MQC-CORE-032': {
      id: 'MQC-CORE-032',
      name: 'sprintTemplates',
      type: 'CORE',
      status: 'LIVE',
      domain: 'EXECUTION',
      filePath: 'src/app/core/sprintTemplates.ts',
      description: 'Library of pre-built sprint block templates by solution type. Selected and assembled by templateAssembler based on the decision engine output.',
      dependencies: [],
      dependents: ['MQC-CORE-033', 'MQC-CORE-014'],
      outputs: ['SprintTemplate[]'],
    },

    'MQC-CORE-033': {
      id: 'MQC-CORE-033',
      name: 'templateAssembler',
      type: 'CORE',
      status: 'LIVE',
      domain: 'EXECUTION',
      filePath: 'src/app/core/templateAssembler.ts',
      description: 'Assembles execution and proposal templates from the decision engine output and sprint template library.',
      dependencies: ['MQC-CORE-032', 'MQC-CORE-012'],
      dependents: ['MQC-COMP-019', 'MQC-CORE-006'],
      inputs: ['DecisionOutput'],
      outputs: ['AssembledTemplate'],
    },

    'MQC-CORE-034': {
      id: 'MQC-CORE-034',
      name: 'versionEngine',
      type: 'CORE',
      status: 'LIVE',
      domain: 'EXECUTION',
      filePath: 'src/app/core/versionEngine.ts',
      description: 'Manages version history for blocks and proposals. Creates immutable version records and diffs between versions.',
      dependencies: [],
      dependents: ['MQC-CORE-002', 'MQC-COMP-062'],
      inputs: ['Versionable'],
      outputs: ['VersionRecord', 'Diff'],
    },

    'MQC-CORE-035': {
      id: 'MQC-CORE-035',
      name: 'coreIndex',
      type: 'CORE',
      status: 'LIVE',
      domain: 'SYSTEM',
      filePath: 'src/app/core/index.ts',
      description: 'Barrel export file for all core engine modules. Import engines from here rather than their individual files.',
      dependencies: [],
      dependents: [],
    },

    // ══════════════════════════════════════════════════════════════════════════
    // SERVICES — Frontend data layer + Backend Hono routes  (MQC-SVC-001 → 009)
    // ══════════════════════════════════════════════════════════════════════════

    'MQC-SVC-001': {
      id: 'MQC-SVC-001',
      name: 'dataService',
      type: 'SVC',
      status: 'LIVE',
      domain: 'SYSTEM',
      filePath: 'src/app/services/dataService.ts',
      description: 'Primary frontend service layer. All components call this — never the backend directly. When BACKEND_INTEGRATION is false it returns demo data; when true it calls the Hono API.',
      dependencies: [],
      dependents: [],
      notes: 'This is the BACKEND_INTEGRATION gateway. Flipping the flag to true here makes the entire platform switch to live data. This is the single file to change when going live.',
    },

    'MQC-SVC-002': {
      id: 'MQC-SVC-002',
      name: 'cortexDataService',
      type: 'SVC',
      status: 'DEMO',
      domain: 'AI',
      filePath: 'src/app/services/cortexDataService.ts',
      description: 'Sibling service to dataService, specifically for Cortex AI module data. Provides AI analysis results and intelligence metrics.',
      dependencies: ['MQC-SVC-001'],
      dependents: ['MQC-COMP-044', 'MQC-COMP-052', 'MQC-COMP-056'],
      notes: 'Returns demo data until BACKEND_INTEGRATION is true and cortexAnalysis backend is wired.',
    },

    'MQC-SVC-003': {
      id: 'MQC-SVC-003',
      name: 'blockAiAssist (backend)',
      type: 'SVC',
      status: 'LIVE',
      domain: 'EXECUTION',
      filePath: 'supabase/functions/server/blockAiAssist.ts',
      description: 'Hono backend service that provides AI-powered suggestions for execution block content. Takes a block context and returns suggested text.',
      dependencies: [],
      dependents: [],
      backendRoute: 'POST /make-server-324f4fbe/blocks/ai-assist',
    },

    'MQC-SVC-004': {
      id: 'MQC-SVC-004',
      name: 'copilotPatch (backend)',
      type: 'SVC',
      status: 'LIVE',
      domain: 'AI',
      filePath: 'supabase/functions/server/copilotPatch.ts',
      description: 'Hono backend service that interprets copilot intent and returns structured proposal section content.',
      dependencies: [],
      dependents: ['MQC-COMP-048', 'MQC-COMP-021'],
      backendRoute: 'POST /make-server-324f4fbe/copilot/interpret',
      inputs: ['CopilotInterpretRequest'],
      outputs: ['CopilotResponse'],
    },

    'MQC-SVC-005': {
      id: 'MQC-SVC-005',
      name: 'cortexAnalysis (backend)',
      type: 'SVC',
      status: 'LIVE',
      domain: 'AI',
      filePath: 'supabase/functions/server/cortexAnalysis.ts',
      description: 'Hono backend service for deep Cortex AI analysis of a submission. Powers objection handling, reviewer modules, and intelligence features.',
      dependencies: [],
      dependents: ['MQC-COMP-051', 'MQC-COMP-054'],
      backendRoute: 'POST /make-server-324f4fbe/cortex/analyse',
    },

    'MQC-SVC-006': {
      id: 'MQC-SVC-006',
      name: 'cortexChat (backend)',
      type: 'SVC',
      status: 'LIVE',
      domain: 'AI',
      filePath: 'supabase/functions/server/cortexChat.ts',
      description: 'Hono backend service for the Cortex AI chat. Handles message history, context injection, and streaming responses.',
      dependencies: [],
      dependents: ['MQC-COMP-046', 'MQC-COMP-047'],
      backendRoute: 'POST /make-server-324f4fbe/cortex/chat',
      inputs: ['ChatRequest'],
      outputs: ['ChatResponse'],
    },

    'MQC-SVC-007': {
      id: 'MQC-SVC-007',
      name: 'cortexNarrative (backend)',
      type: 'SVC',
      status: 'LIVE',
      domain: 'AI',
      filePath: 'supabase/functions/server/cortexNarrative.ts',
      description: 'Hono backend service that generates narrative text from scoring data. This is the LLM-explanation layer — it describes what the math already decided.',
      dependencies: [],
      dependents: ['MQC-COMP-053'],
      backendRoute: 'POST /make-server-324f4fbe/cortex/narrative',
      inputs: ['NarrativeRequest'],
      outputs: ['NarrativeResponse'],
      notes: 'Core rule applies here directly: this service only explains — it never decides. Scoring data comes in already computed by scoringEngine.',
    },

    'MQC-SVC-008': {
      id: 'MQC-SVC-008',
      name: 'emailService (backend)',
      type: 'SVC',
      status: 'LIVE',
      domain: 'COMMS',
      filePath: 'supabase/functions/server/emailService.ts',
      description: 'Resend-powered email service. Sends transactional emails for all platform events — new submission, report ready, proposal sent, message received.',
      dependencies: [],
      dependents: ['MQC-COMP-068'],
      notes: 'isResendConfigured() must return true for emails to send. Set RESEND_API_KEY env var to enable.',
    },

    'MQC-SVC-009': {
      id: 'MQC-SVC-009',
      name: 'honoServer',
      type: 'SVC',
      status: 'LIVE',
      domain: 'SYSTEM',
      filePath: 'supabase/functions/server/index.tsx',
      description: 'The Hono web server entry point on Supabase Edge Functions. Registers all routes, CORS, rate limiting, auth middleware, and error handling. 68 routes total.',
      dependencies: ['MQC-SVC-003', 'MQC-SVC-004', 'MQC-SVC-005', 'MQC-SVC-006', 'MQC-SVC-007', 'MQC-SVC-008', 'MQC-SVC-010'],
      dependents: [],
      notes: 'Rate limit: 120 requests/minute per IP. Add new routes by importing handlers and registering them here with the /make-server-324f4fbe/ prefix.',
    },

    'MQC-SVC-010': {
      id: 'MQC-SVC-010',
      name: 'intelligenceGateway (backend)',
      type: 'SVC',
      status: 'LIVE',
      domain: 'AI',
      filePath: 'supabase/functions/server/intelligence/gateway.ts',
      description: 'Provider-agnostic Intelligence Gateway. Normalizes AI requests, resolves provider/model via registry, applies timeout/retry/telemetry, and delegates to adapters (OpenAI, mock).',
      dependencies: [],
      dependents: ['MQC-SVC-003', 'MQC-SVC-004', 'MQC-SVC-005', 'MQC-SVC-006', 'MQC-SVC-007', 'MQC-SVC-009'],
      notes: 'Rollback per feature via INTELLIGENCE_USE_GATEWAY_* env flags. Legacy *Legacy() paths retained. See src/imports/MCV2-intelligence-gateway-provider-extension-guide.md',
    },

    'MQC-SVC-011': {
      id: 'MQC-SVC-011',
      name: 'tenancyRepository (backend)',
      type: 'SVC',
      status: 'LIVE',
      domain: 'SYSTEM',
      filePath: 'supabase/functions/server/repositories/tenancyRepository.ts',
      description: 'Server-side repository for organizations, memberships, roles, and settings. MCV2-S4 foundation — not wired to Hono routes yet.',
      dependencies: [],
      dependents: [],
      notes: 'Uses service role client. KV remains authoritative for runtime data. See architecture/database/MCV2-S4-IMPLEMENT-001-COMPLETION.md',
    },

    'MQC-SVC-012': {
      id: 'MQC-SVC-012',
      name: 'leadRepository (backend)',
      type: 'SVC',
      status: 'LIVE',
      domain: 'DATA',
      filePath: 'supabase/functions/server/repositories/leadRepository.ts',
      description: 'Diagnostic domain lead repository. MCV2-S5 foundation — not wired to Hono routes.',
      dependencies: ['MQC-SVC-011'],
      dependents: [],
      notes: 'KV lead:* remains authoritative until Phase 5 cutover. Backfill via MQC-MIG-001 migration engine (S6.2).',
    },

    'MQC-MIG-001': {
      id: 'MQC-MIG-001',
      name: 'kvMigrationEngine',
      type: 'SVC',
      status: 'LIVE',
      domain: 'DATA',
      filePath: 'supabase/functions/server/migration/orchestrator.ts',
      description: 'KV backfill migration engine: inventory, simulation, backfill, reconcile, rollback. MCV2-S6.2 — lead/contact slice only; CLI-safe; not wired to routes.',
      dependencies: ['MQC-SVC-012', 'MQC-SVC-013'],
      dependents: [],
      notes: 'CLI: scripts/migration/cli.ts. KV read-only. Requires service role for live writes. See MCV2-S6.2-IMPLEMENT-004-COMPLETION.md',
    },

    'MQC-SVC-013': {
      id: 'MQC-SVC-013',
      name: 'contactRepository (backend)',
      type: 'SVC',
      status: 'LIVE',
      domain: 'DATA',
      filePath: 'supabase/functions/server/repositories/contactRepository.ts',
      description: 'Diagnostic domain contact repository. MCV2-S5 foundation — not wired to Hono routes.',
      dependencies: ['MQC-SVC-011'],
      dependents: [],
    },

    'MQC-SVC-014': {
      id: 'MQC-SVC-014',
      name: 'submissionRepository (backend)',
      type: 'SVC',
      status: 'LIVE',
      domain: 'DATA',
      filePath: 'supabase/functions/server/repositories/submissionRepository.ts',
      description: 'Diagnostic domain submission repository with sections, answers, and scores. MCV2-S5 — not wired to routes.',
      dependencies: ['MQC-SVC-011'],
      dependents: [],
      notes: 'Maps to KV sub:* namespace. No runtime cutover.',
    },

    'MQC-SVC-015': {
      id: 'MQC-SVC-015',
      name: 'reportRepository (backend)',
      type: 'SVC',
      status: 'LIVE',
      domain: 'DATA',
      filePath: 'supabase/functions/server/repositories/reportRepository.ts',
      description: 'Client report repository with version history. MCV2-S5 — not wired to routes.',
      dependencies: ['MQC-SVC-014'],
      dependents: [],
    },

    'MQC-SVC-016': {
      id: 'MQC-SVC-016',
      name: 'outcomeRepository (backend)',
      type: 'SVC',
      status: 'LIVE',
      domain: 'DATA',
      filePath: 'supabase/functions/server/repositories/outcomeRepository.ts',
      description: 'Post-engagement outcome repository. MCV2-S5 — not wired to routes.',
      dependencies: ['MQC-SVC-014'],
      dependents: [],
      notes: 'Maps to KV outcome:{submissionId}.',
    },

    'MQC-TYPE-009': {
      id: 'MQC-TYPE-009',
      name: 'diagnostic.database.types',
      type: 'TYPE',
      status: 'LIVE',
      domain: 'DATA',
      filePath: 'src/types/diagnostic.database.types.ts',
      description: 'TypeScript types for diagnostic domain relational tables (MCV2-S5).',
      dependencies: [],
      dependents: ['MQC-SVC-012', 'MQC-SVC-013', 'MQC-SVC-014', 'MQC-SVC-015', 'MQC-SVC-016'],
    },

    // ══════════════════════════════════════════════════════════════════════════
    // HOOKS & CONTEXTS — /src/app/hooks + /src/app/contexts  (MQC-HOOK-001 → 006)
    // ══════════════════════════════════════════════════════════════════════════

    'MQC-HOOK-001': {
      id: 'MQC-HOOK-001',
      name: 'useKeyboardShortcuts',
      type: 'HOOK',
      status: 'LIVE',
      domain: 'SYSTEM',
      filePath: 'src/app/hooks/useKeyboardShortcuts.tsx',
      description: 'Registers and manages global keyboard shortcuts. Used by CommandPalette and KeyboardShortcutsHelp.',
      dependencies: [],
      dependents: ['MQC-COMP-080', 'MQC-COMP-089'],
    },

    'MQC-HOOK-002': {
      id: 'MQC-HOOK-002',
      name: 'useOnlineStatus',
      type: 'HOOK',
      status: 'LIVE',
      domain: 'SYSTEM',
      filePath: 'src/app/hooks/useOnlineStatus.ts',
      description: 'Tracks browser online/offline status using the navigator.onLine API and window events.',
      dependencies: [],
      dependents: ['MQC-COMP-084'],
      outputs: ['isOnline: boolean'],
    },

    'MQC-HOOK-003': {
      id: 'MQC-HOOK-003',
      name: 'usePerformance',
      type: 'HOOK',
      status: 'LIVE',
      domain: 'SYSTEM',
      filePath: 'src/app/hooks/usePerformance.tsx',
      description: 'Performance utility hooks. Exports useDebounce and related helpers. useDebounce must be applied to every search input in the codebase.',
      dependencies: [],
      dependents: ['MQC-COMP-042', 'MQC-COMP-043', 'MQC-PAGE-011'],
      outputs: ['useDebounce', 'useDeferredSearch'],
    },

    'MQC-HOOK-004': {
      id: 'MQC-HOOK-004',
      name: 'AppContext',
      type: 'HOOK',
      status: 'LIVE',
      domain: 'AUTH',
      filePath: 'src/app/contexts/AppContext.tsx',
      description: 'Global application context. Holds auth state, current user, session, and the BACKEND_INTEGRATION flag value.',
      dependencies: [],
      dependents: ['MQC-PAGE-000', 'MQC-COMP-001', 'MQC-COMP-002', 'MQC-COMP-010'],
    },

    'MQC-HOOK-005': {
      id: 'MQC-HOOK-005',
      name: 'DashboardContext',
      type: 'HOOK',
      status: 'LIVE',
      domain: 'EXECUTION',
      filePath: 'src/app/contexts/DashboardContext.tsx',
      description: 'Context for the team dashboard. Holds active submission, selected tab, and shared filter state across all dashboard panels.',
      dependencies: [],
      dependents: ['MQC-COMP-036', 'MQC-COMP-037', 'MQC-COMP-030'],
    },

    'MQC-HOOK-006': {
      id: 'MQC-HOOK-006',
      name: 'GlobalAIChatContext',
      type: 'HOOK',
      status: 'LIVE',
      domain: 'AI',
      filePath: 'src/app/contexts/GlobalAIChatContext.tsx',
      description: 'Context for the global AI chat. Holds chat history, open/closed state, and the active context payload injected from the current view.',
      dependencies: [],
      dependents: ['MQC-COMP-036', 'MQC-COMP-046', 'MQC-COMP-047', 'MQC-COMP-049', 'MQC-COMP-050'],
    },

    // ══════════════════════════════════════════════════════════════════════════
    // TYPE SCHEMAS — /src/app/types  (MQC-TYPE-001 → MQC-TYPE-007)
    // ══════════════════════════════════════════════════════════════════════════

    'MQC-TYPE-001': {
      id: 'MQC-TYPE-001',
      name: 'ai-scoring',
      type: 'TYPE',
      status: 'LIVE',
      domain: 'DIAGNOSTIC',
      filePath: 'src/app/types/ai-scoring.ts',
      description: 'TypeScript types for AI scoring — ScoringResult, DimensionScore, ScoreBand, and related interfaces used by the scoring and decision engines.',
      dependencies: [],
      dependents: [],
    },

    'MQC-TYPE-002': {
      id: 'MQC-TYPE-002',
      name: 'call-script',
      type: 'TYPE',
      status: 'LIVE',
      domain: 'REVIEWER',
      filePath: 'src/app/types/call-script.ts',
      description: 'Types for call script generation — CallScriptSection, TalkingPoint, ObjectionResponse.',
      dependencies: [],
      dependents: [],
    },

    'MQC-TYPE-003': {
      id: 'MQC-TYPE-003',
      name: 'cortex-ai-brain',
      type: 'TYPE',
      status: 'LIVE',
      domain: 'AI',
      filePath: 'src/app/types/cortex-ai-brain.ts',
      description: 'Types for the Cortex AI module system — AIModule, ModuleState, CortexBrainConfig.',
      dependencies: [],
      dependents: [],
    },

    'MQC-TYPE-004': {
      id: 'MQC-TYPE-004',
      name: 'cortex-data-schema',
      type: 'TYPE',
      status: 'LIVE',
      domain: 'SYSTEM',
      filePath: 'src/app/types/cortex-data-schema.ts',
      description: 'Core data schema types — Submission, SubmissionStatus, DiagnosticAnswers, and the platform-wide data shape.',
      dependencies: [],
      dependents: [],
      notes: 'This is the single source of truth for the Submission data shape. All engines and services use these types.',
    },

    'MQC-TYPE-005': {
      id: 'MQC-TYPE-005',
      name: 'cortex-types',
      type: 'TYPE',
      status: 'LIVE',
      domain: 'SYSTEM',
      filePath: 'src/app/types/cortex-types.ts',
      description: 'Miscellaneous platform-wide types that do not fit into a specific domain schema.',
      dependencies: [],
      dependents: [],
    },

    'MQC-TYPE-006': {
      id: 'MQC-TYPE-006',
      name: 'proposal',
      type: 'TYPE',
      status: 'LIVE',
      domain: 'PROPOSAL',
      filePath: 'src/app/types/proposal.ts',
      description: 'Types for the proposal system — ProposalSection, ProposalState, ProposalStatus, AnnotationMark.',
      dependencies: [],
      dependents: [],
    },

    'MQC-TYPE-007': {
      id: 'MQC-TYPE-007',
      name: 'reviewer-checklist',
      type: 'TYPE',
      status: 'LIVE',
      domain: 'REVIEWER',
      filePath: 'src/app/types/reviewer-checklist.ts',
      description: 'Types for the reviewer workflow — ChecklistItem, ReviewStatus, ReviewerAssignment.',
      dependencies: [],
      dependents: [],
    },

    'MQC-TYPE-008': {
      id: 'MQC-TYPE-008',
      name: 'database-types',
      type: 'TYPE',
      status: 'LIVE',
      domain: 'SYSTEM',
      filePath: 'src/types/database.types.ts',
      description: 'Tenancy foundation database types — Organization, Role, Permission, Membership, Settings. MCV2-S4.',
      dependencies: [],
      dependents: ['MQC-SVC-011'],
    },
  },
};

export default manifest;
