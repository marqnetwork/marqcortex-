/**
 * THE WORKFLOW PERSISTENCE CONTRACT, as one list of cases (BP-003 / A2).
 *
 * Three implementations satisfy `WorkflowRunStore`, `WorkflowCheckpointStore`
 * and `WorkflowApprovalStore`: the in-memory reference in `persistence/ports.ts`,
 * the key-value store that is TODAY'S PRODUCTION AUTHORITY, and the SQL store
 * BP-003 adds. The whole point of this packet is that the third behaves like
 * the second, so the assertions live here — once — and every implementation is
 * driven through the same ones.
 *
 * ── WHY CASES AND NOT `describe` BLOCKS ───────────────────────────────────
 *
 * Two runners have to execute these. `workflowPersistenceParity.test.ts` runs
 * them under `node:test` against memory and against the key-value store with a
 * deterministic compare-and-swap harness. `scripts/workflow-persistence-scenarios.ts`
 * runs them against a live local PostgreSQL, where `node:test` is the wrong
 * shape because the suite has to create a scratch database, apply the real
 * migration chain and destroy it afterwards.
 *
 * A list of `{ name, run }` satisfies both without either runner owning the
 * assertions. If these were `it(...)` calls the live suite would have to
 * restate them, and a restated assertion is an assertion that drifts.
 *
 * ── THE DIVERGENCE THIS FILE REFUSES TO HIDE ──────────────────────────────
 *
 * `save` against a run that is not stored fails with `workflow_run_not_found`
 * in memory and `stale_workflow_version` over the key-value store. That is not
 * something BP-003 introduced: `kv_compare_and_swap_field` cannot tell "this
 * record moved on" from "this record was never here", so it reports both as a
 * lost swap, and the in-memory store — which reads before it writes — can.
 *
 * It is declared on the harness rather than smoothed over, because the packet's
 * rule is that a difference between implementations gets IDENTIFIED. The SQL
 * store CAN distinguish the two and deliberately does not: it declares the
 * key-value store's answer, because the key-value store is what production
 * does today and parity with production is the acceptance gate.
 */

import assert from 'node:assert/strict';

import type { WorkflowRunRecord, WorkflowRunState } from '../workflows/contracts/run.ts';
import type { WorkflowCheckpoint } from '../workflows/contracts/checkpoint.ts';
import type {
  WorkflowApprovalRecord,
  WorkflowApprovalState,
} from '../workflows/contracts/approval.ts';
import type {
  WorkflowApprovalStore,
  WorkflowCheckpointStore,
  WorkflowRunStore,
} from '../workflows/persistence/ports.ts';
import type { WorkflowFailureCode } from '../workflows/contracts/failures.ts';

// ── Tenants ─────────────────────────────────────────────────────────────────

/**
 * UUIDs, and not the short tenant names the other AI suites use.
 *
 * The relational stores carry `organization_id` as a UUID with a foreign key to
 * `organizations`, and the in-memory and key-value stores accept any identifier
 * their tenancy grammar admits — which a UUID is. So one fixture drives all
 * three, and the parity claim is about the same identifiers rather than about
 * three shapes that happen to behave alike.
 */
export const ALPHA = '11111111-1111-4111-8111-111111111111';
export const BETA = '22222222-2222-4222-8222-222222222222';

// ── Record builders ─────────────────────────────────────────────────────────

/**
 * A structurally complete run record.
 *
 * Complete rather than minimal on purpose: the SQL store projects six fields
 * out of the record into relational columns and a CHECK refuses a row whose
 * projection disagrees with its payload, so a fixture missing `checkpointVersion`
 * or `updatedAt` would prove something narrower than the contract.
 */
export function makeRun(overrides: Partial<{
  organizationId: string;
  workflowRunId: string;
  workflowId: string;
  actorId: string;
  state: WorkflowRunState;
  runVersion: number;
  checkpointVersion: number;
  createdAt: string;
  updatedAt: string;
}> = {}): WorkflowRunRecord {
  const organizationId = overrides.organizationId ?? ALPHA;
  const workflowRunId = overrides.workflowRunId ?? 'wfr_contract1';
  const createdAt = overrides.createdAt ?? '2026-09-21T10:00:00.000Z';
  return {
    context: {
      workflowRunId,
      correlationId: 'cor_contract',
      requestId: 'req_contract',
      organizationId,
      actorId: overrides.actorId ?? 'user_alpha',
      actorRoles: ['workflow_operator'],
      origin: { surface: 'team_console', feature: 'contract-suite' },
      workflowId: overrides.workflowId ?? 'wf.review',
      workflowVersion: '1.0.0',
      planDigest: 'plan_digest_contract',
    },
    runVersion: overrides.runVersion ?? 1,
    state: overrides.state ?? 'running',
    stepCount: 0,
    parallelGroups: [],
    retries: [],
    usage: { rows: [] } as unknown as WorkflowRunRecord['usage'],
    childAgentRunIds: [],
    steps: [],
    transitions: [],
    transitionsTruncated: 0,
    checkpointVersion: overrides.checkpointVersion ?? 0,
    input: { topic: 'contract' },
    inputDigest: 'input_digest_contract',
    configurationVersion: 1,
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
    deadlineAt: '2026-09-21T11:00:00.000Z',
    elapsedRuntimeMs: 0,
  };
}

