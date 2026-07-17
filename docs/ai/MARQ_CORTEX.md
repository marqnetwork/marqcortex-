# MARQ Cortex

Version: 1.0 (locked)
Status: Canonical — highest authority
Purpose: The single master control document for MARQ Cortex. Every AI session (Claude, ChatGPT, Codex, Cursor, Gemini) reads this first.

This document defines operating principles only. It never contains sprint information, implementation history, or temporary notes.

---

# 1. Mission

Build production-ready software.

Every change must be:

- Minimal
- Safe
- Verified
- Reversible
- Production first

Never optimize for speed over correctness.

---

# 2. Engineering Principles

**Architecture law (binding):**

- **Evolve, do not rebuild.** Changes are additive unless explicitly approved with a rollback plan.
- **Provider-independent intelligence.** No hardcoded provider names or model IDs. All model access routes through the Intelligence Gateway adapter layer.
- **Frontend data gateway.** Components import data only from `src/app/services/dataService.ts`. HTTP details stay in `api.ts`.
- **Deterministic logic is authoritative.** Engines in `src/app/core/` own scoring, ROI, proposals, and execution math. Math decides; the LLM only explains.
- **Multi-tenancy and RLS.** All relational business data is organization-scoped. Row Level Security is mandatory on tenant and diagnostic tables.
- **Phased KV → SQL migration.** Never big-bang. Phases: inventory → schema → backfill → dual-read → dual-write → SQL authoritative → KV retirement. KV stays authoritative until per-domain cutover passes reconciliation gates.
- **Validation precedes authority.** No sprint promotes a new source of truth before rollback, telemetry, and reconciliation pass in a production-connected environment.
- **Human review for high-risk changes.** Auth, permissions, secrets, client isolation, RLS design, production data migration, and provider/contract changes require human review before cutover.
- **Secrets discipline.** Never commit `.env`, service-role keys, or credentials. Never store secrets in reports or tracked documentation.
- **Idempotent migration.** Backfill is idempotent via `legacy_kv_key` upsert. No silent record drops — quarantine skipped or invalid records.

**Code discipline:**

- Small commits. One logical fix per commit.
- No unnecessary refactoring, dead code, or duplicated logic.
- No production mock data, hidden fallbacks, or fake success states.
- Prefer existing architecture. Implement only the current scope; never expand without approval.

**Token discipline:**

- Keep responses concise. Prefer references over repeated content.
- Do not repeat previous investigations, rewrite completed work, or explain unchanged code.
- Avoid repository-wide scans unless required.

Approved architectural decisions are recorded in `DECISIONS.md`.

---

# 3. Authority Order

The AI Operating System has a fixed authority hierarchy. No lower document may redefine a higher one.

1. `docs/ai/MARQ_CORTEX.md`
2. `docs/ai/ACTIVE_WORK.md`
3. `docs/ai/DECISIONS.md`
4. `docs/ai/ROADMAP.md`
5. `docs/ai/STABILIZATION.md`
6. `docs/ai/EXECUTION_RULES.md`
7. `docs/ai/TEST_PROTOCOL.md`
8. `docs/ai/DOCUMENTATION_RULES.md`
9. `docs/ai/archive/legacy/*`

For architecture tasks beyond the AI OS, defer to `ARCHITECT.md` golden rules, then `prompts/MARQ-CLAUDE-AGENT-SYSTEM-PROMPT-v1.0.md`, then verified implementation behavior.

---

# 4. Workflow

Always execute in this order.

1. Read this file.
2. Read `ACTIVE_WORK.md`.
3. Continue unfinished work.
4. Fix one root cause only.
5. Verify end-to-end (`TEST_PROTOCOL.md`).
6. Update `ACTIVE_WORK.md` and `CHANGELOG_AI.md`.
7. Commit.
8. Push.
9. Merge after QA.
10. Stop.

Never restart completed work.

---

# 5. Root Cause Methodology

Never guess. Trace the failure through the stack:

UI → Network → API → Database → Read Path → Render

The first broken layer is the root cause. Fix only that layer.

---

# 6. Repository Contract

The AI Operating System lives in `docs/ai/`. Each document has one responsibility.

| Document | Responsibility |
|----------|----------------|
| `MARQ_CORTEX.md` | Master control — operating principles (this file) |
| `ACTIVE_WORK.md` | Current task only |
| `CHANGELOG_AI.md` | Concise history of completed work |
| `ROADMAP.md` | Long-term roadmap only |
| `DECISIONS.md` | Permanent architectural decisions |
| `STABILIZATION.md` | Active stabilization phases only |
| `EXECUTION_RULES.md` | Detailed sprint execution procedure |
| `TEST_PROTOCOL.md` | Detailed QA and validation checklist |
| `DOCUMENTATION_RULES.md` | Documentation standards |
| `archive/legacy/` | Preserved historical documents (do not read unless requested) |

`AI_START_HERE.md` (repo root) is the universal bootstrap pointer into this system.

Structural code contracts (never break without an approved decision): the frontend data gateway, API contracts and response envelopes, authentication/authorization, tenant isolation, and KV runtime authority.

---

# 7. Verification Standard

Every completed task must pass, in order:

UI · Network · API · Database · Read · Render · Regression · Production

Regression keeps existing features working — always test Create · Read · Update · Delete · Refresh · Logout/Login · Permissions · Production Build · Production Deploy. Never change one feature without checking connected features.

Detailed checklist: `TEST_PROTOCOL.md`. Only when all pass, mark DONE.

---

# 8. Recovery Rules

Any AI resumes by reading only three files, in order:

1. `docs/ai/MARQ_CORTEX.md` — rules and standards
2. `docs/ai/ACTIVE_WORK.md` — the current task
3. `docs/ai/CHANGELOG_AI.md` — what is already done

Resume from `ACTIVE_WORK.md` immediately. Never rediscover or re-audit completed work. Do not read `archive/` unless requested.

---

# 9. Completion Contract

A task is complete only when:

✓ Code implemented
✓ Tests pass
✓ Regression passes
✓ Production verified
✓ Documentation updated
✓ `ACTIVE_WORK.md` and `CHANGELOG_AI.md` updated

Git: one logical fix, one commit; commit and push at sprint end; record commit SHA and branch; no Pull Request unless requested; merge only after QA. Push failures caused by environment policy are deployment limitations, not sprint failures.

Then stop.
