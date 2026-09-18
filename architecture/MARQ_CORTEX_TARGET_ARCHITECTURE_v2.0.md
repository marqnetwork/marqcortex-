# MARQ Cortex — Target Architecture v2.0

**Status:** DRAFT TARGET ARCHITECTURE — derived from the canonical Cortex product documents and the approved Complete Product Map.  
**Purpose:** Define the target structural architecture required to realize MARQ Cortex as a governed autonomous AI company while preserving security, explainability, tenant isolation, human accountability, and long-term maintainability.  
**Authority:** This document does not replace the canonical Product Experience, Ontology, Master Blueprint, Reference Architecture, or Implementation Guide. Where conflict exists, the higher-authority canonical document wins. After validation, approved content should be folded into the canonical Reference Architecture and this draft retired.

**Additional ratified product clarifications incorporated in this target:** the current architecture design session explicitly confirmed the intended end-state as a governed autonomous company, including self-forming AI teams/departments, dynamic agent creation/retirement, outcome-driven multi-model intelligence, governed prospect discovery and multi-channel outreach (email/social/telephony), graph-grounded memory, background memory consolidation, continuous self-improvement, and a future tightly-governed capital/investment action boundary. These clarifications extend the implementation target where the existing canon stated the direction more generally; they do not override constitutional authority, human high-consequence control, or existing security/data-stewardship rules.

---

## 1. Architectural North Star

MARQ Cortex is a governed autonomous AI company operating as an AI Workforce Platform.

The architecture must allow a customer to state an objective and provide budget, policies, constraints, and authority boundaries. Cortex then:

1. understands the objective;
2. decomposes it into measurable outcomes;
3. determines required organizational capability;
4. assembles or creates the required AI workforce within policy;
5. selects the right intelligence for each task;
6. plans and executes work;
7. uses approved tools and integrations;
8. records evidence, decisions, actions, and outcomes;
9. learns through governed memory and reflection;
10. improves workflows, agent structures, and operating strategy;
11. escalates only when authority, risk, policy, or uncertainty requires a human decision.

The architecture is designed around one permanent principle:

> **Maximum intelligence, minimum user complexity, bounded by explicit authority and verifiable governance.**

---

## 2. Non-Negotiable Architectural Invariants

These rules apply to every domain and implementation.

### 2.1 Identity before authority

Every human, AI worker, service, integration, and machine actor must have an attributable identity before it can act.

No anonymous privileged action is allowed.

### 2.2 Deny by default

Permissions are explicit, scoped, revocable, auditable, and least-privilege.

No agent, user, service, or connector receives authority merely because it can technically perform an action.

### 2.3 Organization is the tenant boundary

All customer-owned business data, memory, events, files, graph relationships, AI context, budgets, workflows, and analytics are organization-scoped.

Cross-tenant leakage is a severity-one architectural defect.

### 2.4 High-consequence decisions require governed human authority

AI may operate autonomously only inside explicit authority envelopes.

Actions involving irreversible external commitments, material financial exposure, security posture, authority changes, regulated decisions, sensitive legal commitments, or other high-consequence outcomes require the configured human authority before effect.

### 2.5 Deterministic authority remains deterministic

Scoring, financial calculations, contractual gates, policy checks, permission checks, limits, and other authoritative deterministic decisions are not replaced by probabilistic model output.

AI may interpret and explain deterministic results; it does not silently override them.

### 2.6 Every significant action is attributable and reconstructable

Cortex must be able to answer:

- who or what acted;
- under which identity;
- on whose authority;
- using what context;
- using which tool/model/service;
- what evidence was considered;
- what policy allowed the action;
- what changed;
- what outcome resulted;
- what later action or decision depended on it.

### 2.7 Provider independence

Business capability depends on Cortex contracts, not vendor SDKs.

AI providers, communication providers, search providers, telephony providers, CRM systems, payment providers, storage systems, and other external services remain replaceable behind governed adapters.

### 2.8 Canonical data is separate from derived intelligence

Authoritative business state lives in authoritative transactional stores.

Search indexes, embeddings, vector stores, knowledge graphs, caches, analytics projections, and model memory are derived views and must be rebuildable from authoritative records and governed event/history sources.

### 2.9 No secrets in AI context

Credentials, signing keys, raw private keys, database service-role secrets, and similar privileged material are never inserted into prompts, agent memory, conversation state, or model-visible context.

Agents invoke governed tools whose execution layer holds the credentials.

### 2.10 Security and governance are cross-cutting architecture

Security, governance, privacy, observability, and audit are not optional supporting modules.

Every request, event, workflow, agent action, memory operation, integration, and data access passes through them.

---

## 3. Target Architecture at a Glance

