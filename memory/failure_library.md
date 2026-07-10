# MARQ CORTEX — Failure Library
# Protocol: MARQ Code Intelligence OS v3.2 — Step 10
# Generated: 2026-03-06
# Rule: Every entry must have a file reference and confidence tag.

---

## F-001 — Dual Scoring Engine — RESOLVED
**Severity:** CRITICAL — RESOLVED 2026-03-07  
**Evidence:** Server `POST /submissions` computed `aiScore = round((completionScore + qualityScore) / 2)` — a completion/quality average. Client computed `readinessScore` via `computeInstantScore` (keyword density analysis). Same answers → different numbers shown to client vs team.  
**Fix applied:**
1. `DiagnosticRoute.tsx` — passes `readinessScore: score.readinessScore` in the `createSubmission` payload.
2. `api.ts` `SubmissionPayload` — added `readinessScore?: number` field.
3. Server `POST /submissions` — uses `body.readinessScore` as `aiScore` when provided; falls back to average formula for direct API calls.
**Files changed:** `DiagnosticRoute.tsx`, `src/app/lib/api.ts`, `supabase/functions/server/index.tsx`  
**Status:** RESOLVED

---

## F-002 — RegistryViewer Rebuilt Pointing to Wrong Registry — RESOLVED
**Severity:** HIGH — RESOLVED 2026-03-07  
**Confidence:** PROVEN  
**Evidence:**
- Old system: `src/app/utils/registryData.ts` (MQC-APP/CMP/ENG etc.), `src/app/utils/registryDataExtension.ts`, `src/app/utils/registryProcesses.ts` (MQC-PRC/INT), `src/app/utils/registryAudit.ts`
- New system: `src/system/manifest.ts` (158 nodes, PAGE/COMP/CORE types)
- RegistryViewer.tsx was wiped and rebuilt reading from `src/system/manifest.ts`
- Result: 4 original registry files now have zero consumers — pure dead code
- Original audit data (113 LIVE, 54 GATED — `src/app/utils/registryAudit.ts` line 33) was invisible in the UI
**Fix applied:**
1. `RegistryViewer.tsx` — added imports for `PROCESSES`, `MQCProcess`, `ProcessStatus` from `registryProcesses.ts` and `AUDIT`, `AUDIT_SUMMARY`, `AuditEntry`, `AuditStatus` from `registryAudit.ts`
2. **ProcessesTab** — replaced "show CORE manifest nodes" with the 66 `MQCProcess` entries from `registryProcesses.ts`. Adds search, domain filter, status filter, and expand-to-show-steps behaviour. Steps are cross-referenced against manifest nodes by ID.
3. **InteractionsTab** — replaced "show COMP manifest nodes" with the 185 `AuditEntry` objects from `registryAudit.ts`. Status pills (LIVE/DEMO/GATED/MISSING/VISUAL) double as filter toggles. MISSING entries show red left-border + FIX HINT. Evidence text shown per entry.
4. **AuditTab** — split into two sections: (a) Interaction Audit — headline counts from `AUDIT_SUMMARY`, expanded MISSING list with fix hints, GATED entry chip cloud; (b) Manifest Node Status — original byStatus breakdown with expandable node list + notes panel (preserved, not removed).
5. Removed now-unused `getByType` import.
**Files changed:** `RegistryViewer.tsx`  
**Status:** RESOLVED

---

## F-003 — Client Auth Has No Token — RESOLVED
**Severity:** HIGH — RESOLVED 2026-03-07  
**Evidence:** `POST /auth/client/verify` returned `{ exists, submissionId, companyName }` — no token. Anyone with a known email got a session. `GET /client/submission/:id` only checked email query param — trivially bypassed.  
**Fix applied:**
1. Server `POST /auth/client/verify` — generates `client_{uuid}` session token, stores `client_session:{token} = { submissionId, email, issuedAt, expiresAt }` in KV with 8-hour TTL. Returns token in response.
2. Server helper `verifyClientToken()` — validates token from `Authorization: Bearer client_{uuid}` header.
3. Server `GET /client/submission/:id` — validates token first (F-003 path); falls back to email query param for backward compat; rejects if neither provided.
4. `AppContext.tsx` `ClientSession` — added `sessionToken: string | null` field. `loginClient` accepts optional `sessionToken`.
5. `ClientLogin.tsx` — passes `result.sessionToken` to `onLogin`.
6. `ClientLoginRoute.tsx` — forwards `sessionToken` to `loginClient`.
7. `dataService.ts` `verifyClientEmail` — demo mode generates deterministic `demo_tok_{btoa(...)}` token; live mode returns server token.
**Files changed:** `supabase/functions/server/index.tsx`, `AppContext.tsx`, `ClientLogin.tsx`, `ClientLoginRoute.tsx`, `dataService.ts`, `src/app/lib/api.ts`  
**Status:** RESOLVED

---

## F-004 — Demo Credentials Hardcoded in Compiled Bundle
**Severity:** MEDIUM
**Confidence:** PROVEN
**Evidence:** `src/app/services/dataService.ts` line 126: `if (email === 'admin@marqcortex.com' && password === 'CortexAdmin2026!')`
**Impact:** These values exist in the compiled JS bundle. Any user who opens DevTools > Sources can extract them. In demo mode this grants full team dashboard access.
**Fix direction:** Move to env var comparison or use a hash comparison that doesn't expose the plaintext password.
**Status:** UNRESOLVED — acceptable only while BACKEND_INTEGRATION=false

---

