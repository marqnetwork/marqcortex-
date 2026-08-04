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
**AI completion reports:** `architecture/ai/AI-01-BATCH-1-COMPLETION.md` · `architecture/ai/AI-01-BATCH-2-COMPLETION.md`  
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

Every value is bounded: a malformed setting falls back to its default rather than
propagating `NaN` into a timeout or a negative ceiling into a rate limiter.

**Operator endpoints:** `GET /ai/health` (unauthenticated probe, no tenant data) ·
`GET /ai/metrics` · `GET /ai/audit?limit=N` · `GET /ai/catalog` (team auth).

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
