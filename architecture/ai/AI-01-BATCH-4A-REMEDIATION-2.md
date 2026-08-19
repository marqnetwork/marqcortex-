# AI-01 Batch 4A — final revocation remediation

**Round:** 2 (following the independent review of `11588267`, verdict FAIL)
**Branch:** `claude/demotion-fail-closed-fix-cq09r8`
**Status:** REMEDIATED — awaiting final independent verification

Round 1 closed HIGH-2, HIGH-3, MED-1 and MED-2, and the review confirmed them
independently. This document covers only what round 2 changed: H-A, M-A, M-B and
the four low findings, plus two defects of the same family that the self-review
turned up and fixed before commit.

---

## H-A — a partial demotion did not revoke authority

### What was wrong

Round 1 wrote the membership first on a demotion, reasoning that a failed second
write left the account "still holding the old team role, which is strictly less
than it had". It was not less. `ROLE_CAPABILITIES.admin` in
`ai/security/actor.ts` grants `ai.agent.execute`, `ai.block.assist`,
`ai.copilot.plan`, `ai.section.copilot` and `ai.analysis.run` **on the strength
of the team role alone**, with no membership involved. `resolveActor` unioned
the two role sources, so a demotion whose `app_metadata` write failed removed
nothing at all — the actor kept every capability, and `authorizeTeamAdmin` still
admitted them to the console's team-management routes.

**Reordering alone would not have fixed it.** Whichever write goes first, the
other is briefly stale, and a union grants whatever the stale half still says:

| Written first | Second write fails | Union grants | Floor grants |
|---|---|---|---|
| membership | `app_metadata` still `admin` | `ai.agent.execute` (from `admin`) | the new role only |
| `app_metadata` | row still `org_admin` | `ai.agent.execute` (from `org_admin`) | the new role only |

### The fix — two parts

**1. The authority floor** (`ai/security/actor.ts`). The union is replaced by a
floor: an actor holds no more than the **lower** of the trusted team role and
what the membership row can stand for. A membership key stands for the most
privileged team role that maps to it (`MEMBERSHIP_AUTHORITY_CEILING`:
`org_admin` → `owner`, `team_member` → `consultant`, `team_viewer` → `viewer`).

This changes **nothing in a consistent state**, by construction: every team role
maps to an organization role whose grant is a subset of its own, so in agreement
the floor is the team role — which is what the union already produced.
`membershipRoleMapping.test.ts` asserts that subset property, so if it ever
stopped holding the test fails rather than the behaviour silently changing.

A membership row with **no trusted team role behind it** grants nothing at all.
`app_metadata` is the authority (HIGH-2); a row on its own is not one.

**2. The ordering** (`membershipLifecycle.ts`). A demotion now lowers the
trusted `app_metadata` team role **first**, invalidates, then lowers the
membership. `app_metadata` is re-read from the auth service on every request in
every isolate with no cache in front of it, so lowering it first takes effect
platform-wide at once. The higher team role is **never** restored as
compensation. A failed membership write returns `MEMBERSHIP_INCONSISTENT`.

The floor is what makes a partial demotion revoke; the order is what makes it
revoke *immediately*, without waiting for a membership read.

### Where the floor is applied

| Surface | Function | Was |
|---|---|---|
| AI execution capabilities | `resolveActor` | union of both sources |
| AI administration tier | `resolveAdminRole` (`admin/rbac.ts`) | union of both sources |
| Agent runtime | `resolveAgentActor` (`agents/service/agentRbac.ts`) | union of both sources |
| Workflow runtime | `resolveWorkflowActor` (`workflows/service/workflowRbac.ts`) | union of both sources |

The last three were found by the self-review, not by the review, and are the
same defect in three more places. `resolveAdminRole` in particular decided
whether a stale `org_admin` row conferred organization-wide read access to
usage, cost and the AI audit trail.

---

## Task 2 — the vacuous regression test

The round-1 test asserted `!actor.roles.includes('org_admin')` — true, while
`ai.agent.execute` sat in `actor.capabilities` untouched. It tested a label.

Replaced by `H-A: a demotion whose membership write fails still revokes` in
`tests/features/membershipLifecycle.test.ts`, which asserts, in this order:

1. the change reports failure (`MEMBERSHIP_INCONSISTENT`), never success
2. `ai.agent.execute` is **absent** from `actor.capabilities`
3. the capability set equals a freshly-provisioned viewer's, exactly
4. no member of `PRIVILEGED_CAPABILITIES` survives
5. `authorizeTeamAdmin` **refuses** the account — console authority is gone
6. `resolveAdminRole` returns neither `super_admin` nor `organization_admin`
7. the error names the remaining inconsistency and states no elevated access remains

Role labels appear last, as supplementary diagnostics, to prove the membership
row really is still stale — so the revocation is the floor's doing and not a
tidy-up that happened anyway.

Covered: `admin -> viewer`, `admin -> analyst`, `owner -> viewer`, plus a loop
proving the higher role is never restored as compensation.

