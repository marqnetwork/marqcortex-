# MARQ CORTEX — UI IMPLEMENTATION SPECIFICATION v1.0

> **DERIVED DOCUMENT — NOT A SOURCE OF TRUTH**  
> This document translates the MARQ Cortex canonical Product Experience, Ontology, Master Blueprint, Implementation Guide, Complete Product Map, and Target Architecture v2.0 into an implementation-facing UI specification. Product changes must first be made in the appropriate canonical source and then propagated here.

**Status:** Build-preparation specification  
**Purpose:** Define the user-facing operating system required to make Cortex understandable, governable, and buildable without turning the product into a collection of disconnected modules.  
**Primary UX authority:** `MARQ_CORTEX_PRODUCT_EXPERIENCE`  
**Structural implementation target:** `architecture/MARQ_CORTEX_TARGET_ARCHITECTURE_v2.0.md`  
**Product inventory:** `MARQ_CORTEX_COMPLETE_PRODUCT_MAP_v1.0.md`

---

## 1. Experience North Star

Cortex must feel like **one intelligent operating environment for running an organization**, not a dashboard, chatbot, CRM, project manager, agent marketplace, or collection of tools.

The interface must help a user answer, quickly:

1. What is happening?
2. What requires my attention?
3. What changed?
4. What decision should I make?
5. What are the consequences?
6. What should happen next?

Core UX laws:

- clarity over feature exposure;
- understanding over raw information;
- one dominant purpose per screen;
- progressive disclosure instead of permanent complexity;
- AI is a native participant, not a detached chatbot;
- users navigate by intent, not by software structure;
- context must survive navigation, sessions, devices, and handoffs;
- routine work should happen quietly inside approved authority;
- consequential work must be transparent, reviewable, and attributable;
- one canonical entity may have many views, but never duplicate realities;
- the system should continuously prepare while users are away;
- every important action must make it clear what happened, why, what changed, and what happens next.

Sources: PX Ch3–4, Ch9, Ch13–16, Ch20–22; Target Architecture v2.0 §§1–2.

---

## 2. UX Classification and Scope Rules

Every UI requirement in this document uses one of four classifications:

- **CANONICAL** — directly required by Product Experience / Ontology / Master Blueprint.
- **TARGET** — required by Target Architecture v2.0 or a ratified product clarification.
- **IMPLEMENTATION DETAIL** — necessary to make a canonical/target capability usable without changing product scope.
- **DEFERRED** — approved direction but not required for the first implementation wave.

UI must never silently create a new business capability, authority model, commercial channel, compliance claim, or data source.

---

## 3. Human Mental Model

The user should think in this hierarchy:

```text
Organization
  → Mission / Goals
  → Departments / Teams
  → People + AI Workforce
  → Work / Customers / Knowledge / Decisions
  → Outcomes / Learning
```

The user should **not** need to understand service names, databases, model providers, queues, event buses, registries, or internal engineering modules.

Complexity belongs inside Cortex.

---

## 4. Global Application Shell

### 4.1 Persistent shell

The logged-in shell contains:

- Organization switcher / identity context
- Primary navigation
- Current workspace identity
- Global Search / Ask Cortex
- Attention Required indicator
- Notifications / updates
- Create / command action
- User profile / settings
- Context trail / recent location where useful

The shell remains visually calm. Badges are reserved for meaningful attention, not activity volume.

### 4.2 Primary navigation model

Navigation is responsibility-oriented rather than module-oriented.

Recommended top-level structure:

```text
Command Center
My Work
AI Workforce
Organization
Customers & Growth
Knowledge
Analytics
Administration
```

Department workspaces are reached through Organization, current role context, search, command, related entities, and direct workspace shortcuts. They do not require a permanent sidebar item for every possible department.

### 4.3 Context preservation

When a user moves from one workspace to another, Cortex carries relevant context when permitted.

Example:

```text
Marketing campaign
  → budget concern
  → Finance Workspace opens
  → same campaign selected
  → affected budget visible
  → prior approvals attached
  → AI summary preserved
```

### 4.4 Global command surface

Global command supports:

- navigate;
- find an entity;
- ask a question;
- create permitted work;
- request an action;
- initiate a workflow;
- open a person, customer, goal, project, decision, agent, document, or metric;
- resume recent context.

Natural language is a first-class interaction path, but structured UI remains equally authoritative.

---

## 5. Canonical Information Hierarchy

Every screen uses the same five-level hierarchy:

1. **Critical** — immediate risk, blocking decision, urgent consequence.
2. **Important** — current priorities, active decisions, material changes.
3. **Relevant** — useful supporting context.
4. **Reference** — background detail and evidence.
5. **Archive** — historical information available on demand.

