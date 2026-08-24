# Internal staff roster — operator input

This directory holds the **shape** of a roster, never a roster.

`team-roster.example.json` is a template with placeholder UUIDs. A real roster
names real people by their `auth.users` id, and this repository has no approved
convention for committing production user identifiers — so the file you actually
run is written by the operator, kept outside version control, and matched by
`.gitignore` (`supabase/operations/roster/*.local.json`).

## What a roster is for

Stamping `app_metadata.marq_team` and `app_metadata.team_role` onto the accounts
that belong to MARQ staff. That stamp is the **only** thing that makes an account
a team account: the console's authorization, the AI capability grant and the
membership bootstrap all read it and nothing else. Deciding who is on it is a
security decision, which is why it is a reviewed artifact rather than a
paragraph of SQL somebody edits in a runbook.

## Running it

```bash
# 1. Copy the template and fill in the reviewed list.
cp supabase/operations/roster/team-roster.example.json \
   supabase/operations/roster/2026-08-19.local.json

# 2. Read the plan. This is the default; it writes nothing.
DATABASE_URL="postgres://…" node scripts/roster/stamp-team-roster.mjs \
  --roster=supabase/operations/roster/2026-08-19.local.json

# 3. Apply it, stating the count you reviewed.
DATABASE_URL="postgres://…" node scripts/roster/stamp-team-roster.mjs \
  --roster=supabase/operations/roster/2026-08-19.local.json --expect=3 --apply
```

The connection must be a **privileged database role** — the one the Supabase SQL
editor and a direct `postgres://` connection use. It is NOT the `service_role`
API key: `service_role` is a PostgREST role with no privilege on the `auth`
schema, and cannot update `auth.users` at all.

## What a roster can NEVER grant

A roster names team roles: `viewer`, `reviewer`, `analyst`, `consultant`,
`admin`, `owner`. The stamping function validates every entry against
`cortex.team_roles()` before it writes anything, so a roster naming
`platform_admin`, `super_admin` or `platform_role` is **refused in full** — not
partially applied, not silently downgraded.

It also **merges** into the existing `app_metadata` rather than replacing it,
writing exactly two keys (`marq_team`, `team_role`). So a roster can neither
create a platform administrator nor destroy one that already exists.

**`owner` is the top of the MARQ team, and nothing more.** It grants console
team administration, every AI execution capability, and full read visibility of
your organizations on the AI administration surface. It does **not** grant AI
platform administration — the provider configuration, the kill switch, the
global budget reset — which requires `app_metadata.platform_role = 'admin'`,
granted separately through the Supabase Admin API with ops approval and never by
this artifact. See "Platform administrators" in
`architecture/database/MEMBERSHIP_BOOTSTRAP.md`.

## Reversing it

```bash
DATABASE_URL="postgres://…" node scripts/roster/stamp-team-roster.mjs \
  --artifact=marq-internal-roster-2026-08-19 --unstamp            # plan
DATABASE_URL="postgres://…" node scripts/roster/stamp-team-roster.mjs \
  --artifact=marq-internal-roster-2026-08-19 --unstamp --apply    # do it
```

Unstamping removes the two keys this artifact wrote and restores whatever the
accounts carried before, skipping any account somebody has changed since. It
does **not** revoke organization memberships — see the rollback order in
`architecture/database/MEMBERSHIP_BOOTSTRAP.md`.

### When an account has been changed since it was stamped

The skip above is deliberate — resetting a bag somebody else edited destroys
their edit — but an ordinary console role change is enough to trigger it, and
until `cortex.release_team_stamp` existed there was no supported way forward.
There is now:

```sql
SELECT * FROM cortex.team_stamp_drift('<artifact>');                              -- what drifted
SELECT cortex.release_team_stamp('<artifact>', '<user id>', 'why, in a sentence'); -- plan
SELECT cortex.release_team_stamp('<artifact>', '<user id>', 'why, in a sentence', false);
```

It removes `marq_team` and `team_role` from what the account currently carries,
keeps every other key (`platform_role` included), takes one account at a time,
requires a reason it records permanently, and can only ever reduce authority.
Full runbook in `architecture/database/MEMBERSHIP_BOOTSTRAP.md`.
