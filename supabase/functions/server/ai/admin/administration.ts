/**
 * AI Administration service — AI-01 Batch 2.
 *
 * The operational layer over the Batch 1 control plane. It administers the
 * plane; it is not a second way to use it. Every read here comes from the
 * plane's own state and every write goes through the plane's own settings
 * overlay, so there is nothing an administrator can change that the execution
 * path does not immediately observe, and nothing it can observe that the
 * console is guessing at.
 *
 * FIVE INVARIANTS, ENFORCED IN ONE PLACE.
 *
 *   1. Authorization is a capability check, server side, before anything else.
 *      There is no client-supplied role, and no endpoint performs its own
 *      comparison — `mutate` and `read` are the only doors.
 *
 *   2. Every mutation carries a reason. Not "should carry": a mutation with no
 *      reason is rejected before it reaches the plane, and the rejection is
 *      itself recorded.
 *
 *   3. Every mutation is audited with before and after — including the ones
 *      that fail authorization, which are the records a security review wants
 *      most and the ones a naive implementation never writes.
 *
 *   4. Administrative action may tighten the platform's posture freely and may
 *      loosen it only within the envelope the deployment granted. See
 *      `effectiveRealRequestsEnabled` in `runtime/operationalSettings.ts`.
 *
 *   5. Reads are tenant-scoped. A team or organization administrator sees their
 *      own organizations' audit records; only the platform operator sees all of
 *      them. The same boundary the execution path enforces, applied to reading.
 *
 * WHAT THIS MODULE DOES NOT DO, ON PURPOSE.
 *
 *   It does not enforce budgets — `policy/budget.ts` and `policy/spendLedger.ts`
 *   do, unchanged. It does not decide provider eligibility — `providers/selector.ts`
 *   does. It does not deny requests — the policy engine does. Every one of those
 *   would be a second implementation of a Batch 1 guarantee, and two
 *   implementations of a guarantee is zero guarantees.
 */

import type { AIControlPlane } from '../controlPlane.ts';
import type { AIAuditRecord } from '../observability/audit.ts';
import type { AIAuthenticator } from '../security/actor.ts';
import type { AIProviderHealth, AIModelDescriptor } from '../contracts/provider.ts';
import type { Clock } from '../runtime/clock.ts';
import type { IdFactory } from '../contracts/ids.ts';
import type { Logger } from '../observability/logger.ts';
import type { SpendRecord } from '../policy/spendLedger.ts';
import type {
  AIOperationalSettings,
  AIOperationalSettingsPatch,
} from '../runtime/operationalSettings.ts';
import type { AdminSettingsStore } from './settingsStore.ts';
import type { AdminAuditRecord, AdminAuditStore, AdminAuditWriter, AdminAction } from './adminAudit.ts';
import type { AIAdminActor, AIAdminCapability } from './rbac.ts';
import type { UsageReport } from './usage.ts';

import { AIError } from '../contracts/errors.ts';
import { CONTRACT_VERSION, PLATFORM_VERSION } from '../contracts/versions.ts';
import { SPEND_SCOPE, isUnboundedSpendCap, remainingMicroUsd } from '../policy/spendLedger.ts';
import { isolationKeyFor } from '../security/tenancy.ts';
import {
  aiExecutionPermitted,
  effectivePreference,
  effectiveRealRequestsEnabled,
  MAX_REASON_LENGTH,
  normalizeOperationalSettings,
  normalizeProviderSetting,
} from '../runtime/operationalSettings.ts';
import { NO_STORED_VERSION } from './settingsStore.ts';
import { applyEnvelope, envelopeFrom } from '../runtime/envelope.ts';
import {
  ADMIN_ACTION,
  changedKeys,
  createAdminAuditWriter,
  createCompositeAdminAuditStore,
  createMemoryAdminAuditStore,
  toChangeMap,
} from './adminAudit.ts';
import { requireCapability, resolveAdminActor, scopeAllows, scopeRecords } from './rbac.ts';
import type { RoutingOutcome, RoutingStrategy } from '../routing/contracts/routing.ts';
import type { RoutingSummary } from '../routing/routingLedger.ts';
import { createAuditedMutationRunner, createMutationChain } from './auditedMutation.ts';
import { buildUsageReport } from './usage.ts';
import {
  createProviderAdministration,
  type ProviderAdministrationSummary,
  type ProviderAdministrationView,
  type SelfHostedProviderInput,
} from './providerAdministration.ts';
import type { SelfHostedRegistrar } from '../providers/selfHosted/registrar.ts';
import type { ProviderAdministrationStore, ProviderCredentialMetadata } from '../providers/credentials/credentialStore.ts';
import type { ProviderCredentialResolver } from '../providers/credentials/contracts.ts';
import type { SecretCipher } from '../providers/credentials/secretCipher.ts';
import { unavailableSecretCipher } from '../providers/credentials/secretCipher.ts';

/**
 * The absolute ceiling an administrator may raise the MARQ spend cap to.
 *
 * The same $10,000 clamp `runtime/config.ts` applies to `AI_MAX_SPEND_USD`, for
 * the same reason: a figure above it is far more likely a units mistake —
 * micro-USD typed into a dollar field — than an intention, and the console is a
 * more likely place to make that mistake than an environment file.
 */
export const MAX_ADMIN_SPEND_CAP_MICRO_USD = 10_000 * 1_000_000;

/** Minimum characters in an audit reason, after trimming. */
const MIN_REASON_LENGTH = 4;

export interface AdminRequestMeta {
  readonly correlationId?: string;
  readonly clientIp?: string;
}

// ── Read models ─────────────────────────────────────────────────────────────

export interface AdminProviderView {
  readonly providerId: string;
  readonly displayName: string;
  readonly priority: number;
  readonly productionReady: boolean;
  readonly billable: boolean;
  readonly enabled: boolean;
  readonly health: AIProviderHealth;
  /** Why the selector would skip this provider, or `eligible`. */
  readonly selectionReason: string;
  /** Position in the effective preference order, or -1 when unlisted. */
  readonly preferenceIndex: number;
  readonly isDefault: boolean;
  readonly isFallback: boolean;
  readonly modelAllowList: readonly string[];
  readonly models: readonly {
    readonly modelId: string;
    readonly permitted: boolean;
    readonly isPinnedDefault: boolean;
    readonly promptMicroUsdPer1k: number;
    readonly completionMicroUsdPer1k: number;
    readonly capabilities: AIModelDescriptor['capabilities'];
  }[];
}

/**
 * ONE ORGANIZATION'S own lifetime ledger (AI-01 Batch 4D remediation, HIGH-1).
 *
 * ── WHY THIS IS A DIFFERENT TYPE FROM `AdminBudgetView` ───────────────────
 *
 * `AdminBudgetView` is MARQ's operational picture: the platform ceiling, every
 * open hold with its id and owner, the rolling daily allowances, the whole reset
 * history. That is the right answer for the estate MARQ operates and the wrong
 * one for a tenant ledger, because most of it is not about the tenant.
 *
 * WHAT THIS CARRIES IS EXACTLY WHAT THE FINDING PERMITS: cap, spent, reserved,
 * remaining, and the scope identity of a ledger the caller is authorised for.
 * There is deliberately no provider, no credential, no fingerprint, no key
 * identity and no configuration — the type structurally has no field one could
 * occupy, so this cannot carry credential data however it is serialised
 * downstream or however the surface below it changes.
 *
 * `openReservationCount` is a COUNT rather than the holds themselves: the
 * number is what tells an administrator whether a ceiling is being consumed
 * right now, and the ids and owners are MARQ's operational forensics rather
 * than a customer's business.
 */
export interface AdminOrganizationBudgetView {
  /** The organization this answer is about. Resolved and authorised, never echoed. */
  readonly organizationId: string;
  /** The ledger scope, so a dashboard never guesses the string. */
  readonly scope: string;
  readonly capMicroUsd: number;
  /**
   * Whether the ceiling is the governed UNBOUNDED one.
   *
   * Stated rather than left to be inferred from a nine-billion-dollar number,
   * because "this customer has no lifetime ceiling" is a governance fact an
   * operator must be able to read at a glance — and inferring it from a
   * magnitude is how a console eventually renders `$9,007,199,254.74`.
   */
  readonly unbounded: boolean;
  readonly spentMicroUsd: number;
  readonly reservedMicroUsd: number;
  readonly remainingMicroUsd: number;
  /** Settled spend across every reset — what this organization has ever spent. */
  readonly lifetimeSpentMicroUsd: number;
  readonly attemptCount: number;
  readonly openReservationCount: number;
  readonly updatedAt: string;
  /** Whether the ceiling actually refuses, or merely records. */
  readonly enforced: boolean;
  /** Authorised cap changes and resets on THIS ledger. Never another's. */
  readonly changes: SpendRecord['resets'];
}

