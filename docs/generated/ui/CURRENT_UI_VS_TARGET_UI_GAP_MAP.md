# MARQ CORTEX — CURRENT UI VS TARGET UI GAP MAP

> **DERIVED DOCUMENT — NOT A SOURCE OF TRUTH**  
> This is the implementation reconciliation between the actual repository UI and `MARQ_CORTEX_UI_IMPLEMENTATION_SPEC_v1.0.md`. Product meaning remains governed by the canonical Cortex documents. Target structure is governed by `architecture/MARQ_CORTEX_TARGET_ARCHITECTURE_v2.0.md`.

**Status:** Build-preparation / code-gap map  
**Branch audited:** `docs/canonical-doc-cleanup`  
**Primary evidence:** current routes, `navigationModel.ts`, `capabilityStatus.ts`, `TeamDashboardLayout.tsx`, `TeamDashboardNew.tsx`, current component tree, and retained Product Reality evidence.  
**Decision vocabulary:** `KEEP · MODIFY · MERGE · REMOVE · BUILD NEW`

---

## 1. Governing Finding

The repository already contains a substantial amount of useful UI and domain logic. The correct implementation strategy is **not a visual rewrite and not a delete-and-rebuild**.

The current product is still structurally centered on the earlier diagnostic/operator-console model:

`Dashboard → Diagnostic/CORTEX → Analytics → Revenue → Execution → AI Control Plane → Admin`

The target product is organized around the Cortex organizational mental model:

`Organization → Goals → Workspaces → People + AI Workforce → Customers/Growth → Knowledge → Decisions → Outcomes/Learning`

Therefore:

- preserve proven engines, domain panels, forms, tables, accessibility work, route/error states, and reusable primitives;
- replace the old **information architecture and shell hierarchy** rather than discarding useful capability;
- merge narrow diagnostic/commercial screens into the target entity/workspace model;
- move technical platform administration out of ordinary product navigation;
- build the missing organization/workforce/knowledge/attention surfaces on top of the existing foundation;
- never preserve demo-only UI as if it were product capability.

---

## 2. Current UI Reality — Verified Baseline

### 2.1 Current public/auth routes

Current route surface:

- `/` — landing;
- `/get-started` — lead capture / lead magnet;
- `/diagnostic` — diagnostic;
- `/score` — score result;
- `/team/login` — team/operator login;
- `/team/dashboard` — authenticated console shell;
- `/team/execution` — delivery execution;
- `/client/login` — client login;
- `/client/portal` — client portal;
- `/architecture` — internal architecture reference;
- `/registry` — developer/debug registry.

### 2.2 Current authenticated destinations

`navigationModel.ts` declares:

- Dashboard
- Reviewer QA
- Email Queue
- CORTEX
- Analytics
- Revenue Intelligence
- Strategy
- Execution
- Mapping Engine
- AI Control Plane
- Operations
- Organization
- Settings
- Architecture

Current capability truth also matters:

- live: Dashboard, CORTEX, Analytics, Revenue, Strategy, Organization, Settings, Architecture;
- blocked on backend: Operations, AI Control Plane;
- partial: Email Queue;
- hidden demo-only: Reviewer QA;
- hidden empty: Mapping Engine, Execution.

This gap map does not upgrade any of those statuses merely because a component exists.

---

## 3. Global Shell and Navigation

