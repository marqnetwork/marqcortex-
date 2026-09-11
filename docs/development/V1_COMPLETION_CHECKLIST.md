# MARQ Cortex — V1 Completion Checklist

**The single authoritative V1 checklist.** It replaces the "next task" lists
scattered through `AUTONOMOUS_BUILD_PROGRESS.md`; that file remains the
narrative record of how each item was closed, and this one is the state.

Sources: `MARQ_CORTEX_PRODUCT_EXPERIENCE.md`, `MARQ_CORTEX_ONTOLOGY_v1.0.md`,
`MARQ_CORTEX_MASTER_BLUEPRINT_v1.0.md` (§VI-5 gap register),
`MARQ_CORTEX_REFERENCE_ARCHITECTURE_v1.0.md`,
`MARQ_CORTEX_IMPLEMENTATION_GUIDE_v1.0.md`, `MARQ_CORTEX_ROADMAP.md`, and the
327-node `src/system/manifest.ts`.

Verified against merged main **`5e1e26e0`** (G2 and the G1 cutover mechanism merged).
Last updated 2026-09-10.

> **A caution this document exists to enforce.** The roadmap's "Next Sprint"
> line still names cortex and outcome reconciliation. That work landed in
> `fdffd214`, *after* the line was written, and the roadmap was never updated —
> so an audit that trusted it produced a stale priority. **Every PARTIAL and
> MISSING row below was re-checked against the code on `1f4ef999`, not against
> a document.**

No completion percentage is given. The inventory is the answer, and a single
number would hide that most of what remains is a deployment, a credential or a
human decision rather than code.

---

## COMPLETE

| Item | Canonical source | Evidence on `1f4ef999` |
|---|---|---|
| Intelligence Gateway; frontend gateway normalization | Roadmap S1–S2 | superseded by the AI Control Plane, sole path, no bypass flag |
| Database architecture; tenancy foundation | Roadmap S3–S4 | 19 migrations apply cleanly to a bare PostgreSQL 16 |
| Diagnostic foundation, **including all five repositories** | Roadmap S5, MQC-SVC-011…016 | 5/5 real and distinct; `static_diagnostic_migration` 22/22 |
| Migration planning, infrastructure, validation | Roadmap S6.1–S6.3 | `test:migration` 210/210 |
| Runtime storage gateway; outcome + submission shadow reads | Roadmap S7.1–S7.4, S7.7 | four invariants asserted; both switches off by default |
| Phase 2 backfill — **code**, all three domains | Roadmap Phase 2 | `test:database:diagnostic` passes on real PostgreSQL |
| **Reconciliation — all four domains** | Roadmap "Next Sprint" (stale), `fdffd214` | one shared engine + the cortex set reconciler; **21 live scenarios** |
| AI Control Plane, administration, agent + workflow runtime, providers 4A–4F | Roadmap Phase 6 | closes **G3**; `test:ai` 2183/2183, AI boundary typecheck 0 |
| Enterprise performance instrumentation, for the buildable scope | §IV-51, §IV-48, **G5** | `server/health/`, `server/kpi/`; `architecture/ENTERPRISE-PERFORMANCE-INSTRUMENTATION.md` |
| Strategic surface, documentation axis | **G7** | Part V authored and LOCKED |
| UI Sprints 1–8; design-token migration | Product Experience | token census Class A = 0 |
| ClientPortal live authentication path | F-003 | `typecheck:web` 14 → 0; contract suite 35/35 |
| Deployed Edge Function typecheck | — | 99 → 0 across 342 files, nothing suppressed |
| **Multi-tenancy enforcement (G2)** | §VI-5 G2; RA §7.22, §11.8 | composite keys on all 14 relationships; 27 live scenarios; no class-F path remains |
| **Phase 5 cutover MECHANISM (G1, S8.1)** | Roadmap Phase 5 | `storage/readAuthority.ts`, wired to the outcome route, switch off; 10 live scenarios incl. rollback |
| **All typecheck boundaries (H3, H4)** | — | `npm run typecheck` exits 0: web 0, api 0, tests 0 — and `tests` is now **strict**, which it never was |
| **Integration QA — canonical journeys in a browser** | Product Experience | 17 Playwright tests: sign-in, 13 destinations as deep links, reload, signed-out denial, phone width, accessibility. Found and fixed ungated admin credentials on the sign-in page and a missing favicon |
| **Production readiness plan** | — | `docs/development/V1_PRODUCTION_READINESS.md` — migration order, flag state, deployment order, Phase 5 sequence, health checks, smoke plan, rollback |
| **Final security campaign** | Task §5 | Two passes, **eleven findings, all closed**, no BLOCKER or HIGH remaining. Six new guard modules under `server/security/`, 5 new suites (`tests/security/`), every fix mutation-proven. Readiness §8 |
| **Release response headers** | Task §6 | `vercel.json` + `scripts/serve-release.mjs`; `npm run test:release` runs all 23 browser tests against the **built artifact under the real headers**, including a proof that an injected inline script is refused |
| **Dependency supply chain** | Task §6 | `npm audit`: **0**, production and dev. react-router, ws, lodash, dompurify, fflate resolved in range; vite 6.3.5 → 6.4.3 with a byte-identical entry chunk |

