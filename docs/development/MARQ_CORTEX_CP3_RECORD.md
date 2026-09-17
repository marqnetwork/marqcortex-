# CP-3 — Organizational spine

**The sprint that gave Cortex an organization to be about.**

Executed against `560a7408` (main after CP-2). Companions:
`MARQ_CORTEX_CP1_RECORD.md`, `MARQ_CORTEX_CP2_RECORD.md`,
`MARQ_CORTEX_CP3_PREPARATION.md`, `MARQ_CORTEX_PRODUCT_REALITY.md`.

---

## 0. Status

| | |
|---|---|
| **CP-3** | **CODE COMPLETE** |
| **Live Supabase verified** | **NO — LIVE VERIFICATION BLOCKED** (unchanged since CP-1) |
| Product completeness before | ~35% |
| Product completeness after | **~39%** |
| Engineering foundation before | ~80% |
| Engineering foundation after | ~82% |

### Why +4 and not more

CP-3 delivers one genuinely new user-visible capability and one product-wide
truth fix:

* **The console names its own organization.** Every screen used to say
  "Internal Dashboard" — a description of the product, printed where the tenant
  belongs, identical in every workspace. It now names the organization the
  authenticated membership resolves, or says honestly why it cannot.
* **The Organization destination shows the organization.** People, departments,
  teams, business units, reporting lines, and who among them can sign in.

### Why +4 and not less

Because the spine is **read-only**, and because **nothing writes to it yet**.
Against a live Supabase today, `organizations` and `organization_memberships`
have rows, so the workspace name is real — but `people`, `departments`,
`teams` and `business_units` are empty, so a real operator would see the honest
EMPTY state on the new surface. A capability whose data path does not exist is
not a whole capability, and the number says so.

The five new tables, the RLS, the composite-key tenancy and the PostgreSQL
proof harness are **engineering**, not product. They moved the engineering
figure by two points and the product figure by nothing, which is the rule this
programme has followed since CP-1.

---

## 1. The canon was read first, and it settled the hardest question

CP-3's brief forbade inventing a second organizational architecture. The
ontology had already answered the question the schema turns on:

> **ONT 12.3** — *"Not every Identity is necessarily an active User."*

That is the whole people model. `public.people.user_id` is **nullable**, and a
person with a department, a reporting line and a team membership but no password
is an ordinary, first-class member of the organization.

The consequence runs through every layer:

| Layer | What it does with it |
|---|---|
| Schema | `people.user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL` — nullable |
| Proof | A fixture person with `user_id = NULL` who has a department, a manager and a team |
| Repository | Reduces the auth id to `hasConsoleAccess: boolean`; the id never leaves the server |
| Surface | Labels "No console login", counts them, and says the roster below is a different list |

`organization_memberships` — keyed on `auth.users` — is untouched. It remains
what it always was: **console access**. It is not the organization, and CP-3 is
the sprint that stopped the product conflating them.

---

## 2. What was built

### 2.1 Schema — `20260917120000` and `20260917120001`

Five tables, 351 lines plus 180 of RLS, with a rollback in reverse dependency
order and no `CASCADE`.

| Table | Holds |
|---|---|
| `business_units` | The top of the structure |
| `departments` | Optionally inside a business unit; has a lead |
| `people` | The organizational person. `user_id` nullable |
| `teams` | Optionally inside a department; has a lead |
| `team_memberships` | Person ↔ team, with `is_lead` |

**Eight composite foreign keys.** Every cross-table reference carries
`organization_id` as part of the key, so a cross-tenant reference is not
rejected at runtime — it is **unrepresentable**. A department cannot point at
another tenant's business unit; a team membership cannot join another tenant's
person; a reporting line cannot cross a boundary.

RLS on all five: `SELECT` for any member of the organization, `INSERT`/`UPDATE`
for `organization.structure.manage`, **no `DELETE`** (soft deletion only), and
`FORCE ROW LEVEL SECURITY` so the owner is not exempt. The two new permission
keys are granted to whichever roles already hold `members.read` / `members.manage`
— the existing RBAC, not a second one.

### 2.2 The tenancy proof — empirical, on real PostgreSQL 16

`scripts/organizational-spine-scenarios.mjs`, two phases on two scratch
databases. Ten named properties, each a `DO $$ … RAISE EXCEPTION` block running
as `SET ROLE authenticated` with a real JWT subject claim:

```
✓ organizational spine: tenancy and RBAC — all 10 properties
    ok  Org A reads its own 2 people and 0 of Org B's
    ok  Org A reads none of Org B's structure, and all of its own
    ok  an Org B person cannot be assigned to an Org A team
    ok  a reporting line cannot cross a tenant boundary
    ok  naming another tenant's organization id grants nothing, read or write
    ok  a suspended membership reads nothing and writes nothing
    ok  a viewer reads the structure and changes nothing
    ok  an org admin manages the structure, so the refusals are authority and not breakage
    ok  a row cannot be moved into another tenant
    ok  a person with no login has a department, a reporting line and a team
✓ organizational spine: idempotency and rollback
```

The eighth is the one that makes the other nine mean something: if an admin
could not manage the structure either, every refusal above would be proving that
the tables are broken rather than that the boundary holds.

**Mutation-tested.** Weakening `team_memberships_person_same_org` to a
single-column foreign key makes assertion 3 fail with exactly its named message.

