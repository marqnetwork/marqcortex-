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

**PRODUCT/UI IMPLEMENTATION.** The documented AI-01 batch sequence ends at 4F
and 4F is merged (PR #45, `04bdfba`). There is no Batch 5. The next genuine
buildable stage is the product/UI surface, against
`MARQ_CORTEX_PRODUCT_EXPERIENCE.md` — tracked in
`docs/development/UI_IMPLEMENTATION_MAP.md`, which is the audit of the shipped
UI against canon plus the sprint sequence.

Phase 6 — AI Platform: AI-01 Batch 4 complete through 4F.
Phase 4 — Runtime Storage Gateway: shadow read delivered for both domains that
have runtime reads; Phase 2 backfill and reconciliation delivered for every KV
namespace that holds stored data.
Gap register G5 — enterprise performance instrumentation: closed for the two
sections the blueprint makes buildable.

## CURRENT BATCH

UI implementation, sprints 1-4 complete. See THIS SESSION below.

## COMPLETED — PRIOR SESSION (Batch 4F, merged as PR #45)

**AI-01 Batch 4F — Routing, Failover and Economics.**
`supabase/functions/server/ai/routing/`. A deterministic governed policy that
ORDERS providers the selector already found eligible and can never admit one;
four strategies under four invariants; a governed failover breadth; and a
per-request BILLABLE ATTEMPT BUDGET that closes the certified defect where the
spend guard reserved `maxAttempts` per request while the pipeline granted
`maxAttempts` to every failover candidate. The certified 105,920 µUSD
`cortex.chat` hold did not move — the execution path now matches it. Economics,
metrics, events, an admin read model and a Routing console tab.
Report: `architecture/ai/AI-01-BATCH-4F-COMPLETION.md`, `ARCHITECT.md` §12.7.

**MCV2-S7.4 — Outcome Shadow Read.** `supabase/functions/server/storage/`. The
instrument Phase 3 needs before anything reads SQL first: it serves the KV
answer, reads the relational row alongside it under a deadline, records whether
they agree, and returns nothing. Never changes what is served, never fails a
request, never runs unbounded, never records a customer value. Off by default.

**MCV2-S7.6 (cancelled, as a finding) and S7.7 — Submission Shadow Read.** The
lead domain has no runtime read to shadow — leads are written by two capture
routes and no route serves one — and bulk comparison for that domain already
exists as `migration:reconcile`. S7.7 aimed the same instrument at the core
entity, sharing one reader, one deadline and one report.
Report: `architecture/database/MCV2-S7.6-S7.7-SHADOW-READ-COMPLETION.md`.

**MCV2 Phase 2 — the diagnostic-domain backfills.** Submissions, cortex
analyses and outcomes: normalizers carrying every mapping judgement, domain
processors and writers, and an orchestrator refactor that runs any domain
through one loop. Reconciliation for all four domains, comparing FIELDS through
the same comparator the shadow read uses. Verified against a real PostgreSQL 16
in dependency order (`npm run test:database:diagnostic`).
Report: `architecture/database/MCV2-PHASE2-SUBMISSION-BACKFILL-COMPLETION.md`.

**Gap-register G5 — enterprise performance instrumentation.** Two blueprint
sections closed. §IV-51 the operational health framework
(`supabase/functions/server/health/`, `GET /health/enterprise`): rolls signals
the platform already publishes up to the four approved dimensions, with no SLO,
threshold, alert or dashboard, and with the discipline that an unreadable signal
is `unknown` and `unknown` never rolls up as healthy. §IV-48 enterprise KPIs
(`supabase/functions/server/kpi/`, `GET /kpis`): eight named indicators per
approved category, with the anti-metric exclusion enforced at registration —
an indicator that names no constitutional success dimension cannot be
registered — and no target, threshold or grade anywhere.
Report: `architecture/ENTERPRISE-PERFORMANCE-INSTRUMENTATION.md`.

**Manifest registration.** Eleven new SVC nodes for this session's subsystems,
as Article 14 requires, with the certified counts moved to match.

Two findings recorded rather than worked around: **the report domain has no KV
source** (the client report is built on every read from `sub:` and `cortex:`, so
"generate version 1 on first backfill" is a product decision about storing
report history, not a data migration), and **the certified lead reconciliation
reported a field-level pass it never made** (`sampleMismatchCount` was the
literal zero) — that one is fixed, with tests.

## COMMITS — PRIOR SESSION

On `claude/marq-cortex-batch-4f-c1hmm0`, from `b13d3a3`:

1. `feat(ai): a routing policy that orders what it is given and admits nothing`
2. `feat(ai): a request may not spend more paid attempts than were reserved for it`
3. `feat(storage): measure whether the other store agrees, without letting it answer`
4. `feat(storage): aim the shadow read at the core entity, and say why one domain cannot have one`
5. `feat(migration): decide the submission mapping in one pure function, and name every guess`
6. `feat(migration): one migration loop, two domains, and a backfill that converges`
7. `test(migration): prove the submission backfill against a real PostgreSQL`
8. `docs: checkpoint the autonomous build after 4F, the shadow reads and the submission backfill`
9. `feat(migration): a reconciliation that compares fields, not only counts`
10. `fix(migration): the lead reconciliation reported a field check it never ran`
11. `feat(migration): the cortex analysis domain, which enriches and never overwrites`
12. `feat(migration): the outcome domain, which refuses to guess a verdict`
13. `docs(roadmap): Phase 2 is code complete for every KV namespace with stored data`
14. `feat(migration): reconcile every domain, through one comparator`
15. `docs: checkpoint after the diagnostic-domain backfills and reconciliation`
16. `feat(health): roll the signals up to the four dimensions, and refuse to grade them`
17. `feat(kpi): name the indicators, and refuse the ones that measure activity`
18. `docs(manifest): register this session's subsystems, as Article 14 requires`

## TEST RESULTS — PRIOR SESSION

| Suite | Result |
|---|---|
| `npm run test:ai` | 2,183 pass |
| `npm run verify:4f` | 167 pass |
| `npm run test:security` | 859 pass |
| `npm run test:features` | 774 pass |
| `npm run test:system` | 170 pass |
| `npm run test:migration` | 210 pass |
| `npm run verify:health` | 48 pass (health framework + KPIs) |
| `npm run scan:boundaries` | 107 pass |
| `npm run test:database` | 206 pass, 1 skipped without `DATABASE_URL` |
| `npm run test:database:diagnostic` | 8 assertions, real PostgreSQL 16 |
| `npm run test:database:4c` / `:4d` / `:scenarios` | pass, real PostgreSQL (regression) |
| `kv_compare_and_swap` with `DATABASE_URL` | 19 pass — had never run in this environment |
| `npm run typecheck:api:ai` / `:pure` | clean |
| `npm run typecheck:web` | 34 errors — identical to the pre-session baseline |
| `npm run typecheck:tests` | 27 errors — **two below** the baseline (the `leads.ts` pair is fixed) |
| `npm run build` | clean |

No test was weakened, skipped or deleted. No test reaches a real provider.

## A DATABASE IS AVAILABLE IN THIS ENVIRONMENT

PostgreSQL 16 is installed but not started at session start. To use it:

```
service postgresql start
su postgres -c "psql -c \"CREATE ROLE root SUPERUSER LOGIN PASSWORD 'harness'\""
su postgres -c "psql -c 'CREATE DATABASE root OWNER root'"
export DATABASE_URL="postgresql://root:harness@localhost:5432/root"
```

Every `test:database:*` harness then runs for real. Earlier sessions treated
these as unrunnable; they are not.

## KNOWN NON-BLOCKING ISSUES

- 34 pre-existing `typecheck:web` and 29 pre-existing `typecheck:tests` errors,
  all in files unrelated to this session's work (proposal viewer, snapshot
  engine, mapping engine, mock data, migration lead domain, workflow expression
  validation). Present at `b13d3a3`. Worth a cleanup sprint before UI/UX.