---

## PARTIAL

### ~~P1 — Data authority (**G1**)~~ → **CODE COMPLETE, cutover proven locally**

**`G1 CODE COMPLETE / LOCAL CUTOVER PROVEN / PRODUCTION EXECUTION PENDING`**

- **Canon** — Master Blueprint §VI-5 G1; Roadmap Phases 4–5.
- **Reconstructed from code on `f82465e3`, not from the roadmap.** The roadmap
  was stale twice this cycle; it is evidence of intent, never of state.

### Per-domain classification

Four domains have a relational plane. They are not in the same place, and the
difference is not effort — it is that two of them have a runtime read to cut
over and two do not.

| Domain | Schema | Repository | Backfill | Reconciliation | Shadow read | Read authority | Wired to a route | **Classification** |
|---|---|---|---|---|---|---|---|---|
| **outcome** | ✅ | ✅ | ✅ code | ✅ live-proven | ✅ S7.4 | ✅ `outcomeReadAuthority` | ✅ `GET /submissions/:id/outcome`, switch off | **PRODUCTION CUTOVER PENDING** |
| **submission** | ✅ | ✅ | ✅ code | ✅ live-proven | ✅ S7.7 | ✅ `submissionReadAuthority` | ✅ `GET /submissions/:id`, switch off | **PRODUCTION CUTOVER PENDING** |
| **cortex_analysis** | ✅ | — (normalizer, not a repository) | ✅ code | ✅ live-proven | ❌ | ❌ | `GET /submissions/:id/cortex` serves KV | **LEGACY AUTHORITY** |
| **leads** | ✅ | ✅ | ✅ code | ✅ live-proven | ❌ **S7.6** | ❌ | **no route serves a lead** | **LEGACY AUTHORITY** *(vacuously)* |

**RELATIONAL AUTHORITY is reached by nobody, deliberately.** Both switches
default off, and off returns the KV record *by identity* without reading the
relational store at all. Flipping either one is a production action.

### On S7.6 — Lead Shadow Read, which canon marks ❌

It is not built, and it is **not buildable as specified**. A shadow read compares
what a route SERVES against what the relational store holds. The lead domain has
no such route:

- Two POST routes capture leads (`/leads/capture`, `/leads/exit-intent`).
- One runtime KV read exists and reads the INDEX (`lead_email:<address>`) for a
  duplicate check — not a lead record.
- No route serves a lead. No front-end call fetches one. `migration/leadProjection.ts`
  says so in its own header, and an exhaustive route scan agrees.

Building S7.6 would mean first inventing a lead-serving API that no consumer
asks for. That is new product scope, not closure of an existing gap, so it is
**EXPLICITLY_POST_V1** with a stated precondition: *S7.6 becomes buildable the
day a route serves a lead, and not before.* The lead domain is otherwise
complete — schema, repository, backfill and live-proven reconciliation all
exist, so the relational plane is ready for the read whenever one appears.

`cortex_analysis` is the same shape with one difference: it *does* have a runtime
read (`GET /submissions/:id/cortex`), but canon's Phase 4 names no cortex shadow
read sprint — only S7.4 (outcome), S7.6 (lead) and S7.7 (submission). It is
therefore **EXPLICITLY_POST_V1** as well, by canon rather than by impossibility.

### The cutover, rehearsed end to end locally

`npm run test:database:rehearsal` — **8 stages** against real PostgreSQL, in the
order production would run them:

1. LEGACY — KV answers, relational store empty
2. BACKFILL — the relational estate is built from KV
3. RECONCILE — every row agrees
4. SHADOW — SQL is read alongside and compared, KV still answers
5. RELATIONAL AUTHORITY — SQL answers, **and each tenant gets its own**
6. ROLLBACK — the switch alone returns the estate to KV
7. RELATIONAL AUTHORITY AGAIN — the estate can cut over a second time
8. INTEGRITY — the census is unchanged from the end of the backfill

