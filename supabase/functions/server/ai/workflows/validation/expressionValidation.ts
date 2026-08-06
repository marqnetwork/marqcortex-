/**
 * Expression and mapping validation (AI-01 Batch 3B, Part 3).
 *
 * Everything that can be judged about a condition or a mapping BEFORE it runs.
 * This is where an authoring mistake is caught, and catching it here is what
 * lets `runtime/expressionEvaluator.ts` promise never to throw: by the time the
 * engine evaluates an expression, its operators are known, its operands are
 * present, its paths parse, its literals are the right types and its depth is
 * bounded. What is left at runtime is data, and data is answered with `false`.
 *
 * ── THE DIVISION OF LABOUR, STATED ONCE ────────────────────────────────────
 *
 *   AUTHOR ERRORS   are refused here, loudly, at registration, on every
 *                   instance, before any run exists.
 *
 *   DATA SURPRISES  are answered at runtime by the missing-value rule and the
 *                   type-mismatch rule, both of which resolve to `false`.
 *
 * A rule that landed in the wrong half would be the worst of both: an author
 * error discovered at 3am on one tenant's run, or a data surprise that failed a
 * run the branch existed to handle.
 *
 * ── LITERAL TYPE CHECKING IS DONE WHERE IT CAN BE ──────────────────────────
 *
 * `greater_than(literal 'yes', literal 3)` is refused here, because both
 * operands are known and the comparison can never be true. The same operator
 * against a node output is not refused, because the value is not knowable until
 * the node has run — and at that point a mismatch is data, not authoring.
 */

import type {
  WorkflowExpression,
  WorkflowValueRef,
} from '../contracts/expression.ts';
import type { WorkflowMapping } from '../contracts/mapping.ts';
import {
  BOOLEAN_OPERATORS,
  COMPARISON_OPERATORS,
  EXPRESSION_BOUNDS,
  PRESENCE_OPERATORS,
  WORKFLOW_COUNTERS,
  WORKFLOW_METADATA_FIELDS,
} from '../contracts/expression.ts';
import { MAPPING_BOUNDS } from '../contracts/mapping.ts';
import { isWritablePath, parsePath } from '../runtime/paths.ts';

/** Ordering operators, whose literal operands must be comparable. */
const ORDERING: readonly string[] = [
  'greater_than',
  'greater_than_or_equal',
  'less_than',
  'less_than_or_equal',
];

export interface ReferenceContext {
  /** Node ids the definition declares. A `node` ref must name one of these. */
  readonly knownNodeIds: ReadonlySet<string>;
  /** The node the expression or mapping belongs to. May not reference itself. */
  readonly ownerNodeId: string;
  /**
   * Whether `source: 'result'` parses here.
   *
   * True only for an output mapping. Everywhere else the concept has no
   * referent — see `contracts/expression.ts` — and admitting it would create a
   * reference that is always absent, which the missing-value rule would then
   * silently answer with `false` forever.
   */
  readonly allowResult?: boolean;
}

/**
 * Validate one expression. Returns every problem, prefixed by `label`.
 *
 * The traversal counts nodes as it goes rather than measuring afterwards, so a
 * maliciously deep tree is refused at the bound instead of being walked first.
 */
