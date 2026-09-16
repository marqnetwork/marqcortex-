# CP-1 — Turn the product on

**What changed, what it cost, and what is still not proven.**

Executed against `da46382b` (main at the time of the Product Reality audit).
Companions: `MARQ_CORTEX_PRODUCT_REALITY.md` (the evidence CP-1 answers) and
`MARQ_CORTEX_ACCELERATED_BUILD_PLAN.md` (which scoped it).

---

## 0. Status

| | |
|---|---|
| **CP-1** | **CODE COMPLETE** |
| **Live Supabase verified** | **NO — BLOCKED** |
| Product completeness before | ~30% |
| Product completeness after | ~34% |

CP-1 is **not** "product complete". It did not add a product capability; it made
the ones that exist tell the truth. The completeness number moves a little
because two things a user can do changed — an empty workspace is now reachable
and legible, and every declared destination now resolves — and because the
platform underneath is, for the first time, the thing the product reads.

**Do not report CP-1 as live-verified.** See §6.

---

## 1. The conflation that caused most of it

`isDemo()` was `!FEATURES.BACKEND_INTEGRATION`. "Is the backend off?" and "is
this a demo?" were the same question with the same answer, and the shipped
default answered yes to both. Everything else followed:

- the normal configuration served fiction;
- every `catch` in the console had a fixture within reach;
- the login screen's credential hints were gated on "the backend is off", which
  is to say ungated in practice.

They are two questions now:

```
BACKEND_INTEGRATION   is a real backend configured?
DEMO_EXPERIENCE       is this an explicitly designated demo?   (default: off)
```

`isDemoExperience()` requires `DEMO_EXPERIENCE` **on** and `BACKEND_INTEGRATION`
**off**. They can never both hold, so once a backend is configured no code path
can reach a fabricated answer — however badly that backend behaves. That single
invariant is what makes "a failure is never answered with a fixture" structural
rather than a habit.

---

## 2. Fabricated data inventory, by surface

Grouped by product surface, as the sprint asked, rather than by constant.

| Surface | Was | Real backend available? | Action taken |
|---|---|---|---|
| Dashboard / Command Center | `getDemoSubmissions()`, `ACTIVITY_FEED` (8 invented events), Team Pulse's invented roster and per-member activity | ✅ `GET /submissions`, `GET /team/members` | Wired; honest LOADING / EMPTY / ERROR / DENIED |
| All Leads (`FullFeaturedDashboard`) | `SEED_SUBMISSIONS` at module scope, used on the no-backend path, in the `catch`, **and on a successful empty response** | ✅ `GET /submissions` | Wired; empty is empty |
| CORTEX | `getMockLeads()` on empty and on error; `getMockCortexLeadData(leadId)` for any unknown id | ✅ `GET /submissions`, `GET /submissions/:id/cortex` | Wired; unknown id → NOT FOUND |
| Analytics | `generateDemoSubmissions()` — 20 records from `Math.random()`, charted as conversion rates | ✅ `GET /analytics/overview` | Wired; incomplete 200 → failed load |
| Engagement Intelligence | inline `EngagementAnalytics` literal (15 reports, 80% view rate, "High Engagement Co" at 95) | ✅ `GET /analytics/engagement` | Wired |
| Revenue Intelligence | `MOCK_SNAPSHOTS` — 16 deals, seeded in `core/dashboardAggregator` | ✅ `GET /analytics/revenue-snapshots` | Wired; fixture moved behind the boundary |
| Email Queue | delivery 97%, open 42%, click 18%, bounce 2% — constants × sent count | ❌ no webhook consumer exists | Counts kept; engagement reported as **not measured** |
| Team | `getDemoTeamMembers()` on the no-backend path | ✅ `GET /team/members` | Wired |
| Settings | `demoSettings()` rendered into live form controls above Save | ✅ `GET /settings` | Wired; one fixture, behind the boundary |
| Execution | `MOCK_EXECUTION` whenever the store was empty — i.e. always | ❌ produced by conversion, not persisted | Honest empty state |
| Mapping Engine | `DEMO_SNAPSHOT` — its **only** input, a $42,000 ExampleCo proposal | ❌ no snapshot endpoint | Honest empty state; fixture behind the boundary |
| Client portal | `getDemoClientSubmission()` — the client's real name over a seeded profile, from which the readiness report was derived | ✅ `GET /client/submission/:id` | Wired |
| Client messaging | `getDemoMessages()` — a conversation nobody had | ✅ `GET /client/submission/:id` messages | Wired |
| Proposal viewer | `getDemoProposal()` — a priced proposal under the client's name | ✅ client proposal route | Wired |
| Engagement feed | `getDemoEngagementEvents()` — opens and views the client never performed | ✅ engagement log route | Wired |
| Meeting scheduler | two invented consultants introduced as "Your MARQ Cortex Team" | ❌ no assignment at booking | Says the team will be confirmed |
| Cortex AI chat | 5 keyword-matched replies, in the same bubble a model answers in | ✅ `POST /ai/chat` | Demo-only, and **labelled on each reply** |
| Sign-in (team + client) | credential literals, statically imported so they shipped in every bundle | n/a | Fetched through a demo-gated accessor; `null` otherwise |
| Shell account block | "Team User" / "team@example.com" / "TU", as literals | ✅ session | Reads the session |

**Isolated, not deleted: 5,927 lines** under `src/app/demo/`. The audit counted
4,492; CP-1 found the rest (revenue snapshots, the execution project, the
proposal snapshot, the canned assistant).

---

## 3. The boundary, and what enforces it

