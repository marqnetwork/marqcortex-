# MCV2-S3 — Migration Roadmap

**Sprint:** `MCV2-S3-DATABASE-ARCHITECTURE`  
**Scope:** Staged KV → PostgreSQL migration + bounded implementation sprints

---

## Part A — KV migration phases (0–6)

### Phase 0 — Inventory and validation

| Item | Detail |
|------|--------|
| **Entry** | Architecture approved; implementation sprint authorized |
| **Work** | Export all `kv_store_324f4fbe` keys by prefix; JSON Schema validate each entity type; document malformed records; create anonymized fixtures in `architecture/database/fixtures/` |
| **Exit** | Inventory report with counts per prefix; fixture pack; malformed data < 1% or documented |
| **Tests** | Schema validation script; prefix count assertions |
| **Rollback** | N/A — read-only |
| **Observability** | Inventory dashboard: keys per prefix, avg payload size |
| **Reconciliation** | Baseline checksums per prefix |
| **Risks** | Unknown key patterns; double-encoded JSON strings |

### Phase 1 — Additive relational schema

| Item | Detail |
|------|--------|
| **Entry** | Phase 0 complete |
| **Work** | Deploy migration SQL (Sprint 1 tables only); **KV remains authoritative**; no route changes |
| **Exit** | Empty relational tables exist; RLS enabled; helper functions deployed |
| **Status** | **Partial** — S4 tenancy (6 tables) + S5 diagnostic (13 tables) migrated in repo; apply via `supabase db push` |
| **Tests** | Migration up/down in staging; RLS policy tests |
| **Rollback** | Drop new tables (no production data yet) |
| **Observability** | Table row counts = 0 |
| **Risks** | Migration conflicts with existing Supabase objects |

### Phase 2 — Backfill

| Item | Detail |
|------|--------|
| **Entry** | Phase 1 complete |
| **Work** | Batch backfill scripts: `sub:*` → `submissions` + children; all prefixes per catalog; idempotent upsert on `legacy_kv_key` |
| **Exit** | Reconciliation report: KV count == SQL count per entity (± documented exceptions) |
| **Status** | **Partial** — S6.2 lead/contact infrastructure + engine delivered; submission backfill deferred S6.3 |
| **Tests** | Checksum compare; spot-check 100 random records |
| **Rollback** | Truncate relational tables; KV untouched |
| **Observability** | `migration_reconciliation_log` table |
| **Reconciliation** | `COUNT(*)`, field-level hash on sample set |
| **Risks** | `sub_email:` pollution in prefix scans; JSON string vs object |

### Phase 3 — Dual-read

| Item | Detail |
|------|--------|
| **Entry** | Phase 2 reconciliation passed |
| **Work** | Introduce `SubmissionRepository` etc.; read SQL first, fallback KV on miss; log mismatches |
| **Status** | **In progress (Phase 1 validated)** — S7.1 designed the gateway; S7.2 (`MCV2-S7.2-IMPLEMENT-007`) implemented the KV-only `DiagnosticStorageGateway` and routed 3 diagnostic reads through it; S7.3 (`MCV2-S7.3-VALIDATE-008`) validated response parity, config/telemetry safety, SQL non-invocation, rollback, and overhead (storage tests 44/44). **No SQL/shadow reads enabled; KV authoritative.** True shadow-read (Mode B) begins S7.4, first entity = **Outcome** (`MCV2-S7.3-SHADOW-READ-READINESS-PLAN.md`). |
| **Exit** | Mismatch rate < 0.1% over 7 days staging |
| **Tests** | Integration tests per repository; mismatch alerts |
| **Rollback** | Feature flag `DATA_SOURCE=kv` |
| **Observability** | `dual_read_mismatches` metric |
| **Risks** | Latency increase on fallback path |

### Phase 4 — Dual-write

