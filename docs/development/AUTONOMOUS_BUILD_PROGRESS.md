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

Phase 6 — AI Platform: **AI-01 Batch 4F is MERGED to `main`.** The AI-01 batch
series is documented complete through 4F; no Batch 5 is defined in the roadmap
or the blueprint.

Phase 4 — Runtime Storage Gateway: shadow read delivered for both domains that
have runtime reads; Phase 2 backfill and reconciliation delivered for every KV
namespace that holds stored data. Merged.

Gap register: G3 closed. G5 closed for every section the canon makes buildable
now. G4 intentionally deferred.

## AI-01 BATCH 4F = MERGED

| | |
|---|---|
| PR | [#45](https://github.com/marqnetwork/marqcortex-/pull/45) — AI-01 Batch 4F — Routing, Failover & Economics |
| Merged from | `claude/marq-cortex-batch-4f-c1hmm0` @ `79b1674` |
| Base reviewed against | `b13d3a3` (post-4E baseline, PR #44) |
| Merge SHA | `04bdfba` |
| `origin/main` after merge | `04bdfbabcb74f9d332cee8b3b3c096cf7ae66a73` |
| Method | merge commit — all 20 commits preserved in `main` ancestry |

Verified after merge: the reviewed tip `79b1674` is an ancestor of `main`, all
20 branch commits are present, and `b13d3a3` (certified 4E history) is intact
and unmodified.

## CURRENT BATCH

None in flight.

## MERGE-READINESS FINDINGS

The merge was gated on a lightweight readiness check, not a recertification.
No merge-blocking defect was found. What was checked:

- Branch descended cleanly from the post-4E baseline `b13d3a3`, 20 ahead / 0
  behind, no divergence, no conflict, `mergeable_state: clean`.
- **No secrets or credentials** in the diff — no key material, no tokens, no
  `.env`/`.pem`/credential files, no live endpoints.
- **No real provider or live-test code enabled.** Every
  `AI_ALLOW_REAL_REQUESTS: 'true'` in the diff is an in-memory test-harness env
  override, the established pattern. No test reaches a vendor.
- **`AI_ALLOW_REAL_REQUESTS` behaviour and default unchanged** — still
  `readBool(env, 'AI_ALLOW_REAL_REQUESTS', false)` in `runtime/config.ts`, and
  the admin overlay still cannot overturn `false` from a console.
- **The billable attempt budget is intact and is a narrowing.**
  `billableAttemptBudget = max(1, trunc(workload.maxAttempts))` —
  the spend guard's own reservation basis. Enforced twice: before a billable
  candidate is dialled, and before each attempt against it. A budget-skipped
  candidate is recorded as skipped, never as failed. Non-billable attempts do
  not spend the budget, so the mock last resort survives a total vendor outage.
  The certified `cortex.chat` hold did not move.
- **Failover breadth is deployment-capped.** `runtime/envelope.ts` clamps
  `maxProviders` to the deployment ceiling and reports the clamp; the strategy
  is deliberately not clamped because it cannot admit a provider, spend withheld
  money, or lift a certification requirement.
- **No test weakened, skipped or deleted.** `test:security` gained two suites.

## TEST RESULTS — INDEPENDENTLY RE-RUN

Re-run on the merge head `79b1674` before merging, then again on merged `main`
`04bdfba`. Identical results both times.

| Suite | Result |
|---|---|
| `npm run test:ai` | 2,183 pass, 0 fail |
| `npm run test:security` | 859 pass, 0 fail |
| `npm run test:features` | 774 pass, 0 fail |
| `npm run test:migration` | 210 pass, 0 fail |
| `npm run test:system` | 170 pass, 0 fail |
| `npm run verify:4f` | 167 pass, 0 fail |
| `npm run verify:health` | 48 pass, 0 fail |
| `npm run scan:boundaries` | 107 pass, 0 fail |
| `npm run test:database` (with `DATABASE_URL`) | **225 pass, 0 fail, 0 skipped** |
| `npm run test:database:diagnostic` | all backfill assertions pass, real PostgreSQL 16 |
| `npm run test:database:4c` / `:4d` / `:scenarios` | pass, real PostgreSQL (regression) |
| `npm run typecheck:api:ai` | clean |
| `npm run typecheck:api:pure` | clean |
| `npm run typecheck:web` | 34 errors — **byte-identical to the `b13d3a3` baseline** |
| `npm run build` | clean |

The `typecheck:web` comparison was made by diffing the branch output against a
baseline run at `b13d3a3`: **zero new errors introduced.** Pre-existing
repository-wide typecheck debt is not merge-blocking.

## G4 = INTENTIONALLY DEFERRED TO LATER PHASE 4.x

Not an oversight and not a gap in this milestone. Blueprint §IV-24 fixes twelve
worker categories and §IV-25 eight lifecycle stages, and both state that the
implementation is deferred to later Phase 4.x — individual workers in §IV-24,
and provisioning, identity and registry in §IV-25.

The buildable shape would be a workforce registry and lifecycle state machine
starting empty, exactly as Batch 3A did for agents. But that is a SECOND
registry beside the agent runtime, and whether Cortex realizes the workforce
layer now — and as its own registry rather than as a facet of the agent one — is
a sequencing and architecture decision the canon explicitly reserves for a
human. Building it autonomously would be making that decision, not executing it.

**Do not begin G4 without a human scoping it.** It did not block Batch 4F and
does not block Phase 6.

## 4E PRODUCTION ROLLOUT = DEFERRED TO FINAL HARDENING / RELEASE

Untouched by the 4F work and by this merge. Alongside it, still deferred:

- **Batch 4C/4D production gates** — applying the provider-administration and
  BYOK migrations, and setting `AI_CREDENTIAL_ENCRYPTION_KEY`, need human
  authorisation.
- **Running any backfill against real data** — a deployment action needing
  production credentials.
- **MCV2-S7.5** — its exit condition is a mismatch rate over real traffic,
  which needs `MCV2_SHADOW_READ_OUTCOMES` on in a deployment.
- **G1/G2 and S8.1–S8.3** — cutover is a deployment action.

**Batch 4F itself needs no production action.** No migration, no secret, no
required variable. `AI_ROUTING_STRATEGY` defaults to `preference` (the pre-4F
order exactly) and `AI_ROUTING_MAX_PROVIDERS` to 3. Both shadow-read switches
(`MCV2_SHADOW_READ_OUTCOMES`, `MCV2_SHADOW_READ_SUBMISSIONS`) are off by
default. The health and KPI surfaces are team-auth reads that write nothing, and
the anonymous `/health` uptime endpoint is unchanged. The one behaviour a
deployment inherits without configuring anything is the billable attempt budget,
which is a narrowing of spend and a correction of a certified invariant.

`AI_ALLOW_REAL_REQUESTS` was not changed by this work.

## GAP REGISTER — STATUS VS. LOCKED CANON

`MARQ_CORTEX_MASTER_BLUEPRINT_v1.0.md` §VI-5 is **LOCKED canon** (Part VI is
LOCKED, and the Master Blueprint is RELEASED v1.0). Its G3 and G5 rows are now
factually stale, but amending them is a governance action for a human, not an
autonomous edit. The correction is recorded as progress status in
`MARQ_CORTEX_ROADMAP.md` instead:

- **G3 — intelligence breadth.** §VI-5 says PARTIAL, "gateway is live
  single-provider". **Stale since Batch 4A.** Closed by AI-01 Batches 1–4F.
- **G5 — enterprise performance instrumentation.** §VI-5 says NOT IMPLEMENTED.
  Now **PARTIAL, and closed for every section the canon makes buildable now**:
  §IV-51 and §IV-48 are built; §IV-49 and §IV-50 defer their own implementation
  in the canon text; §IV-52/§IV-53 are organisational frameworks.
- **G4.** §VI-5's NOT IMPLEMENTED is accurate, but the reason is deferral by the
  canon, not an unbuilt backlog item.

## A DATABASE IS AVAILABLE IN THIS ENVIRONMENT

PostgreSQL 16 is installed but not started at session start. The `postgres`
system user cannot traverse a session scratchpad path, so the data directory
must live somewhere it owns:

```
export PATH=/usr/lib/postgresql/16/bin:$PATH
id -u postgres >/dev/null 2>&1 || useradd -m -d /var/lib/postgresql postgres
mkdir -p /var/lib/postgresql && chown -R postgres /var/lib/postgresql
su postgres -c "PATH=/usr/lib/postgresql/16/bin:\$PATH initdb -D /var/lib/postgresql/pgtest -A trust -U postgres"
su postgres -c "PATH=/usr/lib/postgresql/16/bin:\$PATH pg_ctl -D /var/lib/postgresql/pgtest -o '-k /tmp -p 5432 -h 127.0.0.1' -l /var/lib/postgresql/pgtest/server.log -w start"
export DATABASE_URL="postgresql://postgres@127.0.0.1:5432/postgres"
```

Every `test:database:*` harness then runs for real, and `test:database` reports
225 pass / 0 skipped instead of 206 / 1. Sessions that treat these as unrunnable
are leaving real coverage on the table.

`deno` is not installed at session start either; `npm i -g deno` works without
privileges and unblocks `typecheck:api:ai` and `typecheck:api:pure`.

## COMPLETED AFTER THE MERGE — frontend typecheck debt, partly cleared

`typecheck:web` **34 -> 20**, and every error cleared turned out to be a real
runtime defect rather than annotation noise. Eight defects repaired across four
commits, each covered by a test:

| Defect | Consequence before the fix |
|---|---|
| `createProposalSnapshot` read `linked_entity_type`/`linked_entity_id`; `BlockLink` declares `entity_type`/`entity_id` | The membership filter matched nothing, so **every proposal snapshot froze an empty block set** — Save Version saved no blocks and the export pulled from an empty snapshot |
| Same function read `Block.label` and `Block.approved_by`/`approved_at` | `Block` has `title` and no approver at all; approval lives on the `BlockRevision` `current_revision_id` points at |
| `CountdownTimer` scheduled its interval with `useState`, not `useEffect` | React treats the function as a lazy initialiser: the interval ran during render, its cleanup became state nothing called, and copies accumulated across re-mounts |
| `DiagnosticQuestion` never passed `isOpen` to `ProgressModal` | The modal gates its whole body on that prop, so the **25/50/75 % milestone celebration never rendered** |
| Both `SettingsPage` demo fixtures modelled a retired settings schema | They supplied none of the four fields the page reads and eight nothing reads; the notification panel spread `{...undefined}` and rendered every toggle from nothing |
| `ExportPanel` put `title` on a lucide icon | Lucide spreads unknown props onto the `<svg>`, which has no `title` attribute, so the tooltip never appeared |
| `mappingEngine` omitted `execution_version` | qbrEngine rendered **"vundefined"** in the QBR report and its footer; scopeEngine's `execution_version + 1` was NaN |
| Three `CortexDashboardSections` panels read `lead.employeeEstimate` | `Lead` has `companySize`; the name belongs to the core diagnostics input, so **company size was blank in all three panels** |

Test count rose 774 -> 801 in `test:features`, with no test weakened or removed.
The snapshot repair is covered behaviourally (the engine's imports are
type-only, so the runner can load it) and verified to fail 7/7 against the old
code; the rest are structural, following the established Phase 1B pattern.

### Deliberately NOT repaired

**The ClientPortal auth cluster — 14 of the 20 remaining.**
`tests/features/clientPortalAuthContract.test.ts` pins this exclusion on
purpose, and the pin is correct. `getClientReport`, `trackEngagement`,
`getClientMessages`, `postClientMessage`, `getClientProposal`,
`getEngagementLog` and `respondToProposal` declare no positional slot for the
auth argument, so the call sites' `clientAuth` is discarded and the request goes
out with the anon key and no `?email=`. Repairing them changes what the browser
sends over the wire — an authentication and telemetry change — and is owed a
**separate, live-mode-verified task**, not a cleanup commit.

This was attempted in this session and reverted when the contract test caught
it. The test was left exactly as it was.

**Six that need a product decision, not a mechanical repair:**

1. `ExecutionDashboard` filters milestones by `workstream_id`, which `Milestone`
   does not have and is not meant to — milestones are execution-level phases
   spanning every workstream. What a workstream card should show is a UX
   decision.
2. `SubmissionsListPage` passes `'new' | 'approved' | 'in-review' | 'completed'`
   into a component expecting `'new' | 'approved' | 'sent' | 'reviewing'`. Needs
   the same canonicalisation judgement the submission shadow read made for
   `approved` and `won`.
3. `CortexDashboardSections` reads `why_first` off a problem shape that does not
   declare it.
4. `DiagnosticForm` reads `options` off a question shape that does not declare
   it.
5. `EditableBlockCard` passes a `Record<string, unknown>` handler where a
   `string` one is expected.
6. `mockCortexData` assigns a bare `string` to `ServiceType`.

## KNOWN NON-BLOCKING ISSUES

- 20 remaining `typecheck:web` errors (down from 34) and 27 `typecheck:tests`
  errors. 14 of the 20 are the deliberately-pinned auth cluster; the other 6
  need a product decision. See the section above.
- The `server` deno boundary cannot be type-checked in this environment:
  `jsr.io` returns **403 through the agent proxy**, so the checker cannot
  download `@supabase/supabase-js`'s manifest. This is an egress restriction,
  not a type error, and the tooling correctly reports BLOCKED rather than
  falsely passing. The `ai` and `registry-free` boundaries both check clean.

## NEXT EXACT TASK

**Everything documented, dependency-safe and not canon-deferred has been built
and merged.** The AI-01 batch series is complete through 4F and no Batch 5 is
defined in the canonical roadmap or blueprint — defining one would be authoring
scope, not executing it.

The one piece of undone work needing no human gate and no new scope:

**The ClientPortal auth repair, live-mode verified.** This is now the largest
single block of remaining frontend debt (14 of 20 `typecheck:web` errors) and
the only one with a user-visible consequence today: the client portal's report,
messages, proposal and engagement calls all reach `api` with `auth === undefined`,
so they go out with the anon key and no `?email=` and the server answers 401.

It needs a deployment to verify against, because the repair changes what the
browser sends — which is exactly why `clientPortalAuthContract.test.ts` excludes
it from cleanup work. Scope it as its own task with a live backend, update that
contract test in the same change, and confirm `requireClientAccess` authorises
the repaired calls.

After that, the six product-decision items listed above.

Everything else is gated, and the gates are decisions rather than tasks:

1. **G4 / §IV-49 / §IV-50** — deferred by the canon. Human sequencing decision.
2. **G6 — external integrations** (CRM sync, e-sign, scheduling). Needs
   third-party credentials and accounts.
3. **G1/G2 and S8.1–S8.3** — the instrument, backfills and reconciliation exist
   and are verified against a real PostgreSQL; running and cutting over is a
   deployment action.
4. **MCV2-S7.5** — needs `MCV2_SHADOW_READ_OUTCOMES` on in a deployment.
5. **Amending §VI-5** — the G3 and G5 rows are stale; the blueprint is LOCKED,
   so a human confirms the amendment.

## BLOCKERS

- **MCV2-S7.5** — needs real traffic under a deployment switch. Human decision.
- **Running any backfill against real data** — needs production credentials.
- **G4 — the AI Workforce runtime** — canon-deferred; a human scopes it.
- **G6 — external integrations** — needs third-party credentials.
- **The `server` deno boundary** — `jsr.io` is 403 through this environment's
  proxy. Environmental, not a code defect.

---

_Last updated: 2026-09-07, after AI-01 Batch 4F was merged to `main` as PR #45 and
the frontend typecheck debt was partly cleared (34 -> 20)._
