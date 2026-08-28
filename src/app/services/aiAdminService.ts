/**
 * AI administration API client (AI-01 Batch 2).
 *
 * The console's only route to the AI administration surface. It is deliberately
 * thin: every rule that matters — who may do what, what a change means, whether
 * it persists — is enforced server-side, and this file's job is to carry a
 * request there and bring a typed answer back.
 *
 * TWO THINGS THIS CLIENT DELIBERATELY DOES NOT DO.
 *
 *   It does not decide what the operator may see or change. `capabilities`
 *   arrives from the server on every overview and the UI reads it to decide
 *   what to RENDER — but hiding a control is a courtesy, never a control. The
 *   server refuses the same operation whether or not the button was drawn.
 *
 *   It does not invent a demo-mode administration surface. Every other service
 *   in this console falls back to seed data when the backend is off, which is
 *   right for a sales demo of a dashboard and wrong for a control panel: an
 *   operator who "engages the kill switch" against fabricated state and sees
 *   success has been told a dangerous lie. With the backend disabled these
 *   functions report that plainly instead.
 */

import { edgeFunctionBaseUrl } from '@/config/supabase.config';
import { isBackendEnabled } from '@/config/runtime';

const BASE = edgeFunctionBaseUrl;

// ── Server contracts ────────────────────────────────────────────────────────
//
// Mirrors of the server's read models. Kept structural and partial on purpose:
// the console renders what it understands and ignores the rest, so a server
// that adds a field does not break a deployed console.

export type AIAdminRole = 'super_admin' | 'organization_admin' | 'team_admin';

export type AIAdminCapability =
  | 'ai.admin.view'
  | 'ai.admin.audit.read'
  | 'ai.admin.settings.write'
  | 'ai.admin.provider.write'
  | 'ai.admin.budget.write'
  | 'ai.admin.budget.reset'
  | 'ai.admin.killswitch'
  // Provider administration (AI-01 Batch 4C). Mirrors the server's grant table.
  //
  // The console reads these to decide what to RENDER. That is a courtesy and
  // never a control: the server refuses the same operation whether or not the
  // button was drawn, which is why the credential form's absence for a
  // read-only operator is a nicety and its presence would still be safe.
  | 'ai.providers.view'
  | 'ai.providers.manage'
  | 'ai.providers.credentials.manage'
  | 'ai.providers.models.manage'
  | 'ai.providers.audit.read';

export interface AIAdminSettings {
  configurationVersion: number;
  aiEnabled: boolean;
  realRequestsEnabled: boolean;
  emergencyStop: { engaged: boolean; reason?: string; engagedBy?: string; engagedAt?: string };
  defaultProviderId?: string;
  providerPreference: string[];
  fallbackProviderId?: string;
  failoverEnabled: boolean;
  requireCertifiedProviders: boolean;
  /** Certification policy per population (AI-01 Batch 3A). Three, not one. */
  requireCertifiedAgents: boolean;
  requireCertifiedTools: boolean;
  defaultModelId?: string;
  providers: Record<string, { enabled: boolean; modelAllowList: string[] }>;
  retry: { baseDelayMs: number; maxDelayMs: number; jitterPercent: number };
  timeout: { workflowDeadlineMs: number };
  budget: {
    organizationDailyMicroUsd: number;
    actorDailyMicroUsd: number;
    alertThresholdPercent: number;
    enforce: boolean;
  };
  updatedAt: string;
  updatedBy: string;
  updatedReason: string;
}

export interface AIAdminProvider {
  providerId: string;
  displayName: string;
  priority: number;
  productionReady: boolean;
  billable: boolean;
  enabled: boolean;
  selectionReason: string;
  preferenceIndex: number;
  isDefault: boolean;
  isFallback: boolean;
  modelAllowList: string[];
  health: {
    state: string;
    certification: string;
    credentialsConfigured: boolean;
    circuit: 'closed' | 'open' | 'half_open';
    consecutiveFailures: number;
    successCount: number;
    failureCount: number;
    lastLatencyMs?: number;
    lastError?: string;
    lastFailureAt?: string;
    lastRecoveryAt?: string;
    checkedAt: string;
  };
  models: {
    modelId: string;
    permitted: boolean;
    isPinnedDefault: boolean;
    promptMicroUsdPer1k: number;
    completionMicroUsdPer1k: number;
    capabilities: {
      textGeneration: boolean;
      structuredOutput: boolean;
      chatCompletions: boolean;
      maxOutputTokens: number;
      maxContextTokens: number;
      zeroDataRetention: boolean;
    };
  }[];
}

