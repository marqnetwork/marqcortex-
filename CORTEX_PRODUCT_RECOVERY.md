# MARQ Cortex — Product Recovery & Architecture Audit

**Document type:** Product Recovery — Source of Truth
**Status:** Canonical (supersedes ad-hoc audits; complements the Constitution)
**Prepared for:** MARQ Networks — Cortex
**Date:** 2026-07-19
**Authors (roles assumed):** Principal Product Architect · Principal AI Systems Architect · Principal UX Architect · Principal Business Strategist · Principal Software Architect

> **Philosophy — non-negotiable:** **Preserve. Improve. Extend. Unify.**
> Never rebuild something that already solves the problem. This document is an
> *upgrade map*, not a redesign. It is fully aligned with **Constitution Article 1
> — Evolve, Do Not Rebuild**.

---

## How to read this document

- **Parts 1–4** describe *what exists today* (the recovered ground truth).
- **Parts 5–9** measure the product against the intended Cortex vision and name the gaps.
- **Parts 10–11** give the roadmap and the scored final report.
- Every claim is tagged where useful: **PROVEN** (seen in code), **LIKELY**, **DRIFT**, **MISSING**.

---

# PART 1 — CURRENT PRODUCT MAP

## 1.1 What Cortex is *today* (recovered ground truth)

**Cortex today is a single-tenant, AI-assisted operating system for one consultancy's revenue lifecycle** — MARQ Networks' own "AI Readiness → Proposal → Close → Deliver" motion. It is a *vertical sales-and-delivery platform*, not yet a *horizontal digital workforce*.

The product runs three surfaces on one codebase:

| Surface | Audience | Purpose |
|---|---|---|
| **Public funnel** | Prospects | Capture leads, run the diagnostic, deliver an AI Readiness Score |
| **Team dashboard** | MARQ operators | Triage submissions, model ROI, build proposals, run revenue intelligence |
| **Client portal** | Won/active clients | View report, solution, proposal, schedule calls, message the team |

**Stack (PROVEN):** React 18 + TypeScript + Vite 6 + Tailwind v4 + react-router v7 (hash router), Supabase Edge Functions (Deno + Hono, 79 routes), KV store (`kv_store_324f4fbe`) as runtime authority, phased Postgres/RLS migration underway. Provider-agnostic **Intelligence Gateway** for all LLM access. Theme: Eclipse dark `#0A0A0F`.

**Governance maturity is unusually high** — a Constitution (v1.1, 17 articles), `ARCHITECT.md` root map, a 158-node `manifest.ts` registry, execution rules, and a machine-readable `system_map.json`. This is a genuine strategic asset (see Part 3).

---

## 1.2 Every page / route (PROVEN — `src/app/App.tsx`)

| URL (hash) | Component | Load | Guard |
|---|---|---|---|
| `#/` | `LandingPage` | Eager | — |
| `#/get-started` | `LeadMagnetCapture` | Lazy | — |
| `#/diagnostic` | `DiagnosticForm` | Lazy | — |
| `#/score` | `ScorePage` | Lazy | — |
| `#/team/login` | `TeamLogin` | Lazy | — |
| `#/team/dashboard` | `TeamDashboardNew` | Lazy | `teamAccessToken` (8h TTL) |
| `#/team/execution` | `ExecutionDashboard` | Lazy | team |
| `#/client/login` | `ClientLogin` | Lazy | — |
| `#/client/portal` | `ClientPortal` | Lazy | `clientSession` |
| `#/architecture` | `SystemArchitecture` | Lazy | — |
| `#/registry` | `RegistryViewer` | Lazy | — |
| `#/*` | `NotFound` | Eager | — |

## 1.3 Team dashboard modules (PROVEN — `TeamDashboardNew.tsx` PageView state)

`dashboard` (TeamHomeDashboard) · `cortex` (CortexDashboard) · `team` (TeamManagement) · `settings` (SettingsPage) · `reviewer` (ReviewerDashboard) · `analytics` (AnalyticsDashboard) · `emails` (EmailNurturePanel) · `revenue` (RevenueIntelligenceDashboard) · `mapping` (MappingEnginePanel) · `execution` → `#/team/execution` · `architecture` → `#/architecture`.

## 1.4 Client portal tabs (PROVEN — fixed order, `ClientPortal.tsx`)