Rules:

- priority must be contextual and role-aware;
- freshness must be visible where it matters;
- reasons for elevated priority should be explainable;
- summaries and evidence are separate layers;
- archived information remains searchable but non-intrusive;
- dashboards may not present dozens of equal-weight metrics.

---

## 6. Workspace System

Every workspace is an operating environment, not a dashboard of widgets.

### 6.1 Shared workspace composition

All workspaces inherit this composition:

```text
Mission
Current Priorities
Key Metrics
Active Work
AI Participant
Decisions
Knowledge
Conversations
Calendar
Related Workspaces
Risks
Opportunities
Next Actions
```

Not every section must be visible at once. The system prioritizes what matters now.

### 6.2 Workspace types

#### Executive Workspace — CANONICAL
Purpose: lead the organization.

Must surface:
- organizational health;
- strategic goals;
- major risks/opportunities;
- decisions awaiting authority;
- material deviations;
- financial/value position;
- AI executive briefing;
- cross-department dependencies;
- outcome trends;
- next strategic actions.

#### Department Workspace — CANONICAL
Purpose: lead a business domain.

Must surface:
- department mission;
- goals and KPIs;
- current priorities;
- projects/workflows;
- budget/resource context;
- team + AI workforce;
- decisions/approvals;
- risks/opportunities;
- linked customers and organizational dependencies;
- domain-aware AI participation.

Examples include Sales, Marketing, Finance, Operations, Customer Success, Engineering, Product, HR, Legal/Compliance, Research.

#### Team Workspace — CANONICAL
Purpose: coordinate daily execution.

Must surface:
- team mission;
- active tasks/work;
- meetings/calendar;
- blockers;
- shared knowledge;
- conversations;
- decisions;
- team agents;
- dependencies;
- progress toward goals.

#### Personal Workspace — CANONICAL
Purpose: help one participant fulfill their responsibilities.

Must surface:
- assigned responsibilities;
- today / upcoming work;
- approvals requiring the user;
- calendar;
- recent context;
- saved views;
- personal AI assistant;
- learning / development context where applicable.

#### AI Workforce Workspace — CANONICAL + TARGET
Purpose: govern the digital workforce as organizational participants.

Must surface:
- AI executives;
- AI departments;
- managers/coordinators;
- agents/workers;
- agent teams;
- active objectives/runs;
- authority envelopes;
- tools and capabilities;
- knowledge and memory;
- model/intelligence usage;
- approvals/escalations;
- performance/outcomes;
- cost/budget;
- audit and reasoning evidence;
- improvement proposals;
- creation/retirement lifecycle.

---

## 7. Core Screen Inventory

The following inventory is the required target product surface. Actual routes may reuse current paths where doing so preserves architecture and user mental model.

### 7.1 Entry, identity, and setup

| ID | Screen / Surface | Purpose | Classification |
|---|---|---|---|
| UX-001 | Sign In | authenticate participant | CANONICAL |
| UX-002 | Organization Entry / Switcher | establish tenant context | CANONICAL |
| UX-003 | Organization Setup | create/configure organization | TARGET |
| UX-004 | Guided Onboarding | capture mission, objectives, organization context | CANONICAL/TARGET |
| UX-005 | Data / Integration Setup | connect approved systems and sources | TARGET |
| UX-006 | Initial Cortex Briefing | explain what Cortex understood and proposed next | IMPLEMENTATION DETAIL |

### 7.2 Command and attention

| ID | Screen / Surface | Purpose | Classification |
|---|---|---|---|
| UX-010 | Command Center | organization-wide operating view | CANONICAL |
| UX-011 | Attention Required | only items requiring human attention/authority | TARGET |
| UX-012 | Executive Briefing | concise organization narrative + evidence | CANONICAL |
| UX-013 | Global Search | entity/relationship discovery | CANONICAL |
| UX-014 | Ask Cortex | conversational navigation, reasoning, command | CANONICAL |
| UX-015 | Activity / Change Feed | meaningful changes, not raw event noise | IMPLEMENTATION DETAIL |
| UX-016 | Notifications | prioritized actionable notifications | CANONICAL |

### 7.3 Goals, work, and decisions

