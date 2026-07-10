/**
 * ============================================================================
 * MARQ CORTEX — PROCESS & INTERACTION REGISTRY  (MQC-REGISTRY v1.2)
 * ============================================================================
 *
 * Two new ID namespaces:
 *
 *   MQC-PRC-{NNN}  — PROCESS  (an end-to-end workflow with trigger → steps → outcome)
 *   MQC-INT-{NNN}  — INTERACTION  (every button, click, form submit, toggle, keyboard shortcut)
 *
 * A PROCESS is defined by:
 *   - trigger: what starts it
 *   - steps: ordered list of node IDs involved
 *   - outcome: what the user / system gets at the end
 *   - featureFlag: if controlled by BACKEND_INTEGRATION flag
 *
 * An INTERACTION is defined by:
 *   - component: which MQC-CMP/RTE/PAGE the button lives in
 *   - element: the visible label / icon of the button
 *   - trigger: the DOM event (click | input | keydown | change | drag | drop)
 *   - process: the MQC-PRC process it kicks off (if any)
 *   - apiCall: the API route it hits directly (if any)
 *   - outcome: what happens as a result
 * ============================================================================
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type ProcessStatus = 'stable' | 'watch' | 'hot' | 'demo-only' | 'partial';

export interface MQCProcess {
  id: string;              // MQC-PRC-NNN
  label: string;           // Human-readable name
  domain: string;          // System domain
  trigger: string;         // What event starts this process
  steps: string[];         // Ordered MQC node IDs involved
  outcome: string;         // What is produced at the end
  featureFlag?: string;    // Which FEATURES flag gates this (if any)
  status: ProcessStatus;
  notes?: string;
}

export type InteractionTrigger = 'click' | 'input' | 'keydown' | 'change' | 'drag' | 'drop' | 'hover' | 'submit' | 'focus';

export interface MQCInteraction {
  id: string;              // MQC-INT-NNN
  label: string;           // What the button/element says
  component: string;       // MQC-CMP/RTE/PAGE node ID where it lives
  trigger: InteractionTrigger;
  element: string;         // DOM element description (button, input, select, drag, etc.)
  process?: string;        // MQC-PRC it initiates (if any)
  apiCall?: string;        // MQC-API it calls directly (if any)
  outcome: string;         // What happens when triggered
  shortcut?: string;       // Keyboard shortcut if any
  notes?: string;
}

// ============================================================================
// SECTION A — PROCESSES  (MQC-PRC-001 → MQC-PRC-108)
// Grouped by domain
// ============================================================================

export const PROCESSES: MQCProcess[] = [

  // ── A1. PUBLIC FUNNEL ──────────────────────────────────────────────────────

  {
    id: 'MQC-PRC-001',
    label: 'Lead Capture & Diagnostic Submission',
    domain: 'public-funnel',
    trigger: 'User lands on LandingPage and clicks "Start Your Free AI Diagnostic"',
    steps: [
      'MQC-RTE-003',   // LandingPageRoute
      'MQC-CMP-020',   // LandingPage → onStartDiagnostic
      'MQC-RTE-004',   // DiagnosticRoute
      'MQC-CMP-015',   // DiagnosticForm — multi-step form
      'MQC-ENG-033',   // scoringEngine — instantScoring
      'MQC-RTE-008',   // ScoreRoute
      'MQC-CMP-073',   // ScorePage — shows instant score
      'MQC-SVC-001',   // dataService.createSubmission
      'MQC-API-009',   // POST /submissions
      'MQC-FN-004',    // storeNotification
      'MQC-FN-007',    // fireEmail (new_submission)
    ],
    outcome: 'Submission stored in KV, team notified, user sees their instant AI Readiness Score',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
    notes: 'The score is computed BEFORE the API call — Math decides priority (MQC-SPC-010). The backend stores the answers; the frontend does the scoring deterministically.',
  },
  {
    id: 'MQC-PRC-002',
    label: 'Diagnostic Multi-Step Form Navigation',
    domain: 'public-funnel',
    trigger: 'User clicks Next/Back in DiagnosticForm',
    steps: [
      'MQC-CMP-015',   // DiagnosticForm
      'MQC-CMP-016',   // DiagnosticQuestion (per question)
      'MQC-CMP-054',   // UniversalQuestions (shared questions)
      'MQC-CMP-038',   // IndustrialQuestions (industry-specific)
      'MQC-CMP-001',   // AIAssistant (hint per question)
    ],
    outcome: 'User progresses through 14-question diagnostic, answers stored in local state',
    status: 'stable',
    notes: 'Industry selected on step 0 determines which question set loads. IndustrialQuestions for manufacturing; industry-specific sets for others.',
  },
  {
    id: 'MQC-PRC-003',
    label: 'Instant Score Generation',
    domain: 'public-funnel',
    trigger: 'DiagnosticForm.onComplete fires with all 14 answers',
    steps: [
      'MQC-UTL-009',   // instantScoring — runs deterministic scoring
      'MQC-ENG-033',   // scoringEngine (underlying math)
      'MQC-UTL-008',   // diagnosticEngine (dimension weights)
      'MQC-CMP-073',   // ScorePage — receives InstantScoreResult
    ],
    outcome: 'Overall score 0-100, tier (High/Medium/Low), dimension breakdown, 3-5 insights, estimated ROI range',
    status: 'stable',
    notes: 'FULLY DETERMINISTIC. No AI involved. LLM only explains the score — it does not decide it. Uses weighted sum of dimension scores mapped from question answers.',
  },
  {
    id: 'MQC-PRC-004',
    label: 'Exit Intent Lead Capture',
    domain: 'public-funnel',
    trigger: 'Mouse cursor exits viewport on LandingPage / DiagnosticRoute (detected by mouseleave on document)',
    steps: [
      'MQC-CMP-019',   // ExitIntentPopup
      'MQC-SVC-001',   // dataService → leads/exit-intent
      'MQC-API-006',   // POST /leads/exit-intent
    ],
    outcome: 'Lead email + intent signal stored, popup dismissed',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
  },
  {
    id: 'MQC-PRC-005',
    label: 'Lead Magnet PDF Capture',
    domain: 'public-funnel',
    trigger: 'User clicks "Get Free Report" on LeadMagnetCapture form',
    steps: [
      'MQC-CMP-044',   // LeadMagnetCapture — form submit
      'MQC-API-005',   // POST /leads/capture
      'MQC-UTL-015',   // pdfExport — generates PDF via jsPDF
    ],
    outcome: 'Lead stored, PDF guide downloaded to user\'s browser',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'watch',
    notes: 'BUG NOTE: pdfExport.ts is eagerly imported through LeadMagnetCapture → LeadMagnetRoute → App.tsx. If jsPDF fails it can block the entire app. FUTURE FIX: lazy-import via dynamic import().',
  },

  // ── A2. AUTHENTICATION ────────────────────────────────────────────────────

  {
    id: 'MQC-PRC-006',
    label: 'Team Login',
    domain: 'team-auth',
    trigger: 'Team member submits login form on TeamLogin page',
    steps: [
      'MQC-CMP-083',   // TeamLogin
      'MQC-API-007',   // POST /auth/team/login
      'MQC-FN-001',    // verifyTeamToken (validates returned JWT)
      'MQC-SVC-001',   // dataService — stores access_token
      'MQC-RTE-009',   // TeamDashboardRoute — renders dashboard
      'MQC-CMP-085',   // TeamDashboardNew — main dashboard shell
    ],
    outcome: 'JWT access_token stored in React state, team dashboard rendered, seedAdminUser ran on cold start',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
    notes: 'Default credentials: admin@marqcortex.com / CortexAdmin2026! (set by MQC-FN-008 on cold start). If BACKEND_INTEGRATION=false, login is bypassed and demo data loads.',
  },
  {
    id: 'MQC-PRC-007',
    label: 'Team Token Verification (Per-Request Auth)',
    domain: 'team-auth',
    trigger: 'Any protected API route receives a request',
    steps: [
      'MQC-FN-001',    // verifyTeamToken — extracts Bearer token
      'MQC-BEF-001',   // index.tsx — calls supabaseAdmin.auth.getUser(token)
    ],
    outcome: 'userId resolved or 401 returned. All team-protected routes run this check.',
    status: 'stable',
    notes: 'If verifyTeamToken returns null → route returns 401. Frontend sees 401 → should redirect to login. If auth loop observed, check token expiry and refresh logic in MQC-LIB-002.',
  },
  {
    id: 'MQC-PRC-008',
    label: 'Client Portal Authentication',
    domain: 'client-portal',
    trigger: 'Client enters submission ID + email on ClientLogin page and submits',
    steps: [
      'MQC-CMP-005',   // ClientLogin
      'MQC-API-008',   // POST /auth/client/verify
      'MQC-RTE-002',   // ClientPortalRoute — renders portal
      'MQC-CMP-006',   // ClientPortal — loads submission
    ],
    outcome: 'Client authenticated, submissionId + clientEmail stored, portal rendered',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
    notes: 'No JWT for clients — they authenticate via (submissionId, email) tuple. The backend checks KV for matching submission. If BACKEND_INTEGRATION=false, any ID/email combo works (demo mode).',
  },
  {
    id: 'MQC-PRC-009',
    label: 'Team Logout',
    domain: 'team-auth',
    trigger: 'Team member clicks "Logout" button in sidebar or header',
    steps: [
      'MQC-CMP-085',   // TeamDashboardNew.handleLogout
      'MQC-CTX-002',   // DashboardContext.resetState
      'MQC-RTE-009',   // TeamDashboardRoute → clears auth state
      'MQC-RTE-010',   // TeamLoginRoute — redirects
    ],
    outcome: 'Access token cleared from state, dashboard state reset, user sees login page',
    status: 'stable',
  },

  // ── A3. BACKEND INFRASTRUCTURE ────────────────────────────────────────────

  {
    id: 'MQC-PRC-010',
    label: 'Server Cold Start / Initialization',
    domain: 'backend-infra',
    trigger: 'Supabase Edge Function cold start (first request after sleep)',
    steps: [
      'MQC-BEF-001',   // index.tsx — Hono app initialization
      'MQC-FN-008',    // seedAdminUser — idempotent admin creation
      'MQC-FN-009',    // testDatabaseConnection — KV health check
      'MQC-API-001',   // GET /ping — available immediately
    ],
    outcome: 'Server ready, admin user exists in Supabase Auth, KV connectivity confirmed',
    status: 'stable',
    notes: 'Cold start adds ~500ms latency to first request. seedAdminUser is idempotent — safe to run every cold start. If KV test fails, ALL API routes will fail — check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
  },
  {
    id: 'MQC-PRC-011',
    label: 'KV Write (Single Key)',
    domain: 'backend-infra',
    trigger: 'Any server route calls kv.set(key, value)',
    steps: [
      'MQC-FN-011',    // kv.set
      'MQC-BEF-008',   // kv_store.tsx — upserts to kv_store_324f4fbe table
    ],
    outcome: 'Key-value pair stored/updated in Postgres KV table',
    status: 'stable',
    notes: 'RULE: always JSON.stringify objects before kv.set(). Storing raw objects causes "[object Object]" on read-back. Use kv.set(key, JSON.stringify(obj)).',
  },
  {
    id: 'MQC-PRC-012',
    label: 'KV Read (Single Key)',
    domain: 'backend-infra',
    trigger: 'Any server route calls kv.get(key)',
    steps: [
      'MQC-FN-010',    // kv.get
      'MQC-FN-002',    // safeJsonParse — handles null/unparseable values
      'MQC-BEF-008',   // kv_store.tsx
    ],
    outcome: 'Value returned or null (never throws)',
    status: 'stable',
  },
  {
    id: 'MQC-PRC-013',
    label: 'KV Prefix Scan (List)',
    domain: 'backend-infra',
    trigger: 'Server route calls kv.getByPrefix(prefix)',
    steps: [
      'MQC-FN-016',    // kv.getByPrefix
      'MQC-FN-003',    // parseSubmissions (if scanning sub: prefix)
      'MQC-BEF-008',   // kv_store.tsx
    ],
    outcome: 'Array of all values whose key starts with prefix. NOTE: may include index entries — always filter.',
    status: 'stable',
    notes: 'There is NO kv.list(). Always use getByPrefix for listing. Results for "sub:" prefix may include "sub_email:" entries — always run parseSubmissions() to filter.',
  },
  {
    id: 'MQC-PRC-014',
    label: 'CORS Preflight',
    domain: 'backend-infra',
    trigger: 'Browser sends OPTIONS request before any cross-origin API call',
    steps: [
      'MQC-BEF-001',   // index.tsx — app.use('*', cors({ origin: '*' }))
    ],
    outcome: 'OPTIONS 200 with open CORS headers. Hono cors middleware handles automatically.',
    status: 'stable',
  },

  // ── A4. SUBMISSION MANAGEMENT ─────────────────────────────────────────────

  {
    id: 'MQC-PRC-015',
    label: 'Submission Storage',
    domain: 'team-dashboard',
    trigger: 'POST /submissions receives validated submission body',
    steps: [
      'MQC-API-009',   // POST /submissions
      'MQC-FN-002',    // safeJsonParse
      'MQC-FN-011',    // kv.set("sub:{id}", submission)
      'MQC-FN-011',    // kv.set("sub_email:{email}", {submissionId,token}) — client auth index
      'MQC-FN-004',    // storeNotification
      'MQC-FN-007',    // fireEmail → new_submission notification
    ],
    outcome: 'Submission stored under "sub:{id}", client auth token stored under "sub_email:{email}"',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
  },
  {
    id: 'MQC-PRC-016',
    label: 'Submission List Fetch',
    domain: 'team-dashboard',
    trigger: 'Team dashboard loads or refreshes submissions list',
    steps: [
      'MQC-API-010',   // GET /submissions
      'MQC-FN-016',    // kv.getByPrefix("sub:")
      'MQC-FN-003',    // parseSubmissions — filters out non-submission entries
      'MQC-FN-002',    // safeJsonParse per entry
      'MQC-SVC-001',   // dataService.getSubmissions
      'MQC-CMP-010',   // CortexDashboard / SubmissionsListPage
    ],
    outcome: 'Array of submission objects returned, displayed in list/table/kanban',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
  },
  {
    id: 'MQC-PRC-017',
    label: 'Submission Status Update',
    domain: 'team-dashboard',
    trigger: 'Team member changes status of a submission (dropdown or drag-drop to new kanban column)',
    steps: [
      'MQC-API-012',   // PATCH /submissions/:id/status
      'MQC-FN-010',    // kv.get("sub:{id}")
      'MQC-FN-011',    // kv.set("sub:{id}", updated submission)
      'MQC-FN-004',    // storeNotification (status_change)
      'MQC-FN-007',    // fireEmail (status_change notification)
    ],
    outcome: 'Submission status updated in KV, team notification stored and optionally emailed',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
  },
  {
    id: 'MQC-PRC-018',
    label: 'Bulk Submission Status Update',
    domain: 'team-dashboard',
    trigger: 'Team member selects multiple submissions and applies bulk status change',
    steps: [
      'MQC-CMP-079',   // SubmissionsListPage — bulk select
      'MQC-API-013',   // PATCH /submissions/bulk
      'MQC-FN-016',    // kv.getByPrefix for each submission
      'MQC-FN-011',    // kv.set per submission
    ],
    outcome: 'All selected submissions updated to new status atomically',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
  },
  {
    id: 'MQC-PRC-019',
    label: 'Submission Note Add',
    domain: 'team-dashboard',
    trigger: 'Team member types a note and clicks Save in SubmissionNotesPanel',
    steps: [
      'MQC-CMP-080',   // SubmissionNotesPanel
      'MQC-API-023',   // POST /submissions/:id/notes
      'MQC-FN-011',    // kv.set("note:{submissionId}:{noteId}", note)
    ],
    outcome: 'Note stored in KV, list refreshes',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
  },
  {
    id: 'MQC-PRC-020',
    label: 'Submission Note Delete',
    domain: 'team-dashboard',
    trigger: 'Team member clicks delete on a note',
    steps: [
      'MQC-API-024',   // DELETE /submissions/:id/notes/:noteId
      'MQC-FN-012',    // kv.del("note:{submissionId}:{noteId}")
    ],
    outcome: 'Note removed from KV',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
  },

  // ── A5. AI / CORTEX ──────────────────────────────────────────────────────

  {
    id: 'MQC-PRC-021',
    label: 'CORTEX AI Analysis (Single Submission)',
    domain: 'ai-cortex',
    trigger: 'Team member clicks "Analyze" on a submission, or batch analysis picks it up',
    steps: [
      'MQC-API-045',   // POST /submissions/:id/analyze
      'MQC-BEF-003',   // cortexAnalysis.ts — runCortexAnalysis()
      'MQC-FN-010',    // kv.get("sub:{id}") — load submission
      'MQC-FN-011',    // kv.set("cortex:{id}", analysisResult) — store result
    ],
    outcome: 'Structured AI analysis (scores, insights, recommendations, urgency) stored at "cortex:{submissionId}"',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
    notes: 'RULE: Math (scoringEngine) computes the priority score FIRST. The AI only generates narrative explanation. Never let AI override the math score.',
  },
  {
    id: 'MQC-PRC-022',
    label: 'CORTEX Batch AI Analysis',
    domain: 'ai-cortex',
    trigger: 'Team member triggers batch analysis for all unanalyzed submissions',
    steps: [
      'MQC-API-044',   // POST /submissions/analyze-batch
      'MQC-FN-016',    // kv.getByPrefix("sub:") — all submissions
      'MQC-FN-003',    // parseSubmissions
      'MQC-BEF-003',   // cortexAnalysis.ts — runCortexAnalysis() per submission
      'MQC-FN-011',    // kv.set("cortex:{id}") per submission
    ],
    outcome: 'All submissions without cortex analysis get analyzed, results stored',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
  },
  {
    id: 'MQC-PRC-023',
    label: 'AI Narrative Generation',
    domain: 'ai-cortex',
    trigger: 'ProposalDraftEditor or CortexModulesNew requests narrative for a proposal section',
    steps: [
      'MQC-API-054',   // POST /cortex/narrative  (actual path: /cortex/narrative — see MQC-API-054)
      'MQC-BEF-005',   // cortexNarrative.ts — generateNarrative()
    ],
    outcome: 'Generated narrative text returned for a proposal section (exec brief, diagnosis, recommendation, etc.)',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
    notes: 'Narrative is EXPLANATORY ONLY. Scores and priorities come from deterministic engines. LLM explains what the math decided.',
  },
  {
    id: 'MQC-PRC-024',
    label: 'Block AI Assist',
    domain: 'ai-cortex',
    trigger: 'Team member clicks "AI Assist" on an execution block in ExecutionDashboard or EditableBlockCard',
    steps: [
      'MQC-CMP-017',   // EditableBlockCard
      'MQC-API-055',   // POST /blocks/ai-assist  (corrected path)
      'MQC-BEF-004',   // blockAiAssist.ts — handleBlockAIAssist()
    ],
    outcome: 'AI-generated improvement suggestion for the block description',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'watch',
    notes: '⚠ PATH CORRECTION: route is /blocks/ai-assist (not /cortex/block-assist). See MQC-API-055-CORRECTED.',
  },
  {
    id: 'MQC-PRC-025',
    label: 'Copilot Interpret / Patch',
    domain: 'ai-cortex',
    trigger: 'Team member triggers Copilot interpretation on a draft section in CopilotPanel',
    steps: [
      'MQC-CMP-013',   // CopilotPanel
      'MQC-API-056',   // POST /blocks/copilot-interpret  (corrected path)
      'MQC-BEF-006',   // copilotPatch.ts — handleCopilotInterpret()
    ],
    outcome: 'Structured interpretation of draft text, ready to apply as patch',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'watch',
    notes: '⚠ PATH CORRECTION: route is /blocks/copilot-interpret (not /cortex/copilot). See MQC-API-056-CORRECTED.',
  },
  {
    id: 'MQC-PRC-026',
    label: 'Global AI Chat',
    domain: 'ai-cortex',
    trigger: 'Team member opens AI Chat panel and sends a message',
    steps: [
      'MQC-CTX-003',   // GlobalAIChatContext — manages chat state and active lead
      'MQC-CMP-036',   // GlobalAIChat — floating panel UI
      'MQC-SVC-001',   // dataService.chatWithAI
      'MQC-API-057',   // POST /ai/chat  (corrected path)
      'MQC-BEF-002',   // cortexChat.ts — handleCortexChat()
    ],
    outcome: 'AI response grounded in active submission context, displayed in chat thread',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'watch',
    notes: '⚠ PATH CORRECTION: route is /ai/chat (not /cortex/chat). See MQC-API-057-CORRECTED. Multi-turn conversation with submission context injection.',
  },
  {
    id: 'MQC-PRC-027',
    label: 'Learning Loop Aggregation',
    domain: 'ai-cortex',
    trigger: 'Team member views Learning Insights tab in CortexDashboard',
    steps: [
      'MQC-CMP-010',   // CortexDashboard — insights view
      'MQC-API-059',   // GET /cortex/learning-loop
      'MQC-FN-016',    // kv.getByPrefix("outcome:") — all outcome records
    ],
    outcome: 'Outcome vs projection accuracy data displayed, showing model performance over time',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
  },

  // ── A6. MESSAGING ────────────────────────────────────────────────────────

  {
    id: 'MQC-PRC-028',
    label: 'Team Message Send',
    domain: 'team-dashboard',
    trigger: 'Team member types a message and clicks Send in TeamMessageThread',
    steps: [
      'MQC-CMP-087',   // TeamMessageThread
      'MQC-API-026',   // POST /submissions/:id/messages/team
      'MQC-FN-011',    // kv.set("msg:{submissionId}:{msgId}", message)
    ],
    outcome: 'Message stored in KV, visible to team in thread, client sees it in portal Messages tab',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
  },
  {
    id: 'MQC-PRC-029',
    label: 'Client Message Send',
    domain: 'client-portal',
    trigger: 'Client types a message and clicks Send in ClientMessaging',
    steps: [
      'MQC-CMP-007',   // ClientMessaging
      'MQC-API-028',   // POST /submissions/:id/messages
      'MQC-FN-011',    // kv.set("msg:{submissionId}:{msgId}", message)
      'MQC-FN-007',    // fireEmail (new client message notification)
    ],
    outcome: 'Client message stored, team notified by email (if pref enabled)',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
  },
  {
    id: 'MQC-PRC-030',
    label: 'Message Thread Fetch',
    domain: 'team-dashboard',
    trigger: 'TeamMessageThread mounts or polling interval fires',
    steps: [
      'MQC-API-025',   // GET /submissions/:id/messages/team (team view)
      'MQC-FN-016',    // kv.getByPrefix("msg:{submissionId}:")
    ],
    outcome: 'Full message thread returned, ordered by timestamp',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
  },

  // ── A7. PROPOSAL ──────────────────────────────────────────────────────────

  {
    id: 'MQC-PRC-031',
    label: 'Proposal Draft Save',
    domain: 'proposal-system',
    trigger: 'Team member clicks "Save Draft" in ProposalDraftEditor',
    steps: [
      'MQC-CMP-058',   // ProposalDraftEditor
      'MQC-API-030',   // POST /submissions/:id/proposal
      'MQC-FN-011',    // kv.set("proposal:{submissionId}", draft)
    ],
    outcome: 'Proposal draft stored in KV',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
  },
  {
    id: 'MQC-PRC-032',
    label: 'Proposal Send to Client',
    domain: 'proposal-system',
    trigger: 'Team member clicks "Send to Client" in ProposalControlPanel (gated by proposalGateEngine)',
    steps: [
      'MQC-CMP-057',   // ProposalControlPanel — gate check
      'MQC-ENG-023',   // proposalGateEngine — validates gate criteria
      'MQC-API-031',   // POST /submissions/:id/proposal/send
      'MQC-FN-010',    // kv.get("proposal:{id}")
      'MQC-FN-011',    // kv.set("proposal:{id}", {sentAt, status: "sent"})
      'MQC-FN-007',    // fireEmail — proposal sent notification
      'MQC-FN-004',    // storeNotification
    ],
    outcome: 'Proposal marked as sent, client notified via email, status updated',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
    notes: 'Gate criteria must pass (MQC-ENG-023) before send is allowed. Gate checks readiness score, required sections complete, etc.',
  },
  {
    id: 'MQC-PRC-033',
    label: 'Client Proposal Accept/Decline',
    domain: 'client-portal',
    trigger: 'Client clicks "Accept Proposal" or "Decline" in ProposalViewer (client view)',
    steps: [
      'MQC-CMP-059',   // ProposalViewer
      'MQC-API-033',   // POST /client/submission/:id/proposal/respond
      'MQC-FN-011',    // kv.set — updates proposal.clientResponse
      'MQC-FN-004',    // storeNotification (proposal accepted/declined)
      'MQC-FN-007',    // fireEmail — team notified
    ],
    outcome: 'Proposal response recorded, team notified',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
  },

  // ── A8. ENGAGEMENT TRACKING ───────────────────────────────────────────────

  {
    id: 'MQC-PRC-034',
    label: 'Client Engagement Event Tracking',
    domain: 'client-portal',
    trigger: 'Client performs a tracked action (portal_opened, report_viewed, proposal_viewed, cta_clicked, meeting_scheduled)',
    steps: [
      'MQC-CMP-006',   // ClientPortal — useEffect triggers on activeView change
      'MQC-SVC-001',   // dataService.trackEngagement
      'MQC-API-015',   // POST /client/submission/:id/engagement
      'MQC-FN-011',    // kv.set("eng:{submissionId}:{timestamp}", event)
    ],
    outcome: 'Engagement event stored, Kanban card updates engagement signal (MQC-PRC-040)',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
  },
  {
    id: 'MQC-PRC-035',
    label: 'Engagement Summary Aggregation',
    domain: 'analytics',
    trigger: 'PipelineKanban mounts or submissions change',
    steps: [
      'MQC-CMP-055',   // PipelineKanban
      'MQC-API-017',   // GET /cortex/engagement-summary
      'MQC-FN-016',    // kv.getByPrefix("eng:") — all engagement events
    ],
    outcome: 'Latest engagement event per submission returned for Kanban card display',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
  },

  // ── A9. ANALYTICS ────────────────────────────────────────────────────────

  {
    id: 'MQC-PRC-036',
    label: 'Analytics Overview Aggregation',
    domain: 'analytics',
    trigger: 'AnalyticsDashboard mounts',
    steps: [
      'MQC-CMP-002',   // AnalyticsDashboard
      'MQC-API-018',   // GET /analytics/overview
      'MQC-FN-016',    // kv.getByPrefix("sub:") — all submissions
      'MQC-FN-003',    // parseSubmissions
      'MQC-ENG-010',   // dashboardAggregator — aggregates metrics
    ],
    outcome: 'KPIs: total submissions, avg score, conversion rate, industry breakdown, status funnel',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
  },
  {
    id: 'MQC-PRC-037',
    label: 'Outcome Logging',
    domain: 'analytics',
    trigger: 'Team member closes a deal or marks an outcome (won/lost/stalled) on a submission',
    steps: [
      'MQC-CMP-055',   // PipelineKanban — outcome modal
      'MQC-API-048',   // POST /submissions/:id/outcome
      'MQC-FN-011',    // kv.set("outcome:{id}", outcomeData)
    ],
    outcome: 'Outcome stored, feeds Learning Loop (MQC-PRC-027)',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
  },

  // ── A10. KANBAN PIPELINE ──────────────────────────────────────────────────

  {
    id: 'MQC-PRC-038',
    label: 'Kanban Board Load',
    domain: 'team-dashboard',
    trigger: 'PipelineKanban component mounts',
    steps: [
      'MQC-CMP-055',   // PipelineKanban
      'MQC-API-010',   // GET /submissions — load all submissions
      'MQC-API-060',   // GET /cortex/pipeline-positions — load saved positions
      'MQC-API-063',   // GET /cortex/column-capacities — load capacities
      'MQC-API-017',   // GET /cortex/engagement-summary — load engagement signals
    ],
    outcome: 'Kanban board rendered with all submissions placed in their saved columns with engagement badges',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
  },
  {
    id: 'MQC-PRC-039',
    label: 'Kanban Card Drag & Drop',
    domain: 'team-dashboard',
    trigger: 'Team member drags a submission card to a new column',
    steps: [
      'MQC-CMP-055',   // PipelineKanban — useDrag/useDrop (react-dnd)
      'MQC-API-017',   // PATCH /submissions/:id/status (update submission status)
      'MQC-API-061',   // POST /cortex/pipeline-positions (persist position)
      'MQC-FN-004',    // storeNotification
    ],
    outcome: 'Card visually moved, submission status updated, position persisted to KV',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
  },
  {
    id: 'MQC-PRC-040',
    label: 'Kanban Live Sync (30s Poll)',
    domain: 'team-dashboard',
    trigger: 'setInterval fires every 30 seconds inside PipelineKanban',
    steps: [
      'MQC-CMP-055',   // PipelineKanban — interval handler
      'MQC-API-060',   // GET /cortex/pipeline-positions
      'MQC-CMP-055',   // diff remote vs local positionsRef → collect RemoteChange[]
    ],
    outcome: 'Remote changes detected, user sees "Accept / Keep" micro-buttons if diff found',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
    notes: 'Poll is SKIPPED during active saves to prevent conflicts. Tab-visibility change triggers immediate poll.',
  },
  {
    id: 'MQC-PRC-041',
    label: 'Kanban Multi-Select Bulk Move',
    domain: 'team-dashboard',
    trigger: 'Team member shift-selects multiple cards and bulk-moves them',
    steps: [
      'MQC-CMP-055',   // PipelineKanban — multi-select state
      'MQC-API-013',   // PATCH /submissions/bulk — bulk status update
      'MQC-API-061',   // POST /cortex/pipeline-positions (bulk) — {positions: {...}}
    ],
    outcome: 'All selected cards moved to target column, statuses and positions updated',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
  },
  {
    id: 'MQC-PRC-042',
    label: 'Kanban Quick Note Save',
    domain: 'team-dashboard',
    trigger: 'Team member writes a quick note in the Kanban card ⋯ popover and saves',
    steps: [
      'MQC-CMP-055',   // PipelineKanban — quick note textarea in popover
      'MQC-API-023',   // POST /submissions/:id/notes
      'MQC-FN-011',    // kv.set("note:{id}:{noteId}", note)
    ],
    outcome: 'Note saved without navigating away from Kanban board',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
  },

  // ── A11. ROI / FINANCIAL ──────────────────────────────────────────────────

  {
    id: 'MQC-PRC-043',
    label: 'ROI Calculation',
    domain: 'roi-engine',
    trigger: 'ROITabLayout mounts or user edits an ROI assumption',
    steps: [
      'MQC-CMP-066',   // ROITabLayout
      'MQC-ENG-026',   // roiEngine — calculateROI()
      'MQC-ENG-003',   // cashflowEngine
      'MQC-ENG-008',   // costEngine
      'MQC-CMP-065',   // ROIAssumptionsEditor — user can edit inputs
    ],
    outcome: 'NPV, payback period, 3-year return, monthly cashflow breakdown displayed',
    status: 'stable',
    notes: 'FULLY DETERMINISTIC. All math in roiEngine.ts. See MQC-SPC-052 for formulas.',
  },
  {
    id: 'MQC-PRC-044',
    label: 'DCF Calculation',
    domain: 'roi-engine',
    trigger: 'DCFPanel mounts or user changes discount rate / cash flow inputs',
    steps: [
      'MQC-CMP-014',   // DCFPanel
      'MQC-ENG-011',   // dcfEngine — calculateDCF()
    ],
    outcome: 'Discounted Cash Flow table, NPV, and terminal value displayed',
    status: 'stable',
  },
  {
    id: 'MQC-PRC-045',
    label: 'IRR Calculation (Newton-Raphson)',
    domain: 'roi-engine',
    trigger: 'ROI engine or IRR engine is invoked with cash flow series',
    steps: [
      'MQC-ENG-018',   // irrEngine — Newton-Raphson iteration
      'MQC-ENG-026',   // roiEngine (caller)
    ],
    outcome: 'IRR percentage computed to 6 decimal places, max 1000 iterations',
    status: 'stable',
    notes: 'Uses Newton-Raphson convergence. If IRR cannot converge (e.g. no sign change in cashflows), returns NaN. Always null-check: (irr ?? 0).toFixed(2).',
  },
  {
    id: 'MQC-PRC-046',
    label: 'Monte Carlo Simulation',
    domain: 'roi-engine',
    trigger: 'MonteCarloPanel "Run Simulation" button clicked',
    steps: [
      'MQC-CMP-049',   // MonteCarloPanel
      'MQC-ENG-020',   // monteCarloEngine — runs N=1000 iterations
    ],
    outcome: 'Distribution of ROI outcomes: P10/P50/P90 percentiles, confidence interval, histogram data',
    status: 'stable',
  },
  {
    id: 'MQC-PRC-047',
    label: 'Scenario Modeling (Best/Base/Worst)',
    domain: 'roi-engine',
    trigger: 'ScenarioPanel renders or user selects a different scenario',
    steps: [
      'MQC-CMP-072',   // ScenarioPanel
      'MQC-ENG-029',   // scenarioEngine — three scenario calculations
      'MQC-ENG-026',   // roiEngine (called per scenario)
    ],
    outcome: 'Three ROI scenarios displayed side-by-side for comparison',
    status: 'stable',
  },

  // ── A12. NOTIFICATIONS & EMAIL ────────────────────────────────────────────

  {
    id: 'MQC-PRC-048',
    label: 'In-App Notification Storage & Display',
    domain: 'team-dashboard',
    trigger: 'storeNotification() called from any route handler',
    steps: [
      'MQC-FN-004',    // storeNotification
      'MQC-FN-011',    // kv.set("notif:{timestamp}-{random}", notification)
      'MQC-CMP-050',   // NotificationCenter — polls GET /notifications
      'MQC-API-020',   // GET /notifications
    ],
    outcome: 'Notification appears in bell icon, notification center list updated',
    status: 'stable',
  },
  {
    id: 'MQC-PRC-049',
    label: 'Email Notification (Gated Fire)',
    domain: 'backend-email',
    trigger: 'fireEmail() is called from a route handler with an email function',
    steps: [
      'MQC-FN-007',    // fireEmail — checks enabled flag
      'MQC-FN-005',    // getNotifPrefs — reads notification preferences
      'MQC-BEF-007',   // emailService.ts — calls Resend API
    ],
    outcome: 'Email sent (if pref enabled) or silently gated. Non-blocking — errors are caught and logged.',
    status: 'stable',
    notes: 'If emails not sending: (1) check RESEND_API_KEY secret (2) check notifPrefs at KV key "settings:platform" (3) check fireEmail enabled param is true.',
  },
  {
    id: 'MQC-PRC-050',
    label: 'Email Weekly Digest',
    domain: 'backend-email',
    trigger: 'Team member triggers manually from Settings, OR scheduled external cron',
    steps: [
      'MQC-API-041',   // POST /email/weekly-digest
      'MQC-FN-016',    // kv.getByPrefix("sub:") — compile submission summary
      'MQC-BEF-007',   // emailService.ts — sends digest email
    ],
    outcome: 'Weekly summary email sent to team admin',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
  },

  // ── A13. EXPORT ───────────────────────────────────────────────────────────

  {
    id: 'MQC-PRC-051',
    label: 'PDF Export (jsPDF)',
    domain: 'proposal-system',
    trigger: 'Team member clicks "Export PDF" in ExportPanel or ProposalControlPanel',
    steps: [
      'MQC-CMP-022',   // ExportPanel
      'MQC-UTL-015',   // pdfExport.ts — jsPDF document generation
    ],
    outcome: 'PDF downloaded to browser',
    status: 'watch',
    notes: 'BUG RISK: pdfExport.ts is eagerly imported via LeadMagnetCapture → App.tsx chain. jsPDF failures block app load. FUTURE: lazy-import via dynamic import().',
  },
  {
    id: 'MQC-PRC-052',
    label: 'Client Report Generation',
    domain: 'client-portal',
    trigger: 'ClientPortal loads or GET /client/submission/:id/report called',
    steps: [
      'MQC-API-042',   // GET /client/submission/:id/report
      'MQC-UTL-003',   // clientReportGenerator.ts
      'MQC-CMP-008',   // ClientReadinessReport — displays result
      'MQC-CMP-069',   // ClientReportDashboard — full report view
    ],
    outcome: 'Personalised readiness report with scores, insights, and recommendations displayed to client',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
  },

  // ── A14. TEAM MANAGEMENT ──────────────────────────────────────────────────

  {
    id: 'MQC-PRC-053',
    label: 'Team Member Invite',
    domain: 'team-auth',
    trigger: 'Admin clicks "Invite Team Member" and submits invite form',
    steps: [
      'MQC-CMP-086',   // TeamManagement
      'MQC-API-035',   // POST /team/invite
      'MQC-FN-011',    // kv.set("team:{userId}", member record)
    ],
    outcome: 'New team member created in Supabase Auth with role metadata',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
  },
  {
    id: 'MQC-PRC-054',
    label: 'Platform Settings Save',
    domain: 'team-dashboard',
    trigger: 'Team member clicks "Save Settings" in SettingsPage',
    steps: [
      'MQC-CMP-074',   // SettingsPage
      'MQC-API-039',   // PATCH /settings
      'MQC-FN-011',    // kv.set("settings:platform", settings)
    ],
    outcome: 'Platform settings saved, notification prefs updated',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
  },

  // ── A15. EXECUTION PLANNING ───────────────────────────────────────────────

  {
    id: 'MQC-PRC-055',
    label: 'Execution Plan Block Assembly',
    domain: 'execution-system',
    trigger: 'ExecutionDashboard loads for a submission',
    steps: [
      'MQC-CMP-018',   // ExecutionDashboard
      'MQC-ENG-002',   // blockEngine — generateBlocks(submission)
      'MQC-ENG-032',   // templateAssembler — applies sprint template
      'MQC-ENG-028',   // sprintTemplates — industry-specific templates
    ],
    outcome: 'Ordered list of execution blocks with titles, descriptions, effort, dependencies',
    status: 'stable',
  },
  {
    id: 'MQC-PRC-056',
    label: 'Block Version Save & History',
    domain: 'execution-system',
    trigger: 'Team member clicks "Save Version" in ExecutionDashboard',
    steps: [
      'MQC-CMP-018',   // ExecutionDashboard
      'MQC-ENG-031',   // versionEngine — save()
      'MQC-CMP-076',   // SnapshotHistoryPanel — shows history list
      'MQC-ENG-031',   // versionEngine — restore()
    ],
    outcome: 'Current block state saved as versioned snapshot, restorable from history panel',
    status: 'stable',
  },
  {
    id: 'MQC-PRC-057',
    label: 'Answer → Solution Mapping',
    domain: 'ai-cortex',
    trigger: 'MappingEnginePanel "Run Mapping" button clicked, or auto-run after submission analysis',
    steps: [
      'MQC-CMP-047',   // MappingEnginePanel
      'MQC-ENG-019',   // mappingEngine — mapAnswersToSolutions()
      'MQC-UTL-007',   // industryBlueprints — industry-specific solution patterns
      'MQC-ENG-030',   // scopeEngine — assembles solution scope
    ],
    outcome: 'Recommended solutions ranked by signal strength, ready for proposal assembly',
    status: 'stable',
    notes: 'DETERMINISTIC mapping based on keyword signals in answers. No AI involved in ranking — AI only narrates the mapping.',
  },

  // ── A16. CLIENT PORTAL EXPERIENCE ─────────────────────────────────────────

  {
    id: 'MQC-PRC-058',
    label: 'Client Portal 8-Tab Navigation',
    domain: 'client-portal',
    trigger: 'Client clicks any of the 8 portal tabs',
    steps: [
      'MQC-CMP-006',   // ClientPortal — setActiveView
    ],
    outcome: 'Tab content renders. Tab order: Status → Solution → Readiness Report → Schedule a Call → Proposal → Messages → Your Assessment → Strategic Report',
    status: 'stable',
    notes: 'CRITICAL ORDERING RULE: 8-tab order is fixed and must not be changed. Messages tab clears unread badge on open. Readiness Report and Proposal tabs fire engagement events on first open.',
  },
  {
    id: 'MQC-PRC-059',
    label: 'Client Portal 30s Status Poll',
    domain: 'client-portal',
    trigger: 'setInterval fires every 30s inside ClientPortal',
    steps: [
      'MQC-CMP-006',   // ClientPortal — pollRef interval
      'MQC-API-014',   // GET /client/submission/:id (silent refresh)
      'MQC-CMP-078',   // StageTracker — updates lastUpdated badge
    ],
    outcome: 'Status changes reflected in portal within 30 seconds without user action',
    featureFlag: 'BACKEND_INTEGRATION',
    status: 'stable',
  },

  // ── A17. UI UTILITY PROCESSES ─────────────────────────────────────────────

  {
    id: 'MQC-PRC-060',
    label: 'Command Palette Search & Execute',
    domain: 'team-dashboard',
    trigger: 'User presses ⌘K / Ctrl+K anywhere in team dashboard',
    steps: [
      'MQC-HKS-001',   // useKeyboardShortcuts — registers ⌘K
      'MQC-CMP-014',   // CommandPalette — shows modal
      'MQC-CMP-014',   // CommandPalette — filters commands by query
      'MQC-CMP-014',   // CommandPalette — executes selected command
    ],
    outcome: 'Command executed: navigation, filter applied, search focused, or action taken',
    status: 'stable',
  },
  {
    id: 'MQC-PRC-061',
    label: 'Global Keyboard Shortcut Dispatch',
    domain: 'team-dashboard',
    trigger: 'User presses any registered keyboard shortcut (⌘K, ⌘/, ⌘B, ⌘1-8, ?)',
    steps: [
      'MQC-HKS-001',   // useKeyboardShortcuts — window.addEventListener("keydown")
      'MQC-CMP-084',   // TeamDashboardLayout — shortcut handlers
    ],
    outcome: 'Registered action fired. See keyboard shortcuts list below.',
    status: 'stable',
  },
  {
    id: 'MQC-PRC-062',
    label: 'Registry Dependency Trace',
    domain: 'app-root',
    trigger: 'User opens a node detail in RegistryViewer and clicks "Show Upstream/Downstream"',
    steps: [
      'MQC-UTL-019',   // registryData.traceUpstream / traceDownstream
      'MQC-CMP-091',   // RegistryViewer — renders trace results
    ],
    outcome: 'Full transitive dependency graph rendered as clickable ID chips',
    status: 'stable',
  },
  {
    id: 'MQC-PRC-063',
    label: 'Offline Status Detection',
    domain: 'app-root',
    trigger: 'Browser window.offline / online events fire',
    steps: [
      'MQC-HKS-002',   // useOnlineStatus — addEventListener("offline"/"online")
      'MQC-CMP-051',   // OfflineBanner — shows/hides based on status
    ],
    outcome: 'OfflineBanner displayed when offline, hidden when back online',
    status: 'stable',
  },
  {
    id: 'MQC-PRC-064',
    label: 'Error Boundary Catch & Recover',
    domain: 'app-root',
    trigger: 'React component throws unhandled error during render',
    steps: [
      'MQC-CMP-021',   // ErrorBoundary — componentDidCatch
      'MQC-CMP-070',   // RouteErrorFallback — per-route error UI
    ],
    outcome: 'Error UI shown instead of blank crash, "Try Again" button offered',
    status: 'stable',
  },

  // ── A18. QBR & SNAPSHOT ───────────────────────────────────────────────────

  {
    id: 'MQC-PRC-065',
    label: 'QBR Report Generation',
    domain: 'analytics',
    trigger: 'Team member clicks "Generate QBR" in QBRPanel',
    steps: [
      'MQC-CMP-063',   // QBRPanel
      'MQC-ENG-024',   // qbrEngine — generateQBR()
    ],
    outcome: 'Quarterly Business Review document with KPIs, trends, and recommendations',
    status: 'stable',
  },
  {
    id: 'MQC-PRC-066',
    label: 'ROI Actuals Tracking',
    domain: 'roi-engine',
    trigger: 'ROITrackingPanel loads with real actuals data',
    steps: [
      'MQC-CMP-067',   // ROITrackingPanel
      'MQC-ENG-025',   // roiActualsEngine — compareActualsToProjections()
      'MQC-ENG-027',   // roiTrackingEngine
    ],
    outcome: 'Variance analysis: actual vs projected ROI, trend indicators',
    status: 'stable',
  },

];

// ============================================================================
// SECTION B — INTERACTIONS  (MQC-INT-001 → MQC-INT-177)
// Every button, click, input, drag, keyboard shortcut
// ============================================================================

export const INTERACTIONS: MQCInteraction[] = [

  // ── B1. LANDING PAGE ──────────────────────────────────────────────────────

  { id: 'MQC-INT-001', label: 'Client Portal (header)',    component: 'MQC-CMP-020', trigger: 'click',   element: 'button[nav]',    process: 'MQC-PRC-008', outcome: 'Routes to client login page (ClientLoginRoute)' },
  { id: 'MQC-INT-002', label: 'Team Login (header)',       component: 'MQC-CMP-020', trigger: 'click',   element: 'button[nav]',    process: 'MQC-PRC-006', outcome: 'Routes to team login page (TeamLoginRoute)' },
  { id: 'MQC-INT-003', label: 'Start Your Free AI Diagnostic (hero CTA)', component: 'MQC-CMP-020', trigger: 'click', element: 'button[primary-cta]', process: 'MQC-PRC-001', outcome: 'Navigates to DiagnosticRoute' },
  { id: 'MQC-INT-004', label: 'How It Works (scroll link)', component: 'MQC-CMP-020', trigger: 'click',  element: 'button[scroll]', outcome: 'Smooth scrolls to howItWorksRef section' },
  { id: 'MQC-INT-005', label: 'Secondary hero CTA (any landing section)', component: 'MQC-CMP-020', trigger: 'click', element: 'button[secondary-cta]', process: 'MQC-PRC-001', outcome: 'Navigates to DiagnosticRoute' },

  // ── B2. DIAGNOSTIC FORM ───────────────────────────────────────────────────

  { id: 'MQC-INT-006', label: 'Industry card select',       component: 'MQC-CMP-015', trigger: 'click',  element: 'div[industry-card]', process: 'MQC-PRC-002', outcome: 'Sets industry, loads industry-specific questions, advances to step 1' },
  { id: 'MQC-INT-007', label: 'Back (diagnostic form)',      component: 'MQC-CMP-015', trigger: 'click',  element: 'button[back]',       process: 'MQC-PRC-002', outcome: 'Returns to previous question' },
  { id: 'MQC-INT-008', label: 'Next / Continue',             component: 'MQC-CMP-015', trigger: 'click',  element: 'button[next]',       process: 'MQC-PRC-002', outcome: 'Validates current answer, advances to next question' },
  { id: 'MQC-INT-009', label: 'Diagnostic question textarea input', component: 'MQC-CMP-016', trigger: 'input', element: 'textarea',      outcome: 'Records answer for current question in local answers state' },
  { id: 'MQC-INT-010', label: '💡 AI Hint button (per question)', component: 'MQC-CMP-001', trigger: 'click', element: 'button[ai-hint]', outcome: 'Opens AIAssistant panel with contextual tips for current question' },
  { id: 'MQC-INT-011', label: 'Submit Diagnostic',           component: 'MQC-CMP-015', trigger: 'submit', element: 'button[submit]',     process: 'MQC-PRC-001', outcome: 'Fires onComplete with all answers → instant score computed → ScorePage shown' },

  // ── B3. SCORE PAGE ────────────────────────────────────────────────────────

  { id: 'MQC-INT-012', label: 'Book Your Readiness Call (primary CTA)', component: 'MQC-CMP-073', trigger: 'click', element: 'button[book-call]', outcome: 'Opens InstantBookingOffer / Calendly modal', notes: 'Fires onBookCall prop if provided' },
  { id: 'MQC-INT-013', label: 'Get Full Report via Email',   component: 'MQC-CMP-073', trigger: 'click',  element: 'button[email-report]', process: 'MQC-PRC-005', outcome: 'Opens lead magnet capture form for email input' },
  { id: 'MQC-INT-014', label: 'Back to Home',                component: 'MQC-CMP-073', trigger: 'click',  element: 'button[back-home]',    outcome: 'Calls onBackToHome → navigates to LandingPage' },
  { id: 'MQC-INT-015', label: 'Score dimension expand',      component: 'MQC-CMP-073', trigger: 'click',  element: 'div[expandable]',      outcome: 'Expands/collapses dimension detail section (visual only)' },

  // ── B4. LEAD MAGNET ───────────────────────────────────────────────────────

  { id: 'MQC-INT-016', label: 'Lead Magnet email input',     component: 'MQC-CMP-044', trigger: 'input',  element: 'input[email]',         outcome: 'Updates email state in LeadMagnetCapture' },
  { id: 'MQC-INT-017', label: 'Get Free Report (lead magnet submit)', component: 'MQC-CMP-044', trigger: 'submit', element: 'button[submit]', process: 'MQC-PRC-005', apiCall: 'MQC-API-005', outcome: 'Lead stored, PDF downloaded' },
  { id: 'MQC-INT-018', label: 'Exit intent popup dismiss ×', component: 'MQC-CMP-019', trigger: 'click',  element: 'button[dismiss]',      outcome: 'Closes popup, no lead captured, sets sessionStorage flag to prevent re-show' },
  { id: 'MQC-INT-019', label: 'Yes, send me the guide',      component: 'MQC-CMP-019', trigger: 'submit', element: 'button[submit]',        process: 'MQC-PRC-004', apiCall: 'MQC-API-006', outcome: 'Exit intent lead stored, popup closes' },

  // ── B5. TEAM LOGIN ─────────────────────────────────────────────────────────

  { id: 'MQC-INT-020', label: 'Login email input',           component: 'MQC-CMP-083', trigger: 'input',  element: 'input[email]',   outcome: 'Updates email state in TeamLogin form' },
  { id: 'MQC-INT-021', label: 'Login password input',        component: 'MQC-CMP-083', trigger: 'input',  element: 'input[password]', outcome: 'Updates password state in TeamLogin form' },
  { id: 'MQC-INT-022', label: 'Sign In button',              component: 'MQC-CMP-083', trigger: 'submit', element: 'button[sign-in]', process: 'MQC-PRC-006', apiCall: 'MQC-API-007', outcome: 'JWT token received, dashboard rendered' },
  { id: 'MQC-INT-023', label: 'Show/hide password toggle',   component: 'MQC-CMP-083', trigger: 'click',  element: 'button[eye]',    outcome: 'Toggles input[type] between "password" and "text"' },

  // ── B6. CLIENT LOGIN ──────────────────────────────────────────────────────

  { id: 'MQC-INT-024', label: 'Submission ID / Access code input', component: 'MQC-CMP-005', trigger: 'input', element: 'input[submission-id]', outcome: 'Updates submissionId state in ClientLogin' },
  { id: 'MQC-INT-025', label: 'Client email input',          component: 'MQC-CMP-005', trigger: 'input',  element: 'input[email]',    outcome: 'Updates clientEmail state in ClientLogin' },
  { id: 'MQC-INT-026', label: 'Access My Report button',     component: 'MQC-CMP-005', trigger: 'submit', element: 'button[access]',  process: 'MQC-PRC-008', apiCall: 'MQC-API-008', outcome: 'Client authenticated, ClientPortal rendered' },

  // ── B7. CLIENT PORTAL — 8 TABS ────────────────────────────────────────────

  { id: 'MQC-INT-027', label: 'Status tab',           component: 'MQC-CMP-006', trigger: 'click', element: 'button[tab="status"]',          process: 'MQC-PRC-058', outcome: 'Renders status timeline, tracks portal_opened on first visit' },
  { id: 'MQC-INT-028', label: 'Solution tab',         component: 'MQC-CMP-006', trigger: 'click', element: 'button[tab="solution"]',        process: 'MQC-PRC-058', outcome: 'Renders ClientSolutionView with recommended solutions' },
  { id: 'MQC-INT-029', label: 'Readiness Report tab', component: 'MQC-CMP-006', trigger: 'click', element: 'button[tab="report"]',          process: 'MQC-PRC-058', outcome: 'Renders ClientReadinessReport, tracks report_viewed on first open', notes: 'TAB ORDER: position 3 of 8' },
  { id: 'MQC-INT-030', label: 'Schedule a Call tab',  component: 'MQC-CMP-006', trigger: 'click', element: 'button[tab="schedule"]',        process: 'MQC-PRC-058', outcome: 'Renders MeetingScheduler component', notes: 'TAB ORDER: position 4 of 8' },
  { id: 'MQC-INT-031', label: 'Proposal tab',         component: 'MQC-CMP-006', trigger: 'click', element: 'button[tab="proposal"]',        process: 'MQC-PRC-058', outcome: 'Renders ProposalViewer (client-facing), tracks proposal_viewed on first open', notes: 'TAB ORDER: position 5 of 8' },
  { id: 'MQC-INT-032', label: 'Messages tab',         component: 'MQC-CMP-006', trigger: 'click', element: 'button[tab="messages"]',        process: 'MQC-PRC-058', outcome: 'Renders ClientMessaging, clears unread message badge', notes: 'TAB ORDER: position 6 of 8' },
  { id: 'MQC-INT-033', label: 'Your Assessment tab',  component: 'MQC-CMP-006', trigger: 'click', element: 'button[tab="assessment"]',      process: 'MQC-PRC-058', outcome: 'Renders ClientQAReview (self-assessment view)', notes: 'TAB ORDER: position 7 of 8' },
  { id: 'MQC-INT-034', label: 'Strategic Report tab', component: 'MQC-CMP-006', trigger: 'click', element: 'button[tab="strategic-report"]',process: 'MQC-PRC-058', outcome: 'Renders ClientReportDashboard (full strategic report)', notes: 'TAB ORDER: position 8 of 8' },
  { id: 'MQC-INT-035', label: 'Logout (client portal)', component: 'MQC-CMP-006', trigger: 'click', element: 'button[logout]',             outcome: 'Calls onLogout prop → clears client session → shows ClientLogin' },
  { id: 'MQC-INT-036', label: 'Refresh data (client portal)', component: 'MQC-CMP-006', trigger: 'click', element: 'button[refresh]',      process: 'MQC-PRC-059', apiCall: 'MQC-API-014', outcome: 'Silent re-fetch of submission data, updates status and last-updated badge' },
  { id: 'MQC-INT-037', label: 'Accept Proposal',      component: 'MQC-CMP-059', trigger: 'click', element: 'button[accept]',              process: 'MQC-PRC-033', apiCall: 'MQC-API-033', outcome: 'Proposal marked accepted, team notified, status updated' },
  { id: 'MQC-INT-038', label: 'Decline Proposal',     component: 'MQC-CMP-059', trigger: 'click', element: 'button[decline]',             process: 'MQC-PRC-033', apiCall: 'MQC-API-033', outcome: 'Proposal marked declined, team notified' },
  { id: 'MQC-INT-039', label: 'Book a Call (Calendly)', component: 'MQC-CMP-048', trigger: 'click', element: 'button[calendly]',          outcome: 'Opens Calendly embed or link, tracks meeting_scheduled engagement event on completion' },
  { id: 'MQC-INT-040', label: 'Client message input', component: 'MQC-CMP-007', trigger: 'input', element: 'textarea[message]',           outcome: 'Updates message draft in ClientMessaging state' },
  { id: 'MQC-INT-041', label: 'Client send message',  component: 'MQC-CMP-007', trigger: 'click', element: 'button[send]',               process: 'MQC-PRC-029', apiCall: 'MQC-API-028', outcome: 'Message posted to thread, team email notification' },
  { id: 'MQC-INT-042', label: 'Stage tracker step click', component: 'MQC-CMP-078', trigger: 'click', element: 'div[stage-step]',        outcome: 'Visual only — no state change, highlights selected stage' },

  // ── B8. TEAM DASHBOARD SIDEBAR ────────────────────────────────────────────

  { id: 'MQC-INT-043', label: 'Dashboard nav item',   component: 'MQC-CMP-084', trigger: 'click', element: 'button[nav="dashboard"]',  outcome: 'setCurrentPage("dashboard") → renders TeamHomeDashboard' },
  { id: 'MQC-INT-044', label: 'CORTEX nav item',      component: 'MQC-CMP-084', trigger: 'click', element: 'button[nav="cortex"]',     outcome: 'setCurrentPage("cortex") → renders CortexDashboard with Kanban', shortcut: '⌘2' },
  { id: 'MQC-INT-045', label: 'Team nav item',        component: 'MQC-CMP-084', trigger: 'click', element: 'button[nav="team"]',       outcome: 'setCurrentPage("team") → renders TeamManagement', shortcut: '⌘3' },
  { id: 'MQC-INT-046', label: 'Settings nav item',    component: 'MQC-CMP-084', trigger: 'click', element: 'button[nav="settings"]',   outcome: 'setCurrentPage("settings") → renders SettingsPage', shortcut: '⌘4' },
  { id: 'MQC-INT-047', label: 'Reviewer nav item',    component: 'MQC-CMP-084', trigger: 'click', element: 'button[nav="reviewer"]',   outcome: 'setCurrentPage("reviewer") → renders ReviewerDashboard', shortcut: '⌘5' },
  { id: 'MQC-INT-048', label: 'Analytics nav item',   component: 'MQC-CMP-084', trigger: 'click', element: 'button[nav="analytics"]',  outcome: 'setCurrentPage("analytics") → renders AnalyticsDashboard', shortcut: '⌘6' },
  { id: 'MQC-INT-049', label: 'Emails nav item',      component: 'MQC-CMP-084', trigger: 'click', element: 'button[nav="emails"]',     outcome: 'setCurrentPage("emails") → renders EmailNurturePanel', shortcut: '⌘7' },
  { id: 'MQC-INT-050', label: 'Revenue nav item',     component: 'MQC-CMP-084', trigger: 'click', element: 'button[nav="revenue"]',    outcome: 'setCurrentPage("revenue") → renders RevenueIntelligenceDashboard', shortcut: '⌘8' },
  { id: 'MQC-INT-051', label: 'Mapping nav item',     component: 'MQC-CMP-084', trigger: 'click', element: 'button[nav="mapping"]',    outcome: 'setCurrentPage("mapping") → renders MappingEnginePanel' },
  { id: 'MQC-INT-052', label: 'Architecture nav item', component: 'MQC-CMP-084', trigger: 'click', element: 'button[nav="architecture"]', outcome: 'setCurrentPage("architecture") → renders SystemArchitecture' },
  { id: 'MQC-INT-053', label: 'Sidebar collapse/expand toggle', component: 'MQC-CMP-084', trigger: 'click', element: 'button[collapse]', outcome: 'Toggles DashboardContext.sidebarCollapsed — sidebar collapses to icon-only mode', shortcut: '⌘B' },
  { id: 'MQC-INT-054', label: 'Mobile menu ☰ open',   component: 'MQC-CMP-084', trigger: 'click', element: 'button[menu]',             outcome: 'Sets isMobileMenuOpen=true, sidebar slides in on mobile' },
  { id: 'MQC-INT-055', label: 'Mobile sidebar close ×', component: 'MQC-CMP-084', trigger: 'click', element: 'button[close-menu]',    outcome: 'Sets isMobileMenuOpen=false, sidebar hides' },
  { id: 'MQC-INT-056', label: 'Logout (team dashboard)', component: 'MQC-CMP-084', trigger: 'click', element: 'button[logout]',        process: 'MQC-PRC-009', outcome: 'resetState(), access token cleared, routes to TeamLogin' },
  { id: 'MQC-INT-057', label: 'Notification bell 🔔',  component: 'MQC-CMP-084', trigger: 'click', element: 'button[notifications]', process: 'MQC-PRC-048', outcome: 'Opens NotificationCenter panel, fetches GET /notifications' },
  { id: 'MQC-INT-058', label: '⌨ Keyboard shortcuts help', component: 'MQC-CMP-084', trigger: 'click', element: 'button[shortcuts]',  outcome: 'Opens KeyboardShortcutsHelp dialog', shortcut: '?' },
  { id: 'MQC-INT-059', label: 'Global search focus',   component: 'MQC-CMP-084', trigger: 'focus', element: 'input[search]',          outcome: 'Focuses search input, filters submissions list', shortcut: '⌘K' },
  { id: 'MQC-INT-060', label: 'CORTEX breadcrumb',     component: 'MQC-CMP-085', trigger: 'click', element: 'button[breadcrumb]',      outcome: 'Navigates back to CortexDashboard overview view from detail/insights view' },
  { id: 'MQC-INT-061', label: 'AI Chat floating button ✨', component: 'MQC-CMP-084', trigger: 'click', element: 'button[ai-chat]',   process: 'MQC-PRC-026', outcome: 'Opens/closes GlobalAIChat panel (toggles via GlobalAIChatContext)', shortcut: '⌘/' },

  // ── B9. COMMAND PALETTE ───────────────────────────────────────────────────

  { id: 'MQC-INT-062', label: 'Open command palette',  component: 'MQC-CMP-014', trigger: 'keydown', element: 'keyboard[⌘K]',    process: 'MQC-PRC-060', outcome: 'CommandPalette modal opens, search focused', shortcut: '⌘K' },
  { id: 'MQC-INT-063', label: 'Palette search input',  component: 'MQC-CMP-014', trigger: 'input',   element: 'input[search]',    outcome: 'Filters command list by query' },
  { id: 'MQC-INT-064', label: 'Command item click',    component: 'MQC-CMP-014', trigger: 'click',   element: 'div[command-item]', outcome: 'Executes selected command, closes palette' },
  { id: 'MQC-INT-065', label: 'Escape (close palette)', component: 'MQC-CMP-014', trigger: 'keydown', element: 'keyboard[Esc]',    outcome: 'Closes CommandPalette without executing', shortcut: 'Esc' },
  { id: 'MQC-INT-066', label: 'Arrow keys in palette', component: 'MQC-CMP-014', trigger: 'keydown', element: 'keyboard[↑↓]',    outcome: 'Navigates highlight up/down through command list' },

  // ── B10. GLOBAL AI CHAT ───────────────────────────────────────────────────

  { id: 'MQC-INT-067', label: 'AI Chat close ×',          component: 'MQC-CMP-036', trigger: 'click', element: 'button[close]',       outcome: 'Closes GlobalAIChat panel (sets isChatOpen=false in context)' },
  { id: 'MQC-INT-068', label: 'Lead selector dropdown',   component: 'MQC-CMP-036', trigger: 'click', element: 'button[lead-selector]', outcome: 'Opens searchable company/submission picker dropdown' },
  { id: 'MQC-INT-069', label: 'Lead search input',        component: 'MQC-CMP-036', trigger: 'input', element: 'input[search]',        outcome: 'Filters submission list by company name or contact' },
  { id: 'MQC-INT-070', label: 'Company/lead select',      component: 'MQC-CMP-036', trigger: 'click', element: 'div[lead-item]',       outcome: 'Sets activeLead in GlobalAIChatContext, grounds all subsequent AI responses on that submission' },
  { id: 'MQC-INT-071', label: 'Section switcher dropdown', component: 'MQC-CMP-036', trigger: 'click', element: 'button[section-picker]', outcome: 'Opens section dropdown (6 context sections)' },
  { id: 'MQC-INT-072', label: 'Section select',           component: 'MQC-CMP-036', trigger: 'click', element: 'div[section-item]',    outcome: 'Sets activeSection in chat context (general, exec brief, diagnosis, recommendation, ROI, call prep)' },
  { id: 'MQC-INT-073', label: 'Quick action chip',        component: 'MQC-CMP-036', trigger: 'click', element: 'button[quick-action]', process: 'MQC-PRC-026', outcome: 'Sends pre-built prompt for current section (Polish Tone, Sharpen Why Now, Simplify, etc.)' },
  { id: 'MQC-INT-074', label: 'Chat message input',       component: 'MQC-CMP-036', trigger: 'input', element: 'textarea[message]',    outcome: 'Updates chat message draft' },
  { id: 'MQC-INT-075', label: 'Send chat message',        component: 'MQC-CMP-036', trigger: 'click', element: 'button[send]',         process: 'MQC-PRC-026', apiCall: 'MQC-API-057', outcome: 'Message sent to /ai/chat, AI response streamed into thread', notes: 'Also fires on Enter keypress in textarea' },
  { id: 'MQC-INT-076', label: 'Clear conversation / Reset', component: 'MQC-CMP-036', trigger: 'click', element: 'button[clear]',     outcome: 'Clears chat messages array, resets to welcome state' },
  { id: 'MQC-INT-077', label: 'Copy AI response',         component: 'MQC-CMP-036', trigger: 'click', element: 'button[copy]',         outcome: 'Copies AI message content to clipboard, shows ✓ confirmation' },
  { id: 'MQC-INT-078', label: 'Apply AI content',         component: 'MQC-CMP-036', trigger: 'click', element: 'button[apply]',        outcome: 'Applies AI-generated content to the relevant proposal section draft' },

  // ── B11. KANBAN PIPELINE ──────────────────────────────────────────────────

  { id: 'MQC-INT-079', label: 'Kanban card drag start',  component: 'MQC-CMP-055', trigger: 'drag',   element: 'div[kanban-card]',    outcome: 'react-dnd useDrag lifts card, shows drop targets with capacity indicators' },
  { id: 'MQC-INT-080', label: 'Kanban card drop',        component: 'MQC-CMP-055', trigger: 'drop',   element: 'div[column-drop]',    process: 'MQC-PRC-039', outcome: 'Card moves to new column, submission status PATCH, position POST' },
  { id: 'MQC-INT-081', label: 'Kanban card click (detail)', component: 'MQC-CMP-055', trigger: 'click', element: 'div[kanban-card]',  outcome: 'Opens submission detail panel / CortexModulesNew for that submission' },
  { id: 'MQC-INT-082', label: 'Kanban ⋯ menu button',   component: 'MQC-CMP-055', trigger: 'click',   element: 'button[more-vert]',   outcome: 'Opens quick actions popover with engagement signal, priority toggle, quick note' },
  { id: 'MQC-INT-083', label: 'Priority flag toggle',    component: 'MQC-CMP-055', trigger: 'click',   element: 'button[priority]',   process: 'MQC-PRC-017', apiCall: 'MQC-API-012', outcome: 'Toggles priority between high/medium, PATCH /submissions/:id/status, P1 chip shown on card' },
  { id: 'MQC-INT-084', label: 'Suggested next step action', component: 'MQC-CMP-055', trigger: 'click', element: 'button[next-step]', outcome: 'Executes AI-suggested action based on engagement signal (e.g. "Send proposal now" → moves card to Proposal Sent)' },
  { id: 'MQC-INT-085', label: 'Quick Note save',         component: 'MQC-CMP-055', trigger: 'click',   element: 'button[save-note]',  process: 'MQC-PRC-042', apiCall: 'MQC-API-023', outcome: 'Note saved to KV without leaving Kanban board' },
  { id: 'MQC-INT-086', label: 'Accept ALL remote changes', component: 'MQC-CMP-055', trigger: 'click', element: 'button[accept-all]', outcome: 'Merges all detected remote position changes into local board state, banner dismissed' },
  { id: 'MQC-INT-087', label: 'Accept ONE remote change', component: 'MQC-CMP-055', trigger: 'click', element: 'button[accept-one]', outcome: 'Merges single remote position change for that card' },
  { id: 'MQC-INT-088', label: 'Keep local (ignore remote change)', component: 'MQC-CMP-055', trigger: 'click', element: 'button[keep-local]', outcome: 'Dismisses remote change for that card without merging — keeps local position' },
  { id: 'MQC-INT-089', label: 'Kanban manual refresh',   component: 'MQC-CMP-055', trigger: 'click',   element: 'button[refresh]',    process: 'MQC-PRC-040', apiCall: 'MQC-API-060', outcome: 'Immediately re-fetches positions from backend outside of 30s interval' },
  { id: 'MQC-INT-090', label: 'Multi-select card (checkbox)', component: 'MQC-CMP-055', trigger: 'click', element: 'input[checkbox]',  process: 'MQC-PRC-041', outcome: 'Adds/removes card from multi-select set, shows bulk action bar' },
  { id: 'MQC-INT-091', label: 'Bulk move / outcome modal apply', component: 'MQC-CMP-055', trigger: 'click', element: 'button[bulk-apply]', process: 'MQC-PRC-041', apiCall: 'MQC-API-013', outcome: 'All selected cards moved to target column, statuses and positions updated' },
  { id: 'MQC-INT-092', label: 'Column capacity edit',    component: 'MQC-CMP-055', trigger: 'click',   element: 'button[edit-capacity]', outcome: 'Opens inline capacity editor for a column' },
  { id: 'MQC-INT-093', label: 'Column capacity save',    component: 'MQC-CMP-055', trigger: 'click',   element: 'button[save-capacity]', apiCall: 'MQC-API-064', outcome: 'PUT /cortex/column-capacities — saves full capacity map' },
  { id: 'MQC-INT-094', label: 'Reset board positions',   component: 'MQC-CMP-055', trigger: 'click',   element: 'button[reset]',       apiCall: 'MQC-API-062', outcome: 'DELETE /cortex/pipeline-positions — all cards return to default columns' },

  // ── B12. NOTIFICATIONS ─────────────────────────────────────────────────────

  { id: 'MQC-INT-095', label: 'Notification bell click (open)', component: 'MQC-CMP-050', trigger: 'click', element: 'button[bell]',  process: 'MQC-PRC-048', apiCall: 'MQC-API-020', outcome: 'NotificationCenter panel opens, notifications fetched' },
  { id: 'MQC-INT-096', label: 'Notification item click', component: 'MQC-CMP-050', trigger: 'click',  element: 'div[notif-item]',    outcome: 'Navigates to relevant submission, closes panel' },
  { id: 'MQC-INT-097', label: 'Mark all read',           component: 'MQC-CMP-050', trigger: 'click',  element: 'button[mark-read]',  apiCall: 'MQC-API-021', outcome: 'POST /notifications/read — all notifications marked read, badge cleared' },
  { id: 'MQC-INT-098', label: 'Close notification panel', component: 'MQC-CMP-050', trigger: 'click', element: 'button[close]',      outcome: 'Closes NotificationCenter panel' },

  // ── B13. SETTINGS ──────────────────────────────────────────────────────────

  { id: 'MQC-INT-099', label: 'Settings field edit',     component: 'MQC-CMP-074', trigger: 'input',  element: 'input[field]',       outcome: 'Updates settings local state (admin name, email, prefs)' },
  { id: 'MQC-INT-100', label: 'Save Settings',           component: 'MQC-CMP-074', trigger: 'click',  element: 'button[save]',       process: 'MQC-PRC-054', apiCall: 'MQC-API-039', outcome: 'PATCH /settings — platform settings saved to KV' },
  { id: 'MQC-INT-101', label: 'Email notification toggle', component: 'MQC-CMP-074', trigger: 'change', element: 'input[toggle]',    outcome: 'Toggles a notification preference in settings local state (saved on Save Settings)' },
  { id: 'MQC-INT-102', label: 'Send Test Email',         component: 'MQC-CMP-074', trigger: 'click',  element: 'button[test-email]', apiCall: 'MQC-API-040', outcome: 'POST /test-email — sends test email to configured admin address' },
  { id: 'MQC-INT-103', label: 'Send Weekly Digest',      component: 'MQC-CMP-074', trigger: 'click',  element: 'button[digest]',     process: 'MQC-PRC-050', apiCall: 'MQC-API-041', outcome: 'POST /email/weekly-digest — sends weekly summary to team admin' },

  // ── B14. TEAM MANAGEMENT ──────────────────────────────────────────────────

  { id: 'MQC-INT-104', label: 'Invite Team Member button', component: 'MQC-CMP-086', trigger: 'click',  element: 'button[invite]',   outcome: 'Opens invite form modal in TeamManagement' },
  { id: 'MQC-INT-105', label: 'Invite name input',        component: 'MQC-CMP-086', trigger: 'input',  element: 'input[name]',        outcome: 'Updates invite form name field' },
  { id: 'MQC-INT-106', label: 'Invite email input',       component: 'MQC-CMP-086', trigger: 'input',  element: 'input[email]',       outcome: 'Updates invite form email field' },
  { id: 'MQC-INT-107', label: 'Role select',              component: 'MQC-CMP-086', trigger: 'change', element: 'select[role]',       outcome: 'Sets role to admin | analyst | viewer in invite form' },
  { id: 'MQC-INT-108', label: 'Create Member (submit)',   component: 'MQC-CMP-086', trigger: 'submit', element: 'button[create]',    process: 'MQC-PRC-053', apiCall: 'MQC-API-035', outcome: 'POST /team/invite — new user created in Supabase Auth' },
  { id: 'MQC-INT-109', label: 'Team member Edit button',  component: 'MQC-CMP-086', trigger: 'click',  element: 'button[edit]',      outcome: 'Opens edit form for team member (name, role)' },
  { id: 'MQC-INT-110', label: 'Member role change',       component: 'MQC-CMP-086', trigger: 'change', element: 'select[role]',      apiCall: 'MQC-API-036', outcome: 'PATCH /team/members/:id — role updated in Supabase Auth user_metadata' },
  { id: 'MQC-INT-111', label: 'Remove member button',     component: 'MQC-CMP-086', trigger: 'click',  element: 'button[remove]',    apiCall: 'MQC-API-037', outcome: 'DELETE /team/members/:id — user removed (with confirmation dialog)' },

  // ── B15. SUBMISSIONS LIST (CORTEX DASHBOARD) ──────────────────────────────

  { id: 'MQC-INT-112', label: 'Submission row click',      component: 'MQC-CMP-010', trigger: 'click',  element: 'tr[submission]',    outcome: 'Opens CortexModulesNew detail view for that submission, sets selectedSubmissionId' },
  { id: 'MQC-INT-113', label: 'Status filter dropdown',    component: 'MQC-CMP-010', trigger: 'change', element: 'select[status]',     outcome: 'Filters submission list to selected status' },
  { id: 'MQC-INT-114', label: 'Industry filter',           component: 'MQC-CMP-010', trigger: 'change', element: 'select[industry]',   outcome: 'Filters submission list to selected industry' },
  { id: 'MQC-INT-115', label: 'Sort column header',        component: 'MQC-CMP-010', trigger: 'click',  element: 'th[sortable]',       outcome: 'Sorts table by selected column (toggles asc/desc)' },
  { id: 'MQC-INT-116', label: 'Row select checkbox',       component: 'MQC-CMP-010', trigger: 'click',  element: 'input[row-checkbox]', outcome: 'Adds/removes submission from multi-select set' },
  { id: 'MQC-INT-117', label: 'Select all checkbox',       component: 'MQC-CMP-010', trigger: 'click',  element: 'input[select-all]',  outcome: 'Selects/deselects all visible submissions' },
  { id: 'MQC-INT-118', label: 'Bulk status dropdown',      component: 'MQC-CMP-010', trigger: 'change', element: 'select[bulk-status]', outcome: 'Sets target status for bulk action' },
  { id: 'MQC-INT-119', label: 'Apply Bulk Action button',  component: 'MQC-CMP-010', trigger: 'click',  element: 'button[bulk-apply]', process: 'MQC-PRC-018', apiCall: 'MQC-API-013', outcome: 'PATCH /submissions/bulk — all selected submissions updated' },
  { id: 'MQC-INT-120', label: 'Run AI Analysis (single)',  component: 'MQC-CMP-010', trigger: 'click',  element: 'button[analyze]',    process: 'MQC-PRC-021', apiCall: 'MQC-API-045', outcome: 'POST /submissions/:id/analyze — AI analysis stored at cortex:{id}' },
  { id: 'MQC-INT-121', label: 'Run Batch Analysis',        component: 'MQC-CMP-010', trigger: 'click',  element: 'button[batch-analyze]', process: 'MQC-PRC-022', apiCall: 'MQC-API-044', outcome: 'POST /submissions/analyze-batch — all unanalyzed submissions processed' },

  // ── B16. PROPOSAL EDITOR ──────────────────────────────────────────────────

  { id: 'MQC-INT-122', label: 'Proposal section tab',      component: 'MQC-CMP-058', trigger: 'click',  element: 'button[section-tab]', outcome: 'Switches editor to selected section (Exec Brief | Diagnosis | Recommendation | ROI | Pricing | Timeline)' },
  { id: 'MQC-INT-123', label: 'Section content edit',      component: 'MQC-CMP-058', trigger: 'input',  element: 'div[contenteditable] / textarea', outcome: 'Updates draft text for current section in editor state' },
  { id: 'MQC-INT-124', label: 'Section AI Assist',         component: 'MQC-CMP-060', trigger: 'click',  element: 'button[ai-assist]',  process: 'MQC-PRC-023', apiCall: 'MQC-API-054', outcome: 'POST /cortex/narrative — AI generates/improves section narrative' },
  { id: 'MQC-INT-125', label: 'Save Draft',                component: 'MQC-CMP-058', trigger: 'click',  element: 'button[save-draft]', process: 'MQC-PRC-031', apiCall: 'MQC-API-030', outcome: 'POST /submissions/:id/proposal — draft persisted to KV' },
  { id: 'MQC-INT-126', label: 'Send to Client',            component: 'MQC-CMP-057', trigger: 'click',  element: 'button[send-to-client]', process: 'MQC-PRC-032', apiCall: 'MQC-API-031', outcome: 'Gate check → POST /submissions/:id/proposal/send → client emailed', notes: 'Gated by proposalGateEngine (MQC-ENG-023). Will fail if gate criteria not met.' },
  { id: 'MQC-INT-127', label: 'Export Proposal PDF',       component: 'MQC-CMP-057', trigger: 'click',  element: 'button[export-pdf]', process: 'MQC-PRC-051', outcome: 'Generates and downloads proposal as PDF' },
  { id: 'MQC-INT-128', label: 'Preview toggle',            component: 'MQC-CMP-058', trigger: 'click',  element: 'button[preview]',    outcome: 'Switches editor between edit mode and rendered preview mode' },

  // ── B17. CORTEX AI MODULES ─────────────────────────────────────────────────

  { id: 'MQC-INT-129', label: 'Analyze This Lead',         component: 'MQC-CMP-011', trigger: 'click',  element: 'button[analyze-lead]', process: 'MQC-PRC-021', apiCall: 'MQC-API-045', outcome: 'POST /submissions/:id/analyze' },
  { id: 'MQC-INT-130', label: 'Generate Narrative',        component: 'MQC-CMP-011', trigger: 'click',  element: 'button[narrative]',   process: 'MQC-PRC-023', apiCall: 'MQC-API-054', outcome: 'POST /cortex/narrative' },
  { id: 'MQC-INT-131', label: 'Block AI Assist (block)',   component: 'MQC-CMP-017', trigger: 'click',  element: 'button[ai-assist]',   process: 'MQC-PRC-024', apiCall: 'MQC-API-055', outcome: 'POST /blocks/ai-assist — suggestion for this block' },
  { id: 'MQC-INT-132', label: 'Copilot Interpret',         component: 'MQC-CMP-013', trigger: 'click',  element: 'button[copilot]',     process: 'MQC-PRC-025', apiCall: 'MQC-API-056', outcome: 'POST /blocks/copilot-interpret' },
  { id: 'MQC-INT-133', label: 'Clear Analysis',            component: 'MQC-CMP-011', trigger: 'click',  element: 'button[clear]',       apiCall: 'MQC-API-047', outcome: 'DELETE /submissions/:id/cortex — analysis cleared' },

  // ── B18. ROI / FINANCIAL ──────────────────────────────────────────────────

  { id: 'MQC-INT-134', label: 'ROI tab select',            component: 'MQC-CMP-066', trigger: 'click',  element: 'button[roi-tab]',    outcome: 'Switches ROI view (overview | cashflow | sensitivity | assumptions)' },
  { id: 'MQC-INT-135', label: 'ROI assumption edit',       component: 'MQC-CMP-065', trigger: 'input',  element: 'input[assumption]',  process: 'MQC-PRC-043', outcome: 'Updates assumption value, triggers live ROI recalculation' },
  { id: 'MQC-INT-136', label: 'Recalculate ROI',           component: 'MQC-CMP-065', trigger: 'click',  element: 'button[recalc]',     process: 'MQC-PRC-043', outcome: 'Re-runs roiEngine with current assumptions, updates all charts' },
  { id: 'MQC-INT-137', label: 'Run Monte Carlo',           component: 'MQC-CMP-049', trigger: 'click',  element: 'button[run-mc]',     process: 'MQC-PRC-046', outcome: 'Runs 1000-iteration Monte Carlo, shows P10/P50/P90 distribution' },
  { id: 'MQC-INT-138', label: 'Scenario select',           component: 'MQC-CMP-072', trigger: 'click',  element: 'button[scenario]',   process: 'MQC-PRC-047', outcome: 'Switches displayed scenario (Best | Base | Worst)' },
  { id: 'MQC-INT-139', label: 'DCF Calculate',             component: 'MQC-CMP-014', trigger: 'click',  element: 'button[calculate]',  process: 'MQC-PRC-044', outcome: 'Runs dcfEngine, displays NPV table and terminal value' },
  { id: 'MQC-INT-140', label: 'Export ROI Report',         component: 'MQC-CMP-064', trigger: 'click',  element: 'button[export]',     process: 'MQC-PRC-051', outcome: 'Generates ROI report PDF via pdfExport.ts' },

  // ── B19. EXECUTION PLAN ───────────────────────────────────────────────────

  { id: 'MQC-INT-141', label: 'Block content edit',        component: 'MQC-CMP-017', trigger: 'input',  element: 'div[contenteditable]', outcome: 'Updates block text in EditableBlockCard, marks block as modified' },
  { id: 'MQC-INT-142', label: 'Block reorder drag',        component: 'MQC-CMP-018', trigger: 'drag',   element: 'div[block-handle]',   process: 'MQC-PRC-055', outcome: 'Reorders execution blocks via drag, updates block order array' },
  { id: 'MQC-INT-143', label: 'AI Assist per block',       component: 'MQC-CMP-017', trigger: 'click',  element: 'button[ai-assist]',   process: 'MQC-PRC-024', apiCall: 'MQC-API-055', outcome: 'POST /blocks/ai-assist — AI suggestion for this block' },
  { id: 'MQC-INT-144', label: 'Save Version (snapshot)',   component: 'MQC-CMP-018', trigger: 'click',  element: 'button[save-version]', process: 'MQC-PRC-056', outcome: 'Saves current block state as versioned snapshot in versionEngine' },
  { id: 'MQC-INT-145', label: 'Restore from snapshot',     component: 'MQC-CMP-076', trigger: 'click',  element: 'button[restore]',    process: 'MQC-PRC-056', outcome: 'Restores block state from selected historical snapshot' },
  { id: 'MQC-INT-146', label: 'Add Block button',          component: 'MQC-CMP-018', trigger: 'click',  element: 'button[add-block]',   outcome: 'Appends a new empty execution block to the plan' },

  // ── B20. REVIEWER DASHBOARD ───────────────────────────────────────────────

  { id: 'MQC-INT-147', label: 'QA checklist item check',   component: 'MQC-CMP-068', trigger: 'click',  element: 'input[checkbox]',    outcome: 'Marks/unmarks QA checklist item, updates completion percentage' },
  { id: 'MQC-INT-148', label: 'QA transcript Copy',        component: 'MQC-CMP-062', trigger: 'click',  element: 'button[copy]',       outcome: 'Copies full QA transcript to clipboard' },
  { id: 'MQC-INT-149', label: 'Reviewer Approve',          component: 'MQC-CMP-068', trigger: 'click',  element: 'button[approve]',    process: 'MQC-PRC-017', apiCall: 'MQC-API-012', outcome: 'PATCH /submissions/:id/status → "approved"' },
  { id: 'MQC-INT-150', label: 'Generate QBR',              component: 'MQC-CMP-063', trigger: 'click',  element: 'button[generate-qbr]', process: 'MQC-PRC-065', outcome: 'Runs qbrEngine, renders QBR document' },

  // ── B21. ANALYTICS ────────────────────────────────────────────────────────

  { id: 'MQC-INT-151', label: 'Date range picker',         component: 'MQC-CMP-002', trigger: 'change', element: 'input[date-range]',  outcome: 'Filters analytics charts and metrics to selected date range' },
  { id: 'MQC-INT-152', label: 'Metric card click (drill-down)', component: 'MQC-CMP-002', trigger: 'click', element: 'div[metric-card]', outcome: 'Expands/drills into metric detail view' },
  { id: 'MQC-INT-153', label: 'Export Analytics',          component: 'MQC-CMP-002', trigger: 'click',  element: 'button[export]',     outcome: 'Exports analytics summary as CSV or PDF' },

  // ── B22. MAPPING ENGINE ───────────────────────────────────────────────────

  { id: 'MQC-INT-154', label: 'Run Mapping Engine',        component: 'MQC-CMP-047', trigger: 'click',  element: 'button[run-mapping]', process: 'MQC-PRC-057', outcome: 'Executes answer→solution mapping, renders solution blueprint' },
  { id: 'MQC-INT-155', label: 'Solution view tab',         component: 'MQC-CMP-077', trigger: 'click',  element: 'button[tab]',        outcome: 'Switches SolutionArchitectureCard between overview/detail/technical views' },

  // ── B23. ROLE SWITCHER ────────────────────────────────────────────────────

  { id: 'MQC-INT-156', label: 'Role switcher dropdown',    component: 'MQC-CMP-071', trigger: 'click',  element: 'button[role-picker]', outcome: 'Opens RoleSwitcher dropdown with available roles' },
  { id: 'MQC-INT-157', label: 'Role option select',        component: 'MQC-CMP-071', trigger: 'click',  element: 'div[role-option]',   outcome: 'Sets active role via roleEngine, updates permission-gated UI elements' },

  // ── B24. REGISTRY VIEWER ──────────────────────────────────────────────────

  { id: 'MQC-INT-158', label: 'Registry search input',     component: 'MQC-CMP-091', trigger: 'input',  element: 'input[search]',      process: 'MQC-PRC-062', outcome: 'Filters FULL_REGISTRY by ID, name, path, description, domain, type' },
  { id: 'MQC-INT-159', label: 'Type filter button',        component: 'MQC-CMP-091', trigger: 'click',  element: 'button[type-filter]', outcome: 'Toggles type in selectedTypes Set — filters node list to that type' },
  { id: 'MQC-INT-160', label: 'Status filter dropdown',    component: 'MQC-CMP-091', trigger: 'change', element: 'select[status]',     outcome: 'Filters registry to selectedStatus (stable | watch | hot | protected | demo-only)' },
  { id: 'MQC-INT-161', label: 'Clear all filters button',  component: 'MQC-CMP-091', trigger: 'click',  element: 'button[clear]',      outcome: 'Resets selectedTypes, selectedStatus, and search to defaults' },
  { id: 'MQC-INT-162', label: 'Node row click',            component: 'MQC-CMP-091', trigger: 'click',  element: 'div[node-row]',      outcome: 'Opens node detail panel (or closes if same node clicked)' },
  { id: 'MQC-INT-163', label: 'Node ID copy ⎘',           component: 'MQC-CMP-091', trigger: 'click',  element: 'span[copy-id]',      outcome: 'Copies MQC-NNN-NNN ID to clipboard, shows ✓ for 1.5s' },
  { id: 'MQC-INT-164', label: 'Dependency node click',     component: 'MQC-CMP-091', trigger: 'click',  element: 'div[dep-node]',      process: 'MQC-PRC-062', outcome: 'Navigates to dep node detail, clears type/status filter if needed' },
  { id: 'MQC-INT-165', label: 'Show Upstream button',      component: 'MQC-CMP-091', trigger: 'click',  element: 'button[upstream]',   process: 'MQC-PRC-062', outcome: 'Expands transitive upstream dependency chips (traceUpstream)' },
  { id: 'MQC-INT-166', label: 'Show Downstream button',    component: 'MQC-CMP-091', trigger: 'click',  element: 'button[downstream]', process: 'MQC-PRC-062', outcome: 'Expands downstream dependent chips (traceDownstream)' },
  { id: 'MQC-INT-167', label: 'Registry tab switch',       component: 'MQC-CMP-091', trigger: 'click',  element: 'button[tab]',        outcome: 'Switches between Node Registry | Bug Patterns | KV Directory | Stats tabs' },
  { id: 'MQC-INT-168', label: 'Bug pattern node click',    component: 'MQC-CMP-091', trigger: 'click',  element: 'div[bug-node]',      outcome: 'Navigates to affected node in registry' },
  { id: 'MQC-INT-169', label: 'Node detail close ×',       component: 'MQC-CMP-091', trigger: 'click',  element: 'button[close]',      outcome: 'Closes node detail panel, deselects selectedId' },

  // ── B25. KEYBOARD SHORTCUTS (team dashboard) ──────────────────────────────

  { id: 'MQC-INT-170', label: '⌘K — Open Command Palette', component: 'MQC-CMP-084', trigger: 'keydown', element: 'keyboard', process: 'MQC-PRC-060', outcome: 'CommandPalette opens', shortcut: '⌘K / Ctrl+K' },
  { id: 'MQC-INT-171', label: '⌘/ — Show Keyboard Shortcuts', component: 'MQC-CMP-084', trigger: 'keydown', element: 'keyboard', outcome: 'KeyboardShortcutsHelp dialog opens', shortcut: '⌘/ / Ctrl+/' },
  { id: 'MQC-INT-172', label: '? — Show Keyboard Shortcuts', component: 'MQC-CMP-084', trigger: 'keydown', element: 'keyboard', outcome: 'KeyboardShortcutsHelp dialog opens', shortcut: '?' },
  { id: 'MQC-INT-173', label: '⌘B — Toggle Sidebar',       component: 'MQC-CMP-084', trigger: 'keydown', element: 'keyboard', process: 'MQC-PRC-061', outcome: 'sidebarCollapsed toggled in DashboardContext', shortcut: '⌘B / Ctrl+B' },
  { id: 'MQC-INT-174', label: '⌘1 — Go to Dashboard',      component: 'MQC-CMP-084', trigger: 'keydown', element: 'keyboard', outcome: 'setCurrentPage("dashboard")', shortcut: '⌘1 / Ctrl+1' },
  { id: 'MQC-INT-175', label: '⌘2 — Go to CORTEX',         component: 'MQC-CMP-084', trigger: 'keydown', element: 'keyboard', outcome: 'setCurrentPage("cortex")', shortcut: '⌘2 / Ctrl+2' },
  { id: 'MQC-INT-176', label: '⌘3 — Go to Team',           component: 'MQC-CMP-084', trigger: 'keydown', element: 'keyboard', outcome: 'setCurrentPage("team")', shortcut: '⌘3 / Ctrl+3' },
  { id: 'MQC-INT-177', label: '⌘4 — Go to Settings',       component: 'MQC-CMP-084', trigger: 'keydown', element: 'keyboard', outcome: 'setCurrentPage("settings")', shortcut: '⌘4 / Ctrl+4' },

  // ── B26. MISC UI ──────────────────────────────────────────────────────────

  { id: 'MQC-INT-178', label: 'Win Celebration dismiss ×',  component: 'MQC-CMP-090', trigger: 'click',  element: 'button[dismiss]',    outcome: 'Closes WinCelebration animation overlay' },
  { id: 'MQC-INT-179', label: 'Kanban alert toast dismiss ×', component: 'MQC-CMP-041', trigger: 'click', element: 'button[dismiss]',  outcome: 'Removes toast notification from KanbanAlertToastStack' },
  { id: 'MQC-INT-180', label: 'Offline banner (display only)', component: 'MQC-CMP-051', trigger: 'hover', element: 'div[banner]',     outcome: 'Display only — no action. Shows when useOnlineStatus() returns false' },
  { id: 'MQC-INT-181', label: 'Progress modal close ×',    component: 'MQC-CMP-056', trigger: 'click',  element: 'button[close]',      outcome: 'Closes ProgressModal (only if progress is complete or user force-closes)' },
  { id: 'MQC-INT-182', label: 'Error boundary Try Again',  component: 'MQC-CMP-021', trigger: 'click',  element: 'button[retry]',      process: 'MQC-PRC-064', outcome: 'Calls this.setState({hasError: false}) to re-attempt render' },
  { id: 'MQC-INT-183', label: 'Instant Booking CTA',       component: 'MQC-CMP-039', trigger: 'click',  element: 'button[book]',       outcome: 'Opens Calendly embed or fires onBookCall callback from InstantBooking' },
  { id: 'MQC-INT-184', label: 'InlineAI trigger button',   component: 'MQC-CMP-040', trigger: 'click',  element: 'button[inline-ai]',  outcome: 'Opens inline AI suggestion panel for the current context element' },
  { id: 'MQC-INT-185', label: 'Outcome logging modal submit', component: 'MQC-CMP-055', trigger: 'submit', element: 'button[log-outcome]', process: 'MQC-PRC-037', apiCall: 'MQC-API-048', outcome: 'POST /submissions/:id/outcome — deal outcome stored' },

];

// ============================================================================
// SUMMARY STATS
// ============================================================================

export const PROCESS_STATS = {
  total: PROCESSES.length,
  byDomain: PROCESSES.reduce<Record<string, number>>((acc, p) => {
    acc[p.domain] = (acc[p.domain] || 0) + 1;
    return acc;
  }, {}),
  byStatus: PROCESSES.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {}),
  featureFlagged: PROCESSES.filter(p => !!p.featureFlag).length,
};

export const INTERACTION_STATS = {
  total: INTERACTIONS.length,
  byTrigger: INTERACTIONS.reduce<Record<string, number>>((acc, i) => {
    acc[i.trigger] = (acc[i.trigger] || 0) + 1;
    return acc;
  }, {}),
  withProcess: INTERACTIONS.filter(i => !!i.process).length,
  withApiCall: INTERACTIONS.filter(i => !!i.apiCall).length,
  withShortcut: INTERACTIONS.filter(i => !!i.shortcut).length,
};

// Lookup maps
export const PROCESSES_BY_ID: Record<string, MQCProcess> = Object.fromEntries(
  PROCESSES.map(p => [p.id, p])
);
export const INTERACTIONS_BY_ID: Record<string, MQCInteraction> = Object.fromEntries(
  INTERACTIONS.map(i => [i.id, i])
);

// Get all interactions for a given process
export function getInteractionsForProcess(processId: string): MQCInteraction[] {
  return INTERACTIONS.filter(i => i.process === processId);
}

// Get all interactions for a given component
export function getInteractionsForComponent(componentId: string): MQCInteraction[] {
  return INTERACTIONS.filter(i => i.component === componentId);
}

// Get all processes that involve a specific node
export function getProcessesForNode(nodeId: string): MQCProcess[] {
  return PROCESSES.filter(p => p.steps.includes(nodeId));
}