Stages 6 and 7 are the ones that matter for a release: rollback is the switch,
takes effect on the next read, and does not burn the estate — a cutover that
cannot be repeated after a rollback is a one-way door.

Alongside: **10** outcome cutover scenarios, **18** submission cutover scenarios,
**21** reconciliation scenarios and **27** tenancy scenarios, all against real
PostgreSQL, all green with **0 skipped**.

### What remains, and what each needs

| Item | State | Needs |
|---|---|---|
| Phase 2 backfill execution | code complete, **never run** | **PRODUCTION_EXECUTION_PENDING** — D1 forbids running it here |
| S8.1 rollout (flip either switch) | mechanism ready, proven, off | **PRODUCTION_EXECUTION_PENDING**, after S7.5 |
| S7.5 outcome shadow-read validation | instrumented | **EXTERNAL_ENVIRONMENT_BLOCKED** — a mismatch rate needs real traffic |
| S7.8 full runtime validation | instrumented | **EXTERNAL_ENVIRONMENT_BLOCKED** — same |
| S8.2 authority validation | — | **EXTERNAL_ENVIRONMENT_BLOCKED**, then a human decision |
| S8.3 KV retirement | — | **HUMAN_DECISION_REQUIRED** — a one-way door |
| S7.6 lead shadow read | no read path to shadow | **EXPLICITLY_POST_V1** |
| cortex_analysis read cutover | not named by canon | **EXPLICITLY_POST_V1** |

Nothing in this table is blocked on code that could be written here. Every
remaining item needs production authorisation, real traffic, a human decision,
or product scope that V1 does not include.

### ~~P2 — Multi-tenancy enforcement (**G2**)~~ → **COMPLETE**

- **Canon** — Master Blueprint §VI-5 G2; Reference Architecture §7.22 (isolation
  across every layer; no inconsistent reimplementation of a cross-cutting
  concern), §11.8 (isolation shall never be bypassed).
- **Closed** — `20260910120000_cortex_tenancy_composite_keys.sql`, and
  `npm run test:database:tenancy` (27 live scenarios).

**What was wrong.** All **fourteen** parent-child relationships in the
diagnostic domain accepted a child naming a parent in another tenant, and a
single UPDATE could re-parent a report onto another tenant's submission or hand
it to another organization. The finding recorded against MQC-SVC-015 was not a
`report_versions` quirk — it was the schema-wide pattern, and that repository's
parent check was the only enforcement anywhere. One guarded path out of fourteen
is exactly the inconsistency §7.22 forbids.

**Why in SQL.** The repositories and the migration engine run as `service_role`,
which bypasses RLS by design, so row-level policies are not the layer that could
close it. A composite foreign key is checked for every writer, including routes
not yet written.

**Proven both ways.** `--expect-gap` re-runs the same scenarios against the
schema without the migration and asserts the *unprotected* behaviour, so the
"before" is evidence rather than a memory. Mutation-tested: removing one
relationship, or the `SET NULL` column list, each fails at the scenario named
for it.

**Authority classification, after the audit** (§3 of the task):

| Path | Authority | Class |
|---|---|---|
| AI / agent / workflow / BYOK organization hint | `resolveOrganization` checks it against verified memberships; a foreign id returns `ORGANIZATION_NOT_RESOLVED` | **E** — caller-supplied, verified |
| Agent + workflow **reads** with `?organizationId` | `readScopeFor` returns the actor's own organization unless `agent.run.read.platform`, held only by `super_admin`/`platform_admin` from server-written `app_metadata` | **C/E** |
| Agent + workflow **mutations** | pass `undefined`; `controlInput` and `decideApproval` use `actor.organization.organizationId` explicitly | **C** — server-derived |
| Multi-membership with no hint | deterministic **refusal**, never a pick | **C** |
| No membership | fails closed unless `AI_ALLOW_DEFAULT_ORGANIZATION` | **C** |
| Platform admin without a membership | no exemption in `resolveOrganization` — refused | **C** |
| Client portal | bearer token bound to ONE submission; 404 on mismatch. The `?email=` fallback is **gone** (S-6) — an address identified a caller, it never proved one, and a token is now obtained only by redeeming a code sent to the mailbox | **C** — server-derived *(was E)* |
| Diagnostic repositories | every read and write filtered by `organization_id` | **D** |
| Parent-child ownership | **composite foreign key** | **A** — database-enforced *(was F)* |
| RLS on diagnostic tables | enabled on all 13; a caller with no membership reads nothing, even naming a row id exactly | **B** |
| `submissions.legacy_kv_key` | globally unique | **A** — see below |