| ID | Screen / Surface | Purpose | Classification |
|---|---|---|---|
| UX-020 | Goals | organizational/department goals | CANONICAL |
| UX-021 | Goal Detail | outcome, owners, dependencies, measures, work | CANONICAL |
| UX-022 | Initiatives / Portfolio | coordinated strategic work | CANONICAL |
| UX-023 | Projects | project list / portfolio | CANONICAL |
| UX-024 | Project Detail | project operating context | CANONICAL |
| UX-025 | Work Queue | prioritized assigned/pending work | CANONICAL |
| UX-026 | Task Detail | task context and execution | CANONICAL |
| UX-027 | Workflow Runs | active long-running processes | CANONICAL/TARGET |
| UX-028 | Workflow Run Detail | state, owners, steps, failures, interventions | TARGET |
| UX-029 | Decisions | decision registry / inbox | CANONICAL |
| UX-030 | Decision Detail | evidence, options, reasoning, authority, outcome | CANONICAL |
| UX-031 | Approval Detail | approve/reject/request-change with consequences | CANONICAL |
| UX-032 | Risks | organizational/domain risks | CANONICAL |
| UX-033 | Opportunities | organizational/domain opportunities | CANONICAL |
| UX-034 | Calendar | role-aware time and scheduled work | CANONICAL |

### 7.4 AI Workforce

| ID | Screen / Surface | Purpose | Classification |
|---|---|---|---|
| UX-040 | AI Workforce Overview | digital workforce health and structure | CANONICAL/TARGET |
| UX-041 | AI Organization Chart | executives → departments → managers → workers | TARGET |
| UX-042 | AI Department Detail | mission, workers, budget, goals, performance | TARGET |
| UX-043 | Agent Directory | discover/filter all agents | CANONICAL |
| UX-044 | Agent Detail | full identity, role, authority, work, evidence | CANONICAL |
| UX-045 | Agent Team Detail | shared objective and coordinated execution | CANONICAL |
| UX-046 | Agent Run Detail | plan, steps, tools, evidence, outputs, events | TARGET |
| UX-047 | Agent Authority | permissions, limits, approval thresholds | TARGET |
| UX-048 | Agent Tools | approved tools/integrations | CANONICAL/TARGET |
| UX-049 | Agent Knowledge | allowed knowledge/context | CANONICAL |
| UX-050 | Agent Memory | visible governed memory | CANONICAL/TARGET |
| UX-051 | Agent Performance | outcome quality, reliability, cost, learning | TARGET |
| UX-052 | Create / Propose Agent | create agent or review Cortex-created proposal | TARGET |
| UX-053 | Agent Change / Retirement | alter role or retire safely | TARGET |
| UX-054 | Capability Gap | why Cortex believes a new capability is needed | TARGET |
| UX-055 | Workforce Improvement | proposed team/role/process changes | TARGET |

### 7.5 Customers, sales, and growth

| ID | Screen / Surface | Purpose | Classification |
|---|---|---|---|
| UX-060 | Customers & Growth Workspace | lead demand/revenue/customer growth | CANONICAL/TARGET |
| UX-061 | Prospect Discovery | identify and research potential prospects | TARGET |
| UX-062 | Prospect Detail | fit, evidence, source, context, outreach state | TARGET |
| UX-063 | Leads | qualified/unqualified lead management | CANONICAL |
| UX-064 | Lead Detail | relationship and lifecycle context | CANONICAL |
| UX-065 | Accounts / Customers | authoritative customer list | CANONICAL |
| UX-066 | Customer 360 | living customer context / health / history | CANONICAL |
| UX-067 | Opportunities | commercial opportunity management | CANONICAL |
| UX-068 | Pipeline | opportunity lifecycle visualization | CANONICAL |
| UX-069 | Opportunity Detail | stakeholders, value, next action, evidence | CANONICAL |
| UX-070 | Campaigns | campaign portfolio and state | CANONICAL/TARGET |
| UX-071 | Campaign Detail | objective, audience, content, budget, results | CANONICAL/TARGET |
| UX-072 | Nurture Sequences | sequence library and active enrollment | CANONICAL/TARGET |
| UX-073 | Sequence Detail | steps, timing, channel, response, conversion | TARGET |
| UX-074 | Outreach Center | governed email/social/call activity | TARGET |
| UX-075 | Conversation / Touchpoint Detail | full multi-channel relationship history | TARGET |
| UX-076 | Sales Agent Workspace | autonomous sales execution visibility | TARGET |
| UX-077 | Customer Success Workspace | health, risk, adoption, value, next action | CANONICAL |
| UX-078 | Renewal / Expansion | renewal confidence and growth opportunities | CANONICAL |

### 7.6 Diagnostic, recommendation, value, proposal, delivery

