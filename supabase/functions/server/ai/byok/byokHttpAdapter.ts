/**
 * Framework-agnostic HTTP adapter for customer BYOK administration.
 *
 * The same shape as `admin/httpAdapter.ts` and for the same reasons: the whole
 * request/response mapping is a pure function, so status codes, error bodies
 * and — most importantly — the authorization boundary are unit-testable without
 * a server, and binding a different framework is a new twenty-line file.
 *
 * ONE ENTRY POINT. Every operation goes through `executeByokHttpRequest`, which
 * AUTHORISES FIRST and DISPATCHES SECOND. There is no handler reachable without
 * the caller having been resolved to a customer administrator scoped to one
 * organization, because dispatch happens inside the function that does the
 * resolving.
 *
 * ── WHAT THE BODY MAY AND MAY NOT CARRY ───────────────────────────────────
 *
 * The body carries exactly three things across the whole surface: `secret`,
 * `credentialName`, `reason` and `fallback`. It does NOT carry:
 *
 *   an organization id   The tenant comes from the authenticated identity, via
 *                        the `X-MARQ-Organization` HINT which is admitted only
 *                        when the subject holds a verified membership in it. A
 *                        body field would be a tenant a caller asserts.
 *   a provider id        Bound by the route table, read from the PATH. A body
 *                        provider id would let a caller ask for one provider at
 *                        another provider's endpoint, which matters because the
 *                        audit target is derived from it.
 *   a credential id      Bound by the route table, read from the PATH, for the
 *                        same reason.
 *   an operation name    Bound by the route table. A caller cannot ask for
 *                        `credentials.revoke` at the status endpoint.
 *
 * ── AND WHAT NEVER COMES BACK ─────────────────────────────────────────────
 *
 * There is no operation on this surface that returns a stored secret. There is
 * no operation NAME one could be bound to — no `credential.read`, no
 * `credential.reveal`, no `credential.plaintext` — so no route can bind one and
 * no body can ask for one. Once submitted, a provider credential is write-only
 * material.
 */

import type { AIByokFallbackPolicy } from '../providers/credentials/credentialStore.ts';
import type { ByokRequestMeta } from './byokAdministration.ts';
import type { ByokService } from './byokService.ts';
import { AIError, toAIError } from '../contracts/errors.ts';

export interface ByokHttpRequest {
  /** Operation name, bound by the route table. Never read from the body. */
  readonly operation: ByokOperation;
  readonly authorization: string | null;
  /**
   * The organization the caller says this request is for.
   *
   * A HINT, and the word is load-bearing: `resolveOrganization` admits it only
   * when the authenticated subject holds a verified membership in it, refuses
   * an unknown one, and refuses to guess when a subject holds several and named
   * none. It can narrow a caller's own authority; it can never widen it.
   */
  readonly organizationHint?: string;
  readonly body?: unknown;
  /** Path parameter. Never read from the body. */
  readonly providerId?: string;
  /** Path parameter. Never read from the body. */
  readonly credentialId?: string;
  readonly correlationId?: string;
  readonly clientIp?: string;
}

export interface ByokHttpResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export const BYOK_OPERATION = {
  /** This organization's provider/credential status. */
  status: 'byok.status',
  /**
   * This organization's own AI spend against its own ceiling (HIGH-1).
   *
   * A READ, and the only spend operation this surface has. There is no
   * `byok.spend.reset` and no `byok.spend.increase` in this table, so no route
   * can bind one and no body can ask for one — moving a governed ceiling is the
   * platform operator's act, under a capability in a different module.
   */
  spend: 'byok.spend',
  /** This organization's credential history for one provider. METADATA ONLY. */
  credentialList: 'byok.credentials.list',
  /** Store or rotate. One operation, because a rotation is a store with a predecessor. */
  credentialSet: 'byok.credentials.set',
  credentialRevoke: 'byok.credentials.revoke',
  fallbackSet: 'byok.fallback.set',
} as const;

export type ByokOperation = (typeof BYOK_OPERATION)[keyof typeof BYOK_OPERATION];

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * A bounded identifier from a PATH parameter.
 *
 * Bounded even though it comes from the route table, because a path segment is
 * still caller-controlled and reaches the administrative audit record's
 * `target`, which has no length cap of its own.
 */
