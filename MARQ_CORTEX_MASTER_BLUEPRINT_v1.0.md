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