| ID | Screen / Surface | Purpose | Classification |
|---|---|---|---|
| UX-080 | Public Lead Capture | acquire prospect | CANONICAL |
| UX-081 | Diagnostic | guided questionnaire | CANONICAL |
| UX-082 | Score / Readiness Result | immediate understandable result | CANONICAL |
| UX-083 | Submission Review | internal triage/review | CANONICAL |
| UX-084 | Diagnostic Detail | domain scores/evidence | CANONICAL |
| UX-085 | Recommendation Portfolio | qualified/prioritized recommendations | CANONICAL |
| UX-086 | Recommendation Detail | rationale/evidence/dependencies | CANONICAL |
| UX-087 | ROI / Value Model | assumptions and deterministic outputs | CANONICAL |
| UX-088 | Proposal Editor | governed proposal composition | CANONICAL |
| UX-089 | Proposal Gate | readiness/validation | CANONICAL |
| UX-090 | Proposal Snapshot / Export | immutable sent representation | CANONICAL |
| UX-091 | Contract | contract generation/status | CANONICAL |
| UX-092 | Delivery / Execution | workstreams/milestones/tasks | CANONICAL |
| UX-093 | Scope Change | change impact + approval | CANONICAL |
| UX-094 | ROI Actuals | expected vs realized value | CANONICAL |
| UX-095 | QBR / Value Review | value narrative + evidence | CANONICAL |
| UX-096 | Client Portal | external engagement experience | CANONICAL |

### 7.7 Knowledge, graph, and memory

| ID | Screen / Surface | Purpose | Classification |
|---|---|---|---|
| UX-100 | Knowledge Workspace | organizational knowledge hub | CANONICAL |
| UX-101 | Knowledge Asset | content, owner, lifecycle, provenance | CANONICAL |
| UX-102 | Documents | governed document library | CANONICAL |
| UX-103 | Organizational Graph Explorer | discover relationships | CANONICAL/TARGET |
| UX-104 | Entity Relationship View | connected context around any entity | CANONICAL |
| UX-105 | Organizational Memory | memory overview by type/context | CANONICAL/TARGET |
| UX-106 | Memory Detail | source, history, use, correction/delete controls | CANONICAL/TARGET |
| UX-107 | Decision Memory | prior decisions and outcomes | CANONICAL |
| UX-108 | Lessons / Retrospectives | validated organizational learning | CANONICAL |
| UX-109 | Source / Evidence Viewer | provenance and supporting evidence | CANONICAL |

### 7.8 Analytics and intelligence

| ID | Screen / Surface | Purpose | Classification |
|---|---|---|---|
| UX-110 | Analytics Workspace | role-aware business understanding | CANONICAL |
| UX-111 | KPI / Metric Detail | definition, trend, owners, causes | CANONICAL |
| UX-112 | Insight Detail | AI/analytic insight + evidence/confidence | CANONICAL |
| UX-113 | Forecast / Scenario | future scenarios and assumptions | CANONICAL |
| UX-114 | Outcome Dashboard | goals, value, actual results | CANONICAL |

### 7.9 Organization, administration, security, and governance

| ID | Screen / Surface | Purpose | Classification |
|---|---|---|---|
| UX-120 | Organization | structure and settings | CANONICAL |
| UX-121 | People / Membership | members and team membership | CANONICAL |
| UX-122 | Roles | reusable role definitions | CANONICAL |
| UX-123 | Permissions | granular permission management | CANONICAL/TARGET |
| UX-124 | Authority Envelopes | AI/user execution limits | TARGET |
| UX-125 | Policies | policy definitions and enforcement context | CANONICAL/TARGET |
| UX-126 | Budgets & Limits | spend/resource limits | TARGET |
| UX-127 | Integrations | approved connector registry | CANONICAL |
| UX-128 | Integration Detail | status, scope, permissions, audit | CANONICAL |
| UX-129 | AI Providers / Models | provider-neutral model registry | TARGET/admin |
| UX-130 | Audit Trail | reconstruct actions and decisions | CANONICAL/TARGET |
| UX-131 | Security Center | security posture and governed findings | TARGET |
| UX-132 | Privacy / Data Controls | retention, export, correction, deletion | CANONICAL/TARGET |
| UX-133 | Billing / Entitlements | platform commercial access | CANONICAL future |
| UX-134 | Platform Settings | governed organization/platform settings | CANONICAL |
| UX-135 | Feature / Capability Controls | safe capability rollout/kill switches | TARGET/admin |

---

## 8. Command Center Contract

The Command Center is not a dashboard of everything. It is a **prioritized operating brief**.

Default composition:

1. **Organization status summary** — concise, plain language.
2. **Attention Required** — only decisions/interventions needing the user.
3. **Major changes since last visit**.
4. **Current priorities / strategic goals**.
5. **Risks and opportunities**.
6. **Cross-functional active work**.
7. **AI executive briefing**.
8. **Outcome/value trend**.
9. **Next best actions**.

Rules:

- no wall of KPIs;
- evidence and detail available on demand;
- every alert must state why it matters;
- every recommendation must expose evidence, assumptions, confidence where meaningful, and authority implications;
- role/persona controls depth, not product identity.

