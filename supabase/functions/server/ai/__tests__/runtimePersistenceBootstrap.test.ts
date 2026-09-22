/**
 * A2-P06-C03 — the mode, through the REAL bootstrap.
 *
 * `initializeControlPlane` is the function the edge entry point calls. These
 * cases boot it with the same kinds of dependencies `index.tsx` supplies and
 * assert, against the runtimes it actually built, which store each domain
 * writes to. The composition's own suite proves the modes; this proves the
 * deployment reads them — the seam where the first draft silently read nothing.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getAgentRuntime,
  getWorkflowRuntime,
  initializeControlPlane,
  resetControlPlaneForTests,
  type BootstrapDependencies,
} from '../bootstrap.ts';
import { recordEnv } from '../runtime/env.ts';
import { createFakeKv } from './agentFixtures.ts';
import { makeAgentRun } from './agentPersistenceContract.ts';
import { makeRun } from './workflowPersistenceContract.ts';

const ORG = '9c96dbbd-b389-4f8b-811f-1815c4f8a9e0';

function boot(env: Record<string, string>, withGateway = true) {
  resetControlPlaneForTests();
  const kv = createFakeKv();
  const calls: string[] = [];
  const deps: BootstrapDependencies = {
    env: recordEnv({ AI_DEFAULT_ORGANIZATION_ID: 'marq-cortex', ...env }),
    kvWrite: (key, value) => {
      kv.poke(key, value);
      return Promise.resolve();
    },
    kvRead: kv.read,
    kvReadByPrefix: kv.readByPrefix,
    kvCompareAndSwapField: kv.compareAndSwap,
    ...(withGateway
      ? {
          runtimePersistenceGateway: {
            rpc: (fn: string) => {
              calls.push(fn);
              return Promise.resolve(fn.endsWith('_create') ? true : []);
            },
          },
        }
      : {}),
  };
  initializeControlPlane(deps);
  const workflows = getWorkflowRuntime();
  const agents = getAgentRuntime();
  assert.ok(workflows && agents, 'bootstrap built both runtimes');
  return { kv, calls, workflows, agents };
}

const failure = (error: unknown) => (error as { failure?: string }).failure;

afterEach(() => resetControlPlaneForTests());

describe('A2-P06-C03 — the real bootstrap honours the runtime persistence mode', () => {
  it('unset: both domains write the key-value store, and the gateway is never called', async () => {
    const { kv, calls, workflows, agents } = boot({});
    await workflows.runs.create(makeRun({ organizationId: ORG }));
    await agents.runs.create(makeAgentRun({ organizationId: ORG }));
    assert.ok(kv.keys().some((key) => key.includes(':ai:workflow_run:')));
    assert.ok(kv.keys().some((key) => key.includes(':ai:agent_run:')));
    assert.deepEqual(calls, []);
  });

  it('kv_frozen: the runtimes bootstrap built refuse every write and still read', async () => {
    const { kv, workflows, agents } = boot({ AI_WORKFLOW_PERSISTENCE: 'kv_frozen', AI_AGENT_PERSISTENCE: 'kv_frozen' });
    await assert.rejects(() => workflows.runs.create(makeRun({ organizationId: ORG })), (e) => failure(e) === 'workflow_persistence_failed');
    await assert.rejects(() => agents.runs.create(makeAgentRun({ organizationId: ORG })), (e) => failure(e) === 'persistence_failed');
    assert.deepEqual(kv.keys().filter((key) => /:ai:(workflow|agent)_/.test(key)), []);
    assert.deepEqual(await workflows.runs.list({ organizationId: ORG }), []);
  });

  it('sql: both domains write through the runtime persistence gateway, and not to KV', async () => {
    const { kv, calls, workflows, agents } = boot({ AI_WORKFLOW_PERSISTENCE: 'sql', AI_AGENT_PERSISTENCE: 'sql' });
    await workflows.runs.create(makeRun({ organizationId: ORG }));
    await agents.runs.create(makeAgentRun({ organizationId: ORG }));
    assert.deepEqual(calls, ['workflow_run_create', 'agent_run_create']);
    assert.deepEqual(kv.keys().filter((key) => /:ai:(workflow|agent)_/.test(key)), []);
  });

  it('sql without the gateway: refused — never a quiet KV or in-memory fallback', async () => {
    const { kv, workflows } = boot({ AI_WORKFLOW_PERSISTENCE: 'sql' }, false);
    await assert.rejects(() => workflows.runs.create(makeRun({ organizationId: ORG })), (e) => failure(e) === 'workflow_persistence_failed');
    await assert.rejects(() => workflows.runs.list({ organizationId: ORG }), (e) => failure(e) === 'workflow_persistence_failed');
    assert.deepEqual(kv.keys().filter((key) => /:ai:workflow_/.test(key)), []);
  });

  it('sql with the default-organization fallback ON for a slug: refused at boot', async () => {
    const { workflows } = boot({ AI_WORKFLOW_PERSISTENCE: 'sql', AI_ALLOW_DEFAULT_ORGANIZATION: 'true' });
    await assert.rejects(() => workflows.runs.list({ organizationId: ORG }), (e) => failure(e) === 'workflow_persistence_failed');
  });
});
