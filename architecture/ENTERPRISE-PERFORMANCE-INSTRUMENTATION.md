# Enterprise Performance Instrumentation

Gap-register **G5**, closed for the two sections the blueprint actually makes
buildable: §IV-51 the operational health framework, and §IV-48 enterprise KPIs.

---

# Part 1 — The Operational Health Framework

**Blueprint:** `MARQ_CORTEX_MASTER_BLUEPRINT_v1.0.md` §IV-51, and the gap
register's **G5 — enterprise performance instrumentation** (§VI-5).

**Status:** implemented. `GET /make-server-324f4fbe/health/enterprise`, team
auth.

---

## 1. What §IV-51 asked for, and what it excluded

> **Approved Future State.** A principled operational-health framework rolling
> health signals up to the four dimensions, with SLO/monitoring instrumentation
> deferred to §III-63 and excluded from this phase.

So: **roll existing signals up to four dimensions.** Not: build monitoring.

What is excluded is excluded here too, and the exclusion is tested rather than
promised:

- **No SLOs, thresholds, alerting or dashboards** — §IV-51 defers all four.
- **No numeric targets** — §IV-48 puts them explicitly out of scope for this
  phase. `operationalHealth.test.ts` scans the executable source for any
  comparison against a number other than zero and fails on one, because a
  comparison against zero is *presence* ("is there anything at all?") and a
  comparison against anything else is a threshold whatever it is called.
- **No new probe.** Every source reads something the platform already
  publishes.

The four dimensions are fixed by the blueprint and are not extensible by
configuration. A deployment that could invent a fifth dimension could invent a
green one.

---

## 2. The one discipline that makes it worth having

**An unreadable signal is `unknown`, and `unknown` never rolls up as healthy.**

The failure mode of every health page is reporting green because a probe was
never wired, or was wired and then broke. A framework that treats "I could not
find out" as "fine" is worse than no framework, because somebody trusts it.

So:

| Situation | Reported as |
|---|---|
| A dimension with no signals at all | `unknown`, `observable: false` |
| A dimension whose every probe is silent | `unknown`, `observable: false` — a probe that never answers measures nothing, however many there are |
| One healthy signal beside one unknown one | `unknown`, `observable: true` — something *is* being measured, and the dimension is only as known as its least-known probe |
| A probe that throws | `unknown`, naming itself and the error — a health framework that one bad collector can take down goes dark exactly when something is wrong |

`unobservedDimensions` is on the report as its own field, because "we are not
measuring this" is the single most important thing a health framework can tell
the person reading it.

---

## 3. The dimensions, and the honest answers

**Organizational** — §IV-51 defines it as operating coherently under the
governance frame: clear authority, alignment to the Constitution, no drift. Most
of that is a human judgement made in review, not a probe. The framework reports
the governance state it *can* read — which configuration is in force and who
last changed it — and reports the dimension as `unknown` **even when that read
succeeds**, saying so in the detail. Claiming a green light for a dimension
nothing measures would be the unwired-probe failure dressed as governance.

**Product** — progression counts: submissions, analyses, recorded outcomes. An
empty estate is `unknown`, not healthy: a platform with no submissions is not
delivering effortless value, it is idle. The counts are reported and
**deliberately not graded**, and the detail says so.

**Platform** — a round trip against the authoritative store, and the KV↔SQL
shadow read's own agreement report. The shadow read being switched off is
`unknown` — the common case, and honest — because reporting healthy would claim
an agreement nobody measured.

**AI** — the control plane's own health opinion, unchanged, plus the governance
switches. An engaged emergency stop is **degraded, never unhealthy**: the
control working is not an outage, and a health page that turned red for it would
teach operators that red means nothing.

---

## 4. Shape

`supabase/functions/server/health/`

| Module | Holds |
|---|---|
| `contracts.ts` | The four dimensions, the four states, the severity order, and the `HealthSignalSource` port |
| `rollup.ts` | Worst-wins within a dimension and across dimensions, with the throw guard |
| `sources.ts` | The signals this deployment actually has, each taking what it reads as a parameter |

Sources are a **port**, so this module depends on "somewhere signals come from"
rather than on the AI control plane, the storage layer or the key-value store.
Health that imported its subjects would be a module every subsystem has to
depend on in order to be observed, which is how a health check ends up able to
break the thing it observes. It also means the whole framework is exercised
without a control plane, a database or a network.

It type-checks in the registry-free deno boundary, so a regression in it is a
blocker rather than a note.

