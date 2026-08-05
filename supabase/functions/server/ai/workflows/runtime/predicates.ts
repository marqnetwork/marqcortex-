/**
 * Condition predicates (AI-01 Batch 3B).
 *
 * A `condition` node does not evaluate an expression. It names a REGISTERED
 * PREDICATE and supplies bounded, typed arguments, and the registry decides
 * true or false.
 *
 * WHY THERE IS NO EXPRESSION LANGUAGE HERE.
 *
 * "Just a tiny expression syntax" is how every sandbox escape starts. An
 * expression string in a definition needs a parser, the parser needs an
 * evaluator, and the evaluator is one convenience feature away from reaching
 * something it should not. A typed predicate registry has none of that: the
 * only code that runs is code that was written, reviewed and shipped in this
 * file, and a definition can select between behaviours but never describe a new
 * one.
 *
 * WHAT A PREDICATE MAY SEE. Exactly what `runtime/mapping.ts` exposes:
 * validated workflow input, trusted node outputs and bounded run metadata —
 * plus the policy, usage, budget and approval facts the engine passes in. It
 * cannot reach a provider, a store, a credential or another tenant, because
 * none of them are arguments.
 *
 * EVERY DECISION IS AUDITED. `evaluatePredicate` returns the value it compared,
 * the operand and the outcome, so "why did the run take the false branch?" is
 * answered by the audit record rather than by re-deriving the state.
 */

import { workflowFailure } from '../contracts/failures.ts';
import type { WorkflowValueSpace } from './mapping.ts';
import { resolvePath } from './mapping.ts';

export interface PredicateInput {
  readonly space: WorkflowValueSpace;
  /** Bounded scalars from the node's `predicateArguments`. */
  readonly args: Readonly<Record<string, string | number | boolean>>;
  readonly context: { readonly workflowRunId: string; readonly nodeId: string; readonly branchId?: string };
}

export interface PredicateOutcome {
  readonly result: boolean;
  /** A caller-safe sentence for the audit record. Never echoes tenant data. */
  readonly explanation: string;
  /** Bounded description of what was compared. Digest-friendly, not content. */
  readonly observed: string;
}

export type Predicate = (input: PredicateInput) => PredicateOutcome;

export interface PredicateRegistry {
  register(predicateId: string, predicate: Predicate): void;
  find(predicateId: string): Predicate | undefined;
  list(): readonly string[];
}

const PREDICATE_ID = /^predicate\.[a-z0-9]+(\.[a-z0-9_]+)*$/;

export function createPredicateRegistry(): PredicateRegistry {
  const predicates = new Map<string, Predicate>();
  return {
    register(predicateId, predicate) {
      if (!PREDICATE_ID.test(predicateId)) {
        throw workflowFailure('invalid_node', 'That predicate identifier is not valid.', {
          diagnostics: `predicate id "${predicateId}" must look like predicate.value.equals`,
        });
      }
      if (predicates.has(predicateId)) {
        throw workflowFailure('invalid_node', 'That predicate is already registered.', {
          diagnostics: `duplicate predicate ${predicateId}`,
        });
      }
      predicates.set(predicateId, predicate);
    },
    find: (predicateId) => predicates.get(predicateId),
    list: () => [...predicates.keys()].sort(),
  };
}

// ── Argument readers ────────────────────────────────────────────────────────

function requireString(input: PredicateInput, key: string): string {
  const value = input.args[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw workflowFailure('condition_failed', 'That condition is missing an argument.', {
      workflowRunId: input.context.workflowRunId,
      nodeId: input.context.nodeId,
      diagnostics: `argument "${key}" must be a non-empty string`,
    });
  }
  return value;
}

function requireNumber(input: PredicateInput, key: string): number {
  const value = input.args[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw workflowFailure('condition_failed', 'That condition is missing an argument.', {
      workflowRunId: input.context.workflowRunId,
      nodeId: input.context.nodeId,
      diagnostics: `argument "${key}" must be a finite number`,
    });
  }
  return value;
}

/**
 * Describe a resolved value without echoing it.
 *
 * A condition's audit record says "a string of 42 characters", never the
 * string. The decision is what a reviewer needs; the content is a tenant's.
 */
function describe(value: unknown): string {
  if (value === undefined) return 'absent';
  if (value === null) return 'null';
  if (typeof value === 'string') return `string(${value.length})`;
  if (typeof value === 'number') return `number(${value})`;
  if (typeof value === 'boolean') return `boolean(${value})`;
  if (Array.isArray(value)) return `array(${value.length})`;
  return `object(${Object.keys(value as Record<string, unknown>).length})`;
}

// ── The shipped predicates ──────────────────────────────────────────────────

export const PREDICATE = {
  exists: 'predicate.value.exists',
  equalsString: 'predicate.value.equals_string',
  equalsNumber: 'predicate.value.equals_number',
  greaterThan: 'predicate.value.greater_than',
  lessThan: 'predicate.value.less_than',
  isTrue: 'predicate.value.is_true',
  lengthAtLeast: 'predicate.value.length_at_least',
  budgetRemainingAtLeast: 'predicate.budget.remaining_at_least',
  tokensRemainingAtLeast: 'predicate.budget.tokens_remaining_at_least',
  approvalGranted: 'predicate.approval.granted',
} as const;

