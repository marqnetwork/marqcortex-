/**
 * Customer AI provider credential (BYOK) API client — AI-01 Batch 4D.
 *
 * The organization console's only route to its own AI provider credentials. It
 * is deliberately thin: every rule that matters — which organization this
 * request is for, who may act, what a change means, whether it persists — is
 * enforced server-side, and this file's job is to carry a request there and
 * bring a typed answer back.
 *
 * ── THREE THINGS THIS CLIENT DELIBERATELY DOES NOT DO ─────────────────────
 *
 * IT DOES NOT NAME AN ORGANIZATION. There is no `organizationId` parameter on
 * any function here and no organization in any path. The server resolves the
 * tenant from the authenticated session, and admits a caller-supplied hint only
 * when the account holds a verified membership in it — so a client that named
 * one could narrow its own authority and never widen it, and naming one at all
 * would teach the next reader that the tenant is the client's to choose.
 *
 * IT DOES NOT DECIDE WHAT THE ADMINISTRATOR MAY SEE OR CHANGE. The server
 * refuses the same operation whether or not a button was drawn.
 *
 * IT DOES NOT INVENT DEMO DATA. Every other service in this console falls back
 * to seed data when the backend is off, which is right for a sales demo of a
 * dashboard and wrong for a credential panel: an administrator who "revokes
 * their API key" against fabricated state and sees success has been told a
 * dangerous lie.
 *
 * ── AND WHAT NEVER COMES BACK ─────────────────────────────────────────────
 *
 * NOTE WHAT IS MISSING FROM EVERY TYPE BELOW, AND THAT IT IS MISSING ON
 * PURPOSE. There is no `secret`, no `apiKey`, no `value`, no `plaintext`, no
 * ciphertext, no initialisation vector and no root key identity on any response
 * shape here, because there is no server operation that returns one. A stored
 * provider credential is write-only material: it goes up once, in
 * `configureOrganizationCredential`, and the only things that ever come back
 * are a keyed fingerprint, at most four characters, and timestamps.
 *
 * The console therefore CANNOT display a stored key, and not because it chooses
 * not to — because it is never given one.
 */

import { edgeFunctionBaseUrl } from '@/config/supabase.config';
import { isBackendEnabled } from '@/config/runtime';

const BASE = edgeFunctionBaseUrl;
const BYOK_BASE = '/ai/organization/providers';

// ── Server contracts ────────────────────────────────────────────────────────
//
// Mirrors of the server's read models. Kept structural and partial on purpose:
// the console renders what it understands and ignores the rest, so a server
// that adds a field does not break a deployed console.

/** What this organization's requests authenticate with right now. */
export type ByokEffectiveSource =
  /** This organization's own credential. Their vendor account is billed. */
  | 'customer_byok'
  /**
   * The MARQ platform arrangement, whatever it is.
   *
   * DELIBERATELY UNDESCRIBED. The server distinguishes a Cortex-managed
   * platform credential from a deployment environment variable; a customer is
   * told `platform` for both, because which of MARQ's arrangements is in force
   * is a fact about MARQ's deployment and not about this customer.
   */
  | 'platform'
  /** Nothing would authenticate a request for this organization right now. */
  | 'none';

export type ByokCredentialStatus = 'active' | 'inactive' | 'revoked' | 'not_configured';

/** What this organization falls back to when it has no credential of its own. */
export type ByokFallbackPolicy = 'platform' | 'tenant_only';

export interface ByokCredentialState {
  status: ByokCredentialStatus;
  configured: boolean;
  credentialId?: string;
  credentialName?: string;
  /** Keyed, truncated digest. Identifies a key; never reveals one. */
  fingerprint?: string;
  lastFour?: string;
  secretVersion?: number;
  createdAt?: string;
  rotatedAt?: string;
  revokedAt?: string;
}

export interface ByokProvider {
  providerId: string;
  displayName: string;
  billable: boolean;
  /** Whether this organization may configure a credential for this provider. */
  available: boolean;
  /** Why not, when it is not. Names a platform STATE, never a platform secret. */
  unavailableReason?: string;
  /**
   * The adapter's own declaration, so the panel renders generically.
   *
   * `environmentVariable` is deliberately absent from this shape. It is the
   * name of a MARQ deployment secret; the platform console shows it because an
   * operator needs to find it, and it is nothing a customer has an action for.
   */
  credentialPolicy: {
    required: boolean;
    manageable: boolean;
    credentialFormatHint?: string;
  };
  credential: ByokCredentialState;
  fallback: ByokFallbackPolicy;
  effectiveSource: ByokEffectiveSource;
  /** One sentence, derived server-side from the state beside it. */
  message: string;
}

