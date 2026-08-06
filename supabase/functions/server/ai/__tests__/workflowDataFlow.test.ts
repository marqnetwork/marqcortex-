/**
 * Workflow data flow, conditions, loops and durable checkpoints
 * (AI-01 Batch 3B, Part 3).
 *
 * Two kinds of test, deliberately split.
 *
 *   UNIT, against the evaluator, the mapper and the chain verifier directly.
 *   Every operator, every missing-value case, every gate of the mapper and
 *   every way a chain can be broken — exhaustively, deterministically, with no
 *   run in the way. A branch assertion is only meaningful if the value it
 *   branched on is one the test chose.
 *
 *   INTEGRATION, against the real engine over the real Batch 3A agent runtime.
 *   That a true branch is TAKEN, that a loop stops, that a checkpoint chain is
 *   written and verified, and that a second isolate resumes from it.
 *
 * The unit half proves the language; the integration half proves the engine
 * uses it. Neither on its own would.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { evaluateExpression, resolveRef } from '../workflows/runtime/expressionEvaluator.ts';
import type { EvaluationScope } from '../workflows/runtime/expressionEvaluator.ts';
import { applyMapping } from '../workflows/runtime/mapper.ts';
import { parsePath, readPath, writePath } from '../workflows/runtime/paths.ts';
import {
  computeCheckpointDigest,
  digestOutputs,
  verifyChain,
  verifyCheckpoint,
} from '../workflows/runtime/checkpointChain.ts';
import { validateExpression, validateMapping } from '../workflows/validation/expressionValidation.ts';
import { validateWorkflowDefinition } from '../workflows/validation/workflowValidation.ts';
import { planWorkflow } from '../workflows/planner/workflowPlanner.ts';
import { isConditionStep } from '../workflows/contracts/plan.ts';
import { isWorkflowError } from '../workflows/contracts/failures.ts';
import type { WorkflowExpression } from '../workflows/contracts/expression.ts';
import type { WorkflowCheckpoint } from '../workflows/contracts/checkpoint.ts';
import { object, str } from '../security/validation.ts';
import { AGENT_TOKEN } from './agentFixtures.ts';
import {
  PART3,
  PART3_AGENTS,
  buildPart3Runtime,
  conditionNode,
  edge,
  scoredOutput,
} from './workflowFixtures.ts';
import {
  createMemoryWorkflowCheckpointStore,
  createMemoryWorkflowRunStore,
} from '../workflows/persistence/ports.ts';
import {
  createMemoryAgentRunStore,
  createMemoryApprovalStore,
  createMemoryCheckpointStore,
} from '../agents/persistence/ports.ts';

// ── Scope helpers ───────────────────────────────────────────────────────────

function scope(overrides: Partial<EvaluationScope> = {}): EvaluationScope {
  return {
    input: { topic: 'readiness', threshold: 5, tags: ['a', 'b'], nested: { deep: { value: 7 } } },
    nodeOutputs: { score: { finding: 'f', score: 9, flag: true, nullish: null } },
    metadata: {
      workflowId: 'workflow.p3.branching',
      workflowVersion: '1.0.0',
      planDigest: 'abc',
      organizationId: 'acme',
      stepCount: 2,
      checkpointVersion: 2,
    },
    loopIterations: { tick: 3 },
    nodeVisits: { tick: 4 },
    stepsCompleted: 2,
    ...overrides,
  };
}

const nodeRef = (path: string) => ({ source: 'node' as const, nodeId: 'score', path });
const inputRef = (path: string) => ({ source: 'input' as const, path });
const lit = (value: string | number | boolean | null) => ({ source: 'literal' as const, value });

const evaluate = (expression: WorkflowExpression, overrides?: Partial<EvaluationScope>) =>
  evaluateExpression(expression, scope(overrides));

const references = { knownNodeIds: new Set(['score', 'gate']), ownerNodeId: 'gate' };

function failureOf(error: unknown): string {
  assert.ok(isWorkflowError(error), `expected a WorkflowError, got ${String(error)}`);
  return error.failure;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    assert.fail('expected the call to be refused');
  } catch (error) {
    return error;
  }
}

// ── Paths ───────────────────────────────────────────────────────────────────

describe('constrained value paths', () => {
  it('parses plain keys and array indices, and nothing else', () => {
    assert.deepEqual(parsePath('a.b.0.c'), { ok: true, segments: ['a', 'b', '0', 'c'] });
    for (const bad of ['$.a', 'a..b', 'a.*', 'a[0]', 'a..*.b', '..a', 'a.b[?(@.x)]', '']) {
      assert.equal(parsePath(bad).ok, false, `"${bad}" must not parse`);
    }
  });

  it('refuses the prototype segments in both directions', () => {
    for (const segment of ['__proto__', 'prototype', 'constructor']) {
      const parsed = parsePath(`a.${segment}`);
      assert.equal(parsed.ok, false, segment);
      assert.match(String(parsed.ok === false && parsed.problem), /not addressable/);
    }
  });

  it('distinguishes a missing field from one holding undefined', () => {
    assert.deepEqual(readPath({ a: 1 }, ['b']), { found: false, value: undefined });
    assert.deepEqual(readPath({ a: undefined }, ['a']), { found: true, value: undefined });
  });

  it('reads own properties only, never an inherited one', () => {
    const polluted = Object.create({ inherited: 'from the prototype' }) as Record<string, unknown>;
    polluted.own = 'mine';
    assert.deepEqual(readPath(polluted, ['own']), { found: true, value: 'mine' });
    assert.equal(readPath(polluted, ['inherited']).found, false);
  });

  it('never mutates the tree it writes into', () => {
    const original = { keep: 1, nest: { a: 1 } };
    const written = writePath(original, ['nest', 'b'], 2);
    assert.deepEqual(original, { keep: 1, nest: { a: 1 } }, 'the source is untouched');
    assert.deepEqual(written, { keep: 1, nest: { a: 1, b: 2 } });
  });
});

// ── The expression language ─────────────────────────────────────────────────

describe('expression evaluator — every operator', () => {
  it('equals and not_equals compare scalars without coercion', () => {
    assert.equal(evaluate({ op: 'equals', left: nodeRef('score'), right: lit(9) }), true);
    assert.equal(evaluate({ op: 'equals', left: nodeRef('score'), right: lit('9') }), false);
    assert.equal(evaluate({ op: 'not_equals', left: nodeRef('score'), right: lit(8) }), true);
    assert.equal(evaluate({ op: 'not_equals', left: nodeRef('score'), right: lit(9) }), false);
  });

  it('exists and not_exists answer presence, treating null as absent', () => {
    assert.equal(evaluate({ op: 'exists', ref: nodeRef('finding') }), true);
    assert.equal(evaluate({ op: 'exists', ref: nodeRef('missing') }), false);
    assert.equal(evaluate({ op: 'not_exists', ref: nodeRef('missing') }), true);
    assert.equal(evaluate({ op: 'exists', ref: nodeRef('nullish') }), false);
  });

  it('orders numbers and strings, and refuses a mixed pair', () => {
    assert.equal(evaluate({ op: 'greater_than', left: nodeRef('score'), right: lit(5) }), true);
    assert.equal(evaluate({ op: 'greater_than', left: nodeRef('score'), right: lit(9) }), false);
    assert.equal(
      evaluate({ op: 'greater_than_or_equal', left: nodeRef('score'), right: lit(9) }),
      true,
    );
    assert.equal(evaluate({ op: 'less_than', left: nodeRef('score'), right: lit(10) }), true);
    assert.equal(evaluate({ op: 'less_than', left: nodeRef('score'), right: lit(9) }), false);
    assert.equal(
      evaluate({ op: 'less_than_or_equal', left: nodeRef('score'), right: lit(9) }),
      true,
    );
    assert.equal(evaluate({ op: 'greater_than', left: inputRef('topic'), right: lit('a') }), true);
    // A type mismatch satisfies nothing — it is data being wrong, not an error.
    assert.equal(evaluate({ op: 'greater_than', left: inputRef('topic'), right: lit(3) }), false);
  });

  it('contains works over strings and arrays and nothing else', () => {
    assert.equal(evaluate({ op: 'contains', left: inputRef('topic'), right: lit('read') }), true);
    assert.equal(evaluate({ op: 'contains', left: inputRef('topic'), right: lit('zzz') }), false);
    assert.equal(evaluate({ op: 'contains', left: inputRef('tags'), right: lit('b') }), true);
    assert.equal(evaluate({ op: 'contains', left: inputRef('tags'), right: lit('z') }), false);
    // An object "containing" something would mean key presence, which `exists`
    // already says more clearly.
    assert.equal(evaluate({ op: 'contains', left: inputRef('nested'), right: lit('deep') }), false);
  });

  it('and, or and not compose, including nested boolean trees', () => {
    const high: WorkflowExpression = { op: 'greater_than', left: nodeRef('score'), right: lit(5) };
    const named: WorkflowExpression = { op: 'exists', ref: nodeRef('finding') };
    const absent: WorkflowExpression = { op: 'exists', ref: nodeRef('missing') };

    assert.equal(evaluate({ op: 'and', operands: [high, named] }), true);
    assert.equal(evaluate({ op: 'and', operands: [high, absent] }), false);
    assert.equal(evaluate({ op: 'or', operands: [absent, high] }), true);
    assert.equal(evaluate({ op: 'or', operands: [absent, { op: 'not', operand: high }] }), false);
    assert.equal(evaluate({ op: 'not', operand: absent }), true);

    // Three levels: not(or(and(high, named), absent))
    assert.equal(
      evaluate({
        op: 'not',
        operand: { op: 'or', operands: [{ op: 'and', operands: [high, named] }, absent] },
      }),
      false,
    );
  });

  it('reads metadata and counters', () => {
    assert.equal(
      evaluate({
        op: 'equals',
        left: { source: 'metadata', field: 'organizationId' },
        right: lit('acme'),
      }),
      true,
    );
    assert.equal(
      evaluate({
        op: 'equals',
        left: { source: 'counter', counter: 'node_visits', nodeId: 'tick' },
        right: lit(4),
      }),
      true,
    );
    assert.equal(
      evaluate({
        op: 'equals',
        left: { source: 'counter', counter: 'loop_iterations', nodeId: 'tick' },
        right: lit(3),
      }),
      true,
    );
    assert.equal(
      evaluate({
        op: 'equals',
        left: { source: 'counter', counter: 'steps_completed' },
        right: lit(2),
      }),
      true,
    );
    // A counter for a node that has never run reads zero, not absent — a count
    // of nothing is a number.
    assert.equal(
      evaluate({
        op: 'equals',
        left: { source: 'counter', counter: 'node_visits', nodeId: 'never' },
        right: lit(0),
      }),
      true,
    );
  });

  it('makes an absent operand satisfy NO comparison, including not_equals', () => {
    // THE missing-value rule. `not_equals` reading "absent ≠ 5" as true is how a
    // renamed field silently sends every run down the exceptional branch.
    for (const op of [
      'equals',
      'not_equals',
      'greater_than',
      'greater_than_or_equal',
      'less_than',
      'less_than_or_equal',
      'contains',
    ] as const) {
      assert.equal(
        evaluate({ op, left: nodeRef('missing'), right: lit(5) }),
        false,
        `${op} with an absent left operand must be false`,
      );
      assert.equal(
        evaluate({ op, left: lit(5), right: nodeRef('missing') }),
        false,
        `${op} with an absent right operand must be false`,
      );
    }
    // The author who wants "missing or different" writes exactly that.
    assert.equal(
      evaluate({
        op: 'or',
        operands: [
          { op: 'not_exists', ref: nodeRef('missing') },
          { op: 'not_equals', left: nodeRef('missing'), right: lit(5) },
        ],
      }),
      true,
    );
  });

  it('treats an output from a node that has not run as absent, not as an error', () => {
    const empty = scope({ nodeOutputs: {} });
    assert.equal(evaluateExpression({ op: 'exists', ref: nodeRef('score') }, empty), false);
    assert.equal(
      evaluateExpression({ op: 'greater_than', left: nodeRef('score'), right: lit(0) }, empty),
      false,
    );
  });

  it('resolves `result` only where a result was supplied', () => {
    const withResult = scope({ result: { finding: 'raw' } });
    assert.deepEqual(resolveRef({ source: 'result', path: 'finding' }, withResult), {
      found: true,
      value: 'raw',
    });
    assert.equal(resolveRef({ source: 'result', path: 'finding' }, scope()).found, false);
  });
});

describe('expression validation', () => {
  it('accepts the fixture condition', () => {
    assert.deepEqual(
      validateExpression(
        { op: 'greater_than', left: nodeRef('score'), right: inputRef('threshold') },
        references,
        'gate',
      ),
      [],
    );
  });

  it('refuses an operator outside the closed vocabulary', () => {
    const problems = validateExpression(
      { op: 'matches_regex', left: nodeRef('score'), right: lit('.*') },
      references,
      'gate',
    );
    assert.ok(problems.some((problem) => /is not one of the supported operators/.test(problem)));
  });

  it('refuses a malformed expression rather than evaluating it', () => {
    assert.ok(validateExpression(undefined, references, 'gate').length > 0);
    assert.ok(validateExpression({ left: nodeRef('score') }, references, 'gate').length > 0);
    assert.ok(validateExpression({ op: 'and', operands: [] }, references, 'gate').length > 0);
    assert.ok(validateExpression({ op: 'and', operands: {} }, references, 'gate').length > 0);
    assert.ok(validateExpression({ op: 'not' }, references, 'gate').length > 0);
  });

  it('refuses a reference to an unknown node and to its own output', () => {
    assert.ok(
      validateExpression(
        { op: 'exists', ref: { source: 'node', nodeId: 'ghost', path: 'x' } },
        references,
        'gate',
      ).some((problem) => /references unknown node ghost/.test(problem)),
    );
    assert.ok(
      validateExpression(
        { op: 'exists', ref: { source: 'node', nodeId: 'gate', path: 'x' } },
        references,
        'gate',
      ).some((problem) => /may not reference its own output/.test(problem)),
    );
  });

  it('refuses a source outside the readable set', () => {
    for (const source of ['env', 'settings', 'globalThis', 'process']) {
      const problems = validateExpression(
        { op: 'exists', ref: { source, path: 'x' } },
        references,
        'gate',
      );
      assert.ok(problems.some((problem) => /is not a readable source/.test(problem)), source);
    }
    // `result` is real but not readable from a condition.
    assert.ok(
      validateExpression(
        { op: 'exists', ref: { source: 'result', path: 'x' } },
        references,
        'gate',
      ).some((problem) => /may only be read by an output mapping/.test(problem)),
    );
  });

  it('refuses two literals that can never be compared', () => {
    assert.ok(
      validateExpression(
        { op: 'greater_than', left: lit('yes'), right: lit(3) },
        references,
        'gate',
      ).some((problem) => /not both numbers or both strings/.test(problem)),
    );
  });

  it('bounds nesting and operand count', () => {
    let deep: WorkflowExpression = { op: 'exists', ref: nodeRef('score') };
    for (let i = 0; i < 12; i += 1) deep = { op: 'not', operand: deep };
    assert.ok(
      validateExpression(deep, references, 'gate').some((problem) => /nested deeper/.test(problem)),
    );

    const wide = {
      op: 'and',
      operands: Array.from({ length: 20 }, () => ({ op: 'exists', ref: nodeRef('score') })),
    };
    assert.ok(
      validateExpression(wide, references, 'gate').some((problem) => /operands/.test(problem)),
    );
  });
});

// ── Mapping ─────────────────────────────────────────────────────────────────

describe('mapper', () => {
  const contract = object({ note: str({ maxLength: 500 }) });

  it('maps deterministically, producing the same value every time', () => {
    const mapping = {
      assignments: [
        { to: 'note', from: nodeRef('finding'), required: true },
      ],
    };
    const first = applyMapping(mapping, scope(), contract);
    const second = applyMapping(mapping, scope(), contract);
    assert.deepEqual(first, { ok: true, value: { note: 'f' } });
    assert.deepEqual(first, second);
  });

  it('builds nested destinations without touching the source', () => {
    const outputs = { score: { finding: 'f', score: 9 } };
    const outcome = applyMapping(
      {
        assignments: [
          { to: 'a.b.c', from: nodeRef('score'), required: true },
          { to: 'a.b.d', from: lit('x'), required: true },
        ],
      },
      scope({ nodeOutputs: outputs }),
      undefined,
    );
    assert.deepEqual(outcome, { ok: true, value: { a: { b: { c: 9, d: 'x' } } } });
    assert.deepEqual(outputs, { score: { finding: 'f', score: 9 } });
  });

  it('fails closed when a required source is missing', () => {
    const outcome = applyMapping(
      { assignments: [{ to: 'note', from: nodeRef('absent'), required: true }] },
      scope(),
      contract,
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.failure, 'missing_required_source');
    // The diagnostic names the LOCATION, never a value.
    assert.match(String(outcome.ok === false && outcome.detail), /node score\.absent/);
  });

  it('writes nothing — not null — for an optional source that is missing', () => {
    const outcome = applyMapping(
      {
        assignments: [
          { to: 'note', from: nodeRef('finding'), required: true },
          { to: 'extra', from: nodeRef('absent'), required: false },
        ],
      },
      scope(),
      undefined,
    );
    assert.deepEqual(outcome, { ok: true, value: { note: 'f' } });
    assert.equal(outcome.ok === true && 'extra' in (outcome.value as object), false);
  });

  it('rejects a result the target contract refuses', () => {
    const outcome = applyMapping(
      { assignments: [{ to: 'note', from: nodeRef('score'), required: true }] },
      scope(),
      contract,
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.failure, 'contract_rejected');
  });

  it('drops a field the contract does not declare, so nothing unnamed can flow', () => {
    const outcome = applyMapping(
      {
        assignments: [
          { to: 'note', from: nodeRef('finding'), required: true },
          { to: 'secret', from: nodeRef('score'), required: true },
        ],
      },
      scope(),
      contract,
    );
    assert.deepEqual(outcome, { ok: true, value: { note: 'f' } });
  });

  it('rejects an oversized mapped payload', () => {
    const huge = 'x'.repeat(40_000);
    const outcome = applyMapping(
      { assignments: [{ to: 'note', from: nodeRef('big'), required: true }] },
      scope({ nodeOutputs: { score: { big: huge } } }),
      undefined,
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.failure, 'result_too_large');
  });
});

describe('mapping validation', () => {
  it('refuses an invalid destination path', () => {
    for (const to of ['$.note', 'a..b', 'a.*', '__proto__.polluted', '']) {
      const problems = validateMapping(
        { assignments: [{ to, from: nodeRef('finding'), required: true }] },
        references,
        'm',
      );
      assert.ok(problems.length > 0, `"${to}" must be refused`);
    }
  });

  it('refuses an array-indexed destination', () => {
    assert.ok(
      validateMapping(
        { assignments: [{ to: 'items.0', from: nodeRef('finding'), required: true }] },
        references,
        'm',
      ).some((problem) => /indexes an array/.test(problem)),
    );
  });

  it('refuses two assignments to one destination', () => {
    assert.ok(
      validateMapping(
        {
          assignments: [
            { to: 'note', from: nodeRef('finding'), required: true },
            { to: 'note', from: lit('other'), required: true },
          ],
        },
        references,
        'm',
      ).some((problem) => /assigned twice/.test(problem)),
    );
  });

  it('requires `required` to be declared explicitly', () => {
    assert.ok(
      validateMapping(
        { assignments: [{ to: 'note', from: nodeRef('finding') }] },
        references,
        'm',
      ).some((problem) => /required must be declared explicitly/.test(problem)),
    );
  });
});

// ── Condition nodes in a definition ─────────────────────────────────────────

describe('condition nodes and branching graphs', () => {
  const planned = () => planWorkflow(PART3.branching);

  it('plans a branching workflow with both targets recorded', () => {
    const result = planned();
    assert.ok(result.ok);
    const gate = result.plan.steps.find((step) => step.nodeId === 'gate');
    assert.ok(gate && isConditionStep(gate));
    assert.equal(gate.trueNodeId, 'high');
    assert.equal(gate.falseNodeId, 'low');
    assert.equal(result.plan.metadata.conditionNodeCount, 1);
    assert.deepEqual(result.plan.metadata.terminalNodeIds, ['high', 'low']);
  });

  it('refuses a condition node without exactly one true and one false edge', () => {
    const base = PART3.branching;
    const oneSided = {
      ...base,
      edges: [edge('score', 'gate'), { from: 'gate', to: 'high', when: true }],
    };
    assert.ok(
      validateWorkflowDefinition(oneSided).some((problem) =>
        /exactly one true edge and one false edge/.test(problem),
      ),
    );

    const unlabelled = {
      ...base,
      edges: [edge('score', 'gate'), edge('gate', 'high'), edge('gate', 'low')],
    };
    assert.ok(
      validateWorkflowDefinition(unlabelled).some((problem) =>
        /must declare when: true or when: false/.test(problem),
      ),
    );
  });

  it('moves the plan digest when a condition operator changes', () => {
    const before = planned();
    const after = planWorkflow({
      ...PART3.branching,
      nodes: PART3.branching.nodes.map((entry) =>
        entry.nodeId === 'gate'
          ? conditionNode('gate', {
              op: 'greater_than_or_equal',
              left: { source: 'node', nodeId: 'score', path: 'score' },
              right: { source: 'input', path: 'threshold' },
            })
          : entry,
      ),
    });
    assert.ok(before.ok && after.ok);
    assert.notEqual(before.plan.digest, after.plan.digest);
  });

  it('moves the plan digest when a mapping changes', () => {
    const before = planWorkflow(PART3.mapped);
    const after = planWorkflow({
      ...PART3.mapped,
      nodes: PART3.mapped.nodes.map((entry) =>
        entry.nodeId === 'record'
          ? {
              ...entry,
              inputMapping: {
                assignments: [
                  {
                    to: 'note',
                    from: { source: 'node' as const, nodeId: 'score', path: 'finding' },
                    required: false,
                  },
                ],
              },
            }
          : entry,
      ),
    });
    assert.ok(before.ok && after.ok);
    assert.notEqual(before.plan.digest, after.plan.digest);
  });
});

describe('bounded loops in a definition', () => {
  it('plans a declared loop with its ceiling and body', () => {
    const result = planWorkflow(PART3.loop);
    assert.ok(result.ok);
    const tick = result.plan.steps.find((step) => step.nodeId === 'tick');
    assert.equal(tick?.loop?.maxIterations, 4);
    assert.equal(tick?.loop?.fromNodeId, 'gate');
    assert.deepEqual(tick?.loop?.bodyNodeIds, ['gate', 'tick']);
    assert.equal(result.plan.metadata.loopCount, 1);
  });

  it('refuses a loop bound outside the permitted range', () => {
    for (const maxIterations of [0, 99, 1.5]) {
      const problems = validateWorkflowDefinition({
        ...PART3.loop,
        edges: PART3.loop.edges.map((entry) =>
          entry.loop ? { ...entry, loop: { maxIterations } } : entry,
        ),
      });
      assert.ok(problems.length > 0, `maxIterations ${maxIterations} must be refused`);
    }
  });

  it('refuses a loop whose body has no way out', () => {
    // tick -> gate, and BOTH of gate's branches stay inside the loop. Bounded,
    // and able to end only by exhaustion, which is not an exit.
    const trapped = {
      ...PART3.loop,
      edges: [
        edge('tick', 'gate'),
        { from: 'gate', to: 'tick', when: true, loop: { maxIterations: 2 } },
        { from: 'gate', to: 'tick', when: false },
      ],
    };
    const result = planWorkflow(trapped);
    assert.equal(result.ok, false);
  });

  it('refuses a loop bound on an edge that closes no cycle', () => {
    const decorative = {
      ...PART3.mapped,
      edges: [{ from: 'score', to: 'record', loop: { maxIterations: 3 } }],
    };
    const result = planWorkflow(decorative);
    assert.equal(result.ok, false);
    assert.ok(
      !result.ok && result.problems.some((problem) => /does not close a cycle/.test(problem)),
    );
  });
});

// ── Checkpoint chain ────────────────────────────────────────────────────────

describe('checkpoint chain', () => {
  function link(
    version: number,
    previous?: WorkflowCheckpoint,
    variant = '',
  ): WorkflowCheckpoint {
    const body = {
      workflowRunId: 'wfr_1',
      organizationId: 'acme',
      version,
      createdAt: '2026-01-01T00:00:00.000Z',
      state: 'running' as const,
      nodeId: `n${version}${variant}`,
      stepCount: version,
      cursorNodeId: `n${version + 1}`,
      outputs: { [`n${version}`]: { value: version } },
      outputsDigest: '',
      loopIterations: {},
      nodeVisits: {},
      ...(previous === undefined ? {} : { previousDigest: previous.digest }),
    };
    // Built with the production helpers, so a link this test calls well-formed
    // is well-formed by the same rule the engine writes by.
    const withOutputs = { ...body, outputsDigest: digestOutputs(body.outputs) };
    return { ...withOutputs, digest: computeCheckpointDigest(withOutputs) };
  }

  it('verifies a well-formed chain', () => {
    const one = link(1);
    const two = link(2, one);
    const three = link(3, two);
    assert.deepEqual(verifyChain([one, two, three]), { ok: true });
  });

  it('detects an edited checkpoint', () => {
    const one = link(1);
    const tampered = { ...one, stepCount: 99 };
    const verdict = verifyCheckpoint(tampered, undefined);
    assert.equal(verdict.ok, false);
    assert.match(String(!verdict.ok && verdict.problem), /digest does not match content/);
  });

  it('detects edited outputs even when the self-digest is recomputed', () => {
    const one = link(1);
    const swapped = { ...one, outputs: { n1: { value: 'different' } } };
    const verdict = verifyCheckpoint(swapped, undefined);
    assert.equal(verdict.ok, false);
    assert.match(String(!verdict.ok && verdict.problem), /outputs do not match outputsDigest/);
  });

  it('detects a broken chain link', () => {
    const one = link(1);
    // A DIFFERENT version-1 checkpoint: same position in the chain, different
    // content, therefore a different digest.
    const other = link(1, undefined, '_alt');
    assert.notEqual(one.digest, other.digest);

    const two = link(2, one);
    // `spliced` is internally consistent — its own digest is correct — and it
    // chains to the wrong predecessor. Only the link check can catch it.
    const spliced = link(2, other);
    assert.deepEqual(verifyCheckpoint(spliced, other), { ok: true });

    assert.deepEqual(verifyCheckpoint(two, one), { ok: true });
    const verdict = verifyCheckpoint(spliced, one);
    assert.equal(verdict.ok, false);
    assert.match(String(!verdict.ok && verdict.problem), /chain link does not match/);
  });

  it('catches a rewrite in the middle of a chain, not just at the tip', () => {
    // The whole point of walking the chain: a rewritten link three with links
    // four onwards re-chained leaves a tip that verifies against its neighbour.
    const one = link(1);
    const two = link(2, one);
    const rewritten = { ...two, nodeId: 'edited' };
    const three = link(3, rewritten);
    const verdict = verifyChain([one, rewritten, three]);
    assert.equal(verdict.ok, false);
  });
});

// ── The engine ──────────────────────────────────────────────────────────────

const INPUT = { topic: 'quarterly readiness', threshold: 5, rounds: 2 };

describe('workflow engine — conditions', () => {
  it('takes the true branch when the condition holds', async () => {
    const harness = buildPart3Runtime();
    // topic length 19 > threshold 5.
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART3.branching.workflowId,
      input: INPUT,
    });

    assert.equal(detail.state, 'completed');
    assert.deepEqual(
      detail.steps.map((step) => step.nodeId),
      ['score', 'gate', 'high'],
    );
    const gate = detail.steps[1];
    assert.equal(gate.kind, 'condition');
    assert.equal(gate.branchTaken, true);
    assert.equal(gate.branchNodeId, 'high');
    assert.equal(gate.childAgentRunId, undefined, 'a condition runs no agent');
    assert.equal(detail.childAgentRunIds.length, 2, 'only the two agent nodes ran');
  });

  it('takes the false branch when it does not', async () => {
    const harness = buildPart3Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART3.branching.workflowId,
      input: { ...INPUT, threshold: 500 },
    });

    assert.equal(detail.state, 'completed');
    assert.deepEqual(
      detail.steps.map((step) => step.nodeId),
      ['score', 'gate', 'low'],
    );
    assert.equal(detail.steps[1].branchTaken, false);
  });

  it('records which branch was taken without recording what it branched on', async () => {
    const harness = buildPart3Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART3.branching.workflowId,
      input: INPUT,
    });

    const serialized = JSON.stringify(detail);
    assert.equal(serialized.includes('quarterly readiness'), false, 'no raw input in the read model');
    assert.equal(serialized.includes('scored '), false, 'no raw node output in the read model');
    // What IS there: the decision and a digest.
    assert.equal(detail.steps[1].branchTaken, true);
    assert.match(String(detail.steps[0].resultDigest), /^[0-9a-f]{32}$/);
  });
});

describe('workflow engine — mappings', () => {
  it('maps one node output into the next node input', async () => {
    const harness = buildPart3Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART3.mapped.workflowId,
      input: INPUT,
    });

    assert.equal(detail.state, 'completed');
    assert.equal(detail.steps.length, 2);

    // The recorder's contract takes `{ note }` and the workflow input has no
    // such field, so it can only have run if the mapping delivered it.
    const child = await harness.agentRuntime.runtime.runs.load(
      'acme',
      detail.childAgentRunIds[1],
    );
    assert.equal(child?.state, 'completed');

    const checkpoint = await harness.checkpointStore.latest('acme', detail.workflowRunId);
    assert.deepEqual(checkpoint?.outputs.record, {
      finding: 'recorded: scored quarterly readiness',
    });
  });

  it('fails the run when a required source is missing', async () => {
    const harness = buildPart3Runtime({
      workflows: [
        {
          ...PART3.mapped,
          workflowId: 'workflow.p3.mapped_missing',
          nodes: PART3.mapped.nodes.map((entry) =>
            entry.nodeId === 'record'
              ? {
                  ...entry,
                  inputMapping: {
                    assignments: [
                      {
                        to: 'note',
                        from: { source: 'node' as const, nodeId: 'score', path: 'absent' },
                        required: true,
                      },
                    ],
                  },
                }
              : entry,
          ),
        },
      ],
    });

    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: 'workflow.p3.mapped_missing',
      input: INPUT,
    });
    assert.equal(detail.state, 'failed');
    assert.equal(detail.failure, 'workflow_mapping_failed');
    assert.equal(detail.childAgentRunIds.length, 1, 'the second node never started');
  });
});

describe('workflow engine — bounded loops', () => {
  it('loops until the exit condition holds, then leaves', async () => {
    const harness = buildPart3Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART3.loop.workflowId,
      input: { ...INPUT, rounds: 2 },
    });

    assert.equal(detail.state, 'completed');
    assert.deepEqual(
      detail.steps.map((step) => step.nodeId),
      ['tick', 'gate', 'tick', 'gate', 'done'],
    );
    // The second visit of `tick` is recorded as iteration 2 of that node.
    assert.deepEqual(
      detail.steps.filter((step) => step.nodeId === 'tick').map((step) => step.iteration),
      [1, 2],
    );

    const checkpoint = await harness.checkpointStore.latest('acme', detail.workflowRunId);
    assert.equal(checkpoint?.loopIterations.tick, 1, 'the back edge was taken once');
    assert.equal(checkpoint?.nodeVisits.tick, 2);
  });

  it('exits immediately when the condition already holds', async () => {
    const harness = buildPart3Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART3.loop.workflowId,
      input: { ...INPUT, rounds: 1 },
    });
    assert.equal(detail.state, 'completed');
    assert.deepEqual(
      detail.steps.map((step) => step.nodeId),
      ['tick', 'gate', 'done'],
    );
  });

  it('stops with a typed failure when a loop is exhausted', async () => {
    const harness = buildPart3Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART3.loopExhausted.workflowId,
      input: INPUT,
    });

    assert.equal(detail.state, 'failed');
    assert.equal(detail.failure, 'workflow_loop_exhausted');
    // Exhaustion is a FAILURE, not a completion: the exit condition never held.
    assert.equal(
      detail.steps.filter((step) => step.nodeId === 'tick').length,
      3,
      'the ceiling of 2 back edges permits three passes through the body',
    );
  });
});

describe('workflow engine — durable checkpoints', () => {
  it('writes one chained checkpoint per node execution', async () => {
    const harness = buildPart3Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART3.branching.workflowId,
      input: INPUT,
    });

    const history = await harness.checkpointStore.history('acme', detail.workflowRunId);
    assert.equal(history.length, 3, 'score, gate and high each produced one');
    assert.deepEqual(
      history.map((entry) => [entry.version, entry.nodeId]),
      [
        [1, 'score'],
        [2, 'gate'],
        [3, 'high'],
      ],
    );
    assert.equal(history[0].previousDigest, undefined);
    assert.equal(history[1].previousDigest, history[0].digest);
    assert.equal(history[2].previousDigest, history[1].digest);
    assert.deepEqual(verifyChain(history), { ok: true });

    // The run record points at the tip by version AND digest.
    assert.equal(detail.checkpointVersion, 3);
    const stored = await harness.runStore.load('acme', detail.workflowRunId);
    assert.equal(stored?.checkpointDigest, history[2].digest);
  });

  it('accumulates trusted outputs and never exposes them', async () => {
    const harness = buildPart3Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART3.branching.workflowId,
      input: INPUT,
    });

    const tip = await harness.checkpointStore.latest('acme', detail.workflowRunId);
    assert.deepEqual(Object.keys(tip?.outputs ?? {}).sort(), ['high', 'score']);
    assert.equal((tip?.outputs.score as { score: number }).score, 19);
    // The read model carries none of it.
    assert.equal('outputs' in detail, false);
  });

  it('refuses to rewrite a written checkpoint', async () => {
    const harness = buildPart3Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART3.branching.workflowId,
      input: INPUT,
    });
    const existing = await harness.checkpointStore.read('acme', detail.workflowRunId, 2);
    assert.ok(existing);

    const error = await rejection(
      harness.checkpointStore.write({ ...existing, nodeId: 'rewritten' }),
    );
    assert.equal(failureOf(error), 'workflow_checkpoint_conflict');

    // And the stored one is untouched.
    const reread = await harness.checkpointStore.read('acme', detail.workflowRunId, 2);
    assert.equal(reread?.nodeId, 'gate');
  });

  it('scopes checkpoints to a tenant', async () => {
    const harness = buildPart3Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART3.branching.workflowId,
      input: INPUT,
    });

    assert.deepEqual(await harness.checkpointStore.history('globex', detail.workflowRunId), []);
    assert.equal(await harness.checkpointStore.latest('globex', detail.workflowRunId), undefined);
    assert.equal(await harness.checkpointStore.read('globex', detail.workflowRunId, 1), undefined);
  });
});

describe('workflow engine — recovery', () => {
  it('resumes a loop from the durable checkpoint in a second runtime', async () => {
    const runStore = createMemoryWorkflowRunStore();
    const checkpointStore = createMemoryWorkflowCheckpointStore();
    // The AGENT stores are shared too. Recovery drives the same child agent run
    // the crashed isolate created, so the second runtime has to be able to see
    // it — sharing only the workflow stores would test a different thing.
    const agentRunStore = createMemoryAgentRunStore();
    const agentCheckpointStore = createMemoryCheckpointStore();
    const agentApprovalStore = createMemoryApprovalStore();

    const first = buildPart3Runtime({
      runStore,
      checkpointStore,
      agentRunStore,
      agentCheckpointStore,
      agentApprovalStore,
      wrapAgentPort: (port) => {
        let drives = 0;
        return {
          create: (input) => port.create(input),
          drive: (input) => {
            // Die partway through the loop, after state has been checkpointed.
            drives += 1;
            return drives > 2
              ? Promise.reject(new Error('isolate recycled'))
              : port.drive(input);
          },
          cancel: (input) => port.cancel(input),
        };
      },
    });

    const created = await first.workflows.service.createRun({
      ...first.meta(AGENT_TOKEN.consultant),
      workflowId: PART3.loop.workflowId,
      input: { ...INPUT, rounds: 3 },
    });
    await assert.rejects(
      first.workflows.service.advanceRun({
        ...first.meta(AGENT_TOKEN.consultant),
        workflowRunId: created.workflowRunId,
      }),
      /isolate recycled/,
    );

    const crashed = await runStore.load('acme', created.workflowRunId);
    assert.ok((crashed?.checkpointVersion ?? 0) > 0, 'progress was checkpointed before the crash');
    const before = await checkpointStore.latest('acme', created.workflowRunId);

    // A fresh runtime sharing only what was written down.
    const second = buildPart3Runtime({
      runStore,
      checkpointStore,
      agentRunStore,
      agentCheckpointStore,
      agentApprovalStore,
    });
    const recovered = await second.workflows.service.advanceRun({
      ...second.meta(AGENT_TOKEN.consultant),
      workflowRunId: created.workflowRunId,
    });

    assert.equal(recovered.state, 'completed');
    const history = await checkpointStore.history('acme', created.workflowRunId);
    assert.deepEqual(verifyChain(history), { ok: true }, 'the chain survived the restart');
    assert.equal(
      history[(before?.version ?? 1) - 1].digest,
      before?.digest,
      'the pre-crash checkpoints were not rewritten',
    );
    assert.deepEqual(
      recovered.steps.map((step) => step.nodeId),
      ['tick', 'gate', 'tick', 'gate', 'tick', 'gate', 'done'],
    );
  });

  it('refuses to resume from a corrupted checkpoint', async () => {
    const runStore = createMemoryWorkflowRunStore();
    const checkpointStore = createMemoryWorkflowCheckpointStore();
    const harness = buildPart3Runtime({ runStore, checkpointStore });

    const blocked = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART3.loop.workflowId,
      input: { ...INPUT, rounds: 3 },
    });
    // Completed in one advance; re-advance is a no-op. Corrupt a mid-chain link
    // and start a NEW run over the same, now-untrustworthy store.
    const second = await harness.workflows.service.createRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART3.loop.workflowId,
      input: { ...INPUT, rounds: 3 },
    });
    void blocked;

    await harness.workflows.service.advanceRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: second.workflowRunId,
    });

    const history = await checkpointStore.history('acme', second.workflowRunId);
    assert.ok(history.length >= 2);
    // The one thing the contract forbids: rewrite a written checkpoint.
    checkpointStore.poke('acme', second.workflowRunId, {
      ...history[0],
      outputs: { tick: { finding: 'tampered' } },
    });

    const stored = await runStore.load('acme', second.workflowRunId);
    assert.ok(stored);
    // Re-open the run by resetting it to a non-terminal state so recovery runs.
    await runStore.save(
      { ...stored, runVersion: stored.runVersion + 1, state: 'running', endedAt: undefined },
      stored.runVersion,
    );

    const detail = await harness.workflows.service.advanceRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: second.workflowRunId,
    });
    assert.equal(detail.state, 'failed');
    assert.equal(detail.failure, 'workflow_checkpoint_corrupt');
  });
});

// ── No arbitrary code execution ─────────────────────────────────────────────

describe('the expression language executes no code', () => {
  const MODULES = [
    'supabase/functions/server/ai/workflows/runtime/expressionEvaluator.ts',
    'supabase/functions/server/ai/workflows/runtime/mapper.ts',
    'supabase/functions/server/ai/workflows/runtime/paths.ts',
    'supabase/functions/server/ai/workflows/validation/expressionValidation.ts',
  ];

  it('contains no eval, Function constructor or dynamic import', () => {
    // A behavioural test cannot prove the ABSENCE of a code path. This can.
    const FORBIDDEN = /\beval\s*\(|new\s+Function\s*\(|\bFunction\s*\(|setTimeout\s*\(\s*['"`]/;
    for (const path of MODULES) {
      const text = readFileSync(path, 'utf8');
      assert.equal(FORBIDDEN.test(text), false, `${path} must contain no code-execution primitive`);
    }
  });

  it('cannot be made to run a function supplied as data', () => {
    let called = false;
    const hostile = {
      toString: () => {
        called = true;
        return 'x';
      },
      valueOf: () => {
        called = true;
        return 1;
      },
    };
    // Comparisons are scalar-only and use `===`, so neither coercion hook runs.
    assert.equal(
      evaluate({ op: 'equals', left: nodeRef('hostile'), right: lit(1) }, {
        nodeOutputs: { score: { hostile } },
      }),
      false,
    );
    assert.equal(
      evaluate({ op: 'greater_than', left: nodeRef('hostile'), right: lit(0) }, {
        nodeOutputs: { score: { hostile } },
      }),
      false,
    );
    assert.equal(called, false, 'no coercion hook on caller data may be invoked');
  });

  it('cannot pollute Object.prototype through a mapping destination', () => {
    const problems = validateMapping(
      { assignments: [{ to: '__proto__.polluted', from: lit(true), required: true }] },
      references,
      'm',
    );
    assert.ok(problems.length > 0);
    assert.equal(
      ({} as Record<string, unknown>).polluted,
      undefined,
      'Object.prototype must be untouched',
    );
  });
});

describe('the workflow tree reaches no provider or tool', () => {
  it('registers agents only through the Part 3 fixture set', () => {
    // A guard on the fixtures themselves: a node agent that acquired a tool or
    // a model profile would make every data-flow assertion above a statement
    // about a model rather than about the engine.
    for (const agent of PART3_AGENTS) {
      assert.deepEqual(agent.allowedTools, [], `${agent.agentId} must declare no tools`);
      assert.deepEqual(
        agent.allowedModelProfiles,
        [],
        `${agent.agentId} must declare no model profiles`,
      );
    }
  });

  it('keeps node outputs governed by a declared contract', () => {
    // `scoredOutput` drops undeclared keys, which is the mechanism behind
    // "a field nobody named cannot flow".
    const result = scoredOutput.validate(
      { finding: 'f', score: 1, secret: 'must not survive' },
      'out',
    );
    assert.ok(result.ok);
    assert.deepEqual(result.value, { finding: 'f', score: 1 });
  });
});
