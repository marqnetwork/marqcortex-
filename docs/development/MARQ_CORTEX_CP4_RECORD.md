# CP-4 — Organizational writes, and the strategic layer

**The sprint where the product stopped being read-only.**

Executed against `52d4361` (main after CP-3). Companions:
`MARQ_CORTEX_CP3_RECORD.md`, `MARQ_CORTEX_CP4_PREPARATION.md`,
`MARQ_CORTEX_PRODUCT_REALITY.md`.

---

## 0. Status

| | |
|---|---|
| **CP-4** | **CODE COMPLETE** |
| **Live Supabase verified** | **NO — LIVE VERIFICATION BLOCKED** (unchanged since CP-1) |
| Product completeness before | ~39% |
| Product completeness after | **~48%** |
| Engineering foundation before | ~82% |
| Engineering foundation after | ~84% |

### Why nine points, when CP-2 and CP-3 together moved five

Because this is the first sprint since CP-1 that gave an operator something
**they could not do before at all**, and it gave them two of them:

* **They can build their own organization.** People, departments, teams,
  business units — create, edit and archive. CP-3's spine was read-only, so
  against a live project it was permanently empty. The CP-3 record said so, in
  those words, and said the four points it scored were held down by exactly
  this. That is now fixed.
* **They can record what the organization is trying to do.** Goals, decisions
  and risks, read by every member and recorded by an administrator — a whole
  destination that did not exist.

### Why not more

Three things still hold it down, and only the first is CP-4's fault:

1. **No Objective and no Initiative.** ONT 13.4 defines a Goal in terms of an
   Objective; Cortex has neither it nor Initiative. Goals are real and usable
   and they have no parent, which the capability record states rather than
   letting `LIVE` imply otherwise.
2. **Opportunity and Value are not here.** Deliberately — see §4.
3. **Nothing has run against a live project.** Five sprints of migrations now
   sit unapplied. This is the largest standing risk in the programme and it
   grows every sprint.

---

## 1. The decision that shaped the sprint

**The authorization for a write is not in TypeScript, and that is the point.**

Every spine and strategy READ runs as `service_role`, which bypasses RLS, so
the repository's own `organization_id` filter is the boundary. That is correct
for a read: *which rows are this tenant's* is a question the server can answer
completely, and the tests check it over the recorded query chain.

A write asks a second question the server cannot answer from what it holds:
**may this person reshape this organization?** Answering it in the edge
function would mean evaluating `organization.structure.manage` against
`role_permissions` in TypeScript — a second copy of an authority model the
database already implements, already enforces, and already has ten proven
properties about. CP-3's brief forbade exactly that, and it is the copy that
would drift.

So writes do **not** use the service key. They run under a client carrying the
caller's own JWT, and the RLS policies CP-3 installed are the authorization:

```
INSERT / UPDATE  →  cortex.has_permission(organization_id, '…​.manage')
DELETE           →  refused to everybody; archiving is an UPDATE of deleted_at
```

A viewer's `INSERT` is refused by PostgreSQL, not by an `if` statement. That is
what *"UI visibility is not authorization"* means when it is true rather than
asserted — and it is why the fourteen properties proven in
`scripts/organizational-spine-scenarios.mjs` are properties of the running
product rather than of an unused policy.

### The field maps ALLOW rather than deny

A body key a spec does not name never reaches the database. So
`organization_id`, `id`, `deleted_at` and `user_id` cannot be set by a caller
whatever they send — and a column added to one of these tables tomorrow is
**safe by default rather than writable by default**. A deny-list would have to
be updated every time; this cannot be out of date.

`user_id`'s absence is load-bearing. Linking a person to an auth account is
granting console access, which is a different permission on a different
surface. `organization.structure.manage` is authority over the SHAPE of the
organization, not over who may sign in.

---

## 2. What was built

### 2.1 The spine's write surface

Create, update and archive for people, departments, teams, business units and
team memberships. Nine routes, one write-context helper, and no route that
takes an organization id.

The surface offers its controls only when the server reports manage authority,
and **withholds them rather than disabling them**: a disabled button promises
that signing in differently would help, which is true for a team viewer and
false for a suspended membership.

Archive is an `UPDATE`, never a `DELETE` — a hard delete would take reporting
lines and team memberships with it through the composite foreign keys, silently
detaching people from a structure nobody asked to change.

### 2.2 The strategic layer — `20260918120000` and `20260918120001`

| Table | Canon | Shape |
|---|---|---|
| `goals` | ONT 13.4 | statement, measure, target, current, due, status, owner |
| `decisions` | ONT 14.8 | statement, **alternatives**, **rationale**, goal, decider, dates, status |
| `risks` | ONT 17.6 | statement, **likelihood**, **impact**, **tolerance**, mitigation, goal, owner, status |

Five composite foreign keys, so a goal owned by another tenant's person, a risk
threatening another tenant's goal and a decision attributed to another tenant's
decider are all **unrepresentable** rather than rejected.

**The canon decided the shapes, including where it decided nothing:**

* ONT 13.13 gives the status vocabulary, so it is used rather than invented.
* ONT 17.6 defines **no scale** for likelihood, impact or tolerance. A
  three-level ordinal is used because it is the smallest thing that can be
  sorted, and the migration says that is its own choice.
* ONT 13.4's examples are *"500 customers"*, *"under two minutes"* and *"95%"* —
  three units, one inverted. `measure` and `target_value` are TEXT; a numeric
  column would push every goal that did not fit into the statement instead.

**Two of the canon's characteristics are constraints rather than conventions:**

