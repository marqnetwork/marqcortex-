# MARQ Cortex — Autonomous Build Progress

**This file is the RESUME AUTHORITY for autonomous development.** The repository
and this checkpoint override any baseline stated in a session prompt. Read it,
verify against the repository, and resume from **NEXT EXACT TASK**.

Companion authorities, unchanged by this file:

- `MARQ_CORTEX_ROADMAP.md` — sprint and batch status.
- `architecture/ai/AI-01-BATCH-*-COMPLETION.md` and
  `architecture/database/MCV2-*-COMPLETION.md` — what each unit delivered.
- `ARCHITECT.md` — the current architecture of record.

---

## CURRENT ROADMAP STAGE

**PRODUCT/UI IMPLEMENTATION — UI Sprints 1-7, reconciled onto one branch.**

The documented AI-01 batch sequence ends at 4F and 4F is merged (PR #45,
`04bdfba`). There is no Batch 5. The buildable stage is the product/UI surface,
against `MARQ_CORTEX_PRODUCT_EXPERIENCE.md` — tracked in
`docs/development/UI_IMPLEMENTATION_MAP.md`, which is the audit of the shipped
UI against canon plus the sprint sequence.

Phase 6 — AI Platform: AI-01 Batch 4 complete through 4F. **Merged to `main`**
(PR #45), together with every backend unit from the previous session.
Phase 4 — Runtime Storage Gateway: shadow read delivered for both domains that
have runtime reads; Phase 2 backfill and reconciliation delivered for every KV
namespace that holds stored data.
Gap register G5 — enterprise performance instrumentation: closed for the two
sections the blueprint makes buildable.

## CURRENT BATCH

None in flight.

### THE ONE CURRENT UI DEVELOPMENT BRANCH

> **`claude/marq-cortex-ui-continuity-q1iiy3`** — and no other.
>
> UI Sprints 1-6 and UI Sprint 7 were built on two branches that were both cut
> from `main` and never from each other. Neither contained the other's work.
> They are now integrated on the branch above, which is the only branch UI work
> continues on. The two source branches are preserved, unmodified, as history:
>
> | Branch | Cut from | Commits | Status |
> |---|---|---|---|
> | `claude/marq-cortex-product-complete-5d8hyz` | `04bdfba` (`main`) | 10 | superseded — integrated, kept for provenance |
> | `claude/marq-cortex-ui-sprint-7-11jp3g` | `04bdfba` (`main`) | 20 | superseded — integrated, kept for provenance |
>
> See **BRANCH CONTINUITY** below for the ancestry evidence and what the
> integration had to reconcile.

UI Sprints 1-7 are delivered. Sprints 1-6 made the product reachable — one
navigation model, the AI Control Plane and Operations as first-class
destinations, a responsive shell, honest empty states and URL-addressable
destinations. Sprint 7 made it legible — one visual vocabulary, an onboarding
the console derives rather than stores, and an accessibility sweep of every
route.

**The whole application has now been driven in a browser.** Every route — the
four public funnel routes, the eight client-portal tabs, the console pages, the
CORTEX overview and lead detail, the architecture and registry tools, and the
404 — reports zero unnamed buttons and zero unlabelled inputs, and each has
exactly one `h1`. Every `fixed inset-0` overlay in `src/app/components` either
declares itself a dialog or says what it is instead.

## COMPLETED — PRIOR SESSION (Batch 4F, merged as PR #45)

## COMPLETED THIS SESSION — UI SPRINT 7

### 1. The team role the server had already resolved

`POST /auth/team/login` has returned `user.teamRole` since `resolveTeamAuthority`
existed. The console threw it away twice: `api.ts` declared the response user as
`{id, email, name}`, and `session.ts`'s `normaliseTeamUser` rebuilt the object
from exactly those three fields. The role reached no component, so a console with
every reason to offer a role-appropriate experience had nothing to base one on.

Three narrower faults beside it: `TeamMemberRecord.teamRole` declared THREE roles
where the server issues SIX, so `analyst`, `consultant` and `owner` were each
displayed to their own team as a read-only "Viewer"; the role dropdowns offered
every role to everybody, so a reviewer was invited to promote somebody to admin
and got a 403 for it; and `TeamLogin` re-implemented the demo branch inline and
signed in with no identity at all, so demo sessions greeted "Team".

`src/app/lib/teamRole.ts` mirrors the server's vocabulary and
`tests/features/teamRoleVocabulary.test.ts` reads `teamAuthorization.ts` and
fails if they disagree — on the roles, on their ORDER (the order is the privilege
rank), or on which of them administer the team.

**This is not authorization and does not pretend to be.** Every rule is enforced
server-side against `app_metadata.team_role`, which a signed-in caller cannot
write. The mirror decides only what the console SHOWS, and fails closed to
`viewer`.

### 2. An orientation the console can derive

`src/app/core/orientation.ts` — pure, no React, no storage, no data of its own.
Every answer is a function of state the application already holds. There is
deliberately no stored onboarding progress: a step is done because the workspace
shows it is done, so it cannot drift from reality, cannot be completed by
dismissing it, and reads correctly on any device.

Three distinctions it insists on: **loading is not empty**, **unknown is not done
and not outstanding**, and **exactly one next action, or none**.

Wired into the shell that gives grouped navigation (by the work it serves, not by
the codebase — §13.1 names the latter an anti-pattern, as it does exposing
internal architecture), the real signed-in member in place of the literal "Team
User / team@example.com / TU", a compact overlay drawer below `lg`, a skip link
and landmarks and `aria-current`, and **recovery from a refresh** —
`readInitialPage` read the stored page and DELETED it in the same breath, so a
browser refresh always dropped the user back on the dashboard mid-task.

The command palette now generates its navigation from the same model: all eleven
pages are reachable by name where four were before.

### 3. The design-token layer

The console carried **5,311 hard-coded hex literals across 98 components**, and
the inconsistency was semantic. Three panel fills (`bg-black/40`, `/30`, `/20`)
were interchangeable for the same container, so depth meant nothing; four
hairline borders sat on one screen; "muted text" was three different values.

`src/styles/tokens.css` names the vocabulary once and `@theme inline` makes each
a Tailwind utility; `src/app/lib/tokens.ts` mirrors it for the thousands of
inline styles and chart props that cannot read a custom property — that absence
is why the literals accumulated. `designTokens.test.ts` parses both and fails on
any drift.

**Not a redesign.** Every value is one the product already renders, chosen as the
dominant use for that role. Converging a component changes nothing visible.

`components/ui/cortex/` adds Surface, PageHeader, Field, StatusBadge and the
three feedback states, all built on the tokens, alongside (not replacing) the
vendored shadcn controls.

### 4. The four states, and two defects found while verifying them

**Loading was rendered as zero.** The home dashboard drew its full KPI grid while
the first fetch was in flight, so a busy workspace was told it had nothing, in
the same typeface as real data. **A failed load was drawn as an empty
workspace.** **An empty organization got the same screen as a busy one.** All
three now differ, and the empty one leads with orientation.

Found in the browser during that verification:

- **The notification bell could take down the whole console.** `getNotifications`
  returns `data as {...}` — an assertion, not a check — so a 200 without the field
  wrote `undefined` into array state and the next render threw. The bell is in the
  shell header on EVERY page, so one malformed response replaced the entire
  application with the route error boundary. Six components had the identical
  shape; `src/app/lib/payload.ts` now narrows all seven.
- **The seven-day trend was partly invented.** `buildTrendData` padded empty days
  with fabricated counts, commented "so empty days have plausible data". Team
  Pulse likewise showed the seeded roster in every mode.

### 5. Settings, and the accessible names

**Two copies of a shape the server does not use.** `SettingsPage` carried the same
fallback twice, both written against an older `PlatformSettings` — `companyName`,
`companyEmail`, `emailNotifications` — with the four fields the page renders
absent. `NotificationSettings` spreads `settings.notificationPrefs`; spreading
`undefined` yields `{}`, so every toggle rendered OFF regardless of the real
configuration and Save wrote that empty object back. **A failed load also
substituted that object into live form controls**, one click from persisting
values that were never the user's.

**A browser sweep of seven pages** found unnamed controls on five: `<label>`
elements with no `htmlFor` (settings profile, five revenue filters), search boxes
labelled only by a placeholder (CORTEX, review queue), unnamed icon-only refresh
buttons (team roster, CORTEX), and toggles whose entire state was a background
colour. All fixed; re-swept clean.

### 6. What the browser verification kept finding

The pattern that produced the most value this session was driving the running
app in Chromium and asking the DOM a specific question, then fixing what it
answered. Four of the session's defects were found that way and would not have
been found by reading the source:

**A whole family of fallbacks answered a failed request with invented business
data.** Six panels caught a failed live request and, whenever `SHOW_API_ERRORS`
was off — the default — substituted seeded data rather than reporting the
failure. The worst was the CLIENT PORTAL, where the reader is the customer:
`getDemoClientSubmission` takes the client's real company name and email as
overrides and fills everything else from a seeded profile, including the
diagnostic ANSWERS, and `generateClientReport` derives the readiness score,
findings and recommendations from those. On any transient failure a client read
a report that was never derived from their diagnostic, under their own company
name, with nothing to say so. The analytics panel was the worst-behaved of the
rest — its substitution sat OUTSIDE the flag check, so with errors enabled it
rendered the banner AND fabricated charts beneath it, captioned "showing
computed data from submissions".

**One status meant two colours.** `completed` was cyan on three surfaces and
blue on the analytics panel; `low` priority was grey on one and cyan on another;
and `SubmissionsListPage.getStatusColor` had no `approved` case at all, so an
approved submission rendered in the neutral "unrecognised" grey on the page
whose own Approve button produces that status.

**The command palette could not be closed with the keyboard.**
`useKeyboardShortcuts` skipped shortcuts originating in an input — right for a
bare `d`, wrong for Escape — and the palette focuses its search box on open. A
⌘K feature had no keyboard exit.

**No dialog said it was one.** Eighteen hand-rolled overlays, none declaring
`role="dialog"` or `aria-modal`, so Tab walked out of every one of them into the
content behind.

Alongside those, accessible names were missing across seven console pages and
the whole public funnel — including the four fields of the lead capture form
that opens the acquisition journey, and every answer control in the fourteen
question diagnostic, where the question sat in a heading the control was not
connected to.

## COMMITS — PRIOR SESSION

On `claude/marq-cortex-ui-sprint-7-11jp3g`, from `04bdfba`:

1. `feat(session): carry the role the server already resolved, instead of eating it`
2. `feat(console): an orientation the console can derive, and a shell that survives a refresh`
3. `feat(ui): one visual vocabulary, and four states every surface now tells the truth about`
4. `fix(console): a 200 that arrives without its payload must not take down a panel`
5. `fix(settings): a failed load is not a form, and a toggle is not a coloured rectangle`
6. `fix(a11y): name the controls the console left unnamed`
7. `docs: checkpoint UI Sprint 7 — what was built, what was found, and what is next`
8. `fix(portal): a client must never be shown a report that is not theirs`
9. `fix(console): stop answering a failed request with invented business data`
10. `fix(ui): one status, one colour — the console disagreed with itself in three places`
11. `fix(funnel): name the lead capture fields, and stop the landing page scrolling sideways`
12. `fix(diagnostic): a screen-reader user was being asked fourteen questions they could not hear`
13. `fix(a11y): the command palette could not be closed with the keyboard, and no dialog said it was one`
14. `docs: checkpoint the full Sprint 7 run, and what the browser kept finding`
15. `fix(a11y): the execution dashboard had no headings at all`
16. `fix(a11y): the overlays that interrupt a user were the ones with no way out`
17. `fix(a11y): every overlay in the app now says what it is`
18. `fix(a11y): the client's only way to reach the team was an unnamed box`
19. `fix(a11y): finish the sweep — every route in the app is clean`

## TEST RESULTS — PRIOR SESSION

Every suite run at the end of the session. No test was weakened, skipped or
deleted, and no backend suite regressed — this sprint touched the browser bundle
only, and the backend suites confirm it.

| Suite | Result |
|---|---|
| `npm run test:ai` | 2,183 pass |
| `npm run test:security` | 859 pass |
| `npm run test:features` | **1,008 pass** (774 at session start) |
| `npm run test:system` | 170 pass |
| `npm run test:migration` | 210 pass |
| `npm run test:lifecycle` | 241 pass |
| `npm run verify:health` | 48 pass |
| `npm run scan:boundaries` | 107 pass |
| `npm run test:database` | pass, 1 skipped without `DATABASE_URL` |
| `npm run typecheck:web` | **32 errors — two BELOW the 34 baseline** |
| `npm run typecheck:tests` | 27 errors — identical to baseline |
| `npm run build` | clean |

The two recovered `typecheck:web` errors are the `SettingsPage` `companyName`
pair, and they are gone because the defect behind them is fixed, not suppressed.

**Eleven test files added**: `teamRoleVocabulary`, `orientation`,
`designTokens`, `consoleSurfaces`, `payloadNarrowing`, `consoleAccessibility`,
`clientPortalIntegrity`, `failureIsNotData`, `statusColorConsistency`,
`publicFunnelAccess`, `dialogSemantics`.

**Three existing assertions were updated rather than deleted**, each with the
reason recorded in place: `breadcrumbContract` (eight label literals that were
incidental evidence for an older type-only change and had already drifted from
the sidebar's), `teamSessionKeys` (the exact `useApp()` destructuring, and the
pre-`teamRole` session shape), and `frontendIconContracts` (an icon that gained
`aria-hidden` — the guarantee it was written for, that both `className` and
`style` survive, is unchanged and still enforced).

**No server file was touched.** `git diff --name-only main..HEAD` reaches
`src/`, `tests/` and `docs/` only, and every backend suite confirms it.

**Three assertions I wrote were wrong on first run and were corrected rather
than loosened**: one expected `normalizeTeamRole` not to trim (it does, and the
server's does too), one matched a function DECLARATION where it meant the call,
and one flagged a demo-mode branch's own seed construction, which is what demo
mode is.

## BROWSER VERIFICATION

Chromium via the pre-installed Playwright (`/opt/pw-browsers/chromium`), against
the dev server, at 1440px, 768px and 390px, in demo mode and against a stubbed
backend that could be made to fail on demand. This is where four of the
session's defects were found; it is worth repeating next session.

- **The shell.** Real identity in the sidebar; navigation grouped with the
  system group folded; `aria-current` on the active entry; the skip link
  present; a reload landing back on Analytics rather than the dashboard; the
  drawer opening from the header and closing on Escape, and not rendered at all
  when closed.
- **The four states.** Loading announced with the KPI grid absent; the empty
  workspace leading with orientation and naming the signed-in member, with
  exactly one next action; the failed load raising an alert and presenting no
  zeros. On the team, analytics and engagement panels, a stubbed 503 produces
  the alert and no seeded content, and the success paths were re-checked after.
- **The client portal.** A stubbed 503 on the submission fetch shows "Your
  report could not be loaded" with an alert role and leaks no part of the seeded
  profile. Demo mode still signs in and renders the full journey.
- **Accessible names.** Zero unnamed buttons and zero unlabelled inputs across
  seven console pages, the client portal, and all four funnel routes.
- **The diagnostic.** The answer field on question one is announced as the
  question's own text, and on question two as that question's; the progressbar
  reports 1 of 14 and 2 of 14.
- **Dialogs.** The invite dialog is named, focus moves in, the body scroll
  locks, focus does not escape across 25 consecutive Tab presses, Escape closes
  it, the scroll is restored to what it was, and focus returns to the button
  that opened it. The command palette now closes on Escape.
- **Layout.** No horizontal overflow on the landing page at 390, 768 or 1440
  after scrolling the full page so every `whileInView` section fires. The
  console reflows to two columns at 390px with no overflow on any panel.
- **No page errors anywhere** after the notification-centre fix.

## A DATABASE IS AVAILABLE IN THIS ENVIRONMENT

PostgreSQL 16 is installed but not started at session start. To use it:

```
service postgresql start
su postgres -c "psql -c \"CREATE ROLE root SUPERUSER LOGIN PASSWORD 'harness'\""
su postgres -c "psql -c 'CREATE DATABASE root OWNER root'"
export DATABASE_URL="postgresql://root:harness@localhost:5432/root"
```

Every `test:database:*` harness then runs for real.

## NOTES FOR THE NEXT SESSION

- **A pure module imported by a Node test may not use the `@/` alias for a
  RUNTIME import.** `--experimental-strip-types` resolves no Vite alias; a
  type-only alias import is erased and works, a value import is not. Use a
  relative specifier with an explicit `.ts` extension — both tsconfigs set
  `allowImportingTsExtensions`. `session.ts` and `core/orientation.ts` do this
  and say why in place.
- **The design tokens are adopted in the shells, not yet across the product.**
  The layer, the utilities, the primitives and the drift test exist, and the
  console shell, the home dashboard's palette, the settings and team feedback
  states are converged. The remaining ~5,000 literals are a per-surface
  migration, safe to do incrementally now that there is a vocabulary to migrate
  to. This is deliberate: a mass search-and-replace across 98 components is a
  visual regression risk with no test able to catch it.

## KNOWN NON-BLOCKING ISSUES

- 32 pre-existing `typecheck:web` and 27 pre-existing `typecheck:tests` errors,
  all in files unrelated to this session's work (proposal viewer, snapshot
  engine, mapping engine, mock data, workflow expression validation).
- The `server` deno boundary could not be type-checked at all this session:
  **Deno is not installed in this environment**, so `typecheck:api:ai` and
  `typecheck:api:pure` print an install hint and exit rather than running. The
  previous session had them checking clean. This is not a regression and
  nothing here could have caused one — no server file was touched.
- **`src/app/components/DiagnosticQuestion.tsx` is dead code.** Nothing imports
  or renders it, its question text is hard-coded as a design mockup, and it is
  the source of one of the standing `typecheck:web` errors. The real form is
  `DiagnosticForm.tsx`. Deleting it is a separate, small decision.
- **The workspace's own name cannot be shown in the shell yet.** It lives in
  `platformSettings.brandingName`, behind `GET /settings` — a route that also
  scans every submission via `kv.getByPrefix('sub:')` to compute health counts.
  Calling that from the shell on every page load to render a name in the sidebar
  is not worth it. Surfacing organization context needs either a light
  `GET /workspace` or the settings route split. **Recorded, not worked around.**

## NEXT EXACT TASK

**1. Finish the dialog migration.** Thirteen hand-rolled overlays remain, all in
panels off the canonical journeys, and each is announced as nothing and lets Tab
walk out of it. `components/ui/cortex/Modal.tsx` exists and two dialogs are
migrated, so each remaining one is small and reviewable. `dialogSemantics.test.ts`
shows the shape. Dependency-safe.

**2. Continue the token migration surface by surface.** The vocabulary, the
Tailwind utilities, the primitives and the drift test exist; the shells, the
feedback states and the status vocabulary are converged. Roughly five thousand
literals remain, and each surface is small and expected to change nothing
visible. Start with surfaces a canonical journey passes through. Deliberately
NOT a mass search-and-replace: that is a visual regression no test could catch.

**3. Sweep the remaining panels the way the console and funnel were swept.**
Reviewer QA, the email queue, the execution dashboard, the proposal viewer and
the CORTEX module panels have not been driven in a browser. The four questions
that found everything this session: which controls have no accessible name;
what does a failed load render; what does an empty state render; does the
document scroll sideways at 390px.

**4. A merge decision on this branch.** Thirteen commits, no PR opened — the
session prompt did not authorise one.

**5. G4 — the AI Workforce runtime. STOP CONDITION, not an oversight.** §IV-24
fixes twelve worker categories and §IV-25 eight lifecycle stages, and both say
plainly that the implementation is "deferred to later Phase 4.x". The buildable
shape would be a workforce registry and lifecycle state machine starting empty,
exactly as Batch 3A did for agents — but that is a SECOND registry beside the
agent runtime, and whether Cortex realizes the workforce layer now, and as its
own registry rather than as a facet of the agent one, is a sequencing and
architecture decision the canon explicitly defers to a human. Scope it
deliberately with a person; do not begin it at the end of a session.

**6. G6 — external integrations** (CRM sync, e-sign, scheduling). Needs
third-party credentials and accounts. Blocked.

**7. G1/G2 — data authority and enforced tenancy.** The instrument and the
backfills exist; running them and cutting over is a deployment action.

**8. Blueprint corrections a human should confirm.** The gap register still
describes G3 as "gateway is live single-provider"; AI-01 Batches 1 through 4F
have not been true of that for a long time. G5 should move from NOT IMPLEMENTED
to PARTIAL.

## BLOCKERS

- **MCV2-S7.5 — Outcome Shadow Read Validation.** Its exit condition is a
  mismatch rate measured over real traffic, which needs
  `MCV2_SHADOW_READ_OUTCOMES` switched on in a deployment. Human decision.
- **Running any backfill against real data.** Needs production credentials.
- **G4 — the AI Workforce runtime.** The canon defers its implementation; see
  NEXT EXACT TASK item 4.
- **G6 — external integrations.** Needs third-party credentials.
- **Organization context in the shell.** Blocked on a light workspace endpoint;
  see KNOWN NON-BLOCKING ISSUES.

## PRODUCTION WORK DEFERRED

- **Batch 4E production rollout** — deferred to final production hardening.
- **Batch 4C/4D production gates** — applying the provider-administration and
  BYOK migrations and setting `AI_CREDENTIAL_ENCRYPTION_KEY` still need human
  authorisation.
- **The ClientPortal auth cluster** and every other live-verification task remain
  deferred, as previously recorded.
- **UI Sprint 7 needs no production action.** No migration, no secret, no
  required variable. Every change is in the browser bundle, and the two storage
  keys it uses (`teamDashboardPage`, `marq_cortex_nav_system_open`) are
  session-scoped conveniences that fail closed when storage is unavailable.
- `AI_ALLOW_REAL_REQUESTS` was not changed by this work.

---

_Prior-session record above. This session's record follows._

---

# THIS SESSION — FRONTEND DEBT + UI SPRINTS 1-6

Branch `claude/marq-cortex-product-complete-5d8hyz`, from `04bdfba`.

## THE GOVERNING FINDING

Cortex had built far more product than it had made reachable. AI-01 Batches
1-4F delivered a ten-tab AI Control Plane — providers, routing, agents,
workflows, budget, usage, audit, diagnostics — and the whole of it was reachable
only at Settings -> AI -> a sub-tab. G5 delivered `/health/enterprise` and
`/kpis` with no UI consumer at all. To a user of the running product, the
platform's central governance and operational surfaces were invisible.

Both are now first-class destinations.

## FRONTEND DEBT — CLOSED TO THE DEFERRED LINE

`typecheck:web` went 34 -> 14. All 20 non-cluster errors are fixed. Every
remaining error is the deferred ClientPortal auth cluster (ClientPortal x8,
ClientMessaging x3, ProposalViewer x2, EngagementActivityFeed x1), untouched.

None of these were stale annotations. Reading a field the canonical type does
not declare yields `undefined`, and `undefined` compares equal to nothing, so
each was a live defect:

- **Every proposal snapshot froze ZERO blocks.** `snapshotEngine` filtered
  BlockLinks on `linked_entity_*`; schema §5 names them `entity_type`/
  `entity_id`. The immutable record captured at "sent" held none of the
  proposal's content. It also read approval off the Block (schema §4 keeps it on
  the revision) and froze `block.label` (the Block declares `title`).
