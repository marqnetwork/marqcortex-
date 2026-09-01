# MARQ Cortex — ARCHITECT (read this first)

> **Root pointer & canonical map.** This file lives at the repo root (`ARCHITECT.md`). Agents and developers: read this before exploring the codebase. Jump to cited paths directly; open `src/system/manifest.ts` only for node IDs or dependency graphs.
>
> **Related:** machine snapshot → `architecture/system_map.json` · node registry → `src/system/manifest.ts`

**Last verified:** 2026-07-31 · **Manifest:** `src/system/manifest.ts` v2.1.0 · **Runtime:** LIVE (`BACKEND_INTEGRATION` via `.env.local`)

---

## Agent entry points (read before coding)

| Order | Document | Purpose |
|-------|----------|---------|
| 1 | `MARQ_CORTEX_CONSTITUTION.md` | Locked operating principles (v1.1) |
| 2 | `prompts/MARQ-CLAUDE-AGENT-SYSTEM-PROMPT-v1.0.md` | Permanent MARQ Claude Agent operating contract (v1.0) |
| 3 | `ARCHITECT.md` (this file) | Repository map, golden rules, task → file lookup |
| 4 | Sprint task prompt | Scoped work and acceptance criteria only |

Cursor rule `.cursor/rules/read-marq-agent-prompt.mdc` enforces this sequence. Sprint prompts do not override the system prompt.

**AI Control Plane (AI-01 Batch 1):** `supabase/functions/server/ai/index.ts` — read the module header first  
**AI Administration (AI-01 Batch 2):** `supabase/functions/server/ai/admin/administration.ts`  
**Agent Runtime (AI-01 Batch 3A):** `supabase/functions/server/ai/agents/agentRuntime.ts` — read the module header first  
**Workflow Runtime (AI-01 Batch 3B):** `supabase/functions/server/ai/workflows/workflowRuntime.ts` — read the module header first  
**Business Agent #1 (AI-01 Batch 3B):** `supabase/functions/server/ai/business/diagnostic/index.ts` — certified; activation is `AI_DIAGNOSTIC_REVIEW_ENABLED`, off by default  
**AI completion reports:** `architecture/ai/AI-01-BATCH-1-COMPLETION.md` · `architecture/ai/AI-01-BATCH-2-COMPLETION.md` · `architecture/ai/AI-01-BATCH-3B-COMPLETION.md`  
**Add an AI provider or feature:** `architecture/ai/AI-PROVIDER-EXTENSION-GUIDE.md`  
**Frontend AI normalization (MCV2-S2):** `src/imports/MCV2-S2-FRONTEND-GATEWAY-NORMALIZATION.md`  
**Data platform architecture (MCV2-S3):** `src/imports/MCV2-S3-CORTEX-DATA-PLATFORM-ARCHITECTURE.md`

---

## 0. Golden rules (never break)

| Rule | Why |
|------|-----|
| Components import data **only** from `src/app/services/dataService.ts` | Single gateway; demo/live switch lives here |
| Never import `@/app/lib/api` from components | HTTP client is internal to dataService |
| Use `createHashRouter` (not browser router) | Required for iframe / Figma Make |
| Only `LandingPageRoute` is eager; all other routes lazy | Performance contract in `App.tsx` |
| Team shell: `GlobalAIChatProvider` **outer**, `DashboardProvider` **inner** | `TeamDashboardLayout.tsx` — do not collapse |
| Core engines: pure functions, no React, no LLM | Math decides; AI only narrates |
| **All AI executes through `ai/controlPlane.ts`** | One governed path: auth, tenancy, governance, audit. No bypass flag exists |
| Never call a model provider outside `ai/providers/` | Provider independence (Constitution Art. 2) |
| Never write a prompt inline — register it in `ai/prompts/catalog.ts` | Versioned, hashed, owned, reviewable |
| `pdfExport` must use dynamic `import()` | jsPDF is heavy |
| Search inputs use `useDebounce` from `usePerformance.tsx` | Performance |
| New files: add manifest ID in `manifest.ts` **before** implementation | `MQC-{TYPE}-{NNN}` |
| Client portal tab order is fixed (see §9) | Product decision |

**Core rule:** *Math decides priority. LLM only explains decisions.*

---

## 1. Product snapshot

| Field | Value |
|-------|-------|
| Name | MARQ Cortex — AI Readiness Diagnostic Platform |
| Stack | React 18 + TypeScript + Vite 6 + Tailwind v4 + react-router v7 |
| Router | Hash (`#/path`) — `src/app/App.tsx` |
| Theme | Eclipse dark `#0A0A0F` |
| Backend | Supabase Edge Functions (Deno) + Hono — `supabase/functions/server/` |
| Supabase project | `oqybniefkbppptfatoae` — `.env.local` + `supabase/.temp/project-ref` |
| Dev server | `npm run dev` → `http://localhost:5173` (`vite.config.ts`: `host: true`) |
| Feature flag | `src/config/features.ts` → `VITE_BACKEND_INTEGRATION` in `.env.local` |

---

## 2. Directory map

```
cortex/
├── ARCHITECT.md                  # ← THIS FILE (root map + agent entry point)
├── prompts/
│   └── MARQ-CLAUDE-AGENT-SYSTEM-PROMPT-v1.0.md  # Agent operating contract
├── index.html                    # Shell → /src/main.tsx
├── vite.config.ts                # @ alias, dev server host:true port 5173
├── architecture/
│   └── system_map.json           # Machine-readable snapshot
├── src/
│   ├── main.tsx                  # Bootstrap, error fallbacks, lazy App import
│   ├── app/
│   │   ├── App.tsx               # Hash router + lazy route factory
│   │   ├── pages/                # Route wrappers (10 files)
│   │   ├── components/           # Domain UI (~89) + ui/ (~49 shadcn)
│   │   ├── core/                 # 35 deterministic engines + index.ts
│   │   ├── services/             # dataService.ts, cortexDataService.ts
│   │   ├── contexts/             # App, Dashboard, GlobalAIChat
│   │   ├── hooks/                # keyboard, online, debounce
│   │   ├── lib/                  # api.ts, supabase.ts
│   │   ├── types/                # 7 domain type files
│   │   └── utils/                # scoring, demo, PDF, registry legacy
│   ├── config/                   # features.ts, api.config.ts, runtime.ts
│   ├── system/                   # manifest.ts (158 nodes), validate.ts
│   ├── styles/                   # index.css, theme.css, tailwind.css
│   └── imports/                  # Specs, schemas, static assets
├── supabase/functions/server/    # Hono API (68 routes)
├── utils/supabase/info.tsx       # projectId, publicAnonKey
└── memory/                       # failure_library, regression_cases
```

---

## 3. Entry points

| File | Role |
|------|------|
| `index.html` | `#root` + `/src/main.tsx` |
| `src/main.tsx` | CSS, mount guard, global error UI, dynamic `import('@/app/App')` |
| `src/app/App.tsx` | `createHashRouter`, `makeLazy()` per route |
| `src/app/pages/RootLayout.tsx` | `AppProvider` → `ErrorBoundary` → `OfflineBanner` → outlet |

---

## 4. Routes (hash)

| URL | Page file | Main component | Load |
|-----|-----------|----------------|------|
| `#/` | `pages/LandingPageRoute.tsx` | `LandingPage` | **Eager** |
| `#/get-started` | `pages/LeadMagnetRoute.tsx` | `LeadMagnetCapture` | Lazy |
| `#/diagnostic` | `pages/DiagnosticRoute.tsx` | `DiagnosticForm` | Lazy |
| `#/score` | `pages/ScoreRoute.tsx` | `ScorePage` | Lazy |
| `#/team/login` | `pages/TeamLoginRoute.tsx` | `TeamLogin` | Lazy |
| `#/team/dashboard` | `pages/TeamDashboardRoute.tsx` | `TeamDashboardNew` | Lazy |
| `#/team/execution` | `pages/ExecutionRoute.tsx` | `ExecutionDashboard` | Lazy |
| `#/client/login` | `pages/ClientLoginRoute.tsx` | `ClientLogin` | Lazy |
| `#/client/portal` | `pages/ClientPortalRoute.tsx` | `ClientPortal` | Lazy |
| `#/architecture` | *(component route)* | `SystemArchitecture` | Lazy |
| `#/registry` | *(component route)* | `RegistryViewer` | Lazy |
| `#/*` | — | `NotFound` | Eager |

