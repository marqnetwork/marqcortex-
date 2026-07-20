# MARQ CORTEX — MASTER BLUEPRINT

**Document:** `MARQ_CORTEX_MASTER_BLUEPRINT_v1.0`
**Class:** Enterprise Master Blueprint — Definitive Source of Truth
**Owner & Steward:** MARQ Networks
**Status:** Part I LOCKED · Part II LOCKED · Part III IN PROGRESS · Parts IV–VI PLANNED
**Governing authority:** Subordinate to `CORTEX_DNA_v1.0.md` (Part II). Where this blueprint and the Constitution conflict on identity, philosophy, or governance, the Constitution prevails (Part II, Chapter 25).
**Master rule:** The Master Blueprint is the authority; the codebase is the implementation. On conflict, Blueprint first, code second. Every future feature must exist in this Blueprint before implementation.

---

## How this document is organized

This Master Blueprint is a single, continuous, permanent document composed of **six Parts**. It is never split into separate documents. Together, the six Parts are intended to be complete enough that, if all source code were permanently lost, a world-class engineering organization could faithfully rebuild MARQ Cortex — and its approved future — from this document alone.

| Part | Phase | Subject | Status |
|------|-------|---------|--------|
| **Part I** | Phase 1 | Product Recovery — the verified structural state of the platform | **LOCKED** |
| **Part II** | Phase 2 | Cortex DNA — the Constitution: identity, philosophy, governance | **LOCKED** |
| **Part III** | Phase 3 | Product Blueprint — the complete, reality-first description of the product | **IN PROGRESS** |
| **Part IV** | Phase 4 | AI Company Architecture — the AI-Workforce organizational model (executives, departments, managers, workers) | **PLANNED** |
| **Part V** | Phase 5 | Future Vision — the approved long-horizon direction | **PLANNED** |
| **Part VI** | Phase 6 | Execution Roadmap — the sequenced plan to realize the blueprint | **PLANNED** |

Parts IV, V, and VI are approved elements of the final architecture and are reserved in this structure; they are authored in later phases and appended to this same document with continuous numbering. Until written, they exist as PLANNED placeholders in this table only — no content is invented ahead of its phase (Golden Rule 5).

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

**Status:** IN PROGRESS · **Numbering:** Sections III-1 through III-88 (plus appendices) · **Continuity:** this Part is generated across multiple passes; numbering and formatting are continuous and are never restarted.

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

**Continuity note.** The Master Blueprint remains a single document. The next authoring phases append **Part IV — AI Company Architecture**, **Part V — Future Vision**, and **Part VI — Execution Roadmap** (currently PLANNED per the organization table), continuing the same numbering and formatting conventions, with no restart and no split.

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

# PART VI — PHASE 6: EXECUTION ROADMAP

**Status:** IN PROGRESS · **Numbering:** Sections VI-1 onward (continuing the single-document numbering after §IV-55; Part V — Future Vision remains PLANNED and unauthored, so no §V-NN sections yet exist) · **Continuity:** Part VI appends to the same Master Blueprint; numbering and formatting are continuous and are never restarted. Parts I–IV remain LOCKED and are neither modified, restated, nor contradicted here (Preservation rule; Golden Rules 1 and 8).

## Reading conventions for Part VI

Part VI is the **Execution Roadmap** — the sequenced plan to realize the approved blueprint. It is authored in phases, beginning with **Phase 6.1 — Current State Assessment & Gap Analysis**, which establishes the execution baseline before any sequencing is proposed. It carries the discipline of Parts III–IV without exception:

- **CURRENT STATE vs APPROVED FUTURE STATE.** Every section separates what exists today from what the blueprint approves. CURRENT STATE is grounded strictly in repository evidence or the LOCKED Parts I–IV; APPROVED FUTURE STATE is traced to the Constitution (Part II), the product blueprint (Part III), the enterprise architecture (Part IV), and the roadmap.
- **Implementation labels.** CURRENT STATE is tagged **IMPLEMENTED**, **PARTIAL**, or **NOT IMPLEMENTED** (the Part III/IV convention, where IMPLEMENTED ≈ PROVEN). No capability is invented; nothing observed is normalized against the Constitution.
- **Never invent.** Where a capability does not exist, it is marked NOT IMPLEMENTED and tied to its reserved future identity. Where the blueprint that a section would compare against is itself unauthored, that is stated plainly rather than assumed.