export function makeCheckpoint(overrides: Partial<{
  organizationId: string;
  workflowRunId: string;
  version: number;
  digest: string;
  previousDigest: string;
  nodeId: string;
  state: WorkflowRunState;
  createdAt: string;
}> = {}): WorkflowCheckpoint {
  const version = overrides.version ?? 1;
  const previousDigest = overrides.previousDigest;
  return {
    workflowRunId: overrides.workflowRunId ?? 'wfr_contract1',
    organizationId: overrides.organizationId ?? ALPHA,
    version,
    createdAt: overrides.createdAt ?? `2026-09-21T10:0${Math.min(version, 9)}:00.000Z`,
    state: overrides.state ?? 'running',
    nodeId: overrides.nodeId ?? `node_${version}`,
    stepCount: version,
    outputs: {},
    outputsDigest: `outputs_${version}`,
    loopIterations: {},
    nodeVisits: {},
    parallel: [],
    // Absent on version 1 and present on every later link — the shape
    // `contracts/checkpoint.ts` declares, and the shape the relational chain
    // constraint enforces.
    ...(previousDigest === undefined
      ? version === 1
        ? {}
        : { previousDigest: `digest_${version - 1}` }
      : { previousDigest }),
    digest: overrides.digest ?? `digest_${version}`,
  };
}

export function makeApproval(overrides: Partial<{
  organizationId: string;
  workflowApprovalId: string;
  workflowRunId: string;
  workflowId: string;
  nodeId: string;
  approvalState: WorkflowApprovalState;
  approvalVersion: number;
  createdAt: string;
  expiresAt: string;
  decidedAt: string;
  consumedAt: string;
}> = {}): WorkflowApprovalRecord {
  const createdAt = overrides.createdAt ?? '2026-09-21T10:00:50.000Z';
  return {
    workflowApprovalId: overrides.workflowApprovalId ?? 'wfa:wfr_contract1:gate:main:1',
    workflowRunId: overrides.workflowRunId ?? 'wfr_contract1',
    organizationId: overrides.organizationId ?? ALPHA,
    workflowId: overrides.workflowId ?? 'wf.review',
    nodeId: overrides.nodeId ?? 'gate',
    requestedBy: 'user_alpha',
    reason: 'A human must confirm the finding before it is committed.',
    impactSummary: 'Proceeding writes the reviewed outcome to the submission.',
    estimatedAdditionalTokens: 0,
    estimatedAdditionalCostMicroUsd: 0,
    authorizedRoles: ['workflow_approver'],
    checkpointVersion: 1,
    workflowRunVersion: 2,
    createdAt,
    expiresAt: overrides.expiresAt ?? '2026-09-21T11:00:50.000Z',
    ...(overrides.decidedAt === undefined ? {} : { decidedAt: overrides.decidedAt }),
    ...(overrides.consumedAt === undefined ? {} : { consumedAt: overrides.consumedAt }),
    singleUse: true,
    approvalState: overrides.approvalState ?? 'pending',
    onRejection: 'fail',
    approvalVersion: overrides.approvalVersion ?? 1,
  };
}

// ── The harness an implementation supplies ──────────────────────────────────

export interface WorkflowPersistenceStores {
  readonly runs: WorkflowRunStore;
  readonly checkpoints: WorkflowCheckpointStore;
  readonly approvals: WorkflowApprovalStore;
}

