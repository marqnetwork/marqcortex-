# MARQ Cortex — V1 Completion Checklist

**The single authoritative V1 checklist.** It replaces the "next task" lists
scattered through `AUTONOMOUS_BUILD_PROGRESS.md`; that file remains the
narrative record of how each item was closed, and this one is the state.

Sources: `MARQ_CORTEX_PRODUCT_EXPERIENCE.md`, `MARQ_CORTEX_ONTOLOGY_v1.0.md`,
`MARQ_CORTEX_MASTER_BLUEPRINT_v1.0.md` (§VI-5 gap register),
`MARQ_CORTEX_REFERENCE_ARCHITECTURE_v1.0.md`,
`MARQ_CORTEX_IMPLEMENTATION_GUIDE_v1.0.md`, `MARQ_CORTEX_ROADMAP.md`, and the
327-node `src/system/manifest.ts`.

Verified against merged main **`1f4ef999`**. Last updated 2026-09-10.

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

---

## PARTIAL

### P1 — Data authority is still KV (**G1**)

- **Canon** — Master Blueprint §VI-5 G1; Roadmap Phases 4–5.
- **Now** — schema, migrations, repositories, backfills, reconciliation and
  shadow reads all exist and pass. `index.tsx` imports no repository and no
  route serves a relational row. "Current Runtime Authority: KV."
- **Remaining** — S7.5 outcome validation, S7.8 full runtime validation, then
  S8.1 SQL read rollout, S8.2 authority validation, S8.3 KV retirement.
- **Depends on** — a deployment with shadow reads enabled and real traffic.
- **Requires** — **live verification and deployment, then a human decision.**
  No code is known to be missing.

### P2 — Multi-tenancy enforcement (**G2**)

- **Canon** — §VI-5 G2; Reference Architecture tenancy model.
- **Now** — `organizations`, RLS policies, `tenancyRepository`, and
  organization-scoped filters in every repository. The service client bypasses
  RLS, so repository scoping is the guard on that path.
- **Remaining** — enumerate every path that trusts a caller-supplied
  `organization_id` where the database does not enforce it. **Two confirmed
  instances of the database not enforcing what code assumes:** a
  `report_versions` row may name a parent report in another organization
  (proven live, MQC-SVC-015), and `submissions.legacy_kv_key` is *globally*
  unique rather than per-organization (proven live, reconciliation scenarios).
  Neither is a defect today; both mean the invariant lives in code alone.
- **Depends on** — nothing. Auditable now.
- **Requires** — **code** (an audit, then guards or constraints where missing).

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

1. **P2 — the tenancy audit.** The only PARTIAL item that is closable with code
   alone, needs no deployment, and already has two confirmed findings. Highest
   value per unit of risk.
2. **H3 + H4 — the two typecheck boundaries.** Classification, not defects, but
   they make a green tree read red. Small and dependency-safe.
3. **H5 and the manifest staleness.** Canon reconciliation.
4. **H1/H2 — the design decisions.** The last known AA gap.
5. **P1 — Phase 5**, once a human enables shadow reads and the mismatch rate is
   measured. Nothing before that is code.
