/**
 * Credential access for a self-hosted provider — AI-01 Batch 4E.
 *
 * A thin, TESTABLE band between the shared `ProviderCredentialResolver` and the
 * self-hosted adapter, and it exists for exactly one reason:
 *
 * ── THE CREDENTIAL-OPTIONAL HOLE IN BATCH 4D ───────────────────────────────
 *
 * `resolve()` returns `undefined` immediately for a provider whose profile is
 * not `required`. That is correct and deliberate for the synthetic mock — it has
 * no vendor and spends nothing — and it was harmless while `required: false`
 * described only the mock.
 *
 * Batch 4E introduces the first REAL provider that may legitimately need no
 * credential: an internal vLLM or Ollama deployment reachable without a key. If
 * such a provider simply executed whenever no credential resolved, then an
 * organization whose declared funding policy is `tenant_only` — "our AI traffic
 * uses our own provider credentials, or none" — would have its traffic served by
 * MARQ-funded infrastructure the moment routing reached this provider. Their
 * policy would have been widened by the mere PRESENCE of a self-hosted provider,
 * which is precisely the Batch 4D failure mode the certification closed.
 *
 * So the rule this band enforces is the Batch 4D rule, applied to the one case
 * the resolver structurally cannot see:
 *
 *   A credential resolved                 → execute, and report its category.
 *   No credential and one is required     → refuse.
 *   No credential, none required, and the
 *   execution may be MARQ-funded          → execute anonymously.
 *   No credential, none required, and the
 *   execution may NOT be MARQ-funded      → refuse.
 *
 * Nothing here widens anything. The funding latch is read, never written, and
 * the only value it can produce is a refusal.
 *
 * WHY IT IS NOT IN THE ADAPTER. The adapter must not branch on tenant state —
 * it hands `invocation.tenant` to the credential layer unread, exactly as the
 * OpenAI and Anthropic adapters do. This IS the credential layer for that
 * provider, and keeping it in its own file is what lets the rule be attacked
 * directly by test rather than through an HTTP double.
 */

import type {
  AICredentialSourceCategory,
  CredentialTenant,
  ProviderCredentialResolver,
} from '../credentials/contracts.ts';
import { marqFundingPermitted } from '../credentials/executionFunding.ts';

export type SelfHostedCredentialOutcome =
  | {
      readonly kind: 'credential';
      readonly secret: string;
      readonly category: AICredentialSourceCategory;
    }
  /** No credential, none required, and nothing forbids platform funding. */
  | { readonly kind: 'anonymous' }
  /**
   * Refused. `diagnostics` is for the OPERATOR channel only and is deliberately
   * uniform across the reasons: "nothing is configured", "the tenant's key would
   * not open" and "the tenant's policy forbids ours" are three server-side facts
   * and one caller-facing answer, because distinguishing them lets a caller probe
   * another organization's credential state one request at a time.
   */
  | { readonly kind: 'refused'; readonly diagnostics: string };

export interface SelfHostedCredentialAccessOptions {
  readonly providerId: string;
  readonly credentialRequired: boolean;
  readonly credentials: ProviderCredentialResolver;
}

export interface SelfHostedCredentialAccess {
  open(tenant?: CredentialTenant): Promise<SelfHostedCredentialOutcome>;
}

export function createSelfHostedCredentialAccess(
  options: SelfHostedCredentialAccessOptions,
): SelfHostedCredentialAccess {
  const { providerId, credentialRequired, credentials } = options;

  return {
    async open(tenant) {
      // The tenant is passed through UNREAD by the adapter and interpreted only
      // by the resolver. It is read HERE for one thing — the funding latch —
      // and that read can only ever produce a refusal.
      const resolved = await credentials.resolve(providerId, tenant);
      const secret = resolved?.secret.trim();
      if (resolved !== undefined && secret !== undefined && secret !== '') {
        return { kind: 'credential', secret, category: resolved.category };
      }

      if (credentialRequired) {
        return {
          kind: 'refused',
          diagnostics: `no credential resolved for ${providerId} on this request`,
        };
      }

      // ── THE 4D CONTAINMENT, FOR A CREDENTIAL-OPTIONAL PROVIDER ────────────
      //
      // `membershipVerified: false` is the AI_ALLOW_DEFAULT_ORGANIZATION
      // fallback — an account with no membership row placed in the deployment's
      // default organization. It confers no tenant identity, so it neither
      // grants nor constrains anything here, which is the same reading the
      // resolver applies.
      if (
        tenant !== undefined &&
        tenant.membershipVerified === true &&
        tenant.funding !== undefined &&
        !marqFundingPermitted(tenant.funding.mode)
      ) {
        return {
          kind: 'refused',
          diagnostics:
            `platform-funded execution is withheld for the authenticated tenant on ` +
            `${providerId}: its funding policy is ${tenant.funding.mode} and this provider ` +
            'would execute on platform-funded infrastructure with no credential of theirs',
        };
      }

      return { kind: 'anonymous' };
    },
  };
}
