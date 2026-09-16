# MARQ Cortex — Product Reality

**What a real person can actually do with MARQ Cortex today, measured against the
canonical documents rather than against previous progress reports.**

Audited 2026-09-16 against main `b349fc1a`. Evidence is the repository, a real
build, and a real browser driving the real application. Where repository evidence
and a progress document disagreed, the repository won.

> **CP-1 answered §7 and §9; CP-2 answered §9's registry paragraph.** The
> navigation defects are fixed, the fabricated data is isolated behind
> `src/app/demo/`, and `registryAudit`'s over-permissive `LIVE` is now `WIRED`
> with capability answered separately per destination. This document is left as
> it was written — it is the evidence those sprints were measured against, and
> rewriting it would destroy that. What changed is recorded in
> `MARQ_CORTEX_CP1_RECORD.md` and `MARQ_CORTEX_CP2_RECORD.md`. The headline
> numbers are now **~35% product / ~80% foundation**, and live verification
> remains BLOCKED.

This document does **not** replace `MARQ_CORTEX_MASTER_BLUEPRINT_v1.0.md`,
`MARQ_CORTEX_PRODUCT_EXPERIENCE.md`, `MARQ_CORTEX_ONTOLOGY_v1.0.md` or
`MARQ_CORTEX_IMPLEMENTATION_GUIDE_v1.0.md`. It translates them into current
implementation reality. Companion: `MARQ_CORTEX_ACCELERATED_BUILD_PLAN.md`.

---

## 0. The two numbers, kept apart

| | |
|---|---|
| **Actual product completeness** | **~30%** |
| **Engineering foundation completeness** | **~80%** |

These are deliberately separate and must never be merged. A green test suite is
not a product feature. The engineering foundation here is genuinely strong — and
it is not the thing that is missing.

### The one-paragraph reason for the gap

**What was built is a consulting diagnostic-and-proposal tool with an
enterprise-grade AI backend behind it. What the canon describes is an enterprise
operating system.** The Enterprise Domain Registry names 24 domains and 561
capabilities; the shipped application has 13 navigation destinations, and they
cluster almost entirely in three of those domains — Diagnostic Assessment (D07),
Revenue & Commercial (D08) and Client Engagement (D04). Knowledge, goals,
strategy, decisions, risks, opportunities, projects outside a consulting
delivery blueprint, people beyond a member list, departments, time, search,
documents-as-records, scheduling and integration are either absent or a single
demo panel. On top of that, **the product ships with `VITE_BACKEND_INTEGRATION`
false**, so every number a user sees today is fabricated, the AI Control Plane
renders "Unavailable", and no AI provider is ever called. The foundation was
built to production standard; the product on top of it was built to demo
standard.

---

## 1. Method, and what would falsify this

- `npm ci`, `npm run build`, served from `dist/` under the real `vercel.json`
  headers via `scripts/serve-release.mjs`.
- A real Chromium session signed in through the demo team login, driving all 13
  declared destinations plus the public and client surfaces, at 1440×900 and
  390×844.
- Source tracing of every dashboard's data import to its origin.
- `git log` over 185 commits and 27 merged pull requests.
- The canonical registries read directly, not from memory.

Disposable local PostgreSQL and a local static server were used. **Neither is
production and neither is reported as production evidence.** No production system
was contacted.

---

## 2. There is no "A-value" architecture in the canon

This was searched for exhaustively and **does not exist**. There is no `A1..An`
enumeration in the Ontology, the Blueprint, the Product Experience, the
Reference Architecture, the Implementation Guide, the Constitution or the
registries. Rather than invent one, this audit uses the two structures the canon
actually defines:

- **`MARQ_CORTEX_ENTERPRISE_DOMAIN_REGISTRY_v1.0.md`** — 24 domains, `D01–D24`.
- **`MARQ_CORTEX_ENTERPRISE_CAPABILITY_REGISTRY_v1.0.md`** — 561 capabilities,
  `C0001–C0561`, across modules `M001–M186`.

The nearest thing to a "value architecture" is **Product Experience Chapter 54 —
Value Architecture**, which defines value as multi-dimensional and lists ten
dimensions (Customer, Employee, Organizational, Financial, Operational,
Knowledge, Innovation, Partner, Community, Environmental). The canon presents
these as *"Examples include"* — an open list, not a closed enumeration — so they
are treated here as dimensions to measure against, not as a fixed schema. **No
Cortex surface currently models, measures or reports any of them.** Value
Architecture is `NOT STARTED` as a product capability.