- **Every workstream card showed no milestones and no gates.**
  `ExecutionDashboard` filtered milestones on a `workstream_id` a Milestone does
  not declare; the ExecutionTask is the only edge.
- **Every rich-text block edit destroyed the block.** `EditableBlockCard` passed
  `handleSave` to `RichTextEditor`, which yields raw TEXT where handleSave
  forwards its first argument as the whole CONTENT record — so `{text: '...'}`
  became a bare string and the block rendered "Empty" thereafter.
- **The diagnostic milestone modal never rendered.** `ProgressModal` gates its
  whole body on `isOpen`, which its only caller never passed.
- **Every AI assist in the Cortex dashboard got an empty company size and empty
  reasoning.** The toolbar read `lead.employeeEstimate` (Lead declares
  `companySize`) and `core_problem.why_first` (it lives on
  `strategic_decision`).
- **Approve was dead for every in-review submission.** `QuickActions` declared a
  private vocabulary ('reviewing', 'sent') where canon is
  new|in-review|completed|approved.
- **A mapped execution rendered "vundefined".** `mappingEngine` omitted
  `execution_version`.
- **Demo settings rendered no notification preferences.** Both `SettingsPage`
  fixtures described a different settings product than the server serves.
- Plus: a leaked `setInterval` (`useState` where `useEffect` was meant), a
  dropped tooltip (`title` on a lucide `<svg>`), three mock service ids that
  exist in no canon, and an unreachable `select` branch contradicting
  `QuestionDef`.