export interface AdminBudgetView {
  /** The MARQ-funded lifetime ceiling. */
  readonly platform: {
    readonly capMicroUsd: number;
    /** Settled spend. The "current spend" figure. */
    readonly spentMicroUsd: number;
    /** Held for requests in flight. */
    readonly reservedMicroUsd: number;
    /** Cap minus settled minus reserved, floored at zero. */
    readonly remainingMicroUsd: number;
    /** Settled spend across every reset — what the platform has ever spent. */
    readonly lifetimeSpentMicroUsd: number;
    readonly attemptCount: number;
    readonly updatedAt: string;
    readonly enforced: boolean;
  };
  readonly reservations: {
    readonly openCount: number;
    readonly openMicroUsd: number;
    readonly open: readonly {
      readonly reservationId: string;
      readonly reservedMicroUsd: number;
      readonly createdAt: string;
      readonly expiresAt: string;
      readonly owner?: string;
    }[];
    /** Headroom returned by expiry reclamation since the ledger was created. */
    readonly reclaimedMicroUsd: number;
    readonly reclaimedCount: number;
    /** Set when reserved money exists that no live hold accounts for. */
    readonly unattributedSince?: string;
  };
  readonly daily: {
    readonly organizationDailyMicroUsd: number;
    readonly actorDailyMicroUsd: number;
    readonly alertThresholdPercent: number;
    readonly enforce: boolean;
  };
  readonly resets: SpendRecord['resets'];
}

export interface AdminDiagnostics {
  readonly generatedAt: string;
  readonly versions: {
    readonly platformVersion: string;
    readonly contractVersion: string;
    readonly configurationVersion: number;
    readonly prompts: readonly { readonly reference: string; readonly fingerprint: string }[];
  };
  readonly environment: {
    /** Whether the DEPLOYMENT permits real spending. An admin cannot widen it. */
    readonly realRequestsPermittedByEnvironment: boolean;
    /** Whether real requests are actually reachable right now. */
    readonly realRequestsEffective: boolean;
    readonly spendDurable: boolean;
    readonly auditDurable: boolean;
    readonly auditRetentionDays: number;
    readonly redactionEnabled: boolean;
    readonly strictInputGuard: boolean;
    readonly logLevel: string;
    readonly defaultOrganizationId: string;
    readonly allowDefaultOrganization: boolean;
    readonly organizationAllowList: readonly string[];
  };
  readonly circuits: readonly {
    readonly providerId: string;
    readonly state: string;
    readonly consecutiveFailures: number;
    readonly lastFailureAt?: string;
    readonly lastRecoveryAt?: string;
  }[];
  readonly rateLimits: readonly {
    readonly featureId: string;
    readonly perActor: { readonly limit: number; readonly windowMs: number };
    readonly perOrganization: { readonly limit: number; readonly windowMs: number };
    readonly rateLimitCost: number;
  }[];
  readonly retry: AIOperationalSettings['retry'];
  readonly timeout: AIOperationalSettings['timeout'];
  readonly circuitPolicy: {
    readonly failureThreshold: number;
    readonly openMs: number;
    readonly halfOpenSuccessesToClose: number;
  };
}

export interface AdminOverview {
  readonly actor: {
    readonly actorId: string;
    readonly role: AIAdminActor['role'];
    readonly capabilities: readonly AIAdminCapability[];
    readonly organizationScope: readonly string[];
  };
  readonly settings: AIOperationalSettings;
  readonly effective: {
    readonly aiEnabled: boolean;
    readonly realRequestsEnabled: boolean;
    readonly providerPreference: readonly string[];
  };
  readonly health: ReturnType<AIControlPlane['health']>;
  readonly budget: AdminBudgetView;
  readonly usage: UsageReport;
}

// ── Service ─────────────────────────────────────────────────────────────────

export interface AdministrationDependencies {
  readonly plane: AIControlPlane;
  /** The SAME authentication port the AI Guard uses. Never a second one. */
  readonly authenticator: AIAuthenticator;
  readonly settingsStore: AdminSettingsStore;
  /** Durable stores written alongside the in-memory administrative trail. */
  readonly adminAuditStores?: readonly AdminAuditStore[];
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly logger: Logger;
  /** In-memory administrative trail size. */
  readonly auditBufferSize?: number;
  /**
   * Durable provider administration storage (AI-01 Batch 4C).
   *
   * Absent, provider administration is READ-ONLY: providers, credential
   * metadata, models and health are all readable, and every write refuses with
   * a stated reason. Silently accepting a credential into isolate-local memory
   * would be worse than refusing it — an operator would believe the platform
   * was configured until the next isolate recycled.
   */
  readonly providerStore?: ProviderAdministrationStore;
  /**
   * The cipher that seals managed credentials. Defaults to the UNAVAILABLE
   * cipher, which refuses every seal with a precise message. There is no
   * default that stores a secret weakly.
   */
  readonly credentialCipher?: SecretCipher;
  /** The live credential resolver, refreshed after every credential change. */
  readonly credentialResolver?: ProviderCredentialResolver;
  /**
   * Governed worst-case single-request reservation, in micro-USD.
   *
   * Defaults to the deployment's MARQ spend ceiling: a single request must
   * never be able to hold the entire lifetime allowance. See `policy/exposure.ts`.
   */
  readonly reservationCeilingMicroUsd?: number;
  /**
   * The self-hosted provider registrar (AI-01 Batch 4E).
   *
   * The SAME registrar the runtime hydrates from. Absent,
   * `defineSelfHostedProvider` refuses — see its own comment: a stored
   * definition nothing will register is worse than a plain refusal.
   */
  readonly selfHostedProviders?: SelfHostedRegistrar;
  /**
   * The deployment's local-development endpoint exception, passed through to
   * the endpoint policy. Never a request field.
   */
  readonly allowPrivateEndpoints?: boolean;
}

/**
 * The routing view an operator reads (AI-01 Batch 4F).
 *
 * The strategy currently in force, the breadth one request may span, the
 * economics recorded since this isolate started, and the recent decisions
 * behind them. Nothing here is an authority: the numbers are reconciled from
 * the same attempts the spend ledger settled, and reading them changes no
 * execution decision.
 */
export interface AdminRoutingView {
  readonly strategy: RoutingStrategy;
  readonly maxProviders: number;
  readonly failoverEnabled: boolean;
  /** The deployment's own ceiling on the breadth, for the console to show. */
  readonly deploymentMaxProviders: number;
  readonly summary: RoutingSummary;
  readonly recent: readonly RoutingOutcome[];
}

export interface AIAdministration {
  /** Resolve and authorize the caller. Throws `AUTH_REQUIRED` or `FORBIDDEN`. */
  authorize(authorization: string | null, meta?: AdminRequestMeta): Promise<AIAdminActor>;
  /** Load stored settings over the deployment baseline. Idempotent. */
  hydrate(): Promise<AIOperationalSettings>;
  /** Re-read durable settings so the next read answers with what is in force. */
  refresh(): Promise<AIOperationalSettings>;

  overview(actor: AIAdminActor): Promise<AdminOverview>;
  settings(actor: AIAdminActor): Promise<AIOperationalSettings>;
  /**
   * `reason` is `unknown` on purpose across every mutation on this interface.
   * The service is the validator — it rejects a missing or too-short reason and
   * RECORDS that rejection — so a caller that has not checked the field yet is
   * expected, and a caller that pre-validates gains nothing. Typing it `string`
   * would push a cast to every HTTP boundary, which is where a check quietly
   * turns into `String(body.reason)` and an empty reason becomes "undefined".
   */
  updateSettings(
    actor: AIAdminActor,
    patch: AIOperationalSettingsPatch,
    reason: unknown,
    meta?: AdminRequestMeta,
  ): Promise<AIOperationalSettings>;
  setEmergencyStop(
    actor: AIAdminActor,
    engaged: boolean,
    reason: unknown,
    meta?: AdminRequestMeta,
  ): Promise<AIOperationalSettings>;