function boundedId(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed.slice(0, 160);
}

function requireProviderId(request: ByokHttpRequest): string {
  const providerId = boundedId(request.providerId);
  if (providerId === undefined) {
    throw new AIError('VALIDATION_FAILED', 'A provider id is required.', {
      fields: ['providerId'],
    });
  }
  return providerId;
}

function readFallback(value: unknown): AIByokFallbackPolicy {
  if (value === 'platform' || value === 'tenant_only') return value;
  throw new AIError(
    'VALIDATION_FAILED',
    'Field `fallback` must be either "platform" or "tenant_only".',
    { fields: ['fallback'] },
  );
}

export async function executeByokHttpRequest(
  service: ByokService,
  request: ByokHttpRequest,
): Promise<ByokHttpResponse> {
  const meta: ByokRequestMeta = {
    correlationId: request.correlationId,
    clientIp: request.clientIp,
  };

  try {
    // Authorization before dispatch, for every operation without exception.
    const actor = await service.authorize(request.authorization, request.organizationHint, meta);
    const body = record(request.body);

    switch (request.operation) {
      case BYOK_OPERATION.status:
        return ok({ byok: await service.status(actor) });

      case BYOK_OPERATION.spend:
        // SAFE METADATA. The service's return type has no credential field, so
        // this response cannot carry one however it is serialised.
        return ok({ spend: await service.spend(actor) });

      case BYOK_OPERATION.credentialList:
        // METADATA. The service's return type has no secret field, so this
        // response cannot carry one however it is serialised.
        return ok({
          credentials: await service.credentials(actor, requireProviderId(request)),
        });

      case BYOK_OPERATION.credentialSet:
        // `body.secret` is passed through UNREAD and UNLOGGED. It is not
        // trimmed here, not measured here, not defaulted here and above all not
        // echoed here: the service validates it and the only thing that ever
        // touches its characters is the cipher. Nothing in this function's
        // error path can quote it, because this function never holds it in a
        // variable of its own.
        return ok({
          provider: await service.configureCredential(
            actor,
            requireProviderId(request),
            { secret: body.secret, credentialName: body.credentialName },
            body.reason,
            meta,
          ),
        });

      case BYOK_OPERATION.credentialRevoke: {
        // PATH ONLY. There is deliberately no body fallback: the audit target
        // is derived from this value, and a body-steerable target is an audit
        // record a caller can write.
        const credentialId = boundedId(request.credentialId);
        if (credentialId === undefined) {
          throw new AIError('VALIDATION_FAILED', 'A credential id is required.', {
            fields: ['credentialId'],
          });
        }
        return ok({
          provider: await service.revokeCredential(
            actor,
            requireProviderId(request),
            credentialId,
            body.reason,
            meta,
          ),
        });
      }

      case BYOK_OPERATION.fallbackSet:
        return ok({
          provider: await service.setFallbackPolicy(
            actor,
            requireProviderId(request),
            readFallback(body.fallback),
            body.reason,
            meta,
          ),
        });

      default:
        // Unreachable while the route table binds only declared operations.
        // Present so adding an operation to the union without a case here is a
        // 404 rather than an undefined response.
        throw new AIError('FEATURE_NOT_FOUND', 'Unknown credential administration operation.', {
          diagnostics: `operation=${String(request.operation)}`,
        });
    }
  } catch (error) {
    const aiError = toAIError(error);
    return {
      status: aiError.status,
      // `diagnostics` is deliberately absent. A customer administrator gets a
      // precise message and a code; the server-side detail — which names
      // organization ids, configuration ids and deployment state — stays in the
      // log and on the administrative trail, where it is already recorded.
      body: {
        success: false,
        error: aiError.message,
        code: aiError.code,
        ...(aiError.fields?.length ? { fields: aiError.fields } : {}),
      },
    };
  }
}

function ok(payload: Record<string, unknown>): ByokHttpResponse {
  return { status: 200, body: { success: true, ...payload } };
}