---

## 3. Domain position — the canonical 24

Status vocabulary: `NOT STARTED` · `FOUNDATION ONLY` · `PARTIAL` ·
`FUNCTIONAL BUT INCOMPLETE` · `PRODUCT COMPLETE`.

| Domain | Shipped surface | Real data? | Status | Est. |
|---|---|---|---|---|
| D01 Intelligence & AI | AI Control Plane; Cortex chat; inline assist | Backend real, **console "Unavailable" in shipped config**, mock provider first | PARTIAL | 35% |
| D02 Knowledge Management | — | — | NOT STARTED | 5% |
| D03 Work & Workflow Execution | Execution blueprint (consulting delivery) | Demo | PARTIAL | 25% |
| D04 Customer & Client Engagement | Client portal, messaging, QA review | Demo auth; live path exists, gated | FUNCTIONAL BUT INCOMPLETE | 40% |
| D05 Product Management | — | — | NOT STARTED | 0% |
| D06 Business Operations | Operations panel (thin) | Backend real, gated | FOUNDATION ONLY | 15% |
| D07 Diagnostic Assessment | Diagnostic → score → report; 39 deterministic engines | Engines real and client-side | FUNCTIONAL BUT INCOMPLETE | 65% |
| D08 Revenue & Commercial | Pipeline, proposals, ROI/DCF/Monte Carlo, contracts, QBR | Demo | PARTIAL | 50% |
| D09 UX & Interaction | Nav model, command palette, tokens, responsive shell | n/a | FUNCTIONAL BUT INCOMPLETE | 60% |
| D10 Analytics & Reporting | Analytics + Revenue Intelligence dashboards | Demo | PARTIAL | 30% |
| D11 Search & Discovery | Command palette only | Local | FOUNDATION ONLY | 15% |
| D12 Communication & Notifications | Notification centre, email queue, client threads | Demo / gated | PARTIAL | 25% |
| D13 Document & Records | PDF/proposal export | Client-side | PARTIAL | 25% |
| D14 Scheduling & Coordination | Meeting scheduler, instant booking | Demo | FOUNDATION ONLY | 20% |
| D15 Identity & Access | Team + client auth, roles, RBAC | Live path exists, gated | PARTIAL | 45% |
| D16 Organization & Tenancy | Team management; composite-key tenancy in DB | Backend real | PARTIAL | 50% |
| D17 Data & Information | 5 repositories, 21 migrations, KV→SQL authority | Backend real, unused by UI | PARTIAL | 45% |
| D18 Integration & Interoperability | CRM sync panel | Demo | FOUNDATION ONLY | 10% |
| D19 Observability & Telemetry | Enterprise health + KPI roll-up | Backend real, gated | PARTIAL | 40% |
| D20 Platform Config & Admin | Settings, AI administration | Gated / unavailable in demo | PARTIAL | 35% |
| D21 Security & Privacy | Guards, RLS, CSP, 12 closed findings | Backend real | FUNCTIONAL BUT INCOMPLETE | 55% |
| D22 Governance, Risk & Compliance | AI governance, audit, approvals — **backend only** | Backend real, no product surface | FOUNDATION ONLY | 25% |
| D23 Engineering & Delivery Lifecycle | Tests, gates, migrations, release | Real | *(engineering, not product)* | 85% |
| D24 External Ecosystem | — | — | NOT STARTED | 5% |

**Product completeness across the 23 product domains (D23 excluded as
engineering): ~31%.** Reported as **~30%**.

---

## 4. Value Architecture position (PX Ch54)

| Value dimension | Modelled? | Measured? | Surfaced? | Status |
|---|---|---|---|---|
| Customer | Diagnostic score + ROI proxy only | Partly | Client report | PARTIAL |
| Financial | ROI/DCF/IRR/Monte Carlo engines exist | Yes, on demo inputs | Revenue Intelligence | PARTIAL |
| Operational | Enterprise health + KPI backend | Backend only | Operations (thin) | FOUNDATION ONLY |
| Organizational | — | — | — | NOT STARTED |
| Employee | — | — | — | NOT STARTED |
| Knowledge | — | — | — | NOT STARTED |
| Innovation | — | — | — | NOT STARTED |
| Partner | — | — | — | NOT STARTED |
| Community | — | — | — | NOT STARTED |
| Environmental | — | — | — | NOT STARTED |

