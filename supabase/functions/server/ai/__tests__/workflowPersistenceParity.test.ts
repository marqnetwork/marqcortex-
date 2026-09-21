/**
 * THE PARITY GATE — memory and the key-value store, one set of assertions
 * (BP-003 / A2).
 *
 * `workflowPersistenceContract.ts` holds the cases. This file drives two of the
 * three implementations through them; `scripts/workflow-persistence-scenarios.ts`
 * drives the third against a live PostgreSQL, because a SQL store asserted
 * against a fake database proves nothing about a database.
 *
 * ── WHY THE KEY-VALUE STORE IS IN A PARITY SUITE AT ALL ───────────────────
 *
 * It is the PRODUCTION AUTHORITY, and it is the baseline the SQL store has to
 * match. Running it through the same cases is what makes "the SQL store
 * behaves like production" a measured claim rather than a reading of two files
 * side by side. It also pins the baseline: if a later packet changes the
 * key-value store's behaviour, this suite fails here rather than being
 * discovered as a divergence after a cutover.
 *
 * The compare-and-swap harness is `createFakeKv` — the same deterministic
 * field-keyed conditional writer the agent and financial suites use, and the
 * same contract `kv_compare_and_swap_field` implements.
 *
 * ── WHAT THIS PROVES, AND WHAT IT DOES NOT ────────────────────────────────
 *
 * Equivalent domain behaviour for UUID-backed tenants. It is NOT a claim of
 * parity across every organization identifier the current tenancy grammar
 * permits: a slug-shaped tenant is storable in the key-value store and
 * unnameable in the relational one, which is a known cutover blocker rather
 * than a divergence this packet resolves. Production is still the key-value
 * store, so nothing in service today depends on the difference. See the header
 * of `workflowPersistenceContract.ts`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createMemoryWorkflowApprovalStore,
  createMemoryWorkflowCheckpointStore,
  createMemoryWorkflowRunStore,
} from '../workflows/persistence/ports.ts';
import {
  createKvWorkflowApprovalStore,
  createKvWorkflowCheckpointStore,
  createKvWorkflowRunStore,
} from '../workflows/persistence/kvWorkflowStores.ts';
import { createFakeKv } from './agentFixtures.ts';
import {
  WORKFLOW_PERSISTENCE_CASES,
  type WorkflowPersistenceHarness,
} from './workflowPersistenceContract.ts';

/**
 * The in-memory reference.
 *
 * It declares `workflow_run_not_found` for a save against a record that is not
 * stored, because it reads before it writes and can tell absence from
 * staleness. See the contract file's header: the difference is pre-existing,
 * it is declared rather than smoothed over, and the SQL store declares the
 * DURABLE answer because the durable store is what production runs.
 */
function memoryHarness(): WorkflowPersistenceHarness {
  const runs = createMemoryWorkflowRunStore();
  const checkpoints = createMemoryWorkflowCheckpointStore();
  const approvals = createMemoryWorkflowApprovalStore();
  return {
    name: 'memory',
    runs,
    checkpoints,
    approvals,
    missingSaveFailure: 'workflow_run_not_found',
    missingApprovalSaveFailure: 'workflow_approval_not_found',
    // Memory holds no referential integrity, so seeding a parent run is simply
    // creating it. The call exists so the fixture is identical across
    // implementations rather than branching on which one is under test.
    seedRun: (record) => runs.create(record),
    reset: () => Promise.resolve(),
  };
}

/** The production authority, over a deterministic compare-and-swap harness. */
function kvHarness(): WorkflowPersistenceHarness {
  const kv = createFakeKv();
  const corrupt: string[] = [];
  const options = {
    read: kv.read,
    readByPrefix: kv.readByPrefix,
    compareAndSwap: kv.compareAndSwap,
    onCorrupt: (key: string, detail: string) => corrupt.push(`${key}: ${detail}`),
  };
  const runs = createKvWorkflowRunStore(options);
  return {
    name: 'kv',
    runs,
    checkpoints: createKvWorkflowCheckpointStore(options),
    approvals: createKvWorkflowApprovalStore(options),
    // `kv_compare_and_swap_field` cannot distinguish a record that moved on
    // from a record that was never there. Both are a lost swap.
    missingSaveFailure: 'stale_workflow_version',
    missingApprovalSaveFailure: 'stale_workflow_approval',
    seedRun: (record) => runs.create(record),
    reset: () => Promise.resolve(),
  };
}

for (const build of [memoryHarness, kvHarness]) {
  describe(`workflow persistence contract — ${build().name}`, () => {
    for (const testCase of WORKFLOW_PERSISTENCE_CASES) {
      it(testCase.name, async () => {
        // A FRESH STORE PER CASE. These stores are bounded and evicting, and a
        // suite that shared one would eventually be asserting about eviction
        // rather than about the contract.
        const harness = build();
        await harness.reset();
        await testCase.run(harness);
      });
    }
  });
}

/**
 * The two implementations answer the pre-existing divergence differently, and
 * this is where that is written down.
 *
 * Asserted rather than commented, so a future change that quietly aligned them
 * — or widened the gap — fails here instead of being discovered during a
 * cutover. The SQL store's answer is asserted in the live suite; it matches the
 * key-value store's, deliberately.
 */
describe('workflow persistence contract — the declared divergence', () => {
  it('memory tells absence from staleness and the durable store cannot', () => {
    assert.equal(memoryHarness().missingSaveFailure, 'workflow_run_not_found');
    assert.equal(kvHarness().missingSaveFailure, 'stale_workflow_version');
    assert.equal(memoryHarness().missingApprovalSaveFailure, 'workflow_approval_not_found');
    assert.equal(kvHarness().missingApprovalSaveFailure, 'stale_workflow_approval');
  });

  it('runs every case against both implementations, and the list is not empty', () => {
    // A parity suite that silently ran zero cases would report the strongest
    // possible result for the weakest possible reason.
    assert.ok(
      WORKFLOW_PERSISTENCE_CASES.length >= 30,
      `expected the full contract, found ${WORKFLOW_PERSISTENCE_CASES.length} cases`,
    );
  });
});