---

## 9. Attention Required Contract

This is the primary human-governance surface for a highly autonomous Cortex.

An item appears only when one or more conditions are true:

- authority envelope exceeded;
- high-consequence decision requires approval;
- material budget change;
- policy/security exception;
- legal/commercial commitment outside allowed terms;
- low confidence combined with material impact;
- unresolved agent conflict;
- repeated failure / blocked workflow;
- security or privacy risk;
- decision explicitly assigned to the human.

Each item must show:

- what Cortex wants to do;
- why;
- consequence of approve;
- consequence of reject/delay;
- evidence;
- affected entities;
- budget/risk exposure;
- policy/authority basis;
- recommended choice if appropriate;
- alternatives;
- Approve / Reject / Modify / Ask Cortex / Escalate actions;
- audit history.

Routine actions within an approved envelope must **not** flood this surface.

---

## 10. AI Workforce UX Contract

### 10.1 Agent card

Minimum visible information:

- name;
- role;
- department/team;
- status;
- current objective/work;
- authority level;
- health/outcome indicator;
- current cost/budget signal if material;
- pending escalation if any.

### 10.2 Agent detail

Required sections:

```text
Overview
Role & Mission
Authority
Capabilities & Skills
Tools
Knowledge
Memory
Current Work
Runs / History
Decisions & Escalations
Performance & Outcomes
Cost / Budget
Audit
Changes / Retirement
```

### 10.3 Agent run detail

A human must be able to understand a run without reading raw model logs.

Show:

- objective;
- plan;
- current step;
- completed steps;
- delegated work;
- tools used;
- evidence consulted;
- important reasoning summary;
- decisions made;
- permissions/authority used;
- cost/time;
- result;
- errors/retries;
- human interventions;
- trace chain.

Raw technical traces may exist for authorized technical users, but are not the default UX.

### 10.4 Self-forming teams

When Cortex determines a new capability/team/agent is required, UI shows:

- capability gap;
- why existing workforce is insufficient;
- proposed department/team/role;
- expected outcome;
- required tools/data;
- authority requested;
- projected operating cost;
- duration/permanence;
- approval requirement based on policy.

If creation falls fully inside a pre-approved authority envelope, Cortex may create the agent/team and report the change after execution. Otherwise, it enters Attention Required.

---

## 11. Goals and Autonomous Execution UX

A goal is not a static record. It is the top of an execution graph.

Goal Detail must show:

- outcome statement;
- owner / accountable human;
- AI executive/department responsible;
- measures / target;
- timeframe;
- budget/resource envelope;
- constraints/policies;
- assumptions;
- linked initiatives/projects/workflows;
- workforce assigned;
- current progress;
- blockers;
- risks;
- decisions;
- outcome evidence;
- learning.

Cortex may propose decomposition:

```text
Goal
→ Outcomes
→ Capabilities required
→ Departments/teams
→ Workstreams
→ Projects/workflows
→ Tasks/actions
```

The user approves only where authority policy requires it.

---

## 12. Sales / Growth UX Contract

The commercial experience is one connected operating system, not separate lead, CRM, email, call, and campaign products.

### 12.1 Growth workspace

Must answer:

- where demand/revenue is coming from;
- best current opportunities;
- prospect/lead quality;
- campaign health;
- pipeline risk;
- customer expansion opportunity;
- budget position;
- what AI sales/growth teams are doing;
- what requires human attention.

### 12.2 Prospect Discovery

Target surface includes:

- ideal customer criteria;
- discovery strategy;
- discovered prospects;
- fit score / rationale;
- source/evidence;
- contact/account context;
- exclusions/consent/compliance state;
- next recommended action;
- assigned Sales/Research Agent.

No source may be used unless it is approved by integration/data policy.

### 12.3 Outreach Center

Target channels may include approved:

- email;
- social messaging;
- telephony/calls;
- multi-channel sequences.

The UI must expose:

- channel;
- sequence state;
- message/call summary;
- personalization basis;
- policy/consent status;
- delivery/result state;
- reply/intent;
- next scheduled action;
- agent responsible;
- human escalation where needed.

Cortex must not expose channel complexity unless it helps the user understand or intervene.

### 12.4 Sales Agent

The Sales Agent experience should emphasize **objective + outcome + governance**, not prompt editing.

Show:

- territory/ICP;
- pipeline objective;
- active prospects/leads;
- conversations;
- nurture actions;
- opportunities;
- meetings;
- objections;
- proposals;
- conversion/outcome trend;
- budget;
- escalations;
- lessons learned.

---

## 13. Customer 360 UX Contract

The customer is a living organizational entity, not a CRM row.