export interface AIAdminBudget {
  platform: {
    capMicroUsd: number;
    spentMicroUsd: number;
    reservedMicroUsd: number;
    remainingMicroUsd: number;
    lifetimeSpentMicroUsd: number;
    attemptCount: number;
    updatedAt: string;
    enforced: boolean;
  };
  reservations: {
    openCount: number;
    openMicroUsd: number;
    open: {
      reservationId: string;
      reservedMicroUsd: number;
      createdAt: string;
      expiresAt: string;
      owner?: string;
    }[];
    reclaimedMicroUsd: number;
    reclaimedCount: number;
    unattributedSince?: string;
  };
  daily: {
    organizationDailyMicroUsd: number;
    actorDailyMicroUsd: number;
    alertThresholdPercent: number;
    enforce: boolean;
  };
  resets: {
    at: string;
    kind?: 'reset' | 'cap_raise';
    authorizedBy: string;
    reason: string;
    clearedMicroUsd: number;
    previousCapMicroUsd: number;
    newCapMicroUsd: number;
  }[];
}

export interface AIAdminUsage {
  generatedAt: string;
  window: string;
  totals: {
    requests: number;
    succeeded: number;
    failed: number;
    successRatePercent: number;
    failureRatePercent: number;
    tokens: number;
    estimatedCostMicroUsd: number;
    actualCostMicroUsd: number;
    providerAttempts: number;
    retries: number;
    failovers: number;
    circuitOpenEvents: number;
    guardRejections: number;
    governanceBlocks: number;
    governanceFlags: number;
    redactions: number;
  };
  features: {
    featureId: string;
    requests: number;
    succeeded: number;
    failed: number;
    tokens: number;
    estimatedCostMicroUsd: number;
    successRatePercent: number;
  }[];
  providers: {
    providerId: string;
    attempts: number;
    succeeded: number;
    failed: number;
    failovers: number;
    circuitOpenEvents: number;
    successRatePercent: number;
    latency: { p50: number; p95: number; p99: number };
  }[];
  errors: { code: string; count: number }[];
  latency: { p50: number; p95: number; p99: number };
}

export interface AIProviderHealthView {
  providerId: string;
  state: string;
  certification: string;
  credentialsConfigured: boolean;
  circuit: 'closed' | 'open' | 'half_open';
  consecutiveFailures: number;
  successCount: number;
  failureCount: number;
  lastLatencyMs?: number;
  lastError?: string;
  lastFailureAt?: string;
  lastRecoveryAt?: string;
  checkedAt: string;
}

export interface AIAdminHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  platformVersion: string;
  contractVersion: string;
  configurationVersion: number;
  aiEnabled: boolean;
  emergencyStopEngaged: boolean;
  checkedAt: string;
  issues: string[];
  /** Live provider state, carried on the overview so the page needs one call. */
  providers: AIProviderHealthView[];
  /** Why the selector would skip each provider, keyed by provider id. */
  selection: Record<string, string>;
  features: { registered: number; enabled: number };
  prompts: { registered: number; references: string[] };
}

export interface AIAdminOverview {
  actor: {
    actorId: string;
    role: AIAdminRole;
    capabilities: AIAdminCapability[];
    organizationScope: string[];
  };
  settings: AIAdminSettings;
  effective: { aiEnabled: boolean; realRequestsEnabled: boolean; providerPreference: string[] };
  health: AIAdminHealth;
  budget: AIAdminBudget;
  usage: AIAdminUsage;
}

