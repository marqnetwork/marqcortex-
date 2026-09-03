/**
 * Generic OpenAI-compatible self-hosted provider adapter — AI-01 Batch 4E.
 *
 * ONE ADAPTER, MANY RUNTIMES. Ollama, vLLM, LM Studio, LocalAI and every other
 * server that exposes an OpenAI-compatible `/chat/completions` endpoint speak
 * the SAME wire format. Writing an adapter per product would produce five files
 * that differ only in a hostname somebody typed into a console — which is the
 * per-vendor sprawl the provider contract exists to prevent. So the runtime
 * CATEGORY is `openai_compatible` and the deployment is configuration.
 *
 * WHAT THIS FILE IS NOT.
 *
 *   It is NOT a refactor of `openaiProvider.ts`, and OpenAI is NOT routed
 *   through it. That adapter is certified against a specific vendor's
 *   behaviour, with a declared catalogue, a published rate card and a
 *   production proof behind it. Merging the two would put every one of those
 *   certified facts at the mercy of a configuration row. Two files that look
 *   similar is a much smaller cost than one file that governs both.
 *
 *   It does NOT retry, time out, breaker, meter, log, route or reserve. One
 *   attempt, one translation, one normalized completion — the control plane
 *   applies everything else identically to every provider.
 *
 *   It does NOT read the tenant. `invocation.tenant` is handed to the credential
 *   layer unread, exactly as the OpenAI adapter hands it to the resolver: an
 *   organization id must never reach an endpoint, and nothing here sends it
 *   anywhere.
 *
 * WHERE THE URL COMES FROM. `definition.endpoint` is a `ValidatedEndpoint`,
 * which only the endpoint policy can produce, and it carries the composed
 * `chatCompletionsUrl`. This file performs no string concatenation with
 * operator input at all, so there is no shape of stored value that redirects
 * the request somewhere other than the intended path.
 */

import type {
  AIProviderAdapter,
  AIProviderCompletion,
  AIProviderDescriptor,
  AIProviderInvocation,
} from '../contracts/provider.ts';
import type { ProviderCredentialResolver } from './credentials/contracts.ts';
import type { SelfHostedProviderDefinition } from './selfHosted/definition.ts';
import type { FetchLike } from './openaiProvider.ts';
import { selfHostedDescriptor } from './selfHosted/definition.ts';
import { createSelfHostedCredentialAccess } from './selfHosted/credentialAccess.ts';
import { AIError } from '../contracts/errors.ts';

export interface SelfHostedProviderOptions {
  /**
   * A VALIDATED definition. The type is only producible by
   * `validateSelfHostedDefinition`, so there is no way to construct this
   * adapter around an endpoint the policy has not accepted.
   */
  readonly definition: SelfHostedProviderDefinition;
  /**
   * The shared, provider-neutral credential resolver. REQUIRED — unlike the
   * OpenAI and Anthropic adapters there is no environment-variable default to
   * fall back to, because a dynamic provider has no reviewed deployment secret
   * and fabricating a variable name for one would invent a credential source
   * nobody audited.
   */
  readonly credentials: ProviderCredentialResolver;
  /** Injected so the adapter is fully testable with no network access. */
  readonly fetchImpl?: FetchLike;
}

