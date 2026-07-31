# MARQ Cortex AI Platform — AI-01 "Secure Foundation" (Batch 1)
## Independent Enterprise Architecture Review

**Reviewer:** Independent enterprise architecture validation
**Date:** 2026-07-31
**Method:** Source-only verification. No claim in any implementation report was accepted without a corresponding code path. All runtime numbers were reproduced locally.
**Commit reviewed:** `1ece066e` (branch `claude/marq-cortex-enterprise-review-t37lad`, parity with `main`)

---

## 1. Executive Summary

The delivered artefact is a **single-provider OpenAI abstraction layer** (`supabase/functions/server/intelligence/`, ~1,400 LOC across 16 files). It is competently layered, has zero circular dependencies, zero TODO/FIXME markers, and its 8 tests pass. As a *first refactor step* away from six copy-pasted `fetch('https://api.openai.com/...')` blocks, it is a real improvement.

It is **not** a Secure Foundation, and it does not match the capability list this review was asked to verify.

Of the 39 discrete capabilities enumerated in the review objectives, **13 are implemented, 9 are partial or decorative, and 17 do not exist in the source at all.** The following named components return **zero matches** anywhere in the repository: AI Guard, Control Plane, Prompt Registry, Prompt Versioning, Prompt Hashing, Prompt Ownership, Policy Engine, Fact Lock (as a governed subsystem), Anthropic provider, Circuit Breaker, Provider Failover, Event Bus, Budget Enforcement, PII Redaction, Tenant Isolation, Correlation IDs, AI Audit.

Three findings are individually sufficient to block certification:

1. **Two AI endpoints are reachable by anonymous internet callers.** `supabase/config.toml:22` sets `verify_jwt = false` for the whole edge function, and `/blocks/ai-assist` and `/blocks/copilot-interpret` perform no authentication in-handler. Anyone who knows the URL can spend the platform's OpenAI budget without credentials.
2. **The legacy AI path was never removed.** All six feature modules retain a complete, exported, direct-to-OpenAI implementation, selected at runtime by an environment variable. The "one execution path" invariant is a default value, not an architectural property.
3. **`npm run typecheck` fails on all three boundaries.** The API boundary — which contains 100% of the AI code — is not type-checked at all in this environment, and that gap is already masking a broken import in the shipped provider (`providers/mockProvider.ts:6`).

**Certification decision: REQUIRES FIXES.**

---

## 2. Architecture Assessment

### 2.1 "There is exactly ONE AI execution path" — **FALSE**

Every AI feature module carries two complete implementations selected at call time:

| Module | Legacy entry point | Selector |
|---|---|---|
| `cortexAnalysis.ts:252` | `callOpenAILegacy` | `cortexAnalysis.ts:298` |
| `cortexNarrative.ts:164` | `generateNarrativeLegacy` | flag check |
| `cortexChat.ts:141` | `handleCortexChatLegacy` | `cortexChat.ts:202` |
| `blockAiAssist.ts:170` | `handleBlockAIAssistLegacy` | `blockAiAssist.ts:236` |
| `copilotPatch.ts:162` | `handleCopilotInterpretLegacy` | `copilotPatch.ts:222` |
| `proposalSectionCopilot.ts:190` | `handleSectionCopilotLegacy` | flag check |

Each selector is `if (!isGatewayEnabledForFeature(<feature>)) return <legacy>()`. `config.ts:30-34` resolves those flags from `INTELLIGENCE_USE_GATEWAY_*` environment variables, defaulting to `true`.

The consequence is precise and worth stating plainly: **setting one environment variable silently disables the entire gateway for that feature** — no telemetry, no output validation, no model registry, no retry policy, no error normalisation. There is no alarm, no log line, and no health signal when this happens. A production misconfiguration is indistinguishable from correct operation until someone audits the env.

### 2.2 "No provider bypass exists" — **FALSE**

Beyond the legacy path, the HTTP layer itself bypasses the abstraction. Seven route handlers gate on the OpenAI credential directly:

```
index.tsx:3181, 3237, 3956, 3998, 4032, 4086, 4114
    if (!Deno.env.get('OPENAI_API_KEY')) return c.json({... keyMissing: true }, 503);
```

Set `INTELLIGENCE_PROVIDER=mock` — the documented, supported configuration — and **every AI endpoint returns HTTP 503** even though the mock provider is registered, certified, and functional. The provider abstraction cannot be exercised end-to-end through the API surface it was built to serve. This is the single clearest disproof of provider-agnosticism in the codebase.

### 2.3 "The Control Plane is the only execution entry" — **NO CONTROL PLANE EXISTS**

`grep -rn "controlPlane\|control_plane"` over `src/`, `supabase/`, `tests/`, `scripts/` returns nothing. The nearest analogue is `intelligenceGenerate` (`gateway.ts:57`), a 78-line function that resolves a model, asserts provider availability, and runs a retry loop. It performs no authentication, no authorisation, no tenant resolution, no policy evaluation, no budget check, no redaction, and no audit. It is a **provider dispatcher**, correctly named "gateway" in the source and mis-named "Control Plane" in the report.

### 2.4 Dependency boundaries and single responsibility — **GOOD, with exceptions**

Import analysis confirms clean acyclic layering: `contracts → env/errors → registries → gateway → featureBridge → feature modules`. This is the strongest part of the delivery and should be preserved through the remediation.

Three boundary defects:

- **`providers/mockProvider.ts:6`** imports `from './contracts.ts'`. That file does not exist — contracts live at `../contracts.ts`. Confirmed by `tsc`:
  `error TS2307: Cannot find module './contracts.ts'`. It survives at runtime only because it is an `import type` and gets erased. It is a latent break the moment anyone imports a value from that path, and it is direct evidence that the API boundary is unchecked.
- **`bootstrap.ts` is a production module exporting `resetIntelligenceStackForTests()`**, and `testSetup.ts` (a test harness) sits inside the production source tree, importing production reset hooks that mutate module-global registries. Test scaffolding is shipped in the edge bundle.
- **`featureBridge.ts:131` `mapGatewayErrorToLegacyMessage`** converts a provider-neutral `MISSING_CREDENTIALS` into the string `"OPENAI_API_KEY is not configured. Add it via Supabase dashboard..."`. The abstraction layer's own error mapper hardcodes one provider's credential name.

