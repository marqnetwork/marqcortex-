# MARQ CORTEX — PRODUCT RECOVERY REPORT

**Program:** Cortex Recovery Program
**Phase:** Phase 1 — Product Recovery & Discovery
**Document type:** Definitive record of the *current* Cortex platform
**Prepared:** 2026-07-19
**Repository:** `marqnetwork/marqcortex-` @ `claude/cortex-product-recovery-gn409d`
**Method:** Evidence-based static discovery. Every claim below is traceable to a file, line, migration, or manifest node. Where the codebase contradicts its own documentation, both are recorded and the contradiction is flagged.

> **Scope discipline.** This document describes only what exists today. It does not design the future, propose new AI workers, or discuss roadmap/vision. Recovery recommendations (Part 9) are strictly *preserve / improve / extend / unify* — no rewrites.

> **Reconciliation note.** Two authoritative maps exist in the repo: `src/system/manifest.ts` (v2.0, last verified 2026-07-11 — the **current** truth) and `src/system/system_map.json` / `architecture/system_map.json` (generated 2026-03-06 — a **stale** snapshot). Where they disagree, the manifest and the live filesystem win, and the disagreement is itself logged as drift.

---

## PART 11 — FINAL PRODUCT RECOVERY REPORT (Executive Layer)

*(Presented first for executive readers; Parts 1–10 provide the underlying evidence.)*

### Executive Summary

MARQ Cortex is a **single-page React application backed by a Supabase Edge Function (Hono) monolith**, delivering an **AI-readiness diagnostic → scoring → proposal → ROI → execution → client-portal** business workflow for a consulting/advisory motion. It is substantially more complete than a typical early product: **158 catalogued nodes**, **91 UI components**, **38 deterministic core engines**, a **79-route backend**, a **provider-agnostic AI Intelligence Gateway**, a **full relational database schema with RLS**, and a **KV→SQL migration engine** — all present on disk.

The platform is governed by an unusually mature discipline layer: a written **Constitution**, an **ARCHITECT.md** golden-rules doc, a machine-readable **manifest**, and a **core rule** enforced in code — *"Math decides priority. LLM only explains decisions."* The deterministic engines own every number a client sees; AI is confined to narration and rewriting, with server-side **fact-lock** enforcement.

The dominant characteristic of the current product is a **deliberate DEMO/LIVE duality**. A single flag — `FEATURES.BACKEND_INTEGRATION` (currently `false`) — switches the entire frontend between mock data and the live backend. Most of the platform is *architecturally* production-ready but *operationally* running in demo mode. The backend, database, and AI gateway are built; they are gated behind deploy + flag-flip + secrets steps that have not yet been executed.

The most important risks are not missing features — they are **duplication and drift**: two scoring systems, two registry systems, two `system_map.json` files, six mock-data files, and documentation that has already fallen out of sync with the code it describes. The recovery priority is **unification and wiring**, not rebuilding.

### Overall Assessment

| Dimension | State |
|---|---|
| **Feature completeness** | High — the full consulting lifecycle is represented end-to-end. |
| **Architectural discipline** | High — enforced gateway pattern, deterministic-core rule, written constitution. |
| **Operational readiness** | Medium — built but running in demo mode; go-live is an ops task, not a build task. |
| **Consistency / drift** | Medium-Low — multiple duplicate systems and self-contradicting docs. |
| **Enterprise hardening** | Medium — RLS + tenancy exist but unwired; client auth is weak; no distributed rate-limit or error monitoring. |

Cortex is a **recoverable, high-value asset**. Nothing here recommends a rebuild. The work is to **finish wiring, unify duplicates, and harden the edges** of a product that already exists.

---

## PART 1 — PRODUCT DISCOVERY

### 1.1 Runtime shape

- **Type:** Single-Page Application + Supabase Edge Function backend (`src/system/system_map.json`).
- **Frontend:** React 18 + TypeScript + Vite 6 + Tailwind CSS v4 (`package.json`).
- **Router:** `createHashRouter` (react-router v7) — hash-based for iframe/Figma-Make compatibility (`src/app/App.tsx:92`).
- **Backend:** Hono on Supabase Edge Functions (Deno), single function `make-server-324f4fbe` (`supabase/functions/server/index.tsx`).
- **Data store (runtime authority):** Supabase KV table `kv_store_324f4fbe` (`supabase/functions/server/kv_store.tsx`).
- **Theme:** "Eclipse dark" (`#0A0A0F`).