* A decision marked `decided` names who decided it and when (14.8, *traceable*).
  Without it, `decided` is a status anybody can set on a record with nobody
  behind it — traceability claimed in the schema and optional in practice.
* A risk can only be `accepted` once its tolerance is decided (17.6,
  *evaluated*). Otherwise "accepted" means "nobody looked at it again".

Both would reach a caller as *"that value is not allowed"* if left to
PostgreSQL. The repository names them first, in the caller's words.

### 2.3 The surface says what the canon would notice

Three counts on the Strategy overview are not neutral:

| Count | Why it is there |
|---|---|
| Decisions with no rationale | ONT 14.8 lists *justified* as defining. A decision without one is an incomplete record of a decision. |
| Risks not yet assessed | ONT 17.6: a Risk is *evaluated* by likelihood, impact and tolerance. |
| Goals with no owner | A goal nobody owns is a goal nobody is working on. |

Every tool records decisions. Very few make the unjustified ones visible.

---

## 3. The correction worth recording

The first RLS draft argued at length that a risk register should not be open to
every member — and then granted `strategy.read` from `members.read`, which
every member holds. **The policy said one thing and the grant did another**, and
the PostgreSQL proof caught it on the first run.

The grant was right and the argument was wrong. The canon describes these as
governed organizational records and says nothing about restricting them from
the organization; Cortex's premise is shared organizational intelligence; and a
goals list only administrators can see is a worse product resting on an
access rule nobody asked for. Inventing one would have been exactly the drift
this programme has avoided elsewhere.

Reading is open to any active member. `strategy.manage` follows
`members.manage`, which only `org_admin` and `platform_admin` hold. The keys
are still separate from the structure ones so the decision stays **reversible
without a schema change** — that, and not secrecy, is why they exist.

---

## 4. What CP-4 deliberately did not do

* **Opportunity.** No ontology chapter, while being a first-class peer of Risk
  in the Product Experience canon and appearing in the Master Blueprint's
  engagement chain. Three readings are open — the inverse of Risk, a commercial
  pipeline entity, or two concepts sharing one word — and choosing one here
  would settle a canon question with a migration. **This is still open and still
  needs the ontology owner.**
* **Value (ONT 18.11).** *"May differ across stakeholders"*, so the row shape
  turns on whether value is recorded per stakeholder or per outcome — a
  modelling question the canon poses rather than answers.
* **Objective and Initiative.** Shipping the full chain is more than one
  sprint; shipping Goal while implying the chain would be worse. There is no
  `objective_id`, so nothing suggests a parent that is not there, and adding one
  later is additive.
* **Linking a person to a login.** Different permission, different surface.
* **No production migration execution, no production secret change, no paid
  provider traffic.**

A static test guards the first three absences, because an absence is exactly the
kind of decision a later sprint reverses by accident.

---

## 5. Verification

| Gate | Result |
|---|---|
| `typecheck:web` / `typecheck:tests` | pass |
| `typecheck:api` (Deno) | `ai`, `registry-free`, `server` all clean |
| `test:features` | 1430 / 1430 |
| `test:system` | 177 / 177 |
| `test:ai` | 2183 / 2183 |
| `test:security` | 954 / 954 |
| `test:database` (static) | 283 pass / 2 pre-existing skips; 30 of them the new strategic migration |
| `test:database:spine` (real PostgreSQL 16) | **24 properties** + idempotency + two rollbacks |
| Browser QA — fixture backend | 68 / 68 (18 new), desktop and 390px |
| Browser QA — demo · release · production config | 21 · 25 · 4 |
| `test:bundle` (demo isolation in `dist/`) | 5 / 5 |

**Mutation-tested.** Weakening `goals_owner_same_org` to a single-column
foreign key makes assertion 3 of the scenario suite fail with exactly its named
`TENANT BREACH`. The guard is real.

### Two tests CP-4 changed rather than deleted

Both were correct for CP-3 and wrong once the spine could be written to, and
both are worth recording because "the test failed so I removed it" is how a
guard quietly stops guarding.

* **"The spine offers no write control."** It offers them now. The rule it came
  from — CP-2's, that a control which cannot do its job must not be offered —
  becomes a GATE rather than an absence: every control present must be live and
  named, and the *withholding* half moved to `organization-writes.spec.ts`,
  which drives a backend that refuses.

* **The stale-row sentinel.** `honest-states.spec.ts` looked for the bare string
  `Fixture Industries` to prove no rows survived a failed load. CP-3 made that
  the WORKSPACE NAME, which the shell shows on every screen in every state —
  correctly, because the workspace comes from the session and not from the
  request that just failed. Narrowing the sentinel to `Fixture Industries 1`
  would have been enough; it now lists one row from each of the three surfaces
  instead, which is stronger than it was, because stale organization or strategy
  rows would have been invisible to a check that only knew about submissions.

### What LIVE VERIFICATION BLOCKED means here

The network policy answers 403 to a `CONNECT` for `*.supabase.co`. **Nothing in
this sprint has run against a live Supabase project and nothing is reported as
though it had.** The migrations have not been applied to production and no
production secret was touched.

What *has* been verified empirically is the database behaviour, against real
PostgreSQL 16 with the real migrations applied in order — stronger than a
source-text assertion, weaker than a live project.

---

## 6. What a real deployment would see today

| Surface | Against a live project |
|---|---|
| Shell workspace name | **Real** |
| Organization — structure and people | **Empty at first, and fillable.** This is the change. |
| Console access roster | **Real**, unchanged |
| Strategy | **Empty at first, and fillable** |

The difference from CP-3 is the second word in each row. An operator can now
put their organization in, and then record what it is trying to do — which is
the first time Cortex has been able to hold anything a customer would recognise
as their own.