**Auth guards:**
- Team: `TeamDashboardRoute` → needs `teamAccessToken` in `AppContext` (8h TTL)
- Client: `ClientPortalRoute` → needs `clientSession` in `AppContext`

---

## 5. Task → file lookup (use this instead of searching)

| I need to… | Go to |
|------------|-------|
| Change routing / add route | `src/app/App.tsx` + new `pages/*Route.tsx` |
| Change feature flags / demo vs live | `src/config/features.ts` |
| Change any API call from UI | `src/app/services/dataService.ts` (not api.ts) |
| Change HTTP client / endpoints | `src/app/lib/api.ts` + `src/config/api.config.ts` |
| Change team login / session | `AppContext.tsx`, `TeamLogin.tsx`, `dataService.teamLogin` |
| Change client portal login | `ClientLogin.tsx`, `dataService.verifyClientEmail` |
| Change diagnostic questions | `utils/questionRegistry.ts`, `DiagnosticForm.tsx` |
| Change instant score (public funnel) | `utils/instantScoring.ts`, `ScorePage.tsx` |
| Change authoritative scoring | `core/scoringEngine.ts`, `core/runCortexEngine` in `core/index.ts` |
| Change ROI math | `core/roiEngine.ts`, `DCFPanel`, `MonteCarloPanel`, `ScenarioPanel` |
| Change proposal flow | `ProposalDraftEditor`, `ProposalControlPanel`, `core/proposalGateEngine.ts` |
| Change client portal tabs | `ClientPortal.tsx` (tab order fixed) |
| Change team dashboard nav | `TeamDashboardLayout.tsx`, `TeamDashboardNew.tsx` |
| Change CORTEX AI chat | `GlobalAIChat.tsx`, `GlobalAIChatContext.tsx`, `dataService.chatWithAI` |
| Change block AI assist | `BlockRegistryPanel.tsx`, `aiAssistEngine.ts`, `dataService.blockAIAssist` |
| Change Cortex Copilot | `CopilotPanel.tsx`, `copilotEngine.ts`, `dataService.copilotInterpret` |
| Change portfolio narrative | `CortexChatPanel.tsx`, `dataService.generateCortexNarrative` |
| Change submission AI analysis | `CortexDashboard.tsx`, `dataService.analyzeSubmission` |
| Change pipeline/kanban | `PipelineKanban.tsx`, `dataService.getPipelinePositions` |
| Change PDF export | `utils/pdfExport.ts` (dynamic import only) |
| Change registry / node IDs | `src/system/manifest.ts`, `RegistryViewer.tsx` |
| Change backend routes | `supabase/functions/server/index.tsx` |
| Fix localhost dev server | `vite.config.ts` (`host: true`, port 5173) |
| See all node IDs + deps | `src/system/manifest.ts` |
| Agent operating rules | `prompts/MARQ-CLAUDE-AGENT-SYSTEM-PROMPT-v1.0.md` |
| Add or change an AI capability | `supabase/functions/server/ai/features/` + register in `features/index.ts` |
| Change an AI prompt | `supabase/functions/server/ai/prompts/catalog.ts` (bump the version — never edit in place) |
| Add an AI provider | `supabase/functions/server/ai/providers/` + `architecture/ai/AI-PROVIDER-EXTENSION-GUIDE.md` |
| Change AI limits, budget or capability grants | `ai/policy/featureCatalog.ts`, `ai/security/actor.ts` (ROLE_CAPABILITIES) |
| Change AI governance rules | `ai/governance/` (input guard, output guard, redaction, fact lock) |
| AI Control Plane tests | `npm run test:ai` · security subset: `npm run test:security` |
| Register an agent | `supabase/functions/server/ai/agents/registry/agentRegistry.ts` — definitions are data, validated at registration; the production registry ships empty |
| Register an agent tool | `supabase/functions/server/ai/agents/tools/toolRegistry.ts` + a definition beside `tools/mockTools.ts` |
| Change agent limits, approvals or handoff targets | the agent's definition — never the orchestrator |
| Change agent run RBAC | `ai/agents/service/agentRbac.ts` (AGENT_ROLE_CAPABILITIES) |
| Add an agent model profile | `ai/agents/runtime/defaultProfiles.ts` + a registered feature in `ai/features/` |
| Agent runtime verification | `node --experimental-strip-types scripts/agent-runtime-verify.ts` (mock mode, no vendor calls) |
| Diagnose agent runs in production | `GET /ai/agents/overview` · `/ai/agents/runs` · `/ai/agents/approvals` · `/ai/agents/audit` |
| Register a workflow | `supabase/functions/server/ai/workflows/registry/workflowRegistry.ts` — definitions are data, validated at registration; there is no API that can define one |
| Change workflow run RBAC | `ai/workflows/service/workflowRbac.ts` (WORKFLOW_ROLE_CAPABILITIES) |
| Start / approve / cancel a workflow run | `POST /ai/workflows/runs` · `/ai/workflows/approvals/:approvalId` · `/ai/workflows/runs/:runId/cancel` |
| Diagnose workflow runs in production | `GET /ai/workflows/overview` · `/ai/workflows/runs` · `/ai/workflows/approvals` · `/ai/workflows/registry` |
| Activate the diagnostic readiness review | `AI_DIAGNOSTIC_REVIEW_ENABLED` (default OFF) + durable KV + an injected submission source — see `ai/bootstrap.ts` |
| Change what Business Agent #1 may do | its own definition in `ai/business/diagnostic/agent/readinessManagerAgent.ts` — re-certification is a human decision, not a config change |
| Workflow + business capability verification | `npm run verify:diagnostic` — drives the certified agent, its five tools and the review workflow over a real workflow runtime, agent runtime and control plane (mock mode, no vendor calls) |
| Diagnostic capability tests | `npm run test:diagnostic` |
| Diagnose AI in production | `GET /ai/health` · `GET /ai/metrics` · `GET /ai/audit` · `GET /ai/catalog` |
| Frontend AI architecture (MCV2-S2) | `src/imports/MCV2-S2-FRONTEND-GATEWAY-NORMALIZATION.md` |
| Data platform architecture (MCV2-S3) | `src/imports/MCV2-S3-CORTEX-DATA-PLATFORM-ARCHITECTURE.md` |
| Tenancy migrations (MCV2-S4) | `supabase/migrations/20260711050000_cortex_tenancy_foundation.sql` |
| Diagnostic migrations (MCV2-S5) | `supabase/migrations/20260714050000_cortex_diagnostic_foundation.sql` |
| Diagnostic repositories | `supabase/functions/server/repositories/*Repository.ts` |
| KV → SQL mapping (MCV2-S5) | `architecture/database/MCV2-S5-KV-RELATIONAL-MAPPING.md` |
| Database tests | `tests/database/` · `npm run test:database` |
| Database ERD / table catalog | `architecture/database/MCV2-S3-*.md` |
| KV → SQL migration roadmap | `architecture/database/MCV2-S3-MIGRATION-ROADMAP.md` |
| KV backfill & reconciliation (MCV2-S6.1) | `architecture/database/MCV2-S6.1-PLAN-003-KV-BACKFILL-RECONCILIATION-ARCHITECTURE.md` |
| Migration infrastructure (MCV2-S6.2) | `supabase/migrations/20260713184931_migration_infrastructure.sql` |
| Migration engine / CLI | `supabase/functions/server/migration/` · `scripts/migration/cli.ts` |
| Migration tests | `npm run test:migration` |
| S6.2 completion / rollback | `architecture/database/MCV2-S6.2-IMPLEMENT-004-COMPLETION.md` · `MCV2-S6.2-ROLLBACK-GUIDE.md` |
| Constitution | `MARQ_CORTEX_CONSTITUTION.md` |
| S6.3 validation | `architecture/database/MCV2-S6.3-VALIDATE-005-COMPLETION.md` |

