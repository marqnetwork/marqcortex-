/**
 * A2-P08-C01 — the agent source inventory and tenant mapping.
 *
 * The estate under test is written by the REAL agent runtime into the REAL
 * key-value agent stores (over `createFakeKv`, the `kv_compare_and_swap_field`
 * contract), then read back as raw rows — so every key, every `_schema`
 * marker and every JSON-string encoding is the one production produces, not
 * one a fixture author imagined. Defects are then planted on copies of those
 * rows, one at a time.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_ID,
  AGENT_TOKEN,
  buildTestAgentRuntime,
  createFakeKv,
} from './agentFixtures.ts';
import {
  approvalKeyFor,
  checkpointKeyFor,
  createKvAgentApprovalStore,
  createKvAgentCheckpointStore,
  createKvAgentRunStore,
  runKeyFor,
} from '../agents/persistence/kvAgentStores.ts';
import type { AgentSourceRow } from '../agents/persistence/migration/contracts.ts';
import {
  AGENT_SOURCE_NAMESPACE,
  AGENT_SOURCE_SCHEMA,
} from '../agents/persistence/migration/contracts.ts';
import { inventoryAgentSource, parseAgentSourceKey } from '../agents/persistence/migration/inventory.ts';
import { runAgentMigrationPreflight } from '../agents/persistence/migration/readiness.ts';
import type { CanonicalOrganization } from '../workflows/persistence/migration/contracts.ts';
import { digestValue } from '../agents/runtime/digest.ts';

const ALPHA = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const SECRET_OBJECTIVE = 'Objective carrying CUSTOMER-SECRET-7731 business content.';
const SECRET_TOPIC = 'Topic CUSTOMER-SECRET-7731';

const CATALOG: readonly CanonicalOrganization[] = [
  { id: ALPHA, slug: 'alpha', status: 'active', deleted: false },
  { id: OTHER, slug: 'acme', status: 'active', deleted: false },
];

/** An estate the real runtime wrote: one completed run and one parked on approval. */
async function realEstate(tenantId: string) {
  const kv = createFakeKv();
  const options = { read: kv.read, readByPrefix: kv.readByPrefix, compareAndSwap: kv.compareAndSwap };
  const harness = buildTestAgentRuntime({
    tenantId: tenantId === 'acme' ? undefined : tenantId,
    runStore: createKvAgentRunStore(options),
    checkpointStore: createKvAgentCheckpointStore(options),
    approvalStore: createKvAgentApprovalStore(options),
  });
  const meta = harness.meta(AGENT_TOKEN.consultant);
  const actor = await harness.runtime.service.authorize(meta);
  const completed = await harness.runtime.service.createRun(
    actor,
    { agentId: AGENT_ID.primary, objective: SECRET_OBJECTIVE, input: { topic: SECRET_TOPIC, script: 'model_then_complete' } },
    meta,
  );
  const parked = await harness.runtime.service.createRun(
    actor,
    { agentId: AGENT_ID.primary, objective: SECRET_OBJECTIVE, input: { topic: SECRET_TOPIC, script: 'approved_tool_then_complete' } },
    meta,
  );
  assert.equal(completed.state, 'completed');
  assert.equal(parked.state, 'waiting_for_approval');
  const rows: AgentSourceRow[] = await Promise.all(
    kv.keys().map(async (key) => ({ key, value: await kv.read(key) })),
  );
  return { rows, completed, parked };
}

function snapshot(rows: readonly AgentSourceRow[]): string {
  return JSON.stringify(rows);
}

function edit(rows: readonly AgentSourceRow[], match: (key: string) => boolean, change: (value: Record<string, unknown>) => unknown): AgentSourceRow[] {
  return rows.map((row) => {
    if (!match(row.key)) return row;
    const value = JSON.parse(String(row.value)) as Record<string, unknown>;
    return { key: row.key, value: JSON.stringify(change(value)) };
  });
}