## UI SPRINTS

**Sprint 1 — one navigation model.** Four navigation surfaces described four
different products: the sidebar had eleven destinations, the command palette
four, the accelerator table four hand-listed, and the shortcuts help sheet four
more that were already stale. Ch. 21.4 forbids exactly this. `navigationModel.ts`
now describes every destination once, grouped by intent (Work, Understand,
Deliver, Operate, Administer, Platform); all four surfaces derive from it. The
AI Control Plane is promoted to a first-class destination — the SAME component
Settings mounts, per Ch. 21.4's "many paths, one canonical entity". Also fixed:
the collapsed 80px rail rendered bare unlabelled icons.

**Sprint 2 — operational awareness.** `operationalAwarenessService.ts` +
`OperationsPanel.tsx` consume the G5 reads. The server modules' disciplines are
restated and asserted at the renderer, which is where they would be lost:
`unknown` never reads as healthy (own word, own colour, sorts above healthy); a
dimension nothing measures says so; `value: null` renders "Not measured", never
0; no target, threshold, grade or score anywhere; and no demo fallback, because
a fabricated green is worse than a blank page.

**Sprint 3 — the priority inbox.** Its primary action was `opacity-0` until
`:hover` — unreachable on any touch device and invisible to keyboard focus. The
row is now the control. And the header counted the TRUNCATED list, so a team
with twenty items needing attention was told "6 items need attention" with
critical items past the cap neither shown nor counted.

**Sprint 4 — the shell at every width.** The shell had NO breakpoint of any
kind: a fixed 280px sidebar beside the content left 95px on a 375px phone.
Below 1024px the same `<nav>` is now an overlay drawer (Ch. 21.10 — one model,
only the interaction changes). A closed drawer animates `visibility`, not only
position, so it leaves the tab order.

**Sprint 5 — empty states.** The defect was conflation, not absence: four
panels rendered one filter-blaming message for both "nothing exists yet" and
"nothing matches your filters". A reviewer opening an empty queue, having set
no filter, was told their filters were the problem. Now two components;
`NoResultsState` says how many exist behind the filter and offers to clear it.

**Sprint 6 — addressable destinations.** Ch. 21.11. All eleven pages lived in
`useState` under one URL: nothing linkable, bookmarkable or restorable, Back
left the shell, and `/team/execution` handed back through a `sessionStorage`
key declared as a literal in two files. Destinations are now
`?page=<id>`. AND the auth gate was discarding the URL anyway — session restore
runs in an effect, so on the first render both team guards read a null token,
redirected to login and dropped the location; login bounced back to a bare
path. Every cold load landed on the dashboard regardless of where it was aimed.
`isRestoringSession` (cleared in a `finally`, so no early return strands a
guard) fixes that. Without it, the addressing change would have been invisible.

## COMMITS — THIS SESSION

1. `fix(frontend): five reads of fields the canonical types never declared`
2. `fix(frontend): eight more contract breaks, and the frontend debt is at the deferred line`
3. `feat(ui): one navigation model, and the AI Control Plane becomes reachable`
4. `feat(ui): the operational awareness surface, and the disciplines it must not lose`
5. `fix(ui): the priority inbox was unreachable by touch and under-counted the backlog`
6. `feat(ui): the shell had no breakpoints at all — below 1024px the nav is a drawer`
7. `docs: checkpoint after the frontend debt closure and UI sprints 1-4`
8. `fix(ui): "nothing here yet" and "nothing matches your filters" are different states`
9. `feat(ui): every destination gets an address, and the auth gate stops discarding it`

## TEST RESULTS — THIS SESSION

| Suite | Result |
|---|---|
| `npm run test:features` | 954 pass (was 774 at session start) |
| `npm run test:ai` | 2,183 pass |
| `npm run test:security` | 859 pass |
| `npm run test:system` | 170 pass |
| `npm run test:migration` | 210 pass |
| `npm run verify:4f` | 167 pass |
| `npm run verify:4c` / `:4d` | 132 / 199 pass |
| `npm run verify:health` | 48 pass |
| `npm run scan:boundaries` | 107 pass |
| `npm run test:database` | 206 pass, 1 skipped without `DATABASE_URL` |
| `npm run typecheck:web` | **14 errors — all the deferred auth cluster** (was 34) |
| `npm run typecheck:tests` | 27 errors — unchanged baseline |
| `npm run build` | clean |

145 tests added across seven new suites. No test was weakened, skipped or
deleted.

Two existing assertions were UPDATED, not weakened, each pinning a snapshot that
a deliberate canon-grounded change superseded: `breadcrumbContract`'s
`default: return []` (Ch. 21.12 — every destination now says where you are; its
eight named branches untouched), and `navigationModelContract`'s tooltip
condition, narrowed to the desktop rail because the drawer shows real labels.
Both suites still pass in full.

`clientPortalAuthContract.test.ts` is UNCHANGED and passes, exclusion pins
included.

## VERIFIED IN A REAL BROWSER

Sprints 1-4 were driven in Chromium (Playwright, the pre-installed browser)
against the production build at 1440x900, 820x1180 and 375x812:

- the aside is `static` at 1440 and `fixed` at 820 and below;
- main content goes from 95px to the full 375px on a phone;
- no horizontal document overflow at any width;
- all 13 destinations and all 6 intent groups present at every width;
- 25 Tab presses never land inside a closed drawer, and do once it is open;
- open / tap-outside / Escape / navigate all resolve the drawer to hidden;
- the promoted destinations load — AI Control Plane correctly reports it needs
  the live backend rather than fabricating state; Operations renders;
- the command palette offers 13 "Go to" entries where it offered four;
- no page errors at any width.

## DEFERRED — LIVE VERIFICATION REQUIRED

Recorded, not attempted, per the session mandate:

- **ClientPortal auth cluster** (14 `typecheck:web` errors). Repairing it changes
  what the browser sends over the wire — an authentication and telemetry change,
  not a type-only one. Needs a live-backend verification environment.
  `clientPortalAuthContract.test.ts` must not be weakened or removed.
- **`ClientPortalRoute`'s first-render redirect.** NEW FINDING. It has the
  IDENTICAL defect Sprint 6 fixed on the team routes: session restore runs in an
  effect, so on the first render the guard reads a null session, redirects to
  `/client/login` and discards the requested URL. Fixing it changes ClientPortal
  browser auth behaviour, so it is deferred with the rest of the cluster.
  `destinationAddressContract.test.ts` asserts it was left alone — that
  assertion must be inverted, not deleted, when the cluster is repaired.
- **MCV2-S7.5** outcome shadow read validation — needs real traffic.
- **Real production backfill execution** — needs production credentials.
- **G1/G2** data authority and enforced tenancy cutover — deployment actions.
- **S8.1-S8.3** deployment actions.
- **G6** external integrations — third-party credentials.
- **Batch 4E production rollout**, and the 4C/4D production gates.
- **G4 — the AI Workforce runtime.** The canon defers implementation to a later
  phase; realizing it is an architecture decision for a human. Unchanged.

## BLOCKERS

None for dependency-safe product/UI work. The sprint sequence in
`docs/development/UI_IMPLEMENTATION_MAP.md` continues without any deployment.

`deno` is not installed in this environment, so `typecheck:api:*` cannot run
here. No server code was changed this session, so this is not a regression.

## NEXT EXACT TASK

**UI Sprint 7 — onboarding and design tokens**, per
`docs/development/UI_IMPLEMENTATION_MAP.md`. The two remaining non-deferred rows
in the audit:

1. **No first-run experience.** Nothing orients an operator opening Cortex for
   the first time — no tour, no "start here", no explanation of what the six
   navigation intents are for. Ch. 9 and Ch. 21.12. Note that the navigation
   model now makes this tractable: the intents are declared data, so a first-run
   surface can be generated from them rather than hand-written and left to
   drift.
2. **Design-token inconsistency.** `src/app/utils/designTokens.ts` exists, and
   colours are simultaneously hard-coded inline across components (`#8B5CF6`,
   `#06D7F6`, `#0A0A0F` and friends appear as literals in dozens of files).
   Audit which literals correspond to declared tokens, and converge — starting
   with the shell and the components added this session, which should be
   exemplary before anything older is touched.

After that the audit's non-deferred rows are exhausted; re-audit the UI against
the Product Experience for the next sprint set, or take the merge decision on
this branch.



---

# BRANCH CONTINUITY — UI SPRINTS 1-6 + UI SPRINT 7

Recorded 2026-09-08. **This section supersedes the two NEXT EXACT TASK lists
above**, which were written independently by two branches neither of which
could see the other.

## THE FINDING

A checkpoint reported UI Sprints 1-6 complete with `typecheck:web` at 14, and a
later checkpoint reported UI Sprint 7 at 20 commits with `typecheck:web` at 32
against a stated baseline of 34. A baseline that had returned to 34 was the
symptom: Sprint 7 had never inherited Sprints 1-6.

Git confirmed it. Both branches were cut from the same commit and neither was
an ancestor of the other:

```
origin/main                                     04bdfbabcb74f9d332cee8b3b3c096cf7ae66a73
origin/claude/marq-cortex-product-complete-5d8hyz   4b6244b92fa12d05d9b051e5a6fd34f449d5725b   (10 commits ahead)
origin/claude/marq-cortex-ui-sprint-7-11jp3g        0e252de25e67481364fc2afcc25ac5ed82217a87   (20 commits ahead)

merge-base(main, sprints-1-6)  = 04bdfba
merge-base(main, sprint-7)     = 04bdfba
merge-base(sprints-1-6, sprint-7) = 04bdfba      <- the fork point is main itself
git merge-base --is-ancestor sprints-1-6 sprint-7  -> NO
git merge-base --is-ancestor sprint-7 sprints-1-6  -> NO
```

