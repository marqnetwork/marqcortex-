/**
 * A2-P08-C03 — the cross-domain persistence-mode invariant.
 *
 * All sixteen (workflow, agent) pairs have an EXPLICIT expected answer here —
 * no pair is covered by a rule the test merely trusts — and every one is
 * checked twice: against the pure validator and through the REAL bootstrap.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  COMBINED_CUTOVER_SEQUENCE,
  COMBINED_ROLLBACK_SEQUENCE,
  RUNTIME_PERSISTENCE_CORRIDOR,
  runtimePersistencePairProblem,
  sequenceProblems,
} from '../persistence/runtimeCutoverPlan.ts';
import { planTransition, type RuntimePersistenceMode } from '../persistence/runtimePersistenceAuthority.ts';
import {
  getAgentRuntime,
  getWorkflowRuntime,
  initializeControlPlane,
  resetControlPlaneForTests,
} from '../bootstrap.ts';
import { recordEnv } from '../runtime/env.ts';
import { createFakeKv } from './agentFixtures.ts';
import { makeAgentRun } from './agentPersistenceContract.ts';
import { makeRun } from './workflowPersistenceContract.ts';

const ORG = '9c96dbbd-b389-4f8b-811f-1815c4f8a9e0';

/** workflow mode → agent mode → SAFE or UNSAFE. All sixteen, written out. */
const EXPECTED: Readonly<Record<RuntimePersistenceMode, Readonly<Record<RuntimePersistenceMode, 'SAFE' | 'UNSAFE'>>>> = {
  kv:         { kv: 'SAFE',   kv_frozen: 'UNSAFE', sql_frozen: 'UNSAFE', sql: 'UNSAFE' },
  kv_frozen:  { kv: 'SAFE',   kv_frozen: 'SAFE',   sql_frozen: 'SAFE',   sql: 'UNSAFE' },
  sql_frozen: { kv: 'UNSAFE', kv_frozen: 'UNSAFE', sql_frozen: 'SAFE',   sql: 'SAFE' },
  sql:        { kv: 'UNSAFE', kv_frozen: 'UNSAFE', sql_frozen: 'UNSAFE', sql: 'SAFE' },
};
const MODES = Object.keys(EXPECTED) as RuntimePersistenceMode[];

describe('A2-P08-C03 — the 4x4 pair table, pure', () => {
  for (const workflow of MODES) {
    for (const agent of MODES) {
      const expected = EXPECTED[workflow][agent];
      it(`workflow=${workflow} agent=${agent} is ${expected}`, () => {
        const problem = runtimePersistencePairProblem(workflow, agent);
        if (expected === 'SAFE') assert.equal(problem, undefined);
        else assert.match(problem ?? '', /not on the reviewed A2 cutover corridor/);
      });
    }
  }

  it('the SAFE cells are exactly the seven corridor states', () => {
    const safe = MODES.flatMap((w) => MODES.filter((a) => EXPECTED[w][a] === 'SAFE').map((a) => `${w}/${a}`));
    assert.deepEqual(safe.sort(), RUNTIME_PERSISTENCE_CORRIDOR.map((p) => `${p.workflow}/${p.agent}`).sort());
    assert.equal(safe.length, 7);
  });
});

describe('A2-P08-C03 — the corridor is walkable, one domain and one permitted edge at a time', () => {
  it('forward: workflow freezes first, agent authority moves first, agent unfreezes first', () => {
    assert.deepEqual(sequenceProblems(COMBINED_CUTOVER_SEQUENCE), []);
    const order = COMBINED_CUTOVER_SEQUENCE.map((s) => `${s.workflow}/${s.agent}`);
    assert.deepEqual(order, [
      'kv/kv', 'kv_frozen/kv', 'kv_frozen/kv_frozen', 'kv_frozen/sql_frozen',
      'sql_frozen/sql_frozen', 'sql_frozen/sql', 'sql/sql',
    ]);
  });

  it('the final zero-estate recheck is required only once BOTH domains are frozen', () => {
    const recheckAt = COMBINED_CUTOVER_SEQUENCE.findIndex((s) => /FINAL zero-estate recheck/.test(s.requires));
    const prior = COMBINED_CUTOVER_SEQUENCE[recheckAt - 1];
    assert.deepEqual([prior.workflow, prior.agent], ['kv_frozen', 'kv_frozen']);
    assert.ok(COMBINED_CUTOVER_SEQUENCE.slice(0, recheckAt).every((s) => !/zero-estate/.test(s.requires)));
  });

  it('rollback is the exact reverse corridor, and is walkable', () => {
    assert.deepEqual(sequenceProblems(COMBINED_ROLLBACK_SEQUENCE), []);
    assert.deepEqual(COMBINED_ROLLBACK_SEQUENCE.map((s) => `${s.workflow}/${s.agent}`), [
      'sql/sql', 'sql_frozen/sql', 'sql_frozen/sql_frozen', 'kv_frozen/sql_frozen',
      'kv_frozen/kv_frozen', 'kv_frozen/kv', 'kv/kv',
    ]);
  });

  it('rollback past SQL authority still needs each domain\'s SQL estate to be zero — nothing is copied back', () => {
    const rows = { runs: 1, checkpoints: 0, approvals: 0 };
    const agent = planTransition('agent', 'sql_frozen', 'kv_frozen', { sqlEstate: rows });
    const workflow = planTransition('workflow', 'sql_frozen', 'kv_frozen', { sqlEstate: rows });
    assert.equal(!agent.allowed && agent.code, 'ROLLBACK_WINDOW_CLOSED');
    assert.equal(!workflow.allowed && workflow.code, 'ROLLBACK_WINDOW_CLOSED');
  });

  it('a sequence that moves both domains at once, or leaves the corridor, is reported', () => {
    assert.ok(sequenceProblems([{ workflow: 'kv_frozen', agent: 'kv_frozen' }, { workflow: 'sql_frozen', agent: 'sql_frozen' }]).some((p) => /2 domains move at once/.test(p)));
    assert.ok(sequenceProblems([{ workflow: 'kv', agent: 'kv' }, { workflow: 'kv', agent: 'kv_frozen' }]).some((p) => /not on the reviewed/.test(p)));
  });
});