| Current asset | Decision | Target use |
|---|---|---|
| `TeamDashboardLayout` | **MODIFY** | Becomes the base `AppShell`: tenant context, primary nav, Search/Ask Cortex, Attention Required, notifications, profile, context trail. Preserve responsive drawer, skip link, keyboard/accessibility behavior. |
| `navigationModel.ts` | **MODIFY** | Replace old operator-console destinations with target hierarchy: Command Center, My Work, AI Workforce, Organization, Customers & Growth, Knowledge, Analytics, Administration. Keep one canonical nav model. |
| `CommandPalette` | **MODIFY** | Expand from destination/submission search into Global Search + command + entity access. Preserve keyboard model. |
| `GlobalAIChat` / `GlobalAIChatProvider` | **MERGE** | Become `Ask Cortex` integrated into shell/workspaces; no detached chatbot mental model. |
| Breadcrumb/context trail | **KEEP + MODIFY** | Preserve orientation; expand to canonical entity/context relationships rather than old page labels only. |
| `NotificationCenter` | **MODIFY** | Priority-aware actionable notifications; separate from Attention Required. |
| responsive sidebar/drawer | **KEEP** | Preserve interaction pattern and accessibility; change IA, not basic responsive behavior. |
| `Architecture` destination | **REMOVE from product navigation** | Retain as developer/admin utility only while useful; users should not navigate platform internals as business work. |
| `RegistryViewer` | **REMOVE from product navigation** | Developer/debug utility only; never a customer product destination. |

### Target shell gaps

**BUILD NEW:** organization switcher, Attention Required indicator/surface, global create/action command, recent-context recovery, canonical entity search, context-preserving workspace transitions.

---

## 4. Entry, Identity, and Setup

| Target | Current evidence | Decision |
|---|---|---|
| UX-001 Sign In | `TeamLogin`, `ClientLogin` | **MODIFY** — preserve auth forms/flows, align identity entry with target actor/tenant model. |
| UX-002 Organization Entry / Switcher | workspace name is displayed but no real switcher | **BUILD NEW** |
| UX-003 Organization Setup | no complete self-serve org setup UI | **BUILD NEW** |
| UX-004 Guided Onboarding | explicitly absent in old UI audit | **BUILD NEW** |
| UX-005 Data / Integration Setup | `OrganizationProviderCredentialsPanel`, `CRMSyncPanel` are narrow/admin-specific | **MERGE** into governed integration setup |
| UX-006 Initial Cortex Briefing | no first-run understanding/plan surface | **BUILD NEW** |

---

## 5. Command Center and Human Attention

| Target | Current evidence | Decision |
|---|---|---|
| UX-010 Command Center | `TeamHomeDashboard`, `StrategySurface`, `OperationsPanel`, analytics/revenue summaries | **MERGE** into one priority-first Command Center |
| UX-011 Attention Required | notifications and reviewer concepts exist, but no authority-driven attention inbox | **BUILD NEW** |
| UX-012 Executive Briefing | fragments exist in Cortex/strategy/analytics/ROI | **MERGE** into a canonical executive briefing pattern |
| UX-013 Global Search | `CommandPalette` searches destinations/submissions | **MODIFY** to canonical entity/relationship search |
| UX-014 Ask Cortex | `GlobalAIChat`, `CortexChatPanel`, `AIAssistant`, Copilot surfaces | **MERGE** into one context-aware Cortex interaction model |
| UX-015 Activity / Change Feed | `EngagementActivityFeed` is domain-specific | **MERGE** into organization/entity change feeds |
| UX-016 Notifications | `NotificationCenter` | **MODIFY** for canonical priority and actionable state |

**Key rule:** the current `TeamHomeDashboard` does not become the final Command Center unchanged. It is a useful source of priorities, pipeline and current activity, but the target Command Center must organize the entire company, not only submissions.

---

## 6. Workspaces

### 6.1 Executive Workspace

**Current:** no canonical Executive Workspace. Useful fragments exist in `StrategySurface`, `OperationsPanel`, `RevenueIntelligenceDashboard`, `AnalyticsDashboard`, ROI/QBR surfaces and Cortex summaries.

**Decision:** **BUILD NEW shell + MERGE existing intelligence panels.**

### 6.2 Department Workspace

**Current:** no reusable Department Workspace. Departments exist structurally through `OrganizationSpine`; current pages are subsystem screens rather than responsibility-oriented department operating environments.

**Decision:** **BUILD NEW reusable WorkspaceShell**, then compose Sales, Marketing, Finance, Operations, Customer Success, Engineering, Product, HR, Legal/Compliance and Research only as supported by product data/capability.

