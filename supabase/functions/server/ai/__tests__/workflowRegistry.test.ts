/**
 * Workflow Registry and Planner suite (AI-01 Batch 3B).
 *
 * Registration is the review gate, so these tests are about REFUSAL: for every
 * class of malformed definition the batch names, one case proving the registry
 * says no and names why. A registry that accepted a graph the engine could not
 * execute would move every one of these failures from a code review into an
 * incident.
 *
 * The planner tests are about DETERMINISM and WORST CASE. A plan is the artefact
 * every later control is enforced against, so two compilations of one definition
 * must be byte-identical, and the worst case has to account for branch
 * multiplicity — a node inside a three-arm fan-out runs three times, and costing
 * it once is how a budget control fails while reporting that it held.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createWorkflowRegistry,
  validateWorkflowDefinition,
} from '../workflows/registry/workflowRegistry.ts';
import { planWorkflow } from '../workflows/planner/workflowPlanner.ts';
import { isWorkflowError } from '../workflows/contracts/failures.ts';
import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from '../workflows/contracts/workflow.ts';
import { PLATFORM_PLAN_BOUNDS } from '../workflows/contracts/workflow.ts';
import { indicativeCostMicroUsd } from '../agents/runtime/modelRouting.ts';
import { DEFAULT_MODEL_PROFILES } from '../agents/runtime/defaultProfiles.ts';
import {
  AGENT_ID,
  AGENT_MODEL_PROFILE,
  DETERMINISTIC_TOOL_IDS,
  FIXTURE_LIMITS,
  WORKFLOW_ID,
  completeNode,
  conditionalWorkflow,
  conditionNode,
  edge,
  failNode,
  fanOutWorkflow,
  modelNode,
  parallelAllWorkflow,
  sequentialWorkflow,
  transformNode,
  uncertifiedWorkflow,
  workflowFixtureContracts,
} from './workflowFixtures.ts';

const CONTEXT = {
  requireCertification: false,
  knownAgentIds: [AGENT_ID.primary, AGENT_ID.reviewer],
  knownToolIds: [DETERMINISTIC_TOOL_IDS.summarize, DETERMINISTIC_TOOL_IDS.recordNote],
  knownProfileIds: [AGENT_MODEL_PROFILE.standard, AGENT_MODEL_PROFILE.compact],
};

function problemsFor(definition: WorkflowDefinition): readonly string[] {
  return validateWorkflowDefinition(definition, CONTEXT);
}

/** Assert that at least one problem mentions each fragment. */
function assertMentions(problems: readonly string[], ...fragments: readonly string[]): void {
  for (const fragment of fragments) {
    assert.ok(
      problems.some((problem) => problem.includes(fragment)),
      `expected a problem mentioning "${fragment}", got:\n${problems.join('\n') || '(none)'}`,
    );
  }
}

function registry() {
  return createWorkflowRegistry({
    requireCertification: () => false,
    knownAgentIds: () => CONTEXT.knownAgentIds,
    knownToolIds: () => CONTEXT.knownToolIds,
    knownProfileIds: () => CONTEXT.knownProfileIds,
  });
}

function priced(profileId: string, promptTokens: number, completionTokens: number): number {
  const profile = DEFAULT_MODEL_PROFILES.find((entry) => entry.profileId === profileId);
  return profile === undefined
    ? 0
    : indicativeCostMicroUsd(profile, promptTokens, completionTokens);
}

describe('workflow registry — valid definitions', () => {
  it('accepts every shipped fixture', () => {
    for (const definition of [sequentialWorkflow, conditionalWorkflow, parallelAllWorkflow]) {
      assert.deepEqual(
        problemsFor(definition),
        [],
        `${definition.workflowId} should validate cleanly`,
      );
    }
  });

  it('registers, describes and requires a definition', () => {
    const store = registry();
    store.register(sequentialWorkflow);
    assert.equal(store.size(), 1);
    assert.equal(store.require(WORKFLOW_ID.sequential).workflowId, WORKFLOW_ID.sequential);

    const descriptor = store.describe(WORKFLOW_ID.sequential);
    assert.ok(descriptor);
    assert.equal(descriptor.nodeCount, 3);
    assert.equal(descriptor.edgeCount, 2);
    // The descriptor carries the governance, not the contracts: it is safe to hand
    // to any authorised reader.
    assert.deepEqual(descriptor.nodeTypes, ['complete', 'model', 'transform']);
    assert.equal(store.validate().length, 0);
  });

  it('reports a cross-definition problem without throwing', () => {
    const store = createWorkflowRegistry({ requireCertification: () => false });
    store.register(uncertifiedWorkflow);
    // Registered while certification was not required, then re-validated once it is.
    const hardened = createWorkflowRegistry({ requireCertification: () => true });
    assert.throws(() => hardened.register(uncertifiedWorkflow), (error: unknown) => {
      assert.ok(isWorkflowError(error));
      assert.equal(error.failure, 'invalid_workflow_definition');
      return true;
    });
    assert.equal(store.validate().length, 0, 'the permissive registry still validates');
  });
});