**Note on Part V.** The task baseline for this phase names Parts I–V as the approved comparison surface. In the document as authored, **Parts I–IV are LOCKED and Part V — Future Vision is PLANNED but not yet written** (per the Part IV completion record and the organization table, §front-matter). Phase 6.1 therefore compares CURRENT STATE against the approved blueprint **as it exists today** — Parts I–IV (LOCKED) plus the Constitution — and treats the long-horizon strategic direction as it is currently carried: by the DNA (Part II, the constitutional source of vision and mission), by the APPROVED FUTURE STATE sections throughout Parts III–IV, and by `MARQ_CORTEX_ROADMAP.md`. Part V is recorded throughout as **NOT IMPLEMENTED (unauthored)**. This preserves traceability and invents nothing.

**What this phase is not.** Phase 6.1 is not a sprint plan, not a delivery schedule, and not a backlog. It defines no milestones, tasks, assignments, budgets, hiring, timelines, or technical implementation. Those belong to later Part VI phases (6.2 onward). This phase ends at §VI-10 and neither begins Phase 6.2 nor locks Part VI.

---

## Phase 6.1 — Current State Assessment & Gap Analysis

*This phase establishes the execution baseline for MARQ Cortex. It compares the CURRENT IMPLEMENTATION against the APPROVED BLUEPRINT (Parts I–IV LOCKED, plus the Constitution) to identify what already exists, what is partially implemented, and what remains to be built before Cortex reaches the approved future state. It categorizes gaps and dependencies without prioritizing or sequencing solutions.*

---

## VI-1 — Executive Assessment

**Purpose.** To give a high-level, evidence-grounded assessment of the current MARQ Cortex implementation measured against the approved blueprint (Parts I–IV LOCKED, plus the Constitution).

**Why it exists.** Execution cannot be sequenced honestly until the starting point is fixed. This section states, at the executive altitude, how far the realized system has traveled toward the approved architecture — so that every later gap, dependency, and principle is read against a settled baseline rather than an aspiration.

**Scope.** The whole system at a glance: product (Part III), enterprise/AI-company architecture (Part IV), and strategic readiness (the DNA and the future-state sections, standing in for the unauthored Part V). No section-by-section detail — that follows in §VI-2 through §VI-4.

**Current State (PARTIAL).** MARQ Cortex today is a **substantially implemented product on a settled constitutional and architectural foundation, operating as a single-operator (Startup-shape) enterprise, with data-authority migration and the AI-workforce runtime still ahead.**
- **IMPLEMENTED.** The deterministic product core exists: 37 engines in `src/app/core/` (scoring, decision, portfolio, ROI/DCF/IRR/Monte-Carlo/scenario/cost/cashflow, proposal-gate, snapshot/version/export, contract, execution/scope/template, ROI-actuals, QBR, CRM, copilot/AI-assist/objection), a 171-node component manifest (`src/system/manifest.ts`), the full pre-sale → post-sign journey routes (`src/app/pages/`), the Intelligence Gateway with live provider adapters (`supabase/functions/server/intelligence/`), the CORTEX AI surfaces (chat, narrative, analysis, copilot-patch, block-assist, proposal-section copilot), a repository layer and KV store, a migration engine with CLI, and system memory (`memory/`). Governance doctrine is settled and LOCKED (Constitution → Blueprint → Operating Constitution → sprint criteria → verified behavior).
- **PARTIAL.** Relational schema, RLS, and tenancy migrations exist, but **KV remains the runtime storage authority**; SQL cutover is in progress (roadmap Phase 4/5, currently S7.4 Outcome Shadow Read). The Intelligence Gateway is live single-provider; multi-provider/agent orchestration is future. Multi-tenant isolation is defined (RLS) but not yet the enforced runtime authority.
- **NOT IMPLEMENTED.** The Part IV **AI Workforce as a runtime** (executives, departments, managers, AI workers) — reserved to the `ai_worker` future identity; enterprise performance instrumentation and formal KPIs (§IV-46–§IV-55 record raw signals plus the constitutional success standard); and **Part V — Future Vision** (unauthored).

