# MARQ CORTEX — CURRENT ARCHITECTURE VS TARGET GAP MAP

> **DERIVED DOCUMENT — NOT A SOURCE OF TRUTH**  
> This document reconciles the actual MARQ Cortex repository with `architecture/MARQ_CORTEX_TARGET_ARCHITECTURE_v2.0.md`. Product meaning remains governed by the canonical Cortex documents. This artifact exists to prepare implementation and should be removed once its decisions are absorbed into the active architecture/current-state maps and implementation plan.

**Status:** Build-preparation / architecture-code reconciliation  
**Branch audited:** `docs/canonical-doc-cleanup`  
**Primary evidence:** current frontend application structure, `src/app/services/dataService.ts`, `src/app/core/navigationModel.ts`, Supabase server routes, `supabase/functions/server/ai/**`, current migrations/RLS, `ARCHITECT.md`, `architecture/system_map.json`, UI gap map, and Target Architecture v2.0.  
**Decision vocabulary:** `KEEP · REFACTOR · REPLACE · REMOVE · BUILD NEW · BLOCKED`

---

## 1. Governing Finding

MARQ Cortex does **not** need an engineering rewrite.

The repository already contains a strong platform foundation, especially around:

- PostgreSQL/Supabase persistence;
- organization tenancy and RLS;
- AI provider abstraction;
- provider routing/fallback;
- BYOK and self-hosted provider support;
- governed AI request handling;
- input/output safeguards;
- agent runtime;
- workflow runtime;
- approval machinery;
- AI budgets/spend controls;
- audit and observability;
- deterministic diagnostic/financial engines;
- frontend service-boundary discipline;
- migration and release discipline.

The primary architectural problem is **scope and organization**, not absence of engineering quality.

The existing foundation was built around a diagnostic/commercial application with an enterprise-grade AI subsystem. The target is a governed autonomous-company platform where goals, organizational structure, human and AI actors, durable work, tools, memory, knowledge, customers, outcomes, policy, and continuous improvement share one architecture.

Therefore the implementation rule is:

> **Preserve proven mechanisms. Generalize them into platform primitives. Do not create parallel replacement systems unless the existing mechanism fundamentally conflicts with Target Architecture v2.0.**

---

## 2. Architectural Decision Matrix

