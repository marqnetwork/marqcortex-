# MCV2-S4-IMPLEMENT-001 — Sprint Completion Report

**Sprint:** `MCV2-S4-IMPLEMENT-001` — Tenancy and Identity Foundation  
**Date:** 2026-07-11  
**Status:** Partially Completed

---

## Executive summary

Implemented additive Supabase/PostgreSQL tenancy foundation: six tables, six RLS helper functions, 18 RLS policies, idempotent MARQ seed, server-side repository contracts, rollback SQL, and database test suite. KV persistence and all runtime routes remain unchanged. Local Supabase/psql was unavailable in the agent environment — RLS cross-tenant JWT tests are documented but not live-verified.

---

## Stages completed

| Stage | Status |
|-------|--------|
| 1 — Repository and migration audit | Done |
| 2 — Organizations and role catalog migration | Done |
| 3 — Membership and settings tables | Done |
| 4 — Helper functions | Done |
| 5 — RLS policies | Done |
| 6 — Idempotent seed | Done |
| 7 — Repository/types boundary | Done |
| 8 — Schema and RLS tests | Done (static + SQL files) |
| 9 — Local DB verification | Skipped — no CLI/psql |
| 10 — Build and regression | Done |
| 11 — Tenant-isolation review | Done (SQL review) |
| 12 — Documentation | Done |

---

## Tables created

| Table | RLS |
|-------|-----|
| `organizations` | Yes |
| `roles` | Yes |
| `permissions` | Yes |
| `role_permissions` | Yes |
| `organization_memberships` | Yes |
| `organization_settings` | Yes |

---

## SQL functions created

| Function | Schema | Security |
|----------|--------|----------|
| `set_updated_at()` | cortex | INVOKER |
| `current_user_id()` | cortex | INVOKER |
| `is_platform_admin()` | cortex | DEFINER |
| `is_organization_member(uuid)` | cortex | DEFINER |
| `is_organization_admin(uuid)` | cortex | DEFINER |
| `has_permission(uuid, text)` | cortex | DEFINER |
| `user_organization_ids()` | cortex | DEFINER |

---

## RLS policies created

18 policies across 6 tables (select/insert/update/delete as applicable).

---

## Seed data

- Organization: `MARQ` / slug `marq`
- System roles: `platform_admin`, `org_admin`, `team_member`, `team_viewer`
- Permissions: 6 foundation keys
- Role-permission mappings for all four roles
- Default `organization_settings` for MARQ
- **No user memberships** — see `MEMBERSHIP_BOOTSTRAP.md`

---

## Authentication compatibility

| Source | Status |
|--------|--------|
| Current | `user_metadata.role = 'team'`, `user_metadata.teamRole` |
| Future | `organization_memberships` + `role_permissions` |
| Bridge | `LEGACY_TEAM_ROLE_MAP` in `database.types.ts` |
| Runtime cutover | Not implemented |

---

## Rollback

`supabase/migrations/rollbacks/20260711050000_rollback_tenancy.sql` — drops policies, tables, functions, cortex schema. KV unaffected.

---

## Unverified areas

- Live RLS cross-tenant denial with two JWT users
- Migration apply on staging Supabase project
- Repository integration against live Postgres
- `psql` SQL test execution

---

## Recommended next sprint

**MCV2-S4-IMPLEMENT-002** — Cortex submission migration (Sprint 2 per roadmap)

---

*End of completion report*