---

## 5. The route

`GET /make-server-324f4fbe/health/enterprise` — **team auth**, read-only.

The anonymous `/health` endpoint is unchanged and stays cheap: it is what an
uptime probe polls. The enterprise view reads the submission estate to report
progression, so it must not be reachable by anything that polls — asserted by
test, in both directions.

---

---

# Part 2 — Enterprise KPIs (§IV-48)

`GET /make-server-324f4fbe/kpis`, team auth. `supabase/functions/server/kpi/`.

## 7. What §IV-48 asked for, and what it excluded

> **Scope.** KPI **categories only**. **No numeric targets, no thresholds, no
> formulas, no dashboards.**

and the approved future state: "formal KPI definitions per category with
(**later**) concrete targets/SLOs".

So this is the definitions and the readings. **There is no target, no threshold
and no grade**, and `KpiReport.targetsInScope` is `false` on every read — a
consumer that renders it cannot quietly start treating the numbers as scored,
and one that ignores it has been told.

## 8. The anti-metric exclusion is structural

§IV-48, binding: "No KPI category may reward feature count, novelty, interface
spectacle, engagement-for-its-own-sake, or short-term extraction." DNA Ch 33.3
says the same of the enterprise.

A rule stated only in prose is a rule the next indicator breaks, so registration
enforces two things:

- **Every indicator must name at least one of the nine constitutional success
  dimensions** (DNA Ch 33.2) that it serves. An indicator that cannot say which
  dimension it serves is measuring activity for its own sake, and cannot be
  registered.
- **No indicator may be named for an explicit non-success.** The five in Ch 33.3
  are refused by name.

**What that cannot do, stated plainly:** a dishonest indicator can claim a
dimension it does not serve. The registry catches the careless case, not the
determined one — the determined one is caught in review, which is where Ch 33.3
puts it. Claiming otherwise would be exactly the false assurance this design
exists to prevent.

Two more registration rules, for the same reason: an indicator must state **the
question it answers, as a question** (one whose question cannot be written down
is one nobody can state the purpose of), and its id must agree with its
category.

## 9. The eight indicators

Each is computed from a signal the platform **already publishes** — an indicator
needing new collection would be monitoring instrumentation, which §IV-51 defers.

| Category | Indicator | Question | Serves |
|---|---|---|---|
| Strategic | Outcomes recorded | How many engagements has Cortex followed through to a recorded business outcome? | outcome delivery, durability |
| Strategic | Industries served | Across how many industries has Cortex applied its general method? | breadth |
| Operational | AI request success | What proportion of governed AI requests completed without an error? | integrity, trust |
| Operational | Provider failovers | How often did a request have to be served by a provider other than the first choice? | integrity |
| Quality | **Deterministic corrections** | How often did the deterministic engines have to restore an authoritative number the model had moved? | integrity, trust, outcome delivery |
| Quality | Governance blocks | How often did the output guard refuse a completion before it reached anybody? | integrity, trust |
| Customer | Diagnostics completed | How many businesses have completed a diagnostic and reached a first result? | effortless capability |
| Customer | Analysis coverage | What proportion of completed diagnostics have received their intelligence? | effortless capability, outcome delivery |

**Deterministic corrections is the one worth reading twice.** "Math decides; AI
narrates" is a constitutional principle, and the fact-lock counts exactly how
often the deterministic engines had to put an authoritative number back after
the model moved it. It is the only indicator here that measures the principle
rather than the plumbing — and no judgement is attached to it, because whether a
rising count is the guard working or the model drifting is precisely the grading
§IV-48 defers.

## 10. `null` is not zero

A measurement that could not be taken reports `null` and says why; the report
names every unmeasured indicator rather than leaving it to be inferred. A
measurement that throws reports `null` too — zero would be a number somebody
acts on.

A ratio with a zero denominator is `null`, not `0%`: "nothing has happened" and
"none of what happened qualified" are different facts, and reporting both as
zero would make an idle platform look like a failing one. It is the same
discipline the health framework applies to `unknown`, for the same reason.

## 11. What G5 still has open

§IV-51 and §IV-48 are closed. The rest:

- **§IV-49 AI performance evaluation** — the blueprint states plainly that
  "evaluation *implementation* is deferred and excluded from this phase". Not
  buildable without departing from the canon.
- **§IV-52 continuous improvement** and **§IV-53 maturity model** —
  organisational frameworks, not runtime capabilities.