export function createSelfHostedProvider(options: SelfHostedProviderOptions): AIProviderAdapter {
  const { definition } = options;
  const descriptor: AIProviderDescriptor = selfHostedDescriptor(definition);
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const credentialAccess = createSelfHostedCredentialAccess({
    providerId: definition.providerId,
    credentialRequired: definition.credentialRequired,
    credentials: options.credentials,
  });

  return {
    descriptor,

    hasCredentials() {
      // The resolver reports a provider that needs no credential as CONFIGURED,
      // which is what lets a keyless internal endpoint be selectable at all.
      // Its authoritative funding decision still happens inside `invoke`.
      return options.credentials.describe(definition.providerId).configured;
    },

    credentialStatus() {
      const availability = options.credentials.describe(definition.providerId);
      return { source: availability.source, fingerprint: availability.fingerprint };
    },

    async invoke(invocation: AIProviderInvocation): Promise<AIProviderCompletion> {
      const access = await credentialAccess.open(invocation.tenant);
      if (access.kind === 'refused') {
        // ONE refusal for every unresolved case, and it names none of them —
        // the same discipline the OpenAI adapter applies. The actionable half
        // is in `diagnostics`, which the HTTP surface excludes from response
        // bodies by construction.
        throw new AIError('PROVIDER_AUTH_FAILED', 'The AI provider is not configured.', {
          providerId: definition.providerId,
          diagnostics: access.diagnostics,
        });
      }

      const body: Record<string, unknown> = {
        model: invocation.modelId,
        messages: invocation.generation.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        temperature: invocation.generation.temperature,
        max_tokens: invocation.generation.maxOutputTokens,
      };
      if (invocation.generation.responseFormat === 'json_object') {
        body.response_format = { type: 'json_object' };
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        // Correlation WITHOUT identity. This is the platform's own request id —
        // it lets an operator line an incident on their inference server up
        // against the Cortex trace, and it carries nothing about the tenant,
        // the actor or the organization.
        'X-Request-Id': invocation.requestId,
      };
      if (access.kind === 'credential') {
        // Sent ONLY when a credential actually resolved. A keyless endpoint gets
        // no `Authorization` header at all rather than an empty or `Bearer
        // undefined` one, which some servers accept and log.
        headers.Authorization = `Bearer ${access.secret}`;
      }

      let response: Response;
      try {
        response = await fetchImpl(definition.endpoint.chatCompletionsUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: invocation.signal,
        });
      } catch (error) {
        throw new AIError('PROVIDER_UNAVAILABLE', 'The AI provider could not be reached.', {
          providerId: definition.providerId,
          diagnostics: error instanceof Error ? error.message : String(error),
          cause: error,
        });
      }

      if (!response.ok) {
        throw await translateHttpFailure(definition.providerId, response);
      }

      let payload: OpenAICompatibleChatResponse;
      try {
        payload = (await response.json()) as OpenAICompatibleChatResponse;
      } catch (error) {
        throw new AIError(
          'INVALID_MODEL_OUTPUT',
          'The AI provider returned an unreadable response.',
          {
            providerId: definition.providerId,
            diagnostics: error instanceof Error ? error.message : String(error),
          },
        );
      }

      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim() === '') {
        throw new AIError('INVALID_MODEL_OUTPUT', 'The AI provider returned an empty response.', {
          providerId: definition.providerId,
          diagnostics: `finish_reason=${payload.choices?.[0]?.finish_reason ?? 'unknown'}`,
        });
      }

      return {
        content,
        // The SELECTED model id wins over whatever the server echoes. A
        // self-hosted server may report an internal name, a file path or a
        // quantisation suffix, and the audit record has to name the model the
        // platform priced and selected — otherwise cost attribution and the
        // completion disagree about what ran.
        modelId: invocation.modelId,
        usage: {
          promptTokens: payload.usage?.prompt_tokens ?? 0,
          completionTokens: payload.usage?.completion_tokens ?? 0,
          totalTokens:
            payload.usage?.total_tokens ??
            (payload.usage?.prompt_tokens ?? 0) + (payload.usage?.completion_tokens ?? 0),
        },
        finishReason: payload.choices?.[0]?.finish_reason,
        // Provenance, read off the resolution that actually happened. `none` is
        // the truthful answer for an endpoint that needed no credential, and it
        // is a category rather than a locator — see `AICredentialSourceCategory`.
        credentialSource: access.kind === 'credential' ? access.category : 'none',
      };
    },
  };
}

interface OpenAICompatibleChatResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/**
 * Map an HTTP failure onto the platform taxonomy.
 *
 * The server's error text goes to `diagnostics` and never to `message`, for the
 * same reason it does on the OpenAI path: an inference server's 400 body
 * frequently echoes the prompt, and a prompt may carry a tenant's business
 * data. `diagnostics` is excluded from response bodies by the HTTP surface.
 */
async function translateHttpFailure(providerId: string, response: Response): Promise<AIError> {
  let detail = '';
  try {
    detail = (await response.text()).slice(0, 500);
  } catch {
    detail = '(response body unavailable)';
  }
  const diagnostics = `HTTP ${response.status}: ${detail}`;

  if (response.status === 401 || response.status === 403) {
    return new AIError(
      'PROVIDER_AUTH_FAILED',
      'The AI provider rejected the platform credential.',
      { providerId, diagnostics },
    );
  }
  if (response.status === 429) {
    const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
    return new AIError('PROVIDER_RATE_LIMITED', 'The AI provider is rate limiting this platform.', {
      providerId,
      diagnostics,
      retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
    });
  }
  if (response.status >= 500) {
    return new AIError('PROVIDER_UNAVAILABLE', 'The AI provider is temporarily unavailable.', {
      providerId,
      diagnostics,
    });
  }
  return new AIError('INVALID_MODEL_OUTPUT', 'The AI provider rejected the request.', {
    providerId,
    diagnostics,
    retryable: false,
  });
}
