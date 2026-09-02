/**
 * Framework-agnostic HTTP adapter for AI administration.
 *
 * The same shape as `http/httpAdapter.ts` and for the same reasons: the whole
 * request/response mapping is a pure function, so status codes, error bodies
 * and — most importantly — the authorization boundary are unit-testable without
 * a server, and binding a different framework is a new twenty-line file.
 *
 * ONE ENTRY POINT. Every administrative operation goes through
 * `executeAdminHttpRequest`, which authorises FIRST and dispatches SECOND.
 * There is no handler that can be reached without the caller having been
 * resolved to an administrative actor, because dispatch happens inside the
 * function that does the resolving. A route file cannot forget the check —
 * there is nothing in a route file to forget.
 *
 * BODIES ARE VALIDATED, NOT TRUSTED. Each mutation reads exactly the fields it
 * declares from an unknown body and ignores everything else, so an undeclared
 * key cannot reach the settings overlay. Numeric fields are read as numbers and
 * bounded downstream by `normalizeOperationalSettings`; identifiers are bounded
 * by the same normaliser.
 */

import type { AIAdministration, AdminRequestMeta } from './administration.ts';
import type { AIOperationalSettingsPatch } from '../runtime/operationalSettings.ts';
import { AIError, toAIError } from '../contracts/errors.ts';

export interface AdminHttpRequest {
  /** Operation name, bound by the route table. Never read from the body. */
  readonly operation: AdminOperation;
  readonly authorization: string | null;
  readonly body?: unknown;
  /** Path parameter for provider operations. */
  readonly providerId?: string;
  /**
   * Path parameter, for the organization ledger operations. Never read from a
   * body.
   *
   * IT IS A TARGET, NOT AN AUTHORITY CLAIM. The service demands
   * `ai.admin.budget.organization` — which only the platform operator holds —
   * and then checks the id against the actor's own scope, so naming an
   * organization here can select a ledger the caller is already entitled to and
   * can never grant entitlement to one they are not.
   */
  readonly organizationId?: string;
  /** Path parameter for model operations (AI-01 Batch 4C). */
  readonly modelId?: string;
  /** Path parameter for credential revocation (AI-01 Batch 4C). */
  readonly credentialId?: string;
  readonly limit?: number;
  readonly correlationId?: string;
  readonly clientIp?: string;
}

export interface AdminHttpResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export const ADMIN_OPERATION = {
  overview: 'overview',
  getSettings: 'settings.read',
  updateSettings: 'settings.update',
  emergencyStop: 'settings.emergency_stop',
  listProviders: 'providers.list',
  updateProvider: 'providers.update',
  getBudget: 'budget.read',
  resetBudget: 'budget.reset',
  increaseBudget: 'budget.increase',

  // ── Organization spend administration (4D remediation, HIGH-1) ────────────
  //
  // THREE NAMES OF THEIR OWN, not the platform ones with an id attached. A
  // route table that bound `budget.reset` to a path carrying an organization
  // would be one typo away from a tenant operation reaching MARQ's ceiling, and
  // one grant-table edit away from the tenant capability reaching MARQ's
  // budget. Separate operations dispatch into separate service methods that
  // name separate scopes.
  getOrganizationBudget: 'budget.organization.read',
  resetOrganizationBudget: 'budget.organization.reset',
  increaseOrganizationBudget: 'budget.organization.increase',
  usage: 'usage.read',
  diagnostics: 'diagnostics.read',
  executionAudit: 'audit.execution',
  adminAudit: 'audit.administrative',

  // ── Provider administration (AI-01 Batch 4C) ──────────────────────────────
  //
  // Domain operations, never generic CRUD. There is no `providers.write` that
  // takes a table and a row: each name below is one decision an operator makes,
  // and each demands its own capability inside the service. A generic write
  // would let the least-privileged caller who can reach ANY of them reach all.
  //
  // NOTE WHAT IS ABSENT. There is no `credential.read`, no `credential.reveal`
  // and no `credential.plaintext`. The operation does not exist, so no route
  // can bind it and no body can ask for it.
  providerAdministration: 'providers.administration',
  providerDetail: 'providers.detail',
  providerCredentialList: 'providers.credentials.list',
  providerSetEnabled: 'providers.set_enabled',
  providerSetCredential: 'providers.credentials.set',
  providerRevokeCredential: 'providers.credentials.revoke',
  providerSetModelEnabled: 'providers.models.set_enabled',
} as const;

