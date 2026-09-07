# MARQ Cortex — UI Implementation Map

Audit of the shipped Cortex UI against the canonical **MARQ Cortex Product
Experience**, with the implementation sequence that follows from it.

Canonical authority for this map: Product Experience Ch. 9 (Core Experience
Principles), Ch. 20 (Information Hierarchy), Ch. 21 (Navigation Architecture),
Ch. 22 (Workspace Architecture), Ch. 31 (Operational Awareness).

Status legend: **GAP** (canon requires it, nothing exists) · **DEFECT**
(exists but contradicts canon) · **PARTIAL** · **OK** · **DEFERRED**.

---

## The governing finding

Cortex has, at the time of this audit, **built far more product than it has
made reachable**. AI-01 Batches 1–4F delivered a ten-tab AI Control Plane —
providers, routing, agents, workflows, budget, usage, audit, diagnostics — and
the whole of it is reachable only at:

```
Sidebar → Settings → AI tab → one of ten sub-tabs
```

Provider administration, the routing console, the agent runtime and the
workflow operator surface are, to a user of the running product, **invisible**.
Ch. 21.5 (predictability) and Ch. 20 (hierarchy follows importance) are both
contradicted by placing the platform's central governance surface three levels
below a preferences page.

This is the single highest-value UI correction available, it depends on no
deployment, and it is therefore Sprint 1.

---

## 1. Application shell

| Area | Status | Finding |
|---|---|---|
| Two-layer layout (`TeamDashboardLayout` → `DashboardLayoutInner`) | OK | Provider mount is correctly separated from consumers. |
| Persistent sidebar + header + breadcrumbs | OK | Ch. 21.12 orientation is served. |
| Sidebar collapse | OK | Width animates 280 ↔ 80. |
| Collapsed-mode labelling | DONE (Sprint 1) | At 80px only the icon renders, with no `title`/`aria-label`. The collapsed sidebar is unusable to a screen reader and unlabelled on hover. |
| Route/page duality | PARTIAL | `#/team/dashboard` holds eleven pages in `useState`, so no in-app destination is linkable, bookmarkable, or restorable by URL. Ch. 21.11 (recoverability) wants recent locations and history; today a refresh returns to `dashboard`. |

## 2. Navigation

| Area | Status | Finding |
|---|---|---|
| Intent-first grouping (Ch. 21.2) | DONE (Sprint 1) | Eleven flat sidebar items mixing intents: `Dashboard, CORTEX, Analytics, Rev Intel, Execution, Mapping Engine, Reviewer QA, Email Queue, Team, Settings, Architecture`. Exposes software structure, which 21.2 names as the failure mode. |
| AI Control Plane reachable | DONE | Sprint 1 — first-class destination under Operate, Cmd+3. |
| One canonical nav model (Ch. 21.4, 21.10) | DONE (Sprint 1) | The sidebar declares eleven destinations; the command palette declares **four** (`dashboard, cortex, team, settings`). Two navigation surfaces, two different realities — precisely the "duplicate realities" 21.4 forbids. |
| Command palette as intent layer (Ch. 21.7) | DONE (Sprint 1) | Exists, is good, but covers 4/11 destinations. |
| Operational health / KPI surfaces | DONE | Sprint 2 — the G5 reads now have a consumer. |
| BYOK / org credentials | PARTIAL | `OrganizationProviderCredentialsPanel` exists, reachable only as a Settings tab. |

## 3. Dashboard

| Area | Status | Finding |
|---|---|---|
| `TeamHomeDashboard` | OK | Present and lazy-loaded. |
| Priority-first framing (Ch. 21.2 "I need today's priorities") | DONE (Sprint 3) | The inbox exists and leads the middle row. Two defects repaired: the row action was hover-only (unreachable on touch, unfocusable by keyboard), and the header counted the truncated list rather than the backlog. |

## 4. Organization / customer areas

| Area | Status | Finding |
|---|---|---|
| Client portal | DEFERRED | The auth cluster is deferred pending live verification. No UI change may touch it. |
| Submissions list | OK | Status vocabulary repaired this session. |

## 5. AI / provider administration

| Area | Status | Finding |
|---|---|---|
| `AIAdministrationConsole` (10 tabs) | OK, unreachable | Complete; needs a first-class home. |
| Server-side authority | OK | The console resolves the operator's role server-side and renders an explicit unauthorized state. No client-side role guess. **Preserve exactly.** |