  providers(actor: AIAdminActor): Promise<readonly AdminProviderView[]>;
  updateProvider(
    actor: AIAdminActor,
    providerId: string,
    patch: { enabled?: boolean; modelAllowList?: readonly string[] | null },
    reason: unknown,
    meta?: AdminRequestMeta,
  ): Promise<readonly AdminProviderView[]>;

  budget(actor: AIAdminActor): Promise<AdminBudgetView>;
  resetSpend(
    actor: AIAdminActor,
    reason: unknown,
    options?: { newCapMicroUsd?: number },
    meta?: AdminRequestMeta,
  ): Promise<AdminBudgetView>;
  increaseSpendCap(
    actor: AIAdminActor,
    capMicroUsd: number,
    reason: unknown,
    meta?: AdminRequestMeta,
  ): Promise<AdminBudgetView>;

  // ── Organization spend administration (4D remediation, HIGH-1) ────────────
  //
  // THREE OPERATIONS THAT NAME A TENANT, AND NONE OF THEM CAN REACH THE
  // PLATFORM SCOPE. Each derives its ledger from `SPEND_SCOPE.organization(id)`
  // after validating the id as a storage key segment, and that format cannot
  // produce `SPEND_SCOPE.platform` — so "an organization operation never alters
  // MARQ's ceiling" is a property of the scope builder rather than of a check
  // somebody remembered.
  //
  // The three above stay hardcoded to the platform scope for the mirror reason:
  // there is no argument by which `resetSpend` can be pointed at a tenant.
  //
  // AUTHORIZATION IS `ai.admin.budget.organization`, WHICH ONLY THE PLATFORM
  // OPERATOR HOLDS. The organization id is a TARGET, not an authority claim:
  // the capability decides whether the actor may administer tenant ledgers at
  // all, and `scopeAllows` then decides whether they may administer THIS one —
  // so a future non-platform holder of the capability is bounded by their own
  // memberships and a forged id buys nothing.
  /** ONE organization's own lifetime ledger. Safe metadata only. */
  organizationBudget(
    actor: AIAdminActor,
    organizationId: string,
  ): Promise<AdminOrganizationBudgetView>;
  /** Clear ONE organization's settled spend and open holds. Never the cap. */
  resetOrganizationSpend(
    actor: AIAdminActor,
    organizationId: string,
    reason: unknown,
    options?: { newCapMicroUsd?: number },
    meta?: AdminRequestMeta,
  ): Promise<AdminOrganizationBudgetView>;
  /** Raise ONE organization's ceiling, preserving its settled spend and holds. */
  increaseOrganizationSpendCap(
    actor: AIAdminActor,
    organizationId: string,
    capMicroUsd: number,
    reason: unknown,
    meta?: AdminRequestMeta,
  ): Promise<AdminOrganizationBudgetView>;

  // ── Provider administration (AI-01 Batch 4C) ──────────────────────────────
  //
  // Delegated to `providerAdministration.ts` rather than implemented here.
  // These operations carry their own capabilities and their own domain rules;
  // what they share with the rest of this service is the audited-mutation
  // runner, and sharing that is the point.
  //
  // NOTE THE ABSENCE. There is no `revealCredential`, no `credentialSecret`,
  // no operation on this interface that returns provider key material. Once
  // submitted, a credential is write-only.
  /** Provider estate, credential metadata, models, health and exposure. */
  providerAdministration(actor: AIAdminActor): Promise<ProviderAdministrationSummary>;
  providerDetail(actor: AIAdminActor, providerId: string): Promise<ProviderAdministrationView>;
  /** Credential METADATA only. Fingerprints and timestamps, never a secret. */
  providerCredentials(
    actor: AIAdminActor,
    providerId: string,
  ): Promise<readonly ProviderCredentialMetadata[]>;
  setProviderEnabled(
    actor: AIAdminActor,
    providerId: string,
    enabled: boolean,
    reason: unknown,
    meta?: AdminRequestMeta,
  ): Promise<ProviderAdministrationView>;
  /** Store or rotate a credential. The plaintext is sealed and forgotten. */
  setProviderCredential(
    actor: AIAdminActor,
    providerId: string,
    input: { secret: unknown; credentialName?: unknown },
    reason: unknown,
    meta?: AdminRequestMeta,
  ): Promise<ProviderAdministrationView>;
  revokeProviderCredential(
    actor: AIAdminActor,
    providerId: string,
    credentialId: string,
    reason: unknown,
    meta?: AdminRequestMeta,
  ): Promise<ProviderAdministrationView>;
  setProviderModelEnabled(
    actor: AIAdminActor,
    providerId: string,
    modelId: string,
    enabled: boolean,
    reason: unknown,
    meta?: AdminRequestMeta,
  ): Promise<ProviderAdministrationView>;
  /**
   * Define a self-hosted, OpenAI-compatible provider (AI-01 Batch 4E).
   *
   * The only governed way an endpoint the runtime dials comes into existence.
   * It takes no secret; a credential for the new provider is stored afterwards
   * through `setProviderCredential`.
   */
  defineSelfHostedProvider(
    actor: AIAdminActor,
    input: SelfHostedProviderInput,
    reason: unknown,
    meta?: AdminRequestMeta,
  ): Promise<ProviderAdministrationView>;
  /**
   * Replace an existing self-hosted provider's stored definition
   * (AI-01 Batch 4E remediation, M-4). Re-validated, re-judged against the
   * exposure ceiling, and reconciled into the runtime without a restart.
   */
  updateSelfHostedProvider(
    actor: AIAdminActor,
    providerId: string,
    input: SelfHostedProviderInput,
    reason: unknown,
    meta?: AdminRequestMeta,
  ): Promise<ProviderAdministrationView>;
  /**
   * Grant or withdraw MARQ's certification of a provider
   * (AI-01 Batch 4E remediation, H-1).
   *
   * The governance decision, and only that: it enables nothing, takes no
   * definition and touches no credential.
   */
  setProviderCertification(
    actor: AIAdminActor,
    providerId: string,
    certification: unknown,
    reason: unknown,
    meta?: AdminRequestMeta,
  ): Promise<ProviderAdministrationView>;

  usage(actor: AIAdminActor): Promise<UsageReport>;
  /** Routing, its economics and the recent decisions behind them (Batch 4F). */
  routing(actor: AIAdminActor, limit?: number): AdminRoutingView;
  diagnostics(actor: AIAdminActor): Promise<AdminDiagnostics>;
  executionAudit(actor: AIAdminActor, limit?: number): readonly AIAuditRecord[];
  adminAudit(actor: AIAdminActor, limit?: number): readonly AdminAuditRecord[];
  /** The administrative trail writer, for callers that must record a denial. */
  readonly trail: AdminAuditWriter;
}