### 1.2 Pages & routes (evidence: `src/app/App.tsx`, `src/app/pages/`)

| Route | Page | Load | Domain |
|---|---|---|---|
| `#/` | LandingPageRoute | **eager** (first paint) | LEAD |
| `#/get-started` | LeadMagnetRoute | lazy | LEAD |
| `#/diagnostic` | DiagnosticRoute (14-question form) | lazy | DIAGNOSTIC |
| `#/score` | ScoreRoute (instant score) | lazy | DIAGNOSTIC |
| `#/team/login` | TeamLoginRoute | lazy | AUTH |
| `#/team/dashboard` | TeamDashboardRoute (heaviest) | lazy | EXECUTION |
| `#/team/execution` | ExecutionRoute (sprints) | lazy | EXECUTION |
| `#/client/login` | ClientLoginRoute | lazy | AUTH |
| `#/client/portal` | ClientPortalRoute (8 tabs) | lazy | PORTAL |
| `#/architecture` | SystemArchitecture (dev utility) | lazy | SYSTEM |
| `#/registry` | RegistryViewer (dev utility, 7 tabs) | lazy | SYSTEM |
| `*` | NotFound | — | SYSTEM |

### 1.3 The primary user journeys

1. **Public lead → diagnostic → score (prospect-facing).**
   `LandingPage → LeadMagnetCapture → DiagnosticForm (Universal + Industrial questions) → ScorePage`. Generates a PDF report on capture (dynamically-imported `pdfExport` to protect the bundle). Journey documented in `system_map.json → public_funnel`.

2. **Client portal (customer-facing).** 8 fixed tabs (order is a product decision, `MQC-COMP-010` note): **Status → Solution → Readiness Report → Schedule a Call → Proposal → Messages → Your Assessment → Strategic Report.**

3. **Team dashboard (internal-facing).** Two-layer provider shell (`GlobalAIChatProvider` outer, `DashboardContext` inner). ~20 React.lazy panels: home, submissions list, pipeline Kanban, full submission detail, Cortex intelligence, analytics, revenue intelligence, ROI suite, proposal control, reviewer, blocks/registry, mapping, snapshots, email nurture, team management, settings.

4. **Execution/delivery (internal-facing).** Sprint-based delivery via `ExecutionDashboard` + block/dependency/execution engines.

5. **Reviewer/QA (internal-facing).** `ReviewerDashboard`, `QATranscriptSheet`, `SubmissionNotesPanel`, `CortexReviewerModule`.

### 1.4 Business modules (by domain, per manifest `domain` field)

LEAD · DIAGNOSTIC · PORTAL · PROPOSAL · ROI · EXECUTION · AI · ANALYTICS · REVIEWER · COMMS · AUTH · DATA · SYSTEM.

### 1.5 Frontend systems

- **Data gateway:** `dataService.ts` (1,540 lines, ~91 methods) — the *only* module components may call for data. `cortexDataService.ts` is the AI sibling. `api.ts` holds HTTP details and is never imported by components (Constitution Article 3).
- **State:** three contexts — `AppContext` (auth/session/score), `DashboardContext` (active submission/tabs), `GlobalAIChatContext` (chat history/context payload).
- **UI kit:** 48 shadcn/Radix primitives under `src/app/components/ui/`.
- **Core engines:** 38 pure-function modules under `src/app/core/` (see Part 3).

### 1.6 Backend services & APIs (evidence: `supabase/functions/server/`)

- **79 registered routes** (`grep -c` on `index.tsx`) under base path `/make-server-324f4fbe`. Route families: leads, auth (team/client), submissions (+status/bulk/notes/review/escalations/messages/proposal/outcome/cortex), bookings, proposal blocks, analytics (overview/revenue-snapshots/engagement), notifications, team, settings, email (queue/status/send/digest), client report, cortex (status/analyze/learning-loop/pipeline-positions/column-capacities), proposal annotations, and AI (`cortex/narrative`, `blocks/ai-assist`, `blocks/copilot-interpret`, `proposal/section-copilot`, `ai/chat`).
- **6 AI backend services:** `blockAiAssist`, `copilotPatch`, `cortexAnalysis`, `cortexChat`, `cortexNarrative`, `proposalSectionCopilot`.
- **Supporting backend:** `emailService` (Resend), `revenueSnapshot` (deterministic deal snapshots), `intelligence/*` (AI gateway), `migration/*` (KV→SQL engine), `repositories/*` (relational data access), `bookings/*`.