| Target area | Current evidence | Decision | Target action |
|---|---|---|---|
| Frontend application foundation | React + TypeScript + Vite + Tailwind, lazy routes, reusable UI primitives | KEEP | Continue; do not rebuild framework stack |
| Routing | `createHashRouter`, addressable team destinations | KEEP / REASSESS LATER | Preserve during migration; change only if deployment architecture makes browser routing safe and migration value is clear |
| Frontend data boundary | `dataService.ts` and service modules isolate UI from backend | REFACTOR | Preserve one governed frontend boundary while splitting by domain/facade as product grows |
| Current sidebar/application IA | Diagnostic/operator-console centered | REPLACE | Move to Command Center / My Work / AI Workforce / Organization / Customers & Growth / Knowledge / Analytics / Administration |
| PostgreSQL authority | Supabase Postgres, relational foundations, migrations | KEEP | Make SQL authoritative for durable business/runtime state |
| Tenant isolation | organization scoping, composite tenancy keys, RLS | KEEP + EXTEND | Apply uniformly to every new domain and derived projection |
| KV runtime stores | agent/workflow/admin runtime KV ports/stores | REFACTOR | Move durable authority to SQL or an explicit transitional hybrid; KV must not become hidden authority |
| Deterministic engines | diagnostic, financial and scoring engines | KEEP | Continue “Math decides; AI narrates”; expose as governed capabilities/tools |
| AI Control Plane | provider-neutral request path, policy, budgets, audit | KEEP + GENERALIZE | Retain as Intelligence Fabric execution boundary |
| Provider system | OpenAI, Anthropic, self-hosted, mock, selection/fallback | KEEP | Expand through provider adapters; agents never bind directly to vendor SDKs |
| Model routing | selection, retries, timeout, circuit breaking | KEEP | Promote to target Intelligence Router |
| Prompt governance | registered prompts/versioning pattern | KEEP | Extend to agent/workflow/domain prompt assets |
| BYOK / credentials | credential resolution, encryption, tenant precedence | KEEP + GENERALIZE | Unify with connector/tool credential vault and secret-reference model |
| AI input/output governance | input guard, output guard, redaction, fact locking | KEEP + EXTEND | Apply by action/risk/data classification, not only AI endpoint |
| Agent runtime | contracts, state machine, routing, approvals, cost policy, registry | KEEP + REFACTOR | Convert from static AI subsystem into governed organizational worker runtime |
| Agent registry | primarily static/declared definitions | REFACTOR | Support versioned dynamic agent definitions with lifecycle, ownership, authority and retirement |
| Multi-agent mechanisms | existing agent orchestration foundation | KEEP + EXTEND | Add organizational hierarchy, delegation contracts, capability-based team formation |
| Workflow runtime | orchestrator, state machine, retry, approvals, parallel scheduling | KEEP + REFACTOR | Make it the durable cross-domain execution substrate rather than diagnostic-oriented workflow runtime |
| Long-running jobs | workflow mechanisms exist, but no complete platform scheduler/worker model evidenced | BUILD NEW | Add durable background job/scheduler execution independent of browser/session |
| Enterprise eventing | no complete domain event/outbox architecture evidenced | BUILD NEW | Add governed event contracts, outbox/inbox, idempotency, replay and correlation |
| Organization model | organizational spine + RLS exists | KEEP + EXTEND | Add full business unit/department/team/workspace/human+AI relationships required by ontology |
| Strategy model | goals/decisions/risks exist | KEEP + EXTEND | Add objectives, initiatives, opportunities, dependencies, outcomes and goal execution graph |
| Goal decomposition | not evidenced as a platform service | BUILD NEW | Goal → outcome → capability → workforce → work decomposition with policy gates |
| Self-forming workforce | concepts/runtimes exist separately | BUILD NEW ON EXISTING RUNTIME | Capability-gap analysis, propose/create/modify/retire departments/agents within authority |
| Platform authority model | AI RBAC/policy/approval mechanisms exist | REFACTOR / GENERALIZE | Create one platform-wide actor/policy/authority-envelope contract reused by humans, agents, workflows and tools |
| Human approval | AI/workflow approval machinery exists | KEEP + GENERALIZE | Create universal approval/Attention Required backend and consequence model |
| Tool execution | AI tool registries exist; no complete governed enterprise Tool Gateway evidenced | BUILD NEW ON EXISTING TOOL CONTRACTS | One Tool Gateway for search, email, CRM, calendar, files, social, telephony and future tools |
| Email/nurture | UI/local queue + backend email pieces | REPLACE AUTHORITY / REUSE UI PARTS | Durable communication/outreach domain + provider adapters + delivery/reply events |
| Social outreach | no production connector architecture evidenced | BUILD NEW | Connector adapters through Tool Gateway; consent/policy/audit enforced |
| Telephony/calls | no production connector architecture evidenced | BUILD NEW | Isolated governed connector with recordings/transcripts/consent where lawful |
| CRM integration | existing CRM sync panel/spec pieces | REFACTOR | Convert to connector/domain integration, not isolated panel logic |
| Customer/commercial model | diagnostic submissions, pipeline/proposals/revenue exist | REFACTOR + EXTEND | Canonical Prospect → Lead → Account/Customer → Opportunity → Campaign/Outreach → Contract → Success model |
| Knowledge management | no complete authoritative service evidenced | BUILD NEW | Knowledge assets, provenance, lifecycle, access control and retrieval |
| Knowledge Graph | ontology defines it; production graph service not evidenced | BUILD NEW | Derived semantic projection over authoritative SQL/event data |
| Vector/semantic retrieval | complete production retrieval layer not evidenced | BUILD NEW | Permission-filtered embeddings/indexes as derived retrieval infrastructure |
| Enterprise memory | complete durable memory system not evidenced | BUILD NEW | Working/episodic/semantic/decision/agent memory with provenance and lifecycle |
| Memory consolidation | not evidenced | BUILD NEW | Background governed consolidation/deduplication/correction/aging process |
| Global search | current command palette/local discovery | REFACTOR + BUILD | Unified permission-aware entity/search service and command surface |
| Audit | strong AI/admin audit mechanisms | KEEP + GENERALIZE | One enterprise trace chain across human, AI, workflow, tool and data actions |
| Observability | health/KPI/AI metrics foundations | KEEP + EXTEND | Correlation across requests, jobs, agent runs, workflows, tools and business outcomes |
| Security | guards, validation, tenancy, rate limits, RLS | KEEP + EXTEND | Platform-wide identity/policy/data/action security architecture |
| Data classification/privacy | partial protections; full enterprise model not evidenced | BUILD NEW | Classification, retention, deletion/export, legal hold and sensitive-data handling |
| Secrets | provider secret handling exists | KEEP + GENERALIZE | Central secret-reference service for providers + enterprise connectors |
| Capability controls | capability flags/status patterns exist | REFACTOR | Policy-backed kill switches and staged rollout at platform/tenant/domain/agent/tool levels |
| Billing/entitlements | future capability, not complete target runtime | BUILD WHEN SCHEDULED | Keep outside first foundation packet |
| Capital/investment execution | no target-safe implementation evidenced | DEFER / ISOLATE | Future high-consequence bounded domain; no implementation in initial platform work |
| `ARCHITECT.md` | valuable rules but stale product identity/current map | REFACTOR LATER | Regenerate after architecture migration decisions become implemented truth |
| `architecture/system_map.json` | useful machine-readable current snapshot but stale | REFACTOR LATER | Regenerate from verified current implementation |
| Historical completion/remediation docs | useful only as evidence/history | REMOVE AFTER ABSORPTION | Clean once active references are updated |

