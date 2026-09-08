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

**UI Sprint 7 — Onboarding and Design-Token Convergence. Both halves delivered.**

Phase 6 — AI Platform: AI-01 Batch 4 complete through 4F. **Merged to `main`**
(PR #45), together with every backend unit from the previous session.
Phase 4 — Runtime Storage Gateway: shadow read delivered for both domains that
have runtime reads; Phase 2 backfill and reconciliation delivered for every KV
namespace that holds stored data.
Gap register G5 — enterprise performance instrumentation: closed for the two
sections the blueprint makes buildable.

## CURRENT BATCH

None in flight. Thirteen commits on `claude/marq-cortex-ui-sprint-7-11jp3g`,
all pushed, all unmerged. UI Sprint 7's two halves are delivered, and the sprint
continued into the canonical journeys either side of the console.

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

## COMMITS CREATED

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

## TEST RESULTS

Every suite run at the end of the session. No test was weakened, skipped or
deleted, and no backend suite regressed — this sprint touched the browser bundle
only, and the backend suites confirm it.

| Suite | Result |
|---|---|
| `npm run test:ai` | 2,183 pass |
| `npm run test:security` | 859 pass |
| `npm run test:features` | **984 pass** (774 at session start) |
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

**Nine test files added**: `teamRoleVocabulary`, `orientation`, `designTokens`,
`consoleSurfaces`, `payloadNarrowing`, `consoleAccessibility`,
`clientPortalIntegrity`, `failureIsNotData`, `statusColorConsistency`,
`publicFunnelAccess`, `dialogSemantics`.

**Two existing assertions were updated rather than deleted**, each with the
reason recorded in place: `breadcrumbContract` pinned eight label literals that
were incidental evidence for an older type-only change and had already drifted
from the sidebar's own labels, and `teamSessionKeys` pinned the exact `useApp()`
destructuring and the pre-`teamRole` session shape.

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
- The `server` deno boundary cannot be type-checked here: `jsr.io` is not
  routable from this environment (an egress restriction, pre-existing). The
  `ai` and `registry-free` boundaries both check clean.
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

_Last updated: 2026-09-08, after UI Sprint 7 — onboarding, design tokens, the
four feedback states, payload narrowing, the client portal, the public funnel,
the diagnostic, and dialog semantics._
