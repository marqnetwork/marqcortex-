# MARQ Cortex — Stabilization Batch 6 Checkpoint

_Last updated: 2026-07-19 · Workstream 8 (Observability & Operational Readiness)_

> This checkpoint was reconstructed from Git evidence — no prior
> `BATCH_6_CHECKPOINT.md` existed. Earlier workstream narrative is carried
> forward from the intended status; it is **not** re-verified line-by-line here
> because no Batch 6 code had been committed before this workstream (the branch
> was fresh from `main`).

---

## 1. Environment reconciliation (recovered from Git)

- **Branch:** `claude/marq-cortex-batch-6-ws8-y0y1zf`
- **Base at session start:** `b25233a0` (identical to `origin/main` HEAD —
  `chore: untrack node_modules, dist, and test-results (#5)`).
- **Reflog confirmed:** branch was checked out fresh from `b25233a0`; **zero**
  prior Batch 6 commits, clean working tree, no checkpoint file.
- **Conclusion:** Workstream 8 is the **first** committed Batch 6 work on this
  branch. Nothing to resume mid-flight; nothing to un-repeat.

### Workstream status (confirmed against repo where evidence exists)

| WS | Status | Evidence |
|----|--------|----------|
| 1 | COMPLETE | (carried forward) |
| 2 | GATED — awaiting final certification | Intelligence Gateway present; providers `Unverified`/`Testing` (`certification.ts`, `providerRegistry.ts`) |
| 3 | GATED — awaiting final certification | (carried forward) |
| 4 | GATED — awaiting final certification | (carried forward) |
| 5 | DEFERRED / roadmap-paced | (carried forward) |
| 6 | COMPLETE | KV-backed features LIVE (Batch 4/5 commits, manifest notes) |
| 7 | COMPLETE | (carried forward) |
| **8** | **THIS WORKSTREAM — implemented, tests green, awaiting deploy** | this checkpoint |
| 9 | NOT STARTED | — |
| 10 | FINAL RECONCILIATION — NOT STARTED | — |

---

## 2. Audit findings & classification

| # | Finding | Class | Disposition |
|---|---------|-------|-------------|
| F1 | No request/correlation id — a client-visible error could not be tied to a server log line. | HIGH | **Fixed** (middleware + helper) |
| F2 | Global `onError` leaked internal error message/name/stack to clients. | HIGH | **Fixed** (generic response + internal-only detail, keyed by request id) |
| F3 | No operator readiness view — `/health` only checks KV; provider credentials, active provider, mock-in-prod, and AI telemetry were invisible even though helper functions existed but were unwired. | HIGH | **Fixed** (`GET /readiness`) |
| F4 | Mock provider fabricated token usage `{10,20,30}`, recorded into telemetry as if real. | MEDIUM | **Fixed** (mock reports no usage) |
| F5 | Mock provider could run in production with no signal. | MEDIUM | **Fixed** (readiness reports `mockProviderActive` + `degraded`) |
| F6 | No operational runbook; "what is/ isn't monitored" undocumented. | DOCUMENTATION ONLY | **Fixed** (`OBSERVABILITY_RUNBOOK.md`) |
| F7 | Per-endpoint handlers still interpolate raw `err` into client JSON (`c.json({error: \`…: ${err}\`})`, ~dozens of routes). Information disclosure, but not launch-blocking; mass-editing ~60 handlers is a refactor outside this workstream's "no architecture rewrite / don't split the monolith" constraint. | MEDIUM | **Documented, deferred** — recommend a follow-up sweep (small shared error-response helper) in a later workstream. Global `onError` (F2) already contains the worst-case catch-all. |
| F8 | In-memory per-IP rate limiter is per-instance and resets on cold start. | LOW | **Documented** (runbook §9). Explicitly out of scope ("do not redesign these systems"). |
| F9 | Startup log prints service-role key **length**. | LOW | **Confirmed acceptable** — length only, never the value; left as-is. |

### Per-code-fix detail

**F1 — Request/correlation id**
- Root cause: no id assigned or propagated by any middleware.
- Operational risk: incidents untraceable; support cannot correlate a client
  error to a log line.
- Minimal fix: `observability/requestContext.ts` (`resolveRequestId` /
  `isValidClientRequestId`) + one `app.use('*')` middleware. Reuses a
  caller-supplied `X-Request-Id`/`X-Correlation-Id` only if it matches
  `[A-Za-z0-9._-]{1,128}` (anti log-injection), else mints a UUID. Echoed via
  `X-Request-Id`.
- Regression impact: additive middleware; sets a response header + context var.
  No existing route behavior changed.
- Verified: `test:observability` (id validation/uniqueness/echo).

**F2 — Error visibility**
- Root cause: `onError` returned `Server error: ${err.message}` + `errorType`.
- Operational risk: internal error text/stack shape leaked to clients.
- Minimal fix: log full detail server-side (`requestId method path name message`
  + stack); return generic `{error:"Internal server error.", requestId, timestamp}`.
- Regression impact: clients relying on the raw message no longer receive it by
  design; status code unchanged (500). Front-end already treats non-2xx
  generically.
- Verified: code review; build green; existing feature tests unaffected.

