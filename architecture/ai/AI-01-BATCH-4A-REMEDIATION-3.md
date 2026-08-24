# AI-01 Batch 4A — Remediation, round 3

**Baseline reviewed:** `824d888f` (`fix(tenancy): authority is the lower of what
two systems say, not the higher`)
**Status:** remediated — awaiting final independent verification

Independent verification of `824d888f` found two HIGH blockers. Both are the
same mistake in two places: **the platform was reading more authority out of an
`organization_memberships` row than the row can honestly carry.**

---

## HIGH-1 — a failed promotion could widen authority

> **Invariant.** FAILED PROMOTION MUST NEVER CREATE A NEW CAPABILITY.
>
> ```
> effectiveCapabilities ⊆ trustedTeamCapabilities
> effectiveCapabilities ⊆ safeMembershipCapabilities
> ```

### What was wrong

The organization role key is **ambiguous**. `reviewer`, `analyst` and
`consultant` all map to `team_member`, so the key alone cannot say which of the
three a row stands for. `MEMBERSHIP_AUTHORITY_CEILING` read it at its **ceiling**
— `consultant`.

`applyTeamRoleChange` writes the trusted `app_metadata` **first**, in every
direction; it has to, because that half is uncached and lands in every isolate at
once. So a promotion whose membership write failed — and whose compensating
revert also failed — left:

| | before | after the FAILED promotion |
|---|---|---|
| `app_metadata.team_role` | `reviewer` | `consultant` |
| membership row | `team_member` | `team_member` (never moved) |
| ceiling reading of the row | `consultant` | `consultant` |
| **effective authority** | **`reviewer`** | **`consultant`** |

Measured on the reviewed baseline:

```
HIGH-1 before: ai.chat.converse, ai.narrative.generate
HIGH-1 after : ai.agent.execute, ai.analysis.run, ai.block.assist,
               ai.chat.converse, ai.copilot.plan, ai.narrative.generate,
               ai.section.copilot
ADDED BY A FAILED PROMOTION: ai.agent.execute, ai.analysis.run,
               ai.block.assist, ai.copilot.plan, ai.section.copilot
```

Five capabilities handed out by an operation that **failed**.

### The fix

An ambiguous key is now worth its **weakest** valid meaning
(`MEMBERSHIP_AUTHORITY_FLOOR`: `team_member` → `reviewer`), and the ceiling
survives only as a bound on **trusted provenance**.

The provenance is new and it is the load-bearing part:
`public.organization_memberships.team_role`, written by
`public.marq_sync_team_membership` and by nothing else (migration
`20260820120000`). It records which team role the row was actually written for,
so it **moves only when a membership write succeeds** — which is precisely why
reading it is safe where reading the key's ceiling was not.

```
membership.teamRole present  →  min(provenance, ceilingOf(key))
membership.teamRole absent   →  floorOf(key)      // the weakest meaning
```

Both directions fail low: provenance above the key's band is clamped down,
provenance below it is taken at its lower word.

**A completed promotion still grants.** Only a promotion whose membership write
did not land is refused, because only then is the provenance still the old role.

### Backfill

Existing rows are backfilled from records of authority decisions that were
**reviewed and executed** — `cortex.membership_lifecycle_log` first, then a
non-reverted `cortex.team_roster_stamp_log` entry — and **never** from
`raw_app_meta_data`. Backfilling from the metadata bag would enshrine any
half-applied promotion standing at migration time as permanent truth: the defect,
written down. Where neither source exists, the row gets the weakest meaning of
its own key. Every value is clamped to the band its key allows, so no backfilled
row can read higher than the key alone already did.

---

## HIGH-2 — organization membership could create platform authority

> **Invariant.** ORGANIZATION MEMBERSHIP CAN NEVER CREATE PLATFORM AUTHORITY.

### What was wrong

`platform_admin` is a **seeded row** in `public.roles`
(`20260711050001_cortex_tenancy_rls_and_seed.sql`). An
`organization_memberships` row can point its `role_id` at it, and
`membershipDirectory` will faithfully report `roles: ['platform_admin']`.

`applyFloor` passed through any role name on neither the team ladder nor the
organization-key table — correctly, for the trusted `app_metadata` names the
platform writes for itself, and **incorrectly for membership rows, which took the
same pass**. The agent and workflow grant tables are keyed by role **name**, so:

```
globalRoles     = []
membership.roles = ['platform_admin']

→ agent.run.create, agent.run.control, agent.run.read,
  agent.registry.read, agent.approval.decide, agent.run.read.platform
→ platformReader: true
```

Cross-tenant read authority, platform approvals and platform controls, for a
subject holding no trusted global role at all.

### The fix

Two independent locks.

