# MARQ Cortex — Stabilization Batch 6 — Checkpoint

> This checkpoint is authored fresh in this environment. See **Environment
> Reconciliation** below — the resume references in the task prompt
> (`claude/marq-cortex-batch-6-resume-b6t5kc`, commit `b133d36b`, a pre-existing
> `BATCH_6_CHECKPOINT.md`) do **not** exist in this repository. Work proceeded on
> the authorized development branch against the actual repo state.

## Environment Reconciliation (read first)

| Prompt said | Actual in this clone |
|---|---|
| Branch `claude/marq-cortex-batch-6-resume-b6t5kc` | On `claude/marq-cortex-batch-6-ws7-34tkuh` (the authorized dev branch); resume branch absent locally & on origin |
| Current commit `b133d36b` | HEAD was `b25233a0` (`b133d36b` is not a valid object here) |
| Read existing `BATCH_6_CHECKPOINT.md` | File did not exist on disk or anywhere in git history |
| WS1–WS6 complete/gated per prior session | No Batch 6 commits exist in this repo; latest history is Batch 5 (#4) + a hygiene commit (#5) |

**Interpretation:** this is a fresh clone that does not carry prior Batch 6 session
state. Rather than fabricate prior-workstream results, Workstream 7 (a self-contained
security audit of the existing codebase) was executed against the real repo state on
the authorized branch. Prior workstreams were **not** restarted, and Workstreams 8/9/10
were **not** begun.

---

## Workstream 7 — Security & Data Protection

Scope: focused production-readiness security audit of security-relevant code only.
Not a rewrite. Only genuine production risks fixed.

### Status: **COMPLETE**

### Findings

| # | Severity | Area | Finding |
|---|----------|------|---------|
| F1 | **LAUNCH BLOCKER** | Authentication / Demo leak | `seedAdminUser()` created an admin (`admin@marqcortex.com`) with a source-committed default password (`CortexAdmin2026!`) whenever `TEAM_ADMIN_PASSWORD` was unset — including production. The credential is even printed in the registry docs. Anyone reading the repo could log in as team admin. |
| F2 | **HIGH** | Authorization / Privilege escalation | `POST /team/invite`, `PATCH /team/members/:id`, `DELETE /team/members/:id` only checked `verifyTeamToken` (any authenticated team user). A non-admin member (`viewer`/`reviewer`) could self-promote to admin (`PATCH /team/members/{self}` `{teamRole:'admin'}`), mint new admin accounts, or delete colleagues. No server-side role check existed. |
| F3 | **HIGH** | Authorization / AI abuse | `POST /blocks/ai-assist` and `POST /blocks/copilot-interpret` had no auth guard, unlike their siblings `/proposal/section-copilot` and `/ai/chat`. Anyone could invoke paid OpenAI calls (billing/DoS abuse, unauthenticated prompt-injection surface, free LLM proxy). The frontend already sends a team token; the server check was simply omitted. |
| F4 | **MEDIUM** | CORS | `cors({ origin: '*', credentials: true })` — a wildcard origin combined with credentials is invalid per the CORS spec and offers no origin lockdown. |
| F5 | **MEDIUM** | Output safety | Global `app.onError` returned raw `err.message` + `err.name` to clients, disclosing internal error detail. |
| D1 | DOCUMENTATION | Rate limiting | In-memory per-instance limiter (120 req/min/IP) resets on cold start and is not distributed. Already flagged in code; left as-is per "do not invent a new rate limiter." |
| D2 | DOCUMENTATION | Idempotency | `POST /bookings` mints a new id per call — retries create duplicates. Existing/public design; not changed (out of scope). |
| D3 | DOCUMENTATION | Client access | `requireClientAccess` email-fallback grants read to anyone knowing `submissionId` + the submission email (GET only). By design; noted. |

### Verified as already-correct (no change needed)

- **Prompt injection / fact-locking** — `enforceFactLock()` (proposalSectionCopilot.ts)
  deterministically re-injects authoritative fields (`price`, `currency`, `duration`,
  `severity`, `confidence`, `evidence`) server-side *after* the model responds. AI can
  never alter calculations, scores, commercial terms, or business rules. Safety preamble
  also bans invented proof/guarantee language. **Authoritative facts remain locked.**
- **Concurrency / optimistic locking** — block registry PUT rejects stale `baseRev`
  with `409` (`index.tsx` ~2270). No lost updates; conflict detection preserved.
- **Secret management** — no service-role key, OpenAI key, or credential in the frontend
  bundle. `utils/supabase/info.tsx` ships `publicAnonKey = ""` (build-time injected).
  Only the browser-safe anon/publishable key is client-exposed. `.gitignore` covers
  `.env*`. Runtime secrets read via `Deno.env` server-side only.
- **Client session tokens** — `verifyClientToken` enforces 8h TTL, rejects expired,
  cleans them up, and cross-checks `submissionId` (no cross-submission read).

### Fixes applied

**F1 — Fail-closed admin seeding** (`supabase/functions/server/index.tsx`)
- Root cause: demo fallback password used unconditionally, including production.
- Fix: seed only when `TEAM_ADMIN_PASSWORD` is set, or `ALLOW_DEMO_ADMIN=true` is
  explicitly opted in for local demos; otherwise skip seeding with a warning.
- Why this fix: eliminates the well-known credential without needing a "production"
  detector; admin can still be provisioned via env or the Supabase dashboard.
- Regression impact: local/demo setups relying on the built-in password must now set
  `ALLOW_DEMO_ADMIN=true` (documented in `.env.example`). No impact on any deploy that
  already sets `TEAM_ADMIN_PASSWORD`.

**F2 — Server-side admin authorization** (`index.tsx`)
- Root cause: sensitive team-management mutations relied on the frontend to hide them.
- Fix: added `requireTeamAdmin()` (+ `getTeamRole`, `NON_ADMIN_TEAM_ROLES`) and applied
  it to invite / role-change / delete-member. Explicitly non-admin roles
  (`viewer`/`reviewer`/`member`/`client`) get `403`; `admin`/`super_admin` **and
  legacy-unset roles** pass — matching the existing display default `teamRole || 'admin'`.
- Why this fix: closes the exact escalation vector with zero impact on existing admins.
- Regression impact: none for admins; explicitly-lower roles can no longer manage the team
  (intended). Legacy users without a `teamRole` retain access.

**F3 — Team auth on block-AI endpoints** (`index.tsx`)
- Root cause: missing `verifyTeamToken` guard on two AI routes.
- Fix: added the same guard the sibling AI routes already use.
- Why this fix: aligns with intent (code comments say "team auth"); the frontend already
  sends the token via `headers(accessToken)`.
- Regression impact: none — verified `blockAIAssist`/`copilotInterpret` in
  `src/app/lib/api.ts` always pass the access token.

**F4 — CORS allowlist** (`index.tsx`)
- Root cause: permissive default with an invalid `*`+credentials combo.
- Fix: read `ALLOWED_ORIGINS` (comma-separated exact origins). When set → restrict to those
  origins with credentials enabled. When unset → `*` **without** credentials.
- Why this fix: gives production a lockdown lever while preserving current behavior for
  existing deploys (minus the invalid credentialed-wildcard).
- Regression impact: none — no frontend `fetch` uses `credentials:'include'` (Bearer auth).

**F5 — Non-leaking error handler** (`index.tsx`)
- Root cause: verbose error passthrough in the global handler.
- Fix: return a generic `Internal server error` (+ timestamp, path); full detail logged
  server-side only. Scoped to the global unhandled-error handler; per-route validation
  messages left intact.
- Regression impact: minimal — only affects unexpected/unhandled 500s, not normal flows.

**Docs** — updated the two registry notes that advertised the default credentials
(`registryProcesses.ts`, `registryDataExtension.ts`) and documented the new server env
vars (`TEAM_ADMIN_PASSWORD`, `ALLOW_DEMO_ADMIN`, `ALLOWED_ORIGINS`) in `.env.example`.

### Files changed
- `supabase/functions/server/index.tsx` (F1–F5)
- `src/app/utils/registryProcesses.ts` (doc)
- `src/app/utils/registryDataExtension.ts` (doc)
- `.env.example` (doc — server secret env vars)

### Tests / build
| Check | Result |
|---|---|
| `npm run test:intelligence` | ✅ 8/8 pass |
| `npm run test:features` | ✅ 48/48 pass (feature/registry manifest contracts) |
| `npm run test:database` | ✅ 19/19 pass |
| `npm run test:migration` | ✅ 36/36 pass (consistent across 3 runs) |
| `npm run build` (vite production) | ✅ built in ~13s |
| Manifest verification | ✅ no feature-manifest (LIVE/DEMO/GATED) changes; contracts covered by feature tests |
| `git status` | clean after commit |

> Note: an initial `test:migration` run reported 1 failure *before* `npm install`
> completed (missing deps → a test file errored, 31 discovered). After install it is
> a stable 36/36. `test:smoke` (Playwright E2E) was not run — it needs a live
> dev server/backend and does not exercise the changed edge-function surface.

### Risks / notes
- F2 admin gate intentionally treats legacy-unset `teamRole` as admin to avoid locking
  out manually-created users; if a stricter model is desired later, seed explicit roles.
- Rate limiter remains in-memory/per-instance (D1) — acceptable for now, not distributed.
- Booking idempotency (D2) unchanged — revisit if duplicate bookings become an issue.

### Remaining work (NOT started — do not begin)
- Workstream 8 — NOT STARTED
- Workstream 9 — NOT STARTED
- Workstream 10 — FINAL RECONCILIATION
- Gated Feature Certification — pending
- Workstreams 2/3/4 remain GATED on external prerequisites; WS5 DEFERRED (roadmap).

**MARQ Cortex Stabilization is NOT complete.**
