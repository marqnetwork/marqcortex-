# AI Changelog

Reverse-chronological log of AI-assisted stabilization changes.

## 2026-07-18 — Stabilization Batch 3 (branch `claude/marq-cortex-batch-3-xwya9f`)

Demo → backend reconciliation of the AI/analytics surface.

### Changed
- `src/system/manifest.ts`:
  - Reconciled 7 nodes `DEMO → LIVE` that already issue real backend/service
    calls in backend mode: `MQC-COMP-046`, `MQC-COMP-047`, `MQC-COMP-048`,
    `MQC-COMP-052`, `MQC-COMP-053`, `MQC-COMP-057`, `MQC-SVC-002`. Notes updated
    to name the exact route/binding for each.
  - Documented (no status change) the 6 remaining DEMO nodes and 3 GATED nodes
    with the concrete reason each cannot be migrated (missing endpoint / external
    prerequisite): `MQC-COMP-021/049/050/051/054/056` and
    `MQC-COMP-059/061/067`.
  - Header meta: `lastVerified` → `2026-07-18`; added Batch 3 summary note.

### Added
- `docs/ai/STABILIZATION_INVENTORY.md`
- `docs/ai/STABILIZATION.md`
- `docs/ai/ACTIVE_WORK.md`
- `docs/ai/CHANGELOG_AI.md`

### Not changed (deliberately)
- No application/runtime source logic. The demo fallbacks are flag-gated and still
  required for `BACKEND_INTEGRATION=false`.
- The `BACKEND_INTEGRATION` global default (left as-is).
- Pre-existing manifest lint items (`MQC-MIG-001` id format; repository-SVC
  `backendRoute` warnings) — out of scope.

### Verification
- `vite build`: success.
- `node --test` intelligence (8), migration (36), database static (19): all pass.
- `runValidation(manifest)`: 1 pre-existing error + 11 pre-existing warnings
  (unchanged from baseline); no new status-propagation warnings from the flips.

### Result
> Stabilization Batch 3 is complete.

Every production feature that has a consumable backend endpoint now runs on the
real backend in backend mode. The remaining 6 DEMO + 3 GATED features are blocked
on missing backend endpoints or external prerequisites and are documented for
Batch 4 consideration.