describe('workflow registry — refusals', () => {
  it('refuses a duplicate workflow id', () => {
    const store = registry();
    store.register(sequentialWorkflow);
    assert.throws(
      () => store.register(sequentialWorkflow),
      (error: unknown) => {
        assert.ok(isWorkflowError(error));
        assert.equal(error.failure, 'invalid_workflow_definition');
        assert.match(error.diagnostics ?? '', /duplicate workflow id/);
        return true;
      },
    );
  });

  it('refuses a non-semantic version', () => {
    for (const version of ['1.0', 'v1.0.0', '1.0.0-beta', '01.0.0']) {
      assertMentions(
        problemsFor({ ...sequentialWorkflow, version }),
        'is not a semantic version',
      );
    }
  });

  it('refuses a missing initial node', () => {
    assertMentions(
      problemsFor({ ...sequentialWorkflow, initialNodeId: 'nowhere' }),
      'is not a declared node',
    );
  });

  it('refuses an unknown edge target', () => {
    assertMentions(
      problemsFor({
        ...sequentialWorkflow,
        edges: [edge('e1', 'normalize', 'analyse'), edge('e2', 'analyse', 'ghost')],
      }),
      'targets unknown node "ghost"',
    );
  });

  it('refuses an unreachable node', () => {
    assertMentions(
      problemsFor({
        ...sequentialWorkflow,
        nodes: [...sequentialWorkflow.nodes, transformNode('orphan')],
      }),
      'is unreachable from the initial node',
    );
  });

  it('refuses a cycle, naming it an unbounded loop', () => {
    const problems = problemsFor({
      ...sequentialWorkflow,
      nodes: [transformNode('normalize'), modelNode('analyse'), completeNode()],
      edges: [
        edge('e1', 'normalize', 'analyse'),
        // analyse → normalize closes the loop, and `analyse` then has two `always`
        // edges — both refusals are legitimate and the cycle one is what matters.
        edge('e2', 'analyse', 'normalize'),
      ],
    });
    assertMentions(problems, 'contains a cycle', 'unbounded loop');
  });

  it('refuses a path with no terminal outcome', () => {
    // A graph with no complete node at all: nothing can succeed.
    assertMentions(
      problemsFor({
        ...sequentialWorkflow,
        nodes: [transformNode('normalize'), failNode('stop')],
        edges: [edge('e1', 'normalize', 'stop')],
        completion: { requiredOutputFields: [], requireApproval: false },
      }),
      'declares no complete node',
    );
  });

  it('refuses a join no parallel node feeds', () => {
    const problems = problemsFor({
      ...sequentialWorkflow,
      nodes: [
        transformNode('normalize'),
        {
          ...workflowFixtureContracts.base('converge', 'An orphaned join.'),
          nodeType: 'join',
          policy: 'all',
          onSatisfied: 'cancel_remaining',
          failurePolicy: 'wait_all',
        } as WorkflowNode,
        completeNode(),
      ],
      edges: [
        edge('e1', 'normalize', 'converge'),
        edge('e2', 'converge', 'finish'),
      ],
    });
    assertMentions(problems, 'is not the join of any parallel node');
  });

  it('refuses a join whose minimum can never be met', () => {
    assertMentions(
      problemsFor(
        fanOutWorkflow({
          workflowId: 'workflow.test.impossible_join',
          policy: 'minimum_successes',
          minimumSuccesses: 5,
        }),
      ),
      'requires 5 successes but only 2 branches can arrive',
    );
  });

  it('refuses a join that names a branch its parallel does not open', () => {
    assertMentions(
      problemsFor(
        fanOutWorkflow({
          workflowId: 'workflow.test.named_missing',
          policy: 'named_required_branches',
          requiredBranchIds: ['middle'],
        }),
      ),
      'requires branch "middle"',
    );
  });

  it('refuses a branch that never reaches its join', () => {
    const broken = fanOutWorkflow({ workflowId: 'workflow.test.dangling', policy: 'all' });
    assertMentions(
      problemsFor({
        ...broken,
        // The right arm now points at `summarise`, which is past the join, so the
        // join can never see it.
        edges: broken.edges.map((entry) =>
          entry.edgeId === 'e2' ? edge('e2', 'right_work', 'summarise') : entry,
        ),
      }),
      'never reaches join',
    );
  });

  it('refuses a condition without exactly one true and one false edge', () => {
    assertMentions(
      problemsFor({
        ...conditionalWorkflow,
        edges: conditionalWorkflow.edges.filter((entry) => entry.edgeId !== 'e2'),
      }),
      'needs exactly one true edge and one false edge',
    );
  });

  it('refuses an undeclared agent, tool and model profile', () => {
    assertMentions(
      problemsFor({
        ...sequentialWorkflow,
        allowedModelProfiles: [AGENT_MODEL_PROFILE.compact],
        nodes: [transformNode('normalize'), modelNode('analyse'), completeNode()],
      }),
      'which the workflow does not declare',
    );

    assertMentions(
      problemsFor({
        ...sequentialWorkflow,
        allowedAgents: [],
        nodes: [
          {
            ...workflowFixtureContracts.base('delegate', 'Delegate.'),
            nodeType: 'agent',
            agentId: AGENT_ID.primary,
            objective: 'Do the thing.',
            tokenAllowance: 1_000,
            costAllowanceMicroUsd: 1_000,
          } as WorkflowNode,
          completeNode(),
        ],
        initialNodeId: 'delegate',
        edges: [edge('e1', 'delegate', 'finish')],
      }),
      'which the workflow does not declare',
    );

    assertMentions(
      problemsFor({
        ...sequentialWorkflow,
        allowedTools: [],
        nodes: [
          {
            ...workflowFixtureContracts.base('call', 'Call a tool.'),
            nodeType: 'tool',
            toolId: DETERMINISTIC_TOOL_IDS.summarize,
          } as WorkflowNode,
          completeNode(),
        ],
        initialNodeId: 'call',
        edges: [edge('e1', 'call', 'finish')],
      }),
      'which the workflow does not declare',
    );
  });

  it('refuses an unregistered agent even when the workflow declares it', () => {
    assertMentions(
      validateWorkflowDefinition(
        {
          ...sequentialWorkflow,
          allowedAgents: ['agent.does.not.exist'],
          initialNodeId: 'delegate',
          nodes: [
            {
              ...workflowFixtureContracts.base('delegate', 'Delegate.'),
              nodeType: 'agent',
              agentId: 'agent.does.not.exist',
              objective: 'Do the thing.',
              tokenAllowance: 1_000,
              costAllowanceMicroUsd: 1_000,
            } as WorkflowNode,
            completeNode(),
          ],
          edges: [edge('e1', 'delegate', 'finish')],
        },
        CONTEXT,
      ),
      'which is not registered',
    );
  });

  it('refuses invalid limits', () => {
    assertMentions(
      problemsFor({
        ...sequentialWorkflow,
        limits: { ...FIXTURE_LIMITS, maxParallelBranches: 99 },
      }),
      'limits.maxParallelBranches must be an integer between',
    );
    assertMentions(
      problemsFor({
        ...sequentialWorkflow,
        limits: { ...FIXTURE_LIMITS, maxTotalTokens: 1, maxPromptTokens: 100 },
      }),
      'maxTotalTokens must be at least',
    );
  });

  it('refuses an uncertified definition when the deployment requires certification', () => {
    assertMentions(
      validateWorkflowDefinition(uncertifiedWorkflow, {
        ...CONTEXT,
        requireCertification: true,
      }),
      'this deployment requires certified workflows',
    );
  });

  it('refuses a revoked definition unconditionally', () => {
    assertMentions(
      problemsFor({ ...sequentialWorkflow, certification: 'revoked' }),
      'a revoked workflow may never be registered',
    );
  });

  it('refuses an unsafe side effect with no approval', () => {
    assertMentions(
      problemsFor({
        ...sequentialWorkflow,
        safetyClass: 'external_effect',
        initialNodeId: 'call',
        nodes: [
          {
            ...workflowFixtureContracts.base('call', 'Write outside the platform.'),
            nodeType: 'tool',
            toolId: DETERMINISTIC_TOOL_IDS.recordNote,
          } as WorkflowNode,
          completeNode(),
        ],
        edges: [edge('e1', 'call', 'finish')],
      }),
      'must be approval-gated',
    );
  });

  it('refuses an approval nobody is authorised to decide', () => {
    assertMentions(
      problemsFor({
        ...sequentialWorkflow,
        nodes: [
          transformNode('normalize'),
          modelNode('analyse', {
            approval: { ...workflowFixtureContracts.approval, approverRoles: [] },
          }),
          completeNode(),
        ],
      }),
      'an approval nobody is authorised to decide',
    );
  });

  it('refuses a transform that claims a saving it cannot measure', () => {
    assertMentions(
      problemsFor({
        ...sequentialWorkflow,
        nodes: [
          transformNode('normalize', { avoidsModelCall: true }),
          modelNode('analyse'),
          completeNode(),
        ],
      }),
      'names no profile to compare with',
    );
  });

  it('refuses an unsupported node type', () => {
    assertMentions(
      problemsFor({
        ...sequentialWorkflow,
        nodes: [
          { ...workflowFixtureContracts.base('weird', 'Unknown.'), nodeType: 'teleport' } as unknown as WorkflowNode,
          completeNode(),
        ],
        initialNodeId: 'weird',
        edges: [edge('e1', 'weird', 'finish')],
      }),
      'unsupported node type',
    );
  });

  it('refuses a disabled or unregistered workflow at `require`', () => {
    const store = registry();
    store.register({ ...sequentialWorkflow, workflowId: 'workflow.test.off', enabled: false });
    assert.throws(() => store.require('workflow.test.off'), (error: unknown) => {
      assert.ok(isWorkflowError(error));
      assert.equal(error.failure, 'workflow_disabled');
      return true;
    });
    assert.throws(() => store.require('workflow.test.absent'), (error: unknown) => {
      assert.ok(isWorkflowError(error));
      assert.equal(error.failure, 'workflow_not_found');
      return true;
    });
  });
});