```text
┌────────────────────────────────────────────────────────────────────┐
│ EXPERIENCE PLANE                                                   │
│ Web · Mobile · Command Center · Natural Language · Voice · APIs    │
└───────────────────────────────┬────────────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────────┐
│ IDENTITY · POLICY · AUTHORITY PLANE                               │
│ Identity · Session · RBAC/ABAC · Tenant Scope · Authority Envelope│
│ Approval · Policy Decision · Consent · Risk Classification        │
└───────────────────────────────┬────────────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────────┐
│ GOAL & ORGANIZATION PLANE                                         │
│ Objectives · Goals · Org Graph · Departments · Teams · Roles      │
│ Capability Gaps · Budgets · Resource Allocation                   │
└───────────────────────────────┬────────────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────────┐
│ AI WORKFORCE CONTROL PLANE                                        │
│ Executives · Managers · Workers · Agents · Teams · Delegation     │
│ Lifecycle · Supervision · Performance · Spawn/Retire Policies     │
└───────────────────────────────┬────────────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────────┐
│ INTELLIGENCE FABRIC                                               │
│ Model Router · Provider Adapters · Reasoning · Research · Vision  │
│ Speech · Coding · Forecasting · Deterministic Engines             │
└───────────────────────────────┬────────────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────────┐
│ EXECUTION PLANE                                                   │
│ Workflow Orchestrator · Durable Jobs · Scheduler · Event Bus      │
│ Tool Gateway · Human Tasks · Approvals · Compensation/Rollback    │
└───────────────────────────────┬────────────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────────┐
│ BUSINESS DOMAIN PLANE                                             │
│ Work · Sales · Marketing · Customer · Finance · Product · Ops     │
│ Diagnostic · ROI · Proposal · Contract · Delivery · Knowledge     │
└───────────────────────────────┬────────────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────────┐
│ KNOWLEDGE · GRAPH · MEMORY PLANE                                  │
│ Knowledge · Evidence · Graph · Retrieval · Memory · Consolidation │
│ Decision Memory · Agent Memory · Provenance · Traceability        │
└───────────────────────────────┬────────────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────────┐
│ DATA PLANE                                                        │
│ Authoritative SQL · Object/File Store · Event Store/Outbox        │
│ Analytics Store · Search/Vector Index · Graph Projection · Cache  │
└───────────────────────────────┬────────────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────────┐
│ INTEGRATION PLANE                                                 │
│ CRM · Email · Social · Telephony · Calendar · Payments · eSign    │
│ Search · Storage · Code · ERP · Webhooks · Partner APIs           │
└────────────────────────────────────────────────────────────────────┘

Cross-cutting through every plane:
SECURITY · PRIVACY · GOVERNANCE · AUDIT · OBSERVABILITY · RESILIENCE
```

---

## 4. Experience Plane

The Experience Plane exposes Cortex without duplicating business truth.

### 4.1 Supported interaction surfaces

- web application;
- mobile application / responsive operational surface;
- Command Center;
- natural-language interaction;
- voice when maturity permits;
- external client/partner portals;
- approved APIs and developer interfaces;
- notifications and action surfaces.

### 4.2 Experience rule

All interfaces resolve to the same canonical entities, permissions, workflows, and organizational graph.

No interface owns independent business state.

### 4.3 Command architecture

Natural language and voice are commands into the same application services used by the GUI.

Example:

```text
User: "Find the strongest prospects in the UAE and start a governed outreach campaign."

Intent
  → identity + tenant context
  → policy/authority check
  → goal/workflow creation
  → research agents
  → approved prospect sources
  → scoring
  → campaign plan
  → budget/communication policy
  → execution
  → monitoring
  → escalation only where required
```

Natural language does not bypass permissions, approval rules, risk classification, or audit.

---

## 5. Identity, Policy, and Authority Plane

This is the foundational control plane of Cortex.

### 5.1 Identity classes

Cortex must distinguish:

- human identity;
- organization membership;
- external/client identity;
- AI executive identity;
- AI manager identity;
- AI worker/agent identity;
- service identity;
- integration identity;
- scheduled-job identity;
- platform operator identity.

### 5.2 Authentication

Target architecture supports provider-independent authentication contracts with implementations such as:

- password/passkey;
- MFA;
- enterprise SSO;
- OIDC/SAML;
- service credentials;
- short-lived workload identity.

Long-lived shared credentials are prohibited for privileged machine actors.

### 5.3 Authorization

Use layered authorization:

1. tenant boundary;
2. identity validity;
3. role;
4. granular permission;
5. resource ownership/scope;
6. policy conditions;
7. authority envelope;
8. risk/high-consequence classification.

The API and backend remain authoritative. UI gating is convenience and clarity, not security.

### 5.4 RBAC + ABAC

RBAC defines reusable responsibility bundles.

ABAC/policy conditions refine access using:

- organization;
- department;
- team;
- resource;
- classification;
- action;
- environment;
- data sensitivity;
- budget;
- location/jurisdiction where applicable;
- risk category;
- time window;
- agent role;
- delegated authority.

### 5.5 Authority Envelope

Every autonomous agent or workflow receives an explicit Authority Envelope.

Example fields:

```text
identity
organization_id
role
objective_scope
permitted_capabilities
permitted_tools
permitted_data_classes
permitted_channels
resource_scope
financial_limit
daily_limit
campaign_limit
discount_limit
external_commitment_limit
allowed_hours
jurisdictions
approval_thresholds
prohibited_actions
expiry
delegation_rights
```

Authority is never inferred from model capability.

### 5.6 Policy Decision Point

All consequential actions pass through a central policy decision contract:

```text
authorize(actor, action, resource, context, authority_envelope)
→ ALLOW | DENY | REQUIRE_APPROVAL | REQUIRE_STEP_UP | REQUIRE_REVIEW
```

Policy evaluation is deterministic and auditable.

### 5.7 Human Approval Service

Approvals are first-class entities, not ad hoc modal confirmations.

Each approval records:

- requested action;
- requesting actor/agent;
- affected entity;
- evidence;
- cost/exposure;
- policy trigger;
- approving authority;
- decision;
- timestamp;
- conditions;
- expiry;
- resulting action.

---

## 6. Goal and Organization Plane

This plane turns user intent into company structure and measurable work.

### 6.1 Goal hierarchy

```text
Purpose / Strategic Intent
    ↓
Objective
    ↓
Goal / Target
    ↓
Initiative
    ↓
Plan
    ↓
Projects / Workflows
    ↓
Tasks / Agent Runs
    ↓
Deliverables
    ↓
Outcomes
```

Every work item must trace upward to purpose or an approved operational obligation.

### 6.2 Capability Gap Engine

Cortex may identify that an objective requires capability the current organization lacks.

The engine evaluates:

- required capability;
- available human capability;
- available AI capability;
- tool availability;
- data/knowledge readiness;
- budget;
- permissions;
- risk;
- time;
- expected value.

It may then recommend or, within policy, instantiate an organizational response.

### 6.3 Dynamic Organization

Approved-future Cortex may create:

- temporary agent teams;
- persistent AI teams;
- AI manager roles;
- AI worker roles;
- virtual departments;
- new workflows;
- specialized skills;
- additional tool assignments.

Dynamic creation is governed configuration, not uncontrolled code generation.

### 6.4 Department lifecycle

A dynamically created department or agent team has:

```text
mission
owner
objectives
scope
authority
budget
members
agents
tools
knowledge access
KPIs
risk class
review cadence
lifecycle state
retirement criteria
```

### 6.5 Resource and budget allocation

Budget is represented as governed resources, not free-form prompt context.

Agents receive explicit spend envelopes and cannot exceed them without policy-approved escalation.

---

## 7. AI Workforce Control Plane

The Workforce Control Plane owns the lifecycle of AI organizational participants.

### 7.1 AI workforce hierarchy

```text
Human Governance
      ↓
AI Executive / Executive Advisor
      ↓
AI Department / Department Intelligence
      ↓
AI Manager / Coordinator
      ↓
AI Workers / Specialized Agents
      ↓
Tools / Workflows / Models
```

Hierarchy may be flatter for small organizations but authority relationships remain explicit.

### 7.2 Agent definition

Every agent has:

- unique identity;
- organization;
- role;
- mission;
- capabilities;
- skills;
- tools;
- knowledge scopes;
- memory scopes;
- authority envelope;
- budget;
- model strategy;
- escalation policy;
- success measures;
- lifecycle state.

### 7.3 Agent lifecycle

```text
Proposed
→ Policy/Need Validation
→ Provisioned
→ Configured
→ Validated
→ Active
→ Monitored
→ Adapted
→ Suspended
→ Retired
```

### 7.4 Agent spawning

An agent may request another agent or team only if delegation rights permit it.

Spawn flow:

```text
Need detected
→ capability specification
→ duplicate/capacity check
→ risk classification
→ budget check
→ authority check
→ create from governed template
→ assign tools/knowledge
→ sandbox validation
→ activate
→ monitor
```

High-risk or materially costly spawning requires approval according to policy.

### 7.5 Agent retirement

Cortex should retire agents when:

- purpose is complete;
- capability is duplicated;
- cost is unjustified;
- performance is below threshold after remediation;
- authority is withdrawn;
- security/governance risk exists;
- strategy changes.

History and accountability remain after retirement.

### 7.6 Multi-agent coordination

Agent teams share:

- objective;
- plan;
- task graph;
- organizational context;
- relevant evidence;
- coordination protocol;
- conflict-resolution rules;
- synthesis responsibility;
- accountability chain.

Agents do not exchange unrestricted tenant context merely because they are collaborating.

### 7.7 Agent supervision

Every agent run supports:

- inspect;
- pause;
- resume;
- cancel;
- intervene;
- override;
- reassign;
- request explanation;
- view tool calls;
- view evidence;
- view cost;
- view policy decisions;
- view outcomes.

---

## 8. Intelligence Fabric

The Intelligence Fabric realizes the "multiple brains" architecture.

### 8.1 Principle

Cortex chooses intelligence according to the work required.

Users and business domains should not be coupled to model vendors.

### 8.2 Intelligence Gateway

All model requests pass through one governed Intelligence Gateway.

Responsibilities:

- request normalization;
- tenant and identity context;
- task classification;
- model/provider routing;
- policy checks;
- data minimization;
- context assembly;
- retries/timeouts;
- fallback;
- usage accounting;
- cost accounting;
- telemetry;
- response normalization;
- provenance.

### 8.3 Model Registry

Every model/provider entry records:

- provider;
- model/version;
- supported capabilities;
- allowed data classifications;
- allowed tenants;
- latency profile;
- quality profile;
- cost profile;
- context constraints;
- region/residency;
- tool support;
- multimodal support;
- approval status;
- lifecycle state.

### 8.4 Router

Routing considers:

```text
task type
required capability
quality target
risk
data sensitivity
tenant policy
cost budget
latency target
context size
tool requirements
availability
provider health
residency constraints
historical performance
```

### 8.5 Brain categories

Initial providers may be few, but architecture supports interchangeable specialized intelligence:

- general reasoning;
- deep research;
- coding;
- vision;
- speech;
- translation;
- forecasting;
- extraction/classification;
- domain-specialist models;
- deterministic engines.

### 8.6 Ensemble / multi-model reasoning