---

## 3. What Must Be Preserved

### 3.1 AI Control Plane

The existing AI subsystem already supplies important primitives:

- provider registry and abstraction;
- provider/model selection;
- retry and timeout handling;
- circuit breaking/fallback;
- tenant credential resolution;
- BYOK;
- self-hosted provider support;
- input/output governance;
- redaction/fact controls;
- budget/spend controls;
- usage accounting;
- audit/metrics/health;
- agent runtime integration;
- workflow runtime integration.

**Decision: KEEP and evolve into the Target Architecture Intelligence Fabric.**

Do not introduce a second “new AI layer” beside it.

### 3.2 Agent Runtime

Current code already contains substantial runtime machinery: contracts, state transitions, routing, cost controls, approvals, RBAC, registry, tools, audit and persistence ports.

**Decision: KEEP the runtime semantics; REFACTOR the organizational model and persistence.**

Required evolution:

```text
Existing Agent Runtime
  + platform actor identity
  + organization/department/team membership
  + versioned agent definition
  + authority envelope
  + capability/skill model
  + durable SQL lifecycle
  + goals/work ownership
  + memory/knowledge access
  + tool permissions
  + performance/outcome evidence
  + spawn/change/retire lifecycle
= Cortex AI Workforce Runtime
```

### 3.3 Workflow Runtime

Current workflow orchestration already includes state, retry, planning, approvals, parallel work and other significant mechanics.

**Decision: KEEP the engine; REFACTOR it into a generic durable business workflow substrate.**

It must cease being conceptually tied to diagnostic/readiness work.

### 3.4 Deterministic Engines

Financial and diagnostic calculation engines remain valuable and align with the governing rule:

> **Math decides; AI narrates.**

They should be exposed through governed application/domain services or tools, not rewritten as model prompts.

### 3.5 Tenancy and RLS

Existing relational tenancy, composite keys, membership controls and RLS are strategic assets.

**Decision: KEEP and extend deny-by-default.**

Every new authoritative table must define:

- owning organization/tenant;
- row-level access policy;
- human/AI actor access path;
- immutable/controlled fields where required;
- audit implications;
- cross-tenant negative tests.

---

## 4. Foundational Refactor — One Authority System

The most important architectural change is not a new agent feature. It is the creation of a **platform-wide action authority contract**.

Today, strong governance exists predominantly inside AI/admin/workflow subsystems. Target Cortex needs the same control model for every consequential action.

Canonical execution chain:

```text
Actor
  ↓
Tenant / organization context
  ↓
Permission
  ↓
Policy
  ↓
Authority envelope
  ↓
Consequence / risk classification
  ↓
Allow | Deny | Require Approval
  ↓
Execution
  ↓
Evidence + Audit + Outcome
```

Actors include:

- human user;
- service identity;
- AI executive;
- AI manager;
- AI worker/agent;
- workflow;
- scheduled job;
- integration/webhook.

This must **generalize existing AI governance**, not compete with it.

---

## 5. Security and Governance Reconciliation

### Existing foundation to KEEP

