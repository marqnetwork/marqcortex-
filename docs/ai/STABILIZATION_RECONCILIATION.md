# MARQ Cortex — Stabilization Recovery & Reconciliation

**Generated:** 2026-07-17
**Branch:** `claude/marq-cortex-stabilization-recovery-1990jj`
**Mode:** Analysis & reconciliation only — no product code changed.
**Evidence rule:** Every remaining item cites a repository file (and line where possible). Confidence tags follow the Constitution Article 10 / `src/imports/marq-os-report.md` protocol: **PROVEN / LIKELY / SUSPECTED / MISSING EVIDENCE**.

---

## 0. Reconciliation Notes (read this first)

Two premises in the task did not match the repository as it stands. Recording them is part of the recovery:

1. **The prescribed `docs/ai/*` "AI Operating System" files do not exist.** None of
   `AI_START_HERE.md`, `docs/ai/MARQ_CORTEX.md`, `docs/ai/ACTIVE_WORK.md`, `docs/ai/ROADMAP.md`,
   `docs/ai/STABILIZATION.md`, `docs/ai/CHANGELOG_AI.md`, or `docs/ai/DECISIONS.md` are present
   (verified by direct read — all returned "file does not exist"). The governance they describe
   **does** exist, but under different paths. This document is placed at `docs/ai/` to establish
   that home and reconcile the two structures. **Actual governance surface:**

   | Assumed AI-OS file | Real repository artifact (evidence) |
   |---|---|
   | `docs/ai/MARQ_CORTEX.md` (charter) | `MARQ_CORTEX_CONSTITUTION.md` (v1.1, 17 Articles) |
   | `docs/ai/ROADMAP.md` | `MARQ_CORTEX_ROADMAP.md.txt` (Phase 1–5 sprint table) |
   | `docs/ai/STABILIZATION.md` | `MARQ_CORTEX_STABILIZATION_ROADMAP.md.txt` — **exists but is 0 bytes / empty** |
   | `docs/ai/ACTIVE_WORK.md` | `MARQ_CORTEX_ROADMAP.md.txt` § "Current Sprint" + `MARQ_CORTEX_EXECUTION_RULES.md.txt` |
   | `docs/ai/CHANGELOG_AI.md` | `architecture/database/MCV2-S*-COMPLETION.md` reports + git history |
   | `docs/ai/DECISIONS.md` | `architecture/database/MCV2-S3-ARCHITECTURE-DECISION-REGISTER.md` |
   | (audit memory) | `memory/failure_library.md`, `memory/regression_cases.md`, `src/imports/cortex-audit-report.md` |

   The empty `MARQ_CORTEX_STABILIZATION_ROADMAP.md.txt` is direct evidence that **the stabilization
   roadmap was never written down** — this document fills that gap from repository evidence.

2. **"66 Fixes" is not a fixes count.** The task already flags the phrase as conversational
   shorthand. Repository evidence pins its origin: `registryProcesses.ts` contains exactly **66**
   `MQC-PRC` process entries (`grep -c "id: 'MQC-PRC'"` → 66), and `memory/failure_library.md`
   F-002 line 31 explicitly says the RegistryViewer was rebuilt to show *"the 66 `MQCProcess`
   entries from `registryProcesses.ts`."* The number is the **66 registry processes**, not 66
   outstanding fixes. The authoritative, tractable backlog is instead the **interaction audit**
   (`registryAudit.ts`, 185 entries) and the **failure library** (`memory/failure_library.md`,
   F-001…F-012). This reconciliation is built on those, not on "66."

---

## 1. Completed Stabilization Work (PROVEN)

Evidence sources: `MARQ_CORTEX_ROADMAP.md.txt`, `memory/failure_library.md`,
`architecture/database/MCV2-S*-COMPLETION.md`, git history, `src/imports/cortex-audit-report.md`.

