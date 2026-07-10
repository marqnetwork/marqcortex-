# MARQ CORTEX — Regression Cases
# Protocol: MARQ Code Intelligence OS v3.2 — Step 10
# Generated: 2026-03-06
# Rule: Every case must reference the specific files and behaviors being protected.

---

## RC-001 — Diagnostic Submission → Score Display
**Protects:** F-001 (dual scoring systems)
**Files involved:**
- `src/app/components/DiagnosticForm.tsx` — form + submit handler
- `src/app/utils/instantScoring.ts` — browser-side scoring
- `src/app/contexts/AppContext.tsx` — `setScoreResult` stores result
- `src/app/pages/ScorePage.tsx` (or equivalent) — reads `scoreResult`
**Audit evidence:** `src/app/utils/registryAudit.ts` line 48 — MQC-INT-011: "instantScoring(answers) runs client-side → ScorePage shown; submission POST is async/non-blocking"
**Steps:**
1. Navigate to `#/diagnostic`, complete all 14 questions
2. Submit — ScorePage must appear with: score number, band label, at least 3 key findings, ROI range
3. Score must be a number between 0–100 and match `InstantScoreResult.overallScore`
4. No NaN, no `undefined`, no blank panels
**Pass criteria:** Score panel renders, number is valid, findings list is populated
**Regression risk:** HIGH — any change to instantScoring.ts changes what every client sees

---

## RC-002 — Team Login → Dashboard
**Protects:** F-004 (hardcoded demo credentials), AppContext session persistence
**Files involved:**
- `src/app/components/TeamLogin.tsx`
- `src/app/services/dataService.ts` lines 120–136
- `src/app/contexts/AppContext.tsx` lines 103–110 (`loginTeam`)
- `localStorage` key: `marq_cortex_team_session` (line 60)
**Steps:**
1. Navigate to `#/team/login`
2. Enter `admin@marqcortex.com` / `CortexAdmin2026!`
3. Dashboard must load — submission list visible, pipeline counts non-zero
4. Hard-refresh the page — session must persist (localStorage check)
5. Session must expire after 8 hours (TTL key: `marq_cortex_team_session_expiry` — AppContext.tsx line 18)
**Pass criteria:** All panels load, session survives refresh, expires correctly
**Regression risk:** MEDIUM

---

## RC-003 — RegistryViewer All 7 Tabs
**Protects:** F-002 (RegistryViewer rebuild), manifest.ts integrity
**Files involved:**
- `src/app/components/RegistryViewer.tsx`
- `src/system/manifest.ts` (158 nodes)
- `src/system/validate.ts` (7 integrity checks)
**Steps:**
1. Navigate to `#/registry`
2. Registry tab: total node count = 158. Search "scoring" → returns scoringEngine and related nodes. Debounce delay visible (~300ms).
3. Validation tab: click Run → all 7 checks pass → green report
4. Stats tab: counts by type shown — COMP=89, CORE=35, PAGE=12, SVC=9
5. Dependencies tab: click any node → dependency chain renders without error
6. Processes tab: 35 CORE nodes shown, Show More pagination works
7. Interactions tab: 89 COMP nodes shown, domain filter works
8. Audit tab: LIVE/GATED/DEMO breakdown visible
**Pass criteria:** All tabs render, no blank panels, search and pagination functional
**Regression risk:** HIGH — RegistryViewer was recently rebuilt from scratch

---

## RC-004 — Client Portal Tab Order
**Protects:** PV-009 (tab order must not change)
**Files involved:**
- `src/app/components/ClientPortal.tsx`
- `src/app/utils/registryAudit.ts` lines 73–82 (MQC-INT-027 through MQC-INT-034 confirm exact tab order)
**Required order:** Status → Solution → Readiness Report → Schedule a Call → Proposal → Messages → Your Assessment → Strategic Report
**Steps:**
1. Log in as `client@company.com` (demo submissionId: `demo-sub-001` — `src/app/utils/demoData.ts` line 33)
2. Portal opens on Status tab
3. Click every tab in sequence — each must render without blank screen
4. Proposal tab must show gate status (locked or unlocked depending on submission state)
**Pass criteria:** All 8 tabs render, tab order matches specification
**Regression risk:** MEDIUM