export interface AIAdminDiagnostics {
  generatedAt: string;
  versions: {
    platformVersion: string;
    contractVersion: string;
    configurationVersion: number;
    prompts: { reference: string; fingerprint: string }[];
  };
  environment: {
    realRequestsPermittedByEnvironment: boolean;
    realRequestsEffective: boolean;
    spendDurable: boolean;
    auditDurable: boolean;
    auditRetentionDays: number;
    redactionEnabled: boolean;
    strictInputGuard: boolean;
    logLevel: string;
    defaultOrganizationId: string;
    allowDefaultOrganization: boolean;
    organizationAllowList: string[];
  };
  circuits: {
    providerId: string;
    state: string;
    consecutiveFailures: number;
    lastFailureAt?: string;
    lastRecoveryAt?: string;
  }[];
  rateLimits: {
    featureId: string;
    perActor: { limit: number; windowMs: number };
    perOrganization: { limit: number; windowMs: number };
    rateLimitCost: number;
  }[];
  retry: { baseDelayMs: number; maxDelayMs: number; jitterPercent: number };
  timeout: { workflowDeadlineMs: number };
  circuitPolicy: { failureThreshold: number; openMs: number; halfOpenSuccessesToClose: number };
}

export interface AIExecutionAuditRecord {
  auditId: string;
  recordedAt: string;
  requestId: string;
  correlationId: string;
  featureId: string;
  organizationId: string;
  actorId: string;
  actorRoles: string[];
  providerId?: string;
  modelId?: string;
  attempts: number;
  latencyMs: number;
  costMicroUsd?: number;
  outcome: 'success' | 'failure';
  errorCode?: string;
  policyRulesEvaluated: string[];
  policyViolation?: string;
  inputGuard: string;
  outputGuard: string;
  redactedCategories: string[];
  governanceFlags: string[];
}

export interface AIAdminChangeRecord {
  adminAuditId: string;
  recordedAt: string;
  action: string;
  outcome: 'applied' | 'rejected';
  actorId: string;
  actorEmail?: string;
  actorRole: string;
  target?: string;
  reason: string;
  before: Record<string, string>;
  after: Record<string, string>;
  configurationVersion?: number;
  rejectionCode?: string;
}

/**
 * A refused or failed administrative call, carrying the server's stable code.
 *
 * The code matters more than the message: a console distinguishes "you may not
 * do this" (FORBIDDEN) from "you did not say why" (VALIDATION_FAILED) from "the
 * change could not be saved" (INTERNAL_ERROR), and only the last one is worth
 * offering a retry for.
 */
export class AIAdminError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields?: string[];

  constructor(message: string, code: string, status: number, fields?: string[]) {
    super(message);
    this.name = 'AIAdminError';
    this.code = code;
    this.status = status;
    this.fields = fields;
  }

  /** True when the operator's role is the problem, not their input. */
  get isForbidden(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

const BACKEND_DISABLED = new AIAdminError(
  'AI administration requires the live backend. This console is running on demo data.',
  'BACKEND_DISABLED',
  503,
);

async function call<T>(
  path: string,
  accessToken: string,
  init: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown } = {},
): Promise<T> {
  // No demo fallback, deliberately. See the module comment: fabricated state on
  // a control panel is worse than no control panel.
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
    throw new AIAdminError(
      'The AI administration service returned an unreadable response.',
      'INVALID_RESPONSE',
      response.status,
    );
  }

  if (!response.ok || payload.success !== true) {
    throw new AIAdminError(
      typeof payload.error === 'string' ? payload.error : 'The AI administration request failed.',
      typeof payload.code === 'string' ? payload.code : 'INTERNAL_ERROR',
      response.status,
      Array.isArray(payload.fields) ? (payload.fields as string[]) : undefined,
    );
  }

  return payload as T;
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function fetchAIAdminOverview(accessToken: string): Promise<AIAdminOverview> {
  const { overview } = await call<{ overview: AIAdminOverview }>('/ai/admin/overview', accessToken);
  return overview;
}

export async function fetchAIAdminProviders(accessToken: string): Promise<AIAdminProvider[]> {
  const { providers } = await call<{ providers: AIAdminProvider[] }>(
    '/ai/admin/providers',
    accessToken,
  );
  return providers;
}

export async function fetchAIAdminBudget(accessToken: string): Promise<AIAdminBudget> {
  const { budget } = await call<{ budget: AIAdminBudget }>('/ai/admin/budget', accessToken);
  return budget;
}

