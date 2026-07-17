# Active Work

Current Objective: Stabilization Batch 1 — Cutover Safety Pre-reqs

Current Sprint: Batch 1 (blocks S7.x cutover; see `STABILIZATION.md` and `STABILIZATION_INVENTORY.md` § 6)

Current Task: Remove hardcoded demo credentials (F-004), deploy Supabase edge function + set secrets (A1), add unit tests for the 5 core math engines (F-010 / RC-005). All must land before any `BACKEND_INTEGRATION` flip.

Current File: `src/app/services/dataService.ts` (demo-credential path), `src/config/features.ts`, `src/app/core/` engines

Root Cause: App still defaults to demo mode (`BACKEND_INTEGRATION=false`); F-004 hardcoded creds become a live auth vuln the instant backend mode is enabled.

Next Action: Begin Batch 1 — start with F-004 (move demo credentials out of the compiled bundle).

Branch: claude/marq-cortex-stabilization-recovery-1990jj

Commit:

Blockers: None

Completed Today: Unified stabilization inventory with the AI Operating System (merged AI OS branch; migrated STABILIZATION_RECONCILIATION.md → STABILIZATION_INVENTORY.md; docs/ai/ adopted as sole documentation authority).
