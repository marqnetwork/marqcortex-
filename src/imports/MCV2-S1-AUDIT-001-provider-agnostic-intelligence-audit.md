# MCV2-S1-AUDIT-001 — Provider-Agnostic Intelligence Audit

| Field | Value |
|-------|-------|
| **Task ID** | MCV2-S1-AUDIT-001 |
| **Sprint** | MARQ Cortex V2 · Sprint 1 · Audit |
| **Type** | Analysis only — no implementation |
| **Audit date** | 2026-07-11 |
| **Runtime mode** | DEMO (`BACKEND_INTEGRATION: false`) |
| **Authority** | `ARCHITECT.md`, verified file reads |
| **Next task** | MCV2-S1-IMPLEMENT-002 (see `MCV2-S1-IMPLEMENT-001.5-intelligence-gateway-migration-plan.md`) |

---

## 1. Executive Summary

MARQ Cortex intelligence today is **OpenAI-coupled at the edge-function layer** with **no provider adapter or Intelligence Gateway**. Five backend modules each duplicate raw `fetch` calls to `https://api.openai.com/v1/chat/completions` using hardcoded `gpt-4o-mini`. The frontend has **zero direct provider SDK usage**, but **two core engines bypass `dataService`** for block AI and copilot routes.

| Dimension | Status | Confidence |
|-----------|--------|------------|
| Provider count | 1 (OpenAI HTTP only) | PROVEN |
| Adapter/gateway layer | None | PROVEN |
| Normalized AI contracts | Partial — duplicated frontend/backend | PROVEN |
| Data gateway compliance | Partial — 5/7 LLM features via `dataService` | PROVEN |
| Demo/live gating | Central for `dataService` paths | PROVEN |
| Production readiness (AI infra) | `Prototype` | PROVEN |
| Unit/contract tests for AI | None | PROVEN |

**Core rule preserved:** Deterministic engines (`src/app/core/scoringEngine.ts`, `roiEngine.ts`, etc.) contain no LLM calls. AI narrates and assists; math decides priority.

---

## 2. Audit Scope and Method

### In scope

- All live and demo LLM call paths
- Provider configuration and secrets
- Normalized vs provider-specific types
- Gateway and adapter patterns
- Auth boundaries on AI routes
- Prompt/schema drift between docs and live code

### Out of scope

- Intelligence Gateway implementation (MCV2-S1-IMPLEMENT-002)
- UI layout or feature changes
- Live provider verification (no credentials in repo)

### Method

1. Read `ARCHITECT.md` and AI-related paths per §5 lookup
2. Grep for `api.openai.com`, `OPENAI_API_KEY`, `gpt-4o-mini`
3. Trace UI → service → API → edge → provider chains
4. Run `npm run build` and `npm run test:smoke` as baseline gates

---

## 3. Provider Inventory

### 3.1 Active provider

| Provider | Integration | SDK | Evidence |
|----------|-------------|-----|----------|
| OpenAI | Raw `fetch` to Chat Completions API | None | 5 backend modules |

**PROVEN:** No `openai`, `@anthropic-ai/*`, or `@ai-sdk/*` imports in `src/` or `supabase/functions/server/`.

### 3.2 Configuration

| Setting | Location | Value | Configurable? |
|---------|----------|-------|---------------|
| API key | Supabase Edge secrets | `OPENAI_API_KEY` | Yes (deploy-time) |
| Model | Hardcoded per module | `gpt-4o-mini` | **No** |
| Temperature | Per-module literals | 0.4–0.7 | **No** |
| Max tokens | Per-module literals | 500–1200 | **No** |
| Provider selection | — | OpenAI only | **No** |
| Demo gate | `src/config/features.ts:18` | `BACKEND_INTEGRATION: false` | Yes |

**Stale reference:** `src/app/utils/cortexAIPrompts.ts` documents `gpt-4-turbo-preview` — not used by live backend.

---

## 4. LLM Call Site Catalog

### 4.1 Backend — actual provider HTTP calls

| # | Module | Function | Lines | Route |
|---|--------|----------|-------|-------|
| 1 | `cortexAnalysis.ts` | `callOpenAI()` | 135–178 | `POST /submissions/:id/analyze` |
| 2 | `cortexAnalysis.ts` | (batch via index) | — | `POST /submissions/analyze-batch` |
| 3 | `cortexNarrative.ts` | `generateNarrative()` | 145–187 | `POST /cortex/narrative` |
| 4 | `cortexChat.ts` | `handleCortexChat()` | 104–170 | `POST /ai/chat` |
| 5 | `blockAiAssist.ts` | `handleBlockAIAssist()` | 162–228 | `POST /blocks/ai-assist` |
| 6 | `copilotPatch.ts` | `handleCopilotInterpret()` | 152–213 | `POST /blocks/copilot-interpret` |