export async function fetchAIAdminUsage(accessToken: string): Promise<AIAdminUsage> {
  const { usage } = await call<{ usage: AIAdminUsage }>('/ai/admin/usage', accessToken);
  return usage;
}

export async function fetchAIAdminDiagnostics(accessToken: string): Promise<AIAdminDiagnostics> {
  const { diagnostics } = await call<{ diagnostics: AIAdminDiagnostics }>(
    '/ai/admin/diagnostics',
    accessToken,
  );
  return diagnostics;
}

export async function fetchAIExecutionAudit(
  accessToken: string,
  limit = 50,
): Promise<AIExecutionAuditRecord[]> {
  const { records } = await call<{ records: AIExecutionAuditRecord[] }>(
    `/ai/admin/audit?limit=${encodeURIComponent(String(limit))}`,
    accessToken,
  );
  return records;
}

export async function fetchAIAdminChanges(
  accessToken: string,
  limit = 50,
): Promise<AIAdminChangeRecord[]> {
  const { records } = await call<{ records: AIAdminChangeRecord[] }>(
    `/ai/admin/audit/changes?limit=${encodeURIComponent(String(limit))}`,
    accessToken,
  );
  return records;
}

// ── Mutations ───────────────────────────────────────────────────────────────
//
// `reason` is a required parameter on every one of these, not an optional
// field on a patch object. Making it structurally impossible to call these
// without one is the client-side half of the server's rule.

export interface AIAdminSettingsPatch {
  aiEnabled?: boolean;
  realRequestsEnabled?: boolean;
  defaultProviderId?: string | null;
  providerPreference?: string[];
  fallbackProviderId?: string | null;
  failoverEnabled?: boolean;
  requireCertifiedProviders?: boolean;
  requireCertifiedAgents?: boolean;
  requireCertifiedTools?: boolean;
  defaultModelId?: string | null;
  retry?: { baseDelayMs?: number; maxDelayMs?: number; jitterPercent?: number };
  timeout?: { workflowDeadlineMs?: number };
  budget?: {
    organizationDailyMicroUsd?: number;
    actorDailyMicroUsd?: number;
    alertThresholdPercent?: number;
    enforce?: boolean;
  };
}

export async function updateAISettings(
  accessToken: string,
  patch: AIAdminSettingsPatch,
  reason: string,
): Promise<AIAdminSettings> {
  const { settings } = await call<{ settings: AIAdminSettings }>('/ai/admin/settings', accessToken, {
    method: 'PATCH',
    body: { ...patch, reason },
  });
  return settings;
}

export async function setAIEmergencyStop(
  accessToken: string,
  engaged: boolean,
  reason: string,
): Promise<AIAdminSettings> {
  const { settings } = await call<{ settings: AIAdminSettings }>(
    '/ai/admin/kill-switch',
    accessToken,
    { method: 'POST', body: { engaged, reason } },
  );
  return settings;
}

export async function updateAIProvider(
  accessToken: string,
  providerId: string,
  patch: { enabled?: boolean; modelAllowList?: string[] | null },
  reason: string,
): Promise<AIAdminProvider[]> {
  const { providers } = await call<{ providers: AIAdminProvider[] }>(
    `/ai/admin/providers/${encodeURIComponent(providerId)}`,
    accessToken,
    { method: 'PATCH', body: { ...patch, reason } },
  );
  return providers;
}

/**
 * Clear settled spend and every open hold.
 *
 * Takes no ceiling. A reset and a ceiling increase are different decisions with
 * different blast radii, and the server refuses a reset that carries a new cap —
 * so offering the parameter here would only produce a guaranteed 400. Raising
 * the ceiling is `increaseAISpendCap`.
 */
export async function resetAISpend(
  accessToken: string,
  reason: string,
): Promise<AIAdminBudget> {
  const { budget } = await call<{ budget: AIAdminBudget }>('/ai/admin/budget/reset', accessToken, {
    method: 'POST',
    body: { reason },
  });
  return budget;
}

export async function increaseAISpendCap(
  accessToken: string,
  capMicroUsd: number,
  reason: string,
): Promise<AIAdminBudget> {
  const { budget } = await call<{ budget: AIAdminBudget }>(
    '/ai/admin/budget/increase',
    accessToken,
    { method: 'POST', body: { capMicroUsd, reason } },
  );
  return budget;
}

