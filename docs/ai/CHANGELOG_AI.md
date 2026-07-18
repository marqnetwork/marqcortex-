# CHANGELOG (AI)

> Chronological log of AI-executed stabilization work. Newest first.

## 2026-07-18 — F-010 / RC-005: unit tests for the five core math engines

Batch 1 final item. Branch `claude/marq-cortex-stabilization-batch-1-rzvtii`.

- Identified the five engines from `memory/failure_library.md`:
  **scoringEngine, roiEngine, dcfEngine, irrEngine, monteCarloEngine**.
- Added `tests/core/*.test.ts` (59 tests) + `tests/core/_fixtures.ts`, covering
  normal operation, edge cases, invalid inputs, boundary conditions, and
  regression anchors. ROI is exercised against the ExampleCo gold-standard
  portfolio (`src/imports/exampleco-portfolio-diagnostic-1.json`).
- Added `tests/support/ts-extension-hook.mjs` + `register-ts.mjs` — a test-only
  module-resolution shim so the Node runner can import engines that use
  extensionless relative imports. **No engine source was modified.**
- Added the `test:core` script.
- No defect discovered — all engine behavior left unchanged.
- Verified: `test:core` 59/59. Full regression: core 59, auth 6, intelligence 8,
  database 19, migration 36, smoke 1 — all pass; frontend build + F-004 guard green.

## 2026-07-18 — A1: backend authentication production-readiness

Batch 1, item A1. Branch `claude/marq-cortex-stabilization-batch-1-rzvtii`.

- Added `supabase/functions/server/auth/validateSecrets.ts` — a pure,
  runtime-agnostic validator (`REQUIRED_AUTH_SECRETS`, `validateStartupSecrets`).
- `supabase/functions/server/index.tsx`:
  - Startup secret validation → `SECRETS_VALID` fail-closed flag; logs missing secrets.
  - `seedAdminUser()`: removed the hardcoded `admin@marqcortex.com` /
    `CortexAdmin2026!` fallbacks; requires the secrets; skips seeding when they are
    missing (fail closed); syncs the existing admin's password to the current secret
    (idempotent rotation).
  - `getTeamEmail()`: removed the hardcoded email literal; uses `TEAM_ADMIN_EMAIL` only.
  - `POST /auth/team/login`: returns `503` when required secrets are missing.
- Redacted now-inaccurate registry strings in `src/app/utils/registryData.ts` and
  `src/app/utils/registryDataExtension.ts`.
- Added `tests/auth/validate-secrets.test.ts` and the `test:auth` script.
- Verified: `test:auth` (6/6). Regression: `test:intelligence` (8/8),
  `test:database` (19/19), `test:migration` (36/36), `test:smoke` (1/1),
  frontend build + F-004 bundle guard all green.
- Created `docs/ai/` authority set (this file, ACTIVE_WORK, STABILIZATION,
  STABILIZATION_INVENTORY) — absent in the checkout at the time of this work.

## 2026-07-18 — F-004: remove hardcoded demo credentials from the frontend bundle

Batch 1, item F-004. Commit `5bb89256`.

- Replaced the demo credential check with a passwordless demo session gated by the
  dev-only `VITE_DEMO_MODE` flag; no frontend secret introduced.
- Consolidated team-login logic into `dataService.teamLogin`; removed the duplicate
  inline demo branch and the fixed demo token (now generated at runtime).
- Removed the plaintext demo-credential UI; redacted registry/debug strings.
- Added `scripts/verify-bundle.mjs` (wired into `npm run build`) to fail the build if
  any credential literal or demo token appears in `dist/`.
- Updated the smoke test to the passwordless flow; added `.env.development`.