describe('A2-P08-C01 agent inventory — a clean estate the runtime wrote', () => {
  it('classifies every row valid, every pointer exact and every chain contiguous', async () => {
    const { rows } = await realEstate(ALPHA);
    const inventory = inventoryAgentSource(rows);
    assert.ok(inventory.rows.length > 0);
    assert.deepEqual([...new Set(inventory.rows.map((r) => r.classification))], ['valid']);
    const [tenant] = inventory.tenants;
    assert.equal(tenant.sourceTenantId, ALPHA);
    assert.equal(tenant.runCount, 2);
    assert.equal(tenant.pendingApprovalCount, 1);
    assert.equal(tenant.pointerCounts.EXACT_TIP_MATCH, 2);
    assert.equal(tenant.irregularChainCount, 0);
    assert.equal(tenant.census.waitingForApproval, 1);
    assert.equal(tenant.census.terminal, 1);
    for (const bundle of tenant.bundles) assert.equal(bundle.linkage, 'CONTIGUOUS_LINKED');
  });

  it('strips the storage envelope from every record, and only that', async () => {
    const { rows } = await realEstate(ALPHA);
    for (const row of inventoryAgentSource(rows).rows) {
      assert.equal('_schema' in (row.record as object), false);
    }
  });

  it('says GO for a canonical UUID tenant and carries no business content', async () => {
    const { rows } = await realEstate(ALPHA);
    const { manifest } = runAgentMigrationPreflight({ rows, catalog: CATALOG, mappings: [], generatedAt: '2026-09-22T12:00:00.000Z' });
    assert.equal(manifest.verdict, 'GO_FOR_LATER_BACKFILL_PACKET');
    assert.equal(manifest.tenants[0].tenantClassification, 'CANONICAL_UUID');
    assert.equal(manifest.tenants[0].tenantChanges, false);
    assert.equal(manifest.tenants[0].integrityRewriteRequired, false);
    assert.doesNotMatch(JSON.stringify(manifest), /CUSTOMER-SECRET-7731/);
  });

  it('never modifies the snapshot it was given', async () => {
    const { rows } = await realEstate(ALPHA);
    const before = snapshot(rows);
    runAgentMigrationPreflight({ rows, catalog: CATALOG, mappings: [], generatedAt: 'x' });
    assert.equal(snapshot(rows), before);
  });
});

describe('A2-P08-C01 agent tenant mapping — BP-004 rules, reused', () => {
  it('blocks a slug tenant with only a slug candidate — evidence is not authority', async () => {
    const { rows } = await realEstate('acme');
    const { manifest } = runAgentMigrationPreflight({ rows, catalog: CATALOG, mappings: [], generatedAt: 'x' });
    assert.equal(manifest.verdict, 'NO_GO');
    assert.equal(manifest.tenants[0].tenantClassification, 'SLUG_EXACT_CANDIDATE');
    assert.equal(manifest.tenants[0].mappingRequired, true);
  });

  it('resolves a slug tenant only through an explicit manifest entry, with no integrity rewrite', async () => {
    const { rows } = await realEstate('acme');
    const { manifest } = runAgentMigrationPreflight({
      rows,
      catalog: CATALOG,
      mappings: [{ sourceTenantId: 'acme', targetOrganizationId: OTHER, expectedTargetSlug: 'acme', reason: 'test mapping' }],
      generatedAt: 'x',
    });
    assert.equal(manifest.verdict, 'GO_FOR_LATER_BACKFILL_PACKET');
    const [tenant] = manifest.tenants;
    assert.equal(tenant.tenantClassification, 'EXPLICIT_MAPPING_RESOLVED');
    assert.equal(tenant.targetOrganizationId, OTHER);
    assert.equal(tenant.tenantChanges, true);
    assert.equal(tenant.integrityRewriteRequired, false);
  });

  it('refuses a UUID the catalog does not hold', async () => {
    const ghost = '44444444-4444-4444-8444-444444444444';
    const { rows } = await realEstate(ghost);
    const { manifest } = runAgentMigrationPreflight({ rows, catalog: CATALOG, mappings: [], generatedAt: 'x' });
    assert.equal(manifest.tenants[0].tenantClassification, 'UUID_NOT_FOUND');
    assert.equal(manifest.verdict, 'NO_GO');
  });
});