**Approved Future State.** The additive realization of the approved blueprint: SQL as authoritative data plane under enforced multi-tenancy; multi-provider/agent intelligence; progressive standing-up of the AI workforce against the reserved identity; and instrumented enterprise performance — each delivered without rebuild and subordinate to the constitutional identity and success test (DNA Ch 8.3, Ch 23, Ch 33). Authoring of Part V and later Part VI phases completes the approved comparison surface.

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

**Purpose.** To assess readiness against the strategic direction that would be defined in Part V.

**Why it exists.** A gap analysis must weigh how ready the realized system is for its approved long-horizon direction. Because Part V is unauthored, this section is explicit about *what* strategic direction it measures against, so readiness is grounded and not fabricated.

**Scope.** Long-horizon strategic readiness. Because **Part V — Future Vision is NOT IMPLEMENTED (unauthored)**, the strategic direction is read from its current constitutional carriers: the DNA (Part II — vision, mission, product/AI philosophy, progressive AI-company doctrine), the APPROVED FUTURE STATE sections throughout Parts III–IV, and `MARQ_CORTEX_ROADMAP.md`.

**Current State.**
- **Part V — Future Vision: NOT IMPLEMENTED (unauthored).** It exists only as a PLANNED placeholder in the organization table; no §V-NN content has been written (§front-matter; Part IV completion record).
- **Strategic direction (as currently carried): IMPLEMENTED as constitutional intent.** The DNA fixes identity, mission, and the "Maximum Intelligence, Minimum Complexity" north-star, and approves the AI-company as progressive-yet-approved (DNA Ch 8.3). This direction is settled and LOCKED.
- **Strategic *readiness* of the realized system: PARTIAL.** The deterministic product core and constitutional foundation are strong footing for the approved direction (IMPLEMENTED substrate, §VI-2). The two pillars the long horizon most depends on — an authoritative, multi-tenant SQL data plane and a standing AI workforce — are respectively **PARTIAL** (KV-authoritative, SQL cutover in progress) and **NOT IMPLEMENTED** (reserved identity). Enterprise instrumentation to steer strategy is **NOT IMPLEMENTED** (§IV-46–§IV-55).

**Approved Future State.** Authoring of Part V — Future Vision to make the long-horizon direction explicit and comparable, followed by additive realization: SQL authority, enforced tenancy, multi-provider/agentic intelligence, and the AI workforce — each subordinate to the constitutional success test (DNA Ch 33). Until Part V is authored, the DNA and Parts III–IV future-state sections remain the authoritative strategic surface.

**Dependencies.** Part II (DNA, strategic source); Parts III–IV future-state sections; `MARQ_CORTEX_ROADMAP.md`; authoring of Part V; §VI-2 and §VI-3.

**Traceability.** Part I: `ARCHITECT.md`. Part II: DNA Ch 3/4/5/8/8.3/33 (mission/vision/philosophy/north-star). Part III: §III-59, §III-79, §III-80 (future-state/debt paths). Part IV: §IV-53 (maturity), §IV-46–§IV-55. Roadmap: `MARQ_CORTEX_ROADMAP.md`; front-matter organization table (Part V PLANNED).

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
- **G7 — Strategic-surface gap (NOT IMPLEMENTED).** Part V — Future Vision is unauthored; the long-horizon direction is carried only by the DNA and future-state sections. *Category: Governance / Documentation.*
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
- **Governance / documentation.** The LOCKED Constitution and Parts I–IV; authoring of Part V — **NOT IMPLEMENTED** (gates G7).

