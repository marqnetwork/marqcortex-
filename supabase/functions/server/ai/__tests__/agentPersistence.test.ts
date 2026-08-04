/**
 * Durable agent storage (AI-01 Batch 3A).
 *
 * The same assertions run against BOTH store implementations — the in-memory
 * one tests use and the key-value one production uses — because a port whose
 * two implementations disagree is a port that will be discovered to disagree in
 * production. The key-value cases run over a fake that implements exactly the
 * contract `kv_compare_and_swap_field` provides, including its JSON-string
 * encoding, so the adapter's double-decoding path is exercised rather than
 * assumed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_ID,
  AGENT_TOKEN,
  buildTestAgentRuntime,
  createFakeKv,
} from './agentFixtures.ts';
import type {
  AgentApprovalStore,
  AgentCheckpointStore,
  AgentRunStore,
} from '../agents/persistence/ports.ts';
import {
  createMemoryAgentRunStore,
  createMemoryApprovalStore,
  createMemoryCheckpointStore,
} from '../agents/persistence/ports.ts';
import {
  approvalKeyFor,
  checkpointKeyFor,
  createKvAgentApprovalStore,
  createKvAgentCheckpointStore,
  createKvAgentRunStore,
  runKeyFor,
} from '../agents/persistence/kvAgentStores.ts';
import { isAgentRuntimeError } from '../agents/contracts/failures.ts';
import type { AgentApprovalRequest, AgentCheckpoint, AgentRunRecord } from '../agents/contracts/runtime.ts';
import { emptyTokenLedger } from '../agents/runtime/tokenIntelligence.ts';
import { emptyCostLedger } from '../agents/runtime/costPolicy.ts';
import { initialLoopState } from '../agents/runtime/limits.ts';
import {
  createMemoryToolIdempotencyStore,
  createToolGateway,
  createToolRegistry,
} from '../agents/tools/toolRegistry.ts';
import { DETERMINISTIC_TOOLS, DETERMINISTIC_TOOL_IDS } from '../agents/tools/mockTools.ts';
import { createTestClock } from '../runtime/clock.ts';
import { primaryAgent } from './agentFixtures.ts';

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeRun(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    context: {
      runId: 'run_p1',
      correlationId: 'cor_p1',
      requestId: 'req_p1',
      organizationId: 'acme',
      actorId: 'user-consultant',
      actorRoles: ['consultant'],
      origin: { surface: 'team_console', feature: 'agent_runtime' },
      agentId: AGENT_ID.primary,
      agentVersion: '1.0.0',
    },
    runVersion: 1,
    state: 'created',
    currentAgentId: AGENT_ID.primary,
    currentAgentVersion: '1.0.0',
    currentStep: 0,
    stepCount: 0,
    stepsByAgent: {},
    handoffCount: 0,
    retryCount: 0,
    repeatedActionCount: 0,
    tokens: emptyTokenLedger(),
    cost: emptyCostLedger(),
    loop: initialLoopState(AGENT_ID.primary),
    checkpointVersion: 0,
    planDigest: 'digest',
    configurationVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deadlineAt: '2026-01-01T00:05:00.000Z',
    elapsedRuntimeMs: 0,
    transitions: [],
    transitionsTruncated: 0,
    steps: [],
    handoffs: [],
    ...overrides,
  };
}

function makeCheckpoint(version: number, overrides: Partial<AgentCheckpoint> = {}): AgentCheckpoint {
  return {
    runId: 'run_p1',
    organizationId: 'acme',
    version,
    createdAt: '2026-01-01T00:00:00.000Z',
    state: 'running',
    agentId: AGENT_ID.primary,
    stepCount: version,
    progress: { step: version },
    progressDigest: `digest-${version}`,
    ...overrides,
  };
}

function makeApproval(overrides: Partial<AgentApprovalRequest> = {}): AgentApprovalRequest {
  return {
    approvalId: 'apr_p1',
    runId: 'run_p1',
    actionId: 'act_p1',
    organizationId: 'acme',
    requestingAgentId: AGENT_ID.primary,
    actionType: 'tool_call',
    impactSummary: 'A bounded impact.',
    dataAffected: ['note'],
    estimatedAdditionalTokens: 0,
    estimatedAdditionalCostMicroUsd: 0,
    reason: 'Because the tool needs it.',
    authorizedApproverRoles: ['owner'],
    expiresAt: '2026-01-01T01:00:00.000Z',
    singleUse: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    state: 'pending',
    approvalVersion: 1,
    ...overrides,
  };
}

interface StoreSet {
  readonly runs: AgentRunStore;
  readonly checkpoints: AgentCheckpointStore;
  readonly approvals: AgentApprovalStore;
}

const IMPLEMENTATIONS: readonly [string, () => StoreSet][] = [
  [
    'in-memory',
    () => ({
      runs: createMemoryAgentRunStore(),
      checkpoints: createMemoryCheckpointStore(),
      approvals: createMemoryApprovalStore(),
    }),
  ],
  [
    'key-value',
    () => {
      const kv = createFakeKv();
      const options = {
        read: kv.read,
        readByPrefix: kv.readByPrefix,
        compareAndSwap: kv.compareAndSwap,
      };
      return {
        runs: createKvAgentRunStore(options),
        checkpoints: createKvAgentCheckpointStore(options),
        approvals: createKvAgentApprovalStore(options),
      };
    },
  ],
];

for (const [label, build] of IMPLEMENTATIONS) {
  describe(`agent run store — ${label}`, () => {
    it('round-trips a record', async () => {
      const { runs } = build();
      const record = makeRun();
      await runs.create(record);
      const loaded = await runs.load('acme', 'run_p1');
      assert.equal(loaded?.context.runId, 'run_p1');
      assert.equal(loaded?.runVersion, 1);
      assert.equal(loaded?.state, 'created');
    });

    it('refuses a duplicate run id rather than overwriting', async () => {
      const { runs } = build();
      await runs.create(makeRun());
      await assert.rejects(
        () => runs.create(makeRun({ state: 'running' })),
        (error: unknown) => isAgentRuntimeError(error) && error.failure === 'persistence_failed',
      );
      const loaded = await runs.load('acme', 'run_p1');
      assert.equal(loaded?.state, 'created', 'the original record is untouched');
    });

    it('accepts a write at the version it read', async () => {
      const { runs } = build();
      await runs.create(makeRun());
      await runs.save(makeRun({ runVersion: 2, state: 'validating' }), 1);
      const loaded = await runs.load('acme', 'run_p1');
      assert.equal(loaded?.runVersion, 2);
      assert.equal(loaded?.state, 'validating');
    });

    it('refuses a stale write and changes nothing', async () => {
      const { runs } = build();
      await runs.create(makeRun());
      await runs.save(makeRun({ runVersion: 2, state: 'validating' }), 1);

      await assert.rejects(
        () => runs.save(makeRun({ runVersion: 2, state: 'cancelled' }), 1),
        (error: unknown) => isAgentRuntimeError(error) && error.failure === 'stale_run_version',
      );
      const loaded = await runs.load('acme', 'run_p1');
      assert.equal(loaded?.state, 'validating', 'the losing write did not land');
    });

    it('lets exactly one of two concurrent writers win', async () => {
      const { runs } = build();
      await runs.create(makeRun());

      const results = await Promise.allSettled([
        runs.save(makeRun({ runVersion: 2, state: 'validating' }), 1),
        runs.save(makeRun({ runVersion: 2, state: 'cancelled' }), 1),
      ]);
      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      assert.equal(fulfilled.length, 1, 'exactly one writer may take a version');
    });

    it('never returns another organization’s record', async () => {
      const { runs } = build();
      await runs.create(makeRun());
      assert.equal(await runs.load('globex', 'run_p1'), undefined);
      assert.deepEqual(await runs.list({ organizationId: 'globex' }), []);
    });

    it('lists newest first, filtered and bounded', async () => {
      const { runs } = build();
      await runs.create(makeRun({ createdAt: '2026-01-01T00:00:00.000Z' }));
      await runs.create(
        makeRun({
          context: { ...makeRun().context, runId: 'run_p2' },
          createdAt: '2026-01-02T00:00:00.000Z',
          state: 'completed',
        }),
      );

      const all = await runs.list({ organizationId: 'acme' });
      assert.deepEqual(all.map((record) => record.context.runId), ['run_p2', 'run_p1']);

      const completed = await runs.list({ organizationId: 'acme', states: ['completed'] });
      assert.deepEqual(completed.map((record) => record.context.runId), ['run_p2']);

      const bounded = await runs.list({ organizationId: 'acme', limit: 1 });
      assert.equal(bounded.length, 1);
    });
  });

  describe(`agent checkpoint store — ${label}`, () => {
    it('appends versions and reads the latest', async () => {
      const { checkpoints } = build();
      await checkpoints.write(makeCheckpoint(1));
      await checkpoints.write(makeCheckpoint(2));
      const latest = await checkpoints.latest('acme', 'run_p1');
      assert.equal(latest?.version, 2);
    });

    it('refuses to rewrite a version', async () => {
      const { checkpoints } = build();
      await checkpoints.write(makeCheckpoint(1));
      await assert.rejects(
        () => checkpoints.write(makeCheckpoint(1, { progress: { tampered: true } })),
        (error: unknown) => isAgentRuntimeError(error) && error.failure === 'checkpoint_conflict',
      );
      const stored = await checkpoints.read('acme', 'run_p1', 1);
      assert.deepEqual(stored?.progress, { step: 1 });
    });

    it('orders history numerically past ten versions', async () => {
      const { checkpoints } = build();
      for (let version = 1; version <= 12; version += 1) {
        await checkpoints.write(makeCheckpoint(version));
      }
      const history = await checkpoints.history('acme', 'run_p1');
      assert.deepEqual(
        history.map((checkpoint) => checkpoint.version),
        Array.from({ length: 12 }, (_, index) => index + 1),
      );
      assert.equal((await checkpoints.latest('acme', 'run_p1'))?.version, 12);
    });

    it('never returns another organization’s checkpoint', async () => {
      const { checkpoints } = build();
      await checkpoints.write(makeCheckpoint(1));
      assert.equal(await checkpoints.latest('globex', 'run_p1'), undefined);
      assert.deepEqual(await checkpoints.history('globex', 'run_p1'), []);
    });
  });

  describe(`agent approval store — ${label}`, () => {
    it('round-trips and versions a decision', async () => {
      const { approvals } = build();
      await approvals.create(makeApproval());
      await approvals.save(makeApproval({ state: 'approved', approvalVersion: 2 }), 1);
      const loaded = await approvals.load('acme', 'apr_p1');
      assert.equal(loaded?.state, 'approved');
      assert.equal(loaded?.approvalVersion, 2);
    });

    it('refuses a stale decision — two approvers cannot both win', async () => {
      const { approvals } = build();
      await approvals.create(makeApproval());
      await approvals.save(makeApproval({ state: 'approved', approvalVersion: 2 }), 1);
      await assert.rejects(
        () => approvals.save(makeApproval({ state: 'rejected', approvalVersion: 2 }), 1),
        (error: unknown) => isAgentRuntimeError(error) && error.failure === 'stale_run_version',
      );
      assert.equal((await approvals.load('acme', 'apr_p1'))?.state, 'approved');
    });

    it('lists only pending requests for the right organization', async () => {
      const { approvals } = build();
      await approvals.create(makeApproval());
      await approvals.create(
        makeApproval({ approvalId: 'apr_p2', state: 'approved' }),
      );
      const pending = await approvals.list({ organizationId: 'acme', pendingOnly: true });
      assert.deepEqual(pending.map((request) => request.approvalId), ['apr_p1']);
      assert.deepEqual(await approvals.list({ organizationId: 'globex' }), []);
    });
  });
}

describe('key-value agent storage — keys and corruption', () => {
  it('builds tenant-scoped keys that cannot span organizations', () => {
    assert.equal(runKeyFor('acme', 'run_1'), 'org:acme:ai:agent_run:run_1');
    assert.equal(
      checkpointKeyFor('acme', 'run_1', 7),
      'org:acme:ai:agent_checkpoint:run_1:000007',
    );
    assert.equal(approvalKeyFor('acme', 'apr_1'), 'org:acme:ai:agent_approval:apr_1');
    assert.notEqual(runKeyFor('acme', 'run_1'), runKeyFor('globex', 'run_1'));
  });

  it('refuses a malformed organization identifier rather than embedding it', () => {
    assert.throws(() => runKeyFor('acme:../globex', 'run_1'), /unsupported format/);
  });

  it('zero-pads checkpoint versions so a prefix scan is numerically ordered', () => {
    const keys = [1, 2, 10, 11].map((version) => checkpointKeyFor('acme', 'run_1', version));
    assert.deepEqual([...keys].sort(), keys, 'lexicographic order matches numeric order');
  });

  it('treats an unreadable record as absent and reports it, rather than throwing', async () => {
    const kv = createFakeKv();
    const seen: string[] = [];
    const runs = createKvAgentRunStore({
      read: kv.read,
      readByPrefix: kv.readByPrefix,
      compareAndSwap: kv.compareAndSwap,
      onCorrupt: (_key, detail) => seen.push(detail),
    });
    kv.poke(runKeyFor('acme', 'run_bad'), 'not json at all {{{');

    assert.equal(await runs.load('acme', 'run_bad'), undefined);
    assert.equal(seen.length, 1);
    assert.match(seen[0], /not a readable object/);
  });

  it('refuses a record whose stored organization disagrees with its key', async () => {
    const kv = createFakeKv();
    const seen: string[] = [];
    const runs = createKvAgentRunStore({
      read: kv.read,
      readByPrefix: kv.readByPrefix,
      compareAndSwap: kv.compareAndSwap,
      onCorrupt: (_key, detail) => seen.push(detail),
    });
    const record = makeRun();
    kv.poke(runKeyFor('acme', 'run_p1'), {
      ...record,
      context: { ...record.context, organizationId: 'globex' },
    });

    assert.equal(await runs.load('acme', 'run_p1'), undefined);
    assert.match(seen[0] ?? '', /does not match the key/);
  });

  it('stores values the way the platform helper writes them', async () => {
    const kv = createFakeKv();
    const runs = createKvAgentRunStore({
      read: kv.read,
      readByPrefix: kv.readByPrefix,
      compareAndSwap: kv.compareAndSwap,
    });
    await runs.create(makeRun());
    const raw = await kv.read(runKeyFor('acme', 'run_p1'));
    assert.equal(typeof raw, 'string', 'production stores JSON strings, and the adapter decodes them');
  });
});

describe('a run driven end to end over durable storage', () => {
  it('completes, and every step survives into the durable record', async () => {
    const kv = createFakeKv();
    const options = {
      read: kv.read,
      readByPrefix: kv.readByPrefix,
      compareAndSwap: kv.compareAndSwap,
    };
    const runStore = createKvAgentRunStore(options);
    const checkpointStore = createKvAgentCheckpointStore(options);

    const harness = buildTestAgentRuntime({ runStore, checkpointStore });
    const meta = harness.meta(AGENT_TOKEN.consultant);
    const actor = await harness.runtime.service.authorize(meta);
    const run = await harness.runtime.service.createRun(
      actor,
      {
        agentId: AGENT_ID.primary,
        objective: 'Run entirely over durable storage.',
        input: { topic: 'Durability', script: 'model_then_complete' },
      },
      meta,
    );
    assert.equal(run.state, 'completed');

    // A fresh runtime over the same keys — nothing in memory carries over.
    const restarted = buildTestAgentRuntime({
      runStore: createKvAgentRunStore(options),
      checkpointStore: createKvAgentCheckpointStore(options),
    });
    const reader = await restarted.runtime.service.authorize(
      restarted.meta(AGENT_TOKEN.consultant),
    );
    const recovered = await restarted.runtime.service.getRun(reader, run.runId);
    assert.equal(recovered.state, 'completed');
    assert.equal(recovered.stepCount, 2);

    const steps = await restarted.runtime.service.getRunSteps(reader, run.runId);
    assert.equal(steps.length, 2);
    assert.ok(steps[0].executionRequestId);

    const history = await restarted.runtime.checkpoints.history('acme', run.runId);
    assert.ok(history.length >= 3);
  });
});

describe('tool gateway — permission, validation, idempotency and timeout', () => {
  function gateway() {
    const registry = createToolRegistry();
    registry.registerAll(DETERMINISTIC_TOOLS);
    return createToolGateway({
      registry,
      idempotency: createMemoryToolIdempotencyStore(),
      clock: createTestClock(),
      requireCertification: () => false,
    });
  }

  const request = {
    agent: primaryAgent,
    runId: 'run_t1',
    organizationId: 'acme',
    actorId: 'user-consultant',
    actorCapabilities: ['agent.run.create'],
    correlationId: 'cor_t1',
    timeoutMs: 2_000,
  };

  it('executes a permitted tool and validates its output', async () => {
    const result = await gateway().execute({
      ...request,
      toolId: DETERMINISTIC_TOOL_IDS.summarize,
      idempotencyKey: 'k1',
      input: { statements: ['one', 'two'] },
    });
    assert.equal(result.toolId, DETERMINISTIC_TOOL_IDS.summarize);
    assert.equal((result.output as { count: number }).count, 2);
    assert.ok(result.outputDigest.length > 0);
    assert.equal(result.replayed, false);
  });

  it('refuses a tool the agent did not declare', async () => {
    await assert.rejects(
      () =>
        gateway().execute({
          ...request,
          toolId: DETERMINISTIC_TOOL_IDS.lookup,
          idempotencyKey: 'k2',
          input: { recordKey: 'readiness' },
        }),
      (error: unknown) => isAgentRuntimeError(error) && error.failure === 'tool_denied',
    );
  });

  it('refuses an actor who may not run tools, even when the agent may', async () => {
    await assert.rejects(
      () =>
        gateway().execute({
          ...request,
          actorCapabilities: ['agent.run.read'],
          toolId: DETERMINISTIC_TOOL_IDS.summarize,
          idempotencyKey: 'k3',
          input: { statements: ['one'] },
        }),
      (error: unknown) => isAgentRuntimeError(error) && error.failure === 'unauthorized',
    );
  });

  it('refuses input that does not match the declared schema', async () => {
    await assert.rejects(
      () =>
        gateway().execute({
          ...request,
          toolId: DETERMINISTIC_TOOL_IDS.summarize,
          idempotencyKey: 'k4',
          input: { statements: 'not an array' },
        }),
      (error: unknown) => isAgentRuntimeError(error) && error.failure === 'invalid_action',
    );
  });

  it('replays an idempotent tool and refuses a repeated non-idempotent one', async () => {
    const tools = gateway();
    const first = await tools.execute({
      ...request,
      toolId: DETERMINISTIC_TOOL_IDS.summarize,
      idempotencyKey: 'same',
      input: { statements: ['one'] },
    });
    const second = await tools.execute({
      ...request,
      toolId: DETERMINISTIC_TOOL_IDS.summarize,
      idempotencyKey: 'same',
      input: { statements: ['one'] },
    });
    assert.equal(second.replayed, true);
    assert.equal(second.outputDigest, first.outputDigest);

    await tools.execute({
      ...request,
      toolId: DETERMINISTIC_TOOL_IDS.recordNote,
      idempotencyKey: 'note',
      approvalId: 'apr_ok',
      input: { subject: 'A', body: 'B', visibility: 'internal' },
    });
    await assert.rejects(
      () =>
        tools.execute({
          ...request,
          toolId: DETERMINISTIC_TOOL_IDS.recordNote,
          idempotencyKey: 'note',
          approvalId: 'apr_ok',
          input: { subject: 'A', body: 'B', visibility: 'internal' },
        }),
      (error: unknown) => isAgentRuntimeError(error) && error.failure === 'invalid_action',
    );
  });

  it('refuses an approval-gated tool with no approval', async () => {
    await assert.rejects(
      () =>
        gateway().execute({
          ...request,
          toolId: DETERMINISTIC_TOOL_IDS.recordNote,
          idempotencyKey: 'k5',
          input: { subject: 'A', body: 'B', visibility: 'internal' },
        }),
      (error: unknown) => isAgentRuntimeError(error) && error.failure === 'approval_required',
    );
  });

  it('scopes a tenant tool to the run’s organization, not to its input', async () => {
    const registry = createToolRegistry();
    registry.registerAll(DETERMINISTIC_TOOLS);
    const tools = createToolGateway({
      registry,
      idempotency: createMemoryToolIdempotencyStore(),
      clock: createTestClock(),
      requireCertification: () => false,
    });
    const agent = { ...primaryAgent, allowedTools: [DETERMINISTIC_TOOL_IDS.lookup] };

    const acme = await tools.execute({
      ...request,
      agent,
      toolId: DETERMINISTIC_TOOL_IDS.lookup,
      idempotencyKey: 'acme',
      input: { recordKey: 'readiness' },
    });
    const globex = await tools.execute({
      ...request,
      agent,
      organizationId: 'globex',
      toolId: DETERMINISTIC_TOOL_IDS.lookup,
      idempotencyKey: 'globex',
      input: { recordKey: 'readiness' },
    });

    assert.equal((acme.output as { value?: string }).value, 'stage-3');
    assert.equal((globex.output as { value?: string }).value, 'stage-1');
  });

  it('refuses a tool definition whose declarations contradict each other', () => {
    const registry = createToolRegistry();

    /** The reason is server-side detail; the caller-safe message names nothing. */
    const diagnosticsOf = (work: () => void): string => {
      try {
        work();
      } catch (error) {
        return String((error as { diagnostics?: string }).diagnostics ?? error);
      }
      assert.fail('expected the registration to be refused');
    };

    assert.match(
      diagnosticsOf(() =>
        registry.register({
          ...DETERMINISTIC_TOOLS[0],
          toolId: 'tool.bad.external',
          sideEffect: 'external_write',
          idempotency: 'idempotent',
        }),
      ),
      /cannot be declared idempotent/,
    );
    assert.match(
      diagnosticsOf(() =>
        registry.register({
          ...DETERMINISTIC_TOOLS[0],
          toolId: 'tool.bad.risky',
          risk: 'high',
          requiresApproval: false,
        }),
      ),
      /high-risk tool must require approval/,
    );
  });
});
