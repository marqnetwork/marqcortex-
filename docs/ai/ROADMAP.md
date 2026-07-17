# Roadmap

Long-term roadmap only. No implementation logs — completed work is recorded in `CHANGELOG_AI.md`.

Legend: ✅ Complete · 🔄 In Progress · ⏳ Planned · ⛔ Blocked · ❌ Cancelled

---

## Phase 1 — AI Foundation

| Sprint | Name | Status |
|--------|------|--------|
| S1 | Intelligence Gateway | ✅ |
| S2 | Frontend Gateway Normalization | ✅ |

## Phase 2 — Data Platform

| Sprint | Name | Status |
|--------|------|--------|
| S3 | Database Architecture | ✅ |
| S4 | Tenancy Foundation | ✅ |
| S5 | Diagnostic Foundation | ✅ |

## Phase 3 — KV Migration

| Sprint | Name | Status |
|--------|------|--------|
| S6.1 | Migration Planning | ✅ |
| S6.2 | Migration Infrastructure | ✅ |
| S6.3 | Migration Validation | ✅ |

## Phase 4 — Runtime Storage Gateway

| Sprint | Name | Status |
|--------|------|--------|
| S7.1 | Runtime Gateway Planning | ✅ |
| S7.2 | Runtime Gateway Implementation | ✅ |
| S7.3 | Gateway Validation | ✅ |
| S7.4 | Outcome Shadow Read | 🔄 |
| S7.5 | Outcome Validation | ⏳ |
| S7.6 | Lead Shadow Read | ⏳ |
| S7.7 | Submission Shadow Read | ⏳ |
| S7.8 | Full Runtime Validation | ⏳ |

## Phase 5 — SQL Cutover

| Sprint | Name | Status |
|--------|------|--------|
| S8.1 | SQL Read Rollout | ⏳ |
| S8.2 | SQL Authority Validation | ⏳ |
| S8.3 | KV Retirement | ⏳ |

---

## Current Runtime Authority

Storage Authority: KV · SQL Authority: No · Shadow Reads: Disabled (except active implementation) · Frontend: Stable · API Contracts: Stable

---

## Rules

- Update only sprint/phase status after each completed sprint.
- Do not renumber completed sprints.
- Do not add implementation detail here — use `CHANGELOG_AI.md`.