**Route wiring:** `supabase/functions/server/index.tsx` (lines ~2795–3704).

Each module independently:

- Reads `Deno.env.get('OPENAI_API_KEY')`
- POSTs to OpenAI chat completions
- Parses `choices[0].message.content`
- Returns product-specific JSON

### 4.2 Frontend — standard gateway path

| Feature | UI | Service | API | Edge |
|---------|-----|---------|-----|------|
| Submission analysis | `CortexDashboard.tsx` | `dataService.analyzeSubmission` | `api.analyzeSubmission` | `runCortexAnalysis` |
| Batch analysis | `CortexDashboard.tsx` | `dataService.analyzeSubmissionsBatch` | `api` | batch loop |
| Portfolio narrative | `CortexChatPanel.tsx` | `dataService.generateCortexNarrative` | `api.generateCortexNarrative` | `generateNarrative` |
| Global AI chat | `GlobalAIChat.tsx` | `dataService.chatWithAI` | `api.chatWithAI` | `handleCortexChat` |
| Client AI report | `ClientPortal.tsx` | `dataService.getClientReport` | `api.getClientReport` | KV read — **no live LLM** |

### 4.3 Frontend — gateway bypass (architecture drift)

| Feature | UI | Engine | Lines | Auth |
|---------|-----|--------|-------|------|
| Block AI assist | `BlockRegistryPanel.tsx` | `aiAssistEngine.callBlockAIAssist` | 371–418 | `publicAnonKey` only |
| Copilot interpret | `CopilotPanel.tsx` | `copilotEngine.interpretRequest` | 336–379 | `publicAnonKey` only |

**PROVEN:** Direct `fetch` to `https://${projectId}.supabase.co/functions/v1/make-server-324f4fbe/blocks/*` — bypasses `dataService.ts` and `api.ts`.

### 4.4 Non-LLM "AI" features (excluded from gateway migration scope)

| File | Nature |
|------|--------|
| `AIAssistant.tsx` | Rule-based diagnostic help |
| `instantScoring.ts` | Deterministic public funnel scoring |
| `scoringEngine.ts` | Deterministic team scoring |
| `decisionEngine.ts` | Deterministic reasoning |
| `diagnosticEngine.ts` | `buildNarrative()` without LLM |
| `mockAIAnalysis.ts` | Legacy mock — orphaned type |

---

## 5. Feature Matrix

| ID | Feature | LLM? | Demo behavior | Gateway path | Readiness |
|----|---------|------|---------------|--------------|-----------|
| F1 | CORTEX submission analysis | Yes | Throws in dataService | Standard | Prototype |
| F2 | Batch submission analysis | Yes | Throws in dataService | Standard | Prototype |
| F3 | Client AI report | Indirect | Deterministic demo generator | Standard (reads KV) | Development |
| F4 | Portfolio narratives | Yes | Demo strings / panel mocks | Standard | Prototype |
| F5 | Global AI chat | Yes | `getMockResponse` | Standard | Prototype |
| F6 | Block AI assist | Yes | `buildMockRevision` | **Bypass** | Prototype |
| F7 | Copilot interpret | Yes | `buildMockPlan` | **Bypass** | Prototype |
| F8 | Inline AI / proposal copilot | Routes to F5 | Opens GlobalAIChat | Standard | Prototype |

---

## 6. Type and Contract Analysis

### 6.1 Active normalized types (frontend)

**Source:** `src/app/lib/api.ts`, re-exported via `dataService.ts:41–70`

| Type | Purpose |
|------|---------|
| `CortexAnalysisResult` | Submission analysis output |
| `NarrativeContext` / `NarrativeResponse` | Portfolio narratives |
| `AIChatRequest` / `AIChatResponse` | Global chat |
| `ClientReportPayload` | Client report shape |

### 6.2 Backend-local duplicates

