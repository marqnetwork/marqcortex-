# CP-4 — Goals, Decisions, Risks, Opportunities, Value

**Prepared at the end of CP-3. NOT STARTED.**

The strategic layer: what the organization is trying to achieve, what it has
decided, what threatens it, what it could take, and what any of it is worth.

---

## 0. The finding that sets the shape

**CP-4 has the opposite problem to CP-1 and CP-3.**

CP-1 found an expensive backend the product would not read. CP-3 found an
expensive tenancy foundation the product could not see. CP-4 finds **nothing at
all**: there is no `goals` table, no `decisions` table, no `risks` table, no
`opportunities` table, no `value` table, no route, no service, no surface. The
canon describes these entities at length and the product has never had one.

That changes the sprint's character. CP-3 was mostly connection; **CP-4 is
mostly construction**, and it should be scoped and estimated on that basis.

### And CP-3 left a debt that CP-4 inherits first

The organizational spine is **read-only**. Against a live project today,
`people`, `departments`, `teams` and `business_units` are empty and stay empty,
because nothing writes to them. Every CP-4 entity below is owned by a person, a
team or a department — a Goal has an owner, a Decision has a decider, a Risk has
an accountable party — so **a strategic layer built on an unpopulated spine
would be a layer of records that point at nobody.**

> **The first thing CP-4 must decide is whether it opens with the spine's write
> surface. The recommendation in this document is that it does.**

---

## 1. What the canon already says, and the one gap in it

Four of the five are canonical ontology entities. Read them before designing
anything.

| Concept | Canon | Definition, in the canon's own words |
|---|---|---|
| **Goal** | ONT **13.4** | *"A measurable target established to support the achievement of an Objective."* Measurable, time-bound where applicable, governed, trackable, outcome-oriented. |
| **Decision** | ONT **14.8** | *"A governed selection among one or more alternatives based on available knowledge, evidence, objectives, constraints, and context."* Governed, traceable, contextual, justified, reviewable. |
| **Risk** | ONT **17.6** | *"The possibility that uncertainty, events, decisions, or conditions may negatively affect organizational objectives, operations, assets, reputation, or stakeholders."* Evaluated by likelihood, impact and organizational tolerance. |
| **Value** | ONT **18.11** | *"The measurable or perceived benefit delivered to a User, Customer, Organization, or other stakeholder…"* May be tangible or intangible; financial, operational, emotional, strategic or societal; **may differ across stakeholders**. |

### ⚠ Opportunity has no ontology chapter

`grep -c "Opportunity" MARQ_CORTEX_ONTOLOGY_v1.0.md` → **0 entity definitions.**

It is nevertheless a **first-class concept in the Product Experience canon**,
listed as a peer of Risk in the entity inventory and in the "every entity
should have" list:

> *Knowledge · AI Agent · Customer · Vendor · **Risk** · **Opportunity** ·
> Metric · Historical Event*

and it appears in the Master Blueprint's engagement chain
(`… ROI Actuals → QBR / Opportunity`).

**CP-4 Step 1 must resolve this before any schema is written**, under CP-3's
standing rule — *do not create duplicate concepts merely because a prompt uses a
different word*. Three readings, and they are not equivalent:

1. **Opportunity is the inverse of Risk** — an uncertain event with a positive
   expected effect. One table with a signed effect, two views.
2. **Opportunity is a commercial pipeline entity** — the Blueprint's
   `QBR → Opportunity` reading, i.e. a follow-on engagement. That belongs
   beside the proposal chain, not beside Risk.
3. **Opportunity is both, and the canon is using one word for two things.**

Reading 3 is the one to expect, and it is a **canon question, not an
implementation choice**. It should go back to the ontology owner rather than be
settled by whoever writes the migration.

### Goal is not free-standing either

ONT 13.4 defines a Goal as supporting an **Objective** (13.3), which supports an
**Initiative** (13.1). Cortex has none of the three. CP-4 must decide whether it
ships the full `Initiative → Objective → Goal` chain or only Goal — and if only
Goal, it must say so in the capability record rather than letting `LIVE` imply a
hierarchy that is not there.

---

## 2. What CP-4 should deliver

### 2.0 First — the spine's write surface (the inherited debt)

Create, update and soft-delete for people, departments, teams, business units
and team memberships. The schema, the RLS and the `organization.structure.manage`
permission **already exist and are already proven**; what is missing is the
routes and the UI.

Without this, every entity below points at an empty organization.

### 2.1 The five entities

| Entity | Owned by | Minimum honest shape |
|---|---|---|
| Goal | a person or a team | statement, measure, target, due date, status, owner |
| Decision | a person (the decider) | statement, alternatives considered, rationale, date, status, decider |
| Risk | a person (accountable) | statement, likelihood, impact, tolerance, mitigation, status, owner |
| Opportunity | **pending §1** | **pending §1** |
| Value | a stakeholder | what benefit, to whom, how measured, realised or projected |

Every one is tenant-owned, and every one gets the composite-key treatment CP-3
established: `organization_id` in the key of every cross-table reference, so a
cross-tenant link is unrepresentable rather than merely rejected.

### 2.2 The relationships are the product

A table of goals is a to-do list. What makes this the strategic layer is the
edges, and the canon names them:

* a **Decision** is justified by **Evidence** and made in service of an
  **Objective** — so a decision that cites nothing is visibly weaker than one
  that does;
* a **Risk** threatens an **Objective**, and a **Goal** measures one;
* **Value** is what an outcome delivered, to a named stakeholder;
* every one of them is **owned by somebody in the spine**.

CP-4 should ship at least: Goal ↔ owner, Decision ↔ decider, Risk ↔ owner,
Risk ↔ Goal (what it threatens), Decision ↔ Goal (what it serves).

