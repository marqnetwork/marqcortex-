# MARQ Cortex — Deployment Readiness Report

**Workstream:** Batch 6 · WS9 — Deployment & Production Readiness
**Date:** 2026-07-19
**Branch:** `claude/marq-cortex-batch-6-ws9-inkm86`
**Nature:** Production-readiness **audit** (not a deployment, not an infra redesign)

> This report is derived exclusively from repository evidence and the
> verifications that can run without live infrastructure. Checks that require a
> live Supabase project, live OpenAI credentials, or a Vercel deployment are
> explicitly listed as **post-deployment verification**, not asserted as passing.

---

## Overall Readiness: **READY WITH MANUAL ACTIONS**

The codebase builds, all offline test suites pass (112 automated checks green),
migrations are ordered and internally consistent, and the backend exposes a
working health endpoint. Production launch is **gated on a small set of manual
configuration actions** — chiefly setting production secrets (admin password,
OpenAI key) and flipping the frontend backend-integration flag. None of the
findings require code changes to reach a first production deploy; they require
**operator configuration** and **post-deploy live verification**.

| Area | Readiness | Note |
|------|-----------|------|
| Environment      | ⚠️ READY WITH MANUAL ACTIONS | Flag + secrets must be set at deploy time |
| Database         | ✅ READY | 8 ordered migrations, KV authoritative (no cutover) |
| Backend (Edge)   | ✅ READY | Hono app, 79 routes, health endpoint; startup is log-only (not fail-closed) |
| Frontend         | ✅ READY | Vite build passes; SPA artifacts generated |
| Security         | ⚠️ READY WITH MANUAL ACTIONS | Default admin password fallback; wildcard CORS |
| Observability    | ⚠️ PARTIAL | Health only (no `/readiness`); no source maps; console logging only |
| Documentation    | ⚠️ PARTIAL | `DEPLOYMENT_GUIDE.md` is stale/generic; this report + checkpoint are authoritative |

---

## 1. Environment Readiness

### Backend Edge Function secrets (`Deno.env.get` in `supabase/functions/**`)

| Variable | Class | Behaviour if unset |
|----------|-------|--------------------|
| `SUPABASE_URL` | Required | Auto-injected by Supabase platform. Startup logs `CRITICAL … MISSING`; app continues (not fail-closed). |
| `SUPABASE_SERVICE_ROLE_KEY` | Required | Auto-injected by Supabase. Admin client cannot authenticate without it. |
| `SUPABASE_ANON_KEY` | Required | Auto-injected by Supabase. Team login proxy fails without it. |
| `TEAM_ADMIN_PASSWORD` | **Required (prod)** | **Falls back to hardcoded `CortexAdmin2026!`** — see Security. |
| `TEAM_ADMIN_EMAIL` | Required (prod) | Falls back to `admin@marqcortex.com`. |
| `TEAM_ADMIN_NAME` | Optional | Falls back to `MARQ Admin`. |
| `OPENAI_API_KEY` | **Required for LIVE AI** | AI gateway throws `MISSING_CREDENTIALS`; AI features fail (see §5). |
| `RESEND_API_KEY` | Optional | Email service **no-ops gracefully** (logs `EMAIL SKIPPED`). |
| `EMAIL_FROM` | Optional | Defaults to `MARQ Cortex <onboarding@resend.dev>`. |
| `INTELLIGENCE_PROVIDER` | Optional | Defaults to `openai`. |
| `INTELLIGENCE_MODEL_*` (5) | Optional | Default `gpt-4o-mini`. |
| `INTELLIGENCE_TIMEOUT_MS` / `_MAX_RETRIES` / `_RETRY_DELAY_MS` | Optional | Defaults 30000 / 1 / 250. |

### Frontend build-time vars (`import.meta.env.VITE_*` in `src/**`)

| Variable | Class | Behaviour if unset |
|----------|-------|--------------------|
| `VITE_SUPABASE_URL` | Required | Falls back to bundled Figma-Make credentials / derived project URL. |
| `VITE_SUPABASE_ANON_KEY` **or** `VITE_SUPABASE_PUBLISHABLE_KEY` | Required | Falls back to bundled anon key. |
| `VITE_BACKEND_INTEGRATION` | **Required = `true` (prod)** | **Defaults `false` → frontend runs entirely in DEMO mode**, no backend calls. |
| `VITE_SUPABASE_PROJECT_ID` | Optional | Derived from URL if absent. |
| `VITE_SUPABASE_EDGE_FUNCTION` | Optional | Defaults `make-server-324f4fbe`. |
| `VITE_SHOW_API_ERRORS` | Development only | Default `false`. |
| `VITE_VERBOSE_LOGGING` | Development only | Default `false`. |
| `VITE_API_TIMEOUT` | Optional | Default 30000. |