1. **The vocabulary cut.** `MEMBERSHIP_ROLE_VOCABULARY` names the only role
   names the platform will interpret from a membership row: the three
   organization keys and the six team-ladder names. Everything else —
   `platform_admin`, `super_admin`, `service`, and any key an operator adds to
   `public.roles` tomorrow — is **dropped**, not passed through. A name the
   platform cannot bound is a name no grant table may be keyed by.

2. **The capability cut.** `agentRbac` and `workflowRbac` remove
   `agent.run.read.platform` / `workflow.run.read.platform` unless
   `hasPlatformAuthority(subject)` — which reads `globalRoles`, and therefore
   `app_metadata.platform_role`, and nothing else. This lock does not depend on
   the vocabulary list staying complete.

`admin/rbac.ts` was already global-only for `super_admin`; it now asks the same
`hasPlatformAuthority` function, so the three surfaces cannot drift into three
answers about the same subject.

**The explicit platform operator is unaffected.** `platform_role = 'admin'`
still resolves `super_admin`, `agent.run.read.platform`,
`workflow.run.read.platform` and cross-tenant read scope.

---

## Also closed

### Roster re-stamping could manufacture drift

`cortex.stamp_team_roster` wrote `app_metadata` and left the membership row
alone. Re-stamping a reviewed roster at a new role therefore **created** exactly
the two-system disagreement HIGH-1 exploits — permanently, with no lifecycle call
to blame and no failure reported.

The applied path now puts every roster entry through
`public.marq_sync_team_membership` at the role the roster named, inside the same
transaction. A roster application is a complete authority decision or it is no
decision at all. The dry run reports what it would do to each membership
(`membership_role`, `membership_changes`) and writes nothing.

`cortex.team_authority_drift()` is a read-only report naming every live MARQ
membership whose two halves disagree, with the effective role the server
resolves — the lower of the two.

### One canonical effective-authority model

There were three entry points into overlapping logic — `authorityFloor` for
capabilities, `flooredRoleNames` for admin tiers, `flooredRolesFor` for the
runtimes — and **only the first applied a capability clamp**. The other two
handed role names to tables keyed by name. That asymmetry is how HIGH-2 reached
the agent runtime.

`resolveEffectiveAuthority(subject, membership?)` is now the one model, and the
four surfaces are four readings of it:

| field | read by |
|---|---|
| `roles` | agent RBAC, workflow RBAC, admin RBAC, and `resolveActor` |
| `capabilities` | `resolveActor` — the intersection the invariant names |
| `platform` | all three RBAC modules, via `hasPlatformAuthority` |
| `rank` / `teamRole` | reporting and diagnostics |

`authorityCeiling` computes the literal **intersection** of the trusted side and
the safe membership side rather than the capabilities of the lower rank. Those
coincide today because `ROLE_CAPABILITIES` is monotonic along the ladder — but
"happens to coincide" is what a future grant-table edit breaks in silence, and
the invariant is what must survive the edit.

### `AIActor.roles` is now an authorization input, and says so

It reaches an approval gate as `deciderRoles` and keys the runtime grant tables,
so it is the canonical floored list. `AIActor.sourceRoles` carries what the
identity provider reported, for the audit record, read by no decision anywhere.
Both are needed: "the row still said `org_admin`" and "the account held a
viewer's capabilities" are the same incident described from its two ends.

### A privileged capability requires a verified membership

`AI_ALLOW_DEFAULT_ORGANIZATION` stays `false`. This no longer depends on it.

With the fallback enabled, `resolveOrganization` admits a team user holding **no
membership row at all** into the configured default organization — and their
trusted team role would have carried the full privileged set there, with no
membership to floor against. A team user resolved into an organization they hold
no verified membership in now keeps the baseline and nothing above it. The switch
changes which tenant an unaffiliated account lands in; it may not change what
they can spend it on.

---

## Evidence

| Proof | Where |
|---|---|
| Complete promotion matrix, actual capabilities before vs after | `tests/features/authorityModel.test.ts` |
| Both model invariants over the whole role/key/provenance matrix | same |
| `platform_admin` membership, adversarial, across all four surfaces | same |
| Cross-tenant agent/workflow authorization | same |
| Default-organization security | same |
| Backfill read decisions and not `app_metadata`, real Postgres | `tests/database/harness/89`–`91`, run by `npm run test:database:scenarios` |
| Roster stamp moves both halves; re-stamp accumulates no drift | `tests/database/harness/90_assert_authority_provenance.sql` |
| Migration and rollback source rules | `tests/database/static_authority_provenance_migration.test.ts` |

The promotion matrix runs **every ordered pair** of the six team roles against
three failure modes — membership write failed with the compensation succeeding,
membership write failed with the compensation **also** failing, and the row
moving while the trusted half did not — and compares the **actual** capability
sets, across the AI plane, the administration tier, the agent runtime and the
workflow runtime. Nothing is asserted about labels.