### 6.3 Team Workspace

**Current:** `TeamHomeDashboard`, `TeamManagement`, messages and execution fragments.

**Decision:** **MERGE** into a true Team Workspace containing mission, current work, meetings, knowledge, decisions, blockers, people + agents, dependencies and goal progress.

### 6.4 Personal Workspace

**Current:** no canonical personal operating environment.

**Decision:** **BUILD NEW.**

### 6.5 AI Workforce Workspace

**Current:** `AIAdministrationConsole` contains provider/routing/agent/workflow/budget/audit capabilities but is an administration/control-plane console.

**Decision:** **BUILD NEW workforce experience by MERGING useful AI-control-plane internals.** Do not expose provider operations as the mental model of an AI workforce.

---

## 7. Goals, Work, Decisions, Risks, Opportunities

| Target | Current asset | Decision |
|---|---|---|
| UX-020 Goals | `StrategySurface` | **MODIFY** |
| UX-021 Goal Detail | strategy records exist; no canonical detail operating view | **BUILD NEW** using strategy data/contracts |
| UX-022 Initiatives / Portfolio | no enterprise Initiative model/surface | **BUILD NEW** |
| UX-023 Projects | execution project is consulting-delivery-specific | **BUILD NEW** generic project surface; reuse execution components where valid |
| UX-024 Project Detail | `ExecutionDashboard` contains useful delivery detail | **MERGE** into canonical project/entity pattern |
| UX-025 Work Queue | `TeamHomeDashboard` priority/submission queue | **MERGE** into role-aware My Work queue |
| UX-026 Task Detail | task UI exists only inside delivery execution | **MERGE** into reusable Task Detail |
| UX-027 Workflow Runs | workflow operator/admin capability exists inside AI Control Plane | **MERGE** into product-facing workflow runs |
| UX-028 Workflow Run Detail | admin/runtime inspection exists in narrow form | **MODIFY** for human-readable objective/state/intervention UX |
| UX-029 Decisions | `StrategySurface` decisions | **MODIFY** into decision registry/inbox |
| UX-030 Decision Detail | no complete canonical detail | **BUILD NEW** |
| UX-031 Approval Detail | approvals exist in isolated proposal/AI admin paths | **BUILD NEW reusable approval pattern**, then reuse existing approval services |
| UX-032 Risks | `StrategySurface` risks | **MODIFY** |
| UX-033 Opportunities | no canonical enterprise opportunity surface | **BUILD NEW** |
| UX-034 Calendar | `MeetingScheduler`, `InstantBooking` | **MERGE** into role-aware Calendar/scheduled work |

---

## 8. AI Workforce

The existing AI administration work is valuable engineering and should **not** be discarded. The gap is product expression.

| Target | Current evidence | Decision |
|---|---|---|
| UX-040 AI Workforce Overview | AI Control Plane only | **BUILD NEW**, fed by existing runtime/admin services |
| UX-041 AI Organization Chart | none | **BUILD NEW** |
| UX-042 AI Department Detail | none | **BUILD NEW** |
| UX-043 Agent Directory | agent admin/runtime list exists | **MODIFY** into workforce directory |
| UX-044 Agent Detail | partial administrative detail | **MODIFY** to identity/role/authority/work/evidence model |
| UX-045 Agent Team Detail | no product-facing coordinated-team surface | **BUILD NEW** |
| UX-046 Agent Run Detail | runtime/admin evidence exists | **MODIFY** into human-readable plan/steps/tools/evidence/result timeline |
| UX-047 Agent Authority | backend/admin authority concepts exist | **BUILD NEW product surface** |
| UX-048 Agent Tools | provider/tool governance fragments exist | **MERGE** into agent detail/tool registry |
| UX-049 Agent Knowledge | absent as governed agent view | **BUILD NEW** |
| UX-050 Agent Memory | absent | **BUILD NEW** |
| UX-051 Agent Performance | usage/spend exist; outcome quality view absent | **MERGE + BUILD NEW** |
| UX-052 Create / Propose Agent | no real product producer for agent runs/creation | **BUILD NEW** |
| UX-053 Agent Change / Retirement | absent product flow | **BUILD NEW** |
| UX-054 Capability Gap | absent | **BUILD NEW** |
| UX-055 Workforce Improvement | absent | **BUILD NEW** |

