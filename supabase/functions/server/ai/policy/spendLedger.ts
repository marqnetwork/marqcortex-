/**
 * Durable spend ledger — the hard MARQ-funded ceiling.
 *
 * This is a different instrument from the rolling daily budget in `budget.ts`,
 * and the difference is the whole point:
 *
 *   budget.ts    Rolling per-organization and per-actor windows. They reset by
 *                design, because a tenant's daily allowance is meant to renew.
 *
 *   this module  A LIFETIME ceiling on money MARQ itself is spending with
 *                model vendors. It never resets on a timer. When the platform
 *                has spent $9, it stops spending, and the only way it starts
 *                again is an explicit, authorised, audited action.
 *
 * Three properties the daily budget deliberately does not have:
 *
 *   Reserve-then-settle. An AI call's true cost is unknown until the provider
 *   reports token usage, so a check-then-charge ledger admits a request on the
 *   strength of spend that has already been *recorded* — which means N requests
 *   in flight at the ceiling all pass, and the cap is breached by N-1 calls.
 *   Here the estimate is reserved BEFORE the provider is reached and settled to
 *   the measured cost afterwards, so concurrent requests contend for the same
 *   headroom. A reservation that is never settled is released, not leaked.
 *
 *   Durability through a port. Module memory is not the authority. The ledger
 *   is an interface with an in-memory implementation for tests and single-node
 *   runs, and a key-value implementation (`../adapters/kvSpendStore.ts`) that
 *   survives isolate recycling. An edge isolate that restarts mid-day must not
 *   rediscover a $0 balance.
 *
 *   Failed calls still cost. A provider attempt that times out after the model
 *   generated tokens is billable, and a ledger that only charges successes
 *   under-counts exactly when spend is running away. Every attempt with known
 *   usage settles; an attempt whose usage is unknown settles at its estimate.
 *
 * CONCURRENCY. Reservations are serialised per scope inside one runtime through
 * an async mutex, so `reserve` is exact within a process. Across processes the
 * key-value backend has no compare-and-swap, so two isolates can each reserve
 * against the same read. The overshoot is bounded by (isolates × one estimate)
 * — cents, not dollars — and is documented rather than hidden. Closing it fully
 * requires an atomic counter in the storage layer, which is called out in the
 * remediation report as a known limitation rather than claimed as solved.
 */

/** One reset event. Retained on the record so the cap has a history. */
export interface SpendResetEvent {
  readonly at: string;
  /** Actor who authorised the reset. Never a system default. */
  readonly authorizedBy: string;
  readonly reason: string;
  readonly clearedMicroUsd: number;
  readonly previousCapMicroUsd: number;
  readonly newCapMicroUsd: number;
}

export interface SpendRecord {
  readonly scope: string;
  /** Settled spend. Only ever increases, except through an authorised reset. */
  readonly spentMicroUsd: number;
  /** Held for in-flight requests. Released or settled, never abandoned. */
  readonly reservedMicroUsd: number;
  readonly capMicroUsd: number;
  /** Billable provider attempts settled against this scope. */
  readonly attemptCount: number;
  readonly updatedAt: string;
  readonly resets: readonly SpendResetEvent[];
}

/** Money that is spoken for: settled plus in flight. */
export function committedMicroUsd(record: SpendRecord): number {
  return record.spentMicroUsd + record.reservedMicroUsd;
}

export function remainingMicroUsd(record: SpendRecord): number {
  return Math.max(0, record.capMicroUsd - committedMicroUsd(record));
}

export interface SpendReservation {
  readonly reservationId: string;
  readonly scope: string;
  readonly reservedMicroUsd: number;
}

export type SpendDenialReason = 'cap_reached' | 'insufficient_headroom';

export interface SpendGranted {
  readonly granted: true;
  readonly reservation: SpendReservation;
  readonly record: SpendRecord;
}

export interface SpendDenied {
  readonly granted: false;
  readonly reason: SpendDenialReason;
  readonly record: SpendRecord;
}

export type SpendDecision = SpendGranted | SpendDenied;

/**
 * Narrow a decision to its denial.
 *
 * A user-defined type guard rather than a bare `!decision.granted`, because
 * discriminating a union on a boolean literal needs `strictNullChecks`, and the
 * repository's Node/test boundary (`tsconfig.node.json`) does not enable it.
 * The guard narrows correctly under every configuration this code is compiled
 * by, which is preferable to a suppression comment or to the same logic being
 * type-safe in one toolchain and unchecked in another.
 */