export function validateExpression(
  expression: unknown,
  context: ReferenceContext,
  label: string,
): string[] {
  const problems: string[] = [];
  let counted = 0;

  const walk = (node: unknown, depth: number, path: string): void => {
    counted += 1;
    if (counted > EXPRESSION_BOUNDS.maxTotalNodes) {
      if (counted === EXPRESSION_BOUNDS.maxTotalNodes + 1) {
        problems.push(`${label}: expression has more than ${EXPRESSION_BOUNDS.maxTotalNodes} operators`);
      }
      return;
    }
    if (depth > EXPRESSION_BOUNDS.maxDepth) {
      problems.push(`${label}${path}: expression is nested deeper than ${EXPRESSION_BOUNDS.maxDepth}`);
      return;
    }
    if (typeof node !== 'object' || node === null) {
      problems.push(`${label}${path}: expression must be an object`);
      return;
    }

    const op = (node as { op?: unknown }).op;
    if (typeof op !== 'string') {
      problems.push(`${label}${path}: expression has no operator`);
      return;
    }

    if (BOOLEAN_OPERATORS.includes(op as 'and')) {
      if (op === 'not') {
        const operand = (node as { operand?: unknown }).operand;
        if (operand === undefined) {
          problems.push(`${label}${path}: not requires an operand`);
          return;
        }
        walk(operand, depth + 1, `${path}.operand`);
        return;
      }
      const operands = (node as { operands?: unknown }).operands;
      if (!Array.isArray(operands)) {
        problems.push(`${label}${path}: ${op} requires an operands array`);
        return;
      }
      // An empty `and` is vacuously true and an empty `or` vacuously false.
      // Both are almost certainly a mistake, and neither is worth the
      // conversation about which one it was — a boolean group with nothing in
      // it is refused.
      if (operands.length === 0) {
        problems.push(`${label}${path}: ${op} has no operands`);
        return;
      }
      if (operands.length > EXPRESSION_BOUNDS.maxOperands) {
        problems.push(
          `${label}${path}: ${op} has ${operands.length} operands, above the ceiling of ${EXPRESSION_BOUNDS.maxOperands}`,
        );
        return;
      }
      operands.forEach((operand, index) => walk(operand, depth + 1, `${path}.operands[${index}]`));
      return;
    }

    if (PRESENCE_OPERATORS.includes(op as 'exists')) {
      problems.push(
        ...validateRef((node as { ref?: unknown }).ref, context, `${label}${path}.ref`),
      );
      return;
    }

    if (COMPARISON_OPERATORS.includes(op as 'equals')) {
      const left = (node as { left?: unknown }).left;
      const right = (node as { right?: unknown }).right;
      problems.push(...validateRef(left, context, `${label}${path}.left`));
      problems.push(...validateRef(right, context, `${label}${path}.right`));
      problems.push(...literalComparability(op, left, right, `${label}${path}`));
      return;
    }

    problems.push(
      `${label}${path}: "${op}" is not one of the supported operators — ` +
        'the expression vocabulary is closed',
    );
  };

  walk(expression, 0, '');
  return problems;
}

/**
 * A comparison whose operands are BOTH literals can be judged now.
 *
 * This is the narrow slice of type checking that is honest at registration.
 * Anything involving a dynamic source is left alone: refusing it here would be
 * refusing a workflow because of a guess about data that has not arrived.
 */
function literalComparability(
  op: string,
  left: unknown,
  right: unknown,
  label: string,
): string[] {
  const a = literalValue(left);
  const b = literalValue(right);
  if (a === undefined || b === undefined) return [];

  if (ORDERING.includes(op)) {
    const bothNumbers = typeof a.value === 'number' && typeof b.value === 'number';
    const bothStrings = typeof a.value === 'string' && typeof b.value === 'string';
    if (!bothNumbers && !bothStrings) {
      return [`${label}: ${op} compares two literals that are not both numbers or both strings`];
    }
  }
  if (op === 'contains' && typeof a.value !== 'string' && !Array.isArray(a.value)) {
    return [`${label}: contains needs a string or array on the left`];
  }
  return [];
}

function literalValue(ref: unknown): { value: unknown } | undefined {
  if (typeof ref !== 'object' || ref === null) return undefined;
  const candidate = ref as { source?: unknown; value?: unknown };
  return candidate.source === 'literal' ? { value: candidate.value } : undefined;
}