1. Your Status → `ClientReportDashboard`
2. Solution → `ClientSolutionView`
3. Readiness Report → `ClientReadinessReport` (locked until ready)
4. Schedule a Call → `InstantBooking` / `MeetingScheduler`
5. Proposal → `ProposalViewer`
6. Messages → `ClientMessaging`
7. Your Assessment → `ClientQAReview`
8. Strategic Report

## 1.5 Business capabilities / module domains (PROVEN — 91 domain components, 158 manifest nodes)

Manifest domain distribution: **EXECUTION 27 · SYSTEM 26 · AI 21 · ROI 18 · PROPOSAL 14 · DIAGNOSTIC 12 · ANALYTICS 11 · PORTAL 9 · AUTH 8 · REVIEWER 7 · DATA 7 · COMMS 6 · LEAD 5**. Status mix: **157 LIVE · 9 DEMO · 3 GATED · 2 SYSTEM**.

| Capability | Where it lives |
|---|---|
| **Lead capture / exit-intent** | `LeadMagnetCapture`, `ExitIntentPopup`, `leads/*` routes |
| **Diagnostic** (14 questions × 9 industries) | `DiagnosticForm`, `UniversalQuestions`, `IndustrialQuestions`, `questionRegistry` |
| **Instant scoring (public)** | `instantScoring.ts` → `ScorePage` |
| **Authoritative scoring (team)** | `core/scoringEngine.ts` via `runCortexEngine()` |
| **Submission triage / CORTEX analysis** | `CortexDashboard`, `analyzeSubmission`, `cortexAnalysis.ts` |
| **Pipeline / kanban** | `PipelineKanban`, `getPipelinePositions`, column capacities |
| **ROI suite** | `roiEngine` + `cashflow/dcf/irr/monteCarlo/scenario/cost` engines; `DCFPanel`, `MonteCarloPanel`, `ScenarioPanel`, `ROIExecutiveDashboard`, `ROITrackingPanel` |
| **Proposal system** | `ProposalDraftEditor`, `ProposalControlPanel`, `ProposalViewer`, block registry, annotations, `proposalGate/scope/contract` engines |
| **Reviewer / QA** | `ReviewerDashboard`, `ClientQAReview`, `exportEngine`, escalations |
| **Revenue intelligence** | `RevenueIntelligenceDashboard`, `objectionEngine`, `roiTracking/roiActuals` |
| **Analytics / QBR** | `AnalyticsDashboard`, `portfolioEngine`, `dashboardAggregator`, `qbrEngine`, `QBRPanel` |
| **Engagement telemetry** | `EngagementIntelligence`, `EngagementActivityFeed`, engagement routes |
| **Comms** | `ClientMessaging`, `TeamMessageThread`, `crmEngine` (derives CRM stage/activities/tasks/deals) |
| **Email nurture** | `EmailNurturePanel`, email queue routes, Resend `emailService.ts` |
| **Scheduling** | `InstantBooking`, `MeetingScheduler`, `bookings/*` |
| **Execution / delivery** | `ExecutionDashboard`, `executionEngine`, `blockEngine`, `mappingEngine`, `dependency/version/snapshot/changeImpact` engines, `sprintTemplates` |
| **Team admin & settings** | `TeamManagement`, `SettingsPage`, `roleEngine`, RBAC tables |
| **System / registry** | `SystemArchitecture`, `RegistryViewer`, `manifest.ts`, `consistencyValidator` |

## 1.6 Every AI feature (PROVEN — all route through the Intelligence Gateway)

| AI feature | Frontend | Engine | Service → Backend |
|---|---|---|---|
| **Global AI chat** ("CORTEX AI") | `GlobalAIChat` | — | `chatWithAI` → `ai/chat` → `cortexChat.ts` |
| **Submission analysis** | `CortexDashboard` | — | `analyzeSubmission` / batch → `cortexAnalysis.ts` |
| **Portfolio narrative** | `CortexChatPanel` | — | `generateCortexNarrative` → `cortexNarrative.ts` |
| **Block AI assist** | `BlockRegistryPanel`, `EditableBlockCard` | `aiAssistEngine` | `blockAIAssist` → `blockAiAssist.ts` |
| **Cortex Copilot** (patch plans on proposal blocks) | `CopilotPanel` | `copilotEngine` | `copilotInterpret` → `copilotPatch.ts` |
| **Proposal section copilot** | `ProposalSectionCopilot` | `proposalCopilotEngine` | `proposalSectionCopilot` |
| **Objection handling** | `ObjectionHandlerPanel` | `objectionEngine` (deterministic) | — |
| **Diagnostic assistant** | `AIAssistant`, `InlineAITrigger` | — | client-side guidance |
| **AI Brain pipeline** (design) | — | `cortex-ai-brain.ts` (8-step: ingest→pillar→severity→pattern→solution→ROI→confidence→human override) | conceptual contract |

