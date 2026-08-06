/**
 * The expression evaluator (AI-01 Batch 3B, Part 3).
 *
 * A switch over `contracts/expression.ts` and nothing else. No parser, no
 * compiler, no `eval`, no `new Function`, no dynamic property lookup by a
 * computed name, and no reachable path from an expression to anything outside
 * the `EvaluationScope` it is handed.
 *
 * ── EVALUATION NEVER THROWS ────────────────────────────────────────────────
 *
 * A structurally invalid expression is refused at REGISTRATION by
 * `validation/expressionValidation.ts`, so by the time the engine evaluates
 * one it has already been checked. What remains at runtime is data that did not
 * turn out the way the author assumed — an absent field, a string where a
 * number was expected — and for those this evaluator returns a boolean rather
 * than raising. A condition that threw would turn a data surprise into a failed
 * run, and the branch it guards exists precisely to handle data surprises.
 *
 * ── THE MISSING-VALUE RULE, AND WHY IT IS NOT SYMMETRIC ────────────────────
 *
 *   `exists` / `not_exists`   answer the presence question directly.
 *   EVERY OTHER COMPARISON    is FALSE when either operand is absent.
 *
 * That includes `not_equals`. It is tempting to read "absent ≠ 5" as true, and
 * that reading is how a renamed field silently sends every run down the branch
 * meant for exceptional cases. An absent value satisfies NO comparison. If an
 * author wants "the field is missing or differs", they write it: `or(not_exists,
 * not_equals)` — two operators, one meaning, and the meaning is visible.
 *
 * Type mismatches follow the same rule: ordering a string against a number is
 * false, not an error. The author's mistake is caught at registration where the
 * operands are literals; where they are dynamic, only the data can be wrong,
 * and wrong data must not take a branch it does not satisfy.
 *
 * ── DETERMINISM ────────────────────────────────────────────────────────────
 *
 * No clock, no randomness, no iteration over unordered structures whose order
 * could affect a result, and no short-circuit that depends on evaluation order
 * for its VALUE (`and`/`or` short-circuit for cost, and the result is identical
 * either way because no operand has an effect). The same scope and the same
 * expression produce the same boolean on every instance, forever.
 */

import type {
  ComparisonOperator,
  WorkflowCounter,
  WorkflowExpression,
  WorkflowMetadataField,
  WorkflowScalar,
  WorkflowValueRef,
} from '../contracts/expression.ts';
import type { PathRead } from './paths.ts';
import { parsePath, readPath } from './paths.ts';

/**
 * Everything an expression may see. Assembled by the engine per evaluation.
 *
 * Note the shape of `nodeOutputs`: a map from node id to a TRUSTED output —
 * one that a completed node produced and that passed its declared output
 * contract. The engine has no way to put anything else in here, because the
 * only writer is the checkpoint path that validates first.
 */
export interface EvaluationScope {
  readonly input: unknown;
  readonly nodeOutputs: Readonly<Record<string, unknown>>;
  readonly metadata: Readonly<Record<WorkflowMetadataField, string | number>>;
  /** Loop edge iterations, keyed by the node the loop returns to. */
  readonly loopIterations: Readonly<Record<string, number>>;
  /** Times each node has been executed. */
  readonly nodeVisits: Readonly<Record<string, number>>;
  readonly stepsCompleted: number;
  /**
   * The raw result of the node currently being processed.
   *
   * Populated ONLY when an output mapping is being applied. Absent everywhere
   * else, so a `result` reference outside that one context resolves as missing
   * rather than as somebody else's data — and validation refuses it anyway.
   */
  readonly result?: unknown;
}

const ABSENT: PathRead = { found: false, value: undefined };

/**
 * Resolve a reference within the scope.
 *
 * Exported so the mapper resolves values through exactly the same code an
 * expression does. Two resolvers would be two answers to "what does this
 * reference mean", and the pair would drift the first time either changed.
 */
export function resolveRef(ref: WorkflowValueRef, scope: EvaluationScope): PathRead {
  switch (ref.source) {
    case 'literal':
      return { found: true, value: ref.value };

    case 'input': {
      const parsed = parsePath(ref.path);
      return parsed.ok ? readPath(scope.input, parsed.segments) : ABSENT;
    }

    case 'node': {
      // A node that has not run yet — or that this run's branch skipped — has
      // no output, and the reference is ABSENT rather than an error. That is
      // what makes a reference across a branch safe: the missing-value rule
      // takes over, and it fails closed in both the condition and the mapping.
      if (!Object.prototype.hasOwnProperty.call(scope.nodeOutputs, ref.nodeId)) return ABSENT;
      const parsed = parsePath(ref.path);
      return parsed.ok ? readPath(scope.nodeOutputs[ref.nodeId], parsed.segments) : ABSENT;
    }

    case 'result': {
      if (!Object.prototype.hasOwnProperty.call(scope, 'result')) return ABSENT;
      const parsed = parsePath(ref.path);
      return parsed.ok ? readPath(scope.result, parsed.segments) : ABSENT;
    }

    case 'metadata': {
      const value = scope.metadata[ref.field];
      return value === undefined ? ABSENT : { found: true, value };
    }

    case 'counter':
      return { found: true, value: counterValue(ref.counter, ref.nodeId, scope) };

    default:
      // Unreachable for a registered definition; an unknown source is absent
      // rather than an exception, because evaluation never throws.
      return ABSENT;
  }
}