/**
 * Missing values are FALSE, never an error, for every predicate except the ones
 * whose whole question is about presence.
 *
 * A condition that threw on an absent optional value would make every optional
 * field in a workflow a latent run failure, and the branch a definition author
 * wants in that case is almost always "the false one".
 */
export function registerDefaultPredicates(registry: PredicateRegistry): void {
  registry.register(PREDICATE.exists, (input) => {
    const path = requireString(input, 'path');
    const value = resolvePath(input.space, path, input.context);
    const result = value !== undefined && value !== null;
    return {
      result,
      explanation: `${path} ${result ? 'is present' : 'is absent'}`,
      observed: describe(value),
    };
  });

  registry.register(PREDICATE.equalsString, (input) => {
    const path = requireString(input, 'path');
    const expected = requireString(input, 'expected');
    const value = resolvePath(input.space, path, input.context);
    const result = typeof value === 'string' && value === expected;
    return {
      result,
      explanation: `${path} ${result ? 'equals' : 'does not equal'} the expected value`,
      observed: describe(value),
    };
  });

  registry.register(PREDICATE.equalsNumber, (input) => {
    const path = requireString(input, 'path');
    const expected = requireNumber(input, 'expected');
    const value = resolvePath(input.space, path, input.context);
    const result = typeof value === 'number' && value === expected;
    return {
      result,
      explanation: `${path} ${result ? 'equals' : 'does not equal'} ${expected}`,
      observed: describe(value),
    };
  });

  registry.register(PREDICATE.greaterThan, (input) => {
    const path = requireString(input, 'path');
    const operand = requireNumber(input, 'operand');
    const value = resolvePath(input.space, path, input.context);
    const result = typeof value === 'number' && Number.isFinite(value) && value > operand;
    return {
      result,
      explanation: `${path} is ${result ? 'above' : 'not above'} ${operand}`,
      observed: describe(value),
    };
  });

  registry.register(PREDICATE.lessThan, (input) => {
    const path = requireString(input, 'path');
    const operand = requireNumber(input, 'operand');
    const value = resolvePath(input.space, path, input.context);
    const result = typeof value === 'number' && Number.isFinite(value) && value < operand;
    return {
      result,
      explanation: `${path} is ${result ? 'below' : 'not below'} ${operand}`,
      observed: describe(value),
    };
  });

  registry.register(PREDICATE.isTrue, (input) => {
    const path = requireString(input, 'path');
    const value = resolvePath(input.space, path, input.context);
    // Strictly boolean `true`. A truthy string is not a decision anybody made.
    const result = value === true;
    return {
      result,
      explanation: `${path} is ${result ? 'true' : 'not true'}`,
      observed: describe(value),
    };
  });

  registry.register(PREDICATE.lengthAtLeast, (input) => {
    const path = requireString(input, 'path');
    const minimum = requireNumber(input, 'minimum');
    const value = resolvePath(input.space, path, input.context);
    const length =
      typeof value === 'string' ? value.length : Array.isArray(value) ? value.length : -1;
    const result = length >= minimum;
    return {
      result,
      explanation: `${path} length is ${result ? 'at least' : 'below'} ${minimum}`,
      observed: describe(value),
    };
  });

  registry.register(PREDICATE.budgetRemainingAtLeast, (input) => {
    const minimum = requireNumber(input, 'minimumMicroUsd');
    const remaining = input.space.run.remainingCostMicroUsd;
    const result = remaining >= minimum;
    return {
      result,
      explanation: `remaining budget is ${result ? 'at least' : 'below'} ${minimum} micro-USD`,
      observed: `number(${remaining})`,
    };
  });

  registry.register(PREDICATE.tokensRemainingAtLeast, (input) => {
    const minimum = requireNumber(input, 'minimumTokens');
    const remaining = input.space.run.remainingTotalTokens;
    const result = remaining >= minimum;
    return {
      result,
      explanation: `remaining tokens are ${result ? 'at least' : 'below'} ${minimum}`,
      observed: `number(${remaining})`,
    };
  });

  registry.register(PREDICATE.approvalGranted, (input) => {
    const result = input.space.run.approvalState === 'approved';
    return {
      result,
      explanation: `approval state is ${input.space.run.approvalState}`,
      observed: `string(${input.space.run.approvalState.length})`,
    };
  });
}

/** Evaluate a named predicate, or refuse in a way a run can act on. */
export function evaluatePredicate(
  registry: PredicateRegistry,
  predicateId: string,
  input: PredicateInput,
): PredicateOutcome {
  const predicate = registry.find(predicateId);
  if (!predicate) {
    throw workflowFailure('condition_failed', 'That condition uses an unknown predicate.', {
      workflowRunId: input.context.workflowRunId,
      nodeId: input.context.nodeId,
      diagnostics: `predicate ${predicateId} is not registered`,
    });
  }
  return predicate(input);
}