| Item | Detail |
|------|--------|
| **Entry** | Phase 3 stable |
| **Work** | Write to SQL + KV; `idempotency_keys` for retries; client sessions migrated |
| **Exit** | Zero divergence over 14 days staging |
| **Tests** | Write/read round-trip; idempotency replay |
| **Rollback** | `DATA_WRITE_MODE=kv_only` flag |
| **Observability** | Divergence counter per entity |
| **Risks** | Partial write failures — use transactions |

### Phase 5 — SQL authoritative

| Item | Detail |
|------|--------|
| **Entry** | Phase 4 stable in production |
| **Work** | Per-domain cutover: submissions → proposals → messaging → cortex → pipeline → settings |
| **Exit** | All reads from SQL; KV writes stopped per domain |
| **Tests** | Full regression; client portal E2E |
| **Rollback** | Per-domain `DATA_SOURCE` flag revert |
| **Observability** | KV write rate → 0 per prefix |
| **Risks** | Missed edge route still writing KV |

### Phase 6 — KV retirement

| Item | Detail |
|------|--------|
| **Entry** | Phase 5 all domains cutover + 30-day soak |
| **Work** | Archive KV to cold storage; remove fallback code; keep `kv_store_324f4fbe` read-only archive |
| **Exit** | No runtime KV reads; archive manifest stored |
| **Tests** | Verify zero `kv.*` calls in production build |
| **Rollback** | Re-enable read fallback from archive (emergency) |
| **Observability** | Archive checksum verified |
| **Risks** | Regulatory need to retain KV — retain 7 years |

---

## Part B — Implementation sprint sequence

### Sprint 1 — Tenancy and identity foundation

| Field | Value |
|-------|-------|
| **Objective** | Organizations, memberships, roles, settings, RLS helpers |
| **Tables** | `organizations`, `organization_profiles`, `memberships`, `roles`, `permissions`, `role_permissions`, `invitations`, `service_accounts`, `organization_settings` |
| **Runtime affected** | None (additive schema only) |
| **Tests** | RLS policy tests; membership helper tests |
| **Migration** | Phase 1 — schema only |
| **Risk** | Low |
| **Human review** | RLS helper design; default org seed |
| **Completion** | Tables + RLS deployed staging; seed MARQ org |

### Sprint 2 — Cortex submission migration

| Field | Value |
|-------|-------|
| **Objective** | Relational submissions, leads, notes, notifications, pipeline |
| **Tables** | `diagnostic_leads`, `submissions`, `diagnostic_answers`, `diagnostic_scores`, `submission_notes`, `notifications`, `pipeline_positions`, `pipeline_column_settings` |
| **Runtime affected** | Edge repositories (behind flag) |
| **Tests** | Backfill reconciliation; submission CRUD |
| **Migration** | Phase 2–3 for submission domain |
| **Risk** | High — core entity |
| **Human review** | Legacy ID mapping; email uniqueness |
| **Completion** | Dual-read submissions live staging |

### Sprint 3 — Proposal and client portal migration

| Field | Value |
|-------|-------|
| **Objective** | Proposals, messages, engagement, client sessions, reports |
| **Tables** | `proposals`, `proposal_versions`, `proposal_annotations`, `client_sessions`, `conversations`, `messages`, `engagement_events`, `reports`, `email_queue_items` |
| **Runtime affected** | Client portal routes, proposal routes |
| **Tests** | Client auth session; proposal respond flow |
| **Migration** | Phase 3–4 for portal domain |
| **Risk** | High — client isolation |
| **Human review** | Client RLS policies |
| **Completion** | Client portal on dual-write staging |

### Sprint 4 — ROI and execution migration

| Field | Value |
|-------|-------|
| **Objective** | ROI models, outcomes, execution blueprints |
| **Tables** | `roi_models`, `roi_assumptions`, `roi_scenarios`, `roi_baselines`, `roi_actuals`, `outcomes`, `execution_blueprints`, `milestones`, `governance_gates` |
| **Runtime affected** | Execution dashboard (read path) |
| **Tests** | ROI engine output persistence |
| **Migration** | Phase 4–5 |
| **Risk** | Medium |
| **Human review** | Immutable baseline rules |
| **Completion** | Outcomes + ROI in SQL |