For high-value work Cortex may route subproblems to different intelligences and synthesize results.

Synthesis never removes provenance.

### 8.7 Deterministic Engines

Deterministic engines remain separate architectural participants for:

- scoring;
- ROI/financial calculations;
- rule evaluation;
- authorization;
- thresholds;
- proposal gates;
- scope/change impact;
- budget limits;
- contract validity;
- other authoritative computation.

---

## 9. Execution Plane

Cortex requires durable execution because agent/company work may run for minutes, days, months, or years.

### 9.1 Workflow Orchestrator

The Workflow Orchestrator coordinates:

- human tasks;
- AI tasks;
- deterministic engines;
- integrations;
- approvals;
- timers;
- events;
- retries;
- compensation;
- long-running state.

### 9.2 Durable Job Runtime

A durable job has:

```text
job_id
organization_id
objective/workflow
actor
state
priority
schedule
lease
attempt
idempotency_key
correlation_id
causation_id
timeout
retry_policy
budget
authority
result
failure
```

### 9.3 Scheduler

Scheduler supports:

- one-time jobs;
- recurring jobs;
- delayed work;
- follow-ups;
- campaign steps;
- monitoring jobs;
- memory consolidation;
- analytics;
- maintenance;
- agent review cycles.

### 9.4 Event architecture

Events are immutable facts describing meaningful state changes.

Required event metadata:

```text
event_id
event_type
version
organization_id
actor_id
occurred_at
correlation_id
causation_id
source
entity_refs
classification
payload
```

### 9.5 Reliable delivery

Use transactional outbox where business-state change and event publication must remain consistent.

Consumers are idempotent and may use inbox/processed-event records.

Retries use bounded exponential backoff.

Repeated failures move to a monitored dead-letter path.

### 9.6 Event sourcing

Selective only.

Use event sourcing where reconstruction/audit benefit exceeds complexity. Do not impose it on every domain.

### 9.7 Compensation

Long-running workflows must define reversal/compensation where technically and legally possible.

Irreversible effects must be explicitly identified before execution.

---

## 10. Business Domain Plane

Business domains contain domain logic and own their authoritative models.

Initial major bounded contexts include:

- Organization & Identity
- Goals & Strategy
- Work & Execution
- AI Workforce
- Knowledge & Memory
- Customer & CRM
- Sales & Revenue
- Marketing & Acquisition
- Communications
- Scheduling
- Diagnostic & Advisory
- Recommendation & Portfolio
- Financial / ROI Modeling
- Proposal
- Contract
- Delivery / Execution
- Outcomes & QBR
- Billing & Entitlements
- Analytics & Intelligence
- Governance / Risk / Compliance
- Administration

Domains interact through APIs, application services, workflows, and events.

Direct cross-domain database access is prohibited.

### 10.1 Commercial autonomous loop

The target Sales/Growth architecture supports, where lawful and configured:

```text
Market/ICP definition
→ approved prospect discovery
→ prospect research
→ fit/intent scoring
→ prioritization
→ outreach strategy
→ governed multi-channel outreach
→ monitoring/replies
→ nurture
→ qualification
→ opportunity
→ objections
→ meeting / continued agent engagement
→ proposal
→ negotiation within authority
→ approval for exceptions
→ contract
→ close
→ onboarding
→ retention/expansion
→ learning
```

### 10.2 Prospect Discovery

Prospect discovery may use approved:

- search/research providers;
- CRM/customer data;
- licensed datasets;
- public business sources;
- partner sources;
- inbound signals.

Every source is registered with purpose, rights, terms, data classification, retention, and allowed use.

### 10.3 Outreach channels

Channel adapters may include:

- email;
- approved social platform APIs;
- telephony/voice;
- calendar/meeting;
- SMS/messaging where permitted.

Channel activation requires compliance, consent/legitimate-basis policy, rate limits, reputation protections, tenant configuration, and jurisdiction-aware controls.

### 10.4 Telephony

Calls are executed through a governed telephony adapter.

Architecture supports:

- call scheduling;
- agent identity/disclosure policy;
- recording policy;
- transcription;
- call-state events;
- consent rules;
- escalation to human;
- disposition;
- follow-up.

Telephony must remain disabled until jurisdictional and consent rules for the target market are explicitly implemented and validated.

---

## 11. Knowledge, Graph, and Memory Plane

This is the cognitive substrate of Cortex.

### 11.1 Authoritative separation

The graph and memory system do not replace authoritative domain data.

They connect, interpret, retrieve, and learn from it.

### 11.2 Knowledge Graph

The graph models canonical entities and typed relationships such as:

```text
belongs_to
owns
reports_to
assigned_to
depends_on
created_by
approved_by
influences
references
supersedes
uses
produces
consumes
related_to
resulted_in
```

Each relationship includes:

- organization;
- provenance;
- validity/time;
- confidence where derived;
- access classification;
- lifecycle state.

### 11.3 Graph implementation rule

The Knowledge Graph may initially be implemented as relational graph tables/materialized projections over SQL.

A dedicated graph database is introduced only when traversal/performance requirements justify it.

Technology must not redefine ontology semantics.

### 11.4 Memory layers

Cortex memory is separated into:

1. **Working memory** — current interaction/task context.
2. **Episodic memory** — events, actions, conversations, outcomes.
3. **Semantic/organizational memory** — governed knowledge and stable facts.
4. **Decision memory** — decision, evidence, alternatives, authority, outcome.
5. **Agent memory** — scoped operational experience for a worker/role.
6. **Project/customer memory** — continuity around long-lived entities.
7. **Historical memory** — preserved states and organizational evolution.

### 11.5 Memory object

A durable memory record includes:

```text
memory_id
organization_id
scope
subject_refs
source_refs
memory_type
content/structured_fact
created_at
valid_from
valid_to
confidence
sensitivity
owner
retention
supersedes
derived_from
last_validated_at
```

### 11.6 Memory consolidation

Cortex runs a governed background consolidation process analogous to "dreaming" at the system level:

```text
recent events/history
→ cluster related experience
→ detect duplicates/conflicts
→ validate against authority
→ summarize stable learning
→ preserve provenance
→ promote trusted memory
→ age/retire stale memory
→ retain raw history where required
```

The consolidation process may propose memory changes but cannot overwrite authoritative domain facts.

### 11.7 Retrieval

Retrieval combines:

- structured SQL queries;
- graph traversal;
- metadata/filter search;
- full-text search;
- vector/semantic search;
- recency;
- authority ranking;
- provenance;
- permissions.

Retrieval is permission-aware before data is presented to a model.

### 11.8 Forgetting and correction

Memory supports:

- correction;
- supersession;
- deletion where policy allows/requires;
- retention holds;
- export;
- tenant exit/portability.

---

## 12. Self-Improvement Architecture

Self-improvement is a governed engineering and operating capability, not unrestricted self-modification.

### 12.1 Improvement loop

```text
Observe
→ Detect problem/opportunity
→ Form hypothesis
→ Identify affected capability
→ Propose change
→ Simulate / sandbox
→ Test
→ Compare against baseline
→ Risk/policy review
→ Promote if authorized
→ Monitor outcome
→ Roll back if degraded
→ Record learning
```

### 12.2 Change classes

Cortex may improve different things under different authority levels:

**Class A — runtime strategy**
- task prioritization;
- routing;
- scheduling;
- campaign timing;
- model selection;
- agent assignment.

**Class B — governed configuration**
- workflow parameters;
- agent templates;
- tool selection;
- prompts/instructions;
- memory/retrieval policies;
- departmental structure.

**Class C — code/system change**
- generated code;
- schema changes;
- infrastructure;
- security controls;
- core engine logic.

Class C follows full engineering review, testing, security review, CI/CD, and approval. No production self-write/self-deploy by default.

### 12.3 Evaluation

An improvement must define:

- baseline;
- target metric;
- safety constraints;
- evaluation window;
- rollback trigger;
- evidence;
- affected tenants;
- risk.

### 12.4 Organizational self-improvement

Cortex may reorganize agent teams or workflows when evidence shows:

- bottlenecks;
- duplicated work;
- capability gaps;
- excessive cost;
- poor quality;
- missed goals;
- unused capacity.

Material changes in budget, authority, or external commitments require approval.

---

## 13. Data Plane

### 13.1 Authoritative transactional store

Target runtime authority is relational SQL with organization-scoped Row Level Security or equivalent policy enforcement.

The data model uses canonical ontology terms and identifiers.

### 13.2 Data categories

- transactional/domain data;
- identity and policy data;
- workflow/job state;
- event/outbox/inbox data;
- audit records;
- knowledge metadata;
- memory;
- files/artifacts;
- search/vector indexes;
- graph projections;
- analytics;
- configuration;
- secrets references.

### 13.3 Data ownership

Each bounded context owns its data schema and write authority.

Other domains use contracts/events rather than direct database writes.

### 13.4 RLS / tenant enforcement

Tenant isolation is defense-in-depth:

- organization_id on tenant-owned entities;
- RLS/policy enforcement at the database;
- tenant context in application services;
- tenant context in events/jobs;
- tenant context in AI retrieval;
- tenant context in object storage;
- tenant context in indexes;
- tenant context in graph projections;
- tenant context in audit.

### 13.5 Data classification

At minimum:

```text
PUBLIC
INTERNAL
CONFIDENTIAL
RESTRICTED
REGULATED
SECRET_REFERENCE
```

`SECRET_REFERENCE` contains only references/handles to secret stores, never secret values in normal business tables.

### 13.6 Encryption

- TLS for data in transit;
- managed encryption at rest;
- stronger/customer-specific keying where required;
- encrypted backups;
- sensitive field-level encryption where justified;
- centralized key rotation and revocation.

### 13.7 Data lifecycle

Every data class defines:

- owner;
- purpose;
- retention;
- legal/contractual hold behavior;
- archival;
- deletion;
- export;
- backup;
- recovery objective.

---

## 14. Integration and Tool Gateway

### 14.1 Single Tool Gateway

Agents do not directly hold external API credentials.

They invoke a Tool Gateway.

```text
Agent
  ↓
Tool Request
  ↓
Policy / Authority Check
  ↓
Tool Gateway
  ↓
Provider Adapter
  ↓
External System
```

### 14.2 Tool registry

Each tool records:

- owner;
- capability;
- provider;
- auth method;
- tenant availability;
- allowed actions;
- data classification;
- rate limits;
- timeout;
- retry policy;
- budget/cost;
- audit policy;
- environment;
- lifecycle status.

### 14.3 Webhooks

Require:

- signature verification;
- timestamp/replay protection;
- schema validation;
- idempotency;
- tenant resolution;
- rate limiting;
- audit;
- dead-letter/retry path.

### 14.4 Integration isolation

External models and payload shapes are translated at the adapter boundary.

Provider-specific data structures must not leak into domain models.

---

## 15. Security Architecture

Security is a platform invariant.

### 15.1 Security control domains

Target architecture must support control families covering:

- access control;
- identity and authentication;
- audit/accountability;
- configuration management;
- contingency planning;
- incident response;
- maintenance;
- media/data protection;
- personnel/operator security;
- physical/cloud inherited controls;
- risk assessment;
- system/service acquisition;
- communications protection;
- system/information integrity;
- supply-chain risk;
- privacy;
- AI-specific security.

### 15.2 Zero-trust model

Trust is evaluated per request/action based on identity, device/workload, resource, tenant, policy, context, and risk.

Network location alone does not confer trust.

### 15.3 Secure-by-default service design

Every service:

- authenticates callers;
- authorizes actions;
- validates input;
- scopes tenant;
- limits rate;
- logs security-relevant actions;
- uses secure secrets;
- exposes minimal privileges;
- rejects unknown/invalid states;
- emits health/telemetry.

### 15.4 Secrets

Use a managed secrets service.

Requirements:

- no repository secrets;
- no secrets in logs;
- no secrets in AI memory/context;
- rotation;
- access audit;
- least privilege;
- environment separation;
- revocation.

### 15.5 AI security

Protect against:

- prompt injection;
- tool abuse;
- cross-tenant context leakage;
- indirect injection from retrieved content;
- data exfiltration;
- unsafe autonomous action;
- model/provider compromise;
- poisoned knowledge;
- malicious files/URLs;
- privilege escalation through agent delegation.

Controls include:

- trust labeling of retrieved content;
- tool allowlists;
- structured tool schemas;
- data minimization;
- policy checks before and after model use;
- sandboxing for code/file operations;
- output validation;
- network egress restrictions for high-risk tools;
- human approval gates;
- audit.

### 15.6 Supply-chain security

Required:

- dependency inventory/SBOM;
- pinned/verified dependencies;
- vulnerability scanning;
- secret scanning;
- signed build artifacts where feasible;
- protected branches;
- mandatory review for sensitive areas;
- environment separation;
- provenance for releases.

### 15.7 Security posture changes

AI may recommend security changes.

AI may not autonomously grant privileges, weaken controls, rotate trust anchors, change tenant isolation, or alter production security policy outside explicitly approved security workflows.

---

## 16. Governance, Risk, and Compliance Architecture

### 16.1 Governance model

Governance is implemented through machine-enforceable policies plus human authority.

Core entities:

- Policy
- Standard
- Rule
- Control
- Risk
- Decision Authority
- Approval
- Exception
- Evidence
- Audit
- Review

### 16.2 Policy as data

Policies should be versioned and testable.

Policy changes are themselves governed events with owner, reviewer, effective date, history, and impact analysis.

### 16.3 Risk classification

Actions/workflows are classified by risk.

Example categories:

```text
LOW
MODERATE
HIGH
CRITICAL
REGULATED
```

Risk influences:

- approval;
- allowed autonomy;
- logging depth;
- model/provider eligibility;
- retention;
- testing;
- rollback requirements;
- monitoring.

### 16.4 Compliance-ready design targets

The architecture should remain mappable to recognized security/control frameworks without claiming certification, including:

- NIST SP 800-53 Rev. 5 control families;
- NIST SP 800-171 Rev. 3 when CUI becomes relevant;
- NIST SP 800-207 zero-trust principles;
- FedRAMP Rev. 5 control baselines if federal cloud authorization becomes a business target;
- SOC 2 trust-service controls for commercial assurance;
- AI governance frameworks already referenced by the Product Experience.

Compliance is evidence, not branding.

### 16.5 Authorization boundary

Cortex should maintain a machine-readable system boundary inventory:

- services;
- data stores;
- integrations;
- network components;
- environments;
- inherited cloud controls;
- customer-responsibility controls;
- external dependencies.

This reduces future enterprise/GovCon authorization work.

### 16.6 Evidence automation

Security/compliance evidence should be generated from normal operation:

- configuration snapshots;
- access reviews;
- deployment logs;
- change approvals;
- vulnerability results;
- backup/restore tests;
- incident records;
- audit events;
- policy tests;
- infrastructure state.

---

## 17. Audit and Traceability Architecture

### 17.1 Audit record

Security and high-consequence audit records include:

```text
audit_id
organization_id
actor_id
actor_type
action
resource
before/after or change reference
policy_decision
authority_reference
approval_reference
correlation_id
causation_id
source_ip/device/workload where relevant
timestamp
result
evidence_refs
```

### 17.2 Immutability

High-value audit records are append-only and protected against ordinary application mutation.

### 17.3 Trace chain

Cortex should trace:

```text
Goal
→ Decision
→ Plan
→ Workflow
→ Agent/Person
→ Tool/Service
→ Action
→ Data Change
→ Outcome
→ Learning
```

This is a core product capability, not only a security log.

---

## 18. Observability and Operational Resilience

### 18.1 Observability

Use consistent:

- logs;
- metrics;
- traces;
- events;
- correlation IDs;
- causation IDs.

### 18.2 Required operational views