The canon calls value *"the primary organizing principle of the enterprise"* and
*"the highest operational objective"*. Cortex currently organizes around a
**sales pipeline**. Two of ten dimensions are partially represented, and neither
is named as value anywhere in the product.

---

## 5. Sprint position — reconstructed from git, not from a summary

185 commits, 27 merged pull requests.

| Sprint / batch | Built | In main | Reachable | Real data | Product complete | Engineering complete | Gap |
|---|---|---|---|---|---|---|---|
| Roadmap S1–S2 Intelligence Gateway | Superseded by AI Control Plane | ✅ | Admin only | Backend | ❌ | ✅ | No user-facing AI |
| S3–S4 Database & tenancy | 21 migrations, composite FKs, RLS | ✅ | n/a | ✅ | n/a | ✅ | UI never reads it |
| S5 Diagnostic foundation | 5 repositories | ✅ | Gated | Backend | ❌ | ✅ | Frontend uses demo |
| S6.1–S6.3 Migration infra | Inventory/simulate/backfill/reconcile | ✅ | CLI | ✅ | n/a | ✅ | Never run on real data |
| S7.1–S7.7 Storage gateway, shadow reads | Outcome + submission | ✅ | ❌ | Backend | ❌ | ✅ | Switches off; no traffic |
| S8.1 Read authority (G1) | Cutover mechanism | ✅ | ❌ | Backend | ❌ | ✅ | Off; unexercised |
| Phase 2 backfill | All domains, code | ✅ | CLI | ✅ | n/a | ✅ | Never executed |
| AI-01 Batches 1–4F | Control plane, providers, BYOK, routing, spend | ✅ | **"Unavailable" in shipped config** | Backend | ❌ | ✅ | Invisible to users |
| AI-01 Batch 3A Agent runtime | Registry, runs, approvals | ✅ | Admin read-only | Backend | ❌ | ✅ | **No surface creates a run** |
| AI-01 Batch 3B Workflow runtime | Diagnostic readiness review | ✅ | Admin console only | Backend | ❌ | ✅ | Off by default |
| G2 Multi-tenancy | Composite keys, 14 relationships | ✅ | n/a | ✅ | n/a | ✅ | — |
| G5 Enterprise health / KPIs | Roll-up + report | ✅ | Operations panel | Backend | ❌ | ✅ | Thin surface, gated |
| UI Sprints 1–8 | Tokens, nav model, palette, shell | ✅ | ✅ | Demo | PARTIAL | ✅ | See §7 defect |
| ClientPortal live auth | Email-code path | ✅ | Gated | Live path exists | PARTIAL | ✅ | Needs RESEND + backend |
| Release hardening S-1…S-12 | 12 security findings closed | ✅ | n/a | n/a | n/a | ✅ | — |
| Checkpoint A + runbook repair | Access audit, 2 runbook defects | ✅ | n/a | n/a | n/a | ✅ | Production unreachable |

**Stale statuses corrected:** the checklist's "UI Sprints 1–8 complete" and "21
browser tests green" both overstate — see §7. "Agent runtime complete" is true of
the runtime and false of the experience.

---

## 6. Human × AI position

The canon (PX Ch61–67, RA Ch15, D01/D22) describes a governed Human × AI
operating model. Separating the layers honestly:

| Capability | Architecture | Code | Runtime | UI | **User can actually use it** |
|---|---|---|---|---|---|
| Governed AI request handling | ✅ | ✅ | ✅ | — | ❌ mock provider first; real requests off |
| Provider administration / BYOK | ✅ | ✅ | ✅ | ✅ | ❌ console "Unavailable" in shipped config |
| Routing & failover | ✅ | ✅ | ✅ | ✅ | ❌ same |
| Spend ceiling & budget | ✅ | ✅ | ✅ | ✅ | ❌ same |
| Cortex chat / narrative | ✅ | ✅ | ✅ | ✅ | ⚠️ falls back to a local mock |
| AI recommendations | ✅ | ✅ | partial | ✅ | ⚠️ deterministic engines, labelled as AI |
| AI explanations / citations | ✅ | partial | ❌ | ❌ | ❌ |
| Human approval of AI action | ✅ | ✅ | ✅ | admin only | ❌ not in any product flow |
| Human override / kill switch | ✅ | ✅ | ✅ | admin only | ❌ |
| Agent definition & authority | ✅ | ✅ | ✅ | read-only | ❌ |
| Agent task delegation | ✅ | ✅ | ✅ | ❌ | ❌ **no surface creates a run** |
| Multi-agent coordination | ✅ | ✅ | ✅ | ❌ | ❌ |
| Agent memory / institutional memory | partial | ❌ | ❌ | ❌ | ❌ |
| Autopilot | ✅ (documented) | ❌ | ❌ | ❌ | ❌ |
| Organizational learning | partial | partial | ❌ | Learning panel (demo) | ❌ |

