# STABILIZATION INVENTORY

> Source of truth for stabilization findings and their remediation status.

## Batch 1 — Cutover Safety Pre-reqs

### F-004 — Hardcoded demo credentials in the frontend bundle — ✅ RESOLVED
- **Severity:** P0 (cutover gate).
- **Root cause:** demo auth embedded a working admin credential pair
  (`admin@marqcortex.com` / `CortexAdmin2026!`) as client-side string literals,
  which compiled into the shipped JS bundle; the same password doubled as the
  backend's default admin seed.
- **Resolution:** literals + fixed demo token removed; passwordless demo session
  gated by dev-only `VITE_DEMO_MODE`; plaintext credential UI removed; registry
  strings redacted; build-time bundle guard added.
- **Evidence:** `src/app/components/TeamLogin.tsx`, `src/app/services/dataService.ts`,
  `src/config/features.ts`, `scripts/verify-bundle.mjs`.

### A1 — Backend auth credential fallbacks / not fail-closed — ✅ RESOLVED
- **Severity:** P0 (cutover gate).
- **Root cause:** `seedAdminUser()` and `getTeamEmail()` fell back to hardcoded
  `admin@marqcortex.com` / `CortexAdmin2026!` when `TEAM_ADMIN_EMAIL` /
  `TEAM_ADMIN_PASSWORD` were unset, so a deploy without secrets provisioned a
  known-password admin. No startup validation; nothing failed closed.
- **Resolution:**
  - Required-secret validation at startup (`validateSecrets.ts` → `SECRETS_VALID`).
  - No credential fallbacks: seeder and login require the secrets.
  - Fail closed: seeding skipped and `POST /auth/team/login` returns `503` when
    secrets are missing.
  - Idempotent password sync rotates the live admin credential on redeploy.
- **Evidence:** `supabase/functions/server/index.tsx` (seed / getTeamEmail / login),
  `supabase/functions/server/auth/validateSecrets.ts`, `tests/auth/validate-secrets.test.ts`.

### F-010 / RC-005 — Missing unit tests for the five core math engines — ⏳ OPEN
- **Severity:** medium. Not started; scheduled for the Batch 1 remainder.

## Known residuals (non-blocking)
- **Email notification default recipient:** `supabase/functions/server/emailService.ts`
  keeps `teamEmail = 'admin@marqcortex.com'` as a default parameter, relied on by
  the new-submission notification call site. This is a notification-routing default,
  **not** an auth credential (no password). Recommended follow-up: route all
  notification recipients through `getTeamEmail()`. Out of A1 scope.
- **Committed build/dependency artifacts:** `dist/`, `node_modules/`, and
  `test-results/` are tracked despite `.gitignore`. Recommend
  `git rm -r --cached` in a dedicated hygiene pass.