// ── Provider administration (AI-01 Batch 4C) ────────────────────────────────
//
// NOTE WHAT IS MISSING FROM EVERY TYPE BELOW, AND THAT IT IS MISSING ON PURPOSE.
//
// There is no `secret`, no `apiKey`, no `value` and no `plaintext` on any
// response shape here, because there is no server operation that returns one.
// A stored provider credential is write-only material: it goes up once, in
// `setAIProviderCredential`, and the only things that ever come back are a
// keyed fingerprint, at most four characters, and timestamps.
//
// The console therefore CANNOT display a stored key, and not because it chooses
// not to — because it is never given one.

/** How a provider's credential is managed. Never how to obtain it. */
export type AICredentialManagement =
  | 'cortex_managed'
  | 'deployment_managed'
  | 'not_required'
  | 'unconfigured';

export interface AIProviderCredentialState {
  configured: boolean;
  source: 'managed' | 'environment' | 'none';
  management: AICredentialManagement;
  credentialId?: string;
  credentialName?: string;
  /** Keyed, truncated digest. Identifies a key; never reveals one. */
  fingerprint?: string;
  lastFour?: string;
  createdAt?: string;
  rotatedAt?: string;
  environmentCredentialPresent: boolean;
  /** The variable's NAME, so an operator can find it. Not its value. */
  environmentVariable?: string;
  managedStorageAvailable: boolean;
  managedStorageBlocker?: string;
}

export interface AIProviderModelState {
  modelId: string;
  displayName: string;
  known: true;
  certification: string;
  enabled: boolean;
  runtimeEligible: boolean;
  isPinnedDefault: boolean;
  promptMicroUsdPer1k: number;
  completionMicroUsdPer1k: number;
  capabilities: {
    textGeneration: boolean;
    structuredOutput: boolean;
    chatCompletions: boolean;
    maxOutputTokens: number;
    maxContextTokens: number;
    zeroDataRetention: boolean;
  };
}

export interface AIProviderAdministration {
  providerId: string;
  displayName: string;
  priority: number;
  productionReady: boolean;
  billable: boolean;
  /**
   * The adapter's own declaration of how it authenticates.
   *
   * THIS is what makes the provider list generic. The console renders a
   * credential form when `manageable` is true and omits it when it is false —
   * there is no `providerId === 'openai'` anywhere in the UI, so a provider
   * added in Batch 4E renders correctly with no frontend change.
   */
  credentialPolicy: {
    required: boolean;
    manageable: boolean;
    environmentVariable?: string;
    credentialFormatHint?: string;
  };
  enabled: boolean;
  certification: string;
  health: {
    state: string;
    circuit: 'closed' | 'open' | 'half_open';
    consecutiveFailures: number;
    successCount: number;
    failureCount: number;
    lastLatencyMs?: number;
    lastError?: string;
    lastFailureAt?: string;
    lastRecoveryAt?: string;
    checkedAt: string;
  };
  eligible: boolean;
  selectionReason: string;
  credential: AIProviderCredentialState;
  models: AIProviderModelState[];
  modelsAvailable: number;
  modelsEnabled: number;
  configurationPersisted: boolean;
  lastConfigurationChangeAt?: string;
  lastConfigurationChangeBy?: string;
  message: string;
}

export interface AIProviderAdministrationSummary {
  providers: AIProviderAdministration[];
  exposure: {
    maxReservationMicroUsd: number;
    maxFeatureId?: string;
    maxProviderId?: string;
    maxModelId?: string;
    ceilingMicroUsd: number;
    withinCeiling: boolean;
  };
  managedCredentials: {
    available: boolean;
    durable: boolean;
    keyId?: string;
    blocker?: string;
  };
  generatedAt: string;
}

/** Credential history. Metadata only — see the note at the top of this section. */
export interface AIProviderCredentialRecord {
  credentialId: string;
  configurationId: string;
  providerKey: string;
  credentialName: string;
  status: 'active' | 'superseded' | 'revoked';
  fingerprint: string;
  lastFour?: string;
  secretVersion: number;
  keyId: string;
  createdAt: string;
  updatedAt: string;
  rotatedAt?: string;
  revokedAt?: string;
  createdBy: string;
  revokedBy?: string;
}

