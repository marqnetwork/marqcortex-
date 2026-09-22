/**
 * BP-004 — workflow cutover readiness and migration preflight (A2).
 *
 * THE PACKET'S SAFETY POSITION, AS ASSERTIONS. Nothing in this file connects to
 * anything. Every case is a pure function over rows that were written three
 * lines above it, which is the same property the modules under test have and
 * the reason they can be trusted to run before a cutover rather than during one.
 *
 * The live half — a real migration chain, a real local PostgreSQL, a real
 * insert of transformed records through the BP-003 SQL stores, and the proof
 * that the source rows were not touched — is
 * `scripts/workflow-cutover-readiness-scenarios.ts`, because a scratch database
 * is the wrong shape for `node:test`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { WorkflowRunRecord, WorkflowRunState } from '../workflows/contracts/run.ts';
import type { WorkflowCheckpoint } from '../workflows/contracts/checkpoint.ts';
import type { WorkflowApprovalRecord } from '../workflows/contracts/approval.ts';
import {
  computeCheckpointDigest,
  digestOutputs,
  verifyChain,
} from '../workflows/runtime/checkpointChain.ts';
import {
  workflowApprovalKeyFor,
  workflowCheckpointKeyFor,
  workflowRunKeyFor,
} from '../workflows/persistence/kvWorkflowStores.ts';
import { isRelationalOrganizationId } from '../workflows/persistence/sqlWorkflowStores.ts';
import { isolationKeyFor } from '../security/tenancy.ts';
import type {
  CanonicalOrganization,
  WorkflowSourceRow,
  WorkflowTenantMappingEntry,
} from '../workflows/persistence/migration/index.ts';
import {
  BP004_SCRATCH_DATABASE,
  REFUSED_LOCATION_VARIABLES,
  SCHEMA_MARKER_FIELD,
  STRIPPED_LOCATION_VARIABLES,
  WORKFLOW_SOURCE_SCHEMA,
  classifyDatabaseTarget,
  classifyScratchDatabaseName,
  localDatabaseEnvironment,
  compareFingerprints,
  fingerprintBundles,
  inventoryWorkflowSource,
  isCanonicalOrganizationId,
  parseWorkflowSourceKey,
  resolveTenantMappings,
  runWorkflowCutoverPreflight,
  transformTenant,
} from '../workflows/persistence/migration/index.ts';

// ── Tenants and the canonical catalog ──────────────────────────────────────

/** Already canonical: the source identifier IS an `organizations.id`. */
const ALPHA = '11111111-1111-4111-8111-111111111111';
/** The target a slug-shaped tenant is explicitly mapped onto. */
const MARQ = '22222222-2222-4222-8222-222222222222';
/** Exists, active, unrelated — used for many-to-one collisions. */
const OMEGA = '66666666-6666-4666-8666-666666666666';
/** Exists but suspended. */
const SUSPENDED = '33333333-3333-4333-8333-333333333333';
/** Exists but deleted. */
const DELETED = '44444444-4444-4444-8444-444444444444';
/** Syntactically a UUID and absent from the catalog. */
const ABSENT = '55555555-5555-4555-8555-555555555555';

const CATALOG: readonly CanonicalOrganization[] = [
  { id: ALPHA, slug: 'alpha', status: 'active', deleted: false },
  { id: MARQ, slug: 'marq', status: 'active', deleted: false },
  { id: OMEGA, slug: 'omega', status: 'active', deleted: false },
  { id: SUSPENDED, slug: 'suspended-org', status: 'suspended', deleted: false },
  { id: DELETED, slug: 'deleted-org', status: 'active', deleted: true },
];

const AT = '2026-09-22T09:00:00.000Z';

// ── Record builders that produce REAL digests ──────────────────────────────

/**
 * A genuinely chained checkpoint history.
 *
 * Built with the ENGINE'S OWN `computeCheckpointDigest` rather than with
 * placeholder strings, because every claim in this file is about what happens
 * to a digest — a fixture whose digests were invented would prove that the
 * transformation rewrites strings, which is not the question.
 */
function makeChain(
  organizationId: string,
  workflowRunId: string,
  length: number,
): WorkflowCheckpoint[] {
  const chain: WorkflowCheckpoint[] = [];
  let previousDigest: string | undefined;
  for (let version = 1; version <= length; version += 1) {
    const outputs: Record<string, unknown> = {};
    for (let node = 1; node <= version; node += 1) {
      outputs[`node_${node}`] = { produced: node, label: `output ${node}` };
    }
    const body: Omit<WorkflowCheckpoint, 'digest'> = {
      workflowRunId,
      organizationId,
      version,
      createdAt: `2026-09-21T10:0${version}:00.000Z`,
      state: 'running',
      nodeId: `node_${version}`,
      stepCount: version,
      cursorNodeId: `node_${version + 1}`,
      outputs,
      outputsDigest: digestOutputs(outputs),
      loopIterations: { node_1: version },
      nodeVisits: { [`node_${version}`]: 1 },
      parallel: [],
      ...(previousDigest === undefined ? {} : { previousDigest }),
    };
    const digest = computeCheckpointDigest(body);
    chain.push({ ...body, digest });
    previousDigest = digest;
  }
  return chain;
}

function makeRun(
  organizationId: string,
  workflowRunId: string,
  chain: readonly WorkflowCheckpoint[],
  state: WorkflowRunState = 'running',
): WorkflowRunRecord {
  const tip = chain[chain.length - 1];
  return {
    context: {
      workflowRunId,
      correlationId: 'cor_bp004',
      requestId: 'req_bp004',
      organizationId,
      actorId: 'user_operator',
      actorRoles: ['workflow_operator'],
      origin: { surface: 'team_console', feature: 'cutover-readiness' },
      workflowId: 'wf.review',
      workflowVersion: '1.0.0',
      planDigest: 'plan_digest_bp004',
    },
    runVersion: chain.length + 1,
    state,
    currentNodeId: `node_${chain.length + 1}`,
    stepCount: chain.length,
    parallelGroups: [],
    retries: [],
    usage: { rows: [] } as unknown as WorkflowRunRecord['usage'],
    childAgentRunIds: ['run_child_1'],
    steps: [],
    transitions: [
      {
        at: '2026-09-21T10:00:00.000Z',
        from: 'created',
        to: 'running',
        operation: 'start',
        reason: 'started',
        actorId: 'user_operator',
        runVersion: 2,
      },
    ],
    transitionsTruncated: 0,
    checkpointVersion: chain.length,
    ...(tip === undefined ? {} : { checkpointDigest: tip.digest }),
    input: { topic: 'quarterly-revenue-review' },
    inputDigest: 'input_digest_bp004',
    configurationVersion: 1,
    createdAt: '2026-09-21T10:00:00.000Z',
    updatedAt: '2026-09-21T10:05:00.000Z',
    deadlineAt: '2026-09-21T11:00:00.000Z',
    elapsedRuntimeMs: 300_000,
  };
}

function makeApproval(
  organizationId: string,
  workflowRunId: string,
  overrides: Partial<WorkflowApprovalRecord> = {},
): WorkflowApprovalRecord {
  return {
    workflowApprovalId: `wfa:${workflowRunId}:gate:main:2`,
    workflowRunId,
    organizationId,
    workflowId: 'wf.review',
    nodeId: 'gate',
    requestedBy: 'user_operator',
    reason: 'A human must confirm the finding before it is committed.',
    impactSummary: 'Proceeding writes the reviewed outcome to the submission.',
    estimatedAdditionalTokens: 0,
    estimatedAdditionalCostMicroUsd: 0,
    authorizedRoles: ['workflow_approver'],
    subjectEvidence: { subjectId: 'sub_4211', contentDigest: 'a'.repeat(64) },
    checkpointVersion: 2,
    workflowRunVersion: 3,
    createdAt: '2026-09-21T10:02:30.000Z',
    expiresAt: '2026-09-21T11:02:30.000Z',
    singleUse: true,
    approvalState: 'pending',
    onRejection: 'fail',
    approvalVersion: 1,
    ...overrides,
  };
}

