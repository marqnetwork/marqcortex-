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
 * RESERVATION OWNERSHIP IS DURABLE, NOT ISOLATE-LOCAL.
 *
 * An earlier revision persisted the reserved *total* but tracked which request
 * owned each hold in a module-level `Map`. That combination has one bad state
 * and it is reachable on every deploy: an isolate that is recycled between
 * reserve and settle loses the map, so the persisted hold has no owner, nothing
 * can ever settle or release it, and the headroom is gone permanently. Enough
 * interrupted requests and the platform disables its own AI while having spent
 * nothing at all.
 *
 * So every hold now carries its own durable metadata — id, amount, who took it,
 * when it was taken, and when it stops being valid — inside the record itself:
 *
 *   `reservedMicroUsd` is a cached sum. `openReservations` is the truth.
 *
 * Recovery has three parts, and each is deliberately conservative:
 *
 *   Expiry.       A hold is valid until `expiresAt`, which is set from a TTL
 *                 that must exceed the whole-workflow deadline. Reclamation
 *                 releases a hold only once that stamp is in the past, so a
 *                 request that is still running can never have its headroom
 *                 taken away underneath it.
 *   Recovery.     Because the metadata is durable, a fresh isolate can list the
 *                 open holds for a scope and settle one by id. Settlement after
 *                 a restart is a normal operation, not a special case.
 *   Late spend.   Settling an id that is no longer open still CHARGES, unless
 *                 that id is in the recently-closed ring. A reclaimed hold whose
 *                 request really did reach a vendor is real money, and this
 *                 ledger's one unacceptable error is under-counting real spend.
 *
 * Reclaiming an expired hold is NOT a budget reset. It returns headroom that no
 * live request owns; it never reduces settled spend, and there is no timer
 * anywhere in this module that clears `spentMicroUsd`.
 *
 * CONCURRENCY. Reservations are serialised per scope inside one runtime through
 * an async mutex, so `reserve` is exact within a process. Across processes the
 * key-value backend has no compare-and-swap, so two isolates can each reserve
 * against the same read. The overshoot is bounded by (isolates × one estimate)
 * — cents, not dollars — and is documented rather than hidden. Closing it fully
 * requires an atomic counter in the storage layer, which is called out in the
 * remediation report as a known limitation rather than claimed as solved.
 */

/**
 * One authorised change to the ceiling. Retained on the record so the cap has
 * a history that outlives the change that made it.
 *
 * Two kinds, and the difference is what an auditor checks first:
 *
 *   reset      Settled spend was CLEARED. The platform's counter went back to
 *              zero and it may spend the whole ceiling again.
 *   cap_raise  The ceiling moved. Settled spend was preserved — the platform
 *              has still spent what it spent, it simply has more headroom.
 */
export type SpendCapChangeKind = 'reset' | 'cap_raise';

export interface SpendResetEvent {
  readonly at: string;
  /**
   * What this event did. Absent on records written before the distinction
   * existed, which were all resets.
   */
  readonly kind?: SpendCapChangeKind;
  /** Actor who authorised the change. Never a system default. */
  readonly authorizedBy: string;
  readonly reason: string;
  readonly clearedMicroUsd: number;
  /** Held-but-unsettled money the reset also cleared. */
  readonly clearedReservedMicroUsd: number;
  /** Open holds discarded by the reset. */
  readonly clearedReservationCount: number;
  readonly previousCapMicroUsd: number;
  readonly newCapMicroUsd: number;
}

/**
 * One hold, with enough durable metadata to be recovered — or safely reclaimed
 * — by an isolate that did not create it.
 */
export interface OpenSpendReservation {
  readonly reservationId: string;
  readonly reservedMicroUsd: number;
  readonly createdAt: string;
  /** After this instant the hold may be reclaimed. Never before. */
  readonly expiresAt: string;
  /** Feature that took the hold. Forensics for a post-restart audit. */
  readonly owner?: string;
}