---

## 6. Data platform (MCV2-S3/S4/S5)

| Layer | Current (PROVEN) | Sprint status |
|-------|------------------|---------------|
| Production store | `kv_store_324f4fbe` — **still authoritative** | Unchanged |
| Relational foundation | Tenancy: **6 tables** (S4) + Diagnostic: **13 tables** (S5) | Migrations in repo |
| Migration infrastructure | **4 tables** (S6.2): runs, checkpoints, quarantine, reconciliation_log | Applied remote |
| Migration engine | CLI + `supabase/functions/server/migration/` | Lead/contact slice only |
| Access path | Edge `index.tsx` → `kv_store.tsx` | + repositories (not wired to routes) |
| Team auth | Supabase Auth + `user_metadata.teamRole` | + `organization_memberships` (seed manual) |
| RLS helpers | `cortex.*` functions | S4 tenancy + S5 diagnostic helpers |

**Migrations:** `supabase/migrations/` · **Rollback:** `supabase/migrations/rollbacks/`  
**Tests:** `npm run test:database` · **Setup:** `architecture/database/LOCAL_DATABASE_SETUP.md`  
**Completion:** `architecture/database/MCV2-S4-IMPLEMENT-001-COMPLETION.md` · `MCV2-S5-IMPLEMENT-002-COMPLETION.md`

**Golden rule during migration:** KV remains authoritative until per-domain Phase 5 cutover.

---

## 7. Data flow

```
PUBLIC FUNNEL
  Landing → LeadMagnet → DiagnosticForm → instantScoring.ts
    → AppContext.scoreResult → ScorePage
    → (live) dataService.createSubmission

STANDARD PATH (all components)
  Component → dataService.ts → [demoData | api.ts] → Edge Function → KV

CORTEX INTELLIGENCE (canonical path — AI-01 Batch 1)
  Component → dataService.ts → api.ts → Edge Function → aiRoutes → AI Control Plane → Provider

AGENT RUNTIME (canonical path — AI-01 Batch 3A)
  Caller → agentRuntimeRoutes → agent HTTP adapter (authorise, then dispatch)
    → Agent Runtime Service (RBAC, tenant scope, read models)
    → Agent Orchestrator (registry → state machine → proposal validation →
      limits → token preflight → cost preflight → checkpoint → persist)
    → model step: control plane bridge → AI Control Plane → provider
    → tool step: tool gateway → deterministic tool
    → handoff step: agent registry → receiving agent
  AGENTS PROPOSE. THE ORCHESTRATOR DECIDES. THE CONTROL PLANE EXECUTES.
  The agent runtime is not a second AI execution path: it has no provider
  import, no credential and exactly one module that can reach a model.

WORKFLOW RUNTIME (canonical path — AI-01 Batch 3B)
  AIAdministrationConsole → workflowRuntimeService.ts → Edge Function
    → workflowRuntimeRoutes → workflow HTTP adapter (bind operation, map request)
    → Workflow Runtime Service (authenticate, resolve actor + tenant, enforce
      capability, project read models)
    → Workflow Orchestrator (registry → plan → state machine → data flow →
      checkpoint → persist by compare-and-swap)
    → agent node: agentNodePort → Agent Orchestrator → the path above
    → approval node: workflow approval gate → a durable request a person answers
  The workflow runtime is not a third execution path: it has no provider import,
  no control plane and exactly one module that can reach an agent.

AI ADMINISTRATION (canonical path — AI-01 Batch 2)
  AIAdministrationConsole → aiAdminService.ts → Edge Function → aiAdminRoutes
    → admin HTTP adapter (authorise, then dispatch) → AI Administration service
    → control plane settings overlay / provider registry / spend ledger
  The administration layer never reaches a provider and never executes AI.

  Inside the control plane (every AI request, no exceptions):
    aiGuard        contract version → feature → payload size → authentication →
                   organization → actor → body validation → rate limit
    policyEngine   feature enabled → actor type → channel → capability → budget
    pipeline       prompt render → input guard (PII, injection) → provider select →
                   invoke (timeout, retry, circuit, failover) → output guard →
                   parse → fact lock
    orchestrator   budget charge → audit record → metrics → structured log → events

  Features:
    AI Chat        → dataService.chatWithAI            → cortex.chat
    Narrative      → dataService.generateCortexNarrative → cortex.narrative
    Analysis       → dataService.analyzeSubmission     → cortex.analysis
    Block Assist   → dataService.blockAIAssist         → cortex.block_assist
    Copilot        → dataService.copilotInterpret      → cortex.copilot_plan
    Section Copilot→ dataService.proposalSectionCopilot → cortex.section_copilot
  Auth: teamAccessToken from AppContext. Every AI feature requires an authenticated
        team member — the anon key is no longer sufficient for any of them.
  Demo: dataService isDemo() — mock responses, no edge fetch from engines

LEGACY CORTEX DATA (portfolio mock — not LLM)
  CortexDashboard → cortexDataService → mockCortexData / generator

DETERMINISTIC PIPELINE
  Answers → runCortexEngine() in core/index.ts
    → inputNormalizer → scoringEngine → decisionEngine → templateAssembler (+ ROI)

TEAM DASHBOARD STATE
  TeamDashboardLayout: GlobalAIChatProvider (outer) → DashboardProvider (inner)
  DashboardContext persists filters/search to localStorage
```

---

## 8. Auth & sessions

| Actor | Mechanism | Storage key | TTL |
|-------|-----------|-------------|-----|
| Team | Email + password → token | `marq_cortex_team_session` | 8h (`marq_cortex_team_session_expiry`) |
| Client | Email verify → submissionId + optional sessionToken | `marq_cortex_client_session` | See AppContext |

**Demo team creds** (`dataService.ts`): `admin@marqcortex.com` / `CortexAdmin2026!`

**Session context:** `src/app/contexts/AppContext.tsx`

---

## 9. Team dashboard panels (`TeamDashboardNew.tsx`)

Internal `PageView` state (not hash routes except execution/architecture):

| PageView | Component |
|----------|-----------|
| `dashboard` | `TeamHomeDashboard` |
| `cortex` | `CortexDashboard` |
| `team` | `TeamManagement` |
| `settings` | `SettingsPage` |
| `reviewer` | `ReviewerDashboard` |
| `analytics` | `AnalyticsDashboard` |
| `emails` | `EmailNurturePanel` |
| `revenue` | `RevenueIntelligenceDashboard` |
| `mapping` | `MappingEnginePanel` |
| `execution` | navigates to `#/team/execution` |
| `architecture` | navigates to `#/architecture` |

Shell: `TeamDashboardLayout.tsx` — sidebar, command palette, notifications, global AI chat.

---

## 10. Client portal tabs (`ClientPortal.tsx`)

**Fixed order — do not reorder without explicit instruction:**

1. Your Status → `ClientReportDashboard`
2. Solution → `ClientSolutionView`
3. Readiness Report → `ClientReadinessReport` (locked until report ready)
4. Schedule a Call → `InstantBooking` / `MeetingScheduler`
5. Proposal → `ProposalViewer`
6. Messages → `ClientMessaging`
7. Your Assessment → `ClientQAReview`
8. Strategic Report

---

## 11. Core engines (`src/app/core/`)

**Orchestrator:** `runCortexEngine()` in `core/index.ts`  
**Rule:** Pure functions. No React. No side effects. No LLM.