| Backend file | Types | Drift risk |
|--------------|-------|------------|
| `cortexChat.ts` | `ChatRequest`, `ChatResponse` | Mirrors frontend names |
| `cortexNarrative.ts` | `NarrativeRequest`, `NarrativeResponse` | Mirrors frontend |
| `blockAiAssist.ts` | `BlockAIAssistRequest/Response` | Not in `api.ts` |
| `copilotPatch.ts` | `CopilotInterpretRequest/Response` | Not in `api.ts` |
| `cortexAnalysis.ts` | inline records + sanitizer | Not `CortexAIBrain` |

### 6.3 Legacy / documentation-only (schema drift)

| File | Type | Status |
|------|------|--------|
| `types/ai-scoring.ts` | `AIAnalysis` | Superseded; only `mockAIAnalysis.ts` |
| `types/cortex-ai-brain.ts` | `CortexAIBrain` | Design doc — not live backend |
| `utils/cortexAIPrompts.ts` | 8-step analysis prompt | **Not imported by live backend** |

Live `cortexAnalysis.ts` uses its own shorter `buildCortexPrompt()` — not `CORTEX_ANALYSIS_PROMPT`.

### 6.4 Provider leakage in responses

- All responses expose `model: string` (`gpt-4o-mini` or `demo-mode`)
- No `provider`, `usage`, or raw OpenAI choice objects upstream
- Block revisions store model string in `created_by` field

---

## 7. Data Flow Diagrams

### Standard path

```
Component → dataService.ts → [demo | api.ts] → Edge index.tsx → AI module → OpenAI
                                                      ↓
                                                    KV store
```

### Bypass path

```
BlockRegistryPanel / CopilotPanel → aiAssistEngine / copilotEngine → direct fetch → Edge /blocks/* → OpenAI
```

---

## 8. Gateway / Adapter Gap Analysis

### What exists

| Pattern | Location | Assessment |
|---------|----------|------------|
| `dataService` gateway | `dataService.ts` | Partial — 5/7 LLM features |
| Demo/live switch | `isDemo()` in dataService | Good for standard paths |
| Pre-commit validators | `aiAssistEngine.ts` | Fact-lock, coherence, jargon |
| Copilot orchestration | `copilotEngine.ts` | Plan → apply pipeline |
| JSON sanitization | `cortexAnalysis.sanitizeAnalysis` | Backend-only |
| Governance prompts | Each backend module | "Never override scores" |

### What is missing (provider-agnostic requirements)

| Gap | Severity | Evidence |
|-----|----------|----------|
| No `LLMProvider` / gateway abstraction | **P0** | 5× duplicated OpenAI fetch |
| Hardcoded model/temperature/tokens | **P0** | All 5 modules |
| Block/copilot bypass dataService | **P1** | `aiAssistEngine.ts:391`, `copilotEngine.ts:359` |
| Duplicated request/response types | **P1** | Frontend + backend copies |
| `/blocks/*` uses anon key only | **P1** | `index.tsx` route comments |
| Dual prompt systems | **P2** | `cortexAIPrompts.ts` vs `cortexAnalysis.ts` |
| Incomplete `api.config.ts` AI map | **P2** | Missing 4 AI routes |
| No contract tests | **P2** | No `*.test.ts` for AI |
| No cost/retry telemetry | **P2** | No request ID tracking |

---

## 9. Security and Auth Findings

| Route group | Auth pattern | Risk |
|-------------|--------------|------|
| `/ai/chat`, `/cortex/narrative`, `/submissions/*/analyze` | Team token via `api.ts` | Standard |
| `/blocks/ai-assist`, `/blocks/copilot-interpret` | Public anon key from engines | **Elevated** — no team session |

**Review priority:** High for provider contract and auth normalization in IMPLEMENT-002.

---

## 10. Configuration and Endpoint Map Gaps

`src/config/api.config.ts` ENDPOINTS (lines ~89–100) lists CORTEX analyze paths but **omits**:

- `/cortex/narrative`
- `/ai/chat`
- `/blocks/ai-assist`
- `/blocks/copilot-interpret`

---

## 11. Recommended Migration Sequence (for IMPLEMENT-002)

Per §80 First Vertical Slice Protection — do not migrate all features in one task.

