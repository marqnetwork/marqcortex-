# MCV2-S3 — Architecture Decision Register

**Sprint:** `MCV2-S3-DATABASE-ARCHITECTURE` · **Updated:** MCV2-S4-IMPLEMENT-001  
**Status key:** `LOCKED` | `APPROVED` | `IMPLEMENTED` | `PARTIAL` | `REQUIRES APPROVAL`

### MCV2-S4 implementation status

| ADR | Sprint 4 status |
|-----|-----------------|
| ADR-001 | APPROVED — migrations created, not applied to production |
| ADR-002 | APPROVED → IMPLEMENTED (schema + seed; runtime cutover deferred) |
| ADR-003 | APPROVED → IMPLEMENTED (RLS + cortex helpers) |
| ADR-004 | APPROVED → IMPLEMENTED (UUID PKs in migrations) |
| ADR-005 | APPROVED → IMPLEMENTED (`deleted_at` on orgs/memberships) |
| ADR-011 | PARTIAL (repository created; routes not wired) |

---

## ADR-001 — PostgreSQL/Supabase as authoritative store

| Field | Value |
|-------|-------|
| **Status** | RECOMMENDED |
| **Context** | All production data today lives in `kv_store_324f4fbe` JSONB |
| **Decision** | Migrate to normalized PostgreSQL tables on existing Supabase project `tmclwqcgqfcmqwgrogjy` |
| **Consequences** | Enables RLS, indexing, FK integrity, audit |
| **Alternatives rejected** | Continue KV-only; external DB |

---

## ADR-002 — Multi-tenant organization model

| Field | Value |
|-------|-------|
| **Status** | PROPOSED — REQUIRES APPROVAL |
| **Context** | Current system is single-tenant (MARQ) implicit |
| **Decision** | `organization_id` on every tenant-owned row from Sprint 1 |
| **Consequences** | Slight complexity now; avoids painful retrofit |
| **Assumption** | Single default org seeded at migration |

---

## ADR-003 — RLS as primary isolation mechanism

| Field | Value |
|-------|-------|
| **Status** | RECOMMENDED |
| **Context** | KV uses service role — no row isolation |
| **Decision** | RLS on all tenant tables; frontend never queries DB directly |
| **Consequences** | Policy test suite required; helper functions for claims |
| **Locked by** | `ARCHITECT.md` golden rule: dataService gateway |

---

## ADR-004 — UUID primary keys

| Field | Value |
|-------|-------|
| **Status** | RECOMMENDED |
| **Context** | KV uses string IDs (`SUB-*`); `DATABASE_SCHEMA.md` used VARCHAR prefixes |
| **Decision** | UUID v4 PKs; `legacy_id` column preserves KV IDs |
| **Consequences** | New API IDs change unless legacy_id exposed during transition |

---

## ADR-005 — Soft delete strategy

| Field | Value |
|-------|-------|
| **Status** | RECOMMENDED |
| **Context** | KV has hard delete on notes, annotations, cortex analysis |
| **Decision** | `deleted_at` on user-facing entities; hard delete for sessions/telemetry |
| **Consequences** | Partial indexes `WHERE deleted_at IS NULL` |

---

## ADR-006 — Append-only audit model

| Field | Value |
|-------|-------|
| **Status** | RECOMMENDED |
| **Context** | No audit table today; team actions not persisted |
| **Decision** | `audit_events` INSERT-only; no UPDATE/DELETE except legal tooling |
| **Consequences** | Storage growth; retention policy required (ADR-012) |

---

## ADR-007 — Immutable versioning for proposals and reports

| Field | Value |
|-------|-------|
| **Status** | LOCKED by existing architecture |
| **Evidence** | `proposal-data-model.json`, `versionEngine.ts`, `snapshotEngine.ts` |
| **Decision** | `proposal_versions`, `report_versions`, `portfolio_versions` — no in-place overwrite of sent artifacts |
| **Consequences** | Storage duplication; clear audit trail |

---

## ADR-008 — Phased KV migration (not big-bang)

| Field | Value |
|-------|-------|
| **Status** | RECOMMENDED |
| **Context** | Sprint mandate: system must remain operational |
| **Decision** | 7-phase migration (0–6) with dual-read/write and per-domain cutover |
| **Consequences** | Longer migration calendar; lower risk |
| **Alternatives rejected** | Single cutover weekend |

---

## ADR-009 — Knowledge/vector abstraction boundary

| Field | Value |
|-------|-------|
| **Status** | PROPOSED — REQUIRES APPROVAL |
| **Context** | Sprint forbids vector DB implementation now |
| **Decision** | `embeddings` table behind `EmbeddingStore` interface; default provider pgvector |
| **Consequences** | Can swap to Pinecone/Weaviate without schema rewrite |
| **Alternatives** | pgvector-only hard coupling |

---

## ADR-010 — Provider telemetry privacy

| Field | Value |
|-------|-------|
| **Status** | LOCKED by existing architecture |
| **Evidence** | MCV2-S1 audit, Intelligence Gateway contracts |
| **Decision** | Provider identity in `model_attempts` (admin RLS); deliberation uses anonymous `candidate_label` only |
| **Consequences** | Two-tier visibility; deliberation UI never queries provider table |

---

## ADR-011 — Repository/data-access boundary

| Field | Value |
|-------|-------|
| **Status** | RECOMMENDED |
| **Context** | `index.tsx` has 68 routes with inline `kv.*` calls |
| **Decision** | Edge handlers → Repository → Supabase client; no inline table access |
| **Consequences** | Refactor scope in Sprint 2–3; cleaner testing |
| **Locked by** | `ARCHITECT.md` dataService gateway (frontend side) |

---

## ADR-012 — Data retention defaults

| Field | Value |
|-------|-------|
| **Status** | PROPOSED — REQUIRES APPROVAL |
| **Decision** | Audit: 7 years; AI attempts: 90 days; Aggregated usage: 2 years; KV archive: 7 years |
| **Consequences** | Scheduled purge jobs |

---

## ADR-013 — Prompt/content storage policy

| Field | Value |
|-------|-------|
| **Status** | PROPOSED — REQUIRES APPROVAL |
| **Decision** | Default: store token counts + metadata only; `store_content` opt-in per org |
| **Consequences** | Limited debugging capability without opt-in |

---

## ADR-014 — Canonical lead relationship

| Field | Value |
|-------|-------|
| **Status** | RECOMMENDED |
| **Decision** | `diagnostic_leads` (funnel) → `submissions` → `accounts`/`opportunities` (CRM) |
| **Consequences** | Resolves `DATABASE_SCHEMA.md` duplicate `leads` vs CRM leads |

---

## ADR-015 — Supersede DATABASE_SCHEMA.md

| Field | Value |
|-------|-------|
| **Status** | RECOMMENDED |
| **Context** | 18-table schema never deployed; conflicts with KV reality |
| **Decision** | MCV2-S3 documents are authoritative; `DATABASE_SCHEMA.md` marked historical |
| **Consequences** | Update references in docs |

---

## Human approval required before implementation

| ID | Decision | Priority |
|----|----------|----------|
| ADR-002 | Multi-tenant org model activation | High |
| ADR-009 | pgvector as default embedding store | Medium |
| ADR-012 | Retention periods | Medium |
| ADR-013 | Prompt storage policy | High |
| ADR-008 | Migration phase timing in production | High |

---

*End of Architecture Decision Register*