### 1a. Sprint / phase track (per `MARQ_CORTEX_ROADMAP.md.txt`)
- **Phase 1 — AI Foundation:** S1 Intelligence Gateway ✅, S2 Frontend Gateway Normalization ✅.
- **Phase 2 — Data Platform:** S3 Database Architecture ✅, S4 Tenancy Foundation ✅, S5 Diagnostic Foundation ✅.
  Corroborated by completion reports `MCV2-S4-IMPLEMENT-001-COMPLETION.md`, `MCV2-S5-IMPLEMENT-002-COMPLETION.md`, `MCV2-S5-VALIDATE-001-COMPLETION.md`.
- **Phase 3 — KV Migration:** S6.1 Planning ✅, S6.2 Infrastructure ✅, S6.3 Validation ✅.
  Corroborated by `MCV2-S6.1-PLAN-003-...ARCHITECTURE.md`, `MCV2-S6.2-IMPLEMENT-004-COMPLETION.md`, `MCV2-S6.2-ROLLBACK-GUIDE.md`, and Constitution v1.1 changelog (Article 17 registered under MCV2-S6.3-VALIDATE-005).
- **Phase 4 — Runtime Storage Gateway:** S7.1 Planning ✅, S7.2 Implementation ✅, S7.3 Validation ✅.

### 1b. Resolved defects (per `memory/failure_library.md`)
- **F-001** Dual scoring engine — RESOLVED (client `readinessScore` now authoritative in submission payload).
- **F-002** RegistryViewer pointed at wrong registry — RESOLVED (rebuilt to read the 66 processes + 185 audit entries).
- **F-003** Client auth had no token — RESOLVED (`client_{uuid}` session token, 8h TTL, `verifyClientToken()`).
- **F-005** API specifications missing — RESOLVED (`API_SPECIFICATIONS.md` created, all 68 routes documented).
- **F-007** Double-navigation race — RESOLVED.
- **F-011** Unmemoized context value objects (3 providers) — RESOLVED.
- **F-012** DashboardContext writing full state on every scroll — RESOLVED.

### 1c. Recent stabilization commits (git history, this line of work)
- `4d1bd0f6` — point Supabase config at the current project `oqybniefkbppptfatoae` (`.env.example`, `features.ts`, `kv_store.tsx`, `utils/supabase/info.tsx`). PROVEN.
- `3a2c930c` — stop oklch PDF error from blocking Supabase persistence (`DiagnosticRoute.tsx`, `pdfExport.ts`). PROVEN.
- `c90e63f8` — read live submissions in `TeamHomeDashboard` when backend mode is on (`TeamHomeDashboard.tsx`). PROVEN — this is the **first live-mode read path**, confirming the demo→backend cutover is now in progress.

### 1d. Structural build-out (per `src/imports/cortex-audit-report.md`)
Pre-sale system, editability + AI copilot, and post-sign delivery core are all marked structurally
**Complete**; the report's own conclusion is *"core system is complete. Nothing structural is missing."*
Remaining work there is explicitly **implementation/polish, not new architecture.**

---

## 2. Remaining Stabilization Work + 3. Repository Evidence + 4. Priority + 5. Risk

The remaining work sorts into **four evidence-backed streams**. Every row is traceable.

### STREAM A — Demo→Backend Runtime Cutover  *(the dominant remaining stream)*
The whole frontend still defaults to **demo mode**: `FEATURES.BACKEND_INTEGRATION` defaults to
`false` (`src/config/features.ts:26`; `.env.example:19` `VITE_BACKEND_INTEGRATION=false`), and
`dataService.isDemo()` returns `!BACKEND_INTEGRATION` (`dataService.ts:93-95`). The gateway carries
a documented **"80/20 migration checklist"** (`dataService.ts:8-19`) whose 20% is OPS, not code.

