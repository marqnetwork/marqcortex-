/**
 * Background scheduler tests — MCV2-S7.4-REMEDIATION (G1)
 *
 * Proves the shadow read is scheduled off the response path:
 *   - uses EdgeRuntime.waitUntil when available (never awaited inline)
 *   - falls back to a detached task when waitUntil is unavailable
 *   - schedule() returns synchronously (non-blocking)
 *   - a throwing/rejecting task never surfaces to the caller
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createBackgroundScheduler,
  resolveEdgeWaitUntil,
} from '../../supabase/functions/server/storage/index.ts';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('BackgroundScheduler (G1 non-blocking)', () => {
  it('hands the task to an injected waitUntil (edge strategy)', async () => {
    const captured: Promise<unknown>[] = [];
    const waitUntil = (p: Promise<unknown>) => {
      captured.push(p);
    };
    const scheduler = createBackgroundScheduler(waitUntil);
    assert.equal(scheduler.strategy, 'edge_wait_until');

    let ran = false;
    scheduler.schedule(async () => {
      ran = true;
    });

    // waitUntil received exactly one promise, and it was NOT awaited inline.
    assert.equal(captured.length, 1);
    await captured[0];
    assert.equal(ran, true);
  });

  it('schedule() returns synchronously without waiting for the task', async () => {
    const waitUntil = (_p: Promise<unknown>) => {};
    const scheduler = createBackgroundScheduler(waitUntil);

    let taskCompleted = false;
    scheduler.schedule(async () => {
      await tick();
      taskCompleted = true;
    });

    // Immediately after schedule() the task has not completed — proves the
    // response path is not blocked on shadow latency.
    assert.equal(taskCompleted, false);
  });

  it('falls back to a detached task when waitUntil is unavailable', async () => {
    const scheduler = createBackgroundScheduler(null);
    assert.equal(scheduler.strategy, 'detached');

    let ran = false;
    scheduler.schedule(async () => {
      ran = true;
    });
    await tick();
    assert.equal(ran, true);
  });

  it('never lets a rejecting task surface to the caller (edge strategy)', async () => {
    const captured: Promise<unknown>[] = [];
    const scheduler = createBackgroundScheduler((p) => captured.push(p));

    assert.doesNotThrow(() => {
      scheduler.schedule(async () => {
        throw new Error('shadow blew up');
      });
    });
    // The promise handed to waitUntil resolves (does not reject).
    await assert.doesNotReject(captured[0]);
  });

  it('never lets a synchronously-throwing task surface to the caller', async () => {
    const scheduler = createBackgroundScheduler(null);
    assert.doesNotThrow(() => {
      scheduler.schedule((() => {
        throw new Error('sync throw');
      }) as unknown as () => Promise<unknown>);
    });
    await tick();
  });

  it('auto-detects EdgeRuntime.waitUntil from globalThis', async () => {
    const g = globalThis as { EdgeRuntime?: unknown };
    const original = g.EdgeRuntime;
    const captured: Promise<unknown>[] = [];
    g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => captured.push(p) };
    try {
      assert.notEqual(resolveEdgeWaitUntil(), null);
      const scheduler = createBackgroundScheduler(); // auto-detect
      assert.equal(scheduler.strategy, 'edge_wait_until');
      scheduler.schedule(async () => {});
      assert.equal(captured.length, 1);
      await captured[0];
    } finally {
      g.EdgeRuntime = original;
    }
  });

  it('reports detached strategy when no runtime waitUntil exists', () => {
    const g = globalThis as { EdgeRuntime?: unknown; waitUntil?: unknown };
    const originalEdge = g.EdgeRuntime;
    const originalWu = g.waitUntil;
    delete g.EdgeRuntime;
    delete g.waitUntil;
    try {
      assert.equal(resolveEdgeWaitUntil(), null);
      assert.equal(createBackgroundScheduler().strategy, 'detached');
    } finally {
      if (originalEdge !== undefined) g.EdgeRuntime = originalEdge;
      if (originalWu !== undefined) g.waitUntil = originalWu;
    }
  });
});