No class **F** path remains.

**`legacy_kv_key` — classified: intentional canonical identity, not a defect.**
The KV namespace it names has no organization concept; `sub:{id}` was a global
address before tenancy existed. Global uniqueness is therefore *stronger* than
per-organization uniqueness would be: two tenants cannot claim one key at all,
which is proven live, as is that a lookup by key still cannot cross the
organization filter. **Left unchanged**, per the instruction not to alter it
merely for being global.

### P3 — Repositories are not wired to routes

- **Canon** — MCV2-S5: "Not wired to Hono routes (per sprint scope)."
- **Now** — all five repositories exist, are tested and are exported.
- **Remaining** — nothing, until Phase 5 decides SQL is authoritative. Listed
  so it is not mistaken for an omission.
- **Requires** — nothing yet; **deferred by canon** until P1 advances.

### P4 — Maturity stage (**G8**)

- **Canon** — §VI-5 G8, §IV-53.
- **Now** — the Startup shape, as approved.
- **Remaining** — Growth → Enterprise → Global → AI-native.
- **Requires** — **post-V1.** Not V1 work.

---

## MISSING

### M1 — AI Workforce runtime (**G4**)

- **Canon** — §VI-5 G4; Part IV executive/department/manager/worker model.
- **Now** — does not exist. Reserved to the `ai_worker` identity. The agent and
  workflow runtimes that DO exist are the AI-01 orchestrators, which are a
  different thing.
- **Remaining** — the whole runtime.
- **Requires** — **code**, at a scale the blueprint marks as beyond V1.
- **Classification** — MISSING as a gap, **PARKING LOT** for V1.

### M2 — External integrations (**G6**)

- **Canon** — §VI-5 G6.
- **Now** — `crmEngine` is built; `CRMSyncPanel` is GATED pending credentials.
  E-sign and scheduling are specified only.
- **Remaining** — the backend webhook path for CRM; e-sign and scheduling
  entirely.
- **Depends on** — third-party accounts and credentials.
- **Requires** — **code plus external credentials.** Not closable here.

---

## DEFERRED BY CANON

| Item | Why |
|---|---|
| Repository → route wiring | MCV2-S5 sprint scope; waits on Phase 5 |
| **S7.6 Lead Shadow Read** | **CANCELLED as a finding** — the lead domain has no runtime read to shadow; bulk comparison already exists as `migration:reconcile` |
| Part V Future Vision runtime | Documentation axis locked; realization tracked under G1/G4 |
| §IV-53 maturity stages | Approved, explicitly not V1 |

---

## LIVE / EXTERNAL BLOCKED

None of these is a code gap. Each needs a deployment, a credential, or a switch.

| Item | Gate | Note |
|---|---|---|
| S7.5 outcome shadow-read validation | `MCV2_SHADOW_READ_OUTCOMES` | exit condition is a mismatch rate over real traffic |
| S7.8 full runtime validation | both shadow-read switches | — |
| Phase 5 S8.1–S8.3 SQL cutover | S7.5/S7.8 first | — |
| Phase 2 backfill **execution** | human authorisation | **code complete, not run** |
| Live AI provider traffic | `AI_ALLOW_REAL_REQUESTS` | — |
| Certified diagnostic review capability | `AI_DIAGNOSTIC_REVIEW_ENABLED` | off by default; 14 GATED manifest nodes |
| The 9 DEMO manifest nodes | `FEATURES.BACKEND_INTEGRATION` (false) | **wired, not unbuilt** — the flag is the whole cutover |
| CRM sync | third-party credentials | — |
| Production deployment; final security certification | human | — |

---

## PARKING LOT / POST-V1

- G4 AI Workforce runtime; G8 maturity stages.
- `ABTestingPanel` — gated, deliberately absent from navigation.
- `LearningLoopPanel` — needs ≥50 closed submissions to produce a signal.

---

## HUMAN DECISIONS REQUIRED

