# MARQ Cortex — Stabilization Batch 6 Checkpoint

**Branch:** `claude/marq-cortex-batch-6-ws9-inkm86`
**Last updated:** 2026-07-19 (WS9)

> **State recovery note.** No prior `BATCH_6_CHECKPOINT.md` existed in the
> repository and the branch tip carried no Batch 6 commits (tip was the Batch 5
> merge `d151ce82` + hygiene commit `b25233a0`). Per instructions, state was
> recovered from Git and repository evidence only; stale references were ignored.
> This file is created by WS9 and records the authoritative Batch 6 status going
> forward. WS9 did **not** restart Batch 6 or repeat earlier workstreams.

---

## Workstream Status

| WS | Title | Status |
|----|-------|--------|
| WS1 | — | ✓ Complete |
| WS2 | — | Gated (Pending Final Certification) |
| WS3 | — | Gated (Pending Final Certification) |
| WS4 | — | Gated (Pending Final Certification) |
| WS5 | — | Deferred (Roadmap) |
| WS6 | — | ✓ Complete |
| WS7 | — | ✓ Complete |
| WS8 | — | ✓ Complete |
| **WS9** | **Deployment & Production Readiness** | **✓ COMPLETE (this checkpoint)** |
| WS10 | Final Reconciliation | Not started |
| WS11 | Gated Feature Certification | Not started |

---

## WS9 — Deployment & Production Readiness

**Deliverable:** `DEPLOYMENT_READINESS_REPORT.md` (full audit).
**Overall readiness:** **READY WITH MANUAL ACTIONS.**

### Deployment findings

- **Frontend** builds cleanly (Vite 6.3.5, ~11s); SPA artifacts in `dist/`.
  Hash routing verified by E2E smoke. **No source maps** generated; large chunks
  (`CortexDashboard` ≈ 1.23 MB) trigger bundle warnings.
- **Backend** is a Supabase Edge Function (`make-server-324f4fbe`) — Hono app,
  79 routes, `Deno.serve(app.fetch)`. **Health** endpoint present (`/health`,
  KV round-trip); **no readiness endpoint**. Startup logs missing secrets but
  **does not fail-closed**. `verify_jwt=false` with in-handler auth (correct for
  public routes).
- **Database:** 8 timestamp-ordered migrations, no gaps. **KV remains
  authoritative; SQL cutover NOT performed** (Phase 5 pending, per `ARCHITECT.md`).
  Applied-vs-unapplied state is a live-only check. Rollback scripts cover 3 of 8
  migrations (partial).
- **Env vars:** fully inventoried and classified (see report §1). Naming is
  consistent; `.env.example` documents frontend `VITE_*` but omits backend
  secrets. No secret values exposed.
- **Supabase/Vercel:** no `vercel.json`, no CI — build/secret wiring is manual
  dashboard configuration. Deployment order produced from evidence (report §7).

### Launch blockers (configuration, not code)

| # | Blocker | Manual action |
|---|---------|---------------|
| B1 | `TEAM_ADMIN_PASSWORD` falls back to hardcoded `CortexAdmin2026!` | Set strong secret before first deploy |
| B2 | `VITE_BACKEND_INTEGRATION` defaults `false` (frontend runs demo-only) | Set `=true` in Vercel prod + rebuild |
| B3 | `OPENAI_API_KEY` unset → AI features throw `MISSING_CREDENTIALS` | Set Edge secret (or accept AI-off launch) |

**Can deployment continue? YES — after B1, B2, B3.**

### Manual actions (deploy)

1. `supabase db push` → confirm `supabase migration list --linked`.
2. Set Edge secrets: `TEAM_ADMIN_EMAIL`, `TEAM_ADMIN_PASSWORD`, `OPENAI_API_KEY`,
   `RESEND_API_KEY`, `EMAIL_FROM`.
3. `supabase functions deploy make-server-324f4fbe`; smoke `/ping`.
4. Set Vercel prod env incl. `VITE_BACKEND_INTEGRATION=true`; deploy (`dist`).
5. Verify `/health` → `{status:"ok", kvStore:"connected"}`.
6. Run production smoke checklist (report §8).

### Deployment checklist → see `DEPLOYMENT_READINESS_REPORT.md` §7–§8
### Rollback checklist → see `DEPLOYMENT_READINESS_REPORT.md` §9

Frontend rollback: promote previous Vercel deployment. Edge rollback: redeploy
prior commit's function. Migration rollback: partial scripts in
`supabase/migrations/rollbacks/`. Feature-flag rollback: `VITE_BACKEND_INTEGRATION=false`
+ rebuild (build-time flag → requires rebuild, not runtime toggle).

### Files changed (WS9)

- **Created:** `DEPLOYMENT_READINESS_REPORT.md`
- **Created:** `BATCH_6_CHECKPOINT.md` (this file)
- No product source modified — WS9 is an audit.

### Tests (WS9 verification run)

| Suite | Result |
|-------|--------|
| `npm run build` | ✅ PASS (~11s, chunk warnings, no source maps) |
| `npm run test:intelligence` | ✅ 8/8 |
| `npm run test:features` | ✅ 48/48 |
| `npm run test:database` | ✅ 19/19 |
| `npm run test:migration` | ✅ 36/36 |
| `npx playwright test` (demo E2E) | ✅ 1/1 |
| **Total** | **112 offline checks passing** |

**Unavailable (live infra required, reported honestly):** live `/health`,
Supabase auth/RLS/CORS/storage, applied-migration list, live AI certification
(WS11), `migration:validate-s6.3` fixture run, Vercel build/deploy.

### Build

`dist/index.html` + hashed `dist/assets/*`. Largest chunks: `CortexDashboard`
1.23 MB (304 kB gz), `pdfExport` 597 kB (178 kB gz).

### Remaining work (Batch 6)

- **WS10 — Final Reconciliation** (not started; do not begin here).
- **WS11 — Gated Feature Certification** (WS2/WS3/WS4 gated; AI provider
  registered `Unverified`).
- Non-blocking hardening: `/readiness` endpoint, source maps, `vercel.json` + CI,
  complete migration rollback coverage, refresh stale `DEPLOYMENT_GUIDE.md`,
  bundle manual-chunking, distributed rate limiting, fail-closed startup.

---

**WS9 COMPLETE.** Batch 6 is **not** complete — WS10 and WS11 remain.