/** Validate one value reference. */
export function validateRef(
  ref: unknown,
  context: ReferenceContext,
  label: string,
): string[] {
  if (typeof ref !== 'object' || ref === null) return [`${label}: reference must be an object`];

  const source = (ref as { source?: unknown }).source;

  switch (source) {
    case 'literal': {
      const value = (ref as { value?: unknown }).value;
      const scalar =
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean';
      if (!scalar) return [`${label}: a literal must be a string, number, boolean or null`];
      if (typeof value === 'string' && value.length > EXPRESSION_BOUNDS.maxLiteralLength) {
        return [`${label}: literal is longer than ${EXPRESSION_BOUNDS.maxLiteralLength} characters`];
      }
      if (typeof value === 'number' && !Number.isFinite(value)) {
        return [`${label}: literal number must be finite`];
      }
      return [];
    }

    case 'input':
      return pathProblems((ref as { path?: unknown }).path, label);

    case 'result':
      return context.allowResult === true
        ? pathProblems((ref as { path?: unknown }).path, label)
        : [`${label}: "result" may only be read by an output mapping`];

    case 'node': {
      const nodeId = (ref as { nodeId?: unknown }).nodeId;
      const problems = pathProblems((ref as { path?: unknown }).path, label);
      if (typeof nodeId !== 'string' || !context.knownNodeIds.has(nodeId)) {
        problems.push(`${label}: references unknown node ${String(nodeId)}`);
      } else if (nodeId === context.ownerNodeId) {
        // A node cannot read its own output: at the moment its input mapping or
        // its condition is evaluated, the value does not exist yet. Inside a
        // loop it would exist from the PREVIOUS iteration, which is a different
        // and much subtler meaning than the author almost certainly intends —
        // so it is refused rather than silently given that reading.
        problems.push(`${label}: a node may not reference its own output`);
      }
      return problems;
    }

    case 'metadata': {
      const field = (ref as { field?: unknown }).field;
      return WORKFLOW_METADATA_FIELDS.includes(field as 'workflowId')
        ? []
        : [`${label}: "${String(field)}" is not a readable metadata field`];
    }

    case 'counter': {
      const counter = (ref as { counter?: unknown }).counter;
      const nodeId = (ref as { nodeId?: unknown }).nodeId;
      if (!WORKFLOW_COUNTERS.includes(counter as 'node_visits')) {
        return [`${label}: "${String(counter)}" is not a readable counter`];
      }
      if (counter === 'steps_completed') return [];
      if (typeof nodeId !== 'string' || !context.knownNodeIds.has(nodeId)) {
        return [`${label}: counter ${String(counter)} needs a known nodeId`];
      }
      return [];
    }

    default:
      return [
        `${label}: "${String(source)}" is not a readable source — ` +
          'conditions and mappings see input, node outputs, metadata, counters and literals',
      ];
  }
}

function pathProblems(path: unknown, label: string): string[] {
  const parsed = parsePath(path);
  return parsed.ok ? [] : [`${label}: ${parsed.problem}`];
}

/** Validate a mapping: its size, its destinations and every source it reads. */
export function validateMapping(
  mapping: unknown,
  context: ReferenceContext,
  label: string,
): string[] {
  if (typeof mapping !== 'object' || mapping === null) {
    return [`${label}: mapping must be an object`];
  }
  const assignments = (mapping as WorkflowMapping).assignments;
  if (!Array.isArray(assignments)) return [`${label}: mapping.assignments must be an array`];
  if (assignments.length === 0) {
    return [`${label}: mapping has no assignments — omit the mapping instead`];
  }
  if (assignments.length > MAPPING_BOUNDS.maxAssignments) {
    return [
      `${label}: mapping has ${assignments.length} assignments, above the ceiling of ${MAPPING_BOUNDS.maxAssignments}`,
    ];
  }

  const problems: string[] = [];
  const destinations = new Set<string>();

  for (const [index, assignment] of assignments.entries()) {
    const at = `${label}.assignments[${index}]`;
    if (typeof assignment !== 'object' || assignment === null) {
      problems.push(`${at}: assignment must be an object`);
      continue;
    }
    if (typeof assignment.required !== 'boolean') {
      // Not defaulted. "Is this field required" is the decision that determines
      // whether a missing value fails the node or is quietly skipped, and a
      // default would make the safer of the two invisible.
      problems.push(`${at}: required must be declared explicitly as a boolean`);
    }

    const destination = parsePath(assignment.to);
    if (!destination.ok) {
      problems.push(`${at}: destination ${destination.problem}`);
    } else {
      if (!isWritablePath(destination.segments)) {
        problems.push(`${at}: destination "${assignment.to}" indexes an array — ` +
          'a mapping writes whole values, not array slots');
      }
      const key = destination.segments.join('.');
      if (destinations.has(key)) {
        // Two assignments to one destination make the result depend on their
        // order in the list, which is a determinism hole hiding in plain sight.
        problems.push(`${at}: destination "${assignment.to}" is assigned twice`);
      }
      destinations.add(key);
    }

    problems.push(...validateRef(assignment.from, context, `${at}.from`));
  }

  return problems;
}
