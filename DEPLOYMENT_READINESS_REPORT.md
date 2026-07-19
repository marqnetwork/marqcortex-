# MARQ Cortex — Deployment Readiness Report

**Workstream:** Batch 6 · WS9 — Deployment & Production Readiness (reconciled against the integrated branch)
**Original audit date:** 2026-07-19 (isolated `claude/marq-cortex-batch-6-ws9-inkm86`)
**Reconciled:** 2026-07-19 on the Batch 6 integration branch
**Integration branch:** `claude/marq-cortex-batch-6-integration` (pushed as `claude/marq-cortex-batch-6-integration-q63cgc`)
**Nature:** Production-readiness **audit** (not a deployment, not an infra redesign)

> **Reconciliation notice.** The original WS9 audit was produced from a branch
> that did **not** contain WS1, WS6, WS7, or WS8. Several of its findings were
> therefore *stale-branch artifacts* — true of the WS9 branch, false of the
> integrated repository. This report has been rewritten to describe the
> **integrated** repository state (WS1 + WS6 + WS7 + WS8 present). See §0 for the
> explicit reconciliation of every superseded finding.

> This report is derived exclusively from repository evidence and the
> verifications that can run without live infrastructure. Checks that require a
> live Supabase project, live OpenAI credentials, Deno, or a Vercel deployment
> are explicitly listed as **post-deployment / unavailable**, not asserted as passing.

---

## 0. WS9 Contradiction Reconciliation (integrated state)

| # | Original WS9 finding | Classification | Evidence in integrated code |
|---|----------------------|----------------|------------------------------|
| 1 | "No `/readiness` endpoint" | **Fixed by integrated earlier work (WS8)** — stale WS9-branch artifact | `GET /make-server-324f4fbe/readiness` (`supabase/functions/server/index.tsx`), team-auth, 503 when not ready, secret-free (`observability/readiness.ts`) |
| 2 | "`TEAM_ADMIN_PASSWORD` falls back to `CortexAdmin2026!`" | **Fixed by integrated earlier work (WS6 + WS7)** — stale WS9-branch artifact | `seedAdminUser` now calls `resolveAdminSeed()` (`adminSeedPolicy.ts`); seeds only when **both** `TEAM_ADMIN_EMAIL` and `TEAM_ADMIN_PASSWORD` are set. No hardcoded password exists on any server seed path. |
| 3 | "Startup does not fail closed" | **Partially true** | *Admin seeding* now fails closed (skips with a logged reason when unconfigured — fixed). *Required-Supabase-secret boot* still logs `CRITICAL … MISSING` and continues; those vars are platform-injected by Supabase, so this is a descriptive note, not a security blocker. |
| 4 | "No `BATCH_6_CHECKPOINT.md` existed" | **Stale branch artifact — fixed by integrated earlier work (WS1)** | `BATCH_6_CHECKPOINT.md` is created by WS1 (`a3617861`) and is present and authoritative on the integration branch. The WS9 branch lacked WS1, so the file was absent there only. |

The stale launch blocker **B1 (default admin password)** from the original WS9
report has been **removed** — the code proving it false is integrated. CORS is
no longer wildcard-with-credentials. Observability is no longer "health only".

---

## Overall Readiness: **READY WITH MANUAL ACTIONS**

The codebase builds, all offline test suites pass (**149 automated checks green**),
migrations are ordered and internally consistent, and the backend exposes both a
health endpoint and an auth-protected `/readiness` endpoint. Production launch is
**gated on a small set of manual configuration actions** — chiefly setting
production secrets (admin credentials, OpenAI key) and flipping the frontend
backend-integration flag. None of the remaining findings require code changes to
reach a first production deploy; they require **operator configuration** and
**post-deploy live verification**.