| Engine | File | Domain |
|--------|------|--------|
| inputNormalizer | `inputNormalizer.ts` | Diagnostic |
| scoringEngine | `scoringEngine.ts` | Diagnostic (**load-bearing**) |
| decisionEngine | `decisionEngine.ts` | Diagnostic |
| templateAssembler | `templateAssembler.ts` | Execution |
| roiEngine | `roiEngine.ts` | ROI (**load-bearing**) |
| cashflowEngine | `cashflowEngine.ts` | ROI |
| dcfEngine | `dcfEngine.ts` | ROI |
| irrEngine | `irrEngine.ts` | ROI |
| monteCarloEngine | `monteCarloEngine.ts` | ROI |
| scenarioEngine | `scenarioEngine.ts` | ROI |
| costEngine | `costEngine.ts` | ROI |
| proposalGateEngine | `proposalGateEngine.ts` | Proposal |
| scopeEngine | `scopeEngine.ts` | Proposal |
| contractEngine | `contractEngine.ts` | Proposal |
| executionEngine | `executionEngine.ts` | Execution |
| blockEngine | `blockEngine.ts` | Execution |
| mappingEngine | `mappingEngine.ts` | Execution |
| dependencyEngine | `dependencyEngine.ts` | Execution |
| versionEngine | `versionEngine.ts` | Execution |
| snapshotEngine | `snapshotEngine.ts` | Execution |
| sprintTemplates | `sprintTemplates.ts` | Execution |
| changeImpactEngine | `changeImpactEngine.ts` | Execution |
| consistencyValidator | `consistencyValidator.ts` | System |
| roleEngine | `roleEngine.ts` | Auth |
| portfolioEngine | `portfolioEngine.ts` | Analytics |
| dashboardAggregator | `dashboardAggregator.ts` | Analytics |
| qbrEngine | `qbrEngine.ts` | Analytics |
| roiTrackingEngine | `roiTrackingEngine.ts` | ROI |
| roiActualsEngine | `roiActualsEngine.ts` | ROI |
| crmEngine | `crmEngine.ts` | Comms |
| exportEngine | `exportEngine.ts` | Reviewer |
| copilotEngine | `copilotEngine.ts` | AI |
| aiAssistEngine | `aiAssistEngine.ts` | AI |
| objectionEngine | `objectionEngine.ts` | AI |

---

## 12. Services

### Frontend gateway — `dataService.ts`

Grouped exports (all UI must use these):

- **Lead:** `saveLead`, `saveExitIntentLead`
- **Auth:** `teamLogin`, `verifyClientEmail`
- **Submissions:** `createSubmission`, `getSubmissions`, `updateSubmissionStatus`, `bulkUpdateSubmissions`
- **Client portal:** `getClientSubmission`, `getClientReport`, `getClientMessages`, `postClientMessage`, `getClientProposal`, `respondToProposal`
- **Team comms:** `getTeamMessages`, `postTeamReply`
- **Proposals:** `getProposal`, `saveProposal`, `sendProposal`, annotations CRUD
- **Engagement:** `trackEngagement`, `getEngagementLog`, `getEngagementSummary`, `getEngagementAnalytics`
- **Analytics:** `getAnalytics`
- **Notifications:** `getNotifications`, `markNotificationsRead`
- **Notes:** `getNotes`, `addNote`, `deleteNote`
- **Team admin:** `getTeamMembers`, `inviteTeamMember`, `updateTeamMember`, `removeTeamMember`
- **Settings:** `getPlatformSettings`, `savePlatformSettings`
- **CORTEX AI:** `getCortexAnalysis`, `analyzeSubmission`, `generateCortexNarrative`, `chatWithAI`, `blockAIAssist`, `copilotInterpret`
- **Pipeline:** `getPipelinePositions`, `savePipelinePosition`, `resetPipelinePositions`, column capacities
- **Email queue:** `enqueueEmails`, `getEmailQueue`, `updateEmailStatus`
- **Health:** `ping`, `healthCheck`, `testAuth`, `getDiagnostics`
- **Helpers:** `generateSolutionsFromDiagnostic`, `generateClientReport`, `getDemoSubmissions`, `isDemo` pattern via `!BACKEND_INTEGRATION`

### CORTEX data — `cortexDataService.ts`
CORTEX-specific reads; avoids circular deps with `cortexDataGenerator.ts`.

### Backend — `supabase/functions/server/`
| File | Role |
|------|------|
| `index.tsx` | Hono app, CORS, transport rate limit, non-AI routes |
| `kv_store.tsx` | KV persistence |
| `aiRoutes.ts` | AI HTTP routes (MQC-SVC-045) — binds Hono to the control plane |
| `ai/controlPlane.ts` | **AI Control Plane** (MQC-SVC-010) — the single governed AI execution path |
| `ai/index.ts` | Public surface. Import from here, never from an internal `ai/` path |
| `ai/features/` | The six product AI features (MQC-SVC-003/004/005/006/007/017) plus the governed agent step (MQC-SVC-075) |
| `ai/security/` | AI Guard, rate limiter, tenancy, actor, validation |
| `ai/policy/` | Feature catalog, policy engine, budget engine |
| `ai/prompts/` | Prompt registry + the canonical prompt catalog |
| `ai/providers/` | OpenAI, Anthropic, mock adapters + registry, selector, circuit, retry, timeout |
| `ai/governance/` | Input guard, output guard, PII redaction, fact lock |
| `ai/observability/` | Audit, metrics, events, health, structured logger |
| `ai/admin/` | AI Administration (AI-01 Batch 2) — settings, RBAC, providers, budget, change trail |
| `ai/agents/` | **Agent Runtime** (AI-01 Batch 3A, MQC-SVC-056) — registry, state machine, orchestrator, tools, approvals, limits, ledgers, durable runs |
| `agentRuntimeRoutes.ts` | Agent runtime HTTP routes (MQC-SVC-074) |
| `ai/workflows/` | **Workflow Runtime** (AI-01 Batch 3B) — registry, planner, validation, orchestrator, checkpoints, retries, parallel branches, approval gate, durable runs |
| `ai/business/diagnostic/` | The first business capability — the readiness manager agent, its five tools and the review workflow. Certified; activated only by `AI_DIAGNOSTIC_REVIEW_ENABLED` |
| `workflowRuntimeRoutes.ts` | Workflow runtime HTTP routes |
| `emailService.ts` | Resend emails |
| `revenueSnapshot.ts` | Deterministic deal snapshots (no LLM) |

**AI Control Plane env (Edge secrets):** see §12.1 below and `.env.example`.