### 1.7 Database domains (evidence: `supabase/migrations/`)

- **Tenancy foundation:** `organizations`, `roles`, `permissions`, `role_permissions`, `organization_memberships`, `organization_settings` (+ RLS + seed).
- **KV foundation:** `kv_store_324f4fbe` (runtime authority).
- **Migration infrastructure:** `migration_runs`, `migration_checkpoints`, `migration_quarantine`, `migration_reconciliation_log` (+ RLS).
- **Diagnostic foundation:** `lead_sources`, `contacts`, `contact_methods`, `leads`, `lead_tags`, `submissions`, `submission_sections`, `diagnostic_answers`, `diagnostic_scores`, `domain_scores`, `reports`, `report_versions`, `outcomes` (+ RLS + anon-policy hardening).

### 1.8 Integrations & background services

- **Supabase** (auth + KV + Postgres). **OpenAI** (backend only, `OPENAI_API_KEY`). **Resend** (email, `RESEND_API_KEY`).
- **Background/periodic:** email nurture queue (`emailNurtureQueue.ts`, `/email-queue` routes), weekly digest (`/email/weekly-digest`), in-memory rate-limit sweeper, KV migration CLI (`scripts/migration/cli.ts`).

---

## PART 2 — ARCHITECTURE

| Layer | Current implementation | Evidence |
|---|---|---|
| **Frontend** | React 18 + TS + Vite 6 + Tailwind v4; hash router; lazy routes; 3 contexts; error boundary + route error fallback + offline banner | `package.json`, `src/app/App.tsx` |
| **Backend/Gateway** | Single Hono Edge Function (`make-server-324f4fbe`), 79 routes, CORS, in-memory rate limit (120 req/min/IP), logger middleware | `index.tsx:48–105`, `:415–4137` |
| **Database** | KV (`kv_store_324f4fbe`) authoritative at runtime; full relational schema (tenancy + diagnostic + migration infra) built but **repositories not wired to routes** | migrations; `MQC-SVC-011…016` notes |
| **Storage** | KV values as JSON; report/proposal/block/booking/escalation records under namespaced keys (`sub:*`, `proposal:*`, `outcome:*`, `escalation:*`, `booking:*`, `lead:*`) | `revenueSnapshot.ts`, manifest notes |
| **Authentication** | Team: Supabase Auth JWT (`verifyTeamToken`, `index.tsx:249`), 8h localStorage session. Client: email + submissionId lookup (`verifyClientToken`, `:754`) — **no real JWT** | `index.tsx`, `system_map.json → auth` |
| **Authorization** | `roleEngine` (admin/reviewer/consultant permission sets); relational RLS defined in migrations but unwired at runtime | `MQC-CORE-027`; tenancy/diagnostic RLS migrations |
| **AI** | Provider-agnostic Intelligence Gateway (normalize → resolve model → timeout/retry/telemetry → adapter). Providers: OpenAI (real HTTP), Mock (testing). Default model `gpt-4o-mini` for all 5 features. Per-feature rollback flags | `intelligence/gateway.ts`, `config.ts`, `bootstrap.ts`, `providers/openaiAdapter.ts` |
| **Infrastructure** | Supabase Edge Functions (Deno). Deploy via `supabase functions deploy make-server-324f4fbe` | `package.json` scripts, `DEPLOYMENT_GUIDE.md` |
| **Deployment** | Vite build (SPA) + Supabase functions/db push. DEMO/LIVE controlled by `VITE_BACKEND_INTEGRATION` | `.env.example`, `features.ts` |
| **Telemetry** | AI gateway telemetry records (latency, tokens, outcome, error code); frontend `logger.ts`; **no external error monitoring (no Sentry)** | `intelligence/telemetry.ts`, `system_map.json → missing_infrastructure` |
| **Configuration** | `src/config/` — `features.ts` (flags), `runtime.ts` (demo/live helpers), `api.config.ts`, `supabase.config.ts`; env via Vite `import.meta.env` | `src/config/` |
| **Security** | Fact-lock on AI outputs; secrets discipline (Constitution Art. 13); RLS designed; CORS + rate limit. Weak spots: client auth, in-memory rate limit, single-function blast radius | see Part 8 |

