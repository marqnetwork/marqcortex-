# MARQ Cortex — Accelerated Build Plan

**The shortest path from what exists to a product a real person can use.**

Authored 2026-09-16 against main `b349fc1a`. Companion to
`MARQ_CORTEX_PRODUCT_REALITY.md`, which is the evidence this plan rests on.
Neither replaces the canonical documents; both translate them into execution.

**Execution priority has changed.** Production deployment, security
certification, migration hardening and release engineering are **not** the
objective. Building the product the canon describes, on the foundation that
already exists, is.

---

## 1. The strategic finding that sets the order

The platform underneath this product is roughly 80% complete and the product on
top of it is roughly 30% complete — **and they are barely connected**. Five
diagnostic repositories, 21 migrations, composite-key tenancy, an AI control
plane, an agent runtime and a KV→SQL authority mechanism are all real, tested,
and **not read by the running application**, because `VITE_BACKEND_INTEGRATION`
ships `false` and every dashboard imports demo data.

So the first move is not to build new features. **It is to connect the product
to the platform it already has.** That single change converts a large amount of
completed engineering into product value, and it is the precondition for
everything else being real rather than another demo.

---

## 2. Priority ladder

| | Priority | Meaning |
|---|---|---|
| **P0** | User can experience Cortex | Real data path on; nothing fabricated presented as fact |
| **P1** | Core functionality | The work-management and organizational spine the canon requires |
| **P2** | Human × AI | Approvals, explanations, override — in the product, not the admin console |
| **P3** | Agent / AI workforce | A surface that can actually start, watch and govern an agent |
| **P4** | Product experience / UI completion | Deep links, empty states, IA aligned to canon |
| **P5** | Integrations | External ecosystem |
| **P6** | Final hardening | Return to release engineering |
| **P7** | Production | Checkpoint B onward |

Infrastructure polish does not precede missing product function unless it blocks
P0–P4.

---

## 3. Sprint sequence

### CRITICAL PATH

#### CP-1 — Turn the product on (P0) — **CODE COMPLETE, LIVE VERIFICATION BLOCKED**

*Executed. See `MARQ_CORTEX_CP1_RECORD.md`. Every item below is done except the
last, which is the same external input that has blocked two checkpoints:
Supabase is unreachable from the build environment (the network policy answers
403 to a CONNECT for `*.supabase.co`). The states were proved against a
controlled stand-in, which is a test double and is not live verification.*

- **Outcome:** a signed-in user sees their own real data, or an honest empty
  state. No fabricated business data anywhere in an authenticated surface.
- **Canon:** D17 authoritative source of record; PX Ch35 honesty; MB III-11.
- **Screens:** Dashboard, CORTEX, Analytics, Revenue, Reviewer, Team, Operations.
- **Backend:** existing five repositories and edge routes — no new services.
- **Data:** replace `mockCortexData`/`demoData` imports in authenticated surfaces
  with the live path; keep demo strictly behind the landing/marketing route.
- **Tests:** a guard test that fails if any authenticated component imports from
  `src/app/utils/mock*` or `src/app/utils/demoData.ts`.
- **Browser QA:** every destination with an empty database → honest empty state.
- **Done:** zero fabricated rows in an authenticated view; empty states real.
- **Depends on:** a reachable Supabase project (this is the one external input).

#### CP-2 — Fix navigation truth (P0/P4) — **DONE, pulled forward into CP-1**

*Both defects were in the way of CP-1's browser QA: a suite that cannot tell one
destination from another cannot prove a surface shows real data either. The work
is recorded under CP-1. What CP-2 becomes instead is in §7 below.*

- **Outcome:** all 13 destinations deep-link, reload and bookmark correctly.
- **Fix:** `?page=execution` and `?page=architecture` silently render the
  Dashboard (Product Reality §7.2); the smoke suite's four invalid IDs
  (`reviewer-qa`, `email-queue`, `revenue-intelligence`, `mapping-engine`)
  assert nothing (§7.1).
- **Tests:** the deep-link test must assert **destination identity**, not merely
  absence of console errors, and must be driven from `NAV_GROUPS` so an ID can
  never drift again.
- **Done:** a mutation renaming any destination ID fails the suite.

#### CP-3 — The organizational spine (P1)
- **Outcome:** Cortex models an organization, not just a sales pipeline.
- **Canon:** D16 Organization & Tenancy, D03 Work & Workflow, ONT Ch11/Ch13.
- **Screens:** People, Teams, Departments; Projects/Workstreams/Tasks/Milestones
  as first-class entities, not only as consulting delivery artefacts.
- **Backend:** new tables + repositories, RLS and composite keys from day one,
  following the existing tenancy pattern exactly.
- **Done:** a person can create a project, assign it, and see it on a dashboard.

#### CP-4 — Goals, decisions and value (P1)
- **Outcome:** the canon's organizing principle becomes visible.
- **Canon:** PX Ch54 Value Architecture; goals, strategy, decisions, risks,
  opportunities.
- **Screens:** Goals/OKRs, Decisions, Risks, Opportunities; a value reading on
  the Command Center.
- **Done:** at least the Customer, Financial, Operational and Organizational
  value dimensions are modelled, measured and surfaced under that name.

#### CP-5 — Human × AI in the product (P2)
- **Outcome:** AI recommends, a human ratifies, and the trail is visible — where
  the work is, not in an admin console.
- **Canon:** C0011, C0019–C0026, MB III-16/III-22, PX Ch61–67.
- **Screens:** an approval queue in the product; explanation and citation on
  every AI output; an override control; AI provenance labelling.