export function createAIAdministration(deps: AdministrationDependencies): AIAdministration {
  const { plane, authenticator, settingsStore, clock, ids, logger } = deps;

  const memoryTrail = createMemoryAdminAuditStore(deps.auditBufferSize ?? 200);
  const trailStore =
    deps.adminAuditStores && deps.adminAuditStores.length > 0
      ? createCompositeAdminAuditStore(memoryTrail, deps.adminAuditStores, (error) =>
          logger.error('ai.admin.audit.durable_write_failed', {
            diagnostics: error instanceof Error ? error.message : String(error),
          }),
        )
      : memoryTrail;
  const trail = createAdminAuditWriter({
    store: trailStore,
    clock,
    newAuditId: () => ids.next('adm'),
  });

  const live = () => plane.settings.current();

  /**
   * A reason, or a rejection.
   *
   * Enforced before authorization is even consulted for the *content* of the
   * change, because "an administrator tried to do something and gave no reason"
   * is itself worth recording — and recording it needs the reason field to have
   * a defined value.
   */
  function requireReason(reason: unknown): string {
    const trimmed = typeof reason === 'string' ? reason.trim() : '';
    if (trimmed.length < MIN_REASON_LENGTH) {
      throw new AIError(
        'VALIDATION_FAILED',
        'A reason is required for every AI administration change.',
        { fields: ['reason'] },
      );
    }
    return trimmed.slice(0, MAX_REASON_LENGTH);
  }

  /**
   * How many times a mutation re-reads and re-applies after losing a race.
   *
   * Four is enough for any realistic number of simultaneous administrators and
   * small enough that a genuinely contended key surfaces as a `CONFLICT` the
   * caller can see rather than as a request that hangs retrying.
   */
  const MAX_COMMIT_ATTEMPTS = 4;

  const envelope = envelopeFrom(plane.config);

  /**
   * Serialise mutations within this isolate.
   *
   * The chain itself moved to `auditedMutation.ts` in Batch 4D so the customer
   * BYOK surface uses the same construction rather than a second copy of it.
   * The reasoning is unchanged and lives there: compare-and-swap already makes
   * a lost update impossible ACROSS isolates; within one, two administrators
   * can still interleave between a durable read and a durable write, and two
   * saves could land out of order.
   *
   * THIS SURFACE'S OWN CHAIN, not a shared one. A customer rotating their own
   * vendor key has no business queueing behind a platform settings write, and
   * the two touch disjoint rows.
   */
  const withMutationLock = createMutationChain();

  /**
   * The durable record, or `undefined` when there is none.
   *
   * Normalisation lives in the store's `load()` — the one canonical read path —
   * so this layer and the control plane's live refresh cannot disagree about
   * what a stored record means.
   */
  function loadDurable(): Promise<AIOperationalSettings | undefined> {
    return settingsStore.load();
  }

  /**
   * PERSIST, THEN APPLY.
   *
   * The previous implementation mutated the live overlay first and wrote
   * afterwards, so a failed write left the plane running a change the operator
   * had been told had failed — including, in the worst direction, a released
   * kill switch. The order below is the whole fix, and the shape of `build`
   * exists to support it: a change is a FUNCTION of the current settings rather
   * than a finished record, so it can be re-applied to a newer base when a
   * concurrent write moves the ground.
   *
   *   1. read the authoritative record from durable storage
   *   2. catch this isolate up to it
   *   3. build the change on top of it and narrow it to the deployment envelope
   *   4. write it under compare-and-swap
   *   5. only now adopt it locally and project it onto the registry
   *
   * A failure at step 4 leaves steps 5 undone and the plane exactly where it
   * was. A conflict at step 4 goes back to step 1, which is what turns two
   * administrators racing into two changes that both survive.
   */
  async function commit(
    build: (current: AIOperationalSettings) => AIOperationalSettings,
    actorId: string,
    reason: string,
  ): Promise<AIOperationalSettings> {
    let lastConflict: AIError | undefined;

    for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt += 1) {
      const durable = await loadDurable();
      const expectedVersion = durable?.configurationVersion ?? NO_STORED_VERSION;

      // Catch up before building. Without this a change would be applied on top
      // of a local copy that another isolate has already superseded, and the
      // fields the caller did not touch would be silently rolled back.
      if (durable && durable.configurationVersion > plane.settings.current().configurationVersion) {
        plane.settings.adopt(durable);
        plane.applySettings();
      }

      const base = durable ?? plane.settings.current();
      // Strictly greater than both what is stored and what this isolate holds,
      // so a version never repeats and never moves backwards.
      const nextVersion =
        Math.max(expectedVersion, plane.settings.current().configurationVersion) + 1;

      const next = applyEnvelope(
        {
          ...build(base),
          configurationVersion: nextVersion,
          updatedAt: clock.isoNow(),
          updatedBy: actorId,
          updatedReason: reason,
        },
        envelope,
      );

      try {
        await settingsStore.save(next, expectedVersion);
      } catch (error) {
        if (error instanceof AIError && error.code === 'CONFLICT') {
          lastConflict = error;
          logger.warn('ai.admin.settings.conflict_retry', {
            attempt,
            expectedVersion,
            actorId,
          });
          continue;
        }
        logger.error('ai.admin.settings.persist_failed', {
          configurationVersion: nextVersion,
          diagnostics: error instanceof Error ? error.message : String(error),
        });
        throw new AIError('INTERNAL_ERROR', 'The AI settings change could not be saved.', {
          diagnostics: error instanceof Error ? error.message : String(error),
          cause: error,
        });
      }

      plane.settings.adopt(next);
      plane.applySettings();
      return plane.settings.current();
    }

    throw (
      lastConflict ??
      new AIError('CONFLICT', 'The AI settings changed while this update was being prepared.')
    );
  }

  /**
   * The single door every mutation goes through.
   *
   * Capability, then reason, then the change, then persistence, then the audit
   * record. A failure at any step is recorded as `rejected` with the code that
   * caused it, so the trail shows attempts as well as successes.
   */
  const runAuditedMutation = createAuditedMutationRunner({
    trail,
    logger,
    lock: withMutationLock,
    requireReason,
  });

  /**
   * The single door every mutation goes through.
   *
   * Capability, then reason, then the change, then persistence, then the audit
   * record. A failure at any step is recorded as `rejected` with the code that
   * caused it, so the trail shows attempts as well as successes.
   *
   * The DISCIPLINE lives in `auditedMutation.ts` (Batch 4D) and is shared with
   * the customer BYOK surface. What stays here is the only part that is this
   * surface's own: which capabilities a change demands, and in whose
   * vocabulary.
   */
  function mutate<T>(
    actor: AIAdminActor,
    options: {
      /**
       * EVERY capability this change implies, not just the endpoint's headline
       * one. A patch that moves a retry curve and a spending ceiling in one
       * call needs both grants, or the permissive field becomes the route
       * around the restricted one.
       */
      capabilities: readonly AIAdminCapability[];
      action: AdminAction;
      reason: unknown;
      target?: string;
      meta?: AdminRequestMeta;
      before: () => Promise<Readonly<Record<string, unknown>>>;
      run: (reason: string) => Promise<{
        after: Readonly<Record<string, unknown>>;
        result: T;
        configurationVersion?: number;
        action?: AdminAction;
      }>;
    },
  ): Promise<T> {
    return runAuditedMutation(
      {
        actorId: actor.actorId,
        email: actor.email,
        actorRole: actor.role,
        organizationScope: actor.organizationScope,
      },
      {
        action: options.action,
        reason: options.reason,
        target: options.target,
        meta: options.meta,
        // THIS SURFACE'S authority, in this surface's vocabulary. The runner
        // never sees an `AIAdminCapability` and cannot be handed one from
        // another surface's capability set.
        authorize: () => {
          for (const capability of options.capabilities) requireCapability(actor, capability);
        },
        before: options.before,
        run: options.run,
      },
    );
  }

  /**
   * The capabilities a settings patch demands, derived from the FIELDS it
   * touches rather than from the endpoint it arrived at. One endpoint that can
   * change anything is one endpoint whose least-privileged caller can change
   * everything.
   */
  function capabilitiesForPatch(patch: AIOperationalSettingsPatch): readonly AIAdminCapability[] {
    const required = new Set<AIAdminCapability>();
    if (patch.aiEnabled !== undefined || patch.realRequestsEnabled !== undefined) {
      required.add('ai.admin.killswitch');
    }
    if (patch.budget !== undefined) required.add('ai.admin.budget.write');
    if (
      patch.defaultProviderId !== undefined ||
      patch.defaultModelId !== undefined ||
      patch.fallbackProviderId !== undefined ||
      patch.providerPreference !== undefined ||
      patch.requireCertifiedProviders !== undefined
    ) {
      required.add('ai.admin.provider.write');
    }
    // Agent and tool certification are platform-wide execution controls, not
    // provider configuration, so they demand the settings grant rather than the
    // provider one. Kept separate from the provider check above so a future
    // per-population grant has an obvious place to attach.
    if (
      patch.requireCertifiedAgents !== undefined ||
      patch.requireCertifiedTools !== undefined
    ) {
      required.add('ai.admin.settings.write');
    }
    if (
      patch.retry !== undefined ||
      patch.timeout !== undefined ||
      patch.failoverEnabled !== undefined
    ) {
      required.add('ai.admin.settings.write');
    }
    // ── ROUTING SPLITS ACROSS TWO GRANTS (AI-01 Batch 4F) ──────────────────
    //
    // The two fields are different decisions and demand different authority.
    //
    //   `strategy` decides WHICH provider serves — the same class of decision
    //   as the preference order and the pinned default beside it, so it demands
    //   the provider grant.
    //
    //   `maxProviders` bounds how far one request may fail over, which is a
    //   spend and latency bound of exactly the kind `failoverEnabled` is, so it
    //   demands the settings grant.
    //
    // A caller who sends both needs both. Deriving the requirement from the
    // fields rather than from the group is the rule this function already
    // follows, and it is what keeps a routing patch from becoming a way to
    // steer providers with only the settings grant.
    if (patch.routing?.strategy !== undefined) required.add('ai.admin.provider.write');
    if (patch.routing?.maxProviders !== undefined) required.add('ai.admin.settings.write');
    // An empty patch still demands a grant. Without this, a caller with no
    // write capability at all could reach the mutation path, be audited as
    // "applied", and bump the configuration version with nothing in it.
    if (required.size === 0) required.add('ai.admin.settings.write');
    return [...required];
  }

  /** Read-side capability gate. Reads are not audited — they are not changes. */
  function read(actor: AIAdminActor, capability: AIAdminCapability): void {
    requireCapability(actor, capability);
  }

  // ── Views ─────────────────────────────────────────────────────────────────

  function providerViews(): readonly AdminProviderView[] {
    const settings = live();
    const preference = effectivePreference(settings);
    // Eligibility comes from the health snapshot rather than a second probe, so
    // the reason shown in the console is by construction the same reason the
    // health endpoint reports — two probes would eventually disagree.
    const selection = plane.health().selection;

    return plane.providers.list().map((provider) => {
      const { providerId } = provider.descriptor;
      const setting = settings.providers[providerId];
      const allowList = setting?.modelAllowList ?? [];
      const permitted = plane.providers.models(providerId).map((model) => model.modelId);

      return {
        providerId,
        displayName: provider.descriptor.displayName,
        priority: provider.descriptor.priority,
        productionReady: provider.descriptor.productionReady,
        billable: provider.descriptor.billable,
        enabled: provider.enabled,
        health: plane.providers.health(providerId),
        selectionReason: selection[providerId] ?? 'not evaluated',
        preferenceIndex: preference.indexOf(providerId),
        isDefault: settings.defaultProviderId === providerId,
        isFallback: settings.fallbackProviderId === providerId,
        modelAllowList: allowList,
        models: provider.descriptor.models.map((model) => ({
          modelId: model.modelId,
          permitted: permitted.includes(model.modelId),
          isPinnedDefault: settings.defaultModelId === model.modelId,
          promptMicroUsdPer1k: model.promptMicroUsdPer1k,
          completionMicroUsdPer1k: model.completionMicroUsdPer1k,
          capabilities: model.capabilities,
        })),
      };
    });
  }

  function budgetView(record: SpendRecord): AdminBudgetView {
    const settings = live();
    // Money cleared by past resets plus what is settled now. Without this, an
    // authorised reset would make the platform's spend history look like it
    // never happened — which is exactly what an auditor is checking for.
    const clearedByResets = record.resets.reduce((total, reset) => total + reset.clearedMicroUsd, 0);

    return {
      platform: {
        capMicroUsd: record.capMicroUsd,
        spentMicroUsd: record.spentMicroUsd,
        reservedMicroUsd: record.reservedMicroUsd,
        remainingMicroUsd: remainingMicroUsd(record),
        lifetimeSpentMicroUsd: clearedByResets + record.spentMicroUsd,
        attemptCount: record.attemptCount,
        updatedAt: record.updatedAt,
        enforced: plane.config.spend.enforce,
      },
      reservations: {
        openCount: record.openReservations.length,
        openMicroUsd: record.openReservations.reduce(
          (total, hold) => total + hold.reservedMicroUsd,
          0,
        ),
        open: record.openReservations.map((hold) => ({
          reservationId: hold.reservationId,
          reservedMicroUsd: hold.reservedMicroUsd,
          createdAt: hold.createdAt,
          expiresAt: hold.expiresAt,
          owner: hold.owner,
        })),
        reclaimedMicroUsd: record.reclaimedMicroUsd,
        reclaimedCount: record.reclaimedCount,
        unattributedSince: record.unattributedSince,
      },
      daily: { ...settings.budget },
      resets: record.resets,
    };
  }

  /**
   * The organization this operation may act on, or a refusal.
   *
   * TWO GATES, IN THIS ORDER, AND BOTH ARE NECESSARY.
   *
   *   THE CAPABILITY decides whether this actor administers tenant ledgers at
   *   all. Only the platform operator holds `ai.admin.budget.organization`, and
   *   holding it is not implied by holding MARQ's own budget grant — the two
   *   are separate entries in the grant table precisely so neither widens into
   *   the other.
   *
   *   THE SCOPE decides WHICH tenant. A super admin's `organizationScope` is
   *   deliberately empty, meaning unrestricted; `scopeAllows` returns true only
   *   for them. Anyone else — a future holder of this capability at a narrower
   *   tier — is bounded by the organizations they actually hold a membership
   *   in, so a forged or guessed id buys nothing.
   *
   * The id is then validated as a storage key segment BEFORE it becomes one.
   * `isolationKeyFor` throws on an id carrying the `:` the scope format joins
   * on, which is the correct direction: an id that cannot be safely addressed
   * must be refused rather than quietly addressing somewhere else.
   */
  function organizationTarget(actor: AIAdminActor, organizationId: unknown): string {
    requireCapability(actor, 'ai.admin.budget.organization');
    const id = typeof organizationId === 'string' ? organizationId.trim() : '';
    if (id === '') {
      throw new AIError('VALIDATION_FAILED', 'An organization id is required.', {
        fields: ['organizationId'],
      });
    }
    // Format first, so a malformed id is a validation error rather than a
    // FORBIDDEN that would tell a caller their id was well-formed but not
    // theirs.
    isolationKeyFor(id);
    if (!scopeAllows(actor, id)) {
      throw new AIError(
        'FORBIDDEN',
        'Your administrative role does not permit this action for that organization.',
        { diagnostics: `actor=${actor.actorId} role=${actor.role} organization=${id}` },
      );
    }
    return id;
  }

  /**
   * ONE organization's ledger, as this surface is allowed to report it.
   *
   * Built from the record and NOTHING else — no provider lookup, no credential
   * resolver, no configuration read — so there is no path by which credential
   * material could reach this view even if a future field were added to the
   * record.
   */
  function organizationBudgetView(
    organizationId: string,
    record: SpendRecord,
  ): AdminOrganizationBudgetView {
    const clearedByResets = record.resets.reduce((total, reset) => total + reset.clearedMicroUsd, 0);
    return {
      organizationId,
      scope: record.scope,
      capMicroUsd: record.capMicroUsd,
      unbounded: isUnboundedSpendCap(record.capMicroUsd),
      spentMicroUsd: record.spentMicroUsd,
      reservedMicroUsd: record.reservedMicroUsd,
      remainingMicroUsd: remainingMicroUsd(record),
      lifetimeSpentMicroUsd: clearedByResets + record.spentMicroUsd,
      attemptCount: record.attemptCount,
      openReservationCount: record.openReservations.length,
      updatedAt: record.updatedAt,
      // The same switch that governs MARQ's ceiling governs a tenant's: a
      // deployment recording spend without refusing does so for both, and a
      // console that claimed otherwise would be describing enforcement that is
      // not happening.
      enforced: plane.config.spend.enforce,
      changes: record.resets,
    };
  }

  /**
   * The Batch 4C provider administration surface.
   *
   * Assembled HERE, over the same `mutate`, the same trail, the same actor and
   * the same plane. A separately-constructed provider administration service
   * would have its own audit writer and its own capability check — a second
   * implementation of two guarantees, which is zero implementations of them.
   */
  const providers = createProviderAdministration({
    plane,
    mutate,
    commitSettings: commit,
    liveSettings: live,
    store: deps.providerStore,
    // The unavailable cipher is the default, and it REFUSES rather than
    // degrades. A deployment with no root key can read the whole provider
    // surface and cannot store a credential.
    cipher: deps.credentialCipher ?? unavailableSecretCipher(),
    credentials: deps.credentialResolver,
    reservationCeilingMicroUsd:
      deps.reservationCeilingMicroUsd ?? plane.config.spend.maxPlatformMicroUsd,
    // AI-01 Batch 4E. Absent, the self-hosted definition operation refuses; it
    // never degrades into "stored but never registered".
    selfHosted: deps.selfHostedProviders,
    allowPrivateEndpoints: deps.allowPrivateEndpoints,
    clock,
    ids,
    logger,
  });

  return {
    trail,

    async authorize(authorization, meta) {
      // Always authoritative. Every decision this surface makes is a privileged
      // one, and an administrator whose organization membership was revoked in
      // another isolate must not be admitted here from a cached snapshot (M-A).
      const subject = await authenticator.authenticate(authorization, { privileged: true });
      try {
        return resolveAdminActor(subject);
      } catch (error) {
        // A refused administrative access attempt is a security event, and it
        // is recorded whether or not the caller ever had a role. This is the
        // one place the trail records an actor it could not resolve.
        const aiError = error instanceof AIError ? error : undefined;
        trail.record({
          action: ADMIN_ACTION.accessDenied,
          outcome: 'rejected',
          actorId: subject?.subjectId ?? 'unauthenticated',
          actorEmail: subject?.email,
          actorRole: 'unauthorized',
          reason: 'administration access refused',
          rejectionCode: aiError?.code ?? 'FORBIDDEN',
          correlationId: meta?.correlationId,
          clientIp: meta?.clientIp,
        });
        throw error;
      }
    },

    async hydrate() {
      let loaded: AIOperationalSettings | undefined;
      try {
        loaded = await settingsStore.load();
      } catch (error) {
        // Storage being unavailable must not stop the plane from serving. It
        // runs on the deployment baseline, which is the safe posture by
        // construction, and the failure is loud.
        logger.error('ai.admin.settings.load_failed', {
          diagnostics: error instanceof Error ? error.message : String(error),
        });
        return live();
      }
      if (loaded === undefined) return live();

      plane.settings.adopt(loaded);
      plane.applySettings();
      logger.info('ai.admin.settings.hydrated', {
        configurationVersion: loaded.configurationVersion,
        aiEnabled: loaded.aiEnabled,
        emergencyStop: loaded.emergencyStop.engaged,
      });
      return live();
    },

    /**
     * Bring this isolate up to date before answering a read.
     *
     * Reads used to be served straight from the isolate's cached overlay, so an
     * operator whose console request happened to land on an isolate that had
     * not served traffic since the change saw the configuration as it was
     * before it — including an emergency stop reported as disengaged while the
     * platform was in fact halted. For the console of a kill switch that is the
     * wrong answer to give during exactly the incident it exists for.
     *
     * Delegates to the plane's own refresh rather than re-reading here: one
     * refresh path, shared with the execution path, so a console read and an AI
     * request can never disagree about what is in force.
     */
    async refresh() {
      await plane.refreshSettings();
      return live();
    },

    async settings(actor) {
      read(actor, 'ai.admin.view');
      await plane.refreshSettings();
      return live();
    },

    async overview(actor) {
      read(actor, 'ai.admin.view');
      await plane.refreshSettings();
      const settings = live();
      const spend = await plane.spendStatus();
      return {
        actor: {
          actorId: actor.actorId,
          role: actor.role,
          capabilities: actor.capabilities,
          organizationScope: actor.organizationScope,
        },
        settings,
        effective: {
          aiEnabled: aiExecutionPermitted(settings),
          realRequestsEnabled: effectiveRealRequestsEnabled(
            settings,
            plane.config.allowRealRequests,
          ),
          providerPreference: effectivePreference(settings),
        },
        health: plane.health(),
        budget: budgetView(spend),
        usage: buildUsageReport({
          metrics: plane.metrics(),
          settledMicroUsd: spend.spentMicroUsd,
          generatedAt: clock.isoNow(),
        }),
      };
    },

    updateSettings(actor, patch, reason, meta) {
      return mutate(actor, {
        capabilities: capabilitiesForPatch(patch),
        action: patch.budget !== undefined ? ADMIN_ACTION.budgetUpdated : ADMIN_ACTION.settingsUpdated,
        reason,
        meta,
        before: () => Promise.resolve(settingsFacts(live())),
        run: async (auditReason) => {
          const current = live();
          // The patch is re-applied to whatever base `commit` reads, so a
          // concurrent change from another isolate is merged rather than lost.
          const applied = await commit(
            (base) => normalizeOperationalSettings(base, patch),
            actor.actorId,
            auditReason,
          );
          return {
            after: settingsFacts(applied),
            result: applied,
            configurationVersion: applied.configurationVersion,
            action: resolveSettingsAction(current, applied),
          };
        },
      });
    },

    setEmergencyStop(actor, engaged, reason, meta) {
      return mutate(actor, {
        capabilities: ['ai.admin.killswitch'],
        action: engaged ? ADMIN_ACTION.emergencyStopEngaged : ADMIN_ACTION.emergencyStopReleased,
        reason,
        meta,
        before: () => Promise.resolve(settingsFacts(live())),
        run: async (auditReason) => {
          const applied = await commit(
            (base) => ({
              ...base,
              // Engaging the stop does NOT clear `aiEnabled` or
              // `realRequestsEnabled`. The stop is an overlay on top of them, so
              // releasing it restores exactly the posture the platform had before
              // the incident rather than an ambiguous one an operator has to
              // reconstruct from memory.
              emergencyStop: engaged
                ? {
                    engaged: true,
                    reason: auditReason,
                    engagedBy: actor.actorId,
                    engagedAt: clock.isoNow(),
                  }
                : { engaged: false },
            }),
            actor.actorId,
            auditReason,
          );
          return {
            after: settingsFacts(applied),
            result: applied,
            configurationVersion: applied.configurationVersion,
          };
        },
      });
    },

    async providers(actor) {
      read(actor, 'ai.admin.view');
      await plane.refreshSettings();
      return providerViews();
    },

    // ── Provider administration (AI-01 Batch 4C) ────────────────────────────
    //
    // Thin delegation, deliberately. Every rule these operations enforce lives
    // in `providerAdministration.ts`; putting a second capability check or a
    // second validation here would create the drift this file's own comment
    // warns about.
    providerAdministration: (actor) => providers.list(actor),
    providerDetail: (actor, providerId) => providers.get(actor, providerId),
    providerCredentials: (actor, providerId) => providers.credentials(actor, providerId),
    setProviderEnabled: (actor, providerId, enabled, reason, meta) =>
      providers.setProviderEnabled(actor, providerId, enabled, reason, meta),
    setProviderCredential: (actor, providerId, input, reason, meta) =>
      providers.setCredential(actor, providerId, input, reason, meta),
    revokeProviderCredential: (actor, providerId, credentialId, reason, meta) =>
      providers.revokeCredential(actor, providerId, credentialId, reason, meta),
    setProviderModelEnabled: (actor, providerId, modelId, enabled, reason, meta) =>
      providers.setModelEnabled(actor, providerId, modelId, enabled, reason, meta),
    defineSelfHostedProvider: (actor, input, reason, meta) =>
      providers.defineSelfHostedProvider(actor, input, reason, meta),
    updateSelfHostedProvider: (actor, providerId, input, reason, meta) =>
      providers.updateSelfHostedProvider(actor, providerId, input, reason, meta),
    setProviderCertification: (actor, providerId, certification, reason, meta) =>
      providers.setProviderCertification(actor, providerId, certification, reason, meta),

    updateProvider(actor, providerId, patch, reason, meta) {
      return mutate(actor, {
        capabilities: ['ai.admin.provider.write'],
        action: ADMIN_ACTION.providerUpdated,
        target: providerId,
        reason,
        meta,
        before: () => Promise.resolve(providerFacts(providerId, live())),
        run: async (auditReason) => {
          // The registry, not the settings blob, decides whether a provider
          // exists. An administrator cannot create one by naming it, and a
          // typo produces a clear rejection rather than a stored setting that
          // silently does nothing.
          const registered = plane.providers.find(providerId);
          if (!registered) {
            throw new AIError('PROVIDER_NOT_FOUND', 'That AI provider is not registered.', {
              diagnostics: `providerId=${providerId}`,
            });
          }

          const current = live();
          const nextSetting = normalizeProviderSetting(current.providers[providerId], patch);

          // A model allow list is a NARROWING, and a narrowing that names
          // nothing the adapter serves is rejected here rather than ignored
          // downstream. The registry used to fall back to the full catalogue in
          // that case, so an operator who restricted a provider to one model
          // silently got every model — the opposite of what they asked for, with
          // the console reporting success. Validating against the adapter's own
          // descriptor is the only place that has the facts to catch it.
          if (nextSetting.modelAllowList.length > 0) {
            const declared = new Set(registered.descriptor.models.map((model) => model.modelId));
            const unknown = nextSetting.modelAllowList.filter((modelId) => !declared.has(modelId));
            if (unknown.length > 0) {
              throw new AIError(
                'VALIDATION_FAILED',
                `This provider does not serve: ${unknown.join(', ')}.`,
                {
                  fields: ['modelAllowList'],
                  diagnostics:
                    `providerId=${providerId} unknown=${unknown.join(',')} ` +
                    `declared=${[...declared].join(',')}`,
                },
              );
            }
          }

          const applied = await commit(
            (base) => ({
              ...base,
              providers: { ...base.providers, [providerId]: nextSetting },
            }),
            actor.actorId,
            auditReason,
          );

          const wasEnabled = current.providers[providerId]?.enabled ?? registered.enabled;
          return {
            after: providerFacts(providerId, applied),
            result: providerViews(),
            configurationVersion: applied.configurationVersion,
            action:
              nextSetting.enabled === wasEnabled
                ? ADMIN_ACTION.providerUpdated
                : nextSetting.enabled
                  ? ADMIN_ACTION.providerEnabled
                  : ADMIN_ACTION.providerDisabled,
          };
        },
      });
    },

    async budget(actor) {
      read(actor, 'ai.admin.view');
      await plane.refreshSettings();
      return budgetView(await plane.spendStatus());
    },

    resetSpend(actor, reason, options, meta) {
      return mutate(actor, {
        capabilities: ['ai.admin.budget.reset'],
        action: ADMIN_ACTION.spendReset,
        target: SPEND_SCOPE.platform,
        reason,
        meta,
        before: async () => spendFacts(await plane.spendStatus()),
        run: async (auditReason) => {
          // A reset CLEARS SPEND. It does not move the ceiling.
          //
          // Accepting a new cap here let one call both wipe the spend history
          // and raise the ceiling — a thousandfold, in the review that found it
          // — while the trail recorded only `spend.reset`. Two decisions with
          // different blast radii must not share one audit action, so the field
          // is refused rather than quietly ignored: a caller that sends it gets
          // told which operation they actually wanted.
          if (options?.newCapMicroUsd !== undefined) {
            throw new AIError(
              'VALIDATION_FAILED',
              'A reset cannot change the spending ceiling. Use the increase operation.',
              { fields: ['newCapMicroUsd'] },
            );
          }

          // Delegated to the Batch 1 ledger, which is the only thing that may
          // clear spend and which already demands an authorising actor and a
          // reason. This layer supplies them; it does not reimplement the reset.
          const after = await plane.spendLedger.reset(SPEND_SCOPE.platform, {
            authorizedBy: actor.actorId,
            reason: auditReason,
          });
          return { after: spendFacts(after), result: budgetView(after) };
        },
      });
    },

    increaseSpendCap(actor, capMicroUsd, reason, meta) {
      return mutate(actor, {
        capabilities: ['ai.admin.budget.reset'],
        action: ADMIN_ACTION.spendCapRaised,
        target: SPEND_SCOPE.platform,
        reason,
        meta,
        before: async () => spendFacts(await plane.spendStatus()),
        run: async (auditReason) => {
          const before = await plane.spendStatus();
          const cap = clampCap(capMicroUsd, before.capMicroUsd);
          if (cap <= before.capMicroUsd) {
            // Lowering the ceiling through the "increase" operation would be a
            // surprising way to disable AI. Lowering is a deployment change to
            // `AI_MAX_SPEND_USD`, which the ledger already honours on the next
            // read and which leaves a record outside the console.
            throw new AIError(
              'VALIDATION_FAILED',
              'The new AI spending cap must be higher than the current one.',
              {
                fields: ['capMicroUsd'],
                diagnostics: `requested=${cap} current=${before.capMicroUsd}`,
              },
            );
          }

          // The ledger's own cap-raise: settled spend and every open hold are
          // preserved. Raising a ceiling is not forgiving what was spent under
          // it, and using `reset` here — the only cap-changing operation Batch 1
          // had — would have destroyed the spend history to grant more headroom.
          const after = await plane.spendLedger.raiseCap(SPEND_SCOPE.platform, {
            authorizedBy: actor.actorId,
            reason: auditReason,
            newCapMicroUsd: cap,
          });
          return { after: spendFacts(after), result: budgetView(after) };
        },
      });
    },

    async organizationBudget(actor, organizationId) {
      // A READ, and reads on this surface are capability-gated and not audited.
      // The capability check lives in `organizationTarget` with the scope check,
      // so the two can never be applied separately.
      const id = organizationTarget(actor, organizationId);
      return organizationBudgetView(id, await plane.organizationSpendStatus(id));
    },

    // `async`, so a refusal from `organizationTarget` is a REJECTED PROMISE
    // rather than a synchronous throw. These methods are declared as returning
    // a promise, and a caller that reasonably writes
    // `admin.resetOrganizationSpend(...).catch(...)` would never see a
    // synchronously thrown refusal — it would escape as an unhandled exception
    // past the handler written to contain it. The customer BYOK service makes
    // the same correction for the same reason.
    async resetOrganizationSpend(actor, organizationId, reason, options, meta) {
      // RESOLVED BEFORE THE MUTATION RUNNER IS ENTERED, so an unauthorised
      // attempt is refused before it can write a record naming a tenant the
      // caller may not administer.
      const id = organizationTarget(actor, organizationId);
      return await mutate(actor, {
        // Named again here rather than left to `organizationTarget`. The
        // runner's own `authorize` hook is what an auditor reads to see which
        // grant a recorded change demanded, and a capability enforced only in a
        // helper would leave that record silent about it.
        capabilities: ['ai.admin.budget.organization'],
        action: ADMIN_ACTION.organizationSpendReset,
        target: SPEND_SCOPE.organization(id),
        reason,
        meta,
        before: async () => spendFacts(await plane.organizationSpendStatus(id)),
        run: async (auditReason) => {
          // The same refusal the platform reset makes, for the same reason: a
          // reset CLEARS SPEND and does not move the ceiling. Accepting a cap
          // here would let one call wipe the history and raise the ledger while
          // the trail recorded only a reset.
          if (options?.newCapMicroUsd !== undefined) {
            throw new AIError(
              'VALIDATION_FAILED',
              'A reset cannot change the spending ceiling. Use the increase operation.',
              { fields: ['newCapMicroUsd'] },
            );
          }
          const after = await plane.spendLedger.reset(SPEND_SCOPE.organization(id), {
            authorizedBy: actor.actorId,
            reason: auditReason,
          });
          return { after: spendFacts(after), result: organizationBudgetView(id, after) };
        },
      });
    },

    async increaseOrganizationSpendCap(actor, organizationId, capMicroUsd, reason, meta) {
      const id = organizationTarget(actor, organizationId);
      return await mutate(actor, {
        capabilities: ['ai.admin.budget.organization'],
        action: ADMIN_ACTION.organizationSpendCapRaised,
        target: SPEND_SCOPE.organization(id),
        reason,
        meta,
        before: async () => spendFacts(await plane.organizationSpendStatus(id)),
        run: async (auditReason) => {
          const before = await plane.organizationSpendStatus(id);
          // AN UNBOUNDED CEILING CANNOT BE RAISED, AND SAYING SO IS BETTER THAN
          // SUCCEEDING AT NOTHING. The governed default is unbounded, so the
          // likely caller here is an operator who believes a customer is capped
          // and is about to walk away thinking they fixed it. Lowering is a
          // deployment change to `AI_ORG_MAX_SPEND_USD`, exactly as it is for
          // MARQ's own ceiling — the ledger re-stamps the configured cap on the
          // next load — so the message names that rather than implying there is
          // no way to bound the tenant at all.
          if (isUnboundedSpendCap(before.capMicroUsd)) {
            throw new AIError(
              'VALIDATION_FAILED',
              'This organization has no lifetime AI spending ceiling, so there is nothing to ' +
                'raise. Set AI_ORG_MAX_SPEND_USD to introduce one.',
              { fields: ['capMicroUsd'], diagnostics: `scope=${before.scope} cap=unbounded` },
            );
          }
          const cap = clampCap(capMicroUsd, before.capMicroUsd);
          if (cap <= before.capMicroUsd) {
            throw new AIError(
              'VALIDATION_FAILED',
              'The new AI spending cap must be higher than the current one.',
              {
                fields: ['capMicroUsd'],
                diagnostics: `requested=${cap} current=${before.capMicroUsd}`,
              },
            );
          }
          // The ledger's cap-raise: settled spend and every open hold survive.
          // Reservation and settlement invariants are the ledger's, unchanged —
          // this operation moves a number and touches no hold.
          const after = await plane.spendLedger.raiseCap(SPEND_SCOPE.organization(id), {
            authorizedBy: actor.actorId,
            reason: auditReason,
            newCapMicroUsd: cap,
          });
          return { after: spendFacts(after), result: organizationBudgetView(id, after) };
        },
      });
    },

    async usage(actor) {
      read(actor, 'ai.admin.view');
      const spend = await plane.spendStatus();
      return buildUsageReport({
        metrics: plane.metrics(),
        settledMicroUsd: spend.spentMicroUsd,
        generatedAt: clock.isoNow(),
      });
    },

    async diagnostics(actor) {
      read(actor, 'ai.admin.view');
      await plane.refreshSettings();
      const settings = live();
      const health = plane.health();
      return {
        generatedAt: clock.isoNow(),
        versions: {
          platformVersion: PLATFORM_VERSION,
          contractVersion: CONTRACT_VERSION,
          configurationVersion: settings.configurationVersion,
          prompts: plane.prompts.list().map((prompt) => ({
            reference: prompt.reference,
            fingerprint: prompt.fingerprint,
          })),
        },
        environment: {
          realRequestsPermittedByEnvironment: plane.config.allowRealRequests,
          realRequestsEffective: effectiveRealRequestsEnabled(
            settings,
            plane.config.allowRealRequests,
          ),
          spendDurable: plane.config.spend.durable,
          auditDurable: plane.config.audit.durable,
          auditRetentionDays: plane.config.audit.retentionDays,
          redactionEnabled: plane.config.governance.redactionEnabled,
          strictInputGuard: plane.config.governance.strictInputGuard,
          logLevel: plane.config.observability.logLevel,
          defaultOrganizationId: plane.config.defaultOrganizationId,
          allowDefaultOrganization: plane.config.allowDefaultOrganization,
          organizationAllowList: plane.config.organizationAllowList,
        },
        circuits: health.providers.map((provider) => ({
          providerId: provider.providerId,
          state: provider.circuit,
          consecutiveFailures: provider.consecutiveFailures,
          lastFailureAt: provider.lastFailureAt,
          lastRecoveryAt: provider.lastRecoveryAt,
        })),
        rateLimits: plane.catalog.list().map((descriptor) => ({
          featureId: descriptor.featureId,
          perActor: descriptor.limits.perActor,
          perOrganization: descriptor.limits.perOrganization,
          rateLimitCost: descriptor.limits.rateLimitCost ?? 1,
        })),
        retry: settings.retry,
        timeout: settings.timeout,
        circuitPolicy: plane.config.circuit,
      };
    },

    routing(actor, limit = 50) {
      read(actor, 'ai.admin.view');
      const settings = live();
      const bounded = Math.min(Math.max(Math.trunc(limit) || 50, 1), 200);
      // Read wide, scope, then truncate — the same order `executionAudit` uses,
      // so a narrow-scoped administrator does not silently get fewer records
      // than they asked for whenever another tenant is busy.
      const records = plane.routing.recent(200);
      return {
        strategy: settings.routing.strategy,
        maxProviders: settings.routing.maxProviders,
        failoverEnabled: settings.failoverEnabled,
        deploymentMaxProviders: plane.config.routing.maxProviders,
        // The SUMMARY IS PLATFORM-WIDE AND STAYS THAT WAY. It carries no
        // organization id, so there is nothing to scope it by, and a
        // per-tenant re-aggregation would be a second set of numbers that
        // could disagree with the spend ledger. Only the platform operator
        // reaches it — `ai.admin.view` above, and the grant table gives the
        // organization tier viewer capabilities scoped to its own records.
        summary: plane.routing.summary(),
        recent: scopeRecords(actor, records, (record) => record.organizationId).slice(0, bounded),
      };
    },

    executionAudit(actor, limit = 50) {
      read(actor, 'ai.admin.audit.read');
      const bounded = Math.min(Math.max(Math.trunc(limit) || 50, 1), 200);
      // Scoped BEFORE truncation would give a narrow-scoped admin fewer records
      // than they asked for whenever another tenant is busy. Read wide, filter,
      // then truncate — the buffer is bounded either way.
      const records = plane.recentAudit(200);
      return scopeRecords(actor, records, (record) => record.organizationId).slice(0, bounded);
    },

    adminAudit(actor, limit = 50) {
      read(actor, 'ai.admin.audit.read');
      const bounded = Math.min(Math.max(Math.trunc(limit) || 50, 1), 200);
      const records = trail.recent(200);
      if (actor.role === 'super_admin') return records.slice(0, bounded);
      // Administrative changes are platform-wide, so there is no organization
      // to scope them by. A non-platform administrator sees the changes they
      // themselves made — enough to review their own actions, not enough to
      // enumerate what other administrators are doing.
      return records.filter((record) => record.actorId === actor.actorId).slice(0, bounded);
    },
  };
}

