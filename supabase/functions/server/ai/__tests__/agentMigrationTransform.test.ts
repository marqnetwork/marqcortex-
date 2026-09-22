/**
 * A2-P08-C02 — the agent tenant transformation and its fingerprints.
 *
 * Same method as the inventory suite: the source estate is written by the REAL
 * agent runtime into the REAL key-value agent stores, so what is transformed is
 * what production holds.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AGENT_ID, AGENT_TOKEN, buildTestAgentRuntime, createFakeKv } from './agentFixtures.ts';
import {
  createKvAgentApprovalStore,
  createKvAgentCheckpointStore,
  createKvAgentRunStore,
} from '../agents/persistence/kvAgentStores.ts';
import type { AgentSourceRow } from '../agents/persistence/migration/contracts.ts';
import { runAgentMigrationPreflight } from '../agents/persistence/migration/readiness.ts';
import {
  transformAgentBundle,
  transformAgentTenant,
  type TransformedAgentBundle,
} from '../agents/persistence/migration/transform.ts';
import {
  compareAgentFingerprints,
  fingerprintAgentBundles,
} from '../agents/persistence/migration/fingerprint.ts';
import type { CanonicalOrganization } from '../workflows/persistence/migration/contracts.ts';
import { canonicalJson, digestValue } from '../agents/runtime/digest.ts';

const ALPHA = '11111111-1111-4111-8111-111111111111';
const TARGET = '33333333-3333-4333-8333-333333333333';
const CATALOG: readonly CanonicalOrganization[] = [
  { id: ALPHA, slug: 'alpha', status: 'active', deleted: false },
  { id: TARGET, slug: 'acme', status: 'active', deleted: false },
];
const MAPPING = [{ sourceTenantId: 'acme', targetOrganizationId: TARGET, expectedTargetSlug: 'acme', reason: 'test' }];

/** A completed run, a run parked on approval, and a run whose input mentions the tenant. */
async function estate(tenantId: string | undefined): Promise<AgentSourceRow[]> {
  const kv = createFakeKv();
  const options = { read: kv.read, readByPrefix: kv.readByPrefix, compareAndSwap: kv.compareAndSwap };
  const harness = buildTestAgentRuntime({
    tenantId,
    runStore: createKvAgentRunStore(options),
    checkpointStore: createKvAgentCheckpointStore(options),
    approvalStore: createKvAgentApprovalStore(options),
  });
  const meta = harness.meta(AGENT_TOKEN.consultant);
  const actor = await harness.runtime.service.authorize(meta);
  for (const [topic, script] of [
    ['Durability', 'model_then_complete'],
    ['Approvals', 'approved_tool_then_complete'],
    ['A note about acme', 'model_then_complete'],
  ] as const) {
    await harness.runtime.service.createRun(
      actor,
      { agentId: AGENT_ID.primary, objective: `Objective for ${topic}.`, input: { topic, script } },
      meta,
    );
  }
  return Promise.all(kv.keys().map(async (key) => ({ key, value: await kv.read(key) })));
}

function prepared(rows: readonly AgentSourceRow[], mappings = MAPPING) {
  const result = runAgentMigrationPreflight({ rows, catalog: CATALOG, mappings, generatedAt: 'x' });
  const [tenant] = result.inventory.tenants;
  const [readiness] = result.manifest.tenants;
  return { tenant, readiness, manifest: result.manifest };
}

const sourceBundles = (tenant: ReturnType<typeof prepared>['tenant']): TransformedAgentBundle[] =>
  tenant.bundles.map(({ run, checkpoints, approvals }) => ({ run, checkpoints, approvals }));

describe('A2-P08-C02 — a canonical tenant does not move', () => {
  it('transforms to itself, byte for byte, under the EXACT fingerprint', async () => {
    const { tenant, readiness } = prepared(await estate(ALPHA));
    assert.equal(readiness.tenantChanges, false);
    const result = transformAgentTenant(tenant, readiness);
    assert.ok(result.ok);
    assert.deepEqual(compareAgentFingerprints(sourceBundles(tenant), result.bundles, false), { equivalent: true, mode: 'exact' });
    assert.equal(result.residualSourceTenantReferences, 0);
  });
});