### AI components to preserve and reposition

- `AIAdministrationConsole` — **MERGE** into Administration + AI Workforce technical views.
- `ProviderAdministrationPanel` — **KEEP/MODIFY** as admin-only provider registry.
- `RoutingPanel` — **KEEP/MODIFY** as admin/diagnostic intelligence routing view, not ordinary workforce UX.
- budget/usage/audit/diagnostics tabs — **MERGE** into appropriate Workforce Performance / Administration / Audit surfaces.
- `GlobalAIChat`, `CortexChatPanel`, `CopilotPanel`, `AIAssistant`, `InlineAITrigger` — **MERGE** into one consistent domain-aware AI interaction system.

---

## 9. Customers, Sales, and Growth

| Target | Current evidence | Decision |
|---|---|---|
| UX-060 Customers & Growth Workspace | pipeline, revenue, email nurture, engagement, CRM fragments | **BUILD NEW workspace + MERGE** fragments |
| UX-061 Prospect Discovery | absent | **BUILD NEW** |
| UX-062 Prospect Detail | absent | **BUILD NEW** |
| UX-063 Leads | current submissions/lead records and list | **MODIFY** into canonical Leads |
| UX-064 Lead Detail | `CortexDashboard` lead/submission detail | **MERGE** into Lead Detail + diagnostic context |
| UX-065 Accounts / Customers | no authoritative internal customer list | **BUILD NEW** |
| UX-066 Customer 360 | `ClientPortal`, `ClientMessaging`, `EngagementActivityFeed`, `EngagementIntelligence` are fragments | **BUILD NEW + MERGE** fragments |
| UX-067 Opportunities | pipeline/deal concepts exist but no canonical opportunity experience | **MODIFY/BUILD** around canonical opportunity entity |
| UX-068 Pipeline | `PipelineKanban` | **KEEP + MODIFY** to target entity/status model |
| UX-069 Opportunity Detail | no full canonical detail | **BUILD NEW** |
| UX-070 Campaigns | no campaign portfolio surface | **BUILD NEW** |
| UX-071 Campaign Detail | no canonical campaign detail | **BUILD NEW** |
| UX-072 Nurture Sequences | `EmailNurturePanel` local browser queue | **MODIFY HEAVILY**; replace local-only state with shared governed sequence runtime |
| UX-073 Sequence Detail | absent | **BUILD NEW** |
| UX-074 Outreach Center | no governed multi-channel center | **BUILD NEW** |
| UX-075 Touchpoint Detail | messages/engagement/activity exist in separate components | **MERGE** into canonical multi-channel timeline |
| UX-076 Sales Agent Workspace | absent | **BUILD NEW** |
| UX-077 Customer Success Workspace | QBR, engagement and client surfaces provide fragments | **BUILD NEW + MERGE** |
| UX-078 Renewal / Expansion | QBR/revenue/customer opportunity fragments | **MERGE** into customer growth workflow |

### Specific current components

- `PipelineKanban` — preserve interaction patterns/data views; migrate to canonical opportunity/pipeline services.
- `RevenueIntelligenceDashboard` — fold into Growth/Analytics/Executive contexts rather than standalone top-level subsystem.
- `EmailNurturePanel` — do not retain localStorage-only queue as product authority.
- `CRMSyncPanel` — move under governed Integrations.
- `ObjectionHandlerPanel` — fold into Opportunity/Sales Agent workflows.
- `EngagementActivityFeed` / `EngagementIntelligence` — fold into Customer 360 and relationship timeline.
- `ClientMessaging` / `TeamMessageThread` — preserve messaging capability, unify entity context.