export interface WorkflowPersistenceHarness extends WorkflowPersistenceStores {
  /** Human name, so a failure says which implementation produced it. */
  readonly name: string;
  /**
   * What `save` raises for a record that is not stored.
   *
   * Declared rather than assumed. See the header: memory can tell absence from
   * staleness and the durable implementations cannot, and pretending otherwise
   * would be the papering-over this packet forbids.
   */
  readonly missingSaveFailure: WorkflowFailureCode;
  readonly missingApprovalSaveFailure: WorkflowFailureCode;
  /**
   * Make a run exist as a parent for checkpoints and approvals.
   *
   * The relational stores hold tenant-safe foreign keys, so a checkpoint for a
   * run that was never created is not a thing they can store — which is the
   * correct behaviour and is also what the engine always does anyway. Memory
   * and the key-value store do not need it; they run the same call so the
   * fixture is identical across implementations rather than branching on one.
   */
  seedRun(record: WorkflowRunRecord): Promise<void>;
  /** Drop everything, so each case starts from an empty store. */
  reset(): Promise<void>;
}

export interface PersistenceCase {
  readonly name: string;
  run(harness: WorkflowPersistenceHarness): Promise<void>;
}

// ── Assertion helpers ───────────────────────────────────────────────────────

/** Assert a call rejects with a specific workflow failure code. */
async function refuses(
  call: () => Promise<unknown>,
  failure: WorkflowFailureCode,
  what: string,
): Promise<void> {
  let raised: unknown;
  try {
    await call();
  } catch (error) {
    raised = error;
  }
  assert.ok(raised !== undefined, `${what}: expected a refusal, the call succeeded`);
  const code = (raised as { failure?: unknown }).failure;
  assert.equal(code, failure, `${what}: expected ${failure}, got ${String(code)}`);
}

const runIds = (records: readonly WorkflowRunRecord[]): readonly string[] =>
  records.map((record) => record.context.workflowRunId);

const approvalIds = (records: readonly WorkflowApprovalRecord[]): readonly string[] =>
  records.map((record) => record.workflowApprovalId);

// ── Runs ────────────────────────────────────────────────────────────────────