### 12.1 AI Control Plane environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `OPENAI_API_KEY` | — | OpenAI credentials. Absent → provider skipped by the selector |
| `ANTHROPIC_API_KEY` | — | Anthropic credentials. Absent → provider skipped |
| `AI_PROVIDER_PREFERENCE` | `openai,anthropic,mock` | Selection order |
| `AI_FALLBACK_PROVIDER` | — | Forced last-resort provider |
| `AI_FAILOVER_ENABLED` | `true` | Try the next provider on a failoverable error |
| `AI_CIRCUIT_FAILURE_THRESHOLD` | `5` | Consecutive faults before the circuit opens |
| `AI_CIRCUIT_OPEN_MS` | `30000` | Circuit cool-down |
| `AI_CIRCUIT_HALF_OPEN_SUCCESSES` | `2` | Probes needed to close the circuit |
| `AI_RETRY_BASE_DELAY_MS` | `250` | Exponential backoff base |
| `AI_RETRY_MAX_DELAY_MS` | `4000` | Backoff ceiling |
| `AI_RETRY_JITTER_PERCENT` | `20` | Jitter proportion |
| `AI_BUDGET_ORG_DAILY_MICRO_USD` | `50000000` | Organization daily ceiling (µUSD) |
| `AI_BUDGET_ACTOR_DAILY_MICRO_USD` | `5000000` | Per-actor daily ceiling (µUSD) |
| `AI_BUDGET_ALERT_PERCENT` | `80` | Threshold that raises a budget event |
| `AI_BUDGET_ENFORCE` | `true` | Refuse execution once the ceiling is reached |
| `AI_AUDIT_DURABLE` | `true` | Write audit records to KV as well as the buffer |
| `AI_AUDIT_RETENTION_DAYS` | `400` | Retention stamped on each durable record |
| `AI_AUDIT_BUFFER_SIZE` | `200` | In-memory ring buffer for `GET /ai/audit` |
| `AI_LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `AI_STRUCTURED_LOGS` | `true` | One JSON line per record |
| `AI_METRICS_BUFFER_SIZE` | `500` | Metric series cap |
| `AI_REDACTION_ENABLED` | `true` | Master switch for PII redaction |
| `AI_STRICT_INPUT_GUARD` | `false` | Reject rather than redact when input carries PII |
| `AI_DEFAULT_ORGANIZATION_ID` | `marq-cortex` | Org for a subject with no membership |
| `AI_ORGANIZATION_ALLOW_LIST` | — | When set, only these orgs may call AI features |
| `AI_ENABLE_MOCK_PROVIDER` | `false` | Register the deterministic mock provider |
| `AI_CREDENTIAL_ENCRYPTION_KEY` | — | **Batch 4C/4D.** Base64 32-byte AES-256-GCM root key for managed provider credentials — MARQ's own and customers' alike. Absent → no credential can be STORED (the platform still runs, on environment credentials). Never in the database. Batch 4D adds **no** environment variable |
| `AI_CREDENTIAL_SNAPSHOT_TTL_MS` | `30000` | How long an isolate serves a cached NON-SECRET credential availability snapshot. Bounds the console's view only — execution decrypts on every attempt |

Every value is bounded: a malformed setting falls back to its default rather than
propagating `NaN` into a timeout or a negative ceiling into a rate limiter.

**Certified provider catalogue.** A credential turns a provider on; it does not
decide what that provider may run. The models each adapter declares ARE the
certified allow list — nothing above `ai/providers/` names a model, the selector
picks the cheapest declared model meeting a feature's requirements, and an
administrator's `modelAllowList` may only narrow that set further.

| Provider | Certified models | µUSD / 1k prompt · completion |
|----------|------------------|-------------------------------|
| `openai` | `gpt-4o-mini`, `gpt-4o` | 150 · 600  ·  2,500 · 10,000 |
| `anthropic` | `claude-haiku-4-5-20251001` | 1,000 · 5,000 |
| `mock` | `mock-standard` | 0 · 0 (never billable) |

Two consequences worth stating, because both bit during certification:

- **A declared model costs money even when it is never selected.** The spend
  guard reserves the worst case across every billable provider's FULL declared
  catalogue, so adding a dear model raises the pessimistic hold on every request
  — including requests the other vendor serves. Anthropic is certified on
  Haiku 4.5 alone for this reason (AI-01 Batch 4B); Sonnet 4.5 was withdrawn
  from the catalogue rather than left in unused.
- **Model ids are dated snapshots, not aliases.** An alias can be repointed at a
  new model version by the vendor. An audit record that names the model behind a
  completion has to stay true afterwards.

**Operator endpoints:** `GET /ai/health` (unauthenticated probe, no tenant data) ·
`GET /ai/metrics` (`ai.admin.view`) · `GET /ai/audit?limit=N` (`ai.admin.audit.read`,
**tenant-scoped**) · `GET /ai/catalog` (`ai.admin.view`).

These three used to require only a valid team token, which answers "is this a
provisioned MARQ team account?" rather than "may this account read this". The
audit route in particular returned the execution trail for every organization,
unfiltered. AI-01 Batch 4C confirmed the finding and moved all three onto the
administration capability model, with the audit read served through the
tenant-scoped `executionAudit`. See §12.5.

Base path: `/make-server-324f4fbe`

### 12.2 AI Administration (AI-01 Batch 2)

The environment table above states what the deployment **permits**. The
operational settings overlay states what is currently **in effect**, and an
authorised administrator moves it at runtime with no redeploy.

```
AI_* environment  ──►  deployment permission (immutable at runtime)
                          │
operational overlay ──►   what is in force now (versioned, persisted, audited)
                          │
