# CHANGELOG (AI OS) — MARQ Cortex

Reverse-chronological log of AI-executed stabilization batches.

## Batch 2 — Shadow Read & Backend Cutover Preparation (2026-07-18)

Branch: `claude/marq-cortex-batch-2-37n7pe`

**Added — Runtime Storage Gateway** (`supabase/functions/server/runtime/`)

- `shadowRead` primitive: returns the KV authority value unchanged; when a
  domain's flag is enabled, additionally reads the SQL repository, compares via
  domain projectors, and emits a `DriftReport`. Shadow errors are swallowed and
  reported — never propagated (no-regression guarantee).
- `diffProjections` + projectors for outcome / lead / submission.
- Env-flag config (`SHADOW_READ_ENABLED` + `SHADOW_READ_OUTCOMES` /
  `_LEADS` / `_SUBMISSIONS`), all default `false`. `RUNTIME_STORAGE_AUTHORITY`
  remains `'kv'`.

**Wired — read routes** (`supabase/functions/server/index.tsx`)

- `GET /submissions/:id/outcome` → `shadowReadOutcome` (S7.4)
- `POST /leads/exit-intent` → `shadowReadLeadByEmail` (S7.6)
- `GET /submissions/:id` → `shadowReadSubmission` (S7.7)

Each call is best-effort and flag-gated OFF; response shapes are unchanged.

**Tests**

- `tests/runtime/shadowRead.test.ts` (+`npm run test:runtime`): authority
  preservation, disabled-no-call, drift detection, presence mismatch,
  shadow-error isolation, projector normalization. 9/9 pass.
- Regression: intelligence 8/8, migration 36/36, database 19/19, runtime 9/9
  (72 total, 0 fail). `vite build` green.

**Docs**

- Created `docs/ai/` tracking set (this file, `ACTIVE_WORK.md`,
  `STABILIZATION.md`, `STABILIZATION_INVENTORY.md`).
- `MARQ_CORTEX_ROADMAP.md.txt`: S7.4–S7.8 status updated.

**Not done (by design)**

- No demo implementation replaced; no feature flag removed; no Batch 3 work.
- Live-data drift observation (flags ON against deployed Supabase) is an
  operational step tracked as a remaining risk.

## Batch 1 — Supabase config + backend read path (prior)

Recorded in git history (pre-`docs/ai/`): Supabase config repointed to project
`oqybniefkbppptfatoae`; diagnostic PDF/oklch persistence fix; TeamHomeDashboard
reads live submissions in backend mode. Closed.
