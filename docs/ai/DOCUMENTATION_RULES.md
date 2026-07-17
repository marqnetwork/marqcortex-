# Documentation Rules

Authority: governed by `MARQ_CORTEX.md`. Documentation is part of the implementation; a sprint is not complete until affected documentation is accurate.

---

# Core Rules

1. **Mandatory.** Every completed sprint reviews documentation. If implementation changed, documentation is updated before the sprint is complete.
2. **Update only what changed.** Do not modify unrelated documents. Do not rewrite stable documentation unless it has become inaccurate.
3. **Match implementation.** Documentation describes current behavior only — never planned functionality, never ahead of or behind the code.
4. **No duplication.** One source of truth per topic. Prefer references over repeated content. Workflow, engineering, QA, and execution rules live only in `MARQ_CORTEX.md`.

---

# What to Review

When a change affects any of these, update the corresponding document: architecture, APIs, database, user flows, business rules, configuration, infrastructure, deployment, testing, feature behavior.

Standard targets: `ROADMAP.md`, `STABILIZATION.md`, `ARCHITECT.md`, `architecture/system_map.json`, API/database docs, and the `CHANGELOG_AI.md` entry.

---

# Records

- **Completed work** → one concise `CHANGELOG_AI.md` entry (Feature, Status, Completed, Commit, Notes).
- **Roadmap status** → update sprint/phase status only; do not renumber or rewrite.
- **Architecture docs** → update only when system design, responsibilities, data flow, contracts, infrastructure, or security model change. Bug fixes alone do not require architecture updates.

---

# Quality

Documentation must be accurate, technical, concise, current, consistent, and free from duplication. Avoid speculative or outdated content.
