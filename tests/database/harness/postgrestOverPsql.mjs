/**
 * A PostgREST-shaped client backed by real PostgreSQL, for the reconciliation
 * scenarios.
 *
 * WHY THIS EXISTS. The reconcilers take a `SupabaseClient` — PostgREST over
 * HTTP — and every test of them so far has handed them `fakeSupabase.ts`, an
 * in-memory stand-in. A fake proves the reconciler's ARITHMETIC. It cannot
 * prove that the query it builds is legal SQL, that `NOT legacy_kv_key IS NULL`
 * excludes what the author thought, that a `numeric` column comes back as a
 * string, or that a soft-deleted row really does leave the result set. Those
 * are properties of the database, and the only way to observe them is to run
 * the query against one.
 *
 * So this translates the narrow slice of the builder the reconcilers actually
 * use into SQL and executes it through `psql`. The REAL reconciler runs; only
 * the transport is substituted. If a reconciler starts using an operator that
 * is not implemented here, the call throws by name rather than quietly
 * returning the wrong rows.
 *
 * TEST INFRASTRUCTURE. Nothing in production imports this.
 */
import { execFileSync } from 'node:child_process';

/** Every operator the reconcilers use. An unknown one is an error, not a no-op. */
const OPERATORS = new Set(['eq', 'gt', 'like', 'is', 'not']);

function quoteLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function quoteIdent(name) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(`postgrestOverPsql: refusing unsafe identifier ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

export function createPsqlClient(databaseUrl) {
  function run(sql) {
    const out = execFileSync(
      'psql',
      [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-X', '-q', '-c', sql],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  function builder(table) {
    const state = { columns: '*', where: [], orderBy: null, limit: null, count: null, head: false };

    const chain = {
      select(columns, options) {
        state.columns = columns ?? '*';
        if (options?.count) state.count = options.count;
        if (options?.head) state.head = true;
        return chain;
      },
      eq(column, value) {
        state.where.push(`${quoteIdent(column)} = ${quoteLiteral(value)}`);
        return chain;
      },
      gt(column, value) {
        state.where.push(`${quoteIdent(column)} > ${quoteLiteral(value)}`);
        return chain;
      },
      like(column, pattern) {
        state.where.push(`${quoteIdent(column)} LIKE ${quoteLiteral(pattern)}`);
        return chain;
      },
      is(column, value) {
        if (value !== null) throw new Error(`postgrestOverPsql: .is() supports NULL only`);
        state.where.push(`${quoteIdent(column)} IS NULL`);
        return chain;
      },
      not(column, operator, value) {
        if (operator !== 'is' || value !== null) {
          throw new Error(`postgrestOverPsql: .not() supports ('col','is',null) only`);
        }
        state.where.push(`${quoteIdent(column)} IS NOT NULL`);
        return chain;
      },
      order(column, options) {
        state.orderBy = `${quoteIdent(column)} ${options?.ascending === false ? 'DESC' : 'ASC'}`;
        return chain;
      },
      limit(n) {
        state.limit = n;
        return chain;
      },
      then(resolve, reject) {
        try {
          const where = state.where.length ? ` WHERE ${state.where.join(' AND ')}` : '';

          if (state.head && state.count) {
            const [row] = run(
              `SELECT row_to_json(t) FROM (SELECT count(*)::int AS c FROM ${quoteIdent(table)}${where}) t`,
            );
            return Promise.resolve({ data: null, count: row?.c ?? 0, error: null }).then(resolve, reject);
          }

          const columns =
            state.columns === '*'
              ? '*'
              : state.columns.split(',').map((c) => quoteIdent(c.trim())).join(', ');
          const order = state.orderBy ? ` ORDER BY ${state.orderBy}` : '';
          const limit = state.limit === null ? '' : ` LIMIT ${Number(state.limit)}`;
          const rows = run(
            `SELECT row_to_json(t) FROM (SELECT ${columns} FROM ${quoteIdent(table)}${where}${order}${limit}) t`,
          );
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        } catch (cause) {
          // A PostgREST client reports a failed query as `error`, not a throw,
          // and `throwOnError` is what turns it back into one. Modelling that
          // faithfully is the difference between exercising the reconciler's
          // error path and bypassing it.
          return Promise.resolve({
            data: null,
            error: { message: cause instanceof Error ? cause.message : String(cause) },
          }).then(resolve, reject);
        }
      },
    };

    for (const name of ['in', 'neq', 'lt', 'lte', 'gte', 'range', 'single', 'maybeSingle', 'upsert', 'insert', 'update', 'delete']) {
      chain[name] = () => {
        throw new Error(`postgrestOverPsql: .${name}() is not implemented — add it deliberately`);
      };
    }
    void OPERATORS;
    return chain;
  }

  return { from: (table) => builder(table), __sql: run };
}