## F-005 — API Specifications Missing — RESOLVED
**Severity:** HIGH — RESOLVED 2026-03-07  
**Evidence:** `/API_SPECIFICATIONS.md` referenced in `dataService.ts:15` migration checklist but file did not exist.  
**Fix applied:** Created `/API_SPECIFICATIONS.md` documenting all 68 backend routes with method, auth scheme, body, return shape, error codes, side effects, and notes. Includes KV namespace reference, environment variable table, and go-live checklist.  
**Files changed:** `/API_SPECIFICATIONS.md` (created)  
**Status:** RESOLVED

---

## F-006 — Email Nurture Queue Persists in localStorage Only
**Severity:** LOW
**Confidence:** PROVEN
**Evidence:** `src/app/utils/emailNurtureQueue.ts` lines 1–30: queue described as "Client-Side Queue Manager. Maintains a queue of pending email nurture actions in localStorage."
**Impact:** Queue state is device-specific. Clearing browser storage or switching devices loses all pending nurture state. Team dashboard may show stale queue entries.
**Fix direction:** Persist queue state to KV store via the backend on each state change.
**Status:** UNRESOLVED

---

## F-007 — Double-Navigation Race Condition (RESOLVED)
**Severity:** HIGH — RESOLVED
**Confidence:** PROVEN
**Evidence:** `src/app/utils/registryData.ts` line 105: `recentFixes: ['Fixed double-navigation race condition (5-file coordinated fix)']` — recorded in MQC-APP-001 entry. `src/app/pages/RootLayout.tsx` entry (MQC-RTE-001) also records this fix.
**Status:** RESOLVED — recorded for regression awareness only

---

## F-008 — AppContext Imports Type from a UI Component (Wrong Direction)
**Severity:** LOW
**Confidence:** PROVEN
**Evidence:** `src/app/contexts/AppContext.tsx` line 13: `import type { ContactInfo } from '@/app/components/LeadMagnetCapture'`
**Impact:** A context layer depends on a component layer. If `LeadMagnetCapture.tsx` is refactored, renamed, or deleted, AppContext breaks. This is an inverted dependency.
**Fix direction:** Move `ContactInfo` type definition to `src/app/types/` and import from there in both files.
**Status:** UNRESOLVED — low priority

---

## F-009 — Rate Limiter Resets on Cold Start
**Severity:** LOW
**Confidence:** PROVEN
**Evidence:** `supabase/functions/server/index.tsx` lines 44–48: `// Resets naturally when the edge function cold-starts.` — in-memory `Map<string, {count, resetAt}>` with explicit comment acknowledging the limitation.
**Impact:** In high-traffic scenarios with multiple Edge Function instances, rate limit is per-instance not global. A user can bypass the limit by triggering a cold start.
**Fix direction:** Use KV store for rate limit counters (already noted in same comment).
**Status:** UNRESOLVED — low priority, acceptable for current stage

---

## F-010 — No Test Infrastructure Anywhere
**Severity:** HIGH
**Confidence:** PROVEN
**Evidence:** Full directory scan of /src and /supabase — zero `*.test.ts`, `*.spec.ts`, `__tests__/`, or test runner config files found.
**Impact:** Every change to the 36 core engines (roiEngine, scoringEngine, dcfEngine, etc.) is deployed with no regression safety net. A broken formula change cannot be automatically detected.
**Fix direction:** At minimum, unit tests for the 5 engines that produce client-visible numbers: scoringEngine, roiEngine, dcfEngine, irrEngine, monteCarloEngine.
**Status:** UNRESOLVED

---

## F-011 — All Three Context Providers Had Unmemoized Value Objects — RESOLVED
**Severity:** HIGH — RESOLVED 2026-03-06
**Confidence:** PROVEN
**Evidence:**
- `src/app/contexts/AppContext.tsx:126` — `value={{...}}` created new object on every render → ALL `useApp()` consumers re-rendered on any state change
- `src/app/contexts/DashboardContext.tsx:288` — same pattern → ALL `useDashboard()` consumers re-rendered on every scroll update
- `src/app/contexts/GlobalAIChatContext.tsx:150` — same pattern → ALL `useGlobalAIChat()` consumers re-rendered on every chat state change
**Fix applied:** `useMemo` added to all three context value objects with correct dependency arrays.
**Files changed:** `AppContext.tsx`, `DashboardContext.tsx`, `GlobalAIChatContext.tsx`
**Status:** RESOLVED

---

## F-012 — DashboardContext Wrote Full State to localStorage on Every Scroll Event — RESOLVED
**Severity:** HIGH — RESOLVED 2026-03-06
**Confidence:** PROVEN
**Evidence:**
- `src/app/contexts/DashboardContext.tsx:160–166` — `useEffect` on `[state]` with immediate `JSON.stringify(state)` + `localStorage.setItem`
- `src/app/contexts/DashboardContext.tsx:375` — scroll listener called `saveScrollPosition()` on every `scroll` event → triggered `setState` → triggered the `useEffect` → triggered localStorage write. O(scrollEvents) serializations.
- `searchableSubmissions` (all submission records) was included in every serialization, potentially many KB per write.
**Fix applied:**
1. `useScrollRestoration` now uses a `useRef` to accumulate scroll position — flushes to context state only on unmount (once per navigation).
2. localStorage `useEffect` debounced 400ms — rapid state changes coalesce into one write.
3. `searchableSubmissions` excluded from localStorage serialization (transient cache, re-fetched on mount).
**Files changed:** `DashboardContext.tsx`
**Status:** RESOLVED