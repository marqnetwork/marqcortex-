/**
 * BP-002 — the durable runtime as the DEPLOYED SERVER composes it.
 *
 * ── THE GAP THIS FILE CLOSES ──────────────────────────────────────────────
 *
 * Every other BP-002 suite drives a harness: it builds its own stores, its own
 * registry and its own worker, and proves the runtime behaves. None of them
 * could tell you whether the SERVER builds one. It did not — the first version
 * of this packet shipped a library and a test suite, and nothing in the
 * deployed path constructed a gateway or registered the pilot.
 *
 * So the assertions here are about the composition module itself: that it
 * exists, that it registers the pilot against the real workflow approval gate
 * rather than a fixture, that the server entry point calls it, and that it
 * schedules nothing on its own.
 *
 * It is a SOURCE-LEVEL suite for the wiring and a behavioural one for the
 * gateway, because the wiring claim is about absence — no cron, no route, no
 * second gate — and a source scan is the only thing that can make that claim.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { createSupabaseDurableGateway } from '../../supabase/functions/server/durableSqlGateway.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const COMPOSITION =
  read('supabase/functions/server/durableRuntimeComposition.ts') +
  read('supabase/functions/server/durableSqlGateway.ts');
const ENTRY = read('supabase/functions/server/index.tsx');

const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('the server actually composes the durable runtime', () => {
  it('is imported and called by the server entry point', () => {
    // The whole point. Without this the packet is a library nobody builds.
    const code = stripComments(ENTRY);
    assert.match(code, /from\s+["']\.\/durableRuntimeComposition\.ts["']/);
    assert.match(code, /getDurableRuntime\s*\(\s*\)/);
  });

  it('registers the A1 pilot against the REAL workflow approval gate', () => {
    const code = stripComments(COMPOSITION);
    assert.match(code, /APPROVAL_EXPIRY_DECLARATION/);
    assert.match(code, /createApprovalExpirySweep\s*\(/);
    // `workflows.approvals` is the gate the operator surface and the engine
    // already use. A second gate would be a second answer to "is this approval
    // still pending".
    assert.match(code, /gate:\s*workflows\.approvals/);
    assert.match(code, /getWorkflowRuntime\s*\(\s*\)/);
  });

  it('builds the Postgres stores, not the in-memory reference ones', () => {
    const code = stripComments(COMPOSITION);
    assert.match(code, /createPostgresDurableStores\s*\(/);
    assert.equal(
      /createMemoryDurableStores/.test(code),
      false,
      'the deployed composition must never use the test reference store',
    );
  });

  it('schedules nothing and mounts no route', () => {
    // BP-002 §10: implement the scheduler runtime, do not configure production
    // cron. And an unauthenticated endpoint that drains a tenant's queue is an
    // authority surface, not a convenience.
    const code = stripComments(COMPOSITION);
    assert.equal(/Deno\.cron|setInterval|setTimeout|cron\.schedule/.test(code), false);
    assert.equal(/app\.(get|post|put|delete)\s*\(/.test(code), false);
    assert.equal(
      /registerDurable\w*Routes/.test(stripComments(ENTRY)),
      false,
      'BP-002 mounts no HTTP surface',
    );
  });

  it('fails closed, and says why, when it cannot be composed', () => {
    // A half-composed runtime that claims jobs and cannot run their handler is
    // worse than one that plainly did not start.
    const code = stripComments(COMPOSITION);
    assert.match(code, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.match(code, /unavailableReason/);
    assert.match(code, /return undefined/);
  });

  it('opens one client per isolate, not one per caller', () => {
    // The claim this asserts is memoisation, NOT laziness. The server composes
    // the runtime during module initialisation — deliberately, so a missing
    // service key shows up in the startup log rather than on a first tick that
    // may never come — and an earlier version of the comment here said the
    // opposite. What must hold is that `createClient` is reached through the
    // memoised factory, so however many callers ask, an isolate opens one.
    const code = stripComments(COMPOSITION);
    assert.equal(
      /^const\s+\w+\s*=\s*createClient\s*\(/m.test(code),
      false,
      'the client must be built inside the memoised factory, not at module scope',
    );
    assert.match(code, /if\s*\(runtime\)\s*return runtime;/, 'the factory must memoise');
    assert.match(code, /runtime\s*=\s*\{/, 'and must store what it built');
  });

  it('says plainly that it is composed at startup', () => {
    // The comment and the call site have to agree. They did not: the module
    // claimed "no eager construction ... built on first use" while index.tsx
    // called it during initialisation. Asserted so the two cannot drift apart
    // again without a test noticing.
    const doc = COMPOSITION;
    assert.equal(
      /NO EAGER CONSTRUCTION/.test(doc),
      false,
      'the module must not claim laziness it does not have',
    );
    assert.match(doc, /BUILT ONCE PER ISOLATE, AT STARTUP/);
    // And the call site really is module-level, which is what makes that true.
    const entry = stripComments(ENTRY);
    assert.match(entry, /^const durableRuntime = getDurableRuntime\(\);$/m);
  });
});

describe('the gateway speaks exactly four verbs', () => {
  /** A fake Supabase builder that records what it was asked to do. */
  function fakeClient() {
    const calls: Record<string, unknown>[] = [];
    const builder = (table: string, verb: string, payload?: unknown) => {
      const state: Record<string, unknown> = { table, verb, payload, eq: {}, order: null, limit: null, in: null };
      const self: Record<string, unknown> = {
        select: () => self,
        insert: (row: unknown) => {
          state.verb = 'insert';
          state.payload = row;
          return self;
        },
        update: (patch: unknown) => {
          state.verb = 'update';
          state.payload = patch;
          return self;
        },
        eq: (column: string, value: unknown) => {
          (state.eq as Record<string, unknown>)[column] = value;
          return self;
        },
        in: (column: string, values: readonly unknown[]) => {
          state.in = { column, values };
          return self;
        },
        order: (column: string, options: { ascending: boolean }) => {
          state.order = { column, ...options };
          return self;
        },
        limit: (count: number) => {
          state.limit = count;
          return self;
        },
        then: (resolve: (value: { data: unknown; error: unknown }) => unknown) => {
          calls.push(state);
          return Promise.resolve(resolve({ data: [{ id: 'row-1' }], error: null }));
        },
      };
      return self;
    };

    const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
    return {
      calls,
      rpcCalls,
      client: {
        rpc: async (fn: string, args: Record<string, unknown>) => {
          rpcCalls.push({ fn, args });
          return { data: [{ ok: true }], error: null };
        },
        from: (table: string) => builder(table, 'select'),
      },
    };
  }

  it('passes an RPC through untouched', async () => {
    const fake = fakeClient();
    const gateway = createSupabaseDurableGateway(
      fake.client as unknown as Parameters<typeof createSupabaseDurableGateway>[0],
    );
    await gateway.rpc('durable_job_claim', { p_worker: 'w' });
    assert.deepEqual(fake.rpcCalls, [{ fn: 'durable_job_claim', args: { p_worker: 'w' } }]);
  });

  it('turns criteria into equality, membership, order and limit', async () => {
    const fake = fakeClient();
    const gateway = createSupabaseDurableGateway(
      fake.client as unknown as Parameters<typeof createSupabaseDurableGateway>[0],
    );
    await gateway.select('durable_jobs', {
      match: { organization_id: 'org-1', job_type: 't' },
      inList: { column: 'state', values: ['queued', 'paused'] },
      order: { column: 'created_at', ascending: true },
      limit: 25,
    });

    const call = fake.calls.at(-1);
    assert.deepEqual(call?.eq, { organization_id: 'org-1', job_type: 't' });
    assert.deepEqual(call?.in, { column: 'state', values: ['queued', 'paused'] });
    assert.deepEqual(call?.order, { column: 'created_at', ascending: true });
    assert.equal(call?.limit, 25);
  });

  it('reads a unique violation on an ignore-conflict insert as "somebody already has it"', async () => {
    // Not an error the caller has to catch: enqueueing the same logical work
    // twice is the ordinary consequence of a retried request.
    const gateway = createSupabaseDurableGateway({
      rpc: async () => ({ data: null, error: null }),
      from: () => ({
        insert: () => ({
          select: () => ({
            then: (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
              Promise.resolve(resolve({ data: null, error: { code: '23505', message: 'dup' } })),
          }),
        }),
      }),
    } as unknown as Parameters<typeof createSupabaseDurableGateway>[0]);

    assert.deepEqual(
      await gateway.insert('durable_jobs', { id: 1 }, { ignoreConflict: true }),
      [],
    );
  });

  it('throws on a storage error rather than returning nothing', async () => {
    // An error that returned an empty array would look exactly like "nothing
    // was due", and a worker would report a healthy idle tick while the
    // database was unreachable.
    const gateway = createSupabaseDurableGateway({
      rpc: async () => ({ data: null, error: { message: 'connection refused' } }),
      from: () => ({
        select: () => ({
          then: (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
            Promise.resolve(resolve({ data: null, error: { message: 'connection refused' } })),
        }),
      }),
    } as unknown as Parameters<typeof createSupabaseDurableGateway>[0]);

    await assert.rejects(() => gateway.rpc('durable_job_claim', {}), /connection refused/);
    await assert.rejects(() => gateway.select('durable_jobs', {}), /connection refused/);
  });
});
