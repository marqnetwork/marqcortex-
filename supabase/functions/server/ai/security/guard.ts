/**
 * AI Guard — the single security boundary in front of every AI execution.
 *
 * Nothing reaches the orchestrator without passing through here. The guard runs
 * in a fixed order, cheapest and most absolute first, so an unauthenticated or
 * malformed request is rejected before it can consume any expensive resource:
 *
 *   1. contract version      — refuse a wire contract we cannot honour
 *   2. feature resolution    — unknown feature stops here
 *   3. payload size          — reject oversized bodies before parsing intent
 *   4. authentication        — resolve the bearer credential
 *   5. organization          — resolve and authorize the tenant
 *   6. actor                 — resolve identity, roles and capability grants
 *   7. body validation       — the feature's declared shape, unknown keys dropped
 *   8. rate limiting         — per actor and per organization, recorded last so
 *                              rejected garbage does not consume a caller's quota
 *
 * Rate limiting is deliberately last among the checks that record state: a
 * request that fails validation must not burn the caller's allowance, or a
 * buggy client becomes a self-inflicted denial of service.
 *
 * The guard produces an immutable `AIRequestContext`. No later stage may alter
 * identity — the context that authorized the request is the same one that lands
 * in the audit record.
 */

import type {
  AIChannel,
  AIRequestContext,
  AIRequestEnvelope,
  AIRequestTransport,
} from '../contracts/request.ts';
import type { FeatureCatalog, AIFeatureDefinition } from '../policy/featureCatalog.ts';
import type { RateLimiter } from './rateLimiter.ts';
import type { AIAuthenticator, AuthenticatedSubject } from './actor.ts';
import type { Clock } from '../runtime/clock.ts';
import type { IdFactory } from '../contracts/ids.ts';
import { AIError } from '../contracts/errors.ts';
import { CONTRACT_VERSION, PLATFORM_VERSION, isSupportedContractVersion } from '../contracts/versions.ts';
import { adoptOrCreateId } from '../contracts/ids.ts';
import { describeIssues, isFailure, stringMap } from './validation.ts';
import { rateLimitScope } from './rateLimiter.ts';
import { resolveActor } from './actor.ts';
import { resolveOrganization, type OrganizationResolutionOptions } from './tenancy.ts';

export interface GuardDependencies {
  readonly catalog: FeatureCatalog;
  readonly authenticator: AIAuthenticator;
  readonly rateLimiter: RateLimiter;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly organizationOptions: OrganizationResolutionOptions;
}

export interface GuardedRequest<TInput = unknown> {
  readonly context: AIRequestContext;
  readonly definition: AIFeatureDefinition<TInput, unknown>;
  readonly input: TInput;
  /** Rate limit headroom after this request, for response headers. */
  readonly rateLimit: {
    readonly limit: number;
    readonly remaining: number;
    readonly resetAtMs: number;
  };
}

const ATTRIBUTE_VALIDATOR = stringMap({ maxEntries: 16, maxKeyLength: 40, maxValueLength: 200 });
const VALID_CHANNELS: readonly AIChannel[] = ['team_console', 'client_portal', 'system'];

export interface AIGuard {
  admit<TInput>(
    envelope: AIRequestEnvelope<unknown>,
    transport: AIRequestTransport,
  ): Promise<GuardedRequest<TInput>>;
}