// ── Rows ────────────────────────────────────────────────────────────────────

/** The storage envelope the key-value stores add on every write. */
function envelope(kind: 'run' | 'checkpoint' | 'approval', record: unknown): unknown {
  return { ...(record as Record<string, unknown>), [SCHEMA_MARKER_FIELD]: WORKFLOW_SOURCE_SCHEMA[kind] };
}

function runRow(record: WorkflowRunRecord): WorkflowSourceRow {
  return {
    key: workflowRunKeyFor(record.context.organizationId, record.context.workflowRunId),
    value: envelope('run', record),
  };
}

function checkpointRow(checkpoint: WorkflowCheckpoint, asJsonString = false): WorkflowSourceRow {
  const value = envelope('checkpoint', checkpoint);
  return {
    key: workflowCheckpointKeyFor(
      checkpoint.organizationId,
      checkpoint.workflowRunId,
      checkpoint.version,
    ),
    value: asJsonString ? JSON.stringify(value) : value,
  };
}

function approvalRow(record: WorkflowApprovalRecord): WorkflowSourceRow {
  return {
    key: workflowApprovalKeyFor(record.organizationId, record.workflowApprovalId),
    value: envelope('approval', record),
  };
}

/** One sound tenant: a run, a two-link chain and a pending approval. */
function soundTenant(organizationId: string, workflowRunId = 'wfr_bp004a'): {
  rows: WorkflowSourceRow[];
  run: WorkflowRunRecord;
  chain: WorkflowCheckpoint[];
  approval: WorkflowApprovalRecord;
} {
  const chain = makeChain(organizationId, workflowRunId, 3);
  const run = makeRun(organizationId, workflowRunId, chain);
  const approval = makeApproval(organizationId, workflowRunId);
  return {
    rows: [
      runRow(run),
      ...chain.map((checkpoint, index) => checkpointRow(checkpoint, index === 1)),
      approvalRow(approval),
    ],
    run,
    chain,
    approval,
  };
}

const MAPPING_MARQ: WorkflowTenantMappingEntry = {
  sourceTenantId: 'marq-cortex',
  targetOrganizationId: MARQ,
  expectedTargetSlug: 'marq',
  reason: 'operator-confirmed: the default AI tenant belongs to the marq organization',
};

function preflight(
  rows: readonly WorkflowSourceRow[],
  mappings: readonly WorkflowTenantMappingEntry[] = [],
  localBackfillVerified = true,
  catalog: readonly CanonicalOrganization[] = CATALOG,
) {
  return runWorkflowCutoverPreflight({
    rows,
    catalog,
    mappings,
    generatedAt: AT,
    localBackfillVerified,
  });
}

function tenantOf(result: ReturnType<typeof preflight>, sourceTenantId: string) {
  const tenant = result.manifest.tenants.find((entry) => entry.sourceTenantId === sourceTenantId);
  assert.ok(tenant, `expected a readiness entry for ${sourceTenantId}`);
  return tenant;
}

// ── Inventory ───────────────────────────────────────────────────────────────