**Naming consistency:** consistent (`VITE_` prefix frontend; `SCREAMING_SNAKE`
backend). **Documentation consistency:** `.env.example` covers the frontend
`VITE_*` set but **omits every backend secret** (`OPENAI_API_KEY`,
`RESEND_API_KEY`, `TEAM_ADMIN_*`, `INTELLIGENCE_*`). No secret values are exposed
in the repo. **Deployment consistency:** there is **no `vercel.json`** and **no
CI workflow**, so build settings and env wiring are manual dashboard steps.

---

## 2. Database Readiness

**Migrations (`supabase/migrations`, timestamp-ordered, no gaps/collisions):**

1. `20260711050000_cortex_tenancy_foundation.sql`
2. `20260711050001_cortex_tenancy_rls_and_seed.sql`
3. `20260713000000_kv_store_foundation.sql`
4. `20260713184931_migration_infrastructure.sql`
5. `20260713184943_migration_infrastructure_rls.sql`
6. `20260714050000_cortex_diagnostic_foundation.sql`
7. `20260714050001_cortex_diagnostic_rls.sql`
8. `20260714060000_cortex_diagnostic_anon_policy_hardening.sql`

- **Ordering:** monotonic timestamps; foundation → RLS pairing is consistent.
- **Schema consistency:** static migration/diagnostic tests pass (19/19).
- **Applied vs unapplied:** **cannot be determined offline.** Requires
  `supabase migration list --linked` against the live project — post-deploy check.
- **KV authority status:** **KV (`kv_store_324f4fbe`) remains authoritative.**
  `ARCHITECT.md`: *"Production store — `kv_store_324f4fbe` — still authoritative"*
  and *"KV remains authoritative until per-domain Phase 5 cutover."*
- **SQL cutover status:** **NOT performed** (relational `cortex.*` schema exists
  but is not the read/write path). Per WS9 scope, **no cutover was performed.**

**Rollback capability (`supabase/migrations/rollbacks`):** 3 scripts present —
`rollback_tenancy`, `rollback_migration_infrastructure`, `rollback_diagnostic`.
The KV-store, RLS-only, and anon-policy-hardening migrations have **no dedicated
rollback script** (partial coverage — see §9 / Known Risks).

---

## 3. Backend Readiness

- **Runtime:** Supabase Edge Function `make-server-324f4fbe`; entry
  `supabase/functions/make-server-324f4fbe/index.ts` → `server/index.tsx` →
  `Deno.serve(app.fetch)`.
- **Routing:** Hono app, **79 routes** (`app.get/post/patch/put/delete`), all
  namespaced under `/make-server-324f4fbe/*`.
- **CORS:** first middleware; `origin: "*"`, methods incl. OPTIONS preflight.
- **Rate limiting:** in-memory per-instance (120 req/min/IP) — resets on
  cold-start; not distributed (documented as a production upgrade in-code).
- **Required-secret validation:** startup logs `❌ CRITICAL … MISSING` for each
  missing Supabase var but **continues to boot (not fail-closed)** — uses
  non-null assertions on the admin client.
- **Health endpoint:** ✅ `GET /make-server-324f4fbe/health` — probes KV
  (set/get/del round-trip) and returns `{status, kvStore}` (500 on failure).
  Also `GET /ping` (liveness) and `GET /test-auth` (auth probe).
- **Readiness endpoint:** ❌ **none.** No `/readiness` / `/readyz`. Recommend
  adding one that asserts required secrets + KV + provider credentials before
  reporting ready (observability gap, not a deploy blocker).
- **`verify_jwt = false`** (`config.toml`) — auth is enforced in-handler
  (`verifyTeamToken`, `verifyClientToken`, `requireClientAccess`), which is
  correct because public routes (submissions, leads) must remain unauthenticated.

---

## 4. Frontend Readiness

- **Production build:** ✅ `npm run build` (Vite 6.3.5) succeeded in ~11s.
- **Artifacts:** `dist/index.html` + hashed `dist/assets/*` (code-split routes).
- **Routing:** hash-based SPA (`react-router` v7); smoke test confirms
  `/#/diagnostic → /#/score → /#/team/login → /#/team/dashboard`.
- **Environment selection:** `src/config/supabase.config.ts` prefers `VITE_*`,
  falls back to bundled Figma-Make credentials; `hasCustomSupabaseConfig`
  reflects override state.
- **Source maps:** ❌ **not generated** (Vite default; `dist/**/*.map` = 0) —
  production stack traces will be minified (observability gap).