**Architectural signature:** a *deterministic core surrounded by a thin AI narration layer*, fronted by a *single mandatory data gateway*, with a *flag-gated demo/live duality*. This is coherent and enforced — not accidental.

---

## PART 3 — BUSINESS CAPABILITIES (current, evidence-backed)

| Capability | Where it lives | Status |
|---|---|---|
| **Lead capture / lead magnet** | `LandingPage`, `LeadMagnetCapture`, `ExitIntentPopup`; `/leads/capture`, `/leads/exit-intent` | LIVE (code) |
| **AI-readiness diagnostic (14 Q)** | `DiagnosticForm`, `Universal/IndustrialQuestions`, `questionRegistry` | LIVE |
| **Scoring** | `scoringEngine` (authoritative, weighted) + `instantScoring` (keyword, prospect-facing) | LIVE **but duplicated** (see Part 5) |
| **Decision routing** | `decisionEngine`, `mappingEngine` | LIVE |
| **Solution / scope / cost modeling** | `scopeEngine`, `costEngine`, `SolutionBlueprint`, architecture cards | LIVE |
| **ROI analytics suite** | `roiEngine`, `dcfEngine`, `irrEngine`, `cashflowEngine`, `monteCarloEngine`, `scenarioEngine`, `roiTrackingEngine`, `roiActualsEngine` + 9 ROI panels | LIVE |
| **Proposals** | draft editor, control panel, viewer, annotation layer, gate engine, contract engine, section copilot | LIVE |
| **CRM sync** | `crmEngine` built; `CRMSyncPanel` | **GATED** (no credentials/webhook) |
| **Analytics & reporting** | `AnalyticsDashboard`, `RevenueIntelligenceDashboard`, `dashboardAggregator`, `portfolioEngine`, `QBRPanel` | LIVE |
| **A/B testing** | `ABTestingPanel` | **GATED** (data volume) |
| **Learning loop** | `LearningLoopPanel`, `/cortex/learning-loop` | **GATED** (needs ≥50 closed subs) |
| **Automation / email nurture** | `emailService`, `EmailNurturePanel`, nurture queue, weekly digest | LIVE (needs `RESEND_API_KEY`) |
| **Execution / sprints / blocks** | `executionEngine`, `blockEngine`, `dependencyEngine`, `versionEngine`, `sprintTemplates`, `templateAssembler`, block registry + history panels | LIVE |
| **Objection handling** | `objectionEngine` + `ObjectionHandlerPanel` (KV-persisted escalations) | LIVE |
| **Client portal / messaging** | 8-tab portal, `ClientMessaging`, `TeamMessageThread` | LIVE |
| **Documents / export** | `exportEngine`, `ExportPanel`, `pdfExport`, `proposalExport`, `jsPDF` | LIVE |
| **Reviewer / QA** | `ReviewerDashboard`, `CortexReviewerModule` (KV-persisted reviews) | LIVE |
| **Team & admin** | `TeamManagement`, `SettingsPage`, `roleEngine`, `/team/*`, `/settings` | LIVE |
| **Bookings / scheduling** | `InstantBooking`, `MeetingScheduler`, `/bookings` (KV, schemaVersion 2) | LIVE |
| **Notifications** | `NotificationCenter`, `/notifications` | LIVE |
| **Multi-tenancy (data model)** | tenancy migrations + `tenancyRepository` | **built, unwired** |
| **KV→SQL migration** | `migration/orchestrator` + CLI (inventory/simulate/backfill/reconcile/rollback) | LIVE (CLI-only) |

> "LIVE (code)" means the component/route is end-to-end wired *in the codebase*; whether it serves real data at runtime depends on `BACKEND_INTEGRATION` (currently demo).

---

## PART 4 — AI CAPABILITIES

### 4.1 Where AI is used

Six surfaces, all routed through the backend and the Intelligence Gateway:

| Feature | Backend service | Route | Frontend | Manifest status |
|---|---|---|---|---|
| **Narrative** (explain scores) | `cortexNarrative.ts` | `POST /cortex/narrative` | `CortexProposalModule` | LIVE backend / **DEMO** front |
| **Analysis** (deep submission) | `cortexAnalysis.ts` | `POST /submissions/:id/analyze` | `ObjectionHandlerPanel`, `CortexReviewerModule` | LIVE |
| **Chat** | `cortexChat.ts` | `POST /ai/chat`, `/cortex/chat` | `GlobalAIChat`, `CortexChatPanel` | LIVE backend / **DEMO** front |
| **Block assist** | `blockAiAssist.ts` | `POST /blocks/ai-assist` | `BlockRegistryPanel` | LIVE |
| **Copilot (proposal)** | `copilotPatch.ts` / `proposalSectionCopilot.ts` | `/blocks/copilot-interpret`, `/proposal/section-copilot` | `CopilotPanel`, `ProposalSectionCopilot` | LIVE / **DEMO** front |

### 4.2 How AI is used — the governing rule

**"Math decides priority. LLM only explains decisions."** (Constitution Art. 6; manifest core rule; `system_map.json`.) No AI service determines an outcome — it narrates one. This is enforced, not aspirational:

- **`cortexNarrative`** receives already-computed scores; it only describes them (`MQC-SVC-007` note).
- **`proposalSectionCopilot`** applies **server-side fact-lock**: `enforceFactLock()` reverts any locked field (price, currency, duration, severity, confidence, evidence) the model touched and reports it in `fact_lock_enforced` (`MQC-SVC-017`). A **client-side mirror** in `proposalCopilotEngine` provides defence-in-depth (`MQC-CORE-036`).

### 4.3 Providers & gateway

- **Provider count:** 2 registered — **OpenAI** (real HTTP adapter → `api.openai.com/v1/chat/completions`) and **Mock** (testing). Single active provider, default `openai` (`config.ts`, `bootstrap.ts`).
- **Gateway** (`intelligence/gateway.ts`): normalizes requests → resolves model per feature via `modelRegistry` → enforces timeout (30s default) + retry (1 retry, 250ms) → records telemetry → delegates to the adapter → validates output (non-empty; JSON-object required-field checks).
- **Model architecture:** feature→profile→model indirection. All 5 profiles default to `gpt-4o-mini`, overridable per feature via env. Temperatures: chat 0.7, others 0.4; analysis maxTokens 2500, others 800.
- **Rollback:** every feature has an `INTELLIGENCE_USE_GATEWAY_*` flag; legacy `*Legacy()` paths retained (`MQC-SVC-010` note).
- **Health/certification:** provider registry tracks `enabled`, `certificationStatus`, `healthStatus`; `assertProviderAvailable` blocks disabled/unavailable providers.

### 4.4 Prompt architecture, memory, execution, narration

- **Prompt architecture:** `aiAssistEngine` (frontend) + `cortexAIPrompts.ts` shape structured payloads; backend services build feature-specific messages passed as normalized contracts (no provider-specific fields leak upstream — Constitution Art. 2).
- **Decision engine:** deterministic (`decisionEngine`, `mappingEngine`) — **not** AI.
- **Memory:** chat history in `GlobalAIChatContext` (session) + KV-persisted messages/threads; no vector store.
- **Execution:** AI never writes authoritative data; outputs are narrative/suggestions gated by fact-lock and human review.
- **Narration:** the explicit role of `cortexNarrative`.

---

## PART 5 — PRODUCT DRIFT

Drift is the defining risk of the current product. Each item below is verified on disk.

### 5.1 Dual scoring systems ⚠️
- **`src/app/utils/instantScoring.ts`** (22 KB, keyword matching, prospect-facing "instant" score) **vs** **`src/app/core/scoringEngine.ts`** (authoritative weighted formula).
- **Why it drifted:** the public funnel needed instant client-side feedback before the authoritative engine existed; the two were never reconciled. `system_map.json` flags it directly: *"the user sees keyword-match scores, not weighted-formula scores."*
- **Impact:** a prospect's displayed score can differ from the authoritative score used internally.

### 5.2 Dual registry systems ⚠️
- **Legacy:** `registryData.ts` (111 KB), `registryDataExtension.ts` (65 KB), `registryProcesses.ts` (94 KB), `registryAudit.ts` (53 KB) — **~322 KB of orphaned catalog code**. `RegistryViewer.tsx` no longer reads them.
- **Active:** `src/system/manifest.ts` + `types.ts` + `validate.ts` (the 158-node manifest).
- **Why it drifted:** the manifest superseded the hand-maintained registry utils but they were never deleted. Constitution Art. 14 already declares "legacy registry utils are orphaned."

