/**
 * Shared fixtures for the BP-002 durable runtime suites.
 *
 * DELIBERATELY BORING, for the reason `authorityEvaluator.test.ts` gives: every
 * assertion in these suites is about a single rule, and a fixture rich enough to
 * be interesting is a fixture rich enough to make a passing test ambiguous about
 * WHICH rule passed it.
 *
 * The clock is the repository's own `createTestClock` shape rather than
 * `Date.now`, so every deadline, backoff and lease expiry in these suites is a
 * value the test set — no sleeps, no flakes, and a lease expiry is tested by
 * moving time rather than by waiting for it.
 */

import {
  createJobHandlerRegistry,
  createJobWorker,
  createMemoryDurableStores,
  type DurableAuditEntry,
  type JobActorContext,
  type JobHandler,
  type JobHandlerDeclaration,
  type JobWorker,
} from '../index.ts';

export const ORG = '11111111-1111-4111-8111-111111111111';
export const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
export const START_MS = Date.UTC(2026, 8, 18, 12, 0, 0);

export interface TestClock {
  nowIso(): string;
  nowMs(): number;
  advance(ms: number): void;
  set(ms: number): void;
}

export function createTestClock(startMs = START_MS): TestClock {
  let current = startMs;
  return {
    nowIso: () => new Date(current).toISOString(),
    nowMs: () => current,
    advance: (ms) => {
      current += ms;
    },
    set: (ms) => {
      current = ms;
    },
  };
}

/** A service actor for `ORG`. Never a human — the runtime refuses one. */
export function serviceActor(
  organizationId = ORG,
  permissions: readonly string[] = ['job.run'],
): JobActorContext {
  return {
    actorId: 'service:test',
    actorType: 'service',
    organizationId,
    permissions,
  };
}

/**
 * A declaration for work that changes nothing.
 *
 * `consequential: false` is legitimate here precisely because
 * `requestedEffect` is `read` — `assertHandlerDeclaration` refuses the
 * combination that would matter.
 */
export const READ_ONLY_DECLARATION: JobHandlerDeclaration = {
  jobType: 'test.read',
  actionType: 'test.read',
  resourceType: 'test.resource',
  requiredPermission: 'job.run',
  requestedEffect: 'read',
  dataClassification: 'internal',
  reversible: true,
  consequenceCeiling: 'low',
  consequential: false,
};

/** A declaration for work that writes, and is therefore governed. */
export const WRITING_DECLARATION: JobHandlerDeclaration = {
  jobType: 'test.write',
  actionType: 'test.write',
  resourceType: 'test.resource',
  requiredPermission: 'job.run',
  requestedEffect: 'write',
  dataClassification: 'internal',
  reversible: true,
  consequenceCeiling: 'high',
  consequential: true,
};

export interface Harness {
  readonly stores: ReturnType<typeof createMemoryDurableStores>;
  readonly registry: ReturnType<typeof createJobHandlerRegistry>;
  readonly clock: TestClock;
  readonly audit: DurableAuditEntry[];
  worker(workerId: string): JobWorker;
  register(declaration: JobHandlerDeclaration, handle: JobHandler): void;
}

export function createHarness(clock: TestClock = createTestClock()): Harness {
  const stores = createMemoryDurableStores();
  const registry = createJobHandlerRegistry();
  const audit: DurableAuditEntry[] = [];

  return {
    stores,
    registry,
    clock,
    audit,
    worker(workerId) {
      return createJobWorker({
        store: stores.jobs,
        registry,
        nowIso: () => clock.nowIso(),
        workerId,
        audit: { record: (entry) => audit.push(entry) },
      });
    },
    register(declaration, handle) {
      registry.register(declaration, handle);
    },
  };
}