control plane      ──►   reads the live value at the point of use
```

**Administrable at runtime:** AI master switch · emergency kill switch · real
provider requests · default provider · provider priority order · fallback
provider · per-provider enable/disable · model allow list · default model ·
failover · certification requirement · retry policy · workflow deadline ·
rolling daily budget ceilings and alert threshold.

**Never administrable:** the MARQ lifetime ceiling's *enforcement*, PII
redaction, the guard, governance rules and per-feature limits. Those are
deployment decisions or code, not console settings.

**The one-way rule.** Administrative action may tighten the platform's posture
freely and may loosen it only inside the envelope the deployment already
granted. `AI_ALLOW_REAL_REQUESTS=false` can never be overturned from a console:
the effective value is the AND of the environment's permission and the
administrator's choice. An administrator can always turn real requests *off*.

| Role | Grants |
|------|--------|
| **Super Admin** | Everything, including clearing lifetime spend and raising the ceiling |
| **Organization Admin** | Kill switch, settings, providers, daily budgets, all reads |
| **Team Admin** | Reads only — health, usage, cost, providers, audit |

Team Admin is read-only by design: every switch on this surface is
platform-wide, so a role that could only be exercised by affecting other tenants
would not be a safe role.

**Every mutation requires a reason**, is versioned (`configurationVersion`),
persisted to `ai:admin:settings`, and appended to a change trail that has no
update or delete operation on its interface.

| Endpoint | Method | Capability |
|----------|--------|-----------|
| `/ai/admin/overview` | GET | `ai.admin.view` |
| `/ai/admin/settings` | GET / PATCH | `ai.admin.view` / by field |
| `/ai/admin/kill-switch` | POST | `ai.admin.killswitch` |
| `/ai/admin/providers` | GET | `ai.admin.view` |
| `/ai/admin/providers/:id` | PATCH | `ai.admin.provider.write` |
| `/ai/admin/budget` | GET | `ai.admin.view` |
| `/ai/admin/budget/reset` | POST | `ai.admin.budget.reset` |
| `/ai/admin/budget/increase` | POST | `ai.admin.budget.reset` |
| `/ai/admin/usage` | GET | `ai.admin.view` |
| `/ai/admin/diagnostics` | GET | `ai.admin.view` |
| `/ai/admin/audit` | GET | `ai.admin.audit.read` |
| `/ai/admin/audit/changes` | GET | `ai.admin.audit.read` |

Console: `src/app/components/AIAdministrationConsole.tsx`, mounted as the
**AI Administration** tab of the settings page.

---


### 12.3 Agent Runtime (AI-01 Batch 3A)

| Variable | Default | Purpose |
|----------|---------|---------|
| `AGENT_MOCK_TOOLS_ENABLED` | `false` | Register the deterministic in-process tools. Off in a real deployment: a tool nobody asked for is a capability nobody reviewed |
| `AI_REQUIRE_CERTIFIED_AGENTS` | `true` | Refuse agents whose certification is not established |
| `AI_REQUIRE_CERTIFIED_TOOLS` | `true` | Refuse tools whose certification is not established |

**Certification is three switches, not one.** `AI_REQUIRE_CERTIFIED_PROVIDERS`,
`AI_REQUIRE_CERTIFIED_AGENTS` and `AI_REQUIRE_CERTIFIED_TOOLS` govern three
populations certified by different people against different contracts. They were
a single flag until an independent review found that hardening providers silently
also refused uncertified agents and tools — safe in direction, invisible in
effect. Each is now its own environment variable, its own deployment-envelope
entry and its own line in the console. The envelope rule is unchanged: an
administrator may ADD a requirement and may never lift one the deployment set.

The agent runtime takes no credentials and no provider configuration of its own.
It reads the operational settings overlay (master switch, emergency stop,
certification requirement) and the MARQ lifetime spend ledger through the
control plane, and every model step executes through
`controlPlane.execute` — so the environment that governs AI governs agents.

Durable storage needs the `kvReadByPrefix` and `kvCompareAndSwapField` ports
(backed by migration `20260804120000_kv_compare_and_swap_field.sql`). Without
them the runtime is isolate-local and says so loudly at bootstrap: runs still
execute, they simply do not survive a restart.

**No production agents ship with this batch.** The registry starts empty; a
definition registered in `bootstrap.ts` would be the inline production agent the
batch forbids, and the boundary scan asserts its absence.

| Route (prefix `/make-server-324f4fbe`) | Method | Capability |
|----------------------------------------|--------|------------|
| `/ai/agents/overview` | GET | `agent.run.read` |
| `/ai/agents/runs` | GET | `agent.run.read` |
| `/ai/agents/runs` | POST | `agent.run.create` |
| `/ai/agents/runs/:runId` | GET | `agent.run.read` |
| `/ai/agents/runs/:runId/steps` | GET | `agent.run.read` |
| `/ai/agents/runs/:runId/usage` | GET | `agent.run.read` |
| `/ai/agents/runs/:runId/pause` | POST | `agent.run.control` |
| `/ai/agents/runs/:runId/resume` | POST | `agent.run.control` |
| `/ai/agents/runs/:runId/cancel` | POST | `agent.run.control` |
| `/ai/agents/runs/:runId/retry` | POST | `agent.run.control` + `agent.run.create` |
| `/ai/agents/runs/:runId/approvals/:approvalId` | POST | `agent.approval.decide` |
| `/ai/agents/approvals` | GET | `agent.run.read` |
| `/ai/agents/registry` | GET | `agent.registry.read` |
| `/ai/agents/tools` | GET | `agent.registry.read` |
| `/ai/agents/audit` | GET | `agent.run.read` |

Reads are tenant-scoped. Only `super_admin` / `platform_admin` hold
`agent.run.read.platform`, and even that is a READ — there is no cross-tenant
control operation at any role.

Console: the **Agents** tab of `src/app/components/AIAdministrationConsole.tsx`
— run visibility, the approval queue and the registry, read-only apart from an
approval decision.

### 12.4 Workflow Runtime (AI-01 Batch 3B)

The layer above the agent runtime: a registered, validated graph of agent,
condition, parallel and approval nodes driven by a durable state machine, with
checkpoints, retries, data flow and a barrier that waits for a person.

**It is not a third execution path.** Every node executes as a CHILD AGENT RUN
through the Agent Orchestrator, on behalf of the same authenticated subject — so
the agent runtime applies its own RBAC, limits, loop protection, tool
permissions, spend ceiling and audit trail at every node, and every model step
still goes through `controlPlane.execute`. `engine/agentNodePort.ts` is the only
module that may hold an orchestrator, and the boundary scan asserts it.

**A workflow permission is not an agent permission.** `resolveWorkflowActor`
resolves BOTH vocabularies from one subject and carries both, so somebody who may
start a workflow but holds no `agent.run.create` is refused at the first node by
the agent runtime rather than by a check the workflow layer remembered to make.

| Route (prefix `/make-server-324f4fbe`) | Method | Capability |
|----------------------------------------|--------|------------|
| `/ai/workflows/overview` | GET | `workflow.run.read` |
| `/ai/workflows/registry` | GET | `workflow.registry.read` |
| `/ai/workflows/runs` | GET | `workflow.run.read` |
| `/ai/workflows/runs` | POST | `workflow.run.create` |
| `/ai/workflows/runs/:runId` | GET | `workflow.run.read` |
| `/ai/workflows/runs/:runId/advance` | POST | `workflow.run.create` |
| `/ai/workflows/runs/:runId/cancel` | POST | `workflow.run.control` |
| `/ai/workflows/approvals` | GET | `workflow.approval.read` |
| `/ai/workflows/approvals/:approvalId` | GET | `workflow.approval.read` |
| `/ai/workflows/approvals/:approvalId` | POST | `workflow.approval.decide` |

`POST /ai/workflows/runs` creates the run AND drives it. Recording a decision
does NOT drive it: a decider is not necessarily permitted to start agent runs —
`reviewer` holds `workflow.approval.decide` and not `workflow.run.create` — so
the run picks the decision up on the next `advance`, which is an operator's call.

Reads are tenant-scoped, and the scope is applied to the storage KEY rather than
compared afterwards, so another tenant's run is *not found* rather than
found-and-refused. Only `super_admin` / `platform_admin` hold
`workflow.run.read.platform`, and even that is a READ — nobody controls another
tenant's run or decides another tenant's approval at any role.

Read models carry identity, state and DIGESTS. A run's `input`, every node
output and every branch output stay on the server; an approval record has no
field that could hold run content, because it is read by a wider audience than
the run itself. What an approval does carry is `subjectEvidence` — the subject id
and the digest of the sealed artefact — which is what makes a queue entry
answerable without reconstructing the subject elsewhere.

**Activation is a deployment decision, separate from certification.** The
diagnostic readiness review (`workflow.diagnostic.readiness_review`), its agent
and its five tools are certified by a recorded human decision; registering them
into a deployment needs `AI_DIAGNOSTIC_REVIEW_ENABLED` (**default OFF**), durable
key-value storage and an injected submission source. Any one missing and nothing
is registered — so the surface above refuses to start it with
`workflow_not_found` and the registry reads empty. There is no route dedicated to
the review: a second entry point would be a second place the registry's enable
and certification checks could be skipped.

Console: the **Workflows** tab of `src/app/components/AIAdministrationConsole.tsx`
— start a review, run and approval visibility, the approve/reject decision,
advance, cancel, and the final committed-or-escalated outcome.

### 12.5 Provider Administration (AI-01 Batch 4C)

MARQ platform administrators manage provider connections, credentials, models,
availability and certification from Cortex itself. Provider management no longer
requires editing source, editing `.env`, or redeploying because a key changed.

```
                    MARQ ADMIN
                        │
                        ▼
             PROVIDER ADMINISTRATION          configures
                        │
          ┌─────────────┼─────────────┐
          │             │             │
     Providers      Credentials      Models
          │             │             │
          └─────────────┼─────────────┘
                        ▼
                 AI CONTROL PLANE               executes
                        │
           ┌────────────┼────────────┐
           ▼            ▼            ▼
        OpenAI      Anthropic      Future
