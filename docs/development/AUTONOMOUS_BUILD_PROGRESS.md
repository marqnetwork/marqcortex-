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

**MCV2 Phase 2 — Submission domain backfill.** The normalizer (every mapping
judgement, pure), the domain processor and writer, and an orchestrator refactor
that runs any domain through one loop. Verified against a real PostgreSQL 16.
Report: `architecture/database/MCV2-PHASE2-SUBMISSION-BACKFILL-COMPLETION.md`.

## COMMITS CREATED

On `claude/marq-cortex-batch-4f-c1hmm0`, from `b13d3a3`:

1. `feat(ai): a routing policy that orders what it is given and admits nothing`
2. `feat(ai): a request may not spend more paid attempts than were reserved for it`
3. `feat(storage): measure whether the other store agrees, without letting it answer`
4. `feat(storage): aim the shadow read at the core entity, and say why one domain cannot have one`
5. `feat(migration): decide the submission mapping in one pure function, and name every guess`
6. `feat(migration): one migration loop, two domains, and a backfill that converges`
7. `test(migration): prove the submission backfill against a real PostgreSQL`

## TEST RESULTS

| Suite | Result |
|---|---|
| `npm run test:ai` | 2,183 pass |
| `npm run verify:4f` | 167 pass |
| `npm run test:security` | 859 pass |
| `npm run test:features` | 726 pass |
| `npm run test:system` | 170 pass |
| `npm run test:migration` | 137 pass |
| `npm run scan:boundaries` | 107 pass |
| `npm run test:database` | 206 pass, 1 skipped without `DATABASE_URL` |
| `npm run test:database:diagnostic` | 8 assertions, real PostgreSQL 16 |
| `npm run test:database:4c` / `:4d` / `:scenarios` | pass, real PostgreSQL (regression) |
| `kv_compare_and_swap` with `DATABASE_URL` | 19 pass — had never run in this environment |
| `npm run typecheck:api:ai` / `:pure` | clean |
| `npm run typecheck:web` / `:tests` | 34 / 29 errors — identical to the pre-session baseline |
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
- `migration/domains/leads.ts` carries two long-standing type errors from the
  same non-strict-narrowing limitation the submission normalizer works around
  with an exported type guard. Fixing leads.ts the same way is a small,
  dependency-safe cleanup.

## CURRENT BRANCH

`claude/marq-cortex-batch-4f-c1hmm0` — pushed, 7 commits ahead of `main`.
**Not merged.** No PR has been opened; the session prompt did not authorise one.

## NEXT EXACT TASK

In dependency order, all dependency-safe:

1. **Reconciliation for the submission domain.** `migration/reconciliation.ts`
   is lead-shaped, so a submission backfill completes and reports that it did
   not reconcile. Give the domain descriptor a reconciler and implement the
   submission one (count `sub:` vs `submissions` where `legacy_kv_key IS NOT
   NULL`, plus the field-level hash on a sample the mapping document asks for).
2. **The `cortex:` domain** — `MCV2-S5-KV-RELATIONAL-MAPPING.md` maps
   `cortex:{submissionId}` to `diagnostic_scores` + `domain_scores`.
3. **Fix the two `leads.ts` type errors** with the same exported type guard.
4. Then the documented gap register (`MARQ_CORTEX_MASTER_BLUEPRINT_v1.0.md`
   §VI-5). G3 (intelligence breadth) is closed by AI-01 Batches 1–4F. The next
   open backend gap is **G5 — enterprise performance instrumentation**
   (§IV-46–§IV-55): no formal KPIs, AI-performance evaluation, unified health
   framework or scorecards.

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

_Last updated: 2026-09-07._