export function isSpendDenied(decision: SpendDecision): decision is SpendDenied {
  return decision.granted === false;
}

/** Narrow a decision to its grant. See `isSpendDenied` for why this exists. */
export function isSpendGranted(decision: SpendDecision): decision is SpendGranted {
  return decision.granted === true;
}

/**
 * Storage port. Deliberately narrow: read the whole record, write the whole
 * record. A wider interface would tempt a caller into a read-modify-write it
 * does not hold the lock for.
 */
export interface SpendStore {
  load(scope: string): Promise<SpendRecord | undefined>;
  save(record: SpendRecord): Promise<void>;
}

export interface SpendLedger {
  /** Current state, without reserving anything. */
  read(scope: string): Promise<SpendRecord>;
  /**
   * Reserve `estimateMicroUsd` against the cap. Granted only when the estimate
   * fits in the remaining headroom — a request projected to cross the ceiling
   * is refused before it reaches a provider, not after.
   */
  reserve(scope: string, estimateMicroUsd: number, reservationId: string): Promise<SpendDecision>;
  /** Convert a reservation into settled spend at the measured cost. */
  settle(reservation: SpendReservation, actualMicroUsd: number): Promise<SpendRecord>;
  /** Give a reservation back. Used when nothing billable happened. */
  release(reservation: SpendReservation): Promise<SpendRecord>;
  /**
   * Clear settled spend and optionally raise the cap. Requires an authorising
   * actor and a reason — there is no unattributed reset, and no timer that
   * performs one.
   */
  reset(
    scope: string,
    options: { authorizedBy: string; reason: string; newCapMicroUsd?: number },
  ): Promise<SpendRecord>;
}

export interface SpendLedgerOptions {
  readonly store: SpendStore;
  readonly capMicroUsd: number;
  readonly now: () => string;
  /** Reset events retained per scope. Bounded so a record cannot grow forever. */
  readonly maxResetHistory?: number;
}

const DEFAULT_MAX_RESET_HISTORY = 20;

function emptyRecord(scope: string, capMicroUsd: number, at: string): SpendRecord {
  return {
    scope,
    spentMicroUsd: 0,
    reservedMicroUsd: 0,
    capMicroUsd,
    attemptCount: 0,
    updatedAt: at,
    resets: [],
  };
}