### 5.3 Duplicate `system_map.json` ⚠️
- Two copies exist and **differ**: `src/system/system_map.json` and `architecture/system_map.json`. Constitution Art. 15 names `architecture/system_map.json` as the canonical machine snapshot — yet a second lives under `src/system/`.

### 5.4 Documentation drift (docs describe a past state) ⚠️
The March `system_map.json` has itself drifted from July reality:
- Claims **"zero test files"** → **22 test files** now exist (`tests/`, `intelligence/gateway.test.ts`, DB `.test.sql`).
- Claims **`API_SPECIFICATIONS.md` does not exist** → it now exists at repo root (29 KB).
- Claims **68 routes** (also stated in `dataService.ts:16`); manifest says **70**; actual grep = **79**.
- Manifest note on `RegistryViewer` says it *"was accidentally wiped 2026-03-05, must be restored"* → the file **exists** (60 KB). Stale note.

### 5.5 Six mock-data files ⚠️
`demoData.ts`, `mockAIAnalysis.ts`, `mockCortexAIBrain.ts`, `mockCortexData.ts`, `mockClientReport.ts`, `cortexDataGenerator.ts` — each a potential drift source vs real API shapes as the backend evolves (`system_map.json → mock_infrastructure`).

### 5.6 Built-but-disconnected relational platform (intentional drift)
`tenancyRepository`, `leadRepository`, `contactRepository`, `submissionRepository`, `reportRepository`, `outcomeRepository` are complete with types + RLS but **"not wired to Hono routes."** KV remains authoritative. This is *sanctioned* by Constitution Art. 4/7/17 (phased migration) — real, but deliberate.

### 5.7 Two database "truths"
`DATABASE_SCHEMA.md` describes an 18-table `eclipse_platform` design (dated Feb 2026, "Eclipse" naming). The actual migrations implement a differently-named/structured tenancy+diagnostic schema. The doc is a **design artifact**, not the deployed schema — and it uses the platform's *former* name ("Eclipse" vs "Cortex").

### 5.8 Legacy naming residue
`README.md` still calls the product "Modern AI Diagnostic Landing Page" (Figma origin). `package.json` name is `@figma/my-make-file`. Database doc says "Eclipse." Product is "MARQ Cortex." Naming has drifted across three identities.

### 5.9 Demo-mode AI components
`GlobalAIChat`, `CortexChatPanel`, `CopilotPanel`, `AIAssistant`, `InlineAITrigger`, `CortexModulesNew`, `CortexProposalModule`, `EngagementIntelligence` are **DEMO** in the manifest while their backends are **LIVE** — a front/back status mismatch pending wiring.

---

## PART 6 — PRODUCT STRENGTHS (protected assets — never remove)

1. **The deterministic core (`src/app/core/`, 38 engines).** Scoring, decision, ROI, DCF/IRR/Monte-Carlo, execution, proposal-gate, contract. Pure functions, no side effects, no LLM. This is the crown jewel and the source of every authoritative number.
2. **The "Math decides, LLM explains" rule + fact-lock enforcement.** A genuine, code-enforced trust boundary around AI. Rare and valuable.
3. **The single data gateway (`dataService.ts`).** One switch point for demo↔live; enforced no-bypass rule. Enormous maintainability lever.
4. **The Intelligence Gateway.** Provider-agnostic, testable (mock provider + tests), with telemetry, retry, timeout, per-feature rollback flags, and health/certification.
5. **The manifest (`src/system/manifest.ts`).** A 158-node circuit diagram with dependencies/dependents, status, and notes. Uncommon product self-knowledge.
6. **The governance layer.** Constitution + ARCHITECT.md + quality gates + phased-migration doctrine. Provides the safety rails for the recovery program itself.
7. **The KV→SQL migration engine.** Inventory/simulate/backfill/reconcile/rollback with quarantine + idempotency — a de-risked path to the relational future.
8. **Breadth of finished workflow.** Lead→diagnostic→score→solution→proposal→ROI→execution→portal→QBR is fully represented.

---

## PART 7 — PRODUCT WEAKNESSES

