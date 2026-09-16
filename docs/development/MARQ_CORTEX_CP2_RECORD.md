# CP-2 — Navigation + product shell truth

**A short sprint with one job: stop the product claiming capabilities it does
not have.**

Executed against `ab3081fe` (main after CP-1). Companions:
`MARQ_CORTEX_CP1_RECORD.md`, `MARQ_CORTEX_PRODUCT_REALITY.md`,
`MARQ_CORTEX_ACCELERATED_BUILD_PLAN.md`.

---

## 0. Status

| | |
|---|---|
| **CP-2** | **COMPLETE** |
| **Live Supabase verified** | **NO — BLOCKED** (unchanged) |
| Product completeness before | ~34% |
| Product completeness after | ~35% |

CP-2 added no capability. It removed three false ones and fixed a control that
did nothing. The number barely moves, and that is the correct reporting: a
sprint that makes a product smaller and truer has not made it more complete.

One material product blocker was removed — the review queue was inventing a
company every thirty seconds — which is the only reason the figure moves at all.

---

## 1. The measurement that was wrong

`registryAudit.ts` classified **133 of 185** interactions as `LIVE`, and defined
`LIVE` as *"works right now with zero backend (pure UI / client-side engine)"*.

That is a measurement of **wiring** wearing the name of **capability**. Under
it, a button that opens a panel of invented companies is LIVE. The number was
read the way the name invites.

The two questions are now two files:

| File | Question | Vocabulary |
|---|---|---|
| `registryAudit.ts` | Is there a handler behind this control? | `WIRED` · DEMO · GATED · MISSING · VISUAL |
| `core/capabilityStatus.ts` | Can a person **do the thing**? | LIVE · PARTIAL · EMPTY · BLOCKED · DEMO-ONLY · UNREACHABLE |

A destination is `LIVE` when a person signed into a real workspace can perform
the capability its label promises, against their own data. Not because the
component renders, the route resolves, the handlers are wired, it works without
a backend, or it has content to show. **The last is the one that caused the
trouble** — content is the easiest thing to fake and the most convincing
evidence of a product that is not there.

---

## 2. The audit — 13 declared, 10 offered

| Destination | Page id | Sidebar | Reachable | Backend | Real function | Status |
|---|---|---|---|---|---|---|
| Dashboard | `dashboard` | ✅ | ✅ | `/submissions`, `/team/members` | Yes | **LIVE** |
| CORTEX | `cortex` | ✅ | ✅ | `/submissions`, `/submissions/:id/cortex` | Yes | **LIVE** |
| Analytics | `analytics` | ✅ | ✅ | `/analytics/overview` | Yes | **LIVE** |
| Revenue Intelligence | `revenue` | ✅ | ✅ | `/analytics/revenue-snapshots` | Yes | **LIVE** |
| Team | `team` | ✅ | ✅ | `/team/members` + writes | Yes | **LIVE** |
| Settings | `settings` | ✅ | ✅ | `/settings` + writes | Yes | **LIVE** |
| Architecture | `architecture` | ✅ | ✅ | none (documentation) | Yes | **LIVE** |
| Operations | `operations` | ✅ | ✅ | `/health/enterprise`, `/kpis` | Built, gated | **BLOCKED** |
| AI Control Plane | `control-plane` | ✅ | ✅ | `/ai/admin/*` | Built, gated | **BLOCKED** |
| Email Queue | `emails` | ✅ | ✅ | localStorage only | Partly | **PARTIAL** |
| Reviewer QA | `reviewer` | ❌ | by URL | none | **No** | **DEMO-ONLY** |
| Mapping Engine | `mapping` | ❌ | by URL | none | No producer | **EMPTY** |
| Execution | `execution` | ❌ | by URL | none | No producer | **EMPTY** |

**LIVE 7 · BLOCKED 2 · PARTIAL 1 · DEMO-ONLY 1 · EMPTY 2 · UNREACHABLE 0.**

**BLOCKED is not hidden.** Operations and the AI Control Plane stay in the
sidebar. They are finished, tested work waiting on a network policy; hiding them
would misreport that as missing, which is the same dishonesty pointing the other
way.

---

## 3. Reviewer QA — a CP-1 miss

It displayed a review queue. It had no review queue.

- `generateMockSubmissions()` built eight invented companies at mount.
- `generateRandomSubmission()` decided every quality score, readiness score,
  flag and "pattern detected" — **eighteen `Math.random()` calls**.
- A **30-second interval** invented a *new* company at random, and raised a
  browser notification when the dice made it `needs-review`.
- It took no access token and made no request of any kind.

CP-1's demo-isolation guard could not see it: the generator lives inside the
component and invented its own names, so neither the fixture-name list nor the
import check applied. CP-2 found it by asking a different question — not *where
does the data come from* but *what can a person do here*.

