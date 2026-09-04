# MARQ Cortex — Autonomous Build Progress

**This file is the RESUME AUTHORITY for autonomous development.** The repository
and this checkpoint override any baseline stated in a session prompt. Read it,
verify against the repository, and resume from **NEXT EXACT TASK**.

Companion authorities, unchanged by this file:

- `MARQ_CORTEX_ROADMAP.md` — sprint and batch status.
- `architecture/ai/AI-01-BATCH-*-COMPLETION.md` — what each batch delivered.
- `ARCHITECT.md` — the current architecture of record.

---

## CURRENT ROADMAP STAGE

Phase 6 — AI Platform. AI-01 Batch 4 (provider estate) complete through 4F.

## CURRENT BATCH

**AI-01 Batch 4F — Routing, Failover and Economics.** Code complete, verified
locally, committed on the development branch. Not merged.

## COMPLETED THIS SESSION

- `supabase/functions/server/ai/routing/` — the Routing Authority. Contracts,
  the deterministic ordering policy with its four invariants, the economics
  arithmetic, and a bounded operational ledger.
- `providers/selector.ts` — eligibility pass kept whole and unchanged; routing
  layered on its answer. New `route()` returns the decision with its economics;
  `select()` keeps its contract.
- `pipeline/executionPipeline.ts` — routes through the decision, and enforces a
  per-request **billable attempt budget**. Closes the defect where the spend
  guard reserved `maxAttempts` per request while the loop granted `maxAttempts`
  to every failover candidate.
- Governance: `routing.strategy` (demands `ai.admin.provider.write`) and
  `routing.maxProviders` (demands `ai.admin.settings.write`) as settings-overlay
  fields, normalised, envelope-capped by `AI_ROUTING_MAX_PROVIDERS`, audited.
  No routing write path exists — `/ai/admin/routing` is a GET.
- Observability: three metrics, two events, a warn log, and richer
  `NO_PROVIDER_AVAILABLE` diagnostics.
- Console: a **Routing** tab (`src/app/components/RoutingPanel.tsx`).
- Docs: `architecture/ai/AI-01-BATCH-4F-COMPLETION.md`, `ARCHITECT.md` §12.7,
  `MARQ_CORTEX_ROADMAP.md`.

## COMMITS CREATED

On `claude/marq-cortex-batch-4f-c1hmm0`, from `b13d3a3`:

1. `feat(ai): a routing policy that orders what it is given and admits nothing`
2. `feat(ai): a request may not spend more paid attempts than were reserved for it`

## TEST RESULTS

| Suite | Result |
|---|---|
| `npm run verify:4f` | 167 pass, 0 fail |
| `npm run test:ai` | 2,183 pass, 0 fail |
| `npm run test:security` | 859 pass, 0 fail |
| `npm run test:features` | 717 pass, 0 fail |
| `npm run test:system` | 170 pass, 0 fail |
| `npm run scan:boundaries` | 107 pass, 0 fail |
| `npm run typecheck:api:ai` | clean (deno check) |
| `npm run typecheck:web` | 34 errors — identical to the pre-batch baseline, none in any file this batch touches |
| `npm run typecheck:tests` | 29 errors — identical to the pre-batch baseline |
| `npm run build` | clean |

No test was weakened, skipped or deleted. The two suites pinning the certified
105,920 µUSD budget invariant pass unmodified. No test reaches a real provider.

## KNOWN NON-BLOCKING ISSUES

- 34 pre-existing `typecheck:web` errors and 29 pre-existing `typecheck:tests`
  errors, all in files unrelated to the AI platform (proposal viewer, snapshot
  engine, mapping engine, mock data, migration domains, workflow expression
  validation). Present at `b13d3a3`; unchanged by this work. Worth a cleanup
  sprint before the UI/UX stage.
- `npm run typecheck:api:ai` needs Deno on PATH (`npm i -g deno`). The
  environment does not ship it.
- Geographic and compliance routing are named in the reference architecture and
  have no data model yet (no region on a provider configuration, no residency
  policy on an organization). Deliberately not invented in 4F.

## CURRENT BRANCH

`claude/marq-cortex-batch-4f-c1hmm0` — pushed. Not merged into `main`.

## NEXT EXACT TASK

Open the AI-01 Batch 4G slice: **per-organization routing and residency inputs**
only if the product documentation supplies a data model for them; otherwise
proceed to the next documented AI-01 work and then to Phase 4 (`MCV2-S7.4`,
Outcome Shadow Read), which the roadmap still marks **in progress** and which is
the oldest open sprint in the file.

Before starting, re-read `MARQ_CORTEX_ROADMAP.md` — it is the sprint authority —
and confirm nothing merged into `main` ahead of this branch.

## BLOCKERS

None. No task in this batch was blocked.

## PRODUCTION WORK DEFERRED

- **Batch 4E production rollout** — deferred to final production hardening, as
  recorded before this session. Untouched by 4F.
- **Batch 4C/4D production gates** — applying the provider-administration and
  BYOK migrations and setting `AI_CREDENTIAL_ENCRYPTION_KEY` still require human
  authorisation. Untouched by 4F.
- **Batch 4F needs no production action.** No migration, no secret, no required
  environment variable. `AI_ROUTING_STRATEGY` defaults to `preference` (the
  pre-4F order exactly) and `AI_ROUTING_MAX_PROVIDERS` defaults to 3.
- `AI_ALLOW_REAL_REQUESTS` was not changed by this work.

---

_Last updated: 2026-09-04, after AI-01 Batch 4F._
