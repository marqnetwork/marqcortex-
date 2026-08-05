/**
 * Workflow value mapping (AI-01 Batch 3B).
 *
 * A node does not receive "the run". It receives exactly the values its
 * `inputMapping` names, resolved from a bounded, typed value space, and its
 * `outputMapping` writes exactly the keys it declares back into that space.
 *
 * WHY A DECLARATIVE MAP RATHER THAN A FUNCTION.
 *
 * A mapping function inside a definition is code, and code inside data is the
 * thing this batch exists to avoid: it cannot be diffed meaningfully, it cannot
 * be bounded, and it can reach anything its closure can see. A path string can
 * be validated at registration, resolved deterministically, and — crucially —
 * REFUSED when it names a space it has no business reading.
 *
 * THE VALUE SPACE, AND NOTHING ELSE.
 *
 *   input.*     the run's validated input, as accepted by the input contract
 *   values.*    trusted outputs earlier nodes produced through their own
 *               output mappings, already validated
 *   run.*       bounded run metadata: state, step count, branch id, tokens,
 *               cost, remaining budget, approval state
 *
 * There is no `env.`, no `secret.`, no `org.` and no way to name another
 * tenant's anything. A path outside these three roots is a typed failure, not a
 * silent `undefined` — a mapping that quietly resolves to nothing produces a
 * model call with a missing evidence section and no indication why.
 *
 * TRAVERSAL IS BOUNDED. Depth, segment count and the size of the resolved value
 * are all capped. A path is a dotted key walk with no array indexing, no
 * wildcards and no expression syntax, because each of those is a small language
 * and a small language is a thing that gets an interpreter.
 */

import { workflowFailure } from '../contracts/failures.ts';
import type { WorkflowValueMapping } from '../contracts/workflow.ts';
import { canonicalBytes } from '../../agents/runtime/digest.ts';

/** Roots a mapping path may name. Anything else is refused. */
export const VALUE_SPACE_ROOTS = ['input', 'values', 'run'] as const;

export type ValueSpaceRoot = (typeof VALUE_SPACE_ROOTS)[number];

export const MAPPING_BOUNDS = {
  maxSegments: 6,
  maxKeyLength: 64,
  maxEntries: 32,
  maxResolvedBytes: 32 * 1024,
} as const;

/** `input.topic`, `values.classification.label`, `run.stepCount`. */
const PATH_PATTERN = /^[a-z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)*$/;

/** Bounded run metadata a mapping may read. Never the record itself. */
export interface WorkflowRunFacts {
  readonly workflowRunId: string;
  readonly workflowId: string;
  readonly workflowVersion: string;
  readonly state: string;
  readonly stepCount: number;
  readonly retryCount: number;
  readonly branchId: string;
  readonly branchDepth: number;
  readonly actualPromptTokens: number;
  readonly actualCompletionTokens: number;
  readonly actualTotalTokens: number;
  readonly actualCostMicroUsd: number;
  readonly remainingTotalTokens: number;
  readonly remainingCostMicroUsd: number;
  readonly approvalState: string;
  readonly elapsedRuntimeMs: number;
}

export interface WorkflowValueSpace {
  readonly input: unknown;
  readonly values: Readonly<Record<string, unknown>>;
  readonly run: WorkflowRunFacts;
}

export interface MappingContext {
  readonly workflowRunId: string;
  readonly nodeId: string;
  readonly branchId?: string;
}

function refuse(context: MappingContext, message: string, diagnostics: string): never {
  throw workflowFailure('invalid_node', message, {
    workflowRunId: context.workflowRunId,
    nodeId: context.nodeId,
    ...(context.branchId === undefined ? {} : { branchId: context.branchId }),
    diagnostics,
  });
}

/**
 * Resolve one path against the value space.
 *
 * A path that names a legal root but a missing key resolves to `undefined`,
 * which is a legitimate answer — an optional context section that is simply not
 * present yet. A path that names an ILLEGAL root is a definition error and
 * throws, because it can never resolve on any run.
 */