export interface SpendRecord {
  readonly scope: string;
  /** Settled spend. Only ever increases, except through an authorised reset. */
  readonly spentMicroUsd: number;
  /**
   * Held for in-flight requests: the sum of `openReservations` plus any
   * unattributed remainder inherited from an older record. A cached total —
   * `openReservations` is the authority.
   */
  readonly reservedMicroUsd: number;
  readonly capMicroUsd: number;
  /** Billable provider attempts settled against this scope. */
  readonly attemptCount: number;
  readonly updatedAt: string;
  readonly resets: readonly SpendResetEvent[];
  /** Every hold currently outstanding, with its own expiry. */
  readonly openReservations: readonly OpenSpendReservation[];
  /**
   * Recently settled or released ids, so a repeat of either is a no-op rather
   * than a double charge. Bounded; see `maxClosedReservationIds`.
   */
  readonly closedReservationIds: readonly string[];
  /**
   * When reserved money with no owning hold was first observed. Only set for a
   * record written by an older revision, or one whose hold metadata was
   * unreadable. Time-boxes that remainder so it cannot be held forever.
   */
  readonly unattributedSince?: string;
  /** Running total of headroom returned by expiry reclamation. */
  readonly reclaimedMicroUsd: number;
  /** Holds reclaimed after expiry. Never includes a settled or released hold. */
  readonly reclaimedCount: number;
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
  readonly createdAt: string;
  /** After this instant another isolate may reclaim the hold. */
  readonly expiresAt: string;
}

