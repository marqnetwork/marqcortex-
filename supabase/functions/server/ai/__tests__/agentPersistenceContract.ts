/**
 * THE AGENT PERSISTENCE CONTRACT, as one list of cases (A2-P07).
 *
 * Three implementations satisfy `AgentRunStore`, `AgentCheckpointStore` and
 * `AgentApprovalStore`: the in-memory reference in `persistence/ports.ts`, the
 * key-value store that is TODAY'S PRODUCTION AUTHORITY, and the SQL candidate
 * in `persistence/sqlAgentStores.ts`. The point of this phase is that the
 * third behaves like the second, so the assertions live here once.
 *
 * Cases rather than `describe` blocks for BP-003's reason: two runners execute
 * them — `agentPersistenceParity.test.ts` under `node:test` for memory and
 * key-value, and `scripts/agent-persistence-scenarios.ts` against a live
 * PostgreSQL — and a restated assertion is one that drifts.
 *
 * ── THE DECLARED DIFFERENCES ──────────────────────────────────────────────
 *
 * `save` of a record that is not stored: memory reads before it writes and
 * says `run_not_found`; the key-value compare-and-swap cannot tell absence
 * from staleness and says `stale_run_version`; the SQL store could tell and
 * deliberately says what production says. Declared on the harness.
 *
 * Referential integrity: the SQL store refuses a checkpoint or approval for a
 * run that was never created, which the agent runtime never writes. Every
 * case seeds its run through `seedRun` so the fixture is identical across
 * implementations rather than branching on which one is under test.
 *
 * ── THE SCOPE OF THE CLAIM ────────────────────────────────────────────────
 *
 * PROVEN: equivalent domain behaviour for UUID-backed tenants. NOT PROVEN, and
 * a named cutover blocker: a slug-shaped tenant (the tenancy grammar admits
 * `marq-cortex`), which the key-value store accepts and the relational
 * authority cannot name. `agentSqlComposition.test.ts` pins the fail-closed
 * behaviour for such a tenant.
 */

import assert from 'node:assert/strict';

import type {
  AgentApprovalRequest,
  AgentCheckpoint,
  AgentRunRecord,
  AgentRunState,
} from '../agents/contracts/runtime.ts';
import type {
  AgentApprovalStore,
  AgentCheckpointStore,
  AgentRunStore,
} from '../agents/persistence/ports.ts';
import type { AgentFailureCode } from '../agents/contracts/failures.ts';
import type { AgentAction } from '../agents/contracts/actions.ts';
import { isAgentRuntimeError } from '../agents/contracts/failures.ts';
import { createApprovalGate } from '../agents/approvals/approvalGate.ts';
import { emptyTokenLedger } from '../agents/runtime/tokenIntelligence.ts';
import { emptyCostLedger } from '../agents/runtime/costPolicy.ts';
import { initialLoopState } from '../agents/runtime/limits.ts';
import { createTestClock } from '../runtime/clock.ts';
import { primaryAgent } from './agentFixtures.ts';

// ── Tenants ─────────────────────────────────────────────────────────────────

export const AGENT_ALPHA = '11111111-1111-4111-8111-111111111111';
export const AGENT_BETA = '22222222-2222-4222-8222-222222222222';

// ── Record builders ─────────────────────────────────────────────────────────

