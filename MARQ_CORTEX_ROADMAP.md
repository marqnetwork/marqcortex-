# MARQ Cortex Roadmap

Status Legend

✅ Complete
🔄 In Progress
⏳ Planned
⛔ Blocked
❌ Cancelled

---

# Phase 1 — AI Foundation

| Sprint | Name | Status |
|---------|------|--------|
| S1 | Intelligence Gateway | ✅ |
| S2 | Frontend Gateway Normalization | ✅ |

---

# Phase 2 — Data Platform

| Sprint | Name | Status |
|---------|------|--------|
| S3 | Database Architecture | ✅ |
| S4 | Tenancy Foundation | ✅ |
| S5 | Diagnostic Foundation | ✅ |

---

# Phase 3 — KV Migration

| Sprint | Name | Status |
|---------|------|--------|
| S6.1 | Migration Planning | ✅ |
| S6.2 | Migration Infrastructure | ✅ |
| S6.3 | Migration Validation | ✅ |

---

# Phase 4 — Runtime Storage Gateway

| Sprint | Name | Status |
|---------|------|--------|
| S7.1 | Runtime Gateway Planning | ✅ |
| S7.2 | Runtime Gateway Implementation | ✅ |
| S7.3 | Gateway Validation | ✅ |
| S7.4 | Outcome Shadow Read | 🔄 |
| S7.5 | Outcome Validation | ⏳ |
| S7.6 | Lead Shadow Read | ⏳ |
| S7.7 | Submission Shadow Read | ⏳ |
| S7.8 | Full Runtime Validation | ⏳ |

---

# Phase 5 — SQL Cutover

| Sprint | Name | Status |
|---------|------|--------|
| S8.1 | SQL Read Rollout | ⏳ |
| S8.2 | SQL Authority Validation | ⏳ |
| S8.3 | KV Retirement | ⏳ |

---

# Phase 6 — AI Platform

| Sprint | Name | Status |
|---------|------|--------|
| AI-01 Batch 1 | Secure AI Foundation — AI Control Plane | ✅ |
| AI-01 Batch 2 | AI Orchestration & Agents | ⏳ |

AI-01 Batch 1 completed 2026-07-31. Report:
`architecture/ai/AI-01-BATCH-1-COMPLETION.md`

Delivered: the MARQ Cortex AI Control Plane — the single governed AI execution
path. AI Guard (authentication, authorization, organization and actor
resolution, tenant isolation, request validation, rate limiting), request
context and versioning, policy engine, feature catalog, provider registry with
capability matching, health monitoring, circuit breaker, retry and timeout
management, prompt registry with versioning and hashing, input/output guards,
PII redaction, capability enforcement, budget engine, durable audit, structured
logging, metrics, health monitoring and an event bus. Providers: OpenAI,
Anthropic and a deterministic mock. The Intelligence Gateway, the five legacy
direct-OpenAI paths and the per-feature gateway bypass flags were removed.

---

# Current Sprint

MCV2-S7.4 — Outcome Shadow Read

Status: 🔄 In Progress

---

# Next Sprint

MCV2-S7.5 — Outcome Shadow Read Validation

---

# Current Runtime Authority

Storage Authority: KV

Shadow Reads: Disabled (except current implementation work)

SQL Authority: No

Frontend: Stable

API Contracts: Stable

AI Execution Authority: AI Control Plane (`supabase/functions/server/ai/`) —
sole path, no bypass flag

---

# Rules

- Update only the sprint status after each completed sprint.
- Do not rewrite this file.
- Do not renumber completed sprints.
- Treat this file as the single source of truth for project progress.