describe('BP-004 source inventory', () => {
  it('1. parses all three workflow key families', () => {
    const { rows, run, chain, approval } = soundTenant(ALPHA);
    const inventory = inventoryWorkflowSource(rows);

    assert.equal(inventory.rows.every((row) => row.classification === 'valid'), true);
    assert.deepEqual(
      inventory.rows.map((row) => row.kind),
      ['run', 'checkpoint', 'checkpoint', 'checkpoint', 'approval'],
    );
    assert.equal(inventory.tenants.length, 1);
    const [tenant] = inventory.tenants;
    assert.equal(tenant.sourceTenantId, ALPHA);
    assert.equal(tenant.runCount, 1);
    assert.equal(tenant.checkpointCount, chain.length);
    assert.equal(tenant.approvalCount, 1);
    assert.equal(tenant.bundles[0].run.context.workflowRunId, run.context.workflowRunId);
    assert.equal(tenant.bundles[0].approvals[0].workflowApprovalId, approval.workflowApprovalId);
  });

  it('1b. reads an approval key whose identity contains colons', () => {
    // `wfa:{run}:{node}:{branch}:{version}` — splitting the key on `:` would
    // shred every approval in the estate, so the parse is pinned explicitly.
    const approval = makeApproval(ALPHA, 'wfr_colon');
    assert.ok(approval.workflowApprovalId.includes(':'));
    const parsed = parseWorkflowSourceKey(approvalRow(approval).key);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.ok && parsed.parsed.identity, approval.workflowApprovalId);
  });

  it('2. ignores unrelated key-value rows and never mutates one', () => {
    const { rows } = soundTenant(ALPHA);
    const unrelated: WorkflowSourceRow[] = [
      { key: `org:${'alpha'}:ai:agent_run:run_1`, value: { anything: true } },
      { key: 'cortex:submission:sub_1', value: 'not json at all' },
      { key: `org:${ALPHA}:ai:budget:2026-09`, value: { spendMicroUsd: 12 } },
    ];
    const frozen = JSON.stringify(unrelated);
    const inventory = inventoryWorkflowSource([...rows, ...unrelated]);

    const ignored = inventory.rows.filter(
      (row) => row.classification === 'unknown_workflow_namespace',
    );
    assert.equal(ignored.length, 3);
    assert.equal(inventory.unknownWorkflowRowCount, 3);
    assert.equal(inventory.recognizedWorkflowRowCount, rows.length);
    assert.equal(inventory.sourceRowCount, rows.length + 3);
    // The rows that came in are the rows that are still there.
    assert.equal(JSON.stringify(unrelated), frozen);
    // And an unrecognised namespace is NOT a defect: the tenant is still ready.
    const result = preflight([...rows, ...unrelated]);
    assert.equal(result.manifest.goNoGo, 'GO_FOR_LATER_BACKFILL_PACKET');
  });

  it('3. reads an object value and a JSON-string value identically', () => {
    const chain = makeChain(ALPHA, 'wfr_shape', 1);
    const asObject = inventoryWorkflowSource([checkpointRow(chain[0], false)]);
    const asString = inventoryWorkflowSource([checkpointRow(chain[0], true)]);
    assert.equal(asObject.rows[0].classification, 'orphan_checkpoint');
    assert.equal(asString.rows[0].classification, 'orphan_checkpoint');

    const { rows } = soundTenant(ALPHA);
    // The sound fixture already stores link two as a JSON string, so the whole
    // chain verifying proves both spellings decode to the same record.
    const inventory = inventoryWorkflowSource(rows);
    assert.equal(inventory.tenants[0].bundles[0].chainValid, true);
  });

  it('4. reports malformed JSON rather than skipping it', () => {
    const { rows } = soundTenant(ALPHA);
    const broken: WorkflowSourceRow = {
      key: workflowRunKeyFor(ALPHA, 'wfr_broken'),
      value: '{"context": {"organizationId":',
    };
    const inventory = inventoryWorkflowSource([...rows, broken]);
    const row = inventory.rows.find((entry) => entry.key === broken.key);
    assert.equal(row?.classification, 'corrupt_json');
    assert.equal(row?.record, undefined);
    // Counted, not dropped.
    assert.equal(inventory.recognizedWorkflowRowCount, rows.length + 1);
    assert.equal(preflight([...rows, broken]).manifest.goNoGo, 'NO_GO');
  });

  it('5. blocks a key and payload that name different tenants', () => {
    const chain = makeChain(ALPHA, 'wfr_tenant', 1);
    const run = makeRun(ALPHA, 'wfr_tenant', chain);
    const row: WorkflowSourceRow = {
      // The key says MARQ; the payload says ALPHA.
      key: workflowRunKeyFor(MARQ, 'wfr_tenant'),
      value: envelope('run', run),
    };
    const inventory = inventoryWorkflowSource([row]);
    assert.equal(inventory.rows[0].classification, 'key_payload_tenant_mismatch');
    assert.equal(inventory.rows[0].record, undefined);
  });

  it('6. blocks a key and payload that name different records', () => {
    const chain = makeChain(ALPHA, 'wfr_identity', 2);
    const run = makeRun(ALPHA, 'wfr_identity', chain);
    const wrongRun: WorkflowSourceRow = {
      key: workflowRunKeyFor(ALPHA, 'wfr_other'),
      value: envelope('run', run),
    };
    assert.equal(inventoryWorkflowSource([wrongRun]).rows[0].classification, 'key_payload_identity_mismatch');

    // And the checkpoint spelling of the same defect: the key's version segment
    // and the payload's version disagree.
    const wrongVersion: WorkflowSourceRow = {
      key: workflowCheckpointKeyFor(ALPHA, 'wfr_identity', 2),
      value: envelope('checkpoint', chain[0]),
    };
    assert.equal(
      inventoryWorkflowSource([wrongVersion]).rows[0].classification,
      'key_payload_identity_mismatch',
    );
  });

  it('7. blocks a wrong or absent schema marker', () => {
    const chain = makeChain(ALPHA, 'wfr_schema', 1);
    const run = makeRun(ALPHA, 'wfr_schema', chain);

    const wrong: WorkflowSourceRow = {
      key: workflowRunKeyFor(ALPHA, 'wfr_schema'),
      value: { ...run, [SCHEMA_MARKER_FIELD]: 'ai.workflow.checkpoint.v1' },
    };
    assert.equal(inventoryWorkflowSource([wrong]).rows[0].classification, 'wrong_schema');

    const bare: WorkflowSourceRow = {
      key: workflowRunKeyFor(ALPHA, 'wfr_schema'),
      value: run,
    };
    assert.equal(inventoryWorkflowSource([bare]).rows[0].classification, 'wrong_schema');

    // A payload that claims a schema it does not satisfy is the same defect.
    const hollow: WorkflowSourceRow = {
      key: workflowRunKeyFor(ALPHA, 'wfr_schema'),
      value: { context: { workflowRunId: 'wfr_schema', organizationId: ALPHA }, [SCHEMA_MARKER_FIELD]: WORKFLOW_SOURCE_SCHEMA.run },
    };
    assert.equal(inventoryWorkflowSource([hollow]).rows[0].classification, 'wrong_schema');
  });

  it('7b. separates a malformed workflow key from a foreign namespace', () => {
    const malformed = inventoryWorkflowSource([
      // Ours, and broken: the version segment is not six digits.
      { key: `org:${ALPHA}:ai:workflow_checkpoint:wfr_a:12`, value: {} },
      // Ours, and broken: no version segment at all.
      { key: `org:${ALPHA}:ai:workflow_checkpoint:wfr_a`, value: {} },
      // Ours, and broken: the tenant segment is not an organization identifier.
      { key: 'org:-nope:ai:workflow_run:wfr_a', value: {} },
    ]);
    assert.deepEqual(
      malformed.rows.map((row) => row.classification),
      ['invalid_key', 'invalid_key', 'invalid_key'],
    );
    assert.equal(malformed.unknownWorkflowRowCount, 0);
  });

  it('7c. blocks an orphan checkpoint and an orphan approval', () => {
    const chain = makeChain(ALPHA, 'wfr_orphan', 2);
    const orphanCheckpoints = inventoryWorkflowSource(chain.map((c) => checkpointRow(c)));
    assert.deepEqual(
      orphanCheckpoints.rows.map((row) => row.classification),
      ['orphan_checkpoint', 'orphan_checkpoint'],
    );

    const orphanApproval = inventoryWorkflowSource([approvalRow(makeApproval(ALPHA, 'wfr_nothere'))]);
    assert.equal(orphanApproval.rows[0].classification, 'orphan_approval');
  });

  it('7d. blocks a duplicated logical identity on both copies', () => {
    const { rows } = soundTenant(ALPHA);
    const inventory = inventoryWorkflowSource([...rows, rows[0]]);
    const duplicates = inventory.rows.filter(
      (row) => row.classification === 'duplicate_logical_identity',
    );
    assert.equal(duplicates.length, 2, 'both copies are named; neither is chosen');
  });

  it('7e. never repairs a source row', () => {
    const { rows } = soundTenant(ALPHA);
    const before = JSON.stringify(rows);
    inventoryWorkflowSource(rows);
    assert.equal(JSON.stringify(rows), before);
  });

  it('7f. lifts the storage envelope off and changes nothing else', () => {
    const { rows, chain } = soundTenant(ALPHA);
    const inventory = inventoryWorkflowSource(rows);
    const stored = inventory.tenants[0].bundles[0].checkpoints[0];
    assert.equal(SCHEMA_MARKER_FIELD in (stored as unknown as Record<string, unknown>), false);
    // The envelope was never inside the digest, so removing it moves nothing.
    assert.equal(stored.digest, chain[0].digest);
    assert.equal(computeCheckpointDigest(stored), chain[0].digest);
    assert.equal(verifyChain(inventory.tenants[0].bundles[0].checkpoints).ok, true);
  });

  it('7g. agrees with the tenancy grammar that builds the keys', () => {
    // The inventory restates `ORGANIZATION_ID` rather than importing it. This
    // is what keeps the two from drifting: an identifier the key builder
    // accepts must produce a key the inventory parses, and one it refuses must
    // never appear in a key at all.
    for (const candidate of [ALPHA, 'marq-cortex', 'marq', 'a.b_c', 'A1', 'x'.repeat(64)]) {
      let built: string | undefined;
      try {
        built = isolationKeyFor(candidate) === '' ? undefined : workflowRunKeyFor(candidate, 'wfr_x');
      } catch {
        built = undefined;
      }
      if (built === undefined) continue;
      const parsed = parseWorkflowSourceKey(built);
      assert.equal(parsed.ok, true, `${candidate} builds a key the inventory cannot read`);
      assert.equal(parsed.ok && parsed.parsed.sourceTenantId, candidate);
    }
    // `a.b_c` carries an underscore, which the key grammar refuses outright.
    assert.throws(() => isolationKeyFor('a b'));
  });
});

// ── Tenant mapping ──────────────────────────────────────────────────────────

