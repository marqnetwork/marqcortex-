/**
 * A2-P06 — the runtime persistence SQL gateway, over the Supabase service
 * client's `rpc`.
 *
 * Its own module for `durableSqlGateway.ts`'s reason: it takes a STRUCTURAL
 * type, not the client library, so the Node test runner can drive the
 * translation directly and nothing here carries an `npm:` specifier.
 *
 * ONE VERB, AND ONLY TWENTY-FOUR NAMES. The workflow and agent SQL stores call
 * exactly the twelve functions of `20260921120002` and the twelve of
 * `20260922120002`. This gateway refuses any other name before it reaches the
 * network, so the service-role client it wraps cannot be turned into a general
 * RPC channel by a caller that holds the gateway — `kv_compare_and_swap`, an
 * administrative function, or anything added later is simply not reachable
 * through it.
 *
 * ERRORS ARE THROWN, NOT SWALLOWED. A PostgREST error that resolved to `null`
 * would read as "no such run" to a load and as a lost race to a create; the
 * stores map a thrown error onto the domain's typed persistence failure.
 *
 * SUPPLYING IT IS NOT ACTIVATION. `bootstrap.ts` hands it to the runtime
 * persistence composition, which uses it only for a domain whose mode is
 * `sql_frozen` or `sql` — and the default mode is `kv`.
 */

import { WORKFLOW_RPC } from './ai/workflows/persistence/sqlWorkflowStores.ts';
import { AGENT_RPC } from './ai/agents/persistence/sqlAgentStores.ts';

export const RUNTIME_PERSISTENCE_FUNCTIONS: ReadonlySet<string> = new Set([
  ...Object.values(WORKFLOW_RPC),
  ...Object.values(AGENT_RPC),
]);

export function createSupabaseRuntimePersistenceGateway(client: {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
}): { rpc(fn: string, args: Readonly<Record<string, unknown>>): Promise<unknown> } {
  return {
    async rpc(fn, args) {
      if (!RUNTIME_PERSISTENCE_FUNCTIONS.has(fn)) {
        throw new Error(`${fn} is not a runtime persistence function`);
      }
      const { data, error } = await client.rpc(fn, { ...args });
      if (error) {
        const message =
          typeof error === 'object' && error !== null && 'message' in error
            ? String((error as { message: unknown }).message)
            : String(error);
        throw new Error(`${fn}: ${message}`);
      }
      return data;
    },
  };
}
