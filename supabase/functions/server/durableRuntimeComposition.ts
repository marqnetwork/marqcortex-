/**
 * The durable runtime, composed for the real server (BP-002 §5, correction pass).
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * Without it, BP-002 shipped a library and a test suite. Every guarantee was
 * real and none of them was reachable: nothing in the deployed server built a
 * `DurableSqlGateway`, nothing registered the approval-expiry handler, and the
 * only place the pilot ran was a harness. A durable runtime that no deployment
 * instantiates is a durable runtime that does not exist.
 *
 * ── WHY IT IS HERE AND NOT IN `platform/durable/` ─────────────────────────
 *
 * That folder may not hold a Supabase client, `Deno.env` or a network call —
 * the boundary scan asserts it imports nothing but `../authority/index.ts`, and
 * that claim is what makes "the AI subsystem adapts onto the foundation" a
 * structural fact rather than a convention. So the client lives out here, at
 * the server level, beside the other composition this file's neighbours do, and
 * it is handed in through the four-verb `DurableSqlGateway` port.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────
 *
 * NO CRON, NO TIMER, NO SELF-INVOCATION. BP-002 §10 draws the line: implement
 * the scheduler runtime, do not configure production cron. `tick()` is a
 * function the existing environment can call when a deployment is authorized to
 * run it. Nothing in this repository calls it on a schedule, and the boundary
 * scan asserts no server file uses `Deno.cron`, `setInterval` or `setTimeout`.
 *
 * NO PUBLIC HTTP ROUTE. An unauthenticated endpoint that drains a tenant's
 * queue is a denial-of-service surface and an authority bypass — it would let
 * anybody who can reach the URL decide when consequential background work runs.
 * The tick is an INTERNAL SERVICE, exported for a caller that already has the
 * server's own trust. Adding an operator route is a real requirement and a real
 * security surface, and it belongs in a packet that is scoped to design it.
 *
 * BUILT ONCE PER ISOLATE, AT STARTUP, AND MEMOISED — and the earlier version of
 * this comment claimed otherwise. It said "no eager construction ... built on
 * first use", while `index.tsx` calls `getDurableRuntime()` during module
 * initialisation. Both halves cannot be true, and the code was right: the
 * server composes this at boot.
 *
 * Composing at boot is the intended behaviour, not an oversight to be made
 * lazy. A missing service key or an unavailable workflow runtime then shows up
 * in the startup log, once, where somebody is looking — rather than on the
 * first tick, which in a deployment that has not enabled background work yet
 * may be never. A misconfiguration nobody discovers is the failure mode this
 * packet spent five defects learning to avoid.
 *
 * What the memoisation IS for: one client and one worker identity per isolate,
 * however many times the runtime is asked for afterwards. `getDurableRuntime()`
 * is safe to call from anywhere and will not open a second connection.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

import { createSupabaseDurableGateway } from './durableSqlGateway.ts';
import {
  createEventDispatcher,
  createIdempotentConsumer,
  createJobHandlerRegistry,
  createJobWorker,
  createPostgresDurableStores,
  createScheduler,
  durableRuntimeSnapshot,
  type DurableAuditEntry,
  type DurableRuntimeSnapshot,
  type DurableStores,
  type EventSubscriber,
  type JobHandlerRegistry,
  type JobWorker,
  type Scheduler,
  type SchedulerTickResult,
} from './platform/durable/index.ts';
import { getWorkflowRuntime } from './ai/index.ts';
import {
  APPROVAL_EXPIRED_EVENT,
  APPROVAL_EXPIRY_DECLARATION,
  approvalExpiryScheduleInput,
  createApprovalExpirySweep,
} from './ai/workflows/durable/approvalExpirySweep.ts';

/** Everything a caller needs to drive background work, composed once. */
export interface DurableRuntime {
  readonly stores: DurableStores;
  readonly registry: JobHandlerRegistry;
  readonly worker: JobWorker;
  readonly scheduler: Scheduler;
  /**
   * One pass for one organization.
   *
   * Recovery, then due occurrences, then the queue, then the outbox — the order
   * `scheduler.ts` explains. Safe to call repeatedly and safe to call twice at
   * once: every duplicate guard is in the database.
   */
  tick(organizationId: string): Promise<SchedulerTickResult>;
  /** Install the pilot's recurring schedule for one organization. */
  ensureApprovalExpirySchedule(organizationId: string, nextRunAt?: string): Promise<void>;
  snapshot(organizationId: string): Promise<DurableRuntimeSnapshot>;
  /** What this composition actually registered, for the operational log. */
  readonly registeredJobTypes: readonly string[];
}

let runtime: DurableRuntime | undefined;
let unavailableReason: string | undefined;

/**
 * The durable runtime for this deployment, or `undefined` with a reason.
 *
 * THREE THINGS MUST ALL BE TRUE, and any one missing means NOTHING is composed
 * and the reason is said out loud — the same shape `bootstrap.ts` uses for the
 * diagnostic capability, for the same reason. A half-composed runtime that
 * claims jobs and cannot run their handler is worse than one that plainly did
 * not start.
 *
 *   Supabase service credentials   the durable state is in Postgres and the
 *                                  runtime writes it as the service role
 *   the workflow runtime           the pilot calls its approval gate; without
 *                                  it there is nothing to register
 *   nothing already built          memoised, so an isolate opens one client
 *                                  and carries one worker identity, however
 *                                  many callers ask for the runtime
 */