const PROVIDER_ADMIN_BASE = '/ai/admin/provider-administration';

export async function fetchAIProviderAdministration(
  accessToken: string,
): Promise<AIProviderAdministrationSummary> {
  const { providers } = await call<{ providers: AIProviderAdministrationSummary }>(
    PROVIDER_ADMIN_BASE,
    accessToken,
  );
  return providers;
}

export async function fetchAIProviderCredentials(
  accessToken: string,
  providerId: string,
): Promise<AIProviderCredentialRecord[]> {
  const { credentials } = await call<{ credentials: AIProviderCredentialRecord[] }>(
    `${PROVIDER_ADMIN_BASE}/${encodeURIComponent(providerId)}/credentials`,
    accessToken,
  );
  return credentials;
}

export async function setAIProviderEnabled(
  accessToken: string,
  providerId: string,
  enabled: boolean,
  reason: string,
): Promise<AIProviderAdministration> {
  const { provider } = await call<{ provider: AIProviderAdministration }>(
    `${PROVIDER_ADMIN_BASE}/${encodeURIComponent(providerId)}/enabled`,
    accessToken,
    { method: 'POST', body: { enabled, reason } },
  );
  return provider;
}

/**
 * Store or rotate a provider credential.
 *
 * ONE function for both, because the server has one operation for both: a
 * rotation is a set that had a predecessor. A caller does not have to know
 * which case they are in, which means a rotation cannot fail because the
 * console guessed wrong.
 *
 * `secret` is passed straight through and is not retained anywhere in this
 * module — no default, no local, no closure. The caller is expected to clear
 * its own field on success; see the console's credential form.
 */
export async function setAIProviderCredential(
  accessToken: string,
  providerId: string,
  input: { secret: string; credentialName?: string },
  reason: string,
): Promise<AIProviderAdministration> {
  const { provider } = await call<{ provider: AIProviderAdministration }>(
    `${PROVIDER_ADMIN_BASE}/${encodeURIComponent(providerId)}/credentials`,
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

export async function revokeAIProviderCredential(
  accessToken: string,
  providerId: string,
  credentialId: string,
  reason: string,
): Promise<AIProviderAdministration> {
  const { provider } = await call<{ provider: AIProviderAdministration }>(
    `${PROVIDER_ADMIN_BASE}/${encodeURIComponent(providerId)}/credentials/` +
      `${encodeURIComponent(credentialId)}/revoke`,
    accessToken,
    { method: 'POST', body: { reason } },
  );
  return provider;
}

export async function setAIProviderModelEnabled(
  accessToken: string,
  providerId: string,
  modelId: string,
  enabled: boolean,
  reason: string,
): Promise<AIProviderAdministration> {
  const { provider } = await call<{ provider: AIProviderAdministration }>(
    `${PROVIDER_ADMIN_BASE}/${encodeURIComponent(providerId)}/models/` +
      `${encodeURIComponent(modelId)}`,
    accessToken,
    { method: 'PATCH', body: { enabled, reason } },
  );
  return provider;
}

// ── Formatting helpers ──────────────────────────────────────────────────────

/**
 * Micro-USD to a human figure.
 *
 * The platform accounts in micro-USD integers so a ledger never accumulates
 * float error. That precision is worth keeping right up to the point of
 * display, and no further — an operator reading a spend ceiling wants "$7.40",
 * not "7400000".
 */
export function formatMicroUsd(microUsd: number): string {
  const dollars = microUsd / 1_000_000;
  if (dollars === 0) return '$0.00';
  // Sub-cent figures are real at these volumes; rounding them to $0.00 would
  // make a working cost dashboard look broken.
  if (Math.abs(dollars) < 0.01) return `$${dollars.toFixed(4)}`;
  return `$${dollars.toFixed(2)}`;
}

/** Percentage of a ceiling consumed, bounded to 0–100 for a progress bar. */
export function percentOf(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((part / whole) * 100)));
}

export function hasAICapability(
  capabilities: readonly AIAdminCapability[] | undefined,
  capability: AIAdminCapability,
): boolean {
  return capabilities?.includes(capability) ?? false;
}
