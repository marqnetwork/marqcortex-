# MARQ Cortex Stabilization Roadmap

Status Legend

✅ Complete
🔄 In Progress
⏳ Planned
⛔ Blocked

---

## Phase F1 — Data Integrity & Runtime Trust

| Sprint | Name | Status |
|--------|------|--------|
| F1.1 | Real Data Integrity | ✅ |
| F1.2 | (not started) | ⏳ |

---

## Current Sprint

F1.1 — Real Data Integrity

Status: ✅ Complete

---

## F1.1 Scope (locked)

Fix only the Real Data Integrity issues in demo mode
(`FEATURES.BACKEND_INTEGRATION = false`). No feature additions, no
architecture changes, no API-contract changes.

Issues addressed:

1. Remove dummy/hardcoded data.
2. Dashboard must display persisted questionnaire answers.
3. Analytics refresh must reload persisted data instead of generating/changing values.
4. Platform Health must use real data or gracefully show empty state.
5. Email Queue must use real persisted data or proper empty state.
6. Invited team members must persist after refresh.

---

## F1.1 Data Source (corrected)

Real authenticated users persist through the **real Supabase/backend path**
(edge function `make-server-324f4fbe` → `kv_store_324f4fbe` + Supabase Auth).
Production builds default to the backend (`BACKEND_INTEGRATION = import.meta.env.PROD`);
demo mode (localStorage) is isolated to local dev / explicit
`VITE_BACKEND_INTEGRATION=false`.

## Runtime Authority (unchanged)

- Storage Authority: KV (`kv_store_324f4fbe`)
- Storage Gateway: preserved
- SQL Authority: No
- API Contracts: Stable
- Frontend layouts: Unchanged

---

## Rules

- Update only the sprint status after each completed sprint.
- Do not rewrite this file.
- Treat this file as the source of truth for stabilization progress.
