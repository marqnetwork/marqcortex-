# MARQ Cortex — Autonomous Build Progress

**This file is the RESUME AUTHORITY for autonomous development.** The repository
and this checkpoint override any baseline stated in a session prompt. Read it,
verify against the repository, and resume from **NEXT EXACT TASK**.

Companion authorities, unchanged by this file:

- `MARQ_CORTEX_ROADMAP.md` — sprint and batch status.
- `architecture/ai/AI-01-BATCH-*-COMPLETION.md` and
  `architecture/database/MCV2-*-COMPLETION.md` — what each unit delivered.
- `ARCHITECT.md` — the current architecture of record.

---

## CURRENT ROADMAP STAGE

Phase 6 — AI Platform: AI-01 Batch 4 complete through 4F.
Phase 4 — Runtime Storage Gateway: shadow read delivered for the two domains
that have runtime reads; Phase 2 backfill delivered for the submission domain.

## CURRENT BATCH

None in flight. Four units completed this session, all committed and pushed, all
unmerged.

## COMPLETED THIS SESSION

**AI-01 Batch 4F — Routing, Failover and Economics.**
`supabase/functions/server/ai/routing/`. A deterministic governed policy that
ORDERS providers the selector already found eligible and can never admit one;
four strategies under four invariants; a governed failover breadth; and a
per-request BILLABLE ATTEMPT BUDGET that closes the certified defect where the
spend guard reserved `maxAttempts` per request while the pipeline granted
`maxAttempts` to every failover candidate. The certified 105,920 µUSD
`cortex.chat` hold did not move — the execution path now matches it. Economics,
metrics, events, an admin read model and a Routing console tab.
Report: `architecture/ai/AI-01-BATCH-4F-COMPLETION.md`, `ARCHITECT.md` §12.7.

**MCV2-S7.4 — Outcome Shadow Read.** `supabase/functions/server/storage/`. The
instrument Phase 3 needs before anything reads SQL first: it serves the KV
answer, reads the relational row alongside it under a deadline, records whether
they agree, and returns nothing. Never changes what is served, never fails a
request, never runs unbounded, never records a customer value. Off by default.

**MCV2-S7.6 (cancelled, as a finding) and S7.7 — Submission Shadow Read.** The
lead domain has no runtime read to shadow — leads are written by two capture
routes and no route serves one — and bulk comparison for that domain already
exists as `migration:reconcile`. S7.7 aimed the same instrument at the core
entity, sharing one reader, one deadline and one report.
Report: `architecture/database/MCV2-S7.6-S7.7-SHADOW-READ-COMPLETION.md`.

**MCV2 Phase 2 — the diagnostic-domain backfills.** Submissions, cortex
analyses and outcomes: normalizers carrying every mapping judgement, domain
processors and writers, and an orchestrator refactor that runs any domain
through one loop. Reconciliation for all four domains, comparing FIELDS through
the same comparator the shadow read uses. Verified against a real PostgreSQL 16
in dependency order (`npm run test:database:diagnostic`).
Report: `architecture/database/MCV2-PHASE2-SUBMISSION-BACKFILL-COMPLETION.md`.

Two findings recorded rather than worked around: **the report domain has no KV
source** (the client report is built on every read from `sub:` and `cortex:`, so
"generate version 1 on first backfill" is a product decision about storing
report history, not a data migration), and **the certified lead reconciliation
reported a field-level pass it never made** (`sampleMismatchCount` was the
literal zero) — that one is fixed, with tests.

## COMMITS CREATED

On `claude/marq-cortex-batch-4f-c1hmm0`, from `b13d3a3`:

1. `feat(ai): a routing policy that orders what it is given and admits nothing`
2. `feat(ai): a request may not spend more paid attempts than were reserved for it`
3. `feat(storage): measure whether the other store agrees, without letting it answer`
4. `feat(storage): aim the shadow read at the core entity, and say why one domain cannot have one`
5. `feat(migration): decide the submission mapping in one pure function, and name every guess`
6. `feat(migration): one migration loop, two domains, and a backfill that converges`
7. `test(migration): prove the submission backfill against a real PostgreSQL`
8. `docs: checkpoint the autonomous build after 4F, the shadow reads and the submission backfill`
9. `feat(migration): a reconciliation that compares fields, not only counts`
10. `fix(migration): the lead reconciliation reported a field check it never ran`
11. `feat(migration): the cortex analysis domain, which enriches and never overwrites`
12. `feat(migration): the outcome domain, which refuses to guess a verdict`
13. `docs(roadmap): Phase 2 is code complete for every KV namespace with stored data`
14. `feat(migration): reconcile every domain, through one comparator`

## TEST RESULTS