- **Backend:** existing approval and governance primitives — wire, do not rebuild.
- **Done:** no AI output renders without provenance; no consequential AI action
  executes without a human decision recorded.

#### CP-6 — Agent Center (P3)
- **Outcome:** the agent runtime gets a producer and a consumer.
- **Canon:** C0008–C0011, PX Ch62–63.
- **Screens:** Agent Center — define scope, delegate a task, watch a run,
  intervene, review cost and authority.
- **Done:** a user can start an agent run from a product surface, see it work,
  and stop it. Today nothing can start one at all.

### PARALLEL TRACKS

**Track A — Knowledge & evidence (P1).** D02, D13. Knowledge base, documents as
records, citations, institutional memory. Independent of CP-3/CP-4; becomes the
grounding source for CP-5. *Safe to run alongside the critical path.*

**Track B — Communication, notifications, search (P1/P4).** D11, D12. Real-time
threads, mentions, a working global search over real entities. Depends on CP-1
for real data but not on CP-3+. *Safe in parallel.*

**Track C — Client experience completion (P1).** D04. Finish the live client
portal path (needs `RESEND_API_KEY`), self-service, engagement lifecycle. Mostly
independent. *Safe in parallel.*

Not parallel-safe: CP-3 and CP-4 share the entity model; CP-5 and CP-6 share the
approval and authority surfaces. Sequence those.

---

## 4. First build sprint — exact scope

**Sprint CP-1 — "Turn the product on".**

Chosen because it converts the largest amount of already-completed, already-paid
engineering into product value, and because **every later sprint built on demo
data would have to be rebuilt.**

In scope:
1. Route every authenticated surface through the live data path.
2. Real, honest empty states everywhere demo data currently guarantees content.
3. Real loading and error states on the same surfaces.
4. Confine demo data to the public marketing/landing experience.
5. A guard test that fails the build if an authenticated component imports
   fabricated data.
6. Browser QA against an empty and a populated database.

Out of scope: new domains, new entities, AI work, agent work, visual redesign,
production deployment, migrations.

**Blocked on one external input:** a reachable Supabase project — credentials and
egress. Checkpoint A established this environment has neither. That is the single
decision that unblocks the entire plan.

---

## 5. What to stop working on

1. Production deployment and Checkpoint B.
2. Further security certification passes.
3. Further migration hardening and rollback rehearsal.
4. Release engineering and bundle-budget work.
5. Shadow-read / read-authority rollout — no traffic to measure.
6. The Phase 2 backfill — nothing real to back-fill yet.
7. Design-token and component-count refactors.
8. Additional architecture documentation.
9. Admin-console depth ahead of any product AI surface.
10. Anything whose completion is measured in tests rather than in what a user can do.

Each is either finished, or cannot pay off until the product uses the platform.

---

## 6. CP-2, rescoped — NAVIGATION + PRODUCT SHELL TRUTH — **COMPLETE**

*Executed. See `MARQ_CORTEX_CP2_RECORD.md`. 13 destinations audited for actual
capability, 3 withdrawn from navigation, the registry's `LIVE` renamed to what
it measured, and two shell defects fixed — a search control that did nothing on
nine of ten destinations, and a role the session knew and the shell never said.
Product completeness ~34% → ~35%: CP-2 removed false capability rather than
adding real capability, and the number reports that honestly.*


CP-2 as originally written was the two navigation defects, and CP-1 had to fix
both to be able to test anything. What is left is the larger version of the same
question, and CP-1's browser QA made it answerable for the first time — because
the product can finally be put into an EMPTY state and looked at.

### What CP-1 exposed that CP-2 should take

1. **Five destinations have no backend and now say so.** Email Queue engagement,
   Execution, the Mapping Engine, meeting attendees, and the AI chat's
   provenance. Saying so honestly is where CP-1 stopped. Two of them —
   Execution and the Mapping Engine — are now near-empty screens carrying a
   sidebar entry and a heading, which is truthful and is not yet a product.
   Either give them a producer or stop declaring them as destinations.

2. **The empty product is reachable and mostly unfurnished.** Until CP-1 nobody
   had seen MARQ Cortex with nothing in it. The Command Center leads with
   orientation and reads well; most other destinations render a heading and a
   sentence. A new organization's first ten minutes are now observable, and
   should be designed rather than inherited.

3. **The shell's own truthfulness.** CP-1 fixed the account block, which showed
   an invented person to everybody. The same class of thing should be swept:
   anything in the shell that is a literal where a fact belongs.

4. **`registryAudit.ts` defines LIVE as "works with zero backend".** Under that
   definition a client-side engine running on fabricated inputs counts as LIVE,
   which is how 133 of 185 interactions came to be labelled that way. The
   vocabulary needs to change before the registry can be read as a status.

### Scope

- Decide, per destination, whether it is a product surface or a platform tool,
  and let `NAV_GROUPS` say which. A destination that cannot do anything yet
  should not sit beside ones that can.
- Design the empty product: first-run for each destination, not just the
  Command Center.
- Sweep the shell for remaining literals-where-facts-belong.
- Re-vocabulary `registryAudit` so LIVE means "reads real data".
- Keep the CP-1 guards green; add the destination-classification to them.

### Not in CP-2

New entities, goals, decisions or value modelling — that is CP-3, and it needs
the organizational spine. No AI or agent surfaces. No production work.

### Depends on

Nothing external. CP-2 is doable with the same blocked Supabase, which is why it
is next.

---

## 7. How progress is measured from here

Two numbers, never merged:

- **Product completeness** — can a real person do the thing the canon describes,
  with real data, honest states and human control.
- **Engineering readiness** — does it hold up.

A sprint counts as done when a person can do something new. Not when a suite is
green.