### 2.5 Provider abstraction genuinely provider-agnostic — **NO**

Five independent leaks:

1. `bootstrap.ts:13` — `initializeModelRegistry('openai')` is hardcoded and ignores `cfg.activeProviderId`. For any other provider, `resolveModelProfile` (`modelRegistry.ts:46`) finds a profile whose `providerId` does not match, falls through to the synthesised branch, and returns a config with **`defaultTemperature` and `defaultMaxTokens` undefined**. The model registry is functional for exactly one provider.
2. Seven HTTP-layer `OPENAI_API_KEY` gates (§2.2).
3. `errors.ts:38` — error classification pattern-matches on the literal string `'OPENAI_API_KEY'`.
4. `featureBridge.ts:135` — OpenAI-specific remediation text.
5. `cortexAnalysis.ts:326`, `blockAiAssist.ts:189`, `copilotPatch.ts:177`, `cortexChat.ts:156`, `cortexNarrative.ts:179`, `proposalSectionCopilot.ts:204` — `model: 'gpt-4o-mini'` hardcoded into persisted and returned records.

`cortexAnalysis.ts:326` deserves separate mention: it sits inside `sanitizeAnalysis`, so **every stored analysis record claims it was produced by `gpt-4o-mini` regardless of which model or provider actually produced it.** Stored provenance is falsified by construction.

---

## 3. Security Assessment

### 3.1 AI Guard protects every endpoint — **NO AI GUARD EXISTS**

No middleware, decorator, wrapper, or function of that description exists. Each of the five AI routes re-implements ad-hoc validation inline, inconsistently.

### 3.2 Authentication — **PARTIAL. Two endpoints are anonymous.**

`supabase/config.toml:22`:
```toml
[functions.make-server-324f4fbe]
verify_jwt = false
```

Platform-level JWT verification is off, so authentication is entirely the handler's responsibility. Two AI handlers accept it and three do not:

| Route | Auth | Evidence |
|---|---|---|
| `POST /cortex/narrative` | team token | `index.tsx:3943` |
| `POST /proposal/section-copilot` | team token | `index.tsx:4061` |
| `POST /ai/chat` | team token | `index.tsx:4112` |
| **`POST /blocks/ai-assist`** | **none** | `index.tsx:3979-3983` |
| **`POST /blocks/copilot-interpret`** | **none** | `index.tsx:4021-4025` |

The justification is in a source comment at `index.tsx:3976`: *"anonKey is sufficient — no PII"*. Both halves are wrong. With `verify_jwt = false` the anon key is not required at all — a bare `curl` reaches the handler. And the exposure is not PII, it is **unauthenticated invocation of a metered third-party LLM**: an attacker gets a free GPT-4o-mini proxy (up to 900 output tokens per call, arbitrary prompt content via `current_content` and `context`) billed to MARQ, plus a denial-of-wallet vector.

**This is the single most serious finding in the review.**

### 3.3 Authorization — **NOT ENFORCED ANYWHERE**

`verifyTeamToken` (`index.tsx:249-276`) calls `supabaseAdmin.auth.getUser(token)` and returns `user.id` if a user exists. It never inspects `user_metadata.role` or `user_metadata.teamRole`, despite both being written at `index.tsx:182`, `2696`, `2741` and read for display at `2659`.

**Any authenticated Supabase user in the project — including a self-registered one — passes every "team auth required" check in the system.** There is no role gate on any route.

Two escalation consequences outside the AI surface but reachable from the same actor model:

- `POST /team/invite` (`index.tsx:2681`) accepts a caller-supplied `teamRole` with no privilege check. A viewer, or any authenticated user, can mint an admin.
- `PATCH /team/members/:id` (`index.tsx:2731`) lets any authenticated user rewrite any other user's `teamRole`.

Client-side role logic exists (`src/app/core/roleEngine.ts:71` restricts `contract_clause` to admins), but it is enforced only in the browser. The server has no counterpart.

### 3.4 Tenant isolation — **DOES NOT EXIST ON THE AI PATH**

The repository layer models it (`repositories/submissionRepository.ts` filters `.eq('organization_id', ...)` in 8 places), but the live AI/KV path does not use those repositories. AI routes read `kv.get('sub:{id}')` with no org scoping. The codebase says so itself, at `src/app/components/SystemArchitecture.tsx:187`: *"Single-tenant architecture. Needs tenant isolation for multiple consultancy accounts."* — severity `high`. That self-assessment is accurate; the implementation report's claim is not.

### 3.5 Actor resolution — **INCORRECT**

`verifyTeamToken` returns a bare `userId: string`. No role, no organisation, no capability set. The resolved actor is never propagated into `intelligenceGenerate` — the gateway has no parameter for it. Consequently no downstream control (budget, policy, audit, rate limit) *can* be actor-scoped, because the actor is discarded at the HTTP boundary.

### 3.6 Prompt injection protection — **NONE**

Every prompt builder interpolates untrusted input raw:

- `copilotPatch.ts:104` — `USER REQUEST: "${req.user_input}"` — unescaped, unbounded, on an **unauthenticated** endpoint.
- `blockAiAssist.ts:~150` — `CURRENT CONTENT:\n${contentStr}` from the request body, unauthenticated.
- `proposalSectionCopilot.ts:157` — `USER INSTRUCTION: "${custom_prompt}"`.
- `cortexAnalysis.ts:26` — `Q${key}: ${String(val).substring(0,600)}` from the **public** diagnostic form.

There is no delimiter escaping, no instruction/data separation, no injection heuristics, and no input length ceiling anywhere on the server (`grep` for length limits on AI inputs returns only *output* truncations). The safety rules are prose inside the prompt — a request, not a control.

The `cortexAnalysis` path is the highest-value target: a public form submission's free text reaches an LLM whose structured output drives internal lead scoring and priority. It is also the best-defended, see §3.8.

### 3.7 Input validation — **PARTIAL, INCONSISTENT**

Present: required-field checks, enum whitelists for `type`/`action`/`section` (`index.tsx:3953, 3990, 4067`), and the `roi_financial_snapshot` block guard (`index.tsx:3996`, re-checked server-side at `blockAiAssist.ts:232` — correctly defence-in-depth).