- tenant-aware RLS;
- composite tenancy relationships;
- server-side actor/role validation;
- AI RBAC;
- workflow/agent approval machinery;
- provider secret encryption/resolution;
- input/output guards;
- redaction;
- rate limiting;
- spend limits;
- audit/events/metrics;
- provider confinement;
- migration discipline.

### Required platform expansion

| Security capability | Current state | Decision |
|---|---|---|
| Human identity/authentication | present | KEEP / harden as needed |
| Tenant boundary | strong foundation | KEEP + extend |
| RBAC | multiple subsystem implementations | REFACTOR into shared policy inputs |
| Fine-grained attributes/context | incomplete as common platform primitive | BUILD/EXTEND |
| Authority envelopes | AI/workflow concepts exist, not universal | BUILD shared primitive |
| Consequence classification | not common platform primitive | BUILD NEW |
| Universal approvals | subsystem-specific | GENERALIZE |
| Tool authorization | partial via agent tools | BUILD Tool Gateway enforcement |
| Secrets | AI provider-focused | GENERALIZE to all connectors |
| Data classification | incomplete | BUILD NEW |
| Retention/deletion/export | incomplete | BUILD NEW |
| Immutable high-value audit | partial/AI-centric | GENERALIZE |
| Capability kill switches | partial | GENERALIZE |
| Security posture/read model | incomplete | BUILD NEW |
| Incident/containment controls | incomplete product/runtime surface | BUILD/EXTEND |

### Security rule

No autonomous feature is considered complete unless the following are explicit:

`actor + tenant + permission + policy + authority + data scope + tool scope + audit + rollback/containment path`.

---

## 6. Data and Persistence Reconciliation

### 6.1 SQL remains authority

Target state:

```text
PostgreSQL = durable business and governance truth
Event log/outbox = durable change propagation truth
Knowledge Graph = derived relationship projection
Vector/search index = derived retrieval projection
Memory stores = governed derived/experiential state with provenance
Caches = disposable acceleration
```

The graph, vector store, cache or model context must never silently become the authoritative record for a business entity.

### 6.2 KV migration

KV-backed runtime stores were useful infrastructure during earlier phases. For autonomous long-running work, hidden ephemeral authority is unacceptable.

Required transition:

1. inventory each KV-backed object;
2. classify authoritative vs cache/transient;
3. create relational schemas for authoritative agent/workflow/job state;
4. dual-write/shadow-read only when migration safety requires it;
5. reconcile;
6. cut over reads;
7. retire obsolete KV authority paths.

Do not mass-rewrite runtime persistence in one change.

### 6.3 Canonical identifiers

Target domains require globally traceable IDs and correlation:

```text
organization_id
actor_id
entity_id
objective_id
decision_id
workflow_run_id
agent_run_id
job_id
tool_invocation_id
event_id
trace_id
```

These IDs should allow reconstruction of:

`Goal → decision → delegated work → agent/workflow → tool action → data change → outcome → learning`.

---

## 7. Runtime, Jobs, Workflows and Events

The existing workflow runtime is necessary but not sufficient for the autonomous-company target.

### BUILD NEW — Durable Job/Scheduler Layer

Required capabilities:

- run without a browser/session;
- scheduled and recurring jobs;
- delayed work;
- retries/backoff;
- leases/heartbeats;
- idempotency;
- concurrency control;
- cancellation/pause/resume;
- dependency waiting;
- human-wait states;
- tenant quotas;
- cost/risk enforcement;
- dead-letter/recovery handling;
- observability.

### BUILD NEW — Domain Event Architecture

Use an outbox/inbox pattern or equivalent durable mechanism.

Required event envelope:

```text
event_id
organization_id
actor_id
entity_type
entity_id
event_type
occurred_at
correlation_id
causation_id
policy_context
payload_reference / governed payload
schema_version
```

Events support:

- workflow triggers;
- graph projection;
- search indexing;
- memory capture;
- notifications;
- analytics;
- integration/webhook delivery;
- self-improvement evidence.

---

## 8. AI Workforce Gap

### Current strengths

- runtime;
- registry;
- approvals;
- routing;
- tools;
- costs;
- audit;
- multi-agent/orchestration mechanics.

### Missing organizational layer

Build on top of the current runtime:

```text
Organization
  └─ AI Executive
      └─ AI Department
          └─ AI Manager
              ├─ AI Worker
              ├─ AI Worker
              └─ Temporary Agent Team
```