| # | Decision | Detail |
|---|---|---|
| ~~H1~~ | ~~Chip-on-own-tint contrast~~ | **CLOSED, and the finding was wrong.** The recorded 4.17:1 case — neutral text on a neutral tint — **does not exist in the code**; nothing pairs them, and the figure was computed hypothetically. Measuring the 18 pairings that *do* exist found two real AA failures nobody had recorded: `status.danger` at 20% in `KanbanAlertToast` (4.14:1) and at 15% in `QATranscriptSheet` (4.44:1). Both moved to 12.5%, which clears AA on every surface. `tests/features/contrastAudit.test.ts` now measures all of them on every run. |
| H2 | Marketing type ramp | Deferred deliberately in UI Sprint 8. |
| ~~H3~~ | ~~The `migration/**` typecheck boundary~~ | **CLOSED.** Its own ADVISORY boundary — reported, never fatal, naming the checker that owns it. Verified not a suppression: `tsc -p tsconfig.node.json` loads 26 of the 27 files and reports **zero** errors in them. |
| ~~H4~~ | ~~`typecheck:tests`~~ | **CLOSED, 27 → 0.** Not the TypeScript-version difference an earlier checkpoint guessed at: `tsconfig.node.json` had no `strict` (so unions did not narrow), no `DOM` lib (WebCrypto globals), and no `jsx`. Enabling strict surfaced **six real findings in test code**, fixed rather than silenced. |
| ~~H7~~ | ~~Submission read cutover changes the response body~~ | **CLOSED by decision D3.** Missing or placeholder-only values are NULL; the relational representation is authoritative for semantic absence, and `'Not specified'` is not preserved as fake domain data. Proven live: `test:database:cutover:submission` asserts `phone` and `website` come back `null`, that `metadata.kv_remainder` still carries the unmodelled fields, and that a remainder key **cannot** reinstate a placeholder over a modelled column. Presentation may render an empty state; it must not write the placeholder back. |
| H5 | Four ORPHANED components | **Half closed.** The manifest's claim is now honest and checked: `DiagnosticQuestion`, `ProgressModal`, **`SubmissionsListPage` and `QuickActions`** — four nodes, not two — were marked LIVE with nothing importing them. The last two were found by `tests/system/manifest_reachability.test.ts`, which walks the real import graph from `main.tsx`; nobody had noticed a whole *page* was unreachable. All four are now `ORPHANED`, a status the vocabulary was missing. **Still a human decision:** wire them in or delete them. |
| H6 | Switch on shadow reads / run the backfill / deploy / certify | Every LIVE-BLOCKED row above. |

---

## DOCUMENTATION INCONSISTENCIES

- `MARQ_CORTEX_ROADMAP.md` "Next Sprint" names work completed in `fdffd214`.
  Its own rules forbid rewriting it, so **this checklist is the correction.**
- ~~Manifest `lastVerified: 2026-07-31`, `version: 2.1.0`~~ — **CLOSED.** Now
  `2.2.0` / `2026-09-11`, and the date means something: it was six weeks stale
  against four nodes claiming LIVE with nothing importing them, and
  `tests/system/manifest_reachability.test.ts` now checks that claim against the
  real import graph on every run rather than against a human's memory.
- ~~`MARQ_CORTEX_STABILIZATION_ROADMAP.md` is a zero-byte file~~ — **CLOSED.**
  Documentation Rule 5 names it as a standard document to review each sprint, so
  an empty file was a standing instruction to consult something that said
  nothing. It now says what is true: superseded, and where to read instead.
- ~~`DiagnosticQuestion` / `ProgressModal` manifest status~~ — **CLOSED as a
  documentation defect**, see H5. The status is honest; what to *do* with the
  four components is still a human decision.

---

## THE NEXT V1 ITEMS, IN DEPENDENCY ORDER

Every buildable item is closed. What is left is not code.

1. ~~**P2 — the tenancy audit.**~~ **CLOSED.**
2. ~~**H3 + H4 — the two typecheck boundaries.**~~ **CLOSED.**
3. ~~**H7 — the submission response contract.**~~ **CLOSED by decision D3**, and
   proven live rather than argued.
4. ~~**H1 — the contrast gap.**~~ **CLOSED**, and the recorded finding turned out
   to describe a pairing that does not exist. Two real ones did.
5. ~~**The manifest staleness and the zero-byte roadmap.**~~ **CLOSED.**
6. ~~**The security campaign.**~~ **CLOSED** — eleven findings, no BLOCKER or
   HIGH remaining. Readiness §8.
7. **H5 — wire or delete the four ORPHANED components.** A product decision. The
   manifest no longer misreports them either way.
8. **H2 — the marketing type ramp.** Deferred deliberately in UI Sprint 8.
9. **P1 — Phase 5 rollout.** The mechanism is built, rehearsed through all eight
   stages including rollback and a second cutover, and both switches are off.
   What remains is a production backfill, a switch, and a mismatch rate measured
   over real traffic — none of it code.

**Nothing in this list is blocked on work that can be done in this environment.**
Each remaining item needs production authorisation, real traffic, a human
decision, or scope V1 does not include.