describe('BP-004 tenant mapping', () => {
  const resolve = (
    sourceTenantIds: readonly string[],
    mappings: readonly WorkflowTenantMappingEntry[] = [],
    catalog: readonly CanonicalOrganization[] = CATALOG,
  ) => resolveTenantMappings({ sourceTenantIds, catalog, mappings });

  it('8. resolves a canonical UUID backed by an active organization', () => {
    const [resolution] = resolve([ALPHA]).resolutions;
    assert.equal(resolution.classification, 'CANONICAL_UUID');
    assert.equal(resolution.targetOrganizationId, ALPHA);
    assert.equal(resolution.targetSlug, 'alpha');
    assert.equal(resolution.digestRewriteRequired, false);
    assert.equal(resolution.mappingRequired, false);
  });

  it('9. blocks a UUID with no row in the catalog', () => {
    const [resolution] = resolve([ABSENT]).resolutions;
    assert.equal(resolution.classification, 'UUID_NOT_FOUND');
    assert.equal(resolution.targetOrganizationId, undefined);
  });

  it('10. treats an exact slug match as evidence and refuses it as authority', () => {
    const [resolution] = resolve(['alpha']).resolutions;
    assert.equal(resolution.classification, 'SLUG_EXACT_CANDIDATE');
    assert.equal(resolution.targetOrganizationId, undefined);
    assert.equal(resolution.mappingRequired, true);
    assert.match(resolution.reasons.join(' '), /evidence and not authority/);
  });

  it('11. resolves an explicit mapping onto an active UUID', () => {
    const [resolution] = resolve(['marq-cortex'], [MAPPING_MARQ]).resolutions;
    assert.equal(resolution.classification, 'EXPLICIT_MAPPING_RESOLVED');
    assert.equal(resolution.targetOrganizationId, MARQ);
    assert.equal(resolution.targetSlug, 'marq');
    // The identifier moves, so every digest in every chain has to move with it.
    assert.equal(resolution.digestRewriteRequired, true);
  });

  it('12. blocks an explicit mapping onto a UUID that does not exist', () => {
    const [resolution] = resolve(
      ['marq-cortex'],
      [{ ...MAPPING_MARQ, targetOrganizationId: ABSENT, expectedTargetSlug: undefined }],
    ).resolutions;
    assert.equal(resolution.classification, 'MAPPING_CONFLICT');
    assert.match(resolution.reasons.join(' '), /no row in the canonical catalog/);
  });

  it('13. blocks an explicit mapping onto a suspended or deleted target', () => {
    const suspended = resolve(
      ['marq-cortex'],
      [{ ...MAPPING_MARQ, targetOrganizationId: SUSPENDED, expectedTargetSlug: undefined }],
    ).resolutions[0];
    assert.equal(suspended.classification, 'TARGET_INACTIVE_OR_DELETED');

    const deleted = resolve(
      ['marq-cortex'],
      [{ ...MAPPING_MARQ, targetOrganizationId: DELETED, expectedTargetSlug: undefined }],
    ).resolutions[0];
    assert.equal(deleted.classification, 'TARGET_INACTIVE_OR_DELETED');
    assert.match(deleted.reasons.join(' '), /deleted/);
  });

  it('13b. blocks a mapping whose expected slug does not match the target', () => {
    const [resolution] = resolve(
      ['marq-cortex'],
      [{ ...MAPPING_MARQ, expectedTargetSlug: 'omega' }],
    ).resolutions;
    assert.equal(resolution.classification, 'MAPPING_CONFLICT');
    assert.match(resolution.reasons.join(' '), /expected slug omega/);
  });

  it('14. blocks many source tenants resolving to one target', () => {
    const { resolutions } = resolve(
      ['marq-cortex', 'marq-legacy'],
      [
        MAPPING_MARQ,
        { sourceTenantId: 'marq-legacy', targetOrganizationId: MARQ, reason: 'same company' },
      ],
    );
    assert.deepEqual(
      resolutions.map((resolution) => resolution.classification),
      ['MAPPING_CONFLICT', 'MAPPING_CONFLICT'],
      'a collision blocks BOTH sides; neither is silently chosen',
    );
    assert.match(resolutions[0].reasons.join(' '), /consolidation is not authorised/);
  });

  it('14b. blocks a manifest pointing a second tenant at an already-canonical one', () => {
    const { resolutions } = resolve(
      [ALPHA, 'legacy'],
      [{ sourceTenantId: 'legacy', targetOrganizationId: ALPHA, reason: 'looks related' }],
    );
    assert.deepEqual(
      resolutions.map((resolution) => resolution.classification),
      ['MAPPING_CONFLICT', 'MAPPING_CONFLICT'],
    );
  });

  it('14c. blocks a manifest that names one source tenant twice', () => {
    const [resolution] = resolve(
      ['marq-cortex'],
      [MAPPING_MARQ, { ...MAPPING_MARQ, targetOrganizationId: OMEGA, expectedTargetSlug: 'omega' }],
    ).resolutions;
    assert.equal(resolution.classification, 'MAPPING_CONFLICT');
  });

  it('14d. blocks moving an already-canonical tenant elsewhere', () => {
    const [resolution] = resolve(
      [ALPHA],
      [{ sourceTenantId: ALPHA, targetOrganizationId: OMEGA, reason: 'reorganisation' }],
    ).resolutions;
    assert.equal(resolution.classification, 'MAPPING_CONFLICT');
    assert.match(resolution.reasons.join(' '), /already-canonical/);
  });

  it('14e. blocks a mapping entry that records no evidence', () => {
    const [resolution] = resolve(
      ['marq-cortex'],
      [{ ...MAPPING_MARQ, reason: '   ' }],
    ).resolutions;
    assert.equal(resolution.classification, 'MAPPING_CONFLICT');
    assert.match(resolution.reasons.join(' '), /no recorded evidence/);
  });

  it('15. never maps marq-cortex to marq on its own', () => {
    // THE INFERENCE THIS PACKET EXISTS TO REFUSE. An active organization with
    // slug `marq` is in the catalog, and `marq-cortex` is the shipped default
    // AI tenant. With no manifest, the answer is a refusal — not a candidate,
    // not a warning, and certainly not a resolution.
    const [resolution] = resolve(['marq-cortex']).resolutions;
    assert.equal(resolution.classification, 'EXPLICIT_MAPPING_REQUIRED');
    assert.equal(resolution.targetOrganizationId, undefined);
    assert.equal(resolution.targetSlug, undefined);
    assert.equal(resolution.mappingRequired, true);

    // And no prefix, case or name variant reaches it either.
    for (const variant of ['MARQ-CORTEX', 'marq_cortex', 'marq.cortex', 'marqcortex']) {
      const [candidate] = resolve([variant]).resolutions;
      assert.equal(candidate.targetOrganizationId, undefined, `${variant} resolved to something`);
    }
  });

  it('15b. reports a manifest entry that matches no source tenant', () => {
    const { unusedMappings } = resolve([ALPHA], [MAPPING_MARQ]);
    assert.deepEqual(unusedMappings, ['marq-cortex']);
  });

  it('15c. agrees with the SQL store about what a relational tenant is', () => {
    // If these two ever disagreed, the preflight would declare a tenant
    // canonical that `sqlWorkflowStores.ts` then refuses to write.
    for (const candidate of [ALPHA, MARQ, 'marq-cortex', 'alpha', '', 'not-a-uuid', ABSENT]) {
      assert.equal(
        isCanonicalOrganizationId(candidate),
        isRelationalOrganizationId(candidate),
        `disagreement about ${candidate}`,
      );
    }
  });
});

// ── Transformation and re-chaining ─────────────────────────────────────────