/** Rehydrate a settle-able handle from durable metadata, after a restart. */
export function reservationFrom(scope: string, open: OpenSpendReservation): SpendReservation {
  return {
    reservationId: open.reservationId,
    scope,
    reservedMicroUsd: open.reservedMicroUsd,
    createdAt: open.createdAt,
    expiresAt: open.expiresAt,
  };
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

export interface ReserveOptions {
  /** Feature or subsystem taking the hold. Recorded for post-restart triage. */
  readonly owner?: string;
  /** Override the ledger TTL for one hold. Clamped to at least one second. */
  readonly ttlMs?: number;
}

export interface SpendLedger {
  /**
   * Current state, without reserving anything. Expired holds are reclaimed as
   * part of the read, so the reported headroom is the headroom a request would
   * actually get.
   */
  read(scope: string): Promise<SpendRecord>;
  /**
   * Reserve `estimateMicroUsd` against the cap. Granted only when the estimate
   * fits in the remaining headroom — a request projected to cross the ceiling
   * is refused before it reaches a provider, not after.
   *
   * Idempotent per `reservationId`: re-reserving an id that is still open
   * returns the existing hold rather than taking a second one.
   */
  reserve(
    scope: string,
    estimateMicroUsd: number,
    reservationId: string,
    options?: ReserveOptions,
  ): Promise<SpendDecision>;
  /** Convert a reservation into settled spend at the measured cost. */
  settle(reservation: SpendReservation, actualMicroUsd: number): Promise<SpendRecord>;
  /** Give a reservation back. Used when nothing billable happened. */
  release(reservation: SpendReservation): Promise<SpendRecord>;
  /**
   * Holds still outstanding for a scope, expired ones already reclaimed. This
   * is how an isolate that did not create a hold recovers it: list, match by
   * id, `reservationFrom(...)`, settle.
   */
  openReservations(scope: string): Promise<readonly OpenSpendReservation[]>;
  /**
   * Clear settled spend AND every outstanding hold, and optionally raise the
   * cap. Requires an authorising actor and a reason — there is no unattributed
   * reset, and no timer that performs one.
   */
  reset(
    scope: string,
    options: { authorizedBy: string; reason: string; newCapMicroUsd?: number },
  ): Promise<SpendRecord>;
  /**
   * Raise the ceiling WITHOUT clearing settled spend, and without touching a
   * single open hold.
   *
   * This is the other half of budget management and it is deliberately not the
   * same operation as `reset`. "We authorised more money" and "we wiped the
   * record of what was spent" are different decisions with different blast
   * radii, and a platform that offers only the second forces an operator who
   * wanted the first to destroy the evidence to get it.
   *
   * Refuses to LOWER the cap. Lowering is a deployment change — `stored()`
   * already re-stamps the configured cap on the next load — and doing it here
   * would let an "increase" call quietly disable AI.
   */
  raiseCap(
    scope: string,
    options: { authorizedBy: string; reason: string; newCapMicroUsd: number },
  ): Promise<SpendRecord>;
}

export interface SpendLedgerOptions {
  readonly store: SpendStore;
  /**
   * The configured ceiling for a scope, in micro-USD.
   *
   * ── WHY THIS IS PER SCOPE NOW (4D remediation, HIGH-1) ────────────────────
   *
   * It used to be one number for every scope, and once BLOCKER B-2's fix
   * started reserving tenant-funded executions on `SPEND_SCOPE.organization(…)`
   * that number was `AI_MAX_SPEND_USD` — MARQ's own $9 lifetime ceiling —
   * applied to money MARQ is not billed for. A certification found the
   * consequence: declaring `tenant_only` capped a customer's spend on their OWN
   * vendor account at $9 for life, invisibly, after which their AI stopped
   * permanently.
   *
   * A function rather than a map, because the scopes are not enumerable: one
   * exists per organization, created on first use.
   *
   * A plain number is still accepted and still means "this ceiling, everywhere"
   * — every existing caller and every test that predates the split keeps its
   * behaviour without an edit.
   */
  readonly capMicroUsd: number | ((scope: string) => number);
  readonly now: () => string;
  /** Reset events retained per scope. Bounded so a record cannot grow forever. */
  readonly maxResetHistory?: number;
  /**
   * How long a hold stays valid. MUST exceed the longest a request can run, or
   * a live request's headroom could be reclaimed while it is still executing.
   * The control plane derives it from the workflow deadline.
   */
  readonly reservationTtlMs?: number;
  /** Recently-closed ids retained per scope, for settle/release idempotency. */
  readonly maxClosedReservationIds?: number;
}

const DEFAULT_MAX_RESET_HISTORY = 20;

/**
 * Fifteen minutes. The default whole-workflow deadline is 90 seconds and its
 * configurable maximum is ten minutes, so this leaves headroom over the longest
 * request the platform will admit. Reclaiming early would be worse than
 * reclaiming late: late costs a little headroom, early double-spends it.
 */
export const DEFAULT_RESERVATION_TTL_MS = 900_000;

const DEFAULT_MAX_CLOSED_RESERVATION_IDS = 64;

/** Epoch milliseconds for an ISO stamp, or `undefined` if it is not readable. */
function epochMs(iso: string | undefined): number | undefined {
  if (typeof iso !== 'string' || iso === '') return undefined;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
}

function sumHolds(holds: readonly OpenSpendReservation[]): number {
  return holds.reduce((total, hold) => total + hold.reservedMicroUsd, 0);
}

export function emptySpendRecord(scope: string, capMicroUsd: number, at: string): SpendRecord {
  return {
    scope,
    spentMicroUsd: 0,
    reservedMicroUsd: 0,
    capMicroUsd,
    attemptCount: 0,
    updatedAt: at,
    resets: [],
    openReservations: [],
    closedReservationIds: [],
    reclaimedMicroUsd: 0,
    reclaimedCount: 0,
  };
}

interface Reconciliation {
  readonly record: SpendRecord;
  /** True when the reconciled record differs from the stored one. */
  readonly changed: boolean;
  readonly reclaimedMicroUsd: number;
}

/**
 * Return headroom held by expired reservations, and time-box any reserved
 * remainder that has no hold to own it.
 *
 * Pure: it decides, it does not persist. Callers hold the scope lock and write
 * the result. Running it on every load is what makes recovery automatic — there
 * is no sweeper to schedule and nothing to forget to run.
 */
export function reconcileSpendRecord(
  record: SpendRecord,
  nowIso: string,
  ttlMs: number,
): Reconciliation {
  const nowMs = epochMs(nowIso);
  // Without a readable clock nothing is provably expired, and releasing money
  // on a guess is the failure this whole module exists to prevent.
  if (nowMs === undefined) return { record, changed: false, reclaimedMicroUsd: 0 };

  const live: OpenSpendReservation[] = [];
  let expiredMicroUsd = 0;
  let expiredCount = 0;
  for (const hold of record.openReservations) {
    const expiresMs = epochMs(hold.expiresAt);
    // An unreadable expiry is NOT treated as expired: guessing one could strip
    // a live request of its headroom. Such a hold stays until an authorised
    // reset clears it, which is the conservative direction to be wrong in.
    if (expiresMs !== undefined && expiresMs <= nowMs) {
      expiredMicroUsd += hold.reservedMicroUsd;
      expiredCount += 1;
    } else {
      live.push(hold);
    }
  }

  // Money the record says is reserved but that no hold accounts for. Records
  // written before holds were durable look exactly like this — and so does the
  // orphan this module exists to clear.
  const attributed = sumHolds(live) + expiredMicroUsd;
  const unattributed = Math.max(0, record.reservedMicroUsd - attributed);

  let unattributedSince = record.unattributedSince;
  let keptUnattributed = 0;
  let reclaimedUnattributed = 0;
  if (unattributed > 0) {
    // Anchor the grace window the first time the remainder is seen, and PERSIST
    // that anchor. Re-deriving it from `updatedAt` on every load would let
    // unrelated writes push the deadline forward forever.
    if (unattributedSince === undefined) unattributedSince = record.updatedAt;
    const sinceMs = epochMs(unattributedSince);
    if (sinceMs !== undefined && sinceMs + ttlMs <= nowMs) {
      reclaimedUnattributed = unattributed;
      unattributedSince = undefined;
    } else {
      keptUnattributed = unattributed;
    }
  } else {
    unattributedSince = undefined;
  }

  const reclaimedMicroUsd = expiredMicroUsd + reclaimedUnattributed;
  const reservedMicroUsd = sumHolds(live) + keptUnattributed;
  const changed =
    expiredCount > 0 ||
    reclaimedUnattributed > 0 ||
    reservedMicroUsd !== record.reservedMicroUsd ||
    unattributedSince !== record.unattributedSince;

  if (!changed) return { record, changed: false, reclaimedMicroUsd: 0 };

  const reconciled: SpendRecord = {
    ...record,
    reservedMicroUsd,
    openReservations: live,
    unattributedSince,
    reclaimedMicroUsd: record.reclaimedMicroUsd + reclaimedMicroUsd,
    reclaimedCount: record.reclaimedCount + expiredCount + (reclaimedUnattributed > 0 ? 1 : 0),
    updatedAt: nowIso,
  };
  return { record: reconciled, changed: true, reclaimedMicroUsd };
}

export function createSpendLedger(options: SpendLedgerOptions): SpendLedger {
  const { store, now } = options;
  const maxResetHistory = options.maxResetHistory ?? DEFAULT_MAX_RESET_HISTORY;
  const maxClosedIds = options.maxClosedReservationIds ?? DEFAULT_MAX_CLOSED_RESERVATION_IDS;
  const ttlMs = Math.max(1_000, options.reservationTtlMs ?? DEFAULT_RESERVATION_TTL_MS);

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

  /**
   * The configured ceiling for one scope.
   *
   * Asked per scope rather than captured once, so the platform ceiling and an
   * organization's are independent by construction: there is no value here that
   * both of them read.
   */
  function configuredCap(scope: string): number {
    return typeof options.capMicroUsd === 'function'
      ? options.capMicroUsd(scope)
      : options.capMicroUsd;
  }

  /** Load, defaulting a missing record and re-stamping the configured cap. */
  async function stored(scope: string): Promise<SpendRecord> {
    const loaded = await store.load(scope);
    if (!loaded) return emptySpendRecord(scope, configuredCap(scope), now());
    // The configured cap wins over a stored one unless a reset explicitly
    // raised it: an operator lowering AI_MAX_SPEND_USD must take effect on the
    // next request, not be overridden by a value persisted days ago.
    const raisedByReset = loaded.resets.at(-1)?.newCapMicroUsd;
    const capMicroUsd =
      raisedByReset !== undefined && raisedByReset === loaded.capMicroUsd
        ? loaded.capMicroUsd
        : configuredCap(scope);
    return { ...loaded, capMicroUsd };
  }

  /**
   * The record as it stands after expired holds are reclaimed. Every operation
   * starts here, so recovery happens on the next touch of the scope rather than
   * on a schedule nobody owns.
   */
  async function current(scope: string): Promise<Reconciliation> {
    return reconcileSpendRecord(await stored(scope), now(), ttlMs);
  }

  function withClosedId(record: SpendRecord, reservationId: string): readonly string[] {
    const kept = record.closedReservationIds.filter((id) => id !== reservationId);
    return [...kept, reservationId].slice(-maxClosedIds);
  }

  return {
    read: (scope) =>
      withLock(scope, async () => {
        const { record, changed } = await current(scope);
        if (changed) {
          try {
            await store.save(record);
          } catch {
            // Best effort, and safe to swallow HERE only: reclamation is derived
            // from durable expiry stamps, so an unflushed reclaim is recomputed
            // identically on the next load, and until then the store holds the
            // LARGER reserved figure. Failing to flush errs toward refusing
            // spend, never toward permitting it.
          }
        }
        return record;
      }),

    openReservations: (scope) =>
      withLock(scope, async () => {
        const { record, changed } = await current(scope);
        if (changed) {
          try {
            await store.save(record);
          } catch {
            // See `read`.
          }
        }
        return record.openReservations;
      }),

    reserve(scope, estimateMicroUsd, reservationId, reserveOptions) {
      const estimate = Math.max(0, Math.round(estimateMicroUsd));
      const holdTtlMs = Math.max(1_000, reserveOptions?.ttlMs ?? ttlMs);
      return withLock(scope, async () => {
        const { record } = await current(scope);

        // Re-reserving an id that is still open must not take a second hold —
        // a retried reservation would otherwise leak headroom that only expiry
        // could recover.
        const existing = record.openReservations.find(
          (hold) => hold.reservationId === reservationId,
        );
        if (existing) {
          return {
            granted: true as const,
            reservation: reservationFrom(scope, existing),
            record,
          };
        }

        // A cap of 0 means "no ceiling configured" only where that is the
        // documented meaning; here 0 is a real ceiling — the platform is not
        // permitted to spend. Treat it as such.
        if (committedMicroUsd(record) >= record.capMicroUsd) {
          return { granted: false as const, reason: 'cap_reached' as const, record };
        }
        if (committedMicroUsd(record) + estimate > record.capMicroUsd) {
          return { granted: false as const, reason: 'insufficient_headroom' as const, record };
        }

        const createdAt = now();
        // `Date.now()` only as a fallback for an unparseable injected clock; a
        // hold with no computable expiry would be an orphan by construction.
        const anchorMs = epochMs(createdAt) ?? Date.now();
        const hold: OpenSpendReservation = {
          reservationId,
          reservedMicroUsd: estimate,
          createdAt,
          expiresAt: new Date(anchorMs + holdTtlMs).toISOString(),
          ...(reserveOptions?.owner === undefined ? {} : { owner: reserveOptions.owner }),
        };

        const updated: SpendRecord = {
          ...record,
          reservedMicroUsd: record.reservedMicroUsd + estimate,
          openReservations: [...record.openReservations, hold],
          updatedAt: createdAt,
        };
        await store.save(updated);

        return {
          granted: true as const,
          reservation: reservationFrom(scope, hold),
          record: updated,
        };
      });
    },

    settle(reservation, actualMicroUsd) {
      const actual = Math.max(0, Math.round(actualMicroUsd));
      return withLock(reservation.scope, async () => {
        const { record } = await current(reservation.scope);
        const id = reservation.reservationId;
        const hold = record.openReservations.find((entry) => entry.reservationId === id);

        if (!hold) {
          if (record.closedReservationIds.includes(id)) {
            // Already settled or released. Settling again would double charge,
            // so this is a no-op that returns the current truth.
            return record;
          }
          // The hold is gone but this id was never closed: it expired and was
          // reclaimed, or it was taken by an isolate whose write was lost. The
          // provider call it paid for still happened. Charging is the only safe
          // direction — the ceiling's job is to be un-crossable, and money that
          // went out and was never counted is exactly how it gets crossed.
          const late: SpendRecord = {
            ...record,
            spentMicroUsd: record.spentMicroUsd + actual,
            attemptCount: record.attemptCount + 1,
            closedReservationIds: withClosedId(record, id),
            updatedAt: now(),
          };
          await store.save(late);
          return late;
        }

        const updated: SpendRecord = {
          ...record,
          spentMicroUsd: record.spentMicroUsd + actual,
          reservedMicroUsd: Math.max(0, record.reservedMicroUsd - hold.reservedMicroUsd),
          openReservations: record.openReservations.filter((entry) => entry.reservationId !== id),
          closedReservationIds: withClosedId(record, id),
          attemptCount: record.attemptCount + 1,
          updatedAt: now(),
        };
        await store.save(updated);
        return updated;
      });
    },

    release(reservation) {
      return withLock(reservation.scope, async () => {
        const { record, changed } = await current(reservation.scope);
        const id = reservation.reservationId;
        const hold = record.openReservations.find((entry) => entry.reservationId === id);
        if (!hold) {
          // Already settled, already released, or already reclaimed. Releasing
          // again must not hand back headroom a second time.
          if (changed) {
            try {
              await store.save(record);
            } catch {
              // See `read`.
            }
          }
          return record;
        }

        const updated: SpendRecord = {
          ...record,
          reservedMicroUsd: Math.max(0, record.reservedMicroUsd - hold.reservedMicroUsd),
          openReservations: record.openReservations.filter((entry) => entry.reservationId !== id),
          closedReservationIds: withClosedId(record, id),
          updatedAt: now(),
        };
        await store.save(updated);
        return updated;
      });
    },

    raiseCap(scope, capOptions) {
      const authorizedBy = capOptions.authorizedBy.trim();
      const reason = capOptions.reason.trim();
      if (authorizedBy === '' || reason === '') {
        return Promise.reject(
          new Error('A spend cap increase requires both an authorizing actor and a reason.'),
        );
      }
      const requested = Math.max(0, Math.round(capOptions.newCapMicroUsd));

      return withLock(scope, async () => {
        const { record } = await current(scope);
        if (requested <= record.capMicroUsd) {
          throw new Error(
            `A spend cap increase must raise the ceiling: requested ${requested}, current ${record.capMicroUsd}.`,
          );
        }

        const event: SpendResetEvent = {
          at: now(),
          kind: 'cap_raise',
          authorizedBy,
          reason: reason.slice(0, 500),
          // Nothing was cleared. Recording zeroes here is the whole point of
          // the distinction: an auditor reading the history sees the ceiling
          // move without the spend counter being touched.
          clearedMicroUsd: 0,
          clearedReservedMicroUsd: 0,
          clearedReservationCount: 0,
          previousCapMicroUsd: record.capMicroUsd,
          newCapMicroUsd: requested,
        };

        const updated: SpendRecord = {
          ...record,
          capMicroUsd: requested,
          updatedAt: event.at,
          resets: [...record.resets, event].slice(-maxResetHistory),
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
        const { record } = await current(scope);
        const newCap = resetOptions.newCapMicroUsd ?? record.capMicroUsd;
        const event: SpendResetEvent = {
          at: now(),
          kind: 'reset',
          authorizedBy,
          reason: reason.slice(0, 500),
          clearedMicroUsd: record.spentMicroUsd,
          clearedReservedMicroUsd: record.reservedMicroUsd,
          clearedReservationCount: record.openReservations.length,
          previousCapMicroUsd: record.capMicroUsd,
          newCapMicroUsd: newCap,
        };
        // An authorised reset clears BOTH instruments. Leaving holds behind was
        // the defect: an operator who reset a ceiling exhausted by orphaned
        // reservations got a ledger that still refused every request.
        //
        // Discarded ids are deliberately NOT added to the closed ring, so a
        // request that was genuinely in flight across the reset still charges
        // its real cost when it settles.
        const updated: SpendRecord = {
          ...record,
          spentMicroUsd: 0,
          reservedMicroUsd: 0,
          openReservations: [],
          unattributedSince: undefined,
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

/**
 * The organization a scope name belongs to, or `undefined` for any other scope.
 *
 * The inverse of `SPEND_SCOPE.organization`, kept BESIDE it so the two cannot
 * drift: the ledger has to decide which ceiling a scope is governed by, and the
 * administration surface has to decide whether a caller may administer it, and
 * a second parser of this string elsewhere is how those two eventually disagree
 * about which tenant a ledger belongs to.
 *
 * `SPEND_SCOPE.platform` is deliberately not matched. Its name is not of this
 * shape and there is no organization id that could produce it, which is what
 * makes "an organization operation can never touch the platform scope" a
 * property of the format rather than of a check somewhere.
 */
export function organizationOfSpendScope(scope: string): string | undefined {
  const match = /^spend:org:(.+):lifetime$/.exec(scope);
  return match?.[1];
}

/**
 * A governed ceiling that does not bind (4D remediation, HIGH-1).
 *
 * `Number.MAX_SAFE_INTEGER` micro-USD is nine billion dollars — beyond any
 * spend this platform can reach — and it is chosen over `Infinity` for one
 * reason: the record is persisted as JSON, and `JSON.stringify(Infinity)` is
 * `null`. A ceiling that silently became `null` on the way to storage would
 * read back as a missing cap, and every arithmetic comparison against it would
 * be `false`. A large finite number keeps `remainingMicroUsd`, the reservation
 * arithmetic and the stored record all working exactly as they do for a bounded
 * scope, with no branch of their own.
 *
 * It is NOT "unlimited" as a state the code special-cases. It is a NUMBER, so
 * every invariant — reserve, settle, release, reclaim, raise, reset — holds for
 * it unchanged, and an operator who configures a real ceiling gets the same
 * code path with a smaller number.
 */
export const UNBOUNDED_SPEND_CAP_MICRO_USD = Number.MAX_SAFE_INTEGER;

/** Whether a ceiling is the governed unbounded one. For display, never for control flow. */
export function isUnboundedSpendCap(capMicroUsd: number): boolean {
  return capMicroUsd >= UNBOUNDED_SPEND_CAP_MICRO_USD;
}

/** Micro-USD from a dollar figure, without float drift in the ledger. */
export function usdToMicroUsd(usd: number): number {
  return Math.round(usd * 1_000_000);
}
