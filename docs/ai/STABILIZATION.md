# Stabilization

Active stabilization phases only. When a phase completes, move it to `CHANGELOG_AI.md` and remove it here.

Legend: 🔄 In Progress · ⏳ Planned · ⛔ Blocked

---

## Active Phases

Full backlog, evidence, priority, and risk: `STABILIZATION_INVENTORY.md`. Only the active batch is listed here.

| Batch | Scope | Status |
|-------|-------|--------|
| Batch 1 — Cutover Safety Pre-reqs | Remove hardcoded demo creds (F-004), deploy edge fn + secrets (A1), unit tests for the 5 core math engines (F-010, RC-005). Must land before any `BACKEND_INTEGRATION` flip. | ⏳ |

Planned next: Batch 2 (finish S7.4→S7.8 shadow-read track), Batch 3 (GATED/DEMO backfill), Batch 4 (permissions + integrations), Batch 5 (bounded polish), Batch 6 (Phase 5 SQL cutover). See `STABILIZATION_INVENTORY.md` § 6.

---

## Rules

- List only phases that are in progress or planned.
- Completed phases belong in `CHANGELOG_AI.md`, not here.
- Do not duplicate roadmap content — `ROADMAP.md` owns the long-term plan; `STABILIZATION_INVENTORY.md` owns the detailed backlog.