---

## M-A — the cross-isolate revocation window

### What was wrong

`MembershipInvalidationSignal` is in-process. An invalidation published by the
isolate that performed a demotion reached that isolate and **no other**, so
every other isolate kept serving a cached `org_admin` for up to the 60-second
TTL. Round 1's "revocation is immediate" was true of one isolate out of N.

### The design chosen — authoritative read-through for privileged resolution

Two properties close it, and neither is a cache:

1. **The trusted role is never cached.** `getUser` verifies the bearer token
   against the auth service on every request, so `app_metadata` is current in
   every isolate the instant it is written. With the floor, lowering it is a
   platform-wide revocation.

2. **A privileged capability resolves memberships from the database.** The AI
   Guard reads the capability the feature *declares* (`descriptor.capability` —
   not anything the caller sends) and asks for an authoritative resolution when
   it is in `PRIVILEGED_CAPABILITIES`: `ai.analysis.run`, `ai.block.assist`,
   `ai.copilot.plan`, `ai.section.copilot`, `ai.agent.execute`. The AI
   administration surface, the agent runtime and the workflow runtime pass
   `privileged: true` unconditionally.

**Requirements met.** No second membership resolver — a privileged request calls
the same `listMemberships` port and simply declines to skip it. No client
authority — the hint is derived from the feature catalog, and lying about it in
either direction only asks for a slower or staler answer. No default tenant. No
in-memory-only revocation: the signal is demoted to an optimisation that saves
the writing isolate a round trip, and nothing depends on it for correctness.
Ordinary low-risk reads (`ai.narrative.generate`, `ai.chat.converse` — the two
capabilities every team member already holds) still use the snapshot, because
there is nothing there for a revocation to take away.

**Defence in depth.** A subject answered from the snapshot carries
`membershipsFromCache: true`, and `resolveActor` withholds every privileged
capability from it (`resolveAdminRole` ignores its membership roles entirely).
So a future caller forgetting `privileged: true` produces a **denial**, not a
stale grant.

`membershipRoleMapping.test.ts` asserts that every capability in the grant table
is either baseline or privileged — no gap, no overlap — so a new capability
cannot land in the "servable from a stale snapshot and revocable" combination.

### Proof

`M-A: a revocation in one isolate binds every other isolate` builds two
authenticators over one auth directory and one database, with only the first
subscribed to the signal. **The clock never moves in any of these tests.**

- isolate A caches `org_admin`; isolate B demotes → `ai.agent.execute` absent
  from A's next privileged request, capability set equals a viewer's
- membership revoked directly in the database, `app_metadata` untouched → A's
  next privileged request fails closed with `ORGANIZATION_REQUIRED`
- membership re-roled down, `app_metadata` untouched → A's stale `admin` team
  role does not out-vote the demoted row
- an ordinary read may use the snapshot and yields nothing privileged
- a privileged read refreshes the snapshot it declined to use

---

## M-B — team owner ≠ AI platform super_admin

### What was wrong

`SUPER_ADMIN_ROLES` in `ai/admin/rbac.ts` contained `owner`. `owner` is a MARQ
**team** role in `app_metadata.team_role`, assignable by any existing owner
through `PATCH /team/members/:id` and stampable by any reviewed roster. Holding
it granted the AI **platform operator** tier: the emergency kill switch, the
provider configuration every tenant executes through, the global daily ceilings,
and the reset of MARQ's lifetime funded spend.

### The fix — the existing trusted platform mechanism, not a new one

`cortex.is_platform_admin()` has read `app_metadata ->> 'platform_role' =
'admin'` since the tenancy migration, and every RLS policy in the database is
written against it. That is the strongest trusted platform authority that
already exists, so it is the one used.

| Question | Answered by | Written by |
|---|---|---|
| What may they do in their organization / team? | `app_metadata.team_role`, and the mapped membership row | the console's team routes, the roster artifact |
| May they administer the AI **platform**? | `app_metadata.platform_role = 'admin'` | the service role, by a person, with ops approval |

- `resolvePlatformAuthority` / `resolveTrustedGlobalRoles` in
  `teamAuthorization.ts` emit `platform_admin` for `platform_role = 'admin'` and
  for nothing else; `index.tsx` hands the AI plane both facts separately.
- `SUPER_ADMIN_ROLES` = `{platform_admin, super_admin}`. No team role can ever
  reach it: `normalizeTeamRole` cannot return a string outside `TEAM_ROLES`, and
  neither name is in it.
- `owner` and `org_admin` move to `ORGANIZATION_ADMIN_ROLES` — read-only
  visibility across their organizations, no platform mutation.
- The platform tier is resolved from **global roles only**. A membership row is
  a statement about one tenant and cannot make somebody the platform's operator.

### What a MARQ team owner keeps

Full console team administration, every AI execution capability, `org_admin` on
their membership, and the AI administration surface at the `organization_admin`
tier. What they no longer get, by accident, is the ability to turn AI off for
every other tenant.