describe('A2-P08-C01 agent inventory — defects are classified, never repaired', () => {
  const isCheckpoint = (key: string) => key.includes(':ai:agent_checkpoint:');
  const isRun = (key: string) => key.includes(':ai:agent_run:');

  it('names corrupt JSON, a missing schema marker and a payload that lost its identity', async () => {
    const { rows } = await realEstate(ALPHA);
    const [first, second, third] = rows.filter((r) => isRun(r.key) || isCheckpoint(r.key));
    const planted = rows.map((row) => {
      if (row.key === first.key) return { key: row.key, value: '{not json' };
      if (row.key === second.key) {
        const value = JSON.parse(String(row.value));
        delete value._schema;
        return { key: row.key, value };
      }
      if (row.key === third.key) {
        const value = JSON.parse(String(row.value));
        delete value.organizationId;
        delete value.context;
        return { key: row.key, value: JSON.stringify(value) };
      }
      return row;
    });
    const classes = inventoryAgentSource(planted).rows.map((r) => r.classification);
    assert.ok(classes.includes('corrupt_json'));
    assert.equal(classes.filter((c) => c === 'wrong_schema').length, 2);
  });

  it('refuses a payload that disagrees with its key about tenant, identity or version', async () => {
    const { rows } = await realEstate(ALPHA);
    const run = rows.find((r) => isRun(r.key))!;
    const checkpoint = rows.find((r) => isCheckpoint(r.key))!;
    const tenantLie = edit(rows, (k) => k === run.key, (v) => ({ ...v, context: { ...(v.context as object), organizationId: OTHER } }));
    const identityLie = edit(rows, (k) => k === run.key, (v) => ({ ...v, context: { ...(v.context as object), runId: 'run_other' } }));
    const versionLie = edit(rows, (k) => k === checkpoint.key, (v) => ({ ...v, version: 99 }));
    assert.equal(inventoryAgentSource(tenantLie).rows.find((r) => r.key === run.key)?.classification, 'key_payload_tenant_mismatch');
    assert.equal(inventoryAgentSource(identityLie).rows.find((r) => r.key === run.key)?.classification, 'key_payload_identity_mismatch');
    assert.equal(inventoryAgentSource(versionLie).rows.find((r) => r.key === checkpoint.key)?.classification, 'key_payload_identity_mismatch');
  });

  it('catches edited progress through its own digest — the one integrity fact an agent checkpoint proves', async () => {
    const { rows } = await realEstate(ALPHA);
    const checkpoint = rows.find((r) => isCheckpoint(r.key))!;
    const tampered = edit(rows, (k) => k === checkpoint.key, (v) => ({ ...v, progress: { objective: 'rewritten' } }));
    const inventory = inventoryAgentSource(tampered);
    assert.equal(inventory.rows.find((r) => r.key === checkpoint.key)?.classification, 'progress_digest_mismatch');
    assert.equal(inventory.tenants[0].progressDigestMismatchCount, 1);
    const { manifest } = runAgentMigrationPreflight({ rows: tampered, catalog: CATALOG, mappings: [], generatedAt: 'x' });
    assert.equal(manifest.verdict, 'NO_GO');
  });

  it('marks both copies of a duplicated logical identity rather than picking one', async () => {
    const { rows } = await realEstate(ALPHA);
    const run = rows.find((r) => isRun(r.key))!;
    const inventory = inventoryAgentSource([...rows, { ...run }]);
    assert.equal(inventory.rows.filter((r) => r.classification === 'duplicate_logical_identity').length, 2);
  });

  it('marks checkpoints and approvals with no run in their tenant as orphans', async () => {
    const { rows } = await realEstate(ALPHA);
    const withoutRuns = rows.filter((r) => !isRun(r.key));
    const classes = inventoryAgentSource(withoutRuns).rows.map((r) => r.classification);
    assert.ok(classes.includes('orphan_checkpoint'));
    assert.ok(classes.includes('orphan_approval'));
    assert.equal(classes.includes('valid'), false);
  });

  it('counts rows it does not own without judging them', () => {
    const inventory = inventoryAgentSource([
      { key: `org:${ALPHA}:ai:workflow_run:wfr_1`, value: '{}' },
      { key: 'something:else', value: 1 },
    ]);
    assert.equal(inventory.unknownAgentRowCount, 2);
    assert.equal(inventory.tenants.length, 0);
  });

  it('refuses a malformed key inside an agent namespace', () => {
    const inventory = inventoryAgentSource([
      { key: `org:${ALPHA}:ai:agent_checkpoint:run_1:12`, value: '{}' },
      { key: `org:${ALPHA}:ai:agent_checkpoint:run_1:000000`, value: '{}' },
      { key: 'org:BAD TENANT:ai:agent_run:run_1', value: '{}' },
    ]);
    assert.deepEqual(inventory.rows.map((r) => r.classification), ['invalid_key', 'invalid_key', 'invalid_key']);
  });
});

