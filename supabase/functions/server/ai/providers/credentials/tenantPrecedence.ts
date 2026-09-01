/**
 * The customer-BYOK precedence decision — AI-01 Batch 4D.
 *
 * ONE PURE FUNCTION, TWO CALLERS, AND THAT IS THE ENTIRE POINT OF THE FILE.
 *
 * Two places in the platform have to answer "what will this tenant execute
 * on?": the credential resolver, at the moment of an attempt, and the customer
 * BYOK console, when it tells an administrator what their organization is
 * configured to do. If those two derive the answer separately they will
 * eventually disagree — and the shape of that disagreement is a console
 * reporting "your key is in force" beside traffic still billing MARQ's vendor
 * account, or the reverse.
 *
 * So the decision is a function of four non-secret facts, it holds no state, it
 * touches no storage, and both callers ask it rather than reasoning.
 *
 * ── THE PRECEDENCE, AND WHY IT IS THIS AND NOT THE OBVIOUS ONE ─────────────
 *
 * The obvious precedence is "tenant, then platform, then environment, then
 * nothing", applied uniformly. It is wrong in one specific place, and the place
 * matters more than the rest of the ladder:
 *
 *   A TENANT WHOSE OWN CREDENTIAL EXISTS AND WILL NOT OPEN MUST NOT FALL
 *   THROUGH TO MARQ'S.
 *
 * That case — the root key rotated, the ciphertext was tampered with, the
 * record was written by something other than the sealing code — is not "this
 * tenant has no credential". It is "this tenant HAS a credential and the
 * platform cannot honour it", and the two are opposite instructions. Falling
 * through would move a customer's traffic onto MARQ's vendor account, silently,
 * at the exact moment their own credential became unreadable, and the console
 * would go on reporting `customer_byok` because a row still says `active`.
 *
 * That refusal is `fail_closed` below, and it is decided HERE rather than by
 * the resolver's catch block so a test can assert the decision without having
 * to arrange a decryption failure.
 *
 * ── WHAT THE LADDER ACTUALLY IS ────────────────────────────────────────────
 *
 *   1. tenant       An organization configuration that is PRESENT, ENABLED and
 *                   holds an ACTIVE credential. Open it. If it will not open,
 *                   REFUSE — never continue down this list.
 *
 *   2. platform     Everything else, WHERE THE TENANT'S OWN POLICY PERMITS IT:
 *                   no configuration at all, a configuration switched off, a
 *                   configuration whose credential was revoked. This is the
 *                   Batch 4C resolution, unchanged, and it is what a tenant
 *                   that never opts in gets forever.
 *
 *   3. fail_closed  The same states as (2) for a tenant that chose
 *                   `tenant_only`. Their policy is that their traffic reaches
 *                   their vendor account or none, and revoking their key is
 *                   how they exercise it.
 *
 * ── WHAT IS NOT A CASE HERE, BECAUSE IT IS NOT REACHABLE ──────────────────
 *
 * "This tenant's configuration belongs to a different organization" is absent
 * from this function, deliberately. The caller looks a configuration up BY the
 * authenticated organization id; a row for another tenant cannot be the row it
 * fetched. The resolver still asserts the equality before decrypting — see
 * `resolver.ts` — because a defence that costs one comparison is worth having
 * against a storage bug, but it is an assertion about the caller, not a branch
 * of this decision.
 */

import type { AIByokFallbackPolicy } from './credentialStore.ts';

/** What the caller should do for this tenant, on this provider, right now. */
export type TenantCredentialAction =
  /** Open the tenant's own active credential. Never fall through if it fails. */
  | 'tenant'
  /** Continue with the Batch 4C platform resolution. */
  | 'platform'
  /** Resolve nothing. The tenant's policy forbids executing on MARQ's key. */
  | 'fail_closed';

export interface TenantCredentialDecision {
  readonly action: TenantCredentialAction;
  /**
   * Why, in words an operator and a console can both use.
   *
   * NON-SECRET AND NON-SPECIFIC BY CONSTRUCTION: it names states, never
   * credential ids, fingerprints, organization ids or anything a caller could
   * use to probe another tenant. It is safe in an API response, which is what
   * lets the BYOK console explain a refusal instead of showing a bare error.
   */
  readonly reason: string;
}

/** The facts the decision is made from. All non-secret, all already fetched. */
export interface TenantCredentialFacts {
  /** An organization-scoped configuration exists for this (tenant, provider). */
  readonly configurationPresent: boolean;
  /** The customer has it switched on. A stored-but-off row resolves nothing. */
  readonly configurationEnabled: boolean;
  /** An `active` credential row exists under that configuration. */
  readonly activeCredentialPresent: boolean;
  /** The customer's fallback policy. Absent reads as `platform`. */
  readonly fallback?: AIByokFallbackPolicy;
}

/**
 * The fallback a configuration means, with the safe reading of "absent".
 *
 * Absent is `platform`, which is the value that changes nothing: a row written
 * before the column existed, or by an older service, behaves exactly as it did
 * in Batch 4C. Reading absent as `tenant_only` would take a tenant's AI down on
 * a migration.
 */
export function fallbackPolicyOf(
  value: AIByokFallbackPolicy | undefined,
): AIByokFallbackPolicy {
  return value === 'tenant_only' ? 'tenant_only' : 'platform';
}

/**
 * Decide, from non-secret facts alone.
 *
 * Pure: same inputs, same answer, no storage, no clock, no environment. That is
 * what makes the hostile cases — a disabled configuration, a revoked
 * credential, a `tenant_only` tenant with nothing configured — cheap enough to
 * test exhaustively rather than representatively.
 */
export function decideTenantCredential(
  facts: TenantCredentialFacts,
): TenantCredentialDecision {
  const fallback = fallbackPolicyOf(facts.fallback);

  // The one state that resolves the tenant's own key.
  if (facts.configurationPresent && facts.configurationEnabled && facts.activeCredentialPresent) {
    return {
      action: 'tenant',
      reason: 'this organization has an active provider credential of its own',
    };
  }

  // Everything below is "the tenant has no usable credential of its own". WHY
  // it has none decides what the console says; WHETHER MARQ's key stands behind
  // it is decided by the tenant's policy and by nothing else.
  const because = !facts.configurationPresent
    ? 'this organization has not configured a credential for this provider'
    : !facts.configurationEnabled
      ? 'this organization has switched its own credential off for this provider'
      : 'this organization has no active credential for this provider';

  if (fallback === 'tenant_only') {
    return {
      action: 'fail_closed',
      reason: `${because}, and its policy is to use its own credential only`,
    };
  }
  return { action: 'platform', reason: `${because}; the platform credential applies` };
}