```

**Administration configures; it never executes.** Every runtime consequence of a
change reaches execution through the two mechanisms that already existed — the
operational settings overlay and the provider credential resolver — and through
no third one.

#### Six concepts, kept apart

| Concept | Meaning | Decided by |
|---|---|---|
| Provider definition | how Cortex talks to a vendor | the adapter (reviewed code) |
| Credential | secret material authorising that conversation | a platform administrator |
| Model | a model offered through the provider | the adapter declares; an administrator enables |
| Certification | whether MARQ permits a provider/model for governed use | MARQ governance |
| Configuration | whether it is switched on and eligible | a platform administrator |
| Runtime health | whether it can execute right now | observed traffic |

"Somebody added an API key" is only the second of these. A console that
collapsed them would let a key entry silently certify a vendor.

#### Credential security

> ### ⛔ OPERATIONAL INVARIANT — `AI_CREDENTIAL_ENCRYPTION_KEY` IS NEVER ROTATED
>
> The root key is **persistent infrastructure**, not a rotatable credential.
> It must not be rotated, regenerated or replaced — not as routine hygiene, not
> during an environment migration, not while recreating an edge-function secret
> set.
>
> **Changing it breaks every managed provider credential that exists at that
> moment, and Cortex cannot re-seal them.** There is no keyring, no re-encryption
> path, and old and new root keys cannot coexist: each record names the key that
> sealed it, and a record sealed under a retired key is refused. Worse than
> stranding — the resolver deliberately does **not** fall back to the environment
> variable for a managed credential that will not open, so affected providers go
> **dark** even where a valid `OPENAI_API_KEY` is present.
>
> Recovery is operator action: revoke the undecryptable credential (which needs
> no root key, and restores service via the environment fallback), re-enter the
> credential under the new key, or restore the original key — which decrypts the
> original rows exactly.
>
> **Rotating provider credentials — the vendor API keys themselves — is fully
> supported, audited and requires no deploy.** That is a different operation and
> is unaffected. Only the root key carries this prohibition.
>
> This stands until a controlled root-key migration mechanism is designed, built
> and certified. Treat the value as you would a database encryption key: back it
> up in a secret manager, and never regenerate it.
>
> **The invariant is tested, not merely written down.** `Batch 4C remediation —
> the root key operational invariant` in
> `supabase/functions/server/ai/__tests__/providerAdministration.test.ts` drives
> the real cipher and the real resolver through provider-credential rotation
> under one unchanged root key, and through all three recovery paths: restore
> the original key, revoke the undecryptable credential and fall back, re-enter
> the credential under the current key. It also pins the blast radius — a
> provider with no managed credential is untouched by a root key change.
>
> See `architecture/ai/AI-01-BATCH-4C-PRODUCTION-GATE.md`.


- **AES-256-GCM** through the platform's Web Crypto implementation. No homemade
  cryptography, no base64-as-encryption.
- **The root key is a deployment secret** (`AI_CREDENTIAL_ENCRYPTION_KEY`), held
  in the edge environment and never in the database. Database read access alone
  yields ciphertext.
- **Per-record IV; the credential's identity is authenticated (AAD).** A
  ciphertext moved to another row fails to open, so an attacker with `UPDATE`
  cannot make one provider execute with another's key.
- **Fail closed.** No root key → credentials cannot be stored, with a message
  naming the variable. Nothing is stored weakly instead.
- **Write-only.** Once submitted, a credential is never returned by any API,
  route, service method or database view. Reads expose metadata only: a keyed
  fingerprint, at most four characters, status, versions and timestamps.
- **`cortex.ai_provider_credential` has RLS enabled and NO POLICY** — service
  role only. Its absence is the control.

#### Credential precedence

```
1. an ACTIVE managed Cortex credential   encrypted, rotatable without a deploy
2. the deployment environment variable   bootstrap / migration / emergency compat
3. none                                  the provider is unavailable and says so
```

This order cannot change current production behaviour: production holds no
managed credentials, so every provider resolves from the environment exactly as
it did before Batch 4C. Environment credentials remain supported permanently as
a compatibility and emergency source; what they stop being is the only
mechanism. The console never reads, displays or overwrites their values — it
reports `Credential source: Environment · Management: deployment-managed`.

A managed credential that exists and cannot be decrypted does **not** fall
through to the environment: that would mean an operator who rotated a key kept
executing on the old one.

#### Cache and invalidation

`describe()` — the synchronous availability probe the registry, selector and
spend guard use — reads a NON-SECRET snapshot bounded by
`AI_CREDENTIAL_SNAPSHOT_TTL_MS` and refreshed immediately after every credential
change. `resolve()` reads storage and decrypts on every attempt, so **plaintext
is never cached** and a revoked credential stops working on the next request.

#### Model governance and the budget invariant

An administrator cannot type a model name and make it eligible: a model the
adapter does not declare is rejected at the administration boundary, and a model
cannot be enabled while its provider is uncertified. `ai/policy/exposure.ts`
computes the platform's worst-case single-request spend reservation; a change
that would raise it past the governed ceiling is refused with the number named.
The Batch 4B certified figure — **105,920 µUSD** for `cortex.chat` on OpenAI's
`gpt-4o` — is pinned by regression test.

#### Capabilities

| Capability | Grant |
|---|---|
| `ai.providers.view` | Super Admin only |
| `ai.providers.manage` | Super Admin only |
| `ai.providers.credentials.manage` | Super Admin only |
| `ai.providers.models.manage` | Super Admin only |
| `ai.providers.audit.read` | Super Admin only |

All five are the platform operator's. MARQ's provider estate is one estate: a
tenant administrator replacing the key every other tenant executes through is not
a scoped action, and the credential surface — which key is in force, its
fingerprint, its rotation history — is a platform-level picture of MARQ's own
vendor accounts. Organization and Team Admins keep everything they had
(`ai.admin.view`, `ai.admin.audit.read`) and gain nothing new.

#### Endpoints

| Endpoint | Method | Capability |
|---|---|---|
| `/ai/admin/provider-administration` | GET | `ai.providers.view` |
| `/ai/admin/provider-administration/:providerId` | GET | `ai.providers.view` |
| `/ai/admin/provider-administration/:providerId/credentials` | GET | `ai.providers.view` (metadata only) |
| `/ai/admin/provider-administration/:providerId/enabled` | POST | `ai.providers.manage` |
| `/ai/admin/provider-administration/:providerId/credentials` | POST | `ai.providers.credentials.manage` (set **or** rotate) |
| `/ai/admin/provider-administration/:providerId/credentials/:credentialId/revoke` | POST | `ai.providers.credentials.manage` |
| `/ai/admin/provider-administration/:providerId/models/:modelId` | PATCH | `ai.providers.models.manage` |

**There is no endpoint that returns a credential.** Not for a super admin, not
for the service role, not for a support flow.

#### Audit

`provider.enabled` · `provider.disabled` · `provider.credential.created` ·
`provider.credential.rotated` · `provider.credential.revoked` ·
`provider.model.enabled` · `provider.model.disabled` — each with actor,
authority, provider, configuration id, credential id, keyed **fingerprint**,
reason, correlation id, timestamp and outcome. Refused attempts are recorded
too. Never a raw credential, an authorization header or a secret value.

#### Persistence

Migration `20260828120000_ai_provider_administration.sql` creates
`cortex.ai_provider_configuration`, `cortex.ai_provider_credential` and
`cortex.ai_provider_model`. It seeds nothing, copies no environment secret, and
touches no existing table.

**Deployment prerequisite:** the `cortex` schema must be in the project's
exposed API schemas (`supabase/config.toml` declares it; the hosted project's
Settings → API must agree). These tables are in `cortex` rather than `public`
because `public` is browser-reachable. If the setting is missing, provider
administration is unavailable — loudly — and the credential resolver falls back
to the deployment environment, which is the pre-4C behaviour. Scope is `platform` | `organization`; Batch 4C
administers `platform` and refuses everything else, so Batch 4D admits a value
rather than reshaping a table that by then holds production credentials.

Console: the **Providers** area of `AIAdministrationConsole.tsx`
(`ProviderAdministrationPanel.tsx`), which contains no provider name in any
branch — it renders from provider metadata, so a Batch 4E provider appears with
no frontend change.

### 12.6 Customer BYOK (AI-01 Batch 4D)

An authorised administrator of a **customer organization** configures that
organization's own AI provider credentials. Their traffic then reaches their own
vendor account under their own key.

```
     CUSTOMER ORG ADMIN                      MARQ PLATFORM ADMIN
             │                                        │
             ▼                                        ▼
   BYOK ADMINISTRATION   (4D)              PROVIDER ADMINISTRATION   (4C)
   ai.byok.*                               ai.providers.*
   organization scope only                 platform scope only
             │                                        │
             └────────────────────┬───────────────────┘
                                  ▼
                  ONE credential store · ONE AES-256-GCM cipher
                                  ▼
                  ONE PROVIDER CREDENTIAL RESOLVER  (tenant-aware)
                                  ▼
                       ONE AI CONTROL PLANE
```

**Two administration surfaces, one of everything below them.** No second store,
no second cipher, no second resolver, no second execution path, no second audit
trail. What differs is the SCOPE of the rows and WHO may touch them.

#### Credential precedence, tenant-aware

`resolve(providerId)` with **no tenant** is byte-for-byte the Batch 4C
resolution and reads no organization-owned row at all — which is what keeps a
customer's credential out of MARQ's own execution. `resolve(providerId, tenant)`
adds one branch in front of it:

```
0. TENANT       an organization configuration that is present, ENABLED and holds
                an ACTIVE credential  →  open it.
                If it will not open   →  REFUSE. Never continue.