| # | Remaining item | Evidence | Priority | Risk |
|---|---|---|---|---|
| A1 | Deploy edge function + set secrets (`RESEND_API_KEY`, `OPENAI_API_KEY`) | `dataService.ts:12-18`; secrets absent by design (Constitution Art. 13) | **P0** | High — no live email/AI until set; Art. 8 human-review domain |
| A2 | Flip `BACKEND_INTEGRATION=true` and verify 68 routes return correct shapes | `dataService.ts:14-15`; server exposes **68** routes (`supabase/functions/server/index.tsx`, verified count) | **P0** | High — authority change; guarded by Constitution Art. 12/17 (no unauthorized cutover) |
| A3 | Backfill live-mode read/write branches for the **34 GATED** interactions | `registryAudit.ts` — 34 `status:'GATED'`; concentrated in `PipelineKanban.tsx` (11), `TeamManagement.tsx` (3), `CortexModulesNew.tsx` (3), `CortexDashboard.tsx` (3) | **P1** | Med — buttons wired but no-op until backend; per RC-009 must fail silently, not throw |
| A4 | Confirm **13 DEMO** interactions swap cleanly to live data | `registryAudit.ts` — 13 `status:'DEMO'` (Sign In, Access My Report, Save Settings, Send chat, Kanban drop, notifications, AI Assist, drill-downs, …) | **P1** | Med — visually work now; risk of silent mock/live divergence (Constitution Art. drift; OS-report Step 9) |
| A5 | Only **67** of `dataService`'s functions have a live `api.*` branch | `dataService.ts` — 67 `api.` call sites vs. every function carrying a demo branch | **P1** | Med — any function lacking a live branch stays demo after cutover |

### STREAM B — Open Defects in the Failure Library  *(UNRESOLVED entries)*
| # | Remaining item | Evidence | Priority | Risk |
|---|---|---|---|---|
| B1 | **F-004** Demo credentials hardcoded in bundle (`admin@marqcortex.com` / `CortexAdmin2026!`) | `memory/failure_library.md` F-004; `dataService.ts:~126` | **P0 at cutover** | High — Constitution Art. 8 (auth). "Acceptable only while BACKEND_INTEGRATION=false" — becomes a live vuln the moment A2 flips |
| B2 | **F-010** No test infrastructure for the core engines | `memory/failure_library.md` F-010 (zero `*.test.ts` in `/src`) | **P1** | High — Constitution Art. 9 requires regression tests; RC-005 (ROI null-safety) unguarded |
| B3 | **F-006** Email nurture queue persists to localStorage only | `memory/failure_library.md` F-006; `src/app/utils/emailNurtureQueue.ts:1-30` | **P2** | Low — device-specific state; fix = persist to KV |
| B4 | **F-009** Rate limiter resets on cold start (per-instance) | `memory/failure_library.md` F-009; `server/index.tsx:44-48` | **P2** | Low — bypassable under load; fix = KV counters |
| B5 | **F-008** `AppContext` imports a type from a UI component (inverted dep) | `memory/failure_library.md` F-008; `AppContext.tsx:13` | **P3** | Low — refactor hazard only |

> Note on F-010 vs. `src/imports/marq-os-report.md`: the failure library was generated 2026-03-06
> and states "zero test infra." Since then, backend test scaffolding **has** appeared
> (`supabase/functions/server/intelligence/gateway.test.ts`, `testSetup.ts`, `certification.ts`;
> `playwright.config.ts` + `tests/`). So F-010 is **partially superseded for the backend/gateway
> and e2e layers but still PROVEN-open for the `src/app/core/` math engines** (roiEngine, dcfEngine,
> irrEngine, monteCarloEngine, scoringEngine) — RC-005 confirms these produce client-visible numbers
> with no unit coverage. Priority stands at P1, scoped to the core engines.