**F3 — Readiness endpoint**
- Root cause: `checkAllProviderHealth`/`getRecentTelemetry`/`listProviders`/
  `getIntelligenceConfig` existed but were never surfaced.
- Operational risk: operators could not tell if the server was production-ready
  (missing secret, unreachable KV, missing AI credentials, mock active).
- Minimal fix: pure `observability/readiness.ts` builder + `GET /readiness`
  (team-auth) that gathers config-presence booleans, a KV round-trip, and
  intelligence provider health, then returns an honest, **secret-free** report.
  Returns `503` when `not_ready`.
- Regression impact: new route only. No secret values in output (test-asserted).
- Verified: `test:observability` (8 readiness cases incl. secret-free assertion).

**F4/F5 — Honest AI telemetry**
- Root cause: mock provider returned hard-coded `usage`.
- Operational risk: fabricated token counts in telemetry; mock could run silently.
- Minimal fix: mock returns `usage: undefined`; readiness flags
  `mockProviderActive` and marks intelligence `degraded`.
- Regression impact: none — no test asserted on the fabricated counts (verified
  by grep); intelligence suite still 8/8.
- Verified: `test:intelligence` + `test:observability`.

---

## 3. Confirmed existing protections (no change needed)

- No secret **values** logged — startup logs `Set/MISSING` (+ length for
  service-role key only).
- No full prompts/responses logged — only truncated (~60-char) snippets + lengths.
- Intelligence errors carry typed `errorCode` and a `[intelligence]` prefix,
  distinguishing provider failures from application failures.
- `MISSING_CREDENTIALS` surfaces as a configuration failure (openai adapter +
  `normalizeUnknownError`).
- `/health` performs a **real** KV round-trip (honest liveness).
- `/email/status` honestly reports Resend configuration.
- Migration reconciliation persists drift counts + checksums to
  `migration_reconciliation_log`; record **contents** are never dumped; KV is
  authoritative and **no SQL cutover is claimed** (manifest-consistent).
- AI retries are bounded by `INTELLIGENCE_MAX_RETRIES`; each attempt is recorded.

---

## 4. Files changed

**Added**
- `supabase/functions/server/observability/requestContext.ts`
- `supabase/functions/server/observability/requestContext.test.ts`
- `supabase/functions/server/observability/readiness.ts`
- `supabase/functions/server/observability/readiness.test.ts`
- `OBSERVABILITY_RUNBOOK.md`
- `BATCH_6_CHECKPOINT.md` (this file)

**Modified**
- `supabase/functions/server/index.tsx` — request-id middleware; hardened
  `onError`; new `GET /readiness`; typed Hono `Variables`; observability imports.
- `supabase/functions/server/intelligence/providers/mockProvider.ts` — stop
  fabricating token usage.
- `package.json` — added `test:observability` script.

**Deleted:** none.

---

## 5. Tests & build results

| Check | Result |
|-------|--------|
| `npm run test:observability` | **14 pass / 0 fail** (new) |
| `npm run test:intelligence` | 8 pass / 0 fail |
| `npm run test:features` | 48 pass / 0 fail |
| `npm run test:migration` | 36 pass / 0 fail |
| `npm run test:database` (static) | 19 pass / 0 fail |
| `npm run build` (vite production) | ✅ built |

Total: **125 unit/static tests pass, 0 fail.** Production build succeeds.

---

## 6. Unavailable checks (stated honestly — not claimed as passed)

- **Deno / live Edge runtime:** Deno is not installed in this environment, so
  `index.tsx` (Hono/Deno) was **not** executed or type-checked by Deno. Verified
  via targeted code review + typed Hono `Variables` for deploy-time safety. Pure
  helpers (`requestContext.ts`, `readiness.ts`) are fully unit-tested under Node.
- **Live Supabase / KV / SQL:** no live project reachable; `/health`,
  `/readiness`, and live DB RLS tests were **not** exercised against a real
  backend. Reconciliation/drift telemetry was inspected, not run live.
- **`test:smoke` (Playwright):** requires a running app + backend; not run.
- No live AI provider call was made (no `OPENAI_API_KEY` here).

---

## 7. Remaining risks

- F7 (per-endpoint raw-error interpolation) remains in individual handlers;
  worst-case is covered by the hardened global `onError`, but a follow-up sweep
  is recommended.
- Readiness/health honesty depends on live behavior that could not be exercised
  here; validate against a real deployment during Workstream 10.
- Rate limiter remains per-instance (documented, intentionally not redesigned).

---

## 8. Manual deployment / configuration actions required

1. Deploy the edge function: `npm run supabase:deploy`.
2. Ensure secrets set in Supabase → Edge Functions → Secrets:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` (required);
   `OPENAI_API_KEY` (AI), `RESEND_API_KEY` (email).
3. Confirm `INTELLIGENCE_PROVIDER` is **unset or `openai`** (never `mock`) in prod.
4. Post-deploy, hit `GET /readiness` (team-auth) and confirm `status:"ready"`.

---

## 9. Exact next workstream

**Workstream 9 — NOT STARTED (do not begin).** Then Workstream 10 (Final
Reconciliation) and Gated Feature Certification (WS 2/3/4) remain.

> MARQ Cortex Stabilization is **not** complete.
