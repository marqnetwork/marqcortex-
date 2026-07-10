# MCV2-S1-IMPLEMENT-001.5 — Intelligence Gateway Migration Plan

| Field | Value |
|-------|-------|
| **Task ID** | MCV2-S1-IMPLEMENT-001.5 |
| **Sprint** | Provider-Agnostic Intelligence Foundation |
| **Type** | Planning only — no runtime code changes |
| **Plan date** | 2026-07-11 |
| **Authority** | `prompts/MARQ-CLAUDE-AGENT-SYSTEM-PROMPT-v1.0.md` §28, §80; `MCV2-S1-AUDIT-001` |
| **Implements next** | `MCV2-S1-IMPLEMENT-002` |
| **Runtime mode at planning** | DEMO (`BACKEND_INTEGRATION: false`) |

---

## Assumptions

1. **Backend runtime** remains Supabase Edge Functions (Deno) under `supabase/functions/server/` — no new deployment target.
2. **No new npm provider SDKs** — adapters continue raw `fetch` per audit finding (PROVEN: no SDK imports today).
3. **First slice only in IMPLEMENT-002** — remaining four backend modules stay on legacy OpenAI fetch until follow-on tasks (per §80).
4. **No new frontend feature flag** — `FEATURES.BACKEND_INTEGRATION` (`src/config/features.ts:18`) is sufficient for demo/live; gateway toggle is server-side env only.
5. **Contract tests** run via Deno test runner colocated with gateway modules; IMPLEMENT-002 adds a `package.json` script only if Deno test invocation is verified during implementation (not invented in this plan's command section).
6. **Shared types** live in backend `intelligence/` first; frontend `api.ts` types remain unchanged for slice 1 to preserve response compatibility.
7. **Block/copilot gateway bypass** (`aiAssistEngine.ts`, `copilotEngine.ts`) deferred to IMPLEMENT-003 or later — out of IMPLEMENT-002 scope.

---

## 1. Current-State Summary

### 1.1 OpenAI call sites (PROVEN)

| Module | Function | Route | Model | Temp | Max tokens | Response format |
|--------|----------|-------|-------|------|------------|-----------------|
| `cortexAnalysis.ts` | `callOpenAI()` | `POST /submissions/:id/analyze`, batch | `gpt-4o-mini` | 0.3 | 2500 | `json_object` |
| `cortexNarrative.ts` | `generateNarrative()` | `POST /cortex/narrative` | `gpt-4o-mini` | 0.4 | 500 | plain text |
| `cortexChat.ts` | `handleCortexChat()` | `POST /ai/chat` | `gpt-4o-mini` | 0.7 | 1200 | plain text + `[APPLY_*]` parse |
| `blockAiAssist.ts` | `handleBlockAIAssist()` | `POST /blocks/ai-assist` | `gpt-4o-mini` | 0.45 | 900 | `json_object` |
| `copilotPatch.ts` | `handleCopilotInterpret()` | `POST /blocks/copilot-interpret` | `gpt-4o-mini` | 0.3 | 800 | `json_object` |

All POST to `https://api.openai.com/v1/chat/completions` with `Authorization: Bearer ${OPENAI_API_KEY}`.

### 1.2 Hardcoded model references (PROVEN)

| Location | Value |
|----------|-------|
| All 5 backend AI modules | `model: 'gpt-4o-mini'` in request body |
| `cortexNarrative.ts:201` | Response `model: 'gpt-4o-mini'` (literal, not `data.model`) |
| `cortexAnalysis.ts:299` | Response `model: 'gpt-4o-mini'` |
| `index.tsx:2777` | Status fallback `ai.model ?? 'gpt-4o-mini'` |
| `dataService.ts:1050` | Demo `model: 'demo-mode'` |
| `cortexAIPrompts.ts:496` | Stale doc reference `gpt-4-turbo-preview` (unused) |

### 1.3 Request and response formats

**Frontend contracts** (`src/app/lib/api.ts`):

| Feature | Request type | Response type | Key fields |
|---------|--------------|---------------|------------|
| Narrative | `NarrativeContext` + `type` enum | `NarrativeResponse` | `success`, `type`, `narrative`, `model`, `generated_at` |
| Chat | `AIChatRequest` | `AIChatResponse` | `reply`, `applyContent?`, `model`, `generated_at` |
| Analysis | submission ID only | `CortexAnalysisResult` | Large JSON — `aiScore`, `coreProblems`, etc. |
| Block assist | `BlockAIAssistRequest` | `BlockAIAssistResponse` | `proposed_content`, `diff_summary`, `model` |
| Copilot | `CopilotInterpretRequest` | `CopilotInterpretResponse` | `intent`, `targets[]`, `skipped[]` |

**Backend-local duplicates** mirror frontend for narrative/chat; block/copilot types exist only in backend modules.

**Route envelope:** Success responses use `{ success: true, ...result }`. Errors use `{ error: string, keyMissing?: boolean }` with HTTP 400/401/422/500/503.

### 1.4 Timeout, retry, parsing, and error behavior

| Layer | Timeout | Retry | Parsing | Error behavior |
|-------|---------|-------|---------|----------------|
| Backend AI modules | **None** — no `AbortController` | **None** | JSON.parse with throw on failure; chat uses regex for apply blocks | Throws `Error` with message; route catches → `{ error, keyMissing }` |
| `api.config.ts` | `VITE_API_TIMEOUT` default 30000ms | `MAX_RETRIES: 3` defined | — | **UNUSED** in `api.ts` (PROVEN: grep shows only definition) |
| `api.ts` fetch calls | Browser default | **None** | `res.json()` / throw on `!res.ok` | Propagates to `dataService` |
| Batch analyze (`index.tsx:2810`) | Per-item sequential | **None** | — | Per-id try/catch; continues on failure |
| Demo mode (`dataService`) | N/A | N/A | N/A | Returns stubs; analysis throws in demo |

**Key missing controls:** stable request ID, attempt count, timeout distinction, cost telemetry, normalized error codes.

### 1.5 Frontend gateway bypasses (PROVEN)

| Engine | File | Lines | Route | Auth |
|--------|------|-------|-------|------|
| Block AI | `aiAssistEngine.ts` | 391–418 | `/blocks/ai-assist` | `publicAnonKey` |
| Copilot | `copilotEngine.ts` | 359–379 | `/blocks/copilot-interpret` | `publicAnonKey` |

Standard path features use `dataService` → `api.ts` with team `accessToken`.

### 1.6 Tests and coverage gaps

| Test asset | Status |
|------------|--------|
| `tests/smoke/diagnostic-score-team-login.spec.ts` | 1 Playwright smoke test — **failing baseline** (textarea fill) |
| Unit tests (`*.test.ts` in repo) | **None** in application code |
| AI contract tests | **None** |
| Deno test config | **None** in `package.json` |
| Manifest validator | `src/system/validate.ts` — browser-oriented, not CI script |

**Missing for gateway:** provider contract, registry, error normalization, retry limit, invalid output, mock provider, adapter mapping, narrative slice regression.

---

## 2. Target Architecture

Aligned with MARQ System Prompt §28 (Intelligence Gateway Alignment) and §80 (First Vertical Slice). No redesign beyond approved structure.

```
┌─────────────────────────────────────────────────────────────────┐
│  Feature modules (cortexNarrative, cortexChat, …)               │
│  — build feature prompts; call gateway only                     │
└────────────────────────────┬────────────────────────────────────┘
                             │ IntelligenceGenerateRequest
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  intelligence/gateway.ts — Intelligence Gateway                 │
│  — validate request, select provider, enforce limits            │
│  — retry/timeout policy, error normalization, telemetry         │
└────────────────────────────┬────────────────────────────────────┘
                             │ ProviderInvokeRequest
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  intelligence/providerRegistry.ts                               │
│  — register providers; resolve by id; health/disabled state     │
└──────────────┬─────────────────────────────┬────────────────────┘
               ▼                             ▼
┌──────────────────────────┐   ┌──────────────────────────────────┐
│ providers/openaiAdapter  │   │ providers/mockProvider           │
│ — OpenAI HTTP mapping    │   │ — deterministic test/demo output │
└──────────────────────────┘   └──────────────────────────────────┘
```

### 2.1 Provider-neutral contracts

**File:** `supabase/functions/server/intelligence/contracts.ts`

```typescript
// Conceptual — exact types defined in IMPLEMENT-002

IntelligenceGenerateRequest {
  requestId: string          // stable UUID, caller-supplied or gateway-generated
  feature: 'narrative' | 'chat' | 'analysis' | 'block_assist' | 'copilot'
  messages: { role: 'system'|'user'|'assistant'; content: string }[]
  responseFormat: 'text' | 'json_object'
  modelProfile: string       // logical profile id, not provider model name
  temperature?: number
  maxTokens?: number
  metadata?: Record<string, string>  // feature context, no PII policy TBD per feature
}

IntelligenceGenerateResponse {
  requestId: string
  content: string            // raw text or JSON string
  model: string              // resolved model id (backward compat field name)
  provider: string           // logical provider id e.g. 'openai', 'mock'
  usage?: { promptTokens, completionTokens, totalTokens }
  finishReason?: string
  generatedAt: string        // ISO
  attempt: number
}

IntelligenceError {
  code: 'PROVIDER_UNAVAILABLE' | 'MISSING_CREDENTIALS' | 'TIMEOUT' |
        'RATE_LIMITED' | 'INVALID_OUTPUT' | 'VALIDATION_FAILED' |
        'PROVIDER_DISABLED' | 'UNKNOWN'
  message: string
  requestId: string
  provider?: string
  retryable: boolean
  diagnostics?: string       // protected — not exposed to client by default
}
```

**Rule:** Feature modules and frontend never import provider-specific types. `provider` field added to responses is additive; existing `model` field preserved.

### 2.2 Provider registry

**File:** `supabase/functions/server/intelligence/providerRegistry.ts`

- Register providers at module load: `openai`, `mock`
- Lookup by `INTELLIGENCE_PROVIDER` env (default `openai`)
- States: `enabled`, `disabled`, `degraded`
- Throws normalized `PROVIDER_DISABLED` / missing provider errors
- Duplicate registration → throw at startup (test-covered)

### 2.3 Model registry

**File:** `supabase/functions/server/intelligence/modelRegistry.ts`

Maps logical profiles to provider model IDs:

| Profile ID | Provider | Model ID | Used by (initial) |
|------------|----------|----------|-------------------|
| `narrative-default` | openai | `gpt-4o-mini` | F4 narrative |
| `chat-default` | openai | `gpt-4o-mini` | F5 (future) |
| `analysis-default` | openai | `gpt-4o-mini` | F1 (future) |
| `block-default` | openai | `gpt-4o-mini` | F6 (future) |
| `copilot-default` | openai | `gpt-4o-mini` | F7 (future) |

Override via env: `INTELLIGENCE_MODEL_NARRATIVE`, etc. Defaults preserve current `gpt-4o-mini`.

### 2.4 Intelligence Gateway

**File:** `supabase/functions/server/intelligence/gateway.ts`

Responsibilities:

1. Accept `IntelligenceGenerateRequest`
2. Resolve provider via registry
3. Resolve model via model registry
4. Apply timeout (`INTELLIGENCE_TIMEOUT_MS`, default 30000)
5. Apply retry policy (max 2 attempts, retryable errors only, stable `requestId`)
6. Delegate to provider adapter
7. Validate output (non-empty; JSON when `responseFormat: json_object`)
8. Emit telemetry record
9. Return `IntelligenceGenerateResponse` or throw `IntelligenceError`

**Export:** `generate(request: IntelligenceGenerateRequest): Promise<IntelligenceGenerateResponse>`

### 2.5 OpenAI adapter

**File:** `supabase/functions/server/intelligence/providers/openaiAdapter.ts`

- Implements `ProviderAdapter` interface
- Maps `IntelligenceGenerateRequest` → OpenAI chat completions body
- Maps OpenAI response → `IntelligenceGenerateResponse`
- Reads `OPENAI_API_KEY`; missing → `MISSING_CREDENTIALS`
- HTTP errors → normalized codes (503 → `PROVIDER_UNAVAILABLE`, 429 → `RATE_LIMITED`)

### 2.6 Deterministic mock provider

**File:** `supabase/functions/server/intelligence/providers/mockProvider.ts`

- Activated when `INTELLIGENCE_PROVIDER=mock` (server-side only)
- Returns deterministic content keyed by `feature` + `modelProfile`
- Used for contract tests and local gateway verification without live API
- Never used in production path unless explicitly configured

### 2.7 Usage telemetry

**File:** `supabase/functions/server/intelligence/telemetry.ts`

In-memory ring buffer (IMPLEMENT-002 scope) + structured console log:

```typescript
TelemetryRecord {
  requestId, feature, provider, model, attempt,
  promptTokens?, completionTokens?, totalTokens?,
  latencyMs, outcome: 'success' | 'error',
  errorCode?, timestamp
}
```

**Export:** `recordTelemetry()`, `getRecentTelemetry(limit)` for diagnostics route (optional, low priority).

No external billing integration in IMPLEMENT-002.

### 2.8 Provider health

**File:** `supabase/functions/server/intelligence/health.ts`

- `checkProviderHealth(providerId)` — credential present, optional lightweight ping
- Exposed via existing `/health` or new `/intelligence/health` sub-check (additive)
- Returns `{ provider, status: 'healthy'|'degraded'|'unavailable', reason? }`

### 2.9 Error normalization

**File:** `supabase/functions/server/intelligence/errors.ts`

- `normalizeError(err, context)` → `IntelligenceError`
- `toHttpResponse(error)` → `{ error: message, code, keyMissing?, requestId }` preserving existing `keyMissing` behavior for credential errors
- Feature route handlers map `IntelligenceError` to existing HTTP status conventions

### 2.10 Server-side configuration

**File:** `supabase/functions/server/intelligence/config.ts`

| Env var | Default | Purpose |
|---------|---------|---------|
| `OPENAI_API_KEY` | — | Existing; used by OpenAI adapter |
| `INTELLIGENCE_PROVIDER` | `openai` | Active provider id |
| `INTELLIGENCE_TIMEOUT_MS` | `30000` | Gateway timeout |
| `INTELLIGENCE_MAX_RETRIES` | `1` | Retry attempts after initial (total 2 tries) |
| `INTELLIGENCE_MODEL_NARRATIVE` | `gpt-4o-mini` | Narrative profile override |
| `INTELLIGENCE_USE_GATEWAY_NARRATIVE` | `true` | Slice rollback switch (server-only) |

**No new frontend env vars.** `INTELLIGENCE_USE_GATEWAY_NARRATIVE=false` restores legacy inline fetch in `cortexNarrative.ts` without redeploying frontend.

---

## 3. Exact File Plan (IMPLEMENT-002)

### 3.1 Files to CREATE

| Path | Purpose | Exports | Dependencies | Consumers | Risk | Rollback |
|------|---------|---------|--------------|-----------|------|----------|
| `supabase/functions/server/intelligence/contracts.ts` | Normalized request/response/error types | Type interfaces | None | All intelligence modules | Low | Delete folder |
| `supabase/functions/server/intelligence/config.ts` | Env-based configuration | `getIntelligenceConfig()` | `contracts.ts` | gateway, adapters | Low | Delete |
| `supabase/functions/server/intelligence/errors.ts` | Error normalization | `normalizeError`, `toHttpResponse`, `IntelligenceError` | `contracts.ts` | gateway, routes | Medium | Delete |
| `supabase/functions/server/intelligence/modelRegistry.ts` | Profile → model mapping | `resolveModel(profile)` | `config.ts` | gateway | Low | Delete |
| `supabase/functions/server/intelligence/providerRegistry.ts` | Provider registration/resolution | `registerProvider`, `getProvider`, `listProviders` | `contracts.ts`, adapters | gateway | Medium | Delete |
| `supabase/functions/server/intelligence/telemetry.ts` | Usage records | `recordTelemetry`, `getRecentTelemetry` | `contracts.ts` | gateway | Low | Delete |
| `supabase/functions/server/intelligence/health.ts` | Provider health checks | `checkProviderHealth` | registry, config | index (optional) | Low | Delete |
| `supabase/functions/server/intelligence/gateway.ts` | Central gateway | `generate()` | all above + adapters | feature modules | **High** | Env flag off |
| `supabase/functions/server/intelligence/providers/providerAdapter.ts` | Adapter interface | `ProviderAdapter` type | `contracts.ts` | adapters, registry | Low | Delete |
| `supabase/functions/server/intelligence/providers/openaiAdapter.ts` | OpenAI HTTP adapter | `openaiAdapter` | interface, config, errors | registry | **High** | Registry disable |
| `supabase/functions/server/intelligence/providers/mockProvider.ts` | Deterministic mock | `mockProvider` | interface | registry, tests | Low | Delete |
| `supabase/functions/server/intelligence/gateway.test.ts` | Gateway contract tests | — | Deno test | CI | Low | Delete |
| `supabase/functions/server/intelligence/providerRegistry.test.ts` | Registry tests | — | Deno test | CI | Low | Delete |
| `supabase/functions/server/intelligence/openaiAdapter.test.ts` | Adapter mapping tests (mock fetch) | — | Deno test | CI | Medium | Delete |
| `supabase/functions/server/intelligence/mockProvider.test.ts` | Mock behavior tests | — | Deno test | CI | Low | Delete |

### 3.2 Files to MODIFY

| Path | Change | Purpose | Consumers affected | Risk | Rollback |
|------|--------|---------|-------------------|------|----------|
| `supabase/functions/server/cortexNarrative.ts` | Replace inline `fetch` with `gateway.generate()` behind env flag; retain legacy `generateNarrativeLegacy()` function | First vertical slice | `index.tsx` narrative route | **High** | `INTELLIGENCE_USE_GATEWAY_NARRATIVE=false` |
| `supabase/functions/server/index.tsx` | Import gateway health (optional); ensure narrative route error mapping uses normalized errors | Route layer | Team narrative API | Medium | Revert route handler |
| `src/system/manifest.ts` | Add `MQC-SVC-010` Intelligence Gateway + child nodes | Registry | RegistryViewer | Low | Revert manifest entries |
| `ARCHITECT.md` | Document gateway paths and env vars | Agent map | Agents | Low | Revert doc |
| `architecture/system_map.json` | Add `intelligence_gateway` domain | Machine map | Agents | Low | Revert JSON |
| `src/config/api.config.ts` | Add missing AI endpoint constants | Reference map | Developers | Low | Revert |
| `src/imports/MCV2-S1-AUDIT-001-provider-agnostic-intelligence-audit.md` | Add cross-link to this plan | Traceability | — | Low | Revert |

### 3.3 Files explicitly NOT modified in IMPLEMENT-002

| Path | Reason |
|------|--------|
| `cortexAnalysis.ts`, `cortexChat.ts`, `blockAiAssist.ts`, `copilotPatch.ts` | Out of first slice scope |
| `aiAssistEngine.ts`, `copilotEngine.ts` | Gateway bypass fix deferred |
| `dataService.ts`, `api.ts` (behavior) | Response shape unchanged for slice 1 |
| `features.ts` | Existing `BACKEND_INTEGRATION` sufficient |
| Frontend components | No UI changes required for narrative slice |

### 3.4 Shared / high-conflict files

| File | Conflict risk | Mitigation |
|------|---------------|------------|
| `supabase/functions/server/index.tsx` | Large monolith (3700+ lines) | Minimal diff — only narrative error handling if needed |
| `src/system/manifest.ts` | 158+ nodes | Additive entries only; ID before code |
| `cortexNarrative.ts` | Active production route | Legacy function retained; env rollback flag |
| `src/app/lib/api.ts` | Shared types | Do not change types in slice 1 |

---

## 4. Migration Sequence

| Step | Action | Why safest |
|------|--------|------------|
| **1** | Baseline capture | Record `npm run build`, `npm run test:smoke` output; grep model references; snapshot narrative response shape |
| **2** | Shared contracts | Types first — all adapters and gateway compile against one contract before behavior changes |
| **3** | Provider registry + adapter interface | Extensibility without touching feature modules |
| **4** | Mock provider | Enables tests without live API or credentials |
| **5** | OpenAI adapter | Extract proven fetch logic from `cortexNarrative.ts` — lowest-risk extraction source |
| **6** | Gateway core | Wire registry + adapters + errors + telemetry; no feature route changes yet |
| **7** | Gateway tests | Contract tests pass with mock provider before any live path |
| **8** | First vertical slice | Migrate `cortexNarrative.ts` only, behind `INTELLIGENCE_USE_GATEWAY_NARRATIVE` |
| **9** | Regression verification | Build + smoke + manual narrative route check with mock provider |
| **10** | Documentation | ARCHITECT, manifest, system_map, api.config |
| **11** | Rollback validation | Toggle env flag; confirm legacy path still works |

**Ordering principle:** Infrastructure and tests before feature migration; one feature before others; legacy code retained until validation passes (§79, §80).

---

## 5. First Vertical Slice Evaluation

### 5.1 Portfolio narrative (F4)

| Criterion | Assessment |
|-----------|------------|
| Coupling | **Low** — single module, no KV write |
| Runtime risk | **Low** — plain text output, no financial JSON |
| Testability | **High** — 3 fixed prompt builders, deterministic mock |
| Prompt complexity | **Medium** — 3 types, injects deterministic scores |
| Response complexity | **Low** — `{ type, narrative, model, generated_at }` |
| Client-facing impact | **Low** — team dashboard only via `CortexChatPanel` |
| Rollback ease | **High** — env flag + legacy function |

### 5.2 Submission analysis (F1)

| Criterion | Assessment |
|-----------|------------|
| Coupling | **High** — KV persistence, batch route, client report reads `cortex:{id}` |
| Runtime risk | **High** — large JSON schema, `sanitizeAnalysis` clamps scores |
| Testability | **Medium** — complex output validation |
| Prompt complexity | **High** — large structured prompt |
| Response complexity | **High** — `CortexAnalysisResult` many fields |
| Client-facing impact | **Medium** — indirect via client report |
| Rollback ease | **Medium** — KV data shape coupling |

### 5.3 Recommendation

**Choose F4 — Portfolio narrative generation** as the first vertical slice.

Rationale: lowest coupling, simplest response contract, standard `dataService` path, easiest before/after comparison, and aligns with `MCV2-S1-AUDIT-001` §11. Submission analysis is the correct **second** slice after gateway proves stable.

---

## 6. Compatibility Strategy

### 6.1 Legacy path retention

- Extract current `cortexNarrative.ts` OpenAI `fetch` block into `generateNarrativeLegacy()` — unchanged logic
- `generateNarrative()` delegates to gateway when `INTELLIGENCE_USE_GATEWAY_NARRATIVE !== 'false'`
- Legacy function remains in file until IMPLEMENT-003+ validates gateway across all features

### 6.2 Feature flag / configuration

| Mechanism | Purpose | Required? |
|-----------|---------|-----------|
| `BACKEND_INTEGRATION` (frontend) | Demo vs live | **Existing** — preserve |
| `INTELLIGENCE_USE_GATEWAY_NARRATIVE` (backend env) | Gateway vs legacy for F4 | **Yes** — server rollback without frontend deploy |
| `INTELLIGENCE_PROVIDER=mock` | Test/dev without OpenAI | **Yes** — enables contract tests |

No new frontend feature flag (repository evidence: `BACKEND_INTEGRATION` already gates demo/live).

### 6.3 Response compatibility

- HTTP route `POST /cortex/narrative` unchanged
- Response body unchanged: `{ success: true, type, narrative, model, generated_at }`
- `model` field continues to show resolved model id (`gpt-4o-mini` under OpenAI adapter)
- Optional additive `provider` field only if frontend ignores unknown fields (verify `CortexChatPanel` does not strict-parse)

### 6.4 Error compatibility

- Preserve `{ error: string, keyMissing?: boolean }` on 500/503
- Map `IntelligenceError.code === 'MISSING_CREDENTIALS'` → `keyMissing: true` (matches `index.tsx:3589` pattern)

### 6.5 Prompt and parameter preservation

- Gateway receives same `messages` array currently built in `generateNarrative()` — **no prompt text changes** in IMPLEMENT-002
- Temperature `0.4`, max tokens `500` preserved via `narrative-default` profile

### 6.6 Demo-mode preservation

- Frontend `dataService.generateCortexNarrative` demo stubs unchanged
- Demo path never hits gateway (no backend call when `BACKEND_INTEGRATION: false`)

### 6.7 Rollback behavior

1. Set `INTELLIGENCE_USE_GATEWAY_NARRATIVE=false` in Edge secrets → immediate legacy path
2. Redeploy edge function if needed
3. No frontend rollback required

---

## 7. Test Plan (IMPLEMENT-002)

Tests use Deno test (`deno test`) colocated with gateway modules. IMPLEMENT-002 adds npm script after verifying Deno availability on target environment.

| Test file | Test name (representative) | Proves |
|-----------|---------------------------|--------|
| `providerRegistry.test.ts` | `registers openai and mock providers` | Registry initialization |
| `providerRegistry.test.ts` | `throws on duplicate registration` | Duplicate registration guard |
| `providerRegistry.test.ts` | `throws PROVIDER_DISABLED for disabled provider` | Disabled provider |
| `providerRegistry.test.ts` | `throws when provider id missing` | Missing provider |
| `mockProvider.test.ts` | `returns deterministic narrative text` | Mock success |
| `mockProvider.test.ts` | `returns deterministic json when requested` | Mock JSON mode |
| `mockProvider.test.ts` | `fails when configured to fail` | Mock failure |
| `openaiAdapter.test.ts` | `maps request to OpenAI body shape` | OpenAI adapter mapping |
| `openaiAdapter.test.ts` | `maps OpenAI response to IntelligenceGenerateResponse` | Response normalization |
| `openaiAdapter.test.ts` | `returns MISSING_CREDENTIALS without key` | Missing credentials |
| `gateway.test.ts` | `times out after INTELLIGENCE_TIMEOUT_MS` | Timeout behavior |
| `gateway.test.ts` | `stops after max retry limit` | Retry limit |
| `gateway.test.ts` | `rejects empty output` | Invalid output |
| `gateway.test.ts` | `rejects invalid JSON when json_object required` | Invalid output |
| `gateway.test.ts` | `records telemetry on success and failure` | Usage normalization |
| `gateway.test.ts` | `preserves stable requestId across retries` | Retry idempotency |
| `cortexNarrative.gateway.test.ts` | `generateNarrative returns same shape as legacy` | First vertical-slice regression |
| `cortexNarrative.gateway.test.ts` | `all three narrative types call gateway with correct profile` | Feature integration |

**Repository-level regression (existing commands):**

| Command | Proves |
|---------|--------|
| `npm run build` | Frontend + types still compile |
| `npm run test:smoke` | No frontend regression (baseline failure documented) |

**Demo-mode regression (manual):**

- With `BACKEND_INTEGRATION: false`, `CortexChatPanel` narrative buttons return demo strings — no backend call.

---

## 8. Command Plan

### 8.1 Commands defined in repository today (PROVEN: `package.json`)

| Command | Purpose | Availability |
|---------|---------|--------------|
| `npm run build` | Vite production build | **Available** |
| `npm run dev` | Dev server port 5173 | **Available** |
| `npm run test:smoke` | Playwright smoke (`tests/smoke/`) | **Available** |

### 8.2 Not available in repository

| Command | Status |
|---------|--------|
| `npm run lint` | Not defined |
| `npm run typecheck` / `tsc --noEmit` | Not defined |
| `npm test` | Not defined |
| Unit test runner | Not defined |

### 8.3 IMPLEMENT-002 command workflow

**Baseline (step 1):**
```bash
npm run build
npm run test:smoke
```

**During implementation (after Deno test script added):**
```bash
deno test supabase/functions/server/intelligence/ --allow-env --allow-net=none
```
*(Exact flags finalized in IMPLEMENT-002 when script is added to `package.json`.)*

**Final regression:**
```bash
npm run build
deno test supabase/functions/server/intelligence/
npm run test:smoke
```

---

## 9. Risks and Controls

| Risk | Mitigation |
|------|------------|
| Provider-specific type leakage upstream | Gateway returns only `IntelligenceGenerateResponse`; feature modules map to existing DTOs; no OpenAI types exported |
| Frontend credential exposure | No change — providers stay server-side; mock provider server-only |
| Duplicate gateways | Single `gateway.ts` export; manifest ID `MQC-SVC-010`; architecture drift check in §75 |
| Response-shape drift | Slice 1 keeps exact `NarrativeResponse`; contract test compares legacy vs gateway output |
| Prompt changes | Copy existing messages verbatim into gateway request; diff prompts in review |
| Retry duplication | Central retry in gateway only; remove per-module retry if added later |
| Missing telemetry | `telemetry.ts` mandatory in gateway path; log when unavailable |
| Existing smoke-test failure | Document as baseline; do not block IMPLEMENT-002; do not claim smoke PASS |
| Shared-file conflicts (`index.tsx`, `manifest.ts`) | Minimal diffs; additive manifest entries |
| Demo/live divergence | Demo stays frontend-only; gateway only on live backend path |
| OpenAI rate limits / outages | Normalized `RATE_LIMITED` / `PROVIDER_UNAVAILABLE`; bounded retry; no silent provider switch |
| Invalid JSON from model | Gateway validation + existing module-level parse errors preserved |
| Cost explosion | `INTELLIGENCE_MAX_RETRIES=1`; timeout; no batch gateway in slice 1 |
| Auth on `/blocks/*` | Deferred — document in IMPLEMENT-003; not in slice 1 |

---

## 10. Effort Estimate

| Unit | Estimate |
|------|----------|
| Implementation cycles | **4–6** autonomous cycles for IMPLEMENT-002 (foundation + narrative slice + tests + docs) |
| Files created | **~15** (11 runtime + 4 test) |
| Files modified | **~7** |
| Low-risk portions | Contracts, config, mock provider, telemetry, docs (~40%) |
| Medium-risk portions | Registry, errors, OpenAI adapter, tests (~35%) |
| High-risk portions | Gateway core, `cortexNarrative.ts` migration (~25%) |
| Autonomous execution | Contracts through mock tests; OpenAI adapter extraction; narrative wiring with env flag |
| Human review required | Gateway error mapping, narrative output quality spot-check with live key, manifest entries, provider env config for production |

No calendar-time estimate per task instructions.

---

## 11. Acceptance Criteria for IMPLEMENT-002

Executable checklist — each item independently verifiable:

- [ ] **AC-01** Directory `supabase/functions/server/intelligence/` exists with `gateway.ts`, `contracts.ts`, `config.ts`, `errors.ts`, `providerRegistry.ts`, `modelRegistry.ts`, `telemetry.ts`, `health.ts`, and `providers/` adapters.
- [ ] **AC-02** `generate()` in gateway is the sole entry point for provider calls in migrated features.
- [ ] **AC-03** OpenAI adapter uses `fetch` (no SDK) and reads `OPENAI_API_KEY`.
- [ ] **AC-04** Mock provider returns deterministic output for `feature: 'narrative'` without network.
- [ ] **AC-05** Provider registry rejects duplicate provider registration (test proves).
- [ ] **AC-06** Missing provider id returns normalized error with code `PROVIDER_DISABLED` or equivalent (test proves).
- [ ] **AC-07** Missing `OPENAI_API_KEY` returns `MISSING_CREDENTIALS` and HTTP response includes `keyMissing: true` on narrative route.
- [ ] **AC-08** Gateway enforces timeout (test proves with injected slow provider).
- [ ] **AC-09** Gateway enforces retry limit ≤ `INTELLIGENCE_MAX_RETRIES` (test proves).
- [ ] **AC-10** Gateway rejects empty and invalid JSON output (tests prove).
- [ ] **AC-11** Telemetry record written on every gateway invocation (test proves).
- [ ] **AC-12** `cortexNarrative.ts` uses gateway when `INTELLIGENCE_USE_GATEWAY_NARRATIVE` is not `false`.
- [ ] **AC-13** Legacy `generateNarrativeLegacy()` retained and callable when env flag is `false`.
- [ ] **AC-14** `POST /cortex/narrative` response shape unchanged: `{ success, type, narrative, model, generated_at }`.
- [ ] **AC-15** All three narrative types (`why_now`, `confidence_reasoning`, `strategic_decision`) work through gateway.
- [ ] **AC-16** `npm run build` passes (exit 0).
- [ ] **AC-17** Deno intelligence tests pass (all files in `intelligence/*.test.ts`).
- [ ] **AC-18** `dataService.generateCortexNarrative` demo stubs unchanged when `BACKEND_INTEGRATION: false`.
- [ ] **AC-19** `cortexAnalysis.ts`, `cortexChat.ts`, `blockAiAssist.ts`, `copilotPatch.ts` provider `fetch` blocks unchanged.
- [ ] **AC-20** `ARCHITECT.md`, `architecture/system_map.json`, `manifest.ts` updated with gateway nodes.
- [ ] **AC-21** No frontend production provider calls introduced (grep `api.openai.com` in `src/` → zero).
- [ ] **AC-22** Rollback verified: `INTELLIGENCE_USE_GATEWAY_NARRATIVE=false` restores legacy narrative behavior.

---

## 12. Stop and Rollback Plan (IMPLEMENT-002)

### 12.1 Must STOP when

- Gateway migration requires changing frontend response contracts
- Shared auth model for `/blocks/*` becomes blocking (defer to follow-on)
- Architecture approval needed for second gateway or provider in frontend
- Change-caused `npm run build` failure unrecoverable in 2 cycles
- Live OpenAI validation impossible AND mock tests fail

### 12.2 Partial work preservation

- Intelligence module files are additive — safe to merge even if slice incomplete
- Do not modify `cortexNarrative.ts` until gateway tests pass with mock provider
- Manifest entries can be added as `GATED` until slice validates

### 12.3 Runtime restoration

| Level | Action |
|-------|--------|
| **L1 — immediate** | `INTELLIGENCE_USE_GATEWAY_NARRATIVE=false` |
| **L2 — deploy** | Redeploy edge function from prior commit |
| **L3 — full** | Revert IMPLEMENT-002 commit; delete `intelligence/` folder |

### 12.4 Legacy paths that must remain until validation

- `generateNarrativeLegacy()` inline OpenAI fetch in `cortexNarrative.ts`
- All four unmigrated modules' existing `fetch` blocks
- Frontend demo stubs in `dataService.ts`
- Existing HTTP routes and auth patterns

---

## 13. Document Index

| Document | Relationship |
|----------|--------------|
| `MCV2-S1-AUDIT-001-provider-agnostic-intelligence-audit.md` | Evidence source for current state |
| `prompts/MARQ-CLAUDE-AGENT-SYSTEM-PROMPT-v1.0.md` | Architecture authority §28, §80 |
| `ARCHITECT.md` | Golden rules and file lookup |

---

*End of MCV2-S1-IMPLEMENT-001.5 Migration Plan*
