# MARQ Cortex — Observability & Operational Runbook

_Workstream 8 (Stabilization Batch 6). Scope: the existing edge-function
backend (`supabase/functions/server`), the Intelligence Gateway, the KV storage
layer, and the migration/reconciliation tooling. This document describes what is
**actually** in the repository — it does not claim external dashboards, alerting,
or APM that do not exist here._

---

## 1. Platform at a glance

| Concern | Reality in this repo |
|---|---|
| Backend runtime | Single Supabase Edge Function (Deno/Hono): `supabase/functions/server/index.tsx` (monolithic, ~4.1k lines). Deployed as `make-server-324f4fbe`. |
| Authoritative datastore | **KV** (`kv_store_324f4fbe` table via `kv_store.tsx`). SQL/`leads` tables exist but **KV remains authoritative — no runtime cutover has occurred** (see manifest notes and `migration/` tooling). |
| AI | Intelligence Gateway (`intelligence/`) with an OpenAI HTTP adapter and a deterministic mock provider. Default active provider: `openai`. |
| Email | Resend, optional (`emailService.ts`). Absent key ⇒ emails are logged, not sent. |
| Logs | `console.*` captured by Supabase Edge Function logs. **There is no external log aggregator, metrics store, tracing backend, or alerting configured in this repo.** |

**What is NOT monitored (be honest about this):** there are no dashboards, no
uptime checks, no metric time-series, no alert rules, and no error-tracking
service (e.g. Sentry) wired up. Observability today = structured `console`
logs + the pull-based endpoints below. Any alerting is manual (operator reads
Supabase logs / hits the endpoints).

---

## 2. What is logged

All server logs go to `console.*` and are visible in **Supabase Dashboard →
Edge Functions → `make-server-324f4fbe` → Logs**.

- **Request lifecycle:** every request is logged in/out with method + URL and
  duration (`🔵 Incoming …` / `✅ Completed … in Nms`), plus Hono's built-in
  logger.
- **Correlation id:** every request is assigned a request id (see §4). It is
  attached to the `X-Request-Id` response header and included in unhandled-error
  logs.
- **Intelligence Gateway telemetry:** every AI attempt logs
  `[intelligence] <outcome> feature=… provider=… model=… requestId=… attempt=… latencyMs=…`
  (`intelligence/telemetry.ts`). Buffered in-memory (last 200 records).
- **Auth outcomes, KV fetch counts, email send/skip, rate-limit hits** are logged.

**What is deliberately NOT logged (confirmed protections):**
- No secret **values**. Startup logs only whether each secret is `Set`/`MISSING`
  (service-role key logs its length only, never the value).
- No full AI prompts or responses. AI logs include only truncated (~60-char)
  user-input snippets and content lengths, never the full prompt/response body.
- No raw `Authorization` headers, passwords, or API keys.
- Unhandled errors return a **generic** client response; full error detail
  (name/message/stack) is logged server-side only, keyed by request id.

---

## 3. Health vs readiness

Two distinct, honest endpoints:

### Liveness — `GET /make-server-324f4fbe/health` (public)
Returns `200 {status:"ok", kvStore:"connected"}` after a real KV round-trip
(`set`→`get`→`del`). Use this for "is the function up and can it reach KV".
Also: `GET /make-server-324f4fbe/ping` for a dependency-free liveness ping.

### Readiness — `GET /make-server-324f4fbe/readiness` (team auth required)
Added in Workstream 8. Honestly reports whether the server is ready to serve
production traffic, **without exposing any secret value** (booleans only).
Returns HTTP `503` when `status:"not_ready"`, otherwise `200`.

Shape:
```jsonc
{
  "requestId": "…",
  "status": "ready | degraded | not_ready",
  "liveness": "ok",
  "warnings": ["…"],
  "dependencies": {
    "config":       { "status": "ok|failed", "requiredSecretsPresent": true,
                      "present": { "supabaseUrl": true, "serviceRoleKey": true, "anonKey": true },
                      "missing": [] },
    "kv":           { "status": "ok|degraded|failed" },
    "intelligence": { "status": "ok|degraded|failed", "activeProvider": "openai",
                      "credentialsConfigured": true, "mockProviderActive": false,
                      "providers": [ … ], "recent": { "total": 12, "errors": 0 } }
  },
  "integrations": { "email": { "status": "ok|not_configured" } }
}
```

Interpretation:
- **`config.status:"failed"`** ⇒ a required secret is missing (see `missing[]`).
  The server cannot function correctly. **Launch blocker.**
- **`kv.status:"failed"`** ⇒ KV round-trip failed; the authoritative datastore
  is unreachable. **Launch blocker.**
- **`intelligence.status:"failed"`** ⇒ the active real provider has no
  credentials → AI features will error. Fix `OPENAI_API_KEY`.
- **`intelligence.mockProviderActive:true`** ⇒ the **mock** provider is active;
  AI output is synthetic. Readiness is reported `degraded` so this can never run
  silently in production.
- **`integrations.email.status:"not_configured"`** ⇒ optional; email is logged
  but not delivered. Does not affect readiness (warning only).

---

## 4. Tracing an incident with a request id

