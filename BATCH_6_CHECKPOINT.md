# MARQ Cortex — Stabilization Batch 6 Checkpoint

**Branch:** `claude/marq-cortex-batch-6-resume-b6t5kc`
**Last updated:** 2026-07-19 (Workstream 6 complete)
**Governance:** Intelligence Gateway only · provider-independent · deterministic authority · LLM = language tasks only.

---

## 1. Recovered starting checkpoint

Batch 6 was resumed from repository state, not conversational memory. Evidence at recovery:

| Signal | Finding |
|--------|---------|
| Branch | `claude/marq-cortex-batch-6-resume-b6t5kc` |
| HEAD / origin/main / origin(resume) | **all identical** → `b25233a0` (`chore: untrack node_modules… (#5)`) |
| Working tree | clean (no uncommitted, staged, or untracked work) |
| Stash | empty |
| Reflog | branch freshly created from `b25233a0`; no intervening commits |
| `claude/marq-cortex-batch-6` branch | **does not exist** locally or on origin |
| Batch 6 references in tracked files | **none** |
| Batch 6 checkpoint/status doc | **did not exist** (this file is the first) |

**Conclusion:** No prior Batch 6 work (commits, branch, uncommitted work, or docs) existed. The previous
session left nothing to preserve. Batch 6 is effectively a fresh start on top of the merged Batch 5 baseline.
No work was discarded — there was none to discard.

---

## 2. Workstream classification (evidence-based)

| # | Workstream | Status | Basis |
|---|------------|--------|-------|
| 1 | Remaining AI surfaces (AIAssistant, InlineAITrigger) | **RECONCILED — see below** | Executed this session |
| 2 | A/B testing (ABTestingPanel) | **GATED BY EXTERNAL PREREQUISITE** | Manifest: not in nav; needs data volume |
| 3 | Learning loop (LearningLoopPanel) | **GATED BY EXTERNAL PREREQUISITE** | Manifest: needs ≥50 closed submissions |
| 4 | CRM integration (CRMSyncPanel) | **GATED BY EXTERNAL PREREQUISITE** | Manifest: needs CRM API credentials + webhook |
| 5 | Storage authority & SQL cutover | **IN PROGRESS (roadmap-paced) / DEFERRED** | Roadmap at MCV2-S7.4 (Outcome Shadow Read); blanket cutover prohibited |
| 6 | Feature flags & configuration | **COMPLETE** (fixes require deployment) | Audit + fixes executed — see §8 |
| 7 | Security & data protection | **NOT STARTED (this session)** | Not re-assessed |
| 8 | Observability & operations | **NOT STARTED (this session)** | Not re-assessed |
| 9 | Deployment & production readiness | **NOT STARTED (this session)** | `DEPLOYMENT_GUIDE.md` exists; not re-assessed |
| 10 | Manifest & documentation reconciliation | **IN PROGRESS** | AI-surface nodes + header node-counts reconciled this session |