| Area | Readiness | Note |
|------|-----------|------|
| Environment      | ⚠️ READY WITH MANUAL ACTIONS | Flag + secrets must be set at deploy time |
| Database         | ✅ READY | Ordered migrations, KV authoritative (no cutover) |
| Backend (Edge)   | ✅ READY | Hono app, health **and `/readiness`**; admin seed now fail-closed |
| Frontend         | ✅ READY | Vite build passes; SPA artifacts generated |
| Security         | ✅ READY | **No hardcoded admin password**; admin authz; AI routes authenticated; CORS allowlist; errors not leaked |
| Observability    | ✅ READY | Request/correlation IDs; safe error handler; `/readiness`; honest mock telemetry |
| Documentation    | ⚠️ PARTIAL | `DEPLOYMENT_GUIDE.md` still stale/generic; this report + checkpoint are authoritative |

---

## 1. Environment Readiness

### Backend Edge Function secrets (`Deno.env.get` in `supabase/functions/**`)

| Variable | Class | Behaviour if unset |
|----------|-------|--------------------|
| `SUPABASE_URL` | Required | Auto-injected by Supabase platform. Startup logs `CRITICAL … MISSING`; app continues (platform-injected). |
| `SUPABASE_SERVICE_ROLE_KEY` | Required | Auto-injected by Supabase. Admin client cannot authenticate without it. |
| `SUPABASE_ANON_KEY` | Required | Auto-injected by Supabase. Team login proxy fails without it. |
| `TEAM_ADMIN_EMAIL` | **Required to seed admin** | **No seed** — `resolveAdminSeed()` skips (fail-closed). |
| `TEAM_ADMIN_PASSWORD` | **Required to seed admin** | **No seed, no fallback** — admin user is **not** created. No hardcoded password exists. |
| `TEAM_ADMIN_NAME` | Optional | Defaults to `MARQ Admin` (only used when seeding proceeds). |
| `ALLOWED_ORIGINS` | Optional (prod lockdown) | Unset → CORS `*` **without** credentials. Set → exact-origin allowlist **with** credentials. |
| `OPENAI_API_KEY` | **Required for LIVE AI** | AI gateway throws `MISSING_CREDENTIALS`; AI features fail (see §5). No mock fallback in prod. |
| `RESEND_API_KEY` | Optional | Email service **no-ops gracefully** (logs `EMAIL SKIPPED`). |
| `EMAIL_FROM` | Optional | Defaults to `MARQ Cortex <onboarding@resend.dev>`. |
| `INTELLIGENCE_PROVIDER` | Optional | Defaults to `openai`. |
| `INTELLIGENCE_MODEL_*` / `INTELLIGENCE_TIMEOUT_MS` / `_MAX_RETRIES` / `_RETRY_DELAY_MS` | Optional | Documented defaults. |

### Frontend build-time vars (`import.meta.env.VITE_*` in `src/**`)

| Variable | Class | Behaviour if unset |
|----------|-------|--------------------|
| `VITE_SUPABASE_URL` | Required | Falls back to bundled Figma-Make credentials / derived project URL. |
| `VITE_SUPABASE_ANON_KEY` **or** `VITE_SUPABASE_PUBLISHABLE_KEY` | Required | Falls back to bundled anon key. |
| `VITE_BACKEND_INTEGRATION` | **Required = `true` (prod)** | **Defaults `false` → frontend runs entirely in DEMO mode**, no backend calls. |
| `VITE_SUPABASE_PROJECT_ID` | Optional | Derived from URL if absent. |
| `VITE_SUPABASE_EDGE_FUNCTION` | Optional | Defaults `make-server-324f4fbe`. |
| `VITE_SHOW_API_ERRORS` | Dev only | Default `false` — controls only the error **banner**, never data. |
| `VITE_VERBOSE_LOGGING` | Dev only | Default `false`. |
| `VITE_API_TIMEOUT` | Optional | Default 30000. |

**`.env.example`** now documents the backend server secrets (`TEAM_ADMIN_*`,
`ALLOWED_ORIGINS`, `OPENAI_API_KEY`, etc.) added in WS7. No secret values are
exposed in the repo. There is still **no `vercel.json`** and **no CI workflow**,
so build settings and env wiring remain manual dashboard steps.

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
  `supabase migration list --linked` — post-deploy check.