// ── Audit fact extraction ───────────────────────────────────────────────────

/** The settings fields worth putting on a change record, flattened. */
function settingsFacts(settings: AIOperationalSettings): Readonly<Record<string, unknown>> {
  return {
    configurationVersion: settings.configurationVersion,
    aiEnabled: settings.aiEnabled,
    realRequestsEnabled: settings.realRequestsEnabled,
    emergencyStopEngaged: settings.emergencyStop.engaged,
    defaultProviderId: settings.defaultProviderId ?? '(none)',
    defaultModelId: settings.defaultModelId ?? '(none)',
    providerPreference: settings.providerPreference,
    fallbackProviderId: settings.fallbackProviderId ?? '(none)',
    failoverEnabled: settings.failoverEnabled,
    routingStrategy: settings.routing.strategy,
    routingMaxProviders: settings.routing.maxProviders,
    requireCertifiedProviders: settings.requireCertifiedProviders,
    requireCertifiedAgents: settings.requireCertifiedAgents,
    requireCertifiedTools: settings.requireCertifiedTools,
    retryBaseDelayMs: settings.retry.baseDelayMs,
    retryMaxDelayMs: settings.retry.maxDelayMs,
    retryJitterPercent: settings.retry.jitterPercent,
    workflowDeadlineMs: settings.timeout.workflowDeadlineMs,
    budgetOrganizationDailyMicroUsd: settings.budget.organizationDailyMicroUsd,
    budgetActorDailyMicroUsd: settings.budget.actorDailyMicroUsd,
    budgetAlertThresholdPercent: settings.budget.alertThresholdPercent,
    budgetEnforce: settings.budget.enforce,
  };
}