| Suite | Result |
|---|---|
| `npm run test:ai` | 2,183 pass |
| `npm run verify:4f` | 167 pass |
| `npm run test:security` | 859 pass |
| `npm run test:features` | 726 pass |
| `npm run test:system` | 170 pass |
| `npm run test:migration` | 210 pass |
| `npm run scan:boundaries` | 107 pass |
| `npm run test:database` | 206 pass, 1 skipped without `DATABASE_URL` |
| `npm run test:database:diagnostic` | 8 assertions, real PostgreSQL 16 |
| `npm run test:database:4c` / `:4d` / `:scenarios` | pass, real PostgreSQL (regression) |
| `kv_compare_and_swap` with `DATABASE_URL` | 19 pass — had never run in this environment |
| `npm run typecheck:api:ai` / `:pure` | clean |
| `npm run typecheck:web` | 34 errors — identical to the pre-session baseline |
| `npm run typecheck:tests` | 27 errors — **two below** the baseline (the `leads.ts` pair is fixed) |
| `npm run build` | clean |

No test was weakened, skipped or deleted. No test reaches a real provider.

## A DATABASE IS AVAILABLE IN THIS ENVIRONMENT

PostgreSQL 16 is installed but not started at session start. To use it:

```
service postgresql start
su postgres -c "psql -c \"CREATE ROLE root SUPERUSER LOGIN PASSWORD 'harness'\""
su postgres -c "psql -c 'CREATE DATABASE root OWNER root'"
export DATABASE_URL="postgresql://root:harness@localhost:5432/root"
```

Every `test:database:*` harness then runs for real. Earlier sessions treated
these as unrunnable; they are not.

## KNOWN NON-BLOCKING ISSUES

- 34 pre-existing `typecheck:web` and 29 pre-existing `typecheck:tests` errors,
  all in files unrelated to this session's work (proposal viewer, snapshot
  engine, mapping engine, mock data, migration lead domain, workflow expression
  validation). Present at `b13d3a3`. Worth a cleanup sprint before UI/UX.
- The `server` deno boundary cannot be type-checked here: `jsr.io` is not
  routable from this environment (an egress restriction, pre-existing). The
  `ai` and `registry-free` boundaries both check clean.
- The certified lead reconciliation's dead code and hard-coded field check are
  fixed; the `leads.ts` type errors are fixed. Nothing else is known-broken in
  the migration engine.

## CURRENT BRANCH

`claude/marq-cortex-batch-4f-c1hmm0` — pushed, 14 commits ahead of `main`.
**Not merged.** No PR has been opened; the session prompt did not authorise one.

## NEXT EXACT TASK

The KV→SQL migration is code complete for every namespace that holds stored
data, and everything remaining in Phases 4 and 5 waits on a deployment
decision. So the next work is the documented gap register
(`MARQ_CORTEX_MASTER_BLUEPRINT_v1.0.md` §VI-5):

- **G3 — intelligence breadth: CLOSED** by AI-01 Batches 1 through 4F
  (multi-provider, agentic orchestration, routing). The register still describes
  it as "gateway is live single-provider", which is now three years of batches
  out of date; worth correcting when a human confirms the reading.
- **G5 — enterprise performance instrumentation** is the next open BACKEND gap
  and is dependency-safe. Read §IV-46 to §IV-55 before starting. Note what those
  sections deliberately exclude: "no numeric targets, no thresholds, no
  formulas, no dashboards", and "evaluation implementation is deferred". So the
  buildable part is a KPI REGISTRY — named indicators per approved category,
  computed from signals that already exist, carrying no targets — plus the
  unified health framework. Inventing targets would be inventing product.
- **G6 — external integrations** (CRM sync, e-sign, scheduling) needs
  third-party credentials. Blocked.
- **G4 — the AI Workforce runtime** is the largest documented capability and
  sits on the Batch 3A/3B substrate. It is a program, not a sprint; scope it
  deliberately rather than starting it at the end of a session.

## BLOCKERS

- **MCV2-S7.5 — Outcome Shadow Read Validation.** Its exit condition is a
  mismatch rate measured over real traffic, which needs
  `MCV2_SHADOW_READ_OUTCOMES` switched on in a deployment. Human decision.
- **Running any backfill against real data.** Needs production credentials and a
  human decision.

## PRODUCTION WORK DEFERRED

- **Batch 4E production rollout** — deferred to final production hardening.
  Untouched by this session.
- **Batch 4C/4D production gates** — applying the provider-administration and
  BYOK migrations and setting `AI_CREDENTIAL_ENCRYPTION_KEY` still need human
  authorisation.
- **Batch 4F needs no production action.** No migration, no secret, no required
  variable. `AI_ROUTING_STRATEGY` defaults to `preference` (the pre-4F order
  exactly) and `AI_ROUTING_MAX_PROVIDERS` to 3. The one behaviour a deployment
  inherits without configuring anything is the billable attempt budget, which is
  a narrowing of spend and a correction of the certified invariant.
- **The shadow reads need no production action either.** Both switches
  (`MCV2_SHADOW_READ_OUTCOMES`, `MCV2_SHADOW_READ_SUBMISSIONS`) are off by
  default, and with them off the routes behave exactly as before.
- `AI_ALLOW_REAL_REQUESTS` was not changed by this work.

---

_Last updated: 2026-09-07, after the diagnostic-domain backfills and reconciliation._