describe('A2-P08-C01 agent inventory — the pointer, classified rather than judged by feel', () => {
  /** A minimal, valid, production-shaped bundle written through the KV stores. */
  async function bundle(pointer: number, versions: readonly { v: number; prev?: number | 'none' | 'bogus' }[]) {
    const kv = createFakeKv();
    const options = { read: kv.read, readByPrefix: kv.readByPrefix, compareAndSwap: kv.compareAndSwap };
    const runs = createKvAgentRunStore(options);
    const checkpoints = createKvAgentCheckpointStore(options);
    const { rows } = await realEstate(ALPHA);
    const template = JSON.parse(String(rows.find((r) => r.key.includes(':ai:agent_run:'))!.value));
    delete template._schema;
    await runs.create({ ...template, context: { ...template.context, runId: 'run_p' }, checkpointVersion: pointer });
    const digestOf = (v: number) => digestValue({ step: v });
    for (const { v, prev } of versions) {
      const previousDigest = prev === 'none' ? undefined : prev === 'bogus' ? 'bogus' : digestOf(prev ?? v - 1);
      await checkpoints.write({
        runId: 'run_p', organizationId: ALPHA, version: v, createdAt: template.createdAt, state: 'running',
        agentId: template.currentAgentId, stepCount: v, progress: { step: v }, progressDigest: digestOf(v),
        ...(previousDigest === undefined ? {} : { previousDigest }),
      });
    }
    const all = await Promise.all(kv.keys().map(async (key) => ({ key, value: await kv.read(key) })));
    return Object.assign(inventoryAgentSource(all).tenants[0], { rows: all });
  }

  it('EMPTY_CHAIN: created and interrupted before its entry checkpoint', async () => {
    assert.equal((await bundle(0, [])).bundles[0].pointer, 'EMPTY_CHAIN');
  });

  it('RECOVERABLE_ONE_AHEAD_CANDIDATE: the entry checkpoint landed, the pointer save did not', async () => {
    const tenant = await bundle(0, [{ v: 1, prev: 'none' }]);
    assert.equal(tenant.bundles[0].pointer, 'RECOVERABLE_ONE_AHEAD_CANDIDATE');
  });

  it('RECOVERABLE_ONE_AHEAD_CANDIDATE: a step checkpoint landed, the pointer save did not — not blocking', async () => {
    const tenant = await bundle(1, [{ v: 1, prev: 'none' }, { v: 2 }]);
    assert.equal(tenant.bundles[0].pointer, 'RECOVERABLE_ONE_AHEAD_CANDIDATE');
    const { manifest } = runAgentMigrationPreflight({
      rows: tenant.rows, catalog: CATALOG, mappings: [], generatedAt: 'x',
    });
    assert.equal(manifest.verdict, 'GO_FOR_LATER_BACKFILL_PACKET');
    assert.match(manifest.tenants[0].evidence.join(' '), /crash window; copied faithfully, never repaired/);
  });

  it('ACTUAL_POINTER_MISMATCH: one ahead but linked to something else — and it blocks', async () => {
    const tenant = await bundle(1, [{ v: 1, prev: 'none' }, { v: 2, prev: 'bogus' }]);
    assert.equal(tenant.bundles[0].pointer, 'ACTUAL_POINTER_MISMATCH');
    const { manifest } = runAgentMigrationPreflight({ rows: tenant.rows, catalog: CATALOG, mappings: [], generatedAt: 'x' });
    assert.equal(manifest.verdict, 'NO_GO');
    assert.match(manifest.tenants[0].blockers.join(' '), /ACTUAL_POINTER_MISMATCH/);
  });

  it('ACTUAL_POINTER_MISMATCH: more than one ahead', async () => {
    assert.equal((await bundle(1, [{ v: 1, prev: 'none' }, { v: 2 }, { v: 3 }])).bundles[0].pointer, 'ACTUAL_POINTER_MISMATCH');
  });

  it('POINTER_WITHOUT_CHAIN: the run names checkpoints that are not stored', async () => {
    assert.equal((await bundle(3, [])).bundles[0].pointer, 'POINTER_WITHOUT_CHAIN');
  });

  it('an irregular chain is evidence, not a blocker — the agent contract never promised one', async () => {
    const tenant = await bundle(3, [{ v: 1, prev: 'none' }, { v: 3, prev: 1 }]);
    assert.equal(tenant.bundles[0].pointer, 'EXACT_TIP_MATCH');
    assert.equal(tenant.bundles[0].linkage, 'IRREGULAR');
    assert.equal(tenant.irregularChainCount, 1);
  });
});