---

## 10. Diagnostic → Recommendation → Value → Proposal → Delivery

This is the strongest current product area and should be **preserved**, then embedded into the target operating model.

| Target | Current asset | Decision |
|---|---|---|
| UX-080 Public Lead Capture | `LandingPage`, `LeadMagnetCapture`, `ExitIntentPopup` | **KEEP + MODIFY** visual/IA alignment |
| UX-081 Diagnostic | `DiagnosticForm`, `DiagnosticQuestion`, universal/industry questions | **KEEP + MODIFY** |
| UX-082 Score / Readiness | `ScorePage` | **KEEP + MODIFY** |
| UX-083 Submission Review | current `ReviewerDashboard` fabricates submissions | **REMOVE current surface; BUILD NEW** real review queue |
| UX-084 Diagnostic Detail | `CortexDashboard`, `CortexDashboardSections` | **MODIFY** |
| UX-085 Recommendation Portfolio | Cortex recommendation sections/modules | **MODIFY/MERGE** |
| UX-086 Recommendation Detail | current recommendation/detail structures | **MODIFY** into canonical entity detail pattern |
| UX-087 ROI / Value Model | `EnhancedROI`, `ROITabLayout`, `ROIAssumptionsEditor`, `DCFPanel`, `MonteCarloPanel`, `ScenarioPanel`, financial summaries | **KEEP + MODIFY** |
| UX-088 Proposal Editor | `ProposalDraftEditor`, `EditableBlockCard`, `ProposalSectionCopilot`, `CortexProposalModule` | **KEEP + MODIFY** |
| UX-089 Proposal Gate | `ProposalControlPanel` / reviewer/gate logic | **KEEP + MODIFY** |
| UX-090 Snapshot / Export | `SnapshotHistoryPanel`, `ExportPanel`, `ProposalViewer` | **KEEP + MODIFY** |
| UX-091 Contract | `ContractDraftViewer` | **KEEP + MODIFY** |
| UX-092 Delivery / Execution | `ExecutionDashboard` / Execution route exists but producer/persistence is incomplete | **MODIFY** after producer/persistence is repaired |
| UX-093 Scope Change | execution/scope machinery exists | **MODIFY** into canonical approval/change pattern |
| UX-094 ROI Actuals | `ROITrackingPanel` | **KEEP + MODIFY** |
| UX-095 QBR / Value Review | `QBRPanel` | **KEEP + MODIFY** |
| UX-096 Client Portal | `ClientPortal`, reports, solution view, messaging, booking | **KEEP + MODIFY**; live-auth verification remains required |

### Current surfaces to retire/reposition

- `ReviewerDashboard` — **REMOVE** because its current data is fabricated; replace with real Submission Review.
- `MappingEnginePanel` as a primary destination — **MERGE** into proposal→execution workflow; deterministic mapping remains valuable, but it should not be a standalone business destination.
- CORTEX as a single catch-all top-level diagnostic destination — **MODIFY** into canonical Lead/Diagnostic/Recommendation entity/workspace views.

---

## 11. Knowledge, Graph, and Memory

This is the largest clean UI gap.

| Target | Current evidence | Decision |
|---|---|---|
| UX-100 Knowledge Workspace | no canonical product workspace | **BUILD NEW** |
| UX-101 Knowledge Asset | no canonical asset lifecycle UI | **BUILD NEW** |
| UX-102 Documents | export/proposal documents exist but no governed document library | **BUILD NEW** |
| UX-103 Graph Explorer | organization spine visualizes structure only; no enterprise relationship explorer | **BUILD NEW** |
| UX-104 Entity Relationship View | relationships are scattered across screens | **BUILD NEW reusable panel** |
| UX-105 Organizational Memory | no runtime product surface | **BUILD NEW** |
| UX-106 Memory Detail | absent | **BUILD NEW** |
| UX-107 Decision Memory | Strategy decisions exist but no outcome/memory model UI | **BUILD NEW/MERGE** |
| UX-108 Lessons / Retrospectives | `LearningLoopPanel` is not a trustworthy canonical learning system | **REMOVE as authority; BUILD NEW** on real learning data |
| UX-109 Source / Evidence Viewer | evidence appears locally in diagnostic/proposal views | **BUILD NEW reusable evidence component**, reusing existing evidence rendering where valid |

