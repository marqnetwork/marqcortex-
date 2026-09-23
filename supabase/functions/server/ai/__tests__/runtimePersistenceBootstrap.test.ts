/**
 * A2-P06-C03 — the mode, through the REAL bootstrap.
 *
 * `initializeControlPlane` is the function the edge entry point calls. These
 * cases boot it with the same kinds of dependencies `index.tsx` supplies and
 * assert, against the runtimes it actually built, which store each domain
 * writes to. The composition's own suite proves the modes; this proves the
 * deployment reads them — the seam where the first draft silently read nothing.
 */

import { afterEach, describe, it, mock } from 'node:test';
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
import { RUNTIME_PERSISTENCE_CORRIDOR } from '../persistence/runtimeCutoverPlan.ts';

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

/**
 * Gate W prerequisite 2: after each `secrets set` + redeploy the operator
 * observes the composed state in the Edge Function log. The line must name the
 * mode each domain actually composed to — not the one that was intended.
 */
describe('A2 Gate W — the boot log names the composed corridor state', () => {
  function bootLines(env: Record<string, string>): string[] {
    const logged = mock.method(console, 'log', () => undefined);
    const errors = mock.method(console, 'error', () => undefined);
    try {
      boot(env);
      return logged.mock.calls
        .map((call) => String(call.arguments[0]))
        .filter((line) => line.startsWith('[ai] runtime persistence:'));
    } finally {
      logged.mock.restore();
      errors.mock.restore();
    }
  }

  it('every corridor pair: exactly one line, both modes, on_corridor', () => {
    for (const pair of RUNTIME_PERSISTENCE_CORRIDOR) {
      const lines = bootLines({ AI_WORKFLOW_PERSISTENCE: pair.workflow, AI_AGENT_PERSISTENCE: pair.agent });
      assert.equal(lines.length, 1, `${pair.workflow}/${pair.agent}`);
      assert.match(lines[0], new RegExp(`workflow=${pair.workflow} \\(`));
      assert.match(lines[0], new RegExp(`agent=${pair.agent} \\(`));
      assert.match(lines[0], / pair=on_corridor$/);
      for (const [name, mode] of [['workflow', pair.workflow], ['agent', pair.agent]] as const) {
        const state = mode.endsWith('_frozen') ? 'frozen' : 'writable';
        const authority = mode.startsWith('sql') ? 'sql' : 'kv';
        assert.match(lines[0], new RegExp(`${name}=${mode} \\(authority ${authority}, ${state}\\)`));
      }
    }
  });

  it('unset is reported as kv/kv — the production baseline', () => {
    const [line] = bootLines({});
    assert.equal(
      line,
      '[ai] runtime persistence: workflow=kv (authority kv, writable) agent=kv (authority kv, writable) pair=on_corridor',
    );
  });

  it('an off-corridor pair is reported OFF_CORRIDOR, both domains mutation-refused (reads stay)', () => {
    const [line] = bootLines({ AI_WORKFLOW_PERSISTENCE: 'sql', AI_AGENT_PERSISTENCE: 'kv' });
    assert.match(line, /workflow=sql \(authority sql, frozen\)/);
    assert.match(line, /agent=kv \(authority kv, frozen\)/);
    assert.match(line, / pair=OFF_CORRIDOR$/);
  });

  it('an unrecognised value is reported, never echoed', () => {
    const [line] = bootLines({ AI_WORKFLOW_PERSISTENCE: 'sq1-typo', AI_AGENT_PERSISTENCE: 'kv' });
    assert.match(line, /workflow=UNRECOGNISED \(authority none, refusing\)/);
    assert.ok(!line.includes('sq1-typo'));
  });
});