Absent everywhere: **length limits, array-size limits, depth limits, total payload budget.** `current_content`, `block_summaries`, `context`, `rejection_contexts`, and chat `history` are all unbounded. On an unauthenticated endpoint this converts directly into cost.

### 3.8 Output validation — **MIXED; one genuinely strong implementation**

- **Strong:** `cortexAnalysis.ts:229-350` `sanitizeAnalysis` clamps every numeric field, whitelists every enum, caps every array and string. This is the reference-quality validator in the codebase and should be the template for the others.
- **Weak:** `gateway.ts:23` `validateOutput` checks non-empty, JSON-parseable, and top-level required-key presence. It never validates types or values.
- **Absent:** `blockAiAssist.ts:250` and `copilotPatch.ts:240` accept whatever the model returns after a single `typeof === 'object'` check. `parsed.intent` is not validated against the seven supported intents. `parsed.targets` is not filtered.

### 3.9 PII redaction — **DOES NOT EXIST**

`cortexAnalysis.ts:42` sends the client's email address to OpenAI verbatim:
```
Email: ${sub.email || ''}
```
alongside company name, revenue band, employee count, and every free-text diagnostic answer. No redaction, tokenisation, hashing, or data-processing gate exists anywhere in the AI path. For a platform positioning itself for enterprise customers, this is a data-protection exposure with contractual and regulatory weight, not merely a missing feature.

### 3.10 Budget enforcement — **DOES NOT EXIST**

No cost model, no token accounting, no per-tenant or per-actor ceiling, no kill switch. `ProviderUsage` (`contracts.ts:71`) captures token counts and writes them to a 200-entry in-memory ring buffer that is never read by anything except one test. Nothing accumulates, nothing compares, nothing blocks.

The batch route makes this concrete: `POST /submissions/analyze-batch` (`index.tsx:3186`) loops **sequentially** over up to 10 submissions, each a `max_tokens: 2500` call, in a single request with no budget guard and no partial-failure ceiling.

### 3.11 Rate limiting — **REAL BUT NOT FIT FOR PURPOSE**

`index.tsx:66-91` implements a genuine in-memory per-IP limiter, 120 requests/60s, with correct `X-RateLimit-*` headers and periodic cleanup. Credit where due — it exists and it works.

It cannot serve as the AI control because:
- **Per-isolate.** Supabase edge functions run many concurrent isolates; each holds its own `rateLimitMap`. Effective global limit is 120 × isolate count.
- **Resets on cold start** — the code comment at line 62 concedes this.
- **Not AI-aware.** A 500ms KV read and a 4,000-token LLM call cost the same one unit.
- **IP-keyed only.** No user, tenant, or feature dimension. All un-headered traffic shares the `'unknown'` bucket.
- **No cost dimension**, which is the only dimension that matters for LLM abuse.

### 3.12 Secure error handling — **NO**

Provider error bodies are relayed to clients. `openaiAdapter.ts:90` builds `OpenAI API error ${response.status}: ${errText}` from the raw upstream body; `gateway.ts` propagates the message; the route handlers embed it in the response (`index.tsx:3966`, `4007`, `4042`, `4096`, `4127`). Upstream quota state, org identifiers, and model names reach the caller.

The global handler (`index.tsx:116-128`) returns `err.message`, `err.name`, and `c.req.url` to any caller on any unhandled error.

`errors.ts:29-68` classifies errors by substring-matching English text (`'aborted'`, `'rate limit'`, `'503'`, `'missing'`). This is fragile and order-dependent — an upstream body containing the word `unavailable` is reclassified as retryable regardless of what actually failed.

### 3.13 Sensitive data leakage — **CONFIRMED**

Client email to a third-party LLM (§3.9); upstream provider error bodies to the client (§3.12); `index.tsx:4116` logs 60 characters of every chat message to stdout; `keyMissing: true` in responses discloses backend credential state to unauthenticated callers on `/blocks/ai-assist`.

### 3.14 Bypasses found

| # | Bypass | Path |
|---|---|---|
| B1 | Anonymous LLM invocation | `verify_jwt=false` + no handler auth on 2 routes |
| B2 | Whole gateway disabled | `INTELLIGENCE_USE_GATEWAY_*=false` → legacy direct path |
| B3 | Non-team user acts as team | `verifyTeamToken` ignores `role` |
| B4 | Privilege escalation to admin | `POST /team/invite` with `teamRole: 'admin'` |
| B5 | Fact-lock evasion by field injection | `proposalSectionCopilot.ts:111` (see §4.5) |
| B6 | Locked-block targeting | `copilotPatch.ts` returns `targets` unfiltered |
| B7 | Admin-only block editing | `contract_clause` gated only in browser (`roleEngine.ts:71`) |
| B8 | Approval-state forgery | `PUT /proposals/:id/blocks` trusts client-supplied `revisions`/`locks` |

---

## 4. Governance Assessment

| Claim | Verdict | Evidence |
|---|---|---|
| Prompt Registry | **Absent** | Prompts are inline `const` strings: `featureBridge.ts:4-43` plus per-module builders |
| Prompt Versioning | **Absent** | `promptVersion` appears only in frontend type declarations (`src/app/types/cortex-ai-brain.ts:453`) and mock data (`mockCortexAIBrain.ts:697`). No server implementation. |
| Prompt Hashing | **Absent** | Zero matches repository-wide |
| Prompt Ownership | **Absent** | Zero matches repository-wide |
| Policy Engine | **Absent** | Zero matches. Policies are prose inside prompts. |
| Capability Enforcement | **Decorative** | See §4.4 |
| Fact Lock | **Partial, bypassable** | See §4.5 |
| Human Governance | **UI convention only** | See §4.6 |

### 4.4 Capability enforcement is decorative

`ModelCapabilities` (`contracts.ts:37`) is declared, and `DEFAULT_CAPABILITIES` (`modelRegistry.ts:5`) is attached to every profile — but **no code ever compares a request's requirements against a provider's capabilities**. The designated hook is empty:

```ts
// gateway.ts:17
function validateCapabilities(request: NormalizedAIRequest): void {
  if (request.responseFormat === 'json_object' && request.structuredOutput?.requiredFields?.length) {
    // validated after generation
  }
}
```

