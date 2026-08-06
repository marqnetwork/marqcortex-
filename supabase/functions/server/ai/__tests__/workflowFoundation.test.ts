/**
 * Workflow foundation — validation, planning and registration (AI-01 Batch 3B,
 * Part 1).
 *
 * Asserted against the production implementations, not against a copy of their
 * tables. Every guarantee this batch claims is checked in the direction that
 * can fail: that a bad graph is REFUSED, that the refusal names what is wrong,
 * and that the digest is stable across the changes that should not move it and
 * moves for the ones that should.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validateWorkflowDefinition } from '../workflows/validation/workflowValidation.ts';
import { createWorkflowPlanner, planWorkflow } from '../workflows/planner/workflowPlanner.ts';
import { createWorkflowRegistry } from '../workflows/registry/workflowRegistry.ts';
import { isWorkflowError } from '../workflows/contracts/failures.ts';
import type { WorkflowDefinition } from '../workflows/contracts/workflow.ts';
import type { WorkflowPlanResult } from '../workflows/contracts/plan.ts';
import { isAgentStep } from '../workflows/contracts/plan.ts';
import {
  WORKFLOW_AGENT_ID,
  agentExists,
  edge,
  linearWorkflow,
  node,
  singleNodeWorkflow,
  undeclaredStartWorkflow,
  variant,
} from './workflowFixtures.ts';

const plan = (definition: WorkflowDefinition): WorkflowPlanResult =>
  planWorkflow(definition, { agentExists });

function problems(definition: WorkflowDefinition): readonly string[] {
  const result = plan(definition);
  assert.equal(result.ok, false, 'expected the definition to be refused');
  return result.ok ? [] : result.problems;
}

const matches = (found: readonly string[], pattern: RegExp): boolean =>
  found.some((problem) => pattern.test(problem));

// ── Validation ──────────────────────────────────────────────────────────────

describe('workflow validation — identity and governance', () => {
  it('accepts a well-formed definition', () => {
    assert.deepEqual(validateWorkflowDefinition(linearWorkflow, { agentExists }), []);
  });

  it('reports every identity problem at once, not the first', () => {
    const found = validateWorkflowDefinition(
      variant({ workflowId: 'Bad Id', version: 'v1', owner: '  ', purpose: '' }),
    );
    assert.ok(matches(found, /workflowId must be dotted lower-case/));
    assert.ok(matches(found, /version must be semver/));
    assert.ok(matches(found, /owner is empty/));
    assert.ok(matches(found, /purpose is empty/));
    assert.ok(found.length >= 4, `expected four problems, got ${found.length}`);
  });

  it('refuses an unrecognised certification status', () => {
    const found = validateWorkflowDefinition(
      variant({ certification: 'approved' as never }),
    );
    assert.ok(matches(found, /certification is not a recognised status/));
  });

  it('requires input and output contracts to be validators', () => {
    const found = validateWorkflowDefinition(
      variant({ inputContract: {} as never, outputContract: undefined as never }),
    );
    assert.ok(matches(found, /inputContract must be a validator/));
    assert.ok(matches(found, /outputContract must be a validator/));
  });
});

describe('workflow validation — nodes', () => {
  it('refuses an empty node set', () => {
    const found = validateWorkflowDefinition(
      variant({ nodes: [], edges: [], startNodeId: undefined }),
    );
    assert.ok(matches(found, /nodes is empty/));
  });

  it('refuses a duplicate node id', () => {
    const found = validateWorkflowDefinition(
      variant({ nodes: [node({ nodeId: 'intake' }), node({ nodeId: 'intake' })], edges: [] }),
    );
    assert.ok(matches(found, /duplicate nodeId/));
  });

  it('refuses a node kind this batch cannot execute', () => {
    // Part 3 added `condition`; everything else is still unrepresentable, and
    // the refusal names what the batch actually has rather than what it lacks.
    const found = validateWorkflowDefinition(
      variant({ nodes: [node({ nodeId: 'intake', kind: 'parallel' as never })], edges: [] }),
    );
    assert.ok(matches(found, /this batch has agent and condition nodes/));
  });

  it('bounds the attempt ceiling in both directions', () => {
    assert.ok(
      matches(
        validateWorkflowDefinition(variant({ nodes: [node({ nodeId: 'a', maxAttempts: 0 })], edges: [] })),
        /maxAttempts must be between/,
      ),
    );
    assert.ok(
      matches(
        validateWorkflowDefinition(variant({ nodes: [node({ nodeId: 'a', maxAttempts: 99 })], edges: [] })),
        /maxAttempts must be between/,
      ),
    );
    assert.ok(
      matches(
        validateWorkflowDefinition(
          variant({ nodes: [node({ nodeId: 'a', maxAttempts: 1.5 })], edges: [] }),
        ),
        /maxAttempts must be an integer/,
      ),
    );
  });

  it('checks agent references against the port when one is supplied', () => {
    const withGhost = variant({
      nodes: [node({ nodeId: 'a', agentId: WORKFLOW_AGENT_ID.unknown })],
      edges: [],
      startNodeId: 'a',
    });
    assert.ok(
      matches(
        validateWorkflowDefinition(withGhost, { agentExists }),
        /references unregistered agent agent\.workflow\.ghost/,
      ),
    );
    // Without the port the same definition is structurally sound. The omission
    // is the caller's decision, and it must not silently become a pass on a
    // reference that WAS checkable.
    assert.deepEqual(validateWorkflowDefinition(withGhost), []);
  });
});

describe('workflow validation — edges', () => {
  it('refuses an edge that names a node the workflow does not have', () => {
    const found = validateWorkflowDefinition(
      variant({ edges: [edge('intake', 'draft'), edge('draft', 'publish')] }),
    );
    assert.ok(matches(found, /to references unknown node publish/));
  });

  it('refuses a self-edge by name rather than as a one-node cycle', () => {
    const found = validateWorkflowDefinition(variant({ edges: [edge('intake', 'intake')] }));
    assert.ok(matches(found, /an edge cannot leave and enter one node/));
  });

  it('refuses a duplicate edge', () => {
    const found = validateWorkflowDefinition(
      variant({ edges: [edge('intake', 'draft'), edge('intake', 'draft'), edge('draft', 'review')] }),
    );
    assert.ok(matches(found, /duplicate edge/));
  });

  it('refuses fan-out from an agent node, and says where branching belongs', () => {
    // Part 3 did not loosen this. An AGENT node still takes exactly one
    // successor — two would be a parallel branch needing a join. Branching
    // moved to a node kind that makes the choice visible, not to the edges.
    const found = validateWorkflowDefinition(
      variant({ edges: [edge('intake', 'draft'), edge('intake', 'review')] }),
    );
    assert.ok(
      matches(
        found,
        /node intake has 2 outgoing edges — an agent node takes exactly one successor/,
      ),
    );
  });

  it('refuses a when label on an edge out of an agent node', () => {
    const found = validateWorkflowDefinition(
      variant({ edges: [{ from: 'intake', to: 'draft', when: true }, edge('draft', 'review')] }),
    );
    assert.ok(matches(found, /only a condition node may declare when/));
  });

  it('refuses a declared start node that does not exist', () => {
    const found = validateWorkflowDefinition(variant({ startNodeId: 'nowhere' }));
    assert.ok(matches(found, /startNodeId references unknown node nowhere/));
  });
});

// ── Planning ────────────────────────────────────────────────────────────────

describe('workflow planner — start node resolution', () => {
  it('honours a declared start node', () => {
    const result = plan(linearWorkflow);
    assert.ok(result.ok);
    assert.equal(result.plan.startNodeId, 'intake');
  });

  it('resolves the single node nothing points at when none is declared', () => {
    const result = plan(undeclaredStartWorkflow);
    assert.ok(result.ok);
    assert.equal(result.plan.startNodeId, 'intake');
  });

  it('refuses an ambiguous start rather than picking by declaration order', () => {
    const found = problems(
      variant({
        workflowId: 'workflow.fixture.two_roots',
        nodes: [node({ nodeId: 'a' }), node({ nodeId: 'b' }), node({ nodeId: 'c' })],
        edges: [edge('a', 'c')],
        startNodeId: undefined,
      }),
    );
    assert.ok(matches(found, /ambiguous start node: a, b/));
  });

  it('refuses a graph with no entry point at all', () => {
    const found = problems(
      variant({
        nodes: [node({ nodeId: 'a' }), node({ nodeId: 'b' })],
        edges: [edge('a', 'b'), edge('b', 'a')],
        startNodeId: undefined,
      }),
    );
    assert.ok(matches(found, /no start node: every node has an incoming edge/));
  });
});

describe('workflow planner — graph analysis', () => {
  it('detects an unreachable node and names it', () => {
    const found = problems(
      variant({
        nodes: [node({ nodeId: 'intake' }), node({ nodeId: 'draft' }), node({ nodeId: 'orphan' })],
        edges: [edge('intake', 'draft')],
        startNodeId: 'intake',
      }),
    );
    assert.ok(matches(found, /unreachable from intake: orphan/));
  });

  it('refuses an undeclared cycle as an unbounded loop', () => {
    // Part 1 refused every cycle. Part 3 refuses the UNDECLARED ones, and this
    // is the direct successor to that rule: a cycle whose closing edge names no
    // iteration ceiling has no way to stop.
    const found = problems(
      variant({
        nodes: [node({ nodeId: 'a' }), node({ nodeId: 'b' }), node({ nodeId: 'c' })],
        edges: [edge('a', 'b'), edge('b', 'c'), edge('c', 'b')],
        startNodeId: 'a',
      }),
    );
    assert.ok(matches(found, /unbounded loop: edge c -> b closes a cycle/), found.join('; '));
  });

  it('reports an orphan and a cycle in one pass', () => {
    const found = problems(
      variant({
        nodes: [
          node({ nodeId: 'a' }),
          node({ nodeId: 'b' }),
          node({ nodeId: 'x' }),
          node({ nodeId: 'y' }),
        ],
        edges: [edge('a', 'b'), edge('x', 'y'), edge('y', 'x')],
        startNodeId: 'a',
      }),
    );
    assert.ok(matches(found, /unreachable from a: x, y/));
    assert.ok(matches(found, /unbounded loop: edge y -> x/));
  });

  it('terminates on a cyclic graph instead of walking it forever', () => {
    // Reachability runs BEFORE cycles are ruled out. If it assumed acyclicity
    // this call would never return, so the assertion is that it returns at all.
    const found = problems(
      variant({
        nodes: [node({ nodeId: 'a' }), node({ nodeId: 'b' })],
        edges: [edge('a', 'b'), edge('b', 'a')],
        startNodeId: 'a',
      }),
    );
    assert.ok(found.length > 0);
  });
});

describe('workflow planner — the plan', () => {
  it('orders the steps along the chain and marks the terminal one', () => {
    const result = plan(linearWorkflow);
    assert.ok(result.ok);
    assert.deepEqual(
      result.plan.steps.map((step) => [step.index, step.nodeId, step.depth, step.terminal]),
      [
        [0, 'intake', 0, false],
        [1, 'draft', 1, false],
        [2, 'review', 2, true],
      ],
    );
    assert.deepEqual(
      result.plan.steps.filter(isAgentStep).map((step) => step.nextNodeId),
      ['draft', 'review', undefined],
    );
  });

  it('plans a single-node workflow at depth zero', () => {
    const result = plan(singleNodeWorkflow);
    assert.ok(result.ok);
    assert.equal(result.plan.steps.length, 1);
    assert.equal(result.plan.metadata.depth, 0);
    assert.deepEqual(result.plan.metadata.terminalNodeIds, ['only']);
  });

  it('calculates metadata from the plan rather than from the definition alone', () => {
    const result = plan(linearWorkflow);
    assert.ok(result.ok);
    assert.deepEqual(result.plan.metadata, {
      nodeCount: 3,
      edgeCount: 2,
      stepCount: 3,
      agentNodeCount: 3,
      conditionNodeCount: 0,
      depth: 2,
      agentIds: [WORKFLOW_AGENT_ID.draft, WORKFLOW_AGENT_ID.intake, WORKFLOW_AGENT_ID.review].sort(),
      distinctAgentCount: 3,
      startNodeId: 'intake',
      terminalNodeIds: ['review'],
      loopCount: 0,
      // 1 + 3 + 2 attempt ceilings, in no loop.
      maxAgentInvocations: 6,
    });
  });
});

describe('workflow planner — the digest', () => {
  const digestOf = (definition: WorkflowDefinition): string => {
    const result = plan(definition);
    assert.ok(result.ok);
    return result.plan.digest;
  };

  it('is a full-length sha-256 hex digest', () => {
    assert.match(digestOf(linearWorkflow), /^[0-9a-f]{64}$/);
  });

  it('is stable across repeated planning of the same definition', () => {
    assert.equal(digestOf(linearWorkflow), digestOf(linearWorkflow));
  });

  it('does not move when the node list is merely reordered', () => {
    const reordered = variant({
      nodes: [linearWorkflow.nodes[2], linearWorkflow.nodes[0], linearWorkflow.nodes[1]],
    });
    assert.equal(digestOf(reordered), digestOf(linearWorkflow));
  });

  it('does not move for a cosmetic rename or an edge label', () => {
    const renamed = variant({
      displayName: 'Linear fixture, renamed',
      description: 'Rewritten prose.',
      nodes: linearWorkflow.nodes.map((entry) => ({ ...entry, displayName: `${entry.displayName}!` })),
      edges: [edge('intake', 'draft', 'a new label'), edge('draft', 'review')],
    });
    assert.equal(digestOf(renamed), digestOf(linearWorkflow));
  });

  it('moves when the version is bumped', () => {
    assert.notEqual(digestOf(variant({ version: '1.0.1' })), digestOf(linearWorkflow));
  });

  it('moves when the graph changes shape', () => {
    const shortened = variant({
      nodes: [linearWorkflow.nodes[0], linearWorkflow.nodes[1]],
      edges: [edge('intake', 'draft')],
    });
    assert.notEqual(digestOf(shortened), digestOf(linearWorkflow));
  });

  it('moves when an attempt ceiling changes', () => {
    const retried = variant({
      nodes: linearWorkflow.nodes.map((entry) =>
        entry.nodeId === 'draft' ? { ...entry, maxAttempts: 4 } : entry,
      ),
    });
    assert.notEqual(digestOf(retried), digestOf(linearWorkflow));
  });

  it('moves when the same chain runs different agents', () => {
    const reassigned = variant({
      nodes: linearWorkflow.nodes.map((entry) =>
        entry.nodeId === 'review' ? { ...entry, agentId: WORKFLOW_AGENT_ID.intake } : entry,
      ),
    });
    assert.notEqual(digestOf(reassigned), digestOf(linearWorkflow));
  });
});

// ── Registry ────────────────────────────────────────────────────────────────

const openRegistry = () => createWorkflowRegistry({ requireCertification: () => false, agentExists });
const strictRegistry = () =>
  createWorkflowRegistry({ requireCertification: () => true, agentExists });

describe('workflow registry', () => {
  it('registers a valid definition and holds its plan', () => {
    const registry = openRegistry();
    registry.register(linearWorkflow);
    assert.equal(registry.size(), 1);
    assert.equal(registry.requirePlan(linearWorkflow.workflowId).steps.length, 3);
    assert.deepEqual(registry.validate(), []);
  });

  it('refuses a definition that validates but cannot be planned', () => {
    const registry = openRegistry();
    const orphaned = variant({
      nodes: [node({ nodeId: 'intake' }), node({ nodeId: 'draft' }), node({ nodeId: 'orphan' })],
      edges: [edge('intake', 'draft')],
      startNodeId: 'intake',
    });
    assert.throws(
      () => registry.register(orphaned),
      (error: unknown) =>
        isWorkflowError(error) && error.failure === 'workflow_invalid_definition',
    );
    assert.equal(registry.size(), 0);
  });

  it('refuses a duplicate registration', () => {
    const registry = openRegistry();
    registry.register(linearWorkflow);
    assert.throws(() => registry.register(linearWorkflow), /already registered/i);
  });

  it('rolls the whole set back when one definition in it is bad', () => {
    const registry = openRegistry();
    assert.throws(() =>
      registry.registerAll([
        singleNodeWorkflow,
        variant({ workflowId: 'workflow.fixture.broken', edges: [edge('intake', 'nowhere')] }),
      ]),
    );
    assert.equal(registry.size(), 0, 'a partial registration is worse than none');
  });

  it('resolves a disabled workflow as disabled, not as missing', () => {
    const registry = openRegistry();
    registry.register(variant({ enabled: false }));
    assert.throws(
      () => registry.require(linearWorkflow.workflowId),
      (error: unknown) => isWorkflowError(error) && error.failure === 'workflow_disabled',
    );
  });

  it('refuses a revoked workflow even when it is enabled', () => {
    const registry = openRegistry();
    registry.register(variant({ certification: 'revoked', enabled: true }));
    assert.throws(
      () => registry.require(linearWorkflow.workflowId),
      (error: unknown) => isWorkflowError(error) && error.failure === 'workflow_uncertified',
    );
  });

  it('refuses an uncertified workflow only where certification is demanded', () => {
    const testing = variant({ certification: 'testing' });

    const open = openRegistry();
    open.register(testing);
    assert.equal(open.require(testing.workflowId).workflowId, testing.workflowId);

    const strict = strictRegistry();
    strict.register(testing);
    assert.throws(
      () => strict.require(testing.workflowId),
      (error: unknown) => isWorkflowError(error) && error.failure === 'workflow_uncertified',
    );
  });

  it('reports an unknown workflow as not found', () => {
    const registry = openRegistry();
    assert.throws(
      () => registry.require('workflow.fixture.absent'),
      (error: unknown) => isWorkflowError(error) && error.failure === 'workflow_not_found',
    );
    assert.equal(registry.find('workflow.fixture.absent'), undefined);
    assert.equal(registry.findPlan('workflow.fixture.absent'), undefined);
  });

  it('lists descriptors in a stable order, without behaviour', () => {
    const registry = openRegistry();
    registry.registerAll([linearWorkflow, singleNodeWorkflow]);
    const listed = registry.list();
    assert.deepEqual(
      listed.map((descriptor) => descriptor.workflowId),
      ['workflow.fixture.linear', 'workflow.fixture.single'],
    );
    assert.deepEqual(listed[0].agentIds, [
      WORKFLOW_AGENT_ID.draft,
      WORKFLOW_AGENT_ID.intake,
      WORKFLOW_AGENT_ID.review,
    ]);
    assert.equal('inputContract' in listed[0], false, 'a descriptor carries no contract');
  });

  it('re-checks registered workflows against the world as it is now', () => {
    // The agent a registered workflow names can be withdrawn after registration.
    // `validate()` re-plans, so it reports the break instead of replaying the
    // answer registration gave when the agent still existed.
    let known: readonly string[] = [
      WORKFLOW_AGENT_ID.intake,
      WORKFLOW_AGENT_ID.draft,
      WORKFLOW_AGENT_ID.review,
    ];
    const registry = createWorkflowRegistry({
      requireCertification: () => false,
      agentExists: (agentId) => known.includes(agentId),
    });
    registry.register(linearWorkflow);
    assert.deepEqual(registry.validate(), []);

    known = [WORKFLOW_AGENT_ID.intake, WORKFLOW_AGENT_ID.draft];
    assert.ok(
      matches(registry.validate(), /references unregistered agent agent\.workflow\.review/),
      'a withdrawn agent must surface as a registry problem',
    );
  });
});

describe('workflow planner — the throwing entry point', () => {
  it('throws a typed failure that carries every problem as diagnostics', () => {
    const planner = createWorkflowPlanner({ agentExists });
    assert.throws(
      () => planner.plan(variant({ startNodeId: 'nowhere' })),
      (error: unknown) => {
        assert.ok(isWorkflowError(error));
        assert.equal(error.failure, 'workflow_plan_failed');
        assert.equal(error.retryable, false, 'a bad definition does not improve on retry');
        assert.match(String(error.diagnostics), /startNodeId references unknown node nowhere/);
        // The caller-safe message must not leak the graph's internals.
        assert.equal(/nowhere/.test(error.message), false);
        return true;
      },
    );
  });

  it('returns the plan on the happy path', () => {
    const planner = createWorkflowPlanner({ agentExists });
    assert.equal(planner.plan(linearWorkflow).metadata.stepCount, 3);
  });
});
