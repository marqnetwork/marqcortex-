/**
 * Adversarial fixtures for the AI administration suites.
 *
 * These exist because the administration tests that shipped with AI-01 Batch 2
 * all run against ONE control plane in ONE process. That is the right shape for
 * asserting what a change does, and it is structurally incapable of asserting
 * what happens when the platform is deployed the way it is actually deployed:
 * Supabase Edge Functions serve from several warm isolates, each holding its
 * own memoised plane and its own in-memory settings overlay, over one shared
 * durable store.
 *
 * Everything here supplies the missing dimension:
 *
 *   `buildIsolatePair`            two planes, one durable store — the shape a
 *                                 second isolate actually has.
 *   `createFailingSettingsStore`  durable storage that refuses writes, for
 *                                 asserting what the plane does when a save
 *                                 fails after the overlay has been touched.
 *   `createGatedSettingsStore`    durable storage whose first write blocks, so
 *                                 two administrators can be interleaved
 *                                 deterministically rather than hopefully.
 *
 * They are fixtures, not helpers with opinions: none of them assert anything,
 * and none of them reach into the plane. The suites do that.
 */

import type { AdminSettingsStore } from '../admin/settingsStore.ts';
import type { AIOperationalSettings } from '../runtime/operationalSettings.ts';
import type { TestAdministration, TestAdministrationOptions, TestPlane } from './harness.ts';

import { NO_STORED_VERSION, createMemorySettingsStore, settingsConflict } from '../admin/settingsStore.ts';
import { buildTestAdministration, narrativeInput } from './harness.ts';
import { AIError } from '../contracts/errors.ts';

/**
 * The store shape `buildTestAdministration` accepts. `saves` counts write
 * ATTEMPTS rather than successes, so a suite can tell "storage was asked" apart
 * from "storage agreed" — which is the whole question when a save fails.
 */
export interface ProbeSettingsStore extends AdminSettingsStore {
  readonly saves: number;
}

/**
 * Durable storage that is readable and refuses every write.
 *
 * Models the realistic failure — the key-value store answering reads, and
 * erroring on writes — rather than an unreachable one, because the interesting
 * question is what the plane is left running under once a write has been
 * attempted and rejected.
 *
 * `initial` seeds the read side, so a suite can put the plane into a known
 * posture (an engaged emergency stop, say) and then assert what happens when
 * the attempt to CHANGE that posture fails to persist. Without it only the
 * "change from baseline" direction is testable, and the dangerous direction is
 * the other one.
 */
export function createFailingSettingsStore(
  initial?: AIOperationalSettings,
  message = 'durable settings storage is unavailable',
): ProbeSettingsStore {
  let attempts = 0;
  return {
    load: () => Promise.resolve(initial),
    save: () => {
      attempts += 1;
      return Promise.reject(new Error(message));
    },
    get saves() {
      return attempts;
    },
  };
}

export interface GatedSettingsStore extends ProbeSettingsStore {
  /** Let the first blocked write complete. Safe to call more than once. */
  releaseFirstWrite(): void;
  /** Settings as durable storage currently holds them. */
  peek(): AIOperationalSettings | undefined;
}

/**
 * Durable storage whose FIRST write blocks until released.
 *
 * Two administrators racing is otherwise a matter of luck: the promise
 * scheduling that decides who reads before whom is not something a test should
 * depend on. Holding the first write open makes the interleaving explicit — the
 * second administrator is guaranteed to read and write while the first is still
 * in flight, which is exactly the window a compare-and-swap would close.
 */
export function createGatedSettingsStore(initial?: AIOperationalSettings): GatedSettingsStore {
  let stored = initial;
  let saves = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    load: () => Promise.resolve(stored),
    async save(settings, expectedVersion) {
      saves += 1;
      if (saves === 1) await gate;
      const actual = stored?.configurationVersion ?? NO_STORED_VERSION;
      if (actual !== expectedVersion) throw settingsConflict(expectedVersion, actual);
      stored = settings;
    },
    get saves() {
      return saves;
    },
    releaseFirstWrite() {
      release?.();
    },
    peek: () => stored,
  };
}

/**
 * Durable storage that records every version it is asked to persist.
 *
 * `configurationVersion` is meant to answer "which configuration was live when
 * this happened?". That claim is only worth anything if the numbers a platform
 * writes are distinct and increasing, which is a property of the SEQUENCE of
 * writes rather than of any one of them — so the sequence has to be captured.
 */
export interface RecordingSettingsStore extends ProbeSettingsStore {
  /** Every `configurationVersion` written, in write order. */
  readonly versions: readonly number[];
  peek(): AIOperationalSettings | undefined;
}

export function createRecordingSettingsStore(
  initial?: AIOperationalSettings,
): RecordingSettingsStore {
  let stored = initial;
  const versions: number[] = [];
  return {
    load: () => Promise.resolve(stored),
    save(settings, expectedVersion) {
      const actual = stored?.configurationVersion ?? NO_STORED_VERSION;
      if (actual !== expectedVersion) {
        return Promise.reject(settingsConflict(expectedVersion, actual));
      }
      versions.push(settings.configurationVersion);
      stored = settings;
      return Promise.resolve();
    },
    get saves() {
      return versions.length;
    },
    get versions() {
      return versions;
    },
    peek: () => stored,
  };
}

export interface IsolatePair {
  /** The isolate an administrator's request happens to land on. */
  readonly a: TestAdministration;
  /** A second warm isolate serving the same traffic. */
  readonly b: TestAdministration;
  readonly store: ProbeSettingsStore;
}

/**
 * Two independently assembled planes over ONE durable settings store, both
 * hydrated — the state a platform is in moments after a deploy, with more than
 * one warm isolate and nothing yet changed.
 *
 * Both are hydrated before the pair is returned, so any divergence a suite
 * observes afterwards was produced by the change under test rather than by one
 * isolate having started life out of step.
 */
export async function buildIsolatePair(
  options: TestAdministrationOptions = {},
): Promise<IsolatePair> {
  const store = options.settingsStore ?? createMemorySettingsStore();
  // Both planes read their settings back from the SAME durable record, which is
  // what makes them a second isolate rather than a second universe.
  const a = buildTestAdministration({ ...options, settingsStore: store });
  const b = buildTestAdministration({ ...options, settingsStore: store });
  await a.admin.hydrate();
  await b.admin.hydrate();
  return { a, b, store };
}

/** Whether a request was served, and if not, why the plane refused it. */
export type ExecutionProbe =
  | { readonly served: true; readonly requestId: string }
  | { readonly served: false; readonly code: string };

/**
 * Put one real AI request through a plane and classify the outcome.
 *
 * Deliberately does not throw: every suite below asks "did this plane serve
 * traffic?", and a helper that threw would make the negative case the awkward
 * one to write when it is the case that matters most.
 */
export async function executeNarrative(
  harness: TestPlane,
  token: string,
): Promise<ExecutionProbe> {
  try {
    const result = await harness.plane.execute(
      { featureId: 'cortex.narrative', input: narrativeInput() },
      { authorization: `Bearer ${token}` },
    );
    return { served: true, requestId: result.requestId };
  } catch (error) {
    return { served: false, code: error instanceof AIError ? error.code : 'UNKNOWN' };
  }
}
