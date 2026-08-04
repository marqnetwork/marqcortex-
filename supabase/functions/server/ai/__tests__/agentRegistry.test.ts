/**
 * Agent Registry and state machine (AI-01 Batch 3A).
 *
 * Two subjects, one file, because they answer the same question from two
 * directions: what is an agent allowed to be, and what is a run allowed to do?
 * Both fail closed, and both are asserted here against the production
 * implementations rather than against a copy of their tables.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createAgentRegistry, validateDefinition } from '../agents/registry/agentRegistry.ts';
import {
  AGENT_RUN_STATES,
  TERMINAL_RUN_STATES,
  isTerminalState,
} from '../agents/contracts/runtime.ts';
import {
  ACTIVE_STATES,
  OPERATION_TARGETS,
  TRANSITIONS,
  assertTransition,
  canTransition,
} from '../agents/runtime/stateMachine.ts';
import { isAgentRuntimeError } from '../agents/contracts/failures.ts';
import type { AgentDefinition } from '../agents/contracts/agent.ts';
import {
  AGENT_ID,
  FIXTURE_AGENTS,
  disabledAgent,
  fixtureContracts,
  primaryAgent,
  reviewerAgent,
  uncertifiedAgent,
} from './agentFixtures.ts';

const openRegistry = () => createAgentRegistry({ requireCertification: () => false });
const strictRegistry = () => createAgentRegistry({ requireCertification: () => true });

function variant(overrides: Partial<AgentDefinition>): AgentDefinition {
  return { ...primaryAgent, ...overrides } as AgentDefinition;
}

describe('agent registry — registration', () => {
  it('registers a valid definition set and validates the handoff graph', () => {
    const registry = openRegistry();
    registry.registerAll(FIXTURE_AGENTS);
    assert.equal(registry.size(), FIXTURE_AGENTS.length);
    assert.deepEqual(registry.validate(), []);
  });

  it('refuses a duplicate registration', () => {
    const registry = openRegistry();
    registry.registerAll([primaryAgent, reviewerAgent]);
    assert.throws(() => registry.register(primaryAgent), /already registered/i);
  });

  it('resolves a disabled agent as disabled, not as missing', () => {
    const registry = openRegistry();
    registry.registerAll(FIXTURE_AGENTS);
    try {
      registry.require(AGENT_ID.disabled);
      assert.fail('a disabled agent must not resolve');
    } catch (error) {
      assert.ok(isAgentRuntimeError(error));
      assert.equal(error.failure, 'agent_disabled');
    }
  });

  it('refuses an uncertified agent only where certification is required', () => {
    const open = openRegistry();
    open.registerAll(FIXTURE_AGENTS);
    assert.equal(open.require(AGENT_ID.uncertified).agentId, AGENT_ID.uncertified);

    const strict = strictRegistry();
    strict.registerAll(FIXTURE_AGENTS);
    try {
      strict.require(AGENT_ID.uncertified);
      assert.fail('an uncertified agent must not run where certification is required');
    } catch (error) {
      assert.ok(isAgentRuntimeError(error));
      assert.equal(error.failure, 'agent_uncertified');
    }
  });

  it('refuses a revoked agent everywhere, even with certification off', () => {
    const registry = openRegistry();
    registry.register(
      variant({
        agentId: 'agent.test.revoked',
        certification: 'revoked',
        capabilities: ['agent.model.invoke'],
        allowedTools: [],
        allowedHandoffTargets: [],
      }),
    );
    try {
      registry.require('agent.test.revoked');
      assert.fail('a revoked agent must never resolve');
    } catch (error) {
      assert.ok(isAgentRuntimeError(error));
      assert.equal(error.failure, 'agent_uncertified');
    }
  });

  it('reports an unknown agent distinctly from a disabled one', () => {
    const registry = openRegistry();
    registry.registerAll(FIXTURE_AGENTS);
    try {
      registry.require('agent.test.absent');
      assert.fail('an unknown agent must not resolve');
    } catch (error) {
      assert.ok(isAgentRuntimeError(error));
      assert.equal(error.failure, 'agent_not_found');
    }
  });

  it('lists descriptors without exposing behaviour', () => {
    const registry = openRegistry();
    registry.registerAll(FIXTURE_AGENTS);
    const listed = registry.list();
    assert.equal(listed.length, FIXTURE_AGENTS.length);
    for (const descriptor of listed) {
      assert.equal('propose' in descriptor, false, 'a descriptor must not carry the proposer');
      assert.equal('inputContract' in descriptor, false);
    }
  });
});

describe('agent registry — definition validation', () => {
  const cases: readonly [string, Partial<AgentDefinition>, RegExp][] = [
    ['a malformed id', { agentId: 'NotAnAgentId' }, /agentId must be dotted/],
    ['a non-semver version', { version: '1.0' }, /version must be semver/],
    ['an empty owner', { owner: '  ' }, /owner is empty/],
    [
      'a step ceiling above the platform bound',
      { limits: { ...fixtureContracts.limits, maxTotalSteps: 5_000 } },
      /limits\.maxTotalSteps must be between/,
    ],
    [
      'per-agent steps above the run total',
      { limits: { ...fixtureContracts.limits, maxStepsPerAgent: 9, maxTotalSteps: 8 } },
      /maxStepsPerAgent exceeds/,
    ],
    [
      'an actual-cost ceiling above the estimate ceiling',
      {
        limits: {
          ...fixtureContracts.limits,
          maxActualCostMicroUsd: 900_001,
          maxEstimatedCostMicroUsd: 900_000,
        },
      },
      /maxActualCostMicroUsd exceeds/,
    ],
    [
      'a tool list with no tool capability',
      { capabilities: ['agent.model.invoke'], allowedTools: ['tool.text.summarize_counts'], allowedHandoffTargets: [] },
      /allowedTools is non-empty but agent\.tool\.invoke/,
    ],
    [
      'a tool capability with no tool list',
      { capabilities: ['agent.tool.invoke'], allowedTools: [], allowedHandoffTargets: [], allowedModelProfiles: [] },
      /agent\.tool\.invoke is declared but allowedTools is empty/,
    ],
    [
      'a handoff capability with no targets',
      { capabilities: ['agent.handoff.initiate'], allowedTools: [], allowedHandoffTargets: [], allowedModelProfiles: [] },
      /agent\.handoff\.initiate is declared but allowedHandoffTargets is empty/,
    ],
    [
      'a receive capability with no handoff contract',
      {
        capabilities: ['agent.handoff.receive'],
        allowedTools: [],
        allowedHandoffTargets: [],
        allowedModelProfiles: [],
        handoffContract: undefined,
      },
      /agent\.handoff\.receive is declared but no handoffContract/,
    ],
    [
      'an approval policy with no approvers',
      { approvals: { ...fixtureContracts.approvals, approverRoles: [] } },
      /approverRoles is empty/,
    ],
    [
      'an external-effect agent with no tool approval gate',
      {
        safetyClass: 'external_effect',
        approvals: { ...fixtureContracts.approvals, requireForToolRisk: [] },
      },
      /external_effect agents must require approval/,
    ],
    ['an unknown capability', { capabilities: ['agent.do.anything'] as never }, /unknown capabilities/],
  ];

  for (const [label, overrides, expected] of cases) {
    it(`refuses ${label}`, () => {
      const problems = validateDefinition(variant(overrides));
      assert.ok(
        problems.some((problem) => expected.test(problem)),
        `expected a problem matching ${expected}; got: ${problems.join('; ') || 'none'}`,
      );
    });
  }

  it('refuses registration outright rather than registering with a warning', () => {
    const registry = openRegistry();
    assert.throws(
      () => registry.register(variant({ agentId: 'BAD' })),
      /Agent definition is invalid/,
    );
    assert.equal(registry.size(), 0);
  });
});

describe('agent registry — handoff graph', () => {
  /**
   * The caller-safe message never names another agent; the reason lives in
   * `diagnostics`, which is server-side. Asserting on the diagnostics is what
   * proves the refusal was for the reason claimed rather than a generic one.
   */
  function diagnosticsOf(work: () => void): string {
    try {
      work();
    } catch (error) {
      return error instanceof Error && 'diagnostics' in error
        ? String((error as { diagnostics?: string }).diagnostics ?? '')
        : String(error);
    }
    assert.fail('expected the registration to be refused');
  }

  it('refuses a target that is not registered', () => {
    const registry = openRegistry();
    const diagnostics = diagnosticsOf(() =>
      registry.register(variant({ allowedHandoffTargets: ['agent.test.ghost'] })),
    );
    assert.match(diagnostics, /unregistered agent/);
    assert.equal(registry.size(), 0, 'a rejected registration must not remain');
  });

  it('refuses a self-handoff', () => {
    const registry = openRegistry();
    const diagnostics = diagnosticsOf(() =>
      registry.register(variant({ allowedHandoffTargets: [AGENT_ID.primary] })),
    );
    assert.match(diagnostics, /lists itself/);
  });

  it('refuses a target that cannot receive', () => {
    const registry = openRegistry();
    registry.register(
      variant({
        agentId: 'agent.test.deaf',
        capabilities: ['agent.model.invoke'],
        allowedTools: [],
        allowedHandoffTargets: [],
      }),
    );
    const diagnostics = diagnosticsOf(() =>
      registry.register(
        variant({ agentId: 'agent.test.sender', allowedHandoffTargets: ['agent.test.deaf'] }),
      ),
    );
    assert.match(diagnostics, /cannot receive handoffs/);
  });

  it('permits a legitimate two-way graph — cycles are a runtime limit, not a registry one', () => {
    const registry = openRegistry();
    registry.registerAll([primaryAgent, reviewerAgent]);
    assert.deepEqual(registry.validate(), []);
    assert.ok(primaryAgent.allowedHandoffTargets.includes(AGENT_ID.reviewer));
    assert.ok(reviewerAgent.allowedHandoffTargets.includes(AGENT_ID.primary));
  });

  it('rolls the whole set back when one member breaks the graph', () => {
    const registry = openRegistry();
    assert.throws(() =>
      registry.registerAll([
        variant({ agentId: 'agent.test.a', allowedHandoffTargets: [] , capabilities: ['agent.model.invoke','agent.handoff.receive'], allowedTools: []}),
        variant({ agentId: 'agent.test.b', allowedHandoffTargets: ['agent.test.missing'] }),
      ]),
    );
    assert.equal(registry.size(), 0, 'a partially registered set is never left behind');
  });

  it('reports a disabled agent through require(), not through the graph', () => {
    const registry = openRegistry();
    registry.registerAll(FIXTURE_AGENTS);
    assert.equal(registry.find(disabledAgent.agentId)?.enabled, false);
    assert.equal(registry.find(uncertifiedAgent.agentId)?.certification, 'uncertified');
  });
});