This function has no body, no return, and no caller-visible effect. `CAPABILITY_MISMATCH` is defined in `contracts.ts:32` and produced by exactly one site: the mock provider's test scenario (`mockProvider.ts:77`). `MODEL_NOT_FOUND` and `VALIDATION_FAILED` are declared and produced by nothing at all.

Related: `NormalizedAIRequest.modelProfile` is **never read by the gateway**. `gateway.ts:67` resolves the model from `request.feature` via `PROFILE_BY_FEATURE`. Every `modelProfile: 'chat-default'` argument threaded through `featureBridge` is dead weight — the only consumer is a mock's output string (`mockProvider.ts:106`).

### 4.5 Fact Lock — genuinely implemented, and bypassable two ways

`proposalSectionCopilot.ts:99-122` `enforceFactLock` is the one real governance control in the delivery: it deterministically re-injects `price`/`currency`/`duration` and `severity`/`confidence`/`evidence` over whatever the model returned, and reports which fields it had to restore. The intent is right and the code is clean.

Two defects break the guarantee:

**(a) Field-injection bypass — `proposalSectionCopilot.ts:111`**
```ts
if (!(field in current)) continue;   // nothing authoritative to protect
```
If a locked field is absent from `current_content`, the loop skips it — and the model's value for that field passes through untouched. Concretely: POST `current_content` **without** `price`; if the model emits `"price": 1`, it is returned as proposed content with `fact_lock_enforced: []`, i.e. explicitly reported as clean. The control is strongest exactly where it is needed least, and silent where a field is being introduced rather than altered.

**(b) The "authoritative" values are caller-supplied.** `enforceFactLock` restores from `req.current_content` — the HTTP request body — not from a server-side record. It defends against the *model*, never against the *caller*. The type even declares `context.locked_facts` (`proposalSectionCopilot.ts:63-67`) for exactly this purpose, and **nothing reads it**. A correct implementation resolves authoritative values from the proposal record by ID.

**(c) Scope.** Only `proposalSectionCopilot` has a fact lock. `blockAiAssist.ts` handles the same `severity`/`confidence`/`evidence` fields on `proposal_diagnosis` blocks (`blockAiAssist.ts:100-106`) with the instruction `DO NOT change: "severity", "confidence", "evidence"` — **enforced only by asking the model.** That endpoint is the unauthenticated one.

Likewise `copilotPatch.ts:130-131`: *"NEVER target roi_financial_snapshot"*, *"NEVER target contract_clause without admin=true"* — prompt text with no server-side filter on the returned `targets` array. The `roi_financial_snapshot` case is saved downstream by the hard guard at `blockAiAssist.ts:232`; `contract_clause` has no such backstop.

### 4.6 Human Governance

"AI revision is ALWAYS pending — humans approve" is documented in three module headers. Server-side, `PUT /proposals/:proposalId/blocks` (`index.tsx:2190`) accepts client-supplied `blocks`, `revisions`, and `locks` arrays wholesale after a bare authentication check — no validation that AI-authored content is in `pending`, no approver identity, no immutable approval record. The optimistic-locking `baseRev` (`index.tsx:2169`) is well built and prevents *concurrent clobbering*; it does not constitute approval governance. Approval is a browser convention.

---

## 5. Provider Assessment

| Component | Status |
|---|---|
| Registry | **Implemented.** `providerRegistry.ts` — clean, duplicate-registration guarded (`:25`). |
| Capability Registry | **Decorative** (§4.4) |
| OpenAI adapter | **Implemented.** `openaiAdapter.ts` — correct, injectable `fetch`, usage parsing, abort signal wired. |
| Mock provider | **Implemented.** 11 deterministic scenarios. Contains the broken import at `:6`. |
| Anthropic provider | **DOES NOT EXIST.** Zero matches for `anthropic` repository-wide. |
| Health monitoring | **Not implemented** (below) |
| Circuit breaker | **DOES NOT EXIST** |
| Retry engine | **Minimal** (below) |
| Timeout handling | **Partial** (below) |
| Failover | **DOES NOT EXIST** |

### 5.1 Health monitoring is a tautology

`ProviderConfig.healthStatus` defaults to `'healthy'` (`providerRegistry.ts:35`) and is mutated only by `setProviderHealth` and `setProviderEnabled` — **neither of which is called from anywhere in the codebase.** No probe, no runtime failure feedback, no decay. `getProviderHealth` therefore returns `'healthy'` forever.

`setProviderHealth` is also simply wrong:
```ts
// providerRegistry.ts:82-83
entry.config.healthStatus = status;
if (reason) entry.config.healthStatus = status;   // same assignment; `reason` discarded
```
`ProviderHealth.reason` (`contracts.ts:67`) is declared and never populated.

This propagates into certification. `certification.ts:29` checks `health.status !== 'unavailable'` — a condition that is unconditionally true. And `runCertificationChecks` computes a status that **nothing enforces**: `assertProviderAvailable` (`providerRegistry.ts:88`) rejects only `certificationStatus === 'Disabled'`, so a provider certified `'Degraded'` (which is what OpenAI becomes on a credential-check failure) serves traffic normally. Certification is computed, stored, and ignored.

`health.ts` — the entire 5-line module — has **zero importers**. The `/health` endpoint (`index.tsx:458`) reports KV connectivity only and never mentions providers.

### 5.2 Retry engine

`gateway.ts:73-131`. Functional but minimal: fixed delay (`retryDelayMs`, default 250ms), **no exponential backoff, no jitter, no `Retry-After` handling**. Default `maxRetries: 1` → 2 attempts.

`RATE_LIMITED` is marked retryable (`errors.ts:50`, `openaiAdapter.ts:82`), so the system's response to a 429 is a fixed 250ms sleep and an immediate retry — synchronised across all concurrent callers, amplifying the condition that caused the 429.

`INVALID_OUTPUT` is non-retryable (`gateway.ts:26`), so a single malformed JSON response fails the request permanently. That is the inverse of the correct policy: transient model formatting errors are the textbook retry case, and rate limits are the textbook backoff case.

### 5.3 Timeout handling

`gateway.ts:75-76` creates an `AbortController` and passes the signal to the adapter, which forwards it to `fetch` (`openaiAdapter.ts:77`). This works for the OpenAI adapter.