### Why the GATED workstreams stay GATED
Per Batch 6 governance ("Do not create fake CRM/experimentation/learning integrations… retain a
production-safe GATED state and document the exact activation requirement"), workstreams 2–4 are **correctly
gated by genuine external prerequisites** and must not be promoted:

- **ABTestingPanel (MQC-COMP-059):** activation = wired into AnalyticsDashboard once sufficient variant/
  outcome data volume exists. No fake experiment assignment/winner logic added.
- **LearningLoopPanel (MQC-COMP-061):** activation = ≥50 closed submissions to produce a meaningful
  win/loss feedback signal. No fabricated learning loop added.
- **CRMSyncPanel (MQC-COMP-067):** activation = CRM API credentials configured + backend webhook endpoint
  wired (HubSpot/Salesforce). `crmEngine` exists; the outbound integration does not. No fake CRM sync added.

### Storage authority (workstream 5)
`MARQ_CORTEX_ROADMAP.md.txt` is the single source of truth: current sprint **MCV2-S7.4 Outcome Shadow Read
(🔄)**, storage authority = **KV**, SQL authority = **No**. A blanket SQL cutover is explicitly out of scope.
Cutover proceeds only per the roadmap's per-domain shadow-read → validation → authority sprints (S7.4–S8.3),
each gated by migration parity, tenant isolation, and rollback. **No KV data or fallback path was deleted.**

---

## 3. Work executed this session

### Workstream 1 — Remaining AI surfaces (RECONCILED)

**AIAssistant (MQC-COMP-049): DEMO → LIVE.**
- Finding: the component is **100% deterministic** — its guidance comes from keyword routing + a static
  industry table, with **no LLM, no network, no mock bypass**. Its prior manifest dependencies on the
  Intelligence Gateway (MQC-CORE-001) and useAI hook (MQC-HOOK-006) were **inaccurate** — it imports neither.
- Change: extracted the deterministic logic into a new pure core module **`diagnosticAssistantHelp.ts`
  (MQC-CORE-037)** so it is unit-testable and cleanly separated from presentation; `AIAssistant.tsx` now
  imports it. Reclassified LIVE (works end-to-end, real deterministic output, no mock) with corrected deps
  (`MQC-CORE-037`) and dependents (`MQC-COMP-004` DiagnosticForm).
- Governance: the assistant only explains/guides; it never scores, prices, or determines any outcome.
  Locked by `tests/features/diagnosticAssistantHelp.test.ts` (17 assertions incl. a determinism check and a
  "no LLM/network import" source assertion).

**InlineAITrigger (MQC-COMP-050): stays DEMO (correctly).**
- Finding: purely presentational — it only calls `openChat()` on GlobalAIChatContext (**MQC-HOOK-006**, which
  is the correct existing dependency). It holds no data path of its own. The panel it opens, **GlobalAIChat
  (MQC-COMP-046), is itself DEMO** ("responses are mocked" until the `cortexChat` gateway live path is
  validated & promoted). Promoting the trigger to LIVE would over-claim a live state that does not exist.
- Change: corrected metadata only — added the four verified consumers as dependents
  (`MQC-COMP-019`, `MQC-COMP-038`, `MQC-COMP-045`, `MQC-PAGE-010`) and documented the gating relationship.
  Status intentionally unchanged. It promotes to LIVE only when GlobalAIChat does.

**AI governance verification (chat path):** `cortexChat.ts` routes through the Intelligence Gateway
(`isGatewayEnabledForFeature('chat')` → `featureBridge.gatewayGenerateChat`), which is provider-independent
(openai + mock adapters). It is a **language-only** task (writing/tone/narrative) and explicitly honors the
core rule. Batch 5's `proposalSectionCopilot` fact-lock precedent protects authoritative fields server-side.

### Workstream 10 — Manifest reconciliation (partial)
- Added node **MQC-CORE-037** (`diagnosticAssistantHelp`).
- Corrected MQC-COMP-049 and MQC-COMP-050 status/deps/dependents/notes.
- Fixed stale manifest header counts: was `158 (… SVC ×9 … TYPE ×7)`; actual is
  **172 (PAGE ×12 · COMP ×89 · CORE ×37 · SVC ×18 · HOOK ×6 · TYPE ×9)**. Bumped `lastVerified` → 2026-07-19.

---

## 4. Tests & builds executed

| Check | Command | Result |
|-------|---------|--------|
| New governance test | `node --experimental-strip-types --test tests/features/diagnosticAssistantHelp.test.ts` | **17 pass / 0 fail** |
| Full feature suite (regression) | `npm run test:features` | **65 pass / 0 fail** (20 suites) |
| Production build | `npm run build` (after `npm install`) | **✓ built in ~12.6s** (pre-existing chunk-size warnings only) |
| Typecheck | — | No `tsconfig.json` in repo; Vite/esbuild is the compile gate (build passed). |

---

## 5. Files changed this session
- **Added:** `src/app/core/diagnosticAssistantHelp.ts`, `tests/features/diagnosticAssistantHelp.test.ts`, `BATCH_6_CHECKPOINT.md`
- **Modified:** `src/app/components/AIAssistant.tsx` (import extracted logic), `src/system/manifest.ts` (nodes + header)
- **Deleted:** none

---

## 6. Known risks / blockers
- None introduced this session. AIAssistant refactor is behavior-preserving (logic moved verbatim, covered by tests + build).
- Workstreams 6–9 (feature flags, security, observability, deployment) have **not yet been re-assessed** in Batch 6.
- SQL cutover remains roadmap-paced; do not accelerate without the S7.x/S8.x gates.

---

## 7. Exact remaining Batch 6 tasks (next-action order)
1. **Workstream 6 — Feature flags & configuration:** audit `src/config/features.ts` + gateway config; confirm each DEMO/GATED surface's flag and activation requirement is documented and production-safe.
2. **Workstream 7 — Security & data protection:** verify server-side authoritative-field protection, tenant isolation, and auth on any newly-exposed endpoints.
3. **Workstream 8 — Observability & operations:** confirm logging/metrics/error surfaces for the gateway and storage runtime.
4. **Workstream 9 — Deployment & production readiness:** reconcile `DEPLOYMENT_GUIDE.md` against current state; no live Supabase/Vercel/CRM verification claimed unless actually run.
5. **Workstream 10 (finish):** full manifest/API_SPECIFICATIONS reconciliation pass.
6. **Workstream 5:** advance only the current roadmap sprint (S7.4) if in scope — no blanket cutover.

**Recommended next action:** Workstream 7 (security & data protection) — see §8 for the completed Workstream 6 audit.

---

## 8. Workstream 6 — Feature-flag & configuration audit (COMPLETE)

Scope: configuration, flags, runtime mode selection, secrets, provider config, auth
boundaries, demo/live behavior. Fixes limited to production-safety and config accuracy.

### Findings & dispositions

| # | Finding | Severity | Disposition |
|---|---------|----------|-------------|
| F1 | `seedAdminUser()` created a Supabase admin with a **hardcoded default password** (`TEAM_ADMIN_PASSWORD \|\| 'CortexAdmin2026!'`) when the secret was unset — fail-**open**. | **LAUNCH BLOCKER** | **FIXED** — now fails closed via `resolveAdminSeed()`; seeds only when both `TEAM_ADMIN_EMAIL` + `TEAM_ADMIN_PASSWORD` are set, else skips with a clear log. No default credential exists. |
| F2 | `ClientPortal` showed a **fabricated client-facing submission + report** on a live API failure. | **LAUNCH BLOCKER** | **FIXED** — live failure now surfaces an honest error screen; demo data gated behind `canUseDemoFallback()`. |
| F3 | `FullFeaturedDashboard` substituted `SEED_SUBMISSIONS` on a live error **and** whenever a successful live response was empty. | **LAUNCH BLOCKER** | **FIXED** — live mode reflects the real (possibly empty) dataset; seed only in demo mode. |
| F4 | `AnalyticsDashboard` fabricated analytics on live error. | **HIGH** | **FIXED** — honest error + empty state in live mode. |
| F5 | `EngagementIntelligence` fabricated engagement metrics (`viewRate: 80`, …) on live error. | **HIGH** | **FIXED** — honest error state in live mode. |
| F6 | `TeamManagement` fabricated a team roster on live error. | **HIGH** | **FIXED** — honest error + empty state in live mode. |
| F7 | `SettingsPage` fabricated settings **and a stand-in admin identity** (`teamRole: 'admin'`) on live error. | **HIGH** | **FIXED** — honest error; no fabricated identity in live mode. |
| F8 | `features.ts` / `registryData.ts` documented `SHOW_API_ERRORS=false` as "silent fallback to demo data" — misleading and dangerous framing. | **DOCUMENTATION** | **FIXED** — clarified the flag controls only the error banner and never fabricates data. |
| F9 | `DEPLOYMENT_GUIDE.md` env section listed non-runtime names (`SENDGRID_API_KEY`, `SUPABASE_SERVICE_KEY`). | **DOCUMENTATION** | **FIXED** — added an authoritative Edge Function Secrets table matching runtime. |

### Root-cause pattern (F2–F7)
Each affected `load()` early-returns demo data when `!isBackendEnabled()`, so its
`catch` block only ever runs in **live** mode. The former "fall back to demo data on
error" branches therefore substituted fabricated data **exclusively in production**.
All are now funneled through **`canUseDemoFallback()`** (`src/config/runtime.ts`),
which is true only in demo mode — so live failures render an honest error/empty state.
The demo branch is retained as documented defence-in-depth (unreachable in live mode).

### Validations that PASSED (no change needed)
1. Secrets are server-side only (`Deno.env`); **no secret is exposed via any `VITE_` var** (#8).
2. AI routes **fail closed** when `OPENAI_API_KEY` is missing — legacy path throws; the
   gateway's OpenAI adapter throws `MISSING_CREDENTIALS`; active provider is `openai`,
   not `mock`; no auto-fallback to the mock provider (#2, #7, #9).
3. Team routes enforce `verifyTeamToken()` → 401; client vs team auth is separated (#3).
4. `BACKEND_INTEGRATION` / `SHOW_API_ERRORS` / `VERBOSE_LOGGING` have explicit safe
   defaults (all `false`) via `envFlag()` (#4).
5. LIVE manifest features require no undocumented flags; GATED features (CRM/A-B/Learning)
   remain honestly gated (#5, #6).
6. `ProposalViewer`, `ClientMessaging`, `TeamMessageThread` already handled live failures
   honestly (error or empty `[]`, no fabrication) — left unchanged.

### Files changed (Workstream 6)
- **Added:** `supabase/functions/server/adminSeedPolicy.ts`, `tests/features/adminSeedPolicy.test.ts`
- **Modified:** `src/config/runtime.ts` (+`canUseDemoFallback`), `src/config/features.ts` (doc),
  `src/app/utils/registryData.ts` (doc), `DEPLOYMENT_GUIDE.md` (secrets table),
  `supabase/functions/server/index.tsx` (fail-closed admin seed),
  `src/app/components/{ClientPortal,FullFeaturedDashboard,AnalyticsDashboard,EngagementIntelligence,TeamManagement,SettingsPage}.tsx`

### Tests & build (Workstream 6)
- `adminSeedPolicy.test.ts` — **7/7 pass** (fail-closed matrix).
- `npm run test:features` — **72/72 pass** (22 suites).
- `npm run test:intelligence` — **8/8 pass**.
- `npm run build` — **✓** (frontend compiles with all 6 component fixes).

### Known limitations / manual actions
- **Deployment-gated:** the fixes take effect on the next Edge Function + frontend deploy.
  In production, **set `TEAM_ADMIN_EMAIL` + `TEAM_ADMIN_PASSWORD`** or no admin is seeded
  (by design). This is a required manual action before go-live.
- `canUseDemoFallback()` is a trivial derivation of `isDemoMode()`; it is validated by the
  production build (not a standalone unit test) because `src/config` depends on Vite's
  `import.meta.env` and the `@/` alias, which the node test runner does not resolve.
- The Deno edge function (`index.tsx`) is not runnable in this environment (no Deno); the
  changed decision logic is covered by `adminSeedPolicy.test.ts`, and the wiring is a simple
  import + call of that tested helper.
