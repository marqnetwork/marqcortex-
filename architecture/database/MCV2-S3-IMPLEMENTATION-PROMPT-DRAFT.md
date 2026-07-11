# MCV2-S4-IMPLEMENT-001 — Tenancy and Identity Foundation (DRAFT)

> **DRAFT ONLY — DO NOT RUN**  
> Created by sprint `MCV2-S3-DATABASE-ARCHITECTURE` as the first implementation sprint prompt.  
> Human approval required for ADR-002, ADR-003, ADR-012 before execution.

---

## Sprint ID

`MCV2-S4-IMPLEMENT-001-TENANCY-FOUNDATION`

## Sprint name

Cortex Database — Tenancy and Identity Foundation

## Objective

Implement the first production relational schema on Supabase PostgreSQL: organizations, memberships, roles, and RLS helper functions. KV store remains authoritative for all business data. No runtime route behavior changes.

## Prerequisites

- [ ] Human approval of ADR-002 (multi-tenant model)
- [ ] Human approval of ADR-003 (RLS strategy)
- [ ] Read `src/imports/MCV2-S3-CORTEX-DATA-PLATFORM-ARCHITECTURE.md`
- [ ] Read `architecture/database/MCV2-S3-MIGRATION-ROADMAP.md` Sprint 1 section
- [ ] Read `prompts/MARQ-CLAUDE-AGENT-SYSTEM-PROMPT-v1.0.md`

## Allowed scope

- Create `supabase/migrations/001_tenancy_foundation.sql` (executable in staging only until approved)
- Create RLS helper functions (`auth.organization_id()`, `auth.is_org_admin()`)
- Seed default organization `MARQ` with slug `marq`
- Create `supabase/functions/server/repositories/` scaffold (empty interfaces OK)
- Create `tests/rls/` policy tests
- Update `src/types/database.types.ts` (generated or hand-written initial)
- Update `ARCHITECT.md`, `architecture/system_map.json`, `manifest.ts`

## Forbidden scope

- Do not modify `kv_store.tsx`
- Do not change `index.tsx` route behavior
- Do not backfill KV data
- Do not enable `BACKEND_INTEGRATION` changes
- Do not drop or alter `kv_store_324f4fbe`
- Do not implement submission tables (Sprint 2)

## Tables to create

`organizations`, `organization_profiles`, `memberships`, `roles`, `permissions`, `role_permissions`, `invitations`, `service_accounts`, `organization_settings`

## RLS requirements

- All tables except `permissions` and `organizations` (platform read) require RLS
- Service role bypass for edge functions
- Team users: access only their `organization_id`
- No client access to these tables

## Seed data

1. Organization: `{ slug: 'marq', name: 'MARQ Cortex' }`
2. Roles: `admin`, `member`, `viewer`
3. Permissions: `submissions:read`, `submissions:write`, `settings:manage`, `team:manage`
4. Map existing Supabase Auth team users to `memberships` with `role=admin` (script)

## Tests required

- [ ] Migration applies cleanly up and down in staging
- [ ] RLS: user A cannot read org B data
- [ ] RLS: admin can read/write own org settings
- [ ] RLS: anon cannot read memberships
- [ ] `npm run build` passes
- [ ] `npm run test:intelligence` still passes

## Entry conditions

- MCV2-S3 architecture documents approved
- Staging Supabase credentials available

## Exit conditions / completion criteria

- Sprint 1 tables exist in staging with RLS enabled
- Default MARQ org seeded
- Existing team Auth users linked via memberships
- KV store untouched and still authoritative
- Zero changes to frontend `dataService.ts` method signatures
- Documentation updated

## Rollback

- Drop Sprint 1 tables in reverse dependency order
- Remove RLS helper functions
- No KV impact

## Risk level

Low (additive schema only)

## Human review points

- Default org seed values
- Role/permission matrix
- Whether to add `organization_id` to Auth `app_metadata` in this sprint or Sprint 2

## Validation commands

```bash
npm run build
npm run test:intelligence
# Staging only:
# supabase db push
# psql -f tests/rls/tenancy.test.sql
```

## Deliverables

1. Migration SQL file
2. RLS test files
3. Repository scaffold
4. Updated ARCHITECT.md § data platform
5. Completion report per system prompt format

---

*End of draft implementation prompt — DO NOT EXECUTE without approval*