### Roster stamping cannot mint platform administration

Already true structurally, now asserted: `stamp_team_roster` validates every
role against `cortex.team_roles()` and **merges** exactly two keys
(`marq_team`, `team_role`) into the existing bag, so it can neither create a
platform administrator nor destroy one. `teamAppMetadata` — the single shape
every console provisioning path sends — carries those two keys and no other, and
a wiring test asserts `index.tsx` contains no literal `platform_role` at all.

The example roster and its README now say outright that `owner` grants no AI
platform administration, rather than leaving it to be inferred.

---

## Low findings

**L1 — a tampered stamped account could block rollback forever.**
`unstamp_team_roster` skips any account whose `app_metadata` differs from what
the artifact wrote, and an ordinary console role change is enough to trigger it.
`cortex.release_team_stamp` (migration `20260819120000`) is the documented way
forward: it removes `marq_team` and `team_role` from what the account
*currently* carries — never restoring the recorded bag over a later edit, which
is what would destroy `platform_role` — one account at a time, with a mandatory
recorded reason, dry-run by default, refusing an account that has not drifted
and naming the clean reversal instead. It can only ever reduce authority.
`cortex.team_stamp_drift` reports which accounts drifted and how.

**L2 — the invite crash window.** Two systems cannot be written in one
transaction, so the answer is deterministic detection plus a bounded, documented
recovery. `cortex.orphaned_team_accounts()` lists stamped, live auth accounts
with no active membership in the live MARQ organization, with `age_minutes` and
a `banned` flag. Recovery is an operator **decision** — adopt via
`marq_sync_team_membership`, or remove — because an automatic adopt would grant
a membership nobody approved and an automatic delete would remove an account
somebody may be part-way through creating. Runbook in `MEMBERSHIP_BOOTSTRAP.md`.

**L3 — banned account semantics.** Confirmed fail-closed where they already
live, and not extended. GoTrue refuses a banned account's token, so no subject
resolves at all; the bootstrap's eligibility predicate excludes
`banned_until > now()` while admitting an account whose ban has *expired*; and
the orphan report flags a ban rather than acting on it. No suspension or ban
product feature was invented.

**L4 — membership action reporting.** `marq_sync_team_membership` reported
`created` from an arm that had *updated* a row another writer created, and the
console's `MembershipAction` union carried `reactivated`, which no code path can
produce (a soft-deleted row is a tombstone the lifecycle does not revive — it
inserts a new row beside it, which is `created`). The function now uses
`xmax = 0` to claim `created` only for a tuple it inserted and reports
`reconciled` when it took over a row whose prior role it never observed.
`reactivated` is removed from the union, and the RPC port **validates** the
returned action instead of casting it.

---

## Self-review findings, fixed before commit

Two defects of the H-A family that the review did not name:

1. **Agent and workflow RBAC unioned the two sources** (see the table under
   H-A). A membership demoted directly in the database left the stale team role
   granting `agent.run.create` and `agent.approval.decide` through
   `AGENT_ROLE_CAPABILITIES`, which `resolveActor`'s floor never sees. Both now
   use `flooredRolesFor`.

2. **Account removal revoked the membership first.** Same reasoning as H-A, same
   flaw: revoking the membership leaves `marq_team` and `team_role` standing on
   a live account, and those are what `verifyTeamToken` and `authorizeTeamAdmin`
   read — so a removal that got half-way through left somebody just removed
   still able to invite, re-role and delete their former colleagues. Removal is
   the maximal demotion, so the account is deleted **first**; a failed
   revocation then leaves a membership row for an account that cannot
   authenticate, reported as `MEMBERSHIP_INCONSISTENT`.

Also attacked and found sound: global-role/membership union behaviour across
multiple memberships (a key can only survive on a rank its own membership also
reaches); forged `user_metadata` on both surfaces; promotion/demotion
disagreement including a failed compensating revert; the privileged hint being
guard-derived rather than caller-supplied; `platform_admin` minting through
every write path; cross-tenant hints; and rollback damage.

---

## Verification

| Suite | Result |
|---|---|
| `test:lifecycle` | PASS — 186/186 |
| `test:security` | PASS — 266/266 |
| `test:database` | PASS — 101/101 |
| `test:features` | PASS — 601/601 |
| `test:ai` | PASS — 1654/1654 |
| `test:system` | PASS — 161/161 |
| `scan:boundaries` | PASS — 98/98 |
| `typecheck:api:ai` | PASS — clean |
| Real PostgreSQL scenarios | PASS — all phases, incl. the new L1/L2/L3/L4 and rollback harnesses |
| `typecheck:api` (all boundaries) | PARTIAL — `ai` clean; `server` BLOCKED (registry egress) |
| `typecheck:tests`, `typecheck:web` | PRE-EXISTING failures only, byte-identical to the baseline on this branch's parent |

The PostgreSQL run is against PostgreSQL 16.13, driving the real migration files
and the real rollback files — not copies.