### STREAM C — Dead Buttons (MISSING handlers)  *(3 items — bounded, fully specified)*
| # | Remaining item | Evidence (with fixHint) | Priority | Risk |
|---|---|---|---|---|
| C1 | Mobile menu ☰ open — no handler | `registryAudit.ts` MQC-INT-054 (`TeamDashboardLayout.tsx`) — fixHint: add `isMobileMenuOpen` state + overlay trigger | **P2** | Low — mobile UX gap |
| C2 | Mobile sidebar close × — no handler | `registryAudit.ts` MQC-INT-055 (`TeamDashboardLayout.tsx`) — fixHint: implement mobile drawer close | **P2** | Low — pairs with C1 |
| C3 | Export Analytics — logs `console.warn("Export not yet implemented")` | `registryAudit.ts` MQC-INT-153 (`AnalyticsDashboard.tsx`) | **P2** | Low — single unwired export button |

### STREAM D — Integration & Polish Layer  *(per `src/imports/cortex-audit-report.md` "ONLY 6 things")*
The structural audit's own remaining list — implementation/polish, not architecture:
| # | Remaining item | Evidence | Priority | Risk |
|---|---|---|---|---|
| D1 | Role-based UI controls (buttons/visibility reflect permissions) | `cortex-audit-report.md` item 2; `RoleSwitcher.tsx` present | **P1** | Med — ties to Art. 5 tenant/permission isolation |
| D2 | External integrations (Zoho/HubSpot, email provider, doc-sign) | `cortex-audit-report.md` item 5; `CRMSyncPanel.tsx`, `emailService.ts` scaffolds exist (no live-mode markers found in `CRMSyncPanel.tsx`) | **P1** | Med — Art. 2 provider-independence must hold |
| D3 | Notifications (Slack/email/in-app for tasks/incidents/QBR) | `cortex-audit-report.md` item 4; `NotificationCenter.tsx` (GATED) | **P2** | Low |
| D4 | Export styling templates (premium PDF) | `cortex-audit-report.md` item 3; recent oklch PDF fix `3a2c930c` shows PDF path is live but fragile | **P2** | Low–Med |
| D5 | UI layout refinement (team + client facing) | `cortex-audit-report.md` item 1 | **P3** | Low |
| D6 | Performance hardening (caching, pagination, audit-log indexing) | `cortex-audit-report.md` item 6 | **P3** | Low |

### The Phase 4–5 sprint track (roadmap-native remaining work)
`MARQ_CORTEX_ROADMAP.md.txt` lists these as the **not-yet-done sprints** — the governance-native
framing of Stream A. Current position: **S7.4 In Progress**, "Storage Authority: KV".
| Sprint | Name | Status | Maps to |
|---|---|---|---|
| S7.4 | Outcome Shadow Read | 🔄 | Stream A (current) |
| S7.5 | Outcome Validation | ⏳ | Stream A |
| S7.6 | Lead Shadow Read | ⏳ | Stream A |
| S7.7 | Submission Shadow Read | ⏳ | Stream A |
| S7.8 | Full Runtime Validation | ⏳ | Stream A / A2 gate |
| S8.1 | SQL Read Rollout | ⏳ | Phase 5 cutover |
| S8.2 | SQL Authority Validation | ⏳ | Phase 5 cutover |
| S8.3 | KV Retirement | ⏳ | Phase 5 cutover |

---

## 6. Suggested Implementation Batches

Ordered to respect the Constitution's cutover discipline (Art. 12 & 17: **validation precedes
authority**) and Execution Rules (small, reversible, bounded sprints).

- **Batch 1 — Cutover Safety Pre-reqs (P0, do before any flag flip).**
  B1 (remove hardcoded creds / move to server auth), A1 (deploy edge fn + secrets), B2-scoped
  (unit tests for the 5 core math engines per RC-005). *Rationale: F-004 becomes a live auth vuln
  the instant A2 lands; Art. 8 requires human review here.* Reversible: no runtime authority change yet.

