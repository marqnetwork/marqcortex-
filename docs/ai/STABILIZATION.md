# STABILIZATION

> Batch plans and production-gate status.

## Batch 1 — Cutover Safety Pre-reqs

Goal: satisfy the P0 security gates required before backend cutover.

| Gate | Requirement | Status |
|------|-------------|--------|
| F-004 | No credential material in the production frontend bundle | ✅ Satisfied |
| A1 | Backend auth requires secrets, fails closed, no hardcoded fallbacks | ✅ Satisfied |
| Bundle guard | Build fails if credentials/token appear in `dist/` | ✅ In place |
| F-010 / RC-005 | Core math-engine unit tests | ⏳ Remaining |

### A1 — design summary
- **Required secrets:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_ANON_KEY`, `TEAM_ADMIN_EMAIL`, `TEAM_ADMIN_PASSWORD`
  (`REQUIRED_AUTH_SECRETS` in `validateSecrets.ts`).
- **Fail closed:** when any required secret is missing, the admin seeder creates
  no account and `POST /auth/team/login` returns `503`.
- **No fallbacks:** the admin email/password are read only from secrets; the
  previous hardcoded defaults are removed from `seedAdminUser()` and
  `getTeamEmail()`.
- **Rotation:** `seedAdminUser()` syncs the existing admin's password to the
  current `TEAM_ADMIN_PASSWORD` on every cold start, so rotating the secret and
  redeploying rotates the live credential idempotently.

### A1 — operational follow-up (required before cutover)
The password `CortexAdmin2026!` must be treated as compromised (it was in source
and git history). Operators must:
1. Set fresh `TEAM_ADMIN_EMAIL` and `TEAM_ADMIN_PASSWORD` secrets in the Supabase
   Edge Function dashboard (never commit them).
2. Deploy the edge function (`npm run supabase:deploy`); the cold-start seeder
   applies the rotated password.
3. Also set `RESEND_API_KEY` and `OPENAI_API_KEY` for email + AI features.

Secrets cannot be set from the repository and are intentionally not committed.

## Verification commands
- Frontend gate: `npm run build` (runs `vite build` + `verify:bundle`).
- Auth logic: `npm run test:auth`.
- Regression: `npm run test:intelligence`, `npm run test:database`,
  `npm run test:migration`, `npm run test:smoke`.