**Do not turn the graph into the primary UI.** The target uses relationships contextually; Graph Explorer is secondary and purpose-driven.

---

## 12. Analytics and Intelligence

| Target | Current evidence | Decision |
|---|---|---|
| UX-110 Analytics Workspace | `AnalyticsDashboard`, `RevenueIntelligenceDashboard`, `OperationsPanel`, ROI/QBR | **MERGE** into role-aware analytics workspace |
| UX-111 KPI / Metric Detail | summary KPI cards exist; canonical detail absent | **BUILD NEW** |
| UX-112 Insight Detail | Cortex insights exist but not one reusable evidence/confidence pattern | **MERGE/MODIFY** |
| UX-113 Forecast / Scenario | `ScenarioPanel`, DCF/Monte Carlo/financial modeling | **KEEP + MODIFY** |
| UX-114 Outcome Dashboard | ROI actuals/QBR/strategy fragments | **MERGE** into outcomes/value view |

The standalone `Revenue Intelligence` destination should become a contextual Growth/Executive/Analytics perspective rather than a permanent subsystem in primary navigation.

---

## 13. Organization, Administration, Security, Governance

| Target | Current evidence | Decision |
|---|---|---|
| UX-120 Organization | `OrganizationSpine`, workspace identity | **MODIFY** |
| UX-121 People / Membership | `TeamManagement` | **MODIFY/MERGE** |
| UX-122 Roles | team roles exist but no reusable role-management surface | **BUILD NEW** |
| UX-123 Permissions | partial RBAC/admin concepts, no complete granular UI | **BUILD NEW** |
| UX-124 Authority Envelopes | AI runtime/approval concepts exist technically | **BUILD NEW** |
| UX-125 Policies | no product policy-management surface | **BUILD NEW** |
| UX-126 Budgets & Limits | AI budget/spend admin exists; organization/resource budgets do not | **MERGE + BUILD NEW** |
| UX-127 Integrations | `CRMSyncPanel`, provider credentials, booking/email integrations are scattered | **MERGE** into integration registry |
| UX-128 Integration Detail | provider-specific panels exist | **MODIFY** into contract/permission/status/audit model |
| UX-129 AI Providers / Models | `AIAdministrationConsole`, `ProviderAdministrationPanel`, `RoutingPanel` | **KEEP + MODIFY** as admin-only provider-neutral surface |
| UX-130 Audit Trail | AI admin audit only / local histories | **BUILD NEW unified audit**, reusing audit services |
| UX-131 Security Center | no canonical product surface | **BUILD NEW** |
| UX-132 Privacy / Data Controls | no complete retention/export/correction/deletion UI | **BUILD NEW** |
| UX-133 Billing / Entitlements | absent | **BUILD NEW when backend capability exists** |
| UX-134 Platform Settings | `SettingsPage` | **KEEP + MODIFY** |
| UX-135 Feature / Capability Controls | configuration/flags exist technically but no governed target surface | **BUILD NEW admin surface** |

### Organization component decisions

- `OrganizationSpine` — **KEEP/MODIFY**, expand relationships and edit flows only when services/permissions support them.
- `TeamManagement` — **MERGE** into People/Membership; avoid separate “Team admin” mental model.
- `OrganizationProviderCredentialsPanel` — **MERGE** into Integrations / AI provider configuration.
- `SettingsPage` — **KEEP/MODIFY**, remove responsibilities that move to dedicated Administration surfaces.

---

## 14. Component System and Visual Foundation

### KEEP