Required new domain concepts:

- AI organizational position;
- department/team membership;
- reporting relationship;
- mission;
- goals/outcomes;
- capability/skill set;
- tool permissions;
- knowledge scope;
- memory scope;
- authority envelope;
- budget;
- lifecycle/version;
- performance/outcomes;
- creation rationale;
- retirement/change history.

### Self-forming workforce

Required lifecycle:

```text
Observe goal/workload/outcome
→ detect capability gap
→ determine whether existing workforce can solve it
→ propose team/department/agent change
→ policy/authority evaluation
→ approve automatically or escalate
→ instantiate governed definition
→ assign tools/knowledge/budget
→ execute
→ measure
→ retain/change/retire
```

This lifecycle must reuse the existing agent runtime. It must not create a second autonomous-agent engine.

---

## 9. Tool and Integration Gateway Gap

Current agent tools and provider integrations are a foundation, but Cortex needs a formal platform Tool Gateway.

### Tool Gateway responsibilities

Every external action passes through:

```text
Agent/Human/Workflow
→ Action request
→ Tool registry
→ tenant permission
→ authority/policy
→ data/consent rules
→ credential reference resolution
→ connector adapter
→ external system
→ normalized result/event
→ audit/outcome
```

### Initial connector classes

- search/research;
- email;
- CRM;
- calendar;
- files/documents;
- analytics;
- social platforms where approved;
- telephony where approved and lawful;
- future finance/payment/business tools.

Agents must never receive reusable provider secrets directly.

Connector credentials remain referenced and resolved only inside the governed gateway/runtime.

---

## 10. Commercial / Autonomous Growth Gap

Existing commercial UI/engines are useful but the target needs an authoritative cross-channel commercial domain.

Required durable entities include, as canonical documents/ratified target scope support them:

```text
Prospect
Lead
Account / Customer
Contact / Stakeholder
Opportunity
Campaign
Audience / Segment
Nurture Sequence
Outreach / Touchpoint
Conversation
Meeting
Proposal
Contract
Customer Success state
Renewal / Expansion opportunity
```

The autonomous sales loop should execute through the same generic goal/workflow/agent/tool architecture—not through a separate “sales automation engine”.

Example:

```text
Revenue Goal
→ prospect discovery workflow
→ Research/Sales agents
→ approved search/data tools
→ prospect qualification
→ governed outreach sequence
→ responses/events
→ nurture/qualification
→ opportunity
→ proposal/contract
→ delivery/customer success
→ outcome data
→ learning
```

Email, social and calling are tool channels under policy. They are not independent sources of authority.

---

## 11. Knowledge, Graph and Memory Gap

This is one of the largest genuine architecture gaps.

### 11.1 Knowledge Service — BUILD NEW

Owns:

- knowledge asset metadata;
- provenance;
- source ownership;
- lifecycle/version;
- access scope;
- validation status;
- links to canonical entities;
- retention/governance.

### 11.2 Knowledge Graph — BUILD NEW AS DERIVED PROJECTION

The graph connects canonical entities and relationships for:

- contextual navigation;
- reasoning support;
- impact analysis;
- discovery;
- explainability;
- organizational intelligence.

Rules:

- graph nodes reference authoritative entity IDs;
- graph relationships carry source/provenance;
- graph updates are driven by authoritative events/data;
- deletion/access changes propagate;
- the graph cannot bypass tenant/security rules.

### 11.3 Search / Vector Retrieval — BUILD NEW

Derived indexes must be:

- tenant scoped;
- permission filtered;
- source traceable;
- lifecycle aware;
- invalidatable when authoritative data changes.

### 11.4 Enterprise Memory — BUILD NEW

Target memory layers:

- working/context memory;
- episodic memory;
- semantic/organizational memory;
- decision memory;
- agent memory;
- project/workflow memory;
- conversation memory;
- historical memory.

Each durable memory item needs:

- organization;
- subject/entity;
- type;
- source/provenance;
- confidence/validation state where relevant;
- created/updated/validated timestamps;
- access scope;
- retention policy;
- links to evidence;
- correction/deletion/retirement lifecycle;
- usage trace where consequential.

### 11.5 Memory Consolidation — BUILD NEW

A background consolidation process may:

- summarize episodes;
- merge duplicates;
- identify contradictions;
- age low-value memories;
- promote validated knowledge;
- propose corrections;
- preserve provenance;
- invalidate stale retrieval entries.

It may **not** silently turn unverified inference into canonical business truth.

---

## 12. Self-Improvement Architecture Gap

Cortex may improve agents, workflows, prompts, routing and organizational structures, but improvement itself is governed work.

Target lifecycle:

```text
Observe
→ identify problem/opportunity
→ collect evidence
→ propose change
→ risk/consequence classification
→ sandbox/test/simulate
→ compare to baseline
→ policy/approval
→ promote
→ monitor
→ rollback if necessary
→ record outcome/learning
```

Initial autonomous promotion should be limited to explicitly low-risk classes.

Arbitrary silent production code rewriting/deployment is **not** part of the initial autonomous loop.

---

## 13. Frontend / Application Boundary Gap

### KEEP

The rule that UI components do not talk directly to databases, model vendors or external connectors.

### REFACTOR

As Cortex expands, one large `dataService.ts` becomes difficult to understand. Preserve the gateway principle while organizing by bounded domain, for example:

```text
src/app/services/
  gateway/
    organization.ts
    goals.ts
    work.ts
    aiWorkforce.ts
    customers.ts
    growth.ts
    knowledge.ts
    analytics.ts
    governance.ts
    integrations.ts
```

A shared authenticated transport/client may sit underneath.

Do not move authorization authority into the frontend. UI permission state is presentation; server policy remains authoritative.

---

## 14. Backend Composition Gap

`supabase/functions/server/index.tsx` is now too large for the target platform.

**Decision: REFACTOR incrementally, not rewrite.**

Target composition pattern:

```text
server/
  bootstrap/
  middleware/
  domains/
    organization/
    strategy/
    work/
    customers/
    growth/
    knowledge/
    governance/
  ai/
  workflows/
  tools/
  events/
  jobs/
  integrations/
  security/
  observability/
```

`index.tsx` should become composition/bootstrap rather than the location of business behavior.

Large orchestrators should be decomposed only along proven responsibility boundaries, with existing contract/security tests preserved before structural refactoring.

---

## 15. Current Artifacts That Must Eventually Disappear

The repository-cleanliness rule applies during implementation.

### Do not delete yet

- `MARQ_CORTEX_REFERENCE_ARCHITECTURE_v1.0.md` — still canonical baseline;
- `ARCHITECT.md` — still active current-state/golden-rule map;
- `architecture/system_map.json` — still current machine-readable map;
- this reconciliation document — needed until implementation plan/build packets absorb it.

### Delete/replace after absorption and reference repair

- historical AI completion/remediation/gate reports;
- historical DB sprint completion reports;
- obsolete current-state snapshots;
- stale implementation plans/checklists after replacement;
- this gap map once the active implementation roadmap and regenerated architecture maps contain its still-relevant decisions.

No deletion should leave broken references.

---

## 16. Migration Sequence

The migration order is intentionally foundation-first while preserving current working product capability.

### A0 — Platform Authority Foundation — COMPLETE (BP-001)

Implemented and security-reviewed on `claude/affectionate-dirac-u3jdp0` through commit `d722d60f58eb649df94af59b85315f0117a0c314`. The shared deterministic authority path is live for the single agent `tool_call` pilot and reuses existing approval/audit/tenancy/runtime systems. No deployment or database migration was performed.

### A1 — Durable Runtime Foundation — COMPLETE (BP-002)

Introduce shared trace IDs, durable jobs/scheduler, domain-event envelope and outbox/inbox foundation inside the existing Supabase/Postgres architecture.

Implemented, corrected, live-PostgreSQL verified and accepted on the current build branch through `de62e09bfc09e0d2387e1834febc2a3b330e133d`. `supabase/functions/server/platform/durable/**` holds the runtime; migrations `20260919120000`–`20260919120002` hold the durable state and atomic job/schedule/outbox/inbox operations, with rollback. Correlation and causation travel schedule → job → event → consumer. The pilot is the workflow approval-expiry sweep against the existing approval gate. Nothing was deployed, no hosted migration was applied, and no production schedule/route was configured.

The row in §2 that reads "Long-running jobs … BUILD NEW" is the gap this closed. The row that reads "KV runtime stores … REFACTOR" is **not** closed and is A2's: no existing agent, workflow, checkpoint or approval record was moved.

