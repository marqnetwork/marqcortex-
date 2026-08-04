/**
 * The durable admin settings store: canonical normalisation and atomic CAS.
 *
 * These run against the REAL `createKvAdminSettingsStore` — the adapter
 * production uses — over a key-value fake that models the storage layer
 * faithfully in the two respects that matter:
 *
 *   Encoding    values are stored the way `index.tsx` stores them, as a JSON
 *               STRING inside a JSONB column, so the adapter's own decoding is
 *               exercised rather than bypassed.
 *
 *   Atomicity   `compareAndSwap` compares and writes with no suspension point
 *               in between, which is what the `kv_compare_and_swap` SQL
 *               function guarantees by being a single statement. A fake that
 *               awaited between the two would be modelling the defect this
 *               replaced, not the fix.
 *
 * The SQL function itself is not executed here — no PostgreSQL in this
 * environment — so what these tests pin is that the ADAPTER delegates to one
 * conditional operation and never reads before writing. The atomicity of the
 * statement is a property of the database, established by construction in
 * migration 20260803120000.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createKvAdminSettingsStore } from '../adapters/kvAdminStores.ts';
import { AIError } from '../contracts/errors.ts';
import { loadControlPlaneConfig } from '../runtime/config.ts';
import { recordEnv } from '../runtime/env.ts';
import { NO_STORED_VERSION } from '../admin/settingsStore.ts';
import type { AIOperationalSettings } from '../runtime/operationalSettings.ts';

const AT = '2026-08-03T00:00:00.000Z';
const KEY = 'ai:admin:settings';

/**
 * A key-value fake with the encoding and the atomicity of the real thing.
 *
 * `reads` is counted so a test can assert the adapter performs NO read while
 * saving — the previous implementation read, compared, then wrote, and that gap
 * was the whole defect.
 */
function kvFake(seed?: unknown) {
  const rows = new Map<string, string>();
  if (seed !== undefined) rows.set(KEY, JSON.stringify(seed));
  const state = {
    rows,
    reads: 0,
    writes: 0,
    read: (key: string): Promise<unknown> => {
      state.reads += 1;
      return Promise.resolve(rows.get(key));
    },
    write: (key: string, value: unknown): Promise<void> => {
      state.writes += 1;
      rows.set(key, JSON.stringify(value));
      return Promise.resolve();
    },
    /** One indivisible operation, exactly as the SQL statement is. */
    compareAndSwap: (key: string, expected: number, value: unknown): Promise<boolean> => {
      const current = rows.get(key);
      const version =
        current === undefined
          ? NO_STORED_VERSION
          : ((JSON.parse(current) as { configurationVersion?: number }).configurationVersion ??
            NO_STORED_VERSION);
      if (version !== expected) return Promise.resolve(false);
      rows.set(key, JSON.stringify(value));
      return Promise.resolve(true);
    },
    stored: (): Record<string, unknown> | undefined => {
      const raw = rows.get(KEY);
      return raw === undefined ? undefined : (JSON.parse(raw) as Record<string, unknown>);
    },
  };
  return state;
}

function storeOver(kv: ReturnType<typeof kvFake>, env: Record<string, string> = {}) {
  const corrupt: string[] = [];
  const store = createKvAdminSettingsStore({
    read: kv.read,
    write: kv.write,
    compareAndSwap: kv.compareAndSwap,
    config: loadControlPlaneConfig(recordEnv(env)),
    now: () => AT,
    onCorrupt: (detail) => corrupt.push(detail),
  });
  return { store, corrupt };
}

// ── Canonical normalisation on the load path ────────────────────────────────

describe('durable settings store — one canonical read path', () => {
  it('clamps an out-of-bounds retry curve on the way in', async () => {
    const kv = kvFake({
      configurationVersion: 9,
      retry: { baseDelayMs: 999_999, maxDelayMs: 999_999, jitterPercent: 999 },
    });
    const { store } = storeOver(kv);
    const loaded = await store.load();
    assert.ok(loaded);
    if (!loaded) return;
    assert.equal(loaded.retry.baseDelayMs, 10_000);
    assert.equal(loaded.retry.maxDelayMs, 60_000);
    assert.equal(loaded.retry.jitterPercent, 100);
  });

  it('drops malformed provider and model identifiers', async () => {
    const kv = kvFake({
      configurationVersion: 9,
      providerPreference: ['primary', 'not a valid id!', 'backup'],
      defaultProviderId: 'also not valid!',
      defaultModelId: 'still not valid!',
      providers: { 'bad id!': { enabled: false }, primary: { enabled: false } },
    });
    const { store } = storeOver(kv);
    const loaded = await store.load();
    assert.ok(loaded);
    if (!loaded) return;
    assert.deepEqual([...loaded.providerPreference], ['primary', 'backup']);
    assert.equal(loaded.defaultProviderId, undefined);
    assert.equal(loaded.defaultModelId, undefined);
    assert.deepEqual(Object.keys(loaded.providers), ['primary']);
  });

  it('treats an unreadable record as nothing stored, and says so', async () => {
    const kv = kvFake();
    kv.rows.set(KEY, '{ not json');
    const { store, corrupt } = storeOver(kv);
    assert.equal(await store.load(), undefined);
    assert.equal(corrupt.length, 1);
  });

  it('narrows a stored record to the deployment envelope', async () => {
    const kv = kvFake({
      configurationVersion: 9,
      realRequestsEnabled: true,
      requireCertifiedProviders: false,
      budget: { enforce: false, organizationDailyMicroUsd: 99_000_000_000 },
      timeout: { workflowDeadlineMs: 600_000 },
    });
    const { store } = storeOver(kv, {
      AI_ALLOW_REAL_REQUESTS: 'false',
      AI_REQUIRE_CERTIFIED_PROVIDERS: 'true',
      AI_BUDGET_ENFORCE: 'true',
      AI_BUDGET_ORG_DAILY_MICRO_USD: '1000',
      AI_WORKFLOW_DEADLINE_MS: '30000',
    });
    const loaded = await store.load();
    assert.ok(loaded);
    if (!loaded) return;
    assert.equal(loaded.realRequestsEnabled, false);
    assert.equal(loaded.requireCertifiedProviders, true);
    assert.equal(loaded.budget.enforce, true);
    assert.equal(loaded.budget.organizationDailyMicroUsd, 1000);
    assert.equal(loaded.timeout.workflowDeadlineMs, 30_000);
  });

  it('decodes a record stored as a JSON string, the way production writes it', async () => {
    // `kvWrite` stores JSON.stringify(value) into a JSONB column, so a record
    // arrives as a string. A store that only handled objects would silently see
    // nothing stored and reset the platform to baseline on every boot.
    const kv = kvFake({ configurationVersion: 4, aiEnabled: false });
    const { store } = storeOver(kv);
    const loaded = await store.load();
    assert.equal(loaded?.aiEnabled, false);
    assert.equal(loaded?.configurationVersion, 4);
  });
});