**Intelligence Gateway (PROVEN — `supabase/functions/server/intelligence/`):** provider-agnostic layer with `gateway.ts`, `contracts.ts` (normalized request/response), `providerRegistry`, `modelRegistry` (per-feature model resolution), `telemetry`, `certification`, `health`, and adapters (`openaiAdapter`, `mockProvider`). Env-driven rollback per feature (`INTELLIGENCE_USE_GATEWAY_*`). **This is the single most important asset for the vision** — it is exactly the substrate a multi-agent workforce needs.

## 1.7 Backend / API (PROVEN — Hono, 79 routes, base `/make-server-324f4fbe`)

Route families: health/diagnostics · leads · auth (team/client) · submissions (+status/bulk/notes/review/escalations) · client submission (+engagement/report/proposal) · proposals (+blocks/annotations/send/respond) · messages (team/client) · analytics (overview/revenue-snapshots/engagement) · notifications · bookings · team admin · settings · email (queue/status/send/digest) · cortex (status/analyze/outcome/outcomes/learning-loop/pipeline-positions/column-capacities/narrative) · blocks (ai-assist/copilot-interpret) · proposal section-copilot · ai/chat.

## 1.8 Database (PROVEN)

**Runtime authority = KV** (`kv_store_324f4fbe`). Relational foundation exists but is *not yet authoritative*:

- **Tenancy (S4):** `organizations`, `organization_memberships`, `organization_settings`, `roles`, `permissions`, `role_permissions` — RLS + seed.
- **Diagnostic (S5):** `leads`, `lead_sources`, `lead_tags`, `contacts`, `contact_methods`, `submissions`, `submission_sections`, `diagnostic_answers`, `diagnostic_scores`, `domain_scores`, `reports`, `report_versions`, `outcomes`.
- **Migration infra (S6.2):** `migration_runs`, `migration_checkpoints`, `migration_quarantine`, `migration_reconciliation_log`.
- **Repositories:** `lead/contact/submission/report/outcome/tenancyRepository` (built, **not yet wired to routes**).

## 1.9 Permissions / auth (PROVEN)

- **Team:** email+password → 8h token (`marq_cortex_team_session`); Supabase Auth + `user_metadata.teamRole`; `organization_memberships` seeded manually.
- **Client:** email verify → submissionId (+ optional session token).
- **RBAC:** `roleEngine.ts` + `roles/permissions/role_permissions` tables; RLS mandatory on tenant + diagnostic tables (Constitution Art. 5).

## 1.10 Integrations (PROVEN)

- **OpenAI** (via gateway adapter) · **Resend** (transactional email) · **Supabase** (Auth, Edge, Postgres, KV).
- **CRM:** *derivation only* — `crmEngine` maps proposal drafts to CRM stages/activities/tasks/deals; **no live CRM connector** (`CRMSyncPanel` exists as UI).
- **MISSING:** LinkedIn, calendar/OAuth (booking is internal), Gmail/Outlook, browser/desktop automation, Slack, social.

---

# PART 2 — PRODUCT DRIFT

The product is *coherent and well-governed*, so drift is **localized**, not systemic. The larger "drift" is a **positioning gap** between what was built (a consultancy revenue OS) and the stated vision (an AI company you hire). Concrete findings:

### 2.1 Duplicated / overlapping ideas