**Approved Future State.** Each dependency class matures additively to unblock its gaps — authoritative SQL, enforced tenancy, multi-provider AI, instrumented operations, live integrations, and an authored Part V — without violating existing platform, API, auth, or tenancy contracts (Execution Rules; DNA Ch 8.3).

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
- **Governance — IMPLEMENTED.** The constitutional authority stack, amendment process, and LOCKED Parts I–IV give a settled governing frame (DNA Ch 25/35); the one open governance item is authoring Part V (G7).
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
4. **Part V — Future Vision is unauthored (NOT IMPLEMENTED)**; strategic direction is currently carried by the DNA and the Parts III–IV future-state sections (§VI-4).
5. Eight categorized gaps (G1–G8) and their high-level dependencies and constraints are inventoried without prioritization (§VI-5, §VI-6, §VI-8).

**Current State.** Product core and governance: **IMPLEMENTED**. Data authority, tenancy enforcement, intelligence breadth, integrations, and maturity: **PARTIAL**. AI workforce runtime, enterprise instrumentation, and Part V: **NOT IMPLEMENTED**. Everything is grounded in repository evidence or the LOCKED Parts I–IV; nothing is invented.

**Approved Future State.** Additive realization of the approved blueprint — SQL authority, enforced tenancy, multi-provider/agentic AI, a progressively standing AI workforce, instrumented performance, and an authored Part V — each subordinate to the constitutional identity and success test (DNA Ch 8.3, Ch 33). Prioritization and sequencing are deferred to later Part VI phases.

**Dependencies.** All Phase 6.1 sections (§VI-1–§VI-9); Parts I–IV (LOCKED) and the Constitution as the grounding record; `MARQ_CORTEX_ROADMAP.md` and `MARQ_CORTEX_EXECUTION_RULES.md`; the unauthored Part V as an open governance item.

**Traceability.** Part I: `ARCHITECT.md`, `architecture/system_map.json`, `src/imports/cortex-audit-report.md`. Part II: DNA Ch 8/8.3/17/18/23/25/30/33/35. Part III: §III-15–§III-21, §III-29, §III-37, §III-44, §III-59–§III-65, §III-78–§III-80, §III-84–§III-88. Part IV: §IV-1–§IV-12, §IV-23–§IV-34, §IV-35–§IV-45, §IV-46–§IV-55. Roadmap: `MARQ_CORTEX_ROADMAP.md`, `MARQ_CORTEX_EXECUTION_RULES.md`, `MARQ_CORTEX_TEST_PROTOCOL.md`.

---

## Phase 6.1 — Completion Status

**Phase 6.1 (Current State Assessment & Gap Analysis) is complete: Sections VI-1 through VI-10.** It establishes the execution baseline for MARQ Cortex by comparing the current implementation against the approved blueprint (Parts I–IV LOCKED, plus the Constitution): an executive assessment, the current product state, the current enterprise state, current strategic readiness, a categorized gap inventory (G1–G8), critical dependencies, implementation readiness across seven disciplines, execution constraints, and the execution principles that must govern all later phases. CURRENT STATE is grounded throughout in the repository and the LOCKED Parts I–IV and is labelled IMPLEMENTED / PARTIAL / NOT IMPLEMENTED: the product core and governance are IMPLEMENTED; data authority, tenancy enforcement, intelligence breadth, integrations, and maturity are PARTIAL; the AI workforce runtime, enterprise instrumentation, and **Part V — Future Vision (unauthored)** are NOT IMPLEMENTED. No capability is invented. This phase defines no sprints, milestones, tasks, assignments, budgets, hiring, timelines, or technical implementation — those belong to later Part VI phases.

**Continuity note.** The Master Blueprint remains a single, continuous document. Parts I–IV remain LOCKED and unchanged. Authoring of Part V — Future Vision remains PLANNED, and the next Part VI phase (6.2) is not begun here. This phase is neither reviewed nor locked.

*End of Phase 6.1. Part VI continues in a later phase.*