export function resolvePath(
  space: WorkflowValueSpace,
  path: string,
  context: MappingContext,
): unknown {
  if (typeof path !== 'string' || !PATH_PATTERN.test(path)) {
    refuse(context, 'That node declares an unreadable value path.', `invalid path "${path}"`);
  }
  const segments = path.split('.');
  if (segments.length > MAPPING_BOUNDS.maxSegments) {
    refuse(
      context,
      'That node declares a value path that is too deep.',
      `path "${path}" has ${segments.length} segments, above ${MAPPING_BOUNDS.maxSegments}`,
    );
  }
  for (const segment of segments) {
    if (segment.length > MAPPING_BOUNDS.maxKeyLength) {
      refuse(context, 'That node declares an oversized value path.', `segment "${segment}"`);
    }
  }

  const [root, ...rest] = segments;
  if (!(VALUE_SPACE_ROOTS as readonly string[]).includes(root)) {
    refuse(
      context,
      'That node reads a value space the workflow engine does not expose.',
      `path "${path}" names root "${root}"; permitted roots are ${VALUE_SPACE_ROOTS.join(', ')}`,
    );
  }

  let current: unknown =
    root === 'input' ? space.input : root === 'values' ? space.values : space.run;

  for (const segment of rest) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object' || Array.isArray(current)) return undefined;
    // Prototype keys are not data. Resolving `__proto__` would hand a node a
    // reference it has no business holding, and `constructor` is worse.
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Resolve a whole mapping into the object a node receives.
 *
 * The result contains exactly the declared keys. A path that resolves to
 * `undefined` is OMITTED rather than set to undefined, so a node's input has
 * the same shape as its declaration and a downstream validator sees a missing
 * field as missing.
 */
export function resolveMapping(
  space: WorkflowValueSpace,
  mapping: WorkflowValueMapping,
  context: MappingContext,
): Record<string, unknown> {
  const entries = Object.entries(mapping ?? {});
  if (entries.length > MAPPING_BOUNDS.maxEntries) {
    refuse(
      context,
      'That node declares more mapped values than the engine carries.',
      `${entries.length} entries above ${MAPPING_BOUNDS.maxEntries}`,
    );
  }

  const out: Record<string, unknown> = {};
  // Sorted so the resolved object's key order — and therefore its digest — is
  // a function of the declaration, not of object insertion order.
  for (const [key, path] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    if (key.length > MAPPING_BOUNDS.maxKeyLength) {
      refuse(context, 'That node declares an oversized mapping key.', `key "${key}"`);
    }
    const value = resolvePath(space, path, context);
    if (value !== undefined) out[key] = value;
  }

  const bytes = canonicalBytes(out);
  if (bytes === undefined || bytes > MAPPING_BOUNDS.maxResolvedBytes) {
    refuse(
      context,
      'That node resolved more data than the engine will carry.',
      `resolved ${bytes ?? 'unserializable'} bytes above ${MAPPING_BOUNDS.maxResolvedBytes}`,
    );
  }
  return out;
}

/**
 * Apply a node's output mapping to the workflow's value space.
 *
 * `outputMapping` reads `{ targetKey: 'sourceFieldInNodeOutput' }` — the source
 * is a path INSIDE the node's own result, and the target is a flat key in
 * `values`. Flat on purpose: a nested write path would let one node reach into
 * and overwrite part of another node's recorded output, and "which node
 * produced this value?" has to stay answerable.
 */
export function applyOutputMapping(
  values: Readonly<Record<string, unknown>>,
  output: unknown,
  mapping: WorkflowValueMapping,
  context: MappingContext,
): Readonly<Record<string, unknown>> {
  const entries = Object.entries(mapping ?? {});
  if (entries.length === 0) return values;
  if (entries.length > MAPPING_BOUNDS.maxEntries) {
    refuse(
      context,
      'That node declares more output values than the engine carries.',
      `${entries.length} entries above ${MAPPING_BOUNDS.maxEntries}`,
    );
  }

  const next: Record<string, unknown> = { ...values };
  for (const [targetKey, sourcePath] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    if (!PATH_PATTERN.test(targetKey) || targetKey.includes('.')) {
      refuse(
        context,
        'That node writes to an unreadable value key.',
        `output target "${targetKey}" must be a flat key`,
      );
    }
    const value = readWithin(output, sourcePath, context);
    if (value !== undefined) next[targetKey] = value;
  }

  const keys = Object.keys(next);
  if (keys.length > MAPPING_BOUNDS.maxEntries * 2) {
    refuse(
      context,
      'This workflow produced more values than the engine stores.',
      `${keys.length} values above ${MAPPING_BOUNDS.maxEntries * 2}`,
    );
  }
  return next;
}

/** Walk a path inside a node's own output. Same bounds, no value space. */
function readWithin(output: unknown, path: string, context: MappingContext): unknown {
  if (typeof path !== 'string' || !PATH_PATTERN.test(path)) {
    refuse(context, 'That node declares an unreadable output path.', `invalid path "${path}"`);
  }
  const segments = path.split('.');
  if (segments.length > MAPPING_BOUNDS.maxSegments) {
    refuse(context, 'That node declares an output path that is too deep.', `path "${path}"`);
  }
  let current: unknown = output;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object' || Array.isArray(current)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
