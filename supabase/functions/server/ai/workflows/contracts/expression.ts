/**
 * The workflow expression language (AI-01 Batch 3B, Part 3).
 *
 * A closed, twelve-operator boolean language over a fixed set of readable
 * sources. It is a DATA STRUCTURE, not a string: there is no parser, no syntax
 * and therefore no injection surface, and the shape below is the entire grammar.
 *
 * ── WHAT THIS LANGUAGE DELIBERATELY CANNOT DO ──────────────────────────────
 *
 * It cannot call a function, define one, or name one. It cannot loop, index by
 * a computed key, concatenate, arithmetic, or produce anything other than a
 * boolean. It cannot reach a provider, a tool, a credential, another tenant, or
 * any part of the run the source list below does not name.
 *
 * There is no `eval`, no `new Function`, no template evaluation and no path
 * query language — see `runtime/paths.ts` for why JSONPath was refused. A
 * condition is walked by `runtime/expressionEvaluator.ts`, which is a switch
 * over this union and nothing else.
 *
 * ── AND NO MODEL MAY AUTHOR ONE ────────────────────────────────────────────
 *
 * Expressions arrive from a registered workflow DEFINITION — reviewed as code,
 * validated at registration, and fixed in the plan digest. Nothing at runtime
 * constructs, edits or extends one, so a model that emitted something
 * expression-shaped would be emitting a value, not a decision. That is the
 * whole reason the language is data rather than text: text invites the
 * assembly step this design does not have.
 */

/**
 * Where a value may come from.
 *
 * Exactly five sources, and the list is the security boundary. Note what is not
 * on it: the environment, the settings record, another run, another tenant, the
 * child agent's internals, and anything a caller sends at advance time.
 */
export type WorkflowValueRef =
  /** A field of the validated run input. */
  | { readonly source: 'input'; readonly path: string }
  /**
   * A field of a TRUSTED node output: one that a completed node produced and
   * that passed the node's declared output contract before it was stored. The
   * qualifier matters — a raw model completion is never readable here, only the
   * contract-validated projection of one.
   */
  | { readonly source: 'node'; readonly nodeId: string; readonly path: string }
  /** A fixed fact about the run. Never anything a caller supplied. */
  | { readonly source: 'metadata'; readonly field: WorkflowMetadataField }
  /** A durable counter. */
  | { readonly source: 'counter'; readonly counter: WorkflowCounter; readonly nodeId?: string }
  /**
   * A field of the result the CURRENT node just produced.
   *
   * Legal only inside an output mapping, and refused everywhere else. A
   * condition has no "current result" — it runs before its node's work, not
   * after — and a node's input mapping reading its own not-yet-existent output
   * would be a reference that is always absent. The one place the concept means
   * something is the mapping that turns a raw agent result into a trusted
   * stored output, so that is the only place it parses.
   */
  | { readonly source: 'result'; readonly path: string }
  /** A constant written into the definition. */
  | { readonly source: 'literal'; readonly value: WorkflowScalar };

export type WorkflowScalar = string | number | boolean | null;

export const WORKFLOW_METADATA_FIELDS = [
  'workflowId',
  'workflowVersion',
  'planDigest',
  'organizationId',
  'stepCount',
  'checkpointVersion',
] as const;

export type WorkflowMetadataField = (typeof WORKFLOW_METADATA_FIELDS)[number];

export const WORKFLOW_COUNTERS = [
  /** Times a loop edge into `nodeId` has been taken. Requires `nodeId`. */
  'loop_iterations',
  /** Times `nodeId` has been executed. Requires `nodeId`. */
  'node_visits',
  /** Nodes completed so far in this run. */
  'steps_completed',
] as const;

export type WorkflowCounter = (typeof WORKFLOW_COUNTERS)[number];

// ── Operators ───────────────────────────────────────────────────────────────

/** Operators taking two values and producing a boolean. */
export const COMPARISON_OPERATORS = [
  'equals',
  'not_equals',
  'greater_than',
  'greater_than_or_equal',
  'less_than',
  'less_than_or_equal',
  'contains',
] as const;

export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];

/** Operators taking one reference and asking whether it resolved. */
export const PRESENCE_OPERATORS = ['exists', 'not_exists'] as const;

export type PresenceOperator = (typeof PRESENCE_OPERATORS)[number];

export const BOOLEAN_OPERATORS = ['and', 'or', 'not'] as const;

export const ALL_EXPRESSION_OPERATORS = [
  ...COMPARISON_OPERATORS,
  ...PRESENCE_OPERATORS,
  ...BOOLEAN_OPERATORS,
] as const;

export type WorkflowExpression =
  | {
      readonly op: ComparisonOperator;
      readonly left: WorkflowValueRef;
      readonly right: WorkflowValueRef;
    }
  | { readonly op: PresenceOperator; readonly ref: WorkflowValueRef }
  | { readonly op: 'and' | 'or'; readonly operands: readonly WorkflowExpression[] }
  | { readonly op: 'not'; readonly operand: WorkflowExpression };

/**
 * Ceilings on an expression.
 *
 * An unbounded expression tree is unbounded work per node and an unbounded
 * value in the plan digest. These are small on purpose: a condition that needs
 * more than sixty-four operators is a condition that should be a node.
 */
export const EXPRESSION_BOUNDS = {
  maxDepth: 8,
  maxOperands: 8,
  maxTotalNodes: 64,
  /** Longest string a literal may carry. */
  maxLiteralLength: 512,
} as const;