- **KV authority status:** **KV (`kv_store_324f4fbe`) remains authoritative.**
  No workstream in this integration changed the read/write path.
- **SQL cutover status:** **NOT performed** and not attempted. The relational
  `cortex.*` schema exists but is not the live path.

**Rollback capability (`supabase/migrations/rollbacks`):** tenancy,
migration-infrastructure, and diagnostic scripts present; KV-store / RLS-only /
anon-policy migrations have no dedicated rollback script (partial coverage — §9).

---

## 3. Backend Readiness

- **Runtime:** Supabase Edge Function `make-server-324f4fbe`; `server/index.tsx`
  → `Deno.serve(app.fetch)`.
- **Routing:** Hono app namespaced under `/make-server-324f4fbe/*`.
- **CORS:** first middleware. `ALLOWED_ORIGINS` allowlist (credentials on) when
  set; otherwise `*` **without** credentials — the invalid `*` + `credentials:true`
  combination is gone (WS7).
- **Request/correlation IDs:** every request is assigned a validated
  `X-Request-Id`/`X-Correlation-Id` (or a minted UUID), stored on context and
  echoed on the response (WS8, `observability/requestContext.ts`).
- **Rate limiting:** in-memory per-instance (120 req/min/IP) — resets on
  cold-start; not distributed (documented in-code).
- **Admin seed:** **fail-closed** — `resolveAdminSeed()` seeds only when both
  `TEAM_ADMIN_EMAIL` and `TEAM_ADMIN_PASSWORD` are set; no hardcoded credential
  (WS6 + WS7).
- **Error handling:** global `onError` logs full detail internally keyed by
  request id and returns a **generic, secret-free** `{ error: "Internal server
  error.", requestId, timestamp }` (WS7 + WS8). No `err.message`/`err.name`/stack
  leaked to clients.
- **Health endpoint:** ✅ `GET …/health` — KV set/get/del round-trip; also `/ping`
  and `/test-auth`.
- **Readiness endpoint:** ✅ `GET …/readiness` (team-auth). Honestly reports
  config presence (booleans only), KV reachability, Intelligence Gateway
  provider health + certification status, and optional email integration.
  Returns **503** when not ready. **No secret values** are returned. Surfaces
  `mockProviderActive` so the mock provider cannot silently appear production-ready.
- **`verify_jwt = false`** (`config.toml`) — auth enforced in-handler
  (`verifyTeamToken`, `requireTeamAdmin`, `verifyClientToken`), which is correct
  because public routes (submissions, leads) must remain unauthenticated.
- **Authorization:** `/team/invite`, `PATCH`/`DELETE /team/members/:id` now
  require `requireTeamAdmin()`; `/blocks/ai-assist` and `/blocks/copilot-interpret`
  require a valid team token (WS7).

---

## 4. Frontend Readiness

- **Production build:** ✅ `npm run build` (Vite 6.x) succeeded in ~16s.
- **Artifacts:** `dist/index.html` + hashed `dist/assets/*` (code-split routes).
- **Live-mode data integrity:** demo fallbacks are now gated behind
  `canUseDemoFallback()` (true only in demo mode). ClientPortal,
  FullFeaturedDashboard, AnalyticsDashboard, EngagementIntelligence,
  TeamManagement, and SettingsPage render honest error/empty states on a live
  failure instead of fabricating data (WS6).
- **Source maps:** ❌ not generated (Vite default) — production stack traces are
  minified (non-blocking observability gap; request IDs mitigate this server-side).
- **Bundle warnings:** ⚠️ chunks exceed 500 kB — largest `CortexDashboard`
  ≈ 1.23 MB (305 kB gzip), `pdfExport` ≈ 597 kB. Functional; manual chunking
  recommended for load performance.

---

## 5. Supabase Readiness

