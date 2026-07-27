/**
 * Background scheduler — diagnostic domain (MCV2-S7.4-REMEDIATION · G1)
 *
 * The audited S7.4 shadow read attached its SQL work to the read path, so the
 * shadow read's latency and lifetime were coupled to the authoritative KV
 * response. This module decouples them: the shadow SQL read + compare +
 * telemetry are handed to a post-response scheduler and NEVER awaited by the
 * route.
 *
 * Strategy:
 *   1. Supabase Edge Functions expose `EdgeRuntime.waitUntil(promise)`, which
 *      keeps a background promise alive AFTER the HTTP response has been
 *      flushed. When available we use it — the shadow runs post-response and is
 *      guaranteed to complete (or time out) without extending response latency.
 *   2. Where `EdgeRuntime.waitUntil` is unavailable (Node tests, older
 *      runtimes, local dev), we fall back to a DETACHED promise: the task is
 *      started and its result/errors are swallowed, so it still runs off the
 *      response path.
 *
 * Invariants:
 *   - `schedule()` returns synchronously and never throws.
 *   - A scheduled task's rejection is always caught — shadow failures can never
 *     affect the KV response (the task is wrapped before it reaches the runtime).
 *
 * Pure/Node-testable: `EdgeRuntime` is read defensively from `globalThis` and a
 * `waitUntil` implementation may be injected for tests.
 */

import type { BackgroundScheduler } from './contracts.ts';

export type WaitUntil = (promise: Promise<unknown>) => void;

/**
 * Resolve the ambient `EdgeRuntime.waitUntil` (or a bare global `waitUntil`)
 * if the host provides one. Returns `null` when unavailable.
 */
export function resolveEdgeWaitUntil(): WaitUntil | null {
  const g = globalThis as {
    EdgeRuntime?: { waitUntil?: unknown };
    waitUntil?: unknown;
  };
  const edge = g.EdgeRuntime;
  if (edge && typeof edge.waitUntil === 'function') {
    const fn = edge.waitUntil as (p: Promise<unknown>) => void;
    return (p) => fn.call(edge, p);
  }
  if (typeof g.waitUntil === 'function') {
    const fn = g.waitUntil as (p: Promise<unknown>) => void;
    return (p) => fn(p);
  }
  return null;
}

function swallow(err: unknown): void {
  try {
    console.log('⚠️ shadow background task failed (ignored):', (err as Error)?.message ?? err);
  } catch {
    // ignore logging failure too
  }
}

/**
 * Create a background scheduler.
 *
 * @param waitUntil  Explicit waitUntil to use. Pass `undefined` to auto-detect
 *   the runtime `EdgeRuntime.waitUntil`; pass `null` to force the detached
 *   fallback (used by tests to exercise the fallback path).
 */
export function createBackgroundScheduler(waitUntil?: WaitUntil | null): BackgroundScheduler {
  const wu: WaitUntil | null = waitUntil === undefined ? resolveEdgeWaitUntil() : waitUntil;
  const strategy: BackgroundScheduler['strategy'] = wu ? 'edge_wait_until' : 'detached';

  return {
    strategy,
    schedule(task: () => Promise<unknown>): void {
      // Start the task on a microtask so a synchronous throw inside `task`
      // cannot escape into the response path, then swallow any rejection.
      const safe: Promise<void> = Promise.resolve()
        .then(task)
        .then(
          () => undefined,
          (err) => swallow(err),
        );

      if (wu) {
        try {
          wu(safe);
          return;
        } catch (err) {
          // If the runtime rejected the handoff, the task is still running
          // detached via `safe`; just note it and continue.
          swallow(err);
        }
      }
      // Detached fallback: `safe` is already executing; nothing to await.
      void safe;
    },
  };
}