- The `server` deno boundary cannot be type-checked here: `jsr.io` is not
  routable from this environment (an egress restriction, pre-existing). The
  `ai` and `registry-free` boundaries both check clean.
- The certified lead reconciliation's dead code and hard-coded field check are
  fixed; the `leads.ts` type errors are fixed. Nothing else is known-broken in
  the migration engine.

## CURRENT BRANCH

`claude/marq-cortex-batch-4f-c1hmm0` — pushed, 19 commits ahead of `origin/main`.
**Not merged.** No PR has been opened; the session prompt did not authorise one.

## NEXT EXACT TASK

Everything dependency-safe and documented has been built. What remains needs a
human decision, and the decisions are named below rather than guessed at.

**1. A merge decision on this branch.** Nineteen commits, no PR opened — the
session prompt did not authorise one. Nothing here is merged.

**2. G4 — the AI Workforce runtime. STOP CONDITION, not an oversight.**
§IV-24 fixes twelve worker categories and §IV-25 eight lifecycle stages, and
both say plainly that the implementation is "deferred to later Phase 4.x" —
individual workers in §IV-24, and provisioning, identity and registry in §IV-25.

The buildable shape would be a workforce registry and lifecycle state machine
starting empty, exactly as Batch 3A did for agents. But that is a SECOND
registry beside the agent runtime, and whether Cortex realizes the workforce
layer now — and as its own registry rather than as a facet of the agent one — is
a sequencing and architecture decision the canon explicitly defers to a human.
Starting it autonomously would be choosing it. Scope it deliberately with a
person; do not begin it at the end of a session.