| Drift | Evidence | Why it matters |
|---|---|---|
| **Dual scoring** | Public `instantScoring.ts` (keyword-based) vs team `core/scoringEngine.ts` (authoritative) | Two sources of truth for "the score" → prospect sees a number that can disagree with the team's. Violates spirit of "Math decides." Documented as **DRIFT** in ARCHITECT §17. |
| **Session-key drift** | Some components use `team_access_token`/`team_user` vs canonical `marq_cortex_team_session` | Auth fragility; latent logout/permission bugs. |
| **Two data services** | `dataService.ts` (gateway) + `cortexDataService.ts` (+ `cortexDataGenerator`) | Second path exists to dodge circular deps and serve *mock portfolio data* — a parallel non-LLM "CORTEX" data plane that can diverge from the real one. |
| **Scattered AI entry points** | 8+ distinct AI surfaces (chat, analysis, narrative, block assist, copilot, section copilot, objection, diagnostic assistant) each with its own engine/route | AI capability is **feature-attached, not workforce-organized**. No shared memory, no single conversation, no delegation between them. This is the #1 structural blocker to the vision. |
| **Proposal copilot vs block copilot** | `copilotEngine` + `proposalCopilotEngine` + `blockAiAssist` | Three overlapping "edit-this-with-AI" mechanisms that should unify under one agent action model. |

### 2.2 Dead / incomplete / abandoned

| Item | Status |
|---|---|
| Repositories built but **not wired to routes** | Incomplete (S5 → runtime) |
| `MARQ_CORTEX_STABILIZATION_ROADMAP.md.txt` — **empty file** | Abandoned artifact |
| `src/app/lib/session.ts` **missing** (imported by `api.ts`) | **BREAK** (ARCHITECT §17) |
| `isClientSessionExpired` referenced but missing from AppContext | **BREAK** |
| Legacy `utils/registryData*.ts` | Orphaned (superseded by manifest) |
| `CRMSyncPanel`, `ABTestingPanel`, `LearningLoopPanel` | UI ahead of backend depth (DEMO/GATED) |
| Shadow-read sprints S7.4–S8.3 | Planned/in-progress — SQL cutover unfinished |

### 2.3 Naming / UX inconsistency

- "CORTEX" is overloaded: the product, the AI chat, the submission-analysis dashboard, and the mock data plane all carry the name. A user cannot tell which "Cortex" they're talking to.
- Team navigation mixes internal `PageView` state with two hash-route escapes (`execution`, `architecture`) — inconsistent back/deep-link behavior.
- Client portal tab order is *product-locked* (good discipline) but tab #3 locking + #8 "Strategic Report" with no consistent gating story reads as staged accretion.

### 2.4 Modules that should merge / split

- **MERGE:** all AI edit surfaces (`copilotEngine`, `proposalCopilotEngine`, `blockAiAssist`, section copilot) → one **Agent Action Layer**.
- **MERGE:** `instantScoring` + `scoringEngine` → one scoring engine with a "fast/full" mode (kills dual-truth).
- **SPLIT:** `TeamDashboardNew` is becoming a god-component (11 PageViews) → split into a route-driven workspace shell so departments can be added without editing one file.
- **MERGE:** `dataService` + `cortexDataService` once SQL cutover lands (single gateway per Constitution Art. 3).

---

# PART 3 — WHAT SHOULD NEVER CHANGE (LOCKED)

These are the product's genuine strengths. **Preserve them verbatim.**

1. **The Constitution + ARCHITECT.md + manifest + system_map governance model.** This is rare and valuable. It is *how* you evolve safely into a workforce without chaos. **LOCKED.**
2. **"Math decides priority. LLM only explains decisions."** (Art. 6) — the deterministic-core / AI-narration split. This is the correct safety posture for an autonomous company. **LOCKED and extended** (agents plan; engines still decide money/scores).
3. **The Intelligence Gateway** (provider-agnostic, normalized contracts, per-feature model registry, telemetry, certification, mock provider). This is the workforce's nervous system. **LOCKED — build on it, never around it.**
4. **The Frontend Data Gateway pattern** (`dataService` is the only data door). **LOCKED.**
5. **The 35+ deterministic engines** (scoring, ROI/DCF/IRR/Monte Carlo/scenario, proposal gate/scope/contract, execution/mapping/dependency). These are hard-won business IP. **LOCKED as the "AI CFO/CRO/COO calculators."**
6. **Phased, reconciliation-gated migration discipline** (Art. 4/7/11/17). **LOCKED.**
7. **Multi-tenancy + RLS foundation** (Art. 5). **LOCKED — it is the substrate for "businesses hire Cortex."**
8. **The 8-step AI Brain contract** (`cortex-ai-brain.ts`) with the **Human Override Layer** as step 8. **LOCKED — this is the delegation/approval model in embryo.**
9. **Human-in-the-loop everywhere** (approval workflows, reviewer, escalations, proposal gates). **LOCKED — it is what makes an AI workforce trustworthy.**