**The decisive sentence, from the repository's own source:** `agentRuntimeService`
states runs are *"created by the product surfaces that need them, not by an
operator clicking 'start an agent'"* — and **no product surface creates one.**
The agent runtime has no producer. AI Workforce is architecture, code and runtime
with **zero user-reachable experience**.

---

## 7. Two defects found during this audit

Recorded here because both are in release gates that were reported green.

**7.1 — Six of thirteen deep-link assertions prove nothing.** *(CP-1: fixed.
Both that suite and the accessibility audit now read the destination list off
the rendered sidebar, which renders from `NAV_GROUPS`, so there is no second
copy to drift. `navigation-truth.spec.ts` asserts destination IDENTITY rather
than liveness.)* The smoke suite
(`tests/smoke/v1-integration-qa.spec.ts`) navigates `?page=<id>` for 13
destinations. Four of the IDs it uses — `reviewer-qa`, `email-queue`,
`revenue-intelligence`, `mapping-engine` — **do not exist**; the nav model
declares `reviewer`, `emails`, `revenue`, `mapping`. Invalid IDs fall back to the
Dashboard, and the assertion (no console errors, some content) passes anyway.

**7.2 — Two real destinations do not deep-link at all.** *(CP-1: fixed. The
resolver had two answers, so a real destination the shell cannot render
collapsed into the fallback exactly like a typo; it has three now. The route
each lives at is declared once, on the Destination, instead of in three places
that disagreed.)* `?page=execution` and
`?page=architecture` **silently render the Dashboard**. Both are declared in
`NAV_GROUPS` and both only work via their dedicated routes `#/team/execution`
and `#/architecture`. A bookmark or a reload on either shows the wrong page.

Verified in a real browser, signed in, one destination at a time with a reset
navigation between each. This is the same defect class the repository has already
recorded twice (the S-12 comment-stripper, and the reload test that compared a
spinner to page chrome): **a gate that cannot detect the failure it names.**

---

## 8. What exists but is not yet a real product experience

- **AI Control Plane** — ten sub-surfaces; renders "Unavailable" in the shipped
  configuration.
- **Agent runtime** — full lifecycle, approvals, cost attribution; no producer.
- **Workflow runtime** — one workflow, off by default, startable only from admin.
- **Shadow reads & read authority** — both switches off; never seen traffic.
- **Phase 2 backfill & reconciliation** — complete, never run on real data.
- **Enterprise health & KPI roll-up** — backend real, surfaced as a thin panel.
- **Five diagnostic repositories** — real, and the frontend reads demo data instead.
- **Composite-key tenancy** — enforced in the database the UI does not query.
- **39 deterministic engines** in `src/app/core` — real computation on fabricated inputs.
- **Client portal live auth** — implemented, gated behind a flag and `RESEND_API_KEY`.

---

## 9. Fabricated data inventory

| Source | Lines | Feeds |
|---|---|---|
| `mockCortexData.ts` | 2,411 | CORTEX modules, leads, analysis |
| `mockCortexAIBrain.ts` | 741 | "AI" responses |
| `demoData.ts` | 753 | Submissions, team, clients, login |
| `mockAIAnalysis.ts` | 416 | Diagnostic AI output |
| `mockClientReport.ts` | 171 | Client report |

**4,492 lines of fabricated business data**, and it is what a user sees, because
`VITE_BACKEND_INTEGRATION` ships `false`. Named companies ("Manufacturing Pro",
"RetailMax Inc", "TechCorp Solutions"), a `$3.12M` pipeline and a `91/100`
pipeline-health score are all invented.

> **CP-1:** closed. The count was an undercount — the real total is 5,927 lines
> once the revenue snapshots, the execution project, the Mapping Engine's
> proposal and the canned assistant are included, all of which this table
> missed because they were declared inline in components and engines rather
> than in files named `mock*`. Everything is now under `src/app/demo/`, in its
> own bundle chunk, behind a standing test. The fixtures are kept, not deleted;
> what changed is that reaching them requires asking for a demo by name.