export function getDurableRuntime(): DurableRuntime | undefined {
  if (runtime) return runtime;

  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    unavailableReason =
      'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured — durable background ' +
      'work has nowhere durable to live and is NOT composed';
    console.error(`[durable] ${unavailableReason}`);
    return undefined;
  }

  const workflows = getWorkflowRuntime();
  if (!workflows) {
    unavailableReason =
      'the workflow runtime is unavailable — the A1 approval-expiry pilot has no approval ' +
      'gate to sweep and the durable runtime is NOT composed';
    console.error(`[durable] ${unavailableReason}`);
    return undefined;
  }

  const client = createClient(url, key);
  const gateway = createSupabaseDurableGateway(
    client as unknown as Parameters<typeof createSupabaseDurableGateway>[0],
  );
  const stores = createPostgresDurableStores(gateway);
  const registry = createJobHandlerRegistry();

  // ── The A1 pilot, in the REAL composition ──────────────────────────────
  //
  // The same handler the tests drive, over the same approval gate the operator
  // surface and the workflow engine use. Not a second gate: `workflows.approvals`
  // is the one there is, and a second would be a second answer to "is this
  // approval still pending".
  registry.register(
    APPROVAL_EXPIRY_DECLARATION,
    createApprovalExpirySweep({
      gate: workflows.approvals,
      newEventId: () => crypto.randomUUID(),
    }),
  );

  const audit = {
    record(entry: DurableAuditEntry) {
      // Reuses the existing operational log rather than opening a parallel
      // audit store — BP-002 §13. The authority decision is already projected
      // into the shape the existing writers accept.
      const detail = entry.authority?.['authority.decision'];
      console.log(
        `[durable] ${entry.jobType} ${entry.outcome}` +
          ` job=${entry.jobId} org=${entry.organizationId} attempt=${entry.attempt}` +
          ` correlation=${entry.correlationId}` +
          (detail ? ` authority=${String(detail)}` : '') +
          (entry.failureCode ? ` failure=${entry.failureCode}` : '') +
          (entry.eventIds.length > 0 ? ` events=${entry.eventIds.length}` : ''),
      );
    },
  };

  const workerId = `edge:${crypto.randomUUID().slice(0, 8)}`;

  const worker = createJobWorker({
    store: stores.jobs,
    registry,
    nowIso: () => new Date().toISOString(),
    workerId,
    audit,
  });

  // ── Subscribers ─────────────────────────────────────────────────────────
  //
  // ONE, and it only records. The pilot's event says an approval expired; the
  // workflow engine already reaches that conclusion by itself when the run is
  // next advanced, so a consumer that acted on it would be a second path to the
  // same state change. What this proves is the delivery contract — durable,
  // leased, idempotent — without inventing a downstream effect to demonstrate it.
  const subscribers: readonly EventSubscriber[] = [
    createIdempotentConsumer({
      inbox: stores.inbox,
      consumerKey: 'platform.approval_expiry.log',
      eventTypes: [APPROVAL_EXPIRED_EVENT],
      handle: async (event) => {
        console.log(
          `[durable] ${event.eventType} approval=${String(event.entityId)}` +
            ` org=${event.organizationId} correlation=${event.correlationId}`,
        );
        return { logged: true };
      },
      nowIso: () => new Date().toISOString(),
      workerId,
    }),
  ];

  const dispatcher = createEventDispatcher({
    outbox: stores.outbox,
    subscribers,
    nowIso: () => new Date().toISOString(),
    workerId,
  });

  const scheduler = createScheduler({
    stores,
    worker,
    dispatcher,
    nowIso: () => new Date().toISOString(),
  });

  runtime = {
    stores,
    registry,
    worker,
    scheduler,
    tick: (organizationId) => scheduler.tick(organizationId),
    async ensureApprovalExpirySchedule(organizationId, nextRunAt) {
      await stores.schedules.upsert(
        approvalExpiryScheduleInput({
          organizationId,
          correlationId: `approval-expiry:${organizationId}`,
          nextRunAt: nextRunAt ?? new Date().toISOString(),
        }),
        new Date().toISOString(),
      );
    },
    snapshot: (organizationId) =>
      durableRuntimeSnapshot(stores, organizationId, new Date().toISOString()),
    registeredJobTypes: registry.jobTypes(),
  };

  console.log(
    `[durable] runtime composed: worker=${workerId} handlers=[${registry.jobTypes().join(', ')}] ` +
      '— no schedule is configured and nothing runs until tick() is called',
  );
  return runtime;
}

/** Why the runtime is unavailable, when it is. For the health surface. */
export function durableRuntimeUnavailableReason(): string | undefined {
  return runtime ? undefined : unavailableReason;
}

/** Drop the memoised runtime. Tests and a re-bootstrap use this. */
export function resetDurableRuntime(): void {
  runtime = undefined;
  unavailableReason = undefined;
}