function providerFacts(
  providerId: string,
  settings: AIOperationalSettings,
): Readonly<Record<string, unknown>> {
  const setting = settings.providers[providerId];
  return {
    providerId,
    enabled: setting?.enabled ?? '(registry default)',
    modelAllowList: setting?.modelAllowList ?? [],
    configurationVersion: settings.configurationVersion,
  };
}

function spendFacts(record: SpendRecord): Readonly<Record<string, unknown>> {
  return {
    capMicroUsd: record.capMicroUsd,
    spentMicroUsd: record.spentMicroUsd,
    reservedMicroUsd: record.reservedMicroUsd,
    openReservations: record.openReservations.length,
    resets: record.resets.length,
  };
}

/**
 * Name the change for the trail.
 *
 * A settings patch that toggles the master switch or the real-request switch is
 * recorded under the action that names it, so an incident review can filter the
 * trail for "who turned AI off" without reading every settings diff.
 */
function resolveSettingsAction(
  before: AIOperationalSettings,
  after: AIOperationalSettings,
): AdminAction {
  if (before.aiEnabled !== after.aiEnabled) {
    return after.aiEnabled ? ADMIN_ACTION.aiEnabled : ADMIN_ACTION.aiDisabled;
  }
  if (before.realRequestsEnabled !== after.realRequestsEnabled) {
    return after.realRequestsEnabled
      ? ADMIN_ACTION.realRequestsEnabled
      : ADMIN_ACTION.realRequestsDisabled;
  }
  if (before.defaultModelId !== after.defaultModelId) return ADMIN_ACTION.modelPinned;
  if (
    before.budget.organizationDailyMicroUsd !== after.budget.organizationDailyMicroUsd ||
    before.budget.actorDailyMicroUsd !== after.budget.actorDailyMicroUsd ||
    before.budget.alertThresholdPercent !== after.budget.alertThresholdPercent ||
    before.budget.enforce !== after.budget.enforce
  ) {
    return ADMIN_ACTION.budgetUpdated;
  }
  return ADMIN_ACTION.settingsUpdated;
}

/**
 * Bound a requested cap.
 *
 * A non-finite or negative figure keeps the current cap rather than becoming
 * zero: a malformed spending ceiling must never be interpreted as "stop
 * spending" by accident, because that is an outage caused by a typo.
 */
function clampCap(requested: number, current: number): number {
  if (!Number.isFinite(requested) || requested < 0) return current;
  return Math.min(MAX_ADMIN_SPEND_CAP_MICRO_USD, Math.round(requested));
}