describe('A2-P08-C01 agent inventory — pinned to the production reader', () => {
  it('parses exactly the keys the key-value stores build', () => {
    const run = parseAgentSourceKey(runKeyFor(ALPHA, 'run_1'));
    const checkpoint = parseAgentSourceKey(checkpointKeyFor(ALPHA, 'run_1', 12));
    const approval = parseAgentSourceKey(approvalKeyFor(ALPHA, 'apr_1'));
    assert.deepEqual(run.ok && run.parsed, { kind: 'run', sourceTenantId: ALPHA, identity: 'run_1' });
    assert.deepEqual(checkpoint.ok && checkpoint.parsed, { kind: 'checkpoint', sourceTenantId: ALPHA, identity: 'run_1', version: 12 });
    assert.deepEqual(approval.ok && approval.parsed, { kind: 'approval', sourceTenantId: ALPHA, identity: 'apr_1' });
    assert.equal(runKeyFor(ALPHA, 'x'), `org:${ALPHA}:ai:${AGENT_SOURCE_NAMESPACE.run}:x`);
    assert.equal(checkpointKeyFor(ALPHA, 'x', 3), `org:${ALPHA}:ai:${AGENT_SOURCE_NAMESPACE.checkpoint}:x:000003`);
    assert.equal(approvalKeyFor(ALPHA, 'x'), `org:${ALPHA}:ai:${AGENT_SOURCE_NAMESPACE.approval}:x`);
  });

  it('expects exactly the schema markers the key-value stores write', async () => {
    const { rows } = await realEstate(ALPHA);
    const markers = new Set(rows.map((row) => JSON.parse(String(row.value))._schema));
    assert.deepEqual([...markers].sort(), Object.values(AGENT_SOURCE_SCHEMA).sort());
  });
});
