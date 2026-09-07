# The Operational Health Framework

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

## 6. What G5 still has open

This closes §IV-51. The rest of G5 remains:

- **§IV-48 enterprise KPIs** — the categories are approved; formal named
  indicators per category are not built. Buildable as a registry of named
  indicators computed from existing signals, still **carrying no targets**,
  since §IV-48 keeps numeric targets out of scope for this phase.
- **§IV-49 AI performance evaluation** — the blueprint states plainly that
  "evaluation *implementation* is deferred and excluded from this phase". Not
  buildable without departing from the canon.
- **§IV-52 continuous improvement** and **§IV-53 maturity model** — organisational
  frameworks, not runtime capabilities.
