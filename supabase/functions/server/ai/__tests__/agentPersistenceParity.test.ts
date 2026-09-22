/**
 * THE AGENT PARITY GATE — memory and the key-value store, one set of
 * assertions (A2-P07).
 *
 * `agentPersistenceContract.ts` holds the cases. This file drives the
 * in-memory reference and the PRODUCTION AUTHORITY (the key-value store, over
 * `createFakeKv`, which implements the `kv_compare_and_swap_field` contract);
 * `scripts/agent-persistence-scenarios.ts` drives the SQL candidate through the
 * same list against a live PostgreSQL.
 *
 * Equivalent domain behaviour for UUID-backed tenants — not parity across every
 * identifier the tenancy grammar admits. See the contract file's header.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createMemoryAgentRunStore,
  createMemoryApprovalStore,
  createMemoryCheckpointStore,
} from '../agents/persistence/ports.ts';
import {
  createKvAgentApprovalStore,
  createKvAgentCheckpointStore,
  createKvAgentRunStore,
} from '../agents/persistence/kvAgentStores.ts';
import { createFakeKv } from './agentFixtures.ts';
import {
  AGENT_PERSISTENCE_CASES,
  type AgentPersistenceHarness,
} from './agentPersistenceContract.ts';

function memoryHarness(): AgentPersistenceHarness {
  const runs = createMemoryAgentRunStore();
  return {
    name: 'memory',
    runs,
    checkpoints: createMemoryCheckpointStore(),
    approvals: createMemoryApprovalStore(),
    // Memory reads before it writes, so it can tell absence from staleness.
    missingSaveFailure: 'run_not_found',
    missingApprovalSaveFailure: 'run_not_found',
    seedRun: (record) => runs.create(record),
    reset: () => Promise.resolve(),
  };
}

function kvHarness(): AgentPersistenceHarness {
  const kv = createFakeKv();
  const options = { read: kv.read, readByPrefix: kv.readByPrefix, compareAndSwap: kv.compareAndSwap };
  const runs = createKvAgentRunStore(options);
  return {
    name: 'kv',
    runs,
    checkpoints: createKvAgentCheckpointStore(options),
    approvals: createKvAgentApprovalStore(options),
    // A lost swap, whether the record moved on or was never there.
    missingSaveFailure: 'stale_run_version',
    missingApprovalSaveFailure: 'stale_run_version',
    seedRun: (record) => runs.create(record),
    reset: () => Promise.resolve(),
  };
}

for (const build of [memoryHarness, kvHarness]) {
  describe(`agent persistence contract — ${build().name}`, () => {
    for (const testCase of AGENT_PERSISTENCE_CASES) {
      it(testCase.name, async () => {
        const harness = build();
        await harness.reset();
        await testCase.run(harness);
      });
    }
  });
}

describe('agent persistence contract — the declared divergence', () => {
  it('memory tells absence from staleness and the durable store cannot', () => {
    assert.equal(memoryHarness().missingSaveFailure, 'run_not_found');
    assert.equal(kvHarness().missingSaveFailure, 'stale_run_version');
    assert.equal(memoryHarness().missingApprovalSaveFailure, 'run_not_found');
    assert.equal(kvHarness().missingApprovalSaveFailure, 'stale_run_version');
  });

  it('runs a real contract, not an empty list', () => {
    assert.ok(AGENT_PERSISTENCE_CASES.length >= 25, `found ${AGENT_PERSISTENCE_CASES.length} cases`);
  });
});