// ── Through the real bootstrap ──────────────────────────────────────────────

function boot(workflow: RuntimePersistenceMode, agent: RuntimePersistenceMode) {
  resetControlPlaneForTests();
  const kv = createFakeKv();
  const calls: string[] = [];
  initializeControlPlane({
    env: recordEnv({ AI_DEFAULT_ORGANIZATION_ID: 'marq-cortex', AI_WORKFLOW_PERSISTENCE: workflow, AI_AGENT_PERSISTENCE: agent }),
    kvWrite: (key, value) => { kv.poke(key, value); return Promise.resolve(); },
    kvRead: kv.read,
    kvReadByPrefix: kv.readByPrefix,
    kvCompareAndSwapField: kv.compareAndSwap,
    runtimePersistenceGateway: { rpc: (fn: string) => { calls.push(fn); return Promise.resolve(fn.endsWith('_create') ? true : []); } },
  });
  return { kv, calls, workflows: getWorkflowRuntime()!, agents: getAgentRuntime()! };
}

async function writes(attempt: () => Promise<unknown>): Promise<'written' | string> {
  try {
    await attempt();
    return 'written';
  } catch (error) {
    return (error as { failure?: string }).failure ?? String(error);
  }
}

afterEach(() => resetControlPlaneForTests());

describe('A2-P08-C03 — every pair through the REAL bootstrap', () => {
  for (const workflow of MODES) {
    for (const agent of MODES) {
      const expected = EXPECTED[workflow][agent];
      it(`bootstrap ${workflow}/${agent}: ${expected === 'SAFE' ? 'each domain writes iff its own mode writes, to its own authority' : 'mutation refused in BOTH domains, modes not downgraded'}`, async () => {
        const { kv, calls, workflows, agents } = boot(workflow, agent);
        const wf = await writes(() => workflows.runs.create(makeRun({ organizationId: ORG })));
        const ag = await writes(() => agents.runs.create(makeAgentRun({ organizationId: ORG })));
        const writing = (mode: RuntimePersistenceMode) => mode === 'kv' || mode === 'sql';
        if (expected === 'UNSAFE') {
          assert.equal(wf, 'workflow_persistence_failed');
          assert.equal(ag, 'persistence_failed');
          assert.deepEqual(kv.keys().filter((k) => /:ai:(workflow|agent)_/.test(k)), []);
          assert.ok(!calls.some((fn) => fn.endsWith('_create')), 'an unsafe pair reached SQL with a write');
          return;
        }
        assert.equal(wf, writing(workflow) ? 'written' : 'workflow_persistence_failed');
        assert.equal(ag, writing(agent) ? 'written' : 'persistence_failed');
        // Each write landed in ITS domain's authority and nowhere else.
        assert.equal(kv.keys().some((k) => k.includes(':ai:workflow_run:')), wf === 'written' && workflow === 'kv');
        assert.equal(kv.keys().some((k) => k.includes(':ai:agent_run:')), ag === 'written' && agent === 'kv');
        assert.equal(calls.includes('workflow_run_create'), wf === 'written' && workflow === 'sql');
        assert.equal(calls.includes('agent_run_create'), ag === 'written' && agent === 'sql');
      });
    }
  }

  it('reads keep working in an unsafe pair, from each domain\'s CONFIGURED authority (no downgrade)', async () => {
    const { calls, workflows } = boot('sql', 'kv');
    await workflows.runs.list({ organizationId: ORG });
    assert.deepEqual(calls, ['workflow_run_list'], 'the workflow still reads SQL, as configured');
  });
});