export function createSpendLedger(options: SpendLedgerOptions): SpendLedger {
  const { store, now } = options;
  const maxResetHistory = options.maxResetHistory ?? DEFAULT_MAX_RESET_HISTORY;

  /**
   * Per-scope serialisation. Every mutation runs inside `withLock`, so a
   * read-modify-write cannot interleave with another within this runtime. The
   * chain is per scope, not global: two organizations do not block each other.
   */
  const locks = new Map<string, Promise<unknown>>();

  function withLock<T>(scope: string, work: () => Promise<T>): Promise<T> {
    const previous = locks.get(scope) ?? Promise.resolve();
    // `catch` on the tail keeps one failed mutation from poisoning the chain
    // for every later caller on the same scope.
    const next = previous.then(work, work);
    locks.set(
      scope,
      next.catch(() => undefined),
    );
    return next;
  }

  /** Load, defaulting a missing record and re-stamping the configured cap. */
  async function current(scope: string): Promise<SpendRecord> {
    const stored = await store.load(scope);
    if (!stored) return emptyRecord(scope, options.capMicroUsd, now());
    // The configured cap wins over a stored one unless a reset explicitly
    // raised it: an operator lowering AI_MAX_SPEND_USD must take effect on the
    // next request, not be overridden by a value persisted days ago.
    const raisedByReset = stored.resets.at(-1)?.newCapMicroUsd;
    const capMicroUsd =
      raisedByReset !== undefined && raisedByReset === stored.capMicroUsd
        ? stored.capMicroUsd
        : options.capMicroUsd;
    return { ...stored, capMicroUsd };
  }

  /** Reservation ids seen per scope, so a double settle cannot double charge. */
  const openReservations = new Map<string, number>();

  return {
    read: (scope) => withLock(scope, () => current(scope)),

    reserve(scope, estimateMicroUsd, reservationId) {
      const estimate = Math.max(0, Math.round(estimateMicroUsd));
      return withLock(scope, async () => {
        const record = await current(scope);

        // A cap of 0 means "no ceiling configured" only where that is the
        // documented meaning; here 0 is a real ceiling — the platform is not
        // permitted to spend. Treat it as such.
        if (committedMicroUsd(record) >= record.capMicroUsd) {
          return { granted: false as const, reason: 'cap_reached' as const, record };
        }
        if (committedMicroUsd(record) + estimate > record.capMicroUsd) {
          return { granted: false as const, reason: 'insufficient_headroom' as const, record };
        }

        const updated: SpendRecord = {
          ...record,
          reservedMicroUsd: record.reservedMicroUsd + estimate,
          updatedAt: now(),
        };
        await store.save(updated);
        openReservations.set(`${scope}:${reservationId}`, estimate);

        return {
          granted: true as const,
          reservation: { reservationId, scope, reservedMicroUsd: estimate },
          record: updated,
        };
      });
    },

    settle(reservation, actualMicroUsd) {
      const actual = Math.max(0, Math.round(actualMicroUsd));
      return withLock(reservation.scope, async () => {
        const key = `${reservation.scope}:${reservation.reservationId}`;
        const held = openReservations.get(key);
        const record = await current(reservation.scope);
        if (held === undefined) {
          // Already settled or released. Settling again would double charge, so
          // this is a no-op that returns the current truth.
          return record;
        }
        openReservations.delete(key);

        const updated: SpendRecord = {
          ...record,
          spentMicroUsd: record.spentMicroUsd + actual,
          reservedMicroUsd: Math.max(0, record.reservedMicroUsd - held),
          attemptCount: record.attemptCount + 1,
          updatedAt: now(),
        };
        await store.save(updated);
        return updated;
      });
    },

    release(reservation) {
      return withLock(reservation.scope, async () => {
        const key = `${reservation.scope}:${reservation.reservationId}`;
        const held = openReservations.get(key);
        const record = await current(reservation.scope);
        if (held === undefined) return record;
        openReservations.delete(key);

        const updated: SpendRecord = {
          ...record,
          reservedMicroUsd: Math.max(0, record.reservedMicroUsd - held),
          updatedAt: now(),
        };
        await store.save(updated);
        return updated;
      });
    },

    reset(scope, resetOptions) {
      const authorizedBy = resetOptions.authorizedBy.trim();
      const reason = resetOptions.reason.trim();
      if (authorizedBy === '' || reason === '') {
        // Refusing an unattributed reset is the control. A reset without an
        // actor and a reason is indistinguishable from an accident.
        return Promise.reject(
          new Error('A spend cap reset requires both an authorizing actor and a reason.'),
        );
      }

      return withLock(scope, async () => {
        const record = await current(scope);
        const newCap = resetOptions.newCapMicroUsd ?? record.capMicroUsd;
        const event: SpendResetEvent = {
          at: now(),
          authorizedBy,
          reason: reason.slice(0, 500),
          clearedMicroUsd: record.spentMicroUsd,
          previousCapMicroUsd: record.capMicroUsd,
          newCapMicroUsd: newCap,
        };
        const updated: SpendRecord = {
          ...record,
          spentMicroUsd: 0,
          attemptCount: 0,
          capMicroUsd: newCap,
          updatedAt: event.at,
          resets: [...record.resets, event].slice(-maxResetHistory),
        };
        await store.save(updated);
        return updated;
      });
    },
  };
}

/** In-memory store. Correct for tests and a single-instance deployment. */
export function createMemorySpendStore(): SpendStore & { clear(): void } {
  const records = new Map<string, SpendRecord>();
  return {
    load: (scope) => Promise.resolve(records.get(scope)),
    save: (record) => {
      records.set(record.scope, record);
      return Promise.resolve();
    },
    clear: () => records.clear(),
  };
}

/** Scope names. Centralised so a dashboard query never guesses a string. */
export const SPEND_SCOPE = {
  /** The MARQ-funded platform ceiling. One scope, all organizations. */
  platform: 'spend:marq:platform:lifetime',
  organization: (organizationId: string) => `spend:org:${organizationId}:lifetime`,
} as const;

/** Micro-USD from a dollar figure, without float drift in the ledger. */
export function usdToMicroUsd(usd: number): number {
  return Math.round(usd * 1_000_000);
}