---

## 3. Decisions CP-4 must make before it writes code

| # | Decision | Why it cannot be deferred |
|---|---|---|
| 1 | **Is Opportunity a signed Risk, a pipeline entity, or two entities?** | It decides the schema. Getting it wrong means a table that has to be split later, across live data. |
| 2 | **Full `Initiative → Objective → Goal` chain, or Goal alone?** | The canon's Goal is defined in terms of Objective. Shipping Goal alone is defensible; shipping it while implying the chain is not. |
| 3 | **Does CP-4 open with the spine write surface?** | Everything else points at people who cannot be created. **Recommendation: yes.** |
| 4 | **Is Value recorded per stakeholder or per outcome?** | ONT 18.11 says value *"may differ across stakeholders"*. One row per outcome silently picks one stakeholder's view. |
| 5 | **Read-only first, or read-write from the start?** | CP-3 shipped read-only and the record says the capability is therefore partial. Repeating that for five entities would ship five partial capabilities at once. |
| 6 | **Does the AI layer read any of this in CP-4?** | It is the obvious pull — a diagnostic that knows the client's goals. It is also how a bounded sprint becomes an unbounded one. **Recommendation: no. CP-5.** |

---

## 4. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Scope explosion.** Five entities, a hierarchy, a relationship graph and an inherited write surface is two sprints of work wearing one name. | High | High | Cut to Goal + Decision + Risk + the spine write surface. Defer Opportunity (pending §1) and Value to CP-5, explicitly, in the capability record. |
| **The canon gap is settled by implementation.** Whoever writes the migration decides what Opportunity is, and the ontology then follows the code. | High | Medium | Raise §1 as a canon question at Step 1. If it is not resolved, **do not ship Opportunity** — ship the four that are defined. |
| **A strategic layer with nothing in it.** The product gains five destinations that are all empty, because the spine is empty and nothing seeds either. | High | High | Decision 3. Write surface first, and browser QA that walks create → read for at least one entity end to end. |
| **`LIVE` inflation.** Five new destinations, each rendering, each reading a real route, each with nothing behind it. This is precisely what CP-2 fixed. | Medium | High | `capabilityStatus.ts` already distinguishes LIVE from PARTIAL and EMPTY. Use `PARTIAL` honestly, and let `capabilityTruth.test.ts` fail the ones that overclaim. |
| **Live verification still blocked.** Four sprints of migrations now exist that have never run against the real project. | Certain | Rising | Unchanged and worth restating loudly: this is the **largest standing risk in the programme**, and it grows with every sprint. See §6. |
| **Tenancy regression.** Five new tenant-owned tables, each an opportunity to forget a composite key. | Medium | Critical | Extend `scripts/organizational-spine-scenarios.mjs` rather than writing a second harness. The ten properties it proves are the template. |

---

## 5. Opportunities

* **The proof harness generalises.** `organizational-spine-scenarios.mjs` and
  its ten named properties are reusable for any tenant-owned table. CP-4's
  tenancy proof should be an extension, not a rewrite — and that makes the
  right thing the cheap thing.
* **The honest-states machinery is already built.** `ProductDataState`,
  `useProductData` and the four fixture modes mean a new surface gets all five
  states for roughly the cost of remembering to use them.
* **The capability record is already the place this is negotiated.**
  `capabilityStatus.ts` plus `capabilityTruth.test.ts` means "we shipped Goals"
  has to survive a test that asks what a person can actually do.
* **Decision + Evidence is the first place Cortex could be genuinely
  differentiated.** Every tool records decisions. Very few record what the
  decision was justified by, and make the unjustified ones visible. The canon
  already asks for it (ONT 14.8: *justified, reviewable*).
* **The spine write surface unlocks more than CP-4.** Work assignment, approval
  routing and accountability all need people who exist.

---

## 6. Value — what CP-4 is actually worth

Stated per stakeholder, because ONT 18.11 says value differs across them.

| Stakeholder | Value if CP-4 lands well |
|---|---|
| **The operator** | The console stops being a submission queue and starts being somewhere the organization's intent is recorded. First real answer to "what are we trying to do, and who decided that?" |
| **The client** | A diagnostic whose recommendations attach to their goals rather than floating free. |
| **The product** | The first capability that is not about MARQ's own delivery pipeline — the first thing a customer would buy Cortex *for* rather than receive as part of an engagement. |
| **The programme** | Product completeness moves materially for the first time since CP-1. CP-2 and CP-3 together moved it five points; CP-4 is the first sprint that can plausibly move it ten. |

**And the honest counterweight:** none of that is worth anything until the
migrations run against a live project. Four sprints of schema now sit unapplied.
CP-4 should not be the fifth — **a live verification window is the highest-value
thing that could happen to this programme, and it is not something a sprint can
deliver on its own.**

---

## 7. Suggested CP-4 scope, if it is to stay one sprint

1. Spine write surface — create, update, soft-delete for people, departments,
   teams, business units, team memberships. Uses the existing RLS and the
   existing `organization.structure.manage` permission.
2. **Goal**, **Decision**, **Risk** — schema, RLS, composite-key tenancy,
   repository, routes, surfaces, all five honest states.
3. Relationships: Goal ↔ owner, Decision ↔ decider, Risk ↔ owner, Risk ↔ Goal,
   Decision ↔ Goal.
4. Tenancy proof extended in the existing harness, same ten properties.
5. Browser QA walking create → read end to end for at least one entity.
6. **Opportunity and Value deferred to CP-5, in writing**, with §1 raised as a
   canon question rather than answered by a migration.

That is still a large sprint. It is smaller than the brief's five entities, and
the difference is the part the canon has not finished defining.