export type AdminOperation = (typeof ADMIN_OPERATION)[keyof typeof ADMIN_OPERATION];

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalBool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalStringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * `null` clears an optional id and `undefined` leaves it alone, so the wire
 * shape can express "un-pin the default provider" — which a bare optional
 * string cannot.
 */
function nullableId(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

/** Read exactly the declared settings fields. Everything else is dropped. */
function readSettingsPatch(body: Record<string, unknown>): AIOperationalSettingsPatch {
  const retry = record(body.retry);
  const timeout = record(body.timeout);
  const budget = record(body.budget);

  const patch: Record<string, unknown> = {
    aiEnabled: optionalBool(body.aiEnabled),
    realRequestsEnabled: optionalBool(body.realRequestsEnabled),
    defaultProviderId: nullableId(body.defaultProviderId),
    providerPreference: optionalStringList(body.providerPreference),
    fallbackProviderId: nullableId(body.fallbackProviderId),
    failoverEnabled: optionalBool(body.failoverEnabled),
    requireCertifiedProviders: optionalBool(body.requireCertifiedProviders),
    requireCertifiedAgents: optionalBool(body.requireCertifiedAgents),
    requireCertifiedTools: optionalBool(body.requireCertifiedTools),
    defaultModelId: nullableId(body.defaultModelId),
  };

  // A group is present only when the caller actually sent one. `capabilitiesForPatch`
  // decides which grants a change needs from which groups are present, so an
  // always-present empty `budget: {}` would demand the budget capability from
  // every caller retuning a timeout.
  if ('retry' in body) {
    patch.retry = {
      baseDelayMs: optionalNumber(retry.baseDelayMs),
      maxDelayMs: optionalNumber(retry.maxDelayMs),
      jitterPercent: optionalNumber(retry.jitterPercent),
    };
  }
  if ('timeout' in body) {
    patch.timeout = { workflowDeadlineMs: optionalNumber(timeout.workflowDeadlineMs) };
  }
  if ('budget' in body) {
    patch.budget = {
      organizationDailyMicroUsd: optionalNumber(budget.organizationDailyMicroUsd),
      actorDailyMicroUsd: optionalNumber(budget.actorDailyMicroUsd),
      alertThresholdPercent: optionalNumber(budget.alertThresholdPercent),
      enforce: optionalBool(budget.enforce),
    };
  }

  // Undefined entries are stripped so `'field' in patch` stays a truthful test
  // of what the caller asked to change.
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete patch[key];
  }
  return patch as AIOperationalSettingsPatch;
}

function reasonOf(body: Record<string, unknown>): unknown {
  return body.reason;
}

/**
 * A bounded identifier from a PATH parameter.
 *
 * Bounded even though it comes from the route table, because a path segment is
 * still caller-controlled: it reaches the administrative audit record's
 * `target`, which — unlike `reason` — has no length cap of its own. An
 * oversized segment would inflate an audit record rather than be refused.
 */
function boundedId(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed.slice(0, 160);
}

/**
 * The organization id from the PATH, or a rejection.
 *
 * Bounded here and validated as a storage key segment in the service. Two
 * checks rather than one because they answer different questions: this one
 * bounds what reaches an audit record, and `isolationKeyFor` decides whether
 * the value may become part of a ledger key at all.
 */
function requireOrganizationId(request: AdminHttpRequest): string {
  const organizationId = boundedId(request.organizationId);
  if (organizationId === undefined) {
    throw new AIError('VALIDATION_FAILED', 'An organization id is required.', {
      fields: ['organizationId'],
    });
  }
  return organizationId;
}

/**
 * The provider id, or a rejection.
 *
 * Read from the PATH, bound by the route table, never from the body. A provider
 * id taken from a body would let a caller ask for one provider at another
 * provider's endpoint — which matters here because the capabilities differ per
 * operation and the audit target is derived from this value.
 */