### 2.3 Workspace context — `organization/workspaceContext.ts`

The session now carries `{ organizationId, organizationName, organizationSlug }`,
derived from the authenticated membership relationship through
`listVerifiedMemberships` — the canonical resolver — and from nothing else.
`resolveWorkspaceForUser` takes a verified user id and has **no parameter
through which a caller could name a tenant**.

**An absent workspace is diagnosed, never assumed.** `listVerifiedMemberships`
answers `[]` to five different situations, and reporting all five as "no
organization" would put CP-1's defect — a failure answered with a plausible
empty state — into the one element every screen shows. A second read runs whose
only job is to say which it was; it returns a reason string and no tenant, and it
doubles as the reachability probe that lets a broken lookup be told from an
empty one at all.

That second read lives in `membershipDirectory.ts`, not beside its caller:
exactly one module on the runtime path may name `organization_memberships`, and
`membershipResolution.test.ts` enforces it.

Seven reasons, seven distinct sentences on screen, and a test that fails when any
two collapse:

| Reason | Header reads | Tone |
|---|---|---|
| `no-membership` | No organization | empty |
| `membership-inactive` | Membership inactive | empty |
| `organization-removed` | Organization removed | error |
| `organization-unnamed` | Organization unnamed | error |
| `permission-denied` | Workspace access denied | error |
| `lookup-failed` | Workspace unavailable | error |
| `not-reported` | Workspace not reported | empty |

Plus `Loading workspace…` while the session restore is running — because "No
organization" printed during a read is a claim about the operator made before
anything was looked at.

### 2.4 The spine API — `organization/organizationRepository.ts`

Read-only. Two routes, `GET /organization/context` and
`GET /organization/structure`, and **neither accepts an organization id**: no
path parameter, no query parameter, no body field.

The edge function holds the service key, so RLS is bypassed and this module's
`organization_id` filter **is** the boundary for anything it returns. One helper
applies it and every read goes through the helper;
`tests/features/organizationSpine.test.ts` asserts it over the recorded query
chain rather than over the source text.

Five flat scoped reads rather than one nested query, because a PostgREST embed
on a non-inner relation restricts nothing — the silent tenant-filter drop
`membershipDirectory` documents at length.

A missing workspace answers **403 for a refusal and 404 for an absence**, because
"your account cannot see this" and "there is nothing here" are different facts.

### 2.5 The surface — `OrganizationSpine.tsx`

The `team` destination is relabelled **Organization** (the id stays `team`; the
id is the URL). It now renders:

* the organization's name, and a summary — people, departments, teams, and
  **how many people have no console login**;
* people outside any department, **stated rather than hidden** — people outside
  the structure are what makes an org chart wrong and are invisible everywhere
  else;
* the structure, business unit → department → team, with leads;
* every person with their department, their manager, their status, and whether
  they can sign in;
* **"Console access"** as a separate, named section below it, with a sentence
  saying a person can belong to the organization above without appearing there.

All five honest states, through `ProductDataState`. **No write control of any
kind** — CP-2's rule was that a control which cannot do its job must not be
offered, and a control offered for a capability that does not exist yet is the
same defect with a nicer excuse.

---

## 3. Verification

| Gate | Result |
|---|---|
| `typecheck:web` | pass |
| `typecheck:tests` | pass |
| `typecheck:api` (Deno) | `ai`, `registry-free`, `server` all clean |
| `test:features` | 1366 / 1366 |
| `test:system` | 177 / 177 |
| `test:ai` | 2183 / 2183 |
| `test:security` | 954 / 954 |
| `test:database` (static) | 30 spine checks, all pass |
| `test:database:spine` (real PostgreSQL) | 10 properties + idempotency + rollback |
| Browser QA (fixture backend) | 14 / 14, desktop and 390px |

### What "LIVE VERIFICATION BLOCKED" means here, precisely

This environment's network policy answers 403 to a `CONNECT` for
`*.supabase.co`. Nothing in this sprint has been run against a live Supabase
project, and nothing here is reported as though it had been. The migrations
have **not** been applied to production and no production secret was touched.

What has been verified empirically is the database behaviour, against real
PostgreSQL 16 running locally, with the real migrations applied in order — which
is stronger than a source-text assertion and weaker than a live project. Both
of those are true and both are stated.

---

## 4. What CP-3 deliberately did not do

* **No writes to the spine.** Hiring, moving a person between departments,
  re-pointing a reporting line, creating a team — all CP-4. Shipping half a
  write surface would be worse than shipping none.
* **No organization switcher.** A session resolves one workspace,
  deterministically by organization id. The count of other organizations is
  carried on the resolution so the choice is on the record rather than silent,
  but no UI offers it.
* **No second permission system.** The two new permission keys join the existing
  RBAC catalogue and are granted to the roles that already hold the equivalent
  member permissions.
* **No production migration execution, no production secret change, no paid
  provider traffic.** As instructed.

---

## 5. What a real deployment would see today

Worth being exact about, because it is the gap between "code complete" and
"delivering value":

| Surface | Against a live project |
|---|---|
| Shell workspace name | **Real.** `organizations` and `organization_memberships` have rows |
| Organization summary | **Empty.** Nothing has written to `people` yet |
| Structure and people | **Empty**, honestly, with the empty state explaining it |
| Console access roster | **Real.** Unchanged from before |

The spine's first rows have to come from somewhere, and CP-4 is where they come
from.