- **Edge Function deploy:** `npx supabase functions deploy make-server-324f4fbe`.
- **Secrets required at deploy:** `TEAM_ADMIN_EMAIL`, `TEAM_ADMIN_PASSWORD` (both
  required or the admin is not seeded), `OPENAI_API_KEY`, optional `RESEND_API_KEY`
  / `EMAIL_FROM` / `ALLOWED_ORIGINS` / `INTELLIGENCE_*`. `SUPABASE_*` are
  platform-injected.
- **Auth:** email/password via Supabase Auth; admin user seeded idempotently on
  startup **only when configured**. Client access uses server-issued KV session
  tokens.
- **CORS:** set `ALLOWED_ORIGINS` to the deployed origin(s) for production lockdown.
- **RLS expectations:** RLS migrations exist; the live-path store is KV, so
  `cortex.*` RLS is not yet the enforcement boundary — verify post-cutover only.
- **Storage:** no Supabase Storage bucket dependency; PDF export is client-side.

**Live-only verification (cannot run offline):** function reachability, real
`/health`/`/readiness` 200, auth sign-in, RLS enforcement, CORS against the
production origin. Requires Deno + a live Supabase project (both unavailable in
this environment — see Verification Summary).

---

## 6. Vercel Readiness

No `vercel.json` in repo — settings are **manual dashboard configuration**:

| Setting | Value |
|---------|-------|
| Framework preset | Vite |
| Build command | `npm run build` |
| Output directory | `dist` |
| Rewrites | all routes → `/index.html` (SPA) |
| Production env | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (or `_PUBLISHABLE_KEY`), **`VITE_BACKEND_INTEGRATION=true`** |

Set env vars **before** the production build — `VITE_*` values are inlined at
build time.

---

## 7. Deployment Order (evidence-based)

1. **Database migrations** — `npx supabase db push`; confirm with
   `supabase migration list --linked`.
2. **Edge Function secrets** — set `TEAM_ADMIN_EMAIL`, `TEAM_ADMIN_PASSWORD`,
   `OPENAI_API_KEY`, optional `ALLOWED_ORIGINS`, `RESEND_API_KEY`, `EMAIL_FROM`.
3. **Edge Function deploy** — `npx supabase functions deploy make-server-324f4fbe`.
4. **Smoke** — `GET …/ping` → `pong`; authenticated `GET …/readiness` → `200 ready`.
5. **Frontend env** — Vercel prod vars incl. `VITE_BACKEND_INTEGRATION=true`.
6. **Frontend deploy** — Vercel production build (output `dist`).
7. **Health/readiness verification** — `/health` → `{status:"ok"}`; `/readiness` → `ready`.
8. **Run the smoke checklist (§8) end-to-end.**

---

## 8. Production Smoke Checklist

Run against the **live** deployment after §7.

- [ ] **Health** — `GET /health` → `200 {status:"ok", kvStore:"connected"}`
- [ ] **Readiness** — authenticated `GET /readiness` → `200 ready`; not `degraded`/`not_ready`
- [ ] **Correlation** — response carries `X-Request-Id`; a forced error returns generic body + `requestId`, no stack
- [ ] **Admin seed** — with `TEAM_ADMIN_*` set, admin exists exactly once; with them unset, **no** admin is created
- [ ] **Authorization** — non-admin team user gets `403` on `/team/invite`; unauthenticated `/blocks/ai-assist` → `401`
- [ ] **Client** — email verify issues session token; client reads only own report
- [ ] **AI** — narrative/analysis/chat/copilot return real output (requires `OPENAI_API_KEY`); readiness shows real provider, not mock
- [ ] **Feature flags** — `VITE_BACKEND_INTEGRATION=true` confirmed (UI hits backend, not demo data)
- [ ] **No fabricated data** — all counts trace to real KV entries, not seed/demo fixtures

---

## 9. Rollback

| Layer | Procedure | Status |
|-------|-----------|--------|
| **Frontend** | Vercel → promote previous production deployment | ✅ Platform |
| **Edge Function** | Re-deploy previous `make-server-324f4fbe` from prior commit | ✅ Manual, code-based |
| **Migration** | Apply matching script in `supabase/migrations/rollbacks/` | ⚠️ **Partial** — tenancy, migration-infra, diagnostic only |
| **Feature flag** | `VITE_BACKEND_INTEGRATION=false` + rebuild → demo mode | ✅ Build-time |

