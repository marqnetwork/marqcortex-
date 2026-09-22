/**
 * A2-P07 — the SQL agent stores at their seams, without a database.
 *
 * What the live suite cannot show cheaply: that a tenant the relational
 * authority cannot name never reaches the database, that a database refusal
 * becomes the agent failure vocabulary rather than a Postgres sentence, and
 * that production still cannot select these stores.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AGENT_RPC,
  createSqlAgentStores,
  isRelationalOrganizationId,
  type AgentSqlGateway,
} from '../agents/persistence/sqlAgentStores.ts';
import { isAgentRuntimeError } from '../agents/contracts/failures.ts';
import {
  AGENT_ALPHA,
  makeAgentApproval,
  makeAgentCheckpoint,
  makeAgentRun,
} from './agentPersistenceContract.ts';

const AI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const bootstrap = readFileSync(join(AI_ROOT, 'bootstrap.ts'), 'utf8');

function recordingGateway(answer: (fn: string) => unknown = () => []): AgentSqlGateway & {
  readonly calls: { fn: string; args: Readonly<Record<string, unknown>> }[];
} {
  const calls: { fn: string; args: Readonly<Record<string, unknown>> }[] = [];
  return {
    calls,
    rpc(fn, args) {
      calls.push({ fn, args });
      try {
        return Promise.resolve(answer(fn));
      } catch (error) {
        return Promise.reject(error);
      }
    },
  };
}

const SLUG = 'marq-cortex';

describe('A2-P07 did not cut production over', () => {
  it('bootstrap builds the agent stores only through the runtime persistence composition (default KV)', () => {
    // A2-P06 restatement; the default-is-KV proof is behavioural, in
    // `runtimePersistenceComposition.test.ts`.
    assert.match(bootstrap, /runtimePersistence\.agent\.stores/);
    assert.doesNotMatch(bootstrap, /createKvAgent(Run|Checkpoint|Approval)Store\(/);
  });

  it('bootstrap imports nothing from the SQL agent stores', () => {
    assert.doesNotMatch(bootstrap, /sqlAgentStores|createSqlAgent/);
  });
});

describe('A2-P07 fails closed for a tenant the relational authority cannot name', () => {
  it('recognises a UUID and refuses the slug-shaped default', () => {
    assert.equal(isRelationalOrganizationId(AGENT_ALPHA), true);
    assert.equal(isRelationalOrganizationId(SLUG), false);
  });

  it('refuses every write path with a typed persistence failure, never reaching the database', async () => {
    const gateway = recordingGateway();
    const stores = createSqlAgentStores({ gateway });
    const writes: (() => Promise<void>)[] = [
      () => stores.runStore.create(makeAgentRun({ organizationId: SLUG })),
      () => stores.runStore.save(makeAgentRun({ organizationId: SLUG, runVersion: 2 }), 1),
      () => stores.checkpointStore.write(makeAgentCheckpoint(1, { organizationId: SLUG })),
      () => stores.approvalStore.create(makeAgentApproval({ organizationId: SLUG })),
      () => stores.approvalStore.save(makeAgentApproval({ organizationId: SLUG, approvalVersion: 2 }), 1),
    ];
    for (const write of writes) {
      await assert.rejects(write, (error: unknown) => {
        assert.ok(isAgentRuntimeError(error));
        assert.equal(error.failure, 'persistence_failed');
        assert.match(error.diagnostics ?? '', /not a relational organization id/);
        return true;
      });
    }
    assert.deepEqual(gateway.calls, [], 'an unrepresentable identifier never reached the database');
  });

  it('answers reads honestly rather than raising', async () => {
    const gateway = recordingGateway();
    const stores = createSqlAgentStores({ gateway });
    assert.equal(await stores.runStore.load(SLUG, 'run_x'), undefined);
    assert.deepEqual(await stores.runStore.list({ organizationId: SLUG }), []);
    assert.equal(await stores.checkpointStore.latest(SLUG, 'run_x'), undefined);
    assert.deepEqual(await stores.checkpointStore.history(SLUG, 'run_x'), []);
    assert.equal(await stores.approvalStore.load(SLUG, 'apr_x'), undefined);
    assert.deepEqual(await stores.approvalStore.list({ organizationId: SLUG }), []);
    assert.deepEqual(gateway.calls, []);
  });
});

describe('A2-P07 maps the database onto the agent failure vocabulary', () => {
  it('turns a database refusal into persistence_failed, keeping the detail server-side', async () => {
    const gateway = recordingGateway(() => {
      throw new Error('new row violates check constraint "agent_runs_record_agrees" SQLSTATE 23514');
    });
    const { runStore } = createSqlAgentStores({ gateway });
    await assert.rejects(
      () => runStore.create(makeAgentRun()),
      (error: unknown) => {
        assert.ok(isAgentRuntimeError(error));
        assert.equal(error.failure, 'persistence_failed');
        assert.doesNotMatch(error.message, /constraint|SQLSTATE|agent_runs/);
        assert.match(error.diagnostics ?? '', /agent_runs_record_agrees/);
        assert.equal(error.runId, 'run_contract1');
        return true;
      },
    );
  });

  it('reports `missing` as the stale failure production reports, deliberately', async () => {
    const gateway = recordingGateway((fn) => (fn === AGENT_RPC.runSave || fn === AGENT_RPC.approvalSave ? 'missing' : []));
    const stores = createSqlAgentStores({ gateway });
    for (const save of [
      () => stores.runStore.save(makeAgentRun({ runVersion: 2 }), 1),
      () => stores.approvalStore.save(makeAgentApproval({ approvalVersion: 2 }), 1),
    ]) {
      await assert.rejects(save, (error: unknown) => isAgentRuntimeError(error) && error.failure === 'stale_run_version');
    }
  });

  it('turns a taken id into the same failure the key-value store raises', async () => {
    const gateway = recordingGateway(() => false);
    const stores = createSqlAgentStores({ gateway });
    await assert.rejects(() => stores.runStore.create(makeAgentRun()), (e: unknown) => isAgentRuntimeError(e) && e.failure === 'persistence_failed' && e.message === 'That run already exists.');
    await assert.rejects(() => stores.checkpointStore.write(makeAgentCheckpoint(1)), (e: unknown) => isAgentRuntimeError(e) && e.failure === 'checkpoint_conflict');
    await assert.rejects(() => stores.approvalStore.create(makeAgentApproval()), (e: unknown) => isAgentRuntimeError(e) && e.failure === 'persistence_failed' && e.message === 'That approval already exists.');
  });

  it('projects the relational columns from the record itself', async () => {
    const gateway = recordingGateway(() => true);
    const { runStore, checkpointStore, approvalStore } = createSqlAgentStores({ gateway });
    await runStore.create(makeAgentRun({ agentId: 'agent.x', actorId: 'user_x', checkpointVersion: 3 }));
    await checkpointStore.write(makeAgentCheckpoint(2));
    await approvalStore.create(makeAgentApproval({ state: 'approved', decidedAt: '2026-09-22T10:05:00.000Z' }));
    const [run, checkpoint, approval] = gateway.calls;
    assert.equal(run.fn, AGENT_RPC.runCreate);
    assert.equal(run.args.p_agent_id, 'agent.x');
    assert.equal(run.args.p_actor_id, 'user_x');
    assert.equal(run.args.p_checkpoint_version, 3);
    assert.equal(checkpoint.args.p_previous_digest, 'pdigest_1');
    assert.equal(checkpoint.args.p_progress_digest, 'pdigest_2');
    assert.equal(approval.args.p_decided_at, '2026-09-22T10:05:00.000Z');
    assert.equal(approval.args.p_consumed_at, null);
  });

  it('does not trust a row whose record names another tenant', async () => {
    const corrupt: string[] = [];
    const gateway = recordingGateway(() => [{ record: makeAgentRun({ organizationId: '33333333-3333-4333-8333-333333333333' }) }]);
    const { runStore } = createSqlAgentStores({ gateway, onCorrupt: (location) => corrupt.push(location) });
    assert.equal(await runStore.load(AGENT_ALPHA, 'run_contract1'), undefined);
    assert.equal(corrupt.length, 1);
  });
});