- **Bundle warnings:** ⚠️ chunks exceed 500 kB — largest
  `CortexDashboard` ≈ 1.23 MB (304 kB gzip), `pdfExport` ≈ 597 kB. Functional,
  but recommend manual chunking / dynamic imports for load performance.
- **Deployment artifacts:** static SPA — deployable to Vercel with output
  directory `dist` and SPA rewrite to `/index.html`.

---

## 5. Supabase Readiness

- **Edge Function deploy:** `npx supabase functions deploy make-server-324f4fbe`
  (matches `package.json` `supabase:deploy`).
- **Secrets required at deploy:** `TEAM_ADMIN_EMAIL`, `TEAM_ADMIN_PASSWORD`,
  `OPENAI_API_KEY`, `RESEND_API_KEY` (+ `EMAIL_FROM`, `INTELLIGENCE_*` optional).
  `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` are
  platform-injected.
- **Auth:** email/password via Supabase Auth; admin user is **seeded idempotently
  on startup** (`seedAdminUser`). Client access uses server-issued KV session
  tokens (8-hour TTL, `client_session:*`).
- **CORS:** wildcard origin in-code — **must be verified against the deployed
  domain** (see risks).
- **RLS expectations:** RLS migrations exist for tenancy, migration
  infrastructure, and diagnostic schema; **the live-path store is KV**, so RLS on
  `cortex.*` is not yet the enforcement boundary — verify post-cutover only.
- **Storage expectations:** no Supabase Storage bucket dependency found; PDF
  export is **client-side** (`jspdf` / `html2canvas`, `pdfExport` chunk).

**Live-only verification (cannot run offline):** function reachability, real
`/health` 200, auth sign-in, RLS enforcement, CORS against the production origin.

---

## 6. Vercel Readiness

No `vercel.json` in repo — settings are **manual dashboard configuration**:

| Setting | Value |
|---------|-------|
| Framework preset | Vite |
| Build command | `npm run build` |
| Install command | `npm install` |
| Output directory | `dist` |
| Rewrites | all routes → `/index.html` (SPA) |
| Production env | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (or `_PUBLISHABLE_KEY`), **`VITE_BACKEND_INTEGRATION=true`** |

**Deployment order (Vercel):** set env vars **before** the production build —
`VITE_*` values are inlined at build time; changing them requires a rebuild.

---

## 7. Deployment Order (evidence-based)

1. **Database migrations** — `npx supabase db push` (or `supabase migration up`)
   against the linked project. Confirm with `supabase migration list --linked`.
2. **Edge Function secrets** — set `TEAM_ADMIN_EMAIL`, `TEAM_ADMIN_PASSWORD`,
   `OPENAI_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM` (+ `INTELLIGENCE_*`).
3. **Edge Function deploy** — `npx supabase functions deploy make-server-324f4fbe`.
4. **Smoke the Edge Function** — `GET …/make-server-324f4fbe/ping` → `pong`.
5. **Frontend env** — set Vercel production vars incl. `VITE_BACKEND_INTEGRATION=true`.
6. **Frontend deploy** — Vercel production build (`npm run build`, output `dist`).
7. **Health verification** — `GET …/health` → `{status:"ok", kvStore:"connected"}`.
8. **Readiness verification** — run the smoke checklist (§8) end-to-end.

---

## 8. Production Smoke Checklist

Run against the **live** deployment after §7. (Automated demo-mode equivalent —
`tests/smoke/diagnostic-score-team-login.spec.ts` — already passes offline.)

- [ ] **Health** — `GET /health` → `200 {status:"ok", kvStore:"connected"}`
- [ ] **Readiness** — `GET /ping` → `pong`; no `CRITICAL … MISSING` in function logs
- [ ] **Authentication** — team login with the **real** `TEAM_ADMIN_*` credentials
- [ ] **Authorization** — unauthenticated `GET /submissions` → `401`; client token scoped to its own submission (cross-id → `404`)
- [ ] **Client** — email verify issues session token; client can read only own report
- [ ] **Team** — dashboard lists live submissions; status update persists
- [ ] **Bookings** — `POST /bookings` persists (KV `booking:*`, schemaVersion 2); team `GET /bookings` reads it
- [ ] **Registry** — Block Registry CRUD + revision/lock persists to KV
- [ ] **AI** — narrative/analysis/chat/copilot return real output (requires `OPENAI_API_KEY`); no `MISSING_CREDENTIALS`
- [ ] **Storage** — client-side PDF export downloads (no server bucket dependency)
- [ ] **Feature flags** — `VITE_BACKEND_INTEGRATION=true` confirmed (UI hits backend, not demo data)
- [ ] **Admin** — seeded admin exists exactly once; no duplicate on redeploy
- [ ] **No fabricated data** — all counts trace to real KV entries, not seed/demo fixtures