- **Batch 2 — Complete the roadmap shadow-read track (P0/P1).**
  Finish S7.4 → S7.8 (Outcome/Lead/Submission shadow reads + full runtime validation) exactly as the
  roadmap sequences them. This is the governed vehicle for A2/A5. Each sprint independently
  reversible per Execution Rules.

- **Batch 3 — GATED/DEMO interaction backfill (P1).**
  A3 + A4. Batch by component to stay bounded (Art. 16): start `PipelineKanban.tsx` (11 GATED),
  then `TeamManagement.tsx`, `CortexModulesNew.tsx`, `CortexDashboard.tsx`. Enforce RC-009 rule:
  demo-mode paths fail silently, never throw.

- **Batch 4 — Permissions + Integrations (P1).**
  D1 (role-based UI) then D2 (CRM/email/doc-sign) — D2 must route through the Intelligence/adapter
  layer to satisfy Art. 2. Security review required (Art. 8/9).

- **Batch 5 — Bounded polish (P2/P3).**
  C1–C3 dead buttons, D3 notifications, D4 PDF templates, B3/B4 (KV-persist nurture queue + rate
  limiter), then D5/D6 and B5. All low-risk, no authority change.

- **Batch 6 — Phase 5 SQL cutover (gated).**
  S8.1 → S8.3 only after Batch 2 validation gates pass. Highest-risk; full Art. 17 checklist
  (reconciliation threshold, quarantine accounting, rollback verification, documented human review).

---

## 7. Mapping into the Governance Structure

Because the assumed `docs/ai/*` AI-OS files are absent, findings are mapped into the **artifacts that
actually govern the repo**, so nothing is orphaned:

| Stream / item | Governing artifact it belongs in |
|---|---|
| Stream A (cutover), S7.4–S8.3 | `MARQ_CORTEX_ROADMAP.md.txt` (already tracks these sprints — the SoT per its own "Rules") |
| Stream B (F-004…F-010) | `memory/failure_library.md` (update status on resolution; add regression case in `memory/regression_cases.md`) |
| Stream C (dead buttons) | `src/app/utils/registryAudit.ts` (flip MQC-INT-054/055/153 MISSING→LIVE when wired) |
| Stream D (integration/polish) | `src/imports/cortex-audit-report.md` "6 things" list |
| Authority/cutover gates | `MARQ_CORTEX_CONSTITUTION.md` Art. 12 & 17; `architecture/database/MCV2-S3-MIGRATION-ROADMAP.md` |
| Decisions taken during batches | `architecture/database/MCV2-S3-ARCHITECTURE-DECISION-REGISTER.md` |
| Per-sprint completion evidence | `architecture/database/MCV2-S*-COMPLETION.md` convention |

**Recommended (optional) reconciliation action to close the doc gap:** populate the empty
`MARQ_CORTEX_STABILIZATION_ROADMAP.md.txt` with Streams A–D above, or adopt `docs/ai/` as the AI-OS
home (this file is the first entry). Not done here to honor the task's "recover and reconcile, do not
invent work" boundary — flagged for a human decision.

---

## Appendix — Interaction Audit Totals (evidence for Streams A & C)

From `src/app/utils/registryAudit.ts` (185 total entries; `AUDIT_SUMMARY` at line 289):

| Status | Count | Meaning | Stabilization implication |
|---|---|---|---|
| LIVE | 133 | Works now, zero backend | Done |
| DEMO | 13 | Works via mock/demo data | Stream A4 — verify live swap |
| GATED | 34 | Wired, needs `BACKEND_INTEGRATION=true` | Stream A3 — dominant cutover work |
| MISSING | 3 | Dead button, no handler | Stream C — wire handlers |
| VISUAL | 2 | Display-only, no handler expected | No action |

**Confidence of this reconciliation:** PROVEN for Sections 1, 2 (Streams A–C), Appendix (direct file
evidence). LIKELY for Stream D scope (relies on `cortex-audit-report.md` self-assessment).
No invented work: every item above resolves to a cited file.