| # | Weakness | Impact | Severity | Risk | Recommendation |
|---|---|---|---|---|---|
| W1 | **Client auth = email + submissionId, no JWT** (`verifyClientToken`) | Anyone who knows a submissionId can access that portal | **Critical** | Data exposure / client isolation breach | Add a real client session token; treat under Constitution Art. 8 (human review) |
| W2 | **Dual scoring** (instant vs authoritative) | Prospect sees a different score than the system uses | High | Trust/credibility, sales integrity | Unify: instant score must reconcile to `scoringEngine` |
| W3 | **In-memory rate limit** (`Map`, per-instance) | Resets on cold start; not shared across Edge instances | Medium | Ineffective abuse protection at scale | Move to KV/Postgres-backed counter |
| W4 | **No external error monitoring** (console only) | Production errors invisible | Medium-High | Slow incident response | Add Sentry-equivalent |
| W5 | **Single-function backend** (79 routes in one 4,137-line file) | Large blast radius; one deploy for everything | Medium | Maintainability, deploy risk | Keep function, split into route modules |
| W6 | **6 mock files can drift from API shapes** | Demo diverges from live silently | Medium | Broken go-live surprises | Generate mocks from shared contracts/types |
| W7 | **Documentation drift** (stale `system_map.json`, wiped-note, route counts) | Agents/devs act on false maps | Medium | Wrong decisions | Regenerate `system_map.json`; make it CI-checked |
| W8 | **Two registry systems + ~322 KB orphaned code** | Confusion, dead weight, bundle risk | Low-Medium | Drift, wasted effort | Delete legacy registry utils (manifest is canonical) |
| W9 | **DEMO/LIVE status mismatch on AI components** | Features look built but serve mocks | Medium | Missed capability, unclear readiness | Wire demo AI components to their live backends |
| W10 | **RLS designed but unwired** (KV runtime) | Tenant isolation not runtime-enforced | Medium (today) / High (multi-tenant GA) | Isolation gap when relational goes live | Complete phased cutover with reconciliation gates |
| W11 | **Naming drift** (Figma / Eclipse / Cortex) | Onboarding confusion, brand inconsistency | Low | Cosmetic but pervasive | Normalize to "MARQ Cortex" repo-wide |

---

## PART 8 — ENTERPRISE READINESS

| Pillar | Assessment | Evidence |
|---|---|---|
| **Security** | Mixed. Strong: secrets discipline, CORS, fact-lock, team JWT. Weak: client auth (W1), in-memory rate limit (W3), RLS unwired (W10). | `index.tsx`, Constitution Art. 8/13 |
| **Scalability** | Frontend scales (SPA, lazy routes). Backend limited by single-function design (W5) and in-memory rate-limit state (W3). | `index.tsx`, `App.tsx` |
| **Maintainability** | High by design (gateway, manifest, pure engines) but eroded by duplication (Parts 5) and one giant server file. | manifest, `dataService.ts` |
| **Architecture** | Coherent and enforced (constitution, gateway, deterministic core). | Constitution, `intelligence/*` |
| **Performance** | Deliberate: eager landing page only, React.lazy everywhere else, debounced search (`usePerformance`), dynamic `pdfExport`. | `App.tsx`, `MQC-HOOK-003` |
| **Observability** | AI telemetry present; no product-wide error monitoring; console logging. | `telemetry.ts`, `logger.ts` |
| **Extensibility** | Strong: provider registry, model registry, feature flags, sprint templates, block registry. | `intelligence/*`, `sprintTemplates.ts` |
| **Governance** | Best-in-class for a product this size: Constitution + ARCHITECT.md + manifest + quality gates + phased-migration doctrine. | root docs |

**Net:** enterprise-*capable* architecture, not yet enterprise-*hardened* at the auth and observability edges.

---

## PART 9 — RECOVERY RECOMMENDATIONS

*Strictly preserve / improve / extend / unify. No rewrites.*

**PRESERVE (protect, do not touch without review)**
- The 38 core engines, the "math decides" rule + fact-lock, the data gateway, the Intelligence Gateway, the manifest, the migration engine. (Part 6.)

**UNIFY (collapse duplicates — highest-leverage recovery work)**
1. **Scoring:** make `instantScoring` a fast presentation of `scoringEngine` output, or explicitly label it a preview. (W2)
2. **Registry:** delete the 4 orphaned `registry*.ts` utils; manifest is canonical. (W8)
3. **`system_map.json`:** keep one canonical copy (`architecture/`), regenerate from the manifest, delete/redirect the duplicate. (5.3, W7)
4. **Mocks:** derive the 6 mock files from shared contract types so demo can't silently drift. (W6)
5. **Naming:** normalize README / `package.json` / DB doc to "MARQ Cortex." (W11)