describe('BP-004 checkpoint transformation', () => {
  function bundlesFor(rows: readonly WorkflowSourceRow[], sourceTenantId: string) {
    const inventory = inventoryWorkflowSource(rows);
    const tenant = inventory.tenants.find((entry) => entry.sourceTenantId === sourceTenantId);
    assert.ok(tenant);
    return tenant.bundles;
  }

  it('16. preserves every digest when the tenant identifier does not move', () => {
    const { rows, chain, run } = soundTenant(ALPHA);
    const verdict = transformTenant(ALPHA, ALPHA, bundlesFor(rows, ALPHA));
    assert.equal(verdict.ok, true);
    if (!verdict.ok) return;
    const [bundle] = verdict.bundles;
    assert.deepEqual(
      bundle.checkpoints.map((checkpoint) => checkpoint.digest),
      chain.map((checkpoint) => checkpoint.digest),
    );
    assert.equal(bundle.run.checkpointDigest, run.checkpointDigest);
    assert.equal(
      bundle.digestMap.every((entry) => entry.sourceDigest === entry.transformedDigest),
      true,
    );
  });

  it('17. changes every digest deterministically when the tenant moves', () => {
    const { rows, chain } = soundTenant('marq-cortex');
    const first = transformTenant('marq-cortex', MARQ, bundlesFor(rows, 'marq-cortex'));
    const second = transformTenant('marq-cortex', MARQ, bundlesFor(rows, 'marq-cortex'));
    assert.equal(first.ok && second.ok, true);
    if (!first.ok || !second.ok) return;

    const digests = first.bundles[0].checkpoints.map((checkpoint) => checkpoint.digest);
    // Every one moved …
    for (let index = 0; index < chain.length; index += 1) {
      assert.notEqual(digests[index], chain[index].digest, `version ${index + 1} kept its digest`);
    }
    // … and moved to the same place twice, on the same inputs.
    assert.deepEqual(digests, second.bundles[0].checkpoints.map((c) => c.digest));
    // And each one is the digest of its own transformed content.
    for (const checkpoint of first.bundles[0].checkpoints) {
      assert.equal(computeCheckpointDigest(checkpoint), checkpoint.digest);
      assert.equal(checkpoint.organizationId, MARQ);
    }
  });

  it('18. links transformed version two to transformed version one', () => {
    const { rows } = soundTenant('marq-cortex');
    const verdict = transformTenant('marq-cortex', MARQ, bundlesFor(rows, 'marq-cortex'));
    assert.equal(verdict.ok, true);
    if (!verdict.ok) return;
    const [first, second, third] = verdict.bundles[0].checkpoints;
    assert.equal(first.previousDigest, undefined, 'the first link opens the chain');
    assert.equal(second.previousDigest, first.digest);
    assert.equal(third.previousDigest, second.digest);
  });

  it('19. produces a transformed chain that verifies', () => {
    const { rows } = soundTenant('marq-cortex');
    const verdict = transformTenant('marq-cortex', MARQ, bundlesFor(rows, 'marq-cortex'));
    assert.equal(verdict.ok, true);
    if (!verdict.ok) return;
    assert.deepEqual(verifyChain(verdict.bundles[0].checkpoints), { ok: true });
  });

  it('20. moves the run pointer to the transformed tip', () => {
    const { rows, run } = soundTenant('marq-cortex');
    const verdict = transformTenant('marq-cortex', MARQ, bundlesFor(rows, 'marq-cortex'));
    assert.equal(verdict.ok, true);
    if (!verdict.ok) return;
    const [bundle] = verdict.bundles;
    const tip = bundle.checkpoints[bundle.checkpoints.length - 1];
    assert.equal(bundle.run.checkpointDigest, tip.digest);
    assert.notEqual(bundle.run.checkpointDigest, run.checkpointDigest);
    assert.equal(bundle.run.checkpointVersion, tip.version);
    assert.equal(bundle.run.context.organizationId, MARQ);
  });

  it('20b. leaves a run with no checkpoints without a pointer', () => {
    const run = makeRun(MARQ_SOURCE, 'wfr_fresh', [], 'created');
    const rows = [runRow(run)];
    const verdict = transformTenant(MARQ_SOURCE, MARQ, bundlesFor(rows, MARQ_SOURCE));
    assert.equal(verdict.ok, true);
    if (!verdict.ok) return;
    assert.equal(verdict.bundles[0].run.checkpointDigest, undefined);
    assert.equal(verdict.bundles[0].checkpoints.length, 0);
  });

  it('21. leaves the source chain untouched', () => {
    const { rows, chain } = soundTenant('marq-cortex');
    const before = JSON.stringify({ rows, chain });
    transformTenant('marq-cortex', MARQ, bundlesFor(rows, 'marq-cortex'));
    assert.equal(JSON.stringify({ rows, chain }), before);
  });

  it('22. emits no transformed chain for a corrupt source chain', () => {
    const chain = makeChain('marq-cortex', 'wfr_corrupt', 3);
    // Link two, edited after the fact — the exact thing the chain exists to
    // catch. Its own digest is now wrong, so recovery would refuse it.
    const tampered: WorkflowCheckpoint = { ...chain[1], stepCount: 99 };
    const edited = [chain[0], tampered, chain[2]];
    const run = makeRun('marq-cortex', 'wfr_corrupt', chain);
    const rows = [runRow(run), ...edited.map((checkpoint) => checkpointRow(checkpoint))];

    const bundles = bundlesFor(rows, 'marq-cortex');
    assert.equal(bundles[0].chainValid, false);

    const verdict = transformTenant('marq-cortex', MARQ, bundles);
    assert.equal(verdict.ok, false);
    if (verdict.ok) return;
    assert.match(verdict.problems.join(' '), /not transformable/);
    // AND NOTHING CAME OUT. A re-chained corrupt history would look clean.
    assert.equal('bundles' in verdict, false);
  });
});

/** A slug-shaped source tenant used where the identifier itself is not the point. */
const MARQ_SOURCE = 'marq-cortex';

// ── Semantic parity ─────────────────────────────────────────────────────────

describe('BP-004 semantic fingerprints', () => {
  function transformed(sourceTenantId: string, target: string) {
    const fixture = soundTenant(sourceTenantId);
    const inventory = inventoryWorkflowSource(fixture.rows);
    const tenant = inventory.tenants[0];
    const verdict = transformTenant(sourceTenantId, target, tenant.bundles);
    assert.equal(verdict.ok, true);
    if (!verdict.ok) throw new Error('unreachable');
    return { fixture, source: tenant.bundles, result: verdict.bundles };
  }

  it('23. sees no difference beyond the four fields a remap forces', () => {
    const { source, result } = transformed(MARQ_SOURCE, MARQ);
    const verdict = compareFingerprints(
      fingerprintBundles(source, 'migration-semantic'),
      fingerprintBundles(result, 'migration-semantic'),
    );
    assert.deepEqual(verdict, { ok: true });

    // And the exact fingerprints DO differ, which is what makes the first
    // assertion mean something rather than being a comparison of two blanks.
    assert.notEqual(
      fingerprintBundles(source, 'exact').digest,
      fingerprintBundles(result, 'exact').digest,
    );
  });

  it('23b. catches a fifth field changing', () => {
    const { source, result } = transformed(MARQ_SOURCE, MARQ);
    const meddled = result.map((bundle) => ({
      ...bundle,
      run: { ...bundle.run, state: 'completed' as WorkflowRunState },
    }));
    const verdict = compareFingerprints(
      fingerprintBundles(source, 'migration-semantic'),
      fingerprintBundles(meddled, 'migration-semantic'),
    );
    assert.equal(verdict.ok, false);
    assert.equal(
      verdict.ok ? '' : verdict.problem,
      'a domain field changed that the tenant translation does not require',
    );
  });

  it('23c. catches a pointer appearing where there was none', () => {
    const source = [{ run: makeRun(MARQ_SOURCE, 'wfr_bare', [], 'created'), checkpoints: [], approvals: [] }];
    const invented = [
      { run: { ...source[0].run, checkpointDigest: 'f'.repeat(64) }, checkpoints: [], approvals: [] },
    ];
    const verdict = compareFingerprints(
      fingerprintBundles(source, 'migration-semantic'),
      fingerprintBundles(invented, 'migration-semantic'),
    );
    assert.equal(verdict.ok, false, 'an elided-but-absent field must not compare equal to a present one');
  });

  it('23d. refuses to compare fingerprints taken under different modes', () => {
    const { source, result } = transformed(MARQ_SOURCE, MARQ);
    const verdict = compareFingerprints(
      fingerprintBundles(source, 'exact'),
      fingerprintBundles(result, 'migration-semantic'),
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.ok ? '' : verdict.problem, /different modes/);
  });

  it('24. keeps every business and runtime fact on the run', () => {
    const { source, result } = transformed(MARQ_SOURCE, MARQ);
    const before = source[0].run;
    const after = result[0].run;
    assert.equal(after.context.workflowRunId, before.context.workflowRunId);
    assert.equal(after.context.workflowId, before.context.workflowId);
    assert.equal(after.context.actorId, before.context.actorId);
    assert.equal(after.context.planDigest, before.context.planDigest);
    assert.equal(after.context.correlationId, before.context.correlationId);
    assert.equal(after.runVersion, before.runVersion);
    assert.equal(after.state, before.state);
    assert.equal(after.stepCount, before.stepCount);
    assert.equal(after.checkpointVersion, before.checkpointVersion);
    assert.deepEqual(after.input, before.input);
    assert.equal(after.inputDigest, before.inputDigest);
    assert.deepEqual(after.transitions, before.transitions);
    assert.deepEqual(after.childAgentRunIds, before.childAgentRunIds);
    assert.equal(after.createdAt, before.createdAt);
    assert.equal(after.updatedAt, before.updatedAt);
    assert.equal(after.deadlineAt, before.deadlineAt);
    assert.equal(after.elapsedRuntimeMs, before.elapsedRuntimeMs);
  });

  it('25. keeps checkpoint outputs and their digest byte-identical', () => {
    const { source, result } = transformed(MARQ_SOURCE, MARQ);
    for (let index = 0; index < source[0].checkpoints.length; index += 1) {
      const before = source[0].checkpoints[index];
      const after = result[0].checkpoints[index];
      assert.deepEqual(after.outputs, before.outputs);
      // CARRIED, NOT RE-DIGESTED. A transformation that recomputed this would
      // bless outputs that did not match their digest at source.
      assert.equal(after.outputsDigest, before.outputsDigest);
      assert.equal(after.version, before.version);
      assert.equal(after.nodeId, before.nodeId);
      assert.equal(after.state, before.state);
      assert.equal(after.cursorNodeId, before.cursorNodeId);
      assert.equal(after.stepCount, before.stepCount);
      assert.equal(after.createdAt, before.createdAt);
      assert.deepEqual(after.loopIterations, before.loopIterations);
      assert.deepEqual(after.nodeVisits, before.nodeVisits);
      assert.deepEqual(after.parallel, before.parallel);
      assert.equal(after.workflowRunId, before.workflowRunId);
    }
  });

  it('26. keeps the approval decision, version, identity and evidence', () => {
    const decided = makeApproval(MARQ_SOURCE, 'wfr_bp004a', {
      approvalState: 'consumed',
      approvalVersion: 3,
      decidedAt: '2026-09-21T10:30:00.000Z',
      decidedBy: 'user_approver',
      decision: 'approve',
      decisionReason: 'reviewed and accepted',
      consumedAt: '2026-09-21T10:31:00.000Z',
    });
    const chain = makeChain(MARQ_SOURCE, 'wfr_bp004a', 2);
    const run = makeRun(MARQ_SOURCE, 'wfr_bp004a', chain);
    const rows = [runRow(run), ...chain.map((c) => checkpointRow(c)), approvalRow(decided)];
    const tenant = inventoryWorkflowSource(rows).tenants[0];
    const verdict = transformTenant(MARQ_SOURCE, MARQ, tenant.bundles);
    assert.equal(verdict.ok, true);
    if (!verdict.ok) return;

    const after = verdict.bundles[0].approvals[0];
    // The identifier is derived from the run, the node, the branch and the
    // checkpoint version — never from the organization — so it must not move.
    assert.equal(after.workflowApprovalId, decided.workflowApprovalId);
    assert.equal(after.approvalState, 'consumed');
    assert.equal(after.approvalVersion, 3);
    assert.equal(after.decision, 'approve');
    assert.equal(after.decidedBy, 'user_approver');
    assert.equal(after.decidedAt, decided.decidedAt);
    assert.equal(after.consumedAt, decided.consumedAt);
    assert.deepEqual(after.subjectEvidence, decided.subjectEvidence);
    assert.deepEqual(after.authorizedRoles, decided.authorizedRoles);
    assert.equal(after.checkpointVersion, decided.checkpointVersion);
    assert.equal(after.workflowRunVersion, decided.workflowRunVersion);
    assert.equal(after.singleUse, true);
    // Exactly one field gave way.
    assert.equal(after.organizationId, MARQ);
  });
});