---

## 9. Rollback

| Layer | Procedure | Status |
|-------|-----------|--------|
| **Frontend** | Vercel → promote previous production deployment (instant) | ✅ Supported by platform |
| **Edge Function** | Re-deploy previous `make-server-324f4fbe` from prior commit (`git checkout <sha> -- supabase/functions && supabase functions deploy`) | ✅ Manual, code-based |
| **Migration** | Apply matching script in `supabase/migrations/rollbacks/` | ⚠️ **Partial** — only tenancy, migration-infrastructure, diagnostic have scripts; KV-store / RLS-only / anon-policy migrations have none |
| **Feature flag** | Set `VITE_BACKEND_INTEGRATION=false` and rebuild → frontend reverts to demo mode (isolates a bad backend without a full rollback) | ✅ Supported |

**Known limitations:** (a) migration rollback coverage is incomplete; a failed
`kv_store_foundation` / RLS / anon-policy migration must be reversed manually.
(b) Frontend flags are **build-time**, so a flag rollback requires a rebuild, not
a runtime toggle. (c) Edge rollback is not automated (no CI).

---

## 10. Launch Blockers

| # | Blocker | Root cause | Impact | Owner | Manual action |
|---|---------|-----------|--------|-------|---------------|
| B1 | **Default admin password** | `TEAM_ADMIN_PASSWORD` falls back to hardcoded `CortexAdmin2026!` (`index.tsx` `seedAdminUser`) | Anyone can log in as team admin if the secret is unset | Deployer | Set a strong `TEAM_ADMIN_PASSWORD` (and `TEAM_ADMIN_EMAIL`) **before first deploy** |
| B2 | **Frontend ships in demo mode** | `VITE_BACKEND_INTEGRATION` defaults `false` | Deployed app never calls the backend; users see seed data | Deployer | Set `VITE_BACKEND_INTEGRATION=true` in Vercel prod and rebuild |
| B3 | **AI features dark without key** | `OPENAI_API_KEY` unset → `MISSING_CREDENTIALS` | Narrative/analysis/chat/copilot fail at runtime | Deployer | Set `OPENAI_API_KEY` as an Edge secret (or accept AI-off launch) |

These are **configuration blockers**, not code defects. With B1–B3 actioned,
**deployment can continue.**

### Can deployment continue? **YES — after manual actions B1, B2, B3.**

Non-blocking follow-ups (do not gate launch): add `/readiness` endpoint; enable
source maps; add `vercel.json` + CI; complete migration rollback coverage; refresh
`DEPLOYMENT_GUIDE.md`; manual-chunk the large bundles; distributed rate limiting.

---

## Verification Summary

| Check | Command | Result |
|-------|---------|--------|
| Production build | `npm run build` | ✅ PASS (~11s; chunk-size warnings; no source maps) |
| Intelligence tests | `npm run test:intelligence` | ✅ 8/8 |
| Feature tests | `npm run test:features` | ✅ 48/48 |
| Database tests | `npm run test:database` | ✅ 19/19 |
| Migration tests | `npm run test:migration` | ✅ 36/36 |
| E2E smoke (demo mode) | `npx playwright test` | ✅ 1/1 (diagnostic → score → team login) |
| Manifest validation | `src/system/manifest.ts` typecheck via build | ✅ compiles; 171 entries (157 LIVE / 9 DEMO / 3 GATED / 2 SYSTEM) |
| Git verification | `git status` / branch / remote | ✅ clean tree, branch tracks origin |

**Total offline automated checks: 112 passing.**

### Checks unavailable offline (require live infrastructure) — reported honestly

- Live Edge Function `/health` 200 and cold-start logs (needs deployed function)
- Live Supabase Auth sign-in, RLS enforcement, CORS vs production origin
- Applied-migration state — `supabase migration list --linked`
- Live AI gateway certification against OpenAI (WS11 — gated)
- `migration:validate-s6.3` live fixture run (needs a linked DB)
- Vercel build/deploy and SPA rewrite behaviour

---

## Appendix — Documentation Consistency

`DEPLOYMENT_GUIDE.md` is a **stale generic guide** (references SendGrid, Calendly,
and an Express/Node backend) that **does not match the actual stack** (Supabase
Edge Function + Hono + Resend + client-side PDF). Treat **this report** and
`BATCH_6_CHECKPOINT.md` as authoritative for deployment; `DEPLOYMENT_GUIDE.md`
should be rewritten in a later workstream.