describe('A2-P08-C02 — an explicitly mapped slug tenant', () => {
  it('rewrites exactly the three identity fields and nothing else', async () => {
    const { tenant, readiness } = prepared(await estate(undefined));
    const result = transformAgentTenant(tenant, readiness);
    assert.ok(result.ok);
    const source = sourceBundles(tenant);
    for (const [index, bundle] of result.bundles.entries()) {
      assert.equal(bundle.run.context.organizationId, TARGET);
      for (const checkpoint of bundle.checkpoints) assert.equal(checkpoint.organizationId, TARGET);
      for (const approval of bundle.approvals) assert.equal(approval.organizationId, TARGET);
      // Put the three fields back and the records are the source, exactly.
      const restored = {
        run: { ...bundle.run, context: { ...bundle.run.context, organizationId: 'acme' } },
        checkpoints: bundle.checkpoints.map((c) => ({ ...c, organizationId: 'acme' })),
        approvals: bundle.approvals.map((a) => ({ ...a, organizationId: 'acme' })),
      };
      assert.deepEqual(restored, source[index]);
    }
  });

  it('recomputes no integrity value — every digest is the source digest and still verifies', async () => {
    const { tenant, readiness } = prepared(await estate(undefined));
    const result = transformAgentTenant(tenant, readiness);
    assert.ok(result.ok);
    const sourceDigests = tenant.bundles.flatMap((b) => b.checkpoints.map((c) => [c.progressDigest, c.previousDigest]));
    const targetDigests = result.bundles.flatMap((b) => b.checkpoints.map((c) => [c.progressDigest, c.previousDigest]));
    assert.deepEqual(targetDigests, sourceDigests);
    for (const bundle of result.bundles) {
      for (const checkpoint of bundle.checkpoints) assert.equal(checkpoint.progressDigest, digestValue(checkpoint.progress));
      for (const [i, step] of bundle.run.steps.entries()) {
        assert.equal(step.fingerprint, tenant.bundles.find((b) => b.run.context.runId === bundle.run.context.runId)!.run.steps[i].fingerprint);
      }
    }
  });

  it('is migration-semantically equivalent and exactly different', async () => {
    const { tenant, readiness } = prepared(await estate(undefined));
    const result = transformAgentTenant(tenant, readiness);
    assert.ok(result.ok);
    assert.deepEqual(compareAgentFingerprints(sourceBundles(tenant), result.bundles, true), { equivalent: true, mode: 'migration-semantic' });
    assert.notEqual(fingerprintAgentBundles(sourceBundles(tenant), 'exact'), fingerprintAgentBundles(result.bundles, 'exact'));
  });

  it('counts, and never edits, business content that mentions the old identifier', async () => {
    const { tenant, readiness } = prepared(await estate(undefined));
    const result = transformAgentTenant(tenant, readiness);
    assert.ok(result.ok);
    assert.ok(result.residualSourceTenantReferences > 0, 'the run whose input says "acme" is counted');
    const mention = result.bundles.find((b) => JSON.stringify(b.checkpoints).includes('A note about acme'));
    assert.ok(mention, 'the mention survives verbatim, under a digest that still verifies');
  });

  it('is deterministic', async () => {
    const rows = await estate(undefined);
    const a = transformAgentTenant(prepared(rows).tenant, prepared(rows).readiness);
    const b = transformAgentTenant(prepared(rows).tenant, prepared(rows).readiness);
    assert.ok(a.ok && b.ok);
    assert.equal(canonicalJson(a.bundles), canonicalJson(b.bundles));
  });

  it('never modifies the source it translated', async () => {
    const rows = await estate(undefined);
    const before = JSON.stringify(rows);
    const { tenant, readiness } = prepared(rows);
    const beforeBundles = canonicalJson(sourceBundles(tenant));
    transformAgentTenant(tenant, readiness);
    assert.equal(JSON.stringify(rows), before);
    assert.equal(canonicalJson(sourceBundles(tenant)), beforeBundles);
  });
});

describe('A2-P08-C02 — verify first; refuse rather than adjust', () => {
  it('refuses a tenant the manifest did not clear', async () => {
    const { tenant, readiness } = prepared(await estate(undefined), []);
    assert.equal(readiness.verdict, 'NO_GO');
    const result = transformAgentTenant(tenant, readiness);
    assert.equal(result.ok, false);
  });

  it('refuses a bundle whose progress no longer hashes to its digest, even when called directly', async () => {
    const { tenant } = prepared(await estate(undefined));
    const [bundle] = tenant.bundles;
    const tampered = {
      ...bundle,
      checkpoints: bundle.checkpoints.map((c, i) => (i === 0 ? { ...c, progress: { edited: true } } : c)),
    };
    const verdict = transformAgentBundle(tampered, 'acme', TARGET);
    assert.equal(verdict.ok, false);
    assert.match(!verdict.ok ? verdict.problem : '', /does not hash to its digest/);
  });

  it('refuses a bundle with a blocking pointer, and one that names another tenant', async () => {
    const { tenant } = prepared(await estate(undefined));
    const [bundle] = tenant.bundles;
    assert.equal(transformAgentBundle({ ...bundle, pointer: 'ACTUAL_POINTER_MISMATCH' }, 'acme', TARGET).ok, false);
    assert.equal(transformAgentBundle({ ...bundle, pointer: 'POINTER_WITHOUT_CHAIN' }, 'acme', TARGET).ok, false);
    assert.equal(transformAgentBundle(bundle, 'globex', TARGET).ok, false);
  });

  it('a fingerprint notices any change beyond the tenant — a version, a state, a digest', async () => {
    const { tenant, readiness } = prepared(await estate(undefined));
    const result = transformAgentTenant(tenant, readiness);
    assert.ok(result.ok);
    const [first, ...rest] = result.bundles;
    for (const drifted of [
      { ...first, run: { ...first.run, runVersion: first.run.runVersion + 1 } },
      { ...first, run: { ...first.run, state: 'failed' as const } },
      { ...first, checkpoints: first.checkpoints.map((c, i) => (i === 0 ? { ...c, progressDigest: 'x' } : c)) },
    ]) {
      assert.equal(compareAgentFingerprints(sourceBundles(tenant), [drifted, ...rest], true).equivalent, false);
    }
  });
});