---

# PART 4 — WHAT SHOULD EVOLVE (not rebuild)

| Current feature | Evolves into (enterprise version) | How (additive) |
|---|---|---|
| Global AI Chat (single assistant) | **Cortex Orchestrator** — one entry that routes to department agents | Wrap existing `chatWithAI`; add a router that dispatches to specialist prompts. No new chat UI. |
| Submission analysis (`cortexAnalysis`) | **AI Research/Analyst worker** output | Same route, promoted to a named worker with persisted memory. |
| Copilot / block assist / section copilot | **Unified Agent Action Layer** (propose → approve → execute → log) | Collapse three engines behind one `AgentAction` contract; keep patch-plan review UX. |
| Deterministic engines | **Department "calculators"** each agent must call | Agents *must* call the engine for any number (enforces Art. 6). |
| Reviewer + escalations + proposal gates | **Universal approval & oversight layer** for every autonomous action | Generalize the existing gate model from proposals to all agent actions. |
| Email nurture + Resend | **Outreach Engine (email channel)** | Add sequences, multi-account, approvals on top of existing queue. |
| CRM derivation (`crmEngine`) | **Live CRM connector + AI CRO** | Turn derivation into bi-directional sync via a connector abstraction. |
| Engagement telemetry | **Agent activity + memory ledger** | Reuse engagement log schema as the audit trail for worker actions. |
| Analytics / QBR / portfolio | **AI reporting layer (auto-generated QBRs)** | `qbrEngine` + narrative already exist — schedule + auto-deliver. |
| Manifest registry | **Agent & capability registry** | Add `AGENT`/`WORKER`/`DEPARTMENT` node types to the same manifest. |
| Diagnostic → Proposal → Execution | **Onboarding pipeline for a hired Cortex** | Reframe the same flow as "Cortex onboards a new client business." |

---

# PART 5 — CORTEX VISION ALIGNMENT

**Vision:** MARQ owns Cortex; Cortex is an AI company; businesses *hire* Cortex as their digital workforce, with an AI C-suite + AI departments + specialist workers that share memory, delegate, communicate, and execute.

**Alignment score: ~25%** — strong *substrate*, minimal *workforce*.

| Vision element | Today | Gap |
|---|---|---|
| AI CEO/COO/CFO/CTO/CMO/CRO/CHRO | ❌ none as named agents | The *math* for CFO/CRO/COO exists in engines; no agent persona owns it. |
| AI departments (Product/Eng/Ops/Marketing/Sales/CS/HR/Finance/Legal/Research/PM/Quality/Security) | ⚠️ partial — Sales/Finance(ROI)/Delivery/CS(portal) exist as *features*, not agents | No org structure; no HR/Legal/Security/Product/Eng agents. |
| Specialist workers | ❌ | AI is feature-attached, not staffed. |
| Shared memory | ❌ | No cross-agent memory store; engagement log is the closest primitive. |
| Delegation | ⚠️ | Copilot patch-plan + human-override step 8 are proto-delegation; no agent→agent. |
| Communication (agent↔agent) | ❌ | Only human↔AI chat exists. |
| Execute real work | ⚠️ | Can draft proposals/emails/ROI; cannot act on external systems autonomously. |
| Businesses *hire* Cortex (multi-tenant productization) | ⚠️ | Tenancy tables exist; product is still single-tenant MARQ-internal in practice. |

**Verdict:** Cortex has built the **factory** (gateway, engines, tenancy, governance, human-in-loop). It has not yet hired the **workers**. The vision is reachable *additively* — this is the good news and the core thesis of the roadmap.

---

# PART 6 — BUSINESS LIFECYCLE COVERAGE

| Stage | Exists? | Where / what's missing |
|---|---|---|
| **Find customers** | ❌ MISSING | No prospecting/outreach engine; funnel is inbound-only. |
| **Warm customers** | ⚠️ Partial | Email nurture + exit-intent exist; no multi-channel warming. |
| **Qualify customers** | ✅ Strong | Diagnostic + scoring + `decisionEngine` are exactly qualification. |
| **Support sales** | ✅ Strong | Objection engine, pipeline, revenue intelligence, copilots. |
| **Prepare proposals** | ✅ Strong | Full proposal system + block AI + ROI. |
| **Help close** | ✅ Good | Objection playbooks, proposal gates, e-sign-adjacent contract engine (no live e-sign). |
| **Onboard customers** | ⚠️ Partial | Client portal + report; no structured onboarding automation. |
| **Operate the business** | ❌ MISSING | Execution engine models delivery of *MARQ's* sprints, not operating a *client's* business. |
| **Improve the business** | ⚠️ Partial | Mapping/execution/learning-loop concepts exist but human-driven. |
| **Retain customers** | ⚠️ Partial | Messaging + QBR + engagement telemetry; no retention/CS agent. |
| **Grow customers** | ❌ MISSING | No upsell/expansion intelligence. |
| **Report performance** | ✅ Good | Analytics, QBR engine, revenue snapshots, narrative. |

