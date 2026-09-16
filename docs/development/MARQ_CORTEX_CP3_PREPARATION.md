# CP-3 — Organizational spine

**Prepared at the end of CP-2. NOT STARTED.**

The minimum canonical organizational model the rest of Cortex needs before
goals, decisions, value and agents can mean anything.

---

## 0. The finding that sets the shape

**Most of this is already in the database, and the product cannot see any of it.**

`supabase/migrations/20260711050000_cortex_tenancy_foundation.sql` and the two
membership migrations already declare, with RLS and composite keys:

| Table | State |
|---|---|
| `organizations` | Built — slug, status, plan, metadata, uniqueness |
| `organization_memberships` | Built — with a lifecycle migration on top |
| `organization_settings` | Built |
| `roles` / `permissions` / `role_permissions` | Built |

And in the frontend, `organizationId` appears in exactly five files — all of
them AI-platform services (`aiAdminService`, `agentRuntimeService`,
`workflowRuntimeService`, `aiByokService`, `AIAdministrationConsole`). **It
appears nowhere in the session, the app context, or any product surface.** There
is no workspace identity in the shell because the product has never had one.

This is the same shape CP-1 found: an expensive foundation the product does not
read. CP-3 is therefore mostly **connection and modelling of the gaps**, not
greenfield construction — and it should be scoped on that basis rather than as a
build-everything sprint.

---

## 1. What CP-3 must deliver

### Already in the database — connect it
1. **Organization as session context.** The signed-in session must carry the
   organization: id, name, slug. Everything else depends on this.
2. **Workspace identity in the shell.** CP-2 deliberately did not invent one.
   The shell says "MARQ Cortex / Internal Dashboard" — the product name. Once a
   session carries an organization, the shell names the workspace.
3. **Membership as the roster's source.** `TeamManagement` reads
   `/team/members`; `organization_memberships` is the canonical relation.
   Reconcile them rather than running two rosters.
4. **Roles from `roles`/`permissions`.** `teamRole.ts` holds six roles as a
   frontend constant. The database has a role/permission model. One of them is
   authoritative; today neither knows about the other.

### Not in the database — model it
5. **Departments / functions.** No table. Needed by goals, ownership and
   reporting.
6. **Teams** as a grouping distinct from the whole organization.
7. **People** as first-class records, not only as membership rows — a person
   exists before and after a membership.
8. **Reporting and ownership relationships.** Who owns what; who reports to
   whom. This is the relation goals, decisions and agent authority all hang off.
9. **Entity relationships** the later sprints need: an owner for a goal, an
   accountable party for a decision, a scope for an agent.

---

## 2. Exact starting point

> Give the signed-in session an organization, and make the shell say which
> workspace the operator is in.

Concretely, the first change: extend the team session (`src/app/lib/session.ts`
and `AppContext`) to carry `{ organizationId, organizationName, organizationSlug }`
from the login response, and render the workspace name in the shell where
"Internal Dashboard" currently sits.

It is first because it is the smallest change that makes every later one
possible, it uses tables that already exist, and it removes the one shell
omission CP-2 identified and deliberately left alone.

---

## 3. Constraints carried forward

- **Follow the existing tenancy pattern exactly.** Composite keys and RLS from
  day one — `20260910120000_cortex_tenancy_composite_keys.sql` is the reference.
- **Nothing fabricated.** New surfaces obey CP-1's five states and CP-2's
  capability rule: a destination is not added to the sidebar until it can do
  what its label says. `capabilityTruth.test.ts` will fail the build otherwise.
- **The withdrawn destinations are not CP-3's.** Reviewer QA, Execution and
  Mapping Engine need producers, and those belong with the work that produces
  them — not with the organizational model.
- **Live verification is still blocked.** CP-3 touches the database more than
  CP-1 or CP-2 did, so the blocked Supabase egress will constrain it harder.
  Plan for fixture-backed verification and expect to report live verification
  as blocked again unless egress is granted.

---

## 4. Out of scope for CP-3

Goals, OKRs, decisions, risks, opportunities and value architecture — CP-4.
They are the reason CP-3 exists, and building them inside it would repeat the
mistake of shipping a surface before its spine.