export function createAIGuard(deps: GuardDependencies): AIGuard {
  const { catalog, authenticator, rateLimiter, clock, ids, organizationOptions } = deps;

  return {
    async admit<TInput>(
      envelope: AIRequestEnvelope<unknown>,
      transport: AIRequestTransport,
    ): Promise<GuardedRequest<TInput>> {
      // 1 — contract version
      const contractVersion = envelope.contractVersion ?? CONTRACT_VERSION;
      if (!isSupportedContractVersion(contractVersion)) {
        throw new AIError(
          'CONTRACT_VERSION_UNSUPPORTED',
          `Unsupported AI contract version. This platform serves ${CONTRACT_VERSION}.`,
          { diagnostics: `requested=${contractVersion}` },
        );
      }

      // 2 — feature resolution
      const definition = catalog.require(envelope.featureId) as AIFeatureDefinition<TInput, unknown>;
      const { descriptor } = definition;

      // 3 — payload size, from the transport where available and from the
      // serialized input otherwise. Checked before any interpretation of intent.
      const declaredBytes = transport.contentLength;
      if (declaredBytes !== undefined && declaredBytes > descriptor.limits.maxInputBytes) {
        throw new AIError('PAYLOAD_TOO_LARGE', 'Request body exceeds the limit for this AI feature.', {
          diagnostics: `bytes=${declaredBytes} limit=${descriptor.limits.maxInputBytes}`,
        });
      }
      const measuredBytes = measureBytes(envelope.input);
      if (measuredBytes > descriptor.limits.maxInputBytes) {
        throw new AIError('PAYLOAD_TOO_LARGE', 'Request body exceeds the limit for this AI feature.', {
          diagnostics: `bytes=${measuredBytes} limit=${descriptor.limits.maxInputBytes}`,
        });
      }

      // 4 — authentication
      //
      // The capability this feature demands is declared by the descriptor, so
      // the guard — not the caller — decides whether authority may be resolved
      // from a cached membership snapshot. A privileged feature is resolved
      // against the database in every isolate, which is what stops a revocation
      // performed in one isolate from being ignored by another for the length
      // of a cache TTL (M-A).
      let subject: AuthenticatedSubject | null = null;
      if (transport.authorization) {
        subject = await authenticator.authenticate(transport.authorization, {
          requiredCapability: descriptor.capability,
        });
        if (!subject) {
          throw new AIError('AUTH_INVALID', 'The supplied credential is not valid.');
        }
      }
      const allowAnonymous = descriptor.allowedActorTypes.includes('anonymous');
      if (!subject && !allowAnonymous) {
        throw new AIError('AUTH_REQUIRED', 'Authentication is required for this AI feature.');
      }

      // From here on the caller's identity is established, so any rejection is
      // attributable — and a rejection an authenticated caller triggers is
      // exactly the kind a security review needs a durable record of. Failures
      // below carry that identity out with them so the orchestrator can audit
      // them rather than only counting them.
      const attributed = <T>(work: () => T): T => {
        try {
          return work();
        } catch (error) {
          if (!(error instanceof AIError) || !subject) throw error;
          throw error.withSecurityContext({
            subjectId: subject.subjectId,
            actorType: subject.actorType,
            roles: [...new Set(subject.globalRoles.map((role) => role.toLowerCase()))].sort(),
            organizationId: subject.memberships[0]?.organizationId,
            requestedOrganizationId: transport.organizationHint?.trim() || undefined,
          });
        }
      };

      // 5 — organization
      const organization = attributed(() =>
        resolveOrganization(subject, transport.organizationHint, organizationOptions),
      );

      // 6 — actor
      const actor = attributed(() =>
        resolveActor(subject, organization.organizationId, { allowAnonymous }),
      );

      // 7 — body validation
      const validation = definition.inputValidator.validate(envelope.input, '');
      if (isFailure(validation)) {
        throw new AIError('VALIDATION_FAILED', `Invalid AI request: ${describeIssues(validation.issues)}`, {
          fields: validation.issues.map((issue) => issue.path),
        });
      }

      const attributeResult = ATTRIBUTE_VALIDATOR.validate(envelope.attributes ?? {}, 'attributes');
      if (isFailure(attributeResult)) {
        throw new AIError(
          'VALIDATION_FAILED',
          `Invalid AI request: ${describeIssues(attributeResult.issues)}`,
          { fields: attributeResult.issues.map((issue) => issue.path) },
        );
      }

      const channel: AIChannel = VALID_CHANNELS.includes(envelope.channel as AIChannel)
        ? (envelope.channel as AIChannel)
        : 'team_console';

      // 8 — rate limiting. Organization first: a tenant at its ceiling should
      // not consume an individual's allowance to learn it is at its ceiling.
      // Weighted, so an expensive feature draws proportionally more of the
      // window than a cheap one.
      const cost = descriptor.limits.rateLimitCost ?? 1;
      const organizationDecision = rateLimiter.consume(
        rateLimitScope.organization(organization.organizationId, descriptor.featureId),
        descriptor.limits.perOrganization,
        cost,
      );
      if (!organizationDecision.allowed) {
        throw new AIError('RATE_LIMITED', 'Your organization has reached its AI request limit. Try again shortly.', {
          retryAfterSeconds: organizationDecision.retryAfterSeconds,
          diagnostics: `scope=organization feature=${descriptor.featureId} org=${organization.organizationId}`,
        });
      }

      const actorDecision = rateLimiter.consume(
        rateLimitScope.actor(organization.organizationId, actor.actorId, descriptor.featureId),
        descriptor.limits.perActor,
        cost,
      );
      if (!actorDecision.allowed) {
        throw new AIError('RATE_LIMITED', 'You have reached the AI request limit. Try again shortly.', {
          retryAfterSeconds: actorDecision.retryAfterSeconds,
          diagnostics: `scope=actor feature=${descriptor.featureId} actor=${actor.actorId}`,
        });
      }

      const context: AIRequestContext = Object.freeze({
        requestId: ids.next('req'),
        correlationId: adoptOrCreateId(envelope.correlationId, 'cor', ids),
        causationId: envelope.causationId,
        receivedAt: clock.isoNow(),
        platformVersion: PLATFORM_VERSION,
        contractVersion,
        featureId: descriptor.featureId,
        featureVersion: descriptor.featureVersion,
        actor,
        organization,
        channel,
        clientIp: transport.clientIp,
        userAgent: transport.userAgent,
        attributes: Object.freeze({ ...attributeResult.value }),
      });

      return {
        context,
        definition,
        input: validation.value,
        rateLimit: {
          limit: actorDecision.limit,
          remaining: actorDecision.remaining,
          resetAtMs: actorDecision.resetAtMs,
        },
      };
    },
  };
}

/**
 * UTF-8 byte length of the serialized payload. A caller may send multi-byte
 * characters, so a character count would under-measure the real cost by up to
 * 4×; the guard measures what actually travels.
 */
function measureBytes(input: unknown): number {
  if (input === undefined) return 0;
  let serialized: string;
  try {
    serialized = JSON.stringify(input) ?? '';
  } catch {
    throw new AIError('VALIDATION_FAILED', 'Request body could not be serialized.');
  }
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(serialized).length;
  }
  return serialized.length;
}