Customer 360 must connect:

- relationship summary;
- stakeholders;
- goals / desired outcomes;
- lifecycle stage;
- active opportunities/contracts;
- projects/delivery;
- support/customer success;
- communications;
- product/service usage where available;
- feedback/sentiment;
- health;
- value realization;
- risks;
- renewal confidence;
- expansion opportunities;
- AI interactions;
- decisions/commitments;
- knowledge/memory;
- timeline.

The AI summary should explain changes and next-best actions with evidence.

---

## 14. Knowledge Graph and Memory UX

### 14.1 Graph principle

The graph is primarily a **navigation and understanding layer**. Users should not be forced to operate a graph database UI.

Default entity pages expose relationships contextually.

Graph Explorer is available when relationship exploration itself is useful.

### 14.2 Entity relationship view

For any canonical entity, show related:

- organization / team / people;
- goals;
- work;
- decisions;
- knowledge/documents;
- conversations;
- customers;
- AI agents;
- risks/opportunities;
- metrics/outcomes;
- history.

### 14.3 Memory UX

Memory must be visible and controllable.

A memory item shows:

- memory type;
- subject/entity;
- source;
- captured date;
- last validated date;
- confidence/validation state where applicable;
- access scope;
- where it has been used;
- linked evidence;
- edit/correct controls;
- forget/delete controls where policy permits;
- history.

Memory consolidation must not silently turn an unverified observation into authoritative knowledge.

---

## 15. AI Recommendation / Reasoning Pattern

Every consequential AI recommendation uses the same pattern:

```text
Recommendation
Why it matters
Evidence
Assumptions
Confidence / uncertainty when meaningful
Alternatives
Consequences
Authority required
Suggested next action
```

Users must be able to inspect source evidence and related entities.

Do not show raw chain-of-thought. Show concise, reviewable reasoning summaries and evidence sufficient for accountability.

---

## 16. Decision and Approval UX

Decision Detail is a canonical reusable pattern.

Required fields:

- decision question;
- owner / authority;
- deadline;
- context;
- options;
- evidence;
- deterministic analysis if applicable;
- AI recommendation if applicable;
- risks/consequences;
- dependencies;
- prior related decisions;
- approval path;
- final decision;
- rationale;
- resulting actions;
- outcome review.

Approval controls must never appear without consequence context.

---

## 17. Search and Discovery UX

Search must work across canonical organizational entities, not separate indexes users need to understand.

Result order:

1. direct answer / understanding when appropriate;
2. best matching entities;
3. relationships;
4. evidence/sources;
5. suggested next action.

Search filters may include entity type, organization/domain, owner, date, status, priority, and relationship.

Permission filtering occurs before results are displayed.

---

## 18. Natural Language and Voice

### 18.1 Natural language

Natural language can:

- navigate;
- search;
- summarize;
- create permitted work;
- request analysis;
- initiate workflows;
- ask for decisions/risks/opportunities;
- delegate to AI workforce;
- configure goals/constraints within permission.

The UI must show what action Cortex interpreted before any high-consequence execution.

### 18.2 Voice

Voice is a later interaction layer over the same organizational model.

Voice should support:

- briefings;
- questions;
- quick approvals where policy permits;
- navigation;
- task/status updates;
- hands-free interaction.

Voice must not create a second product model or bypass approval/security requirements.

---

## 19. Mobile Experience

Mobile is optimized for awareness, quick decisions, approvals, communication, and context recovery — not for compressing the entire desktop application into a phone.

Mobile priority:

1. Attention Required
2. Briefing
3. My Work
4. Notifications
5. Search / Ask Cortex
6. Quick entity review
7. Approvals / decisions
8. Communication
9. Calendar

Deep configuration, complex analysis, broad graph exploration, and platform administration may remain desktop-first unless specifically required.

---

## 20. UI States

Every major screen/component must define:

- loading;
- first-use / empty;
- normal;
- filtered-empty;
- stale data;
- partial data;
- offline/degraded;
- permission denied;
- policy blocked;
- approval required;
- processing / long-running;
- success;
- recoverable error;
- unrecoverable error;
- archived/retired where applicable.

### 20.1 Empty states

Empty states should explain:

- what belongs here;
- why it matters;
- what will populate it;
- the next useful action.

### 20.2 Error states

Errors must avoid silent failure. Show:

- what failed;
- what did not change;
- whether Cortex will retry;
- what the user can do;
- correlation/reference ID for support where relevant.

---

## 21. Calm Interface Rules

The visual system must reinforce cognition, not decoration.

Mandatory rules:

- no unnecessary movement;
- no flashing indicators;
- avoid excessive badges;
- avoid competing colors;
- avoid multiple simultaneous primary CTAs;
- animation must communicate state, continuity, cause, or progress;
- typography and spacing must establish hierarchy before decoration;
- dense enterprise data must still have clear grouping and priority;
- progressive disclosure hides advanced controls until relevant;
- one screen, one dominant purpose;
- consistent interaction patterns across departments.

Exact production color palette, font family, token values, shadows, radii, and motion timings are **not invented in this specification**. They must be inherited from an approved design system or defined in a separate design-token artifact after existing UI assets are audited.

---

## 22. Core Reusable Components

Required platform-level components include:

- AppShell
- WorkspaceShell
- CommandPalette / AskCortex
- GlobalSearch
- AttentionItem
- PriorityList
- ExecutiveBriefing
- EntityHeader
- EntityRelationshipPanel
- EntityTimeline
- EvidencePanel
- DecisionCard / DecisionDetail
- ApprovalPanel
- RiskCard
- OpportunityCard
- GoalCard / GoalProgress
- WorkQueue
- WorkflowProgress
- AgentCard
- AgentStatus
- AgentRunTimeline
- AuthorityEnvelopeViewer
- ToolUsageViewer
- MemoryCard
- KnowledgeAssetCard
- CustomerHealthSummary
- PipelineView
- CampaignSummary
- OutreachTimeline
- MetricSummary
- ChangeSummary
- AuditTimeline
- PermissionGuard / PolicyGuard states
- Loading / Empty / Error / Degraded patterns

Domain-specific components extend these primitives rather than inventing alternate interaction systems.

---

## 23. Canonical Entity Detail Pattern

All major entities should use a shared mental model:

```text
Identity / Status
Summary
Why it matters
Current state
Relationships
Work / activity
Decisions
Knowledge / evidence
History / timeline
AI insight
Actions
```

Examples: Goal, Project, Customer, Opportunity, Campaign, Agent, Decision, Knowledge Asset, Contract.

This consistency reduces learning effort across the whole platform.

---

## 24. Permissions, Security, and Governance in the UI

Security controls must be visible enough to build trust without making normal work feel like security administration.

Rules:

- hidden actions must also be denied server-side;
- permissions are not inferred from visual access;
- sensitive actions show the identity and authority being used;
- policy-blocked actions explain the applicable restriction;
- high-consequence actions show consequences before confirmation;
- agent authority can be inspected at any time;
- tenant/organization context is always unambiguous;
- cross-tenant data must never appear, even briefly during loading or error states;
- audit links should exist on consequential actions;
- secrets are never displayed to AI users/agents;
- security posture changes require explicit governed workflows.

---

## 25. Accessibility and Inclusive UX

Every surface must support:

- keyboard navigation;
- visible focus states;
- semantic structure;
- screen-reader-compatible labels;
- sufficient contrast;
- meaningful non-color state indicators;
- scalable text;
- reduced-motion preference;
- accessible tables/charts;
- understandable error messages;
- touch targets suitable for mobile;
- no information available only by hover.

Accessibility is a release requirement, not a polish phase.

---

## 26. Responsive Behavior

### Desktop

Primary environment for deep work, complex comparison, configuration, graph exploration, and multi-panel context.

### Tablet

Supports operational workspaces, review, analysis, meetings, and approvals with reduced simultaneous panes.

### Mobile

Prioritizes attention, briefings, approvals, communication, search, status, and quick work.

Responsive design must preserve **information priority and task purpose**, not simply shrink desktop layouts.

---

## 27. Long-Running and Autonomous Work UX

When Cortex is working asynchronously, users need state without babysitting.

Use clear lifecycle states such as:

```text
Queued
Planning
Running
Waiting on dependency
Waiting on human
Retrying
Blocked
Completed
Failed
Cancelled
```

For long-running goals/workflows show:

- current objective;
- current phase;
- progress/evidence;
- active agents;
- next expected milestone;
- exceptions;
- budget/cost when material;
- pause/cancel/intervene controls subject to authority.

Do not require the user to keep a page open.

---

## 28. Self-Improvement UX

Cortex improvement is visible as governed organizational change.

Improvement proposal must show:

- detected issue/opportunity;
- evidence;
- affected workflow/team/agent;
- proposed change;
- expected benefit;
- risk;
- evaluation method;
- sandbox/test result where relevant;
- required approval;
- rollback plan;
- post-change outcome.

Low-risk changes may auto-promote only when explicitly permitted by policy and Target Architecture authority rules.

---

## 29. Platform Administration UX

Administration is separated from normal operating work.

Admin areas:

- organization settings;
- people/membership;
- roles/permissions;
- authority envelopes;
- policies;
- integrations;
- AI provider/model registry;
- budgets/quotas;
- privacy/data controls;
- audit;
- security;
- billing/entitlements;
- feature rollout / kill switches;
- system health for authorized platform operators.

Platform-admin capabilities must not leak into ordinary organization-admin views.

---

## 30. UI-to-Architecture Mapping Rules

Every screen must map to:

```text
User intent
→ Canonical entity/entities
→ Workspace / surface
→ Application/domain service
→ Policy/authority check
→ Data / graph / memory source
→ AI/deterministic capability if needed
→ Event/workflow if long-running
→ Audit / observability
```

No UI component may call model providers, vendor SDKs, or databases directly.

All external actions pass through governed services / Tool Gateway defined by Target Architecture v2.0.

---

## 31. Existing-Code Reconciliation Protocol

After this specification is locked, current UI/code must be classified screen-by-screen and component-by-component:

- **KEEP** — already aligned and reusable.
- **MODIFY** — correct concept, incomplete behavior/design.
- **MERGE** — duplicates should consolidate into one canonical surface.
- **REMOVE** — contradicts product model or has no future use.
- **BUILD NEW** — required by this spec but absent.

Rules:

- preserve working functionality when architecture permits;
- do not retain a bad screen solely because code already exists;
- do not rebuild a good surface merely to make it look new;
- remove obsolete UI and documentation immediately after replacement is verified;
- update route, component, and architecture maps in the same change set.

---

## 32. Build Packet Requirements for Claude / Codex

No implementation packet should simply say “build Sales Workspace” or “build Agent Center.”

Every packet must contain:

1. screen IDs involved;
2. user/actor;
3. purpose;
4. canonical entities;
5. required UI sections;
6. allowed actions;
7. authority/permission rules;
8. states;
9. API/service dependencies;
10. AI/deterministic ownership;
11. audit requirements;
12. responsive behavior;
13. accessibility requirements;
14. acceptance criteria;
15. existing code to KEEP/MODIFY/REMOVE;
16. tests required.

This prevents Claude/Codex from inventing product architecture during implementation.

---

## 33. UI Quality Gates

A screen does not pass unless all applicable gates pass.

### Gate U1 — Purpose
A user can understand the dominant purpose immediately.

### Gate U2 — Priority
Critical/important information is visually and structurally dominant.

### Gate U3 — Context
The user knows where they are, why the information matters, and what changed.

### Gate U4 — Action
The next meaningful action is obvious without exposing unnecessary actions.

### Gate U5 — Trust
AI recommendations/actions are explainable and significant automation is visible.

### Gate U6 — Governance
Permissions, policy, tenant isolation, and authority are enforced.

### Gate U7 — Continuity
Navigation preserves relevant context.

### Gate U8 — AI integration
AI acts as a domain-aware participant, not an unrelated chat widget.

### Gate U9 — States
Loading, empty, blocked, degraded, error, success, and long-running states are designed.

### Gate U10 — Accessibility
Keyboard, semantics, contrast, reduced motion, and assistive technology requirements pass.

### Gate U11 — Responsive
Desktop/mobile behavior preserves purpose and priority.

### Gate U12 — Architecture
The screen uses approved services/contracts and does not bypass Target Architecture v2.0.

---

## 34. Deliberately Unresolved Visual Decisions

This specification intentionally does **not** invent:

- final brand palette;
- final typefaces;
- exact spacing scale;
- exact radius/shadow system;
- exact icon family;
- illustration style;
- detailed motion durations;
- final chart styling;
- exact sidebar width/layout measurements.

These should be decided after auditing the existing UI/design assets so useful work can be retained. The behavioral and structural UX above is authoritative for the build-preparation phase.

---

## 35. Immediate Next Artifact

After this specification is verified, the next work is **not another conceptual UI document**.

The next artifact is the code-gap reconciliation:

`CURRENT_UI_VS_TARGET_UI_GAP_MAP.md`

It must inspect the actual repository and map every current route/page/component to:

`KEEP / MODIFY / MERGE / REMOVE / BUILD NEW`.

That gap map becomes the basis of the implementation sequence and Claude/Codex build packets.

---

## 36. Final UI Target State

The completed Cortex experience should allow a person to open the product and feel that the organization has been working while they were away.

They should see:

- what matters;
- what changed;
- what Cortex and its agents are doing;
- what outcomes are being produced;
- what requires their authority;
- why recommendations exist;
- how the organization is connected;
- what should happen next.

The sophistication of multi-model intelligence, autonomous agents, graph reasoning, durable workflows, memory, eventing, security, and orchestration remains largely invisible until the user needs to inspect or govern it.

That is the UI expression of the Cortex principle:

> **Maximum intelligence. Minimum complexity.**