**3. G6 — external integrations** (CRM sync, e-sign, scheduling). Needs
third-party credentials and accounts. Blocked.

**4. G1/G2 — data authority and enforced tenancy.** The instrument and the
backfills exist; running them and cutting over is a deployment action.

**5. Blueprint corrections a human should confirm.** The gap register still
describes G3 as "gateway is live single-provider"; AI-01 Batches 1 through 4F
have not been true of that for a long time. G5 should move from NOT IMPLEMENTED
to PARTIAL — §IV-51 and §IV-48 are built; §IV-49 remains deferred by the canon
itself, and §IV-52/§IV-53 are organisational frameworks rather than runtime
capabilities.

**6. A cleanup sprint** on the 34 pre-existing `typecheck:web` errors, before
the UI/UX stage. None are in anything this session touched.

## BLOCKERS

- **MCV2-S7.5 — Outcome Shadow Read Validation.** Its exit condition is a
  mismatch rate measured over real traffic, which needs
  `MCV2_SHADOW_READ_OUTCOMES` switched on in a deployment. Human decision.
- **Running any backfill against real data.** Needs production credentials and a
  human decision.
- **G4 — the AI Workforce runtime.** The canon defers its implementation to a
  later phase; realizing it is a sequencing and architecture decision for a
  human. See NEXT EXACT TASK item 2.
- **G6 — external integrations.** Needs third-party credentials.

## PRODUCTION WORK DEFERRED

- **Batch 4E production rollout** — deferred to final production hardening.
  Untouched by this session.
- **Batch 4C/4D production gates** — applying the provider-administration and
  BYOK migrations and setting `AI_CREDENTIAL_ENCRYPTION_KEY` still need human
  authorisation.
- **Batch 4F needs no production action.** No migration, no secret, no required
  variable. `AI_ROUTING_STRATEGY` defaults to `preference` (the pre-4F order
  exactly) and `AI_ROUTING_MAX_PROVIDERS` to 3. The one behaviour a deployment
  inherits without configuring anything is the billable attempt budget, which is
  a narrowing of spend and a correction of the certified invariant.
- **The shadow reads need no production action either.** Both switches
  (`MCV2_SHADOW_READ_OUTCOMES`, `MCV2_SHADOW_READ_SUBMISSIONS`) are off by
  default, and with them off the routes behave exactly as before.
- **The health and KPI surfaces need no production action.** Both are team-auth
  reads over signals that already exist; neither writes anything, and the
  anonymous `/health` uptime endpoint is unchanged.
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

_Last updated: 2026-09-07, after UI sprints 1-6._