---

## RC-005 — ROI Panel Null Safety
**Protects:** PV-002 (toFixed without null guard)
**Files involved:**
- `src/app/core/roiEngine.ts`
- `src/app/core/dcfEngine.ts`
- `src/app/core/irrEngine.ts`
- `src/app/core/monteCarloEngine.ts`
- All ROI display components in team dashboard
**Steps:**
1. Open ROI panel for a submission with incomplete data (null fields)
2. Every number display must show `0` or a valid fallback
3. Grep the codebase for `.toFixed(` not preceded by `?? 0` — count must be 0
**Pass criteria:** Zero NaN or undefined visible in any number display
**Convention to enforce:** `(value ?? 0).toFixed(2)` — never `value.toFixed(2)`
**Regression risk:** HIGH — any new number display component skipping `?? 0` will show NaN in production

---

## RC-006 — GlobalAIChatProvider Layer Order
**Protects:** PV-010 (provider layer order in TeamDashboardLayout)
**Files involved:**
- `src/app/components/TeamDashboardLayout.tsx`
**Required structure:**
```
<GlobalAIChatProvider>        ← OUTER
  <DashboardContextProvider>  ← INNER
    <Outlet />
  </DashboardContextProvider>
</GlobalAIChatProvider>
```
**Steps:**
1. Open team dashboard
2. Open GlobalAIChat panel — chat must function
3. From inside a dashboard panel that uses DashboardContext — chat must still function
4. Swap order (test only) — DashboardContext panels should break without GlobalAIChat context
**Pass criteria:** Chat works from every panel location
**Regression risk:** MEDIUM

---

## RC-007 — Lazy Route Chunking
**Protects:** App.tsx split points, PV-006 (TeamDashboardNew panel lazy loading)
**Files involved:**
- `src/app/App.tsx` — route definitions
- `src/app/components/TeamDashboardNew.tsx` — must use React.lazy() for all panels
**Steps:**
1. Open Network tab in browser, filter JS
2. Navigate to `#/` — only landing bundle loads
3. Navigate to `#/team/dashboard` — TeamDashboardRoute chunk appears
4. Navigate to `#/registry` — RegistryViewer chunk appears
5. Confirm no route eagerly loads chunks it shouldn't
**Pass criteria:** Chunk separation maintained, no blank screen on route transitions
**Regression risk:** MEDIUM

---

## RC-008 — Proposal Gate Enforcement
**Protects:** proposalGateEngine.ts logic
**Files involved:**
- `src/app/core/proposalGateEngine.ts`
- `src/app/components/ClientPortal.tsx` — reads proposal status
- `src/app/services/dataService.ts` — updateProposalStatus
**Steps:**
1. Find a submission with proposal status `draft` (not `sent`)
2. Client portal for that submission: Proposal tab must show locked/pending state
3. Team sets proposal to `sent` via ProposalControlPanel
4. Client portal for same submission: Proposal tab must now show proposal content
**Pass criteria:** Gate is enforced — client cannot see proposal before team marks it sent
**Regression risk:** MEDIUM

---

## RC-009 — Exit Intent Popup — GATED Interaction
**Protects:** MQC-INT-019 GATED status
**Files involved:**
- `src/app/components/ExitIntentPopup.tsx`
- `src/app/utils/registryAudit.ts` line 60: MQC-INT-019 `status: 'GATED'` — "fails silently if BACKEND_INTEGRATION=false"
**Steps:**
1. With BACKEND_INTEGRATION=false: trigger exit intent popup, submit email → must fail silently (no error shown to user, no crash)
2. With BACKEND_INTEGRATION=true: submit email → POST `/leads/exit-intent` must receive a valid response
**Pass criteria:** Silent failure in demo mode, functional in live mode
**Note:** This is one of 3 MISSING/GATED interactions without a demo fallback — acceptable but must not throw or show raw error
**Regression risk:** LOW in demo, HIGH when going live
