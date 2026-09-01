/**
 * The audited-mutation discipline, extracted — AI-01 Batch 4D.
 *
 * WHY THIS FILE EXISTS AT ALL.
 *
 * `administration.ts` grew one function, `mutate`, that every administrative
 * write on the platform goes through: authorize, demand a reason, take the
 * isolate's mutation lock, read the BEFORE state, apply the change, read the
 * AFTER state, write ONE append-only audit record — and record a REJECTION,
 * with its code, when any of that fails. `providerAdministration.ts` already
 * borrows it rather than reimplementing it, and its own comment says why:
 *
 *   "a provider-administration-shaped copy of that machinery would be a second
 *    place for the audit record to be forgotten."
 *
 * Batch 4D adds a THIRD surface — customer BYOK — over a different actor type
 * and a different capability vocabulary. A third copy would be a third place,
 * and the one that matters most: it is the surface where a customer's own
 * vendor credential is stored, replaced and withdrawn, and an unaudited write
 * there is an unauditable one.
 *
 * So the discipline moves here, ONCE, parameterised by the two things that
 * genuinely differ between surfaces:
 *
 *   `authorize`  How this surface enforces authority. The platform surface
 *                calls `requireCapability` over `AIAdminCapability`; the BYOK
 *                surface calls `requireByokCapability` over `AIByokCapability`.
 *                Passed as a CALLBACK rather than as a list of capability
 *                strings, so the two vocabularies never have to be unioned into
 *                one type — which is what would let a grant on one surface be
 *                spelled in a way the other accepts.
 *
 *   `lock`       Which mutation chain this surface serialises on. Each service
 *                owns its own, so a customer rotating their key does not queue
 *                behind a platform settings write.
 *
 * Everything else — the ordering, the rejection record, the log lines, the
 * bounded change maps — is here and is identical for every caller, which is the
 * only property that makes "every administrative change on this platform is on
 * one trail" a structural claim rather than a habit.
 *
 * ── THE ORDERING IS LOAD-BEARING AND IS PRESERVED EXACTLY ─────────────────
 *
 *   1. `authorize()` — inside the try, so a refused caller produces a RECORDED
 *      rejection rather than a silent 403. "Somebody tried" is the half of an
 *      administrative trail that catches an attack.
 *   2. `requireReason` — after authority, because a caller who may not act at
 *      all should be told that first, and because the reason field has to have
 *      a defined value before the rejection record is written.
 *   3. The lock, then `before()`, then `run()` — both inside, so two
 *      administrators on one isolate are applied in a defined order rather than
 *      racing between a read and a write.
 *   4. The audit record, then the log line, then the result.
 */

import type { Logger } from '../observability/logger.ts';
import type { AdminAction, AdminAuditRecord, AdminAuditWriter } from './adminAudit.ts';
import { changedKeys, toChangeMap } from './adminAudit.ts';
import { AIError } from '../contracts/errors.ts';

/**
 * The facts about an actor that reach the audit record.
 *
 * A STRUCTURAL SHAPE, not a union of the platform and BYOK actor types. Adding
 * a surface means satisfying four fields, not widening a type that every
 * existing caller is checked against.
 */
export interface AuditedMutationActor {
  readonly actorId: string;
  readonly email?: string;
  readonly actorRole: AdminAuditRecord['actorRole'];
  /** Organizations this actor could act for. Empty means platform-wide. */
  readonly organizationScope: readonly string[];
}

export interface AuditedMutationOptions<T> {
  readonly action: AdminAction;
  readonly reason: unknown;
  readonly target?: string;
  readonly meta?: { readonly correlationId?: string; readonly clientIp?: string };
  /**
   * Enforce this surface's authority. MUST throw when the actor may not act.
   *
   * A callback rather than a capability list: the two surfaces speak different
   * capability vocabularies, and a shared list type would be a shared namespace
   * in which a grant intended for one could be spelled for the other.
   */
  readonly authorize: () => void;
  readonly before: () => Promise<Readonly<Record<string, unknown>>>;
  readonly run: (reason: string) => Promise<{
    after: Readonly<Record<string, unknown>>;
    result: T;
    configurationVersion?: number;
    /** Overrides `action` when the change turned out to be a different one. */
    action?: AdminAction;
  }>;
}