1. Every response carries an `X-Request-Id` header. Ask the reporter (or read
   the client error body's `requestId`) for that value.
2. In Supabase Edge Function logs, search for that id. Unhandled errors log
   `❌ UNHANDLED ERROR requestId=<id> method=… path=… name=… message=…`.
3. A caller may supply their own id via `X-Request-Id` / `X-Correlation-Id`; it
   is honored **only** if it matches `[A-Za-z0-9._-]{1,128}` (otherwise a fresh
   UUID is minted). This prevents log injection and secret smuggling.

---

## 5. Verifying AI provider readiness

- Hit `GET /readiness` (team auth) and read `dependencies.intelligence`.
- `credentialsConfigured:false` for provider `openai` ⇒ set `OPENAI_API_KEY` in
  **Supabase → Edge Functions → Secrets**.
- `mockProviderActive:true` ⇒ `INTELLIGENCE_PROVIDER` is set to `mock`. Set it to
  `openai` (or unset — default is `openai`) for production.
- `recent.errors` rising vs `recent.total` ⇒ inspect
  `[intelligence] error …` log lines for `errorCode` (`MISSING_CREDENTIALS`,
  `RATE_LIMITED`, `TIMEOUT`, `PROVIDER_UNAVAILABLE`, `INVALID_OUTPUT`, …).
- Provider failures are distinguishable from application failures via the
  `[intelligence]` prefix and the typed `errorCode`.
- **Token usage:** only recorded when the provider actually returns it. The mock
  provider reports **no** usage — no fabricated token counts are ever recorded.

---

## 6. Verifying storage authority & drift status

- **Authority:** KV is authoritative. There has been **no SQL cutover**. Do not
  interpret the presence of `leads`/`contacts` SQL tables as a live cutover.
- **Migration/reconciliation is a CLI tool, not a live request-path shadow read:**
  `scripts/migration/cli.ts` (`npm run migration:*`). It reads KV read-only and
  writes SQL only in backfill/rollback modes.
- **Drift visibility:** `migration:reconcile` computes source/target counts,
  missing/duplicate/unclassified counts, and source/target checksums, and
  persists them to `migration_reconciliation_log` (`migration/reconciliation.ts`).
  `thresholdPassed` is `true` only when `missing==0 && mismatch==0 && unclassified==0`.
  Reconciliation records are stored — drift does not fail silently — and record
  **contents are never dumped**; only counts, safe keys, and checksums are logged.
- Per-run progress and error summaries are in `migration_runs`
  (`migration/telemetry.ts`), capped at 50 error-summary entries per run.

---

## 7. Identifying configuration failures

- Startup logs print `✅ Environment variables check:` with `Set`/`MISSING` per
  required secret.
- `GET /readiness` → `dependencies.config.missing[]` lists any missing required
  secret by env-var name (no values).
- `GET /make-server-324f4fbe/email/status` (team auth) reports whether Resend is
  configured.

Required secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`.
Optional: `OPENAI_API_KEY` (AI), `RESEND_API_KEY` (email).
Tunables: `INTELLIGENCE_PROVIDER`, `INTELLIGENCE_TIMEOUT_MS`,
`INTELLIGENCE_MAX_RETRIES`, `INTELLIGENCE_RETRY_DELAY_MS`,
`INTELLIGENCE_USE_GATEWAY_*`, `INTELLIGENCE_MODEL_*`.

---

## 8. Diagnosing common production failures

| Symptom | Likely cause | Action |
|---|---|---|
| `503` from `/readiness`, `config.failed` | Missing required secret | Add it in Supabase Edge Function Secrets; redeploy not required for env. |
| Client gets generic `Internal server error` + `requestId` | Unhandled server error | Search logs for the `requestId` (§4). |
| AI endpoints return credential errors | `OPENAI_API_KEY` missing | Set the key; confirm via `/readiness`. |
| AI output looks synthetic/"Mock …" | `INTELLIGENCE_PROVIDER=mock` | Set to `openai`; `/readiness` will show `mockProviderActive`. |
| Emails not arriving | `RESEND_API_KEY` missing | `/email/status`; set the key. |
| `429 Too many requests` | In-memory per-IP rate limit (120/min) | Expected under burst; limiter resets on cold start (not distributed). |
| KV errors in `/health` or `/readiness` | KV table/permissions issue | Check Supabase DB + service-role key. |

---

## 9. Rate limiting, retries & failure visibility

- **Rate limit:** in-memory per-IP, 120 req/min (`index.tsx`). Exceed ⇒ `429` and
  a `🚫 Rate limit exceeded …` log. Response carries `X-RateLimit-*` headers.
  Note: in-memory ⇒ per-instance, resets on cold start (documented, not
  redesigned in this workstream).
- **AI retries:** bounded by `INTELLIGENCE_MAX_RETRIES` (default 1 ⇒ max 2
  attempts). Each attempt is recorded in telemetry with its `attempt` number;
  exhausted retries surface the final typed `errorCode`. Non-retryable errors
  (e.g. `MISSING_CREDENTIALS`, `INVALID_OUTPUT`) are not retried.
- **Optimistic-lock conflicts** (block registry) return `409` for the client to
  reload/reconcile.

---

## 10. What requires manual operator action

- Setting/rotating secrets (`OPENAI_API_KEY`, `RESEND_API_KEY`, Supabase keys).
- Toggling `INTELLIGENCE_PROVIDER` away from `mock` before production.
- Running migration/reconciliation CLI and reviewing `migration_reconciliation_log`.
- Reading Supabase Edge logs — there is no alerting; nobody is paged
  automatically.

## 11. Rollback & recovery (where already supported)

- **DB migrations:** rollback SQL scripts exist under
  `supabase/migrations/rollbacks/`.
- **Data migration:** `npm run migration:backfill` / `migration:reconcile`;
  rollback mode via `migration/rollback.ts`.
- **Edge function:** redeploy a previous known-good build with
  `npm run supabase:deploy` (`supabase functions deploy make-server-324f4fbe`).

---

_This runbook reflects repository state as of Stabilization Batch 6 / Workstream 8.
It intentionally makes no claim of external monitoring, alerting, or dashboards,
because none are configured in this repository._
