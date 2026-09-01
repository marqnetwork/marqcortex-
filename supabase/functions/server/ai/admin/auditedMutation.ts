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

/**
 * The longest reason recorded on the trail.
 *
 * Bounded HERE as well as in each surface's `requireReason`, because the
 * rejection path records a reason that has NOT been through validation — see
 * `statedReason` — and an unbounded caller-supplied string reaching an
 * append-only record is a way to fill one.
 */
const MAX_RECORDED_REASON = 500;

/**
 * What the caller SAID, bounded, for a record written before validation ran.
 *
 * REGRESSION FIXED HERE, FOUND BY AN INDEPENDENT CERTIFICATION GATE. When this
 * runner was extracted from the platform administration service, the rejection
 * path lost its fallback to the caller's own text and recorded
 * "(no reason supplied)" for every refusal — including refusals where a reason
 * had been supplied, was perfectly valid, and was the only record of what the
 * actor was trying to do.
 *
 * DENIED ATTEMPTS ARE WHAT A SECURITY REVIEW READS. "An administrator was
 * refused" and "an administrator was refused while stating they were rotating
 * a key after an incident" are different events, and the trail must be able to
 * tell them apart. This restores the pre-extraction behaviour on both surfaces:
 * a reason that was given is recorded even when the change it accompanied was
 * refused, and only a genuinely absent one reads as absent.
 */
function statedReason(reason: unknown, fallback: string): string {
  const trimmed = typeof reason === 'string' ? reason.trim() : '';
  return trimmed === '' ? fallback : trimmed.slice(0, MAX_RECORDED_REASON);
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

    // Captured before anything can throw, so a refusal that happened at the
    // authorization check still records what the actor said they were doing.
    const stated = statedReason(options.reason, noReason);

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
        reason: extra.reason ?? stated,
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