export type AuditedMutationRunner = <T>(
  actor: AuditedMutationActor,
  options: AuditedMutationOptions<T>,
) => Promise<T>;

export interface AuditedMutationDependencies {
  readonly trail: AdminAuditWriter;
  readonly logger: Logger;
  /** This surface's mutation chain. One per service, never shared implicitly. */
  readonly lock: <T>(work: () => Promise<T>) => Promise<T>;
  /** Validate and bound the caller's reason, or throw. */
  readonly requireReason: (reason: unknown) => string;
  /**
   * Reason text used on a rejection that happened before one was validated.
   *
   * Present so the two surfaces can word it for their own audience without
   * either of them being able to omit the field.
   */
  readonly noReasonText?: string;
}

export function createAuditedMutationRunner(
  deps: AuditedMutationDependencies,
): AuditedMutationRunner {
  const noReason = deps.noReasonText ?? '(no reason supplied)';

  return async function mutate<T>(
    actor: AuditedMutationActor,
    options: AuditedMutationOptions<T>,
  ): Promise<T> {
    // Empty until the change is authorised. A rejection that happened before
    // the prior state was read records an empty `before`, which is the truth:
    // nothing was read, so nothing can be claimed about it.
    let before: Readonly<Record<string, unknown>> = {};

    const audit = (
      outcome: 'applied' | 'rejected',
      extra: {
        reason?: string;
        after?: Readonly<Record<string, unknown>>;
        configurationVersion?: number;
        rejectionCode?: string;
        action?: AdminAction;
      },
    ): void => {
      deps.trail.record({
        action: extra.action ?? options.action,
        outcome,
        actorId: actor.actorId,
        actorEmail: actor.email,
        actorRole: actor.actorRole,
        organizationScope: actor.organizationScope,
        target: options.target,
        reason: extra.reason ?? noReason,
        before: toChangeMap(before),
        after: toChangeMap(extra.after ?? {}),
        configurationVersion: extra.configurationVersion,
        correlationId: options.meta?.correlationId,
        clientIp: options.meta?.clientIp,
        rejectionCode: extra.rejectionCode,
      });
    };

    try {
      options.authorize();
      const reason = deps.requireReason(options.reason);
      const outcome = await deps.lock(async () => {
        before = await options.before();
        return options.run(reason);
      });
      audit('applied', {
        reason,
        after: outcome.after,
        configurationVersion: outcome.configurationVersion,
        action: outcome.action,
      });
      deps.logger.info('ai.admin.change_applied', {
        action: outcome.action ?? options.action,
        actorId: actor.actorId,
        role: actor.actorRole,
        target: options.target,
        configurationVersion: outcome.configurationVersion,
        changed: changedKeys(toChangeMap(before), toChangeMap(outcome.after)).join(','),
      });
      return outcome.result;
    } catch (error) {
      const aiError = error instanceof AIError ? error : undefined;
      audit('rejected', { rejectionCode: aiError?.code ?? 'INTERNAL_ERROR' });
      deps.logger.warn('ai.admin.change_rejected', {
        action: options.action,
        actorId: actor.actorId,
        role: actor.actorRole,
        target: options.target,
        code: aiError?.code ?? 'INTERNAL_ERROR',
        diagnostics: aiError?.diagnostics,
      });
      throw error;
    }
  };
}

/**
 * A per-isolate mutation chain.
 *
 * Compare-and-swap already makes a lost update impossible ACROSS isolates.
 * Within one, two administrators can still interleave between a durable read
 * and a durable write, and the loser would simply retry — correct, but it also
 * allows two saves to land out of order, so a slow first write can overwrite a
 * fast second one. One chain per isolate makes the order deterministic.
 *
 * A FAILED MUTATION MUST NOT POISON THE CHAIN for every later caller, which is
 * what the trailing `catch` is for.
 */
export function createMutationChain(): <T>(work: () => Promise<T>) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve();
  return function withMutationLock<T>(work: () => Promise<T>): Promise<T> {
    const next = chain.then(work, work);
    chain = next.catch(() => undefined);
    return next;
  };
}