Sprint 7's tree contained none of Sprints 1-6's new modules — not
`core/navigationModel.ts`, `components/OperationsPanel.tsx`,
`services/operationalAwarenessService.ts`, `components/EmptyState.tsx`,
`components/RouteRestoring.tsx`, nor any of the eight contract suites that pin
them.

## WHY `typecheck:web` APPEARED TO RESET FROM 14 TO 34

It did not reset. The two branches were measuring different trees, and both
numbers were correct for the tree they were measured on. Re-measured here:

| Tree | `typecheck:web` |
|---|---|
| `origin/main` | 34 |
| Sprints 1-6 tip | 14 |
| Sprint 7 tip | 32 |
| **this integration branch** | **14** |

Sprints 1-6 fixed the 20 non-cluster errors, reaching 14. Sprint 7 was cut from
`main`, so it started from 34 — not from 14 — and its own two fixes took it to
32. Sprint 7's "baseline 34" was accurate; it was simply the wrong baseline to
be starting from.

**No fix was lost.** The integrated tree's 14 errors are the same
(file, message) set as Sprints 1-6's 14, and the error Sprint 7 fixed
(`SettingsPage` / `companyName` not on `PlatformSettings`) is absent from the
integrated tree — both branches had corrected it independently, so Sprint 7's
two fixes were a subset of Sprints 1-6's twenty. All 14 that remain are the
deferred ClientPortal auth cluster (ClientPortal x8, ClientMessaging x3,
ProposalViewer x2, EngagementActivityFeed x1), untouched by design.

## WHAT THE INTEGRATION HAD TO RECONCILE

A true merge, `sprint-7 + sprints-1-6`, preserving both histories. Nine files
conflicted. Three were duplicate realities rather than textual clashes — both
branches had independently built the same thing:

1. **Two navigation models.** Sprints 1-6 built `core/navigationModel.ts`
   (13 destinations, grouped by intent, with icons, palette keywords and
   accelerators, and `PAGE_PARAM` for URL addressing). Sprint 7 built
   `core/orientation.ts` with a second `NAV_MODEL` of 11 entries — lacking the
   AI Control Plane and Operations entirely, and restoring pages through a
   `sessionStorage` key rather than the URL.

   Ch. 21.4 forbids exactly this: "Navigation should never create duplicate
   realities." `navigationModel.ts` is canonical — it is the superset, it is
   what the contract suites pin, and it is the one that satisfies
   URL-addressable destinations. `orientation.ts` now *projects* it: it declares
   no navigation of its own, and gained a `tier` (`primary`/`secondary`/
   `system`) so Sprint 7's progressive disclosure keeps working over the
   canonical list. `TEAM_DASHBOARD_PAGE_KEY` is gone with the side channel it
   served. `lib/navIcons.tsx` is gone too — it existed only to give the
   duplicate model icons that the canonical one already carries.

2. **Two accelerator tables.** The command palette hand-listed four shortcuts
   and named `Ctrl 3` "Team"; the shell binds `Ctrl 3` to the AI Control Plane.
   The palette now derives both the destinations and their accelerators from
   the model, so the two cannot disagree again.

3. **Two empty-state components.** Sprint 7's `ui/cortex` vocabulary (19 files)
   and Sprints 1-6's `components/EmptyState.tsx`. Both survive, because they
   are not the same thing: only the latter carries `NoResultsState`, the
   distinction between "nothing here yet" and "nothing matches your filters".
   `TeamManagement` uses that one, and keeps Sprint 7's role-gated invite
   action inside it.

Where the two branches genuinely disagreed on behaviour, the safer half won:
the settings page no longer substitutes a demo fixture when a load fails,
because that fixture rendered into live form controls that Save would have
written back over the real configuration.

## TESTS

Three suites had to be re-pointed at the integrated implementation. None was
weakened; each kept its guarantee and two gained one:

- `orientation.test.ts` — the shell-page list now names all 13 destinations,
  and the assertion stays exact in both directions.
- `consoleAccessibility.test.ts` — one control serves both widths, so its name
  is asserted as the three-state expression rather than as a literal.
- `responsiveShellContract.test.ts` — the header's search control is
  `"Search submissions"`, not `"Search"`.
- `proposalExecutionStateContracts.test.ts` — **gained** an assertion that the
  settings error path builds no fixture and clears the form.
- `breadcrumbContract.test.ts` — keeps Sprint 7's stricter "no hand-written
  label" rule *and* Sprints 1-6's "every destination says where you are".

## BROWSER SMOKE OF THE INTEGRATED BRANCH