Two gaps:
- **The gateway does not race the timeout.** It relies entirely on the adapter honouring the signal. An adapter that ignores it hangs the request indefinitely, and there is no interface obligation forcing compliance. The mock provider already ignores it.
- **Per-attempt, not per-request.** With `maxRetries` and a 30s timeout, worst-case wall time is `(maxRetries+1) × 30s + delays` with no overall deadline.

### 5.4 Attempting to break failover

**There is nothing to break.** `gateway.ts:61` reads a single `cfg.activeProviderId` and never reconsiders it:

```ts
const providerId = cfg.activeProviderId;
const adapter = assertProviderAvailable(providerId, requestId);
```

The retry loop reuses the *same adapter object* on every attempt. There is no candidate list, no ordering, no fallback selection, no health-based exclusion. If OpenAI is down, every AI feature is down — retried once, 250ms apart, then failed. Two registered providers exist; the gateway can address exactly one per deployment.

---

## 6. Observability Assessment

| Claim | Verdict |
|---|---|
| Audit | **Absent.** No AI audit record is written to KV, Postgres, or any sink. |
| Structured logging | **No.** `telemetry.ts:20` emits an unstructured interpolated string; the rest is emoji `console.log`. |
| Metrics | **No.** A 200-entry in-memory array (`telemetry.ts:3-4`). No counters, no histograms, no export. |
| Event Bus | **DOES NOT EXIST.** |
| Correlation IDs | **DOES NOT EXIST.** |
| Request IDs | **Partial — and not client-visible.** |
| Version tracking | **Falsified.** |
| Health endpoint | **Exists, excludes AI.** |

### 6.1 "Confirm every request is traceable" — **IT IS NOT**

This is a hard negative, verified by following the identifier end to end:

1. The HTTP layer generates **no** request identifier. `grep -rn "requestId" supabase/functions/server/*.ts` (excluding `intelligence/`) returns **zero** matches.
2. No handler accepts or propagates an inbound `X-Request-Id`/`traceparent`. Zero matches repository-wide.
3. `requestId` is minted *inside* the gateway (`gateway.ts:62`, `crypto.randomUUID()`), after auth, after validation.
4. Every `featureBridge` caller omits the optional `requestId` parameter, so a fresh UUID is generated per call.
5. The identifier is **never returned to the client**. `NarrativeResponse`, `ChatResponse`, `BlockAIAssistResponse`, and `ProposalSectionCopilotResponse` have no such field. Error responses carry it only inside `toHttpErrorPayload` (`errors.ts:71`), which **no route handler calls**.
6. The Hono request logger and the telemetry logger share no key.

**Net effect:** given a customer complaint, there is no identifier that joins an HTTP request to the LLM call it produced. Correlation is possible only by timestamp adjacency in stdout. The telemetry itself vanishes on isolate recycle, and `userId` is never attached to any AI telemetry record — so an AI request cannot be attributed to a user even in principle.

### 6.2 Version tracking is falsified

`TelemetryRecord` (`contracts.ts:144`) has no prompt version, no gateway version, no config hash. Separately, `cortexAnalysis.ts:326` hardcodes `model: 'gpt-4o-mini'` into every persisted analysis record irrespective of the model actually used (§2.5). Stored model provenance is not merely missing — it is wrong.

---

## 7. Performance Assessment

**Unbounded memory growth — `telemetry.ts:5`.** `recordedRequestAttempts` is a `Set` that accumulates 2 string entries per successful request and is **never pruned**. `telemetryBuffer` is correctly capped at 200 (`:17`); the dedupe Set is not. It is cleared only by `resetTelemetryForTests()`. In a long-lived isolate this grows without limit — at the stated target of millions of requests, this is an OOM, not a leak to monitor.

The dedupe logic is also redundant: `gateway.ts` returns immediately after a success record, so a duplicate success for the same `requestId` cannot occur. The Set defends against an impossible condition at the cost of unbounded memory.

**Other findings:**

- **`gateway.ts:76`** allocates a fresh `AbortController` + `setTimeout` per attempt (correct, but note there is no shared deadline).
- **`index.tsx:94`** — an uncleared `setInterval` in an edge function; the timer holds the isolate.
- **`index.tsx:3186`** — batch analysis loops **sequentially** over 10 submissions × 2500 max tokens in one request. Serial latency is 10× a single call, with no concurrency, no streaming, no job queue, and a realistic risk of exceeding the edge function wall clock.
- **`config.ts:20` `getIntelligenceConfig()` re-reads and re-parses ~14 environment variables on every call**, and is called from `gateway.ts:60`, `modelRegistry.ts:21` (once per profile resolution), and `config.ts:46` — several times per AI request. `parseInt` on every hop. Trivially cacheable.
- **`providerRegistry.ts:123` `listProviders()`** shallow-copies every config on each call; `certifyRegisteredProviders` walks the whole registry.
- **No caching of any kind** — no prompt cache, no response cache, no semantic cache, no OpenAI `prompt_cache` usage. Identical requests always cost full price.
- **No connection pooling / keep-alive tuning**, no streaming responses (every AI call blocks to completion before the client sees anything).
- **Bundle:** `CortexDashboard` chunk is **1,228 kB** (305 kB gzip), over Vite's warning threshold.

---

## 8. Test Validation

**Reported vs. reproduced — all suite counts are accurate:**

| Suite | Result |
|---|---|
| `test:intelligence` | **8/8 pass** |
| `test:features` | **368/368 pass** |
| `test:system` | **56/56 pass** |
| `test:database` | **19/19 pass** |
| `test:migration` | **36/36 pass** |
| **Total** | **487 pass, 0 fail** |

The numbers are real. **The AI coverage behind them is not.** Eight tests cover the entire AI foundation, and they test the following: mock success, duplicate registration, missing provider, one mock error scenario, one invalid-JSON scenario, telemetry-on-success, request-id stability, and provider listing.

**Untested — every control this review was asked to verify:**