export interface ByokSummary {
  /** The organization this answer is about. Resolved server-side. */
  organizationId: string;
  providers: ByokProvider[];
  credentialStorage: {
    available: boolean;
    blocker?: string;
  };
  generatedAt: string;
}

/** Credential history. Metadata only — see the note at the top of this file. */
export interface ByokCredentialRecord {
  credentialId: string;
  providerId: string;
  credentialName: string;
  status: 'active' | 'superseded' | 'revoked';
  fingerprint: string;
  lastFour?: string;
  secretVersion: number;
  createdAt: string;
  rotatedAt?: string;
  revokedAt?: string;
  createdBy: string;
  revokedBy?: string;
}

// ── Transport ───────────────────────────────────────────────────────────────

/**
 * A typed failure, so the panel can distinguish "your role does not permit
 * this" from "that value is not acceptable" from "the change could not be
 * saved". Only the last is worth offering a retry for.
 */
export class ByokError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields?: string[];

  constructor(message: string, code: string, status: number, fields?: string[]) {
    super(message);
    this.name = 'ByokError';
    this.code = code;
    this.status = status;
    this.fields = fields;
  }

  /** True when the administrator's role is the problem, not their input. */
  get isForbidden(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

const BACKEND_DISABLED = new ByokError(
  'Provider credentials require the live backend. This console is running on demo data.',
  'BACKEND_DISABLED',
  503,
);

async function call<T>(
  path: string,
  accessToken: string,
  init: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown } = {},
): Promise<T> {
  // No demo fallback, deliberately. See the module comment: fabricated state on
  // a credential panel is worse than no credential panel.
  if (!isBackendEnabled()) throw BACKEND_DISABLED;

  const response = await fetch(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

  let payload: Record<string, unknown>;
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new ByokError(
      'The provider credential service returned an unreadable response.',
      'INVALID_RESPONSE',
      response.status,
    );
  }

  if (!response.ok || payload.success !== true) {
    throw new ByokError(
      typeof payload.error === 'string'
        ? payload.error
        : 'The provider credential request failed.',
      typeof payload.code === 'string' ? payload.code : 'INTERNAL_ERROR',
      response.status,
      Array.isArray(payload.fields) ? (payload.fields as string[]) : undefined,
    );
  }

  return payload as T;
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function fetchOrganizationProviders(accessToken: string): Promise<ByokSummary> {
  const { byok } = await call<{ byok: ByokSummary }>(BYOK_BASE, accessToken);
  return byok;
}

export async function fetchOrganizationCredentials(
  accessToken: string,
  providerId: string,
): Promise<ByokCredentialRecord[]> {
  const { credentials } = await call<{ credentials: ByokCredentialRecord[] }>(
    `${BYOK_BASE}/${encodeURIComponent(providerId)}/credentials`,
    accessToken,
  );
  return credentials;
}

// ── Mutations ───────────────────────────────────────────────────────────────

/**
 * Store or replace this organization's credential.
 *
 * ONE function for both, because the server has one operation for both: a
 * replacement is a store that had a predecessor. A caller does not have to know
 * which case they are in, which means a rotation cannot fail because the
 * console guessed wrong.
 *
 * `secret` is passed straight through and is not retained anywhere in this
 * module — no default, no local, no closure. The caller clears its own field;
 * see the panel's credential form.
 */
export async function configureOrganizationCredential(
  accessToken: string,
  providerId: string,
  input: { secret: string; credentialName?: string },
  reason: string,
): Promise<ByokProvider> {
  const { provider } = await call<{ provider: ByokProvider }>(
    `${BYOK_BASE}/${encodeURIComponent(providerId)}/credentials`,
    accessToken,
    {
      method: 'POST',
      body: {
        secret: input.secret,
        ...(input.credentialName ? { credentialName: input.credentialName } : {}),
        reason,
      },
    },
  );
  return provider;
}

export async function revokeOrganizationCredential(
  accessToken: string,
  providerId: string,
  credentialId: string,
  reason: string,
): Promise<ByokProvider> {
  const { provider } = await call<{ provider: ByokProvider }>(
    `${BYOK_BASE}/${encodeURIComponent(providerId)}/credentials/` +
      `${encodeURIComponent(credentialId)}/revoke`,
    accessToken,
    { method: 'POST', body: { reason } },
  );
  return provider;
}

export async function setOrganizationFallbackPolicy(
  accessToken: string,
  providerId: string,
  fallback: ByokFallbackPolicy,
  reason: string,
): Promise<ByokProvider> {
  const { provider } = await call<{ provider: ByokProvider }>(
    `${BYOK_BASE}/${encodeURIComponent(providerId)}/fallback`,
    accessToken,
    { method: 'PATCH', body: { fallback, reason } },
  );
  return provider;
}