**Known limitations:** (a) migration rollback coverage is incomplete; (b) frontend
flags are build-time (rollback needs a rebuild); (c) edge rollback is not automated.

---

## 10. Launch Blockers (reconciled)

**Removed:** ~~B1 — Default admin password~~ — **resolved in integrated code**
(WS6 + WS7). `seedAdminUser` fails closed via `resolveAdminSeed()`; no hardcoded
credential path exists.

| # | Blocker | Root cause | Impact | Manual action |
|---|---------|-----------|--------|---------------|
| B2 | **Frontend ships in demo mode** | `VITE_BACKEND_INTEGRATION` defaults `false` | Deployed app never calls the backend | Set `VITE_BACKEND_INTEGRATION=true` in Vercel prod and rebuild |
| B3 | **AI features dark without key** | `OPENAI_API_KEY` unset → `MISSING_CREDENTIALS` | AI features fail at runtime | Set `OPENAI_API_KEY` as an Edge secret (or accept AI-off launch) |

These are **configuration actions**, not code defects. With B2 and B3 actioned,
**deployment can continue.** (If an admin account is required, also set
`TEAM_ADMIN_EMAIL` + `TEAM_ADMIN_PASSWORD` — by design, no admin is seeded otherwise.)

### Can deployment continue? **YES — after manual actions B2, B3 (+ admin secrets if an admin is needed).**

Non-blocking follow-ups: enable source maps; add `vercel.json` + CI; complete
migration rollback coverage; refresh `DEPLOYMENT_GUIDE.md`; manual-chunk large
bundles; distributed rate limiting. Live AI gateway certification is **WS11 (gated)**.

---

## Verification Summary (integration branch)

| Check | Command | Result |
|-------|---------|--------|
| Observability tests | `npm run test:observability` | ✅ 14/14 |
| Intelligence tests | `npm run test:intelligence` | ✅ 8/8 |
| Feature tests | `npm run test:features` | ✅ 72/72 |
| Database tests | `npm run test:database` | ✅ 19/19 |
| Migration tests | `npm run test:migration` | ✅ 36/36 |
| Production build | `npm run build` | ✅ PASS (~16s; chunk-size warnings; no source maps) |
| Manifest validation | typecheck via build | ✅ compiles; **172 entries** (159 LIVE / 8 DEMO / 3 GATED / 2 SYSTEM); no duplicate IDs |
| Git verification | `git status` / branch / ancestry | ✅ clean tree; 4 commits ahead of `origin/main` |

**Total offline automated checks: 149 passing.**

### Checks unavailable in this environment — reported honestly

- **Deno runtime — not installed.** The edge function cannot be executed locally;
  observability/intelligence unit tests run under `node --test` and pass, but a
  live `Deno.serve` boot was not exercised.
- **Live Supabase — unavailable.** No `/health`/`/readiness` 200, no auth sign-in,
  no RLS enforcement, no `supabase migration list --linked`.
- **Live OpenAI — unavailable.** AI gateway certification against a real provider
  is deferred to **WS11 (gated)**.
- **Vercel — unavailable.** Build/deploy and SPA rewrite behaviour not exercised.

---

## Appendix — Documentation Consistency

`DEPLOYMENT_GUIDE.md` remains a **stale generic guide** (references SendGrid,
Calendly, an Express/Node backend) that does not match the actual stack (Supabase
Edge Function + Hono + Resend + client-side PDF). Treat **this report** and
`BATCH_6_CHECKPOINT.md` as authoritative for deployment; `DEPLOYMENT_GUIDE.md`
should be rewritten in a later workstream. WS6 added an authoritative Edge
Function Secrets table to `DEPLOYMENT_GUIDE.md`; the surrounding legacy content
is still stale.