### Sprint 5 — AI telemetry migration

| Field | Value |
|-------|-------|
| **Objective** | Persist Intelligence Gateway telemetry |
| **Tables** | `ai_providers`, `ai_models`, `intelligence_requests`, `model_attempts`, `usage_records`, `cost_records` |
| **Runtime affected** | `intelligence/telemetry.ts` → repository |
| **Tests** | Gateway contract tests + DB persistence |
| **Migration** | New writes only (no KV source) |
| **Risk** | Medium — volume |
| **Human review** | Prompt storage policy |
| **Completion** | Telemetry survives cold start |

### Sprint 6 — Organizational structure and objectives

| Field | Value |
|-------|-------|
| **Objective** | Departments, workers, objectives, tasks |
| **Tables** | Domain B + C tables |
| **Runtime affected** | None initially (data model only) |
| **Tests** | CRUD + RLS |
| **Migration** | Greenfield |
| **Risk** | Low |
| **Human review** | Worker identity model |
| **Completion** | Schema + admin seed UI optional |

### Sprint 7 — Knowledge and document foundation

| Field | Value |
|-------|-------|
| **Objective** | Knowledge spaces, documents, SOPs |
| **Tables** | Domain J (except embeddings) |
| **Runtime affected** | None |
| **Tests** | Permission inheritance |
| **Migration** | Greenfield |
| **Risk** | Low |
| **Human review** | Permission model |
| **Completion** | Document upload metadata path |

### Sprint 8 — RAG and pgvector

| Field | Value |
|-------|-------|
| **Objective** | Chunks, embeddings, retrieval |
| **Tables** | `document_chunks`, `embeddings`, `retrieval_indexes` |
| **Runtime affected** | Future knowledge API |
| **Tests** | Vector similarity; tenant isolation |
| **Migration** | Greenfield |
| **Risk** | Medium — extension dependency |
| **Human review** | pgvector vs external store |
| **Completion** | Abstraction + pgvector POC |

### Sprint 9 — CRM and revenue data

| Field | Value |
|-------|-------|
| **Objective** | Accounts, opportunities, meetings |
| **Tables** | Domain G |
| **Runtime affected** | Revenue dashboard |
| **Tests** | Submission → opportunity link |
| **Migration** | Derive from submissions |
| **Risk** | Medium |
| **Human review** | Stage definitions (crm-sync-spec) |
| **Completion** | CRM sync from proposal events |

### Sprint 10 — Marketing and outreach data

| Field | Value |
|-------|-------|
| **Objective** | Campaigns, outreach sequences |
| **Tables** | Domain H + I |
| **Runtime affected** | None (design activation later) |
| **Tests** | Consent + suppression |
| **Migration** | Greenfield |
| **Risk** | Medium — compliance |
| **Human review** | Outreach activation gate |
| **Completion** | Schema only; no automation |

### Sprint 11 — Audit hardening

| Field | Value |
|-------|-------|
| **Objective** | Append-only audit, deliberation, job infrastructure |
| **Tables** | `audit_events`, `deliberation_*`, `idempotency_keys`, `scheduled_jobs` |
| **Runtime affected** | All write paths (audit hooks) |
| **Tests** | Immutability; tamper resistance |
| **Migration** | Greenfield + retroactive audit for new writes |
| **Risk** | Medium |
| **Human review** | Retention policy |
| **Completion** | Audit on all high-risk tables |

### Sprint 12 — KV retirement

| Field | Value |
|-------|-------|
| **Objective** | Remove KV fallback; archive |
| **Tables** | None new |
| **Runtime affected** | All edge routes |
| **Tests** | Zero KV reference scan |
| **Migration** | Phase 6 |
| **Risk** | High |
| **Human review** | Archive retention sign-off |
| **Completion** | Production on SQL only |

