# Membership Bootstrap Procedure

**Sprint:** MCV2-S4-IMPLEMENT-001
**Automated by:** AI-01 Batch 4A —
`supabase/migrations/20260818120000_marq_team_membership_bootstrap.sql`,
`supabase/migrations/20260818130000_marq_membership_lifecycle.sql`,
`supabase/migrations/20260819120000_marq_authority_recovery.sql` and
`supabase/migrations/20260820120000_marq_authority_provenance.sql`
**Status:** Automated end to end. The bootstrap admits the team that exists when
it runs; the lifecycle keeps every later invite, role change and removal in step.
A one-time, operator-reviewed **stamping** step is a **prerequisite** for
accounts created before app metadata existed — see
[One-time stamping](#one-time-stamping-for-accounts-that-predate-app-metadata).

> **Deployment prerequisite.** Since the Batch 4A remediation, an account is a
> MARQ team account only if it carries `app_metadata.marq_team`. The
> `user_metadata.teamRole` fallback is gone. **Every unstamped account loses
> console access the moment this ships**, and stamping the reviewed roster is
> how that is closed — not a follow-up task. Do the stamping run in the same
> maintenance window as the deploy.

## Round 3: the roster stamp now moves BOTH halves

Since `20260820120000`, `cortex.stamp_team_roster` writes the trusted
`app_metadata` **and** the MARQ organization membership row, through the one
authoritative membership write. A reviewed roster is a complete authority
decision or it is no decision at all.

Two consequences for this procedure:

- **A stamping run no longer needs a bootstrap run afterwards.** The accounts it
  stamps receive their memberships in the same transaction. The bootstrap remains
  the right tool for admitting a team that already carries `app_metadata` and has
  never been through a roster.

- **Re-stamping at a new role can no longer create drift.** Before this, a
  re-stamp moved `app_metadata` and left the membership row where it was, which
  manufactured a permanently half-applied role change. The server resolves the
  **lower** of the two halves, so such an account silently kept its old
  authority with no failure reported anywhere.

To find accounts whose two halves disagree — from a stamp that predates this, or
from a role change whose second write failed:

```sql
SELECT * FROM cortex.team_authority_drift();
```

It is read-only, and `effective_team_role` is what the server actually resolves.
Re-running the membership write for that account reconciles it:

```sql
SELECT public.marq_sync_team_membership('<user_id>'::uuid, '<team_role>');
```

## What changed, and why

This procedure was manual because sprint rules forbid inventing user IDs, and a
migration that writes memberships has to get its IDs from somewhere. The
procedure was then never run in production: `public.organization_memberships`
returned **zero active rows**, so every operator authenticated successfully,
resolved no verified organization, and the AI guard failed the request closed at
`resolveOrganization` — the correct behaviour applied to an empty table.

Migration `20260818120000` closes that gap without breaking the rule it was
written for. It does not invent IDs; it **derives real ones from `auth.users`**.

## Correction: eligibility is `app_metadata`, not `user_metadata`

The first version of this migration, and several comments elsewhere in the
codebase, asserted that `user_metadata` is "writable only through the
service-role admin API". **That is false.** Supabase's GoTrue serves
`PUT /auth/v1/user`, and any signed-in account — holding nothing beyond its own
access token and the public anon key that ships in the browser bundle — may
rewrite its own `raw_user_meta_data`.

Under the old predicate (`raw_user_meta_data ->> 'role' = 'team'`), a `viewer`
could set `{"role":"team","teamRole":"owner"}` on themselves and be granted an
`org_admin` membership in the MARQ organization by the migration. The bootstrap
would have been a self-service privilege escalation with a migration timestamp
on it.

`raw_app_meta_data` is the bag GoTrue refuses to write for a user-scoped call;
only the service role sets it. The platform already treats it as authority —
`cortex.is_platform_admin()` reads `app_metadata ->> 'platform_role'` — so this
is the strongest authority that already exists here, not a new one.

| | Writable by the account holder | Used for |
|---|---|---|
| `raw_app_meta_data.marq_team` | No | **Eligibility.** The only thing the migration reads. |
| `raw_app_meta_data.team_role` | No | **Role.** Mapped to a system role key. |
| `user_metadata.teamRole` | **Yes** | **Nothing.** Display mirror only. Read by no authorization path, no capability grant and no membership decision. |

### The fallback was removed, not narrowed (HIGH-2)

The first remediation kept reading `user_metadata.teamRole` when an account
carried no `app_metadata.team_role`, on the reasoning that the fallback "grants
no more than it granted yesterday". What it granted yesterday was console team
**administration**: an arbitrary authenticated Supabase account that wrote
`{"teamRole":"owner"}` into its own user metadata resolved as an `owner` and
passed `authorizeTeamAdmin`. Public signup being disabled was the only thing in
the way, and a product setting is not an authorization control.

`resolveTeamAuthority` now reads `app_metadata` and nothing else:

1. no `app_metadata.marq_team` → **not a team account**. No role, at all.
2. stamped, with `team_role` → that role, normalised.
3. stamped, no `team_role` → `viewer`. A data gap resolves to the least
   privilege, never the most.

`verifyTeamToken` applies gate 1 to **every** console route — all forty of them,
not only the three named in the finding — so an authenticated stranger is
refused everywhere rather than in three places.

The server writes both bags on every provisioning path
(`supabase/functions/server/index.tsx`): the startup admin seed, `POST
/team/invite`, and `PATCH /team/members/:id`. `teamAppMetadata()` in
`teamAuthorization.ts` is the single shape they all send.

## What the migration does

| | |
|---|---|
| Scope | The seeded MARQ organization only (`slug = 'marq'`, `deleted_at IS NULL`) |
| Eligibility | `auth.users` with `raw_app_meta_data ->> 'marq_team' = 'true'`, not deleted, not currently banned |
| Role | Mapped from `raw_app_meta_data ->> 'team_role'` to the seeded system role catalog (table below) |
| Status | `active` |
| Guard | Inserts only where **no membership row exists at all** for that (organization, user) — deleted rows included |
| Idempotent | Yes — re-running inserts nothing and updates nothing |
| Concurrency | Transaction-scoped advisory lock, taken before any DDL, plus `ON CONFLICT … DO NOTHING` |
| Provenance | Every created row is recorded in `cortex.membership_bootstrap_log` |

## What the migration will not do

- **No organization is created.** If the MARQ organization is missing, the
  migration is a no-op and raises a notice. A bootstrap that creates its own
  tenant is a default tenant under another name.
- **No `auth.users` row is created or modified.** The auth schema is never written.
- **`platform_admin` is never assigned.** That role is granted by a person,
  through the admin API, with ops approval. No arm of the role mapping can
  produce it.
- **No membership is revived, re-activated or re-roled.** The guard is "no
  membership row exists", so an `invited`, `suspended` or **soft-deleted** row
  all mean the same thing: somebody already decided about this person. A removed
  member does not silently regain access by being admitted alongside their
  tombstone.
- **No default or fallback tenant is introduced.** `AI_ALLOW_DEFAULT_ORGANIZATION`
  remains `false`, and a subject with no verified membership still fails closed.
- **Nothing is inferred from `user_metadata`.** The migration contains no read of
  `raw_user_meta_data`, and a test asserts its absence.

## Role mapping

`TEAM_ROLE_TO_ORGANIZATION_ROLE` in
`supabase/functions/server/teamAuthorization.ts` is **the** mapping. The SQL
`CASE` in the migration, `LEGACY_TEAM_ROLE_MAP` in `src/types/database.types.ts`
and the table below are copies, and `tests/features/membershipRoleMapping.test.ts`
reads all four and fails if any of them disagrees.

| `app_metadata.team_role` | System role key |
|--------------------------|-----------------|
| owner | `org_admin` |
| admin | `org_admin` |
| consultant | `team_member` |
| analyst | `team_member` |
| reviewer | `team_member` |
| viewer | `team_viewer` |
| *missing or unrecognised* | `team_viewer` |

An unrecognised value resolves to the **least** privileged role, matching
`normalizeTeamRole`. A data gap must never widen access.

**`manager` was removed from this table.** It is not a member of `TEAM_ROLES`, so
`normalizeTeamRole('manager')` resolves it to `viewer` — while this table and
`LEGACY_TEAM_ROLE_MAP` both used to send it to `org_admin`. One said read-only
and the other said organization administrator. It now falls to the
"unrecognised" row, with everything else the console cannot issue.

### What a membership role grants

`ROLE_CAPABILITIES` in `ai/security/actor.ts` carries both vocabularies: the
console's team roles and the three organization role keys. Before the keys were
added, joining `roles(key)` into the membership query changed what the query
returned and nothing about what any actor could do — an unmapped key grants
nothing, so an `org_admin` and a `team_viewer` still resolved identically.

Each key is granted at the level the team role it maps from already had:
`org_admin` = the `admin` grant, `team_member` = the `reviewer` grant (the least
of the three roles that map to it), `team_viewer` = nothing. A test asserts no
key grants a capability its source team role does not.

#### The two sources are FLOORED, not unioned (H-A)

Roles used to be additive — team role ∪ membership role. That is safe only while
the two agree, and they cannot be written atomically, so there is always a
window in which they disagree. The union hands the account whichever half is
still stale:

| Written first | Second write fails | Union grants | Floor grants |
|---|---|---|---|
| membership | `app_metadata` still `admin` | `ai.agent.execute` (from `admin`) | the new role only |
| `app_metadata` | membership row still `org_admin` | `ai.agent.execute` (from `org_admin`) | the new role only |

`authorityFloor` in `ai/security/actor.ts` grants **the lower of the two**. An
actor holds `min(trusted team role, what the membership row can stand for)`,
where a membership key stands for the most privileged team role that maps to it
(`org_admin` → `owner`, `team_member` → `consultant`, `team_viewer` → `viewer`).

This changes **nothing in a consistent state**, by construction: every team role
maps to an organization role whose grant is a subset of its own, so in agreement
the floor is the team role — which is what the union already produced. It bites
only while the two disagree, which is what it is for.

A membership row with **no trusted team role behind it** grants nothing at all,
in either vocabulary. `app_metadata` is the authority (HIGH-2); a row on its own
is not one.

The same floor is applied to the AI administration tier in `ai/admin/rbac.ts`
(`flooredRoleNames`), so a stale `org_admin` row cannot confer organization-wide
read access to usage, cost and the audit trail either.

## Applying it

```bash
supabase db push          # or: psql "$DATABASE_URL" -f supabase/migrations/20260818120000_marq_team_membership_bootstrap.sql
```

Verify:

```sql
SELECT r.key, m.status, COUNT(*)
FROM public.organization_memberships m
JOIN public.organizations o ON o.id = m.organization_id AND o.slug = 'marq'
JOIN public.roles r ON r.id = m.role_id
WHERE m.deleted_at IS NULL
GROUP BY r.key, m.status
ORDER BY r.key;
```

## One-time stamping for accounts that predate app metadata

On a database whose team accounts were all created before the provisioning
routes wrote `app_metadata`, **the migration admits nobody and says so**:

```
NOTICE: membership bootstrap: no auth user carries app_metadata.marq_team = true,
        so none was admitted.
```

That is the correct outcome, not a regression. Deciding who is internal MARQ
staff from a field the account holder controls was never a decision a migration
was entitled to make, and there is no other field on those rows that
distinguishes a colleague from a stranger who signed up.

Two ways forward, and they compose:

**1. Let the console do it.** Every account created by `POST /team/invite` and
every account whose role is changed through `PATCH /team/members/:id` is stamped
as a side effect. Re-run the migration afterwards; it is idempotent.

**2. Stamp a reviewed roster once, through the committed artifact.**

The hand-edited `UPDATE auth.users … FROM (VALUES …)` that used to live here has
been removed. Deciding who is internal MARQ staff is a security boundary, and
running it from a paragraph in a markdown file meant a typo stamped a customer,
a dropped `WHERE` stamped everybody, and nothing afterwards recorded what had
been done or could undo it.

It is now `cortex.stamp_team_roster`, defined in migration `20260818130000` and
driven by `scripts/roster/stamp-team-roster.mjs`.

```bash
cp supabase/operations/roster/team-roster.example.json \
   supabase/operations/roster/2026-08-19.local.json
# fill in the reviewed list, then:

# Plan. This is the DEFAULT; it writes nothing.
DATABASE_URL="postgres://…" node scripts/roster/stamp-team-roster.mjs \
  --roster=supabase/operations/roster/2026-08-19.local.json

# Apply, stating the count you reviewed.
DATABASE_URL="postgres://…" node scripts/roster/stamp-team-roster.mjs \
  --roster=supabase/operations/roster/2026-08-19.local.json --expect=7 --apply
```

Then re-run the bootstrap migration; it is idempotent, and it is what turns the
stamps into memberships.

**Who may run it, and who may not.** `auth.users` belongs to the `auth` schema.
The `service_role` **API key** is a PostgREST role and holds **no privilege on
that schema** — it cannot perform a direct `auth.users` SQL update, and the
earlier "Run as the service role" instruction in this document was wrong.
Stamping runs over a **direct database connection as a privileged role** (the
Supabase SQL editor, or the `postgres` connection string from Project Settings →
Database). The functions are `SECURITY INVOKER` and granted to nobody, so they
add no authority of their own: everything they guarantee is validation.

**What the artifact refuses, and why each one exists:**

| Refusal | The accident it prevents |
|---|---|
| an empty roster | "stamp everyone" starts life as "stamp nobody" |
| more than 200 entries | a bulk stamp is not a reviewed roster |
| `--expect` ≠ roster length | the list that was reviewed is the list that is applied |
| a malformed id | no ambiguity about who was meant |
| the same id twice | two intentions, and no way to pick one |
| a role outside `TEAM_ROLES` | `platform_admin` and every other invention |
| an id with no `auth.users` row | a stamp for nobody |
| a deleted auth user | staff status revived for a closed account |
| an active membership in another organization | **stamping a customer** |

All of them run **before** the first write, inside one transaction, so a roster
that fails anywhere changes nothing. `platform_role` is never written and never
destroyed: the stamp merges two keys and leaves the rest of the bag alone.

**Provenance.** Every stamp is recorded in `cortex.team_roster_stamp_log`: the
user id, the intended team role, the artifact identifier, the timestamp, the
database role that ran it, and the `app_metadata` before and after.

**Reversal.**

```bash
DATABASE_URL="postgres://…" node scripts/roster/stamp-team-roster.mjs \
  --artifact=marq-internal-roster-2026-08-19 --unstamp            # plan
DATABASE_URL="postgres://…" node scripts/roster/stamp-team-roster.mjs \
  --artifact=marq-internal-roster-2026-08-19 --unstamp --apply
```

`cortex.unstamp_team_roster` reads that ledger and nothing else. It restores what
each account carried before the stamp, and **skips any account somebody has
changed since** — a changed account belongs to whoever changed it. An unknown
artifact raises rather than quietly doing nothing, so a typo is not mistaken for
a no-op. Unstamping does **not** revoke memberships; see
[Rollback](#rollback) for the order.

**No real UUIDs live in this repository.** The roster is operator-supplied JSON
at run time, `supabase/operations/roster/*.local.json` is gitignored, and a
static test asserts that neither migration contains a literal UUID.

## The membership lifecycle

`supabase/migrations/20260818130000_marq_membership_lifecycle.sql` and
`supabase/functions/server/membershipLifecycle.ts`.

The bootstrap admits the team that exists when it runs. Everything after that is
the lifecycle's, and it is not optional: before it existed, a console demotion
rewrote `app_metadata` and left the membership at `org_admin` (HIGH-1), and a
console invite created an account with no membership at all (MED-1).

### One authoritative write

```sql
public.marq_sync_team_membership(p_user_id uuid, p_team_role text, p_actor_id uuid)
public.marq_revoke_team_membership(p_user_id uuid, p_actor_id uuid)
```

A user id and a **team** role. Nothing else. The organization is resolved by slug
inside the function and the system role is resolved from the seeded catalog
inside the function, so **no `organization_id` and no `role_id` crosses the
wire** — a browser cannot name a tenant or a privilege, because there is no
parameter through which to name one. Granted to `service_role` only.

| Event | `app_metadata` | `organization_memberships` |
|---|---|---|
| invite / create | written by `createUser` | **created**, `active`, at the mapped role |
| role change | rewritten | `role_id` **moved** to the mapped role |
| removal | account **deleted first** | soft-deleted second |

### Ordering, and what a partial failure leaves behind

Two systems cannot be written atomically, so the order is chosen to make the
only reachable partial state the safe one:

- **Demotion** (the new role ranks lower) — **the trusted `app_metadata` team
  role first**, then the authority caches, then the membership. `app_metadata`
  is the account's highest authority and it is re-read from the auth service on
  every request in every isolate with no cache in front of it, so lowering it
  first takes effect everywhere at once. If the membership write then fails the
  route returns `MEMBERSHIP_INCONSISTENT` and the row is left stale — the floor
  above means it grants nothing. The higher team role is **never** restored as
  compensation: that would undo the revocation an administrator just asked for.

  > This was the other way round in the first remediation, and that was finding
  > **H-A**. Membership went first on the reasoning that the account would
  > "still hold the old team role, which is strictly less than it had". It was
  > not less — `ROLE_CAPABILITIES.admin` grants `ai.agent.execute` with no
  > membership at all — so a partial demotion revoked nothing. Reversing the
  > order alone would not have fixed it either; the floor is what makes a
  > partial demotion revoke, and the order is what makes it revoke immediately.
- **Promotion or lateral** — `app_metadata` first, membership second. A failed
  membership write **reverts** the account record and the route returns
  `MEMBERSHIP_SYNC_FAILED`; the member keeps their previous role.
- **Invite** — a failed membership write **deletes the account just created**
  and the route returns `MEMBERSHIP_PROVISIONING_FAILED`. Half a hire is worse
  than none: an operator retrying an invite gets a whole one.
- **Removal** — **account first**, membership second, for the same reason the
  demotion lowers `app_metadata` first: removal is the maximal demotion. A
  failed account delete changes nothing and returns
  `MEMBERSHIP_REVOCATION_FAILED`; a failed revocation leaves a membership row
  for an account that no longer exists and returns `MEMBERSHIP_INCONSISTENT`.

  > This was membership-first, on the H-A reasoning: "revoke first, so a failed
  > second write has already revoked". It had the H-A flaw. Revoking the
  > membership leaves `marq_team` and `team_role` standing on a live account,
  > and those are what `verifyTeamToken` and `authorizeTeamAdmin` read — so
  > somebody just removed could still invite, re-role and delete their former
  > colleagues through the console. Deleting the account first cannot leave
  > authority anywhere, because every path requires the caller to authenticate.

In every case the route returns a failure. A role change that did not fully
apply must not answer `200`.

### Revocation is immediate, in every isolate (M-A)

The AI authenticator caches memberships for 60 seconds, per isolate. A signal
cannot leave the process that fired it, so an invalidation published by the
isolate that performed a demotion reached that isolate and **no other** — every
other one kept serving a cached `org_admin` until its own TTL expired. That is a
stale privileged authorization window, and no length of it is acceptable.

Two properties close it, and neither is a cache:

1. **The trusted role is never cached.** `getUser` verifies the bearer token
   against the auth service on every request, so `app_metadata` — and the team
   role the floor reads from it — is current in every isolate the instant it is
   written. Lowering it first (above) is therefore a platform-wide revocation.

2. **A privileged capability is resolved authoritatively.** The AI Guard reads
   the capability the feature declares and asks the authenticator for an
   authoritative resolution when it is one of `PRIVILEGED_CAPABILITIES` —
   `ai.analysis.run`, `ai.block.assist`, `ai.copilot.plan`, `ai.section.copilot`
   and `ai.agent.execute`. Those requests read `organization_memberships`
   through the **same** `listMemberships` port, in whichever isolate is serving,
   and simply decline to skip it. The AI administration surface, the agent
   runtime and the workflow runtime pass `privileged: true` unconditionally.

   There is no second resolver, no second query and no second answer — the
   privileged path is the ordinary path without the shortcut.

A subject answered **from** the snapshot is marked `membershipsFromCache`, and
`resolveActor` withholds every privileged capability from it. So forgetting to
mark a call privileged produces a denial, not a stale grant.

An ordinary request — one whose feature needs only `ai.narrative.generate` or
`ai.chat.converse`, the two capabilities every authenticated team member already
holds — is still served from the snapshot. There is nothing there for a
revocation to take away, so a round trip would buy latency and no security.

The TTL remains as the backstop for the ordinary path.

### Suspension

`organization_memberships.status` supports `suspended`, and a suspended row
grants nothing: `listVerifiedMemberships` admits `active` only. A role change
**does not** rewrite `status`, so re-roling a suspended member does not
reactivate them — a suspension is a decision, and a role change is not a reason
to reverse it.

## Account lifecycle — what the product actually supports

Audited rather than assumed. Only these four states exist; nothing else is
claimed:

| Action | Where | Auth record | Membership | Can they still act? |
|---|---|---|---|---|
| **Invite** | `POST /team/invite` | created, stamped | created `active` at the mapped role | Yes, at that role |
| **Role change** | `PATCH /team/members/:id` | `app_metadata.team_role` rewritten | `role_id` moved | Yes, at the new role — old capabilities gone on the next request |
| **Delete** | `DELETE /team/members/:id` | hard-deleted | **soft-deleted first**, and the FK cascade would remove it anyway | No: no account, no token, no membership |
| **Ban** | Supabase Dashboard only | `banned_until` set | **untouched** | No: GoTrue issues no token, so nothing reaches the console |

**There is no suspend or reactivate action in the product**, and none is invented
here. The console offers no route for either; `status = 'suspended'` is reachable
only by direct database work, and when it is set the member resolves no
organization. Reactivation is the same direct database work in reverse.

**A banned account keeps its membership row.** That is safe — a ban stops token
issuance, so the row is never presented — but it is not a revocation. To revoke
authority as well as access, run
`SELECT public.marq_revoke_team_membership('<user id>');`, or remove the member
through the console. The bootstrap will not re-admit a banned account
(`banned_until` excludes them) and will not re-admit a removed one (any existing
row, tombstone included, blocks admission).

**A member who is not a provisioned team account cannot be re-roled.** `PATCH`
answers `404 NOT_A_TEAM_ACCOUNT` rather than stamping them as a side effect of an
edit — that would be an invite without an invite's checks.

## Platform administrators

```sql
-- Via Supabase Admin API only; do not run without explicit ops approval.
-- app_metadata.platform_role = 'admin' enables cortex.is_platform_admin()
```

Deliberately outside everything above. No arm of the role mapping can emit
`platform_admin`, the sync function refuses it explicitly, the roster artifact
rejects it as a team role and never writes `platform_role`, and the bootstrap
rollback carries a guard that makes it unable to revoke one. Platform
administration is granted by a person, and by no automation in this repository.

### A team owner is not the AI platform operator (M-B)

`team_role = 'owner'` used to be routed through `SUPER_ADMIN_ROLES` in
`ai/admin/rbac.ts` into the AI **platform operator** tier: the emergency kill
switch, the provider configuration every tenant executes through, the global
daily ceilings, and the reset of MARQ's lifetime funded spend. Every one of
those switches is platform-wide, and `owner` is a role any existing owner can
assign through `PATCH /team/members/:id` and any reviewed roster can stamp.

Two vocabularies had been conflated, and the second one already had a mechanism.

| Question | Answered by | Written by |
|---|---|---|
| What may they do in their organization / team? | `app_metadata.team_role`, and the mapped membership row | the console's team routes, the roster artifact |
| May they administer the AI **platform**? | `app_metadata.platform_role = 'admin'` | the service role, by a person, with ops approval |

`resolvePlatformAuthority` / `resolveTrustedGlobalRoles` in
`teamAuthorization.ts` emit `platform_admin` for `platform_role = 'admin'` and
for nothing else, and `index.tsx` hands the AI plane both facts separately.
`SUPER_ADMIN_ROLES` now contains only `platform_admin` and `super_admin`, which
no team role can ever be: `normalizeTeamRole` cannot return a string outside
`TEAM_ROLES`, and neither name is in it.

**What a MARQ team owner keeps:** full console team administration, every AI
execution capability, `org_admin` on their membership, and the AI
administration surface at the `organization_admin` tier — full read visibility
across their organizations, with no platform mutation. What they no longer get,
by accident, is the ability to turn AI off for every other tenant.

The platform tier is resolved from **global roles only**. A membership row is a
statement about one tenant, and no statement about one tenant may make somebody
the operator of the platform every tenant shares — so a hand-written membership
row naming `platform_admin` confers nothing.

## Re-admitting somebody who was removed

The bootstrap will not do it, by design: their soft-deleted membership row is a
decision. Re-admission is an explicit administrative act — invite them again
through the console, which creates a fresh membership beside the tombstone
rather than reviving it, so the history of the first removal survives.

## Rollback

`supabase/migrations/rollbacks/20260818120000_rollback_membership_bootstrap.sql`

The rollback reads `cortex.membership_bootstrap_log` and nothing else. It
soft-deletes a membership only when the ledger names it **and** the row still
carries the `role_id`, `status` and `updated_at` the bootstrap wrote. Anything
modified since is reported and skipped; the rollback never assigns `role_id` or
`status`, so a modified membership cannot be reset to what the bootstrap once
put there.

**Correction:** the previous rollback identified its own rows as
`status = 'active' AND updated_at = created_at`. That is not provenance.
`updated_at = created_at` is true of *every* membership nobody has edited yet,
whoever created it and whenever — so the rollback would have revoked a
membership an administrator created through the console minutes earlier. The
harness demonstrates this on real rows
(`tests/database/harness/25_assert_heuristic_was_unsafe.sql`).

Consequences, all intended:

- A membership that existed **before** the bootstrap survives — not in the ledger.
- A membership created **after** the bootstrap survives — not in the ledger.
- `platform_admin` survives; the bootstrap never granted one, and an explicit
  guard makes it unable to revoke one regardless.
- A rolled-back operator is **not** re-admitted by the next run of the forward
  migration: the soft-deleted row is membership history, and history blocks
  admission.

### Rolling back the lifecycle

`supabase/migrations/rollbacks/20260818130000_rollback_membership_lifecycle.sql`

It drops the functions and touches **no row** of `auth.users` or
`organization_memberships`. That restraint is the design: the memberships the
lifecycle created were created by an administrator inviting or re-roling
somebody, and a DDL rollback that revoked a colleague's access would be doing
something nobody asked for. Both provenance ledgers are kept — a rollback that
erased its own audit trail would leave nobody able to say who was granted what.

**The full reversal, in this order and no other.** Each step needs the one
before it, because step 3 removes the function step 1 depends on:

1. **Reverse each stamping artifact**, while the lifecycle is still applied:

   ```sql
   SELECT artifact, COUNT(*) FROM cortex.team_roster_stamp_log
   WHERE reverted_at IS NULL GROUP BY artifact;
   ```
   ```bash
   node scripts/roster/stamp-team-roster.mjs --artifact=<id> --unstamp --apply
   ```

   Unstamped accounts stop being team accounts at once.

2. **Roll back the bootstrap**, which soft-deletes the memberships *it* created
   and leaves every other one alone. Memberships created by the console are not
   in that ledger and survive on purpose; revoke one with
   `SELECT public.marq_revoke_team_membership('<user id>');`.

3. **Run the lifecycle rollback.**

The rollback file **refuses to run** while any stamping artifact is still live,
naming the count — dropping `cortex.unstamp_team_roster` with unreversed stamps
on the table would strand them with no supported reversal.

### When step 1 will not complete: a drifted stamp (L1)

`cortex.unstamp_team_roster` compares each account's live `raw_app_meta_data`
against what the artifact wrote and **skips anything that differs**. That is
correct — resetting a bag somebody else edited destroys their edit — but it left
no way forward at all, and an ordinary console role change is enough to trigger
it: `PATCH /team/members/:id` rewrites `team_role`. The artifact then could
never be fully reversed, and the only remaining cure was hand-written SQL
against `auth.users` that no runbook described.

`cortex.release_team_stamp` is the documented way forward
(`20260819120000_marq_authority_recovery.sql`).

```sql
-- 1. What drifted, and how.
SELECT * FROM cortex.team_stamp_drift('<artifact>');

-- 2. Plan the release for ONE account. Dry run is the default.
SELECT cortex.release_team_stamp('<artifact>', '<user id>', 'why, in a sentence');

-- 3. Apply it.
SELECT cortex.release_team_stamp('<artifact>', '<user id>', 'why, in a sentence', false);

-- 4. Then the clean reversal for everything that did not drift.
SELECT cortex.unstamp_team_roster('<artifact>', false);
```

What it does, and the limits that make it safe to document:

- **Removes** `marq_team` and `team_role` from what the account *currently*
  carries. It does not restore the recorded previous bag over a later edit —
  that is what would destroy `platform_role` and anything else added since.
- **Only ever reduces authority.** There is no argument list that makes it grant
  something. The account stops being a provisioned team account and every
  console route refuses it.
- **One account at a time**, named by id. A bulk release is the hand-written
  `UPDATE` this whole mechanism replaced.
- **A reason is required** (eight characters or more) and is recorded
  permanently in `cortex.team_roster_stamp_log.released_reason`, alongside the
  metadata as it actually was in `released_app_metadata`.
- **Refuses an account that has not drifted**, naming `unstamp_team_roster`
  instead — the clean reversal restores the previous bag and is strictly better.
- **Does not touch memberships.** Revocation is
  `public.marq_revoke_team_membership`, in the order above.

Rolling back `20260819120000` itself
(`rollbacks/20260819120000_rollback_authority_recovery.sql`) drops the three
functions and **keeps** `released_reason` / `released_app_metadata`: those record
why an operator force-removed somebody's team status, and dropping them to undo
a DDL change would destroy the audit trail the migration exists to create.

### Orphaned team accounts (L2)

`POST /team/invite` creates the auth account, then the membership. The route
compensates when the membership write *fails* — it deletes the account it just
created — but it cannot compensate for not running at all, and an edge isolate
that dies between the two calls leaves a stamped account with no membership.
Two systems cannot be written in one transaction, so the answer is deterministic
detection plus a bounded, documented recovery.

```sql
SELECT * FROM cortex.orphaned_team_accounts();
```

Stamped, live auth accounts with no `active`, undeleted membership in the live
MARQ organization, oldest first, with `age_minutes` and a `banned` flag. An
account minutes old may simply be an invite in flight; one that is hours old is
not.

Recovery is a **decision**, which is why it is not automatic:

| Intent | Action |
|---|---|
| They were meant to join | `SELECT public.marq_sync_team_membership('<user id>', '<team role>');` — adopts the account at the role its `app_metadata` already carries |
| They were not | Delete the account through the Supabase Admin API, or release the stamp as above |

An automatic adopt would grant a membership nobody approved; an automatic delete
would remove an account somebody may be part-way through creating.

### Banned accounts (L3)

Confirmed fail-closed where the semantics already live, and not extended:

- **GoTrue refuses a banned account's token**, so `supabaseAdmin.auth.getUser`
  returns no user, the AI authenticator returns no subject, and every console
  route refuses. The ban is enforced before any of this code runs.
- **The bootstrap's eligibility predicate excludes `banned_until > now()`**, so a
  banned account is not admitted; an account whose ban has *expired* is, which
  is what makes it a ban check rather than a "was ever banned" check.
- **`cortex.orphaned_team_accounts()` reports the ban rather than acting on it.**

No suspension or ban product feature was added. `organization_memberships.status
= 'suspended'` continues to mean exactly what it meant.

## Runtime membership resolution

Organization authority comes from `organization_memberships` through
`listVerifiedMemberships` in
`supabase/functions/server/ai/adapters/membershipDirectory.ts`, which the edge
entry point calls and which holds all the admission rules:

- `deleted_at IS NULL` on the membership
- `status = 'active'`
- **the organization is itself undeleted** — a membership in a soft-deleted
  organization resolves nothing. It is dropped, not downgraded.
- `roles.key` is carried through to `SubjectMembership.roles`
- the result is ordered by organization id, so resolution does not depend on the
  planner's row order

`repositories/tenancyRepository.ts` also reads the table. It is unwired
scaffolding for the repository cutover, is excluded by name in
`membershipResolution.test.ts` rather than silently, and carries the same
organization-liveness restriction so wiring it up cannot reintroduce the defect.

### More than one membership

`resolveOrganization` used to take `memberships[0]` — the first row a query with
no `ORDER BY` happened to return. With two memberships that is a tenant chosen by
the query planner, and every budget, audit record and isolation key follows it.

A subject holding more than one verified membership must now **name** the
organization; without a hint the request fails `ORGANIZATION_REQUIRED` with a
diagnostic listing what they hold. This is not a default tenant — nothing is
chosen on their behalf — and a subject with exactly one membership is
unaffected, which is every operator in the current deployment.

## Testing

```bash
npm run test:database             # static: what the migrations must never contain
npm run test:security             # resolution, role mapping, row -> membership
npm run test:lifecycle            # HIGH-1, HIGH-2, MED-1 through the real actor path
npm run test:database:scenarios   # empirical, needs a real PostgreSQL 15+

# Live invariants against a linked project (creates nothing, rolls itself back)
psql "$DATABASE_URL" -f tests/database/membership_bootstrap.test.sql
```

`test:database:scenarios` builds its own scratch databases, applies the real
migration files, and covers:

- eligible/ineligible admission, the role mapping, a soft-deleted member staying
  out, idempotency across three runs, the five rollback properties above, and
  four concurrent bootstraps
- **the lifecycle** (`70_assert_lifecycle.sql`): a demotion moving `role_id`, the
  full mapping, idempotency, an invite creating exactly one active membership,
  a suspension surviving a role change, revocation twice, and the refusals
- **the roster artifact** (`75_assert_roster_stamping.sql`): every refusal in the
  table above, dry-run writing nothing, apply, rerun, provenance, atomicity on a
  partially valid roster, and a reversal that skips an account changed since
- **MED-2**, twice: a missing role in the catalog, and a write that silently
  drops a candidate. In both the bootstrap must **fail** and leave nothing —
  no memberships, and no provenance ledger

It exits `2` — not `0` — when no database is reachable, so "not run" is never
reported as "passed".

## Legacy compatibility

**None remains, and that is the point.** The console reads a team role from
`app_metadata` alone (`resolveTeamAuthority`). An account with a role only in
`user_metadata` is not a team account: it cannot administer the team, cannot
obtain an organization membership, and holds no team-role capability.

The compatibility path is the reviewed roster artifact, not a fallback branch.
The removal conditions this document used to list — "every active team account
carries `app_metadata.team_role`", a repository cutover, a 30-day soak — were
conditions for removing a branch that could grant team administration to any
authenticated account. Waiting for them meant keeping that branch, and the
finding was that the branch itself was the defect.
