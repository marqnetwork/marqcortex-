# MCV2-S5-IMPLEMENT-002 — Sprint Completion Report

**Sprint:** `MCV2-S5-IMPLEMENT-002` — Cortex Diagnostic Domain Foundation  
**Date:** 2026-07-14  
**Status:** **Completed** (static verification) / **Partially Completed** (live SQL/RLS JWT tests)

---

## Executive Summary

Implemented additive PostgreSQL schema for the Cortex Diagnostic domain: 13 tables, RLS policies, 4 helper functions, 3 diagnostic permissions, 5 server-side repositories, static/SQL tests, and KV mapping documentation. KV store remains authoritative; no frontend or route changes.

---

## Tables Created (13)

| Domain | Tables |
|--------|--------|
| Leads | `lead_sources`, `leads`, `lead_tags` |
| Contacts | `contacts`, `contact_methods` |
| Diagnostic | `submissions`, `submission_sections`, `diagnostic_answers`, `diagnostic_scores`, `domain_scores` |
| Reporting | `reports`, `report_versions` |
| Outcomes | `outcomes` |

---

## Relationships

- All tenant tables → `organizations(id)` via `organization_id`
- `leads` → `lead_sources`, `contacts` (optional)
- `submissions` → `leads`, `contacts` (optional)
- Child tables → `submissions(id)` with CASCADE
- `report_versions` → `reports(id)`
- `outcomes` → `submissions(id)` UNIQUE (1:1)

---

## Indexes

- Org-scoped list indexes on `leads`, `submissions`, `contacts`
- Unique: `legacy_kv_key` on `leads`, `submissions`, `outcomes`
- Unique: `(submission_id, section_key)`, `(submission_id, question_key)`, `(submission_id, domain_key)`
- Unique: `(report_id, version_number)`, `(lead_id, tag)`

---

## RLS Policies

- **13 tables** — RLS enabled + forced
- **Helpers:** `marq_organization_id`, `can_read_diagnostic`, `can_write_diagnostic`, `can_manage_diagnostic`
- **Roles:** platform_admin (via existing helpers), org_admin, team_member/viewer via permissions
- **Anonymous:** INSERT on `leads` and `submissions` (MARQ org only)
- **Client portal:** Not wired in SQL RLS (KV sessions); deferred to `client_sessions` sprint

---

## Repository Coverage

| Repository | create | read | update | list | lookup |
|------------|--------|------|--------|------|--------|
| LeadRepository | ✓ | ✓ | ✓ | ✓ | email, legacy_kv_key |
| ContactRepository | ✓ | ✓ | ✓ | ✓ | primary_email |
| SubmissionRepository | ✓ | ✓ | ✓ | ✓ | email, legacy_kv_key + sections/answers/scores |
| ReportRepository | ✓ | ✓ | ✓ | ✓ | by submission + versions |
| OutcomeRepository | ✓ | ✓ | ✓ | ✓ | submission, legacy_kv_key |

**Not wired to Hono routes** (per sprint scope).

---

## Migration Files

| File | Purpose |
|------|---------|
| `20260714050000_cortex_diagnostic_foundation.sql` | Tables, FKs, indexes, triggers |
| `20260714050001_cortex_diagnostic_rls.sql` | RLS, permissions seed, lead_sources seed |
| `rollbacks/20260714050000_rollback_diagnostic.sql` | Drop diagnostic domain |

---

## Tests

| Test | Status |
|------|--------|
| `npm run build` | **PASS** |
| `npm run test:database` | **PASS** (19 tests) |
| `npm run test:intelligence` | **PASS** (8 tests) |
| `diagnostic_schema.test.sql` | **UNVERIFIED** — requires `psql` + applied migrations |
| `diagnostic_rls.test.sql` | **UNVERIFIED** — requires live DB |
| Cross-tenant JWT denial | **UNVERIFIED** |

---

## Files Created

- `supabase/migrations/20260714050000_cortex_diagnostic_foundation.sql`
- `supabase/migrations/20260714050001_cortex_diagnostic_rls.sql`
- `supabase/migrations/rollbacks/20260714050000_rollback_diagnostic.sql`
- `src/types/diagnostic.database.types.ts`
- `supabase/functions/server/repositories/diagnosticTypes.ts`
- `supabase/functions/server/repositories/repositoryClient.ts`
- `supabase/functions/server/repositories/leadRepository.ts`
- `supabase/functions/server/repositories/contactRepository.ts`
- `supabase/functions/server/repositories/submissionRepository.ts`
- `supabase/functions/server/repositories/reportRepository.ts`
- `supabase/functions/server/repositories/outcomeRepository.ts`
- `tests/database/static_diagnostic_migration.test.ts`
- `tests/database/diagnostic_schema.test.sql`
- `tests/database/diagnostic_rls.test.sql`
- `architecture/database/MCV2-S5-KV-RELATIONAL-MAPPING.md`
- `architecture/database/MCV2-S5-IMPLEMENT-002-COMPLETION.md`

## Files Modified

- `supabase/functions/server/repositories/index.ts`
- `src/system/manifest.ts` (MQC-SVC-012–016, MQC-TYPE-009)
- `package.json` (`test:database` script)
- `ARCHITECT.md`
- `architecture/system_map.json`
- `architecture/database/MCV2-S3-TABLE-CATALOG.md`
- `architecture/database/MCV2-S3-MIGRATION-ROADMAP.md`
- `tests/database/README.md`

---

## Runtime Impact

**None.** Edge function routes unchanged. `kv_store.tsx` untouched. Frontend unchanged.

---

## KV Impact

**None.** No migration, dual-read, or dual-write. Mapping documented in `MCV2-S5-KV-RELATIONAL-MAPPING.md`.

---

## Baseline Comparison

| Metric | Before S5 | After S5 |
|--------|-----------|----------|
| Relational tables (repo) | 7 (6 tenancy + KV) | 20 (19 + KV table) |
| Repositories | 1 (tenancy) | 6 |
| Migrations | 3 | 5 |
| Runtime data path | KV only | KV only |

---

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Migrations not yet on remote | Medium | Run `.\scripts\supabase-cli.ps1 db push` when approved |
| Client RLS not SQL-native | Low | Documented; KV auth until `client_sessions` |
| Live RLS cross-tenant untested | Medium | Run `MCV2-S5-VALIDATE-001` with JWT fixtures |
| `providers/contracts.ts` deploy warning | Low | Pre-existing; unrelated to S5 |

---

## Rollback

```bash
psql "$DATABASE_URL" -f supabase/migrations/rollbacks/20260714050000_rollback_diagnostic.sql
```

KV and tenancy tables unaffected.

---

## Human Review Priority

1. Apply migrations to staging: `.\scripts\supabase-cli.ps1 db push`
2. Run SQL tests against live DB
3. Review RLS anonymous INSERT policies for public funnel
4. Confirm `legacy_kv_key` mapping matches KV ID format (`SUB-*` vs UUID)

---

## Recommended Next Sprint

**MCV2-S5-VALIDATE-001** — Live diagnostic schema + RLS validation  
Then **MCV2-S5-IMPLEMENT-003** — KV backfill scripts for `lead:*` and `sub:*` (Phase 2 per roadmap)

---

*End of completion report*