The repository's own `registryAudit.ts` classifies 185 interactions as 133 LIVE /
34 GATED / 13 DEMO / 3 MISSING / 2 VISUAL — but it defines **LIVE as "works right
now with zero backend (pure UI / client-side engine)"**. Under the product
definition used here, client-side-only on fabricated inputs is not product
complete. The same reading applies to the 327-node manifest's 298 LIVE.

> **CP-2:** closed. The status is now `WIRED`, which is what it always measured,
> and the registry says so in its own header. Capability is answered separately,
> per destination, in `src/app/core/capabilityStatus.ts` — 13 declared
> destinations, of which 7 LIVE, 2 BLOCKED, 1 PARTIAL, 1 DEMO-ONLY and 2 EMPTY.
> The three that cannot deliver what their label promises are no longer offered
> in the sidebar, the palette or the mobile drawer. `capabilityTruth.test.ts`
> fails the build if a destination claims more than its source supports.
>
> CP-2 also found what this audit's file-name-based count could not: **Reviewer
> QA** invented eight companies at mount and another every thirty seconds, from
> `Math.random()`, inside the component rather than in a file named `mock*`.

---

## 10. UI/UX reality

Judged by driving it, not by counting components or tokens.

| Aspect | Verdict |
|---|---|
| Visual craft, dark theme, hierarchy | **GOOD ENOUGH** — genuinely well made |
| Navigation model, groups, command palette | **GOOD ENOUGH** |
| Responsive (1440 and 390) | **GOOD ENOUGH** — no horizontal scroll at either width |
| Honest unavailable states | **GOOD ENOUGH** — Control Plane and Email Queue say so plainly |
| Deep linking | **NEEDS REDESIGN** — §7.2 |
| Information architecture vs canon | **NEEDS REDESIGN** — organized around a sales pipeline |
| Empty states | **NEEDS REFINEMENT** — rarely reachable; demo data is always present |
| AI interaction surfaces | **NEEDS REDESIGN** — labelled AI, answered by a local mock |
| Agent / approval surfaces | **MISSING** |
| Knowledge, goals, decisions, people | **MISSING** |

One console error across all surfaces: `ERR_CERT_AUTHORITY_INVALID`, an artefact
of the audit proxy, not a product defect.

---

## 11. Weighted product completeness

| Area | Complete | Partial | Missing | Est. |
|---|---|---|---|---|
| Frontend / UI shell | Nav, tokens, palette, responsive | Deep links, empty states | — | 60% |
| Core work management | — | Consulting execution blueprint | Projects, tasks, workstreams, milestones as first-class | 20% |
| Organization / people | Member list, roles, tenancy | — | Departments, profiles, org chart | 30% |
| Strategy / goals | — | — | Goals, OKRs, strategy, decisions, risks, opportunities | 0% |
| Communication | — | Notifications, email queue, client threads | Real-time, threads, mentions | 25% |
| Knowledge / evidence | — | — | Knowledge base, citations, institutional memory | 5% |
| Client experience | Portal, report, messaging | Live auth gated | Self-service | 45% |
| Analytics / health | Dashboards, KPI backend | Demo inputs | Value measurement | 30% |
| Cortex intelligence | Engines, scoring | Narrative | Grounded reasoning | 40% |
| Human × AI | — | Chat, assist | Approvals, explanations, override in product | 20% |
| Agent / AI workforce | Runtime, registry | Admin read-only | **Any user experience** | 15% |
| Automation | Email nurture | — | Autopilot, triggers, rules | 10% |
| Integrations | — | CRM demo panel | Everything | 8% |
| Backend / data connectivity | Repositories, migrations, RLS | — | **UI does not use it** | 40% |
| Admin / governance | AI admin, settings | Gated | Governance product surface | 35% |

**ACTUAL PRODUCT COMPLETENESS: ~30%**
**ENGINEERING FOUNDATION COMPLETENESS: ~80%**

---

## 12. The honest summary

MARQ Cortex today is a **well-engineered, visually accomplished demo of a
consulting diagnostic and proposal tool**, sitting on **a genuinely
production-grade AI and data platform that the product does not yet use**.

The distance to the canon is not a hardening problem, a migration problem or a
release problem. It is that **most of the product described in the canonical
documents has not been built yet**, and the part that has been built is not
connected to the platform underneath it.

That is a good position to be in. The expensive foundation is done.
