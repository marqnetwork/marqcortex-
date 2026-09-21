/**
 * The `DurableSqlGateway`, over a Supabase-shaped query builder.
 *
 * ── WHY THIS IS ITS OWN MODULE ────────────────────────────────────────────
 *
 * It takes no client library. It takes a STRUCTURAL TYPE — something with
 * `rpc` and `from` — which is what `@supabase/supabase-js` happens to provide
 * and what a test can provide in ten lines. Keeping it separate from the
 * composition means this file imports nothing with an `npm:` specifier, so the
 * Node test runner can exercise the translation directly instead of asserting
 * on its source.
 *
 * That matters more than it sounds: this adapter is where a tenant predicate
 * could quietly go missing, and it is the one part of the Postgres path that
 * can be driven without a database.
 *
 * ── FOUR VERBS AND NO FIFTH ───────────────────────────────────────────────
 *
 * Matching the port exactly. There is no expression language here and no way to
 * express a query that is not one of these shapes, which is what keeps a
 * cross-tenant read unexpressible rather than merely unwritten.
 *
 * `rpc` is how every ATOMIC operation is reached — claim, heartbeat, settle,
 * transition, recovery, materialisation, and the outbox and inbox lifecycles.
 * Each is one SQL statement whose atomicity IS the guarantee, and routing them
 * through `rpc` is what preserves it.
 */

import type { DurableSqlGateway, SelectCriteria } from './platform/durable/index.ts';

/**
 * The gateway, over the Supabase service client.
 *
 * FOUR VERBS AND NO FIFTH, matching the port exactly. There is no expression
 * language here and no way to express a query that is not one of these shapes,
 * which is what keeps a cross-tenant read unexpressible rather than merely
 * unwritten.
 *
 * `rpc` is how every ATOMIC operation is reached — claim, heartbeat, settle,
 * transition, recovery, materialisation, and the outbox and inbox lifecycles.
 * Each of those is one SQL statement whose atomicity IS the guarantee, and
 * routing them through PostgREST's `rpc` is what preserves that.
 */
export function createSupabaseDurableGateway(client: {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  from: (table: string) => unknown;
}): DurableSqlGateway {
  type Builder = {
    select: (columns?: string) => Builder;
    insert: (row: unknown) => Builder;
    update: (patch: unknown) => Builder;
    eq: (column: string, value: unknown) => Builder;
    in: (column: string, values: readonly unknown[]) => Builder;
    order: (column: string, options: { ascending: boolean }) => Builder;
    limit: (count: number) => Builder;
    then: (
      resolve: (value: { data: unknown; error: unknown }) => unknown,
    ) => Promise<unknown>;
  };

  const table = (name: string) => client.from(name) as unknown as Builder;

  function rowsOf(result: { data: unknown; error: unknown }, context: string) {
    if (result.error) {
      const message =
        typeof result.error === 'object' && result.error !== null && 'message' in result.error
          ? String((result.error as { message: unknown }).message)
          : String(result.error);
      // THROWN, NOT SWALLOWED. A storage error that returned an empty array
      // would look exactly like "nothing was due", and a worker would report a
      // healthy idle tick while the database was unreachable.
      throw new Error(`${context}: ${message}`);
    }
    return Array.isArray(result.data)
      ? (result.data as readonly Readonly<Record<string, unknown>>[])
      : [];
  }

  function applyCriteria(query: Builder, criteria: SelectCriteria): Builder {
    let next = query;
    for (const [column, value] of Object.entries(criteria.match ?? {})) {
      next = next.eq(column, value);
    }
    if (criteria.inList) next = next.in(criteria.inList.column, criteria.inList.values);
    if (criteria.order) {
      next = next.order(criteria.order.column, { ascending: criteria.order.ascending });
    }
    if (criteria.limit !== undefined) next = next.limit(criteria.limit);
    return next;
  }

  return {
    async rpc(fn, args) {
      const result = await client.rpc(fn, args as Record<string, unknown>);
      if (result.error) {
        const message =
          typeof result.error === 'object' && result.error !== null && 'message' in result.error
            ? String((result.error as { message: unknown }).message)
            : String(result.error);
        throw new Error(`durable rpc ${fn}: ${message}`);
      }
      return result.data;
    },

    async select(name, criteria) {
      const result = (await applyCriteria(table(name).select('*'), criteria).then(
        (value) => value,
      )) as { data: unknown; error: unknown };
      return rowsOf(result, `durable select ${name}`);
    },

    async insert(name, row, options) {
      const result = (await table(name)
        .insert(options?.ignoreConflict ? { ...row } : row)
        .select('*')
        .then((value) => value)) as { data: unknown; error: unknown };

      if (options?.ignoreConflict && result.error) {
        const code =
          typeof result.error === 'object' && result.error !== null && 'code' in result.error
            ? String((result.error as { code: unknown }).code)
            : '';
        // 23505 is a unique violation, which for an ignore-conflict insert is
        // the ORDINARY answer — "somebody already holds this key" — and the
        // caller reads it as an empty result and goes and fetches the winner.
        if (code === '23505') return [];
      }
      return rowsOf(result, `durable insert ${name}`);
    },

    async update(name, patch, match) {
      let query = table(name).update(patch);
      for (const [column, value] of Object.entries(match)) query = query.eq(column, value);
      const result = (await query.select('*').then((value) => value)) as {
        data: unknown;
        error: unknown;
      };
      return rowsOf(result, `durable update ${name}`);
    },
  };
}
