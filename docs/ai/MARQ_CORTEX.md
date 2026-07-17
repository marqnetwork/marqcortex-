# MARQ Cortex

Version: 2.0
Status: Canonical
Purpose: The single master control document for MARQ Cortex. Every AI session (Claude, GPT, Gemini, Cursor, Codex) reads this first.

This document is the ONLY authority for workflow, engineering standards, QA, and execution rules. Supporting documents add detail but never redefine these.

---

# Restart Protocol

Any AI can resume work by reading only three files, in order:

1. `docs/ai/MARQ_CORTEX.md` (this file) — rules and standards
2. `docs/ai/ACTIVE_WORK.md` — the current task
3. `docs/ai/CHANGELOG_AI.md` — what is already done

Never rediscover completed work. Never restart completed work.

---

# Document Map

| Document | Purpose |
|----------|---------|
| `MARQ_CORTEX.md` | Master control (this file) |
| `ACTIVE_WORK.md` | Current task only |
| `CHANGELOG_AI.md` | Concise history of completed work |
| `ROADMAP.md` | Long-term roadmap only |
| `DECISIONS.md` | Permanent architectural decisions |
| `STABILIZATION.md` | Active stabilization phases only |
| `EXECUTION_RULES.md` | Detailed sprint execution procedure |
| `TEST_PROTOCOL.md` | Detailed QA and validation checklist |
| `DOCUMENTATION_RULES.md` | Documentation standards |
| `archive/legacy/` | Preserved historical documents |

Supporting documents are subordinate to this file. On any conflict, this file wins.

---

# Mission

Build production-ready software.

Every change must be:

- Minimal
- Safe
- Verified
- Reversible
- Production first

Never optimize for speed over correctness.

---

# Workflow

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

# Root Cause Policy

Never guess.

Trace the failure through the stack:

UI → Network → API → Database → Read Path → Render

The first broken layer is the root cause. Fix only that layer.

---

# Engineering Rules

- Small commits.
- One logical fix per commit.
- No unnecessary refactoring.
- No dead code.
- No duplicated logic.
- No production mock data.
- No hidden fallbacks.
- No fake success states.
- Prefer existing architecture.
- Only implement the current scope. Never expand scope without approval.

---

# Governing Principles

Project-specific architecture law. These are binding.

- **Evolve, do not rebuild.** Changes are additive unless explicitly approved with a rollback plan.
- **Provider-independent intelligence.** No hardcoded provider names or model IDs. All model access routes through the Intelligence Gateway adapter layer.
- **Frontend data gateway.** Components import data only from `src/app/services/dataService.ts`. HTTP details stay in `api.ts`.
- **Deterministic logic is authoritative.** Engines in `src/app/core/` own scoring, ROI, proposals, and execution math. Math decides; the LLM only explains.
- **Multi-tenancy and RLS.** All relational business data is organization-scoped. Row Level Security is mandatory on tenant and diagnostic tables.
- **Phased KV → SQL migration.** Never big-bang. Phases: inventory → schema → backfill → dual-read → dual-write → SQL authoritative → KV retirement. KV remains authoritative until per-domain Phase 5 cutover passes reconciliation gates.
- **Validation precedes authority.** No sprint promotes a new source of truth before rollback, telemetry, and reconciliation pass in a production-connected environment.
- **Human review for high-risk changes.** Auth, permissions, secrets, client isolation, RLS design, production data migration, and provider/contract changes require human review before cutover.
- **Secrets discipline.** Never commit `.env`, service-role keys, or credentials. Never store secrets in reports or tracked documentation.
- **Idempotent migration.** Backfill is idempotent via `legacy_kv_key` upsert. No silent record drops — quarantine skipped or invalid records.

Full historical governance: `archive/legacy/MARQ_CORTEX_CONSTITUTION.md`.

---

# Verification Standard

Every completed task must pass, in order:

UI · Network · API · Database · Read · Render · Regression · Production

Detailed checklist: `TEST_PROTOCOL.md`. Only when all pass, mark DONE.

---

# Regression Rules

Every feature keeps existing features working. Always test:

Create · Read · Update · Delete · Refresh · Logout/Login · Permissions · Production Build · Production Deploy

Never modify one feature without checking connected features.

---

# Git Rules

- One logical fix, one commit.
- Commit and push at the end of every completed sprint.
- Include commit SHA and branch in the completion record.
- Do not open a Pull Request unless explicitly requested.
- Merge only after QA.
- Push failures caused by environment policy are deployment limitations, not sprint failures.

---

# Documentation Rules

- Documentation is part of the implementation.
- Keep it short. Never duplicate information.
- Update existing documents instead of creating new files.
- Documentation must match the current implementation.

Detailed standards: `DOCUMENTATION_RULES.md`.

---

# Token Rules

- Keep responses concise.
- Do not repeat previous investigations.
- Do not rewrite completed work.
- Do not explain unchanged code.
- Prefer references over repeated content.
- Reuse existing context. Avoid repository-wide scans unless required.

---

# Recovery Rules

If interrupted, follow the Restart Protocol above and resume immediately. Never repeat completed work.

---

# Completion Rules

A task is complete only when:

✓ Code implemented
✓ Tests pass
✓ Regression passes
✓ Production verified
✓ Documentation updated
✓ `ACTIVE_WORK.md` and `CHANGELOG_AI.md` updated

Then stop.

---

# Authority Order

When sources disagree, resolve in this order:

1. This document (`MARQ_CORTEX.md`)
2. Current sprint acceptance criteria
3. `ARCHITECT.md` golden rules
4. `prompts/MARQ-CLAUDE-AGENT-SYSTEM-PROMPT-v1.0.md`
5. Verified implementation behavior
6. Other documentation