## 6. Routing / economics

| Area | Status | Finding |
|---|---|---|
| Routing console (Batch 4F) | OK, unreachable | A tab of a tab. |
| Budget / usage / spend | OK, unreachable | Same. |

## 7. Agents / workflows

| Area | Status | Finding |
|---|---|---|
| Agent runtime surface | OK, unreachable | Same. |
| Workflow operator surface | OK, unreachable | Same. `workflowOperatorSurface.test.ts` pins the console↔route seam; **do not weaken.** |

## 8. Intelligence views

| Area | Status | Finding |
|---|---|---|
| CORTEX dashboard sections | OK | AI toolbar lead context repaired this session. |
| Revenue intelligence, analytics | OK | Reachable. |

## 9. Operational health

| Area | Status | Finding |
|---|---|---|
| Enterprise health rollup | DONE | Sprint 2 — `OperationsPanel`, reachable under Operate. |
| Enterprise KPIs | DONE | Sprint 2 — same panel. |
| Settings "Platform Health" tab | PARTIAL | Serves submission counts only, not the four approved health dimensions. |

## 10. Settings / admin

| Area | Status | Finding |
|---|---|---|
| Settings tabs | OK | Profile, Notifications, Platform, Health, AI, BYOK. |
| Demo fixtures | FIXED | Repaired this session; they described a different settings product than the one served. |

## 11–15. Onboarding · empty · loading · error · success states

| Area | Status | Finding |
|---|---|---|
| Route loading | OK | `RouteLoader` + `PanelSkeleton`. |
| Route errors | OK | `RouteErrorFallback` per route. |
| Progress modal | FIXED | Never rendered before this session — `isOpen` was never passed. |
| Empty states | DONE (Sprint 5) | The defect was not absence but conflation: four panels rendered one filter-blaming message for both "nothing exists yet" and "nothing matches". Now two components, `EmptyState` and `NoResultsState`. |
| Onboarding | GAP | No first-run experience. Sprint 4+. |

## 16. Responsive behaviour

| Area | Status | Finding |
|---|---|---|
| Mobile sidebar | DONE (Sprint 4) | The shell had **zero** breakpoints: a fixed 280px sidebar beside the content left 95px on a 375px phone. Below 1024px the same `<nav>` is now an overlay drawer. Verified in Chromium at 1440/820/375. |

## 17. Design system

| Area | Status | Finding |
|---|---|---|
| Tokens | PARTIAL | `designTokens.ts` exists; colours are also hard-coded inline across components. |
| Icon contracts | OK | Pinned by `frontendIconContracts.test.ts`. |

## 18. Obsolete screens / components

| Area | Status | Finding |
|---|---|---|
| `DiagnosticForm` select branch | REMOVED | Unreachable, contradicted canon. |
| `architecture` / `registry` | OK, dev utilities | Keep, but they are not product destinations and should not sit beside product ones in the primary nav. |

---

## Implementation sequence

Ordered by canonical dependency, not by size. Each sprint runs
DISCOVER → COMPARE → IMPLEMENT → CONNECT → TEST → BUILD → QA → COMMIT.

**Sprint 1 — Navigation as one canonical model. DONE.**
One navigation module both the sidebar and the command palette read, grouped by
intent, with the AI Control Plane promoted to a first-class destination and
every destination reachable from the palette. Closes the governing finding.

**Sprint 2 — Operational awareness surface. DONE.**
A destination for the shipped `/health/enterprise` and `/kpis` reads. Ch. 31.
Honours G5's discipline: an unreadable signal is `unknown`, and `unknown` never
rolls up as healthy.

**Sprint 3 — Dashboard as priorities. DONE.** Ch. 21.2.

**Sprint 4 — Responsive shell. DONE.** Ch. 21.10.

**Sprint 5 — Empty states. DONE.** Ch. 9.

**Sprint 6 — Onboarding, design tokens, route/page duality.** NEXT. The
remaining rows: no first-run experience (Ch. 9, Ch. 21.12); colours hard-coded
inline across components while `designTokens.ts` exists; and eleven pages held
in `useState` under one URL, so no in-app destination is linkable or restorable
(Ch. 21.11 recoverability).

Deferred and explicitly out of scope for all sprints: the ClientPortal auth
cluster, MCV2-S7.5, production backfills, G1/G2 and S8.1–S8.3 deployment
actions, G6 credential-dependent work, and the 4E rollout.