function requireProviderId(request: AdminHttpRequest): string {
  const providerId = boundedId(request.providerId);
  if (providerId === undefined) {
    throw new AIError('VALIDATION_FAILED', 'A provider id is required.', {
      fields: ['providerId'],
    });
  }
  return providerId;
}

export async function executeAdminHttpRequest(
  admin: AIAdministration,
  request: AdminHttpRequest,
): Promise<AdminHttpResponse> {
  const meta: AdminRequestMeta = {
    correlationId: request.correlationId,
    clientIp: request.clientIp,
  };

  try {
    // Authorization before dispatch, for every operation without exception.
    const actor = await admin.authorize(request.authorization, meta);
    const body = record(request.body);

    switch (request.operation) {
      case ADMIN_OPERATION.overview:
        return ok({ overview: await admin.overview(actor) });

      case ADMIN_OPERATION.getSettings:
        return ok({ settings: await admin.settings(actor) });

      case ADMIN_OPERATION.updateSettings:
        return ok({
          settings: await admin.updateSettings(actor, readSettingsPatch(body), reasonOf(body), meta),
        });

      case ADMIN_OPERATION.emergencyStop: {
        const engaged = optionalBool(body.engaged);
        if (engaged === undefined) {
          throw new AIError('VALIDATION_FAILED', 'Field `engaged` must be true or false.', {
            fields: ['engaged'],
          });
        }
        return ok({
          settings: await admin.setEmergencyStop(actor, engaged, reasonOf(body), meta),
        });
      }

      case ADMIN_OPERATION.listProviders:
        return ok({ providers: await admin.providers(actor) });

      case ADMIN_OPERATION.updateProvider: {
        if (!request.providerId) {
          throw new AIError('VALIDATION_FAILED', 'A provider id is required.', {
            fields: ['providerId'],
          });
        }
        const providers = await admin.updateProvider(
          actor,
          request.providerId,
          {
            enabled: optionalBool(body.enabled),
            modelAllowList:
              body.modelAllowList === null ? null : optionalStringList(body.modelAllowList),
          },
          reasonOf(body),
          meta,
        );
        return ok({ providers });
      }

      case ADMIN_OPERATION.getBudget:
        return ok({ budget: await admin.budget(actor) });

      case ADMIN_OPERATION.resetBudget:
        return ok({
          budget: await admin.resetSpend(
            actor,
            reasonOf(body),
            { newCapMicroUsd: optionalNumber(body.newCapMicroUsd) },
            meta,
          ),
        });

      case ADMIN_OPERATION.increaseBudget: {
        const cap = optionalNumber(body.capMicroUsd);
        if (cap === undefined) {
          throw new AIError('VALIDATION_FAILED', 'Field `capMicroUsd` must be a number.', {
            fields: ['capMicroUsd'],
          });
        }
        return ok({ budget: await admin.increaseSpendCap(actor, cap, reasonOf(body), meta) });
      }

      case ADMIN_OPERATION.getOrganizationBudget:
        return ok({
          budget: await admin.organizationBudget(actor, requireOrganizationId(request)),
        });

      case ADMIN_OPERATION.resetOrganizationBudget:
        return ok({
          budget: await admin.resetOrganizationSpend(
            actor,
            requireOrganizationId(request),
            reasonOf(body),
            { newCapMicroUsd: optionalNumber(body.newCapMicroUsd) },
            meta,
          ),
        });

      case ADMIN_OPERATION.increaseOrganizationBudget: {
        const organizationCap = optionalNumber(body.capMicroUsd);
        if (organizationCap === undefined) {
          throw new AIError('VALIDATION_FAILED', 'Field `capMicroUsd` must be a number.', {
            fields: ['capMicroUsd'],
          });
        }
        return ok({
          budget: await admin.increaseOrganizationSpendCap(
            actor,
            requireOrganizationId(request),
            organizationCap,
            reasonOf(body),
            meta,
          ),
        });
      }

      case ADMIN_OPERATION.usage:
        return ok({ usage: await admin.usage(actor) });

      case ADMIN_OPERATION.diagnostics:
        return ok({ diagnostics: await admin.diagnostics(actor) });

      // ── Provider administration (AI-01 Batch 4C) ───────────────────────
      case ADMIN_OPERATION.providerAdministration:
        return ok({ providers: await admin.providerAdministration(actor) });

      case ADMIN_OPERATION.providerDetail:
        return ok({ provider: await admin.providerDetail(actor, requireProviderId(request)) });

      case ADMIN_OPERATION.providerCredentialList:
        // METADATA. The service's return type has no secret field, so this
        // response cannot carry one however it is serialised.
        return ok({
          credentials: await admin.providerCredentials(actor, requireProviderId(request)),
        });

      case ADMIN_OPERATION.providerSetEnabled: {
        const enabled = optionalBool(body.enabled);
        if (enabled === undefined) {
          throw new AIError('VALIDATION_FAILED', 'Field `enabled` must be true or false.', {
            fields: ['enabled'],
          });
        }
        return ok({
          provider: await admin.setProviderEnabled(
            actor,
            requireProviderId(request),
            enabled,
            reasonOf(body),
            meta,
          ),
        });
      }

      case ADMIN_OPERATION.providerSetCredential: {
        // `body.secret` is passed through UNREAD and UNLOGGED. It is not
        // trimmed here, not measured here, not defaulted here and above all not
        // echoed here: the service validates it and the only thing that ever
        // touches its characters is the cipher. Nothing in this function's
        // error path can quote it, because this function never holds it in a
        // variable of its own.
        return ok({
          provider: await admin.setProviderCredential(
            actor,
            requireProviderId(request),
            { secret: body.secret, credentialName: body.credentialName },
            reasonOf(body),
            meta,
          ),
        });
      }

      case ADMIN_OPERATION.providerRevokeCredential: {
        // PATH ONLY. There was a `?? optionalId(body.credentialId)` fallback
        // here; the route table always supplies the path value so it was
        // unreachable, but its existence contradicted this surface's own
        // guarantee that the audit target cannot be steered by a request body —
        // and it would have quietly re-enabled body-steering for any future
        // route registered without a path extractor.
        const credentialId = boundedId(request.credentialId);
        if (credentialId === undefined) {
          throw new AIError('VALIDATION_FAILED', 'A credential id is required.', {
            fields: ['credentialId'],
          });
        }
        return ok({
          provider: await admin.revokeProviderCredential(
            actor,
            requireProviderId(request),
            credentialId,
            reasonOf(body),
            meta,
          ),
        });
      }

      case ADMIN_OPERATION.providerSetModelEnabled: {
        // PATH ONLY — see the note on credential revocation above.
        const modelId = boundedId(request.modelId);
        if (modelId === undefined) {
          throw new AIError('VALIDATION_FAILED', 'A model id is required.', {
            fields: ['modelId'],
          });
        }
        const enabled = optionalBool(body.enabled);
        if (enabled === undefined) {
          throw new AIError('VALIDATION_FAILED', 'Field `enabled` must be true or false.', {
            fields: ['enabled'],
          });
        }
        return ok({
          provider: await admin.setProviderModelEnabled(
            actor,
            requireProviderId(request),
            modelId,
            enabled,
            reasonOf(body),
            meta,
          ),
        });
      }

      case ADMIN_OPERATION.executionAudit:
        return ok({ records: admin.executionAudit(actor, request.limit) });

      case ADMIN_OPERATION.adminAudit:
        return ok({ records: admin.adminAudit(actor, request.limit) });

      default:
        // Unreachable while the route table binds only declared operations.
        // Present so adding an operation to the union without a case here is a
        // 404 rather than an undefined response.
        throw new AIError('FEATURE_NOT_FOUND', 'Unknown AI administration operation.', {
          diagnostics: `operation=${String(request.operation)}`,
        });
    }
  } catch (error) {
    const aiError = toAIError(error);
    return {
      status: aiError.status,
      // `diagnostics` is deliberately absent. An administrator gets a precise
      // message and a code; the server-side detail stays in the log and the
      // administrative trail, where it is already recorded.
      body: {
        success: false,
        error: aiError.message,
        code: aiError.code,
        ...(aiError.fields?.length ? { fields: aiError.fields } : {}),
      },
    };
  }
}

function ok(payload: Record<string, unknown>): AdminHttpResponse {
  return { status: 200, body: { success: true, ...payload } };
}