// ── Readiness ───────────────────────────────────────────────────────────────

describe('BP-004 readiness verdict', () => {
  it('33. refuses the whole manifest for one corrupt row', () => {
    const { rows } = soundTenant(ALPHA);
    const result = preflight([
      ...rows,
      { key: workflowRunKeyFor(ALPHA, 'wfr_bad'), value: '{ not json' },
    ]);
    assert.equal(result.manifest.goNoGo, 'NO_GO');
    assert.equal(tenantOf(result, ALPHA).readiness, 'NO_GO');
    assert.match(result.manifest.reasons.join(' '), /corrupt_json/);
    assert.deepEqual(result.plans, [], 'a blocked manifest hands nothing onward');
  });

  it('34. refuses an unresolved tenant', () => {
    const { rows } = soundTenant(MARQ_SOURCE);
    const result = preflight(rows);
    assert.equal(result.manifest.goNoGo, 'NO_GO');
    assert.equal(result.manifest.allMappingsExplicit, false);
    assert.equal(tenantOf(result, MARQ_SOURCE).classification, 'EXPLICIT_MAPPING_REQUIRED');
    assert.deepEqual(result.plans, []);
  });

  it('34b. refuses an exact slug candidate that has no explicit mapping', () => {
    const { rows } = soundTenant('alpha');
    const result = preflight(rows);
    assert.equal(result.manifest.goNoGo, 'NO_GO');
    assert.equal(tenantOf(result, 'alpha').classification, 'SLUG_EXACT_CANDIDATE');
  });

  it('34c. refuses a mapping to a missing, suspended or deleted target', () => {
    const { rows } = soundTenant(MARQ_SOURCE);
    for (const target of [ABSENT, SUSPENDED, DELETED]) {
      const result = preflight(rows, [
        { sourceTenantId: MARQ_SOURCE, targetOrganizationId: target, reason: 'declared' },
      ]);
      assert.equal(result.manifest.goNoGo, 'NO_GO', `target ${target} was accepted`);
      assert.deepEqual(result.plans, []);
    }
  });

  it('34d. refuses two source tenants mapped onto one target', () => {
    const first = soundTenant(MARQ_SOURCE, 'wfr_one');
    const second = soundTenant('marq-legacy', 'wfr_two');
    const result = preflight([...first.rows, ...second.rows], [
      MAPPING_MARQ,
      { sourceTenantId: 'marq-legacy', targetOrganizationId: MARQ, reason: 'same company' },
    ]);
    assert.equal(result.manifest.goNoGo, 'NO_GO');
    assert.equal(result.manifest.blockedTenantCount, 2);
  });

  it('35. refuses an invalid source chain', () => {
    const chain = makeChain(ALPHA, 'wfr_chain', 3);
    const run = makeRun(ALPHA, 'wfr_chain', chain);
    // Version two removed: the chain now skips a link.
    const rows = [runRow(run), checkpointRow(chain[0]), checkpointRow(chain[2])];
    const result = preflight(rows);
    assert.equal(result.manifest.goNoGo, 'NO_GO');
    assert.equal(result.manifest.allSourceChainsValid, false);
    assert.equal(tenantOf(result, ALPHA).invalidChainCount, 1);
  });

  it('36. refuses a run pointer that is not the chain tip', () => {
    const chain = makeChain(ALPHA, 'wfr_pointer', 3);
    const run: WorkflowRunRecord = {
      ...makeRun(ALPHA, 'wfr_pointer', chain),
      checkpointVersion: 2,
      checkpointDigest: chain[1].digest,
    };
    const rows = [runRow(run), ...chain.map((checkpoint) => checkpointRow(checkpoint))];
    const result = preflight(rows);
    assert.equal(result.manifest.goNoGo, 'NO_GO');
    assert.equal(tenantOf(result, ALPHA).pointerMismatchCount, 1);
    assert.match(result.manifest.reasons.join(' '), /run_checkpoint_pointer_mismatch/);
  });

  it('36b. refuses an orphan checkpoint and an orphan approval', () => {
    const chain = makeChain(ALPHA, 'wfr_ghost', 2);
    const orphanCheckpoints = preflight(chain.map((checkpoint) => checkpointRow(checkpoint)));
    assert.equal(orphanCheckpoints.manifest.goNoGo, 'NO_GO');
    assert.equal(tenantOf(orphanCheckpoints, ALPHA).orphanCheckpointCount, 2);

    const { rows } = soundTenant(ALPHA);
    const orphanApproval = preflight([...rows, approvalRow(makeApproval(ALPHA, 'wfr_ghost'))]);
    assert.equal(orphanApproval.manifest.goNoGo, 'NO_GO');
    assert.equal(tenantOf(orphanApproval, ALPHA).orphanApprovalCount, 1);
  });

  it('37. reaches GO FOR A LATER BACKFILL for a valid, explicitly resolved fixture', () => {
    const canonical = soundTenant(ALPHA, 'wfr_canonical');
    const remapped = soundTenant(MARQ_SOURCE, 'wfr_remapped');
    const result = preflight([...canonical.rows, ...remapped.rows], [MAPPING_MARQ]);

    assert.equal(result.manifest.goNoGo, 'GO_FOR_LATER_BACKFILL_PACKET');
    // AND IT IS NOT A CUT-OVER VERDICT. The vocabulary has no value that says
    // production authority may move, which is the point.
    assert.equal(
      JSON.stringify(result.manifest).includes('CUT_OVER'),
      false,
      'the manifest suggests a cutover verdict',
    );
    assert.equal(result.manifest.readyTenantCount, 2);
    assert.equal(result.manifest.blockedTenantCount, 0);
    assert.equal(result.manifest.allSourceChainsValid, true);
    assert.equal(result.manifest.allMappingsExplicit, true);
    assert.equal(result.manifest.allTargetsCanonical, true);
    assert.equal(result.manifest.tool, 'bp004-workflow-cutover-preflight');

    const canonicalTenant = tenantOf(result, ALPHA);
    assert.equal(canonicalTenant.digestRewriteRequired, false);
    assert.equal(canonicalTenant.sourceFingerprint?.mode, 'exact');

    const remappedTenant = tenantOf(result, MARQ_SOURCE);
    assert.equal(remappedTenant.digestRewriteRequired, true);
    assert.equal(remappedTenant.sourceFingerprint?.mode, 'migration-semantic');
    assert.equal(
      remappedTenant.sourceFingerprint?.digest,
      remappedTenant.transformedFingerprint?.digest,
    );

    assert.equal(result.plans.length, 2);
    for (const plan of result.plans) {
      for (const bundle of plan.bundles) {
        assert.equal(bundle.run.context.organizationId, plan.targetOrganizationId);
        assert.deepEqual(verifyChain(bundle.checkpoints), { ok: true });
      }
    }
  });

  it('37b. refuses the same fixture when the local backfill is not verified', () => {
    const canonical = soundTenant(ALPHA, 'wfr_canonical');
    const result = preflight(canonical.rows, [], false);
    assert.equal(result.manifest.goNoGo, 'NO_GO');
    assert.equal(result.manifest.localBackfillVerified, false);
    assert.match(result.manifest.reasons.join(' '), /local dry-run backfill has not been verified/);
    assert.deepEqual(result.plans, []);
  });

  it('38. reports active runs explicitly rather than treating them as terminal', () => {
    const states: WorkflowRunState[] = [
      'running',
      'waiting_for_agent',
      'waiting_for_branches',
      'waiting_for_approval',
      'paused',
      'completed',
      'failed',
      'cancelled',
    ];
    const rows: WorkflowSourceRow[] = [];
    states.forEach((state, index) => {
      const runId = `wfr_state_${index}`;
      const chain = makeChain(ALPHA, runId, 1);
      rows.push(runRow(makeRun(ALPHA, runId, chain, state)));
      rows.push(checkpointRow(chain[0]));
    });

    const result = preflight(rows);
    const tenant = tenantOf(result, ALPHA);
    assert.equal(tenant.activeRunCount, 5, 'five of the eight are still live');
    assert.equal(tenant.terminalRunCount, 3);
    assert.equal(tenant.census.byState.waiting_for_approval, 1);
    assert.equal(tenant.census.byState.waiting_for_branches, 1);
    assert.equal(tenant.census.byState.waiting_for_agent, 1);
    assert.equal(tenant.census.byState.paused, 1);
    assert.equal(tenant.census.byState.expired, 0);
    // A ready tenant with live runs is STILL a ready tenant — readiness is
    // about the data, and what to do about a live run is the next packet's
    // decision. What BP-004 owes it is the number, not a policy.
    assert.equal(tenant.readiness, 'GO_FOR_LATER_BACKFILL_PACKET');
  });

  it('38b. counts a run with a child in flight and one awaiting a retry', () => {
    const chain = makeChain(ALPHA, 'wfr_inflight', 1);
    const base = makeRun(ALPHA, 'wfr_inflight', chain, 'waiting_for_agent');
    const run: WorkflowRunRecord = {
      ...base,
      pendingNode: {
        nodeId: 'node_2',
        agentId: 'agent.reviewer',
        agentRunId: 'run_child_2',
        startedAt: '2026-09-21T10:04:00.000Z',
        sequence: 1,
        attempt: 1,
      },
      retries: [
        {
          nodeId: 'node_2',
          attempt: 1,
          eligibleAt: '2026-09-21T10:06:00.000Z',
        },
      ] as unknown as WorkflowRunRecord['retries'],
    };
    const result = preflight([runRow(run), checkpointRow(chain[0])]);
    const tenant = tenantOf(result, ALPHA);
    assert.equal(tenant.census.withPendingNode, 1);
    assert.equal(tenant.census.withPendingRetry, 1);
  });

  it('38c. carries no workflow input, output or approval text into the manifest', () => {
    const { rows } = soundTenant(ALPHA);
    const result = preflight(rows);
    const serialized = JSON.stringify(result.manifest);
    for (const secretish of ['quarterly-revenue-review', 'output 1', 'A human must confirm', 'sub_4211']) {
      assert.equal(
        serialized.includes(secretish),
        false,
        `the manifest carries business content: ${secretish}`,
      );
    }
  });
});

