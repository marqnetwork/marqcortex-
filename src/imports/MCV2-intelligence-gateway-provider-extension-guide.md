# Intelligence Gateway — Open-Source Provider Extension Guide

This document describes how to add a new model provider to MARQ Cortex without rewriting business workflows.

## Prerequisites

- Provider adapter implementation in `supabase/functions/server/intelligence/providers/`
- Registry registration in `intelligence/bootstrap.ts` or a dedicated bootstrap helper
- Certification tests in `intelligence/*.test.ts`
- Environment configuration documented in `ARCHITECT.md`

## Steps to Add a Provider

### 1. Adapter

Create `providers/<providerId>Adapter.ts` implementing `AIProviderAdapter`:

- `providerId` — stable logical id (e.g. `ollama`, `openai-compatible`, `vllm`)
- `checkCredentials()` — verify required env vars
- `generate(ctx)` — map `NormalizedAIRequest` to provider HTTP/API and return `NormalizedAIResponse`

Do not import provider SDK types into shared contracts.

### 2. Configuration

Add env vars (server-side only):

| Variable | Purpose |
|----------|---------|
| `INTELLIGENCE_PROVIDER` | Select active provider id |
| `INTELLIGENCE_<PROVIDER>_BASE_URL` | API base for compatible/self-hosted endpoints |
| `INTELLIGENCE_<PROVIDER>_API_KEY` | Optional key |

Model ids remain in `modelRegistry.ts` profiles or env overrides (`INTELLIGENCE_MODEL_NARRATIVE`, etc.).

### 3. Capability Declaration

Declare `ModelCapabilities` on the adapter:

```typescript
{
  textGeneration: true,
  structuredOutput: true,  // only if provider supports JSON mode
  chatCompletions: true,
  maxOutputTokens: 4096,
}
```

### 4. Registry Registration

```typescript
registerProvider(createMyProviderAdapter(), {
  certificationStatus: 'Unverified',
});
```

### 5. Certification Tests

Add tests covering:

- Configuration validity
- Basic generation
- Structured output (if declared)
- Timeout / invalid output handling
- Usage normalization
- Capability truthfulness
- Safe disablement

Run: `npm run test:intelligence`

## Supported Extension Patterns

| Pattern | Adapter approach |
|---------|------------------|
| OpenAI-compatible HTTP API | Reuse `openaiAdapter` pattern with custom `apiBase` |
| Ollama local endpoint | HTTP adapter targeting `/api/chat` |
| vLLM self-hosted | OpenAI-compatible completions path |
| Hugging Face Inference | HTTP adapter with HF auth header |
| Custom internal endpoint | New adapter with org-specific request mapping |

## What Does NOT Change

- Frontend `dataService.ts` contracts
- Deterministic Cortex engines (`src/app/core/`)
- HTTP routes (`/cortex/narrative`, `/ai/chat`, etc.)
- Demo mode behavior (`BACKEND_INTEGRATION: false`)

## Rollback

Set `INTELLIGENCE_PROVIDER=openai` or disable per-feature gateway flags:

- `INTELLIGENCE_USE_GATEWAY_NARRATIVE=false`
- `INTELLIGENCE_USE_GATEWAY_ANALYSIS=false`
- `INTELLIGENCE_USE_GATEWAY_CHAT=false`
- `INTELLIGENCE_USE_GATEWAY_BLOCK_ASSIST=false`
- `INTELLIGENCE_USE_GATEWAY_COPILOT=false`

Legacy inline fetch paths remain in `*Legacy()` functions.
