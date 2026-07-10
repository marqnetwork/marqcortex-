# MARQ Cortex — ARCHITECT (read this first)

> **Root pointer & canonical map.** This file lives at the repo root (`ARCHITECT.md`). Agents and developers: read this before exploring the codebase. Jump to cited paths directly; open `src/system/manifest.ts` only for node IDs or dependency graphs.
>
> **Related:** machine snapshot → `architecture/system_map.json` · node registry → `src/system/manifest.ts`

**Last verified:** 2026-07-02 · **Manifest:** `src/system/manifest.ts` v2.0.0 · **Runtime:** DEMO (`BACKEND_INTEGRATION: false`)

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
| Supabase project | `tmclwqcgqfcmqwgrogjy` — `utils/supabase/info.tsx` |
| Dev server | `npm run dev` → `http://localhost:5173` (`vite.config.ts`: `host: true`) |
| Feature flag | `src/config/features.ts` → `BACKEND_INTEGRATION: false` |

---

## 2. Directory map

```
cortex/
├── ARCHITECT.md                  # ← THIS FILE (root map + agent entry point)
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
| Change pipeline/kanban | `PipelineKanban.tsx`, `dataService.getPipelinePositions` |
| Change PDF export | `utils/pdfExport.ts` (dynamic import only) |
| Change registry / node IDs | `src/system/manifest.ts`, `RegistryViewer.tsx` |
| Change backend routes | `supabase/functions/server/index.tsx` |
| Fix localhost dev server | `vite.config.ts` (`host: true`, port 5173) |
| See all node IDs + deps | `src/system/manifest.ts` |

---

## 6. Data flow

```
PUBLIC FUNNEL
  Landing → LeadMagnet → DiagnosticForm → instantScoring.ts
    → AppContext.scoreResult → ScorePage
    → (live) dataService.createSubmission

STANDARD PATH (all components)
  Component → dataService.ts → [demoData | api.ts] → Edge Function → KV

CORTEX INTELLIGENCE
  CortexDashboard → cortexDataService → mockCortexData / generator
  AI → dataService.chatWithAI / generateCortexNarrative → OpenAI (backend)

DETERMINISTIC PIPELINE
  Answers → runCortexEngine() in core/index.ts
    → inputNormalizer → scoringEngine → decisionEngine → templateAssembler (+ ROI)

TEAM DASHBOARD STATE
  TeamDashboardLayout: GlobalAIChatProvider (outer) → DashboardProvider (inner)
  DashboardContext persists filters/search to localStorage
```

---

## 7. Auth & sessions

| Actor | Mechanism | Storage key | TTL |
|-------|-----------|-------------|-----|
| Team | Email + password → token | `marq_cortex_team_session` | 8h (`marq_cortex_team_session_expiry`) |
| Client | Email verify → submissionId + optional sessionToken | `marq_cortex_client_session` | See AppContext |

**Demo team creds** (`dataService.ts`): `admin@marqcortex.com` / `CortexAdmin2026!`

**Session context:** `src/app/contexts/AppContext.tsx`

---

## 8. Team dashboard panels (`TeamDashboardNew.tsx`)

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

## 9. Client portal tabs (`ClientPortal.tsx`)

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

## 10. Core engines (`src/app/core/`)

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

## 11. Services

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
- **CORTEX AI:** `getCortexAnalysis`, `analyzeSubmission`, `generateCortexNarrative`, `chatWithAI`
- **Pipeline:** `getPipelinePositions`, `savePipelinePosition`, `resetPipelinePositions`, column capacities
- **Email queue:** `enqueueEmails`, `getEmailQueue`, `updateEmailStatus`
- **Health:** `ping`, `healthCheck`, `testAuth`, `getDiagnostics`
- **Helpers:** `generateSolutionsFromDiagnostic`, `generateClientReport`, `getDemoSubmissions`, `isDemo` pattern via `!BACKEND_INTEGRATION`

### CORTEX data — `cortexDataService.ts`
CORTEX-specific reads; avoids circular deps with `cortexDataGenerator.ts`.

### Backend — `supabase/functions/server/`
| File | Role |
|------|------|
| `index.tsx` | Hono app, 68 routes, CORS, rate limit |
| `kv_store.tsx` | KV persistence |
| `cortexChat.ts` | AI chat |
| `cortexAnalysis.ts` | Submission analysis |
| `cortexNarrative.ts` | Narrative generation |
| `blockAiAssist.ts` | Block-level AI |
| `copilotPatch.ts` | Copilot patches |
| `emailService.ts` | Resend emails |

Base path: `/make-server-324f4fbe`

---

## 12. Contexts & hooks

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

## 13. Types (`src/app/types/`)

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

## 14. Manifest / registry

**Authoritative:** `src/system/manifest.ts` — 158 nodes  
**ID format:** `MQC-{PAGE|COMP|CORE|SVC|HOOK|TYPE}-{NNN}`  
**Status:** `LIVE` | `DEMO` | `GATED` | `MISSING` | `SYSTEM`  
**UI viewer:** `#/registry` → `RegistryViewer.tsx`  
**Validator:** `src/system/validate.ts`

**Legacy (orphaned):** `utils/registryData*.ts` — do not extend; use manifest.

---

## 15. Go-live checklist

1. Deploy: `supabase functions deploy make-server-324f4fbe`
2. Set `BACKEND_INTEGRATION: true` in `src/config/features.ts`
3. Set secrets: `OPENAI_API_KEY`, `RESEND_API_KEY`
4. Verify 68 routes (see `api.config.ts` ENDPOINTS)
5. No component changes required

---

## 16. Known debt & breakpoints

| Issue | Status | Notes |
|-------|--------|-------|
| `src/app/lib/session.ts` missing | **BREAK** | `api.ts` imports `ClientAuthContext` from it |
| `isClientSessionExpired` missing from AppContext | **BREAK** | `ClientPortalRoute.tsx` references it |
| Dual scoring | **DRIFT** | Public: `instantScoring.ts` (keywords); team: `scoringEngine.ts` |
| Session key drift | **DRIFT** | Some components use `team_access_token` / `team_user` instead of `marq_cortex_team_session` |
| `API_SPECIFICATIONS.md` | **MISSING** | Referenced in dataService header |
| No test suite | **GAP** | No `*.test.ts` / `__tests__` |
| Legacy registry utils | **ORPHAN** | `registryData*.ts` unused by RegistryViewer |

---

## 17. Change checklist

When you change the codebase, update:

1. **This file** (`ARCHITECT.md` at repo root) — if routes, data flow, or key files change
2. **`architecture/system_map.json`** — machine snapshot (`_meta.generated`)
3. **`src/system/manifest.ts`** — new/moved/deleted files (ID before code)
4. **`src/system/manifest.ts` `lastVerified`** date

---

## 18. User journeys (quick)

```
PUBLIC:  #/ → #/get-started → #/diagnostic → #/score
TEAM:    #/team/login → #/team/dashboard → panels / #/team/execution
CLIENT:  #/client/login → #/client/portal → 8 tabs
DEV:     #/architecture (system diagram) · #/registry (manifest viewer)
```

---

*End of ARCHITECT map. For node-level dependencies, search `src/system/manifest.ts` by name or domain.*