describe('agent state machine — transition table', () => {
  it('declares every state exactly once', () => {
    assert.equal(new Set(AGENT_RUN_STATES).size, AGENT_RUN_STATES.length);
    for (const state of AGENT_RUN_STATES) {
      assert.ok(TRANSITIONS[state] !== undefined, `${state} has no transition entry`);
    }
  });

  it('gives every terminal state no outgoing edges', () => {
    for (const state of TERMINAL_RUN_STATES) {
      assert.deepEqual(TRANSITIONS[state], [], `${state} must be terminal`);
      assert.equal(isTerminalState(state), true);
    }
  });

  it('never lets a non-terminal state be mistaken for terminal', () => {
    for (const state of AGENT_RUN_STATES) {
      if (TERMINAL_RUN_STATES.includes(state)) continue;
      assert.equal(isTerminalState(state), false, `${state} must not be terminal`);
      assert.ok(TRANSITIONS[state].length > 0, `${state} must have somewhere to go`);
    }
  });

  it('accepts every declared transition and refuses everything else', () => {
    let accepted = 0;
    let refused = 0;
    for (const from of AGENT_RUN_STATES) {
      for (const to of AGENT_RUN_STATES) {
        const declared = TRANSITIONS[from].includes(to);
        assert.equal(canTransition(from, to), declared, `${from} → ${to}`);
        if (declared) accepted += 1;
        else refused += 1;
      }
    }
    assert.ok(accepted > 0 && refused > 0, 'the table must both permit and refuse');
  });

  it('refuses a transition out of a terminal state', () => {
    for (const from of TERMINAL_RUN_STATES) {
      assert.throws(
        () =>
          assertTransition({
            from,
            to: 'running',
            operation: 'resume',
            currentVersion: 4,
            expectedVersion: 4,
            runId: 'run_x',
          }),
        /already finished/,
        `${from} must be immutable`,
      );
    }
  });

  it('refuses an undeclared transition with a typed failure', () => {
    try {
      assertTransition({
        from: 'created',
        to: 'completed',
        operation: 'complete',
        currentVersion: 1,
        expectedVersion: 1,
        runId: 'run_x',
      });
      assert.fail('created → completed is not a legal edge');
    } catch (error) {
      assert.ok(isAgentRuntimeError(error));
      assert.equal(error.failure, 'invalid_transition');
    }
  });

  it('refuses a legal edge driven by the wrong operation', () => {
    // running → completed is legal; `cancel` may not be what produces it.
    assert.doesNotThrow(() =>
      assertTransition({
        from: 'running',
        to: 'completed',
        operation: 'complete',
        currentVersion: 2,
        expectedVersion: 2,
        runId: 'run_x',
      }),
    );
    try {
      assertTransition({
        from: 'running',
        to: 'completed',
        operation: 'cancel',
        currentVersion: 2,
        expectedVersion: 2,
        runId: 'run_x',
      });
      assert.fail('cancel must not be able to complete a run');
    } catch (error) {
      assert.ok(isAgentRuntimeError(error));
      assert.equal(error.failure, 'invalid_transition');
    }
  });

  it('refuses a stale transition before it refuses an illegal one', () => {
    try {
      assertTransition({
        from: 'running',
        to: 'completed',
        operation: 'complete',
        currentVersion: 5,
        expectedVersion: 4,
        runId: 'run_x',
      });
      assert.fail('a stale version must be refused');
    } catch (error) {
      assert.ok(isAgentRuntimeError(error));
      assert.equal(error.failure, 'stale_run_version');
    }
  });

  it('leaves the run-level retry operation with no transition of its own', () => {
    // A retry forks a new run; it must not be expressible as an edge on the
    // terminal record it came from.
    assert.deepEqual(OPERATION_TARGETS.retry, []);
  });

  it('counts only in-flight states as active', () => {
    for (const state of ACTIVE_STATES) {
      assert.equal(isTerminalState(state), false, `${state} cannot be both active and terminal`);
    }
    assert.equal(ACTIVE_STATES.includes('waiting_for_approval'), false);
    assert.equal(ACTIVE_STATES.includes('paused'), false);
  });
});
