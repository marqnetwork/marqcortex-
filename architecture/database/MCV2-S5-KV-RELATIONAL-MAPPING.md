# MCV2-S5 — KV → Relational Mapping (Diagnostic Domain)

**Sprint:** `MCV2-S5-IMPLEMENT-002`  
**Status:** Documentation only — KV remains authoritative

---

## Principles

| Rule | Detail |
|------|--------|
| Authority | `kv_store_324f4fbe` is runtime source of truth until per-entity Phase 5 cutover |
| Dual-write | **Forbidden** this sprint |
| Dual-read | **Forbidden** this sprint |
| Reconciliation | Required before any cutover |

---

## Namespace mapping

| KV prefix / key | Destination table(s) | Migration strategy | Reconciliation | Rollback |
|-----------------|-------------------|--------------------|----------------|----------|
| `lead:{id}` | `leads` (+ `contacts`, `contact_methods`) | Idempotent upsert by `legacy_kv_key` | Count `lead:*` vs `leads` where `legacy_kv_key IS NOT NULL` | Bounded rollback by `migration_run_id` (S6.2) |
| `lead_email:{email}` | `leads.email` (unique per org) | Resolve via email index; drop separate index table | Spot-check email lookups | N/A — index not stored separately |
| `sub:{id}` | `submissions` + `diagnostic_answers` + `diagnostic_scores` | Parse JSON blob; split `answers` object into rows | Field-level hash on 100 random subs | Truncate diagnostic tables; KV untouched |
| `sub_email:{email}` | `submissions.contact_email` | Latest submission by email per org | Compare lookup results | N/A |
| `outcome:{submissionId}` | `outcomes` | 1:1 upsert on `submission_id` | Count match | Truncate outcomes |
| Client report JSON (route `/client/.../report`) | `reports` + `report_versions` | Generate version 1 on first backfill | Content checksum | Truncate reports |
| `cortex:{submissionId}` | `diagnostic_scores` + `domain_scores` | Map analysis output to score rows | Score range validation | Truncate scores |

---

## Child entity decomposition

### `sub:{id}` JSON → relational

| KV field | SQL destination |
|----------|-----------------|
| `id` | `submissions.legacy_id` + `legacy_kv_key = sub:{id}` |
| `company` | `submissions.company_name` |
| `contact` | `submissions.contact_name` |
| `email` | `submissions.contact_email` |
| `answers` (object) | `diagnostic_answers` rows per key |
| `completionScore` | `diagnostic_scores.completion_score` |
| `qualityScore` | `diagnostic_scores.quality_score` |
| `aiScore` | `diagnostic_scores.ai_score` |
| `status`, `priority` | `submissions.status`, `submissions.priority` |
| remainder | `submissions.metadata` JSONB |

---

## Tables with no KV equivalent yet

| Table | Purpose |
|-------|---------|
| `lead_sources` | Attribution lookup — seeded, not backfilled from KV |
| `lead_tags` | New capability — optional enrichment during backfill |
| `contacts` / `contact_methods` | Normalized contact graph — derived during backfill |
| `submission_sections` | Structured sections — derived from question registry |

---

## Rollback

Apply bounded rollback by migration run: `architecture/database/MCV2-S6.2-ROLLBACK-GUIDE.md`

Full diagnostic rollback (emergency): `supabase/migrations/rollbacks/20260714050000_rollback_diagnostic.sql`

KV data is unaffected. Runtime routes continue using `kv_store.tsx`.

---

*End of KV mapping document*