export function makeAgentRun(overrides: Partial<{
  organizationId: string;
  runId: string;
  agentId: string;
  actorId: string;
  state: AgentRunState;
  runVersion: number;
  checkpointVersion: number;
  createdAt: string;
  updatedAt: string;
  parentRunId: string;
  workflowId: string;
}> = {}): AgentRunRecord {
  const createdAt = overrides.createdAt ?? '2026-09-22T10:00:00.000Z';
  const agentId = overrides.agentId ?? 'agent.contract.primary';
  return {
    context: {
      runId: overrides.runId ?? 'run_contract1',
      correlationId: 'cor_contract',
      requestId: 'req_contract',
      organizationId: overrides.organizationId ?? AGENT_ALPHA,
      actorId: overrides.actorId ?? 'user_alpha',
      actorRoles: ['consultant'],
      origin: { surface: 'team_console', feature: 'contract-suite' },
      agentId,
      agentVersion: '1.0.0',
      ...(overrides.workflowId === undefined ? {} : { workflowId: overrides.workflowId }),
      ...(overrides.parentRunId === undefined ? {} : { parentRunId: overrides.parentRunId }),
    },
    runVersion: overrides.runVersion ?? 1,
    state: overrides.state ?? 'created',
    currentAgentId: agentId,
    currentAgentVersion: '1.0.0',
    currentStep: 0,
    stepCount: 0,
    stepsByAgent: {},
    handoffCount: 0,
    retryCount: 0,
    repeatedActionCount: 0,
    tokens: emptyTokenLedger(),
    cost: emptyCostLedger(),
    loop: initialLoopState(agentId),
    claimedToolKeys: [],
    checkpointVersion: overrides.checkpointVersion ?? 0,
    planDigest: 'plan_digest_contract',
    configurationVersion: 1,
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
    deadlineAt: '2026-09-22T10:15:00.000Z',
    elapsedRuntimeMs: 0,
    transitions: [],
    transitionsTruncated: 0,
    steps: [],
    handoffs: [],
  };
}

export function makeAgentCheckpoint(
  version: number,
  overrides: Partial<AgentCheckpoint> = {},
): AgentCheckpoint {
  return {
    runId: 'run_contract1',
    organizationId: AGENT_ALPHA,
    version,
    createdAt: '2026-09-22T10:00:00.000Z',
    state: 'running',
    agentId: 'agent.contract.primary',
    stepCount: version - 1,
    progress: { objective: 'contract', input: { step: version } },
    progressDigest: `pdigest_${version}`,
    ...(version > 1 ? { previousDigest: `pdigest_${version - 1}` } : {}),
    ...overrides,
  };
}

export function makeAgentApproval(
  overrides: Partial<AgentApprovalRequest> = {},
): AgentApprovalRequest {
  return {
    approvalId: 'apr_contract1',
    runId: 'run_contract1',
    actionId: 'act_contract1',
    organizationId: AGENT_ALPHA,
    requestingAgentId: 'agent.contract.primary',
    actionType: 'tool_call',
    impactSummary: 'A bounded impact.',
    dataAffected: ['note'],
    estimatedAdditionalTokens: 0,
    estimatedAdditionalCostMicroUsd: 0,
    reason: 'Because the tool needs it.',
    authorizedApproverRoles: ['owner'],
    expiresAt: '2026-09-22T11:00:00.000Z',
    singleUse: true,
    createdAt: '2026-09-22T10:00:00.000Z',
    state: 'pending',
    approvalVersion: 1,
    ...overrides,
  };
}

// ── The harness ─────────────────────────────────────────────────────────────

export interface AgentPersistenceHarness {
  readonly name: string;
  readonly runs: AgentRunStore;
  readonly checkpoints: AgentCheckpointStore;
  readonly approvals: AgentApprovalStore;
  /** What `runs.save` raises for a run that is not stored. See the header. */
  readonly missingSaveFailure: AgentFailureCode;
  /** What `approvals.save` raises for an approval that is not stored. */
  readonly missingApprovalSaveFailure: AgentFailureCode;
  /** Create a parent run so a child row has something to reference. */
  seedRun(record: AgentRunRecord): Promise<void>;
  reset(): Promise<void>;
}

export interface AgentPersistenceCase {
  readonly name: string;
  run(harness: AgentPersistenceHarness): Promise<void>;
}

function failsWith(code: AgentFailureCode) {
  return (error: unknown) => {
    assert.ok(isAgentRuntimeError(error), `expected an agent failure, got ${String(error)}`);
    assert.equal(error.failure, code);
    return true;
  };
}

/** The fields the domain reads, compared — not `_schema` or storage detail. */
function withoutStorage<T extends object>(value: T): T {
  const { _schema: _ignored, ...rest } = value as T & { _schema?: unknown };
  return rest as T;
}