Preserve the existing reusable primitive library (`src/app/components/ui/*`) and Cortex primitives under `ui/cortex/*` where they meet accessibility and behavior requirements.

Useful existing primitives include:

- buttons/forms/inputs/selects/tables/tabs/dialogs/drawers/popovers;
- breadcrumb/navigation primitives;
- charts;
- accessibility-aware modal/dialog behavior;
- `PageHeader`, `Surface`, `StatusBadge`, `Field`, feedback/loading states;
- skeleton/loading/error components.

### MODIFY

- token system is still partial; continue eliminating hard-coded visual values;
- unify entity headers, evidence, approval, audit, timeline, priority, memory, agent and relationship components around the target reusable component contracts;
- keep animation meaningful and calm;
- preserve keyboard, focus, reduced-motion and touch accessibility already added to the shell.

### BUILD NEW reusable primitives

Highest-priority missing target components:

`WorkspaceShell · AttentionItem · ExecutiveBriefing · EntityHeader · EntityRelationshipPanel · EntityTimeline · EvidencePanel · DecisionDetail · ApprovalPanel · GoalProgress · WorkQueue · WorkflowProgress · AgentCard · AgentRunTimeline · AuthorityEnvelopeViewer · MemoryCard · CustomerHealthSummary · OutreachTimeline · AuditTimeline · PolicyGuard states`

---

## 15. Existing UI That Must Not Define the New Product

### REMOVE / retire after replacement is verified

1. `ReviewerDashboard` current implementation — demo-only fabricated review queue.
2. `Mapping Engine` as primary navigation destination — retain deterministic capability, remove standalone business destination.
3. `Architecture` and `Registry` as ordinary product destinations — retain only as restricted developer/admin utilities if still useful.
4. localStorage-only nurture queue as authoritative product behavior — replace with governed shared sequence/outreach runtime.
5. duplicate/legacy dashboards or panels that become unreachable after workspace migration — delete in the same change set once reference search and tests prove they are unused.

### Do not delete yet

The following contain reusable capability and should survive until their target replacements are working:

- diagnostic/score/Cortex detail;
- ROI and financial modeling;
- proposal/contract/export/snapshot;
- execution and QBR;
- client portal/messaging/booking;
- pipeline/revenue/analytics;
- organization/strategy;
- AI administration/provider/routing/runtime panels;
- notifications/command palette/global AI shell;
- reusable UI primitives.

---

## 16. Target Navigation Migration

### Current

```text
Work
  Dashboard
  Reviewer QA
  Email Queue
Understand
  CORTEX
  Analytics
  Revenue Intelligence
  Strategy
Deliver
  Execution
  Mapping Engine
Operate
  AI Control Plane
  Operations
Administer
  Organization
  Settings
Platform
  Architecture
```

### Target

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

Migration rules:

- old destination IDs may remain temporarily as route aliases while the new structure is introduced;
- bookmarks must resolve or redirect intentionally — never silently fall back to Dashboard;
- technical panels become subviews of Administration/AI Workforce, not permanent top-level destinations;
- domain details are reached through workspaces, search, entities and relationships;
- avoid a sidebar entry for every department;
- command palette and sidebar continue to derive from one navigation model.

---

## 17. Recommended UI Implementation Order

This order minimizes destructive rewrites and creates the target mental model early.

### UI-0 — Preserve and protect

- freeze known-good diagnostic/commercial behavior;
- keep capability truth checks;
- keep accessibility/navigation contracts;
- no mass component deletion.

### UI-1 — Target shell and navigation

- convert `TeamDashboardLayout` into target AppShell;
- install target top-level navigation;
- preserve command palette, responsive drawer and route recoverability;
- demote dev/system destinations.

### UI-2 — Command Center + Attention Required + My Work

This gives users the new Cortex mental model immediately.

### UI-3 — Organization + Goals + Decisions

Use `OrganizationSpine`, `TeamManagement` and `StrategySurface` as seeds rather than rebuilding those foundations.

