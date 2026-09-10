# MARQ Cortex — V1 Completion Checklist

**The single authoritative V1 checklist.** It replaces the "next task" lists
scattered through `AUTONOMOUS_BUILD_PROGRESS.md`; that file remains the
narrative record of how each item was closed, and this one is the state.

Sources: `MARQ_CORTEX_PRODUCT_EXPERIENCE.md`, `MARQ_CORTEX_ONTOLOGY_v1.0.md`,
`MARQ_CORTEX_MASTER_BLUEPRINT_v1.0.md` (§VI-5 gap register),
`MARQ_CORTEX_REFERENCE_ARCHITECTURE_v1.0.md`,
`MARQ_CORTEX_IMPLEMENTATION_GUIDE_v1.0.md`, `MARQ_CORTEX_ROADMAP.md`, and the
327-node `src/system/manifest.ts`.

Verified against merged main **`0cc934a1`**, with G2 closed on top of it.
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

---

## PARTIAL

### P1 — Data authority (**G1**) — mechanism COMPLETE, rollout is a live gate

- **Canon** — Master Blueprint §VI-5 G1; Roadmap Phases 4–5.
- **Reconstructed from code on `72a81c53`, not from the roadmap.**

**What existed already** (verified, not assumed): relational schema and 20
migrations; five repositories; backfills for all three domains, code complete
and proven against real PostgreSQL; reconciliation for all four domains with 21
live scenarios; shadow reads for outcome and submission; tenancy now in the key.

**What did NOT exist, and now does.** There was no cutover. No per-domain
read-authority switch, no fallback, no rollback path — S8.1 had nothing to roll
out. `storage/readAuthority.ts` is that mechanism and is deliberately the only
module by which a relational record can reach a response body. Off by default;
off returns the KV record *by identity* and does not read the relational store
at all. **10 live scenarios** (`test:database:cutover`) drive it through the
real repository against real rows, including every way the store can be
unready — empty table, soft-deleted row, refused connection, missed deadline —
and the rollback, which is the switch and takes effect on the next read.

| Requirement (task §C) | Outcome domain | Submission domain |
|---|---|---|
| 1. relational schema | ✅ | ✅ |
| 2. repository | ✅ | ✅ |
| 3. backfill | ✅ code, not run | ✅ code, not run |
| 4. reconciliation | ✅ live-proven | ✅ live-proven |
| 5. shadow read | ✅ | ✅ |
| 6. organization isolation | ✅ G2 | ✅ G2 |
| 7. runtime read path | ✅ wired, switch off | ⛔ **not wired — see below** |
| 8. runtime write path | KV (unchanged; S8.3) | KV (unchanged; S8.3) |
| 9. rollback / fallback | ✅ proven live | n/a until wired |
| 10. cutover readiness | ✅ mechanism ready | pending (7) |

**Why the submission domain is not simply "the same again".** The outcome
record is 1:1 — one relational row projects to the served body, which is what
made its cutover a projection. The submission route serves the KV document
*whole*, and its relational form is split across five tables (`submissions`,
`submission_sections`, `diagnostic_answers`, `diagnostic_scores`,
`domain_scores`); the comparator already excludes the answer map for exactly
that reason. Its cutover therefore needs an **aggregate read**, not a
projection, and rushing one risks silently dropping fields from a live
response. It is the next bounded unit, not a copy of the last one.

**Remaining, and what each needs:**

| Item | Needs |
|---|---|
| Submission read-authority wiring | **code** — an aggregate read across five tables |
| S7.5 outcome shadow-read validation | **live** — a mismatch rate over real traffic |
| S7.8 full runtime validation | **live** |
| Phase 2 backfill execution | **production authorisation** — code complete, not run |
| S8.1 rollout (flip the switch) | **production authorisation**, after S7.5 |
| S8.2 authority validation, S8.3 KV retirement | **live**, then a human decision |

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
| Client portal | bearer token bound to ONE submission; `?email=` on GETs only; 404 on mismatch | **E** |
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
| H1 | Chip-on-own-tint contrast | **4.17:1, under AA.** Canon does not establish the intended treatment. |
| H2 | Marketing type ramp | Deferred deliberately in UI Sprint 8. |
| H3 | The `migration/**` typecheck boundary | **24 Deno errors, all Node-targeted.** Own boundary in `typecheck-deno.mjs`, or move the code out from under `supabase/functions/`. A code change to those files is the wrong answer. |
| H4 | `typecheck:tests` | **27 errors, pre-existing and unchanged.** 23 are in Deno-targeted AI files the authoritative checker passes; the two checkers run different TypeScript versions (5.9.3 vs 6.0.3). |
| H5 | `DiagnosticQuestion` | Marked LIVE, **zero code references.** Wire it or delete it — and note `ProgressModal` is mounted *by it*, so they go together. |
| H6 | Switch on shadow reads / run the backfill / deploy / certify | Every LIVE-BLOCKED row above. |

---

## DOCUMENTATION INCONSISTENCIES

- `MARQ_CORTEX_ROADMAP.md` "Next Sprint" names work completed in `fdffd214`.
  Its own rules forbid rewriting it, so **this checklist is the correction.**
- Manifest `lastVerified: 2026-07-31`, `version: 2.1.0` — stale against
  everything since.
- `MARQ_CORTEX_STABILIZATION_ROADMAP.md` is a zero-byte file.
- `DiagnosticQuestion` / `ProgressModal` manifest status (see H5).

---

## THE NEXT V1 ITEMS, IN DEPENDENCY ORDER

1. ~~**P2 — the tenancy audit.**~~ **CLOSED** — see above.
2. **H3 + H4 — the two typecheck boundaries.** Classification, not defects, but
   they make a green tree read red. Small and dependency-safe.
3. **H5 and the manifest staleness.** Canon reconciliation.
4. **H1/H2 — the design decisions.** The last known AA gap.
5. **P1 — Phase 5**, once a human enables shadow reads and the mismatch rate is
   measured. Nothing before that is code.