const TOOL_ACTION = {
  actionId: 'act_gate',
  actionType: 'tool_call',
  toolId: 'tool.contract',
  input: {},
  reason: 'The contract suite needs one approval-gated action.',
  idempotencyKey: 'idem_gate',
} as unknown as AgentAction;

function gateOver(harness: AgentPersistenceHarness, startMs = Date.UTC(2026, 8, 22, 10, 0, 0)) {
  const clock = createTestClock(startMs);
  let next = 0;
  const gate = createApprovalGate({
    store: harness.approvals,
    clock,
    newApprovalId: () => `apr_gate_${(next += 1)}`,
  });
  return { gate, clock };
}

async function requestThroughGate(harness: AgentPersistenceHarness) {
  await harness.seedRun(makeAgentRun());
  const { gate, clock } = gateOver(harness);
  const request = await gate.request({
    action: TOOL_ACTION,
    agent: primaryAgent,
    runId: 'run_contract1',
    organizationId: AGENT_ALPHA,
    impactSummary: 'Writes one note.',
    dataAffected: ['note'],
    estimatedAdditionalTokens: 10,
    estimatedAdditionalCostMicroUsd: 5,
  });
  return { gate, clock, request };
}

// ── The cases ───────────────────────────────────────────────────────────────

export const AGENT_PERSISTENCE_CASES: readonly AgentPersistenceCase[] = [
  // ── Runs ──────────────────────────────────────────────────────────────────
  {
    name: 'runs: round-trips a whole record',
    async run(h) {
      const record = makeAgentRun({ workflowId: 'wf.review', parentRunId: 'run_parent' });
      await h.runs.create(record);
      const loaded = await h.runs.load(AGENT_ALPHA, 'run_contract1');
      assert.ok(loaded);
      assert.deepEqual(withoutStorage(loaded), record);
    },
  },
  {
    name: 'runs: an unknown run is absent, not an error',
    async run(h) {
      assert.equal(await h.runs.load(AGENT_ALPHA, 'run_never'), undefined);
    },
  },
  {
    name: 'runs: a duplicate id is refused and the original is untouched',
    async run(h) {
      await h.runs.create(makeAgentRun());
      await assert.rejects(() => h.runs.create(makeAgentRun({ state: 'running' })), failsWith('persistence_failed'));
      assert.equal((await h.runs.load(AGENT_ALPHA, 'run_contract1'))?.state, 'created');
    },
  },
  {
    name: 'runs: the same id in two tenants is two runs',
    async run(h) {
      await h.runs.create(makeAgentRun());
      await h.runs.create(makeAgentRun({ organizationId: AGENT_BETA, state: 'running' }));
      assert.equal((await h.runs.load(AGENT_ALPHA, 'run_contract1'))?.state, 'created');
      assert.equal((await h.runs.load(AGENT_BETA, 'run_contract1'))?.state, 'running');
    },
  },
  {
    name: 'runs: a write at the version read is accepted',
    async run(h) {
      await h.runs.create(makeAgentRun());
      await h.runs.save(makeAgentRun({ runVersion: 2, state: 'validating', checkpointVersion: 1 }), 1);
      const loaded = await h.runs.load(AGENT_ALPHA, 'run_contract1');
      assert.equal(loaded?.runVersion, 2);
      assert.equal(loaded?.state, 'validating');
      assert.equal(loaded?.checkpointVersion, 1);
    },
  },
  {
    name: 'runs: a stale write is refused and changes nothing',
    async run(h) {
      await h.runs.create(makeAgentRun());
      await h.runs.save(makeAgentRun({ runVersion: 2, state: 'validating' }), 1);
      await assert.rejects(
        () => h.runs.save(makeAgentRun({ runVersion: 2, state: 'cancelled' }), 1),
        failsWith('stale_run_version'),
      );
      assert.equal((await h.runs.load(AGENT_ALPHA, 'run_contract1'))?.state, 'validating');
    },
  },
  {
    name: 'runs: exactly one of two concurrent writers wins',
    async run(h) {
      await h.runs.create(makeAgentRun());
      const results = await Promise.allSettled([
        h.runs.save(makeAgentRun({ runVersion: 2, state: 'validating' }), 1),
        h.runs.save(makeAgentRun({ runVersion: 2, state: 'cancelled' }), 1),
      ]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      failsWith('stale_run_version')(loser.reason);
    },
  },
  {
    name: 'runs: a save of a run that is not stored fails with the declared code',
    async run(h) {
      await assert.rejects(
        () => h.runs.save(makeAgentRun({ runId: 'run_absent', runVersion: 2 }), 1),
        failsWith(h.missingSaveFailure),
      );
      assert.equal(await h.runs.load(AGENT_ALPHA, 'run_absent'), undefined, 'nothing was created');
    },
  },
  {
    name: 'runs: another tenant cannot load, list or save a run',
    async run(h) {
      await h.runs.create(makeAgentRun());
      assert.equal(await h.runs.load(AGENT_BETA, 'run_contract1'), undefined);
      assert.deepEqual(await h.runs.list({ organizationId: AGENT_BETA }), []);
      await assert.rejects(
        () => h.runs.save(makeAgentRun({ organizationId: AGENT_BETA, runVersion: 2, state: 'completed' }), 1),
        (error: unknown) => isAgentRuntimeError(error),
      );
      assert.equal((await h.runs.load(AGENT_ALPHA, 'run_contract1'))?.state, 'created');
    },
  },
  {
    name: 'runs: listing is newest first, ties broken by run id descending',
    async run(h) {
      await h.runs.create(makeAgentRun({ runId: 'run_a', createdAt: '2026-09-22T10:00:00.000Z' }));
      await h.runs.create(makeAgentRun({ runId: 'run_c', createdAt: '2026-09-22T10:00:00.000Z' }));
      await h.runs.create(makeAgentRun({ runId: 'run_b', createdAt: '2026-09-22T10:00:00.000Z' }));
      await h.runs.create(makeAgentRun({ runId: 'run_new', createdAt: '2026-09-22T11:00:00.000Z' }));
      const all = await h.runs.list({ organizationId: AGENT_ALPHA });
      assert.deepEqual(all.map((r) => r.context.runId), ['run_new', 'run_c', 'run_b', 'run_a']);
    },
  },
  {
    name: 'runs: a limit that cuts through a tie cuts where the domain sort says',
    async run(h) {
      for (const id of ['run_a', 'run_b', 'run_c']) {
        await h.runs.create(makeAgentRun({ runId: id, createdAt: '2026-09-22T10:00:00.000Z' }));
      }
      const two = await h.runs.list({ organizationId: AGENT_ALPHA, limit: 2 });
      assert.deepEqual(two.map((r) => r.context.runId), ['run_c', 'run_b']);
    },
  },
  {
    name: 'runs: every filter narrows and none widens',
    async run(h) {
      await h.runs.create(makeAgentRun({ runId: 'run_1', state: 'completed', agentId: 'agent.x', actorId: 'user_1' }));
      await h.runs.create(makeAgentRun({ runId: 'run_2', state: 'running', agentId: 'agent.x', actorId: 'user_2' }));
      await h.runs.create(makeAgentRun({ runId: 'run_3', state: 'running', agentId: 'agent.y', actorId: 'user_1' }));
      const ids = async (q: Parameters<AgentRunStore['list']>[0]) =>
        (await h.runs.list(q)).map((r) => r.context.runId).sort();
      assert.deepEqual(await ids({ organizationId: AGENT_ALPHA, states: ['running'] }), ['run_2', 'run_3']);
      assert.deepEqual(await ids({ organizationId: AGENT_ALPHA, agentId: 'agent.x' }), ['run_1', 'run_2']);
      assert.deepEqual(await ids({ organizationId: AGENT_ALPHA, actorId: 'user_1' }), ['run_1', 'run_3']);
      assert.deepEqual(
        await ids({ organizationId: AGENT_ALPHA, states: ['running'], agentId: 'agent.x', actorId: 'user_2' }),
        ['run_2'],
      );
      // AN EMPTY STATE LIST MATCHES NOTHING in the production authority —
      // `matchesRunQuery` tests `query.states &&`, and `[]` is truthy. The SQL
      // function would return everything for it, and the domain predicate
      // applied afterwards is what keeps the SQL store saying what production
      // says. Pinned, so neither layer can drift alone.
      assert.deepEqual(await ids({ organizationId: AGENT_ALPHA, states: [] }), []);
    },
  },
  {
    name: 'runs: listing is bounded at the ports\' ceiling',
    async run(h) {
      for (let i = 0; i < 5; i += 1) {
        await h.runs.create(makeAgentRun({ runId: `run_${i}`, createdAt: `2026-09-22T10:0${i}:00.000Z` }));
      }
      assert.equal((await h.runs.list({ organizationId: AGENT_ALPHA, limit: 2 })).length, 2);
      assert.equal((await h.runs.list({ organizationId: AGENT_ALPHA, limit: 0 })).length, 1);
      assert.equal((await h.runs.list({ organizationId: AGENT_ALPHA, limit: 10_000 })).length, 5);
    },
  },

  // ── Checkpoints ───────────────────────────────────────────────────────────
  {
    name: 'checkpoints: append, read and round-trip a whole checkpoint',
    async run(h) {
      await h.seedRun(makeAgentRun());
      const first = makeAgentCheckpoint(1);
      const second = makeAgentCheckpoint(2, { output: { finding: 'done' } });
      await h.checkpoints.write(first);
      await h.checkpoints.write(second);
      assert.deepEqual(withoutStorage((await h.checkpoints.read(AGENT_ALPHA, 'run_contract1', 1))!), first);
      assert.deepEqual(withoutStorage((await h.checkpoints.read(AGENT_ALPHA, 'run_contract1', 2))!), second);
      assert.equal(await h.checkpoints.read(AGENT_ALPHA, 'run_contract1', 3), undefined);
    },
  },
  {
    name: 'checkpoints: a written version is never rewritten',
    async run(h) {
      await h.seedRun(makeAgentRun());
      await h.checkpoints.write(makeAgentCheckpoint(1));
      await assert.rejects(
        () => h.checkpoints.write(makeAgentCheckpoint(1, { progress: { tampered: true }, progressDigest: 'other' })),
        failsWith('checkpoint_conflict'),
      );
      assert.deepEqual((await h.checkpoints.read(AGENT_ALPHA, 'run_contract1', 1))?.progress, makeAgentCheckpoint(1).progress);
    },
  },
  {
    name: 'checkpoints: exactly one of two concurrent writers of one version lands',
    async run(h) {
      await h.seedRun(makeAgentRun());
      const results = await Promise.allSettled([
        h.checkpoints.write(makeAgentCheckpoint(1, { progressDigest: 'a' })),
        h.checkpoints.write(makeAgentCheckpoint(1, { progressDigest: 'b' })),
      ]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal((await h.checkpoints.history(AGENT_ALPHA, 'run_contract1')).length, 1);
    },
  },
  {
    name: 'checkpoints: history is numeric past ten versions and latest is the highest',
    async run(h) {
      await h.seedRun(makeAgentRun());
      for (let version = 1; version <= 12; version += 1) {
        await h.checkpoints.write(makeAgentCheckpoint(version));
      }
      assert.deepEqual(
        (await h.checkpoints.history(AGENT_ALPHA, 'run_contract1')).map((c) => c.version),
        Array.from({ length: 12 }, (_, i) => i + 1),
      );
      assert.equal((await h.checkpoints.latest(AGENT_ALPHA, 'run_contract1'))?.version, 12);
    },
  },
  {
    name: 'checkpoints: latest is the chain tip even when it is ahead of the run pointer',
    async run(h) {
      // The checkpoint-before-pointer crash window: the run still says 1, the
      // store holds 2. `writeCheckpoint` chains from whatever latest() says.
      await h.seedRun(makeAgentRun({ checkpointVersion: 1 }));
      await h.checkpoints.write(makeAgentCheckpoint(1));
      await h.checkpoints.write(makeAgentCheckpoint(2));
      assert.equal((await h.runs.load(AGENT_ALPHA, 'run_contract1'))?.checkpointVersion, 1);
      assert.equal((await h.checkpoints.latest(AGENT_ALPHA, 'run_contract1'))?.version, 2);
    },
  },
  {
    name: 'checkpoints: a link may chain from a non-adjacent predecessor, as the runtime can write',
    async run(h) {
      await h.seedRun(makeAgentRun());
      await h.checkpoints.write(makeAgentCheckpoint(1));
      await h.checkpoints.write(makeAgentCheckpoint(3, { previousDigest: 'pdigest_1' }));
      await h.checkpoints.write(makeAgentCheckpoint(2, { previousDigest: 'pdigest_3' }));
      assert.deepEqual(
        (await h.checkpoints.history(AGENT_ALPHA, 'run_contract1')).map((c) => [c.version, c.previousDigest]),
        [[1, undefined], [2, 'pdigest_3'], [3, 'pdigest_1']],
      );
    },
  },
  {
    name: 'checkpoints: runs do not share a chain',
    async run(h) {
      await h.seedRun(makeAgentRun({ runId: 'run_one' }));
      await h.seedRun(makeAgentRun({ runId: 'run_two' }));
      await h.checkpoints.write(makeAgentCheckpoint(1, { runId: 'run_one' }));
      await h.checkpoints.write(makeAgentCheckpoint(1, { runId: 'run_two', progressDigest: 'other' }));
      assert.equal((await h.checkpoints.history(AGENT_ALPHA, 'run_one')).length, 1);
      assert.equal((await h.checkpoints.latest(AGENT_ALPHA, 'run_two'))?.progressDigest, 'other');
      assert.deepEqual(await h.checkpoints.history(AGENT_ALPHA, 'run_none'), []);
      assert.equal(await h.checkpoints.latest(AGENT_ALPHA, 'run_none'), undefined);
    },
  },
  {
    name: 'checkpoints: another tenant reads nothing',
    async run(h) {
      await h.seedRun(makeAgentRun());
      await h.checkpoints.write(makeAgentCheckpoint(1));
      assert.equal(await h.checkpoints.latest(AGENT_BETA, 'run_contract1'), undefined);
      assert.equal(await h.checkpoints.read(AGENT_BETA, 'run_contract1', 1), undefined);
      assert.deepEqual(await h.checkpoints.history(AGENT_BETA, 'run_contract1'), []);
    },
  },

  // ── Approvals: the store ──────────────────────────────────────────────────
  {
    name: 'approvals: round-trips a whole request and versions a decision',
    async run(h) {
      await h.seedRun(makeAgentRun());
      const request = makeAgentApproval();
      await h.approvals.create(request);
      assert.deepEqual(withoutStorage((await h.approvals.load(AGENT_ALPHA, 'apr_contract1'))!), request);
      const decided = makeAgentApproval({
        state: 'approved', approvalVersion: 2, decidedAt: '2026-09-22T10:05:00.000Z',
        decidedBy: 'user_owner', decisionReason: 'Looks right.',
      });
      await h.approvals.save(decided, 1);
      assert.deepEqual(withoutStorage((await h.approvals.load(AGENT_ALPHA, 'apr_contract1'))!), decided);
    },
  },
  {
    name: 'approvals: a duplicate id is refused',
    async run(h) {
      await h.seedRun(makeAgentRun());
      await h.approvals.create(makeAgentApproval());
      await assert.rejects(() => h.approvals.create(makeAgentApproval()), failsWith('persistence_failed'));
    },
  },
  {
    name: 'approvals: two approvers cannot both win',
    async run(h) {
      await h.seedRun(makeAgentRun());
      await h.approvals.create(makeAgentApproval());
      const results = await Promise.allSettled([
        h.approvals.save(makeAgentApproval({ state: 'approved', approvalVersion: 2, decidedAt: '2026-09-22T10:05:00.000Z' }), 1),
        h.approvals.save(makeAgentApproval({ state: 'rejected', approvalVersion: 2, decidedAt: '2026-09-22T10:05:00.000Z' }), 1),
      ]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      failsWith('stale_run_version')((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason);
    },
  },
  {
    name: 'approvals: a save of an approval that is not stored fails with the declared code',
    async run(h) {
      await h.seedRun(makeAgentRun());
      await assert.rejects(
        () => h.approvals.save(makeAgentApproval({ approvalId: 'apr_absent', state: 'approved', approvalVersion: 2, decidedAt: '2026-09-22T10:05:00.000Z' }), 1),
        failsWith(h.missingApprovalSaveFailure),
      );
    },
  },
  {
    name: 'approvals: listing narrows by run and pending, newest first',
    async run(h) {
      await h.seedRun(makeAgentRun({ runId: 'run_one' }));
      await h.seedRun(makeAgentRun({ runId: 'run_two' }));
      await h.approvals.create(makeAgentApproval({ approvalId: 'apr_old', runId: 'run_one', createdAt: '2026-09-22T10:00:00.000Z' }));
      await h.approvals.create(makeAgentApproval({ approvalId: 'apr_new', runId: 'run_one', createdAt: '2026-09-22T10:10:00.000Z' }));
      await h.approvals.create(makeAgentApproval({
        approvalId: 'apr_done', runId: 'run_two', createdAt: '2026-09-22T10:05:00.000Z',
        state: 'approved', decidedAt: '2026-09-22T10:06:00.000Z',
      }));
      const ids = async (q: Parameters<AgentApprovalStore['list']>[0]) => (await h.approvals.list(q)).map((a) => a.approvalId);
      assert.deepEqual(await ids({ organizationId: AGENT_ALPHA }), ['apr_new', 'apr_done', 'apr_old']);
      assert.deepEqual(await ids({ organizationId: AGENT_ALPHA, pendingOnly: true }), ['apr_new', 'apr_old']);
      assert.deepEqual(await ids({ organizationId: AGENT_ALPHA, runId: 'run_two' }), ['apr_done']);
      assert.deepEqual(await ids({ organizationId: AGENT_ALPHA, limit: 1 }), ['apr_new']);
    },
  },
  {
    name: 'approvals: another tenant cannot load, list or decide a request',
    async run(h) {
      await h.seedRun(makeAgentRun());
      await h.approvals.create(makeAgentApproval());
      assert.equal(await h.approvals.load(AGENT_BETA, 'apr_contract1'), undefined);
      assert.deepEqual(await h.approvals.list({ organizationId: AGENT_BETA }), []);
      await assert.rejects(
        () => h.approvals.save(makeAgentApproval({ organizationId: AGENT_BETA, state: 'approved', approvalVersion: 2, decidedAt: '2026-09-22T10:05:00.000Z' }), 1),
        (error: unknown) => isAgentRuntimeError(error),
      );
      assert.equal((await h.approvals.load(AGENT_ALPHA, 'apr_contract1'))?.state, 'pending');
    },
  },

  // ── Approvals: the real gate over each store ─────────────────────────────
  {
    name: 'gate: request → approve → consume, persisted at every step',
    async run(h) {
      const { gate, request } = await requestThroughGate(h);
      assert.equal((await h.approvals.load(AGENT_ALPHA, request.approvalId))?.state, 'pending');
      await gate.decide({
        organizationId: AGENT_ALPHA, approvalId: request.approvalId, decision: 'approve',
        reason: 'Approved in the contract suite.', deciderId: 'user_owner', deciderRoles: ['owner'],
      });
      const consumed = await gate.consume(AGENT_ALPHA, request.approvalId, 'act_gate');
      const stored = await h.approvals.load(AGENT_ALPHA, request.approvalId);
      assert.equal(stored?.state, 'consumed');
      assert.equal(stored?.approvalVersion, 3);
      assert.equal(stored?.consumedAt, consumed.consumedAt);
      assert.equal(stored?.decidedBy, 'user_owner');
    },
  },
  {
    name: 'gate: an approval is spent once — a second consume is refused',
    async run(h) {
      const { gate, request } = await requestThroughGate(h);
      await gate.decide({
        organizationId: AGENT_ALPHA, approvalId: request.approvalId, decision: 'approve',
        reason: 'Approved in the contract suite.', deciderId: 'user_owner', deciderRoles: ['owner'],
      });
      await gate.consume(AGENT_ALPHA, request.approvalId, 'act_gate');
      await assert.rejects(() => gate.consume(AGENT_ALPHA, request.approvalId, 'act_gate'), failsWith('approval_required'));
      assert.equal((await h.approvals.load(AGENT_ALPHA, request.approvalId))?.approvalVersion, 3);
    },
  },
  {
    name: 'gate: a rejection persists and refuses the action',
    async run(h) {
      const { gate, request } = await requestThroughGate(h);
      await gate.decide({
        organizationId: AGENT_ALPHA, approvalId: request.approvalId, decision: 'reject',
        reason: 'Rejected in the contract suite.', deciderId: 'user_owner', deciderRoles: ['owner'],
      });
      await assert.rejects(() => gate.consume(AGENT_ALPHA, request.approvalId, 'act_gate'), failsWith('approval_rejected'));
      assert.equal((await h.approvals.load(AGENT_ALPHA, request.approvalId))?.state, 'rejected');
    },
  },
  {
    name: 'gate: an overdue pending request expires durably, with the stamp expire() writes',
    async run(h) {
      const { gate, clock, request } = await requestThroughGate(h);
      clock.advance(2 * 3_600_000);
      await gate.expireIfDue(request);
      const stored = await h.approvals.load(AGENT_ALPHA, request.approvalId);
      assert.equal(stored?.state, 'expired');
      assert.equal(stored?.approvalVersion, 2);
      assert.ok(stored?.decidedAt, 'the agent gate stamps expiry');
      assert.deepEqual(await h.approvals.list({ organizationId: AGENT_ALPHA, pendingOnly: true }), []);
    },
  },
  {
    name: 'gate: a decision after the window is refused and the expiry is persisted',
    async run(h) {
      const { gate, clock, request } = await requestThroughGate(h);
      clock.advance(2 * 3_600_000);
      await assert.rejects(
        () => gate.decide({
          organizationId: AGENT_ALPHA, approvalId: request.approvalId, decision: 'approve',
          reason: 'Too late in the contract suite.', deciderId: 'user_owner', deciderRoles: ['owner'],
        }),
        failsWith('approval_expired'),
      );
      assert.equal((await h.approvals.load(AGENT_ALPHA, request.approvalId))?.state, 'expired');
    },
  },
  {
    name: 'gate: a spent approval re-read after its window persists as the gate rewrites it',
    async run(h) {
      // The pre-existing gate behaviour the SQL lifecycle rule must admit: a
      // consumed request that is consumed again after expiry is rewritten to
      // `expired` and keeps its consumedAt. Parity, not endorsement.
      const { gate, clock, request } = await requestThroughGate(h);
      await gate.decide({
        organizationId: AGENT_ALPHA, approvalId: request.approvalId, decision: 'approve',
        reason: 'Approved in the contract suite.', deciderId: 'user_owner', deciderRoles: ['owner'],
      });
      await gate.consume(AGENT_ALPHA, request.approvalId, 'act_gate');
      clock.advance(2 * 3_600_000);
      await assert.rejects(() => gate.consume(AGENT_ALPHA, request.approvalId, 'act_gate'), failsWith('approval_expired'));
      const stored = await h.approvals.load(AGENT_ALPHA, request.approvalId);
      assert.equal(stored?.state, 'expired');
      assert.ok(stored?.consumedAt);
      assert.equal(stored?.approvalVersion, 4);
    },
  },
];
