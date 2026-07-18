# ACTIVE WORK

> Current sprint status for MARQ Cortex stabilization.
> Authoritative — update as work lands.

## Sprint: Stabilization Batch 1 — Cutover Safety Pre-reqs

Branch: `claude/marq-cortex-stabilization-batch-1-rzvtii`

| ID | Item | Status |
|----|------|--------|
| F-004 | Remove hardcoded demo credentials from the compiled frontend bundle | ✅ Complete |
| A1 | Backend authentication production-readiness (rotation, fail-closed secrets) | ✅ Complete |
| F-010 / RC-005 | Unit tests for the five core math engines | ⏳ Not started (Batch 1 remainder / follow-up) |

### F-004 — Complete
- Frontend credential literals and the fixed demo token removed.
- Team login consolidated into a single `dataService.teamLogin`; demo login is now a passwordless session gated by the dev-only `VITE_DEMO_MODE` flag.
- Plaintext demo-credential UI removed; registry/debug strings redacted.
- Build guard (`scripts/verify-bundle.mjs`, wired into `npm run build`) fails if any credential literal or demo token appears in `dist/` (plaintext, base64, hex, URL-encoded, or split/concatenated).

### A1 — Complete
- `TEAM_ADMIN_EMAIL` + `TEAM_ADMIN_PASSWORD` are now required secrets; **no hardcoded fallbacks** remain in the backend auth path.
- Startup secret validation (`supabase/functions/server/auth/validateSecrets.ts`) drives a `SECRETS_VALID` fail-closed flag.
- Admin seeder refuses to create a default admin when secrets are missing (fail closed) and syncs the existing admin's password to the current secret on cold start (deterministic rotation).
- `POST /auth/team/login` returns `503` when required secrets are missing.
- Verified via `npm run test:auth`; regression suites and F-004 gate all green.

## Next
- **Ops (required before cutover):** set fresh `TEAM_ADMIN_EMAIL` / `TEAM_ADMIN_PASSWORD` secrets in Supabase and redeploy the edge function so rotation takes effect. See STABILIZATION.md → "A1 operational follow-up".
- F-010 / RC-005 math-engine unit tests remain for the Batch 1 remainder.

## Do NOT
- Begin Batch 2.
- Commit secrets or hardcode credentials.