const RUN_CASES: readonly PersistenceCase[] = [
  {
    name: 'run: create then load returns the record it was given',
    async run(h) {
      const record = makeRun();
      await h.runs.create(record);
      const loaded = await h.runs.load(ALPHA, record.context.workflowRunId);
      assert.ok(loaded, 'the run was not readable after create');
      assert.equal(loaded.context.workflowRunId, record.context.workflowRunId);
      assert.equal(loaded.runVersion, 1);
      assert.equal(loaded.state, 'running');
      assert.equal(loaded.context.organizationId, ALPHA);
      // The one content field a run record carries, round-tripped.
      assert.deepEqual(loaded.input, { topic: 'contract' });
      assert.equal(loaded.inputDigest, 'input_digest_contract');
    },
  },
  {
    name: 'run: loading an id that was never created is undefined, not an error',
    async run(h) {
      assert.equal(await h.runs.load(ALPHA, 'wfr_never'), undefined);
    },
  },
  {
    name: 'run: a duplicate id is refused and never overwrites',
    async run(h) {
      await h.runs.create(makeRun({ state: 'running' }));
      await refuses(
        () => h.runs.create(makeRun({ state: 'cancelled' })),
        'workflow_persistence_failed',
        'duplicate run create',
      );
      const loaded = await h.runs.load(ALPHA, 'wfr_contract1');
      assert.equal(loaded?.state, 'running', 'the duplicate create overwrote the live run');
    },
  },
  {
    name: 'run: a save carrying the version it read is accepted',
    async run(h) {
      await h.runs.create(makeRun());
      await h.runs.save(makeRun({ runVersion: 2, state: 'completed', checkpointVersion: 1 }), 1);
      const loaded = await h.runs.load(ALPHA, 'wfr_contract1');
      assert.equal(loaded?.runVersion, 2);
      assert.equal(loaded?.state, 'completed');
      assert.equal(loaded?.checkpointVersion, 1);
    },
  },
  {
    name: 'run: a save carrying a version that has moved on is refused',
    async run(h) {
      await h.runs.create(makeRun());
      await h.runs.save(makeRun({ runVersion: 2, state: 'completed' }), 1);
      await refuses(
        () => h.runs.save(makeRun({ runVersion: 2, state: 'failed' }), 1),
        'stale_workflow_version',
        'stale run save',
      );
      const loaded = await h.runs.load(ALPHA, 'wfr_contract1');
      assert.equal(loaded?.state, 'completed', 'the stale save landed on top of the winner');
    },
  },
  {
    name: 'run: a save against a run that is not stored is refused',
    async run(h) {
      // The declared failure, not an assumed one. See the header.
      await refuses(
        () => h.runs.save(makeRun({ runVersion: 2 }), 1),
        h.missingSaveFailure,
        'save of a missing run',
      );
    },
  },
  {
    name: 'run: one tenant cannot load or list another tenant\'s run',
    async run(h) {
      await h.runs.create(makeRun({ organizationId: ALPHA }));
      assert.equal(await h.runs.load(BETA, 'wfr_contract1'), undefined);
      assert.deepEqual(await h.runs.list({ organizationId: BETA }), []);
    },
  },
  {
    name: 'run: the state filter narrows and never widens',
    async run(h) {
      await h.runs.create(makeRun({ workflowRunId: 'wfr_r1', state: 'running' }));
      await h.runs.create(makeRun({ workflowRunId: 'wfr_r2', state: 'completed' }));
      await h.runs.create(makeRun({ workflowRunId: 'wfr_r3', state: 'failed' }));

      const running = await h.runs.list({ organizationId: ALPHA, states: ['running'] });
      assert.deepEqual(runIds(running), ['wfr_r1']);

      const two = await h.runs.list({ organizationId: ALPHA, states: ['completed', 'failed'] });
      assert.equal(two.length, 2);

      const none = await h.runs.list({ organizationId: ALPHA, states: ['policy_denied'] });
      assert.deepEqual(runIds(none), []);
    },
  },
  {
    name: 'run: the workflow filter narrows',
    async run(h) {
      await h.runs.create(makeRun({ workflowRunId: 'wfr_w1', workflowId: 'wf.review' }));
      await h.runs.create(makeRun({ workflowRunId: 'wfr_w2', workflowId: 'wf.intake' }));
      const review = await h.runs.list({ organizationId: ALPHA, workflowId: 'wf.review' });
      assert.deepEqual(runIds(review), ['wfr_w1']);
    },
  },
  {
    name: 'run: the actor filter narrows',
    async run(h) {
      await h.runs.create(makeRun({ workflowRunId: 'wfr_a1', actorId: 'user_one' }));
      await h.runs.create(makeRun({ workflowRunId: 'wfr_a2', actorId: 'user_two' }));
      const mine = await h.runs.list({ organizationId: ALPHA, actorId: 'user_two' });
      assert.deepEqual(runIds(mine), ['wfr_a2']);
    },
  },
  {
    name: 'run: several filters compose, and each one narrows',
    async run(h) {
      await h.runs.create(
        makeRun({ workflowRunId: 'wfr_c1', workflowId: 'wf.review', actorId: 'u1', state: 'running' }),
      );
      await h.runs.create(
        makeRun({ workflowRunId: 'wfr_c2', workflowId: 'wf.review', actorId: 'u2', state: 'running' }),
      );
      await h.runs.create(
        makeRun({ workflowRunId: 'wfr_c3', workflowId: 'wf.intake', actorId: 'u1', state: 'running' }),
      );
      const narrowed = await h.runs.list({
        organizationId: ALPHA,
        workflowId: 'wf.review',
        actorId: 'u1',
        states: ['running'],
      });
      assert.deepEqual(runIds(narrowed), ['wfr_c1']);
    },
  },
  {
    name: 'run: the listing is newest first, and ties break reproducibly',
    async run(h) {
      await h.runs.create(makeRun({ workflowRunId: 'wfr_old', createdAt: '2026-09-21T09:00:00.000Z' }));
      await h.runs.create(makeRun({ workflowRunId: 'wfr_new', createdAt: '2026-09-21T11:00:00.000Z' }));
      await h.runs.create(makeRun({ workflowRunId: 'wfr_mid', createdAt: '2026-09-21T10:00:00.000Z' }));
      const listed = await h.runs.list({ organizationId: ALPHA });
      assert.deepEqual(runIds(listed), ['wfr_new', 'wfr_mid', 'wfr_old']);
    },
  },
  {
    name: 'run: runs sharing one instant order by id, descending and stably',
    async run(h) {
      // THE CASE THAT FORCED THE DESIGN. PostgreSQL cannot reproduce
      // `localeCompare` — it orders `node-b` before `node_b` and JavaScript
      // orders the reverse — so the SQL store sorts in the domain, over a
      // candidate set fetched WITH TIES. Identical timestamps and ids that
      // collate differently in the two systems is exactly where an
      // implementation that let the database sort would diverge.
      const at = '2026-09-21T10:00:00.000Z';
      for (const id of ['wfr_b', 'wfr-b', 'wfr_a', 'wfr-a']) {
        await h.runs.create(makeRun({ workflowRunId: id, createdAt: at }));
      }
      const first = await h.runs.list({ organizationId: ALPHA });
      const second = await h.runs.list({ organizationId: ALPHA });
      assert.deepEqual(runIds(first), runIds(second), 'the listing is not stable across calls');
      assert.equal(first.length, 4);
      // Newest-first with equal timestamps means the id tie-break decides, and
      // the expected order is the PORTS' order — `sortWorkflowRuns` — whichever
      // store produced it.
      assert.deepEqual(
        runIds(first),
        [...['wfr_b', 'wfr-b', 'wfr_a', 'wfr-a']].sort((a, b) => b.localeCompare(a)),
      );
    },
  },
  {
    name: 'run: the limit bounds the listing and keeps the newest',
    async run(h) {
      for (let i = 1; i <= 5; i += 1) {
        await h.runs.create(
          makeRun({
            workflowRunId: `wfr_l${i}`,
            createdAt: `2026-09-21T10:0${i}:00.000Z`,
          }),
        );
      }
      const two = await h.runs.list({ organizationId: ALPHA, limit: 2 });
      assert.deepEqual(runIds(two), ['wfr_l5', 'wfr_l4']);
      // Out-of-range limits are clamped rather than honoured or rejected.
      const clampedLow = await h.runs.list({ organizationId: ALPHA, limit: 0 });
      assert.equal(clampedLow.length, 1, 'a limit below one was not clamped to one');
      const clampedHigh = await h.runs.list({ organizationId: ALPHA, limit: 10_000 });
      assert.equal(clampedHigh.length, 5);
    },
  },
];

