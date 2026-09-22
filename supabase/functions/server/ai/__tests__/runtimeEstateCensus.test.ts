/**
 * A2-P06-C02 — the zero-estate census, and its hosted SQL twin.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { RUNTIME_KEY_NAMESPACES, censusKvRuntimeEstate } from '../persistence/runtimeEstateCensus.ts';
import { isZeroEstate, planTransition } from '../persistence/runtimePersistenceAuthority.ts';
import { runKeyFor as agentRunKey, checkpointKeyFor, approvalKeyFor } from '../agents/persistence/kvAgentStores.ts';
import { AGENT_ID, AGENT_TOKEN, buildTestAgentRuntime, createFakeKv } from './agentFixtures.ts';
import {
  createKvAgentApprovalStore,
  createKvAgentCheckpointStore,
  createKvAgentRunStore,
} from '../agents/persistence/kvAgentStores.ts';

const RECHECK_SQL = readFileSync(
  fileURLToPath(new URL('../../../../../scripts/a2-zero-estate-recheck.sql', import.meta.url)),
  'utf8',
);

describe('A2-P06-C02 — the census counts keys, every key', () => {
  it('reports zero for a snapshot with no runtime keys, whatever else it holds', () => {
    const census = censusKvRuntimeEstate([
      'org:marq:ai:agent_audit:1',
      'org:marq:ai:settings',
      'sub:123',
      'org:marq:ai:workflow_runs_like:x',
      'org:marq:ai:financial_event:1',
    ]);
    assert.equal(census.inspected, 5);
    assert.ok(isZeroEstate(census.domains.workflow));
    assert.ok(isZeroEstate(census.domains.agent));
  });

  it('counts a corrupt, orphaned or slug-tenant row exactly like a valid one', () => {
    const census = censusKvRuntimeEstate([
      'org:marq-cortex:ai:workflow_checkpoint:wfr_orphan:000003',
      'org:BAD TENANT:ai:agent_run:run_x',
      `org:9c96dbbd-b389-4f8b-811f-1815c4f8a9e0:ai:workflow_approval:wfa:x`,
    ]);
    assert.deepEqual(census.domains.workflow, { runs: 0, checkpoints: 1, approvals: 1 });
    assert.deepEqual(census.domains.agent, { runs: 1, checkpoints: 0, approvals: 0 });
    assert.deepEqual(census.tenants.workflow, ['9c96dbbd-b389-4f8b-811f-1815c4f8a9e0', 'marq-cortex']);
  });

  it('counts exactly the keys the real agent runtime writes', async () => {
    const kv = createFakeKv();
    const options = { read: kv.read, readByPrefix: kv.readByPrefix, compareAndSwap: kv.compareAndSwap };
    const harness = buildTestAgentRuntime({
      runStore: createKvAgentRunStore(options),
      checkpointStore: createKvAgentCheckpointStore(options),
      approvalStore: createKvAgentApprovalStore(options),
    });
    const meta = harness.meta(AGENT_TOKEN.consultant);
    const actor = await harness.runtime.service.authorize(meta);
    await harness.runtime.service.createRun(actor, { agentId: AGENT_ID.primary, objective: 'Census.', input: { topic: 'Census', script: 'approved_tool_then_complete' } }, meta);
    const census = censusKvRuntimeEstate(kv.keys());
    assert.equal(census.domains.agent.runs, 1);
    assert.ok(census.domains.agent.checkpoints >= 1);
    assert.equal(census.domains.agent.approvals, 1);
    // And one row is enough to abort the zero-backfill strategy.
    const verdict = planTransition('agent', 'kv_frozen', 'sql_frozen', {
      kvEstate: census.domains.agent,
      sqlEstate: { runs: 0, checkpoints: 0, approvals: 0 },
      sqlSchemaPresent: true,
      tenantConfiguration: { defaultOrganizationId: 'acme', allowDefaultOrganization: false },
    });
    assert.equal(!verdict.allowed && verdict.code, 'ABORT_ZERO_BACKFILL_STRATEGY');
  });

  it('agrees with the key builders the stores use', () => {
    const keys = [agentRunKey('marq', 'run_1'), checkpointKeyFor('marq', 'run_1', 1), approvalKeyFor('marq', 'apr_1')];
    assert.deepEqual(censusKvRuntimeEstate(keys).domains.agent, { runs: 1, checkpoints: 1, approvals: 1 });
  });
});

describe('A2-P06-C02 — the hosted recheck script is the same census, read-only', () => {
  it('uses exactly the six namespaces the census uses', () => {
    for (const domain of ['workflow', 'agent'] as const) {
      for (const namespace of Object.values(RUNTIME_KEY_NAMESPACES[domain])) {
        assert.ok(RECHECK_SQL.includes(`'^org:[^:]+:ai:${namespace}:'`), `${namespace} missing from the SQL recheck`);
      }
    }
  });

  it('forces the session and the transaction read-only, and contains no write', () => {
    assert.match(RECHECK_SQL, /SET default_transaction_read_only = on;\s*BEGIN READ ONLY;/);
    const statements = RECHECK_SQL.replace(/--.*$/gm, '');
    assert.doesNotMatch(statements, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/i);
  });

  it('refuses to report ZERO_ESTATE for a role that cannot see every row', () => {
    assert.match(RECHECK_SQL, /WHEN NOT COALESCE\(who\.sees_every_row, false\) THEN 'INCONCLUSIVE_ROW_SECURITY'/);
  });

  it('counts the SQL tables of both domains, too', () => {
    for (const table of ['workflow_runs', 'workflow_checkpoints', 'workflow_approvals', 'agent_runs', 'agent_checkpoints', 'agent_approvals']) {
      assert.ok(RECHECK_SQL.includes(`'${table}'`));
    }
  });
});