---

## Part C — Implementation file plan

| Path | Action | Purpose | Dependencies | Risk | Tests | Rollback |
|------|--------|---------|--------------|------|-------|----------|
| `supabase/migrations/` | Create dir | Migration home | — | Low | — | — |
| `supabase/migrations/001_tenancy_foundation.sql` | Create | Sprint 1 schema | — | Medium | RLS tests | Drop tables |
| `supabase/migrations/002_submissions_core.sql` | Create | Sprint 2 schema | 001 | High | CRUD + RLS | Drop tables |
| `supabase/migrations/003_client_portal.sql` | Create | Sprint 3 schema | 002 | High | Client RLS | Drop tables |
| `supabase/migrations/004_roi_execution.sql` | Create | Sprint 4 | 002 | Medium | Engine tests | Drop tables |
| `supabase/migrations/005_ai_telemetry.sql` | Create | Sprint 5 | 001 | Medium | Gateway tests | Drop tables |
| `supabase/migrations/006_org_structure.sql` | Create | Sprint 6 | 001 | Low | CRUD | Drop tables |
| `supabase/migrations/007_knowledge.sql` | Create | Sprint 7 | 001 | Low | Permissions | Drop tables |
| `supabase/migrations/008_pgvector.sql` | Create | Sprint 8 | 007 | Medium | Vector query | Drop extension |
| `supabase/migrations/009_crm.sql` | Create | Sprint 9 | 002 | Medium | Link tests | Drop tables |
| `supabase/migrations/010_marketing_outreach.sql` | Create | Sprint 10 | 001 | Medium | Consent | Drop tables |
| `supabase/migrations/011_audit.sql` | Create | Sprint 11 | All | High | Immutability | Drop tables |
| `supabase/functions/server/repositories/` | Create dir | Data access layer | Migrations | High | Integration | Feature flag |
| `supabase/functions/server/repositories/submissionRepository.ts` | Create | Submission aggregate | 002 | High | Unit + integration | KV fallback |
| `supabase/functions/server/repositories/proposalRepository.ts` | Create | Proposal aggregate | 003 | High | Client tests | KV fallback |
| `supabase/functions/server/repositories/clientSessionRepository.ts` | Create | Sessions | 003 | High | TTL tests | KV fallback |
| `supabase/functions/server/repositories/intelligenceTelemetryRepository.ts` | Create | AI telemetry | 005 | Medium | Gateway tests | Memory buffer |
| `supabase/functions/server/repositories/auditRepository.ts` | Create | Audit writes | 011 | Medium | Append-only | Disable hooks |
| `supabase/functions/server/repositories/index.ts` | Create | Repository exports | All repos | Low | — | — |
| `supabase/functions/server/migration/` | Create dir | Backfill scripts | Phase 2 | High | Reconciliation | Truncate SQL |
| `supabase/functions/server/migration/backfillSubmissions.ts` | Create | KV → SQL | 002 | High | Checksum | Truncate |
| `supabase/functions/server/migration/reconcile.ts` | Create | Count/compare | Backfill | High | Assert counts | — |
| `src/types/database.types.ts` | Create | Generated DB types | Migrations | Low | Typecheck | — |
| `tests/rls/` | Create dir | RLS policy tests | Migrations | High | pgTAP or supabase test | — |
| `tests/rls/submissions.test.sql` | Create | Submission RLS | 002 | High | Policy assert | — |
| `architecture/database/fixtures/` | Create dir | Anonymized KV fixtures | Phase 0 | Low | Schema validate | — |
| `architecture/database/design-artifacts/` | Exists | Design SQL | — | Low | — | — |
| `src/system/manifest.ts` | Modify | Register new nodes | — | Low | validate.ts | Revert |
| `ARCHITECT.md` | Modify | Data architecture section | — | Low | — | Revert |
| `architecture/system_map.json` | Modify | Database section | — | Low | — | Revert |

---

*End of Migration Roadmap*