// ── Checkpoints ─────────────────────────────────────────────────────────────

const CHECKPOINT_CASES: readonly PersistenceCase[] = [
  {
    name: 'checkpoint: append then read returns the checkpoint it was given',
    async run(h) {
      await h.seedRun(makeRun());
      await h.checkpoints.write(makeCheckpoint({ version: 1 }));
      const read = await h.checkpoints.read(ALPHA, 'wfr_contract1', 1);
      assert.ok(read, 'the checkpoint was not readable after write');
      assert.equal(read.version, 1);
      assert.equal(read.digest, 'digest_1');
      assert.equal(read.previousDigest, undefined, 'version 1 must open the chain');
      assert.equal(read.outputsDigest, 'outputs_1');
    },
  },
  {
    name: 'checkpoint: a version that already exists is a conflict, never an overwrite',
    async run(h) {
      await h.seedRun(makeRun());
      await h.checkpoints.write(makeCheckpoint({ version: 1, digest: 'digest_original' }));
      await refuses(
        () => h.checkpoints.write(makeCheckpoint({ version: 1, digest: 'digest_replacement' })),
        'workflow_checkpoint_conflict',
        'duplicate checkpoint version',
      );
      const read = await h.checkpoints.read(ALPHA, 'wfr_contract1', 1);
      assert.equal(read?.digest, 'digest_original', 'a written checkpoint was rewritten');
    },
  },
  {
    name: 'checkpoint: reading a version that was never written is undefined',
    async run(h) {
      await h.seedRun(makeRun());
      assert.equal(await h.checkpoints.read(ALPHA, 'wfr_contract1', 7), undefined);
      assert.equal(await h.checkpoints.latest(ALPHA, 'wfr_contract1'), undefined);
      assert.deepEqual(await h.checkpoints.history(ALPHA, 'wfr_contract1'), []);
    },
  },
  {
    name: 'checkpoint: latest is the highest version, not the last written',
    async run(h) {
      await h.seedRun(makeRun());
      // Written out of order deliberately: "latest" is a statement about the
      // version number, and a store that returned the most recent WRITE would
      // pass a test that wrote them in order.
      await h.checkpoints.write(makeCheckpoint({ version: 1 }));
      await h.checkpoints.write(makeCheckpoint({ version: 3 }));
      await h.checkpoints.write(makeCheckpoint({ version: 2 }));
      const latest = await h.checkpoints.latest(ALPHA, 'wfr_contract1');
      assert.equal(latest?.version, 3);
    },
  },
  {
    name: 'checkpoint: history is numerically ordered past the ten boundary',
    async run(h) {
      await h.seedRun(makeRun());
      // 2 and 10 are the pair that distinguishes numeric ordering from
      // lexicographic. The key-value store zero-pads its keys to make the two
      // agree; the relational store has an integer column and needs no such
      // arrangement. Both are asserted here, not assumed.
      for (const version of [1, 2, 10, 3]) {
        await h.checkpoints.write(makeCheckpoint({ version }));
      }
      const history = await h.checkpoints.history(ALPHA, 'wfr_contract1');
      assert.deepEqual(history.map((c) => c.version), [1, 2, 3, 10]);
      assert.equal((await h.checkpoints.latest(ALPHA, 'wfr_contract1'))?.version, 10);
    },
  },
  {
    name: 'checkpoint: the digest chain round-trips link by link',
    async run(h) {
      await h.seedRun(makeRun());
      await h.checkpoints.write(makeCheckpoint({ version: 1 }));
      await h.checkpoints.write(makeCheckpoint({ version: 2 }));
      await h.checkpoints.write(makeCheckpoint({ version: 3 }));
      const history = await h.checkpoints.history(ALPHA, 'wfr_contract1');
      assert.equal(history[0].previousDigest, undefined);
      assert.equal(history[1].previousDigest, 'digest_1');
      assert.equal(history[2].previousDigest, 'digest_2');
      // Each link names the one before it, which is what lets recovery verify
      // the store rather than trust it.
      for (let i = 1; i < history.length; i += 1) {
        assert.equal(history[i].previousDigest, history[i - 1].digest);
      }
    },
  },
  {
    name: 'checkpoint: one tenant cannot read or walk another tenant\'s chain',
    async run(h) {
      await h.seedRun(makeRun({ organizationId: ALPHA }));
      await h.checkpoints.write(makeCheckpoint({ organizationId: ALPHA, version: 1 }));
      assert.equal(await h.checkpoints.read(BETA, 'wfr_contract1', 1), undefined);
      assert.equal(await h.checkpoints.latest(BETA, 'wfr_contract1'), undefined);
      assert.deepEqual(await h.checkpoints.history(BETA, 'wfr_contract1'), []);
    },
  },
  {
    name: 'checkpoint: two runs\' chains do not bleed into one another',
    async run(h) {
      await h.seedRun(makeRun({ workflowRunId: 'wfr_one' }));
      await h.seedRun(makeRun({ workflowRunId: 'wfr_two' }));
      await h.checkpoints.write(makeCheckpoint({ workflowRunId: 'wfr_one', version: 1 }));
      await h.checkpoints.write(makeCheckpoint({ workflowRunId: 'wfr_two', version: 1 }));
      await h.checkpoints.write(makeCheckpoint({ workflowRunId: 'wfr_two', version: 2 }));
      assert.equal((await h.checkpoints.history(ALPHA, 'wfr_one')).length, 1);
      assert.equal((await h.checkpoints.history(ALPHA, 'wfr_two')).length, 2);
    },
  },
];