// ── Atomic compare-and-swap ─────────────────────────────────────────────────

describe('durable settings store — atomic compare-and-swap', () => {
  const record = (version: number, marker: string): AIOperationalSettings =>
    ({ configurationVersion: version, updatedReason: marker }) as AIOperationalSettings;

  it('performs NO read while saving — there is no window to lose a race in', async () => {
    const kv = kvFake({ configurationVersion: 5 });
    const { store } = storeOver(kv);
    const before = kv.reads;
    await store.save(record(6, 'A'), 5);
    assert.equal(kv.reads - before, 0, 'a read during save is a time-of-check-to-time-of-use gap');
  });

  it('lets exactly one of two writers at the same expected version win', async () => {
    const kv = kvFake({ configurationVersion: 5, updatedReason: 'original' });
    const { store } = storeOver(kv);

    const outcomes = await Promise.all([
      store.save(record(6, 'A-kill-switch'), 5).then(() => 'accepted').catch((e: unknown) => e),
      store.save(record(6, 'B-retry-tune'), 5).then(() => 'accepted').catch((e: unknown) => e),
    ]);

    const accepted = outcomes.filter((o) => o === 'accepted');
    const conflicted = outcomes.filter((o) => o instanceof AIError && o.code === 'CONFLICT');
    assert.equal(accepted.length, 1, 'exactly one writer must win');
    assert.equal(conflicted.length, 1, 'the loser must get a typed CONFLICT');

    // The durable record is the winner's, whole — not a blend, and not the
    // loser's overwriting it.
    const stored = kv.stored();
    assert.equal(stored?.configurationVersion, 6);
    assert.ok(['A-kill-switch', 'B-retry-tune'].includes(stored?.updatedReason as string));
  });

  it('gives the loser a 409 the caller can act on', async () => {
    const kv = kvFake({ configurationVersion: 5 });
    const { store } = storeOver(kv);
    await store.save(record(6, 'winner'), 5);
    const error = await store.save(record(6, 'loser'), 5).then(() => undefined).catch((e: unknown) => e);
    assert.ok(error instanceof AIError);
    if (!(error instanceof AIError)) return;
    assert.equal(error.code, 'CONFLICT');
    assert.equal(error.status, 409);
  });

  it('claims an empty key exactly once', async () => {
    const kv = kvFake();
    const { store } = storeOver(kv);
    const outcomes = await Promise.all([
      store.save(record(1, 'A'), NO_STORED_VERSION).then(() => 'accepted').catch(() => 'CONFLICT'),
      store.save(record(1, 'B'), NO_STORED_VERSION).then(() => 'accepted').catch(() => 'CONFLICT'),
    ]);
    assert.equal(outcomes.filter((o) => o === 'accepted').length, 1);
    assert.equal(outcomes.filter((o) => o === 'CONFLICT').length, 1);
  });

  it('never lets two different configurations share one version', async () => {
    const kv = kvFake({ configurationVersion: 1 });
    const { store } = storeOver(kv);
    const written: { version: number; marker: string }[] = [];

    for (let round = 0; round < 6; round += 1) {
      const current = kv.stored()?.configurationVersion as number;
      const results = await Promise.allSettled([
        store.save(record(current + 1, `r${round}-A`), current),
        store.save(record(current + 1, `r${round}-B`), current),
      ]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      const stored = kv.stored();
      written.push({
        version: stored?.configurationVersion as number,
        marker: stored?.updatedReason as string,
      });
    }

    const versions = written.map((w) => w.version);
    assert.equal(new Set(versions).size, versions.length, `duplicate version: ${versions.join(',')}`);
    for (let i = 1; i < versions.length; i += 1) {
      assert.ok(versions[i] > versions[i - 1], `not monotonic: ${versions.join(' -> ')}`);
    }
  });
});
