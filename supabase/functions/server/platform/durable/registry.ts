/**
 * The handler registry (BP-002 §16, CHECKPOINT 5).
 *
 * A MAP, AND IT MUST STAY A MAP. The packet's instruction is blunt — "handler
 * registry must not become a second workflow engine" — and the way a registry
 * becomes one is gradual and always reasonable at each step: first a handler
 * that can enqueue a successor, then an ordering between them, then a
 * conditional, then a retry that depends on which predecessor failed, and at
 * that point the platform has two engines that disagree about what a failed
 * step means.
 *
 * So this file holds exactly two verbs — register and resolve — and the type it
 * stores is a declaration plus a function. There is no chaining, no dependency,
 * no `then`, no composition operator, and none of those are omissions to be
 * filled in later by somebody being helpful. A handler that needs a plan calls
 * the workflow engine, which HAS a plan, and which this folder may not import
 * precisely so that the call goes the right way round.
 *
 * ── REGISTRATION IS VALIDATED, AND THAT IS WHERE AUTHORITY BEGINS ─────────
 *
 * A declaration is an authority envelope — see `authority.ts` — so registering
 * one is the moment the platform learns what this kind of work may do. It is
 * checked here rather than at first execution, because a malformed declaration
 * discovered at execution time is discovered in production, on a job that has
 * already been accepted and durably stored.
 *
 * ── A DUPLICATE REGISTRATION IS REFUSED, NOT OVERWRITTEN ──────────────────
 *
 * Two modules registering `approval.expiry.sweep` is not a caller being
 * careless with a key; it is two pieces of code that each believe they own what
 * that work means. Last-write-wins would resolve it silently, in module import
 * order, and the behaviour would change when somebody reordered imports for an
 * unrelated reason.
 */

import {
  DURABLE_FAILURE,
  DurableRuntimeError,
  type JobHandler,
  type JobHandlerDeclaration,
  type RegisteredJobHandler,
} from './contracts.ts';
import { assertHandlerDeclaration } from './guards.ts';

export interface JobHandlerRegistry {
  register(declaration: JobHandlerDeclaration, handle: JobHandler): void;
  /** The handler, or undefined. Callers fail closed on undefined. */
  resolve(jobType: string): RegisteredJobHandler | undefined;
  /** The handler, or a typed refusal. The runtime's form. */
  require(jobType: string): RegisteredJobHandler;
  /** Every registered type, sorted. For the scheduler's claim filter. */
  jobTypes(): readonly string[];
  has(jobType: string): boolean;
}

export function createJobHandlerRegistry(): JobHandlerRegistry {
  const handlers = new Map<string, RegisteredJobHandler>();

  return {
    register(declaration, handle) {
      const checked = assertHandlerDeclaration(declaration);
      if (handlers.has(checked.jobType)) {
        throw new DurableRuntimeError(
          DURABLE_FAILURE.jobInvalid,
          'This kind of work is already registered.',
          `job type ${checked.jobType} is registered twice; two modules each believe ` +
            'they own what this work means',
        );
      }
      if (typeof handle !== 'function') {
        throw new DurableRuntimeError(
          DURABLE_FAILURE.jobInvalid,
          'This kind of work has no handler.',
          `job type ${checked.jobType} was registered without a function`,
        );
      }
      handlers.set(checked.jobType, { declaration: checked, handle });
    },

    resolve(jobType) {
      return handlers.get(jobType);
    },

    require(jobType) {
      const registered = handlers.get(jobType);
      if (!registered) {
        // FAIL CLOSED. A job whose type nothing has registered is not run with
        // an approximate handler and is not silently dropped — it goes to
        // dead-letter through the worker, where somebody can see it.
        throw new DurableRuntimeError(
          DURABLE_FAILURE.handlerMissing,
          'The platform does not know how to do this work.',
          `no handler is registered for job type ${jobType}`,
        );
      }
      return registered;
    },

    jobTypes() {
      return [...handlers.keys()].sort();
    },

    has(jobType) {
      return handlers.has(jobType);
    },
  };
}