// ── Safety ──────────────────────────────────────────────────────────────────

describe('BP-004 local-only safety', () => {
  /**
   * NOTHING HERE CONNECTS TO ANYTHING.
   *
   * Every case below is the classifier being asked a question about an
   * environment that exists only inside the test. A suite that proved a remote
   * refusal by attempting a remote connection would be a suite that attempts
   * remote connections.
   *
   * `203.0.113.10` is TEST-NET-3 (RFC 5737): reserved for documentation, and
   * routable to nothing.
   */
  const REMOTE = '203.0.113.10';

  it('40. refuses a non-local database URL and says so rather than warning', () => {
    for (const url of [
      'postgresql://user:pw@db.abcdefgh.supabase.co:5432/postgres',
      'postgres://user:pw@10.0.0.4:5432/postgres',
      'postgresql://user:pw@prod-db.internal:5432/postgres',
      'postgresql://user:pw@0.0.0.0:5432/postgres',
      'postgresql://user:pw@localhost.evil.example:5432/postgres',
    ]) {
      const verdict = classifyDatabaseTarget({ DATABASE_URL: url });
      assert.equal(verdict.ok, false, `${url} was accepted`);
    }
  });

  it('40b. accepts the loopback spellings and a local socket', () => {
    const accepted = [
      { DATABASE_URL: 'postgresql://postgres@localhost:5432/scratch' },
      { DATABASE_URL: 'postgres://postgres@127.0.0.1:5432/scratch' },
      { DATABASE_URL: 'postgresql://postgres@[::1]:5432/scratch' },
      { DATABASE_URL: 'postgresql:///scratch?host=/var/run/postgresql' },
      { PGHOST: '/var/run/postgresql' },
      { PGHOST: 'localhost' },
      { PGHOST: '127.0.0.1' },
      { PGHOST: '::1' },
      {},
    ];
    for (const env of accepted) {
      assert.equal(classifyDatabaseTarget(env).ok, true, `${JSON.stringify(env)} was refused`);
    }
  });

  it('40c. fails closed on a connection string it cannot parse', () => {
    for (const url of ['not a url', 'http://localhost:5432/db', '://localhost/db']) {
      assert.equal(classifyDatabaseTarget({ DATABASE_URL: url }).ok, false, `${url} was accepted`);
    }
    assert.equal(classifyDatabaseTarget({ PGHOST: 'db.example.com' }).ok, false);
  });

  it('40d. reads the host query parameter rather than ignoring it', () => {
    const verdict = classifyDatabaseTarget({
      DATABASE_URL: 'postgresql:///scratch?host=db.abcdefgh.supabase.co',
    });
    assert.equal(verdict.ok, false);
  });

  // ── The libpq selectors a hostname check does not see ────────────────────

  it('43. refuses PGHOSTADDR even when PGHOST reads as loopback', () => {
    // THE ONE THAT MATTERS MOST. `PGHOSTADDR` is the network address and it
    // WINS; `PGHOST` is then only used for authentication. A guard that read
    // `PGHOST` would have approved a connection to TEST-NET-3.
    const verdict = classifyDatabaseTarget({ PGHOST: 'localhost', PGHOSTADDR: REMOTE });
    assert.equal(verdict.ok, false);
    assert.match(verdict.ok ? '' : verdict.problem, /PGHOSTADDR/);
  });

  it('43b. refuses PGHOSTADDR even when it is itself loopback', () => {
    // BP-004 has no use for naming an address separately from a host, so the
    // variable is refused rather than interpreted. A feature that is refused
    // cannot be misunderstood.
    assert.equal(classifyDatabaseTarget({ PGHOSTADDR: '127.0.0.1' }).ok, false);
  });

  it('44. refuses PGSERVICE and PGSERVICEFILE', () => {
    // A service stanza supplies host, port, database and user wholesale, so the
    // environment can name no host at all and the connection still goes
    // somewhere. There is nothing to check, which is why there is nothing to
    // allow.
    const service = classifyDatabaseTarget({ PGSERVICE: 'production' });
    assert.equal(service.ok, false);
    assert.match(service.ok ? '' : service.problem, /PGSERVICE/);

    const file = classifyDatabaseTarget({ PGSERVICEFILE: '/tmp/pg_service.conf' });
    assert.equal(file.ok, false);
    assert.match(file.ok ? '' : file.problem, /PGSERVICEFILE/);

    // And they are refused even beside a target that would otherwise pass.
    assert.equal(
      classifyDatabaseTarget({ DATABASE_URL: 'postgresql://localhost/scratch', PGSERVICE: 'production' }).ok,
      false,
    );
  });

  it('45. refuses the URI spellings of the same two selectors', () => {
    const hostaddr = classifyDatabaseTarget({
      DATABASE_URL: `postgresql://localhost/db?hostaddr=${REMOTE}`,
    });
    assert.equal(hostaddr.ok, false);
    assert.match(hostaddr.ok ? '' : hostaddr.problem, /hostaddr=/);

    const service = classifyDatabaseTarget({ DATABASE_URL: 'postgresql:///db?service=production' });
    assert.equal(service.ok, false);
    assert.match(service.ok ? '' : service.problem, /service=/);
  });

  it('46. refuses a host list in every spelling', () => {
    // libpq tries each entry in turn, so one local entry proves nothing about
    // where the connection ends up.
    const cases: Readonly<Record<string, string | undefined>>[] = [
      { PGHOST: '/var/run/postgresql,remote.example.com' },
      { PGHOST: 'localhost,remote.example.com' },
      { DATABASE_URL: 'postgresql://localhost,remote.example.com/db' },
      { DATABASE_URL: 'postgresql:///db?host=/var/run/postgresql,remote.example.com' },
      { DATABASE_URL: 'postgresql:///db?host=localhost,remote.example.com' },
    ];
    for (const env of cases) {
      const verdict = classifyDatabaseTarget(env);
      assert.equal(verdict.ok, false, `${JSON.stringify(env)} was accepted`);
    }

    // A multi-host URI carrying ports does not parse at all, which is the right
    // answer for the right reason.
    const ported = classifyDatabaseTarget({
      DATABASE_URL: 'postgresql://host1:5432,host2:5432/db',
    });
    assert.equal(ported.ok, false);
  });

  it('47. a URI naming no host does not mean the socket', () => {
    // libpq falls back to PGHOST here, so "a URL is present" was never a reason
    // to stop reading the environment.
    const redirected = classifyDatabaseTarget({
      DATABASE_URL: 'postgresql:///scratch',
      PGHOST: 'remote.example.com',
    });
    assert.equal(redirected.ok, false, 'a hostless URI let PGHOST through unchecked');

    // And the same shape with a local PGHOST is still fine.
    assert.equal(
      classifyDatabaseTarget({ DATABASE_URL: 'postgresql:///scratch', PGHOST: '/var/run/postgresql' }).ok,
      true,
    );
    assert.equal(classifyDatabaseTarget({ DATABASE_URL: 'postgresql:///scratch' }).ok, true);
  });

  it('47b. refuses exotic spellings of loopback rather than resolving them', () => {
    // Both of these reach 127.0.0.1 through libpq. An allow-list that tried to
    // recognise them would be an allow-list that has to recognise the next one
    // too, so they are refused: the cost is that somebody types `localhost`.
    for (const host of ['127.0.0.1.', '0x7f.1', '2130706433', '127.1']) {
      assert.equal(classifyDatabaseTarget({ PGHOST: host }).ok, false, `${host} was accepted`);
    }
  });

  // ── The child environment ────────────────────────────────────────────────

  it('48. strips every selector the guard refuses to reason about', () => {
    const raw = {
      DATABASE_URL: 'postgresql://localhost/scratch',
      PGHOST: 'localhost',
      PGHOSTADDR: REMOTE,
      PGSERVICE: 'production',
      PGSERVICEFILE: '/tmp/pg_service.conf',
      PGSYSCONFDIR: '/etc/postgresql-common',
      PGPASSWORD: 'local-only',
      PGUSER: 'postgres',
      PATH: '/usr/bin',
    };
    const sanitized = localDatabaseEnvironment(raw);

    for (const name of ['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGSYSCONFDIR']) {
      assert.equal(name in sanitized, false, `${name} reached the child`);
    }
    assert.deepEqual(STRIPPED_LOCATION_VARIABLES.slice().sort(), [
      'PGHOSTADDR',
      'PGSERVICE',
      'PGSERVICEFILE',
      'PGSYSCONFDIR',
    ]);

    // AUTHENTICATION IS NOT LOCATION. Removing these would break a legitimate
    // local setup for the appearance of tidiness, and none of them can choose a
    // different target.
    assert.equal(sanitized.PGPASSWORD, 'local-only');
    assert.equal(sanitized.PGUSER, 'postgres');
    assert.equal(sanitized.PATH, '/usr/bin');
    // The validated mechanism travels through untouched.
    assert.equal(sanitized.DATABASE_URL, 'postgresql://localhost/scratch');
    assert.equal(sanitized.PGHOST, 'localhost');

    // And the caller's own environment is not mutated on the way past.
    assert.equal(raw.PGHOSTADDR, REMOTE);
  });

  it('48b. every refused variable is also a stripped one', () => {
    // A selector that could refuse a run but still reach the child would be a
    // selector nobody validated, in a process nobody guarded.
    for (const name of REFUSED_LOCATION_VARIABLES) {
      assert.equal(
        STRIPPED_LOCATION_VARIABLES.includes(name),
        true,
        `${name} is refused but not stripped`,
      );
      assert.equal(classifyDatabaseTarget({ [name]: 'anything' }).ok, false);
    }
  });

  // ── The scratch database ─────────────────────────────────────────────────

  it('49. accepts only the BP-004 scratch database name', () => {
    const verdict = classifyScratchDatabaseName(BP004_SCRATCH_DATABASE);
    assert.equal(verdict.ok, true);
    assert.equal(verdict.ok && verdict.quoted, `"${BP004_SCRATCH_DATABASE}"`);
  });

  it('49b. refuses the protected databases', () => {
    for (const name of ['postgres', 'template0', 'template1']) {
      assert.equal(classifyScratchDatabaseName(name).ok, false, `${name} was accepted`);
    }
  });

  it('49c. refuses anything that is not a Cortex scratch name', () => {
    for (const name of [
      'marqcortex_production',
      'app_production',
      'cortex',
      '',
      'Cortex_Workflow',
      'cortex_workflow-readiness',
      'cortex_workflow readiness',
      `cortex_a${'b'.repeat(60)}`,
    ]) {
      assert.equal(classifyScratchDatabaseName(name).ok, false, `${JSON.stringify(name)} was accepted`);
    }
  });

  it('49d. refuses input built to carry a statement', () => {
    // The name is interpolated into CREATE DATABASE and DROP DATABASE. None of
    // these reaches the quoting, because none of them reaches the pattern.
    for (const name of [
      'cortex_x"; DROP DATABASE postgres; --',
      'cortex_x; DROP DATABASE postgres',
      'postgres" WITH (FORCE); --',
      'cortex_a,cortex_b',
      'cortex_x\nDROP DATABASE postgres',
      "cortex_x' OR '1'='1",
    ]) {
      assert.equal(classifyScratchDatabaseName(name).ok, false, `${JSON.stringify(name)} was accepted`);
    }
  });
});