- service health;
- request latency/error;
- event/queue health;
- job health;
- integration health;
- AI provider health;
- AI cost/usage;
- agent execution health;
- workflow bottlenecks;
- tenant-impacting incidents;
- security events.

### 18.3 SLO architecture

Each critical service defines:

- availability objective;
- latency objective;
- error budget;
- recovery target;
- escalation path.

### 18.4 Resilience patterns

Use as appropriate:

- retries with backoff;
- circuit breakers;
- bulkheads;
- queues;
- idempotency;
- graceful degradation;
- cached non-sensitive reads;
- provider fallback;
- dead-letter queues;
- health checks.

### 18.5 Backup and recovery

Target architecture requires:

- automated backups;
- encrypted backup storage;
- restore testing;
- point-in-time recovery where supported;
- tenant-safe recovery;
- documented RPO/RTO by data class;
- disaster recovery exercises.

A backup that has never been restored is not considered proven recovery.

---

## 19. Deployment and Environment Architecture

### 19.1 Environments

At minimum:

```text
local
development
preview/test
staging
production
```

Sensitive production data must not be copied casually into lower environments.

### 19.2 Infrastructure as Code

Production infrastructure should be reproducible through version-controlled infrastructure definitions where practical.

### 19.3 CI/CD gates

Production deployment requires automated checks appropriate to the change:

- build;
- type/lint;
- unit;
- integration;
- security/static analysis;
- dependency/vulnerability;
- migration validation;
- policy checks;
- architecture checks;
- artifact provenance;
- deployment smoke tests.

### 19.4 Release patterns

Support:

- feature flags;
- canary/progressive rollout where justified;
- tenant-scoped rollout;
- rollback;
- kill switches;
- schema backward compatibility.

### 19.5 Change authority

Production deployment is an explicit governed action.

Agent-generated code follows the same or stricter path as human-generated code.

---

## 20. Self-Build / Engineering Agent Architecture

Cortex may eventually contribute to building and improving Cortex itself.

### 20.1 Engineering agents may

- analyze code;
- create branches;
- propose changes;
- generate tests;
- update documentation;
- run static analysis;
- run automated tests;
- produce migration proposals;
- generate pull requests;
- explain architecture impact.

### 20.2 Engineering agents may not by default

- bypass branch protection;
- self-approve privileged changes;
- deploy unreviewed security-sensitive code;
- alter canonical governance;
- change production secrets;
- weaken access controls;
- perform destructive production migrations;
- modify their own authority.

### 20.3 Promotion path

```text
Issue/Improvement
→ Agent Plan
→ Branch
→ Code
→ Tests
→ Security/Architecture Analysis
→ PR
→ Required Review/Approval
→ CI
→ Staging
→ Production
→ Monitor
→ Rollback if required
→ Learn
```

Low-risk classes may receive progressively higher automation only after evidence demonstrates safe operation.

---

## 21. Financial and Capital Action Boundary

Cortex may model and advise on financial allocation as part of organizational intelligence.

Any future capability that executes real financial-market transactions must be isolated as a high-consequence regulated capability zone.

Architecture requires:

- explicitly permitted instruments;
- jurisdiction;
- broker/provider allowlist;
- investment mandate;
- risk limits;
- position limits;
- daily/period exposure limits;
- liquidity constraints;
- drawdown controls;
- complete transaction audit;
- human approval policy;
- kill switch;
- reconciliation.

No architectural component assumes guaranteed returns or infallible prediction.

---

## 22. Client and Data Sovereignty

Customer data and organizational memory are held in stewardship.

Architecture must support:

- tenant export;
- structured data portability;
- document/file export;
- relevant knowledge/memory export;
- deletion/retention policy execution;
- correction;
- ownership attribution;
- provider independence.

Customer exit must not require continued dependence on proprietary Cortex-only memory formats.

---

## 23. Recommended Initial Physical Architecture

The logical architecture is technology-independent, but an implementation can begin simply.

### 23.1 Start as a modular platform, not premature microservices

Use one deployable API/application boundary where operationally efficient, but enforce internal bounded contexts and contracts.

Extract services only when justified by:

- independent scaling;
- security isolation;
- durability;
- operational ownership;
- external exposure;
- fault isolation.

### 23.2 Initial core runtime services

Recommended logical services/modules:

```text
Identity & Tenant
Policy & Authority
Organization & Goals
Work & Workflow
AI Workforce
Intelligence Gateway
Knowledge & Memory
Customer/CRM
Sales/Marketing
Communication
Scheduling
Diagnostic/ROI/Proposal/Contract
Delivery/Outcomes
Billing/Entitlements
Integration/Tool Gateway
Events/Jobs/Scheduler
Audit
Observability/Admin
```

These may initially live in fewer deployables while retaining clear boundaries.

### 23.3 Initial data topology

```text
PostgreSQL
  ├─ authoritative domain data
  ├─ tenancy / permissions / policy
  ├─ workflow/job state
  ├─ event outbox/inbox
  ├─ audit references
  ├─ graph relations/projections
  └─ memory metadata

Object Storage
  └─ documents / artifacts / exports / large files

Search / Vector
  └─ derived retrieval indexes

Analytics
  └─ derived operational/business projections

Secret Manager
  └─ provider credentials / signing material
```

A dedicated graph database, event streaming platform, or data warehouse is introduced only when measured requirements justify it.

---

## 24. Migration from Current Cortex

