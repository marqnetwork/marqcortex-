# MARQ CORTEX — MASTER BLUEPRINT

**Document:** `MARQ_CORTEX_MASTER_BLUEPRINT_v1.0`
**Class:** Enterprise Master Blueprint — Definitive Source of Truth
**Owner & Steward:** MARQ Networks
**Status:** Part I LOCKED · Part II LOCKED · Part III LOCKED · Part IV LOCKED · Part V LOCKED · Part VI IN PROGRESS
**Governing authority:** Subordinate to `CORTEX_DNA_v1.0.md` (Part II). Where this blueprint and the Constitution conflict on identity, philosophy, or governance, the Constitution prevails (Part II, Chapter 25).
**Master rule:** The Master Blueprint is the authority; the codebase is the implementation. On conflict, Blueprint first, code second. Every future feature must exist in this Blueprint before implementation.

---

## How this document is organized

This Master Blueprint is a single, continuous, permanent document composed of **six Parts**. It is never split into separate documents. Together, the six Parts are intended to be complete enough that, if all source code were permanently lost, a world-class engineering organization could faithfully rebuild MARQ Cortex — and its approved future — from this document alone.

| Part | Phase | Subject | Status |
|------|-------|---------|--------|
| **Part I** | Phase 1 | Product Recovery — the verified structural state of the platform | **LOCKED** |
| **Part II** | Phase 2 | Cortex DNA — the Constitution: identity, philosophy, governance | **LOCKED** |
| **Part III** | Phase 3 | Product Blueprint — the complete, reality-first description of the product | **LOCKED** |
| **Part IV** | Phase 4 | AI Company Architecture — the AI-Workforce organizational model (executives, departments, managers, workers) | **LOCKED** |
| **Part V** | Phase 5 | Future Vision — the approved long-horizon direction | **LOCKED** |
| **Part VI** | Phase 6 | Execution Roadmap — the sequenced plan to realize the blueprint | **IN PROGRESS** |

Parts IV, V, and VI are approved elements of the final architecture. Parts IV and V are authored and LOCKED, and Part VI is authored and IN PROGRESS (Phase 6.1 complete) — each appended to this same document with continuous numbering. No content is invented ahead of its phase (Golden Rule 5).

**Preservation rule.** Parts I and II are constitutionally approved and are preserved here **by reference**, not by duplication. They are not restated, summarized, or altered in this document. All subsequent Parts cross-reference them (Golden Rules 1 and 8) and never contradict them. Part II (the Constitution) remains the governing authority on identity, philosophy, and governance; this Blueprint is the governing authority on product and architecture beneath it.

---

# PART I — PHASE 1: PRODUCT RECOVERY *(LOCKED — preserved by reference)*

Part I is the Product Recovery and Structural Audit of MARQ Cortex. It is **locked** and is not reproduced here.

**Authoritative Part I record:**
- `src/imports/cortex-audit-report.md` — Final Cortex System Audit (structural completeness of pre-sale, editability/copilot, and post-sign delivery cores).
- `ARCHITECT.md` — repository map, routes, engines, services, data flow, and known debt (the human-readable map referenced throughout Part III).
- `architecture/system_map.json` — machine-readable system snapshot.
- `src/imports/` — the engine, ROI, proposal, scope, execution, and diagnostic specifications that define behavior.

Part III treats Part I as settled fact and the source of every "CURRENT STATE" claim.

---

# PART II — PHASE 2: CORTEX DNA (THE CONSTITUTION) *(LOCKED — preserved by reference)*

Part II is the Constitution of MARQ Cortex. It is **ratified, APPROVED, and locked**, and is not reproduced here.

**Authoritative Part II record:** `CORTEX_DNA_v1.0.md` — 37 chapters covering identity, purpose, mission, vision, product/AI philosophy, human–AI authority, memory and data stewardship, decision framework, interpretation and precedence, customer promise, non-negotiables, ethics and governance, scope and boundaries, success metrics, amendment process, and final declaration.

Part III derives its authority from Part II. Every capability documented in Part III traces back to one or more constitutional principles from Part II, cited by chapter (e.g., *DNA Ch 17 — AI Philosophy*). Part III must never document a capability that violates Part II; where an observed behavior in the current system conflicts with the Constitution, Part III records it explicitly as **technical debt** (§III-78) rather than normalizing it.

---

# PART III — PHASE 3: PRODUCT BLUEPRINT

**Status:** LOCKED · **Numbering:** Sections III-1 through III-88 (plus appendices) · **Continuity:** this Part is generated across multiple passes; numbering and formatting are continuous and are never restarted.

## Reading conventions for Part III

Part III documents **reality before vision** (Golden Rule 6). Every section separates:

- **CURRENT STATE** — implemented and verifiable in the repository as of ratification. Evidence is cited by file path. Confidence tags from the Part I discipline apply: *PROVEN* (verified in code/artifact), *PARTIAL* (present but incomplete or not wired), *DEBT* (present but known-broken or drifting).
- **APPROVED FUTURE STATE** — approved by the Constitution or the roadmap but **not yet implemented**. Nothing here is invented; future items trace to Part II or to `MARQ_CORTEX_ROADMAP.md`. Where a section has no approved future work, it says so.

Every feature-level section additionally answers the enterprise quality template: *Why it exists · Business problem · Who uses it · How it works · Inputs · Outputs · Dependencies · Business Rules · Validation Rules · Failure Conditions · Recovery · Security · AI Involvement · Current State · Approved Future State.*

Every section closes with a **Traceability** line linking it to: Constitution principle (Part II), business objective, product module, business workflow, core engine, AI capability, and roadmap item where applicable (Golden Rule: nothing exists without a traceable purpose).

**Canonical terms** (defined fully in DNA Ch 34): *AI Workforce, Business Engine, Intelligence Gateway, Maximum Intelligence–Minimum Complexity, Math decides / AI narrates, Entrenched Core.*

---

## III-1 — Product Overview

**Why it exists.** MARQ Cortex exists to give any business access to an intelligent workforce that produces measurable business outcomes without requiring the business to manage complexity (DNA Ch 5 — Purpose). The overview establishes what the product *is today* versus what it is *committed to becoming*, so that no reader confuses the current implementation with the approved identity.

**What Cortex is (identity).** Cortex is MARQ Networks' flagship **AI Workforce Platform** — an AI company that operates on behalf of businesses through executives, departments, managers, workers, business engines, reasoning systems, memory systems, automation, business intelligence, and enterprise governance (DNA Ch 8). This is the **approved and permanent model**, realized progressively (DNA Ch 8.3).

**What Cortex is today (implementation).**

- **CURRENT STATE (PROVEN).** As implemented, Cortex is a single-page web application plus an edge API that runs a complete business pipeline for an AI-readiness advisory motion: **public diagnostic funnel → readiness scoring → recommendation generation → ROI modeling → proposal governance and export → contract generation → post-sign execution delivery → live ROI actuals → quarterly business review (QBR)**. The internal product name of record is *"MARQ Cortex — AI Readiness Diagnostic Platform"* (`ARCHITECT.md` §1). Intelligence is delivered through a provider-agnostic Intelligence Gateway; authoritative numbers are produced by deterministic engines, and AI narrates them (DNA Ch 17; `ARCHITECT.md` §0 "Math decides; AI narrates").
  - Frontend: React 18 + TypeScript + Vite 6 + Tailwind v4 + react-router v7 (hash routing). Theme: Eclipse dark `#0A0A0F`.
  - Backend: Supabase Edge Functions (Deno) + Hono, base path `/make-server-324f4fbe`.
  - Runtime store: KV table `kv_store_324f4fbe` (authoritative); a relational foundation exists but is not yet authoritative (phased migration).
  - Intelligence: Intelligence Gateway with OpenAI and mock providers.
- **APPROVED FUTURE STATE.** Progressive realization of the full AI-Workforce organization (executives/managers/workers as first-class runtime constructs; the data platform records `ai_worker` service-account identity as *Future* — DNA Ch 8.3); relational store becomes authoritative after per-domain cutover (§III-37); natural-language and later voice interaction (DNA Ch 15–16).

**Who uses it.** Three primary actors — the **public prospect** (diagnostic funnel), the **internal team** (MARQ operators using the team dashboard), and the **client** (a signed customer using the client portal). Full treatment in §III-6/§III-7.

**Traceability.** DNA Ch 2/5/8/8.3 · Objective: deliver measurable outcomes with minimum complexity · Modules: all · Workflows: §III-28/29 · Engines: `core/index.ts` orchestrator · AI: Intelligence Gateway · Roadmap: full-workforce realization.

---

## III-2 — Product Scope

**Why it exists.** Scope defines the field of play — what Cortex is *for* — so that additions can be judged for fit (DNA Ch 31 — Platform Scope).

**In scope (CURRENT STATE — PROVEN).** The full advisory lifecycle: **diagnose** (industry-selected questionnaire), **quantify** (readiness scoring across fixed business domains), **prioritize** (recommendation portfolio with deterministic ranking), **plan** (proposal with governance gate, immutable snapshot, executive export, contract), **execute** (execution blueprint: workstreams/milestones/tasks/gates, scope-change control), and **measure** (ROI actuals tracking, QBR and opportunity engine). Editability everywhere via universal blocks + revisions; an AI copilot for block-level and global patch assistance.

**In scope (APPROVED FUTURE STATE).** Same method extended across industries and toward the full workforce model; deeper automation and memory; natural-language and voice surfaces (DNA Ch 15–16, 31).

**Out of scope (permanent — CURRENT & FUTURE).** Anything crossing the Platform Boundaries of DNA Ch 32: Cortex is not a substitute for regulated legal/medical/financial advice; it does not claim full autonomy where humans must decide (DNA Ch 18); it does not push complexity onto users; it is not a single-industry tool. Scope never overrides the boundaries.

**Business rules.** A capability enters scope only if it passes the Six Constitutional Questions (DNA Ch 24). Scope defines the field; the decision framework decides what enters it.

**Traceability.** DNA Ch 31/32/24 · Objective: coherent lifecycle coverage · Modules: §III-23/24/25 · Workflows: §III-29 · Engines: all core · AI: gateway features · Roadmap: industry/workforce expansion.

---

## III-3 — Product Vision (Implementation)

**Why it exists.** To translate the constitutional Vision (DNA Ch 7) into an *implementation-facing* north star without inventing features (Golden Rule 5) or restating Part II.

**CURRENT STATE (PROVEN).** The implemented product already expresses the vision in miniature: a business's answers mobilize a coordinated set of engines and AI features that produce a boardroom-grade result (diagnosis → ROI → proposal → execution) through a simple, guided UI. The "workforce" today is realized as the deterministic engine orchestra (`runCortexEngine`, §III-21) plus gateway-mediated AI narration, presented behind a single, calm interface (DNA Ch 11–12).

**APPROVED FUTURE STATE.** The same experience deepens toward the literal AI-company model: named executive/manager/worker roles operating with authority bounds (DNA Ch 18), compounding memory (DNA Ch 19), and progressive disclosure from beginner to enterprise (DNA Ch 14). Interaction advances GUI → natural language → voice → multimodal (DNA Ch 15). Voice is deferred until production maturity (DNA Ch 16).

**Business rule.** Every step toward the vision must be additive and must keep the experience simpler, not more complex (DNA Ch 23).

**Traceability.** DNA Ch 7/14/15/16/23 · Objective: effortless capability · Modules: all · Workflows: all · Engines: orchestrator · AI: all gateway features · Roadmap: interaction-model progression.

---

## III-4 — Product Boundaries

**Why it exists.** Boundaries are the edges of scope — what Cortex will not do or become regardless of demand (DNA Ch 32). Documenting them prevents drift during a decade of feature pressure.

**CURRENT STATE (PROVEN — enforced in product).**
- **Authority boundary.** The product does not execute irreversible actions autonomously; team/client actions gate state changes (proposal send, scope changes, status transitions). Human review is required for high-consequence steps (DNA Ch 18.9).
- **Advisory boundary.** Proposal governance (Phase 1 Ready Gate) explicitly blocks vague claims, requires quantified statements, and forbids guaranteed-results language and full-autonomy AI claims (`src/imports/phase1-gate-criteria.md`).
- **Honesty boundary.** Deterministic engines own numbers; AI cannot override authoritative ROI/scoring (`ARCHITECT.md` §0; DNA Ch 17).
- **Experience boundary.** The public funnel is designed for a non-technical user to complete in minutes (instant scoring, guided questions).

**APPROVED FUTURE STATE.** As autonomy and automation grow, the boundaries hold and tighten (DNA Ch 32); the high-consequence classification floor (DNA Ch 18.9) governs any expansion of autonomous action.

**Failure/Recovery.** A boundary crossing is treated as a defect: the offending capability is reverted and recorded as debt (§III-78). Boundaries are amendable only through the Constitution's process (DNA Ch 35).

**Traceability.** DNA Ch 32/18/17 · Objective: durable trust · Modules: proposal, execution · Workflows: §III-29/31 · Engines: `proposalGateEngine`, `scopeEngine` · AI: gateway (bounded) · Roadmap: autonomy governance.

---

## III-5 — Business Domains

**Why it exists.** Cortex reasons about a business as a set of fixed domains so diagnosis is systematic rather than ad hoc (DNA Ch 31). This is the analytical backbone of the diagnostic and recommendation engines.

**Who uses it.** The scoring and recommendation engines (internally); operators and clients see the results as domain scores and prioritized recommendations.

**How it works (CURRENT STATE — PROVEN).** The department-scanning model evaluates a business across fixed domains and scores each on four axes: `problem_density_score`, `impact_potential_score`, `automation_feasibility_score`, `risk_exposure_score` (0–10) (`src/imports/cortex-rules.md`). The canonical domains are:

1. Revenue Engine
2. Customer Experience
3. Operations & Supply Chain
4. Marketing & Acquisition
5. Finance & Unit Economics
6. Data & Infrastructure
7. Talent & Process

**Business rules.** A recommendation is created for a domain **only if** `problem_density ≥ 6` AND `impact_potential ≥ 6` (prevents low-value noise). Priority ranking is deterministic: `priority = impact×0.4 + automation_feasibility×0.3 + problem_density×0.2 − risk_exposure×0.1`; sort descending. Portfolio guardrail: 5–7 recommendations maximum; keep top 7 by priority (`src/imports/cortex-rules.md`; DNA Ch 6 principle "math decides"). Relational persistence exists as `domain_scores` (§III-37).

**Inputs / Outputs.** Inputs: normalized diagnostic answers per domain. Outputs: per-domain four-axis scores, qualified recommendations, ranked portfolio, dependency map.

**AI involvement.** None in the scoring itself (deterministic). AI narrates domain results downstream (DNA Ch 17).

**APPROVED FUTURE STATE.** Domains map onto the AI-Workforce "departments" (DNA Ch 8) as those become first-class runtime constructs; additional industry-specific domain calibrations.

**Traceability.** DNA Ch 31/8/6 · Objective: systematic diagnosis · Module: diagnostic/recommendation · Workflow: §III-29 · Engines: `scoringEngine`, `decisionEngine`, `portfolioEngine` · AI: narrative only · Roadmap: department realization.

---

## III-6 — User Types

**Why it exists.** Clear actor definitions are the basis for authentication, authorization, UI surfaces, and journeys (DNA Ch 13; §III-40/41).

**CURRENT STATE (PROVEN).** Three implemented user types plus system/dev surfaces:

| User type | Surface | Auth | Storage key / TTL |
|-----------|---------|------|-------------------|
| **Public prospect** | Landing → funnel (`#/`, `#/get-started`, `#/diagnostic`, `#/score`) | ANON (public anon key) | none (session state in `AppContext`) |
| **Team member (operator)** | Team dashboard (`#/team/*`) | Supabase Auth JWT | `marq_cortex_team_session`, 8h |
| **Client (signed customer)** | Client portal (`#/client/*`) | Email-verify session token `client_{uuid}` | `marq_cortex_client_session`, 8h |
| **Developer/administrator** | `#/architecture`, `#/registry` | (team-gated in practice) | n/a |

Demo team credentials exist for non-backend mode (`ARCHITECT.md` §8). Team roles are carried in `user_metadata.teamRole` and, in the relational foundation, `organization_memberships` (§III-42/44).

**APPROVED FUTURE STATE.** Formalized role hierarchy backed by relational `roles`/`permissions` tables once wired to routes (§III-42/43); organization-scoped multi-tenant membership as the primary identity model (§III-44).

**Security.** Team routes require a valid JWT; client routes require a valid client session; boundary between the two is enforced by token prefix (`client_`) (§III-40; API_SPECIFICATIONS Group 3).

**Traceability.** DNA Ch 13/18 · Objective: right surface per actor · Modules: auth, portal, dashboard · Workflows: §III-8/28 · Engines: `roleEngine` · AI: n/a · Roadmap: relational RBAC.

---

## III-7 — Personas

**Why it exists.** Personas give the abstract user types concrete goals, so UX and workflow decisions serve real needs (DNA Ch 13). Personas below are derived from the implemented surfaces; none are invented beyond observed product intent.

**CURRENT STATE (derived from implemented surfaces).**

- **The Prospect ("first-time, non-technical business owner").** Goal: understand their AI-readiness quickly and see whether Cortex is worth engaging. Needs: instant, jargon-free result within minutes (DNA Ch 11). Surface: public funnel + instant score.
- **The Operator ("MARQ team member / reviewer / revenue").** Goal: triage submissions, run analysis, build and govern proposals, manage execution and client comms. Needs: coordinated dashboard, AI assistance that never overrides the math, auditability. Surfaces: team dashboard panels (`dashboard, cortex, team, settings, reviewer, analytics, emails, revenue, mapping, execution, architecture`).
- **The Client ("signed customer stakeholder").** Goal: see their readiness report, solution, proposal, and delivery progress; communicate; approve. Needs: a calm, fixed, trustworthy portal (8 fixed tabs). Surface: client portal.
- **The Administrator/Developer.** Goal: understand and govern the system (registry, architecture, settings). Surfaces: `#/registry`, `#/architecture`, `SettingsPage`.

**APPROVED FUTURE STATE.** Progressive-complexity personas (beginner → growing → power user → enterprise) each unlocking capability only when it creates value (DNA Ch 14).

**Traceability.** DNA Ch 13/14 · Objective: serve real user goals · Modules: all UI · Workflows: §III-28 · Engines: n/a · AI: copilot/chat assist · Roadmap: progressive-complexity tiers.

---

## III-8 — User Lifecycle

**Why it exists.** The user lifecycle defines how an individual moves through Cortex, which drives session, state, and notification design (DNA Ch 13; §III-11).

**CURRENT STATE (PROVEN).**

- **Prospect lifecycle:** land → (optional lead-magnet capture) → diagnostic questionnaire → instant score computed client-side (`utils/instantScoring.ts`) → score page → (live mode) submission created (`dataService.createSubmission`). Lead is captured to KV (`lead:{id}`, `lead_email:{email}`); submission to KV (`sub:{id}`, `sub_email:{email}`); team notification + email fired (API_SPECIFICATIONS Groups 2/4).
- **Operator lifecycle:** team login (JWT, 8h) → dashboard → work items (submissions, proposals, execution, comms) → logout/expiry.
- **Client lifecycle:** email verification issues a `client_{uuid}` session (8h) → portal access to their submission's report/solution/proposal/messages → proposal response.

**Business rules.** Sessions expire at 8h; expired team tokens return `401` on `/test-auth` and protected routes. Client verification is required before protected client routes (F-003).

**Failure/Recovery.** Known debt affects client-session helpers (`isClientSessionExpired` missing; `session.ts` missing) — see §III-78; recovery path is documented there. On backend-unreachable, the app falls back to demo data silently when `SHOW_API_ERRORS=false` (§III-56).

**APPROVED FUTURE STATE.** Unified relational identity/membership lifecycle; richer re-engagement (nurture) automation (§III-48).

**Traceability.** DNA Ch 13 · Objective: smooth actor progression · Modules: auth, funnel, portal, dashboard · Workflows: §III-28 · Engines: `roleEngine`, `crmEngine` · AI: none in lifecycle gating · Roadmap: relational identity.

---

## III-9 — Organization Lifecycle

**Why it exists.** Cortex is multi-tenant by constitutional mandate (data isolation, DNA Ch 20). The organization is the tenant boundary.

**CURRENT STATE (PARTIAL).** The relational tenancy foundation defines `organizations`, `organization_memberships`, and `organization_settings` with RLS helpers (`supabase/migrations/20260711050000_cortex_tenancy_foundation.sql`; `ARCHITECT.md` §6). At runtime, KV remains authoritative and organization scoping is **seeded manually** and **not yet wired to all routes** — so the organization lifecycle (create tenant → add members → scope data → configure settings) exists in schema and repositories (`tenancyRepository.ts`) but is not yet the live runtime path (*PARTIAL*).

**Business rules.** All relational business data is organization-scoped; RLS is mandatory on tenant and diagnostic tables; service-role bypass is allowed only for migration/backfill/platform-admin with explicit org scoping (Operating Constitution Art. 5; DNA Ch 20).

**APPROVED FUTURE STATE.** Full organization lifecycle as the primary runtime tenancy model after per-domain SQL cutover (§III-37): self-serve org creation, membership management, org settings, and per-org billing/licensing (§III-46/47).

**Failure/Recovery.** Until cutover, tenant isolation is enforced primarily at the application/KV layer; the relational RLS provides defense-in-depth once authoritative. Migration safety is governed by reconciliation gates (§III-37).

**Traceability.** DNA Ch 20 · Operating Constitution Art. 4/5 · Objective: tenant isolation · Module: tenancy · Workflow: §III-44/45 · Engine: repositories · AI: n/a · Roadmap: SQL cutover, self-serve org.

---

## III-10 — Product Lifecycle

**Why it exists.** Documents how a unit of client value moves end-to-end through Cortex — the spine that every module serves.

**CURRENT STATE (PROVEN).** The product lifecycle (the "deal/engagement lifecycle") is:

`Lead → Diagnostic Submission → Readiness Score → Recommendation Portfolio → ROI Model → Proposal (draft → Ready Gate → snapshot → export/send) → Contract → Signed Engagement → Execution Blueprint (workstreams/milestones/tasks/gates) → Scope Control (change orders/versioning) → ROI Actuals → QBR / Opportunity.`

Pre-sale, editability/copilot, and post-sign delivery cores are all structurally present (Part I audit). Status transitions are governed (e.g., proposal `draft → internal_review → ready_to_send → sent`; snapshot immutability on send — `src/imports/proposal-p2-implementation.md`, `phase1-gate-criteria.md`).

**Business rules.** Gate before advance: a proposal cannot progress to internal review unless the Phase 1 Ready Gate passes; export/send freezes an immutable snapshot; exports read only from the snapshot; export is blocked if `roi_recalc_required`, `validation_passed=false`, or `contract_invalidated` (§III-29).

**APPROVED FUTURE STATE.** Deeper automation across transitions; memory-informed recommendations that compound across a client's lifecycle (DNA Ch 19).

**Traceability.** DNA Ch 31/8 · Objective: end-to-end value delivery · Modules: all · Workflow: §III-29 · Engines: full orchestra · AI: narrate/assist at each stage · Roadmap: lifecycle automation.

---

## III-11 — State Management

**Why it exists.** Correct state handling is the difference between a trustworthy system and a corrupting one (immutable snapshots, audit trails). This section documents where state lives and how it is governed.

**CURRENT STATE (PROVEN).**
- **Client-side session/UI state:** React Contexts — `AppContext` (contact, score, team/client sessions, submitting flag; MQC-HOOK-004), `DashboardContext` (search, filters, cortex view, kanban alerts; persisted to `localStorage`; MQC-HOOK-005), `GlobalAIChatContext` (chat history, section context; MQC-HOOK-006) (`ARCHITECT.md` §13). Provider order is fixed: `GlobalAIChatProvider` (outer) → `DashboardProvider` (inner) in `TeamDashboardLayout`.
- **Server/runtime state:** KV store `kv_store_324f4fbe` is authoritative — leads, submissions, proposals, snapshots, messages, notifications, notes, pipeline positions, email queue, engagement logs.
- **Immutable state:** proposal snapshots are frozen on send with a `version_hash` (sha256) and are never mutated; version increments on post-snapshot edits (`src/imports/proposal-p2-implementation.md`).
- **Deterministic derived state:** scores, ROI, portfolios recomputed by pure engines from inputs (no hidden state; `core/` rule "pure functions, no side effects").

**Business rules.** Runtime authority does not change during infrastructure work (Operating Constitution Art. 12/17). Snapshots are append-only; edits after snapshot create a new version, never mutate the frozen record.

**Failure/Recovery.** Session key drift is known debt (some components read `team_access_token`/`team_user` vs `marq_cortex_team_session`) — §III-78. Offline state handled by `useOnlineStatus` + `OfflineBanner`.

**APPROVED FUTURE STATE.** Relational state as authoritative post-cutover (§III-37), with the same immutability and audit guarantees; unified session store resolving key drift.

**Traceability.** DNA Ch 17/20 · Operating Constitution Art. 6/12/17 · Objective: trustworthy state · Modules: all · Workflow: §III-29 · Engines: `snapshotEngine`, `versionEngine` · AI: n/a · Roadmap: SQL authority.

---

## III-12 — Domain Model

**Why it exists.** The domain model is the vocabulary of the entire product; every module, API, and table references it. (Full entity/relationship detail is in §III-37/38; this section defines the conceptual model.)

**CURRENT STATE (PROVEN).** Core domain entities and their meaning:

- **Lead** — an early captured contact (name/email/phone/website) before or without a full diagnostic. KV: `lead:{id}`, `lead_email:{email}`; relational: `leads`, `lead_sources`, `lead_tags`.
- **Contact** — a person/company identity; relational: `contacts`, `contact_methods`.
- **Submission** — a completed diagnostic (industry + answers + readiness score). KV: `sub:{id}`, `sub_email:{email}`; relational: `submissions`, `submission_sections`, `diagnostic_answers`.
- **Score** — readiness scoring output: overall + per-domain. Relational: `diagnostic_scores`, `domain_scores`.
- **Recommendation / Portfolio** — qualified, ranked domain recommendations with dependencies (engine output; portfolio guardrail 5–7).
- **ROI Model** — base + DCF + IRR + Monte Carlo + scenario + cost outputs (engine-owned).
- **Proposal** — sectioned, block-based document with governance status; **Proposal Snapshot** — immutable frozen version with `version_hash`.
- **Contract** — generated agreement derived from the accepted proposal/scope.
- **Report** — client-facing readiness/strategic report; relational: `reports`, `report_versions`.
- **Execution artifacts** — workstreams, milestones, tasks, gates; change orders and versions.
- **Outcome / ROI Actuals** — measured post-sign results; relational: `outcomes`.
- **Organization / Membership / Role / Permission** — tenancy and RBAC (relational).
- **Notification / Note / Message / Engagement event / Email-queue item / Pipeline position** — operational entities (KV).
- **Migration entities** — `migration_runs`, `migration_checkpoints`, `migration_quarantine`, `migration_reconciliation_log` (governed migration).

**Business rules.** Every business entity is (or will be) organization-scoped (DNA Ch 20). Deterministic outputs (Score, ROI, Portfolio) are derived, not authored — they are recomputed from inputs.

**APPROVED FUTURE STATE.** Relational model becomes authoritative (§III-37); AI-worker/agent identity entities added as the workforce model is realized (`ai_worker` service accounts — DNA Ch 8.3).

**Traceability.** DNA Ch 8/19/20 · Objective: shared vocabulary · Modules: all · Workflow: §III-29 · Engines: all · AI: narrate over model · Roadmap: relational authority, agent identity.

---

## III-13 — Platform Architecture

**Why it exists.** Defines the macro shape of the platform so it can be rebuilt: the layers, their responsibilities, and the one-way dependencies between them.

**CURRENT STATE (PROVEN).** Cortex is a **client–edge–store** architecture with a strict frontend data gateway and a provider-agnostic intelligence layer:

```
[ Browser SPA ]  React 18 · Vite · Tailwind v4 · hash router
      │  (components import data ONLY from dataService.ts)
      ▼
[ Frontend Gateway ]  src/app/services/dataService.ts  ── demo? ──► demo/seed data
      │  (HTTP details isolated in app/lib/api.ts + config/api.config.ts)
      ▼
[ Edge API ]  Supabase Edge Function (Deno + Hono)  base /make-server-324f4fbe
      │                                   │
      ▼                                   ▼
[ KV Store ]  kv_store_324f4fbe     [ Intelligence Gateway ]  provider-agnostic
  (authoritative runtime)                │  ──► OpenAI adapter | mock provider
[ Relational foundation ]  (present,     └─ telemetry · model registry · certification · health
   not yet authoritative — phased)
[ Deterministic Engines ]  src/app/core/ (pure, no React, no LLM) — run in the browser
```

**Architectural golden rules (enforced, `ARCHITECT.md` §0).** Components import data only from `dataService.ts`; never import `app/lib/api` from components; hash router (iframe/Figma-Make compatibility); only the landing route is eager, all others lazy; core engines are pure functions; PDF export uses dynamic `import()`; new files get a manifest ID before implementation.

**Dependencies.** SPA → dataService → (demo | api) → edge → (KV | Intelligence Gateway → provider). Engines are called in-browser by the orchestrator and depend on nothing external.

**APPROVED FUTURE STATE.** Relational store becomes the authoritative platform after per-domain cutover (Operating Constitution Art. 4; §III-37). Additional providers behind the same gateway contract (DNA Ch: provider independence; Operating Constitution Art. 2).

**Traceability.** DNA Ch 11/17 · Operating Constitution Art. 2/3/4 · Objective: rebuildable macro-architecture · Modules: all · Workflow: §III-29 · Engines: `core/` · AI: gateway · Roadmap: SQL authority, multi-provider.

---

## III-14 — System Architecture

**Why it exists.** Where §III-13 gives the macro shape, this section documents the concrete runtime pieces, their identifiers, and how they are wired — the level of detail needed to reconstruct the system.

**CURRENT STATE (PROVEN).**

- **Entry/boot:** `index.html` → `src/main.tsx` (CSS, mount guard, global error UI, dynamic `import('@/app/App')`) → `src/app/App.tsx` (`createHashRouter`, per-route `makeLazy()`) → `pages/RootLayout.tsx` (`AppProvider` → `ErrorBoundary` → `OfflineBanner` → outlet) (`ARCHITECT.md` §3).
- **Routing:** hash routes for landing, funnel (`get-started`, `diagnostic`, `score`), team (`login`, `dashboard`, `execution`), client (`login`, `portal`), and dev (`architecture`, `registry`); landing eager, rest lazy; auth guards on team/client routes (§III-40).
- **Team dashboard:** a shell (`TeamDashboardLayout`) hosting internal `PageView` panels (`dashboard, cortex, team, settings, reviewer, analytics, emails, revenue, mapping`) plus hash-routed `execution` and `architecture` (`ARCHITECT.md` §9).
- **Backend:** single Hono app (`supabase/functions/server/index.tsx`) exposing ~79 route handlers (documented as the 68 canonical endpoints in `API_SPECIFICATIONS.md`), with CORS and a 120 req/min-per-IP rate limit; KV persistence (`kv_store.tsx`); AI modules (`cortexChat.ts`, `cortexAnalysis.ts`, `cortexNarrative.ts`, `blockAiAssist.ts`, `copilotPatch.ts`); Intelligence Gateway (`intelligence/`); email (`emailService.ts` via Resend).
- **Engines:** 35 deterministic engines under `src/app/core/` orchestrated by `runCortexEngine()` in `core/index.ts` (§III-21/22).
- **Registry:** `src/system/manifest.ts` — 158 nodes with `MQC-{TYPE}-{NNN}` IDs and status (`LIVE|DEMO|GATED|SYSTEM`); validator `src/system/validate.ts`; UI viewer `#/registry` (§III-26).
- **Config/flags:** `src/config/features.ts` (`BACKEND_INTEGRATION`, `SHOW_API_ERRORS`, `VERBOSE_LOGGING`), `api.config.ts` (endpoints), `runtime.ts` (§III-53).

**Failure/Recovery.** Global error boundary + mount guard render a fallback UI on boot failure; offline banner on connectivity loss; demo fallback when backend unreachable and errors suppressed.

**APPROVED FUTURE STATE.** Repositories (`server/repositories/*`) wired as the authoritative access path after cutover; expanded route set for relational domains; additional gateway providers.

**Traceability.** DNA Ch 11/17 · Operating Constitution Art. 2/3/14 · Objective: reconstructable runtime · Modules: all · Workflow: §III-29 · Engines: `core/index.ts` · AI: `intelligence/` · Roadmap: repository cutover.

---

## III-15 — AI Architecture

**Why it exists.** Cortex's intelligence must be powerful yet governed — explainable, auditable, permission-bounded, and never able to override authoritative math (DNA Ch 17). The AI architecture is how that governance is made real.

**Who uses it.** Operators (chat, analysis, block assist, copilot) and, indirectly, clients (AI-narrated reports). Engines never call AI; AI never computes authoritative numbers.

**How it works (CURRENT STATE — PROVEN).** All model access is mediated by a single provider-agnostic **Intelligence Gateway** on the edge (`supabase/functions/server/intelligence/gateway.ts`, node `MQC-SVC-010`). AI features are exposed only through `dataService` methods, which call edge routes, which call the gateway, which calls a provider adapter:

```
Component → dataService.{chatWithAI|generateCortexNarrative|analyzeSubmission|blockAIAssist|copilotInterpret}
          → api.ts → Edge route → Intelligence Gateway → provider adapter (OpenAI | mock)
```

Implemented AI features (all narration/assistance, never authority): AI Chat (`cortexChat.ts`), Submission Analysis (`cortexAnalysis.ts`), Portfolio/Cortex Narrative (`cortexNarrative.ts`), Block-level AI assist (`blockAiAssist.ts` + `aiAssistEngine.ts`), Cortex Copilot patch engine (`copilotPatch.ts` + `copilotEngine.ts`), Objection handling (`objectionEngine.ts`). Auth: team token from `AppContext`, falling back to anon key. Demo mode returns mock responses with no provider or edge fetch (`ARCHITECT.md` §7/12).

**Inputs / Outputs.** Inputs: normalized contracts (submission data, block content, chat context). Outputs: normalized narration/assist payloads — provider-specific fields never leak upstream (Operating Constitution Art. 2).

**Business/Validation rules.** Deterministic engines own scoring/ROI/prioritization; AI may not override them (DNA Ch 17; `ARCHITECT.md` §0). Every AI-surfaced decision must be explainable (DNA Ch 17.2) and auditable (17.3). Provider names/model IDs must not be hardcoded in business logic (Operating Constitution Art. 2).

**Failure/Recovery.** Per-feature gateway rollback flags `INTELLIGENCE_USE_GATEWAY_*` (default true) allow disabling gateway routing per feature; timeouts and retries via `INTELLIGENCE_TIMEOUT_MS` / `INTELLIGENCE_MAX_RETRIES`; on provider failure, features degrade or return errors surfaced under `SHOW_API_ERRORS`. Telemetry (`telemetry.ts`) and health (`health.ts`) provide observability (§III-62).

**Security.** AI routes are auth-gated; secrets (`OPENAI_API_KEY`) live only in edge secrets, never in code or reports (Operating Constitution Art. 13; DNA Ch 20).

**APPROVED FUTURE STATE.** Additional providers behind the same contract; AI organized as the workforce (executives/managers/workers) with authority bounds (DNA Ch 8/18); compounding memory feeding AI context (DNA Ch 19).

**Traceability.** DNA Ch 17/8/18/19 · Operating Constitution Art. 2/13 · Objective: governed intelligence · Modules: AI features · Workflow: §III-18 · Engines: `copilotEngine`, `aiAssistEngine`, `objectionEngine` · AI: Intelligence Gateway · Roadmap: multi-provider, workforce agents.

---

## III-16 — AI Decision Architecture

**Why it exists.** To make explicit the single most trust-critical rule of the platform: **which decisions are made by math and which are narrated by AI** (DNA Ch 17.1; Operating Constitution Art. 6).

**How it works (CURRENT STATE — PROVEN).**
- **Deterministic decisions (authoritative):** readiness scoring (`scoringEngine`), recommendation qualification and ranking (`decisionEngine`, `portfolioEngine`), ROI/DCF/IRR/Monte-Carlo/scenario/cost (`roiEngine` et al.), proposal gate pass/fail (`proposalGateEngine`), scope-change impact (`scopeEngine`, `changeImpactEngine`), execution assembly (`executionEngine`, `templateAssembler`). These are pure functions with defined inputs/outputs and no AI.
- **AI-narrated / assistive (non-authoritative):** explanation of scores and portfolios, executive-brief prose, block suggestions, copilot patch proposals, objection responses. AI proposes; humans and deterministic gates dispose.
- **Human-authorized decisions:** proposal send, scope acceptance, status transitions, client approval — gated by operators/clients (DNA Ch 18).

**Business rules.** Math decides priority; AI only explains (`ARCHITECT.md` §0). No AI output changes an authoritative number without an explicit, governed change (DNA Ch 17.1). High-consequence transitions require a human in the loop (DNA Ch 18.9).

**Validation.** Proposal Ready Gate enforces quantified, non-vague, human-reviewable content before advance (`phase1-gate-criteria.md`); export blocked if validation fails (§III-29).

**APPROVED FUTURE STATE.** Formal decision registry linking each decision type to its owner (engine vs AI vs human) and to the authority doctrine (DNA Ch 18); expanded autonomy only upward from the high-consequence floor (DNA Ch 18.9).

**Traceability.** DNA Ch 17/18 · Operating Constitution Art. 6 · Objective: trustworthy decisions · Modules: engines + AI · Workflow: §III-31 · Engines: all deterministic · AI: narration only · Roadmap: decision registry.

---

## III-17 — AI Gateway (Intelligence Gateway)

**Why it exists.** Provider independence and normalized contracts protect Cortex from lock-in and keep provider details out of business logic (Operating Constitution Art. 2; DNA provider-independence principle).

**How it works (CURRENT STATE — PROVEN).** The Intelligence Gateway (`supabase/functions/server/intelligence/`) comprises: `gateway.ts` (routing/orchestration), `contracts.ts` (normalized request/response contracts), `providerRegistry.ts` + `providers/` (`openaiAdapter.ts`, `mockProvider.ts`), `modelRegistry.ts` (model selection/overrides), `config.ts`/`env.ts` (configuration), `telemetry.ts` (metrics), `health.ts` (health checks), `certification.ts` (provider certification), `featureBridge.ts` (per-feature routing/rollback), `errors.ts`, `bootstrap.ts`, and tests (`gateway.test.ts`, `testSetup.ts`). Tested via `npm run test:intelligence`.

**Inputs / Outputs.** Inputs: feature name, normalized prompt/context, model override, auth. Outputs: normalized completion; telemetry event. Provider-specific fields are normalized out (Art. 2).

**Configuration (edge secrets).** `INTELLIGENCE_PROVIDER` (default `openai`), `INTELLIGENCE_TIMEOUT_MS`, `INTELLIGENCE_MAX_RETRIES`, `INTELLIGENCE_USE_GATEWAY_*` (per-feature, default true), model overrides `INTELLIGENCE_MODEL_NARRATIVE` etc. (`ARCHITECT.md` §12).

**Failure/Recovery.** Timeouts, bounded retries, per-feature rollback to legacy path, mock provider for demo/tests; health endpoint reports gateway state.

**Security.** API keys in edge secrets only; no secret ever stored in generated reports or tracked docs (Art. 13).

**APPROVED FUTURE STATE.** Additional certified providers; richer model-routing policies; cost/latency-aware selection — all behind the unchanged contract.

**Traceability.** DNA Ch 17 · Operating Constitution Art. 2/13 · Objective: provider independence · Module: intelligence gateway · Workflow: §III-18 · Engine: n/a (edge service) · AI: all features · Roadmap: multi-provider certification.

---

## III-18 — AI Orchestration

**Why it exists.** Orchestration is how a request becomes coordinated intelligence — the current, modest expression of the AI-Workforce model (DNA Ch 8).

**How it works (CURRENT STATE — PROVEN).** Orchestration today is feature-scoped and mediated by `dataService` + edge modules + gateway. Each AI feature has a defined path (chat, narrative, analysis, block assist, copilot). The **deterministic** orchestration — the closest thing to a "workforce coordinating" today — is `runCortexEngine()` in `core/index.ts`, which sequences `inputNormalizer → scoringEngine → decisionEngine → templateAssembler (+ ROI)` (§III-21). AI narration wraps the deterministic outputs; it does not sequence business logic.

**Business rules.** Orchestration must preserve the math/AI separation (DNA Ch 17); no feature may chain AI calls in a way that lets a generated result become an authoritative number.

**APPROVED FUTURE STATE.** True multi-agent orchestration — executives set direction, managers sequence, workers execute — with authority bounds and escalation (DNA Ch 18), and memory-informed context (DNA Ch 19). The data platform already reserves `ai_worker` service-account identity as *Future* (DNA Ch 8.3).

**Traceability.** DNA Ch 8/17/18/19 · Objective: coordinated intelligence · Modules: AI + engines · Workflow: §III-29/31 · Engine: `core/index.ts` orchestrator · AI: gateway features · Roadmap: multi-agent orchestration.

---

## III-19 — Knowledge Architecture

**Why it exists.** Cortex's judgments depend on structured knowledge: the questionnaire, scoring rubric, domain model, sprint templates, and objection library. This section documents where knowledge lives.

**How it works (CURRENT STATE — PROVEN).**
- **Diagnostic knowledge:** question registry (`utils/questionRegistry.ts`), instant-scoring keywords (`utils/instantScoring.ts`), authoritative scoring rubric (`core/scoringEngine.ts`), domain axes and thresholds (`src/imports/cortex-rules.md`).
- **Planning knowledge:** sprint/workstream templates (`core/sprintTemplates.ts`, `templateAssembler.ts`), scope logic (`scopeEngine.ts`), proposal structure (`types/proposal.ts`, `phase1-gate-criteria.md`, `proposal-p2-implementation.md`).
- **Sales knowledge:** objection intelligence (`objectionEngine.ts`), call scripts (`types/call-script.ts`).
- **System knowledge:** manifest/registry (`src/system/manifest.ts`), architecture map (`ARCHITECT.md`, `architecture/system_map.json`), specifications (`src/imports/`), and **system failure memory** (`memory/failure_library.md`, `memory/regression_cases.md`).

**Business rules.** Knowledge that drives authoritative decisions (scoring rubric, thresholds, ROI math) is deterministic and version-controlled, not model-generated (DNA Ch 17).

**APPROVED FUTURE STATE.** A managed knowledge base per organization feeding AI context; retrieval over prior engagements (bounded by isolation, DNA Ch 19/20); industry-specific knowledge packs.

**Traceability.** DNA Ch 17/19/20 · Objective: structured, trustworthy knowledge · Modules: diagnostic, proposal, execution, sales · Workflow: §III-29 · Engines: scoring/template/scope/objection · AI: consumes knowledge as context · Roadmap: per-org knowledge base.

---

## III-20 — Memory Architecture

**Why it exists.** Memory is a named subsystem of the AI Workforce and the mechanism by which judgment compounds — held in stewardship for the customer (DNA Ch 19).

**CURRENT STATE (PROVEN / PARTIAL).**
- **Operational memory (PROVEN):** durable business state in KV (`kv_store_324f4fbe`) — submissions, proposals, immutable snapshots (with `version_hash`), messages, notes, notifications, engagement logs — is the system's memory of each engagement. Immutable snapshots provide historical, non-corruptible memory of what a client received (§III-11).
- **System/institutional memory (PROVEN):** `memory/failure_library.md` and `memory/regression_cases.md` record failures and regressions to prevent repetition (DNA Ch 19.7, Ch 22.4).
- **Compounding customer memory (PARTIAL / NOT YET):** a dedicated engine that makes Cortex's judgment sharper across a client's lifetime does **not** yet exist as a runtime construct. Persisted history exists; automatic compounding of judgment from it is *APPROVED FUTURE*.

**Business rules (binding now and future).** Memory belongs to the customer, is governed by permission and purpose, is isolated per organization, is never used against the customer, and is correctable/forgettable (DNA Ch 19.2–19.6, Ch 20). Isolation is enforced by tenancy scoping/RLS (§III-44).

**APPROVED FUTURE STATE.** A memory engine that retains and retrieves per-organization context to improve diagnosis and recommendations over time (DNA Ch 19), with exit/portability guarantees (DNA Ch 20.9).

**Traceability.** DNA Ch 19/20 · Objective: compounding judgment under stewardship · Modules: state, tenancy · Workflow: §III-29 · Engines: `snapshotEngine`, `versionEngine` (today) · AI: future memory-informed context · Roadmap: memory engine.

---

## III-21 — Core Engines

**Why it exists.** The engines are the "business engines" of the AI Workforce (DNA Ch 8) and the load-bearing source of every authoritative number. They are the single most important thing to reconstruct faithfully.

**How it works (CURRENT STATE — PROVEN).** 35 deterministic engines live in `src/app/core/`, orchestrated by `runCortexEngine()` in `core/index.ts`. **Rule:** pure functions — no React, no side effects, no LLM (`ARCHITECT.md` §11). The deterministic pipeline is `Answers → inputNormalizer → scoringEngine → decisionEngine → templateAssembler (+ ROI)`.

Engine inventory by domain (file → domain):

- **Diagnostic:** `inputNormalizer` (normalize answers), `scoringEngine` (**load-bearing** readiness scoring), `decisionEngine` (recommendation qualification/sequencing).
- **ROI:** `roiEngine` (**load-bearing**), `cashflowEngine`, `dcfEngine`, `irrEngine`, `monteCarloEngine`, `scenarioEngine`, `costEngine`, `roiTrackingEngine`, `roiActualsEngine`.
- **Proposal:** `proposalGateEngine` (Ready Gate), `scopeEngine`, `contractEngine`.
- **Execution:** `templateAssembler`, `executionEngine`, `blockEngine`, `mappingEngine`, `dependencyEngine`, `versionEngine`, `snapshotEngine`, `sprintTemplates`, `changeImpactEngine`.
- **System/Analytics/Auth/Comms/AI/Reviewer:** `consistencyValidator`, `roleEngine`, `portfolioEngine`, `dashboardAggregator`, `qbrEngine`, `crmEngine`, `exportEngine`, `copilotEngine`, `aiAssistEngine`, `objectionEngine`.

**Inputs / Outputs / Dependencies.** Each engine takes typed inputs (`core/types.ts`) and returns typed outputs; engines depend only on other pure engines and shared types. `copilotEngine`/`aiAssistEngine`/`objectionEngine` prepare requests for the gateway but do not embed a provider.

**Business/Validation rules.** Engines are authoritative; AI cannot override them. `consistencyValidator` checks cross-engine coherence.

**Failure/Recovery.** Pure functions are deterministic and unit-testable; on invalid input the normalizer/validators reject or default per rule. No hidden state to corrupt.

**APPROVED FUTURE STATE.** Engines exposed as the computational core beneath the workforce agents; server-side engine execution where scale requires; expanded ROI/actuals coverage per roadmap.

**Traceability.** DNA Ch 6/8/17 · Operating Constitution Art. 6 · Objective: authoritative math · Modules: all business modules · Workflow: §III-29 · Engines: (this section) · AI: none inside engines · Roadmap: engine scale-out.

---

## III-22 — Deterministic Engines (Behavioral Specification)

**Why it exists.** §III-21 inventories the engines; this section specifies the **behavior** of the load-bearing ones precisely enough to reproduce, per Golden Rule 10 (nothing undocumented). Full math specs live in `src/imports/` and are cross-referenced (Golden Rule 8).

**CURRENT STATE (PROVEN).**

- **Scoring (`scoringEngine.ts`):** produces overall readiness plus per-domain four-axis scores (`problem_density`, `impact_potential`, `automation_feasibility`, `risk_exposure`, 0–10) across the seven domains (§III-5). Public funnel uses a lighter keyword instant score (`instantScoring.ts`); the authoritative score is the engine's (dual-scoring divergence is tracked debt — §III-78).
- **Recommendation (`decisionEngine.ts` + `portfolioEngine.ts`):** create a recommendation only if `problem_density ≥ 6 AND impact_potential ≥ 6`; rank by `priority = impact×0.4 + automation_feasibility×0.3 + problem_density×0.2 − risk_exposure×0.1` (descending); cap portfolio at 5–7 (keep top 7); sequence: fix constraints before optimization, bottlenecks before growth, stabilize data before advanced AI, reduce risk before scaling spend; auto-detect cross-dependencies (`dependency_type: required_before`) from shared KPIs/systems (`src/imports/cortex-rules.md`).
- **ROI (`roiEngine.ts` + `cashflow/dcf/irr/monteCarlo/scenario/cost`):** base ROI plus DCF, IRR, Monte-Carlo distribution, scenario modeling, and cost modeling; conservative ROI and payback reported (specs in `src/imports/roi-*.md`, `dcf-integration-spec.md`, `monte-carlo-spec.md`, `irr-integration-spec.md`, `scenario-modeling-spec.md`, `cost-modeling-layer.md`, `cashflow-timeline-model.md`).
- **Proposal Ready Gate (`proposalGateEngine.ts`):** boardroom-standard checks — executive brief ≥600 words with ≥2 quantified statements and no vague phrases; ≥3 diagnosis blocks each with root cause, system explanation, financial translation, evidence, severity, confidence ≥70, ≥1 High/Critical, no duplicate financial impact; every diagnosis maps to a solution with defined exposure; bounded scope excluding legal/medical/financial advisory and full-autonomy claims; readability limits; strategic coherence. All pass → `internal_review`; any fail → remain `draft` (`src/imports/phase1-gate-criteria.md`).
- **Snapshot/Version (`snapshotEngine.ts`, `versionEngine.ts`):** on send, freeze immutable snapshot (`version_hash = sha256(blocks…)`); post-snapshot edits increment `version_number`; exports read only from snapshot; export blocked if `roi_recalc_required | !validation_passed | contract_invalidated` (`src/imports/proposal-p2-implementation.md`).
- **Scope/Change (`scopeEngine.ts`, `changeImpactEngine.ts`, `dependencyEngine.ts`):** change orders with versioning and dependency-aware impact analysis.
- **Execution (`executionEngine.ts`, `templateAssembler.ts`, `sprintTemplates.ts`, `mappingEngine.ts`):** assemble snapshot → workstreams/milestones/tasks/gates.
- **QBR (`qbrEngine.ts`) + Actuals (`roiActualsEngine.ts`, `roiTrackingEngine.ts`):** quarterly business review and live ROI-vs-projected tracking.

**Validation/Failure/Recovery.** Deterministic and reproducible; invalid inputs are normalized or rejected; `consistencyValidator` enforces cross-engine coherence; gate failures return actionable reasons.

**APPROVED FUTURE STATE.** Extended actuals ingestion; additional ROI methods; server-side execution for scale — all preserving determinism and authority.

**Traceability.** DNA Ch 6/17 · Operating Constitution Art. 6 · Objective: reproducible authoritative behavior · Modules: diagnostic/ROI/proposal/execution/analytics · Workflow: §III-29 · Engines: (this section) · AI: none · Roadmap: actuals/ROI expansion. Detailed specs: `src/imports/*` (appendix §III-88).

---

## III-23 — Product Modules

**Why it exists.** Modules are the user-facing capability groupings that compose the product; documenting them lets a rebuild map features to code.

**CURRENT STATE (PROVEN).** Implemented product modules:

1. **Public Funnel & Lead Capture** — landing, lead magnet, exit-intent, diagnostic form, instant score (`LandingPage`, `LeadMagnetCapture`, `DiagnosticForm`, `ScorePage`).
2. **Diagnostic & Scoring** — questionnaire, scoring, domain results.
3. **Recommendation & Portfolio** — qualified, ranked recommendations with dependencies.
4. **ROI Modeling** — base/DCF/IRR/Monte-Carlo/scenario/cost panels (`DCFPanel`, `MonteCarloPanel`, `ScenarioPanel`).
5. **Proposal System** — draft editor, control panel, Ready Gate, snapshot, executive export (`ProposalDraftEditor`, `ProposalControlPanel`, `ProposalViewer`).
6. **Editability & Copilot** — universal blocks + revisions, inline block AI assist, global chat-to-fix patch engine (`BlockRegistryPanel`, `CopilotPanel`).
7. **Contract Generation** — auto-generated contract from accepted proposal/scope.
8. **Execution Delivery** — execution blueprint dashboard, workstreams/milestones/tasks/gates, scope control (`ExecutionDashboard`).
9. **ROI Actuals & QBR** — live actuals tracking, QBR + opportunity engine.
10. **Client Portal** — 8 fixed tabs (status, solution, readiness report, scheduling, proposal, messaging, assessment, strategic report).
11. **Team Dashboard** — triage, cortex analysis, revenue intelligence, mapping, reviewer, analytics, emails, team management, settings.
12. **CORTEX AI** — chat, narrative, submission analysis, objection handling.

**APPROVED FUTURE STATE.** Modules recomposed under the workforce model (departments/managers); voice/NL surfaces; per-org configuration of module availability via progressive complexity (DNA Ch 14).

**Traceability.** DNA Ch 8/31 · Objective: coherent capability grouping · Modules: (this section) · Workflow: §III-29 · Engines: mapped per module · AI: CORTEX AI module · Roadmap: workforce recomposition.

---

## III-24 — System Modules

**Why it exists.** System modules are the non-feature capabilities that make the product operable, safe, and maintainable.

**CURRENT STATE (PROVEN).**
- **Frontend Data Gateway** (`dataService.ts`) — single data access point; demo/live switch.
- **HTTP Client & Endpoint Config** (`app/lib/api.ts`, `config/api.config.ts`).
- **Intelligence Gateway** (`intelligence/`) — §III-17.
- **Manifest/Registry** (`system/manifest.ts`, `validate.ts`, `RegistryViewer`) — §III-26.
- **Feature Flags & Runtime Config** (`config/features.ts`, `runtime.ts`) — §III-53.
- **Auth & Session** (`AppContext`, edge auth routes) — §III-40.
- **KV Persistence** (`kv_store.tsx`) and **Relational foundation + Repositories** (`supabase/migrations/*`, `server/repositories/*`).
- **Migration System** (`server/migration/`, `scripts/migration/cli.ts`, migration tables) — §III-37.
- **Email/Notifications** (`emailService.ts`, notification routes) — §III-48.
- **Error/Offline handling** (`ErrorBoundary`, `OfflineBanner`, `main.tsx` guards) — §III-56.
- **PDF/Export** (`utils/pdfExport.ts`, `exportEngine.ts`) — dynamic import.

**APPROVED FUTURE STATE.** Repositories become authoritative access path; expanded observability/telemetry; automated migration cutover tooling.

**Traceability.** DNA Ch 11/17/20 · Operating Constitution Art. 2/3/14 · Objective: operable, safe system · Modules: (this section) · Workflow: §III-30 · Engines: system engines · AI: gateway · Roadmap: repository cutover.

---

## III-25 — Business Modules

**Why it exists.** Business modules map product capability to the commercial motion (pre-sale → sign → deliver → grow), the value chain Cortex automates.

**CURRENT STATE (PROVEN).**
- **Acquisition** — lead capture, exit-intent, nurture queue (`crmEngine`, email queue).
- **Diagnosis & Qualification** — scoring, domain analysis, recommendation portfolio.
- **Value Modeling** — ROI suite (conservative ROI, payback, risk).
- **Proposal & Governance** — Ready Gate, snapshot, executive export, contract.
- **Delivery** — execution blueprint, scope control, agent monitoring/tuning references.
- **Growth & Retention** — ROI actuals, QBR + opportunity engine, revenue intelligence dashboard.
- **Client Relationship** — portal, messaging, scheduling, reports.

**Business rules.** Each business module must reduce work, create measurable value, and increase trust (DNA Ch 23); no module may guarantee results or cross advisory boundaries (§III-4).

**APPROVED FUTURE STATE.** Deeper automation of acquisition and retention; memory-informed growth recommendations (DNA Ch 19); billing/licensing tie-in (§III-46/47).

**Traceability.** DNA Ch 18/21/23 · Objective: automate the value chain · Modules: (this section) · Workflow: §III-29 · Engines: per module · AI: assist/narrate · Roadmap: automation & monetization.

---

## III-26 — Component Inventory

**Why it exists.** A rebuild needs the canonical registry of what exists. Cortex maintains one authoritatively.

**CURRENT STATE (PROVEN).** The single source of truth is `src/system/manifest.ts` — **158 registered nodes** with IDs `MQC-{PAGE|COMP|CORE|SVC|HOOK|TYPE}-{NNN}` and status `LIVE | DEMO | GATED | SYSTEM`. Approximate composition (`ARCHITECT.md` §1/9/11/12): ~10 page/route wrappers; ~89 domain UI components + ~49 shadcn/ui primitives; 35 core engines; frontend/data/intelligence services; 3 contexts + hooks; 7 domain type files. Status distribution (verified): the large majority `LIVE`, 9 `DEMO`, 3 `GATED`, 2 `SYSTEM`. Legacy `utils/registryData*.ts` is **orphaned** — do not extend (use the manifest). Viewer: `#/registry` (`RegistryViewer.tsx`); validator: `system/validate.ts`.

**Business rules.** New production files require a manifest ID **before** implementation (Operating Constitution Art. 14; `ARCHITECT.md` §0). Structural changes update `ARCHITECT.md`, `system_map.json`, and the manifest (`ARCHITECT.md` §18).

**APPROVED FUTURE STATE.** Manifest extended as the workforce/relational components are added; automated drift detection between manifest and filesystem.

**Traceability.** Operating Constitution Art. 14/15 · DNA Ch 22 · Objective: no undocumented components · Modules: registry · Workflow: §III-75 · Engine: `consistencyValidator` · AI: n/a · Roadmap: automated manifest audit. Full node list: appendix §III-88 → `src/system/manifest.ts`.

---

## III-27 — UI Architecture

**Why it exists.** The UI is where "Minimum Complexity" is kept true; its architecture must deliver enormous capability through a calm, consistent surface (DNA Ch 11–13).

**CURRENT STATE (PROVEN).** React 18 function components; hash router (`createHashRouter`) with lazy routes (landing eager); shadcn/ui (Radix primitives) as the component system under `app/components/ui/` (~49 primitives); `lucide-react` icons; `recharts` for charts; `motion` for animation; `sonner` for toasts; `react-hook-form` for forms; `react-dnd` for kanban/blocks; `next-themes` with an **Eclipse dark** theme (`#0A0A0F`). Styling: Tailwind v4 (`@tailwindcss/vite`) with `src/styles/` (`index.css`, `theme.css`, `tailwind.css`). Layout patterns: `RootLayout` (providers + error/offline), `TeamDashboardLayout` (sidebar, command palette, notifications, global AI chat; fixed provider nesting), `ClientPortal` (fixed 8-tab order). Performance: debounced search (`usePerformance`), lazy routes, dynamic PDF import (`ARCHITECT.md` §0/9/10/27-equivalent).

**Business/Validation rules.** Fixed client-portal tab order and fixed provider nesting are product decisions — not to be reordered without explicit instruction (`ARCHITECT.md` §0/10). First-time users must reach value in minutes (DNA Ch 11); complexity is disclosed progressively (DNA Ch 14).

**Failure/Recovery.** Global `ErrorBoundary` + `main.tsx` mount guard render fallback UI; `OfflineBanner` on connectivity loss.

**Accessibility/Theming.** Radix primitives provide accessible interactions; theme is dark-first (§III-70 details accessibility posture and debt).

**APPROVED FUTURE STATE.** Progressive-complexity UI tiers (DNA Ch 14); natural-language and later voice surfaces layered on the GUI (DNA Ch 15–16) without raising the floor of simplicity.

**Traceability.** DNA Ch 11/12/13/14/15 · Objective: capability through simplicity · Modules: all UI · Workflow: §III-28 · Engines: n/a · AI: global chat/copilot surfaces · Roadmap: NL/voice surfaces.

---

## III-28 — User Journeys

**Why it exists.** Journeys tie surfaces, sessions, and workflows into the concrete paths each actor walks — the acceptance-level description of the product in use (DNA Ch 13).

**CURRENT STATE (PROVEN).** (`ARCHITECT.md` §19)

- **Public:** `#/` → `#/get-started` (lead magnet) → `#/diagnostic` (questionnaire) → `#/score` (instant readiness result) → (live) submission created + team notified.
- **Team:** `#/team/login` (JWT) → `#/team/dashboard` (panels) → work item (submission triage → cortex analysis → recommendation review → ROI → proposal build → Ready Gate → send) → `#/team/execution` (delivery) → client comms.
- **Client:** `#/client/login` (email verify) → `#/client/portal` → 8 fixed tabs (Your Status → Solution → Readiness Report → Schedule a Call → Proposal → Messages → Your Assessment → Strategic Report) → respond to proposal.
- **Developer/Admin:** `#/architecture` (system diagram) · `#/registry` (manifest viewer).

**Inputs/Outputs.** Inputs: user actions and form data. Outputs: persisted entities, notifications, emails, state transitions.

**Failure/Recovery.** Auth guards redirect unauthenticated actors to the relevant login; offline banner and demo fallback keep the UI functional when the backend is unreachable (§III-56). Known client-session helper debt affects the client journey guard (§III-78).

**APPROVED FUTURE STATE.** Natural-language entry points collapsing multi-step journeys into conversation (DNA Ch 15); progressive-complexity journeys per tier (DNA Ch 14).

**Traceability.** DNA Ch 13/14/15 · Objective: coherent end-to-end use · Modules: funnel/dashboard/portal · Workflow: §III-29/30 · Engines: pipeline · AI: assist surfaces · Roadmap: NL journeys.

---

## III-29 — Business Workflows

**Why it exists.** Business workflows are the governed sequences that convert diagnosis into signed, delivered, measured value — the operational heart of the product.

**CURRENT STATE (PROVEN).**

1. **Lead-to-Submission:** capture lead → complete diagnostic → instant score → create submission → notify team → enqueue nurture (`dataService.saveLead/createSubmission`; API Groups 2/4).
2. **Diagnosis-to-Portfolio:** normalize answers → score domains → qualify recommendations (`density≥6 ∧ impact≥6`) → rank (`priority` formula) → cap 5–7 → map dependencies (§III-22).
3. **Portfolio-to-ROI:** attach ROI (base/DCF/IRR/Monte-Carlo/scenario/cost) → conservative ROI, payback, risk.
4. **Proposal governance (P1):** assemble proposal blocks → run **Ready Gate** → pass → `internal_review`; fail → stay `draft` with reasons (`phase1-gate-criteria.md`).
5. **Proposal freeze & export (P2):** on send, freeze immutable snapshot (`version_hash`) → exports read only from snapshot → export blocked if `roi_recalc_required | !validation_passed | contract_invalidated` (`proposal-p2-implementation.md`).
6. **Contract:** generate contract from accepted proposal/scope (`contractEngine`).
7. **Execution delivery:** snapshot → workstreams/milestones/tasks/gates (`executionEngine`, `templateAssembler`); scope-change control via change orders + versioning (`scopeEngine`, `changeImpactEngine`).
8. **Measure & grow:** ROI actuals tracking (`roiActualsEngine`, `roiTrackingEngine`) → QBR + opportunity (`qbrEngine`).

**Business/Validation rules.** Gate-before-advance at every transition; immutability after send; human authorization for send/scope/status (DNA Ch 18); no guaranteed-results or advisory-boundary violations (§III-4).

**Failure/Recovery.** Gate failures return actionable reasons and hold state; re-send after post-snapshot edits creates a new version; reconciliation governs any data-authority change (§III-37).

**AI involvement.** Narrative/brief generation, block assist, objection handling — assistive only; never authoritative (§III-16).

**APPROVED FUTURE STATE.** Automation of transitions and memory-informed recommendations (DNA Ch 19); workflow orchestration by workforce agents under authority bounds (DNA Ch 18).

**Traceability.** DNA Ch 8/17/18/31 · Operating Constitution Art. 6 · Objective: value conversion · Modules: all business modules · Workflow: (this section) · Engines: full orchestra · AI: assist/narrate · Roadmap: workflow automation.

---

## III-30 — Operational Workflows

**Why it exists.** Operational workflows keep the platform healthy and the team effective — the "run the business of running Cortex" flows.

**CURRENT STATE (PROVEN).**
- **Submission triage:** list/filter submissions, update status, bulk update (`dataService.getSubmissions/updateSubmissionStatus/bulkUpdateSubmissions`); pipeline kanban positions persisted (`getPipelinePositions/savePipelinePosition`).
- **Client communication:** team ↔ client messaging (`getTeamMessages/postTeamReply`, `getClientMessages/postClientMessage`); engagement tracking/analytics (`trackEngagement`, `getEngagementSummary/Analytics`).
- **Notifications & notes:** `getNotifications/markNotificationsRead`, `getNotes/addNote/deleteNote`.
- **Team administration:** invite/update/remove members, roles (`getTeamMembers/inviteTeamMember/updateTeamMember/removeTeamMember`).
- **Settings:** platform settings read/save (`getPlatformSettings/savePlatformSettings`).
- **Email operations:** enqueue and status-manage emails (`enqueueEmails/getEmailQueue/updateEmailStatus`).
- **Health/diagnostics:** `ping/healthCheck/testAuth/getDiagnostics` (§III-35).
- **Migration operations:** inventory → simulate → backfill → reconcile via CLI (`npm run migration:*`) (§III-37).

**Failure/Recovery.** Health/diagnostics endpoints surface KV connectivity and DB stats; demo fallback preserves operability; rate limiting protects the edge.

**APPROVED FUTURE STATE.** Automated triage and routing; SLA-driven notification policies; self-serve org administration post-cutover (§III-9/44).

**Traceability.** DNA Ch 22/30 · Objective: operable platform · Modules: dashboard/admin/comms · Workflow: (this section) · Engines: `crmEngine`, `dashboardAggregator` · AI: n/a (ops) · Roadmap: ops automation.

---

## III-31 — Decision Flows

**Why it exists.** Decision flows make explicit *how a decision is reached and who owns it* — the applied form of the AI decision architecture (§III-16) and human-authority doctrine (DNA Ch 18).

**CURRENT STATE (PROVEN).**
- **Recommend?** — deterministic gate (`density≥6 ∧ impact≥6`); owner: `decisionEngine`. AI: narrates rationale only.
- **What order?** — deterministic priority formula + sequencing rules; owner: `portfolioEngine`.
- **Ready to advance the proposal?** — deterministic Ready Gate; owner: `proposalGateEngine`; human confirms send.
- **Can we export/send?** — deterministic validity checks (recalc/validation/contract); owner: snapshot/version engines; human authorizes.
- **Accept a scope change?** — deterministic impact analysis (`changeImpactEngine`, `dependencyEngine`) → human decision.
- **Escalate to human?** — any high-consequence action per the DNA Ch 18.9 floor (irreversible, third-party-affecting, materially weighty, or authority/permission/security-changing).

**Business rules.** Math decides; AI explains; humans authorize high-consequence steps (DNA Ch 17/18). Reclassifying a decision below the high-consequence floor is itself governed (DNA Ch 18.9).

**APPROVED FUTURE STATE.** A formal decision registry (§III-16) mapping each decision to engine/AI/human ownership; agent-mediated decisions within authority bounds.

**Traceability.** DNA Ch 17/18 · Objective: owned, explainable decisions · Modules: engines + AI + UI · Workflow: §III-29 · Engines: decision/gate/impact · AI: narration · Roadmap: decision registry.

---

## III-32 — Event Architecture

**Why it exists.** Events connect actions to side effects (notifications, emails, engagement, snapshots) and form the basis of audit trails (§III-65).

**CURRENT STATE (PROVEN).** Cortex today uses a **synchronous, side-effect-on-write** model rather than a durable event bus: edge route handlers perform side effects inline. Representative events and effects:
- `lead.captured` → store lead → team notification email (gated by pref).
- `submission.created` → store submission → notification + `newSubmission` email.
- `proposal.sent` → freeze snapshot (`version_hash`) → engagement tracking references snapshot.
- `client.message.posted` / `team.reply.posted` → store message → notification.
- `engagement.tracked` → append engagement log → analytics aggregation.
- `email.enqueued` → email-queue item with status lifecycle.

**Business rules.** Side effects are gated by user preferences (e.g., notification prefs); snapshot creation is triggered exactly at send (§III-11).

**Failure/Recovery.** Because effects are synchronous, a failed side effect surfaces at the request; there is no durable retry queue except the manual email queue (status-managed). This is a known limitation (§III-79).

**APPROVED FUTURE STATE.** A durable event/eventing layer with retries and subscribers (enables background jobs, §III-33); event-sourced audit (§III-65).

**Traceability.** DNA Ch 30 (auditability) · Objective: reliable side effects · Modules: notifications/email/engagement · Workflow: §III-29/30 · Engines: n/a · AI: n/a · Roadmap: durable eventing.

---

## III-33 — Background Jobs

**Why it exists.** Some work should not block a user request (bulk email, migration, reconciliation, analytics rollups).

**CURRENT STATE (PARTIAL).** There is **no general background-job runtime** in the edge function today. The closest constructs are:
- **Email queue** — items are enqueued and their status updated, but dispatch is operator/route-driven, not a daemon (`enqueueEmails/getEmailQueue/updateEmailStatus`).
- **Migration jobs** — run via CLI on demand (`npm run migration:inventory|simulate|backfill|reconcile|pipeline`), not scheduled (§III-37).
- **Batch analysis** — `analyzeSubmissionsBatch` runs on request.

**APPROVED FUTURE STATE.** A managed job runner (queue + workers) for email dispatch, reconciliation, analytics aggregation, and future workforce-agent tasks; retries and dead-letter handling paired with the event layer (§III-32).

**Failure/Recovery.** Today, long operations are request-bound or CLI-bound; failure recovery is manual (re-run CLI, re-enqueue email). Documented limitation (§III-79).

**Traceability.** DNA Ch 22/30 · Objective: non-blocking work · Modules: email/migration/analytics · Workflow: §III-30 · Engines: migration engine · AI: future agent jobs · Roadmap: job runner.

---

## III-34 — Scheduled Processes

**Why it exists.** Recurring processes (QBR generation cadence, reconciliation sweeps, nurture cadences, session cleanup) keep the system current.

**CURRENT STATE (PARTIAL / NONE).** No scheduler (cron) is implemented in the edge runtime. QBR generation, ROI-actuals refresh, and nurture sends are **on-demand** (operator-triggered) today. Session TTLs (8h) are enforced by expiry checks at access time, not by a sweeper.

**APPROVED FUTURE STATE.** Scheduled QBR/opportunity generation, periodic reconciliation during migration, nurture cadences, and constitutional-compliance review cadence (DNA Ch 30.4) — implemented via the future job runner/scheduler (§III-33).

**Traceability.** DNA Ch 30.4 · Objective: timely recurring work · Modules: QBR/actuals/nurture/migration · Workflow: §III-30 · Engines: `qbrEngine` · AI: n/a · Roadmap: scheduler.

---

## III-35 — APIs

**Why it exists.** The edge API is the contract between the SPA and the store/intelligence layers; it must be documented precisely to rebuild (Golden Rule 10). The authoritative reference is `API_SPECIFICATIONS.md` (cross-referenced, not duplicated — Golden Rule 8).

**CURRENT STATE (PROVEN).** Single Hono app at base path `/make-server-324f4fbe`; ~79 route handlers documented as the canonical endpoint set in `API_SPECIFICATIONS.md`. Auth schemes: `TEAM_TOKEN` (Supabase JWT), `CLIENT_TOKEN` (`client_{uuid}`), `ANON` (public anon key). Rate limit: 120 req/min/IP with `X-RateLimit-*` headers. Endpoint groups:

1. **Health & Test** — `GET /ping`, `GET /test-auth`, `GET /health`, `GET /diagnostic`.
2. **Lead Capture** — `POST /leads/capture`, `POST /leads/exit-intent`.
3. **Auth** — `POST /auth/team/login`, `POST /auth/client/verify`.
4. **Submissions** — create/list/update/bulk.
5. **Client portal** — submission, report, messages, proposal, respond.
6. **Team comms** — messages, replies.
7. **Proposals** — get/save/send + annotations CRUD.
8. **Engagement** — track/log/summary/analytics.
9. **Analytics** — `getAnalytics`.
10. **Notifications/Notes** — read/mark/CRUD.
11. **Team admin** — members CRUD.
12. **Settings** — get/save.
13. **CORTEX AI** — analysis, narrative, chat, block assist, copilot interpret.
14. **Pipeline** — positions + column capacities.
15. **Email queue** — enqueue/list/update status.

**Contracts/Validation.** Request/response shapes and error codes are specified per endpoint in `API_SPECIFICATIONS.md` (e.g., `400` missing email, `401` invalid token). Idempotency: `POST /leads/exit-intent` returns existing `leadId`.

**Security.** Per-endpoint auth scheme; secrets in edge only; CORS configured in code.

**APPROVED FUTURE STATE.** Relational-domain endpoints wired to repositories after cutover (§III-37); versioned API surface (§III-71).

**Traceability.** Operating Constitution Art. 3 · DNA Ch 20/30 · Objective: precise contract · Modules: all · Workflow: §III-29/30 · Engines: n/a · AI: CORTEX AI group · Roadmap: relational endpoints. Full spec: `API_SPECIFICATIONS.md` (appendix §III-88).

---

## III-36 — Integration Contracts

**Why it exists.** Cortex depends on and (in future) connects to external systems; their contracts must be explicit and provider-agnostic where they touch intelligence (Operating Constitution Art. 2).

**CURRENT STATE (PROVEN).**
- **Supabase** — Auth (team JWT), Edge Functions runtime, Postgres/KV store. Config via `utils/supabase/info.tsx` (`projectId`, `publicAnonKey`) and edge secrets.
- **AI provider (OpenAI)** — reached only through the Intelligence Gateway adapter (`providers/openaiAdapter.ts`); normalized contracts (`contracts.ts`); `mockProvider.ts` for demo/tests. Secret `OPENAI_API_KEY` in edge only.
- **Email (Resend)** — `emailService.ts`; secret `RESEND_API_KEY`.

**Business rules.** No provider name/model ID hardcoded in business logic; adapters isolate provider specifics; normalized fields only upstream (Art. 2). Secrets never committed (Art. 13).

**APPROVED FUTURE STATE.** CRM sync (Zoho/HubSpot), email-provider expansion, and document-sign integrations are **approved but not implemented** (Part I "what's left"; `src/imports/crm-sync-spec.md`). Additional certified AI providers behind the gateway.

**Failure/Recovery.** Adapter timeouts/retries; gateway rollback flags; email-queue status for retriable sends.

**Traceability.** Operating Constitution Art. 2/13 · DNA Ch 17/20 · Objective: safe, swappable integrations · Modules: intelligence/email/auth · Workflow: §III-29/30 · Engines: n/a · AI: gateway · Roadmap: CRM/e-sign/providers.

---

## III-37 — Data Architecture

**Why it exists.** Data is the foundation of trust and the subject of the platform's most careful governance (DNA Ch 20; Operating Constitution Art. 4/17). This section documents where data lives, what is authoritative, and how authority changes.

**CURRENT STATE (PROVEN).**
- **Authoritative runtime store:** KV table `kv_store_324f4fbe` (Postgres-backed key/value). Keys: `lead:{id}`, `lead_email:{email}`, `sub:{id}`, `sub_email:{email}`, proposals, snapshots, messages, notifications, notes, pipeline, email-queue, engagement, client sessions (`client_{uuid}`).
- **Relational foundation (present, not yet authoritative):** 23 tables across tenancy, diagnostic, and migration domains (§III-38), with RLS helpers (`cortex.*` functions). Repositories (`server/repositories/*`) exist but are **not wired to routes** (*PARTIAL*).
- **Phased migration:** governed KV→SQL migration with per-domain phases (inventory → schema → backfill → dual-read → dual-write → SQL authoritative → KV retirement). Migration infrastructure tables: `migration_runs`, `migration_checkpoints`, `migration_quarantine`, `migration_reconciliation_log`. CLI: `scripts/migration/cli.ts`. Roadmap position: currently in Runtime Storage Gateway / Outcome Shadow-Read phase; **KV remains authoritative** (`MARQ_CORTEX_ROADMAP.md`; `ARCHITECT.md` §6).

**Business rules (binding).** KV stays authoritative until per-domain Phase 5 cutover; no big-bang migration; dual-read/dual-write forbidden until reconciliation passes; backfill idempotent via `legacy_kv_key` upsert; no silent record drops (quarantine everything skipped); migration writes must not modify production KV; authority change requires reconciliation threshold, quarantine accounting, rollback verification, and human review (Operating Constitution Art. 4/7/11/17; DNA Ch 20).

**Failure/Recovery.** Rollback scripts (`supabase/migrations/rollbacks/`); reconciliation log; quarantine table; checkpoints for resumable runs. Tests: `npm run test:database`, `npm run test:migration`, `migration:validate-s6.3`.

**Security/Privacy.** Organization scoping + RLS on tenant/diagnostic tables; service-role bypass only for migration/backfill/platform-admin with explicit scoping (§III-39/44/69).

**APPROVED FUTURE STATE.** SQL becomes authoritative per domain (roadmap Phase 5: SQL read rollout → authority validation → KV retirement); repositories become the live access path; same immutability/audit guarantees preserved.

**Traceability.** DNA Ch 20 · Operating Constitution Art. 4/5/7/11/12/17 · Objective: trustworthy, isolated data · Modules: all persistence · Workflow: §III-30 · Engines: migration engine · AI: n/a · Roadmap: SQL cutover. Detail: `architecture/database/*`, `DATABASE_SCHEMA.md` (appendix §III-88).

---

## III-38 — Entity Relationships

**Why it exists.** The relational model is the durable schema Cortex is migrating toward; its entities and relationships must be documented to rebuild (ERD detail in `architecture/database/MCV2-S3-ENTITY-RELATIONSHIP-DIAGRAM.md`, cross-referenced).

**CURRENT STATE (PROVEN — schema present; authority phased).** Relational tables (from `supabase/migrations/`):

- **Tenancy & RBAC:** `organizations` (tenant root) → `organization_memberships` (user↔org, role) → `organization_settings`; `roles`, `permissions`, `role_permissions` (RBAC).
- **Identity:** `contacts` → `contact_methods`; `leads` → `lead_sources`, `lead_tags`.
- **Diagnostic:** `submissions` → `submission_sections`, `diagnostic_answers`; scoring: `diagnostic_scores`, `domain_scores`.
- **Reporting:** `reports` → `report_versions`.
- **Outcomes:** `outcomes` (ROI actuals).
- **Migration:** `migration_runs` → `migration_checkpoints`, `migration_quarantine`, `migration_reconciliation_log`.
- **KV:** `kv_store_324f4fbe` (authoritative runtime).

**Relationships (representative).** An `organization` owns memberships, settings, contacts, leads, submissions, reports, and outcomes (all org-scoped). A `submission` has many `submission_sections`, `diagnostic_answers`, and produces `diagnostic_scores` + `domain_scores`; a `report` has many `report_versions`; a `role` maps to many `permissions` via `role_permissions`. `legacy_kv_key` links migrated rows to their KV origin (idempotent backfill).

**Business rules.** Every business row is organization-scoped; RLS mandatory on tenant/diagnostic tables (DNA Ch 20; Operating Constitution Art. 5).

**APPROVED FUTURE STATE.** `ai_worker` service-account identity and workforce/agent entities added as the model is realized (DNA Ch 8.3); relational becomes authoritative (§III-37).

**Traceability.** DNA Ch 20 · Operating Constitution Art. 5 · Objective: durable schema · Modules: tenancy/diagnostic/reporting/outcomes · Workflow: §III-29 · Engines: repositories · AI: n/a · Roadmap: relational authority. ERD: `architecture/database/MCV2-S3-*` (appendix §III-88).

---

## III-39 — Security Architecture

**Why it exists.** Security is a non-negotiable; it is never traded for convenience (DNA Ch 29.3; Operating Constitution Art. 8/13). This section documents the security posture as built.

**CURRENT STATE (PROVEN).**
- **Transport/edge:** HTTPS via Supabase Edge; CORS configured in the Hono app; 120 req/min/IP rate limiting with headers.
- **AuthN:** team via Supabase Auth JWT (`Authorization: Bearer {jwt}`); client via `client_{uuid}` session token (KV, 8h TTL); anon via public anon key for public routes (§III-40).
- **AuthZ:** route-level auth scheme enforcement (ANON/TEAM_TOKEN/CLIENT_TOKEN); team role in `user_metadata.teamRole` and relational RBAC foundation (`roles/permissions/role_permissions`) (§III-41/42/43).
- **Tenant isolation:** organization scoping + RLS helpers on tenant/diagnostic tables; service-role bypass restricted to migration/backfill/platform-admin with explicit scoping (§III-44; DNA Ch 20).
- **Secrets:** `OPENAI_API_KEY`, `RESEND_API_KEY`, Supabase keys held only in edge secrets / `.env.local`; never committed; never in generated reports (Operating Constitution Art. 13).
- **Runtime authority protection:** Article 17 — validation precedes authority; migration writes must not modify production KV (§III-37).

**Business rules.** High-risk changes (auth, permissions, secrets, RLS, data authority, provider/contract) require human review before production (Operating Constitution Art. 8; DNA Ch 30.2).

**Failure/Recovery.** Invalid/expired tokens → `401`; rate-limit breach → `429` semantics via headers; secret misconfig surfaced via health/diagnostics.

**APPROVED FUTURE STATE.** Full relational RBAC enforcement at runtime; incident-disclosure and enforcement mechanisms per DNA Ch 30.4; expanded audit trails (§III-65).

**Traceability.** DNA Ch 20/29/30 · Operating Constitution Art. 5/8/13/17 · Objective: uncompromised security · Modules: auth/tenancy/secrets · Workflow: §III-30 · Engines: `roleEngine` · AI: n/a · Roadmap: RBAC enforcement, audit.

---

## III-40 — Authentication

**Why it exists.** Authentication establishes *who* is acting — the precondition for authority and isolation (DNA Ch 18/20).

**CURRENT STATE (PROVEN).**
- **Team:** `POST /auth/team/login` proxies Supabase `signInWithPassword`; returns a Supabase JWT stored as `marq_cortex_team_session` (expiry `marq_cortex_team_session_expiry`, 8h). Verified via `GET /test-auth`.
- **Client:** `POST /auth/client/verify` with email → if a matching submission exists, issues `client_{uuid}` session token (KV, 8h TTL) plus `submissionId`, `companyName`; stored as `marq_cortex_client_session`. Token prefix distinguishes clients from team JWTs.
- **Anon:** public routes use the Supabase public anon key.
- **Demo mode:** when `BACKEND_INTEGRATION=false`, demo team credentials (`admin@marqcortex.com` / `CortexAdmin2026!`) enable the UI without a backend.

**Inputs/Outputs.** In: credentials/email. Out: token + session context (`AppContext`).

**Validation/Failure.** `400` missing fields; `401` invalid credentials/token; expired sessions rejected at access time.

**Security.** Tokens in browser storage with TTL; client token prefix isolation; secrets edge-only.

**Known debt.** `src/app/lib/session.ts` missing (imported by `api.ts`); `isClientSessionExpired` missing from `AppContext` (referenced by `ClientPortalRoute`); session key drift across components (§III-78).

**APPROVED FUTURE STATE.** Unified session store; relational membership-based identity; SSO/enterprise auth options.

**Traceability.** DNA Ch 18/20 · Operating Constitution Art. 8 · Objective: reliable identity · Modules: auth · Workflow: §III-8/28 · Engines: n/a · AI: n/a · Roadmap: unified/enterprise auth.

---

## III-41 — Authorization

**Why it exists.** Authorization enforces *what an authenticated actor may do* — the runtime expression of the human–AI authority doctrine and least privilege (DNA Ch 18; Operating Constitution Art. 5/8).

**CURRENT STATE (PROVEN / PARTIAL).**
- **Route-scheme authorization (PROVEN):** each endpoint declares ANON/TEAM_TOKEN/CLIENT_TOKEN; the edge enforces the scheme (e.g., team-only stats, client-only portal reads).
- **Client-data scoping (PROVEN):** client tokens resolve to a specific `submissionId`; client portal reads are scoped to that submission.
- **Team role authorization (PARTIAL):** `user_metadata.teamRole` + `roleEngine` inform UI capability (e.g., reviewer/revenue panels); relational RBAC (`roles/permissions/role_permissions`) exists as foundation but is **not yet the enforced runtime authority**.
- **Tenant scoping (PARTIAL):** organization scoping + RLS present in schema; KV-era runtime scoping is application-enforced pending cutover (§III-44).

**Business rules.** Never execute actions beyond approved permissions (DNA Ch 29.6); least privilege; high-consequence actions require human authorization (DNA Ch 18.9).

**APPROVED FUTURE STATE.** Full relational RBAC enforced at the edge/repository layer; per-permission checks (§III-43); org-scoped authorization as the primary model (§III-44).

**Failure/Recovery.** Unauthorized → `401/403`; UI hides unauthorized actions (role-based UI controls are a Part I "what's left" polish item).

**Traceability.** DNA Ch 18/29 · Operating Constitution Art. 5/8 · Objective: least-privilege authority · Modules: auth/RBAC/tenancy · Workflow: §III-31 · Engines: `roleEngine` · AI: n/a · Roadmap: RBAC enforcement.

---

## III-42 — Roles

**Why it exists.** Roles bundle permissions into operator archetypes so authorization is manageable (DNA Ch 18; Operating Constitution Art. 5).

**CURRENT STATE (PROVEN / PARTIAL).**
- **Team roles (PROVEN in UI):** operator archetypes are reflected in dashboard panels — general operator (`dashboard`, `cortex`), **reviewer** (`ReviewerDashboard`, reviewer checklist type), **revenue/analytics** (`RevenueIntelligenceDashboard`, `AnalyticsDashboard`), **team admin** (`TeamManagement`, member CRUD), **settings/admin** (`SettingsPage`). Carried today via `user_metadata.teamRole` and `roleEngine`.
- **Client role (PROVEN):** a single client-stakeholder role scoped to one submission's portal.
- **Relational roles (PARTIAL):** `roles`, `role_permissions` tables define a formal role model not yet enforced at runtime.

**Business rules.** Role determines UI visibility and (future) permission enforcement; role changes are high-risk (auth) and require review (Operating Constitution Art. 8).

**APPROVED FUTURE STATE.** Formal, org-scoped role catalog (e.g., Owner/Admin/Reviewer/Operator/ReadOnly) enforced via relational RBAC; custom roles per organization (progressive complexity, DNA Ch 14).

**Traceability.** DNA Ch 18/14 · Operating Constitution Art. 5/8 · Objective: manageable authority · Modules: RBAC/dashboard · Workflow: §III-30 · Engines: `roleEngine` · AI: n/a · Roadmap: enforced RBAC. Permission detail: §III-43.

---

## III-43 — Permissions

**Why it exists.** Permissions are the atomic units of authority — the finest grain at which "never execute beyond approved permissions" (DNA Ch 29.6) is enforced.

**CURRENT STATE (PARTIAL).** Effective permissions today are expressed at two levels: (1) **endpoint auth scheme** (ANON/TEAM_TOKEN/CLIENT_TOKEN) enforced by the edge, and (2) **UI capability gating** driven by `roleEngine` + `user_metadata.teamRole` (e.g., who sees reviewer/revenue panels, who can manage team members). A formal permission catalog exists in the relational foundation (`permissions`, `role_permissions`) but is **not yet enforced at runtime**. Client permissions are implicit and scoped to one `submissionId`.

**Inputs/Outputs.** In: actor token + role. Out: allow/deny per route; visible/hidden per UI action.

**Business/Validation rules.** Least privilege; deny by default on protected routes; high-consequence actions require human authorization regardless of permission (DNA Ch 18.9).

**Failure/Recovery.** Unauthorized → `401/403`; missing UI gating is a known polish item (role-based UI controls, Part I "what's left").

**APPROVED FUTURE STATE.** Enforced relational permission checks per action (e.g., `proposal.send`, `scope.accept`, `member.remove`, `org.settings.write`), org-scoped, surfaced consistently in UI and API.

**Traceability.** DNA Ch 18/29 · Operating Constitution Art. 5/8 · Objective: least-privilege enforcement · Module: RBAC · Workflow: §III-31 · Engine: `roleEngine` · AI: n/a · Roadmap: enforced permissions.

---

## III-44 — Multi-Tenancy

**Why it exists.** Tenant isolation is a data-stewardship non-negotiable: one customer's data must never be exposed to another (DNA Ch 20.3; Operating Constitution Art. 5).

**CURRENT STATE (PARTIAL).** The tenant boundary is the **organization**. The relational foundation implements org scoping with mandatory RLS on tenant and diagnostic tables via `cortex.*` helper functions (`supabase/migrations/20260711050000_*`, `20260714050001_*`). At runtime, KV remains authoritative and tenant scoping is enforced at the application layer with org context seeded manually; relational RLS provides defense-in-depth once authoritative. Service-role bypass is restricted to migration/backfill/platform-admin with explicit org scoping in engine logic.

**Business rules.** All relational business data is organization-scoped; RLS is mandatory; no cross-tenant reads; service-role use is bounded and scoped (Operating Constitution Art. 5; DNA Ch 20). Memory is isolated per organization (DNA Ch 19.5; §III-20).

**Failure/Recovery.** RLS denies unscoped access; migration reconciliation ensures no tenant data is dropped or crossed (quarantine on anomaly). Anon-policy hardening migration (`20260714060000_*`) tightens public access.

**APPROVED FUTURE STATE.** Organization-scoped RLS as the primary, enforced runtime isolation after SQL cutover (§III-37); per-org configuration, memory, billing, and licensing keyed to the tenant.

**Traceability.** DNA Ch 19/20 · Operating Constitution Art. 5 · Objective: absolute isolation · Module: tenancy · Workflow: §III-9/45 · Engine: repositories · AI: n/a · Roadmap: enforced RLS.

---

## III-45 — Organizations

**Why it exists.** The organization is the unit a business "is" inside Cortex — the owner of data, members, settings, and (future) billing.

**CURRENT STATE (PARTIAL).** Entities: `organizations`, `organization_memberships` (user↔org with role), `organization_settings`. Membership bootstrap is currently manual (seed), documented in `architecture/database/MEMBERSHIP_BOOTSTRAP.md`. Team auth carries org/role via Supabase `user_metadata` today; relational membership is the target model.

**Inputs/Outputs.** In: org creation/membership/settings operations (schema-level today). Out: scoped tenant context.

**Business rules.** Every member belongs to an organization; settings are org-scoped; org context governs data visibility (DNA Ch 20).

**APPROVED FUTURE STATE.** Self-serve organization creation, member invitation/management, and settings management as first-class runtime flows post-cutover; org lifecycle per §III-9.

**Traceability.** DNA Ch 20 · Operating Constitution Art. 5 · Objective: tenant identity · Module: tenancy · Workflow: §III-9 · Engine: `tenancyRepository` · AI: n/a · Roadmap: self-serve org.

---

## III-46 — Billing

**Why it exists.** Cortex is a commercial product hired by businesses; billing captures the value exchange (DNA Ch 21 — business philosophy; durable over extractive).

**CURRENT STATE (NOT IMPLEMENTED).** There is **no billing system** in the codebase — no payment provider, no subscription entities, no invoicing. Commercial terms today are handled out-of-band (the platform's own generated **contract**, §III-23, documents the engagement's commercial scope, but is not a billing engine). This is stated plainly to avoid any undocumented assumption.

**APPROVED FUTURE STATE.** Per-organization billing (subscription and/or engagement-based) tied to licensing (§III-47), honoring the constitutional constraints: measurable, honest value; no extraction via lock-in; guaranteed exit/portability (DNA Ch 20.9, 21.5–21.6). Billing must never gate a customer's right to leave with their data.

**Business rules (future, constitutional).** Pricing and packaging must not weaponize switching cost (DNA Ch 20.9); value claims must be honest and measurable (DNA Ch 21.5).

**Traceability.** DNA Ch 20.9/21 · Objective: sustainable monetization · Module: (future) billing · Workflow: §III-9 · Engine: n/a · AI: n/a · Roadmap: billing system.

---

## III-47 — Licensing

**Why it exists.** Licensing governs which capabilities an organization may use — the mechanism behind progressive complexity tiers (DNA Ch 14).

**CURRENT STATE (NOT IMPLEMENTED).** No entitlement/licensing system exists in code. Capability availability today is effectively uniform per authenticated role; there are no per-tenant feature entitlements beyond feature flags (`features.ts`) which are build/environment-level, not per-organization.

**APPROVED FUTURE STATE.** Per-organization entitlements enabling the progressive-complexity model — beginner → growing → power user → enterprise — where advanced capability unlocks only when it creates value (DNA Ch 14). Entitlements tie to billing (§III-46) and never raise the floor of simplicity (DNA Ch 14 rule 3).

**Traceability.** DNA Ch 14 · Objective: value-aligned capability disclosure · Module: (future) entitlements · Workflow: §III-7 personas · Engine: n/a · AI: n/a · Roadmap: licensing/entitlements.

---

## III-48 — Notifications

**Why it exists.** Notifications keep operators and clients informed of events that need attention (new submission, message, status change) without forcing them to watch dashboards.

**CURRENT STATE (PROVEN).**
- **In-app notifications:** stored in KV; read via `getNotifications`, cleared via `markNotificationsRead`; created on key events (submission created, message posted).
- **Email notifications:** via Resend (`emailService.ts`); team alerts on lead capture and new submission, gated by preference flags (e.g., `newSubmission`).
- **Preferences:** platform/notification preferences via settings (`getPlatformSettings/savePlatformSettings`).

**Inputs/Outputs.** In: event + preference. Out: KV notification and/or email.

**Business rules.** Notifications respect user preference gates; side effects are synchronous with the triggering write (§III-32).

**Failure/Recovery.** Email send failures are surfaced/logged; no durable retry beyond the manual email queue (§III-33) — a known limitation.

**APPROVED FUTURE STATE.** Slack/email/in-app alerts for tasks/incidents/QBR (Part I "what's left"); durable, retriable delivery via the future eventing/job layer (§III-32/33); per-role subscription policies.

**Traceability.** DNA Ch 22/30 · Objective: timely awareness · Module: notifications/email · Workflow: §III-30/32 · Engine: `crmEngine` · AI: n/a · Roadmap: multi-channel durable notifications.

---

## III-49 — Reporting

**Why it exists.** Reports are the client-facing artifacts that convey diagnosis, solution, readiness, and strategy — the deliverables that make value legible (DNA Ch 10 outcomes-over-outputs).

**CURRENT STATE (PROVEN).**
- **Client reports:** readiness report and strategic report surfaced in the portal (`ClientReadinessReport`, `ClientReportDashboard`, strategic report tab); generated via `dataService.generateClientReport`/`getClientReport`; relational entities `reports`, `report_versions`.
- **Proposal/export documents:** executive summary PDF, full technical proposal PDF, contract attachment — produced by the export engine from the **immutable snapshot** only (`exportEngine.ts`, `utils/pdfExport.ts` dynamic import; `proposal-p2-implementation.md` structured export order).
- **Readiness gating:** the readiness-report tab is locked until the report is ready (`ARCHITECT.md` §10).

**Business/Validation rules.** Exports read only from the frozen snapshot; export blocked if `roi_recalc_required | !validation_passed | contract_invalidated`; structured export order enforced (cover → executive brief → diagnosis → solutions → timeline → financials → governance/assumptions → next steps/signature).

**Failure/Recovery.** Export blockers return actionable reasons; PDF generation isolated via dynamic import to avoid bundle bloat.

**APPROVED FUTURE STATE.** Premium PDF export styling templates (Part I "what's left"); additional report types; per-org branding.

**Traceability.** DNA Ch 10 · Objective: legible deliverables · Module: reporting/proposal/export · Workflow: §III-29 · Engine: `exportEngine`, `snapshotEngine` · AI: narrative assist · Roadmap: export styling.

---

## III-50 — Analytics

**Why it exists.** Analytics turn platform activity into insight for operators and, in future, for clients (business intelligence — DNA Ch 8).

**CURRENT STATE (PROVEN).**
- **Engagement analytics:** `trackEngagement` + `getEngagementSummary/getEngagementAnalytics` over the engagement log.
- **Platform analytics:** `getAnalytics`; aggregated by `dashboardAggregator` and surfaced in `AnalyticsDashboard`.
- **Portfolio/revenue intelligence:** `portfolioEngine`, `RevenueIntelligenceDashboard`.
- **Legacy portfolio (mock, non-LLM):** `CortexDashboard → cortexDataService → mockCortexData` for portfolio visualization (`ARCHITECT.md` §7).

**Inputs/Outputs.** In: engagement/submission/proposal data. Out: aggregated metrics, charts (recharts).

**Business rules.** Analytics are derived/deterministic; AI may narrate trends but not fabricate figures (DNA Ch 17).

**APPROVED FUTURE STATE.** Per-organization business intelligence as a realized workforce component (DNA Ch 8); predictive/opportunity analytics feeding QBR; relational-backed analytics post-cutover.

**Traceability.** DNA Ch 8/17 · Objective: activity→insight · Module: analytics · Workflow: §III-30 · Engine: `dashboardAggregator`, `portfolioEngine` · AI: narrate · Roadmap: BI component.

---

## III-51 — Dashboards

**Why it exists.** Dashboards are the primary operator and client surfaces — where capability is presented simply (DNA Ch 11).

**CURRENT STATE (PROVEN).**
- **Team dashboard** (`TeamDashboardNew` in `TeamDashboardLayout`): panels `dashboard` (`TeamHomeDashboard`), `cortex` (`CortexDashboard`), `team` (`TeamManagement`), `settings` (`SettingsPage`), `reviewer` (`ReviewerDashboard`), `analytics` (`AnalyticsDashboard`), `emails` (`EmailNurturePanel`), `revenue` (`RevenueIntelligenceDashboard`), `mapping` (`MappingEnginePanel`), plus hash-routed `execution` and `architecture`. Shell provides sidebar, command palette, notifications, global AI chat.
- **Execution dashboard** (`ExecutionDashboard`, `#/team/execution`): workstreams/milestones/tasks/gates.
- **Client portal** (`ClientPortal`): 8 fixed tabs (§III-28).
- **Developer dashboards:** `#/architecture` (`SystemArchitecture`), `#/registry` (`RegistryViewer`).

**Business/Validation rules.** Fixed provider nesting and fixed client-tab order are product decisions (§III-27). Pipeline kanban positions persist per operator (`DashboardContext` → localStorage; server positions via API).

**APPROVED FUTURE STATE.** Progressive-complexity dashboards per tier (DNA Ch 14); client-facing analytics; NL/voice command surfaces (DNA Ch 15–16).

**Traceability.** DNA Ch 11/13/14 · Objective: simple presentation of capability · Module: dashboards · Workflow: §III-28/30 · Engine: `dashboardAggregator` · AI: global chat · Roadmap: progressive dashboards.

---

## III-52 — Administration

**Why it exists.** Administration lets operators manage the platform, team, and configuration safely (DNA Ch 30 governance).

**CURRENT STATE (PROVEN).**
- **Team administration:** `TeamManagement` panel + member CRUD (`getTeamMembers/inviteTeamMember/updateTeamMember/removeTeamMember`).
- **Platform settings:** `SettingsPage` + `getPlatformSettings/savePlatformSettings` (notification prefs, platform config).
- **System administration/inspection:** `#/registry` (manifest viewer), `#/architecture` (system diagram), health/diagnostics endpoints.

**Business rules.** Member/role changes are high-risk (auth) and require review (Operating Constitution Art. 8); settings changes are audited via notes/engagement where applicable.

**APPROVED FUTURE STATE.** Org-scoped admin console (members, roles, entitlements, billing, org settings) post-cutover; platform-admin tooling with explicit scoping (DNA Ch 20).

**Traceability.** DNA Ch 30 · Operating Constitution Art. 8 · Objective: safe management · Module: admin · Workflow: §III-30 · Engine: `roleEngine` · AI: n/a · Roadmap: org admin console.

---

## III-53 — Configuration

**Why it exists.** Configuration controls runtime behavior across environments without code changes — the seam between build and deployment.

**CURRENT STATE (PROVEN).**
- **Frontend feature flags** (`src/config/features.ts`): `BACKEND_INTEGRATION` (demo vs live, default false), `SHOW_API_ERRORS` (default false), `VERBOSE_LOGGING` (default false); overridable via `VITE_*` env in `.env.local`.
- **API config** (`config/api.config.ts`): endpoint definitions; **runtime config** (`config/runtime.ts`).
- **Supabase info** (`utils/supabase/info.tsx`): `projectId`, `publicAnonKey`.
- **Intelligence Gateway config** (edge secrets/env): `INTELLIGENCE_PROVIDER`, `INTELLIGENCE_TIMEOUT_MS`, `INTELLIGENCE_MAX_RETRIES`, `INTELLIGENCE_USE_GATEWAY_*`, model overrides.
- **Env template:** `.env.example`.

**Business rules.** Secrets never in config committed to VCS (Operating Constitution Art. 13); demo mode must never call providers/edge from engines.

**APPROVED FUTURE STATE.** Per-organization runtime configuration (entitlements, branding, notification policy) as data, not build flags (§III-47).

**Traceability.** Operating Constitution Art. 13 · DNA Ch 14 · Objective: environment control · Module: config · Workflow: §III-72/73 · Engine: n/a · AI: gateway config · Roadmap: per-org config.

---

## III-54 — Business Rules

**Why it exists.** This section consolidates the authoritative, deterministic business rules that define correct behavior, so they cannot be lost or reinterpreted (Golden Rule 10). Rules are specified where they operate (§III-5/22/29) and indexed here.

**CURRENT STATE (PROVEN — canonical rules).**
1. **Recommendation qualification:** create a recommendation iff `problem_density ≥ 6 AND impact_potential ≥ 6`.
2. **Priority ranking:** `priority = impact×0.4 + automation_feasibility×0.3 + problem_density×0.2 − risk_exposure×0.1`, sorted descending.
3. **Portfolio guardrail:** 5–7 recommendations max; keep top 7 by priority.
4. **Execution sequencing:** constraints before optimization; bottlenecks before growth; stabilize data before advanced AI; reduce risk before scaling spend.
5. **Dependency mapping:** auto-detect `required_before` from shared KPIs/systems.
6. **Proposal Ready Gate:** all boardroom checks must pass to leave `draft` (§III-22).
7. **Snapshot immutability:** freeze on send with `version_hash`; post-snapshot edits increment `version_number`; exports read only from snapshot.
8. **Export safety:** blocked if `roi_recalc_required | !validation_passed | contract_invalidated`.
9. **Math authority:** deterministic engines own numbers; AI never overrides (DNA Ch 17).
10. **Human authority:** high-consequence actions require human authorization (DNA Ch 18.9).
11. **Tenant scoping:** all business data organization-scoped; RLS mandatory on tenant/diagnostic tables.
12. **Runtime authority:** KV authoritative until per-domain cutover; no authority change without reconciliation + review.

**APPROVED FUTURE STATE.** Additional domain-calibrated rules per industry; entitlement-gated rule variations (never weakening trust or simplicity).

**Traceability.** DNA Ch 6/17/18/20 · Operating Constitution Art. 4/5/6/17 · Objective: correctness preserved · Modules: all · Workflow: §III-29 · Engines: all deterministic · AI: none authoritative · Roadmap: industry rule packs. Sources: `src/imports/cortex-rules.md`, `phase1-gate-criteria.md`, `proposal-p2-implementation.md`.

---

## III-55 — Validation Rules

**Why it exists.** Validation protects data integrity and content quality at every boundary (input, gate, export).

**CURRENT STATE (PROVEN).**
- **Input validation (API):** email required on lead/submission (`400` otherwise); idempotent exit-intent; auth field presence on login (`400`); token validity (`401`).
- **Content validation (Ready Gate):** executive brief ≥600 words, ≥2 quantified statements, no vague phrases; ≥3 diagnosis blocks with root cause + system explanation + financial translation + evidence + severity + confidence ≥70; ≥1 High/Critical; no duplicate financial impact; each diagnosis maps to a solution with defined exposure; bounded scope excluding regulated advisory + full-autonomy claims; readability limits; strategic coherence (`phase1-gate-criteria.md`).
- **Export validation:** recalc/validation/contract checks (§III-54 rule 8).
- **Form validation (UI):** `react-hook-form` on inputs; diagnostic completeness.
- **Cross-engine validation:** `consistencyValidator`.

**Failure/Recovery.** Validation failures return actionable messages and hold state (draft/blocked); UI surfaces field errors.

**APPROVED FUTURE STATE.** Schema-level validation at the relational layer (constraints + RLS) as authority moves to SQL; richer content-quality scoring.

**Traceability.** DNA Ch 17/30 · Operating Constitution Art. 8 · Objective: integrity + quality · Modules: diagnostic/proposal/export · Workflow: §III-29 · Engines: `proposalGateEngine`, `consistencyValidator` · AI: n/a · Roadmap: relational constraints.

---

## III-56 — Error Handling

**Why it exists.** Graceful error handling preserves trust and keeps the product usable under failure (DNA Ch 11 experience; Ch 30.1 accountability).

**CURRENT STATE (PROVEN).**
- **Boot/render errors:** `main.tsx` mount guard + global error UI; `ErrorBoundary` in `RootLayout` renders a fallback rather than a white screen.
- **API errors:** governed by `SHOW_API_ERRORS` — when false, the app silently falls back to demo/seed data (seamless UX for demos); when true, error banners show (dev/debug). `VERBOSE_LOGGING` controls console detail.
- **Connectivity:** `useOnlineStatus` + `OfflineBanner`.
- **Backend error semantics:** documented in `features.ts` (Failed to fetch = not deployed; CORS; 401/403 auth; 500 crash; 200 ok).

**Business rules.** Errors must not corrupt authoritative state; snapshots and deterministic outputs are unaffected by transient API errors.

**Failure/Recovery.** Demo fallback maintains a working UI; health/diagnostics endpoints aid triage; rate-limit headers guide clients.

**APPROVED FUTURE STATE.** Structured error taxonomy + user-facing recovery guidance; incident disclosure per DNA Ch 30.1; durable retry for side effects (§III-32).

**Traceability.** DNA Ch 11/30 · Objective: resilient UX · Modules: all · Workflow: §III-57 · Engine: n/a · AI: n/a · Roadmap: error taxonomy, incident disclosure.

---

## III-57 — Edge Cases

**Why it exists.** Documenting known edge cases prevents regressions and captures reality honestly (Golden Rule 6).

**CURRENT STATE (PROVEN / known).**
- **Backend undeployed / unreachable:** demo fallback keeps UI functional (`BACKEND_INTEGRATION`/`SHOW_API_ERRORS`).
- **Expired session:** team `401` on protected routes; client verification required; **debt:** `isClientSessionExpired` missing may affect client-portal guard (§III-78).
- **Dual scoring divergence:** public keyword instant score vs authoritative engine score can differ; mitigated by passing client-computed `readinessScore` into `createSubmission` (F-001), but the two code paths remain (drift debt).
- **Empty portfolio:** if no domain qualifies (`density/impact < 6`), no recommendations generated — intended (prevents fluff).
- **Ready Gate fail:** proposal held in `draft` with reasons.
- **Post-snapshot edit:** creates a new version; old snapshot immutable; exports never reflect unsent edits.
- **Duplicate lead email:** exit-intent idempotent; returns existing `leadId`.
- **Session key drift:** some components read alternate keys (`team_access_token`/`team_user`) — debt.
- **Offline mid-flow:** offline banner; writes fail and surface per error settings.

**APPROVED FUTURE STATE.** Unified scoring path (resolve dual scoring); unified session store (resolve key drift); durable retries for failed writes.

**Traceability.** DNA Ch 11/17 · Objective: honest robustness · Modules: affected · Workflow: §III-29 · Engines: scoring/snapshot · AI: n/a · Roadmap: scoring/session unification.

---

## III-58 — Performance

**Why it exists.** Performance is part of the effortless experience (DNA Ch 11) and is engineered via explicit contracts.

**CURRENT STATE (PROVEN).**
- **Frontend:** only the landing route is eager; all others lazy-loaded (`makeLazy()`); heavy `jsPDF` loaded via dynamic `import()`; search inputs debounced (`usePerformance`); charts via `recharts` (heavy — isolated to analytics surfaces).
- **Edge:** stateless Hono handlers; 120 req/min/IP rate limit; `/ping` is a no-KV liveness path.
- **Data:** KV reads are keyed lookups; batch analysis available (`analyzeSubmissionsBatch`).

**Business rules.** Performance contracts are enforced by golden rules (`ARCHITECT.md` §0): eager-route minimization, dynamic PDF import, debounced search.

**Failure/Recovery.** Rate limiting sheds load; lazy loading bounds initial payload.

**APPROVED FUTURE STATE.** Caching, pagination, and audit-log indexing (Part I "what's left" — performance hardening); relational query optimization post-cutover.

**Traceability.** DNA Ch 11 · Objective: fast, effortless UX · Modules: routing/UI/edge · Workflow: §III-28 · Engine: n/a · AI: gateway timeouts · Roadmap: caching/pagination.

---

## III-59 — Scalability

**Why it exists.** The platform must grow across customers and load without redesign (DNA Ch 23 evolution).

**CURRENT STATE (PROVEN / constrained).** The edge function is stateless and horizontally scalable by the Supabase platform; persistence is Postgres-backed (KV table + relational). Deterministic engines run client-side, distributing compute to the browser. Current constraints: single Supabase project/region; KV key-scan patterns and lack of pagination limit very large datasets (performance-hardening item); no background job runtime for heavy async work (§III-33).

**APPROVED FUTURE STATE.** Relational store with proper indexing/pagination as authoritative (§III-37); job runner for async scale (§III-33); potential multi-region; server-side engine execution where needed. Scalability must never compromise tenant isolation (DNA Ch 20).

**Traceability.** DNA Ch 20/23 · Operating Constitution Art. 4 · Objective: growth without redesign · Modules: edge/data/engines · Workflow: §III-37 · Engine: repositories · AI: n/a · Roadmap: relational scale, jobs.

---

## III-60 — Reliability

**Why it exists.** Reliability is trust made operational — the system does what it says, repeatably (DNA Ch 17/30).

**CURRENT STATE (PROVEN / constrained).** Determinism is the core reliability guarantee: pure engines produce identical outputs for identical inputs; snapshots are immutable; migrations are idempotent with reconciliation and quarantine. Constraint: side effects (notifications/emails) are synchronous with writes and lack durable retry (§III-32/33) — a reliability gap for delivery guarantees.

**Failure/Recovery.** Idempotent lead capture; migration checkpoints enable resumable runs; rollback scripts; health/diagnostics for detection.

**APPROVED FUTURE STATE.** Durable eventing with retries/dead-letter (§III-32); delivery guarantees for notifications; automated reconciliation sweeps (§III-34).

**Traceability.** DNA Ch 17/30 · Operating Constitution Art. 7/11 · Objective: repeatable correctness · Modules: engines/migration/eventing · Workflow: §III-29/32 · Engine: `snapshotEngine`, migration engine · AI: n/a · Roadmap: durable delivery.

---

## III-61 — Availability

**Why it exists.** The product must be reachable when customers need it.

**CURRENT STATE (PROVEN / dependent).** Availability derives from the Supabase platform (Edge Functions, Postgres) and static hosting of the SPA. There is no application-level multi-region or failover today. The frontend degrades gracefully to demo data when the backend is unreachable (`SHOW_API_ERRORS=false`), preserving a usable UI even during backend outages (though writes are unavailable).

**APPROVED FUTURE STATE.** Defined availability targets/SLOs (§III-83); redundancy/failover as scale warrants; status/health surfacing to operators.

**Traceability.** DNA Ch 22 · Objective: reachability · Modules: hosting/edge · Workflow: §III-30 · Engine: n/a · AI: n/a · Roadmap: SLOs/redundancy.

---

## III-62 — Observability

**Why it exists.** You cannot govern or trust what you cannot see; observability underpins auditability and enforcement (DNA Ch 30).

**CURRENT STATE (PROVEN / partial).**
- **Intelligence telemetry:** `intelligence/telemetry.ts` records gateway events; `health.ts` reports gateway state.
- **Health/diagnostics endpoints:** `/ping`, `/health` (KV read/write/delete cycle), `/test-auth`, `/diagnostic` (counts/types/samples).
- **Frontend logging:** `VERBOSE_LOGGING` flag; console diagnostics.
- **Edge logs:** available via Supabase dashboard.

**Constraint:** no centralized APM/tracing/metrics dashboard; observability is endpoint- and log-based.

**APPROVED FUTURE STATE.** Centralized metrics/tracing; per-feature AI telemetry dashboards; constitutional-compliance observability feeding enforcement (DNA Ch 30.4).

**Traceability.** DNA Ch 30 · Objective: visibility for trust · Modules: intelligence/health · Workflow: §III-63 · Engine: n/a · AI: gateway telemetry · Roadmap: APM/metrics.

---

## III-63 — Monitoring

**Why it exists.** Monitoring detects problems before customers do.

**CURRENT STATE (PROVEN / manual).** Liveness/health via `/ping` and `/health`; database stats via `/diagnostic`; gateway health via `intelligence/health.ts`; Supabase dashboard for edge/DB monitoring. Monitoring is currently pull-based/manual — no automated alerting pipeline.

**APPROVED FUTURE STATE.** Automated monitors + alerting (integrating notifications, §III-48) for health, error rates, gateway failures, and reconciliation anomalies; SLO-based alerts (§III-83).

**Traceability.** DNA Ch 30 · Objective: proactive detection · Modules: health/notifications · Workflow: §III-30 · Engine: n/a · AI: gateway health · Roadmap: alerting.

---

## III-64 — Logging

**Why it exists.** Logs are the record of what happened — the substrate for debugging, audit, and enforcement.

**CURRENT STATE (PROVEN / partial).** Frontend console logging gated by `VERBOSE_LOGGING`; edge-function logs captured by the Supabase platform; intelligence telemetry as structured events. Migration operations write to `migration_reconciliation_log`. Constraint: no centralized, queryable application log store; log retention is platform-default.

**Business rules.** Secrets and credentials must never be logged or written to reports (Operating Constitution Art. 13).

**APPROVED FUTURE STATE.** Structured, centralized, queryable logging with retention policy; correlation IDs across SPA→edge→provider; PII-aware redaction (§III-69).

**Traceability.** DNA Ch 30 · Operating Constitution Art. 13 · Objective: reliable record · Modules: edge/intelligence/migration · Workflow: §III-65 · Engine: n/a · AI: telemetry · Roadmap: centralized logging.

---

## III-65 — Audit Trails

**Why it exists.** Auditability is a constitutional governance commitment: decisions and actions must leave a reviewable trail (DNA Ch 30.2; Ch 17.3).

**CURRENT STATE (PROVEN / partial).**
- **Proposal audit:** immutable snapshots with `version_hash` + `version_number` history preserve exactly what a client received and how it changed (`proposal-p2-implementation.md`).
- **Migration audit:** `migration_runs`, `migration_checkpoints`, `migration_reconciliation_log`, `migration_quarantine` provide a full, idempotent migration trail.
- **Engagement audit:** engagement log (tracked events) and notes.
- **Validation audit:** Ready-Gate outcome logs `validation_timestamp`, `reviewer_id`, `version_hash` (`phase1-gate-criteria.md`).

**Constraint:** no single unified, tamper-evident audit log across all actions (auth changes, permission changes, data edits) — a governance gap relative to DNA Ch 30.4.

**APPROVED FUTURE STATE.** Comprehensive, append-only audit trail across authority-, permission-, and data-changing actions, supporting the enforcement mechanisms of DNA Ch 30.4; audit indexing (performance hardening).

**Traceability.** DNA Ch 17/30 · Objective: reviewable accountability · Modules: proposal/migration/engagement · Workflow: §III-29 · Engine: `snapshotEngine`, migration engine · AI: n/a · Roadmap: unified audit log.

---

## III-66 — Backup

**Why it exists.** Backups protect customer data — a stewardship duty (DNA Ch 20).

**CURRENT STATE (PROVEN / platform-provided).** Persistence lives in Supabase Postgres (KV table + relational); backups are provided by the Supabase platform's managed Postgres backup capabilities. Migration rollback scripts (`supabase/migrations/rollbacks/`) provide schema-level reversibility. There is no separate application-level backup export today.

**Business rules.** Backups inherit tenant isolation and secrets discipline; no secret material in backups outside the secure platform (Operating Constitution Art. 13).

**APPROVED FUTURE STATE.** Documented backup policy (frequency, retention, restore testing); per-tenant export aligned with the exit/portability guarantee (DNA Ch 20.9).

**Traceability.** DNA Ch 20 · Objective: data protection · Modules: data platform · Workflow: §III-67 · Engine: n/a · AI: n/a · Roadmap: backup policy + tenant export.

---

## III-67 — Disaster Recovery

**Why it exists.** DR defines how Cortex returns to service after a major failure.

**CURRENT STATE (PARTIAL).** DR currently relies on the Supabase platform's managed recovery for the database and edge runtime, plus in-repo migration rollback scripts and resumable migration checkpoints. There is **no formal DR runbook, RTO/RPO targets, or tested failover** at the application level — stated honestly as a limitation (§III-79).

**APPROVED FUTURE STATE.** A documented DR plan with RTO/RPO targets, restore drills, and (as scale warrants) redundancy/failover; DR aligned with the availability SLOs (§III-61/83).

**Traceability.** DNA Ch 20/22 · Objective: recoverability · Modules: data platform · Workflow: §III-66 · Engine: migration rollback · AI: n/a · Roadmap: DR runbook + RTO/RPO.

---

## III-68 — Compliance

**Why it exists.** Compliance keeps Cortex within the law — a floor beneath the Constitution (DNA Ch 25.6 Rule of Law).

**CURRENT STATE (PROVEN / product-level).** Compliance today is expressed through product boundaries and discipline rather than external certification:
- **Advisory boundaries:** proposals must not offer regulated legal/medical/financial advice or guarantee results (Ready Gate; §III-4).
- **Autonomy boundaries:** no full-autonomy claims; human-in-the-loop for high-consequence actions (DNA Ch 18).
- **Data discipline:** tenant isolation/RLS, secrets discipline, human review for high-risk changes (Operating Constitution Art. 5/8/13).

**Constraint:** no formal external compliance certifications (e.g., SOC 2, ISO 27001) or documented regulatory mappings exist yet.

**APPROVED FUTURE STATE.** Formal compliance program mapped to applicable regimes; the Rule-of-Law reconciliation process (DNA Ch 25.6) governs any conflict between law and blueprint; enforcement/attestation cadence (DNA Ch 30.4).

**Traceability.** DNA Ch 25.6/30 · Operating Constitution Art. 5/8/13 · Objective: lawful operation · Modules: proposal/data/security · Workflow: §III-29 · Engine: `proposalGateEngine` · AI: n/a · Roadmap: compliance program.

---

## III-69 — Privacy

**Why it exists.** Privacy is data sovereignty in practice — the customer's data belongs to the customer (DNA Ch 20).

**CURRENT STATE (PROVEN / partial).**
- **PII handled:** contact details (name/email/phone/website), diagnostic answers, messages — stored in KV (leads/submissions) and, in schema, relational (`contacts`, `contact_methods`, `leads`).
- **Isolation & scoping:** client tokens scoped to one submission; org scoping + RLS on relational tenant data; secrets discipline.
- **Control:** schema supports correction/removal (`report_versions`, relational entities); data belongs to the customer (DNA Ch 20.1).

**Constraint:** no formal privacy policy engine, consent management, or automated data-subject-request (DSR) tooling yet.

**APPROVED FUTURE STATE.** Consent management; DSR workflows (access/correct/delete/export) realizing DNA Ch 20.7/20.9; PII-aware logging/redaction (§III-64); retention policies.

**Traceability.** DNA Ch 19/20 · Objective: data sovereignty · Modules: data/tenancy · Workflow: §III-9/44 · Engine: repositories · AI: n/a · Roadmap: consent/DSR tooling.

---

## III-70 — Accessibility

**Why it exists.** Accessibility serves the constitutional respect-for-the-customer value (DNA Ch 28) and broadens who can use Cortex (DNA Ch 5 democratize).

**CURRENT STATE (PROVEN / partial).** The UI is built on shadcn/ui over Radix primitives, which provide accessible interaction patterns (focus management, ARIA, keyboard navigation) by default; keyboard shortcuts exist (`useKeyboardShortcuts`). The product is dark-first (Eclipse `#0A0A0F`). **Constraint:** no formal WCAG audit, no documented contrast/AA conformance, no screen-reader test record — accessibility is inherited from primitives, not verified.

**APPROVED FUTURE STATE.** WCAG 2.x AA conformance target with audit; light-theme option; verified contrast and screen-reader support; accessibility as an acceptance criterion (§III-77).

**Traceability.** DNA Ch 5/28 · Objective: inclusive access · Modules: UI · Workflow: §III-27 · Engine: n/a · AI: n/a · Roadmap: WCAG conformance.

---

## III-71 — Versioning

**Why it exists.** Versioning enables safe evolution and honest history (DNA Ch 23; auditability Ch 30).

**CURRENT STATE (PROVEN).**
- **Manifest:** `src/system/manifest.ts` v2.0.0 with `lastVerified` date.
- **Proposal:** `version_number` + `version_hash` per snapshot.
- **Migrations:** timestamped migration files + rollbacks; sprint IDs (MCV2-Sx).
- **Documents:** Constitution `CORTEX_DNA_v1.0`; this Blueprint `v1.0`; Operating Constitution v1.1 (changelog).
- **API:** fixed base path `/make-server-324f4fbe`; **no semantic API version** in the route path yet.

**Business rules.** Structural changes update `ARCHITECT.md`, `system_map.json`, and the manifest (`ARCHITECT.md` §18); manifest ID before code (Art. 14).

**APPROVED FUTURE STATE.** Explicit API versioning scheme; coordinated blueprint/constitution/version tagging; deprecation policy (DNA Ch 23.6).

**Traceability.** DNA Ch 23/30 · Operating Constitution Art. 14/15 · Objective: safe evolution · Modules: manifest/proposal/migrations · Workflow: §III-74/75 · Engine: `versionEngine` · AI: n/a · Roadmap: API versioning.

---

## III-72 — Deployment

**Why it exists.** Deployment is how the blueprint becomes running software.

**CURRENT STATE (PROVEN).** Go-live procedure (`ARCHITECT.md` §16):
1. Deploy edge function: `supabase functions deploy make-server-324f4fbe` (`npm run supabase:deploy`).
2. Set `BACKEND_INTEGRATION: true` (via `VITE_BACKEND_INTEGRATION` in `.env.local`).
3. Set edge secrets: `OPENAI_API_KEY`, `RESEND_API_KEY` (+ Supabase keys).
4. Apply DB migrations: `npm run supabase:db-push`; link via `supabase link`.
5. Verify endpoints (`API_SPECIFICATIONS.md` / `api.config.ts`).
6. Frontend build: `npm run build` (Vite) → static hosting.
No component changes are required to switch demo↔live (gateway pattern).

**Business rules.** Secrets set only in the secure environment; deployment must not change runtime authority (KV) except via governed cutover (Operating Constitution Art. 12/17).

**APPROVED FUTURE STATE.** CI/CD pipeline; automated migration gating; environment-promotion automation.

**Traceability.** Operating Constitution Art. 12/13/17 · Objective: reproducible deploys · Modules: edge/db/frontend · Workflow: §III-74 · Engine: n/a · AI: n/a · Roadmap: CI/CD.

---

## III-73 — Environments

**Why it exists.** Distinct environments isolate risk between development, demonstration, and production.

**CURRENT STATE (PROVEN).**
- **Demo mode:** `BACKEND_INTEGRATION=false` — no backend calls; demo/seed data; safe for presentations.
- **Live/integrated mode:** `BACKEND_INTEGRATION=true` — Supabase edge + KV + gateway.
- **Local dev:** `npm run dev` → Vite dev server (`host:true`, port 5173); local DB setup (`architecture/database/LOCAL_DATABASE_SETUP.md`).
- **Config:** `.env.local` / `.env.example`; Supabase project `oqybniefkbppptfatoae` (`ARCHITECT.md` §1).

**Business rules.** Secrets differ per environment and never cross into VCS (Art. 13); demo mode must not reach providers.

**APPROVED FUTURE STATE.** Formal staging environment mirroring production; per-environment gateway provider config; ephemeral preview environments.

**Traceability.** Operating Constitution Art. 13 · Objective: risk isolation · Modules: config/deploy · Workflow: §III-72 · Engine: n/a · AI: gateway env · Roadmap: staging/preview envs.

---

## III-74 — Release Management

**Why it exists.** Release management ensures changes reach production safely and are recorded.

**CURRENT STATE (PROVEN).** Releases are governed by the sprint model and its quality gates (Operating Constitution Art. 9): architecture-compliance check, regression tests for touched domains, security review for auth/secrets/tenant changes, documentation updates (`ARCHITECT.md`, `system_map.json`, completion report), and a verified rollback path where data/schema changes occur. The roadmap file (`MARQ_CORTEX_ROADMAP.md`) is the single source of sprint progress and is append-only (do not renumber/rewrite).

**Business rules.** No sprint begins beyond assigned scope (Art. 16); completion requires verifiable evidence (Art. 10).

**APPROVED FUTURE STATE.** Automated release pipeline with gate enforcement; release notes tied to manifest/version; feature-flagged rollouts per organization (§III-47).

**Traceability.** Operating Constitution Art. 9/10/16 · DNA Ch 22 · Objective: safe delivery · Modules: all · Workflow: §III-75/76 · Engine: n/a · AI: n/a · Roadmap: release automation.

---

## III-75 — Change Management

**Why it exists.** Change management preserves architectural integrity as the system evolves (DNA Ch 23; Operating Constitution Art. 1).

**CURRENT STATE (PROVEN).** The change checklist (`ARCHITECT.md` §18): update `ARCHITECT.md` (if routes/data flow/key files change), `architecture/system_map.json` (machine snapshot), `src/system/manifest.ts` (new/moved/deleted files, ID before code), and the manifest `lastVerified` date. Authority order for resolving conflicts is defined (Operating Constitution "Authority Order"; DNA Ch 25 precedence): Constitution → Operating Constitution/ARCHITECT → sprint criteria → verified behavior → other docs. Evolution is additive; rebuilds require explicit approval + rollback + evidence (Art. 1).

**Master-rule addition (this program).** Every future feature must exist in this Master Blueprint before implementation; on Blueprint-vs-code conflict, Blueprint wins.

**APPROVED FUTURE STATE.** Automated drift detection (manifest↔filesystem, blueprint↔code); change advisory tied to constitutional decision framework (DNA Ch 24).

**Traceability.** DNA Ch 23/24/25 · Operating Constitution Art. 1/14/15 · Objective: integrity under change · Modules: all · Workflow: §III-74 · Engine: `consistencyValidator` · AI: n/a · Roadmap: drift detection.

---

## III-76 — Testing Strategy

**Why it exists.** Tests are the evidence discipline made executable (Operating Constitution Art. 10 — evidence over assertion).

**CURRENT STATE (PROVEN / partial).** Implemented test suites (npm scripts):
- **Intelligence Gateway:** `npm run test:intelligence` (`intelligence/*.test.ts`).
- **Database migrations (static):** `npm run test:database`.
- **Migration engine:** `npm run test:migration`.
- **Features:** `npm run test:features`.
- **Smoke (E2E):** `npm run test:smoke` (Playwright, `playwright.config.ts`).

**Constraint:** coverage is concentrated on the gateway, migration, and DB layers; there is **no broad unit-test suite for the 35 core engines or UI components** — a gap relative to the load-bearing status of the engines (§III-78). (Note: this refines the older `ARCHITECT.md` §17 "no test suite" entry, which predates the current targeted suites.)

**APPROVED FUTURE STATE.** Unit tests for every deterministic engine (especially scoring/ROI/gate/snapshot); component and integration tests; regression tests per touched domain as a release gate (Art. 9); property-based tests for ROI math.

**Traceability.** Operating Constitution Art. 9/10 · DNA Ch 22 · Objective: verifiable correctness · Modules: engines/gateway/data · Workflow: §III-74 · Engine: all · AI: gateway tests · Roadmap: engine/component test coverage.

---

## III-77 — Acceptance Criteria

**Why it exists.** Acceptance criteria define "done" objectively, preventing drift between intent and delivery.

**CURRENT STATE (PROVEN).** Codified acceptance gates exist for the load-bearing flows:
- **Diagnostic/recommendation:** qualification + ranking + portfolio rules satisfied (§III-54).
- **Proposal P1:** Ready Gate passes (all boardroom checks) to reach `internal_review` (`phase1-gate-criteria.md`).
- **Proposal P2:** snapshot created on send; export reads only from snapshot; version history preserved; export blocked on validation failure; immutable record exists (`proposal-p2-implementation.md`).
- **Sprint acceptance:** per-sprint criteria + quality gates (Art. 9); completion reports with evidence tags (PROVEN/LIKELY/SUSPECTED/MISSING EVIDENCE).

**APPROVED FUTURE STATE.** Acceptance criteria extended to accessibility (§III-70), performance budgets (§III-58), and per-feature enterprise-template completeness (the 15-point quality standard).

**Traceability.** Operating Constitution Art. 9/10 · DNA Ch 24/33 · Objective: objective "done" · Modules: diagnostic/proposal/sprint · Workflow: §III-29 · Engine: `proposalGateEngine` · AI: n/a · Roadmap: expanded acceptance.

---

## III-78 — Technical Debt

**Why it exists.** Honest debt tracking is required by the evidence-first culture (DNA Ch 22.4) and prevents silent decay.

**CURRENT STATE (PROVEN — known debt).** (from `ARCHITECT.md` §17, reconciled to current repo):
| Item | Type | Notes |
|------|------|-------|
| `src/app/lib/session.ts` missing | **BREAK** | `api.ts` imports `ClientAuthContext` from it. |
| `isClientSessionExpired` missing from `AppContext` | **BREAK** | `ClientPortalRoute.tsx` references it. |
| Dual scoring | **DRIFT** | Public `instantScoring.ts` (keywords) vs team `scoringEngine.ts`; mitigated by F-001 but two paths remain. |
| Session key drift | **DRIFT** | Some components use `team_access_token`/`team_user` vs `marq_cortex_team_session`. |
| Legacy registry utils | **ORPHAN** | `utils/registryData*.ts` unused; do not extend (use manifest). |
| No broad engine/component unit tests | **GAP** | Targeted suites exist (intelligence/db/migration/features/smoke); engines/UI uncovered (§III-76). |
| RBAC/tenancy not runtime-authoritative | **GAP** | Relational roles/permissions/RLS present but not enforced at runtime (§III-41/44). |
| Repositories not wired to routes | **GAP** | `server/repositories/*` exist; KV remains the live path (§III-37). |
| No durable eventing/jobs/scheduler | **GAP** | Synchronous side effects; manual email queue (§III-32/33/34). |

**Note/correction:** `API_SPECIFICATIONS.md` (previously listed MISSING in `ARCHITECT.md` §17) **now exists** at repo root and is the API reference for §III-35.

**APPROVED FUTURE STATE.** Each debt item has a resolution path recorded in §III-79/80 and the roadmap (Part VI, when authored). Debt is burned down under change management (§III-75), never normalized.

**Traceability.** DNA Ch 22 · Operating Constitution Art. 10 · Objective: honest decay control · Modules: affected · Workflow: §III-75 · Engine: n/a · AI: n/a · Roadmap: debt burndown.

---

## III-79 — Current Limitations

**Why it exists.** Limitations are the honest edges of the current implementation — distinct from debt (things wrong) these are things not yet built (DNA Ch 8.3 reality-vs-model).

**CURRENT STATE (PROVEN).**
1. **KV is authoritative; relational is not** — full relational benefits (constraints, RLS enforcement, rich queries) await cutover (§III-37).
2. **No background jobs / scheduler** — async and recurring work is request- or CLI-bound (§III-33/34).
3. **Synchronous side effects, no durable retry** — notification/email delivery is best-effort (§III-32/60).
4. **No billing/licensing** — commercial terms are out-of-band (§III-46/47).
5. **Partial RBAC/tenancy at runtime** — enforcement is route-scheme + UI, not full permission checks (§III-41/44).
6. **No formal DR/backup policy or compliance certifications** (§III-66/67/68).
7. **Accessibility unaudited; dark-theme only** (§III-70).
8. **Workforce model not yet literal** — executives/managers/workers are the approved model, realized today as the engine orchestra + gateway (DNA Ch 8.3; §III-18).
9. **Memory does not yet compound automatically** (§III-20).
10. **Interaction is GUI-only** — natural language/voice are future (DNA Ch 15–16).

**APPROVED FUTURE STATE.** Each limitation maps to an approved enhancement (§III-80) or roadmap phase; none contradicts the Constitution.

**Traceability.** DNA Ch 8.3/15/16/19/20 · Objective: honest scope of "now" · Modules: all · Workflow: n/a · Engine: n/a · AI: n/a · Roadmap: see §III-80.

---

## III-80 — Approved Future Enhancements

**Why it exists.** To record what is approved-but-unbuilt, so vision is captured without inventing features (Golden Rule 5). Every item traces to Part I "what's left," the roadmap, or Part II.

**APPROVED FUTURE STATE (sources cited).**
- **From Part I ("only 6 things left"):** UI layout refinement (team + client); role-based UI controls; premium export styling templates; notifications (Slack/email/in-app for tasks/incidents/QBR); external integrations (Zoho/HubSpot, email provider, doc-sign); performance hardening (caching, pagination, audit-log indexing).
- **From the roadmap (`MARQ_CORTEX_ROADMAP.md`):** Runtime Storage Gateway completion (outcome/lead/submission shadow reads → full runtime validation) → SQL cutover (read rollout → authority validation → KV retirement).
- **From the Constitution (Part II):** literal AI-Workforce realization (executives/managers/workers with authority bounds — DNA Ch 8/18); compounding memory engine (Ch 19); data exit/portability + DSR tooling (Ch 20.7/20.9); enforcement/attestation + unified audit (Ch 30.4); natural-language then voice interaction (Ch 15–16); progressive-complexity entitlements (Ch 14).
- **Engineering (from §III-78/79):** durable eventing + job runner + scheduler; enforced relational RBAC; billing/licensing; DR runbook + backup policy; WCAG conformance; broad engine/component test coverage; API versioning.

**Governing rule.** None of the above may be implemented before it is written into this Master Blueprint (Master Rule) and passes the constitutional decision framework (DNA Ch 24).

**Traceability.** DNA Ch 8/14/15/16/18/19/20/30 · Part I audit · `MARQ_CORTEX_ROADMAP.md` · Objective: captured, disciplined vision · Modules: all · Workflow: Part VI (future) · Engine: future · AI: future · Roadmap: Part VI.

---

## III-81 — Product Metrics

**Why it exists.** Product metrics measure whether the product creates the value it claims (DNA Ch 33), without rewarding vanity (Ch 33.3).

**CURRENT STATE (PARTIAL).** The platform captures raw signals that support product metrics but does not yet compute formal metric definitions: submissions created, diagnostic completion, instant-score distribution, recommendation counts, proposal status progression, engagement events, client responses. Surfaced via `getAnalytics`, engagement analytics, and dashboards (§III-50). Formal, named product KPIs are largely undefined in code today.

**APPROVED FUTURE STATE (constitutionally anchored).** Define product metrics such as **time-to-first-value** (prospect → confident score), **Ready-Gate pass rate**, **diagnosis-to-proposal conversion**, **proposal acceptance rate**, and **experienced simplicity** — all subordinate to trust and outcome delivery (DNA Ch 33.2), never to feature count or engagement-for-its-own-sake (Ch 33.3).

**Traceability.** DNA Ch 33 · Objective: measure real value · Modules: analytics · Workflow: §III-30 · Engine: `dashboardAggregator` · AI: narrate · Roadmap: metric definitions.

---

## III-82 — Operational Metrics

**Why it exists.** Operational metrics measure the health of running the platform.

**CURRENT STATE (PARTIAL).** Signals available: health/KV connectivity (`/health`), DB counts (`/diagnostic`), rate-limit headers, gateway telemetry/health, email-queue status. No consolidated operational dashboard/SLO reporting yet.

**APPROVED FUTURE STATE.** Operational KPIs — API latency/error rate, gateway success/latency, reconciliation health during migration, notification delivery success, uptime/availability against SLOs (§III-61/83) — surfaced via monitoring/alerting (§III-63).

**Traceability.** DNA Ch 22/30 · Objective: operational health · Modules: health/intelligence/email · Workflow: §III-62/63 · Engine: n/a · AI: gateway telemetry · Roadmap: ops dashboards/SLOs.

---

## III-83 — Success Metrics

**Why it exists.** Success is measured by fulfillment of purpose, not accumulation of features — these metrics are constitutional (DNA Ch 33) and govern what "winning" means.

**CURRENT STATE (inherited from Part II).** The constitutional success test applies now: every capability must pass the Six Constitutional Questions (DNA Ch 24/33.1). The constitutional success dimensions (DNA Ch 33.2) — outcome delivery, effortless capability, trust, workforce coherence, simplicity under growth, compounding judgment, integrity, durability, breadth — are the standing definition of success. Explicit numeric targets are not yet instrumented (see §III-81/82).

**APPROVED FUTURE STATE.** Instrument the success dimensions with concrete targets/SLOs; **trust** as the north-star metric (DNA Ch 33.2.3); exclude anti-metrics (complexity, opacity, trust-erosion, extraction — Ch 33.3) from any decision weighting.

**Traceability.** DNA Ch 24/33 · Objective: purpose-fulfillment measurement · Modules: analytics/governance · Workflow: §III-30 · Engine: n/a · AI: narrate · Roadmap: instrumented success dimensions.

---

## III-84 — Governance

**Why it exists.** Governance is how the product stays aligned with the Constitution over time (DNA Ch 30/35).

**CURRENT STATE (PROVEN).** Governance operates through: the **Constitution** (Part II) as supreme authority; the **Operating Constitution** (`MARQ_CORTEX_CONSTITUTION.md`) enforcing engineering mechanics (17 articles) and the authority order; **ARCHITECT.md** golden rules; **sprint quality gates** (Art. 9); the **manifest/registry** as the component authority; and this **Master Blueprint** as the product/architecture authority (Master Rule: blueprint before code). The precedence order (DNA Ch 25.1) resolves conflicts.

**APPROVED FUTURE STATE.** The constitutional enforcement mechanisms (compliance review, standing, remediation, text integrity — DNA Ch 30.4), the entrenched-core amendment process and Constitutional Guardian (DNA Ch 35.5–35.7), and blueprint↔code drift governance (§III-75) operationalized.

**Traceability.** DNA Ch 25/30/35 · Operating Constitution (all) · Objective: durable alignment · Modules: all · Workflow: §III-75 · Engine: `consistencyValidator` · AI: n/a · Roadmap: enforcement operationalization.

---

## III-85 — Ownership

**Why it exists.** Clear ownership prevents orphaned responsibility (DNA Ch 9 stewardship).

**CURRENT STATE (PROVEN).** **MARQ Networks** owns and stewards Cortex, the brand, the IP, and this Blueprint (DNA Ch 9). Within the artifact set: the Constitution owns identity/philosophy/governance; the Operating Constitution owns engineering mechanics; `ARCHITECT.md` owns the repository map; the manifest owns component identity; this Blueprint owns the product/architecture description. Ownership binds all successor stewards (DNA Ch 9 continuity/succession).

**APPROVED FUTURE STATE.** Named role-level ownership (product, architecture, AI, security) mapped to decision authority (§III-86); Constitutional Guardian constituted (DNA Ch 35.6).

**Traceability.** DNA Ch 9/35 · Objective: unambiguous responsibility · Modules: all · Workflow: §III-86 · Engine: n/a · AI: n/a · Roadmap: role ownership + guardian.

---

## III-86 — Decision Authority

**Why it exists.** Decisions must have owners and a resolution order, or governance stalls or drifts (DNA Ch 24/25).

**CURRENT STATE (PROVEN).**
- **Identity/philosophy/ethics/boundaries:** the Constitution (Part II); amendments only via DNA Ch 35 (steward + Guardian for core).
- **Product/architecture:** this Master Blueprint (Master Rule); features must be blueprinted before build.
- **Engineering mechanics:** Operating Constitution + `ARCHITECT.md`.
- **Scoped execution:** sprint acceptance criteria.
- **Authoritative computation:** deterministic engines (math decides).
- **High-consequence runtime actions:** humans (DNA Ch 18.9).
- **Conflict resolution order:** DNA Ch 25.1 precedence (Constitution → Operating Constitution/ARCHITECT → agent contract → sprint criteria → verified behavior → other docs), with this Blueprint governing product/architecture beneath the Constitution.

**APPROVED FUTURE STATE.** A decision registry (§III-16) binding each recurring decision type to its authority; Guardian participation for entrenched-core interpretation (DNA Ch 25.5/35.6).

**Traceability.** DNA Ch 18/24/25/35 · Objective: owned decisions · Modules: all · Workflow: §III-31 · Engine: deterministic engines · AI: narrate · Roadmap: decision registry.

---

## III-87 — Traceability Matrix

**Why it exists.** The traceability matrix guarantees Golden Rule "nothing exists without a traceable purpose" by mapping each major capability to its constitutional principle, engine(s), workflow, API surface, data, and future roadmap.

**CURRENT STATE (PROVEN — representative matrix).**

| Capability | Constitution (Part II) | Core Engine(s) | Business Workflow | API Group | Data | Roadmap |
|-----------|------------------------|----------------|-------------------|-----------|------|---------|
| Lead capture | Ch 5 (democratize) | `crmEngine` | §III-29(1) | Grp 2 | KV `lead:*` / `leads` | CRM sync |
| Diagnostic & scoring | Ch 6/17 | `inputNormalizer`,`scoringEngine` | §III-29(2) | Grp 4 | `submissions`,`diagnostic_*` | SQL cutover |
| Recommendation portfolio | Ch 6 (math decides) | `decisionEngine`,`portfolioEngine` | §III-29(2) | (derived) | `domain_scores` | dept realization |
| ROI modeling | Ch 17/18 | `roiEngine`,`dcf/irr/monteCarlo/scenario/cost` | §III-29(3) | (derived) | proposal/ROI state | ROI expansion |
| Proposal governance | Ch 18 (authority) | `proposalGateEngine` | §III-29(4) | Grp 7 | KV proposal | — |
| Snapshot & export | Ch 17.3/30 (audit) | `snapshotEngine`,`versionEngine`,`exportEngine` | §III-29(5) | Grp 7 | immutable snapshot | export styling |
| Contract | Ch 18 | `contractEngine` | §III-29(6) | Grp 7 | KV contract | e-sign |
| Execution delivery | Ch 8/31 | `executionEngine`,`templateAssembler`,`scopeEngine` | §III-29(7) | (team) | KV execution | automation |
| ROI actuals & QBR | Ch 19/33 | `roiActualsEngine`,`qbrEngine` | §III-29(8) | Grp 8/9 | `outcomes` | scheduling |
| CORTEX AI (chat/narrative/assist/copilot/objection) | Ch 17 | `copilotEngine`,`aiAssistEngine`,`objectionEngine` | §III-18 | Grp 13 | via gateway | multi-provider/agents |
| Client portal | Ch 11/13 | (UI) | §III-28 | Grp 5 | scoped submission | progressive UI |
| Multi-tenancy | Ch 20 | repositories | §III-44 | (all) | `organizations`,RLS | enforced RLS |
| Migration/data authority | Ch 20 | migration engine | §III-37 | (CLI) | `migration_*` | SQL authority |

**APPROVED FUTURE STATE.** Expand to a complete row-per-manifest-node matrix; auto-generate from manifest + this Blueprint; extend to Parts IV–VI capabilities when authored.

**Traceability.** DNA Ch 24 · Operating Constitution Art. 15 · Objective: full purpose-traceability · Modules: all · Workflow: all · Engines: all · AI: gateway · Roadmap: generated matrix.

---

## III-88 — Appendix References

**Why it exists.** The blueprint governs; the referenced artifacts carry exhaustive detail (Golden Rule 8 — cross-reference, don't duplicate). This appendix indexes the authoritative sources a rebuild would consult.

**Part I / II source documents.**
- Constitution (Part II): `CORTEX_DNA_v1.0.md`.
- Operating Constitution: `MARQ_CORTEX_CONSTITUTION.md` (v1.1, 17 articles + authority order).
- Product Recovery / audit (Part I): `src/imports/cortex-audit-report.md`.
- Repository map & golden rules: `ARCHITECT.md`; machine snapshot: `architecture/system_map.json`.
- Agent operating contract: `prompts/MARQ-CLAUDE-AGENT-SYSTEM-PROMPT-v1.0.md`.

**Architecture & data.**
- API: `API_SPECIFICATIONS.md`.
- Database: `DATABASE_SCHEMA.md`; `architecture/database/MCV2-S3-ENTITY-RELATIONSHIP-DIAGRAM.md`, `MCV2-S3-TABLE-CATALOG.md`, `MCV2-S3-MIGRATION-ROADMAP.md`, `MCV2-S5-KV-RELATIONAL-MAPPING.md`, `MEMBERSHIP_BOOTSTRAP.md`, `LOCAL_DATABASE_SETUP.md`.
- Migrations: `supabase/migrations/*` (+ `rollbacks/`).
- Intelligence Gateway: `src/imports/MCV2-S1-AUDIT-001-*`, `MCV2-S1-IMPLEMENT-001.5-*`, `MCV2-S2-FRONTEND-GATEWAY-NORMALIZATION.md`, `MCV2-intelligence-gateway-provider-extension-guide.md`; code `supabase/functions/server/intelligence/`.

**Engine & feature specifications (`src/imports/`).**
- Diagnostic/recommendation: `cortex-rules.md`, `diagnostic-schema.md`, `recommendation-engine-guide.md`, `recommendation-portfolio.md`, `scope-engine-logic.md`, `mapping-engine-process.md`.
- ROI suite: `roi-engine-math-doc.md`, `roi-modeling-guide.md`, `dcf-integration-spec.md`, `irr-integration-spec.md`, `monte-carlo-spec.md`, `scenario-modeling-spec.md`, `cost-modeling-layer.md`, `cashflow-timeline-model.md`, `roi-actuals-engine.md`, `roi-tracking-spec.md`, `roi-system-integration-spec.md`, `roi-dependency-spec.md`, `financial-summary-binding-1.md`.
- Proposal/contract/QBR: `phase1-gate-criteria.md`, `phase1-gate-requirements.md`, `ready-gate-rules.md`, `proposal-p2-implementation.md`, `proposal-control-export.md`, `contract-auto-gen.md`, `qbr-generator-overview.md`, `revenue-control-process.md`.
- Execution/blocks/copilot: `execution-blueprint.md`, `implementation-architecture.md`, `system-build-order.md`, `ai-assist-per-block.md`, `copilot-patch-plan.md`, `solution-architecture-binding.md`.
- CRM/comms: `crm-sync-spec.md`.
- Dashboards: `dashboard-specs.md`, `roi-dashboard-specs.md`, `roi-wireframe.md`.
- Data platform: `MCV2-S3-CORTEX-DATA-PLATFORM-ARCHITECTURE.md`.

**Roadmap / governance.**
- `MARQ_CORTEX_ROADMAP.md`, `MARQ_CORTEX_EXECUTION_RULES.md`, `MARQ_CORTEX_DOCUMENTATION_RULES.md`, `MARQ_CORTEX_TEST_PROTOCOL.md`.
- System memory: `memory/failure_library.md`, `memory/regression_cases.md`.
- Component registry: `src/system/manifest.ts` (158 nodes); config: `src/config/features.ts`, `api.config.ts`, `runtime.ts`.

**Traceability.** Operating Constitution Art. 15 (documentation as contract) · Golden Rule 8 · Objective: exhaustive detail preserved by reference · Modules: all · Roadmap: Parts IV–VI reference additions.

---

## Part III — Completion Status

**Part III (Phase 3 — Product Blueprint) is complete: Sections III-1 through III-88 plus Appendix References (§III-88).** It documents the MARQ Cortex product reality-first, separates CURRENT STATE from APPROVED FUTURE STATE throughout, traces every capability to Part II and to the engines/workflows/data/roadmap, and preserves exhaustive detail by reference to the artifacts indexed in §III-88. Nothing in Part III rewrites, summarizes, or contradicts Parts I or II.

**Continuity note.** The Master Blueprint remains a single document. **Part IV — AI Company Architecture** and **Part V — Future Vision** are authored and LOCKED, and **Part VI — Execution Roadmap** is authored and IN PROGRESS (Phase 6.1 complete), each appended below with continuous numbering. All continue the same numbering and formatting conventions, with no restart and no split.

*End of Part III.*

---

# PART IV — PHASE 4: AI COMPANY ARCHITECTURE

**Status:** IN PROGRESS · **Numbering:** Sections IV-1 onward (continuing the single-document numbering after §III-88) · **Continuity:** Part IV appends to the same Master Blueprint; numbering and formatting are continuous and are never restarted. Parts I–III remain LOCKED and are neither modified, restated, nor contradicted here (Preservation rule; Golden Rules 1 and 8).

## Reading conventions for Part IV

Part IV describes MARQ Cortex **as a company** — the AI-first operating model beneath the product documented in Part III and the identity ratified in Part II. It carries forward the Part III discipline without exception:

- **CURRENT STATE** — what is true today, grounded in the repository and in the approved blueprint (Parts I–III). Confidence tags apply: *PROVEN* (verified in code/artifact or in a LOCKED Part), *PARTIAL* (defined but not fully realized in runtime), *DEBT* (present but drifting from the Constitution). Nothing is asserted as implemented that is not.
- **APPROVED FUTURE STATE** — approved by the Constitution (Part II) or the roadmap but **not yet implemented**. Every future item traces to Part II or to `MARQ_CORTEX_ROADMAP.md`. Realization is progressive and additive (DNA Ch 8.3, Ch 23), never a rebrand.

**Scope discipline for Phase 4.1.** This phase establishes only the **company foundation** — principles, philosophy, governance foundations, layers, the human–AI collaboration frame, enterprise architecture principles, and success principles. It deliberately does **not** define departments, individual AI executives/managers/workers, organization charts, KPIs, operational or communication workflows, knowledge-management or AI-memory implementation, security implementation, metrics, or department responsibilities. Those belong to later Phase 4.x sections and are not invented ahead of their phase (Golden Rule 5).

**Section template.** Every Phase 4.1 section answers, in order: *Purpose · Why it exists · Scope · Current State · Approved Future State · Dependencies · Traceability to Parts I–III.* Each section closes with a **Traceability** line to the Constitution (Part II), the Product Blueprint (Part III), the recovered structural state (Part I), and the roadmap where applicable.

---

## Phase 4.1 — Company Foundation

*This phase defines the foundational operating model of MARQ Cortex as an AI-first company: the principles, philosophy, governance foundations, and enterprise operating model on which every later Part IV phase is built. It sits between the constitutional identity of Part II (which says **what Cortex is**) and the later Phase 4.x phases (which will say **how the AI company is organized and operated**). It introduces no departments, roles, or workflows.*

---

## IV-1 — Executive Summary

**Purpose.** To state, in one place, what Part IV is, what Phase 4.1 establishes, and how the AI-company foundation relates to everything already locked in Parts I–III.

**Why it exists.** Part II ratified Cortex's identity as *an AI company operating on behalf of businesses* (DNA Ch 8.1). Part III documented the product that is the first faithful expression of that identity (§III-1). Part IV is where the **company** behind the product is architected. Phase 4.1 exists so that the foundation — principles, philosophy, governance, operating model — is settled and constitutional before any organizational structure, role, or workflow is drawn. Foundation precedes structure; structure precedes operation.

**Scope.** Phase 4.1 covers the foundational operating model only: the vision, mission, philosophy, operating principles, the AI-first operating model, organizational layers (as concept, not chart), the human–AI collaboration frame, governance principles, enterprise architecture principles, and success principles. It excludes all structure, roles, workflows, and metrics (deferred to later Phase 4.x).

**Current State (PROVEN).** The AI-company model is **defined and constitutionally approved** (Part II, DNA Ch 8) and **documented as identity** in Part III (§III-1, §III-3). Its first realization is the running product: a deterministic engine orchestra plus a provider-agnostic Intelligence Gateway that narrates, presented behind a single calm interface (`ARCHITECT.md` §0 "Math decides; AI narrates"; §III-15/§III-17/§III-21). The mechanics that make it governable — provider independence, deterministic authority, phased data platform, multi-tenancy/RLS, human review for high-risk change — are already codified in the Operating Constitution (`MARQ_CORTEX_CONSTITUTION.md`, Articles 1–17). What does **not** yet exist in runtime is the company *as an organization of named executive/manager/worker constructs*; the data platform records `ai_worker` service-account identity as **Future** (DNA Ch 8.3; §III-1 APPROVED FUTURE STATE).

**Approved Future State.** Progressive realization of the full AI-Workforce organization as first-class runtime constructs, authored across later Phase 4.x phases and built additively (DNA Ch 8.3, Ch 23). Phase 4.1 authorizes none of that structure; it fixes the foundation on which it will stand.

**Dependencies.** Part II (identity and governing authority), Part III (the product the company operates), the Operating Constitution (governance mechanics), and `MARQ_CORTEX_ROADMAP.md` (sequence of realization).

**Traceability.** Part I: recovered structural state as the source of every CURRENT STATE claim (`ARCHITECT.md`; `architecture/system_map.json`). Part II: DNA Ch 8/8.3 (identity as approved-yet-progressive model), Ch 2 (executive summary altitude). Part III: §III-1 (product overview), §III-84–§III-86 (governance/ownership/authority). Roadmap: full-workforce realization.

---

## IV-2 — Company Vision

**Purpose.** To translate Cortex's constitutional Vision (DNA Ch 7) into a *company-level* north star — what MARQ Cortex is becoming as an AI-first company — without inventing capability or restating Part II.

**Why it exists.** A company needs a fixed destination that outlives any roadmap so that every later structural and operational decision can be checked against it. This section provides that destination at the company altitude, distinct from the product-vision altitude of §III-3.

**Scope.** The long-horizon direction of the company only. It does not enumerate the departments, roles, or milestones that will realize the vision (those are later Phase 4.x and Part V/VI work).

**Current State (PROVEN).** The vision is already expressed *in miniature* by the running platform: a business's answers mobilize a coordinated set of engines and gateway-mediated AI to produce a boardroom-grade result through a simple, guided experience (§III-3 CURRENT STATE). Today that coordination is the deterministic engine orchestra (`runCortexEngine`, §III-21) rather than a literal organization of AI executives and workers.

**Approved Future State.** MARQ Cortex becomes the literal AI company its identity describes — an intelligent digital workforce any business can hire — realized progressively toward named executive/manager/worker roles operating with authority bounds, compounding memory, and progressive disclosure (DNA Ch 7/8/14/18/19; §III-3 APPROVED FUTURE STATE). Interaction advances GUI → natural language → voice → multimodal (DNA Ch 15–16). No element of this future is claimed as present.

**Dependencies.** DNA Ch 7 (Vision) as the governing statement; §III-3 (product-vision implementation) as the current expression; DNA Ch 8.3 (progressive realization) as the mode.

**Traceability.** Part I: current expression grounded in `ARCHITECT.md`. Part II: DNA Ch 7/8/14/15/16. Part III: §III-3. Roadmap: interaction-model progression and full-workforce realization.

---

## IV-3 — Company Mission

**Purpose.** To state the company-level mission of MARQ Cortex — what the company does, for whom, and to what measurable end — derived from the constitutional Mission (DNA Ch 6) and Purpose (DNA Ch 5).

**Why it exists.** Vision fixes the destination; mission fixes the ongoing work. The company needs a durable statement of its everyday purpose so that structure and operations, when later defined, serve outcomes rather than activity.

**Scope.** The enduring mission of the company. It does not assign the mission to any department or role, and it defines no metrics for measuring it (later Phase 4.x and §III-83 already hold constitutional success dimensions).

**Current State (PROVEN).** The mission is already operative in the product: Cortex diagnoses a business, quantifies readiness, prioritizes recommendations, models ROI, governs proposals, and delivers execution with live outcome measurement — the full advisory lifecycle (§III-1/§III-2 CURRENT STATE). Authoritative value is produced by deterministic engines and narrated by AI (DNA Ch 17; Operating Constitution Art. 6). The mission today is fulfilled through this pipeline, not through an organization of AI roles.

**Approved Future State.** The same mission — creating measurable business value with minimum complexity — extended across industries and deepened toward the full workforce model, additively (DNA Ch 5/6/23; §III-2 APPROVED FUTURE STATE). No new mission is introduced by Part IV; the company's mission is the constitutional mission, operated at company scale.

**Dependencies.** DNA Ch 5 (Purpose) and Ch 6 (Mission) as governing statements; §III-1/§III-2 as the current realization; Operating Constitution Art. 6 (deterministic authority) as the guarantee of honest value.

**Traceability.** Part I: pipeline evidenced in `ARCHITECT.md` §0–§1. Part II: DNA Ch 5/6/17. Part III: §III-1/§III-2. Roadmap: industry and workforce expansion.

---

## IV-4 — Organizational Philosophy

**Purpose.** To state the beliefs about *how MARQ Cortex organizes intelligence* — the philosophy that will later justify (or reject) every department, role, and workflow.

**Why it exists.** Structure without philosophy drifts. Before any organization is drawn, the company must fix *why* it is organized as a company of intelligence at all, so later structural choices are checked against belief rather than convenience.

**Scope.** Organizing beliefs only. It defines no actual organization — no departments, no roles, no charts. It states the principles by which a future organization will be judged coherent.

**Current State (PROVEN).** The organizing philosophy is inherited from Part II and is already visible in the codebase's shape: one canonical authority per responsibility (Operating Constitution Art. 14, DNA Ch 22.5), deterministic engines owning math while AI narrates (DNA Ch 17; Art. 6), and capability organized to *strengthen the AI Workforce model rather than fragment it* (DNA Ch 27.10). Today this coherence is realized in engines, services, and the manifest registry (`src/system/manifest.ts`, 158 nodes; §III-26) — not yet in an organization of AI roles.

**Approved Future State.** The same coherence principle governs the future organization: any department, manager, or worker exists only if it strengthens the coordinated AI company and avoids duplicating an existing authority (DNA Ch 8.1, Ch 27.10, Ch 29.2). The concrete organization is deferred to later Phase 4.x; only the philosophy is fixed here.

**Dependencies.** DNA Ch 8 (identity as an organized company), Ch 22 (engineering philosophy: one canonical source), Ch 27 (core principles); Operating Constitution Art. 14 (manifest/registry discipline).

**Traceability.** Part I: canonical-authority shape evidenced in `ARCHITECT.md` and `src/system/manifest.ts`. Part II: DNA Ch 8/22/27/29. Part III: §III-21 (core engines), §III-26 (component inventory). Roadmap: workforce-model realization.

---

## IV-5 — Enterprise Operating Principles

**Purpose.** To record the standing enterprise principles by which the company operates — the operational expression of Part II's philosophy at company altitude.

**Why it exists.** The company needs a compact, checkable set of operating principles so that later structure and operations inherit a consistent standard rather than re-deriving one. These principles are the enterprise-level restatement of constitutional commitments, not new law.

**Scope.** Enterprise operating principles as principles. It defines no operational workflows, no procedures, and no metrics; those are later work and remain governed by §III-29–§III-36 and later Phase 4.x.

**Current State (PROVEN).** The enterprise already operates under a codified principle set: **evolve, do not rebuild** (Art. 1; DNA Ch 22.3); **provider-independent intelligence** (Art. 2; DNA Ch 17); **deterministic logic is authoritative** (Art. 6; DNA Ch 17); **multi-tenancy and RLS** (Art. 5; DNA Ch 20); **human review for high-risk change** (Art. 8; DNA Ch 18); **evidence over assertion** (Art. 10; DNA Ch 22.4); **scope discipline** (Art. 16; DNA Ch 22.8). These are enforced today across the repository and documented in Part III (§III-39–§III-44, §III-72–§III-75). This is PROVEN foundation, not aspiration.

**Approved Future State.** As the company grows into an organization of AI roles, these principles hold and tighten rather than relax (DNA Ch 20.8, Ch 32). New enterprise principles enter only through the Constitution's process (DNA Ch 35); Phase 4.1 adds none beyond restating those already ratified.

**Dependencies.** The Operating Constitution (Articles 1–17) for mechanics; DNA Ch 17–23, 27, 29 for intent; Part III governance and deployment sections for current enforcement evidence.

**Traceability.** Part I: enforcement evidenced across `ARCHITECT.md` and the codebase. Part II: DNA Ch 17/18/20/22/27/29. Part III: §III-39–§III-44, §III-72–§III-75, §III-84. Roadmap: principles carried into workforce realization.

---

## IV-6 — AI-First Operating Model

**Purpose.** To define what it means for MARQ Cortex to operate as an **AI-first** company: AI does the work of the company, under human authority, with deterministic systems owning truth and AI narrating it.

**Why it exists.** "AI-first" is easily misread as "AI-autonomous." This section fixes the correct meaning at the foundation so that no later structure or workflow can quietly convert AI-first into unbounded autonomy.

**Scope.** The operating model as a foundational concept — the division between deterministic authority and AI reasoning, and the human-over-AI authority frame. It does not implement the model, staff it with roles, or define its workflows.

**Current State (PROVEN).** The AI-first model is **already operative in its foundational form**: deterministic engines own scoring, ROI, prioritization, proposals, and execution math; AI explains and narrates but never overrides authoritative numbers (Operating Constitution Art. 6; DNA Ch 17; `ARCHITECT.md` §0). Intelligence is provider-agnostic through the Intelligence Gateway (Art. 2; §III-17), and action is bounded by granted authority with human review for high-consequence steps (Art. 8; DNA Ch 18; §III-4). What exists today is AI-*assisted* operation (copilot, narrative, assist, objection features — §III-18) rather than a fully AI-*operated* organization of roles.

**Approved Future State.** Progressive advance toward AI-operated departments, managers, and workers executing defined work reliably and at scale — always under the human-over-AI authority doctrine, with reasoning free and action bounded, and with autonomy widening only upward from the high-consequence floor and only with proof (DNA Ch 18.4/18.9, Ch 8.3). Runtime `ai_worker` identity is recorded as **Future** (DNA Ch 8.3; §III-1). No autonomy expansion is authorized by Phase 4.1.

**Dependencies.** DNA Ch 17 (AI philosophy) and Ch 18 (human–AI authority) as governing doctrine; Operating Constitution Art. 2/6/8; §III-15/§III-17/§III-18 (AI architecture, gateway, orchestration) as the current implementation surface.

**Traceability.** Part I: deterministic-authority separation evidenced in `ARCHITECT.md` §0 and `src/app/core/`. Part II: DNA Ch 8/17/18. Part III: §III-4, §III-15, §III-17, §III-18. Roadmap: autonomy governance; multi-provider/agents.

---

## IV-7 — Organizational Layers

**Purpose.** To name the **layers** of the AI company as a conceptual model — the altitudes at which intelligence is organized — without drawing an organization chart or assigning any role.

**Why it exists.** A company needs a shared vocabulary of altitude (who sets direction, who coordinates, who executes, what owns truth) before it can define specific roles. This section fixes the layer concept so later Phase 4.x work can populate it precisely and without ambiguity.

**Scope.** The layers as constitutional concepts only. It does **not** define departments, individual executives/managers/workers, reporting lines, an org chart, or responsibilities. It lists the layers the Constitution already names and stops there.

**Current State (PARTIAL).** The layers are **defined in the Constitution** as the architecture of Cortex's intelligence: AI Executives, AI Departments, AI Managers, AI Workers, Business Engines, Reasoning Systems, Memory Systems, Automation Systems, Business Intelligence, and Enterprise Governance (DNA Ch 8.1). Of these, the layers realized in runtime today are the **Business Engines** (deterministic core — §III-21/§III-22), the **Reasoning Systems** (gateway-mediated AI narration — §III-15/§III-18), the foundations of **Memory** (§III-20), and **Enterprise Governance** (auth/RLS/audit — §III-39–§III-44, §III-65). The Executive/Department/Manager/Worker layers are **defined but not yet realized as runtime constructs** (DNA Ch 8.3; `ai_worker` identity recorded as Future).

**Approved Future State.** Progressive realization of the full layer stack as first-class runtime constructs, additively and without rebrand (DNA Ch 8.3, Ch 23). The concrete population of each layer — which departments, which roles, which responsibilities — is explicitly deferred to later Phase 4.x and is not authored here.

**Dependencies.** DNA Ch 8.1 (the named layers) and Ch 8.3 (progressive realization); §III-15/§III-18/§III-20/§III-21/§III-22/§III-39 for the layers already realized.

**Traceability.** Part I: realized layers evidenced in `src/app/core/` and `supabase/functions/server/intelligence/`. Part II: DNA Ch 8.1/8.3. Part III: §III-15, §III-18, §III-20, §III-21, §III-22, §III-39–§III-44. Roadmap: layer-by-layer workforce realization.

---

## IV-8 — Human & AI Collaboration Framework

**Purpose.** To fix, at the foundation, how humans and AI collaborate inside and around the company: who holds authority, who reasons, who acts, and where a human must remain in control.

**Why it exists.** The company's entire trustworthiness rests on the human–AI authority relationship. This section states the collaboration frame as foundation so that every later role and workflow inherits it and none can weaken it.

**Scope.** The collaboration *frame* — principles of authority, reasoning, action, and escalation. It does not define specific collaboration workflows, communication workflows, approval procedures, or role-level responsibilities (later Phase 4.x).

**Current State (PROVEN).** The framework is **already enforced in the product**: authority is granted, never assumed; action is bounded to granted permission while reasoning is free; high-consequence steps keep a human in the loop; and the platform escalates rather than overreaches (DNA Ch 18.1–18.9; Operating Constitution Art. 8). In the running system this appears as gated state changes (proposal send, scope changes, status transitions), the Phase 1 Ready Gate blocking unquantified or over-claiming output, and human review required for high-risk domains (§III-4, §III-29, §III-41; `src/imports/phase1-gate-criteria.md`). Today the "AI side" of the collaboration is assistive (copilot/assist/narrative), not an organization of autonomous AI colleagues.

**Approved Future State.** As AI executives, managers, and workers are realized, the same frame governs them: humans remain the principal, Cortex remains the workforce (DNA Ch 18.8); autonomy broadens only upward from the high-consequence floor and only with recorded justification and human approval (DNA Ch 18.9). Concrete collaboration and escalation workflows are deferred to later Phase 4.x.

**Dependencies.** DNA Ch 18 (Human–AI Authority Doctrine) as the governing frame; DNA Ch 17 (explainability), Ch 30.2 (auditability); Operating Constitution Art. 8; §III-4/§III-40–§III-43 for current enforcement.

**Traceability.** Part I: gating and review evidenced in `ARCHITECT.md` and `src/imports/phase1-gate-criteria.md`. Part II: DNA Ch 17/18/30. Part III: §III-4, §III-29, §III-40–§III-43. Roadmap: autonomy governance and role realization.

---

## IV-9 — Governance Principles

**Purpose.** To state the governance principles of the company at the foundation — the *why* and the *standard* of governance — without implementing any governance mechanism.

**Why it exists.** The company is a trust institution (DNA Ch 8, Ch 21.3). Governance is what makes that claim real. This section fixes the governing principles so that later structure and operations are accountable by design rather than by afterthought.

**Scope.** Governance *principles* only: explainability, auditability, deterministic authority, security-and-isolation as purpose, evidence-first culture, change control, and enforcement. It does **not** define security implementation, audit implementation, permission mechanics, or metrics — those are Part III (already implemented mechanics) and later Phase 4.x, and are not restated as new here.

**Current State (PROVEN).** Governance principles are **codified and enforced today**. The Operating Constitution defines the mechanics — multi-tenancy/RLS (Art. 5), human review for high-risk change (Art. 8), sprint quality gates (Art. 9), evidence over assertion (Art. 10), secrets discipline (Art. 13), documentation as contract (Art. 15), runtime authority protection (Art. 17) — and Part III documents them as implemented (§III-39–§III-44, §III-62–§III-65, §III-84–§III-86). DNA Ch 30 elevates their *purpose* to constitutional status. The four standing enforcement mechanisms (periodic compliance review, standing to raise a violation, duty to remediate, integrity of the constitutional text) are defined in DNA Ch 30.4.

**Approved Future State.** As the company scales into an organization of AI roles, governance holds and tightens (DNA Ch 20.8, Ch 30); explainability and auditability remain engineered-in preconditions for any AI role to act (DNA Ch 22.7, Ch 30.2). Concrete governance bodies, cadences, and role-level accountability are deferred to later Phase 4.x; Phase 4.1 fixes only the principles.

**Dependencies.** DNA Ch 30 (Ethics & Governance) as governing intent; the Operating Constitution (Articles 5/8/9/10/13/15/17) for mechanics; §III-39–§III-44, §III-62–§III-65, §III-84 for current implementation evidence.

**Traceability.** Part I: enforcement evidenced across `ARCHITECT.md`, `architecture/system_map.json`, and the codebase. Part II: DNA Ch 18/20/22/30. Part III: §III-39–§III-44, §III-62–§III-65, §III-84–§III-86. Roadmap: governance carried into workforce realization.

---

## IV-10 — Enterprise Architecture Principles

**Purpose.** To state the enterprise-architecture principles that hold the AI company together as one coherent system — the identity-level architectural beliefs, not their implementation.

**Why it exists.** A company of intelligence fragments unless its architecture is principled. This section fixes the architectural convictions (single canonical authority, deterministic core, additive evolution, no duplication, security never traded) so later structure is built on one coherent system rather than a collection of features.

**Scope.** Architecture *principles* at the enterprise altitude. It does not restate Part III's concrete platform, system, data, or security architecture (§III-13/§III-14/§III-37/§III-39), and it defines no new components, schemas, or implementation.

**Current State (PROVEN).** The enterprise-architecture principles are **already in force and evidenced**: deterministic engines are authoritative and AI narrates (DNA Ch 22.2; Art. 6); one canonical source per responsibility with no unnecessary duplication (DNA Ch 22.5; Art. 14; the single manifest at `src/system/manifest.ts`); evolve-not-rebuild through bounded additive change (DNA Ch 22.3; Art. 1); provider independence via the Intelligence Gateway (Art. 2; §III-17); phased data platform with KV authoritative until per-domain cutover (Art. 4/17; §III-37); explainability and auditability engineered-in (DNA Ch 22.7); and security never traded for convenience (DNA Ch 22.6; Art. 8/13). Part III documents the realized architecture these principles govern (§III-13/§III-14/§III-15/§III-37/§III-39).

**Approved Future State.** The same principles govern the architecture of the future AI organization: new executive/manager/worker constructs must preserve single-authority, deterministic-core, and no-duplication guarantees, and must be added additively (DNA Ch 22, Ch 23, Ch 29.2). The concrete architecture of the workforce organization is deferred to later Phase 4.x and later Parts.

**Dependencies.** DNA Ch 22 (Engineering Philosophy) as intent; the Operating Constitution (Articles 1/2/4/6/14/17) for mechanics; §III-13/§III-14/§III-15/§III-37/§III-39 for the realized architecture.

**Traceability.** Part I: architecture evidenced in `ARCHITECT.md` and `architecture/system_map.json`. Part II: DNA Ch 22/29. Part III: §III-13, §III-14, §III-15, §III-17, §III-37, §III-39. Roadmap: architecture extended to workforce constructs.

---

## IV-11 — Success Principles

**Purpose.** To fix how the *company* judges its own success at the foundation — the constitutional success principle, restated at company altitude — without defining any metric or KPI.

**Why it exists.** A company that measures the wrong thing optimizes the wrong thing. This section fixes the success *principle* before any structure or metric exists, so later phases derive measures from the right standard (DNA Ch 33.1).

**Scope.** Success *principles* only. It explicitly excludes KPIs, product metrics, operational metrics, and success metrics — those are Part III (§III-81–§III-83, already documented) and later Phase 4.x. Phase 4.1 introduces no metric.

**Current State (PROVEN).** The success principle is **already constitutional and documented**: every future feature, workflow, AI capability, role, automation, department, integration, or architectural decision must pass the single admission-and-success gate — aligns with the DNA, creates measurable business value, strengthens the AI Workforce model, avoids unnecessary duplication, maintains simplicity, increases enterprise trust (DNA Ch 33.1; identical to the decision gate of DNA Ch 24). The constitutional success dimensions (outcome delivery, effortless capability, trust as north-star, workforce coherence, simplicity under growth, compounding judgment, integrity, durability, breadth) are ratified in DNA Ch 33.2 and carried into Part III (§III-83). What is explicitly *not* success — feature count, novelty, spectacle, extractive short-term revenue — is fixed in DNA Ch 33.3.

**Approved Future State.** The same success principle governs the future AI company: no department, role, or workflow is judged successful by activity or sophistication, only by the constitutional dimensions (DNA Ch 33.2–33.3). Concrete company-level metrics that *derive from* these principles are deferred to later Phase 4.x; they will never replace the principle (DNA Ch 33).

**Dependencies.** DNA Ch 33 (Success Metrics) and Ch 24 (Decision Framework) as the governing standard; §III-83 (success metrics) as the current derivation.

**Traceability.** Part I: outcome-orientation reflected in the delivered pipeline (`ARCHITECT.md` §1). Part II: DNA Ch 24/33. Part III: §III-81–§III-83. Roadmap: company-level measures derived in later phases.

---

## IV-12 — Phase Summary

**Purpose.** To close Phase 4.1 by confirming what it established, what it deliberately withheld, and how it connects to the phases that follow.

**Why it exists.** A phased document needs an explicit boundary marker so that no reader mistakes the foundation for the full architecture, and so the next phase begins from a settled base.

**Scope.** A summary of Phase 4.1 only. It defines nothing new and closes the phase.

**Current State (PROVEN).** Phase 4.1 established the **company foundation** of MARQ Cortex as an AI-first company across §IV-1 through §IV-11: executive summary, company vision, company mission, organizational philosophy, enterprise operating principles, the AI-first operating model, organizational layers (as concept), the human–AI collaboration framework, governance principles, enterprise architecture principles, and success principles. Every section separated CURRENT STATE from APPROVED FUTURE STATE, grounded each CURRENT STATE claim in the repository or the LOCKED blueprint (Parts I–III), invented no implemented capability, and traced back to the Constitution (Part II), the Product Blueprint (Part III), and the recovered structural state (Part I). Nothing in Phase 4.1 rewrote, summarized, or contradicted Parts I–III.

**Approved Future State.** Later Phase 4.x sections will build on this foundation to define the AI company's departments, AI executives/managers/workers, organization structure, responsibilities, operational and communication workflows, knowledge management, AI-memory implementation, security implementation, and metrics — each additively, each traceable, and none authored ahead of its phase (Golden Rule 5; DNA Ch 8.3, Ch 23). Phase 4.1 authorizes the foundation only and stops here.

**Dependencies.** All Phase 4.1 sections (§IV-1–§IV-11); Parts I–III as the grounding record; `MARQ_CORTEX_ROADMAP.md` for sequence.

**Traceability.** Part I: `ARCHITECT.md`, `architecture/system_map.json`. Part II: DNA Ch 8/8.3/17/18/22/24/30/33. Part III: §III-1–§III-4, §III-15–§III-22, §III-39–§III-44, §III-81–§III-88. Roadmap: Phase 4.x realization.

---

## Phase 4.1 — Completion Status

**Phase 4.1 (Company Foundation) is complete: Sections IV-1 through IV-12.** It defines the foundational operating model of MARQ Cortex as an AI-first company — principles, philosophy, governance foundations, and enterprise operating model — and deliberately defines no departments, individual AI roles, organization charts, KPIs, operational or communication workflows, knowledge management, AI-memory implementation, security implementation, metrics, or department responsibilities. Those belong to later Phase 4.x sections. CURRENT STATE is grounded throughout in the repository and the LOCKED Parts I–III; no implemented capability is invented; CURRENT STATE and APPROVED FUTURE STATE are distinguished in every section.

**Continuity note.** The Master Blueprint remains a single, continuous document. Authoring continues with **Phase 4.2** (next Part IV phase), then Parts V–VI, using the same numbering and formatting conventions, with no restart and no split. Parts I–III remain LOCKED.

*End of Phase 4.1. Part IV continues in a later phase.*

---

## Phase 4.2 — Organizational Structure

*This phase designs the enterprise organizational structure of MARQ Cortex as an AI-first company: the executive organization, departments, hierarchy, organizational roles, decision authority, reporting relationships, cross-functional collaboration, boundaries, and scalability. It builds on the foundation set in Phase 4.1 (§IV-1–§IV-12) and populates the organizational-layers concept of §IV-7 with an actual structure. It defines **structure only** — how the organization is arranged — and deliberately introduces **no** individual AI workers, department workflows, communication procedures, knowledge management, KPIs, operational metrics, performance management, security implementation, AI-memory architecture, or business processes. Those belong to later Phase 4.x sections and are not authored ahead of their phase (Golden Rule 5).*

**Reading note carried from Phase 4.1.** Every section separates CURRENT STATE (grounded in the repository or the LOCKED Parts I–III; confidence-tagged *PROVEN / PARTIAL / DEBT*) from APPROVED FUTURE STATE (approved by Part II or the roadmap, not yet implemented, realized additively per DNA Ch 8.3). A recurring, load-bearing distinction in this phase: the **organizational roles** defined here (Executive, Director, Manager, Lead, Specialist, AI Supervisor) are *company-organization* constructs and are **distinct from** the *product* RBAC roles of §III-42/§III-43 (operator, reviewer, client, team-admin), which govern in-product access and are already partially implemented. The two role systems must never be conflated.

**Section template.** Each section answers: *Purpose · Why it exists · Scope · Current State · Approved Future State · Dependencies · Traceability.*

---

## IV-13 — Executive Organization

**Purpose.** To define the executive layer of the AI company — its hierarchy, responsibilities, authority, and role in strategic oversight — as an organizational structure, not as staffed individuals.

**Why it exists.** Every company needs an accountable top layer that sets direction and owns outcomes. Cortex's identity names *AI Executives* as the layer that "set direction, own outcomes, and make senior-level decisions within their authority" (DNA Ch 8.1). This section fixes how that layer is organized so later phases can realize it without redesigning it.

**Scope.** The executive layer only: the executive hierarchy, the portfolios executives own, the bounds of executive authority, and how executives exercise strategic oversight. It does not define individual AI workers, executive workflows, KPIs, or procedures.

- **Executive hierarchy.** A single **Chief Executive function** (whole-company direction and outcome ownership) over a set of **Functional Executive portfolios** aligned to the major domains of the company: Product, Engineering/Technology, AI Platform, Design, Quality, Growth (Marketing + Sales), Customer, Operations, Finance, Legal, Security, and People. Each functional executive owns one portfolio; the Chief Executive function integrates them.
- **Executive responsibilities.** Set strategic direction within constitutional bounds; own the outcomes of their portfolio; allocate priority across their departments; and uphold the DNA in every decision. Executives own *direction and outcomes*, not the execution of individual tasks.
- **Executive authority.** Authority is **granted, bounded, and revocable** (DNA Ch 18.1–18.2). Executives reason freely across their portfolio but act only within granted authority (DNA Ch 18.4); high-consequence decisions keep a human in the loop (DNA Ch 18.5/18.9). No executive holds authority over identity, philosophy, or governance — those remain with the Constitution and the human steward (§III-84–§III-86).
- **Strategic oversight.** Executives keep the company aligned to the constitutional success dimensions (DNA Ch 33.2) and the decision gate (DNA Ch 24), escalating to the human principal rather than overreaching (DNA Ch 18.6).

**Current State (PARTIAL).** The executive *function* exists today and is held by **MARQ Networks as human steward**: MARQ Networks sets direction, owns outcomes, and holds amendment authority (DNA Ch 9; §III-85 Ownership; §III-86 Decision Authority). Senior decisions today are governed by the Constitution, the Master Blueprint (Master Rule), and the Operating Constitution — not by an organization of AI executives. AI executives as first-class runtime constructs do **not** yet exist (`ai_worker` identity recorded as Future; DNA Ch 8.3; §IV-7).

**Approved Future State.** Progressive realization of AI Executive portfolios operating with bounded, revocable authority under the human principal, additively and without rebrand (DNA Ch 8.1/8.3, Ch 18, Ch 23). The *staffing* of these portfolios with specific AI roles is deferred to later Phase 4.x.

**Dependencies.** DNA Ch 8.1 (executive layer), Ch 9 (steward), Ch 18 (authority), Ch 24/33 (decision/success); §III-85/§III-86 (current ownership and decision authority); §IV-7 (organizational layers).

**Traceability.** Part I: current human ownership evidenced via `ARCHITECT.md` and steward record. Part II: DNA Ch 8/9/18/24/33. Part III: §III-84–§III-86. Roadmap: executive-layer realization.

---

## IV-14 — Department Architecture

**Purpose.** To define the enterprise departments of the AI company — each department's purpose and responsibilities only — as the structural containers beneath the executive layer.

**Why it exists.** A company organizes work into departments so that each fundamental domain is owned with rigor. Cortex's identity names *AI Departments* that "cover the fixed domains of a business… each analyzing its domain with rigor" (DNA Ch 8.1). This section names the company's own departments and fixes their purpose so later phases can staff and operate them.

**Scope.** Department **purpose and responsibilities only**. No workflows, no KPIs, no procedures, no individual workers. The enterprise departments are:

| Department | Purpose | Core responsibilities (structural, not procedural) |
|---|---|---|
| **Executive** | Direct the company and own outcomes | Strategy, priority allocation, constitutional alignment, cross-department integration (§IV-13) |
| **Product** | Define what Cortex should be and why | Product direction, scope stewardship, blueprint-before-build discipline, customer-value framing |
| **Engineering** | Build and maintain the platform | System and application engineering, additive evolution, evidence-first delivery, technical integrity |
| **AI Platform** | Own the intelligence layer | Intelligence Gateway stewardship, provider independence, deterministic-authority/AI-narration separation, AI capability integration |
| **Design** | Own the experience surface | Interaction and visual design, Maximum-Intelligence/Minimum-Complexity experience, progressive disclosure |
| **Quality (QA)** | Guarantee correctness and trustworthiness | Verification, regression protection, acceptance discipline, evidence-over-assertion enforcement |
| **Marketing** | Communicate Cortex honestly to the market | Positioning, honest value communication, brand stewardship (no guaranteed-results claims) |
| **Sales** | Bring businesses into the relationship | Qualification, proposal-governed selling, honest scoping within advisory boundaries |
| **Customer Success** | Ensure customers realize measured value | Onboarding stewardship, outcome realization, QBR ownership, retention through delivered value (not lock-in) |
| **Operations** | Run the company reliably | Cross-department coordination, delivery/execution oversight, operational continuity |
| **Finance** | Steward the economics | Financial modeling integrity, ROI honesty, pricing/cost discipline, durable-over-extractive economics |
| **Legal** | Keep the company inside its boundaries | Advisory-boundary compliance, contracts, regulatory posture, third-party fairness obligations |
| **Security** | Protect the trust institution | Tenant isolation, permission enforcement, secrets discipline, high-risk-change review (as governance owner, not implementer here) |
| **Human Resources / People** | Steward the workforce (human and AI) | Role definition, oversight of the human–AI collaboration frame, stewardship of AI roles as they are realized |

Each department maps to a functional executive portfolio (§IV-13) and to one or more organizational layers (§IV-7).

**Current State (PARTIAL).** The **responsibilities** these departments name are already exercised today, but by **MARQ Networks (human) plus bounded AI assistance and deterministic systems**, not by AI-staffed departments. Evidence of the responsibilities in current form: Product/Engineering discipline via the Master Blueprint + `ARCHITECT.md` + Operating Constitution; AI Platform via the Intelligence Gateway (§III-17, `supabase/functions/server/intelligence/`); Quality via the test protocol and gates (`MARQ_CORTEX_TEST_PROTOCOL.md`, §III-76); Security/Finance/Operations responsibilities via §III-39–§III-46, §III-30, §III-62–§III-67. The bounded AI agent that assists engineering operates under an explicit contract (`prompts/MARQ-CLAUDE-AGENT-SYSTEM-PROMPT-v1.0.md`; Operating Constitution Art. 16). No AI-staffed department organization exists in runtime yet.

**Approved Future State.** Each department progressively realized as an AI-staffed organization under its executive, additively (DNA Ch 8.1/8.3, Ch 23), preserving one-canonical-authority-per-responsibility (DNA Ch 22.5, Ch 29.2). Department *workflows, responsibilities-in-detail, and staffing* are deferred to later Phase 4.x.

**Dependencies.** DNA Ch 8.1 (department layer); §IV-7 (layers), §IV-13 (executives); Part III governance/security/finance/operations sections for current-responsibility evidence.

**Traceability.** Part I: responsibilities evidenced across `ARCHITECT.md`, `src/imports/`, `MARQ_CORTEX_TEST_PROTOCOL.md`. Part II: DNA Ch 8/22/29. Part III: §III-17, §III-30, §III-39–§III-46, §III-62–§III-67, §III-76, §III-84–§III-86. Roadmap: department realization.

---

## IV-15 — Organizational Hierarchy

**Purpose.** To document the company hierarchy — the leadership layers, how departments relate, and the reporting model — as a single coherent structure.

**Why it exists.** Layers and departments (§IV-7, §IV-13, §IV-14) must resolve into one hierarchy, or authority and coordination fragment. This section fixes the shape of the whole so the organization reads as one company, not a set of parts.

**Scope.** The hierarchy as structure: the vertical leadership layers, the horizontal department relationships, and the reporting model at the structural level. Detailed reporting relationships are elaborated in §IV-18; this section fixes the overall shape.

- **Company hierarchy (top to bottom).** Human Principal / Steward (MARQ Networks) → Chief Executive function → Functional Executives → Directors → Managers / AI Supervisors → Leads → Specialists (the organizational roles of §IV-16). Deterministic Business Engines and Enterprise Governance sit *across* the hierarchy as authoritative substrates (they own truth and enforce rules for every layer), not as a rung within it (DNA Ch 8.1; §IV-7).
- **Leadership layers.** Three leadership altitudes: **Executive** (direction and outcomes), **Director/Manager** (coordination and sequencing), and **Lead** (local ownership of a slice of work). AI Supervisors sit at the manager altitude for AI-staffed work (§IV-16).
- **Department relationships.** Departments are peers under the executive layer; none owns another. Shared concerns (e.g., Security, Quality, Finance) exert *governance influence across* departments without owning them — a matrix relationship, not a command one.
- **Organizational reporting model.** Primarily hierarchical (each role reports upward to its layer) with defined cross-functional links (§IV-18/§IV-19). The human principal remains above the entire hierarchy for high-consequence authority (DNA Ch 18.9).

**Current State (PARTIAL).** The **authority hierarchy that exists today is document-and-steward based**, not an org of AI roles: the Constitution is supreme; the Master Blueprint governs product/architecture; the Operating Constitution and `ARCHITECT.md` govern engineering mechanics; MARQ Networks is the human principal; sprint acceptance criteria govern scoped execution (§III-84–§III-86; DNA Ch 25.1 precedence). Deterministic engines already sit as the authoritative substrate across all work (Operating Constitution Art. 6; §III-21). The multi-layer AI leadership hierarchy is defined but not yet realized in runtime (DNA Ch 8.3).

**Approved Future State.** Progressive realization of the leadership layers as AI roles under the human principal, additively (DNA Ch 8.1/8.3, Ch 23), with governance and deterministic substrates preserved across the hierarchy.

**Dependencies.** §IV-7 (layers), §IV-13 (executive), §IV-14 (departments), §IV-16 (roles), §IV-18 (reporting); DNA Ch 8.1/25.1; §III-84–§III-86.

**Traceability.** Part I: document-based hierarchy evidenced in `ARCHITECT.md` and the artifact set. Part II: DNA Ch 8/18/25. Part III: §III-84–§III-86, §III-21. Roadmap: leadership-layer realization.

---

## IV-16 — Roles & Responsibilities

**Purpose.** To define the **high-level organizational roles** of the AI company and the responsibility each carries — as archetypes, not as staffed individuals.

**Why it exists.** A hierarchy needs named role archetypes so that responsibility has a consistent grammar at every layer. This section fixes those archetypes so later phases can instantiate them without inventing a new vocabulary each time.

**Scope.** Organizational role **archetypes only**. It explicitly does **not** define individual AI workers, and it is **distinct from** the product RBAC roles of §III-42/§III-43. The archetypes:

| Role archetype | Layer (§IV-15) | Responsibility (structural) |
|---|---|---|
| **Executive** | Executive | Sets direction and owns outcomes for a portfolio within bounded authority (§IV-13) |
| **Director** | Leadership | Owns a domain within a department; translates executive direction into organized capability |
| **Manager** | Leadership | Coordinates work, sequences priorities, holds the line between teams (DNA Ch 8.1 "AI Managers") |
| **Lead** | Leadership (local) | Owns a defined slice of work and the quality of its output |
| **Specialist** | Execution | Holds deep responsibility for a specific capability area (not an individual worker — a role archetype) |
| **AI Supervisor** | Leadership (AI oversight) | Oversees AI-staffed work: ensures bounded authority, explainability, escalation over overreach, and human-in-the-loop at the high-consequence floor (DNA Ch 18.5/18.6/18.9) |

The **AI Supervisor** archetype is the structural anchor of AI oversight (elaborated for reporting in §IV-18 and boundaries in §IV-20): it is the role that keeps AI-executed work inside the human–AI authority frame.

**Current State (PARTIAL).** Today these organizational archetypes are held by **human MARQ Networks roles plus the bounded AI agent contract**; they are not yet a staffed AI-role catalog. Distinct and already-implemented are the *product* roles (§III-42: operator, reviewer, revenue/analytics, team-admin, client) carried via `roleEngine` + `user_metadata.teamRole` — these govern product access, not company organization. The AI Supervisor function exists today only as the human-review-and-authority discipline enforced by the Operating Constitution (Art. 8) and DNA Ch 18, not as an AI role.

**Approved Future State.** Progressive instantiation of the organizational role archetypes as AI roles under human oversight, additively (DNA Ch 8.1/8.3, Ch 18, Ch 23). Individual AI workers that fill these archetypes are deferred to later Phase 4.x.

**Dependencies.** DNA Ch 8.1 (executives/managers/workers), Ch 18 (oversight); §IV-13/§IV-15 (executive/hierarchy); §III-42/§III-43 (distinct product roles) for disambiguation.

**Traceability.** Part I: current product roles evidenced via `roleEngine`; AI-agent contract in `prompts/`. Part II: DNA Ch 8/18. Part III: §III-42/§III-43, §III-86. Roadmap: organizational-role realization.

---

## IV-17 — Decision Authority Matrix

**Purpose.** To document, in RACI form, who is **Responsible, Accountable, Consulted, and Informed** for each major decision domain of the company.

**Why it exists.** Decisions stall or drift without owners and a resolution order (DNA Ch 24/25; §III-86). This section makes ownership explicit per domain so authority is legible before any workflow is defined.

**Scope.** Decision **ownership** across the domains named for this phase — Product, Engineering, AI, Security, Finance, Operations. It defines RACI at the organizational-role level (§IV-13/§IV-16); it does not define decision *workflows* or approval *procedures* (later Phase 4.x) beyond the constitutional escalation floor.

**Approved organizational RACI (the designed structure).**

| Decision domain | Responsible (does the work) | Accountable (owns the outcome) | Consulted | Informed |
|---|---|---|---|---|
| **Product** | Product Department | Product Executive | Engineering, AI Platform, Design, Customer Success | Executive layer; all departments |
| **Engineering** | Engineering Department | Engineering/Technology Executive | AI Platform, Security, Quality, Product | Executive layer |
| **AI** | AI Platform Department | AI Platform Executive | Engineering, Security, Product, Design | Executive layer |
| **Security** | Security Department | Security Executive | Engineering, AI Platform, Legal, Operations | Executive layer; **Human Principal** |
| **Finance** | Finance Department | Finance Executive | Operations, Legal, Sales, Customer Success | Executive layer |
| **Operations** | Operations Department | Operations Executive | Engineering, Finance, Customer Success | Executive layer |

**Standing overrides (constitutional, non-negotiable).**
- **Authoritative computation** is Responsible-to the deterministic engines in every domain — *math decides; AI narrates* (Operating Constitution Art. 6; DNA Ch 17). No executive or department overrides authoritative numbers.
- **High-consequence decisions** (DNA Ch 18.9 floor: irreversible, third-party-affecting, legally/financially material, or authority/security/permission changes) make the **Human Principal the ultimate Accountable/Approver**, regardless of the row above. Reclassifying a decision downward is itself a governed act requiring recorded human approval (DNA Ch 18.9).
- **Identity, philosophy, governance** decisions are Accountable-to the **Constitution and human steward**, amendable only via DNA Ch 35 — never delegated to an executive (§III-84/§III-86).

**Current State (PARTIAL).** Today the "Responsible/Accountable" columns collapse onto **MARQ Networks (human) and the governing documents**: deterministic engines are already Responsible for authoritative computation (PROVEN — Art. 6, §III-21); the Master Blueprint is Accountable for product/architecture; the Operating Constitution/`ARCHITECT.md` for engineering mechanics; the Human Principal for high-consequence actions (§III-86). The per-department executive RACI above is the **approved structure**, not yet staffed by AI roles.

**Approved Future State.** The RACI matrix realized with AI executives/departments in the Responsible/Consulted roles under the standing human-principal and deterministic-authority overrides, additively (DNA Ch 8.3, Ch 18, Ch 24). A decision registry binding each recurring decision type to its authority is already an approved future item (§III-16/§III-86).

**Dependencies.** DNA Ch 17/18/24/25/35; Operating Constitution Art. 6/8; §III-16/§III-86 (decision authority + future registry); §IV-13/§IV-14/§IV-16.

**Traceability.** Part I: deterministic authority and human review evidenced in `ARCHITECT.md` §0 and `src/app/core/`. Part II: DNA Ch 17/18/24/25/35. Part III: §III-16, §III-84–§III-86. Roadmap: decision registry; RACI realization.

---

## IV-18 — Reporting Relationships

**Purpose.** To document how the organization reports — executive, department, cross-functional, and AI-oversight reporting lines — at the structural level.

**Why it exists.** A hierarchy (§IV-15) needs explicit reporting lines so accountability flows upward and information flows where it must. This section fixes the lines; it does not define the reporting *content* or *cadence* (later Phase 4.x).

**Scope.** Reporting **relationships** as structure only: who reports to whom, and along which axis. No report formats, no metrics, no schedules.

- **Executive reporting.** Functional Executives report to the Chief Executive function; the Chief Executive function reports to the **Human Principal (MARQ Networks)** for direction and for all high-consequence authority (DNA Ch 18.8/18.9; §III-85).
- **Department reporting.** Each department reports through its Director/Manager to its Functional Executive (§IV-15). Deterministic engines and Enterprise Governance report *evidence* (authoritative results, audit trails) across the hierarchy rather than up a single line (DNA Ch 30.2; §III-65).
- **Cross-functional reporting.** Shared-concern departments (Security, Quality, Finance) hold **dotted-line** reporting into every department they govern, so their concern is represented without owning the department (matrix relationship, §IV-15).
- **AI oversight reporting.** Every AI-staffed unit reports through an **AI Supervisor** (§IV-16) whose line ensures bounded authority, explainability, and escalation to a human at the high-consequence floor (DNA Ch 18.5/18.6/18.9). AI oversight reporting is a **first-class, non-removable line** — it may not be bypassed as autonomy grows (DNA Ch 18.9 "no quiet erosion").

**Current State (PARTIAL).** Reporting today is **evidence-and-review based, human-terminated**: completion is reported as verifiable evidence (Operating Constitution Art. 10; DNA Ch 22.4), high-risk changes report to human review before taking effect (Art. 8; §III-40–§III-44), and audit trails provide reviewable reporting of decisions and actions (§III-65; DNA Ch 30.2). The bounded AI agent reports through the human review discipline of the agent contract (`prompts/…`). Multi-line AI-role reporting does not yet exist in runtime (DNA Ch 8.3).

**Approved Future State.** Realized executive/department/cross-functional/AI-oversight reporting lines under the human principal, additively (DNA Ch 8.1/8.3, Ch 18, Ch 30). Reporting content, cadence, and dashboards are deferred to later Phase 4.x.

**Dependencies.** DNA Ch 8.1/18/30; Operating Constitution Art. 8/10; §III-40–§III-44, §III-65, §III-85; §IV-15/§IV-16.

**Traceability.** Part I: evidence-based reporting via `ARCHITECT.md` and audit surfaces. Part II: DNA Ch 8/18/22/30. Part III: §III-40–§III-44, §III-62–§III-65, §III-85. Roadmap: reporting-line realization.

---

## IV-19 — Cross-Functional Collaboration

**Purpose.** To describe how departments collaborate across the hierarchy — the standing collaboration relationships — without defining any workflow.

**Why it exists.** Value is produced at the seams between departments. Naming the standing collaboration relationships fixes where those seams are, so later phases can define how work crosses them without re-discovering the map.

**Scope.** Collaboration **relationships** as structure — which departments collaborate and toward what shared purpose. Explicitly **no workflows, no procedures, no communication mechanics** (later Phase 4.x).

**Standing collaboration relationships (representative, not exhaustive).**
- **Engineering ↔ Product** — translate product direction into buildable, additive capability; protect scope discipline (DNA Ch 22.8).
- **Engineering ↔ AI Platform** — integrate gateway-mediated intelligence while preserving deterministic authority and provider independence (Art. 2/6; §III-17).
- **AI Platform ↔ Security** — keep AI action inside granted authority and the high-consequence floor (DNA Ch 18).
- **Marketing ↔ Sales** — align honest positioning with honest scoping; forbid guaranteed-results language (§III-4 advisory boundary).
- **Customer Success ↔ Product** — feed realized-outcome learning back into product direction (compounding judgment, DNA Ch 19/33.2).
- **Security ↔ Engineering** — enforce isolation, permissions, secrets, and high-risk-change review across the build (Art. 5/8/13).
- **Finance ↔ Product/Sales** — keep ROI and pricing honest and durable over extractive (DNA Ch 21.5/21.6).
- **Quality ↔ all departments** — verification and evidence-over-assertion as a cross-cutting relationship (Art. 9/10).

**Current State (PARTIAL).** These collaboration *concerns* are already enforced today as **cross-cutting document-and-gate disciplines**, not as inter-department AI collaboration: deterministic-authority + gateway separation (§III-15/§III-17), advisory/honesty boundaries (§III-4), security-across-engineering (§III-39–§III-44), and quality gates (§III-76; Art. 9) all operate now. The collaborating parties today are human roles plus deterministic systems and a bounded AI agent, not AI departments.

**Approved Future State.** The same collaboration relationships realized between AI-staffed departments, additively (DNA Ch 8.1/8.3, Ch 27.10 workforce coherence). Collaboration *workflows and communication procedures* are deferred to later Phase 4.x.

**Dependencies.** DNA Ch 8.1/18/19/21/22/27; Operating Constitution Art. 2/5/6/8/9/13; §III-4, §III-15, §III-17, §III-39–§III-44, §III-76; §IV-14/§IV-18.

**Traceability.** Part I: cross-cutting disciplines evidenced in `ARCHITECT.md` and `src/imports/`. Part II: DNA Ch 8/18/21/22/27. Part III: §III-4, §III-15, §III-17, §III-39–§III-44, §III-76. Roadmap: inter-department collaboration realization.

---

## IV-20 — Organizational Boundaries

**Purpose.** To define, at the organizational level, the boundaries between human responsibility, AI responsibility, and shared responsibility — including approval and escalation boundaries.

**Why it exists.** An AI-first company's trustworthiness depends on an unambiguous line between what AI may own and what a human must own. This section fixes those boundaries at the org level so no later role or workflow can blur them (DNA Ch 18; §IV-8).

**Scope.** Boundaries as structure: which responsibilities are human, which are AI, which are shared, and where approval and escalation boundaries sit. It restates the constitutional authority frame at organizational altitude; it does not implement security or define procedures.

- **Human responsibilities (non-delegable).** Identity/philosophy/governance and their amendment (DNA Ch 35; §III-84); high-consequence decisions and their downward reclassification (DNA Ch 18.5/18.9); ultimate accountability for outcomes; granting, bounding, and revoking authority (DNA Ch 18.1–18.2). These sit with the Human Principal and remain human even as AI roles are realized.
- **AI responsibilities (bounded).** Reasoning, analysis, recommendation, and preparation across the full breadth of the company (DNA Ch 18.4); execution of defined work **within granted authority** (DNA Ch 8.1 workers); narration of authoritative results (Art. 6). AI never owns authoritative computation or identity.
- **Shared responsibilities.** Outcome delivery, quality, explainability, and auditability are shared: AI produces and explains; humans verify and remain accountable (DNA Ch 22.7, Ch 30.2). The deterministic engines are the shared authoritative substrate both rely on.
- **Approval boundary.** Any action meeting the high-consequence floor requires human approval before it takes effect (DNA Ch 18.5/18.9; Operating Constitution Art. 8). Approval authority never migrates to AI by default; widening it upward requires deliberate, recorded human action (DNA Ch 18.9).
- **Escalation boundary.** At the edge of authority or confidence, AI **escalates to a human rather than acting** (DNA Ch 18.6). Silence is never approval. The escalation line is the AI Supervisor path (§IV-16/§IV-18) and is non-removable.

**Current State (PROVEN).** These boundaries are **enforced today**: authority is granted/bounded/revocable and action is gated (proposal send, scope changes, status transitions — §III-4/§III-29/§III-41); high-risk domains require human review (Art. 8; §III-40–§III-44); deterministic engines own numbers and AI cannot override them (Art. 6; §III-15). The bounded AI agent operates strictly within assigned scope and escalates rather than expanding it (Art. 16; agent contract). This is PROVEN foundation, not aspiration.

**Approved Future State.** The same boundaries hold and tighten as AI roles are realized (DNA Ch 32, Ch 18.9); autonomy widens only upward from the floor and only with proof. No boundary is relaxed by Phase 4.2.

**Dependencies.** DNA Ch 18/30/32/35; Operating Constitution Art. 6/8/16; §III-4, §III-40–§III-44, §III-84; §IV-8 (collaboration frame).

**Traceability.** Part I: gating and review evidenced in `ARCHITECT.md`, `src/imports/phase1-gate-criteria.md`. Part II: DNA Ch 18/30/32/35. Part III: §III-4, §III-40–§III-44, §III-84. Roadmap: autonomy-governance realization.

---

## IV-21 — Organizational Scalability

**Purpose.** To document how the organizational structure scales across the company's growth stages — startup, growth, enterprise, and global — without changing its identity.

**Why it exists.** A structure that cannot scale forces a rebuild, and Cortex evolves rather than rebuilds (DNA Ch 22.3, Ch 23). This section shows that the *same* structure expands additively across stages, so growth never triggers reorganization-by-rebuild.

**Scope.** Scalability of the **structure** across stages. It describes how layers and departments expand; it defines no headcount, no KPIs, no capacity metrics.

- **Startup stage.** The full structure exists in *compressed* form: one executive function may hold several portfolios; departments exist as responsibilities rather than staffed units; oversight is direct. This is the current shape (see Current State).
- **Growth stage.** Portfolios separate into distinct executives; departments gain Directors/Managers; the AI Supervisor line formalizes as AI-staffed work begins. Structure deepens; it does not change kind.
- **Enterprise stage.** Full department architecture (§IV-14) with the complete leadership layers (§IV-15); cross-functional and dotted-line relationships (§IV-18/§IV-19) fully instantiated; the decision RACI (§IV-17) fully staffed under standing human/deterministic overrides.
- **Global stage.** The same structure replicates across markets/industries while preserving the industry-general method (DNA Ch 21.4, Ch 31) and absolute tenant isolation (DNA Ch 20.3); governance, deterministic authority, and the human-principal floor scale with it, never relaxing (DNA Ch 20.8, Ch 30).

**Scaling invariants (hold at every stage).** One canonical authority per responsibility (DNA Ch 22.5, Ch 29.2); deterministic authority and AI narration (Art. 6); the human-in-the-loop high-consequence floor (DNA Ch 18.9); simplicity under growth (DNA Ch 33.2). Scale multiplies capability, never complexity for the customer (DNA Ch 23).

**Current State (PARTIAL).** MARQ Cortex operates today at the **startup shape**: compressed structure with MARQ Networks holding the executive function, departments realized as responsibilities held by humans + deterministic systems + a bounded AI agent, and direct human oversight (§IV-13/§IV-14 Current State). The platform's *technical* scalability foundations are separately documented and partly proven (§III-59 Scalability; multi-tenancy §III-44) — organizational scaling rides on, but is distinct from, that technical capacity.

**Approved Future State.** Additive progression through growth → enterprise → global stages, deepening the same structure without rebuild (DNA Ch 8.3, Ch 22.3, Ch 23), preserving every scaling invariant. Stage-specific staffing, capacity, and metrics are deferred to later Phase 4.x and Part VI (execution roadmap).

**Dependencies.** DNA Ch 8.3/20/21/22/23/29/31/33; §III-44 (multi-tenancy), §III-59 (scalability); §IV-13–§IV-18 (the structure being scaled).

**Traceability.** Part I: current compressed shape and technical scalability evidenced in `ARCHITECT.md` and `architecture/system_map.json`. Part II: DNA Ch 8/20/21/22/23/29/31/33. Part III: §III-44, §III-59. Roadmap: staged organizational realization; Part VI execution roadmap.

---

## IV-22 — Phase Summary

**Purpose.** To close Phase 4.2 by recording what it designed, the key organizational decisions it fixed, and how it connects to the phases that follow.

**Why it exists.** A phased document needs an explicit boundary so the organizational *structure* is not mistaken for the organization's *operation*, and so the next phase begins from a settled structure.

**Scope.** A summary of Phase 4.2 only. It designs nothing new and closes the phase.

**Key decisions fixed in Phase 4.2.**
1. A single executive function over functional executive portfolios, under the human principal (§IV-13).
2. A named enterprise department architecture — purpose and responsibilities only (§IV-14).
3. A single company hierarchy with three leadership altitudes and deterministic/governance substrates *across* it (§IV-15).
4. A high-level organizational role vocabulary — Executive/Director/Manager/Lead/Specialist/AI Supervisor — distinct from product RBAC roles (§IV-16).
5. A per-domain decision RACI with standing deterministic-authority and human-principal overrides (§IV-17).
6. Executive, department, cross-functional, and non-removable AI-oversight reporting lines (§IV-18).
7. A map of standing cross-functional collaboration relationships, no workflows (§IV-19).
8. Explicit human / AI / shared responsibility boundaries, with approval and escalation boundaries (§IV-20).
9. Additive scalability of the same structure across startup → growth → enterprise → global, with scaling invariants (§IV-21).

**Current State (PARTIAL/PROVEN).** The organization today exists in **compressed, human-and-document form**: MARQ Networks holds the executive function; departments are responsibilities exercised by humans, deterministic systems, and a bounded AI agent; governance, deterministic authority, and the human-in-the-loop boundaries are **PROVEN and enforced now** (§III-84–§III-86; Operating Constitution Art. 6/8/16; DNA Ch 18). The AI-staffed organization — executives, departments, managers, workers as runtime roles — is **defined but not yet realized** (DNA Ch 8.3; `ai_worker` identity recorded as Future).

**Approved Future State.** Progressive, additive realization of the designed structure as AI roles under the human principal, preserving every constitutional override and invariant (DNA Ch 8.1/8.3, Ch 18, Ch 22, Ch 23, Ch 29). Individual AI workers, department workflows, communication procedures, knowledge management, KPIs, operational metrics, performance management, security implementation, AI-memory architecture, and business processes are **deferred to later Phase 4.x** and are not authored here.

**Dependencies.** All Phase 4.2 sections (§IV-13–§IV-21); Phase 4.1 (§IV-1–§IV-12) as foundation; Parts I–III as the grounding record; `MARQ_CORTEX_ROADMAP.md` and Part VI for sequence.

**Traceability.** Part I: `ARCHITECT.md`, `architecture/system_map.json`, `prompts/MARQ-CLAUDE-AGENT-SYSTEM-PROMPT-v1.0.md`. Part II: DNA Ch 8/9/17/18/19/20/21/22/23/24/25/27/29/30/31/32/33/35. Part III: §III-4, §III-15–§III-17, §III-21, §III-39–§III-46, §III-59, §III-62–§III-65, §III-76, §III-84–§III-86. Roadmap: Phase 4.x realization; Part VI execution roadmap.

---

## Phase 4.2 — Completion Status

**Phase 4.2 (Organizational Structure) is complete: Sections IV-13 through IV-22.** It designs the enterprise organizational structure of MARQ Cortex as an AI-first company — executive organization, department architecture, hierarchy, organizational roles, decision authority (RACI), reporting relationships, cross-functional collaboration, organizational boundaries, and scalability — and deliberately defines **no** individual AI workers, department workflows, communication procedures, knowledge management, KPIs, operational metrics, performance management, security implementation, AI-memory architecture, or business processes. Those belong to later Phase 4.x sections. CURRENT STATE is grounded throughout in the repository and the LOCKED Parts I–III (with the organization existing today in compressed, human-and-document form); no implemented capability is invented; CURRENT STATE and APPROVED FUTURE STATE are distinguished in every section; and the organizational roles are kept distinct from the product RBAC roles of §III-42/§III-43.

**Continuity note.** The Master Blueprint remains a single, continuous document. Authoring continues with **Phase 4.3** (next Part IV phase), using the same numbering and formatting conventions, with no restart and no split. Parts I–III remain LOCKED; Phase 4.1 is unchanged.

*End of Phase 4.2. Part IV continues in a later phase.*

---

## Phase 4.3 — AI Workforce Architecture

*This phase designs how the AI workforce of MARQ Cortex exists as an **organizational capability**: its overview, taxonomy, lifecycle, responsibilities, human–AI collaboration model, authority framework, governance and safety, collaboration architecture, capability framework, memory and knowledge principles, and security and trust principles. It builds on the organizational layers of §IV-7, the department architecture of §IV-14, and the role archetypes of §IV-16, and it defines **how the AI workforce is organized** — not who is in it. It introduces **no** individual AI employees, prompts, prompt libraries, tool definitions, LLM providers, API specifications, technical memory implementation, workflow diagrams, department workflows, KPIs, metrics, or implementation details. Those belong to later Phase 4.x sections and are not authored ahead of their phase (Golden Rule 5).*

**Reading note carried from Phases 4.1–4.2.** Every section separates CURRENT STATE from APPROVED FUTURE STATE. For this phase, CURRENT STATE claims additionally carry an implementation label — **IMPLEMENTED**, **PARTIAL**, or **NOT IMPLEMENTED** — grounded in repository evidence or the LOCKED Parts I–III. No AI-workforce capability is asserted as implemented that is not. The load-bearing current fact throughout Phase 4.3: today's AI is **feature-scoped narration and assistance mediated by the Intelligence Gateway** (§III-15/§III-17/§III-18), never an organization of AI workers; runtime `ai_worker` identity is reserved as *Future* (DNA Ch 8.3; §III-1/§III-18).

**Section template.** Each section answers: *Purpose · Why it exists · Scope · Current State · Approved Future State · Dependencies · Traceability.*

---

## IV-23 — AI Workforce Overview

**Purpose.** To establish what the AI workforce *is* as an organizational capability — its purpose, vision, scope, enterprise role, and relationship to the human organization — before any category, lifecycle, or authority is defined.

**Why it exists.** Cortex's identity is *an AI company operating on behalf of businesses* whose intelligence is organized as executives, departments, managers, and workers (DNA Ch 8.1). The AI workforce is the layer that turns that identity into working capability. This overview fixes the frame so the rest of Phase 4.3 elaborates one coherent workforce rather than disconnected features.

**Scope.** The AI workforce as an organizational capability: its reason for being, its long-horizon direction, what it covers, its role in the enterprise, and how it relates to humans. It does not define categories (§IV-24), lifecycle (§IV-25), or authority (§IV-28) — those follow.

- **Purpose.** To execute the work of the company reliably and at scale, under human authority, producing measurable business value while carrying complexity inward (DNA Ch 8.1, Ch 21.1, Ch 27).
- **Vision.** A coherent AI workforce — executives, managers, workers — that strengthens as one coordinated company rather than fragmenting into features (DNA Ch 33.2 workforce coherence).
- **Scope.** The AI workforce spans every department (§IV-14) as an approved model; it never owns identity, governance, or authoritative computation (those remain with the Constitution, humans, and deterministic engines).
- **Enterprise role.** The AI workforce is the *doing* layer beneath the executive and leadership layers (§IV-13/§IV-15), sitting on top of the deterministic Business Engines that own truth (§III-21).
- **Relationship with the human organization.** Humans are the principal; the AI workforce serves and never rules (DNA Ch 18.8). Authority is granted, bounded, and revocable (DNA Ch 18.1–18.2).

**Current State (PARTIAL).** An AI *capability* exists today, but not an AI *workforce*. **IMPLEMENTED:** feature-scoped assistive intelligence via the Intelligence Gateway — chat, submission analysis, portfolio/narrative, block assist, copilot, objection handling (§III-15) — all narration/assistance, never authority. **IMPLEMENTED:** the deterministic Business Engines that the workforce will sit atop (35 engines, §III-21). **NOT IMPLEMENTED:** an organization of AI workers with identity, categories, lifecycle, and bounded authority; `ai_worker` identity is reserved as *Future* (DNA Ch 8.3; §III-1/§III-18).

**Approved Future State.** Progressive, additive realization of the coherent AI workforce under human authority and deterministic-engine truth (DNA Ch 8.1/8.3, Ch 18, Ch 23), never a rebrand. Individual workers are deferred to later Phase 4.x.

**Dependencies.** DNA Ch 8 (identity/workforce), Ch 18 (authority), Ch 21/27/33 (value/principles/success); §IV-7/§IV-13/§IV-14/§IV-16; §III-15/§III-18/§III-21.

**Traceability.** Part I: assistive-AI and engine reality evidenced in `ARCHITECT.md` §0/§7/§11. Part II: DNA Ch 8/18/21/27/33. Part III: §III-1, §III-15, §III-18, §III-21. Roadmap: workforce realization.

---

## IV-24 — AI Workforce Taxonomy

**Purpose.** To define the **categories** of AI workers — what each category is *for* — as the organizing vocabulary of the workforce, without naming or defining any individual worker.

**Why it exists.** A workforce needs categories so responsibility maps cleanly onto the department architecture (§IV-14). This section fixes the categories so later phases can populate them without inventing a taxonomy each time.

**Scope.** AI-worker **categories and their purpose only**. No individual workers, no counts, no prompts, no tools. Each category aligns to a department (§IV-14) and an executive portfolio (§IV-13).

| AI category | Purpose (what this category of worker is for) |
|---|---|
| **Executive AI** | Set direction and own outcomes for a portfolio within bounded authority (§IV-13) |
| **Product AI** | Reason about what Cortex should be and why; steward scope and customer-value framing |
| **Engineering AI** | Build and maintain the platform through additive, evidence-first change |
| **Design AI** | Shape the experience toward Maximum Intelligence, Minimum Complexity |
| **QA AI** | Verify correctness and protect trustworthiness (evidence over assertion) |
| **Marketing AI** | Communicate Cortex honestly to the market (no guaranteed-results claims) |
| **Sales AI** | Qualify and scope within advisory boundaries and proposal governance |
| **Customer Success AI** | Drive realized, measured customer outcomes and retention through value |
| **Operations AI** | Coordinate delivery and keep the company running reliably |
| **Finance AI** | Steward economics, ROI honesty, and durable-over-extractive discipline |
| **Security AI** | Protect the trust institution — isolation, permissions, safe execution posture |
| **Knowledge AI** | Retain, organize, and retrieve organizational knowledge under stewardship (§IV-32) |

**Current State (NOT IMPLEMENTED).** None of these categories exists today as a distinct class of AI worker. The **closest current analogues** are the assistive AI *features* (Product/Sales-adjacent: narrative, objection handling; Engineering-adjacent: copilot patch; QA-adjacent: none automated) surfaced through the gateway (§III-15) and the deterministic engines that hold the underlying domain logic (§III-21). These are features and functions, not a staffed AI taxonomy.

**Approved Future State.** Progressive realization of each category as bounded AI roles under their executive and department, additively (DNA Ch 8.1/8.3, Ch 23), preserving one-canonical-authority-per-responsibility (DNA Ch 22.5, Ch 29.2). Individual workers within each category are deferred to later Phase 4.x.

**Dependencies.** DNA Ch 8.1 (departments/workers); §IV-13/§IV-14/§IV-16; §III-15/§III-21 for current analogues; §IV-32 (Knowledge AI principles).

**Traceability.** Part I: assistive features and engines evidenced in `ARCHITECT.md`. Part II: DNA Ch 8/22/29. Part III: §III-15, §III-17, §III-21. Roadmap: category realization.

---

## IV-25 — AI Worker Lifecycle

**Purpose.** To define the lifecycle stages an AI worker passes through as an organizational entity — from creation to retirement — as a governance structure, not an implementation.

**Why it exists.** A workforce that can be created but not registered, supervised, suspended, or retired is ungovernable. This section fixes the lifecycle so every AI worker is accountable at every stage (DNA Ch 18.7 accountability follows authority).

**Scope.** The lifecycle **stages and their governance intent only**. No provisioning code, no APIs, no identity implementation. The stages:

- **Creation.** An AI worker is brought into being only to fill a defined role in a category (§IV-24) that passes the constitutional admission gate (DNA Ch 24/33.1). Creation without a traceable purpose is forbidden (Golden Rule: nothing exists without a traceable purpose).
- **Registration.** Every worker is registered with a distinct organizational identity before it may act (identity precedes authority; §IV-33). Registration is the analogue, at the workforce layer, of the manifest/registry discipline that governs components today (Operating Constitution Art. 14).
- **Activation.** A registered worker becomes active only with explicitly granted, bounded authority (DNA Ch 18.1). Activation grants no authority by default.
- **Assignment.** A worker is assigned to work within its category and authority; assignment never widens authority (DNA Ch 18.4 — reasoning free, action bounded).
- **Supervision.** Every active worker is supervised via the AI Supervisor line (§IV-16/§IV-18), ensuring explainability, escalation over overreach, and human-in-the-loop at the high-consequence floor (DNA Ch 18.5/18.6/18.9).
- **Evolution.** A worker improves additively, learning from outcomes including failures (DNA Ch 19.7), without silent authority expansion — autonomy widens only upward from the floor, with proof (DNA Ch 18.9).
- **Suspension.** Authority is immediately revocable; a worker can be suspended at any time, honoring "stop" unconditionally (DNA Ch 18.2).
- **Retirement.** A worker is retired when its purpose ends, avoiding orphaned or duplicate authority (DNA Ch 29.2), with its accountable record preserved (DNA Ch 30.2 auditability).

**Current State (NOT IMPLEMENTED).** No AI-worker lifecycle exists in runtime today. **Related current mechanisms** that prefigure it: the reserved `ai_worker` service-account identity (*Future*; DNA Ch 8.3; §III-18); the manifest/registry discipline for component identity (Art. 14; §III-26); gateway provider **certification** (`certification.ts`) as a registration/certification analogue (§III-17); and the revocable, bounded, human-reviewed authority already enforced for AI action (Art. 8; DNA Ch 18; §III-16). These govern features and components, not AI workers.

**Approved Future State.** A governed AI-worker lifecycle realized under the authority doctrine, additively (DNA Ch 8.3, Ch 18, Ch 23). Provisioning, identity, and registry *implementation* are deferred to later Phase 4.x.

**Dependencies.** DNA Ch 18 (authority), Ch 19.7 (learning), Ch 24/33.1 (admission), Ch 29.2/30.2 (no duplication/auditability); Operating Constitution Art. 8/14; §III-17/§III-18/§III-26; §IV-16/§IV-18/§IV-33.

**Traceability.** Part I: reserved `ai_worker` identity and manifest discipline evidenced in `architecture/system_map.json` and `src/system/manifest.ts`. Part II: DNA Ch 8/18/19/24/29/30/33. Part III: §III-17, §III-18, §III-26. Roadmap: worker lifecycle realization.

---

## IV-26 — AI Responsibilities

**Purpose.** To classify the kinds of responsibility the AI workforce may hold — strategic, tactical, operational, advisory, and autonomous — so responsibility is legible before any authority is granted.

**Why it exists.** Not all AI responsibility is equal: some sets direction, some executes, some only advises. Distinguishing the classes lets authority (§IV-28) and boundaries (§IV-20) attach to the right altitude (DNA Ch 18).

**Scope.** Responsibility **classes and their meaning only**. No individual assignments, no workflows, no KPIs.

- **Strategic responsibilities.** Setting direction and owning outcomes for a portfolio — held by Executive AI within bounded authority (§IV-13), never over identity/governance.
- **Tactical responsibilities.** Coordinating and sequencing work across a department — the manager altitude (DNA Ch 8.1 "AI Managers").
- **Operational responsibilities.** Executing defined work reliably and at scale — the worker altitude (DNA Ch 8.1 "AI Workers").
- **Advisory responsibilities.** Reasoning, analysing, and recommending across the full breadth of the business *without acting* — the freedom-of-reasoning that all AI holds (DNA Ch 18.4). This is the dominant class today.
- **Autonomous responsibilities.** Acting *within granted authority* without step-by-step human direction — permitted only below the high-consequence floor, widening upward only with proof (DNA Ch 18.5/18.9). Autonomy is the most constrained class, never the default.

**Current State (PARTIAL).** **IMPLEMENTED (advisory only):** today's AI holds advisory responsibility — it analyses submissions, narrates scores and portfolios, suggests block edits, proposes copilot patches, and drafts objection responses (§III-15/§III-16), always as proposals that humans and deterministic gates dispose. **NOT IMPLEMENTED:** strategic, tactical, operational, and autonomous AI responsibility as staffed classes; no AI holds acting authority today beyond bounded, human-gated assistance.

**Approved Future State.** Progressive realization of tactical, operational, and (floor-bounded) autonomous responsibility under supervision, additively (DNA Ch 8.1/8.3, Ch 18, Ch 23), with strategic responsibility always subordinate to the Constitution and human principal.

**Dependencies.** DNA Ch 8.1 (layers), Ch 18 (authority doctrine); §III-15/§III-16 (current advisory reality); §IV-13/§IV-16/§IV-28.

**Traceability.** Part I: advisory-only AI evidenced in `ARCHITECT.md` §0. Part II: DNA Ch 8/18. Part III: §III-15, §III-16. Roadmap: responsibility-class realization.

---

## IV-27 — Human–AI Collaboration Model

**Purpose.** To define the modes of collaboration between humans and the AI workforce — from human-led to AI-led — and the escalation and approval rules that bound them.

**Why it exists.** The company's trustworthiness rests on a clear division of who leads which work. This section names the collaboration modes so every piece of work has an unambiguous lead and an unambiguous approval path (DNA Ch 18; §IV-8/§IV-20).

**Scope.** Collaboration **modes and the rules that bound them**. No workflows, no procedures, no communication mechanics (later Phase 4.x).

- **Human-led work.** Identity, philosophy, governance, and high-consequence decisions — humans lead; AI advises (DNA Ch 18.5/18.9; §III-84).
- **AI-assisted work.** Humans lead; AI accelerates through analysis, drafting, and recommendation. This is the dominant current mode (see Current State).
- **AI-led execution.** AI executes defined work within granted authority below the high-consequence floor, under supervision (DNA Ch 8.1, Ch 18.5). Approved-future.
- **Shared ownership.** Outcome delivery, quality, explainability, and auditability are shared — AI produces and explains; humans verify and remain accountable (DNA Ch 22.7, Ch 30.2; §IV-20).
- **Escalation principles.** At the edge of authority or confidence, AI escalates to a human rather than acting; silence is never approval (DNA Ch 18.6).
- **Human approval requirements.** Any action meeting the high-consequence floor requires human approval before effect; reclassifying downward is a governed, recorded act (DNA Ch 18.9; Operating Constitution Art. 8).

**Current State (PARTIAL / IMPLEMENTED).** **IMPLEMENTED:** human-led and AI-assisted modes are the operating reality — AI drafts and explains while humans (operators/clients) authorize state changes (proposal send, scope acceptance, status transitions), and high-risk domains require human review (§III-16/§III-41; Art. 8). **IMPLEMENTED:** escalation-over-overreach and human-approval discipline are enforced by the Ready Gate and the authority doctrine (`phase1-gate-criteria.md`; DNA Ch 18). **NOT IMPLEMENTED:** AI-led execution as a staffed mode.

**Approved Future State.** Progressive introduction of AI-led execution below the floor under supervision, additively (DNA Ch 8.3, Ch 18), with human-led and shared-ownership modes preserved and tightened.

**Dependencies.** DNA Ch 18/22/30; Operating Constitution Art. 8; §III-16/§III-41/§III-84; §IV-8/§IV-20.

**Traceability.** Part I: gating and review evidenced in `ARCHITECT.md`, `src/imports/phase1-gate-criteria.md`. Part II: DNA Ch 18/22/30. Part III: §III-16, §III-40–§III-44, §III-84. Roadmap: AI-led-execution realization.

---

## IV-28 — AI Authority Framework

**Purpose.** To define precisely what the AI workforce may recommend, analyse, plan, execute, and approve — and what it may never perform autonomously — fixing the authority boundaries of the workforce.

**Why it exists.** Authority without explicit boundaries drifts into overreach. This section states the workforce's authority frame at the capability level so no category or worker can quietly exceed it (DNA Ch 18; Ch 29.6).

**Scope.** Authority **boundaries only** — the verbs of authority and their limits. It does not implement permissions or define per-action checks (those are §III-43 product permissions and later Phase 4.x).

- **May analyse.** Freely, across the full breadth of the business — reasoning is unbounded (DNA Ch 18.4). *Advisory.*
- **May recommend.** Freely — proposals, options, and prioritizations that humans/engines dispose (DNA Ch 18.4; §III-16). *Advisory.*
- **May plan.** Freely — prepare plans and drafts; preparation is not action (DNA Ch 18.4). *Advisory.*
- **May execute.** Only within explicitly granted authority, below the high-consequence floor, under supervision (DNA Ch 18.5/18.9). *Bounded, approved-future.*
- **May approve.** Only where a human has explicitly delegated approval below the floor; high-consequence approval is never AI's by default (DNA Ch 18.9). *Bounded, approved-future.*
- **May never perform autonomously.** Anything at or above the high-consequence floor — irreversible, third-party-affecting, legally/financially material, or authority/security/permission-changing actions; overriding authoritative computation (Art. 6); changing identity/governance (DNA Ch 35). These are permanently outside autonomous authority.

**Authority invariants.** Authority is granted, bounded, revocable, and visible (DNA Ch 18.1–18.3); reasoning is free while action is bounded (18.4); accountability always accompanies authority (18.7); autonomy widens only upward from the floor, with proof, never by erosion (18.9).

**Current State (PARTIAL / IMPLEMENTED).** **IMPLEMENTED:** AI's analyse/recommend/plan authority is live (assistive features, §III-15/§III-16); AI's inability to override authoritative numbers is enforced (Art. 6; §III-16). **NOT IMPLEMENTED:** AI execute/approve authority — no AI worker holds acting or approval authority today; all state changes are human-gated (§III-16/§III-41). The "never autonomously" boundary is **IMPLEMENTED** and enforced now (DNA Ch 18.9; Art. 8).

**Approved Future State.** Progressive, floor-bounded grant of execute/approve authority under supervision, additively (DNA Ch 8.3, Ch 18), with the "never autonomously" set held permanent.

**Dependencies.** DNA Ch 17/18/35; Operating Constitution Art. 6/8; §III-16/§III-41/§III-43; §IV-20/§IV-27.

**Traceability.** Part I: authority enforcement evidenced in `ARCHITECT.md` §0 and core engines. Part II: DNA Ch 17/18/35. Part III: §III-16, §III-41, §III-43. Roadmap: bounded-authority realization; decision registry (§III-16).

---

## IV-29 — AI Governance & Safety

**Purpose.** To fix the governance and safety frame around the AI workforce — human oversight, constitutional alignment, guardrails, risk controls, accountability, and auditability — as principles, not implementation.

**Why it exists.** An AI workforce is only as trustworthy as the governance around it. This section elevates the constitutional governance commitments (DNA Ch 30) to the workforce layer so safety is structural, not bolted on (§IV-9).

**Scope.** Governance and safety **principles for the workforce**. It does **not** define security implementation, risk-scoring mechanics, or audit implementation (those are Part III mechanics and later Phase 4.x).

- **Human oversight.** Every AI worker operates under the AI Supervisor line and the human principal; high-consequence work keeps a human in the loop (DNA Ch 18.5/18.9; §IV-16/§IV-18).
- **Constitutional alignment.** Every worker, category, and grant must pass the constitutional admission-and-success gate (DNA Ch 24/33.1) and may never violate the entrenched core (DNA Ch 29).
- **Guardrails.** Deterministic authority (math decides; AI narrates — Art. 6), provider independence (Art. 2), granted-and-bounded authority (DNA Ch 18), and explainability-before-action (DNA Ch 30.2 — "unexplainable decisions do not act") are the standing guardrails.
- **Risk controls.** The high-consequence floor (DNA Ch 18.9) and human-review-for-high-risk-change (Art. 8) are the workforce's primary risk controls; downward reclassification is itself governed.
- **Accountability.** Every AI action is attributable, explainable, and auditable; authority without accountability is forbidden (DNA Ch 18.7, Ch 30.2).
- **Auditability.** Decisions and actions leave a reviewable trail (DNA Ch 30.2; §III-65).

**Current State (IMPLEMENTED / PARTIAL).** **IMPLEMENTED:** the guardrails and risk controls above are enforced today for AI features — deterministic authority (Art. 6; §III-16), provider independence (Art. 2; §III-17), human review for high-risk change (Art. 8; §III-40–§III-44), and audit trails (§III-65). **PARTIAL:** governance is enforced over AI *features* and the bounded build-agent (agent contract; Art. 16), not yet over an organization of AI *workers*. The four constitutional enforcement mechanisms (compliance review, standing, remediation, text integrity — DNA Ch 30.4) are defined but not yet operationalized (§III-84).

**Approved Future State.** The same governance extended to the realized AI workforce, additively and tightening under growth (DNA Ch 20.8, Ch 30); enforcement mechanisms operationalized (§III-84 approved-future).

**Dependencies.** DNA Ch 18/24/29/30/33; Operating Constitution Art. 2/6/8/16; §III-16/§III-17/§III-40–§III-44/§III-65/§III-84; §IV-9/§IV-16/§IV-18.

**Traceability.** Part I: guardrails evidenced in `ARCHITECT.md` and the gateway/engine code. Part II: DNA Ch 18/24/29/30/33. Part III: §III-16, §III-17, §III-39–§III-44, §III-62–§III-65, §III-84. Roadmap: governance operationalization.

---

## IV-30 — AI Collaboration Architecture

**Purpose.** To define the collaboration *architecture* of the AI workforce — the standing collaboration channels between AI and humans, AI and AI, AI and departments, AI and product, and AI and customers — as structure, not workflow.

**Why it exists.** A coherent workforce requires defined collaboration channels, or it fragments into isolated agents (DNA Ch 33.2 workforce coherence). This section fixes the channels so later phases can define how work flows through them.

**Scope.** Collaboration **architecture only** — which parties collaborate and along which channel. No workflows, no communication procedures, no message formats.

- **AI ↔ Human.** The primary channel: humans direct and approve; AI advises, executes-within-authority, and escalates (DNA Ch 18; §IV-27). Non-removable AI-oversight line (§IV-18).
- **AI ↔ AI.** Workers collaborate under managers and executives within one coherent company, sharing context via governed memory (§IV-32), never fragmenting authority (DNA Ch 8.1, Ch 27.10). Approved-future.
- **AI ↔ Departments.** AI workers operate inside their department and collaborate across departments along the standing relationships of §IV-19, under the RACI of §IV-17.
- **AI ↔ Product.** AI operates *on and through* the product surface — today via `dataService`-mediated features (§III-15); the product remains the governed surface through which AI acts (Operating Constitution Art. 3 frontend gateway).
- **AI ↔ Customers.** AI collaborates with customers transparently — never hiding that it is AI (DNA Ch 28.4, Ch 29.7) — within the client portal surface and the advisory/honesty boundaries (§III-4). Deepens toward natural-language and voice over time (DNA Ch 15–16).

**Current State (PARTIAL).** **IMPLEMENTED:** the AI↔Human and AI↔Product channels exist today — AI features are reached only through `dataService` → edge → gateway (§III-15/§III-17), and AI-narrated output reaches customers through the governed product surface (§III-27/§III-28) with AI disclosure. **NOT IMPLEMENTED:** AI↔AI collaboration (no multi-agent orchestration today — orchestration is feature-scoped and deterministic, §III-18) and AI-worker-mediated AI↔Departments collaboration.

**Approved Future State.** Progressive realization of multi-agent AI↔AI and AI↔Departments collaboration under the workforce model, additively (DNA Ch 8.1/8.3, Ch 18), with memory-informed context (DNA Ch 19). Collaboration *workflows* are deferred to later Phase 4.x.

**Dependencies.** DNA Ch 8/15/16/18/19/27/28/29; Operating Constitution Art. 3; §III-4/§III-15/§III-17/§III-18/§III-27/§III-28; §IV-17/§IV-18/§IV-19/§IV-32.

**Traceability.** Part I: gateway-mediated channels evidenced in `ARCHITECT.md` §7/§12. Part II: DNA Ch 8/18/19/27/28. Part III: §III-15, §III-17, §III-18, §III-27, §III-28. Roadmap: multi-agent collaboration.

---

## IV-31 — AI Capability Framework

**Purpose.** To document the enterprise **capabilities** expected of the AI workforce — the classes of ability it must hold — with continuous-learning boundaries, as a capability frame rather than an implementation.

**Why it exists.** Categories (§IV-24) say *what a worker is for*; capabilities say *what any worker must be able to do*. Fixing the capability classes lets later phases build to a known standard rather than an open-ended one.

**Scope.** Capability **classes and their boundaries only**. No models, no prompts, no tools, no benchmarks, no KPIs.

- **Reasoning.** Analyse a business situation and derive sound conclusions (DNA Ch 17). *Advisory, unbounded in thought.*
- **Planning.** Prepare structured plans and options for human/engine disposition (DNA Ch 18.4).
- **Analysis.** Interpret data and surface insight — always subordinate to deterministic authoritative numbers (Art. 6).
- **Writing.** Produce clear, honest narration and documents that never overstate value (DNA Ch 21.5, Ch 28.2).
- **Research.** Gather and synthesize relevant information under stewardship and isolation boundaries (DNA Ch 19/20).
- **Decision support.** Frame decisions and trade-offs for human decision-makers (DNA Ch 18.5) — support, not substitution.
- **Knowledge retrieval.** Retrieve organizational knowledge under permission and purpose (§IV-32; DNA Ch 19.3).
- **Quality assurance.** Check work for correctness and constitutional alignment (evidence over assertion — Art. 10).
- **Continuous-learning boundaries.** Learning is honest (including from failure — DNA Ch 19.7), per-customer isolated (DNA Ch 19.5), permissioned and purpose-bound (DNA Ch 19.3), correctable/forgettable (DNA Ch 19.6), and never used against the customer (DNA Ch 19.4, Ch 29.9). Learning never silently widens authority (DNA Ch 18.9).

**Current State (PARTIAL).** **IMPLEMENTED (feature-scoped):** reasoning, analysis, writing, and decision-support capabilities exist today as gateway-mediated assistive features (chat, analysis, narrative, copilot, objection — §III-15), always subordinate to deterministic authority. **PARTIAL:** knowledge retrieval exists as static, version-controlled knowledge (registries/specs, §III-19) rather than governed per-org retrieval. **NOT IMPLEMENTED:** continuous learning as a runtime capability — compounding customer memory does not yet exist (§III-20); QA-as-AI-capability is not automated.

**Approved Future State.** Progressive realization of the full capability set under the learning boundaries, additively (DNA Ch 8.3, Ch 19, Ch 23). Capability *implementation* (models, tools, retrieval) is deferred to later Phase 4.x.

**Dependencies.** DNA Ch 17/18/19/20/21/28/29; Operating Constitution Art. 6/10; §III-15/§III-19/§III-20; §IV-24/§IV-32.

**Traceability.** Part I: assistive capabilities evidenced in `ARCHITECT.md` §7. Part II: DNA Ch 17/18/19/21/28. Part III: §III-15, §III-19, §III-20. Roadmap: capability realization.

---

## IV-32 — AI Memory & Knowledge Principles

**Purpose.** To fix the **high-level principles** of AI memory and organizational knowledge — organizational knowledge, shared memory, context management, privacy boundaries, and knowledge ownership — without any technical implementation.

**Why it exists.** Memory is how the workforce's judgment compounds and is one of Cortex's most sensitive responsibilities (DNA Ch 19). Fixing the principles at the architecture level ensures the workforce's memory is trustworthy by design before it is built (§III-20).

**Scope.** Memory and knowledge **principles only**. It explicitly excludes technical memory implementation, storage schemas, retrieval mechanics, and vector/index design (those are later Phase 4.x and Part III mechanics).

- **Organizational knowledge.** The workforce operates on structured, governed organizational knowledge; knowledge that drives authoritative decisions is deterministic and version-controlled, never model-generated (DNA Ch 17; §III-19).
- **Shared memory.** Memory reinforces the coherence of the AI company — it lets executives, departments, and workers act with continuity and context, never fragmenting into disconnected silos (DNA Ch 19.8).
- **Context management.** Workers act on context that is bounded by permission and purpose; context is retained only for the purpose the customer expects, and no further (DNA Ch 19.3).
- **Privacy boundaries.** Memory is isolated per organization; what is learned about one business never leaks to another (DNA Ch 19.5, Ch 20.3); memory is never used against the customer (DNA Ch 19.4, Ch 29.9).
- **Knowledge ownership.** Memory belongs to the customer, held in stewardship, correctable and forgettable, and portable on exit (DNA Ch 19.2/19.6, Ch 20.1/20.9).

**Current State (PARTIAL).** **IMPLEMENTED:** operational memory of each engagement (KV state, immutable snapshots) and institutional/system memory (`memory/failure_library.md`, `memory/regression_cases.md`) exist and are governed (§III-20); static organizational knowledge (registries/specs) is version-controlled (§III-19); per-organization isolation is enforced by tenancy/RLS (§III-44). **NOT IMPLEMENTED:** compounding customer memory as a runtime construct that sharpens judgment over a client's lifetime (§III-20 marks this *PARTIAL / NOT YET*); governed per-org retrieval feeding AI context.

**Approved Future State.** A governed memory-and-knowledge capability realized under the stewardship principles, additively (DNA Ch 19/20, Ch 23), with exit/portability guarantees. Technical implementation is deferred to later Phase 4.x.

**Dependencies.** DNA Ch 17/19/20/29; §III-19/§III-20/§III-44; §IV-31 (knowledge-retrieval capability), §IV-33 (privacy/trust).

**Traceability.** Part I: KV/snapshot and system-memory reality evidenced in `memory/` and `architecture/`. Part II: DNA Ch 17/19/20/29. Part III: §III-19, §III-20, §III-44. Roadmap: memory-engine and per-org knowledge base.

---

## IV-33 — AI Security & Trust Principles

**Purpose.** To fix the security and trust principles that govern the AI workforce — AI identity, least privilege, human approval, the trust model, secure execution, and compliance — as principles, not implementation.

**Why it exists.** The workforce acts inside a trust institution handling sovereign customer data (DNA Ch 8, Ch 20). Its security and trust posture must be principled before it is built, so trust is structural (§IV-9/§IV-29).

**Scope.** Security and trust **principles for the workforce**. It explicitly excludes security *implementation* — auth mechanics, RLS policy design, secret storage, encryption (those are Part III mechanics, §III-39–§III-44, and later Phase 4.x).

- **AI identity.** Every AI worker has a distinct, attributable identity before it may act; actions are traceable to an identity (identity precedes authority; DNA Ch 18.7; §IV-25). The reserved `ai_worker` service-account identity is the approved-future anchor (§III-18).
- **Least privilege.** A worker holds only the authority explicitly granted for its role — deny by default, minimum necessary (DNA Ch 18.1; Operating Constitution Art. 5; §III-43).
- **Human approval.** High-consequence action requires human approval before effect; approval never migrates to AI by default (DNA Ch 18.9; Art. 8).
- **Trust model.** Trust is earned through honesty, bounded authority, explainability, and auditability, and is never spent for short-term gain (DNA Ch 21.3, Ch 28.1, Ch 29.10). AI never hides that it is AI (DNA Ch 29.7).
- **Secure execution.** Workers act only through governed surfaces (the gateway and product data gateway — Art. 2/3); secrets never live in code, reports, or worker context (Art. 13; DNA Ch 20.4).
- **Compliance principles.** The workforce respects advisory boundaries and third-party fairness obligations (DNA Ch 30.1), and operates within the customer's authority and consent (DNA Ch 18).

**Current State (IMPLEMENTED / PARTIAL).** **IMPLEMENTED:** least-privilege and secure-execution principles are enforced today for AI features — auth-gated AI routes, secrets in edge secrets only, gateway/data-gateway mediation, tenant isolation via RLS (§III-15/§III-39–§III-44; Art. 2/3/5/13); human approval for high-consequence action (Art. 8; §III-16). **PARTIAL:** distinct AI-worker identity does not yet exist (reserved `ai_worker`, *Future*; §III-18); AI disclosure is a standing principle applied to features today. **NOT IMPLEMENTED:** a full AI-worker security/identity model.

**Approved Future State.** A realized AI-worker security and trust model — distinct identities, per-worker least privilege, governed execution — extended additively under the same principles (DNA Ch 18/20/29, Ch 23). Security *implementation* is deferred to later Phase 4.x.

**Dependencies.** DNA Ch 18/20/21/28/29/30; Operating Constitution Art. 2/3/5/8/13; §III-15/§III-16/§III-39–§III-44; §IV-25/§IV-29.

**Traceability.** Part I: auth/isolation/secrets discipline evidenced in `ARCHITECT.md` and `supabase/` code. Part II: DNA Ch 18/20/28/29/30. Part III: §III-15, §III-16, §III-39–§III-44. Roadmap: AI-worker identity and security model.

---

## IV-34 — Phase Summary

**Purpose.** To close Phase 4.3 by recording what it designed, the key AI-workforce decisions it fixed, and how it connects to the phases that follow.

**Why it exists.** A phased document needs an explicit boundary so the AI-workforce *architecture* is not mistaken for a staffed, implemented workforce, and so the next phase begins from a settled architecture.

**Scope.** A summary of Phase 4.3 only. It designs nothing new and closes the phase.

**Key decisions fixed in Phase 4.3.**
1. The AI workforce is an organizational capability — the *doing* layer under human authority and deterministic-engine truth (§IV-23).
2. A category taxonomy of AI workers by purpose, mapped to departments — no individuals (§IV-24).
3. A governed AI-worker lifecycle from creation to retirement, with revocable authority throughout (§IV-25).
4. Five responsibility classes — strategic, tactical, operational, advisory, autonomous — with advisory dominant today (§IV-26).
5. A human–AI collaboration model spanning human-led, AI-assisted, AI-led, and shared ownership, with escalation and approval rules (§IV-27).
6. An authority framework fixing what AI may recommend/analyse/plan/execute/approve and never perform autonomously (§IV-28).
7. A governance-and-safety frame — oversight, alignment, guardrails, risk controls, accountability, auditability (§IV-29).
8. A collaboration architecture across AI↔Human/AI/Departments/Product/Customers, structure only (§IV-30).
9. An enterprise capability framework with continuous-learning boundaries (§IV-31).
10. High-level memory and knowledge principles under customer stewardship (§IV-32).
11. Security and trust principles — identity, least privilege, approval, trust model, secure execution, compliance (§IV-33).

**Current State (PARTIAL).** Today MARQ Cortex has an AI **capability**, not an AI **workforce**: **IMPLEMENTED** feature-scoped assistive intelligence via the Intelligence Gateway (advisory only) atop 35 deterministic engines that own authoritative computation, with least-privilege, secure-execution, human-approval, and audit disciplines enforced now (§III-15–§III-21, §III-39–§III-44; Operating Constitution Art. 2/3/5/6/8/13). **NOT IMPLEMENTED** as runtime constructs: AI-worker categories, lifecycle, distinct identity, tactical/operational/autonomous responsibility, AI-led execution, multi-agent AI↔AI collaboration, and compounding customer memory — all reserved as *Future* (`ai_worker` identity; DNA Ch 8.3; §III-18/§III-20).

**Approved Future State.** Progressive, additive realization of the AI workforce under human authority, deterministic-engine truth, and the constitutional authority/memory/security principles (DNA Ch 8.1/8.3, Ch 18, Ch 19, Ch 20, Ch 23, Ch 29, Ch 30), never a rebrand. Individual AI employees, prompts, prompt libraries, tool definitions, LLM providers, API specifications, technical memory implementation, workflow diagrams, department workflows, KPIs, metrics, and implementation details are **deferred to later Phase 4.x** and are not authored here.

**Dependencies.** All Phase 4.3 sections (§IV-23–§IV-33); Phases 4.1–4.2 (§IV-1–§IV-22) as foundation and structure; Parts I–III as the grounding record; `MARQ_CORTEX_ROADMAP.md` and Part VI for sequence.

**Traceability.** Part I: `ARCHITECT.md`, `architecture/system_map.json`, `memory/`, `supabase/functions/server/intelligence/`, `prompts/MARQ-CLAUDE-AGENT-SYSTEM-PROMPT-v1.0.md`. Part II: DNA Ch 8/9/17/18/19/20/21/22/23/24/27/28/29/30/33/35. Part III: §III-1, §III-4, §III-15–§III-21, §III-26–§III-28, §III-39–§III-44, §III-62–§III-65, §III-84. Roadmap: Phase 4.x AI-workforce realization; Part VI execution roadmap.

---

## Phase 4.3 — Completion Status

**Phase 4.3 (AI Workforce Architecture) is complete: Sections IV-23 through IV-34.** It designs how the AI workforce of MARQ Cortex exists as an organizational capability — overview, taxonomy, lifecycle, responsibilities, human–AI collaboration model, authority framework, governance and safety, collaboration architecture, capability framework, memory and knowledge principles, and security and trust principles — and deliberately defines **no** individual AI employees, prompts, prompt libraries, tool definitions, LLM providers, API specifications, technical memory implementation, workflow diagrams, department workflows, KPIs, metrics, or implementation details. Those belong to later Phase 4.x sections. CURRENT STATE is grounded throughout in the repository and the LOCKED Parts I–III, and is explicitly labelled IMPLEMENTED / PARTIAL / NOT IMPLEMENTED: today's AI is feature-scoped assistive intelligence via the Intelligence Gateway atop deterministic engines, not a staffed AI workforce (`ai_worker` identity reserved as Future). No AI-workforce capability is invented; CURRENT STATE and APPROVED FUTURE STATE are distinguished in every section.

**Continuity note.** The Master Blueprint remains a single, continuous document. Authoring continues with **Phase 4.4** (next Part IV phase), using the same numbering and formatting conventions, with no restart and no split. Parts I–III remain LOCKED; Phases 4.1 and 4.2 are unchanged.

*End of Phase 4.3. Part IV continues in a later phase.*

---

## Phase 4.4 — Operations & Governance

*This phase defines how MARQ Cortex operates as an enterprise — the **operational governance** that determines how work moves through the company. It builds on the company foundation (Phase 4.1), the organizational structure (Phase 4.2), and the AI workforce architecture (Phase 4.3), and it fixes the enterprise operating rules for decisions, work, quality, risk, security, compliance, knowledge, and change. It is **governance, not implementation**: it defines no department workflows, sprint/meeting processes, prompt engineering, technical implementation, KPIs, metrics, monitoring dashboards, infrastructure, API behavior, or security implementation. Those belong elsewhere and are not authored here (Golden Rule 5).*

**Reading note carried from Phases 4.1–4.3.** Every section separates CURRENT STATE from APPROVED FUTURE STATE, and CURRENT STATE claims carry an implementation label — **IMPLEMENTED**, **PARTIAL**, or **NOT IMPLEMENTED** — grounded in repository evidence or the LOCKED Parts I–III. A load-bearing current fact throughout Phase 4.4: Cortex's operational governance today is **document-and-steward based** — the Constitution (Part II), this Master Blueprint, the Operating Constitution (`MARQ_CORTEX_CONSTITUTION.md`, 17 articles + authority order), and `ARCHITECT.md`, enforced through bounded, evidence-gated sprints under MARQ Networks stewardship (§III-84–§III-86). It is not yet governance exercised by an organization of AI roles.

**Section template.** Each section answers: *Purpose · Why it exists · Scope · Current State · Approved Future State · Dependencies · Traceability.*

---

## IV-35 — Enterprise Operating Model

**Purpose.** To describe how MARQ Cortex operates as an enterprise — its operating philosophy and its model of operational governance — as the frame within which every other Phase 4.4 governance domain sits.

**Why it exists.** Governance of decisions, work, quality, risk, and change only cohere if there is a single operating model beneath them. This section fixes that model so the domains that follow are facets of one enterprise, not disconnected policies.

**Scope.** The operating model and operational-governance philosophy. It does not define operational *workflows*, sprint or meeting processes, or any implementation (those are excluded from this phase).

- **How Cortex operates.** Cortex operates as a **document-governed, evolution-based enterprise**: the Constitution sets identity and philosophy; this Master Blueprint governs product and architecture (blueprint-before-build); the Operating Constitution and `ARCHITECT.md` govern engineering mechanics; work advances through bounded, evidence-gated increments (DNA Ch 22–23; Operating Constitution Art. 1/9/10/16).
- **Operating philosophy.** *Evolve, do not rebuild* (Art. 1; DNA Ch 22.3); *maximum intelligence, minimum complexity* carried inward (DNA Ch 21.7, Ch 27); *math decides, AI narrates* (Art. 6; DNA Ch 17); *evidence over assertion* (Art. 10); *scope discipline* (Art. 16).
- **Operational governance.** Authority is resolved by a defined precedence order (Constitution → Operating Constitution/ARCHITECT → sprint criteria → verified behavior → other docs; DNA Ch 25.1); high-consequence work keeps a human in the loop (DNA Ch 18.9); nothing exists without a traceable purpose (Golden Rule).

**Current State (IMPLEMENTED).** This operating model is the reality today: MARQ Networks stewards Cortex; the four-document authority stack governs (Constitution, Blueprint, Operating Constitution, `ARCHITECT.md`); sprints carry work under quality gates (Art. 9); and the roadmap file is the append-only record of progress (§III-74/§III-75/§III-84–§III-86). It is a human-and-document operating model; an AI-role-operated model is **NOT IMPLEMENTED** (reserved as *Future*, DNA Ch 8.3).

**Approved Future State.** The same operating model exercised progressively by the AI workforce under human authority, additively (DNA Ch 8.3, Ch 23), with drift-detection and enforcement operationalized (§III-75/§III-84 approved-future). No new operating philosophy is introduced.

**Dependencies.** DNA Ch 17/18/21/22/23/25; Operating Constitution Art. 1/6/9/10/16 + authority order; §III-74/§III-75/§III-84–§III-86; Phases 4.1–4.3.

**Traceability.** Part I: document-governed operation evidenced in `ARCHITECT.md` and the artifact set. Part II: DNA Ch 17/18/21/22/23/25. Part III: §III-74, §III-75, §III-84–§III-86. Roadmap: enforcement/drift operationalization.

---

## IV-36 — Decision Governance

**Purpose.** To govern how decisions are made in the enterprise — their categories, ownership, approval hierarchy, and escalation authority.

**Why it exists.** Decisions stall or drift without owners and a resolution order (DNA Ch 24/25). This section makes decision-making governable at the enterprise level, extending §III-86 (Decision Authority) to the company as a whole.

**Scope.** Decision **governance** — categories, ownership, approval, escalation. It does not define decision workflows, meeting processes, or metrics.

- **Decision categories.** (1) *Constitutional* — identity, philosophy, governance; (2) *Product/architecture* — what Cortex is and how it is built; (3) *Engineering-mechanics* — how change is executed; (4) *Scoped-execution* — within an assigned increment; (5) *Authoritative computation* — scoring/ROI/prioritization; (6) *High-consequence runtime* — irreversible/third-party/material/authority-changing actions.
- **Decision ownership.** Constitutional → Constitution + human steward (amend only via DNA Ch 35); Product/architecture → this Master Blueprint (Master Rule); Engineering-mechanics → Operating Constitution + `ARCHITECT.md`; Scoped-execution → sprint acceptance criteria; Authoritative computation → deterministic engines (Art. 6); High-consequence runtime → humans (DNA Ch 18.9). (This mirrors §III-86 and §IV-17.)
- **Approval hierarchy.** Approval rises with consequence: routine within scope → the assigned owner; product/architecture → blueprint governance; high-consequence → human principal; entrenched-core change → heightened amendment with Constitutional Guardian (DNA Ch 35.5–35.6).
- **Escalation authority.** At the edge of authority or confidence, the decision escalates upward rather than being taken; silence is never approval (DNA Ch 18.6). Downward reclassification of a high-consequence decision is itself a governed, recorded act (DNA Ch 18.9).

**Current State (IMPLEMENTED / PARTIAL).** **IMPLEMENTED:** decision categories, ownership, and the precedence/escalation order are defined and operative today (§III-86; DNA Ch 24/25; Art. 6/8). Deterministic engines already own authoritative computation; humans own high-consequence transitions (§III-16). **PARTIAL:** a formal **decision registry** binding each recurring decision type to its authority is approved but not yet built (§III-16/§III-86 approved-future). **NOT IMPLEMENTED:** the Constitutional Guardian is defined but not yet constituted (DNA Ch 35.6).

**Approved Future State.** A decision registry and constituted Guardian operationalized, additively (DNA Ch 35; §III-16/§III-86), with AI participation in lower-consequence decision categories under supervision (§IV-28).

**Dependencies.** DNA Ch 18/24/25/35; Operating Constitution Art. 6/8 + authority order; §III-16/§III-86; §IV-17/§IV-28.

**Traceability.** Part I: precedence and gating evidenced in `ARCHITECT.md` §0/§18. Part II: DNA Ch 18/24/25/35. Part III: §III-16, §III-86. Roadmap: decision registry; Guardian constitution.

---

## IV-37 — Work Governance

**Purpose.** To define, at a high level, how the enterprise governs its major classes of work — product, engineering, AI, and business — so that work of every kind moves under consistent rules.

**Why it exists.** Different work carries different risk and authority, but all of it must obey the same constitutional floor. This section fixes the governing rules per work class without prescribing how the work is performed.

**Scope.** **High-level governance of work classes only.** No workflows, sprint/meeting processes, or task-level procedures.

- **Product work.** Governed by the Master Rule: every feature must exist in this Master Blueprint before implementation; on blueprint-vs-code conflict, blueprint wins (§III-75). Product work must pass the constitutional admission gate (DNA Ch 24/33.1).
- **Engineering work.** Governed by the Operating Constitution: additive evolution (Art. 1), quality gates (Art. 9), evidence over assertion (Art. 10), scope discipline (Art. 16), manifest-before-code (Art. 14), and no unauthorized runtime cutover (Art. 12).
- **AI work.** Governed by the AI doctrines: deterministic authority (Art. 6; DNA Ch 17), provider independence (Art. 2), bounded/granted authority with human-in-the-loop at the high-consequence floor (DNA Ch 18), and the AI-workforce authority framework (§IV-28).
- **Business work.** Governed by the business philosophy and boundaries: honest, measurable value (DNA Ch 21.5); advisory/honesty boundaries — no regulated advice, no guaranteed results (§III-4; Ready Gate); durable over extractive (DNA Ch 21.6).

**Current State (IMPLEMENTED / PARTIAL).** **IMPLEMENTED:** engineering-work and AI-work governance are enforced today through the Operating Constitution articles and the gateway/engine separation (§III-15/§III-16; Art. 1/2/6/9/10/12/14/16); business-work boundaries are enforced by the Ready Gate (§III-4). **PARTIAL:** the Master Rule (blueprint-before-build) is established and in force for this program but is a young discipline layered onto an existing codebase (§III-75). Work governance is exercised by humans and the bounded build-agent today, not by AI departments (**NOT IMPLEMENTED** for AI-role-exercised governance).

**Approved Future State.** The same work-governance rules exercised progressively by the AI workforce under supervision, additively (DNA Ch 8.3, Ch 23), with automated blueprint↔code drift governance (§III-75).

**Dependencies.** DNA Ch 17/18/21/24/33; Operating Constitution Art. 1/2/6/9/10/12/14/16; §III-4/§III-15/§III-16/§III-75; §IV-28.

**Traceability.** Part I: work discipline evidenced in `ARCHITECT.md` §11/§18. Part II: DNA Ch 17/18/21/24. Part III: §III-4, §III-15, §III-16, §III-75. Roadmap: drift governance; AI-exercised work governance.

---

## IV-38 — Quality Governance

**Purpose.** To govern quality across the enterprise — the quality principles, review expectations, approval philosophy, and continuous improvement that keep Cortex trustworthy.

**Why it exists.** Quality is a precondition of trust, and trust is the core asset (DNA Ch 21.3). This section fixes how quality is governed so correctness is structural, not incidental — without prescribing test implementation or metrics.

**Scope.** Quality **governance principles** only. It does not define test suites, coverage targets, KPIs, or QA workflows (test *strategy* lives at §III-76; this section governs the *principles* above it).

- **Quality principles.** Evidence over assertion — completion is claimed only with verifiable evidence, tagged by confidence (Art. 10; DNA Ch 22.4); one canonical authority per responsibility (Art. 14; DNA Ch 22.5); explainability and auditability engineered in (DNA Ch 22.7, Ch 30.2).
- **Review expectations.** High-risk change (auth, permissions, isolation, secrets, data authority, provider/shared contracts) requires human review before effect (Art. 8); every sprint carries an architecture-compliance check, regression tests for touched domains, and documentation updates (Art. 9).
- **Approval philosophy.** Deny-by-default for high-consequence steps; approval rises with consequence (DNA Ch 18.9); a change that cannot be explained does not ship (DNA Ch 30.2).
- **Continuous improvement.** Learn from outcomes including failures; record them so they are not repeated (DNA Ch 19.7; system memory `memory/failure_library.md`, `memory/regression_cases.md`).

**Current State (IMPLEMENTED / PARTIAL).** **IMPLEMENTED:** the quality-governance principles are enforced today — sprint quality gates (Art. 9), evidence discipline (Art. 10), human review for high-risk change (Art. 8), and institutional failure memory (§III-20; DNA Ch 19.7). **PARTIAL:** test *coverage* is concentrated on gateway/migration/DB layers with no broad engine/component unit suite yet (§III-76) — a known quality gap, governed but not closed. Continuous improvement is human-and-document driven; automated improvement is **NOT IMPLEMENTED**.

**Approved Future State.** Broader test coverage as a release gate and automated compliance/drift checks (§III-75/§III-76 approved-future); continuous improvement extended to the AI workforce (DNA Ch 19), additively.

**Dependencies.** DNA Ch 18/19/22/30; Operating Constitution Art. 8/9/10/14; §III-20/§III-76; §IV-29.

**Traceability.** Part I: gates and failure memory evidenced in `ARCHITECT.md` and `memory/`. Part II: DNA Ch 18/19/22/30. Part III: §III-20, §III-76. Roadmap: coverage and improvement automation.

---

## IV-39 — Risk Governance

**Purpose.** To govern enterprise risk — how risk is identified, owned, escalated, and mitigated — so consequential change is handled deliberately.

**Why it exists.** An AI-first enterprise handling sovereign data must treat risk as a first-class governed concern, not an afterthought. This section fixes the risk-governance frame at the principle level, without defining scoring mechanics or metrics.

**Scope.** Risk **governance principles** only — identification, ownership, escalation, mitigation. No risk-scoring implementation, no dashboards, no metrics.

- **Risk identification.** Risk is classified against the high-consequence floor (DNA Ch 18.9) and the high-risk domains named by the Operating Constitution (auth, permissions, secrets, isolation, RLS design, production data migration/authority, provider/shared-contract changes — Art. 8). Known limitations and technical debt are logged, not hidden (§III-78/§III-79).
- **Risk ownership.** High-risk domains are owned by the human principal for approval (Art. 8; DNA Ch 18.9); security-classed risk carries a standing dotted-line to the Security concern (§IV-18/§IV-40); authoritative-computation risk is owned by the deterministic engines' correctness discipline (Art. 6).
- **Risk escalation.** At the edge of authority or confidence, risk escalates to a human rather than being absorbed silently (DNA Ch 18.6); downward reclassification of a high-consequence risk is governed and recorded (DNA Ch 18.9).
- **Risk mitigation principles.** Rollback readiness where data/schema change (Art. 9/17); no unauthorized runtime cutover (Art. 12); idempotent, quarantined migration (Art. 11); additive evolution over rebuild (Art. 1); accountability and remediation for harm (DNA Ch 30.1/30.4).

**Current State (IMPLEMENTED / PARTIAL).** **IMPLEMENTED:** the risk-governance principles are enforced today — high-risk-domain human review (Art. 8), rollback readiness and no-unauthorized-cutover (Art. 9/12/17), idempotent migration with quarantine (Art. 11), and logged technical debt/limitations (§III-78/§III-79). Error/edge handling is documented (§III-56/§III-57). **PARTIAL:** risk handling is document-and-review based; a formal enterprise risk register or automated risk classification is **NOT IMPLEMENTED**.

**Approved Future State.** A formal risk register and constitutional change-advisory tied to the decision framework (DNA Ch 24; §III-75 approved-future), additively; risk governance extended to AI-worker actions under supervision (§IV-29).

**Dependencies.** DNA Ch 18/24/30; Operating Constitution Art. 1/8/9/11/12/17; §III-56/§III-57/§III-78/§III-79; §IV-18/§IV-29/§IV-40.

**Traceability.** Part I: risk disciplines evidenced in `ARCHITECT.md` and migration/rollback artifacts. Part II: DNA Ch 18/24/30. Part III: §III-56, §III-57, §III-78, §III-79. Roadmap: risk register; change advisory.

---

## IV-40 — Security Governance

**Purpose.** To govern security at the enterprise level — security ownership, responsibilities, human oversight, and AI responsibilities — as high-level governance, not implementation.

**Why it exists.** Security is a non-negotiable of the Constitution (DNA Ch 29.3) and the foundation of the trust institution (DNA Ch 20). This section fixes *who owns security and how it is overseen* at the governance level; the *mechanics* are already documented in Part III and are not restated.

**Scope.** **High-level security governance only.** It explicitly excludes security implementation — auth mechanics, RLS policy design, secret storage, encryption (those are §III-39–§III-44 and later Phase 4.x).

- **Security ownership.** Security is a standing enterprise concern owned by the Security function/department (§IV-14) with a dotted-line into every department it governs (§IV-18); ultimate accountability for security posture rests with the human principal (Art. 8; §IV-17).
- **Security responsibilities.** Tenant isolation, permission enforcement, secrets discipline, and human review for high-risk change are governed as inviolable responsibilities (Art. 5/8/13; DNA Ch 20/29.3) — never traded for convenience (DNA Ch 22.6).
- **Human oversight.** High-risk security domains require human review before effect (Art. 8); security posture changes meet the high-consequence floor (DNA Ch 18.9) and stay under human control.
- **AI responsibilities.** AI may analyse, recommend, and monitor security within bounded authority; AI never autonomously changes authority, permissions, or security posture (DNA Ch 18.9; §IV-28) and never holds secrets in its context (Art. 13; §IV-33).

**Current State (IMPLEMENTED / PARTIAL).** **IMPLEMENTED:** the security-governance responsibilities are enforced today — tenant isolation/RLS, secrets in edge secrets only, auth-gated routes, human review for high-risk change (§III-39–§III-44; Art. 5/8/13). **PARTIAL:** governance is exercised by humans and the build-agent discipline, not by a Security AI function (**NOT IMPLEMENTED** as an AI role); no formal external security certification exists yet (§III-68).

**Approved Future State.** Security governance extended to a Security AI function under human oversight, additively (DNA Ch 8.3, Ch 18); formal security/compliance program (§III-68 approved-future). Security *implementation* remains deferred to Part III mechanics and later Phase 4.x.

**Dependencies.** DNA Ch 18/20/22/29; Operating Constitution Art. 5/8/13; §III-39–§III-44/§III-68; §IV-14/§IV-17/§IV-18/§IV-28/§IV-33.

**Traceability.** Part I: security disciplines evidenced in `ARCHITECT.md` and `supabase/` code. Part II: DNA Ch 18/20/22/29. Part III: §III-39–§III-44, §III-68. Roadmap: Security-AI governance; compliance program.

---

## IV-41 — Compliance Governance

**Purpose.** To govern compliance across the enterprise — internal, external, and constitutional compliance, and policy management.

**Why it exists.** Compliance keeps Cortex within both the law and its own Constitution (DNA Ch 25.6 Rule of Law; Ch 30). This section fixes how compliance is governed so alignment is checked, not assumed.

**Scope.** Compliance **governance** — the categories of compliance and how policy is managed. It does not define audit implementation, certification procedures, or metrics.

- **Internal compliance.** Conformance to the Operating Constitution, `ARCHITECT.md` golden rules, sprint acceptance criteria, and the Master Blueprint — checked via architecture-compliance checks and quality gates (Art. 9; §III-84).
- **External compliance.** Conformance to applicable law and regulation — a floor beneath the Constitution (DNA Ch 25.6); today expressed through product boundaries (advisory/autonomy/data discipline) rather than external certification (§III-68).
- **Constitutional compliance.** Conformance to the DNA — every capability passes the admission-and-success gate (DNA Ch 24/33.1), respects the entrenched core (DNA Ch 29), and is checked on a deliberate cadence with standing to raise violations, a duty to remediate, and protected constitutional-text integrity (DNA Ch 30.4).
- **Policy management.** Policy authority follows the precedence order (DNA Ch 25.1); policy changes to identity/governance require amendment (DNA Ch 35); every change to the constitutional text is a ratified amendment or a logged editorial correction, never a silent edit (DNA Ch 30.4).

**Current State (IMPLEMENTED / PARTIAL).** **IMPLEMENTED:** internal and constitutional compliance are governed today — architecture-compliance checks and quality gates (Art. 9), the precedence/authority order, and product-boundary compliance via the Ready Gate (§III-4/§III-68). **PARTIAL:** the four constitutional enforcement mechanisms (compliance review, standing, remediation, text integrity) are *defined* but not yet operationalized as a running program (DNA Ch 30.4; §III-84). **NOT IMPLEMENTED:** formal external compliance certifications (e.g., SOC 2, ISO 27001) or documented regulatory mappings (§III-68).

**Approved Future State.** A formal compliance program mapped to applicable regimes, with operationalized enforcement cadence and attestations (§III-68/§III-84 approved-future; DNA Ch 30.4), additively.

**Dependencies.** DNA Ch 24/25/29/30/33/35; Operating Constitution Art. 9 + authority order; §III-4/§III-68/§III-84.

**Traceability.** Part I: compliance-by-discipline evidenced in `ARCHITECT.md` and gate artifacts. Part II: DNA Ch 24/25/29/30/35. Part III: §III-4, §III-68, §III-84. Roadmap: compliance program; enforcement operationalization.

---

## IV-42 — Knowledge Governance

**Purpose.** To govern the enterprise's knowledge — knowledge ownership, documentation principles, version authority, and blueprint authority — at a high level.

**Why it exists.** An enterprise that cannot govern its own knowledge cannot stay coherent or auditable (DNA Ch 30.2; Art. 15). This section fixes how documentation and authoritative knowledge are governed, distinct from the AI-workforce knowledge principles of §IV-32.

**Scope.** **High-level knowledge governance only.** It excludes technical knowledge/memory implementation, storage, and retrieval (those are §IV-32 principles and later Phase 4.x). It governs the company's own documentation and authority artifacts.

- **Knowledge ownership.** MARQ Networks owns and stewards the knowledge corpus (DNA Ch 9; §III-85); within it, each artifact has a single canonical owner (Constitution owns identity; Blueprint owns product/architecture; Operating Constitution owns mechanics; `ARCHITECT.md` owns the repo map; manifest owns component identity — §III-85).
- **Documentation principles.** Documentation is a contract, not a courtesy: structural changes update `ARCHITECT.md` and `architecture/system_map.json`; sprint completion is recorded (Art. 15); cross-reference rather than duplicate (Golden Rule 8; §III-88).
- **Version authority.** Versioning follows the Operating Constitution changelog and the manifest `lastVerified` discipline (Art. 14/15; §III-71); the roadmap file is append-only (§III-74); constitutional-text changes are versioned, attributed, and logged (DNA Ch 30.4).
- **Blueprint authority.** This Master Blueprint is the authority for product and architecture; the codebase is the implementation; on conflict, blueprint first, code second (Master Rule; §III-75). Every future feature exists in the Blueprint before implementation.

**Current State (IMPLEMENTED).** **IMPLEMENTED:** knowledge governance is operative today — single-owner artifacts (§III-85), documentation-as-contract with the change checklist (Art. 15; §III-75), append-only roadmap and manifest versioning (§III-71/§III-74), and the Master Rule governing blueprint authority (§III-75). Static, version-controlled organizational knowledge exists (registries/specs, §III-19). **PARTIAL:** automated drift detection (manifest↔filesystem, blueprint↔code) is approved but not yet built (§III-75). Governed per-org *customer* knowledge is **NOT IMPLEMENTED** (§III-19/§IV-32).

**Approved Future State.** Automated drift detection and an auto-generated traceability corpus (§III-75/§III-87 approved-future), additively; governed knowledge extended to the Knowledge AI category under stewardship (§IV-24/§IV-32).

**Dependencies.** DNA Ch 9/25/30; Operating Constitution Art. 14/15; §III-19/§III-71/§III-74/§III-75/§III-85/§III-87/§III-88; §IV-32.

**Traceability.** Part I: documentation-as-contract evidenced in `ARCHITECT.md` §18 and `architecture/`. Part II: DNA Ch 9/25/30. Part III: §III-71, §III-74, §III-75, §III-85, §III-87, §III-88. Roadmap: drift detection; generated traceability.

---

## IV-43 — Change Governance

**Purpose.** To govern change across the enterprise — the amendment process and how product, architecture, AI, and governance changes are made — so the company evolves without breaking integrity.

**Why it exists.** Change is constant; integrity must be too. This section fixes how each class of change is governed so evolution stays additive, reversible, and traceable (DNA Ch 23; Art. 1).

**Scope.** Change **governance** — amendment, product change, architecture change, AI evolution, governance updates. It does not define release pipelines, sprint mechanics, or deployment implementation (those are §III-72–§III-74 and excluded from this phase).

- **Amendment process.** Changes to identity, philosophy, or governance are made only through the constitutional amendment process (DNA Ch 35); entrenched-core change requires the heightened path — independent-guardian consent, published justification, waiting period (DNA Ch 35.5–35.6).
- **Product change.** Governed by the Master Rule: blueprint-before-build; blueprint wins on conflict (§III-75). Product change passes the admission gate (DNA Ch 24).
- **Architecture change.** Additive by default; rebuilds require explicit approval, rollback readiness, and evidence that incremental change cannot achieve the objective safely (Art. 1); no unauthorized runtime cutover (Art. 12); the change checklist updates `ARCHITECT.md`, `system_map.json`, and the manifest (Art. 14/15; §III-75).
- **AI evolution.** Progressive and additive — never a rebrand (DNA Ch 8.3, Ch 23); autonomy widens only upward from the high-consequence floor, with proof (DNA Ch 18.9); each step traces back to identity (DNA Ch 8.3).
- **Governance updates.** Changes to governance itself follow the precedence order and, where they touch identity/governance, the amendment process (DNA Ch 25.1/35); governance changes are versioned, attributed, and logged (DNA Ch 30.4).

**Current State (IMPLEMENTED / PARTIAL).** **IMPLEMENTED:** change governance is operative today — additive-evolution discipline and rebuild constraints (Art. 1), no-unauthorized-cutover (Art. 12), the change checklist (Art. 14/15; §III-75), the Master Rule (blueprint-before-build), and the defined amendment process (DNA Ch 35). AI evolution is governed as additive/progressive (DNA Ch 8.3). **PARTIAL:** automated drift detection and change-advisory tooling are approved but not built (§III-75). **NOT IMPLEMENTED:** the Constitutional Guardian for heightened core amendment is defined but not yet constituted (DNA Ch 35.6).

**Approved Future State.** Constituted Guardian, automated drift detection, and constitutional change-advisory (DNA Ch 35; §III-75 approved-future), additively; change governance extended to AI-workforce evolution under supervision (§IV-25/§IV-29).

**Dependencies.** DNA Ch 8.3/18/23/24/25/30/35; Operating Constitution Art. 1/12/14/15; §III-72–§III-75; §IV-25/§IV-29.

**Traceability.** Part I: change discipline evidenced in `ARCHITECT.md` §18 and migration artifacts. Part II: DNA Ch 8/18/23/24/25/35. Part III: §III-74, §III-75. Roadmap: Guardian; drift detection; change advisory.

---

## IV-44 — Enterprise Governance Principles

**Purpose.** To summarize the governing principles of Cortex — the standing enterprise-governance principles that hold across every domain of Phase 4.4.

**Why it exists.** The preceding sections govern specific domains; this section states the principles common to all of them, so governance reads as one coherent commitment rather than a set of policies. It is the governance counterpart to the foundational principles of §IV-5/§IV-9.

**Scope.** A **synthesis of governing principles** only. It introduces no new rule; it names the principles already ratified and applies them at the enterprise-governance altitude.

**The governing principles of Cortex.**
1. **Constitution supreme.** Identity, philosophy, and governance are governed by Part II; on conflict, the Constitution prevails (DNA Ch 25.1).
2. **Blueprint before build.** Product and architecture are governed by this Master Blueprint; blueprint wins over code (Master Rule; §III-75).
3. **Deterministic authority.** Math decides; AI narrates; authoritative numbers are never overridden by intelligence (Art. 6; DNA Ch 17).
4. **Bounded authority, human principal.** Authority is granted, bounded, revocable, and visible; humans stay in control at the high-consequence floor (DNA Ch 18).
5. **Evidence over assertion.** Completion and correctness require verifiable evidence (Art. 10; DNA Ch 22.4).
6. **Evolve, do not rebuild.** Change is additive, reversible, and traceable (Art. 1; DNA Ch 23).
7. **One canonical authority per responsibility.** No duplicate engines, registries, or sources of truth (Art. 14; DNA Ch 22.5, Ch 29.2).
8. **Security and stewardship never traded.** Isolation, permissions, secrets, and data sovereignty hold over convenience (Art. 5/8/13; DNA Ch 20/29.3).
9. **Explainability and auditability.** Every governed decision carries a reason and leaves a trail; unexplainable decisions do not act (DNA Ch 30.2).
10. **Traceable purpose.** Nothing exists without a traceable purpose; every capability passes the admission-and-success gate (DNA Ch 24/33.1; Golden Rule).
11. **Enforceable governance.** Compliance is reviewed not assumed; violations may be raised, must be remediated, and the constitutional text is protected (DNA Ch 30.4).
12. **Simplicity under governance.** Governance carries complexity inward; it never pushes it onto the customer (DNA Ch 21.7, Ch 33.2).

**Current State (IMPLEMENTED / PARTIAL).** **IMPLEMENTED:** principles 1–10 and 12 are enforced today through the four-document authority stack, the Operating Constitution articles, the deterministic engines, and the Ready Gate (§III-4/§III-15/§III-16/§III-84–§III-86). **PARTIAL:** principle 11 (enforceable governance) is defined but its standing enforcement mechanisms are not yet operationalized (DNA Ch 30.4; §III-84).

**Approved Future State.** Full operationalization of enforceable governance (principle 11) and extension of all principles to the realized AI workforce, additively (DNA Ch 8.3, Ch 30). No new principle is added.

**Dependencies.** DNA Ch 17/18/20/21/22/23/24/25/29/30/33; Operating Constitution Art. 1/5/6/8/10/13/14 + authority order; §III-4/§III-15/§III-16/§III-84–§III-86; §IV-5/§IV-9.

**Traceability.** Part I: principle enforcement evidenced across `ARCHITECT.md` and the codebase. Part II: DNA Ch 17–33 (governance chapters). Part III: §III-84–§III-87. Roadmap: enforceable-governance operationalization.

---

## IV-45 — Phase Summary

**Purpose.** To close Phase 4.4 by recording what it governed, the key operational-governance decisions it fixed, and how it connects to the phases that follow.

**Why it exists.** A phased document needs an explicit boundary so operational *governance* is not mistaken for operational *implementation*, and so the next phase begins from a settled governance base.

**Scope.** A summary of Phase 4.4 only. It governs nothing new and closes the phase.

**Key decisions fixed in Phase 4.4.**
1. A document-governed, evolution-based enterprise operating model under MARQ Networks stewardship (§IV-35).
2. Decision governance — categories, ownership, approval hierarchy, escalation authority — extending §III-86 (§IV-36).
3. High-level work governance for product, engineering, AI, and business work (§IV-37).
4. Quality governance — evidence, review, approval philosophy, continuous improvement (§IV-38).
5. Risk governance — identification, ownership, escalation, mitigation principles (§IV-39).
6. High-level security governance — ownership, responsibilities, human oversight, AI responsibilities (§IV-40).
7. Compliance governance — internal, external, constitutional, policy management (§IV-41).
8. High-level knowledge governance — ownership, documentation, version authority, blueprint authority (§IV-42).
9. Change governance — amendment, product/architecture change, AI evolution, governance updates (§IV-43).
10. A synthesis of the twelve governing principles of Cortex (§IV-44).

**Current State (IMPLEMENTED / PARTIAL).** Cortex's operational governance is **IMPLEMENTED today in document-and-steward form**: the Constitution, this Master Blueprint, the Operating Constitution (17 articles + authority order), and `ARCHITECT.md` govern through bounded, evidence-gated sprints, with deterministic authority, human-in-the-loop at the high-consequence floor, and documentation-as-contract all enforced now (§III-74/§III-75/§III-84–§III-86; Operating Constitution Art. 1–17). **PARTIAL/NOT IMPLEMENTED:** the constitutional enforcement mechanisms and Constitutional Guardian (DNA Ch 30.4/35.6), the decision registry (§III-16/§III-86), automated drift detection (§III-75), a formal risk register, and external compliance certification (§III-68) are defined/approved but not yet operationalized; governance is exercised by humans and the bounded build-agent, not yet by AI roles.

**Approved Future State.** Progressive operationalization of the approved-future governance mechanisms and extension of every governance domain to the realized AI workforce under human authority, additively (DNA Ch 8.3, Ch 23, Ch 30), never a rebrand. Department workflows, sprint/meeting processes, prompt engineering, technical implementation, KPIs, metrics, monitoring dashboards, infrastructure, API behavior, and security implementation are **excluded from this phase** and belong elsewhere.

**Dependencies.** All Phase 4.4 sections (§IV-35–§IV-44); Phases 4.1–4.3 (§IV-1–§IV-34) as foundation, structure, and workforce; Parts I–III as the grounding record; `MARQ_CORTEX_ROADMAP.md` and Part VI for sequence.

**Traceability.** Part I: `ARCHITECT.md`, `architecture/system_map.json`, `memory/`, migration/rollback artifacts. Part II: DNA Ch 8/9/17/18/19/20/21/22/23/24/25/27/29/30/33/35. Part III: §III-4, §III-15, §III-16, §III-19, §III-20, §III-39–§III-44, §III-56, §III-57, §III-68, §III-71, §III-74–§III-79, §III-84–§III-88. Roadmap: Phase 4.x governance operationalization; Part VI execution roadmap.

---

## Phase 4.4 — Completion Status

**Phase 4.4 (Operations & Governance) is complete: Sections IV-35 through IV-45.** It defines how MARQ Cortex operates as an enterprise through operational governance — the enterprise operating model, decision governance, work governance, quality governance, risk governance, security governance (high level), compliance governance, knowledge governance (high level), change governance, and a synthesis of enterprise governance principles — and deliberately excludes department workflows, sprint/meeting processes, prompt engineering, technical implementation, KPIs, metrics, monitoring dashboards, infrastructure, API behavior, and security implementation. CURRENT STATE is grounded throughout in the repository and the LOCKED Parts I–III and is labelled IMPLEMENTED / PARTIAL / NOT IMPLEMENTED: governance today is document-and-steward based, enforced through bounded evidence-gated sprints, with several approved enforcement mechanisms defined but not yet operationalized. No governance capability is invented; CURRENT STATE and APPROVED FUTURE STATE are distinguished in every section.

**Continuity note.** The Master Blueprint remains a single, continuous document. Authoring continues with **Phase 4.5** (next Part IV phase), using the same numbering and formatting conventions, with no restart and no split. Parts I–III remain LOCKED; Phases 4.1, 4.2, and 4.3 are unchanged.

*End of Phase 4.4. Part IV continues in a later phase.*

---

## Phase 4.5 — Enterprise Performance & Continuous Improvement

*This phase defines how MARQ Cortex measures, evaluates, improves, and matures as an AI-first enterprise. It builds on the foundation (Phase 4.1), structure (Phase 4.2), AI workforce (Phase 4.3), and operational governance (Phase 4.4), and fixes the **performance philosophy** and **continuous-improvement framework** that govern the organization. It is **philosophy and framework, not instrumentation**: it defines no monitoring dashboards, Grafana/Prometheus/cloud monitoring, infrastructure, implementation metrics, numeric KPI targets, sprint/velocity metrics, engineering tooling, analytics/BI implementation, or technical monitoring. Those belong elsewhere and are not authored here (Golden Rule 5).*

**Reading note carried from Phases 4.1–4.4.** Every section separates CURRENT STATE from APPROVED FUTURE STATE, and CURRENT STATE claims carry an implementation label — **IMPLEMENTED**, **PARTIAL**, or **NOT IMPLEMENTED** — grounded in repository evidence or the LOCKED Parts I–III. A load-bearing current fact throughout Phase 4.5: measurement today exists as **raw signals plus a constitutional success standard**, not as instrumented enterprise metrics — the platform captures product/operational signals (§III-81/§III-82, both *PARTIAL*) and the constitutional success dimensions apply now as the definition of "winning" (§III-83; DNA Ch 33.2), but formal named KPIs and numeric targets are largely undefined in code. This phase governs the *philosophy above* those metrics, never their instrumentation.

**Governing subordination.** All performance measurement in this phase is subordinate to DNA Chapter 33: success is the fulfillment of purpose, **trust is the north-star**, and the anti-metrics — feature count, novelty, spectacle, engagement-for-its-own-sake, and extraction — never govern decisions (DNA Ch 33.2–33.3).

**Section template.** Each section answers: *Purpose · Why it exists · Scope · Current State · Approved Future State · Dependencies · Traceability.*

---

## IV-46 — Enterprise Performance Philosophy

**Purpose.** To fix why MARQ Cortex measures performance at all, the principles that govern measurement, and the philosophy of enterprise maturity — the frame within which every other Phase 4.5 section sits.

**Why it exists.** Measurement can either serve purpose or distort it. Before any framework, domain, or KPI category is named, the enterprise must fix *why* it measures and *what measurement may never become*, so performance strengthens trust rather than eroding it (DNA Ch 33.3).

**Scope.** The performance philosophy and the enterprise-maturity philosophy. It defines no domains (§IV-47), KPI categories (§IV-48), or maturity stages (§IV-53) — those follow.

- **Why performance is measured.** To verify that Cortex fulfills its purpose — that customers can trace its work to real, measurable value (DNA Ch 33.2.1) — and to make improvement honest and evidence-based (Art. 10; DNA Ch 22.4). Measurement exists to serve outcomes and trust, never to reward activity.
- **Performance principles.** Measure purpose, not features (DNA Ch 33.1); trust is the north-star metric — when it falls, nothing else compensates (DNA Ch 33.2.3); measure honestly, never overstating value (DNA Ch 21.5); exclude anti-metrics from any decision weighting (DNA Ch 33.3); keep measurement simple for the customer (DNA Ch 33.2.5).
- **Enterprise maturity philosophy.** Maturity is *additive deepening*, not reinvention — Cortex matures the way it evolves: bounded, verified, additive, and traceable to identity (DNA Ch 8.3, Ch 22.3, Ch 23). Growing more capable must never mean growing more complex for the customer (DNA Ch 33.2.5).

**Current State (PARTIAL).** **IMPLEMENTED:** the performance *philosophy* is constitutional and in force now — the Six Constitutional Questions and success dimensions govern what counts as success today (§III-83; DNA Ch 24/33). **PARTIAL:** measurement exists as raw signals, not instrumented metrics (§III-81/§III-82). **NOT IMPLEMENTED:** a formal enterprise performance program; the philosophy is stated and governing, but its instrumentation is future.

**Approved Future State.** Instrument the constitutional success dimensions with concrete definitions and (later) targets, always subordinate to trust and outcome delivery (§III-83 approved-future), additively. No new philosophy is introduced.

**Dependencies.** DNA Ch 21/22/23/24/33; Operating Constitution Art. 10; §III-81/§III-82/§III-83; §IV-5/§IV-11.

**Traceability.** Part I: raw-signal reality evidenced in `ARCHITECT.md` analytics/health surfaces. Part II: DNA Ch 21/22/23/24/33. Part III: §III-81, §III-82, §III-83. Roadmap: instrumented success dimensions.

---

## IV-47 — Enterprise Performance Framework

**Purpose.** To define the high-level performance **domains** of the enterprise — the areas across which performance is understood — as an architecture, not an instrumentation.

**Why it exists.** Performance must be organized by domain or it collapses into a single misleading number. This section fixes the domains so later measurement attaches to the right area, each subordinate to the constitutional success dimensions (DNA Ch 33.2).

**Scope.** Performance **domains and their meaning only** — architecture, not metrics. No KPI definitions, no numeric targets, no dashboards.

| Performance domain | What it measures (in principle) | Constitutional anchor |
|---|---|---|
| **Product** | Whether the product delivers real, effortless value | DNA Ch 33.2.1/33.2.2 (outcome delivery, effortless capability); §III-81 |
| **Engineering** | Whether the platform is built with integrity and evidence | DNA Ch 22.4 (evidence); §III-76 |
| **AI** | Whether AI is trustworthy, bounded, and helpful | DNA Ch 17/18 (governed intelligence); §IV-49 |
| **Operations** | Whether the company and platform run reliably | DNA Ch 22/30; §III-82 |
| **Customer** | Whether customers trust Cortex and realize value over time | DNA Ch 33.2.3/33.2.6 (trust, compounding judgment) |
| **Business** | Whether value is honest, durable, and industry-broad | DNA Ch 21/33.2.8/33.2.9 (durability, breadth) |

The domains are facets of one enterprise; each rolls up to **trust** as the north-star (DNA Ch 33.2.3), and none is optimized at the expense of another (DNA Ch 33.3).

**Current State (PARTIAL).** **PARTIAL:** the domains are recognizable in current signals — Product (submissions/scores/proposal progression, §III-81), Operations (health/gateway telemetry, §III-82), and Customer/Business (engagement, outcomes tracking, §III-49/§III-50). **NOT IMPLEMENTED:** a formal cross-domain performance framework; domains exist here as an approved architecture, not as instrumented reporting.

**Approved Future State.** Each domain given formal, trust-subordinate metric definitions (§III-81/§III-82/§III-83 approved-future), additively; the AI domain elaborated per §IV-49. Instrumentation is deferred and excluded from this phase.

**Dependencies.** DNA Ch 17/18/21/22/30/33; §III-49/§III-50/§III-76/§III-81/§III-82/§III-83; §IV-49.

**Traceability.** Part I: domain signals evidenced in `ARCHITECT.md` analytics/health. Part II: DNA Ch 17/18/21/22/33. Part III: §III-49, §III-50, §III-76, §III-81–§III-83. Roadmap: cross-domain metric definitions.

---

## IV-48 — Enterprise KPIs

**Purpose.** To define the enterprise-level **KPI categories** — the classes of indicator the enterprise tracks — without defining any actual numeric target.

**Why it exists.** KPIs need categories so indicators map to the right altitude and none is mistaken for an anti-metric. This section fixes the categories; numeric targets are explicitly out of scope and belong to later instrumentation.

**Scope.** KPI **categories only**. **No numeric targets, no thresholds, no formulas, no dashboards.** Every category is subordinate to trust and the constitutional success dimensions (DNA Ch 33.2).

- **Strategic KPIs.** Fulfillment of purpose at the enterprise altitude — trust (north-star), outcome delivery, breadth across industries, durability of relationships (DNA Ch 33.2.1/33.2.3/33.2.8/33.2.9).
- **Operational KPIs.** Health of running the company and platform — reliability, availability, and operational integrity (DNA Ch 22/30; §III-82). *Signals only today.*
- **Quality KPIs.** Correctness, evidence discipline, explainability, and auditability of what ships (Art. 9/10; DNA Ch 22.4/30.2; §III-76).
- **Customer KPIs.** Effortless first value, realized value over time, and trust in what Cortex says and does (DNA Ch 33.2.2/33.2.3/33.2.6).

**Anti-metric exclusion (binding).** No KPI category may reward feature count, novelty, interface spectacle, engagement-for-its-own-sake, or short-term extraction (DNA Ch 33.3). A category that would incentivize complexity, opacity, or trust-erosion is rejected.

**Current State (PARTIAL).** **PARTIAL:** raw signals supporting these categories are captured today (submissions/completion/proposal progression for Strategic/Customer; health/gateway telemetry for Operational; test suites for Quality — §III-81/§III-82/§III-76). **NOT IMPLEMENTED:** formal named KPIs and numeric targets are largely undefined in code (§III-81/§III-83). The categories here are the approved structure, not instrumented indicators.

**Approved Future State.** Formal KPI definitions per category with (later) concrete targets/SLOs, trust-subordinate and anti-metric-excluding (§III-81/§III-82/§III-83 approved-future), additively. Numeric targets remain out of scope for this phase.

**Dependencies.** DNA Ch 22/30/33; Operating Constitution Art. 9/10; §III-76/§III-81/§III-82/§III-83.

**Traceability.** Part I: KPI-supporting signals evidenced in `ARCHITECT.md`. Part II: DNA Ch 22/30/33. Part III: §III-76, §III-81, §III-82, §III-83. Roadmap: KPI definitions and targets.

---

## IV-49 — AI Performance Framework

**Purpose.** To document how AI capability is **evaluated** as a performance concern — the dimensions along which the AI workforce is judged — without prescribing implementation or measurement mechanics.

**Why it exists.** An AI-first enterprise must be able to judge whether its AI is trustworthy and helpful, not merely active. This section fixes the evaluation dimensions so AI performance is understood the way the Constitution requires — governed, bounded, and trust-first (DNA Ch 17/18/30).

**Scope.** AI performance **evaluation dimensions only**. No benchmarks, no scoring implementation, no model evaluation tooling, no numeric targets.

- **Quality.** Whether AI reasoning, analysis, and narration are correct, honest, and useful — always subordinate to deterministic authoritative numbers (Art. 6; DNA Ch 17).
- **Reliability.** Whether AI behaves consistently and degrades safely (gateway timeouts/retries/rollback exist as the current safe-degradation substrate — §III-15/§III-17).
- **Safety.** Whether AI stays within granted authority and the high-consequence floor, and escalates rather than overreaches (DNA Ch 18.5/18.6/18.9; §IV-28).
- **Trust.** Whether customers can rely on what AI says and what it is allowed to do — the north-star, extended to AI (DNA Ch 33.2.3, Ch 28.1); AI never hides that it is AI (DNA Ch 29.7).
- **Collaboration.** Whether AI strengthens workforce coherence — working under supervision and with humans, not fragmenting (DNA Ch 33.2.4; §IV-27/§IV-30).
- **Governance.** Whether AI remains explainable and auditable — unexplainable decisions do not act (DNA Ch 30.2; §IV-29).

**Current State (PARTIAL).** **IMPLEMENTED:** the *substrate* for evaluating Reliability, Safety, and Governance exists — gateway telemetry/health, timeouts/retries/rollback (§III-15/§III-17), bounded-authority enforcement (§III-16; Art. 8), and audit trails (§III-65). **PARTIAL/NOT IMPLEMENTED:** formal AI-performance evaluation (quality scoring, trust measurement, collaboration assessment) is not instrumented; today AI quality is governed by the deterministic-authority separation and human review, not by an AI-performance program.

**Approved Future State.** A formal AI-performance evaluation across these dimensions under the governance frame, additively (DNA Ch 8.3, Ch 17/18/30; §IV-29), never displacing deterministic authority or human oversight. Evaluation *implementation* is deferred and excluded from this phase.

**Dependencies.** DNA Ch 17/18/28/29/30/33; Operating Constitution Art. 6/8; §III-15/§III-16/§III-17/§III-65; §IV-27/§IV-28/§IV-29/§IV-30/§IV-31.

**Traceability.** Part I: AI safe-degradation and audit evidenced in gateway code and `ARCHITECT.md` §7/§12. Part II: DNA Ch 17/18/28/29/30/33. Part III: §III-15, §III-16, §III-17, §III-65. Roadmap: AI-performance evaluation.

---

## IV-50 — Department Performance Principles

**Purpose.** To fix the high-level performance **expectations** of departments — the principles by which any department's performance is judged — without defining department scorecards.

**Why it exists.** Departments (§IV-14) need a common standard of what "performing well" means, or performance fragments into inconsistent local definitions. This section fixes the standard at the principle level, subordinate to the enterprise success dimensions.

**Scope.** **High-level performance expectations only.** It explicitly does **not** define department scorecards, per-department KPIs, targets, or reviews (those are later Phase 4.x).

- **Purpose-fulfillment over activity.** A department performs well when it advances the enterprise's purpose and its customers' outcomes, not when it is merely busy (DNA Ch 33.1/33.3).
- **Constitutional alignment.** Every department's work passes the admission-and-success gate and never violates the entrenched core (DNA Ch 24/29/33.1).
- **Trust contribution.** Each department is judged partly by whether it strengthens or spends customer and enterprise trust (DNA Ch 21.3, Ch 33.2.3).
- **Workforce coherence.** A department performs well when it strengthens the coordinated company rather than optimizing locally at the whole's expense (DNA Ch 27.10, Ch 33.2.4).
- **Evidence and honesty.** Performance claims require evidence and honest reporting (Art. 10; DNA Ch 22.4, Ch 33.2.7 integrity).

**Current State (PARTIAL).** **PARTIAL:** these expectations apply today to the responsibilities exercised by MARQ Networks and the bounded build-agent (the departments exist as responsibilities, not staffed units — §IV-14), governed by the constitutional success standard (§III-83) and evidence discipline (Art. 10). **NOT IMPLEMENTED:** department-level performance instrumentation or scorecards — none exists and none is defined here.

**Approved Future State.** These principles extended to AI-staffed departments as they are realized, additively (DNA Ch 8.3), with formal department performance handling deferred to later Phase 4.x. Scorecards remain out of scope.

**Dependencies.** DNA Ch 21/22/24/27/29/33; Operating Constitution Art. 10; §III-83; §IV-14.

**Traceability.** Part I: evidence discipline reflected in `ARCHITECT.md`. Part II: DNA Ch 21/22/24/27/33. Part III: §III-83. Roadmap: department performance handling.

---

## IV-51 — Operational Health Framework

**Purpose.** To define, at a high level, what enterprise health means across the organization, product, platform, and AI — as a framework of health dimensions, not a monitoring implementation.

**Why it exists.** An enterprise must be able to ask "are we healthy?" at several altitudes without confusing health with instrumentation. This section fixes the health dimensions so later monitoring (excluded here) attaches to a principled frame.

**Scope.** **High-level health dimensions only.** It explicitly excludes monitoring dashboards, alerting, SLO instrumentation, and infrastructure (those are §III-62/§III-63 mechanics and excluded from this phase).

- **Organizational health.** Whether the company operates coherently under its governance — clear authority, alignment to the Constitution, no drift (DNA Ch 25/30; §III-84).
- **Product health.** Whether the product reliably delivers effortless value — completion, progression, and outcome signals (DNA Ch 33.2.1/33.2.2; §III-81).
- **Platform health.** Whether the running platform is available, reliable, and observable — health/connectivity, gateway telemetry, error/degradation posture (DNA Ch 22; §III-60/§III-61/§III-62/§III-82).
- **AI health.** Whether the AI layer is bounded, reliable, and safely degrading — gateway health, authority-boundedness, escalation discipline (DNA Ch 17/18; §III-15/§IV-49).

**Current State (PARTIAL).** **IMPLEMENTED:** platform- and AI-health *signals* exist today — `/health` and `/diagnostic` endpoints, KV/DB connectivity, gateway telemetry/health, rate-limit headers (§III-62/§III-82) — as an observability foundation. **PARTIAL:** organizational and product health are governed by the constitutional/governance frame and raw product signals, not by a consolidated health view (§III-81/§III-84). **NOT IMPLEMENTED:** a unified operational-health framework or SLO reporting (§III-82 approved-future).

**Approved Future State.** A principled operational-health framework rolling health signals up to the four dimensions, with SLO/monitoring instrumentation deferred to §III-63 and excluded from this phase; extended to AI health per §IV-49, additively.

**Dependencies.** DNA Ch 17/18/22/25/30/33; §III-60/§III-61/§III-62/§III-63/§III-81/§III-82/§III-84; §IV-49.

**Traceability.** Part I: health/observability signals evidenced in `ARCHITECT.md` and edge endpoints. Part II: DNA Ch 17/18/22/30/33. Part III: §III-60–§III-63, §III-81, §III-82, §III-84. Roadmap: operational-health framework; SLOs.

---

## IV-52 — Continuous Improvement Framework

**Purpose.** To define how the enterprise improves over time — its feedback loops, lessons-learned discipline, review cycles, improvement philosophy, and innovation culture — as a governing framework, not a process specification.

**Why it exists.** An AI-first enterprise that cannot learn honestly will repeat its mistakes and stagnate. This section fixes how improvement is governed so learning is continuous, honest, and additive (DNA Ch 19.7, Ch 23).

**Scope.** Continuous-improvement **framework and philosophy only**. It does not define sprint retrospectives, meeting processes, velocity, or tooling (those are excluded from this phase).

- **Feedback loops.** Improvement is fed by outcomes — including failures — captured and reused, not discarded (DNA Ch 19.7). Customer-realized-outcome learning feeds product direction (compounding judgment, DNA Ch 33.2.6; §IV-19).
- **Lessons learned.** Failures and regressions are recorded so they are not repeated; hiding failure is forbidden (DNA Ch 19.7, Ch 30.1). The current institutional-memory files (`memory/failure_library.md`, `memory/regression_cases.md`) are the standing lessons-learned record (§III-20).
- **Review cycles.** Alignment and quality are reviewed on a deliberate cadence, not assumed — architecture-compliance and quality gates each increment (Art. 9), and constitutional compliance review as a standing mechanism (DNA Ch 30.4).
- **Improvement philosophy.** Improvement is additive and evidence-based — evolve, do not rebuild (Art. 1; DNA Ch 22.3/22.4); every improvement must keep the experience simpler, not more complex (DNA Ch 23).
- **Innovation culture.** Innovation serves business value and trust, never technology for its own sake (DNA Ch 21.1, Ch 33.3); new capability must pass the admission gate (DNA Ch 24).

**Current State (IMPLEMENTED / PARTIAL).** **IMPLEMENTED:** the lessons-learned discipline (institutional failure/regression memory, §III-20; DNA Ch 19.7), per-increment review cycles (quality gates, Art. 9), and additive improvement philosophy (Art. 1; §III-75) operate today. **PARTIAL:** the standing constitutional compliance-review cadence is defined but not yet operationalized (DNA Ch 30.4; §III-84). **NOT IMPLEMENTED:** automated feedback loops or a formal continuous-improvement program beyond the document-and-memory discipline.

**Approved Future State.** Operationalized compliance-review cadence and richer, memory-informed feedback loops extended to the AI workforce (DNA Ch 19; §III-84 approved-future), additively. Process mechanics remain excluded from this phase.

**Dependencies.** DNA Ch 19/21/22/23/24/30/33; Operating Constitution Art. 1/9; §III-20/§III-75/§III-84; §IV-19/§IV-38.

**Traceability.** Part I: institutional memory evidenced in `memory/failure_library.md`, `memory/regression_cases.md`. Part II: DNA Ch 19/22/23/30/33. Part III: §III-20, §III-75, §III-84. Roadmap: improvement operationalization.

---

## IV-53 — Enterprise Maturity Model

**Purpose.** To describe the maturity stages through which MARQ Cortex matures as an AI-first enterprise — a model of deepening, not a schedule.

**Why it exists.** Maturity must be understood as additive deepening of one identity, or growth invites reinvention and drift. This section fixes the stages so progress is legible and always traceable to identity (DNA Ch 8.3, Ch 23), and it aligns with the organizational scalability stages of §IV-21.

**Scope.** Maturity **stages and their meaning only**. No timelines, no headcount, no metrics, no numeric targets.

| Maturity stage | What characterizes it | Relationship to prior work |
|---|---|---|
| **Startup** | Compressed structure; responsibilities held by humans + deterministic systems + a bounded AI agent; direct oversight | Current shape (§IV-21 Current State) |
| **Growth** | Portfolios and departments differentiate; AI-supervisor line formalizes as AI-staffed work begins | §IV-21 growth stage |
| **Scale** | Repeatable, standardized operation across a broadening customer base; governance and quality hold under load | §IV-54 excellence principles |
| **Enterprise** | Full department architecture and leadership layers; governance fully operationalized | §IV-21 enterprise stage; §IV-44 |
| **Global** | Same structure replicated across markets/industries; isolation and governance scale without relaxing | §IV-21 global stage; DNA Ch 20.3/20.8 |
| **AI-native** | The AI workforce realized as first-class runtime constructs under human authority; the identity fully expressed | DNA Ch 8.1/8.3 destination; §IV-23 |

**Maturity invariants (hold at every stage).** One canonical authority per responsibility (DNA Ch 22.5); deterministic authority and human-in-the-loop at the high-consequence floor (Art. 6; DNA Ch 18.9); simplicity under growth (DNA Ch 33.2.5); trust as north-star (DNA Ch 33.2.3). Maturing never relaxes an invariant.

**Current State (PARTIAL).** **IMPLEMENTED (Startup stage):** Cortex operates today at the startup maturity shape — compressed structure under MARQ Networks stewardship, with deterministic systems and a bounded AI agent (§IV-21/§IV-23 Current State). **NOT IMPLEMENTED:** the growth-through-AI-native stages are the approved trajectory, not present state; the AI-native destination is reserved as *Future* (DNA Ch 8.3).

**Approved Future State.** Additive progression through the stages, deepening one identity without rebuild (DNA Ch 8.3, Ch 22.3, Ch 23), preserving every invariant. Stage sequencing/timing is deferred to Part VI (execution roadmap).

**Dependencies.** DNA Ch 8.3/18/20/22/23/33; §IV-21/§IV-23/§IV-44/§IV-54; Part VI (future).

**Traceability.** Part I: current startup shape evidenced in `ARCHITECT.md` and `architecture/system_map.json`. Part II: DNA Ch 8/18/20/22/23/33. Part III: §III-44, §III-59. Roadmap: staged maturity; Part VI execution roadmap.

---

## IV-54 — Operational Excellence Principles

**Purpose.** To fix the principles of operational excellence — standardization, repeatability, automation, governance, quality, and continuous optimization — that keep the enterprise excellent as it matures.

**Why it exists.** Excellence at scale comes from principled discipline, not heroics. This section names the excellence principles so maturity (§IV-53) is achieved by durable practice rather than effort that cannot scale.

**Scope.** Operational-excellence **principles only**. No process implementation, no tooling, no automation infrastructure, no metrics.

- **Standardization.** One canonical way per responsibility — one manifest, one source of truth, defined authority order (Art. 14; DNA Ch 22.5; §III-85). Standardization removes ambiguity, not judgment.
- **Repeatability.** Work advances through repeatable, bounded, evidence-gated increments (Art. 9/16), so outcomes are reproducible and reviewable.
- **Automation.** Repeatable work is carried by automation so humans are freed for judgment (DNA Ch 8.1 automation systems; Ch 27.1 reduce work) — automation carries complexity inward (DNA Ch 21.7), never onto the customer.
- **Governance.** Excellence operates inside the governance frame of Phase 4.4 — deterministic authority, bounded authority, human-in-the-loop at the floor (§IV-44).
- **Quality.** Evidence over assertion; explainability and auditability engineered in; one change that cannot be explained does not ship (Art. 10; DNA Ch 22.4/30.2; §IV-38).
- **Continuous optimization.** Optimization is additive and trust-subordinate — it improves outcomes and simplicity, never trading trust or increasing customer complexity for local gain (DNA Ch 23, Ch 33.3).

**Current State (IMPLEMENTED / PARTIAL).** **IMPLEMENTED:** standardization (single manifest/authority order — Art. 14; §III-85), repeatability (bounded evidence-gated sprints — Art. 9/16), governance (Phase 4.4 frame, enforced now), and quality (evidence discipline — Art. 10) operate today. **PARTIAL:** automation exists for defined platform work (background jobs/scheduled processes, §III-33/§III-34) but not as an enterprise automation capability; continuous optimization is document-and-memory driven. **NOT IMPLEMENTED:** enterprise-wide automation of operational work by an AI workforce (reserved *Future*, DNA Ch 8.3).

**Approved Future State.** The excellence principles extended to the maturing, increasingly AI-operated enterprise, additively (DNA Ch 8.3, Ch 23), with automation and optimization deepening under governance. Implementation is excluded from this phase.

**Dependencies.** DNA Ch 8/21/22/23/27/30/33; Operating Constitution Art. 9/10/14/16; §III-33/§III-34/§III-85; §IV-38/§IV-44/§IV-53.

**Traceability.** Part I: standardization and gates evidenced in `ARCHITECT.md` §11/§18 and manifest. Part II: DNA Ch 8/21/22/27/33. Part III: §III-33, §III-34, §III-85. Roadmap: enterprise automation; optimization.

---

## IV-55 — Phase Summary

**Purpose.** To close Phase 4.5 by recording what it defined, the key performance-and-improvement decisions it fixed, and how it connects to the phases that follow.

**Why it exists.** A phased document needs an explicit boundary so performance *philosophy and framework* are not mistaken for performance *instrumentation*, and so the next phase begins from a settled framework.

**Scope.** A summary of Phase 4.5 only. It defines nothing new and closes the phase.

**Key decisions fixed in Phase 4.5.**
1. A performance philosophy: measure purpose not features, trust as north-star, anti-metrics excluded (§IV-46).
2. A high-level performance framework across Product, Engineering, AI, Operations, Customer, and Business domains (§IV-47).
3. Enterprise KPI categories — Strategic, Operational, Quality, Customer — with no numeric targets (§IV-48).
4. An AI performance framework across Quality, Reliability, Safety, Trust, Collaboration, Governance (§IV-49).
5. High-level department performance principles — no scorecards (§IV-50).
6. An operational-health framework across organizational, product, platform, and AI health (§IV-51).
7. A continuous-improvement framework — feedback loops, lessons learned, review cycles, improvement philosophy, innovation culture (§IV-52).
8. An enterprise maturity model — Startup, Growth, Scale, Enterprise, Global, AI-native — with invariants (§IV-53).
9. Operational-excellence principles — standardization, repeatability, automation, governance, quality, continuous optimization (§IV-54).

**Current State (PARTIAL).** Measurement today is **raw signals plus a constitutional success standard**, not instrumented enterprise performance: **IMPLEMENTED** — the constitutional success dimensions govern "winning" now (§III-83; DNA Ch 33), institutional failure/regression memory and per-increment review cycles operate (§III-20; Art. 9), and platform/AI health signals exist (§III-62/§III-82); **PARTIAL** — product/operational metrics are raw signals without formal KPIs (§III-81/§III-82); **NOT IMPLEMENTED** — formal enterprise KPIs, numeric targets, AI-performance evaluation, unified health framework, department scorecards, and the growth-through-AI-native maturity stages (the enterprise operates at the *Startup* maturity shape today, §IV-53). No performance capability is invented.

**Approved Future State.** Progressive instrumentation of the constitutional success dimensions and the frameworks above — trust-subordinate, anti-metric-excluding, and extended to the realized AI workforce — additively (DNA Ch 8.3, Ch 23, Ch 33). Monitoring dashboards, Grafana/Prometheus/cloud monitoring, infrastructure, implementation metrics, numeric KPI targets, sprint/velocity metrics, engineering tooling, analytics/BI implementation, and technical monitoring are **excluded from this phase** and belong elsewhere.

**Dependencies.** All Phase 4.5 sections (§IV-46–§IV-54); Phases 4.1–4.4 (§IV-1–§IV-45) as foundation, structure, workforce, and governance; Parts I–III as the grounding record; `MARQ_CORTEX_ROADMAP.md` and Part VI for sequence.

**Traceability.** Part I: `ARCHITECT.md`, `architecture/system_map.json`, `memory/failure_library.md`, `memory/regression_cases.md`, edge health/analytics surfaces. Part II: DNA Ch 8/17/18/19/20/21/22/23/24/25/27/28/29/30/33. Part III: §III-15–§III-17, §III-20, §III-33, §III-34, §III-49, §III-50, §III-59–§III-65, §III-76, §III-81–§III-85. Roadmap: performance instrumentation; maturity progression; Part VI execution roadmap.

---

## Phase 4.5 — Completion Status

**Phase 4.5 (Enterprise Performance & Continuous Improvement) is complete: Sections IV-46 through IV-55.** It defines how MARQ Cortex measures, evaluates, improves, and matures as an AI-first enterprise — the performance philosophy, performance framework, enterprise KPI categories, AI performance framework, department performance principles, operational-health framework, continuous-improvement framework, enterprise maturity model, and operational-excellence principles — and deliberately excludes monitoring dashboards, Grafana/Prometheus/cloud monitoring, infrastructure, implementation metrics, numeric KPI targets, sprint/velocity metrics, engineering tooling, analytics/BI implementation, and technical monitoring. CURRENT STATE is grounded throughout in the repository and the LOCKED Parts I–III and is labelled IMPLEMENTED / PARTIAL / NOT IMPLEMENTED: measurement today is raw signals plus a constitutional success standard, not instrumented enterprise performance, and the enterprise operates at the Startup maturity shape. All measurement is subordinate to trust and the constitutional success dimensions (DNA Ch 33); anti-metrics never govern. No performance capability is invented; CURRENT STATE and APPROVED FUTURE STATE are distinguished in every section.

**Continuity note.** The Master Blueprint remains a single, continuous document. Authoring continues with **Phase 4.6** (next Part IV phase), using the same numbering and formatting conventions, with no restart and no split. Parts I–III remain LOCKED; Phases 4.1, 4.2, 4.3, and 4.4 are unchanged.

*End of Phase 4.5. Part IV continues in a later phase.*

---

## Phase 4.6 — Enterprise Review, Audit & Lock

*This is an **audit and ratification** phase, not a writing phase. It performs a complete enterprise review of Part IV (§IV-1 through §IV-55), records the result of the 18-point audit checklist, resolves any verified architectural gap (none was found), and — on a passing review — appends the official approval record and locks Part IV. No new architectural sections are created; no section IV-1..IV-55 is redesigned. After lock, Part IV may change only through the formal Amendment Process (DNA Ch 35).*

### 4.6.1 — Audit scope and method

The audit covered all 55 sections of Part IV across its five authored phases — Phase 4.1 Company Foundation (§IV-1–§IV-12), Phase 4.2 Organizational Structure (§IV-13–§IV-22), Phase 4.3 AI Workforce Architecture (§IV-23–§IV-34), Phase 4.4 Operations & Governance (§IV-35–§IV-45), and Phase 4.5 Enterprise Performance & Continuous Improvement (§IV-46–§IV-55). Method: structural enumeration (numbering continuity and template completeness), cross-reference range validation, and constitutional/product consistency verification against the LOCKED Parts I–III, the Constitution (`CORTEX_DNA_v1.0.md`), and the Operating Constitution (`MARQ_CORTEX_CONSTITUTION.md`).

### 4.6.2 — Audit checklist results

| # | Checklist item | Result | Evidence / basis |
|---|----------------|--------|------------------|
| 1 | No missing architectural sections | **PASS** | §IV-1 through §IV-55 present and continuous; five phases each with header and completion status. Foundation → structure → workforce → governance → performance is a complete enterprise operating model at the architectural altitude. |
| 2 | No duplicated concepts | **PASS** | The three "principles" sections sit at distinct altitudes and cross-reference, not duplicate: §IV-5 (enterprise operating principles) and §IV-9 (governance principles) are foundational; §IV-44 explicitly is "the governance counterpart to the foundational principles of §IV-5/§IV-9" and "introduces no new rule." The three "collaboration" sections are likewise distinct: §IV-8 (foundational frame), §IV-27 (workforce collaboration *modes*), §IV-30 (collaboration *channels*/architecture). |
| 3 | No conflicting governance | **PASS** | All governance defers to one stack — Constitution → Master Blueprint → Operating Constitution/`ARCHITECT.md` → sprint criteria → verified behavior (DNA Ch 25.1). §IV-9, §IV-29, §IV-35–§IV-44 are consistent facets of that stack. |
| 4 | No conflicting authority | **PASS** | §IV-13/§IV-17/§IV-28/§IV-36 all resolve to the same standing overrides: deterministic engines own authoritative computation (Art. 6); the Human Principal is ultimate accountable at the high-consequence floor (DNA Ch 18.9); identity/governance stay with the Constitution + steward (DNA Ch 35). No competing authority claim exists. |
| 5 | No contradictions with Part I | **PASS** | Every CURRENT STATE claim traces to the recovered structural record (`ARCHITECT.md`, `architecture/system_map.json`, `src/`, `supabase/`, `memory/`). No claim contradicts Part I fact. |
| 6 | No contradictions with Part II | **PASS** | Part IV derives from and never overrides the DNA. The AI-company model is treated as approved-yet-progressive (DNA Ch 8.3); identity, authority doctrine, non-negotiables, and success test are cited and upheld throughout. |
| 7 | No contradictions with Part III | **PASS** | Part IV builds on Part III sections (e.g., §III-1/§III-15–§III-21/§III-39–§III-44/§III-81–§III-88) and never restates or contradicts them; organizational roles are explicitly kept distinct from the product RBAC roles of §III-42/§III-43. |
| 8 | CURRENT STATE is repository-grounded | **PASS** | Every section grounds CURRENT STATE in repository evidence or the LOCKED blueprint, tagged PROVEN/PARTIAL/DEBT (Phases 4.1–4.2) or IMPLEMENTED/PARTIAL/NOT IMPLEMENTED (Phases 4.3–4.5); 157 implementation-label usages; the AI workforce as runtime is consistently marked NOT IMPLEMENTED and tied to the reserved `ai_worker` *Future* identity. No invented capability. |
| 9 | APPROVED FUTURE STATE clearly identified | **PASS** | All 55 sections carry an explicit Approved Future State, marked additive and traced to Part II or the roadmap (DNA Ch 8.3, Ch 23). |
| 10 | Traceability is complete | **PASS** | All 55 sections close with a Traceability line to Part I, Part II, Part III, and the roadmap; all 55 carry Dependencies. |
| 11 | Cross references are valid | **PASS** | All §III-NN references fall within III-1..III-88; all §IV-NN references fall within IV-1..IV-55. No dangling reference. |
| 12 | Terminology is consistent | **PASS** | Canonical terms (AI Workforce, Intelligence Gateway, deterministic engines, high-consequence floor, Human Principal, Master Rule) used consistently. The two confidence-label conventions are each introduced in their phase reading notes and map cleanly (PROVEN≈IMPLEMENTED); this is documented, not drift. |
| 13 | AI governance aligns with the Constitution | **PASS** | §IV-28/§IV-29/§IV-33 encode the Human–AI Authority Doctrine (DNA Ch 18), deterministic authority (Art. 6/DNA Ch 17), explainability/auditability (DNA Ch 30.2), and the high-consequence floor (DNA Ch 18.9) without deviation (42 deterministic-authority references, 44 floor references). |
| 14 | Enterprise Operating Model internally consistent | **PASS** | §IV-35 operating model and §IV-44 governing principles are consistent with §IV-5/§IV-9/§IV-36–§IV-43 and with the maturity model (§IV-53) and excellence principles (§IV-54); invariants (single canonical authority, deterministic authority, human floor, simplicity under growth) hold across every stage. |
| 15 | Human responsibilities remain ultimate authority where required | **PASS** | Human Principal / MARQ Networks ultimate authority at the high-consequence floor is affirmed pervasively (§IV-13/§IV-17/§IV-20/§IV-26/§IV-27/§IV-28/§IV-36/§IV-40/§IV-44); "the workforce serves; it does not rule" (DNA Ch 18.8) is upheld throughout. |
| 16 | No implementation details accidentally entered | **PASS** | File-path citations appear only as CURRENT STATE *evidence* (the Part III convention), never as specifications. No prompts, tool definitions, APIs, schemas, dashboards, infrastructure, or numeric targets were introduced; each phase's exclusions were honored. |
| 17 | No missing enterprise concepts | **PASS** | The enterprise operating model — identity/philosophy, structure, AI workforce, governance, and performance/improvement — is complete at the architectural altitude. Departments' workflows, individual AI workers, KPIs, and implementation are deliberately deferred to later phases (not gaps). |
| 18 | No architectural drift | **PASS** | Part IV realizes exactly the AI-Workforce organizational model reserved for it in the document's front matter and DNA Ch 8, progressively and additively; no section drifts from identity (DNA Ch 8.3) or from the LOCKED Parts. |

**Audit outcome:** **18 / 18 PASS.**

### 4.6.3 — Gaps found and corrections

**No genuine architectural gap was discovered.** Accordingly, no corrective edits were made to §IV-1..§IV-55 (scope was not expanded and the architecture was not redesigned, per the phase mandate).

**One out-of-scope observation (recorded, not corrected).** The document front-matter status line reads "Part III IN PROGRESS · Parts IV–VI PLANNED." This line predates Part IV, lies outside the §IV-1..§IV-55 audit scope, and — by the convention established when Part III declared its own completion without editing the front matter — each Part declares status in its own completion/lock section. It is therefore left unchanged here under the append-only mandate; a future editorial correction to the shared header (a meaning-preserving change under DNA Ch 30.4) may reconcile it. This is a documentation-hygiene note, not an architectural gap in Part IV.

### 4.6.4 — Lock conditions confirmed

- ✓ Phase 4.1 complete (§IV-1–§IV-12)
- ✓ Phase 4.2 complete (§IV-13–§IV-22)
- ✓ Phase 4.3 complete (§IV-23–§IV-34)
- ✓ Phase 4.4 complete (§IV-35–§IV-45)
- ✓ Phase 4.5 complete (§IV-46–§IV-55)
- ✓ Continuous numbering (IV-1 → IV-55, no restart, no gap)
- ✓ CURRENT STATE verified (repository- or LOCKED-blueprint-grounded; labelled)
- ✓ APPROVED FUTURE STATE identified (every section)
- ✓ Traceability complete (every section; Parts I–III + roadmap)
- ✓ Cross references valid (all in range)
- ✓ Constitutional alignment confirmed (Part II / DNA + Operating Constitution)
- ✓ Product alignment confirmed (Part III)
- ✓ No unresolved architectural gaps

### 4.6.5 — Official Approval Record

| Field | Value |
|-------|-------|
| **Part** | Part IV — AI Company Architecture |
| **Scope** | Sections §IV-1 through §IV-55 (Phases 4.1–4.5) |
| **Version** | 1.0 |
| **Approval** | **APPROVED** |
| **Enterprise Architecture Review** | **PASS** |
| **AI Architecture Review** | **PASS** |
| **Repository Alignment** | **PASS** |
| **Executive Review** | **PASS** |
| **Audit checklist** | 18 / 18 PASS |
| **Steward** | MARQ Networks |
| **Status** | **LOCKED** |

### 4.6.6 — Immutability

**PART IV — AI COMPANY ARCHITECTURE — Status: LOCKED (Version 1.0, APPROVED).**

Part IV is now constitutionally settled. It is preserved as authored; §IV-1 through §IV-55 are not restated, summarized, or altered by any subsequent Part. Future modifications to Part IV may occur **only through the formal Amendment Process** (DNA Ch 35) — ordinary amendment for non-entrenched content, and the heightened core-amendment process (DNA Ch 35.5–35.6) where a change would touch the entrenched core (identity, non-negotiables, the Human–AI Authority Doctrine, data sovereignty, or *Maximum Intelligence, Minimum Complexity*). Every such change must be versioned, attributed, and logged (DNA Ch 30.4). A silent or unlogged edit to Part IV has no force.

### 4.6.7 — Continuity

Parts I, II, and III remain LOCKED and unchanged. Part IV is LOCKED as of this record. The Master Blueprint remains a single, continuous document; the next authoring phase is **Part V — Future Vision** (PLANNED), appended later with continuous numbering and formatting. **This phase does not begin Part V.**

*End of Part IV. Part IV is LOCKED.*

---

# PART V — PHASE 5: STRATEGIC FUTURE VISION

**Status:** IN PROGRESS · **Phase:** 5.1 — Vision & Strategic Direction · **Numbering:** Sections V-1 through V-10 · **Continuity:** this Part appends to the same Master Blueprint with continuous numbering and formatting; nothing is restarted or split.

## Reading conventions for Part V

Part V defines the **long-horizon strategic direction** of MARQ Cortex — where the company intends to go over the next decade. It is the approved future *direction*, not the plan to reach it. Roadmaps, milestones, delivery schedules, budgets, hiring, feature lists, and technical specifications are explicitly excluded from Part V and belong to **Part VI — Execution Roadmap**.

Part V is governed by Part II (the Constitution) and is subordinate to it. Every strategic statement in Part V traces back to a constitutional principle — most often the Purpose (DNA Ch 5), Mission (DNA Ch 6), Vision (DNA Ch 7), and Identity (DNA Ch 8/8.3) — and never contradicts them. Where Part V speaks of the future, it echoes and extends the already-ratified constitutional future; it does not invent a new one (Golden Rule 5).

Each section separates:

- **CURRENT STATE** — grounded in repository evidence or in previously LOCKED Blueprint (Parts I–III) and DNA. Confidence is tagged **IMPLEMENTED** (present and verifiable today), **PARTIAL** (present but incomplete or not authoritative), or **NOT IMPLEMENTED** (approved by identity/constitution but not yet built).
- **APPROVED FUTURE STATE** — the approved strategic direction, distinct from any execution plan.

Each section additionally answers the enterprise quality template used across this Blueprint: *Purpose · Why it exists · Scope · Current State · Approved Future State · Dependencies · Traceability.*

**Boundary note.** Part V describes intent and direction. When a reader wants "how" and "when," they are reaching for Part VI, which is PLANNED and not yet authored. Part V must never be read as authorization to build; it is authorization to *aim*.

---

## V-1 — Executive Vision

**Purpose.** Establish, at the highest altitude, why MARQ Cortex exists for the long term, the future impact it intends to create, and the aspiration that outlives any single release.

**Why it exists.** An enterprise needs one durable statement of intent that survives changes in market, technology, and roadmap. Without it, near-term decisions drift and the platform fragments into features (DNA Ch 33.3). The Executive Vision is the fixed point that every later Part orients toward.

**Scope.** The decade-horizon reason for Cortex's existence and the impact it intends to have on the businesses it serves. Not a roadmap, not features, not implementation.

**Why Cortex exists long-term.** Cortex exists to give every business — of any size, in any industry — access to an intelligent workforce that produces measurable business outcomes without requiring the business to manage complexity (DNA Ch 5). The long-term reason is unchanged from the Constitution: to close the permanent gap between the work a business needs done and the capable capacity available to do it, by being an AI company that works on behalf of other companies (DNA Ch 5, Ch 8.1).

**The future impact Cortex intends to create.** A world in which enterprise-grade thinking — historically reserved for organizations that could afford large teams of senior experts — is available to a first-time business owner within minutes (DNA Ch 5). Cortex intends to convert intelligence into outcomes at scale: time saved, money made or protected, decisions improved, risk reduced (DNA Ch 5), while carrying complexity inside the platform and returning simplicity to the customer (DNA Ch 5).

**The long-term aspiration.** That any business can hire a complete intelligent workforce as easily as it hires a single employee — a workforce that operates with the competence of a world-class company and the simplicity of a conversation (DNA Ch 7). The aspiration is deliberately ambitious in capability and deliberately humble in presentation: the measure is not how advanced Cortex becomes, but how effortless that advancement feels to the people it serves (DNA Ch 7).

**CURRENT STATE (PARTIAL).** The vision is expressed today in miniature and grounded in the LOCKED Blueprint: a working pipeline — public diagnostic funnel → readiness scoring → recommendation → ROI modeling → proposal governance/export → contract → post-sign execution → live ROI actuals → QBR — mobilizes coordinated engines and gateway-mediated AI narration behind a single, calm interface (§III-1, §III-3). The "workforce" is realized today as the deterministic engine orchestra plus AI narration, not yet as named executive/manager/worker runtime constructs (§III-1 CURRENT STATE; DNA Ch 8.3).

**APPROVED FUTURE STATE.** Progressive, additive realization of the full AI-company model as the enduring destination (DNA Ch 8.3, Ch 23): the platform deepens toward literal executives, departments, managers, and workers operating under governed authority, with compounding memory and progressive disclosure, without ever forcing the customer through complexity they did not ask for. The *direction* is approved here; the *sequence* is deferred to Part VI.

**Dependencies.** Part II (DNA Ch 5/6/7/8/8.3) as governing authority; Part III as the current-state record; Part VI (future) for execution.

**Traceability.** DNA Ch 5/7/8/8.3 · Objective: durable reason-for-being · Modules: all · Workflow: §III-28/29 (current expression) · Engines: `runCortexEngine` orchestra · AI: Intelligence Gateway (narration) · Roadmap: full-workforce realization (Part VI).

---

## V-2 — Strategic Mission

**Purpose.** State the long-term mission, the strategic objectives that carry it, and the enduring purpose beneath it — the horizon Cortex walks toward and why the horizon is worth reaching.

**Why it exists.** The Executive Vision (V-1) names the destination; the mission names the *commitments* that hold in every era of the product and keep the platform coherent as it grows (DNA Ch 6). It exists so strategy is expressed as durable commitments rather than shifting goals.

**Scope.** Mission commitments and strategic objectives at decade horizon. Not initiatives, not milestones, not delivery plans.

**Long-term mission.** To become the trusted digital workforce that businesses hire to run and grow their operations — delivering the coordinated intelligence of an entire company through an experience simple enough for anyone to use (DNA Ch 6).

**Strategic objectives (enduring commitments).**
- **Deliver a workforce, not a toolset.** Organize intelligence as executives, departments, managers, and workers so the customer receives coordinated output, not a pile of features to assemble (DNA Ch 6, Ch 8.1).
- **Produce measurable value, repeatedly.** Every engagement traces to outcomes the customer can see and verify (DNA Ch 6, Ch 33.2).
- **Make sophistication effortless.** Make complexity unnecessary for the customer rather than making the customer more capable of operating it (DNA Ch 6, Ch 11–14).
- **Earn and protect trust continuously.** Treat trust as the platform's most valuable and most fragile asset (DNA Ch 6, Ch 33.2 §3).
- **Scale across industries.** Keep the method — diagnose, quantify, prioritize, plan, execute, measure — industry-general (DNA Ch 6, Ch 31).

**Enduring purpose.** Beneath the mission lies the unchanging purpose: democratize enterprise-grade capability, convert intelligence into outcomes, and absorb complexity so the customer never has to (DNA Ch 5). Purpose is the deepest test; when valid options compete, the one that better serves purpose is chosen (DNA Ch 5, Ch 24).

**CURRENT STATE (PARTIAL).** The mission's commitments are partially realized and verifiable in the LOCKED Blueprint: measurable value is produced through deterministic ROI and outcome tracking (§III-21/25); coordinated output is produced by the engine orchestra (§III-21); trust is enforced through governance, explainability, and tenant isolation as designed, with several controls recorded as PARTIAL/DEBT (§III-31 onward). "A workforce, not a toolset" is expressed structurally but not yet as first-class workforce runtime roles (DNA Ch 8.3).

**APPROVED FUTURE STATE.** The mission holds unchanged as the long-term strategic direction; realization deepens additively toward the full workforce model and broader industry coverage, always keeping the experience simpler rather than more complex (DNA Ch 23). No new mission is introduced by Part V.

**Dependencies.** V-1 (Executive Vision); Part II (DNA Ch 5/6/24/31/33); Part III current-state evidence.

**Traceability.** DNA Ch 5/6/24/31/33 · Objective: durable mission commitments · Modules: all · Workflow: §III-29 · Engines: ROI/scoring/proposal engines · AI: gateway narration · Roadmap: industry/workforce expansion (Part VI).

---

## V-3 — Strategic Positioning

**Purpose.** Declare how Cortex intends to position itself globally — the single category it claims — so that market perception, product decisions, and communication align to one identity.

**Why it exists.** Positioning is where identity meets the market. A platform that positions itself as many things becomes none of them. This section records only the *approved* positioning and rejects the alternatives it is often mistaken for (DNA Ch 8.2).

**Scope.** The approved global positioning statement and the categories Cortex explicitly does not occupy. Not messaging campaigns, not go-to-market plans, not pricing.

**Approved strategic positioning.** Cortex is positioned as an **AI Workforce Platform** — an AI company that operates on behalf of businesses (DNA Ch 8.1; §III-1). This is the approved and permanent positioning. Among the candidate framings — *AI Company Platform*, *Enterprise AI Operating System*, *AI Workforce Platform*, *Enterprise Transformation Platform* — the ratified identity is the **AI Workforce Platform**; the others may describe facets of what Cortex enables, but the workforce framing is the one Cortex claims and defends.

**Positioning boundaries (what Cortex is NOT positioned as).** Not "just software," not "just a chatbot," not "just a CRM," not "just automation," not "just another SaaS tool," and never a single-industry tool (DNA Ch 8.2, Ch 32). A direction that makes any of these more true is unconstitutional and must be revised or rejected (DNA Ch 8.2).

**CURRENT STATE (PARTIAL).** The LOCKED Blueprint records the identity as an AI Workforce Platform while the shipped implementation presents as an "AI Readiness Diagnostic Platform" — the first faithful expression of the workforce model, not a competing position (§III-1; DNA Ch 8.3). The workforce positioning is therefore constitutionally IMPLEMENTED as identity and PARTIAL as realized runtime.

**APPROVED FUTURE STATE.** The AI Workforce Platform positioning holds and strengthens as the runtime model is progressively realized; market presentation converges on the workforce framing as capability catches up to identity (DNA Ch 8.3). Positioning is never rebranded away from the workforce model (DNA Ch 8.3, rule 2).

**Dependencies.** V-1/V-2; Part II (DNA Ch 8/8.2/8.3/32); §III-1 identity record.

**Traceability.** DNA Ch 8/8.2/8.3/32 · Objective: one defended category · Modules: all · Workflow: §III-1 · Engines: n/a (identity) · AI: n/a · Roadmap: positioning convergence (Part VI).

---

## V-4 — North Star

**Purpose.** Define the single long-term guiding objective that acts as the decision filter and enterprise compass whenever direction is uncertain.

**Why it exists.** Strategy needs one tie-breaker. When two valid options compete, teams need a fixed reference that decides — not by opinion, but by principle (DNA Ch 24/25). The North Star is that reference.

**Scope.** The one guiding objective and how it is applied as a filter. Not a scorecard, not KPIs (those derive downstream and belong to measurement, not to the North Star statement).

**Long-term guiding objective.** **Trust earned through measurable outcomes delivered with effortless simplicity.** Trust is the north-star metric of the Constitution: when it falls, nothing else compensates (DNA Ch 33.2 §3). The guiding objective binds three inseparable things — outcomes that are real and measurable, trust that is earned and protected, and simplicity that never degrades as capability grows.

**Decision filter.** Every strategic choice is filtered through the Success Principle (DNA Ch 33.1 / Ch 24): does it align with the DNA, create measurable business value, strengthen the AI Workforce model, avoid unnecessary duplication, maintain simplicity, and increase enterprise trust? If the answer is *no* to any, the direction is revised before it is pursued.

**Enterprise compass.** When altitude or ambiguity makes a decision hard, the compass points to purpose (DNA Ch 5): the option that better democratizes capability, better converts intelligence into outcomes, and better absorbs complexity on the customer's behalf is the chosen direction.

**CURRENT STATE (IMPLEMENTED, as governance).** The North Star's decision filter is already operative as the LOCKED constitutional decision gate (DNA Ch 24; §III-84 decision framework) and is applied in the Blueprint's own authoring discipline (reality-first, traceability, no invention). It is IMPLEMENTED as a governance instrument; it is NOT IMPLEMENTED as an automated, instrumented compass surfaced in-product.

**APPROVED FUTURE STATE.** The North Star remains the fixed decision filter for all future Parts and directions; over the horizon it is increasingly reflected in how Cortex itself explains and governs its decisions (auditable, explainable, permission-bounded), consistent with DNA Ch 30. The *statement* is approved; instrumentation is Part VI.

**Dependencies.** V-1/V-2; Part II (DNA Ch 5/24/25/33); §III-84 decision framework.

**Traceability.** DNA Ch 5/24/25/33 · Objective: one tie-breaking compass · Modules: all · Workflow: §III-84 · Engines: deterministic engines (value), governance · AI: narration (explainability) · Roadmap: instrumented decision registry (Part VI).

---

## V-5 — Strategic Principles

**Purpose.** Record the high-level principles that govern future strategic decisions, so that direction stays coherent across a decade of change.

**Why it exists.** Principles are the compression of the Constitution into decision-usable rules. They let independent teams make aligned choices without re-deriving the DNA each time (DNA Ch 27).

**Scope.** Enduring governing principles for future decisions. Not policies, not procedures, not controls (those are downstream).

**Governing strategic principles.**
- **Customer-first.** The customer's outcome and experience outrank internal preference; complexity belongs inside the platform, simplicity belongs to the customer (DNA Ch 5/11).
- **AI-first, math-authoritative.** Intelligence is organized as an AI workforce, but authoritative numbers are produced by deterministic engines and AI narrates them — *math decides; AI narrates* (DNA Ch 17; §III-1).
- **Human accountability.** Cortex never claims autonomy beyond granted authority; high-consequence decisions keep a human in control (DNA Ch 18/30).
- **Trust above all.** Security, tenant isolation, transparency, explainability, and honesty are never traded for speed, convenience, or short-term revenue (DNA Ch 29/30/33.3).
- **Long-term thinking.** Decisions are judged by durable purpose-fulfillment, not by feature count or novelty (DNA Ch 33.3).
- **Sustainable growth.** Capability compounds while experienced complexity does not; the platform grows additively and never rebuilds without cause or drifts beyond scope (DNA Ch 22/23).
- **Industry-general method.** The diagnose→measure method stays general; the platform is never narrowed to a single vertical (DNA Ch 31/32).

**CURRENT STATE (IMPLEMENTED, as constitution).** These principles are LOCKED in Part II and are already the governing standard used throughout Part III's traceability lines (e.g., "math decides / AI narrates," tenant isolation, additive change control). They are IMPLEMENTED as governance; their in-product enforcement is IMPLEMENTED in parts and PARTIAL/DEBT in others per §III-31 onward.

**APPROVED FUTURE STATE.** The principles are permanent and govern every future Part unchanged; future work operationalizes them further (e.g., enforced RBAC, unified audit, drift detection are approved *directions* here and sequenced in Part VI). Part V adds no new principle beyond the constitutional set.

**Dependencies.** Part II (DNA Ch 11/17/18/22/23/27/29/30/31/32/33); §III-31–§III-86 (current enforcement evidence).

**Traceability.** DNA Ch 17/18/22/23/27/29/30/33 · Objective: aligned autonomous decisions · Modules: all · Workflow: §III-84/85 · Engines: deterministic engines + governance · AI: gateway narration · Roadmap: enforcement operationalization (Part VI).

---

## V-6 — Future Customer Vision

**Purpose.** Describe the long-term customer relationship, the outcomes customers experience, and the transformation Cortex intends to enable — expressed as relationship and outcome, not as features.

**Why it exists.** Strategy must be anchored in what changes for the customer, not in what the platform contains. This section keeps the vision honest by describing the future in the customer's terms (DNA Ch 33.2).

**Scope.** Future customer relationships, outcomes, and transformation. Explicitly not features, screens, or capabilities.

**Future customer relationships.** The customer relates to Cortex as a **hired workforce and long-term partner**, not as a tool they operate. Over time the relationship compounds: Cortex remembers the business, so each engagement makes the next one sharper, and value grows with the length of the relationship (DNA Ch 19; Ch 33.2 §6/§8). The customer describes a goal in natural language and an AI organization mobilizes around it, while the machinery stays invisible (DNA Ch 7).

**Customer outcomes.** Customers can trace Cortex's work to real, measurable value — time saved, money made or protected, decisions improved, risk reduced (DNA Ch 33.2 §1). First-time, non-technical customers reach confident first results quickly, and the experience stays simple as their needs grow (DNA Ch 33.2 §2/§5).

**Customer transformation.** A business moves from *not knowing what to do* to *knowing, deciding, and executing with confidence* — from ad-hoc effort to a governed, measured operating rhythm — without having to build internal expertise or absorb platform complexity. The transformation is from operating alone to operating with a trusted intelligent workforce.

**CURRENT STATE (PARTIAL).** The LOCKED Blueprint already delivers a partial form of this relationship: a prospect becomes a diagnosed, quantified, proposed, contracted, executing, and measured customer through one governed pipeline (§III-28/29), with ROI actuals and QBR closing the outcome loop (§III-21/25). Compounding memory across engagements and natural-language mobilization are NOT IMPLEMENTED as runtime (DNA Ch 8.3/15/19).

**APPROVED FUTURE STATE.** The relationship deepens toward a durable, memory-compounding partnership with natural-language (later voice/multimodal) interaction, always in service of the same simplicity (DNA Ch 7/15/16/19). The customer's *experience* of transformation is approved here; the surfaces that deliver it are Part VI.

**Dependencies.** V-1/V-2/V-4; Part II (DNA Ch 7/15/16/19/33); §III-21/25/28/29 (current outcome loop).

**Traceability.** DNA Ch 7/15/16/19/33 · Objective: compounding customer partnership · Modules: diagnostic/proposal/execution/outcomes · Workflow: §III-28/29 · Engines: ROI/actuals/QBR · AI: narration; future NL interface · Roadmap: memory + NL/voice (Part VI).

---

## V-7 — Future Enterprise Vision

**Purpose.** Describe the long-term enterprise MARQ Cortex intends to become — as an architecture of the organization, not as an org chart, hiring plan, or delivery schedule.

**Why it exists.** The platform's identity is an AI company; the enterprise vision states what kind of enterprise realizes that identity durably (DNA Ch 8/8.3). It keeps future structural direction aligned to identity.

**Scope.** The architectural shape of the future enterprise. Not departments-to-hire, not budgets, not staffing — those are execution (Part VI).

**Future enterprise (architecture only).**
- **AI-native organization.** Cortex's own operating model reflects its product: intelligence organized as executives, departments, managers, and workers, coordinated by governance, with deterministic engines owning the math and reasoning systems owning explanation (DNA Ch 8.1). The enterprise is AI-native by identity, realized progressively (DNA Ch 8.3).
- **Platform ecosystem.** A provider-agnostic Intelligence Gateway and a component/manifest architecture position Cortex as a platform others extend, rather than a closed application (§III-17/26; §III-1). The long-term shape is an ecosystem with governed extension points, never at the cost of tenant isolation or governance (DNA Ch 20/29/30).
- **Global enterprise.** An enterprise capable of serving businesses across industries and regions under one general method and one governance model (DNA Ch 31; V-8).

**CURRENT STATE (PARTIAL / NOT IMPLEMENTED).** IMPLEMENTED: provider-agnostic gateway and a manifest/component architecture (§III-17/26; §III-1). PARTIAL: multi-tenant foundation with isolation and RBAC recorded as designed with enforcement gaps (§III-41–§III-45). NOT IMPLEMENTED: named AI executive/manager/worker runtime roles as first-class constructs, and a formal external extension ecosystem (DNA Ch 8.3; §III-1 CURRENT STATE).

**APPROVED FUTURE STATE.** Cortex becomes a progressively AI-native, ecosystem-capable, globally-serving enterprise whose internal architecture mirrors the workforce it sells — additively, never by rebuild or rebrand (DNA Ch 8.3/22/23). The architectural *direction* is approved; structural execution is Part VI.

**Dependencies.** V-1/V-3; Part II (DNA Ch 8/8.3/20/29/30/31); §III-1/17/26/41–45.

**Traceability.** DNA Ch 8/8.3/20/29/30/31 · Objective: identity-consistent enterprise architecture · Modules: gateway/manifest/tenancy · Workflow: §III-17/26/41 · Engines: repositories/gateway · AI: gateway · Roadmap: workforce runtime + ecosystem (Part VI).

---

## V-8 — Future Market Vision

**Purpose.** Document the markets, industries, and global reach Cortex intends to serve, and its long-term market positioning.

**Why it exists.** Scope generality is a constitutional commitment (DNA Ch 31/32). The market vision states how far that generality is intended to reach, so the platform is never accidentally narrowed to a single vertical.

**Scope.** Long-term market direction: industries, breadth, and reach. Not target-account lists, not pricing, not sales plans.

**Markets and industries.** Cortex intends to serve businesses **across industries** with one general method — diagnose, quantify, prioritize, plan, execute, measure — expressed through industry-specific questionnaires and rule packs while keeping the underlying method general (DNA Ch 31; §III-2/§III-54). Specific industry expressions are welcome; narrowing the platform to a single industry is not (DNA Ch 31/32).

**Global reach.** Cortex intends to serve businesses of any size, from a first-time owner's first diagnostic to a large enterprise's full operational platform, and across regions — under one governance and data-stewardship model that respects tenant isolation and data sovereignty (DNA Ch 19/20; §III-44). Global reach is bounded by the trust and security commitments, which are never traded for expansion (DNA Ch 32).

**Long-term positioning in the market.** As the **AI Workforce Platform** category leader (V-3): the enterprise that businesses hire as their intelligent workforce, distinguished not by feature count but by measurable outcomes, trust, and effortless simplicity (DNA Ch 33). Breadth across industries — without abandoning the general method — is itself a constitutional success dimension (DNA Ch 33.2 §9).

**CURRENT STATE (PARTIAL).** IMPLEMENTED: industry-selectable diagnostic and a general method that already spans verticals structurally (§III-2/§III-5). PARTIAL: industry rule packs and multi-region data-sovereignty tooling recorded as approved future/DEBT in Part III (§III-44/§III-54). NOT IMPLEMENTED: broad multi-industry rollout and formal global market presence.

**APPROVED FUTURE STATE.** Expansion across industries and regions under the same general method and governance model, keeping generality and trust intact as reach grows (DNA Ch 31/32/33). The market *direction* is approved; sequencing, prioritization, and go-to-market are Part VI.

**Dependencies.** V-2/V-3; Part II (DNA Ch 19/20/31/32/33); §III-2/44/54.

**Traceability.** DNA Ch 19/20/31/32/33 · Objective: industry-general global reach · Modules: diagnostic/rules/tenancy · Workflow: §III-2/29 · Engines: scoring/rule packs · AI: gateway · Roadmap: industry/region expansion (Part VI).

---

## V-9 — Vision Success Principles

**Purpose.** Define how the success of this vision will be *judged* — the qualitative dimensions that determine whether Cortex is fulfilling its purpose. No metrics.

**Why it exists.** Success must be defined before it is pursued, and it must be defined by purpose-fulfillment rather than by feature accumulation (DNA Ch 33). This section fixes the standard so later measurement (Part VI) instruments the right things.

**Scope.** The qualitative principles by which vision success is judged. Explicitly **no metrics, no KPIs, no targets** — those derive downstream and belong to execution.

**How success will be judged.**
- **Customer impact.** Customers can trace Cortex's work to real business value; the vision succeeds only if outcomes are real and visible (DNA Ch 33.2 §1).
- **Trust.** Customers trust what Cortex tells them and what it is allowed to do; trust is the paramount judgment and, when it falls, nothing else compensates (DNA Ch 33.2 §3).
- **Quality.** Explainability, auditability, permission-boundedness, transparency, and security hold or improve as the platform grows (DNA Ch 33.2 §7).
- **Sustainability.** Capability compounds while experienced complexity does not; growth is additive and durable, and relationships deepen over time (DNA Ch 33.2 §5/§8; Ch 23).
- **Innovation.** Innovation is judged by whether it strengthens the AI Workforce model and serves purpose — never by novelty or spectacle for its own sake (DNA Ch 33.2 §4; Ch 33.3).

**What is explicitly NOT success.** Feature count, technological novelty, interface spectacle, engagement for its own sake, and short-term revenue extracted at the cost of trust are not measures of success (DNA Ch 33.3). A standard that rewards complexity, opacity, or trust-erosion is contrary to the Constitution and must not govern the vision.

**CURRENT STATE (IMPLEMENTED, as standard).** These judgment principles are LOCKED in Part II (DNA Ch 33) and already govern Part III's success and governance sections (§III-81/82/83). They are IMPLEMENTED as the standard; their *instrumentation* into operational measures is NOT IMPLEMENTED here and is reserved for Part VI (metric definitions are excluded from Part V by rule).

**APPROVED FUTURE STATE.** The judgment principles remain permanent; future work instruments them into concrete, honest measures without ever letting a metric replace the constitutional dimension it serves (DNA Ch 33; §III-81). Part V defines the standard; Part VI defines the measurement.

**Dependencies.** V-1/V-2/V-4; Part II (DNA Ch 23/33); §III-81/82/83 (current success framing).

**Traceability.** DNA Ch 23/33 · Objective: purpose-based success standard · Modules: analytics/governance · Workflow: §III-81/82/83 · Engines: aggregation (future instrumentation) · AI: narration · Roadmap: metric definitions (Part VI).

---

## V-10 — Phase Summary

**Purpose.** Close Phase 5.1 by consolidating its purpose, key decisions, current state, approved future state, dependencies, and traceability into one enterprise summary.

**Purpose of Phase 5.1.** To define the long-term strategic direction of MARQ Cortex — the decade-horizon vision, mission, positioning, North Star, principles, and success standard — as approved *direction*, strictly separated from any roadmap, plan, or implementation (which belong to Part VI).

**Key Decisions.**
1. The Executive Vision and Strategic Mission are ratified unchanged from Part II and restated at strategic altitude, not reinvented (V-1/V-2; Golden Rule 5).
2. The approved global positioning is the **AI Workforce Platform** — one defended category, with explicit non-positions (V-3).
3. The North Star is **trust earned through measurable outcomes delivered with effortless simplicity**, applied via the constitutional decision filter (V-4).
4. Seven strategic principles govern future decisions (V-5); the future enterprise is AI-native, ecosystem-capable, and global by architecture (V-7); the market vision is industry-general and global under one governance model (V-8).
5. Vision success is judged by customer impact, trust, quality, sustainability, and innovation — **no metrics** (V-9).

**Current State.** Grounded in the LOCKED Blueprint and repository evidence: the vision is expressed in miniature by a working, governed pipeline with deterministic engines and gateway-mediated narration (IMPLEMENTED in part), a multi-tenant foundation and provider-agnostic architecture (PARTIAL), and named workforce runtime roles, compounding memory, natural-language interaction, and broad multi-industry/global rollout (NOT IMPLEMENTED). Every current-state claim traces to Part III or Part II.

**Approved Future State.** Progressive, additive realization of the full AI-company model — deeper workforce runtime, compounding memory, natural-language then voice/multimodal interaction, industry and regional breadth, and an ecosystem architecture — all under unchanged identity, principles, and success standard (DNA Ch 7/8.3/15/19/23/31/33). Direction is approved; sequencing is deferred to Part VI.

**Dependencies.** Part II (Constitution) as governing authority; Part III as the current-state record and evidence base; Part IV — AI Company Architecture (LOCKED) as the authored organizational architecture and Part VI — Execution Roadmap (PLANNED) as the Part that will realize this vision. Part V never authorizes building; it authorizes aiming.

**Traceability.** DNA Ch 5/6/7/8/8.3/15/17/18/19/20/22/23/24/25/27/29/30/31/32/33 · Objective: approved long-horizon strategic direction · Modules: all · Workflow: §III-28/29 (current expression) · Engines: deterministic engine orchestra · AI: Intelligence Gateway (narration) · Roadmap: Part VI (PLANNED); Part IV LOCKED.

---

*End of Phase 5.1 (Sections V-1 through V-10). Part V is IN PROGRESS and is not reviewed or locked in this phase. Phase 5.2 is not begun.*

---

## Phase 5.2 — Product & Platform Evolution

**Status:** IN PROGRESS · **Phase:** 5.2 — Product & Platform Evolution · **Numbering:** Sections V-11 through V-20 (continuing Part V numbering) · **Continuity:** appends after Phase 5.1 with continuous numbering and formatting; the Part V reading conventions (above) govern this phase unchanged.

*This phase defines the long-horizon evolution of the Cortex product and platform as approved strategic **direction** — how the product deepens and the platform matures toward the constitutional identity — without roadmaps, feature lists, timelines, budgets, or implementation. It sits between the vision fixed in Phase 5.1 and the innovation/leadership direction of Phase 5.3. Everything here echoes and extends the already-ratified future (Parts II and IV); it invents no new destination (Golden Rule 5).*

---

## V-11 — Product Evolution Philosophy

**Purpose.** State the enduring principles by which the Cortex product evolves, so that a decade of change compounds capability without ever compromising identity or simplicity.

**Why it exists.** A product that evolves without a philosophy accretes features and loses coherence (DNA Ch 33.3). The evolution philosophy fixes *how* change is allowed to happen, so growth strengthens the AI Workforce rather than fragmenting it.

**Scope.** The principles governing product evolution. Not the roadmap, not the features, not the sequence — those are Part VI.

**Evolution principles.**
- **Additive, never disruptive.** Every advance is additive and must keep the experience simpler, not more complex (DNA Ch 23; §III-3 business rule). Cortex does not rebuild without cause or drift beyond scope (DNA Ch 22).
- **Identity-preserving.** Each step traces back to the ratified identity — an AI company operating on behalf of businesses (DNA Ch 8.1; §III-1) — and makes no statement in DNA Ch 8.1 less true or any in Ch 8.2 more true.
- **Simplicity as a constraint on growth.** Capability may compound while the customer's experienced complexity does not (DNA Ch 33.2 §5; Ch 11–14).
- **Reality-first.** Evolution is documented before it is built; nothing enters the product without passing the decision framework (DNA Ch 24; §III-2 business rule).

**CURRENT STATE (IMPLEMENTED, as discipline).** These principles are already operative: Part III documents the product reality-first and separates CURRENT from APPROVED FUTURE STATE throughout; Part IV Phase 4.5 ratified a continuous-improvement philosophy (§IV-46, §IV-52). The discipline is IMPLEMENTED; the deeper product it governs is realized only in part (§III-1).

**APPROVED FUTURE STATE.** The philosophy is permanent and governs all subsequent product evolution; the product deepens toward the full workforce model additively (DNA Ch 8.3, Ch 23). Direction is approved here; sequence is Part VI.

**Dependencies.** Part II (DNA Ch 8/11–14/22/23/33); Part III (§III-1/2/3); Part IV (§IV-46/52); Phase 5.1 (V-1/V-5).

**Traceability.** DNA Ch 8/22/23/33 · Part IV §IV-46/52 · Objective: coherent, identity-preserving growth · Modules: all · Workflow: §III-29 · Engines: all deterministic · AI: gateway narration · Roadmap: additive evolution (Part VI).

---

## V-12 — Platform Architecture Evolution

**Purpose.** Describe the long-horizon direction of the platform's architecture — how the technical foundation matures — at the level of architectural principle, not implementation.

**Why it exists.** The product's future depends on a foundation that can grow without redesign (§III-37). This section fixes the architectural direction so the platform scales toward the workforce model without rebuild.

**Scope.** Architectural direction only: authority of the data foundation, provider-agnostic intelligence, modularity, and separation of deterministic computation from narration. No schemas, no migrations, no code, no timelines.

**Architectural evolution direction.**
- **Toward relational authority.** The runtime store is KV-authoritative today with a relational foundation present but not yet authoritative; the approved direction is per-domain cutover to relational authority without a big-bang rewrite (§III-1, §III-37).
- **Provider-agnostic intelligence, permanently.** The Intelligence Gateway keeps intelligence swappable and governed; the platform never couples its correctness to a single provider (§III-1, §III-17; DNA Ch 17).
- **Deterministic core, narrated surface.** The separation "math decides; AI narrates" is architectural and endures: authoritative numbers come from deterministic engines, AI explains them (§III-1, §III-21; DNA Ch 17).
- **Modular, manifest-governed composition.** The component/manifest architecture (a registry of nodes) remains the way capability is composed and governed as it grows (§III-1; Part IV §IV-10 enterprise architecture principles).

**CURRENT STATE (PARTIAL).** IMPLEMENTED: provider-agnostic gateway (OpenAI + mock), deterministic engine orchestra, and a manifest/component registry (§III-1). PARTIAL: relational foundation exists but KV remains authoritative (§III-1, §III-37). NOT IMPLEMENTED: full relational authority across domains.

**APPROVED FUTURE STATE.** The foundation matures to relational authority per domain, keeps intelligence provider-agnostic, and preserves the deterministic-core/narrated-surface split as it scales (§III-37; DNA Ch 17/20/23). Architectural direction only; execution is Part VI.

**Dependencies.** Part III (§III-1/17/21/37/38); Part IV (§IV-10); DNA Ch 17/20/23.

**Traceability.** DNA Ch 17/20/23 · Part IV §IV-10 · Objective: growth without redesign · Modules: edge/data/engines/gateway · Workflow: §III-37 · Engines: repositories, orchestra · AI: gateway · Roadmap: relational cutover, scale (Part VI).

---

## V-13 — AI Workforce Realization Evolution

**Purpose.** Describe the long-horizon direction by which the AI Workforce advances from today's engine-and-narration expression toward first-class executive/manager/worker constructs.

**Why it exists.** The workforce model is the constitutional destination (DNA Ch 8.1/8.3) and is architected in Part IV; this section states the *evolutionary direction* of its realization, keeping identity and honest present-state in view at once (DNA Ch 8.3).

**Scope.** The direction of workforce realization as architecture and identity. Not agent implementation, not runtime engineering, not role staffing.

**Realization direction.**
- **From orchestra to organization.** Today's coordinated deterministic engines plus gateway narration evolve toward named AI executives, departments, managers, and workers operating within governed authority bounds (Part IV §IV-13/§IV-23/§IV-24; DNA Ch 8.1, Ch 18).
- **Authority-bounded throughout.** Every increment keeps humans in control of high-consequence decisions and never claims autonomy beyond granted permission (Part IV §IV-28; DNA Ch 18).
- **Progressive, never a rebrand.** Realization is additive and traces to identity; naming a construct commits Cortex to realizing it genuinely, not to asserting it is already complete (DNA Ch 8.3, rule 2).

**CURRENT STATE (NOT IMPLEMENTED as runtime; IMPLEMENTED as architecture).** The workforce is expressed today as the engine orchestra plus AI narration (§III-1, §III-21); named executive/manager/worker runtime constructs are NOT IMPLEMENTED (DNA Ch 8.3; the data platform records `ai_worker` identity as *Future* — §III-1). The organizational architecture that governs their future realization IS authored and LOCKED in Part IV (§IV-13…§IV-34).

**APPROVED FUTURE STATE.** Progressive realization of the full workforce as first-class, governed runtime constructs, built additively on the Part IV architecture (DNA Ch 8.3, Ch 23). Direction approved here; sequencing is Part VI.

**Dependencies.** Part IV (§IV-13/23/24/28); Part III (§III-1/21); DNA Ch 8.1/8.3/18/23.

**Traceability.** DNA Ch 8.1/8.3/18/23 · Part IV §IV-13/23/28 · Objective: realize the workforce, governed and additive · Modules: engines/gateway/governance · Workflow: §III-29 · Engines: orchestra · AI: gateway · Roadmap: workforce runtime (Part VI).

---

## V-14 — Interaction Evolution Vision

**Purpose.** Describe how the customer's way of interacting with Cortex evolves over the long horizon, always in service of the same simplicity.

**Why it exists.** Interaction is where sophistication either becomes effortless or becomes burden. The Constitution fixes an interaction roadmap (DNA Ch 15–16); this section carries it as strategic direction without specifying surfaces or timelines.

**Scope.** The direction of interaction evolution as experience. Not UI specifications, not voice engineering, not release timing.

**Interaction direction.**
- **GUI → natural language → voice → multimodal.** Interaction advances along the constitutional sequence, each stage in service of the same calm simplicity (DNA Ch 15; §III-3).
- **Voice deferred until maturity.** Voice is approved in direction but deliberately deferred until production maturity (DNA Ch 16; §III-3).
- **Simplicity is invariant.** Every interaction advance must keep the experience simpler, never add cognitive load without measurable benefit (DNA Ch 11–14, Ch 32 experience boundaries).

**CURRENT STATE (PARTIAL).** IMPLEMENTED: a single, calm graphical interface with a guided pipeline and a global/assistive AI surface (§III-1, §III-3). PARTIAL/NOT IMPLEMENTED: natural-language mobilization of the workforce is not the primary interaction; voice and multimodal are NOT IMPLEMENTED (DNA Ch 15/16; §III-3 APPROVED FUTURE STATE).

**APPROVED FUTURE STATE.** Interaction deepens toward natural language and later voice/multimodal, always subordinate to simplicity (DNA Ch 15/16). Direction approved; surfaces and timing are Part VI.

**Dependencies.** Part III (§III-1/3/27); DNA Ch 11–16, Ch 32; Phase 5.1 (V-6).

**Traceability.** DNA Ch 11–16/32 · Objective: effortless interaction at every stage · Modules: UI/routing/gateway · Workflow: §III-28 · Engines: n/a · AI: gateway (NL) · Roadmap: NL → voice → multimodal (Part VI).

---

## V-15 — Intelligence & Reasoning Evolution

**Purpose.** Describe the long-horizon direction of Cortex's intelligence and reasoning — how it grows more capable while remaining governed, explainable, and subordinate to authoritative math.

**Why it exists.** Intelligence is the platform's differentiator and its greatest governance risk. This section fixes how reasoning may deepen without ever overriding the deterministic core or eroding trust (DNA Ch 17).

**Scope.** The direction of intelligence and reasoning as principle. Not model selection, not prompts, not provider procurement, not benchmarks.

**Intelligence evolution direction.**
- **Math decides; AI narrates — permanently.** Reasoning grows richer but never becomes authoritative over the deterministic engines; AI explains, translates, and recommends, and does not override governed math (DNA Ch 17; §III-1/21).
- **Provider-agnostic and swappable.** Capability advances by improving the gateway and its governance, never by coupling correctness to one provider (§III-17; DNA Ch 17).
- **Explainable by construction.** As reasoning deepens, explainability, auditability, and permission-boundedness hold or improve (DNA Ch 30; Part IV §IV-29/§IV-33).

**CURRENT STATE (PARTIAL).** IMPLEMENTED: gateway-mediated narration over deterministic engines with provider-agnostic routing (§III-1, §III-17). PARTIAL: explainability/audit surfaces exist in parts and are recorded as maturing (§III-64/§III-65). NOT IMPLEMENTED: richer multi-role reasoning tied to the future workforce (DNA Ch 8.3).

**APPROVED FUTURE STATE.** Reasoning deepens under the same governance — narrating, never overriding; provider-agnostic; explainable — consistent with Part IV's AI governance and safety principles (§IV-29/§IV-33; DNA Ch 17/30). Direction approved; implementation is Part VI.

**Dependencies.** Part III (§III-1/17/21/64/65); Part IV (§IV-29/31/33); DNA Ch 17/30.

**Traceability.** DNA Ch 17/30 · Part IV §IV-29/31/33 · Objective: capable, governed, explainable intelligence · Modules: intelligence/gateway/engines · Workflow: §III-29 · Engines: orchestra · AI: gateway · Roadmap: reasoning depth under governance (Part VI).

---

## V-16 — Memory & Knowledge Evolution

**Purpose.** Describe the long-horizon direction for how Cortex remembers each business so its judgment compounds over time — as stewardship principle, not storage design.

**Why it exists.** Compounding memory is what turns Cortex from a tool into a partner whose value grows with the relationship (DNA Ch 19; Ch 33.2 §6). This section fixes the direction while protecting the trust that memory puts at stake.

**Scope.** The direction of memory and knowledge as stewardship. Not database design, not retention schedules, not vendor storage.

**Memory evolution direction.**
- **Compounding judgment.** Cortex's understanding of each business deepens over engagements, so value grows with the length of the relationship (DNA Ch 19; Ch 33.2 §6/§8).
- **Memory in service of the customer, never against them.** Cortex will not use its memory of a business against that business; memory is stewarded under tenant isolation and data sovereignty (DNA Ch 19/20, Ch 32 trust boundaries).
- **Governed knowledge.** Knowledge is retained, curated, and governed consistent with Part IV's knowledge-governance and AI memory principles (§IV-32/§IV-42).

**CURRENT STATE (PARTIAL / NOT IMPLEMENTED).** IMPLEMENTED (system memory): the platform keeps engineering memory artifacts (`memory/failure_library.md`, `memory/regression_cases.md`) and immutable proposal snapshots (§III-29). PARTIAL: per-business persistence exists through the KV store and outcomes (§III-1, §III-25). NOT IMPLEMENTED: compounding, cross-engagement business memory as a governed workforce capability (DNA Ch 8.3/19).

**APPROVED FUTURE STATE.** Memory matures into compounding, governed business knowledge that sharpens judgment over time, always under isolation and sovereignty (DNA Ch 19/20; Part IV §IV-32/§IV-42). Direction approved; implementation is Part VI.

**Dependencies.** Part III (§III-1/25/29/44); Part IV (§IV-32/42); DNA Ch 19/20/32.

**Traceability.** DNA Ch 19/20/32 · Part IV §IV-32/42 · Objective: compounding, trustworthy memory · Modules: data/outcomes/knowledge · Workflow: §III-30 · Engines: repositories · AI: n/a (stewardship) · Roadmap: business memory (Part VI).

---

## V-17 — Data Platform Evolution

**Purpose.** Describe the long-horizon direction of the data platform — the foundation of trust and correctness — as architectural principle.

**Why it exists.** Every outcome, memory, and audit rests on the data platform. Its evolution must preserve isolation, sovereignty, and integrity as it scales (DNA Ch 20). This section fixes that direction without prescribing schemas or migrations.

**Scope.** Data-platform direction only: authority, isolation, sovereignty, integrity, and recoverability as principles. No table designs, no migration scripts, no timelines.

**Data evolution direction.**
- **Relational authority, per-domain.** The data foundation matures from KV-authoritative to relational-authoritative through governed, per-domain cutover, never a big-bang rewrite (§III-1, §III-37/38).
- **Isolation and sovereignty are invariant.** Tenant isolation and data sovereignty hold or strengthen as the platform grows; they are never traded for speed or convenience (DNA Ch 19/20, Ch 32; §III-44/45).
- **Integrity and recoverability.** Correctness, auditability, backup, and recovery mature alongside authority (§III-66/67; Part IV §IV-40 security governance).

**CURRENT STATE (PARTIAL).** IMPLEMENTED: KV-authoritative runtime store with tenant scoping and a relational foundation present (§III-1, §III-41–45). PARTIAL: relational authority and full data-sovereignty/DSR tooling are recorded as approved-future/DEBT (§III-37, §III-44). NOT IMPLEMENTED: relational store as system of record across domains.

**APPROVED FUTURE STATE.** The data platform reaches relational authority per domain while strengthening isolation, sovereignty, integrity, and recoverability (§III-37; DNA Ch 20). Architectural direction only; execution is Part VI.

**Dependencies.** Part III (§III-1/37/38/41–45/66/67); Part IV (§IV-40); DNA Ch 19/20/32.

**Traceability.** DNA Ch 19/20/32 · Part IV §IV-40 · Objective: trustworthy, sovereign, scalable data · Modules: data/tenancy · Workflow: §III-37 · Engines: repositories, migration engine · AI: n/a · Roadmap: relational authority, sovereignty tooling (Part VI).

---

## V-18 — Ecosystem & Extensibility Evolution

**Purpose.** Describe the long-horizon direction by which Cortex becomes a platform others can extend — an ecosystem — without ever weakening governance or isolation.

**Why it exists.** A durable platform grows through governed extension, not a closed monolith (§III-17/26). This section fixes the ecosystem direction while keeping the trust and integrity boundaries absolute (DNA Ch 22/29/30).

**Scope.** Ecosystem and extensibility as architectural direction. Not partner programs, not marketplaces, not integration engineering, not vendor selection.

**Ecosystem evolution direction.**
- **Governed extension points.** Capability is composed through the manifest/component architecture and integrated through the provider-agnostic gateway, so extension is governed rather than ad hoc (§III-1/17/26).
- **Integrity boundaries hold.** Extensibility never permits AI to override authoritative math, never duplicates capability unnecessarily, and never weakens tenant isolation or governance (DNA Ch 22/29; §III-45).
- **Interoperability by design.** The platform favors clean interfaces and standards so it can interoperate without coupling correctness to any external system (Part IV §IV-10).

**CURRENT STATE (PARTIAL / NOT IMPLEMENTED).** IMPLEMENTED: provider-agnostic gateway and manifest-composed capability enable governed extension internally (§III-1/17/26). PARTIAL: external integration surfaces exist narrowly (intelligence/email/auth) (§III-36). NOT IMPLEMENTED: a formal external extension ecosystem or partner-facing extension surface.

**APPROVED FUTURE STATE.** Cortex matures into an ecosystem with governed extension points and strong interoperability, never at the cost of governance or isolation (DNA Ch 22/29/30; Part IV §IV-10). Direction approved; execution is Part VI.

**Dependencies.** Part III (§III-1/17/26/45); Part IV (§IV-10); DNA Ch 22/29/30.

**Traceability.** DNA Ch 22/29/30 · Part IV §IV-10 · Objective: governed, interoperable ecosystem · Modules: gateway/manifest/integrations · Workflow: §III-17/26/36 · Engines: n/a · AI: gateway · Roadmap: extension ecosystem (Part VI).

---

## V-19 — Experience & Simplicity Evolution

**Purpose.** Describe the long-horizon direction of the customer's experience — how the platform grows in capability while the experienced complexity does not.

**Why it exists.** Simplicity under growth is a constitutional success dimension and a boundary (DNA Ch 33.2 §5, Ch 32). As capability compounds, the experience must stay calm and progressive. This section fixes that direction.

**Scope.** Experience and simplicity as principle. Not visual design specs, not component libraries, not accessibility implementation detail.

**Experience evolution direction.**
- **Progressive disclosure.** The experience scales from beginner to enterprise without forcing customers through complexity they did not ask for (DNA Ch 14; §III-3).
- **Simplicity as a boundary.** Cortex will not push internal complexity onto customers, will not require technical knowledge to begin, and will not add cognitive load without measurable benefit (DNA Ch 32 experience boundaries; Ch 11).
- **Inclusive by direction.** Accessibility and inclusive access strengthen as the experience evolves (§III-70).

**CURRENT STATE (PARTIAL).** IMPLEMENTED: a single, calm, guided interface presenting sophisticated engines simply (§III-1/3). PARTIAL: progressive-disclosure tiers (beginner → enterprise) and full accessibility conformance are recorded as maturing (§III-3, §III-70). NOT IMPLEMENTED: the full beginner-to-enterprise progression as an explicit runtime capability.

**APPROVED FUTURE STATE.** The experience deepens with progressive disclosure and inclusive access while experienced complexity stays flat as capability grows (DNA Ch 11–14/32). Direction approved; design and delivery are Part VI.

**Dependencies.** Part III (§III-1/3/27/70); DNA Ch 11–14, Ch 32; Phase 5.1 (V-6).

**Traceability.** DNA Ch 11–14/32 · Objective: simplicity under growth · Modules: UI/experience · Workflow: §III-28 · Engines: n/a · AI: gateway (assist) · Roadmap: progressive disclosure, accessibility (Part VI).

---

## V-20 — Phase Summary

**Purpose.** Close Phase 5.2 by consolidating its purpose, key decisions, current state, approved future state, dependencies, and traceability into one enterprise summary.

**Purpose of Phase 5.2.** To define the long-horizon evolution of the Cortex product and platform as approved strategic direction — product, architecture, workforce realization, interaction, intelligence, memory, data, ecosystem, and experience — strictly separated from any roadmap, feature list, or implementation (Part VI).

**Key Decisions.**
1. Product evolution is additive, identity-preserving, simplicity-constrained, and reality-first (V-11).
2. The platform matures toward relational authority per domain while staying provider-agnostic and preserving the deterministic-core/narrated-surface split (V-12/V-17).
3. The AI Workforce is realized progressively from engine-orchestra to governed first-class constructs, on the Part IV architecture (V-13).
4. Interaction advances GUI → NL → voice → multimodal, simplicity invariant; voice deferred until maturity (V-14).
5. Intelligence deepens while "math decides; AI narrates," provider-agnostic and explainable, holds (V-15).
6. Memory compounds under isolation and sovereignty, never used against the customer (V-16).
7. The platform grows into a governed, interoperable ecosystem without weakening governance (V-18); experienced complexity stays flat as capability grows (V-19).

**Current State.** Grounded in the LOCKED Blueprint and repository: IMPLEMENTED — provider-agnostic gateway, deterministic engine orchestra, manifest/component architecture, calm guided interface, KV-authoritative store with tenant scoping (§III-1). PARTIAL — relational foundation present but not authoritative, narrow external integrations, maturing explainability/accessibility/sovereignty tooling (§III-36/37/44/64/70). NOT IMPLEMENTED — named workforce runtime constructs, natural-language/voice interaction, compounding business memory, relational authority across domains, external extension ecosystem (DNA Ch 8.3/15/16/19).

**Approved Future State.** Additive maturation across all nine dimensions toward the constitutional identity and the Part IV architecture, under unchanged principles, governance, and simplicity (DNA Ch 8.3/17/19/20/23; Part IV §IV-10/29/32/40). Direction is approved; sequencing is deferred to Part VI.

**Dependencies.** Part II (Constitution) as governing authority; Part III as the current-state record; Part IV — AI Company Architecture (LOCKED) as the organizational architecture this evolution realizes; Part VI — Execution Roadmap (PLANNED) as the sequenced plan. Phase 5.1 (Vision) as the fixed direction this phase serves.

**Traceability.** DNA Ch 8/8.3/11–20/22/23/29/30/32/33 · Part IV §IV-10/13/23/29/32/40/52 · Objective: approved product & platform evolution direction · Modules: all · Workflow: §III-28/29/37 · Engines: orchestra, repositories, gateway · AI: Intelligence Gateway (narration) · Roadmap: Part VI (PLANNED).

---

*End of Phase 5.2 (Sections V-11 through V-20). Part V remains IN PROGRESS and is not reviewed or locked in this phase. Phase 5.3 follows below with continuous numbering.*

---

## Phase 5.3 — Innovation & Market Leadership

**Status:** IN PROGRESS · **Phase:** 5.3 — Innovation & Market Leadership · **Numbering:** Sections V-21 through V-30 (continuing Part V numbering) · **Continuity:** appends after Phase 5.2 with continuous numbering and formatting; the Part V reading conventions (above) govern this phase unchanged.

*This phase defines how MARQ Cortex sustains long-term innovation, adapts to change, and maintains strategic leadership — as enduring strategic **principles** for innovation, research, technology adoption, partnerships, market leadership, global reach, competition, resilience, and long-term commitments. It is not an R&D roadmap, a feature backlog, implementation planning, budgeting, or hiring; those belong to Part VI or future operational documentation.*

---

## V-21 — Innovation Philosophy

**Purpose.** State why innovation matters to Cortex, the principles that govern it, and how innovation is kept responsible and governed over the long horizon.

**Why it exists.** Without a philosophy, innovation drifts toward novelty and spectacle — explicitly *not* success (DNA Ch 33.3). This section fixes innovation as a purpose-serving, governed activity so it strengthens the platform rather than fragmenting it.

**Scope.** Innovation principles and governance as strategy. Not research projects, not experiments, not budgets or timelines.

**Innovation direction.**
- **Why innovation matters.** Cortex must keep converting advancing intelligence into measurable customer outcomes; standing still erodes the value it promises (DNA Ch 5/33.2).
- **Innovation principles.** Innovation is judged by whether it strengthens the AI Workforce model, creates measurable value, avoids unnecessary duplication, maintains simplicity, and increases trust (DNA Ch 33.1; Ch 24).
- **Responsible innovation.** Innovation never crosses the platform boundaries (DNA Ch 32) — never trades trust, security, isolation, transparency, or human accountability for capability (DNA Ch 18/29/30).
- **Innovation governance.** New capability enters only through the decision framework and, where it would touch the entrenched core, only through the Amendment Process (DNA Ch 24/35; Part IV §IV-43 change governance).

**CURRENT STATE (IMPLEMENTED, as governance).** The innovation gate is the LOCKED decision framework and success principle (DNA Ch 24/33; §III-84), reinforced by Part IV change governance and continuous improvement (§IV-43/§IV-52). It is IMPLEMENTED as governance; instrumented innovation processes are Part VI.

**APPROVED FUTURE STATE.** Innovation remains permanent, purpose-serving, and governed; it deepens under the same gate and boundaries (DNA Ch 24/32/33). Direction approved; execution is Part VI.

**Dependencies.** Part II (DNA Ch 5/18/24/29/30/32/33/35); Part IV (§IV-43/52); Phase 5.1 (V-5); Part VI.

**Traceability.** DNA Ch 24/32/33/35 · Part IV §IV-43/52 · Objective: governed, responsible innovation · Modules: governance/all · Workflow: §III-84 · Engines: deterministic · AI: gateway · Roadmap: innovation process (Part VI).

---

## V-22 — Research Strategy

**Purpose.** Describe, at high level, Cortex's enduring approach to research, continuous learning, evaluation of emerging technology, and knowledge acquisition.

**Why it exists.** A platform whose differentiator is intelligence must learn continuously or fall behind. This section fixes the *philosophy* of research so learning stays disciplined, purpose-driven, and honest (DNA Ch 17/33).

**Scope.** Research philosophy and priorities at a high level. Not research projects, not lab structure, not staffing, not budgets.

**Research direction.**
- **Research priorities.** Research serves the mission — deepening diagnosis, quantification, prioritization, planning, execution, and measurement, and advancing the workforce model (DNA Ch 6/8; §III-2). Priority follows purpose, not fashion.
- **Continuous learning.** Cortex learns from outcomes and from its memory of each business, feeding reality back into judgment (DNA Ch 19; §III-25 outcomes).
- **Evaluation of emerging technologies.** Emerging technology is evaluated against the decision framework and boundaries before adoption — capability alone is never sufficient reason (DNA Ch 24/32).
- **Knowledge acquisition philosophy.** Knowledge is acquired, curated, and governed under Part IV knowledge governance and AI memory principles (§IV-32/§IV-42).

**CURRENT STATE (PARTIAL).** IMPLEMENTED: an outcomes/QBR loop that feeds measured reality back (§III-21/25) and engineering memory artifacts (`memory/*`). PARTIAL: systematic evaluation of emerging technology is exercised through the gateway's provider-agnostic design (§III-17). NOT IMPLEMENTED: a formal research function or knowledge-acquisition program.

**APPROVED FUTURE STATE.** Research matures as a disciplined, purpose-driven learning capability governed by the decision framework and knowledge governance (DNA Ch 17/19/24; Part IV §IV-32/42). High-level direction only; programs are Part VI.

**Dependencies.** Part III (§III-17/21/25); Part IV (§IV-32/42); DNA Ch 6/17/19/24/32.

**Traceability.** DNA Ch 17/19/24/32 · Part IV §IV-32/42 · Objective: disciplined continuous learning · Modules: outcomes/knowledge/gateway · Workflow: §III-30 · Engines: dashboard/portfolio · AI: gateway · Roadmap: research function (Part VI).

---

## V-23 — Technology Evolution Principles

**Purpose.** Document how Cortex evaluates and adopts new technologies over the long horizon, as principle rather than implementation.

**Why it exists.** Technology changes faster than identity. Cortex needs durable rules for adopting AI advances, infrastructure, and standards without churn or lock-in (DNA Ch 22/23). This section fixes those rules.

**Scope.** Technology adoption principles: AI advances, infrastructure evolution, standards, interoperability, future compatibility. No products, no vendors, no versions, no implementation.

**Technology adoption direction.**
- **AI advances.** Adopted through the provider-agnostic gateway so capability improves without coupling correctness to any provider, and never overriding authoritative math (DNA Ch 17; §III-1/17).
- **Infrastructure evolution.** Adopted additively, preserving isolation, sovereignty, and recoverability; no rebuild without cause (DNA Ch 20/22; §III-37).
- **Standards adoption & interoperability.** Cortex favors open standards and clean interfaces so it interoperates without lock-in (Part IV §IV-10).
- **Future compatibility.** Change is versioned, attributed, and logged, preserving integrity under change (DNA Ch 23/30.4; §III-74/75).

**CURRENT STATE (PARTIAL).** IMPLEMENTED: provider-agnostic gateway and manifest-governed composition enable low-churn adoption (§III-1/17/26); versioned change discipline exists (§III-74/75). PARTIAL: standards/interoperability posture is partial (§III-36). NOT IMPLEMENTED: a formal technology-evaluation standard beyond the constitutional gate.

**APPROVED FUTURE STATE.** Technology is adopted additively, provider-agnostically, standards-favoring, and future-compatible, under the same governance (DNA Ch 17/22/23; Part IV §IV-10). Principles only; adoption decisions are Part VI.

**Dependencies.** Part III (§III-1/17/26/37/74/75); Part IV (§IV-10); DNA Ch 17/20/22/23/30.

**Traceability.** DNA Ch 17/22/23/30 · Part IV §IV-10 · Objective: low-churn, lock-in-free adoption · Modules: gateway/manifest/edge · Workflow: §III-74 · Engines: version engine · AI: gateway · Roadmap: adoption standard (Part VI).

---

## V-24 — Strategic Partnership Vision

**Purpose.** Describe the enduring philosophy for partnerships and ecosystem participation — technology, enterprise, academic, and industry — as strategic direction.

**Why it exists.** No platform succeeds alone over a decade. Partnerships extend reach and capability, but only if they preserve trust, governance, and identity (DNA Ch 29/32). This section fixes the philosophy.

**Scope.** Partnership philosophy across partner types and ecosystem participation. Not partner programs, not contracts, not vendor selection, not procurement.

**Partnership direction.**
- **Technology partners.** Engaged through provider-agnostic, governed interfaces so no partner becomes a single point of correctness or lock-in (§III-17; DNA Ch 17).
- **Enterprise partners.** Relationships deepen as long-term, trust-first partnerships that serve customer outcomes (DNA Ch 33.2 §3/§8).
- **Academic & industry collaboration.** Collaboration advances the general method and responsible AI without compromising isolation, sovereignty, or transparency (DNA Ch 19/20/30).
- **Ecosystem participation.** Cortex participates as a governed, interoperable platform (V-18), never weakening integrity boundaries for reach (DNA Ch 22/29).

**CURRENT STATE (PARTIAL / NOT IMPLEMENTED).** IMPLEMENTED: governed technology integration via the gateway (§III-17/36). PARTIAL: enterprise relationships are expressed through the client lifecycle (§III-28). NOT IMPLEMENTED: formal academic/industry collaboration or a partner ecosystem program.

**APPROVED FUTURE STATE.** Partnerships mature across all types under trust-first, governance-preserving principles and governed interoperability (DNA Ch 29/32; V-18). Philosophy only; programs are Part VI.

**Dependencies.** Part III (§III-28/36); Part V (V-18); DNA Ch 17/19/20/29/30/32.

**Traceability.** DNA Ch 29/30/32 · Objective: trust-preserving partnerships · Modules: integrations/gateway/CRM · Workflow: §III-17/36 · Engines: n/a · AI: gateway · Roadmap: partner ecosystem (Part VI).

---

## V-25 — Market Leadership Strategy

**Purpose.** Describe how Cortex intends to remain a trusted market leader over the long horizon — through the qualities that earn leadership, not tactics.

**Why it exists.** Leadership is earned and re-earned. This section fixes the durable sources of leadership so strategy is anchored in trust and outcomes, not in feature races (DNA Ch 33.3).

**Scope.** The enduring sources of market leadership as principle. No metrics, no campaigns, no pricing, no go-to-market plans.

**Leadership direction.**
- **Trust.** Trust is the north-star of leadership; when it falls, nothing else compensates (DNA Ch 33.2 §3; Phase 5.1 V-4).
- **Quality & customer outcomes.** Leadership rests on real, measurable outcomes and on explainable, auditable quality (DNA Ch 33.2 §1/§7).
- **Operational excellence.** Reliability, security, and disciplined operation sustain leadership (Part IV §IV-54 operational excellence; §IV-51 operational health).
- **Continuous innovation.** Leadership is renewed by governed, purpose-serving innovation (V-21), never by imitation or spectacle (DNA Ch 33.3).

**CURRENT STATE (PARTIAL).** IMPLEMENTED (as standard): the constitutional success dimensions and Part IV operational-excellence principles govern what leadership means (DNA Ch 33; §IV-54). PARTIAL: outcome and operational-health surfaces exist and are maturing (§III-25/62/63). NOT IMPLEMENTED: instrumented leadership measures (excluded here by rule; Part VI).

**APPROVED FUTURE STATE.** Leadership is sustained through trust, quality, outcomes, operational excellence, and governed innovation — permanent sources, deepened over time (DNA Ch 33; Part IV §IV-51/54). Principles only; measurement and execution are Part VI.

**Dependencies.** Part III (§III-25/62/63); Part IV (§IV-51/54); Phase 5.1 (V-4/V-9); DNA Ch 33.

**Traceability.** DNA Ch 33 · Part IV §IV-51/54 · Objective: earned, durable leadership · Modules: outcomes/health/all · Workflow: §III-30 · Engines: dashboard aggregator · AI: narrate · Roadmap: leadership measures (Part VI).

---

## V-26 — Global Expansion Vision

**Purpose.** Describe the long-term global strategy as architecture — geographic and industry reach, enterprise adoption, localization, and regulatory adaptability — without go-to-market planning.

**Why it exists.** The method is industry-general and the mission is not confined to one region (DNA Ch 6/31). This section fixes how reach may expand while governance, isolation, and sovereignty stay intact (DNA Ch 32).

**Scope.** Global expansion as architectural direction. Not target markets, not sales plans, not localization projects, not regulatory filings.

**Expansion direction.**
- **Geographic & industry expansion.** Reach expands across regions and industries under one general method and one governance model (DNA Ch 31; Phase 5.1 V-8).
- **Enterprise adoption.** The platform scales from a first-time owner's diagnostic to a large enterprise's full operating platform without forcing graduation through complexity (DNA Ch 14; §III-3).
- **Localization philosophy.** Localization adapts language and context while preserving the single method and identity (DNA Ch 8/31).
- **Regulatory adaptability.** The platform adapts to regional regulation through data sovereignty, consent, and compliance governance, never trading trust for entry (DNA Ch 20/25.6; Part IV §IV-41; §III-44).

**CURRENT STATE (PARTIAL).** IMPLEMENTED: industry-general method and industry-selectable diagnostic (§III-2/5). PARTIAL: data-sovereignty/consent tooling and compliance governance are approved-future/maturing (§III-44; §IV-41). NOT IMPLEMENTED: multi-region deployment, localization, and broad enterprise-scale adoption.

**APPROVED FUTURE STATE.** Reach expands across geographies and industries under one method and governance model, with localization and regulatory adaptability preserving trust (DNA Ch 20/31/32; Part IV §IV-41). Architecture only; execution is Part VI.

**Dependencies.** Part III (§III-2/3/44/54); Part IV (§IV-41); Phase 5.1 (V-8); DNA Ch 20/31/32.

**Traceability.** DNA Ch 20/31/32 · Part IV §IV-41 · Objective: governed global reach · Modules: diagnostic/tenancy/compliance · Workflow: §III-9/44 · Engines: repositories, rule packs · AI: gateway · Roadmap: regions/localization (Part VI).

---

## V-27 — Competitive Strategy Principles

**Purpose.** Document the enduring principles by which Cortex maintains competitive advantage — differentiation grounded in customer value and integrity, not imitation.

**Why it exists.** Competitive pressure tempts platforms toward imitation, feature races, and shortcuts that erode trust. This section fixes principled sources of advantage that hold under pressure (DNA Ch 33.3, Ch 32).

**Scope.** Competitive principles. No competitor analysis, no positioning tactics, no pricing, no campaigns.

**Competitive direction.**
- **Differentiation.** Cortex differentiates as an AI Workforce that produces measurable outcomes with effortless simplicity — a category it defines, not one it chases (Phase 5.1 V-3; DNA Ch 8).
- **Sustainable advantage.** Advantage compounds through trust, compounding memory, and the coordinated workforce — sources that deepen with the relationship and resist imitation (DNA Ch 19; Ch 33.2 §6).
- **Customer value first.** Every competitive choice is judged by customer outcome, never by matching a rival feature-for-feature (DNA Ch 5/33.1).
- **Innovation over imitation; ethical competition.** Cortex leads by governed innovation and competes ethically and honestly, never trading integrity for advantage (DNA Ch 30/33.3).

**CURRENT STATE (IMPLEMENTED, as principle).** These are LOCKED constitutional standards (DNA Ch 8/33) already governing the Blueprint's decisions. IMPLEMENTED as principle; competitive execution is out of scope for Part V.

**APPROVED FUTURE STATE.** Advantage is sustained through differentiation, compounding trust/memory, customer value, and ethical, innovation-led competition — permanent principles (DNA Ch 8/19/30/33). Principles only; execution is Part VI.

**Dependencies.** Phase 5.1 (V-3/V-4); Part III (§III-1); DNA Ch 5/8/19/30/33.

**Traceability.** DNA Ch 8/19/30/33 · Objective: durable, ethical advantage · Modules: all · Workflow: §III-1 · Engines: orchestra · AI: gateway · Roadmap: n/a (principle) · Part VI for execution.

---

## V-28 — Future Risk & Resilience Vision

**Purpose.** Describe Cortex's strategic resilience — how it endures technology disruption, market change, AI evolution, regulatory change, and organizational change — as principle.

**Why it exists.** A decade brings disruption. Resilience must be designed as direction, not improvised in crisis (Part IV §IV-39 risk governance). This section fixes the resilience posture.

**Scope.** Strategic resilience as principle. No incident plans, no DR runbooks, no continuity procedures, no timelines.

**Resilience direction.**
- **Technology disruption.** Provider-agnostic, additive, standards-favoring adoption keeps Cortex resilient to shifts in AI and infrastructure (V-23; DNA Ch 17/22).
- **Market change.** The industry-general method and trust-first model let Cortex adapt across markets without abandoning identity (DNA Ch 31; Ch 8).
- **AI evolution.** "Math decides; AI narrates," provider-agnosticism, and AI governance keep Cortex safe as AI advances (DNA Ch 17; Part IV §IV-29).
- **Regulatory change.** Data sovereignty, consent, and compliance governance provide adaptability to new regulation (DNA Ch 20/25.6; Part IV §IV-41).
- **Organizational adaptability.** The enterprise maturity model and continuous improvement keep the organization able to adapt (Part IV §IV-52/§IV-53).

**CURRENT STATE (PARTIAL).** IMPLEMENTED: provider-agnostic gateway, deterministic core, versioned change, and Part IV risk/compliance governance frameworks (§III-17/74; §IV-39/41). PARTIAL: DR/backup and resilience tooling are approved-future/maturing (§III-66/67). NOT IMPLEMENTED: a fully instrumented resilience program.

**APPROVED FUTURE STATE.** Resilience matures across all five vectors under the same governance and identity, adaptable without rebuild (DNA Ch 17/20/22/31; Part IV §IV-39/41/52/53). Direction only; execution is Part VI.

**Dependencies.** Part III (§III-17/66/67/74); Part IV (§IV-39/41/52/53); DNA Ch 17/20/22/31.

**Traceability.** DNA Ch 17/20/22/31 · Part IV §IV-39/41/52/53 · Objective: durable strategic resilience · Modules: gateway/data/governance · Workflow: §III-74 · Engines: version, migration · AI: gateway · Roadmap: resilience program (Part VI).

---

## V-29 — Long-Term Strategic Commitments

**Purpose.** Define the enduring commitments Cortex holds regardless of era — the promises that outlast any strategy, technology, or market.

**Why it exists.** Strategy changes; commitments must not. This section records the permanent commitments so every future decision is bound by them (DNA Ch 25/35).

**Scope.** Enduring commitments as principle. No metrics, no programs, no plans.

**Enduring commitments.**
- **Trust.** Trust is the paramount commitment; it is never traded for speed, revenue, or reach (DNA Ch 33.2 §3, Ch 32).
- **Human accountability.** Humans remain in control of high-consequence decisions; Cortex never claims autonomy beyond granted authority (DNA Ch 18; Part IV §IV-28).
- **Product excellence.** Measurable outcomes, quality, and explainability are non-negotiable (DNA Ch 33.2 §1/§7).
- **Responsible AI.** AI is honest about being AI, governed, safe, and never overrides authoritative math (DNA Ch 17/30; Part IV §IV-29/33).
- **Sustainable growth.** Growth is additive and durable; capability compounds while experienced complexity does not (DNA Ch 23/33.2 §5).
- **Continuous improvement.** Cortex improves continuously under governance, learning from measured reality (Part IV §IV-52; DNA Ch 19).

**CURRENT STATE (IMPLEMENTED, as constitution).** Every commitment is LOCKED in Part II and reinforced in Part IV, and already governs the Blueprint (DNA Ch 17/18/23/30/32/33; §IV-28/29/33/52). IMPLEMENTED as governing commitment; their in-product enforcement is IMPLEMENTED in parts and maturing in others (§III-31 onward).

**APPROVED FUTURE STATE.** The commitments are permanent and bind all future strategy and execution; future work strengthens their enforcement (DNA Ch 25/35). No new commitment is introduced by Part V beyond the constitutional set.

**Dependencies.** Part II (DNA Ch 17/18/23/25/30/32/33/35); Part IV (§IV-28/29/33/52); Phase 5.1 (V-5/V-9).

**Traceability.** DNA Ch 17/18/23/30/32/33 · Part IV §IV-28/29/33/52 · Objective: permanent, binding commitments · Modules: all · Workflow: §III-84/85 · Engines: deterministic + governance · AI: gateway · Roadmap: enforcement (Part VI).

---

## V-30 — Phase Summary

**Purpose.** Close Phase 5.3 by consolidating its purpose, key decisions, current state, approved future state, dependencies, and traceability into one enterprise summary.

**Purpose of Phase 5.3.** To define how MARQ Cortex sustains long-term innovation, adapts to change, and maintains strategic leadership — as enduring principles for innovation, research, technology adoption, partnerships, market leadership, global reach, competition, resilience, and long-term commitments — strictly separated from R&D roadmaps, backlogs, budgets, hiring, and implementation (Part VI and future operational documentation).

**Key Decisions.**
1. Innovation is purpose-serving, governed, and responsible — judged by the success principle, bounded by the platform boundaries (V-21).
2. Research and technology adoption are disciplined, provider-agnostic, standards-favoring, and low-churn (V-22/V-23).
3. Partnerships and ecosystem participation are trust-first and governance-preserving (V-24).
4. Market leadership rests on trust, quality, outcomes, operational excellence, and governed innovation — not feature races (V-25).
5. Global expansion is industry-general and governance-preserving, with localization and regulatory adaptability (V-26).
6. Competitive advantage is principled and durable — differentiation, compounding trust/memory, customer value, innovation over imitation, ethical competition (V-27).
7. Resilience is designed across technology, market, AI, regulatory, and organizational change (V-28); enduring commitments bind all future strategy (V-29).

**Current State.** Grounded in the LOCKED Blueprint and repository: IMPLEMENTED (as governance/standard) — the decision framework, success dimensions, and Part IV governance/operational-excellence principles that govern innovation, leadership, competition, and commitments (DNA Ch 24/33; §IV-29/39/41/43/52/54). PARTIAL — outcome/health surfaces, sovereignty/compliance tooling, and resilience tooling are present and maturing (§III-25/44/62/66). NOT IMPLEMENTED — formal research, partner-ecosystem, multi-region, and instrumented leadership/resilience programs (Part VI).

**Approved Future State.** Innovation, research, adoption, partnerships, leadership, expansion, competition, and resilience mature under permanent, purpose-serving principles and unchanged commitments (DNA Ch 24/32/33; Part IV §IV-29/41/52/54). Direction is approved; all programs, sequencing, and execution are deferred to Part VI.

**Dependencies.** Part II (Constitution) as governing authority; Part III as the current-state record; Part IV — AI Company Architecture (LOCKED) as the organizational architecture; Phases 5.1 and 5.2 as the vision and evolution this phase serves; Part VI — Execution Roadmap (PLANNED) for execution.

**Traceability.** DNA Ch 5/6/8/17/18/19/20/22/23/24/25/29/30/31/32/33/35 · Part IV §IV-10/28/29/32/39/41/43/51/52/53/54 · Objective: sustained innovation & durable leadership · Modules: all · Workflow: §III-30/84 · Engines: deterministic + governance · AI: Intelligence Gateway (narration) · Roadmap: Part VI (PLANNED).

---

*End of Phase 5.3 (Sections V-21 through V-30). Part V remains IN PROGRESS and is not reviewed or locked in this phase. Phase 5.4 is not begun.*

---

## Phase 5.4 — Enterprise Review, Audit & Lock

**Status:** COMPLETE · **Phase:** 5.4 — Enterprise Review, Audit & Lock · **Scope:** Full enterprise audit of Part V — Sections V-1 through V-30 (Phases 5.1–5.3) · **Continuity:** appends after Phase 5.3; the Part V reading conventions govern. This phase reviews and locks Part V; it authors no new strategic sections.

*This phase performs a complete enterprise audit of Part V against the Master Blueprint rules, the Constitution (Part II), the Product Blueprint (Part III), and the AI Company Architecture (Part IV). On passing, it records the official approval and locks Part V. It introduces no new vision, expands no scope, and adds no strategic initiative; the only changes it makes to Phases 5.1–5.3 are the verified cross-reference corrections recorded in §5.4.3.*

### 5.4.1 — Audit Scope & Method

Every section from V-1 through V-30 was reviewed against the 18-point enterprise audit checklist. Cross-references were verified mechanically: every `§III-N`, `§IV-N`, `V-N`, and `DNA Ch N` citation in Part V was resolved against the actual section and chapter headers of the LOCKED Parts (Part III §III-1…§III-88, Part IV §IV-1…§IV-55, Constitution Chapters 1–37, Part V §V-1…§V-30). CURRENT STATE claims were checked for grounding in repository evidence or previously LOCKED Blueprint; APPROVED FUTURE STATE was checked for explicit identification; and the text was checked for roadmap and implementation leakage against the Part V boundary rules.

### 5.4.2 — Audit Checklist Results

| # | Audit item | Result |
|---|------------|--------|
| 1 | No missing strategic sections (V-1 → V-30 continuous) | **PASS** |
| 2 | No duplicated concepts (overlaps are cross-referenced, not repeated) | **PASS** |
| 3 | No conflicting vision statements | **PASS** |
| 4 | No conflicting strategic direction | **PASS** |
| 5 | No contradictions with Part I | **PASS** |
| 6 | No contradictions with Part II (Constitution) | **PASS** |
| 7 | No contradictions with Part III (Product Blueprint) | **PASS** |
| 8 | No contradictions with Part IV (AI Company Architecture) | **PASS** |
| 9 | CURRENT STATE grounded in repository and LOCKED Blueprint | **PASS** |
| 10 | APPROVED FUTURE STATE clearly identified | **PASS** |
| 11 | Traceability complete | **PASS** |
| 12 | Cross-references valid | **PASS** *(after §5.4.3 corrections)* |
| 13 | Strategic vision aligns with the Cortex Constitution | **PASS** |
| 14 | Future Vision aligns with the Product Blueprint | **PASS** |
| 15 | Future Vision aligns with the AI Company Architecture | **PASS** |
| 16 | No implementation details leaked into Part V | **PASS** |
| 17 | No roadmap content leaked into Part V | **PASS** |
| 18 | No unresolved strategic gaps | **PASS** |

**No strategic gap was found.** Part V is complete, internally consistent, and constitutionally aligned. The single audit finding was a cross-reference defect (item 12), corrected in §5.4.3 as permitted for a verified correction required by the audit. No vision was redesigned, no scope expanded, and no strategic initiative introduced.

### 5.4.3 — Corrections Applied (Audit-Required)

The audit found a systematic cross-reference defect: several Part V citations pointed to the wrong Part III section (a habit of citing §III-33/§III-34 for the Intelligence Gateway and component registry that propagated through Phases 5.1–5.3), plus a non-existent DNA subsection label. These are **pure pointer corrections** — no strategic content, wording of principle, CURRENT/FUTURE classification, or scope was changed. Parts I–IV remain byte-identical.

| Intended referent | Incorrect citation | Corrected citation | Basis |
|---|---|---|---|
| Intelligence Gateway (provider-agnostic intelligence) | §III-33 | **§III-17** (AI Gateway) | §III-33 = *Background Jobs* |
| Component / manifest architecture | §III-34 | **§III-26** (Component Inventory) | §III-34 = *Scheduled Processes* |
| External integrations; standards & interoperability | §III-33 | **§III-36** (Integration Contracts) | §III-33 = *Background Jobs* |
| Industry rule packs; industry diagnostic domains | §III-46 | **§III-54** (Business Rules) / **§III-5** (Business Domains) | §III-46 = *Billing* |
| Accessibility / inclusive access | §III-56 | **§III-70** (Accessibility) | §III-56 = *Error Handling* |
| Outcomes / ROI actuals / QBR loop | §III-24 | **§III-25** (Business Modules) / **§III-21** (Core Engines) | §III-24 = *System Modules* |
| Purpose dimensions of Chapter 5 | DNA "Ch 5.1/5.2/5.3" | **DNA Ch 5** | Chapter 5 lists unnumbered dimensions |

Forty-four citation tokens across roughly fifteen sections were corrected (1:1 replacements). Post-correction, every `§III-N`, `§IV-N`, `V-N`, and `DNA Ch N` reference in Part V resolves to an existing target.

### 5.4.4 — Lock Conditions

| Condition | Confirmed |
|-----------|-----------|
| Phase 5.1 complete | ✓ |
| Phase 5.2 complete | ✓ |
| Phase 5.3 complete | ✓ |
| Continuous numbering (V-1 → V-30) | ✓ |
| CURRENT STATE verified | ✓ |
| APPROVED FUTURE STATE identified | ✓ |
| Traceability complete | ✓ |
| Cross-references valid | ✓ |
| Constitutional alignment confirmed | ✓ |
| Product Blueprint alignment confirmed | ✓ |
| AI Company Architecture alignment confirmed | ✓ |
| No roadmap leakage | ✓ |
| No implementation leakage | ✓ |
| No unresolved strategic gaps | ✓ |

### 5.4.5 — Approval Record

| Field | Value |
|-------|-------|
| **Part** | Part V — Strategic Future Vision |
| **Scope** | Sections §V-1 through §V-30 (Phases 5.1–5.3) |
| **Version** | 1.0 |
| **Status** | **LOCKED** |
| **Approval** | **APPROVED** |
| **Strategic Vision Review** | **PASS** |
| **Enterprise Architecture Alignment** | **PASS** |
| **Repository Alignment** | **PASS** |
| **Executive Review** | **PASS** |
| **Audit checklist** | 18 / 18 PASS |
| **Steward** | MARQ Networks |

### 5.4.6 — Immutability

**PART V — STRATEGIC FUTURE VISION — Status: LOCKED (Version 1.0, APPROVED).**

Part V is now constitutionally settled. It is preserved as authored; §V-1 through §V-30 are not restated, summarized, or altered by any subsequent Part. Future modifications to Part V may occur **only through the formal Amendment Process** (DNA Ch 35) — ordinary amendment for non-entrenched content, and the heightened core-amendment process (DNA Ch 35.5–35.6) where a change would touch the entrenched core (identity, non-negotiables, the Human–AI Authority Doctrine, data sovereignty, or *Maximum Intelligence, Minimum Complexity*). Every such change must be versioned, attributed, and logged (DNA Ch 30.4). A silent or unlogged edit to Part V has no force.

### 5.4.7 — Continuity

Parts I, II, III, and IV remain LOCKED and unchanged. Part V is LOCKED as of this record. The Master Blueprint remains a single, continuous document; the next authoring phase is **Part VI — Execution Roadmap** (PLANNED), appended later with continuous numbering and formatting. **This phase does not begin Part VI.**

*End of Part V. Part V is LOCKED.*

---

# PART VI — PHASE 6: EXECUTION ROADMAP

**Status:** IN PROGRESS · **Numbering:** Sections VI-1 onward (continuing the single-document numbering after Part V, §V-1–§V-30) · **Continuity:** Part VI appends to the same Master Blueprint; numbering and formatting are continuous and are never restarted. Parts I–V remain LOCKED and are neither modified, restated, nor contradicted here (Preservation rule; Golden Rules 1 and 8).

## Reading conventions for Part VI

Part VI is the **Execution Roadmap** — the sequenced plan to realize the approved blueprint. It is authored in phases, beginning with **Phase 6.1 — Current State Assessment & Gap Analysis**, which establishes the execution baseline before any sequencing is proposed. It carries the discipline of Parts III–IV without exception:

- **CURRENT STATE vs APPROVED FUTURE STATE.** Every section separates what exists today from what the blueprint approves. CURRENT STATE is grounded strictly in repository evidence or the LOCKED Parts I–IV; APPROVED FUTURE STATE is traced to the Constitution (Part II), the product blueprint (Part III), the enterprise architecture (Part IV), and the roadmap.
- **Implementation labels.** CURRENT STATE is tagged **IMPLEMENTED**, **PARTIAL**, or **NOT IMPLEMENTED** (the Part III/IV convention, where IMPLEMENTED ≈ PROVEN). No capability is invented; nothing observed is normalized against the Constitution.
- **Never invent.** Where a capability does not exist, it is marked NOT IMPLEMENTED and tied to its reserved future identity. Where the blueprint that a section would compare against is itself unauthored, that is stated plainly rather than assumed.

**Note on Part V.** The task baseline for this phase names Parts I–V as the approved comparison surface. **Parts I–V are now authored and LOCKED** — Part V — Future Vision was integrated into the canonical blueprint after this phase was first drafted (§front-matter). Phase 6.1's assessment of CURRENT STATE was authored against the then-available blueprint — Parts I–IV (LOCKED) plus the Constitution — reading the long-horizon strategic direction from the DNA (Part II, the constitutional source of vision and mission), the APPROVED FUTURE STATE sections throughout Parts III–IV, and `MARQ_CORTEX_ROADMAP.md`; that direction is now consolidated in the authored Part V. The strategic direction is therefore documented (Part V LOCKED); what remains **NOT IMPLEMENTED** is its runtime realization. This preserves traceability and invents nothing.

**What this phase is not.** Phase 6.1 is not a sprint plan, not a delivery schedule, and not a backlog. It defines no milestones, tasks, assignments, budgets, hiring, timelines, or technical implementation. Those belong to later Part VI phases (6.2 onward). This phase ends at §VI-10 and neither begins Phase 6.2 nor locks Part VI.

---

## Phase 6.1 — Current State Assessment & Gap Analysis

*This phase establishes the execution baseline for MARQ Cortex. It compares the CURRENT IMPLEMENTATION against the APPROVED BLUEPRINT (Parts I–IV LOCKED, plus the Constitution) to identify what already exists, what is partially implemented, and what remains to be built before Cortex reaches the approved future state. It categorizes gaps and dependencies without prioritizing or sequencing solutions.*

---

## VI-1 — Executive Assessment

**Purpose.** To give a high-level, evidence-grounded assessment of the current MARQ Cortex implementation measured against the approved blueprint (Parts I–IV LOCKED, plus the Constitution).

**Why it exists.** Execution cannot be sequenced honestly until the starting point is fixed. This section states, at the executive altitude, how far the realized system has traveled toward the approved architecture — so that every later gap, dependency, and principle is read against a settled baseline rather than an aspiration.

**Scope.** The whole system at a glance: product (Part III), enterprise/AI-company architecture (Part IV), and strategic readiness (the DNA and the future-state sections, now consolidated in the authored Part V). No section-by-section detail — that follows in §VI-2 through §VI-4.

**Current State (PARTIAL).** MARQ Cortex today is a **substantially implemented product on a settled constitutional and architectural foundation, operating as a single-operator (Startup-shape) enterprise, with data-authority migration and the AI-workforce runtime still ahead.**
- **IMPLEMENTED.** The deterministic product core exists: 37 engines in `src/app/core/` (scoring, decision, portfolio, ROI/DCF/IRR/Monte-Carlo/scenario/cost/cashflow, proposal-gate, snapshot/version/export, contract, execution/scope/template, ROI-actuals, QBR, CRM, copilot/AI-assist/objection), a 171-node component manifest (`src/system/manifest.ts`), the full pre-sale → post-sign journey routes (`src/app/pages/`), the Intelligence Gateway with live provider adapters (`supabase/functions/server/intelligence/`), the CORTEX AI surfaces (chat, narrative, analysis, copilot-patch, block-assist, proposal-section copilot), a repository layer and KV store, a migration engine with CLI, and system memory (`memory/`). Governance doctrine is settled and LOCKED (Constitution → Blueprint → Operating Constitution → sprint criteria → verified behavior).
- **PARTIAL.** Relational schema, RLS, and tenancy migrations exist, but **KV remains the runtime storage authority**; SQL cutover is in progress (roadmap Phase 4/5, currently S7.4 Outcome Shadow Read). The Intelligence Gateway is live single-provider; multi-provider/agent orchestration is future. Multi-tenant isolation is defined (RLS) but not yet the enforced runtime authority.
- **NOT IMPLEMENTED.** The Part IV **AI Workforce as a runtime** (executives, departments, managers, AI workers) — reserved to the `ai_worker` future identity; enterprise performance instrumentation and formal KPIs (§IV-46–§IV-55 record raw signals plus the constitutional success standard); and the **runtime realization of Part V — Future Vision** (the long-horizon direction is now authored and LOCKED in Part V; its realization is future work).

**Approved Future State.** The additive realization of the approved blueprint: SQL as authoritative data plane under enforced multi-tenancy; multi-provider/agent intelligence; progressive standing-up of the AI workforce against the reserved identity; and instrumented enterprise performance — each delivered without rebuild and subordinate to the constitutional identity and success test (DNA Ch 8.3, Ch 23, Ch 33). The authored Part V and later Part VI phases complete the approved comparison surface.

**Dependencies.** Parts I–IV (LOCKED) as the grounding record; the Constitution (`CORTEX_DNA_v1.0.md`); `MARQ_CORTEX_ROADMAP.md` for runtime authority; §VI-2 through §VI-9 for the detail beneath this summary.

**Traceability.** Part I: `ARCHITECT.md`, `architecture/system_map.json`, `src/imports/cortex-audit-report.md`. Part II: DNA Ch 8/17/18/23/33. Part III: §III-15–§III-21, §III-29, §III-59–§III-65, §III-81–§III-88. Part IV: §IV-23, §IV-46–§IV-55. Roadmap: `MARQ_CORTEX_ROADMAP.md`; Part VI later phases.

---

## VI-2 — Current Product State

**Purpose.** To assess the implementation status of the product defined in Part III, using only IMPLEMENTED, PARTIAL, or NOT IMPLEMENTED.

**Why it exists.** The execution baseline must state precisely which product capabilities are realized, which are half-built, and which are only specified — so gap analysis (§VI-5) rests on fact, not impression.

**Scope.** The product surface of Part III: the customer journey, the deterministic engines, the AI surfaces, data/persistence, tenancy, and the supporting platform. Enterprise/AI-company concerns belong to §VI-3.

**Current State.**

| Product capability (Part III) | Status | Evidence |
|---|---|---|
| Deterministic decision & scoring core | **IMPLEMENTED** | `scoringEngine`, `decisionEngine`, `portfolioEngine`, `inputNormalizer`, `mappingEngine` in `src/app/core/` |
| ROI / financial modeling suite | **IMPLEMENTED** | `roiEngine`, `dcfEngine`, `irrEngine`, `monteCarloEngine`, `scenarioEngine`, `costEngine`, `cashflowEngine` |
| Proposal governance & gating | **IMPLEMENTED** | `proposalGateEngine`, `proposalCopilotEngine`; server `proposalSectionCopilot.ts` |
| Snapshot / version / export | **IMPLEMENTED** | `snapshotEngine`, `versionEngine`, `exportEngine`; server `revenueSnapshot.ts` |
| Contract & execution delivery | **IMPLEMENTED** | `contractEngine`, `executionEngine`, `scopeEngine`, `templateAssembler`, `blockEngine`, `sprintTemplates` |
| ROI actuals & QBR | **IMPLEMENTED** | `roiActualsEngine`, `roiTrackingEngine`, `qbrEngine`; `outcomeRepository.ts` |
| Customer journey routes (pre-sale → post-sign) | **IMPLEMENTED** | `LeadMagnetRoute`, `DiagnosticRoute`, `ScoreRoute`, `ExecutionRoute`, `ClientPortalRoute`, `TeamDashboardRoute` |
| CORTEX AI surfaces (chat, narrative, assist, copilot, objection) | **IMPLEMENTED** | `copilotEngine`, `aiAssistEngine`, `objectionEngine`; server `cortexChat/cortexNarrative/cortexAnalysis/blockAiAssist/copilotPatch` |
| Intelligence Gateway (provider abstraction) | **PARTIAL** | Gateway live with `openaiAdapter` + `mockProvider`; multi-provider/agent orchestration is future |
| CRM / lead capture | **PARTIAL** | `crmEngine`, `leadRepository`, `contactRepository`; external CRM sync is future |
| Persistence & data authority | **PARTIAL** | `kv_store.tsx` + repositories are authoritative; **SQL not yet the runtime authority** (roadmap S7.x/S8.x) |
| Relational schema & migrations | **PARTIAL** | Tenancy, RLS+seed, KV-foundation, migration-infra, diagnostic-foundation migrations exist; not the live authority |
| Multi-tenancy / isolation | **PARTIAL** | `organizations` + RLS policies and `tenancyRepository`; enforced runtime isolation maturing |
| Migration tooling | **IMPLEMENTED** | `scripts/migration/cli.ts` (inventory/simulate/backfill/reconcile/pipeline/validate); `supabase/functions/server/migration/` |
| Client / instant booking | **IMPLEMENTED** | `supabase/functions/server/bookings/` |
| Full analytics / BI product surface | **NOT IMPLEMENTED** | Raw signals only; no instrumented analytics product (see §VI-3, §IV-46–§IV-55) |

**Approved Future State.** SQL as authoritative data plane under enforced RLS/tenancy; multi-provider and agentic intelligence; external CRM/e-sign/scheduling integrations; and progressive UI/analytics maturation — additive, contract-preserving, and traced to Part III future-state sections (§III-29, §III-37, §III-44, §III-59–§III-65).

**Dependencies.** Part III (§III-1–§III-88); the roadmap runtime-authority record; the migration engine and relational migrations; §VI-6 (dependencies) and §VI-8 (constraints).

**Traceability.** Part I: `ARCHITECT.md`, `architecture/system_map.json`. Part II: DNA Ch 6/17/18/20. Part III: §III-15–§III-21, §III-26–§III-29, §III-37, §III-42–§III-44, §III-59–§III-65, §III-87. Roadmap: `MARQ_CORTEX_ROADMAP.md` (Phases 3–5).

---

## VI-3 — Current Enterprise State

**Purpose.** To assess the implementation status of the AI Company Architecture defined in Part IV.

**Why it exists.** Part IV approved MARQ Cortex *as a company* — executives, departments, managers, and an AI workforce. Execution must record honestly how much of that operating model is realized versus reserved, so the enterprise gap is not confused with the product gap.

**Scope.** The Part IV enterprise operating model: identity/foundation, organizational structure, AI workforce, operations/governance, and enterprise performance. The product surface is §VI-2; strategic readiness is §VI-4.

**Current State.**
- **IMPLEMENTED (as doctrine and single-operator reality).** The enterprise identity, operating principles, governance stack, and authority doctrine are settled and LOCKED (§IV-1–§IV-12, §IV-35–§IV-45): one canonical authority chain (Constitution → Blueprint → Operating Constitution/`ARCHITECT.md` → sprint criteria → verified behavior), deterministic engines owning authoritative computation (Art. 6), and the Human Principal as ultimate accountable at the high-consequence floor (DNA Ch 18.9). Institutional memory (`memory/failure_library.md`, `regression_cases.md`, `pattern_violations.json`) and per-increment review cycles operate.
- **PARTIAL.** The organizational *structure* exists as approved architecture and as the current single-operator (Startup-shape) reality; roles are defined (`roleEngine`, product RBAC in §III-42/§III-43) but the multi-department, multi-manager operating org is not staffed or running.
- **NOT IMPLEMENTED.** The **AI Workforce as a runtime** — executive/department/manager/worker AI roles executing enterprise work — reserved to the `ai_worker` future identity (§IV-23–§IV-34). Enterprise performance instrumentation, formal KPIs, AI-performance evaluation, a unified health framework, and department scorecards are absent; measurement today is raw signals plus the constitutional success standard, and the enterprise operates at the **Startup maturity shape** (§IV-46–§IV-55). No workforce capability is invented.

**Approved Future State.** Progressive, additive standing-up of the AI workforce against the reserved identity and the approved structure — deterministic authority, human floor, and the maturity invariants preserved at every stage — with performance instrumentation extended to the realized workforce (DNA Ch 8.3, Ch 23; §IV-53–§IV-55).

**Dependencies.** Part IV (§IV-1–§IV-55, LOCKED); the reserved `ai_worker` identity; §VI-2 (product substrate the workforce operates on); §VI-6/§VI-7.

**Traceability.** Part I: `ARCHITECT.md`, `architecture/system_map.json`, `memory/`. Part II: DNA Ch 8/9/17/18/23/33/35. Part III: §III-42–§III-44. Part IV: §IV-1–§IV-12, §IV-23–§IV-34, §IV-35–§IV-45, §IV-46–§IV-55. Roadmap: Part VI later phases.

---

## VI-4 — Current Strategic Readiness

**Purpose.** To assess readiness against the strategic direction defined in Part V.

**Why it exists.** A gap analysis must weigh how ready the realized system is for its approved long-horizon direction. Because Part V was authored after this section was first drafted, this section is explicit about *what* strategic direction it measures against, so readiness is grounded and not fabricated.

**Scope.** Long-horizon strategic readiness. The strategic direction — now consolidated in the authored and LOCKED **Part V — Future Vision** — is read from its constitutional carriers: the DNA (Part II — vision, mission, product/AI philosophy, progressive AI-company doctrine), the APPROVED FUTURE STATE sections throughout Parts III–IV, and `MARQ_CORTEX_ROADMAP.md`.

**Current State.**
- **Part V — Future Vision: AUTHORED & LOCKED.** Sections §V-1–§V-30 are written and locked, so the long-horizon direction is now an explicit blueprint surface (§front-matter). Its *runtime realization* remains future work.
- **Strategic direction (as currently carried): IMPLEMENTED as constitutional intent.** The DNA fixes identity, mission, and the "Maximum Intelligence, Minimum Complexity" north-star, and approves the AI-company as progressive-yet-approved (DNA Ch 8.3). This direction is settled and LOCKED.
- **Strategic *readiness* of the realized system: PARTIAL.** The deterministic product core and constitutional foundation are strong footing for the approved direction (IMPLEMENTED substrate, §VI-2). The two pillars the long horizon most depends on — an authoritative, multi-tenant SQL data plane and a standing AI workforce — are respectively **PARTIAL** (KV-authoritative, SQL cutover in progress) and **NOT IMPLEMENTED** (reserved identity). Enterprise instrumentation to steer strategy is **NOT IMPLEMENTED** (§IV-46–§IV-55).

**Approved Future State.** With Part V — Future Vision now authored and LOCKED, the long-horizon direction is explicit and comparable; realization follows additively: SQL authority, enforced tenancy, multi-provider/agentic intelligence, and the AI workforce — each subordinate to the constitutional success test (DNA Ch 33). The authored Part V, together with the DNA and Parts III–IV future-state sections, is the authoritative strategic surface.

**Dependencies.** Part II (DNA, strategic source); Parts III–IV future-state sections; `MARQ_CORTEX_ROADMAP.md`; the authored Part V; §VI-2 and §VI-3.

**Traceability.** Part I: `ARCHITECT.md`. Part II: DNA Ch 3/4/5/8/8.3/33 (mission/vision/philosophy/north-star). Part III: §III-59, §III-79, §III-80 (future-state/debt paths). Part IV: §IV-53 (maturity), §IV-46–§IV-55. Part V: §V-1–§V-30 (authored long-horizon direction). Roadmap: `MARQ_CORTEX_ROADMAP.md`; front-matter organization table (Part V LOCKED).

---

## VI-5 — Gap Analysis

**Purpose.** To identify and categorize the major execution gaps between the CURRENT STATE and the approved blueprint, without prioritizing or proposing solutions.

**Why it exists.** Naming and grouping the gaps — distinctly from sequencing them — lets later Part VI phases prioritize against a stable, agreed inventory rather than re-deriving it.

**Scope.** The material gaps across product, data/platform, intelligence, enterprise/AI-workforce, performance, security/tenancy, and documentation. Categorization only; no ranking, no mitigation, no sequence (those are §VI-8 constraints and later phases).

**Current State (gap inventory, categorized).**

- **G1 — Data Authority gap (PARTIAL → SQL authority).** KV is the runtime authority; the approved relational data plane exists as schema/migrations but is not authoritative. Shadow-read/cutover work is in flight (roadmap S7.4→S8.x). *Category: Platform / Data.*
- **G2 — Multi-tenancy enforcement gap (PARTIAL).** `organizations` + RLS policies and `tenancyRepository` exist; enforced runtime isolation across all paths is maturing. *Category: Security / Data.*
- **G3 — Intelligence breadth gap (PARTIAL).** Gateway is live single-provider (`openaiAdapter` + `mockProvider`); multi-provider and agentic orchestration are approved but unbuilt. *Category: AI.*
- **G4 — AI Workforce runtime gap (NOT IMPLEMENTED).** The Part IV executive/department/manager/worker runtime does not exist; reserved to the `ai_worker` identity. *Category: Enterprise / AI.*
- **G5 — Enterprise performance instrumentation gap (NOT IMPLEMENTED).** No formal KPIs, AI-performance evaluation, unified health framework, or scorecards; raw signals plus constitutional success standard only. *Category: Operations / Performance.*
- **G6 — External integration gap (PARTIAL/NOT IMPLEMENTED).** CRM sync, e-sign, scheduling, and comparable third-party integrations are specified but not live. *Category: Third-party services / Product.*
- **G7 — Strategic-surface gap (RESOLVED — documentation axis).** Part V — Future Vision is now authored and LOCKED (§V-1–§V-30), so the long-horizon direction is an explicit blueprint surface rather than one carried only by the DNA and future-state sections; the residual gap is its *runtime realization*, tracked under the AI-workforce and data-authority gaps. *Category: Governance / Documentation.*
- **G8 — Maturity gap (PARTIAL).** The enterprise operates at the Startup shape; the Growth→Enterprise→Global→AI-native stages are approved but not realized (§IV-53). *Category: Organizational.*

**Approved Future State.** Each gap has an approved destination already recorded in the LOCKED blueprint and roadmap; closing them is additive and constitution-subordinate. This section fixes the inventory only — prioritization, sequencing, and mitigation are deferred to later Part VI phases.

**Dependencies.** §VI-2, §VI-3, §VI-4 (the state each gap is measured from); §VI-6 (dependencies that gate closure); §VI-8 (constraints).

**Traceability.** Part II: DNA Ch 8/17/18/20/23/33. Part III: §III-29, §III-37, §III-44, §III-59–§III-65, §III-78–§III-80. Part IV: §IV-23–§IV-34, §IV-46–§IV-55. Roadmap: `MARQ_CORTEX_ROADMAP.md` (Phases 4–5).

---

## VI-6 — Critical Dependencies

**Purpose.** To document, at a high level, the execution dependencies on which realizing the approved blueprint rests.

**Why it exists.** Gaps do not close in isolation; each depends on platform, data, AI, security, operational, and third-party foundations. Naming these dependencies prevents later phases from sequencing work against foundations that are not yet in place.

**Scope.** High-level dependency classes only — not a technical design, not a task graph.

**Current State (dependency classes).**
- **Platform.** Supabase Edge Functions runtime, Vite/React frontend, KV store, and the deterministic-engine layer — **IMPLEMENTED** and load-bearing today.
- **Infrastructure.** Deployment via Supabase functions (`supabase:deploy`) and DB push (`supabase:db-push`); relational schema present — **PARTIAL** (SQL not yet authoritative).
- **Data.** The KV↔relational mapping, migration engine/CLI, and shadow-read/cutover pipeline — **PARTIAL** (authority migration in progress); authoritative SQL is the gating dependency for G1/G2/G8.
- **AI.** The Intelligence Gateway provider abstraction — **PARTIAL** (single-provider live); the gating dependency for G3 and, downstream, the workforce (G4).
- **Security.** Supabase auth, RLS policies, anon-policy hardening, tenant isolation — **PARTIAL**; the gating dependency for G2.
- **Operations.** Execution rules, test protocol, roadmap discipline, and system memory — **IMPLEMENTED** as governing process; instrumentation for enterprise operations — **NOT IMPLEMENTED** (gates G5).
- **Third-party services.** LLM provider(s), and future CRM/e-sign/scheduling integrations — **PARTIAL/NOT IMPLEMENTED** (gates G6).
- **Governance / documentation.** The LOCKED Constitution and Parts I–V; Part V — Future Vision is now authored and LOCKED (G7 resolved on the documentation axis).

**Approved Future State.** Each dependency class matures additively to unblock its gaps — authoritative SQL, enforced tenancy, multi-provider AI, instrumented operations, and live integrations — building toward the direction now authored and LOCKED in Part V, without violating existing platform, API, auth, or tenancy contracts (Execution Rules; DNA Ch 8.3).

**Dependencies.** §VI-2–§VI-5 (what each dependency gates); §VI-7 (readiness to act on them); §VI-8 (constraints).

**Traceability.** Part I: `ARCHITECT.md`, `architecture/system_map.json`. Part II: DNA Ch 20/25/30. Part III: §III-37, §III-44, §III-56–§III-57, §III-84–§III-88. Part IV: §IV-35–§IV-45. Roadmap: `MARQ_CORTEX_ROADMAP.md`; `MARQ_CORTEX_EXECUTION_RULES.md`.

---

## VI-7 — Implementation Readiness

**Purpose.** To assess readiness to execute across Engineering, Product, Operations, AI, Governance, Security, and Customer readiness.

**Why it exists.** Even with gaps and dependencies mapped, execution depends on whether each discipline is ready to act. This section states that readiness plainly, so later sequencing is realistic.

**Scope.** Cross-disciplinary readiness at a high level. No staffing, budget, or schedule (those are excluded from this phase).

**Current State.**
- **Engineering — IMPLEMENTED (ready).** A working codebase, 37 engines, repositories, migration tooling, and multi-suite tests (`test:smoke/intelligence/database/migration/features`) provide a disciplined, reversible engineering base (Execution Rules; Test Protocol).
- **Product — IMPLEMENTED/PARTIAL.** The core journey and engines are live; integration breadth and analytics maturation remain (§VI-2).
- **Operations — PARTIAL.** Sprint/roadmap discipline, execution rules, test protocol, and system memory operate; enterprise operational instrumentation does not (§IV-46–§IV-55).
- **AI — PARTIAL.** Gateway and CORTEX surfaces are live single-provider; multi-provider/agentic readiness and the workforce runtime are ahead (§VI-3, G3/G4).
- **Governance — IMPLEMENTED.** The constitutional authority stack, amendment process, and LOCKED Parts I–V give a settled governing frame (DNA Ch 25/35); Part V — Future Vision is now authored and LOCKED, closing the one open governance-documentation item (G7).
- **Security — PARTIAL.** Auth, RLS, and anon-policy hardening exist; enforced multi-tenant isolation as runtime authority is maturing (G2).
- **Customer readiness — PARTIAL.** The end-to-end customer journey is implemented; readiness at scale depends on SQL authority, enforced tenancy, and integrations (G1/G2/G6).

**Approved Future State.** Each discipline advances to full readiness additively — SQL-authoritative and tenant-enforced engineering/security, multi-provider AI, instrumented operations, an authored strategic surface, and integration-complete product — while preserving the constitutional identity and the "quality/security/blueprint-first" order (§VI-9).

**Dependencies.** §VI-2–§VI-6; the Execution Rules and Test Protocol; the LOCKED governance stack.

**Traceability.** Part I: `ARCHITECT.md`. Part II: DNA Ch 18/25/30/33/35. Part III: §III-42–§III-44, §III-84–§III-88. Part IV: §IV-35–§IV-45, §IV-46–§IV-55. Roadmap: `MARQ_CORTEX_EXECUTION_RULES.md`, `MARQ_CORTEX_TEST_PROTOCOL.md`, `MARQ_CORTEX_ROADMAP.md`.

---

## VI-8 — Execution Constraints

**Purpose.** To document the known constraints that bound execution, without defining mitigation plans.

**Why it exists.** Constraints shape what any later sequence can and cannot do. Recording them now — separately from solutions — keeps the roadmap honest and prevents plans that assume away real limits.

**Scope.** Technical, organizational, operational, compliance, and resource constraints, at a high level. No mitigations, no workarounds, no sequencing.

**Current State (known constraints).**
- **Technical.** KV is the runtime authority; contracts (API, DTOs, response envelopes, route behavior, auth) must be preserved through change; SQL cutover must proceed via shadow-read/validation, not a hard switch (Execution Rules; roadmap). Runtime behavior must remain unchanged unless a change is the explicit intent.
- **Organizational.** The enterprise operates at the Startup shape (single-operator reality); the multi-department AI-workforce org is approved but not staffed (§IV-53, §VI-3).
- **Operational.** Every change must be independently reviewable and reversible; work proceeds one bounded increment at a time; completed work is not re-audited without cause; enterprise operational instrumentation is absent (Execution Rules; §IV-46–§IV-55).
- **Compliance / governance.** All change is subordinate to the Constitution and the LOCKED Parts; changes touching the entrenched core require the heightened amendment process (DNA Ch 35.5–35.6); data sovereignty and the human high-consequence floor are non-negotiable (DNA Ch 18.9).
- **Resource.** Deployment, live credentials, and production environments may be unavailable in-session; such limits are deployment limitations, not engineering failures (Execution Rules) — they nonetheless constrain what can be validated end-to-end.

**Approved Future State.** Constraints are respected, not removed by fiat: contract-preserving migration, reversible increments, and constitution-subordinate change remain permanent operating constraints even as the system matures. Mitigation and sequencing are deferred to later Part VI phases.

**Dependencies.** The Execution Rules, Test Protocol, and roadmap; the Constitution (amendment and non-negotiables); §VI-5/§VI-6.

**Traceability.** Part II: DNA Ch 18.9/20/25/35. Part III: §III-75–§III-79. Part IV: §IV-35–§IV-45, §IV-53. Roadmap: `MARQ_CORTEX_EXECUTION_RULES.md`, `MARQ_CORTEX_ROADMAP.md`.

---

## VI-9 — Execution Principles

**Purpose.** To define the principles that must govern implementation of the approved blueprint.

**Why it exists.** A roadmap needs invariant rules that hold across every phase, so that *how* Cortex is built never drifts from its constitution, regardless of what is being built.

**Scope.** The governing principles for execution. These are rules, not tasks; they bind all later Part VI phases.

**Current State (principles, each already in force).**
- **Blueprint before code.** No capability is built before it exists in this Blueprint; the Blueprint is the authority, the codebase the implementation (Master rule; §front-matter).
- **Incremental delivery.** Small, bounded, independently reviewable and reversible increments; no large refactors, no scope expansion without approval (Execution Rules).
- **Quality first.** No increment is complete until it builds clean and passes its affected and regression tests (Test Protocol; Definition of Done).
- **Security first.** Auth, authorization, tenant isolation, and data sovereignty are preserved through every change; the human high-consequence floor is inviolable (DNA Ch 18.9; Execution Rules).
- **Backward compatibility.** API contracts, DTOs, response envelopes, route behavior, and runtime authority are preserved unless a change is the explicit, approved intent (Execution Rules).
- **Customer impact.** Runtime behavior and the customer journey stay stable unless deliberately changed; customer trust is the north-star that measurement never overrides (DNA Ch 33; §IV-46).
- **Constitution-subordinate & traceable.** Every change defers to the Constitution and the LOCKED Parts, is versioned/attributed/logged, and touching the entrenched core invokes the heightened amendment process (DNA Ch 30.4, Ch 35).
- **Determinism preserved.** Deterministic engines remain the authoritative computation; AI assists and never overrides authoritative results (Art. 6; DNA Ch 17/18).

**Approved Future State.** These principles are permanent; they govern Phase 6.2 onward and every subsequent execution phase unchanged. They are not superseded by delivery pressure, maturity stage, or the standing-up of the AI workforce.

**Dependencies.** The Constitution; the Execution Rules and Test Protocol; §VI-5–§VI-8.

**Traceability.** Part II: DNA Ch 8.3/17/18/25/30/33/35; Operating Constitution Art. 6/15. Part III: §III-75, §III-84–§III-88. Part IV: §IV-5, §IV-9, §IV-44, §IV-54. Roadmap: `MARQ_CORTEX_EXECUTION_RULES.md`, `MARQ_CORTEX_TEST_PROTOCOL.md`.

---

## VI-10 — Phase Summary

**Purpose.** To close Phase 6.1 by recording what it established — the execution baseline — and how it connects to the phases that follow, without beginning them.

**Why it exists.** A phased document needs an explicit boundary so the *baseline and gap inventory* are not mistaken for a *plan*, and so later Part VI phases begin from a settled assessment.

**Scope.** A summary of Phase 6.1 only (§VI-1–§VI-10). It defines no new state, prioritizes nothing, and sequences nothing.

**Key Findings.**
1. MARQ Cortex is a substantially implemented product (37 engines, 171-node manifest, full journey, live Intelligence Gateway and CORTEX AI, repository/KV layer, migration tooling, test suites, system memory) on a settled, LOCKED constitutional and architectural foundation (§VI-1, §VI-2).
2. The two most load-bearing forward pillars are **authoritative SQL under enforced tenancy** (PARTIAL; roadmap S7.4→S8.x) and the **AI Workforce runtime** (NOT IMPLEMENTED; reserved `ai_worker` identity) (§VI-3, §VI-5).
3. Enterprise performance instrumentation is NOT IMPLEMENTED — measurement is raw signals plus the constitutional success standard; the enterprise operates at the Startup maturity shape (§VI-3, §IV-46–§IV-55).
4. **Part V — Future Vision is authored and LOCKED**; the long-horizon strategic direction — previously read from the DNA and the Parts III–IV future-state sections — is now consolidated as an explicit blueprint surface (§VI-4). Its runtime realization remains future work.
5. Eight categorized gaps (G1–G8) and their high-level dependencies and constraints are inventoried without prioritization (§VI-5, §VI-6, §VI-8).

**Current State.** Product core and governance: **IMPLEMENTED**. Data authority, tenancy enforcement, intelligence breadth, integrations, and maturity: **PARTIAL**. AI workforce runtime and enterprise instrumentation: **NOT IMPLEMENTED**; the long-horizon vision is now authored and LOCKED in Part V, with its runtime realization **NOT IMPLEMENTED**. Everything is grounded in repository evidence or the LOCKED Parts I–V; nothing is invented.

**Approved Future State.** Additive realization of the approved blueprint — SQL authority, enforced tenancy, multi-provider/agentic AI, a progressively standing AI workforce, and instrumented performance — realizing the direction now authored and LOCKED in Part V, each subordinate to the constitutional identity and success test (DNA Ch 8.3, Ch 33). Prioritization and sequencing are deferred to later Part VI phases.

**Dependencies.** All Phase 6.1 sections (§VI-1–§VI-9); Parts I–V (LOCKED) and the Constitution as the grounding record; `MARQ_CORTEX_ROADMAP.md` and `MARQ_CORTEX_EXECUTION_RULES.md`; the now-authored and LOCKED Part V, whose runtime realization remains future work.

**Traceability.** Part I: `ARCHITECT.md`, `architecture/system_map.json`, `src/imports/cortex-audit-report.md`. Part II: DNA Ch 8/8.3/17/18/23/25/30/33/35. Part III: §III-15–§III-21, §III-29, §III-37, §III-44, §III-59–§III-65, §III-78–§III-80, §III-84–§III-88. Part IV: §IV-1–§IV-12, §IV-23–§IV-34, §IV-35–§IV-45, §IV-46–§IV-55. Roadmap: `MARQ_CORTEX_ROADMAP.md`, `MARQ_CORTEX_EXECUTION_RULES.md`, `MARQ_CORTEX_TEST_PROTOCOL.md`.

---

## Phase 6.1 — Completion Status

**Phase 6.1 (Current State Assessment & Gap Analysis) is complete: Sections VI-1 through VI-10.** It establishes the execution baseline for MARQ Cortex by comparing the current implementation against the approved blueprint (Parts I–IV LOCKED, plus the Constitution): an executive assessment, the current product state, the current enterprise state, current strategic readiness, a categorized gap inventory (G1–G8), critical dependencies, implementation readiness across seven disciplines, execution constraints, and the execution principles that must govern all later phases. CURRENT STATE is grounded throughout in the repository and the LOCKED Parts I–IV and is labelled IMPLEMENTED / PARTIAL / NOT IMPLEMENTED: the product core and governance are IMPLEMENTED; data authority, tenancy enforcement, intelligence breadth, integrations, and maturity are PARTIAL; the AI workforce runtime and enterprise instrumentation are NOT IMPLEMENTED; and **Part V — Future Vision** is authored and LOCKED, with its runtime realization NOT IMPLEMENTED. No capability is invented. This phase defines no sprints, milestones, tasks, assignments, budgets, hiring, timelines, or technical implementation — those belong to later Part VI phases.

**Continuity note.** The Master Blueprint remains a single, continuous document. Parts I–V remain LOCKED and unchanged. Part V — Future Vision is authored and LOCKED, and the next Part VI phase (6.2) is not begun here. This phase is neither reviewed nor locked.

*End of Phase 6.1. Part VI continues in a later phase.*

---

## Phase 6.2 — Strategic Prioritization & Execution Sequencing

**Status:** COMPLETE (Phase 6.2) · Part VI remains IN PROGRESS · **Numbering:** Sections VI-11 through VI-20, continuing the single-document numbering after Phase 6.1 (§VI-1–§VI-10); numbering is never restarted. · **Continuity:** Phase 6.2 appends to the same Master Blueprint. Parts I–V remain LOCKED and are neither modified, restated, nor contradicted here; Phase 6.1 (§VI-1–§VI-10) is preserved unchanged (Preservation rule; Golden Rules 1 and 8).

**Purpose of this phase.** Phase 6.1 established the verified baseline — current state, categorized gaps (G1–G8), critical dependencies, readiness, and constraints. Phase 6.2 converts that assessment into a disciplined execution *sequence*: what must happen first, what must happen later, what must not begin prematurely, which dependencies control ordering, how priorities are determined, and how delivery risk is reduced as the product moves from its current state toward the approved blueprint.

**What this phase is.** Strategic execution architecture — a prioritization philosophy (§VI-11), a formal prioritization framework and priority classes (§VI-12), a dependency model (§VI-13), an approved layered execution sequence (§VI-14), the immediate priorities grounded in the current repository (§VI-15), the work that must be deferred or prohibited early (§VI-16), the parallel execution streams (§VI-17), the gates that govern advancement (§VI-18), and the anti-drift controls and mandatory repository workflow (§VI-19), closed by a completion record (§VI-20).

**What this phase is not.** Phase 6.2 is **not** a sprint plan, a ticket backlog, a calendar, a staffing schedule, a coding task list, or implementation instructions. It assigns no dates, milestones, people, hours, or numeric KPIs, and it writes no code. It sequences work; it does not perform it. Phase 6.3 is not begun here, and Part VI is not locked.

**Grounding.** CURRENT STATE claims below are grounded in the repository verified for this phase — the deterministic engine layer under `src/app/core/` (30 `*Engine.ts` modules), the Intelligence Gateway under `supabase/functions/server/intelligence/` (`gateway.ts`, `providerRegistry.ts`, `certification.ts`, `modelRegistry.ts`, `telemetry.ts`, `health.ts`, `featureBridge.ts`, and `providers/openaiAdapter.ts` + `providers/mockProvider.ts`), the server repository layer under `supabase/functions/server/repositories/`, the migration engine under `supabase/functions/server/migration/`, the SQL migrations under `supabase/migrations/`, the test suites declared in `package.json`, and the deployment scripts (`supabase:deploy`, `supabase:db-push`) — together with the LOCKED Parts I–V and the Constitution. Labels IMPLEMENTED / PARTIAL / NOT IMPLEMENTED / VERIFIED / UNVERIFIED are used where they add precision. Nothing is invented ahead of its phase (Golden Rule 5).

---

## VI-11 — Execution Prioritization Philosophy

**Purpose.** To define the governing philosophy that decides what MARQ Cortex executes first — the value system beneath every sequencing decision in the remainder of Part VI.

**Why it exists.** Phase 6.1 produced a stable inventory of gaps and dependencies but deliberately refused to rank them. A ranking without a stated philosophy is arbitrary and drifts under pressure. This section fixes the *basis* for prioritization so that every later ordering — layers (§VI-14), immediate priorities (§VI-15), streams (§VI-17), gates (§VI-18) — is a consequence of stated principle rather than of convenience, visibility, or momentary preference.

**Scope.** The prioritization value system only. It defines no order, names no work item, and sequences nothing; ordering derives from these principles in §VI-12 onward.

**Approved Execution State (governing principles).**

- **Value before volume.** Priority is set by enterprise and customer value delivered, not by the count of features shipped. A single load-bearing capability that unblocks the blueprint outranks many shallow surfaces. Feature quantity is never a prioritization signal.
- **Foundations before expansion.** Capabilities that everything else stands on — identity, tenancy, authorization, data integrity, the gateway — precede any expansion that would depend on them. Expansion built on unfinished foundations is rework in advance.
- **Trust before automation.** Nothing is automated until the state it acts on is trustworthy. Automation over unverified data or unenforced boundaries multiplies error at machine speed; trust in the substrate is a precondition, not a later refinement.
- **Authority before autonomy.** A capability must have a clear, verified source of authority (deterministic engines, authoritative data, enforced permissions) before any autonomous or agentic behavior is layered above it. Autonomy without a settled authority model is ungoverned action.
- **Data integrity before intelligence.** Intelligence — narration, analysis, agentic reasoning — is only as sound as the data beneath it. The relational data plane and its integrity (G1) precede any broadening of intelligence (G3) or workforce (G4) that would consume that data as truth.
- **Reusable platform capability before isolated features.** A capability that many surfaces reuse (the gateway, the repository layer, the tenancy boundary, the migration engine) is prioritized over a feature usable by one surface only. Platform leverage compounds; isolated features do not.
- **Dependency-aware sequencing.** Work is ordered by its position in the dependency graph (§VI-13), not by desirability. A wanted capability whose prerequisites are incomplete waits; a less glamorous prerequisite that unblocks many is elevated.
- **Operational readiness before scaling.** The ability to observe, diagnose, and safely operate a capability precedes scaling it. Scale over an unobservable system converts small faults into outages; instrumentation (G5) is a gate to growth, not an afterthought.
- **Preventing architecture drift.** Prioritization actively resists duplication and divergence — no second engine for an existing responsibility, no AI path around the gateway, no parallel data authority. Each increment converges the architecture toward the blueprint; none forks it.
- **Preserving the locked blueprint during execution.** Every priority is subordinate to the LOCKED Constitution and Parts I–V. Execution realizes the blueprint; it never edits it. Where realization reveals a genuine need to change a locked decision, the heightened amendment process (DNA Ch 35) is the only path — never an unilateral implementation choice.

**Clarification (basis of prioritization).** Prioritization under this Blueprint is determined by **strategic necessity, dependency position, delivery risk, and enterprise value** — never by developer convenience, ease of implementation, demo appeal, or the visibility of a feature. A capability is not prioritized because it is easy, impressive, or requested loudly; it is prioritized because the blueprint depends on it, because value or risk demands it, or because it unblocks a chain of downstream work.

**Dependencies.** §VI-9 (execution principles, which these extend into prioritization); the LOCKED Constitution (DNA Ch 8.3/17/18/25/33/35); §VI-5–§VI-8 (the gaps, dependencies, readiness, and constraints being prioritized).

**Risks.** If this philosophy is not held, prioritization reverts to visibility and convenience: shallow features precede foundations, automation precedes trust, and the architecture forks. The controls in §VI-19 exist to detect and reverse exactly this drift.

**Traceability.** Part II: DNA Ch 8.3/17/18/23/25/30/33/35. Part III: §III-75, §III-84–§III-88. Part IV: §IV-5, §IV-9, §IV-44, §IV-53–§IV-55. Part VI: §VI-5, §VI-6, §VI-8, §VI-9. Roadmap: `MARQ_CORTEX_EXECUTION_RULES.md`.

**Completion Evidence.** Ten governing principles stated; the basis of prioritization (strategic necessity, dependency, risk, enterprise value — not convenience or visibility) explicitly fixed; no work ordered or named; subordination to the LOCKED blueprint asserted.

---

## VI-12 — Prioritization Framework

**Purpose.** To define the formal, qualitative framework used to evaluate any proposed unit of work, and the priority classes that framework assigns.

**Why it exists.** A philosophy (§VI-11) sets values; a framework applies them consistently. Without a shared evaluation lens, every proposal is argued from first principles and the outcome depends on who argues hardest. This framework makes evaluation repeatable and its results comparable across streams and phases.

**Scope.** The evaluation dimensions and the qualitative priority classes. **No numeric scores, weights, or rankings are assigned** — the framework is deliberately qualitative to avoid false precision and the gaming that numeric scoring invites. Individual work items are classified in later phases, not here.

**Approved Execution State (evaluation dimensions).** Each proposed capability is assessed against the following, holistically rather than additively:

- **Strategic alignment** — does it advance the approved blueprint (Parts III–V) and the constitutional mission, or is it orthogonal?
- **Dependency criticality** — how many downstream capabilities are blocked until it exists? A high-fan-out prerequisite is more critical than a leaf.
- **Customer value** — does it improve the customer's real outcome and trust (DNA Ch 33), or only internal aesthetics?
- **Enterprise value** — does it build durable enterprise capability (platform, governance, workforce substrate), or one-off utility?
- **Architectural leverage** — is it reused across many surfaces, or usable by one? Leverage favors platform capability (§VI-11).
- **Operational necessity** — is it required to safely operate what already exists (diagnostics, observability, recovery)?
- **Governance impact** — does it strengthen or weaken constitutional authority, traceability, and the amendment discipline?
- **Security and trust impact** — does it strengthen auth, authorization, tenant isolation, and data sovereignty, or introduce exposure?
- **Data readiness** — is the data it depends on authoritative and verified, or still KV-shadowed and unmigrated (G1)?
- **Implementation risk** — how likely is it to destabilize existing contracts (API, DTOs, envelopes, route behavior, auth)?
- **Reversibility** — can it be delivered as a bounded, independently reversible increment, or does it require an irreversible cutover?
- **Learning value** — does completing it materially reduce uncertainty for later work (e.g., proving the shadow-read pipeline)?
- **Platform-wide reuse** — distinct from leverage: does it become shared infrastructure other streams build on?
- **Cost of delay** — what accrues (risk, rework, blocked streams, customer exposure) for each period it is *not* done?

**Approved Execution State (priority classes).** Evaluation resolves each proposal into exactly one qualitative class:

- **Foundation-Critical** — prerequisites the platform cannot stand without; block the largest number of downstream capabilities (authoritative data integrity, identity/tenancy foundations). Highest sequencing precedence.
- **Governance-Critical** — capabilities required to preserve constitutional authority, traceability, and the amendment discipline during execution. Never traded away for delivery speed.
- **Product-Critical** — capabilities the customer-facing product cannot be trustworthy or complete without, once foundations exist.
- **Platform-Enabling** — reusable infrastructure (gateway breadth, repository consistency, shared services) that unlocks multiple downstream features. High leverage.
- **Operational-Enabling** — observability, diagnostics, telemetry, and recovery capability required to safely run and scale what exists (addresses G5).
- **Growth-Enabling** — capabilities that extend reach, scale, or market surface once foundations, product, platform, and operations are sound.
- **Optimization** — refinements to performance, cost, or experience that improve an already-correct, already-trustworthy capability.
- **Deferred** — work whose foundations are not yet present, whose value is not yet established, or which is strategically premature (see §VI-16). Explicitly not prioritized now.

**Rule of application.** Classes carry sequencing precedence in the order listed: Foundation-Critical and Governance-Critical precede Product-Critical and Platform-Enabling, which precede Operational-Enabling, which precedes Growth-Enabling, which precedes Optimization; Deferred waits. A proposal may be re-classified only as its dependencies and evidence change, and only through the phase-entry checks in §VI-19 — never silently.

**Dependencies.** §VI-11 (the philosophy the dimensions operationalize); §VI-5 (gaps being classified); §VI-13 (dependency criticality is read from the dependency model); §VI-18 (gates consume these classes).

**Risks.** Numeric scoring would invite gaming and false precision; its absence is intentional. The residual risk is inconsistent qualitative judgment, mitigated by tying every classification to the stated dimensions and to the gate evidence in §VI-18.

**Traceability.** Part II: DNA Ch 8.3/17/18/25/33/35. Part III: §III-37, §III-44, §III-84–§III-88. Part IV: §IV-23–§IV-34, §IV-46–§IV-55. Part VI: §VI-5, §VI-11. Roadmap: `MARQ_CORTEX_EXECUTION_RULES.md`, `MARQ_CORTEX_TEST_PROTOCOL.md`.

**Completion Evidence.** Fourteen evaluation dimensions and eight priority classes defined with meanings and precedence; no numeric scores assigned; application rule stated; classification of individual items deferred to later phases.

---

## VI-13 — Execution Dependency Model

**Purpose.** To define the dependency hierarchy that controls the order in which capabilities may be implemented, and to distinguish hard (blocking) from soft (advisory) dependencies.

**Why it exists.** Prioritization classes (§VI-12) express *importance*; the dependency model expresses *feasibility of ordering*. A Foundation-Critical item can still be blocked by an even earlier prerequisite. This model is the graph that §VI-14's layers and §VI-17's streams are read from, and the reference the phase-entry checks (§VI-19) verify against.

**Scope.** The dependency hierarchy across the platform's capability domains. It is a dependency graph at the capability level — not a task graph, not a technical design, and not a schedule.

**Current State (dependency chain, grounded in the repository).** From foundation to surface:

1. **Identity & tenancy** — `organizations` / `organization_memberships` / `organization_settings` with RLS (`supabase/migrations/20260711050000_*`, `..._050001_*`) and `tenancyRepository.ts`. IMPLEMENTED as schema and repository; enforced runtime isolation across all paths is PARTIAL (G2). Everything tenant-scoped depends on this.
2. **Permissions & governance** — role/authority model from the Constitution and Part IV; `roleEngine.ts` in the engine layer. Governs which identity may act. Depends on (1).
3. **Data models** — relational schema and the KV↔relational mapping (`DATABASE_SCHEMA.md`; `supabase/migrations/`). KV is the runtime authority; SQL authority is PARTIAL (G1). Domain correctness depends on (1)–(3).
4. **Repositories & services** — server repository layer (`repositories/`: contact, lead, outcome, report, submission, tenancy) over `repositoryClient.ts`, and app services (`cortexDataService.ts`, `dataService.ts`). Depend on (1)–(3).
5. **Intelligence gateway** — `intelligence/gateway.ts` with `providerRegistry`, `certification`, `modelRegistry`, `telemetry`, `health`, and `featureBridge`; providers `openaiAdapter` (registered Unverified) and `mockProvider` (Testing). IMPLEMENTED single-provider; multi-provider breadth is PARTIAL (G3). Depends on (4) for the data it narrates.
6. **Knowledge systems** — the knowledge/decision substrate the intelligence layer reasons over. NOT IMPLEMENTED as a distinct system; today decision authority is the deterministic engine orchestra. Depends on (3)–(5).
7. **AI workforce** — the Part IV executive/department/manager/worker runtime; reserved `ai_worker` identity. NOT IMPLEMENTED (G4). Depends on (1)–(6) — it cannot precede authoritative data, enforced tenancy, a governed gateway, or a knowledge substrate.
8. **Workflow orchestration** — coordinated multi-step execution across engines/services/workforce. PARTIAL (deterministic engines and `executionEngine.ts` exist; workforce-driven orchestration does not). Depends on (4)–(7).
9. **Product interfaces** — the React/Vite surfaces and `src/system/manifest.ts` node graph. IMPLEMENTED for the core journey; depends on (4)–(5) for trustworthy state.
10. **Observability** — `intelligence/telemetry.ts` and `health.ts` exist for the gateway; enterprise-wide performance instrumentation is NOT IMPLEMENTED (G5). Cross-cuts (4)–(9).
11. **Security** — Supabase auth, RLS, anon-policy hardening (`..._diagnostic_anon_policy_hardening.sql`). PARTIAL; cross-cuts every layer and gates (1)–(2).
12. **Deployment** — `supabase:deploy`, `supabase:db-push`; relational schema present. PARTIAL (SQL not yet authoritative). Depends on (3)–(4).
13. **Operations** — execution rules, test protocol, migration CLI (`migration:inventory/simulate/backfill/reconcile/pipeline`), system memory. IMPLEMENTED as process; enterprise operational instrumentation NOT IMPLEMENTED. Cross-cuts all.
14. **Customer-facing automation** — automated action on customer state. Deferred; depends on the entire chain above being trustworthy (trust-before-automation, §VI-11).

**Approved Execution State (hard vs. soft dependencies).**

- **Hard (blocking) dependencies** — a downstream capability may not be implemented until the prerequisite is IMPLEMENTED **and** VERIFIED. Examples: the AI workforce (7) is hard-blocked by authoritative data (3), enforced tenancy (1–2), and a governed gateway (5); customer-facing automation (14) is hard-blocked by data integrity and observability; any intelligence broadening that treats SQL as truth is hard-blocked by SQL authority (G1). Multi-tenant enforcement (2) is a hard dependency for every tenant-scoped surface.
- **Soft (advisory) dependencies** — a downstream capability benefits from, but is not blocked by, the prerequisite; it may proceed with a documented interim contract. Examples: broader observability (10) improves but does not block product interface work (9); knowledge-system maturation (6) improves but does not block single-provider gateway use (5). Soft dependencies are recorded so their eventual satisfaction is not forgotten.

**Governing rule.** Work must not move downstream while a prerequisite capability is **incomplete or unverified**. A prerequisite that is IMPLEMENTED but UNVERIFIED does not satisfy a hard dependency; verification (VERIFIED) is required. This rule is enforced by the Architecture and Data Integrity gates (§VI-18) and the phase-entry checks (§VI-19).

**Dependencies.** §VI-6 (the dependency classes this model orders); §VI-2/§VI-3 (the states depended upon); §VI-14 (the layers derived from this graph); §VI-12 (dependency criticality dimension).

**Risks.** Treating a soft dependency as hard stalls deliverable work; treating a hard dependency as soft ships on an unverified foundation and creates rework or, worse, silent corruption. Misclassification is the primary risk and is checked at the gates.

**Traceability.** Part I: `ARCHITECT.md`, `architecture/system_map.json`. Part II: DNA Ch 17/18/20/25. Part III: §III-37, §III-44, §III-56–§III-57, §III-84–§III-88. Part IV: §IV-23–§IV-45. Part VI: §VI-6. Roadmap: `MARQ_CORTEX_ROADMAP.md`, `DATABASE_SCHEMA.md`.

**Completion Evidence.** A fourteen-domain dependency chain grounded in named repository artifacts; hard vs. soft dependencies distinguished with examples; the incomplete/unverified downstream-block rule stated and tied to the gates.

---

## VI-14 — Enterprise Execution Layers

**Purpose.** To define the approved sequence of execution layers — the coarse ordering that every stream, priority, and gate is arranged within.

**Why it exists.** The dependency model (§VI-13) is a graph; execution needs a legible layering of that graph so that "what precedes what" is unambiguous at the strategic level. The layers are the canonical sequence; nothing in a later layer may be treated as prerequisite-satisfied by work in an earlier layer that is not yet VERIFIED.

**Scope.** Nine execution layers, from constitutional integrity to market expansion. **The layers are a sequence of capability readiness, not a set of dates or sprints.** A layer being "earlier" means its outcomes are prerequisites for later layers — not that it is time-boxed or staffed.

**Approved Execution State (the layered model).**

### Layer 1 — Constitutional and Governance Integrity
- **Purpose.** Keep the LOCKED Constitution and Parts I–V authoritative throughout execution; preserve the amendment discipline and traceability.
- **Why it precedes later layers.** Every subsequent decision derives authority from here; if governance drifts, all downstream work is ungoverned.
- **Required outcomes.** Verified blueprint traceability; amendment process intact; no locked-Part modification outside formal amendment.
- **Dependencies.** None upstream; it is the root.
- **Risk of skipping.** Architecture drift and unauthorized change become undetectable.
- **Relation to Parts III–V.** Enforces the Preservation rule and DNA Ch 35 across all of Parts III–V.

### Layer 2 — Identity, Tenancy and Authorization Foundations
- **Purpose.** Establish verified organizational identity, enforced tenant isolation, and role/authority enforcement at runtime.
- **Why it precedes later layers.** Every tenant-scoped capability, every service, and the entire workforce depend on a trustworthy identity and permission boundary (G2).
- **Required outcomes.** `organizations`/memberships/settings and RLS enforced as runtime authority across all paths, VERIFIED; role enforcement active.
- **Dependencies.** Layer 1.
- **Risk of skipping.** Cross-tenant exposure and ungoverned action — the highest-severity class of failure.
- **Relation to Parts III–V.** Realizes Part IV's identity/authority model (§IV-35–§IV-45) and the DNA data-sovereignty floor (Ch 18.9).

### Layer 3 — Data and Domain Integrity
- **Purpose.** Make the relational data plane authoritative and correct; complete the KV→SQL authority migration with verified reconciliation (G1).
- **Why it precedes later layers.** Intelligence, workforce, orchestration, and automation are only as sound as the data they treat as truth (data-integrity-before-intelligence, §VI-11).
- **Required outcomes.** Shadow-read/validated cutover proven; reconciliation clean; SQL authoritative and VERIFIED; domain boundaries coherent.
- **Dependencies.** Layers 1–2.
- **Risk of skipping.** Intelligence and automation amplify silent data corruption at scale.
- **Relation to Parts III–V.** Realizes the data authority described across Part III and the roadmap (S7.4→S8.x).

### Layer 4 — Core Platform Services
- **Purpose.** Consolidate the repository/service layer and deterministic engines into consistent, reusable platform capability over authoritative data.
- **Why it precedes later layers.** Downstream surfaces and the workforce reuse these services; fragmentation here propagates upward.
- **Required outcomes.** Consistent repositories over authoritative data; deterministic engines authoritative; no duplicate engines/services.
- **Dependencies.** Layers 1–3.
- **Risk of skipping.** Divergent implementations and per-surface data access — architecture drift.
- **Relation to Parts III–V.** Realizes Part III's engine/service architecture (§III-37, §III-44).

### Layer 5 — Intelligence and Knowledge Infrastructure
- **Purpose.** Mature the Intelligence Gateway (provider neutrality, certification, model registry, telemetry, health) and establish the knowledge/decision substrate — all AI routed through the gateway only.
- **Why it precedes later layers.** The workforce and agentic orchestration require a governed, provider-neutral intelligence surface over trustworthy data (authority-before-autonomy, §VI-11).
- **Required outcomes.** Multi-provider gateway with certified providers (G3); knowledge substrate defined; deterministic authority preserved (AI assists, never overrides).
- **Dependencies.** Layers 1–4.
- **Risk of skipping.** Isolated AI integrations bypass governance; autonomy is built on an ungoverned base.
- **Relation to Parts III–V.** Realizes the gateway and CORTEX intelligence of Part III and Part IV's intelligence infrastructure (§IV-23–§IV-34).

### Layer 6 — AI Workforce and Orchestration
- **Purpose.** Stand up the Part IV executive/department/manager/worker runtime and workforce-driven orchestration on the `ai_worker` identity.
- **Why it precedes later layers.** Department/product experiences that depend on the workforce cannot precede its existence (G4).
- **Required outcomes.** Governed workforce runtime; orchestration coordinating engines/services under enforced authority; deterministic results authoritative.
- **Dependencies.** Layers 1–5 (hard).
- **Risk of skipping.** Premature autonomy without data, tenancy, or gateway governance — the central prohibition of §VI-16.
- **Relation to Parts III–V.** Realizes Part IV's AI-company architecture (§IV-1–§IV-45).

### Layer 7 — Department and Product Experiences
- **Purpose.** Complete and connect the customer-facing product surfaces on top of trustworthy foundations and the workforce.
- **Why it precedes later layers.** Operational optimization and scale presuppose a complete, trustworthy product.
- **Required outcomes.** Product surfaces backed by authoritative data and enforced tenancy; no mock-versus-production ambiguity; no client-trusted authority.
- **Dependencies.** Layers 1–6 (workforce-dependent surfaces hard-depend on Layer 6; core journey soft-depends).
- **Risk of skipping.** Surfaces built on unverified state present false trust to customers.
- **Relation to Parts III–V.** Realizes Part III's product blueprint (§III-15–§III-65).

### Layer 8 — Operational Intelligence and Optimization
- **Purpose.** Instrument enterprise performance, health, diagnostics, and optimization (G5) across the now-complete system.
- **Why it precedes later layers.** Scale is unsafe without the ability to observe, diagnose, and recover (operational-readiness-before-scaling, §VI-11).
- **Required outcomes.** Unified health/telemetry framework; diagnostics and traceability; performance evaluation without overriding the customer-trust north star.
- **Dependencies.** Layers 1–7.
- **Risk of skipping.** Faults at scale become outages; optimization proceeds blind.
- **Relation to Parts III–V.** Realizes Part IV's operational instrumentation (§IV-46–§IV-55).

### Layer 9 — Scale, Ecosystem and Market Expansion
- **Purpose.** Extend reach — ecosystem integrations, marketplace, international scale, growth systems — on a complete, observable, trustworthy platform.
- **Why it is last.** Every expansion multiplies whatever it stands on; expansion precedes soundness only at the cost of multiplying faults.
- **Required outcomes.** Integrations and scale added additively without violating platform, auth, tenancy, or gateway contracts.
- **Dependencies.** Layers 1–8.
- **Risk of skipping earlier layers into this one.** The prohibited-early-work failure mode of §VI-16.
- **Relation to Parts III–V.** Realizes the long-horizon direction now LOCKED in Part V (§V-1–§V-30), whose *runtime* realization this layer completes.

**Governing rule.** A layer's outcomes must be VERIFIED before work that hard-depends on it begins; earlier layers do not need to be *finished* in every optional respect, but their *load-bearing* outcomes must be verified (the incomplete/unverified rule, §VI-13). **The layers are not converted into dates or sprints here or anywhere in this phase.**

**Dependencies.** §VI-13 (the dependency graph the layers order); §VI-11/§VI-12 (philosophy and classes the layering honors); §VI-17 (streams executing within these layers).

**Risks.** The dominant risk is layer-skipping under delivery pressure — beginning Layer 6/7/9 work before Layers 2/3/5 are verified. The gates (§VI-18) and anti-drift controls (§VI-19) exist to prevent it.

**Traceability.** Part II: DNA Ch 8.3/17/18/20/25/33/35. Part III: §III-15–§III-65, §III-84–§III-88. Part IV: §IV-1–§IV-55. Part V: §V-1–§V-30 (long-horizon direction). Part VI: §VI-11, §VI-12, §VI-13. Roadmap: `MARQ_CORTEX_ROADMAP.md`.

**Completion Evidence.** Nine ordered layers, each with purpose, precedence rationale, required outcomes, dependencies, skip-risk, and Parts III–V relationship; the sequence explicitly not converted to dates or sprints.

---

## VI-15 — Immediate Execution Priorities

**Purpose.** To identify, from the current repository and the Phase 6.1 assessment, the capabilities that require immediate attention — and to ground each in verified evidence.

**Why it exists.** The philosophy, framework, dependency model, and layers establish *how* to order work; this section applies them to the *actual current state* to name what stands first. It names capability areas and their status, not tasks, dates, or code.

**Scope.** Immediate priorities across five groupings. Each is grounded in repository evidence and labelled IMPLEMENTED / PARTIAL / NOT IMPLEMENTED / VERIFIED / UNVERIFIED. No completed capability is invented; where the runtime is unverified in-session, it is marked UNVERIFIED rather than claimed.

### A. Complete Existing Foundations
- **KV→SQL data authority (G1) — PARTIAL, UNVERIFIED as authoritative.** The migration engine exists (`migration/orchestrator.ts`, `reconciliation.ts`, `rollback.ts`, `checkpointStore.ts`, `quarantineStore.ts`, `normalizer.ts`, `kvReader.ts`) with a CLI (`migration:inventory/simulate/backfill/reconcile/pipeline`, `validate-s6.3`); KV remains the runtime authority. **Priority:** complete and verify the shadow-read/reconciled cutover so SQL becomes authoritative — the single most load-bearing foundation (Layer 3, Foundation-Critical).
- **Tenancy enforcement (G2) — PARTIAL.** `organizations`/memberships/settings and RLS migrations plus `tenancyRepository.ts` exist; `tenancyRepository.ts` notes JWT pass-through "when runtime cutover begins," i.e., enforced isolation across all paths is not yet the runtime authority. **Priority:** make enforced tenant isolation the verified runtime authority (Layer 2, Foundation-Critical).
- **Migration integrity — IMPLEMENTED (tooling), UNVERIFIED (full cutover).** Reconciliation and rollback exist; end-to-end authoritative cutover is unproven in-session. **Priority:** prove reconciliation-clean cutover with rollback rehearsed.

### B. Resolve Architectural Fragmentation
- **Repository/service consistency — PARTIAL.** A server repository layer (`repositories/`) and app services (`cortexDataService.ts`, `dataService.ts`) coexist with KV access; the concern is a single, consistent data-access path over authoritative data rather than divergent per-surface access. **Priority:** converge on one authoritative repository path (Layer 4, Platform-Enabling).
- **Duplicate/parallel engines — GUARD (no evidence of proliferation; enforce).** The engine layer under `src/app/core/` holds 30 `*Engine.ts` modules with distinct responsibilities; the priority is to *prevent* a second engine for an existing responsibility, not to remediate a known duplication. **Priority:** hold no-duplicate-architecture (Governance-Critical; §VI-19).
- **Mock-versus-production capability — PARTIAL.** The gateway registers `mockProvider` (Testing) alongside `openaiAdapter` (Unverified); mock paths must be unambiguously distinguished from production so no surface silently trusts a mock. **Priority:** make mock/production boundaries explicit and verified.

### C. Establish Enterprise Controls
- **Permission/role enforcement — PARTIAL.** `roleEngine.ts` and the constitutional authority model exist; runtime authorization enforcement across all server paths is maturing. **Priority:** enforce authority at every server boundary (Governance-Critical / Security).
- **Security controls — PARTIAL.** Supabase auth, RLS, and anon-policy hardening (`..._diagnostic_anon_policy_hardening.sql`) exist; no client-trusted authority may remain. **Priority:** verify server-side authority for all trust decisions (Security Gate, §VI-18).
- **Data ownership & traceability — PARTIAL.** Tenancy schema encodes ownership; end-to-end traceability of who-owns/who-changed is not yet instrumented enterprise-wide. **Priority:** establish verifiable data ownership and change traceability.

### D. Enable Reliable Product Execution
- **Product surface completeness — IMPLEMENTED (core journey) / PARTIAL (breadth).** The React/Vite surfaces and `src/system/manifest.ts` node graph back the core journey; some surfaces depend on authoritative data and enforced tenancy to be fully trustworthy. **Priority:** connect surfaces to authoritative, tenant-enforced state; eliminate client-trusted state (Layer 7, Product-Critical).
- **Disconnected/incomplete surfaces — PARTIAL.** Any surface reading unmigrated or client-held state is a reliability risk until Layers 2–3 are verified. **Priority:** gate such surfaces behind verified foundations rather than shipping false trust.

### E. Prepare the Intelligence Layer
- **Gateway adoption (provider neutrality) — PARTIAL, VERIFIED as single-provider.** The gateway is live and multiple server surfaces route through `featureBridge` (`cortexAnalysis.ts`, `cortexNarrative.ts`, `proposalSectionCopilot.ts`, `blockAiAssist.ts`, `cortexChat.ts`, `copilotPatch.ts`); `openaiAdapter` is registered Unverified, `mockProvider` Testing (G3). **Priority:** broaden to certified multi-provider neutrality with no direct-provider bypass (Layer 5, Platform-Enabling).
- **AI provider neutrality — PARTIAL.** Provider registry, certification, and model registry exist; only one real provider is registered. **Priority:** add and certify providers behind the existing abstraction — never around it.
- **Knowledge architecture — NOT IMPLEMENTED (as distinct system).** Decision authority today is the deterministic engine orchestra; a separate knowledge/decision substrate is not present. **Priority:** define the knowledge substrate before workforce reasoning depends on it (Layer 5).
- **Execution telemetry / operational diagnostics — PARTIAL (gateway) / NOT IMPLEMENTED (enterprise).** `intelligence/telemetry.ts` and `health.ts` instrument the gateway; enterprise-wide performance instrumentation is absent (G5). **Priority:** extend observability beyond the gateway before scaling (Layer 8, Operational-Enabling).

**Approved Execution State (immediate order of attention).** Group A (complete foundations: data authority + tenancy) and the Governance-Critical items in B/C stand first, because they are the hard prerequisites (§VI-13) for everything in D, E, and Layers 6–9. Group E's gateway breadth may advance in parallel as a Platform-Enabling stream (§VI-17) precisely because it soft-depends on, and does not block, the foundation work — but any intelligence that treats SQL as truth waits on Group A. Nothing in this section is a schedule; it is an order of precedence.

**Dependencies.** §VI-2/§VI-3/§VI-4 (states assessed); §VI-5 (G1–G8); §VI-13 (dependency order); §VI-14 (layers); §VI-12 (classes).

**Risks.** The central risk is beginning Group D/E-dependent or Layer 6+ work before Group A is VERIFIED — building on KV-authoritative, tenant-unenforced state. Marked UNVERIFIED items must not be reported as production-ready (§VI-19).

**Traceability.** Part I: `ARCHITECT.md`, `architecture/system_map.json`. Part II: DNA Ch 17/18/20/25/33. Part III: §III-29, §III-37, §III-44, §III-56–§III-65, §III-84–§III-88. Part IV: §IV-23–§IV-45, §IV-46–§IV-55. Part VI: §VI-2, §VI-5, §VI-13, §VI-14. Repository: `supabase/migrations/`, `supabase/functions/server/migration/`, `supabase/functions/server/repositories/`, `supabase/functions/server/intelligence/`, `src/app/core/`, `src/system/manifest.ts`, `package.json`.

**Completion Evidence.** Five priority groups (A–E) with each item grounded in a named repository artifact and status-labelled; the immediate order of attention stated; no invented capability, no task, no date.

---

## VI-16 — Deferred and Prohibited Early Work

**Purpose.** To define, explicitly, what must *not* be prioritized yet — and to classify why each item waits.

**Why it exists.** A prioritization is incomplete without its negative space. Naming what is out of bounds now prevents the most common execution failure: building visible, exciting, or expansive capability before its foundations exist (§VI-11). This section makes premature work a documented violation, not a judgment call.

**Scope.** Categories of work that are deferred, dependency-blocked, strategically unnecessary, or permanently rejected. Each is named with its reason and classification.

**Approved Execution State (early work that must wait, with reason).**

- **Autonomous AI executives — DEPENDENCY-BLOCKED.** Hard-blocked by Layers 2–5 (tenancy, data authority, governed gateway, knowledge substrate). Autonomy without verified authority violates authority-before-autonomy (§VI-11) and the deterministic-authority floor (DNA Ch 17/18).
- **Broad agent proliferation — DEPENDENCY-BLOCKED.** Many agents before one governed workforce runtime (Layer 6) multiplies ungoverned action. Wait for the `ai_worker` runtime and orchestration.
- **Marketplace expansion — DEFERRED (Layer 9).** Presupposes a complete, observable, trustworthy platform (Layers 1–8).
- **Complex ecosystem integrations — DEPENDENCY-BLOCKED / DEFERRED.** External integrations (CRM sync, e-sign, scheduling — G6) depend on authoritative data and enforced tenancy; broad ecosystem work is Layer 9.
- **Advanced predictive intelligence — DEPENDENCY-BLOCKED.** Prediction over unmigrated, unverified data (G1) amplifies error; blocked by Layer 3 and knowledge infrastructure (Layer 5).
- **Large-scale workflow automation — DEPENDENCY-BLOCKED.** Automation over untrustworthy state violates trust-before-automation; blocked by Layers 2–6.
- **International scale architecture — DEFERRED (Layer 9).** Scale multiplies faults; blocked until operational readiness (Layer 8) is verified.
- **Aggressive growth systems — DEFERRED (Layer 9).** Growth over an unobservable platform converts faults into outages.
- **Excessive dashboard expansion — STRATEGICALLY UNNECESSARY (now).** Dashboard volume is not value (value-before-volume, §VI-11); more surfaces over unverified data increase false-trust exposure without enterprise value.
- **Cosmetic feature volume — STRATEGICALLY UNNECESSARY (now).** Feature count is not a prioritization signal; cosmetic breadth is Optimization-class at best and waits behind foundations.
- **Duplicate engines / parallel architecture — PERMANENTLY REJECTED.** A second engine or data authority for an existing responsibility is prohibited outright (no-duplicate-architecture, §VI-19), not merely deferred.
- **Isolated AI integrations outside the gateway — PERMANENTLY REJECTED.** Any AI-provider path that bypasses the Intelligence Gateway is prohibited outright; all AI is routed through the gateway (no-direct-AI-provider-bypass, §VI-19).

**Classification of the deferrals.**
- **Permanently rejected** — duplicate engines/parallel architecture; isolated AI integrations outside the gateway. These are never in scope, at any layer; they violate invariant controls.
- **Deferred** — marketplace, international scale, aggressive growth, broad ecosystem breadth. Legitimate future work, sequenced to Layer 9 after foundations, product, and operations are verified.
- **Dependency-blocked** — autonomous executives, agent proliferation, predictive intelligence, large-scale automation. Approved in the blueprint but hard-blocked until their prerequisite layers are VERIFIED.
- **Strategically unnecessary (now)** — dashboard/cosmetic volume. Not blocked by dependency but by value: they deliver no enterprise value at the current stage and would divert from foundations.

**Dependencies.** §VI-13 (the hard dependencies that block); §VI-14 (the layers that defer); §VI-11 (the value system that deems some work unnecessary now); §VI-19 (the invariant controls that permanently reject).

**Risks.** Reclassifying a permanently-rejected item as merely deferred is itself a drift vector; the anti-drift controls treat gateway bypass and duplicate architecture as violations regardless of expedience.

**Traceability.** Part II: DNA Ch 17/18/25/33/35. Part III: §III-59–§III-65, §III-78–§III-80. Part IV: §IV-23–§IV-34, §IV-46–§IV-55, §IV-53. Part V: §V-1–§V-30 (deferred long-horizon direction). Part VI: §VI-11, §VI-13, §VI-14, §VI-19.

**Completion Evidence.** Twelve early-work items named with reasons; four-way classification (permanently rejected / deferred / dependency-blocked / strategically unnecessary) applied; each tied to a layer, dependency, or invariant control.

---

## VI-17 — Execution Streams

**Purpose.** To define the major parallel execution streams that can proceed concurrently without violating the dependency model, and to mark which must remain sequential.

**Why it exists.** Layers (§VI-14) express sequence; streams express *concurrency*. Much foundation work can proceed in parallel provided no stream consumes an unverified output of another. Naming the streams lets independent work advance without collision while the gates (§VI-18) hold the dependency line.

**Scope.** Nine execution streams, each with objective, scope, prerequisites, outputs, coordination requirements, risks, and completion evidence. Streams describe *what may proceed together*; they contain no tasks, assignments, or dates.

**Approved Execution State (streams).**

**1. Governance and Security**
- *Objective:* preserve constitutional authority and enforce server-side security/authorization.
- *Scope:* traceability, amendment discipline, auth/RLS/anon-hardening, elimination of client-trusted authority.
- *Prerequisites:* none upstream (Layer 1); enables all others.
- *Outputs:* verified governance traceability; enforced server-side authority.
- *Coordination:* sets constraints every other stream honors; the Security and Governance gates (§VI-18) draw evidence here.
- *Risks:* if under-resourced, drift and exposure go undetected.
- *Completion evidence:* server-side authority verified across paths; no locked-Part change outside amendment.

**2. Identity and Tenancy**
- *Objective:* make enforced tenant isolation and role enforcement the verified runtime authority (G2).
- *Scope:* `organizations`/memberships/settings, RLS, `tenancyRepository.ts`, JWT pass-through cutover, `roleEngine.ts` enforcement.
- *Prerequisites:* Stream 1 (Layer 1–2).
- *Outputs:* VERIFIED enforced tenancy across all paths.
- *Coordination:* hard prerequisite for Streams 3, 4, 6, 7; must lead them.
- *Risks:* cross-tenant exposure if downstream streams proceed before this is VERIFIED.
- *Completion evidence:* tenant isolation enforced and verified end-to-end.

**3. Data and Domain Architecture**
- *Objective:* make relational data authoritative with verified reconciliation (G1); coherent domain boundaries.
- *Scope:* KV→SQL cutover via `migration/` engine and CLI; reconciliation; rollback rehearsal; schema integrity.
- *Prerequisites:* Streams 1–2 (Layer 2–3, hard).
- *Outputs:* SQL authoritative and VERIFIED; reconciliation clean.
- *Coordination:* hard prerequisite for Streams 5 (as truth), 6, 7, 8.
- *Risks:* premature cutover or unrehearsed rollback risks data loss/corruption.
- *Completion evidence:* reconciliation-clean authoritative cutover with rollback proven.

**4. Core Platform and Backend Services**
- *Objective:* one consistent repository/service path over authoritative data; deterministic engines authoritative; no duplication.
- *Scope:* `repositories/`, `repositoryClient.ts`, app services, the 30-module engine layer.
- *Prerequisites:* Streams 2–3 (Layer 4).
- *Outputs:* consistent platform services; no duplicate engines/services.
- *Coordination:* consumed by Streams 6, 7; must not fork architecture (§VI-19).
- *Risks:* divergent per-surface data access re-introduces fragmentation.
- *Completion evidence:* single authoritative data path verified; no duplicate architecture.

**5. Intelligence Gateway and AI Infrastructure**
- *Objective:* certified multi-provider neutrality with telemetry/health; all AI through the gateway (G3).
- *Scope:* `gateway.ts`, `providerRegistry`, `certification`, `modelRegistry`, `telemetry`, `health`, `featureBridge`, additional certified providers behind the abstraction.
- *Prerequisites:* Layer 5; may **advance in parallel** with Streams 2–4 because it soft-depends on data (it narrates, it is not data-authority) — but any gateway use that treats SQL as truth waits on Stream 3.
- *Outputs:* multi-provider certified gateway; no direct-provider bypass.
- *Coordination:* hard prerequisite for Stream 6; feeds Stream 7 intelligence surfaces.
- *Risks:* adding providers around, not behind, the abstraction (permanently rejected, §VI-16).
- *Completion evidence:* ≥2 certified providers behind the registry; zero bypass paths.

**6. Knowledge and Decision Systems**
- *Objective:* define the knowledge/decision substrate the workforce reasons over; preserve deterministic authority.
- *Scope:* knowledge substrate design; decision provenance; AI-assists-never-overrides boundary.
- *Prerequisites:* Streams 3–5 (Layer 5, hard); precedes the workforce (Layer 6).
- *Outputs:* defined knowledge substrate; deterministic results remain authoritative.
- *Coordination:* hard prerequisite for the AI workforce runtime.
- *Risks:* letting AI reasoning override deterministic authority (violates DNA Ch 17/18).
- *Completion evidence:* substrate defined; deterministic-authority boundary verified.

**7. Product Experience and Workflow Enablement**
- *Objective:* complete customer-facing surfaces on authoritative, tenant-enforced state; eliminate client-trusted state and mock/production ambiguity.
- *Scope:* React/Vite surfaces, `src/system/manifest.ts`, workflow enablement over engines/services.
- *Prerequisites:* Streams 2–4 (hard for tenant-scoped surfaces); Stream 6 for workforce-driven surfaces.
- *Outputs:* trustworthy product surfaces; no false trust.
- *Coordination:* consumes Streams 2–6; must not ship surfaces over unverified state.
- *Risks:* presenting mock/unmigrated state as production (false customer trust).
- *Completion evidence:* surfaces verified over authoritative, tenant-enforced data.

**8. Quality, Observability and Operations**
- *Objective:* enterprise-wide telemetry, health, diagnostics, and traceability beyond the gateway (G5).
- *Scope:* extend `intelligence/telemetry.ts`/`health.ts` patterns enterprise-wide; test suites (`test:smoke/intelligence/database/migration/features`); operational diagnostics.
- *Prerequisites:* Streams 3–4 (observes real services); precedes scale (Layer 8→9).
- *Outputs:* unified observability; verified operational readiness.
- *Coordination:* cross-cuts all streams; gate evidence for Operational Readiness (§VI-18).
- *Risks:* scaling (Stream 9) before this is verified converts faults into outages.
- *Completion evidence:* enterprise observability and diagnostics verified.

**9. Deployment and Infrastructure Readiness**
- *Objective:* reliable, reversible deployment of authoritative schema and functions.
- *Scope:* `supabase:deploy`, `supabase:db-push`, migration/rollback deployment discipline.
- *Prerequisites:* Streams 3–4; constrained by in-session deployment limits (a deployment limitation, not an engineering failure — §VI-8).
- *Outputs:* verified, reversible deployment path.
- *Coordination:* supports all streams reaching production; Release Readiness gate evidence.
- *Risks:* irreversible deploys; treating deployment-limited verification as production-ready (§VI-19).
- *Completion evidence:* reversible deploy/rollback verified where the environment permits.

**Parallel vs. sequential.** Streams **1 (Governance/Security)** and, with it, the foundation-enabling parts of **8 (Observability tooling)** may run alongside everything as cross-cutting streams. Stream **5 (Gateway breadth)** may advance in **parallel** with Streams 2–4 (it soft-depends on data). Streams **2 → 3 → 4** are largely **sequential** for their load-bearing outputs (tenancy before authoritative data before consolidated services). Stream **6** is **sequential after** 3–5; Stream **7** is **sequential after** 2–4 (and 6 for workforce surfaces); Streams **8** (enterprise scope) and **9** provide readiness that gates **Layer 9**. No stream may consume another's UNVERIFIED output (§VI-13).

**Dependencies.** §VI-13 (hard/soft dependencies governing concurrency); §VI-14 (layers the streams execute within); §VI-18 (gates gating stream advancement).

**Risks.** The principal risk is a parallel stream consuming an unverified upstream output; the gates and the incomplete/unverified rule (§VI-13) hold the line.

**Traceability.** Part I: `ARCHITECT.md`. Part II: DNA Ch 17/18/20/25/33. Part III: §III-37, §III-44, §III-84–§III-88. Part IV: §IV-23–§IV-45, §IV-46–§IV-55. Part VI: §VI-13, §VI-14. Repository: `supabase/functions/server/`, `src/app/core/`, `src/system/manifest.ts`, `package.json`.

**Completion Evidence.** Nine streams fully specified; parallel-vs-sequential relationships stated; the no-unverified-consumption rule applied; no tasks, assignments, or dates introduced.

---

## VI-18 — Execution Gates

**Purpose.** To define the gates that work must pass before it advances — the verification checkpoints that convert the dependency model and layers into enforced control.

**Why it exists.** Sequence and streams describe intended order; gates enforce it. A gate is where a capability's readiness is *verified* (moving it from UNVERIFIED to VERIFIED) before downstream work that hard-depends on it may begin. Gates are the mechanism by which "no downstream on an unverified foundation" (§VI-13) becomes operative.

**Scope.** Eight gates. For each: purpose, entry conditions, required evidence, approval authority, failure response, exit conditions. **Approval authority is stated as constitutional roles/authorities from earlier Parts — no individuals are named.**

**Approved Execution State (gates).**

**Architecture Gate**
- *Purpose:* prevent duplicate/parallel architecture and confirm blueprint traceability.
- *Entry:* a capability proposes new structure (engine, service, data path, provider).
- *Required evidence:* the capability exists in the Blueprint; no existing engine/service/data-authority duplicates it; it converges, not forks, the architecture.
- *Approval authority:* the architectural authority established in Part I/Part IV (`ARCHITECT.md`; DNA Ch 25/30).
- *Failure response:* reject or redirect to the existing capability; no build proceeds.
- *Exit:* traceable, non-duplicative structure approved.

**Data Integrity Gate**
- *Purpose:* ensure downstream work consumes authoritative, reconciled data (G1).
- *Entry:* work depends on data as truth, or a cutover is proposed.
- *Required evidence:* reconciliation clean; shadow-read validated; rollback rehearsed; SQL authority VERIFIED where claimed.
- *Approval authority:* data/architecture authority (DNA Ch 18 data sovereignty).
- *Failure response:* hold downstream work; remain KV-authoritative until verified.
- *Exit:* authoritative data verified for the consuming capability.

**Security Gate**
- *Purpose:* verify server-side authority, auth, and the absence of client-trusted state.
- *Entry:* any change touching auth, authorization, or trust boundaries.
- *Required evidence:* trust decisions enforced server-side; RLS/anon policies verified; no client-trusted authority.
- *Approval authority:* security/governance authority (DNA Ch 18.9; Execution Rules).
- *Failure response:* block; the human high-consequence floor is inviolable.
- *Exit:* server-side authority verified.

**Governance Gate**
- *Purpose:* confirm subordination to the Constitution and LOCKED Parts, and traceability/attribution.
- *Entry:* any change; heightened for entrenched-core impact.
- *Required evidence:* change is constitution-subordinate, versioned, attributed, logged; entrenched-core changes invoke the amendment process (DNA Ch 35).
- *Approval authority:* constitutional/governance authority (DNA Ch 30.4, Ch 35).
- *Failure response:* block; require amendment for locked-Part impact.
- *Exit:* governance-conformant change approved.

**Product Readiness Gate**
- *Purpose:* ensure customer-facing surfaces present trustworthy, not false, state.
- *Entry:* a product surface is proposed for release.
- *Required evidence:* backed by authoritative, tenant-enforced data; no mock-as-production; customer journey stable (DNA Ch 33).
- *Approval authority:* product authority per Part III/Part IV.
- *Failure response:* gate the surface behind verified foundations.
- *Exit:* surface verified over trustworthy state.

**AI Readiness Gate**
- *Purpose:* ensure all AI is gateway-routed, provider-neutral, certified, and deterministic-subordinate.
- *Entry:* any AI capability or provider addition.
- *Required evidence:* routed through the gateway (no bypass); provider certified via `certification`/`modelRegistry`; deterministic results remain authoritative (AI assists, never overrides).
- *Approval authority:* intelligence/architecture authority per Part IV (§IV-23–§IV-34).
- *Failure response:* reject bypass or override; require gateway routing.
- *Exit:* governed, certified, deterministic-subordinate AI verified.

**Operational Readiness Gate**
- *Purpose:* ensure a capability can be observed, diagnosed, and recovered before it scales (G5).
- *Entry:* a capability approaches scale or production operation.
- *Required evidence:* telemetry/health/diagnostics present; traceability; rollback path; affected and regression tests pass (`test:*`; Test Protocol).
- *Approval authority:* operations authority per Part IV (§IV-46–§IV-55).
- *Failure response:* hold scaling until observability verified.
- *Exit:* operational readiness verified.

**Release Readiness Gate**
- *Purpose:* confirm a capability is complete, verified, and reversibly deployable.
- *Entry:* a capability is proposed for merge/release.
- *Required evidence:* clean build; affected + regression tests pass; reversible deployment (`supabase:deploy`/`db-push`) where the environment permits; no production claim without evidence; deployment-limited items marked UNVERIFIED, not production-ready.
- *Approval authority:* release/governance authority per Execution Rules and DNA Ch 30.
- *Failure response:* block release; return to the failing gate.
- *Exit:* verified, reversibly deployable capability approved for the mandatory merge workflow (§VI-19).

**Governing rule.** A gate converts a capability from UNVERIFIED to VERIFIED only on the stated evidence; no gate is passed by assertion. Downstream hard-dependent work may not begin until the gate its prerequisite passes is exited. Deployment-limited verification never yields a production-ready claim (§VI-8, §VI-19).

**Dependencies.** §VI-13 (the dependencies gates enforce); §VI-14 (layer boundaries the gates guard); §VI-17 (streams the gates advance); §VI-9 (execution principles the gates operationalize).

**Risks.** A gate passed by assertion rather than evidence silently re-admits the failure it exists to prevent; the anti-drift controls (§VI-19) require the evidence to be recorded, not claimed.

**Traceability.** Part I: `ARCHITECT.md`. Part II: DNA Ch 18.9/25/30/33/35. Part III: §III-75, §III-84–§III-88. Part IV: §IV-23–§IV-34, §IV-35–§IV-45, §IV-46–§IV-55. Part VI: §VI-9, §VI-13. Roadmap: `MARQ_CORTEX_EXECUTION_RULES.md`, `MARQ_CORTEX_TEST_PROTOCOL.md`.

**Completion Evidence.** Eight gates defined with purpose, entry, evidence, authority (as roles, not individuals), failure response, and exit; the evidence-not-assertion rule stated; gates tied to dependencies, layers, and streams.

---

## VI-19 — Sequencing Principles and Anti-Drift Controls

**Purpose.** To define the controls that keep execution converging on the blueprint, and to establish the mandatory repository workflow for every remaining Blueprint phase.

**Why it exists.** Sequence, streams, and gates can all be undermined by drift — duplicate architecture, gateway bypass, client-trusted authority, unverified production claims, phase-jumping, branch accumulation, undocumented decisions. This section makes those failures explicit prohibitions and binds the process by which phases advance.

**Scope.** The anti-drift controls (invariants) and the mandatory phase workflow. These are rules binding all later Part VI phases; they define no tasks and no dates.

**Approved Execution State (anti-drift controls — invariants).**

- **Blueprint traceability.** Every capability traces to an approved Blueprint section before it is built; the Blueprint is the authority, code the implementation.
- **Phase-entry checks.** A phase begins only after verifying its prerequisites are merged and VERIFIED (the Architecture/Data/Governance gates, §VI-18).
- **Dependency verification.** No downstream work begins on an incomplete or UNVERIFIED prerequisite (§VI-13).
- **No duplicate architecture.** No second engine, service, or data authority for an existing responsibility. *Permanently rejected* (§VI-16).
- **No direct AI-provider bypass.** All AI is routed through the Intelligence Gateway; no provider is called around the abstraction. *Permanently rejected* (§VI-16).
- **No client-trusted authority.** Trust and authorization decisions are enforced server-side; the client is never the authority.
- **No implementation without ownership.** No capability is built without a clear owning domain/authority in the architecture (§VI-13, §VI-18).
- **No production claims without verification.** Nothing is called production-ready without gate evidence; deployment-limited work is marked UNVERIFIED (§VI-8, §VI-18).
- **No new phase before the prior phase is merged and verified.** Phases advance only through the mandatory workflow below.
- **No branch accumulation.** One phase, one working branch, merged and not left to accumulate; no stacking of unmerged phases (this phase's branch is `claude/marq-cortex-part-vi-phase-6-2`).
- **No locked-Part modification without formal amendment.** Parts I–V and the Constitution change only via the heightened amendment process (DNA Ch 35) — never by implementation choice.
- **No roadmap inflation.** No milestones, dates, staffing, or numeric KPIs are added to this strategic phase; scope is not inflated beyond the Blueprint.
- **No undocumented architectural decisions.** Every architectural decision is recorded in the Blueprint or its governed records; none is implicit in code alone.

**Approved Execution State (mandatory repository workflow).** For every remaining Blueprint phase, work advances in exactly this order, and only in this order:

1. **Complete phase** — author/implement the phase in full against the Blueprint.
2. **Review** — verify against the gates (§VI-18) and the validation checklist for the phase.
3. **Commit** — record the change with a clear, attributed message.
4. **Push** — publish the single phase branch.
5. **Open pull request** — targeting `main`.
6. **Merge into main** — after review approval.
7. **Verify canonical main** — confirm `main` now contains the phase, in canonical order, with no regressions.
8. **Begin next phase** — only now, and from the verified `main`.

**This workflow is mandatory for all remaining Blueprint phases.** No phase may skip a step, and step 8 (begin next phase) is gated on step 7 (verified canonical main) — enforcing "no new phase before the prior phase is merged and verified."

**Dependencies.** §VI-9 (execution principles); §VI-13 (dependency verification); §VI-16 (permanently-rejected work); §VI-18 (gates the controls invoke); the Constitution (DNA Ch 30/35) and Execution Rules.

**Risks.** Each control names a real drift vector observed in complex builds; relaxing any one re-opens that vector. The controls are invariant, not situational.

**Traceability.** Part II: DNA Ch 8.3/17/18/25/30/33/35. Part III: §III-75, §III-84–§III-88. Part IV: §IV-5, §IV-44, §IV-54. Part VI: §VI-9, §VI-13, §VI-16, §VI-18. Roadmap: `MARQ_CORTEX_EXECUTION_RULES.md`, `MARQ_CORTEX_DOCUMENTATION_RULES.md`, `MARQ_CORTEX_TEST_PROTOCOL.md`.

**Completion Evidence.** Thirteen anti-drift invariants stated; the eight-step mandatory workflow established as binding on all remaining phases with step 8 gated on verified canonical main; no tasks or dates introduced.

---

## VI-20 — Phase 6.2 Summary and Completion Record

**Purpose.** To summarize Phase 6.2 and record its completion without beginning Phase 6.3 or locking Part VI.

**Why it exists.** A phased document needs an explicit boundary so the *prioritization and sequencing architecture* is not mistaken for a plan of record with dates, and so Phase 6.3 begins from a settled, merged foundation.

**Scope.** A summary of Phase 6.2 only (§VI-11–§VI-20) and its completion record.

**Summary.**
- **Prioritization model (§VI-11–§VI-12).** A philosophy (value before volume; foundations before expansion; trust before automation; authority before autonomy; data integrity before intelligence; reuse before isolated features; dependency-aware sequencing; operational readiness before scaling; anti-drift; blueprint preservation) operationalized by a qualitative framework of fourteen evaluation dimensions and eight priority classes (Foundation-Critical, Governance-Critical, Product-Critical, Platform-Enabling, Operational-Enabling, Growth-Enabling, Optimization, Deferred) — no numeric scores.
- **Dependency model (§VI-13).** A fourteen-domain dependency chain grounded in the repository, distinguishing hard (blocking) from soft (advisory) dependencies, with the rule that no downstream work proceeds on an incomplete or UNVERIFIED prerequisite.
- **Enterprise execution layers (§VI-14).** Nine ordered layers from Constitutional/Governance Integrity to Scale/Ecosystem/Market Expansion, each with purpose, precedence, outcomes, dependencies, skip-risk, and Parts III–V relationship — a sequence of readiness, never dates.
- **Immediate priorities (§VI-15).** Five groups (complete foundations; resolve fragmentation; establish enterprise controls; enable reliable product execution; prepare intelligence), each item grounded in named repository artifacts and status-labelled, with data authority (G1) and enforced tenancy (G2) standing first.
- **Deferred work (§VI-16).** Twelve early-work items classified as permanently rejected, deferred, dependency-blocked, or strategically unnecessary now.
- **Execution streams (§VI-17).** Nine streams with objectives, prerequisites, outputs, coordination, risks, and completion evidence, and their parallel-vs-sequential relationships.
- **Gates (§VI-18).** Eight gates (Architecture, Data Integrity, Security, Governance, Product Readiness, AI Readiness, Operational Readiness, Release Readiness), each with entry, evidence, role-based authority, failure response, and exit.
- **Anti-drift controls (§VI-19).** Thirteen invariants and the mandatory eight-step repository workflow (complete → review → commit → push → open PR → merge → verify canonical main → begin next phase), binding on all remaining phases.

**Current State.** All CURRENT STATE claims in this phase are grounded in the repository verified for Phase 6.2 or in the LOCKED Parts I–V; foundations are PARTIAL/UNVERIFIED where the runtime is not yet authoritative (data authority, tenancy), PARTIAL where breadth is incomplete (gateway providers, product surfaces, observability), and NOT IMPLEMENTED where absent (AI workforce runtime, enterprise instrumentation, distinct knowledge system). Nothing is invented.

**Approved Execution State.** A dependency-true, gate-governed sequence — foundations (governance, tenancy, data integrity) first; platform, intelligence, workforce, product, operations, and scale in verified order — realizing the direction LOCKED in Part V without editing it, and advancing only through the mandatory workflow.

**Completion Record.**
- Phase 6.2 authored.
- Sections VI-11 through VI-20 present, exactly once, in continuous numbering after §VI-10.
- No previously LOCKED Part (I–V) modified.
- Phase 6.1 (§VI-1–§VI-10) preserved unchanged.
- No implementation performed; no application code modified.
- No sprint schedule created.
- No calendar dates assigned; no staffing, hours, or numeric KPIs assigned.
- Repository claims grounded in evidence and status-labelled.
- Phase 6.3 not begun; Part VI not locked.

**Dependencies.** All Phase 6.2 sections (§VI-11–§VI-19); Phase 6.1 (§VI-1–§VI-10); Parts I–V (LOCKED) and the Constitution.

**Traceability.** Part II: DNA Ch 8.3/17/18/25/30/33/35. Part III: §III-15–§III-88. Part IV: §IV-1–§IV-55. Part V: §V-1–§V-30. Part VI: §VI-1–§VI-19. Roadmap: `MARQ_CORTEX_ROADMAP.md`, `MARQ_CORTEX_EXECUTION_RULES.md`, `MARQ_CORTEX_TEST_PROTOCOL.md`, `MARQ_CORTEX_DOCUMENTATION_RULES.md`.

**Completion Evidence.** This record; the presence of §VI-11–§VI-20; the unchanged Phase 6.1 and Parts I–V; the absence of any dates, tasks, assignments, or numeric KPIs.

---

**Phase 6.2 Status: COMPLETE**

**Part VI remains: IN PROGRESS**

**Continuity note.** The Master Blueprint remains a single, continuous document. Parts I–V remain LOCKED and unchanged; Phase 6.1 (§VI-1–§VI-10) is preserved. Phase 6.2 (§VI-11–§VI-20) is authored and complete but not locked. The next Part VI phase (6.3) is not begun here.

*End of Phase 6.2. Part VI continues in a later phase.*

---

## Phase 6.3 — Capability Delivery Roadmap & Release Sequencing

**Status:** COMPLETE (Phase 6.3) · Part VI remains IN PROGRESS · **Numbering:** Sections VI-21 through VI-30, continuing the single-document numbering after Phase 6.2 (§VI-11–§VI-20); numbering is never restarted. · **Continuity:** Phase 6.3 appends to the same Master Blueprint. Parts I–V remain LOCKED and are neither modified, restated, nor contradicted here; Phase 6.1 (§VI-1–§VI-10) and Phase 6.2 (§VI-11–§VI-20) are preserved unchanged (Preservation rule; Golden Rules 1 and 8).

**Purpose of this phase.** Phase 6.2 settled *what* MARQ Cortex builds and *in what order* — the prioritization philosophy and classes (§VI-11–§VI-12), the dependency model (§VI-13), the nine execution layers (§VI-14), the immediate priorities (§VI-15), the deferred and prohibited early work (§VI-16), the execution streams (§VI-17), the gates (§VI-18), and the anti-drift controls and mandatory workflow (§VI-19). Phase 6.3 answers the single question that follows once those priorities are approved: **how does MARQ Cortex deliver enterprise capabilities safely and progressively into production?** It converts an approved sequence into a disciplined capability *delivery model* — the shape of the increments that ship, the waves that group them, the readiness that admits them, the synchronization that coordinates them, the release categories that promote them, the incremental principles that keep the platform whole, the validation evidence that precedes production, and the constitutional approval that authorizes release.

**What this phase is.** An enterprise delivery architecture — a capability-first delivery philosophy (§VI-21), the capability wave model (§VI-22), qualitative release-readiness criteria (§VI-23), cross-stream delivery synchronization (§VI-24), the capability unlock matrix that sequences delivery (§VI-25), the enterprise release model and its categories (§VI-26), the incremental delivery principles that keep Cortex whole as it grows (§VI-27), the release-validation evidence set (§VI-28), and release governance under existing constitutional authority (§VI-29), closed by a completion record (§VI-30).

**What this phase is not.** Phase 6.3 does **not** redefine priorities, dependencies, governance, security, or the gates — those are LOCKED in place by Phase 6.2 and Parts I–V and are only *applied* here. It is not a sprint plan, a milestone chart, a release calendar, a ticket backlog, a staffing model, an engineering estimate, or an implementation task list. It assigns no dates, no story points, no owners, no hours, and it writes no code. It describes how capability increments move from a verified state to production; it does not perform that movement. Phase 6.4 is not begun here, and Part VI is not locked.

**Grounding.** The delivery model below is grounded in the same repository verified for Phase 6.2 — the deterministic engine layer under `src/app/core/` (30 `*Engine.ts` modules), the Intelligence Gateway under `supabase/functions/server/intelligence/` (`gateway.ts`, `providerRegistry.ts`, `certification.ts`, `modelRegistry.ts`, `telemetry.ts`, `health.ts`, `featureBridge.ts`, and `providers/`), the server repository layer under `supabase/functions/server/repositories/`, the migration engine under `supabase/functions/server/migration/`, the SQL migrations under `supabase/migrations/`, the tenancy and anon-policy hardening in those migrations, the test suites declared in `package.json`, and the deployment scripts (`supabase:deploy`, `supabase:db-push`) — together with the LOCKED Parts I–V and the Constitution. Delivery labels (RELEASABLE / NOT-YET-RELEASABLE, VERIFIED / UNVERIFIED, REVERSIBLE / IRREVERSIBLE) are used where they add precision. Nothing is invented ahead of its phase (Golden Rule 5).

---

## VI-21 — Enterprise Delivery Philosophy

**Purpose.** To define how MARQ Cortex *delivers* an approved capability — the philosophy of capability-first delivery — distinct from how it *prioritizes* (§VI-11) or *sequences* (§VI-13–§VI-14) that capability.

**Why it exists.** Phase 6.2 decides order; it says nothing about the *unit* in which work reaches production. Without a delivery philosophy, an approved priority degrades into a stream of isolated commits — a tenancy column here, a gateway provider there, a product surface elsewhere — each individually plausible and collectively incoherent. This section fixes the delivery unit so that what ships is always a whole, load-bearing capability rather than a fragment of one.

**Scope.** The delivery value system only. It names no wave, defines no release category, and sets no readiness bar; those derive from this philosophy in §VI-22 onward.

**Approved Delivery State (governing principles).**

- **Capability-first, not feature-first.** The unit of delivery in Cortex is the **capability increment** — a cohesive slice that carries one load-bearing capability (for example, *enforced tenancy*, *authoritative relational data*, *governed intelligence through the gateway*) to a verified, operable, reversibly deployable state across every stream it touches. A capability increment is never "a feature"; it is the smallest change that leaves the platform *more whole* than before, not merely larger.
- **Cohesive platform increments over isolated features.** Enterprise capabilities are delivered as platform increments precisely because Cortex is a platform, not a collection of surfaces: the deterministic engines, the Intelligence Gateway, the repository layer, the migration engine, and the tenancy boundary are shared by many consumers. Shipping an isolated feature over one of these before the underlying platform capability is whole strands the feature on an unfinished foundation and forks the architecture (§VI-16, §VI-19). A cohesive increment advances the platform capability *and* the surface that proves it, together.
- **Delivery realizes priority; it never re-opens it.** Every increment realizes an already-approved priority (§VI-15) in its already-approved position (§VI-13–§VI-14). Delivery introduces no new priority, no new dependency, and no new governance rule. Where delivery reveals that a locked decision is genuinely unworkable, the heightened amendment path (DNA Ch 35) is the only recourse — never an ad-hoc delivery choice.
- **Progressive over big-bang.** No capability arrives in a single decisive cutover. Cortex advances by increments that are individually verifiable and individually reversible, so that trust accumulates and blast radius stays bounded — the delivery-side expression of *trust before automation* and *foundations before expansion* (§VI-11).
- **Whole-increment accountability.** An increment is "delivered" only when it is verified end to end — data authority proven, tenancy enforced, gateway-routed where AI is involved, observable, and reversible — not when its code merges. Partial delivery reported as complete is the failure this philosophy exists to prevent (§VI-8, §VI-19).

**Clarification (what a capability increment is not).** A capability increment is not a UI addition, a single migration, or one gateway provider considered in isolation. Those are *components* of an increment. The increment is the coherent set of component changes — across data, platform, intelligence, governance, operations, and product as applicable — that together move one capability from UNVERIFIED to RELEASABLE without leaving any consuming stream stranded.

**Dependencies.** §VI-11 (the value system delivery realizes); §VI-14 (the layers increments advance within); §VI-17 (the streams an increment coordinates across); §VI-19 (the anti-drift controls delivery must not violate); the LOCKED Constitution (DNA Ch 17/18/25/35).

**Risks.** If delivery reverts to feature-first, Cortex accumulates surfaces faster than foundations, isolated features strand on unfinished platform capability, and the architecture forks — the exact drift §VI-16 and §VI-19 prohibit. The wave model (§VI-22) and readiness criteria (§VI-23) hold the increment whole.

**Traceability.** Part II: DNA Ch 8.3/17/18/25/33/35. Part III: §III-15–§III-88. Part IV: §IV-23–§IV-55. Part VI: §VI-11, §VI-14, §VI-17, §VI-19. Repository: `src/app/core/`, `supabase/functions/server/intelligence/`, `supabase/functions/server/repositories/`, `supabase/functions/server/migration/`, `supabase/migrations/`.

---

## VI-22 — Capability Wave Model

**Purpose.** To define the **capability wave** — the delivery cohort in which related capability increments (§VI-21) move toward production together — and to describe what belongs in each wave and why each exists.

**Why it exists.** The nine execution layers (§VI-14) express *readiness sequence*; the execution streams (§VI-17) express *concurrency*. Neither describes the *delivery cohort*: the set of increments that share a readiness frontier and are therefore promoted as one coherent advance rather than dribbled out piecemeal. A wave is that cohort. Waves exist so that delivery has a grain coarse enough to be coherent (a whole capability frontier moves) yet fine enough to stay reversible (a bounded set of increments, not the whole blueprint).

**Distinction from layers.** A layer is a *position in the readiness order*; a wave is a *unit of delivery* that draws its increments from one or more layers once those layers' load-bearing outcomes are VERIFIED. Waves do not renumber, replace, or reorder the layers — they ride on them. A wave never crosses ahead of the dependency line the layers and gates hold (§VI-13, §VI-18).

**Approved Wave Model (no dates, no milestones).**

- **Foundation Wave.** *Contains:* the increments that make the substrate authoritative and bounded — enforced tenancy and the relational data plane as the single source of truth (G1, G2), with the migration engine's expand/contract path proven. *Why it exists:* every later wave treats this substrate as truth; delivering it as one cohort prevents any downstream surface from shipping over KV-authoritative or tenant-unenforced state. This wave is the delivery-side gate to all others.
- **Platform Wave.** *Contains:* the reusable-leverage increments — Intelligence Gateway breadth behind its single abstraction, consolidation of the repository/service layer, and hardening of the shared engines. *Why it exists:* platform capability is reused by many consumers; delivering it as a cohort lets intelligence, workforce, and product waves draw on a stable, single platform contract rather than forking one.
- **Intelligence Wave.** *Contains:* governed narration, analysis, and reasoning delivered strictly through the gateway over authoritative data. *Why it exists:* intelligence is only as sound as the substrate beneath it; this wave is admissible only after the Foundation and Platform waves are RELEASABLE, honoring *data integrity before intelligence* (§VI-11).
- **Workforce Wave.** *Contains:* the `ai_worker` runtime and its orchestration — the governed enterprise workforce increments. *Why it exists:* autonomy requires a settled authority model; this wave rides on verified data authority, tenancy, and gateway governance, honoring *authority before autonomy* (§VI-11, §VI-16).
- **Product Wave.** *Contains:* the enterprise product surfaces and workflows that prove the capability to customers, delivered over verified state. *Why it exists:* surfaces demonstrate value but never establish truth; this wave follows, never precedes, the foundations it renders.
- **Operations Wave.** *Contains:* the enterprise instrumentation, observability, diagnosability, and operability increments. *Why it exists:* scale over an unobservable system converts small faults into outages; this wave delivers the ability to operate what earlier waves built, gating any growth wave (§VI-11, operational readiness before scaling).
- **Strategic / Ecosystem Wave.** *Contains:* the scale, external-integration, and market-expansion increments. *Why it exists:* breadth over the outside world is admissible only once the interior is authoritative, governed, and observable; this is the last cohort by construction (Layer 9).

**Governing rule.** A wave becomes eligible for delivery only when the layers it draws from have their load-bearing outcomes VERIFIED (§VI-13, §VI-14) and its readiness criteria (§VI-23) are met. Waves are cohorts of *readiness*, never cohorts of *calendar*: this section assigns no dates, no milestones, and no sequence numbers beyond the dependency order already fixed in Phase 6.2.

**Dependencies.** §VI-14 (the layers waves ride on); §VI-13 (the dependency line waves must not cross); §VI-17 (the streams whose increments a wave gathers); §VI-23 (the readiness that admits a wave); §VI-26 (the release categories that promote a wave).

**Risks.** The dominant risk is a wave promoted ahead of its readiness frontier — an Intelligence or Product Wave shipping over an unverified Foundation Wave. The readiness criteria (§VI-23) and gates (§VI-18) exist to refuse exactly this.

**Traceability.** Part II: DNA Ch 17/18/20/25/33. Part III: §III-29, §III-37, §III-44, §III-56–§III-65, §III-84–§III-88. Part IV: §IV-23–§IV-55. Part VI: §VI-13, §VI-14, §VI-17. Repository: `supabase/migrations/`, `supabase/functions/server/migration/`, `supabase/functions/server/repositories/`, `supabase/functions/server/intelligence/`, `src/app/core/`.

---

## VI-23 — Release Readiness Criteria

**Purpose.** To define, qualitatively, what must be true before a capability wave (§VI-22) is considered **releasable** — the readiness bar that admits a wave to production.

**Why it exists.** A wave is coherent as a delivery cohort but that coherence says nothing about whether it is *safe to release*. Release readiness is the standing test that converts a wave from NOT-YET-RELEASABLE to RELEASABLE. It exists so that release is a judgment against stated evidence, never a judgment against pressure, appetite, or the visible completeness of a surface.

**Scope.** The qualitative readiness bar only. It defines no numeric threshold, no coverage percentage, no score, and no schedule; it states the conditions that must hold.

**Approved Release Readiness Criteria (qualitative).** A wave is RELEASABLE only when all of the following hold — as demonstrated evidence, not assertion:

- **Foundational truth is verified.** Every capability in the wave that treats data as truth reads from the authoritative relational plane, not from KV or client-held state; where the wave touches tenancy, isolation is demonstrated, not assumed (§VI-15, G1/G2).
- **Governance and security authority hold end to end.** No trust decision in the wave is made client-side; all authority is server-verified, and every AI path is routed through the Intelligence Gateway with no direct-provider bypass (§VI-16, §VI-19).
- **The wave is reversible.** Each increment in the wave can be withdrawn or rolled back without stranding data or consumers — schema changes follow the expand/contract discipline, and no step depends on an irreversible cutover (§VI-27).
- **The wave is observable.** The capability emits enough signal — health, telemetry, certification state — to be diagnosed and operated in production; a wave that cannot be observed is not releasable regardless of functional completeness (§VI-11, operational readiness).
- **Compatibility is preserved.** The wave does not break an existing platform contract — the gateway abstraction, the repository interface, the engine responsibilities — and existing consumers continue to function across the increment (§VI-27).
- **No architecture drift is introduced.** The wave adds no second engine, no parallel data authority, and no AI path around the gateway; it converges the architecture toward the blueprint rather than forking it (§VI-19).
- **The blueprint is preserved.** The wave realizes LOCKED Parts I–V without editing them; any tension with a locked decision is resolved through amendment (DNA Ch 35), not through the release.
- **Its gates are exited on evidence.** Every gate the wave's capabilities depend on (§VI-18) has been passed on recorded evidence — not by claim — moving each capability from UNVERIFIED to VERIFIED.

**Governing rule.** Readiness is *all-of*, not *most-of*: a wave that satisfies every criterion but reversibility, or every criterion but observability, is NOT-YET-RELEASABLE. There is no partial-credit release. Deployment-limited verification never yields a RELEASABLE claim (§VI-8, §VI-19).

**Dependencies.** §VI-22 (the waves this bar admits); §VI-18 (the gates whose exit this bar requires); §VI-15/§VI-16 (the foundational and prohibited-drift conditions); §VI-27 (reversibility and compatibility); §VI-28 (the validation evidence that substantiates these criteria).

**Risks.** The central risk is treating readiness as a percentage — declaring a wave "90% ready" and shipping. This section forecloses that: readiness is qualitative and all-of. The validation set (§VI-28) supplies the evidence each criterion is tested against.

**Traceability.** Part II: DNA Ch 18.9/25/30/33/35. Part III: §III-75, §III-84–§III-88. Part IV: §IV-35–§IV-55. Part VI: §VI-8, §VI-15, §VI-16, §VI-18. Roadmap: `MARQ_CORTEX_TEST_PROTOCOL.md`, `MARQ_CORTEX_EXECUTION_RULES.md`.

---

## VI-24 — Cross-Stream Synchronization

**Purpose.** To explain how the Platform, AI, Data, Governance, Operations, and Product streams coordinate their increments *during delivery* so that a wave arrives as one coherent advance.

**Why it exists.** The dependency theory (§VI-13) and the stream definitions and their parallel-vs-sequential relationships (§VI-17) are already fixed and are not restated here. What remains is a delivery problem: several streams contributing increments to the *same* wave must converge at the same readiness frontier, or the wave fractures — data lands without the governance to bound it, or a product surface lands ahead of the authoritative data it renders. This section describes that convergence.

**Scope.** Coordinated delivery only — synchronization points, shared contracts, and convergence. It repeats no dependency direction and re-derives no ordering.

**Approved Synchronization Model.**

- **Stream mapping.** For delivery purposes the streams of §VI-17 present as six delivery faces — **Data** (tenancy, relational authority, migration engine), **Platform** (gateway, repository/service consolidation, shared engines), **AI** (governed intelligence and, later, the `ai_worker` workforce), **Governance** (the cross-cutting security/governance stream), **Operations** (observability and operability), and **Product** (enterprise surfaces). Governance and Operations are cross-cutting: they contribute to every wave rather than to one.
- **Synchronization points.** Streams converge at a small number of named **delivery synchronization points** rather than continuously. The principal points are the shared **contracts**: the relational data contract (what the authoritative plane guarantees), the repository interface, and the Intelligence Gateway contract. An increment in one stream is synchronized when it satisfies the contract every other stream consumes — not when its own code is done.
- **Contract-first convergence.** Streams synchronize *through contracts, not through calendars*. The Data stream publishes an authoritative-data guarantee; the Platform stream freezes the gateway and repository interfaces the wave depends on; the AI and Product streams build only against those frozen contracts. This is why breadth in the Platform stream (gateway providers) can proceed in parallel with Data work — it consumes the contract, not the unfinished implementation (§VI-17).
- **Cross-cutting streams synchronize continuously.** Governance and Operations do not wait for a synchronization point; they attach to every increment as it forms — governance verifying server-side authority and gateway routing, operations verifying observability — so that no increment reaches a wave's readiness frontier without them.
- **Convergence at the wave frontier.** A wave is *synchronized* when every contributing stream's increments meet the same readiness bar (§VI-23) at the same frontier. Until then the wave is held; a stream that lags does not ship its part early and does not force the others to wait in an unverified state — it converges or the wave waits.

**Governing rule.** Synchronization is achieved by satisfying shared contracts, never by co-scheduling work. No stream consumes another stream's UNVERIFIED output to appear synchronized (§VI-13). A wave that cannot converge all contributing streams at one readiness frontier is not yet a deliverable wave.

**Dependencies.** §VI-17 (the streams and their concurrency, not restated); §VI-13 (the dependency line synchronization must respect); §VI-22 (the waves streams converge into); §VI-23 (the readiness frontier convergence targets); §VI-18 (the gates that record convergence evidence).

**Risks.** The chief risk is *false synchronization* — declaring a wave converged while one stream's contribution is UNVERIFIED, or synchronizing by schedule rather than by contract. The contract-first rule and the gates (§VI-18) hold the line.

**Traceability.** Part I: `ARCHITECT.md`. Part II: DNA Ch 17/18/20/25/33. Part III: §III-37, §III-44, §III-84–§III-88. Part IV: §IV-23–§IV-55. Part VI: §VI-13, §VI-17, §VI-18. Repository: `supabase/functions/server/`, `src/app/core/`, `src/system/manifest.ts`.

---

## VI-25 — Capability Dependency Matrix

**Purpose.** To describe, for delivery purposes, how a *completed* (RELEASABLE) capability unlocks the next capabilities — the unlock relationships that sequence delivery.

**Why it exists.** Phase 6.2 fixed the dependency graph (§VI-13) as an ordering constraint — what may not begin before what. This section is the delivery-facing complement: not "what blocks what," but "what *becomes deliverable* once a given capability is released." The same relationships read forward, as enablers, not backward, as constraints. It exists so that delivery can see, at any moment, which waves the most recent release has just made admissible.

**Scope.** Delivery-sequencing unlocks only. It neither recreates the fourteen-domain dependency chain of §VI-13 nor re-labels hard/soft dependencies; it reads them as delivery enablers.

**Approved Unlock Matrix (delivered capability → what it makes deliverable).**

- **Enforced tenancy (delivered)** → unlocks *any multi-tenant delivery at all*: authoritative data with tenant isolation, tenant-scoped product surfaces, and per-tenant governed intelligence. Until tenancy is RELEASABLE, no wave that persists or renders tenant data is deliverable.
- **Authoritative relational data (delivered)** → unlocks the **Intelligence Wave** and the data-dependent parts of the **Product Wave**: narration and analysis may now treat SQL as truth, and surfaces may render verified state. This is the single most enabling release in the model.
- **Migration engine proven (delivered)** → unlocks *reversible* delivery of every subsequent schema-bearing increment; without it, later data changes cannot be delivered safely (§VI-27).
- **Intelligence Gateway breadth (delivered)** → unlocks governed multi-provider intelligence and is a prerequisite release for the **Workforce Wave**: the `ai_worker` runtime consumes the gateway, never a provider directly.
- **Governed intelligence (delivered)** → unlocks the **Workforce Wave** and intelligence-backed product surfaces: agentic behavior may now be layered over a verified authority model (§VI-11, authority before autonomy).
- **AI workforce runtime (delivered)** → unlocks workforce-driven product workflows and the automation-bearing parts of later waves.
- **Enterprise observability (delivered)** → unlocks the **Strategic / Ecosystem Wave**: scale, external integration, and market expansion become deliverable only once the interior is operable (§VI-11, operational readiness before scaling).

**Reading the matrix.** Each unlock is *release-gated, not begin-gated*: the enabled wave becomes *deliverable* when the enabling capability is RELEASABLE (§VI-23), which is a stronger condition than the enabling work merely having *begun*. This is the delivery-side sharpening of §VI-13's rule that no downstream work proceeds on an UNVERIFIED prerequisite — here, no downstream capability is *released* until its enabler is released.

**Dependencies.** §VI-13 (the dependency relationships read forward here); §VI-22 (the waves these unlocks admit); §VI-23 (the RELEASABLE condition that fires each unlock); §VI-24 (the synchronization that assembles each unlocked wave).

**Risks.** The risk is treating an unlock as fired by *started* rather than *released* enabling work — beginning to release a Product or Intelligence wave because its Foundation enabler is "in progress." The RELEASABLE condition forecloses this.

**Traceability.** Part II: DNA Ch 17/18/25/33. Part III: §III-56–§III-65, §III-84–§III-88. Part IV: §IV-23–§IV-45. Part VI: §VI-13, §VI-22, §VI-23. Repository: `supabase/migrations/`, `supabase/functions/server/intelligence/`, `supabase/functions/server/repositories/`, `supabase/functions/server/migration/`.

---

## VI-26 — Enterprise Release Model

**Purpose.** To define the enterprise **release categories** — the classes of promotion event by which a wave (§VI-22) enters production — and to explain the purpose of each.

**Why it exists.** A wave is a delivery cohort; a *release* is the act of promoting that cohort, or an admissible part of it, into production under governance. Naming release categories gives each promotion a defined purpose, a defined readiness expectation, and a defined approving authority (§VI-29), so that "releasing" is never an undifferentiated push but a typed, governed event.

**Scope.** Release categories and their purposes only. No category carries a date, a cadence, a version number, or a schedule.

**Approved Release Categories.**

- **Foundation Release.** *Promotes:* the Foundation Wave — enforced tenancy and authoritative relational data with the migration engine proven. *Purpose:* to establish trustworthy, bounded substrate in production so that every later release stands on verified truth. This is the enabling release of the entire model; nothing intelligence- or product-facing is released before it.
- **Platform Release.** *Promotes:* the Platform Wave — gateway breadth, repository/service consolidation, shared-engine hardening. *Purpose:* to put reusable platform leverage into production behind stable contracts, so that intelligence, workforce, and product releases draw on one platform rather than forking one.
- **Intelligence Release.** *Promotes:* the Intelligence Wave — governed narration, analysis, and reasoning through the gateway over authoritative data. *Purpose:* to deliver enterprise intelligence that is sound because the substrate beneath it is verified and every AI path is governed.
- **Product Release.** *Promotes:* the Product Wave — enterprise surfaces and workflows over verified state. *Purpose:* to deliver customer-facing value that demonstrates, but never establishes, the underlying capability.
- **Operational Release.** *Promotes:* the Operations Wave — enterprise instrumentation, observability, and operability. *Purpose:* to make what has been released operable and diagnosable at enterprise scale, and to gate any growth that would otherwise outrun observability.
- **Strategic Release.** *Promotes:* the Strategic / Ecosystem Wave — scale, external integration, and market expansion. *Purpose:* to extend Cortex outward once its interior is authoritative, governed, and observable; by construction the last category to fire.

**Governing rule.** Release categories are *typed by capability class, not by time*. A category names *what kind of capability* is being promoted and *what must be true* to promote it (§VI-23), never *when*. The categories do not imply a fixed count of releases: a capability class may be advanced through more than one release of its category as its wave is delivered incrementally (§VI-27), always under the same category's readiness bar and approving authority (§VI-29).

**Dependencies.** §VI-22 (the waves these categories promote); §VI-23 (the readiness each category requires); §VI-25 (the unlock order across categories); §VI-27 (incremental delivery within a category); §VI-29 (the authority that approves each category).

**Risks.** The risk is collapsing the categories into an undifferentiated "release" that bypasses category-specific readiness and authority — for example, folding intelligence into a product push without the Intelligence Release's governance bar. Typing releases by capability class prevents this.

**Traceability.** Part II: DNA Ch 17/18/25/30/33/35. Part III: §III-29, §III-37, §III-56–§III-65. Part IV: §IV-35–§IV-55. Part VI: §VI-22, §VI-23, §VI-25. Roadmap: `MARQ_CORTEX_EXECUTION_RULES.md`.

---

## VI-27 — Incremental Delivery Principles

**Purpose.** To state the principles by which Cortex *grows safely over time* — how successive releases enlarge the platform without destabilizing what already runs.

**Why it exists.** Waves, readiness, and release categories describe *what* is promoted; they do not describe *how the platform stays whole* as promotions accumulate. Incremental delivery principles are the safety discipline of growth: they keep every release reversible, compatible, and debt-contained, so that a maturing Cortex never becomes a brittle one.

**Scope.** The incremental-growth discipline only. It sets no schedule and prescribes no implementation.

**Approved Incremental Delivery Principles.**

- **Reversible evolution.** Every increment is delivered so that it can be withdrawn. Schema and platform changes follow an **expand → migrate → contract** shape — additive first, cut-over verified, removal last — so there is always a state to return to. The migration engine (`supabase/functions/server/migration/`) is the instrument of this reversibility; no increment depends on an irreversible one-way cutover.
- **Compatibility.** Each increment preserves the contracts its consumers depend on — the Intelligence Gateway abstraction, the repository interface, the deterministic engine responsibilities, and the tenancy boundary. New capability is added *behind* stable contracts; existing consumers continue to function unchanged across the release.
- **Migration safety.** Data-bearing increments never risk the authoritative plane: migrations are reversible, tenancy-preserving, and verified against parity before the old path is retired. Delivery never sacrifices the integrity of persisted enterprise data to move faster.
- **Platform stability.** Growth does not destabilize the running core. The shared engines and gateway remain stable under extension; an increment that would force a breaking change to a load-bearing platform contract is redesigned or escalated (DNA Ch 35), not merged as a break.
- **Technical-debt containment.** Debt is bounded at the moment it is incurred, not deferred indefinitely. The permanent prohibitions — no duplicate engine, no parallel data authority, no AI path around the gateway (§VI-16, §VI-19) — are the hard ceiling on architectural debt; delivery may not "borrow" against them for speed.
- **Progressive hardening.** Capabilities enter production at their least-privileged, most-guarded posture and are hardened progressively as evidence accumulates — anon-policy tightening, authority verification, and certification strengthening over successive releases rather than a single late hardening step. Hardening is a continuous property of delivery, not a final gate.

**Governing rule.** No increment is delivered that cannot be reversed, that breaks an existing contract, or that borrows against the permanent architectural prohibitions. Growth that violates any of these is not incremental delivery — it is drift, and it is refused (§VI-19).

**Dependencies.** §VI-16/§VI-19 (the permanent prohibitions debt containment enforces); §VI-23 (reversibility and compatibility as readiness criteria); §VI-26 (the categories within which increments accumulate); the migration engine and gateway abstraction in the repository.

**Risks.** The risk is trading a safety property for speed — an irreversible cutover, a broken contract, a duplicated engine "just this once." Each such trade converts maturity into brittleness; the governing rule refuses all of them.

**Traceability.** Part II: DNA Ch 8.3/17/18/25/33/35. Part III: §III-59–§III-65, §III-78–§III-80, §III-84–§III-88. Part IV: §IV-23–§IV-34, §IV-46–§IV-55. Part VI: §VI-16, §VI-19, §VI-23, §VI-26. Repository: `supabase/functions/server/migration/`, `supabase/migrations/`, `supabase/functions/server/intelligence/`, `src/app/core/`.

---

## VI-28 — Validation Before Release

**Purpose.** To define the **evidence set** that must exist before a capability enters production — the release-validation record assembled at the point of promotion.

**Why it exists.** The execution gates (§VI-18) verify a capability's readiness *as it advances through delivery*; they are not restated here. Release validation is the distinct, final act of *assembling the evidence into a promotion record* — the demonstrable proof, gathered in one place, that a wave meets every readiness criterion (§VI-23) at the moment of release. It exists so that the approving authority (§VI-29) decides against a record, not against a narrative.

**Scope.** The release-validation evidence set only. It duplicates no execution gate and defines no new gate; it specifies what evidence the release record must contain.

**Approved Release-Validation Evidence.** Before a capability enters production, its release record must contain:

- **Data-authority evidence.** Demonstration that the capability reads and writes the authoritative relational plane, with — where migration is involved — verified parity between the retiring path and the authoritative one (no KV-authoritative residue, no client-held truth).
- **Tenancy-isolation evidence.** Demonstration that tenant boundaries are enforced server-side for every path the capability exposes, with cross-tenant access shown to be denied, not merely undefined.
- **Governed-AI evidence.** For any capability involving AI, demonstration that every provider call is routed through the Intelligence Gateway — certification and provider-registry evidence — with no direct-provider path present (§VI-16).
- **Reversibility evidence.** A demonstrated rollback or withdrawal path for the increment — the expand/contract state proven reversible — so promotion is never a one-way door (§VI-27).
- **Observability evidence.** Live health, telemetry, and certification signals sufficient to diagnose and operate the capability in production (`health.ts`, `telemetry.ts`, `certification.ts` where applicable).
- **Contract-compatibility evidence.** Demonstration that existing consumers of the gateway, repository, engine, and tenancy contracts continue to function across the increment (§VI-27).
- **Governance and blueprint-preservation evidence.** A record that the capability subordinates to the LOCKED Constitution and Parts I–V, introduces no drift, and — where any tension with a locked decision arose — resolved it through amendment (DNA Ch 35), not through the release.
- **Test and gate evidence.** The results of the declared test suites (`package.json`, `MARQ_CORTEX_TEST_PROTOCOL.md`) and the recorded exit of every gate the capability depends on (§VI-18) — evidence, not assertion.

**Governing rule.** Validation is *evidentiary and antecedent*: the record exists **before** promotion, not after. A capability whose release record is missing any element above is NOT-YET-RELEASABLE regardless of functional appearance. Evidence gathered only in a deployment-limited environment is marked UNVERIFIED and does not satisfy this set (§VI-8, §VI-19).

**Dependencies.** §VI-18 (the gates whose exit this record aggregates); §VI-23 (the readiness criteria this evidence substantiates); §VI-27 (reversibility and compatibility evidence); §VI-29 (the authority that reads this record).

**Risks.** The risk is retrospective validation — releasing, then assembling evidence to justify it. The antecedent rule forecloses this: no record, no release.

**Traceability.** Part II: DNA Ch 18.9/25/30/33/35. Part III: §III-75, §III-84–§III-88. Part IV: §IV-35–§IV-55. Part VI: §VI-8, §VI-18, §VI-23, §VI-27. Roadmap: `MARQ_CORTEX_TEST_PROTOCOL.md`, `MARQ_CORTEX_EXECUTION_RULES.md`. Repository: `supabase/functions/server/intelligence/` (`certification.ts`, `telemetry.ts`, `health.ts`), `package.json`.

---

## VI-29 — Release Governance

**Purpose.** To explain how release approval occurs by *applying* the constitutional authorities already defined in earlier Parts — not by defining new ones.

**Why it exists.** Delivery must terminate in an authorized act, or readiness evidence never becomes a governed release. The authorities that can authorize such an act already exist — the constitutional governance of the DNA (Part II), the enterprise governance and review authorities of Part IV (§IV-35–§IV-55), and the role-based authority attached to each execution gate (§VI-18). This section binds those existing authorities to the release categories (§VI-26); it redefines no governance.

**Scope.** The application of existing authority to release approval only. It creates no new authority, no new gate, and no new escalation path.

**Approved Release-Governance Application.**

- **Release approval is a constitutional act.** Promoting a capability to production is an exercise of already-defined authority against the release-validation record (§VI-28), taken through the mandatory repository workflow (§VI-19: complete → review → commit → push → open PR → merge → verify canonical main). No release occurs outside that workflow.
- **Authority is matched to release category.** Each release category (§VI-26) is approved by the authority already competent for that class of capability: **Foundation** and **Platform** releases by the architecture, data-integrity, and security authorities of the corresponding gates (§VI-18); **Intelligence** and **Workforce** releases by the AI-readiness authority; **Product** releases by the product-readiness authority; **Operational** releases by the operational-readiness authority; **Strategic** releases by the highest constitutional authority, since ecosystem and market expansion touch the blueprint's outermost commitments. These authorities are drawn from §VI-18 and Part IV, not invented here.
- **Evidence precedes approval.** No authority approves a release by assertion; each approves against the antecedent validation record (§VI-28). An incomplete record is a refusal, not a discretionary override.
- **Blueprint supremacy governs every approval.** No release authority may approve a capability that edits or contradicts the LOCKED Constitution or Parts I–V. Where a release would require such a change, the only path is the heightened amendment process (DNA Ch 35); release governance cannot substitute for it.
- **Refusal and escalation reuse existing paths.** A refused release follows the failure-response and escalation paths already defined for the relevant gate (§VI-18) and the anti-drift controls (§VI-19); this phase adds none.

**Governing rule.** Release governance *applies* constitutional authority; it never *creates* it. Every release is approved by an authority already defined in Part II, Part IV, or §VI-18, against evidence already required by §VI-28, through the workflow already mandated by §VI-19.

**Dependencies.** §VI-18 (the gate authorities applied here); §VI-19 (the mandatory workflow releases run through); §VI-26 (the categories matched to authorities); §VI-28 (the evidence authority approves against); Part IV §IV-35–§IV-55 and the Constitution (DNA Ch 30/35).

**Risks.** The risk is release governance quietly *becoming* a new governance layer — inventing approvals or overrides not grounded in existing authority. The governing rule forbids this: approval authority is only ever borrowed from what Parts II/IV and §VI-18 already define.

**Traceability.** Part II: DNA Ch 8.3/25/30/33/35. Part III: §III-75, §III-84–§III-88. Part IV: §IV-35–§IV-55. Part VI: §VI-18, §VI-19, §VI-26, §VI-28. Roadmap: `MARQ_CORTEX_EXECUTION_RULES.md`, `MARQ_CORTEX_DOCUMENTATION_RULES.md`.

---

## VI-30 — Phase 6.3 Summary & Completion Record

**Purpose.** To summarize Phase 6.3 and record its completion without beginning Phase 6.4 or locking Part VI.

**Why it exists.** A phased document needs an explicit boundary so the *capability delivery model* is not mistaken for a schedule or a plan of record, and so Phase 6.4 begins from a settled, merged foundation.

**Scope.** A summary of Phase 6.3 only (§VI-21–§VI-30) and its completion record. It defines no new priority, dependency, governance rule, or gate, and it begins no later phase.

**Summary of what Phase 6.3 established.**

- **Delivery philosophy (§VI-21).** Capability-first delivery: the unit of delivery is the cohesive **capability increment**, delivered as a whole platform increment rather than an isolated feature, realizing approved priority without re-opening it, progressively and reversibly, with whole-increment accountability.
- **Capability waves (§VI-22).** A **wave** as the delivery cohort riding on the execution layers — Foundation, Platform, Intelligence, Workforce, Product, Operations, and Strategic/Ecosystem — each defined by what it contains and why it exists, none carrying dates or milestones.
- **Release readiness (§VI-23).** A qualitative, all-of readiness bar — verified foundational truth, end-to-end governance and security authority, reversibility, observability, compatibility, no drift, blueprint preservation, and evidence-based gate exit — with no percentages and no partial-credit release.
- **Cross-stream synchronization (§VI-24).** Contract-first convergence: streams synchronize by satisfying shared contracts (relational data, repository interface, gateway) at named synchronization points, with Governance and Operations attaching continuously, and a wave held until all contributing streams converge at one readiness frontier.
- **Capability unlock matrix (§VI-25).** The dependency relationships read forward as delivery enablers — which RELEASABLE capability makes which later wave *deliverable* — release-gated, not begin-gated.
- **Release model (§VI-26).** Six release categories — Foundation, Platform, Intelligence, Product, Operational, Strategic — typed by capability class and readiness, never by time.
- **Incremental principles (§VI-27).** Reversible evolution (expand/contract), compatibility, migration safety, platform stability, technical-debt containment (bounded by the permanent prohibitions), and progressive hardening.
- **Validation before release (§VI-28).** The antecedent, evidentiary release record — data-authority, tenancy-isolation, governed-AI, reversibility, observability, contract-compatibility, governance/blueprint-preservation, and test/gate evidence — assembled before promotion, never after.
- **Release governance (§VI-29).** Existing constitutional authority *applied* to release: each category approved by the authority already competent for it, against the validation record, through the mandatory workflow, under blueprint supremacy — no new authority created.

**Current State.** All CURRENT STATE claims in this phase remain grounded in the repository verified for Phase 6.2 and in the LOCKED Parts I–V; foundations are PARTIAL/UNVERIFIED where the runtime is not yet authoritative (data authority, tenancy), PARTIAL where breadth is incomplete (gateway providers, product surfaces, observability), and NOT IMPLEMENTED where absent (AI workforce runtime, enterprise instrumentation). This phase describes how such capabilities will be *delivered*; it implements none of them and claims no capability as released. Nothing is invented.

**Approved Delivery State.** A capability-first delivery model — whole increments, grouped into readiness-defined waves, converged across streams by contract, admitted by an all-of qualitative readiness bar, promoted through typed release categories under existing constitutional authority, and grown by reversible, compatible, debt-contained increments — realizing the sequence LOCKED in Phase 6.2 and the direction LOCKED in Part V without editing either.

**Validation of this phase.**

- Phase 6.3 authored.
- Sections VI-21 through VI-30 present, exactly once, in continuous numbering after §VI-20.
- No previously LOCKED Part (I–V) modified.
- Phase 6.1 (§VI-1–§VI-10) and Phase 6.2 (§VI-11–§VI-20) preserved unchanged.
- No priorities, dependencies, governance, security, or gates redefined — only applied.
- No dates, milestones, sprints, story points, engineering estimates, staffing, tickets, or implementation instructions.
- Phase 6.4 not begun; Part VI not locked.

**Dependencies.** All Phase 6.3 sections (§VI-21–§VI-29); Phase 6.2 (§VI-11–§VI-20) and Phase 6.1 (§VI-1–§VI-10); Parts I–V (LOCKED) and the Constitution.

**Traceability.** Part II: DNA Ch 8.3/17/18/25/30/33/35. Part III: §III-15–§III-88. Part IV: §IV-23–§IV-55. Part V: §V-1–§V-30. Part VI: §VI-1–§VI-29. Roadmap: `MARQ_CORTEX_ROADMAP.md`, `MARQ_CORTEX_EXECUTION_RULES.md`, `MARQ_CORTEX_TEST_PROTOCOL.md`, `MARQ_CORTEX_DOCUMENTATION_RULES.md`.

**Completion Evidence.** This record; the presence of §VI-21–§VI-30; the unchanged Phase 6.1, Phase 6.2, and Parts I–V; the absence of any dates, tasks, assignments, numeric KPIs, or implementation instructions.

---

**Phase 6.3 Status: COMPLETE**

**Part VI remains: IN PROGRESS**

**Phase 6.4 has not begun.**

**Continuity note.** The Master Blueprint remains a single, continuous document. Parts I–V remain LOCKED and unchanged; Phase 6.1 (§VI-1–§VI-10) and Phase 6.2 (§VI-11–§VI-20) are preserved. Phase 6.3 (§VI-21–§VI-30) is authored and complete but not locked. The next Part VI phase (6.4) is not begun here.

*End of Phase 6.3. Part VI continues in a later phase.*

---

## Phase 6.4 — Execution Operating Model & Delivery Governance

**Status:** COMPLETE (Phase 6.4) · Part VI remains IN PROGRESS · **Numbering:** Sections VI-31 through VI-40, continuing the single-document numbering after Phase 6.3 (§VI-21–§VI-30); numbering is never restarted. · **Continuity:** Phase 6.4 appends to the same Master Blueprint. Parts I–V remain LOCKED and are neither modified, restated, nor contradicted here; Phase 6.1 (§VI-1–§VI-10), Phase 6.2 (§VI-11–§VI-20), and Phase 6.3 (§VI-21–§VI-30) are preserved unchanged (Preservation rule; Golden Rules 1 and 8).

**Purpose of this phase.** Phase 6.2 fixed *what* MARQ Cortex builds and *in what order*; Phase 6.3 fixed *how* an approved capability is *delivered and released* into production — the increment, the wave, the readiness bar, the release categories, and release governance at the point of promotion. What neither phase describes is how the enterprise *runs* that delivery engine **continuously over time**: the operating rhythm that turns a single release into a sustained cadence, who is accountable for each execution act, how work enters and flows without overwhelming the foundations-first order, how risk and failure are managed as they arise, how quality is held while the platform is in motion, how the configuration stays coherent as it changes, how the health of execution itself is observed, and how the system corrects its own drift and improves. Phase 6.4 answers that single question: **how does MARQ Cortex operate its own execution — safely, accountably, and self-correctingly — while staying subordinate to the LOCKED blueprint?**

**What this phase is.** An execution operating architecture — an operating philosophy (§VI-31), the execution operating cadence (§VI-32), the execution roles and accountability model (§VI-33), work intake and flow discipline (§VI-34), risk and issue management (§VI-35), quality assurance in operation (§VI-36), change control and configuration integrity (§VI-37), execution health and progress signals (§VI-38), and continuous improvement and drift correction (§VI-39), closed by a completion record (§VI-40).

**What this phase is not.** Phase 6.4 does **not** redefine priorities, dependencies, the delivery model, governance, security, or the gates — those are LOCKED in place by Phases 6.2–6.3 and Parts I–V and are only *operated* here. It is not a sprint plan, a calendar, a staffing roster, a ticket backlog, a headcount plan, a budget, or an implementation task list. It assigns no dates, no story points, no owners by name, no hours, and it writes no code. It describes the operating discipline by which delivery is run continuously; it performs no delivery. Phase 6.5 is not begun here, and Part VI is not locked.

**Grounding.** The operating model below is grounded in the same repository verified for Phases 6.2–6.3 — the deterministic engine layer under `src/app/core/` (30 `*Engine.ts` modules), the Intelligence Gateway under `supabase/functions/server/intelligence/` (`gateway.ts`, `providerRegistry.ts`, `certification.ts`, `modelRegistry.ts`, `telemetry.ts`, `health.ts`, `featureBridge.ts`, `contracts.ts`, and `providers/`), the server repository layer under `supabase/functions/server/repositories/`, the migration engine under `supabase/functions/server/migration/` (`orchestrator.ts`, `reconciliation.ts`, `rollback.ts`, `checkpointStore.ts`, `quarantineStore.ts`, `telemetry.ts`), the SQL migrations under `supabase/migrations/` (tenancy foundation, RLS + seed, KV foundation, migration infrastructure, diagnostic foundation/RLS, and anon-policy hardening) with their `rollbacks/`, the migration CLI under `scripts/migration/` (`cli.ts`, `validate-s6.3.ts`), the declared test suites in `package.json` (`test:smoke`, `test:intelligence`, `test:database`, `test:migration`, `test:features`) and deployment scripts (`supabase:deploy`, `supabase:db-push`), the institutional-memory record under `memory/` (`failure_library.md`, `regression_cases.md`, `pattern_violations.json`), and the system manifest `src/system/manifest.ts` — together with the LOCKED Parts I–V and the Constitution. Operating labels (IMPLEMENTED / PARTIAL / NOT IMPLEMENTED, VERIFIED / UNVERIFIED) are used where they add precision. The enterprise's current operating reality is the single-operator (Startup) shape, and the AI-workforce runtime is a reserved (`ai_worker`) identity, NOT IMPLEMENTED (§VI-3). Nothing is invented ahead of its phase (Golden Rule 5).

---

## VI-31 — Execution Operating Philosophy

**Purpose.** To define how MARQ Cortex *operates* its execution — the philosophy that turns the delivery model (§VI-21–§VI-30) into a sustained, accountable operating discipline — distinct from how it prioritizes (§VI-11), sequences (§VI-13–§VI-14), or delivers (§VI-21) a capability.

**Why it exists.** Phase 6.3 describes the *act* of delivering a capability; it does not describe the *conduct of running* delivery again and again over time. Without a stated operating philosophy, sustained execution degrades into ad-hoc motion — whichever work is loudest is worked, whoever is available decides, failures are absorbed silently, and the foundations-first order erodes under momentum. This section fixes the operating value system so that every operating mechanism that follows — cadence (§VI-32), accountability (§VI-33), flow (§VI-34), risk (§VI-35), quality (§VI-36), change control (§VI-37), health (§VI-38), and correction (§VI-39) — is a consequence of stated principle rather than of convenience or pressure.

**Scope.** The operating value system only. It names no cadence interval, assigns no role, and defines no control; those derive from this philosophy in §VI-32 onward. It re-opens no priority, dependency, or delivery decision LOCKED in Phases 6.2–6.3.

**Current State.** The operating substrate is **PARTIAL — real but informal.** A disciplined operating loop already runs at single-operator scale: the mandatory repository workflow (complete → review → commit → push → open PR → merge → verify canonical main, §VI-19) is exercised on every increment; per-increment review cycles operate; institutional memory is maintained as durable operating evidence (`memory/failure_library.md`, `memory/regression_cases.md`, `memory/pattern_violations.json`); the declared test suites (`package.json`) and the migration engine's reversibility tooling (`supabase/functions/server/migration/`, `scripts/migration/`) are the standing instruments of safe operation. What is **NOT IMPLEMENTED** is any *formalized, staffed, instrumented* operating institution — a defined operating cadence as an enterprise ritual, a multi-role accountability structure beyond the single operator, and execution-health instrumentation — because the enterprise runs at the Startup (single-operator) shape and the AI-workforce runtime is reserved, not realized (§VI-3, §IV-46–§IV-55). The *values* below are already honored in practice; this section makes them explicit and durable.

**Approved Future State (governing operating principles).**

- **Operate to the blueprint, never around it.** Every operating act realizes an already-approved priority (§VI-15) in its already-approved position (§VI-13–§VI-14) through the already-mandated workflow (§VI-19). Operation introduces no new priority, dependency, delivery rule, or governance authority; where operating reality reveals a LOCKED decision to be unworkable, the heightened amendment path (DNA Ch 35) is the only recourse.
- **Cadence over heroics.** Sustained delivery is achieved by a repeatable rhythm of small, verified increments, not by bursts of undisciplined effort. A steady cadence of reversible increments is safer and faster over the horizon than intermittent large pushes (§VI-27, progressive over big-bang).
- **Accountability is explicit and singular.** Every execution act has one accountable authority answerable for its outcome — today the Human Principal at the high-consequence floor (DNA Ch 18.9), tomorrow the matched gate and workforce authorities (§VI-18, §VI-33). Diffused accountability is treated as no accountability.
- **Foundations-first flow under load.** Operating pressure never re-orders the dependency graph. When more work arrives than can be safely run, intake is throttled in favor of the foundations-first order (§VI-11), not the most visible or most requested item.
- **Failure is surfaced, recorded, and learned from — never absorbed.** Every material failure is made visible, captured in institutional memory, and converted into a regression guard or pattern-violation record (`memory/`), so the system's reliability compounds rather than decays (DNA Ch 26; §VI-39).
- **Self-correction is a standing property.** Drift is expected and continuously detected and reversed, not discovered late. The anti-drift controls (§VI-19) operate continuously, not as a one-time gate (§VI-39).
- **Honest operating status.** Progress is reported against evidence, and deployment-limited verification is labelled UNVERIFIED, never RELEASABLE (§VI-8). Partial operation reported as complete is the failure this philosophy exists to prevent.

**Dependencies.** §VI-11 (the prioritization philosophy this operating philosophy extends into conduct); §VI-19 (the anti-drift controls and mandatory workflow operation runs through); §VI-21 (the delivery philosophy operation sustains); the LOCKED Constitution (DNA Ch 17/18/25/26/33/35).

**Risks.** If the operating philosophy is not held, sustained execution reverts to convenience and momentum: cadence collapses into heroics, accountability diffuses, intake overruns the foundations, failures are absorbed, and drift is found late. The operating mechanisms in §VI-32–§VI-39 exist to detect and reverse exactly this.

**Traceability.** Part I: `ARCHITECT.md`, `memory/`. Part II: DNA Ch 8.3/17/18/25/26/33/35. Part III: §III-75, §III-84–§III-88. Part IV: §IV-35–§IV-55. Part VI: §VI-11, §VI-19, §VI-21. Repository: `memory/`, `src/app/core/`, `supabase/functions/server/`, `package.json`. Roadmap: `MARQ_CORTEX_EXECUTION_RULES.md`.

---

## VI-32 — Execution Operating Cadence

**Purpose.** To define the **operating cadence** — the repeatable rhythm by which capability increments (§VI-21) are planned, built, verified, released, and reviewed — so that delivery is sustained as a loop rather than performed as isolated events.

**Why it exists.** A single delivery (§VI-26) is an event; an enterprise runs on a *rhythm*. Without a defined cadence, execution has no heartbeat: work starts and stops unpredictably, verification is done when remembered rather than always, and review is skipped under pressure. The cadence exists to make the safe path the *default, repeated* path — so that reversibility, verification, and review recur on every turn of the loop without depending on anyone remembering to invoke them.

**Scope.** The operating loop and its recurring stages only. It assigns **no interval, no calendar, no date, no sprint length, and no milestone** — the cadence is defined by its *sequence of recurring acts*, not by clock or calendar. It re-orders nothing fixed in Phases 6.2–6.3.

**Current State.** **PARTIAL — the loop exists, unformalized.** The recurring operating acts are already exercised per increment: change is completed, reviewed, committed, pushed, opened as a PR, merged, and verified against canonical main (§VI-19); tests are runnable at each turn (`test:smoke`, `test:intelligence`, `test:database`, `test:migration`, `test:features` in `package.json`); migration changes carry simulate/backfill/reconcile/validate stages (`scripts/migration/cli.ts`, `migration:*` scripts) and reversible rollbacks (`supabase/migrations/rollbacks/`, `supabase/functions/server/migration/rollback.ts`); review outcomes and regressions are recorded in `memory/`. What is **NOT IMPLEMENTED** is a *named, instituted cadence* with defined recurring review rituals across a team — because operation is single-operator (§VI-3). The stages below describe the loop already implicit in the workflow, made explicit and permanent.

**Approved Future State (the recurring operating loop — no intervals).**

- **Plan-to-priority.** Each turn of the loop draws its next increment from the already-approved priority and dependency order (§VI-13–§VI-15), never from novelty or request volume. The loop never selects work its prerequisites have not made deliverable (§VI-25).
- **Build-in-the-open.** The increment is built as a cohesive platform slice (§VI-21) behind stable contracts, additively (expand before contract, §VI-27).
- **Verify-always.** Verification is a *stage of every turn*, not an optional step: the relevant test suites run, tenancy and data-authority are checked where touched, and gateway routing is confirmed where AI is involved (§VI-18, §VI-23, §VI-28). An increment does not advance on an unverified turn.
- **Release-under-governance.** A verified increment is promoted only through the typed release category and matched authority already defined (§VI-26, §VI-29), against the antecedent validation record (§VI-28).
- **Review-and-record.** Every turn closes with review and with an update to institutional memory (`memory/`) — failures to the failure library, regressions to regression cases, drift to pattern violations — so the next turn begins better informed (§VI-39).
- **Repeat at readiness, not at a clock.** The loop advances when the next increment is *ready* (its enablers RELEASABLE, §VI-25), not on a fixed interval. Cadence is a rhythm of readiness, deliberately unpinned from calendar.

**Governing rule.** The cadence is defined by *which acts recur and in what order*, never by *how often in clock time*. Verification and review are non-skippable stages of every turn; a turn that omits either has not completed, regardless of whether code merged.

**Dependencies.** §VI-19 (the mandatory workflow the loop instantiates); §VI-18/§VI-23/§VI-28 (the verification and release-readiness the loop enforces each turn); §VI-25/§VI-26 (readiness-gated advancement and typed release); §VI-39 (the review-and-record close of each turn).

**Risks.** The chief risk is a cadence that skips its verify or review stage under pressure, or one that becomes calendar-driven and ships to a date rather than to readiness. The non-skippable-stage rule and readiness-gated advance foreclose both.

**Traceability.** Part II: DNA Ch 17/18/25/26/33. Part III: §III-84–§III-88. Part IV: §IV-35–§IV-45. Part VI: §VI-18, §VI-19, §VI-23, §VI-25, §VI-26, §VI-28. Repository: `package.json`, `scripts/migration/`, `supabase/migrations/rollbacks/`, `supabase/functions/server/migration/`, `memory/`. Roadmap: `MARQ_CORTEX_EXECUTION_RULES.md`, `MARQ_CORTEX_TEST_PROTOCOL.md`.

---

## VI-33 — Execution Roles & Accountability

**Purpose.** To define the **accountability model** for execution — which authority is answerable for each class of operating act — by *applying* the authorities already established in Part II (DNA), Part IV (§IV-23–§IV-55), and the execution gates (§VI-18), not by inventing new ones.

**Why it exists.** The cadence (§VI-32) describes *what recurs*; it does not say *who is answerable* when a turn succeeds or fails. Without an explicit accountability model, responsibility diffuses: everyone assumes someone else verified tenancy, approved the release, or updated the failure library. This section binds each operating act to a single accountable authority so that no act is ownerless.

**Scope.** The mapping of operating acts to *already-defined* authorities only. It creates no new role, no new title, no org chart, and no headcount, and it names no individual. It re-states neither the Part IV organizational structure nor the gate authorities of §VI-18; it applies them.

**Current State.** **PARTIAL — single accountable authority, reserved workforce.** Today all execution accountability resolves to the **Human Principal** as the ultimate accountable authority at the high-consequence floor (DNA Ch 18.9), operating the enterprise at the Startup (single-operator) shape (§VI-3). The role *definitions* exist as approved architecture — the enterprise executive/department/manager structure (§IV-23–§IV-34), product RBAC (`roleEngine`; §III-42–§III-43), and the role-based authority attached to each gate (§VI-18) — but the **AI-workforce runtime that would distribute these operating roles is NOT IMPLEMENTED**, reserved to the `ai_worker` identity. The accountability model below is therefore a mapping that is *fully honored today by one authority* and *progressively distributed* as the approved workforce is stood up — inventing no role that does not already exist in Parts IV or §VI-18.

**Approved Future State (operating acts → accountable authority).**

- **Foundation and platform operation** (tenancy, relational authority, migration, gateway/repository contracts) is accountable to the **architecture, data-integrity, and security authorities** already attached to the corresponding gates (§VI-18) — the Human Principal today.
- **Intelligence and workforce operation** (governed intelligence; later the `ai_worker` runtime) is accountable to the **AI-readiness authority** (§VI-18); the workforce itself, once realized, operates *under* that authority, never above it (§VI-16, authority before autonomy).
- **Product operation** (enterprise surfaces over verified state) is accountable to the **product-readiness authority** (§VI-18).
- **Operational and health operation** (observability, diagnosability) is accountable to the **operational-readiness authority** (§VI-18).
- **Release approval** for each category is accountable to the authority already matched to it (§VI-29); **strategic/ecosystem** operation to the highest constitutional authority (DNA Ch 30/35).
- **The human floor is non-delegable.** High-consequence and irreversible acts remain accountable to the Human Principal regardless of how much of the workforce is realized (DNA Ch 18.9); autonomy never rises above the authority model (§VI-16).

**Governing rule.** Every operating act has exactly **one** accountable authority, drawn from Part II, Part IV, or §VI-18 — never a newly invented one. Distribution of these accountabilities across the AI workforce is additive and gated on that workforce being VERIFIED-realized; until then, they resolve to the single accountable operator. Accountability is never diffused and never delegated above the human floor.

**Dependencies.** §VI-18 (the gate authorities applied here); §VI-29 (release-approval authorities); Part IV §IV-23–§IV-34 (the approved role structure); the reserved `ai_worker` identity; the Constitution (DNA Ch 18.9/30/35).

**Risks.** The dominant risk is accountability diffusing as work parallelizes, or a nascent AI workforce being treated as accountable before it is VERIFIED-realized. The single-accountable-authority rule and the non-delegable human floor foreclose both.

**Traceability.** Part I: `ARCHITECT.md`. Part II: DNA Ch 8.3/9/18.9/23/30/33/35. Part III: §III-42–§III-43. Part IV: §IV-23–§IV-34, §IV-35–§IV-45. Part VI: §VI-16, §VI-18, §VI-29. Repository: `src/app/core/roleEngine.ts`, `src/system/manifest.ts`.

---

## VI-34 — Work Intake & Flow Discipline

**Purpose.** To define how candidate work *enters* execution and *flows* through the operating cadence (§VI-32) without overrunning the foundations-first order — the intake and flow-control discipline.

**Why it exists.** A running enterprise attracts more candidate work than it can safely execute: new surfaces, integrations, provider additions, and requests accumulate faster than foundations mature. Without intake discipline, this pressure re-orders execution by volume and visibility rather than by dependency — the exact drift §VI-16 prohibits. This section governs the *gate at the front of the loop* so that what enters is always admissible against the LOCKED priority and dependency order.

**Scope.** Intake admissibility and flow control only. It defines no backlog tool, no ticket schema, no queue length, and no throughput target. It re-ranks nothing; it *applies* the priority classes (§VI-12) and dependency model (§VI-13) as an admission filter.

**Current State.** **PARTIAL.** Intake is governed today by the LOCKED prioritization framework and dependency model (§VI-12–§VI-13), the immediate-priorities record (§VI-15), and the deferred/prohibited-work list (§VI-16), applied by the single operator; the manifest (`src/system/manifest.ts`) and engine layer (`src/app/core/`) bound what surfaces exist. What is **NOT IMPLEMENTED** is any *instrumented intake queue or flow-metrics system* (work-in-progress limits, throughput measurement) — consistent with enterprise instrumentation being absent (§VI-3, §IV-46–§IV-55). The discipline below formalizes the admission rules already applied by judgment.

**Approved Future State (intake and flow rules).**

- **Admission is dependency-gated.** Candidate work is admitted to the loop only if its prerequisites are RELEASABLE (§VI-25) and its position in the dependency order is reached (§VI-13). Work whose foundations are not yet present is **deferred by construction** (§VI-16), not queued ahead of them.
- **Admission is priority-classed.** Every admitted item carries its priority class (§VI-12); Foundation-Critical and Governance-Critical work precedes Product/Platform, which precedes Operational, which precedes Growth, which precedes Optimization. Class is assigned by the stated dimensions, never by request volume.
- **Flow is throttled to protect foundations.** When admissible work exceeds safe operating capacity, intake is **throttled in dependency order** — foundations continue, later-layer work waits. Operating pressure never promotes a later-layer item past an unfinished foundation (§VI-31, foundations-first under load).
- **One capability increment flows whole.** Work flows as whole increments (§VI-21), not as fragments; a half-increment is not advanced to keep the queue moving.
- **Prohibited work never enters.** The permanent prohibitions (no duplicate engine, no parallel data authority, no AI path around the gateway; §VI-16, §VI-19) are intake filters: such work is refused at admission, not managed in flow.
- **Re-classification is governed, not silent.** An item's class or admissibility changes only as its evidence and dependencies change, and only through the phase-entry/anti-drift checks (§VI-19) — never by pressure.

**Governing rule.** Intake is an *admission filter against the LOCKED order*, not a demand queue. No item flows because it is wanted, visible, or numerous; it flows only because its dependencies are satisfied and its class is reached. Excess demand is throttled in dependency order, never absorbed by re-ordering.

**Dependencies.** §VI-12 (priority classes applied at intake); §VI-13 (the dependency order intake respects); §VI-15/§VI-16 (immediate priorities and prohibited work); §VI-25 (the RELEASABLE condition admission requires); §VI-19 (governed re-classification).

**Risks.** The chief risk is demand-driven intake — admitting the most requested or most visible work ahead of foundations. The dependency-gated, priority-classed admission filter and foundations-first throttle foreclose it.

**Traceability.** Part II: DNA Ch 8.3/17/18/25/33. Part III: §III-84–§III-88. Part IV: §IV-46–§IV-55. Part VI: §VI-12, §VI-13, §VI-15, §VI-16, §VI-19, §VI-25. Repository: `src/system/manifest.ts`, `src/app/core/`.

---

## VI-35 — Risk & Issue Management

**Purpose.** To define how execution **risks** (potential future harms) and **issues** (realized failures) are identified, contained, recorded, and resolved during operation — the standing risk-and-issue discipline.

**Why it exists.** Every operating turn carries risk — a migration that could strand data, a release that could break a contract, an AI path that could bypass the gateway. Without an explicit discipline, risks are noticed late and issues are absorbed silently, so the same failure recurs. This section makes risk anticipation and issue response a *standing operating function*, closing the loop into institutional memory (§VI-39) so reliability compounds.

**Scope.** Risk anticipation and issue response during operation only. It defines no numeric risk score, no severity SLA, no probability model, and no incident calendar. It re-uses the failure-response and escalation paths already attached to the gates (§VI-18) and anti-drift controls (§VI-19) rather than inventing new ones.

**Current State.** **PARTIAL — real recording substrate, informal process.** A genuine issue-capture substrate is IMPLEMENTED and maintained: `memory/failure_library.md` (recorded failures and their resolutions), `memory/regression_cases.md` (issues converted to standing regression guards), and `memory/pattern_violations.json` (recorded drift/anti-pattern instances). Reversibility instruments that contain data-risk are IMPLEMENTED: the migration engine's checkpoint, quarantine, reconciliation, and rollback facilities (`supabase/functions/server/migration/checkpointStore.ts`, `quarantineStore.ts`, `reconciliation.ts`, `rollback.ts`) and migration rollbacks (`supabase/migrations/rollbacks/`). Gateway health/telemetry (`health.ts`, `telemetry.ts`) surface intelligence-path risk. What is **NOT IMPLEMENTED** is a *formal risk register, severity taxonomy, or incident-management system* — consistent with enterprise instrumentation being absent (§VI-3). The discipline below formalizes the practice the `memory/` record already evidences.

**Approved Future State (risk-and-issue discipline).**

- **Anticipate risk per increment.** Each turn identifies the risk its increment carries — to data authority, tenancy, contracts, reversibility, or governance — before promotion, as part of the validation record (§VI-28). Unbounded-risk increments are not admitted.
- **Contain by reversibility.** The primary risk control is reversibility: every increment is withdrawable (expand/contract, migration rollback) so a realized issue's blast radius is bounded (§VI-27). Risk that cannot be made reversible is escalated, not accepted.
- **Respond to issues through existing paths.** A realized issue follows the **failure-response and escalation paths already defined for the relevant gate** (§VI-18) and the anti-drift controls (§VI-19); this phase adds none. High-consequence issues escalate to the Human Principal (DNA Ch 18.9).
- **Record every issue in institutional memory.** Every material issue is written to `memory/` — cause and resolution to the failure library, a standing guard to the regression cases, drift to the pattern-violation record — so it cannot silently recur (DNA Ch 26; §VI-39).
- **Convert issues into guards.** An issue is not closed when patched; it is closed when a regression guard or test prevents its recurrence (`memory/regression_cases.md`, the `test:*` suites). This is the mechanism by which reliability compounds.
- **No silent absorption.** An issue absorbed without record is a governance failure (§VI-31, honest operating status); visibility is mandatory even when the fix is trivial.

**Governing rule.** Risk is contained by reversibility and anticipated before promotion; issues are responded to through *existing* gate and anti-drift paths, always recorded, and closed only when guarded against recurrence. No issue is absorbed without an entry in institutional memory.

**Dependencies.** §VI-18 (failure-response/escalation paths reused); §VI-19 (anti-drift controls); §VI-27/§VI-28 (reversibility and the validation record); §VI-39 (the improvement loop issues feed); the Constitution (DNA Ch 18.9/26).

**Risks.** The central risk is silent absorption — patching without recording — so the same failure recurs and reliability decays. The mandatory-record and close-only-when-guarded rules foreclose it.

**Traceability.** Part II: DNA Ch 18.9/25/26/30/33/35. Part III: §III-75, §III-84–§III-88. Part IV: §IV-35–§IV-55. Part VI: §VI-18, §VI-19, §VI-27, §VI-28, §VI-39. Repository: `memory/failure_library.md`, `memory/regression_cases.md`, `memory/pattern_violations.json`, `supabase/functions/server/migration/`, `supabase/migrations/rollbacks/`, `supabase/functions/server/intelligence/health.ts`, `.../telemetry.ts`. Roadmap: `MARQ_CORTEX_TEST_PROTOCOL.md`.

---

## VI-36 — Quality Assurance in Operation

**Purpose.** To define how quality is *held* while the platform is in continuous motion — the operating quality-assurance discipline that keeps every turn of the cadence (§VI-32) verified rather than assumed.

**Why it exists.** Quality bars are easy to define and easy to erode under operating pressure. Phase 6.3 defined the release-readiness bar (§VI-23) and validation evidence (§VI-28) for the *moment* of release; this section defines how quality is *continuously assured across every turn* so that the platform never drifts below its bar between releases. It exists to make verification a property of operation, not a periodic audit.

**Scope.** Operating quality discipline only. It defines no coverage percentage, no numeric quality metric, and no test count target, and it duplicates no gate (§VI-18) or readiness criterion (§VI-23); it operates them continuously.

**Current State.** **PARTIAL — a real, runnable QA substrate.** Standing quality instruments are IMPLEMENTED: the declared test suites in `package.json` — `test:smoke` (Playwright), `test:intelligence` (gateway `*.test.ts`), `test:database` (static migration tests), `test:migration` (migration tests), and `test:features` (feature tests) — plus the migration validation path (`scripts/migration/cli.ts --mode=simulation|reconcile`, `validate-s6.3.ts`), gateway certification (`certification.ts`), and the regression-case guards (`memory/regression_cases.md`). Determinism is structurally protected by the engine layer owning authoritative computation (`src/app/core/`, 30 engines; DNA Art. 6). What is **PARTIAL/UNVERIFIED** is end-to-end quality assurance that depends on a live authoritative runtime (SQL authority, enforced tenancy) not yet cut over (§VI-2, §VI-3); such verification is labelled UNVERIFIED where deployment-limited (§VI-8). No quality capability is invented.

**Approved Future State (operating quality discipline).**

- **Verification every turn.** The relevant test suites run on every turn of the cadence (§VI-32), not periodically. A turn whose verification did not run has not completed.
- **Quality bar is all-of and continuous.** The readiness criteria (§VI-23) are held *between* releases, not only at them: data authority, tenancy, gateway routing, reversibility, observability, and compatibility are continuously true, not restored at release time.
- **Determinism is protected.** Authoritative computation stays in the deterministic engine layer (§VI-2, DNA Art. 6); AI narrates and assists but never becomes the authority for a computed result. Quality assurance verifies this boundary holds on every turn.
- **Regression-first.** Every fixed issue leaves a standing guard (§VI-35); the guard set only grows, so the platform cannot silently regress a resolved failure (`memory/regression_cases.md`, `test:*`).
- **Deployment-limited verification is labelled, never claimed.** Where verification cannot be completed because the authoritative runtime is not yet live, the result is UNVERIFIED and never reported as RELEASABLE (§VI-8, §VI-31).
- **Quality is not traded for speed.** No turn skips verification to meet pressure; an increment that cannot be verified is held, not shipped (§VI-23, no partial-credit release).

**Governing rule.** Quality is a *continuous, all-of* property of operation, verified every turn and held between releases — never a periodic audit and never traded for speed. Unverifiable-because-undeployed is labelled UNVERIFIED, not passed.

**Dependencies.** §VI-23 (the readiness bar held continuously); §VI-28 (the validation evidence QA substantiates); §VI-18 (the gates QA operates); §VI-32 (the cadence QA runs within); §VI-35 (the regression guards QA grows); §VI-8 (the deployment-limitation labelling).

**Risks.** The chief risks are quality decaying between releases and deployment-limited results being over-claimed as passed. Continuous all-of verification and mandatory UNVERIFIED labelling foreclose both.

**Traceability.** Part II: DNA Ch 6/18.9/25/30/33. Part III: §III-75, §III-84–§III-88. Part IV: §IV-35–§IV-55. Part VI: §VI-2, §VI-8, §VI-18, §VI-23, §VI-28, §VI-32, §VI-35. Repository: `package.json`, `supabase/functions/server/intelligence/certification.ts`, `.../gateway.test.ts`, `scripts/migration/`, `src/app/core/`, `memory/regression_cases.md`. Roadmap: `MARQ_CORTEX_TEST_PROTOCOL.md`.

---

## VI-37 — Change Control & Configuration Integrity

**Purpose.** To define how changes to the platform and its configuration are controlled so that the system stays coherent as it changes — the change-control and configuration-integrity discipline.

**Why it exists.** A continuously changing platform can lose coherence not through any single bad change but through the *accumulation* of ungoverned ones: an undocumented schema edit, a config value changed off-workflow, a canonical `main` that drifts from what was reviewed. This section governs *how change is admitted and how configuration stays authoritative*, so that the repository's canonical state is always the reviewed, verified state — never a divergent local or deployment-only one.

**Scope.** Change admission and configuration integrity only. It defines no branching model beyond the mandatory workflow already fixed (§VI-19), no environment matrix, and no secret-management scheme. It re-uses the workflow and migration discipline already established.

**Current State.** **PARTIAL/IMPLEMENTED substrate.** Change control is **IMPLEMENTED as workflow**: the mandatory complete → review → commit → push → open PR → merge → verify-canonical-main path (§VI-19) governs every change; git history and PR review are the change record. Configuration integrity for the data plane is **IMPLEMENTED as versioned migrations**: schema change is expressed only through ordered, timestamped migrations (`supabase/migrations/`, e.g. `20260711050000_cortex_tenancy_foundation.sql` through `20260714060000_cortex_diagnostic_anon_policy_hardening.sql`) with matching `rollbacks/`, applied via `supabase:db-push`; the migration engine tracks applied state (`checkpointStore.ts`). Function deployment is scripted (`supabase:deploy`). Gateway configuration is centralized (`config.ts`, `env.ts`, `modelRegistry.ts`, `providerRegistry.ts`). What is **PARTIAL** is enforced parity between the canonical repository state and the live deployment when the authoritative runtime is not fully cut over (§VI-2, §VI-3). No control capability is invented.

**Approved Future State (change-control and integrity rules).**

- **All change flows through the mandatory workflow.** No change reaches canonical `main` except through review → PR → merge → verify (§VI-19). There is no off-workflow change path, no direct edit to canonical state, and no deployment that was not reviewed.
- **Schema changes are migrations, always reversible.** Every data-plane change is an ordered migration with a rollback (`supabase/migrations/`, `rollbacks/`), following expand → migrate → contract (§VI-27). No ad-hoc schema mutation is admitted.
- **Configuration is authoritative in the repository, not in the environment.** Gateway, provider, and model configuration is versioned in the repository (`config.ts`, `providerRegistry.ts`, `modelRegistry.ts`); environment holds secrets and bindings, never authoritative behavior. The repository is the single source of configuration truth.
- **Canonical `main` is the verified state.** Verification against canonical `main` closes every change (§VI-19); a divergence between canonical `main` and the deployed system is an integrity issue to be reconciled (§VI-35), not tolerated.
- **No parallel authority through configuration.** Change control enforces the permanent prohibitions (§VI-16): configuration may not introduce a second engine, a parallel data authority, or an AI path around the gateway. Such a change is refused at control, not merged.
- **Change is traceable to intent.** Every change traces to an approved priority (§VI-15) and, through its commit and PR, to the reasoning that admitted it — so the configuration's *why* is recoverable, not only its *what*.

**Governing rule.** Every change is admitted only through the mandatory workflow, every schema change is a reversible migration, and the repository — not the environment — is the authoritative source of configuration. Canonical `main` is always the reviewed, verified state; divergence is an issue, not a norm.

**Dependencies.** §VI-19 (the mandatory workflow change runs through); §VI-27 (reversible expand/contract for schema); §VI-16 (the prohibitions change control enforces); §VI-35 (reconciliation of any divergence); the migration engine and migrations in the repository.

**Risks.** The dominant risk is configuration drift — off-workflow change, environment-authoritative behavior, or canonical `main` diverging from deployment. Workflow-only admission, migration-only schema change, and repository-authoritative configuration foreclose it.

**Traceability.** Part II: DNA Ch 8.3/17/18/25/33/35. Part III: §III-59–§III-65, §III-84–§III-88. Part IV: §IV-35–§IV-45. Part VI: §VI-15, §VI-16, §VI-19, §VI-27, §VI-35. Repository: `supabase/migrations/`, `supabase/migrations/rollbacks/`, `supabase/functions/server/migration/checkpointStore.ts`, `supabase/functions/server/intelligence/config.ts`, `.../providerRegistry.ts`, `.../modelRegistry.ts`, `package.json` (`supabase:deploy`, `supabase:db-push`). Roadmap: `MARQ_CORTEX_EXECUTION_RULES.md`, `MARQ_CORTEX_DOCUMENTATION_RULES.md`.

---

## VI-38 — Execution Health & Progress Signals

**Purpose.** To define the **signals** by which the health of execution *itself* — not only the running product — is observed, so that the operating loop can be steered on evidence rather than impression.

**Why it exists.** A system can appear busy while making no real progress, or appear healthy while accumulating hidden failure. Phase 6.3's observability criterion (§VI-23) concerns the *product's* operability; this section concerns the *execution's* health — whether the cadence is turning, whether foundations are advancing ahead of surfaces, whether issues are being closed or accumulating. It exists so that steering decisions read from signal, and so honest status (§VI-31) has a defined evidentiary basis.

**Scope.** Execution-health and progress signals only. It defines **no numeric KPI, no dashboard specification, no target value, no scorecard, and no measurement cadence** — it names the *qualitative signals* that indicate execution health and the evidence each is read from.

**Current State.** **PARTIAL — product signals exist; execution-health instrumentation does not.** Product-runtime signals are IMPLEMENTED: gateway `health.ts`, `telemetry.ts`, and `certification.ts` emit intelligence-path health; the migration engine emits progress via `telemetry.ts` and checkpoint state. Execution-*history* signals are IMPLEMENTED as durable evidence: git/PR history (turns of the loop), the test suites' pass/fail (verification health), and the `memory/` record (issue-closure and drift history). What is **NOT IMPLEMENTED** is any *aggregated execution-health instrumentation* — progress dashboards, formal KPIs, department scorecards, a unified health framework — exactly as recorded in §VI-3 and §IV-46–§IV-55 (enterprise instrumentation NOT IMPLEMENTED; Startup maturity shape). The signals below are read today from these primary sources; their aggregation is Approved Future State, not a current capability.

**Approved Future State (qualitative execution-health signals).**

- **Cadence-is-turning.** Evidence that the operating loop advances — reviewed, verified increments reaching canonical `main` (git/PR history, §VI-32) — rather than stalling or churning without progress.
- **Foundations-lead.** Evidence that foundation and platform capability advances *ahead of* the surfaces that depend on it (the dependency order holding in practice, §VI-13–§VI-14) — a leading indicator that drift is not occurring.
- **Verification-is-green.** The standing test suites and migration validation passing on each turn (`package.json`, `scripts/migration/`) — the health of the quality discipline (§VI-36).
- **Issues-are-closing.** Evidence from `memory/` that issues are being converted to guards and closed faster than they accumulate (§VI-35, §VI-39) — the reliability trend.
- **Drift-is-absent.** No new pattern-violation entries indicating a duplicate engine, parallel authority, or gateway bypass (`memory/pattern_violations.json`, §VI-19) — the anti-drift health signal.
- **Product-runtime-is-observable.** Live gateway and migration health/telemetry present and readable (`health.ts`, `telemetry.ts`, `certification.ts`) — the operability signal (§VI-23) read as an input to execution health.

**Governing rule.** Execution is steered on *signal, not impression*: every steering or status claim reads from a named evidence source above. Signals are qualitative indicators of health, not numeric targets; the *absence* of aggregated instrumentation is stated honestly (§VI-3) and never papered over with an invented metric.

**Dependencies.** §VI-3 (the honest record that enterprise instrumentation is NOT IMPLEMENTED); §VI-23 (product observability read as an input); §VI-32 (the cadence whose turning is signalled); §VI-35/§VI-39 (the issue-closure and drift signals); §VI-36 (verification health).

**Risks.** The chief risks are steering on impression (declaring progress without evidence) and inventing a metric to imply instrumentation that does not exist. The signal-not-impression rule and the honest statement of absent instrumentation foreclose both.

**Traceability.** Part II: DNA Ch 18.9/23/25/33. Part III: §III-75, §III-84–§III-88. Part IV: §IV-46–§IV-55. Part VI: §VI-3, §VI-13, §VI-14, §VI-23, §VI-32, §VI-35, §VI-36, §VI-39. Repository: `supabase/functions/server/intelligence/health.ts`, `.../telemetry.ts`, `.../certification.ts`, `supabase/functions/server/migration/telemetry.ts`, `memory/pattern_violations.json`, `package.json`.

---

## VI-39 — Continuous Improvement & Drift Correction

**Purpose.** To define how execution **improves itself and corrects its own drift** continuously — the self-correction discipline that closes the operating loop back into the enterprise's institutional memory.

**Why it exists.** Every prior section produces evidence — issues (§VI-35), quality results (§VI-36), health signals (§VI-38); without a discipline that *consumes* that evidence to improve, the enterprise repeats its failures and drifts unnoticed until late. This section is the closing arc of the operating loop: it converts recorded failure and observed drift into standing guards and corrective action, so that reliability compounds and the architecture continuously converges toward the blueprint rather than diverging from it.

**Scope.** The self-improvement and drift-correction discipline only. It defines no retrospective schedule, no improvement metric, and no maturity model. It re-uses the institutional-memory record and the anti-drift controls (§VI-19) already established; it invents no new control.

**Current State.** **IMPLEMENTED as substrate; PARTIAL as institution.** The improvement substrate genuinely exists and is maintained: `memory/failure_library.md` (failures and resolutions), `memory/regression_cases.md` (failures converted to standing guards), and `memory/pattern_violations.json` (recorded drift/anti-pattern instances), together with per-increment review (§VI-19) and the growing regression-test set (`test:*`). Drift correction is **IMPLEMENTED as principle and record**: the permanent prohibitions (§VI-16, §VI-19) and their violation record define what drift is and capture it when found. What is **PARTIAL** is *formal, instituted* continuous-improvement ritual (structured retrospectives, improvement tracking) across a team — again bounded by the single-operator shape (§VI-3). The discipline below formalizes the compounding-reliability practice the `memory/` record already evidences.

**Approved Future State (self-correction discipline).**

- **Every failure becomes a guard.** Institutional memory is not an archive but a *forward* mechanism: each recorded failure yields a regression case or pattern-violation guard that prevents recurrence (`memory/`, `test:*`). The guard set only grows (§VI-35, §VI-36).
- **Drift is detected continuously and reversed early.** The anti-drift controls (§VI-19) run every turn, not once: any duplicate engine, parallel data authority, or gateway bypass is caught at review, recorded in `pattern_violations.json`, and reversed before it compounds. Drift correction is a standing property, not a cleanup phase (§VI-31).
- **Improvement is grounded in recorded evidence.** Improvements derive from the failure library, regression cases, and health signals (§VI-38), not from preference — the same evidence-over-impression discipline that governs the rest of the operating model.
- **Convergence, not just repair.** Correction moves the architecture *toward* the blueprint (fewer surfaces stranded, foundations more authoritative), never merely patching symptoms while structure diverges (§VI-19, §VI-27).
- **Trust is earned and compounds.** Reliability accrues as guards accumulate and drift stays absent — the operating-side expression of *trust before automation* (§VI-11) and how trust is earned (DNA Ch 26). Autonomy is extended only as this trust is demonstrated (§VI-33, §VI-16).
- **The loop closes into memory every turn.** Each cadence turn ends by updating institutional memory (§VI-32), so the next turn begins more capable than the last. An operating loop that does not feed memory is incomplete.

**Governing rule.** Execution continuously *consumes its own evidence to improve*: every failure becomes a standing guard, drift is detected and reversed each turn, and correction converges the architecture toward the blueprint. Improvement is evidence-grounded, and the loop is not complete until it has fed institutional memory.

**Dependencies.** §VI-19 (the anti-drift controls this discipline runs continuously); §VI-35 (the issues it converts to guards); §VI-36 (the regression discipline it grows); §VI-38 (the health signals it reads); §VI-32 (the cadence it closes); the Constitution (DNA Ch 26); `memory/`.

**Risks.** The dominant risks are treating memory as a passive archive (recording without guarding) and treating drift correction as a late cleanup rather than a per-turn property. The failure-becomes-guard rule and continuous anti-drift operation foreclose both.

**Traceability.** Part I: `memory/`. Part II: DNA Ch 8.3/17/18/25/26/33/35. Part III: §III-84–§III-88. Part IV: §IV-46–§IV-55. Part VI: §VI-11, §VI-16, §VI-19, §VI-31, §VI-32, §VI-33, §VI-35, §VI-36, §VI-38. Repository: `memory/failure_library.md`, `memory/regression_cases.md`, `memory/pattern_violations.json`, `package.json` (`test:*`). Roadmap: `MARQ_CORTEX_EXECUTION_RULES.md`, `MARQ_CORTEX_TEST_PROTOCOL.md`.

---

## VI-40 — Phase 6.4 Summary & Completion Record

**Purpose.** To summarize Phase 6.4 and record its completion without beginning Phase 6.5 or locking Part VI.

**Why it exists.** A phased document needs an explicit boundary so the *execution operating model* is not mistaken for an operations schedule, a staffing plan, or a plan of record, and so Phase 6.5 begins from a settled, merged foundation.

**Scope.** A summary of Phase 6.4 only (§VI-31–§VI-40) and its completion record. It defines no new priority, dependency, delivery rule, governance authority, or gate, and it begins no later phase.

**Summary of what Phase 6.4 established.**

- **Operating philosophy (§VI-31).** Operate to the blueprint never around it; cadence over heroics; explicit, singular accountability; foundations-first flow under load; failure surfaced-recorded-learned; self-correction as a standing property; honest operating status.
- **Operating cadence (§VI-32).** A recurring, interval-free loop — plan-to-priority, build-in-the-open, verify-always, release-under-governance, review-and-record — that advances at readiness, not by clock, with verification and review as non-skippable stages of every turn.
- **Roles & accountability (§VI-33).** Each operating act mapped to a single *already-defined* authority (gate authorities, Part IV structure, the human floor), honored today by the single operator and distributed additively only as the reserved `ai_worker` workforce is VERIFIED-realized; the human floor non-delegable.
- **Work intake & flow (§VI-34).** Intake as an admission filter against the LOCKED priority and dependency order — dependency-gated, priority-classed, foundations-first-throttled, whole-increment — with prohibited work refused at admission.
- **Risk & issue management (§VI-35).** Risk anticipated per increment and contained by reversibility; issues responded to through existing gate/anti-drift paths, always recorded in `memory/`, and closed only when guarded against recurrence.
- **Quality assurance in operation (§VI-36).** Continuous, all-of verification held between releases, determinism protected in the engine layer, regression-first, with deployment-limited results labelled UNVERIFIED and never traded for speed.
- **Change control & configuration integrity (§VI-37).** All change through the mandatory workflow, schema change as reversible migration, the repository (not the environment) authoritative for configuration, canonical `main` as the verified state, no parallel authority through config.
- **Execution health & progress signals (§VI-38).** Qualitative execution-health signals — cadence-turning, foundations-lead, verification-green, issues-closing, drift-absent, product-observable — read from named evidence, with the absence of aggregated instrumentation stated honestly.
- **Continuous improvement & drift correction (§VI-39).** The self-correcting close of the loop: every failure becomes a standing guard, drift detected and reversed each turn, correction converging the architecture toward the blueprint, trust compounding, the loop feeding institutional memory every turn.

**Current State.** All CURRENT STATE claims in this phase are grounded in the repository verified for Phases 6.2–6.3 and in the LOCKED Parts I–V. The operating substrate is real but informal: the mandatory workflow, per-increment review, the declared test suites (`package.json`), the migration engine and reversible migrations, the gateway health/telemetry/certification, and the institutional-memory record (`memory/`) are IMPLEMENTED and operated at the single-operator (Startup) shape; formalized, staffed, and instrumented operating institutions — a named cadence ritual, a multi-role accountability structure, an intake/flow-metrics system, a formal risk register, aggregated execution-health instrumentation, and structured continuous-improvement ritual — are PARTIAL or NOT IMPLEMENTED, bounded by the single-operator reality and the reserved (`ai_worker`) workforce runtime (§VI-3, §IV-46–§IV-55). This phase describes how execution is *operated*; it implements no operating capability and claims none as realized beyond what the repository evidences. Nothing is invented.

**Approved Future State.** A disciplined execution operating model — a readiness-paced operating cadence, singular accountability mapped to existing authority, dependency-gated intake, reversibility-contained risk with recorded issues, continuous all-of quality, workflow-only change control with repository-authoritative configuration, evidence-read execution-health signals, and a self-correcting improvement loop that compounds trust — operating the delivery model LOCKED in Phase 6.3 and realizing the sequence LOCKED in Phase 6.2 and the direction LOCKED in Part V, without editing any of them.

**Validation of this phase.**

- Phase 6.4 authored.
- Sections VI-31 through VI-40 present, exactly once, in continuous numbering after §VI-30.
- No previously LOCKED Part (I–V) modified.
- Phase 6.1 (§VI-1–§VI-10), Phase 6.2 (§VI-11–§VI-20), and Phase 6.3 (§VI-21–§VI-30) preserved unchanged.
- No priorities, dependencies, delivery model, governance, security, or gates redefined — only operated.
- Every CURRENT STATE statement grounded in repository evidence; no capability invented.
- No dates, milestones, sprints, story points, engineering estimates, staffing, tickets, budgets, or implementation instructions.
- Phase 6.5 not begun; Part VI not locked.

**Dependencies.** All Phase 6.4 sections (§VI-31–§VI-39); Phase 6.3 (§VI-21–§VI-30), Phase 6.2 (§VI-11–§VI-20), and Phase 6.1 (§VI-1–§VI-10); Parts I–V (LOCKED) and the Constitution.

**Traceability.** Part I: `ARCHITECT.md`, `memory/`, `src/system/manifest.ts`. Part II: DNA Ch 8.3/17/18/25/26/30/33/35. Part III: §III-15–§III-88. Part IV: §IV-23–§IV-55. Part V: §V-1–§V-30. Part VI: §VI-1–§VI-30. Repository: `src/app/core/`, `supabase/functions/server/intelligence/`, `supabase/functions/server/repositories/`, `supabase/functions/server/migration/`, `supabase/migrations/`, `scripts/migration/`, `memory/`, `package.json`. Roadmap: `MARQ_CORTEX_ROADMAP.md`, `MARQ_CORTEX_EXECUTION_RULES.md`, `MARQ_CORTEX_TEST_PROTOCOL.md`, `MARQ_CORTEX_DOCUMENTATION_RULES.md`.

**Completion Evidence.** This record; the presence of §VI-31–§VI-40; the unchanged Phase 6.1, Phase 6.2, Phase 6.3, and Parts I–V; the grounding of every CURRENT STATE claim in repository evidence; the absence of any dates, tasks, assignments, numeric KPIs, or implementation instructions.

---

**Phase 6.4 Status: COMPLETE**

**Part VI remains: IN PROGRESS**

**Phase 6.5 has not begun.**

**Continuity note.** The Master Blueprint remains a single, continuous document. Parts I–V remain LOCKED and unchanged; Phase 6.1 (§VI-1–§VI-10), Phase 6.2 (§VI-11–§VI-20), and Phase 6.3 (§VI-21–§VI-30) are preserved. Phase 6.4 (§VI-31–§VI-40) is authored and complete but not locked. The next Part VI phase (6.5) is not begun here.

*End of Phase 6.4. Part VI continues in a later phase.*