- Retry behaviour (no test asserts a second attempt occurs)
- Timeout / abort behaviour
- Failover (nothing to test)
- Circuit breaking (nothing to test)
- Health transitions
- Certification enforcement
- Capability mismatch as a real path (only the mock's canned scenario)
- The legacy path — **zero tests**, on six modules of production code
- The feature-flag switch between paths
- `enforceFactLock` — **zero tests**, including the `:111` bypass
- Endpoint authentication/authorization — no test asserts that `/blocks/ai-assist` requires auth (it does not)
- Prompt injection
- Rate limiting
- Output-shape enforcement beyond top-level key presence
- `sanitizeAnalysis` — the best code in the delivery, untested

Test-scenario coverage is skewed toward what the mock provider makes easy, not toward what the architecture claims. Of the mock's 11 scenarios, 4 are exercised.

---

## 9. Runtime Validation

Reproduced independently on Node v22.22.2 after `npm ci` (277 packages).

| Gate | Result |
|---|---|
| `npm run build` | **PASS** — built in 19.21s. Warning: `CortexDashboard` chunk 1,228 kB. |
| `npm run typecheck` | **FAIL — all three boundaries** |
| ↳ `typecheck:web` | **FAIL — 34 errors across 20 files** (`tsc -p tsconfig.app.json`) |
| ↳ `typecheck:api` | **BLOCKED — no Deno toolchain.** Exits non-zero by design (`scripts/typecheck-deno.mjs:44`). |
| ↳ `typecheck:tests` | **FAIL** — includes `intelligence/providers/mockProvider.ts(6,8): error TS2307: Cannot find module './contracts.ts'` |
| All test suites | **PASS — 487/487** |

The `typecheck:api` situation deserves emphasis. The script's reasoning is sound — `tsc` genuinely cannot resolve `Deno` globals or `npm:` specifiers, and refusing to emit false diagnostics is the right call. But the operational consequence is that **the entire AI implementation is currently type-checked by nothing in any environment that lacks Deno**, and the `mockProvider.ts:6` defect is direct proof that this gap is already shipping bugs. A green CI run today tells you nothing about the AI code.

---

## 10. Technical Debt

### BLOCKER

| ID | Finding | Location |
|---|---|---|
| **B-1** | Unauthenticated LLM invocation on 2 endpoints | `supabase/config.toml:22`; `index.tsx:3979`, `4021` |
| **B-2** | Legacy direct-OpenAI path retained and env-selectable in all 6 modules | `config.ts:30-34` + 6 modules |
| **B-3** | No authorization anywhere; any authenticated user has full team privileges | `index.tsx:249-276` |
| **B-4** | Privilege escalation: any authenticated user can create/modify admins | `index.tsx:2681`, `2731` |
| **B-5** | `npm run typecheck` fails on all boundaries; AI code type-checked by nothing | `scripts/typecheck-all.mjs` |
| **B-6** | Broken import in shipped provider | `providers/mockProvider.ts:6` |
| **B-7** | No budget enforcement or cost ceiling of any kind | absent |
| **B-8** | Client PII (email) transmitted to third-party LLM unredacted | `cortexAnalysis.ts:42` |

### HIGH

| ID | Finding | Location |
|---|---|---|
| H-1 | Fact-lock field-injection bypass (`!(field in current) → continue`) | `proposalSectionCopilot.ts:111` |
| H-2 | Fact-lock authoritative values are caller-supplied; `context.locked_facts` unused | `proposalSectionCopilot.ts:63,107` |
| H-3 | No provider failover; single hardcoded provider per deployment | `gateway.ts:61` |
| H-4 | No circuit breaker | absent |
| H-5 | Health monitoring is a no-op; `setProviderHealth` never called and internally broken | `providerRegistry.ts:76-84` |
| H-6 | Certification computed but never enforced (`Degraded` serves traffic) | `certification.ts` / `providerRegistry.ts:88` |
| H-7 | No end-to-end request traceability; no correlation ID; requestId not returned | §6.1 |
| H-8 | No AI audit trail | absent |
| H-9 | Unbounded `Set` growth in telemetry | `telemetry.ts:5` |
| H-10 | No prompt injection defence; raw interpolation on unauthenticated endpoints | `copilotPatch.ts:104` et al. |
| H-11 | No input size limits on any AI endpoint | all AI routes |
| H-12 | Rate limiter is per-isolate, per-IP, cost-blind | `index.tsx:66-91` |
| H-13 | Provider error bodies relayed to clients | `openaiAdapter.ts:90` → route handlers |
| H-14 | Copilot `targets`/`intent` not validated or filtered server-side | `copilotPatch.ts:222-250` |
| H-15 | `blockAiAssist` has no fact lock on `severity`/`confidence`/`evidence` | `blockAiAssist.ts:100` |
| H-16 | No tenant isolation on the AI/KV path | §3.4 |
| H-17 | Persisted `model` field hardcoded, falsifying provenance | `cortexAnalysis.ts:326` + 6 sites |
| H-18 | 34 web typecheck errors across 20 files | §9 |

### MEDIUM

| ID | Finding | Location |
|---|---|---|
| M-1 | `validateCapabilities` is an empty no-op; capability enforcement absent | `gateway.ts:17` |
| M-2 | `modelProfile` never read by the gateway (dead API parameter) | `gateway.ts:67` |
| M-3 | `initializeModelRegistry('openai')` hardcoded; registry non-functional for other providers | `bootstrap.ts:13` |
| M-4 | No exponential backoff or jitter; `Retry-After` ignored | `gateway.ts:127` |
| M-5 | `INVALID_OUTPUT` non-retryable while `RATE_LIMITED` retries at fixed 250ms — inverted policy | `gateway.ts:26,124` |
| M-6 | Timeout not raced by the gateway; no overall request deadline | `gateway.ts:75` |
| M-7 | Error classification by English substring matching | `errors.ts:29-68` |
| M-8 | `getIntelligenceConfig()` re-parses ~14 env vars several times per request | `config.ts:20` |
| M-9 | Batch analysis is sequential and unbounded in latency | `index.tsx:3186` |
| M-10 | Global error handler leaks `err.message`, `err.name`, request URL | `index.tsx:116-128` |
| M-11 | Test harness (`testSetup.ts`) and reset hooks ship in the production bundle | `bootstrap.ts:18` |
| M-12 | `health.ts` has zero importers; `/health` excludes providers | `health.ts` |
| M-13 | `toHttpErrorPayload` never called by any route | `errors.ts:71` |
| M-14 | Six dead exports (`setProviderHealth`, `checkAllProviderHealth`, `validateRegistryConfiguration`, `getRegisteredModelProfiles`, `resolveActiveProvider`, `setProviderEnabled`) | registries |
| M-15 | `MODEL_NOT_FOUND`, `VALIDATION_FAILED` declared, never produced | `contracts.ts:24-35` |
| M-16 | Uncleared `setInterval` in edge runtime | `index.tsx:94` |
| M-17 | Approval state client-authored and server-trusted | `index.tsx:2190` |
| M-18 | Prompts duplicated between legacy and gateway paths (6× duplicate parse/validate blocks) | 6 modules |
| M-19 | `contract_clause` admin gate exists only in the browser | `roleEngine.ts:71` |
| M-20 | Chat message content logged to stdout | `index.tsx:4116` |

### LOW

| ID | Finding |
|---|---|
| L-1 | `CortexDashboard` bundle chunk 1,228 kB |
| L-2 | `keyMissing` flag discloses backend credential state to unauthenticated callers |
| L-3 | `package.json` name is still `@figma/my-make-file` |
| L-4 | `MARQ_CORTEX_STABILIZATION_ROADMAP.md` is a 0-byte tracked file |
| L-5 | Emoji-based logging is not machine-parseable |
| L-6 | No streaming responses on any AI endpoint |
| L-7 | `resolveModelProfile` silently synthesises a config on provider mismatch rather than failing loudly |
| L-8 | Commit hygiene: substantive changes landed under the message `"three"` |

**Positives worth preserving:** zero TODO/FIXME markers; zero circular dependencies; clean acyclic module layering; `sanitizeAnalysis` is genuinely strong; duplicate-registration guard; optimistic locking via `baseRev`; injectable `fetch` and env reader make the module properly testable; `roi_financial_snapshot` guarded at both HTTP and handler layers.

---

## 11. Risks

| # | Risk | Likelihood | Impact | Rationale |
|---|---|---|---|---|
| R-1 | **Denial-of-wallet / free LLM proxy** | High | Severe | B-1. Public, unauthenticated, unbounded input, no budget, cost-blind rate limiting. Discoverable by URL enumeration. |
| R-2 | **Silent regression to unmonitored legacy path** | Medium | High | B-2. One env var; no alarm, no telemetry, no health signal. Undetectable without an env audit. |
| R-3 | **Privilege escalation to platform admin** | Medium | Severe | B-3/B-4. Any authenticated Supabase identity. |
| R-4 | **Data-protection exposure** | High | High | B-8. Client email + full free-text to a third-party processor, no DPA-supporting control, no redaction, no residency handling. |
| R-5 | **Total AI outage on single-provider failure** | Medium | High | H-3/H-4. No failover, no breaker; 2 attempts 250ms apart, then everything fails. |
| R-6 | **Un-investigable incidents** | High | High | H-7/H-8. No correlation ID, no audit, no persisted telemetry, no actor attribution. |
| R-7 | **Type defects reaching production undetected** | High | Medium | B-5/B-6. AI code type-checked by nothing; a real defect is already shipped. |
| R-8 | **Commercial-term manipulation** | Low | High | H-1/H-2. Fact-lock evasion on pricing and severity fields. |
| R-9 | **Memory exhaustion at scale** | Medium | Medium | H-9. Unbounded Set at the stated million-request target. |
| R-10 | **Retry storm amplifying provider throttling** | Medium | Medium | M-4/M-5. Synchronised fixed-delay retries on 429. |

---

## 12. Recommendations

### Must fix before certification (blockers)

1. **Set `verify_jwt = true`** in `supabase/config.toml`, **and** add explicit auth to `/blocks/ai-assist` and `/blocks/copilot-interpret`. Defence in depth — do not rely on the platform flag alone.
2. **Introduce a real AI Guard as Hono middleware** mounted on all AI routes, executing in fixed order: `authenticate → resolve actor (id, role, org) → authorize capability → validate & bound input → check budget → rate-limit (actor + cost) → redact → invoke gateway → validate output → audit`. Every AI route must be unable to execute without it. Make bypass structurally impossible rather than conventionally avoided.
3. **Delete the legacy path.** Remove all six `*Legacy` functions, all six `isGatewayEnabledForFeature` branches, and the five `INTELLIGENCE_USE_GATEWAY_*` flags. If rollback confidence is genuinely needed, roll back the *deployment*, not the code path. Retaining both is what makes the single-path invariant unverifiable.
4. **Enforce authorization.** Extend `verifyTeamToken` to return `{ userId, role, teamRole, organizationId }` and reject non-`team` roles. Add an explicit admin gate to `/team/invite` and `/team/members/:id`.
5. **Make `typecheck:api` a real, always-runnable gate.** Add Deno to CI and to the dev container. Until then the AI code has no static verification at all. Fix `providers/mockProvider.ts:6` (`'./contracts.ts'` → `'../contracts.ts'`) and drive the 34 web errors to zero.
6. **Implement budget enforcement.** Persist token/cost accounting per actor and per organisation in Postgres; enforce a hard pre-flight ceiling and a global kill switch. Estimate cost from `maxTokens` before the call, reconcile from `ProviderUsage` after.
7. **Implement PII redaction** at the gateway boundary — email, phone, and named-entity patterns — before messages reach any adapter. Log the redaction map under the request ID so output can be rehydrated server-side if needed.
8. **Remove `Email: ${sub.email}`** from `cortexAnalysis.ts:42`. It contributes nothing to the analysis quality that the company profile does not already provide.

### High priority

9. **Fix the fact lock.** Change `proposalSectionCopilot.ts:111` to *delete* injected locked fields rather than skip them, resolve authoritative values from the server-side proposal record (use the already-declared `context.locked_facts`), extend the mechanism to `blockAiAssist`, and filter `copilotPatch` `targets` against a server-side locked-block list. Convert every "DO NOT change X" prompt line into a code-enforced control — a prompt is a request, not a policy.
10. **Implement failover and circuit breaking.** Replace `activeProviderId: string` with an ordered candidate list. Add a per-provider breaker (consecutive-failure threshold → open → half-open probe) that drives `healthStatus`, and have `assertProviderAvailable` consult it. This makes the currently-dead `setProviderHealth`/`ProviderHealth.reason` machinery real.
11. **Establish end-to-end traceability.** Accept or mint `X-Request-Id` in the Hono middleware, propagate it through `AIGuardContext` into `NormalizedAIRequest.requestId`, attach `actorId`/`organizationId`/`promptVersion` to every `TelemetryRecord`, return it in every response body and an `X-Request-Id` header, and emit one structured JSON log line per request.
12. **Persist an AI audit record** per invocation: request ID, actor, org, feature, prompt ID + version + hash, provider, model, token counts, cost, latency, outcome, fact-lock restorations, redactions. Immutable, queryable, retained.
13. **Bound all AI inputs** — per-field character caps, array-length caps, total payload cap — and reject over-limit requests at the guard with 413.
14. **Stop relaying provider error bodies.** Map every `ProviderError` to a safe client-facing message plus the request ID; log the diagnostic body server-side only. Wire the already-written `toHttpErrorPayload` into the routes and remove `err.message`/`c.req.url` from the global handler.
15. **Fix the memory leak** at `telemetry.ts:5` — remove the redundant dedupe Set entirely, or bound it to the ring buffer's contents.
16. **Add tenant scoping** to the AI path: derive `organizationId` from the actor, key all KV access by it, and reject cross-tenant access.

### Medium priority

17. Implement capability enforcement: give `validateCapabilities` a body that compares request requirements against the resolved provider's `ModelCapabilities` and throws `CAPABILITY_MISMATCH`. Either honour `request.modelProfile` or remove it from the contract.
18. Fix `bootstrap.ts:13` to initialise the model registry from `cfg.activeProviderId`, and make `resolveModelProfile` fail loudly on provider mismatch rather than silently synthesising a config with undefined defaults.
19. Rework retry policy: exponential backoff with jitter, honour `Retry-After`, make `INVALID_OUTPUT` retryable once, and add an overall request deadline distinct from the per-attempt timeout.
20. Replace substring-based error classification (`errors.ts:29-68`) with typed error propagation from adapters.
21. Cache `getIntelligenceConfig()` per request or per isolate.
22. Make batch analysis a queued job with bounded concurrency, or cap it well below 10.
23. Move `testSetup.ts` and the `*ForTests` reset hooks out of the production source tree.
24. Remove the six dead exports and `health.ts`, or wire `health.ts` into `/health` with real provider status.
25. Enforce approval state server-side on `PUT /proposals/:id/blocks` — reject client-supplied approval transitions and record approver identity.

### Improvements (post-certification)

26. Build the Prompt Registry properly: versioned, content-hashed, owner-attributed prompt records with the hash stamped into every telemetry and audit row. This is what makes "which prompt produced this output?" answerable, and it is a prerequisite for the governance story.
27. Build the Policy Engine as a declarative rule set (allowed features per role, locked fields per section, forbidden block types per capability) evaluated in the guard — replacing the current pattern of encoding policy as prose in prompts.
28. Add an Event Bus so audit, metrics, and alerting subscribe rather than being called inline.
29. Add response streaming for chat, prompt/response caching, and provider-side prompt caching.
30. Add a genuine Anthropic adapter — the second provider is what will actually prove the abstraction. Building it will surface every remaining OpenAI-ism.
31. Extend AI test coverage to retry, timeout, failover, breaker, fact lock, guard bypass attempts, and injection corpora. Target the controls, not the mock's convenient scenarios.

---

## 13. Improvements — where the design is right and should be kept

Not everything here needs rework, and the remediation should not discard what is sound:

- **The layering is correct.** `contracts → errors/env → registries → gateway → featureBridge → features`, acyclic, verified. Build the guard *above* this, not through it.
- **`contracts.ts` is a good provider-neutral contract.** `NormalizedAIRequest`/`NormalizedAIResponse`/`AIProviderAdapter` are the right shapes. They need additive fields (actor, org, prompt version, budget) — not redesign.
- **Dependency injection is already in place.** `setFetchImplementationForTests` and `setEnvReaderForTests` mean the module is testable without network or environment. The test debt is coverage, not testability.
- **`sanitizeAnalysis` is the reference implementation** for output validation in this codebase. Generalise it into a shared, schema-driven validator and apply it to the block, copilot, and section paths.
- **The mock provider's 11 scenarios** are a good adversarial fixture. Only 4 are used; the other 7 are free coverage.
- **`enforceFactLock`'s core idea** — deterministic post-hoc re-injection with an explicit report of what the model tried to change — is exactly right. Fix the two defects and extend it; do not replace it.
- **`baseRev` optimistic locking** is well built.
- **`scripts/typecheck-deno.mjs`** refusing to emit false diagnostics rather than falling back to `tsc` is correct engineering judgement. Give it a Deno toolchain rather than weakening it.

---

## 14. Certification Decision

# REQUIRES FIXES

**Rationale.** The delivery contains real, competently-structured engineering — but its scope is a single-provider OpenAI abstraction, and it is being presented as a secure, governed, multi-provider AI control plane. Verified against source, **17 of the 39 enumerated capabilities do not exist in the codebase at all**, and several that do exist are computed-but-unenforced (certification), declared-but-unread (`modelProfile`, `locked_facts`, `ProviderHealth.reason`), or empty (`validateCapabilities`).

Certification is withheld on eight blockers, of which three are decisive on their own:

- **Two AI endpoints are open to the anonymous internet** with unbounded input and no budget control. This is live financial and abuse exposure, not a hardening gap.
- **The legacy AI path is intact and environment-selectable in all six modules**, so the "one execution path" property cannot be asserted about any running deployment — only about a default value.
- **The entire AI implementation is currently type-checked by nothing**, and that gap has already shipped a broken import in the provider layer.

The named security and governance layer — AI Guard, Control Plane, Prompt Registry, Policy Engine, budget, redaction, tenant isolation, audit, correlation — is the substance of "AI-01 Secure Foundation," and it has not been built. What exists is the provider plumbing that should sit *beneath* it.

**Path to certification.** The layering is sound and the contracts are close to right, so this is additive work rather than a rewrite. Recommendations 1–8 clear the blockers; 9–16 clear the material risk. On completion, re-review §3 (Security), §4 (Governance), §6 (Observability) and re-run all seven gates with a Deno toolchain present.

**Re-review required.** Not approvable as submitted.