The architecture must evolve the working product instead of rebuilding blindly.

### 24.1 Preserve

- deterministic engines;
- existing governed proposal/ROI/contract/execution logic;
- provider abstraction direction;
- tenancy/RLS work;
- migration tooling;
- client/operator flows that remain canonical;
- reusable frontend/backend modules that fit the target boundaries.

### 24.2 Replace / strengthen

- KV runtime authority → SQL authoritative data plane;
- route/UI role checks → enforced policy/permission service;
- synchronous side effects → durable events/jobs;
- limited AI gateway → full Intelligence Fabric;
- assistive AI surfaces → governed Workforce Runtime;
- fragmented history → Graph + Memory + Traceability;
- ad hoc integrations → Integration/Tool Gateway;
- implicit approvals → first-class Approval Service;
- manual operating loops → durable Goal/Workflow orchestration.

### 24.3 Build new

- Authority Envelope;
- Policy Decision Point;
- AI worker identity/lifecycle;
- agent/team spawning;
- multi-agent coordination runtime;
- goal decomposition;
- capability-gap detection;
- durable scheduler/job runtime;
- event bus/outbox/inbox;
- Tool Gateway;
- graph projection;
- memory consolidation;
- self-improvement pipeline;
- compliance evidence automation;
- strong audit/trace chain.

---

## 25. Architecture Quality Gates

No Cortex capability is production-ready unless applicable gates pass.

### Gate A — Product alignment
- maps to canonical product requirement;
- uses canonical ontology;
- no unsupported scope invention.

### Gate B — Security
- identity exists;
- tenant scope enforced;
- authorization defined;
- data classification defined;
- secrets handled correctly;
- threat model reviewed.

### Gate C — AI governance
- AI role defined;
- authority explicit;
- deterministic boundaries preserved;
- tool access scoped;
- human escalation defined;
- explainability/audit available.

### Gate D — Data
- source of truth identified;
- ownership defined;
- retention defined;
- migration/rollback understood;
- derived indexes rebuildable.

### Gate E — Reliability
- idempotency;
- retry/timeout;
- failure path;
- monitoring;
- rollback/compensation.

### Gate F — Observability
- logs;
- metrics;
- trace/correlation;
- business outcome visibility.

### Gate G — Compliance readiness
- policy/control mapping where relevant;
- evidence generated;
- data/privacy obligations understood.

### Gate H — UX
- permissions visible;
- uncertainty honest;
- approval state clear;
- recoverable errors;
- user remains oriented.

---

## 26. Architecture Decision Rules

1. Prefer the simplest design that preserves the target architecture.
2. Do not add infrastructure because it is fashionable.
3. Do not create a new service until its boundary is clear.
4. Do not let providers define business models.
5. Do not duplicate canonical entities.
6. Do not put model output directly into authoritative state without validation/policy.
7. Do not let agents bypass application services to reach databases/providers.
8. Do not let graph/vector stores become hidden sources of truth.
9. Do not treat UI permissions as security.
10. Do not accept unverifiable autonomy.
11. Every high-consequence action must have an explicit authority path.
12. Every self-improvement mechanism must have an evaluation and rollback path.
13. Every new technology must have an owner, exit strategy, and reason it is necessary.
14. Architecture documentation must shrink as the architecture becomes clearer, not expand without control.

---

## 27. Documentation Cleanliness Rule

This target architecture is a working bridge.

Once it is validated and incorporated into the canonical Reference Architecture:

1. update the canonical Reference Architecture;
2. regenerate the concise `ARCHITECT.md` repository map from verified implementation;
3. update `architecture/system_map.json`;
4. delete this temporary target document;
5. delete superseded derived architecture documents whose unique content has been absorbed.

The repository should retain:
- canonical truth;
- concise current-state architecture;
- machine-readable system map;
- only actively useful generated implementation specifications.

Historical working notes should not accumulate indefinitely.

---

## 28. External Assurance Alignment — Design Target, Not Certification Claim

The security architecture is intentionally compatible with future control mapping for serious enterprise and U.S. government-contractor opportunities.

Current design targets include:

- NIST SP 800-53 Rev. 5 security/privacy control families;
- NIST SP 800-171 Rev. 3 for environments that may handle Controlled Unclassified Information;
- NIST SP 800-207 zero-trust architecture principles;
- FedRAMP Rev. 5 style authorization-boundary and control-evidence discipline if federal cloud authorization becomes a target;
- SOC 2 style commercial assurance controls;
- AI-governance frameworks already referenced by the Product Experience.

Architecture compatibility does **not** mean Cortex is certified, authorized, CMMC-assessed, FedRAMP-authorized, or SOC 2 attested. Those require separate formal programs and evidence.

---

## 29. Final Target State

Cortex reaches its intended architectural state when a customer can state a governed goal and the platform can:

```text
Understand
→ Plan
→ Organize
→ Select Intelligence
→ Create/Assign Workforce
→ Execute
→ Communicate
→ Spend Within Authority
→ Observe
→ Reason
→ Remember
→ Learn
→ Improve
→ Reorganize
→ Continue
```

while every significant action remains:

```text
Tenant-Isolated
Identity-Bound
Policy-Checked
Authority-Bounded
Explainable
Auditable
Observable
Reversible Where Possible
Human-Governed Where Consequential
```

That is the target architecture of MARQ Cortex v2.0.
