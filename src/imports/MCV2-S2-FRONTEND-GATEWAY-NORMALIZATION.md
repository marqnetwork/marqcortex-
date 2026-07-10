# MCV2-S2 — Frontend Gateway Normalization

| Field | Value |
|-------|-------|
| **Sprint ID** | MCV2-S2-FRONTEND-GATEWAY-NORMALIZATION |
| **Completed** | 2026-07-11 |
| **Runtime mode** | DEMO (`BACKEND_INTEGRATION: false`) |
| **Authority** | `MCV2-S1-AUDIT-001`, `MCV2-S1-IMPLEMENT-001.5` |

---

## Objective

Migrate all frontend AI interactions to the canonical path:

```
Component → dataService → api.ts → Backend API → Intelligence Gateway → Provider Adapter → AI Provider
```

Core engines (`aiAssistEngine`, `copilotEngine`) remain orchestration layers — validators, revision building, patch planning — but no longer perform HTTP.

---

## Migration map (before → after)

| Feature | UI entry | Before | After |
|---------|----------|--------|-------|
| AI Chat | `GlobalAIChat.tsx` | `dataService.chatWithAI` | ✅ unchanged (already canonical) |
| Portfolio Narrative | `CortexChatPanel.tsx` | `dataService.generateCortexNarrative` | ✅ unchanged |
| Submission Analysis | `CortexDashboard.tsx` | `dataService.analyzeSubmission` | ✅ unchanged |
| Block Assist | `BlockRegistryPanel.tsx` | `aiAssistEngine` → direct `fetch` + anon key | `aiAssistEngine` → `dataService.blockAIAssist` → `api.blockAIAssist` |
| Copilot | `CopilotPanel.tsx` | `copilotEngine` → direct `fetch` + anon key | `copilotEngine` → `dataService.copilotInterpret` → `api.copilotInterpret` |

---

## Files changed

| File | Change |
|------|--------|
| `src/app/lib/api.ts` | Added `blockAIAssist`, `copilotInterpret` + request/response types |
| `src/app/services/dataService.ts` | Added wrappers with `isDemo()` mock paths |
| `src/app/core/aiAssistEngine.ts` | Removed direct fetch; calls `dataService.blockAIAssist`; exports demo mock helper |
| `src/app/core/copilotEngine.ts` | Removed direct fetch; calls `dataService.copilotInterpret`; threads `accessToken` through `applyPatchPlan` |
| `src/app/components/BlockRegistryPanel.tsx` | `useApp().teamAccessToken` → `callBlockAIAssist` |
| `src/app/components/CopilotPanel.tsx` | `useApp().teamAccessToken` → `interpretRequest` / `applyPatchPlan` |
| `ARCHITECT.md` | Frontend AI data flow + task lookup |
| `architecture/system_map.json` | Cleared `deferred_frontend_bypasses` |

---

## Authentication

All live AI calls use `headers(accessToken)` in `api.ts` — team token when present, anon key fallback (unchanged pattern).

`BlockRegistryPanel` and `CopilotPanel` now read `teamAccessToken` from `AppContext` (same as `TeamDashboardRoute` / `ExecutionRoute` guard).

---

## Demo mode

`dataService.isDemo()` gates network. Demo mocks:

- **Block assist:** `buildMockBlockAIAssistApiResponse` (dynamic import from `aiAssistEngine`)
- **Copilot:** `buildMockCopilotInterpretApiResponse` (dynamic import from `copilotEngine`)

Engines still run validators and build `BlockRevision` / `PatchPlan` — UI behavior preserved.

---

## Verification

| Check | Result |
|-------|--------|
| `npm run build` | ✅ pass |
| `npm run test:intelligence` | ✅ 8/8 pass |
| Direct fetch in `src/app/core/*` | ✅ none |
| `publicAnonKey` in AI engines | ✅ removed |

**Baseline (pre-existing):** `npm run test:smoke` — diagnostic textarea fill failure; not introduced by this sprint.

---

## Rollback

No new rollback flags. Backend gateway rollback env flags from MCV2-S1 remain available. To revert frontend only: restore direct-fetch blocks in `aiAssistEngine.ts` / `copilotEngine.ts` from git history.
