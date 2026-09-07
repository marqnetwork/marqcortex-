/**
 * A recording stand-in for the Supabase query builder.
 *
 * ── WHY A FAKE AND NOT A REAL DATABASE ─────────────────────────────────────
 *
 * The backfill writes through PostgREST, so the statements it issues are
 * decided by the client library rather than written here. What these tests can
 * prove — and what actually goes wrong in a backfill — is the SHAPE of the
 * work: which tables are touched, in what order, whether a re-run updates
 * instead of inserting, and whether a row that KV no longer carries is retired.
 * A recording fake proves all of that deterministically.
 *
 * What it deliberately does NOT prove is that the constraints hold. That needs
 * a real PostgreSQL and belongs in a scenarios harness alongside
 * `ai-customer-byok-scenarios.mjs`, which is recorded as the follow-up.
 *
 * The builder is thenable, because the code under test awaits some chains
 * directly (`await client.from(t).insert(x)`) and terminates others with
 * `.maybeSingle()` or `.single()`.
 */

export interface FakeOperation {
  table: string;
  verb: 'select' | 'insert' | 'update';
  payload?: Record<string, unknown>;
  filters: Array<{ op: string; column: string; value: unknown }>;
}

export interface FakeResult {
  data?: unknown;
  error?: { message: string } | null;
}

export interface FakeSupabase {
  from(table: string): FakeBuilder;
  readonly operations: FakeOperation[];
  /** Queue a result for the next call on `table` with this verb. */
  queue(table: string, verb: FakeOperation['verb'], result: FakeResult): void;
  /** Every operation recorded against one table. */
  opsFor(table: string): FakeOperation[];
}

interface FakeBuilder {
  select(columns?: string): FakeBuilder;
  insert(payload: Record<string, unknown>): FakeBuilder;
  update(payload: Record<string, unknown>): FakeBuilder;
  eq(column: string, value: unknown): FakeBuilder;
  is(column: string, value: unknown): FakeBuilder;
  not(column: string, op: string, value: unknown): FakeBuilder;
  maybeSingle(): Promise<FakeResult>;
  single(): Promise<FakeResult>;
  then(
    resolve: (value: FakeResult) => unknown,
    reject?: (reason: unknown) => unknown,
  ): Promise<unknown>;
}

export function createFakeSupabase(): FakeSupabase {
  const operations: FakeOperation[] = [];
  const queues = new Map<string, FakeResult[]>();

  function key(table: string, verb: string): string {
    return `${table}:${verb}`;
  }

  function take(op: FakeOperation): FakeResult {
    const pending = queues.get(key(op.table, op.verb));
    const next = pending?.shift();
    // An unqueued read is "nothing there", which is the state a first backfill
    // finds and therefore the right default. An unqueued write succeeds.
    return next ?? { data: op.verb === 'select' ? null : { id: `${op.table}-generated` }, error: null };
  }

  const api: FakeSupabase = {
    operations,
    opsFor: (table) => operations.filter((op) => op.table === table),
    queue(table, verb, result) {
      const existing = queues.get(key(table, verb)) ?? [];
      existing.push(result);
      queues.set(key(table, verb), existing);
    },
    from(table) {
      const op: FakeOperation = { table, verb: 'select', filters: [] };
      operations.push(op);

      const builder: FakeBuilder = {
        select() {
          return builder;
        },
        insert(payload) {
          op.verb = 'insert';
          op.payload = payload;
          return builder;
        },
        update(payload) {
          op.verb = 'update';
          op.payload = payload;
          return builder;
        },
        eq(column, value) {
          op.filters.push({ op: 'eq', column, value });
          return builder;
        },
        is(column, value) {
          op.filters.push({ op: 'is', column, value });
          return builder;
        },
        not(column, operator, value) {
          op.filters.push({ op: `not.${operator}`, column, value });
          return builder;
        },
        maybeSingle: () => Promise.resolve(take(op)),
        single: () => Promise.resolve(take(op)),
        then(resolve, reject) {
          return Promise.resolve(take(op)).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return api;
}