**Pattern:** Cortex is *excellent* mid-funnel (qualify → close), *thin* at the edges (find, operate, grow, retain). The vision needs the edges built.

---

# PART 7 — DIGITAL WORKFORCE ARCHITECTURE

The recommended layering — **all additive on the existing gateway + engines + tenancy:**

```
┌─────────────────────────────────────────────────────────────┐
│ EXECUTIVE LAYER   AI CEO / COO / CFO / CTO / CMO / CRO / CHRO │  ← personas that OWN engine outputs + set goals
├─────────────────────────────────────────────────────────────┤
│ DEPARTMENT LAYER  Sales · Finance · Delivery · CS · Marketing │  ← reuse existing feature clusters as departments
│                   Product · Eng · HR · Legal · Research · Sec │  ← new departments (thin at first)
├─────────────────────────────────────────────────────────────┤
│ MANAGER LAYER     Per-department orchestrator agent          │  ← plans, delegates, reviews worker output
├─────────────────────────────────────────────────────────────┤
│ WORKER LAYER      Specialist agents (Analyst, SDR, Proposal, │  ← today's AI features, promoted to named workers
│                   ROI Modeler, Objection, QBR, Onboarder…)   │
├─────────────────────────────────────────────────────────────┤
│ EXECUTION LAYER   Deterministic engines + Agent Action Layer │  ← LOCKED engines decide math; actions do work
├─────────────────────────────────────────────────────────────┤
│ AUTOMATION LAYER  Outreach / CRM / Calendar / Browser / Email│  ← connectors + tools (mostly MISSING today)
└─────────────────────────────────────────────────────────────┘
        Cross-cutting: Shared Memory · Approval/Oversight · Telemetry (LOCKED)
```

- **Executive layer** = thin persona + goal state over existing engine outputs. AI CFO *is* the ROI engines + narrative; AI CRO *is* revenue intelligence + objection engine. Cheap to stand up.
- **Manager layer** = the missing orchestration primitive. Build once, reuse per department. The Copilot patch-plan pattern is the template.
- **Worker layer** = *rename and register* today's AI features as workers in the manifest; add per-worker memory.
- **Shared Memory** = new store (KV-namespaced first, then Postgres) keyed by org + entity, written by every worker, honoring RLS. Reuse the engagement-log pattern.
- **Automation layer** = the real net-new build (Part 8).

---

# PART 8 — OUTREACH ENGINE

**Today (PROVEN):** email nurture queue + Resend, internal booking, engagement telemetry, CRM *derivation*. **No external outbound automation.**

| Channel / capability | Today | Target | Priority |
|---|---|---|---|
| Email (transactional) | ✅ Resend | Sequenced, multi-account, agent-authored, approval-gated | High |
| Email (prospecting) | ❌ | Deliverability, warmup, reply detection | High |
| LinkedIn | ❌ | Connect/message/engage via automation + limits | Medium |
| Social media | ❌ | Scheduled posting + monitoring | Low |
| CRM | ⚠️ derive only | Bi-directional connector (HubSpot/Salesforce/Pipedrive) | High |
| Calendar | ⚠️ internal booking | OAuth Google/Outlook two-way sync | High |
| Meetings | ⚠️ scheduler UI | Join/record/summarize (transcription → memory) | Medium |
| Documents | ✅ PDF export/proposals | Live e-sign, doc generation as agent output | Medium |
| Browser automation | ❌ | Playwright-driven tool (research, form-fill) under approval | Medium |
| Desktop automation | ❌ | Later-phase, sandboxed | Low |
| Multi-account management | ❌ | Per-org credential vault + rotation | High |
| Approval workflows | ✅ (proposals/reviewer) | Generalize to all outbound actions | **Critical** |
| Human oversight | ✅ | Extend to autonomous actions | **Critical** |
| Task execution | ⚠️ (next-actions module) | Agent-executable task queue | High |