**IMPROVE (harden existing, no new features)**
6. **Client auth:** issue a real client session token (Constitution Art. 8 review). (W1)
7. **Rate limit:** back it with KV/Postgres. (W3)
8. **Observability:** add error monitoring around the gateway + backend. (W4)
9. **Server modularity:** split `index.tsx` into route modules behind the same function. (W5)

**EXTEND (finish what's started)**
10. **Wire the DEMO AI components** (`GlobalAIChat`, `CortexChatPanel`, `CopilotPanel`, etc.) to their already-LIVE backends. (W9)
11. **Advance the phased KV→SQL cutover** using the existing migration engine + reconciliation gates. (W10, Constitution Art. 7/17)
12. **Refresh `API_SPECIFICATIONS.md`** to the real 79-route surface and CI-check it against `index.tsx`.

---

## PART 10 — EXECUTIVE SCORECARD

Scores are 0–10, evidence-based, reflecting the **current** platform.

| Dimension | Score | Rationale |
|---|---:|---|
| **Architecture** | **8.5** | Enforced gateway + deterministic core + written constitution; single-function backend and unwired RLS hold it back. |
| **Business (capability breadth)** | **8.5** | Full consulting lifecycle present end-to-end; some capabilities gated. |
| **AI** | **8.0** | Provider-agnostic gateway, fact-lock, telemetry, rollback flags; single provider/model and several demo-only front surfaces. |
| **Enterprise Readiness** | **5.5** | Capable architecture; client auth, distributed rate-limit, monitoring, and RLS wiring are gaps. |
| **Developer Experience** | **7.5** | Manifest + gateway + typed contracts are excellent; duplication and stale docs add friction. |
| **Scalability** | **6.5** | Frontend scales; backend concentration and in-memory state limit it. |
| **Maintainability** | **7.0** | Strong patterns undermined by duplicate systems and a 4,137-line server file. |
| **User Experience** | **7.5** | Complete journeys, performance discipline, polished portal; scoring inconsistency is a UX/trust dent. |
| **Vision Alignment** | **8.5** | "Math decides, LLM explains" is lived in code, not just stated. |
| **Technical Debt** | **6.0** | Mostly *duplication/wiring* debt (recoverable), not rot; ~322 KB orphaned code + drifted docs. |

**Composite: ~7.4 / 10 — a strong, coherent, recoverable product whose primary need is unification, wiring, and edge-hardening — not rebuilding.**

---

## APPENDIX A — Quick Wins (low effort, high clarity)
- Delete 4 orphaned `registry*.ts` utils (~322 KB). (5.2)
- Regenerate + de-duplicate `system_map.json`; fix stale notes/route counts. (5.3–5.4)
- Fix product naming in README / `package.json` / DB doc. (5.8)
- Correct the manifest's stale "RegistryViewer wiped" note. (5.4)

## APPENDIX B — Critical Risks (address before any multi-tenant / production GA)
- **Client portal auth (W1)** — data isolation.
- **RLS unwired at runtime (W10)** — tenant isolation.
- **No error monitoring (W4)** — blind in production.

## APPENDIX C — Long-Term Risks
- Mock/API and doc drift compounding as the backend evolves (W6, W7).
- Single-function backend blast radius as route count grows past 79 (W5).
- Dual scoring eroding sales trust if left unreconciled (W2).

## APPENDIX D — Evidence Index (primary sources)
- Product map: `src/system/manifest.ts` (158 nodes, v2.0).
- Machine snapshots: `src/system/system_map.json`, `architecture/system_map.json` (March, partially stale).
- Governance: `MARQ_CORTEX_CONSTITUTION.md`, `ARCHITECT.md`.
- Backend: `supabase/functions/server/index.tsx` (79 routes), `intelligence/*`, `repositories/*`, `migration/*`.
- Frontend gateway: `src/app/services/dataService.ts`; config: `src/config/features.ts`, `runtime.ts`.
- Database: `supabase/migrations/*` (tenancy, KV, migration infra, diagnostic); design doc `DATABASE_SCHEMA.md`.
- Counts verified on disk 2026-07-19: 91 components, 38 core engines, 48 UI primitives, 22 utils, 55 backend TS files, 8 migrations, 22 test files.

---

*End of Phase 1 Product Recovery Report. This document records only what exists today. Evolution belongs to later phases.*