```
src/app/demo/
  demoBackend.ts          79 demo responses, lifted out of dataService
  aiDemoResponses.ts      the canned assistant
  fixtures/               demoData, mockCortexData, mockCortexAIBrain,
                          mockAIAnalysis, mockClientReport, revenueSnapshots,
                          executionProject, proposalSnapshot
```

`dataService` reaches it through **one** `await import()` behind **one** guard,
so the fixtures are a separate chunk and no authenticated module links them.
Verified in the built artifact: "Manufacturing Pro", "RetailMax Inc",
"TechCorp Solutions" and the demo password appear in `demoBackend-*.js` and
nowhere else.

`tests/features/demoIsolation.test.ts` is the standing guard. It fails if
authenticated code imports the boundary — statically, dynamically, or through a
re-export — checks that each of the four permitted doors is gated, and refuses
the inline fabrications a boundary alone would not catch. It found two leaks
while being written.

---

## 4. Navigation truth

§7.2 — `?page=execution` and `?page=architecture` rendered the Dashboard. The
resolver had two answers, so a real destination the shell cannot render
collapsed into the fallback exactly like a typo. It has three now
(`shell` / `external` / `unknown`), and only the last falls back.

`externalRoute` is declared on the Destination. It was previously written down
in three places — the shell's `ROUTED_AWAY`, `handleNavigate`, and the execution
route — and the URL agreed with none of them.

Architecture also stopped being a bare page. It is a declared sidebar
destination and selecting it left the product entirely: no shell, no active nav
item, on a phone no navigation at all.

§7.1 — four of the old suite's thirteen ids did not exist, and the same stale
list was in the accessibility audit. Both read the list off the rendered
sidebar now, which renders from `NAV_GROUPS`.

All 13 destinations verified: correct screen, URL survives refresh, no silent
Dashboard fallback, correct nav item active, and all of it again at 390px.

---

## 5. Defects found by doing the work

| # | Defect | Found by |
|---|---|---|
| 1 | Settings crashed the whole console. `data as SettingsResponse` is an assertion; a 200 without `currentUser` threw during render and the route error boundary replaced everything | reloading `?page=settings` in a browser |
| 2 | The demo's `getAnalytics` fixture had drifted years from the shape the page reads. Invisible because the page never called it — it took a `generateDemoSubmissions()` branch instead | first run of the single path |
| 3 | `filterSnapshots` counted its date cutoff from a hardcoded `2026-03-02`, inherited from the fixtures it was written against. On live data "Last 30 days" meant "since 2026-01-31" and widened by a day every day | reading it while moving the fixture |
| 4 | The shell's account block showed an invented person to every operator | a QA screenshot |
| 5 | `SubmissionsListPage` seeded four invented customers at module scope | the isolation guard |
| 6 | The fixture-backend run was not serial, so two workers fought over one global mode — presenting as flakiness rather than as a suite that could not see | three honest-state failures that passed alone |
| 7 | The destination list was read before the sidebar existed, returning empty — which is the §7.1 failure again | a loaded machine |

---

## 6. What is NOT proven — the blocker, stated plainly

**Supabase is unreachable from this environment.** The network policy answers
`403` to a `CONNECT` for `oqybniefkbppptfatoae.supabase.co:443`. No live
request was made, no live row was read, and no production system was contacted.

So the following are **NOT** verified and must not be reported as verified:

- that the deployed edge function returns the shapes these surfaces now parse;
- that RLS and composite-key tenancy behave as the wiring assumes;
- that a real workspace's data renders correctly;
- any claim about production.

What **is** verified is the wiring and the states, against
`tests/helpers/fixture-backend.mjs` — a controlled stand-in speaking the same
routes, which can be told at runtime to be populated, empty, a 500 or a 403.
That harness is the only way to drive the last three in a browser at all: a
live backend does not fail on request. It is a test double and is labelled as
one; its fixtures are named "Fixture Industries" precisely so a screenshot from
it can never be mistaken for real customer data.

**The single external input that unblocks live verification:** egress to the
Supabase project, plus credentials. That has now been the blocker for two
consecutive checkpoints.

---

## 7. Definition of done, checked

| | | |
|---|---|---|
| 1 | Authenticated screens do not silently consume fabricated data | ✅ |
| 2 | Demo data isolated | ✅ 5,927 lines, own chunk, standing guard |
| 3 | Existing real backend paths wired wherever available | ✅ 14 of 19 surfaces; 5 have no backend and say so |
| 4 | Missing backend responses produce honest states | ✅ 5 states, driven in a browser |
| 5 | Navigation destinations resolve correctly | ✅ all 13 |
| 6 | Refresh / deep links work | ✅ all 13, desktop and phone |
| 7 | A standing test prevents demo-data regression | ✅ `demoIsolation.test.ts` |
| 8 | Browser QA passes | ✅ 21 fixture-backend, 21 demo, 4 production-config, 25 release |
| 9 | Durable changes committed and pushed | ✅ |
| 10 | PR merged after gates pass | see the PR |
| — | **Live Supabase verification** | ❌ **BLOCKED** |

---

## 8. What CP-1 deliberately did not do

No new domains, no new entities, no AI work, no agent work, no visual redesign,
no production deployment, no migration work. The five surfaces with no backend
(Email Queue engagement, Execution, Mapping Engine, meeting attendees, and the
AI chat's provenance) were made honest rather than built out — building them is
CP-3 and later.

Two surfaces are now visibly *less* full than before, and that is the intended
outcome: Execution and the Mapping Engine used to show a twelve-week programme
and a $42,000 proposal for a client that does not exist.