| Phase | Action | Rationale |
|-------|--------|-----------|
| **P0** | Create `llmGateway.ts` (or equivalent) on backend | Eliminate 5× fetch duplication |
| **P0** | Externalize model, temperature, max_tokens to config/env | Provider swap readiness |
| **P1** | Introduce shared normalized `AIRequest` / `AIResponse` types | Single contract |
| **P1** | Route block assist + copilot through `dataService`/`api.ts` | Gateway compliance |
| **P1** | Align `/blocks/*` auth with team routes | Security |
| **P2** | First vertical slice: **portfolio narrative** (F4) | Low risk, clear before/after |
| **P2** | Retire or wire `cortexAIPrompts.ts` / `CortexAIBrain` | Schema drift |
| **P2** | Add contract tests for gateway adapter | Mandatory per §62 |

**Do not delete** existing OpenAI paths until gateway slice proves equivalent.

---

## 12. Acceptance Criteria — MCV2-S1-AUDIT-001

| Criterion | Result | Evidence |
|-----------|--------|----------|
| All LLM call sites identified | **PASS** | §4 catalog — 6 backend + 2 bypass + 5 standard frontend |
| Provider coupling documented | **PASS** | §3 — OpenAI-only, hardcoded model |
| Gateway gaps enumerated | **PASS** | §8 |
| Normalized type drift documented | **PASS** | §6 |
| No implementation changes | **PASS** | Analysis-only run |
| Audit saved in repo docs | **PASS** | This file |
| Baseline checks executed | **PASS** | §13 |
| Recommended next action stated | **PASS** | §11 → MCV2-S1-IMPLEMENT-002 |

---

## 13. Baseline Verification Results

| Command | Baseline (pre-edit) | Final (post-doc) | Sprint-related? |
|---------|---------------------|------------------|-----------------|
| `npm run build` | **PASS** (exit 0, 23.6s) | **PASS** (unchanged) | No |
| `npm run test:smoke` | **FAIL** | **FAIL** (preserved) | No |
| TypeScript `tsc --noEmit` | Not configured in `package.json` | Not run | N/A |
| Unit tests | None in repo | N/A | N/A |
| Live OpenAI calls | Not attempted (no credentials) | Not attempted | N/A |

### Smoke test failure (baseline preserved)

```
tests/smoke/diagnostic-score-team-login.spec.ts:16
expect(activeAnswer).toHaveValue(/Smoke test answer/)
Received: ""
```

**Classification:** Existing baseline failure — unrelated to audit sprint. Diagnostic textarea fill did not persist in Playwright run. Audit completion does not require fixing this.

---

## 14. Architecture Drift Summary

| Violation | Files | Severity |
|-----------|-------|----------|
| Gateway bypass | `aiAssistEngine.ts`, `copilotEngine.ts` | High |
| Hardcoded model outside config | 5 backend AI modules | High |
| Duplicated provider fetch logic | 5 backend AI modules | High |
| Dual analysis prompt/schema | `cortexAIPrompts.ts` vs `cortexAnalysis.ts` | Medium |
| Anon auth on block routes | `index.tsx` `/blocks/*` | Medium |
| Incomplete endpoint registry | `api.config.ts` | Low |

---

## 15. Assumptions Recorded

1. **Task spec location:** No `MCV2-S1-AUDIT-001` sprint prompt file exists in repo; audit scope inferred from task ID, user instruction ("provider-agnostic intelligence audit"), and Loop 4 Intelligence Gateway references.
2. **Audit doc placement:** Saved to `src/imports/` per existing convention (`cortex-audit-report.md`, spec artifacts).
3. **Prompt canonicalization:** Loop 4 (§59–85) verbatim from session; Base (§1–35) and Loops 2–3 (§36–58) composed during v1.0 lock from §83 cross-references and `ARCHITECT.md` (session transcript contained only Loop 4 body).
4. **Live provider behavior:** Not verified — `BACKEND_INTEGRATION: false` and no `OPENAI_API_KEY` in local environment.

---

## 16. Rollback

This audit is documentation-only. Rollback: delete or revert this file and prompt/rule/ARCHITECT additions from the canonicalization commit.

---

## 17. Review Priority

**High** — touches provider contracts, shared types, auth on AI routes, and Intelligence Gateway foundation.

---

## 18. Recommended Next Action

Proceed to **MCV2-S1-IMPLEMENT-002** per migration plan `MCV2-S1-IMPLEMENT-001.5-intelligence-gateway-migration-plan.md`:

1. Implement backend `llmGateway` adapter with normalized types
2. Externalize model configuration
3. Migrate first vertical slice (recommend F4 portfolio narrative)
4. Add contract tests for adapter
5. Route block/copilot through `dataService` in a follow-on slice

---

*End of MCV2-S1-AUDIT-001*