function counterValue(
  counter: WorkflowCounter,
  nodeId: string | undefined,
  scope: EvaluationScope,
): number {
  switch (counter) {
    case 'loop_iterations':
      return nodeId === undefined ? 0 : (scope.loopIterations[nodeId] ?? 0);
    case 'node_visits':
      return nodeId === undefined ? 0 : (scope.nodeVisits[nodeId] ?? 0);
    case 'steps_completed':
      return scope.stepsCompleted;
    default:
      return 0;
  }
}

/** Evaluate an expression to a boolean. Total — never throws. */
export function evaluateExpression(
  expression: WorkflowExpression,
  scope: EvaluationScope,
): boolean {
  switch (expression.op) {
    case 'and':
      // Every operand must hold. An empty `and` is refused at registration, so
      // the vacuous-truth case cannot arrive here.
      return expression.operands.every((operand) => evaluateExpression(operand, scope));

    case 'or':
      return expression.operands.some((operand) => evaluateExpression(operand, scope));

    case 'not':
      return !evaluateExpression(expression.operand, scope);

    case 'exists':
      return isPresent(resolveRef(expression.ref, scope));

    case 'not_exists':
      return !isPresent(resolveRef(expression.ref, scope));

    default:
      return compare(
        expression.op,
        resolveRef(expression.left, scope),
        resolveRef(expression.right, scope),
      );
  }
}

/**
 * Present means resolved AND not null.
 *
 * `null` is a value a document can carry, and treating it as present would make
 * `exists` true for a field explicitly set to nothing — which is not what any
 * author means by the word. A condition that needs to distinguish "null" from
 * "missing" compares against a null literal.
 */
function isPresent(read: PathRead): boolean {
  return read.found && read.value !== null;
}

function compare(op: ComparisonOperator, left: PathRead, right: PathRead): boolean {
  // THE MISSING-VALUE RULE. See the header: an absent operand satisfies no
  // comparison, including `not_equals`.
  if (!left.found || !right.found) return false;

  const a = left.value;
  const b = right.value;

  switch (op) {
    case 'equals':
      return scalarEquals(a, b);
    case 'not_equals':
      // Both sides are present here, so this is a genuine inequality rather
      // than the absence case the guard above already answered.
      return isScalar(a) && isScalar(b) ? !scalarEquals(a, b) : false;
    case 'contains':
      return containsValue(a, b);
    default:
      return ordered(op, a, b);
  }
}

function isScalar(value: unknown): value is WorkflowScalar {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/**
 * Equality over scalars only.
 *
 * Comparing objects or arrays is refused (false) rather than deep-compared.
 * Deep equality invites a definition to branch on the shape of a whole node
 * output, which is a comparison whose meaning changes every time the output
 * contract gains a field — a condition that silently flips on an unrelated
 * schema change is worse than one that cannot be written.
 */
function scalarEquals(a: unknown, b: unknown): boolean {
  if (!isScalar(a) || !isScalar(b)) return false;
  // No coercion: `1` and `'1'` are different values, and a language that made
  // them equal would make a string field silently satisfy a numeric condition.
  return a === b;
}

function ordered(op: ComparisonOperator, a: unknown, b: unknown): boolean {
  // Numbers compare numerically; strings compare lexicographically. A mixed
  // pair is a type mismatch and satisfies nothing.
  if (typeof a === 'number' && typeof b === 'number') {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return applyOrder(op, a < b, a > b, a === b);
  }
  if (typeof a === 'string' && typeof b === 'string') {
    const comparison = a.localeCompare(b);
    return applyOrder(op, comparison < 0, comparison > 0, comparison === 0);
  }
  return false;
}

function applyOrder(
  op: ComparisonOperator,
  less: boolean,
  greater: boolean,
  equal: boolean,
): boolean {
  switch (op) {
    case 'greater_than':
      return greater;
    case 'greater_than_or_equal':
      return greater || equal;
    case 'less_than':
      return less;
    case 'less_than_or_equal':
      return less || equal;
    default:
      return false;
  }
}

/**
 * `contains` over the two shapes it means something for.
 *
 * A string contains a substring; an array contains a scalar element. An object
 * "containing" something would have to mean key-presence, which `exists`
 * already says more clearly.
 */
function containsValue(haystack: unknown, needle: unknown): boolean {
  if (typeof haystack === 'string') {
    return typeof needle === 'string' && haystack.includes(needle);
  }
  if (Array.isArray(haystack)) {
    return isScalar(needle) && haystack.some((entry) => scalarEquals(entry, needle));
  }
  return false;
}