### A2 — Runtime Persistence — IN PROGRESS

A2 remains deliberately split into bounded migration slices.

**BP-003 — Workflow Runtime SQL Persistence Foundation & Parity Gate — COMPLETE.** Accepted through `42a1b73bea4d12e9156333bb07a9635ecb144bed`.

The first A2 slice now provides a proven SQL implementation underneath the existing workflow run/checkpoint/approval persistence contracts, with live-local PostgreSQL concurrency, tenant/RLS, rollback and parity verification. Production bootstrap remains on KV and cannot import the SQL stores.

The accepted SQL candidate is intentionally stricter at the relational boundary: workflow organizations must be UUIDs backed by `public.organizations`. Current tenancy still admits slug-like identifiers, including the default `marq-cortex`. That is a **hard workflow-cutover prerequisite**, not something BP-003 silently translated.

The next A2 slice must therefore establish cutover readiness and organization-identity compatibility before shadow/backfill/cutover is considered. Agent runtime persistence remains a later, separate A2 slice.

### A3 — Organizational AI Workforce

Add AI organizational positions, hierarchy, versioned definitions, authority, budgets and lifecycle on top of the existing agent runtime.

### A4 — Universal Attention / Approval

Create the cross-domain approval/escalation service powering `Attention Required`.

### A5 — Tool Gateway

Generalize existing tool/provider credential patterns into governed enterprise tools/connectors.

### A6 — Goal-to-Execution Graph

Extend strategy with objective/initiative/outcome/dependency models and connect goals to workforce/workflows.

### A7 — Knowledge / Graph / Search / Memory

Build knowledge authority metadata, event-fed graph projection, permission-aware search/vector indexes, memory and consolidation.

### A8 — Autonomous Growth Domain

Build the authoritative prospect/lead/account/opportunity/campaign/outreach model and connect channels through Tool Gateway.

### A9 — Self-Improvement Loop

Add governed observation → proposal → sandbox/evaluation → promotion/rollback lifecycle.

### A10 — Architecture Map Regeneration / Cleanup

Regenerate `ARCHITECT.md` and `architecture/system_map.json`, repair references, remove superseded historical architecture artifacts.

These stages are dependency order, not a commitment that each equals one sprint.

---

## 17. Build Packet Status

### BP-001 — Platform Authority & Action Envelope Foundation — COMPLETE

A0 is implemented and accepted. The temporary BP-001 instruction packet is removed after this status is recorded; implementation truth now lives in code, tests, Git history and the active progress authority.

### BP-002 — Durable Runtime Foundation — COMPLETE

A1 is implemented and accepted through `de62e09bfc09e0d2387e1834febc2a3b330e133d`. The temporary BP-002 packet is removed after acceptance. Implementation truth now lives in code, migrations, live PostgreSQL tests, Git history and the active progress authority.

### BP-003 — Workflow Runtime SQL Persistence Foundation & Parity Gate — COMPLETE

Implemented, corrected and accepted through `42a1b73bea4d12e9156333bb07a9635ecb144bed`. The temporary BP-003 packet is removed after this acceptance record. Implementation truth now lives in code, migrations, live PostgreSQL tests, Git history and the active progress authority.

### BP-004 — Workflow Cutover Readiness & Migration Preflight — COMPLETE

Implemented, hardened and accepted through `aac5a3fa03646c2efde05ca73437a9c553eb27f8`.

The accepted readiness layer now:
- inventories workflow KV data without mutation;
- requires explicit mapping for any noncanonical tenant identifier;
- proves deterministic checkpoint re-chaining when organization identity changes;
- compares source/target domain facts with exact or migration-semantic fingerprints;
- rehearses the backfill only against local PostgreSQL;
- fails closed on corrupt chains, unresolved mappings, tenant collisions, or semantic drift;
- keeps production bootstrap on KV and structurally isolates migration/preflight code from runtime assembly;
- hardens local-only database execution against libpq redirectors, service configuration and multi-host targets.

Two findings constrain every later workflow cutover:
1. `organizationId` is available to workflow condition expressions, so registered definitions must be scanned for organization-sensitive branching before a remapped tenant moves.
2. Checkpoint append precedes run-pointer save. A tip exactly one version ahead of the run pointer may represent the engine's legitimate crash window; hosted preflight must distinguish a correctly chained recoverable one-ahead state from actual pointer corruption.