### UI-4 — AI Workforce

Turn existing control-plane/runtime capability into organizational workforce UX; keep provider/routing detail in Administration.

### UI-5 — Customers & Growth

Unify leads, pipeline, engagement, nurture, revenue, prospecting, outreach and Sales Agent activity.

### UI-6 — Knowledge + Graph + Memory

Build the missing organizational-intelligence surface and reusable relationship/evidence patterns.

### UI-7 — Re-home diagnostic/delivery lifecycle

Keep the existing strong functionality, but present it through canonical Lead/Customer/Project/Outcome entities and workspaces.

### UI-8 — Administration + Security + Privacy

Consolidate settings, providers, integrations, permissions, policies, audit, privacy and security under governed admin experiences.

### UI-9 — Final cleanup

- remove old route aliases when migration is complete;
- delete obsolete dashboard/panel code after usage search + tests;
- delete temporary migration docs;
- regenerate architecture/current-state maps;
- verify no duplicate navigation or entity realities remain.

---

## 18. Claude / Codex Handoff Rule

The codebase is **not ready for an unrestricted “redesign Cortex” prompt**.

It is ready for implementation **only through build packets** created from this map and the UI Implementation Specification.

Every packet must name:

- target UX IDs;
- current components to KEEP/MODIFY/MERGE/REMOVE;
- APIs/services already available;
- missing backend dependency;
- permissions/authority rules;
- required states;
- responsive/accessibility requirements;
- tests that protect existing behavior;
- files that become obsolete after the packet is verified.

Claude/Codex must not invent new navigation, entities, agent authority, data sources or product scope during implementation.

---

## 19. Final Reconciliation Summary

### KEEP

The strongest reusable assets are the public diagnostic flow, deterministic-value UI, proposal/contract/snapshot/export surfaces, QBR/ROI actuals, pipeline, client portal, command palette mechanics, responsive/accessibility work, organization spine, strategy records, analytics foundations, AI admin/runtime foundations and reusable UI primitives.

### MODIFY

The global shell, navigation, search, notifications, settings, organization, goals/decisions/risks, analytics, pipeline, diagnostics, client experience and most existing domain panels need to be expressed through the target workspace/entity model.

### MERGE

The largest consolidation targets are:

- `TeamHomeDashboard + Strategy + Operations + Analytics/Revenue` → **Command Center / Executive Workspace**;
- `GlobalAIChat + CortexChat + AIAssistant + Copilot` → **Ask Cortex / domain-aware AI participant**;
- `AIAdministrationConsole + agent/workflow runtime` → **AI Workforce + Administration**;
- pipeline/revenue/email/engagement/CRM fragments → **Customers & Growth**;
- organization/team/strategy fragments → **Organization + My Work + Goals/Decisions**;
- existing evidence/history/engagement fragments → reusable **Entity Timeline / Evidence / Audit** patterns.

### REMOVE

Remove demo-only or structurally misleading product surfaces after verified replacement, especially Reviewer QA demo behavior, Mapping Engine as a business destination, and developer architecture/registry from ordinary product navigation.

### BUILD NEW

The major genuinely new UI families are:

- guided org onboarding;
- Command Center as organization-wide operating brief;
- Attention Required;
- reusable Executive/Department/Team/Personal workspaces;
- full AI Workforce organization/agent/team/authority/memory/performance UX;
- prospect discovery + governed multi-channel outreach;
- Customer 360 / Customer Success;
- generic goals/initiatives/projects/work/decision details;
- Knowledge Workspace + organizational graph + memory;
- unified audit/security/privacy/policy/permission surfaces.

The build should therefore **evolve the strong existing foundation into the target product**, not discard it and not preserve its old information architecture.

> **Target outcome:** one coherent organizational operating system where users see what matters, what Cortex and its workforce are doing, what changed, what requires human authority, and what should happen next — while the existing diagnostic, financial, proposal, execution and AI foundations continue to provide real capability underneath.