**Principle:** every outbound channel ships behind the **existing approval/oversight model** before it ever runs autonomously. Oversight is not a feature to add later — it is the license to operate.

---

# PART 9 — WHAT IS MISSING (by priority)

### 🔴 Critical
1. **Agent runtime / orchestration primitive** — no way to define, run, or coordinate agents.
2. **Shared agent memory** (org-scoped, RLS-honoring, cross-worker).
3. **Unified Agent Action Layer** (propose → approve → execute → log) generalized from Copilot.
4. **Wire repositories to routes + finish SQL cutover** (S7.4→S8.3) — KV-only limits multi-tenant scale.
5. **Fix known BREAKs** — missing `session.ts`, `isClientSessionExpired`, session-key drift.

### 🟠 High
6. **Executive persona layer** (AI CEO/CFO/COO/CRO/CMO over existing engines).
7. **Outreach engine** — prospecting email, multi-account, sequences, reply detection.
8. **Live CRM + calendar (OAuth) connectors.**
9. **"Find customers" + "grow customers"** lifecycle stages.
10. **Multi-tenant productization** — real "hire Cortex" onboarding for arbitrary businesses.
11. **Automated test coverage** across engines and routes (historically a GAP; some suites now exist).

### 🟡 Medium
12. Manager-layer orchestrator per department.
13. Merge dual scoring; unify AI edit surfaces; split god-component dashboard.
14. Browser-automation tool (approval-gated); meeting capture → memory.
15. LinkedIn channel; live e-sign.
16. Departments with no representation yet: **Product, Engineering, HR, Legal, Security, Quality**.

### 🟢 Low
17. Social scheduling/monitoring; desktop automation; A/B testing depth; agent marketplace.

---

# PART 10 — IMPLEMENTATION ROADMAP (upgrade, not redesign)

> Each phase is **additive, reconciliation-gated, and reversible** per the Constitution. Nothing below requires throwing away existing work.

### Phase 1 — Immediate improvements (stabilize the foundation)
- Fix the two **BREAKs** (`session.ts`, `isClientSessionExpired`) and session-key drift.
- **Unify scoring** (fast/full mode) — kill dual-truth.
- **Unify the three AI edit engines** behind one `AgentAction` contract (no UX change).
- Delete/settle orphans (empty stabilization roadmap, legacy registry utils).
- Land the pending shadow-read sprints (S7.4→) toward SQL cutover.
- Add test coverage on load-bearing engines (scoring, ROI, proposal gate).

### Phase 2 — Enterprise improvements
- **Wire repositories to routes; execute Phase 5 SQL cutover** (per-domain, gated).
- Harden auth (session model, RBAC surfaces consistent), finish multi-tenant isolation.
- Generalize the **approval/oversight layer** to any action type.
- Live **CRM + calendar (OAuth)** connectors; upgrade CRM derivation to bi-directional.
- Split `TeamDashboardNew` into a route-driven workspace shell (department-ready).

### Phase 3 — AI Workforce
- Stand up the **Agent runtime** + **Shared Memory** store (org-scoped, RLS).
- Register today's AI features as **named Workers** in the manifest.
- Ship the **Executive persona layer** (CEO/CFO/COO/CRO/CMO) over existing engines.
- Ship the **Manager layer** (one orchestrator, reused per department).
- Cortex Orchestrator = single entry that routes to department agents (wraps existing chat).

### Phase 4 — Business Operating System
- **Outreach Engine** (prospecting email → multi-channel), multi-account vault, sequences, approvals.
- Complete lifecycle edges: **Find → Warm** (front) and **Operate → Improve → Grow → Retain** (back).
- Auto-generated QBRs and performance reporting delivered on schedule.
- Browser-automation tool (approval-gated); meeting capture → memory.
- True **"hire Cortex"** onboarding: a business signs up, provisions an org, gets a staffed workforce.

### Phase 5 — Autonomous Company
- Agent↔agent delegation and communication at scale.
- Goal-driven executives set objectives; departments self-organize work within approval limits.
- Cortex operates and improves a client's business with human oversight as the control plane.
- Agent marketplace / department expansion (Product, Eng, HR, Legal, Security, Quality) fully staffed.