BP-004 performed no hosted inventory, no hosted backfill, no shadow/dual write, no deployment and no authority cutover.

The temporary BP-004 packet is removed after this acceptance record.

### A2 Master Runtime Persistence Execution — IN PROGRESS

The remainder of A2 is now governed by one resumable temporary packet:
`docs/generated/build-packets/A2_MASTER_RUNTIME_PERSISTENCE_EXECUTION.md`.

It replaces separate BP-005/BP-006/BP-007 instruction documents and uses a repository execution cursor so session limits do not restart work.

Sequence:
1. hosted **read-only** workflow estate inventory and strategy selection;
2. local workflow transition/backfill/catch-up implementation and adversarial cutover/rollback rehearsal;
3. agent SQL persistence foundation and live-local parity/concurrency/RLS proof;
4. agent migration readiness and combined local workflow+agent authority rehearsal;
5. mandatory hosted-write/deployment/cutover stop;
6. only after explicit later approval: controlled hosted workflow SQL cutover, controlled hosted agent SQL cutover, legacy-authority retirement, full verification and A2 cleanup.

The master packet may inspect the existing hosted Cortex estate read-only for A2 evidence. It may not mutate hosted state, apply migrations, deploy or move authority before its hard write gate is explicitly approved.

P05 hosted read-only preflight is complete against the restored existing Cortex Supabase. The real estate currently contains zero workflow runtime KV rows and zero agent runtime KV rows. One active canonical organization exists (`marq`, UUID `9c96dbbd-b389-4f8b-811f-1815c4f8a9e0`). The deployed production workflow-definition scan found no `organizationId` metadata-condition dependency.

This evidence selects the minimum-risk workflow transition: **short mutation freeze → immediate zero-estate recheck → approved schema/deployment changes → SQL authority**. Historical backfill, catch-up and shadow/dual write are not justified while the real runtime estate is empty. If the final pre-cutover read-only recheck finds any new workflow rows, this strategy must abort and be re-evaluated rather than dropping those rows.

Local transition architecture now exists (A2-P06/P08, not deployed): the production bootstrap builds workflow and agent stores only through `ai/persistence/runtimePersistenceComposition.ts`, selected by `AI_WORKFLOW_PERSISTENCE` / `AI_AGENT_PERSISTENCE` (default `kv`, so current behaviour is unchanged). SQL stores are reachable only through that composition and only for an explicit mode; the workflow/agent mode pair must lie on one enforced seven-state corridor (workflow freezes first, agent authority moves and unfreezes first), otherwise mutation is refused in both domains. The earlier statement that bootstrap "cannot import the SQL stores" is superseded by this. Hosted authority is still KV in both domains; A2 is stopped at its hosted-write gate.

A2 remains incomplete until both workflow and agent runtime persistence are SQL-authoritative and verified, KV is no longer authoritative for those domains, and temporary transition architecture is cleaned.

## 18. Build-Packet Rule Going Forward

Every implementation packet after BP-001 must identify:

1. target architecture layer(s);
2. existing code to KEEP;
3. existing code to REFACTOR;
4. code/docs to REMOVE after replacement;
5. new contracts/entities;
6. security/authority implications;
7. migration implications;
8. tests;
9. observability/audit;
10. cleanup work in the same change set.

Claude/Codex must not invent parallel architecture while implementing a feature.

---

## 19. Final Reconciliation Verdict

The current Cortex codebase should be treated as a **strong foundation requiring architectural expansion**, not as a prototype to discard.

The highest-value existing foundations are:

- tenancy/RLS;
- AI Control Plane;
- provider abstraction/routing;
- BYOK/secret handling;
- agent runtime;
- workflow runtime;
- deterministic engines;
- AI policy/budget/approval controls;
- audit/observability;
- migration discipline;
- frontend gateway discipline.

The largest missing target systems are:

- universal authority envelopes;
- durable jobs/events;
- organizational AI workforce hierarchy;
- Tool Gateway;
- goal-to-execution orchestration;
- enterprise knowledge/graph/search/memory;
- canonical autonomous commercial domain;
- universal Attention Required/approval layer;
- self-improvement lifecycle.

The implementation strategy is therefore:

> **Generalize the proven foundation → add the missing platform primitives → connect product domains → regenerate active architecture maps → delete superseded artifacts.**