Chromium via the pre-installed browser at `/opt/pw-browsers/chromium` (the
repo's pinned Playwright expects an older build; launch with `executablePath`),
against the dev server in demo mode, at 1440px and 390px. 33 checks, all
passing:

- **Dashboard** — reached, one `h1`, skip link present, `#cortex-main`
  addressable.
- **Navigation** — both landmarks named, `aria-current` on the active entry,
  no unnamed buttons. The sidebar renders all six intent groups, and the
  AI Control Plane and Operations are both in it — the two destinations
  Sprint 7's model did not contain.
- **AI Control Plane** — reachable from the sidebar, addressable at
  `?page=control-plane`, breadcrumb names it, content renders.
- **Operations** — the same, at `?page=operations`.
- **Deep-link refresh recovery** — `?page=analytics` lands on Analytics, and a
  browser reload STAYS on Analytics rather than bouncing to the dashboard or to
  login. `?page=nonsense` falls back instead of erroring.
- **Mobile drawer (390px)** — trigger present, drawer `visibility: hidden` when
  closed rather than merely translated off-screen, opens with real labels (not
  an icon rail), closes on Escape, no horizontal overflow.
- **Onboarding** — the home surface renders and names the signed-in member.
- **Client portal** — client login renders, one `h1`, no unnamed buttons, no
  unlabelled inputs.
- **The folded group** — `Platform` is a real disclosure: `aria-expanded=false`
  with `aria-controls`, Architecture hidden, one click reveals it. The command
  palette reaches Operations by name whether the group is folded or not, opens
  as a dialog and closes on Escape.
- **No uncaught page errors** on any route driven.

One defect was found and fixed: the client login's email field had a styled
`<label>` with no `htmlFor` and no `id` on the input, so it named the field on
screen and to nobody else — a screen-reader user reached an edit box announced
only by its placeholder, which vanishes on the first keystroke. Pre-existing on
both source branches; the integration changed no client file.

## NEXT EXACT TASK

**Token migration was paused for this reconciliation and is now unblocked.**

1. **Continue the design-token migration, surface by surface.** The vocabulary,
   the Tailwind utilities, the primitives and the drift test exist; the shells,
   the feedback states and the status vocabulary are converged. Roughly five
   thousand literals remain. Start with surfaces a canonical journey passes
   through. Deliberately NOT a mass search-and-replace — that is a visual
   regression no test could catch.

2. **Finish the dialog migration.** Thirteen hand-rolled overlays remain, all in
   panels off the canonical journeys. `components/ui/cortex/Modal.tsx` exists
   and `dialogSemantics.test.ts` shows the shape.

3. **A merge decision on this branch.** Thirty-one commits, no PR opened.


---

# UI SPRINT 8 — DESIGN-TOKEN MIGRATION

Branch `claude/marq-cortex-ui-continuity-q1iiy3`, continuing from the branch
reconciliation above. **This section supersedes the NEXT EXACT TASK lists in
every section before it.**

## WHAT WAS DONE

Ten coherent surfaces migrated onto the token layer, one at a time, each with
its own browser pass before the commit. **Colour literals in `src/app` went from
roughly 5,000 to 2,418.**

| # | Surface | Was |
|---|---|---|
| 1 | Console home dashboard | 41 literals, own grey ramp |
| 2 | Execution dashboard (6 tabs) | 72, two ad-hoc greys used 31 times |
| 3 | CORTEX analysis sections (9 modules) | 315, a department map declared twice |
| 4 | Landing page | 93, own light type ramp |
| 5 | Diagnostic form | 90, nine industry colours |
| 6 | Score page + client report dashboard | 130, neither imported the token layer |
| 7 | Global AI chat (on every console page) | 74, one accent at six opacities |
| 8 | Six console work panels | 186 |
| 9 | Seven proposal and ROI panels | 426 |
| 10 | Pipeline kanban | 221, the largest file in the product |

## TWO ADDITIONS TO THE TOKEN LAYER

Both are colours the product was **already rendering** and had simply never
declared — which is the test suite's own stated standard for what belongs here.

**`--cortex-accent-tertiary` (#EC4899).** The seven-department portfolio scale
needs seven distinct hues and the status vocabulary can spare six. The seventh
was an undeclared pink living inside a map that was declared twice.

**The three-step scale** — `-light` and `-deep` for accent, accent-alt, success,
danger and caution. Every surface hit the same wall: a tinted chip needs TEXT of
its own hue and the base colour is not readable there (`#C4B5FD` on an accent
tint is 4.33:1, under AA); a solid button needs a PRESSED state and the base
colour does not look pressed. Sixteen files were rendering `#A78BFA` and twenty
were rendering `#7C3AED` to do exactly these two jobs. Warning is deliberately
absent a pair: it is the one hue nothing lightened or darkened at scale.

Eleven new assertions pin what the steps are FOR — light is lighter, deep is
darker, all steps distinct, and every light step clears 4.5:1 on the canvas.

## WHAT DELIBERATELY DID NOT CONVERGE, AND WHY

These are not omissions. Each is recorded with a test or a comment at the site.

- **`ProposalControlPanel`'s export template.** It writes a document into a new
  window with `document.write`, in a LIGHT theme. The console's CSS variables do
  not exist in that window, so `var(--cortex-*)` there resolves to nothing. Its
  styles interpolate the token VALUES instead; its own light greys stay, because
  they are that document's vocabulary and not the console's.
- **Two sequential ramps** — `LOSS_PALETTE` in `LearningLoopPanel` and
  `LOOP_LOSS_PALETTE` in `PipelineKanban`. Four or five steps desaturating away
  from the danger colour so a chart can show magnitude. Only the first step means
  danger; the rest are distances from it.
- **`ANNOT_COLORS`, the highlighter palette.** Six tints chosen so text stays
  readable under a highlight. They carry no good/bad meaning, and a highlight
  must not change colour the day the product's danger colour does. There is a
  test asserting all six stay declared together and that none is a status colour.

## THE ONE VISIBLE CHANGE

The landing page's type ramp was lighter than the console's four declared text
levels, so converging it lowered body-copy contrast. Measured in Chromium
against the page's own background: primary 21.00:1 (was ~19.5), secondary
9.95:1 (was ~14.9), muted 5.28:1 (was ~8.0). Every level that changed still
clears WCAG AA. If the marketing surface is meant to keep a brighter ramp, the
answer is to declare that ramp as tokens rather than leave it as sixteen hex
literals — one revert away.

## A DEFECT FIXED ALONG THE WAY

**The annotations drawer was a dialog that never said so.** A client reading
their proposal opens Notes and a panel slides in over the document; it had no
`role`, no `aria-modal`, no focus moved in or restored, no Escape, and an
unnamed close button. Tab walked straight out of it into the proposal it was
covering. It now takes the four behaviours from `useDialogBehavior` — it keeps
its own slide-in shape, which is the case that hook exists for — and is verified
in the browser: announced as "Annotations", focus moves in, does not escape
across 25 Tab presses, Escape closes it, focus returns to the Notes button.

## WHY THIS WENT SURFACE BY SURFACE AND NOT AS A SWEEP

Four collisions that a tree-wide search-and-replace would have shipped:

- `EmailNurturePanel` has a function whose own parameter is `status`, so
  `status.neutral` inside it resolved to the string `"skipped"`.
- `SubmissionsListPage` imports the token module under an alias, so
  `status.warning` there was `window.status`.
- `LearningLoopPanel` and `PipelineKanban` have the same shadow. In the kanban
  the palette is therefore read once at module scope, where no parameter can
  shadow it — in a component whose parameter is a plain `string` rather than a
  union, the mistake would have compiled cleanly and rendered `undefined` as a
  colour.
- `ProposalControlPanel`'s export template, above, would have been given CSS
  variables that do not exist in the window it writes to.

The compiler caught two of the four. The other two needed a person to look.

## VERIFICATION

`typecheck:web` **14** — unchanged throughout, and still exactly the deferred
ClientPortal auth cluster (ClientPortal x8, ClientMessaging x3, ProposalViewer
x2, EngagementActivityFeed x1), untouched by design.

features **1205**, AI **2183**, security **859**, system **170**, migration
**210**, boundaries **107** — all passing. Production build succeeds.

Browser smoke, 25 checks, all passing: the four public funnel routes and the
eleven console destinations each render with zero unresolved token classes, no
horizontal overflow and one `h1`; a deep link survives a refresh; the drawer
opens and closes on Escape at 390px; all eight client-portal tabs are styled;
and no page errors anywhere.

## NEXT EXACT TASK

1. **Continue the token migration.** About 2,400 literals remain, and the two
   additions above unblock nearly all of them. The next largest are
   `RegistryViewer` (185 — an internal tool, so low user impact),
   `ContractDraftViewer` (68 — check for an export template like the control
   panel's before touching it), `MonteCarloPanel`, `ROIExecutiveDashboard` and
   the notification and toast components.

2. **Decide the marketing type ramp**, per "the one visible change" above.
   Either accept the console ramp on the funnel, or declare the brighter ramp
   as tokens. It is a product decision, not an engineering one.

3. **`text-cortex-neutral` is 4.30:1 on the funnel canvas** — AA-large, under AA
   for body text. That is the contrast `#70707C` already had; it is not a
   regression, but it is now a named colour and therefore fixable in one place.

4. **A merge decision on this branch.** Forty-four commits, no PR opened.


---

# UI SPRINT 8 — TOKEN MIGRATION CLOSURE

Branch `claude/marq-cortex-ui-continuity-q1iiy3`. **This section supersedes every
NEXT EXACT TASK list above it.**

## THE HEADLINE

**Colour literals in `src/app` went from roughly 5,000 to 712, and every one of
the 712 is classified.** There is no unexplained product styling literal left in
the repository.

Migrated this session: the system registry, the contract viewer, notifications
and toasts, the ROI editors, eight analysis and authoring surfaces, eleven
funnel and account surfaces, the second token module, fifteen engines and domain
colour maps, and a long tail of thirty-nine files.

## THE CENSUS, CLASSIFIED

Run `python3` over `src/` with comments and doc-strings stripped — prose that
NAMES a colour is documentation, not styling.

| Class | What | Literals | Files |
|---|---|---:|---:|
| **A** | migration debt | **0** | 0 |
| **B** | intentional semantic / data palette | 35 | 5 |
| **C** | standalone or export rendering | 204 | 7 |
| **D** | third-party / vendor requirement | 197 | 2 |
| **E** | justified exception | 278 | 10 |

**Class A is empty.** Everything that should be a token is a token.

**Class B — palettes that must NOT be tokens.** The highlighter tints in
`ProposalAnnotationLayer` (readability under a highlight, not status); two
sequential ramps in `PipelineKanban` and `LearningLoopPanel` (magnitude, where
only the first step means danger); the confetti in `WinCelebration`; and the
registry's seven-way symbol legend in `registryDataExtension` (a FUNCTION is not
healthier than a SPEC). Each carries a comment at the site saying why, and three
are pinned by tests.

**Class C — CSS variables do not exist there.** `proposalExport`, the sent
nurture email, the printed contract, the proposal control panel's export, the
downloadable readiness guide, `pdfExport`, and `main.tsx`'s pre-mount bootstrap
screen, which is injected before the stylesheet loads. In each, the colours that
must track the product interpolate token VALUES; the rest is that document's own
light vocabulary. A `var(--cortex-*)` in any of them renders as nothing — and in
the email nobody would find out until a customer opened it.

**Class D — vendor.** `imports/Desktop06.tsx` is Figma-exported SVG that is
regenerated rather than hand-edited, and `ui/chart.tsx` is a vendored shadcn
primitive.

**Class E — justified.** The token declarations themselves (they are where a
colour is allowed to be a literal); the shadcn theme layer; a compile-time
typecheck fixture; the four deferred ClientPortal auth-cluster files, left
untouched by instruction; and two dead components — `DiagnosticQuestion` and
`ProgressModal` — which are LIGHT or dual-theme and have no live importer.
Giving a dark palette to an orphaned light layout would have made it look
migrated without making it correct.

## ACCESSIBILITY CORRECTION — `text-cortex-neutral`

Fixed centrally. `--cortex-status-neutral` was `#70707C`: 4.04:1 on the canvas
and 3.95:1 on the overlay, under WCAG AA for body text — and this is the one
status colour the product also uses as PROSE, twenty-five times across the
funnel.

Inspected before changing, because it is shared: every class-name use is text
(`bg-` and `border-` uses are zero), and the other 115 uses are dots and chips
in status maps, where lightening a grey can only help.

The token moved to **`#7A7A86`** — ten units of lightness, hue relationship kept
(R=G, B=R+12) — giving **4.66:1 on the canvas and 4.56:1 on the overlay**.
Measured in Chromium against each element's own painted background: landing
worst **4.56:1**, diagnostic **4.95:1**. All AA. Across four console pages the
new value renders forty times and the old one zero times.

Three assertions pinned the old value and now pin the new one; a fourth was
added that pins the property rather than the value — every text-weight colour
clearing 4.5:1 on both dark surfaces — so it cannot drift back.

**Not fixed, stated plainly:** where the neutral is chip TEXT on a 12.5% tint of
itself, contrast is against the tint, not the canvas: that case improved from
3.65:1 to **4.17:1** and remains under AA. Closing it needs either a
`neutral-light` step or a darker chip tint — a design decision, not a
correction.

## MARKETING TYPE RAMP

Left converged, as instructed. Recorded as visually reviewable, not a blocker.
The landing page's body copy sits at 5.28:1 (was ~8.0:1) — comfortably AA, and
quieter than before. No QA this session surfaced a readability problem.

## WHAT THE SURFACE-BY-SURFACE METHOD CAUGHT

A tree-wide replace would have shipped every one of these:

- **Four `status` shadows.** Files where a function parameter is named `status`,
  so an unqualified `status.neutral` resolves to a string. TypeScript caught two
  because the parameter was a literal union; where a parameter is a plain
  `string` it compiles clean and renders `undefined` as a colour. Eleven files
  now read their palette from module-scope constants for exactly this reason.
- **A template inside double quotes.** `fill="${brand.accentAlt}20"` compiles,
  throws nothing, and silently renders the literal characters — the shape just
  loses its fill. One instance; the browser check now asserts no `fill` or
  `stroke` anywhere contains a literal `${`.
- **A dropped attribute name**, leaving `<CartesianGrid {BORDER.subtle} />` in
  four files.
- **A wrong border step.** Every white-alpha above 0.05 was mapped to the
  default border, but `rgba(255,255,255,0.2)` is the STRONG one — a pending
  stage icon came out at half weight.
- **A collapsed template.** A cleanup rule turned a legitimate `` `${value}` ``
  into `value`, changing a function's return type.
- **The eight-digit blind spot.** Every census matched `#[0-9A-Fa-f]{6}\b`, and
  the word boundary meant `#10B98120` never matched. Forty-one were sitting in
  files the count called finished.

## TESTS

Seven suites re-pointed at the token vocabulary. None weakened; three
strengthened:

- `operationalAwarenessSurface` compared two hex values pulled from source. It
  now asserts the map contains **no hex at all**, and that `unknown` references
  a different token from BOTH `healthy` and `degraded`.
- `designTokens` gained the contrast assertion described above.
- `dialogSemantics` gained five assertions for the annotations drawer.

## VERIFICATION

`typecheck:web` **14** — unchanged all session, still exactly the deferred
ClientPortal cluster.

features **1206** · AI **2183** · security **859** · system **170** · migration
**210** · boundaries **107** — all passing. Production build succeeds.

Browser smoke **35/35**: seven public routes, eleven console destinations, six
execution tabs and the registry all render with zero unresolved token classes
and no overflow; a deep link survives a refresh without bouncing to login; the
drawer opens, shows the AI Control Plane and closes on Escape at 390px; the
command palette opens as a dialog, finds Operations by name and closes on
Escape; the invite dialog holds focus across 25 Tab presses and closes on
Escape; no page errors anywhere.

## NEXT EXACT TASK

1. **A merge decision on this branch.** Fifty-six commits, no PR opened. The
   token migration has reached closure and this is the natural point to land it.
2. **The chip-on-own-tint contrast case** above — a `neutral-light` step or a
   darker chip tint. Design decision.
3. **Two dead components** — `DiagnosticQuestion` and `ProgressModal`, plus the
   `ProgressModal` import inside the former. Nothing renders either. Deleting
   them removes 70 class-E literals and two light-theme orphans, but deletion is
   the author's call, not a refactor's.
4. **A React duplicate-key warning** on the registry route for `MQC-COMP-011` —
   a duplicate in the registry data, pre-existing and unrelated to styling.
5. **The deferred ClientPortal auth cluster** — still the standing 14 type
   errors, still untouched.


---

# CLIENT PORTAL AUTH CLOSURE

Branch `claude/client-portal-auth-closure`, from `7e792423` (main, UI Sprints
1-8 merged). **This section supersedes every NEXT EXACT TASK list above it.**

## THE DEFECT

`typecheck:web` was **14**, and every one of the fourteen was the same shape: a
call site passing one argument more than the wrapper declared.

Seven wrappers in `dataService` declared no parameter for the client auth
context, so JavaScript discarded the argument the components were already
passing. `api` saw `auth === undefined`, the request went out on the anon key
with no `?email=`, and `requireClientAccess` answered 401.

**This was a live outage, not a stale annotation.** A client opening their
portal in live mode got their submission — the one wrapper Task 16 had already
repaired — and then 401 for their report, their proposal, their messages, their
engagement log and every engagement event. Invisible in demo mode, where these
wrappers return before touching `api`; and `api.trackEngagement` swallows its
own errors by design, so seven of the eight failures were silent even in
production. Task 16 escalated it for exactly this reason rather than folding it
into a type cleanup.

## THE REPAIR

Each wrapper accepts `auth?: ClientAuthContext` in the slot its api counterpart
has always declared, and forwards it. Eighteen lines. No cast, no `any`, no
suppression — `typecheck:web` reaches **0** because the argument now has
somewhere to go.

The contract was verified end to end before a line was changed: all eight `api`
methods already accepted `auth` and already sent it as
`Authorization: Bearer <sessionToken>` plus an `?email=` fallback; the server's
`requireClientAccess` binds a token to ONE submission (404 on mismatch), accepts
the email fallback on reads only, and answers 401 otherwise. GETs take the
fallback, mutating POSTs do not. No organization header exists anywhere on this
path.

## LIVE VERIFICATION — PERFORMED

Docker is unavailable in this environment, so the full Supabase stack could not
boot, and the only linked project is production, which is out of bounds.
Instead: `requireClientAccess`, `verifyClientToken` and `safeJsonParse` were
extracted **VERBATIM** from the deployed server source, run under Deno over an
in-memory kv seeded with two distinct clients, and the real browser was pointed
at it in live mode (`VITE_BACKEND_INTEGRATION=true`). Nothing production was
touched. A harness that re-states the guard proves nothing about the guard, so
the extraction is byte-identical and asserted to be.

| Scenario | Result |
|---|---|
| known valid client | 200, browser sends `Bearer client_tokenA` |
| refresh / deep link | still authorized, still the same client |
| unknown client | refused; no data request even attempted |
| second client | sees only their own company, never the first's |
| another client's real token | 404 on this submission |
| missing auth | 401 |
| anon key alone | 401 |
| email fallback on a POST | 401 — mutations require the token |

**The counterfactual is the proof.** With this change reverted and everything
else identical, the same journey produces **7x 401 and 2x 200**, and the browser
is observed sending `Bearer local_anon_key_` for precisely the seven wrappers
repaired here. With it applied: **9x 200**, all `Bearer client_tokenA`.

## THE CONTRACT TEST

`clientPortalAuthContract` is rewritten to pin the new guarantee rather than the
old exclusion, and is stronger — 24 assertions to 35. It asserts each wrapper
declares AND forwards the slot; that none delegates without it; that no unsafe
escape was used; that the browser sends only a bearer token and an email query,
with no organization header, tenant claim or service-role key; and that the demo
gate still stands so live mode has no demo fallback.

Mutation-tested: dropping a forward, removing a slot, or smuggling an
organization field each fails it.

## CLEANUP

**Done.** `.qa/qa.mjs` removed. The manifest's duplicate dependency fixed —
`ClientPortal` listed `MQC-COMP-011` twice in one `dependencies` array, the only
such duplicate in the file, which is what produced the React duplicate-key
warning on the registry route. Verified gone in the browser.

**Deliberately not done.** `DiagnosticQuestion` and `ProgressModal` are dead in
that nothing renders them, but deleting them would violate canon: both are
`status: 'LIVE'` in `system/manifest.ts`, both appear in the registry and
process maps, and `diagnosticExportStateContracts` and `dialogSemantics` read
their source. The discrepancy — canon says live, the app never mounts them — is
a canon-review item, not a cleanup.

## A NEW FINDING: `typecheck:api` IS RED ON MAIN — AND WHAT IT ACTUALLY IS

Deno was absent from this environment, so `npm run typecheck:api` had never been
run here. Installing it for the live verification made it runnable, and it
reports **123 errors on clean main**, identical with this change applied —
pre-existing and untouched by it.

Characterised properly, because the headline number is misleading in both
directions:

**The blocking boundary is CLEAN.** `scripts/typecheck-deno.mjs` splits the
check in two: `ai` (the AI-01 surface, 306 files) is designated a blocker, and
`server` is everything else. `typecheck:api:ai` exits **0**. Nothing in the
security-critical AI surface is red.

**The registries are reachable**, so none of this is the environmental
"jsr.io unreachable" case the script warns about. The errors are real.

**Where they are:**

| Location | Errors | What they are |
|---|---:|---|
| `index.tsx` (deployed edge function) | 97 | three mechanical kinds, below |
| `migration/**` | ~22 | Node-targeted code swept into a Deno check |
| `repositories/**`, `kv_store.tsx` | 4 | incl. a missing `createReportRepository` export |

**The 97 in the deployed function are three shapes, repeated:**

- **63x** `'string | undefined' is not assignable to 'string | null'` — Hono's
  `c.req.header()` returns `string | undefined`; the guards it feeds declare
  `string | null`. Benign at runtime (both miss the `startsWith` check
  identically) and a genuine type error. One widened parameter type fixes most
  of them.
- **25x** `Property 'message' / 'stack' / 'name' does not exist on type '{}'` —
  `catch (err)` under `useUnknownInCatchVariables`. Mechanical.
- **8x** overload mismatches.

**The ~22 under `migration/**` are a different thing entirely** and should not
be fixed the same way. Those modules contain **zero** `Deno.` globals, are
imported by **no** deployed server file, are run by Node
(`node --experimental-strip-types scripts/migration/cli.ts`), and are covered by
fourteen passing Node suites. Their bare `@supabase/supabase-js` specifier is
correct for the runtime they actually target and unresolvable only to the Deno
checker that sweeps everything under `supabase/functions/`. That is the wrong
tool applied to the wrong code — the mirror image of the failure the script's
own header warns about for `tsc` — and the fix is a boundary definition, not an
import map. Reclassifying a QA boundary is the author's call, so it is left
here rather than done.

## VERIFICATION

`typecheck:web` **0** — from 14.

features **1217** (from 1206) · security **859** · AI **2183** · system **170** ·
migration **210** · boundaries **107** — all pass. Production build succeeds.
`clientPortalAuthContract` 35/35, `clientPortalIntegrity` 21/21.

Browser smoke: the client portal refuses an unknown client and admits a known
one, all eight tabs render, the portal survives a refresh; all eleven console
destinations render as deep links; the registry's duplicate-key warning is gone;
no unexpected page errors.

## NEXT EXACT TASK

1. **`typecheck:api` — 97 real type errors in the deployed edge function.** The
   largest V1 gap, invisible until now because Deno was not installed here. They
   are three mechanical shapes (see above), so the work is bounded: widen the
   header-guard parameter to `string | null | undefined`, narrow the `catch`
   variables, then the eight overloads. Do NOT sweep `migration/**` in with
   them — that is Node code in a Deno check and needs a boundary decision, not
   a code change. Note the blocking `ai` boundary is already clean.
2. **Canon review**: `DiagnosticQuestion` / `ProgressModal` marked LIVE but never
   mounted. Wire them up or correct the manifest.
3. **Design review**: chip-on-own-tint contrast (4.17:1, under AA) and the
   marketing type ramp (5.28:1, AA, quieter than before).

---

_Last updated: 2026-09-09, at ClientPortal auth closure — typecheck:web 14 to 0,
live-verified against the real guard, with the counterfactual to prove it._

---

# DEPLOYED EDGE FUNCTION TYPECHECK CLOSURE

_Branch `claude/edge-function-typecheck-closure`, from main `6fbe386f`._

## THE HEADLINE

**The deployed Edge Function type-checks clean. 99 errors to 0.**

All 341 deployed files — every `.ts`/`.tsx` under `supabase/functions/` except
the Node-targeted `server/migration/**` — pass `deno check` at exit 0. The AI
boundary stays clean, the registry-free boundary stays clean, `typecheck:web`
stays at 0.

Nothing was suppressed to get there. No `@ts-ignore`, no `@ts-expect-error`, no
`any`, and no cast added. **Three casts were removed.**

## THE BASELINE, CLASSIFIED BEFORE EDITING

`typecheck:api` reported **123**. They were not one problem:

| Class | Count | What it is |
|---|---:|---|
| **A — deployed Edge Function** | **99** | real defects in code that ships |
| **B — AI boundary** | **0** | already clean (306 files, exit 0) |
| **C — Node-targeted `migration/**`** | **24** | wrong checker, not a defect |
| **D — environment / module resolution** | **0** | jsr and npm both reachable here |

The previous checkpoint estimated Class A at 97 and Class C at ~22. Measured:
**99 and 24**. The two extra Class A errors were in `kv_store.tsx` and
`repositories/index.ts`, not in `index.tsx`, and the second of them turned out
to matter more than its count suggests (below).

## ROOT CAUSES FIXED

**1. One name for the absent header — 63 errors.** Hono's `c.req.header()`
returns `string | undefined`. The four request guards — `resolveTeamCaller`,
`verifyTeamToken`, `verifyClientToken`, `requireClientAccess` — were annotated
`string | null`. Both spellings mean "the header was not sent", every guard
already tested for absence with optional chaining, and so the two were identical
at runtime and differed only in the annotation. Sixty-three call sites paid for
that difference. One named type at the boundary, `RequestHeaderValue`, and four
signatures. This widens what may be passed **in**; it does not widen what is let
**through** — an absent header still fails the `Bearer ` test and still resolves
to "not authenticated", by the same code path as before.

**2. A caught value narrowed without flattening the taxonomy — 25 errors.**
`catch (err)` binds `unknown`, so `err?.message` does not compile. The obvious
narrowing, `error instanceof Error ? error.message : String(error)`, is wrong
**here**, and quietly so: a PostgREST/Supabase failure is not an `Error`, it is
a plain object carrying `message`. Every one of those would have taken the
`String(error)` branch, and `"Database error: connection refused"` would have
started reading `"Database error: [object Object]"` in the response these routes
return. `errorField` reads the field the way `err?.message` already did —
present on an object, absent on anything else — so a thrown string still has no
`.message`, exactly as before, and call sites keep their own `|| String(err)`
fallback so an empty message still resolves the same way.

**3. Statuses the guard actually returns — 8 errors.** Eight routes forward
`requireClientAccess`'s refusal to `c.json`, which takes a `ContentfulStatusCode`.
`ClientAccessResult.status` was `number`. The guard has exactly three refusal
sites and two statuses, and the 404/401 split is the contract: a credential
bound to a different submission must be indistinguishable from a submission that
is not there, or the route becomes an oracle for which submissions exist. The
annotation now says `401 | 404`, so a fourth status has to be a deliberate edit.

**4. The caller id, carried out of the gate instead of cast — 1 error.**
`authorizeTeamAdmin` refuses a null caller with 401 before anything else, so a
route holding `ok: true` has a known caller id. That narrowing happened inside
the gate where the routes could not see it, and three of them wrote
`callerId as string` to say so. `TeamAuthorizationResult`'s success arm carries
`callerId` now. The audit-trail lookup that could not type-check reads the
verified id; the three casts are gone.

**5. Environment read once, and named — 1 error.** `kv_store` handed
`Deno.env.get(...)` straight to `createClient`. Absent, that already threw — on
the first KV call, without naming which variable the deployment was missing. It
still throws; the message now names the variable, never its value (the second of
them is the service-role key).

## A LATENT CRASH, NOT A DORMANT ANNOTATION

`repositories/index.ts` re-exported `createReportRepository`, which **does not
exist**. `reportRepository.ts` is a **byte-identical copy** of
`outcomeRepository.ts` — created and never rewritten — so the only thing it
exports is `createOutcomeRepository`.

A named re-export of a missing member fails at **ESM link time**. The first
module to import that barrel would not have received a wrong repository; it
would have failed to load at all. Nothing imports it yet, which is the only
reason it never fired.

The dead line is removed. The repository named by **MQC-SVC-015** ("client
report repository with version history") therefore has a type in
`diagnosticTypes.ts` and **no implementation** — recorded below as a V1 gap
rather than written during a type-check pass.

## REMAINING BOUNDARY ISSUES — RECORDED, NOT FIXED

**`migration/**` under the Deno sweep — 24 errors.** Confirmed, not assumed:
`supabase/functions/server/migration/**` is imported by **no** deployed entry
point and by exactly one consumer, `scripts/migration/*.ts`, which runs under
Node. Seventeen of the 24 are `TS2307` on the bare specifier
`@supabase/supabase-js`; the other seven are implicit-`any` cascading from the
untyped client that unresolved import leaves behind. The rest of the server
imports `jsr:@supabase/supabase-js@2.49.8` and `deno.json` carries no import
map, so the bare specifier is exactly what Node-targeted code looks like. The
`server` boundary defines itself as "everything else under `supabase/functions/`"
and sweeps it in. **This is a boundary definition, not a code defect** — the
mirror of the failure the script's own header warns about for `tsc`. Splitting
it out is the author's call and would not by itself turn `typecheck:api` green,
so it is left recorded here.

**`typecheck:tests` — 27 errors, pre-existing.** Measured at **27 on
`origin/main` and 27 on this branch**: unchanged by this work, and not in the
milestone gate list. Twenty-three of them are in Deno-targeted
`supabase/functions/server/ai/**` files that the authoritative Deno checker
passes at exit 0; `tsconfig.node.json` includes `tests` and `scripts`, whose
graphs reach into those files, and the two checkers run **different TypeScript
versions** (Node `tsc` 5.9.3, Deno's bundled 6.0.3). Whether that difference is
the whole explanation is not established here and needs its own pass.

**Two database checks could not run here.** `test:database` skips
`kv_compare_and_swap` and `test:database:diagnostic` reports `BLOCKED: no
reachable PostgreSQL` — both for want of a live database in this container, both
pre-existing, and neither touched by this change, which alters no SQL, no schema
and no query. NOT RUN is not a pass, and is not claimed as one.

## SELF-REVIEW

Four files changed, all under `supabase/functions/server/`. No test file, no
migration file, no deployment or configuration file touched. No auth semantics
changed — the two type changes that touch authorization (`401 | 404`,
`callerId: string`) both **narrow**. No response shape changed. No new network
path, no new tenant-trust path. No secret is logged or returned: `requireEnv`
names the variable, never its value. The `stack` the diagnostic route already
returned is preserved as-is — removing it is a security decision, not a
type-check one, and is left for certification.

## TESTS

features **1217** · security **859** · AI **2183** · system **170** ·
migration **210** · boundaries **107** · lifecycle **241** · diagnostic **176** ·
database **206 pass / 1 skipped** — all pass, zero failures. Production build
succeeds.

`typecheck:api:ai` exit 0 · `typecheck:web` 0 · deployed Deno surface (341
files) exit 0.

## NEXT EXACT TASK

1. **Write the report repository (MQC-SVC-015).** Canon marks it LIVE with
   "version history"; the file is a copy of the outcome repository and the
   interface in `diagnosticTypes.ts` has no implementation. Implement it against
   that interface, restore the barrel export, and strengthen
   `tests/database/static_diagnostic_migration.test.ts`, which asserts only
   `export function create` and so passed while the wrong function was exported.
2. **Decide the `migration/**` boundary.** Either give it its own boundary in
   `scripts/typecheck-deno.mjs` with the Node checker that owns it, or move it
   out from under `supabase/functions/`. A code change to those files is the
   wrong answer.
3. **Investigate `typecheck:tests` (27, pre-existing).**
4. **Canon review**: `DiagnosticQuestion` / `ProgressModal` marked LIVE but never
   mounted. Wire them up or correct the manifest.
5. **Design review**: chip-on-own-tint contrast (4.17:1, under AA) and the
   marketing type ramp.

Not started, deliberately: production deployment, final security certification,
the deferred 4E rollout.

---

_Last updated: 2026-09-10, at deployed Edge Function typecheck closure — 99 to 0
with three casts removed and nothing suppressed._

---

# REPORT REPOSITORY CLOSURE — MQC-SVC-015

_Branch `claude/report-repository-mqc-svc-015`, from main `9e656240`._

## THE GAP, CONFIRMED INDEPENDENTLY

`reportRepository.ts` and `outcomeRepository.ts` shared one md5
(`608daf3c1d5b6bea415cc6697fb2b524`). The report repository exported
`createOutcomeRepository`, queried the `outcomes` table, and no file under
`supabase/functions/` read `reports` or `report_versions` at all. Canon marks
**MQC-SVC-015 LIVE** — "client report repository with version history" — so the
repository the manifest names did not exist, and the `ReportRepository`
interface had no implementation.

## WHAT THE SCHEMA FORCED — AND WHERE THE COPY WOULD HAVE BEEN WRONG

**`report_versions` is append-only.** No `deleted_at`, no `updated_at`, no
`updated_by` — unlike `reports`, which has all three. A
`.is('deleted_at', null)` on the versions table type-checks, passes a naive
fake, and fails against a real database. The version reads deliberately do not
filter it, and both suites pin that.

**`reports_submission_idx` is NOT unique.** A submission can carry more than one
report — a regenerated diagnostic is a second row, not an edit. So
`getReportBySubmission` orders newest-first with `id` as a tie-break rather than
expecting a single row: two reports written in the same clock tick still resolve
to one answer instead of to whichever the planner happens to return.

**The database does not enforce tenancy on a version's parent.**
`report_versions.report_id` and `.organization_id` are independent fields and
only the first is foreign-keyed. **Verified live: the cross-tenant insert
succeeds.** Such a row is invisible to its own parent's organization scope while
still hanging off that parent. `createReportVersion` reads the parent in the
caller's organization first — that guard is load-bearing, not belt-and-braces,
and the live test asserts the gap it closes still exists.

**`updateReport` strips identity, tenancy and provenance.**
`Partial<ReportRecord>` structurally includes `organization_id`; spreading it
would let a row found by one organization be handed to another — a cross-tenant
write dressed as an edit.

**`current_version` is not advanced by `createReportVersion`.** The canonical
interface keeps the two operations separate, so which version a report points at
stays the caller's decision. Coupling them would publish every draft the moment
it was written.

## THE TEST THAT LET IT THROUGH, AND WHAT REPLACED IT

The static suite asserted `/export function create/` per file. The defective
file satisfied it. The contract now names the factory each file must export, the
tables each may and may not read, refuses two repositories that are the same
implementation once comments are stripped, checks every barrel re-export against
its source file, and **derives the required method list from the
`ReportRepository` interface** so a method added to canon becomes a failing test.

**Counterfactual:** restoring the byte-identical copy fails **5** of the new
assertions. The previous suite passed it without complaint.

The behavioural suite (19 steps, recording PostgREST fake) was mutation-tested:
dropping the patch sanitiser, the parent check, a `deleted_at` filter, or the
version ordering each turns it red.

## LIVE DATABASE — RUN, NOT SKIPPED

PostgreSQL 16.13 was started locally and **all 19 migrations applied cleanly**.
That changed what could be proven:

- `test:database` **235/235, zero skipped** (was 217 with 1 skipped — the
  `kv_compare_and_swap` suite ran 19 real tests for the first time here).
- `diagnostic_repository_live.test.sql` — ALL CHECKS PASSED.
- `report_repository_live.test.sql` (new) — ALL CHECKS PASSED.
- `test:database:diagnostic`, `:scenarios`, `:4c`, `:4d` — all passed against a
  real PostgreSQL. Every one of these had reported BLOCKED in this environment
  before.

## VERIFICATION

Deployed Deno typecheck **0** (342 files, exit 0) · `typecheck:api:ai` **0** ·
`typecheck:web` **0** · features **1217** · security **859** · AI **2183** ·
system **170** · migration **210** · boundaries **107** · diagnostic **176** ·
database **235** — all pass. Build succeeds. Barrel proven to LINK at runtime,
not merely type-check.

**MQC-SVC-015: CLOSED.**

---

# V1 COMPLETION AUDIT

Against the five canonical documents, the roadmap, the §VI-5 gap register and
the 327-node manifest. No percentage is offered: the inventory below is the
answer, and a single number would hide that most of what remains is not code.

## COMPLETE

- **Phase 1** S1 Intelligence Gateway, S2 Frontend Gateway Normalization.
- **Phase 2** S3 Database Architecture, S4 Tenancy Foundation, S5 Diagnostic
  Foundation — **the repository layer is now genuinely 5/5**, real and distinct.
- **Phase 3** S6.1–S6.3 migration planning, infrastructure, validation.
- **Phase 4** S7.1–S7.4 runtime storage gateway and outcome shadow read; S7.7
  submission shadow read.
- **Phase 6** AI-01 Batches 1, 2, 3A, 3B, 4A, 4B, 4C, 4D, 4E, 4F. This closes
  **G3 — intelligence breadth**.
- **G5 — enterprise performance instrumentation**, for the two sections the
  blueprint makes buildable: §IV-51 operational health, §IV-48 enterprise KPIs.
- **G7 — strategic surface**, on the documentation axis (Part V LOCKED).
- UI Sprints 1–8, token migration with Class A = 0, ClientPortal live
  authentication path, deployed Edge Function typecheck 99 → 0.

## PARTIAL

- **G1 — Data authority.** Schema, migrations, repositories, backfills,
  reconciliation and shadow reads all exist; **KV is still the runtime
  authority** and no route reads a relational row.
- **G2 — Multi-tenancy enforcement.** `organizations`, RLS policies and
  `tenancyRepository` exist; runtime isolation across every path is still
  maturing. Today's finding is evidence: the database accepts a cross-tenant
  `report_versions` row, and only repository code refuses it.
- **G8 — Maturity.** Startup shape; Growth→Enterprise→Global→AI-native
  approved, not realized (§IV-53).
- **Repositories are not wired to Hono routes** — including this one. That is
  the sprint's stated scope, not an omission.

## MISSING

- **G4 — AI Workforce runtime.** The Part IV executive/department/manager/worker
  runtime does not exist. Reserved to the `ai_worker` identity.
- **G6 — External integrations.** CRM sync, e-sign and scheduling are specified,
  not live. `CRMSyncPanel` is GATED pending credentials.

## DEFERRED BY CANON

- Repository→route wiring (MCV2-S5: "not wired to Hono routes, per sprint scope").
- **S7.6 Lead Shadow Read — CANCELLED**, as a finding: the lead domain has no
  runtime read to shadow, and bulk comparison already exists as
  `npm run migration:reconcile`.
- Part V Future Vision runtime realization; the §IV-53 maturity stages.

## BLOCKED BY LIVE / EXTERNAL DEPENDENCY

None of these are code gaps. Each needs a deployment, a credential or a switch.

- **S7.5 Outcome Shadow Read Validation** — exit condition is a mismatch rate
  over real traffic; needs `MCV2_SHADOW_READ_OUTCOMES` on in a deployment.
- **S7.8 Full Runtime Validation**; **Phase 5 S8.1–S8.3 SQL cutover**.
- **Phase 2 backfill execution** — CODE COMPLETE, NOT RUN. Running it against
  real data is a deployment action.
- Live AI provider traffic (`AI_ALLOW_REAL_REQUESTS`); the certified diagnostic
  review capability (`AI_DIAGNOSTIC_REVIEW_ENABLED`, off by default).
- `FEATURES.BACKEND_INTEGRATION` is **false**, which is what makes the 9 DEMO
  manifest nodes demo. They are wired, not unbuilt.
- CRM sync credentials. Production deployment. Final security certification.

## PARKING LOT / POST-V1

- G4 AI Workforce runtime; the G8 maturity stages.
- `ABTestingPanel` — gated, deliberately absent from navigation.
- `LearningLoopPanel` — needs ≥50 closed submissions to mean anything.

## DOCUMENTATION INCONSISTENCIES

- **`DiagnosticQuestion` (MQC-COMP-005) is marked LIVE and has zero code
  references** — only registry and manifest metadata mention it.
- **`ProgressModal` (MQC-COMP-085) is NOT independently dead.** It is imported
  and mounted by `DiagnosticQuestion`. An earlier checkpoint listed the two
  together as unmounted; only the first is. Deleting `DiagnosticQuestion`
  without noticing would orphan the second.
- Manifest `lastVerified: 2026-07-31`, `version: 2.1.0` — stale against
  everything since.
- `MARQ_CORTEX_STABILIZATION_ROADMAP.md` is a zero-byte file.

## HUMAN DECISIONS REQUIRED

1. Chip-on-own-tint contrast (**4.17:1**, under AA) and the marketing type ramp.
2. The `migration/**` boundary: own boundary in `typecheck-deno.mjs`, or move it
   out from under `supabase/functions/`. **24 Deno errors, all Node-targeted.**
3. `typecheck:tests` — **27 errors, pre-existing and unchanged**; 23 are in
   Deno-targeted AI files the authoritative checker passes, across two
   TypeScript versions (5.9.3 vs 6.0.3).
4. `DiagnosticQuestion`: wire it, or delete it and `ProgressModal` together.
5. Switching on shadow reads, running the backfill, deploying, certifying.

## NEXT 5 HIGHEST-PRIORITY V1 TASKS

1. **Reconciliation for the cortex and outcome domains** — the roadmap's own
   next sprint, and the last code-side prerequisite for Phase 5.
2. **Resolve the two typecheck boundaries** (`migration/**` 24,
   `typecheck:tests` 27). Both are classification, not defects; both currently
   make a green tree read red.
3. **Canon reconciliation** — `DiagnosticQuestion`/`ProgressModal`, the stale
   manifest `lastVerified`, the empty stabilization roadmap.
4. **G2 runtime tenancy audit** — enumerate every path that trusts a caller-
   supplied `organization_id` where the database does not enforce it. The
   `report_versions` finding is unlikely to be the only one.
5. **The two design decisions** (chip contrast, type ramp) — blocking nothing
   technical, but they are the last known AA gap.

Not started, deliberately: production deployment, final security certification,
the 4E rollout.

---

_Last updated: 2026-09-10, at MQC-SVC-015 closure — a real report repository,
proven against a real PostgreSQL, and a V1 audit that counts rather than
estimates._

---

# CORTEX + OUTCOME RECONCILIATION — PROVEN, AND A CORRECTION

_Branch `claude/cortex-outcome-reconciliation`, from main `1f4ef999`._

## THE CORRECTION FIRST

**The reconcilers already existed.** `fdffd214` implemented cortex and outcome
reconciliation, retired the bespoke submission reconciler into a shared
domain-parameterised engine, and wired all three domains into the orchestrator.

The roadmap's "Next Sprint: reconciliation for the cortex and outcome domains"
was written in `203d5e38` — **before** `fdffd214` — and never updated. The
previous V1 audit read that line and reported it as the top priority without
checking it against the code. That was my error, and it is the reason
`V1_COMPLETION_CHECKLIST.md` now exists and why every PARTIAL and MISSING row in
it is verified against code rather than against a document.

## THE REAL GAP, AND IT WAS REAL

Every reconciliation test drove the reconcilers over `fakeSupabase.ts`. A fake
proves the **arithmetic** — given these records and those rows, this many are
missing — and agrees with whatever the author believed about the query it was
handed. It cannot show that `NOT legacy_kv_key IS NULL` excludes what was meant,
that `.is('deleted_at', null)` really drops a soft-deleted row, that a `numeric`
column returns something the comparator accepts, or that the organization filter
isolates. Those are properties of PostgreSQL.

**Nothing had ever run a reconciler against a database.** The live harness
covered the *backfills* (110–113) and stopped there.

## WHAT NOW RUNS

The real reconcilers, unmodified, against a real PostgreSQL 16. Only the
transport is substituted: `tests/database/harness/postgrestOverPsql.mjs`
translates the builder chain into SQL. An operator it does not implement throws
by name rather than quietly returning the wrong rows.

**21 scenarios**, `npm run test:database:reconciliation`:

*Outcome* — exact match · missing relational row · orphan · field mismatch ·
verdict mismatch · global key uniqueness · cross-tenant ownership · soft delete
· empty-string/NULL normalization · quarantine without a guessed verdict ·
duplicate identity refused by the database.

*Cortex* — the two the shared reconciler cannot express: a **partially written**
analysis (three rows present is not three successes) and one whose pillars
arrived **unscaled** (four rows present, every one of them 4 instead of 80,
which row-presence reports as perfectly healthy). Plus missing rows, the
awaiting-submission split, single-pillar mismatch, orphans, skipped analyses,
cross-tenant scores, and a soft-deleted submission.

## TWO THINGS THE DATABASE TAUGHT THE SCENARIOS

- **`submissions.legacy_kv_key` is GLOBALLY unique, not per-organization.** Two
  tenants cannot hold one KV key at all. My first cross-tenant scenario assumed
  they could and was refused by the index; the scenario was wrong, not the
  schema.
- **A soft-deleted submission takes its analysis out of scope on the
  awaiting-submission side**, not the orphan side — its scores cannot be
  attributed either way, which is the reconciler declining to guess.

Both are recorded in `V1_COMPLETION_CHECKLIST.md` under the tenancy audit,
because both mean an invariant lives in code rather than in the database.

## RECONCILIATION MUST NOT WRITE

No `runId` is passed, which is what suppresses `persistReconciliationLog`. Each
reconcile call is wrapped in a before/after row-count assertion across all five
tables — a reconciliation that repaired what it measured would report a healthy
estate it had just created.

## MUTATION-TESTED

| Mutation | Caught by |
|---|---|
| **The old lead bug** — field mismatch hard-coded to zero | `outcome — a field mismatch is detected and named` |
| Drop the organization filter on target rows | `outcome — a row owned by another organization…` |
| Drop the soft-delete filter | `outcome — a soft-deleted row is not a target row` |
| Cortex stops splitting "awaiting submission" | `cortex — waiting for a submission is counted apart…` |

Each failed at exactly the scenario named for it; both files restored identical
afterwards.

## VERIFICATION

Deployed Deno typecheck **0** (342 files) · `typecheck:api:ai` **0** ·
`typecheck:web` **0** · migration **210** · database **235** (zero skipped) ·
diagnostic **176** · features **1217** · security **859** · AI **2183** ·
system **170** · lifecycle **241** · boundaries **107** · reconciliation
scenarios **21** · backfill and membership live suites pass · build ✓.

## NEXT

`docs/development/V1_COMPLETION_CHECKLIST.md` is now the authoritative state.
Its first item is the **P2 tenancy audit** — the only PARTIAL closable with code
alone, needing no deployment, and already carrying two confirmed findings.

---

_Last updated: 2026-09-10, at cortex/outcome reconciliation proof — and a
correction to the priority that produced it._

---

# G2 — MULTI-TENANCY ENFORCEMENT, CLOSED

_Branch `claude/g2-multi-tenancy-enforcement`, from main `0cc934a1`._

## THE FINDING WAS BIGGER THAN THE FINDING

The checklist carried one instance: `report_versions` could name a parent report
in another organization. The audit found the same hole in **all fourteen**
parent-child relationships in the diagnostic domain. Every child table carries
`organization_id` AND a foreign key to a parent that carries its own, and
nothing in the schema said the two had to agree.

Worse than the count: the report repository's parent check — added last session —
was the **only** enforcement of that invariant anywhere in the codebase. One
guarded path out of fourteen. Reference Architecture §7.22 requires isolation
across every layer and forbids reimplementing a cross-cutting concern
inconsistently per domain; §11.8 says isolation shall never be bypassed. One
guard out of fourteen *is* that inconsistency, not a mitigation of it.

## MEASURED BEFORE IT WAS FIXED

`npm run test:database:tenancy -- --expect-gap` applies the schema **without**
the new migration and asserts the *unprotected* behaviour: all fourteen
cross-tenant children accepted, plus both cross-tenant UPDATEs — a report
re-parented onto another tenant's submission, and a report handed to another
organization outright. The "before" is evidence, not a memory.

## WHY THE DATABASE, AND NOT RLS

The repositories and the migration engine run as `service_role`, which
**bypasses RLS by design** — asserted live, so the claim is not folklore. Policy
rows were never the layer that could close this. A composite foreign key is: it
is checked for every writer, including routes not yet written, and cannot be
forgotten by a new call site.

Forward-only and non-destructive. No column added, dropped or retyped; no row
written. Each parent gains `UNIQUE (id, organization_id)`, already true because
`id` is the primary key. The migration **validates before it alters** and names
the offending table and row count, because an operator reading a failed
deployment needs to know which data to fix — not just which constraint objected.

**The `SET NULL` column list is load-bearing.** Four of the fourteen are
`SET NULL`. On a two-column key with no column list, PostgreSQL nulls
`organization_id` too — and it is `NOT NULL`, so deleting a parent fails
outright and a routine tidy-up becomes an outage. Mutation-testing removes the
list and produces exactly that: `null value in column "organization_id" ...
violates not-null constraint`.

## THE APPLICATION LAYER WAS ALREADY SOUND

The audit followed request → authorization → repository → database rather than
grepping for `organization_id`, and found no class-F path above SQL:

- `resolveOrganization` admits an organization hint **only** against verified
  memberships; a foreign id returns `ORGANIZATION_NOT_RESOLVED`. Multi-membership
  with no hint is a deterministic **refusal**, never a pick. No membership fails
  closed. **A platform admin has no exemption here.**
- `readScopeFor` discards the caller's `?organizationId` unless the actor holds
  `agent.run.read.platform` — granted only to `super_admin`/`platform_admin`,
  which come from server-written `app_metadata`, never from an organization role.
- Every agent and workflow **mutation** passes `undefined` instead, so the
  platform *read* capability cannot widen a control action. `decideApproval`
  says so explicitly: "nobody decides another tenant's approvals, at any role."
- BYOK puts no organization id in any path or body, deliberately: "a tenant that
  appears in a URL is a tenant somebody will eventually trust."

## `legacy_kv_key` — CLASSIFIED, NOT CHANGED

**Intentional canonical identity.** The KV namespace it names has no organization
concept; `sub:{id}` was a global address before tenancy existed. Global
uniqueness is therefore *stronger* than per-organization would be — two tenants
cannot claim one key at all — and a lookup by key still cannot cross the
organization filter. Both proven live. Left unchanged.

## THE REPOSITORY GUARD KEPT ITS PLACE, NOT ITS JOB

`createReportVersion` still reads its parent. Its comment now says why: it turns
a foreign-key violation — a 500 carrying a constraint name — into the same typed
`NOT_FOUND` every other miss reports. That is an error-shape decision. The
invariant lives beneath it now, and nobody reading that file should believe the
guard is what stands between the tenants.

## VERIFICATION

**27 live scenarios** (`test:database:tenancy`), both directions. Static suite
**29** — it derives the relationship list from the foundation migration, so a
child table added later without a composite key fails a test rather than opening
a hole quietly. That assertion was itself mutation-tested twice: the first
version matched the migration's pre-flight block and did **not** bite; scoped to
the constraint block, it does.

All 20 migrations apply in order to a bare PostgreSQL 16; the new one is
idempotent; the diagnostic rollback still runs.

Deployed Deno typecheck **0** (342 files) · `typecheck:api:ai` **0** ·
`typecheck:web` **0** · database **242** (zero skipped) · tenancy **27** ·
reconciliation **21** · backfill, membership, 4C and 4D live suites pass ·
security **859** · features **1217** · system **170** · lifecycle **241** ·
AI **2183** · migration **210** · diagnostic **176** · boundaries **107** ·
build ✓.

**G2: COMPLETE.**

---

_Last updated: 2026-09-10, at G2 closure — fourteen relationships, one
constraint strategy, and the gap proven before it was closed._