// ── Approvals ───────────────────────────────────────────────────────────────

const APPROVAL_CASES: readonly PersistenceCase[] = [
  {
    name: 'approval: create then load returns the record it was given',
    async run(h) {
      await h.seedRun(makeRun());
      const record = makeApproval();
      await h.approvals.create(record);
      const loaded = await h.approvals.load(ALPHA, record.workflowApprovalId);
      assert.ok(loaded, 'the approval was not readable after create');
      assert.equal(loaded.approvalState, 'pending');
      assert.equal(loaded.approvalVersion, 1);
      assert.equal(loaded.singleUse, true);
      assert.equal(loaded.onRejection, 'fail');
      assert.deepEqual(loaded.authorizedRoles, ['workflow_approver']);
    },
  },
  {
    name: 'approval: the expiry and binding fields survive a round trip',
    async run(h) {
      await h.seedRun(makeRun());
      await h.approvals.create(makeApproval({ expiresAt: '2026-09-21T10:30:00.000Z' }));
      const loaded = await h.approvals.load(ALPHA, 'wfa:wfr_contract1:gate:main:1');
      // An approval that came back without its expiry would be an approval
      // nothing could ever expire, sitting at the top of a queue for good.
      assert.equal(loaded?.expiresAt, '2026-09-21T10:30:00.000Z');
      assert.equal(loaded?.createdAt, '2026-09-21T10:00:50.000Z');
      // The binding the decision may be spent from.
      assert.equal(loaded?.checkpointVersion, 1);
      assert.equal(loaded?.workflowRunVersion, 2);
    },
  },
  {
    name: 'approval: a duplicate deterministic id is refused and never overwrites',
    async run(h) {
      await h.seedRun(makeRun());
      await h.approvals.create(makeApproval({ approvalState: 'pending' }));
      // The second create carries a DECIDED record, because that is the shape a
      // decided approval actually has — the gate stamps `decidedAt` in the same
      // write that moves the state. A fixture that claimed `approved` with no
      // decision would be asserting against a record the engine cannot produce,
      // and the relational store refuses it on a different constraint before it
      // ever reaches the duplicate check.
      await refuses(
        () =>
          h.approvals.create(
            makeApproval({
              approvalState: 'approved',
              approvalVersion: 9,
              decidedAt: '2026-09-21T10:05:00.000Z',
            }),
          ),
        'workflow_approval_conflict',
        'duplicate approval create',
      );
      const loaded = await h.approvals.load(ALPHA, 'wfa:wfr_contract1:gate:main:1');
      assert.equal(loaded?.approvalState, 'pending', 'a recomputed id overwrote a live request');
      assert.equal(loaded?.approvalVersion, 1);
    },
  },
  {
    name: 'approval: a decision carrying the version it read is accepted',
    async run(h) {
      await h.seedRun(makeRun());
      await h.approvals.create(makeApproval());
      await h.approvals.save(
        makeApproval({
          approvalState: 'approved',
          approvalVersion: 2,
          decidedAt: '2026-09-21T10:05:00.000Z',
        }),
        1,
      );
      const loaded = await h.approvals.load(ALPHA, 'wfa:wfr_contract1:gate:main:1');
      assert.equal(loaded?.approvalState, 'approved');
      assert.equal(loaded?.approvalVersion, 2);
      assert.equal(loaded?.decidedAt, '2026-09-21T10:05:00.000Z');
    },
  },
  {
    name: 'approval: two decisions on one version resolve to one decision',
    async run(h) {
      await h.seedRun(makeRun());
      await h.approvals.create(makeApproval());
      // The first decider wins.
      await h.approvals.save(
        makeApproval({ approvalState: 'approved', approvalVersion: 2, decidedAt: '2026-09-21T10:05:00.000Z' }),
        1,
      );
      // The second read version 1 too, and must be refused rather than merged.
      await refuses(
        () =>
          h.approvals.save(
            makeApproval({ approvalState: 'rejected', approvalVersion: 2, decidedAt: '2026-09-21T10:05:01.000Z' }),
            1,
          ),
        'stale_workflow_approval',
        'stale approval decision',
      );
      const loaded = await h.approvals.load(ALPHA, 'wfa:wfr_contract1:gate:main:1');
      assert.equal(loaded?.approvalState, 'approved', 'the losing decision landed anyway');
    },
  },
  {
    name: 'approval: an approved request is spent exactly once',
    async run(h) {
      await h.seedRun(makeRun());
      await h.approvals.create(makeApproval());
      await h.approvals.save(
        makeApproval({ approvalState: 'approved', approvalVersion: 2, decidedAt: '2026-09-21T10:05:00.000Z' }),
        1,
      );
      // Two advances race to consume the same approved request.
      await h.approvals.save(
        makeApproval({
          approvalState: 'consumed',
          approvalVersion: 3,
          decidedAt: '2026-09-21T10:05:00.000Z',
          consumedAt: '2026-09-21T10:06:00.000Z',
        }),
        2,
      );
      await refuses(
        () =>
          h.approvals.save(
            makeApproval({
              approvalState: 'consumed',
              approvalVersion: 3,
              decidedAt: '2026-09-21T10:05:00.000Z',
              consumedAt: '2026-09-21T10:06:30.000Z',
            }),
            2,
          ),
        'stale_workflow_approval',
        'second consume of one approval',
      );
      const loaded = await h.approvals.load(ALPHA, 'wfa:wfr_contract1:gate:main:1');
      assert.equal(loaded?.consumedAt, '2026-09-21T10:06:00.000Z');
    },
  },
  {
    name: 'approval: a save against an approval that is not stored is refused',
    async run(h) {
      await h.seedRun(makeRun());
      await refuses(
        () => h.approvals.save(makeApproval({ approvalVersion: 2 }), 1),
        h.missingApprovalSaveFailure,
        'save of a missing approval',
      );
    },
  },
  {
    name: 'approval: the pending filter shows only what can still be decided',
    async run(h) {
      await h.seedRun(makeRun());
      await h.approvals.create(makeApproval({ workflowApprovalId: 'wfa:p1', approvalState: 'pending' }));
      await h.approvals.create(
        makeApproval({
          workflowApprovalId: 'wfa:p2',
          approvalState: 'approved',
          approvalVersion: 2,
          decidedAt: '2026-09-21T10:05:00.000Z',
        }),
      );
      await h.approvals.create(
        makeApproval({
          workflowApprovalId: 'wfa:p3',
          approvalState: 'consumed',
          approvalVersion: 3,
          decidedAt: '2026-09-21T10:05:00.000Z',
          consumedAt: '2026-09-21T10:06:00.000Z',
        }),
      );
      const pending = await h.approvals.list({ organizationId: ALPHA, pendingOnly: true });
      assert.deepEqual(approvalIds(pending), ['wfa:p1']);
      const all = await h.approvals.list({ organizationId: ALPHA });
      assert.equal(all.length, 3);
    },
  },
  {
    name: 'approval: the run filter narrows to one run',
    async run(h) {
      await h.seedRun(makeRun({ workflowRunId: 'wfr_one' }));
      await h.seedRun(makeRun({ workflowRunId: 'wfr_two' }));
      await h.approvals.create(makeApproval({ workflowApprovalId: 'wfa:r1', workflowRunId: 'wfr_one' }));
      await h.approvals.create(makeApproval({ workflowApprovalId: 'wfa:r2', workflowRunId: 'wfr_two' }));
      const one = await h.approvals.list({ organizationId: ALPHA, workflowRunId: 'wfr_one' });
      assert.deepEqual(approvalIds(one), ['wfa:r1']);
    },
  },
  {
    name: 'approval: the queue is OLDEST first, unlike every other listing',
    async run(h) {
      await h.seedRun(makeRun());
      await h.approvals.create(
        makeApproval({ workflowApprovalId: 'wfa:late', createdAt: '2026-09-21T10:30:00.000Z' }),
      );
      await h.approvals.create(
        makeApproval({ workflowApprovalId: 'wfa:early', createdAt: '2026-09-21T10:00:00.000Z' }),
      );
      await h.approvals.create(
        makeApproval({ workflowApprovalId: 'wfa:middle', createdAt: '2026-09-21T10:15:00.000Z' }),
      );
      const queue = await h.approvals.list({ organizationId: ALPHA });
      // The request that has been waiting longest is the one closest to
      // expiring and the one holding a run up. Sorting it like an audit trail
      // would let the oldest quietly time out at the bottom of page four.
      assert.deepEqual(approvalIds(queue), ['wfa:early', 'wfa:middle', 'wfa:late']);
    },
  },
  {
    name: 'approval: approvals sharing one instant order by id, ascending and stably',
    async run(h) {
      await h.seedRun(makeRun());
      const at = '2026-09-21T10:00:00.000Z';
      for (const id of ['wfa:b', 'wfa-b', 'wfa:a', 'wfa-a']) {
        await h.approvals.create(makeApproval({ workflowApprovalId: id, createdAt: at }));
      }
      const first = await h.approvals.list({ organizationId: ALPHA });
      const second = await h.approvals.list({ organizationId: ALPHA });
      assert.deepEqual(approvalIds(first), approvalIds(second), 'the queue is not stable');
      assert.deepEqual(
        approvalIds(first),
        [...['wfa:b', 'wfa-b', 'wfa:a', 'wfa-a']].sort((a, b) => a.localeCompare(b)),
      );
    },
  },
  {
    name: 'approval: the limit bounds the queue and keeps the oldest',
    async run(h) {
      await h.seedRun(makeRun());
      for (let i = 1; i <= 5; i += 1) {
        await h.approvals.create(
          makeApproval({
            workflowApprovalId: `wfa:q${i}`,
            createdAt: `2026-09-21T10:0${i}:00.000Z`,
          }),
        );
      }
      const two = await h.approvals.list({ organizationId: ALPHA, limit: 2 });
      assert.deepEqual(approvalIds(two), ['wfa:q1', 'wfa:q2']);
      assert.equal((await h.approvals.list({ organizationId: ALPHA, limit: 0 })).length, 1);
      assert.equal((await h.approvals.list({ organizationId: ALPHA, limit: 10_000 })).length, 5);
    },
  },
  {
    name: 'approval: one tenant cannot load or list another tenant\'s approvals',
    async run(h) {
      await h.seedRun(makeRun({ organizationId: ALPHA }));
      await h.approvals.create(makeApproval({ organizationId: ALPHA }));
      assert.equal(await h.approvals.load(BETA, 'wfa:wfr_contract1:gate:main:1'), undefined);
      assert.deepEqual(await h.approvals.list({ organizationId: BETA }), []);
      assert.deepEqual(
        await h.approvals.list({ organizationId: BETA, workflowRunId: 'wfr_contract1' }),
        [],
      );
    },
  },
];

/**
 * Every case, in one list.
 *
 * Exported as one array rather than three so a runner cannot accidentally
 * execute a subset and report it as the contract.
 */
export const WORKFLOW_PERSISTENCE_CASES: readonly PersistenceCase[] = [
  ...RUN_CASES,
  ...CHECKPOINT_CASES,
  ...APPROVAL_CASES,
];