The generators are deleted. The review **checklist** behind it is real and
wired (`getReview` / `saveReview`, and the `reviewer-checklist` contract); the
missing half is the queue.

---

## 4. Execution and Mapping Engine — evidence, then decision

`EXECUTION_STORE` is a module-scope array (`= []`). Its only writer is
`runMappingPipeline`, called only from the Mapping Engine, which has no
`ProposalSnapshot` to run against — `createProposalSnapshot` exists in
`snapshotEngine` and **has no caller anywhere in the product**. Neither store is
persisted, so both are empty on every page load regardless of workspace.

So both are EMPTY with no producer, and the decision is **B for both**: keep the
implementation, stop offering the destination. Nothing was deleted and
`DEMO_SNAPSHOT` was not restored.

---

## 5. Hiding does not stop a URL

A bookmark, a history entry or a hand-typed `?page=reviewer` still arrives, and
CP-1's rule says it must arrive at the destination it names rather than silently
becoming the Dashboard. So the URL still resolves, and `NotOfferedYet` renders
instead of the component — reading its text from the same capability entry the
sidebar read to hide it, so the explanation cannot drift from the decision.

Withdrawing a destination is a statement about what to **offer**, never about
what an address **means**.

---

## 6. Three paths, one product

The command palette enumerated the **declared** list while the sidebar
enumerated the visible one, so hiding a destination left it one Cmd-K away —
Ch. 21.4's duplicate reality, arrived at sideways. Palette, sidebar, keyboard
accelerators and the orientation model all read `VISIBLE_*` now, and a group
whose members are all hidden renders no heading rather than an empty one.

One defect this surfaced: the `first-outcome` orientation step — the product
telling a *new operator* where to go first — pointed at the review queue. It
points at CORTEX, where an outcome is actually logged.

---

## 7. Shell defects fixed

| Defect | Evidence |
|---|---|
| **The header search did nothing on 9 of 10 destinations.** It called `focus()` on a ref this layout declares and never attaches; the fallback focused the Dashboard's filter box *only on the Dashboard*. | Driven in a browser on Analytics: focus went BODY → BUTTON, nothing opened. |
| **The role was never shown.** Six roles decide what the server allows; a viewer and an owner saw an identical account block. | `teamRole` was in context and unread by the shell. |

The search opens the **command palette** — the global search the product already
has, which works on every destination and searches destinations *and*
submissions. That is what a magnifier promises.

Audited and found already correct: user identity (CP-1 fixed it), notification
count (real, gated, honest), AI entry (CP-1 labelled canned replies), account
controls, mobile shell. **No fabricated workspace identity exists to fix** — the
shell makes no claim about a workspace, which is CP-3's to introduce.

---

## 8. What enforces all of this

`tests/features/capabilityTruth.test.ts` — 14 checks:

- a LIVE or PARTIAL destination must reach a real data service;
- and must not use a mock generator or the demo boundary;
- nothing DEMO-ONLY, EMPTY or UNREACHABLE may sit in the sidebar;
- BLOCKED must stay visible;
- every non-LIVE status must say what would fix it;
- palette, accelerators and sidebar must read the same list;
- no duplicate ids;
- the registry may not call wiring "live" again.

`tests/smoke/shell-truth.spec.ts` — 12 browser checks, desktop and 390px.
`tests/smoke/navigation-truth.spec.ts` — 11, now including palette reach, label
truth and duplicate ids.

Every browser suite derives its destination list from the rendered sidebar,
which renders from the model. **No handwritten route list was added** — that was
the §7.1 lesson and it held.

---

## 9. Gates

| | |
|---|---|
| Typecheck (web + tests) | clean |
| Feature / security / system / migration / database / lifecycle | 1269 / 954 / 177 / 244 / 223 / 241 — pass |
| Browser — fixture backend (real data path) | 36 pass |
| Browser — demo experience | 21 pass |
| Browser — production config | 4 pass |
| Browser — release build under real headers | 25 pass |

`npm run typecheck:api` still requires Deno, absent here — unchanged.

---

## 10. Still blocked

Supabase remains unreachable: the network policy answers `403` to a `CONNECT`
for `oqybniefkbppptfatoae.supabase.co:443`. CP-2 needed no live backend, which
is why it was scheduled now. The two BLOCKED destinations stay blocked, and the
LIVE classifications are verified against the CP-1 fixture backend — a test
double, never reported as live verification.

---

## 11. Out of scope, deliberately

No organizational model, goals, decisions, value architecture, agents, new
integrations, deployment, migration, security certification, bundle work, visual
redesign or token cleanup. CP-2 was scoped short and stayed short.