describe('workflow planner', () => {
  it('produces a stable digest across repeated compilations', () => {
    const first = planWorkflow(sequentialWorkflow);
    const second = planWorkflow(sequentialWorkflow);
    assert.equal(first.digest, second.digest);
    assert.equal(first.manifestDigest, second.manifestDigest);
    assert.notEqual(first.digest, '', 'a plan digest must not be empty');
  });

  it('changes the digest when the graph changes but not when only pricing does', () => {
    const base = planWorkflow(sequentialWorkflow);
    const priced2 = planWorkflow(sequentialWorkflow, { price: () => 999_999 });
    // The EXECUTABLE identity excludes advisory cost, so re-pricing a profile does
    // not invalidate a running workflow's plan identity.
    assert.equal(base.digest, priced2.digest);
    assert.notEqual(base.manifestDigest, priced2.manifestDigest);

    const rewired = planWorkflow({
      ...sequentialWorkflow,
      nodes: [...sequentialWorkflow.nodes, transformNode('extra')],
      edges: [
        edge('e1', 'normalize', 'extra'),
        edge('e1b', 'extra', 'analyse'),
        edge('e2', 'analyse', 'finish'),
      ],
    });
    assert.notEqual(base.digest, rewired.digest);
  });

  it('records reachable nodes, approval points, side effects and billable nodes', () => {
    const plan = planWorkflow(sequentialWorkflow);
    assert.deepEqual(
      plan.manifest.nodes.map((node) => node.nodeId),
      ['analyse', 'finish', 'normalize'],
    );
    assert.deepEqual(plan.manifest.billableNodeIds, ['analyse']);
    assert.deepEqual(plan.manifest.approvalNodeIds, []);
    assert.deepEqual(plan.manifest.sideEffectingNodeIds, []);
    assert.equal(plan.manifest.longestPathNodes, 3);
  });

  it('discovers approvals and side effects when they exist', () => {
    const plan = planWorkflow({
      ...sequentialWorkflow,
      nodes: [
        transformNode('normalize'),
        modelNode('analyse', { approval: workflowFixtureContracts.approval }),
        {
          ...workflowFixtureContracts.base('note', 'Record a note.'),
          nodeType: 'tool',
          toolId: DETERMINISTIC_TOOL_IDS.recordNote,
        } as WorkflowNode,
        completeNode(),
      ],
      edges: [
        edge('e1', 'normalize', 'analyse'),
        edge('e2', 'analyse', 'note'),
        edge('e3', 'note', 'finish'),
      ],
    });
    assert.deepEqual(plan.manifest.approvalNodeIds, ['analyse']);
    assert.deepEqual(plan.manifest.sideEffectingNodeIds, ['note']);
  });

  it('multiplies worst-case exposure by branch multiplicity', () => {
    const plan = planWorkflow(parallelAllWorkflow);
    const left = plan.nodesById.get('left_work');
    const right = plan.nodesById.get('right_work');
    assert.ok(left && right);
    // Each arm's node belongs to exactly one branch, so multiplicity is 1 — but the
    // planner must have found the membership rather than defaulting.
    assert.deepEqual(left.branchIds, ['left']);
    assert.deepEqual(right.branchIds, ['right']);
    assert.equal(plan.manifest.maxParallelism, 2);
    assert.equal(plan.manifest.maxBranchDepth, 1);
    assert.equal(plan.manifest.branches.length, 2);
    assert.equal(plan.manifest.joins.length, 1);
    assert.deepEqual(plan.manifest.joins[0].expectedBranchIds, ['left', 'right']);
  });

  it('counts every retry attempt in the worst-case step and retry figures', () => {
    const plan = planWorkflow({
      ...sequentialWorkflow,
      nodes: [
        transformNode('normalize'),
        modelNode('analyse', { retry: { maxAttempts: 3, backoffMs: 0 } }),
        completeNode(),
      ],
    });
    const analyse = plan.nodesById.get('analyse');
    assert.ok(analyse);
    assert.equal(analyse.maxAttempts, 4, 'three retries means four attempts');
    // normalize (1) + finish (1) + analyse (4)
    assert.equal(plan.manifest.worstCaseSteps, 6);
    assert.equal(plan.manifest.worstCaseRetries, 3);
  });

  it('prices worst-case tokens and cost from the routed profile', () => {
    const plan = planWorkflow(sequentialWorkflow, { price: priced });
    const analyse = sequentialWorkflow.nodes.find((node) => node.nodeId === 'analyse');
    assert.ok(analyse);
    const promptTokens = Math.ceil(analyse.tokenAllowance * 0.75);
    const completionTokens = analyse.tokenAllowance - promptTokens;
    assert.equal(plan.manifest.worstCasePromptTokens, promptTokens);
    assert.equal(plan.manifest.worstCaseCompletionTokens, completionTokens);
    assert.equal(plan.manifest.worstCaseTotalTokens, analyse.tokenAllowance);
    // The planner takes the LARGER of the declared allowance and the profile's
    // indicative price, so it can never under-report.
    assert.ok(
      plan.manifest.worstCaseCostMicroUsd >=
        priced(AGENT_MODEL_PROFILE.standard, promptTokens, completionTokens),
    );
  });

  it('refuses a plan whose worst case exceeds a platform bound', () => {
    // A graph of many high-allowance model nodes: each is individually legal and the
    // SUM is what the platform refuses.
    const nodes: WorkflowNode[] = [];
    const edges: WorkflowEdge[] = [];
    const count = 40;
    for (let index = 0; index < count; index += 1) {
      nodes.push(
        modelNode(`m${index}`, {
          tokenAllowance: 100_000,
          costAllowanceMicroUsd: 900_000,
          retry: { maxAttempts: 2, backoffMs: 0 },
        }),
      );
      edges.push(edge(`e${index}`, `m${index}`, index === count - 1 ? 'finish' : `m${index + 1}`));
    }
    nodes.push(completeNode());

    assert.throws(
      () =>
        planWorkflow({
          ...sequentialWorkflow,
          workflowId: 'workflow.test.enormous',
          initialNodeId: 'm0',
          nodes,
          edges,
          limits: { ...FIXTURE_LIMITS, maxTotalTokens: 1_200_000, maxPromptTokens: 800_000 },
        }),
      (error: unknown) => {
        assert.ok(isWorkflowError(error));
        assert.equal(error.failure, 'invalid_workflow_definition');
        assert.match(
          error.diagnostics ?? '',
          /worst-case (tokens|steps|cost)/,
          'the refusal must name which bound was crossed',
        );
        return true;
      },
    );
    assert.ok(PLATFORM_PLAN_BOUNDS.maxWorstCaseTokens < 40 * 3 * 100_000);
  });

  it('refuses a plan whose fan-out is wider than the definition permits', () => {
    const wide = fanOutWorkflow({ workflowId: 'workflow.test.too_wide', policy: 'all' });
    assert.throws(
      () => planWorkflow({ ...wide, limits: { ...FIXTURE_LIMITS, maxParallelBranches: 1 } }),
      (error: unknown) => {
        assert.ok(isWorkflowError(error));
        assert.match(error.diagnostics ?? '', /concurrent branches/);
        return true;
      },
    );
  });

  it('refuses a cyclic graph rather than hanging', () => {
    assert.throws(
      () =>
        planWorkflow({
          ...sequentialWorkflow,
          edges: [
            edge('e1', 'normalize', 'analyse'),
            edge('e2', 'analyse', 'normalize'),
          ],
        }),
      (error: unknown) => {
        assert.ok(isWorkflowError(error));
        assert.match(error.diagnostics ?? '', /cycle/);
        return true;
      },
    );
  });
});