1. PLATFORM     an ACTIVE managed Cortex credential          ┐ Batch 4C,
2. ENVIRONMENT  the deployment's variable                    │ unchanged
3. NONE         the provider is unavailable and says so      ┘
```

Reached only when the tenant's membership is VERIFIED — the
`AI_ALLOW_DEFAULT_ORGANIZATION` fallback buys no access to a customer's key.

A tenant credential that exists and cannot be decrypted does **not** fall
through to MARQ's: that would move a customer's traffic onto MARQ's vendor
account at the exact moment their own key became unreadable, while the console
went on reporting `customer_byok`. Each organization additionally chooses
`credential_fallback` ∈ `{platform, tenant_only}` — default `platform`, the
value that changes nothing for a tenant that never opts in.

The decision lives in ONE pure function (`tenantPrecedence.ts`) asked by both
the resolver and the customer console, so the two cannot disagree about what a
tenant is executing on.

#### Tenant isolation

Five independent layers: `resolveOrganization` (a hint is admitted only against
a verified membership), the service (every lookup keyed by the resolved
organization; no method takes an organization id), the store
(`listOrganizationConfigurations(organizationId)` has no "all tenants" call
shape), the database (partial unique index per (tenant, provider); a
`BEFORE UPDATE` trigger makes `scope` and `organization_id` immutable, for
`service_role` too), and the cipher (the AAD binds the organization, so a
ciphertext moved onto another tenant's row does not open).

**The organization never comes from a request body.** It comes from the
authenticated session, optionally narrowed by an `X-MARQ-Organization` hint. No
route takes an organization path parameter.

#### Authority

`ai.byok.view` and `ai.byok.manage`, held by an organization's own
administrators. Ordinary members hold neither. **The MARQ platform operator
holds neither**: a platform operator has no tenant identity, and MARQ acting on
a customer's own vendor key is a support operation with a consent question
attached — deferred rather than shipped by accident. No capability name appears
in both grant tables.

#### Persistence

Migration `20260901120000_ai_customer_byok.sql` **creates no table**. It admits
the `organization` scope the 4C schema already carried and adds one non-secret
policy column, two constraints, one partial index and one immutability trigger.
RLS stays enabled and forced on all three tables with no policy on any of them,
and nothing new is granted to any role. Its rollback deletes no customer row: a
stored credential is write-only and unrecoverable, and with 4D's code rolled
back those rows are simply never read.

#### Known limitation

Whether a provider may serve at all is decided by the selector's synchronous,
platform-scoped credential probe. Customer BYOK decides **which key** a selected
provider executes with; it does not by itself bring a provider into service.

Console: the **AI Provider Keys** tab of `SettingsPage.tsx`
(`OrganizationProviderCredentialsPanel.tsx`) — a separate tab from AI
Administration, containing no provider name in any branch and no field MARQ's
own credential state could occupy.

---

## 13. Contexts & hooks

| File | ID | Holds |
|------|-----|-------|
| `contexts/AppContext.tsx` | MQC-HOOK-004 | Contact, score, team/client sessions, submitting |
| `contexts/DashboardContext.tsx` | MQC-HOOK-005 | Search, filters, cortex view, kanban alerts |
| `contexts/GlobalAIChatContext.tsx` | MQC-HOOK-006 | Chat history, section context |

| Hook | File |
|------|------|
| `useKeyboardShortcuts` | `hooks/useKeyboardShortcuts.tsx` |
| `useOnlineStatus` | `hooks/useOnlineStatus.ts` |
| `useDebounce`, `useDeferredSearch` | `hooks/usePerformance.tsx` |

---

## 14. Types (`src/app/types/`)

| File | Owns |
|------|------|
| `cortex-types.ts` | Dashboard UI: `Lead`, `CortexLeadData` |
| `cortex-data-schema.ts` | Pipeline schema (prefixed types to avoid collisions) |
| `cortex-ai-brain.ts` | `AIModule`, brain config |
| `ai-scoring.ts` | `ScoringResult`, `DimensionScore` |
| `proposal.ts` | Proposal sections, annotations |
| `reviewer-checklist.ts` | Reviewer workflow |
| `call-script.ts` | Call scripts |

Shared API types: `src/types/api.types.ts`  
Engine types: `src/app/core/types.ts`

---

## 15. Manifest / registry

**Authoritative:** `src/system/manifest.ts` — 198 nodes  
**ID format:** `MQC-{PAGE|COMP|CORE|SVC|HOOK|TYPE}-{NNN}`  
**Status:** `LIVE` | `DEMO` | `GATED` | `MISSING` | `SYSTEM`  
**UI viewer:** `#/registry` → `RegistryViewer.tsx`  
**Validator:** `src/system/validate.ts`

**Legacy (orphaned):** `utils/registryData*.ts` — do not extend; use manifest.

---

## 16. Go-live checklist

1. Deploy: `supabase functions deploy make-server-324f4fbe`
2. Set `BACKEND_INTEGRATION: true` in `src/config/features.ts`
3. Set secrets: `OPENAI_API_KEY` (and/or `ANTHROPIC_API_KEY`), `RESEND_API_KEY`
4. Verify `GET /ai/health` reports `healthy` — `degraded` means only a
   non-production provider is usable and every completion would be synthetic
5. Verify routes (see `api.config.ts` ENDPOINTS)
6. No component changes required

---

## 17. Known debt & breakpoints

| Issue | Status | Notes |
|-------|--------|-------|
| `src/app/lib/session.ts` missing | **BREAK** | `api.ts` imports `ClientAuthContext` from it |
| `isClientSessionExpired` missing from AppContext | **BREAK** | `ClientPortalRoute.tsx` references it |
| Dual scoring | **DRIFT** | Public: `instantScoring.ts` (keywords); team: `scoringEngine.ts` |
| Session key drift | **DRIFT** | Some components use `team_access_token` / `team_user` instead of `marq_cortex_team_session` |
| `API_SPECIFICATIONS.md` | **MISSING** | Referenced in dataService header |
| Legacy registry utils | **ORPHAN** | `registryData*.ts` unused by RegistryViewer |
| AI budget ledger is per-isolate | **SCOPED** | `ai/policy/budget.ts` — `BudgetLedger` is a port; a shared-storage implementation makes spend exact across instances |
| AI rate limiter is per-isolate | **SCOPED** | Same shape as the transport limiter it sits beside; distributed limiting is a platform-wide change |
| Org membership resolution is best-effort | **SCOPED** | `ai/adapters/supabaseAuthenticator.ts` — falls back to the configured default org until tenancy tables are runtime-authoritative (Phase 5) |

---

## 18. Change checklist

When you change the codebase, update:

1. **This file** (`ARCHITECT.md` at repo root) — if routes, data flow, or key files change
2. **`architecture/system_map.json`** — machine snapshot (`_meta.generated`)
3. **`src/system/manifest.ts`** — new/moved/deleted files (ID before code)
4. **`src/system/manifest.ts` `lastVerified`** date
5. **AI changes only:** the prompt version in `ai/prompts/catalog.ts` (never edit a
   released version in place), the feature version in its descriptor, and
   `tests/system/manifest.test.ts` counts if nodes were added

---

## 19. User journeys (quick)

```
PUBLIC:  #/ → #/get-started → #/diagnostic → #/score
TEAM:    #/team/login → #/team/dashboard → panels / #/team/execution
CLIENT:  #/client/login → #/client/portal → 8 tabs
DEV:     #/architecture (system diagram) · #/registry (manifest viewer)
```

---

*End of ARCHITECT map. For node-level dependencies, search `src/system/manifest.ts` by name or domain.*