---

# PART 11 — FINAL REPORT

## Executive Summary

MARQ Cortex is a **well-architected, high-governance, AI-assisted revenue-and-delivery platform** for one consultancy — and a **credible foundation** for the far larger vision of Cortex-as-an-AI-company. Its strengths are real and rare: a provider-agnostic Intelligence Gateway, 35+ deterministic business engines under a strict "math decides, AI narrates" doctrine, a multi-tenant + RLS foundation, disciplined phased migration, and a Constitution-grade governance system.

The gap to the vision is **not architectural debt — it is unbuilt scope.** Cortex has built the *factory* (nervous system, calculators, tenancy, oversight) but has not yet *hired the workers*. There are no named agents, no departments-as-orgs, no shared memory, no agent-to-agent delegation, and no outreach/automation layer. AI capability today is *feature-attached*, not *workforce-organized*.

The path forward is **additive and safe**: stabilize the foundation, finish the SQL cutover, unify the scattered AI surfaces into one Agent Action Layer, then layer executives → managers → workers → memory → automation on top of the assets that already exist. **Preserve, improve, extend, unify — do not rebuild.**

## Scorecard

| Dimension | Score | Rationale |
|---|---|---|
| **Current Product** | **7.5 / 10** | Excellent as a consultancy revenue OS; polished, coherent, shipping. |
| **Architecture** | **9.0 / 10** | Gateway + deterministic engines + governance are top-tier. Points off for KV-still-authoritative and two known BREAKs. |
| **UX** | **7.0 / 10** | Polished dark UI; drift in dual scoring, session keys, overloaded "Cortex" naming, god-component dashboard. |
| **AI** | **6.0 / 10** | Great substrate (gateway, per-feature models, human override); no agents, memory, or autonomy yet. |
| **Business** | **7.0 / 10** | Strong mid-funnel (qualify→close→report); missing find/operate/grow/retain. |
| **Enterprise Readiness** | **6.5 / 10** | Tenancy + RLS + migration discipline present; SQL cutover unfinished, auth basic, test coverage thin. |
| **Scalability** | **7.0 / 10** | Phased migration well-designed but not executed; KV ceiling for multi-tenant load. |
| **Vision Alignment** | **2.5 / 10** | Factory built; workforce unbuilt. Reachable additively. |

## Product Drift Report (summary)
Localized, not systemic: **dual scoring**, **session-key drift**, **two data services**, **scattered AI entry points** (the biggest structural blocker), overlapping edit copilots, orphaned files, and two known runtime BREAKs. The macro drift is **positioning** — a workforce vision on a revenue-OS body.

## Current Strengths (LOCKED)
Intelligence Gateway · deterministic engines + "math decides" · governance system (Constitution/ARCHITECT/manifest) · frontend data gateway · multi-tenancy + RLS · phased migration discipline · human-in-the-loop oversight · 8-step AI Brain contract.

## Current Weaknesses
No agent runtime · no shared memory · no departments-as-orgs · AI feature-attached not workforce-organized · KV still authoritative · thin at lifecycle edges · no outreach/automation · known BREAKs and drift.

## Recommended Roadmap (one line)
**Stabilize → finish SQL cutover → unify AI into an Agent Action Layer → add Executives/Managers/Workers/Memory → build Outreach & Automation → operate autonomously with human oversight.**

## Quick Wins (start now)
1. Fix `session.ts` + `isClientSessionExpired` BREAKs and session-key drift.
2. Unify dual scoring behind one engine (fast/full mode).
3. Collapse the three AI edit engines into one `AgentAction` contract (no UX change).
4. Register existing AI features as named **Workers** in the manifest (zero runtime risk).
5. Stand up the **Executive persona layer** over existing engines (thin prompts, big narrative payoff).
6. Auto-schedule QBR generation (engine already exists).

## Long-term Vision
Cortex becomes a hireable AI company: a business signs up, provisions an org, and receives a staffed digital workforce — executives that set goals, managers that delegate, specialist workers that execute across email/CRM/calendar/browser, all sharing memory and operating under human oversight, with deterministic engines owning every number. MARQ owns the platform; every client runs their own tenant of the workforce.

---

*This document is the official MARQ Cortex Product Recovery source of truth. It is additive to — and governed by — the MARQ Cortex Constitution (v1.1). Where this document and the Constitution disagree on principle, the Constitution wins.*
